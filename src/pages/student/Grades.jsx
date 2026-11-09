import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { Topbar } from '../../components/Layout.jsx';
import Icon from '../../components/Icon.jsx';
import { Empty, ErrorNote, Loading, useLoad } from '../../components/ui.jsx';
import { GradesTable } from './Course.jsx';

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

export default function Grades() {
  const { data, error, loading, reload } = useLoad(async () => {
    const courses = await run(supabase.from('courses').select('id, code, title, color').order('code'));
    return Promise.all(
      courses.map(async (c) => ({
        ...c,
        quizzes: ((await rpc('my_quizzes', { p_course: c.id })) || []).filter((q) => !q.is_practice),
        assignments: (await rpc('my_assignments', { p_course: c.id })) || [],
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
        {data?.map((c) => (
          <section key={c.id} className="stack-sm">
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="row">
                <span className="nav-course-dot" style={{ background: c.color, width: 12, height: 12 }} />
                <h2>
                  <Link to={`/course/${c.id}?tab=grades`} style={{ color: 'inherit' }}>{c.title}</Link>
                </h2>
                <span className="mono small muted">{c.code}</span>
              </div>
            </div>
            <GradesTable quizzes={c.quizzes} assignments={c.assignments} />
            <TargetGradeCalculator course={c} quizzes={c.quizzes} assignments={c.assignments} />
          </section>
        ))}
      </div>
    </>
  );
}

export function TargetGradeCalculator({ course, quizzes = [], assignments = [] }) {
  const [targetLetter, setTargetLetter] = useState('A'); // Default target: A (80%+)

  // Calculate current earned vs total possible graded so far (only includes released items)
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
    <div className="card stack-sm" style={{ padding: '16px 20px', background: 'var(--surface)' }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="chart" size={18} />
          <strong className="small">Target Grade Simulator</strong>
          {currentPct !== null ? (
            <span className="tiny muted">
              (Current average: <strong>{currentPct}%</strong> · Grade <strong>{currentLetter}</strong>)
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
              style={{
                padding: '2px 10px',
                fontSize: 12,
                fontWeight: targetLetter === g ? 700 : 500,
                background: targetLetter === g ? 'var(--teal-50, #f0fdfa)' : undefined,
                borderColor: targetLetter === g ? 'var(--teal, #0d9488)' : undefined,
                color: targetLetter === g ? 'var(--teal-dark, #0d9488)' : undefined,
              }}
            >
              Grade {g} ({targetThresholds[g]}%+)
            </button>
          ))}
        </div>
      </div>
      <div className="row-wrap" style={{ gap: 16, alignItems: 'center', marginTop: 4 }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <p className="small muted" style={{ margin: 0, lineHeight: 1.6 }}>
            {currentPct === null ? (
              `To earn an ${targetLetter} (${targetPct}%+) in ${course.code}, aim for at least ${targetPct}% on your upcoming quizzes and assignments.`
            ) : currentPct >= targetPct ? (
              <span style={{ color: 'var(--teal-dark)' }}>
                🎉 You are currently on track for an <strong>{targetLetter}</strong>! Maintain at least <strong>{targetPct}%</strong> on remaining assessments to secure your {targetLetter}.
              </span>
            ) : (
              <span>
                To raise your grade from <strong>{currentPct}% ({currentLetter})</strong> to an <strong>{targetLetter} ({targetPct}%+)</strong>, you need to score an average of at least <strong>{Math.min(100, Math.round(targetPct * 1.15))}%</strong> on your remaining quizzes and assignments.
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
