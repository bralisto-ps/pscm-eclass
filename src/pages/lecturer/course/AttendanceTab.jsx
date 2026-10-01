import { useEffect, useMemo, useRef, useState } from 'react';
import { rpc, rpcAll, run, supabase } from '../../../lib/supabase.js';
import { fmtDateTime, fmtFull } from '../../../lib/format.js';
import { downloadWorkbook } from '../../../lib/sheets.js';
import Icon from '../../../components/Icon.jsx';
import { Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad } from '../../../components/ui.jsx';
import { ALL_GROUPS, GroupFilters, matchesGroup } from '../../../components/Groups.jsx';

export default function AttendanceTab({ course }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [sessions, students, opts] = await Promise.all([
      run(supabase.from('attendance_sessions').select('id, title, streams, opens_at, closes_at, attendance(count)')
        .eq('course_id', course.id).order('opens_at', { ascending: false })),
      rpcAll('course_attendance', { p_course: course.id }),
      run(supabase.from('group_options').select('name').eq('kind', 'stream').order('name')),
    ]);
    return { sessions, students, streams: opts.map((o) => o.name) };
  }, [course.id]);
  const [live, setLive] = useState(null);
  const [starting, setStarting] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [group, setGroup] = useState(ALL_GROUPS);
  const [low, setLow] = useState(false);
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.students || []).filter((r) => matchesGroup(r, group)
      && (!low || (r.applicable > 0 && r.attended / r.applicable < 0.5))
      && (!term || r.full_name.toLowerCase().includes(term) || r.index_no.toLowerCase().includes(term)));
  }, [data, group, low, q]);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  const now = Date.now();
  const openSession = data.sessions.find((s) => new Date(s.opens_at).getTime() <= now && new Date(s.closes_at).getTime() > now);
  const pct = (r) => (r.applicable ? Math.round((r.attended / r.applicable) * 100) : null);
  const lowCount = data.students.filter((r) => r.applicable > 0 && r.attended / r.applicable < 0.5).length;

  function exportXlsx() {
    const sess = [...data.sessions].reverse();
    const header = ['Index number', 'Name', 'Programme', 'Stream', 'Attended', 'Out of', 'Percent', ...sess.map((s) => `${s.title}`)];
    const line = (r) => [r.index_no, r.full_name, r.programme, r.stream, r.attended, r.applicable, pct(r) ?? '',
      ...sess.map((s) => (r.sessions.includes(s.id) ? 'P' : (!s.streams.length || s.streams.map((x) => x.toLowerCase()).includes((r.stream || '').toLowerCase()) ? 'A' : '')))];
    downloadWorkbook(`${course.code} attendance.xlsx`, [
      { name: 'Attendance', rows: [header, ...data.students.map(line)], widths: [16, 30, 18, 12, 10, 8, 9, ...sess.map(() => 14)] },
    ]);
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 1100 }}>
      <section className="card between" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div className="stack-sm" style={{ maxWidth: 620 }}>
          <h2>Take attendance with a code</h2>
          <p className="small muted">
            Start a session in class and project the screen. Students open the course on their phones, tap <strong>Check in</strong> and type the
            6-digit code. The code changes every 30 seconds, so a code forwarded to someone outside the room stops working almost at once.
          </p>
        </div>
        {openSession ? (
          <button type="button" className="btn btn-primary" onClick={() => setLive(openSession.id)}><Icon name="eye" /> Show the open session</button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setStarting(true)}><Icon name="plus" /> Start attendance</button>
        )}
      </section>

      <section className="card-flush">
        <div className="card-head"><h2>Sessions</h2><span className="small muted">{data.sessions.length} so far</span></div>
        {data.sessions.length === 0 ? <Empty icon="calendar">No attendance taken yet.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Session</th><th>When</th><th>Streams</th><th className="num">Present</th><th /></tr></thead>
              <tbody>
                {data.sessions.map((s) => {
                  const open = new Date(s.opens_at).getTime() <= now && new Date(s.closes_at).getTime() > now;
                  return (
                    <tr key={s.id}>
                      <td><strong>{s.title}</strong> {open && <span className="badge badge-teal">Open now</span>}</td>
                      <td className="small">{fmtDateTime(s.opens_at)}</td>
                      <td className="small muted">{s.streams.length ? s.streams.join(', ') : 'Everyone'}</td>
                      <td className="num">{s.attendance?.[0]?.count ?? 0}</td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                          {open && <button type="button" className="btn btn-sm btn-primary" onClick={() => setLive(s.id)}>Show code</button>}
                          <button type="button" className="btn btn-sm" onClick={() => setViewing(s)}>Register</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-flush">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div className="row-wrap">
            <h2>Students</h2>
            <label className="search">
              <span className="sr-only">Search</span>
              <Icon name="search" size={16} />
              <input className="input" style={{ width: 220, minHeight: 40 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or index number" />
            </label>
            <button type="button" className="chip" aria-pressed={low} onClick={() => setLow(!low)}>Below 50% · {lowCount}</button>
            <GroupFilters rows={data.students} value={group} onChange={setGroup} />
          </div>
          <button type="button" className="btn btn-sm" onClick={exportXlsx} disabled={!data.students.length}><Icon name="download" size={16} /> Export to Excel</button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Index no.</th><th>Name</th><th className="hide-sm">Group</th><th className="num">Attended</th><th style={{ width: 200 }}>Rate</th></tr></thead>
            <tbody>
              {rows.slice(0, 400).map((r) => {
                const p = pct(r);
                return (
                  <tr key={r.index_no}>
                    <td className="mono small">{r.index_no}</td>
                    <td>{r.full_name}</td>
                    <td className="small muted hide-sm">{[r.programme, r.stream].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="num">{r.attended} / {r.applicable}</td>
                    <td>
                      {p === null ? <span className="muted small">No sessions yet</span> : (
                        <div className="row" style={{ gap: 8 }}>
                          <div className="bar-track" style={{ flex: 1 }}><div className="bar-fill" style={{ width: `${p}%`, background: p < 50 ? 'var(--amber)' : 'var(--teal)' }} /></div>
                          <span className="mono small" style={{ width: 40, textAlign: 'right' }}>{p}%</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <Empty>No students match.</Empty>}
        </div>
      </section>

      {starting && <StartModal course={course} streams={data.streams} onClose={() => setStarting(false)} onStarted={(id) => { setStarting(false); setLive(id); reload(); }} />}
      {live && <LiveView sessionId={live} course={course} onClose={() => { setLive(null); reload(); }} />}
      {viewing && <RegisterModal session={viewing} course={course} students={data.students} onClose={() => setViewing(null)} onChanged={reload} />}
    </div>
  );
}

function StartModal({ course, streams, onClose, onStarted }) {
  const [act, busy] = useAction();
  const [title, setTitle] = useState(`Lecture — ${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`);
  const [minutes, setMinutes] = useState(10);
  const [chosen, setChosen] = useState([]);
  async function start() {
    const id = await act(() => rpc('start_attendance', { p_course: course.id, p_title: title, p_streams: chosen, p_minutes: Number(minutes) || 10 }));
    if (id) onStarted(id);
  }
  return (
    <Modal title="Start attendance" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={start} disabled={busy}>Start and show code</button></>}>
      <Field label="Session name"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Open for (minutes)"><input className="input" type="number" min="1" max="240" style={{ maxWidth: 140 }} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
      {streams.length > 0 && (
        <div className="field">
          <span className="field-label">Which streams are in this class?</span>
          <div className="row-wrap">
            {streams.map((s) => (
              <label key={s} className="check" style={{ marginRight: 12 }}>
                <input type="checkbox" checked={chosen.includes(s)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s] : chosen.filter((x) => x !== s))} /> {s}
              </label>
            ))}
          </div>
          <span className="tiny muted">Leave all unticked for everyone. Students in other streams can't check in and aren't counted absent.</span>
        </div>
      )}
    </Modal>
  );
}

function LiveView({ sessionId, course, onClose }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  const offset = useRef(0);
  const fetchedAt = useRef(Date.now());
  const [act] = useAction();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await rpc('attendance_live', { p_session: sessionId });
        if (!alive) return;
        offset.current = new Date(r.server_now).getTime() - Date.now();
        fetchedAt.current = Date.now();
        setInfo(r);
        setErr('');
      } catch (e) {
        if (alive) setErr(e.message);
      }
    }
    load();
    const poll = setInterval(load, 2500);
    const t = setInterval(() => setTick((x) => x + 1), 250);
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => { alive = false; clearInterval(poll); clearInterval(t); document.removeEventListener('keydown', onKey); };
  }, [sessionId]);

  const secsLeft = info ? Math.max(0, info.seconds_left - Math.floor((Date.now() - fetchedAt.current) / 1000)) : 30;
  const closeMs = info ? new Date(info.closes_at).getTime() - (Date.now() + offset.current) : 0;
  const mm = Math.max(0, Math.floor(closeMs / 60000));
  const ss = Math.max(0, Math.floor((closeMs % 60000) / 1000));
  void tick;

  return (
    <div role="dialog" aria-modal="true" aria-label="Attendance code"
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'var(--ink)', color: '#fff', display: 'flex', flexDirection: 'column', padding: '24px 28px' }}>
      <div className="between" style={{ flexWrap: 'wrap' }}>
        <div>
          <div className="mono small" style={{ opacity: 0.75 }}>{course.code}</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{info?.title || 'Attendance'}</div>
          {info?.streams?.length > 0 && <div className="small" style={{ opacity: 0.75 }}>For: {info.streams.join(', ')}</div>}
        </div>
        <div className="row-wrap">
          {info?.open && <button type="button" className="btn btn-light" onClick={() => act(() => rpc('extend_attendance', { p_session: sessionId, p_minutes: 5 }))}>+5 minutes</button>}
          {info?.open && <button type="button" className="btn" style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.4)' }}
            onClick={() => act(() => rpc('extend_attendance', { p_session: sessionId, p_minutes: 0 }))}>End now</button>}
          <button type="button" className="icon-btn-dark" aria-label="Close" onClick={onClose}><Icon name="close" size={22} /></button>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, textAlign: 'center' }}>
        {err && <div className="notice notice-error">{err}</div>}
        {!info ? <div className="spinner" /> : info.open ? (
          <>
            <div style={{ fontSize: 22, opacity: 0.85 }}>Open the course on your phone → <strong>Check in</strong> → type this code</div>
            <div className="mono" style={{ fontSize: 'min(22vw, 190px)', fontWeight: 600, letterSpacing: '0.08em', lineHeight: 1 }}>
              {info.code.slice(0, 3)}&thinsp;{info.code.slice(3)}
            </div>
            <div style={{ width: 'min(520px, 80vw)' }}>
              <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,.15)', overflow: 'hidden' }}>
                <div style={{ height: 8, width: `${(secsLeft / 30) * 100}%`, background: '#5eead4', transition: 'width .25s linear' }} />
              </div>
              <div className="small" style={{ marginTop: 6, opacity: 0.7 }}>New code in {secsLeft}s</div>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 36, fontWeight: 600 }}>Attendance closed</div>
        )}
      </div>
      <div className="between" style={{ flexWrap: 'wrap', fontSize: 20 }}>
        <div><span className="mono" style={{ fontSize: 40, fontWeight: 600 }}>{info?.count ?? 0}</span> <span style={{ opacity: 0.75 }}>of {info?.expected ?? 0} checked in</span></div>
        {info?.open && <div style={{ opacity: 0.8 }}>Closes in <span className="mono">{mm}:{String(ss).padStart(2, '0')}</span></div>}
        <div className="small" style={{ opacity: 0.6 }}>{window.location.host}</div>
      </div>
    </div>
  );
}

function RegisterModal({ session, course, students, onClose, onChanged }) {
  const [act] = useAction();
  const changed = useRef(false);
  const [q, setQ] = useState('');
  const [present, setPresent] = useState(() => new Set(students.filter((s) => s.sessions.includes(session.id)).map((s) => s.index_no)));
  const applicable = students.filter((s) => !session.streams.length || session.streams.map((x) => x.toLowerCase()).includes((s.stream || '').toLowerCase()));
  const shown = applicable.filter((s) => !q.trim() || s.full_name.toLowerCase().includes(q.toLowerCase()) || s.index_no.toLowerCase().includes(q.toLowerCase()));

  async function toggle(s) {
    const on = !present.has(s.index_no);
    const flip = (value) => setPresent((cur) => {
      const next = new Set(cur);
      if (value) next.add(s.index_no); else next.delete(s.index_no);
      return next;
    });
    flip(on);
    const ok = await act(async () => { await rpc('set_attendance', { p_session: session.id, p_index: s.index_no, p_present: on }); return true; });
    if (!ok) flip(!on);
    else changed.current = true;
  }

  function close() {
    if (changed.current) onChanged();
    onClose();
  }

  return (
    <Modal title={`${session.title} · register`} onClose={close} wide>
      <div className="between" style={{ flexWrap: 'wrap' }}>
        <span className="small muted">{course.code} · {fmtFull(session.opens_at)} · {present.size} of {applicable.length} present</span>
        <label className="search">
          <span className="sr-only">Search</span>
          <Icon name="search" size={16} />
          <input className="input" style={{ width: 220, minHeight: 40 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a student" />
        </label>
      </div>
      <p className="tiny muted">Tick to mark a student present by hand, for example someone whose phone was flat.</p>
      <div className="card-flush" style={{ maxHeight: 420, overflowY: 'auto' }}>
        {shown.slice(0, 300).map((s) => (
          <label key={s.index_no} className="list-row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={present.has(s.index_no)} onChange={() => toggle(s)} style={{ width: 18, height: 18, accentColor: 'var(--teal)' }} />
            <span className="mono small" style={{ width: 130 }}>{s.index_no}</span>
            <span className="list-main"><span className="title">{s.full_name}</span></span>
            {present.has(s.index_no) ? <span className="badge badge-teal">Present</span> : <span className="badge">Absent</span>}
          </label>
        ))}
        {shown.length === 0 && <Empty>No students.</Empty>}
      </div>
    </Modal>
  );
}
