import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareBlanketVsStandard,
  evaluateRequisitionBatch,
  evaluateSealedTender,
  runBullwhipSimulation,
  stepReverseAuctionRound,
} from '../src/lib/psisMilestone3Engine.js';

test('The Whip: Blind Mode amplifies +40% rumour spike upstream while Shared POS compresses bullwhip and cost', () => {
  const demandSeries = [40, 40, 40, 40, 40, 40, 40, 40, 56, 56, 56, 40, 40, 40, 40, 40, 40, 40, 40, 40];

  const blind = runBullwhipSimulation({ demandSeries, regime: 'blind', leadTimeWeeks: 2, infoDelayWeeks: 0 });
  const blindPaper = runBullwhipSimulation({ demandSeries, regime: 'blind', leadTimeWeeks: 2, infoDelayWeeks: 1 });
  const sharedPos = runBullwhipSimulation({ demandSeries, regime: 'pos_shared', leadTimeWeeks: 2, infoDelayWeeks: 0 });

  assert.equal(blind.history.length, 20);
  const blindFactory = blind.metrics.tiers[3];
  const posFactory = sharedPos.metrics.tiers[3];

  // Classic bullwhip amplification in Blind Mode
  assert.ok(blindFactory.bullwhipRatio > 1.5, `Expected Blind factory bullwhip > 1.5, got ${blindFactory.bullwhipRatio}`);
  assert.ok(blindFactory.peak > blind.metrics.consumerPeak, 'Factory peak must exceed consumer peak in Blind Mode');

  // Shared POS visibility compresses factory bullwhip & lowers chain cost
  assert.ok(posFactory.bullwhipRatio < blindFactory.bullwhipRatio, 'POS visibility must reduce factory bullwhip ratio');
  assert.ok(sharedPos.metrics.totalChainCost < blind.metrics.totalChainCost, 'POS visibility must reduce total chain cost');

  // Paper-Mode information delay increases chain cost or oscillation
  assert.ok(blindPaper.metrics.totalChainCost >= blind.metrics.totalChainCost * 0.95);
});

test('Requisition to Order: Spent-Only permits double-commitment while Commitment Accounting blocks over-budget & flags split orders', () => {
  const budgets = {
    'Clinical & Lab': { budget: 32000, spent: 4000 },
    'IT & Campus Ops': { budget: 24000, spent: 2000 },
  };
  const requisitions = [
    { id: 'r1', reqNo: 'REQ-001', item: 'Reagent Kit', supplier: 'BioLab', costCentre: 'Clinical & Lab', qty: 12, unitPrice: 1450 }, // 17,400
    { id: 'r2', reqNo: 'REQ-002', item: 'Reagent Kit', supplier: 'BioLab', costCentre: 'Clinical & Lab', qty: 10, unitPrice: 1450 }, // 14,500 -> combined 31,900 > 28,000 left!
    { id: 'r3', reqNo: 'REQ-003', item: 'A4 Paper', supplier: 'Apex', costCentre: 'IT & Campus Ops', qty: 15, unitPrice: 320 }, // 4,800 (<= 5,000 Dept Head)
    { id: 'r4', reqNo: 'REQ-004', item: 'A4 Paper', supplier: 'Apex', costCentre: 'IT & Campus Ops', qty: 14, unitPrice: 320 }, // 4,480 -> combined 9,280 crosses 5,000 threshold (split order flag!)
  ];

  const spentRes = evaluateRequisitionBatch({ requisitions, budgets, accountingMode: 'spent_only' });
  const commitRes = evaluateRequisitionBatch({ requisitions, budgets, accountingMode: 'commitment' });

  // Spent-Only mistakenly approves r2 and causes double-commitment over-budget
  assert.equal(spentRes.results[1].status, 'APPROVED');
  assert.equal(spentRes.results[1].causedDoubleCommit, true);
  assert.ok(spentRes.summary.totalOverCommitment > 0);

  // Commitment Accounting bounces r2 cleanly and prevents any over-commitment
  assert.equal(commitRes.results[1].status, 'BOUNCED_BUDGET');
  assert.equal(commitRes.summary.totalOverCommitment, 0);

  // Split-order detector catches r3 + r4 crossing the 5,000 DoA tier
  assert.equal(commitRes.results[3].splitOrderFlag, true);
  assert.ok(commitRes.summary.splitFlagsCount >= 1);
});

test('Blanket Order vs Standard PO: computes exact cost savings, cycle hours saved, and break-even count', () => {
  const res = compareBlanketVsStandard({
    orderCount: 11,
    standardPoCost: 650,
    standardCycleHours: 36,
    blanketSetupCost: 1800,
    callOffCost: 95,
    callOffCycleHours: 3,
  });

  assert.equal(res.totalStandardCost, 7150);
  assert.equal(res.totalBlanketCost, 2845);
  assert.equal(res.costSavings, 4305);
  assert.equal(res.breakEvenOrders, 4); // ceil(1800 / 555) = 4
  assert.equal(res.blanketWins, true);
  assert.equal(res.hoursSaved, 396 - 69);
});

test('The Tender: evaluates weighted best-value sealed tender and converges multi-round reverse auction', () => {
  const bids = [
    { id: 'b1', supplier: 'SolarMed', price: 438000, technicalScore: 91, leadTimeDays: 21, localContentScore: 86, reserveFloor: 392000, sustainableCost: 405000, aggressiveness: 0.55 },
    { id: 'b2', supplier: 'LowCost Global', price: 396000, technicalScore: 68, leadTimeDays: 42, localContentScore: 35, reserveFloor: 352000, sustainableCost: 378000, aggressiveness: 0.90 },
    { id: 'b3', supplier: 'WestAfrica ColdTech', price: 422000, technicalScore: 84, leadTimeDays: 28, localContentScore: 90, reserveFloor: 380000, sustainableCost: 394000, aggressiveness: 0.70 },
  ];

  const sealed = evaluateSealedTender(bids, { price: 45, technical: 30, delivery: 15, localContent: 10 });
  assert.equal(sealed.ranked.length, 3);
  assert.equal(sealed.winner.supplier, 'SolarMed');
  assert.equal(sealed.lowestPriceBid.supplier, 'LowCost Global');
  assert.equal(sealed.bestValueBeatLowestPrice, true);

  // Run reverse auction rounds until convergence
  let current = bids.map((b) => ({ ...b, currentPrice: b.price, active: true })).sort((a, b) => a.currentPrice - b.currentPrice);
  const startLowest = current[0].currentPrice;
  let converged = false;
  let round = 0;
  while (!converged && round < 20) {
    round += 1;
    const step = stepReverseAuctionRound({ currentBids: current, minDecrementPct: 1.5, roundNumber: round });
    current = step.bids;
    converged = step.converged;
  }
  assert.equal(converged, true);
  assert.ok(current[0].currentPrice < startLowest, 'Reverse auction should compress leading price below initial lowest bid');
});
