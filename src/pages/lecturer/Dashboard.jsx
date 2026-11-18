import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { useAuth } from '../../lib/auth.jsx';
import { COURSE_COLORS, contrastWithWhite, fmtDate, greeting, initials, relative } from '../../lib/format.js';
import { parseCourseMeta, serializeCourseMeta } from '../../lib/courseMeta.js';
import Icon from '../../components/Icon.jsx';
import { Topbar } from '../../components/Layout.jsx';
import { Bar, DashboardSkeleton, ErrorNote, Field, Modal, Swatch, useAction, useLoad, useToast } from '../../components/ui.jsx';
import CloneCourseModal from '../../components/CloneCourseModal.jsx';

function dayKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function fetchDashboardBundle() {
  const [overview, staffRoles] = await Promise.all([
    rpc('lecturer_overview'),
    rpc('my_staff_roles').catch(() => ({})),
  ]);
  const courses = Array.isArray(overview) ? overview : [];
  const rolesMap = staffRoles && typeof staffRoles === 'object' ? staffRoles : {};
  if (!courses.length) {
    return {
      courses,
      pendingAssignments: [],
      pendingQuizzes: [],
      deadlines: [],
      liveAttendance: [],
      liveQuizzes: [],
      liveQuizTakers: 0,
      dailyPulse: [],
      unansweredQa: [],
      attentionItems: [],
      attentionCounts: { messages: 0, excuses: 0, reviews: 0, qa: 0 },
      staffRoles: rolesMap,
    };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);
  const fourteenDaysAhead = new Date(now.getTime() + 14 * 86400 * 1000).toISOString();

  const [
    unmarkedSubsRes,
    unmarkedEssaysRes,
    quizzesRes,
    assignmentsRes,
    attendanceRes,
    recentAttemptsRes,
    recentSubsRes,
    qaRes,
    msgRes,
    excuseRes,
    reviewRes,
  ] = await Promise.allSettled([
    supabase
      .from('submissions')
      .select('id, assignment_id, submitted_at, assignments!inner(id, title, course_id)')
      .is('marks', null)
      .order('submitted_at', { ascending: false })
      .limit(500),
    supabase
      .from('responses')
      .select('id, attempts!inner(quiz_id, status, quizzes!inner(id, title, course_id)), questions!inner(kind)')
      .is('marks_awarded', null)
      .neq('attempts.status', 'in_progress')
      .eq('questions.kind', 'essay')
      .limit(500),
    supabase
      .from('quizzes')
      .select('id, course_id, title, opens_at, closes_at, published, is_practice')
      .eq('published', true),
    supabase
      .from('assignments')
      .select('id, course_id, title, due_at, published')
      .eq('published', true),
    supabase
      .from('attendance_sessions')
      .select('id, course_id, title, opens_at, closes_at')
      .lte('opens_at', nowIso)
      .gte('closes_at', nowIso)
      .order('closes_at'),
    supabase
      .from('attempts')
      .select('id, quiz_id, status, started_at, submitted_at, quizzes!inner(course_id)')
      .gte('started_at', sevenDaysAgo.toISOString())
      .limit(1000),
    supabase
      .from('submissions')
      .select('id, submitted_at')
      .gte('submitted_at', sevenDaysAgo.toISOString())
      .limit(1000),
    supabase
      .from('forum_posts')
      .select('id, course_id, body, created_at')
      .is('answer', null)
      .eq('hidden', false)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('course_messages')
      .select('id, course_id, subject, message, created_at')
      .is('reply', null)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('attendance_excuses')
      .select('id, course_id, session_id, index_no, reason, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('mark_reviews')
      .select('id, course_id, kind, quiz_id, assignment_id, index_no, reason, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const activeIds = new Set(courses.filter((c) => !c.archived).map((c) => c.id));

  // 1. Aggregate unmarked assignment submissions per assignment
  const assignMap = new Map();
  if (unmarkedSubsRes.status === 'fulfilled' && !unmarkedSubsRes.value.error) {
    for (const s of unmarkedSubsRes.value.data || []) {
      const a = s.assignments;
      if (!a || !activeIds.has(a.course_id)) continue;
      if (!assignMap.has(a.id)) {
        assignMap.set(a.id, {
          kind: 'assign',
          id: a.id,
          title: a.title,
          courseId: a.course_id,
          count: 0,
          latestAt: s.submitted_at,
          to: `/teach/assignment/${a.id}`,
        });
      }
      assignMap.get(a.id).count += 1;
    }
  }

  // 2. Aggregate unmarked written quiz responses per quiz
  const quizMarkMap = new Map();
  if (unmarkedEssaysRes.status === 'fulfilled' && !unmarkedEssaysRes.value.error) {
    for (const r of unmarkedEssaysRes.value.data || []) {
      const q = r.attempts?.quizzes;
      if (!q || !activeIds.has(q.course_id)) continue;
      if (!quizMarkMap.has(q.id)) {
        quizMarkMap.set(q.id, {
          kind: 'quiz',
          id: q.id,
          title: q.title,
          courseId: q.course_id,
          count: 0,
          to: `/teach/quiz/${q.id}/results?tab=marking`,
        });
      }
      quizMarkMap.get(q.id).count += 1;
    }
  }

  // 3. Quizzes: currently open + upcoming deadlines
  const liveQuizzes = [];
  const deadlines = [];
  if (quizzesRes.status === 'fulfilled' && !quizzesRes.value.error) {
    for (const q of quizzesRes.value.data || []) {
      if (!activeIds.has(q.course_id)) continue;
      const opens = q.opens_at ? new Date(q.opens_at).getTime() : 0;
      const closes = q.closes_at ? new Date(q.closes_at).getTime() : Infinity;
      const nowMs = now.getTime();
      if (!q.is_practice && opens <= nowMs && closes >= nowMs && q.closes_at) {
        liveQuizzes.push({
          id: q.id,
          courseId: q.course_id,
          title: q.title,
          closesAt: q.closes_at,
          to: `/teach/quiz/${q.id}/results?tab=live`,
        });
      }
      if (!q.is_practice && q.closes_at && q.closes_at >= nowIso && q.closes_at <= fourteenDaysAhead) {
        deadlines.push({
          kind: 'quiz',
          id: q.id,
          courseId: q.course_id,
          title: q.title,
          due: q.closes_at,
          to: `/teach/quiz/${q.id}/results`,
        });
      }
    }
  }

  // 4. Assignments: upcoming deadlines
  if (assignmentsRes.status === 'fulfilled' && !assignmentsRes.value.error) {
    for (const a of assignmentsRes.value.data || []) {
      if (!activeIds.has(a.course_id)) continue;
      if (a.due_at && a.due_at >= nowIso && a.due_at <= fourteenDaysAhead) {
        deadlines.push({
          kind: 'assign',
          id: a.id,
          courseId: a.course_id,
          title: a.title,
          due: a.due_at,
          to: `/teach/assignment/${a.id}`,
        });
      }
    }
  }
  deadlines.sort((a, b) => new Date(a.due) - new Date(b.due));

  // 5. Live attendance sessions
  const liveAttendance = [];
  if (attendanceRes.status === 'fulfilled' && !attendanceRes.value.error) {
    for (const s of attendanceRes.value.data || []) {
      if (!activeIds.has(s.course_id)) continue;
      liveAttendance.push({
        id: s.id,
        courseId: s.course_id,
        title: s.title || 'Class attendance',
        closesAt: s.closes_at,
        to: `/teach/course/${s.course_id}?tab=attendance`,
      });
    }
  }

  // 6. 7-Day student activity pulse + live active quiz takers
  const pulseDays = [];
  const pulseByKey = new Map();
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(sevenDaysAgo);
    d.setDate(sevenDaysAgo.getDate() + i);
    const key = dayKey(d);
    const entry = {
      key,
      short: d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 3),
      full: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
      attempts: 0,
      submissions: 0,
      total: 0,
      isToday: i === 6,
    };
    pulseDays.push(entry);
    pulseByKey.set(key, entry);
  }

  let liveQuizTakers = 0;
  const activeTakersByQuiz = new Map();
  if (recentAttemptsRes.status === 'fulfilled' && !recentAttemptsRes.value.error) {
    for (const at of recentAttemptsRes.value.data || []) {
      if (at.status === 'in_progress' && activeIds.has(at.quizzes?.course_id)) {
        liveQuizTakers += 1;
        activeTakersByQuiz.set(at.quiz_id, (activeTakersByQuiz.get(at.quiz_id) || 0) + 1);
      }
      const bucket = pulseByKey.get(dayKey(at.started_at));
      if (bucket) {
        bucket.attempts += 1;
        bucket.total += 1;
      }
    }
  }
  if (recentSubsRes.status === 'fulfilled' && !recentSubsRes.value.error) {
    for (const sub of recentSubsRes.value.data || []) {
      const bucket = pulseByKey.get(dayKey(sub.submitted_at));
      if (bucket) {
        bucket.submissions += 1;
        bucket.total += 1;
      }
    }
  }

  // Attach active takers count to live quizzes
  for (const lq of liveQuizzes) {
    lq.activeTakers = activeTakersByQuiz.get(lq.id) || 0;
  }

  // 7. Unanswered Q&A
  const unansweredQa = [];
  if (qaRes.status === 'fulfilled' && !qaRes.value.error) {
    for (const p of qaRes.value.data || []) {
      if (!activeIds.has(p.course_id)) continue;
      unansweredQa.push({
        id: p.id,
        courseId: p.course_id,
        body: p.body,
        createdAt: p.created_at,
        to: `/teach/course/${p.course_id}?tab=qa`,
      });
    }
  }

  return {
    courses,
    pendingAssignments: [...assignMap.values()].sort((a, b) => b.count - a.count),
    pendingQuizzes: [...quizMarkMap.values()].sort((a, b) => b.count - a.count),
    deadlines: deadlines.slice(0, 6),
    liveAttendance,
    liveQuizzes,
    liveQuizTakers,
    dailyPulse: pulseDays,
    unansweredQa: unansweredQa.slice(0, 4),
    staffRoles: rolesMap,
  };
}

export default function Dashboard() {
  const { profile, isTA } = useAuth();
  const { data: bundle, error, loading, reload } = useLoad(fetchDashboardBundle, []);
  const [creating, setCreating] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [search, setSearch] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('ALL');
  const [hoveredDay, setHoveredDay] = useState(null);
  const [digestOpen, setDigestOpen] = useState(false);
  const toast = useToast();

  const allRows = bundle?.courses || [];
  const courses = useMemo(() => allRows.filter((c) => !c.archived), [allRows]);
  const archived = useMemo(() => allRows.filter((c) => c.archived), [allRows]);
  const courseById = useMemo(() => new Map(allRows.map((c) => [c.id, c])), [allRows]);

  const semesters = useMemo(() => {
    const s = [...new Set(courses.map((c) => (c.semester || '').trim()).filter(Boolean))];
    return s;
  }, [courses]);

  const filteredCourses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return courses.filter((c) => {
      if (semesterFilter !== 'ALL' && (c.semester || '').trim() !== semesterFilter) return false;
      if (!q) return true;
      return `${c.code} ${c.title} ${c.semester || ''}`.toLowerCase().includes(q);
    });
  }, [courses, search, semesterFilter]);

  const totals = useMemo(() => {
    return courses.reduce(
      (t, c) => ({
        students: t.students + c.students,
        activated: t.activated + c.activated,
        toMark: t.toMark + c.to_mark,
        quizzes: t.quizzes + c.quizzes,
      }),
      { students: 0, activated: 0, toMark: 0, quizzes: 0 },
    );
  }, [courses]);

  const activatedPct = totals.students ? Math.round((totals.activated / totals.students) * 100) : 0;

  // Combine per-assignment + per-quiz marking items; fallback cleanly to course links if needed
  const directQueue = useMemo(() => {
    if (!bundle) return [];
    const items = [...bundle.pendingAssignments, ...bundle.pendingQuizzes].sort((a, b) => b.count - a.count);
    if (items.length > 0) return items;
    return courses
      .filter((c) => (c.to_mark || 0) > 0)
      .sort((a, b) => (b.to_mark || 0) - (a.to_mark || 0))
      .map((c) => ({
        kind: 'course',
        id: c.id,
        title: c.title,
        courseId: c.id,
        count: c.to_mark,
        to: `/teach/course/${c.id}?tab=assignments`,
      }));
  }, [bundle, courses]);

  const topAction = directQueue[0] || (courses[0] ? { to: `/teach/course/${courses[0].id}`, title: courses[0].code } : null);
  const topActionCourse = topAction ? courseById.get(topAction.courseId) : null;

  const activationWatch = useMemo(
    () =>
      courses
        .filter((c) => c.students > 0 && c.activated < c.students)
        .sort((a, b) => (a.activated / a.students) - (b.activated / b.students))
        .slice(0, 5),
    [courses],
  );

  const pulseDays = bundle?.dailyPulse || [];
  const weeklyTotal = pulseDays.reduce((s, d) => s + d.total, 0);
  const maxPulse = Math.max(1, ...pulseDays.map((d) => d.total));
  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const facultyName =
    (isTA ? (profile.full_name || '').split(' ')[0] : (profile.full_name || '').split(' ').slice(-1)[0]) || 'Lecturer';

  const hasLiveNow =
    (bundle?.liveAttendance?.length || 0) > 0 ||
    (bundle?.liveQuizzes?.length || 0) > 0 ||
    (bundle?.liveQuizTakers || 0) > 0;

  return (
    <>
      <Topbar
        title={`${greeting()}, ${facultyName}`}
        sub={isTA ? 'Teaching assistant workspace' : 'Faculty command center'}
      >
        <div className="row-wrap" style={{ gap: 8 }}>
          {courses.length >= 3 && (
            <label className="search">
              <span className="sr-only">Filter courses</span>
              <Icon name="search" size={15} />
              <input
                className="input"
                style={{ width: 190, minHeight: 38 }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find course…"
              />
            </label>
          )}
          {courses.length > 0 && (
            <button type="button" className="btn" onClick={() => setDigestOpen(true)}>
              <Icon name="clipboard" size={16} /> <span className="hide-xs">Weekly digest</span>
            </button>
          )}
          {!isTA && (
            <>
              {allRows.length > 0 && (
                <button type="button" className="btn" onClick={() => setCloning(true)}>
                  <Icon name="layers" size={16} /> Clone semester
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Icon name="plus" size={16} /> New course
              </button>
            </>
          )}
        </div>
      </Topbar>

      <div className="page stack-lg">
        {loading && <DashboardSkeleton />}
        <ErrorNote error={error} onRetry={reload} />

        {bundle && (
          <>
            {courses.length > 0 && (
              <section className="exec-hero" aria-label="Faculty command overview">
                <div className="exec-hero-main">
                  <div className="stack-sm" style={{ gap: 10 }}>
                    <div className="exec-kicker-row">
                      <span className="exec-kicker">
                        {hasLiveNow && <span className="pulse-dot" aria-hidden="true" />}
                        {bundle.liveQuizTakers > 0
                          ? `Live now · ${bundle.liveQuizTakers} taking quiz`
                          : bundle.liveAttendance.length > 0
                            ? `Live now · Attendance open`
                            : totals.toMark > 0
                              ? `Action queue · ${directQueue.length} item${directQueue.length === 1 ? '' : 's'}`
                              : 'Faculty command'}
                      </span>
                      <span className="exec-date-pill">{todayLabel}</span>
                    </div>

                    <div>
                      <h2 className="exec-hero-title">
                        {totals.toMark > 0
                          ? `${totals.toMark} ${totals.toMark === 1 ? 'script' : 'scripts'} awaiting your review`
                          : 'All quizzes and assignments are up to date'}
                      </h2>
                      <p className="exec-hero-sub">
                        {totals.toMark > 0 && topAction
                          ? `Priority: ${topActionCourse?.code ? `${topActionCourse.code} — ` : ''}${topAction.title} (${topAction.count} pending).`
                          : `Monitoring ${courses.length} active course${courses.length === 1 ? '' : 's'} with ${weeklyTotal.toLocaleString()} student actions this week.`}
                      </p>
                    </div>

                    {topAction && (
                      <div className="row-wrap" style={{ gap: 10 }}>
                        <Link to={topAction.to} className="btn btn-light btn-sm">
                          {totals.toMark > 0
                            ? `Mark ${topActionCourse?.code || 'next item'}`
                            : `Open ${topActionCourse?.code || 'course'}`}
                          <Icon name="arrowRight" size={14} />
                        </Link>
                      </div>
                    )}
                  </div>

                  {/* Single authoritative metrics strip — zero duplicate KPI grid below */}
                  <div className="exec-metrics">
                    <div className="exec-metric">
                      <span className="num">{courses.length}</span>
                      <span className="lbl">Active courses</span>
                    </div>
                    <div className="exec-metric">
                      <span className="num">{totals.students.toLocaleString()}</span>
                      <span className="lbl">Enrolled students</span>
                    </div>
                    <div className="exec-metric">
                      <span className="num">{totals.quizzes}</span>
                      <span className="lbl">Published quizzes</span>
                    </div>
                    <div className="exec-metric">
                      <span className="num">{activatedPct}%</span>
                      <span className="lbl">Portal activated</span>
                    </div>
                  </div>
                </div>

                {/* 7-Day Live Student Activity Sparkline */}
                <div className="exec-pulse-panel" aria-label="7-day student activity">
                  <div className="exec-pulse-head">
                    <div>
                      <div className="tiny strong" style={{ color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                        7-day class pulse
                      </div>
                      <div style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 600, color: '#fff', lineHeight: 1.2, marginTop: 2 }}>
                        {weeklyTotal.toLocaleString()}{' '}
                        <span className="tiny" style={{ fontFamily: 'var(--sans)', fontWeight: 400, color: '#cbd5e1' }}>
                          attempts &amp; hand-ins
                        </span>
                      </div>
                    </div>
                    <span className="tiny" style={{ color: hoveredDay ? '#fcd34d' : '#5eead4', fontFamily: 'var(--mono)', textAlign: 'right' }}>
                      {hoveredDay
                        ? `${hoveredDay.full}: ${hoveredDay.attempts} quiz · ${hoveredDay.submissions} sub`
                        : 'Last 7 days'}
                    </span>
                  </div>

                  <div className="exec-pulse-bars" onMouseLeave={() => setHoveredDay(null)}>
                    {pulseDays.map((d) => {
                      const quizH = d.attempts ? Math.max(6, Math.round((d.attempts / maxPulse) * 66)) : 0;
                      const subH = d.submissions ? Math.max(6, Math.round((d.submissions / maxPulse) * 66)) : 0;
                      return (
                        <div
                          key={d.key}
                          className={`exec-bar-col ${d.isToday ? 'today' : ''}`}
                          onMouseEnter={() => setHoveredDay(d)}
                          title={`${d.full}: ${d.attempts} quiz attempt(s), ${d.submissions} assignment submission(s)`}
                        >
                          <div className="exec-bar-track">
                            {subH > 0 && <div className="exec-bar-sub" style={{ height: subH }} />}
                            {quizH > 0 && <div className="exec-bar-quiz" style={{ height: quizH }} />}
                          </div>
                          <span className="exec-bar-day">{d.short}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="between tiny" style={{ color: 'rgba(203, 213, 225, 0.8)', paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <span className="row" style={{ gap: 10 }}>
                      <span className="row" style={{ gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: '#2dd4bf', display: 'inline-block' }} /> Quizzes
                      </span>
                      <span className="row" style={{ gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: '#fbbf24', display: 'inline-block' }} /> Assignments
                      </span>
                    </span>
                    <span className="mono">{totals.activated.toLocaleString()}/{totals.students.toLocaleString()} active</span>
                  </div>
                </div>
              </section>
            )}

            {/* Live Now Classroom Strip (only renders when attendance or a timed quiz is active right now) */}
            {(bundle.liveAttendance.length > 0 || bundle.liveQuizzes.length > 0) && (
              <section className="live-strip" aria-label="Active sessions right now">
                {bundle.liveAttendance.map((att) => {
                  const c = courseById.get(att.courseId);
                  return (
                    <div key={att.id} className="live-pill-card">
                      <div className="row" style={{ gap: 10, minWidth: 0 }}>
                        <span className="pulse-dot" aria-hidden="true" />
                        <div style={{ minWidth: 0 }}>
                          <div className="small strong">
                            Attendance open · {c?.code || 'Course'}
                          </div>
                          <div className="tiny muted">
                            {att.title} · closes {relative(att.closesAt)}
                          </div>
                        </div>
                      </div>
                      <Link to={att.to} className="btn btn-sm btn-primary">
                        Manage hall
                      </Link>
                    </div>
                  );
                })}
                {bundle.liveQuizzes.map((lq) => {
                  const c = courseById.get(lq.courseId);
                  return (
                    <div key={lq.id} className="live-pill-card">
                      <div className="row" style={{ gap: 10, minWidth: 0 }}>
                        <span className="pulse-dot" aria-hidden="true" />
                        <div style={{ minWidth: 0 }}>
                          <div className="small strong">
                            Quiz live · {c?.code || 'Course'} — {lq.title}
                          </div>
                          <div className="tiny muted">
                            {lq.activeTakers > 0 ? `${lq.activeTakers} student${lq.activeTakers === 1 ? '' : 's'} taking now · ` : ''}
                            closes {relative(lq.closesAt)}
                          </div>
                        </div>
                      </div>
                      <Link to={lq.to} className="btn btn-sm">
                        Live monitor
                      </Link>
                    </div>
                  );
                })}
              </section>
            )}

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
              <div className="two-col">
                <main className="stack">
                  <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
                    <div className="row" style={{ gap: 10 }}>
                      <h2 style={{ margin: 0 }}>Your courses</h2>
                      <span className="small muted">{filteredCourses.length} shown</span>
                    </div>
                    {semesters.length > 1 && (
                      <div className="chips" role="group" aria-label="Filter by semester">
                        <button type="button" className="chip" aria-pressed={semesterFilter === 'ALL'} onClick={() => setSemesterFilter('ALL')}>
                          All semesters
                        </button>
                        {semesters.map((sem) => (
                          <button key={sem} type="button" className="chip" aria-pressed={semesterFilter === sem} onClick={() => setSemesterFilter(sem)}>
                            {sem}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {filteredCourses.length === 0 ? (
                    <div className="card small muted">No courses match “{search}”.</div>
                  ) : (
                    <div className="grid-2">
                      {filteredCourses.map((c) => (
      <CourseCard
        key={c.id}
        c={c}
        isTA={isTA}
        courseRole={bundle?.staffRoles?.[c.id] || (isTA ? 'ta' : 'lecturer')}
      />
    ))}
                    </div>
                  )}
                </main>

                <aside className="stack">
                  {(bundle.attentionItems?.length || 0) > 0 && (
                    <section className="card-flush" style={{ borderColor: 'var(--amber)' }}>
                      <div className="card-head">
                        <div className="row" style={{ gap: 8 }}>
                          <Icon name="bell" size={16} style={{ color: 'var(--amber-ink)' }} />
                          <h2>Needs my attention</h2>
                        </div>
                        <span className="badge badge-amber">
                          {bundle.attentionCounts.excuses + bundle.attentionCounts.reviews + bundle.attentionCounts.messages}
                        </span>
                      </div>
                      {bundle.attentionItems.slice(0, 8).map((item) => {
                        const c = courseById.get(item.courseId);
                        const kindLabel =
                          item.kind === 'excuses' ? 'Excuse' : item.kind === 'reviews' ? 'Re-mark' : 'Inbox';
                        return (
                          <Link key={item.id} to={item.to} className="list-row">
                            <span className="nav-course-dot" style={{ background: c?.color || 'var(--teal)', width: 11, height: 11 }} />
                            <div className="list-main">
                              <span className="title">{item.label}</span>
                              <span className="tiny muted row" style={{ gap: 6, marginTop: 2 }}>
                                <span className="queue-kind">{kindLabel}</span>
                                <span>{c?.code}</span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                                  · {item.preview}
                                </span>
                              </span>
                            </div>
                            <Icon name="chevronRight" size={14} style={{ color: 'var(--muted)' }} />
                          </Link>
                        );
                      })}
                    </section>
                  )}

                  {/* 1. Direct Marking Queue (Routes straight to Assignment OR Quiz Written Marking!) */}
                  <section className="card-flush">
                    <div className="card-head">
                      <h2>Marking queue</h2>
                      <span className="small muted mono">{totals.toMark} pending</span>
                    </div>
                    {directQueue.length === 0 ? (
                      <div style={{ padding: '16px 18px' }} className="small muted">
                        All assignment submissions and written quiz answers are marked.
                      </div>
                    ) : (
                      directQueue.slice(0, 6).map((item) => {
                        const c = courseById.get(item.courseId);
                        return (
                          <Link key={`${item.kind}-${item.id}`} to={item.to} className="list-row">
                            <span className="nav-course-dot" style={{ background: c?.color || 'var(--teal)', width: 11, height: 11 }} />
                            <div className="list-main">
                              <span className="title">{item.title}</span>
                              <span className="tiny muted row" style={{ gap: 6, marginTop: 2 }}>
                                <span className={`queue-kind ${item.kind === 'quiz' ? 'quiz' : item.kind === 'assign' ? 'assign' : ''}`}>
                                  {item.kind === 'quiz' ? 'Quiz essay' : item.kind === 'assign' ? 'Assignment' : 'Course'}
                                </span>
                                {c?.code}
                              </span>
                            </div>
                            <span className="mono strong small" style={{ color: 'var(--amber-ink)' }}>
                              {item.count}
                            </span>
                          </Link>
                        );
                      })
                    )}
                  </section>

                  {/* 2. Upcoming Deadlines Across All Courses */}
                  <section className="card-flush">
                    <div className="card-head">
                      <h2>Closing in 14 days</h2>
                      <span className="small muted mono">{bundle.deadlines.length}</span>
                    </div>
                    {bundle.deadlines.length === 0 ? (
                      <div style={{ padding: '16px 18px' }} className="small muted">
                        No published quizzes or assignments closing in the next two weeks.
                      </div>
                    ) : (
                      bundle.deadlines.map((d) => {
                        const c = courseById.get(d.courseId);
                        return (
                          <Link key={`${d.kind}-${d.id}`} to={d.to} className="list-row">
                            <span className="nav-course-dot" style={{ background: c?.color || 'var(--teal)', width: 10, height: 10 }} />
                            <div className="list-main">
                              <span className="title">{d.title}</span>
                              <span className="tiny muted">
                                {c?.code} · {d.kind === 'quiz' ? 'Quiz closes' : 'Due'} {relative(d.due)} ({fmtDate(d.due)})
                              </span>
                            </div>
                            <Icon name="chevronRight" size={14} style={{ color: 'var(--muted)' }} />
                          </Link>
                        );
                      })
                    )}
                  </section>

                  {/* 3. Cohort Activation Watch — Only shows courses below 100% */}
                  <section className="card-flush">
                    <div className="card-head">
                      <h2>Activation watch</h2>
                      <span className="small muted mono">{activatedPct}% overall</span>
                    </div>
                    {activationWatch.length === 0 ? (
                      <div style={{ padding: '16px 18px', color: 'var(--green-ink)' }} className="small row">
                        <Icon name="check" size={15} /> All enrolled students have activated their accounts.
                      </div>
                    ) : (
                      activationWatch.map((c) => {
                        const pctVal = c.students ? Math.round((c.activated / c.students) * 100) : 0;
                        const missing = c.students - c.activated;
                        return (
                          <Link
                            key={c.id}
                            to={`/teach/course/${c.id}?tab=students`}
                            className="list-row"
                            style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
                          >
                            <div className="between">
                              <span className="small strong">{c.code}</span>
                              <span className="mono tiny muted">
                                {missing} pending ({pctVal}%)
                              </span>
                            </div>
                            <Bar value={pctVal} color={c.color} />
                          </Link>
                        );
                      })
                    )}
                  </section>

                  {/* 4. Unanswered Q&A Threads (appears only if students are waiting for a reply) */}
                  {bundle.unansweredQa.length > 0 && (
                    <section className="card-flush">
                      <div className="card-head">
                        <h2>Unanswered Q&amp;A</h2>
                        <span className="small muted mono">{bundle.unansweredQa.length}</span>
                      </div>
                      {bundle.unansweredQa.map((q) => {
                        const c = courseById.get(q.courseId);
                        return (
                          <Link key={q.id} to={q.to} className="list-row">
                            <span className="nav-course-dot" style={{ background: c?.color || 'var(--teal)', width: 10, height: 10 }} />
                            <div className="list-main">
                              <span className="title" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                {q.body}
                              </span>
                              <span className="tiny muted">{c?.code} · asked {relative(q.createdAt)}</span>
                            </div>
                          </Link>
                        );
                      })}
                    </section>
                  )}
                </aside>
              </div>
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
      {cloning && <CloneCourseModal courses={allRows} onClose={() => setCloning(false)} />}
      {digestOpen && bundle && (
        <WeeklyDigestModal
          courses={courses}
          totals={totals}
          activatedPct={activatedPct}
          weeklyTotal={weeklyTotal}
          directQueue={directQueue}
          bundle={bundle}
          courseById={courseById}
          activationWatch={activationWatch}
          onClose={() => setDigestOpen(false)}
          onCopied={() => toast('Weekly digest copied to clipboard.')}
        />
      )}
    </>
  );
}

function CourseCard({ c, isTA, courseRole = 'lecturer' }) {
  const unactivated = Math.max(0, (c.students || 0) - (c.activated || 0));
  const effectiveRole = courseRole || (isTA ? 'ta' : 'lecturer');
  const isExaminer = effectiveRole === 'external_examiner';
  const canManage = effectiveRole === 'lecturer' || effectiveRole === 'co_lecturer';
  const roleTag = effectiveRole === 'co_lecturer'
    ? 'Co-Lecturer'
    : effectiveRole === 'external_examiner'
      ? 'External Examiner'
      : effectiveRole === 'ta' && isTA
        ? 'TA'
        : '';
  return (
    <article className="course-card-ed">
      <Link to={`/teach/course/${c.id}`} className="course-card-band-link">
        <div className="course-card-band" style={{ backgroundColor: c.color }}>
          <div className="course-card-meta">
            <span className="mono">{c.code}{c.semester ? ` · ${c.semester}` : ''}</span>
            {c.to_mark > 0 && !isExaminer && (
              <span className="strong nowrap" style={{ color: '#fde68a' }}>
                {c.to_mark} to mark
              </span>
            )}
          </div>
          <div className="course-card-title">{c.title}</div>
        </div>
      </Link>
      <div className="course-card-body">
        <div className="course-card-stats">
          <Mini v={c.students} l="Students" />
          <Mini v={c.materials} l="Materials" />
          <Mini v={c.quizzes} l="Quizzes" />
        </div>
        <div className="course-card-foot">
          {unactivated === 0 ? (
            <span style={{ color: 'var(--green-ink)' }}>
              {c.students > 0 ? 'All students activated' : 'No students enrolled yet'}
            </span>
          ) : (
            <Link to={`/teach/course/${c.id}?tab=students`} style={{ color: 'var(--amber-ink)', fontWeight: 500 }}>
              {unactivated} student{unactivated === 1 ? '' : 's'} not yet activated
            </Link>
          )}
          <span className="mono tiny muted">{roleTag || 'Active'}</span>
        </div>
        <div className="course-card-links">
          {canManage && (
            <>
              <Link to={`/teach/course/${c.id}?tab=materials`}>Materials</Link>
              <span className="muted" aria-hidden="true">·</span>
            </>
          )}
          <Link to={`/teach/course/${c.id}?tab=quizzes`}>Quizzes</Link>
          <span className="muted" aria-hidden="true">·</span>
          <Link to={`/teach/course/${c.id}?tab=assignments`}>Assignments</Link>
          {!isExaminer && (
            <>
              <span className="muted" aria-hidden="true">·</span>
              <Link to={`/teach/course/${c.id}?tab=attendance`}>Attendance</Link>
            </>
          )}
          {(canManage || isExaminer) && (
            <>
              <span className="muted" aria-hidden="true">·</span>
              <Link to={`/teach/course/${c.id}?tab=ca`}>CA &amp; Grades</Link>
            </>
          )}
        </div>
      </div>
    </article>
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
  const existingMeta = useMemo(() => parseCourseMeta(course), [course]);
  const [f, setF] = useState({
    code: course?.code || '',
    title: course?.title || '',
    semester: course?.semester || '',
    about: existingMeta.about || '',
    venue: existingMeta.course_info?.venue || '',
    schedule: existingMeta.course_info?.schedule || '',
    officeHours: existingMeta.course_info?.officeHours || '',
    syllabusNote: existingMeta.course_info?.syllabusNote || '',
    color: course?.color || COURSE_COLORS[0],
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const tooLight = contrastWithWhite(f.color) < 4.5;

  async function save() {
    if (!f.code.trim() || !f.title.trim() || tooLight) return;
    const serializedDescription = serializeCourseMeta(
      f.about,
      existingMeta.ca_config,
      existingMeta.exam_config,
      {
        venue: f.venue,
        schedule: f.schedule,
        officeHours: f.officeHours,
        syllabusNote: f.syllabusNote,
      }
    );
    const row = {
      code: f.code.trim().toUpperCase(),
      title: f.title.trim(),
      semester: f.semester,
      description: serializedDescription,
      color: f.color,
    };
    const result = await act(async () => {
      if (course) {
        await run(supabase.from('courses').update(row).eq('id', course.id));
        return course.id;
      }
      const created = await run(supabase.from('courses').insert(row).select('id').single());
      return created.id;
    }, course ? 'Course saved.' : 'Course created.');
    if (result) {
      onClose();
      if (onSaved) onSaved();
      else navigate(`/teach/course/${result}`);
    }
  }

  return (
    <Modal title={course ? 'Course settings & timetable' : 'New course'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !f.code.trim() || !f.title.trim() || tooLight}>Save</button></>}>
      <div className="grid-2">
        <Field label="Course code"><input className="input mono" value={f.code} onChange={set('code')} placeholder="SCM 101" /></Field>
        <Field label="Semester" hint="optional"><input className="input" value={f.semester} onChange={set('semester')} placeholder="Semester 1, 2026/27" /></Field>
      </div>
      <Field label="Course title"><input className="input" value={f.title} onChange={set('title')} placeholder="Introduction to Supply Chain Management" /></Field>
      <Field label="Short description" hint="optional"><textarea className="textarea" style={{ minHeight: 72 }} value={f.about} onChange={set('about')} /></Field>
      <div className="grid-2">
        <Field label="Lecture venue" hint="optional"><input className="input" value={f.venue} onChange={set('venue')} placeholder="Auditorium B / Block 4" /></Field>
        <Field label="Office hours" hint="optional"><input className="input" value={f.officeHours} onChange={set('officeHours')} placeholder="Wed 2:00–4:00 PM" /></Field>
      </div>
      <Field label="Lecture timetable" hint="optional — shown on student course page">
        <textarea className="textarea" style={{ minHeight: 64 }} value={f.schedule} onChange={set('schedule')} placeholder="Morning: Tue 8–10 AM · Evening: Thu 6–8 PM" />
      </Field>
      <Field label="Key syllabus note" hint="optional">
        <input className="input" value={f.syllabusNote} onChange={set('syllabusNote')} placeholder="75% attendance required for final examination eligibility" />
      </Field>
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


function WeeklyDigestModal({
  courses,
  totals,
  activatedPct,
  weeklyTotal,
  directQueue,
  bundle,
  courseById,
  activationWatch,
  onClose,
  onCopied,
}) {
  const unactivatedTotal = Math.max(0, (totals.students || 0) - (totals.activated || 0));
  const summaryLines = [
    `PSCM E-Class Weekly Digest (${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})`,
    `• Active courses: ${courses.length}`,
    `• Students activated: ${totals.activated}/${totals.students} (${activatedPct}%)${unactivatedTotal ? ` — ${unactivatedTotal} awaiting setup` : ''}`,
    `• Activity last 7 days: ${weeklyTotal} submissions & quiz attempts`,
    `• Marking queue: ${totals.toMark} unmarked items across ${directQueue.length} assessment(s)`,
    `• Unreplied student messages: ${bundle.attentionCounts?.messages || 0} | Unanswered Q&A: ${bundle.attentionCounts?.qa || 0}`,
    `• Pending attendance excuses: ${bundle.attentionCounts?.excuses || 0} | Mark reviews: ${bundle.attentionCounts?.reviews || 0}`,
  ];
  if (bundle.deadlines?.length) {
    summaryLines.push('• Upcoming deadlines (14d):');
    for (const d of bundle.deadlines.slice(0, 6)) {
      const c = courseById.get(d.courseId);
      summaryLines.push(`  - [${c?.code || 'COURSE'}] ${d.title} (${fmtDate(d.due)})`);
    }
  }
  if (activationWatch.length) {
    summaryLines.push('• Courses needing activation nudges:');
    for (const c of activationWatch) {
      summaryLines.push(`  - ${c.code}: ${c.students - c.activated} unactivated of ${c.students}`);
    }
  }
  const digestText = summaryLines.join('\n');

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(digestText);
      onCopied?.();
    } catch {
      // ignore clipboard errors on restricted origins
    }
  }

  return (
    <Modal
      title="Weekly faculty digest"
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={copySummary}>
            <Icon name="copy" size={16} /> Copy summary
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        </>
      }
    >
      <div className="stack">
        <div className="grid-4" style={{ gap: 10 }}>
          <div className="kpi"><div className="v">{courses.length}</div><div className="l">Active courses</div></div>
          <div className="kpi"><div className="v">{activatedPct}%</div><div className="l">Activated ({totals.activated}/{totals.students})</div></div>
          <div className="kpi"><div className="v">{totals.toMark}</div><div className="l">To mark</div></div>
          <div className="kpi"><div className="v">{weeklyTotal}</div><div className="l">7d submissions</div></div>
        </div>
        <div className="grid-2" style={{ gap: 12 }}>
          <div className="card-soft stack-sm" style={{ padding: 14 }}>
            <span className="eyebrow">Student follow-up queue</span>
            <div className="small">Unreplied messages: <strong>{bundle.attentionCounts?.messages || 0}</strong></div>
            <div className="small">Unanswered Q&amp;A: <strong>{bundle.attentionCounts?.qa || 0}</strong></div>
            <div className="small">Pending attendance excuses: <strong>{bundle.attentionCounts?.excuses || 0}</strong></div>
            <div className="small">Pending mark reviews: <strong>{bundle.attentionCounts?.reviews || 0}</strong></div>
          </div>
          <div className="card-soft stack-sm" style={{ padding: 14 }}>
            <span className="eyebrow">Next 14 days deadlines</span>
            {!bundle.deadlines?.length ? (
              <span className="small muted">No upcoming quiz or assignment closes in the next 14 days.</span>
            ) : (
              bundle.deadlines.slice(0, 5).map((d) => {
                const c = courseById.get(d.courseId);
                return (
                  <Link key={`${d.kind}-${d.id}`} to={d.to} onClick={onClose} className="small row between" style={{ color: 'var(--text)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong className="mono">{c?.code}</strong> · {d.title}
                    </span>
                    <span className="tiny muted nowrap">{relative(d.due)}</span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
        {activationWatch.length > 0 && (
          <div className="stack-sm">
            <span className="eyebrow">Activation watch</span>
            <div className="card-flush">
              {activationWatch.map((c) => (
                <Link key={c.id} to={`/teach/course/${c.id}?tab=students`} onClick={onClose} className="list-row">
                  <span className="list-main">
                    <span className="title small">{c.code} · {c.title}</span>
                    <span className="tiny muted">{c.activated} of {c.students} activated</span>
                  </span>
                  <span className="badge badge-amber">{c.students - c.activated} pending</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
