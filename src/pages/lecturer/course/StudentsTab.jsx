import { useEffect, useMemo, useState } from 'react';
import { rpc, rpcAll, run, supabase } from '../../../lib/supabase.js';
import { fmtFull, relative } from '../../../lib/format.js';
import { downloadExcel, downloadText, parseDelimited, readStudentFile, rowsToStudents } from '../../../lib/sheets.js';
import Icon from '../../../components/Icon.jsx';
import { Confirm, Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../../components/ui.jsx';
import { ALL_GROUPS, GroupFilters, matchesGroup } from '../../../components/Groups.jsx';

export default function StudentsTab({ course, ta }) {
  const { data: loaded, error, loading, reload } = useLoad(async () => {
    const [students, options] = await Promise.all([
      rpcAll('course_students', { p_course: course.id }),
      run(supabase.from('group_options').select('kind, name').order('name')),
    ]);
    return {
      students,
      programmes: options.filter((o) => o.kind === 'programme').map((o) => o.name),
      streams: options.filter((o) => o.kind === 'stream').map((o) => o.name),
    };
  }, [course.id]);
  const data = loaded?.students;
  const [selected, setSelected] = useState(() => new Set());
  const [risk, setRisk] = useState(null); // null = not loaded; Map index → row
  const [riskErr, setRiskErr] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [outreach, setOutreach] = useState(false);
  const [targetStudent, setTargetStudent] = useState(null);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [editing, setEditing] = useState(null);
  const [group, setGroup] = useState(ALL_GROUPS);
  const [act, busy] = useAction();
  useEffect(() => {
    if (filter !== 'risk' || risk) return;
    rpcAll('course_at_risk', { p_course: course.id })
      .then((rows) => setRisk(new Map(rows.map((r) => [r.index_no, r]))))
      .catch((e) => setRiskErr(e.message));
  }, [filter, risk, course.id]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data || []).filter((r) =>
      (filter === 'all' || (filter === 'risk' ? risk?.has(r.index_no) : filter === 'active' ? r.activated : !r.activated)) && matchesGroup(r, group) &&
      (!term || r.index_no.toLowerCase().includes(term) || r.full_name.toLowerCase().includes(term)));
  }, [data, q, filter, group, risk]);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  const activated = data.filter((r) => r.activated).length;
  const { programmes, streams } = loaded;
  const allShownSelected = rows.length > 0 && rows.every((r) => selected.has(r.index_no));
  const toggle = (idx) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(rows.map((r) => r.index_no)));

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

      {!ta && (
        <details className="card" style={{ padding: '12px 18px', background: 'var(--surface)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="tag" size={16} /> Manage All Programmes & Streams
            <span className="small muted">
              ({[...new Set(data.map((r) => r.programme).filter(Boolean))].length} active in this course)
            </span>
          </summary>
          <div style={{ marginTop: 14 }}>
            <GroupManager programmes={programmes} streams={streams} students={data} onChanged={reload} />
          </div>
        </details>
      )}

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
              <button type="button" className="chip" aria-pressed={filter === 'risk'} onClick={() => setFilter('risk')}>At risk{risk ? ` · ${risk.size}` : ''}</button>
            </div>
            <GroupFilters rows={data} value={group} onChange={setGroup} />
          </div>
          <div className="row-wrap">
            <button type="button" className="btn btn-sm" style={{ borderColor: "#fca5a5", color: "#991b1b", background: "#fef2f2" }} onClick={() => setOutreach(true)} title="Send academic advisory to at-risk students"><Icon name="chat" size={16} /> At-Risk Outreach</button>
            {data.length > 0 && <button type="button" className="btn btn-sm" onClick={exportList}><Icon name="download" size={16} /> Export</button>}
            {!ta && <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add student</button>}
            {!ta && <button type="button" className="btn btn-sm btn-primary" onClick={() => setImporting(true)}><Icon name="upload" size={16} /> Upload class list</button>}
          </div>
        </div>

        {!ta && selected.size > 0 && (
          <BulkAssign
            indexes={[...selected]}
            programmes={programmes}
            streams={streams}
            onClear={() => setSelected(new Set())}
            onDone={() => { setSelected(new Set()); reload(); }}
          />
        )}

        {filter === 'risk' && (
          <div className="notice notice-warn" style={{ margin: '12px 18px' }}>
            {riskErr || (risk ? 'Students who never activated, have not signed in for 2 weeks, missed 2+ closed quizzes, average under 40% on quizzes, or attend under 50% (once there are 3+ sessions). A good list to follow up before mid-semester.' : 'Checking…')}
          </div>
        )}

        {data.length === 0 ? (
          <Empty icon="users" title="No students yet" action={ta ? null : <button type="button" className="btn btn-primary" onClick={() => setImporting(true)}>Upload class list</button>}>
            Upload an Excel or CSV file with index numbers and names. Students can then activate their accounts.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>{!ta && <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all shown students" checked={allShownSelected} onChange={toggleAll} style={{ width: 18, height: 18, accentColor: 'var(--teal)' }} /></th>}<th>Index no.</th><th>Name</th><th>Programme</th><th>Stream</th><th>{filter === 'risk' ? 'Why' : 'Account'}</th><th className="hide-sm">Last sign-in</th><th /></tr></thead>
              <tbody>
                {rows.slice(0, 300).map((r) => (
                  <tr key={r.index_no} style={selected.has(r.index_no) ? { background: 'var(--teal-50)' } : undefined}>
                    {!ta && <td><input type="checkbox" aria-label={`Select ${r.full_name}`} checked={selected.has(r.index_no)} onChange={() => toggle(r.index_no)} style={{ width: 18, height: 18, accentColor: 'var(--teal)' }} /></td>}
                    <td className="mono small">{r.index_no}</td>
                    <td>{r.full_name}</td>
                    <td className="small">{r.programme || <span className="muted">—</span>}</td>
                    <td className="small">{r.stream || <span className="muted">—</span>}</td>
                    <td>{filter === 'risk' && risk?.get(r.index_no) ? (
                      <div className="row-wrap" style={{ gap: 4 }}>{risk.get(r.index_no).reasons.map((x) => <span key={x} className="badge badge-amber">{x}</span>)}</div>
                    ) : r.activated ? <span className="badge badge-teal">Activated</span> : <span className="badge">Not yet</span>}</td>
                    <td className="small muted hide-sm">{r.last_sign_in ? relative(r.last_sign_in) : '—'}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <button type="button" className="icon-btn plain" title={`Send academic advisory to ${r.full_name}`} onClick={() => setTargetStudent(r)}><Icon name="chat" size={16} /></button>
                        {r.activated && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setResetting(r)}><Icon name="key" size={16} /> Reset password</button>}
                        {!ta && <button type="button" className="icon-btn plain" aria-label={`Edit ${r.full_name}`} onClick={() => setEditing(r)}><Icon name="edit" /></button>}
                        {!ta && <button type="button" className="icon-btn plain" aria-label={`Remove ${r.full_name} from course`} onClick={() => setRemoving(r)}><Icon name="trash" /></button>}
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

      {adding && <AddStudentModal course={course} programmes={programmes} streams={streams} onClose={() => setAdding(false)} onDone={reload} />}
      {importing && <ImportModal course={course} onClose={() => setImporting(false)} onDone={reload} />}
      {resetting && <ResetModal student={resetting} onClose={() => setResetting(null)} />}
      {editing && <EditModal student={editing} programmes={programmes} streams={streams} onClose={() => setEditing(null)} onSaved={reload} />}
      {(outreach || targetStudent) && (
        <AtRiskOutreachModal
          course={course}
          students={data}
          riskMap={risk}
          preSelectedStudent={targetStudent}
          onClose={() => { setOutreach(false); setTargetStudent(null); }}
        />
      )}
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

function GroupSelect({ label, value, options, onChange, allowKeep }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  if (adding) {
    return (
      <Field label={label}>
        <div className="row" style={{ gap: 6 }}>
          <input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={`New ${label.toLowerCase()}`}
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onChange(text.trim()); setAdding(false); } }} />
          <button type="button" className="btn btn-sm" disabled={!text.trim()} onClick={() => { onChange(text.trim()); setAdding(false); }}>OK</button>
        </div>
      </Field>
    );
  }
  return (
    <Field label={label}>
      <select className="select" value={value ?? '__keep'} onChange={(e) => {
        if (e.target.value === '__new') { setText(''); setAdding(true); } else onChange(e.target.value === '__keep' ? null : e.target.value);
      }}>
        {allowKeep && <option value="__keep">Leave unchanged</option>}
        <option value="">Not set</option>
        {[...new Set([...options, ...(value ? [value] : [])])].map((o) => <option key={o} value={o}>{o}</option>)}
        <option value="__new">+ New {label.toLowerCase()}…</option>
      </select>
    </Field>
  );
}

function BulkAssign({ indexes, programmes, streams, onClear, onDone }) {
  const [act, busy] = useAction();
  const [prog, setProg] = useState(null);
  const [stream, setStream] = useState(null);
  async function apply() {
    const n = await act(() => rpc('assign_group', { p_indexes: indexes, p_programme: prog, p_stream: stream }));
    if (n !== undefined) onDone(n);
  }
  return (
    <div className="row-wrap" style={{ padding: '12px 18px', background: 'var(--teal-50)', borderBottom: '1px solid var(--line-2)', alignItems: 'flex-end' }}>
      <strong className="small" style={{ alignSelf: 'center' }}>{indexes.length} selected</strong>
      <div style={{ width: 200 }}><GroupSelect label="Programme" value={prog} options={programmes} onChange={setProg} allowKeep /></div>
      <div style={{ width: 200 }}><GroupSelect label="Stream" value={stream} options={streams} onChange={setStream} allowKeep /></div>
      <button type="button" className="btn btn-primary" disabled={busy || (prog === null && stream === null)} onClick={apply}>Apply to {indexes.length}</button>
      <button type="button" className="btn btn-ghost" onClick={onClear}>Clear selection</button>
    </div>
  );
}

function GroupManager({ programmes, streams, students = [], onChanged }) {
  const [act, busy] = useAction();
  const [renaming, setRenaming] = useState(null); // { kind, name, value }
  const [removing, setRemoving] = useState(null);
  const [newName, setNewName] = useState({ programme: "", stream: "" });

  const safeStudents = students || [];
  const count = (kind, name) =>
    safeStudents.filter(
      (r) =>
        (kind === "programme"
          ? (r.programme || "").trim().toLowerCase()
          : (r.stream || "").trim().toLowerCase()) ===
        (name || "").trim().toLowerCase()
    ).length;

  async function add(kind, customName) {
    const name = (customName || newName[kind] || "").trim();
    if (!name) return;
    const ok = await act(
      () =>
        run(
          supabase
            .from("group_options")
            .upsert(
              { kind, name },
              { onConflict: "kind,name", ignoreDuplicates: true }
            )
        ),
      `${name} added.`
    );
    if (ok !== undefined) {
      setNewName({ ...newName, [kind]: "" });
      onChanged();
    }
  }

  async function rename() {
    const ok = await act(
      () =>
        rpc("rename_group", {
          p_kind: renaming.kind,
          p_old: renaming.name,
          p_new: renaming.value,
        }),
      "Renamed."
    );
    if (ok !== undefined) {
      setRenaming(null);
      onChanged();
    }
  }

  async function remove() {
    const ok = await act(
      () =>
        rpc("delete_group", {
          p_kind: removing.kind,
          p_name: removing.name,
        }),
      "Removed."
    );
    if (ok !== undefined) {
      setRemoving(null);
      onChanged();
    }
  }

  const column = (kind, title, list, example) => {
    // Only show groups that have students in THIS course
    const active = list.filter((name) => count(kind, name) > 0);
    // Other programmes/streams in university with 0 students in this course
    const unused = list.filter((name) => count(kind, name) === 0);

    return (
      <div className="stack-sm" style={{ flex: 1, minWidth: 260 }}>
        <div className="between" style={{ alignItems: "baseline" }}>
          <span className="eyebrow">{title} in this course</span>
          <span className="tiny muted">{active.length} active</span>
        </div>

        <div className="stack-sm" style={{ gap: 6 }}>
          {active.length === 0 ? (
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 8,
                background: "var(--surface-2, rgba(0,0,0,0.02))",
                border: "1px dashed var(--line)",
              }}
              className="small muted"
            >
              No {title.toLowerCase()} assigned to students in this course yet.
              Upload a class list with {title} or select an existing one below.
            </div>
          ) : (
            active.map((name) => {
              const cnt = count(kind, name);
              return (
                <div
                  key={name}
                  className="between"
                  style={{
                    padding: "8px 12px",
                    border: "1px solid var(--teal, #0d9488)",
                    borderRadius: 8,
                    background: "var(--surface)",
                  }}
                >
                  <span className="small">
                    <strong>{name}</strong>{" "}
                    <span className="badge badge-teal" style={{ marginLeft: 6, fontSize: 11 }}>
                      {cnt} student{cnt === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 2 }}>
                    <button
                      type="button"
                      className="icon-btn plain"
                      aria-label={`Rename ${name}`}
                      onClick={() => setRenaming({ kind, name, value: name })}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn plain"
                      aria-label={`Remove ${name}`}
                      onClick={() => setRemoving({ kind, name })}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Dropdown for other university programmes */}
        {unused.length > 0 && (
          <div className="stack-sm" style={{ marginTop: 8 }}>
            <label className="tiny muted" htmlFor={`other-${kind}`}>
              Add from {unused.length} other university {kind}s:
            </label>
            <select
              id={`other-${kind}`}
              className="select"
              style={{ minHeight: 36, fontSize: 13 }}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  add(kind, e.target.value);
                  e.target.value = "";
                }
              }}
            >
              <option value="" disabled>
                -- Choose from {unused.length} other {kind}s --
              </option>
              {unused.map((u) => (
                <option key={u} value={u}>
                  {u} (0 in this course)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Create brand new programme/stream input */}
        <div className="row" style={{ gap: 6, marginTop: 4 }}>
          <label className="sr-only" htmlFor={`new-${kind}`}>
            Create new {kind}
          </label>
          <input
            id={`new-${kind}`}
            className="input"
            style={{ minHeight: 38, fontSize: 13 }}
            value={newName[kind]}
            placeholder={`Create new ${kind}, e.g. ${example}`}
            onChange={(e) => setNewName({ ...newName, [kind]: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && add(kind)}
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !newName[kind].trim()}
            onClick={() => add(kind)}
          >
            <Icon name="plus" size={14} /> Add
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className="card stack">
      <div className="stack-sm" style={{ gap: 2 }}>
        <h2>Programmes and streams</h2>
        <p className="small muted">
          Create the groups here, then tick students in the list below to assign them — or include Programme and Stream columns
          when you upload a class list. These groups are shared across all your courses.
        </p>
      </div>
      <div className="row-wrap" style={{ alignItems: 'flex-start', gap: 24 }}>
        {column('programme', 'Programmes', programmes, 'Marketing')}
        {column('stream', 'Streams', streams, 'Weekend')}
      </div>

      {renaming && (
        <Modal title={`Rename ${renaming.kind}`} onClose={() => setRenaming(null)}
          footer={<><button type="button" className="btn" onClick={() => setRenaming(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={rename} disabled={busy || !renaming.value.trim()}>Rename</button></>}>
          <Field label="New name"><input className="input" autoFocus value={renaming.value} onChange={(e) => setRenaming({ ...renaming, value: e.target.value })} /></Field>
          <p className="small muted">Every student in “{renaming.name}” moves to the new name, in all courses.</p>
        </Modal>
      )}
      {removing && (
        <Confirm title={`Remove “${removing.name}”?`} danger confirmLabel="Remove" busy={busy}
          message={`Students in ${removing.name} will have no ${removing.kind}. Their scores are kept.${removing.kind === 'stream' ? ' Any quiz times set for this stream are removed.' : ''}`}
          onClose={() => setRemoving(null)} onConfirm={remove} />
      )}
    </section>
  );
}

function AddStudentModal({ course, programmes, streams, onClose, onDone }) {
  const [act, busy] = useAction();
  const [f, setF] = useState({ index_no: '', full_name: '', programme: '', stream: '' });

  async function save(e) {
    e?.preventDefault();
    const idx = f.index_no.trim();
    const name = f.full_name.trim();
    if (!idx) throw new Error('Please enter an index number.');
    if (!name) throw new Error('Please enter the student full name.');

    await act(() => rpc('import_roster', {
      p_course: course.id,
      p_rows: [{ index_no: idx, full_name: name, programme: f.programme, stream: f.stream }]
    }), 'Student added to course.');
    onDone();
    onClose();
  }

  return (
    <Modal title="Add student to course" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Add student</button></>}>
      <form onSubmit={save} className="stack">
        <Field label="Index number *">
          <input className="input mono" placeholder="e.g. PSCM/2024/001" value={f.index_no} onChange={(e) => setF({ ...f, index_no: e.target.value })} required autoFocus />
        </Field>
        <Field label="Full name *">
          <input className="input" placeholder="e.g. John Mensah" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required />
        </Field>
        <div className="grid-2">
          <GroupSelect label="Programme (optional)" value={f.programme} options={programmes} onChange={(v) => setF({ ...f, programme: v ?? '' })} />
          <GroupSelect label="Stream (optional)" value={f.stream} options={streams} onChange={(v) => setF({ ...f, stream: v ?? '' })} />
        </div>
      </form>
    </Modal>
  );
}

function EditModal({ student, programmes, streams, onClose, onSaved }) {
  const [act, busy] = useAction();
  const [f, setF] = useState({ index_no: student.index_no, name: student.full_name, programme: student.programme || '', stream: student.stream || '' });
  async function save() {
    const idx = f.index_no.trim();
    const name = f.name.trim();
    if (!idx) throw new Error('Index number cannot be empty.');
    if (!name) throw new Error('Full name cannot be empty.');
    const ok = await act(() => rpc('update_student', {
      p_index: student.index_no,
      p_name: name,
      p_programme: f.programme,
      p_stream: f.stream,
      p_new_index: idx !== student.index_no ? idx : null
    }), 'Student updated.');
    if (ok !== undefined) { onSaved(); onClose(); }
  }
  return (
    <Modal title={`Edit student`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>Save changes</button></>}>
      <Field label="Index number">
        <input className="input mono" value={f.index_no} onChange={(e) => setF({ ...f, index_no: e.target.value })} />
      </Field>
      <Field label="Full name">
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <div className="grid-2">
        <GroupSelect label="Programme" value={f.programme} options={programmes} onChange={(v) => setF({ ...f, programme: v ?? '' })} />
        <GroupSelect label="Stream" value={f.stream} options={streams} onChange={(v) => setF({ ...f, stream: v ?? '' })} />
      </div>
      <p className="small muted">Updating the index number will automatically update all enrolled courses and grade records for this student.</p>
    </Modal>
  );
}


function AtRiskOutreachModal({ course, students, riskMap, preSelectedStudent, onClose }) {
  const toast = useToast();
  const [act, busy] = useAction();
  const [template, setTemplate] = useState('attendance');
  const [riskData, setRiskData] = useState(() => riskMap || new Map());
  const [loadingRisk, setLoadingRisk] = useState(!riskMap);
  const [filterType, setFilterType] = useState(preSelectedStudent ? 'single' : 'all');
  const [selected, setSelected] = useState(() => {
    if (preSelectedStudent) return new Set([preSelectedStudent.index_no]);
    return new Set();
  });

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [unactivatedList, setUnactivatedList] = useState([]);

  useEffect(() => {
    if (riskMap) {
      setRiskData(riskMap);
      if (!preSelectedStudent) setSelected(new Set(riskMap.keys()));
      return;
    }
    rpcAll('course_at_risk', { p_course: course.id })
      .then((rows) => {
        const m = new Map(rows.map((r) => [r.index_no, r]));
        setRiskData(m);
        if (!preSelectedStudent) setSelected(new Set(m.keys()));
      })
      .catch((err) => console.warn('Could not load at-risk students:', err))
      .finally(() => setLoadingRisk(false));
  }, [course.id, riskMap, preSelectedStudent]);

  useEffect(() => {
    if (template === 'attendance') {
      setSubject(`Academic Notice: Course Attendance Warning & Examination Eligibility (${course.code})`);
      setMessage([
        'Dear Student,',
        '',
        `Our attendance records indicate that your current attendance in ${course.code} is below the mandatory 75% institutional threshold required to qualify for the final semester examination.`,
        '',
        'Under university academic regulations, regular attendance is a prerequisite for writing the end-of-semester examination. Please treat this notice as an urgent advisory and attend all upcoming lectures. If you have legitimate grounds for past absences or need academic assistance, please reply directly to this message or visit during office hours.',
        '',
        'Best regards,',
        'Course Instructor'
      ].join('\n'));
    } else if (template === 'grades') {
      setSubject(`Academic Advisory: Continuous Assessment Standing (${course.code})`);
      setMessage([
        'Dear Student,',
        '',
        `This is an academic advisory regarding your Continuous Assessment (CA) performance in ${course.code}. Your current cumulative score is below the 50% pass mark.`,
        '',
        'With Continuous Assessment accounting for 40% of your total grade and the Final Examination accounting for 60%, it is critical that you take active measures to improve your performance. I strongly encourage you to review past quizzes, utilize the flashcard revision tool, and visit during office hours for guidance.',
        '',
        'Best regards,',
        'Course Instructor'
      ].join('\n'));
    } else if (template === 'office_hours') {
      setSubject(`Academic Consultation & Office Hours Invitation (${course.code})`);
      setMessage([
        'Dear Student,',
        '',
        `I am reaching out to check in on your academic progress in ${course.code}. If you are encountering challenges with any lecture topics, assignments, or quizzes, please reply to this message or attend this week\'s scheduled office hours so we can support you.`,
        '',
        'Best regards,',
        'Course Instructor'
      ].join('\n'));
    }
  }, [template, course.code]);

  const flaggedList = useMemo(() => {
    return students.filter((s) => {
      if (preSelectedStudent && preSelectedStudent.index_no === s.index_no) return true;
      const r = riskData.get(s.index_no);
      if (!r) return false;
      if (filterType === 'attendance') return (r.attendance_pct !== null && r.attendance_pct < 75) || (r.reasons && r.reasons.some((x) => x.toLowerCase().includes('attend')));
      if (filterType === 'grades') return (r.avg_pct !== null && r.avg_pct < 50) || (r.reasons && r.reasons.some((x) => x.toLowerCase().includes('quiz') || x.toLowerCase().includes('40%')));
      if (filterType === 'inactive') return !s.activated || (r.reasons && r.reasons.some((x) => x.toLowerCase().includes('sign in') || x.toLowerCase().includes('activate')));
      return true;
    });
  }, [students, riskData, filterType, preSelectedStudent]);

  const toggle = (idx) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === flaggedList.length) setSelected(new Set());
    else setSelected(new Set(flaggedList.map((s) => s.index_no)));
  };

  async function dispatchAdvisories() {
    if (!subject.trim()) throw new Error('Please enter a subject line.');
    if (!message.trim()) throw new Error('Please enter a message body.');
    if (selected.size === 0) throw new Error('Please select at least one student.');

    const targetIndexes = [...selected];
    const profiles = await run(
      supabase.from('profiles').select('id, index_no, full_name').in('index_no', targetIndexes)
    );

    const activeMap = new Map((profiles || []).map((p) => [p.index_no, p]));
    const activeStudents = targetIndexes.map((idx) => activeMap.get(idx)).filter(Boolean);
    const unactivated = targetIndexes.filter((idx) => !activeMap.has(idx));

    if (unactivated.length > 0) {
      setUnactivatedList(students.filter((s) => unactivated.includes(s.index_no)));
    }

    if (activeStudents.length === 0) {
      throw new Error(`None of the selected ${targetIndexes.length} students have activated their accounts yet. See the unactivated list below to reach them.`);
    }

    await act(async () => {
      const inserts = activeStudents.map((p) => ({
        course_id: course.id,
        student_id: p.id,
        subject: subject.trim(),
        message: message.trim(),
      }));

      for (let i = 0; i < inserts.length; i += 100) {
        await run(supabase.from('course_messages').insert(inserts.slice(i, i + 100)));
      }
    }, `Dispatched academic advisory to ${activeStudents.length} active student${activeStudents.length === 1 ? '' : 's'}.`);

    if (unactivated.length === 0) {
      onClose();
    }
  }

  function copyUnactivated() {
    const text = unactivatedList.map((s) => `${s.index_no} - ${s.full_name} (${s.programme || 'No Prog'})`).join('\n');
    navigator.clipboard.writeText(text);
    toast('Copied unactivated index numbers to clipboard.');
  }

  return (
    <Modal
      title={
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="chat" size={18} style={{ color: 'var(--red-ink)' }} />
          <span>At-Risk Student Outreach · {course.code}</span>
        </div>
      }
      onClose={onClose}
      wide
      footer={
        <div className="between" style={{ width: '100%', flexWrap: 'wrap', gap: 10 }}>
          <span className="small muted">
            {selected.size} of {flaggedList.length} student{flaggedList.length === 1 ? '' : 's'} selected
          </span>
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={dispatchAdvisories} disabled={busy || selected.size === 0}>
              {busy ? 'Sending…' : `Send Advisory Notices (${selected.size})`}
            </button>
          </div>
        </div>
      }
    >
      <div className="stack">
        <div className="notice notice-warn small">
          <strong>Automated Academic Advisory:</strong> Identifies students with attendance under 75% (the mandatory university exam threshold), CA scores below 50%, or inactive accounts, and delivers private advisory notices directly into their student portal.
        </div>

        {!preSelectedStudent && (
          <div className="chips" role="group" aria-label="Filter flagged students">
            <button type="button" className="chip" aria-pressed={filterType === 'all'} onClick={() => setFilterType('all')}>
              All Flagged ({riskData.size})
            </button>
            <button type="button" className="chip" aria-pressed={filterType === 'attendance'} onClick={() => setFilterType('attendance')}>
              Attendance &lt; 75%
            </button>
            <button type="button" className="chip" aria-pressed={filterType === 'grades'} onClick={() => setFilterType('grades')}>
              CA Score &lt; 50%
            </button>
            <button type="button" className="chip" aria-pressed={filterType === 'inactive'} onClick={() => setFilterType('inactive')}>
              Inactive / Unactivated
            </button>
          </div>
        )}

        <div className="card-flush" style={{ maxHeight: 220, overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={flaggedList.length > 0 && selected.size === flaggedList.length}
                    onChange={toggleAll}
                    style={{ width: 16, height: 16, accentColor: 'var(--teal)' }}
                  />
                </th>
                <th>Index no.</th>
                <th>Name</th>
                <th>Programme/Stream</th>
                <th>Risk Indicators</th>
              </tr>
            </thead>
            <tbody>
              {flaggedList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted small" style={{ textAlign: 'center', padding: 18 }}>
                    {loadingRisk ? 'Loading student records…' : 'No students match this risk filter.'}
                  </td>
                </tr>
              ) : (
                flaggedList.map((s) => {
                  const r = riskData.get(s.index_no);
                  const reasons = r?.reasons || (!s.activated ? ['Not activated'] : ['Academic follow-up']);
                  return (
                    <tr key={s.index_no} style={selected.has(s.index_no) ? { background: 'var(--teal-50)' } : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(s.index_no)}
                          onChange={() => toggle(s.index_no)}
                          style={{ width: 16, height: 16, accentColor: 'var(--teal)' }}
                        />
                      </td>
                      <td className="mono small">{s.index_no}</td>
                      <td className="small strong">{s.full_name}</td>
                      <td className="small muted">{[s.programme, s.stream].filter(Boolean).join(' · ') || '—'}</td>
                      <td>
                        <div className="row-wrap" style={{ gap: 4 }}>
                          {reasons.map((re, k) => (
                            <span key={k} className="badge badge-amber" style={{ fontSize: 11, padding: '2px 6px' }}>
                              {re}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="stack-sm">
          <span className="field-label">Choose Advisory Template:</span>
          <div className="row-wrap" style={{ gap: 8 }}>
            <button
              type="button"
              className={`btn btn-sm ${template === 'attendance' ? 'btn-primary' : ''}`}
              onClick={() => setTemplate('attendance')}
            >
              1. Attendance &lt; 75% Warning
            </button>
            <button
              type="button"
              className={`btn btn-sm ${template === 'grades' ? 'btn-primary' : ''}`}
              onClick={() => setTemplate('grades')}
            >
              2. CA &lt; 50% Advisory
            </button>
            <button
              type="button"
              className={`btn btn-sm ${template === 'office_hours' ? 'btn-primary' : ''}`}
              onClick={() => setTemplate('office_hours')}
            >
              3. Office Hours Consultation
            </button>
          </div>
        </div>

        <Field label="Message Subject *">
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </Field>

        <Field label="Message Body (Delivered to Student Portal) *">
          <textarea className="input textarea" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} required />
        </Field>

        {unactivatedList.length > 0 && (
          <div className="notice notice-warn small stack-sm">
            <div className="between">
              <strong>{unactivatedList.length} student(s) have not activated their accounts yet:</strong>
              <button type="button" className="btn btn-sm btn-ghost" onClick={copyUnactivated}>
                Copy List
              </button>
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>
              These students cannot receive portal messages until they activate. You can copy their index numbers to forward to class representatives or departmental admins.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
