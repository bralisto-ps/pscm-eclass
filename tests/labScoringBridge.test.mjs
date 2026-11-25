import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LAB_CONCEPT_GUIDES,
  LAB_TRACK_META,
  parseLabVerificationSummary,
  suggestLabRubricMarks,
} from '../src/lib/labScoringBridge.js';

const ALL_11_LAB_IDS = [
  'tqm_spc',
  'tqm_tools',
  'tqm_coq',
  'psis_the_whip',
  'psis_seven_names',
  'psis_scan_it',
  'psis_the_match',
  'psis_req_to_order',
  'psis_the_tender',
  'psis_inventory_wms',
  'psis_spend_analytics',
];

test('LAB_CONCEPT_GUIDES and LAB_TRACK_META cover all 11 software labs', () => {
  for (const id of ALL_11_LAB_IDS) {
    assert.ok(LAB_CONCEPT_GUIDES[id], `Missing concept guide for ${id}`);
    assert.ok(LAB_CONCEPT_GUIDES[id].formulas.length >= 2, `Expected formulas for ${id}`);
    assert.ok(LAB_TRACK_META[id], `Missing track metadata for ${id}`);
  }
});

test('parseLabVerificationSummary extracts metrics and judgement from auto-scored lab header', () => {
  const sampleReport = [
    '====================================================================',
    '[AUTO-SCORED LAB VERIFICATION SUMMARY — FOR LECTURER MARKING]',
    'Module: PSIS-LAB 04 — Procure-to-Pay 3-Way Match & SoD',
    'Quantitative Evidence Extracted: 3-Way Match Accuracy: 90% (9/10) | SoD Remaining: 0',
    'Written Managerial Judgement Check: PASS (Substantive written argument included)',
    '====================================================================',
    '',
    'STUDENT MANAGERIAL JUDGEMENT & INTERNAL CONTROL PLAN',
    'Blocking the duplicate invoice and missing GRN prevented unauthorized disbursement while splitting vendor creation from treasury release closed the ghost vendor vulnerability completely.',
  ].join('\n');

  const parsed = parseLabVerificationSummary(sampleReport, { source: 'interactive_lab', labReport: true });
  assert.ok(parsed);
  assert.equal(parsed.metrics.length, 2);
  assert.equal(parsed.metrics[0].label, '3-Way Match Accuracy');
  assert.equal(parsed.judgementPass, true);
  assert.ok(parsed.judgementWords >= 20);
  assert.ok(parsed.quantRatio >= 0.9);
});

test('suggestLabRubricMarks scores quantitative criteria accurately and flags judgement for human review', () => {
  const parsed = {
    moduleLine: 'PSIS-LAB 07 — Inventory Control',
    metrics: [{ label: 'Cycle Count Accuracy', value: '87.5%' }],
    judgementPass: true,
    judgementWords: 64,
    quantRatio: 0.875,
  };
  const criteria = [
    { id: 'c1', title: 'EOQ & ROP Math', maxMarks: 5 },
    { id: 'c2', title: 'ABC-XYZ Segmentation', maxMarks: 5 },
    { id: 'c3', title: 'Cycle Count Audit', maxMarks: 5 },
    { id: 'c4', title: 'Warehouse Control Judgement', maxMarks: 5 },
  ];

  const sug = suggestLabRubricMarks({ parsed, criteria, maxMarks: 20 });
  assert.ok(sug);
  assert.equal(sug.breakdown.length, 4);
  assert.equal(sug.breakdown[0].mode, 'quantitative');
  assert.equal(sug.breakdown[3].mode, 'human_review');
  assert.ok(sug.suggestedTotal > 14 && sug.suggestedTotal <= 20);
  assert.match(sug.feedbackNote, /provisional — lecturer review/);
});
