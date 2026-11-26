// Pure deterministic engine for Milestone 8 PSCM E-Class Upgrades (Zero external deps):
// 1. Batch Quantitative Marking & Written Judgement Similarity Detector
// 2. Offline / Low-Bandwidth Submission Resilience Queue (localStorage backed)
// 3. Printable 1-Page Lecturer Facilitation Guide Builder (all 14 labs)
// 4. Student Practical Lab Portfolio PDF Content Builder
// 5. Core Math Engines for 3 New PSCM Labs:
//    - SCM-LAB 01: Global Logistics, Incoterms & Landed Cost Analysis
//    - SCM-LAB 02: Contract Governance, SLA Compliance & Liquidated Damages
//    - SCM-LAB 03: Sustainable Procurement & Carbon Footprint Trade-Offs

import { parseLabVerificationSummary, suggestLabRubricMarks } from './labScoringBridge.js';

// ============================================================================
// 1. BATCH QUANTITATIVE MARKING & JUDGEMENT SIMILARITY DETECTOR
// ============================================================================

/**
 * Scans submitted, unmarked rows for interactive lab reports and produces
 * deterministic quantitative mark suggestions ready for 1-click batch marking.
 */
export function computeBatchLabAutoScores(rows = [], assignMeta = {}, maxMarks = 100) {
  const criteria = Array.isArray(assignMeta?.rubric) ? assignMeta.rubric : [];
  const items = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const sub = r?.sub || r?._synLeaderSub;
    if (!sub || sub.marked) continue;
    const parsed = parseLabVerificationSummary(sub.response_text || '', sub.typing_meta || {});
    if (!parsed) continue;
    const suggestion = suggestLabRubricMarks({ parsed, criteria, maxMarks: Number(maxMarks) || 100 });
    if (!suggestion) continue;
    items.push({
      studentId: r.student_id,
      indexNo: r.index_no,
      name: r.full_name || r.index_no,
      submissionId: sub.id,
      syndicateName: r._syn?.name || null,
      suggestedTotal: suggestion.suggestedTotal,
      quantPct: parsed.quantPct,
      judgementWords: parsed.judgementWords,
      judgementPass: parsed.judgementPass,
      feedbackNote: `${suggestion.feedbackNote}\n[Batch auto-scored quantitative criteria — review written judgement before releasing marks.]`,
    });
  }
  return items;
}

function tokenizeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function makeShingles(words, k = 3) {
  const set = new Set();
  if (words.length < k) {
    if (words.length) set.add(words.join(' '));
    return set;
  }
  for (let i = 0; i <= words.length - k; i++) {
    set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return set;
}

/**
 * Extracts only the student-authored Managerial Judgement section from each lab
 * submission (ignoring shared automated report headers) and detects near-duplicate
 * essays across distinct students or syndicate groups.
 */
export function detectJudgementSimilarityPairs(rows = [], threshold = 0.55) {
  const docs = [];
  const seenSubIds = new Set();

  for (const r of Array.isArray(rows) ? rows : []) {
    const sub = r?.sub;
    if (!sub?.id || seenSubIds.has(sub.id)) continue;
    seenSubIds.add(sub.id);
    const parsed = parseLabVerificationSummary(sub.response_text || '', sub.typing_meta || {});
    const judgement = String(parsed?.judgementExcerpt || '').trim();
    const words = tokenizeWords(judgement);
    if (words.length < 18) continue;
    docs.push({
      subId: sub.id,
      synId: r._syn?.id || null,
      label: r._syn ? `${r._syn.name} (${r.index_no})` : `${r.full_name || r.index_no} (${r.index_no})`,
      words,
      shingles: makeShingles(words, 3),
      preview: judgement.slice(0, 140),
    });
  }

  const pairs = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i];
      const b = docs[j];
      // Skip teammates inside the exact same syndicate
      if (a.synId && b.synId && a.synId === b.synId) continue;
      let intersect = 0;
      for (const sh of a.shingles) {
        if (b.shingles.has(sh)) intersect += 1;
      }
      const union = a.shingles.size + b.shingles.size - intersect;
      const jaccard = union > 0 ? intersect / union : 0;
      if (jaccard >= threshold) {
        pairs.push({
          aLabel: a.label,
          bLabel: b.label,
          similarityPct: Math.round(jaccard * 100),
          sharedPreview: a.preview,
        });
      }
    }
  }

  return pairs.sort((x, y) => y.similarityPct - x.similarityPct);
}

// ============================================================================
// 2. OFFLINE / LOW-BANDWIDTH SUBMISSION RESILIENCE QUEUE
// ============================================================================

export function buildPendingSubmissionKey(assignmentId, userId) {
  return `pscm_pending_lab_sub:${assignmentId || 'none'}:${userId || 'guest'}`;
}

export function savePendingLabSubmission(storage, assignmentId, userId, payload) {
  if (!storage || !assignmentId) return false;
  try {
    const key = buildPendingSubmissionKey(assignmentId, userId);
    storage.setItem(key, JSON.stringify({
      ...payload,
      queuedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function getPendingLabSubmission(storage, assignmentId, userId) {
  if (!storage || !assignmentId) return null;
  try {
    const raw = storage.getItem(buildPendingSubmissionKey(assignmentId, userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPendingLabSubmission(storage, assignmentId, userId) {
  if (!storage || !assignmentId) return;
  try {
    storage.removeItem(buildPendingSubmissionKey(assignmentId, userId));
  } catch {
    // ignore
  }
}

// ============================================================================
// 3. PRINTABLE 1-PAGE LECTURER FACILITATION GUIDE (ALL 14 LABS)
// ============================================================================

const LAB_FACILITATION_NOTES = {
  tqm_spc: {
    traps: [
      'Students quote Cpk > 1.33 even when Rule 1/Rule 2 signals prove the process is unstable.',
      'Confusing specification limits (USL/LSL set by customer) with control limits (UCL/LCL computed from process data).',
    ],
    debrief: [
      'Why does tampering with an in-control process increase variation rather than reduce it?',
      'Which costs less first: re-centering the mean (Cpk → Cp) or buying tighter machinery (reducing σ)?',
    ],
  },
  tqm_tools: {
    traps: [
      'Treating every defect category equally instead of focusing on the Pareto vital few (~80%).',
      'Mistaking correlation r in a scatter plot for proven root-cause causation.',
    ],
    debrief: [
      'How did Stratification reveal a hidden shift/machine effect that aggregate counts concealed?',
      'How do the 7 tools connect sequentially from Check Sheet → Pareto → Fishbone → Action Plan?',
    ],
  },
  tqm_coq: {
    traps: [
      'Classifying incoming inspection as Prevention instead of Appraisal.',
      'Ignoring hidden iceberg costs (lost customer goodwill, expediting, capacity loss).',
    ],
    debrief: [
      'Why does cutting Appraisal without raising Prevention cause External Failure to spike?',
      'Contrast the Classical COQ U-curve against the Modern TQM zero-defect curve.',
    ],
  },
  psis_the_whip: {
    traps: [
      'Panic over-ordering when pipeline/in-transit stock is ignored during a rumour spike.',
      'Focusing solely on inventory holding cost while ignoring backlog/stockout penalties.',
    ],
    debrief: [
      'Compare Factory Bullwhip Ratio in Blind Mode vs. Shared POS Mode on the projector.',
      'How does paper-based order latency magnify oscillation even when demand is flat?',
    ],
  },
  psis_seven_names: {
    traps: [
      'Creating quick free-text SKUs under receiving queue pressure instead of searching existing master codes.',
      'Overlooking how fragmented stock across duplicate SKUs triggers unnecessary emergency POs.',
    ],
    debrief: [
      'Reveal the live classroom duplicate cluster count and ask students why synonyms multiply so quickly.',
      'What ERP master data governance gate (steward approval, fuzzy match, GTIN scan) stops duplicates?',
    ],
  },
  psis_scan_it: {
    traps: [
      'Assuming GS1 prefix 603 means "Manufactured in Ghana" rather than "Licensed via GS1 Ghana".',
      'Forgetting alternating 3-and-1 Mod-10 weights start from the rightmost payload digit.',
    ],
    debrief: [
      'Demonstrate the Transposition Trap live to prove why manual keying fails silently without check digits.',
      'When should supply chains upgrade from EAN-13 to GS1-128 or 2D DataMatrix (batch/expiry)?',
    ],
  },
  psis_the_match: {
    traps: [
      'Approving invoices matching PO quantity when GRN received quantity was short-shipped.',
      'Believing automated 3-way matching prevents fraud when one user holds Super-User rights.',
    ],
    debrief: [
      'Ask the class why a 100% passing 3-way match paid a Ghost Vendor during the Super-User demo.',
      'Design a minimum Segregation of Duties matrix for a 3-person vs. 10-person procurement team.',
    ],
  },
  psis_req_to_order: {
    traps: [
      'Missing split-order avoidance where two back-to-back requisitions sit just below a DoA threshold.',
      'Assuming Spent-Only accounting blocks double-commitment before invoices arrive.',
    ],
    debrief: [
      'Show the exact moment Spent-Only accounting allowed a department to over-commit its budget.',
      'Use the Blanket Order break-even point to decide when framework agreements beat standard POs.',
    ],
  },
  psis_the_tender: {
    traps: [
      'Selecting the lowest raw bid price without checking technical compliance or cost-floor sustainability.',
      'Adjusting evaluation weights after opening sealed financial envelopes (procurement integrity breach).',
    ],
    debrief: [
      'Highlight any Live Reverse Auction bids below the sustainable cost floor (Winner’s Curse).',
      'When should buyers run a Reverse Auction vs. Quality-and-Cost-Based Selection (QCBS)?',
    ],
  },
  psis_inventory_wms: {
    traps: [
      'Expecting Safety Stock to grow linearly from 95% to 99.9% service level (z jumps 1.645 → 3.09).',
      'Using net unit variance across bins to declare "good accuracy" when positive and negative errors cancel out.',
    ],
    debrief: [
      'Differentiate replenishment rules across AX, AZ, and CZ quadrants of the ABC-XYZ matrix.',
      'Why does continuous ABC cycle counting outperform annual wall-to-wall shutdown stocktakes?',
    ],
  },
  psis_spend_analytics: {
    traps: [
      'Confusing Maverick (off-contract) spend with Tail spend (bottom 20% fragmented suppliers).',
      'Ranking suppliers purely on unit price while ignoring high Defect PPM and poor OTIF delivery.',
    ],
    debrief: [
      'Show how shifting scorecard weights changes which supplier lands on Preferred vs. Watchlist.',
      'Demonstrate upstream continuity by importing a P2P/Requisition export directly into the Spend Cube.',
    ],
  },
  scm_landed_cost: {
    traps: [
      'Comparing suppliers on FOB price while ignoring freight, marine insurance, import duties, and port demurrage.',
      'Confusing cost transfer point with risk transfer point under C-terms (CIF/CIP risk transfers at origin port!).',
    ],
    debrief: [
      'Show a case where a cheaper FOB offshore supplier becomes MORE expensive on DDP landed cost than a regional supplier.',
      'How does transit-time working capital cost change the Sea vs. Air freight decision for high-value items?',
    ],
  },
  scm_contract_sla: {
    traps: [
      'Applying unlimited penalties without respecting the contractual liquidated damages cap.',
      'Forgetting to compare penalty enforcement against supplier switching costs and service continuity risk.',
    ],
    debrief: [
      'At what point do recurring SLA breaches cross from Service Credits into Material Breach / Termination?',
      'How should a contract manager handle a legitimate Force Majeure event vs. chronic supplier negligence?',
    ],
  },
  scm_green_procurement: {
    traps: [
      'Ignoring Scope 3 inbound logistics emissions (air freight emits ~40× more CO₂e per tonne-km than ocean freight).',
      'Evaluating green options without calculating implied Carbon Abatement Cost (cost per tonne CO₂e saved).',
    ],
    debrief: [
      'Show how introducing a realistic Shadow Carbon Price flips the lowest-cost supplier ranking.',
      'How can buyers balance budget constraints, local content, and corporate net-zero targets transparently?',
    ],
  },
};

export function buildLecturerFacilitationGuide(labDef, conceptGuide = null) {
  if (!labDef) return { title: 'Lecturer Facilitation Guide', body: '' };
  const notes = LAB_FACILITATION_NOTES[labDef.id] || {
    traps: ['Focusing on raw outputs without linking findings to managerial action.'],
    debrief: ['Ask groups to defend their quantitative conclusions and trade-offs.'],
  };
  const lines = [
    `LECTURER FACILITATION GUIDE — ${labDef.code}: ${labDef.title}`,
    `Domain: ${labDef.domain} | Recommended Duration: ${labDef.duration || '60 min'} | Live Classroom Mode: ${labDef.supportsLiveClassroom ? 'Available' : 'Solo / Syndicate Workbench'}`,
    '',
    '1. CORE LEARNING OBJECTIVE & LAB SCOPE',
    `   ${labDef.summary}`,
    '',
    '2. SUGGESTED 60-MINUTE SESSION PACING',
    '   • 00–10 min: Framing & Core Theory — Review key formulas and real-world industry failure examples.',
    '   • 10–35 min: Hands-On Execution — Students run the lab (Solo, Syndicate Group, or Live Projector Mode) using starter presets or your uploaded course CSV/Excel.',
    '   • 35–48 min: Written Managerial Judgement — Students synthesize numbers into concrete operational recommendations.',
    '   • 48–60 min: Class-Wide Debrief — Open Assignment Marking → Class Debrief Analytics (or Live Projector stage) to compare outcomes.',
    '',
    '3. KEY FORMULAS & CONCEPT CHECKLIST',
    ...(conceptGuide?.formulas || ['Refer to the interactive Formula & Concept Guide drawer inside the lab.']).map((f) => `   • ${f}`),
    '',
    '4. COMMON STUDENT TRAPS TO WATCH FOR',
    ...notes.traps.map((t) => `   • ${t}`),
    '',
    '5. HIGH-IMPACT POST-LAB DEBRIEF & VIVA PROMPTS',
    ...notes.debrief.map((d, i) => `   ${i + 1}. ${d}`),
    '',
    '6. ASSESSMENT RUBRIC STRUCTURE (100% WEIGHTING)',
    ...(labDef.rubricCriteria || []).map((c) => `   • ${c.title} (${c.maxMarks}%)`),
  ];

  return {
    title: `${labDef.code} Facilitation Guide — ${labDef.shortTitle}`,
    body: lines.join('\n'),
  };
}

// ============================================================================
// 4. STUDENT PRACTICAL LAB PORTFOLIO BUILDER
// ============================================================================

export function buildStudentLabPortfolioText({ course, profile, openLabs = [], assignById, getLabDefFn }) {
  const studentName = profile?.full_name || 'Student';
  const indexNo = profile?.index_no || '—';
  const courseLine = course ? `${course.code} — ${course.title}` : 'PSCM E-Class Practical Laboratories';
  const completedRows = [];
  const allClos = new Set();

  for (const cfg of openLabs) {
    const def = getLabDefFn?.(cfg.labId);
    if (!def) continue;
    const linked = cfg.linkedAssignmentId ? assignById?.get(cfg.linkedAssignmentId) : null;
    const sub = linked?.submission || null;
    const markedReleased = Boolean(sub?.marked && (linked?.released || linked?.results_released));
    (cfg.mappedClos || []).forEach((c) => allClos.add(c));
    completedRows.push({
      code: def.code,
      title: cfg.title || def.title,
      domain: def.domain,
      clos: cfg.mappedClos || [],
      status: linked
        ? (markedReleased ? `Marked (${sub.marks}/${linked.max_marks})` : sub ? 'Submitted (Pending Release)' : 'Assigned (Not Submitted)')
        : 'Practice Lab Available',
      submittedAt: sub?.submitted_at || sub?.created_at || null,
      isCompleted: Boolean(sub),
    });
  }

  const submittedCount = completedRows.filter((r) => r.isCompleted).length;
  const lines = [
    'PRACTICAL SUPPLY CHAIN & QUALITY LABORATORY PORTFOLIO',
    `Student: ${studentName} (${indexNo})`,
    `Course: ${courseLine}`,
    `Generated: ${new Date().toLocaleDateString()} | Labs Completed / Submitted: ${submittedCount} of ${completedRows.length}`,
    allClos.size > 0 ? `Mapped Course Learning Outcomes (CLOs): ${[...allClos].join(', ')}` : 'Competency Track: Applied Operations, Quality & Procurement Systems',
    '',
    'LABORATORY RECORD & VERIFICATION STATUS',
    '------------------------------------------------------------------------',
    ...completedRows.map((r, idx) => [
      `${idx + 1}. [${r.code}] ${r.title}`,
      `   Domain: ${r.domain} | Status: ${r.status}${r.clos.length ? ` | CLOs: ${r.clos.join(', ')}` : ''}`,
    ].join('\n')),
    '',
    'PROFESSIONAL COMPETENCY SUMMARY',
    'This portfolio certifies hands-on completion of deterministic quantitative simulations, internal control audits, and written managerial judgements inside the PSCM E-Class Interactive Laboratory Suite.',
  ];

  return {
    title: `${course?.code || 'PSCM'} Practical Lab Portfolio — ${studentName}`,
    body: lines.join('\n'),
    submittedCount,
    totalCount: completedRows.length,
  };
}

// ============================================================================
// 5A. SCM-LAB 01: GLOBAL LOGISTICS, INCOTERMS & LANDED COST ENGINE
// ============================================================================

export const INCOTERM_DEFS = {
  EXW: { name: 'Ex Works', sellerStages: ['exw'], riskPoint: 'Seller’s factory gate / warehouse' },
  FCA: { name: 'Free Carrier', sellerStages: ['exw', 'originInland', 'exportClearance'], riskPoint: 'Named carrier / origin terminal' },
  FOB: { name: 'Free On Board', sellerStages: ['exw', 'originInland', 'exportClearance'], riskPoint: 'On board vessel at port of shipment' },
  CIF: { name: 'Cost, Insurance & Freight', sellerStages: ['exw', 'originInland', 'exportClearance', 'mainFreight', 'insurance'], riskPoint: 'On board vessel at origin port (cost paid to destination port!)' },
  CIP: { name: 'Carriage & Insurance Paid To', sellerStages: ['exw', 'originInland', 'exportClearance', 'mainFreight', 'insurance'], riskPoint: 'First carrier at origin (higher all-risk insurance cover)' },
  DAP: { name: 'Delivered at Place', sellerStages: ['exw', 'originInland', 'exportClearance', 'mainFreight', 'insurance', 'destPort', 'destInland'], riskPoint: 'Named destination place (ready for unloading, buyer clears import duty)' },
  DDP: { name: 'Delivered Duty Paid', sellerStages: ['exw', 'originInland', 'exportClearance', 'mainFreight', 'insurance', 'destPort', 'importDuty', 'importVat', 'destInland'], riskPoint: 'Buyer’s warehouse (maximum seller obligation)' },
};

/**
 * Computes full Incoterms 2020 cost waterfall & per-unit Landed Cost for a shipment route.
 * Follows standard customs valuation: CIF = FOB + Main Freight + Marine Insurance (on 110% of CFR).
 */
export function computeLandedCostRoute(route = {}) {
  const qty = Math.max(1, Number(route.qty) || 1);
  const unitExw = Math.max(0, Number(route.unitExw) || 0);
  const exwTotal = qty * unitExw;
  const originInland = Math.max(0, Number(route.originInland) || 0);
  const exportClearance = Math.max(0, Number(route.exportClearance) || 0);
  const fobValue = exwTotal + originInland + exportClearance;

  const mainFreight = Math.max(0, Number(route.mainFreight) || 0);
  const cfrValue = fobValue + mainFreight;
  const insuranceRatePct = Math.max(0, Number(route.insuranceRatePct ?? 0.6));
  const insurance = Number(((cfrValue * 1.1) * (insuranceRatePct / 100)).toFixed(2));
  const cifValue = cfrValue + insurance;

  const dutyRatePct = Math.max(0, Number(route.dutyRatePct ?? 10));
  const vatRatePct = Math.max(0, Number(route.vatRatePct ?? 15));
  const importDuty = Number((cifValue * (dutyRatePct / 100)).toFixed(2));
  const importVat = Number(((cifValue + importDuty) * (vatRatePct / 100)).toFixed(2));

  const destPort = Math.max(0, Number(route.destPort) || 0);
  const destInland = Math.max(0, Number(route.destInland) || 0);

  const transitDays = Math.max(0, Number(route.transitDays) || 0);
  const annualHoldingPct = Math.max(0, Number(route.annualHoldingPct ?? 18));
  const pipelineHoldingCost = Number((cifValue * (annualHoldingPct / 100) * (transitDays / 365)).toFixed(2));

  const totalLandedCost = Number((cifValue + importDuty + importVat + destPort + destInland).toFixed(2));
  const totalEconomicCost = Number((totalLandedCost + pipelineHoldingCost).toFixed(2));
  const landedPerUnit = Number((totalLandedCost / qty).toFixed(2));
  const economicPerUnit = Number((totalEconomicCost / qty).toFixed(2));
  const upliftPct = exwTotal > 0 ? Number((((totalLandedCost - exwTotal) / exwTotal) * 100).toFixed(1)) : 0;

  const incoterm = INCOTERM_DEFS[route.incoterm] ? route.incoterm : 'FOB';
  const def = INCOTERM_DEFS[incoterm];
  const stageCosts = {
    exw: exwTotal,
    originInland,
    exportClearance,
    mainFreight,
    insurance,
    destPort,
    importDuty,
    importVat,
    destInland,
  };
  let sellerInvoiceQuote = 0;
  let buyerExtraLogistics = 0;
  for (const [k, val] of Object.entries(stageCosts)) {
    if (def.sellerStages.includes(k)) sellerInvoiceQuote += val;
    else buyerExtraLogistics += val;
  }

  return {
    id: route.id || 'route',
    name: String(route.name || 'Import Route'),
    mode: String(route.mode || 'Ocean'),
    incoterm,
    riskPoint: def.riskPoint,
    qty,
    transitDays,
    exwTotal: Number(exwTotal.toFixed(2)),
    fobValue: Number(fobValue.toFixed(2)),
    cifValue: Number(cifValue.toFixed(2)),
    mainFreight: Number(mainFreight.toFixed(2)),
    insurance,
    importDuty,
    importVat,
    destPort: Number(destPort.toFixed(2)),
    destInland: Number(destInland.toFixed(2)),
    pipelineHoldingCost,
    sellerInvoiceQuote: Number(sellerInvoiceQuote.toFixed(2)),
    buyerExtraLogistics: Number(buyerExtraLogistics.toFixed(2)),
    totalLandedCost,
    totalEconomicCost,
    landedPerUnit,
    economicPerUnit,
    upliftPct,
  };
}

export function compareLandedCostRoutes(routes = []) {
  const computed = (Array.isArray(routes) ? routes : []).map(computeLandedCostRoute);
  const byLanded = [...computed].sort((a, b) => a.totalLandedCost - b.totalLandedCost);
  const byEconomic = [...computed].sort((a, b) => a.totalEconomicCost - b.totalEconomicCost);
  const byFob = [...computed].sort((a, b) => a.fobValue - b.fobValue);
  const lowestLanded = byLanded[0] || null;
  const lowestEconomic = byEconomic[0] || null;
  const lowestFob = byFob[0] || null;
  const fobTrapDetected = Boolean(lowestFob && lowestLanded && lowestFob.id !== lowestLanded.id);
  return {
    routes: computed,
    lowestLanded,
    lowestEconomic,
    lowestFob,
    fobTrapDetected,
  };
}

// ============================================================================
// 5B. SCM-LAB 02: CONTRACT GOVERNANCE, SLA COMPLIANCE & LIQUIDATED DAMAGES
// ============================================================================

export function evaluateContractSla(params = {}, periods = []) {
  const contractValue = Math.max(1000, Number(params.contractValue) || 600000);
  const targetOtifPct = Math.max(50, Math.min(100, Number(params.targetOtifPct ?? 95)));
  const maxDefectPct = Math.max(0.1, Number(params.maxDefectPct ?? 2.0));
  const maxResponseHrs = Math.max(1, Number(params.maxResponseHrs ?? 24));
  const ldRatePerOtifPct = Math.max(0, Number(params.ldRatePerOtifPct ?? 0.5)); // % of period invoice per 1% OTIF miss
  const defectPenaltyFlat = Math.max(0, Number(params.defectPenaltyFlat ?? 1500));
  const responsePenaltyFlat = Math.max(0, Number(params.responsePenaltyFlat ?? 1000));
  const ldCapPct = Math.max(1, Math.min(50, Number(params.ldCapPct ?? 10)));
  const switchingCost = Math.max(0, Number(params.switchingCost ?? 45000));
  const terminationStreakTarget = Math.max(2, Number(params.terminationStreakTarget ?? 3));

  const capAmount = Number((contractValue * (ldCapPct / 100)).toFixed(2));
  const list = Array.isArray(periods) ? periods : [];
  let cumulativeRawLd = 0;
  let consecutiveBreaches = 0;
  let maxBreachStreak = 0;
  let breachPeriods = 0;
  let forceMajeureProtected = 0;
  let otifSum = 0;

  const evaluatedPeriods = list.map((p, idx) => {
    const invoiceVal = Math.max(0, Number(p.invoiceValue) || Math.round(contractValue / Math.max(1, list.length)));
    const otifPct = Math.max(0, Math.min(100, Number(p.otifPct ?? 100)));
    const defectPct = Math.max(0, Number(p.defectPct ?? 0));
    const responseHrs = Math.max(0, Number(p.responseHrs ?? 0));
    const forceMajeure = Boolean(p.forceMajeure);

    otifSum += otifPct;
    const otifMiss = Math.max(0, Number((targetOtifPct - otifPct).toFixed(2)));
    const defectBreach = defectPct > maxDefectPct;
    const responseBreach = responseHrs > maxResponseHrs;
    const anyMiss = otifMiss > 0 || defectBreach || responseBreach;

    let rawPenalty = 0;
    if (anyMiss && !forceMajeure) {
      rawPenalty += invoiceVal * ((otifMiss * ldRatePerOtifPct) / 100);
      if (defectBreach) rawPenalty += defectPenaltyFlat;
      if (responseBreach) rawPenalty += responsePenaltyFlat;
      breachPeriods += 1;
      consecutiveBreaches += 1;
      if (consecutiveBreaches > maxBreachStreak) maxBreachStreak = consecutiveBreaches;
    } else {
      if (anyMiss && forceMajeure) forceMajeureProtected += 1;
      consecutiveBreaches = 0;
    }

    rawPenalty = Number(rawPenalty.toFixed(2));
    cumulativeRawLd += rawPenalty;

    return {
      id: p.id || `P${idx + 1}`,
      period: String(p.period || `Month ${idx + 1}`),
      invoiceValue: invoiceVal,
      otifPct,
      defectPct,
      responseHrs,
      forceMajeure,
      otifMiss,
      defectBreach,
      responseBreach,
      status: !anyMiss ? 'COMPLIANT' : forceMajeure ? 'FORCE MAJEURE EXCUSED' : 'SLA BREACH',
      rawPenalty,
    };
  });

  const cappedLd = Number(Math.min(capAmount, cumulativeRawLd).toFixed(2));
  const capHit = cumulativeRawLd > capAmount;
  const materialBreachTriggered = maxBreachStreak >= terminationStreakTarget || capHit;
  const avgOtifPct = list.length ? Number((otifSum / list.length).toFixed(1)) : 100;
  const complianceRatePct = list.length ? Number((((list.length - breachPeriods) / list.length) * 100).toFixed(1)) : 100;
  const recommendedAction = materialBreachTriggered
    ? (cappedLd >= switchingCost * 0.5 ? 'Issue Cure Notice / Prepare Controlled Termination' : 'Enforce Capped Credits + Dual-Source Transition')
    : breachPeriods > 0
      ? 'Apply Service Credits & Mandate 30-Day CAPA Review'
      : 'Maintain Contract & Recognize SLA Compliance';

  return {
    periods: evaluatedPeriods,
    contractValue,
    capAmount,
    cumulativeRawLd: Number(cumulativeRawLd.toFixed(2)),
    cappedLd,
    capHit,
    breachPeriods,
    forceMajeureProtected,
    maxBreachStreak,
    materialBreachTriggered,
    avgOtifPct,
    complianceRatePct,
    switchingCost,
    recommendedAction,
  };
}

// ============================================================================
// 5C. SCM-LAB 03: SUSTAINABLE PROCUREMENT & CARBON FOOTPRINT TRADE-OFFS
// ============================================================================

// Standard kg CO2e per tonne-km by transport mode (DEFRA/GLEC simplified teaching benchmarks)
export const MODE_EMISSION_FACTORS = {
  Sea: 0.016,
  Rail: 0.028,
  Road: 0.096,
  Air: 0.602,
};

export function evaluateGreenProcurement(suppliers = [], opts = {}) {
  const shadowCarbonPrice = Math.max(0, Number(opts.shadowCarbonPrice ?? 85)); // currency per tonne CO2e
  const annualTonnes = Math.max(1, Number(opts.annualTonnes ?? 120));
  const carbonBudgetTonnes = Math.max(1, Number(opts.carbonBudgetTonnes ?? 90));
  const weights = opts.weights || { cost: 40, carbon: 30, circular: 15, ethics: 15 };
  const wSum = (Number(weights.cost) || 0) + (Number(weights.carbon) || 0) + (Number(weights.circular) || 0) + (Number(weights.ethics) || 0) || 100;

  const computed = (Array.isArray(suppliers) ? suppliers : []).map((s, idx) => {
    const unitPricePerTonne = Math.max(1, Number(s.unitPricePerTonne) || 1000);
    const directAnnualSpend = Number((unitPricePerTonne * annualTonnes).toFixed(2));
    const mfgKgPerTonne = Math.max(0, Number(s.mfgKgCo2PerTonne ?? 420));
    const distanceKm = Math.max(0, Number(s.distanceKm ?? 500));
    const mode = MODE_EMISSION_FACTORS[s.mode] ? s.mode : 'Road';
    const factor = MODE_EMISSION_FACTORS[mode];

    const scope12Tonnes = Number(((mfgKgPerTonne * annualTonnes) / 1000).toFixed(2));
    const scope3TransportTonnes = Number(((distanceKm * factor * annualTonnes) / 1000).toFixed(2));
    const totalCo2Tonnes = Number((scope12Tonnes + scope3TransportTonnes).toFixed(2));
    const carbonCost = Number((totalCo2Tonnes * shadowCarbonPrice).toFixed(2));
    const carbonAdjustedCost = Number((directAnnualSpend + carbonCost).toFixed(2));
    const recyclablePct = Math.max(0, Math.min(100, Number(s.recyclablePct ?? 50)));
    const ethicsScore = Math.max(0, Math.min(100, Number(s.ethicsScore ?? 75)));
    const withinBudget = totalCo2Tonnes <= carbonBudgetTonnes;

    return {
      id: s.id || `g_${idx + 1}`,
      name: String(s.name || `Supplier ${idx + 1}`),
      origin: String(s.origin || 'Regional'),
      mode,
      distanceKm,
      unitPricePerTonne,
      directAnnualSpend,
      scope12Tonnes,
      scope3TransportTonnes,
      totalCo2Tonnes,
      carbonCost,
      carbonAdjustedCost,
      recyclablePct,
      ethicsScore,
      withinBudget,
    };
  });

  if (!computed.length) {
    return { suppliers: [], cheapestDirect: null, lowestCarbon: null, bestCarbonAdjusted: null, bestEsgComposite: null, carbonPriceFlipsWinner: false };
  }

  const minDirect = Math.min(...computed.map((x) => x.directAnnualSpend));
  const minCo2 = Math.min(...computed.map((x) => x.totalCo2Tonnes));
  const maxCo2 = Math.max(...computed.map((x) => x.totalCo2Tonnes));

  const scored = computed.map((s) => {
    const costScore = s.directAnnualSpend > 0 ? Math.min(100, (minDirect / s.directAnnualSpend) * 100) : 100;
    const carbonScore = maxCo2 > minCo2 ? 100 - ((s.totalCo2Tonnes - minCo2) / (maxCo2 - minCo2)) * 100 : 100;
    const esgComposite = Number((
      (costScore * (Number(weights.cost) || 0) +
       carbonScore * (Number(weights.carbon) || 0) +
       s.recyclablePct * (Number(weights.circular) || 0) +
       s.ethicsScore * (Number(weights.ethics) || 0)) / wSum
    ).toFixed(1));
    return { ...s, esgComposite };
  });

  const cheapestDirect = [...scored].sort((a, b) => a.directAnnualSpend - b.directAnnualSpend)[0];
  const lowestCarbon = [...scored].sort((a, b) => a.totalCo2Tonnes - b.totalCo2Tonnes)[0];
  const bestCarbonAdjusted = [...scored].sort((a, b) => a.carbonAdjustedCost - b.carbonAdjustedCost)[0];
  const bestEsgComposite = [...scored].sort((a, b) => b.esgComposite - a.esgComposite)[0];

  const withAbatement = scored.map((s) => {
    const co2Saved = Number((cheapestDirect.totalCo2Tonnes - s.totalCo2Tonnes).toFixed(2));
    const greenPremium = Number((s.directAnnualSpend - cheapestDirect.directAnnualSpend).toFixed(2));
    const abatementCostPerTonne = co2Saved > 0 ? Number((greenPremium / co2Saved).toFixed(2)) : null;
    return { ...s, co2SavedVsCheapest: co2Saved, greenPremiumVsCheapest: greenPremium, abatementCostPerTonne };
  });

  return {
    suppliers: withAbatement.sort((a, b) => b.esgComposite - a.esgComposite),
    cheapestDirect,
    lowestCarbon,
    bestCarbonAdjusted,
    bestEsgComposite,
    carbonPriceFlipsWinner: Boolean(cheapestDirect && bestCarbonAdjusted && cheapestDirect.id !== bestCarbonAdjusted.id),
    shadowCarbonPrice,
    carbonBudgetTonnes,
  };
}
