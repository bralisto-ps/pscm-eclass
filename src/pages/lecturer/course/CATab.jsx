import { useMemo, useState } from 'react';
import { rpc, rpcAll, run, supabase } from '../../../lib/supabase.js';
import { fmtNumber } from '../../../lib/format.js';
import { downloadWorkbook, parseDelimited } from '../../../lib/sheets.js';
import Icon from '../../../components/Icon.jsx';
import { Confirm, Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../../components/ui.jsx';
import { ALL_GROUPS, GroupFilters, groupLabel, matchesGroup } from '../../../components/Groups.jsx';

const KINDS = [
  { id: 'quizzes', label: 'Quizzes' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'manual', label: 'Marks I enter (e.g. mid-semester exam)' },
];
const kindLabel = (k) => ({ quizzes: 'Quizzes', assignments: 'Assignments', attendance: 'Attendance', manual: 'Entered marks' }[k] || k);

let tempId = 0;
const blank = (kind, weight) => ({
  key: `new-${++tempId}`, id: null, name: { quizzes: 'Quizzes', assignments: 'Assignments', attendance: 'Attendance', manual: 'Mid-semester exam' }[kind],
  kind, weight, item_ids: [], drop_lowest: 0, max_score: kind === 'manual' ? 100 : 100,
});

export default function CATab({ course, onCourseChanged }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [components, quizzes, assignments, rows] = await Promise.all([
      run(supabase.from('ca_components').select('*').eq('course_id', course.id).order('position').order('created_at')),
      run(supabase.from('quizzes').select('id, title').eq('course_id', course.id).eq('published', true).eq('is_practice', false).order('created_at')),
      run(supabase.from('assignments').select('id, title').eq('course_id', course.id).eq('published', true).order('created_at')),
      rpcAll('course_ca', { p_course: course.id }),
    ]);
    return { components: components.map((c) => ({ ...c, key: c.id })), quizzes, assignments, rows };
  }, [course.id]);

  if (loading) return <Loading label="Working out CA scores…" />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  return <CAInner key={data.components.map((c) => c.id).join()} course={course} data={data} reload={reload} onCourseChanged={onCourseChanged} />;
}

function CAInner({ course, data, reload, onCourseChanged }) {
  const toast = useToast();
  const [act, busy] = useAction();
  const [comps, setComps] = useState(data.components);
  const [dirty, setDirty] = useState(false);
  const [settings, setSettings] = useState({ ca_total: course.ca_total ?? 40, ca_decimals: course.ca_decimals ?? 0 });
  const [picking, setPicking] = useState(null);
  const [entering, setEntering] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [group, setGroup] = useState(ALL_GROUPS);
  const [q, setQ] = useState('');

  const totalWeight = comps.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const weightOk = Math.abs(totalWeight - Number(settings.ca_total)) < 0.001;
  const saved = data.components;
  const dec = Number(course.ca_decimals ?? 0);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.rows.filter((r) => matchesGroup(r, group) && (!term || r.full_name.toLowerCase().includes(term) || r.index_no.toLowerCase().includes(term)));
  }, [data.rows, group, q]);
  const avg = rows.length ? rows.reduce((s, r) => s + Number(r.total), 0) / rows.length : null;

  const change = (key, patch) => { setComps(comps.map((c) => (c.key === key ? { ...c, ...patch } : c))); setDirty(true); };
  const add = (kind) => { setComps([...comps, blank(kind, 0)]); setDirty(true); };

  function useTemplate() {
    setComps([blank('quizzes', 10), blank('assignments', 10), blank('attendance', 5), blank('manual', 15)]);
    setSettings({ ...settings, ca_total: 40 });
    setDirty(true);
  }

  async function save() {
    for (const c of comps) {
      if (!String(c.name).trim()) throw new Error('Give every part a name.');
      if (c.kind === 'manual' && !(Number(c.max_score) > 0)) throw new Error(`Set what "${c.name}" is marked out of.`);
    }
    await run(supabase.from('courses').update({ ca_total: Number(settings.ca_total) || 40, ca_decimals: Number(settings.ca_decimals) }).eq('id', course.id));
    const keep = new Set(comps.filter((c) => c.id).map((c) => c.id));
    const gone = saved.filter((c) => !keep.has(c.id)).map((c) => c.id);
    if (gone.length) await run(supabase.from('ca_components').delete().in('id', gone));
    const row = (c, i) => ({
      course_id: course.id, name: String(c.name).trim(), kind: c.kind, weight: Number(c.weight) || 0,
      item_ids: c.item_ids || [], drop_lowest: Number(c.drop_lowest) || 0, max_score: Number(c.max_score) || 100, position: i,
    });
    for (const [i, c] of comps.entries()) {
      if (c.id) await run(supabase.from('ca_components').update(row(c, i)).eq('id', c.id));
      else await run(supabase.from('ca_components').insert(row(c, i)));
    }
    setDirty(false);
    onCourseChanged?.();
    reload();
    return true;
  }

  async function toggleRelease() {
    const next = !course.ca_released;
    const ok = await act(() => run(supabase.from('courses').update({ ca_released: next }).eq('id', course.id)),
      next ? 'Students can now see their CA.' : 'CA hidden from students.');
    if (ok !== undefined) onCourseChanged?.();
  }

  function exportXlsx() {
    const header = ['Index number', 'Name', 'Programme', 'Stream', ...saved.map((c) => `${c.name} (/${fmtNumber(c.weight)})`), `CA (/${fmtNumber(course.ca_total)})`];
    const line = (r) => [r.index_no, r.full_name, r.programme, r.stream,
      ...saved.map((c) => Number(r.parts?.[c.id]?.points ?? 0)), Number(Number(r.total).toFixed(dec))];
    const widths = [16, 30, 18, 12, ...saved.map(() => 16), 12];
    const sheets = [{ name: 'CA — all students', rows: [header, ...data.rows.map(line)], widths }];
    const streams = [...new Set(data.rows.map((r) => r.stream || ''))].sort();
    if (streams.length > 1) streams.forEach((st) => sheets.push({ name: groupLabel(st), rows: [header, ...data.rows.filter((r) => (r.stream || '') === st).map(line)], widths }));
    sheets.push({ name: 'How CA is made up', rows: [['Part', 'Counts', 'Weight', 'Drop lowest', 'Marked out of'],
      ...saved.map((c) => [c.name, kindLabel(c.kind) + (c.item_ids.length ? ` (${c.item_ids.length} chosen)` : ' (all)'), Number(c.weight), c.drop_lowest || '', c.kind === 'manual' ? Number(c.max_score) : ''])], widths: [28, 28, 10, 12, 14] });
    downloadWorkbook(`${course.code} CA.xlsx`, sheets);
  }

  const itemsFor = (c) => (c.kind === 'quizzes' ? data.quizzes : data.assignments);

  return (
    <div className="stack-lg" style={{ maxWidth: 1180 }}>
      <section className="card stack">
        <div className="between" style={{ flexWrap: 'wrap' }}>
          <div className="stack-sm" style={{ gap: 2 }}>
            <h2>How CA is worked out</h2>
            <p className="small muted">Each part's percentage is scaled to its weight. A missed quiz or assignment counts as 0. A quiz that was not open to a student's stream is left out for that student.</p>
          </div>
          <div className="row-wrap">
            <label className="row small" style={{ gap: 6 }}>CA out of
              <input className="input" type="number" min="1" style={{ width: 80, minHeight: 40 }} value={settings.ca_total}
                onChange={(e) => { setSettings({ ...settings, ca_total: e.target.value }); setDirty(true); }} />
            </label>
            <label className="row small" style={{ gap: 6 }}>Round to
              <select className="select" style={{ width: 'auto', minHeight: 40 }} value={settings.ca_decimals}
                onChange={(e) => { setSettings({ ...settings, ca_decimals: e.target.value }); setDirty(true); }}>
                <option value={0}>whole marks</option><option value={1}>1 decimal</option><option value={2}>2 decimals</option>
              </select>
            </label>
          </div>
        </div>

        {comps.length === 0 && (
          <div className="notice notice-info row-wrap">
            <span style={{ flex: 1 }}>No parts yet. Start from a typical 40-mark split (quizzes 10, assignments 10, attendance 5, mid-semester 15) and adjust.</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={useTemplate}>Use this template</button>
          </div>
        )}

        {comps.map((c, i) => (
          <div key={c.key} className="row-wrap" style={{ alignItems: 'flex-end', padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 10, gap: 10 }}>
            <span className="mono strong" style={{ alignSelf: 'center', width: 18 }}>{i + 1}</span>
            <div style={{ flex: '2 1 180px' }}><Field label="Name"><input className="input" value={c.name} onChange={(e) => change(c.key, { name: e.target.value })} /></Field></div>
            <div style={{ flex: '2 1 200px' }}>
              <Field label="Counts">
                <select className="select" value={c.kind} onChange={(e) => change(c.key, { kind: e.target.value, item_ids: [] })}>
                  {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ width: 96 }}><Field label="Weight"><input className="input mono" type="number" min="0" step="0.5" value={c.weight} onChange={(e) => change(c.key, { weight: e.target.value })} /></Field></div>
            {(c.kind === 'quizzes' || c.kind === 'assignments') && (
              <>
                <button type="button" className="btn btn-sm" style={{ minHeight: 44 }} onClick={() => setPicking(c.key)}>
                  {c.item_ids.length ? `${c.item_ids.length} chosen` : `All ${c.kind}`} <Icon name="edit" size={14} />
                </button>
                <div style={{ width: 110 }}><Field label="Drop lowest"><input className="input mono" type="number" min="0" value={c.drop_lowest} onChange={(e) => change(c.key, { drop_lowest: e.target.value })} /></Field></div>
              </>
            )}
            {c.kind === 'manual' && (
              <>
                <div style={{ width: 120 }}><Field label="Marked out of"><input className="input mono" type="number" min="1" value={c.max_score} onChange={(e) => change(c.key, { max_score: e.target.value })} /></Field></div>
                <button type="button" className="btn btn-sm" style={{ minHeight: 44 }} disabled={!c.id || dirty}
                  title={!c.id || dirty ? 'Save the setup first' : ''} onClick={() => setEntering(c)}>Enter marks</button>
              </>
            )}
            <button type="button" className="icon-btn plain" style={{ marginBottom: 2 }} aria-label={`Remove ${c.name}`} onClick={() => setRemoving(c)}><Icon name="trash" /></button>
          </div>
        ))}

        <div className="between" style={{ flexWrap: 'wrap' }}>
          <div className="row-wrap">
            <span className="small muted">Add a part:</span>
            {KINDS.map((k) => <button key={k.id} type="button" className="btn btn-sm" onClick={() => add(k.id)}><Icon name="plus" size={14} /> {kindLabel(k.id)}</button>)}
          </div>
          <div className="row-wrap">
            <span className={`badge ${weightOk ? 'badge-teal' : 'badge-amber'}`}>Weights add up to {fmtNumber(totalWeight)} of {fmtNumber(settings.ca_total)}</span>
            {dirty && <span className="badge badge-amber">Unsaved</span>}
            <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => act(save, 'CA setup saved.')}>Save setup</button>
          </div>
        </div>
      </section>

      <section className="card-flush">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="row-wrap">
            <h2>CA scores</h2>
            <label className="search">
              <span className="sr-only">Search</span>
              <Icon name="search" size={16} />
              <input className="input" style={{ width: 220, minHeight: 40 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or index number" />
            </label>
            <GroupFilters rows={data.rows} value={group} onChange={setGroup} />
          </div>
          <div className="row-wrap">
            {avg !== null && <span className="small muted">Average {fmtNumber(avg, 1)} / {fmtNumber(course.ca_total)}</span>}
            <button type="button" className="btn btn-sm" onClick={exportXlsx} disabled={!saved.length}><Icon name="download" size={16} /> Export to Excel</button>
            <button type="button" className={`btn btn-sm ${course.ca_released ? '' : 'btn-primary'}`} onClick={toggleRelease} disabled={!saved.length}>
              {course.ca_released ? 'Hide CA from students' : 'Show CA to students'}
            </button>
          </div>
        </div>
        {saved.length === 0 ? <Empty icon="chart" title="Set up the CA first">Add the parts above and save. Scores appear here straight away.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Index no.</th><th>Name</th><th className="hide-sm">Group</th>
                  {saved.map((c) => <th key={c.id} className="num" title={kindLabel(c.kind)}>{c.name}<div className="tiny" style={{ textTransform: 'none' }}>/ {fmtNumber(c.weight)}</div></th>)}
                  <th className="num">CA<div className="tiny" style={{ textTransform: 'none' }}>/ {fmtNumber(course.ca_total)}</div></th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map((r) => (
                  <tr key={r.index_no}>
                    <td className="mono small">{r.index_no}</td>
                    <td>{r.full_name}</td>
                    <td className="small muted hide-sm">{[r.programme, r.stream].filter(Boolean).join(' · ') || '—'}</td>
                    {saved.map((c) => <td key={c.id} className="num" title={`${fmtNumber(r.parts?.[c.id]?.pct ?? 0, 1)}%`}>{fmtNumber(r.parts?.[c.id]?.points ?? 0)}</td>)}
                    <td className="num strong">{Number(r.total).toFixed(dec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 400 && <p className="small muted" style={{ padding: '12px 18px' }}>Showing 400 of {rows.length}. Export to Excel for everyone.</p>}
            {rows.length === 0 && <Empty>No students match.</Empty>}
          </div>
        )}
      </section>

      {picking && (() => {
        const c = comps.find((x) => x.key === picking);
        return <PickItems comp={c} items={itemsFor(c)} onClose={() => setPicking(null)} onSave={(ids) => { change(c.key, { item_ids: ids }); setPicking(null); }} />;
      })()}
      {entering && <ManualMarks comp={entering} course={course} onClose={() => setEntering(null)} onSaved={() => { toast('Marks saved.'); reload(); }} />}
      {removing && (
        <Confirm title={`Remove “${removing.name}”?`} danger confirmLabel="Remove"
          message={removing.kind === 'manual' ? 'Any marks entered for this part are deleted when you save.' : 'It stops counting towards the CA when you save.'}
          onClose={() => setRemoving(null)} onConfirm={() => { setComps(comps.filter((c) => c.key !== removing.key)); setDirty(true); setRemoving(null); }} />
      )}
    </div>
  );
}

function PickItems({ comp, items, onClose, onSave }) {
  const [all, setAll] = useState(comp.item_ids.length === 0);
  const [ids, setIds] = useState(new Set(comp.item_ids));
  return (
    <Modal title={`Which ${comp.kind} count?`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!all && ids.size === 0} onClick={() => onSave(all ? [] : [...ids])}>Done</button></>}>
      <label className="check"><input type="radio" checked={all} onChange={() => setAll(true)} /> <span><strong>All published {comp.kind}</strong>, including ones you add later</span></label>
      <label className="check"><input type="radio" checked={!all} onChange={() => setAll(false)} /> <strong>Only these:</strong></label>
      <div className="stack-sm" style={{ paddingLeft: 28, opacity: all ? 0.5 : 1 }}>
        {items.length === 0 && <span className="small muted">None published yet.</span>}
        {items.map((it) => (
          <label key={it.id} className="check">
            <input type="checkbox" disabled={all} checked={ids.has(it.id)} onChange={(e) => {
              const n = new Set(ids); if (e.target.checked) n.add(it.id); else n.delete(it.id); setIds(n);
            }} /> {it.title}
          </label>
        ))}
      </div>
    </Modal>
  );
}

function ManualMarks({ comp, course, onClose, onSaved }) {
  const { data, error, loading } = useLoad(async () => {
    const [students, scores] = await Promise.all([
      rpcAll('course_students', { p_course: course.id }),
      run(supabase.from('ca_scores').select('index_no, score').eq('component_id', comp.id)),
    ]);
    return { students, scores: Object.fromEntries(scores.map((s) => [s.index_no, String(s.score)])) };
  }, [comp.id]);
  const [edits, setEdits] = useState({});
  const [q, setQ] = useState('');
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Modal title={comp.name} onClose={onClose}><Loading /></Modal>;
  if (error) return <Modal title={comp.name} onClose={onClose}><ErrorNote error={error} /></Modal>;

  const value = (idx) => (idx in edits ? edits[idx] : data.scores[idx] ?? '');
  const shown = data.students.filter((s) => !q.trim() || s.full_name.toLowerCase().includes(q.toLowerCase()) || s.index_no.toLowerCase().includes(q.toLowerCase()));
  const max = Number(comp.max_score);

  function applyPaste() {
    const rows = parseDelimited(paste);
    const known = new Set(data.students.map((s) => s.index_no.toUpperCase()));
    const next = { ...edits };
    let n = 0; let unknown = 0;
    for (const r of rows) {
      const idx = String(r[0] || '').trim().toUpperCase().replace(/\s+/g, '');
      const sc = String(r[r.length - 1] || '').trim();
      if (!idx || Number.isNaN(Number(sc)) || sc === '') continue;
      if (!known.has(idx)) { unknown++; continue; }
      next[idx] = sc; n++;
    }
    setEdits(next);
    setPaste('');
    setMsg(`${n} marks filled in${unknown ? `, ${unknown} index numbers not on this course were skipped` : ''}. Press Save to keep them.`);
  }

  async function save() {
    const rows = Object.entries(edits).map(([index_no, score]) => ({ index_no, score: String(score).trim() }));
    const badRow = rows.find((r) => r.score !== '' && (Number.isNaN(Number(r.score)) || Number(r.score) < 0 || Number(r.score) > max));
    if (badRow) return setMsg(`${badRow.index_no}: marks must be between 0 and ${max}.`);
    setBusy(true);
    try {
      for (let i = 0; i < rows.length; i += 500) await rpc('save_ca_scores', { p_component: comp.id, p_rows: rows.slice(i, i + 500) });
      onSaved();
      onClose();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const changed = Object.keys(edits).length;
  return (
    <Modal title={`${comp.name} · marks out of ${fmtNumber(max)}`} onClose={onClose} wide
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !changed}>{busy ? 'Saving…' : `Save ${changed || ''} mark${changed === 1 ? '' : 's'}`}</button></>}>
      <Field label="Paste from Excel" hint="two columns: index number and mark">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <textarea className="textarea mono" style={{ minHeight: 70 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'4021180\t24\n4021214\t19.5'} />
          <button type="button" className="btn btn-sm" disabled={!paste.trim()} onClick={applyPaste}>Fill in</button>
        </div>
      </Field>
      {msg && <div className="notice notice-info">{msg}</div>}
      <label className="search">
        <span className="sr-only">Search</span>
        <Icon name="search" size={16} />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a student" />
      </label>
      <div className="card-flush" style={{ maxHeight: 380, overflowY: 'auto' }}>
        {shown.slice(0, 300).map((s) => (
          <div key={s.index_no} className="list-row" style={{ padding: '6px 14px' }}>
            <span className="mono small" style={{ width: 130 }}>{s.index_no}</span>
            <span className="list-main"><span className="title small">{s.full_name}</span></span>
            <input className="input mono" style={{ width: 100, minHeight: 38, borderColor: s.index_no in edits ? 'var(--teal)' : undefined }}
              aria-label={`Mark for ${s.full_name}`} inputMode="decimal" value={value(s.index_no)}
              onChange={(e) => setEdits({ ...edits, [s.index_no]: e.target.value })} />
          </div>
        ))}
      </div>
      {shown.length > 300 && <span className="tiny muted">Showing 300 — search for others, or paste from Excel.</span>}
    </Modal>
  );
}
