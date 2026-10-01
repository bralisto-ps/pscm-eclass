import { useState } from 'react';
import { Link } from 'react-router-dom';
import { run, supabase } from '../../../lib/supabase.js';
import { removeFiles } from '../../../lib/files.js';
import { shareWhatsApp } from '../../../lib/share.js';
import { fmtDateTime, fmtNumber, fromLocalInput, relative, toLocalInput } from '../../../lib/format.js';
import Icon from '../../../components/Icon.jsx';
import { Confirm, Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad } from '../../../components/ui.jsx';

export default function AssignmentsTab({ course }) {
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [act, busy] = useAction();
  const { data, error, loading, reload } = useLoad(async () => {
    const [list, enrolled] = await Promise.all([
      run(supabase.from('assignments').select('*, submissions(count)').eq('course_id', course.id).order('due_at', { nullsFirst: false })),
      supabase.from('enrollments').select('index_no', { count: 'exact', head: true }).eq('course_id', course.id)
        .then(({ count, error: e }) => { if (e) throw e; return count || 0; }),
    ]);
    return { list, enrolled };
  }, [course.id]);

  async function remove() {
    await act(async () => {
      const subs = await run(supabase.from('submissions').select('file_path').eq('assignment_id', removing.id));
      await removeFiles('submissions', subs.map((x) => x.file_path));
      await run(supabase.from('assignments').delete().eq('id', removing.id));
    }, 'Assignment deleted.');
    setRemoving(null);
    reload();
  }

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  return (
    <div className="stack" style={{ maxWidth: 1040 }}>
      <div className="between" style={{ flexWrap: 'wrap' }}>
        <p className="small muted" style={{ maxWidth: 600 }}>
          Students upload one file (up to 5 MB) before the deadline. You mark it here with feedback, then release the marks.
          For work that marks itself, use a quiz instead.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" /> New assignment</button>
      </div>

      {data.list.length === 0 ? (
        <div className="card"><Empty icon="clipboard" title="No assignments yet" /></div>
      ) : (
        <div className="card-flush table-wrap">
          <table className="table">
            <thead><tr><th>Assignment</th><th>Status</th><th>Due</th><th className="num">Submitted</th><th /></tr></thead>
            <tbody>
              {data.list.map((a) => {
                const n = a.submissions?.[0]?.count ?? 0;
                const past = a.due_at && new Date(a.due_at) < new Date();
                return (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/teach/assignment/${a.id}`} className="strong" style={{ color: 'var(--text)' }}>{a.title}</Link>
                      <div className="tiny muted">{fmtNumber(a.max_marks)} marks{a.allow_late ? ' · late allowed' : ''}{a.results_released ? ' · marks released' : ''}</div>
                    </td>
                    <td>
                      <span className={`badge ${!a.published ? '' : past ? 'badge-plum' : 'badge-teal'}`}>
                        {!a.published ? 'Draft' : past ? 'Closed' : 'Open'}
                      </span>
                    </td>
                    <td className="small nowrap">{a.due_at ? fmtDateTime(a.due_at) : '—'}<div className="tiny muted">{a.due_at ? relative(a.due_at) : ''}</div></td>
                    <td className="num">{n} / {data.enrolled}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <Link to={`/teach/assignment/${a.id}`} className="btn btn-sm">Mark</Link>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(a)}>Edit</button>
                        {a.published && <button type="button" className="icon-btn plain" title="Share on WhatsApp" aria-label="Share on WhatsApp"
                          onClick={() => shareWhatsApp(`*${course.code} assignment: ${a.title}*\n${a.due_at ? `Due ${fmtDateTime(a.due_at)}` : 'No deadline'} · ${fmtNumber(a.max_marks)} marks\nHand in on the course page.`)}>
                          <Icon name="megaphone" /></button>}
                        <button type="button" className="icon-btn plain" aria-label="Delete assignment" onClick={() => setRemoving(a)}><Icon name="trash" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <AssignmentForm course={course} a={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {removing && (
        <Confirm title="Delete this assignment?" danger confirmLabel="Delete" busy={busy}
          message={`"${removing.title}" and every uploaded submission and mark will be deleted permanently.`}
          onClose={() => setRemoving(null)} onConfirm={remove} />
      )}
    </div>
  );
}

export function AssignmentForm({ course, a, onClose, onSaved }) {
  const [act, busy] = useAction();
  const [f, setF] = useState({
    title: a.title || '',
    instructions: a.instructions || '',
    due_at: toLocalInput(a.due_at),
    max_marks: a.max_marks ?? 100,
    allow_late: a.allow_late ?? false,
    published: a.published ?? true,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save() {
    const row = {
      course_id: course.id, title: f.title.trim(), instructions: f.instructions, due_at: fromLocalInput(f.due_at),
      max_marks: Number(f.max_marks) || 100, allow_late: f.allow_late, published: f.published,
    };
    const ok = await act(
      () => (a.id ? run(supabase.from('assignments').update(row).eq('id', a.id)) : run(supabase.from('assignments').insert(row))),
      a.id ? 'Assignment updated.' : 'Assignment created.',
    );
    if (ok !== undefined) {
      onClose();
      onSaved();
    }
  }

  return (
    <Modal title={a.id ? 'Edit assignment' : 'New assignment'} onClose={onClose} wide
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !f.title.trim()}>Save</button></>}>
      <Field label="Title"><input className="input" value={f.title} onChange={set('title')} placeholder="Supplier evaluation case study" autoFocus /></Field>
      <Field label="Instructions" hint="what to do, format, word count, how it is marked">
        <textarea className="textarea" style={{ minHeight: 160 }} value={f.instructions} onChange={set('instructions')} />
      </Field>
      <div className="grid-2">
        <Field label="Deadline"><input className="input" type="datetime-local" value={f.due_at} onChange={set('due_at')} /></Field>
        <Field label="Marks available"><input className="input" type="number" min="1" value={f.max_marks} onChange={set('max_marks')} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.allow_late} onChange={set('allow_late')} /> Accept late submissions (they are marked as late)</label>
      <label className="check"><input type="checkbox" checked={f.published} onChange={set('published')} /> Visible to students</label>
    </Modal>
  );
}
