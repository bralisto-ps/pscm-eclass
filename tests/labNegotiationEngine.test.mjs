import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_INTEGRATIVE_ISSUES,
  analyzeDistributiveZopa,
  analyzePowerAndConcessions,
  analyzeShouldCostModel,
  assignNegotiationPairs,
  computeParetoFrontier,
  createInitialLiveNegState,
  evaluateCounterpartOffer,
  evaluateIntegrativePackage,
  processLiveNegotiationMove,
  scoreDealAgainstFrontier,
} from '../src/lib/labNegotiationEngine.js';

test('NEG-LAB 01: Distributive ZOPA detects positive ZOPA, negative ZOPA, surplus split, and counterpart responses', () => {
  const pos = analyzeDistributiveZopa({
    buyerBatna: 1150,
    buyerSwitchingCost: 50,
    supplierCost: 800,
    supplierMinMarginPct: 12.5,
    supplierAltOffer: 880,
    agreedPrice: 1020,
    quantity: 500,
  });
  assert.equal(pos.buyerReservation, 1200);
  assert.equal(pos.supplierReservation, 900);
  assert.equal(pos.zopaExists, true);
  assert.equal(pos.zopaWidth, 300);
  assert.equal(pos.midpoint, 1050);
  assert.equal(pos.dealMetrics.withinZopa, true);
  assert.equal(pos.dealMetrics.buyerUnitSurplus, 180);
  assert.equal(pos.dealMetrics.supplierUnitSurplus, 120);
  assert.equal(pos.dealMetrics.buyerSharePct, 60);

  const neg = analyzeDistributiveZopa({
    buyerBatna: 850,
    buyerSwitchingCost: 20,
    supplierCost: 900,
    supplierMinMarginPct: 10,
    supplierAltOffer: 950,
  });
  assert.equal(neg.zopaExists, false);
  assert.ok(neg.zopaWidth < 0);

  const counter = evaluateCounterpartOffer({ offerPrice: 920, round: 1, maxRounds: 6, supplierReservation: 900, supplierAnchor: 1280, lastSupplierOffer: 1280 });
  assert.equal(counter.status, 'counter');
  assert.ok(counter.supplierCounter < 1280 && counter.supplierCounter >= 900);

  const accepted = evaluateCounterpartOffer({ offerPrice: 1150, round: 2, maxRounds: 6, supplierReservation: 900, supplierAnchor: 1280, lastSupplierOffer: 1200 });
  assert.equal(accepted.status, 'accepted');

  const impasse = evaluateCounterpartOffer({ offerPrice: 820, round: 6, maxRounds: 6, supplierReservation: 900, supplierAnchor: 1280, lastSupplierOffer: 960 });
  assert.equal(impasse.status, 'impasse');
});

test('NEG-LAB 02: Integrative multi-issue Pareto Frontier solver finds undominated logrolling optimum', () => {
  const frontierRes = computeParetoFrontier(LIVE_INTEGRATIVE_ISSUES, 42, 42);
  assert.equal(frontierRes.allCombos.length, 324);
  assert.ok(frontierRes.frontier.length >= 2);
  assert.ok(frontierRes.maxJointDeal.jointPoints > 120);

  // Middle compromise options should be dominated (sub-optimal) compared to logrolling
  const midChoices = Object.fromEntries(LIVE_INTEGRATIVE_ISSUES.map((i) => [i.id, i.options[1].id]));
  const midEval = evaluateIntegrativePackage(LIVE_INTEGRATIVE_ISSUES, midChoices, 42, 42);
  const midScore = scoreDealAgainstFrontier(midEval, frontierRes);
  assert.ok(midScore.paretoEfficiencyPct < 100);
  assert.ok(midScore.valueLeftOnTable > 0);

  // Optimal Pareto package should achieve 100% frontier efficiency
  const bestPt = frontierRes.maxJointDeal;
  const bestEval = evaluateIntegrativePackage(LIVE_INTEGRATIVE_ISSUES, bestPt.selections, 42, 42);
  const bestScore = scoreDealAgainstFrontier(bestEval, frontierRes);
  assert.equal(bestScore.isParetoOptimal, true);
  assert.equal(bestScore.paretoEfficiencyPct, 100);
});

test('NEG-LAB 03: Should-cost model calculates commodity & learning-curve adjusted cost and flags padded quotes', () => {
  const res = analyzeShouldCostModel({
    costLines: [
      { id: 'c1', name: 'Raw Steel', category: 'Materials', quotedCost: 460, benchmarkCost: 350 },
      { id: 'c2', name: 'Assembly Labour', category: 'Labour', quotedCost: 140, benchmarkCost: 110 },
      { id: 'c3', name: 'Freight & Duty', category: 'Logistics', quotedCost: 65, benchmarkCost: 60 },
    ],
    supplierProfitMarginQuotedPct: 24,
    targetProfitMarginPct: 12,
    commodityIndexShiftPct: 5,
    volumeMultiplier: 2,
    learningCurvePct: 90,
    annualVolume: 2000,
  });
  assert.equal(res.lines.length, 3);
  assert.equal(res.lines[0].padded, true);
  assert.ok(res.supplierTotalQuote > res.shouldCostTotal);
  assert.ok(res.annualizedSavings > 0);
  // 2x volume at 90% learning curve should reduce labour benchmark by 10% (110 -> 99)
  assert.equal(res.lines[1].shouldCost, 99);
});

test('NEG-LAB 04: Power balance quadrant and diminishing concession schedule evaluation', () => {
  const res = analyzePowerAndConcessions({
    drivers: {
      spendAttractiveness: 5,
      buyerBatnaStrength: 5,
      marketTransparency: 4,
      switchingCost: 2,
      supplyScarcity: 2,
      buyerUrgency: 2,
    },
    buyerAnchor: 900,
    buyerReservation: 1100,
    supplierAnchor: 1250,
    concessionSteps: [
      { concessionAmount: 80, ifThenTrade: 'If supplier confirms 14-day lead time' },
      { concessionAmount: 45, ifThenTrade: 'If warranty increases to 24 months' },
      { concessionAmount: 20, ifThenTrade: 'If Net 45 payment terms included' },
    ],
  });
  assert.equal(res.quadrant, 'Buyer Dominance');
  assert.equal(res.diminishingPattern, true);
  assert.equal(res.staysWithinReservation, true);
  assert.equal(res.conditionalCoveragePct, 100);
  assert.equal(res.readinessScore, 100);
});

test('Live Classroom Paired Negotiation: distributive & integrative moves, idempotency, accept, and walk-away', () => {
  const participants = [
    { id: 's1', name: 'Ama' },
    { id: 's2', name: 'Kwame' },
    { id: 's3', name: 'Esi' },
    { id: 's4', name: 'Kojo' },
  ];
  const pairs = assignNegotiationPairs(participants, 'neg_zopa_batna');
  assert.equal(pairs.s1.pairNo, 1);
  assert.equal(pairs.s1.role, 'buyer');
  assert.equal(pairs.s2.pairNo, 1);
  assert.equal(pairs.s2.role, 'supplier');
  assert.equal(pairs.s3.pairNo, 2);

  let st = createInitialLiveNegState('neg_zopa_batna');
  const m1 = processLiveNegotiationMove(st, { moveId: 'm1', pairNo: 1, role: 'buyer', fromName: 'Ama', action: 'offer', price: 960 });
  assert.equal(m1.accepted, true);
  st = m1.nextState;

  const dup = processLiveNegotiationMove(st, { moveId: 'm1', pairNo: 1, role: 'buyer', fromName: 'Ama', action: 'offer', price: 960 });
  assert.equal(dup.accepted, false);

  const selfAcc = processLiveNegotiationMove(st, { moveId: 'm2', pairNo: 1, role: 'buyer', fromName: 'Ama', action: 'accept_latest' });
  assert.equal(selfAcc.accepted, false);

  const acc = processLiveNegotiationMove(st, { moveId: 'm3', pairNo: 1, role: 'supplier', fromName: 'Kwame', action: 'accept_latest' });
  assert.equal(acc.accepted, true);
  assert.equal(acc.nextState.pairs['1'].status, 'agreed');
  assert.equal(acc.nextState.pairs['1'].agreedPrice, 960);

  const walk = processLiveNegotiationMove(acc.nextState, { moveId: 'm4', pairNo: 2, role: 'buyer', fromName: 'Esi', action: 'walk_away' });
  assert.equal(walk.accepted, true);
  assert.equal(walk.nextState.pairs['2'].status, 'impasse');

  let ist = createInitialLiveNegState('neg_integrative_pareto');
  const pkg = Object.fromEntries(LIVE_INTEGRATIVE_ISSUES.map((i) => [i.id, i.options[0].id]));
  const im1 = processLiveNegotiationMove(ist, { moveId: 'im1', pairNo: 1, role: 'buyer', fromName: 'Ama', action: 'offer', packageChoices: pkg });
  assert.equal(im1.accepted, true);
  const im2 = processLiveNegotiationMove(im1.nextState, { moveId: 'im2', pairNo: 1, role: 'supplier', fromName: 'Kwame', action: 'accept_latest' });
  assert.equal(im2.accepted, true);
  assert.equal(im2.nextState.pairs['1'].status, 'agreed');
  assert.ok(im2.nextState.pairs['1'].jointPts > 0);
});
