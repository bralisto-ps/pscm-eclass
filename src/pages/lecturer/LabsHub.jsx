import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Topbar } from '../../components/Layout.jsx';
import Icon from '../../components/Icon.jsx';
import { Empty, ErrorNote, Loading, useLoad, useToast } from '../../components/ui.jsx';
import { run, supabase } from '../../lib/supabase.js';
import { parseCourseMeta, serializeCourseMeta } from '../../lib/courseMeta.js';
import { DATA_POLICIES, LAB_CATALOG, LAB_DOMAINS } from '../../lib/labsCatalog.js';
import AssignLabModal from '../../components/labs/AssignLabModal.jsx';

const LabRunnerModal = lazy(() => import('../../components/labs/LabRunnerModal.jsx'));
const LiveLabSessionModal = lazy(() => import('../../components/labs/LiveLabSessionModal.jsx'));

export default function LabsHub() {
  const toast = useToast();
  const [domain, setDomain] = useState('all');
  const [assigningLabId, setAssigningLabId] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null); // { labId, course, config }
  const [previewLab, setPreviewLab] = useState(null);
  const [liveHostLabId, setLiveHostLabId] = useState(null);

  const { data: courses, error, loading, reload } = useLoad(
    () => run(supabase.from('courses').select('id, code, title, color, semester, description, archived').eq('archived', false).order('code')),
    [],
  );

  const activeCourses = courses || [];

  const assignmentsByLab = useMemo(() => {
    const map = new Map();
    LAB_CATALOG.forEach((l) => map.set(l.id, []));
    activeCourses.forEach((course) => {
      const meta = parseCourseMeta(course);
      (meta.labs_config || []).forEach((cfg) => {
        if (!map.has(cfg.labId)) map.set(cfg.labId, []);
        map.get(cfg.labId).push({ course, config: cfg });
      });
    });
    return map;
  }, [activeCourses]);

  const visibleLabs = useMemo(
    () => (domain === 'all' ? LAB_CATALOG : LAB_CATALOG.filter((l) => l.domain === domain)),
    [domain],
  );

  async function removeLabFromCourse(course, labId) {
    try {
      const fresh = await run(supabase.from('courses').select('id, description').eq('id', course.id).single());
      const meta = parseCourseMeta(fresh);
      const nextLabs = (meta.labs_config || []).filter((l) => l.labId !== labId);
      const serialized = serializeCourseMeta(meta.about, meta.ca_config, meta.exam_config, meta.course_info, nextLabs);
      await run(supabase.from('courses').update({ description: serialized }).eq('id', course.id));
      toast(`Removed lab from ${course.code}.`);
      reload();
    } catch (e) {
      toast(e.message || 'Could not update course labs.', 'error');
    }
  }

  return (
    <>
      <Topbar
        title="Software Laboratories"
        sub="Select which interactive lab modules are opened to each class, with your own data or student data"
      />

      <div className="page stack-lg">
        {error && <ErrorNote error={error} onRetry={reload} />}

        {/* Domain Filter Bar */}
        <div className="between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="row-wrap" style={{ gap: 6 }}>
            {LAB_DOMAINS.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`btn btn-sm ${domain === d.id ? 'btn-primary' : ''}`}
                onClick={() => setDomain(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="row-wrap" style={{ gap: 10 }}>
            <span className="small muted">
              {visibleLabs.length} module{visibleLabs.length === 1 ? '' : 's'} · {activeCourses.length} active class{activeCourses.length === 1 ? '' : 'es'}
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setLiveHostLabId('psis_seven_names')}
            >
              <Icon name="flask" size={14} /> Host Live Classroom Session
            </button>
          </div>
        </div>

        {loading ? (
          <Loading label="Loading laboratory catalog…" />
        ) : (
          <div className="stack">
            {visibleLabs.map((lab) => {
              const assigned = assignmentsByLab.get(lab.id) || [];
              return (
                <section key={lab.id} className="card stack">
                  <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
                    <div className="stack-xs" style={{ flex: 1, minWidth: 260 }}>
                      <div className="tiny muted">
                        {lab.code} · {lab.domain} · {lab.duration} · Course data &amp; student own data supported
                      </div>
                      <h2 style={{ margin: 0, fontSize: 19 }}>{lab.title}</h2>
                      <p className="small muted" style={{ margin: '4px 0 0', maxWidth: 760 }}>{lab.summary}</p>
                    </div>

                    <div className="row-wrap" style={{ gap: 8 }}>
                      {lab.supportsLiveClassroom && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ borderColor: 'var(--teal-700)', color: 'var(--teal-700)' }}
                          onClick={() => setLiveHostLabId(lab.id)}
                        >
                          ● Host Live Class
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setPreviewLab({ labId: lab.id, title: lab.title, dataMode: 'both', presetId: lab.defaultPresetId })}
                      >
                        <Icon name="play" size={14} /> Try / Preview Lab
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!activeCourses.length}
                        onClick={() => {
                          setAssignTarget(null);
                          setAssigningLabId(lab.id);
                        }}
                      >
                        <Icon name="plus" size={14} /> Open for a Class
                      </button>
                    </div>
                  </div>

                  {/* Assigned Classes Table */}
                  <div style={{ paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
                    {assigned.length === 0 ? (
                      <div className="tiny muted">
                        Not opened to any class yet. Click <strong>Open for a Class</strong> to assign this module, configure its dataset, and optionally link a graded assignment.
                      </div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table className="table" style={{ fontSize: 13 }}>
                          <thead>
                            <tr>
                              <th>Class</th>
                              <th>Status</th>
                              <th>Data Source</th>
                              <th>Gradebook Link</th>
                              <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {assigned.map(({ course, config }) => {
                              const policy = DATA_POLICIES.find((p) => p.id === config.dataMode)?.short || config.dataMode;
                              return (
                                <tr key={course.id}>
                                  <td>
                                    <Link to={`/teach/course/${course.id}?tab=labs`} style={{ fontWeight: 600 }}>
                                      {course.code}
                                    </Link>
                                    <span className="muted tiny" style={{ marginLeft: 8 }}>{course.title}</span>
                                  </td>
                                  <td className="tiny mono" style={{ fontWeight: 600, color: config.enabled ? 'var(--teal-700)' : 'var(--muted)' }}>
                                    {config.enabled ? '● OPEN' : 'CLOSED'}
                                  </td>
                                  <td className="tiny">
                                    {policy}
                                    {config.customDataset?.name ? ` · Custom: ${config.customDataset.name}` : ''}
                                  </td>
                                  <td className="tiny">
                                    {config.linkedAssignmentId ? (
                                      <Link to={`/teach/assignment/${config.linkedAssignmentId}`} style={{ fontWeight: 600, color: 'var(--teal-700)' }}>
                                        Graded Assignment → Mark
                                      </Link>
                                    ) : (
                                      <span className="muted">Practice (ungraded)</span>
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                                      <button
                                        type="button"
                                        className="btn btn-sm"
                                        onClick={() => {
                                          setAssignTarget({ labId: lab.id, course, config });
                                          setAssigningLabId(lab.id);
                                        }}
                                      >
                                        Configure
                                      </button>
                                      <button
                                        type="button"
                                        className="icon-btn plain"
                                        title={`Remove from ${course.code}`}
                                        aria-label={`Remove from ${course.code}`}
                                        onClick={() => removeLabFromCourse(course, lab.id)}
                                      >
                                        <Icon name="trash" size={14} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}

            {!activeCourses.length && (
              <div className="card">
                <Empty icon="book" title="Create a course first">
                  Once you have at least one active course, you can open any laboratory module for that class and link it to assignments.
                </Empty>
              </div>
            )}
          </div>
        )}
      </div>

      {assigningLabId && (
        <AssignLabModal
          labId={assigningLabId}
          courses={activeCourses}
          lockedCourse={assignTarget?.course || null}
          existingConfig={assignTarget?.config || null}
          onSaved={reload}
          onClose={() => {
            setAssigningLabId(null);
            setAssignTarget(null);
          }}
        />
      )}

      {liveHostLabId && (
        <Suspense fallback={<Loading label="Starting live classroom session…" />}>
          <LiveLabSessionModal
            isHost
            initialLabId={liveHostLabId}
            onClose={() => setLiveHostLabId(null)}
          />
        </Suspense>
      )}

      {previewLab && (
        <Suspense fallback={<Loading label="Opening laboratory…" />}>
          <LabRunnerModal
            labConfig={previewLab}
            previewOnly
            onClose={() => setPreviewLab(null)}
          />
        </Suspense>
      )}
    </>
  );
}
