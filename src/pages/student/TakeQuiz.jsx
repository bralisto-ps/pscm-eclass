import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rpc } from '../../lib/supabase.js';
import { fillVars, fmtNumber, initials } from '../../lib/format.js';
import Icon from '../../components/Icon.jsx';
import { ErrorNote, Loading, Modal, Swatch, useLoad } from '../../components/ui.jsx';

const LETTERS = 'ABCDEFGHIJ';

function isAnswered(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

function readFlags(id) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`flags:${id}`) || '[]'));
  } catch {
    return new Set();
  }
}
function writeFlags(id, set) {
  try {
    localStorage.setItem(`flags:${id}`, JSON.stringify([...set]));
  } catch {
    /* private browsing: flags just won't persist */
  }
}

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export default function TakeQuiz() {
  const { attemptId } = useParams();
  const { data, error, loading, reload } = useLoad(() => rpc('get_attempt', { p_attempt: attemptId }), [attemptId]);

  if (loading) return <Loading label="Opening your quiz…" />;
  if (error) {
    return (
      <div className="page page-narrow">
        <ErrorNote error={error} onRetry={reload} />
        <p style={{ marginTop: 16 }}><Link to="/">Back to home</Link></p>
      </div>
    );
  }
  if (data.attempt.status !== 'in_progress') return <Done quiz={data.quiz} status={data.attempt.status} />;
  return <Runner initial={data} />;
}

function Done({ quiz, status, autoSubmitted }) {
  return (
    <div className="auth-main" style={{ minHeight: '100vh' }}>
      <div className="card stack" style={{ maxWidth: 520, textAlign: 'center', alignItems: 'center', padding: 36 }}>
        <div className="empty" style={{ padding: 0 }}>
          <div className="icon-circle" style={{ background: 'var(--teal-50)', color: 'var(--teal-dark)' }}>
            <Icon name="check" size={24} />
          </div>
        </div>
        <h1>{autoSubmitted ? 'Time is up — quiz submitted' : 'Quiz submitted'}</h1>
        <p className="muted">
          {quiz.title} ({quiz.course_code}).{' '}
          {status === 'needs_marking'
            ? 'Some written answers will be marked by your lecturer.'
            : 'Your answers have been marked.'}{' '}
          Your score will show on the course page once your lecturer releases the results.
        </p>
        <Link to={`/course/${quiz.course_id}?tab=quizzes`} className="btn btn-dark">Back to course</Link>
      </div>
    </div>
  );
}

function Runner({ initial }) {
  const { attempt, quiz, questions } = initial;
  const offset = useMemo(() => new Date(attempt.server_now).getTime() - Date.now(), [attempt.server_now]);
  const deadline = new Date(attempt.deadline_at).getTime();

  const [answers, setAnswers] = useState(() => Object.fromEntries(questions.map((q) => [q.id, q.value ?? ''])));
  const [saveState, setSaveState] = useState({});
  const [current, setCurrent] = useState(0);
  const [flags, setFlags] = useState(() => readFlags(attempt.id));
  const [remaining, setRemaining] = useState(deadline - (Date.now() + offset));
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(null);
  const [fatal, setFatal] = useState('');

  const latest = useRef({});     // question id → latest value not yet confirmed saved
  const inflight = useRef({});   // question id → true while saving
  const timers = useRef({});     // debounce timers

  const saveNow = useCallback(async (qid) => {
    clearTimeout(timers.current[qid]);
    if (inflight.current[qid] || !(qid in latest.current)) return;
    const value = latest.current[qid];
    inflight.current[qid] = true;
    setSaveState((s) => ({ ...s, [qid]: 'saving' }));
    try {
      await rpc('save_response', { p_attempt: attempt.id, p_question: qid, p_value: value });
      if (latest.current[qid] === value) delete latest.current[qid];
      setSaveState((s) => ({ ...s, [qid]: 'saved' }));
    } catch (e) {
      setSaveState((s) => ({ ...s, [qid]: 'error' }));
      if (/Time is up/i.test(e.message)) {
        latest.current = {};
        setFatal('Time is up for this attempt. Your saved answers have been submitted.');
      }
    } finally {
      inflight.current[qid] = false;
      if (qid in latest.current && latest.current[qid] !== value) saveNow(qid);
    }
  }, [attempt.id]);

  const flushAll = useCallback(async () => {
    const ids = Object.keys(latest.current);
    await Promise.all(ids.map((id) => saveNow(id)));
    // wait for any saves already running
    for (let i = 0; i < 40 && Object.values(inflight.current).some(Boolean); i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }, [saveNow]);

  function setAnswer(qid, value, immediate) {
    setAnswers((a) => ({ ...a, [qid]: value }));
    latest.current[qid] = value;
    setSaveState((s) => ({ ...s, [qid]: 'pending' }));
    clearTimeout(timers.current[qid]);
    if (immediate) saveNow(qid);
    else timers.current[qid] = setTimeout(() => saveNow(qid), 800);
  }

  // retry failed saves every 5 seconds (for patchy connections)
  useEffect(() => {
    const t = setInterval(() => {
      Object.keys(latest.current).forEach((id) => {
        if (!inflight.current[id]) saveNow(id);
      });
    }, 5000);
    return () => clearInterval(t);
  }, [saveNow]);

  const submit = useCallback(async (auto) => {
    if (submitting) return;
    setSubmitting(true);
    await flushAll();
    try {
      const status = await rpc('submit_attempt', { p_attempt: attempt.id });
      setFinished({ status, auto });
    } catch (e) {
      setFatal(e.message);
      setSubmitting(false);
    }
  }, [attempt.id, flushAll, submitting]);

  // countdown
  useEffect(() => {
    const t = setInterval(() => {
      const left = deadline - (Date.now() + offset);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        submit(true);
      }
    }, 500);
    return () => clearInterval(t);
  }, [deadline, offset, submit]);

  // warn before leaving with unsaved answers
  useEffect(() => {
    const onLeave = (e) => {
      if (Object.keys(latest.current).length) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  if (finished) return <Done quiz={quiz} status={finished.status} autoSubmitted={finished.auto} />;

  const q = questions[current];
  const answeredCount = questions.filter((x) => isAnswered(answers[x.id])).length;
  const unsaved = Object.values(saveState).some((s) => s === 'error');
  const low = remaining < 5 * 60 * 1000;

  function toggleFlag() {
    const next = new Set(flags);
    if (next.has(q.id)) next.delete(q.id);
    else next.add(q.id);
    setFlags(next);
    writeFlags(attempt.id, next);
  }

  function go(i) {
    const id = questions[current]?.id;
    if (id && id in latest.current) saveNow(id);
    setCurrent(Math.max(0, Math.min(questions.length - 1, i)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const st = saveState[q.id];

  return (
    <div className="quiz-shell">
      <header className="quiz-top">
        <div className="quiz-top-inner">
          <div className="row" style={{ minWidth: 0 }}>
            <Swatch color={quiz.course_color} text={initials(quiz.course_code)} size={36} />
            <div className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
              <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{quiz.title}</strong>
              <span className="tiny muted">{quiz.course_code} · answers save automatically</span>
            </div>
          </div>
          <div className="row">
            <span className="small muted hide-sm">{answeredCount} of {questions.length} answered</span>
            <span className={`timer ${low ? 'low' : ''}`} role="timer" aria-label="Time left">
              <Icon name="clock" size={16} /> {clock(remaining)}
            </span>
          </div>
        </div>
        <div className="progress"><div style={{ width: `${(answeredCount / questions.length) * 100}%` }} /></div>
      </header>

      {(unsaved || fatal) && (
        <div style={{ padding: '12px 28px 0', maxWidth: 1280, margin: '0 auto', width: '100%' }}>
          <div className={`notice ${fatal ? 'notice-error' : 'notice-warn'}`}>
            {fatal || 'Some answers could not be saved — check your internet connection. We keep retrying every few seconds; do not close this page.'}
          </div>
        </div>
      )}

      <div className="quiz-body">
        <main className="question-card">
          <div className="between" style={{ flexWrap: 'wrap' }}>
            <span className="eyebrow">Question {current + 1} of {questions.length}</span>
            <div className="row-wrap">
              <span className="badge badge-teal">{kindLabel(q.kind)} · {fmtNumber(q.marks)} mark{Number(q.marks) === 1 ? '' : 's'}</span>
              {Object.keys(q.vars || {}).length > 0 && <span className="badge">Figures unique to you</span>}
            </div>
          </div>

          <div className="question-text">{fillVars(q.prompt, q.vars)}</div>

          <div className="answer-box">
            <AnswerInput q={q} value={answers[q.id]} onChange={setAnswer} onBlur={() => saveNow(q.id)} />
            <span className="save-state" aria-live="polite" style={{ color: st === 'error' ? 'var(--red-ink)' : 'var(--muted)' }}>
              {st === 'saving' && 'Saving…'}
              {st === 'pending' && 'Editing…'}
              {st === 'saved' && <span style={{ color: 'var(--teal-dark)' }}>✓ Saved</span>}
              {st === 'error' && 'Not saved yet — retrying'}
            </span>
          </div>

          <div className="spacer" />
          <div className="between" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 18, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => go(current - 1)} disabled={current === 0}>
              <Icon name="chevronLeft" /> Previous
            </button>
            <button type="button" className="btn btn-ghost" onClick={toggleFlag} aria-pressed={flags.has(q.id)}>
              <Icon name="flag" /> {flags.has(q.id) ? 'Unflag' : 'Flag for review'}
            </button>
            {current < questions.length - 1 ? (
              <button type="button" className="btn btn-dark" onClick={() => go(current + 1)}>
                Next <Icon name="chevronRight" />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)}>
                Review and submit
              </button>
            )}
          </div>
        </main>

        <aside className="stack">
          <section className="card stack" aria-label="Question navigator">
            <h2 style={{ fontSize: 15 }}>Questions</h2>
            <div className="qnav">
              {questions.map((x, i) => {
                const cls = [
                  flags.has(x.id) ? 'flag' : isAnswered(answers[x.id]) ? 'done' : '',
                  i === current ? 'current' : '',
                ].join(' ');
                return (
                  <button key={x.id} type="button" className={cls} onClick={() => go(i)}
                    aria-label={`Question ${i + 1}${isAnswered(answers[x.id]) ? ', answered' : ''}${flags.has(x.id) ? ', flagged' : ''}`}
                    aria-current={i === current ? 'step' : undefined}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="legend">
              <span><i style={{ background: 'var(--teal)' }} />Answered</span>
              <span><i style={{ background: '#f2c98b' }} />Flagged</span>
              <span><i style={{ background: 'var(--grey-50)' }} />To do</span>
            </div>
          </section>

          {quiz.reference && (
            <section className="card stack-sm" aria-label="Formula sheet">
              <h2 style={{ fontSize: 15 }}>Formula sheet</h2>
              <div className="mono small pre" style={{ lineHeight: 1.8 }}>{quiz.reference}</div>
            </section>
          )}

          <button type="button" className="btn btn-primary btn-block" style={{ minHeight: 48 }} onClick={() => setConfirming(true)}>
            Review and submit
          </button>
        </aside>
      </div>

      {confirming && (
        <Modal
          title="Submit your quiz?"
          onClose={() => !submitting && setConfirming(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={submitting}>Keep working</button>
              <button type="button" className="btn btn-primary" onClick={() => submit(false)} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit now'}
              </button>
            </>
          }
        >
          <p>You have answered <strong>{answeredCount} of {questions.length}</strong> questions.</p>
          {answeredCount < questions.length && (
            <div className="notice notice-warn">
              Unanswered:{' '}
              {questions.map((x, i) => (!isAnswered(answers[x.id]) ? i + 1 : null)).filter(Boolean).join(', ')}
            </div>
          )}
          {flags.size > 0 && (
            <p className="small muted">
              Flagged for review: {questions.map((x, i) => (flags.has(x.id) ? i + 1 : null)).filter(Boolean).join(', ')}
            </p>
          )}
          <p className="small muted">After you submit you cannot change your answers.</p>
        </Modal>
      )}
    </div>
  );
}

function kindLabel(kind) {
  return { mcq: 'Multiple choice', truefalse: 'True or false', numeric: 'Calculation', short: 'Short answer', essay: 'Written answer' }[kind] || 'Question';
}

function AnswerInput({ q, value, onChange, onBlur }) {
  if (q.kind === 'mcq' || q.kind === 'truefalse') {
    return (
      <div className="stack-sm" role="radiogroup" aria-label="Choose one answer">
        {q.options.map((o, i) => {
          const selected = value === o.id;
          return (
            <button key={o.id} type="button" role="radio" aria-checked={selected}
              className={`option ${selected ? 'selected' : ''}`} onClick={() => onChange(q.id, o.id, true)}>
              <span className="letter">{q.kind === 'truefalse' ? (o.id === 'true' ? 'T' : 'F') : LETTERS[i]}</span>
              <span>{o.text}</span>
            </button>
          );
        })}
      </div>
    );
  }
  if (q.kind === 'numeric') {
    return (
      <label className="row-wrap">
        <span className="sr-only">Your answer</span>
        <input
          className="input mono"
          style={{ maxWidth: 240, fontSize: 18, minHeight: 50, borderWidth: 2, borderColor: 'var(--teal)' }}
          inputMode="decimal"
          autoComplete="off"
          value={value ?? ''}
          onChange={(e) => onChange(q.id, e.target.value)}
          onBlur={onBlur}
          placeholder="0"
        />
        {q.unit && <span style={{ fontSize: 16 }}>{q.unit}</span>}
        <span className="tiny muted" style={{ width: '100%' }}>
          {Number(q.decimals) === 0 ? 'Enter a whole number.' : `Enter a number, rounded to ${q.decimals} decimal place${Number(q.decimals) === 1 ? '' : 's'}.`}
        </span>
      </label>
    );
  }
  if (q.kind === 'short') {
    return (
      <label className="field">
        <span className="sr-only">Your answer</span>
        <input className="input" value={value ?? ''} onChange={(e) => onChange(q.id, e.target.value)} onBlur={onBlur} autoComplete="off" maxLength={300} placeholder="Type your answer" />
      </label>
    );
  }
  const words = String(value || '').trim().split(/\s+/).filter(Boolean).length;
  return (
    <label className="field">
      <span className="sr-only">Your answer</span>
      <textarea className="textarea" style={{ minHeight: 220 }} value={value ?? ''} onChange={(e) => onChange(q.id, e.target.value)} onBlur={onBlur} maxLength={15000} placeholder="Write your answer here" />
      <span className="tiny muted">{words} words</span>
    </label>
  );
}
