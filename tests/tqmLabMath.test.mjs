import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCapability,
  computeCChart,
  computeCheckSheetTotals,
  computeCoqWhatIf,
  computeHistogram,
  computeIcebergModel,
  computeOptimalQualityCurve,
  computePafSummary,
  computePareto,
  computePChart,
  computeProcessFlow,
  computeScatter,
  computeStratification,
  computeXbarR,
  computeXbarS,
  parseSpcCsv,
  scorePafClassification,
} from '../src/lib/tqmLabMath.js';
import { parseCourseMeta, serializeCourseMeta } from '../src/lib/courseMeta.js';

test('SPC Xbar-R computes exact Montgomery limits and detects Rule 1 violation', () => {
  const subgroups = [
    { label: 'S1', values: [10.0, 10.2, 9.8, 10.1, 9.9] },
    { label: 'S2', values: [10.1, 9.9, 10.0, 10.2, 9.8] },
    { label: 'S3', values: [9.9, 10.1, 10.0, 9.8, 10.2] },
    { label: 'S4', values: [11.5, 11.4, 11.6, 11.5, 11.5] }, // clear spike above UCL
    { label: 'S5', values: [10.0, 10.1, 9.9, 10.0, 10.0] },
  ];
  const res = computeXbarR(subgroups);
  assert.equal(res.n, 5);
  assert.equal(res.constants.A2, 0.577);
  assert.equal(res.inControl, false);
  assert.ok(res.primary.signals.some((s) => s.label === 'S4' && s.rule.includes('Rule 1')));
  assert.ok(res.sigmaWithin > 0);
});

test('SPC Xbar-S computes valid limits for n=6', () => {
  const subgroups = [
    { label: 'B1', values: [50.0, 50.1, 49.9, 50.0, 50.2, 49.8] },
    { label: 'B2', values: [50.1, 49.9, 50.0, 50.1, 49.9, 50.0] },
    { label: 'B3', values: [49.9, 50.0, 50.1, 50.0, 49.9, 50.1] },
  ];
  const res = computeXbarS(subgroups);
  assert.equal(res.n, 6);
  assert.equal(res.inControl, true);
  assert.ok(res.primary.ucl > res.primary.cl);
  assert.ok(res.secondary.ucl > res.secondary.cl);
});

test('SPC p-Chart handles variable sample sizes and flags out-of-control day', () => {
  const res = computePChart([
    { label: 'D1', n: 150, defects: 6 },
    { label: 'D2', n: 160, defects: 7 },
    { label: 'D3', n: 140, defects: 5 },
    { label: 'D4', n: 150, defects: 28 },
    { label: 'D5', n: 155, defects: 6 },
  ]);
  assert.equal(res.variableN, true);
  assert.equal(res.inControl, false);
  assert.ok(res.primary.signals.some((s) => s.label === 'D4'));
  assert.ok(res.primary.lcl.every((v) => v >= 0));
});

test('SPC c-Chart computes cBar +/- 3*sqrt(cBar) with LCL >= 0', () => {
  const res = computeCChart([
    { label: 'L1', defects: 4 },
    { label: 'L2', defects: 5 },
    { label: 'L3', defects: 4 },
    { label: 'L4', defects: 18 },
    { label: 'L5', defects: 5 },
  ]);
  assert.equal(res.inControl, false);
  assert.ok(res.primary.lcl >= 0);
  assert.ok(res.primary.signals.some((s) => s.label === 'L4'));
});

test('Process Capability computes Cp, Cpk, and capable verdict accurately', () => {
  const vals = [500.0, 500.2, 499.8, 500.1, 499.9, 500.0, 500.1, 499.9];
  const cap = computeCapability(vals, 0.5, 495, 505, 500);
  assert.ok(Math.abs(cap.cp - 3.333) < 0.01);
  assert.ok(cap.cpk >= 3.0);
  assert.equal(cap.verdict, 'World-Class Capable');
});

test('parseSpcCsv parses variable subgroups, p-chart, and c-chart CSVs', () => {
  const x = parseSpcCsv('Subgroup,X1,X2,X3\nS1,10,11,12\nS2,9,10,11', 'xbar_r');
  assert.equal(x.length, 2);
  assert.deepEqual(x[0].values, [10, 11, 12]);
  const p = parseSpcCsv('Day,n,d\nD1,100,4\nD2,120,6', 'p_chart');
  assert.equal(p.length, 2);
  assert.equal(p[1].defects, 6);
  const c = parseSpcCsv('Lot,c\nL1,5\nL2,7', 'c_chart');
  assert.equal(c.length, 2);
});

test('7 Tools of Quality: CheckSheet, Pareto 80/20, Histogram, Scatter, Stratification, Flowchart', () => {
  const cs = computeCheckSheetTotals(
    [
      { id: '1', name: 'Leak', counts: { AM: 30, PM: 50 } },
      { id: '2', name: 'Scratch', counts: { AM: 10, PM: 10 } },
    ],
    ['AM', 'PM'],
  );
  assert.equal(cs.grandTotal, 100);

  const pareto = computePareto(cs.rows.map((r) => ({ category: r.name, count: r.total })));
  assert.equal(pareto.rows[0].category, 'Leak');
  assert.equal(pareto.rows[0].pct, 80);
  assert.equal(pareto.vitalFewCount, 1);

  const hist = computeHistogram([10, 11, 12, 12, 13, 14, 15, 16], 4, 10, 16);
  assert.equal(hist.n, 8);
  assert.equal(hist.withinSpecPct, 100);

  const sc = computeScatter([
    { label: '1', x: 1, y: 2 },
    { label: '2', x: 2, y: 4 },
    { label: '3', x: 3, y: 6 },
  ]);
  assert.ok(Math.abs(sc.r - 1) < 1e-6);
  assert.ok(Math.abs(sc.slope - 2) < 1e-6);

  const st = computeStratification([
    { stratum: 'Day', value: 4 },
    { stratum: 'Night', value: 12 },
  ]);
  assert.equal(st.highest.name, 'Night');
  assert.equal(st.spreadRatio, 3);

  const fl = computeProcessFlow([
    { name: 'Wait', type: 'delay', minutes: 30, valueAdd: 'nva' },
    { name: 'Seal', type: 'process', minutes: 10, valueAdd: 'va' },
  ]);
  assert.equal(fl.totalMin, 40);
  assert.equal(fl.pcePct, 25);
});

test('Cost of Quality: PAF summary, Iceberg, Classical vs Modern curves, What-If ROI, Classifier', () => {
  const items = [
    { id: 'a', name: 'Training', category: 'prevention', amount: 20000 },
    { id: 'b', name: 'Inspection', category: 'appraisal', amount: 30000 },
    { id: 'c', name: 'Scrap', category: 'internal_failure', amount: 70000 },
    { id: 'd', name: 'Returns', category: 'external_failure', amount: 80000 },
  ];
  const sum = computePafSummary(items, 1_000_000, 100_000);
  assert.equal(sum.totalCoq, 200000);
  assert.equal(sum.coqPctRevenue, 20);
  assert.equal(sum.conformancePct, 25);
  assert.equal(sum.copqPct, 75);

  const ice = computeIcebergModel(sum.copq);
  assert.ok(ice.trueCopq > sum.copq);
  assert.ok(ice.ratio > 3);

  const classical = computeOptimalQualityCurve({ baseFailure: 150000, basePrevention: 20000, model: 'classical' });
  const modern = computeOptimalQualityCurve({ baseFailure: 150000, basePrevention: 20000, model: 'modern' });
  assert.ok(modern.optimal.qualityPct >= classical.optimal.qualityPct);

  const whatIf = computeCoqWhatIf(sum, { deltaPrevention: 20000, deltaAppraisal: 0, internalReductionPct: 50, externalReductionPct: 50, revenue: 1_000_000 });
  assert.equal(whatIf.grossSavings, 75000);
  assert.equal(whatIf.netSavings, 55000);
  assert.equal(whatIf.roiPct, 275);

  const score = scorePafClassification(items, { a: 'prevention', b: 'appraisal', c: 'external_failure', d: 'external_failure' });
  assert.equal(score.correct, 3);
  assert.equal(score.pct, 75);
});

test('courseMeta preserves labs_config alongside ca_config and exam_config', () => {
  const labs = [{ id: 'tqm_spc', labId: 'tqm_spc', title: 'SPC Lab', enabled: true, dataMode: 'both', presetId: 'water_fill_xbar_r', linkedAssignmentId: 'abc-123' }];
  const desc = serializeCourseMeta('TQM Course', { ca1_weight: 20, ca2_weight: 20 }, { released: false, max_score: 60, scores: {} }, { venue: 'Hall A' }, labs);
  const parsed = parseCourseMeta({ description: desc });
  assert.equal(parsed.labs_config.length, 1);
  assert.equal(parsed.labs_config[0].linkedAssignmentId, 'abc-123');
  assert.equal(parsed.course_info.venue, 'Hall A');
});
