// Pure deterministic engine for Milestone 3 PSIS Laboratories:
// 1. Lab 1 (The Whip): 4-tier Bullwhip Effect simulator (Blind vs POS Visibility + Latency/Paper Mode)
// 2. Lab 5 (Requisition to Order): DoA Approval Router, Commitment vs Spent Budget Check, Blanket Order ROI
// 3. Lab 6 (The Tender): Weighted Sealed Tender Evaluation & Multi-Round Reverse Auction Simulator

// ============================================================================
// 1. BULLWHIP EFFECT SIMULATOR (LAB 1: THE WHIP)
// ============================================================================

export const TIER_KEYS = ['retailer', 'wholesaler', 'distributor', 'factory'];
export const TIER_LABELS = {
  retailer: 'Retailer',
  wholesaler: 'Wholesaler',
  distributor: 'Distributor',
  factory: 'Factory',
};

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function sampleVariance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

/**
 * Computes statistical bullwhip diagnostics for a 4-tier supply chain simulation.
 * @param {number[]} demandSeries - Weekly end-consumer demand
 * @param {Object<string, number[]>} tierOrders - Orders placed by each tier
 * @param {Object<string, number>} tierCosts - Cumulative holding + backlog cost per tier
 */
export function computeBullwhipMetrics(demandSeries, tierOrders, tierCosts = {}) {
  const dMean = mean(demandSeries);
  const dVar = sampleVariance(demandSeries);
  const dStd = Math.sqrt(dVar);
  const dCv = dMean > 0 ? dStd / dMean : 0;

  const tiers = TIER_KEYS.map((key) => {
    const orders = tierOrders[key] || [];
    const oMean = mean(orders);
    const oVar = sampleVariance(orders);
    const oStd = Math.sqrt(oVar);
    const cv = oMean > 0 ? oStd / oMean : 0;
    const peak = orders.length ? Math.max(...orders) : 0;
    const min = orders.length ? Math.min(...orders) : 0;
    const bullwhipRatio = dVar > 1e-9 ? oVar / dVar : 1;
    return {
      key,
      label: TIER_LABELS[key],
      meanOrder: Number(oMean.toFixed(1)),
      stdDev: Number(oStd.toFixed(2)),
      cv: Number(cv.toFixed(3)),
      peak,
      min,
      bullwhipRatio: Number(bullwhipRatio.toFixed(2)),
      totalCost: Number((tierCosts[key] || 0).toFixed(2)),
    };
  });

  const totalChainCost = tiers.reduce((s, t) => s + t.totalCost, 0);
  const maxBullwhip = tiers.reduce((m, t) => Math.max(m, t.bullwhipRatio), 1);

  return {
    weeks: demandSeries.length,
    consumerMean: Number(dMean.toFixed(1)),
    consumerStd: Number(dStd.toFixed(2)),
    consumerCv: Number(dCv.toFixed(3)),
    consumerPeak: demandSeries.length ? Math.max(...demandSeries) : 0,
    tiers,
    totalChainCost: Number(totalChainCost.toFixed(2)),
    maxBullwhip: Number(maxBullwhip.toFixed(2)),
  };
}

/**
 * Runs a complete deterministic 4-tier Beer-Game / Bullwhip simulation.
 * Supports:
 * - Student manual orders for Retailer (or auto-ordering policy when omitted)
 * - Information regime: 'blind' (classic local-order forecasting) vs 'pos_shared' (consumer POS visible to all tiers)
 * - Latency / Paper Mode: infoDelayWeeks (0 = digital real-time, 1-2 = batched paper delay)
 */
export function runBullwhipSimulation({
  demandSeries = [],
  retailerManualOrders = [],
  regime = 'blind', // 'blind' | 'pos_shared'
  leadTimeWeeks = 2,
  infoDelayWeeks = 0, // Paper Mode latency
  holdingCost = 1,
  backlogCost = 4,
  initialStock = 60,
}) {
  const weeks = demandSeries.length;
  const lt = Math.max(1, Math.min(4, Math.round(Number(leadTimeWeeks) || 2)));
  const infoDelay = Math.max(0, Math.min(3, Math.round(Number(infoDelayWeeks) || 0)));
  const hCost = Math.max(0, Number(holdingCost) || 1);
  const bCost = Math.max(0, Number(backlogCost) || 4);
  const baseDemand = demandSeries[0] || 40;

  // Per-tier state
  const state = {};
  TIER_KEYS.forEach((key) => {
    state[key] = {
      stock: Math.max(0, Number(initialStock) || 60),
      backlog: 0,
      forecast: baseDemand,
      // Total replenishment pipeline = physical shipment lead time + paper-mode order delay
      shipmentPipe: Array.from({ length: lt + infoDelay }, () => baseDemand),
      // Order info delay queue arriving from downstream (length = infoDelay)
      orderQueue: Array.from({ length: infoDelay }, () => baseDemand),
      cost: 0,
      orders: [],
      stocks: [],
      backlogs: [],
      incomingDemands: [],
    };
  });

  const history = [];

  for (let w = 0; w < weeks; w++) {
    const consumerDemand = Math.max(0, Number(demandSeries[w]) || 0);
    const weekOrders = {};
    const weekStocks = {};
    const weekBacklogs = {};

    // Process tiers from Retailer upstream to Factory
    let downstreamOrderToPass = consumerDemand;

    for (let tIdx = 0; tIdx < TIER_KEYS.length; tIdx++) {
      const key = TIER_KEYS[tIdx];
      const st = state[key];

      // 1. Incoming shipment arrives from upstream pipeline
      const arrived = st.shipmentPipe.shift() || 0;
      st.stock += arrived;

      // 2. Incoming demand reaches this tier (Retailer sees consumer immediately; upstream may suffer paper-mode info delay)
      let incomingDemand = downstreamOrderToPass;
      if (tIdx > 0 && infoDelay > 0) {
        st.orderQueue.push(downstreamOrderToPass);
        incomingDemand = st.orderQueue.shift();
      }
      st.incomingDemands.push(incomingDemand);

      // 3. Fulfill incoming demand + prior backlog
      const totalObligation = incomingDemand + st.backlog;
      let shipped = 0;
      if (st.stock >= totalObligation) {
        shipped = totalObligation;
        st.stock -= totalObligation;
        st.backlog = 0;
      } else {
        shipped = st.stock;
        st.backlog = totalObligation - st.stock;
        st.stock = 0;
      }

      // 4. Accrue weekly holding + shortage cost
      st.cost += st.stock * hCost + st.backlog * bCost;

      // 5. Decide replenishment order to place upstream
      let orderQty;
      if (key === 'retailer' && retailerManualOrders[w] !== undefined && retailerManualOrders[w] !== null && retailerManualOrders[w] !== '') {
        orderQty = Math.max(0, Math.round(Number(retailerManualOrders[w]) || 0));
      } else if (regime === 'pos_shared') {
        // Shared POS visibility: all tiers anchor forecast to actual consumer demand with light smoothing + full pipeline accounting
        const alpha = 0.25;
        st.forecast = alpha * consumerDemand + (1 - alpha) * st.forecast;
        const pipelineSum = st.shipmentPipe.reduce((a, b) => a + b, 0);
        const targetPos = st.forecast * (lt + 1.2);
        const invPosition = st.stock - st.backlog + pipelineSum;
        // Damped adjustment avoids over-reaction
        orderQty = Math.max(0, Math.round(st.forecast + 0.35 * (targetPos - invPosition)));
      } else {
        // Classic Blind Regime (Sterman behavioral heuristic): reacts strongly to local incoming order + underweights pipeline
        const alpha = 0.45 + tIdx * 0.05;
        st.forecast = alpha * incomingDemand + (1 - alpha) * st.forecast;
        const pipelineSum = st.shipmentPipe.reduce((a, b) => a + b, 0);
        const targetStock = st.forecast * (lt + infoDelay + 1.5);
        // Underweighting pipeline (beta = 0.35) + panicking on backlog creates authentic human bullwhip amplification
        const perceivedPosition = st.stock - st.backlog * 1.15 + 0.35 * pipelineSum;
        orderQty = Math.max(0, Math.round(st.forecast + 0.65 * (targetStock - perceivedPosition)));
      }

      // Push upstream fulfillment into this tier's pipeline (Factory has infinite raw capacity, upstream tiers ship what they have in classic model, approximated cleanly via orderQty entering shipmentPipe for factory or shipped upstream)
      st.shipmentPipe.push(orderQty);

      st.orders.push(orderQty);
      st.stocks.push(st.stock);
      st.backlogs.push(st.backlog);

      weekOrders[key] = orderQty;
      weekStocks[key] = st.stock;
      weekBacklogs[key] = st.backlog;

      // Next upstream tier receives this tier's order
      downstreamOrderToPass = orderQty;
    }

    history.push({
      week: w + 1,
      consumerDemand,
      orders: weekOrders,
      stocks: weekStocks,
      backlogs: weekBacklogs,
    });
  }

  const tierOrders = {};
  const tierCosts = {};
  TIER_KEYS.forEach((k) => {
    tierOrders[k] = state[k].orders;
    tierCosts[k] = state[k].cost;
  });

  const metrics = computeBullwhipMetrics(demandSeries, tierOrders, tierCosts);

  return {
    regime,
    leadTimeWeeks: lt,
    infoDelayWeeks: infoDelay,
    history,
    tierOrders,
    metrics,
  };
}

// ============================================================================
// 2. REQUISITION TO ORDER, DoA & COMMITMENT ACCOUNTING (LAB 5)
// ============================================================================

export const DEFAULT_DOA_TIERS = [
  { id: 'doa_1', maxAmount: 5000, approver: 'Department Head', slaHours: 4, steps: 1 },
  { id: 'doa_2', maxAmount: 25000, approver: 'Procurement Manager', slaHours: 16, steps: 2 },
  { id: 'doa_3', maxAmount: 100000, approver: 'Finance Director', slaHours: 40, steps: 3 },
  { id: 'doa_4', maxAmount: Infinity, approver: 'Entity Tender Committee', slaHours: 96, steps: 4 },
];

/**
 * Evaluates a list of procurement requisitions sequentially against:
 * - Delegation of Authority (DoA) routing thresholds
 * - Split-order avoidance detection (multiple same-cost-centre/same-supplier reqs summing over a DoA limit)
 * - Budget Accounting Mode: 'commitment' (deducts on PO approval) vs 'spent_only' (deducts only after cash payment)
 */
export function evaluateRequisitionBatch({
  requisitions = [],
  budgets = {},
  accountingMode = 'commitment', // 'commitment' | 'spent_only'
  doaTiers = DEFAULT_DOA_TIERS,
}) {
  const sortedDoa = [...doaTiers].sort((a, b) => a.maxAmount - b.maxAmount);
  const tracker = {};
  Object.entries(budgets || {}).forEach(([cc, cfg]) => {
    const limit = typeof cfg === 'number' ? cfg : Number(cfg?.budget || 0);
    const alreadySpent = typeof cfg === 'object' ? Number(cfg?.spent || 0) : 0;
    tracker[cc] = {
      costCentre: cc,
      budget: Math.max(0, limit),
      spent: Math.max(0, alreadySpent),
      committed: 0,
      overCommittedAmount: 0,
    };
  });

  // Track cumulative spend per (costCentre + supplier) to flag potential split orders
  const splitTracker = new Map();

  const results = requisitions.map((req, idx) => {
    const qty = Math.max(1, Number(req.qty) || 1);
    const unitPrice = Math.max(0, Number(req.unitPrice) || 0);
    const total = qty * unitPrice;
    const cc = req.costCentre || 'General';
    if (!tracker[cc]) {
      tracker[cc] = { costCentre: cc, budget: 50000, spent: 0, committed: 0, overCommittedAmount: 0 };
    }
    const bState = tracker[cc];

    // DoA routing lookup
    const doa = sortedDoa.find((t) => total <= t.maxAmount) || sortedDoa[sortedDoa.length - 1];

    // Split-order suspicion check (same costCentre + supplier crossing the tier above individual req)
    const splitKey = `${cc}::${String(req.supplier || '').toLowerCase()}`;
    const prevSplit = splitTracker.get(splitKey) || { count: 0, sum: 0 };
    const nextSplit = { count: prevSplit.count + 1, sum: prevSplit.sum + total };
    splitTracker.set(splitKey, nextSplit);
    const combinedDoa = sortedDoa.find((t) => nextSplit.sum <= t.maxAmount) || sortedDoa[sortedDoa.length - 1];
    const splitOrderFlag = nextSplit.count >= 2 && combinedDoa.id !== doa.id;

    // Available budget check depends strictly on accountingMode
    const availableAtCheck = accountingMode === 'commitment'
      ? bState.budget - bState.spent - bState.committed
      : bState.budget - bState.spent;

    let status = 'APPROVED';
    let reason = `Routed to ${doa.approver} (${doa.slaHours}h SLA). Budget verified.`;

    if (total > availableAtCheck + 0.01) {
      status = 'BOUNCED_BUDGET';
      reason = `Insufficient ${accountingMode === 'commitment' ? 'uncommitted' : 'cash'} budget (${availableAtCheck.toLocaleString()} available vs ${total.toLocaleString()} required).`;
    } else {
      // Approved! In real life, an approved PO ALWAYS creates a legal commitment,
      // even if Spent-Only mode failed to deduct it before approving the next PO!
      bState.committed += total;
      if (req.paid) {
        bState.spent += total;
        bState.committed = Math.max(0, bState.committed - total);
      }
      const trueExposure = bState.spent + bState.committed;
      if (trueExposure > bState.budget + 0.01) {
        bState.overCommittedAmount = Math.max(bState.overCommittedAmount, trueExposure - bState.budget);
      }
    }

    const trueRemainingAfter = bState.budget - bState.spent - bState.committed;

    return {
      id: req.id || `REQ-${idx + 1}`,
      reqNo: req.reqNo || `REQ-2026-${String(idx + 1).padStart(3, '0')}`,
      item: req.item || 'Catalogue Item',
      supplier: req.supplier || 'Approved Vendor',
      costCentre: cc,
      qty,
      unitPrice,
      total,
      approver: doa.approver,
      slaHours: doa.slaHours,
      steps: doa.steps,
      status,
      reason,
      splitOrderFlag,
      availableAtCheck: Number(availableAtCheck.toFixed(2)),
      trueRemainingAfter: Number(trueRemainingAfter.toFixed(2)),
      causedDoubleCommit: status === 'APPROVED' && trueRemainingAfter < -0.01,
    };
  });

  const approvedCount = results.filter((r) => r.status === 'APPROVED').length;
  const bouncedCount = results.filter((r) => r.status === 'BOUNCED_BUDGET').length;
  const doubleCommitCount = results.filter((r) => r.causedDoubleCommit).length;
  const splitFlagsCount = results.filter((r) => r.splitOrderFlag).length;
  const avgCycleHours = results.length
    ? Number((results.reduce((s, r) => s + r.slaHours, 0) / results.length).toFixed(1))
    : 0;

  const budgetSummaries = Object.values(tracker).map((b) => ({
    ...b,
    trueRemaining: Number((b.budget - b.spent - b.committed).toFixed(2)),
    utilizationPct: b.budget > 0 ? Number((((b.spent + b.committed) / b.budget) * 100).toFixed(1)) : 0,
  }));

  return {
    accountingMode,
    results,
    budgetSummaries,
    summary: {
      totalReqs: results.length,
      approvedCount,
      bouncedCount,
      doubleCommitCount,
      splitFlagsCount,
      avgCycleHours,
      totalOverCommitment: Number(budgetSummaries.reduce((s, b) => s + b.overCommittedAmount, 0).toFixed(2)),
    },
  };
}

/**
 * Compares administrative transaction cost & cycle time of N standard POs
 * vs 1 Blanket Purchase Agreement (BPA) + N low-cost Call-Offs.
 */
export function compareBlanketVsStandard({
  orderCount = 11,
  standardPoCost = 650,
  standardCycleHours = 36,
  blanketSetupCost = 1800,
  callOffCost = 95,
  callOffCycleHours = 3,
}) {
  const n = Math.max(1, Math.round(Number(orderCount) || 1));
  const stdCost = Math.max(0, Number(standardPoCost) || 0);
  const stdHrs = Math.max(0, Number(standardCycleHours) || 0);
  const bpaSetup = Math.max(0, Number(blanketSetupCost) || 0);
  const coCost = Math.max(0, Number(callOffCost) || 0);
  const coHrs = Math.max(0, Number(callOffCycleHours) || 0);

  const totalStandardCost = n * stdCost;
  const totalBlanketCost = bpaSetup + n * coCost;
  const costSavings = totalStandardCost - totalBlanketCost;
  const savingsPct = totalStandardCost > 0 ? (costSavings / totalStandardCost) * 100 : 0;

  const totalStandardHours = n * stdHrs;
  const totalBlanketHours = stdHrs + n * coHrs; // Initial setup takes 1 full cycle + rapid call-offs
  const hoursSaved = totalStandardHours - totalBlanketHours;

  const unitSavings = stdCost - coCost;
  const breakEvenOrders = unitSavings > 0 ? Math.ceil(bpaSetup / unitSavings) : null;

  return {
    orderCount: n,
    totalStandardCost,
    totalBlanketCost,
    costSavings,
    savingsPct: Number(savingsPct.toFixed(1)),
    totalStandardHours,
    totalBlanketHours,
    hoursSaved,
    breakEvenOrders,
    blanketWins: totalBlanketCost < totalStandardCost,
  };
}

// ============================================================================
// 3. SEALED TENDER EVALUATION & REVERSE AUCTION (LAB 6: THE TENDER)
// ============================================================================

/**
 * Evaluates sealed supplier bids using transparent multi-criteria weighted scoring.
 * Price score = (Lowest Valid Bid / Supplier Bid) * 100
 * Lead-time score = (Fastest Lead Time / Supplier Lead Time) * 100
 * Technical & Local Content scores are entered directly on a 0-100 scale.
 */
export function evaluateSealedTender(bids = [], weights = {}) {
  const wPrice = Math.max(0, Number(weights.price ?? 45));
  const wTech = Math.max(0, Number(weights.technical ?? 30));
  const wDelivery = Math.max(0, Number(weights.delivery ?? 15));
  const wLocal = Math.max(0, Number(weights.localContent ?? 10));
  const weightSum = wPrice + wTech + wDelivery + wLocal || 100;

  const normW = {
    price: (wPrice / weightSum) * 100,
    technical: (wTech / weightSum) * 100,
    delivery: (wDelivery / weightSum) * 100,
    localContent: (wLocal / weightSum) * 100,
  };

  const validBids = (bids || []).filter((b) => Number(b.price) > 0);
  if (!validBids.length) {
    return { normalizedWeights: normW, weightSum, ranked: [], winner: null, lowestPriceBid: null };
  }

  const minPrice = Math.min(...validBids.map((b) => Number(b.price)));
  const minDays = Math.min(...validBids.map((b) => Math.max(1, Number(b.leadTimeDays) || 1)));

  const scored = validBids.map((b) => {
    const price = Number(b.price);
    const days = Math.max(1, Number(b.leadTimeDays) || 1);
    const tech = Math.max(0, Math.min(100, Number(b.technicalScore) || 0));
    const local = Math.max(0, Math.min(100, Number(b.localContentScore) || 0));

    const priceScore = (minPrice / price) * 100;
    const deliveryScore = (minDays / days) * 100;

    const weightedPrice = (priceScore * normW.price) / 100;
    const weightedTech = (tech * normW.technical) / 100;
    const weightedDelivery = (deliveryScore * normW.delivery) / 100;
    const weightedLocal = (local * normW.localContent) / 100;
    const totalScore = weightedPrice + weightedTech + weightedDelivery + weightedLocal;

    return {
      ...b,
      price,
      leadTimeDays: days,
      technicalScore: tech,
      localContentScore: local,
      priceScore: Number(priceScore.toFixed(1)),
      deliveryScore: Number(deliveryScore.toFixed(1)),
      weightedPrice: Number(weightedPrice.toFixed(2)),
      weightedTech: Number(weightedTech.toFixed(2)),
      weightedDelivery: Number(weightedDelivery.toFixed(2)),
      weightedLocal: Number(weightedLocal.toFixed(2)),
      totalScore: Number(totalScore.toFixed(2)),
    };
  });

  scored.sort((a, b) => b.totalScore - a.totalScore || a.price - b.price);
  const ranked = scored.map((item, idx) => ({ ...item, rank: idx + 1 }));
  const lowestPriceBid = [...ranked].sort((a, b) => a.price - b.price)[0];

  return {
    normalizedWeights: {
      price: Number(normW.price.toFixed(1)),
      technical: Number(normW.technical.toFixed(1)),
      delivery: Number(normW.delivery.toFixed(1)),
      localContent: Number(normW.localContent.toFixed(1)),
    },
    weightSum,
    ranked,
    winner: ranked[0] || null,
    lowestPriceBid,
    bestValueBeatLowestPrice: Boolean(ranked[0] && lowestPriceBid && ranked[0].id !== lowestPriceBid.id),
  };
}

/**
 * Advances a multi-round live Reverse Auction by one round.
 * Suppliers observe the current leading (lowest) bid and decide whether to undercut
 * above their private walk-away floor cost.
 */
export function stepReverseAuctionRound({
  currentBids = [],
  minDecrementPct = 1.5,
  roundNumber = 1,
}) {
  if (!currentBids.length) return { roundNumber, bids: [], leader: null, activeBidders: 0, converged: true };

  const currentLowest = Math.min(...currentBids.map((b) => Number(b.currentPrice)));
  const stepFactor = Math.max(0.5, Number(minDecrementPct) || 1.5) / 100;
  let dropsThisRound = 0;

  const nextBids = currentBids.map((b) => {
    const cur = Number(b.currentPrice);
    const floor = Math.max(1, Number(b.reserveFloor) || cur * 0.8);
    // Current leader holds unless someone beats them; trailing bidders try to undercut leader
    if (cur <= currentLowest + 0.01) {
      return { ...b, droppedThisRound: false, active: true };
    }
    const targetBid = Math.round(currentLowest * (1 - stepFactor * (0.8 + (b.aggressiveness || 0.5) * 0.8)));
    if (targetBid >= floor) {
      dropsThisRound += 1;
      return {
        ...b,
        currentPrice: targetBid,
        droppedThisRound: true,
        active: true,
        belowQualityFloor: targetBid < Number(b.sustainableCost || floor * 1.04),
      };
    }
    // Cannot beat leader profitably; bid down to floor once if not already there, else drop out
    if (cur > floor && floor < currentLowest) {
      dropsThisRound += 1;
      return {
        ...b,
        currentPrice: Math.round(floor),
        droppedThisRound: true,
        active: true,
        belowQualityFloor: Math.round(floor) < Number(b.sustainableCost || floor * 1.04),
      };
    }
    return { ...b, droppedThisRound: false, active: false };
  });

  const sorted = [...nextBids].sort((a, b) => a.currentPrice - b.currentPrice);
  const ranked = sorted.map((b, i) => ({ ...b, rank: i + 1 }));
  const activeBidders = ranked.filter((b) => b.active).length;

  return {
    roundNumber,
    bids: ranked,
    leader: ranked[0],
    activeBidders,
    dropsThisRound,
    converged: dropsThisRound === 0,
  };
}
