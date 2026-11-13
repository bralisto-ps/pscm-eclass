import { useMemo, useState } from 'react';
import { rpcAll } from '../lib/supabase.js';
import { fmtDateTime, relative } from '../lib/format.js';
import Icon from './Icon.jsx';
import { Empty, Loading, useLoad, useToast } from './ui.jsx';

const ACTION_LABELS = {
  roster_import: 'Class list',
  password_reset: 'Password reset',
  mark_quiz_response: 'Marked quiz',
  mark_assignment: 'Marked assignment',
  attendance_start: 'Attendance opened',
  attendance_manual: 'Attendance edit',
  forum_answer: 'Q&A reply',
  announcement: 'Announcement',
  quiz_extend_time: 'Extended quiz time',
  quiz_reopen_attempt: 'Resumed attempt',
  quiz_force_submit: 'Force-submitted quiz',
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
declare v_name text; v_role text;
begin
  if p_course is null then return; end if;
  select full_name, role into v_name, v_role from public.profiles where id = auth.uid();
  insert into public.course_audit_logs (course_id, actor_id, actor_name, actor_role, action, summary, details)
  values (p_course, auth.uid(), coalesce(nullif(trim(v_name), ''), 'Staff'), coalesce(v_role, 'staff'), p_action, p_summary, coalesce(p_details, '{}'::jsonb));
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
                            {r.actor_role === 'ta' ? 'TA' : 'Lecturer'}
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
