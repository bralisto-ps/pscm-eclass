import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import CheckInModal from '../../components/CheckIn.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { buildDeadlinesIcs, googleCalendarUrl } from '../../lib/calendar.js';
import { downloadText } from '../../lib/sheets.js';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { dayChip, fmtDateTime, greeting, relative } from '../../lib/format.js';
import Icon from '../../components/Icon.jsx';
import { Topbar } from '../../components/Layout.jsx';
import { DashboardSkeleton, Empty, ErrorNote, useLoad, useToast } from '../../components/ui.jsx';

function describe(item) {
  if (item.kind === 'quiz') {
    const now = Date.now();
    if (item.opens_at && new Date(item.opens_at).getTime() > now) {
      return `Opens ${fmtDateTime(item.opens_at)} · ${item.question_count} questions · ${item.duration_minutes} min`;
    }
    return `Open now${item.closes_at ? ` · closes ${fmtDateTime(item.closes_at)}` : ''} · ${item.duration_minutes} min`;
  }
  return `Due ${fmtDateTime(item.due)}`;
}

function urgencyBucket(dueIso) {
  const diffH = (new Date(dueIso).getTime() - Date.now()) / 3600000;
  if (diffH <= 48) return 'urgent';
  if (diffH <= 168) return 'week';
  return 'later';
}

export default function StudentHome() {
  const { profile } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(async () => {
    const [courses, upcoming, news, openAtt] = await Promise.all([
      run(supabase.from('courses').select('id, code, title, color, semester, description').eq('archived', false).order('code')),
      rpc('my_upcoming'),
      run(supabase.from('announcements').select('id, title, body, created_at, courses(code, color)').order('created_at', { ascending: false }).limit(5)),
      rpc('my_open_attendance'),
    ]);
    return { courses, upcoming: upcoming || [], news, openAtt: openAtt || [] };
  }, []);

  const firstName = (profile.full_name || '').split(' ')[0];
  const [checkIn, setCheckIn] = useState(null);
  const [dlFilter, setDlFilter] = useState('all'); // 'all' | 'week' | 'quiz' | 'assignment'
  const [showAllDl, setShowAllDl] = useState(false);

  const upcomingList = data?.upcoming || [];
  const filteredUpcoming = useMemo(() => {
    const now = Date.now();
    const weekEnd = now + 7 * 24 * 3600 * 1000;
    return upcomingList.filter((u) => {
      if (dlFilter === 'week') {
        const t = new Date(u.due).getTime();
        return t <= weekEnd;
      }
      if (dlFilter === 'quiz') return u.kind === 'quiz';
      if (dlFilter === 'assignment') return u.kind === 'assignment';
      return true;
    });
  }, [upcomingList, dlFilter]);

  const urgentCount = useMemo(
    () => upcomingList.filter((u) => urgencyBucket(u.due) === 'urgent').length,
    [upcomingList],
  );

  function exportIcs() {
    const target = filteredUpcoming.length ? filteredUpcoming : upcomingList;
    if (!target.length) {
      toast('No upcoming deadlines to export.', 'error');
      return;
    }
    const originUrl = typeof window !== 'undefined' ? window.location.origin : 'https://eclasspscm.com';
    const ics = buildDeadlinesIcs(target, originUrl);
    downloadText('PSCM_Eclass_Deadlines.ics', ics, 'text/calendar;charset=utf-8');
    toast(`Exported ${target.length} deadline${target.length === 1 ? '' : 's'} to calendar (.ics)`);
  }

  const visibleDeadlines = showAllDl ? filteredUpcoming : filteredUpcoming.slice(0, 6);

  return (
    <>
      <Topbar
        title={`${greeting()}, ${firstName}`}
        sub={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
      />
      <div className="page">
        {loading && <DashboardSkeleton />}
        <ErrorNote error={error} onRetry={reload} />
        {data && (
          <div className="two-col">
            <main className="stack-lg">
              {data.openAtt.map((a) => (
                <section key={a.session_id} className="notice notice-info row-wrap" style={{ padding: '14px 18px' }} aria-label="Attendance open">
                  <Icon name="shield" size={18} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 200 }}>
                    <strong>Attendance is open for {a.course_code}</strong> — {a.title}.{' '}
                    {a.lat != null ? 'GPS geofence active (hall verification required).' : 'Enter the code shown in class.'}
                  </span>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setCheckIn(a)}>Check in</button>
                </section>
              ))}

              {data.upcoming[0] ? (
                <NextUp item={data.upcoming[0]} onExportOne={exportIcs} />
              ) : (
                <section className="hero">
                  <div>
                    <div className="kicker">All caught up</div>
                    <div className="title">Nothing is due right now</div>
                    <div className="meta">New quizzes and assignments will appear here as soon as they are published.</div>
                  </div>
                </section>
              )}

              <section>
                <div className="section-title">
                  <h2>My courses</h2>
                  <span className="small muted">{data.courses.length} enrolled</span>
                </div>
                {data.courses.length === 0 ? (
                  <div className="card">
                    <Empty icon="book" title="No courses yet">
                      Your lecturer has not added you to a course yet. If you think this is wrong, contact them with your index number.
                    </Empty>
                  </div>
                ) : (
                  <div className="grid-2">
                    {data.courses.map((c) => {
                      const next = data.upcoming.find((u) => u.course_id === c.id);
                      const urgent = next && urgencyBucket(next.due) === 'urgent';
                      return (
                        <Link key={c.id} to={`/course/${c.id}`} className="course-card-ed">
                          <div className="course-card-band" style={{ backgroundColor: c.color }}>
                            <div className="course-card-meta">
                              <span className="mono">{c.code}{c.semester ? ` · ${c.semester}` : ''}</span>
                              {next && (
                                <span className="nowrap" style={{ color: urgent ? '#fde68a' : 'rgba(255,255,255,0.9)', fontWeight: 500 }}>
                                  {relative(next.due)}
                                </span>
                              )}
                            </div>
                            <div className="course-card-title">{c.title}</div>
                          </div>
                          <div className="course-card-body" style={{ padding: '14px 20px' }}>
                            <div className="course-card-foot">
                              <span style={{ color: urgent ? 'var(--amber-ink)' : 'var(--muted)', fontWeight: urgent ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {next ? `Next: ${next.title}` : 'All upcoming work completed'}
                              </span>
                              <span className="course-card-cta">Open <Icon name="chevronRight" size={14} /></span>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            </main>

            <aside className="stack">
              <section className="card-flush">
                <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <h2>Deadlines</h2>
                    {urgentCount > 0 && (
                      <span className="badge badge-amber">{urgentCount} in 48h</span>
                    )}
                  </div>
                  {upcomingList.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={exportIcs}
                      title="Download .ics file for Apple, Outlook, or Google Calendar"
                    >
                      <Icon name="calendar" size={14} /> Export .ics
                    </button>
                  )}
                </div>

                {upcomingList.length > 0 && (
                  <div className="row-wrap" style={{ padding: '10px 16px', gap: 6, borderBottom: '1px solid var(--line-2)', background: 'var(--surface-2)' }}>
                    {[
                      { id: 'all', label: `All (${upcomingList.length})` },
                      { id: 'week', label: 'This week' },
                      { id: 'quiz', label: 'Quizzes' },
                      { id: 'assignment', label: 'Assignments' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`btn btn-sm ${dlFilter === f.id ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ minHeight: 30, padding: '0 10px', fontSize: 12 }}
                        onClick={() => { setDlFilter(f.id); setShowAllDl(false); }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}

                {filteredUpcoming.length === 0 && (
                  <Empty icon="calendar">
                    {upcomingList.length === 0 ? 'No deadlines.' : 'No deadlines match this filter.'}
                  </Empty>
                )}

                {visibleDeadlines.map((u) => {
                  const d = dayChip(u.due);
                  const bucket = urgencyBucket(u.due);
                  const gcal = googleCalendarUrl(u, typeof window !== 'undefined' ? window.location.origin : 'https://eclasspscm.com');
                  return (
                    <div key={u.kind + u.id} className="list-row" style={{ gap: 10 }}>
                      <Link
                        to={`/course/${u.course_id}?tab=${u.kind === 'quiz' ? 'quizzes' : 'assignments'}`}
                        className="row"
                        style={{ flex: 1, minWidth: 0, gap: 12, textDecoration: 'none', color: 'inherit' }}
                      >
                        <div
                          className="day-chip"
                          style={{
                            background: u.kind === 'quiz' ? 'var(--amber-50)' : 'var(--teal-50)',
                            color: u.kind === 'quiz' ? 'var(--amber-ink)' : 'var(--teal-dark)',
                          }}
                        >
                          <span className="dw">{d.day}</span>
                          <span className="dd">{d.date}</span>
                        </div>
                        <div className="list-main">
                          <span className="title">{u.title}</span>
                          <span className="tiny muted">
                            {u.course_code} · {u.kind === 'quiz' ? 'Quiz' : 'Assignment'} ·{' '}
                            <span style={{ color: bucket === 'urgent' ? 'var(--red-ink)' : undefined, fontWeight: bucket === 'urgent' ? 600 : undefined }}>
                              {relative(u.due)}
                            </span>
                          </span>
                        </div>
                      </Link>
                      {gcal && (
                        <a
                          href={gcal}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="icon-btn plain"
                          title="Add to Google Calendar"
                          aria-label={`Add ${u.title} to Google Calendar`}
                        >
                          <Icon name="calendar" size={15} />
                        </a>
                      )}
                    </div>
                  );
                })}

                {filteredUpcoming.length > 6 && (
                  <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line-2)', textAlign: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setShowAllDl((s) => !s)}
                    >
                      {showAllDl ? 'Show fewer' : `Show all ${filteredUpcoming.length} deadlines`}
                    </button>
                  </div>
                )}
              </section>

              <section className="card-flush">
                <div className="card-head"><h2>Announcements</h2></div>
                {data.news.length === 0 && <Empty icon="megaphone">No announcements yet.</Empty>}
                {data.news.map((n) => (
                  <div key={n.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                    <div className="list-main">
                      <span className="tiny muted">{n.courses?.code} · {relative(n.created_at)}</span>
                      <span className="strong small">{n.title}</span>
                      {n.body && (
                        <span className="small pre" style={{ color: 'var(--text-2)' }}>
                          {n.body.length > 220 ? `${n.body.slice(0, 220)}…` : n.body}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            </aside>
          </div>
        )}
      </div>
      {checkIn && <CheckInModal courseId={checkIn.course_id} courseCode={checkIn.course_code} askRow={checkIn.ask_row} onClose={() => setCheckIn(null)} onDone={reload} />}
    </>
  );
}

function NextUp({ item }) {
  const d = dayChip(item.due);
  return (
    <section className="hero" aria-label="Next up">
      <div className="date-block">
        <span className="tiny strong" style={{ color: '#fcd34d', letterSpacing: '0.08em' }}>{d.day}</span>
        <span className="d">{d.date}</span>
        <span className="tiny" style={{ color: '#94a3b8' }}>{d.month}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }} className="stack-sm">
        <span className="kicker">Next up · {item.kind === 'quiz' ? 'Quiz' : 'Assignment'}</span>
        <span className="title">{item.title} — {item.course_code}</span>
        <span className="meta">{describe(item)}</span>
      </div>
      <Link to={`/course/${item.course_id}?tab=${item.kind === 'quiz' ? 'quizzes' : 'assignments'}`} className="btn btn-light">
        {item.kind === 'quiz' ? 'Go to quiz' : 'Hand in'}
      </Link>
    </section>
  );
}
