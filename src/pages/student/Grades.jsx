import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { Topbar } from '../../components/Layout.jsx';
import Icon from '../../components/Icon.jsx';
import { Empty, ErrorNote, Loading, useLoad } from '../../components/ui.jsx';
import { GradesTable } from './Course.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { parseCourseMeta } from '../../lib/courseMeta.js';

export const GRADE_THRESHOLDS = {
  'A': 80,
  'B+': 75,
  'B': 70,
  'C+': 65,
  'C': 60,
  'D+': 55,
  'D': 50,
};

export function getLetter(pct) {
  if (pct === null || pct === undefined) return '—';
  if (pct >= 80) return 'A';
  if (pct >= 75) return 'B+';
  if (pct >= 70) return 'B';
  if (pct >= 65) return 'C+';
  if (pct >= 60) return 'C';
  if (pct >= 55) return 'D+';
  if (pct >= 50) return 'D';
  return 'E';
}

export function getRemarks(pct) {
  if (pct === null || pct === undefined) return '—';
  if (pct >= 80) return 'Excellent';
  if (pct >= 75) return 'Very Good';
  if (pct >= 70) return 'Good';
  if (pct >= 65) return 'Credit';
  if (pct >= 60) return 'Credit';
  if (pct >= 55) return 'Pass';
  if (pct >= 50) return 'Pass';
  return 'Fail';
}

export default function Grades() {
  const { profile } = useAuth();
  const { data, error, loading, reload } = useLoad(async () => {
    const courses = await run(supabase.from('courses').select('id, code, title, color, description, ca_total, ca_released').order('code'));
    return Promise.all(
      courses.map(async (c) => ({
        ...c,
        quizzes: ((await rpc('my_quizzes', { p_course: c.id })) || []).filter((q) => !q.is_practice),
        assignments: (await rpc('my_assignments', { p_course: c.id })) || [],
        ca: await rpc('my_ca', { p_course: c.id }),
      })),
    );
  }, []);

  return (
    <>
      <Topbar title="My grades" sub="Scores appear once your lecturer releases them" />
      <div className="page stack-lg">
        {loading && <Loading />}
        <ErrorNote error={error} onRetry={reload} />
        {data && data.length === 0 && <div className="card"><Empty icon="chart" title="No courses yet" /></div>}
        {data?.map((c) => {
          const meta = parseCourseMeta(c);
          const isExamReleased = Boolean(meta.exam_config?.released);
          const examScore = (isExamReleased && profile?.index_no && meta.exam_config?.scores?.[profile.index_no] !== undefined)
            ? Number(meta.exam_config.scores[profile.index_no])
            : null;

          const ca40 = c.ca ? Number(c.ca.total || 0) : null;
          const finalScore = (ca40 !== null && examScore !== null) ? Number((ca40 + examScore).toFixed(1)) : null;
          const finalGrade = finalScore !== null ? getLetter(finalScore) : null;

          return (
            <section key={c.id} className="stack-sm">
              <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="row">
                  <span className="nav-course-dot" style={{ background: c.color, width: 12, height: 12 }} />
                  <h2>
                    <Link to={`/course/${c.id}?tab=grades`} style={{ color: 'inherit' }}>{c.title}</Link>
                  </h2>
                  <span className="mono small muted">{c.code}</span>
                </div>
                {finalGrade && (
                  <div className="row" style={{ gap: 8 }}>
                    <span className="small muted">Final Result:</span>
                    <span className="badge badge-teal" style={{ fontWeight: 700 }}>
                      Grade {finalGrade} ({finalScore} / 100)
                    </span>
                  </div>
                )}
              </div>
              <GradesTable quizzes={c.quizzes} assignments={c.assignments} />
              <TargetGradeCalculator course={c} quizzes={c.quizzes} assignments={c.assignments} />
            </section>
          );
        })}
      </div>
    </>
  );
}

export function TargetGradeCalculator({ course, quizzes = [], assignments = [] }) {
  const [targetLetter, setTargetLetter] = useState('A'); // Default target: A (80%+)

  const gradedItems = [
    ...quizzes.filter((q) => q.score != null).map((q) => ({ score: Number(q.score) || 0, max: Number(q.marks) || 100 })),
    ...assignments.filter((a) => a.score != null).map((a) => ({ score: Number(a.score) || 0, max: Number(a.points) || 100 })),
  ];
  const earned = gradedItems.reduce((acc, x) => acc + x.score, 0);
  const maxSoFar = gradedItems.reduce((acc, x) => acc + x.max, 0);
  const currentPct = maxSoFar > 0 ? Math.round((earned / maxSoFar) * 100) : null;
  const currentLetter = currentPct !== null ? getLetter(currentPct) : null;

  const targetThresholds = GRADE_THRESHOLDS;
  const targetPct = targetThresholds[targetLetter] || 80;

  return (
    <div className="card stack-sm" style={{ background: 'var(--surface-2)', border: '1px solid var(--line-2)' }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="chart" size={16} />
          <strong>Target Grade Simulator</strong>
          {currentPct !== null ? (
            <span className="small muted">
              (Current coursework average: <span className="mono strong">{currentPct}%</span> · Grade <span className="badge badge-teal">{currentLetter}</span>)
            </span>
          ) : (
            <span className="tiny muted">(Awaiting first released score)</span>
          )}
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="tiny muted">Target:</span>
          {['A', 'B+', 'B', 'C+', 'C', 'D'].map((g) => (
            <button
              key={g}
              type="button"
              className="chip"
              aria-pressed={targetLetter === g}
              onClick={() => setTargetLetter(g)}
              style={{ minHeight: 28, padding: '0 8px', fontSize: 12 }}
            >
              {g} ({targetThresholds[g]}%)
            </button>
          ))}
        </div>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        Aiming for Grade {targetLetter} requires a cumulative minimum of {targetPct}% across your 40% Continuous Assessment and 60% Final Examination.
      </p>
    </div>
  );
}
