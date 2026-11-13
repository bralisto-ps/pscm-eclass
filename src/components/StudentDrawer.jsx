import { useEffect } from 'react';
import { rpc, rpcAll, run, supabase } from '../lib/supabase.js';
import { fmtDateTime, fmtNumber, pct, relative } from '../lib/format.js';
import { computeStudentCA, parseCourseMeta } from '../lib/courseMeta.js';
import Icon from './Icon.jsx';
import { ErrorNote, Loading, useLoad } from './ui.jsx';

export default function StudentDrawer({ course, student, ta, onClose, onOutreach, onResetPassword }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const { data, error, loading, reload } = useLoad(async () => {
    const [profRes, attStudents, attSessions, quizzes, assignments] = await Promise.all([
      supabase.from('profiles').select('id').eq('index_no', student.index_no).maybeSingle(),
      rpcAll('course_attendance', { p_course: course.id }).catch(() => []),
      rpc('course_attendance_sessions', { p_course: course.id }).catch(() => []),
      run(supabase.from('quizzes').select('id, title, is_practice, published, duration_minutes').eq('course_id', course.id).order('created_at')),
      run(supabase.from('assignments').select('id, title, max_marks, due_at, published').eq('course_id', course.id).order('created_at')),
    ]);

    const studentId = profRes?.data?.id || null;
    const quizIds = quizzes.map((q) => q.id);
    const assignIds = assignments.map((a) => a.id);

    const [attemptsRes, subsRes, msgsRes, caPack] = await Promise.all([
      studentId && quizIds.length
        ? supabase
            .from('attempts')
            .select('id, quiz_id, attempt_no, status, score, max_score, started_at, submitted_at, exits, devices')
            .eq('student_id', studentId)
            .in('quiz_id', quizIds)
            .order('started_at', { ascending: false })
        : Promise.resolve({ data: [] }),
      studentId && assignIds.length
        ? supabase
            .from('submissions')
            .select('id, assignment_id, submitted_at, is_late, marks, feedback')
            .eq('student_id', studentId)
            .in('assignment_id', assignIds)
        : Promise.resolve({ data: [] }),
      studentId && !ta
        ? supabase
            .from('course_messages')
            .select('id, subject, message, reply, replied_at, created_at')
            .eq('course_id', course.id)
            .eq('student_id', studentId)
            .not('subject', 'ilike', '__PROCTOR_PHOTO__:%')
            .order('created_at', { ascending: false })
            .limit(8)
        : Promise.resolve({ data: [] }),
      !ta
        ? Promise.all([
            supabase.from('ca_components').select('*').eq('course_id', course.id).order('position'),
            rpcAll('course_ca', { p_course: course.id }),
          ]).catch(() => null)
        : Promise.resolve(null),
    ]);

    const attRow = (attStudents || []).find((r) => r.index_no === student.index_no) || null;
    let caSummary = null;
    if (caPack) {
      const [compsRes, caRows] = caPack;
      const comps = compsRes?.data || [];
      const row = (caRows || []).find((r) => r.index_no === student.index_no);
      if (row && comps.length) {
        const meta = parseCourseMeta(course);
        const { ca1, ca2, totalCa } = computeStudentCA(row, comps, meta.ca_config, course.ca_total);
        const rawExam = meta.exam_config?.scores?.[student.index_no];
        const exam = rawExam !== undefined && rawExam !== '' ? Number(rawExam) : null;
        const dec = Number(course.ca_decimals ?? 0);
        const total100 = exam !== null ? Number((totalCa + exam).toFixed(dec)) : null;
        caSummary = { ca1, ca2, totalCa, exam, total100, dec, caConfig: meta.ca_config };
      }
    }

    return {
      studentId,
      attRow,
      attSessions: attSessions || [],
      quizzes,
      attempts: attemptsRes?.data || [],
      assignments,
      submissions: subsRes?.data || [],
      messages: msgsRes?.data || [],
      caSummary,
    };
  }, [course.id, student.index_no, ta]);

  const attPct = data?.attRow?.applicable ? Math.round((data.attRow.attended / data.attRow.applicable) * 100) : null;

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 950,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Student profile for ${student.full_name}`}
        style={{
          width: 'min(560px, 100vw)',
          height: '100%',
          background: 'var(--surface)',
          boxShadow: '-8px 0 30px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            padding: '18px 20px',
            borderBottom: '1px solid var(--line-2)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            background: 'var(--surface-2)',
          }}
        >
          <div className="stack-sm" style={{ gap: 4 }}>
            <div className="eyebrow" style={{ color: 'var(--teal-dark)' }}>Student 360° · {course.code}</div>
            <h2 style={{ margin: 0, fontSize: 20 }}>{student.full_name}</h2>
            <div className="row-wrap" style={{ gap: 6 }}>
              <span className="mono small" style={{ fontWeight: 600 }}>{student.index_no}</span>
              {student.programme && <span className="badge">{student.programme}</span>}
              {student.stream && <span className="badge">{student.stream}</span>}
              {student.activated ? (
                <span className="badge badge-teal">Activated</span>
              ) : (
                <span className="badge badge-amber">Not activated</span>
              )}
            </div>
            <div className="tiny muted">
              Last sign-in: {student.last_sign_in ? `${relative(student.last_sign_in)} (${fmtDateTime(student.last_sign_in)})` : 'Never signed in'}
            </div>
          </div>
          <button type="button" className="icon-btn plain" aria-label="Close student drawer" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }} className="stack">
          <div className="row-wrap" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => onOutreach?.(student)}
            >
              <Icon name="chat" size={15} /> Send Advisory / Message
            </button>
            {student.activated && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onResetPassword?.(student)}
              >
                <Icon name="key" size={15} /> Reset Password
              </button>
            )}
          </div>

          {loading && <Loading label="Loading student record…" />}
          <ErrorNote error={error} onRetry={reload} />

          {data && (
            <>
              {/* CA & Exam Breakdown (Lecturer) */}
              {data.caSummary && (
                <section className="card stack-sm">
                  <div className="between">
                    <h3 style={{ margin: 0, fontSize: 15 }}>CA &amp; Exam Standing</h3>
                    <span className={`badge ${data.caSummary.totalCa >= 20 ? 'badge-teal' : 'badge-red'}`}>
                      Total CA: {data.caSummary.totalCa.toFixed(data.caSummary.dec)} / 40
                    </span>
                  </div>
                  <div className="grid-4" style={{ gap: 8 }}>
                    <div className="kpi" style={{ padding: '8px 10px' }}>
                      <span className="l">CA 1</span>
                      <span className="v" style={{ fontSize: 18 }}>{data.caSummary.ca1.toFixed(data.caSummary.dec)}</span>
                    </div>
                    <div className="kpi" style={{ padding: '8px 10px' }}>
                      <span className="l">CA 2</span>
                      <span className="v" style={{ fontSize: 18 }}>{data.caSummary.ca2.toFixed(data.caSummary.dec)}</span>
                    </div>
                    <div className="kpi" style={{ padding: '8px 10px' }}>
                      <span className="l">Exam (/60)</span>
                      <span className="v" style={{ fontSize: 18 }}>{data.caSummary.exam !== null ? data.caSummary.exam.toFixed(data.caSummary.dec) : '—'}</span>
                    </div>
                    <div className="kpi" style={{ padding: '8px 10px' }}>
                      <span className="l">Total (/100)</span>
                      <span className="v" style={{ fontSize: 18 }}>{data.caSummary.total100 !== null ? data.caSummary.total100.toFixed(data.caSummary.dec) : '—'}</span>
                    </div>
                  </div>
                </section>
              )}

              {/* Attendance Summary */}
              <section className="card stack-sm">
                <div className="between">
                  <h3 style={{ margin: 0, fontSize: 15 }}>Attendance</h3>
                  {attPct !== null ? (
                    <span className={`badge ${attPct >= 75 ? 'badge-teal' : attPct >= 50 ? 'badge-amber' : 'badge-red'}`}>
                      {data.attRow.attended} / {data.attRow.applicable} ({attPct}%)
                    </span>
                  ) : (
                    <span className="tiny muted">No applicable sessions</span>
                  )}
                </div>
                {attPct !== null && (
                  <>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: `${attPct}%`, background: attPct < 75 ? 'var(--amber)' : 'var(--teal)' }}
                      />
                    </div>
                    {attPct < 75 && (
                      <div className="tiny" style={{ color: 'var(--red-ink)' }}>
                        Below the 75% mandatory university exam attendance threshold.
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* Quizzes */}
              <section className="card stack-sm">
                <div className="between">
                  <h3 style={{ margin: 0, fontSize: 15 }}>Quizzes ({data.quizzes.length})</h3>
                </div>
                {data.quizzes.length === 0 ? (
                  <span className="small muted">No quizzes in this course yet.</span>
                ) : (
                  <div className="stack-sm">
                    {data.quizzes.map((qz) => {
                      const qAttempts = data.attempts.filter((a) => a.quiz_id === qz.id);
                      const best = qAttempts.find((a) => a.status !== 'in_progress') || qAttempts[0] || null;
                      const p = best && best.score !== null ? pct(best.score, best.max_score) : null;
                      const exits = qAttempts.reduce((s, a) => s + (a.exits || 0), 0);
                      return (
                        <div key={qz.id} className="between" style={{ padding: '8px 0', borderTop: '1px solid var(--line-2)', gap: 8 }}>
                          <div className="stack-sm" style={{ gap: 2 }}>
                            <span className="small strong">
                              {qz.title} {qz.is_practice && <span className="badge">Practice</span>}
                            </span>
                            <span className="tiny muted">
                              {best ? `Submitted ${best.submitted_at ? fmtDateTime(best.submitted_at) : '(In progress)'}` : 'Not attempted'}
                              {exits > 0 ? ` · ${exits} exit${exits === 1 ? '' : 's'}` : ''}
                            </span>
                          </div>
                          <div className="row" style={{ gap: 6 }}>
                            {exits > 0 && <span className="badge badge-red">{exits}× left</span>}
                            {best ? (
                              <span className={`badge ${best.status === 'marked' ? 'badge-teal' : best.status === 'needs_marking' ? 'badge-amber' : 'badge-blue'}`}>
                                {best.score !== null && best.status !== 'in_progress'
                                  ? `${fmtNumber(best.score)}/${fmtNumber(best.max_score)} (${p}%)`
                                  : best.status === 'needs_marking'
                                  ? 'Needs marking'
                                  : 'In progress'}
                              </span>
                            ) : (
                              <span className="badge">—</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Assignments */}
              <section className="card stack-sm">
                <h3 style={{ margin: 0, fontSize: 15 }}>Assignments ({data.assignments.length})</h3>
                {data.assignments.length === 0 ? (
                  <span className="small muted">No assignments in this course yet.</span>
                ) : (
                  <div className="stack-sm">
                    {data.assignments.map((asg) => {
                      const sub = data.submissions.find((s) => s.assignment_id === asg.id) || null;
                      return (
                        <div key={asg.id} className="between" style={{ padding: '8px 0', borderTop: '1px solid var(--line-2)', gap: 8 }}>
                          <div className="stack-sm" style={{ gap: 2 }}>
                            <span className="small strong">{asg.title}</span>
                            <span className="tiny muted">
                              {sub ? `Submitted ${fmtDateTime(sub.submitted_at)}${sub.is_late ? ' (Late)' : ''}` : 'Not submitted'}
                            </span>
                          </div>
                          {sub ? (
                            <span className={`badge ${sub.marks !== null ? 'badge-teal' : 'badge-amber'}`}>
                              {sub.marks !== null ? `${fmtNumber(sub.marks)} / ${fmtNumber(asg.max_marks)}` : 'Submitted'}
                            </span>
                          ) : (
                            <span className="badge">Missing</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Direct Messages (Lecturer only) */}
              {!ta && (
                <section className="card stack-sm">
                  <h3 style={{ margin: 0, fontSize: 15 }}>Recent Messages &amp; Advisories</h3>
                  {data.messages.length === 0 ? (
                    <span className="small muted">No direct messages or advisories sent to this student yet.</span>
                  ) : (
                    <div className="stack-sm">
                      {data.messages.map((m) => (
                        <div key={m.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line-2)' }} className="stack-sm">
                          <div className="between">
                            <strong className="small">{m.subject || 'Direct Message'}</strong>
                            <span className="tiny muted">{relative(m.created_at)}</span>
                          </div>
                          <p className="tiny muted" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                            {m.message.slice(0, 220)}{m.message.length > 220 ? '…' : ''}
                          </p>
                          {m.reply && (
                            <div className="tiny" style={{ background: 'var(--teal-50)', padding: '6px 8px', borderRadius: 6 }}>
                              <strong>Reply:</strong> {m.reply}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
