// Pure deterministic bridge between Interactive Software Labs and PSCM E-Class
// Assignment Marking / Rubrics / Concept Guides (Zero external deps).

export const LAB_TRACK_META = {
  tqm_spc: { track: 'Quality Control', accent: '#0f766e', stage: 'Statistical Control' },
  tqm_tools: { track: 'Quality Improvement', accent: '#0f766e', stage: 'Root-Cause Analysis' },
  tqm_coq: { track: 'Quality Economics', accent: '#0f766e', stage: 'PAF & ROI' },
  psis_the_whip: { track: 'Information Flows', accent: '#1d4ed8', stage: 'Demand Visibility' },
  psis_seven_names: { track: 'Master Data', accent: '#1d4ed8', stage: 'Data Hygiene' },
  psis_scan_it: { track: 'AIDC & Traceability', accent: '#1d4ed8', stage: 'GS1 Standards' },
  psis_the_match: { track: 'P2P & Internal Controls', accent: '#b45309', stage: '3-Way Match & SoD' },
  psis_req_to_order: { track: 'Procurement Governance', accent: '#b45309', stage: 'DoA & Commitments' },
  psis_the_tender: { track: 'Strategic Sourcing', accent: '#7c3aed', stage: 'e-Sourcing & Auctions' },
  psis_inventory_wms: { track: 'Inventory & WMS', accent: '#0f766e', stage: 'EOQ, ABC-XYZ & Audit' },
  psis_spend_analytics: { track: 'Spend Intelligence', accent: '#7c3aed', stage: 'Scorecards & Pareto' },
};

export const LAB_CONCEPT_GUIDES = {
  tqm_spc: {
    title: 'SPC Control Charts & Capability Quick Reference',
    formulas: [
      'X̄-Chart: UCL = X̿ + A₂·R̄  |  LCL = X̿ − A₂·R̄',
      'R-Chart: UCL = D₄·R̄  |  LCL = D₃·R̄',
      'p-Chart: UCL/LCL = p̄ ± 3·√(p̄(1 − p̄) / n)',
      'Process Capability: Cp = (USL − LSL) / 6σ̂  |  Cpk = min((USL − μ)/3σ̂, (μ − LSL)/3σ̂)',
    ],
    checklist: [
      'Distinguish special-cause signals (Rule 1 beyond ±3σ, 7-point runs) from common-cause noise.',
      'Never quote Cpk without first confirming the process is in statistical control.',
    ],
  },
  tqm_tools: {
    title: '7 Basic Tools of Quality Quick Reference',
    formulas: [
      'Pareto 80/20 Rule: Cumulative % = (Running Sum of Defect Counts / Total Defects) × 100',
      'Correlation r = Σ(x − x̄)(y − ȳ) / √[Σ(x − x̄)² · Σ(y − ȳ)²]',
    ],
    checklist: [
      'Identify the "vital few" defect categories accounting for ~80% of total volume.',
      'Pair Pareto prioritization with Ishikawa (6M) root causes before proposing fixes.',
    ],
  },
  tqm_coq: {
    title: 'Cost of Quality (PAF Model) Quick Reference',
    formulas: [
      'Total COQ = Prevention + Appraisal + Internal Failure + External Failure',
      'Conformance Cost = Prevention + Appraisal  |  Non-Conformance = Internal + External Failure',
      'COQ % of Revenue = (Total COQ / Revenue) × 100',
    ],
    checklist: [
      'External failure costs (warranty, returns, lost goodwill) are the most expensive defects to fix.',
      'Use the What-If ROI slider to prove how modest prevention investments shrink total COQ.',
    ],
  },
  psis_the_whip: {
    title: 'Bullwhip Effect & POS Visibility Quick Reference',
    formulas: [
      'Bullwhip Ratio (BWR) = Var(Orders Placed) / Var(End-Consumer Demand)',
      'Coefficient of Variation (CV) = Standard Deviation / Mean',
    ],
    checklist: [
      'Compare Factory BWR and Total Chain Cost between Blind Mode and Shared POS Mode.',
      'Explain how Paper-Mode latency (order-processing lag) compounds batching and panic ordering.',
    ],
  },
  psis_seven_names: {
    title: 'Master Data Governance & Duplicate Hygiene Quick Reference',
    formulas: [
      'Master Data Hygiene Score = (Unique Physical Items / Total SKU Records) × 100%',
      'Duplicate Rate = (Extra Duplicate Records / Total SKU Records) × 100%',
    ],
    checklist: [
      'Search existing SKUs before creating new records during receiving.',
      'Show how split stock across duplicate SKUs triggers unnecessary emergency reorders.',
    ],
  },
  psis_scan_it: {
    title: 'GS1 GTIN Structure & Mod-10 Check Digit Quick Reference',
    formulas: [
      'GS1 Mod-10 Weights (from right payload digit): alternating 3, 1, 3, 1, ...',
      'Check Digit = (10 − (Weighted Sum mod 10)) mod 10',
      'Key GS1 Prefixes: 603 = GS1 Ghana | 615 = GS1 Nigeria | 600–601 = GS1 South Africa',
    ],
    checklist: [
      'GS1 prefix identifies the licensing Member Organization, NOT necessarily country of manufacture.',
      'Trigger the Transposition Trap to prove Mod-10 catches adjacent digit swaps automatically.',
    ],
  },
  psis_the_match: {
    title: 'P2P 3-Way Match & Segregation of Duties Quick Reference',
    formulas: [
      '3-Way Match Gate: PO Approved + GRN Posted + |InvQty − GRNQty| ≤ Tol + |InvPrice − POPrice| ≤ Tol + Budget Sufficient + Not Duplicate',
      'Toxic SoD Pairings: Vendor Create + Payment Release | PO Approve + GRN Post',
    ],
    checklist: [
      'Audit every invoice packet before checking answers, then run the Super-User Ghost-Vendor demo.',
      'Explain why a perfect 3-way match still pays a ghost vendor if one account holds all four roles.',
    ],
  },
  psis_req_to_order: {
    title: 'Delegation of Authority, Commitments & Blanket Orders',
    formulas: [
      'Available Budget (Commitment Accounting) = Budget − Actual Spent − Open PO Commitments',
      'Blanket Order Break-Even POs = Setup Cost / (Standard PO Cost − Call-Off Release Cost)',
    ],
    checklist: [
      'Watch for split-order avoidance (multiple requisitions to the same supplier just below a DoA tier).',
      'Contrast Spent-Only vs. Commitment Accounting to show how double-commitment occurs.',
    ],
  },
  psis_the_tender: {
    title: 'Weighted Multi-Criteria Evaluation & Reverse Auctions',
    formulas: [
      'Price Score = (Lowest Bid / Supplier Bid) × 100',
      'Composite Score = Σ(Normalized Weight_i × Criterion Score_i)',
      'Winner’s Curse Risk: Final Auction Bid < Supplier Sustainable Cost Floor',
    ],
    checklist: [
      'Compare Lowest-Price award vs. Best-Value weighted award across criteria weight profiles.',
      'Diagnose whether reverse auction savings push a bidder below sustainable delivery cost.',
    ],
  },
  psis_inventory_wms: {
    title: 'EOQ, Safety Stock, ABC-XYZ & Cycle Count Quick Reference',
    formulas: [
      'EOQ (Q*) = √(2 · D · S / H)   where H = Unit Cost × Holding Rate %',
      'Safety Stock (SS) = z · σ_d · √L   |   Reorder Point (ROP) = (d̄ · L) + SS',
      'Cycle Count Bin Accuracy = (Bins Within Tolerance / Total Bins Audited) × 100%',
    ],
    checklist: [
      'Note the nonlinear z-score jump from 95% (1.645) to 99.9% (3.09) service level.',
      'Differentiate AX (JIT/Blanket) from AZ (Make-to-Order) and CZ (Spot Buy/Rationalize).',
    ],
  },
  psis_spend_analytics: {
    title: 'Supplier KPI Scorecards & Spend Cube Diagnostics',
    formulas: [
      'Quality Score (0–100) = max(0, 100 − Defect_PPM / 250)',
      'Maverick Spend % = (Off-Contract Annual Spend / Total Annual Spend) × 100%',
      'Tail Spend = Suppliers sitting in the bottom 20% of cumulative spend',
    ],
    checklist: [
      'Test weight sensitivity between OTIF, Quality PPM, Price Variance, and Responsiveness.',
      'Import CSV exports from The Match or Requisition to Order to demonstrate end-to-end data continuity.',
    ],
  },
};

/**
 * Parses an interactive lab submission (response_text + typing_meta) into structured
 * marking evidence for AssignmentMarking.jsx.
 */
export function parseLabVerificationSummary(responseText = '', typingMeta = {}) {
  const text = String(responseText || '');
  const isLab =
    typingMeta?.source === 'interactive_lab' ||
    Boolean(typingMeta?.labReport) ||
    text.includes('[AUTO-SCORED LAB VERIFICATION SUMMARY');

  if (!isLab) return null;

  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };

  const moduleLine = pick(/^Module:\s*([^\n]+)/im);
  const evidenceLine = pick(/^Quantitative Evidence Extracted:\s*([^\n]+)/im);
  const judgeLine = pick(/^Written Managerial Judgement Check:\s*([^\n]+)/im);

  const metrics = [];
  if (evidenceLine && !/Completed interactive workbench output/i.test(evidenceLine)) {
    evidenceLine.split('|').forEach((part) => {
      const idx = part.indexOf(':');
      if (idx > 0) {
        const label = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (label && value) metrics.push({ label, value });
      }
    });
  }

  // Fallback extraction directly from body if header was absent (older Milestone 1-3 submissions)
  const bodyPatterns = [
    { label: '3-Way Match Accuracy', re: /Student Audit Accuracy[^:]*:\s*([^\n]+)/i },
    { label: 'SoD Remaining', re: /Current Remaining Toxic Conflicts:\s*([^\n]+)/i },
    { label: 'Master Data Hygiene', re: /Master Data Hygiene Score:\s*([^\n]+)/i },
    { label: 'Transposition Trap', re: /TRANSPOSITION ERROR TRAP TESTED:\s*([^\n]+)/i },
    { label: 'Bullwhip POS Savings', re: /Chain Cost Reduction from POS Sharing:\s*([^\n]+)/i },
    { label: 'Blanket Savings', re: /Net Transaction Cost Savings:\s*([^\n]+)/i },
    { label: 'Tender Award', re: /Recommended Best-Value Award:\s*([^\n]+)/i },
    { label: 'Cycle Count Accuracy', re: /Book-to-Physical Bin Accuracy:\s*([^\n]+)/i },
    { label: 'Avg Supplier Score', re: /Portfolio Average Supplier Score:\s*([^\n]+)/i },
    { label: 'SPC Cpk', re: /Cpk:\s*([0-9.]+)/i },
    { label: 'COQ % Revenue', re: /Total COQ % of Revenue:\s*([^\n]+)/i },
  ];
  if (!metrics.length) {
    bodyPatterns.forEach(({ label, re }) => {
      const v = pick(re);
      if (v) metrics.push({ label, value: v });
    });
  }

  // Extract the student written judgement paragraph at the bottom of the report
  const judgeSectionMatch = text.match(
    /(?:MANAGERIAL JUDGEMENT|STUDENT MANAGERIAL JUDGEMENT|WRITTEN JUDGEMENT|EXECUTIVE JUDGEMENT)[^\n]*\n([\s\S]+)$/i,
  );
  const judgementText = judgeSectionMatch ? judgeSectionMatch[1].trim() : '';
  const judgementWords = judgementText && !/^\(No written judgement/i.test(judgementText)
    ? judgementText.split(/\s+/).filter(Boolean).length
    : 0;

  const judgementPass = judgeLine
    ? /^PASS/i.test(judgeLine)
    : judgementWords >= 12;

  // Parse numeric quality indicator (0..1) from extracted quantitative evidence when possible
  let quantRatio = 0.85; // default solid completion credit when full lab output is present
  const pctValues = [];
  metrics.forEach((m) => {
    const pctMatch = m.value.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch && /Accuracy|Hygiene|Score/i.test(m.label)) {
      pctValues.push(Math.max(0, Math.min(100, Number(pctMatch[1]))) / 100);
    }
    if (/SoD Remaining/i.test(m.label)) {
      const numMatch = m.value.match(/(\d+)/);
      if (numMatch) {
        pctValues.push(Number(numMatch[1]) === 0 ? 1.0 : 0.65);
      }
    }
    if (/Transposition Trap/i.test(m.label)) {
      pctValues.push(/YES|PASS|TESTED/i.test(m.value) ? 1.0 : 0.6);
    }
  });
  if (pctValues.length) {
    quantRatio = pctValues.reduce((s, v) => s + v, 0) / pctValues.length;
  } else if (!metrics.length) {
    quantRatio = 0.75;
  }

  return {
    isLab: true,
    moduleLine: moduleLine || 'Interactive Software Lab Submission',
    metrics,
    judgementPass,
    judgementWords,
    judgementExcerpt: judgementText.slice(0, 420),
    quantRatio: Number(quantRatio.toFixed(3)),
  };
}

/**
 * Computes suggested rubric marks for quantitative lab criteria (leaving the final
 * Managerial Judgement criterion for the lecturer's human review).
 */
export function suggestLabRubricMarks({ parsed, criteria = [], maxMarks = 20 }) {
  if (!parsed) return null;
  const maxTotal = Math.max(1, Number(maxMarks) || 20);
  const list = Array.isArray(criteria) && criteria.length ? criteria : [];

  const roundHalf = (v) => Math.round(v * 2) / 2;

  if (!list.length) {
    // No structured rubric: allocate 75% quantitative + 25% provisional judgement
    const quantMax = maxTotal * 0.75;
    const judgeMax = maxTotal - quantMax;
    const quantEarned = roundHalf(quantMax * parsed.quantRatio);
    const judgeProvisional = parsed.judgementPass ? roundHalf(judgeMax * 0.75) : 0;
    const suggestedTotal = Math.min(maxTotal, roundHalf(quantEarned + judgeProvisional));
    return {
      suggestedTotal,
      quantMax: roundHalf(quantMax),
      quantEarned,
      breakdown: [],
      feedbackNote: [
        `Lab Evidence Verification (${parsed.moduleLine}):`,
        ...parsed.metrics.map((m) => `• ${m.label}: ${m.value}`),
        `• Quantitative Lab Work: ${quantEarned}/${roundHalf(quantMax)}`,
        `• Managerial Judgement (${parsed.judgementWords} words): ${parsed.judgementPass ? `${judgeProvisional}/${roundHalf(judgeMax)} provisional — review & adjust` : 'Needs fuller written argument'}`,
      ].join('\n'),
    };
  }

  // Treat criteria mentioning Judgement / Recommendation / Strategy / Governance (or last criterion) as human-reviewed
  const breakdown = list.map((c, idx) => {
    const cMax = Math.max(0, Number(c.maxMarks) || 0);
    const isJudgementCriterion =
      idx === list.length - 1 || /judgement|judgment|recommend|strategy|governance/i.test(c.title || '');
    if (isJudgementCriterion) {
      const provisional = parsed.judgementPass ? roundHalf(cMax * 0.75) : 0;
      return {
        id: c.id || `c_${idx}`,
        title: c.title,
        maxMarks: cMax,
        suggested: provisional,
        mode: 'human_review',
      };
    }
    const earned = Math.min(cMax, roundHalf(cMax * Math.max(0.5, parsed.quantRatio)));
    return {
      id: c.id || `c_${idx}`,
      title: c.title,
      maxMarks: cMax,
      suggested: earned,
      mode: 'quantitative',
    };
  });

  const suggestedTotal = Math.min(
    maxTotal,
    roundHalf(breakdown.reduce((s, b) => s + b.suggested, 0)),
  );
  const quantEarned = roundHalf(
    breakdown.filter((b) => b.mode === 'quantitative').reduce((s, b) => s + b.suggested, 0),
  );
  const quantMax = roundHalf(
    breakdown.filter((b) => b.mode === 'quantitative').reduce((s, b) => s + b.maxMarks, 0),
  );

  const feedbackNote = [
    `Lab Rubric Assessment (${parsed.moduleLine}):`,
    ...breakdown.map(
      (b) =>
        `• ${b.title}: ${b.suggested}/${b.maxMarks}${b.mode === 'human_review' ? ' (provisional — lecturer review)' : ' (verified from lab output)'}`,
    ),
    ...(parsed.metrics.length
      ? [`Verified Lab Metrics: ${parsed.metrics.map((m) => `${m.label}=${m.value}`).join(' · ')}`]
      : []),
  ].join('\n');

  return {
    suggestedTotal,
    quantEarned,
    quantMax,
    breakdown,
    feedbackNote,
  };
}
