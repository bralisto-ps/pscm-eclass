// One-time SQL setup script for Section 1: Live Exam Monitor & Control RPCs + proctor_photos Storage bucket
export const LIVE_EXAM_AND_PHOTOS_SQL = `-- 1. Private Storage bucket & RLS policies for mid-quiz verification photos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('proctor_photos', 'proctor_photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "proctor photos upload" on storage.objects;
create policy "proctor photos upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'proctor_photos'
    and exists (
      select 1 from public.attempts a
      join public.quizzes q on q.id = a.quiz_id
      where a.id = public.try_uuid(split_part(regexp_replace(name, '^.*/', ''), '.', 1))
        and a.student_id = auth.uid()
        and q.id = public.try_uuid((storage.foldername(name))[2])
        and q.course_id = public.try_uuid((storage.foldername(name))[1])
    )
  );

drop policy if exists "proctor photos replace" on storage.objects;
create policy "proctor photos replace" on storage.objects for update to authenticated
  using (
    bucket_id = 'proctor_photos'
    and exists (
      select 1 from public.attempts a
      join public.quizzes q on q.id = a.quiz_id
      where a.id = public.try_uuid(split_part(regexp_replace(name, '^.*/', ''), '.', 1))
        and a.student_id = auth.uid()
        and q.id = public.try_uuid((storage.foldername(name))[2])
        and q.course_id = public.try_uuid((storage.foldername(name))[1])
    )
  )
  with check (
    bucket_id = 'proctor_photos'
    and exists (
      select 1 from public.attempts a
      join public.quizzes q on q.id = a.quiz_id
      where a.id = public.try_uuid(split_part(regexp_replace(name, '^.*/', ''), '.', 1))
        and a.student_id = auth.uid()
        and q.id = public.try_uuid((storage.foldername(name))[2])
        and q.course_id = public.try_uuid((storage.foldername(name))[1])
    )
  );

drop policy if exists "proctor photos read" on storage.objects;
create policy "proctor photos read" on storage.objects for select to authenticated
  using (
    bucket_id = 'proctor_photos'
    and (
      public.is_lecturer()
      or public.is_ta(public.try_uuid((storage.foldername(name))[1]))
    )
  );

drop policy if exists "proctor photos delete" on storage.objects;
create policy "proctor photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'proctor_photos' and public.is_lecturer());

-- 2. Lightweight deadline check for students taking an exam
create or replace function public.attempt_deadline(p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.attempts;
begin
  select * into a from public.attempts where id = p_attempt and student_id = auth.uid();
  if not found then raise exception 'Attempt not found.'; end if;
  return jsonb_build_object(
    'status', a.status,
    'deadline_at', a.deadline_at,
    'server_now', now()
  );
end;
$$;

-- 3. Live exam monitor status (does NOT auto-finalize expired attempts so lecturers can extend or force-submit them)
drop function if exists public.quiz_live_status(uuid);
create or replace function public.quiz_live_status(p_quiz uuid)
returns table (
  index_no text,
  full_name text,
  programme text,
  stream text,
  student_id uuid,
  attempt_id uuid,
  status text,
  started_at timestamptz,
  deadline_at timestamptz,
  submitted_at timestamptz,
  answered_count int,
  total_questions int,
  last_saved_at timestamptz,
  exits int,
  devices int,
  exit_log jsonb,
  server_now timestamptz
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_course uuid; v_qcount int;
begin
  select course_id into v_course from public.quizzes where id = p_quiz;
  if v_course is null then raise exception 'Quiz not found.'; end if;
  perform public.require_staff(v_course);
  select count(*)::int into v_qcount from public.questions where quiz_id = p_quiz;

  return query
    select r.index_no,
           r.full_name,
           r.programme,
           r.stream,
           p.id,
           b.id,
           coalesce(b.status, case when p.id is null then 'not_activated' else 'not_started' end),
           b.started_at,
           b.deadline_at,
           b.submitted_at,
           coalesce((
             select count(*)::int from public.responses rr
             where rr.attempt_id = b.id
               and rr.value is not null
               and trim(coalesce(rr.value #>> '{}', '')) <> ''
           ), 0),
           coalesce(array_length(b.question_order, 1), v_qcount),
           (select max(rr.updated_at) from public.responses rr where rr.attempt_id = b.id),
           coalesce(b.exits, 0),
           coalesce(cardinality(b.devices), 0),
           coalesce(b.exit_log, '[]'::jsonb),
           now()
      from public.enrollments e
      join public.roster r on r.index_no = e.index_no
      left join public.profiles p on p.index_no = r.index_no
      left join lateral (
        select a.* from public.attempts a
         where a.quiz_id = p_quiz and a.student_id = p.id
         order by (a.status = 'in_progress') desc, a.started_at desc
         limit 1
      ) b on true
     where e.course_id = v_course
       and (b.id is not null or public.quiz_open_to(p_quiz, r.index_no, r.stream))
     order by (
       case
         when b.status = 'in_progress' then 0
         when b.status in ('needs_marking', 'marked') then 1
         when p.id is not null then 2
         else 3
       end
     ), b.started_at desc nulls last, r.full_name, r.index_no;
end;
$$;

-- 4. Grant extra time to a single active attempt
create or replace function public.extend_attempt_time(p_attempt uuid, p_minutes int)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_mins int := coalesce(p_minutes, 0);
  v_status text; v_quiz uuid; v_course uuid; v_title text;
  v_idx text; v_name text; v_new timestamptz;
begin
  perform public.require_lecturer();
  if v_mins < 1 or v_mins > 240 then
    raise exception 'Extra minutes must be between 1 and 240.';
  end if;

  select a.status, a.quiz_id, q.course_id, q.title, p.index_no, p.full_name
    into v_status, v_quiz, v_course, v_title, v_idx, v_name
    from public.attempts a
    join public.quizzes q on q.id = a.quiz_id
    left join public.profiles p on p.id = a.student_id
   where a.id = p_attempt
   for update of a;

  if not found then raise exception 'Attempt not found.'; end if;
  if v_status <> 'in_progress' then
    raise exception 'Attempt is already submitted. Use Resume / Unlock instead.';
  end if;

  update public.attempts
     set deadline_at = greatest(coalesce(deadline_at, now()), now()) + make_interval(mins => v_mins)
   where id = p_attempt
  returning deadline_at into v_new;

  perform public.log_course_audit(
    v_course,
    'quiz_extend_time',
    format('Granted +%s min on "%s" to %s (%s)', v_mins, coalesce(v_title, 'Quiz'), coalesce(v_name, 'Student'), coalesce(v_idx, '')),
    jsonb_build_object('quiz_id', v_quiz, 'attempt_id', p_attempt, 'minutes', v_mins, 'index_no', v_idx)
  );
  return v_new;
end;
$$;

-- 5. Bulk grant extra time to all active in-progress attempts (optionally scoped by programme/stream)
create or replace function public.extend_quiz_time(p_quiz uuid, p_minutes int, p_programme text default null, p_stream text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_mins int := coalesce(p_minutes, 0);
  v_prog text := trim(coalesce(p_programme, ''));
  v_stream text := trim(coalesce(p_stream, ''));
  v_course uuid; v_title text; v_count int := 0;
begin
  perform public.require_lecturer();
  if v_mins < 1 or v_mins > 240 then
    raise exception 'Extra minutes must be between 1 and 240.';
  end if;

  select course_id, title into v_course, v_title from public.quizzes where id = p_quiz;
  if v_course is null then raise exception 'Quiz not found.'; end if;

  update public.attempts a
     set deadline_at = greatest(coalesce(a.deadline_at, now()), now()) + make_interval(mins => v_mins)
   where a.quiz_id = p_quiz
     and a.status = 'in_progress'
     and (
       (v_prog = '' and v_stream = '')
       or exists (
         select 1 from public.profiles p
         join public.roster r on r.index_no = p.index_no
         where p.id = a.student_id
           and (v_prog = '' or lower(trim(r.programme)) = lower(v_prog))
           and (v_stream = '' or lower(trim(r.stream)) = lower(v_stream))
       )
     );

  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.log_course_audit(
      v_course,
      'quiz_extend_time',
      format('Granted +%s min on "%s" to %s active student(s)%s',
        v_mins,
        coalesce(v_title, 'Quiz'),
        v_count,
        case when v_prog <> '' or v_stream <> '' then format(' (%s %s)', v_prog, v_stream) else '' end),
      jsonb_build_object('quiz_id', p_quiz, 'minutes', v_mins, 'updated', v_count, 'programme', v_prog, 'stream', v_stream)
    );
  end if;
  return v_count;
end;
$$;

-- 6. Unlock / Resume an accidentally closed or submitted attempt without losing saved answers
create or replace function public.reopen_attempt(p_attempt uuid, p_minutes int default 15)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_mins int := greatest(1, least(coalesce(p_minutes, 15), 240));
  v_quiz uuid; v_course uuid; v_title text;
  v_idx text; v_name text; v_new timestamptz;
begin
  perform public.require_lecturer();
  select a.quiz_id, q.course_id, q.title, p.index_no, p.full_name
    into v_quiz, v_course, v_title, v_idx, v_name
    from public.attempts a
    join public.quizzes q on q.id = a.quiz_id
    left join public.profiles p on p.id = a.student_id
   where a.id = p_attempt
   for update of a;

  if not found then raise exception 'Attempt not found.'; end if;

  update public.attempts
     set status = 'in_progress',
         submitted_at = null,
         score = null,
         max_score = null,
         deadline_at = greatest(coalesce(deadline_at, now()), now()) + make_interval(mins => v_mins)
   where id = p_attempt
  returning deadline_at into v_new;

  perform public.log_course_audit(
    v_course,
    'quiz_reopen_attempt',
    format('Unlocked/resumed "%s" for %s (%s) with +%s min', coalesce(v_title, 'Quiz'), coalesce(v_name, 'Student'), coalesce(v_idx, ''), v_mins),
    jsonb_build_object('quiz_id', v_quiz, 'attempt_id', p_attempt, 'minutes', v_mins, 'index_no', v_idx)
  );
  return v_new;
end;
$$;

-- 7. Force-submit a stale in-progress attempt
create or replace function public.force_submit_attempt(p_attempt uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_quiz uuid; v_course uuid; v_title text;
  v_idx text; v_name text; v_status text;
begin
  perform public.require_lecturer();
  select a.quiz_id, q.course_id, q.title, p.index_no, p.full_name
    into v_quiz, v_course, v_title, v_idx, v_name
    from public.attempts a
    join public.quizzes q on q.id = a.quiz_id
    left join public.profiles p on p.id = a.student_id
   where a.id = p_attempt;

  if not found then raise exception 'Attempt not found.'; end if;

  perform public.finalize_attempt(p_attempt);
  select status into v_status from public.attempts where id = p_attempt;

  perform public.log_course_audit(
    v_course,
    'quiz_force_submit',
    format('Force-submitted "%s" for %s (%s)', coalesce(v_title, 'Quiz'), coalesce(v_name, 'Student'), coalesce(v_idx, '')),
    jsonb_build_object('quiz_id', v_quiz, 'attempt_id', p_attempt, 'status', v_status, 'index_no', v_idx)
  );
  return v_status;
end;
$$;


-- 8. Staff script viewer (view individual student choices, short answers, unique figures & override marks)
create or replace function public.staff_attempt_review(p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $
declare
  a public.attempts;
  qz public.quizzes;
  pr public.profiles;
  qs jsonb;
begin
  select * into a from public.attempts where id = p_attempt;
  if not found then raise exception 'Attempt not found.'; end if;
  select * into qz from public.quizzes where id = a.quiz_id;
  perform public.require_staff(qz.course_id);
  select * into pr from public.profiles where id = a.student_id;

  select jsonb_agg(jsonb_build_object(
           'response_id', r.id,
           'id', q.id,
           'kind', q.kind,
           'prompt', q.prompt,
           'marks', q.marks,
           'unit', q.unit,
           'vars', case when coalesce(trim(q.formula), '') <> ''
                        then public.gen_vars(a.seed, q.id, q.params) else '{}'::jsonb end,
           'options', case when q.kind in ('mcq','truefalse') then q.options else '[]'::jsonb end,
           'value', r.value,
           'is_correct', r.is_correct,
           'marks_awarded', r.marks_awarded,
           'feedback', r.feedback,
           'correct', case
                        when q.kind in ('mcq','truefalse') then q.answer->'correct'
                        when q.kind = 'short' then q.answer->'accepted'
                        when q.kind = 'numeric' then (select to_jsonb(public.expected_value(q, a.seed)))
                        else null
                      end,
           'explanation', q.explanation)
         order by o.ord)
    into qs
    from unnest(a.question_order) with ordinality as o(qid, ord)
    join public.questions q on q.id = o.qid
    left join public.responses r on r.attempt_id = a.id and r.question_id = q.id;

  return jsonb_build_object(
    'attempt_id', a.id,
    'quiz_id', qz.id,
    'title', qz.title,
    'status', a.status,
    'score', a.score,
    'max_score', a.max_score,
    'started_at', a.started_at,
    'submitted_at', a.submitted_at,
    'student', jsonb_build_object(
      'id', pr.id,
      'full_name', coalesce(pr.full_name, 'Student'),
      'index_no', coalesce(pr.index_no, '')
    ),
    'questions', coalesce(qs, '[]'::jsonb)
  );
end;
$;

do $
declare f text;
begin
  foreach f in array array[
    'attempt_deadline(uuid)',
    'quiz_live_status(uuid)',
    'extend_attempt_time(uuid, int)',
    'extend_quiz_time(uuid, int, text, text)',
    'reopen_attempt(uuid, int)',
    'force_submit_attempt(uuid)',
    'staff_attempt_review(uuid)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;`;
