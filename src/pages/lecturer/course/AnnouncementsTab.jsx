import { useState } from 'react';
import { run, supabase } from '../../../lib/supabase.js';
import { fmtFull } from '../../../lib/format.js';
import Icon from '../../../components/Icon.jsx';
import { Confirm, Empty, ErrorNote, Field, Loading, useAction, useLoad } from '../../../components/ui.jsx';

export default function AnnouncementsTab({ course }) {
  const { data, error, loading, reload } = useLoad(
    () => run(supabase.from('announcements').select('*').eq('course_id', course.id).order('created_at', { ascending: false })),
    [course.id],
  );
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [removing, setRemoving] = useState(null);
  const [act, busy] = useAction();

  async function post(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await act(() => run(supabase.from('announcements').insert({ course_id: course.id, title: title.trim(), body })), 'Announcement posted.');
    if (ok !== undefined) {
      setTitle('');
      setBody('');
      reload();
    }
  }

  async function remove() {
    await act(() => run(supabase.from('announcements').delete().eq('id', removing.id)), 'Deleted.');
    setRemoving(null);
    reload();
  }

  return (
    <div className="two-col" style={{ maxWidth: 1100 }}>
      <div className="stack">
        {loading && <Loading />}
        <ErrorNote error={error} onRetry={reload} />
        {data?.length === 0 && <div className="card"><Empty icon="megaphone" title="No announcements yet" /></div>}
        {data?.map((n) => (
          <article key={n.id} className="card stack-sm">
            <div className="between">
              <span className="tiny muted">{fmtFull(n.created_at)}</span>
              <button type="button" className="icon-btn plain" aria-label="Delete announcement" onClick={() => setRemoving(n)}><Icon name="trash" /></button>
            </div>
            <h2>{n.title}</h2>
            {n.body && <p className="pre">{n.body}</p>}
          </article>
        ))}
      </div>
      <form className="card stack" onSubmit={post} style={{ position: 'sticky', top: 90 }}>
        <h2>New announcement</h2>
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quiz moved to Friday" /></Field>
        <Field label="Message"><textarea className="textarea" style={{ minHeight: 140 }} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>Post to {course.code}</button>
        <p className="tiny muted">Shows on students' home page and course page.</p>
      </form>
      {removing && <Confirm title="Delete announcement?" danger confirmLabel="Delete" busy={busy} message={`"${removing.title}"`} onClose={() => setRemoving(null)} onConfirm={remove} />}
    </div>
  );
}
