import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { fillVars, fmtNumber, fromLocalInput, toLocalInput } from '../../lib/format.js';
import Icon from '../../components/Icon.jsx';
import { Topbar } from '../../components/Layout.jsx';
import { Confirm, Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../components/ui.jsx';
import { quizStatus } from './course/QuizzesTab.jsx';

const KINDS = [
  { id: 'mcq', label: 'Multiple choice' },
  { id: 'truefalse', label: 'True / false' },
  { id: 'numeric', label: 'Calculation' },
  { id: 'short', label: 'Short answer' },
  { id: 'essay', label: 'Written answer' },
];
const kindName = (k) => KINDS.find((x) => x.id === k)?.label || k;
const LETTERS = 'abcdefgh';

function blank(kind, position) {
  const base = { kind, prompt: '', marks: 1, explanation: '', position, options: [], answer: {}, params: {}, formula: null, unit: '', decimals: 2, tolerance: 0, tolerance_type: 'abs' };
  if (kind === 'mcq') return { ...base, options: [{ id: 'a', text: '' }, { id: 'b', text: '' }, { id: 'c', text: '' }, { id: 'd', text: '' }], answer: { correct: 'a' } };
  if (kind === 'truefalse') return { ...base, options: [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }], answer: { correct: 'true' } };
  if (kind === 'numeric') return { ...base, answer: { value: '' }, decimals: 2, tolerance: 0.01 };
  if (kind === 'short') return { ...base, answer: { accepted: [] } };
  if (kind === 'essay') return { ...base, marks: 5 };
  return base;
}

export default function QuizBuilder() {
  const { quizId } = useParams();
  const { data, error, loading, reload, setData } = useLoad(async () => {
    const quiz = await run(supabase.from('quizzes').select('*, courses(id, code, title, color)').eq('id', quizId).maybeSingle());
    const questions = await run(supabase.from('questions').select('*').eq('quiz_id', quizId).order('position').order('created_at'));
    const { count } = await supabase.from('attempts').select('id', { count: 'exact', head: true }).eq('quiz_id', quizId);
    return { quiz, questions, attempts: count || 0 };
  }, [quizId]);
  const [editing, setEditing] = useState(null); // question id or 'new'
  const [draft, setDraft] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [pasting, setPasting] = useState(false);
  const [act, busy] = useAction();

  if (loading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} onRetry={reload} /></div>;
  if (!data.quiz) return <div className="page"><div className="card"><Empty title="Quiz not found" /></div></div>;

  const { quiz, questions } = data;
  const total = questions.reduce((s, q) => s + Number(q.marks || 0), 0);
  const st = quizStatus(quiz);

  function startNew(kind) {
    setDraft(blank(kind, (questions.at(-1)?.position ?? 0) + 1));
    setEditing('new');
  }

  async function move(i, dir) {
    const a = questions[i];
    const b = questions[i + dir];
    if (!b) return;
    await act(async () => {
      const pa = a.position === b.position ? i : a.position;
      const pb = a.position === b.position ? i + dir : b.position;
      await run(supabase.from('questions').update({ position: pb }).eq('id', a.id));
      await run(supabase.from('questions').update({ position: pa }).eq('id', b.id));
    });
    reload();
  }

  async function remove() {
    await act(() => run(supabase.from('questions').delete().eq('id', removing.id)), 'Question deleted.');
    setRemoving(null);
    reload();
  }

  return (
    <>
      <Topbar title={quiz.title} sub={`${quiz.courses.code} · ${questions.length} questions · ${fmtNumber(total)} marks`}>
        <span className={`badge ${st.cls}`}>{st.label}</span>
        <Link to={`/teach/course/${quiz.courses.id}?tab=quizzes`} className="btn"><Icon name="chevronLeft" /> Quizzes</Link>
        <Link to={`/teach/quiz/${quiz.id}/results`} className="btn btn-dark"><Icon name="chart" /> Results</Link>
      </Topbar>
      <div className="page">
        <div className="two-col" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
          <main className="stack">
            {data.attempts > 0 && (
              <div className="notice notice-warn">
                {data.attempts} student attempt{data.attempts === 1 ? ' has' : 's have'} already started. Changing answers or marks now
                affects only attempts submitted after the change.
              </div>
            )}

            {questions.length === 0 && editing !== 'new' && (
              <div className="card"><Empty icon="quiz" title="No questions yet">Add questions below, or paste a batch of multiple-choice questions.</Empty></div>
            )}

            {questions.map((q, i) =>
              editing === q.id ? (
                <QuestionEditor key={q.id} number={i + 1} initial={q} quizId={quiz.id}
                  onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
              ) : (
                <div key={q.id} className="q-edit">
                  <div className="q-edit-head">
                    <span className="mono strong" style={{ width: 28 }}>{i + 1}</span>
                    <span className="badge">{kindName(q.kind)}</span>
                    {q.kind === 'numeric' && q.formula && <span className="badge badge-blue">Unique figures</span>}
                    <span className="spacer" />
                    <span className="small muted nowrap">{fmtNumber(q.marks)} mark{Number(q.marks) === 1 ? '' : 's'}</span>
                    <button type="button" className="icon-btn plain" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrowUp" /></button>
                    <button type="button" className="icon-btn plain" aria-label="Move down" disabled={i === questions.length - 1} onClick={() => move(i, 1)}><Icon name="arrowDown" /></button>
                    <button type="button" className="icon-btn plain" aria-label="Edit question" onClick={() => setEditing(q.id)}><Icon name="edit" /></button>
                    <button type="button" className="icon-btn plain" aria-label="Delete question" onClick={() => setRemoving(q)}><Icon name="trash" /></button>
                  </div>
                  <button type="button" className="q-edit-body" onClick={() => setEditing(q.id)}
                    style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', width: '100%', font: 'inherit', color: 'inherit' }}>
                    <span className="pre">{q.prompt}</span>
                    <Summary q={q} />
                  </button>
                </div>
              ),
            )}

            {editing === 'new' && draft && (
              <QuestionEditor number={questions.length + 1} initial={draft} quizId={quiz.id} isNew
                onCancel={() => { setEditing(null); setDraft(null); }}
                onSaved={(again) => { setDraft(null); reload(); if (again) startNew(again); else setEditing(null); }} />
            )}

            {editing !== 'new' && (
              <div className="card stack-sm">
                <span className="eyebrow">Add a question</span>
                <div className="row-wrap">
                  {KINDS.map((k) => (
                    <button key={k.id} type="button" className="btn btn-sm" onClick={() => startNew(k.id)}>
                      <Icon name="plus" size={16} /> {k.label}
                    </button>
                  ))}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPasting(true)}>
                    <Icon name="clipboard" size={16} /> Paste multiple choice…
                  </button>
                </div>
              </div>
            )}
          </main>

          <Settings quiz={quiz} count={questions.length} onSaved={(q) => setData((d) => ({ ...d, quiz: { ...d.quiz, ...q } }))} />
        </div>
      </div>

      {removing && (
        <Confirm title="Delete this question?" danger confirmLabel="Delete" busy={busy}
          message="Any answers students already gave to this question are deleted too."
          onClose={() => setRemoving(null)} onConfirm={remove} />
      )}
      {pasting && <PasteModal quizId={quiz.id} start={(questions.at(-1)?.position ?? 0) + 1} onClose={() => setPasting(false)} onDone={reload} />}
    </>
  );
}

function Summary({ q }) {
  if (q.kind === 'mcq' || q.kind === 'truefalse') {
    return (
      <span className="stack-sm" style={{ gap: 4, display: 'flex' }}>
        {q.options.map((o, i) => (
          <span key={o.id} className="small" style={{ color: q.answer?.correct === o.id ? 'var(--teal-dark)' : 'var(--text-2)', fontWeight: q.answer?.correct === o.id ? 600 : 400 }}>
            {q.kind === 'mcq' ? `${LETTERS[i].toUpperCase()}. ` : ''}{o.text} {q.answer?.correct === o.id ? '✓' : ''}
          </span>
        ))}
      </span>
    );
  }
  if (q.kind === 'numeric') {
    return q.formula ? (
      <span className="small mono" style={{ color: 'var(--teal-dark)' }}>
        = {q.formula} {q.unit} · {Object.keys(q.params || {}).join(', ')} vary per student · ±{fmtNumber(q.tolerance, 6)}{q.tolerance_type === 'pct' ? '%' : ''}
      </span>
    ) : (
      <span className="small mono" style={{ color: 'var(--teal-dark)' }}>
        Answer {fmtNumber(q.answer?.value, 6)} {q.unit} · ±{fmtNumber(q.tolerance, 6)}{q.tolerance_type === 'pct' ? '%' : ''}
      </span>
    );
  }
  if (q.kind === 'short') return <span className="small" style={{ color: 'var(--teal-dark)' }}>Accepts: {(q.answer?.accepted || []).join(' · ')}</span>;
  return <span className="small muted">Marked by you{q.explanation ? ' · marking guide added' : ''}</span>;
}

// ---------------- question editor ----------------
function QuestionEditor({ number, initial, quizId, isNew, onCancel, onSaved }) {
  const toast = useToast();
  const [q, setQ] = useState(() => ({
    ...initial,
    options: initial.options?.map((o) => ({ ...o })) || [],
    answer: { ...(initial.answer || {}) },
    params: { ...(initial.params || {}) },
  }));
  const [mode, setMode] = useState(initial.kind === 'numeric' && initial.formula ? 'unique' : 'fixed');
  const [vars, setVars] = useState(() => Object.entries(initial.params || {}).map(([name, s]) => ({ name, min: s.min, max: s.max, step: s.step })));
  const [acceptedText, setAcceptedText] = useState((initial.answer?.accepted || []).join('\n'));
  const [test, setTest] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setQ((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (q.kind === 'numeric' && mode === 'unique' && vars.length === 0) setVars([{ name: 'D', min: '', max: '', step: 1 }]);
  }, [mode, q.kind, vars.length]);

  const tokens = useMemo(() => [...new Set([...(q.prompt || '').matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))], [q.prompt]);

  function buildRow() {
    const row = {
      quiz_id: quizId, kind: q.kind, prompt: q.prompt.trim(), marks: Number(q.marks) || 0, explanation: q.explanation || '',
      position: q.position, options: [], answer: {}, params: {}, formula: null, unit: q.unit || '',
      decimals: Number(q.decimals) || 0, tolerance: Number(q.tolerance) || 0, tolerance_type: q.tolerance_type || 'abs',
    };
    if (!row.prompt) throw new Error('Write the question text.');
    if (q.kind === 'mcq') {
      const opts = q.options.filter((o) => o.text.trim());
      if (opts.length < 2) throw new Error('Give at least two answer options.');
      const correctOld = q.answer.correct;
      const correctIdx = opts.findIndex((o) => o.id === correctOld);
      if (correctIdx < 0) throw new Error('Choose which option is correct.');
      row.options = opts.map((o, i) => ({ id: LETTERS[i], text: o.text.trim() }));
      row.answer = { correct: LETTERS[correctIdx] };
    } else if (q.kind === 'truefalse') {
      row.options = [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }];
      row.answer = { correct: q.answer.correct === 'false' ? 'false' : 'true' };
    } else if (q.kind === 'numeric') {
      if (mode === 'fixed') {
        if (q.answer.value === '' || Number.isNaN(Number(q.answer.value))) throw new Error('Enter the correct numeric answer.');
        row.answer = { value: Number(q.answer.value) };
      } else {
        const params = {};
        for (const v of vars) {
          const name = String(v.name || '').trim();
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`"${name || '(blank)'}" is not a valid figure name. Use letters like D, S or H.`);
          const min = Number(v.min); const max = Number(v.max); const step = Number(v.step) || 1;
          if (v.min === '' || v.max === '' || Number.isNaN(min) || Number.isNaN(max)) throw new Error(`Give a lowest and highest value for ${name}.`);
          if (max < min) throw new Error(`For ${name}, the highest value must be at least the lowest.`);
          params[name] = { min, max, step };
        }
        if (!Object.keys(params).length) throw new Error('Add at least one figure that varies.');
        if (!String(q.formula || '').trim()) throw new Error('Write the formula for the correct answer.');
        const missing = Object.keys(params).filter((n) => !tokens.includes(n));
        if (missing.length) throw new Error(`Put {${missing[0]}} in the question text so students can see their figure.`);
        row.params = params;
        row.formula = q.formula.trim();
      }
    } else if (q.kind === 'short') {
      const accepted = acceptedText.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!accepted.length) throw new Error('List at least one accepted answer.');
      row.answer = { accepted };
    }
    return row;
  }

  async function runTest() {
    setError('');
    try {
      const row = buildRow();
      const r = await rpc('test_formula', { p_formula: row.formula, p_params: row.params });
      setTest(r);
    } catch (e) {
      setError(e.message);
    }
  }

  async function save(again) {
    setError('');
    let row;
    try {
      row = buildRow();
    } catch (e) {
      setError(e.message);
      return;
    }
    setBusy(true);
    try {
      if (row.formula) {
        const r = await rpc('test_formula', { p_formula: row.formula, p_params: row.params });
        if (r.error) throw new Error(`The formula does not work yet: ${r.error}`);
      }
      if (isNew) await run(supabase.from('questions').insert(row));
      else await run(supabase.from('questions').update(row).eq('id', initial.id));
      toast('Question saved.');
      onSaved(again ? q.kind : null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="q-edit" style={{ borderColor: 'var(--teal)', boxShadow: '0 0 0 1px var(--teal)' }}>
      <div className="q-edit-head">
        <span className="mono strong">{number}</span>
        <span className="badge badge-teal">{kindName(q.kind)}</span>
        <span className="spacer" />
        <label className="row small" style={{ gap: 6 }}>
          Marks
          <input className="input" type="number" min="0" step="0.5" style={{ width: 80, minHeight: 36 }} value={q.marks} onChange={(e) => set('marks', e.target.value)} />
        </label>
      </div>
      <div className="q-edit-body">
        <Field label="Question" hint={q.kind === 'numeric' && mode === 'unique' ? 'put each varying figure in braces, e.g. {D} units' : undefined}>
          <textarea className="textarea" value={q.prompt} onChange={(e) => set('prompt', e.target.value)} autoFocus={isNew}
            placeholder={q.kind === 'numeric' && mode === 'unique'
              ? 'A distributor sells {D} units a year. Each order costs GH₵ {S} and holding one unit for a year costs GH₵ {H}. What is the EOQ?'
              : 'Type the question'} />
        </Field>

        {q.kind === 'mcq' && (
          <div className="stack-sm">
            <span className="field-label">Options — select the correct one</span>
            {q.options.map((o, i) => (
              <div key={o.id} className="opt-row">
                <input type="radio" name={`correct-${initial.id || 'new'}`} checked={q.answer.correct === o.id}
                  onChange={() => set('answer', { correct: o.id })} aria-label={`Option ${LETTERS[i].toUpperCase()} is correct`}
                  style={{ width: 20, height: 20, accentColor: 'var(--teal)' }} />
                <span className="mono strong" style={{ width: 18 }}>{LETTERS[i].toUpperCase()}</span>
                <input className="input" value={o.text} placeholder={`Option ${LETTERS[i].toUpperCase()}`}
                  onChange={(e) => set('options', q.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)))} />
                <button type="button" className="icon-btn plain" aria-label="Remove option" disabled={q.options.length <= 2}
                  onClick={() => set('options', q.options.filter((x) => x.id !== o.id))}><Icon name="x" /></button>
              </div>
            ))}
            {q.options.length < 8 && (
              <div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => {
                  const used = new Set(q.options.map((x) => x.id));
                  const id = [...'abcdefghijklmnop'].find((c) => !used.has(c));
                  set('options', [...q.options, { id, text: '' }]);
                }}><Icon name="plus" size={16} /> Add option</button>
              </div>
            )}
            <span className="tiny muted">Options are shuffled for each student if "Shuffle options" is on.</span>
          </div>
        )}

        {q.kind === 'truefalse' && (
          <div className="chips" role="group" aria-label="Correct answer">
            {['true', 'false'].map((v) => (
              <button key={v} type="button" className="chip" aria-pressed={q.answer.correct === v}
                onClick={() => set('answer', { correct: v })}>{v === 'true' ? 'True is correct' : 'False is correct'}</button>
            ))}
          </div>
        )}

        {q.kind === 'numeric' && (
          <div className="stack">
            <div className="chips" role="group" aria-label="Answer type">
              <button type="button" className="chip" aria-pressed={mode === 'fixed'} onClick={() => setMode('fixed')}>Same figures for everyone</button>
              <button type="button" className="chip" aria-pressed={mode === 'unique'} onClick={() => setMode('unique')}>Unique figures for each student</button>
            </div>

            {mode === 'fixed' ? (
              <Field label="Correct answer">
                <input className="input mono" style={{ maxWidth: 220 }} inputMode="decimal" value={q.answer.value ?? ''} onChange={(e) => set('answer', { value: e.target.value })} />
              </Field>
            ) : (
              <div className="stack-sm" style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 10 }}>
                <span className="field-label">Figures that change for each student</span>
                <div className="var-grid tiny muted"><span>Name</span><span>Lowest</span><span>Highest</span><span>Step</span><span /></div>
                {vars.map((v, i) => (
                  <div key={i} className="var-grid">
                    <input className="input mono" aria-label="Figure name" value={v.name} onChange={(e) => setVars(vars.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                    <input className="input mono" aria-label="Lowest" inputMode="decimal" value={v.min} onChange={(e) => setVars(vars.map((x, k) => (k === i ? { ...x, min: e.target.value } : x)))} />
                    <input className="input mono" aria-label="Highest" inputMode="decimal" value={v.max} onChange={(e) => setVars(vars.map((x, k) => (k === i ? { ...x, max: e.target.value } : x)))} />
                    <input className="input mono" aria-label="Step" inputMode="decimal" value={v.step} onChange={(e) => setVars(vars.map((x, k) => (k === i ? { ...x, step: e.target.value } : x)))} />
                    <button type="button" className="icon-btn plain" aria-label="Remove figure" onClick={() => setVars(vars.filter((_, k) => k !== i))}><Icon name="x" /></button>
                  </div>
                ))}
                <div>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setVars([...vars, { name: String.fromCharCode(65 + vars.length), min: '', max: '', step: 1 }])}>
                    <Icon name="plus" size={16} /> Add figure
                  </button>
                </div>
                <Field label="Formula for the correct answer" hint="use the names above · + − * / ^ sqrt() ln() exp() abs() power()">
                  <input className="input mono" value={q.formula || ''} onChange={(e) => set('formula', e.target.value)} placeholder="sqrt(2*D*S/H)" />
                </Field>
                <div className="row-wrap">
                  <button type="button" className="btn btn-sm" onClick={runTest}><Icon name="check" size={16} /> Test with sample figures</button>
                  {test && !test.error && (
                    <span className="small">
                      {Object.entries(test.vars).map(([k, v]) => `${k} = ${fmtNumber(v, 6)}`).join(', ')} → <strong className="mono">{fmtNumber(test.value, Number(q.decimals) || 0)}</strong> {q.unit}
                    </span>
                  )}
                  {test?.error && <span className="small" style={{ color: 'var(--red-ink)' }}>{test.error}</span>}
                </div>
                {test && !test.error && q.prompt && (
                  <div className="notice notice-info small pre">A student might see: {fillVars(q.prompt, test.vars)}</div>
                )}
              </div>
            )}

            <div className="grid-4">
              <Field label="Round answer to"><select className="select" value={q.decimals} onChange={(e) => set('decimals', e.target.value)}>
                {[0, 1, 2, 3, 4].map((d) => <option key={d} value={d}>{d === 0 ? 'Whole number' : `${d} decimal${d === 1 ? '' : 's'}`}</option>)}
              </select></Field>
              <Field label="Accept within"><input className="input mono" inputMode="decimal" value={q.tolerance} onChange={(e) => set('tolerance', e.target.value)} /></Field>
              <Field label="Tolerance is"><select className="select" value={q.tolerance_type} onChange={(e) => set('tolerance_type', e.target.value)}>
                <option value="abs">± units</option><option value="pct">± percent</option>
              </select></Field>
              <Field label="Unit" hint="optional"><input className="input" value={q.unit} onChange={(e) => set('unit', e.target.value)} placeholder="units" /></Field>
            </div>
          </div>
        )}

        {q.kind === 'short' && (
          <Field label="Accepted answers" hint="one per line · capital letters and extra spaces are ignored">
            <textarea className="textarea" value={acceptedText} onChange={(e) => setAcceptedText(e.target.value)} placeholder={'safety stock\nbuffer stock'} />
          </Field>
        )}

        <Field label={q.kind === 'essay' ? 'Marking guide / model answer' : 'Explanation'}
          hint={q.kind === 'essay' ? 'you see this while marking' : 'shown to students when you release answers'}>
          <textarea className="textarea" style={{ minHeight: 70 }} value={q.explanation} onChange={(e) => set('explanation', e.target.value)} />
        </Field>

        {error && <div className="notice notice-error">{error}</div>}
        <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          {isNew && <button type="button" className="btn" onClick={() => save(true)} disabled={busy}>Save and add another</button>}
          <button type="button" className="btn btn-primary" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving…' : 'Save question'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- settings ----------------
function Settings({ quiz, count, onSaved }) {
  const [act, busy] = useAction();
  const [f, setF] = useState(() => ({
    title: quiz.title, instructions: quiz.instructions, reference: quiz.reference,
    opens_at: toLocalInput(quiz.opens_at), closes_at: toLocalInput(quiz.closes_at),
    duration_minutes: quiz.duration_minutes, max_attempts: quiz.max_attempts, is_practice: quiz.is_practice,
    shuffle_questions: quiz.shuffle_questions, shuffle_options: quiz.shuffle_options,
    published: quiz.published, results_released: quiz.results_released, show_answers: quiz.show_answers,
  }));
  const [dirty, setDirty] = useState(false);
  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
    setDirty(true);
  };

  async function save() {
    const row = {
      ...f,
      title: f.title.trim() || 'Untitled quiz',
      opens_at: fromLocalInput(f.opens_at), closes_at: fromLocalInput(f.closes_at),
      duration_minutes: Math.max(1, Number(f.duration_minutes) || 30), max_attempts: Math.max(1, Number(f.max_attempts) || 1),
    };
    if (row.opens_at && row.closes_at && new Date(row.closes_at) <= new Date(row.opens_at)) {
      throw new Error('The closing time must be after the opening time.');
    }
    if (row.published && count === 0) throw new Error('Add at least one question before publishing.');
    const saved = await run(supabase.from('quizzes').update(row).eq('id', quiz.id).select().single());
    onSaved(saved);
    setDirty(false);
    return saved;
  }

  return (
    <aside className="card stack" style={{ position: 'sticky', top: 90 }}>
      <div className="between"><h2>Quiz settings</h2>{dirty && <span className="badge badge-amber">Unsaved</span>}</div>
      <Field label="Title"><input className="input" value={f.title} onChange={set('title')} /></Field>
      <Field label="Instructions" hint="shown before starting"><textarea className="textarea" style={{ minHeight: 70 }} value={f.instructions} onChange={set('instructions')} /></Field>
      <Field label="Formula sheet" hint="optional, shown beside questions"><textarea className="textarea mono" style={{ minHeight: 70, fontSize: 13 }} value={f.reference} onChange={set('reference')} placeholder={'EOQ = √(2DS ÷ H)\nROP = d × L + SS'} /></Field>
      <div className="grid-2" style={{ gap: 10 }}>
        <Field label="Opens"><input className="input" type="datetime-local" value={f.opens_at} onChange={set('opens_at')} /></Field>
        <Field label="Closes"><input className="input" type="datetime-local" value={f.closes_at} onChange={set('closes_at')} /></Field>
        <Field label="Time limit (min)"><input className="input" type="number" min="1" value={f.duration_minutes} onChange={set('duration_minutes')} /></Field>
        <Field label="Attempts"><input className="input" type="number" min="1" value={f.max_attempts} onChange={set('max_attempts')} disabled={f.is_practice} /></Field>
      </div>
      <div className="stack-sm">
        <label className="check"><input type="checkbox" checked={f.is_practice} onChange={set('is_practice')} /> Practice quiz — unlimited attempts, score and answers shown straight away, not in grades</label>
        <label className="check"><input type="checkbox" checked={f.shuffle_questions} onChange={set('shuffle_questions')} /> Shuffle question order for each student</label>
        <label className="check"><input type="checkbox" checked={f.shuffle_options} onChange={set('shuffle_options')} /> Shuffle multiple-choice options</label>
      </div>
      <div className="stack-sm" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 14 }}>
        <label className="check"><input type="checkbox" checked={f.published} onChange={set('published')} /> <span><strong>Published</strong> — students can see it (and take it when open)</span></label>
        <label className="check"><input type="checkbox" checked={f.results_released} onChange={set('results_released')} /> <span><strong>Results released</strong> — students see their score</span></label>
        <label className="check"><input type="checkbox" checked={f.show_answers} onChange={set('show_answers')} disabled={!f.results_released} /> Also show correct answers and explanations</label>
      </div>
      <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => act(save, 'Settings saved.')}>Save settings</button>
    </aside>
  );
}

// ---------------- paste multiple choice ----------------
export function parseMcq(text) {
  const blocks = String(text).replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const qLines = [];
    const options = [];
    let answer = null;
    for (const line of lines) {
      const opt = line.match(/^\(?([A-Ha-h])[).:\]]\s+(.*)$/);
      const ans = line.match(/^(answer|ans|correct)\s*[:=-]\s*\(?([A-Ha-h])\)?/i);
      if (ans) answer = ans[2].toLowerCase();
      else if (opt) {
        let t = opt[2];
        const starred = /\s*\*$/.test(t) || /^\*\s*/.test(t);
        t = t.replace(/\s*\*$/, '').replace(/^\*\s*/, '');
        options.push({ letter: opt[1].toLowerCase(), text: t, starred });
      } else if (!options.length) qLines.push(line);
    }
    if (!qLines.length || options.length < 2) continue;
    const prompt = qLines.join('\n').replace(/^(q(uestion)?\s*)?\d+\s*[.):-]\s*/i, '');
    const correctIdx = answer ? options.findIndex((o) => o.letter === answer) : options.findIndex((o) => o.starred);
    out.push({ prompt, options: options.map((o) => o.text), correct: correctIdx });
  }
  return out;
}

function PasteModal({ quizId, start, onClose, onDone }) {
  const [text, setText] = useState('');
  const [marks, setMarks] = useState(1);
  const [act, busy] = useAction();
  const parsed = useMemo(() => parseMcq(text), [text]);
  const missing = parsed.filter((p) => p.correct < 0).length;

  async function save() {
    const rows = parsed.filter((p) => p.correct >= 0).map((p, i) => ({
      quiz_id: quizId, kind: 'mcq', position: start + i, prompt: p.prompt, marks: Number(marks) || 1,
      options: p.options.map((t, k) => ({ id: LETTERS[k], text: t })), answer: { correct: LETTERS[p.correct] },
    }));
    const ok = await act(() => run(supabase.from('questions').insert(rows)), `${rows.length} questions added.`);
    if (ok !== undefined) {
      onDone();
      onClose();
    }
  }

  return (
    <Modal title="Paste multiple-choice questions" onClose={onClose} wide
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !parsed.length || missing === parsed.length}>
          Add {parsed.length - missing} question{parsed.length - missing === 1 ? '' : 's'}
        </button></>}>
      <p className="small muted">
        Leave a blank line between questions. Put options on lines starting with A), B), C)… and mark the correct one with
        a <strong>*</strong> at the end, or add a line <span className="mono">Answer: B</span>.
      </p>
      <textarea className="textarea mono" style={{ minHeight: 240, fontSize: 13 }} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={'1. Which inventory cost rises when order size increases?\nA) Ordering cost\nB) Holding cost *\nC) Stock-out cost\nD) Purchase price\n\n2. The bullwhip effect describes…\nA) Falling prices\nB) Growing order variability upstream\nC) Supplier consolidation\nAnswer: B'} />
      <div className="row-wrap">
        <label className="row small" style={{ gap: 6 }}>Marks each <input className="input" type="number" min="0" step="0.5" style={{ width: 80, minHeight: 36 }} value={marks} onChange={(e) => setMarks(e.target.value)} /></label>
        <span className="small">{parsed.length} found{missing ? <span style={{ color: 'var(--red-ink)' }}> · {missing} without a marked answer (skipped)</span> : ''}</span>
      </div>
    </Modal>
  );
}
