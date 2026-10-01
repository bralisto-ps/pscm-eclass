import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { dayChip, fmtDateTime, greeting, initials, relative } from '../../lib/format.js';
import { Topbar } from '../../components/Layout.jsx';
import { Empty, ErrorNote, Loading, Swatch, useLoad } from '../../components/ui.jsx';

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

export default function StudentHome() {
  const { profile } = useAuth();
  const { data, error, loading, reload } = useLoad(async () => {
    const [courses, upcoming, news] = await Promise.all([
      run(supabase.from('courses').select('id, code, title, color, semester, description').eq('archived', false).order('code')),
      rpc('my_upcoming'),
      run(supabase.from('announcements').select('id, title, body, created_at, courses(code, color)').order('created_at', { ascending: false }).limit(5)),
    ]);
    return { courses, upcoming: upcoming || [], news };
  }, []);

  const firstName = (profile.full_name || '').split(' ')[0];

  return (
    <>
      <Topbar title={`${greeting()}, ${firstName}`} sub={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} />
      <div className="page">
        {loading && <Loading />}
        <ErrorNote error={error} onRetry={reload} />
        {data && (
          <div className="two-col">
            <main className="stack-lg">
              {data.upcoming[0] ? (
                <NextUp item={data.upcoming[0]} />
              ) : (
                <section className="hero">
                  <div>
                    <div className="kicker">All caught up</div>
                    <div className="title">Nothing is due right now</div>
                    <div className="meta">New quizzes and assignments will show up here.</div>
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
                      return (
                        <Link key={c.id} to={`/course/${c.id}`} className="course-tile">
                          <Swatch color={c.color} text={initials(c.title)} />
                          <div className="stack-sm" style={{ minWidth: 0, flex: 1, gap: 4 }}>
                            <div className="between" style={{ alignItems: 'flex-start' }}>
                              <span className="strong">{c.title}</span>
                              <span className="mono tiny muted nowrap">{c.code}</span>
                            </div>
                            <span className="small muted">
                              {next ? `Next: ${next.title} · ${relative(next.due)}` : 'Nothing due'}
                            </span>
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
                <div className="card-head"><h2>Coming up</h2></div>
                {data.upcoming.length === 0 && <Empty icon="calendar">No deadlines.</Empty>}
                {data.upcoming.slice(0, 6).map((u) => {
                  const d = dayChip(u.due);
                  return (
                    <Link key={u.kind + u.id} to={`/course/${u.course_id}?tab=${u.kind === 'quiz' ? 'quizzes' : 'assignments'}`} className="list-row">
                      <div className="day-chip" style={{ background: u.kind === 'quiz' ? 'var(--amber-50)' : 'var(--teal-50)', color: u.kind === 'quiz' ? 'var(--amber-ink)' : 'var(--teal-dark)' }}>
                        <span className="dw">{d.day}</span>
                        <span className="dd">{d.date}</span>
                      </div>
                      <div className="list-main">
                        <span className="title">{u.title}</span>
                        <span className="tiny muted">{u.course_code} · {u.kind === 'quiz' ? 'Quiz' : 'Assignment'}</span>
                      </div>
                    </Link>
                  );
                })}
              </section>

              <section className="card-flush">
                <div className="card-head"><h2>Announcements</h2></div>
                {data.news.length === 0 && <Empty icon="megaphone">No announcements yet.</Empty>}
                {data.news.map((n) => (
                  <div key={n.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                    <div className="list-main">
                      <span className="tiny muted">{n.courses?.code} · {relative(n.created_at)}</span>
                      <span className="strong small">{n.title}</span>
                      {n.body && <span className="small pre" style={{ color: 'var(--text-2)' }}>{n.body.length > 220 ? `${n.body.slice(0, 220)}…` : n.body}</span>}
                    </div>
                  </div>
                ))}
              </section>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}

function NextUp({ item }) {
  const d = dayChip(item.due);
  return (
    <section className="hero" aria-label="Next up">
      <div className="date-block">
        <span className="tiny strong" style={{ color: '#f2c98b', letterSpacing: '0.08em' }}>{d.day}</span>
        <span className="d">{d.date}</span>
        <span className="tiny" style={{ color: '#9faab4' }}>{d.month}</span>
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
