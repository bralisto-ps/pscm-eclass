import { useMemo, useState } from 'react';
import { rpc, rpcAll, run, supabase } from '../../lib/supabase.js';
import { fmtDateTime, fromLocalInput, toLocalInput } from '../../lib/format.js';
import Icon from '../../components/Icon.jsx';
import { Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad } from '../../components/ui.jsx';

// Named students who sit a quiz outside the normal window: a sick student,
// a clash, or a resit. Shown in the quiz builder beside the settings.
export default function SpecialAccess({ quiz, restricted }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [rows, students] = await Promise.all([
      run(supabase.from('quiz_access').select('*').eq('quiz_id', quiz.id).order('created_at')),
      rpcAll('course_students', { p_course: quiz.course_id }),
    ]);
    return { rows, students };
  }, [quiz.id]);
  const [editing, setEditing] = useState(null); // null | 'new' | row
  const [act, busy] = useAction();

  const byIndex = useMemo(() => new Map((data?.students || []).map((s) => [s.index_no, s])), [data]);

  async function remove(row) {
    const ok = await act(() => run(supabase.from('quiz_access').delete().eq('quiz_id', quiz.id).eq('index_no', row.index_no)), 'Special access removed.');
    if (ok !== undefined) reload();
  }

  return (
    <section className="card stack" aria-label="Special access">
      <div className="between">
        <h2>Special access</h2>
        <button type="button" className="btn btn-sm" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> Add students</button>
      </div>
      <p className="tiny muted">
        {restricted
          ? 'This quiz is only for the students listed here. Nobody else can see it.'
          : 'For a student who missed the quiz (illness, a clash) or needs another go. They get their own opening times and, if you like, extra attempts. Everyone else keeps the normal times.'}
      </p>
      {loading && <Loading />}
      <ErrorNote error={error} onRetry={reload} />
      {data && data.rows.length === 0 && (
        <Empty icon="users">{restricted ? 'Add the students who should sit this quiz.' : 'No one yet.'}</Empty>
      )}
      {data && data.rows.length > 0 && (
        <div className="stack-sm">
          {data.rows.map((r) => {
            const s = byIndex.get(r.index_no);
            return (
              <div key={r.index_no} className="stack-sm" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8 }}>
                <div className="between" style={{ alignItems: 'flex-start' }}>
                  <span className="small"><strong>{s?.full_name || r.index_no}</strong> <span className="mono tiny muted">{r.index_no}</span></span>
                  <span className="row" style={{ gap: 2 }}>
                    <button type="button" className="icon-btn plain" aria-label={`Edit special access for ${s?.full_name || r.index_no}`} onClick={() => setEditing(r)}><Icon name="edit" size={16} /></button>
                    <button type="button" className="icon-btn plain" aria-label={`Remove special access for ${s?.full_name || r.index_no}`} onClick={() => remove(r)} disabled={busy}><Icon name="trash" size={16} /></button>
                  </span>
                </div>
                <span className="tiny muted">
                  {r.opens_at || r.closes_at
                    ? `${r.opens_at ? fmtDateTime(r.opens_at) : 'Now'} → ${r.closes_at ? fmtDateTime(r.closes_at) : 'no closing time'}`
                    : 'Same times as the quiz'}
                  {r.extra_attempts > 0 ? ` · +${r.extra_attempts} attempt${r.extra_attempts === 1 ? '' : 's'}` : ''}
                  {r.note ? ` · ${r.note}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {editing && data && (
        <AccessModal quiz={quiz} students={data.students} row={editing === 'new' ? null : editing}
          taken={new Set(data.rows.map((r) => r.index_no))}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </section>
  );
}

function AccessModal({ quiz, students, row, taken, onClose, onSaved }) {
  const [act, busy] = useAction();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Set(row ? [row.index_no] : []));
  const [opens, setOpens] = useState(toLocalInput(row?.opens_at));
  const [closes, setCloses] = useState(toLocalInput(row?.closes_at));
  const [extra, setExtra] = useState(row?.extra_attempts ?? 0);
  const [note, setNote] = useState(row?.note || '');

  const term = q.trim().toLowerCase();
  const list = students.filter((s) => (!row ? !taken.has(s.index_no) : s.index_no === row.index_no)
    && (!term || s.full_name.toLowerCase().includes(term) || s.index_no.toLowerCase().includes(term)));

  function toggle(idx) {
    const next = new Set(picked);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setPicked(next);
  }

  async function save() {
    if (!picked.size) throw new Error('Choose at least one student.');
    if (opens && closes && new Date(closes) <= new Date(opens)) throw new Error('The closing time must be after the opening time.');
    const rows = [...picked].map((index_no) => ({
      index_no, opens_at: fromLocalInput(opens) || '', closes_at: fromLocalInput(closes) || '',
      extra_attempts: Math.max(0, Math.min(10, Number(extra) || 0)), note: note.trim(),
    }));
    await rpc('save_quiz_access', { p_quiz: quiz.id, p_rows: rows });
    return rows.length;
  }

  return (
    <Modal title={row ? 'Edit special access' : 'Give special access'} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy || !picked.size}
          onClick={async () => { const n = await act(save, 'Special access saved.'); if (n !== undefined) onSaved(); }}>
          Save{picked.size > 1 ? ` for ${picked.size} students` : ''}
        </button>
      </>}>
      {!row && (
        <>
          <label className="search">
            <span className="sr-only">Find a student</span>
            <Icon name="search" size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or index number" autoFocus />
          </label>
          <div className="card-flush" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {list.slice(0, 200).map((s) => (
              <label key={s.index_no} className="list-row" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.has(s.index_no)} onChange={() => toggle(s.index_no)}
                  aria-label={`Choose ${s.full_name}`} style={{ width: 18, height: 18, accentColor: 'var(--teal)' }} />
                <span className="mono small" style={{ width: 130 }}>{s.index_no}</span>
                <span className="list-main"><span className="title">{s.full_name}</span></span>
                <span className="tiny muted">{s.stream}</span>
              </label>
            ))}
            {list.length === 0 && <Empty>No students match.</Empty>}
          </div>
          {picked.size > 0 && <span className="tiny muted">{picked.size} chosen</span>}
        </>
      )}
      <div className="grid-2" style={{ gap: 10 }}>
        <Field label="Opens" hint="blank = same as the quiz"><input className="input" type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} /></Field>
        <Field label="Closes" hint="blank = same as the quiz"><input className="input" type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} /></Field>
      </div>
      <div className="grid-2" style={{ gap: 10 }}>
        <Field label="Extra attempts"><input className="input" type="number" min="0" max="10" value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
        <Field label="Reason" hint="only you see this"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sick note, resit…" /></Field>
      </div>
      <p className="tiny muted">If the student already used their attempt, add an extra attempt so they can start again.</p>
    </Modal>
  );
}
