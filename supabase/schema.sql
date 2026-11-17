-- =====================================================================
--  PSCM E-class — database setup for Supabase
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  It is safe to run again later (it updates things in place).
--
--  BEFORE RUNNING: edit the two settings in section 1.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Settings  (EDIT THESE TWO VALUES)
-- ---------------------------------------------------------------------
--  lecturer_email     : the email YOU will sign in with. The account
--                       created with this email becomes the lecturer.
--  student_email_base : a Gmail address set aside for the app (for
--                       example pscm.eclass.accounts@gmail.com). Student
--                       log-ins are stored behind the scenes as
--                       name+INDEXNUMBER@gmail.com. No email is ever sent
--                       to it; it only needs to be a real Gmail address.
--                       It must match VITE_STUDENT_EMAIL_BASE in the site.
create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);
insert into public.app_settings (key, value) values
  ('lecturer_email',     'YOUR-EMAIL@gmail.com'),
  ('student_email_base', 'YOUR-APP-ACCOUNT@gmail.com')
on conflict (key) do nothing;
-- To change a value later, run for example:
--   update public.app_settings set value = 'me@gmail.com' where key = 'lecturer_email';

alter table public.app_settings enable row level security;
-- (no policies: nobody can read or change settings through the website)

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  role       text not null check (role in ('student','lecturer')),
  full_name  text not null default '',
  index_no   text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.roster (
  index_no   text primary key,
  full_name  text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  title       text not null,
  description text not null default '',
  color       text not null default '#0E6B63',
  semester    text not null default '',
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.enrollments (
  course_id  uuid not null references public.courses on delete cascade,
  index_no   text not null references public.roster(index_no) on delete cascade on update cascade,
  created_at timestamptz not null default now(),
  primary key (course_id, index_no)
);
create index if not exists enrollments_index_idx on public.enrollments (index_no);

create table if not exists public.modules (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses on delete cascade,
  week_no    int,
  title      text not null,
  summary    text not null default '',
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists modules_course_idx on public.modules (course_id);

create table if not exists public.materials (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses on delete cascade,
  module_id    uuid references public.modules on delete cascade,
  kind         text not null check (kind in ('pdf','slides','video','link','doc','file')),
  title        text not null,
  url          text,
  storage_path text,
  size_bytes   bigint,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists materials_course_idx on public.materials (course_id);

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses on delete cascade,
  title      text not null,
  body       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists announcements_course_idx on public.announcements (course_id);

create table if not exists public.quizzes (
  id                uuid primary key default gen_random_uuid(),
  course_id         uuid not null references public.courses on delete cascade,
  title             text not null,
  instructions      text not null default '',
  reference         text not null default '',   -- formula sheet shown beside the questions
  opens_at          timestamptz,
  closes_at         timestamptz,
  duration_minutes  int not null default 30 check (duration_minutes > 0),
  max_attempts      int not null default 1 check (max_attempts > 0),
  is_practice       boolean not null default false, -- unlimited attempts, results shown immediately
  shuffle_questions boolean not null default true,
  shuffle_options   boolean not null default true,
  published         boolean not null default false,
  results_released  boolean not null default false,
  show_answers      boolean not null default false,
  created_at        timestamptz not null default now()
);
create index if not exists quizzes_course_idx on public.quizzes (course_id);

-- kind: mcq | truefalse | numeric | short | essay
-- options : [{"id":"a","text":"..."}]            (mcq / truefalse)
-- answer  : mcq/truefalse {"correct":"a"}
--           numeric (fixed) {"value": 829}
--           short {"accepted":["safety stock","buffer stock"]}
-- params  : numeric with per-student figures, e.g.
--           {"D":{"min":10000,"max":15000,"step":100}, "S":{"min":120,"max":240,"step":10}}
-- formula : e.g. sqrt(2*D*S/H)   (uses the params above)
create table if not exists public.questions (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references public.quizzes on delete cascade,
  position       int not null default 0,
  kind           text not null check (kind in ('mcq','truefalse','numeric','short','essay')),
  prompt         text not null,
  options        jsonb not null default '[]'::jsonb,
  answer         jsonb not null default '{}'::jsonb,
  params         jsonb not null default '{}'::jsonb,
  formula        text,
  unit           text not null default '',
  decimals       int not null default 2 check (decimals between 0 and 6),
  tolerance      numeric not null default 0 check (tolerance >= 0),
  tolerance_type text not null default 'abs' check (tolerance_type in ('abs','pct')),
  marks          numeric not null default 1 check (marks >= 0),
  explanation    text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists questions_quiz_idx on public.questions (quiz_id);

create table if not exists public.attempts (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references public.quizzes on delete cascade,
  student_id     uuid not null references public.profiles on delete cascade,
  attempt_no     int not null default 1,
  seed           int not null default floor(random() * 2147483647)::int,
  question_order uuid[] not null default '{}',
  started_at     timestamptz not null default now(),
  deadline_at    timestamptz not null,
  submitted_at   timestamptz,
  status         text not null default 'in_progress'
                   check (status in ('in_progress','needs_marking','marked')),
  score          numeric,
  max_score      numeric,
  unique (quiz_id, student_id, attempt_no)
);
create index if not exists attempts_quiz_idx on public.attempts (quiz_id);
create index if not exists attempts_student_idx on public.attempts (student_id);

create table if not exists public.responses (
  id            uuid primary key default gen_random_uuid(),
  attempt_id    uuid not null references public.attempts on delete cascade,
  question_id   uuid not null references public.questions on delete cascade,
  value         jsonb,
  is_correct    boolean,
  marks_awarded numeric,
  feedback      text,
  updated_at    timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create table if not exists public.assignments (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null references public.courses on delete cascade,
  title            text not null,
  instructions     text not null default '',
  due_at           timestamptz,
  max_marks        numeric not null default 100 check (max_marks > 0),
  allow_late       boolean not null default false,
  published        boolean not null default false,
  results_released boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists assignments_course_idx on public.assignments (course_id);

create table if not exists public.submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments on delete cascade,
  student_id    uuid not null references public.profiles on delete cascade,
  file_path     text not null,
  file_name     text not null default '',
  note          text not null default '',
  submitted_at  timestamptz not null default now(),
  is_late       boolean not null default false,
  marks         numeric,
  feedback      text not null default '',
  marked_at     timestamptz,
  unique (assignment_id, student_id)
);

-- Version 2 additions (safe to run on an existing database)
alter table public.roster   add column if not exists programme text not null default '';
alter table public.roster   add column if not exists stream    text not null default '';
alter table public.quizzes  add column if not exists lockdown     boolean not null default false;
alter table public.quizzes  add column if not exists max_exits    int not null default 0;
alter table public.quizzes  add column if not exists pool_size    int;
alter table public.quizzes  add column if not exists no_backtrack boolean not null default false;
alter table public.attempts add column if not exists exits         int not null default 0;
alter table public.attempts add column if not exists exit_log      jsonb not null default '[]'::jsonb;
alter table public.attempts add column if not exists devices       text[] not null default '{}';
alter table public.attempts add column if not exists current_index int not null default 0;

-- The programmes and streams you have defined (shared by all your courses).
create table if not exists public.group_options (
  kind       text not null check (kind in ('programme', 'stream')),
  name       text not null,
  created_at timestamptz not null default now(),
  primary key (kind, name)
);
insert into public.group_options (kind, name)
  select distinct 'programme', programme from public.roster where programme <> ''
  union
  select distinct 'stream', stream from public.roster where stream <> ''
on conflict do nothing;

-- Optional per-stream opening times. When a quiz has rows here, only the
-- listed streams can take it, each within its own window.
create table if not exists public.quiz_windows (
  quiz_id   uuid not null references public.quizzes on delete cascade,
  stream    text not null,
  opens_at  timestamptz,
  closes_at timestamptz,
  primary key (quiz_id, stream)
);

-- Version 5 additions
-- Special access: named students get their own window (and extra attempts).
-- A restricted quiz is visible only to the students listed here.
alter table public.quizzes add column if not exists restricted boolean not null default false;
create table if not exists public.quiz_access (
  quiz_id        uuid not null references public.quizzes on delete cascade,
  index_no       text not null references public.roster(index_no) on delete cascade on update cascade,
  opens_at       timestamptz,
  closes_at      timestamptz,
  extra_attempts int not null default 0 check (extra_attempts between 0 and 10),
  note           text not null default '',
  created_at     timestamptz not null default now(),
  primary key (quiz_id, index_no)
);

-- Teaching assistants, per course. They sign up with the email listed here.
create table if not exists public.course_staff (
  course_id  uuid not null references public.courses on delete cascade,
  email      text not null,
  full_name  text not null default '',
  user_id    uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  primary key (course_id, email)
);
-- Version 6: quiz times per class (programme + stream). '*' = any programme.
alter table public.quiz_windows add column if not exists programme text not null default '*';
alter table public.quiz_windows drop constraint if exists quiz_windows_pkey;
alter table public.quiz_windows add constraint quiz_windows_pkey primary key (quiz_id, programme, stream);

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('student', 'lecturer', 'ta'));
alter table public.responses   add column if not exists marked_by uuid references public.profiles on delete set null;
alter table public.submissions add column if not exists marked_by uuid references public.profiles on delete set null;

-- ---------------------------------------------------------------------
-- 3. Helper functions used by the security rules
-- ---------------------------------------------------------------------
create or replace function public.is_lecturer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'lecturer');
$$;

create or replace function public.my_index() returns text
language sql stable security definer set search_path = public as $$
  select index_no from public.profiles where id = auth.uid();
$$;

create or replace function public.is_enrolled(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.enrollments e
    join public.profiles p on p.index_no = e.index_no
    where e.course_id = p_course and p.id = auth.uid()
  );
$$;

-- Teaching assistant on this course?
create or replace function public.is_ta(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.course_staff where course_id = p_course and user_id = auth.uid());
$$;

create or replace function public.is_staff(p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_lecturer() or public.is_ta(p_course);
$$;

create or replace function public.is_ta_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'ta');
$$;

-- Is this student on any course the signed-in TA helps with?
create or replace function public.ta_sees_index(p_index text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.enrollments e join public.course_staff s on s.course_id = e.course_id
                  where e.index_no = p_index and s.user_id = auth.uid());
$$;

-- Can this student take this quiz? (special access, restricted quizzes, stream windows)
create or replace function public.quiz_open_to(p_quiz uuid, p_index text, p_stream text) returns boolean
language sql stable security definer set search_path = public as $$
  with st as (
    select coalesce((select programme from public.roster where index_no = p_index), '') as programme,
           coalesce(p_stream, (select stream from public.roster where index_no = p_index), '') as stream)
  select case
    when exists (select 1 from public.quiz_access a where a.quiz_id = p_quiz and a.index_no = p_index) then true
    when (select restricted from public.quizzes where id = p_quiz) then false
    when not exists (select 1 from public.quiz_windows w where w.quiz_id = p_quiz) then true
    else exists (select 1 from public.quiz_windows w, st
                  where w.quiz_id = p_quiz and lower(trim(w.stream)) = lower(trim(st.stream))
                    and (w.programme = '*' or lower(trim(w.programme)) = lower(trim(st.programme))))
  end;
$$;

create or replace function public.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.norm_index(p text) returns text
language sql immutable as $$
  select upper(regexp_replace(trim(coalesce(p, '')), '\s+', '', 'g'));
$$;

-- The hidden login address used for a student's index number.
create or replace function public.student_email(p_index text) returns text
language sql stable security definer set search_path = public as $$
  select lower(
           split_part(s.value, '@', 1) || '+' ||
           regexp_replace(lower(public.norm_index(p_index)), '[^a-z0-9]', '-', 'g') ||
           '@' || split_part(s.value, '@', 2))
  from public.app_settings s where s.key = 'student_email_base';
$$;

-- ---------------------------------------------------------------------
-- 4. New accounts: lecturer by email, students only if on a class list
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_lecturer text;
  v_index    text;
  v_name     text;
begin
  select value into v_lecturer from public.app_settings where key = 'lecturer_email';
  if lower(new.email) = lower(v_lecturer) then
    insert into public.profiles (id, role, full_name)
    values (new.id, 'lecturer', coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), 'Lecturer'))
    on conflict (id) do update set role = 'lecturer';
    return new;
  end if;

  -- teaching assistant invited by the lecturer
  if exists (select 1 from public.course_staff where email = lower(new.email)) then
    insert into public.profiles (id, role, full_name)
    values (new.id, 'ta', coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
                                   (select full_name from public.course_staff where email = lower(new.email) and full_name <> '' limit 1),
                                   'Teaching assistant'))
    on conflict (id) do nothing;
    update public.course_staff set user_id = new.id where email = lower(new.email);
    return new;
  end if;

  v_index := public.norm_index(new.raw_user_meta_data->>'index_no');
  if v_index = '' or lower(new.email) <> public.student_email(v_index) then
    raise exception 'Only students on a class list can create an account.';
  end if;

  select full_name into v_name from public.roster where index_no = v_index;
  if not found then
    raise exception 'Index number % is not on a class list.', v_index;
  end if;
  if exists (select 1 from public.profiles where index_no = v_index) then
    raise exception 'Index number % already has an account.', v_index;
  end if;

  insert into public.profiles (id, role, full_name, index_no)
  values (new.id, 'student', v_name, v_index);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Used by the teaching assistant sign-up page.
create or replace function public.check_staff_email(p_email text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.course_staff where email = lower(trim(coalesce(p_email, '')))) then 'not_found'
    when exists (select 1 from public.course_staff where email = lower(trim(p_email)) and user_id is not null) then 'active'
    else 'ok' end;
$$;

-- Used by the "Activate account" page before signing up.
create or replace function public.check_index(p_index text) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text := public.norm_index(p_index);
begin
  if v = '' then return 'not_found'; end if;
  if exists (select 1 from public.profiles where index_no = v) then return 'active'; end if;
  if exists (select 1 from public.roster where index_no = v) then return 'ok'; end if;
  return 'not_found';
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Security rules (row level security)
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.roster        enable row level security;
alter table public.courses       enable row level security;
alter table public.enrollments   enable row level security;
alter table public.modules       enable row level security;
alter table public.materials     enable row level security;
alter table public.announcements enable row level security;
alter table public.quizzes add column if not exists question_time_limit int default null;
alter table public.quizzes       enable row level security;
alter table public.questions     enable row level security;
alter table public.attempts      enable row level security;
alter table public.responses     enable row level security;
alter table public.assignments   enable row level security;
alter table public.submissions   enable row level security;
alter table public.quiz_windows  enable row level security;
alter table public.group_options enable row level security;

do $$
declare t text;
begin
  -- lecturer can do everything on every table
  foreach t in array array['profiles','roster','courses','enrollments','modules','materials',
                           'announcements','quizzes','questions','attempts','responses',
                           'assignments','submissions','quiz_windows','group_options'] loop
    execute format('drop policy if exists lecturer_all on public.%I', t);
    execute format('create policy lecturer_all on public.%I for all to authenticated
                    using (public.is_lecturer()) with check (public.is_lecturer())', t);
  end loop;
end $$;

drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists student_courses on public.courses;
create policy student_courses on public.courses for select to authenticated using (public.is_enrolled(id));

drop policy if exists student_enrollments on public.enrollments;
create policy student_enrollments on public.enrollments for select to authenticated
  using (index_no = public.my_index());

drop policy if exists student_modules on public.modules;
create policy student_modules on public.modules for select to authenticated using (public.is_enrolled(course_id));

drop policy if exists student_materials on public.materials;
create policy student_materials on public.materials for select to authenticated using (public.is_enrolled(course_id));

drop policy if exists student_announcements on public.announcements;
create policy student_announcements on public.announcements for select to authenticated using (public.is_enrolled(course_id));

drop policy if exists student_quizzes on public.quizzes;
create policy student_quizzes on public.quizzes for select to authenticated
  using (published and public.is_enrolled(course_id));

drop policy if exists student_assignments on public.assignments;
create policy student_assignments on public.assignments for select to authenticated
  using (published and public.is_enrolled(course_id));

-- questions, attempts, responses and submissions: students have NO direct
-- access. They go through the functions below, which never reveal answers.

-- ---------------------------------------------------------------------
-- 6. Per-student figures and formula marking
-- ---------------------------------------------------------------------
-- Picks each student's own values for a question, the same every time
-- for that attempt.
create or replace function public.gen_vars(p_seed int, p_question uuid, p_params jsonb) returns jsonb
language plpgsql immutable as $$
declare
  k text; spec jsonb; lo numeric; hi numeric; st numeric; n bigint; pick bigint;
  result jsonb := '{}'::jsonb;
begin
  if p_params is null or jsonb_typeof(p_params) <> 'object' then return result; end if;
  for k, spec in select key, value from jsonb_each(p_params) loop
    lo := coalesce((spec->>'min')::numeric, 0);
    hi := coalesce((spec->>'max')::numeric, lo);
    st := coalesce(nullif((spec->>'step')::numeric, 0), 1);
    if hi < lo then hi := lo; end if;
    n := floor((hi - lo) / st)::bigint + 1;
    pick := abs(hashtext(p_seed::text || ':' || p_question::text || ':' || k)::bigint) % n;
    result := result || jsonb_build_object(k, trim_scale(lo + st * pick));
  end loop;
  return result;
end;
$$;

-- Safely works out a formula such as sqrt(2*D*S/H) with the given values.
create or replace function public.eval_formula(p_formula text, p_vars jsonb) returns numeric
language plpgsql volatile as $$
declare
  expr text := coalesce(p_formula, '');
  chk  text;
  k    text;
  v    text;
  res  numeric;
begin
  if length(expr) = 0 or length(expr) > 500 then
    raise exception 'Formula is empty or too long';
  end if;
  for k in select key from jsonb_each(coalesce(p_vars, '{}'::jsonb)) order by length(key) desc loop
    if k !~ '^[A-Za-z_][A-Za-z0-9_]*$' then raise exception 'Bad variable name: %', k; end if;
    v := p_vars->>k;
    if v !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'Bad value for %', k; end if;
    expr := regexp_replace(expr, '\m' || k || '\M', '(' || v || ')', 'g');
  end loop;
  chk := regexp_replace(lower(expr), '\m(sqrt|ln|exp|abs|power|greatest|least|ceil|floor|log)\M', '', 'g');
  if chk !~ '^[0-9.+*/^(), -]*$' then
    raise exception 'The formula uses a name or symbol that is not allowed: %', p_formula;
  end if;
  -- make whole numbers decimal so that 1/2 is 0.5, not 0
  expr := regexp_replace(expr, '(^|[^0-9.])([0-9]+)(?![0-9.])', '\1\2.0', 'g');
  execute 'select (' || expr || ')::numeric' into res;
  return res;
end;
$$;

create or replace function public.parse_number(p jsonb) returns numeric
language plpgsql immutable as $$
declare t text;
begin
  if p is null then return null; end if;
  t := regexp_replace(coalesce(p #>> '{}', ''), '[,\s]', '', 'g');
  if t ~ '^-?([0-9]+\.?[0-9]*|\.[0-9]+)$' then return t::numeric; end if;
  return null;
end;
$$;

create or replace function public.norm_text(p text) returns text
language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

-- The correct numeric answer for a question in a given attempt.
create or replace function public.expected_value(p_question public.questions, p_seed int) returns numeric
language plpgsql volatile as $$
begin
  if coalesce(trim(p_question.formula), '') <> '' then
    return round(public.eval_formula(p_question.formula,
                 public.gen_vars(p_seed, p_question.id, p_question.params)), p_question.decimals);
  end if;
  return round((p_question.answer->>'value')::numeric, p_question.decimals);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Marking an attempt
-- ---------------------------------------------------------------------
create or replace function public.recalc_attempt(p_attempt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_pending int; v_score numeric; v_max numeric; v_order uuid[];
begin
  select question_order into v_order from public.attempts where id = p_attempt;
  select coalesce(sum(q.marks), 0) into v_max from public.questions q where q.id = any(v_order);
  select coalesce(sum(r.marks_awarded), 0), count(*) filter (where r.marks_awarded is null)
    into v_score, v_pending
    from public.responses r where r.attempt_id = p_attempt and r.question_id = any(v_order);
  update public.attempts
     set score = v_score, max_score = v_max,
         status = case when v_pending > 0 then 'needs_marking' else 'marked' end
   where id = p_attempt;
end;
$$;

create or replace function public.finalize_attempt(p_attempt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  a   public.attempts;
  q   public.questions;
  v   jsonb;
  ok  boolean;
  mk  numeric;
  fb  text;
  exp numeric;
  giv numeric;
  tol numeric;
  txt text;
begin
  select * into a from public.attempts where id = p_attempt for update;
  if not found or a.status <> 'in_progress' then return; end if;

  for q in select * from public.questions where id = any(a.question_order) loop
    select r.value into v from public.responses r where r.attempt_id = a.id and r.question_id = q.id;
    ok := null; mk := null; fb := null;
    txt := case when v is null then '' else coalesce(v #>> '{}', '') end;

    if q.kind in ('mcq', 'truefalse') then
      ok := txt <> '' and txt = coalesce(q.answer->>'correct', '');
      mk := case when ok then q.marks else 0 end;

    elsif q.kind = 'numeric' then
      begin
        exp := public.expected_value(q, a.seed);
        giv := public.parse_number(v);
        tol := case when q.tolerance_type = 'pct' then abs(exp) * q.tolerance / 100 else q.tolerance end;
        ok := giv is not null and abs(giv - exp) <= tol + 0.0000001;
        mk := case when ok then q.marks else 0 end;
      exception when others then
        ok := false; mk := 0; fb := 'This question could not be marked automatically. Your lecturer will check it.';
      end;

    elsif q.kind = 'short' then
      ok := txt <> '' and exists (
        select 1 from jsonb_array_elements_text(coalesce(q.answer->'accepted', '[]'::jsonb)) acc
        where public.norm_text(acc) = public.norm_text(txt));
      mk := case when ok then q.marks else 0 end;

    else -- essay: needs the lecturer, unless left blank
      if trim(txt) = '' then ok := false; mk := 0; end if;
    end if;

    insert into public.responses (attempt_id, question_id, value, is_correct, marks_awarded, feedback)
    values (a.id, q.id, v, ok, mk, fb)
    on conflict (attempt_id, question_id)
    do update set is_correct = excluded.is_correct, marks_awarded = excluded.marks_awarded,
                  feedback = coalesce(excluded.feedback, public.responses.feedback);
  end loop;

  update public.attempts
     set submitted_at = least(now(), deadline_at), status = 'marked'
   where id = a.id;
  perform public.recalc_attempt(a.id);
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Quiz functions for students
-- ---------------------------------------------------------------------
-- Which window applies to a student for a quiz (their stream's, or the quiz's own).
create or replace function public.quiz_window_for(p_quiz uuid, p_uid uuid)
returns table (allowed boolean, opens_at timestamptz, closes_at timestamptz)
language sql stable security definer set search_path = public as $$
  with st as (
    select r.index_no, r.stream, r.programme from public.roster r join public.profiles p on p.index_no = r.index_no where p.id = p_uid
  ), acc as (
    select x.* from public.quiz_access x, st where x.quiz_id = p_quiz and x.index_no = st.index_no
  ), mine as (
    -- a row for the student's own class wins over a row for their whole stream
    select w.* from public.quiz_windows w, st
     where w.quiz_id = p_quiz and lower(trim(w.stream)) = lower(trim(st.stream))
       and (w.programme = '*' or lower(trim(w.programme)) = lower(trim(st.programme)))
     order by (w.programme = '*') limit 1
  ), n as (select count(*) as c from public.quiz_windows where quiz_id = p_quiz),
  base as (
    select case when q.restricted then false when n.c = 0 then true else exists (select 1 from mine) end as allowed,
           case when n.c = 0 then q.opens_at  else (select m.opens_at  from mine m limit 1) end as opens_at,
           case when n.c = 0 then q.closes_at else (select m.closes_at from mine m limit 1) end as closes_at
      from public.quizzes q, n where q.id = p_quiz)
  select case when exists (select 1 from acc) then true else b.allowed end,
         case when exists (select 1 from acc) then coalesce((select a.opens_at from acc a), b.opens_at) else b.opens_at end,
         case when exists (select 1 from acc) then coalesce((select a.closes_at from acc a), b.closes_at) else b.closes_at end
    from base b;
$$;

create or replace function public.start_attempt(p_quiz uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  qz       public.quizzes;
  a        public.attempts;
  w        record;
  n        int;
  v_order  uuid[];
  v_dead   timestamptz;
  v_id     uuid;
begin
  select * into qz from public.quizzes where id = p_quiz;
  if not found or not qz.published or not public.is_enrolled(qz.course_id) then
    raise exception 'This quiz is not available to you.';
  end if;
  select * into w from public.quiz_window_for(p_quiz, auth.uid());
  if not w.allowed then
    raise exception 'This quiz is not open to you.';
  end if;

  select * into a from public.attempts
   where quiz_id = p_quiz and student_id = auth.uid() and status = 'in_progress'
   order by attempt_no desc limit 1;
  if found then
    if now() <= a.deadline_at then return a.id; end if;
    perform public.finalize_attempt(a.id);
  end if;

  if w.opens_at is not null and now() < w.opens_at then
    raise exception 'This quiz has not opened yet.';
  end if;
  if w.closes_at is not null and now() > w.closes_at then
    raise exception 'This quiz has closed.';
  end if;

  select count(*) into n from public.attempts where quiz_id = p_quiz and student_id = auth.uid();
  if not qz.is_practice and n >= qz.max_attempts + coalesce((select x.extra_attempts from public.quiz_access x
                                                              where x.quiz_id = p_quiz and x.index_no = public.my_index()), 0) then
    raise exception 'You have used all your attempts for this quiz.';
  end if;

  -- Stratified format quotas if defined in quiz instructions metadata (e.g. <!-- QUIZ_META:{"format_quotas_enabled":true,...} -->)
  if qz.instructions ~ '<!-- QUIZ_META:(.*?)-->' then
    declare
      v_meta jsonb;
      q_mcq int; q_tf int; q_num int; q_short int; q_essay int;
    begin
      v_meta := (regexp_match(qz.instructions, '<!-- QUIZ_META:(.*?)-->'))[1]::jsonb;
      if (v_meta->>'format_quotas_enabled')::boolean = true and v_meta ? 'format_quotas' then
        q_mcq   := coalesce(nullif(v_meta->'format_quotas'->>'mcq', '')::int, 0);
        q_tf    := coalesce(nullif(v_meta->'format_quotas'->>'truefalse', '')::int, 0);
        q_num   := coalesce(nullif(v_meta->'format_quotas'->>'numeric', '')::int, 0);
        q_short := coalesce(nullif(v_meta->'format_quotas'->>'short', '')::int, 0);
        q_essay := coalesce(nullif(v_meta->'format_quotas'->>'essay', '')::int, 0);
        if (q_mcq + q_tf + q_num + q_short + q_essay) > 0 then
          select array_agg(x.id order by case when qz.shuffle_questions then random() else 0 end, x.position, x.created_at)
            into v_order
            from (
              (select id, position, created_at from public.questions where quiz_id = p_quiz and kind = 'mcq' order by random() limit nullif(q_mcq, 0))
              union all
              (select id, position, created_at from public.questions where quiz_id = p_quiz and kind = 'truefalse' order by random() limit nullif(q_tf, 0))
              union all
              (select id, position, created_at from public.questions where quiz_id = p_quiz and kind = 'numeric' order by random() limit nullif(q_num, 0))
              union all
              (select id, position, created_at from public.questions where quiz_id = p_quiz and kind = 'short' order by random() limit nullif(q_short, 0))
              union all
              (select id, position, created_at from public.questions where quiz_id = p_quiz and kind = 'essay' order by random() limit nullif(q_essay, 0))
            ) x;
        end if;
      end if;
    exception when others then
      v_order := null;
    end;
  end if;

  if v_order is null then
    -- pick the questions (a random subset when a pool size is set), then order them
    select array_agg(x.id order by case when qz.shuffle_questions then random() else 0 end, x.position, x.created_at)
      into v_order
      from (select id, position, created_at from public.questions
             where quiz_id = p_quiz
             order by random()
             limit coalesce(nullif(qz.pool_size, 0), 100000)) x;
  end if;
  if v_order is null then raise exception 'This quiz has no questions yet.'; end if;

  v_dead := now() + make_interval(mins => qz.duration_minutes);
  if w.closes_at is not null and w.closes_at < v_dead then v_dead := w.closes_at; end if;

  insert into public.attempts (quiz_id, student_id, attempt_no, question_order, deadline_at)
  values (p_quiz, auth.uid(), n + 1, v_order, v_dead)
  returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.get_attempt(uuid);
create or replace function public.get_attempt(p_attempt uuid, p_device text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.attempts; qz public.quizzes; c public.courses; pr public.profiles; qs jsonb;
begin
  select * into a from public.attempts where id = p_attempt and student_id = auth.uid();
  if not found then raise exception 'Attempt not found.'; end if;
  if a.status = 'in_progress' and now() > a.deadline_at then
    perform public.finalize_attempt(a.id);
    select * into a from public.attempts where id = p_attempt;
  end if;
  if a.status = 'in_progress' and coalesce(p_device, '') <> '' and not (left(p_device, 80) = any(a.devices)) then
    update public.attempts set devices = array_append(devices, left(p_device, 80)) where id = a.id
    returning * into a;
  end if;
  select * into qz from public.quizzes where id = a.quiz_id;
  select * into c from public.courses where id = qz.course_id;
  select * into pr from public.profiles where id = auth.uid();

  select jsonb_agg(jsonb_build_object(
           'id', q.id,
           'kind', q.kind,
           'prompt', q.prompt,
           'marks', q.marks,
           'unit', q.unit,
           'decimals', q.decimals,
           'vars', case when coalesce(trim(q.formula), '') <> ''
                        then public.gen_vars(a.seed, q.id, q.params) else '{}'::jsonb end,
           'options', case
              when q.kind = 'mcq' and qz.shuffle_options then
                (select coalesce(jsonb_agg(o order by md5(a.seed::text || q.id::text || (o->>'id'))), '[]'::jsonb)
                   from jsonb_array_elements(q.options) o)
              when q.kind in ('mcq', 'truefalse') then q.options
              else '[]'::jsonb end,
           'value', r.value)
         order by o.ord)
    into qs
    from unnest(a.question_order) with ordinality as o(qid, ord)
    join public.questions q on q.id = o.qid
    left join public.responses r on r.attempt_id = a.id and r.question_id = q.id;

  return jsonb_build_object(
    'attempt', jsonb_build_object('id', a.id, 'status', a.status, 'started_at', a.started_at,
                                  'deadline_at', a.deadline_at, 'submitted_at', a.submitted_at,
                                  'server_now', now(), 'exits', a.exits, 'current_index', a.current_index),
    'quiz', jsonb_build_object('id', qz.id, 'title', qz.title, 'instructions', qz.instructions,
                               'reference', qz.reference, 'course_id', c.id, 'course_code', c.code,
                               'course_color', c.color, 'lockdown', qz.lockdown,
                               'max_exits', qz.max_exits, 'no_backtrack', qz.no_backtrack, 'question_time_limit', qz.question_time_limit),
    'student', jsonb_build_object('name', pr.full_name, 'index_no', pr.index_no),
    'questions', coalesce(qs, '[]'::jsonb));
end;
$$;

create or replace function public.save_response(p_attempt uuid, p_question uuid, p_value jsonb)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare a public.attempts; v_back boolean;
begin
  select * into a from public.attempts where id = p_attempt and student_id = auth.uid();
  if not found then raise exception 'Attempt not found.'; end if;
  if a.status <> 'in_progress' or now() > a.deadline_at + interval '20 seconds' then
    raise exception 'Time is up — this attempt can no longer be changed.';
  end if;
  if not (p_question = any(a.question_order)) then raise exception 'Question not in this attempt.'; end if;
  if length(coalesce(p_value::text, '')) > 20000 then raise exception 'Answer is too long.'; end if;
  select no_backtrack into v_back from public.quizzes where id = a.quiz_id;
  if v_back and array_position(a.question_order, p_question) < a.current_index + 1 then
    raise exception 'This question is locked — you have already moved past it.';
  end if;

  insert into public.responses (attempt_id, question_id, value, updated_at)
  values (p_attempt, p_question, p_value, now())
  on conflict (attempt_id, question_id) do update set value = excluded.value, updated_at = now();
  return now();
end;
$$;

-- Records that the student moved on (used when going back is not allowed).
create or replace function public.advance_attempt(p_attempt uuid, p_index int) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update public.attempts set current_index = greatest(current_index, least(p_index, coalesce(array_length(question_order, 1), 1) - 1))
   where id = p_attempt and student_id = auth.uid() and status = 'in_progress'
   returning current_index into v;
  return v;
end;
$$;

-- Records the student leaving the quiz screen; may submit the attempt.
create or replace function public.log_exit(p_attempt uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.attempts; qz public.quizzes; v_last timestamptz;
begin
  select * into a from public.attempts where id = p_attempt and student_id = auth.uid();
  if not found then raise exception 'Attempt not found.'; end if;
  select * into qz from public.quizzes where id = a.quiz_id;
  if a.status <> 'in_progress' then
    return jsonb_build_object('exits', a.exits, 'max_exits', qz.max_exits, 'submitted', true);
  end if;
  v_last := (a.exit_log -> -1 ->> 'at')::timestamptz;
  if v_last is null or now() - v_last > interval '2 seconds' then
    update public.attempts
       set exits = exits + 1,
           exit_log = exit_log || jsonb_build_array(jsonb_build_object('at', now(), 'kind', left(coalesce(p_kind, ''), 30)))
     where id = a.id
    returning * into a;
  end if;
  if qz.lockdown and qz.max_exits > 0 and a.exits >= qz.max_exits then
    perform public.finalize_attempt(a.id);
    return jsonb_build_object('exits', a.exits, 'max_exits', qz.max_exits, 'submitted', true);
  end if;
  return jsonb_build_object('exits', a.exits, 'max_exits', qz.max_exits, 'submitted', false);
end;
$$;

create or replace function public.submit_attempt(p_attempt uuid) returns text
language plpgsql security definer set search_path = public as $$
declare a public.attempts;
begin
  select * into a from public.attempts where id = p_attempt and student_id = auth.uid();
  if not found then raise exception 'Attempt not found.'; end if;
  perform public.finalize_attempt(p_attempt);
  select status into a.status from public.attempts where id = p_attempt;
  return a.status;
end;
$$;

-- Quiz list for the course page: attempts used and (when released) scores.
create or replace function public.my_quizzes(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_enrolled(p_course) then return '[]'::jsonb; end if;
  -- close any attempt whose time has run out
  perform public.finalize_attempt(a.id)
     from public.attempts a join public.quizzes q on q.id = a.quiz_id
    where q.course_id = p_course and a.student_id = auth.uid()
      and a.status = 'in_progress' and a.deadline_at < now();

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'title', q.title, 'instructions', q.instructions,
           'opens_at', w.opens_at, 'closes_at', w.closes_at,
           'duration_minutes', q.duration_minutes,
           'max_attempts', q.max_attempts + coalesce((select x.extra_attempts from public.quiz_access x
                                                      where x.quiz_id = q.id and x.index_no = public.my_index()), 0),
           'is_practice', q.is_practice, 'lockdown', q.lockdown, 'max_exits', q.max_exits,
           'no_backtrack', q.no_backtrack,
           'question_count', least((select count(*) from public.questions x where x.quiz_id = q.id),
                                   coalesce(nullif(q.pool_size, 0), 100000)),
           'total_marks', case when coalesce(q.pool_size, 0) > 0 then null
                               else (select coalesce(sum(marks), 0) from public.questions x where x.quiz_id = q.id) end,
           'attempts_used', (select count(*) from public.attempts a where a.quiz_id = q.id and a.student_id = auth.uid()),
           'in_progress', (select a.id from public.attempts a where a.quiz_id = q.id and a.student_id = auth.uid()
                             and a.status = 'in_progress' order by attempt_no desc limit 1),
           'released', (q.results_released or q.is_practice),
           'best', (select jsonb_build_object('attempt_id', a.id, 'status', a.status,
                             'score', case when q.results_released or q.is_practice then a.score end,
                             'max_score', a.max_score, 'submitted_at', a.submitted_at)
                      from public.attempts a
                     where a.quiz_id = q.id and a.student_id = auth.uid() and a.status <> 'in_progress'
                     order by a.score desc nulls last, a.submitted_at desc limit 1))
         order by coalesce(w.opens_at, q.created_at)), '[]'::jsonb)
    into r
    from public.quizzes q
    cross join lateral public.quiz_window_for(q.id, auth.uid()) w
   where q.course_id = p_course and q.published and w.allowed;
  return r;
end;
$$;

-- Review of a finished attempt (only when results are released).
create or replace function public.get_attempt_review(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.attempts; qz public.quizzes; qs jsonb; v_show boolean;
begin
  select * into a from public.attempts where id = p_attempt and student_id = auth.uid();
  if not found then raise exception 'Attempt not found.'; end if;
  select * into qz from public.quizzes where id = a.quiz_id;
  if a.status = 'in_progress' then raise exception 'This attempt is still in progress.'; end if;
  if not (qz.results_released or qz.is_practice) then
    raise exception 'Results for this quiz have not been released yet.';
  end if;
  v_show := qz.show_answers or qz.is_practice;

  select jsonb_agg(jsonb_build_object(
           'id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'marks', q.marks, 'unit', q.unit,
           'vars', case when coalesce(trim(q.formula), '') <> ''
                        then public.gen_vars(a.seed, q.id, q.params) else '{}'::jsonb end,
           'options', case when q.kind in ('mcq','truefalse') then q.options else '[]'::jsonb end,
           'value', r.value, 'is_correct', r.is_correct, 'marks_awarded', r.marks_awarded,
           'feedback', r.feedback,
           'correct', case when not v_show then null
                           when q.kind in ('mcq','truefalse') then q.answer->'correct'
                           when q.kind = 'short' then q.answer->'accepted'
                           when q.kind = 'numeric' then
                             (select to_jsonb(public.expected_value(q, a.seed)))
                           else null end,
           'explanation', case when v_show then q.explanation else '' end)
         order by o.ord)
    into qs
    from unnest(a.question_order) with ordinality as o(qid, ord)
    join public.questions q on q.id = o.qid
    left join public.responses r on r.attempt_id = a.id and r.question_id = q.id;

  return jsonb_build_object('title', qz.title, 'score', a.score, 'max_score', a.max_score,
                            'status', a.status, 'questions', coalesce(qs, '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Assignment functions for students
-- ---------------------------------------------------------------------
create or replace function public.can_submit(p_assignment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.assignments x
     where x.id = p_assignment and x.published and public.is_enrolled(x.course_id)
       and (x.due_at is null or now() <= x.due_at or x.allow_late)
       and not exists (select 1 from public.submissions s
                        where s.assignment_id = x.id and s.student_id = auth.uid() and s.marks is not null));
$$;

create or replace function public.submit_assignment(p_assignment uuid, p_path text, p_name text, p_note text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare x public.assignments;
begin
  if not public.can_submit(p_assignment) then
    raise exception 'This assignment is closed or has already been marked.';
  end if;
  if p_path is null or regexp_replace(p_path, '^r2:', '') not like p_assignment::text || '/' || auth.uid()::text || '/%' then
    raise exception 'Upload location is not valid.';
  end if;
  select * into x from public.assignments where id = p_assignment;
  insert into public.submissions (assignment_id, student_id, file_path, file_name, note, submitted_at, is_late)
  values (p_assignment, auth.uid(), p_path, coalesce(p_name, ''), coalesce(p_note, ''), now(),
          x.due_at is not null and now() > x.due_at)
  on conflict (assignment_id, student_id) do update
     set file_path = excluded.file_path, file_name = excluded.file_name, note = excluded.note,
         submitted_at = now(), is_late = excluded.is_late;
  return now();
end;
$$;

create or replace function public.my_assignments(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_enrolled(p_course) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'title', x.title, 'instructions', x.instructions, 'due_at', x.due_at,
           'max_marks', x.max_marks, 'allow_late', x.allow_late,
           'released', x.results_released,
           'submission', (select jsonb_build_object(
                                 'file_name', s.file_name, 'file_path', s.file_path,
                                 'submitted_at', s.submitted_at, 'is_late', s.is_late,
                                 'marked', s.marks is not null,
                                 'marks', case when x.results_released then s.marks end,
                                 'feedback', case when x.results_released then s.feedback end)
                            from public.submissions s
                           where s.assignment_id = x.id and s.student_id = auth.uid()))
         order by x.due_at nulls last, x.created_at), '[]'::jsonb)
    into r
    from public.assignments x
   where x.course_id = p_course and x.published;
  return r;
end;
$$;

-- Everything due soon across all of a student's courses (home page).
create or replace function public.my_upcoming() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t.due), '[]'::jsonb) from (
    select 'quiz' as kind, q.id, q.title, c.id as course_id, c.code as course_code, c.color,
           case when w.opens_at > now() then w.opens_at else coalesce(w.closes_at, now()) end as due,
           w.opens_at, w.closes_at, q.duration_minutes,
           least((select count(*) from public.questions x where x.quiz_id = q.id),
                 coalesce(nullif(q.pool_size, 0), 100000)) as question_count
      from public.quizzes q join public.courses c on c.id = q.course_id
      cross join lateral public.quiz_window_for(q.id, auth.uid()) w
     where q.published and not q.is_practice and public.is_enrolled(c.id) and w.allowed
       and (w.closes_at is null or w.closes_at > now())
       and not exists (select 1 from public.attempts a where a.quiz_id = q.id
                         and a.student_id = auth.uid() and a.status <> 'in_progress')
    union all
    select 'assignment', x.id, x.title, c.id, c.code, c.color, x.due_at, null, x.due_at, null, null
      from public.assignments x join public.courses c on c.id = x.course_id
     where x.published and public.is_enrolled(c.id) and x.due_at > now()
       and not exists (select 1 from public.submissions s where s.assignment_id = x.id and s.student_id = auth.uid())
  ) t;
$$;

-- ---------------------------------------------------------------------
-- 10. Lecturer functions
-- ---------------------------------------------------------------------
create or replace function public.require_lecturer() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_lecturer() then raise exception 'Only the lecturer can do this.'; end if;
end;
$$;

-- Lecturer, or a teaching assistant on this course.
create or replace function public.require_staff(p_course uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_course is null or not public.is_staff(p_course) then
    raise exception 'You do not have access to this course.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Staff & TA Activity Audit Log
-- ---------------------------------------------------------------------
create table if not exists public.course_audit_logs (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses on delete cascade,
  actor_id   uuid references public.profiles on delete set null,
  actor_name text not null default '',
  actor_role text not null default '',
  action     text not null,
  summary    text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists course_audit_logs_course_idx on public.course_audit_logs (course_id, created_at desc);

alter table public.course_audit_logs enable row level security;
drop policy if exists lecturer_all on public.course_audit_logs;
create policy lecturer_all on public.course_audit_logs for all to authenticated
  using (public.is_lecturer()) with check (public.is_lecturer());

create or replace function public.log_course_audit(p_course uuid, p_action text, p_summary text, p_details jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text; v_role text; v_resolved_role text;
begin
  if p_course is null then return; end if;
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  if nullif(trim(coalesce(v_name, '')), '') is null then
    select nullif(trim(full_name), '') into v_name
      from public.course_staff
     where course_id = p_course and user_id = auth.uid()
     limit 1;
  end if;
  v_resolved_role := case
    when v_role in ('ta', 'lecturer') then v_role
    when public.is_ta(p_course) then 'ta'
    when public.is_lecturer() then 'lecturer'
    else 'staff'
  end;
  insert into public.course_audit_logs (course_id, actor_id, actor_name, actor_role, action, summary, details)
  values (p_course, auth.uid(), coalesce(nullif(trim(v_name), ''), 'Staff'), v_resolved_role, p_action, p_summary, coalesce(p_details, '{}'::jsonb));
exception when others then
  null;
end;
$$;

create or replace function public.log_course_action(p_course uuid, p_action text, p_summary text, p_details jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(p_course);
  perform public.log_course_audit(p_course, p_action, p_summary, p_details);
end;
$$;

create or replace function public.course_audit_log_list(p_course uuid, p_limit int default 150)
returns table (id uuid, actor_name text, actor_role text, action text, summary text, details jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_lecturer();
  return query
    select l.id, l.actor_name, l.actor_role, l.action, l.summary, l.details, l.created_at
      from public.course_audit_logs l
     where l.course_id = p_course
     order by l.created_at desc
     limit greatest(1, least(coalesce(p_limit, 150), 500));
end;
$$;

-- Add or update students on a course from a class list (lecturer or course TA).
-- p_rows: [{"index_no":"4021180","full_name":"Kofi Mensah"}, ...]
create or replace function public.import_roster(p_course uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_idx text; v_name text; v_prog text; v_stream text;
        n_new int := 0; n_enrolled int := 0; n_skipped int := 0;
        v_indexes text[] := '{}'; v_summary text;
begin
  perform public.require_staff(p_course);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_idx := public.norm_index(r->>'index_no');
    v_name := trim(coalesce(r->>'full_name', ''));
    v_prog := trim(coalesce(r->>'programme', ''));
    v_stream := trim(coalesce(r->>'stream', ''));
    if v_idx = '' then n_skipped := n_skipped + 1; continue; end if;
    if cardinality(v_indexes) < 5 then
      v_indexes := array_append(v_indexes, v_idx);
    end if;
    if not exists (select 1 from public.roster where index_no = v_idx) then
      insert into public.roster (index_no, full_name, programme, stream)
      values (v_idx, coalesce(nullif(v_name, ''), v_idx), v_prog, v_stream);
      n_new := n_new + 1;
    else
      update public.roster
         set full_name = coalesce(nullif(v_name, ''), full_name),
             programme = coalesce(nullif(v_prog, ''), programme),
             stream    = coalesce(nullif(v_stream, ''), stream)
       where index_no = v_idx;
      if v_name <> '' then update public.profiles set full_name = v_name where index_no = v_idx; end if;
    end if;
    insert into public.enrollments (course_id, index_no) values (p_course, v_idx)
    on conflict do nothing;
    if found then n_enrolled := n_enrolled + 1; end if;
    if v_prog <> '' then insert into public.group_options values ('programme', v_prog) on conflict do nothing; end if;
    if v_stream <> '' then insert into public.group_options values ('stream', v_stream) on conflict do nothing; end if;
  end loop;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 0 then
    v_summary := case
      when cardinality(v_indexes) > 0 and jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) <= 5 then
        format('Added/updated %s student%s (%s) — %s new, %s enrolled',
               jsonb_array_length(coalesce(p_rows, '[]'::jsonb)),
               case when jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 1 then '' else 's' end,
               array_to_string(v_indexes, ', '),
               n_new, n_enrolled)
      else
        format('Added/updated class list (%s rows: %s new, %s enrolled)',
               jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), n_new, n_enrolled)
    end;
    perform public.log_course_audit(
      p_course,
      'roster_import',
      v_summary,
      jsonb_build_object('new_students', n_new, 'enrolled', n_enrolled, 'rows', jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 'indexes', to_jsonb(v_indexes))
    );
  end if;
  return jsonb_build_object('new_students', n_new, 'enrolled', n_enrolled, 'skipped', n_skipped);
end;
$$;

-- The programmes and streams present on a course's class list.
create or replace function public.course_groups(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(p_course);
  return jsonb_build_object(
    'programmes', coalesce((select jsonb_agg(distinct r.programme order by r.programme) from public.enrollments e
                              join public.roster r on r.index_no = e.index_no
                             where e.course_id = p_course and r.programme <> ''), '[]'::jsonb),
    'streams', coalesce((select jsonb_agg(distinct r.stream order by r.stream) from public.enrollments e
                           join public.roster r on r.index_no = e.index_no
                          where e.course_id = p_course and r.stream <> ''), '[]'::jsonb));
end;
$$;

-- Lecturer corrects one student's details.
create or replace function public.update_student(p_index text, p_name text, p_programme text, p_stream text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_lecturer();
  update public.roster
     set full_name = coalesce(nullif(trim(p_name), ''), full_name),
         programme = trim(coalesce(p_programme, '')),
         stream = trim(coalesce(p_stream, ''))
   where index_no = public.norm_index(p_index);
  update public.profiles set full_name = coalesce(nullif(trim(p_name), ''), full_name)
   where index_no = public.norm_index(p_index);
  if trim(coalesce(p_programme, '')) <> '' then
    insert into public.group_options values ('programme', trim(p_programme)) on conflict do nothing;
  end if;
  if trim(coalesce(p_stream, '')) <> '' then
    insert into public.group_options values ('stream', trim(p_stream)) on conflict do nothing;
  end if;
end;
$$;

-- Put many students into a programme and/or stream at once.
-- Pass null to leave a field unchanged, '' to clear it.
create or replace function public.assign_group(p_indexes text[], p_programme text, p_stream text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require_lecturer();
  update public.roster
     set programme = coalesce(trim(p_programme), programme),
         stream    = coalesce(trim(p_stream), stream)
   where index_no = any(p_indexes);
  get diagnostics n = row_count;
  if trim(coalesce(p_programme, '')) <> '' then
    insert into public.group_options values ('programme', trim(p_programme)) on conflict do nothing;
  end if;
  if trim(coalesce(p_stream, '')) <> '' then
    insert into public.group_options values ('stream', trim(p_stream)) on conflict do nothing;
  end if;
  return n;
end;
$$;

-- Rename a programme or stream everywhere it is used.
create or replace function public.rename_group(p_kind text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := trim(coalesce(p_new, ''));
begin
  perform public.require_lecturer();
  if v = '' then raise exception 'Enter a name.'; end if;
  if p_kind = 'programme' then
    update public.roster set programme = v where programme = p_old;
    update public.quiz_windows w set programme = v
     where w.programme = p_old
       and not exists (select 1 from public.quiz_windows x where x.quiz_id = w.quiz_id and x.programme = v and x.stream = w.stream);
    delete from public.quiz_windows where programme = p_old;
  elsif p_kind = 'stream' then
    update public.roster set stream = v where stream = p_old;
    update public.quiz_windows w set stream = v
     where w.stream = p_old
       and not exists (select 1 from public.quiz_windows x where x.quiz_id = w.quiz_id and x.programme = w.programme and x.stream = v);
    delete from public.quiz_windows where stream = p_old;
  else
    raise exception 'Unknown group type.';
  end if;
  delete from public.group_options where kind = p_kind and name = p_old;
  insert into public.group_options values (p_kind, v) on conflict do nothing;
end;
$$;

-- Remove a programme or stream; students in it become "not set".
create or replace function public.delete_group(p_kind text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_lecturer();
  if p_kind = 'programme' then
    update public.roster set programme = '' where programme = p_name;
    delete from public.quiz_windows where programme = p_name;
  elsif p_kind = 'stream' then
    update public.roster set stream = '' where stream = p_name;
    delete from public.quiz_windows where stream = p_name;
  end if;
  delete from public.group_options where kind = p_kind and name = p_name;
end;
$$;

drop function if exists public.course_students(uuid);
create or replace function public.course_students(p_course uuid)
returns table (index_no text, full_name text, programme text, stream text, activated boolean, last_sign_in timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.require_staff(p_course);
  return query
    select r.index_no, r.full_name, r.programme, r.stream, p.id is not null, u.last_sign_in_at
      from public.enrollments e
      join public.roster r on r.index_no = e.index_no
      left join public.profiles p on p.index_no = r.index_no
      left join auth.users u on u.id = p.id
     where e.course_id = p_course
     order by r.full_name, r.index_no;
end;
$$;

create or replace function public.reset_student_password(p_index text, p_password text) returns boolean
language plpgsql security definer set search_path = public, extensions, auth as $$
declare v_id uuid;
begin
  if not (public.is_lecturer() or public.ta_sees_index(public.norm_index(p_index))) then
    raise exception 'Only the lecturer or the course TA can do this.';
  end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters.'; end if;
  select id into v_id from public.profiles where index_no = public.norm_index(p_index);
  if v_id is null then raise exception 'That student has not activated an account yet.'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
                        updated_at = now()
   where id = v_id;
  perform public.log_course_audit(e.course_id, 'password_reset', format('Reset password for student %s', public.norm_index(p_index)), jsonb_build_object('index_no', public.norm_index(p_index)))
    from public.enrollments e
   where e.index_no = public.norm_index(p_index) and public.is_staff(e.course_id);
  return true;
end;
$$;

create or replace function public.finalize_expired(p_quiz uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; a record;
begin
  perform public.require_staff((select course_id from public.quizzes where id = p_quiz));
  for a in select id from public.attempts
            where quiz_id = p_quiz and status = 'in_progress' and deadline_at < now() loop
    perform public.finalize_attempt(a.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- One row per enrolled student: their best finished attempt.
drop function if exists public.quiz_gradebook(uuid);
create or replace function public.quiz_gradebook(p_quiz uuid)
returns table (index_no text, full_name text, programme text, stream text, student_id uuid, attempt_id uuid,
               attempts_used int, status text, score numeric, max_score numeric, auto_score numeric,
               manual_score numeric, started_at timestamptz, submitted_at timestamptz, minutes_used numeric,
               exits int, exit_log jsonb, devices int, special boolean)
language plpgsql security definer set search_path = public as $$
declare v_course uuid;
begin
  select course_id into v_course from public.quizzes where id = p_quiz;
  perform public.require_staff(v_course);
  perform public.finalize_expired(p_quiz);
  return query
    select r.index_no, r.full_name, r.programme, r.stream, p.id,
           b.id, (select count(*)::int from public.attempts x where x.quiz_id = p_quiz and x.student_id = p.id),
           coalesce(b.status, case when p.id is null then 'not_activated' else 'not_started' end),
           b.score, b.max_score,
           (select coalesce(sum(rr.marks_awarded), 0) from public.responses rr
              join public.questions qq on qq.id = rr.question_id
             where rr.attempt_id = b.id and qq.kind <> 'essay'),
           (select sum(rr.marks_awarded) from public.responses rr
              join public.questions qq on qq.id = rr.question_id
             where rr.attempt_id = b.id and qq.kind = 'essay'),
           b.started_at, b.submitted_at,
           round((extract(epoch from (b.submitted_at - b.started_at)) / 60)::numeric, 1),
           coalesce(b.exits, 0), coalesce(b.exit_log, '[]'::jsonb), coalesce(cardinality(b.devices), 0),
           exists (select 1 from public.quiz_access x where x.quiz_id = p_quiz and x.index_no = r.index_no)
      from public.enrollments e
      join public.roster r on r.index_no = e.index_no
      left join public.profiles p on p.index_no = r.index_no
      left join lateral (
        select a.* from public.attempts a
         where a.quiz_id = p_quiz and a.student_id = p.id
         order by (a.status = 'in_progress'), a.score desc nulls last, a.submitted_at desc
         limit 1) b on true
     where e.course_id = v_course
       and (b.id is not null or public.quiz_open_to(p_quiz, r.index_no, r.stream))
     order by r.full_name, r.index_no;
end;
$$;

-- Written answers waiting for marks.
create or replace function public.marking_queue(p_quiz uuid)
returns table (response_id uuid, attempt_id uuid, index_no text, full_name text, question_id uuid,
               prompt text, max_marks numeric, answer text, model_answer text,
               marks_awarded numeric, feedback text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff((select course_id from public.quizzes where id = p_quiz));
  return query
    select rr.id, a.id, p.index_no, p.full_name, q.id, q.prompt, q.marks,
           coalesce(rr.value #>> '{}', ''), q.explanation, rr.marks_awarded, rr.feedback
      from public.responses rr
      join public.attempts a on a.id = rr.attempt_id
      join public.questions q on q.id = rr.question_id
      join public.profiles p on p.id = a.student_id
     where a.quiz_id = p_quiz and q.kind = 'essay' and a.status <> 'in_progress'
     order by (rr.marks_awarded is not null), q.position, p.full_name, rr.id;
end;
$$;

create or replace function public.mark_response(p_response uuid, p_marks numeric, p_feedback text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_max numeric; v_attempt uuid;
begin
  select q.marks, r.attempt_id into v_max, v_attempt
    from public.responses r join public.questions q on q.id = r.question_id
   where r.id = p_response;
  if v_attempt is null then raise exception 'Answer not found.'; end if;
  perform public.require_staff((select qz.course_id from public.attempts a join public.quizzes qz on qz.id = a.quiz_id
                                 where a.id = v_attempt));
  if p_marks is null or p_marks < 0 or p_marks > v_max then
    raise exception 'Marks must be between 0 and %.', v_max;
  end if;
  update public.responses
     set marks_awarded = p_marks, feedback = nullif(trim(coalesce(p_feedback, '')), ''),
         is_correct = (p_marks = v_max), marked_by = auth.uid()
   where id = p_response;
  perform public.recalc_attempt(v_attempt);
  perform public.log_course_audit(
    (select qz.course_id from public.attempts a join public.quizzes qz on qz.id = a.quiz_id where a.id = v_attempt),
    'mark_quiz_response',
    format('Marked written quiz response (%s / %s)', p_marks, v_max),
    jsonb_build_object('response_id', p_response, 'marks', p_marks, 'max', v_max)
  );
end;
$$;

-- Marks and feedback for one assignment submission (lecturer or TA).
create or replace function public.mark_submission(p_submission uuid, p_marks numeric, p_feedback text) returns void
language plpgsql security definer set search_path = public as $$
declare v_course uuid; v_max numeric;
begin
  select x.course_id, x.max_marks into v_course, v_max
    from public.submissions s join public.assignments x on x.id = s.assignment_id where s.id = p_submission;
  if v_course is null then raise exception 'Submission not found.'; end if;
  perform public.require_staff(v_course);
  if p_marks is not null and (p_marks < 0 or p_marks > v_max) then
    raise exception 'Marks must be between 0 and %.', v_max;
  end if;
  update public.submissions
     set marks = p_marks, feedback = coalesce(p_feedback, ''),
         marked_at = case when p_marks is null then null else now() end,
         marked_by = case when p_marks is null then null else auth.uid() end
   where id = p_submission;
  perform public.log_course_audit(
    v_course,
    'mark_assignment',
    case when p_marks is null then 'Cleared assignment mark' else format('Marked assignment (%s / %s)', p_marks, v_max) end,
    jsonb_build_object('submission_id', p_submission, 'marks', p_marks, 'max', v_max)
  );
end;
$$;

-- Try a formula with sample figures while building a question.
create or replace function public.test_formula(p_formula text, p_params jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; res numeric;
begin
  perform public.require_lecturer();
  v := public.gen_vars(floor(random() * 2147483647)::int, gen_random_uuid(), p_params);
  res := public.eval_formula(p_formula, v);
  return jsonb_build_object('vars', v, 'value', res);
exception when others then
  return jsonb_build_object('error', sqlerrm);
end;
$$;

-- Numbers for the lecturer dashboard.
create or replace function public.lecturer_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not (public.is_lecturer() or public.is_ta_user()) then raise exception 'Staff only.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'code', c.code, 'title', c.title, 'color', c.color, 'semester', c.semester,
           'archived', c.archived,
           'students', (select count(*) from public.enrollments e where e.course_id = c.id),
           'activated', (select count(*) from public.enrollments e
                           join public.profiles p on p.index_no = e.index_no where e.course_id = c.id),
           'materials', (select count(*) from public.materials m where m.course_id = c.id),
           'quizzes', (select count(*) from public.quizzes q where q.course_id = c.id),
           'to_mark', (select count(*) from public.responses rr
                         join public.attempts a on a.id = rr.attempt_id
                         join public.quizzes q on q.id = a.quiz_id
                         join public.questions qq on qq.id = rr.question_id
                        where q.course_id = c.id and qq.kind = 'essay'
                          and a.status <> 'in_progress' and rr.marks_awarded is null)
                    + (select count(*) from public.submissions s
                         join public.assignments x on x.id = s.assignment_id
                        where x.course_id = c.id and s.marks is null))
         order by c.archived, c.code), '[]'::jsonb)
    into r from public.courses c where public.is_staff(c.id);
  return r;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.handle_new_user()                    from public, anon, authenticated;
revoke execute on function public.eval_formula(text, jsonb)            from public, anon, authenticated;
revoke execute on function public.expected_value(public.questions, int) from public, anon, authenticated;
revoke execute on function public.finalize_attempt(uuid)               from public, anon, authenticated;
revoke execute on function public.recalc_attempt(uuid)                 from public, anon, authenticated;
revoke execute on function public.student_email(text)                  from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'start_attempt(uuid)', 'get_attempt(uuid, text)', 'save_response(uuid, uuid, jsonb)',
    'advance_attempt(uuid, int)', 'log_exit(uuid, text)', 'course_groups(uuid)',
    'update_student(text, text, text, text)', 'quiz_window_for(uuid, uuid)',
    'assign_group(text[], text, text)', 'rename_group(text, text, text)', 'delete_group(text, text)',
    'submit_attempt(uuid)', 'my_quizzes(uuid)', 'get_attempt_review(uuid)',
    'can_submit(uuid)', 'submit_assignment(uuid, text, text, text)', 'my_assignments(uuid)',
    'my_upcoming()', 'import_roster(uuid, jsonb)', 'course_students(uuid)',
    'reset_student_password(text, text)', 'finalize_expired(uuid)', 'quiz_gradebook(uuid)',
    'marking_queue(uuid)', 'mark_response(uuid, numeric, text)', 'test_formula(text, jsonb)',
    'lecturer_overview()', 'require_lecturer()', 'require_staff(uuid)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on function public.check_index(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 12. File storage (course materials and assignment uploads)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('materials', 'materials', false, 26214400, null),
  ('submissions', 'submissions', false, 5242880, array[
     'application/pdf',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-powerpoint',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'application/zip', 'application/x-zip-compressed',
     'image/jpeg', 'image/png'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- materials/<course id>/<file>
drop policy if exists "materials read" on storage.objects;
create policy "materials read" on storage.objects for select to authenticated
  using (bucket_id = 'materials' and (public.is_lecturer()
         or public.is_ta(public.try_uuid((storage.foldername(name))[1]))
         or public.is_enrolled(public.try_uuid((storage.foldername(name))[1]))));

drop policy if exists "materials write" on storage.objects;
create policy "materials write" on storage.objects for insert to authenticated
  with check (bucket_id = 'materials' and public.is_lecturer());

drop policy if exists "materials change" on storage.objects;
create policy "materials change" on storage.objects for update to authenticated
  using (bucket_id = 'materials' and public.is_lecturer());

drop policy if exists "materials delete" on storage.objects;
create policy "materials delete" on storage.objects for delete to authenticated
  using (bucket_id = 'materials' and public.is_lecturer());

-- submissions/<assignment id>/<student id>/<file>
drop policy if exists "submissions upload" on storage.objects;
create policy "submissions upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions'
              and (storage.foldername(name))[2] = auth.uid()::text
              and public.can_submit(public.try_uuid((storage.foldername(name))[1])));

drop policy if exists "submissions replace" on storage.objects;
create policy "submissions replace" on storage.objects for update to authenticated
  using (bucket_id = 'submissions'
         and (storage.foldername(name))[2] = auth.uid()::text
         and public.can_submit(public.try_uuid((storage.foldername(name))[1])));

drop policy if exists "submissions read" on storage.objects;
create policy "submissions read" on storage.objects for select to authenticated
  using (bucket_id = 'submissions'
         and (public.is_lecturer() or (storage.foldername(name))[2] = auth.uid()::text
              or public.is_ta((select course_id from public.assignments
                                where id = public.try_uuid((storage.foldername(name))[1])))));

drop policy if exists "submissions delete" on storage.objects;
create policy "submissions delete" on storage.objects for delete to authenticated
  using (bucket_id = 'submissions' and public.is_lecturer());


-- =====================================================================
-- 13. Version 4: attendance, continuous assessment, quiz analysis,
--     integrity checks, at-risk list, Q&A board, question topics, files
-- =====================================================================
create extension if not exists pg_trgm with schema extensions;

alter table public.questions add column if not exists topic text not null default '';
alter table public.courses   add column if not exists ca_total    numeric not null default 40;
alter table public.courses   add column if not exists ca_decimals int     not null default 0;
alter table public.courses   add column if not exists ca_released boolean not null default false;

create table if not exists public.attendance_sessions (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses on delete cascade,
  title      text not null default '',
  streams    text[] not null default '{}',          -- empty = every student
  secret     text not null default gen_random_uuid()::text,
  opens_at   timestamptz not null default now(),
  closes_at  timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists attendance_sessions_course_idx on public.attendance_sessions (course_id);

create table if not exists public.attendance (
  session_id uuid not null references public.attendance_sessions on delete cascade,
  index_no   text not null references public.roster(index_no) on delete cascade on update cascade,
  checked_at timestamptz not null default now(),
  method     text not null default 'code' check (method in ('code', 'manual')),
  primary key (session_id, index_no)
);

-- Version 5: seat row, phone and review status for each check-in
alter table public.attendance_sessions add column if not exists ask_row     boolean not null default true;
alter table public.attendance_sessions add column if not exists head_counts jsonb   not null default '{}'::jsonb;
alter table public.attendance_sessions add column if not exists lat double precision;
alter table public.attendance_sessions add column if not exists lng double precision;
alter table public.attendance_sessions add column if not exists radius_meters int not null default 100;
-- Version 6: sessions for chosen classes, each written 'programme|stream'
alter table public.attendance_sessions add column if not exists classes     text[]  not null default '{}';
alter table public.attendance add column if not exists row_no      int;
alter table public.attendance add column if not exists device      text;
alter table public.attendance add column if not exists status      text not null default 'ok';
alter table public.attendance add column if not exists note        text not null default '';
alter table public.attendance add column if not exists reviewed_by uuid references public.profiles on delete set null;
alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance add constraint attendance_status_check check (status in ('ok', 'review', 'rejected'));

create table if not exists public.attendance_failures (
  id         bigserial primary key,
  student_id uuid not null references public.profiles on delete cascade,
  course_id  uuid not null references public.courses on delete cascade,
  at         timestamptz not null default now()
);
create index if not exists attendance_failures_idx on public.attendance_failures (student_id, course_id, at);

create table if not exists public.ca_components (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('quizzes', 'assignments', 'attendance', 'manual')),
  weight      numeric not null default 0 check (weight >= 0),
  item_ids    uuid[] not null default '{}',          -- empty = all published items
  drop_lowest int not null default 0 check (drop_lowest >= 0),
  max_score   numeric not null default 100 check (max_score > 0),
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists ca_components_course_idx on public.ca_components (course_id);

create table if not exists public.ca_scores (
  component_id uuid not null references public.ca_components on delete cascade,
  index_no     text not null references public.roster(index_no) on delete cascade on update cascade,
  score        numeric not null check (score >= 0),
  primary key (component_id, index_no)
);

create table if not exists public.forum_posts (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses on delete cascade,
  author_id   uuid references public.profiles on delete set null,
  anonymous   boolean not null default true,
  body        text not null check (length(body) between 3 and 2000),
  answer      text,
  answered_at timestamptz,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists forum_posts_course_idx on public.forum_posts (course_id);

create table if not exists public.forum_votes (
  post_id    uuid not null references public.forum_posts on delete cascade,
  student_id uuid not null references public.profiles on delete cascade,
  primary key (post_id, student_id)
);

do $$
declare t text;
begin
  foreach t in array array['attendance_sessions','attendance','attendance_failures','ca_components',
                           'ca_scores','forum_posts','forum_votes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lecturer_all on public.%I', t);
    execute format('create policy lecturer_all on public.%I for all to authenticated
                    using (public.is_lecturer()) with check (public.is_lecturer())', t);
  end loop;
end $$;
-- Students reach these tables only through the functions below.

-- ---------- attendance ----------
create or replace function public.attendance_code(p_secret text, p_slot bigint) returns text
language sql immutable as $$
  select lpad(((('x' || lpad(substr(md5(p_secret || ':' || p_slot), 1, 7), 8, '0'))::bit(32)::int) % 1000000)::text, 6, '0');
$$;

create or replace function public.attendance_slot() returns bigint
language sql stable as $$ select floor(extract(epoch from now()) / 30)::bigint; $$;

create or replace function public.stream_in(p_stream text, p_streams text[]) returns boolean
language sql immutable as $$
  select cardinality(coalesce(p_streams, '{}')) = 0
      or lower(trim(coalesce(p_stream, ''))) in (select lower(trim(x)) from unnest(p_streams) x);
$$;

-- Is a student (programme, stream) part of a session? Classes win over streams.
create or replace function public.session_for(p_streams text[], p_classes text[], p_programme text, p_stream text)
returns boolean
language sql immutable as $$
  select case
    when cardinality(coalesce(p_classes, '{}')) > 0 then
      lower(trim(coalesce(p_programme, ''))) || '|' || lower(trim(coalesce(p_stream, '')))
        in (select lower(trim(split_part(x, '|', 1))) || '|' || lower(trim(split_part(x, '|', 2))) from unnest(p_classes) x)
    else public.stream_in(p_stream, p_streams)
  end;
$$;

drop function if exists public.start_attendance(uuid, text, text[], int);
drop function if exists public.start_attendance(uuid, text, text[], int, boolean);
create or replace function public.start_attendance(p_course uuid, p_title text, p_streams text[], p_minutes int,
                                                   p_ask_row boolean default true, p_classes text[] default '{}')
returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform public.require_staff(p_course);
  insert into public.attendance_sessions (course_id, title, streams, closes_at, ask_row, classes)
  values (p_course, coalesce(nullif(trim(p_title), ''), to_char(now(), 'Dy DD Mon, HH24:MI')),
          case when cardinality(coalesce(p_classes, '{}')) > 0 then '{}' else coalesce(p_streams, '{}') end,
          now() + make_interval(mins => greatest(1, least(coalesce(p_minutes, 10), 240))),
          coalesce(p_ask_row, true), coalesce(p_classes, '{}'))
  returning id into v;
  perform public.log_course_audit(p_course, 'attendance_start', format('Started attendance session "%s"', coalesce(nullif(trim(p_title), ''), 'Class session')), jsonb_build_object('session_id', v));
  return v;
end;
$$;

create or replace function public.attendance_live(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.attendance_sessions; v_slot bigint := public.attendance_slot(); v_expected int; v_count int; v_review int;
begin
  select * into s from public.attendance_sessions where id = p_session;
  if not found then raise exception 'Session not found.'; end if;
  perform public.require_staff(s.course_id);
  select count(*) filter (where status <> 'rejected'), count(*) filter (where status = 'review')
    into v_count, v_review from public.attendance where session_id = p_session;
  select count(*) into v_expected from public.enrollments e join public.roster r on r.index_no = e.index_no
   where e.course_id = s.course_id and public.session_for(s.streams, s.classes, r.programme, r.stream);
  return jsonb_build_object(
    'open', now() between s.opens_at and s.closes_at,
    'code', case when now() between s.opens_at and s.closes_at then public.attendance_code(s.secret, v_slot) end,
    'seconds_left', 30 - (floor(extract(epoch from now()))::bigint % 30),
    'closes_at', s.closes_at, 'count', v_count, 'review', v_review, 'expected', v_expected,
    'title', s.title, 'streams', s.streams, 'classes', s.classes, 'ask_row', s.ask_row, 'server_now', now(),
    'rows', coalesce((select jsonb_object_agg(x.row_no::text, x.n) from (
               select row_no, count(*) as n from public.attendance
                where session_id = p_session and status <> 'rejected' and row_no is not null
                group by row_no) x), '{}'::jsonb));
end;
$$;

create or replace function public.extend_attendance(p_session uuid, p_minutes int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v timestamptz;
begin
  perform public.require_staff((select course_id from public.attendance_sessions where id = p_session));
  update public.attendance_sessions
     set closes_at = case when p_minutes <= 0 then now() else greatest(closes_at, now()) + make_interval(mins => p_minutes) end
   where id = p_session returning closes_at into v;
  return v;
end;
$$;

drop function if exists public.check_in(uuid, text);
create or replace function public.check_in(p_course uuid, p_code text, p_row int default null, p_device text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_idx text; v_stream text; v_prog text; v_slot bigint := public.attendance_slot(); s public.attendance_sessions; v_fails int;
        v_code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
        v_dev text := left(nullif(trim(coalesce(p_device, '')), ''), 100);
        v_asks boolean;
begin
  if not public.is_enrolled(p_course) then raise exception 'You are not on this course.'; end if;
  select r.index_no, r.stream, r.programme into v_idx, v_stream, v_prog
    from public.profiles p join public.roster r on r.index_no = p.index_no where p.id = auth.uid();
  select count(*) into v_fails from public.attendance_failures
   where student_id = auth.uid() and course_id = p_course and at > now() - interval '10 minutes';
  if v_fails >= 8 then
    return jsonb_build_object('ok', false, 'message', 'Too many wrong codes. Wait a few minutes and try again.');
  end if;

  select bool_or(x.ask_row) into v_asks from public.attendance_sessions x
   where x.course_id = p_course and now() between x.opens_at and x.closes_at and public.session_for(x.streams, x.classes, v_prog, v_stream);
  if v_asks is null then
    return jsonb_build_object('ok', false, 'message', 'Attendance is not open for you right now.');
  end if;

  select * into s from public.attendance_sessions x
   where x.course_id = p_course and now() between x.opens_at and x.closes_at
     and public.session_for(x.streams, x.classes, v_prog, v_stream)
     and v_code in (public.attendance_code(x.secret, v_slot), public.attendance_code(x.secret, v_slot - 1))
   order by x.opens_at desc limit 1;
  if not found then
    -- recorded (not raised) so the failed try counts towards the limit
    insert into public.attendance_failures (student_id, course_id) values (auth.uid(), p_course);
    return jsonb_build_object('ok', false, 'message', 'That code is wrong or has expired. Check the screen and type the current code.');
  end if;
  if s.ask_row and (p_row is null or p_row < 1 or p_row > 200) then
    return jsonb_build_object('ok', false, 'need_row', true, 'message', 'Enter the number of the row you are sitting in.');
  end if;

  insert into public.attendance (session_id, index_no, row_no, device)
  values (s.id, v_idx, case when s.ask_row then p_row end, v_dev)
  on conflict do nothing;

  -- one phone checking in more than one student: hold all of them for review
  if v_dev is not null and exists (select 1 from public.attendance a where a.session_id = s.id
                                       and a.device = v_dev and a.index_no <> v_idx) then
    update public.attendance set status = 'review', note = 'Same phone as another check-in'
     where session_id = s.id and device = v_dev and status = 'ok';
  end if;
  return jsonb_build_object('ok', true, 'session', s.title, 'at', now());
end;
$$;

create or replace function public.my_open_attendance() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('session_id', s.id, 'course_id', c.id, 'course_code', c.code,
                                               'title', s.title, 'closes_at', s.closes_at,
                                               'ask_row', s.ask_row, 'lat', s.lat, 'lng', s.lng, 'radius_meters', coalesce(s.radius_meters, 100)) order by s.closes_at), '[]'::jsonb)
    from public.attendance_sessions s
    join public.courses c on c.id = s.course_id
    join public.profiles p on p.id = auth.uid()
    join public.roster r on r.index_no = p.index_no
   where now() between s.opens_at and s.closes_at
     and public.is_enrolled(c.id) and public.session_for(s.streams, s.classes, r.programme, r.stream)
     and not exists (select 1 from public.attendance a where a.session_id = s.id and a.index_no = r.index_no);
$$;

create or replace function public.my_attendance(p_course uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select r.index_no, r.stream, r.programme from public.profiles p join public.roster r on r.index_no = p.index_no where p.id = auth.uid()),
  ss as (
    select s.id, s.title, s.opens_at, s.closes_at, s.ask_row,
           (select a.status from public.attendance a, me where a.session_id = s.id and a.index_no = me.index_no) as status
      from public.attendance_sessions s, me
     where s.course_id = p_course and s.opens_at <= now() and public.session_for(s.streams, s.classes, me.programme, me.stream)
       and public.is_enrolled(p_course)),
  ss2 as (select ss.*, coalesce(ss.status = 'ok', false) as present from ss)
  select jsonb_build_object(
    'sessions', coalesce((select jsonb_agg(to_jsonb(ss2) order by ss2.opens_at desc) from ss2), '[]'::jsonb),
    'attended', (select count(*) from ss2 where present),
    'total', (select count(*) from ss2),
    'open_now', exists (select 1 from ss2 where now() between ss2.opens_at and ss2.closes_at and ss2.status is null),
    'ask_row', coalesce((select bool_or(ss2.ask_row) from ss2 where now() between ss2.opens_at and ss2.closes_at), false));
$$;

create or replace function public.course_attendance(p_course uuid)
returns table (index_no text, full_name text, programme text, stream text, attended int, applicable int, sessions uuid[])
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(p_course);
  return query
    select r.index_no, r.full_name, r.programme, r.stream,
           (select count(*)::int from public.attendance a join public.attendance_sessions s on s.id = a.session_id
             where s.course_id = p_course and a.index_no = r.index_no and a.status = 'ok'),
           (select count(*)::int from public.attendance_sessions s
             where s.course_id = p_course and s.opens_at <= now() and public.session_for(s.streams, s.classes, r.programme, r.stream)),
           coalesce((select array_agg(a.session_id) from public.attendance a join public.attendance_sessions s on s.id = a.session_id
                      where s.course_id = p_course and a.index_no = r.index_no and a.status = 'ok'), '{}')
      from public.enrollments e join public.roster r on r.index_no = e.index_no
     where e.course_id = p_course
     order by r.full_name, r.index_no;
end;
$$;

create or replace function public.set_attendance(p_session uuid, p_index text, p_present boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff((select course_id from public.attendance_sessions where id = p_session));
  if p_present then
    insert into public.attendance (session_id, index_no, method, reviewed_by)
    values (p_session, public.norm_index(p_index), 'manual', auth.uid())
    on conflict (session_id, index_no) do update set status = 'ok', note = 'Marked present by hand', reviewed_by = auth.uid();
  else
    delete from public.attendance where session_id = p_session and index_no = public.norm_index(p_index);
  end if;
  perform public.log_course_audit(
    (select course_id from public.attendance_sessions where id = p_session),
    'attendance_manual',
    format('%s %s manually', case when p_present then 'Marked present' else 'Marked absent' end, public.norm_index(p_index)),
    jsonb_build_object('session_id', p_session, 'index_no', public.norm_index(p_index), 'present', p_present)
  );
end;
$$;

-- Sessions list with counts (lecturer and TA).
create or replace function public.course_attendance_sessions(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(p_course);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'title', s.title, 'streams', s.streams, 'classes', s.classes, 'opens_at', s.opens_at, 'closes_at', s.closes_at,
      'ask_row', s.ask_row,
      'present', (select count(*) from public.attendance a where a.session_id = s.id and a.status = 'ok'),
      'review', (select count(*) from public.attendance a where a.session_id = s.id and a.status = 'review'),
      'rejected', (select count(*) from public.attendance a where a.session_id = s.id and a.status = 'rejected'))
    order by s.opens_at desc) from public.attendance_sessions s where s.course_id = p_course), '[]'::jsonb);
end;
$$;

-- Everything needed to check one session: rows, head counts, flagged check-ins.
create or replace function public.attendance_session_detail(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.attendance_sessions;
begin
  select * into s from public.attendance_sessions where id = p_session;
  if not found then raise exception 'Session not found.'; end if;
  perform public.require_staff(s.course_id);
  return jsonb_build_object(
    'id', s.id, 'title', s.title, 'opens_at', s.opens_at, 'closes_at', s.closes_at, 'ask_row', s.ask_row,
    'open', now() between s.opens_at and s.closes_at, 'head_counts', s.head_counts,
    'checkins', coalesce((select jsonb_agg(jsonb_build_object(
        'index_no', a.index_no, 'full_name', r.full_name, 'stream', r.stream, 'row_no', a.row_no,
        'status', a.status, 'note', a.note, 'method', a.method, 'checked_at', a.checked_at,
        'phone', case when a.device is null then null else upper(left(md5(a.device), 4)) end,
        'shared_phone', a.device is not null and exists (select 1 from public.attendance b where b.session_id = a.session_id
                                                           and b.device = a.device and b.index_no <> a.index_no))
      order by a.row_no nulls last, r.full_name)
      from public.attendance a join public.roster r on r.index_no = a.index_no
     where a.session_id = p_session), '[]'::jsonb));
end;
$$;

-- Five (or n) random students who checked in, for a stand-up spot check.
create or replace function public.attendance_spot(p_session uuid, p_n int default 5) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff((select course_id from public.attendance_sessions where id = p_session));
  return coalesce((select jsonb_agg(jsonb_build_object('index_no', x.index_no, 'full_name', x.full_name, 'row_no', x.row_no))
    from (select a.index_no, r.full_name, a.row_no from public.attendance a join public.roster r on r.index_no = a.index_no
           where a.session_id = p_session and a.status <> 'rejected'
           order by random() limit greatest(1, least(coalesce(p_n, 5), 20))) x), '[]'::jsonb);
end;
$$;

-- Accept or reject check-ins after checking.
create or replace function public.attendance_review(p_session uuid, p_indexes text[], p_status text, p_note text default '')
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require_staff((select course_id from public.attendance_sessions where id = p_session));
  if p_status not in ('ok', 'review', 'rejected') then raise exception 'Unknown status.'; end if;
  update public.attendance set status = p_status, note = left(coalesce(p_note, ''), 200), reviewed_by = auth.uid()
   where session_id = p_session and index_no = any(p_indexes);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The head count you or your TA took for one row (null clears it).
create or replace function public.attendance_head_count(p_session uuid, p_row int, p_count int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.require_staff((select course_id from public.attendance_sessions where id = p_session));
  update public.attendance_sessions
     set head_counts = case when p_count is null or p_count < 0 then head_counts - p_row::text
                            else head_counts || jsonb_build_object(p_row::text, p_count) end
   where id = p_session returning head_counts into v;
  return v;
end;
$$;

-- ---------- continuous assessment ----------
create or replace function public.ca_rows(p_course uuid)
returns table (index_no text, full_name text, programme text, stream text, uid uuid, parts jsonb, total numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with st as (
    select r.index_no, r.full_name, r.programme, r.stream, p.id as uid
      from public.enrollments e join public.roster r on r.index_no = e.index_no
      left join public.profiles p on p.index_no = r.index_no
     where e.course_id = p_course),
  comp as (select * from public.ca_components c where c.course_id = p_course),
  items as (
    select c.id as cid, st.index_no as idx,
           coalesce((select max(a.score / nullif(a.max_score, 0)) * 100 from public.attempts a
                      where a.quiz_id = q.id and a.student_id = st.uid and a.status <> 'in_progress'), 0) as pct
      from comp c
      join public.quizzes q on q.course_id = p_course and q.published and not q.is_practice
                           and (cardinality(c.item_ids) = 0 or q.id = any(c.item_ids))
      cross join st
     where c.kind = 'quizzes'
       and public.quiz_open_to(q.id, st.index_no, st.stream)
    union all
    select c.id, st.index_no,
           coalesce((select s.marks / x.max_marks * 100 from public.submissions s
                      where s.assignment_id = x.id and s.student_id = st.uid and s.marks is not null), 0)
      from comp c
      join public.assignments x on x.course_id = p_course and x.published
                               and (cardinality(c.item_ids) = 0 or x.id = any(c.item_ids))
      cross join st
     where c.kind = 'assignments'
    union all
    select c.id, st.index_no, case when ap.n = 0 then 0 else ap.att * 100.0 / ap.n end
      from comp c cross join st
      cross join lateral (
        select count(*) as n, count(a.index_no) as att
          from public.attendance_sessions s
          left join public.attendance a on a.session_id = s.id and a.index_no = st.index_no and a.status = 'ok'
         where s.course_id = p_course and s.opens_at <= now() and public.session_for(s.streams, s.classes, st.programme, st.stream)) ap
     where c.kind = 'attendance'
    union all
    select c.id, st.index_no,
           coalesce((select least(sc.score, c.max_score) / c.max_score * 100 from public.ca_scores sc
                      where sc.component_id = c.id and sc.index_no = st.index_no), 0)
      from comp c cross join st
     where c.kind = 'manual'),
  ranked as (
    select i.cid, i.idx, i.pct,
           row_number() over (partition by i.cid, i.idx order by i.pct) as rn,
           count(*) over (partition by i.cid, i.idx) as cnt
      from items i),
  avgs as (
    select rk.cid, rk.idx, avg(rk.pct) as pct
      from ranked rk join comp c on c.id = rk.cid
     where rk.rn > least(c.drop_lowest, rk.cnt - 1)
     group by rk.cid, rk.idx),
  pts as (
    select st.index_no as idx, c.id as cid, coalesce(a.pct, 0) as pct,
           round(coalesce(a.pct, 0) / 100 * c.weight, 2) as points
      from st cross join comp c
      left join avgs a on a.cid = c.id and a.idx = st.index_no)
  select st.index_no, st.full_name, st.programme, st.stream, st.uid,
         coalesce((select jsonb_object_agg(p.cid::text, jsonb_build_object('points', p.points, 'pct', round(p.pct, 1)))
                     from pts p where p.idx = st.index_no), '{}'::jsonb),
         coalesce((select sum(p.points) from pts p where p.idx = st.index_no), 0)
    from st
   order by st.full_name, st.index_no;
end;
$$;

create or replace function public.course_ca(p_course uuid)
returns table (index_no text, full_name text, programme text, stream text, parts jsonb, total numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_lecturer();
  return query select x.index_no, x.full_name, x.programme, x.stream, x.parts, x.total from public.ca_rows(p_course) x;
end;
$$;

create or replace function public.my_ca(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.courses; r record;
begin
  select * into c from public.courses where id = p_course;
  if not found or not public.is_enrolled(p_course) or not c.ca_released then return null; end if;
  select * into r from public.ca_rows(p_course) x where x.uid = auth.uid();
  if not found then return null; end if;
  return jsonb_build_object(
    'total', round(r.total, c.ca_decimals), 'out_of', c.ca_total,
    'components', (select coalesce(jsonb_agg(jsonb_build_object(
                     'name', k.name, 'kind', k.kind, 'weight', k.weight,
                     'points', (r.parts -> k.id::text ->> 'points')::numeric,
                     'pct', (r.parts -> k.id::text ->> 'pct')::numeric) order by k.position, k.created_at), '[]'::jsonb)
                     from public.ca_components k where k.course_id = p_course));
end;
$$;

create or replace function public.save_ca_scores(p_component uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; v numeric; v_idx text;
begin
  perform public.require_lecturer();
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

-- ---------- quiz analysis ----------
create or replace function public.quiz_item_analysis(p_quiz uuid)
returns table (question_id uuid, qposition int, kind text, prompt text, topic text, marks numeric, answered int,
               avg_pct numeric, discrimination numeric, by_stream jsonb, options jsonb, correct text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_lecturer();
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

create or replace function public.safe_expected(p_question public.questions, p_seed int) returns numeric
language plpgsql volatile security definer set search_path = public as $$
begin
  return public.expected_value(p_question, p_seed);
exception when others then
  return null;
end;
$$;

create or replace function public.quiz_similar_answers(p_quiz uuid, p_threshold numeric default 0.6)
returns table (question_id uuid, prompt text, a_index text, a_name text, b_index text, b_name text,
               similarity numeric, a_text text, b_text text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform public.require_lecturer();
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

-- Wrong numeric answers that equal a classmate's own correct answer (copied working).
create or replace function public.quiz_figure_matches(p_quiz uuid)
returns table (question_id uuid, prompt text, index_no text, full_name text, answer numeric,
               match_index text, match_name text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_lecturer();
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
   where abs(w.v - other.e) <= greatest(case when other.tolerance_type = 'pct' then abs(other.e) * other.tolerance / 100
                                             else other.tolerance end, 0.0000001)
     and abs(other.e - coalesce(mine.e, other.e + 1)) > 0.0000001
   order by w.aid, w.qid;
end;
$$;

-- ---------- at-risk students ----------
create or replace function public.course_at_risk(p_course uuid)
returns table (index_no text, full_name text, programme text, stream text, last_sign_in timestamptz,
               missed int, avg_pct numeric, attendance_pct numeric, reasons text[])
language plpgsql stable security definer set search_path = public, auth as $$
#variable_conflict use_column
begin
  perform public.require_staff(p_course);
  return query
  with st as (
    select r.index_no, r.full_name, r.programme, r.stream, p.id as uid, u.last_sign_in_at
      from public.enrollments e join public.roster r on r.index_no = e.index_no
      left join public.profiles p on p.index_no = r.index_no
      left join auth.users u on u.id = p.id
     where e.course_id = p_course),
  m as (
    select st.*,
      (select count(*)::int from public.quizzes q
        cross join lateral public.quiz_window_for(q.id, st.uid) w
        where q.course_id = p_course and q.published and not q.is_practice and w.allowed
          and w.closes_at is not null and w.closes_at < now()
          and not exists (select 1 from public.attempts a where a.quiz_id = q.id and a.student_id = st.uid
                            and a.status <> 'in_progress')) as missed,
      (select round(avg(a.score / nullif(a.max_score, 0)) * 100, 1) from public.attempts a
         join public.quizzes q on q.id = a.quiz_id
        where q.course_id = p_course and not q.is_practice and a.student_id = st.uid and a.status <> 'in_progress') as avg_pct,
      (select case when count(*) >= 3 then round(count(at.index_no) * 100.0 / count(*), 0) end
         from public.attendance_sessions s
         left join public.attendance at on at.session_id = s.id and at.index_no = st.index_no and at.status = 'ok'
        where s.course_id = p_course and s.opens_at <= now() and public.session_for(s.streams, s.classes, st.programme, st.stream)) as att
    from st)
  select m.index_no, m.full_name, m.programme, m.stream, m.last_sign_in_at, m.missed, m.avg_pct, m.att,
         array_remove(array[
           case when m.uid is null then 'Never activated account' end,
           case when m.uid is not null and (m.last_sign_in_at is null or m.last_sign_in_at < now() - interval '14 days')
                then 'Not signed in for 2+ weeks' end,
           case when m.missed >= 2 then 'Missed ' || m.missed || ' quizzes' end,
           case when m.avg_pct < 40 then 'Quiz average below 40%' end,
           case when m.att < 50 then 'Attendance below 50%' end], null)
    from m
   where m.uid is null
      or m.last_sign_in_at is null or m.last_sign_in_at < now() - interval '14 days'
      or m.missed >= 2 or m.avg_pct < 40 or m.att < 50
   order by m.full_name, m.index_no;
end;
$$;

-- ---------- Q&A board ----------
create or replace function public.forum_list(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_lect boolean := public.is_lecturer(); v_staff boolean := public.is_staff(p_course);
begin
  if not (v_staff or public.is_enrolled(p_course)) then raise exception 'Not available.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'body', f.body, 'created_at', f.created_at, 'answer', f.answer, 'answered_at', f.answered_at,
             'hidden', f.hidden, 'anonymous', f.anonymous,
             'author', case when v_lect or not f.anonymous or f.author_id = auth.uid()
                            then coalesce(p.full_name, 'Former student') else null end,
             'author_index', case when v_lect or (v_staff and not f.anonymous) then p.index_no end,
             'mine', f.author_id = auth.uid(),
             'votes', (select count(*) from public.forum_votes v where v.post_id = f.id),
             'voted', exists (select 1 from public.forum_votes v where v.post_id = f.id and v.student_id = auth.uid()))
           order by f.created_at desc)
      from public.forum_posts f
      left join public.profiles p on p.id = f.author_id
     where f.course_id = p_course and (v_staff or not f.hidden or f.author_id = auth.uid())), '[]'::jsonb);
end;
$$;

-- Staff answer or hide a question.
create or replace function public.forum_answer(p_post uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff((select course_id from public.forum_posts where id = p_post));
  update public.forum_posts
     set answer = nullif(trim(coalesce(p_answer, '')), ''),
         answered_at = case when nullif(trim(coalesce(p_answer, '')), '') is null then null else now() end
   where id = p_post;
  perform public.log_course_audit(
    (select course_id from public.forum_posts where id = p_post),
    'forum_answer',
    'Answered a student Q&A question',
    jsonb_build_object('post_id', p_post)
  );
end;
$$;

create or replace function public.forum_hide(p_post uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff((select course_id from public.forum_posts where id = p_post));
  update public.forum_posts set hidden = coalesce(p_hidden, true) where id = p_post;
end;
$$;

create or replace function public.forum_post(p_course uuid, p_body text, p_anonymous boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.is_enrolled(p_course) then raise exception 'You are not on this course.'; end if;
  if (select count(*) from public.forum_posts where author_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You can post up to 5 questions a day.';
  end if;
  if length(trim(coalesce(p_body, ''))) < 3 then raise exception 'Write your question first.'; end if;
  insert into public.forum_posts (course_id, author_id, anonymous, body)
  values (p_course, auth.uid(), coalesce(p_anonymous, true), left(trim(p_body), 2000)) returning id into v;
  return v;
end;
$$;

create or replace function public.forum_vote(p_post uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_course uuid;
begin
  select course_id into v_course from public.forum_posts where id = p_post and not hidden;
  if v_course is null or not public.is_enrolled(v_course) then raise exception 'Not available.'; end if;
  if exists (select 1 from public.forum_votes where post_id = p_post and student_id = auth.uid()) then
    delete from public.forum_votes where post_id = p_post and student_id = auth.uid();
    return false;
  end if;
  insert into public.forum_votes values (p_post, auth.uid());
  return true;
end;
$$;

create or replace function public.forum_delete_own(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.forum_posts where id = p_post and author_id = auth.uid() and answer is null;
end;
$$;

-- ---------- file access check (used by the R2 file service) ----------
create or replace function public.file_access(p_bucket text, p_path text, p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(regexp_replace(coalesce(p_path, ''), '^r2:', ''), '/');
begin
  if auth.uid() is null or coalesce(p_path, '') like '%..%' or cardinality(parts) < 2 then return false; end if;
  if p_bucket = 'materials' then
    if p_action = 'download' then
      return public.is_lecturer() or public.is_ta(public.try_uuid(parts[1])) or public.is_enrolled(public.try_uuid(parts[1]));
    end if;
    return public.is_lecturer();
  elsif p_bucket = 'submissions' then
    if cardinality(parts) < 3 then return false; end if;
    if p_action = 'download' then
      return public.is_lecturer() or parts[2] = auth.uid()::text
          or public.is_ta((select course_id from public.assignments where id = public.try_uuid(parts[1])));
    end if;
    if p_action = 'upload' then
      return parts[2] = auth.uid()::text and public.can_submit(public.try_uuid(parts[1]));
    end if;
    return public.is_lecturer();
  end if;
  return false;
end;
$$;

-- ---------- permissions for the new functions ----------
revoke execute on function public.ca_rows(uuid) from public, anon, authenticated;
revoke execute on function public.safe_expected(public.questions, int) from public, anon, authenticated;
revoke execute on function public.attendance_code(text, bigint) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'start_attendance(uuid, text, text[], int, boolean, text[])', 'attendance_live(uuid)', 'extend_attendance(uuid, int)',
    'check_in(uuid, text, int, text)', 'course_attendance_sessions(uuid)', 'attendance_session_detail(uuid)',
    'attendance_spot(uuid, int)', 'attendance_review(uuid, text[], text, text)', 'attendance_head_count(uuid, int, int)',
    'forum_answer(uuid, text)', 'forum_hide(uuid, boolean)', 'mark_submission(uuid, numeric, text)', 'my_open_attendance()', 'my_attendance(uuid)', 'course_attendance(uuid)',
    'set_attendance(uuid, text, boolean)', 'course_ca(uuid)', 'my_ca(uuid)', 'save_ca_scores(uuid, jsonb)',
    'quiz_item_analysis(uuid)', 'quiz_similar_answers(uuid, numeric)', 'quiz_figure_matches(uuid)',
    'course_at_risk(uuid)', 'forum_list(uuid)', 'forum_post(uuid, text, boolean)', 'forum_vote(uuid)',
    'forum_delete_own(uuid)', 'file_access(text, text, text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- =====================================================================
-- 14. Version 5: special access to quizzes, teaching assistants
-- =====================================================================
alter table public.quiz_access  enable row level security;
alter table public.course_staff enable row level security;
do $$
declare t text;
begin
  foreach t in array array['quiz_access', 'course_staff'] loop
    execute format('drop policy if exists lecturer_all on public.%I', t);
    execute format('create policy lecturer_all on public.%I for all to authenticated
                    using (public.is_lecturer()) with check (public.is_lecturer())', t);
  end loop;
end $$;

-- What a teaching assistant may read directly. Everything they may change
-- goes through functions that check public.require_staff(course).
drop policy if exists ta_own on public.course_staff;
create policy ta_own on public.course_staff for select to authenticated using (user_id = auth.uid());
drop policy if exists ta_courses on public.courses;
create policy ta_courses on public.courses for select to authenticated using (public.is_ta(id));
drop policy if exists ta_enrollments on public.enrollments;
create policy ta_enrollments on public.enrollments for select to authenticated using (public.is_ta(course_id));
drop policy if exists ta_roster on public.roster;
create policy ta_roster on public.roster for select to authenticated using (public.ta_sees_index(index_no));
drop policy if exists ta_profiles on public.profiles;
create policy ta_profiles on public.profiles for select to authenticated
  using (role = 'student' and public.ta_sees_index(index_no));
drop policy if exists ta_groups on public.group_options;
create policy ta_groups on public.group_options for select to authenticated using (public.is_ta_user());
drop policy if exists ta_quizzes on public.quizzes;
create policy ta_quizzes on public.quizzes for select to authenticated using (public.is_ta(course_id));
drop policy if exists ta_quiz_windows on public.quiz_windows;
create policy ta_quiz_windows on public.quiz_windows for select to authenticated
  using (public.is_ta((select course_id from public.quizzes where id = quiz_id)));
drop policy if exists ta_quiz_access on public.quiz_access;
create policy ta_quiz_access on public.quiz_access for select to authenticated
  using (public.is_ta((select course_id from public.quizzes where id = quiz_id)));
drop policy if exists ta_attempts on public.attempts;
create policy ta_attempts on public.attempts for select to authenticated
  using (public.is_ta((select course_id from public.quizzes where id = quiz_id)));
drop policy if exists ta_assignments on public.assignments;
create policy ta_assignments on public.assignments for select to authenticated using (public.is_ta(course_id));
drop policy if exists ta_submissions on public.submissions;
create policy ta_submissions on public.submissions for select to authenticated
  using (public.is_ta((select course_id from public.assignments where id = assignment_id)));
drop policy if exists ta_announcements on public.announcements;
create policy ta_announcements on public.announcements for select to authenticated using (public.is_ta(course_id));
drop policy if exists ta_announce on public.announcements;
create policy ta_announce on public.announcements for insert to authenticated with check (public.is_ta(course_id));

-- ---------- managing teaching assistants (lecturer only) ----------
create or replace function public.course_staff_list(p_course uuid)
returns table (email text, full_name text, activated boolean, last_sign_in timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
#variable_conflict use_column
begin
  perform public.require_lecturer();
  return query
    select s.email, coalesce(nullif(p.full_name, ''), s.full_name), s.user_id is not null, u.last_sign_in_at
      from public.course_staff s
      left join public.profiles p on p.id = s.user_id
      left join auth.users u on u.id = s.user_id
     where s.course_id = p_course
     order by s.created_at;
end;
$$;

create or replace function public.add_staff(p_course uuid, p_email text, p_name text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); v_uid uuid; v_role text; v_base text;
begin
  perform public.require_lecturer();
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address.'; end if;
  if v_email = lower((select value from public.app_settings where key = 'lecturer_email')) then
    raise exception 'That is your own lecturer account.';
  end if;
  select value into v_base from public.app_settings where key = 'student_email_base';
  if split_part(v_email, '@', 2) = lower(split_part(v_base, '@', 2))
     and split_part(v_email, '@', 1) like lower(split_part(v_base, '@', 1)) || '+%' then
    raise exception 'That is a student sign-in address. Use the TA''s own email.';
  end if;
  select u.id, p.role into v_uid, v_role from auth.users u left join public.profiles p on p.id = u.id
   where lower(u.email) = v_email;
  if v_uid is not null and coalesce(v_role, '') <> 'ta' then
    raise exception 'That email already belongs to another account on this site.';
  end if;
  insert into public.course_staff (course_id, email, full_name, user_id)
  values (p_course, v_email, trim(coalesce(p_name, '')), v_uid)
  on conflict (course_id, email) do update set full_name = coalesce(nullif(excluded.full_name, ''), course_staff.full_name);
end;
$$;

create or replace function public.remove_staff(p_course uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_lecturer();
  delete from public.course_staff where course_id = p_course and email = lower(trim(p_email));
end;
$$;

-- ---------- special access (lecturer only) ----------
-- p_rows: [{"index_no":"...","opens_at":"...","closes_at":"...","extra_attempts":1,"note":"Sick"}]
create or replace function public.save_quiz_access(p_quiz uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; v_idx text; v_course uuid;
begin
  perform public.require_lecturer();
  select course_id into v_course from public.quizzes where id = p_quiz;
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

-- ---------- classes (programme + stream pairs) on a course ----------
create or replace function public.course_classes(p_course uuid)
returns table (programme text, stream text, students int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(p_course);
  return query
    select r.programme, r.stream, count(*)::int
      from public.enrollments e join public.roster r on r.index_no = e.index_no
     where e.course_id = p_course
     group by r.programme, r.stream
     order by r.programme, r.stream;
end;
$$;

grant execute on function public.check_staff_email(text) to anon, authenticated;
revoke execute on function public.quiz_open_to(uuid, text, text) from public, anon;
grant execute on function public.quiz_open_to(uuid, text, text) to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'course_staff_list(uuid)', 'add_staff(uuid, text, text)', 'remove_staff(uuid, text)',
    'save_quiz_access(uuid, jsonb)', 'course_classes(uuid)', 'is_ta(uuid)', 'is_staff(uuid)', 'is_ta_user()', 'ta_sees_index(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Done.

-- ---------------------------------------------------------------------
-- 13. Private Course Messages (Student <-> Lecturer Office Hours)
-- ---------------------------------------------------------------------
create table if not exists public.course_messages (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null default '',
  message text not null,
  reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);

-- Ensure foreign key constraint for PostgREST schema cache if student_id was referencing auth.users
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'course_messages_student_id_profiles_fkey'
  ) then
    begin
      alter table public.course_messages
        add constraint course_messages_student_id_profiles_fkey
        foreign key (student_id) references public.profiles(id) on delete cascade;
    exception when others then
      null;
    end;
  end if;
end $$;
alter table public.course_messages enable row level security;

drop policy if exists student_messages_policy on public.course_messages;
create policy student_messages_policy on public.course_messages
  for all to authenticated
  using (student_id = auth.uid() or public.is_lecturer())
  with check (student_id = auth.uid() or public.is_lecturer());

revoke execute on function public.log_course_action(uuid, text, text, jsonb) from public, anon;
grant execute on function public.log_course_action(uuid, text, text, jsonb) to authenticated;
revoke execute on function public.course_audit_log_list(uuid, int) from public, anon;
grant execute on function public.course_audit_log_list(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- 14. Quiz-Day Resilience: Proctor Photos Storage & Live Exam Control
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('proctor_photos', 'proctor_photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- proctor_photos/<course_id>/<quiz_id>/<attempt_id>.jpg
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

-- Student lightweight deadline check (for live extra-time sync)
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

-- Live exam monitor feed (does not auto-finalize expired attempts so lecturers can extend or force-submit them)
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

do $$
declare f text;
begin
  foreach f in array array[
    'attempt_deadline(uuid)',
    'quiz_live_status(uuid)',
    'extend_attempt_time(uuid, int)',
    'extend_quiz_time(uuid, int, text, text)',
    'reopen_attempt(uuid, int)',
    'force_submit_attempt(uuid)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Staff script viewer: view any student's full attempt choices, unique figures & marks
create or replace function public.staff_attempt_review(p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
$$;

revoke execute on function public.staff_attempt_review(uuid) from public, anon;
grant execute on function public.staff_attempt_review(uuid) to authenticated;

-- =====================================================================
-- 15. PSCM E-Class Feature Pack (Features 1-7):
--     Multi-Select Questions, Question Diagrams, Hall Access PIN,
--     Short-Answer Clustering & One-Click Regrade, Material Read Tracking
-- =====================================================================

-- 1. Schema extensions (idempotent)
alter table public.questions drop constraint if exists questions_kind_check;
alter table public.questions add constraint questions_kind_check
  check (kind in ('mcq','multiselect','truefalse','numeric','short','essay'));

alter table public.questions add column if not exists image_path text not null default '';
alter table public.quizzes add column if not exists access_pin text not null default '';

-- 2. Public-read CDN Storage bucket for Question Diagrams (lecturer-only write)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('question_media', 'question_media', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "question media read" on storage.objects;
create policy "question media read" on storage.objects for select to public
  using (bucket_id = 'question_media');

drop policy if exists "question media insert" on storage.objects;
create policy "question media insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'question_media' and public.is_lecturer());

drop policy if exists "question media update" on storage.objects;
create policy "question media update" on storage.objects for update to authenticated
  using (bucket_id = 'question_media' and public.is_lecturer())
  with check (bucket_id = 'question_media' and public.is_lecturer());

drop policy if exists "question media delete" on storage.objects;
create policy "question media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'question_media' and public.is_lecturer());

-- 3. Shared grading helper supporting MCQ, Multi-Select (with partial credit),
--    True/False, Numeric/Formula, Short Answer & Essay
create or replace function public.eval_question_grade(
  q public.questions,
  v jsonb,
  p_seed int
)
returns table (is_correct boolean, marks_awarded numeric, feedback text)
language plpgsql stable security definer set search_path = public as $$
declare
  txt text;
  exp numeric;
  giv numeric;
  tol numeric;
  corr_arr text[];
  sel_arr text[];
  corr_n int;
  right_n int;
  wrong_n int;
  partial boolean;
begin
  is_correct := null;
  marks_awarded := null;
  feedback := null;
  txt := case
    when v is null or jsonb_typeof(v) = 'array' then ''
    else coalesce(v #>> '{}', '')
  end;

  if q.kind in ('mcq', 'truefalse') then
    is_correct := txt <> '' and txt = coalesce(q.answer->>'correct', '');
    marks_awarded := case when is_correct then q.marks else 0 end;
  elsif q.kind = 'multiselect' then
    select coalesce(array_agg(el), '{}'::text[]) into corr_arr
      from jsonb_array_elements_text(coalesce(q.answer->'correct', '[]'::jsonb)) el;
    if v is not null and jsonb_typeof(v) = 'array' then
      select coalesce(array_agg(distinct el), '{}'::text[]) into sel_arr
        from jsonb_array_elements_text(v) el;
    else
      sel_arr := '{}'::text[];
    end if;
    corr_n := coalesce(array_length(corr_arr, 1), 0);
    right_n := coalesce((select count(*)::int from unnest(sel_arr) s where s = any(corr_arr)), 0);
    wrong_n := coalesce((select count(*)::int from unnest(sel_arr) s where not (s = any(corr_arr))), 0);
    partial := coalesce((q.answer->>'partial')::boolean, true);
    if corr_n = 0 or coalesce(array_length(sel_arr, 1), 0) = 0 then
      is_correct := false;
      marks_awarded := 0;
    elsif partial then
      is_correct := (right_n = corr_n and wrong_n = 0);
      marks_awarded := round(q.marks * greatest(0::numeric, (right_n - wrong_n)::numeric / corr_n::numeric), 2);
    else
      is_correct := (right_n = corr_n and wrong_n = 0);
      marks_awarded := case when is_correct then q.marks else 0 end;
    end if;
  elsif q.kind = 'numeric' then
    begin
      exp := public.expected_value(q, p_seed);
      giv := public.parse_number(v);
      tol := case when q.tolerance_type = 'pct' then abs(exp) * q.tolerance / 100 else q.tolerance end;
      is_correct := giv is not null and abs(giv - exp) <= tol + 0.0000001;
      marks_awarded := case when is_correct then q.marks else 0 end;
    exception when others then
      is_correct := false;
      marks_awarded := 0;
      feedback := 'This question could not be marked automatically. Your lecturer will check it.';
    end;
  elsif q.kind = 'short' then
    is_correct := txt <> '' and exists (
      select 1 from jsonb_array_elements_text(coalesce(q.answer->'accepted', '[]'::jsonb)) acc
      where public.norm_text(acc) = public.norm_text(txt)
    );
    marks_awarded := case when is_correct then q.marks else 0 end;
  else -- essay
    if trim(txt) = '' then
      is_correct := false;
      marks_awarded := 0;
    end if;
  end if;

  return next;
end;
$$;

create or replace function public.finalize_attempt(p_attempt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  a   public.attempts;
  q   public.questions;
  v   jsonb;
  g   record;
begin
  select * into a from public.attempts where id = p_attempt for update;
  if not found or a.status <> 'in_progress' then return; end if;

  for q in select * from public.questions where id = any(a.question_order) loop
    select r.value into v from public.responses r where r.attempt_id = a.id and r.question_id = q.id;
    select * into g from public.eval_question_grade(q, v, a.seed);

    insert into public.responses (attempt_id, question_id, value, is_correct, marks_awarded, feedback)
    values (a.id, q.id, v, g.is_correct, g.marks_awarded, g.feedback)
    on conflict (attempt_id, question_id)
    do update set is_correct = excluded.is_correct,
                  marks_awarded = excluded.marks_awarded,
                  feedback = coalesce(excluded.feedback, public.responses.feedback);
  end loop;

  update public.attempts
     set submitted_at = least(now(), deadline_at), status = 'marked'
   where id = a.id;
  perform public.recalc_attempt(a.id);
end;
$$;

-- 4. One-click Regrade Quiz (preserves manual overrides & essays by default)
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
  perform public.require_lecturer();
  select * into qz from public.quizzes where id = p_quiz;
  if not found then raise exception 'Quiz not found.'; end if;

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

-- 5. Short-Answer Clustering & One-Click Accept
create or replace function public.short_answer_groups(p_quiz uuid)
returns table (
  question_id uuid,
  qposition int,
  prompt text,
  max_marks numeric,
  accepted jsonb,
  norm_answer text,
  sample_answer text,
  student_count int,
  response_ids uuid[],
  already_accepted boolean,
  avg_marks numeric,
  all_full_marks boolean
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_course uuid;
begin
  select course_id into v_course from public.quizzes where id = p_quiz;
  if v_course is null then raise exception 'Quiz not found.'; end if;
  perform public.require_staff(v_course);

  return query
  with raw as (
    select
      q.id as qid,
      q.position as qpos,
      q.prompt as qprompt,
      q.marks as qmarks,
      coalesce(q.answer->'accepted', '[]'::jsonb) as qacc,
      r.id as rid,
      trim(coalesce(r.value #>> '{}', '')) as raw_txt,
      public.norm_text(coalesce(r.value #>> '{}', '')) as norm_txt,
      r.marks_awarded as mk
    from public.questions q
    join public.responses r on r.question_id = q.id
    join public.attempts a on a.id = r.attempt_id
    where q.quiz_id = p_quiz
      and q.kind = 'short'
      and a.quiz_id = p_quiz
      and a.status <> 'in_progress'
      and trim(coalesce(r.value #>> '{}', '')) <> ''
  )
  select
    raw.qid,
    raw.qpos,
    raw.qprompt,
    raw.qmarks,
    raw.qacc,
    raw.norm_txt,
    (array_agg(raw.raw_txt order by length(raw.raw_txt), raw.raw_txt))[1],
    count(*)::int,
    array_agg(raw.rid),
    exists (
      select 1 from jsonb_array_elements_text(raw.qacc) acc
      where public.norm_text(acc) = raw.norm_txt
    ),
    round(avg(coalesce(raw.mk, 0)), 2),
    bool_and(coalesce(raw.mk, 0) >= raw.qmarks)
  from raw
  group by raw.qid, raw.qpos, raw.qprompt, raw.qmarks, raw.qacc, raw.norm_txt
  order by raw.qpos, count(*) desc, min(raw.raw_txt);
end;
$$;

create or replace function public.accept_short_answer(p_quiz uuid, p_question uuid, p_answer text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  qz public.quizzes;
  q  public.questions;
  v_clean text := trim(coalesce(p_answer, ''));
  v_norm text := public.norm_text(coalesce(p_answer, ''));
  v_curr jsonb;
  v_aids uuid[];
  v_aid uuid;
  v_cnt int := 0;
begin
  select * into qz from public.quizzes where id = p_quiz;
  if not found then raise exception 'Quiz not found.'; end if;
  perform public.require_staff(qz.course_id);

  select * into q from public.questions where id = p_question and quiz_id = p_quiz;
  if not found or q.kind <> 'short' then raise exception 'Short-answer question not found.'; end if;
  if v_norm = '' then raise exception 'Answer text cannot be blank.'; end if;

  v_curr := coalesce(q.answer->'accepted', '[]'::jsonb);
  if not exists (
    select 1 from jsonb_array_elements_text(v_curr) acc where public.norm_text(acc) = v_norm
  ) then
    update public.questions
       set answer = coalesce(answer, '{}'::jsonb) || jsonb_build_object('accepted', v_curr || to_jsonb(v_clean))
     where id = p_question;
  end if;

  with updated as (
    update public.responses r
       set is_correct = true,
           marks_awarded = q.marks,
           marked_by = auth.uid()
      from public.attempts a
     where r.attempt_id = a.id
       and a.quiz_id = p_quiz
       and a.status <> 'in_progress'
       and r.question_id = p_question
       and public.norm_text(coalesce(r.value #>> '{}', '')) = v_norm
    returning r.attempt_id
  )
  select count(*)::int, coalesce(array_agg(distinct attempt_id), '{}'::uuid[])
    into v_cnt, v_aids
    from updated;

  foreach v_aid in array v_aids loop
    perform public.recalc_attempt(v_aid);
  end loop;

  perform public.log_course_audit(
    qz.course_id,
    'quiz_accept_short',
    format('Accepted short answer "%s" on "%s" (%s responses awarded)', v_clean, qz.title, v_cnt),
    jsonb_build_object('quiz_id', p_quiz, 'question_id', p_question, 'accepted_text', v_clean, 'updated_count', v_cnt)
  );

  return jsonb_build_object('updated_count', v_cnt);
end;
$$;

-- 6. Hall Access PIN + Multi-Select Stratified Quotas in start_attempt
drop function if exists public.start_attempt(uuid);
create or replace function public.start_attempt(p_quiz uuid, p_pin text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  qz       public.quizzes;
  a        public.attempts;
  w        record;
  n        int;
  v_order  uuid[];
  v_dead   timestamptz;
  v_id     uuid;
begin
  select * into qz from public.quizzes where id = p_quiz;
  if not found or not qz.published or not public.is_enrolled(qz.course_id) then
    raise exception 'This quiz is not available to you.';
  end if;

  select * into w from public.quiz_window_for(p_quiz, auth.uid());
  if not w.allowed then
    raise exception 'This quiz is not open to you.';
  end if;

  -- Resume existing live attempt cleanly (no PIN re-prompt on mid-exam refresh)
  select * into a from public.attempts
   where quiz_id = p_quiz and student_id = auth.uid() and status = 'in_progress'
   order by attempt_no desc limit 1;
  if found then
    if now() <= a.deadline_at then return a.id; end if;
    perform public.finalize_attempt(a.id);
  end if;

  -- Check optional Hall Access PIN before creating a new attempt
  if coalesce(trim(qz.access_pin), '') <> '' then
    if upper(trim(coalesce(p_pin, ''))) <> upper(trim(qz.access_pin)) then
      raise exception 'Invalid Hall Access PIN. Ask your invigilator in the exam hall.';
    end if;
  end if;

  if w.opens_at is not null and now() < w.opens_at then
    raise exception 'This quiz has not opened yet.';
  end if;
  if w.closes_at is not null and now() > w.closes_at then
    raise exception 'This quiz has closed.';
  end if;

  select count(*) into n from public.attempts where quiz_id = p_quiz and student_id = auth.uid();
  if not qz.is_practice and n >= qz.max_attempts + coalesce((select x.extra_attempts from public.quiz_access x
                                                              where x.quiz_id = p_quiz and x.index_no = public.my_index()), 0) then
    raise exception 'You have used all your attempts for this quiz.';
  end if;

  if qz.instructions ~ '<!-- QUIZ_META:(.*?)-->' then
    declare
      v_meta jsonb;
      q_mcq int; q_multi int; q_tf int; q_num int; q_short int; q_essay int;
    begin
      v_meta := (regexp_match(qz.instructions, '<!-- QUIZ_META:(.*?)-->'))[1]::jsonb;
      if (v_meta->>'format_quotas_enabled')::boolean = true and v_meta ? 'format_quotas' then
        q_mcq   := coalesce(nullif(v_meta->'format_quotas'->>'mcq', '')::int, 0);
        q_multi := coalesce(nullif(v_meta->'format_quotas'->>'multiselect', '')::int, 0);
        q_tf    := coalesce(nullif(v_meta->'format_quotas'->>'truefalse', '')::int, 0);
        q_num   := coalesce(nullif(v_meta->'format_quotas'->>'numeric', '')::int, 0);
        q_short := coalesce(nullif(v_meta->'format_quotas'->>'short', '')::int, 0);
        q_essay := coalesce(nullif(v_meta->'format_quotas'->>'essay', '')::int, 0);
        if (q_mcq + q_multi + q_tf + q_num + q_short + q_essay) > 0 then
          select array_agg(x.id order by case when qz.shuffle_questions then random() else 0 end, x.position, x.created_at)
            into v_order
            from (
              (select id, position, created_at from public.questions where quiz_id = p_quiz and kind = 'mcq' order by random() limit nullif(q_mcq, 0))
              union all
              (select id, position, created_at from public.questions where quiz_id = p_quiz and kind = 'multiselect' order by random() limit nullif(q_multi, 0))
              union all
              (select id, position, created_at from public.questions where quiz_id = p_quiz and kind = 'truefalse' order by random() limit nullif(q_tf, 0))
              union all
              (select id, position, created_at from public.questions where quiz_id = p_quiz and kind = 'numeric' order by random() limit nullif(q_num, 0))
              union all
              (select id, position, created_at from public.questions where quiz_id = p_quiz and kind = 'short' order by random() limit nullif(q_short, 0))
              union all
              (select id, position, created_at from public.questions where quiz_id = p_quiz and kind = 'essay' order by random() limit nullif(q_essay, 0))
            ) x;
        end if;
      end if;
    exception when others then
      v_order := null;
    end;
  end if;

  if v_order is null then
    select array_agg(x.id order by case when qz.shuffle_questions then random() else 0 end, x.position, x.created_at)
      into v_order
      from (select id, position, created_at from public.questions
             where quiz_id = p_quiz
             order by random()
             limit coalesce(nullif(qz.pool_size, 0), 100000)) x;
  end if;
  if v_order is null then raise exception 'This quiz has no questions yet.'; end if;

  v_dead := now() + make_interval(mins => qz.duration_minutes);
  if w.closes_at is not null and w.closes_at < v_dead then v_dead := w.closes_at; end if;

  insert into public.attempts (quiz_id, student_id, attempt_no, question_order, deadline_at)
  values (p_quiz, auth.uid(), n + 1, v_order, v_dead)
  returning id into v_id;
  return v_id;
end;
$$;

-- 7. Updated quiz visibility, attempt, review & analytics RPCs (with image_path, requires_pin, multiselect)
create or replace function public.my_quizzes(p_course uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_enrolled(p_course) then return '[]'::jsonb; end if;

  perform public.finalize_attempt(a.id)
     from public.attempts a join public.quizzes q on q.id = a.quiz_id
    where q.course_id = p_course and a.student_id = auth.uid()
      and a.status = 'in_progress' and a.deadline_at < now();

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'title', q.title, 'instructions', q.instructions,
           'opens_at', w.opens_at, 'closes_at', w.closes_at,
           'duration_minutes', q.duration_minutes,
           'max_attempts', q.max_attempts + coalesce((select x.extra_attempts from public.quiz_access x
                                                      where x.quiz_id = q.id and x.index_no = public.my_index()), 0),
           'is_practice', q.is_practice, 'lockdown', q.lockdown, 'max_exits', q.max_exits,
           'no_backtrack', q.no_backtrack,
           'requires_pin', (coalesce(trim(q.access_pin), '') <> ''),
           'question_count', least((select count(*) from public.questions x where x.quiz_id = q.id),
                                   coalesce(nullif(q.pool_size, 0), 100000)),
           'total_marks', case when coalesce(q.pool_size, 0) > 0 then null
                               else (select coalesce(sum(marks), 0) from public.questions x where x.quiz_id = q.id) end,
           'attempts_used', (select count(*) from public.attempts a where a.quiz_id = q.id and a.student_id = auth.uid()),
           'in_progress', (select a.id from public.attempts a where a.quiz_id = q.id and a.student_id = auth.uid()
                             and a.status = 'in_progress' order by attempt_no desc limit 1),
           'released', (q.results_released or q.is_practice),
           'best', (select jsonb_build_object('attempt_id', a.id, 'status', a.status,
                             'score', case when q.results_released or q.is_practice then a.score end,
                             'max_score', a.max_score, 'submitted_at', a.submitted_at)
                      from public.attempts a
                     where a.quiz_id = q.id and a.student_id = auth.uid() and a.status <> 'in_progress'
                     order by a.score desc nulls last, a.submitted_at desc limit 1))
         order by coalesce(w.opens_at, q.created_at)), '[]'::jsonb)
    into r
    from public.quizzes q
    cross join lateral public.quiz_window_for(q.id, auth.uid()) w
   where q.course_id = p_course and q.published and w.allowed;

  return r;
end;
$$;

drop function if exists public.get_attempt(uuid, text);
create or replace function public.get_attempt(p_attempt uuid, p_device text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.attempts; qz public.quizzes; c public.courses; pr public.profiles; qs jsonb;
begin
  select * into a from public.attempts where id = p_attempt and student_id = auth.uid();
  if not found then raise exception 'Attempt not found.'; end if;

  if a.status = 'in_progress' and now() > a.deadline_at then
    perform public.finalize_attempt(a.id);
    select * into a from public.attempts where id = p_attempt;
  end if;

  if a.status = 'in_progress' and coalesce(p_device, '') <> '' and not (left(p_device, 80) = any(a.devices)) then
    update public.attempts set devices = array_append(devices, left(p_device, 80)) where id = a.id
    returning * into a;
  end if;

  select * into qz from public.quizzes where id = a.quiz_id;
  select * into c from public.courses where id = qz.course_id;
  select * into pr from public.profiles where id = auth.uid();

  select jsonb_agg(jsonb_build_object(
           'id', q.id,
           'kind', q.kind,
           'prompt', q.prompt,
           'image_path', coalesce(q.image_path, ''),
           'marks', q.marks,
           'unit', q.unit,
           'decimals', q.decimals,
           'vars', case when coalesce(trim(q.formula), '') <> ''
                        then public.gen_vars(a.seed, q.id, q.params) else '{}'::jsonb end,
           'options', case
              when q.kind in ('mcq', 'multiselect') and qz.shuffle_options then
                (select coalesce(jsonb_agg(o order by md5(a.seed::text || q.id::text || (o->>'id'))), '[]'::jsonb)
                   from jsonb_array_elements(q.options) o)
              when q.kind in ('mcq', 'multiselect', 'truefalse') then q.options
              else '[]'::jsonb end,
           'value', r.value)
         order by o.ord)
    into qs
    from unnest(a.question_order) with ordinality as o(qid, ord)
    join public.questions q on q.id = o.qid
    left join public.responses r on r.attempt_id = a.id and r.question_id = q.id;

  return jsonb_build_object(
    'attempt', jsonb_build_object('id', a.id, 'status', a.status, 'started_at', a.started_at,
                                  'deadline_at', a.deadline_at, 'submitted_at', a.submitted_at,
                                  'server_now', now(), 'exits', a.exits, 'current_index', a.current_index),
    'quiz', jsonb_build_object('id', qz.id, 'title', qz.title, 'instructions', qz.instructions,
                               'reference', qz.reference, 'course_id', c.id, 'course_code', c.code,
                               'course_color', c.color, 'lockdown', qz.lockdown,
                               'max_exits', qz.max_exits, 'no_backtrack', qz.no_backtrack, 'question_time_limit', qz.question_time_limit),
    'student', jsonb_build_object('name', pr.full_name, 'index_no', pr.index_no),
    'questions', coalesce(qs, '[]'::jsonb));
end;
$$;

create or replace function public.get_attempt_review(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.attempts; qz public.quizzes; qs jsonb; v_show boolean;
begin
  select * into a from public.attempts where id = p_attempt and student_id = auth.uid();
  if not found then raise exception 'Attempt not found.'; end if;
  select * into qz from public.quizzes where id = a.quiz_id;
  if a.status = 'in_progress' then raise exception 'This attempt is still in progress.'; end if;
  if not (qz.results_released or qz.is_practice) then
    raise exception 'Results for this quiz have not been released yet.';
  end if;
  v_show := qz.show_answers or qz.is_practice;

  select jsonb_agg(jsonb_build_object(
           'id', q.id, 'kind', q.kind, 'prompt', q.prompt,
           'image_path', coalesce(q.image_path, ''),
           'marks', q.marks, 'unit', q.unit,
           'vars', case when coalesce(trim(q.formula), '') <> ''
                        then public.gen_vars(a.seed, q.id, q.params) else '{}'::jsonb end,
           'options', case when q.kind in ('mcq','multiselect','truefalse') then q.options else '[]'::jsonb end,
           'value', r.value, 'is_correct', r.is_correct, 'marks_awarded', r.marks_awarded,
           'feedback', r.feedback,
           'correct', case when not v_show then null
                           when q.kind in ('mcq','multiselect','truefalse') then q.answer->'correct'
                           when q.kind = 'short' then q.answer->'accepted'
                           when q.kind = 'numeric' then
                             (select to_jsonb(public.expected_value(q, a.seed)))
                           else null end,
           'explanation', case when v_show then q.explanation else '' end)
         order by o.ord)
    into qs
    from unnest(a.question_order) with ordinality as o(qid, ord)
    join public.questions q on q.id = o.qid
    left join public.responses r on r.attempt_id = a.id and r.question_id = q.id;

  return jsonb_build_object('title', qz.title, 'score', a.score, 'max_score', a.max_score,
                            'status', a.status, 'questions', coalesce(qs, '[]'::jsonb));
end;
$$;

create or replace function public.staff_attempt_review(p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
           'image_path', coalesce(q.image_path, ''),
           'marks', q.marks,
           'unit', q.unit,
           'vars', case when coalesce(trim(q.formula), '') <> ''
                        then public.gen_vars(a.seed, q.id, q.params) else '{}'::jsonb end,
           'options', case when q.kind in ('mcq','multiselect','truefalse') then q.options else '[]'::jsonb end,
           'value', r.value,
           'is_correct', r.is_correct,
           'marks_awarded', r.marks_awarded,
           'feedback', r.feedback,
           'correct', case
                        when q.kind in ('mcq','multiselect','truefalse') then q.answer->'correct'
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
$$;

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
               and (
                 (jsonb_typeof(rr.value) = 'array' and jsonb_array_length(rr.value) > 0)
                 or (jsonb_typeof(rr.value) <> 'array' and trim(coalesce(rr.value #>> '{}', '')) <> '')
               )
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

create or replace function public.quiz_item_analysis(p_quiz uuid)
returns table (question_id uuid, qposition int, kind text, prompt text, topic text, marks numeric, answered int,
               avg_pct numeric, discrimination numeric, by_stream jsonb, options jsonb, correct text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_lecturer();
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
         case
           when q.kind in ('mcq', 'truefalse') then
             (select coalesce(jsonb_object_agg(t.v, t.n), '{}'::jsonb)
                from (select coalesce(x.value #>> '{}', '') as v, count(*) as n from resp x where x.qid = q.id group by 1) t)
           when q.kind = 'multiselect' then
             (select coalesce(jsonb_object_agg(t.v, t.n), '{}'::jsonb)
                from (
                  select pick as v, count(*) as n
                  from resp x,
                       lateral (
                         select el as pick from jsonb_array_elements_text(
                           case when jsonb_typeof(x.value) = 'array' and jsonb_array_length(x.value) > 0 then x.value
                                else '[""]'::jsonb end
                         ) el
                       ) picks
                  where x.qid = q.id
                  group by 1
                ) t)
         end,
         case
           when q.kind = 'multiselect' then
             (select string_agg(el, ',' order by el) from jsonb_array_elements_text(coalesce(q.answer->'correct', '[]'::jsonb)) el)
           else q.answer ->> 'correct'
         end
    from public.questions q
   where q.quiz_id = p_quiz
   order by q.position, q.created_at;
end;
$$;

-- 8. Material Read / Download Tracking
create table if not exists public.material_views (
  material_id    uuid not null references public.materials(id) on delete cascade,
  student_id     uuid not null references public.profiles(id) on delete cascade,
  course_id      uuid not null references public.courses(id) on delete cascade,
  view_count     int not null default 1,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at  timestamptz not null default now(),
  primary key (material_id, student_id)
);

create index if not exists material_views_course_idx on public.material_views(course_id, student_id);

alter table public.material_views enable row level security;

drop policy if exists material_views_own on public.material_views;
create policy material_views_own on public.material_views
  for all to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

drop policy if exists material_views_staff_read on public.material_views;
create policy material_views_staff_read on public.material_views
  for select to authenticated
  using (public.is_lecturer() or public.is_ta(course_id));

create or replace function public.record_material_view(p_material uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_course uuid;
begin
  if auth.uid() is null then return; end if;
  select course_id into v_course from public.materials where id = p_material;
  if v_course is null then return; end if;
  if not public.is_enrolled(v_course) then return; end if;

  insert into public.material_views (material_id, student_id, course_id, view_count, first_viewed_at, last_viewed_at)
  values (p_material, auth.uid(), v_course, 1, now(), now())
  on conflict (material_id, student_id)
  do update set view_count = public.material_views.view_count + 1,
                last_viewed_at = now();
end;
$$;

create or replace function public.material_engagement(p_course uuid)
returns table (material_id uuid, unique_students int, total_opens int, last_opened_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(p_course);
  return query
    select mv.material_id,
           count(distinct mv.student_id)::int,
           coalesce(sum(mv.view_count), 0)::int,
           max(mv.last_viewed_at)
      from public.material_views mv
     where mv.course_id = p_course
     group by mv.material_id;
end;
$$;

create or replace function public.student_material_engagement(p_course uuid, p_student uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_total int := 0; v_viewed int := 0; v_opens int := 0; v_items jsonb;
begin
  perform public.require_staff(p_course);
  select count(*)::int into v_total from public.materials where course_id = p_course;
  select count(*)::int, coalesce(sum(view_count), 0)::int
    into v_viewed, v_opens
    from public.material_views
   where course_id = p_course and student_id = p_student;

  select coalesce(jsonb_agg(jsonb_build_object(
           'material_id', m.id,
           'title', m.title,
           'kind', m.kind,
           'view_count', mv.view_count,
           'last_viewed_at', mv.last_viewed_at)
         order by mv.last_viewed_at desc), '[]'::jsonb)
    into v_items
    from public.material_views mv
    join public.materials m on m.id = mv.material_id
   where mv.course_id = p_course and mv.student_id = p_student;

  return jsonb_build_object(
    'total_materials', v_total,
    'viewed_count', v_viewed,
    'total_opens', v_opens,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

-- 9. Grants
do $$
declare f text;
begin
  foreach f in array array[
    'regrade_quiz(uuid, boolean)',
    'short_answer_groups(uuid)',
    'accept_short_answer(uuid, uuid, text)',
    'start_attempt(uuid, text)',
    'my_quizzes(uuid)',
    'get_attempt(uuid, text)',
    'get_attempt_review(uuid)',
    'staff_attempt_review(uuid)',
    'quiz_live_status(uuid)',
    'quiz_item_analysis(uuid)',
    'record_material_view(uuid)',
    'material_engagement(uuid)',
    'student_material_engagement(uuid, uuid)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- 10. Written Answer Typing & Burst Signals
alter table public.attempts add column if not exists typing_telemetry jsonb not null default '{}'::jsonb;

create or replace function public.save_typing_telemetry(p_attempt uuid, p_telemetry jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_attempt is null then return; end if;
  update public.attempts
     set typing_telemetry = coalesce(typing_telemetry, '{}'::jsonb) || coalesce(p_telemetry, '{}'::jsonb)
   where id = p_attempt
     and student_id = auth.uid()
     and status = 'in_progress';
end;
$$;

drop function if exists public.quiz_typing_signals(uuid);
create or replace function public.quiz_typing_signals(p_quiz uuid)
returns table (
  attempt_id uuid,
  student_id uuid,
  index_no text,
  full_name text,
  programme text,
  stream text,
  typing_telemetry jsonb
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_course uuid;
begin
  select course_id into v_course from public.quizzes where id = p_quiz;
  if v_course is null then raise exception 'Quiz not found.'; end if;
  perform public.require_staff(v_course);
  return query
    select b.id,
           p.id,
           r.index_no,
           r.full_name,
           r.programme,
           r.stream,
           coalesce(b.typing_telemetry, '{}'::jsonb)
      from public.enrollments e
      join public.roster r on r.index_no = e.index_no
      join public.profiles p on p.index_no = r.index_no
      join lateral (
        select a.* from public.attempts a
         where a.quiz_id = p_quiz and a.student_id = p.id
         order by (a.status = 'in_progress'), a.score desc nulls last, a.submitted_at desc
         limit 1
      ) b on true
     where e.course_id = v_course
       and b.typing_telemetry is not null
       and b.typing_telemetry <> '{}'::jsonb
     order by r.full_name, r.index_no;
end;
$$;

-- 11. Syndicate / Group Case Study Submissions & Shared File Access
create or replace function public.submit_group_assignment(
  p_assignment uuid,
  p_path text,
  p_name text,
  p_note text,
  p_member_indexes text[] default '{}'
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  x public.assignments;
  v_late boolean;
  v_member_uid uuid;
  v_idx text;
begin
  if not public.can_submit(p_assignment) then
    raise exception 'This assignment is closed or has already been marked.';
  end if;
  if p_path is null or regexp_replace(p_path, '^r2:', '') not like p_assignment::text || '/' || auth.uid()::text || '/%' then
    raise exception 'Upload location is not valid.';
  end if;
  select * into x from public.assignments where id = p_assignment;
  v_late := x.due_at is not null and now() > x.due_at;

  insert into public.submissions (assignment_id, student_id, file_path, file_name, note, submitted_at, is_late)
  values (p_assignment, auth.uid(), p_path, coalesce(p_name, ''), coalesce(p_note, ''), now(), v_late)
  on conflict (assignment_id, student_id) do update
     set file_path = excluded.file_path,
         file_name = excluded.file_name,
         note = excluded.note,
         submitted_at = now(),
         is_late = excluded.is_late;

  if p_member_indexes is not null and coalesce(array_length(p_member_indexes, 1), 0) > 0 then
    foreach v_idx in array p_member_indexes loop
      select p.id into v_member_uid
        from public.profiles p
        join public.enrollments e on e.index_no = p.index_no
       where e.course_id = x.course_id
         and upper(trim(p.index_no)) = upper(trim(v_idx))
         and p.id <> auth.uid()
       limit 1;
      if v_member_uid is not null then
        insert into public.submissions (assignment_id, student_id, file_path, file_name, note, submitted_at, is_late)
        values (p_assignment, v_member_uid, p_path, coalesce(p_name, ''), coalesce(p_note, ''), now(), v_late)
        on conflict (assignment_id, student_id) do update
           set file_path = excluded.file_path,
               file_name = excluded.file_name,
               note = excluded.note,
               submitted_at = now(),
               is_late = excluded.is_late
         where public.submissions.marks is null;
      end if;
    end loop;
  end if;
  return now();
end;
$$;

create or replace function public.mark_syndicate_submission(
  p_assignment uuid,
  p_source_submission uuid,
  p_member_indexes text[],
  p_marks numeric,
  p_feedback text
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_course uuid;
  v_max numeric;
  v_src public.submissions;
  v_idx text;
  v_member_uid uuid;
  v_cnt int := 0;
begin
  select x.course_id, x.max_marks into v_course, v_max
    from public.assignments x
   where x.id = p_assignment;
  if v_course is null then raise exception 'Assignment not found.'; end if;
  perform public.require_staff(v_course);
  if p_marks is not null and (p_marks < 0 or p_marks > v_max) then
    raise exception 'Marks must be between 0 and %.', v_max;
  end if;

  select * into v_src from public.submissions where id = p_source_submission and assignment_id = p_assignment;
  if not found then raise exception 'Source submission not found.'; end if;

  update public.submissions
     set marks = p_marks,
         feedback = coalesce(p_feedback, ''),
         marked_at = case when p_marks is null then null else now() end,
         marked_by = case when p_marks is null then null else auth.uid() end
   where id = v_src.id;
  v_cnt := 1;

  if p_member_indexes is not null and coalesce(array_length(p_member_indexes, 1), 0) > 0 then
    foreach v_idx in array p_member_indexes loop
      select p.id into v_member_uid
        from public.profiles p
        join public.enrollments e on e.index_no = p.index_no
       where e.course_id = v_course
         and upper(trim(p.index_no)) = upper(trim(v_idx))
         and p.id <> v_src.student_id
       limit 1;
      if v_member_uid is not null then
        insert into public.submissions (
          assignment_id, student_id, file_path, file_name, note, submitted_at, is_late,
          marks, feedback, marked_at, marked_by
        )
        values (
          p_assignment, v_member_uid, v_src.file_path, v_src.file_name, v_src.note, v_src.submitted_at, v_src.is_late,
          p_marks, coalesce(p_feedback, ''),
          case when p_marks is null then null else now() end,
          case when p_marks is null then null else auth.uid() end
        )
        on conflict (assignment_id, student_id) do update
           set file_path = coalesce(nullif(public.submissions.file_path, ''), excluded.file_path),
               file_name = coalesce(nullif(public.submissions.file_name, ''), excluded.file_name),
               marks = excluded.marks,
               feedback = excluded.feedback,
               marked_at = excluded.marked_at,
               marked_by = excluded.marked_by;
        v_cnt := v_cnt + 1;
      end if;
    end loop;
  end if;

  perform public.log_course_audit(
    v_course,
    'mark_syndicate_assignment',
    format('Marked syndicate group (%s / %s) across %s member(s)', p_marks, v_max, v_cnt),
    jsonb_build_object('assignment_id', p_assignment, 'source_submission', p_source_submission, 'members_marked', v_cnt, 'marks', p_marks)
  );
  return v_cnt;
end;
$$;

drop policy if exists "submissions read" on storage.objects;
create policy "submissions read" on storage.objects for select to authenticated
  using (bucket_id = 'submissions'
         and (public.is_lecturer()
              or (storage.foldername(name))[2] = auth.uid()::text
              or exists (
                select 1 from public.submissions s
                 where s.assignment_id = public.try_uuid((storage.foldername(name))[1])
                   and s.student_id = auth.uid()
                   and regexp_replace(s.file_path, '^r2:', '') = name
              )
              or public.is_ta((select course_id from public.assignments
                                where id = public.try_uuid((storage.foldername(name))[1])))));

create or replace function public.file_access(p_bucket text, p_path text, p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  clean_path text := regexp_replace(coalesce(p_path, ''), '^r2:', '');
  parts text[] := string_to_array(clean_path, '/');
begin
  if auth.uid() is null or coalesce(p_path, '') like '%..%' or cardinality(parts) < 2 then return false; end if;
  if p_bucket = 'materials' then
    if p_action = 'download' then
      return public.is_lecturer() or public.is_ta(public.try_uuid(parts[1])) or public.is_enrolled(public.try_uuid(parts[1]));
    end if;
    return public.is_lecturer();
  elsif p_bucket = 'submissions' then
    if cardinality(parts) < 3 then return false; end if;
    if p_action = 'download' then
      return public.is_lecturer()
          or parts[2] = auth.uid()::text
          or exists (
            select 1 from public.submissions s
             where s.assignment_id = public.try_uuid(parts[1])
               and s.student_id = auth.uid()
               and regexp_replace(s.file_path, '^r2:', '') = clean_path
          )
          or public.is_ta((select course_id from public.assignments where id = public.try_uuid(parts[1])));
    end if;
    if p_action = 'upload' then
      return parts[2] = auth.uid()::text and public.can_submit(public.try_uuid(parts[1]));
    end if;
    return public.is_lecturer();
  end if;
  return false;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'save_typing_telemetry(uuid, jsonb)',
    'quiz_typing_signals(uuid)',
    'submit_group_assignment(uuid, text, text, text, text[])',
    'mark_syndicate_submission(uuid, uuid, text[], numeric, text)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 12. Confidential Syndicate Peer-Contribution Check
-- ---------------------------------------------------------------------
create table if not exists public.syndicate_peer_reviews (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments on delete cascade,
  course_id      uuid not null references public.courses on delete cascade,
  reviewer_id    uuid not null references public.profiles on delete cascade,
  reviewer_index text not null default '',
  ratings        jsonb not null default '[]'::jsonb,
  submitted_at   timestamptz not null default now(),
  unique (assignment_id, reviewer_id)
);

alter table public.syndicate_peer_reviews enable row level security;

drop policy if exists "peer reviews self read" on public.syndicate_peer_reviews;
create policy "peer reviews self read" on public.syndicate_peer_reviews
  for select to authenticated
  using (reviewer_id = auth.uid() or public.is_staff(course_id));

drop policy if exists "peer reviews self write" on public.syndicate_peer_reviews;
create policy "peer reviews self write" on public.syndicate_peer_reviews
  for insert to authenticated
  with check (reviewer_id = auth.uid() and public.is_enrolled(course_id));

drop policy if exists "peer reviews self update" on public.syndicate_peer_reviews;
create policy "peer reviews self update" on public.syndicate_peer_reviews
  for update to authenticated
  using (reviewer_id = auth.uid() and public.is_enrolled(course_id))
  with check (reviewer_id = auth.uid() and public.is_enrolled(course_id));

create or replace function public.save_syndicate_peer_review(
  p_assignment uuid,
  p_ratings jsonb
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_course uuid;
  v_idx text;
begin
  select course_id into v_course from public.assignments where id = p_assignment and published;
  if v_course is null then raise exception 'Assignment not found.'; end if;
  if not public.is_enrolled(v_course) then raise exception 'You are not enrolled in this course.'; end if;

  select index_no into v_idx from public.profiles where id = auth.uid();

  insert into public.syndicate_peer_reviews (assignment_id, course_id, reviewer_id, reviewer_index, ratings, submitted_at)
  values (p_assignment, v_course, auth.uid(), coalesce(v_idx, ''), coalesce(p_ratings, '[]'::jsonb), now())
  on conflict (assignment_id, reviewer_id) do update
     set ratings = excluded.ratings,
         reviewer_index = excluded.reviewer_index,
         submitted_at = now();

  return now();
end;
$$;

create or replace function public.my_syndicate_peer_review(
  p_assignment uuid
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_row public.syndicate_peer_reviews;
begin
  select * into v_row
    from public.syndicate_peer_reviews
   where assignment_id = p_assignment
     and reviewer_id = auth.uid();
  if not found then
    return jsonb_build_object('ratings', '[]'::jsonb, 'submitted_at', null);
  end if;
  return jsonb_build_object('ratings', v_row.ratings, 'submitted_at', v_row.submitted_at);
end;
$$;

create or replace function public.assignment_peer_reviews(
  p_assignment uuid
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_course uuid;
  v_rows jsonb;
begin
  select course_id into v_course from public.assignments where id = p_assignment;
  if v_course is null then raise exception 'Assignment not found.'; end if;
  perform public.require_staff(v_course);

  select coalesce(jsonb_agg(jsonb_build_object(
    'reviewer_index', r.reviewer_index,
    'reviewer_name', coalesce(p.full_name, r.reviewer_index),
    'ratings', r.ratings,
    'submitted_at', r.submitted_at
  ) order by r.submitted_at desc), '[]'::jsonb)
  into v_rows
  from public.syndicate_peer_reviews r
  left join public.profiles p on p.id = r.reviewer_id
  where r.assignment_id = p_assignment;

  return jsonb_build_object('reviews', v_rows);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'save_syndicate_peer_review(uuid, jsonb)',
    'my_syndicate_peer_review(uuid)',
    'assignment_peer_reviews(uuid)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 13. Assignment Cohort Targeting (Programme / Stream / Class)
-- ---------------------------------------------------------------------
create or replace function public.assignment_for(
  p_instructions text,
  p_programme text,
  p_stream text
) returns boolean
language plpgsql immutable as $$
declare
  v_match text[];
  v_meta jsonb;
  v_aud jsonb;
  v_classes jsonb;
  v_progs jsonb;
  v_streams jsonb;
  v_prog text := lower(regexp_replace(btrim(coalesce(p_programme, '')), '\s+', ' ', 'g'));
  v_stream text := lower(regexp_replace(btrim(coalesce(p_stream, '')), '\s+', ' ', 'g'));
begin
  if p_instructions is null or position('ASSIGN_META:' in p_instructions) = 0 then
    return true;
  end if;
  v_match := regexp_match(p_instructions, '<!--\s*ASSIGN_META:(\{.*?\})\s*-->\s*$');
  if v_match is null or array_length(v_match, 1) < 1 then
    return true;
  end if;
  begin
    v_meta := v_match[1]::jsonb;
  exception when others then
    return true;
  end;

  v_aud := v_meta -> 'audience';
  if v_aud is null or jsonb_typeof(v_aud) <> 'object' then
    return true;
  end if;

  v_classes := v_aud -> 'classes';
  v_progs := v_aud -> 'programmes';
  v_streams := v_aud -> 'streams';

  if (v_classes is null or jsonb_typeof(v_classes) <> 'array' or jsonb_array_length(v_classes) = 0)
     and (v_progs is null or jsonb_typeof(v_progs) <> 'array' or jsonb_array_length(v_progs) = 0)
     and (v_streams is null or jsonb_typeof(v_streams) <> 'array' or jsonb_array_length(v_streams) = 0) then
    return true;
  end if;

  if jsonb_typeof(v_classes) = 'array' and jsonb_array_length(v_classes) > 0 then
    return exists (
      select 1
      from jsonb_array_elements_text(v_classes) as c(val)
      where lower(regexp_replace(btrim(split_part(c.val, '|', 1)), '\s+', ' ', 'g'))
            || '|' ||
            lower(regexp_replace(btrim(split_part(c.val, '|', 2)), '\s+', ' ', 'g'))
            = v_prog || '|' || v_stream
    );
  end if;

  if jsonb_typeof(v_progs) = 'array' and jsonb_array_length(v_progs) > 0 then
    if not exists (
      select 1 from jsonb_array_elements_text(v_progs) as p(val)
      where lower(regexp_replace(btrim(p.val), '\s+', ' ', 'g')) = v_prog
    ) then
      return false;
    end if;
  end if;

  if jsonb_typeof(v_streams) = 'array' and jsonb_array_length(v_streams) > 0 then
    if not exists (
      select 1 from jsonb_array_elements_text(v_streams) as st(val)
      where lower(regexp_replace(btrim(st.val), '\s+', ' ', 'g')) = v_stream
    ) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

create or replace function public.my_cohort() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
       'index_no', p.index_no,
       'programme', coalesce(r.programme, ''),
       'stream', coalesce(r.stream, '')
     )
     from public.profiles p
     left join public.roster r on upper(trim(r.index_no)) = upper(trim(p.index_no))
     where p.id = auth.uid()
     limit 1),
    jsonb_build_object('index_no', null, 'programme', '', 'stream', '')
  );
$$;

create or replace function public.can_submit(p_assignment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.assignments x
    join public.profiles p on p.id = auth.uid()
    left join public.roster r on upper(trim(r.index_no)) = upper(trim(p.index_no))
    where x.id = p_assignment
      and x.published
      and public.is_enrolled(x.course_id)
      and (
        public.assignment_for(x.instructions, r.programme, r.stream)
        or exists (
          select 1 from public.submissions s0
          where s0.assignment_id = x.id and s0.student_id = auth.uid()
        )
      )
      and (x.due_at is null or now() <= x.due_at or x.allow_late)
      and not exists (
        select 1 from public.submissions s
        where s.assignment_id = x.id and s.student_id = auth.uid() and s.marks is not null
      )
  );
$$;

create or replace function public.my_assignments(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
  v_prog text;
  v_stream text;
begin
  if not public.is_enrolled(p_course) then return '[]'::jsonb; end if;
  select r0.programme, r0.stream into v_prog, v_stream
    from public.profiles p0
    left join public.roster r0 on upper(trim(r0.index_no)) = upper(trim(p0.index_no))
   where p0.id = auth.uid()
   limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'title', x.title, 'instructions', x.instructions, 'due_at', x.due_at,
           'max_marks', x.max_marks, 'allow_late', x.allow_late,
           'released', x.results_released,
           'submission', (select jsonb_build_object(
                                 'file_name', s.file_name, 'file_path', s.file_path,
                                 'submitted_at', s.submitted_at, 'is_late', s.is_late,
                                 'marked', s.marks is not null,
                                 'marks', case when x.results_released then s.marks end,
                                 'feedback', case when x.results_released then s.feedback end)
                            from public.submissions s
                           where s.assignment_id = x.id and s.student_id = auth.uid()))
         order by x.due_at nulls last, x.created_at), '[]'::jsonb)
    into r
    from public.assignments x
   where x.course_id = p_course
     and x.published
     and (
       public.assignment_for(x.instructions, v_prog, v_stream)
       or exists (
         select 1 from public.submissions s0
         where s0.assignment_id = x.id and s0.student_id = auth.uid()
       )
     );
  return r;
end;
$$;

create or replace function public.my_upcoming() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t.due), '[]'::jsonb) from (
    select 'quiz' as kind, q.id, q.title, c.id as course_id, c.code as course_code, c.color,
           case when w.opens_at > now() then w.opens_at else coalesce(w.closes_at, now()) end as due,
           w.opens_at, w.closes_at, q.duration_minutes,
           least((select count(*) from public.questions x where x.quiz_id = q.id),
                 coalesce(nullif(q.pool_size, 0), 100000)) as question_count
      from public.quizzes q join public.courses c on c.id = q.course_id
      cross join lateral public.quiz_window_for(q.id, auth.uid()) w
     where q.published and not q.is_practice and public.is_enrolled(c.id) and w.allowed
       and (w.closes_at is null or w.closes_at > now())
       and not exists (select 1 from public.attempts a where a.quiz_id = q.id
                         and a.student_id = auth.uid() and a.status <> 'in_progress')
    union all
    select 'assignment', x.id, x.title, c.id, c.code, c.color, x.due_at, null, x.due_at, null, null
      from public.assignments x
      join public.courses c on c.id = x.course_id
      join public.profiles p on p.id = auth.uid()
      left join public.roster r on upper(trim(r.index_no)) = upper(trim(p.index_no))
     where x.published and public.is_enrolled(c.id) and x.due_at > now()
       and public.assignment_for(x.instructions, r.programme, r.stream)
       and not exists (select 1 from public.submissions s where s.assignment_id = x.id and s.student_id = auth.uid())
  ) t;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'assignment_for(text, text, text)',
    'my_cohort()',
    'can_submit(uuid)',
    'my_assignments(uuid)',
    'my_upcoming()'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 14. Typed Assignment Responses & Strict File-Format Enforcement
-- ---------------------------------------------------------------------
alter table public.submissions add column if not exists response_text text not null default '';
alter table public.submissions add column if not exists typing_meta jsonb not null default '{}'::jsonb;

create or replace function public.assignment_allowed_file(
  p_instructions text,
  p_file_name text
) returns text
language plpgsql immutable as $$
declare
  v_match text[];
  v_meta jsonb;
  v_fmt text;
  v_name text := lower(btrim(coalesce(p_file_name, '')));
begin
  if p_instructions is null or position('ASSIGN_META:' in p_instructions) = 0 then
    return null;
  end if;
  v_match := regexp_match(p_instructions, '<!--\s*ASSIGN_META:(\{.*?\})\s*-->\s*$');
  if v_match is null or array_length(v_match, 1) < 1 then
    return null;
  end if;
  begin
    v_meta := v_match[1]::jsonb;
  exception when others then
    return null;
  end;
  v_fmt := coalesce(v_meta -> 'submission' ->> 'fileFormat', 'all');
  if v_fmt = 'pdf' and v_name !~ '\.pdf$' then
    return 'Only PDF files (.pdf) are accepted for this assignment.';
  end if;
  if v_fmt = 'docs' and v_name !~ '\.(pdf|doc|docx)$' then
    return 'Only PDF or Word documents (.pdf, .doc, .docx) are accepted for this assignment.';
  end if;
  return null;
end;
$$;

drop function if exists public.submit_assignment(uuid, text, text, text);
create or replace function public.submit_assignment(
  p_assignment uuid,
  p_path text,
  p_name text,
  p_note text,
  p_response_text text default '',
  p_typing_meta jsonb default '{}'::jsonb
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  x public.assignments;
  v_fmt_err text;
  v_is_typed_only boolean := (p_path = 'typed:online');
begin
  if not public.can_submit(p_assignment) then
    raise exception 'This assignment is closed or has already been marked.';
  end if;
  select * into x from public.assignments where id = p_assignment;

  if v_is_typed_only then
    if coalesce(btrim(p_response_text), '') = '' then
      raise exception 'Please type your response before submitting.';
    end if;
  else
    if p_path is null or regexp_replace(p_path, '^r2:', '') not like p_assignment::text || '/' || auth.uid()::text || '/%' then
      raise exception 'Upload location is not valid.';
    end if;
    v_fmt_err := public.assignment_allowed_file(x.instructions, p_name);
    if v_fmt_err is not null then
      raise exception '%', v_fmt_err;
    end if;
  end if;

  insert into public.submissions (
    assignment_id, student_id, file_path, file_name, note, response_text, typing_meta, submitted_at, is_late
  )
  values (
    p_assignment, auth.uid(), p_path, coalesce(p_name, ''), coalesce(p_note, ''),
    coalesce(p_response_text, ''), coalesce(p_typing_meta, '{}'::jsonb),
    now(), x.due_at is not null and now() > x.due_at
  )
  on conflict (assignment_id, student_id) do update
     set file_path = excluded.file_path,
         file_name = excluded.file_name,
         note = excluded.note,
         response_text = excluded.response_text,
         typing_meta = excluded.typing_meta,
         submitted_at = now(),
         is_late = excluded.is_late;
  return now();
end;
$$;

drop function if exists public.submit_group_assignment(uuid, text, text, text, text[]);
create or replace function public.submit_group_assignment(
  p_assignment uuid,
  p_path text,
  p_name text,
  p_note text,
  p_member_indexes text[] default '{}',
  p_response_text text default '',
  p_typing_meta jsonb default '{}'::jsonb
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  x public.assignments;
  v_late boolean;
  v_member_uid uuid;
  v_idx text;
  v_fmt_err text;
  v_is_typed_only boolean := (p_path = 'typed:online');
begin
  if not public.can_submit(p_assignment) then
    raise exception 'This assignment is closed or has already been marked.';
  end if;
  select * into x from public.assignments where id = p_assignment;

  if v_is_typed_only then
    if coalesce(btrim(p_response_text), '') = '' then
      raise exception 'Please type your response before submitting.';
    end if;
  else
    if p_path is null or regexp_replace(p_path, '^r2:', '') not like p_assignment::text || '/' || auth.uid()::text || '/%' then
      raise exception 'Upload location is not valid.';
    end if;
    v_fmt_err := public.assignment_allowed_file(x.instructions, p_name);
    if v_fmt_err is not null then
      raise exception '%', v_fmt_err;
    end if;
  end if;

  v_late := x.due_at is not null and now() > x.due_at;

  insert into public.submissions (
    assignment_id, student_id, file_path, file_name, note, response_text, typing_meta, submitted_at, is_late
  )
  values (
    p_assignment, auth.uid(), p_path, coalesce(p_name, ''), coalesce(p_note, ''),
    coalesce(p_response_text, ''), coalesce(p_typing_meta, '{}'::jsonb), now(), v_late
  )
  on conflict (assignment_id, student_id) do update
     set file_path = excluded.file_path,
         file_name = excluded.file_name,
         note = excluded.note,
         response_text = excluded.response_text,
         typing_meta = excluded.typing_meta,
         submitted_at = now(),
         is_late = excluded.is_late;

  if p_member_indexes is not null and coalesce(array_length(p_member_indexes, 1), 0) > 0 then
    foreach v_idx in array p_member_indexes loop
      select p.id into v_member_uid
        from public.profiles p
        join public.enrollments e on e.index_no = p.index_no
       where e.course_id = x.course_id
         and upper(trim(p.index_no)) = upper(trim(v_idx))
         and p.id <> auth.uid()
       limit 1;
      if v_member_uid is not null then
        insert into public.submissions (
          assignment_id, student_id, file_path, file_name, note, response_text, typing_meta, submitted_at, is_late
        )
        values (
          p_assignment, v_member_uid, p_path, coalesce(p_name, ''), coalesce(p_note, ''),
          coalesce(p_response_text, ''), coalesce(p_typing_meta, '{}'::jsonb), now(), v_late
        )
        on conflict (assignment_id, student_id) do update
           set file_path = excluded.file_path,
               file_name = excluded.file_name,
               note = excluded.note,
               response_text = excluded.response_text,
               typing_meta = excluded.typing_meta,
               submitted_at = now(),
               is_late = excluded.is_late
         where public.submissions.marks is null;
      end if;
    end loop;
  end if;
  return now();
end;
$$;

create or replace function public.my_assignments(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
  v_prog text;
  v_stream text;
begin
  if not public.is_enrolled(p_course) then return '[]'::jsonb; end if;
  select r0.programme, r0.stream into v_prog, v_stream
    from public.profiles p0
    left join public.roster r0 on upper(trim(r0.index_no)) = upper(trim(p0.index_no))
   where p0.id = auth.uid()
   limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'title', x.title, 'instructions', x.instructions, 'due_at', x.due_at,
           'max_marks', x.max_marks, 'allow_late', x.allow_late,
           'released', x.results_released,
           'submission', (select jsonb_build_object(
                                 'file_name', s.file_name, 'file_path', s.file_path,
                                 'note', s.note,
                                 'response_text', s.response_text,
                                 'typing_meta', s.typing_meta,
                                 'submitted_at', s.submitted_at, 'is_late', s.is_late,
                                 'marked', s.marks is not null,
                                 'marks', case when x.results_released then s.marks end,
                                 'feedback', case when x.results_released then s.feedback end)
                            from public.submissions s
                           where s.assignment_id = x.id and s.student_id = auth.uid()))
         order by x.due_at nulls last, x.created_at), '[]'::jsonb)
    into r
    from public.assignments x
   where x.course_id = p_course
     and x.published
     and (
       public.assignment_for(x.instructions, v_prog, v_stream)
       or exists (
         select 1 from public.submissions s0
         where s0.assignment_id = x.id and s0.student_id = auth.uid()
       )
     );
  return r;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'assignment_allowed_file(text, text)',
    'submit_assignment(uuid, text, text, text, text, jsonb)',
    'submit_group_assignment(uuid, text, text, text, text[], text, jsonb)',
    'my_assignments(uuid)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- ---------------------------------------------------------------------
-- 15. Per-Class/Student Deadlines, Live Polls & Exit Tickets, Anonymous TQM Feedback
-- ---------------------------------------------------------------------
create or replace function public.assignment_due_for(
  p_instructions text,
  p_default_due timestamptz,
  p_index_no text,
  p_programme text,
  p_stream text
) returns timestamptz
language plpgsql immutable as $$
declare
  v_match text[];
  v_meta jsonb;
  v_dl jsonb;
  v_by_student jsonb;
  v_by_class jsonb;
  v_idx text := upper(btrim(coalesce(p_index_no, '')));
  v_prog text := lower(regexp_replace(btrim(coalesce(p_programme, '')), '\s+', ' ', 'g'));
  v_stream text := lower(regexp_replace(btrim(coalesce(p_stream, '')), '\s+', ' ', 'g'));
  v_target_key text;
  k text;
  v text;
begin
  if p_instructions is null or position('ASSIGN_META:' in p_instructions) = 0 then
    return p_default_due;
  end if;
  v_match := regexp_match(p_instructions, '<!--\s*ASSIGN_META:(\{.*?\})\s*-->\s*$');
  if v_match is null or array_length(v_match, 1) < 1 then
    return p_default_due;
  end if;
  begin
    v_meta := v_match[1]::jsonb;
  exception when others then
    return p_default_due;
  end;

  v_dl := v_meta -> 'deadlines';
  if v_dl is null or jsonb_typeof(v_dl) <> 'object' then
    return p_default_due;
  end if;

  v_by_student := v_dl -> 'byStudent';
  if v_idx <> '' and jsonb_typeof(v_by_student) = 'object' then
    for k, v in select * from jsonb_each_text(v_by_student) loop
      if upper(btrim(k)) = v_idx and coalesce(btrim(v), '') <> '' then
        begin
          return v::timestamptz;
        exception when others then
          null;
        end;
      end if;
    end loop;
  end if;

  v_by_class := v_dl -> 'byClass';
  v_target_key := v_prog || '|' || v_stream;
  if jsonb_typeof(v_by_class) = 'object' then
    for k, v in select * from jsonb_each_text(v_by_class) loop
      if lower(regexp_replace(btrim(split_part(k, '|', 1)), '\s+', ' ', 'g'))
         || '|' ||
         lower(regexp_replace(btrim(split_part(k, '|', 2)), '\s+', ' ', 'g')) = v_target_key
         and coalesce(btrim(v), '') <> '' then
        begin
          return v::timestamptz;
        exception when others then
          null;
        end;
      end if;
    end loop;
  end if;

  return p_default_due;
end;
$$;

create or replace function public.can_submit(p_assignment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.assignments x
    join public.profiles p on p.id = auth.uid()
    left join public.roster r on upper(trim(r.index_no)) = upper(trim(p.index_no))
    cross join lateral (
      select public.assignment_due_for(x.instructions, x.due_at, p.index_no, r.programme, r.stream) as eff_due
    ) d
    where x.id = p_assignment
      and x.published
      and public.is_enrolled(x.course_id)
      and (
        public.assignment_for(x.instructions, r.programme, r.stream)
        or exists (
          select 1 from public.submissions s0
          where s0.assignment_id = x.id and s0.student_id = auth.uid()
        )
      )
      and (d.eff_due is null or now() <= d.eff_due or x.allow_late)
      and not exists (
        select 1 from public.submissions s
        where s.assignment_id = x.id and s.student_id = auth.uid() and s.marks is not null
      )
  );
$$;

create or replace function public.submit_assignment(
  p_assignment uuid,
  p_path text,
  p_name text,
  p_note text,
  p_response_text text default '',
  p_typing_meta jsonb default '{}'::jsonb
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  x public.assignments;
  v_fmt_err text;
  v_is_typed_only boolean := (p_path = 'typed:online');
  v_idx_caller text;
  v_prog text;
  v_stream text;
  v_due timestamptz;
begin
  if not public.can_submit(p_assignment) then
    raise exception 'This assignment is closed or has already been marked.';
  end if;
  select * into x from public.assignments where id = p_assignment;

  select p.index_no, r.programme, r.stream into v_idx_caller, v_prog, v_stream
    from public.profiles p
    left join public.roster r on upper(trim(r.index_no)) = upper(trim(p.index_no))
   where p.id = auth.uid()
   limit 1;
  v_due := public.assignment_due_for(x.instructions, x.due_at, v_idx_caller, v_prog, v_stream);

  if v_is_typed_only then
    if coalesce(btrim(p_response_text), '') = '' then
      raise exception 'Please type your response before submitting.';
    end if;
  else
    if p_path is null or regexp_replace(p_path, '^r2:', '') not like p_assignment::text || '/' || auth.uid()::text || '/%' then
      raise exception 'Upload location is not valid.';
    end if;
    v_fmt_err := public.assignment_allowed_file(x.instructions, p_name);
    if v_fmt_err is not null then
      raise exception '%', v_fmt_err;
    end if;
  end if;

  insert into public.submissions (
    assignment_id, student_id, file_path, file_name, note, response_text, typing_meta, submitted_at, is_late
  )
  values (
    p_assignment, auth.uid(), p_path, coalesce(p_name, ''), coalesce(p_note, ''),
    coalesce(p_response_text, ''), coalesce(p_typing_meta, '{}'::jsonb),
    now(), v_due is not null and now() > v_due
  )
  on conflict (assignment_id, student_id) do update
     set file_path = excluded.file_path,
         file_name = excluded.file_name,
         note = excluded.note,
         response_text = excluded.response_text,
         typing_meta = excluded.typing_meta,
         submitted_at = now(),
         is_late = excluded.is_late;
  return now();
end;
$$;

create or replace function public.submit_group_assignment(
  p_assignment uuid,
  p_path text,
  p_name text,
  p_note text,
  p_member_indexes text[] default '{}',
  p_response_text text default '',
  p_typing_meta jsonb default '{}'::jsonb
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  x public.assignments;
  v_late boolean;
  v_member_uid uuid;
  v_idx text;
  v_fmt_err text;
  v_is_typed_only boolean := (p_path = 'typed:online');
  v_idx_caller text;
  v_prog text;
  v_stream text;
  v_due timestamptz;
begin
  if not public.can_submit(p_assignment) then
    raise exception 'This assignment is closed or has already been marked.';
  end if;
  select * into x from public.assignments where id = p_assignment;

  select p.index_no, r.programme, r.stream into v_idx_caller, v_prog, v_stream
    from public.profiles p
    left join public.roster r on upper(trim(r.index_no)) = upper(trim(p.index_no))
   where p.id = auth.uid()
   limit 1;
  v_due := public.assignment_due_for(x.instructions, x.due_at, v_idx_caller, v_prog, v_stream);

  if v_is_typed_only then
    if coalesce(btrim(p_response_text), '') = '' then
      raise exception 'Please type your response before submitting.';
    end if;
  else
    if p_path is null or regexp_replace(p_path, '^r2:', '') not like p_assignment::text || '/' || auth.uid()::text || '/%' then
      raise exception 'Upload location is not valid.';
    end if;
    v_fmt_err := public.assignment_allowed_file(x.instructions, p_name);
    if v_fmt_err is not null then
      raise exception '%', v_fmt_err;
    end if;
  end if;

  v_late := v_due is not null and now() > v_due;

  insert into public.submissions (
    assignment_id, student_id, file_path, file_name, note, response_text, typing_meta, submitted_at, is_late
  )
  values (
    p_assignment, auth.uid(), p_path, coalesce(p_name, ''), coalesce(p_note, ''),
    coalesce(p_response_text, ''), coalesce(p_typing_meta, '{}'::jsonb), now(), v_late
  )
  on conflict (assignment_id, student_id) do update
     set file_path = excluded.file_path,
         file_name = excluded.file_name,
         note = excluded.note,
         response_text = excluded.response_text,
         typing_meta = excluded.typing_meta,
         submitted_at = now(),
         is_late = excluded.is_late;

  if p_member_indexes is not null and coalesce(array_length(p_member_indexes, 1), 0) > 0 then
    foreach v_idx in array p_member_indexes loop
      select p.id into v_member_uid
        from public.profiles p
        join public.enrollments e on e.index_no = p.index_no
       where e.course_id = x.course_id
         and upper(trim(p.index_no)) = upper(trim(v_idx))
         and p.id <> auth.uid()
       limit 1;
      if v_member_uid is not null then
        insert into public.submissions (
          assignment_id, student_id, file_path, file_name, note, response_text, typing_meta, submitted_at, is_late
        )
        values (
          p_assignment, v_member_uid, p_path, coalesce(p_name, ''), coalesce(p_note, ''),
          coalesce(p_response_text, ''), coalesce(p_typing_meta, '{}'::jsonb), now(), v_late
        )
        on conflict (assignment_id, student_id) do update
           set file_path = excluded.file_path,
               file_name = excluded.file_name,
               note = excluded.note,
               response_text = excluded.response_text,
               typing_meta = excluded.typing_meta,
               submitted_at = now(),
               is_late = excluded.is_late
         where public.submissions.marks is null;
      end if;
    end loop;
  end if;
  return now();
end;
$$;

create or replace function public.my_assignments(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
  v_idx text;
  v_prog text;
  v_stream text;
begin
  if not public.is_enrolled(p_course) then return '[]'::jsonb; end if;
  select p0.index_no, r0.programme, r0.stream into v_idx, v_prog, v_stream
    from public.profiles p0
    left join public.roster r0 on upper(trim(r0.index_no)) = upper(trim(p0.index_no))
   where p0.id = auth.uid()
   limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'title', x.title, 'instructions', x.instructions, 'due_at', x.due_at,
           'max_marks', x.max_marks, 'allow_late', x.allow_late,
           'released', x.results_released,
           'submission', (select jsonb_build_object(
                                 'file_name', s.file_name, 'file_path', s.file_path,
                                 'note', s.note,
                                 'response_text', s.response_text,
                                 'typing_meta', s.typing_meta,
                                 'submitted_at', s.submitted_at, 'is_late', s.is_late,
                                 'marked', s.marks is not null,
                                 'marks', case when x.results_released then s.marks end,
                                 'feedback', case when x.results_released then s.feedback end)
                            from public.submissions s
                           where s.assignment_id = x.id and s.student_id = auth.uid()))
         order by public.assignment_due_for(x.instructions, x.due_at, v_idx, v_prog, v_stream) nulls last, x.created_at), '[]'::jsonb)
    into r
    from public.assignments x
   where x.course_id = p_course
     and x.published
     and (
       public.assignment_for(x.instructions, v_prog, v_stream)
       or exists (
         select 1 from public.submissions s0
         where s0.assignment_id = x.id and s0.student_id = auth.uid()
       )
     );
  return r;
end;
$$;

create or replace function public.my_upcoming() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t.due), '[]'::jsonb) from (
    select 'quiz' as kind, q.id, q.title, c.id as course_id, c.code as course_code, c.color,
           case when w.opens_at > now() then w.opens_at else coalesce(w.closes_at, now()) end as due,
           w.opens_at, w.closes_at, q.duration_minutes,
           least((select count(*) from public.questions x where x.quiz_id = q.id),
                 coalesce(nullif(q.pool_size, 0), 100000)) as question_count
      from public.quizzes q join public.courses c on c.id = q.course_id
      cross join lateral public.quiz_window_for(q.id, auth.uid()) w
     where q.published and not q.is_practice and public.is_enrolled(c.id) and w.allowed
       and (w.closes_at is null or w.closes_at > now())
       and not exists (select 1 from public.attempts a where a.quiz_id = q.id
                         and a.student_id = auth.uid() and a.status <> 'in_progress')
    union all
    select 'assignment', x.id, x.title, c.id, c.code, c.color,
           d.eff_due, null, d.eff_due, null, null
      from public.assignments x
      join public.courses c on c.id = x.course_id
      join public.profiles p on p.id = auth.uid()
      left join public.roster r on upper(trim(r.index_no)) = upper(trim(p.index_no))
      cross join lateral (
        select public.assignment_due_for(x.instructions, x.due_at, p.index_no, r.programme, r.stream) as eff_due
      ) d
     where x.published and public.is_enrolled(c.id) and d.eff_due > now()
       and public.assignment_for(x.instructions, r.programme, r.stream)
       and not exists (select 1 from public.submissions s where s.assignment_id = x.id and s.student_id = auth.uid())
  ) t;
$$;

-- Live In-Class Polls & 1-Minute Exit Tickets
create table if not exists public.course_polls (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses on delete cascade,
  kind text not null default 'mcq' check (kind in ('mcq', 'exit_ticket')),
  question text not null,
  options jsonb not null default '[]'::jsonb,
  is_open boolean not null default true,
  show_results_to_students boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists idx_course_polls_course on public.course_polls (course_id, created_at desc);

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.course_polls(id) on delete cascade,
  course_id uuid not null references public.courses on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  option_index integer,
  response_text text not null default '',
  created_at timestamptz not null default now(),
  unique (poll_id, student_id)
);
create index if not exists idx_poll_votes_poll on public.poll_votes (poll_id);

alter table public.course_polls enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists "Staff manage course polls" on public.course_polls;
create policy "Staff manage course polls" on public.course_polls
  for all to authenticated
  using (public.is_staff(course_id))
  with check (public.is_staff(course_id));

drop policy if exists "Enrolled read course polls" on public.course_polls;
create policy "Enrolled read course polls" on public.course_polls
  for select to authenticated
  using (public.is_enrolled(course_id));

drop policy if exists "Students read own poll votes" on public.poll_votes;
create policy "Students read own poll votes" on public.poll_votes
  for select to authenticated
  using (student_id = auth.uid());

create or replace function public.lecturer_course_polls(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff(p_course) then
    raise exception 'Not allowed.';
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'course_id', p.course_id,
        'kind', p.kind,
        'question', p.question,
        'options', p.options,
        'is_open', p.is_open,
        'show_results_to_students', p.show_results_to_students,
        'created_at', p.created_at,
        'closed_at', p.closed_at,
        'total_votes', (select count(*) from public.poll_votes v where v.poll_id = p.id),
        'option_counts', case when p.kind = 'mcq' then coalesce((
          select jsonb_agg(
            (select count(*) from public.poll_votes v where v.poll_id = p.id and v.option_index = idx - 1)
            order by idx
          )
          from jsonb_array_elements(p.options) with ordinality as o(val, idx)
        ), '[]'::jsonb) else '[]'::jsonb end,
        'responses', case when p.kind = 'exit_ticket' then coalesce((
          select jsonb_agg(jsonb_build_object('id', v.id, 'text', v.response_text, 'created_at', v.created_at) order by v.created_at desc)
          from public.poll_votes v
          where v.poll_id = p.id and coalesce(btrim(v.response_text), '') <> ''
        ), '[]'::jsonb) else '[]'::jsonb end
      )
      order by p.is_open desc, p.created_at desc
    )
    from public.course_polls p
    where p.course_id = p_course
  ), '[]'::jsonb);
end;
$$;

create or replace function public.student_course_polls(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_enrolled(p_course) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'kind', p.kind,
        'question', p.question,
        'options', p.options,
        'is_open', p.is_open,
        'show_results_to_students', p.show_results_to_students,
        'created_at', p.created_at,
        'my_option_index', myv.option_index,
        'my_response_text', coalesce(myv.response_text, ''),
        'total_votes', case when p.show_results_to_students and (myv.id is not null or not p.is_open)
                            then (select count(*) from public.poll_votes v where v.poll_id = p.id)
                            else 0 end,
        'option_counts', case when p.kind = 'mcq' and p.show_results_to_students and (myv.id is not null or not p.is_open)
                              then coalesce((
                                select jsonb_agg(
                                  (select count(*) from public.poll_votes v where v.poll_id = p.id and v.option_index = idx - 1)
                                  order by idx
                                )
                                from jsonb_array_elements(p.options) with ordinality as o(val, idx)
                              ), '[]'::jsonb)
                              else '[]'::jsonb end
      )
      order by p.is_open desc, p.created_at desc
    )
    from public.course_polls p
    left join public.poll_votes myv on myv.poll_id = p.id and myv.student_id = auth.uid()
    where p.course_id = p_course
      and (p.is_open or (p.show_results_to_students and p.created_at > now() - interval '48 hours'))
  ), '[]'::jsonb);
end;
$$;

create or replace function public.submit_poll_vote(
  p_poll uuid,
  p_option_index integer default null,
  p_response_text text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pl public.course_polls;
begin
  select * into pl from public.course_polls where id = p_poll;
  if pl.id is null then
    raise exception 'Poll not found.';
  end if;
  if not public.is_enrolled(pl.course_id) then
    raise exception 'You are not enrolled in this course.';
  end if;
  if not pl.is_open then
    raise exception 'This poll has been closed by the lecturer.';
  end if;

  if pl.kind = 'mcq' then
    if p_option_index is null or p_option_index < 0 or p_option_index >= jsonb_array_length(pl.options) then
      raise exception 'Please select a valid answer option.';
    end if;
  else
    if coalesce(btrim(p_response_text), '') = '' then
      raise exception 'Please enter a short response first.';
    end if;
  end if;

  insert into public.poll_votes (poll_id, course_id, student_id, option_index, response_text)
  values (pl.id, pl.course_id, auth.uid(), case when pl.kind = 'mcq' then p_option_index else null end, coalesce(btrim(p_response_text), ''))
  on conflict (poll_id, student_id) do update
     set option_index = excluded.option_index,
         response_text = excluded.response_text,
         created_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

-- Anonymous TQM Mid-Semester / End-of-Course Feedback Survey
create table if not exists public.course_feedback_settings (
  course_id uuid primary key references public.courses on delete cascade,
  mid_open boolean not null default false,
  end_open boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.course_feedback (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses on delete cascade,
  cycle text not null check (cycle in ('mid_semester', 'end_semester')),
  student_hash text not null,
  programme text not null default '',
  stream text not null default '',
  clarity integer not null check (clarity between 1 and 5),
  pacing integer not null check (pacing between 1 and 5),
  relevance integer not null check (relevance between 1 and 5),
  materials integer not null check (materials between 1 and 5),
  keep_doing text not null default '',
  improve text not null default '',
  stop_doing text not null default '',
  submitted_at timestamptz not null default now(),
  unique (course_id, cycle, student_hash)
);
create index if not exists idx_course_feedback_course on public.course_feedback (course_id, cycle);

alter table public.course_feedback_settings enable row level security;
alter table public.course_feedback enable row level security;

drop policy if exists "Lecturers manage feedback settings" on public.course_feedback_settings;
create policy "Lecturers manage feedback settings" on public.course_feedback_settings
  for all to authenticated
  using (public.is_lecturer())
  with check (public.is_lecturer());

drop policy if exists "Enrolled read feedback settings" on public.course_feedback_settings;
create policy "Enrolled read feedback settings" on public.course_feedback_settings
  for select to authenticated
  using (public.is_enrolled(course_id));

create or replace function public.course_feedback_status(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  st public.course_feedback_settings;
  v_mid_hash text;
  v_end_hash text;
begin
  if not public.is_enrolled(p_course) and not public.is_staff(p_course) then
    return jsonb_build_object('mid_open', false, 'end_open', false, 'mid_submitted', false, 'end_submitted', false);
  end if;
  select * into st from public.course_feedback_settings where course_id = p_course;
  v_mid_hash := md5(auth.uid()::text || ':' || p_course::text || ':mid_semester');
  v_end_hash := md5(auth.uid()::text || ':' || p_course::text || ':end_semester');
  return jsonb_build_object(
    'mid_open', coalesce(st.mid_open, false),
    'end_open', coalesce(st.end_open, false),
    'mid_submitted', exists (select 1 from public.course_feedback f where f.course_id = p_course and f.cycle = 'mid_semester' and f.student_hash = v_mid_hash),
    'end_submitted', exists (select 1 from public.course_feedback f where f.course_id = p_course and f.cycle = 'end_semester' and f.student_hash = v_end_hash)
  );
end;
$$;

create or replace function public.submit_course_feedback(
  p_course uuid,
  p_cycle text,
  p_clarity integer,
  p_pacing integer,
  p_relevance integer,
  p_materials integer,
  p_keep text default '',
  p_improve text default '',
  p_stop text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st public.course_feedback_settings;
  v_hash text;
  v_prog text := '';
  v_stream text := '';
begin
  if not public.is_enrolled(p_course) then
    raise exception 'Only enrolled students can submit course feedback.';
  end if;
  if p_cycle not in ('mid_semester', 'end_semester') then
    raise exception 'Invalid feedback cycle.';
  end if;
  select * into st from public.course_feedback_settings where course_id = p_course;
  if (p_cycle = 'mid_semester' and not coalesce(st.mid_open, false))
     or (p_cycle = 'end_semester' and not coalesce(st.end_open, false)) then
    raise exception 'This anonymous feedback window is currently closed.';
  end if;

  if p_clarity not between 1 and 5 or p_pacing not between 1 and 5
     or p_relevance not between 1 and 5 or p_materials not between 1 and 5 then
    raise exception 'All ratings must be between 1 and 5.';
  end if;

  select coalesce(r.programme, ''), coalesce(r.stream, '') into v_prog, v_stream
    from public.profiles p
    left join public.roster r on upper(trim(r.index_no)) = upper(trim(p.index_no))
   where p.id = auth.uid()
   limit 1;

  v_hash := md5(auth.uid()::text || ':' || p_course::text || ':' || p_cycle);

  if exists (select 1 from public.course_feedback f where f.course_id = p_course and f.cycle = p_cycle and f.student_hash = v_hash) then
    raise exception 'You have already submitted anonymous feedback for this cycle.';
  end if;

  insert into public.course_feedback (
    course_id, cycle, student_hash, programme, stream, clarity, pacing, relevance, materials, keep_doing, improve, stop_doing
  ) values (
    p_course, p_cycle, v_hash, coalesce(v_prog, ''), coalesce(v_stream, ''),
    p_clarity, p_pacing, p_relevance, p_materials,
    coalesce(btrim(p_keep), ''), coalesce(btrim(p_improve), ''), coalesce(btrim(p_stop), '')
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.course_feedback_summary(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  st public.course_feedback_settings;
  v_mid jsonb;
  v_end jsonb;
begin
  if not public.is_lecturer() then
    raise exception 'Not allowed.';
  end if;
  select * into st from public.course_feedback_settings where course_id = p_course;

  select jsonb_build_object(
    'count', count(*),
    'averages', jsonb_build_object(
      'clarity', round(avg(clarity)::numeric, 2),
      'pacing', round(avg(pacing)::numeric, 2),
      'relevance', round(avg(relevance)::numeric, 2),
      'materials', round(avg(materials)::numeric, 2)
    ),
    'cohorts', coalesce((
      select jsonb_agg(row_to_json(c) order by c.count desc)
      from (
        select programme, stream, count(*)::int as count,
               round(avg(clarity)::numeric, 2) as clarity,
               round(avg(pacing)::numeric, 2) as pacing,
               round(avg(relevance)::numeric, 2) as relevance,
               round(avg(materials)::numeric, 2) as materials
          from public.course_feedback
         where course_id = p_course and cycle = 'mid_semester'
         group by programme, stream
        having count(*) >= 3
      ) c
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('keep_doing', keep_doing, 'improve', improve, 'stop_doing', stop_doing) order by submitted_at desc)
      from public.course_feedback
      where course_id = p_course and cycle = 'mid_semester'
        and (keep_doing <> '' or improve <> '' or stop_doing <> '')
    ), '[]'::jsonb)
  ) into v_mid
  from public.course_feedback
  where course_id = p_course and cycle = 'mid_semester';

  select jsonb_build_object(
    'count', count(*),
    'averages', jsonb_build_object(
      'clarity', round(avg(clarity)::numeric, 2),
      'pacing', round(avg(pacing)::numeric, 2),
      'relevance', round(avg(relevance)::numeric, 2),
      'materials', round(avg(materials)::numeric, 2)
    ),
    'cohorts', coalesce((
      select jsonb_agg(row_to_json(c) order by c.count desc)
      from (
        select programme, stream, count(*)::int as count,
               round(avg(clarity)::numeric, 2) as clarity,
               round(avg(pacing)::numeric, 2) as pacing,
               round(avg(relevance)::numeric, 2) as relevance,
               round(avg(materials)::numeric, 2) as materials
          from public.course_feedback
         where course_id = p_course and cycle = 'end_semester'
         group by programme, stream
        having count(*) >= 3
      ) c
    ), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('keep_doing', keep_doing, 'improve', improve, 'stop_doing', stop_doing) order by submitted_at desc)
      from public.course_feedback
      where course_id = p_course and cycle = 'end_semester'
        and (keep_doing <> '' or improve <> '' or stop_doing <> '')
    ), '[]'::jsonb)
  ) into v_end
  from public.course_feedback
  where course_id = p_course and cycle = 'end_semester';

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'mid_open', coalesce(st.mid_open, false),
      'end_open', coalesce(st.end_open, false)
    ),
    'mid_semester', v_mid,
    'end_semester', v_end
  );
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'assignment_due_for(text, timestamptz, text, text, text)',
    'can_submit(uuid)',
    'submit_assignment(uuid, text, text, text, text, jsonb)',
    'submit_group_assignment(uuid, text, text, text, text[], text, jsonb)',
    'my_assignments(uuid)',
    'my_upcoming()',
    'lecturer_course_polls(uuid)',
    'student_course_polls(uuid)',
    'submit_poll_vote(uuid, integer, text)',
    'course_feedback_status(uuid)',
    'submit_course_feedback(uuid, text, integer, integer, integer, integer, text, text, text)',
    'course_feedback_summary(uuid)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- =====================================================================
-- 16. PSCM E-Class Feature Pack II:
--     Scheduled Unlock (Drip) for Weeks & Materials,
--     Cohort-Targeted, Pinned & Acknowledged Announcements,
--     Absence & Medical Excuse Requests (auto-credit attendance),
--     Structured Mark Review / Re-Mark Disputes,
--     Per-Material Viewer Breakdown & Course Attention Counters
-- =====================================================================

-- 16A. Scheduled unlock ("drip") dates for modules & materials
alter table public.modules   add column if not exists unlock_at timestamptz;
alter table public.materials add column if not exists unlock_at timestamptz;

-- 16B. Announcement pinning, cohort targeting & read acknowledgements
alter table public.announcements add column if not exists pinned   boolean not null default false;
alter table public.announcements add column if not exists audience jsonb;

create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements on delete cascade,
  student_id      uuid not null references public.profiles(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, student_id)
);
create index if not exists announcement_reads_student_idx on public.announcement_reads (student_id);

alter table public.announcement_reads enable row level security;

drop policy if exists "Students manage own announcement reads" on public.announcement_reads;
create policy "Students manage own announcement reads" on public.announcement_reads
  for all to authenticated
  using (student_id = auth.uid())
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.announcements a
       where a.id = announcement_id and public.is_enrolled(a.course_id)
    )
  );

drop policy if exists "Staff read announcement acknowledgements" on public.announcement_reads;
create policy "Staff read announcement acknowledgements" on public.announcement_reads
  for select to authenticated
  using (
    exists (
      select 1 from public.announcements a
       where a.id = announcement_id and public.is_staff(a.course_id)
    )
  );

create or replace function public.mark_announcement_read(p_announcement uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_course uuid;
begin
  select course_id into v_course from public.announcements where id = p_announcement;
  if v_course is null then raise exception 'Announcement not found.'; end if;
  if not public.is_enrolled(v_course) then raise exception 'Not enrolled in this course.'; end if;
  insert into public.announcement_reads (announcement_id, student_id, read_at)
  values (p_announcement, auth.uid(), now())
  on conflict (announcement_id, student_id) do nothing;
end;
$$;

create or replace function public.course_announcement_reads(p_course uuid)
returns table (announcement_id uuid, read_count int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_staff(p_course);
  return query
    select a.id, count(r.student_id)::int
      from public.announcements a
      left join public.announcement_reads r on r.announcement_id = a.id
     where a.course_id = p_course
     group by a.id;
end;
$$;

create or replace function public.my_announcement_reads(p_course uuid default null)
returns table (announcement_id uuid, read_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.announcement_id, r.read_at
    from public.announcement_reads r
    join public.announcements a on a.id = r.announcement_id
   where r.student_id = auth.uid()
     and (p_course is null or a.course_id = p_course);
$$;

-- 16C. Absence & Medical Excuse Requests (auto-credit attendance on approval)
alter table public.attendance drop constraint if exists attendance_method_check;
alter table public.attendance add constraint attendance_method_check check (method in ('code', 'manual', 'excused'));

-- Allow students to upload supporting excuse documents under submissions/excuses/<course_id>/<student_id>/<file>
drop policy if exists "excuses upload" on storage.objects;
create policy "excuses upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = 'excuses'
    and (storage.foldername(name))[3] = auth.uid()::text
    and public.is_enrolled(public.try_uuid((storage.foldername(name))[2]))
  );

drop policy if exists "excuses read" on storage.objects;
create policy "excuses read" on storage.objects for select to authenticated
  using (
    bucket_id = 'submissions'
    and (storage.foldername(name))[1] = 'excuses'
    and (
      public.is_lecturer()
      or (storage.foldername(name))[3] = auth.uid()::text
      or public.is_ta(public.try_uuid((storage.foldername(name))[2]))
    )
  );

-- Update R2/signed file_access helper to also authorize submissions/excuses/<course_id>/<student_id>/<file>
create or replace function public.file_access(p_bucket text, p_path text, p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  clean_path text := regexp_replace(coalesce(p_path, ''), '^r2:', '');
  parts text[] := string_to_array(clean_path, '/');
begin
  if auth.uid() is null or coalesce(p_path, '') like '%..%' or cardinality(parts) < 2 then return false; end if;
  if p_bucket = 'materials' then
    if p_action = 'download' then
      return public.is_lecturer() or public.is_ta(public.try_uuid(parts[1])) or public.is_enrolled(public.try_uuid(parts[1]));
    end if;
    return public.is_lecturer();
  elsif p_bucket = 'submissions' then
    if parts[1] = 'excuses' then
      if cardinality(parts) < 4 then return false; end if;
      if p_action = 'upload' then
        return parts[3] = auth.uid()::text and public.is_enrolled(public.try_uuid(parts[2]));
      end if;
      if p_action = 'download' then
        return public.is_lecturer()
            or parts[3] = auth.uid()::text
            or public.is_ta(public.try_uuid(parts[2]));
      end if;
      return public.is_lecturer();
    end if;
    if cardinality(parts) < 3 then return false; end if;
    if p_action = 'download' then
      return public.is_lecturer()
          or parts[2] = auth.uid()::text
          or exists (
            select 1 from public.submissions s
             where s.assignment_id = public.try_uuid(parts[1])
               and s.student_id = auth.uid()
               and regexp_replace(s.file_path, '^r2:', '') = clean_path
          )
          or public.is_ta((select course_id from public.assignments where id = public.try_uuid(parts[1])));
    end if;
    if p_action = 'upload' then
      return parts[2] = auth.uid()::text and public.can_submit(public.try_uuid(parts[1]));
    end if;
    return public.is_lecturer();
  end if;
  return false;
end;
$$;

create table if not exists public.attendance_excuses (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses on delete cascade,
  session_id    uuid not null references public.attendance_sessions on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade,
  index_no      text not null,
  reason        text not null check (length(btrim(reason)) >= 3),
  evidence_path text,
  evidence_name text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer_note text not null default '',
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (session_id, student_id)
);
create index if not exists attendance_excuses_course_idx on public.attendance_excuses (course_id, status, created_at desc);

alter table public.attendance_excuses enable row level security;

drop policy if exists "Students read own attendance excuses" on public.attendance_excuses;
create policy "Students read own attendance excuses" on public.attendance_excuses
  for select to authenticated
  using (student_id = auth.uid());

drop policy if exists "Staff manage course attendance excuses" on public.attendance_excuses;
create policy "Staff manage course attendance excuses" on public.attendance_excuses
  for all to authenticated
  using (public.is_staff(course_id))
  with check (public.is_staff(course_id));

create or replace function public.submit_attendance_excuse(
  p_session       uuid,
  p_reason        text,
  p_evidence_path text default null,
  p_evidence_name text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_course  uuid;
  v_index   text;
  v_id      uuid;
  v_cur     text;
begin
  select s.course_id into v_course from public.attendance_sessions s where s.id = p_session;
  if v_course is null then raise exception 'Attendance session not found.'; end if;
  if not public.is_enrolled(v_course) then raise exception 'You are not enrolled in this course.'; end if;
  select public.norm_index(index_no) into v_index from public.profiles where id = auth.uid();
  if coalesce(v_index, '') = '' then raise exception 'Student index number not found.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please provide a brief explanation (at least 3 characters).';
  end if;

  select id, status into v_id, v_cur
    from public.attendance_excuses
   where session_id = p_session and student_id = auth.uid();

  if v_id is not null and v_cur = 'approved' then
    raise exception 'An excuse has already been approved for this session.';
  end if;

  insert into public.attendance_excuses (
    course_id, session_id, student_id, index_no, reason, evidence_path, evidence_name, status, reviewer_note, reviewed_by, reviewed_at
  ) values (
    v_course, p_session, auth.uid(), v_index, btrim(p_reason),
    nullif(btrim(coalesce(p_evidence_path, '')), ''),
    nullif(btrim(coalesce(p_evidence_name, '')), ''),
    'pending', '', null, null
  )
  on conflict (session_id, student_id) do update
    set reason        = excluded.reason,
        evidence_path = coalesce(excluded.evidence_path, public.attendance_excuses.evidence_path),
        evidence_name = coalesce(excluded.evidence_name, public.attendance_excuses.evidence_name),
        status        = 'pending',
        reviewer_note = '',
        reviewed_by   = null,
        reviewed_at   = null,
        created_at    = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.my_attendance_excuses(p_course uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id,
      'session_id', e.session_id,
      'session_title', s.title,
      'opens_at', s.opens_at,
      'reason', e.reason,
      'evidence_path', e.evidence_path,
      'evidence_name', e.evidence_name,
      'status', e.status,
      'reviewer_note', e.reviewer_note,
      'reviewed_at', e.reviewed_at,
      'created_at', e.created_at
    ) order by e.created_at desc)
    from public.attendance_excuses e
    join public.attendance_sessions s on s.id = e.session_id
    where e.course_id = p_course and e.student_id = auth.uid()
  ), '[]'::jsonb);
$$;

create or replace function public.course_attendance_excuses(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(p_course);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id,
      'course_id', e.course_id,
      'session_id', e.session_id,
      'session_title', s.title,
      'session_opens_at', s.opens_at,
      'student_id', e.student_id,
      'index_no', e.index_no,
      'full_name', coalesce(r.full_name, p.full_name, e.index_no),
      'programme', coalesce(r.programme, ''),
      'stream', coalesce(r.stream, ''),
      'reason', e.reason,
      'evidence_path', e.evidence_path,
      'evidence_name', e.evidence_name,
      'status', e.status,
      'reviewer_note', e.reviewer_note,
      'reviewed_at', e.reviewed_at,
      'created_at', e.created_at
    ) order by (e.status = 'pending') desc, e.created_at desc)
    from public.attendance_excuses e
    join public.attendance_sessions s on s.id = e.session_id
    left join public.profiles p on p.id = e.student_id
    left join public.roster r on upper(trim(r.index_no)) = upper(trim(e.index_no))
    where e.course_id = p_course
  ), '[]'::jsonb);
end;
$$;

create or replace function public.resolve_attendance_excuse(
  p_excuse uuid,
  p_status text,
  p_note   text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ex   public.attendance_excuses;
  v_note text := coalesce(btrim(p_note), '');
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid excuse resolution status.';
  end if;
  select * into v_ex from public.attendance_excuses where id = p_excuse;
  if v_ex.id is null then raise exception 'Excuse request not found.'; end if;
  perform public.require_staff(v_ex.course_id);

  update public.attendance_excuses
     set status = p_status,
         reviewer_note = v_note,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_excuse;

  if p_status = 'approved' then
    insert into public.attendance (session_id, index_no, status, method, note, reviewed_by)
    values (
      v_ex.session_id,
      public.norm_index(v_ex.index_no),
      'ok',
      'excused',
      case when v_note <> '' then 'Excused: ' || v_note else 'Approved absence excuse' end,
      auth.uid()
    )
    on conflict (session_id, index_no) do update
      set status = 'ok',
          method = 'excused',
          note = excluded.note,
          reviewed_by = auth.uid();
  end if;

  perform public.log_course_audit(
    v_ex.course_id,
    case when p_status = 'approved' then 'excuse_approved' else 'excuse_rejected' end,
    format('%s excuse request for %s', case when p_status = 'approved' then 'Approved' else 'Declined' end, v_ex.index_no),
    jsonb_build_object('excuse_id', p_excuse, 'session_id', v_ex.session_id, 'index_no', v_ex.index_no)
  );
end;
$$;

-- 16D. Structured Mark Review / Re-Mark Requests
-- Enhance get_attempt_review to also return response_id, attempt_id, quiz_id, and course_id for review requests
create or replace function public.get_attempt_review(p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a      public.attempts;
  qz     public.quizzes;
  v_show boolean;
  qs     jsonb;
begin
  select * into a from public.attempts where id = p_attempt and student_id = auth.uid();
  if a.id is null then raise exception 'Attempt not found.'; end if;
  if a.status = 'in_progress' then raise exception 'Quiz is still in progress.'; end if;
  select * into qz from public.quizzes where id = a.quiz_id;
  if not qz.results_released and not qz.is_practice then
    raise exception 'Results for this quiz have not been released yet.';
  end if;
  v_show := qz.show_answers or qz.is_practice;

  select jsonb_agg(jsonb_build_object(
           'id', q.id, 'response_id', r.id, 'kind', q.kind, 'prompt', q.prompt, 'marks', q.marks, 'unit', q.unit,
           'vars', case when coalesce(trim(q.formula), '') <> ''
                        then public.gen_vars(a.seed, q.id, q.params) else '{}'::jsonb end,
           'options', case when q.kind in ('mcq','truefalse','multiselect') then q.options else '[]'::jsonb end,
           'value', r.value, 'is_correct', r.is_correct, 'marks_awarded', r.marks_awarded,
           'feedback', r.feedback,
           'image_path', q.image_path,
           'correct', case when not v_show then null
                           when q.kind in ('mcq','truefalse','multiselect') then q.answer->'correct'
                           when q.kind = 'short' then q.answer->'accepted'
                           when q.kind = 'numeric' then
                             (select to_jsonb(public.expected_value(q, a.seed)))
                           else null end,
           'explanation', case when v_show then q.explanation else '' end)
         order by o.ord)
    into qs
    from unnest(a.question_order) with ordinality as o(qid, ord)
    join public.questions q on q.id = o.qid
    left join public.responses r on r.attempt_id = a.id and r.question_id = q.id;

  return jsonb_build_object(
    'title', qz.title,
    'course_id', qz.course_id,
    'quiz_id', qz.id,
    'attempt_id', a.id,
    'results_released', qz.results_released,
    'score', a.score,
    'max_score', a.max_score,
    'status', a.status,
    'questions', coalesce(qs, '[]'::jsonb)
  );
end;
$$;

create table if not exists public.mark_reviews (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses on delete cascade,
  kind          text not null check (kind in ('quiz_response', 'assignment')),
  quiz_id       uuid references public.quizzes on delete cascade,
  attempt_id    uuid references public.attempts on delete cascade,
  response_id   uuid references public.responses on delete cascade,
  assignment_id uuid references public.assignments on delete cascade,
  submission_id uuid references public.submissions on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade,
  index_no      text not null,
  reason        text not null check (length(btrim(reason)) >= 5),
  original_marks numeric,
  updated_marks  numeric,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  reviewer_note text not null default '',
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists mark_reviews_course_idx on public.mark_reviews (course_id, status, created_at desc);
create unique index if not exists mark_reviews_resp_pending_idx on public.mark_reviews (response_id) where response_id is not null and status = 'pending';
create unique index if not exists mark_reviews_sub_pending_idx  on public.mark_reviews (submission_id) where submission_id is not null and status = 'pending';

alter table public.mark_reviews enable row level security;

drop policy if exists "Students read own mark reviews" on public.mark_reviews;
create policy "Students read own mark reviews" on public.mark_reviews
  for select to authenticated
  using (student_id = auth.uid());

drop policy if exists "Staff manage course mark reviews" on public.mark_reviews;
create policy "Staff manage course mark reviews" on public.mark_reviews
  for all to authenticated
  using (public.is_staff(course_id))
  with check (public.is_staff(course_id));

create or replace function public.request_mark_review(
  p_kind      text,
  p_target_id uuid,
  p_reason    text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_index   text;
  v_course  uuid;
  v_id      uuid;
  r_row     record;
  s_row     record;
begin
  if p_kind not in ('quiz_response', 'assignment') then
    raise exception 'Invalid review target type.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Please enter a brief justification (at least 5 characters).';
  end if;
  select public.norm_index(index_no) into v_index from public.profiles where id = auth.uid();

  if p_kind = 'quiz_response' then
    select r.id as response_id, r.marks_awarded, a.id as attempt_id, a.quiz_id, a.status, qz.course_id, qz.results_released
      into r_row
      from public.responses r
      join public.attempts a on a.id = r.attempt_id
      join public.quizzes qz on qz.id = a.quiz_id
     where r.id = p_target_id and a.student_id = auth.uid();
    if r_row.response_id is null then raise exception 'Quiz answer not found.'; end if;
    if r_row.status = 'in_progress' or not r_row.results_released then
      raise exception 'Marks must be released before requesting a review.';
    end if;
    if r_row.marks_awarded is null then
      raise exception 'This answer is still being marked.';
    end if;
    if exists (select 1 from public.mark_reviews mr where mr.response_id = p_target_id and mr.status = 'pending') then
      raise exception 'A mark review request is already pending for this question.';
    end if;
    insert into public.mark_reviews (
      course_id, kind, quiz_id, attempt_id, response_id, student_id, index_no, reason, original_marks
    ) values (
      r_row.course_id, 'quiz_response', r_row.quiz_id, r_row.attempt_id, r_row.response_id,
      auth.uid(), coalesce(v_index, ''), btrim(p_reason), r_row.marks_awarded
    ) returning id into v_id;
    return v_id;
  else
    select s.id as submission_id, s.marks, a.id as assignment_id, a.course_id, a.released
      into s_row
      from public.submissions s
      join public.assignments a on a.id = s.assignment_id
     where s.id = p_target_id and s.student_id = auth.uid();
    if s_row.submission_id is null then raise exception 'Assignment submission not found.'; end if;
    if not s_row.released or s_row.marks is null then
      raise exception 'Marks must be released before requesting a review.';
    end if;
    if exists (select 1 from public.mark_reviews mr where mr.submission_id = p_target_id and mr.status = 'pending') then
      raise exception 'A mark review request is already pending for this assignment.';
    end if;
    insert into public.mark_reviews (
      course_id, kind, assignment_id, submission_id, student_id, index_no, reason, original_marks
    ) values (
      s_row.course_id, 'assignment', s_row.assignment_id, s_row.submission_id,
      auth.uid(), coalesce(v_index, ''), btrim(p_reason), s_row.marks
    ) returning id into v_id;
    return v_id;
  end if;
end;
$$;

create or replace function public.my_mark_reviews(
  p_course  uuid default null,
  p_attempt uuid default null
) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', mr.id,
      'kind', mr.kind,
      'quiz_id', mr.quiz_id,
      'attempt_id', mr.attempt_id,
      'response_id', mr.response_id,
      'assignment_id', mr.assignment_id,
      'submission_id', mr.submission_id,
      'reason', mr.reason,
      'original_marks', mr.original_marks,
      'updated_marks', mr.updated_marks,
      'status', mr.status,
      'reviewer_note', mr.reviewer_note,
      'reviewed_at', mr.reviewed_at,
      'created_at', mr.created_at
    ) order by mr.created_at desc)
    from public.mark_reviews mr
    where mr.student_id = auth.uid()
      and (p_course is null or mr.course_id = p_course)
      and (p_attempt is null or mr.attempt_id = p_attempt)
  ), '[]'::jsonb);
$$;

create or replace function public.course_mark_reviews(
  p_course     uuid,
  p_quiz       uuid default null,
  p_assignment uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(p_course);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', mr.id,
      'course_id', mr.course_id,
      'kind', mr.kind,
      'quiz_id', mr.quiz_id,
      'attempt_id', mr.attempt_id,
      'response_id', mr.response_id,
      'assignment_id', mr.assignment_id,
      'submission_id', mr.submission_id,
      'student_id', mr.student_id,
      'index_no', mr.index_no,
      'full_name', coalesce(r.full_name, p.full_name, mr.index_no),
      'programme', coalesce(r.programme, ''),
      'stream', coalesce(r.stream, ''),
      'item_title', case when mr.kind = 'quiz_response' then qz.title else a.title end,
      'question_prompt', case when mr.kind = 'quiz_response' then q.prompt else null end,
      'student_answer', case when mr.kind = 'quiz_response' then coalesce(resp.value #>> '{}', '') else coalesce(sub.response_text, sub.file_name, '') end,
      'max_marks', case when mr.kind = 'quiz_response' then q.marks else a.max_marks end,
      'current_marks', case when mr.kind = 'quiz_response' then resp.marks_awarded else sub.marks end,
      'original_marks', mr.original_marks,
      'updated_marks', mr.updated_marks,
      'reason', mr.reason,
      'status', mr.status,
      'reviewer_note', mr.reviewer_note,
      'reviewed_at', mr.reviewed_at,
      'created_at', mr.created_at
    ) order by (mr.status = 'pending') desc, mr.created_at desc)
    from public.mark_reviews mr
    left join public.profiles p on p.id = mr.student_id
    left join public.roster r on upper(trim(r.index_no)) = upper(trim(mr.index_no))
    left join public.quizzes qz on qz.id = mr.quiz_id
    left join public.responses resp on resp.id = mr.response_id
    left join public.questions q on q.id = resp.question_id
    left join public.assignments a on a.id = mr.assignment_id
    left join public.submissions sub on sub.id = mr.submission_id
    where mr.course_id = p_course
      and (p_quiz is null or mr.quiz_id = p_quiz)
      and (p_assignment is null or mr.assignment_id = p_assignment)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.resolve_mark_review(
  p_review    uuid,
  p_status    text,
  p_new_marks numeric default null,
  p_note      text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rev  public.mark_reviews;
  v_max  numeric;
  v_note text := coalesce(btrim(p_note), '');
begin
  if p_status not in ('approved', 'declined') then
    raise exception 'Invalid review resolution status.';
  end if;
  select * into v_rev from public.mark_reviews where id = p_review;
  if v_rev.id is null then raise exception 'Mark review request not found.'; end if;
  perform public.require_staff(v_rev.course_id);

  if p_status = 'approved' and p_new_marks is not null then
    if v_rev.kind = 'quiz_response' then
      select q.marks into v_max
        from public.responses r join public.questions q on q.id = r.question_id
       where r.id = v_rev.response_id;
      if p_new_marks < 0 or p_new_marks > coalesce(v_max, 0) then
        raise exception 'Updated marks must be between 0 and %.', v_max;
      end if;
      update public.responses
         set marks_awarded = p_new_marks,
             is_correct = (p_new_marks = v_max),
             feedback = case when v_note <> '' then v_note else feedback end,
             marked_by = auth.uid()
       where id = v_rev.response_id;
      perform public.recalc_attempt(v_rev.attempt_id);
    else
      select a.max_marks into v_max from public.assignments a where a.id = v_rev.assignment_id;
      if p_new_marks < 0 or p_new_marks > coalesce(v_max, 0) then
        raise exception 'Updated marks must be between 0 and %.', v_max;
      end if;
      update public.submissions
         set marks = p_new_marks,
             feedback = case when v_note <> '' then
               case when coalesce(btrim(feedback), '') <> '' then feedback || E'

Review response: ' || v_note else v_note end
             else feedback end,
             marked_at = now(),
             marked_by = auth.uid()
       where id = v_rev.submission_id;
    end if;
  end if;

  update public.mark_reviews
     set status = p_status,
         updated_marks = case when p_status = 'approved' and p_new_marks is not null then p_new_marks else coalesce(updated_marks, original_marks) end,
         reviewer_note = v_note,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_review;

  perform public.log_course_audit(
    v_rev.course_id,
    case when p_status = 'approved' then 'mark_review_approved' else 'mark_review_declined' end,
    format('%s mark review for %s', case when p_status = 'approved' then 'Approved' else 'Declined' end, v_rev.index_no),
    jsonb_build_object('review_id', p_review, 'kind', v_rev.kind, 'new_marks', p_new_marks)
  );
end;
$$;

-- 16E. Per-material viewer breakdown & Course attention badge counters
create or replace function public.material_viewer_breakdown(
  p_course   uuid,
  p_material uuid
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_mat record;
  v_rows jsonb;
begin
  perform public.require_staff(p_course);
  select id, title, kind into v_mat from public.materials where id = p_material and course_id = p_course;
  if v_mat.id is null then raise exception 'Material not found.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'index_no', r.index_no,
    'full_name', r.full_name,
    'programme', coalesce(r.programme, ''),
    'stream', coalesce(r.stream, ''),
    'activated', (p.id is not null),
    'viewed', (coalesce(mv.view_count, 0) > 0),
    'view_count', coalesce(mv.view_count, 0),
    'last_viewed_at', mv.last_viewed_at
  ) order by (coalesce(mv.view_count, 0) > 0) asc, r.full_name, r.index_no), '[]'::jsonb)
  into v_rows
  from public.enrollments e
  join public.roster r on r.index_no = e.index_no
  left join public.profiles p on p.index_no = r.index_no
  left join public.material_views mv on mv.material_id = p_material and mv.student_id = p.id
  where e.course_id = p_course;

  return jsonb_build_object(
    'material', jsonb_build_object('id', v_mat.id, 'title', v_mat.title, 'kind', v_mat.kind),
    'students', v_rows
  );
end;
$$;

create or replace function public.course_attention_counts(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(p_course);
  return jsonb_build_object(
    'unreplied_messages', (select count(*)::int from public.course_messages m where m.course_id = p_course and m.reply is null),
    'unanswered_qa',      (select count(*)::int from public.forum_posts f where f.course_id = p_course and f.answer is null and f.hidden = false),
    'pending_excuses',    (select count(*)::int from public.attendance_excuses e where e.course_id = p_course and e.status = 'pending'),
    'pending_reviews',    (select count(*)::int from public.mark_reviews mr where mr.course_id = p_course and mr.status = 'pending')
  );
end;
$$;

create or replace function public.student_attention_counts(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_prog   text := '';
  v_stream text := '';
begin
  if not public.is_enrolled(p_course) then
    return jsonb_build_object('unread_announcements', 0, 'open_polls', 0);
  end if;
  select coalesce(r.programme, ''), coalesce(r.stream, '') into v_prog, v_stream
    from public.profiles p
    left join public.roster r on upper(trim(r.index_no)) = upper(trim(p.index_no))
   where p.id = auth.uid()
   limit 1;

  return jsonb_build_object(
    'unread_announcements', (
      select count(*)::int
        from public.announcements a
       where a.course_id = p_course
         and a.created_at > now() - interval '30 days'
         and not exists (
           select 1 from public.announcement_reads ar
            where ar.announcement_id = a.id and ar.student_id = auth.uid()
         )
         and (
           a.audience is null
           or (
             (coalesce(jsonb_array_length(a.audience->'programmes'), 0) = 0
              or exists (select 1 from jsonb_array_elements_text(a.audience->'programmes') pr where upper(trim(pr)) = upper(trim(v_prog))))
             and
             (coalesce(jsonb_array_length(a.audience->'streams'), 0) = 0
              or exists (select 1 from jsonb_array_elements_text(a.audience->'streams') st where upper(trim(st)) = upper(trim(v_stream))))
           )
         )
    ),
    'open_polls', (
      select count(*)::int
        from public.course_polls cp
       where cp.course_id = p_course
         and cp.is_open = true
         and not exists (
           select 1 from public.poll_votes pv where pv.poll_id = cp.id and pv.student_id = auth.uid()
         )
    )
  );
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'mark_announcement_read(uuid)',
    'course_announcement_reads(uuid)',
    'my_announcement_reads(uuid)',
    'submit_attendance_excuse(uuid, text, text, text)',
    'my_attendance_excuses(uuid)',
    'course_attendance_excuses(uuid)',
    'resolve_attendance_excuse(uuid, text, text)',
    'request_mark_review(text, uuid, text)',
    'my_mark_reviews(uuid, uuid)',
    'course_mark_reviews(uuid, uuid, uuid)',
    'resolve_mark_review(uuid, text, numeric, text)',
    'material_viewer_breakdown(uuid, uuid)',
    'course_attention_counts(uuid)',
    'student_attention_counts(uuid)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- =====================================================================
-- 17. PSCM E-Class Feature Pack III:
--     Cross-Course Question Bank & Past-Question Importer,
--     Quick Feedback Snippets & Anonymized Assignment Exemplars,
--     Bookable Presentation / Viva / Consultation Slots,
--     Exam Hall & Seat Allocator,
--     Direct Manual Roll-Call Sessions
-- =====================================================================

-- 17A. Cross-Course Question Bank & Past-Question Importer
create table if not exists public.question_bank (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  course_id      uuid references public.courses(id) on delete set null,
  course_code    text not null default '',
  topic          text not null default '',
  difficulty     text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  kind           text not null check (kind in ('mcq', 'truefalse', 'numeric', 'short', 'essay', 'multiselect')),
  prompt         text not null,
  options        jsonb not null default '[]'::jsonb,
  answer         jsonb not null default '{}'::jsonb,
  params         jsonb not null default '{}'::jsonb,
  formula        text,
  unit           text not null default '',
  decimals       int not null default 2,
  tolerance      numeric not null default 0,
  tolerance_type text not null default 'abs',
  marks          numeric not null default 1,
  explanation    text not null default '',
  image_path     text,
  created_at     timestamptz not null default now()
);
create index if not exists question_bank_owner_idx on public.question_bank (owner_id, created_at desc);

alter table public.question_bank enable row level security;

drop policy if exists "Staff manage own question bank" on public.question_bank;
create policy "Staff manage own question bank" on public.question_bank
  for all to authenticated
  using (owner_id = auth.uid() and (public.is_lecturer() or exists (select 1 from public.course_staff cs where cs.user_id = auth.uid())))
  with check (owner_id = auth.uid() and (public.is_lecturer() or exists (select 1 from public.course_staff cs where cs.user_id = auth.uid())));

create or replace function public.save_to_question_bank(
  p_question   uuid,
  p_difficulty text default 'medium'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_q    public.questions;
  v_c    public.courses;
  v_diff text := case when p_difficulty in ('easy', 'medium', 'hard') then p_difficulty else 'medium' end;
  v_id   uuid;
begin
  select q.* into v_q from public.questions q where q.id = p_question;
  if v_q.id is null then raise exception 'Question not found.'; end if;
  select c.* into v_c
    from public.quizzes qz
    join public.courses c on c.id = qz.course_id
   where qz.id = v_q.quiz_id;
  perform public.require_staff(v_c.id);

  insert into public.question_bank (
    owner_id, course_id, course_code, topic, difficulty, kind, prompt,
    options, answer, params, formula, unit, decimals, tolerance, tolerance_type,
    marks, explanation, image_path
  ) values (
    auth.uid(), v_c.id, coalesce(v_c.code, ''), coalesce(v_q.topic, ''), v_diff,
    v_q.kind, v_q.prompt, v_q.options, v_q.answer, v_q.params, v_q.formula,
    coalesce(v_q.unit, ''), coalesce(v_q.decimals, 2), coalesce(v_q.tolerance, 0),
    coalesce(v_q.tolerance_type, 'abs'), coalesce(v_q.marks, 1),
    coalesce(v_q.explanation, ''), v_q.image_path
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.list_reusable_questions(p_course uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_bank jsonb;
  v_past jsonb;
begin
  if p_course is not null then
    perform public.require_staff(p_course);
  elsif not (public.is_lecturer() or exists (select 1 from public.course_staff cs where cs.user_id = auth.uid())) then
    raise exception 'Only staff may access the question bank.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', qb.id,
    'source', 'bank',
    'course_id', qb.course_id,
    'course_code', qb.course_code,
    'topic', qb.topic,
    'difficulty', qb.difficulty,
    'kind', qb.kind,
    'prompt', qb.prompt,
    'options', qb.options,
    'answer', qb.answer,
    'params', qb.params,
    'formula', qb.formula,
    'unit', qb.unit,
    'decimals', qb.decimals,
    'tolerance', qb.tolerance,
    'tolerance_type', qb.tolerance_type,
    'marks', qb.marks,
    'explanation', qb.explanation,
    'image_path', qb.image_path,
    'created_at', qb.created_at
  ) order by qb.created_at desc), '[]'::jsonb)
  into v_bank
  from public.question_bank qb
  where qb.owner_id = auth.uid();

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into v_past
  from (
    select
      q.id,
      'past'::text as source,
      c.id as course_id,
      c.code as course_code,
      qz.id as quiz_id,
      qz.title as quiz_title,
      q.topic,
      q.kind,
      q.prompt,
      q.options,
      q.answer,
      q.params,
      q.formula,
      q.unit,
      q.decimals,
      q.tolerance,
      q.tolerance_type,
      q.marks,
      q.explanation,
      q.image_path,
      q.created_at,
      coalesce(st.attempts_count, 0) as attempts_count,
      st.avg_pct
    from public.questions q
    join public.quizzes qz on qz.id = q.quiz_id
    join public.courses c on c.id = qz.course_id
    left join lateral (
      select
        count(*)::int as attempts_count,
        round(avg(
          case
            when q.marks > 0 then coalesce(r.marks_awarded, 0) / q.marks * 100
            when r.is_correct then 100
            else 0
          end
        ))::int as avg_pct
      from public.responses r
      join public.attempts a on a.id = r.attempt_id
      where r.question_id = q.id
        and a.status <> 'in_progress'
    ) st on true
    where public.is_staff(c.id)
    order by q.created_at desc
    limit 400
  ) t;

  return jsonb_build_object('bank', v_bank, 'past', v_past);
end;
$$;

create or replace function public.import_questions_to_quiz(
  p_quiz  uuid,
  p_items jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_course uuid;
  v_pos    int;
  v_item   jsonb;
  v_count  int := 0;
begin
  select course_id into v_course from public.quizzes where id = p_quiz;
  if v_course is null then raise exception 'Quiz not found.'; end if;
  perform public.require_staff(v_course);

  select coalesce(max(position), 0) into v_pos from public.questions where quiz_id = p_quiz;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_pos := v_pos + 1;
    insert into public.questions (
      quiz_id, position, kind, prompt, options, answer, params, formula,
      unit, decimals, tolerance, tolerance_type, marks, explanation, topic, image_path
    ) values (
      p_quiz,
      v_pos,
      coalesce(v_item->>'kind', 'mcq'),
      coalesce(v_item->>'prompt', ''),
      coalesce(v_item->'options', '[]'::jsonb),
      coalesce(v_item->'answer', '{}'::jsonb),
      coalesce(v_item->'params', '{}'::jsonb),
      nullif(v_item->>'formula', ''),
      coalesce(v_item->>'unit', ''),
      greatest(0, least(6, coalesce((v_item->>'decimals')::int, 2))),
      greatest(0, coalesce((v_item->>'tolerance')::numeric, 0)),
      case when (v_item->>'tolerance_type') = 'pct' then 'pct' else 'abs' end,
      greatest(0, coalesce((v_item->>'marks')::numeric, 1)),
      coalesce(v_item->>'explanation', ''),
      coalesce(v_item->>'topic', ''),
      nullif(v_item->>'image_path', '')
    );
    v_count := v_count + 1;
  end loop;

  perform public.log_course_audit(
    v_course,
    'quiz_import_bank',
    format('Imported %s question(s) from Question Bank', v_count),
    jsonb_build_object('quiz_id', p_quiz, 'count', v_count)
  );
  return v_count;
end;
$$;

-- 17B. Quick Feedback Snippets & Anonymized Assignment Exemplars
create table if not exists public.grading_snippets (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  label      text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists grading_snippets_owner_idx on public.grading_snippets (owner_id, created_at desc);

alter table public.grading_snippets enable row level security;

drop policy if exists "Staff manage own grading snippets" on public.grading_snippets;
create policy "Staff manage own grading snippets" on public.grading_snippets
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create table if not exists public.assignment_exemplars (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  course_id     uuid not null references public.courses(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete set null,
  title         text not null,
  note          text not null default '',
  response_text text,
  file_path     text,
  file_name     text,
  marks         numeric,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists assignment_exemplars_assign_idx on public.assignment_exemplars (assignment_id, created_at desc);
create index if not exists assignment_exemplars_course_idx on public.assignment_exemplars (course_id);

alter table public.assignment_exemplars enable row level security;

drop policy if exists "Staff manage assignment exemplars" on public.assignment_exemplars;
create policy "Staff manage assignment exemplars" on public.assignment_exemplars
  for all to authenticated
  using (public.is_staff(course_id))
  with check (public.is_staff(course_id));

drop policy if exists "Students view released assignment exemplars" on public.assignment_exemplars;
create policy "Students view released assignment exemplars" on public.assignment_exemplars
  for select to authenticated
  using (
    public.is_enrolled(course_id)
    and exists (
      select 1 from public.assignments a
       where a.id = assignment_id and a.results_released = true
    )
  );

drop policy if exists "submissions exemplar read" on storage.objects;
create policy "submissions exemplar read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'submissions'
    and exists (
      select 1
        from public.assignment_exemplars ex
        join public.assignments a on a.id = ex.assignment_id
       where (ex.file_path = name or ex.file_path = 'viewonly:' || name)
         and a.results_released = true
         and public.is_enrolled(ex.course_id)
    )
  );

create or replace function public.promote_assignment_exemplar(
  p_submission uuid,
  p_title      text,
  p_note       text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sub    public.submissions;
  v_assign public.assignments;
  v_id     uuid;
begin
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null then raise exception 'Submission not found.'; end if;
  select * into v_assign from public.assignments where id = v_sub.assignment_id;
  if v_assign.id is null then raise exception 'Assignment not found.'; end if;
  perform public.require_staff(v_assign.course_id);

  insert into public.assignment_exemplars (
    assignment_id, course_id, submission_id, title, note,
    response_text, file_path, file_name, marks, created_by
  ) values (
    v_assign.id,
    v_assign.course_id,
    v_sub.id,
    coalesce(nullif(btrim(p_title), ''), 'Model A-Grade Submission'),
    coalesce(btrim(p_note), ''),
    nullif(v_sub.response_text, ''),
    case when v_sub.file_path in ('typed:online', 'presentation:in-class') then null else v_sub.file_path end,
    case when v_sub.file_path in ('typed:online', 'presentation:in-class') then null else v_sub.file_name end,
    v_sub.marks,
    auth.uid()
  ) returning id into v_id;

  perform public.log_course_audit(
    v_assign.course_id,
    'assignment_exemplar_added',
    format('Published anonymized exemplar "%s" for %s', coalesce(nullif(btrim(p_title), ''), 'Model Submission'), v_assign.title),
    jsonb_build_object('assignment_id', v_assign.id, 'exemplar_id', v_id)
  );
  return v_id;
end;
$$;

create or replace function public.remove_assignment_exemplar(p_exemplar uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_course uuid;
begin
  select course_id into v_course from public.assignment_exemplars where id = p_exemplar;
  if v_course is null then return; end if;
  perform public.require_staff(v_course);
  delete from public.assignment_exemplars where id = p_exemplar;
end;
$$;

create or replace function public.course_assignment_exemplars(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_staff boolean := public.is_staff(p_course);
begin
  if not v_staff and not public.is_enrolled(p_course) then
    raise exception 'Access denied.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', ex.id,
      'assignment_id', ex.assignment_id,
      'submission_id', case when v_staff then ex.submission_id else null end,
      'title', ex.title,
      'note', ex.note,
      'response_text', ex.response_text,
      'file_path', ex.file_path,
      'file_name', ex.file_name,
      'marks', ex.marks,
      'max_marks', a.max_marks,
      'created_at', ex.created_at
    ) order by ex.created_at desc)
    from public.assignment_exemplars ex
    join public.assignments a on a.id = ex.assignment_id
    where ex.course_id = p_course
      and (v_staff or a.results_released = true)
  ), '[]'::jsonb);
end;
$$;

-- 17C. Bookable Presentation, Viva & Consultation Slots
create table if not exists public.booking_events (
  id                uuid primary key default gen_random_uuid(),
  course_id         uuid not null references public.courses(id) on delete cascade,
  assignment_id     uuid references public.assignments(id) on delete set null,
  title             text not null,
  kind              text not null default 'presentation' check (kind in ('presentation', 'viva', 'consultation')),
  location          text not null default '',
  slot_minutes      int not null default 10,
  allow_syndicate   boolean not null default false,
  booking_closes_at timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists booking_events_course_idx on public.booking_events (course_id, created_at desc);

create table if not exists public.booking_slots (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.booking_events(id) on delete cascade,
  course_id         uuid not null references public.courses(id) on delete cascade,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  room              text not null default '',
  booked_by_user    uuid references public.profiles(id) on delete set null,
  booked_index_no   text,
  booked_name       text,
  syndicate_name    text,
  syndicate_members jsonb,
  booked_at         timestamptz
);
create index if not exists booking_slots_event_idx on public.booking_slots (event_id, starts_at);
create index if not exists booking_slots_course_idx on public.booking_slots (course_id, starts_at);

alter table public.booking_events enable row level security;
alter table public.booking_slots enable row level security;

drop policy if exists "Staff manage booking events" on public.booking_events;
create policy "Staff manage booking events" on public.booking_events
  for all to authenticated
  using (public.is_staff(course_id))
  with check (public.is_staff(course_id));

drop policy if exists "Enrolled read booking events" on public.booking_events;
create policy "Enrolled read booking events" on public.booking_events
  for select to authenticated
  using (public.is_enrolled(course_id));

drop policy if exists "Staff manage booking slots" on public.booking_slots;
create policy "Staff manage booking slots" on public.booking_slots
  for all to authenticated
  using (public.is_staff(course_id))
  with check (public.is_staff(course_id));

drop policy if exists "Enrolled read booking slots" on public.booking_slots;
create policy "Enrolled read booking slots" on public.booking_slots
  for select to authenticated
  using (public.is_enrolled(course_id));

create or replace function public.create_booking_event(
  p_course          uuid,
  p_title           text,
  p_kind            text default 'presentation',
  p_location        text default '',
  p_assignment      uuid default null,
  p_allow_syndicate boolean default false,
  p_closes_at       timestamptz default null,
  p_slots           jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ev_id uuid;
  v_item  jsonb;
  v_kind  text := case when p_kind in ('presentation', 'viva', 'consultation') then p_kind else 'presentation' end;
begin
  perform public.require_staff(p_course);
  if nullif(btrim(p_title), '') is null then raise exception 'Schedule title is required.'; end if;
  if jsonb_array_length(coalesce(p_slots, '[]'::jsonb)) = 0 then
    raise exception 'At least one time slot is required.';
  end if;

  insert into public.booking_events (
    course_id, assignment_id, title, kind, location, allow_syndicate, booking_closes_at, created_by
  ) values (
    p_course, p_assignment, btrim(p_title), v_kind, coalesce(btrim(p_location), ''),
    coalesce(p_allow_syndicate, false), p_closes_at, auth.uid()
  ) returning id into v_ev_id;

  for v_item in select * from jsonb_array_elements(p_slots)
  loop
    insert into public.booking_slots (event_id, course_id, starts_at, ends_at, room)
    values (
      v_ev_id,
      p_course,
      (v_item->>'starts_at')::timestamptz,
      (v_item->>'ends_at')::timestamptz,
      coalesce(nullif(btrim(v_item->>'room'), ''), coalesce(btrim(p_location), ''))
    );
  end loop;

  perform public.log_course_audit(
    p_course,
    'booking_event_created',
    format('Created %s slot schedule "%s" (%s slots)', v_kind, btrim(p_title), jsonb_array_length(p_slots)),
    jsonb_build_object('event_id', v_ev_id, 'kind', v_kind)
  );
  return v_ev_id;
end;
$$;

create or replace function public.delete_booking_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_course uuid;
begin
  select course_id into v_course from public.booking_events where id = p_event;
  if v_course is null then return; end if;
  perform public.require_staff(v_course);
  delete from public.booking_events where id = p_event;
end;
$$;

create or replace function public.course_booking_events(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff(p_course) and not public.is_enrolled(p_course) then
    raise exception 'Access denied.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', ev.id,
      'course_id', ev.course_id,
      'assignment_id', ev.assignment_id,
      'assignment_title', a.title,
      'title', ev.title,
      'kind', ev.kind,
      'location', ev.location,
      'allow_syndicate', ev.allow_syndicate,
      'booking_closes_at', ev.booking_closes_at,
      'created_at', ev.created_at,
      'slots', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', sl.id,
          'event_id', sl.event_id,
          'starts_at', sl.starts_at,
          'ends_at', sl.ends_at,
          'room', sl.room,
          'booked', (sl.booked_by_user is not null),
          'booked_by_me', (sl.booked_by_user = auth.uid()),
          'booked_index_no', sl.booked_index_no,
          'booked_name', sl.booked_name,
          'syndicate_name', sl.syndicate_name,
          'syndicate_members', sl.syndicate_members,
          'booked_at', sl.booked_at
        ) order by sl.starts_at)
        from public.booking_slots sl
        where sl.event_id = ev.id
      ), '[]'::jsonb)
    ) order by ev.created_at desc)
    from public.booking_events ev
    left join public.assignments a on a.id = ev.assignment_id
    where ev.course_id = p_course
  ), '[]'::jsonb);
end;
$$;

create or replace function public.book_slot(
  p_slot              uuid,
  p_syndicate_name    text default null,
  p_syndicate_members jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_slot  public.booking_slots;
  v_ev    public.booking_events;
  v_prof  public.profiles;
  v_norm  text;
begin
  select * into v_slot from public.booking_slots where id = p_slot for update;
  if v_slot.id is null then raise exception 'Slot not found.'; end if;
  select * into v_ev from public.booking_events where id = v_slot.event_id;
  if not public.is_enrolled(v_ev.course_id) then raise exception 'Not enrolled in this course.'; end if;
  if v_ev.booking_closes_at is not null and now() > v_ev.booking_closes_at then
    raise exception 'Slot booking has closed for this schedule.';
  end if;
  if v_slot.booked_by_user is not null and v_slot.booked_by_user <> auth.uid() then
    raise exception 'That slot was just booked by someone else. Please pick another open slot.';
  end if;

  select * into v_prof from public.profiles where id = auth.uid();
  v_norm := public.norm_index(v_prof.index_no);

  -- Release any previous booking by this student or syndicate in the same schedule (clean swap)
  update public.booking_slots
     set booked_by_user = null,
         booked_index_no = null,
         booked_name = null,
         syndicate_name = null,
         syndicate_members = null,
         booked_at = null
   where event_id = v_ev.id
     and id <> p_slot
     and (
       booked_by_user = auth.uid()
       or (nullif(btrim(p_syndicate_name), '') is not null and syndicate_name = btrim(p_syndicate_name))
       or (v_norm <> '' and syndicate_members is not null and syndicate_members ? v_norm)
     );

  update public.booking_slots
     set booked_by_user = auth.uid(),
         booked_index_no = v_prof.index_no,
         booked_name = v_prof.full_name,
         syndicate_name = case when v_ev.allow_syndicate then nullif(btrim(p_syndicate_name), '') else null end,
         syndicate_members = case when v_ev.allow_syndicate then p_syndicate_members else null end,
         booked_at = now()
   where id = p_slot;

  return jsonb_build_object('ok', true, 'slot_id', p_slot);
end;
$$;

create or replace function public.cancel_slot_booking(p_slot uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_slot public.booking_slots;
  v_ev   public.booking_events;
  v_norm text := public.norm_index(public.my_index());
begin
  select * into v_slot from public.booking_slots where id = p_slot;
  if v_slot.id is null then return; end if;
  select * into v_ev from public.booking_events where id = v_slot.event_id;

  if not (
    public.is_staff(v_slot.course_id)
    or (
      (v_ev.booking_closes_at is null or now() <= v_ev.booking_closes_at)
      and (
        v_slot.booked_by_user = auth.uid()
        or (v_norm <> '' and v_slot.syndicate_members is not null and v_slot.syndicate_members ? v_norm)
      )
    )
  ) then
    raise exception 'Cannot cancel this slot.';
  end if;

  update public.booking_slots
     set booked_by_user = null,
         booked_index_no = null,
         booked_name = null,
         syndicate_name = null,
         syndicate_members = null,
         booked_at = null
   where id = p_slot;
end;
$$;

create or replace function public.my_upcoming_slots() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_norm text := public.norm_index(public.my_index());
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'slot_id', sl.id,
      'event_id', ev.id,
      'course_id', c.id,
      'course_code', c.code,
      'course_color', c.color,
      'title', ev.title,
      'kind', ev.kind,
      'room', coalesce(nullif(sl.room, ''), ev.location),
      'starts_at', sl.starts_at,
      'ends_at', sl.ends_at,
      'syndicate_name', sl.syndicate_name
    ) order by sl.starts_at)
    from public.booking_slots sl
    join public.booking_events ev on ev.id = sl.event_id
    join public.courses c on c.id = ev.course_id
    where c.archived = false
      and sl.ends_at >= now() - interval '2 hours'
      and (
        sl.booked_by_user = auth.uid()
        or (v_norm <> '' and sl.syndicate_members is not null and sl.syndicate_members ? v_norm)
      )
  ), '[]'::jsonb);
end;
$$;

-- 17D. Exam Hall & Seat Allocator
create table if not exists public.exam_seating_plans (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  quiz_id    uuid references public.quizzes(id) on delete cascade,
  title      text not null,
  exam_date  timestamptz,
  rooms      jsonb not null default '[]'::jsonb,
  sort_mode  text not null default 'index',
  published  boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists exam_seating_course_idx on public.exam_seating_plans (course_id, created_at desc);

create table if not exists public.exam_seat_assignments (
  id        uuid primary key default gen_random_uuid(),
  plan_id   uuid not null references public.exam_seating_plans(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  quiz_id   uuid references public.quizzes(id) on delete cascade,
  index_no  text not null,
  full_name text not null default '',
  programme text not null default '',
  stream    text not null default '',
  room_name text not null,
  seat_no   int not null,
  unique (plan_id, index_no)
);
create index if not exists exam_seat_plan_idx on public.exam_seat_assignments (plan_id, room_name, seat_no);
create index if not exists exam_seat_index_idx on public.exam_seat_assignments (index_no);

alter table public.exam_seating_plans enable row level security;
alter table public.exam_seat_assignments enable row level security;

drop policy if exists "Staff manage exam seating plans" on public.exam_seating_plans;
create policy "Staff manage exam seating plans" on public.exam_seating_plans
  for all to authenticated
  using (public.is_staff(course_id))
  with check (public.is_staff(course_id));

drop policy if exists "Students read published exam seating plans" on public.exam_seating_plans;
create policy "Students read published exam seating plans" on public.exam_seating_plans
  for select to authenticated
  using (published = true and public.is_enrolled(course_id));

drop policy if exists "Staff manage exam seat assignments" on public.exam_seat_assignments;
create policy "Staff manage exam seat assignments" on public.exam_seat_assignments
  for all to authenticated
  using (public.is_staff(course_id))
  with check (public.is_staff(course_id));

drop policy if exists "Students read own published seat" on public.exam_seat_assignments;
create policy "Students read own published seat" on public.exam_seat_assignments
  for select to authenticated
  using (
    public.norm_index(index_no) = public.norm_index(public.my_index())
    and exists (
      select 1 from public.exam_seating_plans p
       where p.id = plan_id and p.published = true
    )
  );

create or replace function public.save_exam_seating_plan(
  p_course      uuid,
  p_quiz        uuid default null,
  p_title       text default 'Exam Seating',
  p_exam_date   timestamptz default null,
  p_rooms       jsonb default '[]'::jsonb,
  p_sort_mode   text default 'index',
  p_published   boolean default false,
  p_assignments jsonb default '[]'::jsonb,
  p_plan_id     uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_plan_id uuid := p_plan_id;
  v_item    jsonb;
begin
  perform public.require_staff(p_course);

  if v_plan_id is null and p_quiz is not null then
    select id into v_plan_id
      from public.exam_seating_plans
     where course_id = p_course and quiz_id = p_quiz
     order by created_at desc limit 1;
  end if;

  if v_plan_id is not null then
    update public.exam_seating_plans
       set title = coalesce(nullif(btrim(p_title), ''), 'Exam Seating'),
           exam_date = p_exam_date,
           rooms = coalesce(p_rooms, '[]'::jsonb),
           sort_mode = coalesce(nullif(p_sort_mode, ''), 'index'),
           published = coalesce(p_published, false)
     where id = v_plan_id and course_id = p_course;
    delete from public.exam_seat_assignments where plan_id = v_plan_id;
  else
    insert into public.exam_seating_plans (
      course_id, quiz_id, title, exam_date, rooms, sort_mode, published, created_by
    ) values (
      p_course, p_quiz, coalesce(nullif(btrim(p_title), ''), 'Exam Seating'),
      p_exam_date, coalesce(p_rooms, '[]'::jsonb), coalesce(nullif(p_sort_mode, ''), 'index'),
      coalesce(p_published, false), auth.uid()
    ) returning id into v_plan_id;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    insert into public.exam_seat_assignments (
      plan_id, course_id, quiz_id, index_no, full_name, programme, stream, room_name, seat_no
    ) values (
      v_plan_id, p_course, p_quiz,
      v_item->>'index_no',
      coalesce(v_item->>'full_name', ''),
      coalesce(v_item->>'programme', ''),
      coalesce(v_item->>'stream', ''),
      v_item->>'room_name',
      coalesce((v_item->>'seat_no')::int, 1)
    );
  end loop;

  perform public.log_course_audit(
    p_course,
    'exam_seating_saved',
    format('Saved exam seating "%s" (%s students, %s)', coalesce(nullif(btrim(p_title), ''), 'Exam Seating'), jsonb_array_length(coalesce(p_assignments, '[]'::jsonb)), case when p_published then 'published' else 'draft' end),
    jsonb_build_object('plan_id', v_plan_id, 'quiz_id', p_quiz)
  );
  return v_plan_id;
end;
$$;

create or replace function public.delete_exam_seating_plan(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_course uuid;
begin
  select course_id into v_course from public.exam_seating_plans where id = p_plan;
  if v_course is null then return; end if;
  perform public.require_staff(v_course);
  delete from public.exam_seating_plans where id = p_plan;
end;
$$;

create or replace function public.course_exam_seating(p_course uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_staff boolean := public.is_staff(p_course);
  v_norm  text := public.norm_index(public.my_index());
begin
  if not v_staff and not public.is_enrolled(p_course) then
    raise exception 'Access denied.';
  end if;

  if v_staff then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'course_id', p.course_id,
        'quiz_id', p.quiz_id,
        'title', p.title,
        'exam_date', p.exam_date,
        'rooms', p.rooms,
        'sort_mode', p.sort_mode,
        'published', p.published,
        'created_at', p.created_at,
        'assignments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'index_no', sa.index_no,
            'full_name', sa.full_name,
            'programme', sa.programme,
            'stream', sa.stream,
            'room_name', sa.room_name,
            'seat_no', sa.seat_no
          ) order by sa.room_name, sa.seat_no)
          from public.exam_seat_assignments sa
          where sa.plan_id = p.id
        ), '[]'::jsonb)
      ) order by p.created_at desc)
      from public.exam_seating_plans p
      where p.course_id = p_course
    ), '[]'::jsonb);
  else
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_id', p.id,
        'quiz_id', p.quiz_id,
        'title', p.title,
        'exam_date', p.exam_date,
        'room_name', sa.room_name,
        'seat_no', sa.seat_no
      ) order by p.created_at desc)
      from public.exam_seating_plans p
      join public.exam_seat_assignments sa on sa.plan_id = p.id
      where p.course_id = p_course
        and p.published = true
        and public.norm_index(sa.index_no) = v_norm
    ), '[]'::jsonb);
  end if;
end;
$$;

create or replace function public.my_exam_seats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_norm text := public.norm_index(public.my_index());
begin
  if v_norm = '' then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'plan_id', p.id,
      'course_id', p.course_id,
      'course_code', c.code,
      'quiz_id', p.quiz_id,
      'title', p.title,
      'exam_date', p.exam_date,
      'room_name', sa.room_name,
      'seat_no', sa.seat_no
    ) order by p.created_at desc)
    from public.exam_seat_assignments sa
    join public.exam_seating_plans p on p.id = sa.plan_id
    join public.courses c on c.id = p.course_id
    where p.published = true
      and c.archived = false
      and public.norm_index(sa.index_no) = v_norm
  ), '[]'::jsonb);
end;
$$;

-- 17E. Direct Manual Roll-Call Session (No Projector Code)
create or replace function public.start_manual_rollcall(
  p_course  uuid,
  p_title   text,
  p_streams text[] default '{}',
  p_classes text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform public.require_staff(p_course);
  insert into public.attendance_sessions (course_id, title, streams, opens_at, closes_at, ask_row, classes)
  values (
    p_course,
    coalesce(nullif(btrim(p_title), ''), 'Roll-call — ' || to_char(now(), 'Dy DD Mon')),
    case when cardinality(coalesce(p_classes, '{}')) > 0 then '{}' else coalesce(p_streams, '{}') end,
    now(),
    now(),
    false,
    coalesce(p_classes, '{}')
  )
  returning id into v;
  perform public.log_course_audit(
    p_course,
    'attendance_manual_rollcall',
    format('Started manual roll-call "%s"', coalesce(nullif(btrim(p_title), ''), 'Roll-call')),
    jsonb_build_object('session_id', v)
  );
  return v;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'save_to_question_bank(uuid, text)',
    'list_reusable_questions(uuid)',
    'import_questions_to_quiz(uuid, jsonb)',
    'promote_assignment_exemplar(uuid, text, text)',
    'remove_assignment_exemplar(uuid)',
    'course_assignment_exemplars(uuid)',
    'create_booking_event(uuid, text, text, text, uuid, boolean, timestamptz, jsonb)',
    'delete_booking_event(uuid)',
    'course_booking_events(uuid)',
    'book_slot(uuid, text, jsonb)',
    'cancel_slot_booking(uuid)',
    'my_upcoming_slots()',
    'save_exam_seating_plan(uuid, uuid, text, timestamptz, jsonb, text, boolean, jsonb, uuid)',
    'delete_exam_seating_plan(uuid)',
    'course_exam_seating(uuid)',
    'my_exam_seats()',
    'start_manual_rollcall(uuid, text, text[], text[])'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
