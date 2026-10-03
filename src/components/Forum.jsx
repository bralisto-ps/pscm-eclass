import { useMemo, useState } from 'react';
import { rpc, run, supabase } from '../lib/supabase.js';
import { relative } from '../lib/format.js';
import Icon from './Icon.jsx';
import { Confirm, Empty, ErrorNote, Loading, useAction, useLoad } from './ui.jsx';

// Course Q&A board. Students post (anonymous to classmates by default) and upvote;
// the lecturer answers, hides or deletes.
export default function Forum({ course, lecturer, canDelete = true }) {
  const { data, error, loading, reload, setData } = useLoad(() => rpc('forum_list', { p_course: course.id }), [course.id]);
  const [sort, setSort] = useState('top');
  const [show, setShow] = useState('all');
  const [body, setBody] = useState('');
  const [anon, setAnon] = useState(true);
  const [answering, setAnswering] = useState(null);
  const [answer, setAnswer] = useState('');
  const [removing, setRemoving] = useState(null);
  const [act, busy] = useAction();

  const posts = useMemo(() => {
    let list = [...(data || [])];
    if (show === 'open') list = list.filter((p) => !p.answer);
    if (show === 'answered') list = list.filter((p) => p.answer);
    if (show === 'mine') list = list.filter((p) => p.mine);
    list.sort((a, b) => (sort === 'top' ? b.votes - a.votes || new Date(b.created_at) - new Date(a.created_at) : new Date(b.created_at) - new Date(a.created_at)));
    return list;
  }, [data, sort, show]);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  async function post(e) {
    e.preventDefault();
    const ok = await act(() => rpc('forum_post', { p_course: course.id, p_body: body, p_anonymous: anon }), 'Question posted.');
    if (ok) { setBody(''); reload(); }
  }
  async function vote(p) {
    const on = await act(() => rpc('forum_vote', { p_post: p.id }));
    if (on === undefined) return;
    setData((list) => list.map((x) => (x.id === p.id ? { ...x, voted: on, votes: x.votes + (on ? 1 : -1) } : x)));
  }
  async function saveAnswer(p) {
    const ok = await act(() => rpc('forum_answer', { p_post: p.id, p_answer: answer }), 'Answer saved.');
    if (ok !== undefined) { setAnswering(null); reload(); }
  }
  async function hide(p) {
    const ok = await act(() => rpc('forum_hide', { p_post: p.id, p_hidden: !p.hidden }), p.hidden ? 'Shown again.' : 'Hidden from students.');
    if (ok !== undefined) reload();
  }
  async function remove() {
    const ok = await act(() => (lecturer
      ? run(supabase.from('forum_posts').delete().eq('id', removing.id))
      : rpc('forum_delete_own', { p_post: removing.id })), 'Deleted.');
    setRemoving(null);
    if (ok !== undefined) reload();
  }
  function share(p) {
    const text = `*${course.code} — question from class*\n${p.body}\n\n*Answer:* ${p.answer}\n\n${window.location.origin}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  const open = (data || []).filter((p) => !p.answer && !p.hidden).length;

  return (
    <div className="two-col" style={{ maxWidth: 1100, gridTemplateColumns: lecturer ? 'minmax(0,1fr)' : undefined }}>
      <main className="stack">
        <div className="between" style={{ flexWrap: 'wrap' }}>
          <div className="chips" role="group" aria-label="Show">
            {[['all', `All · ${(data || []).length}`], ['open', `Unanswered · ${open}`], ['answered', 'Answered'], ...(lecturer ? [] : [['mine', 'Mine']])].map(([id, label]) => (
              <button key={id} type="button" className="chip" aria-pressed={show === id} onClick={() => setShow(id)}>{label}</button>
            ))}
          </div>
          <label className="row small" style={{ gap: 6 }}>Sort
            <select className="select" style={{ width: 'auto', minHeight: 40 }} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="top">Most votes</option><option value="new">Newest</option>
            </select>
          </label>
        </div>

        {posts.length === 0 && <div className="card"><Empty icon="megaphone" title="No questions here yet">{lecturer ? 'Questions from students will appear here.' : 'Ask the first one — classmates can upvote questions they also want answered.'}</Empty></div>}

        {posts.map((p) => (
          <article key={p.id} className="card row" style={{ alignItems: 'flex-start', gap: 14, opacity: p.hidden ? 0.6 : 1 }}>
            <button type="button" onClick={() => !lecturer && vote(p)} disabled={lecturer || p.mine} aria-pressed={p.voted}
              aria-label={`${p.votes} votes${lecturer || p.mine ? '' : p.voted ? ', remove your vote' : ', vote for this question'}`}
              style={{ width: 52, flexShrink: 0, border: '1px solid var(--field)', borderRadius: 10, padding: '6px 0', background: p.voted ? 'var(--teal-50)' : 'var(--surface)',
                color: p.voted ? 'var(--teal-dark)' : 'var(--text)', cursor: lecturer || p.mine ? 'default' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Icon name="arrowUp" size={16} />
              <span className="mono strong">{p.votes}</span>
            </button>
            <div className="stack-sm" style={{ flex: 1, minWidth: 0 }}>
              <div className="row-wrap tiny muted">
                <span>{p.author ? <>{p.author}{p.author_index ? ` · ${p.author_index}` : ''}{p.anonymous && lecturer ? ' (anonymous to classmates)' : ''}</> : 'Anonymous'}</span>
                <span>· {relative(p.created_at)}</span>
                {p.hidden && <span className="badge">Hidden</span>}
                {p.answer ? <span className="badge badge-teal">Answered</span> : <span className="badge badge-amber">Waiting</span>}
              </div>
              <p className="pre" style={{ overflowWrap: 'anywhere' }}>{p.body}</p>
              {p.answer && answering !== p.id && (
                <div style={{ background: 'var(--teal-50)', borderRadius: 8, padding: '10px 14px' }}>
                  <div className="eyebrow" style={{ color: 'var(--teal-dark)' }}>Lecturer's answer</div>
                  <p className="pre small" style={{ marginTop: 4 }}>{p.answer}</p>
                </div>
              )}
              {lecturer && answering === p.id && (
                <div className="stack-sm">
                  <textarea className="textarea" autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" />
                  <div className="row-wrap">
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveAnswer(p)}>Save answer</button>
                    <button type="button" className="btn btn-sm" onClick={() => setAnswering(null)}>Cancel</button>
                  </div>
                </div>
              )}
              <div className="row-wrap">
                {lecturer && answering !== p.id && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setAnswering(p.id); setAnswer(p.answer || ''); }}>{p.answer ? 'Edit answer' : 'Answer'}</button>}
                {lecturer && <button type="button" className="btn btn-sm btn-ghost" onClick={() => hide(p)}>{p.hidden ? 'Show' : 'Hide'}</button>}
                {lecturer && p.answer && <button type="button" className="btn btn-sm btn-ghost" onClick={() => share(p)}>Share on WhatsApp</button>}
                {((lecturer && canDelete) || (p.mine && !p.answer)) && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRemoving(p)}>Delete</button>}
              </div>
            </div>
          </article>
        ))}
      </main>

      {!lecturer && (
        <aside>
          <form className="card stack" onSubmit={post} style={{ position: 'sticky', top: 90 }}>
            <h2>Ask a question</h2>
            <textarea className="textarea" style={{ minHeight: 120 }} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="e.g. In the EOQ formula, is H per unit per year or per order?" />
            <label className="check"><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /> Hide my name from classmates</label>
            <p className="tiny muted">Your lecturer can always see who asked. Up to 5 questions a day. Search the list first — if someone has asked already, upvote it instead.</p>
            <button type="submit" className="btn btn-primary" disabled={busy || body.trim().length < 3}>Post question</button>
          </form>
        </aside>
      )}

      {removing && <Confirm title="Delete this question?" danger confirmLabel="Delete" busy={busy} message={`"${removing.body.slice(0, 120)}"`} onClose={() => setRemoving(null)} onConfirm={remove} />}
    </div>
  );
}
