// Pure deterministic engine for Milestone 9 World-Class Lab Upgrades (Zero external deps):
// 1. Cross-Device Cloud Draft Sync helpers (timestamp reconciliation + payload size guard)
// 2. Crash-Proof Live Session recovery & local host backup helpers
// 3. Visual Chart DOM-to-JPEG capture (for PDF embedding) + Multi-Sheet Excel Workbook builder
// 4. Multi-Quarter Dynamic Scenario Shock Simulator (all 14 labs)
// 5. Realistic Industry-Scale Messy Dataset Generators (all 14 labs, up to 150 rows)
// 6. Practice-Mode Guided Walkthroughs & Diagnostic Hints + 4-Criterion Professional Lab Rubrics
// 7. Semester-Wide Course CLO Mastery & Accreditation Matrix (CIPS / CILT / AACSB evidence pack)

import { transformMappedRowsToDataset } from './labMilestone7Engine.js';

// ============================================================================
// 1. CROSS-DEVICE CLOUD DRAFT SYNC HELPERS
// ============================================================================

export const MAX_CLOUD_DRAFT_BYTES = 240 * 1024; // 240 KB safe ceiling under 256 KB DB check

export function isSafeCloudDraftPayload(draft) {
  if (!draft || typeof draft !== 'object') return false;
  try {
    const json = JSON.stringify(draft);
    return json.length > 2 && json.length <= MAX_CLOUD_DRAFT_BYTES;
  } catch {
    return false;
  }
}

export function shouldAdoptCloudDraft(localDraft, localUpdatedAtIso, cloudRow) {
  if (!cloudRow || !cloudRow.draft || typeof cloudRow.draft !== 'object') return false;
  const cloudHasKeys = Object.keys(cloudRow.draft).length > 0;
  if (!cloudHasKeys) return false;
  const localHasKeys = localDraft && typeof localDraft === 'object' && Object.keys(localDraft).length > 0;
  if (!localHasKeys) return true;

  const cloudTs = cloudRow.updated_at ? new Date(cloudRow.updated_at).getTime() : 0;
  const localTs = localUpdatedAtIso ? new Date(localUpdatedAtIso).getTime() : 0;
  if (!Number.isFinite(cloudTs) || cloudTs <= 0) return false;
  if (!Number.isFinite(localTs) || localTs <= 0) return true;
  // Require cloud to be meaningfully newer (> 1.5s) to avoid echo loops
  return cloudTs > localTs + 1500;
}

export function readLocalDraftTimestamp(storage, storageKey) {
  if (!storage || !storageKey) return null;
  try {
    return storage.getItem(`${storageKey}:ts`) || null;
  } catch {
    return null;
  }
}

export function writeLocalDraftTimestamp(storage, storageKey, iso = new Date().toISOString()) {
  if (!storage || !storageKey) return;
  try {
    storage.setItem(`${storageKey}:ts`, iso);
  } catch {
    // ignore storage quota errors
  }
}

// ============================================================================
// 2. CRASH-PROOF LIVE SESSION LOCAL BACKUP HELPERS
// ============================================================================

const LIVE_HOST_BACKUP_KEY = 'pscm_live_host_sessions_v1';

export function saveLocalLiveHostBackup(storage, snapshot) {
  if (!storage || !snapshot?.code) return;
  try {
    const raw = storage.getItem(LIVE_HOST_BACKUP_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(list) ? list.filter((s) => s?.code !== snapshot.code) : [];
    arr.unshift({
      code: String(snapshot.code).toUpperCase(),
      labId: snapshot.labId,
      courseId: snapshot.courseId || null,
      state: snapshot.state || {},
      assignments: snapshot.assignments || {},
      participants: Array.isArray(snapshot.participants) ? snapshot.participants : [],
      updatedAt: snapshot.updatedAt || new Date().toISOString(),
    });
    storage.setItem(LIVE_HOST_BACKUP_KEY, JSON.stringify(arr.slice(0, 6)));
  } catch {
    // ignore storage quota errors
  }
}

export function listLocalLiveHostBackups(storage) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LIVE_HOST_BACKUP_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((s) => s && s.code && s.labId) : [];
  } catch {
    return [];
  }
}

export function loadLocalLiveHostBackup(storage, code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  return listLocalLiveHostBackups(storage).find((s) => s.code === clean) || null;
}

export function removeLocalLiveHostBackup(storage, code) {
  if (!storage || !code) return;
  try {
    const clean = String(code).trim().toUpperCase();
    const list = listLocalLiveHostBackups(storage).filter((s) => s.code !== clean);
    storage.setItem(LIVE_HOST_BACKUP_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

// ============================================================================
// 3. VISUAL CHART DOM-TO-JPEG CAPTURE & EXCEL WORKBOOK BUILDER
// ============================================================================

function base64ToUint8Array(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function findChartCaption(el, fallbackIdx) {
  const card = el.closest('section, article, .card, .card-soft, div');
  if (card) {
    const heading = card.querySelector('h2, h3, h4, strong');
    if (heading && heading.textContent) {
      const text = heading.textContent.trim().replace(/\s+/g, ' ');
      if (text.length >= 4 && text.length <= 90) return text;
    }
  }
  return `Analytical Chart ${fallbackIdx}`;
}

function resolveSvgCssVars(svgEl) {
  const clone = svgEl.cloneNode(true);
  const rootStyle = typeof window !== 'undefined' ? window.getComputedStyle(document.documentElement) : null;
  const varMap = {
    'var(--teal-700)': '#0f766e',
    'var(--teal-50)': '#f0fdfa',
    'var(--line)': '#e2e8f0',
    'var(--line-2)': '#cbd5e1',
    'var(--muted)': '#64748b',
    'var(--text)': '#0f172a',
    'var(--surface)': '#ffffff',
    'var(--surface-2)': '#f8fafc',
    'var(--amber)': '#d97706',
    'var(--red)': '#dc2626',
  };
  const resolveVal = (v) => {
    if (!v || !v.includes('var(')) return v;
    return v.replace(/var\((--[a-zA-Z0-9_-]+)\)/g, (full, name) => {
      if (rootStyle) {
        const computed = rootStyle.getPropertyValue(name).trim();
        if (computed) return computed;
      }
      return varMap[full] || '#334155';
    });
  };
  const walk = (node) => {
    if (node.nodeType !== 1) return;
    ['stroke', 'fill', 'color', 'style'].forEach((attr) => {
      const val = node.getAttribute?.(attr);
      if (val && val.includes('var(')) {
        node.setAttribute(attr, resolveVal(val));
      }
    });
    for (const child of node.children || []) walk(child);
  };
  walk(clone);
  return clone;
}

/**
 * Captures up to `maxCharts` rendered SVG or Canvas charts inside a DOM container
 * as crisp white-background JPEG Uint8Arrays ready for PDF embedding.
 */
export async function captureLabVisualCharts(containerEl, maxCharts = 4) {
  if (!containerEl || typeof document === 'undefined' || typeof window === 'undefined') return [];
  const candidates = Array.from(containerEl.querySelectorAll('svg, canvas')).filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width >= 140 && rect.height >= 80;
  });

  const captured = [];
  for (let i = 0; i < candidates.length && captured.length < maxCharts; i++) {
    const el = candidates[i];
    const rect = el.getBoundingClientRect();
    const targetW = Math.min(1100, Math.max(480, Math.round(rect.width * 1.6)));
    const targetH = Math.min(700, Math.max(220, Math.round((rect.height / rect.width) * targetW)));
    const caption = findChartCaption(el, captured.length + 1);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);

      if (el.tagName.toLowerCase() === 'canvas') {
        ctx.drawImage(el, 0, 0, targetW, targetH);
      } else {
        const cloned = resolveSvgCssVars(el);
        if (!cloned.getAttribute('xmlns')) cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        cloned.setAttribute('width', String(targetW));
        cloned.setAttribute('height', String(targetH));
        const xml = new XMLSerializer().serializeToString(cloned);
        const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        try {
          await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              ctx.drawImage(img, 0, 0, targetW, targetH);
              resolve();
            };
            img.onerror = reject;
            img.src = url;
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      }

      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      const b64 = dataUrl.split(',')[1];
      if (b64) {
        captured.push({
          caption,
          jpegBytes: base64ToUint8Array(b64),
          width: targetW,
          height: targetH,
        });
      }
    } catch {
      // Skip any chart that fails rasterization without blocking report generation
    }
  }
  return captured;
}

/**
 * Neutralizes spreadsheet formula injection on untrusted text cells while preserving numbers.
 */
export function sanitizeExcelCell(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function extractPrimaryDatasetRows(dataset) {
  if (!dataset || typeof dataset !== 'object') return [];
  const arrayKey = Object.keys(dataset).find(
    (k) => Array.isArray(dataset[k]) && dataset[k].length > 0 && typeof dataset[k][0] === 'object',
  );
  if (!arrayKey) return [];
  return dataset[arrayKey];
}

/**
 * Builds clean multi-sheet Excel workbook structures for `downloadWorkbook()` from any lab state & report.
 */
export function buildLabExcelWorkbookSheets({ labDef, reportTitle, reportBody, dataset = null, shockSummary = null }) {
  const lines = String(reportBody || '').replace(/\r/g, '').split('\n');
  const kpiRows = [['Metric / Section', 'Recorded Value']];
  const judgementLines = [];
  let inJudgement = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/managerial judgement|executive judgement|recommendation|reflection/i.test(line) && line.length < 70) {
      inJudgement = true;
      continue;
    }
    if (inJudgement) {
      judgementLines.push(line);
    } else if (line.includes(':')) {
      const idx = line.indexOf(':');
      const k = line.slice(0, idx).replace(/^[-•*]\s*/, '').trim();
      const v = line.slice(idx + 1).trim();
      if (k && v) {
        const num = Number(v.replace(/[,\s%]/g, ''));
        kpiRows.push([sanitizeExcelCell(k), Number.isFinite(num) && /^-?[\d,.]+$/.test(v) ? num : sanitizeExcelCell(v)]);
      }
    } else if (line.startsWith('-') || line.startsWith('•')) {
      kpiRows.push(['Finding', sanitizeExcelCell(line.replace(/^[-•]\s*/, ''))]);
    }
  }

  const sheets = [
    {
      name: 'Summary & KPIs',
      widths: [34, 48],
      rows: [
        ['Field', 'Value'],
        ['Laboratory', sanitizeExcelCell(`${labDef?.code || 'LAB'} — ${labDef?.title || reportTitle || 'Interactive Lab'}`)],
        ['Generated At', new Date().toLocaleString()],
        ...(shockSummary
          ? [
              ['Scenario Shock Resilience Score', `${shockSummary.resilienceScore}/100 (${shockSummary.riskRating})`],
              ['Cumulative Shock Cost Impact %', shockSummary.totalCostDeltaPct],
            ]
          : []),
        ...kpiRows.slice(1),
      ],
    },
  ];

  const primaryRows = extractPrimaryDatasetRows(dataset);
  if (primaryRows.length > 0) {
    const headers = Object.keys(primaryRows[0]).filter((k) => typeof primaryRows[0][k] !== 'function');
    const dataRows = primaryRows.slice(0, 500).map((row) =>
      headers.map((h) => {
        const val = row[h];
        if (Array.isArray(val)) return sanitizeExcelCell(val.join(', '));
        if (typeof val === 'object' && val !== null) return sanitizeExcelCell(JSON.stringify(val));
        return sanitizeExcelCell(val);
      }),
    );
    sheets.push({
      name: 'Active Dataset',
      widths: headers.map(() => 18),
      rows: [headers.map((h) => sanitizeExcelCell(h)), ...dataRows],
    });
  }

  sheets.push({
    name: 'Written Judgement',
    widths: [96],
    rows: [
      ['Managerial Judgement & Executive Narrative'],
      ...(judgementLines.length
        ? judgementLines.map((ln) => [sanitizeExcelCell(ln)])
        : [['No written managerial judgement recorded yet.']]),
    ],
  });

  return sheets;
}

// ============================================================================
// 4. MULTI-QUARTER DYNAMIC SCENARIO SHOCK SIMULATOR (ALL 14 LABS)
// ============================================================================

const SCENARIO_SHOCK_PACKS = {
  tqm_spc: [
    {
      quarter: 'Q1',
      title: 'Raw Material Resin Viscosity Shift',
      event: 'Your primary resin supplier changed additive batches without notice. Subgroup means jump +1.8 sigma above target for 3 consecutive shifts.',
      options: [
        { id: 'quarantine_adjust', label: 'Quarantine suspect lots, run special-cause root check & recalibrate before restarting', costDeltaPct: 3.5, serviceDeltaPct: -1.5, resilienceDelta: 15, note: 'Prevents defective field shipments and fixes assignable cause without over-adjusting.' },
        { id: 'tweak_knob', label: 'Tell operators to manually tweak line settings every 15 minutes without stopping', costDeltaPct: 8.2, serviceDeltaPct: -4.0, resilienceDelta: -12, note: 'Tampering increases variance (Deming funnel effect) and hides the resin root cause.' },
        { id: 'ship_anyway', label: 'Keep shipping because parts are still barely inside LSL/USL', costDeltaPct: 12.5, serviceDeltaPct: -9.5, resilienceDelta: -18, note: 'Out-of-control process drifts past spec limits, causing high external warranty claims.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'High-Speed Line Tool Wear Drift',
      event: 'Seven consecutive points trend steadily upward on the Xbar chart during a peak export order.',
      options: [
        { id: 'pm_swap', label: 'Trigger scheduled preventive die swap at shift changeover & verify Cpk ≥ 1.33', costDeltaPct: 2.2, serviceDeltaPct: 1.0, resilienceDelta: 14, note: 'Catches Western Electric trend rule early with minimal downtime.' },
        { id: 'wait_ucl', label: 'Run until a point actually breaks the Upper Control Limit', costDeltaPct: 7.4, serviceDeltaPct: -5.0, resilienceDelta: -10, note: 'Produces hundreds of marginal units before breakdown.' },
        { id: '100_inspect', label: 'Add 100% manual end-of-line inspection instead of changing tooling', costDeltaPct: 9.0, serviceDeltaPct: -2.0, resilienceDelta: -6, note: 'High appraisal cost and inspection misses ~15% of borderline defects.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Customer Tightens Tolerance by 20%',
      event: 'Your largest retail client narrows specification tolerances by 20% while demanding Cpk ≥ 1.33 to renew the annual contract.',
      options: [
        { id: 'doe_variance', label: 'Invest in process variance reduction (DOE + poka-yoke) and re-baseline control limits', costDeltaPct: 4.0, serviceDeltaPct: 4.5, resilienceDelta: 16, note: 'Structurally shrinks process sigma so Cpk exceeds 1.33 sustainably.' },
        { id: 'cherry_pick', label: 'Selectively sort and ship only center-spec batches to this client', costDeltaPct: 10.5, serviceDeltaPct: -3.0, resilienceDelta: -14, note: 'Explodes scrap/rework costs and fails customer process audits.' },
        { id: 'widen_sample', label: 'Reduce sampling frequency so fewer out-of-spec points appear on charts', costDeltaPct: 14.0, serviceDeltaPct: -11.0, resilienceDelta: -20, note: 'Masking variation leads to catastrophic contract loss.' },
      ],
    },
  ],
  tqm_tools: [
    {
      quarter: 'Q1',
      title: 'Night-Shift Packaging Defect Surge',
      event: 'Customer complaints jump 42%. Early reports blame five different departments.',
      options: [
        { id: 'stratify_pareto', label: 'Stratify defect check-sheets by shift/machine and attack the Vital Few Pareto top 2', costDeltaPct: 2.0, serviceDeltaPct: 4.0, resilienceDelta: 16, note: 'Focuses engineering capacity on the 20% of causes driving 80% of defects.' },
        { id: 'blanket_memo', label: 'Issue a company-wide quality memo reprimanding all shifts equally', costDeltaPct: 6.5, serviceDeltaPct: -4.5, resilienceDelta: -12, note: 'Fails to isolate the night-shift root cause and damages morale.' },
        { id: 'fix_minor', label: 'Fix the easiest 4 minor cosmetic defects first for quick wins', costDeltaPct: 5.8, serviceDeltaPct: -3.0, resilienceDelta: -8, note: 'Trivial Many fixes barely move overall defect rate.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Suspected Seal-Temperature vs. Burst Correlation',
      event: 'Engineers debate whether heat-sealer temperature or film thickness causes pouch bursts.',
      options: [
        { id: 'scatter_verify', label: 'Collect paired data, run Scatter/OLS correlation + Ishikawa verification before spending', costDeltaPct: 1.8, serviceDeltaPct: 3.0, resilienceDelta: 15, note: 'Data-driven root-cause confirmation prevents wasted capital spend.' },
        { id: 'replace_machine', label: 'Immediately buy a new $90k heat-sealer without verifying correlation', costDeltaPct: 14.0, serviceDeltaPct: -1.0, resilienceDelta: -12, note: 'High capex risk if film thickness was the true driver.' },
        { id: 'ignore_debate', label: 'Double packaging thickness on all SKUs indefinitely', costDeltaPct: 11.2, serviceDeltaPct: 0.5, resilienceDelta: -9, note: 'Permanent material cost inflation without solving root variation.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Cross-Departmental Handoff Bottleneck',
      event: 'Fixing defects on Line A exposes long QA hold delays before warehouse release.',
      options: [
        { id: 'map_flowchart', label: 'Map end-to-end Process Flowchart, eliminate redundant QA sign-offs & standardize checks', costDeltaPct: 1.5, serviceDeltaPct: 5.0, resilienceDelta: 15, note: 'Removes non-value-adding delays while preserving quality gates.' },
        { id: 'skip_qa', label: 'Bypass QA sign-off completely during month-end rush', costDeltaPct: 11.0, serviceDeltaPct: -8.0, resilienceDelta: -18, note: 'Triggers major recalls and regulatory non-compliance.' },
        { id: 'add_overtime', label: 'Approve permanent weekend overtime for QA clerks', costDeltaPct: 7.5, serviceDeltaPct: 1.0, resilienceDelta: -6, note: 'Treats symptoms with recurring payroll expense.' },
      ],
    },
  ],
  tqm_coq: [
    {
      quarter: 'Q1',
      title: 'Finance Demands 15% Quality Budget Cut',
      event: 'Amid tight cash flow, the CFO proposes cutting supplier audits and operator training to save cash this quarter.',
      options: [
        { id: 'defend_prevention', label: 'Present COQ Iceberg ROI showing Prevention cuts trigger 4× External Failure spikes', costDeltaPct: 1.5, serviceDeltaPct: 3.5, resilienceDelta: 16, note: 'Protects high-leverage Prevention spend and reduces total COQ over 2–3 quarters.' },
        { id: 'cut_prevention', label: 'Slash training and supplier qualification by 30% to hit quarterly budget', costDeltaPct: 11.5, serviceDeltaPct: -8.0, resilienceDelta: -16, note: 'Short-term budget relief causes severe field recalls and lost accounts.' },
        { id: 'cut_appraisal_only', label: 'Keep failures unchanged but drop incoming inspection entirely', costDeltaPct: 9.8, serviceDeltaPct: -7.0, resilienceDelta: -14, note: 'Bad supplier lots flow straight into customer shipments.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Major Warranty Claim Wave on Export Batch',
      event: 'External failure costs spike +45% due to field connector failures.',
      options: [
        { id: 'poka_yoke_capex', label: 'Reallocate spend into Prevention (mistake-proofing + supplier PPAP) to shrink failure tail', costDeltaPct: 3.0, serviceDeltaPct: 4.5, resilienceDelta: 15, note: 'Shifts company left-to-right on the Modern Zero-Defect COQ curve.' },
        { id: 'add_inspectors', label: 'Hire 12 extra final-inspection staff to screen bad units forever', costDeltaPct: 8.5, serviceDeltaPct: -1.5, resilienceDelta: -8, note: 'Traps organization in high Appraisal + Internal Rework equilibrium.' },
        { id: 'tighten_warranty', label: 'Rewrite warranty terms to deny customer claims', costDeltaPct: 13.0, serviceDeltaPct: -12.0, resilienceDelta: -20, note: 'Hidden COQ (brand churn) dwarfs visible warranty savings.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Board Questions Diminishing Returns on Quality',
      event: 'Total COQ fell from 16% to 6% of revenue. Directors ask whether to stop improving.',
      options: [
        { id: 'target_hidden', label: 'Quantify Hidden COQ (expediting, churn, lost tenders) & fund targeted high-ROI prevention', costDeltaPct: 1.2, serviceDeltaPct: 3.0, resilienceDelta: 14, note: 'Aligns quality investments with measurable commercial return.' },
        { id: 'freeze_forever', label: 'Dismantle the continuous improvement team completely', costDeltaPct: 6.0, serviceDeltaPct: -4.5, resilienceDelta: -11, note: 'Process entropy causes COQ to creep back up within a year.' },
        { id: 'spend_blindly', label: 'Double prevention budget without tracking payback or failure drivers', costDeltaPct: 9.5, serviceDeltaPct: 0.5, resilienceDelta: -9, note: 'Over-investing past marginal benefit wastes capital.' },
      ],
    },
  ],
  psis_the_whip: [
    {
      quarter: 'Q1',
      title: 'Social Media Viral Demand Spike (+40%)',
      event: 'Retail POS demand surges +40% for two weeks before normalizing. Upstream tiers only see retailer purchase orders.',
      options: [
        { id: 'share_pos', label: 'Broadcast real-time retail POS & inventory levels across all 4 tiers immediately', costDeltaPct: 2.0, serviceDeltaPct: 5.0, resilienceDelta: 17, note: 'Cuts bullwhip amplification dramatically by removing blind order guessing.' },
        { id: 'panic_double', label: 'Let every tier double its orders to build defensive buffer stock', costDeltaPct: 14.5, serviceDeltaPct: -3.0, resilienceDelta: -16, note: 'Triggers massive factory overproduction followed by months of dead inventory.' },
        { id: 'freeze_orders', label: 'Cap upstream orders at last month’s average despite rising POS', costDeltaPct: 7.5, serviceDeltaPct: -10.0, resilienceDelta: -12, note: 'Causes prolonged retail stockouts and lost shelf space.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Paper-Mode ERP Outage Adds 2-Week Order Delay',
      event: 'A distributor ERP glitch forces manual weekly spreadsheets, doubling information lead time.',
      options: [
        { id: 'small_frequent', label: 'Deploy lightweight EDI/CSV daily order sync & smaller replenishment lot sizes', costDeltaPct: 2.5, serviceDeltaPct: 4.0, resilienceDelta: 15, note: 'Compresses information latency and eliminates order-batching waves.' },
        { id: 'monthly_batches', label: 'Switch everyone to large monthly bulk orders to reduce paperwork', costDeltaPct: 10.5, serviceDeltaPct: -5.5, resilienceDelta: -13, note: 'Order batching amplifies demand variance across tiers.' },
        { id: 'ignore_lag', label: 'Keep existing reorder rules unchanged until IT repairs ERP next quarter', costDeltaPct: 8.8, serviceDeltaPct: -6.5, resilienceDelta: -11, note: 'Blind pipeline orders cause severe oscillation.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Factory Rationing & Shortage Gaming Threat',
      event: 'A packaging shortage forces the factory to allocate 70% of requested orders. Distributors start inflating orders by 50%.',
      options: [
        { id: 'historical_alloc', label: 'Allocate scarce supply strictly by past POS sales history (not current order size)', costDeltaPct: 1.8, serviceDeltaPct: 4.5, resilienceDelta: 16, note: 'Eliminates shortage gaming incentive completely.' },
        { id: 'proportional_cur', label: 'Allocate proportionally to whoever submits the largest purchase order', costDeltaPct: 13.0, serviceDeltaPct: -7.5, resilienceDelta: -17, note: 'Incentivizes phantom orders followed by mass cancellations.' },
        { id: 'first_come', label: 'Ship 100% to the first distributor who calls and 0% to others', costDeltaPct: 9.0, serviceDeltaPct: -9.0, resilienceDelta: -14, note: 'Starves key regional markets and breaks channel trust.' },
      ],
    },
  ],
  psis_seven_names: [
    {
      quarter: 'Q1',
      title: 'Emergency Hospital Acquisition Merges 2 ERP Catalogues',
      event: 'Merging two clinics brings 450 overlapping item descriptions with inconsistent UoMs (Box vs. Pack vs. Each).',
      options: [
        { id: 'golden_record', label: 'Run fuzzy deduplication, enforce noun-modifier naming taxonomy & map legacy aliases to Golden SKUs', costDeltaPct: 2.5, serviceDeltaPct: 5.0, resilienceDelta: 17, note: 'Eliminates phantom stockouts while preserving historical transaction links.' },
        { id: 'bulk_append', label: 'Append all 450 items directly into live master data to save 2 days', costDeltaPct: 12.0, serviceDeltaPct: -7.5, resilienceDelta: -16, note: 'Fragments inventory balances and causes duplicate emergency buying.' },
        { id: 'delete_old', label: 'Hard-delete duplicate SKU records without migrating open POs/stock', costDeltaPct: 14.5, serviceDeltaPct: -11.0, resilienceDelta: -19, note: 'Breaks ERP audit trails and orphans warehouse stock.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Receiving Dock Queue Pressure During Peak Delivery',
      event: 'Clerks under time pressure are quick-creating 15 new SKU codes per week when search does not match immediately.',
      options: [
        { id: 'gatekeeper_wf', label: 'Restrict SKU creation to a Master Data Steward with 4-hour SLA & barcode/fuzzy lookup at dock', costDeltaPct: 1.8, serviceDeltaPct: 4.0, resilienceDelta: 15, note: 'Stops duplicate proliferation at the source without stalling dock flow.' },
        { id: 'open_create', label: 'Let every receiving clerk create SKUs freely so trucks unload faster', costDeltaPct: 9.5, serviceDeltaPct: -4.0, resilienceDelta: -13, note: 'Catalogue pollution compounds monthly, inflating carrying cost.' },
        { id: 'reject_trucks', label: 'Turn away all deliveries whose invoice wording differs by one word', costDeltaPct: 11.0, serviceDeltaPct: -10.5, resilienceDelta: -15, note: 'Halts clinical/plant operations unnecessarily.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Annual Audit Flags Hidden Stock Fragmentation',
      event: 'Auditors discover GHS 180,000 of "expired" stock sitting under obsolete duplicate codes while buyers reordered the same item.',
      options: [
        { id: 'consolidate_kpi', label: 'Consolidate balances under canonical SKUs, add duplicate-rate KPI & quarterly hygiene audit', costDeltaPct: 1.5, serviceDeltaPct: 4.5, resilienceDelta: 15, note: 'Unlocks trapped working capital and prevents recurrence.' },
        { id: 'write_off_quiet', label: 'Write off the expired stock silently and leave catalogue governance unchanged', costDeltaPct: 10.0, serviceDeltaPct: -4.0, resilienceDelta: -14, note: 'Same cash leakage repeats next fiscal year.' },
        { id: 'manual_excel', label: 'Keep a separate side-spreadsheet outside the ERP to track true stock', costDeltaPct: 8.5, serviceDeltaPct: -6.0, resilienceDelta: -12, note: 'Shadow spreadsheets create two conflicting versions of truth.' },
      ],
    },
  ],
  psis_scan_it: [
    {
      quarter: 'Q1',
      title: 'Unregistered Local Supplier Barcodes Fail POS Checkout',
      event: 'A regional food supplier printed self-invented 13-digit numbers that collide with existing imported SKUs.',
      options: [
        { id: 'gs1_enforce', label: 'Enforce GS1-licensed GTIN onboarding validation & Mod-10 check-digit verification at intake', costDeltaPct: 2.0, serviceDeltaPct: 4.5, resilienceDelta: 16, note: 'Prevents checkout mis-scans and ensures global supply-chain traceability.' },
        { id: 'manual_key', label: 'Ask cashiers and warehouse pickers to manually type product codes all day', costDeltaPct: 9.2, serviceDeltaPct: -7.0, resilienceDelta: -14, note: 'Manual keying averages 1 error per 300 characters and slows queues.' },
        { id: 'relabel_store', label: 'Accept colliding barcodes and tell staff to memorize exceptions', costDeltaPct: 11.5, serviceDeltaPct: -8.5, resilienceDelta: -17, note: 'Corrupts inventory accuracy and mischarges customers.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Damaged Thermal Labels Cause 14% Scan Failures',
      event: 'Humidity in the regional depot smudges carton labels; clerks are keying GTINs by hand and introducing transposition errors.',
      options: [
        { id: 'checkdigit_print', label: 'Upgrade thermal ribbons, enforce strict Mod-10 scanner check-digit rejection & reprint damaged labels', costDeltaPct: 2.4, serviceDeltaPct: 4.0, resilienceDelta: 15, note: 'Catches 100% of single-digit and most adjacent transposition errors automatically.' },
        { id: 'disable_check', label: 'Turn off check-digit validation so clerks can force-accept partial codes', costDeltaPct: 10.8, serviceDeltaPct: -6.5, resilienceDelta: -16, note: 'Silently posts receipts to wrong SKUs.' },
        { id: 'skip_scanning', label: 'Stop scanning cartons and count pallets visually instead', costDeltaPct: 9.0, serviceDeltaPct: -7.5, resilienceDelta: -13, note: 'Destroys lot traceability and inventory visibility.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Regulatory Lot-Recall Traceability Drill',
      event: 'Food safety regulators require tracing a contaminated batch from factory to retail stores within 4 hours.',
      options: [
        { id: 'gs1_128', label: 'Adopt GS1-128 / GTIN-14 case barcodes with batch/expiry Application Identifiers across tiers', costDeltaPct: 3.0, serviceDeltaPct: 5.0, resilienceDelta: 16, note: 'Enables surgical lot-level recall in minutes instead of full-brand withdrawal.' },
        { id: 'paper_binders', label: 'Rely on handwritten delivery note binders in depot filing cabinets', costDeltaPct: 12.0, serviceDeltaPct: -9.5, resilienceDelta: -17, note: 'Fails 4-hour recall SLA and triggers full-inventory destruction.' },
        { id: 'unit_only', label: 'Track only base GTIN-13 without lot or case hierarchy', costDeltaPct: 7.8, serviceDeltaPct: -4.5, resilienceDelta: -9, note: 'Forces recalling all unaffected batches of the SKU.' },
      ],
    },
  ],
  psis_the_match: [
    {
      quarter: 'Q1',
      title: 'Emergency IT Request to Grant Buyer Super-User Rights',
      event: 'During year-end leave, a senior buyer asks for temporary Finance + Storekeeper ERP permissions to "speed up urgent payments."',
      options: [
        { id: 'deny_delegate', label: 'Deny toxic SoD combination; assign an approved independent backup approver with audit trail', costDeltaPct: 1.0, serviceDeltaPct: 2.5, resilienceDelta: 17, note: 'Eliminates Ghost-Vendor fraud exposure while maintaining operational continuity.' },
        { id: 'grant_temp', label: 'Grant full 4-role Super-User access for two weeks and promise to review later', costDeltaPct: 14.0, serviceDeltaPct: -2.0, resilienceDelta: -20, note: 'Creates an unguarded end-to-end fictitious vendor payment channel.' },
        { id: 'pause_all', label: 'Freeze all supplier payments for two weeks until staff return', costDeltaPct: 8.5, serviceDeltaPct: -9.0, resilienceDelta: -11, note: 'Triggers supplier credit holds and supply disruption.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Price & Quantity Variance Surge on Freight Invoices',
      event: '18% of supplier invoices exceed PO unit prices by 4–9% or bill full PO quantities despite partial GRN deliveries.',
      options: [
        { id: 'enforce_3way', label: 'Enforce automated 3-way match tolerances (±2% price, 0% qty over GRN) & auto-hold exceptions', costDeltaPct: -3.0, serviceDeltaPct: 3.5, resilienceDelta: 16, note: 'Recovers direct cash leakage while auto-paying clean compliant invoices quickly.' },
        { id: 'pay_fast', label: 'Auto-approve all invoices under GHS 50,000 without GRN matching to avoid calls', costDeltaPct: 11.5, serviceDeltaPct: 1.0, resilienceDelta: -15, note: 'Invites systematic overbilling and phantom-quantity fraud.' },
        { id: 'manual_all', label: 'Route every single invoice (even exact matches) to the CFO manually', costDeltaPct: 7.0, serviceDeltaPct: -7.0, resilienceDelta: -9, note: 'Creates severe payment bottlenecks and forfeits early-payment discounts.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'External Auditor Flags Duplicate Vendor Bank Accounts',
      event: 'Forensic check reveals two vendor IDs sharing a bank account with an internal employee.',
      options: [
        { id: 'freeze_forensic', label: 'Freeze vendor master immediately, separate Vendor Onboarding from AP, & run forensic audit', costDeltaPct: 1.5, serviceDeltaPct: 3.0, resilienceDelta: 16, note: 'Contains fraud loss and closes the root master-data control gap.' },
        { id: 'quiet_deactivate', label: 'Quietly deactivate one vendor ID without investigating prior payments', costDeltaPct: 12.5, serviceDeltaPct: -5.0, resilienceDelta: -18, note: 'Leaves internal fraud ring active and fails statutory governance.' },
        { id: 'warn_email', label: 'Send an informal reminder email to the buyer to be more careful', costDeltaPct: 13.5, serviceDeltaPct: -6.0, resilienceDelta: -19, note: 'Alerts perpetrator to destroy evidence.' },
      ],
    },
  ],
  psis_req_to_order: [
    {
      quarter: 'Q1',
      title: 'Split-Order Pattern Detected Just Below DoA Threshold',
      event: 'A department submits four GHS 9,800 requisitions to the same supplier in 48 hours—each just under the GHS 10,000 Director approval limit.',
      options: [
        { id: 'block_aggregate', label: 'Flag & aggregate cumulative 14-day vendor spend against DoA threshold & route to Director', costDeltaPct: -2.0, serviceDeltaPct: 2.5, resilienceDelta: 16, note: 'Closes threshold-splitting loophole while maintaining fair procurement governance.' },
        { id: 'approve_separate', label: 'Approve each requisition separately because each individual line is under GHS 10,000', costDeltaPct: 10.5, serviceDeltaPct: 0.5, resilienceDelta: -15, note: 'Systematically bypasses competitive tendering and executive oversight.' },
        { id: 'lower_threshold', label: 'Lower Director approval threshold to GHS 500 for every purchase company-wide', costDeltaPct: 8.0, serviceDeltaPct: -11.0, resilienceDelta: -12, note: 'Paralyzes operational purchasing with excessive approval cycle times.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Double-Commitment Budget Overrun in Operations',
      event: 'Under Spent-Only tracking, managers approved GHS 140k of open POs against a GHS 90k remaining budget before invoices arrived.',
      options: [
        { id: 'commitment_acct', label: 'Switch ERP to real-time Commitment Accounting (encumber funds at PO approval)', costDeltaPct: -3.5, serviceDeltaPct: 4.0, resilienceDelta: 17, note: 'Eliminates surprise budget overruns before legal commitments are issued.' },
        { id: 'monthly_excel', label: 'Keep Spent-Only ERP and ask Finance to email Excel budget warnings monthly', costDeltaPct: 9.5, serviceDeltaPct: -4.5, resilienceDelta: -14, note: 'Lagging reports arrive weeks after POs are already legally binding.' },
        { id: 'cancel_post_ship', label: 'Refuse to pay suppliers after goods have already been delivered', costDeltaPct: 13.0, serviceDeltaPct: -12.0, resilienceDelta: -18, note: 'Triggers legal disputes and blacklisting by key vendors.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'High-Frequency Low-Value PO Bottleneck',
      event: '65% of procurement staff time is consumed processing tiny routine consumable POs averaging GHS 650 each.',
      options: [
        { id: 'blanket_catalog', label: 'Establish annual Blanket Orders / punch-out e-catalogues with pre-negotiated rates & call-off caps', costDeltaPct: -4.0, serviceDeltaPct: 6.0, resilienceDelta: 16, note: 'Cuts administrative PO cost by 70% while keeping full spend compliance.' },
        { id: 'remove_po', label: 'Let departments buy anything on petty cash with zero POs', costDeltaPct: 11.0, serviceDeltaPct: -2.0, resilienceDelta: -15, note: 'Explodes maverick spend and removes volume discounts.' },
        { id: 'hire_clerks', label: 'Hire 5 extra procurement clerks to type routine POs faster', costDeltaPct: 8.5, serviceDeltaPct: 1.5, resilienceDelta: -9, note: 'Adds fixed payroll without fixing process inefficiency.' },
      ],
    },
  ],
  psis_the_tender: [
    {
      quarter: 'Q1',
      title: 'Abnormally Low Bid (-28% Below Cost Floor)',
      event: 'During competitive tendering, Bidder D submits a price 28% below verified raw material + freight cost estimates.',
      options: [
        { id: 'clarify_bond', label: 'Trigger abnormally-low-bid cost verification, check technical depth & require performance bond', costDeltaPct: 1.5, serviceDeltaPct: 4.5, resilienceDelta: 17, note: 'Protects against Winner’s Curse default, mid-contract change orders, and corner-cutting.' },
        { id: 'auto_award_low', label: 'Award immediately on lowest price to headline a 28% savings figure', costDeltaPct: 15.0, serviceDeltaPct: -12.0, resilienceDelta: -19, note: 'Supplier defaults mid-project or substitutes substandard materials.' },
        { id: 'cancel_all', label: 'Cancel the entire tender and single-source to the incumbent at +15% markup', costDeltaPct: 11.0, serviceDeltaPct: -5.0, resilienceDelta: -13, note: 'Destroys bidder trust and forfeits legitimate market competition.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Late Pressure to Change Evaluation Weights Mid-Tender',
      event: 'After opening bids, an internal sponsor asks to raise "Local Content" from 10% to 40% to favour a preferred vendor.',
      options: [
        { id: 'lock_weights', label: 'Refuse post-opening weight tampering; enforce pre-published sealed criteria & audit trail', costDeltaPct: 0.5, serviceDeltaPct: 3.5, resilienceDelta: 17, note: 'Preserves legal defensibility, PPA compliance, and market credibility.' },
        { id: 'change_quietly', label: 'Quietly edit the scoring spreadsheet to satisfy the internal sponsor', costDeltaPct: 13.0, serviceDeltaPct: -9.0, resilienceDelta: -20, note: 'Triggers formal bid protests, legal injunctions, and audit sanctions.' },
        { id: 'negotiate_one', label: 'Privately share rival bid prices with the preferred vendor to match', costDeltaPct: 14.5, serviceDeltaPct: -10.0, resilienceDelta: -20, note: 'Severe procurement ethics violation and collusion risk.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Reverse Auction Price Compression vs. Quality Risk',
      event: 'A live reverse auction drives prices down 14%, pushing two qualified suppliers dangerously close to breakeven.',
      options: [
        { id: 'dual_award_sla', label: 'Close auction cleanly, verify sustainable margin & use 70/30 dual-award with SLA clauses', costDeltaPct: -3.5, serviceDeltaPct: 4.5, resilienceDelta: 16, note: 'Captures real competitive savings while maintaining supply continuity.' },
        { id: 'extend_endless', label: 'Keep extending rounds until suppliers bid below variable cost', costDeltaPct: 12.0, serviceDeltaPct: -10.0, resilienceDelta: -17, note: 'Induces Winner’s Curse insolvency and supply failure.' },
        { id: 'abandon_eproc', label: 'Abandon competitive pricing entirely and revert to unchallenged quotes', costDeltaPct: 9.0, serviceDeltaPct: -2.0, resilienceDelta: -12, note: 'Leaves 8–12% real market savings uncaptured.' },
      ],
    },
  ],
  psis_inventory_wms: [
    {
      quarter: 'Q1',
      title: 'Lead-Time Volatility Doubles on Imported Class-AX SKUs',
      event: 'Supplier delivery lead times swing from 14 days to 28±8 days on your highest-value stable-demand items.',
      options: [
        { id: 'recalc_ss_rop', label: 'Recompute Safety Stock & Reorder Point for Class-AX items using lead-time variance & qualify backup', costDeltaPct: 2.8, serviceDeltaPct: 5.5, resilienceDelta: 17, note: 'Targets extra buffer strictly where stockout cost is highest without bloating C-items.' },
        { id: 'double_all', label: 'Double safety stock uniformly across all 1,200 A, B, and C SKUs', costDeltaPct: 14.0, serviceDeltaPct: 1.0, resilienceDelta: -14, note: 'Ties up massive working capital and floods warehouse racks with slow C-items.' },
        { id: 'keep_old_rop', label: 'Keep old 14-day reorder points unchanged to protect cash KPI', costDeltaPct: 11.5, serviceDeltaPct: -13.0, resilienceDelta: -17, note: 'Causes repeated production halts on critical A-class parts.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Cycle Count Reveals 9% Book-to-Physical Shrinkage',
      event: 'Warehouse WMS shows 420 units of a high-value component, but physical shelf count finds only 382.',
      options: [
        { id: 'abc_cycle_rca', label: 'Investigate unposted issues/returns, tighten bin-scan discipline & increase A-item cycle count frequency', costDeltaPct: -1.5, serviceDeltaPct: 4.5, resilienceDelta: 16, note: 'Restores inventory record accuracy above 98% and prevents ghost-stockouts.' },
        { id: 'blind_adjust', label: 'Blindly overwrite WMS balance without investigating root cause', costDeltaPct: 8.5, serviceDeltaPct: -4.0, resilienceDelta: -12, note: 'Pilferage or unrecorded scrap continues unabated.' },
        { id: 'annual_shutdown', label: 'Wait 8 months for the year-end full physical warehouse shutdown', costDeltaPct: 10.0, serviceDeltaPct: -8.5, resilienceDelta: -15, note: 'MRP continues ordering off corrupted balances all year.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Warehouse Space Hits 96% Capacity Before Peak Season',
      event: 'Erratic CZ slow-movers occupy 35% of prime picking slots while fast-moving AX SKUs overflow aisles.',
      options: [
        { id: 'reslot_mto', label: 'Shift erratic CZ items to Make-to-Order / vendor consignment & re-slot AX items near dispatch', costDeltaPct: -3.5, serviceDeltaPct: 5.0, resilienceDelta: 16, note: 'Frees pallet capacity, cuts picker travel time, and reduces obsolescence.' },
        { id: 'rent_overflow', label: 'Sign an expensive 2-year overflow warehouse lease immediately', costDeltaPct: 11.5, serviceDeltaPct: 0.5, resilienceDelta: -11, note: 'Locks in high fixed overhead to store dead slow-moving stock.' },
        { id: 'floor_stack', label: 'Stack pallets randomly in loading bays without WMS bin locations', costDeltaPct: 9.5, serviceDeltaPct: -9.0, resilienceDelta: -16, note: 'Causes damaged goods, safety hazards, and lost stock.' },
      ],
    },
  ],
  psis_spend_analytics: [
    {
      quarter: 'Q1',
      title: 'Spend Cube Uncovers 34% Maverick Off-Contract Buying',
      event: 'Regional offices bypass negotiated contracts to buy IT and MRO items from 48 local ad-hoc vendors at +16% markup.',
      options: [
        { id: 'guided_buying', label: 'Consolidate into preferred catalogues, fix contract availability gaps & block non-PO maverick invoices', costDeltaPct: -5.0, serviceDeltaPct: 4.0, resilienceDelta: 17, note: 'Captures negotiated savings while solving why users bypassed contracts.' },
        { id: 'email_policy', label: 'Circulate a 20-page procurement policy PDF without changing buying workflows', costDeltaPct: 6.5, serviceDeltaPct: -2.0, resilienceDelta: -10, note: 'Passive memos rarely reduce maverick spend beyond 2–3%.' },
        { id: 'ban_urgent', label: 'Block all regional purchases outright without offering approved local alternatives', costDeltaPct: 8.0, serviceDeltaPct: -9.5, resilienceDelta: -13, note: 'Stalls field operations and triggers workarounds.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Top Strategic Supplier OTIF Drops From 96% to 78%',
      event: 'Your largest Tier-1 vendor (28% of category spend) misses 4 straight deliveries while raising prices +6%.',
      options: [
        { id: 'qbr_dual', label: 'Run data-backed QBR with 60-day corrective action plan & qualify a 25% secondary supplier', costDeltaPct: 1.5, serviceDeltaPct: 5.5, resilienceDelta: 17, note: 'Restores leverage and protects supply continuity without chaotic switching.' },
        { id: 'terminate_day1', label: 'Terminate supplier overnight with zero qualified backup ready', costDeltaPct: 15.0, serviceDeltaPct: -14.0, resilienceDelta: -19, note: 'Immediate factory/service halt while scrambling for spot supply.' },
        { id: 'ignore_kpi', label: 'Keep renewing automatically because switching feels inconvenient', costDeltaPct: 10.0, serviceDeltaPct: -8.5, resilienceDelta: -15, note: 'Normalized poor performance erodes competitiveness.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Tail Spend Explosion (320 Vendors = Only 6% of Spend)',
      event: 'AP spends 55% of invoice processing effort on 320 tiny one-off vendors.',
      options: [
        { id: 'tail_rationalize', label: 'Rationalize tail to 2–3 integrated MRO distributors + P-cards with spend caps', costDeltaPct: -4.2, serviceDeltaPct: 3.5, resilienceDelta: 15, note: 'Cuts supplier management overhead and unlocks consolidated rebates.' },
        { id: 'tender_each', label: 'Run formal 3-quote competitive tenders for every GHS 300 tail purchase', costDeltaPct: 9.5, serviceDeltaPct: -7.5, resilienceDelta: -13, note: 'Transaction admin cost exceeds the purchase value.' },
        { id: 'leave_as_is', label: 'Ignore tail spend because it is only 6% of total dollars', costDeltaPct: 6.0, serviceDeltaPct: -2.0, resilienceDelta: -8, note: 'Tail vendors carry disproportionate fraud and compliance risk.' },
      ],
    },
  ],
  scm_landed_cost: [
    {
      quarter: 'Q1',
      title: 'Red Sea / Suez Routing Adds +35% Ocean Freight & +14 Transit Days',
      event: 'Carrier surcharges spike and vessels reroute around the Cape, inflating landed cost and pipeline working capital.',
      options: [
        { id: 'remodel_nearshore', label: 'Re-run full Incoterms CIF/DDP waterfall + pipeline financing cost; split urgent 20% to regional nearshore', costDeltaPct: 3.2, serviceDeltaPct: 4.5, resilienceDelta: 17, note: 'Balances total landed cost against stockout risk rather than chasing headline FOB.' },
        { id: 'airfreight_100', label: 'Shift 100% of heavy cargo to emergency air freight immediately', costDeltaPct: 24.0, serviceDeltaPct: 2.0, resilienceDelta: -14, note: 'Destroys product gross margin completely.' },
        { id: 'stick_fob_blind', label: 'Keep buying cheapest FOB quote and ignore 14 extra days of transit delay', costDeltaPct: 11.0, serviceDeltaPct: -11.0, resilienceDelta: -16, note: 'Hidden stockout and demurrage costs wipe out FOB price savings.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'FX Depreciation (+18%) & Port Clearance Demurrage',
      event: 'Local currency weakens 18% against USD while incomplete HS tariff documentation traps containers at port for 9 days.',
      options: [
        { id: 'preclear_hedge', label: 'Enforce pre-arrival HS code audit, digital customs pre-clearance & FX adjustment/hedging clause', costDeltaPct: 2.0, serviceDeltaPct: 5.0, resilienceDelta: 16, note: 'Eliminates avoidable demurrage penalties and caps currency shock.' },
        { id: 'pay_demurrage', label: 'Treat port demurrage as unavoidable overhead and pass 100% to customers', costDeltaPct: 13.5, serviceDeltaPct: -7.5, resilienceDelta: -14, note: 'Loses market share to competitors with disciplined import compliance.' },
        { id: 'switch_exw_unprep', label: 'Switch to EXW without a vetted export broker to save supplier markup', costDeltaPct: 15.0, serviceDeltaPct: -10.5, resilienceDelta: -18, note: 'Origin export clearance delays and uninsured transit risk.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Import Tariff Reclassification Increases Duty by +10%',
      event: 'Customs reclassifies finished sub-assemblies into a higher duty band, adding 10% on CIF value.',
      options: [
        { id: 'tariff_eng_afcfta', label: 'Evaluate AfCFTA / regional preferential origin sourcing & semi-knocked-down (SKD) tariff engineering', costDeltaPct: -3.5, serviceDeltaPct: 3.5, resilienceDelta: 16, note: 'Legally optimizes duty exposure while strengthening regional supply chains.' },
        { id: 'underdeclare', label: 'Ask supplier to under-invoice customs value to reduce duty', costDeltaPct: 22.0, serviceDeltaPct: -15.0, resilienceDelta: -25, note: 'Illegal customs fraud risking cargo seizure, heavy fines, and license revocation.' },
        { id: 'absorb_silent', label: 'Absorb the 10% margin hit indefinitely without revisiting sourcing mix', costDeltaPct: 10.0, serviceDeltaPct: -1.0, resilienceDelta: -10, note: 'Permanently erodes unit profitability.' },
      ],
    },
  ],
  scm_contract_sla: [
    {
      quarter: 'Q1',
      title: 'Supplier Misses OTIF SLA for Two Consecutive Months',
      event: 'OTIF falls to 83% (target 95%) and defect rate hits 3.8%, triggering contractual service credits.',
      options: [
        { id: 'enforce_cure', label: 'Issue formal SLA breach notice, deduct verified service credits & activate 30-day Cure Plan', costDeltaPct: -1.8, serviceDeltaPct: 4.5, resilienceDelta: 17, note: 'Preserves contractual rights without triggering premature switching disruption.' },
        { id: 'waive_informally', label: 'Waive penalties informally over phone calls to keep the relationship friendly', costDeltaPct: 9.5, serviceDeltaPct: -7.0, resilienceDelta: -15, note: 'Creates legal waiver precedent and removes supplier incentive to fix performance.' },
        { id: 'terminate_now', label: 'Terminate contract immediately before qualifying a replacement vendor', costDeltaPct: 16.0, serviceDeltaPct: -13.0, resilienceDelta: -18, note: 'Unplanned switching costs and emergency spot prices exceed SLA losses.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Disputed Force Majeure Claim During Regional Port Congestion',
      event: 'The supplier claims Force Majeure to excuse a 3-week late delivery, though rival suppliers cleared goods via an alternate port.',
      options: [
        { id: 'audit_fm_clause', label: 'Verify strict FM wording (mitigation duty + timely notice); reject broad commercial hardship claims', costDeltaPct: -1.0, serviceDeltaPct: 4.0, resilienceDelta: 16, note: 'Separates genuine uncontrollable events from poor supplier contingency planning.' },
        { id: 'accept_blindly', label: 'Accept every Force Majeure email automatically without documentation', costDeltaPct: 11.0, serviceDeltaPct: -8.5, resilienceDelta: -16, note: 'Turns Force Majeure into a blanket escape hatch for supplier negligence.' },
        { id: 'withhold_all', label: 'Withhold 100% of unrelated prior invoices without contractual set-off rights', costDeltaPct: 12.5, serviceDeltaPct: -9.5, resilienceDelta: -17, note: 'Puts buyer in counter-breach and escalates into costly litigation.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Liability Cap Reached While Breaches Continue',
      event: 'Cumulative liquidated damages hit the 10% annual liability cap, leaving the supplier financially indifferent to further delays.',
      options: [
        { id: 'step_in_transition', label: 'Trigger contractual termination-for-cause threshold & execute phased dual-source transition plan', costDeltaPct: 2.5, serviceDeltaPct: 5.5, resilienceDelta: 17, note: 'Protects business continuity when commercial remedies are exhausted.' },
        { id: 'keep_renewing', label: 'Roll over the exact same contract terms for another 2 years', costDeltaPct: 14.0, serviceDeltaPct: -11.0, resilienceDelta: -19, note: 'Guarantees chronic operational disruption.' },
        { id: 'sue_no_backup', label: 'File court injunction while still relying 100% on the supplier for weekly deliveries', costDeltaPct: 15.5, serviceDeltaPct: -12.5, resilienceDelta: -18, note: 'Adversarial litigation destroys remaining cooperation before backup exists.' },
      ],
    },
  ],
  scm_green_procurement: [
    {
      quarter: 'Q1',
      title: 'Export Buyer Introduces Carbon Border Fee ($85/tCO2e)',
      event: 'Your European export customer requires verified Scope 1–3 product carbon footprints and prices excess carbon at $85/tonne.',
      options: [
        { id: 'abate_mode_shift', label: 'Model shadow carbon TCO; shift Air→Sea/Rail freight & contract low-carbon supplier with best $/tCO2e abatement', costDeltaPct: -1.5, serviceDeltaPct: 4.5, resilienceDelta: 17, note: 'Wins carbon-adjusted TCO and secures export contract eligibility.' },
        { id: 'buy_cheapest_dirty', label: 'Keep highest-emission supplier because base unit price is 4% cheaper', costDeltaPct: 13.5, serviceDeltaPct: -8.0, resilienceDelta: -17, note: 'Carbon border tariff and lost export volume erase the 4% unit price edge.' },
        { id: 'buy_unverified_offsets', label: 'Buy cheap unverified offsets while keeping air-freight emissions unchanged', costDeltaPct: 9.5, serviceDeltaPct: -6.5, resilienceDelta: -14, note: 'Fails regulatory CBAM/CSRD scrutiny and triggers greenwashing backlash.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Corporate Carbon Cap Exceeded After Urgent Air Shipments',
      event: 'Three rush air-freight orders push Scope 3 logistics emissions 22% above your annual corporate carbon ceiling.',
      options: [
        { id: 'planning_buffer', label: 'Fix upstream demand lead-time planning + regional buffer stock to eliminate recurring air expedites', costDeltaPct: -3.0, serviceDeltaPct: 5.0, resilienceDelta: 17, note: 'Cuts both freight cost and Scope 3 emissions simultaneously (win-win).' },
        { id: 'hide_scope3', label: 'Exclude inbound freight from sustainability reports to look compliant', costDeltaPct: 11.5, serviceDeltaPct: -9.0, resilienceDelta: -19, note: 'Fails ESG assurance audits and damages institutional investor trust.' },
        { id: 'halt_orders', label: 'Freeze customer deliveries for the rest of the quarter to stay under cap', costDeltaPct: 12.0, serviceDeltaPct: -13.0, resilienceDelta: -16, note: 'Severe revenue loss when better inventory planning solves the root driver.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Tier-2 Supplier Ethics & Packaging Waste Audit Alert',
      event: 'A low-cost vendor scores 48/100 on labor ethics and uses non-recyclable multi-layer plastic packaging.',
      options: [
        { id: 'esg_remediate', label: 'Enforce Supplier Code of Conduct corrective plan, transition to circular packaging & weight ESG in tenders', costDeltaPct: 2.2, serviceDeltaPct: 4.0, resilienceDelta: 16, note: 'Builds auditable, resilient supply base without greenwashing.' },
        { id: 'ignore_tier2', label: 'Claim Tier-2 factories are outside procurement’s responsibility', costDeltaPct: 12.5, serviceDeltaPct: -10.0, resilienceDelta: -18, note: 'Reputational and regulatory due-diligence liabilities fall back on the brand.' },
        { id: 'switch_blind_price', label: 'Switch solely to the highest-priced vendor assuming high price equals green', costDeltaPct: 14.0, serviceDeltaPct: -1.0, resilienceDelta: -11, note: 'Pays premium without verifying actual emissions or ethical audit data.' },
      ],
    },
  ],
  neg_zopa_batna: [
    {
      quarter: 'Q1',
      title: 'Backup Supplier Raises Quote +14% Mid-Negotiation',
      event: 'Your secondary supplier withdraws its discount, weakening your BATNA right before Round 3.',
      options: [
        { id: 'recalc_qualify', label: 'Recalculate Reservation Price quietly, qualify a 3rd regional quote & hold firm on Should-Cost rationale', costDeltaPct: 2.0, serviceDeltaPct: 3.5, resilienceDelta: 17, note: 'Prevents panic concessions while rebuilding BATNA credibility.' },
        { id: 'disclose_weak_batna', label: 'Immediately tell the supplier your backup quote rose so they sympathize', costDeltaPct: 12.5, serviceDeltaPct: -2.0, resilienceDelta: -17, note: 'Exposing a weakened BATNA shifts the entire ZOPA capture to the seller.' },
        { id: 'accept_anchor', label: 'Accept the supplier’s opening anchor immediately to lock supply', costDeltaPct: 14.0, serviceDeltaPct: 1.0, resilienceDelta: -16, note: 'Surrenders 100% of the bargaining surplus.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Supplier Issues "Take-It-Or-Leave-It" Exploding Offer',
      event: 'The account manager demands signature by 5 PM at +6% above your Target Price.',
      options: [
        { id: 'defuse_test', label: 'Refuse artificial time pressure, restate objective market criteria & test whether walk-away is a bluff', costDeltaPct: -2.0, serviceDeltaPct: 3.0, resilienceDelta: 16, note: 'Most exploding offers are anchoring tactics that soften when met calmly.' },
        { id: 'sign_under_duress', label: 'Sign immediately before 5 PM without internal finance review', costDeltaPct: 11.0, serviceDeltaPct: -3.0, resilienceDelta: -15, note: 'Rewards hardball tactics and locks in inflated pricing.' },
        { id: 'insult_walk', label: 'Send an angry email burning the relationship permanently', costDeltaPct: 9.5, serviceDeltaPct: -9.0, resilienceDelta: -14, note: 'Destroys future option value even when a positive ZOPA exists.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Negative ZOPA Emerges After Commodity Spike',
      event: 'Supplier cost floor rises above your maximum budget ceiling, eliminating price overlap.',
      options: [
        { id: 'expand_pie', label: 'Stop single-issue haggling; introduce multi-year volume, faster payment, or spec redesign to create new ZOPA', costDeltaPct: 1.5, serviceDeltaPct: 5.0, resilienceDelta: 17, note: 'Converts a deadlocked distributive game into integrative value creation.' },
        { id: 'breach_rp', label: 'Pay 12% above your Reservation Price just to close the deal', costDeltaPct: 13.0, serviceDeltaPct: -4.0, resilienceDelta: -18, note: 'Violates BATNA discipline and destroys budget value.' },
        { id: 'split_diff_blind', label: 'Propose splitting the difference halfway above your walk-away limit', costDeltaPct: 10.5, serviceDeltaPct: -3.0, resilienceDelta: -15, note: 'Splitting the difference rewards whoever anchored most aggressively.' },
      ],
    },
  ],
  neg_integrative_pareto: [
    {
      quarter: 'Q1',
      title: 'Counterpart Refuses to Share Cost or Priority Weights',
      event: 'The supplier insists on negotiating strictly one issue at a time—starting with Unit Price.',
      options: [
        { id: 'meso_probe', label: 'Keep all 5 issues linked and table 3 MESO packages to infer their hidden priority weights', costDeltaPct: -2.5, serviceDeltaPct: 5.0, resilienceDelta: 17, note: 'MESOs break single-issue framing and reveal logrolling opportunities safely.' },
        { id: 'issue_by_issue', label: 'Agree to lock Unit Price first before discussing Payment Terms or Warranty', costDeltaPct: 10.0, serviceDeltaPct: -6.0, resilienceDelta: -15, note: 'Sequential issue-by-issue bargaining destroys logrolling potential.' },
        { id: 'reveal_all_pts', label: 'Hand over your entire confidential scoring sheet hoping they reciprocate', costDeltaPct: 9.0, serviceDeltaPct: -2.0, resilienceDelta: -12, note: 'Exposes your reservation limits to unilateral value claiming.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Sub-Optimal Compromise Proposal Leaves 22 Joint Points on Table',
      event: 'Both teams gravitate toward the middle option on every single issue ("fair compromise").',
      options: [
        { id: 'post_settlement', label: 'Propose a Post-Settlement Settlement: test asymmetric swaps to push both sides onto the Pareto Frontier', costDeltaPct: -3.0, serviceDeltaPct: 5.5, resilienceDelta: 17, note: 'Middle-of-the-road compromises are almost always Pareto-inefficient.' },
        { id: 'lock_middle', label: 'Sign the all-middle compromise immediately because it looks symmetric', costDeltaPct: 8.5, serviceDeltaPct: -5.0, resilienceDelta: -13, note: 'Leaves substantial mutual value unclaimed.' },
        { id: 'claw_back', label: 'Demand extra price cuts after verbally shaking hands', costDeltaPct: 11.5, serviceDeltaPct: -9.5, resilienceDelta: -17, note: 'Erodes trust and causes supplier to pad future change orders.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Post-Award Working-Capital Squeeze Hits Supplier',
      event: 'Six months in, high borrowing rates make Net 60 painful for the supplier while you value faster delivery.',
      options: [
        { id: 'trade_cash_speed', label: 'Trade Net 60 → Net 20 fast payment in exchange for guaranteed 7-day lead time & 2% rebate', costDeltaPct: -2.2, serviceDeltaPct: 6.0, resilienceDelta: 16, note: 'Classic dynamic logrolling exploiting asymmetric cost of capital.' },
        { id: 'refuse_reopen', label: 'Refuse any discussion and enforce late penalties until supplier defaults', costDeltaPct: 12.0, serviceDeltaPct: -11.0, resilienceDelta: -16, note: 'Turns a solvable financing mismatch into supply disruption.' },
        { id: 'pay_early_free', label: 'Switch to Net 15 unilaterally without asking for any operational concession', costDeltaPct: 7.5, serviceDeltaPct: 0.0, resilienceDelta: -11, note: 'Gives away working capital with zero reciprocity.' },
      ],
    },
  ],
  neg_should_cost: [
    {
      quarter: 'Q1',
      title: 'Supplier Claims +22% Raw Material Inflation Across Entire Price',
      event: 'Supplier demands a 22% total price hike because steel rose 22%—even though steel is only 38% of unit cost.',
      options: [
        { id: 'weighted_pass_through', label: 'Use Should-Cost weightings to cap pass-through strictly at 38% × 22% = +8.4% & audit index', costDeltaPct: -5.0, serviceDeltaPct: 3.5, resilienceDelta: 17, note: 'Stops classic "margin-on-inflation" overcharging cleanly with math.' },
        { id: 'accept_22', label: 'Approve the full +22% total price increase without checking cost share', costDeltaPct: 14.0, serviceDeltaPct: 0.0, resilienceDelta: -18, note: 'Overpays +13.6% directly into supplier excess margin.' },
        { id: 'reject_zero', label: 'Reject all commodity adjustment even when verified index surged +22%', costDeltaPct: 9.5, serviceDeltaPct: -9.0, resilienceDelta: -13, note: 'Forces supplier into loss-making deliveries and quality shortcuts.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Volume Doubles Under New Regional Expansion',
      event: 'Your annual order doubles from 5,000 to 10,000 units, yet the supplier quotes the exact same unit price.',
      options: [
        { id: 'learning_curve_rebate', label: 'Invoke Wright’s learning curve & fixed-overhead amortization to negotiate a 9–12% tiered volume discount', costDeltaPct: -4.5, serviceDeltaPct: 4.0, resilienceDelta: 16, note: 'Captures genuine economies of scale without squeezing supplier variable margin.' },
        { id: 'pay_flat_rate', label: 'Accept unchanged unit pricing because volume growth was your own change', costDeltaPct: 9.0, serviceDeltaPct: 0.5, resilienceDelta: -12, note: 'Hands fixed-overhead windfall entirely to vendor.' },
        { id: 'split_4_vendors', label: 'Split the volume across 4 tiny vendors so nobody gets scale efficiencies', costDeltaPct: 11.5, serviceDeltaPct: -5.0, resilienceDelta: -14, note: 'Destroys volume leverage and raises coordination defects.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Supplier Refuses Open-Book Cost Transparency',
      event: 'Vendor cites "proprietary trade secrets" and declines to share overhead or SG&A breakdown.',
      options: [
        { id: 'clean_sheet_bench', label: 'Present your independent Clean-Sheet Should-Cost estimate & invite supplier to correct assumptions', costDeltaPct: -2.0, serviceDeltaPct: 4.0, resilienceDelta: 16, note: 'Clean-sheet benchmarks shift the burden of proof onto the supplier respectfully.' },
        { id: 'abandon_should_cost', label: 'Drop cost analysis and revert to blind percentage haggling', costDeltaPct: 10.5, serviceDeltaPct: -2.0, resilienceDelta: -14, note: 'Loses objective legitimacy at the table.' },
        { id: 'threaten_blacklist', label: 'Threaten immediate debarment if they do not open their general ledger', costDeltaPct: 9.5, serviceDeltaPct: -8.5, resilienceDelta: -15, note: 'Triggers defensive stonewalling.' },
      ],
    },
  ],
  neg_power_concession: [
    {
      quarter: 'Q1',
      title: 'Supplier Exploits Your Escalating Concession Mistake',
      event: 'After a junior buyer makes two rapid unconditional concessions, the supplier stops moving and demands more.',
      options: [
        { id: 'reset_conditional', label: 'Pause, tighten concession increments sharply & require explicit reciprocal IF–THEN trades for every move', costDeltaPct: -2.5, serviceDeltaPct: 3.5, resilienceDelta: 17, note: 'Re-establishes credibility and halts concession exploitation.' },
        { id: 'bigger_sweetener', label: 'Offer an even larger unconditional price jump to "show good faith"', costDeltaPct: 13.5, serviceDeltaPct: -2.0, resilienceDelta: -18, note: 'Confirms to the counterpart that stalling pays.' },
        { id: 'walk_immediately', label: 'Walk out permanently with zero backup supplier ready', costDeltaPct: 12.0, serviceDeltaPct: -11.0, resilienceDelta: -16, note: 'Unprepared walk-away damages operations.' },
      ],
    },
    {
      quarter: 'Q2',
      title: 'Sole-Source Monopoly Supplier Demands +18% Renewal',
      event: 'Switching cost is high and internal stakeholders want to sign fast to avoid migration work.',
      options: [
        { id: 'harden_batna_plan', label: 'Start 90 days early, fund parallel backup qualification & remove internal urgency before final round', costDeltaPct: -4.0, serviceDeltaPct: 5.0, resilienceDelta: 17, note: 'Reduces Supplier Dominance structurally by lowering switching barriers and urgency.' },
        { id: 'wait_last_week', label: 'Wait until 5 days before contract expiry to begin renewal talks', costDeltaPct: 15.0, serviceDeltaPct: -6.0, resilienceDelta: -19, note: 'Time pressure hands 100% bargaining leverage to the incumbent.' },
        { id: 'bluff_fake_batna', label: 'Invent a fake competitor quote that the incumbent knows does not exist', costDeltaPct: 11.5, serviceDeltaPct: -9.0, resilienceDelta: -17, note: 'Destroys long-term negotiator credibility when exposed.' },
      ],
    },
    {
      quarter: 'Q3',
      title: 'Negotiation Reaches Hard Deadlock on Price Escalation Clause',
      event: 'Both sides refuse to budge on a 3-year fixed vs. floating price clause.',
      options: [
        { id: 'contingent_collar', label: 'Propose a Contingent Collar Agreement (±4% neutral band + shared index split beyond collar)', costDeltaPct: -2.0, serviceDeltaPct: 5.5, resilienceDelta: 17, note: 'Classic deadlock-breaking contingent contract sharing tail risk fairly.' },
        { id: 'take_100_risk', label: 'Accept uncapped quarterly supplier price pass-throughs', costDeltaPct: 13.0, serviceDeltaPct: -4.0, resilienceDelta: -16, note: 'Exposes buyer budget to unlimited inflation risk.' },
        { id: 'freeze_talks', label: 'Leave talks deadlocked indefinitely with no interim supply cover', costDeltaPct: 11.0, serviceDeltaPct: -12.0, resilienceDelta: -17, note: 'Causes operational stockout.' },
      ],
    },
  ],
};

export function getLabScenarioShocks(labId) {
  return SCENARIO_SHOCK_PACKS[labId] || SCENARIO_SHOCK_PACKS.scm_landed_cost;
}

export function evaluateScenarioShockRun(labId, choices = {}) {
  const quarters = getLabScenarioShocks(labId);
  let resilience = 55;
  let totalCostDeltaPct = 0;
  let totalServiceDeltaPct = 0;
  const decisions = [];

  for (const q of quarters) {
    const chosenId = choices?.[q.quarter];
    const opt = q.options.find((o) => o.id === chosenId) || null;
    if (!opt) continue;
    resilience += opt.resilienceDelta;
    totalCostDeltaPct += opt.costDeltaPct;
    totalServiceDeltaPct += opt.serviceDeltaPct;
    decisions.push({
      quarter: q.quarter,
      title: q.title,
      choiceLabel: opt.label,
      costDeltaPct: opt.costDeltaPct,
      serviceDeltaPct: opt.serviceDeltaPct,
      note: opt.note,
    });
  }

  const completedCount = decisions.length;
  const resilienceScore = Math.max(0, Math.min(100, Math.round(resilience)));
  const riskRating =
    completedCount < quarters.length
      ? 'IN PROGRESS'
      : resilienceScore >= 85
        ? 'RESILIENT LEADER'
        : resilienceScore >= 65
          ? 'MODERATE RESILIENCE'
          : 'HIGH VULNERABILITY';

  const reportSection = completedCount
    ? [
        'MULTI-QUARTER SCENARIO SHOCK SIMULATION',
        `Completed Quarters: ${completedCount} / ${quarters.length}`,
        `Resilience Score: ${resilienceScore} / 100 (${riskRating})`,
        `Cumulative Cost Impact: ${totalCostDeltaPct >= 0 ? '+' : ''}${totalCostDeltaPct.toFixed(1)}% | Cumulative Service Impact: ${totalServiceDeltaPct >= 0 ? '+' : ''}${totalServiceDeltaPct.toFixed(1)}%`,
        ...decisions.map(
          (d) => `- ${d.quarter} (${d.title}): ${d.choiceLabel} [Cost ${d.costDeltaPct >= 0 ? '+' : ''}${d.costDeltaPct}%, Service ${d.serviceDeltaPct >= 0 ? '+' : ''}${d.serviceDeltaPct}%]`,
        ),
      ].join('\n')
    : '';

  return {
    totalQuarters: quarters.length,
    completedCount,
    isComplete: completedCount === quarters.length,
    resilienceScore,
    totalCostDeltaPct: Number(totalCostDeltaPct.toFixed(1)),
    totalServiceDeltaPct: Number(totalServiceDeltaPct.toFixed(1)),
    riskRating,
    decisions,
    reportSection,
  };
}

// ============================================================================
// 5. INDUSTRY-SCALE MESSY DATASET GENERATORS (ALL 14 LABS)
// ============================================================================

function seededRng(seedNum) {
  let s = seedNum >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Generates a realistic, messy industry-scale operational dataset (80–150 rows on high-volume labs)
 * formatted directly into the target lab's `customDataset` structure via `transformMappedRowsToDataset`.
 */
export function generateIndustryScaleDataset(labId) {
  const rand = seededRng(20260914 + String(labId || '').split('').reduce((a, c) => a + c.charCodeAt(0) * 31, 0));

  if (labId === 'tqm_spc') {
    const rows = [];
    for (let i = 1; i <= 40; i++) {
      // Shift mean upward after batch 27 to inject genuine assignable-cause drift
      const drift = i >= 28 && i <= 34 ? 1.8 : i === 15 ? -2.4 : 0;
      const vals = Array.from({ length: 5 }, () => (500 + drift + (rand() - 0.5) * 4.2).toFixed(2));
      rows.push([`LOT-${String(i).padStart(3, '0')}`, ...vals]);
    }
    return {
      ...transformMappedRowsToDataset(
        'tqm_spc',
        rows,
        { subgroup: 0, value1: 1, value2: 2, value3: 3, value4: 4, value5: 5 },
        { name: 'Industry Bottling Plant — 40-Shift Fill Weight Run (200 Readings)', chartType: 'xbar_r', lsl: 494, usl: 506 },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'tqm_tools') {
    const cats = [
      'Seal Leak (Thermal)', 'Label Misalignment', 'Under-Fill Weight', 'Cap Torque Loose',
      'Carton Glue Failure', 'Barcode Unreadable', 'Batch Print Smudge', 'Dented Container',
      'Wrong Language Sleeve', 'Foreign Dust Particle', 'Moisture Ingress', 'Pallet Wrap Tear',
    ];
    const shifts = ['Day-A', 'Evening-B', 'Night-C'];
    const rows = cats.map((cat, idx) => {
      const base = idx === 0 ? 184 : idx === 1 ? 132 : idx === 2 ? 78 : Math.round(8 + rand() * 32);
      return [cat, String(base), shifts[idx % 3]];
    });
    return {
      ...transformMappedRowsToDataset(
        'tqm_tools',
        rows,
        { category: 0, count: 1, shift: 2 },
        { name: 'FMCG Plant — Quarterly Multi-Shift Defect Log (12 Failure Modes)' },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'tqm_coq') {
    const items = [
      ['Supplier Quality Audits & PPAP', 'prevention', 42000],
      ['Operator SPC & Poka-Yoke Training', 'prevention', 28500],
      ['Preventive Maintenance Calibration', 'prevention', 36000],
      ['Incoming Raw Material Lab Testing', 'appraisal', 64000],
      ['In-Process Line Sampling & Patrol QA', 'appraisal', 58000],
      ['Final Pre-Dispatch Inspection Team', 'appraisal', 71000],
      ['Line Scrap & Rejected Batches', 'internal', 148000],
      ['Rework Labour & Re-Packaging', 'internal', 112000],
      ['Unplanned Quality Downtime', 'internal', 94000],
      ['Field Warranty Replacements', 'external', 215000],
      ['Retailer Chargebacks & Late Penalties', 'external', 164000],
      ['Emergency Air-Freight Recall Logistics', 'external', 129000],
    ];
    return {
      ...transformMappedRowsToDataset(
        'tqm_coq',
        items.map((r) => [r[0], r[1], String(r[2])]),
        { name: 0, category: 1, amount: 2 },
        { name: 'Regional Manufacturing Group — Full Annual PAF Ledger (12 Cost Centres)', currency: 'GHS', revenue: 9500000, unitsProduced: 420000 },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'psis_the_whip') {
    const rows = [];
    for (let w = 1; w <= 26; w++) {
      const spike = w === 9 || w === 10 ? 22 : w === 18 ? 16 : 0;
      const seasonal = Math.round(Math.sin(w / 3.5) * 6);
      const demand = Math.max(25, Math.round(45 + seasonal + spike + (rand() - 0.5) * 6));
      rows.push([`W${w}`, String(demand)]);
    }
    return {
      ...transformMappedRowsToDataset(
        'psis_the_whip',
        rows,
        { week: 0, demand: 1 },
        { name: 'National FMCG Distributor — 26-Week POS Demand Series (Seasonal + Promo Spikes)' },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'psis_seven_names') {
    const templates = [
      ['A4 Photocopy Paper 80gsm Ream', 'A4 Copier Paper 80g (500 sheets)', 'PAPER A4 80GSM WHITE REAM', 'Photocopy Paper - A4 80gsm'],
      ['Nitrile Exam Gloves Medium Box 100', 'Gloves Nitrile Med (100ct Box)', 'EXAM GLOVES NITRILE SIZE M', 'Medium Nitrile Gloves 100/Box'],
      ['HP 85A Black Laser Toner Cartridge', 'LaserJet Toner 85A - Black', 'TONER CARTRIDGE 85A BLK HP', 'Black Toner 85A Printer'],
      ['Hand Sanitizer Gel 500ml Pump', 'Alcohol Hand Sanitiser 500ML', 'Sanitizer Gel 500 ml Pump Bottle', '500ml Hand Sanitizer Gel'],
      ['Surgical Face Mask 3-Ply Box 50', '3-Ply Medical Mask (50/Box)', 'FACE MASK SURGICAL 3 PLY 50s', 'Disposable 3Ply Face Masks 50ct'],
      ['PVC Packing Tape Brown 48mm x 66m', 'Brown Packaging Tape 48mm', 'TAPE PACKING BROWN 48MMX66M', 'Carton Sealing Tape Brown 48mm'],
      ['Ballpoint Pen Blue Medium Box 50', 'Blue Biro Pens (Pack of 50)', 'PEN BALLPOINT BLUE 50/BOX', 'Medium Blue Ballpoint Pen 50s'],
      ['AA Alkaline Industrial Battery Pack 24', 'Alkaline Battery AA (24pk)', 'BATTERY AA ALKALINE 24-PACK', 'Industrial AA Batteries x24'],
      ['Safety Helmet Hard Hat Yellow', 'Hard Hat Safety Helmet - Yellow', 'HELMET SAFETY YELLOW HDPE', 'Yellow Construction Hardhat'],
      ['Heavy Duty Pallet Stretch Wrap 500mm', 'Stretch Film Clear 500mm Roll', 'PALLET WRAP CLEAR 500MM', 'Clear Pallet Shrink Wrap 500mm'],
    ];
    const rows = [];
    let seq = 1001;
    // Generate 120 realistic messy ERP item records with duplicates, whitespace & casing noise
    for (let rep = 0; rep < 3; rep++) {
      for (const group of templates) {
        for (const variant of group) {
          const noisy = rep === 1 ? `  ${variant} ` : rep === 2 ? variant.toUpperCase() : variant;
          rows.push([`ERP-${seq++}`, noisy, String(Math.round(12 + rand() * 240)), rep === 0 ? 'Box' : rep === 1 ? 'BX' : 'Pack']);
        }
      }
    }
    return {
      ...transformMappedRowsToDataset(
        'psis_seven_names',
        rows,
        { code: 0, name: 1, stock: 2, unit: 3 },
        { name: 'Merged Hospital & Depot ERP Catalogue — 120 Messy SKU Records' },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'psis_scan_it') {
    const validAndCorrupt = [
      ['6031234567895', 'Accra Pure Cocoa Powder 500g', 'Beverages'],
      ['6031234567896', 'Accra Pure Cocoa Powder 500g (Bad Check Digit)', 'Beverages'],
      ['6034567890124', 'Tema Refined Sugar 1kg', 'Dry Goods'],
      ['6001087341202', 'Cape Rooibos Tea 80s', 'Beverages'],
      ['5000159461122', 'Imported Biscuits 250g', 'Snacks'],
      ['036000291452', 'Facial Tissue Cube 100ct (GTIN-12)', 'Hygiene'],
      ['6039876543210', 'Kumasi Shea Butter Balm 200ml (Corrupt)', 'Personal Care'],
      ['16031234567892', 'Outer Carton 12x Cocoa 500g (GTIN-14)', 'Wholesale Case'],
      ['6151100024501', 'Lagos Instant Noodles 70g', 'Dry Goods'],
      ['6161100041236', 'Nairobi Roast Coffee 250g', 'Beverages'],
      ['8901058851427', 'Spiced Masala Pack 100g', 'Spices'],
      ['6901234567892', 'LED Rechargeable Work Lamp', 'Hardware'],
    ];
    return {
      ...transformMappedRowsToDataset(
        'psis_scan_it',
        validAndCorrupt,
        { barcode: 0, name: 1, category: 2 },
        { name: 'Regional Retail Intake — 12 Mixed GTIN-12/13/14 Barcodes (with Transposition Traps)' },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'psis_the_match') {
    const suppliers = ['Volta Industrial Supplies', 'GoldCoast Logistics Ltd', 'Apex Medical Imports', 'Phantom Shell Traders', 'Keta Packaging Co.', 'Metro Office Solutions'];
    const items = ['Hydraulic Filter Kit', 'Nitrile Gloves (Case)', 'Diesel Generator Coolant', 'Corrugated Export Cartons', 'ERP Barcode Scanners', 'Safety Boots Steel-Toe'];
    const rows = [];
    for (let i = 1; i <= 36; i++) {
      const poQty = Math.round(20 + rand() * 180);
      const poPrice = Math.round(45 + rand() * 450);
      const anomaly = i % 5 === 0 ? 'overbill_qty' : i % 7 === 0 ? 'price_creep' : i % 11 === 0 ? 'no_grn' : 'clean';
      const grnQty = anomaly === 'no_grn' ? 0 : anomaly === 'overbill_qty' ? Math.max(5, poQty - Math.round(poQty * 0.25)) : poQty;
      const invQty = poQty;
      const invPrice = anomaly === 'price_creep' ? Math.round(poPrice * 1.14) : poPrice;
      const budget = anomaly === 'no_grn' ? 2000 : poQty * poPrice * 2;
      rows.push([
        `PO-2026-${String(i).padStart(3, '0')}`,
        anomaly === 'no_grn' ? '' : `GRN-${String(i).padStart(3, '0')}`,
        `INV-${8800 + i}`,
        suppliers[i % suppliers.length],
        items[i % items.length],
        String(poQty),
        String(poPrice),
        String(grnQty),
        String(invQty),
        String(invPrice),
        String(budget),
      ]);
    }
    return {
      ...transformMappedRowsToDataset(
        'psis_the_match',
        rows,
        { poNo: 0, grnNo: 1, invNo: 2, supplier: 3, item: 4, poQty: 5, poUnitPrice: 6, grnQty: 7, invQty: 8, invUnitPrice: 9, budgetRemaining: 10 },
        { name: 'Enterprise AP Month-End Queue — 36 Invoice Match Packets (Price, Qty & Phantom GRN Traps)', currency: 'GHS' },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'psis_req_to_order') {
    const depts = ['Operations', 'Maintenance', 'IT Infrastructure', 'Fleet & Logistics', 'Facilities'];
    const vendors = ['TechLink Ghana', 'WestCoast MRO', 'Accra Fleet Parts', 'Prime Office Direct', 'Metro Safety Gear'];
    const rows = [];
    for (let i = 1; i <= 30; i++) {
      // Inject deliberate split-order cluster on rows 4, 5, 6 (each ~GHS 9,600 under 10k threshold)
      const isSplit = i >= 4 && i <= 6;
      const qty = isSplit ? 12 : Math.round(2 + rand() * 40);
      const price = isSplit ? 800 : Math.round(120 + rand() * 1400);
      rows.push([
        `PR-26-${String(i).padStart(3, '0')}`,
        isSplit ? `Emergency Spare Parts Batch ${i - 3}` : `Operational MRO Item #${i}`,
        isSplit ? 'WestCoast MRO' : vendors[i % vendors.length],
        isSplit ? 'Maintenance' : depts[i % depts.length],
        String(qty),
        String(price),
      ]);
    }
    return {
      ...transformMappedRowsToDataset(
        'psis_req_to_order',
        rows,
        { reqNo: 0, item: 1, supplier: 2, costCentre: 3, qty: 4, unitPrice: 5 },
        { name: 'Multi-Department Requisition Queue — 30 PRs (with Split-Order & Over-Commitment Traps)', currency: 'GHS' },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'psis_the_tender') {
    const rows = [
      ['Atlas Heavy Engineering Ltd', '1420000', '91', '28', '72', '1280000'],
      ['Sahara Industrial Consortium', '1365000', '86', '35', '58', '1250000'],
      ['UltraCut Low-Ball Ventures', '980000', '64', '45', '40', '1240000'],
      ['WestGate Precision Systems', '1495000', '94', '21', '80', '1310000'],
      ['Oceanic Global Trading PLC', '1295000', '82', '32', '48', '1210000'],
      ['Accra Local Content Partners', '1390000', '88', '24', '92', '1260000'],
      ['Meridian Turnkey Contractors', '1330000', '79', '38', '55', '1230000'],
      ['Delta Prime Equipment Corp', '1445000', '90', '26', '68', '1290000'],
    ];
    return {
      ...transformMappedRowsToDataset(
        'psis_the_tender',
        rows,
        { supplier: 0, bidPrice: 1, technicalScore: 2, deliveryDays: 3, localContentPct: 4, costFloor: 5 },
        { name: 'National Utility Capital Equipment Tender — 8 Competing Bidders (Abnormally Low Bid Trap)', currency: 'GHS' },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'psis_inventory_wms') {
    const categories = ['Bearing', 'Valve', 'Filter', 'Seal Kit', 'Sensor', 'Belt', 'Gasket', 'Cable', 'Fuse', 'Bracket'];
    const rows = [];
    for (let i = 1; i <= 120; i++) {
      // Pareto power-law distribution so ~15% SKUs drive ~75% annual consumption value
      const tier = i <= 18 ? 'A' : i <= 54 ? 'B' : 'C';
      const annualDemand = tier === 'A' ? Math.round(600 + rand() * 2400) : tier === 'B' ? Math.round(120 + rand() * 500) : Math.round(10 + rand() * 140);
      const unitCost = tier === 'A' ? Math.round(180 + rand() * 650) : tier === 'B' ? Math.round(40 + rand() * 160) : Math.round(4 + rand() * 35);
      const cv = Number((0.12 + rand() * 1.15).toFixed(2));
      const bookQty = Math.max(5, Math.round(annualDemand / 8));
      const shrinkage = i % 9 === 0 ? -Math.round(bookQty * (0.08 + rand() * 0.14)) : i % 13 === 0 ? Math.round(bookQty * 0.06) : 0;
      rows.push([
        `WH-${String(1000 + i)}`,
        `${categories[i % categories.length]} Spec-${i}`,
        String(annualDemand),
        String(unitCost),
        String(cv),
        String(bookQty),
        String(Math.max(0, bookQty + shrinkage)),
      ]);
    }
    return {
      ...transformMappedRowsToDataset(
        'psis_inventory_wms',
        rows,
        { sku: 0, name: 1, annualDemand: 2, unitCost: 3, cv: 4, bookQty: 5, countedQty: 6 },
        { name: 'Regional Distribution Centre — 120-SKU ABC-XYZ & Cycle Count Master File', currency: 'GHS' },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'psis_spend_analytics') {
    const cats = ['Raw Materials', 'Packaging', 'Logistics & Freight', 'IT & Software', 'MRO & Spares', 'Facilities', 'Professional Services'];
    const prefixes = ['Volta', 'Apex', 'Meridian', 'GoldCoast', 'Accra', 'Tema', 'Kumasi', 'Atlantic', 'Sahara', 'Prime', 'Vanguard', 'Delta', 'Keta', 'Takoradi', 'Sterling'];
    const suffixes = ['Industries', 'Logistics', 'Supplies', 'Trading', 'Systems', 'Packaging', 'Solutions', 'Holdings', 'Ventures', 'Services'];
    const rows = [];
    for (let i = 1; i <= 150; i++) {
      // Realistic spend cube: top 15 strategic vendors (~70% spend), middle 35, long tail 100 vendors (many maverick)
      const isStrategic = i <= 15;
      const isMid = i > 15 && i <= 50;
      const spend = isStrategic
        ? Math.round(480000 + rand() * 1400000)
        : isMid
          ? Math.round(65000 + rand() * 240000)
          : Math.round(2500 + rand() * 28000);
      const onContract = isStrategic ? (i === 4 ? 'No' : 'Yes') : isMid ? (rand() > 0.3 ? 'Yes' : 'No') : (rand() > 0.72 ? 'Yes' : 'No');
      const otif = Math.round(isStrategic && i === 3 ? 76 : 74 + rand() * 25);
      const ppm = Math.round(isStrategic && i === 3 ? 9500 : 120 + rand() * 4800);
      const priceVar = Number(((onContract === 'No' ? 4 : -1.5) + rand() * 9).toFixed(1));
      const resp = Math.round(58 + rand() * 40);
      rows.push([
        `${prefixes[i % prefixes.length]} ${suffixes[(i * 3) % suffixes.length]} #${i}`,
        cats[i % cats.length],
        String(spend),
        String(otif),
        String(ppm),
        String(priceVar),
        String(resp),
        onContract,
      ]);
    }
    return {
      ...transformMappedRowsToDataset(
        'psis_spend_analytics',
        rows,
        { name: 0, category: 1, annualSpend: 2, otifPct: 3, defectPpm: 4, priceVariancePct: 5, responsiveness: 6, onContract: 7 },
        { name: 'Enterprise Annual Spend Cube — 150 Suppliers (Strategic, Maverick & Long-Tail Spend)', currency: 'GHS' },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'scm_landed_cost') {
    const rows = [
      ['Shanghai (Ocean FCL via Tema)', 'Ocean', 'FOB', '2500', '18.50', '9400', '20', '15', '3800', '46'],
      ['Mumbai (Ocean Consolidated)', 'Ocean', 'CIF', '2500', '20.10', '7200', '20', '15', '3400', '34'],
      ['Rotterdam (Direct Ocean)', 'Ocean', 'DAP', '2500', '24.40', '6800', '15', '15', '2900', '24'],
      ['Istanbul (Sea-Air Hybrid)', 'Air', 'CIF', '2500', '22.80', '19500', '20', '15', '2600', '11'],
      ['Johannesburg (AfCFTA Ocean)', 'Ocean', 'DDP', '2500', '25.20', '5100', '5', '15', '1800', '16'],
      ['Abidjan Regional Corridor (Road)', 'Road', 'DDP', '2500', '26.80', '3200', '0', '15', '950', '4'],
    ];
    return {
      ...transformMappedRowsToDataset(
        'scm_landed_cost',
        rows,
        { name: 0, mode: 1, incoterm: 2, qty: 3, unitExw: 4, mainFreight: 5, dutyRatePct: 6, vatRatePct: 7, destPort: 8, transitDays: 9 },
        { name: 'Global Multi-Corridor Import Comparison — 6 Origins (EXW to AfCFTA DDP)', currency: 'USD' },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'scm_contract_sla') {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const rows = months.map((m, idx) => {
      const inv = Math.round(115000 + rand() * 45000);
      const breach = idx === 3 || idx === 4 || idx === 8 || idx === 10;
      const fm = idx === 4 ? 'Yes' : 'No';
      const otif = breach ? (78 + rand() * 11).toFixed(1) : (94.5 + rand() * 4.5).toFixed(1);
      const defect = breach ? (2.6 + rand() * 2.1).toFixed(2) : (0.3 + rand() * 0.9).toFixed(2);
      const resp = breach ? String(Math.round(14 + rand() * 18)) : String(Math.round(3 + rand() * 5));
      return [`2026-${m}`, String(inv), otif, defect, resp, fm];
    });
    return {
      ...transformMappedRowsToDataset(
        'scm_contract_sla',
        rows,
        { period: 0, invoiceValue: 1, otifPct: 2, defectPct: 3, responseHrs: 4, forceMajeure: 5 },
        { name: 'Annual 3PL Logistics SLA Ledger — 12 Monthly Audits (with Disputed Force Majeure)', currency: 'USD' },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'scm_green_procurement') {
    const rows = [
      ['Shenzhen Coal-Grid Manufacturing', 'East Asia', 'Sea', '14200', '940', '2450', '30', '62'],
      ['Shenzhen Air-Express Option', 'East Asia', 'Air', '11800', '940', '2450', '30', '62'],
      ['Antwerp Hydro-Steel Mill', 'Western Europe', 'Sea', '6400', '1180', '820', '88', '93'],
      ['Casablanca Solar Industrial Park', 'North Africa', 'Sea', '3400', '1060', '1050', '78', '85'],
      ['Tema Recycled Alloy Foundry', 'West Africa', 'Road', '180', '1110', '690', '92', '89'],
      ['Istanbul Intermodal Rail-Sea', 'Eurasia', 'Rail', '5900', '1020', '1380', '65', '79'],
    ];
    return {
      ...transformMappedRowsToDataset(
        'scm_green_procurement',
        rows,
        { name: 0, origin: 1, mode: 2, distanceKm: 3, unitPricePerTonne: 4, mfgKgCo2PerTonne: 5, recyclablePct: 6, ethicsScore: 7 },
        { name: 'Global Carbon-Adjusted Sourcing Portfolio — 6 Suppliers Across Sea, Rail, Road & Air', currency: 'USD' },
      ),
      isIndustryScale: true,
    };
  }

  if (labId === 'neg_zopa_batna') {
    return {
      ...transformMappedRowsToDataset(
        'neg_zopa_batna',
        [['2480', '145', '2150', '1980', '1840', '13', '2890', '1200']],
        { buyerBatna: 0, buyerSwitchingCost: 1, buyerTarget: 2, buyerAnchor: 3, supplierCost: 4, supplierMinMarginPct: 5, supplierAnchor: 6, quantity: 7 },
        { name: 'National Utility Transformer Procurement — High-Stakes Distributive Case', currency: 'USD' },
      ),
      isIndustryScale: true,
    };
  }
  if (labId === 'neg_integrative_pareto') {
    const rows = [
      ['Unit Price', 'USD 420 / unit', '42', '0'],
      ['Unit Price', 'USD 455 / unit', '28', '18'],
      ['Unit Price', 'USD 490 / unit', '14', '36'],
      ['Unit Price', 'USD 525 / unit', '0', '50'],
      ['Payment Terms', 'Net 15 (Early Cash)', '0', '30'],
      ['Payment Terms', 'Net 30 Standard', '8', '16'],
      ['Payment Terms', 'Net 60 Extended', '15', '0'],
      ['Lead Time SLA', '5 Days Guaranteed', '28', '0'],
      ['Lead Time SLA', '12 Days Standard', '15', '12'],
      ['Lead Time SLA', '25 Days Economy', '0', '20'],
      ['Warranty & Spares', '36 Months + Consignment', '20', '0'],
      ['Warranty & Spares', '18 Months Standard', '11', '6'],
      ['Warranty & Spares', '6 Months Basic', '0', '10'],
      ['Volume Commitment', '3-Year 80% Share', '2', '24'],
      ['Volume Commitment', '2-Year 60% Share', '7', '14'],
      ['Volume Commitment', '1-Year Spot', '12', '0'],
    ];
    return {
      ...transformMappedRowsToDataset(
        'neg_integrative_pareto',
        rows,
        { issue: 0, optionLabel: 1, buyerPoints: 2, supplierPoints: 3 },
        { name: 'Strategic Aerospace & Mining Framework — 5-Issue Asymmetric Scoring Matrix' },
      ),
      isIndustryScale: true,
    };
  }
  if (labId === 'neg_should_cost') {
    const rows = [
      ['Primary Alloy Steel', 'material', '142.50', '118.00'],
      ['Specialty Coatings & Seals', 'material', '34.20', '28.50'],
      ['CNC Machining Labour', 'labour', '58.00', '44.00'],
      ['Quality NDT Testing Labour', 'labour', '21.50', '16.50'],
      ['Plant Energy & Depreciation Overhead', 'overhead', '46.80', '33.00'],
      ['Export Packaging & Crating', 'material', '19.40', '14.20'],
      ['Port Haulage & Freight', 'logistics', '29.00', '21.50'],
      ['Corporate SG&A Allocation', 'sga', '38.60', '18.00'],
    ];
    return {
      ...transformMappedRowsToDataset(
        'neg_should_cost',
        rows,
        { name: 0, category: 1, quotedCost: 2, benchmarkCost: 3 },
        { name: 'Heavy Industrial Valve Assembly — 8-Component Clean-Sheet Should-Cost Audit', currency: 'USD' },
      ),
      isIndustryScale: true,
    };
  }
  if (labId === 'neg_power_concession') {
    const rows = [
      ['1', '90', 'IF supplier removes minimum order quantity surcharge'],
      ['2', '55', 'IF supplier commits to 97% OTIF SLA with 2% service credit'],
      ['3', '30', 'IF supplier accepts Net 45 payment terms with zero interest'],
      ['4', '15', 'IF supplier signs 24-month ±4% commodity collar price lock'],
    ];
    return {
      ...transformMappedRowsToDataset(
        'neg_power_concession',
        rows,
        { round: 0, concessionAmount: 1, ifThenTrade: 2 },
        { name: 'Tier-1 Sole-Source Strategic Renewal — 4-Round Concession Playbook', currency: 'USD' },
      ),
      isIndustryScale: true,
    };
  }
  return null;
}

// ============================================================================
// 6. PRACTICE-MODE GUIDED WALKTHROUGHS & 4-CRITERION PROFESSIONAL RUBRICS
// ============================================================================

const GUIDED_STEPS_BY_LAB = {
  tqm_spc: [
    'Select the appropriate control chart (Xbar-R, Xbar-S, p-chart, or c-chart) for the dataset.',
    'Inspect UCL/LCL boundaries and Western Electric violation flags before judging capability.',
    'Compare Cp vs. Cpk (centering) and defend whether process adjustment or variance reduction is required.',
  ],
  tqm_tools: [
    'Review the Check Sheet and generate the Pareto 80/20 curve to isolate the Vital Few defect categories.',
    'Map root causes on the Ishikawa diagram and verify suspected relationships via Scatter/OLS.',
    'Write a targeted corrective action plan addressing the top root causes first.',
  ],
  tqm_coq: [
    'Verify all cost items are accurately classified into Prevention, Appraisal, Internal, and External Failure.',
    'Inspect the Hidden COQ Iceberg multiplier and compare Classical vs. Modern Optimal Quality curves.',
    'Run the What-If Prevention ROI model and justify the budget reallocation.',
  ],
  psis_the_whip: [
    'Run the baseline blind 4-tier simulation with a demand rumour or Paper-Mode delay.',
    'Replay the exact scenario with Shared POS visibility enabled and compare Bullwhip Ratios.',
    'Explain how information latency and order batching amplified upstream inventory swings.',
  ],
  psis_seven_names: [
    'Process incoming warehouse dockets carefully—matching existing SKUs instead of creating redundant codes.',
    'Run fuzzy duplicate clustering to quantify stock fragmentation and hidden safety-stock inflation.',
    'Recommend a master-data governance control (naming convention + steward workflow).',
  ],
  psis_scan_it: [
    'Inspect or scan GTIN-8/12/13/14 codes and identify each GS1 Member Organization prefix.',
    'Verify the Mod-10 check-digit math and trigger a single-digit / transposition error test.',
    'Explain why automated barcode validation prevents silent ERP inventory corruption.',
  ],
  psis_the_match: [
    'Audit each invoice packet across PO, Goods Receipt (GRN), and Cost-Centre Budget tolerances.',
    'Test the Segregation of Duties (SoD) toxic-role simulation to witness Ghost-Vendor fraud risk.',
    'Recommend exact tolerance rules and role-separation controls to remediate exposures.',
  ],
  psis_req_to_order: [
    'Audit requisitions against Delegation-of-Authority thresholds and flag split-order avoidance.',
    'Toggle Spent-Only vs. Commitment Accounting to quantify prevented double-commitment breaches.',
    'Evaluate Blanket Order ROI for high-frequency, low-value catalogue requisitions.',
  ],
  psis_the_tender: [
    'Evaluate sealed supplier bids across weighted Price, Technical, Delivery, and Local Content criteria.',
    'Test award sensitivity to criteria weights and inspect abnormally low bids against the cost floor.',
    'Run the Reverse Auction round dynamics and assess genuine savings vs. Winner’s Curse risk.',
  ],
  psis_inventory_wms: [
    'Compute Economic Order Quantity (EOQ), Safety Stock, and Reorder Points for the target service level.',
    'Classify SKUs across the 9-quadrant ABC-XYZ matrix to differentiate control policies.',
    'Audit book-to-physical cycle count variances and recommend corrective WMS controls.',
  ],
  psis_spend_analytics: [
    'Score supplier KPIs (OTIF, Defect PPM, Price Variance, Responsiveness) under business weights.',
    'Inspect the Spend Cube to quantify Maverick/Off-Contract leakage and Tail Spend fragmentation.',
    'Prioritize 3 concrete category-management actions with quantified savings.',
  ],
  scm_landed_cost: [
    'Compare routes across the complete Incoterms 2020 cost waterfall (EXW → FOB → CIF → DDP).',
    'Include customs duty, import VAT, port clearance, and transit working-capital cost.',
    'Identify any FOB price trap and defend the lowest Total Landed Cost sourcing strategy.',
  ],
  scm_contract_sla: [
    'Audit monthly supplier performance against OTIF, Defect, and Response SLA thresholds.',
    'Compute contractual service credits, liability cap ceiling, and Force Majeure excusal impact.',
    'Weigh continued remediation against termination and supplier switching cost.',
  ],
  scm_green_procurement: [
    'Compare suppliers across Scope 1/2 manufacturing and Scope 3 inbound freight emissions.',
    'Adjust the Shadow Carbon Price slider to test when the lowest-carbon option beats the cheapest quote.',
    'Evaluate corporate carbon-cap compliance and implied Carbon Abatement Cost ($/tCO2e).',
  ],
  neg_zopa_batna: [
    'Compute Buyer Reservation Price (BATNA + Switching Cost) and Supplier Floor to verify if a positive ZOPA exists.',
    'Play round-by-round offers against the counterpart persona using disciplined diminishing concessions.',
    'Compare your final surplus capture against your BATNA and justify whether to settle or walk away.',
  ],
  neg_integrative_pareto: [
    'Inspect the asymmetric buyer vs. supplier point weights across all 5 contract issues.',
    'Trade low-weight issues for high-weight issues until your deal reaches the Pareto Efficient Frontier.',
    'Save 2–3 MESO packages and explain how they unlock mutual value over single-issue price haggling.',
  ],
  neg_should_cost: [
    'Compare each supplier cost line against market benchmarks to isolate padded cost drivers.',
    'Test commodity index shifts and volume learning-curve multipliers to verify sensitivity.',
    'Set an evidence-based Opening Anchor, Target Price, and Reservation Price for the bargaining table.',
  ],
  neg_power_concession: [
    'Rate the 6 Buyer vs. Supplier power drivers to diagnose your true Power Balance quadrant.',
    'Design a 4-round diminishing concession schedule staying strictly inside your walk-away ceiling.',
    'Attach a concrete conditional IF–THEN give-get to every concession and plan your deadlock breaker.',
  ],
};

export function getLabGuidedHints(labId, draftState, judgementReady) {
  const steps = GUIDED_STEPS_BY_LAB[labId] || [
    'Load and inspect the dataset thoroughly before modifying parameters.',
    'Run the core analytical comparison and verify key KPIs.',
    'Record a concise executive managerial judgement supported by numbers.',
  ];
  const hints = [];
  const hasDraft = draftState && typeof draftState === 'object' && Object.keys(draftState).length > 0;
  if (!hasDraft) {
    hints.push('Start by interacting with the dataset or adjusting a scenario control so your analysis updates.');
  } else {
    hints.push('Good start — verify your headline KPI numbers against the Formula & Concept Guide before drafting your conclusion.');
  }
  if (!judgementReady) {
    hints.push('Your written managerial judgement is still incomplete. Cite at least 2 specific computed numbers and recommend an action.');
  } else {
    hints.push('Written managerial judgement detected! Consider running the 3-Quarter Scenario Shock test (in More ▾) to stress-test your recommendation.');
  }
  return { steps, hints };
}

const RUBRIC_DIAGNOSIS_FOCUS = {
  tqm_spc: 'Out-of-control Western Electric signal & Cp/Cpk centering diagnosis',
  tqm_tools: 'Pareto 80/20 Vital Few isolation & Ishikawa / correlation root-cause diagnosis',
  tqm_coq: 'PAF cost classification, Hidden COQ Iceberg & Prevention ROI diagnosis',
  psis_the_whip: 'Bullwhip ratio compression, latency & POS visibility diagnosis',
  psis_seven_names: 'Duplicate SKU clustering, fragmentation & catalogue governance diagnosis',
  psis_scan_it: 'GS1 prefix licensing, Mod-10 check-digit & transposition trap diagnosis',
  psis_the_match: '3-way match variance exceptions & Segregation of Duties fraud diagnosis',
  psis_req_to_order: 'DoA split-order detection, Commitment Accounting & Blanket Order diagnosis',
  psis_the_tender: 'Weighted bid sensitivity, cost-floor & Winner’s Curse risk diagnosis',
  psis_inventory_wms: 'EOQ / Safety Stock optimization, ABC-XYZ segmentation & cycle count diagnosis',
  psis_spend_analytics: 'Supplier KPI scorecard, Maverick spend & Tail Spend rationalization diagnosis',
  scm_landed_cost: 'Incoterms 2020 waterfall, CIF duty/port buildup & FOB price-trap diagnosis',
  scm_contract_sla: 'SLA breach credit math, liability cap, Force Majeure & switching diagnosis',
  scm_green_procurement: 'Scope 1–3 emissions, Shadow Carbon TCO & abatement cost diagnosis',
  neg_zopa_batna: 'BATNA/Reservation math, ZOPA identification, anchoring & surplus capture diagnosis',
  neg_integrative_pareto: 'Asymmetric logrolling trade-offs, MESO structure & Pareto efficiency diagnosis',
  neg_should_cost: 'Open-book cost driver audit, padded line isolation & learning-curve sensitivity diagnosis',
  neg_power_concession: 'Power quadrant assessment, diminishing concession curve & conditional give-get diagnosis',
};

export function getLabProfessionalRubric(labId, maxMarks = 20) {
  const total = Math.max(1, Number(maxMarks) || 20);
  const diagFocus = RUBRIC_DIAGNOSIS_FOCUS[labId] || 'Analytical root-cause & control diagnosis';
  const raw = [
    { id: 'quant_accuracy', label: 'Quantitative & Analytical Accuracy', desc: 'Correct dataset audit, KPI calculations, and verification metrics', weight: 0.35 },
    { id: 'root_diagnosis', label: 'Root-Cause & Control Diagnosis', desc: diagFocus, weight: 0.25 },
    { id: 'managerial_action', label: 'Managerial Recommendation & Action Plan', desc: 'Clear, evidence-backed executive decision citing lab numbers', weight: 0.25 },
    { id: 'risk_governance', label: 'Risk, Governance & Trade-Off Awareness', desc: 'Sensitivity, resilience, ethical/compliance or implementation trade-offs', weight: 0.15 },
  ];
  const scaled = raw.map((c) => ({
    id: c.id,
    label: c.label,
    desc: c.desc,
    maxMarks: Math.max(0.5, Math.round(total * c.weight * 2) / 2),
  }));
  const diff = Math.round((total - scaled.reduce((s, c) => s + c.maxMarks, 0)) * 2) / 2;
  if (scaled.length && Math.abs(diff) > 0) {
    scaled[0].maxMarks = Math.max(0.5, Number((scaled[0].maxMarks + diff).toFixed(1)));
  }
  return scaled;
}

// ============================================================================
// 7. SEMESTER-WIDE COURSE CLO MASTERY & ACCREDITATION MATRIX
// ============================================================================

/**
 * Aggregates cohort performance across all graded labs in a course by Lab, Domain, and CLO.
 * Compatible with CIPS / CILT / AACSB programme assurance reporting.
 */
export function buildCourseCloMasteryMatrix({
  course,
  courseLabs = [],
  assignments = [],
  submissions = [],
  enrolledCount = 0,
  getLabDefFn,
}) {
  const assignMap = new Map((assignments || []).map((a) => [a.id, a]));
  const subsByAssign = new Map();
  (submissions || []).forEach((s) => {
    if (!s?.assignment_id) return;
    if (!subsByAssign.has(s.assignment_id)) subsByAssign.set(s.assignment_id, []);
    subsByAssign.get(s.assignment_id).push(s);
  });

  const labRows = [];
  const cloBuckets = new Map();
  const domainBuckets = new Map();

  for (const cfg of courseLabs || []) {
    const def = getLabDefFn?.(cfg.labId);
    if (!def) continue;
    const assign = cfg.linkedAssignmentId ? assignMap.get(cfg.linkedAssignmentId) : null;
    const subs = assign ? (subsByAssign.get(assign.id) || []) : [];
    const maxMarks = Number(assign?.max_marks || 0);
    const markedSubs = subs.filter((s) => s.marked && s.marks !== null && s.marks !== undefined && maxMarks > 0);
    const pcts = markedSubs.map((s) => Math.max(0, Math.min(100, (Number(s.marks) / maxMarks) * 100)));

    const avgPct = pcts.length ? Number((pcts.reduce((a, b) => a + b, 0) / pcts.length).toFixed(1)) : null;
    const masteryCount = pcts.filter((p) => p >= 70).length;
    const satisfactoryCount = pcts.filter((p) => p >= 50 && p < 70).length;
    const supportCount = pcts.filter((p) => p < 50).length;
    const masteryPct = pcts.length ? Math.round((masteryCount / pcts.length) * 100) : null;
    const completionPct = enrolledCount > 0 ? Math.min(100, Math.round((subs.length / enrolledCount) * 100)) : null;
    const clos = Array.isArray(cfg.mappedClos) && cfg.mappedClos.length ? cfg.mappedClos : ['UNMAPPED'];

    labRows.push({
      labId: def.id,
      code: def.code,
      title: cfg.title || def.title,
      domain: def.domain,
      clos,
      graded: Boolean(assign),
      submittedCount: subs.length,
      markedCount: markedSubs.length,
      completionPct,
      avgPct,
      masteryPct,
      masteryCount,
      satisfactoryCount,
      supportCount,
    });

    const addBucket = (map, key) => {
      if (!map.has(key)) map.set(key, { key, labs: 0, markedSubs: 0, pcts: [] });
      const b = map.get(key);
      b.labs += 1;
      b.markedSubs += markedSubs.length;
      b.pcts.push(...pcts);
    };

    addBucket(domainBuckets, def.domain);
    clos.forEach((clo) => addBucket(cloBuckets, clo));
  }

  const finalizeBuckets = (map) =>
    Array.from(map.values())
      .map((b) => {
        const n = b.pcts.length;
        const avgPct = n ? Number((b.pcts.reduce((x, y) => x + y, 0) / n).toFixed(1)) : null;
        const masteryPct = n ? Math.round((b.pcts.filter((p) => p >= 70).length / n) * 100) : null;
        const supportPct = n ? Math.round((b.pcts.filter((p) => p < 50).length / n) * 100) : null;
        return {
          key: b.key,
          labs: b.labs,
          markedSubs: b.markedSubs,
          avgPct,
          masteryPct,
          supportPct,
          band: avgPct === null ? 'Awaiting Marks' : avgPct >= 70 ? 'Mastery Achieved' : avgPct >= 55 ? 'Developing' : 'Intervention Needed',
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));

  const cloSummary = finalizeBuckets(cloBuckets);
  const domainSummary = finalizeBuckets(domainBuckets);
  const allPcts = labRows.flatMap((r) => (r.avgPct !== null ? [r.avgPct] : []));
  const overallAvgPct = allPcts.length ? Number((allPcts.reduce((a, b) => a + b, 0) / allPcts.length).toFixed(1)) : null;

  return {
    courseCode: course?.code || 'COURSE',
    courseTitle: course?.title || '',
    enrolledCount,
    totalLabs: labRows.length,
    gradedLabs: labRows.filter((r) => r.graded).length,
    overallAvgPct,
    labRows,
    cloSummary,
    domainSummary,
  };
}

export function buildAccreditationEvidenceText(matrix) {
  const lines = [
    `COURSE LAB COMPETENCY & CLO MASTERY REPORT`,
    `Course: ${matrix.courseCode}${matrix.courseTitle ? ` — ${matrix.courseTitle}` : ''}`,
    `Enrolled Cohort: ${matrix.enrolledCount || 'N/A'} | Assigned Labs: ${matrix.totalLabs} (${matrix.gradedLabs} graded)`,
    `Overall Cohort Lab Average: ${matrix.overallAvgPct !== null ? `${matrix.overallAvgPct}%` : 'Awaiting marked submissions'}`,
    '',
    '1. COURSE LEARNING OUTCOME (CLO) MASTERY SUMMARY (Target Mastery >= 70%)',
    ...matrix.cloSummary.map(
      (c) => `- ${c.key}: ${c.labs} lab(s) | ${c.markedSubs} marked submission(s) | Avg ${c.avgPct !== null ? `${c.avgPct}%` : 'N/A'} | Mastery (>=70%): ${c.masteryPct !== null ? `${c.masteryPct}%` : 'N/A'} | Status: ${c.band}`,
    ),
    '',
    '2. DOMAIN COMPETENCY BREAKDOWN (TQM / PSIS / SCM)',
    ...matrix.domainSummary.map(
      (d) => `- ${d.key}: ${d.labs} lab(s) | Avg ${d.avgPct !== null ? `${d.avgPct}%` : 'N/A'} | Mastery: ${d.masteryPct !== null ? `${d.masteryPct}%` : 'N/A'}`,
    ),
    '',
    '3. LAB-BY-LAB PERFORMANCE MATRIX',
    ...matrix.labRows.map(
      (r) =>
        `- ${r.code} (${r.title}) [${r.clos.join(', ')}]: ${r.submittedCount} submitted, ${r.markedCount} marked | Avg ${r.avgPct !== null ? `${r.avgPct}%` : 'N/A'} | Mastery ${r.masteryPct !== null ? `${r.masteryPct}%` : 'N/A'} | Support (<50%): ${r.supportCount}`,
    ),
  ];
  return {
    title: `${matrix.courseCode} — Lab Competency & CLO Accreditation Evidence`,
    body: lines.join('\n'),
  };
}

export function buildAccreditationWorkbookSheets(matrix) {
  return [
    {
      name: 'CLO Mastery Matrix',
      widths: [16, 10, 14, 14, 16, 16, 22],
      rows: [
        ['CLO Code', 'Labs', 'Marked Subs', 'Mean Score %', 'Mastery (>=70%) %', 'Needs Support (<50%) %', 'Assurance Status'],
        ...matrix.cloSummary.map((c) => [
          sanitizeExcelCell(c.key),
          c.labs,
          c.markedSubs,
          c.avgPct ?? 'N/A',
          c.masteryPct ?? 'N/A',
          c.supportPct ?? 'N/A',
          sanitizeExcelCell(c.band),
        ]),
      ],
    },
    {
      name: 'Lab Breakdown',
      widths: [14, 36, 10, 18, 12, 12, 14, 16],
      rows: [
        ['Lab Code', 'Laboratory Title', 'Domain', 'Mapped CLOs', 'Submitted', 'Marked', 'Mean Score %', 'Mastery (>=70%) %'],
        ...matrix.labRows.map((r) => [
          sanitizeExcelCell(r.code),
          sanitizeExcelCell(r.title),
          sanitizeExcelCell(r.domain),
          sanitizeExcelCell(r.clos.join(', ')),
          r.submittedCount,
          r.markedCount,
          r.avgPct ?? 'N/A',
          r.masteryPct ?? 'N/A',
        ]),
      ],
    },
    {
      name: 'Domain Summary',
      widths: [14, 10, 14, 14, 18, 22],
      rows: [
        ['Domain', 'Labs', 'Marked Subs', 'Mean Score %', 'Mastery (>=70%) %', 'Status'],
        ...matrix.domainSummary.map((d) => [
          sanitizeExcelCell(d.key),
          d.labs,
          d.markedSubs,
          d.avgPct ?? 'N/A',
          d.masteryPct ?? 'N/A',
          sanitizeExcelCell(d.band),
        ]),
      ],
    },
  ];
}
