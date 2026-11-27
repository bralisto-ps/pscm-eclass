import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTypedResponsePdfBlob } from '../src/lib/textPdf.js';
import { LAB_DATASET_SCHEMAS } from '../src/lib/labMilestone7Engine.js';
const ALL_LAB_IDS = Object.keys(LAB_DATASET_SCHEMAS);
const mockGetLabDef = (id) => ({ id, code: id.toUpperCase(), title: LAB_DATASET_SCHEMAS[id]?.label || id, domain: id.startsWith('tqm_') ? 'TQM' : id.startsWith('scm_') ? 'SCM' : 'PSIS' });
import { parseCourseMeta, serializeCourseMeta } from '../src/lib/courseMeta.js';
import { LAB_CLOUD_SYNC_SQL } from '../src/lib/allFeaturesSql.js';
import {
  buildAccreditationEvidenceText,
  buildAccreditationWorkbookSheets,
  buildCourseCloMasteryMatrix,
  buildLabExcelWorkbookSheets,
  evaluateScenarioShockRun,
  generateIndustryScaleDataset,
  getLabGuidedHints,
  getLabProfessionalRubric,
  getLabScenarioShocks,
  isSafeCloudDraftPayload,
  listLocalLiveHostBackups,
  loadLocalLiveHostBackup,
  removeLocalLiveHostBackup,
  sanitizeExcelCell,
  saveLocalLiveHostBackup,
  shouldAdoptCloudDraft,
} from '../src/lib/labMilestone9Engine.js';

function createMemStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('textPdf builds valid binary PDF with embedded JPEG chart pages (/DCTDecode)', async () => {
  const fakeJpeg = new Uint8Array(64);
  fakeJpeg[0] = 0xff;
  fakeJpeg[1] = 0xd8;
  fakeJpeg[62] = 0xff;
  fakeJpeg[63] = 0xd9;

  const blob = buildTypedResponsePdfBlob({
    title: 'SPC Executive Report',
    studentLine: 'Ama Mensah (PSCM/26/001)',
    submittedAt: '2026-11-26',
    body: 'Cpk = 1.42\nAll subgroups in statistical control.',
    images: [{ caption: 'Xbar-R Control Chart', jpegBytes: fakeJpeg, width: 640, height: 320 }],
  });
  assert.equal(blob.type, 'application/pdf');
  const buf = new Uint8Array(await blob.arrayBuffer());
  const ascii = new TextDecoder('latin1').decode(buf);
  assert.ok(ascii.startsWith('%PDF-1.4'));
  assert.ok(ascii.includes('/Count 2'), 'Should contain 1 text page + 1 chart appendix page');
  assert.ok(ascii.includes('/Filter /DCTDecode'));
  assert.ok(ascii.includes('Xbar-R Control Chart'));
  assert.ok(ascii.endsWith('%%EOF'));
});

test('Cloud draft sync adopts newer cloud drafts and rejects oversized payloads', () => {
  assert.equal(
    shouldAdoptCloudDraft(null, null, { draft: { step: 2 }, updated_at: '2026-11-26T10:00:00Z' }),
    true,
  );
  assert.equal(
    shouldAdoptCloudDraft({ step: 1 }, '2026-11-26T10:00:00Z', { draft: { step: 2 }, updated_at: '2026-11-26T10:05:00Z' }),
    true,
  );
  assert.equal(
    shouldAdoptCloudDraft({ step: 3 }, '2026-11-26T10:10:00Z', { draft: { step: 2 }, updated_at: '2026-11-26T10:05:00Z' }),
    false,
  );
  assert.equal(isSafeCloudDraftPayload({ ok: true }), true);
  assert.equal(isSafeCloudDraftPayload({ huge: 'x'.repeat(260000) }), false);
});

test('Crash-proof live session local host backups save, list, load, and remove cleanly', () => {
  const storage = createMemStorage();
  saveLocalLiveHostBackup(storage, {
    code: 'abc123',
    labId: 'psis_the_tender',
    state: { round: 2, currentLowestBid: 95000 },
    assignments: { stu_1: { bidderCode: 'B1' } },
    participants: [{ id: 'stu_1', name: 'Kwame' }],
  });
  const list = listLocalLiveHostBackups(storage);
  assert.equal(list.length, 1);
  assert.equal(list[0].code, 'ABC123');
  const loaded = loadLocalLiveHostBackup(storage, 'ABC123');
  assert.equal(loaded.state.round, 2);
  removeLocalLiveHostBackup(storage, 'ABC123');
  assert.equal(listLocalLiveHostBackups(storage).length, 0);
});

test('Excel workbook builder sanitizes formula injection and exports 3 structured sheets', () => {
  assert.equal(sanitizeExcelCell('=CMD()'), "'=CMD()");
  assert.equal(sanitizeExcelCell('+SUM(A1:A2)'), "'+SUM(A1:A2)");
  assert.equal(sanitizeExcelCell(42.5), 42.5);

  const sheets = buildLabExcelWorkbookSheets({
    labDef: mockGetLabDef('scm_landed_cost'),
    reportTitle: 'Landed Cost Report',
    reportBody: 'Total Landed Cost: 54200\nManagerial Judgement\nRecommend regional DDP route to avoid demurrage.',
    dataset: { routes: [{ name: 'Tema Ocean', unitExw: 18.5, dutyRatePct: 20 }] },
  });
  assert.equal(sheets.length, 3);
  assert.equal(sheets[0].name, 'Summary & KPIs');
  assert.equal(sheets[1].name, 'Active Dataset');
  assert.equal(sheets[2].name, 'Written Judgement');
});

test('Multi-Quarter Scenario Shock simulator covers all 18 labs and scores decisions accurately', () => {
  assert.equal(ALL_LAB_IDS.length, 18);
  for (const labId of ALL_LAB_IDS) { const lab = { id: labId };
    const qs = getLabScenarioShocks(lab.id);
    assert.equal(qs.length, 3, `${lab.id} should have 3 scenario shock quarters`);
    const bestChoices = {};
    const worstChoices = {};
    for (const q of qs) {
      bestChoices[q.quarter] = q.options[0].id;
      worstChoices[q.quarter] = q.options[q.options.length - 1].id;
    }
    const bestRes = evaluateScenarioShockRun(lab.id, bestChoices);
    const worstRes = evaluateScenarioShockRun(lab.id, worstChoices);
    assert.equal(bestRes.isComplete, true);
    assert.ok(bestRes.resilienceScore >= 85, `${lab.id} optimal resilience should be >= 85`);
    assert.ok(worstRes.resilienceScore < bestRes.resilienceScore, `${lab.id} poor decisions should score lower`);
    assert.ok(bestRes.reportSection.includes('MULTI-QUARTER SCENARIO SHOCK SIMULATION'));
  }
});

test('Industry-scale messy dataset generators produce valid datasets for all 18 labs', () => {
  for (const labId of ALL_LAB_IDS) { const lab = { id: labId };
    const res = generateIndustryScaleDataset(lab.id);
    assert.ok(res && res.dataset && res.rowCount > 0, `Industry dataset missing for ${lab.id}`);
  }
  assert.ok(generateIndustryScaleDataset('psis_seven_names').rowCount >= 100);
  assert.ok(generateIndustryScaleDataset('psis_inventory_wms').rowCount >= 100);
  assert.ok(generateIndustryScaleDataset('psis_spend_analytics').rowCount >= 120);
});

test('Guided hints & 4-criterion professional rubrics work across all 18 labs', () => {
  for (const labId of ALL_LAB_IDS) { const lab = { id: labId };
    const guide = getLabGuidedHints(lab.id, null, false);
    assert.equal(guide.steps.length, 3);
    assert.ok(guide.hints.length >= 2);

    const rubric = getLabProfessionalRubric(lab.id, 25);
    assert.equal(rubric.length, 4);
    const sum = rubric.reduce((s, c) => s + c.maxMarks, 0);
    assert.equal(Math.round(sum * 10) / 10, 25, `${lab.id} rubric sum must match maxMarks`);
  }
});

test('Course CLO Mastery & Accreditation Matrix aggregates cohort performance cleanly', () => {
  const matrix = buildCourseCloMasteryMatrix({
    course: { code: 'PSCM-302', title: 'Procurement Information Systems' },
    courseLabs: [
      { labId: 'psis_the_match', linkedAssignmentId: 'a1', mappedClos: ['CLO-1', 'CLO-3'] },
      { labId: 'scm_landed_cost', linkedAssignmentId: 'a2', mappedClos: ['CLO-3'] },
    ],
    assignments: [
      { id: 'a1', max_marks: 20 },
      { id: 'a2', max_marks: 20 },
    ],
    submissions: [
      { assignment_id: 'a1', marks: 18, marked: true },
      { assignment_id: 'a1', marks: 15, marked: true },
      { assignment_id: 'a2', marks: 12, marked: true },
      { assignment_id: 'a2', marks: 8, marked: true },
    ],
    enrolledCount: 2,
    getLabDefFn: mockGetLabDef,
  });
  assert.equal(matrix.totalLabs, 2);
  assert.equal(matrix.gradedLabs, 2);
  const clo1 = matrix.cloSummary.find((c) => c.key === 'CLO-1');
  const clo3 = matrix.cloSummary.find((c) => c.key === 'CLO-3');
  assert.equal(clo1.avgPct, 82.5);
  assert.equal(clo1.masteryPct, 100);
  assert.equal(clo3.markedSubs, 4);
  const pdfDoc = buildAccreditationEvidenceText(matrix);
  assert.ok(pdfDoc.body.includes('CLO-1'));
  const wbSheets = buildAccreditationWorkbookSheets(matrix);
  assert.equal(wbSheets.length, 3);
});

test('courseMeta preserves guidedMode and shockSimRequired flags cleanly', () => {
  const serialized = serializeCourseMeta('About', null, null, {}, [
    { labId: 'scm_landed_cost', enabled: true, guidedMode: true, shockSimRequired: true },
  ]);
  const parsed = parseCourseMeta({ description: serialized });
  assert.equal(parsed.labs_config[0].guidedMode, true);
  assert.equal(parsed.labs_config[0].shockSimRequired, true);
});

test('LAB_CLOUD_SYNC_SQL enforces RLS, auth.uid() ownership, and lecturer guards', () => {
  assert.ok(LAB_CLOUD_SYNC_SQL.includes('enable row level security'));
  assert.ok(LAB_CLOUD_SYNC_SQL.includes('user_id = auth.uid()'));
  assert.ok(LAB_CLOUD_SYNC_SQL.includes('perform public.require_lecturer()'));
  assert.ok(LAB_CLOUD_SYNC_SQL.includes('revoke execute on function'));
});
