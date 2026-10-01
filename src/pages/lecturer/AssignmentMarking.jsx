import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rpcAll, run, supabase, openStoredFile } from '../../lib/supabase.js';
import { fmtFull, fmtNumber, pct, relative } from '../../lib/format.js';
import { downloadExcel } from '../../lib/sheets.js';
import Icon from '../../components/Icon.jsx';
import { Topbar } from '../../components/Layout.jsx';
import { Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../components/ui.jsx';
import { AssignmentForm } from './course/AssignmentsTab.jsx';

async function allSubmissions(assignmentId) {
  let all = [];
  for (let from = 0; ; from += 1000) {
    const page = await run(supabase.from('submissions').select('*, profiles(index_no, full_name)').eq('assignment_id', assignmentId)
      .order('submitted_at').range(from, from + 999));
    all = all.concat(page);
    if (page.length < 1000) return all;
  }
}

export default function AssignmentMarking() {
  const { assignmentId } = useParams();
  const { data, error, loading, reload, setData } = useLoad(async () => {
    const a = await run(supabase.from('assignments').select('*, courses(id, code, title)').eq('id', assignmentId).single());
    const [students, subs] = await Promise.all([rpcAll('course_students', { p_course: a.course_id }), allSubmissions(assignmentId)]);
    const byIndex = new Map(subs.map((s) => [s.profiles?.index_no, s]));
    const rows = students.map((st) => ({ ...st, sub: byIndex.get(st.index_no) || null }));
    // students who submitted but were later removed from the course
    subs.filter((s) => !students.some((st) => st.index_no === s.profiles?.index_no))
      .forEach((s) => rows.push({ index_no: s.profiles?.index_no, full_name: s.profiles?.full_name, activated: true, sub: s }));
    return { a, rows };
  }, [assignmentId]);
  const [filter, setFilter] = useState('tomark');
  const [q, setQ] = useState('');
  const [marking, setMarking] = useState(null); // index in `shown`
  const [editing, setEditing] = useState(false);
  const [act, busy] = useAction();

  const shown = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (filter === 'tomark' && !(r.sub && r.sub.marks === null)) return false;
      if (filter === 'marked' && !(r.sub && r.sub.marks !== null)) return false;
      if (filter === 'missing' && r.sub) return false;
      if (filter === 'late' && !r.sub?.is_late) return false;
      return !term || String(r.full_name).toLowerCase().includes(term) || String(r.index_no).toLowerCase().includes(term);
    });
  }, [data, filter, q]);

  if (loading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} onRetry={reload} /></div>;

  const { a, rows } = data;
  const submitted = rows.filter((r) => r.sub);
  const marked = submitted.filter((r) => r.sub.marks !== null);
  const late = submitted.filter((r) => r.sub.is_late);
  const avg = marked.length ? Math.round(marked.reduce((s, r) => s + pct(r.sub.marks, a.max_marks), 0) / marked.length) : null;

  async function toggleRelease() {
    const next = !a.results_released;
    const ok = await act(() => run(supabase.from('assignments').update({ results_released: next }).eq('id', a.id)),
      next ? 'Marks released to students.' : 'Marks hidden from students.');
    if (ok !== undefined) setData((d) => ({ ...d, a: { ...d.a, results_released: next } }));
  }

  function exportXlsx() {
    downloadExcel(`${a.courses.code} - ${a.title}.xlsx`, [
      ['Index number', 'Name', 'Submitted', 'Late', 'File', 'Marks', 'Out of', 'Percent', 'Feedback'],
      ...rows.map((r) => [
        r.index_no, r.full_name, r.sub ? fmtFull(r.sub.submitted_at) : 'Not submitted', r.sub?.is_late ? 'Yes' : '',
        r.sub?.file_name || '', r.sub?.marks !== null && r.sub?.marks !== undefined ? Number(r.sub.marks) : '', Number(a.max_marks),
        r.sub?.marks !== null && r.sub?.marks !== undefined ? pct(r.sub.marks, a.max_marks) : '', r.sub?.feedback || '',
      ]),
    ], [16, 30, 22, 8, 30, 10, 10, 10, 50]);
  }

  function updateSub(id, patch) {
    setData((d) => ({ ...d, rows: d.rows.map((r) => (r.sub?.id === id ? { ...r, sub: { ...r.sub, ...patch } } : r)) }));
  }

  return (
    <>
      <Topbar title={a.title} sub={`${a.courses.code} · ${a.due_at ? `due ${fmtFull(a.due_at)}` : 'no deadline'} · ${fmtNumber(a.max_marks)} marks`}>
        <Link to={`/teach/course/${a.course_id}?tab=assignments`} className="btn"><Icon name="chevronLeft" /> Assignments</Link>
        <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> Edit</button>
        <button type="button" className={`btn ${a.results_released ? '' : 'btn-primary'}`} onClick={toggleRelease} disabled={busy}>
          {a.results_released ? 'Hide marks' : 'Release marks'}
        </button>
      </Topbar>
      <div className="page stack">
        <div className="grid-4">
          <div className="kpi"><span className="l">Submitted</span><span className="v">{submitted.length}</span><span className="tiny muted">of {rows.length} students</span></div>
          <div className="kpi"><span className="l">Marked</span><span className="v">{marked.length}</span><span className="tiny muted">{submitted.length - marked.length} still to mark</span></div>
          <div className="kpi"><span className="l">Late</span><span className="v" style={{ color: late.length ? 'var(--amber-ink)' : undefined }}>{late.length}</span></div>
          <div className="kpi"><span className="l">Average mark</span><span className="v">{avg === null ? '—' : `${avg}%`}</span></div>
        </div>

        {!a.results_released && marked.length > 0 && (
          <div className="notice notice-warn">Students cannot see their marks yet. Press <strong>Release marks</strong> when you have finished.</div>
        )}

        <section className="card-flush">
          <div className="card-head" style={{ flexWrap: 'wrap' }}>
            <div className="row-wrap">
              <label className="search">
                <span className="sr-only">Search</span>
                <Icon name="search" size={16} />
                <input className="input" style={{ width: 230, minHeight: 40 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or index number" />
              </label>
              <div className="chips" role="group" aria-label="Filter">
                {[['tomark', `To mark · ${submitted.length - marked.length}`], ['marked', 'Marked'], ['late', 'Late'], ['missing', 'Not submitted'], ['all', 'All']].map(([id, label]) => (
                  <button key={id} type="button" className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
                ))}
              </div>
            </div>
            <button type="button" className="btn btn-sm" onClick={exportXlsx}><Icon name="download" size={16} /> Export to Excel</button>
          </div>
          {shown.length === 0 ? <Empty icon="inbox">{filter === 'tomark' ? 'Nothing waiting to be marked.' : 'No students match.'}</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Index no.</th><th>Student</th><th>Submitted</th><th className="num">Marks</th><th /></tr></thead>
                <tbody>
                  {shown.slice(0, 400).map((r, i) => (
                    <tr key={r.index_no}>
                      <td className="mono small">{r.index_no}</td>
                      <td>{r.full_name}</td>
                      <td className="small">
                        {r.sub ? (
                          <>{relative(r.sub.submitted_at)} {r.sub.is_late && <span className="badge badge-amber">Late</span>}
                            <div className="tiny muted" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sub.file_name}</div></>
                        ) : <span className="muted">Not submitted</span>}
                      </td>
                      <td className="num">{r.sub?.marks !== null && r.sub?.marks !== undefined ? `${fmtNumber(r.sub.marks)} / ${fmtNumber(a.max_marks)}` : '—'}</td>
                      <td>
                        {r.sub && (
                          <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                            <button type="button" className="icon-btn plain" aria-label="Open file" onClick={() => act(() => openStoredFile('submissions', r.sub.file_path))}><Icon name="eye" /></button>
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => setMarking(i)}>{r.sub.marks !== null ? 'Edit mark' : 'Mark'}</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {marking !== null && shown[marking]?.sub && (
        <MarkModal
          key={shown[marking].sub.id}
          a={a}
          row={shown[marking]}
          hasNext={shown.slice(marking + 1).some((r) => r.sub)}
          onClose={() => setMarking(null)}
          onSaved={(patch, next) => {
            updateSub(shown[marking].sub.id, patch);
            if (next) {
              const rest = shown.findIndex((r, k) => k > marking && r.sub);
              // when filtering "to mark", the saved row drops out, so the next one slides into the same place
              setMarking(filter === 'tomark' ? (rest > -1 ? rest - 1 : null) : rest > -1 ? rest : null);
            } else setMarking(null);
          }}
        />
      )}
      {editing && <AssignmentForm course={{ id: a.course_id }} a={a} onClose={() => setEditing(false)} onSaved={reload} />}
    </>
  );
}

function MarkModal({ a, row, hasNext, onClose, onSaved }) {
  const toast = useToast();
  const [act] = useAction();
  const [marks, setMarks] = useState(row.sub.marks ?? '');
  const [feedback, setFeedback] = useState(row.sub.feedback || '');
  const [busy, setBusy] = useState(false);

  async function save(next) {
    const m = Number(marks);
    if (marks === '' || Number.isNaN(m) || m < 0 || m > Number(a.max_marks)) {
      toast(`Marks must be between 0 and ${fmtNumber(a.max_marks)}.`, 'error');
      return;
    }
    setBusy(true);
    try {
      const patch = { marks: m, feedback, marked_at: new Date().toISOString() };
      await run(supabase.from('submissions').update(patch).eq('id', row.sub.id));
      toast(`Saved · ${row.full_name}`);
      onSaved(patch, next);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={row.full_name} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Close</button>
        <button type="button" className="btn" onClick={() => save(false)} disabled={busy}>Save</button>
        {hasNext && <button type="button" className="btn btn-primary" onClick={() => save(true)} disabled={busy}>Save and next</button>}
      </>}>
      <div className="notice notice-info row-wrap">
        <Icon name="file" />
        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          <strong>{row.sub.file_name}</strong><br />
          <span className="small">Submitted {fmtFull(row.sub.submitted_at)}{row.sub.is_late ? ' · LATE' : ''}</span>
        </span>
        <button type="button" className="btn btn-sm" onClick={() => act(() => openStoredFile('submissions', row.sub.file_path))}>Open file</button>
      </div>
      {row.sub.note && <p className="small"><span className="eyebrow">Student's note: </span>{row.sub.note}</p>}
      <Field label={`Marks out of ${fmtNumber(a.max_marks)}`}>
        <input className="input mono" type="number" min="0" max={a.max_marks} step="0.5" style={{ maxWidth: 160 }} value={marks} onChange={(e) => setMarks(e.target.value)} autoFocus />
      </Field>
      <Field label="Feedback to the student" hint="shown when you release marks">
        <textarea className="textarea" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </Field>
    </Modal>
  );
}
