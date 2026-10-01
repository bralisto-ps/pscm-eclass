import { useMemo, useState } from 'react';
import { run, supabase } from '../../../lib/supabase.js';
import { fmtNumber } from '../../../lib/format.js';
import Icon from '../../../components/Icon.jsx';
import { Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad } from '../../../components/ui.jsx';

const KIND = { mcq: 'Multiple choice', truefalse: 'True / false', numeric: 'Calculation', short: 'Short answer', essay: 'Written' };
const COPY_FIELDS = ['kind', 'prompt', 'options', 'answer', 'params', 'formula', 'unit', 'decimals', 'tolerance', 'tolerance_type', 'marks', 'explanation', 'topic'];

export default function QuestionBank({ course }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [questions, quizzes] = await Promise.all([
      run(supabase.from('questions').select(`id, quiz_id, position, ${COPY_FIELDS.join(', ')}, quizzes!inner(id, title, course_id)`)
        .eq('quizzes.course_id', course.id).order('created_at')),
      run(supabase.from('quizzes').select('id, title, created_at').eq('course_id', course.id).order('created_at', { ascending: false })),
    ]);
    return { questions, quizzes };
  }, [course.id]);
  const [topic, setTopic] = useState('*');
  const [kind, setKind] = useState('*');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [copying, setCopying] = useState(false);
  const [random, setRandom] = useState(false);
  const [tagging, setTagging] = useState(false);

  const topics = useMemo(() => {
    const m = new Map();
    (data?.questions || []).forEach((x) => m.set(x.topic || '', (m.get(x.topic || '') || 0) + 1));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);
  const shown = useMemo(() => (data?.questions || []).filter((x) =>
    (topic === '*' || (x.topic || '') === topic) && (kind === '*' || x.kind === kind)
    && (!q.trim() || x.prompt.toLowerCase().includes(q.toLowerCase()))), [data, topic, kind, q]);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  const allSel = shown.length > 0 && shown.every((x) => sel.has(x.id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <p className="small muted" style={{ maxWidth: 720 }}>
        Every question from every quiz in {course.code}, in one place. Give questions a topic (in the quiz builder, or tick them here and
        use <strong>Set topic</strong>), then copy chosen questions into a new quiz or draw a random set from a topic.
      </p>
      <div className="chips" role="group" aria-label="Topics">
        <button type="button" className="chip" aria-pressed={topic === '*'} onClick={() => setTopic('*')}>All topics · {data.questions.length}</button>
        {topics.map(([t, n]) => (
          <button key={t || '_none'} type="button" className="chip" aria-pressed={topic === t} onClick={() => setTopic(t)}>{t || 'No topic'} · {n}</button>
        ))}
      </div>
      <section className="card-flush">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="row-wrap">
            <label className="search">
              <span className="sr-only">Search questions</span>
              <Icon name="search" size={16} />
              <input className="input" style={{ width: 240, minHeight: 40 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search question text" />
            </label>
            <select className="select" aria-label="Question type" style={{ width: 'auto', minHeight: 40 }} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="*">All types</option>
              {Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="row-wrap">
            <button type="button" className="btn btn-sm" onClick={() => setRandom(true)} disabled={!data.questions.length}>Add random set to a quiz…</button>
          </div>
        </div>
        {sel.size > 0 && (
          <div className="row-wrap" style={{ padding: '10px 18px', background: 'var(--teal-50)', borderBottom: '1px solid var(--line-2)' }}>
            <strong className="small">{sel.size} selected</strong>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setCopying(true)}>Copy to a quiz…</button>
            <button type="button" className="btn btn-sm" onClick={() => setTagging(true)}>Set topic…</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>Clear</button>
          </div>
        )}
        {shown.length === 0 ? <Empty icon="quiz">No questions match.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all shown" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(shown.map((x) => x.id)))} style={{ width: 18, height: 18, accentColor: 'var(--teal)' }} /></th>
                <th>Question</th><th>Type</th><th>Topic</th><th>From quiz</th><th className="num">Marks</th>
              </tr></thead>
              <tbody>
                {shown.slice(0, 500).map((x) => (
                  <tr key={x.id} style={sel.has(x.id) ? { background: 'var(--teal-50)' } : undefined}>
                    <td><input type="checkbox" aria-label="Select question" checked={sel.has(x.id)} onChange={() => toggle(x.id)} style={{ width: 18, height: 18, accentColor: 'var(--teal)' }} /></td>
                    <td style={{ maxWidth: 460 }}><span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{x.prompt}</span></td>
                    <td className="small nowrap">{KIND[x.kind]}{x.formula ? ' · unique' : ''}</td>
                    <td className="small">{x.topic || <span className="muted">—</span>}</td>
                    <td className="small muted">{x.quizzes.title}</td>
                    <td className="num">{fmtNumber(x.marks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {copying && <CopyModal courseId={course.id} quizzes={data.quizzes} questions={data.questions.filter((x) => sel.has(x.id))} onClose={() => setCopying(false)} onDone={() => { setCopying(false); setSel(new Set()); reload(); }} />}
      {random && <RandomModal courseId={course.id} quizzes={data.quizzes} questions={data.questions} topics={topics} onClose={() => setRandom(false)} onDone={() => { setRandom(false); reload(); }} />}
      {tagging && <TopicModal ids={[...sel]} topics={topics.map(([t]) => t).filter(Boolean)} onClose={() => setTagging(false)} onDone={() => { setTagging(false); setSel(new Set()); reload(); }} />}
    </div>
  );
}

async function copyInto(quizId, list) {
  const last = await run(supabase.from('questions').select('position').eq('quiz_id', quizId).order('position', { ascending: false }).limit(1));
  const start = (last[0]?.position ?? 0) + 1;
  const rows = list.map((x, i) => {
    const r = { quiz_id: quizId, position: start + i };
    COPY_FIELDS.forEach((f) => { r[f] = x[f]; });
    return r;
  });
  await run(supabase.from('questions').insert(rows));
  return rows.length;
}

function QuizSelect({ quizzes, value, onChange }) {
  return (
    <Field label="Into which quiz?">
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a quiz…</option>
        <option value="__new">+ A new draft quiz</option>
        {quizzes.map((z) => <option key={z.id} value={z.id}>{z.title}</option>)}
      </select>
    </Field>
  );
}

async function resolveQuiz(target, courseId, title) {
  if (target !== '__new') return target;
  const z = await run(supabase.from('quizzes').insert({ course_id: courseId, title: title || 'New quiz from question bank', duration_minutes: 30 }).select().single());
  return z.id;
}

function CopyModal({ courseId, quizzes, questions, onClose, onDone }) {
  const [act, busy] = useAction();
  const [target, setTarget] = useState('');
  async function go() {
    const n = await act(async () => copyInto(await resolveQuiz(target, courseId), questions), `${questions.length} questions copied.`);
    if (n) onDone();
  }
  return (
    <Modal title={`Copy ${questions.length} question${questions.length === 1 ? '' : 's'}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy || !target} onClick={go}>Copy</button></>}>
      <QuizSelect quizzes={quizzes} value={target} onChange={setTarget} />
      <p className="small muted">Copies are independent — editing them won't change the originals.</p>
    </Modal>
  );
}

function RandomModal({ courseId, quizzes, questions, topics, onClose, onDone }) {
  const [act, busy] = useAction();
  const [plan, setPlan] = useState(() => Object.fromEntries(topics.map(([t]) => [t, 0])));
  const [target, setTarget] = useState('');
  const total = Object.values(plan).reduce((s, n) => s + (Number(n) || 0), 0);
  async function go() {
    const picked = [];
    for (const [t, n] of Object.entries(plan)) {
      const pool = questions.filter((x) => (x.topic || '') === t).sort(() => Math.random() - 0.5);
      picked.push(...pool.slice(0, Number(n) || 0));
    }
    const ok = await act(async () => copyInto(await resolveQuiz(target, courseId), picked), `${picked.length} questions added.`);
    if (ok) onDone();
  }
  return (
    <Modal title="Add a random set of questions" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy || !target || !total} onClick={go}>Add {total}</button></>}>
      <p className="small muted">Choose how many questions to draw from each topic.</p>
      <div className="stack-sm">
        {topics.map(([t, n]) => (
          <div key={t || '_none'} className="between">
            <span>{t || 'No topic'} <span className="muted small">· {n} available</span></span>
            <input className="input mono" type="number" min="0" max={n} style={{ width: 90, minHeight: 38 }} value={plan[t]}
              onChange={(e) => setPlan({ ...plan, [t]: Math.min(n, Math.max(0, Number(e.target.value) || 0)) })} aria-label={`Number from ${t || 'no topic'}`} />
          </div>
        ))}
      </div>
      <QuizSelect quizzes={quizzes} value={target} onChange={setTarget} />
    </Modal>
  );
}

function TopicModal({ ids, topics, onClose, onDone }) {
  const [act, busy] = useAction();
  const [t, setT] = useState('');
  async function go() {
    const ok = await act(() => run(supabase.from('questions').update({ topic: t.trim() }).in('id', ids)), 'Topic set.');
    if (ok !== undefined) onDone();
  }
  return (
    <Modal title={`Set topic for ${ids.length} question${ids.length === 1 ? '' : 's'}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={go}>Save</button></>}>
      <Field label="Topic" hint="leave empty to clear">
        <input className="input" list="topic-list" autoFocus value={t} onChange={(e) => setT(e.target.value)} placeholder="e.g. EOQ and inventory" />
        <datalist id="topic-list">{topics.map((x) => <option key={x} value={x} />)}</datalist>
      </Field>
    </Modal>
  );
}
