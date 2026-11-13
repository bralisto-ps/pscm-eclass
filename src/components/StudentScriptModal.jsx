import { useMemo, useState } from 'react';
import { rpc, run, supabase } from '../lib/supabase.js';
import { fillVars, fmtFull, fmtNumber, pct } from '../lib/format.js';
import { LIVE_EXAM_AND_PHOTOS_SQL } from '../lib/liveExamSql.js';
import Icon from './Icon.jsx';
import { Empty, ErrorNote, Loading, Modal, useAction, useLoad, useToast } from './ui.jsx';

const LETTERS = 'ABCDEFGHIJ';
const KIND_LABEL = {
  mcq: 'Multiple choice',
  truefalse: 'True / false',
  numeric: 'Calculation',
  short: 'Short answer',
  essay: 'Written answer',
};

function shownValue(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  return String(v);
}

async function loadDirectFallback(attemptId, quizTitle, student) {
  const attempt = await run(supabase.from('attempts').select('*').eq('id', attemptId).single());
  const order = Array.isArray(attempt.question_order) ? attempt.question_order : [];
  const [qRows, rRows] = await Promise.all([
    order.length
      ? run(supabase.from('questions').select('*').in('id', order))
      : Promise.resolve([]),
    run(supabase.from('responses').select('*').eq('attempt_id', attemptId)),
  ]);

  const qById = new Map((qRows || []).map((q) => [q.id, q]));
  const rByQ = new Map((rRows || []).map((r) => [r.question_id, r]));

  const questions = order
    .map((qid) => {
      const q = qById.get(qid);
      if (!q) return null;
      const r = rByQ.get(qid);
      let correct = null;
      if (q.kind === 'mcq' || q.kind === 'truefalse') correct = q.answer?.correct ?? null;
      else if (q.kind === 'short') correct = q.answer?.accepted ?? [];
      else if (q.kind === 'numeric' && !q.formula) correct = q.answer?.value ?? null;

      return {
        response_id: r?.id || null,
        id: q.id,
        kind: q.kind,
        prompt: q.prompt,
        marks: q.marks,
        unit: q.unit,
        has_formula: Boolean(q.formula && q.formula.trim()),
        vars: {},
        options: q.kind === 'mcq' || q.kind === 'truefalse' ? q.options || [] : [],
        value: r?.value ?? null,
        is_correct: r?.is_correct ?? null,
        marks_awarded: r?.marks_awarded ?? null,
        feedback: r?.feedback ?? '',
        correct,
        explanation: q.explanation || '',
      };
    })
    .filter(Boolean);

  return {
    attempt_id: attempt.id,
    quiz_id: attempt.quiz_id,
    title: quizTitle || 'Quiz script',
    status: attempt.status,
    score: attempt.score,
    max_score: attempt.max_score,
    started_at: attempt.started_at,
    submitted_at: attempt.submitted_at,
    student: {
      full_name: student?.full_name || 'Student',
      index_no: student?.index_no || '',
    },
    questions,
    usedFallback: true,
  };
}

export default function StudentScriptModal({ attemptId, student, quiz, isTA, onClose, onMarked }) {
  const toast = useToast();
  const [filter, setFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [markDraft, setMarkDraft] = useState('');
  const [fbDraft, setFbDraft] = useState('');
  const [act, busy] = useAction();

  const { data, error, loading, reload, setData } = useLoad(async () => {
    try {
      const res = await rpc('staff_attempt_review', { p_attempt: attemptId });
      return { ...res, usedFallback: false };
    } catch (e) {
      const missingRpc = /staff_attempt_review|Could not find the function|does not exist|schema cache/i.test(e.message || '');
      if (missingRpc && !isTA) {
        return loadDirectFallback(attemptId, quiz?.title, student);
      }
      throw e;
    }
  }, [attemptId, isTA]);

  const questions = data?.questions || [];

  const counts = useMemo(() => {
    let wrong = 0;
    let shortQ = 0;
    let pending = 0;
    for (const q of questions) {
      if (q.kind === 'short') shortQ++;
      if (q.marks_awarded === null) pending++;
      else if (Number(q.marks_awarded) < Number(q.marks)) wrong++;
    }
    return { total: questions.length, wrong, shortQ, pending };
  }, [questions]);

  const shown = useMemo(() => {
    return questions
      .map((q, idx) => ({ ...q, _num: idx + 1 }))
      .filter((q) => {
        if (filter === 'wrong') return q.marks_awarded !== null && Number(q.marks_awarded) < Number(q.marks);
        if (filter === 'short') return q.kind === 'short';
        if (filter === 'pending') return q.marks_awarded === null;
        return true;
      });
  }, [questions, filter]);

  function openEditor(q) {
    setEditingId(q.id);
    setMarkDraft(q.marks_awarded !== null && q.marks_awarded !== undefined ? String(q.marks_awarded) : '');
    setFbDraft(q.feedback || '');
  }

  async function saveOverride(q, overrideMarks) {
    if (!q.response_id) {
      toast('This question has no saved response row yet.', 'error');
      return;
    }
    const raw = overrideMarks !== undefined ? overrideMarks : markDraft;
    const val = Number(raw);
    const max = Number(q.marks);
    if (raw === '' || Number.isNaN(val) || val < 0 || val > max) {
      toast(`Enter a mark between 0 and ${max}.`, 'error');
      return;
    }
    const fb = fbDraft.trim();
    const ok = await act(
      () => rpc('mark_response', { p_response: q.response_id, p_marks: val, p_feedback: fb }),
      `Updated Question ${q._num || ''} to ${fmtNumber(val)} / ${fmtNumber(max)}.`,
    );
    if (ok !== undefined) {
      setData((prev) => {
        if (!prev) return prev;
        const nextQs = prev.questions.map((item) =>
          item.id === q.id
            ? { ...item, marks_awarded: val, is_correct: val === Number(item.marks), feedback: fb || null }
            : item
        );
        const nextScore = nextQs.reduce((sum, item) => sum + (item.marks_awarded !== null ? Number(item.marks_awarded) : 0), 0);
        const anyNull = nextQs.some((item) => item.marks_awarded === null);
        return {
          ...prev,
          score: nextScore,
          status: prev.status === 'in_progress' ? 'in_progress' : anyNull ? 'needs_marking' : 'marked',
          questions: nextQs,
        };
      });
      setEditingId(null);
      onMarked?.();
    }
  }

  function copySql() {
    navigator.clipboard?.writeText(LIVE_EXAM_AND_PHOTOS_SQL);
    toast('Copied SQL setup script — paste and run in Supabase SQL Editor.');
  }

  const titleName = data?.student?.full_name || student?.full_name || 'Student';
  const titleIndex = data?.student?.index_no || student?.index_no || '';
  const modalTitle = `Answer Script · ${titleName}${titleIndex ? ` (${titleIndex})` : ''}`;

  const missingRpcError = error && /staff_attempt_review|Could not find the function|does not exist|schema cache/i.test(error.message || '');

  return (
    <Modal title={modalTitle} onClose={onClose} wide footer={<button type="button" className="btn btn-primary" onClick={onClose}>Close</button>}>
      {loading && <Loading label="Loading student's answers…" />}

      {error && missingRpcError && (
        <div className="stack">
          <div className="notice notice-warn">
            One-time SQL setup is required for Teaching Assistants to inspect scripts (run it once in Supabase SQL Editor).
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={copySql}>Copy SQL script</button>
            <button type="button" className="btn btn-sm" onClick={reload}>Retry</button>
          </div>
        </div>
      )}

      {error && !missingRpcError && <ErrorNote error={error} onRetry={reload} />}

      {data && (
        <div className="stack">
          <div className="card-soft between" style={{ padding: '12px 16px', flexWrap: 'wrap', gap: 12 }}>
            <div className="stack-sm" style={{ gap: 2 }}>
              <strong>{data.title || quiz?.title}</strong>
              <span className="tiny muted">
                {[student?.programme, student?.stream].filter(Boolean).join(' · ') || 'Enrolled student'}
                {data.submitted_at ? ` · Submitted ${fmtFull(data.submitted_at)}` : data.status === 'in_progress' ? ' · Currently writing' : ''}
              </span>
            </div>
            <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
              {data.status === 'in_progress' ? (
                <span className="badge badge-blue">In progress</span>
              ) : (
                <>
                  <span className="mono strong" style={{ fontSize: 18 }}>
                    {fmtNumber(data.score)} / {fmtNumber(data.max_score)}
                  </span>
                  <span className="badge badge-teal">{pct(data.score, data.max_score) ?? 0}%</span>
                </>
              )}
            </div>
          </div>

          {data.usedFallback && questions.some((q) => q.has_formula) && (
            <div className="notice notice-info small" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>Showing raw responses. Run the latest SQL script to also display each student's unique formula figures &amp; expected numeric values.</span>
              <button type="button" className="btn btn-sm" onClick={copySql}>Copy SQL script</button>
            </div>
          )}

          <div className="chips" role="group" aria-label="Filter script questions">
            {[
              ['all', `All · ${counts.total}`],
              ['wrong', `Missed / < Full · ${counts.wrong}`],
              ...(counts.shortQ > 0 ? [['short', `Short answer · ${counts.shortQ}`]] : []),
              ...(counts.pending > 0 ? [['pending', `Needs marking · ${counts.pending}`]] : []),
            ].map(([id, label]) => (
              <button key={id} type="button" className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <Empty icon="check" title="No questions match this filter" />
          ) : (
            <div className="stack">
              {shown.map((q) => {
                const mine = shownValue(q.value);
                const correctVal = q.correct !== null && q.correct !== undefined ? q.correct : null;
                const fullMarks = q.marks_awarded !== null && Number(q.marks_awarded) >= Number(q.marks);
                const partialMarks = q.marks_awarded !== null && Number(q.marks_awarded) > 0 && Number(q.marks_awarded) < Number(q.marks);
                const isEditing = editingId === q.id;
                const canOverride = data.status !== 'in_progress' && Boolean(q.response_id);

                return (
                  <article key={q.id} className="card stack-sm" style={{ padding: 16 }}>
                    <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <div className="row-wrap" style={{ gap: 6 }}>
                        <span className="eyebrow">Question {q._num}</span>
                        <span className="badge">{KIND_LABEL[q.kind] || q.kind}</span>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <span
                          className={`badge ${
                            q.marks_awarded === null
                              ? 'badge-amber'
                              : fullMarks
                              ? 'badge-teal'
                              : partialMarks
                              ? 'badge-amber'
                              : 'badge-red'
                          }`}
                        >
                          {q.marks_awarded === null
                            ? `Unmarked (${fmtNumber(q.marks)} max)`
                            : `${fmtNumber(q.marks_awarded)} / ${fmtNumber(q.marks)}`}
                        </span>
                        {canOverride && (
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => (isEditing ? setEditingId(null) : openEditor(q))}
                          >
                            <Icon name="edit" size={13} /> {isEditing ? 'Cancel' : 'Adjust mark'}
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="pre" style={{ fontSize: 15, margin: '4px 0 6px' }}>
                      {fillVars(q.prompt, q.vars)}
                    </p>

                    {(q.kind === 'mcq' || q.kind === 'truefalse') && (
                      <div className="stack-sm">
                        {mine === null && (
                          <div className="notice notice-warn small" style={{ padding: '6px 10px' }}>
                            Student did not select an option.
                          </div>
                        )}
                        {(q.options || []).map((o, k) => {
                          const isMine = mine === o.id;
                          const isRight = correctVal === o.id;
                          return (
                            <div
                              key={o.id}
                              className={`option ${isRight ? 'correct' : isMine ? 'wrong' : ''}`}
                              style={{ cursor: 'default', padding: '10px 12px' }}
                            >
                              <span className="letter">
                                {q.kind === 'truefalse' ? (o.id === 'true' ? 'T' : 'F') : LETTERS[k]}
                              </span>
                              <span style={{ flex: 1 }}>{o.text}</span>
                              {isMine && isRight && <span className="tiny strong">Student chose ✓</span>}
                              {isMine && !isRight && <span className="tiny strong">Student chose</span>}
                              {!isMine && isRight && <span className="tiny strong">Correct key</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {q.kind !== 'mcq' && q.kind !== 'truefalse' && (
                      <div className="stack-sm" style={{ background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 8 }}>
                        <div>
                          <span className="eyebrow">Student's answer</span>
                          <p className={q.kind === 'essay' ? 'pre small' : 'mono'} style={{ margin: '4px 0 0', fontWeight: 600 }}>
                            {mine !== null ? `${mine}${q.unit ? ` ${q.unit}` : ''}` : <span className="muted" style={{ fontWeight: 400 }}>No answer submitted</span>}
                          </p>
                        </div>
                        {q.kind === 'short' && Array.isArray(correctVal) && correctVal.length > 0 && (
                          <p className="small muted" style={{ margin: 0 }}>
                            Accepted answers: <strong style={{ color: 'var(--text)' }}>{correctVal.join(' · ')}</strong>
                          </p>
                        )}
                        {q.kind === 'numeric' && correctVal !== null && (
                          <p className="small muted" style={{ margin: 0 }}>
                            Expected answer: <strong className="mono" style={{ color: 'var(--text)' }}>{fmtNumber(correctVal, 6)} {q.unit}</strong>
                          </p>
                        )}
                        {q.kind === 'essay' && q.explanation && (
                          <p className="small muted" style={{ margin: 0 }}>
                            Marking guide: <span style={{ color: 'var(--text-2)' }}>{q.explanation}</span>
                          </p>
                        )}
                      </div>
                    )}

                    {q.feedback && !isEditing && (
                      <div className="notice notice-info small" style={{ padding: '8px 12px' }}>
                        <strong>Feedback:</strong> {q.feedback}
                      </div>
                    )}

                    {isEditing && (
                      <div className="stack-sm" style={{ padding: 12, borderRadius: 8, border: '1.5px solid var(--teal)', background: 'var(--teal-50)' }}>
                        <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
                          <span className="small strong">Set mark (max {fmtNumber(q.marks)}):</span>
                          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => saveOverride(q, 0)}>0</button>
                          {Number(q.marks) >= 1 && (
                            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => saveOverride(q, Number((Number(q.marks) / 2).toFixed(2)))}>
                              50% ({fmtNumber(Number(q.marks) / 2)})
                            </button>
                          )}
                          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveOverride(q, Number(q.marks))}>
                            Full ({fmtNumber(q.marks)})
                          </button>
                        </div>
                        <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
                          <input
                            type="number"
                            step="any"
                            min={0}
                            max={Number(q.marks)}
                            className="input mono"
                            style={{ width: 96, minHeight: 38 }}
                            value={markDraft}
                            onChange={(e) => setMarkDraft(e.target.value)}
                            placeholder="Marks"
                          />
                          <input
                            type="text"
                            className="input"
                            style={{ flex: 1, minWidth: 180, minHeight: 38 }}
                            value={fbDraft}
                            onChange={(e) => setFbDraft(e.target.value)}
                            placeholder="Optional feedback for student"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                saveOverride(q);
                              }
                            }}
                          />
                          <button type="button" className="btn btn-sm btn-dark" disabled={busy} onClick={() => saveOverride(q)}>
                            {busy ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
