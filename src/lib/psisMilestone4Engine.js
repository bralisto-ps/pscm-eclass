// Pure deterministic engine for Milestone 4 PSIS Laboratories & Platform Upgrades:
// 1. Lab 7 (Inventory & Warehouse Control): EOQ, ROP, Safety Stock, ABC-XYZ Matrix & Cycle Count Audit
// 2. Lab 8 (Supplier Scorecard & Spend Analytics): Weighted OTIF/PPM Scorecards, Spend Cube & Tail Spend
// 3. Auto-Scored Lab Telemetry Header for fast Assignment Marking
// 4. Live Multi-Student Classroom Session role & chain assignment helpers

// ============================================================================
// 1. INVENTORY CONTROL, ABC-XYZ & CYCLE COUNT AUDIT (LAB 7)
// ============================================================================

export const SERVICE_LEVEL_Z = {
  90: 1.282,
  95: 1.645,
  97.5: 1.96,
  98: 2.054,
  99: 2.326,
  99.5: 2.576,
  99.9: 3.09,
};

export function lookupZScore(serviceLevelPct = 95) {
  const num = Number(serviceLevelPct);
  if (SERVICE_LEVEL_Z[num]) return SERVICE_LEVEL_Z[num];
  const keys = Object.keys(SERVICE_LEVEL_Z).map(Number).sort((a, b) => a - b);
  let closest = keys[0];
  for (const k of keys) {
    if (Math.abs(k - num) < Math.abs(closest - num)) closest = k;
  }
  return SERVICE_LEVEL_Z[closest] || 1.645;
}

/**
 * Computes EOQ, Reorder Point (ROP), Safety Stock, and Annual Cost curve.
 */
export function computeEoqRopPolicy({
  annualDemand = 12000,
  unitCost = 45,
  orderingCost = 420,
  holdingRatePct = 22,
  leadTimeDays = 14,
  dailyDemandStd = 11,
  serviceLevelPct = 95,
  operatingDaysPerYear = 300,
}) {
  const D = Math.max(1, Number(annualDemand) || 1);
  const C = Math.max(0.01, Number(unitCost) || 1);
  const S = Math.max(1, Number(orderingCost) || 1);
  const hPct = Math.max(1, Number(holdingRatePct) || 20);
  const H = C * (hPct / 100);
  const L = Math.max(1, Number(leadTimeDays) || 1);
  const sigmaD = Math.max(0, Number(dailyDemandStd) || 0);
  const daysYr = Math.max(200, Number(operatingDaysPerYear) || 300);

  const eoq = Math.max(1, Math.round(Math.sqrt((2 * D * S) / H)));
  const ordersPerYear = D / eoq;
  const daysBetweenOrders = daysYr / ordersPerYear;
  const annualOrderingCost = ordersPerYear * S;
  const annualCycleHoldingCost = (eoq / 2) * H;

  const avgDailyDemand = D / daysYr;
  const z = lookupZScore(serviceLevelPct);
  const safetyStock = Math.round(z * sigmaD * Math.sqrt(L));
  const reorderPoint = Math.round(avgDailyDemand * L + safetyStock);
  const annualSafetyHoldingCost = safetyStock * H;
  const totalRelevantAnnualCost = annualOrderingCost + annualCycleHoldingCost + annualSafetyHoldingCost;

  return {
    eoq,
    ordersPerYear: Number(ordersPerYear.toFixed(1)),
    daysBetweenOrders: Number(daysBetweenOrders.toFixed(1)),
    holdingCostPerUnit: Number(H.toFixed(2)),
    avgDailyDemand: Number(avgDailyDemand.toFixed(1)),
    zScore: z,
    safetyStock,
    reorderPoint,
    annualOrderingCost: Number(annualOrderingCost.toFixed(2)),
    annualCycleHoldingCost: Number(annualCycleHoldingCost.toFixed(2)),
    annualSafetyHoldingCost: Number(annualSafetyHoldingCost.toFixed(2)),
    totalRelevantAnnualCost: Number(totalRelevantAnnualCost.toFixed(2)),
  };
}

/**
 * Classifies SKUs into a 9-quadrant ABC (Annual Consumption Value) x XYZ (Demand CV) matrix.
 */
export function classifyAbcXyzMatrix(items = []) {
  const enriched = (items || []).map((it, idx) => {
    const annualQty = Math.max(0, Number(it.annualQty) || 0);
    const unitCost = Math.max(0, Number(it.unitCost) || 0);
    const annualSpend = annualQty * unitCost;
    const demandCv = Math.max(0, Number(it.demandCv ?? 0.25));
    const xyz = demandCv <= 0.2 ? 'X' : demandCv <= 0.5 ? 'Y' : 'Z';
    return {
      ...it,
      code: String(it.code || `SKU-${idx + 1}`).trim(),
      name: String(it.name || `Item ${idx + 1}`).trim(),
      annualQty,
      unitCost,
      annualSpend: Number(annualSpend.toFixed(2)),
      demandCv: Number(demandCv.toFixed(2)),
      xyz,
    };
  });

  enriched.sort((a, b) => b.annualSpend - a.annualSpend);
  const totalSpend = enriched.reduce((s, r) => s + r.annualSpend, 0);

  let running = 0;
  const matrixCounts = {
    AX: 0, AY: 0, AZ: 0,
    BX: 0, BY: 0, BZ: 0,
    CX: 0, CY: 0, CZ: 0,
  };

  const classified = enriched.map((row) => {
    const prevPct = totalSpend > 0 ? (running / totalSpend) * 100 : 0;
    running += row.annualSpend;
    const cumPct = totalSpend > 0 ? (running / totalSpend) * 100 : 0;
    const abc = prevPct < 80 ? 'A' : prevPct < 95 ? 'B' : 'C';
    const cell = `${abc}${row.xyz}`;
    matrixCounts[cell] = (matrixCounts[cell] || 0) + 1;

    const policyMap = {
      AX: 'JIT / Weekly Blanket Call-Off, low safety stock, tight cycle count',
      AY: 'Continuous review (ROP), moderate safety stock, demand collaboration',
      AZ: 'Make-to-Order / Vendor-Managed Consignment, executive review',
      BX: 'Automated ROP replenishment, quarterly review',
      BY: 'Periodic review with buffer stock, forecast smoothing',
      BZ: 'Order-on-demand or carefully capped buffer',
      CX: 'Two-bin / Kanban bulk reorder, minimal admin overhead',
      CY: 'Automated min-max, low-touch catalogue ordering',
      CZ: 'Spot-buy only when needed; review for SKU rationalization',
    };

    return {
      ...row,
      spendSharePct: totalSpend > 0 ? Number(((row.annualSpend / totalSpend) * 100).toFixed(1)) : 0,
      cumSpendPct: Number(cumPct.toFixed(1)),
      abc,
      segment: cell,
      policy: policyMap[cell],
    };
  });

  return {
    totalSkus: classified.length,
    totalSpend: Number(totalSpend.toFixed(2)),
    matrixCounts,
    items: classified,
    aCount: classified.filter((r) => r.abc === 'A').length,
    bCount: classified.filter((r) => r.abc === 'B').length,
    cCount: classified.filter((r) => r.abc === 'C').length,
  };
}

/**
 * Evaluates warehouse cycle count variance between ERP System Stock and Physical Bin Count.
 */
export function auditCycleCount(bins = [], tolerancePct = 2) {
  const tol = Math.max(0, Number(tolerancePct) || 0);
  let totalSystemVal = 0;
  let totalPhysicalVal = 0;
  let totalAbsVarianceVal = 0;
  let accurateBins = 0;

  const rows = (bins || []).map((b, idx) => {
    const sys = Math.max(0, Number(b.systemQty) || 0);
    const phys = Math.max(0, Number(b.physicalQty) || 0);
    const unitCost = Math.max(0, Number(b.unitCost) || 0);
    const unitVar = phys - sys;
    const absVar = Math.abs(unitVar);
    const varPct = sys > 0 ? (absVar / sys) * 100 : (phys > 0 ? 100 : 0);
    const valueVar = unitVar * unitCost;
    const withinTol = varPct <= tol + 1e-6;
    if (withinTol) accurateBins += 1;

    totalSystemVal += sys * unitCost;
    totalPhysicalVal += phys * unitCost;
    totalAbsVarianceVal += absVar * unitCost;

    return {
      ...b,
      bin: String(b.bin || `BIN-${idx + 1}`).trim(),
      systemQty: sys,
      physicalQty: phys,
      unitCost,
      unitVariance: unitVar,
      variancePct: Number(varPct.toFixed(1)),
      valueVariance: Number(valueVar.toFixed(2)),
      withinTolerance: withinTol,
    };
  });

  const binAccuracyPct = rows.length ? Number(((accurateBins / rows.length) * 100).toFixed(1)) : 100;
  const valueAccuracyPct = totalSystemVal > 0
    ? Number((Math.max(0, 1 - totalAbsVarianceVal / totalSystemVal) * 100).toFixed(1))
    : 100;
  const netShrinkageValue = Number((totalPhysicalVal - totalSystemVal).toFixed(2));

  return {
    totalBins: rows.length,
    accurateBins,
    discrepancyBins: rows.length - accurateBins,
    binAccuracyPct,
    valueAccuracyPct,
    totalSystemValue: Number(totalSystemVal.toFixed(2)),
    totalAbsVarianceValue: Number(totalAbsVarianceVal.toFixed(2)),
    netShrinkageValue,
    rows,
  };
}

// ============================================================================
// 2. SUPPLIER SCORECARD & SPEND CUBE ANALYTICS (LAB 8)
// ============================================================================

/**
 * Computes weighted supplier performance scorecards across OTIF, Quality PPM, Price Variance, and Responsiveness.
 */
export function computeSupplierScorecards(suppliers = [], weights = {}) {
  const wOtif = Math.max(0, Number(weights.otif ?? 35));
  const wQual = Math.max(0, Number(weights.quality ?? 30));
  const wPrice = Math.max(0, Number(weights.price ?? 20));
  const wResp = Math.max(0, Number(weights.responsiveness ?? 15));
  const sumW = wOtif + wQual + wPrice + wResp || 100;

  const norm = {
    otif: (wOtif / sumW) * 100,
    quality: (wQual / sumW) * 100,
    price: (wPrice / sumW) * 100,
    responsiveness: (wResp / sumW) * 100,
  };

  const rows = (suppliers || []).map((s, idx) => {
    const otifPct = Math.max(0, Math.min(100, Number(s.otifPct) || 0));
    const defectPpm = Math.max(0, Number(s.defectPpm) || 0);
    // Quality score: 0 PPM -> 100; 25,000 PPM (2.5% defect rate) -> 0
    const qualityScore = Math.max(0, Math.min(100, 100 - (defectPpm / 250)));
    // Price variance % vs benchmark (0% or negative = 100; +15% = 25)
    const priceVarPct = Number(s.priceVariancePct || 0);
    const priceScore = Math.max(0, Math.min(100, 100 - Math.max(0, priceVarPct) * 5));
    const respScore = Math.max(0, Math.min(100, Number(s.responsivenessScore ?? 80)));
    const annualSpend = Math.max(0, Number(s.annualSpend) || 0);

    const composite =
      (otifPct * norm.otif +
        qualityScore * norm.quality +
        priceScore * norm.price +
        respScore * norm.responsiveness) / 100;

    const tier =
      composite >= 85
        ? 'PREFERRED'
        : composite >= 72
          ? 'APPROVED'
          : composite >= 58
            ? 'WATCHLIST'
            : 'AT_RISK';

    return {
      ...s,
      id: s.id || `sup_${idx + 1}`,
      supplier: String(s.supplier || `Supplier ${idx + 1}`).trim(),
      category: String(s.category || 'General').trim(),
      annualSpend,
      otifPct,
      defectPpm,
      priceVariancePct: priceVarPct,
      responsivenessScore: respScore,
      qualityScore: Number(qualityScore.toFixed(1)),
      priceScore: Number(priceScore.toFixed(1)),
      compositeScore: Number(composite.toFixed(1)),
      tier,
      onContract: s.onContract !== false,
    };
  });

  rows.sort((a, b) => b.compositeScore - a.compositeScore);
  const avgScore = rows.length
    ? Number((rows.reduce((s, r) => s + r.compositeScore, 0) / rows.length).toFixed(1))
    : 0;

  return {
    normalizedWeights: {
      otif: Number(norm.otif.toFixed(1)),
      quality: Number(norm.quality.toFixed(1)),
      price: Number(norm.price.toFixed(1)),
      responsiveness: Number(norm.responsiveness.toFixed(1)),
    },
    rows,
    avgScore,
    preferredCount: rows.filter((r) => r.tier === 'PREFERRED').length,
    atRiskCount: rows.filter((r) => r.tier === 'AT_RISK' || r.tier === 'WATCHLIST').length,
  };
}

/**
 * Computes Spend Cube Pareto, Maverick / Off-Contract Spend %, and Tail Spend diagnostics.
 */
export function computeSpendCubeAnalytics(records = []) {
  const totalSpend = (records || []).reduce((s, r) => s + Math.max(0, Number(r.annualSpend) || 0), 0);
  const maverickSpend = (records || [])
    .filter((r) => r.onContract === false)
    .reduce((s, r) => s + Math.max(0, Number(r.annualSpend) || 0), 0);

  const catMap = new Map();
  (records || []).forEach((r) => {
    const cat = String(r.category || 'General').trim();
    const prev = catMap.get(cat) || { category: cat, spend: 0, suppliers: 0 };
    prev.spend += Math.max(0, Number(r.annualSpend) || 0);
    prev.suppliers += 1;
    catMap.set(cat, prev);
  });

  const categories = [...catMap.values()].sort((a, b) => b.spend - a.spend);
  let running = 0;
  const categoryPareto = categories.map((c) => {
    running += c.spend;
    return {
      ...c,
      sharePct: totalSpend > 0 ? Number(((c.spend / totalSpend) * 100).toFixed(1)) : 0,
      cumPct: totalSpend > 0 ? Number(((running / totalSpend) * 100).toFixed(1)) : 0,
    };
  });

  // Tail spend: suppliers in the bottom 20% of cumulative spend
  const bySup = [...(records || [])].sort((a, b) => (Number(b.annualSpend) || 0) - (Number(a.annualSpend) || 0));
  let supRun = 0;
  let tailCount = 0;
  let tailSpend = 0;
  bySup.forEach((r) => {
    const sp = Math.max(0, Number(r.annualSpend) || 0);
    const prevShare = totalSpend > 0 ? supRun / totalSpend : 0;
    supRun += sp;
    if (prevShare >= 0.8) {
      tailCount += 1;
      tailSpend += sp;
    }
  });

  const top3Spend = bySup.slice(0, 3).reduce((s, r) => s + Math.max(0, Number(r.annualSpend) || 0), 0);

  return {
    totalSpend: Number(totalSpend.toFixed(2)),
    maverickSpend: Number(maverickSpend.toFixed(2)),
    maverickPct: totalSpend > 0 ? Number(((maverickSpend / totalSpend) * 100).toFixed(1)) : 0,
    top3SharePct: totalSpend > 0 ? Number(((top3Spend / totalSpend) * 100).toFixed(1)) : 0,
    tailSupplierCount: tailCount,
    tailSpend: Number(tailSpend.toFixed(2)),
    categoryPareto,
  };
}

// ============================================================================
// 3. AUTO-SCORED LAB AUDIT SUMMARY HEADER (FOR FAST ASSIGNMENT MARKING)
// ============================================================================

export function formatAutoScoredSubmissionHeader({ labCode, labTitle, body, hasJudgement }) {
  const text = String(body || '');
  const extract = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };

  const signals = [];
  const accuracy = extract(/Student Audit Accuracy[^:]*:\s*([^\n]+)/i);
  if (accuracy) signals.push(`3-Way Match Accuracy: ${accuracy}`);
  const sodRemain = extract(/Current Remaining Toxic Conflicts:\s*([^\n]+)/i);
  if (sodRemain) signals.push(`SoD Remaining: ${sodRemain}`);
  const hygiene = extract(/Master Data Hygiene Score:\s*([^\n]+)/i);
  if (hygiene) signals.push(`Master Data Hygiene: ${hygiene}`);
  const transTrap = extract(/TRANSPOSITION ERROR TRAP TESTED:\s*([^\n]+)/i);
  if (transTrap) signals.push(`Transposition Trap: ${transTrap}`);
  const posSavings = extract(/Chain Cost Reduction from POS Sharing:\s*([^\n]+)/i);
  if (posSavings) signals.push(`Bullwhip POS Savings: ${posSavings}`);
  const blanketSav = extract(/Net Transaction Cost Savings:\s*([^\n]+)/i);
  if (blanketSav) signals.push(`Blanket Order Savings: ${blanketSav}`);
  const tenderAward = extract(/Recommended Best-Value Award:\s*([^\n]+)/i);
  if (tenderAward) signals.push(`Sealed Tender Award: ${tenderAward}`);
  const cycleAcc = extract(/Book-to-Physical Bin Accuracy:\s*([^\n]+)/i);
  if (cycleAcc) signals.push(`Cycle Count Accuracy: ${cycleAcc}`);
  const avgScore = extract(/Portfolio Average Supplier Score:\s*([^\n]+)/i);
  if (avgScore) signals.push(`Avg Supplier Score: ${avgScore}`);
  const spcCpk = extract(/Cpk:\s*([0-9.]+)/i);
  if (spcCpk) signals.push(`SPC Cpk: ${spcCpk}`);
  const coqPct = extract(/Total COQ % of Revenue:\s*([^\n]+)/i);
  if (coqPct) signals.push(`COQ % Revenue: ${coqPct}`);

  const lines = [
    `====================================================================`,
    `[AUTO-SCORED LAB VERIFICATION SUMMARY — FOR LECTURER MARKING]`,
    `Module: ${labCode || 'LAB'} — ${labTitle || 'Interactive Software Lab'}`,
    `Quantitative Evidence Extracted: ${signals.length ? signals.join(' | ') : 'Completed interactive workbench output attached below'}`,
    `Written Managerial Judgement Check: ${hasJudgement ? 'PASS (Substantive written argument included)' : 'NEEDS REVIEW (Short or missing written argument)'}`,
    `====================================================================`,
    ``,
  ];
  return lines.join('\n') + text;
}

// ============================================================================
// 4. LIVE CLASSROOM SESSION HELPERS (P1, P2, P6)
// ============================================================================

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateSessionCode(length = 6) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Deals connected students evenly into 4-tier Bullwhip chains (Retailer, Wholesaler, Distributor, Factory).
 */
export function assignStudentsToChains(participants = []) {
  const roles = ['retailer', 'wholesaler', 'distributor', 'factory'];
  const assignments = {};
  (participants || []).forEach((p, idx) => {
    const chainNo = Math.floor(idx / 4) + 1;
    const tier = roles[idx % 4];
    assignments[p.id] = { chainNo, tier };
  });
  return assignments;
}

/**
 * Deals connected students into 4-role P2P control groups (Buyer, Storekeeper, Finance, Manager).
 * Optionally grants Group 1 all four roles (Super-User Fraud Demo mode).
 */
export function assignStudentsToP2pGroups(participants = [], grantGroup1SuperUser = false) {
  const roles = ['buyer', 'storekeeper', 'finance', 'manager'];
  const assignments = {};
  (participants || []).forEach((p, idx) => {
    const groupNo = Math.floor(idx / 4) + 1;
    const baseRole = roles[idx % 4];
    assignments[p.id] = {
      groupNo,
      roles: grantGroup1SuperUser && groupNo === 1 ? [...roles] : [baseRole],
      isSuperUserDemo: Boolean(grantGroup1SuperUser && groupNo === 1),
    };
  });
  return assignments;
}
