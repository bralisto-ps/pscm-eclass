-- =============================================================================
-- PSCM E-class — Syndicate Group Privacy & Member Names for Students
-- 100% idempotent — safe to run in Supabase SQL Editor.
--
-- What this does:
--   1. Strips all other syndicate groups from assignment metadata on the server
--      before returning assignments to students (students only receive their
--      own group, never other groups).
--   2. Resolves teammate full names (from profiles, falling back to roster) for
--      ONLY the student's own syndicate group.
-- =============================================================================

create or replace function public.filter_assignment_instructions_for_student(
  p_instructions text,
  p_student_index text
) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_match text[];
  v_meta jsonb;
  v_syn jsonb;
  v_groups jsonb;
  v_idx text := upper(btrim(coalesce(p_student_index, '')));
  v_my_groups jsonb := '[]'::jsonb;
  v_grp jsonb;
  v_names jsonb;
  v_clean text;
begin
  if p_instructions is null or position('ASSIGN_META:' in p_instructions) = 0 then
    return p_instructions;
  end if;

  v_match := regexp_match(p_instructions, '<!--\s*ASSIGN_META:(\{.*?\})\s*-->\s*$');
  if v_match is null or array_length(v_match, 1) < 1 then
    return p_instructions;
  end if;

  begin
    v_meta := v_match[1]::jsonb;
  exception when others then
    return p_instructions;
  end;

  v_syn := v_meta -> 'syndicate';
  if v_syn is null or jsonb_typeof(v_syn) <> 'object' then
    return p_instructions;
  end if;

  v_groups := v_syn -> 'groups';
  if v_groups is null or jsonb_typeof(v_groups) <> 'array' then
    return p_instructions;
  end if;

  if v_idx <> '' then
    for v_grp in select value from jsonb_array_elements(v_groups) loop
      if jsonb_typeof(v_grp -> 'members') = 'array' and exists (
        select 1
          from jsonb_array_elements_text(v_grp -> 'members') m
         where upper(btrim(m)) = v_idx
      ) then
        select coalesce(jsonb_object_agg(mem.idx_norm, mem.display_name), '{}'::jsonb)
          into v_names
          from (
            select distinct upper(btrim(m.raw_idx)) as idx_norm,
                   coalesce(
                     (select nullif(btrim(p.full_name), '')
                        from public.profiles p
                       where upper(btrim(p.index_no)) = upper(btrim(m.raw_idx))
                       limit 1),
                     (select nullif(btrim(r.full_name), '')
                        from public.roster r
                       where upper(btrim(r.index_no)) = upper(btrim(m.raw_idx))
                       limit 1)
                   ) as display_name
              from jsonb_array_elements_text(v_grp -> 'members') as m(raw_idx)
          ) mem
         where mem.display_name is not null
           and upper(btrim(mem.display_name)) <> mem.idx_norm;

        v_my_groups := v_my_groups || jsonb_build_array(
          v_grp || jsonb_build_object('member_names', coalesce(v_names, '{}'::jsonb))
        );
      end if;
    end loop;
  end if;

  v_meta := jsonb_set(v_meta, '{syndicate,groups}', v_my_groups, true);
  v_clean := btrim(regexp_replace(p_instructions, '\s*<!--\s*ASSIGN_META:\{.*?\}\s*-->\s*$', ''));

  if v_clean = '' then
    return '<!-- ASSIGN_META:' || v_meta::text || ' -->';
  end if;
  return v_clean || E'\n\n<!-- ASSIGN_META:' || v_meta::text || ' -->';
end;
$$;

revoke execute on function public.filter_assignment_instructions_for_student(text, text)
  from public, anon, authenticated;

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
           'id', x.id, 'title', x.title,
           'instructions', public.filter_assignment_instructions_for_student(x.instructions, v_idx),
           'due_at', x.due_at,
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
