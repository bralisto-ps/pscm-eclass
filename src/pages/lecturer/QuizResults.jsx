import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rpc, rpcAll, run, supabase } from '../../lib/supabase.js';
import { fmtFull, fmtNumber, pct } from '../../lib/format.js';
import { downloadExcel } from '../../lib/sheets.js';
import Icon from '../../components/Icon.jsx';
import { Topbar } from '../../components/Layout.jsx';
import { Confirm, Empty, ErrorNote, Loading, Tabs, useAction, useLoad, useToast } from '../../components/ui.jsx';

const BINS = [
  { label: '0–39%', lo: 0, hi: 39.999, color: 'var(--amber)' },
  { label: '40–49%', lo: 40, hi: 49.999 },
  { label: '50–59%', lo: 50, hi: 59.999 },
  { label: '60–69%', lo: 60, hi: 69.999 },
  { label: '70–79%', lo: 70, hi: 79.999 },
  { label: '80–100%', lo: 80, hi: 100 },
];

const STATUS = {
  marked: ['Marked', 'badge-teal'],
  needs_marking: ['Needs marking', 'badge-amber'],
  in_progress: ['In progress', 'badge-blue'],
  not_started: ['Not submitted', ''],
  not_activated: ['No account', ''],
};

export default function QuizResults() {
  const { quizId } = useParams();
  const [tab, setTab] = useState('gradebook');
  const { data, error, loading, reload, setData } = useLoad(async () => {
    const quiz = await run(supabase.from('quizzes').select('*, courses(id, code, title)').eq('id', quizId).single());
    const [rows, queue] = await Promise.all([rpcAll('quiz_gradebook', { p_quiz: quizId }), rpcAll('marking_queue', { p_quiz: quizId })]);
    return { quiz, rows, queue };
  }, [quizId]);
  const [act, busy] = useAction();

  if (loading) return <Loading label="Collecting results…" />;
  if (error) return <div className="page"><ErrorNote error={error} onRetry={reload} /></div>;

  const { quiz, rows, queue } = data;
  const pending = queue.filter((r) => r.marks_awarded === null).length;

  async function toggleRelease() {
    const next = !quiz.results_released;
    const ok = await act(
      () => run(supabase.from('quizzes').update({ results_released: next }).eq('id', quiz.id)),
      next ? 'Results released — students can now see their scores.' : 'Results hidden from students.',
    );
    if (ok !== undefined) setData((d) => ({ ...d, quiz: { ...d.quiz, results_released: next } }));
  }

  return (
    <>
      <Topbar title={quiz.title} sub={`${quiz.courses.code} · results`}>
        <Link to={`/teach/quiz/${quiz.id}`} className="btn"><Icon name="edit" /> Edit quiz</Link>
        <button type="button" className={`btn ${quiz.results_released ? '' : 'btn-primary'}`} onClick={toggleRelease} disabled={busy}>
          {quiz.results_released ? 'Hide results' : 'Release results'}
        </button>
      </Topbar>
      <div className="page stack">
        {quiz.results_released
          ? <div className="notice notice-info">Results are released. Students can see their scores{quiz.show_answers ? ' and the correct answers' : ''}.</div>
          : <div className="notice notice-warn">Results are hidden. Students only see "submitted" until you release them.</div>}
        <Tabs tabs={[{ id: 'gradebook', label: 'Gradebook' }, { id: 'marking', label: 'Written answers', count: pending }]} value={tab}
          onChange={(t) => { setTab(t); if (t === 'gradebook') reload(); }} />
        {tab === 'gradebook'
          ? <Gradebook quiz={quiz} rows={rows} reload={reload} />
          : <Marking queue={queue} onMarked={(id, marks, feedback) => setData((d) => ({ ...d, queue: d.queue.map((r) => (r.response_id === id ? { ...r, marks_awarded: marks, feedback } : r)) }))} reload={reload} />}
      </div>
    </>
  );
}

function Gradebook({ quiz, rows, reload }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [retake, setRetake] = useState(null);
  const [act, busy] = useAction();

  const fastLimit = Math.max(2, quiz.duration_minutes * 0.2);
  const done = rows.filter((r) => r.status === 'marked' || r.status === 'needs_marking');
  const withPct = done.map((r) => ({ ...r, p: pct(r.score, r.max_score) })).filter((r) => r.p !== null);
  const avg = withPct.length ? Math.round(withPct.reduce((s, r) => s + r.p, 0) / withPct.length) : null;
  const fast = done.filter((r) => r.minutes_used !== null && Number(r.minutes_used) < fastLimit);
  const counts = BINS.map((b) => withPct.filter((r) => r.p >= b.lo && r.p <= b.hi).length);
  const maxCount = Math.max(1, ...counts);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'marking' && r.status !== 'needs_marking') return false;
      if (filter === 'missing' && (r.status === 'marked' || r.status === 'needs_marking')) return false;
      if (filter === 'fast' && !(r.minutes_used !== null && Number(r.minutes_used) < fastLimit && r.submitted_at)) return false;
      return !term || r.full_name.toLowerCase().includes(term) || r.index_no.toLowerCase().includes(term);
    });
  }, [rows, filter, q, fastLimit]);

  function exportXlsx() {
    downloadExcel(`${quiz.courses.code} - ${quiz.title}.xlsx`, [
      ['Index number', 'Name', 'Status', 'Auto-marked', 'Written', 'Total', 'Out of', 'Percent', 'Minutes used', 'Submitted', 'Attempts'],
      ...rows.map((r) => [
        r.index_no, r.full_name, (STATUS[r.status] || [r.status])[0],
        r.auto_score !== null ? Number(r.auto_score) : '', r.manual_score !== null ? Number(r.manual_score) : '',
        r.score !== null ? Number(r.score) : '', r.max_score !== null ? Number(r.max_score) : '',
        pct(r.score, r.max_score) ?? '', r.minutes_used !== null ? Number(r.minutes_used) : '',
        r.submitted_at ? fmtFull(r.submitted_at) : '', r.attempts_used,
      ]),
    ], [16, 30, 16, 12, 10, 10, 10, 10, 12, 22, 10]);
  }

  async function allowRetake() {
    await act(() => run(supabase.from('attempts').delete().eq('quiz_id', quiz.id).eq('student_id', retake.student_id)),
      `${retake.full_name} can now take the quiz again.`);
    setRetake(null);
    reload();
  }

  return (
    <div className="stack-lg">
      <div className="two-col" style={{ gridTemplateColumns: '440px minmax(0,1fr)' }}>
        <div className="grid-2">
          <div className="kpi"><span className="l">Submitted</span><span className="v">{done.length}</span><span className="tiny muted">of {rows.length} enrolled</span></div>
          <div className="kpi"><span className="l">Class average</span><span className="v">{avg === null ? '—' : `${avg}%`}</span><span className="tiny muted">of submitted work</span></div>
          <div className="kpi"><span className="l">Needs marking</span><span className="v" style={{ color: 'var(--amber-ink)' }}>{rows.filter((r) => r.status === 'needs_marking').length}</span><span className="tiny muted">written answers pending</span></div>
          <div className="kpi"><span className="l">Very fast finishers</span><span className="v" style={{ color: fast.length ? 'var(--red-ink)' : undefined }}>{fast.length}</span><span className="tiny muted">under {fmtNumber(fastLimit, 1)} min</span></div>
        </div>
        <section className="card stack-sm" aria-label="Score distribution">
          <div className="between"><h2>Score distribution</h2><span className="tiny muted">students per score band</span></div>
          <div className="dist">
            {counts.map((c, i) => (
              <div key={BINS[i].label} className="dist-col">
                <span className="mono tiny">{c}</span>
                <div className="dist-bar" style={{ height: `${(c / maxCount) * 88}px`, background: BINS[i].color || 'var(--teal)' }} />
              </div>
            ))}
          </div>
          <div className="dist-labels">{BINS.map((b) => <span key={b.label}>{b.label}</span>)}</div>
        </section>
      </div>

      <section className="card-flush">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="row-wrap">
            <label className="search">
              <span className="sr-only">Search</span>
              <Icon name="search" size={16} />
              <input className="input" style={{ width: 230, minHeight: 40 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or index number" />
            </label>
            <div className="chips" role="group" aria-label="Filter">
              {[['all', `All · ${rows.length}`], ['marking', 'Needs marking'], ['missing', 'Not submitted'], ['fast', 'Very fast']].map(([id, label]) => (
                <button key={id} type="button" className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
              ))}
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={exportXlsx}><Icon name="download" size={16} /> Export to Excel</button>
        </div>
        {rows.length === 0 ? <Empty icon="users" title="No students on this course yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Index no.</th><th>Student</th><th className="num">Auto</th><th className="num">Written</th><th className="num">Total</th><th className="num">%</th><th className="num hide-sm">Time</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {shown.slice(0, 400).map((r) => {
                  const [label, cls] = STATUS[r.status] || [r.status, ''];
                  const p = pct(r.score, r.max_score);
                  return (
                    <tr key={r.index_no}>
                      <td className="mono small">{r.index_no}</td>
                      <td>{r.full_name}{r.attempts_used > 1 ? <span className="tiny muted"> · {r.attempts_used} attempts</span> : null}</td>
                      <td className="num">{r.auto_score !== null && r.attempt_id && r.status !== 'in_progress' ? fmtNumber(r.auto_score) : '—'}</td>
                      <td className="num">{r.manual_score !== null ? fmtNumber(r.manual_score) : '—'}</td>
                      <td className="num strong">{r.score !== null ? `${fmtNumber(r.score)} / ${fmtNumber(r.max_score)}` : '—'}</td>
                      <td className="num">{p !== null ? `${p}%` : '—'}</td>
                      <td className="num hide-sm">{r.minutes_used !== null ? `${fmtNumber(r.minutes_used, 1)}m` : '—'}</td>
                      <td><span className={`badge ${cls}`}>{label}</span></td>
                      <td>{r.attempts_used > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRetake(r)}>Allow retake</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length > 400 && <p className="small muted" style={{ padding: '12px 18px' }}>Showing 400 of {shown.length}. Search, or export to Excel for the full list.</p>}
            {shown.length === 0 && <Empty>No students match.</Empty>}
          </div>
        )}
      </section>

      {retake && (
        <Confirm title="Allow a retake?" danger confirmLabel="Delete attempt and allow retake" busy={busy}
          message={`${retake.full_name}'s attempt${retake.attempts_used > 1 ? 's' : ''} and score will be deleted so they can take the quiz again (while it is open).`}
          onClose={() => setRetake(null)} onConfirm={allowRetake} />
      )}
    </div>
  );
}

function Marking({ queue, onMarked }) {
  const questions = useMemo(() => {
    const m = new Map();
    queue.forEach((r) => {
      if (!m.has(r.question_id)) m.set(r.question_id, { id: r.question_id, prompt: r.prompt, max: r.max_marks, guide: r.model_answer, items: [] });
      m.get(r.question_id).items.push(r);
    });
    return [...m.values()];
  }, [queue]);
  const [selected, setSelected] = useState(questions[0]?.id);
  const [onlyPending, setOnlyPending] = useState(true);

  if (!questions.length) return <div className="card"><Empty icon="edit" title="No written answers">This quiz has no written-answer questions, or nobody has submitted yet.</Empty></div>;

  const current = questions.find((x) => x.id === selected) || questions[0];
  const items = current.items.filter((r) => !onlyPending || r.marks_awarded === null);
  const markedCount = current.items.filter((r) => r.marks_awarded !== null).length;

  return (
    <div className="two-col" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
      <main className="stack">
        <div className="between" style={{ flexWrap: 'wrap' }}>
          <span className="small muted">{markedCount} of {current.items.length} marked for this question</span>
          <label className="check small"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Show only unmarked</label>
        </div>
        {items.length === 0 && <div className="card"><Empty icon="check" title="All marked">Every answer to this question has marks.</Empty></div>}
        {items.slice(0, 50).map((r) => <MarkCard key={r.response_id} r={r} onMarked={onMarked} />)}
        {items.length > 50 && <p className="small muted">Showing 50 at a time — marked answers disappear from this list as you go.</p>}
      </main>
      <aside className="stack" style={{ position: 'sticky', top: 90, alignSelf: 'start' }}>
        {questions.length > 1 && (
          <div className="card-flush">
            {questions.map((x, i) => {
              const left = x.items.filter((r) => r.marks_awarded === null).length;
              return (
                <button key={x.id} type="button" className="list-row" onClick={() => setSelected(x.id)}
                  style={{ background: x.id === current.id ? 'var(--teal-50)' : undefined }}>
                  <span className="list-main"><span className="title small">Written question {i + 1}</span><span className="tiny muted">{x.prompt.slice(0, 60)}…</span></span>
                  {left > 0 ? <span className="badge badge-amber">{left}</span> : <span className="badge badge-teal">Done</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="card stack-sm">
          <span className="eyebrow">Question · {fmtNumber(current.max)} marks</span>
          <p className="pre small">{current.prompt}</p>
          {current.guide && (<><span className="eyebrow" style={{ marginTop: 8 }}>Your marking guide</span><p className="pre small" style={{ color: 'var(--text-2)' }}>{current.guide}</p></>)}
        </div>
      </aside>
    </div>
  );
}

function MarkCard({ r, onMarked }) {
  const toast = useToast();
  const [marks, setMarks] = useState(r.marks_awarded ?? '');
  const [feedback, setFeedback] = useState(r.feedback || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    const m = Number(marks);
    if (marks === '' || Number.isNaN(m)) return toast('Enter marks first.', 'error');
    setBusy(true);
    try {
      await rpc('mark_response', { p_response: r.response_id, p_marks: m, p_feedback: feedback });
      onMarked(r.response_id, m, feedback);
      toast(`Saved · ${r.full_name}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card stack-sm">
      <div className="between">
        <span className="strong">{r.full_name} <span className="mono tiny muted">{r.index_no}</span></span>
        {r.marks_awarded !== null && <span className="badge badge-teal">{fmtNumber(r.marks_awarded)} / {fmtNumber(r.max_marks)}</span>}
      </div>
      <p className="pre" style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: 8 }}>{r.answer || <span className="muted">No answer</span>}</p>
      <div className="row-wrap" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 120 }}>
          <span>Marks / {fmtNumber(r.max_marks)}</span>
          <input className="input mono" type="number" min="0" max={r.max_marks} step="0.5" value={marks} onChange={(e) => setMarks(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span>Feedback <span className="hint">· optional</span></span>
          <input className="input" value={feedback} onChange={(e) => setFeedback(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </label>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Save</button>
      </div>
    </article>
  );
}
