import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpcAll, run, supabase } from '../../../lib/supabase.js';
import { removeFiles } from '../../../lib/files.js';
import { shareWhatsApp } from '../../../lib/share.js';
import { fmtDateTime, fmtNumber, fromLocalInput, relative, toLocalInput } from '../../../lib/format.js';
import {
  autoBuildSyndicateGroups,
  normalizeIndexNo,
  parseAssignmentMeta,
  serializeAssignmentMeta,
} from '../../../lib/assignmentMeta.js';
import Icon from '../../../components/Icon.jsx';
import { RubricEditor } from '../../../components/RubricGrader.jsx';
import { Confirm, Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../../components/ui.jsx';

export default function AssignmentsTab({ course, ta }) {
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
        <p className="small muted" style={{ maxWidth: 620 }}>
          {ta ? 'Open an assignment to mark submissions and give feedback. The lecturer releases the marks.'
            : 'Students upload one file (up to 5 MB) before the deadline. Configure clickable rubrics and syndicate case-study groups on any assignment.'}
        </p>
        {!ta && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" /> New assignment</button>}
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
                const meta = parseAssignmentMeta(a);
                return (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/teach/assignment/${a.id}`} className="strong" style={{ color: 'var(--text)' }}>{a.title}</Link>
                      <div className="tiny muted">
                        {fmtNumber(a.max_marks)} marks
                        {a.allow_late ? ' · late allowed' : ''}
                        {a.results_released ? ' · marks released' : ''}
                        {meta.rubric.length > 0 ? ` · ${meta.rubric.length}-criterion rubric` : ''}
                        {meta.syndicate.enabled ? ` · Syndicate (${meta.syndicate.groups.length} groups)` : ''}
                      </div>
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
                        {!ta && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(a)}>Edit</button>}
                        {a.published && <button type="button" className="icon-btn plain" title="Share on WhatsApp" aria-label="Share on WhatsApp"
                          onClick={() => shareWhatsApp(`*${course.code} assignment: ${a.title}*\n${a.due_at ? `Due ${fmtDateTime(a.due_at)}` : 'No deadline'} · ${fmtNumber(a.max_marks)} marks\nHand in on the course page.`)}>
                          <Icon name="megaphone" /></button>}
                        {!ta && <button type="button" className="icon-btn plain" aria-label="Delete assignment" onClick={() => setRemoving(a)}><Icon name="trash" /></button>}
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
  const toast = useToast();
  const [act, busy] = useAction();
  const initialMeta = parseAssignmentMeta(a);

  const [f, setF] = useState({
    title: a.title || '',
    instructions: initialMeta.cleanInstructions || '',
    due_at: toLocalInput(a.due_at),
    max_marks: a.max_marks ?? 100,
    allow_late: a.allow_late ?? false,
    published: a.published ?? true,
  });
  const [rubric, setRubric] = useState(initialMeta.rubric);
  const [syndicateEnabled, setSyndicateEnabled] = useState(initialMeta.syndicate.enabled);
  const [peerCheck, setPeerCheck] = useState(initialMeta.syndicate.peerCheck !== false);
  const [groups, setGroups] = useState(initialMeta.syndicate.groups);
  const [groupSize, setGroupSize] = useState(4);
  const [cohortMode, setCohortMode] = useState('both');
  const [autoBusy, setAutoBusy] = useState(false);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function autoAssignGroups() {
    setAutoBusy(true);
    try {
      const students = await rpcAll('course_students', { p_course: course.id });
      if (!students.length) {
        toast('No enrolled students in this course yet.', 'error');
        return;
      }
      const next = autoBuildSyndicateGroups(students, groupSize, cohortMode);
      setGroups(next);
      const modeNote = cohortMode === 'mix' ? 'mixed across class' : 'grouped strictly within cohort';
      toast(`Created ${next.length} syndicate group${next.length === 1 ? '' : 's'} from ${students.length} students (${modeNote}).`);
    } catch (e) {
      toast(e.message || 'Could not load class list.', 'error');
    } finally {
      setAutoBusy(false);
    }
  }

  function addGroup() {
    setGroups((g) => [...g, { id: `grp-${Date.now()}`, name: `Syndicate ${g.length + 1}`, members: [] }]);
  }

  function updateGroupName(idx, name) {
    setGroups((g) => g.map((item, i) => (i === idx ? { ...item, name } : item)));
  }

  function updateGroupMembers(idx, rawText) {
    const members = [...new Set(rawText.split(/[\s,;]+/).map(normalizeIndexNo).filter(Boolean))];
    setGroups((g) => g.map((item, i) => (i === idx ? { ...item, members } : item)));
  }

  function removeGroup(idx) {
    setGroups((g) => g.filter((_, i) => i !== idx));
  }

  async function save() {
    const encodedInstructions = serializeAssignmentMeta(f.instructions, {
      rubric,
      syndicate: {
        enabled: syndicateEnabled,
        peerCheck,
        groups,
      },
    });
    const row = {
      course_id: course.id,
      title: f.title.trim(),
      instructions: encodedInstructions,
      due_at: fromLocalInput(f.due_at),
      max_marks: Number(f.max_marks) || 100,
      allow_late: f.allow_late,
      published: f.published,
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
        <textarea className="textarea" style={{ minHeight: 130 }} value={f.instructions} onChange={set('instructions')} />
      </Field>
      <div className="grid-2">
        <Field label="Deadline"><input className="input" type="datetime-local" value={f.due_at} onChange={set('due_at')} /></Field>
        <Field label="Marks available"><input className="input" type="number" min="1" value={f.max_marks} onChange={set('max_marks')} /></Field>
      </div>

      <RubricEditor criteria={rubric} maxMarks={Number(f.max_marks) || 100} onChange={setRubric} />

      <div className="stack-sm" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
        <label className="check">
          <input
            type="checkbox"
            checked={syndicateEnabled}
            onChange={(e) => setSyndicateEnabled(e.target.checked)}
          />
          <span>
            <strong>Syndicate / Group Case Study Mode</strong>
            <span className="tiny muted" style={{ display: 'block' }}>
              One member uploads on behalf of their group, and one grading pass applies marks &amp; feedback to all group members.
            </span>
          </span>
        </label>

        {syndicateEnabled && (
          <div className="stack-sm" style={{ marginTop: 6 }}>
            <label className="check" style={{ paddingBottom: 4 }}>
              <input
                type="checkbox"
                checked={peerCheck}
                onChange={(e) => setPeerCheck(e.target.checked)}
              />
              <span className="small">
                <strong>Require Confidential Peer-Contribution Check</strong>{' '}
                <span className="muted">(teammates privately rate each member 1–5; visible only to lecturers/TAs)</span>
              </span>
            </label>
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="row-wrap" style={{ gap: 6, alignItems: 'center' }}>
                <label className="row small" style={{ gap: 6 }}>
                  <span className="tiny muted">Team size:</span>
                  <input
                    className="input mono"
                    type="number"
                    min="2"
                    max="15"
                    style={{ width: 64, minHeight: 34 }}
                    value={groupSize}
                    onChange={(e) => setGroupSize(e.target.value)}
                  />
                </label>
                <label className="row small" style={{ gap: 6 }}>
                  <span className="tiny muted">Cohorts:</span>
                  <select
                    className="select"
                    style={{ minHeight: 34, width: 'auto', fontSize: 12.5 }}
                    value={cohortMode}
                    onChange={(e) => setCohortMode(e.target.value)}
                  >
                    <option value="both">Keep programme &amp; stream separate</option>
                    <option value="stream">Keep stream separate only</option>
                    <option value="programme">Keep programme separate only</option>
                    <option value="mix">Mix entire class</option>
                  </select>
                </label>
                <button type="button" className="btn btn-sm" onClick={autoAssignGroups} disabled={autoBusy}>
                  <Icon name="users" size={14} /> {autoBusy ? 'Grouping…' : 'Auto-group class'}
                </button>
              </div>
              <button type="button" className="btn btn-sm btn-primary" onClick={addGroup}>
                <Icon name="plus" size={14} /> Add group
              </button>
            </div>

            {groups.length === 0 ? (
              <p className="tiny muted" style={{ margin: 0 }}>
                No syndicate groups yet — click <strong>Auto-group class</strong> to split enrolled students automatically, or add groups manually.
              </p>
            ) : (
              <div className="stack-sm" style={{ maxHeight: 210, overflowY: 'auto', paddingRight: 4 }}>
                {groups.map((g, idx) => (
                  <div key={g.id || idx} className="row-wrap" style={{ gap: 8, alignItems: 'center', padding: '6px 8px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--line-2)' }}>
                    <input
                      className="input"
                      style={{ width: 210, minHeight: 34 }}
                      value={g.name}
                      onChange={(e) => updateGroupName(idx, e.target.value)}
                      placeholder="Syndicate 1"
                    />
                    <input
                      className="input mono"
                      style={{ flex: 1, minWidth: 180, minHeight: 34, fontSize: 12 }}
                      defaultValue={(g.members || []).join(', ')}
                      onBlur={(e) => updateGroupMembers(idx, e.target.value)}
                      placeholder="Index numbers separated by commas (e.g. PSCM/24/001, PSCM/24/002)"
                    />
                    <span className="badge">{(g.members || []).length}</span>
                    <button type="button" className="icon-btn plain" aria-label="Remove group" onClick={() => removeGroup(idx)}>
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <label className="check"><input type="checkbox" checked={f.allow_late} onChange={set('allow_late')} /> Accept late submissions (they are marked as late)</label>
      <label className="check"><input type="checkbox" checked={f.published} onChange={set('published')} /> Visible to students</label>
    </Modal>
  );
}
