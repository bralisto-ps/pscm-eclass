import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { run, supabase } from '../../../lib/supabase.js';
import { fmtDateTime } from '../../../lib/format.js';
import Icon from '../../../components/Icon.jsx';
import { Confirm, Empty, ErrorNote, Loading, useAction, useLoad } from '../../../components/ui.jsx';
import QuestionBank from './QuestionBank.jsx';
import { shareWhatsApp } from '../../../lib/share.js';

export function quizStatus(q) {
  const now = Date.now();
  if (!q.published) return { label: 'Draft', cls: '' };
  if (q.opens_at && new Date(q.opens_at).getTime() > now) return { label: 'Scheduled', cls: 'badge-blue' };
  if (q.closes_at && new Date(q.closes_at).getTime() < now) return { label: 'Closed', cls: 'badge-plum' };
  return { label: 'Open now', cls: 'badge-teal' };
}

export default function QuizzesTab({ course, ta }) {
  const [view, setView] = useState('quizzes');
  if (ta) return <QuizList course={course} ta />;
  return (
    <div className="stack">
      <div className="chips" role="tablist" aria-label="Quizzes or question bank">
        <button type="button" className="chip" aria-pressed={view === 'quizzes'} onClick={() => setView('quizzes')}>Quizzes</button>
        <button type="button" className="chip" aria-pressed={view === 'bank'} onClick={() => setView('bank')}>Question bank</button>
      </div>
      {view === 'quizzes' ? <QuizList course={course} /> : <QuestionBank course={course} />}
    </div>
  );
}

function QuizList({ course, ta }) {
  const navigate = useNavigate();
  const [act, busy] = useAction();
  const [removing, setRemoving] = useState(null);
  const { data, error, loading, reload } = useLoad(
    () => run(supabase.from('quizzes').select(`*, ${ta ? '' : 'questions(count), '}attempts(count), quiz_windows(programme), quiz_access(count)`)
      .eq('course_id', course.id).order('created_at', { ascending: false })),
    [course.id],
  );

  async function create() {
    const q = await act(() =>
      run(supabase.from('quizzes').insert({ course_id: course.id, title: 'Untitled quiz', duration_minutes: 30 }).select().single()),
    );
    if (q) navigate(`/teach/quiz/${q.id}`);
  }

  async function duplicate(src) {
    const copy = await act(async () => {
      const { id, created_at, questions, attempts, quiz_windows, quiz_access, ...rest } = src;
      const q = await run(supabase.from('quizzes').insert({
        ...rest, title: `${src.title} (copy)`, published: false, results_released: false,
      }).select().single());
      const qs = await run(supabase.from('questions').select('*').eq('quiz_id', src.id));
      if (qs.length) {
        await run(supabase.from('questions').insert(qs.map(({ id: _i, created_at: _c, ...x }) => ({ ...x, quiz_id: q.id }))));
      }
      return q;
    }, 'Quiz copied as a draft.');
    if (copy) navigate(`/teach/quiz/${copy.id}`);
  }

  async function remove() {
    await act(() => run(supabase.from('quizzes').delete().eq('id', removing.id)), 'Quiz deleted.');
    setRemoving(null);
    reload();
  }

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  return (
    <div className="stack" style={{ maxWidth: 1040 }}>
      <div className="between" style={{ flexWrap: 'wrap' }}>
        <p className="small muted" style={{ maxWidth: 600 }}>
          {ta ? 'Open a quiz\'s results to see the gradebook and mark written answers.'
            : 'Quizzes are marked automatically. Calculation questions can give every student their own figures, so answers can\'t be copied.'}
        </p>
        {!ta && <button type="button" className="btn btn-primary" onClick={create} disabled={busy}><Icon name="plus" /> New quiz</button>}
      </div>

      {data.length === 0 ? (
        <div className="card"><Empty icon="quiz" title="No quizzes yet">Create a quiz, add questions, then publish it with an opening and closing time.</Empty></div>
      ) : (
        <div className="card-flush table-wrap">
          <table className="table">
            <thead>
              <tr><th>Quiz</th><th>Status</th><th>Window</th>{!ta && <th className="num">Questions</th>}<th className="num">Attempts</th><th /></tr>
            </thead>
            <tbody>
              {data.map((q) => {
                const st = quizStatus(q);
                const nWin = q.quiz_windows?.length || 0;
                const byClass = (q.quiz_windows || []).some((w) => w.programme !== '*');
                const winLabel = byClass ? 'Set per class' : 'Set per stream';
                const winSub = `${nWin} ${byClass ? 'class' : 'stream'}${nWin > 1 ? (byClass ? 'es' : 's') : ''}`;
                return (
                  <tr key={q.id}>
                    <td>
                      <Link to={`/teach/quiz/${q.id}${ta ? '/results' : ''}`} className="strong" style={{ color: 'var(--text)' }}>{q.title}</Link>
                      <div className="tiny muted">
                        {q.duration_minutes} min · {q.is_practice ? 'practice' : `${q.max_attempts} attempt${q.max_attempts > 1 ? 's' : ''}`}
                        {q.results_released ? ' · results released' : ''}
                        {q.lockdown ? ' · strict mode' : ''}
                      </div>
                    </td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td className="small nowrap">
                      {q.restricted ? `Only ${q.quiz_access?.[0]?.count ?? 0} student${q.quiz_access?.[0]?.count === 1 ? '' : 's'}`
                        : nWin ? winLabel : q.opens_at ? fmtDateTime(q.opens_at) : 'Any time'}
                      <div className="tiny muted">
                        {q.restricted ? 'special access only' : nWin ? winSub : q.closes_at ? `to ${fmtDateTime(q.closes_at)}` : 'no closing time'}
                        {!q.restricted && q.quiz_access?.[0]?.count ? ` · +${q.quiz_access[0].count} special` : ''}
                      </div>
                    </td>
                    {!ta && <td className="num">{q.questions?.[0]?.count ?? 0}</td>}
                    <td className="num">{q.attempts?.[0]?.count ?? 0}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <Link to={`/teach/quiz/${q.id}/results`} className="btn btn-sm">Results</Link>
                        {!ta && <Link to={`/teach/quiz/${q.id}`} className="btn btn-sm btn-ghost">Edit</Link>}
                        {q.published && <button type="button" className="icon-btn plain" title="Share on WhatsApp" aria-label="Share on WhatsApp"
                          onClick={() => shareWhatsApp(`*${course.code}: ${q.title}*\n${q.opens_at ? `Opens ${fmtDateTime(q.opens_at)}` : 'Open now'}${q.closes_at ? `, closes ${fmtDateTime(q.closes_at)}` : ''} · ${q.duration_minutes} minutes`)}>
                          <Icon name="megaphone" /></button>}
                        {!ta && <button type="button" className="icon-btn plain" title="Duplicate" aria-label="Duplicate quiz" onClick={() => duplicate(q)} disabled={busy}><Icon name="file" /></button>}
                        {!ta && <button type="button" className="icon-btn plain" title="Delete" aria-label="Delete quiz" onClick={() => setRemoving(q)}><Icon name="trash" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {removing && (
        <Confirm
          title="Delete this quiz?"
          message={`"${removing.title}" and all ${removing.attempts?.[0]?.count ?? 0} student attempts and scores will be deleted permanently.`}
          danger confirmLabel="Delete quiz" busy={busy}
          onClose={() => setRemoving(null)} onConfirm={remove}
        />
      )}
    </div>
  );
}
