import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeEan13FromLuminance,
  encodeEan13Modules,
} from '../src/lib/barcodeCanvasDecoder.js';

import {
  assignStudentsToChains,
  assignStudentsToP2pGroups,
  auditCycleCount,
  classifyAbcXyzMatrix,
  computeEoqRopPolicy,
  computeSpendCubeAnalytics,
  computeSupplierScorecards,
  formatAutoScoredSubmissionHeader,
  generateSessionCode,
} from '../src/lib/psisMilestone4Engine.js';

function synthesizeScanline(modules, pxPerModule = 4, reverse = false) {
  const quiet = 10 * pxPerModule;
  const seq = reverse ? [...modules].reverse() : modules;
  const arr = [];
  for (let i = 0; i < quiet; i++) arr.push(240);
  for (const bit of seq) {
    for (let k = 0; k < pxPerModule; k++) {
      arr.push(bit === 1 ? 22 : 236);
    }
  }
  for (let i = 0; i < quiet; i++) arr.push(240);
  return new Uint8Array(arr);
}

test('Canvas EAN-13 decoder accurately decodes GS1 Ghana (603) and Nigeria (615) barcodes forward and upside-down', () => {
  const ghanaCode = '6031204001016';
  const nigeriaCode = '6151100045218';

  const ghModules = encodeEan13Modules(ghanaCode);
  assert.equal(ghModules.length, 95);
  assert.equal(decodeEan13FromLuminance(synthesizeScanline(ghModules, 4, false)), ghanaCode);
  assert.equal(decodeEan13FromLuminance(synthesizeScanline(ghModules, 4, true)), ghanaCode);

  const ngModules = encodeEan13Modules(nigeriaCode);
  assert.equal(decodeEan13FromLuminance(synthesizeScanline(ngModules, 5, false)), nigeriaCode);
  assert.equal(decodeEan13FromLuminance(synthesizeScanline(ngModules, 5, true)), nigeriaCode);
});

test('EOQ, Safety Stock & Reorder Point policy calculates accurately and scales with service level', () => {
  const p95 = computeEoqRopPolicy({
    annualDemand: 18000,
    unitCost: 36,
    orderingCost: 480,
    holdingRatePct: 22,
    leadTimeDays: 12,
    dailyDemandStd: 14,
    serviceLevelPct: 95,
    operatingDaysPerYear: 300,
  });
  const p999 = computeEoqRopPolicy({
    annualDemand: 18000,
    unitCost: 36,
    orderingCost: 480,
    holdingRatePct: 22,
    leadTimeDays: 12,
    dailyDemandStd: 14,
    serviceLevelPct: 99.9,
    operatingDaysPerYear: 300,
  });

  // EOQ = sqrt(2 * 18000 * 480 / (36 * 0.22)) = sqrt(17280000 / 7.92) ≈ 1477
  assert.ok(Math.abs(p95.eoq - 1477) <= 2);
  assert.equal(p95.avgDailyDemand, 60);
  assert.ok(p95.safetyStock > 0);
  assert.ok(p999.safetyStock > p95.safetyStock * 1.7);
  assert.equal(p95.reorderPoint, Math.round(60 * 12 + p95.safetyStock));
});

test('ABC-XYZ 9-quadrant classification segments SKUs by spend share and CV', () => {
  const res = classifyAbcXyzMatrix([
    { code: 'A1', name: 'High Steady', annualQty: 1000, unitCost: 800, demandCv: 0.12 },
    { code: 'B1', name: 'Med Seasonal', annualQty: 200, unitCost: 500, demandCv: 0.35 },
    { code: 'C1', name: 'Low Erratic', annualQty: 50, unitCost: 400, demandCv: 0.78 },
  ]);

  assert.equal(res.totalSkus, 3);
  assert.equal(res.items[0].segment, 'AX');
  assert.equal(res.items[1].segment, 'BY');
  assert.equal(res.items[2].segment, 'CZ');
  assert.equal(res.matrixCounts.AX, 1);
  assert.equal(res.matrixCounts.CZ, 1);
});

test('Cycle Count audit computes bin accuracy, value accuracy, and net shrinkage', () => {
  const audit = auditCycleCount(
    [
      { bin: 'A-1', systemQty: 100, physicalQty: 100, unitCost: 50 },
      { bin: 'A-2', systemQty: 100, physicalQty: 90, unitCost: 100 },
    ],
    2,
  );

  assert.equal(audit.totalBins, 2);
  assert.equal(audit.accurateBins, 1);
  assert.equal(audit.discrepancyBins, 1);
  assert.equal(audit.binAccuracyPct, 50);
  assert.equal(audit.netShrinkageValue, -1000);
});

test('Supplier Scorecard and Spend Cube Analytics compute rankings, Maverick %, and Tail Spend', () => {
  const suppliers = [
    { id: '1', supplier: 'TopVendor', category: 'Medical', annualSpend: 500000, otifPct: 97, defectPpm: 500, priceVariancePct: 0, responsivenessScore: 95, onContract: true },
    { id: '2', supplier: 'MidVendor', category: 'Packaging', annualSpend: 350000, otifPct: 86, defectPpm: 2500, priceVariancePct: 2, responsivenessScore: 82, onContract: true },
    { id: '3', supplier: 'MaverickVendor', category: 'Maintenance', annualSpend: 150000, otifPct: 58, defectPpm: 15000, priceVariancePct: 12, responsivenessScore: 50, onContract: false },
  ];

  const sc = computeSupplierScorecards(suppliers, { otif: 40, quality: 30, price: 20, responsiveness: 10 });
  assert.equal(sc.rows[0].supplier, 'TopVendor');
  assert.equal(sc.rows[0].tier, 'PREFERRED');
  assert.equal(sc.rows[2].tier, 'AT_RISK');

  const cube = computeSpendCubeAnalytics(suppliers);
  assert.equal(cube.totalSpend, 1000000);
  assert.equal(cube.maverickSpend, 150000);
  assert.equal(cube.maverickPct, 15);
  assert.equal(cube.tailSupplierCount, 1);
});

test('Auto-Scored Submission Header extracts key quantitative evidence and judgement flag', () => {
  const wrapped = formatAutoScoredSubmissionHeader({
    labCode: 'PSIS-LAB 07',
    labTitle: 'Inventory Control & WMS',
    body: 'Book-to-Physical Bin Accuracy: 87.5% (7/8 bins within tolerance)\nOther report lines...',
    hasJudgement: true,
  });

  assert.match(wrapped, /\[AUTO-SCORED LAB VERIFICATION SUMMARY/);
  assert.match(wrapped, /Cycle Count Accuracy: 87\.5%/);
  assert.match(wrapped, /Written Managerial Judgement Check: PASS/);
});

test('Live Classroom session helpers generate 6-char codes and deal Bullwhip chains & P2P Super-User demo', () => {
  const code = generateSessionCode(6);
  assert.equal(code.length, 6);
  assert.match(code, /^[A-Z2-9]{6}$/);

  const roster = [
    { id: 's1', name: 'Ama' },
    { id: 's2', name: 'Kojo' },
    { id: 's3', name: 'Esi' },
    { id: 's4', name: 'Yaw' },
    { id: 's5', name: 'Abena' },
  ];

  const chains = assignStudentsToChains(roster);
  assert.equal(chains.s1.chainNo, 1);
  assert.equal(chains.s1.tier, 'retailer');
  assert.equal(chains.s4.tier, 'factory');
  assert.equal(chains.s5.chainNo, 2);
  assert.equal(chains.s5.tier, 'retailer');

  const p2pStrict = assignStudentsToP2pGroups(roster, false);
  assert.deepEqual(p2pStrict.s1.roles, ['buyer']);
  assert.equal(p2pStrict.s1.isSuperUserDemo, false);

  const p2pFraud = assignStudentsToP2pGroups(roster, true);
  assert.equal(p2pFraud.s1.roles.length, 4);
  assert.equal(p2pFraud.s1.isSuperUserDemo, true);
  assert.equal(p2pFraud.s5.groupNo, 2);
  assert.equal(p2pFraud.s5.isSuperUserDemo, false);
});
