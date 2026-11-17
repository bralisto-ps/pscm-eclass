import Messages from '../../components/Messages.jsx';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { rpc, rpcAll, run, supabase } from '../../lib/supabase.js';
import { hasCourseInfo, parseCourseMeta } from '../../lib/courseMeta.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtDateTime } from '../../lib/format.js';
import Icon from '../../components/Icon.jsx';
import { removeFiles } from '../../lib/files.js';
import { Confirm, CourseSkeleton, Empty, ErrorBoundary, ErrorNote, Field, Loading, Modal, Tabs, useAction, useLoad } from '../../components/ui.jsx';
import { CourseForm } from './Dashboard.jsx';
import MaterialsTab from './course/MaterialsTab.jsx';
import QuizzesTab from './course/QuizzesTab.jsx';
import AssignmentsTab from './course/AssignmentsTab.jsx';
import StudentsTab from './course/StudentsTab.jsx';
import AnnouncementsTab from './course/AnnouncementsTab.jsx';
import PollsFeedbackTab from './course/PollsFeedbackTab.jsx';
import AttendanceTab from './course/AttendanceTab.jsx';
import CATab from './course/CATab.jsx';
import Forum from '../../components/Forum.jsx';
import CloneCourseModal from '../../components/CloneCourseModal.jsx';
import AuditLogPanel from '../../components/AuditLogPanel.jsx';
import StudentPreview from '../../components/StudentPreview.jsx';

const TABS = [
  { id: 'materials', label: 'Materials' },
  { id: 'quizzes', label: 'Quizzes' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'polls', label: 'Polls & Feedback' },
  { id: 'ca', label: 'CA' },
  { id: 'students', label: 'Students' },
  { id: 'qa', label: 'Q&A' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'messages', label: 'Messages' },
  { id: 'settings', label: 'Settings' },
];
// What a teaching assistant sees.
const TA_TABS = ['quizzes', 'assignments', 'attendance', 'polls', 'students', 'qa', 'messages', 'announcements'];

export default function ManageCourse() {
  const { courseId } = useParams();
  const { isTA } = useAuth();
  const [params, setParams] = useSearchParams();
  const [previewStudent, setPreviewStudent] = useState(false);
  const rawTabs = isTA ? TABS.filter((t) => TA_TABS.includes(t.id)) : TABS;
  const tabs = rawTabs.map((t) => {
    if (t.id === 'attendance' && counts.pending_excuses > 0) return { ...t, count: counts.pending_excuses };
    if (t.id === 'qa' && counts.unanswered_qa > 0) return { ...t, count: counts.unanswered_qa };
    if (t.id === 'messages' && counts.unreplied_messages > 0) return { ...t, count: counts.unreplied_messages };
    return t;
  });
  const asked = params.get('tab');
  const tab = tabs.some((t) => t.id === asked) ? asked : tabs[0].id;
  const { data: loaded, error, loading, reload } = useLoad(async () => {
    const [course, counts] = await Promise.all([
      run(supabase.from('courses').select('*').eq('id', courseId).maybeSingle()),
      rpc('course_attention_counts', { p_course: courseId }).catch(() => null),
    ]);
    return {
      course,
      counts: counts || { unreplied_messages: 0, unanswered_qa: 0, pending_excuses: 0, pending_reviews: 0 },
    };
  }, [courseId]);
  const course = loaded?.course;
  const counts = loaded?.counts || { unreplied_messages: 0, unanswered_qa: 0, pending_excuses: 0, pending_reviews: 0 };

  if (loading) return <CourseSkeleton />;
  if (error) return <div className="page"><ErrorNote error={error} onRetry={reload} /></div>;
  if (!course) return <div className="page"><div className="card"><Empty title="Course not found" /></div></div>;

  return (
    <>
      <header className="course-band" style={{ background: course.color }}>
        <div className="between">
          <Link to="/" className="small">← Dashboard</Link>
          <div className="row-wrap">
            {isTA && <span className="band-chip">Teaching assistant</span>}
            {course.semester && <span className="band-chip">{course.semester}</span>}
            {course.archived && <span className="band-chip">Archived</span>}
            <button type="button" className="btn btn-sm" style={{ background: previewStudent ? '#fff' : 'rgba(0,0,0,0.22)', color: previewStudent ? '#090e17' : '#fff', borderColor: 'transparent' }} onClick={() => setPreviewStudent((v) => !v)}>
              <Icon name="eye" size={15} /> {previewStudent ? 'Exit student preview' : 'Preview as student'}
            </button>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="code">{course.code}</div>
          <h1>{course.title}</h1>
        </div>
        {!previewStudent && <Tabs dark tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />}
      </header>
      <div className="page">
        {!previewStudent && counts.pending_reviews > 0 && (
          <div className="notice notice-warn between small" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <Icon name="flag" size={16} />
              <span>
                <strong>{counts.pending_reviews} mark review request{counts.pending_reviews === 1 ? '' : 's'}</strong> waiting across quizzes or assignments.
              </span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => setParams({ tab: 'quizzes' }, { replace: true })}>Quizzes</button>
              <button type="button" className="btn btn-sm" onClick={() => setParams({ tab: 'assignments' }, { replace: true })}>Assignments</button>
            </div>
          </div>
        )}
        {previewStudent ? (
          <StudentPreview course={course} onExit={() => setPreviewStudent(false)} />
        ) : (
        <ErrorBoundary key={tab}>
          {tab === 'materials' && <MaterialsTab course={course} />}
          {tab === 'quizzes' && <QuizzesTab course={course} ta={isTA} />}
          {tab === 'assignments' && <AssignmentsTab course={course} ta={isTA} />}
          {tab === 'attendance' && <AttendanceTab course={course} />}
          {tab === 'polls' && <PollsFeedbackTab course={course} ta={isTA} />}
          {tab === 'ca' && <CATab course={course} onCourseChanged={reload} />}
          {tab === 'students' && <StudentsTab course={course} ta={isTA} />}
          {tab === 'qa' && <Forum course={course} lecturer canDelete={!isTA} />}
          {tab === 'messages' && <Messages course={course} isLecturer />}
          {tab === 'announcements' && <AnnouncementsTab course={course} ta={isTA} />}
          {tab === 'settings' && !isTA && <SettingsTab course={course} reload={reload} />}
        </ErrorBoundary>
        )}
      </div>
    </>
  );
}

function SettingsTab({ course, reload }) {
  const navigate = useNavigate();
  const [act, busy] = useAction();
  const [editing, setEditing] = useState(false);
  const [cloning, setCloning] = useState(false);
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

  const meta = parseCourseMeta(course);
  const info = meta.course_info || {};

  return (
    <div className="stack-lg" style={{ maxWidth: 880 }}>
      <section className="card stack">
        <div className="between">
          <h2>Course details &amp; timetable</h2>
          <button type="button" className="btn" onClick={() => setEditing(true)}>Edit details</button>
        </div>
        <dl className="grid-2" style={{ margin: 0, gap: 14 }}>
          <div><dt className="eyebrow">Code</dt><dd className="mono" style={{ margin: 0 }}>{course.code}</dd></div>
          <div><dt className="eyebrow">Semester</dt><dd style={{ margin: 0 }}>{course.semester || '—'}</dd></div>
          <div><dt className="eyebrow">Lecture venue</dt><dd style={{ margin: 0 }}>{info.venue || '—'}</dd></div>
          <div><dt className="eyebrow">Office hours</dt><dd className="pre" style={{ margin: 0 }}>{info.officeHours || '—'}</dd></div>
          <div style={{ gridColumn: '1 / -1' }}><dt className="eyebrow">Lecture timetable</dt><dd className="pre" style={{ margin: 0 }}>{info.schedule || '—'}</dd></div>
          <div style={{ gridColumn: '1 / -1' }}><dt className="eyebrow">Description</dt><dd className="pre" style={{ margin: 0 }}>{meta.about || (hasCourseInfo(meta) ? '—' : '—')}</dd></div>
          {info.syllabusNote && <div style={{ gridColumn: '1 / -1' }}><dt className="eyebrow">Key course note</dt><dd className="pre" style={{ margin: 0 }}>{info.syllabusNote}</dd></div>}
        </dl>
      </section>

      <StaffPanel course={course} />

      <AuditLogPanel course={course} />

      <section className="card stack">
        <h2>Clone course for new semester</h2>
        <p className="small muted">
          Create a fresh copy of {course.code} with your weekly modules, learning materials, quizzes, question bank, assignments, and CA structure — without copying old students, attempts, submissions, grades, or attendance.
        </p>
        <div>
          <button type="button" className="btn" onClick={() => setCloning(true)}>
            <Icon name="layers" size={16} /> Clone for new semester
          </button>
        </div>
      </section>

      <section className="card stack">
        <h2>{course.archived ? 'Restore course' : 'Archive course'}</h2>
        <p className="small muted">
          Archiving hides the course from the menu at the end of a semester. Nothing is deleted and you can restore it any time.
        </p>
        <div><button type="button" className="btn" onClick={toggleArchive} disabled={busy}>{course.archived ? 'Restore course' : 'Archive course'}</button></div>
      </section>

      <section className="card stack" style={{ borderColor: 'var(--red-ink)' }}>
        <h2>Delete course</h2>
        <p className="small muted">
          Permanently deletes the course with all its materials, quizzes, attempts, assignments and grades. This cannot be undone —
          export the gradebooks first.
        </p>
        <div><button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>Delete this course…</button></div>
      </section>

      {editing && <CourseForm course={course} onClose={() => setEditing(false)} onSaved={reload} />}
      {cloning && <CloneCourseModal sourceCourse={course} onClose={() => setCloning(false)} />}
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

// Teaching assistants for this course.
function StaffPanel({ course }) {
  const { data, error, loading, reload } = useLoad(() => rpcAll('course_staff_list', { p_course: course.id }), [course.id]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [act, busy] = useAction();

  async function remove() {
    const ok = await act(() => rpc('remove_staff', { p_course: course.id, p_email: removing.email }), 'Removed from this course.');
    setRemoving(null);
    if (ok !== undefined) reload();
  }

  return (
    <section className="card stack" aria-label="Teaching assistants">
      <div className="between">
        <h2>Teaching assistants</h2>
        <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add a TA</button>
      </div>
      <p className="small muted">
        A TA can take attendance, add students to the class list, mark written answers and assignments, see the class list and gradebooks, answer Q&amp;A,
        post announcements and reset student passwords. A TA cannot see or change questions, release results or marks,
        change the CA, delete anything or change course settings. Every mark records who gave it.
      </p>
      {loading && <Loading />}
      <ErrorNote error={error} onRetry={reload} />
      {data && data.length === 0 && <span className="small muted">No teaching assistants on this course.</span>}
      {data && data.length > 0 && (
        <div className="card-flush">
          {data.map((t) => (
            <div key={t.email} className="list-row">
              <span className="list-main">
                <span className="title">{t.full_name || t.email}</span>
                <span className="tiny muted">{t.email}</span>
              </span>
              {t.activated
                ? <span className="badge badge-teal" title={t.last_sign_in ? `Last signed in ${fmtDateTime(t.last_sign_in)}` : ''}>Active</span>
                : <span className="badge badge-amber">Not set up yet</span>}
              <button type="button" className="icon-btn plain" aria-label={`Remove ${t.full_name || t.email}`} onClick={() => setRemoving(t)}><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      )}
      {data && data.some((t) => !t.activated) && (
        <p className="tiny muted">
          Tell your TA: open the site, choose <strong>Teaching assistant? Set up your account</strong> under the sign-in form,
          and use the same email address you entered here.
        </p>
      )}
      {adding && <AddStaffModal course={course} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); reload(); }} />}
      {removing && (
        <Confirm title="Remove this TA?" confirmLabel="Remove" busy={busy} onClose={() => setRemoving(null)} onConfirm={remove}
          message={`${removing.full_name || removing.email} will no longer see ${course.code}. Marks they already gave stay.`} />
      )}
    </section>
  );
}

function AddStaffModal({ course, onClose, onAdded }) {
  const [act, busy] = useAction();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  async function save() {
    const ok = await act(() => rpc('add_staff', { p_course: course.id, p_email: email, p_name: name }), 'Teaching assistant added.');
    if (ok !== undefined) onAdded();
  }
  return (
    <Modal title={`Add a teaching assistant to ${course.code}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !email.trim()}>Add</button></>}>
      <Field label="Their email address" hint="their own Gmail or other email">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="name@gmail.com" />
      </Field>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <p className="tiny muted">You can add the same TA to more than one course. They set their own password the first time.</p>
    </Modal>
  );
}
