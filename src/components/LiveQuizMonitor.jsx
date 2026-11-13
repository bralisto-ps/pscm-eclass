import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc, rpcAll } from '../lib/supabase.js';
import { fmtDateTime, fmtNumber, relative } from '../lib/format.js';
import { compareDate, compareNumber, compareText } from '../lib/sort.js';
import { LIVE_EXAM_AND_PHOTOS_SQL } from '../lib/liveExamSql.js';
import Icon from './Icon.jsx';
import { ALL_GROUPS, GroupFilters, matchesGroup } from './Groups.jsx';
import { SortSelect, SortTh } from './SortBar.jsx';
import { Confirm, Empty, ErrorNote, Loading, Modal, useAction, useToast } from './ui.jsx';

function formatCountdown(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  const negative = ms < 0;
  const totalSec = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const body = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

export default function LiveQuizMonitor({ quiz, isTA, onMutate }) {
  const toast = useToast();
  const [act, busy] = useAction();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [group, setGroup] = useState(ALL_GROUPS);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('live_first');

  const [bulkModal, setBulkModal] = useState(false);
  const [bulkMins, setBulkMins] = useState('10');
  const [extendTarget, setExtendTarget] = useState(null);
  const [extendMins, setExtendMins] = useState('10');
  const [resumeTarget, setResumeTarget] = useState(null);
  const [resumeMins, setResumeMins] = useState('15');
  const [forceTarget, setForceTarget] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const list = await rpcAll('quiz_live_status', { p_quiz: quiz.id });
      setRows(list || []);
      setError(null);
      setLastUpdated(new Date());
      if (list?.[0]?.server_now) {
        setServerOffset(new Date(list[0].server_now).getTime() - Date.now());
      }
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [quiz.id]);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const t = setInterval(() => {
      load(true);
    }, 15000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const scopedRows = useMemo(() => rows.filter((r) => matchesGroup(r, group)), [rows, group]);

  const enriched = useMemo(() => {
    const serverNow = nowMs + serverOffset;
    return scopedRows.map((r) => {
      const deadlineMs = r.deadline_at ? new Date(r.deadline_at).getTime() : null;
      const msLeft = r.status === 'in_progress' && deadlineMs !== null ? deadlineMs - serverNow : null;
      const isExpired = r.status === 'in_progress' && msLeft !== null && msLeft <= 0;
      const isActive = r.status === 'in_progress' && !isExpired;
      const isDone = r.status === 'marked' || r.status === 'needs_marking';
      const flagged = (r.exits || 0) > 0 || (r.devices || 0) > 1;
      const pctDone = r.total_questions > 0 ? Math.round((r.answered_count / r.total_questions) * 100) : 0;
      return { ...r, msLeft, isExpired, isActive, isDone, flagged, pctDone };
    });
  }, [scopedRows, nowMs, serverOffset]);

  const counts = useMemo(() => {
    let active = 0;
    let expired = 0;
    let done = 0;
    let notStarted = 0;
    let flagged = 0;
    for (const r of enriched) {
      if (r.isActive) active++;
      else if (r.isExpired) expired++;
      else if (r.isDone) done++;
      else notStarted++;
      if (r.flagged) flagged++;
    }
    return { active, expired, inProgressTotal: active + expired, done, notStarted, flagged };
  }, [enriched]);

  const compareRows = useCallback((a, b) => {
    const rank = (r) => (r.isExpired ? 0 : r.isActive ? 1 : r.isDone ? 2 : r.status === 'not_started' ? 3 : 4);
    switch (sort) {
      case 'live_first':
        return rank(a) - rank(b)
          || compareDate(a.last_saved_at, b.last_saved_at, 'desc')
          || compareText(a.full_name, b.full_name, 'asc');
      case 'time_left_asc':
        return (a.status === 'in_progress' ? 0 : 1) - (b.status === 'in_progress' ? 0 : 1)
          || compareNumber(a.msLeft, b.msLeft, 'asc')
          || compareText(a.full_name, b.full_name, 'asc');
      case 'progress_desc':
        return compareNumber(a.pctDone, b.pctDone, 'desc')
          || compareNumber(a.answered_count, b.answered_count, 'desc')
          || compareText(a.full_name, b.full_name, 'asc');
      case 'saved_desc':
        return compareDate(a.last_saved_at, b.last_saved_at, 'desc') || compareText(a.full_name, b.full_name, 'asc');
      case 'name_asc':
        return compareText(a.full_name, b.full_name, 'asc') || compareText(a.index_no, b.index_no, 'asc');
      case 'index_asc':
        return compareText(a.index_no, b.index_no, 'asc');
      case 'exits_desc':
        return compareNumber(a.exits, b.exits, 'desc') || compareNumber(a.devices, b.devices, 'desc');
      default:
        return rank(a) - rank(b);
    }
  }, [sort]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = enriched.filter((r) => {
      if (filter === 'active' && !r.isActive) return false;
      if (filter === 'expired' && !r.isExpired) return false;
      if (filter === 'done' && !r.isDone) return false;
      if (filter === 'not_started' && (r.isActive || r.isExpired || r.isDone)) return false;
      if (filter === 'flagged' && !r.flagged) return false;
      if (term) {
        const hay = [r.full_name, r.index_no, r.programme, r.stream].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    return [...list].sort(compareRows);
  }, [enriched, filter, q, compareRows]);

  async function quickExtend(r, minutes) {
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins < 1 || mins > 240) {
      toast('Enter between 1 and 240 minutes.', 'error');
      return;
    }
    const ok = await act(
      () => rpc('extend_attempt_time', { p_attempt: r.attempt_id, p_minutes: mins }),
      `Granted +${mins} min to ${r.full_name}.`,
    );
    if (ok !== undefined) {
      setExtendTarget(null);
      load(true);
    }
  }

  async function handleBulkExtend() {
    const mins = Number(bulkMins);
    if (!Number.isFinite(mins) || mins < 1 || mins > 240) {
      toast('Enter between 1 and 240 minutes.', 'error');
      return;
    }
    const prog = group.programme !== '*' ? group.programme : null;
    const stream = group.stream !== '*' ? group.stream : null;
    const count = await act(
      () => rpc('extend_quiz_time', { p_quiz: quiz.id, p_minutes: mins, p_programme: prog, p_stream: stream }),
      null,
    );
    if (count !== undefined) {
      setBulkModal(false);
      toast(
        count > 0
          ? `Granted +${mins} min to ${count} active student${count === 1 ? '' : 's'}.`
          : 'No matching in-progress attempts to extend.',
        count > 0 ? 'ok' : 'error',
      );
      load(true);
    }
  }

  async function handleResume() {
    if (!resumeTarget) return;
    const mins = Number(resumeMins);
    if (!Number.isFinite(mins) || mins < 1 || mins > 240) {
      toast('Enter between 1 and 240 minutes.', 'error');
      return;
    }
    const ok = await act(
      () => rpc('reopen_attempt', { p_attempt: resumeTarget.attempt_id, p_minutes: mins }),
      `Unlocked ${resumeTarget.full_name}'s quiz (+${mins} min). Their saved answers are intact.`,
    );
    if (ok !== undefined) {
      setResumeTarget(null);
      await load(true);
      onMutate?.();
    }
  }

  async function handleForceSubmit() {
    if (!forceTarget) return;
    const ok = await act(
      () => rpc('force_submit_attempt', { p_attempt: forceTarget.attempt_id }),
      `Submitted ${forceTarget.full_name}'s attempt.`,
    );
    if (ok !== undefined) {
      setForceTarget(null);
      await load(true);
      onMutate?.();
    }
  }

  function copySql() {
    navigator.clipboard?.writeText(LIVE_EXAM_AND_PHOTOS_SQL);
    toast('Copied SQL setup script — paste and run it in Supabase SQL Editor.');
  }

  if (loading) return <Loading label="Opening live exam monitor…" />;

  if (error) {
    const missingRpc = /quiz_live_status|Could not find the function|does not exist|schema cache/i.test(error.message || '');
    if (missingRpc) {
      return (
        <section className="card stack">
          <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div className="row" style={{ gap: 10 }}>
              <Icon name="clock" size={20} />
              <div className="stack-sm" style={{ gap: 2 }}>
                <h2 style={{ margin: 0 }}>One-Time Database Setup Required</h2>
                <span className="small muted">Run the Live Monitor &amp; Proctor Storage SQL once in your Supabase SQL Editor.</span>
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-primary" onClick={copySql}>Copy SQL script</button>
              <button type="button" className="btn" onClick={() => load(false)}>Retry</button>
            </div>
          </div>
          <pre className="mono small" style={{ maxHeight: 260, overflow: 'auto', padding: 14, background: 'var(--surface-2)', borderRadius: 8, margin: 0 }}>
            {LIVE_EXAM_AND_PHOTOS_SQL}
          </pre>
        </section>
      );
    }
    return <ErrorNote error={error} onRetry={() => load(false)} />;
  }

  const groupScopeLabel = [
    group.programme !== '*' ? group.programme : '',
    group.stream !== '*' ? group.stream : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="stack-lg">
      <GroupFilters rows={rows} value={group} onChange={setGroup} />

      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <div className="kpi">
          <span className="l">Active now</span>
          <span className="v" style={{ color: counts.active > 0 ? 'var(--teal-dark)' : undefined }}>{counts.active}</span>
          <span className="tiny muted">currently writing</span>
        </div>
        <div className="kpi">
          <span className="l">Time expired (open)</span>
          <span className="v" style={{ color: counts.expired > 0 ? 'var(--amber-ink)' : undefined }}>{counts.expired}</span>
          <span className="tiny muted">awaiting extend or submit</span>
        </div>
        <div className="kpi">
          <span className="l">Submitted</span>
          <span className="v">{counts.done}</span>
          <span className="tiny muted">of {scopedRows.length} eligible</span>
        </div>
        <div className="kpi">
          <span className="l">Flagged</span>
          <span className="v" style={{ color: counts.flagged > 0 ? 'var(--red-ink)' : undefined }}>{counts.flagged}</span>
          <span className="tiny muted">exits or 2+ devices</span>
        </div>
      </div>

      <section className="card-flush">
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="row-wrap" style={{ flex: 1, minWidth: 260 }}>
            <label className="search">
              <span className="sr-only">Search students</span>
              <Icon name="search" size={16} />
              <input
                className="input"
                style={{ width: 220, minHeight: 40 }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name, index, programme, stream"
              />
            </label>
            <div className="chips" role="group" aria-label="Live status filter">
              {[
                ['all', `All · ${enriched.length}`],
                ['active', `Active · ${counts.active}`],
                ['expired', `Expired · ${counts.expired}`],
                ['done', `Submitted · ${counts.done}`],
                ['not_started', `Not started · ${counts.notStarted}`],
                ['flagged', `Flagged · ${counts.flagged}`],
              ].map(([id, label]) => (
                <button key={id} type="button" className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
            <SortSelect
              value={sort}
              onChange={setSort}
              options={[
                { value: 'live_first', label: 'Active & expired first' },
                { value: 'time_left_asc', label: 'Time left (Lowest first)' },
                { value: 'progress_desc', label: 'Progress (Highest first)' },
                { value: 'saved_desc', label: 'Last saved (Newest first)' },
                { value: 'name_asc', label: 'Name (A → Z)' },
                { value: 'index_asc', label: 'Index no.' },
                { value: 'exits_desc', label: 'Flags (Most exits)' },
              ]}
            />
          </div>

          <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
            <label className="check small" style={{ marginRight: 4 }}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto-refresh (15s)
            </label>
            <button type="button" className="btn btn-sm" onClick={() => load(true)} disabled={refreshing}>
              <Icon name="refresh" size={14} /> {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            {!isTA && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => setBulkModal(true)}
                disabled={busy || counts.inProgressTotal === 0}
                title="Add extra minutes to all currently open attempts"
              >
                <Icon name="clock" size={14} /> + Extra time ({counts.inProgressTotal})
              </button>
            )}
          </div>
        </div>

        <div className="filter-meta">
          <span className="tiny muted">
            Showing <strong>{shown.length}</strong> of {enriched.length} student{enriched.length === 1 ? '' : 's'}
            {lastUpdated ? ` · Last synced ${relative(lastUpdated.toISOString())}` : ''}
          </span>
          {!isTA && (
            <span className="tiny muted">
              Extra time updates the student's live countdown automatically without closing their quiz.
            </span>
          )}
        </div>

        {shown.length === 0 ? (
          <Empty icon="clock" title="No matching students">Adjust the filter or wait for students to open the quiz.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortTh label="Index no." ascKey="index_asc" descKey="index_asc" current={sort} onSort={setSort} />
                  <SortTh label="Student" ascKey="name_asc" descKey="name_asc" current={sort} onSort={setSort} />
                  <th>Status</th>
                  <SortTh label="Progress" ascKey="progress_desc" descKey="progress_desc" defaultDir="desc" current={sort} onSort={setSort} />
                  <SortTh label="Last saved" ascKey="saved_desc" descKey="saved_desc" defaultDir="desc" current={sort} onSort={setSort} className="hide-sm" />
                  <SortTh label="Time left" ascKey="time_left_asc" descKey="time_left_asc" current={sort} onSort={setSort} />
                  <SortTh label="Flags" ascKey="exits_desc" descKey="exits_desc" defaultDir="desc" current={sort} onSort={setSort} />
                  {!isTA && <th style={{ textAlign: 'right' }}>Control</th>}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 400).map((r) => {
                  const statusBadge = r.isExpired
                    ? ['Time expired (open)', 'badge-amber']
                    : r.isActive
                      ? ['Writing now', 'badge-blue']
                      : r.isDone
                        ? ['Submitted', 'badge-teal']
                        : r.status === 'not_started'
                          ? ['Not started', '']
                          : ['No account', ''];

                  return (
                    <tr key={r.index_no}>
                      <td className="mono small">{r.index_no}</td>
                      <td>
                        <div className="stack-sm" style={{ gap: 1 }}>
                          <span className="strong">{r.full_name}</span>
                          <span className="tiny muted">{[r.programme, r.stream].filter(Boolean).join(' · ') || '—'}</span>
                        </div>
                      </td>
                      <td><span className={`badge ${statusBadge[1]}`}>{statusBadge[0]}</span></td>
                      <td style={{ minWidth: 120 }}>
                        {r.attempt_id ? (
                          <div className="stack-sm" style={{ gap: 4 }}>
                            <span className="mono small">{r.answered_count} / {r.total_questions}</span>
                            <div className="bar-track" style={{ height: 6 }}>
                              <div className="bar-fill" style={{ height: 6, width: `${r.pctDone}%`, background: r.isDone ? 'var(--teal)' : 'var(--blue, #2563eb)' }} />
                            </div>
                          </div>
                        ) : <span className="muted small">—</span>}
                      </td>
                      <td className="small muted hide-sm">
                        {r.last_saved_at ? relative(r.last_saved_at) : (r.started_at ? `Started ${relative(r.started_at)}` : '—')}
                      </td>
                      <td className="mono small">
                        {r.status === 'in_progress' ? (
                          <span style={{ color: r.isExpired ? 'var(--red-ink)' : r.msLeft < 180000 ? 'var(--amber-ink)' : 'var(--teal-dark)', fontWeight: 700 }}>
                            {formatCountdown(r.msLeft)}
                          </span>
                        ) : r.submitted_at ? (
                          <span className="muted tiny" title={fmtDateTime(r.submitted_at)}>
                            Done {relative(r.submitted_at)}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {r.exits > 0 && <span className="badge badge-red">{r.exits}× exit</span>}
                          {r.devices > 1 && <span className="badge badge-amber">{r.devices} dev</span>}
                          {!r.flagged && <span className="muted small">—</span>}
                        </div>
                      </td>
                      {!isTA && (
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {r.status === 'in_progress' && (
                            <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => quickExtend(r, 5)} title="Add 5 minutes">
                                +5m
                              </button>
                              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => quickExtend(r, 10)} title="Add 10 minutes">
                                +10m
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                disabled={busy}
                                onClick={() => { setExtendTarget(r); setExtendMins('15'); }}
                                title="Grant custom extra minutes"
                              >
                                Custom
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                style={{ color: 'var(--red-ink)' }}
                                disabled={busy}
                                onClick={() => setForceTarget(r)}
                                title="Finalize and submit this attempt now"
                              >
                                Submit
                              </button>
                            </div>
                          )}
                          {r.isDone && (
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              disabled={busy}
                              onClick={() => { setResumeTarget(r); setResumeMins('15'); }}
                              title="Unlock attempt so the student can continue without losing saved answers"
                            >
                              <Icon name="play" size={13} /> Resume
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {bulkModal && (
        <Modal
          title="Grant Extra Time to All Active Students"
          onClose={() => setBulkModal(false)}
          footer={(
            <>
              <button type="button" className="btn" onClick={() => setBulkModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleBulkExtend} disabled={busy}>
                {busy ? 'Applying…' : `Add +${bulkMins || 0} min`}
              </button>
            </>
          )}
        >
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>
              Extends the deadline for all <strong>{counts.inProgressTotal}</strong> currently open attempt{counts.inProgressTotal === 1 ? '' : 's'}
              {groupScopeLabel ? ` in ${groupScopeLabel}` : ''}. Students keep working uninterrupted and their timer updates within ~25 seconds.
            </p>
            <div className="row-wrap" style={{ gap: 8 }}>
              {[5, 10, 15, 20, 30].map((m) => (
                <button
                  key={m}
                  type="button"
                  className="chip" aria-pressed={Number(bulkMins) === m}
                  onClick={() => setBulkMins(String(m))}
                >
                  +{m} min
                </button>
              ))}
            </div>
            <label className="field">
              <span>Minutes to add</span>
              <input
                type="number"
                min={1}
                max={240}
                className="input"
                value={bulkMins}
                onChange={(e) => setBulkMins(e.target.value)}
              />
            </label>
          </div>
        </Modal>
      )}

      {extendTarget && (
        <Modal
          title={`Extra Time · ${extendTarget.full_name}`}
          onClose={() => setExtendTarget(null)}
          footer={(
            <>
              <button type="button" className="btn" onClick={() => setExtendTarget(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => quickExtend(extendTarget, extendMins)} disabled={busy}>
                {busy ? 'Updating…' : `Grant +${extendMins || 0} min`}
              </button>
            </>
          )}
        >
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>
              Index <strong className="mono">{extendTarget.index_no}</strong>. If their timer already reached 0:00, extra minutes count from right now.
            </p>
            <div className="row-wrap" style={{ gap: 8 }}>
              {[5, 10, 15, 30, 45].map((m) => (
                <button
                  key={m}
                  type="button"
                  className="chip" aria-pressed={Number(extendMins) === m}
                  onClick={() => setExtendMins(String(m))}
                >
                  +{m} min
                </button>
              ))}
            </div>
            <label className="field">
              <span>Minutes to add (1–240)</span>
              <input
                type="number"
                min={1}
                max={240}
                className="input"
                value={extendMins}
                onChange={(e) => setExtendMins(e.target.value)}
              />
            </label>
          </div>
        </Modal>
      )}

      {resumeTarget && (
        <Modal
          title={`Unlock & Resume · ${resumeTarget.full_name}`}
          onClose={() => setResumeTarget(null)}
          footer={(
            <>
              <button type="button" className="btn" onClick={() => setResumeTarget(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleResume} disabled={busy}>
                {busy ? 'Unlocking…' : `Unlock with +${resumeMins || 15} min`}
              </button>
            </>
          )}
        >
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>
              Reopens <strong className="mono">{resumeTarget.index_no}</strong>'s attempt so they can continue where they stopped.
              All saved answers ({resumeTarget.answered_count} / {resumeTarget.total_questions}) remain untouched, and their score is recalculated when they submit again.
            </p>
            <div className="row-wrap" style={{ gap: 8 }}>
              {[10, 15, 20, 30, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  className="chip" aria-pressed={Number(resumeMins) === m}
                  onClick={() => setResumeMins(String(m))}
                >
                  +{m} min
                </button>
              ))}
            </div>
            <label className="field">
              <span>Minutes given from now</span>
              <input
                type="number"
                min={1}
                max={240}
                className="input"
                value={resumeMins}
                onChange={(e) => setResumeMins(e.target.value)}
              />
            </label>
          </div>
        </Modal>
      )}

      {forceTarget && (
        <Confirm
          title="Force-submit this attempt?"
          danger
          confirmLabel="Force submit now"
          busy={busy}
          message={`Finalizes and grades all answers currently saved for ${forceTarget.full_name} (${forceTarget.index_no}). You can still unlock it afterwards via Resume if needed.`}
          onClose={() => setForceTarget(null)}
          onConfirm={handleForceSubmit}
        />
      )}
    </div>
  );
}
