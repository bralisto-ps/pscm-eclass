import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { Topbar } from '../../components/Layout.jsx';
import Icon from '../../components/Icon.jsx';
import { Empty, ErrorNote, Loading, useLoad } from '../../components/ui.jsx';
import { GradesTable } from './Course.jsx';

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

function TargetGradeCalculator({ course, quizzes, assignments }) {
  const [targetLetter, setTargetLetter] = useState('A'); // A: 70%, B: 60%, C: 50%

  // Calculate current earned vs total possible graded so far
  const gradedItems = [
    ...quizzes.filter((q) => q.score != null).map((q) => ({ score: Number(q.score) || 0, max: Number(q.marks) || 100 })),
    ...assignments.filter((a) => a.score != null).map((a) => ({ score: Number(a.score) || 0, max: Number(a.points) || 100 })),
  ];

  const earned = gradedItems.reduce((acc, x) => acc + x.score, 0);
  const maxSoFar = gradedItems.reduce((acc, x) => acc + x.max, 0);
  const currentPct = maxSoFar > 0 ? Math.round((earned / maxSoFar) * 100) : null;

  const targetThresholds = { A: 70, B: 60, C: 50, Pass: 45 };
  const targetPct = targetThresholds[targetLetter] || 70;

  return (
    <div className="card stack-sm" style={{ padding: '16px 20px', background: 'var(--surface)' }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="chart" size={18} />
          <strong className="small">Target Grade Simulator</strong>
          {currentPct !== null && (
            <span className="tiny muted">(Current average: {currentPct}%)</span>
          )}
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <span className="tiny muted">Target:</span>
          {['A', 'B', 'C'].map((g) => (
            <button
              key={g}
              type="button"
              className="chip"
              aria-pressed={targetLetter === g}
              onClick={() => setTargetLetter(g)}
              style={{ padding: '2px 10px', fontSize: 13 }}
            >
              Grade {g} ({targetThresholds[g]}%+)
            </button>
          ))}
        </div>
      </div>

      <div className="row-wrap" style={{ gap: 16, alignItems: 'center', marginTop: 4 }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <p className="small muted" style={{ margin: 0 }}>
            {currentPct === null ? (
              `To earn an ${targetLetter} in ${course.code}, aim for at least ${targetPct}% on your upcoming quizzes and assignments.`
            ) : currentPct >= targetPct ? (
              <span style={{ color: 'var(--teal-dark)' }}>
                🎉 You are currently on track for an <strong>{targetLetter}</strong>! Maintain at least <strong>{targetPct}%</strong> on remaining assessments.
              </span>
            ) : (
              <span>
                To raise your grade from <strong>{currentPct}%</strong> to an <strong>{targetLetter} ({targetPct}%+)</strong>, you need to score an average of at least <strong>{Math.min(100, Math.round(targetPct * 1.15))}%</strong> on your next quizzes and assignments.
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
