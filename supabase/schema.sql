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
alter table public.quizzes       enable row level security;
alter table public.questions     enable row level security;
alter table public.attempts      enable row level security;
alter table public.responses     enable row level security;
alter table public.assignments   enable row level security;
alter table public.submissions   enable row level security;

do $$
declare t text;
begin
  -- lecturer can do everything on every table
  foreach t in array array['profiles','roster','courses','enrollments','modules','materials',
                           'announcements','quizzes','questions','attempts','responses',
                           'assignments','submissions'] loop
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
create or replace function public.start_attempt(p_quiz uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  qz       public.quizzes;
  a        public.attempts;
  n        int;
  v_order  uuid[];
  v_dead   timestamptz;
  v_id     uuid;
begin
  select * into qz from public.quizzes where id = p_quiz;
  if not found or not qz.published or not public.is_enrolled(qz.course_id) then
    raise exception 'This quiz is not available to you.';
  end if;

  select * into a from public.attempts
   where quiz_id = p_quiz and student_id = auth.uid() and status = 'in_progress'
   order by attempt_no desc limit 1;
  if found then
    if now() <= a.deadline_at then return a.id; end if;
    perform public.finalize_attempt(a.id);
  end if;

  if qz.opens_at is not null and now() < qz.opens_at then
    raise exception 'This quiz has not opened yet.';
  end if;
  if qz.closes_at is not null and now() > qz.closes_at then
    raise exception 'This quiz has closed.';
  end if;

  select count(*) into n from public.attempts where quiz_id = p_quiz and student_id = auth.uid();
  if not qz.is_practice and n >= qz.max_attempts then
    raise exception 'You have used all your attempts for this quiz.';
  end if;

  if qz.shuffle_questions then
    select array_agg(id order by random()) into v_order from public.questions where quiz_id = p_quiz;
  else
    select array_agg(id order by position, created_at) into v_order from public.questions where quiz_id = p_quiz;
  end if;
  if v_order is null then raise exception 'This quiz has no questions yet.'; end if;

  v_dead := now() + make_interval(mins => qz.duration_minutes);
  if qz.closes_at is not null and qz.closes_at < v_dead then v_dead := qz.closes_at; end if;

  insert into public.attempts (quiz_id, student_id, attempt_no, question_order, deadline_at)
  values (p_quiz, auth.uid(), n + 1, v_order, v_dead)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.attempts; qz public.quizzes; c public.courses; qs jsonb;
begin
  select * into a from public.attempts where id = p_attempt and student_id = auth.uid();
  if not found then raise exception 'Attempt not found.'; end if;
  if a.status = 'in_progress' and now() > a.deadline_at then
    perform public.finalize_attempt(a.id);
    select * into a from public.attempts where id = p_attempt;
  end if;
  select * into qz from public.quizzes where id = a.quiz_id;
  select * into c from public.courses where id = qz.course_id;

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
                                  'server_now', now()),
    'quiz', jsonb_build_object('id', qz.id, 'title', qz.title, 'instructions', qz.instructions,
                               'reference', qz.reference, 'course_id', c.id, 'course_code', c.code,
                               'course_color', c.color),
    'questions', coalesce(qs, '[]'::jsonb));
end;
$$;

create or replace function public.save_response(p_attempt uuid, p_question uuid, p_value jsonb)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare a public.attempts;
begin
  select * into a from public.attempts where id = p_attempt and student_id = auth.uid();
  if not found then raise exception 'Attempt not found.'; end if;
  if a.status <> 'in_progress' or now() > a.deadline_at + interval '20 seconds' then
    raise exception 'Time is up — this attempt can no longer be changed.';
  end if;
  if not (p_question = any(a.question_order)) then raise exception 'Question not in this attempt.'; end if;
  if length(coalesce(p_value::text, '')) > 20000 then raise exception 'Answer is too long.'; end if;

  insert into public.responses (attempt_id, question_id, value, updated_at)
  values (p_attempt, p_question, p_value, now())
  on conflict (attempt_id, question_id) do update set value = excluded.value, updated_at = now();
  return now();
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
           'opens_at', q.opens_at, 'closes_at', q.closes_at,
           'duration_minutes', q.duration_minutes, 'max_attempts', q.max_attempts,
           'is_practice', q.is_practice,
           'question_count', (select count(*) from public.questions x where x.quiz_id = q.id),
           'total_marks', (select coalesce(sum(marks), 0) from public.questions x where x.quiz_id = q.id),
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
         order by coalesce(q.opens_at, q.created_at)), '[]'::jsonb)
    into r
    from public.quizzes q
   where q.course_id = p_course and q.published;
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
  if p_path is null or p_path not like p_assignment::text || '/' || auth.uid()::text || '/%' then
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
           case when q.opens_at > now() then q.opens_at else coalesce(q.closes_at, now()) end as due,
           q.opens_at, q.closes_at, q.duration_minutes,
           (select count(*) from public.questions x where x.quiz_id = q.id) as question_count
      from public.quizzes q join public.courses c on c.id = q.course_id
     where q.published and not q.is_practice and public.is_enrolled(c.id)
       and (q.closes_at is null or q.closes_at > now())
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

-- Add or update students on a course from a class list.
-- p_rows: [{"index_no":"4021180","full_name":"Kofi Mensah"}, ...]
create or replace function public.import_roster(p_course uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_idx text; v_name text; n_new int := 0; n_enrolled int := 0; n_skipped int := 0;
begin
  perform public.require_lecturer();
  for r in select * from jsonb_array_elements(p_rows) loop
    v_idx := public.norm_index(r->>'index_no');
    v_name := trim(coalesce(r->>'full_name', ''));
    if v_idx = '' then n_skipped := n_skipped + 1; continue; end if;
    if not exists (select 1 from public.roster where index_no = v_idx) then
      insert into public.roster (index_no, full_name) values (v_idx, coalesce(nullif(v_name, ''), v_idx));
      n_new := n_new + 1;
    elsif v_name <> '' then
      update public.roster set full_name = v_name where index_no = v_idx;
      update public.profiles set full_name = v_name where index_no = v_idx;
    end if;
    insert into public.enrollments (course_id, index_no) values (p_course, v_idx)
    on conflict do nothing;
    if found then n_enrolled := n_enrolled + 1; end if;
  end loop;
  return jsonb_build_object('new_students', n_new, 'enrolled', n_enrolled, 'skipped', n_skipped);
end;
$$;

create or replace function public.course_students(p_course uuid)
returns table (index_no text, full_name text, activated boolean, last_sign_in timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.require_lecturer();
  return query
    select r.index_no, r.full_name, p.id is not null, u.last_sign_in_at
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
  perform public.require_lecturer();
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
  perform public.require_lecturer();
  for a in select id from public.attempts
            where quiz_id = p_quiz and status = 'in_progress' and deadline_at < now() loop
    perform public.finalize_attempt(a.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- One row per enrolled student: their best finished attempt.
create or replace function public.quiz_gradebook(p_quiz uuid)
returns table (index_no text, full_name text, student_id uuid, attempt_id uuid, attempts_used int,
               status text, score numeric, max_score numeric, auto_score numeric, manual_score numeric,
               started_at timestamptz, submitted_at timestamptz, minutes_used numeric)
language plpgsql security definer set search_path = public as $$
declare v_course uuid;
begin
  perform public.require_lecturer();
  perform public.finalize_expired(p_quiz);
  select course_id into v_course from public.quizzes where id = p_quiz;
  return query
    select r.index_no, r.full_name, p.id,
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
           round((extract(epoch from (b.submitted_at - b.started_at)) / 60)::numeric, 1)
      from public.enrollments e
      join public.roster r on r.index_no = e.index_no
      left join public.profiles p on p.index_no = r.index_no
      left join lateral (
        select a.* from public.attempts a
         where a.quiz_id = p_quiz and a.student_id = p.id
         order by (a.status = 'in_progress'), a.score desc nulls last, a.submitted_at desc
         limit 1) b on true
     where e.course_id = v_course
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
  perform public.require_lecturer();
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
  perform public.require_lecturer();
  select q.marks, r.attempt_id into v_max, v_attempt
    from public.responses r join public.questions q on q.id = r.question_id
   where r.id = p_response;
  if v_attempt is null then raise exception 'Answer not found.'; end if;
  if p_marks is null or p_marks < 0 or p_marks > v_max then
    raise exception 'Marks must be between 0 and %.', v_max;
  end if;
  update public.responses
     set marks_awarded = p_marks, feedback = nullif(trim(coalesce(p_feedback, '')), ''),
         is_correct = (p_marks = v_max)
   where id = p_response;
  perform public.recalc_attempt(v_attempt);
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
  perform public.require_lecturer();
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
    into r from public.courses c;
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
    'start_attempt(uuid)', 'get_attempt(uuid)', 'save_response(uuid, uuid, jsonb)',
    'submit_attempt(uuid)', 'my_quizzes(uuid)', 'get_attempt_review(uuid)',
    'can_submit(uuid)', 'submit_assignment(uuid, text, text, text)', 'my_assignments(uuid)',
    'my_upcoming()', 'import_roster(uuid, jsonb)', 'course_students(uuid)',
    'reset_student_password(text, text)', 'finalize_expired(uuid)', 'quiz_gradebook(uuid)',
    'marking_queue(uuid)', 'mark_response(uuid, numeric, text)', 'test_formula(text, jsonb)',
    'lecturer_overview()', 'require_lecturer()']
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
         and (public.is_lecturer() or (storage.foldername(name))[2] = auth.uid()::text));

drop policy if exists "submissions delete" on storage.objects;
create policy "submissions delete" on storage.objects for delete to authenticated
  using (bucket_id = 'submissions' and public.is_lecturer());

-- Done.
