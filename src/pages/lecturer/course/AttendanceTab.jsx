import { useEffect, useMemo, useRef, useState } from 'react';
import { rpc, rpcAll, run, supabase } from '../../../lib/supabase.js';
import { fmtDateTime, fmtFull } from '../../../lib/format.js';
import { downloadWorkbook } from '../../../lib/sheets.js';
import Icon from '../../../components/Icon.jsx';
import { Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad } from '../../../components/ui.jsx';
import { ALL_GROUPS, GroupFilters, matchesGroup } from '../../../components/Groups.jsx';
import { SortSelect, SortTh } from '../../../components/SortBar.jsx';
import { byNameIndex, compareNumber, compareText } from '../../../lib/sort.js';
import PrintReportModal from '../../../components/PrintReportModal.jsx';
import { buildAttendanceReportHtml } from '../../../lib/printReport.js';

// Same rule as the database: chosen classes win over chosen streams; nothing chosen = everyone.
export function sessionFor(session, student) {
  const classes = session.classes || [];
  if (classes.length) {
    const key = `${(student.programme || '').trim().toLowerCase()}|${(student.stream || '').trim().toLowerCase()}`;
    return classes.some((c) => { const [p, st] = c.split('|'); return `${(p || '').trim().toLowerCase()}|${(st || '').trim().toLowerCase()}` === key; });
  }
  const streams = session.streams || [];
  return !streams.length || streams.map((x) => x.trim().toLowerCase()).includes((student.stream || '').trim().toLowerCase());
}
const classText = (c) => { const [p, st] = c.split('|'); return `${p || 'No programme'} · ${st || 'No stream'}`; };
export const sessionWho = (s) => (s.classes?.length ? s.classes.map(classText).join(', ') : s.streams?.length ? s.streams.join(', ') : 'Everyone');

export default function AttendanceTab({ course }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [sessions, students, opts, classes] = await Promise.all([
      rpc('course_attendance_sessions', { p_course: course.id }),
      rpcAll('course_attendance', { p_course: course.id }),
      run(supabase.from('group_options').select('name').eq('kind', 'stream').order('name')),
      rpcAll('course_classes', { p_course: course.id }),
    ]);
    return { sessions, students, streams: opts.map((o) => o.name), classes };
  }, [course.id]);
  const [live, setLive] = useState(null);
  const [starting, setStarting] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [checking, setChecking] = useState(null);
  const [group, setGroup] = useState(ALL_GROUPS);
  const [low, setLow] = useState(false);
  const [below75, setBelow75] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('name_asc');
  const [printing, setPrinting] = useState(false);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rate = (r) => (r.applicable ? r.attended / r.applicable : null);
    const filtered = (data?.students || []).filter((r) => matchesGroup(r, group)
      && (!low || (r.applicable > 0 && r.attended / r.applicable < 0.5))
      && (!below75 || (r.applicable > 0 && r.attended / r.applicable < 0.75))
      && (!term || [r.full_name, r.index_no, r.programme, r.stream].filter(Boolean).join(' ').toLowerCase().includes(term)));
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'rate_desc': return compareNumber(rate(a), rate(b), 'desc') || compareNumber(a.attended, b.attended, 'desc') || byNameIndex(a, b);
        case 'rate_asc': return compareNumber(rate(a), rate(b), 'asc') || compareNumber(a.attended, b.attended, 'asc') || byNameIndex(a, b);
        case 'name_desc': return compareText(a.full_name, b.full_name, 'desc') || compareText(a.index_no, b.index_no, 'asc');
        case 'index_asc': return compareText(a.index_no, b.index_no, 'asc') || byNameIndex(a, b);
        case 'index_desc': return compareText(a.index_no, b.index_no, 'desc') || byNameIndex(a, b);
        case 'prog_asc': return compareText(a.programme, b.programme, 'asc') || compareText(a.stream, b.stream, 'asc') || byNameIndex(a, b);
        case 'prog_desc': return compareText(a.programme, b.programme, 'desc') || compareText(a.stream, b.stream, 'asc') || byNameIndex(a, b);
        case 'name_asc':
        default: return byNameIndex(a, b);
      }
    });
  }, [data, group, low, below75, q, sort]);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  const now = Date.now();
  const openSession = data.sessions.find((s) => new Date(s.opens_at).getTime() <= now && new Date(s.closes_at).getTime() > now);
  const pct = (r) => (r.applicable ? Math.round((r.attended / r.applicable) * 100) : null);
  const lowCount = data.students.filter((r) => r.applicable > 0 && r.attended / r.applicable < 0.5).length;
  const below75Count = data.students.filter((r) => r.applicable > 0 && r.attended / r.applicable < 0.75).length;

  function exportXlsx() {
    const sess = [...data.sessions].reverse();
    const header = ['Index number', 'Name', 'Programme', 'Stream', 'Attended', 'Out of', 'Percent', ...sess.map((s) => `${s.title}`)];
    const line = (r) => [r.index_no, r.full_name, r.programme, r.stream, r.attended, r.applicable, pct(r) ?? '',
      ...sess.map((s) => (r.sessions.includes(s.id) ? 'P' : sessionFor(s, r) ? 'A' : ''))];
    downloadWorkbook(`${course.code} attendance.xlsx`, [
      { name: 'Attendance', rows: [header, ...data.students.map(line)], widths: [16, 30, 18, 12, 10, 8, 9, ...sess.map(() => 14)] },
    ]);
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 1100 }}>
      <section className="card between" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div className="stack-sm" style={{ maxWidth: 620 }}>
          <h2>Take attendance with rotating code & GPS</h2>
          <p className="small muted">
            Start a session in class and project the screen. Students open the course on their phones, tap <strong>Check in</strong>, verify their physical GPS presence in the lecture hall, and type the rotating 6-digit code. The code changes every 30 seconds to prevent forwarding outside the room.
          </p>
          <p className="small muted">
            To catch anomalies: enforce <strong>GPS Geofencing</strong> to restrict check-ins strictly to students physically inside the hall, compare row numbers with head counts, use <strong>Spot check</strong> to verify random students, and inspect held check-ins where multiple students checked in from one device.
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
              <thead><tr><th>Session</th><th>When</th><th>Who</th><th className="num">Present</th><th>To check</th><th /></tr></thead>
              <tbody>
                {data.sessions.map((s) => {
                  const open = new Date(s.opens_at).getTime() <= now && new Date(s.closes_at).getTime() > now;
                  return (
                    <tr key={s.id}>
                      <td><strong>{s.title}</strong> {open && <span className="badge badge-teal">Open now</span>}</td>
                      <td className="small">{fmtDateTime(s.opens_at)}</td>
                      <td className="small muted" style={{ maxWidth: 220 }}>{sessionWho(s)}</td>
                      <td className="num">{s.present}</td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {s.review > 0 && <span className="badge badge-amber">{s.review} held</span>}
                          {s.rejected > 0 && <span className="badge badge-red">{s.rejected} not accepted</span>}
                          {!s.review && !s.rejected && <span className="muted small">—</span>}
                        </div>
                      </td>
                      <td>
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                          {open && <button type="button" className="btn btn-sm btn-primary" onClick={() => setLive(s.id)}>Show code</button>}
                          <button type="button" className="btn btn-sm" onClick={() => setChecking(s.id)}>Check</button>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setViewing(s)}>Register</button>
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
            <button type="button" className="chip" aria-pressed={below75} onClick={() => setBelow75(!below75)}>Below 75% · {below75Count}</button>
            <button type="button" className="chip" aria-pressed={low} onClick={() => setLow(!low)}>Below 50% · {lowCount}</button>
            <GroupFilters rows={data.students} value={group} onChange={setGroup} />
            <SortSelect
              value={sort}
              onChange={setSort}
              options={[
                { value: 'name_asc', label: 'Name (A → Z)' },
                { value: 'name_desc', label: 'Name (Z → A)' },
                { value: 'index_asc', label: 'Index no. (Ascending)' },
                { value: 'index_desc', label: 'Index no. (Descending)' },
                { value: 'rate_desc', label: 'Attendance: High → Low' },
                { value: 'rate_asc', label: 'Attendance: Low → High' },
                { value: 'prog_asc', label: 'Programme / Class (A → Z)' },
              ]}
            />
          </div>
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => setPrinting(true)} disabled={!data.students.length}><Icon name="file" size={16} /> Print / PDF Register</button>
            <button type="button" className="btn btn-sm" onClick={exportXlsx} disabled={!data.students.length}><Icon name="download" size={16} /> Export to Excel</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortTh label="Index no." ascKey="index_asc" descKey="index_desc" current={sort} onSort={setSort} />
                <SortTh label="Name" ascKey="name_asc" descKey="name_desc" current={sort} onSort={setSort} />
                <SortTh label="Group" ascKey="prog_asc" descKey="prog_desc" current={sort} onSort={setSort} className="hide-sm" />
                <SortTh label="Attended" ascKey="rate_asc" descKey="rate_desc" defaultDir="desc" current={sort} onSort={setSort} className="num" />
                <SortTh label="Rate" ascKey="rate_asc" descKey="rate_desc" defaultDir="desc" current={sort} onSort={setSort} style={{ width: 200 }} />
              </tr>
            </thead>
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

      {starting && <StartModal course={course} streams={data.streams} classes={data.classes} onClose={() => setStarting(false)} onStarted={(id) => { setStarting(false); setLive(id); reload(); }} />}
      {live && <LiveView sessionId={live} course={course} onClose={() => { setLive(null); reload(); }} />}
      {checking && <SessionCheck sessionId={checking} course={course} onClose={() => { setChecking(null); reload(); }} />}
      {viewing && <RegisterModal session={viewing} course={course} students={data.students} onClose={() => setViewing(null)} onChanged={reload} />}
      {printing && (
        <PrintReportModal
          title={`Attendance Register · ${course.code}`}
          html={buildAttendanceReportHtml({
            course,
            sessions: data.sessions,
            students: rows,
            groupLabelText: [
              group.programme !== '*' ? (group.programme || 'Not set') : '',
              group.stream !== '*' ? (group.stream || 'Not set') : '',
              below75 ? 'Below 75%' : '',
              low ? 'Below 50%' : '',
            ].filter(Boolean).join(' · '),
          })}
          onClose={() => setPrinting(false)}
        />
      )}
    </div>
  );
}

function StartModal({ course, streams, classes, onClose, onStarted }) {
  const [act, busy] = useAction();
  const [title, setTitle] = useState(`Lecture — ${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`);
  const [minutes, setMinutes] = useState(10);
  const [chosen, setChosen] = useState([]);
  const [askRow, setAskRow] = useState(true);
  const [who, setWho] = useState('all'); // all | streams | classes
  const [pickedClasses, setPickedClasses] = useState([]);
  const [useGps, setUseGps] = useState(false);
  const [coords, setCoords] = useState(null);
  const [gpsStatus, setGpsStatus] = useState('');
  const keyOf = (c) => `${c.programme}|${c.stream}`;

  function pinLocation() {
    if (!navigator.geolocation) {
      setGpsStatus('Geolocation not supported on this device.');
      return;
    }
    setGpsStatus('Acquiring current location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setUseGps(true);
        setGpsStatus(`Pinned (${pos.coords.latitude.toFixed(4)}°, ${pos.coords.longitude.toFixed(4)}°)`);
      },
      (err) => setGpsStatus('Location error: ' + err.message),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function start() {
    if (who === 'streams' && !chosen.length) throw new Error('Tick at least one stream, or choose Everyone.');
    if (who === 'classes' && !pickedClasses.length) throw new Error('Tick at least one class, or choose Everyone.');
    const id = await act(() => rpc('start_attendance', {
      p_course: course.id, p_title: title, p_minutes: Number(minutes) || 10, p_ask_row: askRow,
      p_streams: who === 'streams' ? chosen : [], p_classes: who === 'classes' ? pickedClasses : [],
      p_lat: (useGps && coords) ? coords.lat : null,
      p_lng: (useGps && coords) ? coords.lng : null,
      p_radius: 100
    }));
    if (id) onStarted(id);
  }
  return (
    <Modal title="Start attendance" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => act(start)} disabled={busy}>Start and show code</button></>}>
      <Field label="Session name"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Open for (minutes)"><input className="input" type="number" min="1" max="240" style={{ maxWidth: 140 }} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={askRow} onChange={(e) => setAskRow(e.target.checked)} />
        <span>Ask each student for their <strong>row number</strong> — so you can count heads in a row and compare</span></label>
      <div className="card-soft stack-sm" style={{ padding: 12, marginTop: 8 }}>
        <label className="check">
          <input type="checkbox" checked={useGps} onChange={(e) => setUseGps(e.target.checked)} />
          <span>Enforce <strong>GPS Location Geofence</strong> (Students must be in the lecture hall)</span>
        </label>
        {useGps && (
          <div className="row-wrap" style={{ gap: 8, alignItems: 'center', marginTop: 6 }}>
            <button type="button" className="btn btn-sm" onClick={pinLocation}>
              <Icon name="map-pin" size={16} /> Pin hall location from my device
            </button>
            {gpsStatus && <span className="tiny muted">{gpsStatus}</span>}
          </div>
        )}
      </div>
      {(streams.length > 0 || classes.length > 1) && (
        <div className="field">
          <span className="field-label">Who is in this lecture?</span>
          <div className="chips" role="group" aria-label="Who is in this lecture">
            <button type="button" className="chip" aria-pressed={who === 'all'} onClick={() => setWho('all')}>Everyone</button>
            {streams.length > 0 && <button type="button" className="chip" aria-pressed={who === 'streams'} onClick={() => setWho('streams')}>Some streams</button>}
            {classes.length > 1 && <button type="button" className="chip" aria-pressed={who === 'classes'} onClick={() => setWho('classes')}>Some classes</button>}
          </div>
          {who === 'streams' && (
            <div className="row-wrap" style={{ marginTop: 8 }}>
              {streams.map((s) => (
                <label key={s} className="check" style={{ marginRight: 12 }}>
                  <input type="checkbox" checked={chosen.includes(s)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s] : chosen.filter((x) => x !== s))} /> {s}
                </label>
              ))}
            </div>
          )}
          {who === 'classes' && (
            <div className="stack-sm" style={{ marginTop: 8 }}>
              {classes.map((c) => (
                <label key={keyOf(c)} className="check">
                  <input type="checkbox" checked={pickedClasses.includes(keyOf(c))}
                    onChange={(e) => setPickedClasses(e.target.checked ? [...pickedClasses, keyOf(c)] : pickedClasses.filter((x) => x !== keyOf(c)))} />
                  <span>{c.programme || 'No programme'} · {c.stream || 'No stream'} <span className="tiny muted">({c.students})</span></span>
                </label>
              ))}
            </div>
          )}
          <span className="tiny muted">Students outside the chosen group can't check in and aren't counted absent.</span>
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
  const [spot, setSpot] = useState(null);
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
    const onKey = (e) => e.key === 'Escape' && !document.querySelector('[data-spot]') && closeRef.current();
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
          {(info?.streams?.length > 0 || info?.classes?.length > 0) && <div className="small" style={{ opacity: 0.75 }}>For: {sessionWho(info)}</div>}
        </div>
        <div className="row-wrap">
          {info?.count > 0 && <button type="button" className="btn btn-light" onClick={() => setSpot(true)}>Spot check</button>}
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
      {info?.ask_row && Object.keys(info.rows || {}).length > 0 && (
        <div aria-label="Checked in per row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
          {Object.entries(info.rows).sort((a, b) => Number(a[0]) - Number(b[0])).map(([r, n]) => (
            <span key={r} className="mono" style={{ background: 'rgba(255,255,255,.1)', borderRadius: 8, padding: '4px 10px', fontSize: 16 }}>
              Row {r}: <strong>{n}</strong>
            </span>
          ))}
        </div>
      )}
      <div className="between" style={{ flexWrap: 'wrap', fontSize: 20 }}>
        <div>
          <span className="mono" style={{ fontSize: 40, fontWeight: 600 }}>{info?.count ?? 0}</span> <span style={{ opacity: 0.75 }}>of {info?.expected ?? 0} checked in</span>
          {info?.review > 0 && <span className="small" style={{ marginLeft: 12, color: '#fcd34d' }}>{info.review} held for checking</span>}
        </div>
        {info?.open && <div style={{ opacity: 0.8 }}>Closes in <span className="mono">{mm}:{String(ss).padStart(2, '0')}</span></div>}
        <div className="small" style={{ opacity: 0.6 }}>{window.location.host}</div>
      </div>
      {spot && <SpotCheck sessionId={sessionId} onClose={() => setSpot(null)} />}
    </div>
  );
}

// Five random names on the big screen: they stand up, or they are marked absent.
function SpotCheck({ sessionId, onClose }) {
  const [names, setNames] = useState(null);
  const [gone, setGone] = useState(new Set());
  const [act, busy] = useAction();
  async function pick() {
    const r = await act(() => rpc('attendance_spot', { p_session: sessionId, p_n: 5 }));
    if (r) { setNames(r); setGone(new Set()); }
  }
  useEffect(() => { pick(); }, []);
  async function notHere(n) {
    const ok = await act(() => rpc('attendance_review', { p_session: sessionId, p_indexes: [n.index_no], p_status: 'rejected', p_note: 'Not in the room at spot check' }), `${n.full_name} marked not present.`);
    if (ok !== undefined) setGone(new Set([...gone, n.index_no]));
  }
  return (
    <div data-spot role="dialog" aria-modal="true" aria-label="Spot check"
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'var(--ink)', color: '#fff', display: 'flex', flexDirection: 'column', padding: '24px 28px' }}>
      <div className="between">
        <div style={{ fontSize: 22, fontWeight: 600 }}>Spot check — please stand up when you hear your name</div>
        <button type="button" className="icon-btn-dark" aria-label="Close spot check" onClick={onClose}><Icon name="close" size={22} /></button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14, maxWidth: 900, width: '100%', margin: '0 auto' }}>
        {!names ? <div className="spinner" /> : names.map((n) => (
          <div key={n.index_no} className="between" style={{ background: 'rgba(255,255,255,.08)', borderRadius: 12, padding: '14px 18px', opacity: gone.has(n.index_no) ? 0.4 : 1 }}>
            <span style={{ fontSize: 'clamp(22px, 4vw, 40px)', fontWeight: 600 }}>
              {n.full_name} {n.row_no ? <span className="mono" style={{ fontSize: '0.6em', opacity: 0.8 }}>· row {n.row_no}</span> : null}
            </span>
            {gone.has(n.index_no) ? <span className="badge badge-red">Not present</span> : (
              <button type="button" className="btn" style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.4)' }}
                onClick={() => notHere(n)} disabled={busy} aria-label={`${n.full_name} is not here`}>Not here</button>
            )}
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
        <button type="button" className="btn btn-light" onClick={pick} disabled={busy}>Pick 5 more</button>
        <button type="button" className="btn" style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.4)' }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

// Check one session: row counts against head counts, held check-ins, accept or reject.
function SessionCheck({ sessionId, course, onClose }) {
  const { data, error, loading, reload, setData } = useLoad(() => rpc('attendance_session_detail', { p_session: sessionId }), [sessionId]);
  const [act, busy] = useAction();
  const [filter, setFilter] = useState('held');
  const [rowOpen, setRowOpen] = useState(null);
  const [counts, setCounts] = useState({});

  useEffect(() => { if (data) setCounts(Object.fromEntries(Object.entries(data.head_counts || {}).map(([k, v]) => [k, String(v)]))); }, [data]);

  if (loading) return <Modal title="Check attendance" onClose={onClose} wide><Loading /></Modal>;
  if (error) return <Modal title="Check attendance" onClose={onClose} wide><ErrorNote error={error} onRetry={reload} /></Modal>;

  const live = data.checkins.filter((c) => c.status !== 'rejected');
  const held = data.checkins.filter((c) => c.status === 'review');
  const rows = {};
  live.forEach((c) => { if (c.row_no) rows[c.row_no] = (rows[c.row_no] || 0) + 1; });
  const rowNums = [...new Set([...Object.keys(rows), ...Object.keys(data.head_counts || {})].map(Number))].sort((a, b) => a - b);
  const mismatched = rowNums.filter((r) => data.head_counts?.[r] !== undefined && (rows[r] || 0) > Number(data.head_counts[r]));

  async function setStatus(list, status, note) {
    const ok = await act(() => rpc('attendance_review', { p_session: sessionId, p_indexes: list.map((c) => c.index_no), p_status: status, p_note: note }),
      status === 'ok' ? `Accepted ${list.length}.` : `Marked ${list.length} not present.`);
    if (ok !== undefined) {
      const idx = new Set(list.map((c) => c.index_no));
      setData((d) => ({ ...d, checkins: d.checkins.map((c) => (idx.has(c.index_no) ? { ...c, status, note } : c)) }));
    }
  }

  async function saveCount(r) {
    const v = counts[r];
    const n = v === '' || v === undefined ? null : Number(v);
    if (n !== null && (!Number.isInteger(n) || n < 0)) return;
    const hc = await act(() => rpc('attendance_head_count', { p_session: sessionId, p_row: r, p_count: n }));
    if (hc) setData((d) => ({ ...d, head_counts: hc }));
  }

  const shown = data.checkins.filter((c) => (filter === 'held' ? c.status === 'review'
    : filter === 'rejected' ? c.status === 'rejected'
    : filter === 'row' ? c.row_no === rowOpen && c.status !== 'rejected' : true));

  return (
    <Modal title={`${data.title} · check`} onClose={onClose} wide>
      <div className="row-wrap small">
        <span className="badge badge-teal">{data.checkins.filter((c) => c.status === 'ok').length} accepted</span>
        <span className={`badge ${held.length ? 'badge-amber' : ''}`}>{held.length} held</span>
        <span className="badge">{data.checkins.filter((c) => c.status === 'rejected').length} not accepted</span>
        <span className="muted">{course.code} · {fmtFull(data.opens_at)}</span>
      </div>

      {data.ask_row && (
        <section className="stack-sm">
          <h3 style={{ margin: 0 }}>Rows</h3>
          <p className="tiny muted">Count the students actually sitting in a row and type the number. If more checked in for that row than are sitting there, the row turns red — open it to see who checked in.</p>
          {rowNums.length === 0 ? <span className="small muted">No row numbers yet.</span> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Row</th><th className="num">Checked in</th><th>Head count</th><th /></tr></thead>
                <tbody>
                  {rowNums.map((r) => {
                    const over = data.head_counts?.[r] !== undefined && (rows[r] || 0) > Number(data.head_counts[r]);
                    return (
                      <tr key={r} style={over ? { background: 'var(--red-50, #fdecea)' } : undefined}>
                        <td className="mono strong">{r}</td>
                        <td className="num">{rows[r] || 0}</td>
                        <td>
                          <div className="row" style={{ gap: 8 }}>
                            <input className="input mono" type="number" min="0" style={{ width: 90, minHeight: 36 }} aria-label={`Head count for row ${r}`}
                              value={counts[r] ?? ''} onChange={(e) => setCounts({ ...counts, [r]: e.target.value })} onBlur={() => saveCount(r)}
                              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                            {over && <span className="badge badge-red">{(rows[r] || 0) - Number(data.head_counts[r])} too many</span>}
                            {data.head_counts?.[r] !== undefined && !over && <span className="badge badge-teal">OK</span>}
                          </div>
                        </td>
                        <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => { setRowOpen(r); setFilter('row'); }}>Who</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {mismatched.length > 0 && <div className="notice notice-warn small">Row{mismatched.length > 1 ? 's' : ''} {mismatched.join(', ')} {mismatched.length > 1 ? 'have' : 'has'} more check-ins than people. Call the names out, then mark the missing ones not present.</div>}
        </section>
      )}

      <section className="stack-sm">
        <div className="between" style={{ flexWrap: 'wrap' }}>
          <div className="chips" role="group" aria-label="Show">
            {[['held', `Held · ${held.length}`], ['all', `Everyone · ${data.checkins.length}`], ['rejected', 'Not accepted'], ...(rowOpen ? [['row', `Row ${rowOpen}`]] : [])].map(([id, label]) => (
              <button key={id} type="button" className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>
          {filter === 'held' && held.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => setStatus(held, 'ok', 'Accepted after checking')} disabled={busy}>Accept all held</button>
          )}
        </div>
        {filter === 'held' && held.length > 0 && <p className="tiny muted">Held because the same phone checked in more than one student (same phone code). One of them may be genuine — for example a friend lending a phone — so check before you decide.</p>}
        <div className="card-flush" style={{ maxHeight: 360, overflowY: 'auto' }}>
          {shown.map((c) => (
            <div key={c.index_no} className="list-row small">
              <span className="mono" style={{ width: 120 }}>{c.index_no}</span>
              <span className="list-main">
                <span className="title">{c.full_name}</span>
                <span className="tiny muted">
                  {c.row_no ? `Row ${c.row_no}` : c.method === 'manual' ? 'Added by hand' : 'No row'}
                  {c.phone ? ` · phone ${c.phone}` : ''}{c.note ? ` · ${c.note}` : ''}
                </span>
              </span>
              {c.shared_phone && <span className="badge badge-amber" title="This phone checked in more than one student">Shared phone</span>}
              {c.status === 'ok' ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setStatus([c], 'rejected', 'Not present')} disabled={busy} aria-label={`Mark ${c.full_name} not present`}>Not present</button>
              ) : (
                <div className="row" style={{ gap: 4 }}>
                  {c.status === 'rejected' && <span className="badge badge-red">Not accepted</span>}
                  <button type="button" className="btn btn-sm" onClick={() => setStatus([c], 'ok', 'Accepted after checking')} disabled={busy} aria-label={`Accept ${c.full_name}`}>Accept</button>
                  {c.status === 'review' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setStatus([c], 'rejected', 'Not present')} disabled={busy} aria-label={`Reject ${c.full_name}`}>Reject</button>}
                </div>
              )}
            </div>
          ))}
          {shown.length === 0 && <Empty>{filter === 'held' ? 'Nothing held — no phone checked in twice.' : 'No one here.'}</Empty>}
        </div>
      </section>
    </Modal>
  );
}

function RegisterModal({ session, course, students, onClose, onChanged }) {
  const [act] = useAction();
  const changed = useRef(false);
  const [q, setQ] = useState('');
  const [present, setPresent] = useState(() => new Set(students.filter((s) => s.sessions.includes(session.id)).map((s) => s.index_no)));
  const applicable = students.filter((s) => sessionFor(session, s));
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
