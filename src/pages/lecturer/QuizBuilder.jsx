import AIGeneratorModal from "../../components/AIGeneratorModal.jsx";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rpc, rpcAll, run, supabase } from '../../lib/supabase.js';
import { fillVars, fmtNumber, fromLocalInput, toLocalInput } from '../../lib/format.js';
import Icon from '../../components/Icon.jsx';
import { Topbar } from '../../components/Layout.jsx';
import { Confirm, Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../components/ui.jsx';
import { quizStatus } from './course/QuizzesTab.jsx';
import SpecialAccess from './SpecialAccess.jsx';
import { FORMAT_LABELS, parseQuizMeta, serializeQuizMeta, STRATIFIED_SQL_SNIPPET } from '../../lib/quizMeta.js';
import {
  parseQuestionsFromText,
  parseQuestionsFromRows,
  parseQuestionsFromFile,
  downloadSampleExcel,
  downloadSampleWord,
  SAMPLE_PASTE_TEXT,
  KIND_LABELS,
} from '../../lib/questionParser.js';

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
  const base = { kind, prompt: '', marks: 1, explanation: '', topic: '', position, options: [], answer: {}, params: {}, formula: null, unit: '', decimals: 2, tolerance: 0, tolerance_type: 'abs' };
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
    const windows = await run(supabase.from('quiz_windows').select('*').eq('quiz_id', quizId));
    const opts = await run(supabase.from('group_options').select('name').eq('kind', 'stream').order('name'));
    const classes = quiz ? await rpcAll('course_classes', { p_course: quiz.course_id }) : [];
    const groups = { streams: opts.map((o) => o.name), classes };
    return { quiz, questions, attempts: count || 0, windows, groups };
  }, [quizId]);
  const [editing, setEditing] = useState(null); // question id or 'new'
  const [draft, setDraft] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [pasting, setPasting] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
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
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setAiGenerating(true)}
          style={{
            background: "linear-gradient(135deg, #0d9488 0%, #6366f1 100%)",
            borderColor: "transparent",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          <Icon name="sparkles" size={16} /> Generate with AI ✨
        </button>
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
                    {q.topic && <span className="badge badge-plum">{q.topic}</span>}
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
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAiGenerating(true)}><Icon name="sparkles" size={16} /> Generate with AI…</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPasting(true)}>
                    <Icon name="upload" size={16} /> Import / Paste from Word or Excel…
                  </button>
                </div>
              </div>
            )}
          </main>

          <div className="stack" style={{ alignSelf: 'start' }}>
            <Settings quiz={quiz} count={questions.length} questions={questions} windows={data.windows} streams={data.groups.streams} classes={data.groups.classes} onSaved={(q) => setData((d) => ({ ...d, quiz: { ...d.quiz, ...q } }))} />
            <SpecialAccess quiz={quiz} restricted={quiz.restricted} />
          </div>
        </div>
      </div>

      {removing && (
        <Confirm title="Delete this question?" danger confirmLabel="Delete" busy={busy}
          message="Any answers students already gave to this question are deleted too."
          onClose={() => setRemoving(null)} onConfirm={remove} />
      )}
      {pasting && <UniversalImportModal quizId={quiz.id} start={(questions.at(-1)?.position ?? 0) + 1} onClose={() => setPasting(false)} onDone={reload} />}
      {aiGenerating && <AIGeneratorModal quizId={quiz.id} start={(questions.at(-1)?.position ?? 0) + 1} onClose={() => setAiGenerating(false)} onDone={reload} />}
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
      quiz_id: quizId, kind: q.kind, prompt: q.prompt.trim(), marks: Number(q.marks) || 0, explanation: q.explanation || '', topic: (q.topic || '').trim(),
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
      const accepted = acceptedText.split(/[\n|]+/).map((s) => s.trim()).filter(Boolean);
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
          Topic
          <input className="input" style={{ width: 170, minHeight: 36 }} value={q.topic || ''} onChange={(e) => set('topic', e.target.value)} placeholder="optional" />
        </label>
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
          <Field label="Accepted answers" hint="one per line (or separated by | ) · capital letters and extra spaces are ignored">
            <textarea className="textarea" value={acceptedText} onChange={(e) => setAcceptedText(e.target.value)} placeholder={'stock accuracy\ninventory accuracy'} />
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
const classKey = (programme, stream) => `${(programme || '').toLowerCase()}|${(stream || '').toLowerCase()}`;
const classLabel = (c) => `${c.programme || 'No programme'} · ${c.stream || 'No stream'}`;

function Settings({ quiz, count, questions = [], windows, streams, classes, onSaved }) {
  const [act, busy] = useAction();
  const initialMeta = useMemo(() => parseQuizMeta(quiz), [quiz?.id, quiz?.instructions]);
  const [f, setF] = useState(() => ({
    title: quiz.title,
    instructions: initialMeta.cleanInstructions,
    reference: quiz.reference,
    opens_at: toLocalInput(quiz.opens_at),
    closes_at: toLocalInput(quiz.closes_at),
    duration_minutes: quiz.duration_minutes,
    max_attempts: quiz.max_attempts,
    is_practice: quiz.is_practice,
    shuffle_questions: quiz.shuffle_questions,
    shuffle_options: quiz.shuffle_options,
    published: quiz.published,
    results_released: quiz.results_released,
    show_answers: quiz.show_answers,
    restricted: quiz.restricted,
    lockdown: quiz.lockdown,
    max_exits: quiz.max_exits ?? 0,
    no_backtrack: quiz.no_backtrack,
    pool_size: quiz.pool_size ?? '',
    question_time_limit: quiz.question_time_limit ?? '',
  }));

  const [customTimesOn, setCustomTimesOn] = useState(initialMeta.custom_times_enabled);
  const [formatTimes, setFormatTimes] = useState(initialMeta.format_times);
  const [quotasOn, setQuotasOn] = useState(initialMeta.format_quotas_enabled);
  const [quotas, setQuotas] = useState(initialMeta.format_quotas);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Live count of questions available in this quiz by format
  const formatCounts = useMemo(() => {
    const counts = { mcq: 0, truefalse: 0, short: 0, numeric: 0, essay: 0 };
    (questions || []).forEach((q) => {
      if (counts[q.kind] !== undefined) counts[q.kind]++;
    });
    return counts;
  }, [questions]);

  // Sum of quotas
  const totalQuota = useMemo(() => {
    if (!quotasOn) return 0;
    return Object.values(quotas).reduce((sum, v) => sum + (Number(v) > 0 ? Number(v) : 0), 0);
  }, [quotasOn, quotas]);

  const streamWins = windows.filter((w) => (w.programme ?? '*') === '*');
  const classWins = windows.filter((w) => (w.programme ?? '*') !== '*');
  const [mode, setMode] = useState(classWins.length ? 'class' : streamWins.length ? 'stream' : 'all');
  const perStream = mode === 'stream';
  const setPerStream = (on) => setMode(on ? 'stream' : 'all');

  const [win, setWin] = useState(() => {
    const names = [...new Set([...streams, ...streamWins.map((w) => w.stream)])];
    return names.map((st) => {
      const w = streamWins.find((x) => x.stream.toLowerCase() === st.toLowerCase());
      return { stream: st, on: streamWins.length ? !!w : true, opens_at: toLocalInput(w?.opens_at), closes_at: toLocalInput(w?.closes_at) };
    });
  });

  const [cwin, setCwin] = useState(() => {
    const list = [...classes];
    classWins.forEach((w) => {
      if (!list.some((c) => classKey(c.programme, c.stream) === classKey(w.programme, w.stream))) {
        list.push({ programme: w.programme, stream: w.stream, students: 0 });
      }
    });
    return list.map((c) => {
      const w = classWins.find((x) => classKey(x.programme, x.stream) === classKey(c.programme, c.stream));
      return { ...c, on: classWins.length ? !!w : true, opens_at: toLocalInput(w?.opens_at), closes_at: toLocalInput(w?.closes_at) };
    });
  });

  const setC = (i, k, v) => {
    setCwin(cwin.map((w, j) => (j === i ? { ...w, [k]: v } : w)));
    setDirty(true);
  };
  const [dirty, setDirty] = useState(false);
  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
    setDirty(true);
  };
  const setW = (i, k, v) => {
    setWin(win.map((w, j) => (j === i ? { ...w, [k]: v } : w)));
    setDirty(true);
  };

  async function save() {
    let poolSizeVal = f.pool_size === '' || Number(f.pool_size) <= 0 ? null : Math.floor(Number(f.pool_size));
    if (quotasOn) {
      if (totalQuota <= 0) throw new Error('Format quotas are enabled. Please enter at least one quota, or toggle off format quotas.');
      // Validate that requested quotas do not exceed question bank counts
      Object.entries(quotas).forEach(([k, v]) => {
        const req = Number(v) || 0;
        const avail = formatCounts[k] || 0;
        if (req > avail) {
          throw new Error(`You specified a quota of ${req} for ${FORMAT_LABELS[k]}, but there are only ${avail} in this quiz bank.`);
        }
      });
      poolSizeVal = totalQuota;
    }

    const row = {
      ...f,
      title: f.title.trim() || 'Untitled quiz',
      instructions: serializeQuizMeta(f.instructions, {
        custom_times_enabled: customTimesOn,
        format_times: formatTimes,
        format_quotas_enabled: quotasOn,
        format_quotas: quotas,
      }),
      opens_at: fromLocalInput(f.opens_at),
      closes_at: fromLocalInput(f.closes_at),
      duration_minutes: Math.max(1, Number(f.duration_minutes) || 30),
      max_attempts: Math.max(1, Number(f.max_attempts) || 1),
      max_exits: Math.max(0, Number(f.max_exits) || 0),
      pool_size: poolSizeVal,
      question_time_limit: f.question_time_limit === '' || Number(f.question_time_limit) <= 0 ? null : Math.floor(Number(f.question_time_limit)),
    };

    if (row.opens_at && row.closes_at && new Date(row.closes_at) <= new Date(row.opens_at)) {
      throw new Error('The closing time must be after the opening time.');
    }
    if (row.published && count === 0) throw new Error('Add at least one question before publishing.');
    if (row.pool_size && row.pool_size > count) {
      throw new Error(`The question bank has only ${count} questions — the number per student cannot be more than that.`);
    }

    const chosen = mode === 'stream' ? win.filter((w) => w.on).map((w) => ({ ...w, programme: '*' }))
      : mode === 'class' ? cwin.filter((w) => w.on) : [];
    if (mode === 'stream' && !chosen.length) throw new Error('Tick at least one stream, or choose "Same times for everyone".');
    if (mode === 'class' && !chosen.length) throw new Error('Tick at least one class, or choose "Same times for everyone".');
    for (const w of chosen) {
      if (w.opens_at && w.closes_at && new Date(w.closes_at) <= new Date(w.opens_at)) {
        throw new Error(`For ${mode === 'class' ? classLabel(w) : w.stream}, the closing time must be after the opening time.`);
      }
    }

    const saved = await run(supabase.from('quizzes').update(row).eq('id', quiz.id).select().single());
    await run(supabase.from('quiz_windows').delete().eq('quiz_id', quiz.id));
    if (chosen.length) {
      await run(supabase.from('quiz_windows').insert(chosen.map((w) => ({
        quiz_id: quiz.id,
        programme: w.programme,
        stream: w.stream,
        opens_at: fromLocalInput(w.opens_at),
        closes_at: fromLocalInput(w.closes_at),
      }))));
    }
    onSaved(saved);
    setDirty(false);
  }

  function copySql() {
    navigator.clipboard?.writeText?.(STRATIFIED_SQL_SNIPPET);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 3000);
  }

  return (
    <aside className="card stack">
      <div className="between"><h2>Quiz settings</h2>{dirty && <span className="badge badge-amber">Unsaved</span>}</div>
      <Field label="Title"><input className="input" value={f.title} onChange={set('title')} /></Field>
      <Field label="Instructions" hint="shown before starting"><textarea className="textarea" style={{ minHeight: 70 }} value={f.instructions} onChange={set('instructions')} /></Field>
      <Field label="Formula sheet" hint="optional, shown beside questions"><textarea className="textarea mono" style={{ minHeight: 70, fontSize: 13 }} value={f.reference} onChange={set('reference')} placeholder={'EOQ = √(2DS ÷ H)\nROP = d × L + SS'} /></Field>

      <div className="stack-sm" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 14 }}>
        <span className="eyebrow">Who and when</span>
        <label className="check"><input type="checkbox" checked={f.restricted} onChange={set('restricted')} />
          <span><strong>Special access only</strong> — only students you list in Special Access below can take this quiz</span></label>
        <div className="row small" style={{ gap: 14, flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 4 }}><input type="radio" name="timing-mode" checked={mode === 'all'} onChange={() => { setMode('all'); setDirty(true); }} /> Same times for everyone</label>
          {streams.length > 0 && <label className="row" style={{ gap: 4 }}><input type="radio" name="timing-mode" checked={mode === 'stream'} onChange={() => { setMode('stream'); setDirty(true); }} /> Different times per stream</label>}
          {classes.length > 0 && <label className="row" style={{ gap: 4 }}><input type="radio" name="timing-mode" checked={mode === 'class'} onChange={() => { setMode('class'); setDirty(true); }} /> Different times per class</label>}
        </div>
        {mode === 'all' && (
          <div className="grid-2">
            <Field label="Opens"><input className="input" type="datetime-local" value={f.opens_at} onChange={set('opens_at')} /></Field>
            <Field label="Closes"><input className="input" type="datetime-local" value={f.closes_at} onChange={set('closes_at')} /></Field>
          </div>
        )}
        {mode === 'stream' && (
          <div className="stack-sm">
            {win.map((w, i) => (
              <div key={w.stream} className="card-soft stack-sm" style={{ padding: 10 }}>
                <label className="check"><input type="checkbox" checked={w.on} onChange={(e) => setW(i, 'on', e.target.checked)} /><strong>{w.stream}</strong></label>
                {w.on && (
                  <div className="grid-2">
                    <Field label="Opens"><input className="input" type="datetime-local" value={w.opens_at} onChange={(e) => setW(i, 'opens_at', e.target.value)} /></Field>
                    <Field label="Closes"><input className="input" type="datetime-local" value={w.closes_at} onChange={(e) => setW(i, 'closes_at', e.target.value)} /></Field>
                  </div>
                )}
              </div>
            ))}
            <span className="tiny muted">Unticked streams cannot see or take this quiz.</span>
          </div>
        )}
        {mode === 'class' && (
          <div className="stack-sm">
            {cwin.map((w, i) => (
              <div key={classKey(w.programme, w.stream)} className="card-soft stack-sm" style={{ padding: 10 }}>
                <label className="check"><input type="checkbox" checked={w.on} onChange={(e) => setC(i, 'on', e.target.checked)} />
                  <span><strong>{w.programme || 'No programme'}</strong> · {w.stream || 'No stream'} <span className="tiny muted">({w.students} students)</span></span></label>
                {w.on && (
                  <div className="grid-2">
                    <Field label="Opens"><input className="input" type="datetime-local" value={w.opens_at} onChange={(e) => setC(i, 'opens_at', e.target.value)} /></Field>
                    <Field label="Closes"><input className="input" type="datetime-local" value={w.closes_at} onChange={(e) => setC(i, 'closes_at', e.target.value)} /></Field>
                  </div>
                )}
              </div>
            ))}
            <span className="tiny muted">Unticked streams cannot see or take this quiz.</span>
          </div>
        )}

        <div className="grid-2" style={{ gap: 10 }}>
          <Field label="Total time (min)"><input className="input" type="number" min="1" value={f.duration_minutes} onChange={set('duration_minutes')} /></Field>
          <Field label="Attempts"><input className="input" type="number" min="1" value={f.max_attempts} onChange={set('max_attempts')} disabled={f.is_practice} /></Field>
        </div>

        {/* ---------------- Per-Question Countdown Timer Section ---------------- */}
        <div className="card-soft stack-sm" style={{ padding: 12, border: '1px solid var(--line-2)' }}>
          <div className="between" style={{ alignItems: 'center' }}>
            <span className="small"><strong>⏱️ Question Countdown Timer</strong></span>
            <button
              type="button"
              className="chip"
              style={{ fontSize: 11, cursor: 'pointer', background: customTimesOn ? 'var(--teal-50)' : undefined, borderColor: customTimesOn ? 'var(--teal)' : undefined }}
              onClick={() => { setCustomTimesOn(!customTimesOn); setDirty(true); }}
            >
              {customTimesOn ? '✓ Custom by Format Active' : '+ Set Times by Format'}
            </button>
          </div>

          {!customTimesOn ? (
            <div className="stack-sm">
              <Field label="Uniform seconds per question" hint="applies to every question">
                <input className="input" type="number" min="0" placeholder="Optional (e.g. 60)" value={f.question_time_limit} onChange={set('question_time_limit')} />
              </Field>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {[
                  { label: 'Off', val: '' },
                  { label: '30s', val: '30' },
                  { label: '45s', val: '45' },
                  { label: '60s', val: '60' },
                  { label: '90s', val: '90' },
                  { label: '120s', val: '120' },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    className="chip"
                    style={{ fontSize: 11, padding: '2px 8px', minHeight: 24 }}
                    aria-pressed={String(f.question_time_limit || '') === opt.val}
                    onClick={() => { setF({ ...f, question_time_limit: opt.val }); setDirty(true); }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="stack-sm" style={{ paddingTop: 4 }}>
              <p className="tiny muted" style={{ margin: 0 }}>
                Different time limits are allocated based on question complexity. The screen timer automatically adapts as each student advances.
              </p>
              <div className="stack-sm" style={{ gap: 6 }}>
                {Object.entries(FORMAT_LABELS).map(([k, label]) => {
                  const qCount = formatCounts[k] || 0;
                  const defaultSecs = k === 'mcq' ? 30 : k === 'truefalse' ? 20 : k === 'short' ? 45 : k === 'numeric' ? 90 : 180;
                  return (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '5px 8px', background: '#fff', borderRadius: 6, border: '1px solid var(--line-2)' }}>
                      <div>
                        <span className="small"><strong>{label}</strong></span>
                        <span className="tiny muted" style={{ marginLeft: 6 }}>({qCount} in quiz)</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input
                          className="input mono"
                          type="number"
                          min="5"
                          style={{ width: 65, minHeight: 28, padding: '2px 6px', textAlign: 'center', fontSize: 13 }}
                          placeholder={String(defaultSecs)}
                          value={formatTimes[k] ?? ''}
                          onChange={(e) => {
                            setFormatTimes({ ...formatTimes, [k]: e.target.value });
                            setDirty(true);
                          }}
                        />
                        <span className="tiny muted">sec</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="between" style={{ alignItems: 'center', paddingTop: 4 }}>
                <span className="tiny muted">Fallback default: {f.question_time_limit || 60}s</span>
                <button type="button" className="btn btn-sm btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => { setCustomTimesOn(false); setDirty(true); }}>
                  Switch back to uniform time
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="stack-sm" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 14 }}>
        <div className="between" style={{ alignItems: 'center' }}>
          <span className="eyebrow">Exam Security & Anti-Cheating Suite</span>
          <span className="badge badge-teal" style={{ fontSize: 11 }}>Active</span>
        </div>
        <div style={{ padding: '8px 12px', background: 'rgba(13, 148, 136, 0.05)', borderRadius: 6, fontSize: 12, color: 'var(--teal-900, #134e4a)', lineHeight: 1.5 }}>
          🛡️ Includes high-contrast student index watermark, automatic screen blur on window/tab switch, per-question countdown auto-advance, and anti-capture large-font layout requiring scrolling for options.
        </div>
        <label className="check"><input type="checkbox" checked={f.lockdown} onChange={set('lockdown')} />
          <span><strong>Strict lockdown mode</strong> — enforces full screen, disables copy/paste, and auto-logs all tab/window exits</span></label>
        {f.lockdown && (
          <label className="row-wrap small" style={{ gap: 8, paddingLeft: 28 }}>
            <span className="nowrap">Auto-submit after</span>
            <input className="input" type="number" min="0" style={{ width: 70, minHeight: 36 }} value={f.max_exits} onChange={set('max_exits')} />
            <span className="nowrap">exits <span className="muted">(0 = never)</span></span>
          </label>
        )}
        <label className="check"><input type="checkbox" checked={f.no_backtrack} onChange={set('no_backtrack')} /> No going back — each question locks once the student moves on</label>

        {/* ---------------- Stratified Format Quotas / Question Pool Section ---------------- */}
        <div className="card-soft stack-sm" style={{ padding: 12, border: '1px solid var(--line-2)' }}>
          <div className="between" style={{ alignItems: 'center' }}>
            <span className="small"><strong>🎯 Question Bank & Format Quotas</strong></span>
            <button
              type="button"
              className="chip"
              style={{ fontSize: 11, cursor: 'pointer', background: quotasOn ? 'var(--blue-50)' : undefined, borderColor: quotasOn ? 'var(--blue-ink)' : undefined }}
              onClick={() => { setQuotasOn(!quotasOn); setDirty(true); }}
            >
              {quotasOn ? '✓ Format Quotas Active' : '+ Set Quotas by Format'}
            </button>
          </div>

          {!quotasOn ? (
            <label className="row-wrap small" style={{ gap: 8 }}>
              <span className="nowrap">Give each student</span>
              <input className="input" type="number" min="1" style={{ width: 70, minHeight: 36 }} value={f.pool_size} onChange={set('pool_size')} placeholder="all" />
              random questions from the {count} in the bank
            </label>
          ) : (
            <div className="stack-sm" style={{ paddingTop: 4 }}>
              <p className="tiny muted" style={{ margin: 0 }}>
                Specify how many questions of each format each student gets from your bank.
              </p>
              <div className="stack-sm" style={{ gap: 6 }}>
                {Object.entries(FORMAT_LABELS).map(([k, label]) => {
                  const avail = formatCounts[k] || 0;
                  const qVal = quotas[k] ?? '';
                  const over = Number(qVal) > avail;
                  return (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '5px 8px', background: '#fff', borderRadius: 6, border: `1px solid ${over ? '#fca5a5' : 'var(--line-2)'}` }}>
                      <div>
                        <span className="small"><strong>{label}</strong></span>
                        <span className="tiny muted" style={{ marginLeft: 6 }}>({avail} in bank)</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="tiny muted">Draw:</span>
                        <input
                          className="input mono"
                          type="number"
                          min="0"
                          max={avail}
                          style={{ width: 55, minHeight: 28, padding: '2px 4px', textAlign: 'center', fontSize: 13, borderColor: over ? '#ef4444' : undefined }}
                          placeholder="0"
                          value={qVal}
                          onChange={(e) => {
                            setQuotas({ ...quotas, [k]: e.target.value });
                            setDirty(true);
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          style={{ padding: '2px 6px', fontSize: 10, minHeight: 26 }}
                          onClick={() => {
                            setQuotas({ ...quotas, [k]: String(avail) });
                            setDirty(true);
                          }}
                          title={`Draw all ${avail}`}
                        >
                          All
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="between" style={{ alignItems: 'center', paddingTop: 6, borderTop: '1px solid var(--line-2)' }}>
                <span className="small">Total drawn per student: <strong style={{ color: 'var(--teal-dark)' }}>{totalQuota}</strong> of {count}</span>
                <button type="button" className="btn btn-sm btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setShowSqlModal(true)}>
                  <Icon name="code" size={13} /> View SQL Function
                </button>
              </div>
            </div>
          )}
        </div>

        <label className="check"><input type="checkbox" checked={f.shuffle_questions} onChange={set('shuffle_questions')} /> Shuffle question order for each student</label>
        <label className="check"><input type="checkbox" checked={f.shuffle_options} onChange={set('shuffle_options')} /> Shuffle multiple-choice options</label>
        <label className="check"><input type="checkbox" checked={f.is_practice} onChange={set('is_practice')} /> Practice quiz — unlimited attempts, score shown straight away, not in grades</label>
      </div>

      <div className="stack-sm" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 14 }}>
        <label className="check"><input type="checkbox" checked={f.published} onChange={set('published')} /> <span><strong>Published</strong> — students can see it (and take it when open)</span></label>
        <label className="check"><input type="checkbox" checked={f.results_released} onChange={set('results_released')} /> <span><strong>Results released</strong> — students see their score</span></label>
        <label className="check"><input type="checkbox" checked={f.show_answers} onChange={set('show_answers')} disabled={!f.results_released} /> Also show correct answers and explanations</label>
      </div>

      <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => act(save, 'Settings saved.')}>Save settings</button>

      {showSqlModal && (
        <Modal title="Supabase Database Function for Stratified Quotas" onClose={() => setShowSqlModal(false)} wide>
          <p className="small muted">
            To enforce exact per-format stratified draws on your database, copy this SQL snippet and run it once in your <strong>Supabase Dashboard → SQL Editor</strong>:
          </p>
          <pre className="mono small" style={{ maxHeight: 240, overflowY: 'auto', padding: 12, background: 'var(--surface-2)', borderRadius: 8, fontSize: 11 }}>
            {STRATIFIED_SQL_SNIPPET}
          </pre>
          <div className="between" style={{ alignItems: 'center', marginTop: 12 }}>
            <span className="tiny muted">Updated function is backward-compatible with all standard quizzes.</span>
            <button type="button" className="btn btn-primary" onClick={copySql}>
              {copiedSql ? '✓ Copied to Clipboard!' : 'Copy SQL to Clipboard'}
            </button>
          </div>
        </Modal>
      )}
    </aside>
  );
}


// ---------------- Universal Question Importer (Word, Excel, Text) ----------------
export function UniversalImportModal({ quizId, start, onClose, onDone }) {
  const [tab, setTab] = useState('upload'); // 'upload' | 'paste'
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [marks, setMarks] = useState(1);
  const [topic, setTopic] = useState('');
  const [parsed, setParsed] = useState([]);
  const [act, busy] = useAction();
  const fileInputRef = useRef(null);

  // Parse text whenever text, marks, or topic changes in paste tab
  useEffect(() => {
    if (tab === 'paste') {
      const res = parseQuestionsFromText(text, marks, topic);
      setParsed(res);
    }
  }, [tab, text, marks, topic]);

  async function handleFileSelect(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setFileLoading(true);
    setFileError('');
    try {
      const res = await parseQuestionsFromFile(f, marks, topic);
      setParsed(res);
      if (res.length === 0) {
        setFileError('No recognizable questions found in this file. Please check format indicators or try our template.');
      }
    } catch (err) {
      setFileError(err.message || 'Could not parse questions from file.');
      setParsed([]);
    } finally {
      setFileLoading(false);
    }
  }

  const validQuestions = useMemo(() => parsed.filter((q) => q.valid), [parsed]);
  const invalidQuestions = useMemo(() => parsed.filter((q) => !q.valid), [parsed]);

  const counts = useMemo(() => {
    const c = { mcq: 0, truefalse: 0, numeric: 0, short: 0, essay: 0 };
    for (const q of validQuestions) {
      if (c[q.kind] !== undefined) c[q.kind]++;
    }
    return c;
  }, [validQuestions]);

  const totalMarks = useMemo(() => {
    return validQuestions.reduce((sum, q) => sum + (Number(q.marks) || 1), 0);
  }, [validQuestions]);

  async function save() {
    if (!validQuestions.length) return;
    const rows = validQuestions.map((q, i) => ({
      quiz_id: quizId,
      kind: q.kind,
      position: start + i,
      prompt: q.prompt,
      marks: Number(q.marks) || 1,
      topic: (q.topic || topic || '').trim(),
      explanation: q.explanation || '',
      options: q.options || [],
      answer: q.answer || {},
      params: {},
      formula: null,
      unit: q.unit || '',
      decimals: q.decimals || 2,
      tolerance: q.tolerance || 0,
      tolerance_type: 'abs',
    }));

    const ok = await act(
      () => run(supabase.from('questions').insert(rows)),
      `${rows.length} questions imported successfully.`
    );
    if (ok !== undefined) {
      onDone();
      onClose();
    }
  }

  const kindBadgeClass = (k) => {
    switch (k) {
      case 'mcq': return 'badge badge-teal';
      case 'truefalse': return 'badge badge-purple';
      case 'numeric': return 'badge badge-amber';
      case 'short': return 'badge badge-green';
      case 'essay': return 'badge badge-indigo';
      default: return 'badge';
    }
  };

  return (
    <Modal
      title="Import / Paste Questions (Word, Excel, or Text)"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={save}
            disabled={busy || fileLoading || !validQuestions.length}
          >
            {busy ? 'Importing…' : `Import ${validQuestions.length} question${validQuestions.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--line-2)', paddingBottom: 12 }}>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'upload' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('upload')}
        >
          <Icon name="upload" size={16} /> 📁 Upload File (.docx, .xlsx, .csv)
        </button>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'paste' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('paste')}
        >
          <Icon name="clipboard" size={16} /> 📋 Paste from Document or Excel
        </button>
      </div>

      {/* Template Download Helpers */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
          padding: '8px 12px',
          background: 'rgba(13, 148, 136, 0.05)',
          borderRadius: 8,
          marginBottom: 16,
          border: '1px dashed var(--teal-ink, #0f766e)',
        }}
      >
        <div style={{ fontSize: 12, color: 'var(--teal-900, #134e4a)' }}>
          <strong>💡 Need a ready-to-use template?</strong> Download our sample files to see format indicators & column layouts:
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ fontSize: 11, padding: '3px 8px' }}
            onClick={downloadSampleExcel}
          >
            📥 Excel Template (.xlsx)
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ fontSize: 11, padding: '3px 8px' }}
            onClick={downloadSampleWord}
          >
            📥 Word / Text Guide (.txt)
          </button>
        </div>
      </div>

      {/* Tab 1: Upload File */}
      {tab === 'upload' && (
        <div className="stack" style={{ gap: 12, marginBottom: 16 }}>
          <div
            style={{
              border: '2px dashed var(--line-2, #cbd5e1)',
              borderRadius: 10,
              padding: '24px 16px',
              textAlign: 'center',
              background: '#f8fafc',
              cursor: 'pointer',
              transition: 'border 0.2s',
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.xlsx,.xls,.csv,.txt"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <Icon name="upload" size={32} style={{ color: 'var(--teal-ink, #0f766e)', marginBottom: 8 }} />
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {file ? file.name : 'Click to select Word (.docx), Excel (.xlsx), CSV, or Text file'}
            </div>
            <p className="tiny muted" style={{ marginTop: 4 }}>
              Supports Microsoft Word (.docx), Excel spreadsheets (.xlsx, .csv), and text. Question formats are sorted automatically.
            </p>
            {file && (
              <span className="badge badge-teal" style={{ marginTop: 6 }}>
                Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </span>
            )}
          </div>

          {fileLoading && (
            <div className="notice notice-info small">
              Analyzing file & detecting question formats…
            </div>
          )}

          {fileError && (
            <div className="notice notice-error small">
              {fileError}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Paste */}
      {tab === 'paste' && (
        <div className="stack" style={{ gap: 10, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="small muted">
              Paste questions below. Use indicators like <span className="mono">[MCQ]</span>, <span className="mono">[True/False]</span>, <span className="mono">[Short Answer]</span>, <span className="mono">[Calculation]</span>, or <span className="mono">[Essay]</span>.
            </span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ fontSize: 11 }}
              onClick={() => setText(SAMPLE_PASTE_TEXT)}
            >
              ✨ Insert Sample Questions
            </button>
          </div>

          <textarea
            className="textarea mono"
            style={{ minHeight: 200, fontSize: 12, lineHeight: 1.5 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`[MCQ]\n1. Which inventory cost rises when order quantity increases?\nA) Ordering cost\nB) Holding cost *\nC) Stockout cost\nD) Purchase price\n[Marks: 1]\n\n[True/False]\n2. Cross-docking eliminates inventory storage.\nAnswer: True\n[Marks: 1]\n\n[Short Answer]\n3. What does the acronym EOQ stand for?\nAnswer: Economic Order Quantity\n[Marks: 2]\n\n[Calculation]\n4. Calculate EOQ: Demand = 10000, Order Cost = 50, Holding Cost = 2.\nAnswer: 707.1\n[Marks: 3]\n\n[Essay]\n5. Critically analyze supply chain visibility and the bullwhip effect.\n[Marks: 5]`}
          />
        </div>
      )}

      {/* Global Fallback Settings */}
      <div className="row-wrap" style={{ gap: 12, padding: '10px 12px', background: 'var(--panel)', borderRadius: 8, marginBottom: 16 }}>
        <label className="row small" style={{ gap: 6 }}>
          <span>Fallback Marks each:</span>
          <input
            className="input"
            type="number"
            min="0"
            step="0.5"
            style={{ width: 70, minHeight: 32 }}
            value={marks}
            onChange={(e) => setMarks(e.target.value)}
          />
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <span>Fallback Topic:</span>
          <input
            className="input"
            style={{ width: 140, minHeight: 32 }}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="optional"
          />
        </label>
      </div>

      {/* Live Breakdown and Preview */}
      {parsed.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span className="small">
              <strong>{validQuestions.length} question{validQuestions.length === 1 ? '' : 's'} detected</strong> ({totalMarks} total marks):
            </span>
            <div className="row-wrap" style={{ gap: 4 }}>
              {counts.mcq > 0 && <span className="badge badge-teal">{counts.mcq} MCQ</span>}
              {counts.truefalse > 0 && <span className="badge badge-purple">{counts.truefalse} True/False</span>}
              {counts.short > 0 && <span className="badge badge-green">{counts.short} Short Answer</span>}
              {counts.numeric > 0 && <span className="badge badge-amber">{counts.numeric} Calculation</span>}
              {counts.essay > 0 && <span className="badge badge-indigo">{counts.essay} Written Essay</span>}
              {invalidQuestions.length > 0 && (
                <span className="badge badge-red">{invalidQuestions.length} skipped (errors)</span>
              )}
            </div>
          </div>

          {/* Scrollable Preview List */}
          <div
            style={{
              maxHeight: 220,
              overflowY: 'auto',
              border: '1px solid var(--line-2)',
              borderRadius: 8,
              padding: '6px 8px',
              background: '#fff',
            }}
          >
            {parsed.map((q, idx) => (
              <div
                key={idx}
                style={{
                  padding: '6px 8px',
                  borderBottom: idx < parsed.length - 1 ? '1px solid #f1f5f9' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 12,
                  opacity: q.valid ? 1 : 0.6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                  <span className={kindBadgeClass(q.kind)} style={{ fontSize: 10, padding: '2px 6px' }}>
                    {KIND_LABELS[q.kind] || q.kind}
                  </span>
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', flex: 1 }}>
                    {q.prompt}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {q.kind === 'mcq' && (
                    <span className="tiny muted">
                      {q.options?.length} opts · Key: {q.answer?.correct?.toUpperCase() || '-'}
                    </span>
                  )}
                  {q.kind === 'truefalse' && (
                    <span className="tiny muted">
                      Key: {q.answer?.correct === 'true' ? 'True' : 'False'}
                    </span>
                  )}
                  {q.kind === 'numeric' && (
                    <span className="tiny muted">
                      Val: {q.answer?.value} {q.unit || ''}
                    </span>
                  )}
                  {q.kind === 'short' && (
                    <span className="tiny muted">
                      Ans: {q.answer?.accepted?.[0]}
                    </span>
                  )}
                  <span className="badge" style={{ fontSize: 10 }}>
                    {q.marks} mk{Number(q.marks) === 1 ? '' : 's'}
                  </span>
                  {!q.valid && (
                    <span className="badge badge-red" title={q.errors.join(', ')} style={{ fontSize: 10 }}>
                      ⚠️ Error
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
