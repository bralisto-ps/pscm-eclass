import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeBatchLabAutoScores,
  detectJudgementSimilarityPairs,
  savePendingLabSubmission,
  getPendingLabSubmission,
  clearPendingLabSubmission,
  buildLecturerFacilitationGuide,
  buildStudentLabPortfolioText,
  computeLandedCostRoute,
  compareLandedCostRoutes,
  evaluateContractSla,
  evaluateGreenProcurement,
} from '../src/lib/labMilestone8Engine.js';
import { LAB_DATASET_SCHEMAS } from '../src/lib/labMilestone7Engine.js';

test('Milestone 7 Universal Dataset Mapper now covers all 18 labs', () => {
  assert.equal(Object.keys(LAB_DATASET_SCHEMAS).length, 18);
});

test('Batch Auto-Score & Written Judgement Similarity Detector work accurately', () => {
  const sharedEssay = 'Our procurement team must implement strict item master data governance and fuzzy SKU search controls before receiving clerks can create new item codes because duplicate SKUs fragment stock and trigger emergency reorders across the hospital warehouse.';
  const makeSub = (id, essay) => ({
    id,
    marked: false,
    typing_meta: { source: 'interactive_lab', labReport: true },
    response_text: [
      'LABORATORY: PSIS-LAB 02 — Item Master Data Governance & SKU Deduplication',
      'Auto-Verification Score: 100% (4/4 checks) | Judgement: PASS (45 words)',
      '- Hygiene Score: 85%',
      '',
      'WRITTEN MANAGERIAL JUDGEMENT',
      essay,
    ].join('\n'),
  });

  const rows = [
    { student_id: 's1', index_no: 'PSCM/001', full_name: 'Ama Mensah', sub: makeSub('sub1', sharedEssay) },
    { student_id: 's2', index_no: 'PSCM/002', full_name: 'Kofi Boateng', sub: makeSub('sub2', sharedEssay) },
    { student_id: 's3', index_no: 'PSCM/003', full_name: 'Esi Owusu', sub: makeSub('sub3', 'Independent analysis showing different inventory holding costs, reorder thresholds, safety stock calculations, and ABC-XYZ policy differentiation across clinical consumables.') },
  ];

  const batch = computeBatchLabAutoScores(rows, { rubric: [{ id: 'c1', title: 'Audit', maxMarks: 50 }, { id: 'c2', title: 'Judgement', maxMarks: 50 }] }, 100);
  assert.equal(batch.length, 3);
  assert.ok(batch[0].suggestedTotal > 0);

  const pairs = detectJudgementSimilarityPairs(rows, 0.55);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].similarityPct, 100);
});

test('Offline Submission Resilience Queue saves, reads, and clears cleanly', () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  };
  assert.equal(savePendingLabSubmission(storage, 'a1', 'u1', { reportTitle: 'Test Report', reportBody: 'Body' }), true);
  const loaded = getPendingLabSubmission(storage, 'a1', 'u1');
  assert.equal(loaded.reportTitle, 'Test Report');
  assert.ok(loaded.queuedAt);
  clearPendingLabSubmission(storage, 'a1', 'u1');
  assert.equal(getPendingLabSubmission(storage, 'a1', 'u1'), null);
});

test('Facilitation Guide & Student Portfolio builders produce clean structured reports', () => {
  const guide = buildLecturerFacilitationGuide({
    id: 'scm_landed_cost',
    code: 'SCM-LAB 01',
    title: 'Global Logistics, Incoterms & Landed Cost Analysis',
    shortTitle: 'Incoterms & Landed Cost',
    domain: 'SCM',
    summary: 'Incoterms waterfall analysis.',
    rubricCriteria: [{ title: 'Landed Cost Math', maxMarks: 100 }],
  });
  assert.ok(guide.body.includes('SCM-LAB 01'));
  assert.ok(guide.body.includes('COMMON STUDENT TRAPS'));

  const assignMap = new Map([['a1', { max_marks: 20, released: true, submission: { marks: 18, marked: true } }]]);
  const portfolio = buildStudentLabPortfolioText({
    course: { code: 'PSCM 401', title: 'Global Supply Chain' },
    profile: { full_name: 'Kwame Boateng', index_no: 'PSCM/010' },
    openLabs: [{ labId: 'scm_landed_cost', linkedAssignmentId: 'a1', mappedClos: ['CLO1'] }],
    assignById: assignMap,
    getLabDefFn: () => ({ code: 'SCM-LAB 01', title: 'Global Logistics', domain: 'SCM' }),
  });
  assert.equal(portfolio.submittedCount, 1);
  assert.ok(portfolio.body.includes('18/20'));
  assert.ok(portfolio.body.includes('CLO1'));
});

test('SCM-LAB 01 Landed Cost engine computes CIF customs valuation and detects FOB Price Trap', () => {
  const res = compareLandedCostRoutes([
    { id: 'offshore', name: 'Offshore FOB', mode: 'Ocean', incoterm: 'FOB', qty: 100, unitExw: 30, originInland: 200, exportClearance: 100, mainFreight: 1500, insuranceRatePct: 1, dutyRatePct: 20, vatRatePct: 15, destPort: 800, destInland: 400, transitDays: 40 },
    { id: 'regional', name: 'Regional DAP', mode: 'Road', incoterm: 'DAP', qty: 100, unitExw: 42, originInland: 100, exportClearance: 100, mainFreight: 500, insuranceRatePct: 0.5, dutyRatePct: 0, vatRatePct: 15, destPort: 100, destInland: 100, transitDays: 5 },
  ]);
  const single = computeLandedCostRoute({ qty: 100, unitExw: 30, mainFreight: 1000, insuranceRatePct: 1, dutyRatePct: 10, vatRatePct: 15, incoterm: 'CIF' });
  assert.ok(single.cifValue > single.fobValue);
  assert.ok(single.importVat > 0);
  assert.equal(res.fobTrapDetected, true);
  assert.equal(res.lowestFob.id, 'offshore');
  assert.equal(res.lowestLanded.id, 'regional');
});

test('SCM-LAB 02 Contract SLA engine enforces LD Cap, Force Majeure excusal, and Material Breach trigger', () => {
  const res = evaluateContractSla(
    { contractValue: 200000, targetOtifPct: 95, maxDefectPct: 2, maxResponseHrs: 24, ldRatePerOtifPct: 1.0, ldCapPct: 5, switchingCost: 20000, terminationStreakTarget: 3 },
    [
      { period: 'M1', invoiceValue: 50000, otifPct: 80, defectPct: 3, responseHrs: 30, forceMajeure: false },
      { period: 'M2', invoiceValue: 50000, otifPct: 82, defectPct: 2.5, responseHrs: 28, forceMajeure: false },
      { period: 'M3', invoiceValue: 50000, otifPct: 84, defectPct: 1.5, responseHrs: 20, forceMajeure: false },
      { period: 'M4', invoiceValue: 50000, otifPct: 75, defectPct: 3.0, responseHrs: 40, forceMajeure: true },
    ],
  );
  assert.equal(res.capAmount, 10000);
  assert.equal(res.capHit, true);
  assert.equal(res.cappedLd, 10000);
  assert.equal(res.forceMajeureProtected, 1);
  assert.equal(res.maxBreachStreak, 3);
  assert.equal(res.materialBreachTriggered, true);
});

test('SCM-LAB 03 Sustainable Procurement engine calculates Scope 3 freight emissions and shadow carbon tipping point', () => {
  const res = evaluateGreenProcurement(
    [
      { id: 'air', name: 'Air Supplier', mode: 'Air', distanceKm: 10000, unitPricePerTonne: 850, mfgKgCo2PerTonne: 600, recyclablePct: 40, ethicsScore: 65 },
      { id: 'regional', name: 'Eco Regional', mode: 'Road', distanceKm: 300, unitPricePerTonne: 980, mfgKgCo2PerTonne: 250, recyclablePct: 95, ethicsScore: 92 },
    ],
    { shadowCarbonPrice: 120, annualTonnes: 100, carbonBudgetTonnes: 80 },
  );
  assert.equal(res.cheapestDirect.id, 'air');
  assert.equal(res.bestCarbonAdjusted.id, 'regional');
  assert.equal(res.carbonPriceFlipsWinner, true);
  assert.equal(res.suppliers.find((s) => s.id === 'regional').withinBudget, true);
  assert.equal(res.suppliers.find((s) => s.id === 'air').withinBudget, false);
});
