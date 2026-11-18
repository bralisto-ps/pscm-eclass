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
import SlotsPanel from '../../components/SlotsPanel.jsx';
import NotificationBell from '../../components/NotificationBell.jsx';
import OutcomesPanel from '../../components/OutcomesPanel.jsx';

const TABS = [
  { id: 'materials', label: 'Materials' },
  { id: 'quizzes', label: 'Quizzes' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'slots', label: 'Slots' },
  { id: 'polls', label: 'Polls & Feedback' },
  { id: 'ca', label: 'CA' },
  { id: 'outcomes', label: 'Outcomes & CLO' },
  { id: 'students', label: 'Students' },
  { id: 'qa', label: 'Q&A' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'messages', label: 'Messages' },
  { id: 'settings', label: 'Settings' },
];
// What a teaching assistant sees.
const TA_TABS = ['quizzes', 'assignments', 'attendance', 'slots', 'polls', 'students', 'qa', 'messages', 'announcements'];
// What an external examiner sees (read-only institutional governance & moderation).
const EXAMINER_TABS = ['quizzes', 'assignments', 'ca', 'outcomes', 'students', 'settings'];

export default function ManageCourse() {
  const { courseId } = useParams();
  const { isTA } = useAuth();
  const [params, setParams] = useSearchParams();
  const [previewStudent, setPreviewStudent] = useState(false);
  const { data: loaded, error, loading, reload } = useLoad(async () => {
    const [courseRow, countsRow, staffRole] = await Promise.all([
      run(supabase.from('courses').select('*').eq('id', courseId).maybeSingle()),
      rpc('course_attention_counts', { p_course: courseId }).catch(() => null),
      rpc('my_course_staff_role', { p_course: courseId }).catch(() => null),
    ]);
    return {
      course: courseRow,
      counts: countsRow || { unreplied_messages: 0, unanswered_qa: 0, pending_excuses: 0, pending_reviews: 0 },
      staffRole: staffRole || '',
    };
  }, [courseId]);
  const course = loaded?.course;
  const counts = loaded?.counts || { unreplied_messages: 0, unanswered_qa: 0, pending_excuses: 0, pending_reviews: 0 };
  const effectiveRole = loaded?.staffRole || (isTA ? 'ta' : 'lecturer');
  const isExaminer = effectiveRole === 'external_examiner';
  const isCoLecturer = effectiveRole === 'co_lecturer';
  const isPureTA = isTA && !isCoLecturer && !isExaminer;
  const rawTabs = isExaminer
    ? TABS.filter((t) => EXAMINER_TABS.includes(t.id))
    : isPureTA
      ? TABS.filter((t) => TA_TABS.includes(t.id))
      : TABS;
  const tabs = rawTabs.map((t) => {
    if (t.id === 'attendance' && counts.pending_excuses > 0) return { ...t, count: counts.pending_excuses };
    if (t.id === 'qa' && counts.unanswered_qa > 0) return { ...t, count: counts.unanswered_qa };
    if (t.id === 'messages' && counts.unreplied_messages > 0) return { ...t, count: counts.unreplied_messages };
    return t;
  });
  const asked = params.get('tab');
  const tab = tabs.some((t) => t.id === asked) ? asked : tabs[0].id;

  if (loading) return <CourseSkeleton />;
  if (error) return <div className="page"><ErrorNote error={error} onRetry={reload} /></div>;
  if (!course) return <div className="page"><div className="card"><Empty title="Course not found" /></div></div>;

  return (
    <>
      <header className="course-band" style={{ background: course.color }}>
        <div className="between">
          <Link to="/" className="small">← Dashboard</Link>
          <div className="row-wrap">
            {isExaminer && <span className="band-chip">External Examiner · Read-Only</span>}
            {isCoLecturer && <span className="band-chip">Co-Lecturer</span>}
            {isPureTA && <span className="band-chip">Teaching assistant</span>}
            {course.semester && <span className="band-chip">{course.semester}</span>}
            {course.archived && <span className="band-chip">Archived</span>}
            <NotificationBell dark />
            {!isExaminer && (
              <button type="button" className="btn btn-sm" style={{ background: previewStudent ? '#fff' : 'rgba(0,0,0,0.22)', color: previewStudent ? '#090e17' : '#fff', borderColor: 'transparent' }} onClick={() => setPreviewStudent((v) => !v)}>
                <Icon name="eye" size={15} /> {previewStudent ? 'Exit student preview' : 'Preview as student'}
              </button>
            )}
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="code">{course.code}</div>
          <h1>{course.title}</h1>
        </div>
        {!previewStudent && <Tabs dark tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />}
      </header>
      <div className="page">
        {!previewStudent && !isExaminer && counts.pending_reviews > 0 && (
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
        {previewStudent && !isExaminer ? (
          <StudentPreview course={course} onExit={() => setPreviewStudent(false)} />
        ) : (
        <ErrorBoundary key={tab}>
          {tab === 'materials' && !isPureTA && !isExaminer && <MaterialsTab course={course} />}
          {tab === 'quizzes' && <QuizzesTab course={course} ta={isPureTA || isExaminer} />}
          {tab === 'assignments' && <AssignmentsTab course={course} ta={isPureTA || isExaminer} />}
          {tab === 'attendance' && !isExaminer && <AttendanceTab course={course} />}
          {tab === 'slots' && !isExaminer && <SlotsPanel course={course} staff />}
          {tab === 'polls' && !isExaminer && <PollsFeedbackTab course={course} ta={isPureTA} />}
          {tab === 'ca' && !isPureTA && <CATab course={course} readOnly={isExaminer} onCourseChanged={reload} />}
          {tab === 'outcomes' && !isPureTA && <OutcomesPanel course={course} readOnly={isExaminer} />}
          {tab === 'students' && <StudentsTab course={course} ta={isPureTA || isExaminer} readOnly={isExaminer} />}
          {tab === 'qa' && !isExaminer && <Forum course={course} lecturer canDelete={!isPureTA} />}
          {tab === 'messages' && !isExaminer && <Messages course={course} isLecturer />}
          {tab === 'announcements' && !isExaminer && <AnnouncementsTab course={course} ta={isPureTA} />}
          {tab === 'settings' && !isPureTA && <SettingsTab course={course} staffRole={effectiveRole} reload={reload} />}
        </ErrorBoundary>
        )}
      </div>
    </>
  );
}

function SettingsTab({ course, staffRole = 'lecturer', reload }) {
  const isOwner = staffRole === 'lecturer';
  const isCoLecturer = staffRole === 'co_lecturer';
  const isExaminer = staffRole === 'external_examiner';
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
          {!isExaminer && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit details</button>}
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

      <StaffPanel course={course} canEdit={isOwner} />

      <AuditLogPanel course={course} />

      {(isOwner || isCoLecturer) && (
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
      )}

      {isOwner && (
        <>
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
        </>
      )}

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

const STAFF_ROLE_LABELS = {
  ta: ['Teaching Assistant', 'badge'],
  co_lecturer: ['Co-Lecturer', 'badge-blue'],
  external_examiner: ['External Examiner (Read-Only)', 'badge-plum'],
};

// Teaching staff (TAs, Co-Lecturers & External Examiners) for this course.
function StaffPanel({ course, canEdit = true }) {
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
    <section className="card stack" aria-label="Course teaching staff and examiners">
      <div className="between">
        <h2>Co-Lecturers, TAs &amp; External Examiners</h2>
        {canEdit && (
          <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Add staff / examiner
          </button>
        )}
      </div>
      <p className="small muted">
        <strong>Co-Lecturers</strong> can manage materials, quizzes, rubrics, CA, and grades. <strong>Teaching Assistants</strong> handle attendance, marking, Q&amp;A, and roster updates.{' '}
        <strong>External Examiners</strong> receive read-only governance access to scripts, gradebooks, audit trails, CLO attainment, and moderation sign-offs.
      </p>
      {loading && <Loading />}
      <ErrorNote error={error} onRetry={reload} />
      {data && data.length === 0 && <span className="small muted">No additional staff or examiners on this course.</span>}
      {data && data.length > 0 && (
        <div className="card-flush">
          {data.map((t) => {
            const [roleLabel, roleCls] = STAFF_ROLE_LABELS[t.staff_role || 'ta'] || STAFF_ROLE_LABELS.ta;
            return (
              <div key={t.email} className="list-row">
                <span className="list-main">
                  <span className="title row-wrap" style={{ gap: 6, alignItems: 'center' }}>
                    <span>{t.full_name || t.email}</span>
                    <span className={`badge ${roleCls}`}>{roleLabel}</span>
                  </span>
                  <span className="tiny muted">{t.email}</span>
                </span>
                {t.activated
                  ? <span className="badge badge-teal" title={t.last_sign_in ? `Last signed in ${fmtDateTime(t.last_sign_in)}` : ''}>Active</span>
                  : <span className="badge badge-amber">Not set up yet</span>}
                {canEdit && (
                  <button type="button" className="icon-btn plain" aria-label={`Remove ${t.full_name || t.email}`} onClick={() => setRemoving(t)}><Icon name="trash" /></button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {data && data.some((t) => !t.activated) && (
        <p className="tiny muted">
          Invitees open the site, choose <strong>Teaching assistant? Set up your account</strong> under the sign-in form,
          and sign up with the exact email address entered here.
        </p>
      )}
      {adding && <AddStaffModal course={course} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); reload(); }} />}
      {removing && (
        <Confirm title="Remove staff member?" confirmLabel="Remove" busy={busy} onClose={() => setRemoving(null)} onConfirm={remove}
          message={`${removing.full_name || removing.email} will no longer see ${course.code}. Marks and moderation notes they already recorded stay.`} />
      )}
    </section>
  );
}

function AddStaffModal({ course, onClose, onAdded }) {
  const [act, busy] = useAction();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [staffRole, setStaffRole] = useState('ta');
  async function save() {
    const ok = await act(async () => {
      try {
        return await rpc('add_staff', { p_course: course.id, p_email: email, p_name: name, p_staff_role: staffRole });
      } catch (err) {
        if (staffRole === 'ta' && /add_staff|parameter|function/i.test(err?.message || '')) {
          return await rpc('add_staff', { p_course: course.id, p_email: email, p_name: name });
        }
        throw err;
      }
    }, 'Course staff member added.');
    if (ok !== undefined) onAdded();
  }
  return (
    <Modal title={`Add staff or examiner to ${course.code}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !email.trim()}>Add</button></>}>
      <Field label="Their email address" hint="their own Gmail or institutional email">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="name@gmail.com" />
      </Field>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Role in this course">
        <select className="select" value={staffRole} onChange={(e) => setStaffRole(e.target.value)}>
          <option value="ta">Teaching Assistant — attendance, marking, Q&amp;A, roster</option>
          <option value="co_lecturer">Co-Lecturer — full materials, quizzes, CA, and grades</option>
          <option value="external_examiner">External Examiner — read-only scripts, CA &amp; moderation sign-off</option>
        </select>
      </Field>
      <p className="tiny muted">You can assign the same staff member or examiner to multiple courses. They set their own password on first sign-in.</p>
    </Modal>
  );
}
