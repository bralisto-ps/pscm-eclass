import { useMemo, useState } from 'react';
import { rpc, run, supabase } from '../../../lib/supabase.js';
import { fmtFull } from '../../../lib/format.js';
import { shareWhatsApp } from '../../../lib/share.js';
import { formatAnnouncementAudience, normalizeAnnouncementAudience, sortAnnouncementsPinnedFirst } from '../../../lib/announcementMeta.js';
import Icon from '../../../components/Icon.jsx';
import { Confirm, Empty, ErrorNote, Field, Loading, useAction, useLoad } from '../../../components/ui.jsx';

export default function AnnouncementsTab({ course, ta }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [posts, classes, reads] = await Promise.all([
      run(supabase.from('announcements').select('*').eq('course_id', course.id).order('created_at', { ascending: false })),
      rpc('course_classes', { p_course: course.id }).catch(() => []),
      rpc('course_announcement_reads', { p_course: course.id }).catch(() => []),
    ]);
    const readMap = new Map();
    if (Array.isArray(reads)) {
      reads.forEach((r) => readMap.set(r.announcement_id, Number(r.read_count || 0)));
    }
    return {
      posts: sortAnnouncementsPinnedFirst(posts || []),
      classes: Array.isArray(classes) ? classes : [],
      readMap,
    };
  }, [course.id]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [who, setWho] = useState('all'); // all | custom
  const [pickedProgrammes, setPickedProgrammes] = useState([]);
  const [pickedStreams, setPickedStreams] = useState([]);
  const [removing, setRemoving] = useState(null);
  const [act, busy] = useAction();

  const programmes = useMemo(
    () => [...new Set((data?.classes || []).map((c) => c.programme).filter(Boolean))].sort(),
    [data?.classes]
  );
  const streams = useMemo(
    () => [...new Set((data?.classes || []).map((c) => c.stream).filter(Boolean))].sort(),
    [data?.classes]
  );

  async function post(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const audience =
      who === 'custom' && (pickedProgrammes.length || pickedStreams.length)
        ? normalizeAnnouncementAudience({ programmes: pickedProgrammes, streams: pickedStreams })
        : null;
    if (who === 'custom' && !audience) {
      await act(() => Promise.reject(new Error('Pick at least one programme or stream, or choose All classes.')));
      return;
    }

    const baseRow = { course_id: course.id, title: title.trim(), body: body.trim() };
    const fullRow = { ...baseRow, pinned, audience };

    const ok = await act(async () => {
      try {
        return await run(supabase.from('announcements').insert(fullRow));
      } catch (err) {
        if (!pinned && !audience && /pinned|audience|column/i.test(err?.message || '')) {
          return await run(supabase.from('announcements').insert(baseRow));
        }
        throw err;
      }
    }, 'Announcement posted.');

    if (ok !== undefined) {
      supabase.functions.invoke('notify-course', {
        body: { course_id: course.id, title: title.trim(), body: body.trim() },
      }).catch(() => {});
      setTitle('');
      setBody('');
      setPinned(false);
      setWho('all');
      setPickedProgrammes([]);
      setPickedStreams([]);
      reload();
    }
  }

  async function togglePin(n) {
    const nextPinned = !n.pinned;
    const ok = await act(
      () => run(supabase.from('announcements').update({ pinned: nextPinned }).eq('id', n.id)),
      nextPinned ? 'Announcement pinned to top.' : 'Unpinned.'
    );
    if (ok !== undefined) reload();
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
        {data?.posts?.length === 0 && <div className="card"><Empty icon="megaphone" title="No announcements yet" /></div>}
        {data?.posts?.map((n) => {
          const audLabel = formatAnnouncementAudience(n);
          const reads = data.readMap.get(n.id);
          return (
            <article key={n.id} className="card stack-sm" style={n.pinned ? { borderColor: 'var(--teal)' } : undefined}>
              <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="row-wrap" style={{ gap: 6, alignItems: 'center' }}>
                  {n.pinned && (
                    <span className="badge badge-teal">
                      <Icon name="pin" size={11} /> Pinned
                    </span>
                  )}
                  {audLabel && <span className="badge badge-plum">For: {audLabel}</span>}
                  {typeof reads === 'number' && reads > 0 && (
                    <span className="badge" title="Students who acknowledged reading this announcement">
                      <Icon name="check" size={11} /> {reads} read
                    </span>
                  )}
                  <span className="tiny muted">{fmtFull(n.created_at)}</span>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {!ta && (
                    <button
                      type="button"
                      className="icon-btn plain"
                      title={n.pinned ? 'Unpin announcement' : 'Pin announcement to top'}
                      aria-label={n.pinned ? 'Unpin announcement' : 'Pin announcement'}
                      onClick={() => togglePin(n)}
                      style={{ color: n.pinned ? 'var(--teal-dark)' : 'var(--muted)' }}
                    >
                      <Icon name="pin" size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => shareWhatsApp(`*${course.code}: ${n.title}*\n${n.body || ''}`)}
                  >
                    Share on WhatsApp
                  </button>
                  {!ta && (
                    <button type="button" className="icon-btn plain" aria-label="Delete announcement" onClick={() => setRemoving(n)}>
                      <Icon name="trash" />
                    </button>
                  )}
                </div>
              </div>
              <h2>{n.title}</h2>
              {n.body && <p className="pre">{n.body}</p>}
            </article>
          );
        })}
      </div>

      <form className="card stack" onSubmit={post} style={{ position: 'sticky', top: 90 }}>
        <h2>New announcement</h2>
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quiz moved to Friday" /></Field>
        <Field label="Message"><textarea className="textarea" style={{ minHeight: 140 }} value={body} onChange={(e) => setBody(e.target.value)} /></Field>

        <label className="check">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          <span><strong>Pin to top</strong> — keeps important notices above older posts</span>
        </label>

        {(programmes.length > 0 || streams.length > 0) && (
          <div className="stack-sm">
            <span className="field-label">Target audience</span>
            <div className="chips" role="group" aria-label="Target audience">
              <button type="button" className="chip" aria-pressed={who === 'all'} onClick={() => setWho('all')}>All classes</button>
              <button type="button" className="chip" aria-pressed={who === 'custom'} onClick={() => setWho('custom')}>Specific cohort</button>
            </div>
            {who === 'custom' && (
              <div className="card-soft stack-sm" style={{ padding: 10 }}>
                {programmes.length > 0 && (
                  <div>
                    <div className="tiny muted" style={{ marginBottom: 4 }}>Programmes</div>
                    <div className="row-wrap" style={{ gap: 8 }}>
                      {programmes.map((p) => (
                        <label key={p} className="check" style={{ fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={pickedProgrammes.includes(p)}
                            onChange={(e) =>
                              setPickedProgrammes(e.target.checked ? [...pickedProgrammes, p] : pickedProgrammes.filter((x) => x !== p))
                            }
                          />
                          {p}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {streams.length > 0 && (
                  <div>
                    <div className="tiny muted" style={{ marginBottom: 4 }}>Streams</div>
                    <div className="row-wrap" style={{ gap: 8 }}>
                      {streams.map((s) => (
                        <label key={s} className="check" style={{ fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={pickedStreams.includes(s)}
                            onChange={(e) =>
                              setPickedStreams(e.target.checked ? [...pickedStreams, s] : pickedStreams.filter((x) => x !== s))
                            }
                          />
                          {s}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <span className="tiny muted">Only students matching the selected programme/stream will see this notice.</span>
              </div>
            )}
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>Post to {course.code}</button>
        <p className="tiny muted">Shows on students&apos; home page and course page. Students can mark notices as read so you see reach.</p>
      </form>
      {removing && <Confirm title="Delete announcement?" danger confirmLabel="Delete" busy={busy} message={`"${removing.title}"`} onClose={() => setRemoving(null)} onConfirm={remove} />}
    </div>
  );
}
