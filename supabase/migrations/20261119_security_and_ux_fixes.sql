-- =====================================================================
-- 18C. Security Hardening, Last-Seen Activity, At-Risk Tuning & Status Banner
-- =====================================================================

-- 1. Course Messages RLS split + trigger (2.3: prevent students spoofing lecturer replies)
drop policy if exists student_messages_policy on public.course_messages;
drop policy if exists student_messages_select on public.course_messages;
drop policy if exists student_messages_insert on public.course_messages;
drop policy if exists staff_messages_select on public.course_messages;
drop policy if exists staff_messages_update on public.course_messages;

create policy student_messages_select on public.course_messages
  for select to authenticated
  using (student_id = auth.uid());

create policy student_messages_insert on public.course_messages
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and public.is_enrolled(course_id)
    and reply is null
    and replied_at is null
  );

create policy staff_messages_select on public.course_messages
  for select to authenticated
  using (public.is_staff(course_id));

create policy staff_messages_update on public.course_messages
  for update to authenticated
  using (public.is_staff(course_id))
  with check (public.is_staff(course_id));

create or replace function public.guard_course_message_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff(old.course_id) then
    if new.reply is distinct from old.reply
       or new.replied_at is distinct from old.replied_at
       or new.student_id is distinct from old.student_id
       or new.course_id is distinct from old.course_id then
      raise exception 'Only course staff can reply to messages.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_course_message_update on public.course_messages;
create trigger trg_guard_course_message_update
  before update on public.course_messages
  for each row execute function public.guard_course_message_update();

-- 2. Restrict question_media bucket to safe raster image types (2.4: disallow SVG)
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'question_media';

-- 3. Track real student activity via profiles.last_seen_at for PWA / persistent sessions
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create or replace function public.touch_last_seen() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid()
     and (last_seen_at is null or last_seen_at < now() - interval '10 minutes');
end;
$$;

drop function if exists public.course_students(uuid);
create or replace function public.course_students(p_course uuid)
returns table (index_no text, full_name text, programme text, stream text, activated boolean, last_sign_in timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.require_staff(p_course);
  return query
    select r.index_no, r.full_name, r.programme, r.stream, p.id is not null,
           case
             when p.last_seen_at is not null and u.last_sign_in_at is not null then greatest(p.last_seen_at, u.last_sign_in_at)
             else coalesce(p.last_seen_at, u.last_sign_in_at)
           end
      from public.enrollments e
      join public.roster r on r.index_no = e.index_no
      left join public.profiles p on p.index_no = r.index_no
      left join auth.users u on u.id = p.id
     where e.course_id = p_course
     order by r.full_name, r.index_no;
end;
$$;

-- Smart At-Risk Radar: uses last_seen_at + requires >= 2 signals OR severe academic risk (avoids false positives on PWA users)
create or replace function public.course_at_risk(p_course uuid)
returns table (index_no text, full_name text, programme text, stream text, last_sign_in timestamptz,
               missed int, avg_pct numeric, attendance_pct numeric, reasons text[])
language plpgsql stable security definer set search_path = public, auth as $$
#variable_conflict use_column
begin
  perform public.require_staff(p_course);
  return query
  with st as (
    select r.index_no, r.full_name, r.programme, r.stream, p.id as uid,
           case
             when p.last_seen_at is not null and u.last_sign_in_at is not null then greatest(p.last_seen_at, u.last_sign_in_at)
             else coalesce(p.last_seen_at, u.last_sign_in_at)
           end as last_active_at
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
    from st),
  scored as (
    select m.*,
      (case when m.uid is null then 1 else 0 end
       + case when m.uid is not null and (m.last_active_at is null or m.last_active_at < now() - interval '14 days') then 1 else 0 end
       + case when m.missed >= 1 then 1 else 0 end
       + case when m.avg_pct < 50 then 1 else 0 end
       + case when m.att < 75 then 1 else 0 end) as risk_signals,
      array_remove(array[
        case when m.uid is null then 'Never activated account' end,
        case when m.uid is not null and (m.last_active_at is null or m.last_active_at < now() - interval '14 days')
             then 'Inactive 14+ days' end,
        case when m.missed >= 1 then 'Missed ' || m.missed || case when m.missed = 1 then ' quiz' else ' quizzes' end end,
        case when m.avg_pct < 50 then 'Quiz average below 50%' end,
        case when m.att < 75 then 'Attendance below 75%' end], null) as all_reasons
    from m)
  select s.index_no, s.full_name, s.programme, s.stream, s.last_active_at, s.missed, s.avg_pct, s.att, s.all_reasons
    from scored s
   where s.missed >= 2
      or s.avg_pct < 40
      or s.att < 50
      or s.risk_signals >= 2
   order by s.risk_signals desc, s.missed desc, s.full_name, s.index_no;
end;
$$;

-- 4. Minimum 8-character password check on lecturer password resets
create or replace function public.reset_student_password(p_index text, p_password text) returns boolean
language plpgsql security definer set search_path = public, extensions, auth as $$
declare v_id uuid;
begin
  if not (public.is_lecturer() or public.ta_sees_index(public.norm_index(p_index))) then
    raise exception 'Only the lecturer or the course TA can do this.';
  end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters.'; end if;
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

-- 5. Portal-wide Status / Maintenance Banner (lecturer controlled)
create or replace function public.get_app_banner() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select value::jsonb from public.app_settings where key = 'maintenance_banner'),
    '{"message":"","kind":"info"}'::jsonb
  );
$$;

create or replace function public.set_app_banner(p_message text, p_kind text default 'info') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_msg text := left(trim(coalesce(p_message, '')), 400);
  v_kind text := case when p_kind in ('info', 'warn', 'error') then p_kind else 'info' end;
  v_payload jsonb;
begin
  perform public.require_lecturer();
  v_payload := jsonb_build_object('message', v_msg, 'kind', v_kind, 'updated_at', now());
  insert into public.app_settings (key, value)
  values ('maintenance_banner', v_payload::text)
  on conflict (key) do update set value = excluded.value;
  return v_payload;
end;
$$;

-- 6. Guard import_roster against overwriting real names with an accidental index-only re-import
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
         set full_name = case
                           when v_name <> '' and public.norm_index(v_name) <> v_idx then v_name
                           when public.norm_index(full_name) = v_idx and v_name <> '' then v_name
                           else full_name
                         end,
             programme = coalesce(nullif(v_prog, ''), programme),
             stream    = coalesce(nullif(v_stream, ''), stream)
       where index_no = v_idx;
      if v_name <> '' and public.norm_index(v_name) <> v_idx then
        update public.profiles set full_name = v_name where index_no = v_idx;
      end if;
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
        format('Imported roster list (%s rows) — %s new, %s enrolled',
               jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), n_new, n_enrolled)
    end;
    perform public.log_course_audit(
      p_course,
      'roster_import',
      v_summary,
      jsonb_build_object('rows', jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 'new', n_new, 'enrolled', n_enrolled, 'skipped', n_skipped)
    );
  end if;
  return jsonb_build_object('new_students', n_new, 'enrolled', n_enrolled, 'skipped', n_skipped);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'touch_last_seen()',
    'course_students(uuid)',
    'course_at_risk(uuid)',
    'reset_student_password(text, text)',
    'set_app_banner(text, text)',
    'import_roster(uuid, jsonb)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant execute on function public.get_app_banner() to anon, authenticated;
