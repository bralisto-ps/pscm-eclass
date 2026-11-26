import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { Loading, useToast } from '../ui.jsx';
import { getLabDef, getLabPreset, submitLabReportToAssignment } from '../../lib/labsCatalog.js';
import { buildTypedResponsePdfBlob } from '../../lib/textPdf.js';
import { useAuth } from '../../lib/auth.jsx';
import { fmtDateTime } from '../../lib/format.js';
import { findStudentSyndicate, parseAssignmentMeta } from '../../lib/assignmentMeta.js';
import { supabase } from '../../lib/supabase.js';
import { downloadText, downloadWorkbook } from '../../lib/sheets.js';
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
import {
  buildLabExcelWorkbookSheets,
  captureLabVisualCharts,
  evaluateScenarioShockRun,
  generateIndustryScaleDataset,
  getLabGuidedHints,
  getLabScenarioShocks,
  isSafeCloudDraftPayload,
  readLocalDraftTimestamp,
  shouldAdoptCloudDraft,
  writeLocalDraftTimestamp,
} from '../../lib/labMilestone9Engine.js';

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
  const workbenchRef = useRef(null);
  const cloudSaveTimerRef = useRef(null);
  const cloudSyncDisabledRef = useRef(false);

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

  const [industryDataset, setIndustryDataset] = useState(null);

  const effectiveLabConfig = useMemo(() => {
    if (industryDataset?.dataset) {
      return {
        ...labConfig,
        customDataset: industryDataset.dataset,
      };
    }
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
  }, [labConfig, uniqueVariantResult, carriedImport, industryDataset]);

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
  const [toolsOpen, setToolsOpen] = useState(false);
  const [cloudStatus, setCloudStatus] = useState('idle'); // idle | synced | local
  const [shockOpen, setShockOpen] = useState(Boolean(labConfig?.shockSimRequired));
  const [shockChoices, setShockChoices] = useState(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}:shocks`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [guidedOpen, setGuidedOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

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

  // Cross-Device Cloud Draft Sync (graceful fallback if optional SQL not installed yet)
  useEffect(() => {
    if (!session?.user?.id || !def?.id || previewOnly) return undefined;
    let alive = true;
    async function loadCloudDraft() {
      try {
        const { data, error } = await supabase.rpc('load_lab_draft', { p_draft_key: storageKey });
        if (!alive) return;
        if (error) {
          if (/Could not find|does not exist|schema cache/i.test(String(error.message || ''))) {
            cloudSyncDisabledRef.current = true;
            setCloudStatus('local');
          }
          return;
        }
        setCloudStatus('synced');
        const localTs = readLocalDraftTimestamp(typeof localStorage !== 'undefined' ? localStorage : null, storageKey);
        if (data && shouldAdoptCloudDraft(latestDraftRef.current, localTs, data)) {
          suppressNextBroadcastRef.current = true;
          latestDraftRef.current = data.draft;
          try {
            localStorage.setItem(storageKey, JSON.stringify(data.draft));
            writeLocalDraftTimestamp(localStorage, storageKey, data.updated_at || new Date().toISOString());
          } catch {
            // ignore
          }
          setDraftState(data.draft);
          setSyncVersion((v) => v + 1);
          toast('Restored your newer lab draft synced from another device.');
        }
      } catch {
        cloudSyncDisabledRef.current = true;
        if (alive) setCloudStatus('local');
      }
    }
    loadCloudDraft();
    return () => {
      alive = false;
      if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
    };
  }, [session?.user?.id, def?.id, previewOnly, storageKey]);

  const handleDraftChange = useCallback((next) => {
    setHasInteracted(true);
    latestDraftRef.current = next;
    const nowIso = new Date().toISOString();
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      writeLocalDraftTimestamp(localStorage, storageKey, nowIso);
    } catch {
      // ignore quota errors
    }
    if (session?.user?.id && !previewOnly && !cloudSyncDisabledRef.current && isSafeCloudDraftPayload(next)) {
      if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
      cloudSaveTimerRef.current = setTimeout(() => {
        supabase.rpc('save_lab_draft', {
          p_draft_key: storageKey,
          p_lab_id: def?.id || '',
          p_course_id: course?.id || null,
          p_draft: next,
        }).then(({ error }) => {
          if (error) {
            if (/Could not find|does not exist|schema cache/i.test(String(error.message || ''))) {
              cloudSyncDisabledRef.current = true;
              setCloudStatus('local');
            }
          } else {
            setCloudStatus('synced');
          }
        }).catch(() => {});
      }, 1800);
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
  }, [storageKey, synSyncOn, profile?.full_name, profile?.index_no, session?.user?.id, previewOnly, def?.id, course?.id]);

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
  const existingSub = assignment?.submission || null;
  const dueAt = assignment?.due_at || null;
  const overdue = dueAt && new Date(dueAt).getTime() < Date.now();
  const canSubmit = Boolean(assignment && !previewOnly && (!overdue || assignment.allow_late) && !(existingSub && existingSub.marked));

  const shockQuarters = useMemo(() => getLabScenarioShocks(def.id), [def.id]);
  const shockEval = useMemo(() => evaluateScenarioShockRun(def.id, shockChoices), [def.id, shockChoices]);
  const isPracticeOrGuided = Boolean(!assignment || previewOnly || labConfig?.guidedMode);
  const guidedPack = useMemo(
    () => (isPracticeOrGuided ? getLabGuidedHints(def.id, latestDraftRef.current || draftState, judgementReady) : null),
    [isPracticeOrGuided, def.id, draftState, judgementReady],
  );

  function chooseShockOption(quarter, optionId) {
    setShockChoices((prev) => {
      const next = { ...prev, [quarter]: optionId };
      try {
        localStorage.setItem(`${storageKey}:shocks`, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function wrapReportBody(built) {
    const variantPrefix = uniqueVariantResult
      ? `Dataset Variant ID: ${uniqueVariantResult.variantTag}${mySyndicate ? ` (${mySyndicate.name})` : ''}\n`
      : '';
    const shockSuffix = shockEval.reportSection ? `\n\n${shockEval.reportSection}` : '';
    return formatAutoScoredSubmissionHeader({
      labCode: def.code,
      labTitle: labConfig?.title || def.title,
      body: variantPrefix + built.body + shockSuffix,
      hasJudgement: built.hasJudgement,
    });
  }

  async function downloadPdfReport() {
    const built = reportBuilderRef.current?.();
    if (!built) return;
    setExportingPdf(true);
    try {
      const images = await captureLabVisualCharts(workbenchRef.current, 4);
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
        images,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${def.id}-report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(images.length ? `Downloaded PDF report with ${images.length} embedded visual chart${images.length === 1 ? '' : 's'}.` : 'Downloaded PDF lab report.');
    } finally {
      setExportingPdf(false);
    }
  }

  async function downloadExcelWorkbook() {
    const built = reportBuilderRef.current?.();
    if (!built) return;
    try {
      const activeDs = effectiveLabConfig?.customDataset || getLabPreset(def.id, effectiveLabConfig?.presetId) || null;
      const sheets = buildLabExcelWorkbookSheets({
        labDef: def,
        reportTitle: built.title,
        reportBody: wrapReportBody(built),
        dataset: activeDs,
        shockSummary: shockEval.completedCount ? shockEval : null,
      });
      await downloadWorkbook(`${def.id}-analysis-workbook.xlsx`, sheets);
      toast('Downloaded multi-sheet Analysis Workbook (.xlsx).');
    } catch (e) {
      toast(e?.message || 'Could not export Excel workbook.', 'error');
    }
  }

  function loadIndustryScaleData() {
    const generated = generateIndustryScaleDataset(def.id);
    if (!generated?.dataset) return;
    setIndustryDataset(generated);
    setDraftState(null);
    latestDraftRef.current = null;
    setSyncVersion((v) => v + 1);
    toast(`Loaded industry-scale dataset: ${generated.dataset.name} (${generated.rowCount} rows).`);
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
      const images = await captureLabVisualCharts(workbenchRef.current, 4);
      const res = await submitLabReportToAssignment({
        assignment,
        profile,
        session,
        reportTitle: payload.reportTitle,
        reportBody: payload.reportBody,
        note: payload.note,
        extraTypingMeta: payload.extraTypingMeta,
        images,
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
    if (labConfig?.shockSimRequired && !shockEval.isComplete) {
      setShockOpen(true);
      toast('Complete all 3 quarters in the Scenario Shock Simulation before submitting.', 'error');
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
        ...(shockEval.completedCount ? { shockResilienceScore: shockEval.resilienceScore, shockRating: shockEval.riskRating } : {}),
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
            padding: '12px 18px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--surface)',
            gap: 10,
            flexWrap: 'wrap',
            position: 'relative',
          }}
        >
          <div style={{ minWidth: 0, flex: '1 1 220px' }}>
            <div className="tiny muted" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <strong className="mono" style={{ color: trackMeta.accent }}>{def.code}</strong>
              <span>· {course ? course.code : 'Preview'}</span>
              {uniqueVariantResult && (
                <span className="mono" style={{ color: 'var(--teal-700)', fontWeight: 700 }}>
                  · Variant {uniqueVariantResult.variantTag}
                </span>
              )}
              {Array.isArray(labConfig?.mappedClos) && labConfig.mappedClos.length > 0 && (
                <span className="mono" style={{ color: '#1d4ed8', fontWeight: 700 }}>
                  · {labConfig.mappedClos.join(', ')}
                </span>
              )}
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: 17, lineHeight: 1.25 }}>
              {labConfig?.title || def.title}
            </h2>
          </div>

          <div className="row-wrap" style={{ gap: 6, alignItems: 'center', position: 'relative' }}>
            {conceptGuide && (
              <button
                type="button"
                className={`btn btn-sm ${guideOpen ? 'btn-primary' : ''}`}
                onClick={() => setGuideOpen((v) => !v)}
                title="Open formula & concept quick reference"
              >
                <Icon name="book" size={14} /> {guideOpen ? 'Hide Guide' : 'Guide'}
              </button>
            )}
            <button type="button" className="btn btn-sm" disabled={exportingPdf} onClick={downloadPdfReport} title="Download PDF lab report with embedded charts">
              <Icon name="download" size={14} /> {exportingPdf ? 'Building PDF…' : 'PDF'}
            </button>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className={`btn btn-sm ${toolsOpen ? 'btn-primary' : ''}`}
                aria-expanded={toolsOpen}
                onClick={() => setToolsOpen((v) => !v)}
                title="More lab tools"
              >
                More ▾
              </button>
              {toolsOpen && (
                <div
                  className="card stack-xs"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 'calc(100% + 6px)',
                    minWidth: 245,
                    padding: 8,
                    zIndex: 30,
                    boxShadow: '0 10px 28px rgba(15, 23, 42, 0.16)',
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ justifyContent: 'flex-start', width: '100%' }}
                    onClick={() => {
                      setToolsOpen(false);
                      downloadExcelWorkbook();
                    }}
                  >
                    <Icon name="download" size={14} /> Export Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${shockOpen ? 'btn-primary' : ''}`}
                    style={{ justifyContent: 'flex-start', width: '100%' }}
                    onClick={() => {
                      setToolsOpen(false);
                      setShockOpen((v) => !v);
                    }}
                  >
                    <Icon name="flask" size={14} /> Scenario Shocks (3 Quarters){shockEval.completedCount ? ` · ${shockEval.resilienceScore}/100` : ''}
                  </button>
                  {isPracticeOrGuided && (
                    <button
                      type="button"
                      className={`btn btn-sm ${guidedOpen ? 'btn-primary' : ''}`}
                      style={{ justifyContent: 'flex-start', width: '100%' }}
                      onClick={() => {
                        setToolsOpen(false);
                        setGuidedOpen((v) => !v);
                      }}
                    >
                      <Icon name="book" size={14} /> {guidedOpen ? 'Hide Guided Hints' : 'Guided Walkthrough & Hints'}
                    </button>
                  )}
                  {dataMode !== 'lecturer_only' && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ justifyContent: 'flex-start', width: '100%' }}
                      onClick={() => {
                        setToolsOpen(false);
                        loadIndustryScaleData();
                      }}
                    >
                      <Icon name="upload" size={14} /> Load Industry-Scale Dataset
                    </button>
                  )}
                  {carryTargets.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ justifyContent: 'flex-start', width: '100%' }}
                      onClick={() => {
                        setToolsOpen(false);
                        saveCarryForward();
                      }}
                      title={carryTargets.map((t) => t.label).join(' | ')}
                    >
                      <Icon name="arrow" size={14} /> Carry Forward → Next Lab
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ justifyContent: 'flex-start', width: '100%' }}
                    onClick={() => {
                      setToolsOpen(false);
                      resetDraft();
                    }}
                  >
                    Reset Local Draft
                  </button>
                  {!previewOnly && (
                    <div className="tiny muted" style={{ padding: '4px 6px 2px', borderTop: '1px solid var(--line)' }}>
                      {cloudStatus === 'synced' ? '● Cross-device cloud sync active' : 'Draft saved on this device'}
                    </div>
                  )}
                </div>
              )}
            </div>
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

        {/* Lecturer Task Brief (shown cleanly inside workspace when configured) */}
        {labConfig?.instructions && (
          <div
            className="small"
            style={{
              padding: '9px 18px',
              background: 'var(--surface-2)',
              borderBottom: '1px solid var(--line)',
              lineHeight: 1.45,
            }}
          >
            <strong className="tiny mono" style={{ color: trackMeta.accent, marginRight: 8 }}>TASK BRIEF</strong>
            <span className="muted">{labConfig.instructions}</span>
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

        {/* Industry-Scale Messy Dataset Active Strip */}
        {industryDataset && (
          <div
            className="between small"
            style={{
              padding: '8px 18px',
              background: '#f5f3ff',
              borderBottom: '1px solid #ddd6fe',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div className="tiny">
              <strong style={{ color: '#5b21b6' }}>● INDUSTRY-SCALE DATASET ACTIVE:</strong> {industryDataset.dataset?.name} ({industryDataset.rowCount} records)
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setIndustryDataset(null);
                setSyncVersion((v) => v + 1);
                toast('Reverted to standard course dataset.');
              }}
            >
              Revert Dataset
            </button>
          </div>
        )}

        {/* Practice-Mode Guided Walkthrough & Diagnostic Hints Drawer */}
        {guidedOpen && guidedPack && (
          <div
            className="stack-xs"
            style={{
              padding: '12px 18px',
              background: '#f0fdf4',
              borderBottom: '1px solid #bbf7d0',
            }}
          >
            <div className="between" style={{ gap: 8 }}>
              <strong className="small" style={{ color: '#166534' }}>Guided Walkthrough &amp; Practice Hints</strong>
              <button type="button" className="btn btn-sm" onClick={() => setGuidedOpen(false)}>Hide</button>
            </div>
            <ol className="tiny" style={{ margin: '2px 0 0', paddingLeft: 18, color: '#14532d', lineHeight: 1.5 }}>
              {guidedPack.steps.map((s, idx) => <li key={idx}>{s}</li>)}
            </ol>
            <div className="stack-xs" style={{ marginTop: 4 }}>
              {guidedPack.hints.map((h, idx) => (
                <div key={idx} className="tiny" style={{ color: '#15803d' }}>→ {h}</div>
              ))}
            </div>
          </div>
        )}

        {/* Multi-Quarter Dynamic Scenario Shock Simulator Drawer */}
        {shockOpen && (
          <div
            className="stack-sm"
            style={{
              padding: '14px 18px',
              background: '#fffbeb',
              borderBottom: '1px solid #fde68a',
              maxHeight: 330,
              overflowY: 'auto',
            }}
          >
            <div className="between" style={{ gap: 10, flexWrap: 'wrap' }}>
              <div>
                <strong className="small" style={{ color: '#92400e' }}>
                  Multi-Quarter Scenario Shock Simulation ({shockEval.completedCount}/{shockEval.totalQuarters} Quarters)
                  {labConfig?.shockSimRequired ? ' · Required' : ''}
                </strong>
                <div className="tiny muted">
                  Test your managerial decisions against sequential operational disruptions. Results append directly to your submitted report.
                </div>
              </div>
              <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
                <span className="mono tiny" style={{ fontWeight: 700, color: shockEval.resilienceScore >= 70 ? 'var(--teal-700)' : '#b45309' }}>
                  RESILIENCE: {shockEval.resilienceScore}/100 ({shockEval.riskRating})
                </span>
                <button type="button" className="btn btn-sm" onClick={() => setShockOpen(false)}>Close</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
              {shockQuarters.map((q) => {
                const selectedId = shockChoices[q.quarter] || '';
                const selectedOpt = q.options.find((o) => o.id === selectedId) || null;
                return (
                  <div key={q.quarter} className="card stack-xs" style={{ padding: 12, background: 'var(--surface)' }}>
                    <div className="between" style={{ gap: 6 }}>
                      <span className="tiny mono" style={{ fontWeight: 700, color: '#b45309' }}>{q.quarter} SHOCK</span>
                      {selectedOpt && (
                        <span className="tiny mono" style={{ color: selectedOpt.resilienceDelta > 0 ? 'var(--teal-700)' : 'var(--red)', fontWeight: 700 }}>
                          Cost {selectedOpt.costDeltaPct >= 0 ? '+' : ''}{selectedOpt.costDeltaPct}% · Svc {selectedOpt.serviceDeltaPct >= 0 ? '+' : ''}{selectedOpt.serviceDeltaPct}%
                        </span>
                      )}
                    </div>
                    <strong className="small">{q.title}</strong>
                    <div className="tiny muted" style={{ lineHeight: 1.4 }}>{q.event}</div>
                    <div className="stack-xs" style={{ marginTop: 4 }}>
                      {q.options.map((opt) => {
                        const active = selectedId === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            className={`btn btn-sm ${active ? 'btn-primary' : ''}`}
                            style={{ textAlign: 'left', justifyContent: 'flex-start', whiteSpace: 'normal', height: 'auto', padding: '6px 9px', lineHeight: 1.35 }}
                            onClick={() => chooseShockOption(q.quarter, opt.id)}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    {selectedOpt && (
                      <div className="tiny" style={{ marginTop: 4, color: selectedOpt.resilienceDelta > 0 ? 'var(--teal-700)' : '#991b1b', lineHeight: 1.4 }}>
                        {selectedOpt.note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Scrollable Lab Workbench */}
        <div ref={workbenchRef} style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', background: 'var(--ground)' }}>
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
                  ? '● READY TO SUBMIT'
                  : '▲ ADD WRITTEN JUDGEMENT TO SUBMIT'}
              </span>
              {mySyndicate && (
                <span className="tiny muted">Credits {mySyndicate.name}</span>
              )}
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
