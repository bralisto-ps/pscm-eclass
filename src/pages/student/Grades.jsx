import { Link } from 'react-router-dom';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { Topbar } from '../../components/Layout.jsx';
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
            <div className="row">
              <span className="nav-course-dot" style={{ background: c.color, width: 12, height: 12 }} />
              <h2>
                <Link to={`/course/${c.id}?tab=grades`} style={{ color: 'inherit' }}>{c.title}</Link>
              </h2>
              <span className="mono small muted">{c.code}</span>
            </div>
            <GradesTable quizzes={c.quizzes} assignments={c.assignments} />
          </section>
        ))}
      </div>
    </>
  );
}
