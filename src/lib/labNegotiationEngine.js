// Pure deterministic engine for Procurement Negotiation Science Labs (NEG-LAB 01 to NEG-LAB 04)
// Zero external dependencies. Supports both Solo Interactive Analysis and Live Paired Classroom Bargaining.

// ============================================================================
// NEG-LAB 01: DISTRIBUTIVE BARGAINING, BATNA & ZOPA DYNAMICS
// ============================================================================

export function analyzeDistributiveZopa({
  buyerBatna = 1200,
  buyerSwitchingCost = 50,
  buyerTarget = 980,
  buyerAnchor = 920,
  supplierCost = 820,
  supplierMinMarginPct = 10,
  supplierAltOffer = 900,
  supplierTarget = 1180,
  supplierAnchor = 1280,
  agreedPrice = null,
  quantity = 1000,
}) {
  const bBatna = Math.max(0, Number(buyerBatna) || 0);
  const bSwitch = Math.max(0, Number(buyerSwitchingCost) || 0);
  const buyerReservation = Number((bBatna + bSwitch).toFixed(2));

  const sCost = Math.max(0, Number(supplierCost) || 0);
  const sMinMargin = Math.max(0, Number(supplierMinMarginPct) || 0);
  const sCostFloor = sCost * (1 + sMinMargin / 100);
  const supplierReservation = Number(Math.max(sCostFloor, Number(supplierAltOffer) || 0).toFixed(2));

  const zopaExists = buyerReservation >= supplierReservation;
  const zopaLow = zopaExists ? supplierReservation : buyerReservation;
  const zopaHigh = zopaExists ? buyerReservation : supplierReservation;
  const zopaWidth = Number((buyerReservation - supplierReservation).toFixed(2));
  const midpoint = zopaExists ? Number(((buyerReservation + supplierReservation) / 2).toFixed(2)) : null;

  const qty = Math.max(1, Number(quantity) || 1);
  let dealMetrics = null;
  if (agreedPrice !== null && agreedPrice !== '' && Number.isFinite(Number(agreedPrice))) {
    const p = Number(agreedPrice);
    const buyerUnitSurplus = Number((buyerReservation - p).toFixed(2));
    const supplierUnitSurplus = Number((p - supplierReservation).toFixed(2));
    const withinZopa = zopaExists && p >= supplierReservation && p <= buyerReservation;
    const buyerSharePct = zopaExists && zopaWidth > 0 ? Number(((buyerUnitSurplus / zopaWidth) * 100).toFixed(1)) : 0;
    dealMetrics = {
      agreedPrice: p,
      withinZopa,
      buyerUnitSurplus,
      supplierUnitSurplus,
      buyerTotalSavings: Number((buyerUnitSurplus * qty).toFixed(2)),
      supplierTotalSurplus: Number((supplierUnitSurplus * qty).toFixed(2)),
      buyerSharePct,
      supplierSharePct: Number((100 - buyerSharePct).toFixed(1)),
      verdict: !withinZopa
        ? p > buyerReservation
          ? 'BUYER VALUE DESTRUCTION (ABOVE RESERVATION PRICE — SHOULD HAVE WALKED TO BATNA)'
          : 'SUPPLIER BELOW FLOOR (UNSUSTAINABLE / WINNER’S CURSE RISK)'
        : buyerSharePct >= 55
          ? 'STRONG BUYER VALUE CAPTURE'
          : buyerSharePct >= 45
            ? 'BALANCED ZOPA SPLIT'
            : 'SUPPLIER-FAVOURED SETTLEMENT',
    };
  }

  return {
    buyerReservation,
    supplierReservation,
    buyerTarget: Number(buyerTarget) || 0,
    buyerAnchor: Number(buyerAnchor) || 0,
    supplierTarget: Number(supplierTarget) || 0,
    supplierAnchor: Number(supplierAnchor) || 0,
    zopaExists,
    zopaLow,
    zopaHigh,
    zopaWidth,
    midpoint,
    quantity: qty,
    dealMetrics,
  };
}

export function evaluateCounterpartOffer({
  offerPrice,
  round = 1,
  maxRounds = 6,
  persona = 'firm_anchorer', // collaborative | firm_anchorer | hardball
  supplierReservation = 900,
  supplierAnchor = 1280,
  lastSupplierOffer = 1280,
}) {
  const offer = Number(offerPrice);
  if (!Number.isFinite(offer) || offer <= 0) {
    return { status: 'invalid', message: 'Enter a valid positive unit price offer.' };
  }

  const concessionSpeed = persona === 'collaborative' ? 0.42 : persona === 'hardball' ? 0.2 : 0.3;
  const acceptPremium = persona === 'collaborative' ? 0.12 : persona === 'hardball' ? 0.34 : 0.22;
  const minAcceptThreshold = supplierReservation + Math.max(0, supplierAnchor - supplierReservation) * acceptPremium * Math.max(0.25, 1 - (round - 1) / maxRounds);

  if (offer >= minAcceptThreshold && offer >= supplierReservation) {
    return {
      status: 'accepted',
      agreedPrice: Number(offer.toFixed(2)),
      supplierCounter: Number(offer.toFixed(2)),
      message: `Counterpart accepted your offer of ${offer.toFixed(2)} in Round ${round}.`,
    };
  }

  if (round >= maxRounds) {
    if (offer >= supplierReservation) {
      return {
        status: 'accepted',
        agreedPrice: Number(offer.toFixed(2)),
        supplierCounter: Number(offer.toFixed(2)),
        message: `Final-round agreement reached at ${offer.toFixed(2)} just above supplier reservation floor.`,
      };
    }
    return {
      status: 'impasse',
      agreedPrice: null,
      supplierCounter: Number(Math.max(supplierReservation, lastSupplierOffer).toFixed(2)),
      message: `No deal after Round ${maxRounds}. Offer remained below supplier walk-away floor; both sides exit to BATNA.`,
    };
  }

  const gap = Math.max(0, lastSupplierOffer - Math.max(offer, supplierReservation));
  const step = gap * concessionSpeed;
  const nextCounter = Number(Math.max(supplierReservation, lastSupplierOffer - step).toFixed(2));
  const signal =
    offer < supplierReservation * 0.85
      ? 'Counterpart rejected your aggressive anchor firmly and made only a small move.'
      : 'Counterpart acknowledged movement and countered with a diminishing concession.';

  return {
    status: 'counter',
    agreedPrice: null,
    supplierCounter: nextCounter,
    message: `${signal} New supplier ask: ${nextCounter.toFixed(2)}.`,
  };
}

// ============================================================================
// NEG-LAB 02: INTEGRATIVE MULTI-ISSUE NEGOTIATION & PARETO FRONTIER ANALYSIS
// ============================================================================

export function evaluateIntegrativePackage(issues = [], selectedOptionIds = {}, buyerBatnaPts = 40, supplierBatnaPts = 40) {
  let buyerPoints = 0;
  let supplierPoints = 0;
  const breakdown = [];

  for (const issue of issues) {
    const opt = (issue.options || []).find((o) => o.id === selectedOptionIds[issue.id]) || issue.options?.[0];
    if (!opt) continue;
    const bPts = Number(opt.buyerPoints) || 0;
    const sPts = Number(opt.supplierPoints) || 0;
    buyerPoints += bPts;
    supplierPoints += sPts;
    breakdown.push({
      issueId: issue.id,
      issueName: issue.name,
      optionId: opt.id,
      optionLabel: opt.label,
      buyerPoints: bPts,
      supplierPoints: sPts,
    });
  }

  const jointPoints = buyerPoints + supplierPoints;
  const buyerSurplus = buyerPoints - buyerBatnaPts;
  const supplierSurplus = supplierPoints - supplierBatnaPts;
  const bothAboveBatna = buyerPoints >= buyerBatnaPts && supplierPoints >= supplierBatnaPts;

  return {
    buyerPoints,
    supplierPoints,
    jointPoints,
    buyerSurplus,
    supplierSurplus,
    bothAboveBatna,
    breakdown,
  };
}

export function computeParetoFrontier(issues = [], buyerBatnaPts = 40, supplierBatnaPts = 40) {
  if (!Array.isArray(issues) || !issues.length) {
    return { allCombos: [], frontier: [], maxJointDeal: null, nashDeal: null };
  }

  // Enumerate all discrete issue combinations (typically 3^5 = 243 or 4^5 = 1024 — instant in JS)
  let combos = [{ selections: {}, buyerPoints: 0, supplierPoints: 0 }];
  for (const issue of issues) {
    const opts = issue.options || [];
    if (!opts.length) continue;
    const next = [];
    for (const c of combos) {
      for (const opt of opts) {
        next.push({
          selections: { ...c.selections, [issue.id]: opt.id },
          buyerPoints: c.buyerPoints + (Number(opt.buyerPoints) || 0),
          supplierPoints: c.supplierPoints + (Number(opt.supplierPoints) || 0),
        });
      }
    }
    combos = next;
    if (combos.length > 4096) break;
  }

  const allCombos = combos.map((c) => ({
    ...c,
    jointPoints: c.buyerPoints + c.supplierPoints,
    feasible: c.buyerPoints >= buyerBatnaPts && c.supplierPoints >= supplierBatnaPts,
  }));

  // Non-dominated Pareto frontier
  const frontier = [];
  for (const cand of allCombos) {
    const dominated = allCombos.some(
      (other) =>
        other.buyerPoints >= cand.buyerPoints &&
        other.supplierPoints >= cand.supplierPoints &&
        (other.buyerPoints > cand.buyerPoints || other.supplierPoints > cand.supplierPoints),
    );
    if (!dominated) {
      frontier.push(cand);
    }
  }
  frontier.sort((a, b) => a.buyerPoints - b.buyerPoints);

  const feasibleDeals = allCombos.filter((c) => c.feasible);
  const pool = feasibleDeals.length ? feasibleDeals : allCombos;
  const maxJointDeal = pool.reduce((best, cur) => (cur.jointPoints > best.jointPoints ? cur : best), pool[0]);

  const nashDeal = feasibleDeals.length
    ? feasibleDeals.reduce((best, cur) => {
        const curProd = (cur.buyerPoints - buyerBatnaPts) * (cur.supplierPoints - supplierBatnaPts);
        const bestProd = (best.buyerPoints - buyerBatnaPts) * (best.supplierPoints - supplierBatnaPts);
        return curProd > bestProd ? cur : best;
      }, feasibleDeals[0])
    : maxJointDeal;

  return { allCombos, frontier, maxJointDeal, nashDeal };
}

export function scoreDealAgainstFrontier(pkgEval, frontierAnalysis) {
  const { frontier = [], maxJointDeal } = frontierAnalysis || {};
  const maxJoint = maxJointDeal?.jointPoints || 1;
  const paretoEfficiencyPct = Number(Math.min(100, (pkgEval.jointPoints / maxJoint) * 100).toFixed(1));

  // Find Pareto-dominating deals (strictly better for at least one party, no worse for the other)
  const dominating = frontier.filter(
    (f) =>
      f.buyerPoints >= pkgEval.buyerPoints &&
      f.supplierPoints >= pkgEval.supplierPoints &&
      (f.buyerPoints > pkgEval.buyerPoints || f.supplierPoints > pkgEval.supplierPoints),
  );
  const bestImprovement = dominating.length
    ? dominating.reduce((best, cur) => (cur.jointPoints > best.jointPoints ? cur : best), dominating[0])
    : null;
  const valueLeftOnTable = bestImprovement ? bestImprovement.jointPoints - pkgEval.jointPoints : 0;

  return {
    isParetoOptimal: dominating.length === 0,
    paretoEfficiencyPct,
    valueLeftOnTable,
    bestImprovement,
    maxJointPoints: maxJoint,
  };
}

// ============================================================================
// NEG-LAB 03: SHOULD-COST MODELING & OPEN-BOOK PRICE ANALYSIS
// ============================================================================

export function analyzeShouldCostModel({
  costLines = [],
  supplierProfitMarginQuotedPct = 22,
  targetProfitMarginPct = 11,
  commodityIndexShiftPct = 0,
  volumeMultiplier = 1,
  learningCurvePct = 90,
  annualVolume = 5000,
}) {
  const shiftFactor = 1 + (Number(commodityIndexShiftPct) || 0) / 100;
  const volMult = Math.max(0.25, Number(volumeMultiplier) || 1);
  // Wright's Law learning curve adjustment for volume doubling: volMult ^ log2(learningRate)
  const lcRate = Math.max(0.75, Math.min(1.0, (Number(learningCurvePct) || 90) / 100));
  const learningFactor = volMult > 1 ? Math.pow(volMult, Math.log2(lcRate)) : 1;

  let quotedSubtotal = 0;
  let shouldSubtotal = 0;

  const lines = (costLines || []).map((line) => {
    const quoted = Math.max(0, Number(line.quotedCost) || 0);
    const baseBench = Math.max(0, Number(line.benchmarkCost) || 0);
    const isMaterial = /material|raw|resin|steel|packaging|component/i.test(String(line.category || line.name || ''));
    const isLabour = /labour|labor|assembly|machining|mfg/i.test(String(line.category || line.name || ''));
    let adjustedBench = baseBench;
    if (isMaterial) adjustedBench *= shiftFactor;
    if (isLabour) adjustedBench *= learningFactor;
    adjustedBench = Number(adjustedBench.toFixed(2));
    const variance = Number((quoted - adjustedBench).toFixed(2));
    const variancePct = adjustedBench > 0 ? Number(((variance / adjustedBench) * 100).toFixed(1)) : 0;

    quotedSubtotal += quoted;
    shouldSubtotal += adjustedBench;

    return {
      ...line,
      quotedCost: quoted,
      shouldCost: adjustedBench,
      variance,
      variancePct,
      padded: variancePct > 8,
    };
  });

  const quotedMarginAmt = Number((quotedSubtotal * ((Number(supplierProfitMarginQuotedPct) || 0) / 100)).toFixed(2));
  const shouldMarginAmt = Number((shouldSubtotal * ((Number(targetProfitMarginPct) || 0) / 100)).toFixed(2));

  const supplierTotalQuote = Number((quotedSubtotal + quotedMarginAmt).toFixed(2));
  const shouldCostTotal = Number((shouldSubtotal + shouldMarginAmt).toFixed(2));
  const overchargePerUnit = Number((supplierTotalQuote - shouldCostTotal).toFixed(2));
  const overchargePct = shouldCostTotal > 0 ? Number(((overchargePerUnit / shouldCostTotal) * 100).toFixed(1)) : 0;

  const recommendedAnchor = Number((shouldCostTotal * 0.94).toFixed(2));
  const targetPrice = shouldCostTotal;
  const reservationPrice = Number((shouldCostTotal * 1.07).toFixed(2));
  const qty = Math.max(1, Number(annualVolume) || 1);
  const annualizedSavings = Number((Math.max(0, overchargePerUnit) * qty).toFixed(2));
  const paddedLines = lines.filter((l) => l.padded).sort((a, b) => b.variance - a.variance);

  return {
    lines,
    quotedSubtotal: Number(quotedSubtotal.toFixed(2)),
    shouldSubtotal: Number(shouldSubtotal.toFixed(2)),
    quotedMarginAmt,
    shouldMarginAmt,
    supplierTotalQuote,
    shouldCostTotal,
    overchargePerUnit,
    overchargePct,
    recommendedAnchor,
    targetPrice,
    reservationPrice,
    annualVolume: qty,
    annualizedSavings,
    paddedLines,
  };
}

// ============================================================================
// NEG-LAB 04: BARGAINING POWER, CONCESSION PLANNING & DEADLOCK RESOLUTION
// ============================================================================

export function analyzePowerAndConcessions({
  drivers = {},
  buyerAnchor = 920,
  buyerReservation = 1150,
  supplierAnchor = 1280,
  concessionSteps = [],
}) {
  // Drivers scaled 1..5
  const spendAttractiveness = Math.max(1, Math.min(5, Number(drivers.spendAttractiveness) || 3));
  const buyerBatnaStrength = Math.max(1, Math.min(5, Number(drivers.buyerBatnaStrength) || 3));
  const marketTransparency = Math.max(1, Math.min(5, Number(drivers.marketTransparency) || 3));
  const switchingCost = Math.max(1, Math.min(5, Number(drivers.switchingCost) || 3));
  const supplyScarcity = Math.max(1, Math.min(5, Number(drivers.supplyScarcity) || 3));
  const buyerUrgency = Math.max(1, Math.min(5, Number(drivers.buyerUrgency) || 3));

  const buyerPowerScore = Math.round(((spendAttractiveness + buyerBatnaStrength + marketTransparency) / 15) * 100);
  const supplierPowerScore = Math.round(((switchingCost + supplyScarcity + buyerUrgency) / 15) * 100);

  let quadrant = 'Competitive Market';
  let posture = 'Distributive with competitive tension — anchor firmly using multi-quote BATNA.';
  if (buyerPowerScore >= 60 && supplierPowerScore < 60) {
    quadrant = 'Buyer Dominance';
    posture = 'Leverage competitive alternatives, demand open-book pricing, and cap concessions tightly.';
  } else if (buyerPowerScore >= 60 && supplierPowerScore >= 60) {
    quadrant = 'Strategic Interdependence';
    posture = 'Integrative value creation — use MESO packages, joint cost reduction, and multi-year trade-offs.';
  } else if (buyerPowerScore < 60 && supplierPowerScore >= 60) {
    quadrant = 'Supplier Dominance';
    posture = 'Harden BATNA first (dual-sourcing/spec redesign), avoid desperation urgency, and trade non-price value.';
  }

  const totalRoom = Math.max(1, Number(buyerReservation) - Number(buyerAnchor));
  const normalizedSteps = (concessionSteps || []).map((st, idx) => {
    const move = Math.max(0, Number(st.concessionAmount) || 0);
    const hasCondition = String(st.ifThenTrade || '').trim().length >= 8;
    return {
      round: idx + 1,
      move,
      ifThenTrade: String(st.ifThenTrade || '').trim(),
      hasCondition,
    };
  });

  let cumulative = Number(buyerAnchor) || 0;
  const trajectory = normalizedSteps.map((st) => {
    cumulative += st.move;
    return { ...st, offerAtRound: Number(cumulative.toFixed(2)) };
  });

  const totalConceded = Number((cumulative - (Number(buyerAnchor) || 0)).toFixed(2));
  const staysWithinReservation = cumulative <= Number(buyerReservation);

  // Check diminishing concession discipline (each subsequent move <= previous move)
  let diminishingCount = 0;
  let comparisons = 0;
  for (let i = 1; i < normalizedSteps.length; i++) {
    comparisons += 1;
    if (normalizedSteps[i].move <= normalizedSteps[i - 1].move) diminishingCount += 1;
  }
  const diminishingPattern = comparisons > 0 && diminishingCount === comparisons;
  const conditionedCount = normalizedSteps.filter((s) => s.hasCondition).length;
  const conditionalCoveragePct = normalizedSteps.length ? Math.round((conditionedCount / normalizedSteps.length) * 100) : 0;

  let readinessScore = 40;
  if (staysWithinReservation) readinessScore += 25;
  if (diminishingPattern) readinessScore += 20;
  readinessScore += Math.round((conditionalCoveragePct / 100) * 15);
  readinessScore = Math.max(0, Math.min(100, readinessScore));

  return {
    buyerPowerScore,
    supplierPowerScore,
    quadrant,
    posture,
    totalRoom: Number(totalRoom.toFixed(2)),
    totalConceded,
    finalPlannedOffer: Number(cumulative.toFixed(2)),
    staysWithinReservation,
    diminishingPattern,
    conditionalCoveragePct,
    readinessScore,
    trajectory,
    supplierAnchor: Number(supplierAnchor) || 0,
    buyerAnchor: Number(buyerAnchor) || 0,
    buyerReservation: Number(buyerReservation) || 0,
  };
}

// ============================================================================
// LIVE MULTI-STUDENT PAIRED CLASSROOM NEGOTIATION ENGINE (NEG-LAB 01 & 02)
// ============================================================================

export const LIVE_INTEGRATIVE_ISSUES = [
  {
    id: 'price',
    name: 'Unit Price (GHS)',
    options: [
      { id: 'p1', label: 'GHS 95 / unit', buyerPoints: 40, supplierPoints: 0 },
      { id: 'p2', label: 'GHS 105 / unit', buyerPoints: 26, supplierPoints: 18 },
      { id: 'p3', label: 'GHS 115 / unit', buyerPoints: 12, supplierPoints: 34 },
      { id: 'p4', label: 'GHS 125 / unit', buyerPoints: 0, supplierPoints: 48 },
    ],
  },
  {
    id: 'payment',
    name: 'Payment Terms',
    options: [
      { id: 'pay1', label: 'Net 15 Days (Fast Cash)', buyerPoints: 0, supplierPoints: 28 },
      { id: 'pay2', label: 'Net 30 Days', buyerPoints: 7, supplierPoints: 16 },
      { id: 'pay3', label: 'Net 60 Days', buyerPoints: 14, supplierPoints: 0 },
    ],
  },
  {
    id: 'leadtime',
    name: 'Delivery Lead Time',
    options: [
      { id: 'lt1', label: '7 Days Express', buyerPoints: 26, supplierPoints: 0 },
      { id: 'lt2', label: '14 Days Standard', buyerPoints: 15, supplierPoints: 10 },
      { id: 'lt3', label: '28 Days Economy', buyerPoints: 0, supplierPoints: 16 },
    ],
  },
  {
    id: 'warranty',
    name: 'Warranty & Defect Cover',
    options: [
      { id: 'w1', label: '24 Months Full Cover', buyerPoints: 18, supplierPoints: 0 },
      { id: 'w2', label: '12 Months Standard', buyerPoints: 10, supplierPoints: 5 },
      { id: 'w3', label: '6 Months Basic', buyerPoints: 0, supplierPoints: 8 },
    ],
  },
  {
    id: 'volume',
    name: 'Contract Volume Commitment',
    options: [
      { id: 'v1', label: '3-Year Exclusive (15k units)', buyerPoints: 2, supplierPoints: 22 },
      { id: 'v2', label: '2-Year Framework (10k units)', buyerPoints: 6, supplierPoints: 13 },
      { id: 'v3', label: '1-Year Spot Order (5k units)', buyerPoints: 10, supplierPoints: 0 },
    ],
  },
];

export function createInitialLiveNegState(labId) {
  if (labId === 'neg_integrative_pareto') {
    return {
      mode: 'integrative',
      issues: LIVE_INTEGRATIVE_ISSUES,
      buyerBatnaPts: 42,
      supplierBatnaPts: 42,
      revealFrontier: false,
      pairs: {}, // { [pairNo]: { status: 'open'|'agreed'|'impasse', offers: [], agreedPackage: null, buyerPts, supplierPts } }
      processedMoveIds: {},
    };
  }
  return {
    mode: 'distributive',
    currency: 'GHS',
    itemLabel: 'Industrial Steel Valves (Lot of 500)',
    buyerReservation: 1180,
    supplierReservation: 920,
    revealZopa: false,
    pairs: {}, // { [pairNo]: { status: 'open'|'agreed'|'impasse', offers: [], agreedPrice: null } }
    processedMoveIds: {},
  };
}

export function assignNegotiationPairs(participants = [], labId = 'neg_zopa_batna') {
  const map = {};
  (participants || []).forEach((p, idx) => {
    const pairNo = Math.floor(idx / 2) + 1;
    const role = idx % 2 === 0 ? 'buyer' : 'supplier';
    map[p.id] = {
      pairNo,
      role,
      roleLabel: role === 'buyer' ? 'Procurement Buyer' : 'Supplier Account Director',
      labId,
      partnerHint: `Pair ${pairNo}`,
    };
  });
  return map;
}

export function processLiveNegotiationMove(curState, { moveId, pairNo, role, fromName, action, price, packageChoices }) {
  const key = String(moveId || '');
  if (key && curState?.processedMoveIds?.[key]) {
    return { accepted: false, reason: 'Duplicate move ignored.', nextState: curState };
  }
  const pKey = String(pairNo || 1);
  const existingPair = curState?.pairs?.[pKey] || { status: 'open', offers: [], agreedPrice: null, agreedPackage: null };
  if (existingPair.status !== 'open') {
    return { accepted: false, reason: `Pair ${pKey} negotiation is already closed (${existingPair.status}).`, nextState: curState };
  }

  const nextPairs = { ...(curState?.pairs || {}) };
  const nextProcessed = { ...(curState?.processedMoveIds || {}), ...(key ? { [key]: true } : {}) };

  if (action === 'walk_away') {
    nextPairs[pKey] = {
      ...existingPair,
      status: 'impasse',
      closedBy: `${fromName} (${role})`,
      closedAt: new Date().toLocaleTimeString(),
    };
    return {
      accepted: true,
      summary: `Pair ${pKey}: ${fromName} (${role}) walked away to BATNA (Impasse).`,
      nextState: { ...curState, pairs: nextPairs, processedMoveIds: nextProcessed },
    };
  }

  if (curState.mode === 'integrative') {
    if (action === 'accept_latest') {
      const latest = existingPair.offers[existingPair.offers.length - 1];
      if (!latest || latest.role === role) {
        return { accepted: false, reason: 'Wait for a counterpart package offer before accepting.', nextState: curState };
      }
      const ev = evaluateIntegrativePackage(curState.issues, latest.packageChoices, curState.buyerBatnaPts, curState.supplierBatnaPts);
      nextPairs[pKey] = {
        ...existingPair,
        status: 'agreed',
        agreedPackage: latest.packageChoices,
        buyerPts: ev.buyerPoints,
        supplierPts: ev.supplierPoints,
        jointPts: ev.jointPoints,
        closedBy: `${fromName} (${role})`,
        closedAt: new Date().toLocaleTimeString(),
      };
      return {
        accepted: true,
        summary: `Pair ${pKey} AGREED on multi-issue package (Joint Score: ${ev.jointPoints} pts).`,
        nextState: { ...curState, pairs: nextPairs, processedMoveIds: nextProcessed },
      };
    }

    const ev = evaluateIntegrativePackage(curState.issues, packageChoices || {}, curState.buyerBatnaPts, curState.supplierBatnaPts);
    const offerEntry = {
      moveId: key || `m_${Date.now()}`,
      role,
      fromName,
      packageChoices: packageChoices || {},
      buyerPts: ev.buyerPoints,
      supplierPts: ev.supplierPoints,
      ts: new Date().toLocaleTimeString(),
    };
    nextPairs[pKey] = {
      ...existingPair,
      offers: [...existingPair.offers, offerEntry],
    };
    return {
      accepted: true,
      summary: `Pair ${pKey}: ${fromName} (${role}) sent a 5-issue package offer.`,
      nextState: { ...curState, pairs: nextPairs, processedMoveIds: nextProcessed },
    };
  }

  // Distributive mode
  if (action === 'accept_latest') {
    const latest = existingPair.offers[existingPair.offers.length - 1];
    if (!latest || latest.role === role) {
      return { accepted: false, reason: 'Wait for a counterpart price offer before accepting.', nextState: curState };
    }
    nextPairs[pKey] = {
      ...existingPair,
      status: 'agreed',
      agreedPrice: latest.price,
      closedBy: `${fromName} (${role})`,
      closedAt: new Date().toLocaleTimeString(),
    };
    return {
      accepted: true,
      summary: `Pair ${pKey} AGREED at ${curState.currency || 'GHS'} ${latest.price.toLocaleString()}!`,
      nextState: { ...curState, pairs: nextPairs, processedMoveIds: nextProcessed },
    };
  }

  const numPrice = Number(price);
  if (!Number.isFinite(numPrice) || numPrice <= 0) {
    return { accepted: false, reason: 'Enter a positive numeric offer.', nextState: curState };
  }
  const offerEntry = {
    moveId: key || `m_${Date.now()}`,
    role,
    fromName,
    price: Number(numPrice.toFixed(2)),
    ts: new Date().toLocaleTimeString(),
  };
  nextPairs[pKey] = {
    ...existingPair,
    offers: [...existingPair.offers, offerEntry],
  };
  return {
    accepted: true,
    summary: `Pair ${pKey}: ${fromName} (${role}) proposed ${curState.currency || 'GHS'} ${offerEntry.price.toLocaleString()}.`,
    nextState: { ...curState, pairs: nextPairs, processedMoveIds: nextProcessed },
  };
}
