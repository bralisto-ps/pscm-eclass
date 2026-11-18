-- Incremental patch for runtime, GPS attendance, index rename & co-lecturer/external-examiner access
-- =====================================================================
-- 18B. Runtime, GPS Attendance, Index Rename & Co-Lecturer/Examiner Fixes
-- =====================================================================

-- 1. GPS Geofence parameters for start_attendance (used by AttendanceTab.jsx & CheckIn.jsx)
drop function if exists public.start_attendance(uuid, text, text[], int, boolean, text[]);
create or replace function public.start_attendance(
  p_course  uuid,
  p_title   text,
  p_streams text[],
  p_minutes int,
  p_ask_row boolean default true,
  p_classes text[] default '{}',
  p_lat     double precision default null,
  p_lng     double precision default null,
  p_radius  int default 100
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform public.require_staff(p_course);
  insert into public.attendance_sessions (course_id, title, streams, closes_at, ask_row, classes, lat, lng, radius_meters)
  values (
    p_course,
    coalesce(nullif(trim(p_title), ''), to_char(now(), 'Dy DD Mon, HH24:MI')),
    case when cardinality(coalesce(p_classes, '{}')) > 0 then '{}' else coalesce(p_streams, '{}') end,
    now() + make_interval(mins => greatest(1, least(coalesce(p_minutes, 10), 240))),
    coalesce(p_ask_row, true),
    coalesce(p_classes, '{}'),
    p_lat,
    p_lng,
    greatest(20, least(coalesce(p_radius, 100), 2000))
  )
  returning id into v;
  perform public.log_course_audit(
    p_course,
    'attendance_start',
    format('Started attendance session "%s"', coalesce(nullif(trim(p_title), ''), 'Class session')),
    jsonb_build_object('session_id', v, 'geofenced', p_lat is not null and p_lng is not null)
  );
  return v;
end;
$$;

-- 2. Index number renaming support for update_student (used by StudentsTab.jsx EditModal)
drop function if exists public.update_student(text, text, text, text);
create or replace function public.update_student(
  p_index     text,
  p_name      text,
  p_programme text,
  p_stream    text,
  p_new_index text default null
) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_old       text := public.norm_index(p_index);
  v_new       text := public.norm_index(coalesce(nullif(trim(p_new_index), ''), p_index));
  v_uid       uuid;
  v_new_email text;
begin
  if not public.is_lecturer() and not exists (
    select 1 from public.enrollments e
     where e.index_no = v_old and public.is_co_lecturer(e.course_id)
  ) then
    raise exception 'Lecturer only.';
  end if;
  if v_old = '' or v_new = '' then
    raise exception 'Index number cannot be empty.';
  end if;

  if v_new <> v_old then
    if exists (select 1 from public.roster where index_no = v_new) then
      raise exception 'Index number % already exists.', v_new;
    end if;
    update public.roster
       set index_no  = v_new,
           full_name = coalesce(nullif(trim(p_name), ''), full_name),
           programme = trim(coalesce(p_programme, '')),
           stream    = trim(coalesce(p_stream, ''))
     where index_no = v_old;

    select id into v_uid from public.profiles where index_no = v_old limit 1;
    update public.profiles
       set index_no  = v_new,
           full_name = coalesce(nullif(trim(p_name), ''), full_name)
     where index_no = v_old;

    if v_uid is not null then
      v_new_email := public.student_email(v_new);
      if v_new_email is not null then
        update auth.users
           set email = v_new_email,
               raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('index_no', v_new),
               updated_at = now()
         where id = v_uid;
      end if;
    end if;

    update public.attendance_excuses    set index_no = v_new where public.norm_index(index_no) = v_old;
    update public.mark_reviews          set index_no = v_new where public.norm_index(index_no) = v_old;
    update public.booking_slots         set booked_index_no = v_new where public.norm_index(booked_index_no) = v_old;
    update public.exam_seat_assignments set index_no = v_new where public.norm_index(index_no) = v_old;
    update public.submission_text_archive set index_no = v_new where public.norm_index(index_no) = v_old;
  else
    update public.roster
       set full_name = coalesce(nullif(trim(p_name), ''), full_name),
           programme = trim(coalesce(p_programme, '')),
           stream    = trim(coalesce(p_stream, ''))
     where index_no = v_old;
    update public.profiles
       set full_name = coalesce(nullif(trim(p_name), ''), full_name)
     where index_no = v_old;
  end if;

  if trim(coalesce(p_programme, '')) <> '' then
    insert into public.group_options values ('programme', trim(p_programme)) on conflict do nothing;
  end if;
  if trim(coalesce(p_stream, '')) <> '' then
    insert into public.group_options values ('stream', trim(p_stream)) on conflict do nothing;
  end if;
end;
$$;

-- 3. Co-Lecturer & External Examiner RLS completeness
drop policy if exists co_lecturer_courses_update on public.courses;
create policy co_lecturer_courses_update on public.courses for update to authenticated
  using (public.is_co_lecturer(id)) with check (public.is_co_lecturer(id));

drop policy if exists staff_read_ca_components on public.ca_components;
create policy staff_read_ca_components on public.ca_components for select to authenticated
  using (public.is_staff(course_id));
drop policy if exists co_lecturer_ca_components on public.ca_components;
create policy co_lecturer_ca_components on public.ca_components for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));

drop policy if exists staff_read_ca_scores on public.ca_scores;
create policy staff_read_ca_scores on public.ca_scores for select to authenticated
  using (exists (select 1 from public.ca_components k where k.id = component_id and public.is_staff(k.course_id)));
drop policy if exists co_lecturer_ca_scores on public.ca_scores;
create policy co_lecturer_ca_scores on public.ca_scores for all to authenticated
  using (exists (select 1 from public.ca_components k where k.id = component_id and public.can_manage_course(k.course_id)))
  with check (exists (select 1 from public.ca_components k where k.id = component_id and public.can_manage_course(k.course_id)));

drop policy if exists ta_enrollments on public.enrollments;
create policy ta_enrollments on public.enrollments for select to authenticated
  using (public.is_staff(course_id));

drop policy if exists ta_quizzes on public.quizzes;
create policy ta_quizzes on public.quizzes for select to authenticated
  using (public.is_staff(course_id));

drop policy if exists ta_quiz_windows on public.quiz_windows;
create policy ta_quiz_windows on public.quiz_windows for select to authenticated
  using (public.is_staff((select course_id from public.quizzes where id = quiz_id)));
drop policy if exists co_lecturer_quiz_windows on public.quiz_windows;
create policy co_lecturer_quiz_windows on public.quiz_windows for all to authenticated
  using (public.can_manage_course((select course_id from public.quizzes where id = quiz_id)))
  with check (public.can_manage_course((select course_id from public.quizzes where id = quiz_id)));

drop policy if exists ta_quiz_access on public.quiz_access;
create policy ta_quiz_access on public.quiz_access for select to authenticated
  using (public.is_staff((select course_id from public.quizzes where id = quiz_id)));
drop policy if exists co_lecturer_quiz_access on public.quiz_access;
create policy co_lecturer_quiz_access on public.quiz_access for all to authenticated
  using (public.can_manage_course((select course_id from public.quizzes where id = quiz_id)))
  with check (public.can_manage_course((select course_id from public.quizzes where id = quiz_id)));

drop policy if exists ta_attempts on public.attempts;
create policy ta_attempts on public.attempts for select to authenticated
  using (public.is_staff((select course_id from public.quizzes where id = quiz_id)));
drop policy if exists co_lecturer_attempts on public.attempts;
create policy co_lecturer_attempts on public.attempts for all to authenticated
  using (public.can_manage_course((select course_id from public.quizzes where id = quiz_id)))
  with check (public.can_manage_course((select course_id from public.quizzes where id = quiz_id)));

drop policy if exists ta_assignments on public.assignments;
create policy ta_assignments on public.assignments for select to authenticated
  using (public.is_staff(course_id));

drop policy if exists ta_submissions on public.submissions;
create policy ta_submissions on public.submissions for select to authenticated
  using (public.is_staff((select course_id from public.assignments where id = assignment_id)));

drop policy if exists ta_announcements on public.announcements;
create policy ta_announcements on public.announcements for select to authenticated
  using (public.is_staff(course_id));
drop policy if exists co_lecturer_announcements on public.announcements;
create policy co_lecturer_announcements on public.announcements for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));

drop policy if exists "materials read" on storage.objects;
create policy "materials read" on storage.objects for select to authenticated
  using (bucket_id = 'materials' and (public.is_lecturer()
         or public.is_staff(public.try_uuid((storage.foldername(name))[1]))
         or public.is_enrolled(public.try_uuid((storage.foldername(name))[1]))));

drop policy if exists "materials write" on storage.objects;
create policy "materials write" on storage.objects for insert to authenticated
  with check (bucket_id = 'materials' and (public.is_lecturer()
         or public.can_manage_course(public.try_uuid((storage.foldername(name))[1]))));

drop policy if exists "materials change" on storage.objects;
create policy "materials change" on storage.objects for update to authenticated
  using (bucket_id = 'materials' and (public.is_lecturer()
         or public.can_manage_course(public.try_uuid((storage.foldername(name))[1]))));

drop policy if exists "materials delete" on storage.objects;
create policy "materials delete" on storage.objects for delete to authenticated
  using (bucket_id = 'materials' and (public.is_lecturer()
         or public.can_manage_course(public.try_uuid((storage.foldername(name))[1]))));

drop policy if exists "submissions read" on storage.objects;
create policy "submissions read" on storage.objects for select to authenticated
  using (bucket_id = 'submissions'
         and (public.is_lecturer() or (storage.foldername(name))[2] = auth.uid()::text
              or public.is_staff((select course_id from public.assignments
                                   where id = public.try_uuid((storage.foldername(name))[1])))));

drop policy if exists "question media insert" on storage.objects;
create policy "question media insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'question_media' and (public.is_lecturer()
         or exists (select 1 from public.course_staff cs where cs.user_id = auth.uid() and cs.staff_role = 'co_lecturer')));

drop policy if exists "question media update" on storage.objects;
create policy "question media update" on storage.objects for update to authenticated
  using (bucket_id = 'question_media' and (public.is_lecturer()
         or exists (select 1 from public.course_staff cs where cs.user_id = auth.uid() and cs.staff_role = 'co_lecturer')))
  with check (bucket_id = 'question_media' and (public.is_lecturer()
         or exists (select 1 from public.course_staff cs where cs.user_id = auth.uid() and cs.staff_role = 'co_lecturer')));

drop policy if exists "question media delete" on storage.objects;
create policy "question media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'question_media' and (public.is_lecturer()
         or exists (select 1 from public.course_staff cs where cs.user_id = auth.uid() and cs.staff_role = 'co_lecturer')));

-- 4. Co-Lecturer & External Examiner RPC permission updates
create or replace function public.course_ca(p_course uuid)
returns table (index_no text, full_name text, programme text, stream text, parts jsonb, total numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.can_manage_course(p_course) and not public.is_external_examiner(p_course) then
    raise exception 'Lecturers and external examiners only.';
  end if;
  return query select x.index_no, x.full_name, x.programme, x.stream, x.parts, x.total from public.ca_rows(p_course) x;
end;
$$;

create or replace function public.save_ca_scores(p_component uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; v numeric; v_idx text; v_course uuid;
begin
  select course_id into v_course from public.ca_components where id = p_component;
  if v_course is null or not public.can_manage_course(v_course) then
    raise exception 'Lecturer only.';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_idx := public.norm_index(r->>'index_no');
    if v_idx = '' or not exists (select 1 from public.roster where index_no = v_idx) then continue; end if;
    if coalesce(r->>'score', '') = '' then
      delete from public.ca_scores where component_id = p_component and index_no = v_idx;
    else
      v := (r->>'score')::numeric;
      insert into public.ca_scores (component_id, index_no, score) values (p_component, v_idx, v)
      on conflict (component_id, index_no) do update set score = excluded.score;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.save_quiz_access(p_quiz uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; v_idx text; v_course uuid;
begin
  select course_id into v_course from public.quizzes where id = p_quiz;
  if v_course is null or not public.can_manage_course(v_course) then
    raise exception 'Lecturer only.';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_idx := public.norm_index(r->>'index_no');
    if not exists (select 1 from public.enrollments where course_id = v_course and index_no = v_idx) then
      raise exception 'Index number % is not on this course.', v_idx;
    end if;
    insert into public.quiz_access (quiz_id, index_no, opens_at, closes_at, extra_attempts, note)
    values (p_quiz, v_idx, nullif(r->>'opens_at', '')::timestamptz, nullif(r->>'closes_at', '')::timestamptz,
            greatest(0, least(coalesce((r->>'extra_attempts')::int, 0), 10)), left(coalesce(r->>'note', ''), 200))
    on conflict (quiz_id, index_no) do update
      set opens_at = excluded.opens_at, closes_at = excluded.closes_at,
          extra_attempts = excluded.extra_attempts, note = excluded.note;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.regrade_quiz(p_quiz uuid, p_preserve_manual boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  qz public.quizzes;
  a  public.attempts;
  q  public.questions;
  r  public.responses;
  g  record;
  v_att_count int := 0;
  v_resp_count int := 0;
begin
  select * into qz from public.quizzes where id = p_quiz;
  if not found then raise exception 'Quiz not found.'; end if;
  if not public.can_manage_course(qz.course_id) then
    raise exception 'Lecturer only.';
  end if;

  for a in select * from public.attempts where quiz_id = p_quiz and status <> 'in_progress' loop
    v_att_count := v_att_count + 1;
    for q in select * from public.questions where id = any(a.question_order) and kind <> 'essay' loop
      select * into r from public.responses where attempt_id = a.id and question_id = q.id;
      if p_preserve_manual and found and r.marked_by is not null then
        continue;
      end if;
      select * into g from public.eval_question_grade(q, case when found then r.value else null end, a.seed);
      insert into public.responses (attempt_id, question_id, value, is_correct, marks_awarded, feedback)
      values (a.id, q.id, case when found then r.value else null end, g.is_correct, g.marks_awarded, g.feedback)
      on conflict (attempt_id, question_id)
      do update set is_correct = excluded.is_correct,
                    marks_awarded = excluded.marks_awarded,
                    feedback = coalesce(excluded.feedback, public.responses.feedback);
      v_resp_count := v_resp_count + 1;
    end loop;
    perform public.recalc_attempt(a.id);
  end loop;

  perform public.log_course_audit(
    qz.course_id,
    'quiz_regrade',
    format('Regraded "%s" (%s attempts recalculated)', qz.title, v_att_count),
    jsonb_build_object('quiz_id', p_quiz, 'attempts_updated', v_att_count, 'responses_updated', v_resp_count, 'preserve_manual', p_preserve_manual)
  );

  return jsonb_build_object('attempts_updated', v_att_count, 'responses_updated', v_resp_count);
end;
$$;

create or replace function public.quiz_item_analysis(p_quiz uuid)
returns table (question_id uuid, qposition int, kind text, prompt text, topic text, marks numeric, answered int,
               avg_pct numeric, discrimination numeric, by_stream jsonb, options jsonb, correct text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_course uuid;
begin
  select course_id into v_course from public.quizzes where id = p_quiz;
  perform public.require_staff(v_course);
  perform public.finalize_expired(p_quiz);
  return query
  with firsts as (
    select distinct on (a.student_id) a.id, a.student_id, a.score, a.max_score
      from public.attempts a where a.quiz_id = p_quiz and a.status <> 'in_progress'
     order by a.student_id, a.attempt_no),
  ranked as (
    select f.*, r.stream,
           percent_rank() over (order by f.score / nullif(f.max_score, 0)) as pr
      from firsts f
      join public.profiles p on p.id = f.student_id
      left join public.roster r on r.index_no = p.index_no),
  resp as (
    select rr.question_id as qid, rk.stream, rk.pr, rr.value,
           rr.marks_awarded / nullif(q.marks, 0) * 100 as pct
      from public.responses rr
      join ranked rk on rk.id = rr.attempt_id
      join public.questions q on q.id = rr.question_id)
  select q.id, q.position, q.kind, q.prompt, q.topic, q.marks,
         (select count(*)::int from resp x where x.qid = q.id and x.pct is not null),
         (select round(avg(x.pct), 1) from resp x where x.qid = q.id),
         (select round((avg(x.pct) filter (where x.pr >= 0.73) - avg(x.pct) filter (where x.pr <= 0.27)) / 100, 2)
            from resp x where x.qid = q.id),
         (select coalesce(jsonb_object_agg(coalesce(nullif(t.stream, ''), 'Not set'), t.p), '{}'::jsonb)
            from (select x.stream, round(avg(x.pct)) as p from resp x where x.qid = q.id and x.pct is not null group by x.stream) t),
         case when q.kind in ('mcq', 'truefalse') then
           (select coalesce(jsonb_object_agg(t.v, t.n), '{}'::jsonb)
              from (select coalesce(x.value #>> '{}', '') as v, count(*) as n from resp x where x.qid = q.id group by 1) t)
         end,
         q.answer ->> 'correct'
    from public.questions q
   where q.quiz_id = p_quiz
   order by q.position, q.created_at;
end;
$$;

create or replace function public.quiz_similar_answers(p_quiz uuid, p_threshold numeric default 0.6)
returns table (question_id uuid, prompt text, a_index text, a_name text, b_index text, b_name text,
               similarity numeric, a_text text, b_text text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare v_course uuid;
begin
  select course_id into v_course from public.quizzes where id = p_quiz;
  if not public.can_manage_course(v_course) then raise exception 'Lecturer only.'; end if;
  return query
  with ans as (
    select rr.question_id as qid, a.student_id, p.index_no, p.full_name,
           public.norm_text(rr.value #>> '{}') as t, rr.value #>> '{}' as raw
      from public.responses rr
      join public.attempts a on a.id = rr.attempt_id and a.quiz_id = p_quiz and a.status <> 'in_progress'
      join public.questions q on q.id = rr.question_id and q.kind in ('essay', 'short')
      join public.profiles p on p.id = a.student_id
     where length(coalesce(rr.value #>> '{}', '')) >= 40)
  select x.qid, q.prompt, x.index_no, x.full_name, y.index_no, y.full_name,
         round(extensions.similarity(x.t, y.t)::numeric, 2), left(x.raw, 600), left(y.raw, 600)
    from ans x
    join ans y on y.qid = x.qid and x.student_id < y.student_id
    join public.questions q on q.id = x.qid
   where extensions.similarity(x.t, y.t) >= greatest(0.3, least(coalesce(p_threshold, 0.6), 1))
   order by 7 desc
   limit 300;
end;
$$;

create or replace function public.quiz_figure_matches(p_quiz uuid)
returns table (question_id uuid, prompt text, index_no text, full_name text, answer numeric,
               match_index text, match_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_course uuid;
begin
  select course_id into v_course from public.quizzes where id = p_quiz;
  if not public.can_manage_course(v_course) then raise exception 'Lecturer only.'; end if;
  return query
  with ex as (
    select a.id as aid, a.student_id, q.id as qid, q.tolerance, q.tolerance_type,
           public.safe_expected(q, a.seed) as e
      from public.attempts a
      join public.questions q on q.quiz_id = a.quiz_id and q.kind = 'numeric' and coalesce(trim(q.formula), '') <> ''
     where a.quiz_id = p_quiz and a.status <> 'in_progress' and q.id = any(a.question_order)),
  wrong as (
    select rr.attempt_id as aid, rr.question_id as qid, public.parse_number(rr.value) as v
      from public.responses rr
      join ex on ex.aid = rr.attempt_id and ex.qid = rr.question_id
     where rr.is_correct = false and public.parse_number(rr.value) is not null)
  select distinct on (w.aid, w.qid)
         w.qid, q.prompt, pa.index_no, pa.full_name, w.v, pb.index_no, pb.full_name
    from wrong w
    join ex mine on mine.aid = w.aid and mine.qid = w.qid
    join ex other on other.qid = w.qid and other.student_id <> mine.student_id and other.e is not null
    join public.questions q on q.id = w.qid
    join public.profiles pa on pa.id = mine.student_id
    join public.profiles pb on pb.id = other.student_id
   where abs(w.v - other.e) <= case when mine.tolerance_type = 'pct' then abs(other.e) * mine.tolerance / 100 else mine.tolerance end + 0.0000001
     and abs(w.v - coalesce(mine.e, w.v + 999)) > case when mine.tolerance_type = 'pct' then abs(coalesce(mine.e, 0)) * mine.tolerance / 100 else mine.tolerance end + 0.0000001
   order by w.aid, w.qid, pb.index_no;
end;
$$;

create or replace function public.test_formula(p_formula text, p_params jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; res numeric;
begin
  if not public.is_lecturer() and not exists (
    select 1 from public.course_staff where user_id = auth.uid() and staff_role = 'co_lecturer'
  ) then
    raise exception 'Lecturer only.';
  end if;
  v := public.gen_vars(floor(random() * 2147483647)::int, gen_random_uuid(), p_params);
  res := public.eval_formula(p_formula, v);
  return jsonb_build_object('vars', v, 'value', res);
exception when others then
  return jsonb_build_object('error', sqlerrm);
end;
$$;

-- 5. Auto-finalize expired quiz attempts safely via finalize_attempt loop
create or replace function public.dispatch_deadline_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_cnt int := 0;
  v_rows int := 0;
  v_att record;
begin
  -- 1. 24-hour assignment deadline reminder (not yet submitted)
  insert into public.notifications (user_id, course_id, kind, title, body, link)
  select p.id, a.course_id, 'deadline',
         format('%s · Due within 24h: %s', c.code, a.title),
         format('Submission closes at %s.', to_char(a.due_at at time zone 'UTC', 'DD Mon HH24:MI')),
         format('/course/%s?tab=assignments', a.course_id)
    from public.assignments a
    join public.courses c on c.id = a.course_id
    join public.enrollments e on e.course_id = a.course_id
    join public.profiles p on p.index_no = e.index_no
   where a.published = true
     and c.archived = false
     and a.due_at is not null
     and a.due_at between now() and now() + interval '24 hours'
     and not exists (
       select 1 from public.submissions s
        where s.assignment_id = a.id and s.student_id = p.id
     )
     and not exists (
       select 1 from public.notifications n
        where n.user_id = p.id
          and n.kind = 'deadline'
          and n.title = format('%s · Due within 24h: %s', c.code, a.title)
          and n.created_at > now() - interval '36 hours'
     );
  get diagnostics v_rows = row_count;
  v_cnt := v_cnt + v_rows;

  -- 2. Auto-finalize expired in-progress quiz attempts past deadline
  for v_att in
    select a.id
      from public.attempts a
     where a.status = 'in_progress'
       and a.deadline_at < now() - interval '2 minutes'
  loop
    perform public.finalize_attempt(v_att.id);
  end loop;

  return v_cnt;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'start_attendance(uuid, text, text[], int, boolean, text[], double precision, double precision, int)',
    'update_student(text, text, text, text, text)',
    'course_ca(uuid)',
    'save_ca_scores(uuid, jsonb)',
    'save_quiz_access(uuid, jsonb)',
    'regrade_quiz(uuid, boolean)',
    'quiz_item_analysis(uuid)',
    'quiz_similar_answers(uuid, numeric)',
    'quiz_figure_matches(uuid)',
    'test_formula(text, jsonb)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
