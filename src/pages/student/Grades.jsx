import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { Topbar } from '../../components/Layout.jsx';
import Icon from '../../components/Icon.jsx';
import { DashboardSkeleton, Empty, ErrorNote, useLoad } from '../../components/ui.jsx';
import { fmtNumber, pct } from '../../lib/format.js';
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

  const summary = (data || []).reduce(
    (acc, c) => {
      const meta = parseCourseMeta(c);
      const isExamReleased = Boolean(meta.exam_config?.released);
      const examScore =
        isExamReleased && profile?.index_no && meta.exam_config?.scores?.[profile.index_no] !== undefined
          ? Number(meta.exam_config.scores[profile.index_no])
          : null;
      const ca40 = c.ca ? Number(c.ca.total || 0) : null;
      if (ca40 !== null && examScore !== null) {
        acc.finalScores.push(ca40 + examScore);
      }
      for (const q of c.quizzes) {
        if (q.released && q.best && q.best.score !== null && q.best.max_score > 0) {
          acc.releasedPct.push((Number(q.best.score) / Number(q.best.max_score)) * 100);
        }
      }
      for (const a of c.assignments) {
        if (a.released && a.submission && a.submission.marks !== null && a.max_marks > 0) {
          acc.releasedPct.push((Number(a.submission.marks) / Number(a.max_marks)) * 100);
        }
      }
      return acc;
    },
    { finalScores: [], releasedPct: [] },
  );

  const avgWork = summary.releasedPct.length
    ? Math.round(summary.releasedPct.reduce((a, b) => a + b, 0) / summary.releasedPct.length)
    : null;
  const avgFinal = summary.finalScores.length
    ? Math.round(summary.finalScores.reduce((a, b) => a + b, 0) / summary.finalScores.length)
    : null;

  return (
    <>
      <Topbar title="My grades" sub="Scores appear once your lecturer releases them" />
      <div className="page stack-lg">
        {loading && <DashboardSkeleton />}
        <ErrorNote error={error} onRetry={reload} />
        {data && data.length === 0 && <div className="card"><Empty icon="chart" title="No courses yet" /></div>}

        {data && data.length > 0 && (
          <section className="grid-3" aria-label="Transcript summary" style={{ maxWidth: 900 }}>
            <div className="kpi">
              <div className="kpi-head">
                <span className="l">Courses enrolled</span>
                <span className="kpi-icon" style={{ background: 'var(--teal-50)', color: 'var(--teal-dark)' }}>
                  <Icon name="book" size={15} />
                </span>
              </div>
              <span className="v">{data.length}</span>
              <span className="kpi-sub">{summary.finalScores.length} final result{summary.finalScores.length === 1 ? '' : 's'} released</span>
            </div>

            <div className="kpi">
              <div className="kpi-head">
                <span className="l">Coursework average</span>
                <span className="kpi-icon" style={{ background: 'var(--blue-50)', color: 'var(--blue-ink)' }}>
                  <Icon name="chart" size={15} />
                </span>
              </div>
              <span className="v">{avgWork !== null ? `${avgWork}%` : '—'}</span>
              <span className="kpi-sub">{summary.releasedPct.length} graded item{summary.releasedPct.length === 1 ? '' : 's'}</span>
            </div>

            <div className="kpi">
              <div className="kpi-head">
                <span className="l">Overall standing</span>
                <span className="kpi-icon" style={{ background: 'var(--amber-50)', color: 'var(--amber-ink)' }}>
                  <Icon name="award" size={15} />
                </span>
              </div>
              <span className="v">{avgFinal !== null ? getLetter(avgFinal) : avgWork !== null ? getLetter(avgWork) : '—'}</span>
              <span className="kpi-sub">
                {avgFinal !== null ? `${avgFinal}% final average` : avgWork !== null ? getRemarks(avgWork) : 'Awaiting released marks'}
              </span>
            </div>
          </section>
        )}

        {data?.map((c) => {
          const meta = parseCourseMeta(c);
          const isExamReleased = Boolean(meta.exam_config?.released);
          const examScore =
            isExamReleased && profile?.index_no && meta.exam_config?.scores?.[profile.index_no] !== undefined
              ? Number(meta.exam_config.scores[profile.index_no])
              : null;
          const ca40 = c.ca ? Number(c.ca.total || 0) : null;
          const finalScore = ca40 !== null && examScore !== null ? Number((ca40 + examScore).toFixed(1)) : null;
          const finalGrade = finalScore !== null ? getLetter(finalScore) : null;

          return (
            <section key={c.id} className="stack-sm" style={{ maxWidth: 900 }}>
              <div className="card stack-sm" style={{ padding: '16px 20px' }}>
                <div className="between" style={{ flexWrap: 'wrap', gap: 12 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="nav-course-dot" style={{ background: c.color, width: 12, height: 12 }} />
                    <div>
                      <h2 style={{ fontSize: 17 }}>
                        <Link to={`/course/${c.id}?tab=grades`} style={{ color: 'inherit' }}>{c.title}</Link>
                      </h2>
                      <div className="mono tiny muted">{c.code}</div>
                    </div>
                  </div>

                  {finalGrade ? (
                    <div className="row" style={{ gap: 10 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div className="mono strong" style={{ fontSize: 16 }}>{finalScore} / 100</div>
                        <div className="tiny muted">{getRemarks(finalScore)}</div>
                      </div>
                      <span className={`grade-tile ${finalScore < 50 ? 'fail' : ''}`}>{finalGrade}</span>
                    </div>
                  ) : ca40 !== null ? (
                    <div style={{ textAlign: 'right' }}>
                      <div className="mono strong" style={{ fontSize: 15 }}>CA {fmtNumber(ca40)} / 40</div>
                      <div className="tiny muted">Exam pending</div>
                    </div>
                  ) : null}
                </div>

                {(ca40 !== null || examScore !== null) && (
                  <div className="stack-sm" style={{ gap: 6, marginTop: 4 }}>
                    <div className="stacked-bar" aria-label="CA and Exam contribution">
                      {ca40 !== null && (
                        <div
                          style={{ width: `${Math.min(40, Math.max(0, ca40))}%`, background: c.color || 'var(--teal)' }}
                          title={`CA: ${ca40} / 40`}
                        />
                      )}
                      {examScore !== null && (
                        <div
                          style={{ width: `${Math.min(60, Math.max(0, examScore))}%`, background: '#3b82f6' }}
                          title={`Exam: ${examScore} / 60`}
                        />
                      )}
                    </div>
                    <div className="row-wrap tiny muted" style={{ gap: 14 }}>
                      {ca40 !== null && <span>CA: <strong className="mono" style={{ color: 'var(--text)' }}>{fmtNumber(ca40)}</strong> / 40</span>}
                      {examScore !== null && <span>Exam: <strong className="mono" style={{ color: 'var(--text)' }}>{fmtNumber(examScore)}</strong> / 60</span>}
                    </div>
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
  const [targetLetter, setTargetLetter] = useState('A');
  const gradedItems = [
    ...quizzes.filter((q) => q.released && q.best && q.best.score != null).map((q) => ({ score: Number(q.best.score) || 0, max: Number(q.best.max_score || q.total_marks) || 100 })),
    ...assignments.filter((a) => a.released && a.submission && a.submission.marks != null).map((a) => ({ score: Number(a.submission.marks) || 0, max: Number(a.max_marks) || 100 })),
  ];
  const earned = gradedItems.reduce((acc, x) => acc + x.score, 0);
  const maxSoFar = gradedItems.reduce((acc, x) => acc + x.max, 0);
  const currentPct = maxSoFar > 0 ? Math.round((earned / maxSoFar) * 100) : null;
  const currentLetter = currentPct !== null ? getLetter(currentPct) : null;
  const targetThresholds = GRADE_THRESHOLDS;
  const targetPct = targetThresholds[targetLetter] || 80;
  return (
    <div className="card stack-sm" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Icon name="chart" size={16} />
          <strong>Target Grade Simulator</strong>
          {currentPct !== null ? (
            <span className="small muted">
              Current average: <span className="mono strong">{currentPct}%</span> · Grade <strong>{currentLetter}</strong>
            </span>
          ) : (
            <span className="tiny muted">Awaiting first released score</span>
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

export function GradesTable({ quizzes = [], assignments = [] }) {
  const rows = [
    ...quizzes.map((q) => ({
      id: q.id,
      title: q.title,
      type: 'Quiz',
      status: q.best ? (q.released && q.best.score !== null ? 'Released' : 'Submitted') : 'Not attempted',
      score: q.released && q.best ? q.best.score : null,
      max: q.best?.max_score ?? q.total_marks,
    })),
    ...assignments.map((a) => ({
      id: a.id,
      title: a.title,
      type: 'Assignment',
      status: a.submission ? (a.submission.marked && a.released ? 'Released' : 'Submitted') : 'Not submitted',
      score: a.released && a.submission ? a.submission.marks : null,
      max: a.max_marks,
    })),
  ];
  if (!rows.length) return <div className="card"><Empty icon="chart" title="No graded work yet" /></div>;
  return (
    <div className="card-flush table-wrap" style={{ maxWidth: 900 }}>
      <table className="table">
        <thead>
          <tr>
            <th>Item</th><th>Type</th><th>Status</th><th className="num">Score</th><th className="num">%</th><th className="num">Grade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = r.score !== null && r.score !== undefined && r.max > 0 ? Math.round((Number(r.score) / Number(r.max)) * 100) : null;
            const letter = p !== null ? getLetter(p) : '—';
            return (
              <tr key={r.type + r.id}>
                <td className="strong">{r.title}</td>
                <td className="muted">{r.type}</td>
                <td>
                  <span className={`badge ${r.status === 'Released' ? 'badge-teal' : r.status.startsWith('Not') ? '' : 'badge-amber'}`}>{r.status}</span>
                </td>
                <td className="num">{r.score !== null && r.score !== undefined ? `${fmtNumber(r.score)} / ${fmtNumber(r.max)}` : '—'}</td>
                <td className="num">{p !== null ? `${p}%` : '—'}</td>
                <td className="num">
                  {p !== null ? (
                    <strong style={{ color: p >= 80 ? 'var(--teal-dark)' : p >= 70 ? 'var(--blue-ink)' : p >= 60 ? 'var(--amber-ink)' : p >= 50 ? 'var(--amber-ink)' : 'var(--red-ink)' }}>
                      {letter}
                    </strong>
                  ) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
