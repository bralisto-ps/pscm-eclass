import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Topbar } from '../../components/Layout.jsx';
import Icon from '../../components/Icon.jsx';
import { Empty, ErrorNote, Loading, useLoad, useToast } from '../../components/ui.jsx';
import { run, supabase } from '../../lib/supabase.js';
import { parseCourseMeta, serializeCourseMeta } from '../../lib/courseMeta.js';
import { DATA_POLICIES, LAB_CATALOG, LAB_DOMAINS } from '../../lib/labsCatalog.js';
import { LAB_CONCEPT_GUIDES, LAB_TRACK_META } from '../../lib/labScoringBridge.js';
import { buildLecturerFacilitationGuide } from '../../lib/labMilestone8Engine.js';
import { buildTypedResponsePdfBlob } from '../../lib/textPdf.js';
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

  const { data: loaded, error, loading, reload } = useLoad(async () => {
    const courses = await run(
      supabase
        .from('courses')
        .select('id, code, title, color, semester, description, archived')
        .eq('archived', false)
        .order('code'),
    );
    const courseIds = (courses || []).map((c) => c.id);
    let assignStats = [];
    if (courseIds.length) {
      assignStats = await run(
        supabase
          .from('assignments')
          .select('id, course_id, title, max_marks, submissions(count)')
          .in('course_id', courseIds),
      ).catch(() => []);
    }
    return { courses: courses || [], assignStats: assignStats || [] };
  }, []);

  const activeCourses = loaded?.courses || [];
  const assignStatsById = useMemo(
    () => new Map((loaded?.assignStats || []).map((a) => [a.id, a])),
    [loaded?.assignStats],
  );

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

  const visibleLabs = useMemo(() => {
    if (domain === 'all') return LAB_CATALOG;
    if (domain === 'live') return LAB_CATALOG.filter((l) => l.supportsLiveClassroom);
    return LAB_CATALOG.filter((l) => l.domain === domain);
  }, [domain]);

  const liveCount = useMemo(
    () => LAB_CATALOG.filter((l) => l.supportsLiveClassroom).length,
    [],
  );

  function downloadFacilitationPdf(lab) {
    const guide = buildLecturerFacilitationGuide(lab, LAB_CONCEPT_GUIDES[lab.id] || null);
    const blob = buildTypedResponsePdfBlob({
      title: guide.title,
      studentLine: 'PSCM E-Class · Lecturer Facilitation & Debrief Sheet',
      submittedAt: new Date().toLocaleDateString(),
      body: guide.body,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lab.code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-facilitation-guide.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Downloaded 1-page Facilitation Guide PDF for ${lab.code}.`);
  }

  async function removeLabFromCourse(course, labId) {
    try {
      const fresh = await run(supabase.from('courses').select('id, description').eq('id', course.id).single());
      const meta = parseCourseMeta(fresh);
      const nextLabs = (meta.labs_config || []).filter((l) => l.labId !== labId);
      const serialized = serializeCourseMeta(meta.about, meta.ca_config, meta.exam_config, meta.course_info, nextLabs, meta.lab_datasets);
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
        title="Software Laboratories Studio"
        sub="Open interactive TQM, PSIS & SCM labs to classes, link to CA assignments, or host live classroom sessions"
      />

      <div className="page stack-lg">
        {error && <ErrorNote error={error} onRetry={reload} />}

        {/* Domain Filter & Live Session Toolbar */}
        <div className="card-soft between" style={{ padding: '12px 16px', flexWrap: 'wrap', gap: 12 }}>
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
            <button
              type="button"
              className={`btn btn-sm ${domain === 'live' ? 'btn-primary' : ''}`}
              onClick={() => setDomain('live')}
            >
              ● Live Classroom Ready ({liveCount})
            </button>
          </div>
          <div className="row-wrap" style={{ gap: 10 }}>
            <span className="tiny mono muted">
              {visibleLabs.length} LABS · {activeCourses.length} ACTIVE CLASS{activeCourses.length === 1 ? '' : 'ES'}
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
          <Loading label="Loading laboratory studio…" />
        ) : (
          <div className="stack-lg">
            <div className="lab-gallery-grid">
              {visibleLabs.map((lab) => {
                const assigned = assignmentsByLab.get(lab.id) || [];
                const track = LAB_TRACK_META[lab.id] || { track: lab.domain, accent: 'var(--teal-700)', stage: 'Interactive Lab' };

                return (
                  <section
                    key={lab.id}
                    className="lab-gallery-card"
                    style={{ '--lab-accent': track.accent }}
                  >
                    <div className="stack-xs">
                      <div className="between" style={{ gap: 8, alignItems: 'center' }}>
                        <span className="tiny mono" style={{ fontWeight: 700, color: track.accent }}>
                          {lab.code}
                        </span>
                        <span className="tiny mono muted">
                          {lab.supportsLiveClassroom ? '● LIVE CLASS' : lab.duration}
                        </span>
                      </div>

                      <h2 style={{ margin: '2px 0 0', fontSize: 17, lineHeight: 1.3 }}>{lab.title}</h2>

                      <p className="small muted" style={{ margin: '4px 0 0', lineHeight: 1.45 }}>
                        {lab.summary}
                      </p>
                    </div>

                    <div className="stack-sm" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                      <div className="row-wrap" style={{ gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={!activeCourses.length}
                          onClick={() => {
                            setAssignTarget(null);
                            setAssigningLabId(lab.id);
                          }}
                        >
                          <Icon name="plus" size={13} /> Assign to Class
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setPreviewLab({ labId: lab.id, title: lab.title, dataMode: 'both', presetId: lab.defaultPresetId })}
                        >
                          <Icon name="eye" size={13} /> Preview
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => downloadFacilitationPdf(lab)}
                          title="Download 1-page printable teaching guide, timing breakdown & debrief prompts"
                        >
                          <Icon name="book" size={13} /> Guide PDF
                        </button>
                        {lab.supportsLiveClassroom && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ borderColor: 'var(--teal-700)', color: 'var(--teal-700)' }}
                            onClick={() => setLiveHostLabId(lab.id)}
                          >
                            ● Live Class
                          </button>
                        )}
                      </div>

                      {assigned.length === 0 ? (
                        <div className="tiny muted">Not opened for any class yet.</div>
                      ) : (
                        <div className="stack-xs">
                          {assigned.map(({ course, config }) => {
                            const policy = DATA_POLICIES.find((p) => p.id === config.dataMode)?.short || config.dataMode;
                            const aStat = config.linkedAssignmentId ? assignStatsById.get(config.linkedAssignmentId) : null;
                            const subCount = aStat?.submissions?.[0]?.count ?? null;
                            return (
                              <div
                                key={course.id}
                                className="between card-soft"
                                style={{ padding: '7px 10px', gap: 8, flexWrap: 'wrap' }}
                              >
                                <div className="stack-xs" style={{ gap: 2 }}>
                                  <div className="small">
                                    <Link to={`/teach/course/${course.id}?tab=labs`} style={{ fontWeight: 700 }}>
                                      {course.code}
                                    </Link>
                                    <span
                                      className="tiny mono"
                                      style={{ marginLeft: 8, fontWeight: 700, color: config.enabled ? 'var(--teal-700)' : 'var(--muted)' }}
                                    >
                                      {config.enabled ? '● OPEN' : 'CLOSED'}
                                    </span>
                                  </div>
                                  <div className="tiny muted">
                                    {policy}
                                    {config.linkedAssignmentId ? (
                                      <>
                                        {' · '}
                                        <Link to={`/teach/assignment/${config.linkedAssignmentId}`} style={{ fontWeight: 600, color: 'var(--teal-700)' }}>
                                          CA Assignment{subCount !== null ? ` (${subCount} submitted)` : ''} → Mark
                                        </Link>
                                      </>
                                    ) : ' · Practice'}
                                  </div>
                                </div>
                                <div className="row" style={{ gap: 4 }}>
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => {
                                      setAssignTarget({ labId: lab.id, course, config });
                                      setAssigningLabId(lab.id);
                                    }}
                                  >
                                    Edit
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
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>

            {!activeCourses.length && (
              <div className="card">
                <Empty icon="book" title="Create a course first">
                  Once you have at least one active course, you can open any laboratory module for that class and map it directly to CA assignments.
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
            courses={activeCourses}
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
