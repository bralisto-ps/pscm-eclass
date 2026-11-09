import Messages from '../../components/Messages.jsx';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { rpc, run, supabase, safeFileName } from '../../lib/supabase.js';
import { openStoredFile, uploadFile, SUBMISSION_ACCEPT } from '../../lib/files.js';
import CheckInModal from '../../components/CheckIn.jsx';
import Forum from '../../components/Forum.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { fmtBytes, fmtDateTime, fmtFull, fmtNumber, hostOf, pct, relative } from '../../lib/format.js';
import Icon from '../../components/Icon.jsx';
import {
  Empty, ErrorBoundary, ErrorNote, Field, KindTag, Loading, Modal, Tabs, useAction, useLoad, useToast,
} from '../../components/ui.jsx';

const TABS = [
  { id: 'materials', label: 'Materials' },
  { id: 'quizzes', label: 'Quizzes' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'grades', label: 'My grades' },
  { id: 'qa', label: 'Q&A' },
  { id: 'messages', label: 'Messages' },
  { id: 'announcements', label: 'Announcements' },
];

export default function StudentCourse() {
  const { courseId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'materials';
  const setTab = (t) => setParams({ tab: t }, { replace: true });
  const [checkingIn, setCheckingIn] = useState(false);

  const { data, error, loading, reload } = useLoad(async () => {
    const [course, modules, materials, news, quizzes, assignments, attendance, ca] = await Promise.all([
      run(supabase.from('courses').select('*').eq('id', courseId).maybeSingle()),
      run(supabase.from('modules').select('*').eq('course_id', courseId).order('week_no', { nullsFirst: false }).order('position')),
      run(supabase.from('materials').select('*').eq('course_id', courseId).order('position').order('created_at')),
      run(supabase.from('announcements').select('*').eq('course_id', courseId).order('created_at', { ascending: false })),
      rpc('my_quizzes', { p_course: courseId }),
      rpc('my_assignments', { p_course: courseId }),
      rpc('my_attendance', { p_course: courseId }),
      rpc('my_ca', { p_course: courseId }),
    ]);
    return { course, modules, materials, news, quizzes: quizzes || [], assignments: assignments || [], attendance, ca };
  }, [courseId]);

  if (loading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} onRetry={reload} /></div>;
  if (!data.course) {
    return (
      <div className="page">
        <div className="card"><Empty icon="book" title="Course not found">You may not be enrolled in this course.</Empty></div>
      </div>
    );
  }
  const { course } = data;
  const graded = data.quizzes.filter((q) => !q.is_practice);
  const openAttendance = data.attendance?.open_now;

  return (
    <>
      <header className="course-band" style={{ background: course.color }}>
        <div className="between">
          <Link to="/" className="small">← Home</Link>
          <div className="row-wrap">
            {course.semester && <span className="band-chip hide-sm">{course.semester}</span>}
            <button type="button" className={`btn btn-sm ${openAttendance ? 'btn-light' : ''}`} onClick={() => setCheckingIn(true)}
              style={openAttendance ? undefined : { background: 'rgba(0,0,0,.2)', borderColor: 'transparent', color: '#fff' }}>
              <Icon name="check" size={16} /> {openAttendance ? 'Check in now' : 'Check in'}
            </button>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="code">{course.code}</div>
          <h1>{course.title}</h1>
        </div>
        <Tabs dark tabs={TABS} value={tab} onChange={setTab} />
      </header>

      <div className="page">
        <ErrorBoundary key={tab}>
          {tab === 'materials' && <Materials data={data} onQuizzes={() => setTab('quizzes')} graded={graded} />}
          {tab === 'quizzes' && <Quizzes quizzes={data.quizzes} reload={reload} />}
          {tab === 'assignments' && <Assignments assignments={data.assignments} reload={reload} />}
          {tab === 'attendance' && (
            <StudentAttendanceView attendance={data.attendance} course={course} onCheckIn={() => setCheckingIn(true)} />
          )}
          {tab === 'grades' && (
            <div className="stack-lg" style={{ maxWidth: 900 }}>
              {data.ca && <CACard ca={data.ca} />}
              <GradesTable quizzes={graded} assignments={data.assignments} />
              <AttendanceCard attendance={data.attendance} />
            </div>
          )}
          {tab === 'qa' && <Forum course={course} />}
          {tab === 'messages' && <Messages course={course} />}
          {tab === 'announcements' && <Announcements news={data.news} />}
        </ErrorBoundary>
      </div>
      {checkingIn && <CheckInModal courseId={course.id} courseCode={course.code} askRow={data.attendance?.ask_row} onClose={() => setCheckingIn(false)} onDone={reload} />}
    </>
  );
}

// ---------------- materials ----------------
function Materials({ data, onQuizzes, graded }) {
  const [act] = useAction();
  const groups = useMemo(() => {
    const g = data.modules.map((m) => ({ ...m, items: data.materials.filter((x) => x.module_id === m.id) }));
    const loose = data.materials.filter((x) => !x.module_id);
    if (loose.length) g.unshift({ id: 'general', title: 'General', week_no: null, summary: '', items: loose });
    return g;
  }, [data]);
  const latest = [...groups].reverse().find((g) => g.items.length) || groups[0];
  const [selected, setSelected] = useState(latest?.id);
  const current = groups.find((g) => g.id === selected) || latest;
  const nextQuiz = graded.find((q) => !q.best && (!q.closes_at || new Date(q.closes_at) > new Date()));

  function open(m) {
    if (m.url) window.open(m.url, '_blank', 'noopener');
    else if (m.storage_path) act(() => openStoredFile('materials', m.storage_path));
  }

  if (!groups.length) {
    return <div className="card"><Empty icon="book" title="No materials yet">Your lecturer has not posted anything for this course yet.</Empty></div>;
  }

  return (
    <div className="three-col">
      <nav aria-label="Weeks" className="stack-sm" style={{ gap: 2 }}>
        <span className="eyebrow" style={{ padding: '0 10px 6px' }}>Weeks</span>
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setSelected(g.id)}
            className="nav-link"
            style={{
              color: g.id === current?.id ? 'var(--text)' : 'var(--text-2)',
              background: g.id === current?.id ? 'var(--surface)' : 'transparent',
              border: g.id === current?.id ? '1px solid var(--line)' : '1px solid transparent',
              fontWeight: g.id === current?.id ? 600 : 400,
              cursor: 'pointer', textAlign: 'left', minHeight: 40,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.items.length ? 'var(--teal)' : 'var(--field)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {g.week_no ? `Week ${g.week_no}` : g.title}
            </span>
          </button>
        ))}
      </nav>

      <main className="stack" style={{ minWidth: 0 }}>
        {current && (
          <>
            <div className="stack-sm">
              <h2 style={{ fontSize: 20 }}>{current.week_no ? `Week ${current.week_no} · ${current.title}` : current.title}</h2>
              {current.summary && <p className="pre" style={{ color: 'var(--text-2)', maxWidth: 680 }}>{current.summary}</p>}
            </div>
            <div className="card-flush">
              {current.items.length === 0 && <Empty icon="file">Nothing posted for this week yet.</Empty>}
              {current.items.map((m) => (
                <button key={m.id} type="button" className="list-row" onClick={() => open(m)}>
                  <KindTag kind={m.kind} />
                  <span className="list-main">
                    <span className="title">{m.title}</span>
                    <span className="tiny muted">
                      {m.url ? hostOf(m.url) : fmtBytes(m.size_bytes)} · added {relative(m.created_at)}
                    </span>
                  </span>
                  <Icon name={m.url ? 'link' : 'download'} />
                </button>
              ))}
            </div>
          </>
        )}
      </main>

      <aside className="stack">
        {nextQuiz && (
          <div className="card stack-sm">
            <span className="badge badge-amber" style={{ alignSelf: 'flex-start' }}>
              {nextQuiz.opens_at && new Date(nextQuiz.opens_at) > new Date() ? `Opens ${fmtDateTime(nextQuiz.opens_at)}` : 'Open now'}
            </span>
            <strong style={{ fontSize: 17 }}>{nextQuiz.title}</strong>
            <div className="grid-3" style={{ gap: 8, padding: '6px 0' }}>
              <Stat v={nextQuiz.question_count} l="questions" />
              <Stat v={nextQuiz.duration_minutes} l="minutes" />
              <Stat v={nextQuiz.max_attempts} l={nextQuiz.max_attempts === 1 ? 'attempt' : 'attempts'} />
            </div>
            <button type="button" className="btn btn-dark" onClick={onQuizzes}>View quiz</button>
          </div>
        )}
        <div className="card stack-sm">
          <strong>Quizzes so far</strong>
          {graded.length === 0 && <span className="small muted">No graded quizzes yet.</span>}
          {graded.map((q) => (
            <div key={q.id} className="between small" style={{ padding: '6px 0', borderTop: '1px solid var(--line-2)' }}>
              <span>{q.title}</span>
              <span className="mono">
                {q.best ? (q.best.score !== null ? `${fmtNumber(q.best.score)} / ${fmtNumber(q.best.max_score)}` : 'Submitted') : '—'}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function Stat({ v, l }) {
  return (
    <div className="stack-sm" style={{ gap: 0 }}>
      <span className="mono" style={{ fontSize: 18 }}>{v}</span>
      <span className="tiny muted">{l}</span>
    </div>
  );
}

// ---------------- quizzes ----------------
function quizState(q) {
  const now = Date.now();
  if (q.in_progress) return 'in_progress';
  if (q.opens_at && new Date(q.opens_at).getTime() > now) return 'not_open';
  const used = q.attempts_used || 0;
  const closed = q.closes_at && new Date(q.closes_at).getTime() < now;
  if (!q.is_practice && used >= q.max_attempts) return 'done';
  if (closed) return used ? 'done' : 'missed';
  return 'open';
}

function Quizzes({ quizzes }) {
  const navigate = useNavigate();
  const [act, busy] = useAction();
  const [starting, setStarting] = useState(null);

  async function begin(q) {
    const id = await act(() => rpc('start_attempt', { p_quiz: q.id }));
    if (id) navigate(`/quiz/${id}`);
  }

  if (!quizzes.length) return <div className="card"><Empty icon="quiz" title="No quizzes yet">Quizzes will appear here when your lecturer publishes them.</Empty></div>;

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      {quizzes.map((q) => {
        const st = quizState(q);
        const released = q.released;
        return (
          <div key={q.id} className="card">
            <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div className="stack-sm" style={{ flex: 1, minWidth: 240 }}>
                <div className="row-wrap">
                  <h2>{q.title}</h2>
                  {q.is_practice && <span className="badge badge-blue">Practice · not graded</span>}
                  {q.lockdown && <span className="badge badge-red">Strict mode</span>}
                </div>
                <span className="small muted">
                  {q.question_count} questions{q.total_marks !== null && q.total_marks !== undefined ? ` · ${fmtNumber(q.total_marks)} marks` : ''} · {q.duration_minutes} minutes ·{' '}
                  {q.is_practice ? 'unlimited attempts' : `${q.max_attempts} attempt${q.max_attempts > 1 ? 's' : ''}`}
                </span>
                <span className="small muted">
                  {q.opens_at ? `Opens ${fmtFull(q.opens_at)}` : 'Open now'}
                  {q.closes_at ? ` · closes ${fmtFull(q.closes_at)}` : ''}
                </span>
              </div>
              <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
                {st === 'in_progress' && (
                  <button type="button" className="btn btn-primary" onClick={() => begin(q)} disabled={busy}>Resume quiz</button>
                )}
                {st === 'open' && (
                  <button type="button" className="btn btn-dark" onClick={() => setStarting(q)}>
                    {q.attempts_used ? 'Try again' : 'Start quiz'}
                  </button>
                )}
                {st === 'not_open' && <span className="badge badge-amber">Opens {relative(q.opens_at)}</span>}
                {st === 'missed' && <span className="badge badge-red">Closed — not attempted</span>}
                {q.best && (
                  <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
                    {released && q.best.score !== null ? (
                      <span className="badge badge-teal mono">
                        {fmtNumber(q.best.score)} / {fmtNumber(q.best.max_score)} ({pct(q.best.score, q.best.max_score)}%)
                      </span>
                    ) : (
                      <span className="badge">Submitted {relative(q.best.submitted_at)} · results pending</span>
                    )}
                    {released && (
                      <Link to={`/review/${q.best.attempt_id}`} className="btn btn-sm btn-ghost">Review answers</Link>
                    )}
                  </div>
                )}
              </div>
            </div>
            {q.instructions && <p className="small pre" style={{ marginTop: 12, color: 'var(--text-2)' }}>{q.instructions}</p>}
          </div>
        );
      })}

      {starting && (
        <Modal
          title={`Start: ${starting.title}`}
          onClose={() => setStarting(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setStarting(null)}>Not yet</button>
              <button type="button" className="btn btn-dark" disabled={busy} onClick={() => begin(starting)}>
                {busy ? 'Starting…' : 'Start now'}
              </button>
            </>
          }
        >
          <div className="notice notice-warn">
            The timer starts as soon as you press <strong>Start now</strong> and keeps running even if you close the page.
            You have <strong>{starting.duration_minutes} minutes</strong>
            {starting.closes_at ? <> (or until {fmtDateTime(starting.closes_at)}, whichever comes first)</> : null}.
          </div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
            <li>{starting.question_count} questions{starting.total_marks !== null && starting.total_marks !== undefined ? `, ${fmtNumber(starting.total_marks)} marks in total` : ''}.</li>
            <li>Your answers save automatically as you go.</li>
            <li>Calculation questions use figures unique to you.</li>
            <li>When time runs out, your saved answers are submitted for you.</li>
            {starting.no_backtrack && <li><strong>You cannot go back</strong> to a question once you move to the next one.</li>}
          </ul>
          {starting.lockdown && (
            <div className="notice notice-error small">
              <strong>Strict mode.</strong> The quiz opens full screen. Switching tabs or apps, leaving full screen or
              copying and pasting is blocked or recorded, and your lecturer sees every exit
              {starting.max_exits ? <>. After <strong>{starting.max_exits}</strong> exits your quiz is submitted automatically</> : ''}.
              Close other apps and turn off notifications before you start.
            </div>
          )}
          {starting.instructions && <p className="small pre">{starting.instructions}</p>}
        </Modal>
      )}
    </div>
  );
}

// ---------------- assignments ----------------
function Assignments({ assignments, reload }) {
  if (!assignments.length) return <div className="card"><Empty icon="clipboard" title="No assignments yet">Assignments will appear here when your lecturer posts them.</Empty></div>;
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      {assignments.map((a) => <AssignmentCard key={a.id} a={a} reload={reload} />)}
    </div>
  );
}

const MAX_BYTES = 5 * 1024 * 1024;

function AssignmentCard({ a, reload }) {
  const { session } = useAuth();
  const toast = useToast();
  const [act] = useAction();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const s = a.submission;
  const now = Date.now();
  const overdue = a.due_at && new Date(a.due_at).getTime() < now;
  const canSubmit = (!overdue || a.allow_late) && !(s && s.marked);

  async function upload() {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast('That file is larger than 5 MB. Save it as a PDF or compress it, then try again.', 'error');
      return;
    }
    setBusy(true);
    try {
      const path = `${a.id}/${session.user.id}/${Date.now()}-${safeFileName(file.name)}`;
      const stored = await uploadFile('submissions', path, file);
      await rpc('submit_assignment', { p_assignment: a.id, p_path: stored, p_name: file.name, p_note: note });
      toast('Submitted. Well done!');
      setFile(null);
      setNote('');
      if (fileRef.current) fileRef.current.value = '';
      reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="stack-sm" style={{ flex: 1, minWidth: 240 }}>
          <h2>{a.title}</h2>
          <span className="small muted">
            {a.due_at ? `Due ${fmtFull(a.due_at)} (${relative(a.due_at)})` : 'No deadline'} · {fmtNumber(a.max_marks)} marks
            {a.allow_late ? ' · late work accepted' : ''}
          </span>
        </div>
        {s ? (
          s.marked && a.released ? (
            <span className="badge badge-teal mono">{fmtNumber(s.marks)} / {fmtNumber(a.max_marks)}</span>
          ) : (
            <span className={`badge ${s.is_late ? 'badge-amber' : 'badge-teal'}`}>
              <Icon name="check" size={14} /> Submitted{s.is_late ? ' late' : ''}
            </span>
          )
        ) : overdue && !a.allow_late ? (
          <span className="badge badge-red">Closed</span>
        ) : (
          <span className="badge badge-amber">Not submitted</span>
        )}
      </div>

      {a.instructions && <p className="pre small" style={{ color: 'var(--text-2)' }}>{a.instructions}</p>}

      {s && (
        <div className="notice notice-info row-wrap">
          <Icon name="file" />
          <span style={{ flex: 1 }}>
            <strong>{s.file_name}</strong> · submitted {fmtFull(s.submitted_at)}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => act(() => openStoredFile('submissions', s.file_path))}>View</button>
        </div>
      )}

      {s?.marked && a.released && s.feedback && (
        <div className="stack-sm">
          <span className="eyebrow">Lecturer feedback</span>
          <p className="pre">{s.feedback}</p>
        </div>
      )}
      {s?.marked && !a.released && <p className="small muted">Your work has been marked. Marks will show here when your lecturer releases them.</p>}

      {canSubmit && (
        <div className="stack" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 16 }}>
          <Field label={s ? 'Replace your submission' : 'Your file'} hint="PDF, Word, Excel, PowerPoint, ZIP or image · max 5 MB">
            <input ref={fileRef} type="file" accept={SUBMISSION_ACCEPT} className="input" style={{ paddingTop: 9 }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
          <Field label="Note to your lecturer" hint="optional">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
          <div>
            <button type="button" className="btn btn-primary" disabled={!file || busy} onClick={upload}>
              <Icon name="upload" /> {busy ? 'Uploading…' : s ? 'Replace submission' : 'Submit assignment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- grades ----------------
export function GradesTable({ quizzes, assignments }) {
  const rows = [
    ...quizzes.map((q) => ({
      id: q.id, title: q.title, type: 'Quiz',
      status: q.best ? (q.released && q.best.score !== null ? 'Released' : 'Submitted') : 'Not attempted',
      score: q.released && q.best ? q.best.score : null, max: q.best?.max_score ?? q.total_marks,
    })),
    ...assignments.map((a) => ({
      id: a.id, title: a.title, type: 'Assignment',
      status: a.submission ? (a.submission.marked && a.released ? 'Released' : 'Submitted') : 'Not submitted',
      score: a.released && a.submission ? a.submission.marks : null, max: a.max_marks,
    })),
  ];
  if (!rows.length) return <div className="card"><Empty icon="chart" title="No graded work yet" /></div>;
  return (
    <div className="card-flush table-wrap" style={{ maxWidth: 900 }}>
      <table className="table">
        <thead>
          <tr><th>Item</th><th>Type</th><th>Status</th><th className="num">Score</th><th className="num">%</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.type + r.id}>
              <td>{r.title}</td>
              <td className="muted">{r.type}</td>
              <td>
                <span className={`badge ${r.status === 'Released' ? 'badge-teal' : r.status.startsWith('Not') ? '' : 'badge-amber'}`}>{r.status}</span>
              </td>
              <td className="num">{r.score !== null && r.score !== undefined ? `${fmtNumber(r.score)} / ${fmtNumber(r.max)}` : '—'}</td>
              <td className="num">{r.score !== null && r.score !== undefined ? `${pct(r.score, r.max)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- announcements ----------------
function Announcements({ news }) {
  if (!news.length) return <div className="card"><Empty icon="megaphone" title="No announcements yet" /></div>;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      {news.map((n) => (
        <article key={n.id} className="card stack-sm">
          <span className="tiny muted">{fmtFull(n.created_at)}</span>
          <h2>{n.title}</h2>
          {n.body && <p className="pre">{n.body}</p>}
        </article>
      ))}
    </div>
  );
}

function CACard({ ca }) {
  return (
    <section className="card stack">
      <div className="between" style={{ flexWrap: 'wrap' }}>
        <div className="stack-sm" style={{ gap: 0 }}>
          <span className="eyebrow">Continuous assessment</span>
          <span className="mono" style={{ fontSize: 30 }}>{fmtNumber(ca.total)} <span className="muted" style={{ fontSize: 18 }}>/ {fmtNumber(ca.out_of)}</span></span>
        </div>
        <span className="small muted">Your exam makes up the rest of the course mark.</span>
      </div>
      <div className="stack-sm">
        {ca.components.map((c) => (
          <div key={c.name} className="row small" style={{ gap: 12 }}>
            <span style={{ width: 170 }}>{c.name}</span>
            <div className="bar-track" style={{ flex: 1 }}><div className="bar-fill" style={{ width: `${Math.min(100, Number(c.pct) || 0)}%`, background: 'var(--teal)' }} /></div>
            <span className="mono" style={{ width: 90, textAlign: 'right' }}>{fmtNumber(c.points)} / {fmtNumber(c.weight)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AttendanceCard({ attendance }) {
  if (!attendance || !attendance.total) return null;
  const pctv = Math.round((attendance.attended / attendance.total) * 100);
  return (
    <section className="card-flush">
      <div className="card-head">
        <h2>Attendance</h2>
        <span className={`badge ${pctv < 50 ? 'badge-amber' : 'badge-teal'}`}>{attendance.attended} of {attendance.total} · {pctv}%</span>
      </div>
      {attendance.sessions.slice(0, 30).map((x) => (
        <div key={x.id} className="list-row small">
          <span className="list-main"><span className="title">{x.title}</span><span className="tiny muted">{fmtDateTime(x.opens_at)}</span></span>
          {x.status === 'ok' ? <span className="badge badge-teal">Present</span>
            : x.status === 'review' ? <span className="badge badge-amber" title="Your lecturer is checking this check-in">Being checked</span>
            : x.status === 'rejected' ? <span className="badge badge-red" title="Your check-in was not accepted">Not accepted</span>
            : <span className="badge">Absent</span>}
        </div>
      ))}
    </section>
  );
}


function StudentAttendanceView({ attendance, course, onCheckIn }) {
  const openNow = attendance?.open_now;
  const sessions = attendance?.sessions || [];
  const attended = attendance?.attended || 0;
  const total = attendance?.total || 0;
  const pctv = total > 0 ? Math.round((attended / total) * 100) : 100;

  return (
    <div className="stack-lg" style={{ maxWidth: 860 }}>
      {openNow ? (
        <section className="card" style={{ background: "var(--teal-50, #f0fdfa)", border: "2px solid var(--teal, #0d9488)", padding: "20px 24px" }}>
          <div className="between" style={{ flexWrap: "wrap", gap: 16 }}>
            <div className="stack-sm" style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 0 4px rgba(16, 185, 129, 0.2)" }} />
                <span className="eyebrow" style={{ color: "var(--teal-800, #115e59)" }}>Live Attendance Session In Progress</span>
              </div>
              <h2 style={{ margin: "4px 0", fontSize: 22 }}>Attendance is Open for {course.code}</h2>
              <p className="small muted" style={{ margin: 0 }}>
                Your lecturer has opened attendance with GPS Geofence and rotating code. Tap below to verify your location and submit.
              </p>
            </div>
            <button type="button" className="btn btn-primary" style={{ fontSize: 16, padding: "10px 24px" }} onClick={onCheckIn}>
              <Icon name="check" size={18} /> Check In Now
            </button>
          </div>
        </section>
      ) : (
        <section className="card-soft between" style={{ padding: "16px 20px", flexWrap: "wrap", gap: 12 }}>
          <div className="row" style={{ gap: 10 }}>
            <Icon name="clock" size={20} className="muted" />
            <div>
              <strong>No live attendance session right now</strong>
              <div className="tiny muted">When your lecturer starts attendance in class, the check-in prompt will activate here automatically.</div>
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={onCheckIn}>
            <Icon name="check" size={14} /> Enter code
          </button>
        </section>
      )}

      <section className="card stack">
        <div className="between" style={{ flexWrap: "wrap" }}>
          <div>
            <span className="eyebrow">My Attendance Record</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
              <span className="mono" style={{ fontSize: 32, fontWeight: 700 }}>{pctv}%</span>
              <span className="muted">({attended} of {total} lectures attended)</span>
            </div>
          </div>
          <span className={`badge ${pctv >= 75 ? "badge-teal" : pctv >= 50 ? "badge-amber" : "badge-red"}`} style={{ fontSize: 13, alignSelf: "center" }}>
            {pctv >= 75 ? "Good standing" : pctv >= 50 ? "Attendance Warning" : "At Risk (<50%)"}
          </span>
        </div>
        <div className="bar-track" style={{ height: 8, background: "var(--line-2)" }}>
          <div className="bar-fill" style={{ width: `${Math.min(100, pctv)}%`, background: pctv >= 75 ? "var(--teal, #0d9488)" : pctv >= 50 ? "var(--amber, #f59e0b)" : "var(--red, #ef4444)" }} />
        </div>
      </section>

      <section className="card-flush">
        <div className="card-head">
          <h2>Attendance Log</h2>
          <span className="small muted">{sessions.length} sessions</span>
        </div>
        {sessions.length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center" }} className="muted small">
            No attendance sessions held yet for this course.
          </div>
        ) : (
          sessions.map((x) => (
            <div key={x.id} className="list-row small" style={{ padding: "12px 18px" }}>
              <span className="list-main">
                <span className="title" style={{ fontWeight: 600 }}>{x.title}</span>
                <span className="tiny muted">{fmtDateTime(x.opens_at)}</span>
              </span>
              {x.status === "ok" ? (
                <span className="badge badge-teal"><Icon name="check" size={13} /> Present</span>
              ) : x.status === "review" ? (
                <span className="badge badge-amber" title="Your lecturer is checking this check-in">Being checked</span>
              ) : x.status === "rejected" ? (
                <span className="badge badge-red" title="Your check-in was not accepted">Not accepted</span>
              ) : (
                <span className="badge badge-subtle">Absent</span>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
