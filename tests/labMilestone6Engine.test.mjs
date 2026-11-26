import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLiveSessionDebriefReport,
  generateUniqueLabVariant,
  summarizeClassLabSubmissions,
} from '../src/lib/labMilestone6Engine.js';

test('generateUniqueLabVariant is deterministic per seed and distinct across students/syndicates', () => {
  const baseWms = {
    id: 'wms_test',
    eoqDefaults: { annualDemand: 18000, unitCost: 36, orderingCost: 480, holdingRatePct: 22, leadTimeDays: 12, dailyDemandStd: 14, serviceLevelPct: 95 },
    abcItems: [{ code: 'SKU-1', name: 'Carton', annualQty: 10000, unitCost: 30, demandCv: 0.15 }],
    cycleCountBins: [{ bin: 'A-1', code: 'SKU-1', item: 'Carton', systemQty: 200, physicalQty: 180, unitCost: 30 }],
  };

  const s1a = generateUniqueLabVariant({ labId: 'psis_inventory_wms', basePreset: baseWms, seedKey: 'PSCM/001' });
  const s1b = generateUniqueLabVariant({ labId: 'psis_inventory_wms', basePreset: baseWms, seedKey: 'PSCM/001' });
  const s2 = generateUniqueLabVariant({ labId: 'psis_inventory_wms', basePreset: baseWms, seedKey: 'PSCM/002' });

  assert.equal(s1a.variantTag, s1b.variantTag);
  assert.deepEqual(s1a.customDataset, s1b.customDataset);
  assert.notEqual(s1a.variantTag, s2.variantTag);
  assert.notEqual(s1a.customDataset.eoqDefaults.annualDemand, s2.customDataset.eoqDefaults.annualDemand);

  // Check P2P 3-way match preserves shortage exception ratio while shifting base price & qty
  const baseMatch = {
    packets: [{ poQty: 100, grnQty: 80, invQty: 100, poUnitPrice: 50, invUnitPrice: 50, budgetRemaining: 10000 }],
  };
  const m1 = generateUniqueLabVariant({ labId: 'psis_the_match', basePreset: baseMatch, seedKey: 'SYN-1' });
  const p = m1.customDataset.packets[0];
  assert.ok(p.grnQty < p.poQty, 'Short delivery variance must remain a shortage');
  assert.equal(p.invQty, p.poQty);
});

test('summarizeClassLabSubmissions deduplicates syndicate members and flags common pitfalls', () => {
  const sampleBodyA = [
    '[AUTO-SCORED LAB VERIFICATION SUMMARY — FOR LECTURER MARKING]',
    'Module: PSIS-LAB 04 — The Match',
    'Quantitative Evidence Extracted: 3-Way Match Accuracy: 60% (6/10) | SoD Remaining: 2',
    'Written Managerial Judgement Check: NEEDS REVIEW (Short or missing written argument)',
    'STUDENT MANAGERIAL JUDGEMENT',
    'Short note.',
  ].join('\n');

  const sampleBodyB = [
    '[AUTO-SCORED LAB VERIFICATION SUMMARY — FOR LECTURER MARKING]',
    'Module: PSIS-LAB 04 — The Match',
    'Quantitative Evidence Extracted: 3-Way Match Accuracy: 90% (9/10) | SoD Remaining: 0',
    'Written Managerial Judgement Check: PASS (Substantive written argument included)',
    'STUDENT MANAGERIAL JUDGEMENT',
    'Separating vendor master creation from payment release prevents a super-user from paying a fictitious vendor even when three-way match controls appear completely satisfied.',
  ].join('\n');

  const rows = [
    { student_id: 'u1', index_no: '001', _syn: { id: 'g1' }, sub: { response_text: sampleBodyA, typing_meta: { source: 'interactive_lab' } } },
    { student_id: 'u2', index_no: '002', _syn: { id: 'g1' }, sub: { response_text: sampleBodyA, typing_meta: { source: 'interactive_lab' } } },
    { student_id: 'u3', index_no: '003', _syn: { id: 'g2' }, sub: { response_text: sampleBodyB, typing_meta: { source: 'interactive_lab' } } },
  ];

  const summary = summarizeClassLabSubmissions(rows, { syndicate: { enabled: true } });
  assert.equal(summary.labSubmissionCount, 2, 'Two syndicate groups should count as 2 unique submissions, not 3');
  assert.equal(summary.judgementPassPct, 50);
  assert.ok(summary.pitfalls.some((p) => /Segregation of Duties/i.test(p)));
  assert.ok(summary.pitfalls.some((p) => /below 75%/i.test(p)));
});

test('buildLiveSessionDebriefReport generates structured post-class summary', () => {
  const txt = buildLiveSessionDebriefReport({
    labId: 'psis_the_whip',
    labTitle: 'The Whip — Live 4-Tier Bullwhip Chains',
    sessionCode: 'K7M9QX',
    courseCode: 'PSCM 301',
    participants: [{ id: '1', name: 'Ama' }, { id: '2', name: 'Kojo' }],
    labState: {
      sharedPos: true,
      rumourActive: true,
      history: [
        { week: 1, demand: 40, avgByTier: { retailer: 42, wholesaler: 48, distributor: 55, factory: 68 } },
      ],
    },
    eventLog: [{ ts: '10:15:00', actor: 'Lecturer', eventType: 'ADVANCE_WEEK', detail: 'Closed Week 1' }],
  });

  assert.match(txt, /LIVE CLASSROOM SIMULATION DEBRIEF SUMMARY/);
  assert.match(txt, /K7M9QX/);
  assert.match(txt, /Factory=68/);
});
