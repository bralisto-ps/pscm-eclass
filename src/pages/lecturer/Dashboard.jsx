import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { useAuth } from '../../lib/auth.jsx';
import { COURSE_COLORS, contrastWithWhite, greeting, initials } from '../../lib/format.js';
import Icon from '../../components/Icon.jsx';
import { Topbar } from '../../components/Layout.jsx';
import { Bar, DashboardSkeleton, ErrorNote, Field, Modal, Swatch, useAction, useLoad } from '../../components/ui.jsx';
import CloneCourseModal from '../../components/CloneCourseModal.jsx';

export default function Dashboard() {
  const { profile, isTA } = useAuth();
  const { data, error, loading, reload } = useLoad(() => rpc('lecturer_overview'), []);
  const [creating, setCreating] = useState(false);
  const [cloning, setCloning] = useState(false);

  const courses = (data || []).filter((c) => !c.archived);
  const archived = (data || []).filter((c) => c.archived);
  const totals = courses.reduce(
    (t, c) => ({
      students: t.students + c.students,
      activated: t.activated + c.activated,
      toMark: t.toMark + c.to_mark,
      quizzes: t.quizzes + c.quizzes,
    }),
    { students: 0, activated: 0, toMark: 0, quizzes: 0 },
  );
  const activatedPct = totals.students ? Math.round((totals.activated / totals.students) * 100) : 0;
  const priorityCourse = [...courses].sort((a, b) => (b.to_mark || 0) - (a.to_mark || 0))[0] || null;
  const todayChip = {
    day: new Date().toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(),
    date: new Date().getDate(),
    month: new Date().toLocaleDateString('en-GB', { month: 'short' }).toUpperCase(),
  };

  return (
    <>
      <Topbar
        title={`${greeting()}, ${(isTA ? (profile.full_name || '').split(' ')[0] : (profile.full_name || '').split(' ').slice(-1)[0]) || 'Lecturer'}`}
        sub={isTA ? 'Teaching assistant' : 'Lecturer dashboard'}
      >
        {!isTA && (
          <div className="row-wrap" style={{ gap: 8 }}>
            {(data || []).length > 0 && (
              <button type="button" className="btn" onClick={() => setCloning(true)}>
                <Icon name="layers" size={16} /> Clone for new semester
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} /> New course
            </button>
          </div>
        )}
      </Topbar>

      <div className="page stack-lg">
        {loading && <DashboardSkeleton />}
        <ErrorNote error={error} onRetry={reload} />
        {data && (
          <>
            {courses.length > 0 && (
              <section className="hero" aria-label="Faculty overview">
                <div className="date-block">
                  <span className="tiny strong" style={{ color: '#fcd34d', letterSpacing: '0.08em' }}>{todayChip.day}</span>
                  <span className="d">{todayChip.date}</span>
                  <span className="tiny" style={{ color: '#94a3b8' }}>{todayChip.month}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }} className="stack-sm">
                  <span className="kicker">
                    {totals.toMark > 0 ? `Marking queue · ${priorityCourse?.code}` : 'Faculty overview'}
                  </span>
                  <span className="title">
                    {totals.toMark > 0
                      ? `${totals.toMark} submission${totals.toMark === 1 ? '' : 's'} waiting for review`
                      : 'All coursework and assessments are up to date'}
                  </span>
                  <span className="meta">
                    {courses.length} active course{courses.length === 1 ? '' : 's'} · {totals.students.toLocaleString()} enrolled students · {activatedPct}% activated
                  </span>
                </div>
                {priorityCourse && (
                  <Link
                    to={totals.toMark > 0 ? `/teach/course/${priorityCourse.id}?tab=assignments` : `/teach/course/${priorityCourse.id}`}
                    className="btn btn-light"
                  >
                    {totals.toMark > 0 ? `Review ${priorityCourse.code}` : `Open ${priorityCourse.code}`}
                  </Link>
                )}
              </section>
            )}

            <section className="grid-4" aria-label="Summary">
              <div className="kpi">
                <div className="kpi-head">
                  <span className="l">Active courses</span>
                  <span className="kpi-icon"><Icon name="book" size={15} /></span>
                </div>
                <span className="v">{courses.length}</span>
                <span className="kpi-sub">{totals.quizzes} {totals.quizzes === 1 ? 'quiz' : 'quizzes'} created</span>
              </div>
              <div className="kpi">
                <div className="kpi-head">
                  <span className="l">Enrolments</span>
                  <span className="kpi-icon blue"><Icon name="users" size={15} /></span>
                </div>
                <span className="v">{totals.students.toLocaleString()}</span>
                <span className="kpi-sub">Across {courses.length} {courses.length === 1 ? 'course' : 'courses'}</span>
              </div>
              <div className="kpi">
                <div className="kpi-head">
                  <span className="l">Accounts activated</span>
                  <span className="kpi-icon plum"><Icon name="check" size={15} /></span>
                </div>
                <span className="v">{activatedPct}%</span>
                <span className="kpi-sub">{totals.activated.toLocaleString()} of {totals.students.toLocaleString()} students</span>
              </div>
              <div className="kpi">
                <div className="kpi-head">
                  <span className="l">Waiting for marking</span>
                  <span className={`kpi-icon ${totals.toMark ? 'amber' : ''}`} style={!totals.toMark ? { background: 'var(--grey-50)', color: 'var(--muted)' } : undefined}>
                    <Icon name="clock" size={15} />
                  </span>
                </div>
                <span className="v" style={{ color: totals.toMark ? 'var(--amber-ink)' : undefined }}>{totals.toMark}</span>
                <span className="kpi-sub">{totals.toMark ? 'Pending review' : 'All caught up'}</span>
              </div>
            </section>

            {courses.length === 0 && isTA ? (
              <div className="card stack">
                <h2>No courses yet</h2>
                <p className="muted">The lecturer has not added you to a course yet, or has removed you. Courses you help with will appear here.</p>
              </div>
            ) : courses.length === 0 ? (
              <div className="card stack">
                <h2>Get started in four steps</h2>
                <ol className="stack-sm" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                  <li>Create a course (for example <span className="mono">SCM 101</span>).</li>
                  <li>Upload its class list from Excel — index numbers and names.</li>
                  <li>Add weekly materials, then build a quiz or assignment.</li>
                  <li>Tell students to open the site and choose <strong>Activate your account</strong>.</li>
                </ol>
                <div>
                  <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                    <Icon name="plus" /> Create your first course
                  </button>
                </div>
              </div>
            ) : (
              <section>
                <div className="section-title">
                  <h2>Your courses</h2>
                  <span className="small muted">{courses.length} active</span>
                </div>
                <div className="grid-2">
                  {courses.map((c) => <CourseCard key={c.id} c={c} />)}
                </div>
              </section>
            )}

            {archived.length > 0 && (
              <section>
                <div className="section-title"><h2 className="muted">Archived</h2></div>
                <div className="grid-3">
                  {archived.map((c) => (
                    <Link key={c.id} to={`/teach/course/${c.id}`} className="course-tile" style={{ opacity: 0.78 }}>
                      <div className="course-accent-bar" style={{ background: c.color }} />
                      <Swatch color={c.color} text={initials(c.title)} size={34} />
                      <span className="stack-sm" style={{ gap: 2 }}>
                        <span className="strong small" style={{ fontFamily: 'var(--serif)', fontSize: 15 }}>{c.title}</span>
                        <span className="mono tiny muted">{c.code}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {creating && <CourseForm onClose={() => setCreating(false)} />}
      {cloning && <CloneCourseModal courses={data || []} onClose={() => setCloning(false)} />}
    </>
  );
}

function CourseCard({ c }) {
  const activePct = c.students ? Math.round((c.activated / c.students) * 100) : 0;
  return (
    <Link to={`/teach/course/${c.id}`} className="course-card-ed">
      <div className="course-card-band" style={{ backgroundColor: c.color }}>
        <div className="course-card-meta">
          <span className="mono">{c.code}{c.semester ? ` · ${c.semester}` : ''}</span>
          {c.to_mark > 0 && (
            <span className="strong nowrap" style={{ color: '#fde68a' }}>
              {c.to_mark} to mark
            </span>
          )}
        </div>
        <div className="course-card-title">{c.title}</div>
      </div>

      <div className="course-card-body">
        <div className="course-card-stats">
          <Mini v={c.students} l="Students" />
          <Mini v={c.materials} l="Materials" />
          <Mini v={c.quizzes} l="Quizzes" />
        </div>
        <div className="stack-sm" style={{ gap: 8 }}>
          <Bar value={activePct} color={c.color} />
          <div className="course-card-foot">
            <span>{c.activated} of {c.students} activated ({activePct}%)</span>
            <span className="course-card-cta">Manage <Icon name="chevronRight" size={14} /></span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function Mini({ v, l }) {
  return (
    <div className="course-card-stat">
      <span className="num">{Number(v).toLocaleString()}</span>
      <span className="lbl">{l}</span>
    </div>
  );
}

export function CourseForm({ course, onClose, onSaved }) {
  const navigate = useNavigate();
  const [act, busy] = useAction();
  const [f, setF] = useState({
    code: course?.code || '',
    title: course?.title || '',
    semester: course?.semester || '',
    description: course?.description || '',
    color: course?.color || COURSE_COLORS[0],
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const tooLight = contrastWithWhite(f.color) < 4.5;

  async function save() {
    if (!f.code.trim() || !f.title.trim() || tooLight) return;
    const row = { ...f, code: f.code.trim().toUpperCase(), title: f.title.trim() };
    const saved = await act(
      () =>
        course
          ? run(supabase.from('courses').update(row).eq('id', course.id).select().single())
          : run(supabase.from('courses').insert(row).select().single()),
      course ? 'Course updated.' : 'Course created.',
    );
    if (saved) {
      onClose();
      if (onSaved) onSaved(saved);
      else navigate(`/teach/course/${saved.id}?tab=students`);
    }
  }

  return (
    <Modal
      title={course ? 'Edit course' : 'New course'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !f.code.trim() || !f.title.trim() || tooLight}>
            {course ? 'Save changes' : 'Create course'}
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Course code"><input className="input mono" value={f.code} onChange={set('code')} placeholder="SCM 101" /></Field>
        <Field label="Semester" hint="optional"><input className="input" value={f.semester} onChange={set('semester')} placeholder="Semester 1, 2026/27" /></Field>
      </div>
      <Field label="Course title"><input className="input" value={f.title} onChange={set('title')} placeholder="Introduction to Supply Chain Management" /></Field>
      <Field label="Short description" hint="optional"><textarea className="textarea" value={f.description} onChange={set('description')} /></Field>
      <div className="field">
        <span className="field-label">Colour</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))', gap: 8 }}>
          {COURSE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setF({ ...f, color: c })}
              aria-label={`Colour ${c}`}
              aria-pressed={f.color.toLowerCase() === c.toLowerCase()}
              style={{
                width: '100%',
                aspectRatio: '1',
                minHeight: 36,
                borderRadius: 9,
                background: c,
                cursor: 'pointer',
                border: f.color.toLowerCase() === c.toLowerCase() ? '3px solid var(--text)' : '3px solid transparent',
                outline: f.color.toLowerCase() === c.toLowerCase() ? '2px solid var(--surface)' : 'none',
                outlineOffset: -5,
              }}
            />
          ))}
        </div>
        <div className="row-wrap" style={{ marginTop: 8 }}>
          <label className="row small" style={{ gap: 8 }}>
            <input
              type="color"
              value={f.color}
              onChange={(e) => setF({ ...f, color: e.target.value })}
              aria-label="Custom colour"
              style={{ width: 44, height: 40, padding: 2, border: '1px solid var(--field)', borderRadius: 8, background: 'var(--surface)', cursor: 'pointer' }}
            />
            Any colour
          </label>
          <div className="course-card-band" style={{ flex: 1, minWidth: 180, backgroundColor: f.color, borderRadius: 8, padding: '12px 16px' }}>
            <div className="mono tiny" style={{ opacity: 0.88 }}>{f.code.trim().toUpperCase() || 'SCM 101'}</div>
            <div className="course-card-title" style={{ fontSize: 17, marginTop: 3 }}>{f.title.trim() || 'Course title'}</div>
          </div>
        </div>
        {tooLight && <span className="small" style={{ color: 'var(--red-ink)' }}>This colour is too light for the white heading text. Pick a darker shade.</span>}
      </div>
    </Modal>
  );
}
