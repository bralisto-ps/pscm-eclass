-- =====================================================================
-- PSCM E-Class — World-Class Thesis & Dissertation Supervision Portal
-- Safe to run multiple times (idempotent).
-- Paste into Supabase -> SQL Editor -> New Query -> Run.
-- =====================================================================

-- 1. Private storage bucket for thesis drafts & supervisor reviewed files (25 MB max)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'theses',
  'theses',
  false,
  26214400,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'application/x-zip-compressed',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = 26214400;

-- 2. Core Thesis Supervision Tables
create table if not exists public.thesis_projects (
  id                  uuid primary key default gen_random_uuid(),
  supervisor_id       uuid references public.profiles(id) on delete set null,
  student_index_no    text not null,
  student_id          uuid references public.profiles(id) on delete set null,
  student_name        text not null default '',
  programme           text not null default '',
  degree_level        text not null default 'BSc' check (degree_level in ('HND','BSc','BBA','MSc','MBA','MPhil','PhD')),
  academic_year       text not null default '',
  title               text not null default 'Untitled Research Topic',
  research_area       text not null default '',
  abstract            text not null default '',
  ethics_status       text not null default 'not_required' check (ethics_status in ('not_required','pending','submitted','approved')),
  status              text not null default 'active' check (status in ('active','submitted_for_defence','completed','on_hold')),
  target_defence_date date,
  rubric_scores       jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists thesis_projects_student_idx on public.thesis_projects (student_index_no);
create index if not exists thesis_projects_student_uid_idx on public.thesis_projects (student_id);
create index if not exists thesis_projects_supervisor_idx on public.thesis_projects (supervisor_id);

create table if not exists public.thesis_milestones (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.thesis_projects(id) on delete cascade,
  stage_key         text not null,
  title             text not null,
  sort_order        int not null default 0,
  due_date          date,
  status            text not null default 'not_started'
                    check (status in ('not_started','submitted','under_review','revisions_requested','approved')),
  latest_version_no int not null default 0,
  updated_at        timestamptz not null default now(),
  unique (project_id, stage_key)
);

create index if not exists thesis_milestones_project_idx on public.thesis_milestones (project_id, sort_order);

create table if not exists public.thesis_submissions (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.thesis_projects(id) on delete cascade,
  milestone_id        uuid not null references public.thesis_milestones(id) on delete cascade,
  version_no          int not null default 1,
  uploaded_by         uuid references public.profiles(id) on delete set null,
  file_path           text not null,
  file_name           text not null,
  file_size           bigint not null default 0,
  mime_type           text not null default '',
  student_note        text not null default '',
  review_status       text not null default 'pending'
                      check (review_status in ('pending','under_review','revisions_requested','approved')),
  supervisor_feedback text not null default '',
  reviewed_file_path  text,
  reviewed_file_name  text,
  annotations         jsonb not null default '[]'::jsonb,
  submitted_at        timestamptz not null default now(),
  reviewed_at         timestamptz
);

create index if not exists thesis_submissions_project_idx on public.thesis_submissions (project_id, submitted_at desc);
create index if not exists thesis_submissions_milestone_idx on public.thesis_submissions (milestone_id, version_no desc);

create table if not exists public.thesis_meetings (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.thesis_projects(id) on delete cascade,
  meeting_date            timestamptz not null default now(),
  mode                    text not null default 'in_person' check (mode in ('in_person','online','phone')),
  summary                 text not null default '',
  action_items            jsonb not null default '[]'::jsonb,
  next_meeting_date       date,
  student_acknowledged_at timestamptz,
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now()
);

create index if not exists thesis_meetings_project_idx on public.thesis_meetings (project_id, meeting_date desc);

create table if not exists public.thesis_messages (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.thesis_projects(id) on delete cascade,
  milestone_id uuid references public.thesis_milestones(id) on delete set null,
  sender_id    uuid references public.profiles(id) on delete set null,
  sender_role  text not null default 'student' check (sender_role in ('student','lecturer')),
  sender_name  text not null default '',
  body         text not null,
  created_at   timestamptz not null default now()
);

create index if not exists thesis_messages_project_idx on public.thesis_messages (project_id, created_at asc);

-- 3. Authorization Helpers & Notification Dispatcher
create or replace function public.is_thesis_participant(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.thesis_projects tp
     where tp.id = p_project
       and (
         public.is_lecturer()
         or tp.student_id = auth.uid()
         or (
           tp.student_index_no <> ''
           and tp.student_index_no = (select p.index_no from public.profiles p where p.id = auth.uid())
         )
       )
  );
$$;

create or replace function public.thesis_notify(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_link text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null then return; end if;
  if to_regclass('public.notifications') is null then return; end if;
  insert into public.notifications (user_id, course_id, kind, title, body, link)
  values (
    p_user_id,
    null,
    coalesce(nullif(p_kind, ''), 'info'),
    left(coalesce(p_title, 'Thesis Update'), 180),
    left(coalesce(p_body, ''), 400),
    left(coalesce(p_link, '/thesis'), 200)
  );
end;
$$;

-- 4. Enable Row-Level Security on All Thesis Tables
alter table public.thesis_projects    enable row level security;
alter table public.thesis_milestones  enable row level security;
alter table public.thesis_submissions enable row level security;
alter table public.thesis_meetings    enable row level security;
alter table public.thesis_messages    enable row level security;

-- Projects
drop policy if exists "thesis_projects_select" on public.thesis_projects;
create policy "thesis_projects_select" on public.thesis_projects for select to authenticated
  using (public.is_thesis_participant(id));

drop policy if exists "thesis_projects_lecturer_all" on public.thesis_projects;
create policy "thesis_projects_lecturer_all" on public.thesis_projects for all to authenticated
  using (public.is_lecturer()) with check (public.is_lecturer());

-- Milestones
drop policy if exists "thesis_milestones_select" on public.thesis_milestones;
create policy "thesis_milestones_select" on public.thesis_milestones for select to authenticated
  using (public.is_thesis_participant(project_id));

drop policy if exists "thesis_milestones_lecturer_all" on public.thesis_milestones;
create policy "thesis_milestones_lecturer_all" on public.thesis_milestones for all to authenticated
  using (public.is_lecturer()) with check (public.is_lecturer());

-- Submissions
drop policy if exists "thesis_submissions_select" on public.thesis_submissions;
create policy "thesis_submissions_select" on public.thesis_submissions for select to authenticated
  using (public.is_thesis_participant(project_id));

drop policy if exists "thesis_submissions_lecturer_all" on public.thesis_submissions;
create policy "thesis_submissions_lecturer_all" on public.thesis_submissions for all to authenticated
  using (public.is_lecturer()) with check (public.is_lecturer());

-- Meetings
drop policy if exists "thesis_meetings_select" on public.thesis_meetings;
create policy "thesis_meetings_select" on public.thesis_meetings for select to authenticated
  using (public.is_thesis_participant(project_id));

drop policy if exists "thesis_meetings_lecturer_all" on public.thesis_meetings;
create policy "thesis_meetings_lecturer_all" on public.thesis_meetings for all to authenticated
  using (public.is_lecturer()) with check (public.is_lecturer());

-- Messages
drop policy if exists "thesis_messages_select" on public.thesis_messages;
create policy "thesis_messages_select" on public.thesis_messages for select to authenticated
  using (public.is_thesis_participant(project_id));

drop policy if exists "thesis_messages_lecturer_all" on public.thesis_messages;
create policy "thesis_messages_lecturer_all" on public.thesis_messages for all to authenticated
  using (public.is_lecturer()) with check (public.is_lecturer());

-- 5. Private Storage Policies for bucket 'theses'
-- Path format: <project_id>/<milestone_id>/<uploader_uid_or_review>/<file>
drop policy if exists "theses_read" on storage.objects;
create policy "theses_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'theses'
    and (
      public.is_lecturer()
      or public.is_thesis_participant(public.try_uuid((storage.foldername(name))[1]))
    )
  );

drop policy if exists "theses_upload" on storage.objects;
create policy "theses_upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'theses'
    and (
      public.is_lecturer()
      or (
        (storage.foldername(name))[3] = auth.uid()::text
        and public.is_thesis_participant(public.try_uuid((storage.foldername(name))[1]))
      )
    )
  );

drop policy if exists "theses_delete" on storage.objects;
create policy "theses_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'theses' and public.is_lecturer());

-- 6. Secure RPCs (Enforce Ownership + Auto-Notify via public.notifications)

-- 6a. Lecturer creates a new supervisee & milestone pipeline (also adds student to roster so they can activate!)
create or replace function public.create_thesis_project(
  p_index_no text,
  p_student_name text,
  p_programme text default '',
  p_degree_level text default 'BSc',
  p_academic_year text default '',
  p_title text default 'Untitled Research Topic',
  p_research_area text default '',
  p_target_defence_date date default null,
  p_milestones jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_idx text := public.norm_index(p_index_no);
  v_name text := trim(coalesce(p_student_name, ''));
  v_student_uid uuid;
  v_proj_id uuid;
  v_m jsonb;
  v_i int := 0;
begin
  perform public.require_lecturer();
  if v_idx = '' then raise exception 'Student index number is required.'; end if;
  if v_name = '' then v_name := v_idx; end if;

  -- Ensure supervisee exists in roster so they can activate an account even if not in any course
  insert into public.roster (index_no, full_name)
  values (v_idx, v_name)
  on conflict (index_no) do nothing;

  select id, coalesce(nullif(full_name, ''), v_name)
    into v_student_uid, v_name
    from public.profiles
   where index_no = v_idx
   limit 1;

  insert into public.thesis_projects (
    supervisor_id, student_index_no, student_id, student_name,
    programme, degree_level, academic_year, title, research_area, target_defence_date
  ) values (
    auth.uid(), v_idx, v_student_uid, v_name,
    trim(coalesce(p_programme, '')),
    case when p_degree_level in ('HND','BSc','BBA','MSc','MBA','MPhil','PhD') then p_degree_level else 'BSc' end,
    trim(coalesce(p_academic_year, '')),
    coalesce(nullif(trim(coalesce(p_title, '')), ''), 'Untitled Research Topic'),
    trim(coalesce(p_research_area, '')),
    p_target_defence_date
  ) returning id into v_proj_id;

  for v_m in select * from jsonb_array_elements(coalesce(p_milestones, '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.thesis_milestones (project_id, stage_key, title, sort_order, due_date)
    values (
      v_proj_id,
      coalesce(nullif(trim(v_m->>'stage_key'), ''), 'stage_' || v_i),
      coalesce(nullif(trim(v_m->>'title'), ''), 'Stage ' || v_i),
      coalesce((v_m->>'sort_order')::int, v_i),
      case when coalesce(v_m->>'due_date', '') <> '' then (v_m->>'due_date')::date else null end
    ) on conflict (project_id, stage_key) do nothing;
  end loop;

  if v_student_uid is not null then
    perform public.thesis_notify(
      v_student_uid,
      'thesis',
      'Thesis Supervision Workspace Ready',
      'Your supervisor added you to the Thesis Portal: ' || coalesce(nullif(trim(p_title), ''), 'Research Supervision'),
      '/thesis?project=' || v_proj_id::text
    );
  end if;

  return v_proj_id;
end;
$$;

-- 6b. Auto-link student_id when supervisee opens their portal after activating account
create or replace function public.claim_my_thesis_projects() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_idx text;
  v_name text;
  v_count int;
begin
  select index_no, full_name into v_idx, v_name from public.profiles where id = auth.uid();
  if v_idx is null or v_idx = '' then return 0; end if;
  update public.thesis_projects
     set student_id = auth.uid(),
         student_name = case when coalesce(v_name, '') <> '' then v_name else student_name end,
         updated_at = now()
   where student_index_no = v_idx
     and (student_id is null or student_id <> auth.uid());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 6c. Student (or lecturer) submits a new draft version for a milestone
create or replace function public.submit_thesis_version(
  p_project_id uuid,
  p_milestone_id uuid,
  p_file_path text,
  p_file_name text,
  p_file_size bigint default 0,
  p_mime_type text default '',
  p_student_note text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_proj public.thesis_projects%rowtype;
  v_mile public.thesis_milestones%rowtype;
  v_next_ver int;
  v_sub_id uuid;
  v_sup_id uuid;
begin
  if not public.is_thesis_participant(p_project_id) then
    raise exception 'You do not have permission to submit to this thesis workspace.';
  end if;
  select * into v_proj from public.thesis_projects where id = p_project_id;
  select * into v_mile from public.thesis_milestones where id = p_milestone_id and project_id = p_project_id;
  if v_mile.id is null then raise exception 'Thesis chapter/milestone not found.'; end if;

  select coalesce(max(version_no), 0) + 1
    into v_next_ver
    from public.thesis_submissions
   where milestone_id = p_milestone_id;

  insert into public.thesis_submissions (
    project_id, milestone_id, version_no, uploaded_by,
    file_path, file_name, file_size, mime_type, student_note, review_status
  ) values (
    p_project_id, p_milestone_id, v_next_ver, auth.uid(),
    p_file_path, left(trim(coalesce(p_file_name, 'draft.pdf')), 180),
    greatest(0, coalesce(p_file_size, 0)),
    left(coalesce(p_mime_type, ''), 120),
    left(trim(coalesce(p_student_note, '')), 2000),
    'pending'
  ) returning id into v_sub_id;

  update public.thesis_milestones
     set status = 'submitted',
         latest_version_no = v_next_ver,
         updated_at = now()
   where id = p_milestone_id;

  update public.thesis_projects set updated_at = now() where id = p_project_id;

  -- Notify supervisor(s)
  v_sup_id := v_proj.supervisor_id;
  if v_sup_id is not null and v_sup_id <> auth.uid() then
    perform public.thesis_notify(
      v_sup_id,
      'thesis',
      format('Thesis Draft v%s: %s — %s', v_next_ver, v_proj.student_name, v_mile.title),
      coalesce(nullif(trim(p_student_note), ''), 'Uploaded ' || p_file_name),
      '/teach/thesis?project=' || p_project_id::text
    );
  else
    perform public.thesis_notify(
      p.id,
      'thesis',
      format('Thesis Draft v%s: %s — %s', v_next_ver, v_proj.student_name, v_mile.title),
      coalesce(nullif(trim(p_student_note), ''), 'Uploaded ' || p_file_name),
      '/teach/thesis?project=' || p_project_id::text
    )
    from public.profiles p
    where p.role = 'lecturer' and p.id <> auth.uid();
  end if;

  return jsonb_build_object('id', v_sub_id, 'version_no', v_next_ver);
end;
$$;

-- 6d. Lecturer reviews a thesis submission (status + feedback + optional Track-Changes reviewed file)
create or replace function public.review_thesis_submission(
  p_submission_id uuid,
  p_review_status text,
  p_feedback text default '',
  p_reviewed_file_path text default null,
  p_reviewed_file_name text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_sub public.thesis_submissions%rowtype;
  v_proj public.thesis_projects%rowtype;
  v_mile public.thesis_milestones%rowtype;
  v_student_uid uuid;
  v_status text;
  v_label text;
begin
  perform public.require_lecturer();
  select * into v_sub from public.thesis_submissions where id = p_submission_id;
  if v_sub.id is null then raise exception 'Submission not found.'; end if;
  select * into v_proj from public.thesis_projects where id = v_sub.project_id;
  select * into v_mile from public.thesis_milestones where id = v_sub.milestone_id;

  v_status := case
    when p_review_status in ('pending','under_review','revisions_requested','approved') then p_review_status
    else 'under_review'
  end;

  update public.thesis_submissions
     set review_status = v_status,
         supervisor_feedback = left(coalesce(p_feedback, ''), 6000),
         reviewed_file_path = coalesce(nullif(p_reviewed_file_path, ''), reviewed_file_path),
         reviewed_file_name = coalesce(nullif(p_reviewed_file_name, ''), reviewed_file_name),
         reviewed_at = now()
   where id = p_submission_id;

  update public.thesis_milestones
     set status = case when v_status = 'pending' then 'submitted' else v_status end,
         updated_at = now()
   where id = v_sub.milestone_id;

  update public.thesis_projects set updated_at = now() where id = v_sub.project_id;

  v_student_uid := coalesce(
    v_proj.student_id,
    (select id from public.profiles where index_no = v_proj.student_index_no limit 1)
  );
  v_label := case v_status
    when 'approved' then 'Approved'
    when 'revisions_requested' then 'Revisions Requested'
    when 'under_review' then 'Under Review'
    else 'Updated'
  end;

  perform public.thesis_notify(
    v_student_uid,
    'thesis',
    format('Supervisor Review (%s): %s v%s', v_label, v_mile.title, v_sub.version_no),
    coalesce(nullif(left(trim(p_feedback), 240), ''), 'Your supervisor updated the review status of your chapter draft.'),
    '/thesis?project=' || v_proj.id::text
  );

  return true;
end;
$$;

-- 6e. Lecturer saves inline PDF/DOCX annotations & notifies student
create or replace function public.save_thesis_annotations(
  p_submission_id uuid,
  p_annotations jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_sub public.thesis_submissions%rowtype;
  v_proj public.thesis_projects%rowtype;
  v_mile public.thesis_milestones%rowtype;
  v_student_uid uuid;
  v_cnt int := jsonb_array_length(coalesce(p_annotations, '[]'::jsonb));
begin
  perform public.require_lecturer();
  select * into v_sub from public.thesis_submissions where id = p_submission_id;
  if v_sub.id is null then raise exception 'Submission not found.'; end if;
  select * into v_proj from public.thesis_projects where id = v_sub.project_id;
  select * into v_mile from public.thesis_milestones where id = v_sub.milestone_id;

  update public.thesis_submissions
     set annotations = coalesce(p_annotations, '[]'::jsonb),
         reviewed_at = coalesce(reviewed_at, now())
   where id = p_submission_id;

  update public.thesis_projects set updated_at = now() where id = v_sub.project_id;

  v_student_uid := coalesce(
    v_proj.student_id,
    (select id from public.profiles where index_no = v_proj.student_index_no limit 1)
  );

  perform public.thesis_notify(
    v_student_uid,
    'thesis',
    format('Inline Comments (%s): %s v%s', v_cnt, v_mile.title, v_sub.version_no),
    format('Your supervisor saved %s inline annotation%s on your draft. Open the Thesis Portal to view them on the page.', v_cnt, case when v_cnt = 1 then '' else 's' end),
    '/thesis?project=' || v_proj.id::text
  );

  return true;
end;
$$;

-- 6f. Student replies to a specific inline annotation pin (or marks addressed)
create or replace function public.reply_thesis_annotation(
  p_submission_id uuid,
  p_annotation_id text,
  p_reply text,
  p_resolved boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sub public.thesis_submissions%rowtype;
  v_proj public.thesis_projects%rowtype;
  v_mile public.thesis_milestones%rowtype;
  v_updated jsonb;
  v_reply_clean text := left(trim(coalesce(p_reply, '')), 1000);
begin
  select * into v_sub from public.thesis_submissions where id = p_submission_id;
  if v_sub.id is null then raise exception 'Submission not found.'; end if;
  if not public.is_thesis_participant(v_sub.project_id) then
    raise exception 'Permission denied.';
  end if;
  select * into v_proj from public.thesis_projects where id = v_sub.project_id;
  select * into v_mile from public.thesis_milestones where id = v_sub.milestone_id;

  select coalesce(
    jsonb_agg(
      case
        when (el->>'id') = p_annotation_id then
          el || jsonb_build_object(
            'studentReply', v_reply_clean,
            'studentResolved', coalesce(p_resolved, false),
            'repliedAt', now()
          )
        else el
      end
    ),
    '[]'::jsonb
  )
    into v_updated
    from jsonb_array_elements(coalesce(v_sub.annotations, '[]'::jsonb)) as el;

  update public.thesis_submissions
     set annotations = v_updated
   where id = p_submission_id;

  if not public.is_lecturer() and v_proj.supervisor_id is not null then
    perform public.thesis_notify(
      v_proj.supervisor_id,
      'thesis',
      format('Comment Reply: %s (%s v%s)', v_proj.student_name, v_mile.title, v_sub.version_no),
      coalesce(nullif(v_reply_clean, ''), 'Student marked an inline comment as addressed.'),
      '/teach/thesis?project=' || v_proj.id::text
    );
  end if;

  return v_updated;
end;
$$;

-- 6g. Log a supervision meeting & notify student
create or replace function public.log_thesis_meeting(
  p_project_id uuid,
  p_meeting_date timestamptz,
  p_mode text default 'in_person',
  p_summary text default '',
  p_action_items jsonb default '[]'::jsonb,
  p_next_meeting_date date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_proj public.thesis_projects%rowtype;
  v_id uuid;
  v_student_uid uuid;
begin
  perform public.require_lecturer();
  select * into v_proj from public.thesis_projects where id = p_project_id;
  if v_proj.id is null then raise exception 'Thesis project not found.'; end if;

  insert into public.thesis_meetings (
    project_id, meeting_date, mode, summary, action_items, next_meeting_date, created_by
  ) values (
    p_project_id,
    coalesce(p_meeting_date, now()),
    case when p_mode in ('in_person','online','phone') then p_mode else 'in_person' end,
    left(trim(coalesce(p_summary, '')), 4000),
    coalesce(p_action_items, '[]'::jsonb),
    p_next_meeting_date,
    auth.uid()
  ) returning id into v_id;

  update public.thesis_projects set updated_at = now() where id = p_project_id;

  v_student_uid := coalesce(
    v_proj.student_id,
    (select id from public.profiles where index_no = v_proj.student_index_no limit 1)
  );
  perform public.thesis_notify(
    v_student_uid,
    'thesis',
    'New Supervision Meeting Log',
    coalesce(nullif(left(trim(p_summary), 200), ''), 'Your supervisor logged meeting notes and action items. Please review and acknowledge.'),
    '/thesis?project=' || p_project_id::text
  );

  return v_id;
end;
$$;

-- 6h. Student acknowledges supervision meeting minutes
create or replace function public.acknowledge_thesis_meeting(p_meeting_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_m public.thesis_meetings%rowtype;
begin
  select * into v_m from public.thesis_meetings where id = p_meeting_id;
  if v_m.id is null then raise exception 'Meeting record not found.'; end if;
  if not public.is_thesis_participant(v_m.project_id) then raise exception 'Permission denied.'; end if;
  update public.thesis_meetings
     set student_acknowledged_at = coalesce(student_acknowledged_at, now())
   where id = p_meeting_id;
  return true;
end;
$$;

-- 6i. Post a supervision message (student <-> supervisor) with instant notification
create or replace function public.post_thesis_message(
  p_project_id uuid,
  p_body text,
  p_milestone_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_proj public.thesis_projects%rowtype;
  v_sender public.profiles%rowtype;
  v_clean text := left(trim(coalesce(p_body, '')), 3000);
  v_msg_id uuid;
  v_target_uid uuid;
begin
  if v_clean = '' then raise exception 'Message cannot be empty.'; end if;
  if not public.is_thesis_participant(p_project_id) then raise exception 'Permission denied.'; end if;
  select * into v_proj from public.thesis_projects where id = p_project_id;
  select * into v_sender from public.profiles where id = auth.uid();

  insert into public.thesis_messages (
    project_id, milestone_id, sender_id, sender_role, sender_name, body
  ) values (
    p_project_id,
    p_milestone_id,
    auth.uid(),
    case when public.is_lecturer() then 'lecturer' else 'student' end,
    coalesce(nullif(v_sender.full_name, ''), case when public.is_lecturer() then 'Supervisor' else v_proj.student_name end),
    v_clean
  ) returning id into v_msg_id;

  update public.thesis_projects set updated_at = now() where id = p_project_id;

  if public.is_lecturer() then
    v_target_uid := coalesce(
      v_proj.student_id,
      (select id from public.profiles where index_no = v_proj.student_index_no limit 1)
    );
    perform public.thesis_notify(
      v_target_uid,
      'thesis',
      'Supervisor Message: ' || left(v_proj.title, 70),
      left(v_clean, 240),
      '/thesis?project=' || p_project_id::text
    );
  else
    if v_proj.supervisor_id is not null and v_proj.supervisor_id <> auth.uid() then
      perform public.thesis_notify(
        v_proj.supervisor_id,
        'thesis',
        'Thesis Message from ' || v_proj.student_name,
        left(v_clean, 240),
        '/teach/thesis?project=' || p_project_id::text
      );
    else
      perform public.thesis_notify(
        p.id,
        'thesis',
        'Thesis Message from ' || v_proj.student_name,
        left(v_clean, 240),
        '/teach/thesis?project=' || p_project_id::text
      )
      from public.profiles p
      where p.role = 'lecturer' and p.id <> auth.uid();
    end if;
  end if;

  return v_msg_id;
end;
$$;

-- 7. Tighten execute grants on all new RPCs
do $$
declare f text;
begin
  foreach f in array array[
    'is_thesis_participant(uuid)',
    'create_thesis_project(text, text, text, text, text, text, text, date, jsonb)',
    'claim_my_thesis_projects()',
    'submit_thesis_version(uuid, uuid, text, text, bigint, text, text)',
    'review_thesis_submission(uuid, text, text, text, text)',
    'save_thesis_annotations(uuid, jsonb)',
    'reply_thesis_annotation(uuid, text, text, boolean)',
    'log_thesis_meeting(uuid, timestamptz, text, text, jsonb, date)',
    'acknowledge_thesis_meeting(uuid)',
    'post_thesis_message(uuid, text, uuid)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
