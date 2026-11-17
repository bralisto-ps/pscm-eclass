import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase.js';
import { relative } from '../lib/format.js';
import Icon from './Icon.jsx';
import { Empty, ErrorNote, Field, Loading, useAction, useLoad, useToast } from './ui.jsx';

function isMissingFeatureRpc(err) {
  return /student_course_polls|course_feedback_status|Could not find|does not exist|schema cache/i.test(err?.message || '');
}

export function LivePollBanner({ courseId, onOpenTab }) {
  const [polls, setPolls] = useState([]);
  const [fbStatus, setFbStatus] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      const [p, fb] = await Promise.all([
        rpc('student_course_polls', { p_course: courseId }).catch(() => []),
        rpc('course_feedback_status', { p_course: courseId }).catch(() => null),
      ]);
      if (!alive) return;
      setPolls(Array.isArray(p) ? p : []);
      setFbStatus(fb || null);
    }
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [courseId]);

  const openPoll = polls.find((p) => p.is_open && p.my_option_index === null && !p.my_response_text);
  const openSurvey = fbStatus && ((fbStatus.mid_open && !fbStatus.mid_submitted) || (fbStatus.end_open && !fbStatus.end_submitted));

  if (!openPoll && !openSurvey) return null;

  return (
    <div
      className="notice notice-info between"
      style={{ flexWrap: 'wrap', gap: 10, marginBottom: 14, borderColor: 'var(--teal)' }}
    >
      <div className="row" style={{ gap: 8, minWidth: 0, flex: 1 }}>
        <Icon name={openPoll ? 'activity' : 'shield'} size={17} />
        <span className="small">
          {openPoll ? (
            <><strong>Live class poll open:</strong> {openPoll.question}</>
          ) : (
            <><strong>Anonymous course feedback is open:</strong> Share your 1-minute rating on this course.</>
          )}
        </span>
      </div>
      <button type="button" className="btn btn-sm btn-primary" onClick={onOpenTab}>
        {openPoll ? 'Answer live poll' : 'Give anonymous feedback'}
      </button>
    </div>
  );
}

export default function StudentPollsFeedback({ course }) {
  const toast = useToast();
  const [act, busy] = useAction();

  const { data, error, loading, reload } = useLoad(async () => {
    const [pollsRes, fbRes] = await Promise.all([
      rpc('student_course_polls', { p_course: course.id }),
      rpc('course_feedback_status', { p_course: course.id }),
    ]);
    return {
      polls: Array.isArray(pollsRes) ? pollsRes : [],
      fb: fbRes || { mid_open: false, end_open: false, mid_submitted: false, end_submitted: false },
    };
  }, [course.id]);

  // Refresh periodically while on tab
  useEffect(() => {
    const hasOpen = (data?.polls || []).some((p) => p.is_open);
    if (!hasOpen) return undefined;
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, [data?.polls]);

  if (loading) return <Loading />;
  if (error) {
    if (isMissingFeatureRpc(error)) {
      return (
        <div className="card">
          <Empty icon="activity" title="Live polls not enabled yet">
            Your lecturer has not activated live classroom polls for this course yet.
          </Empty>
        </div>
      );
    }
    return <ErrorNote error={error} onRetry={reload} />;
  }

  const polls = data?.polls || [];
  const fb = data?.fb || { mid_open: false, end_open: false, mid_submitted: false, end_submitted: false };
  const activeSurveys = [];
  if (fb.mid_open || fb.mid_submitted) activeSurveys.push({ cycle: 'mid_semester', label: 'Mid-Semester TQM Pulse', open: fb.mid_open, submitted: fb.mid_submitted });
  if (fb.end_open || fb.end_submitted) activeSurveys.push({ cycle: 'end_semester', label: 'End-of-Course Evaluation', open: fb.end_open, submitted: fb.end_submitted });

  return (
    <div className="stack-lg" style={{ maxWidth: 860 }}>
      <section className="stack">
        <div className="between">
          <h2 style={{ margin: 0 }}>Live Polls &amp; 1-Minute Exit Tickets</h2>
          <button type="button" className="btn btn-sm" onClick={reload}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>

        {polls.length === 0 ? (
          <div className="card">
            <Empty icon="activity" title="No live polls right now">
              When your lecturer launches an in-class concept poll or exit ticket, it will appear right here.
            </Empty>
          </div>
        ) : (
          <div className="stack">
            {polls.map((poll) => (
              <StudentPollCard
                key={poll.id}
                poll={poll}
                busy={busy}
                onVote={async (optionIndex, text) => {
                  const ok = await act(
                    () => rpc('submit_poll_vote', {
                      p_poll: poll.id,
                      p_option_index: optionIndex,
                      p_response_text: text || '',
                    }),
                    'Response recorded!',
                  );
                  if (ok !== undefined) reload();
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="stack">
        <h2 style={{ margin: 0 }}>Anonymous Course Feedback</h2>
        {activeSurveys.length === 0 ? (
          <div className="card">
            <Empty icon="shield" title="Course evaluation is currently closed">
              Anonymous mid-semester or end-of-course feedback surveys will appear here when your lecturer opens a window.
            </Empty>
          </div>
        ) : (
          <div className="stack">
            {activeSurveys.map((srv) => (
              <AnonymousSurveyCard
                key={srv.cycle}
                course={course}
                survey={srv}
                onSubmitted={() => {
                  toast('Thank you — your anonymous feedback has been recorded.');
                  reload();
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StudentPollCard({ poll, busy, onVote }) {
  const [exitNote, setExitNote] = useState(poll.my_response_text || '');
  const opts = Array.isArray(poll.options) ? poll.options : [];
  const counts = Array.isArray(poll.option_counts) ? poll.option_counts : [];
  const total = Number(poll.total_votes) || 0;
  const hasVoted = poll.kind === 'mcq'
    ? poll.my_option_index !== null && poll.my_option_index !== undefined
    : Boolean(poll.my_response_text);

  return (
    <article className="card stack-sm" style={poll.is_open ? { borderColor: 'var(--teal)' } : undefined}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row-wrap" style={{ gap: 8 }}>
          <span className={`badge ${poll.is_open ? 'badge-teal' : ''}`}>
            {poll.is_open ? 'LIVE · Open' : 'Closed'}
          </span>
          <span className="badge badge-blue">
            {poll.kind === 'exit_ticket' ? '1-Minute Exit Ticket' : 'Live Poll'}
          </span>
          <span className="tiny muted">{relative(poll.created_at)}</span>
        </div>
        {hasVoted && <span className="badge badge-teal"><Icon name="check" size={13} /> Answered</span>}
      </div>

      <h3 style={{ margin: '4px 0', fontSize: 17 }}>{poll.question}</h3>

      {poll.kind === 'mcq' ? (
        <div className="stack-sm">
          {opts.map((opt, idx) => {
            const picked = poll.my_option_index === idx;
            const c = Number(counts[idx]) || 0;
            const showBars = poll.show_results_to_students && (hasVoted || !poll.is_open) && counts.length > 0;
            const p = total > 0 ? Math.round((c / total) * 100) : 0;
            return (
              <button
                key={idx}
                type="button"
                disabled={!poll.is_open || busy}
                onClick={() => onVote(idx, '')}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: picked ? '2px solid var(--teal)' : '1px solid var(--line)',
                  background: picked ? 'var(--teal-50)' : 'var(--surface)',
                  cursor: poll.is_open ? 'pointer' : 'default',
                  width: '100%',
                }}
              >
                <div className="between small" style={{ gap: 8 }}>
                  <span><strong>{String.fromCharCode(65 + idx)}.</strong> {opt}</span>
                  {showBars && <span className="mono">{p}% ({c})</span>}
                </div>
                {showBars && (
                  <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden', marginTop: 6 }}>
                    <div style={{ width: `${p}%`, height: '100%', background: 'var(--teal)' }} />
                  </div>
                )}
              </button>
            );
          })}
          {poll.is_open && <span className="tiny muted">Tap any choice to submit{hasVoted ? ' or change your vote' : ''}.</span>}
        </div>
      ) : (
        <div className="stack-sm">
          {poll.is_open ? (
            <>
              <textarea
                className="textarea"
                rows={2}
                placeholder="Write a quick 1-sentence note for your lecturer (shared privately with teaching staff)…"
                value={exitNote}
                onChange={(e) => setExitNote(e.target.value)}
              />
              <div>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy || !exitNote.trim()}
                  onClick={() => onVote(null, exitNote.trim())}
                >
                  {hasVoted ? 'Update exit ticket' : 'Submit exit ticket'}
                </button>
              </div>
            </>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              {hasVoted ? `Your response: “${poll.my_response_text}”` : 'This exit ticket has closed.'}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

const LIKERT_ITEMS = [
  { key: 'clarity', label: 'Teaching clarity & explanations', low: 'Unclear', high: 'Crystal clear' },
  { key: 'pacing', label: 'Lecture pacing & coverage', low: 'Too rushed / slow', high: 'Well paced' },
  { key: 'relevance', label: 'Practical PSCM / industry relevance', low: 'Too abstract', high: 'Highly practical' },
  { key: 'materials', label: 'Quality of slides, cases & quizzes', low: 'Needs work', high: 'Excellent' },
];

function AnonymousSurveyCard({ course, survey, onSubmitted }) {
  const toast = useToast();
  const [scores, setScores] = useState({ clarity: 0, pacing: 0, relevance: 0, materials: 0 });
  const [keepDoing, setKeepDoing] = useState('');
  const [improve, setImprove] = useState('');
  const [stopDoing, setStopDoing] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (survey.submitted) {
    return (
      <div className="card stack-sm" style={{ borderColor: 'var(--teal)' }}>
        <div className="between">
          <strong>{survey.label}</strong>
          <span className="badge badge-teal"><Icon name="check" size={13} /> Submitted anonymously</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Thank you! Your response for {course.code} was recorded without your name or index number.
        </p>
      </div>
    );
  }

  if (!survey.open) return null;

  async function submit() {
    if (!scores.clarity || !scores.pacing || !scores.relevance || !scores.materials) {
      toast('Please rate all 4 items (1 to 5) before submitting.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await rpc('submit_course_feedback', {
        p_course: course.id,
        p_cycle: survey.cycle,
        p_clarity: scores.clarity,
        p_pacing: scores.pacing,
        p_relevance: scores.relevance,
        p_materials: scores.materials,
        p_keep: keepDoing.trim(),
        p_improve: improve.trim(),
        p_stop: stopDoing.trim(),
      });
      onSubmitted();
    } catch (e) {
      toast(e.message || 'Could not submit feedback.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card stack">
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong style={{ fontSize: 16 }}>{survey.label}</strong>
          <div className="tiny muted">100% anonymous — your name and index number are never stored with this response.</div>
        </div>
        <span className="badge badge-teal">Open</span>
      </div>

      <div className="stack-sm">
        {LIKERT_ITEMS.map((item) => (
          <div key={item.key} className="between" style={{ flexWrap: 'wrap', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line-2)' }}>
            <div>
              <div className="small strong">{item.label}</div>
              <div className="tiny muted">1 = {item.low} · 5 = {item.high}</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`btn btn-sm ${scores[item.key] === n ? 'btn-primary' : ''}`}
                  style={{ minWidth: 36 }}
                  onClick={() => setScores((prev) => ({ ...prev, [item.key]: n }))}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid-2" style={{ gap: 12 }}>
        <Field label="What should the lecturer KEEP doing?" hint="optional">
          <textarea className="textarea" rows={2} value={keepDoing} onChange={(e) => setKeepDoing(e.target.value)} placeholder="Real Ghana port & supply chain case studies…" />
        </Field>
        <Field label="What should we START or IMPROVE?" hint="optional">
          <textarea className="textarea" rows={2} value={improve} onChange={(e) => setImprove(e.target.value)} placeholder="More worked calculation examples before quizzes…" />
        </Field>
      </div>
      <Field label="Anything we should STOP doing?" hint="optional">
        <input className="input" value={stopDoing} onChange={(e) => setStopDoing(e.target.value)} placeholder="Optional comment…" />
      </Field>

      <div>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
          <Icon name="shield" size={15} /> {submitting ? 'Submitting anonymously…' : 'Submit anonymous feedback'}
        </button>
      </div>
    </div>
  );
}
