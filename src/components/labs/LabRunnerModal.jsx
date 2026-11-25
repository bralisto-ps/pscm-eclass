import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { Loading, useToast } from '../ui.jsx';
import { DATA_POLICIES, getLabDef, submitLabReportToAssignment } from '../../lib/labsCatalog.js';
import { buildTypedResponsePdfBlob } from '../../lib/textPdf.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtDateTime } from '../../lib/format.js';
import { formatAutoScoredSubmissionHeader } from '../../lib/psisMilestone4Engine.js';
import { LAB_CONCEPT_GUIDES, LAB_TRACK_META } from '../../lib/labScoringBridge.js';

const SpcLab = lazy(() => import('./SpcLab.jsx'));
const QualityToolsLab = lazy(() => import('./QualityToolsLab.jsx'));
const CostOfQualityLab = lazy(() => import('./CostOfQualityLab.jsx'));
const SevenNamesLab = lazy(() => import('./SevenNamesLab.jsx'));
const ScanItLab = lazy(() => import('./ScanItLab.jsx'));
const TheMatchLab = lazy(() => import('./TheMatchLab.jsx'));
const TheWhipLab = lazy(() => import('./TheWhipLab.jsx'));
const ReqToOrderLab = lazy(() => import('./ReqToOrderLab.jsx'));
const TheTenderLab = lazy(() => import('./TheTenderLab.jsx'));
const InventoryWmsLab = lazy(() => import('./InventoryWmsLab.jsx'));
const SpendAnalyticsLab = lazy(() => import('./SpendAnalyticsLab.jsx'));

export default function LabRunnerModal({
  labConfig,
  course = null,
  assignment = null,
  previewOnly = false,
  onSubmitted = null,
  onClose,
}) {
  const { session, profile } = useAuth();
  const toast = useToast();
  const def = getLabDef(labConfig?.labId);
  const reportBuilderRef = useRef(null);

  const storageKey = `pscm_lab_draft:${course?.id || 'sandbox'}:${labConfig?.id || labConfig?.labId}:${session?.user?.id || 'guest'}`;

  const [draftState] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [submitting, setSubmitting] = useState(false);
  const [submitDone, setSubmitDone] = useState(false);
  const [judgementReady, setJudgementReady] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(Boolean(draftState));
  const [guideOpen, setGuideOpen] = useState(false);

  const handleDraftChange = useCallback((next) => {
    setHasInteracted(true);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }, [storageKey]);

  const registerBuilder = useCallback((fn) => {
    reportBuilderRef.current = fn;
    try {
      const probe = fn?.();
      if (probe) setJudgementReady(Boolean(probe.hasJudgement));
    } catch {
      // ignore
    }
  }, []);

  if (!def) return null;
  const trackMeta = LAB_TRACK_META[def.id] || { track: def.domain, accent: 'var(--teal-700)', stage: 'Interactive Lab' };
  const conceptGuide = LAB_CONCEPT_GUIDES[def.id] || null;

  const dataMode = labConfig?.dataMode || 'both';
  const policyLabel = DATA_POLICIES.find((p) => p.id === dataMode)?.short || 'Course or own data';
  const existingSub = assignment?.submission || null;
  const dueAt = assignment?.due_at || null;
  const overdue = dueAt && new Date(dueAt).getTime() < Date.now();
  const canSubmit = Boolean(assignment && !previewOnly && (!overdue || assignment.allow_late) && !(existingSub && existingSub.marked));

  function downloadPdfReport() {
    const built = reportBuilderRef.current?.();
    if (!built) return;
    const studentLine = [profile?.full_name, profile?.index_no ? `(${profile.index_no})` : ''].filter(Boolean).join(' ');
    const blob = buildTypedResponsePdfBlob({
      title: built.title,
      studentLine: studentLine || 'Interactive Lab Report',
      submittedAt: new Date().toLocaleString(),
      body: formatAutoScoredSubmissionHeader({
        labCode: def.code,
        labTitle: labConfig?.title || def.title,
        body: built.body,
        hasJudgement: built.hasJudgement,
      }),
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${def.id}-report.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleSubmitToAssignment() {
    const built = reportBuilderRef.current?.();
    if (!built) return;
    if (!built.hasJudgement) {
      toast('Please write your managerial judgement (at least a short paragraph) before submitting to your assignment.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitLabReportToAssignment({
        assignment,
        profile,
        session,
        reportTitle: built.title,
        reportBody: formatAutoScoredSubmissionHeader({
          labCode: def.code,
          labTitle: labConfig?.title || def.title,
          body: built.body,
          hasJudgement: built.hasJudgement,
        }),
        note: `Submitted from ${def.shortTitle} Lab`,
      });
      setSubmitDone(true);
      toast(
        res.groupName
          ? `Lab report submitted for ${res.groupName} and queued for marking.`
          : 'Lab report submitted to your assignment and queued for marking.',
      );
      onSubmitted?.();
    } catch (e) {
      toast(e.message || 'Could not submit lab report.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function resetDraft() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    onClose?.();
    toast('Local lab draft cleared. Reopen the lab to start fresh.');
  }

  return (
    <div
      className="modal-bg"
      role="dialog"
      aria-modal="true"
      aria-label={labConfig?.title || def.title}
      style={{ alignItems: 'stretch', padding: '12px', zIndex: 120 }}
    >
      <div
        className="modal"
        style={{
          width: '100%',
          maxWidth: 1240,
          maxHeight: 'calc(100vh - 24px)',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          borderTop: `4px solid ${trackMeta.accent}`,
        }}
      >
        {/* Clean Sticky Lab Header */}
        <div
          className="between"
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--surface)',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="tiny muted">
              <strong className="mono" style={{ color: trackMeta.accent }}>{def.code}</strong> · {trackMeta.track} · {trackMeta.stage}
              {course ? ` · ${course.code}` : ' · Sandbox Preview'}
              {' · '}
              {policyLabel}
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: 18 }}>
              {labConfig?.title || def.title}
            </h2>
          </div>

          <div className="row-wrap" style={{ gap: 8 }}>
            {conceptGuide && (
              <button
                type="button"
                className={`btn btn-sm ${guideOpen ? 'btn-primary' : ''}`}
                onClick={() => setGuideOpen((v) => !v)}
              >
                <Icon name="book" size={14} /> {guideOpen ? 'Hide Guide' : 'Formula & Concept Guide'}
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={downloadPdfReport}>
              <Icon name="download" size={14} /> Download PDF Report
            </button>
            <button type="button" className="btn btn-sm" onClick={resetDraft} title="Clear locally saved work for this lab">
              Reset Draft
            </button>
            <button type="button" className="icon-btn" aria-label="Close lab" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>

        {/* 4-Step Lab Workflow Stepper */}
        <div className="lab-stepper" aria-label="Lab completion steps">
          <div className="lab-step done">
            <span className="lab-step-num">✓</span>
            <span>1. Data Ready</span>
          </div>
          <div className={`lab-step ${hasInteracted ? 'done' : ''}`}>
            <span className="lab-step-num">{hasInteracted ? '✓' : '2'}</span>
            <span>2. Analysis &amp; Audit</span>
          </div>
          <div className={`lab-step ${judgementReady ? 'done' : ''}`}>
            <span className="lab-step-num">{judgementReady ? '✓' : '3'}</span>
            <span>3. Written Judgement</span>
          </div>
          <div className={`lab-step ${existingSub || submitDone ? 'done' : ''}`}>
            <span className="lab-step-num">{existingSub || submitDone ? '✓' : '4'}</span>
            <span>{assignment && !previewOnly ? '4. Submit to CA' : '4. Export PDF'}</span>
          </div>
        </div>

        {/* Collapsible Formula & Concept Quick-Reference Drawer */}
        {guideOpen && conceptGuide && (
          <div className="lab-concept-drawer stack-xs">
            <div className="between">
              <strong className="small">{conceptGuide.title}</strong>
              <button type="button" className="btn btn-sm" onClick={() => setGuideOpen(false)}>Close Guide</button>
            </div>
            <div className="lab-formula-grid">
              {conceptGuide.formulas.map((f, idx) => (
                <div key={idx} className="lab-formula-box">{f}</div>
              ))}
            </div>
            <div className="row-wrap tiny muted" style={{ gap: 12, marginTop: 4 }}>
              {conceptGuide.checklist.map((tip, idx) => (
                <span key={idx}>• {tip}</span>
              ))}
            </div>
          </div>
        )}

        {/* Assignment Context Strip (if linked to a graded assignment) */}
        {assignment && !previewOnly && (
          <div
            className="between small"
            style={{
              padding: '10px 20px',
              background: submitDone || existingSub ? 'var(--teal-50)' : 'var(--surface-2)',
              borderBottom: '1px solid var(--line)',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div>
              <strong>Graded Assignment:</strong> {assignment.title}
              <span className="muted" style={{ marginLeft: 8 }}>
                Max {assignment.max_marks} marks
                {dueAt ? ` · Due ${fmtDateTime(dueAt)}` : ''}
                {existingSub?.marked && (assignment.results_released || assignment.released)
                  ? ` · Marked: ${existingSub.marks}/${assignment.max_marks}`
                  : existingSub || submitDone
                    ? ' · Submitted (awaiting release)'
                    : ''}
              </span>
            </div>
            {canSubmit ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={submitting}
                onClick={handleSubmitToAssignment}
              >
                <Icon name="upload" size={14} />
                {submitting ? 'Submitting Report…' : existingSub || submitDone ? 'Resubmit Lab Report' : 'Submit Lab Report to Assignment'}
              </button>
            ) : existingSub?.marked ? (
              <span className="tiny mono" style={{ fontWeight: 600, color: 'var(--teal-700)' }}>● ALREADY MARKED</span>
            ) : overdue ? (
              <span className="tiny mono" style={{ fontWeight: 600, color: 'var(--red)' }}>▲ DEADLINE PASSED</span>
            ) : null}
          </div>
        )}

        {/* Main Scrollable Lab Workbench */}
        <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1, background: 'var(--ground)' }}>
          {labConfig?.instructions && (
            <div className="card-soft small" style={{ padding: '10px 14px', marginBottom: 14 }}>
              <strong>Lecturer Brief:</strong> {labConfig.instructions}
            </div>
          )}

          <Suspense fallback={<Loading label="Loading laboratory engine…" />}>
            {def.id === 'tqm_spc' && (
              <SpcLab
                config={labConfig}
                dataMode={dataMode}
                draftState={draftState}
                onDraftChange={handleDraftChange}
                onRegisterReportBuilder={registerBuilder}
              />
            )}
            {def.id === 'tqm_tools' && (
              <QualityToolsLab
                config={labConfig}
                dataMode={dataMode}
                draftState={draftState}
                onDraftChange={handleDraftChange}
                onRegisterReportBuilder={registerBuilder}
              />
            )}
            {def.id === 'tqm_coq' && (
              <CostOfQualityLab
                config={labConfig}
                dataMode={dataMode}
                draftState={draftState}
                onDraftChange={handleDraftChange}
                onRegisterReportBuilder={registerBuilder}
              />
            )}
            {def.id === 'psis_seven_names' && (
              <SevenNamesLab
                config={labConfig}
                dataMode={dataMode}
                draftState={draftState}
                onDraftChange={handleDraftChange}
                onRegisterReportBuilder={registerBuilder}
              />
            )}
            {def.id === 'psis_scan_it' && (
              <ScanItLab
                config={labConfig}
                dataMode={dataMode}
                draftState={draftState}
                onDraftChange={handleDraftChange}
                onRegisterReportBuilder={registerBuilder}
              />
            )}
            {def.id === 'psis_the_match' && (
              <TheMatchLab
                config={labConfig}
                dataMode={dataMode}
                draftState={draftState}
                onDraftChange={handleDraftChange}
                onRegisterReportBuilder={registerBuilder}
              />
            )}
            {def.id === 'psis_the_whip' && (
              <TheWhipLab
                config={labConfig}
                dataMode={dataMode}
                draftState={draftState}
                onDraftChange={handleDraftChange}
                onRegisterReportBuilder={registerBuilder}
              />
            )}
            {def.id === 'psis_req_to_order' && (
              <ReqToOrderLab
                config={labConfig}
                dataMode={dataMode}
                draftState={draftState}
                onDraftChange={handleDraftChange}
                onRegisterReportBuilder={registerBuilder}
              />
            )}
            {def.id === 'psis_the_tender' && (
              <TheTenderLab
                config={labConfig}
                dataMode={dataMode}
                draftState={draftState}
                onDraftChange={handleDraftChange}
                onRegisterReportBuilder={registerBuilder}
              />
            )}
            {def.id === 'psis_inventory_wms' && (
              <InventoryWmsLab
                config={labConfig}
                dataMode={dataMode}
                draftState={draftState}
                onDraftChange={handleDraftChange}
                onRegisterReportBuilder={registerBuilder}
              />
            )}
            {def.id === 'psis_spend_analytics' && (
              <SpendAnalyticsLab
                config={labConfig}
                dataMode={dataMode}
                draftState={draftState}
                onDraftChange={handleDraftChange}
                onRegisterReportBuilder={registerBuilder}
              />
            )}
          </Suspense>
        </div>

        {/* Bottom Action Bar for Mobile Convenience */}
        {assignment && !previewOnly && canSubmit && (
          <div
            className="between"
            style={{
              padding: '10px 20px',
              borderTop: '1px solid var(--line)',
              background: 'var(--surface)',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div className="row-wrap" style={{ gap: 10 }}>
              <span
                className="tiny mono"
                style={{ fontWeight: 700, color: judgementReady ? 'var(--teal-700)' : 'var(--amber)' }}
              >
                {judgementReady
                  ? '● AUTO-SCORED VERIFICATION HEADER READY'
                  : '▲ COMPLETE WRITTEN MANAGERIAL JUDGEMENT BEFORE SUBMITTING'}
              </span>
              <span className="tiny muted">
                Auto-saved locally · Generates PDF + structured marking summary
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={submitting}
              onClick={handleSubmitToAssignment}
            >
              <Icon name="check" size={14} />
              {submitting ? 'Submitting…' : existingSub || submitDone ? 'Resubmit to Assignment' : 'Submit Lab Report'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
