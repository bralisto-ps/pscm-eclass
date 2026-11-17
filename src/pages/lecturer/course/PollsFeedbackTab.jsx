import { useEffect, useMemo, useState } from 'react';
import { rpc, run, supabase } from '../../../lib/supabase.js';
import { fmtNumber, relative } from '../../../lib/format.js';
import { ALL_NEW_FEATURES_SQL } from '../../../lib/allFeaturesSql.js';
import Icon from '../../../components/Icon.jsx';
import { Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../../components/ui.jsx';

const POLL_PRESETS = [
  {
    id: 'confidence',
    label: 'Concept check (1–5)',
    kind: 'mcq',
    question: 'How confident are you with today’s topic?',
    options: ['5 — Very confident', '4 — Mostly clear', '3 — Somewhat unsure', '2 — Need another example', '1 — Lost / review needed'],
  },
  {
    id: 'pace',
    label: 'Lecture pace',
    kind: 'mcq',
    question: 'How is today’s lecture pace?',
    options: ['Just right', 'Too fast — slow down', 'Too slow — pick up pace'],
  },
  {
    id: 'tf',
    label: 'Quick True / False',
    kind: 'mcq',
    question: 'Quick concept check: True or False?',
    options: ['True', 'False', 'Not sure yet'],
  },
  {
    id: 'exit',
    label: '1-Min Exit Ticket',
    kind: 'exit_ticket',
    question: 'What was the muddiest (least clear) point from today’s lecture?',
    options: [],
  },
];

function isMissingRpcError(err) {
  return /lecturer_course_polls|course_feedback_summary|course_polls|course_feedback|Could not find|does not exist|schema cache/i.test(err?.message || '');
}

export default function PollsFeedbackTab({ course, ta }) {
  const toast = useToast();
  const [subTab, setSubTab] = useState('polls');
  const [showSql, setShowSql] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  function copySql() {
    navigator.clipboard?.writeText?.(ALL_NEW_FEATURES_SQL);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 3000);
  }

  return (
    <div className="stack" style={{ maxWidth: 1020 }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="chips" role="tablist">
          <button
            type="button"
            className="chip"
            aria-pressed={subTab === 'polls'}
            onClick={() => setSubTab('polls')}
          >
            <Icon name="activity" size={14} /> Live Polls &amp; Exit Tickets
          </button>
          {!ta && (
            <button
              type="button"
              className="chip"
              aria-pressed={subTab === 'survey'}
              onClick={() => setSubTab('survey')}
            >
              <Icon name="shield" size={14} /> Anonymous TQM Course Survey
            </button>
          )}
        </div>
        {!ta && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowSql(true)}>
            Setup SQL
          </button>
        )}
      </div>

      {subTab === 'polls' && <LivePollsSection course={course} onMissingSql={() => setShowSql(true)} />}
      {subTab === 'survey' && !ta && <AnonymousSurveySection course={course} onMissingSql={() => setShowSql(true)} />}

      {showSql && (
        <Modal title="Enable Polls & Anonymous TQM Feedback in Supabase" onClose={() => setShowSql(false)} wide>
          <p className="small muted">
            Run this one-time idempotent SQL script in your <strong>Supabase Dashboard → SQL Editor</strong> to activate Live Polls, Exit Tickets, Per-Class Deadlines, and Anonymous Course Feedback.
          </p>
          <pre className="mono small" style={{ maxHeight: 260, overflowY: 'auto', padding: 12, background: 'var(--surface-2)', borderRadius: 8, fontSize: 11 }}>
            {ALL_NEW_FEATURES_SQL}
          </pre>
          <div className="between" style={{ alignItems: 'center', marginTop: 12 }}>
            <span className="tiny muted">100% idempotent — safe to run once on your live project.</span>
            <button type="button" className="btn btn-primary" onClick={() => { copySql(); toast('SQL copied to clipboard.'); }}>
              {copiedSql ? 'Copied SQL' : 'Copy SQL to Clipboard'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function LivePollsSection({ course, onMissingSql }) {
  const toast = useToast();
  const [act, busy] = useAction();
  const [creating, setCreating] = useState(false);
  const [projectingId, setProjectingId] = useState(null);

  const { data: polls, error, loading, reload } = useLoad(async () => {
    const rows = await rpc('lecturer_course_polls', { p_course: course.id });
    return Array.isArray(rows) ? rows : [];
  }, [course.id]);

  // Auto-poll every 3s while an open poll exists or projector modal is active
  const hasOpen = useMemo(() => (polls || []).some((p) => p.is_open), [polls]);
  useEffect(() => {
    if (!hasOpen && !projectingId) return undefined;
    const t = setInterval(() => {
      rpc('lecturer_course_polls', { p_course: course.id })
        .then((rows) => {
          if (Array.isArray(rows)) reload();
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [hasOpen, projectingId, course.id]);

  if (loading) return <Loading />;
  if (error) {
    if (isMissingRpcError(error)) {
      return (
        <div className="card stack">
          <h3>Database update needed for Live Polls</h3>
          <p className="small muted">Run the latest Section 15 SQL script in Supabase SQL Editor to enable live in-class polls and 1-minute exit tickets.</p>
          <div><button type="button" className="btn btn-primary" onClick={onMissingSql}>View &amp; Copy Setup SQL</button></div>
        </div>
      );
    }
    return <ErrorNote error={error} onRetry={reload} />;
  }

  const list = polls || [];
  const projectingPoll = list.find((p) => p.id === projectingId) || null;

  async function toggleOpen(poll) {
    const ok = await act(
      () => run(supabase.from('course_polls').update({
        is_open: !poll.is_open,
        closed_at: poll.is_open ? new Date().toISOString() : null,
      }).eq('id', poll.id)),
      poll.is_open ? 'Poll closed.' : 'Poll reopened for live responses.',
    );
    if (ok !== undefined) reload();
  }

  async function toggleVisibility(poll) {
    const ok = await act(
      () => run(supabase.from('course_polls').update({ show_results_to_students: !poll.show_results_to_students }).eq('id', poll.id)),
      poll.show_results_to_students ? 'Results hidden from students.' : 'Aggregated results now visible to students.',
    );
    if (ok !== undefined) reload();
  }

  async function removePoll(poll) {
    const ok = await act(() => run(supabase.from('course_polls').delete().eq('id', poll.id)), 'Poll deleted.');
    if (ok !== undefined) {
      if (projectingId === poll.id) setProjectingId(null);
      reload();
    }
  }

  return (
    <div className="stack">
      <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <p className="small muted" style={{ maxWidth: 640 }}>
          Launch instant multiple-choice concept checks or anonymous 1-minute exit tickets (&ldquo;muddiest point&rdquo;) during lectures. Open polls appear at the top of students&rsquo; course page immediately.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /> New poll / exit ticket
        </button>
      </div>

      {list.length === 0 ? (
        <div className="card">
          <Empty icon="activity" title="No live polls yet">
            Click <strong>New poll / exit ticket</strong> to run an instant pulse check or muddiest-point ticket in class.
          </Empty>
        </div>
      ) : (
        <div className="stack">
          {list.map((poll) => {
            const total = Number(poll.total_votes) || 0;
            const opts = Array.isArray(poll.options) ? poll.options : [];
            const counts = Array.isArray(poll.option_counts) ? poll.option_counts : [];
            const responses = Array.isArray(poll.responses) ? poll.responses : [];
            return (
              <article key={poll.id} className="card stack-sm" style={poll.is_open ? { borderColor: 'var(--teal)' } : undefined}>
                <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
                    <span className={`badge ${poll.is_open ? 'badge-teal' : ''}`}>
                      {poll.is_open ? 'LIVE · Open' : 'Closed'}
                    </span>
                    <span className="badge badge-blue">
                      {poll.kind === 'exit_ticket' ? '1-Min Exit Ticket' : 'MCQ Poll'}
                    </span>
                    <span className="tiny muted">{total} response{total === 1 ? '' : 's'} · {relative(poll.created_at)}</span>
                  </div>
                  <div className="row-wrap" style={{ gap: 6 }}>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setProjectingId(poll.id)}>
                      <Icon name="play" size={14} /> Projector view
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => toggleOpen(poll)} disabled={busy}>
                      {poll.is_open ? 'Close poll' : 'Reopen'}
                    </button>
                    {poll.kind === 'mcq' && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => toggleVisibility(poll)} disabled={busy}>
                        {poll.show_results_to_students ? 'Hide results from students' : 'Show results to students'}
                      </button>
                    )}
                    <button type="button" className="icon-btn plain" aria-label="Delete poll" onClick={() => removePoll(poll)} disabled={busy}>
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>

                <h3 style={{ margin: '4px 0 0', fontSize: 16 }}>{poll.question}</h3>

                {poll.kind === 'mcq' ? (
                  <div className="stack-sm" style={{ marginTop: 4 }}>
                    {opts.map((opt, idx) => {
                      const c = Number(counts[idx]) || 0;
                      const p = total > 0 ? Math.round((c / total) * 100) : 0;
                      return (
                        <div key={idx} className="stack-sm" style={{ gap: 3 }}>
                          <div className="between small">
                            <span>{opt}</span>
                            <span className="mono">{c} ({p}%)</span>
                          </div>
                          <div style={{ height: 8, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}>
                            <div style={{ width: `${p}%`, height: '100%', background: 'var(--teal)', transition: 'width 0.3s ease' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="stack-sm" style={{ marginTop: 4 }}>
                    {responses.length === 0 ? (
                      <span className="tiny muted">Waiting for student exit-ticket notes…</span>
                    ) : (
                      <div className="stack-sm" style={{ maxHeight: 200, overflowY: 'auto' }}>
                        {responses.slice(0, 30).map((r, ri) => (
                          <div key={ri} className="small" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line-2)' }}>
                            {r.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {creating && (
        <NewPollModal
          courseId={course.id}
          onClose={() => setCreating(false)}
          onCreated={(newPollId) => {
            setCreating(false);
            reload();
            if (newPollId) setProjectingId(newPollId);
          }}
        />
      )}

      {projectingPoll && (
        <ProjectorPollModal
          poll={projectingPoll}
          onToggleOpen={() => toggleOpen(projectingPoll)}
          onRefresh={reload}
          onClose={() => setProjectingId(null)}
        />
      )}
    </div>
  );
}

function NewPollModal({ courseId, onClose, onCreated }) {
  const toast = useToast();
  const [kind, setKind] = useState('mcq');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['Option A', 'Option B', 'Option C', 'Option D']);
  const [showResults, setShowResults] = useState(true);
  const [saving, setSaving] = useState(false);

  function applyPreset(p) {
    setKind(p.kind);
    setQuestion(p.question);
    setOptions(p.options.length ? [...p.options] : ['Yes', 'No']);
  }

  async function launch() {
    if (!question.trim()) {
      toast('Enter a question or prompt first.', 'error');
      return;
    }
    const cleanOpts = kind === 'mcq' ? options.map((o) => o.trim()).filter(Boolean) : [];
    if (kind === 'mcq' && cleanOpts.length < 2) {
      toast('Add at least 2 answer choices for an MCQ poll.', 'error');
      return;
    }
    setSaving(true);
    try {
      const inserted = await run(
        supabase.from('course_polls').insert({
          course_id: courseId,
          kind,
          question: question.trim(),
          options: cleanOpts,
          is_open: true,
          show_results_to_students: showResults,
        }).select('id').single()
      );
      toast('Live poll launched — students can respond right now.');
      onCreated(inserted?.id || null);
    } catch (e) {
      toast(e.message || 'Could not launch poll.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Launch live poll / exit ticket"
      onClose={() => !saving && onClose()}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={launch} disabled={saving || !question.trim()}>
            <Icon name="play" size={14} /> {saving ? 'Launching…' : 'Launch live now'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row-wrap" style={{ gap: 6, alignItems: 'center' }}>
          <span className="tiny muted">Quick templates:</span>
          {POLL_PRESETS.map((p) => (
            <button key={p.id} type="button" className="btn btn-sm" onClick={() => applyPreset(p)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="row-wrap" style={{ gap: 16 }}>
          <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="radio" name="poll-kind" checked={kind === 'mcq'} onChange={() => setKind('mcq')} />
            <span><strong>Multiple-choice poll</strong> (live bar chart)</span>
          </label>
          <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="radio" name="poll-kind" checked={kind === 'exit_ticket'} onChange={() => setKind('exit_ticket')} />
            <span><strong>1-Minute Exit Ticket</strong> (short text / muddiest point)</span>
          </label>
        </div>

        <Field label={kind === 'exit_ticket' ? 'Exit ticket prompt' : 'Poll question'}>
          <input
            className="input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={kind === 'exit_ticket' ? 'What concept needs one more example next week?' : 'Which Incoterm puts maximum obligation on the seller?'}
            autoFocus
          />
        </Field>

        {kind === 'mcq' && (
          <div className="stack-sm">
            <div className="between">
              <span className="small strong">Answer options</span>
              {options.length < 6 && (
                <button type="button" className="btn btn-sm" onClick={() => setOptions((prev) => [...prev, ''])}>
                  <Icon name="plus" size={13} /> Add option
                </button>
              )}
            </div>
            {options.map((opt, idx) => (
              <div key={idx} className="row" style={{ gap: 6 }}>
                <span className="mono tiny muted" style={{ width: 20 }}>{String.fromCharCode(65 + idx)}.</span>
                <input
                  className="input"
                  style={{ minHeight: 36 }}
                  value={opt}
                  onChange={(e) => setOptions((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))}
                  placeholder={`Option ${idx + 1}`}
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    className="icon-btn plain"
                    aria-label="Remove option"
                    onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            ))}
            <label className="check small" style={{ marginTop: 4 }}>
              <input type="checkbox" checked={showResults} onChange={(e) => setShowResults(e.target.checked)} />
              Let students see aggregated vote percentages after voting
            </label>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ProjectorPollModal({ poll, onToggleOpen, onRefresh, onClose }) {
  const total = Number(poll.total_votes) || 0;
  const opts = Array.isArray(poll.options) ? poll.options : [];
  const counts = Array.isArray(poll.option_counts) ? poll.option_counts : [];
  const responses = Array.isArray(poll.responses) ? poll.responses : [];

  return (
    <Modal
      title="Live Classroom Projector View"
      onClose={onClose}
      wide
      footer={
        <div className="between" style={{ width: '100%', flexWrap: 'wrap', gap: 8 }}>
          <span className="tiny muted">Auto-refreshing every 3 seconds · {total} response{total === 1 ? '' : 's'}</span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={onRefresh}><Icon name="refresh" size={14} /> Refresh</button>
            <button type="button" className="btn btn-sm" onClick={onToggleOpen}>{poll.is_open ? 'Close voting' : 'Reopen voting'}</button>
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      }
    >
      <div className="stack" style={{ padding: '6px 0' }}>
        <div className="between" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${poll.is_open ? 'badge-teal' : ''}`} style={{ fontSize: 13 }}>
            {poll.is_open ? 'LIVE — Accepting answers' : 'Voting Closed'}
          </span>
          <span className="mono strong" style={{ fontSize: 18 }}>{total} vote{total === 1 ? '' : 's'}</span>
        </div>

        <h2 style={{ margin: '4px 0 8px', fontSize: 22, lineHeight: 1.3 }}>{poll.question}</h2>

        {poll.kind === 'mcq' ? (
          <div className="stack" style={{ gap: 12 }}>
            {opts.map((opt, idx) => {
              const c = Number(counts[idx]) || 0;
              const p = total > 0 ? Math.round((c / total) * 100) : 0;
              return (
                <div key={idx} className="stack-sm" style={{ gap: 4 }}>
                  <div className="between" style={{ fontSize: 16 }}>
                    <strong>{String.fromCharCode(65 + idx)}. {opt}</strong>
                    <span className="mono strong">{c} · {p}%</span>
                  </div>
                  <div style={{ height: 22, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line-2)', overflow: 'hidden' }}>
                    <div style={{ width: `${p}%`, height: '100%', background: 'var(--teal)', transition: 'width 0.35s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="stack-sm" style={{ maxHeight: 340, overflowY: 'auto' }}>
            {responses.length === 0 ? (
              <div className="card"><Empty icon="chat" title="Waiting for student notes…">Student exit-ticket responses appear here live.</Empty></div>
            ) : (
              responses.map((r, idx) => (
                <div key={idx} style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)', fontSize: 15 }}>
                  {r.text}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function AnonymousSurveySection({ course, onMissingSql }) {
  const [act, busy] = useAction();
  const [cycleView, setCycleView] = useState('mid_semester');
  const { data, error, loading, reload } = useLoad(
    () => rpc('course_feedback_summary', { p_course: course.id }),
    [course.id],
  );

  if (loading) return <Loading />;
  if (error) {
    if (isMissingRpcError(error)) {
      return (
        <div className="card stack">
          <h3>Database update needed for Anonymous TQM Feedback</h3>
          <p className="small muted">Run the Section 15 SQL script in Supabase SQL Editor to enable anonymous mid-semester &amp; end-of-course student feedback surveys.</p>
          <div><button type="button" className="btn btn-primary" onClick={onMissingSql}>View &amp; Copy Setup SQL</button></div>
        </div>
      );
    }
    return <ErrorNote error={error} onRetry={reload} />;
  }

  const settings = data?.settings || { mid_open: false, end_open: false };
  const summary = data?.[cycleView] || { count: 0, averages: {}, cohorts: [], notes: [] };

  async function toggleCycle(field) {
    const nextVal = !settings[field];
    const ok = await act(
      () => run(supabase.from('course_feedback_settings').upsert({
        course_id: course.id,
        mid_open: field === 'mid_open' ? nextVal : settings.mid_open,
        end_open: field === 'end_open' ? nextVal : settings.end_open,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'course_id' })),
      nextVal ? 'Anonymous feedback window opened for students.' : 'Anonymous feedback window closed.',
    );
    if (ok !== undefined) reload();
  }

  return (
    <div className="stack">
      <div className="notice notice-info small">
        <strong>Strict Anonymity Guarantee:</strong> Student submissions are stored behind a one-way cryptographic hash (1 submission per cycle) with zero identity linkage. Cohort breakdowns appear only when a cohort has at least 3 responses.
      </div>

      <div className="two-col">
        <div className="card stack-sm">
          <div className="between">
            <strong>Mid-Semester TQM Pulse</strong>
            <span className={`badge ${settings.mid_open ? 'badge-teal' : ''}`}>{settings.mid_open ? 'Open' : 'Closed'}</span>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>
            Gather early course adjustments while the semester is still underway. {data?.mid_semester?.count || 0} response(s) collected.
          </p>
          <div>
            <button type="button" className={`btn btn-sm ${settings.mid_open ? '' : 'btn-primary'}`} onClick={() => toggleCycle('mid_open')} disabled={busy}>
              {settings.mid_open ? 'Close mid-semester survey' : 'Open mid-semester survey'}
            </button>
          </div>
        </div>

        <div className="card stack-sm">
          <div className="between">
            <strong>End-of-Course Evaluation</strong>
            <span className={`badge ${settings.end_open ? 'badge-teal' : ''}`}>{settings.end_open ? 'Open' : 'Closed'}</span>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>
            Collect summative TQM ratings on teaching clarity, materials, and pacing. {data?.end_semester?.count || 0} response(s) collected.
          </p>
          <div>
            <button type="button" className={`btn btn-sm ${settings.end_open ? '' : 'btn-primary'}`} onClick={() => toggleCycle('end_open')} disabled={busy}>
              {settings.end_open ? 'Close end-of-course survey' : 'Open end-of-course survey'}
            </button>
          </div>
        </div>
      </div>

      <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={cycleView === 'mid_semester'} onClick={() => setCycleView('mid_semester')}>
            Mid-Semester ({data?.mid_semester?.count || 0})
          </button>
          <button type="button" className="chip" aria-pressed={cycleView === 'end_semester'} onClick={() => setCycleView('end_semester')}>
            End-of-Course ({data?.end_semester?.count || 0})
          </button>
        </div>
        <button type="button" className="btn btn-sm" onClick={reload}><Icon name="refresh" size={14} /> Refresh</button>
      </div>

      {summary.count === 0 ? (
        <div className="card">
          <Empty icon="shield" title="No anonymous survey responses yet">
            Open the survey window above so students can rate Clarity, Pacing, Relevance, and Materials privately.
          </Empty>
        </div>
      ) : (
        <div className="stack">
          <div className="grid-4">
            {[
              ['Clarity', summary.averages?.clarity],
              ['Pacing', summary.averages?.pacing],
              ['Practical Relevance', summary.averages?.relevance],
              ['Course Materials', summary.averages?.materials],
            ].map(([label, val]) => (
              <div key={label} className="kpi">
                <div className="kpi-head"><span className="l">{label}</span><span className="kpi-icon"><Icon name="award" size={15} /></span></div>
                <span className="v">{val != null ? `${fmtNumber(val)} / 5` : '—'}</span>
                <span className="tiny muted">{summary.count} anonymous responses</span>
              </div>
            ))}
          </div>

          {Array.isArray(summary.cohorts) && summary.cohorts.length > 0 && (
            <section className="card-flush">
              <div className="card-head"><h3>Breakdown by class cohort (3+ responses)</h3></div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Cohort</th>
                      <th className="num">Responses</th>
                      <th className="num">Clarity</th>
                      <th className="num">Pacing</th>
                      <th className="num">Relevance</th>
                      <th className="num">Materials</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.cohorts.map((c, idx) => (
                      <tr key={idx}>
                        <td>{[c.programme, c.stream].filter(Boolean).join(' · ') || 'Unassigned'}</td>
                        <td className="num mono">{c.count}</td>
                        <td className="num mono">{fmtNumber(c.clarity)}</td>
                        <td className="num mono">{fmtNumber(c.pacing)}</td>
                        <td className="num mono">{fmtNumber(c.relevance)}</td>
                        <td className="num mono">{fmtNumber(c.materials)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {Array.isArray(summary.notes) && summary.notes.length > 0 && (
            <section className="card stack">
              <h3 style={{ margin: 0 }}>Anonymous Qualitative Comments (Keep / Improve / Stop)</h3>
              <div className="stack-sm">
                {summary.notes.map((n, idx) => (
                  <div key={idx} className="stack-sm" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line-2)' }}>
                    {n.keep_doing && <div className="small"><strong style={{ color: 'var(--teal-dark)' }}>Keep doing:</strong> {n.keep_doing}</div>}
                    {n.improve && <div className="small"><strong style={{ color: 'var(--amber-ink)' }}>Start / Improve:</strong> {n.improve}</div>}
                    {n.stop_doing && <div className="small"><strong style={{ color: 'var(--red-ink)' }}>Stop doing:</strong> {n.stop_doing}</div>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
