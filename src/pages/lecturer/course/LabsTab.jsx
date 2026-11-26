import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../../components/Icon.jsx';
import { Empty, Loading, useLoad, useToast } from '../../../components/ui.jsx';
import { run, supabase } from '../../../lib/supabase.js';
import { parseCourseMeta, serializeCourseMeta } from '../../../lib/courseMeta.js';
import { DATA_POLICIES, getLabDef, LAB_CATALOG } from '../../../lib/labsCatalog.js';
import { downloadWorkbook } from '../../../lib/sheets.js';
import { buildTypedResponsePdfBlob } from '../../../lib/textPdf.js';
import { LAB_CLOUD_SYNC_SQL } from '../../../lib/allFeaturesSql.js';
import {
  buildAccreditationEvidenceText,
  buildAccreditationWorkbookSheets,
  buildCourseCloMasteryMatrix,
} from '../../../lib/labMilestone9Engine.js';
import AssignLabModal from '../../../components/labs/AssignLabModal.jsx';

const LabRunnerModal = lazy(() => import('../../../components/labs/LabRunnerModal.jsx'));
const LiveLabSessionModal = lazy(() => import('../../../components/labs/LiveLabSessionModal.jsx'));

export default function LabsTab({ course, readOnly = false, onCourseChanged }) {
  const toast = useToast();
  const [configuring, setConfiguring] = useState(null); // { labId, existingConfig }
  const [previewLab, setPreviewLab] = useState(null);
  const [liveHostOpen, setLiveHostOpen] = useState(false);
  const [matrixOpen, setMatrixOpen] = useState(false);

  const { data: loaded, reload } = useLoad(async () => {
    const [freshCourse, assignments, enrolledRes] = await Promise.all([
      run(supabase.from('courses').select('*').eq('id', course.id).single()),
      run(supabase.from('assignments').select('id, title, max_marks, due_at, published, submissions(count)').eq('course_id', course.id)),
      supabase.from('enrollments').select('index_no', { count: 'exact', head: true }).eq('course_id', course.id).catch(() => ({ count: 0 })),
    ]);
    const assignList = assignments || [];
    const labIdsInMeta = new Set((parseCourseMeta(freshCourse).labs_config || []).map((l) => l.linkedAssignmentId).filter(Boolean));
    const linkedIds = assignList.map((a) => a.id).filter((id) => labIdsInMeta.has(id));
    let labSubmissions = [];
    if (linkedIds.length) {
      labSubmissions = await run(
        supabase.from('submissions').select('assignment_id, marks, marked').in('assignment_id', linkedIds),
      ).catch(() => []);
    }
    return {
      freshCourse,
      assignments: assignList,
      labSubmissions: labSubmissions || [],
      enrolledCount: enrolledRes?.count || 0,
    };
  }, [course.id]);

  const activeCourse = loaded?.freshCourse || course;
  const meta = useMemo(() => parseCourseMeta(activeCourse), [activeCourse]);
  const courseLabs = meta.labs_config || [];
  const assignById = useMemo(
    () => new Map((loaded?.assignments || []).map((a) => [a.id, a])),
    [loaded?.assignments],
  );

  const openIds = new Set(courseLabs.map((l) => l.labId));
  const unopenedLabs = LAB_CATALOG.filter((l) => !openIds.has(l.id));

  const masteryMatrix = useMemo(
    () =>
      buildCourseCloMasteryMatrix({
        course: activeCourse,
        courseLabs,
        assignments: loaded?.assignments || [],
        submissions: loaded?.labSubmissions || [],
        enrolledCount: loaded?.enrolledCount || 0,
        getLabDefFn: getLabDef,
      }),
    [activeCourse, courseLabs, loaded?.assignments, loaded?.labSubmissions, loaded?.enrolledCount],
  );

  function exportAccreditationPdf() {
    const doc = buildAccreditationEvidenceText(masteryMatrix);
    const blob = buildTypedResponsePdfBlob({
      title: doc.title,
      studentLine: `${activeCourse?.code || 'Course'} · Accreditation & CLO Assurance Evidence`,
      submittedAt: new Date().toLocaleDateString(),
      body: doc.body,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(activeCourse?.code || 'course').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-clo-mastery-evidence.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Downloaded CLO Mastery & Accreditation Evidence PDF.');
  }

  async function exportAccreditationExcel() {
    try {
      const sheets = buildAccreditationWorkbookSheets(masteryMatrix);
      await downloadWorkbook(
        `${(activeCourse?.code || 'course').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-clo-mastery-matrix.xlsx`,
        sheets,
      );
      toast('Downloaded CLO Mastery Accreditation Workbook (.xlsx).');
    } catch (e) {
      toast(e?.message || 'Could not export Excel matrix.', 'error');
    }
  }

  async function copyCloudSyncSql() {
    try {
      await navigator.clipboard.writeText(LAB_CLOUD_SYNC_SQL);
      toast('Copied Cloud Draft & Crash-Proof Live Session SQL! Paste and Run once in Supabase SQL Editor.');
    } catch {
      toast('Could not copy SQL automatically.', 'error');
    }
  }

  async function toggleEnabled(labCfg) {
    if (readOnly) return;
    try {
      const nextLabs = courseLabs.map((l) => (l.labId === labCfg.labId ? { ...l, enabled: !l.enabled } : l));
      const serialized = serializeCourseMeta(meta.about, meta.ca_config, meta.exam_config, meta.course_info, nextLabs, meta.lab_datasets);
      await run(supabase.from('courses').update({ description: serialized }).eq('id', course.id));
      toast(labCfg.enabled ? 'Lab hidden from students.' : 'Lab opened to students.');
      reload();
      onCourseChanged?.();
    } catch (e) {
      toast(e.message || 'Could not update lab status.', 'error');
    }
  }

  async function removeLab(labId) {
    if (readOnly) return;
    try {
      const nextLabs = courseLabs.filter((l) => l.labId !== labId);
      const serialized = serializeCourseMeta(meta.about, meta.ca_config, meta.exam_config, meta.course_info, nextLabs, meta.lab_datasets);
      await run(supabase.from('courses').update({ description: serialized }).eq('id', course.id));
      toast('Lab removed from this course.');
      reload();
      onCourseChanged?.();
    } catch (e) {
      toast(e.message || 'Could not remove lab.', 'error');
    }
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 960 }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Software Laboratories for {course.code}</h2>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            Choose which interactive labs students in this class can access, configure custom datasets, and link directly to graded assignments.
          </p>
        </div>
        {!readOnly && (
          <div className="row-wrap" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setLiveHostOpen(true)}
            >
              ● Host Live Classroom Session
            </button>
            <Link to="/teach/labs" className="btn btn-sm">
              <Icon name="flask" size={14} /> Open Full Labs Hub
            </Link>
          </div>
        )}
      </div>

      {/* Semester-Wide CLO Mastery & Accreditation Evidence Matrix */}
      {courseLabs.length > 0 && (
        <section className="card-soft stack-sm" style={{ padding: '12px 16px' }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div className="stack-xs" style={{ gap: 2 }}>
              <strong className="small">Course Lab Competency &amp; CLO Mastery Matrix</strong>
              <div className="tiny muted">
                {masteryMatrix.totalLabs} labs ({masteryMatrix.gradedLabs} graded)
                {masteryMatrix.overallAvgPct !== null ? ` · Cohort Mean ${masteryMatrix.overallAvgPct}%` : ' · Awaiting marked lab submissions'}
              </div>
            </div>
            <div className="row-wrap" style={{ gap: 6 }}>
              <button type="button" className="btn btn-sm" onClick={() => setMatrixOpen((v) => !v)}>
                {matrixOpen ? 'Hide Matrix' : 'View CLO Matrix'}
              </button>
              <button type="button" className="btn btn-sm" onClick={exportAccreditationPdf}>
                <Icon name="download" size={13} /> Evidence PDF
              </button>
              <button type="button" className="btn btn-sm" onClick={exportAccreditationExcel}>
                <Icon name="download" size={13} /> Excel (.xlsx)
              </button>
              {!readOnly && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={copyCloudSyncSql}
                  title="Optional 1-time Supabase SQL to enable cross-device student cloud drafts and crash-proof live sessions"
                >
                  Cloud Sync SQL
                </button>
              )}
            </div>
          </div>

          {matrixOpen && (
            <div className="stack-sm" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th>CLO / Outcome</th>
                      <th>Labs</th>
                      <th>Marked</th>
                      <th>Mean Score</th>
                      <th>Mastery (≥70%)</th>
                      <th>Needs Support (&lt;50%)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {masteryMatrix.cloSummary.map((row) => (
                      <tr key={row.key}>
                        <td><strong className="mono">{row.key}</strong></td>
                        <td className="mono">{row.labs}</td>
                        <td className="mono">{row.markedSubs}</td>
                        <td className="mono">{row.avgPct !== null ? `${row.avgPct}%` : '—'}</td>
                        <td className="mono" style={{ color: 'var(--teal-700)', fontWeight: 700 }}>
                          {row.masteryPct !== null ? `${row.masteryPct}%` : '—'}
                        </td>
                        <td className="mono" style={{ color: (row.supportPct || 0) > 25 ? 'var(--red)' : 'var(--muted)' }}>
                          {row.supportPct !== null ? `${row.supportPct}%` : '—'}
                        </td>
                        <td>{row.band}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Currently Assigned Labs */}
      {courseLabs.length === 0 ? (
        <div className="card">
          <Empty icon="flask" title="No labs opened for this class yet">
            Pick any laboratory module below to open it for {course.code} — either as a practice workbench or linked to a graded assignment.
          </Empty>
        </div>
      ) : (
        <div className="stack">
          {courseLabs.map((cfg) => {
            const def = getLabDef(cfg.labId);
            if (!def) return null;
            const linked = cfg.linkedAssignmentId ? assignById.get(cfg.linkedAssignmentId) : null;
            const subCount = linked?.submissions?.[0]?.count ?? 0;
            const policy = DATA_POLICIES.find((p) => p.id === cfg.dataMode)?.short || cfg.dataMode;

            return (
              <section key={cfg.labId} className="card stack-sm">
                <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div className="stack-xs" style={{ flex: 1, minWidth: 240 }}>
                    <div className="tiny muted">
                      {def.code} · {policy}
                      {cfg.customDataset?.name ? ` · Custom Dataset: ${cfg.customDataset.name}` : ''}
                      {' · '}
                      <strong style={{ color: cfg.enabled ? 'var(--teal-700)' : 'var(--muted)' }}>
                        {cfg.enabled ? '● OPEN TO STUDENTS' : 'HIDDEN'}
                      </strong>
                    </div>
                    <h3 style={{ margin: 0 }}>{cfg.title || def.title}</h3>
                    {cfg.instructions && <p className="small muted" style={{ margin: 0 }}>{cfg.instructions}</p>}
                    {linked ? (
                      <div className="small" style={{ marginTop: 4 }}>
                        Linked Assignment: <strong>{linked.title}</strong> ({linked.max_marks} marks · {subCount} submission{subCount === 1 ? '' : 's'})
                      </div>
                    ) : (
                      <div className="tiny muted" style={{ marginTop: 4 }}>Practice mode (ungraded)</div>
                    )}
                  </div>

                  <div className="row-wrap" style={{ gap: 8 }}>
                    <button type="button" className="btn btn-sm" onClick={() => setPreviewLab(cfg)}>
                      <Icon name="play" size={14} /> Preview
                    </button>
                    {linked && (
                      <Link to={`/teach/assignment/${linked.id}`} className="btn btn-primary btn-sm">
                        Mark Submissions ({subCount})
                      </Link>
                    )}
                    {!readOnly && (
                      <>
                        <button type="button" className="btn btn-sm" onClick={() => setConfiguring({ labId: cfg.labId, existingConfig: cfg })}>
                          Configure
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => toggleEnabled(cfg)}>
                          {cfg.enabled ? 'Hide' : 'Open'}
                        </button>
                        <button type="button" className="icon-btn plain" aria-label="Remove lab" onClick={() => removeLab(cfg.labId)}>
                          <Icon name="trash" size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Available Modules to Add to This Class */}
      {!readOnly && unopenedLabs.length > 0 && (
        <section className="stack-sm">
          <h3 style={{ margin: 0, fontSize: 15 }}>Available Modules You Can Open for {course.code}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {unopenedLabs.map((lab) => (
              <div key={lab.id} className="card-soft stack-sm" style={{ padding: 14, justifyContent: 'space-between' }}>
                <div className="stack-xs">
                  <div className="tiny mono muted">{lab.code} · {lab.domain}</div>
                  <strong style={{ fontSize: 15, lineHeight: 1.3 }}>{lab.title}</strong>
                  <p className="tiny muted" style={{ margin: 0, lineHeight: 1.4 }}>{lab.summary}</p>
                </div>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setConfiguring({ labId: lab.id, existingConfig: null })}
                  >
                    <Icon name="plus" size={14} /> Open for {course.code}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setPreviewLab({ labId: lab.id, title: lab.title, dataMode: 'both', presetId: lab.defaultPresetId })}
                  >
                    Preview
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {configuring && (
        <AssignLabModal
          labId={configuring.labId}
          lockedCourse={activeCourse}
          existingConfig={configuring.existingConfig}
          onSaved={() => {
            reload();
            onCourseChanged?.();
          }}
          onClose={() => setConfiguring(null)}
        />
      )}

      {liveHostOpen && (
        <Suspense fallback={<Loading label="Starting live classroom session…" />}>
          <LiveLabSessionModal
            isHost
            initialLabId="psis_seven_names"
            courseId={course?.id || null}
            courseCode={course?.code || ''}
            onClose={() => setLiveHostOpen(false)}
          />
        </Suspense>
      )}

      {previewLab && (
        <Suspense fallback={<Loading label="Opening laboratory…" />}>
          <LabRunnerModal
            labConfig={previewLab}
            course={activeCourse}
            previewOnly
            onClose={() => setPreviewLab(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
