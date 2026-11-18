import { useMemo, useState } from 'react';
import { rpcAll } from '../lib/supabase.js';
import { fmtDateTime, relative } from '../lib/format.js';
import Icon from './Icon.jsx';
import { Empty, Loading, useLoad, useToast } from './ui.jsx';

const ACTION_LABELS = {
  roster_import: 'Class list',
  roster_remove: 'Removed student',
  password_reset: 'Password reset',
  mark_quiz_response: 'Marked quiz',
  mark_assignment: 'Marked assignment',
  mark_syndicate_assignment: 'Marked syndicate',
  attendance_start: 'Attendance opened',
  attendance_manual: 'Attendance edit',
  attendance_manual_rollcall: 'Manual roll-call',
  forum_answer: 'Q&A reply',
  announcement: 'Announcement',
  quiz_extend_time: 'Extended quiz time',
  quiz_reopen_attempt: 'Resumed attempt',
  quiz_force_submit: 'Force-submitted quiz',
  quiz_regrade: 'Regraded quiz',
  quiz_accept_short: 'Accepted short answer',
  quiz_import_bank: 'Imported from bank',
  excuse_approved: 'Approved excuse',
  excuse_rejected: 'Declined excuse',
  mark_review_approved: 'Approved mark review',
  mark_review_declined: 'Declined mark review',
  assignment_exemplar_added: 'Added exemplar',
  booking_event_created: 'Created slot schedule',
  exam_seating_saved: 'Saved exam seating',
  pdf_annotations_saved: 'PDF annotations',
  attempt_moderated: 'Moderated quiz',
  clo_outcome_saved: 'Saved CLO',
};

const AUDIT_SQL_SNIPPET = `create table if not exists public.course_audit_logs (
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
create policy lecturer_all on public.course_audit_logs for all to authenticated using (public.is_lecturer()) with check (public.is_lecturer());

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
exception when others then null;
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

revoke execute on function public.log_course_action(uuid, text, text, jsonb) from public, anon;
grant execute on function public.log_course_action(uuid, text, text, jsonb) to authenticated;
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
    if cardinality(v_indexes) < 5 then v_indexes := array_append(v_indexes, v_idx); end if;
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
               array_to_string(v_indexes, ', '), n_new, n_enrolled)
      else
        format('Added/updated class list (%s rows: %s new, %s enrolled)',
               jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), n_new, n_enrolled)
    end;
    perform public.log_course_audit(
      p_course, 'roster_import', v_summary,
      jsonb_build_object('new_students', n_new, 'enrolled', n_enrolled, 'rows', jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 'indexes', to_jsonb(v_indexes))
    );
  end if;
  return jsonb_build_object('new_students', n_new, 'enrolled', n_enrolled, 'skipped', n_skipped);
end;
$$;

revoke execute on function public.log_course_action(uuid, text, text, jsonb) from public, anon;
grant execute on function public.log_course_action(uuid, text, text, jsonb) to authenticated;
revoke execute on function public.course_audit_log_list(uuid, int) from public, anon;
grant execute on function public.course_audit_log_list(uuid, int) to authenticated;`;

export default function AuditLogPanel({ course }) {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(
    () => rpcAll('course_audit_log_list', { p_course: course.id, p_limit: 150 }),
    [course.id]
  );
  const [roleFilter, setRoleFilter] = useState('all');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data || []).filter((r) => {
      if (roleFilter !== 'all' && r.actor_role !== roleFilter) return false;
      if (term) {
        const hay = [r.actor_name, r.action, r.summary].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [data, roleFilter, q]);

  const missingRpc = Boolean(error && /course_audit_log_list|does not exist|schema cache/i.test(error));

  return (
    <section className="card stack" aria-label="Staff and TA Activity Audit Log">
      <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 style={{ margin: 0 }}>Staff &amp; TA Activity Audit Log</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Tamper-proof history of student imports, password resets, quiz &amp; assignment marking, attendance edits, announcements, and Q&amp;A replies.
          </p>
        </div>
        <button type="button" className="btn btn-sm" onClick={reload} disabled={loading}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>

      {loading && <Loading label="Loading activity log…" />}

      {missingRpc && (
        <div className="notice notice-warn stack-sm">
          <strong>Database setup needed for Audit Log</strong>
          <span className="small">
            Run the updated <span className="mono">supabase/schema.sql</span> (or copy the audit log SQL below) in your Supabase SQL Editor to enable activity logging.
          </span>
          <div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                navigator.clipboard?.writeText(AUDIT_SQL_SNIPPET);
                toast('Audit log SQL copied to clipboard.');
              }}
            >
              Copy Audit Log SQL
            </button>
          </div>
        </div>
      )}

      {error && !missingRpc && <div className="notice notice-error">{error}</div>}

      {data && (
        <>
          <div className="row-wrap" style={{ gap: 10 }}>
            <label className="search">
              <span className="sr-only">Filter activity log</span>
              <Icon name="search" size={16} />
              <input
                className="input"
                style={{ width: 240, minHeight: 38 }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search actor or action"
              />
            </label>
            <div className="chips" role="group" aria-label="Filter by role">
              {[
                ['all', `All (${data.length})`],
                ['ta', `TAs (${data.filter((x) => x.actor_role === 'ta').length})`],
                ['lecturer', `Lecturer (${data.filter((x) => x.actor_role === 'lecturer').length})`],
              ].map(([id, label]) => (
                <button key={id} type="button" className="chip" aria-pressed={roleFilter === id} onClick={() => setRoleFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <Empty icon="clock" title="No recorded actions yet">
              Actions taken by you or your TAs will appear here automatically.
            </Empty>
          ) : (
            <div className="card-flush table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Staff Member</th>
                    <th>Action</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }} title={fmtDateTime(r.created_at)}>
                        {relative(r.created_at)}
                      </td>
                      <td className="small">
                        <div className="row" style={{ gap: 6 }}>
                          <strong>{r.actor_name || 'Staff'}</strong>
                          <span className={`badge ${r.actor_role === 'ta' ? 'badge-amber' : 'badge-teal'}`} style={{ fontSize: 11 }}>
                            {r.actor_role === 'ta' ? 'TA' : r.actor_role === 'lecturer' ? 'Lecturer' : 'Staff'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="badge">{ACTION_LABELS[r.action] || r.action}</span>
                      </td>
                      <td className="small">{r.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
