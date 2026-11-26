import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { Loading, useToast } from '../ui.jsx';
import { DATA_POLICIES, getLabDef, getLabPreset, submitLabReportToAssignment } from '../../lib/labsCatalog.js';
import { buildTypedResponsePdfBlob } from '../../lib/textPdf.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtDateTime } from '../../lib/format.js';
import { findStudentSyndicate, parseAssignmentMeta } from '../../lib/assignmentMeta.js';
import { supabase } from '../../lib/supabase.js';
import { downloadText } from '../../lib/sheets.js';
import { formatAutoScoredSubmissionHeader } from '../../lib/psisMilestone4Engine.js';
import { LAB_CONCEPT_GUIDES, LAB_TRACK_META } from '../../lib/labScoringBridge.js';
import { generateUniqueLabVariant } from '../../lib/labMilestone6Engine.js';
import {
  buildCarryForwardPayload,
  extractCarryForwardImport,
  getCarryForwardTargets,
} from '../../lib/labMilestone7Engine.js';
import {
  clearPendingLabSubmission,
  getPendingLabSubmission,
  savePendingLabSubmission,
} from '../../lib/labMilestone8Engine.js';

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
const LandedCostLab = lazy(() => import('./LandedCostLab.jsx'));
const ContractSlaLab = lazy(() => import('./ContractSlaLab.jsx'));
const GreenProcurementLab = lazy(() => import('./GreenProcurementLab.jsx'));

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
  const importDraftRef = useRef(null);

  const assignMeta = useMemo(
    () => (assignment ? parseAssignmentMeta(assignment) : null),
    [assignment],
  );
  const mySyndicate = useMemo(
    () => (assignMeta && !previewOnly ? findStudentSyndicate(assignMeta, profile?.index_no) : null),
    [assignMeta, previewOnly, profile?.index_no],
  );

  // Anti-Copying deterministic unique dataset variant per Student or Syndicate Group
  const uniqueVariantResult = useMemo(() => {
    if (!def || !labConfig?.uniqueVariant) return null;
    if (labConfig?.customDataset || labConfig?.dataMode === 'student_only') return null;
    const basePreset = getLabPreset(def.id, labConfig?.presetId);
    const seedKey = mySyndicate
      ? `${assignment?.id || course?.id || 'c'}:${mySyndicate.id || mySyndicate.name}`
      : `${assignment?.id || course?.id || 'c'}:${profile?.index_no || session?.user?.id || 'preview'}`;
    return generateUniqueLabVariant({ labId: def.id, basePreset, seedKey });
  }, [def, labConfig, mySyndicate, assignment?.id, course?.id, profile?.index_no, session?.user?.id]);

  // End-to-end Supply Chain "Carry Forward" handoff state (scoped per course)
  const handoffKey = `pscm_lab_handoff:${course?.id || 'sandbox'}`;
  const [carriedImport, setCarriedImport] = useState(null);
  const availableUpstream = useMemo(() => {
    if (!def?.id) return null;
    try {
      const raw = localStorage.getItem(handoffKey);
      if (!raw) return null;
      const store = JSON.parse(raw);
      const list = Array.isArray(store) ? store : [store];
      for (const item of list) {
        const extracted = extractCarryForwardImport(def.id, item);
        if (extracted) return extracted;
      }
      return null;
    } catch {
      return null;
    }
  }, [def?.id, handoffKey]);
  const carryTargets = useMemo(() => getCarryForwardTargets(def?.id), [def?.id]);

  // Confidential Syndicate Peer Contribution Rating state (1–5 per teammate)
  const peerCheckActive = Boolean(mySyndicate && !previewOnly && assignMeta?.syndicate?.peerCheck !== false && (mySyndicate.members || []).length > 1);
  const [peerPanelOpen, setPeerPanelOpen] = useState(false);
  const [peerScores, setPeerScores] = useState(() => {
    const init = {};
    (mySyndicate?.members || []).forEach((idx) => {
      init[String(idx)] = { score: 5, note: '' };
    });
    return init;
  });

  const effectiveLabConfig = useMemo(() => {
    if (carriedImport?.dataset) {
      return {
        ...labConfig,
        customDataset: carriedImport.dataset,
      };
    }
    if (!uniqueVariantResult?.customDataset) return labConfig;
    return {
      ...labConfig,
      customDataset: uniqueVariantResult.customDataset,
    };
  }, [labConfig, uniqueVariantResult, carriedImport]);

  const storageKey = `pscm_lab_draft:${course?.id || 'sandbox'}:${labConfig?.id || labConfig?.labId}:${mySyndicate ? `syn_${mySyndicate.id || mySyndicate.name}` : (session?.user?.id || 'guest')}${uniqueVariantResult ? `:${uniqueVariantResult.variantTag}` : ''}`;

  const [draftState, setDraftState] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [syncVersion, setSyncVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [pendingOfflineSub, setPendingOfflineSub] = useState(() =>
    assignment?.id && session?.user?.id
      ? getPendingLabSubmission(typeof localStorage !== 'undefined' ? localStorage : null, assignment.id, session.user.id)
      : null,
  );
  const [isOffline, setIsOffline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine === false : false));
  const [submitDone, setSubmitDone] = useState(false);
  const [judgementReady, setJudgementReady] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(Boolean(draftState));
  const [guideOpen, setGuideOpen] = useState(false);

  // Syndicate Live Teammate Sync (Supabase Realtime Broadcast + Presence — zero SQL)
  const [synSyncOn, setSynSyncOn] = useState(false);
  const [onlineTeammates, setOnlineTeammates] = useState([]);
  const synChannelRef = useRef(null);
  const latestDraftRef = useRef(draftState);
  const broadcastTimerRef = useRef(null);
  const suppressNextBroadcastRef = useRef(false);
  const clientKeyRef = useRef(`m_${session?.user?.id?.slice(0, 8) || Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    if (!synSyncOn || !mySyndicate || !assignment?.id) return undefined;
    let alive = true;
    const topic = `syndicate-lab:${assignment.id}:${String(mySyndicate.id || mySyndicate.name).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    let ch = null;

    async function connect() {
      try {
        const existing = supabase.getChannels?.().find((c) => c.topic === `realtime:${topic}` || c.topic === topic);
        if (existing) await supabase.removeChannel(existing).catch(() => {});
        if (!alive) return;

        ch = supabase.channel(topic, {
          config: {
            broadcast: { self: false },
            presence: { key: clientKeyRef.current },
          },
        });
        synChannelRef.current = ch;

        ch.on('broadcast', { event: 'draft_patch' }, ({ payload }) => {
          if (!payload || payload.sender === clientKeyRef.current || !payload.draft) return;
          const incomingStr = JSON.stringify(payload.draft);
          const currentStr = JSON.stringify(latestDraftRef.current || {});
          if (incomingStr === currentStr) return;
          suppressNextBroadcastRef.current = true;
          latestDraftRef.current = payload.draft;
          try {
            localStorage.setItem(storageKey, incomingStr);
          } catch {
            // ignore
          }
          setDraftState(payload.draft);
          setSyncVersion((v) => v + 1);
          toast(`Synced live update from ${payload.fromName || 'teammate'}.`);
        });

        ch.on('presence', { event: 'sync' }, () => {
          if (!ch) return;
          const pState = ch.presenceState() || {};
          const mates = [];
          Object.entries(pState).forEach(([k, metas]) => {
            const m = Array.isArray(metas) ? metas[0] : metas;
            if (m) mates.push({ key: k, name: m.name || 'Teammate' });
          });
          setOnlineTeammates(mates);
        });

        ch.subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && alive && ch) {
            await ch.track({
              name: profile?.full_name || profile?.index_no || 'Teammate',
              at: Date.now(),
            }).catch(() => {});
          }
        });
      } catch {
        toast('Could not connect Syndicate Live Sync.', 'error');
      }
    }

    connect();
    return () => {
      alive = false;
      if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
      if (ch) supabase.removeChannel(ch).catch(() => {});
      synChannelRef.current = null;
      setOnlineTeammates([]);
    };
  }, [synSyncOn, mySyndicate, assignment?.id, storageKey, profile?.full_name, profile?.index_no]);

  const handleDraftChange = useCallback((next) => {
    setHasInteracted(true);
    latestDraftRef.current = next;
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      return;
    }
    if (synSyncOn && synChannelRef.current) {
      if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
      broadcastTimerRef.current = setTimeout(() => {
        synChannelRef.current?.send({
          type: 'broadcast',
          event: 'draft_patch',
          payload: {
            sender: clientKeyRef.current,
            fromName: profile?.full_name || profile?.index_no || 'Teammate',
            draft: next,
          },
        }).catch(() => {});
      }, 650);
    }
  }, [storageKey, synSyncOn, profile?.full_name, profile?.index_no]);

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

  function wrapReportBody(built) {
    const variantPrefix = uniqueVariantResult
      ? `Dataset Variant ID: ${uniqueVariantResult.variantTag}${mySyndicate ? ` (${mySyndicate.name})` : ''}\n`
      : '';
    return formatAutoScoredSubmissionHeader({
      labCode: def.code,
      labTitle: labConfig?.title || def.title,
      body: variantPrefix + built.body,
      hasJudgement: built.hasJudgement,
    });
  }

  function downloadPdfReport() {
    const built = reportBuilderRef.current?.();
    if (!built) return;
    const studentLine = [
      profile?.full_name,
      profile?.index_no ? `(${profile.index_no})` : '',
      mySyndicate ? `· ${mySyndicate.name}` : '',
    ].filter(Boolean).join(' ');
    const blob = buildTypedResponsePdfBlob({
      title: built.title,
      studentLine: studentLine || 'Interactive Lab Report',
      submittedAt: new Date().toLocaleString(),
      body: wrapReportBody(built),
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

  function exportDraftJson() {
    const payload = {
      labId: def.id,
      variantTag: uniqueVariantResult?.variantTag || null,
      syndicate: mySyndicate?.name || null,
      exportedAt: new Date().toISOString(),
      draft: latestDraftRef.current || draftState || {},
    };
    downloadText(`${def.id}-syndicate-draft.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('Downloaded shareable draft JSON for your syndicate teammates.');
  }

  async function importDraftJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.labId && parsed.labId !== def.id) {
        throw new Error(`This draft file belongs to another lab (${parsed.labId}).`);
      }
      if (!parsed.draft || typeof parsed.draft !== 'object') {
        throw new Error('Invalid draft JSON file.');
      }
      latestDraftRef.current = parsed.draft;
      localStorage.setItem(storageKey, JSON.stringify(parsed.draft));
      setDraftState(parsed.draft);
      setSyncVersion((v) => v + 1);
      toast('Loaded teammate lab draft cleanly!');
    } catch (err) {
      toast(err?.message || 'Could not import draft file.', 'error');
    } finally {
      e.target.value = '';
    }
  }

  async function flushSubmissionPayload(payload) {
    setSubmitting(true);
    try {
      const res = await submitLabReportToAssignment({
        assignment,
        profile,
        session,
        reportTitle: payload.reportTitle,
        reportBody: payload.reportBody,
        note: payload.note,
        extraTypingMeta: payload.extraTypingMeta,
      });
      clearPendingLabSubmission(typeof localStorage !== 'undefined' ? localStorage : null, assignment?.id, session?.user?.id);
      setPendingOfflineSub(null);
      setSubmitDone(true);
      toast(
        res.groupName
          ? `Lab report submitted for ${res.groupName} and queued for marking.`
          : 'Lab report submitted to your assignment and queued for marking.',
      );
      onSubmitted?.();
    } catch (e) {
      const offlineErr = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        /fetch|network|offline|timeout|failed to fetch|connection/i.test(String(e?.message || ''));
      if (offlineErr && assignment?.id && session?.user?.id) {
        const queued = { ...payload, lastError: String(e?.message || 'Network unavailable') };
        savePendingLabSubmission(typeof localStorage !== 'undefined' ? localStorage : null, assignment.id, session.user.id, queued);
        setPendingOfflineSub({ ...queued, queuedAt: new Date().toISOString() });
        toast('Connection dropped — your complete lab report is safely saved offline and will auto-retry once internet returns!');
      } else {
        toast(e.message || 'Could not submit lab report.', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    const onOffline = () => setIsOffline(true);
    const onOnline = () => {
      setIsOffline(false);
      if (assignment?.id && session?.user?.id) {
        const queued = getPendingLabSubmission(typeof localStorage !== 'undefined' ? localStorage : null, assignment.id, session.user.id);
        if (queued) {
          toast('Internet restored — automatically retrying your saved offline lab submission…');
          flushSubmissionPayload(queued);
        }
      }
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [assignment?.id, session?.user?.id]);

  async function handleSubmitToAssignment() {
    const built = reportBuilderRef.current?.();
    if (!built) return;
    if (!built.hasJudgement) {
      toast('Please write your managerial judgement (at least a short paragraph) before submitting to your assignment.', 'error');
      return;
    }
    const peerRatingsPayload = peerCheckActive
      ? (mySyndicate?.members || [])
          .filter((idx) => String(idx).toUpperCase() !== String(profile?.index_no || '').toUpperCase())
          .map((idx) => ({
            indexNo: String(idx),
            score: Number(peerScores[String(idx)]?.score || 5),
            note: String(peerScores[String(idx)]?.note || '').trim(),
          }))
      : [];
    const payload = {
      reportTitle: built.title,
      reportBody: wrapReportBody(built),
      note: `Submitted from ${def.shortTitle} Lab${uniqueVariantResult ? ` (${uniqueVariantResult.variantTag})` : ''}`,
      extraTypingMeta: {
        labId: def.id,
        variantTag: uniqueVariantResult?.variantTag || null,
        syndicateName: mySyndicate?.name || null,
        ...(peerRatingsPayload.length ? { syndicatePeerRatings: peerRatingsPayload } : {}),
      },
    };
    await flushSubmissionPayload(payload);
  }

  function saveCarryForward() {
    const activeDs = effectiveLabConfig?.customDataset || getLabPreset(def.id, effectiveLabConfig?.presetId) || {};
    const payload = buildCarryForwardPayload(def.id, latestDraftRef.current || draftState || {}, activeDs);
    if (!payload) {
      toast('Complete or load records in this lab first before carrying forward.', 'error');
      return;
    }
    try {
      const prevRaw = localStorage.getItem(handoffKey);
      const prevList = prevRaw ? JSON.parse(prevRaw) : [];
      const arr = Array.isArray(prevList) ? prevList.filter((x) => x?.sourceLabId !== def.id) : [];
      arr.unshift(payload);
      localStorage.setItem(handoffKey, JSON.stringify(arr.slice(0, 6)));
      const targetsText = carryTargets.map((t) => t.label.split('→')[1]?.trim() || t.targetLabId).join(' or ');
      toast(`Saved ${payload.itemCount} records for Carry Forward! Open ${targetsText} to import them.`);
    } catch {
      toast('Could not save carry-forward handoff locally.', 'error');
    }
  }

  function applyUpstreamCarryForward() {
    if (!availableUpstream) return;
    setCarriedImport(availableUpstream);
    setDraftState(null);
    latestDraftRef.current = null;
    setSyncVersion((v) => v + 1);
    toast(`Loaded carried-forward data from ${availableUpstream.sourceLabel}!`);
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

  const labProps = {
    config: effectiveLabConfig,
    dataMode,
    draftState,
    onDraftChange: handleDraftChange,
    onRegisterReportBuilder: registerBuilder,
  };

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
              {uniqueVariantResult && (
                <span className="mono" style={{ marginLeft: 8, color: 'var(--teal-700)', fontWeight: 700 }}>
                  ● UNIQUE VARIANT {uniqueVariantResult.variantTag}
                </span>
              )}
              {Array.isArray(labConfig?.mappedClos) && labConfig.mappedClos.length > 0 && (
                <span className="mono" style={{ marginLeft: 8, color: '#1d4ed8', fontWeight: 700 }}>
                  · {labConfig.mappedClos.join(' · ')}
                </span>
              )}
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
            {carryTargets.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={saveCarryForward}
                title={carryTargets.map((t) => t.label).join(' | ')}
              >
                <Icon name="arrow" size={14} /> Carry Forward → Next Lab
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
            {canSubmit && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={submitting}
                onClick={handleSubmitToAssignment}
              >
                <Icon name="check" size={14} />
                {submitting ? 'Submitting…' : existingSub || submitDone ? 'Resubmit to Assignment' : 'Submit Lab Report'}
              </button>
            )}
          </div>
        )}

        {/* Syndicate Collaboration & Live Teammate Sync Strip */}
        {mySyndicate && !previewOnly && (
          <div
            className="between small"
            style={{
              padding: '9px 20px',
              background: 'var(--teal-50)',
              borderBottom: '1px solid var(--line)',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div className="row-wrap" style={{ gap: 8 }}>
              <strong className="mono tiny" style={{ color: 'var(--teal-700)' }}>
                ● SYNDICATE: {mySyndicate.name.toUpperCase()} ({(mySyndicate.members || []).length} MEMBERS)
              </strong>
              <span className="tiny muted">
                One submission credits every member in your syndicate.
              </span>
              {synSyncOn && (
                <span className="tiny mono" style={{ color: 'var(--teal-700)', fontWeight: 700 }}>
                  · {onlineTeammates.length} teammate{onlineTeammates.length === 1 ? '' : 's'} connected live
                </span>
              )}
            </div>
            <div className="row-wrap" style={{ gap: 6 }}>
              <button
                type="button"
                className={`btn btn-sm ${synSyncOn ? 'btn-primary' : ''}`}
                onClick={() => {
                  setSynSyncOn((v) => !v);
                  toast(synSyncOn ? 'Syndicate Live Sync turned off.' : 'Syndicate Live Sync active — edits sync across teammates in real time!');
                }}
              >
                <Icon name="users" size={13} /> {synSyncOn ? '● Live Teammate Sync ON' : 'Enable Live Teammate Sync'}
              </button>
              <button type="button" className="btn btn-sm" onClick={exportDraftJson} title="Download draft JSON to share on WhatsApp/offline">
                <Icon name="download" size={13} /> Share Draft
              </button>
              <input ref={importDraftRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={importDraftJson} />
              <button type="button" className="btn btn-sm" onClick={() => importDraftRef.current?.click()}>
                <Icon name="upload" size={13} /> Load Draft
              </button>
            </div>
          </div>
        )}

        {/* End-to-End Supply Chain Carry-Forward Banner (Upstream -> Downstream) */}
        {availableUpstream && !carriedImport && (
          <div
            className="between small"
            style={{
              padding: '8px 20px',
              background: '#eff6ff',
              borderBottom: '1px solid #bfdbfe',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div>
              <strong style={{ color: '#1e3a8a' }}>Supply Chain Carry-Forward Ready:</strong>{' '}
              <span className="muted">Import your output directly from {availableUpstream.sourceLabel} ({availableUpstream.dataset?.name}).</span>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={applyUpstreamCarryForward}>
              Load Upstream Lab Data
            </button>
          </div>
        )}
        {carriedImport && (
          <div
            className="between small"
            style={{
              padding: '8px 20px',
              background: 'var(--teal-50)',
              borderBottom: '1px solid var(--line)',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div className="tiny">
              <strong style={{ color: 'var(--teal-700)' }}>● USING CARRIED-FORWARD DATA:</strong> {carriedImport.dataset?.name} (from {carriedImport.sourceLabel})
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setCarriedImport(null);
                setSyncVersion((v) => v + 1);
                toast('Switched back to default lab dataset.');
              }}
            >
              Revert to Default Dataset
            </button>
          </div>
        )}

        {/* Confidential Syndicate Peer Contribution Check Drawer */}
        {peerCheckActive && (
          <div style={{ padding: '8px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
            <div className="between" style={{ gap: 10, flexWrap: 'wrap' }}>
              <span className="tiny">
                <strong>Confidential Syndicate Peer Contribution Check:</strong> Rate your teammates’ contribution (1–5) before submitting so marks stay fair.
              </span>
              <button
                type="button"
                className={peerPanelOpen ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                onClick={() => setPeerPanelOpen((v) => !v)}
              >
                {peerPanelOpen ? 'Hide Peer Ratings' : 'Rate Teammates (Confidential)'}
              </button>
            </div>
            {peerPanelOpen && (
              <div className="stack-xs" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
                {(mySyndicate.members || [])
                  .filter((idx) => String(idx).toUpperCase() !== String(profile?.index_no || '').toUpperCase())
                  .map((idx) => {
                    const key = String(idx);
                    const cur = peerScores[key] || { score: 5, note: '' };
                    return (
                      <div
                        key={key}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(110px, 0.8fr) auto 1.5fr',
                          gap: 8,
                          alignItems: 'center',
                        }}
                      >
                        <strong className="mono tiny">{key}</strong>
                        <select
                          className="input"
                          style={{ width: 'auto', minHeight: 34 }}
                          value={cur.score}
                          onChange={(e) => setPeerScores((prev) => ({
                            ...prev,
                            [key]: { ...cur, score: Number(e.target.value) },
                          }))}
                        >
                          <option value={5}>5 / 5 — Exceptional</option>
                          <option value={4}>4 / 5 — Fair &amp; Reliable</option>
                          <option value={3}>3 / 5 — Partial Effort</option>
                          <option value={2}>2 / 5 — Minimal Contribution</option>
                          <option value={1}>1 / 5 — Did Not Participate</option>
                        </select>
                        <input
                          className="input"
                          style={{ minHeight: 34 }}
                          placeholder="Optional confidential note for lecturer…"
                          value={cur.note}
                          onChange={(e) => setPeerScores((prev) => ({
                            ...prev,
                            [key]: { ...cur, note: e.target.value },
                          }))}
                        />
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Offline / Low-Bandwidth Resilient Submission Queue Banner */}
        {(pendingOfflineSub || isOffline) && assignment && !previewOnly && (
          <div
            className="between small"
            style={{
              padding: '9px 20px',
              background: '#fffbeb',
              borderBottom: '1px solid #fde68a',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div style={{ color: '#92400e' }}>
              <strong>{isOffline ? '▲ Offline Mode Detected:' : '● Offline Lab Report Backup Ready:'}</strong>{' '}
              {pendingOfflineSub
                ? 'Your completed lab submission is safely backed up on this device and will auto-send once connection is stable.'
                : 'Your work auto-saves locally every edit. You can still click Submit to queue an offline backup.'}
            </div>
            {pendingOfflineSub && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={submitting}
                onClick={() => flushSubmissionPayload(pendingOfflineSub)}
              >
                {submitting ? 'Retrying…' : 'Retry Saved Submission Now'}
              </button>
            )}
          </div>
        )}

        {/* Scrollable Lab Workbench */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', background: 'var(--ground)' }}>
          <Suspense fallback={<Loading label={`Loading ${def.shortTitle} laboratory…`} />}>
            {def.id === 'tqm_spc' && <SpcLab key={`spc_${syncVersion}`} {...labProps} />}
            {def.id === 'tqm_tools' && <QualityToolsLab key={`qtools_${syncVersion}`} {...labProps} />}
            {def.id === 'tqm_coq' && <CostOfQualityLab key={`coq_${syncVersion}`} {...labProps} />}
            {def.id === 'psis_seven_names' && <SevenNamesLab key={`seven_${syncVersion}`} {...labProps} />}
            {def.id === 'psis_scan_it' && <ScanItLab key={`scan_${syncVersion}`} {...labProps} />}
            {def.id === 'psis_the_match' && <TheMatchLab key={`match_${syncVersion}`} {...labProps} />}
            {def.id === 'psis_the_whip' && <TheWhipLab key={`whip_${syncVersion}`} {...labProps} />}
            {def.id === 'psis_req_to_order' && <ReqToOrderLab key={`req_${syncVersion}`} {...labProps} />}
            {def.id === 'psis_the_tender' && <TheTenderLab key={`tender_${syncVersion}`} {...labProps} />}
            {def.id === 'psis_inventory_wms' && <InventoryWmsLab key={`wms_${syncVersion}`} {...labProps} />}
            {def.id === 'psis_spend_analytics' && <SpendAnalyticsLab key={`spend_${syncVersion}`} {...labProps} />}
            {def.id === 'scm_landed_cost' && <LandedCostLab key={`landed_${syncVersion}`} {...labProps} />}
            {def.id === 'scm_contract_sla' && <ContractSlaLab key={`sla_${syncVersion}`} {...labProps} />}
            {def.id === 'scm_green_procurement' && <GreenProcurementLab key={`green_${syncVersion}`} {...labProps} />}
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
                {mySyndicate ? ` · Credits ${mySyndicate.name}` : ''}
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
