import { useMemo, useState } from 'react';
import { rpc, rpcAll, run, supabase } from '../../../lib/supabase.js';
import { fmtFull, relative } from '../../../lib/format.js';
import { downloadExcel, downloadText, parseDelimited, readStudentFile, rowsToStudents } from '../../../lib/sheets.js';
import Icon from '../../../components/Icon.jsx';
import { Confirm, Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../../components/ui.jsx';
import { ALL_GROUPS, GroupFilters, matchesGroup } from '../../../components/Groups.jsx';

export default function StudentsTab({ course }) {
  const { data, error, loading, reload } = useLoad(() => rpcAll('course_students', { p_course: course.id }), [course.id]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [editing, setEditing] = useState(null);
  const [group, setGroup] = useState(ALL_GROUPS);
  const [act, busy] = useAction();

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data || []).filter((r) =>
      (filter === 'all' || (filter === 'active' ? r.activated : !r.activated)) && matchesGroup(r, group) &&
      (!term || r.index_no.toLowerCase().includes(term) || r.full_name.toLowerCase().includes(term)));
  }, [data, q, filter, group]);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  const activated = data.filter((r) => r.activated).length;

  async function remove() {
    await act(() => run(supabase.from('enrollments').delete().eq('course_id', course.id).eq('index_no', removing.index_no)), 'Removed from course.');
    setRemoving(null);
    reload();
  }

  function exportList() {
    downloadExcel(`${course.code} class list.xlsx`, [
      ['Index number', 'Full name', 'Programme', 'Stream', 'Account activated', 'Last sign-in'],
      ...data.map((r) => [r.index_no, r.full_name, r.programme, r.stream, r.activated ? 'Yes' : 'No', r.last_sign_in ? fmtFull(r.last_sign_in) : '']),
    ], [18, 32, 20, 14, 18, 22]);
  }

  return (
    <div className="stack" style={{ maxWidth: 1040 }}>
      <div className="grid-3">
        <div className="kpi"><span className="l">Students on class list</span><span className="v">{data.length.toLocaleString()}</span></div>
        <div className="kpi"><span className="l">Accounts activated</span><span className="v">{activated.toLocaleString()}</span></div>
        <div className="kpi"><span className="l">Not yet activated</span><span className="v" style={{ color: data.length - activated ? 'var(--amber-ink)' : undefined }}>{(data.length - activated).toLocaleString()}</span></div>
      </div>

      <div className="card-flush">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="row-wrap">
            <label className="search">
              <span className="sr-only">Search students</span>
              <Icon name="search" size={16} />
              <input className="input" style={{ width: 240, minHeight: 40 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or index number" />
            </label>
            <div className="chips" role="group" aria-label="Filter">
              <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
              <button type="button" className="chip" aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>Activated</button>
              <button type="button" className="chip" aria-pressed={filter === 'inactive'} onClick={() => setFilter('inactive')}>Not activated</button>
            </div>
            <GroupFilters rows={data} value={group} onChange={setGroup} />
          </div>
          <div className="row-wrap">
            {data.length > 0 && <button type="button" className="btn btn-sm" onClick={exportList}><Icon name="download" size={16} /> Export</button>}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setImporting(true)}><Icon name="upload" size={16} /> Upload class list</button>
          </div>
        </div>

        {data.length === 0 ? (
          <Empty icon="users" title="No students yet" action={<button type="button" className="btn btn-primary" onClick={() => setImporting(true)}>Upload class list</button>}>
            Upload an Excel or CSV file with index numbers and names. Students can then activate their accounts.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Index no.</th><th>Name</th><th>Programme</th><th>Stream</th><th>Account</th><th className="hide-sm">Last sign-in</th><th /></tr></thead>
              <tbody>
                {rows.slice(0, 300).map((r) => (
                  <tr key={r.index_no}>
                    <td className="mono small">{r.index_no}</td>
                    <td>{r.full_name}</td>
                    <td className="small">{r.programme || <span className="muted">—</span>}</td>
                    <td className="small">{r.stream || <span className="muted">—</span>}</td>
                    <td>{r.activated ? <span className="badge badge-teal">Activated</span> : <span className="badge">Not yet</span>}</td>
                    <td className="small muted hide-sm">{r.last_sign_in ? relative(r.last_sign_in) : '—'}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        {r.activated && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setResetting(r)}><Icon name="key" size={16} /> Reset password</button>}
                        <button type="button" className="icon-btn plain" aria-label={`Edit ${r.full_name}`} onClick={() => setEditing(r)}><Icon name="edit" /></button>
                        <button type="button" className="icon-btn plain" aria-label={`Remove ${r.full_name} from course`} onClick={() => setRemoving(r)}><Icon name="trash" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 300 && <p className="small muted" style={{ padding: '12px 18px' }}>Showing 300 of {rows.length}. Search to find a specific student.</p>}
            {rows.length === 0 && <Empty>No students match.</Empty>}
          </div>
        )}
      </div>

      <div className="notice notice-info">
        <strong>Tell your students:</strong> open <span className="mono">{window.location.origin}</span>, choose
        <strong> Activate your account</strong>, enter their index number and choose a password.
      </div>

      {importing && <ImportModal course={course} onClose={() => setImporting(false)} onDone={reload} />}
      {resetting && <ResetModal student={resetting} onClose={() => setResetting(null)} />}
      {editing && <EditModal student={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {removing && (
        <Confirm title="Remove from course?" danger confirmLabel="Remove" busy={busy}
          message={`${removing.full_name} (${removing.index_no}) will lose access to ${course.code}. Their account and past results stay.`}
          onClose={() => setRemoving(null)} onConfirm={remove} />
      )}
    </div>
  );
}

function ImportModal({ course, onClose, onDone }) {
  const toast = useToast();
  const [students, setStudents] = useState([]);
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onFile(e) {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const list = await readStudentFile(file);
      if (!list.length) throw new Error('No students found in that file. Check it has index numbers in the first column.');
      setStudents(list);
    } catch (err) {
      setError(err.message);
    }
  }

  function onPaste(v) {
    setPaste(v);
    setStudents(rowsToStudents(parseDelimited(v)));
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      let total = { new_students: 0, enrolled: 0 };
      for (let i = 0; i < students.length; i += 500) {
        const r = await rpc('import_roster', { p_course: course.id, p_rows: students.slice(i, i + 500) });
        total = { new_students: total.new_students + r.new_students, enrolled: total.enrolled + r.enrolled };
      }
      toast(`${total.enrolled} student${total.enrolled === 1 ? '' : 's'} added to ${course.code}.`);
      onDone();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const missingNames = students.filter((s) => !s.full_name).length;

  return (
    <Modal title={`Upload class list · ${course.code}`} onClose={() => !busy && onClose()} wide
      footer={<><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !students.length}>
          {busy ? 'Adding…' : `Add ${students.length || ''} student${students.length === 1 ? '' : 's'}`}
        </button></>}>
      <p className="small muted">
        Use an Excel (.xlsx) or CSV file with columns for <strong>index number</strong>, <strong>full name</strong>, and optionally
        <strong>programme</strong> (e.g. Marketing, HRM) and <strong>stream</strong> (e.g. Regular, Weekend, Evening). Give the columns those headings. Students already on the list are updated, not duplicated. You can upload again at any time to add late registrations.
      </p>
      <div className="row-wrap">
        <input type="file" accept=".xlsx,.csv,.txt" className="input" style={{ paddingTop: 9, maxWidth: 420 }} onChange={onFile} aria-label="Class list file" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => downloadText('class-list-template.csv', 'Index number,Full name,Programme,Stream\n4021180,Kofi Mensah,Marketing,Regular\n4021214,Ama Owusu,HRM,Weekend\n')}>
          <Icon name="download" size={16} /> Template
        </button>
      </div>
      <Field label="…or paste from Excel" hint="copy the two columns and paste here">
        <textarea className="textarea mono" value={paste} onChange={(e) => onPaste(e.target.value)} placeholder={'Index number\tFull name\tProgramme\tStream\n4021180\tKofi Mensah\tMarketing\tRegular'} />
      </Field>
      {error && <div className="notice notice-error">{error}</div>}
      {students.length > 0 && (
        <div className="stack-sm">
          <strong>{students.length} students found{missingNames ? ` · ${missingNames} without a name` : ''}</strong>
          <div className="card-flush table-wrap">
            <table className="table">
              <thead><tr><th>Index no.</th><th>Name</th><th>Programme</th><th>Stream</th></tr></thead>
              <tbody>
                {students.slice(0, 6).map((s, i) => (
                  <tr key={i}>
                    <td className="mono small">{s.index_no}</td>
                    <td>{s.full_name || <span className="muted">—</span>}</td>
                    <td className="small">{s.programme || <span className="muted">—</span>}</td>
                    <td className="small">{s.stream || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {students.length > 6 && <span className="tiny muted">…and {students.length - 6} more</span>}
        </div>
      )}
    </Modal>
  );
}

function ResetModal({ student, onClose }) {
  const [act, busy] = useAction();
  const [pw] = useState(() => {
    const words = ['cargo', 'depot', 'route', 'pallet', 'freight', 'tender', 'stock', 'supply'];
    return `${words[Math.floor(Math.random() * words.length)]}${Math.floor(1000 + Math.random() * 9000)}`;
  });
  const [done, setDone] = useState(false);
  async function reset() {
    const ok = await act(() => rpc('reset_student_password', { p_index: student.index_no, p_password: pw }));
    if (ok) setDone(true);
  }
  return (
    <Modal title="Reset password" onClose={onClose}
      footer={done
        ? <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        : <><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={reset} disabled={busy}>Reset password</button></>}>
      <p>{student.full_name} <span className="mono muted">({student.index_no})</span></p>
      {done ? (
        <div className="notice notice-info stack-sm">
          <span>New temporary password — give it to the student privately:</span>
          <span className="mono" style={{ fontSize: 22 }}>{pw}</span>
          <span className="small">Ask them to change it under Account after signing in.</span>
        </div>
      ) : (
        <p className="small muted">A new temporary password will be created. Their old password stops working immediately.</p>
      )}
    </Modal>
  );
}

function EditModal({ student, onClose, onSaved }) {
  const [act, busy] = useAction();
  const [f, setF] = useState({ name: student.full_name, programme: student.programme || '', stream: student.stream || '' });
  async function save() {
    const ok = await act(() => rpc('update_student', { p_index: student.index_no, p_name: f.name, p_programme: f.programme, p_stream: f.stream }), 'Student updated.');
    if (ok !== undefined) { onSaved(); onClose(); }
  }
  return (
    <Modal title={`Edit ${student.index_no}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Save</button></>}>
      <Field label="Full name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid-2">
        <Field label="Programme"><input className="input" value={f.programme} onChange={(e) => setF({ ...f, programme: e.target.value })} placeholder="Marketing" /></Field>
        <Field label="Stream"><input className="input" value={f.stream} onChange={(e) => setF({ ...f, stream: e.target.value })} placeholder="Weekend" /></Field>
      </div>
      <p className="small muted">Programme and stream apply to this student in all your courses.</p>
    </Modal>
  );
}
