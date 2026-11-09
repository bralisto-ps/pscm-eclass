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

  -- pick the questions (a random subset when a pool size is set), then order them
  select array_agg(x.id order by case when qz.shuffle_questions then random() else 0 end, x.position, x.created_at)
    into v_order
    from (select id, position, created_at from public.questions
           where quiz_id = p_quiz
           order by random()
           limit coalesce(nullif(qz.pool_size, 0), 100000)) x;
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
                               'max_exits', qz.max_exits, 'no_backtrack', qz.no_backtrack),
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

-- Add or update students on a course from a class list.
-- p_rows: [{"index_no":"4021180","full_name":"Kofi Mensah"}, ...]
create or replace function public.import_roster(p_course uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_idx text; v_name text; v_prog text; v_stream text;
        n_new int := 0; n_enrolled int := 0; n_skipped int := 0;
begin
  perform public.require_lecturer();
  for r in select * from jsonb_array_elements(p_rows) loop
    v_idx := public.norm_index(r->>'index_no');
    v_name := trim(coalesce(r->>'full_name', ''));
    v_prog := trim(coalesce(r->>'programme', ''));
    v_stream := trim(coalesce(r->>'stream', ''));
    if v_idx = '' then n_skipped := n_skipped + 1; continue; end if;
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
  student_id uuid not null references auth.users on delete cascade,
  subject text not null default '',
  message text not null,
  reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.course_messages enable row level security;

drop policy if exists student_messages_policy on public.course_messages;
create policy student_messages_policy on public.course_messages
  for all to authenticated
  using (student_id = auth.uid() or public.is_lecturer())
  with check (student_id = auth.uid() or public.is_lecturer());
