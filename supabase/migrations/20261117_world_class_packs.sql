-- =====================================================================
-- 18. World-Class E-Class Packs A, B & C:
--     A1. Inline PDF Annotation Grading
--     A2. Cross-Semester Similarity Archive
--     A3. CLO Tagging & Double-Blind Quiz Moderation Sign-Off
--     B1. In-App Notification Center (Realtime) + Web Push + pg_cron Reminders
--     B2. Prerequisite / Mastery Module Gating
--     C1. Multi-Lecturer Co-Instructors & Read-Only External Examiners
--     C2. Course Learning Outcomes (CLO / PLO) & Attainment Analytics
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pack A1: Inline PDF Annotation Grading
-- ---------------------------------------------------------------------
create table if not exists public.submission_annotations (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  course_id     uuid not null references public.courses(id) on delete cascade,
  author_id     uuid references public.profiles(id) on delete set null,
  author_name   text not null default '',
  annotations   jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now()
);

create index if not exists submission_annotations_course_idx
  on public.submission_annotations (course_id);

alter table public.submission_annotations enable row level security;

drop policy if exists staff_read_sub_ann on public.submission_annotations;
create policy staff_read_sub_ann on public.submission_annotations
  for select to authenticated
  using (public.is_staff(course_id));

drop policy if exists staff_write_sub_ann on public.submission_annotations;
create policy staff_write_sub_ann on public.submission_annotations
  for all to authenticated
  using (public.is_lecturer() or public.is_ta(course_id))
  with check (public.is_lecturer() or public.is_ta(course_id));

drop policy if exists student_read_own_sub_ann on public.submission_annotations;
create policy student_read_own_sub_ann on public.submission_annotations
  for select to authenticated
  using (
    exists (
      select 1 from public.submissions s
      join public.assignments a on a.id = s.assignment_id
      where s.id = submission_id
        and s.student_id = auth.uid()
        and a.results_released = true
    )
  );

create or replace function public.save_submission_annotations(
  p_submission  uuid,
  p_annotations jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sub    record;
  v_author text;
  v_clean  jsonb := coalesce(p_annotations, '[]'::jsonb);
begin
  select s.id, a.course_id, p.index_no
    into v_sub
    from public.submissions s
    join public.assignments a on a.id = s.assignment_id
    left join public.profiles p on p.id = s.student_id
   where s.id = p_submission;

  if v_sub.id is null then raise exception 'Submission not found.'; end if;
  perform public.require_staff(v_sub.course_id);
  if not public.is_lecturer() and not public.is_ta(v_sub.course_id) then
    raise exception 'External examiners have read-only access.';
  end if;

  select nullif(trim(full_name), '') into v_author from public.profiles where id = auth.uid();

  insert into public.submission_annotations (submission_id, course_id, author_id, author_name, annotations, updated_at)
  values (p_submission, v_sub.course_id, auth.uid(), coalesce(v_author, 'Staff'), v_clean, now())
  on conflict (submission_id) do update
    set author_id   = excluded.author_id,
        author_name = excluded.author_name,
        annotations = excluded.annotations,
        updated_at  = now();

  perform public.log_course_audit(
    v_sub.course_id,
    'pdf_annotations_saved',
    format('Saved %s PDF annotation(s) for %s', jsonb_array_length(v_clean), coalesce(v_sub.index_no, 'student')),
    jsonb_build_object('submission_id', p_submission, 'count', jsonb_array_length(v_clean))
  );

  return v_clean;
end;
$$;

create or replace function public.assignment_annotations_map(p_assignment uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_course uuid;
begin
  select course_id into v_course from public.assignments where id = p_assignment;
  if v_course is null then return '{}'::jsonb; end if;
  perform public.require_staff(v_course);
  return coalesce((
    select jsonb_object_agg(sa.submission_id::text, sa.annotations)
      from public.submission_annotations sa
      join public.submissions s on s.id = sa.submission_id
     where s.assignment_id = p_assignment
  ), '{}'::jsonb);
end;
$$;

create or replace function public.my_submission_annotations(p_submission uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_sub record;
  v_ann jsonb;
begin
  select s.id, s.student_id, a.course_id, a.results_released
    into v_sub
    from public.submissions s
    join public.assignments a on a.id = s.assignment_id
   where s.id = p_submission;

  if v_sub.id is null then return '[]'::jsonb; end if;
  if not public.is_staff(v_sub.course_id)
     and not (v_sub.student_id = auth.uid() and v_sub.results_released = true) then
    return '[]'::jsonb;
  end if;

  select annotations into v_ann
    from public.submission_annotations
   where submission_id = p_submission;

  return coalesce(v_ann, '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Pack A2: Cross-Semester Similarity Archive
-- ---------------------------------------------------------------------
create table if not exists public.submission_text_archive (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  course_code  text not null default '',
  semester     text not null default '',
  index_no     text not null default '',
  student_name text not null default '',
  title        text not null default '',
  text_excerpt text not null default '',
  word_count   int not null default 0,
  created_at   timestamptz not null default now(),
  unique (assignment_id, index_no)
);

create index if not exists submission_archive_code_idx
  on public.submission_text_archive (lower(course_code), created_at desc);

alter table public.submission_text_archive enable row level security;

drop policy if exists staff_read_archive on public.submission_text_archive;
create policy staff_read_archive on public.submission_text_archive
  for select to authenticated
  using (public.is_staff(course_id));

create or replace function public.save_submission_archive_texts(
  p_assignment uuid,
  p_rows       jsonb default '[]'::jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_assign record;
  v_course record;
  v_row    jsonb;
  v_idx    text;
  v_text   text;
  v_count  int := 0;
begin
  select id, course_id, title into v_assign from public.assignments where id = p_assignment;
  if v_assign.id is null then return 0; end if;
  perform public.require_staff(v_assign.course_id);

  select code, semester into v_course from public.courses where id = v_assign.course_id;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_idx := public.norm_index(v_row->>'index_no');
    v_text := left(coalesce(v_row->>'text', ''), 12000);
    if v_idx = '' or length(btrim(v_text)) < 40 then continue; end if;

    insert into public.submission_text_archive (
      course_id, assignment_id, course_code, semester, index_no, student_name, title, text_excerpt, word_count
    ) values (
      v_assign.course_id,
      p_assignment,
      coalesce(v_course.code, ''),
      coalesce(v_course.semester, ''),
      v_idx,
      coalesce(v_row->>'full_name', ''),
      coalesce(v_assign.title, ''),
      v_text,
      coalesce((v_row->>'word_count')::int, 0)
    )
    on conflict (assignment_id, index_no) do update
      set student_name = excluded.student_name,
          text_excerpt = excluded.text_excerpt,
          word_count   = excluded.word_count,
          course_code  = excluded.course_code,
          semester     = excluded.semester;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.past_similarity_texts(
  p_course     uuid,
  p_assignment uuid
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_code text;
begin
  perform public.require_staff(p_course);
  select code into v_code from public.courses where id = p_course;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', sta.id,
      'index_no', sta.index_no,
      'full_name', sta.student_name,
      'course_code', sta.course_code,
      'semester', sta.semester,
      'title', sta.title,
      'text', sta.text_excerpt
    ) order by sta.created_at desc)
    from (
      select *
        from public.submission_text_archive
       where assignment_id is distinct from p_assignment
         and (course_id = p_course or lower(trim(course_code)) = lower(trim(coalesce(v_code, ''))))
       order by created_at desc
       limit 250
    ) sta
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Pack A3 & C2: CLO Tagging + Double-Blind Quiz Moderation Sign-Off
-- ---------------------------------------------------------------------
alter table public.questions
  add column if not exists clo_code text not null default '';

alter table public.assignments
  add column if not exists clo_code text not null default '';

alter table public.attempts
  add column if not exists moderated_by uuid references public.profiles(id) on delete set null,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderation_status text not null default '',
  add column if not exists moderation_note text not null default '';

create or replace function public.save_attempt_moderation(
  p_attempt uuid,
  p_status  text,
  p_note    text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_course uuid;
  v_idx    text;
  v_status text := lower(btrim(coalesce(p_status, '')));
begin
  select q.course_id, p.index_no into v_course, v_idx
    from public.attempts a
    join public.quizzes q on q.id = a.quiz_id
    left join public.profiles p on p.id = a.student_id
   where a.id = p_attempt;

  if v_course is null then raise exception 'Attempt not found.'; end if;
  perform public.require_staff(v_course);

  if v_status not in ('', 'verified', 'flagged') then
    raise exception 'Moderation status must be verified, flagged, or blank.';
  end if;

  update public.attempts
     set moderation_status = v_status,
         moderation_note   = left(btrim(coalesce(p_note, '')), 500),
         moderated_by      = case when v_status = '' then null else auth.uid() end,
         moderated_at      = case when v_status = '' then null else now() end
   where id = p_attempt;

  perform public.log_course_audit(
    v_course,
    'attempt_moderated',
    format('Moderation %s for %s', coalesce(nullif(v_status, ''), 'cleared'), coalesce(v_idx, 'student')),
    jsonb_build_object('attempt_id', p_attempt, 'status', v_status, 'note', left(btrim(coalesce(p_note, '')), 200))
  );
end;
$$;

create or replace function public.quiz_moderation_map(p_quiz uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_course uuid;
begin
  select course_id into v_course from public.quizzes where id = p_quiz;
  if v_course is null then return '{}'::jsonb; end if;
  perform public.require_staff(v_course);

  return coalesce((
    select jsonb_object_agg(a.id::text, jsonb_build_object(
      'status', a.moderation_status,
      'note', a.moderation_note,
      'moderated_at', a.moderated_at,
      'moderator_name', coalesce(p.full_name, 'Staff')
    ))
    from public.attempts a
    left join public.profiles p on p.id = a.moderated_by
   where a.quiz_id = p_quiz
     and coalesce(a.moderation_status, '') <> ''
  ), '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Pack B1: In-App Notification Center + Push Subscriptions + pg_cron
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  course_id  uuid references public.courses(id) on delete cascade,
  kind       text not null default 'info',
  title      text not null,
  body       text not null default '',
  link       text not null default '',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists own_notifications on public.notifications;
create policy own_notifications on public.notifications
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when others then null;
end $$;

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null default '',
  auth       text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

drop policy if exists own_push_subs on public.push_subscriptions;
create policy own_push_subs on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.my_notifications(p_limit int default 40) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id,
      'course_id', n.course_id,
      'kind', n.kind,
      'title', n.title,
      'body', n.body,
      'link', n.link,
      'read_at', n.read_at,
      'created_at', n.created_at
    ) order by n.created_at desc)
    from (
      select * from public.notifications
       where user_id = auth.uid()
       order by created_at desc
       limit greatest(1, least(coalesce(p_limit, 40), 100))
    ) n
  ), '[]'::jsonb);
end;
$$;

create or replace function public.mark_notification_read(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.notifications
     set read_at = coalesce(read_at, now())
   where id = p_id and user_id = auth.uid();
$$;

create or replace function public.mark_all_notifications_read() returns void
language sql security definer set search_path = public as $$
  update public.notifications
     set read_at = coalesce(read_at, now())
   where user_id = auth.uid() and read_at is null;
$$;

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh   text default '',
  p_auth     text default ''
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(btrim(coalesce(p_endpoint, ''))) < 8 then return; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), btrim(p_endpoint), coalesce(p_p256dh, ''), coalesce(p_auth, ''))
  on conflict (user_id, endpoint) do update
    set p256dh = excluded.p256dh,
        auth   = excluded.auth;
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions
   where user_id = auth.uid() and endpoint = btrim(coalesce(p_endpoint, ''));
$$;

create or replace function public.notify_on_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  select code into v_code from public.courses where id = new.course_id;
  insert into public.notifications (user_id, course_id, kind, title, body, link)
  select p.id, new.course_id, 'announcement',
         format('%s · %s', coalesce(v_code, 'Announcement'), new.title),
         left(coalesce(new.body, ''), 180),
         format('/course/%s?tab=announcements', new.course_id)
    from public.enrollments e
    join public.profiles p on p.index_no = e.index_no
   where e.course_id = new.course_id;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_notify_announcement on public.announcements;
create trigger trg_notify_announcement
  after insert on public.announcements
  for each row execute function public.notify_on_announcement();

create or replace function public.notify_on_quiz_release() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if coalesce(old.results_released, false) = false and new.results_released = true then
    select code into v_code from public.courses where id = new.course_id;
    insert into public.notifications (user_id, course_id, kind, title, body, link)
    select distinct a.student_id, new.course_id, 'grade',
           format('%s · Quiz marks released', coalesce(v_code, 'Quiz')),
           format('Results for "%s" are now available.', new.title),
           format('/course/%s?tab=quizzes', new.course_id)
      from public.attempts a
     where a.quiz_id = new.id and a.status <> 'in_progress';
  elsif coalesce(old.published, false) = false and new.published = true then
    select code into v_code from public.courses where id = new.course_id;
    insert into public.notifications (user_id, course_id, kind, title, body, link)
    select p.id, new.course_id, 'quiz',
           format('%s · New quiz published', coalesce(v_code, 'Quiz')),
           new.title,
           format('/course/%s?tab=quizzes', new.course_id)
      from public.enrollments e
      join public.profiles p on p.index_no = e.index_no
     where e.course_id = new.course_id;
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_notify_quiz_release on public.quizzes;
create trigger trg_notify_quiz_release
  after update of published, results_released on public.quizzes
  for each row execute function public.notify_on_quiz_release();

create or replace function public.notify_on_assignment_release() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if coalesce(old.results_released, false) = false and new.results_released = true then
    select code into v_code from public.courses where id = new.course_id;
    insert into public.notifications (user_id, course_id, kind, title, body, link)
    select distinct s.student_id, new.course_id, 'grade',
           format('%s · Assignment marks released', coalesce(v_code, 'Assignment')),
           format('Marks for "%s" are now visible.', new.title),
           format('/course/%s?tab=assignments', new.course_id)
      from public.submissions s
     where s.assignment_id = new.id and s.marks is not null;
  elsif coalesce(old.published, false) = false and new.published = true then
    select code into v_code from public.courses where id = new.course_id;
    insert into public.notifications (user_id, course_id, kind, title, body, link)
    select p.id, new.course_id, 'assignment',
           format('%s · New assignment posted', coalesce(v_code, 'Assignment')),
           new.title,
           format('/course/%s?tab=assignments', new.course_id)
      from public.enrollments e
      join public.profiles p on p.index_no = e.index_no
     where e.course_id = new.course_id;
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_notify_assignment_release on public.assignments;
create trigger trg_notify_assignment_release
  after update of published, results_released on public.assignments
  for each row execute function public.notify_on_assignment_release();

create or replace function public.notify_on_excuse_decision() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    select code into v_code from public.courses where id = new.course_id;
    insert into public.notifications (user_id, course_id, kind, title, body, link)
    values (
      new.student_id,
      new.course_id,
      'excuse',
      format('%s · Attendance excuse %s', coalesce(v_code, 'Attendance'), new.status),
      coalesce(nullif(new.reviewer_note, ''), format('Your excuse request was %s.', new.status)),
      format('/course/%s?tab=attendance', new.course_id)
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_notify_excuse_decision on public.attendance_excuses;
create trigger trg_notify_excuse_decision
  after update of status on public.attendance_excuses
  for each row execute function public.notify_on_excuse_decision();

create or replace function public.notify_on_review_decision() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if old.status = 'pending' and new.status in ('approved', 'declined') then
    select code into v_code from public.courses where id = new.course_id;
    insert into public.notifications (user_id, course_id, kind, title, body, link)
    values (
      new.student_id,
      new.course_id,
      'review',
      format('%s · Mark review %s', coalesce(v_code, 'Review'), new.status),
      coalesce(nullif(new.reviewer_note, ''), format('Your mark review request was %s.', new.status)),
      format('/course/%s?tab=%s', new.course_id, case when new.kind = 'assignment' then 'assignments' else 'quizzes' end)
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_notify_review_decision on public.mark_reviews;
create trigger trg_notify_review_decision
  after update of status on public.mark_reviews
  for each row execute function public.notify_on_review_decision();

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

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('pscm-deadline-reminders');
  end if;
exception when others then null;
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('pscm-deadline-reminders', '*/15 * * * *', 'select public.dispatch_deadline_reminders();');
  end if;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------
-- Pack B2: Prerequisite / Mastery Gating on Course Modules
-- ---------------------------------------------------------------------
alter table public.modules
  add column if not exists prereq_module_id uuid references public.modules(id) on delete set null,
  add column if not exists prereq_quiz_id   uuid references public.quizzes(id) on delete set null,
  add column if not exists prereq_min_pct   numeric not null default 50;

create or replace function public.course_module_gates(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff(p_course) and not public.is_enrolled(p_course) then
    return '{}'::jsonb;
  end if;

  return coalesce((
    select jsonb_object_agg(m.id::text, jsonb_build_object(
      'unlocked', (
        public.is_staff(p_course) or (
          (m.prereq_module_id is null or not exists (
            select 1 from public.materials mat
             where mat.module_id = m.prereq_module_id
               and not exists (
                 select 1 from public.material_views mv
                  where mv.material_id = mat.id and mv.student_id = auth.uid()
               )
          ))
          and (m.prereq_quiz_id is null or coalesce((
            select max(case when a.max_score > 0 then (a.score / a.max_score) * 100 else 0 end)
              from public.attempts a
             where a.quiz_id = m.prereq_quiz_id
               and a.student_id = auth.uid()
               and a.status <> 'in_progress'
          ), 0) >= coalesce(m.prereq_min_pct, 50))
        )
      ),
      'prereq_module_id', m.prereq_module_id,
      'prereq_module_title', pm.title,
      'prereq_quiz_id', m.prereq_quiz_id,
      'prereq_quiz_title', pq.title,
      'prereq_min_pct', coalesce(m.prereq_min_pct, 50)
    ))
    from public.modules m
    left join public.modules pm on pm.id = m.prereq_module_id
    left join public.quizzes pq on pq.id = m.prereq_quiz_id
   where m.course_id = p_course
     and (m.prereq_module_id is not null or m.prereq_quiz_id is not null)
  ), '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Pack C1: Multi-Lecturer Co-Instructors & Read-Only External Examiners
-- ---------------------------------------------------------------------
alter table public.course_staff
  add column if not exists staff_role text not null default 'ta';

do $$ begin
  alter table public.course_staff drop constraint if exists course_staff_role_check;
  alter table public.course_staff add constraint course_staff_role_check
    check (staff_role in ('ta', 'co_lecturer', 'external_examiner'));
exception when others then null;
end $$;

create or replace function public.is_ta(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.course_staff
     where course_id = p_course and user_id = auth.uid()
       and coalesce(staff_role, 'ta') in ('ta', 'co_lecturer')
  );
$$;

create or replace function public.is_co_lecturer(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.course_staff
     where course_id = p_course and user_id = auth.uid() and staff_role = 'co_lecturer'
  );
$$;

create or replace function public.is_external_examiner(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.course_staff
     where course_id = p_course and user_id = auth.uid() and staff_role = 'external_examiner'
  );
$$;

create or replace function public.is_staff(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_lecturer()
      or exists (select 1 from public.course_staff where course_id = p_course and user_id = auth.uid());
$$;

create or replace function public.can_manage_course(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_lecturer() or public.is_co_lecturer(p_course);
$$;

create or replace function public.my_course_staff_role(p_course uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  if public.is_lecturer() then return 'lecturer'; end if;
  select staff_role into v_role
    from public.course_staff
   where course_id = p_course and user_id = auth.uid()
   limit 1;
  return coalesce(v_role, '');
end;
$$;

create or replace function public.my_staff_roles() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_lecturer() then return '{}'::jsonb; end if;
  return coalesce((
    select jsonb_object_agg(course_id::text, coalesce(staff_role, 'ta'))
      from public.course_staff
     where user_id = auth.uid()
  ), '{}'::jsonb);
end;
$$;

-- Update audit logger to record co_lecturer / external_examiner role cleanly
create or replace function public.log_course_audit(
  p_course  uuid,
  p_action  text,
  p_summary text,
  p_details jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_role text;
  v_staff_role text;
  v_resolved_role text;
begin
  if p_course is null then return; end if;
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  select staff_role, nullif(trim(full_name), '')
    into v_staff_role, v_name
    from (
      select staff_role, coalesce(nullif(trim(v_name), ''), full_name) as full_name
        from public.course_staff
       where course_id = p_course and user_id = auth.uid()
       limit 1
    ) cs;
  if nullif(trim(coalesce(v_name, '')), '') is null then
    select full_name into v_name from public.profiles where id = auth.uid();
  end if;
  v_resolved_role := case
    when v_role = 'lecturer' or public.is_lecturer() then 'lecturer'
    when v_staff_role in ('co_lecturer', 'external_examiner', 'ta') then v_staff_role
    when v_role = 'ta' or public.is_ta(p_course) then 'ta'
    else 'staff'
  end;
  insert into public.course_audit_logs (course_id, actor_id, actor_name, actor_role, action, summary, details)
  values (p_course, auth.uid(), coalesce(nullif(trim(v_name), ''), 'Staff'), v_resolved_role, p_action, p_summary, coalesce(p_details, '{}'::jsonb));
exception when others then
  null;
end;
$$;

-- Co-lecturer & external examiner RLS policies
drop policy if exists ta_courses on public.courses;
create policy ta_courses on public.courses for select to authenticated
  using (public.is_staff(id));

drop policy if exists co_lecturer_modules on public.modules;
create policy co_lecturer_modules on public.modules for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));

drop policy if exists co_lecturer_materials on public.materials;
create policy co_lecturer_materials on public.materials for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));

drop policy if exists co_lecturer_quizzes on public.quizzes;
create policy co_lecturer_quizzes on public.quizzes for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));

drop policy if exists co_lecturer_questions on public.questions;
create policy co_lecturer_questions on public.questions for all to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and public.can_manage_course(q.course_id)))
  with check (exists (select 1 from public.quizzes q where q.id = quiz_id and public.can_manage_course(q.course_id)));

drop policy if exists co_lecturer_assignments on public.assignments;
create policy co_lecturer_assignments on public.assignments for all to authenticated
  using (public.can_manage_course(course_id)) with check (public.can_manage_course(course_id));

drop policy if exists staff_read_audit on public.course_audit_logs;
create policy staff_read_audit on public.course_audit_logs for select to authenticated
  using (public.is_staff(course_id));

drop function if exists public.course_staff_list(uuid);
create or replace function public.course_staff_list(p_course uuid)
returns table (email text, full_name text, staff_role text, activated boolean, last_sign_in timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
#variable_conflict use_column
begin
  if not public.can_manage_course(p_course) and not public.is_external_examiner(p_course) then
    raise exception 'Only course lecturers can view staff.';
  end if;
  return query
    select s.email, coalesce(nullif(p.full_name, ''), s.full_name), coalesce(s.staff_role, 'ta'),
           s.user_id is not null, u.last_sign_in_at
      from public.course_staff s
      left join public.profiles p on p.id = s.user_id
      left join auth.users u on u.id = s.user_id
     where s.course_id = p_course
     order by s.created_at;
end;
$$;

drop function if exists public.add_staff(uuid, text, text);
create or replace function public.add_staff(
  p_course     uuid,
  p_email      text,
  p_name       text,
  p_staff_role text default 'ta'
) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_email      text := lower(trim(coalesce(p_email, '')));
  v_uid        uuid;
  v_role       text;
  v_base       text;
  v_staff_role text := coalesce(nullif(trim(p_staff_role), ''), 'ta');
begin
  perform public.require_lecturer();
  if v_staff_role not in ('ta', 'co_lecturer', 'external_examiner') then
    raise exception 'Invalid staff role.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address.'; end if;
  if v_email = lower((select value from public.app_settings where key = 'lecturer_email')) then
    raise exception 'That is your own lecturer account.';
  end if;
  select value into v_base from public.app_settings where key = 'student_email_base';
  if split_part(v_email, '@', 2) = lower(split_part(v_base, '@', 2))
     and split_part(v_email, '@', 1) like lower(split_part(v_base, '@', 1)) || '+%' then
    raise exception 'That is a student sign-in address. Use the staff member''s own email.';
  end if;
  select u.id, p.role into v_uid, v_role from auth.users u left join public.profiles p on p.id = u.id
   where lower(u.email) = v_email;
  if v_uid is not null and coalesce(v_role, '') <> 'ta' then
    raise exception 'That email already belongs to another account on this site.';
  end if;
  insert into public.course_staff (course_id, email, full_name, user_id, staff_role)
  values (p_course, v_email, trim(coalesce(p_name, '')), v_uid, v_staff_role)
  on conflict (course_id, email) do update
    set full_name  = coalesce(nullif(excluded.full_name, ''), course_staff.full_name),
        staff_role = excluded.staff_role;
end;
$$;

create or replace function public.course_audit_log_list(p_course uuid, p_limit int default 150)
returns table (id uuid, actor_name text, actor_role text, action text, summary text, details jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_course(p_course) and not public.is_external_examiner(p_course) then
    raise exception 'Only course lecturers or external examiners can view the audit log.';
  end if;
  return query
    select l.id, l.actor_name, l.actor_role, l.action, l.summary, l.details, l.created_at
      from public.course_audit_logs l
     where l.course_id = p_course
     order by l.created_at desc
     limit greatest(1, least(coalesce(p_limit, 150), 500));
end;
$$;

-- ---------------------------------------------------------------------
-- Pack C2: Course Learning Outcomes (CLO / PLO) & Attainment Analytics
-- ---------------------------------------------------------------------
create table if not exists public.course_outcomes (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  code        text not null,
  plo_code    text not null default '',
  title       text not null,
  description text not null default '',
  target_pct  numeric not null default 60 check (target_pct between 0 and 100),
  created_at  timestamptz not null default now(),
  unique (course_id, code)
);

alter table public.course_outcomes enable row level security;

drop policy if exists staff_read_outcomes on public.course_outcomes;
create policy staff_read_outcomes on public.course_outcomes
  for select to authenticated
  using (public.is_staff(course_id));

drop policy if exists manage_outcomes on public.course_outcomes;
create policy manage_outcomes on public.course_outcomes
  for all to authenticated
  using (public.can_manage_course(course_id))
  with check (public.can_manage_course(course_id));

drop policy if exists student_read_outcomes on public.course_outcomes;
create policy student_read_outcomes on public.course_outcomes
  for select to authenticated
  using (public.is_enrolled(course_id));

create or replace function public.save_course_outcome(
  p_course      uuid,
  p_code        text,
  p_title       text,
  p_plo_code    text default '',
  p_description text default '',
  p_target_pct  numeric default 60,
  p_id          uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.can_manage_course(p_course) then
    raise exception 'Only lecturers can manage course learning outcomes.';
  end if;
  if v_code = '' or btrim(coalesce(p_title, '')) = '' then
    raise exception 'Outcome code and title are required.';
  end if;

  if p_id is not null then
    update public.course_outcomes
       set code        = v_code,
           plo_code    = upper(btrim(coalesce(p_plo_code, ''))),
           title       = btrim(p_title),
           description = btrim(coalesce(p_description, '')),
           target_pct  = greatest(0, least(100, coalesce(p_target_pct, 60)))
     where id = p_id and course_id = p_course
     returning id into v_id;
  else
    insert into public.course_outcomes (course_id, code, plo_code, title, description, target_pct)
    values (
      p_course, v_code, upper(btrim(coalesce(p_plo_code, ''))),
      btrim(p_title), btrim(coalesce(p_description, '')),
      greatest(0, least(100, coalesce(p_target_pct, 60)))
    )
    on conflict (course_id, code) do update
      set plo_code    = excluded.plo_code,
          title       = excluded.title,
          description = excluded.description,
          target_pct  = excluded.target_pct
    returning id into v_id;
  end if;

  perform public.log_course_audit(
    p_course,
    'clo_outcome_saved',
    format('Saved outcome %s: %s', v_code, btrim(p_title)),
    jsonb_build_object('outcome_id', v_id, 'code', v_code)
  );

  return v_id;
end;
$$;

create or replace function public.delete_course_outcome(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_course uuid;
begin
  select course_id into v_course from public.course_outcomes where id = p_id;
  if v_course is null then return; end if;
  if not public.can_manage_course(v_course) then
    raise exception 'Only lecturers can delete outcomes.';
  end if;
  delete from public.course_outcomes where id = p_id;
end;
$$;

create or replace function public.course_clo_attainment(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(p_course);

  return coalesce((
    with q_scores as (
      select upper(btrim(q.clo_code)) as clo_code,
             a.student_id,
             sum(coalesce(r.marks_awarded, 0)) as earned,
             sum(q.marks) as possible
        from public.responses r
        join public.attempts a on a.id = r.attempt_id
        join public.questions q on q.id = r.question_id
        join public.quizzes qz on qz.id = q.quiz_id
       where qz.course_id = p_course
         and qz.is_practice = false
         and a.status <> 'in_progress'
         and btrim(coalesce(q.clo_code, '')) <> ''
       group by upper(btrim(q.clo_code)), a.student_id
    ),
    a_scores as (
      select upper(btrim(ass.clo_code)) as clo_code,
             s.student_id,
             sum(s.marks) as earned,
             sum(ass.max_marks) as possible
        from public.submissions s
        join public.assignments ass on ass.id = s.assignment_id
       where ass.course_id = p_course
         and s.marks is not null
         and btrim(coalesce(ass.clo_code, '')) <> ''
       group by upper(btrim(ass.clo_code)), s.student_id
    ),
    combined as (
      select clo_code, student_id, sum(earned) as earned, sum(possible) as possible
        from (
          select * from q_scores
          union all
          select * from a_scores
        ) all_s
       group by clo_code, student_id
      having sum(possible) > 0
    )
    select jsonb_agg(jsonb_build_object(
      'id', co.id,
      'code', co.code,
      'plo_code', co.plo_code,
      'title', co.title,
      'description', co.description,
      'target_pct', co.target_pct,
      'question_count', (
        select count(*) from public.questions q
        join public.quizzes qz on qz.id = q.quiz_id
        where qz.course_id = p_course and upper(btrim(coalesce(q.clo_code, ''))) = upper(btrim(co.code))
      ),
      'assignment_count', (
        select count(*) from public.assignments ass
        where ass.course_id = p_course and upper(btrim(coalesce(ass.clo_code, ''))) = upper(btrim(co.code))
      ),
      'assessed_students', (
        select count(*) from combined c where c.clo_code = upper(btrim(co.code))
      ),
      'avg_pct', (
        select round(avg((c.earned / c.possible) * 100), 1)
          from combined c where c.clo_code = upper(btrim(co.code))
      ),
      'met_count', (
        select count(*) from combined c
         where c.clo_code = upper(btrim(co.code))
           and (c.earned / c.possible) * 100 >= co.target_pct
      )
    ) order by co.code)
    from public.course_outcomes co
   where co.course_id = p_course
  ), '[]'::jsonb);
end;
$$;

-- Function privileges for Section 18
do $$
declare f text;
begin
  foreach f in array array[
    'save_submission_annotations(uuid, jsonb)',
    'assignment_annotations_map(uuid)',
    'my_submission_annotations(uuid)',
    'save_submission_archive_texts(uuid, jsonb)',
    'past_similarity_texts(uuid, uuid)',
    'save_attempt_moderation(uuid, text, text)',
    'quiz_moderation_map(uuid)',
    'my_notifications(int)',
    'mark_notification_read(uuid)',
    'mark_all_notifications_read()',
    'save_push_subscription(text, text, text)',
    'remove_push_subscription(text)',
    'dispatch_deadline_reminders()',
    'course_module_gates(uuid)',
    'is_co_lecturer(uuid)',
    'is_external_examiner(uuid)',
    'can_manage_course(uuid)',
    'my_course_staff_role(uuid)',
    'my_staff_roles()',
    'course_staff_list(uuid)',
    'add_staff(uuid, text, text, text)',
    'course_audit_log_list(uuid, int)',
    'save_course_outcome(uuid, text, text, text, text, numeric, uuid)',
    'delete_course_outcome(uuid)',
    'course_clo_attainment(uuid)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
