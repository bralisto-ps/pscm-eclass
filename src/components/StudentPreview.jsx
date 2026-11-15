import { useMemo, useState } from 'react';
import { run, supabase } from '../lib/supabase.js';
import { cleanAssignmentInstructions, parseAssignmentMeta } from '../lib/assignmentMeta.js';
import { isViewOnlyPath } from '../lib/files.js';
import { fmtDateTime, fmtNumber, relative } from '../lib/format.js';
import Icon from './Icon.jsx';
import { Empty, ErrorNote, KindTag, Loading, Tabs, useLoad } from './ui.jsx';

const PREVIEW_TABS = [
  { id: 'materials', label: 'Materials' },
  { id: 'quizzes', label: 'Quizzes' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'announcements', label: 'Announcements' },
];

export default function StudentPreview({ course, onExit }) {
  const [tab, setTab] = useState('materials');
  const { data, error, loading, reload } = useLoad(async () => {
    const [modules, materials, quizzes, assignments, news] = await Promise.all([
      run(supabase.from('modules').select('*').eq('course_id', course.id).order('week_no', { nullsFirst: false }).order('position')),
      run(supabase.from('materials').select('*').eq('course_id', course.id).order('position').order('created_at')),
      run(supabase.from('quizzes').select('*').eq('course_id', course.id).order('created_at')),
      run(supabase.from('assignments').select('*').eq('course_id', course.id).order('due_at', { nullsFirst: false })),
      run(supabase.from('announcements').select('*').eq('course_id', course.id).order('created_at', { ascending: false })),
    ]);
    return {
      modules: modules || [],
      materials: materials || [],
      quizzes: quizzes || [],
      assignments: assignments || [],
      news: news || [],
    };
  }, [course.id]);

  const pubQuizzes = useMemo(() => (data?.quizzes || []).filter((q) => q.published), [data]);
  const draftQuizzes = (data?.quizzes?.length || 0) - pubQuizzes.length;
  const pubAssignments = useMemo(() => (data?.assignments || []).filter((a) => a.published), [data]);
  const draftAssignments = (data?.assignments?.length || 0) - pubAssignments.length;
  const lockedMaterials = useMemo(() => (data?.materials || []).filter((m) => m.locked).length, [data]);

  const groups = useMemo(() => {
    if (!data) return [];
    const g = data.modules.map((m) => ({ ...m, items: data.materials.filter((x) => x.module_id === m.id) }));
    const loose = data.materials.filter((x) => !x.module_id);
    if (loose.length) g.unshift({ id: 'general', title: 'General', week_no: null, summary: '', items: loose });
    return g;
  }, [data]);

  const [selectedWeek, setSelectedWeek] = useState(null);
  const activeWeek = groups.find((g) => g.id === selectedWeek) || [...groups].reverse().find((g) => g.items.length) || groups[0];

  return (
    <div className="stack-lg">
      <div
        className="notice notice-warn between"
        style={{ flexWrap: 'wrap', gap: 12, padding: '12px 18px', borderRadius: 12 }}
        role="region"
        aria-label="Student preview notice"
      >
        <div className="row" style={{ gap: 10 }}>
          <Icon name="eye" size={18} />
          <div>
            <strong className="small">Student Preview Mode (Read-Only)</strong>
            <div className="tiny muted">
              Showing what students see right now
              {data ? ` · ${draftQuizzes} draft quiz${draftQuizzes === 1 ? '' : 'zes'}, ${draftAssignments} draft assignment${draftAssignments === 1 ? '' : 's'}, ${lockedMaterials} locked material${lockedMaterials === 1 ? '' : 's'} hidden` : ''}
            </div>
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={onExit}>
          Exit student preview
        </button>
      </div>

      {loading && <Loading label="Building student preview…" />}
      <ErrorNote error={error} onRetry={reload} />

      {data && (
        <>
          <Tabs tabs={PREVIEW_TABS} value={tab} onChange={setTab} />

          {tab === 'materials' && (
            groups.length === 0 ? (
              <div className="card"><Empty icon="book" title="No lecture materials yet">Students see an empty materials tab.</Empty></div>
            ) : (
              <div className="two-col" style={{ gridTemplateColumns: '240px minmax(0, 1fr)' }}>
                <aside className="card-flush">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className="list-row"
                      onClick={() => setSelectedWeek(g.id)}
                      style={{ background: activeWeek?.id === g.id ? 'var(--teal-50)' : undefined }}
                    >
                      <span className="list-main">
                        <span className="title small">{g.week_no ? `Week ${g.week_no} · ` : ''}{g.title}</span>
                        <span className="tiny muted">{g.items.length} item{g.items.length === 1 ? '' : 's'}</span>
                      </span>
                    </button>
                  ))}
                </aside>
                <section className="card stack">
                  <div>
                    <h2 style={{ margin: 0 }}>{activeWeek?.week_no ? `Week ${activeWeek.week_no} — ` : ''}{activeWeek?.title}</h2>
                    {activeWeek?.summary && <p className="small muted" style={{ marginTop: 4 }}>{activeWeek.summary}</p>}
                  </div>
                  {!activeWeek?.items?.length ? (
                    <p className="small muted">Nothing posted in this week yet.</p>
                  ) : (
                    <div className="stack-sm">
                      {activeWeek.items.map((m) => (
                        <div key={m.id} className="between" style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--line)', background: m.locked ? 'var(--surface-2)' : 'var(--surface)', opacity: m.locked ? 0.72 : 1 }}>
                          <div className="row" style={{ gap: 10 }}>
                            <KindTag kind={m.kind} />
                            <div>
                              <div className="small strong">{m.title}</div>
                              <div className="tiny muted row-wrap" style={{ gap: 6 }}>
                                {m.locked ? (
                                  <span className="badge badge-amber"><Icon name="lock" size={11} /> Locked for students</span>
                                ) : (
                                  <span>Visible to students</span>
                                )}
                                {isViewOnlyPath(m.storage_path) && <span className="badge">Read-only viewer</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )
          )}

          {tab === 'quizzes' && (
            pubQuizzes.length === 0 ? (
              <div className="card"><Empty icon="quiz" title="No published quizzes">Draft quizzes are hidden from students.</Empty></div>
            ) : (
              <div className="stack">
                {pubQuizzes.map((q) => {
                  const now = Date.now();
                  const opens = q.opens_at ? new Date(q.opens_at).getTime() : 0;
                  const closes = q.closes_at ? new Date(q.closes_at).getTime() : Infinity;
                  const state = now < opens ? 'Scheduled' : now > closes ? 'Closed' : 'Open now';
                  const badgeCls = state === 'Open now' ? 'badge-teal' : state === 'Scheduled' ? 'badge-blue' : '';
                  return (
                    <article key={q.id} className="card between" style={{ flexWrap: 'wrap', gap: 12 }}>
                      <div className="stack-sm" style={{ gap: 4 }}>
                        <div className="row-wrap" style={{ gap: 8 }}>
                          <strong style={{ fontSize: 16 }}>{q.title}</strong>
                          <span className={`badge ${badgeCls}`}>{state}</span>
                          {q.is_practice && <span className="badge badge-plum">Practice</span>}
                        </div>
                        <span className="tiny muted">
                          {q.duration_min ? `${q.duration_min} mins` : 'Untimed'}
                          {q.closes_at ? ` · closes ${fmtDateTime(q.closes_at)} (${relative(q.closes_at)})` : ''}
                        </span>
                      </div>
                      <span className="small muted">{q.results_released ? 'Results released' : 'Results hidden'}</span>
                    </article>
                  );
                })}
              </div>
            )
          )}

          {tab === 'assignments' && (
            pubAssignments.length === 0 ? (
              <div className="card"><Empty icon="clipboard" title="No published assignments">Draft assignments are hidden from students.</Empty></div>
            ) : (
              <div className="stack">
                {pubAssignments.map((a) => {
                  const meta = parseAssignmentMeta(a);
                  const clean = cleanAssignmentInstructions(a.instructions);
                  return (
                    <article key={a.id} className="card stack-sm">
                      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <div className="row-wrap" style={{ gap: 8 }}>
                          <strong style={{ fontSize: 16 }}>{a.title}</strong>
                          {meta.syndicate.enabled && <span className="badge badge-teal">Syndicate group</span>}
                          {meta.rubric.length > 0 && <span className="badge badge-blue">{meta.rubric.length}-criteria rubric</span>}
                        </div>
                        <span className="mono small strong">{fmtNumber(a.max_marks)} marks</span>
                      </div>
                      <div className="tiny muted">
                        {a.due_at ? `Due ${fmtDateTime(a.due_at)} (${relative(a.due_at)})` : 'No deadline'}
                        {a.allow_late ? ' · Late submissions allowed' : ' · Strict deadline'}
                      </div>
                      {clean && <p className="pre small" style={{ margin: '4px 0 0' }}>{clean}</p>}
                    </article>
                  );
                })}
              </div>
            )
          )}

          {tab === 'announcements' && (
            data.news.length === 0 ? (
              <div className="card"><Empty icon="megaphone" title="No announcements yet" /></div>
            ) : (
              <div className="stack">
                {data.news.map((n) => (
                  <article key={n.id} className="card stack-sm">
                    <div className="between">
                      <strong>{n.title}</strong>
                      <span className="tiny muted">{relative(n.created_at)}</span>
                    </div>
                    <p className="pre small" style={{ margin: 0 }}>{n.body}</p>
                  </article>
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
