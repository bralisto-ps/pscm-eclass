import { lazy, Suspense, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { useAuth } from '../../lib/auth.jsx';
import Icon from '../../components/Icon.jsx';
import NotificationBell from '../../components/NotificationBell.jsx';
import { CourseSkeleton, Empty, ErrorBoundary, ErrorNote, Loading, Tabs, useLoad } from '../../components/ui.jsx';

const MaterialsTab = lazy(() => import('./course/MaterialsTab.jsx'));
const QuizzesTab = lazy(() => import('./course/QuizzesTab.jsx'));
const AssignmentsTab = lazy(() => import('./course/AssignmentsTab.jsx'));
const LabsTab = lazy(() => import('./course/LabsTab.jsx'));
const AttendanceTab = lazy(() => import('./course/AttendanceTab.jsx'));
const StudentsTab = lazy(() => import('./course/StudentsTab.jsx'));
const CATab = lazy(() => import('./course/CATab.jsx'));
const SlotsPanel = lazy(() => import('../../components/SlotsPanel.jsx'));
const PollsFeedbackTab = lazy(() => import('./course/PollsFeedbackTab.jsx'));
const OutcomesPanel = lazy(() => import('../../components/OutcomesPanel.jsx'));
const Forum = lazy(() => import('../../components/Forum.jsx'));
const AnnouncementsTab = lazy(() => import('./course/AnnouncementsTab.jsx'));
const Messages = lazy(() => import('../../components/Messages.jsx'));
const SettingsTab = lazy(() => import('./course/SettingsTab.jsx'));
const StudentPreview = lazy(() => import('../../components/StudentPreview.jsx'));

const TABS = [
  { id: 'materials', label: 'Materials' },
  { id: 'quizzes', label: 'Quizzes' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'labs', label: 'Labs' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'students', label: 'Students' },
  { id: 'ca', label: 'CA' },
  { id: 'slots', label: 'Slots' },
  { id: 'polls', label: 'Polls & Feedback' },
  { id: 'outcomes', label: 'Outcomes & CLO' },
  { id: 'qa', label: 'Q&A' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'messages', label: 'Messages' },
  { id: 'settings', label: 'Settings' },
];
// What a teaching assistant sees.
const TA_TABS = ['quizzes', 'assignments', 'labs', 'attendance', 'students', 'slots', 'polls', 'qa', 'messages', 'announcements'];
// What an external examiner sees (read-only institutional governance & moderation).
const EXAMINER_TABS = ['quizzes', 'assignments', 'labs', 'ca', 'outcomes', 'students', 'settings'];

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
          <Link to="/" className="small nowrap" aria-label="Back to Dashboard">
            ← <span className="hide-xs">Dashboard</span>
          </Link>
          <div className="row-wrap" style={{ justifyContent: 'flex-end', gap: 8 }}>
            {isExaminer && <span className="band-chip">External Examiner · Read-Only</span>}
            {isCoLecturer && <span className="band-chip">Co-Lecturer</span>}
            {isPureTA && <span className="band-chip">Teaching assistant</span>}
            {course.semester && <span className="band-chip hide-xs">{course.semester}</span>}
            {course.archived && <span className="band-chip">Archived</span>}
            <NotificationBell dark />
            {!isExaminer && (
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: previewStudent ? '#ffffff' : 'rgba(0,0,0,0.24)',
                  color: previewStudent ? '#090e17' : '#ffffff',
                  borderColor: 'transparent',
                }}
                onClick={() => setPreviewStudent((v) => !v)}
              >
                <Icon name="eye" size={15} />
                <span className="hide-xs">{previewStudent ? 'Exit student preview' : 'Preview as student'}</span>
                <span className="show-xs-inline" style={{ display: 'none' }}>{previewStudent ? 'Exit' : 'Preview'}</span>
              </button>
            )}
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="code">
            {course.code}
            {course.semester ? ` · ${course.semester}` : ''}
          </div>
          <h1>{course.title}</h1>
        </div>
        {!previewStudent && (
          <Tabs
            dark
            tabs={tabs}
            primaryCount={6}
            value={tab}
            onChange={(t) => setParams({ tab: t }, { replace: true })}
          />
        )}
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
        <ErrorBoundary key={previewStudent ? 'preview' : tab}>
          <Suspense fallback={<Loading label="Loading section…" />}>
            {previewStudent && !isExaminer ? (
              <StudentPreview course={course} onExit={() => setPreviewStudent(false)} />
            ) : (
              <>
                {tab === 'materials' && !isPureTA && !isExaminer && <MaterialsTab course={course} />}
                {tab === 'quizzes' && <QuizzesTab course={course} ta={isPureTA || isExaminer} readOnly={isExaminer} />}
                {tab === 'assignments' && <AssignmentsTab course={course} ta={isPureTA || isExaminer} />}
                {tab === 'labs' && <LabsTab course={course} readOnly={isPureTA || isExaminer} onCourseChanged={reload} />}
                {tab === 'attendance' && !isExaminer && <AttendanceTab course={course} />}
                {tab === 'students' && <StudentsTab course={course} ta={isPureTA || isExaminer} readOnly={isExaminer} />}
                {tab === 'ca' && !isPureTA && <CATab course={course} readOnly={isExaminer} onCourseChanged={reload} />}
                {tab === 'slots' && !isExaminer && <SlotsPanel course={course} staff />}
                {tab === 'polls' && !isExaminer && <PollsFeedbackTab course={course} ta={isPureTA} />}
                {tab === 'outcomes' && !isPureTA && <OutcomesPanel course={course} readOnly={isExaminer} />}
                {tab === 'qa' && !isExaminer && <Forum course={course} lecturer canDelete={!isPureTA} />}
                {tab === 'announcements' && !isExaminer && <AnnouncementsTab course={course} ta={isPureTA} />}
                {tab === 'messages' && !isExaminer && <Messages course={course} isLecturer />}
                {tab === 'settings' && !isPureTA && <SettingsTab course={course} staffRole={effectiveRole} reload={reload} />}
              </>
            )}
          </Suspense>
        </ErrorBoundary>
      </div>
    </>
  );
}
