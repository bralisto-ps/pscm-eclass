-- =============================================================================
-- PSCM E-class — Assignment Product / Firm Pre-Registration & Duplicate Blocking
-- 100% idempotent — safe to run in Supabase SQL Editor.
--
-- Features:
--   * First-come, first-served unique product/firm pre-registration per assignment
--     (supports both individual students and syndicate groups).
--   * Per-assignment uniqueness mode: 'product' | 'firm' | 'both'.
--   * Built-in exact + fuzzy spelling normalization (strips Ltd/Limited/Ghana/Co/
--     PLC/punctuation/word order + pg_trgm similarity matching).
--   * Strictly anonymized taken list for students (never reveals other groups or
--     student identities).
--   * Staff view + Reject & Notify action (notifies student or full syndicate).
-- =============================================================================

create extension if not exists pg_trgm;

create table if not exists public.assignment_topic_claims (
  id               uuid primary key default gen_random_uuid(),
  assignment_id    uuid not null references public.assignments(id) on delete cascade,
  course_id        uuid not null references public.courses(id) on delete cascade,
  claimant_key     text not null,
  syndicate_id     text,
  syndicate_name   text,
  student_id       uuid not null references public.profiles(id) on delete cascade,
  firm_name        text not null,
  product_name     text not null,
  norm_firm        text not null,
  norm_product     text not null,
  norm_combo       text not null,
  status           text not null default 'approved' check (status in ('approved', 'rejected')),
  rejection_reason text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists assignment_topic_claims_assign_idx
  on public.assignment_topic_claims (assignment_id, status, created_at);

create unique index if not exists assignment_topic_claims_active_claimant_uidx
  on public.assignment_topic_claims (assignment_id, claimant_key)
  where status = 'approved';

alter table public.assignment_topic_claims enable row level security;

-- Staff manage claims for their courses; students access ONLY via SECURITY DEFINER RPCs
-- so students can never query other groups' names, index numbers, or user IDs.
drop policy if exists staff_manage_topic_claims on public.assignment_topic_claims;
create policy staff_manage_topic_claims on public.assignment_topic_claims
  for all to authenticated
  using (public.is_staff(course_id))
  with check (public.is_staff(course_id));

-- Normalize a firm or product name for duplicate & spelling detection:
-- lowercase, strip accents/punctuation, strip corporate/generic filler words,
-- normalize simple trailing plurals, and sort tokens alphabetically.
create or replace function public.norm_topic_entity(p_text text, p_kind text default 'product')
returns text
language plpgsql immutable as $$
declare
  v_clean text;
  v_tokens text[];
  v_tok text;
  v_kept text[] := '{}';
  v_stop text[];
begin
  v_clean := lower(coalesce(p_text, ''));
  -- Basic ASCII fold for common accented characters (e.g., Nestlé -> nestle)
  v_clean := translate(v_clean, 'áàâäãåéèêëíìîïóòôöõúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn');
  -- Replace non-alphanumeric with spaces
  v_clean := regexp_replace(v_clean, '[^a-z0-9]+', ' ', 'g');
  v_clean := btrim(regexp_replace(v_clean, '\s+', ' ', 'g'));
  if v_clean = '' then return ''; end if;

  if p_kind = 'firm' then
    v_stop := array[
      'the','ltd','limited','plc','inc','incorporated','corp','corporation',
      'co','company','ghana','gh','group','holdings','holding','enterprise',
      'enterprises','industries','industry','manufacturing','ventures','venture',
      'services','service','international','intl','global','west','africa',
      'african','and','of'
    ];
  else
    v_stop := array[
      'the','a','an','of','for','and','in','by','from','product','products',
      'brand','item','ghana','gh','ltd','limited','company','co'
    ];
  end if;

  v_tokens := string_to_array(v_clean, ' ');
  foreach v_tok in array v_tokens loop
    if v_tok = '' then continue; end if;
    if v_tok = any(v_stop) then continue; end if;
    if length(v_tok) >= 5 and right(v_tok, 1) = 's' and right(v_tok, 2) <> 'ss' then
      v_tok := left(v_tok, length(v_tok) - 1);
    end if;
    v_kept := array_append(v_kept, v_tok);
  end loop;

  if array_length(v_kept, 1) is null then
    -- Fallback to stripped raw text if everything was stop words
    return regexp_replace(v_clean, '\s+', ' ', 'g');
  end if;

  select string_agg(t, ' ' order by t)
    into v_clean
    from (select distinct unnest(v_kept) as t) s;

  return coalesce(v_clean, '');
end;
$$;

-- Helper: extract topicRegistration metadata + caller's syndicate group (internal)
create or replace function public.resolve_assignment_topic_context(
  p_assignment uuid,
  p_user_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_assign public.assignments;
  v_idx text;
  v_match text[];
  v_meta jsonb := '{}'::jsonb;
  v_topic jsonb := '{}'::jsonb;
  v_syn jsonb := '{}'::jsonb;
  v_grp jsonb;
  v_syn_id text := null;
  v_syn_name text := null;
  v_syn_enabled boolean := false;
  v_claimant_key text;
begin
  select * into v_assign from public.assignments where id = p_assignment;
  if not found then
    raise exception 'Assignment not found.';
  end if;

  select upper(btrim(coalesce(index_no, ''))) into v_idx
    from public.profiles where id = p_user_id;

  if v_assign.instructions is not null and position('ASSIGN_META:' in v_assign.instructions) > 0 then
    v_match := regexp_match(v_assign.instructions, '<!--\s*ASSIGN_META:(\{.*?\})\s*-->\s*$');
    if v_match is not null and array_length(v_match, 1) >= 1 then
      begin
        v_meta := v_match[1]::jsonb;
      exception when others then
        v_meta := '{}'::jsonb;
      end;
    end if;
  end if;

  v_topic := coalesce(v_meta -> 'topicRegistration', '{}'::jsonb);
  v_syn := coalesce(v_meta -> 'syndicate', '{}'::jsonb);
  v_syn_enabled := coalesce((v_syn ->> 'enabled')::boolean, false);

  if v_syn_enabled and v_idx <> '' and jsonb_typeof(v_syn -> 'groups') = 'array' then
    for v_grp in select value from jsonb_array_elements(v_syn -> 'groups') loop
      if jsonb_typeof(v_grp -> 'members') = 'array' and exists (
        select 1 from jsonb_array_elements_text(v_grp -> 'members') m
        where upper(btrim(m)) = v_idx
      ) then
        v_syn_id := coalesce(nullif(btrim(v_grp ->> 'id'), ''), nullif(btrim(v_grp ->> 'name'), ''));
        v_syn_name := nullif(btrim(v_grp ->> 'name'), '');
        exit;
      end if;
    end loop;
  end if;

  if v_syn_id is not null then
    v_claimant_key := 'syn:' || v_syn_id;
  else
    v_claimant_key := 'stu:' || p_user_id::text;
  end if;

  return jsonb_build_object(
    'course_id', v_assign.course_id,
    'due_at', v_assign.due_at,
    'published', v_assign.published,
    'syndicate_enabled', v_syn_enabled,
    'syndicate_id', v_syn_id,
    'syndicate_name', v_syn_name,
    'claimant_key', v_claimant_key,
    'topic', v_topic
  );
end;
$$;

revoke execute on function public.resolve_assignment_topic_context(uuid, uuid)
  from public, anon, authenticated;

-- 1. Student RPC: fetch my claim + strictly anonymized list of already-taken items
create or replace function public.assignment_topic_status(p_assignment uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ctx jsonb;
  v_course uuid;
  v_claimant_key text;
  v_my_claim jsonb;
  v_taken jsonb;
begin
  v_ctx := public.resolve_assignment_topic_context(p_assignment, auth.uid());
  v_course := (v_ctx ->> 'course_id')::uuid;
  if not (public.is_enrolled(v_course) or public.is_staff(v_course)) then
    raise exception 'Not enrolled in this course.';
  end if;

  v_claimant_key := v_ctx ->> 'claimant_key';

  select jsonb_build_object(
           'id', c.id,
           'firm_name', c.firm_name,
           'product_name', c.product_name,
           'status', c.status,
           'rejection_reason', c.rejection_reason,
           'created_at', c.created_at,
           'updated_at', c.updated_at
         )
    into v_my_claim
    from public.assignment_topic_claims c
   where c.assignment_id = p_assignment
     and c.claimant_key = v_claimant_key
   order by (c.status = 'approved') desc, c.updated_at desc
   limit 1;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'firm_name', c.firm_name,
               'product_name', c.product_name,
               'is_mine', (c.claimant_key = v_claimant_key)
             )
             order by lower(c.firm_name), lower(c.product_name)
           ),
           '[]'::jsonb
         )
    into v_taken
    from public.assignment_topic_claims c
   where c.assignment_id = p_assignment
     and c.status = 'approved';

  return jsonb_build_object(
    'claimant_key', v_claimant_key,
    'syndicate_name', v_ctx ->> 'syndicate_name',
    'my_claim', v_my_claim,
    'taken', v_taken,
    'taken_count', jsonb_array_length(v_taken)
  );
end;
$$;

-- 2. Student RPC: claim a unique product/firm (race-safe + built-in fuzzy spelling guard)
create or replace function public.claim_assignment_topic(
  p_assignment uuid,
  p_firm text,
  p_product text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ctx jsonb;
  v_course uuid;
  v_topic jsonb;
  v_uniqueness text;
  v_deadline timestamptz;
  v_claimant_key text;
  v_syn_enabled boolean;
  v_syn_id text;
  v_syn_name text;
  v_firm text := btrim(regexp_replace(coalesce(p_firm, ''), '\s+', ' ', 'g'));
  v_product text := btrim(regexp_replace(coalesce(p_product, ''), '\s+', ' ', 'g'));
  v_nf text;
  v_np text;
  v_nc text;
  v_dup record;
  v_row public.assignment_topic_claims;
begin
  v_ctx := public.resolve_assignment_topic_context(p_assignment, auth.uid());
  v_course := (v_ctx ->> 'course_id')::uuid;
  if not public.is_enrolled(v_course) then
    raise exception 'You are not enrolled in this course.';
  end if;

  v_topic := coalesce(v_ctx -> 'topic', '{}'::jsonb);
  if not coalesce((v_topic ->> 'enabled')::boolean, false) then
    raise exception 'Product / firm registration is not enabled for this assignment.';
  end if;

  v_uniqueness := lower(coalesce(nullif(v_topic ->> 'uniqueness', ''), 'product'));
  if v_uniqueness not in ('product', 'firm', 'both') then
    v_uniqueness := 'product';
  end if;

  if nullif(btrim(coalesce(v_topic ->> 'deadline', '')), '') is not null then
    begin
      v_deadline := (v_topic ->> 'deadline')::timestamptz;
    exception when others then
      v_deadline := null;
    end;
  else
    v_deadline := (v_ctx ->> 'due_at')::timestamptz;
  end if;

  if v_deadline is not null and now() > v_deadline then
    raise exception 'The registration deadline has passed.';
  end if;

  v_syn_enabled := coalesce((v_ctx ->> 'syndicate_enabled')::boolean, false);
  v_syn_id := nullif(v_ctx ->> 'syndicate_id', '');
  v_syn_name := nullif(v_ctx ->> 'syndicate_name', '');
  v_claimant_key := v_ctx ->> 'claimant_key';

  if v_syn_enabled and v_syn_id is null then
    raise exception 'You are not assigned to a syndicate group for this assignment yet. Please contact your lecturer.';
  end if;

  if length(v_firm) < 2 then
    raise exception 'Enter the firm or company name (at least 2 characters).';
  end if;
  if v_uniqueness <> 'firm' and length(v_product) < 2 then
    raise exception 'Enter the product or service name (at least 2 characters).';
  end if;
  if length(v_firm) > 120 or length(v_product) > 120 then
    raise exception 'Keep firm and product names under 120 characters.';
  end if;

  v_nf := public.norm_topic_entity(v_firm, 'firm');
  v_np := public.norm_topic_entity(v_product, 'product');
  v_nc := public.norm_topic_entity(v_firm || ' ' || v_product, 'product');

  -- Serialize concurrent claims for this assignment (first-come, first-served)
  perform pg_advisory_xact_lock(hashtext('topic_claim:' || p_assignment::text));

  -- Check Layer-1 exact + fuzzy spelling duplicates against all OTHER approved claims
  if v_uniqueness in ('firm', 'both') then
    select c.firm_name, c.product_name,
           similarity(c.norm_firm, v_nf) as sim
      into v_dup
      from public.assignment_topic_claims c
     where c.assignment_id = p_assignment
       and c.status = 'approved'
       and c.claimant_key <> v_claimant_key
       and (
         c.norm_firm = v_nf
         or (length(v_nf) >= 4 and length(c.norm_firm) >= 4 and (
           similarity(c.norm_firm, v_nf) >= 0.62
           or word_similarity(v_nf, c.norm_firm) >= 0.78
           or word_similarity(c.norm_firm, v_nf) >= 0.78
         ))
       )
     order by (c.norm_firm = v_nf) desc, similarity(c.norm_firm, v_nf) desc
     limit 1;

    if found then
      return jsonb_build_object(
        'ok', false,
        'duplicate', true,
        'matched_firm', v_dup.firm_name,
        'matched_product', v_dup.product_name,
        'reason', format(
          'Firm "%s" is already registered (matches "%s"). Please choose a different firm.',
          v_firm, v_dup.firm_name
        )
      );
    end if;
  end if;

  if v_uniqueness in ('product', 'both') then
    select c.firm_name, c.product_name,
           greatest(similarity(c.norm_product, v_np), similarity(c.norm_combo, v_nc)) as sim
      into v_dup
      from public.assignment_topic_claims c
     where c.assignment_id = p_assignment
       and c.status = 'approved'
       and c.claimant_key <> v_claimant_key
       and (
         c.norm_product = v_np
         or c.norm_combo = v_nc
         or (length(v_np) >= 4 and length(c.norm_product) >= 4 and (
           similarity(c.norm_product, v_np) >= 0.65
           or (
             (c.norm_firm = v_nf or similarity(c.norm_firm, v_nf) >= 0.55)
             and similarity(c.norm_product, v_np) >= 0.50
           )
         ))
         or (length(v_nc) >= 6 and length(c.norm_combo) >= 6 and similarity(c.norm_combo, v_nc) >= 0.72)
       )
     order by (c.norm_product = v_np or c.norm_combo = v_nc) desc, sim desc
     limit 1;

    if found then
      return jsonb_build_object(
        'ok', false,
        'duplicate', true,
        'matched_firm', v_dup.firm_name,
        'matched_product', v_dup.product_name,
        'reason', format(
          'Product "%s" is already registered (matches "%s — %s"). Please choose a different product.',
          v_product, v_dup.firm_name, v_dup.product_name
        )
      );
    end if;
  end if;

  -- Remove any previous claim (approved or rejected) by this same claimant before inserting fresh
  delete from public.assignment_topic_claims
   where assignment_id = p_assignment
     and claimant_key = v_claimant_key;

  insert into public.assignment_topic_claims (
    assignment_id, course_id, claimant_key, syndicate_id, syndicate_name,
    student_id, firm_name, product_name, norm_firm, norm_product, norm_combo,
    status, rejection_reason
  )
  values (
    p_assignment, v_course, v_claimant_key, v_syn_id, v_syn_name,
    auth.uid(), v_firm, v_product, v_nf, v_np, v_nc,
    'approved', ''
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'claim', jsonb_build_object(
      'id', v_row.id,
      'firm_name', v_row.firm_name,
      'product_name', v_row.product_name,
      'status', v_row.status,
      'created_at', v_row.created_at
    )
  );
end;
$$;

-- 3. Student RPC: release my own registration before deadline (to pick another)
create or replace function public.release_my_assignment_topic(p_assignment uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ctx jsonb;
  v_course uuid;
  v_topic jsonb;
  v_deadline timestamptz;
begin
  v_ctx := public.resolve_assignment_topic_context(p_assignment, auth.uid());
  v_course := (v_ctx ->> 'course_id')::uuid;
  if not public.is_enrolled(v_course) then
    raise exception 'Not enrolled in this course.';
  end if;

  v_topic := coalesce(v_ctx -> 'topic', '{}'::jsonb);
  if nullif(btrim(coalesce(v_topic ->> 'deadline', '')), '') is not null then
    begin
      v_deadline := (v_topic ->> 'deadline')::timestamptz;
    exception when others then
      v_deadline := null;
    end;
  else
    v_deadline := (v_ctx ->> 'due_at')::timestamptz;
  end if;

  if v_deadline is not null and now() > v_deadline then
    raise exception 'The registration deadline has passed; your registered choice is locked.';
  end if;

  delete from public.assignment_topic_claims
   where assignment_id = p_assignment
     and claimant_key = (v_ctx ->> 'claimant_key')
     and status = 'approved';
end;
$$;

-- 4. Staff RPC: view all registrations in chronological (first-come) order
create or replace function public.assignment_topic_claims_staff(p_assignment uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_course uuid;
  v_rows jsonb;
begin
  select course_id into v_course from public.assignments where id = p_assignment;
  if v_course is null then raise exception 'Assignment not found.'; end if;
  perform public.require_staff(v_course);

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', c.id,
               'claimant_key', c.claimant_key,
               'syndicate_id', c.syndicate_id,
               'syndicate_name', c.syndicate_name,
               'student_id', c.student_id,
               'full_name', coalesce(p.full_name, ''),
               'index_no', coalesce(p.index_no, ''),
               'firm_name', c.firm_name,
               'product_name', c.product_name,
               'status', c.status,
               'rejection_reason', c.rejection_reason,
               'created_at', c.created_at,
               'updated_at', c.updated_at
             )
             order by (c.status = 'approved') desc, c.created_at asc
           ),
           '[]'::jsonb
         )
    into v_rows
    from public.assignment_topic_claims c
    left join public.profiles p on p.id = c.student_id
   where c.assignment_id = p_assignment;

  return v_rows;
end;
$$;

-- 5. Staff RPC: reject a duplicate/invalid claim and notify the student (or full syndicate)
create or replace function public.staff_reject_assignment_topic(
  p_claim uuid,
  p_reason text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_claim public.assignment_topic_claims;
  v_assign public.assignments;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_match text[];
  v_meta jsonb;
  v_grp jsonb;
  v_notified_ids uuid[] := '{}';
  v_uid uuid;
begin
  select * into v_claim from public.assignment_topic_claims where id = p_claim;
  if not found then raise exception 'Registration not found.'; end if;
  perform public.require_staff(v_claim.course_id);

  select * into v_assign from public.assignments where id = v_claim.assignment_id;
  if v_reason is null then
    v_reason := 'This product/firm duplicates an earlier registration. Please register a different product/firm.';
  end if;

  update public.assignment_topic_claims
     set status = 'rejected',
         rejection_reason = v_reason,
         updated_at = now()
   where id = p_claim;

  -- Collect recipient user IDs: claiming student + all activated teammates if syndicate
  v_notified_ids := array[v_claim.student_id];
  if v_claim.syndicate_id is not null and v_assign.instructions is not null and position('ASSIGN_META:' in v_assign.instructions) > 0 then
    v_match := regexp_match(v_assign.instructions, '<!--\s*ASSIGN_META:(\{.*?\})\s*-->\s*$');
    if v_match is not null and array_length(v_match, 1) >= 1 then
      begin
        v_meta := v_match[1]::jsonb;
        for v_grp in select value from jsonb_array_elements(coalesce(v_meta -> 'syndicate' -> 'groups', '[]'::jsonb)) loop
          if coalesce(v_grp ->> 'id', '') = v_claim.syndicate_id or coalesce(v_grp ->> 'name', '') = coalesce(v_claim.syndicate_name, '') then
            for v_uid in
              select p.id
                from public.profiles p
               where upper(btrim(p.index_no)) in (
                 select upper(btrim(m)) from jsonb_array_elements_text(coalesce(v_grp -> 'members', '[]'::jsonb)) m
               )
            loop
              if not (v_uid = any(v_notified_ids)) then
                v_notified_ids := array_append(v_notified_ids, v_uid);
              end if;
            end loop;
          end if;
        end loop;
      exception when others then
        null;
      end;
    end if;
  end if;

  insert into public.notifications (user_id, course_id, kind, title, body, link)
  select u,
         v_claim.course_id,
         'alert',
         format('Action required: change product for "%s"', coalesce(v_assign.title, 'Assignment')),
         format('Your registered choice (%s%s) was released: %s',
                v_claim.firm_name,
                case when btrim(v_claim.product_name) <> '' then ' — ' || v_claim.product_name else '' end,
                v_reason),
         format('/course/%s?tab=assignments', v_claim.course_id)
    from unnest(v_notified_ids) as u;
end;
$$;

-- 6. Staff RPC: delete a claim completely
create or replace function public.staff_delete_assignment_topic(p_claim uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_course uuid;
begin
  select course_id into v_course from public.assignment_topic_claims where id = p_claim;
  if v_course is null then return; end if;
  perform public.require_staff(v_course);
  delete from public.assignment_topic_claims where id = p_claim;
end;
$$;
