import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { run, supabase } from '../../lib/supabase.js';
import { removeFiles } from '../../lib/files.js';
import { Confirm, Empty, ErrorNote, Loading, Tabs, useAction, useLoad } from '../../components/ui.jsx';
import { CourseForm } from './Dashboard.jsx';
import MaterialsTab from './course/MaterialsTab.jsx';
import QuizzesTab from './course/QuizzesTab.jsx';
import AssignmentsTab from './course/AssignmentsTab.jsx';
import StudentsTab from './course/StudentsTab.jsx';
import AnnouncementsTab from './course/AnnouncementsTab.jsx';
import AttendanceTab from './course/AttendanceTab.jsx';
import CATab from './course/CATab.jsx';
import Forum from '../../components/Forum.jsx';

const TABS = [
  { id: 'materials', label: 'Materials' },
  { id: 'quizzes', label: 'Quizzes' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'ca', label: 'CA' },
  { id: 'students', label: 'Students' },
  { id: 'qa', label: 'Q&A' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'settings', label: 'Settings' },
];

export default function ManageCourse() {
  const { courseId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'materials';
  const { data: course, error, loading, reload } = useLoad(
    () => run(supabase.from('courses').select('*').eq('id', courseId).maybeSingle()),
    [courseId],
  );

  if (loading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} onRetry={reload} /></div>;
  if (!course) return <div className="page"><div className="card"><Empty title="Course not found" /></div></div>;

  return (
    <>
      <header className="course-band" style={{ background: course.color }}>
        <div className="between">
          <Link to="/" className="small">← Dashboard</Link>
          <div className="row-wrap">
            {course.semester && <span className="band-chip">{course.semester}</span>}
            {course.archived && <span className="band-chip">Archived</span>}
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="code">{course.code}</div>
          <h1>{course.title}</h1>
        </div>
        <Tabs dark tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      </header>
      <div className="page">
        {tab === 'materials' && <MaterialsTab course={course} />}
        {tab === 'quizzes' && <QuizzesTab course={course} />}
        {tab === 'assignments' && <AssignmentsTab course={course} />}
        {tab === 'attendance' && <AttendanceTab course={course} />}
        {tab === 'ca' && <CATab course={course} onCourseChanged={reload} />}
        {tab === 'students' && <StudentsTab course={course} />}
        {tab === 'qa' && <Forum course={course} lecturer />}
        {tab === 'announcements' && <AnnouncementsTab course={course} />}
        {tab === 'settings' && <SettingsTab course={course} reload={reload} />}
      </div>
    </>
  );
}

function SettingsTab({ course, reload }) {
  const navigate = useNavigate();
  const [act, busy] = useAction();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');

  async function toggleArchive() {
    const ok = await act(
      () => run(supabase.from('courses').update({ archived: !course.archived }).eq('id', course.id)),
      course.archived ? 'Course restored.' : 'Course archived. Students no longer see it in their menu.',
    );
    if (ok !== undefined) reload();
  }

  async function remove() {
    const ok = await act(async () => {
      const mats = await run(supabase.from('materials').select('storage_path').eq('course_id', course.id).not('storage_path', 'is', null));
      const subs = await run(supabase.from('submissions').select('file_path, assignments!inner(course_id)').eq('assignments.course_id', course.id));
      await removeFiles('materials', mats.map((m) => m.storage_path));
      await removeFiles('submissions', subs.map((x) => x.file_path));
      return run(supabase.from('courses').delete().eq('id', course.id));
    }, 'Course deleted.');
    if (ok !== undefined) navigate('/');
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <section className="card stack">
        <div className="between">
          <h2>Course details</h2>
          <button type="button" className="btn" onClick={() => setEditing(true)}>Edit details</button>
        </div>
        <dl className="grid-2" style={{ margin: 0 }}>
          <div><dt className="eyebrow">Code</dt><dd className="mono" style={{ margin: 0 }}>{course.code}</dd></div>
          <div><dt className="eyebrow">Semester</dt><dd style={{ margin: 0 }}>{course.semester || '—'}</dd></div>
          <div style={{ gridColumn: '1 / -1' }}><dt className="eyebrow">Description</dt><dd className="pre" style={{ margin: 0 }}>{course.description || '—'}</dd></div>
        </dl>
      </section>

      <section className="card stack">
        <h2>{course.archived ? 'Restore course' : 'Archive course'}</h2>
        <p className="small muted">
          Archiving hides the course from the menu at the end of a semester. Nothing is deleted and you can restore it any time.
        </p>
        <div><button type="button" className="btn" onClick={toggleArchive} disabled={busy}>{course.archived ? 'Restore course' : 'Archive course'}</button></div>
      </section>

      <section className="card stack" style={{ borderColor: '#efc2b8' }}>
        <h2>Delete course</h2>
        <p className="small muted">
          Permanently deletes the course with all its materials, quizzes, attempts, assignments and grades. This cannot be undone —
          export the gradebooks first.
        </p>
        <div><button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>Delete this course…</button></div>
      </section>

      {editing && <CourseForm course={course} onClose={() => setEditing(false)} onSaved={reload} />}
      {deleting && (
        <Confirm
          title="Delete course permanently?"
          danger
          busy={busy || typed.trim().toUpperCase() !== course.code}
          confirmLabel="Delete forever"
          onClose={() => setDeleting(false)}
          onConfirm={remove}
        >
          <p>Type <strong className="mono">{course.code}</strong> to confirm.</p>
          <input className="input mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </Confirm>
      )}
    </div>
  );
}
