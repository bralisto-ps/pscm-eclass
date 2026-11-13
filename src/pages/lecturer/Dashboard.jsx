import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { useAuth } from '../../lib/auth.jsx';
import { COURSE_COLORS, contrastWithWhite, greeting, initials } from '../../lib/format.js';
import Icon from '../../components/Icon.jsx';
import { Topbar } from '../../components/Layout.jsx';
import { Bar, ErrorNote, Field, Loading, Modal, Swatch, useAction, useLoad } from '../../components/ui.jsx';
import CloneCourseModal from '../../components/CloneCourseModal.jsx';

export default function Dashboard() {
  const { profile, isTA } = useAuth();
  const { data, error, loading, reload } = useLoad(() => rpc('lecturer_overview'), []);
  const [creating, setCreating] = useState(false);
  const [cloning, setCloning] = useState(false);
  const courses = (data || []).filter((c) => !c.archived);
  const archived = (data || []).filter((c) => c.archived);
  const totals = courses.reduce(
    (t, c) => ({ students: t.students + c.students, activated: t.activated + c.activated, toMark: t.toMark + c.to_mark, quizzes: t.quizzes + c.quizzes }),
    { students: 0, activated: 0, toMark: 0, quizzes: 0 },
  );

  return (
    <>
      <Topbar title={`${greeting()}, ${(isTA ? (profile.full_name || '').split(' ')[0] : (profile.full_name || '').split(' ').slice(-1)[0]) || 'Lecturer'}`}
        sub={isTA ? 'Teaching assistant' : 'Lecturer dashboard'}>
        {!isTA && (
          <div className="row-wrap" style={{ gap: 8 }}>
            {(data || []).length > 0 && (
              <button type="button" className="btn" onClick={() => setCloning(true)}>
                <Icon name="layers" /> Clone for new semester
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New course
            </button>
          </div>
        )}
      </Topbar>
      <div className="page stack-lg">
        {loading && <Loading />}
        <ErrorNote error={error} onRetry={reload} />
        {data && (
          <>
            <section className="grid-4" aria-label="Summary">
              <div className="kpi"><span className="l">Courses</span><span className="v">{courses.length}</span></div>
              <div className="kpi"><span className="l">Enrolments</span><span className="v">{totals.students.toLocaleString()}</span></div>
              <div className="kpi">
                <span className="l">Accounts activated</span>
                <span className="v">{totals.students ? Math.round((totals.activated / totals.students) * 100) : 0}%</span>
              </div>
              <div className="kpi">
                <span className="l">Waiting for marking</span>
                <span className="v" style={{ color: totals.toMark ? 'var(--amber-ink)' : undefined }}>{totals.toMark}</span>
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
                <div className="section-title"><h2>Your courses</h2></div>
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
                    <Link key={c.id} to={`/teach/course/${c.id}`} className="course-tile" style={{ opacity: 0.75 }}>
                      <Swatch color={c.color} text={initials(c.title)} size={34} />
                      <span className="stack-sm" style={{ gap: 0 }}>
                        <span className="strong small">{c.title}</span>
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
    <Link to={`/teach/course/${c.id}`} className="course-tile" style={{ flexDirection: 'column', gap: 14 }}>
      <div className="row" style={{ width: '100%' }}>
        <Swatch color={c.color} text={initials(c.title)} />
        <div className="stack-sm" style={{ gap: 0, flex: 1, minWidth: 0 }}>
          <span className="strong">{c.title}</span>
          <span className="mono tiny muted">{c.code}{c.semester ? ` · ${c.semester}` : ''}</span>
        </div>
        {c.to_mark > 0 && <span className="badge badge-amber">{c.to_mark} to mark</span>}
      </div>
      <div className="grid-3" style={{ width: '100%', gap: 8 }}>
        <Mini v={c.students} l="students" />
        <Mini v={c.materials} l="materials" />
        <Mini v={c.quizzes} l="quizzes" />
      </div>
      <div style={{ width: '100%' }} className="stack-sm">
        <Bar value={activePct} color={c.color} />
        <span className="tiny muted">{c.activated} of {c.students} students have activated their account</span>
      </div>
    </Link>
  );
}

function Mini({ v, l }) {
  return (
    <div className="stack-sm" style={{ gap: 0 }}>
      <span className="mono" style={{ fontSize: 20 }}>{Number(v).toLocaleString()}</span>
      <span className="tiny muted">{l}</span>
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
            <button key={c} type="button" onClick={() => setF({ ...f, color: c })} aria-label={`Colour ${c}`} aria-pressed={f.color.toLowerCase() === c.toLowerCase()}
              style={{ width: '100%', aspectRatio: '1', minHeight: 36, borderRadius: 9, background: c, cursor: 'pointer', border: f.color.toLowerCase() === c.toLowerCase() ? '3px solid var(--ink)' : '3px solid transparent', outline: f.color.toLowerCase() === c.toLowerCase() ? '2px solid #fff' : 'none', outlineOffset: -5 }} />
          ))}
        </div>
        <div className="row-wrap" style={{ marginTop: 8 }}>
          <label className="row small" style={{ gap: 8 }}>
            <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} aria-label="Custom colour"
              style={{ width: 44, height: 40, padding: 2, border: '1px solid var(--field)', borderRadius: 8, background: '#fff', cursor: 'pointer' }} />
            Any colour
          </label>
          <div style={{ flex: 1, minWidth: 180, background: f.color, color: '#fff', borderRadius: 8, padding: '10px 14px' }}>
            <div className="mono tiny" style={{ opacity: 0.85 }}>{f.code.trim().toUpperCase() || 'SCM 101'}</div>
            <strong>{f.title.trim() || 'Course title'}</strong>
          </div>
        </div>
        {tooLight && <span className="small" style={{ color: 'var(--red-ink)' }}>This colour is too light for the white heading text. Pick a darker shade.</span>}
      </div>
    </Modal>
  );
}
