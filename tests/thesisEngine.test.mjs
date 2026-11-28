import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeProjectHealth,
  buildAnnotationFeedbackLines,
  buildSupervisionDossierLines,
  buildSupervisionRegisterSheets,
  computeCohortSummary,
  computeThesisRubricTotal,
  detectThesisFileKind,
  getMilestonesForDegree,
  parseBulkSuperviseesText,
  sanitizeSpreadsheetCell,
  validateThesisUploadFile,
} from '../src/lib/thesisEngine.js';

test('Thesis degree templates produce 7 (BSc), 8 (MSc), and 9 (PhD) milestone stages', () => {
  assert.equal(getMilestonesForDegree('BSc').length, 7);
  assert.equal(getMilestonesForDegree('MSc').length, 8);
  assert.equal(getMilestonesForDegree('PhD').length, 9);
});

test('Project health computes weighted progress, review SLA turnaround, and silent supervisee risk', () => {
  const now = Date.UTC(2026, 10, 27);
  const projectA = { id: 'p1', status: 'active', created_at: new Date(now - 30 * 86400000).toISOString() };
  const milesA = [
    { id: 'm1', status: 'approved' },
    { id: 'm2', status: 'submitted' },
    { id: 'm3', status: 'not_started' },
    { id: 'm4', status: 'not_started' },
  ];
  const subsA = [
    {
      id: 's1',
      milestone_id: 'm1',
      review_status: 'approved',
      submitted_at: new Date(now - 20 * 86400000).toISOString(),
      reviewed_at: new Date(now - 17 * 86400000).toISOString(),
      annotations: [{ id: 'a1', page: 2, text: 'Good', studentResolved: true }],
    },
    {
      id: 's2',
      milestone_id: 'm2',
      review_status: 'pending',
      submitted_at: new Date(now - 8 * 86400000).toISOString(),
      reviewed_at: null,
      annotations: [],
    },
  ];
  const hA = analyzeProjectHealth(projectA, milesA, subsA, [], now);
  assert.equal(hA.approvedCount, 1);
  assert.equal(hA.pendingReviewCount, 1);
  assert.equal(hA.oldestPendingDays, 8);
  assert.equal(hA.slaLevel, 'overdue');
  assert.equal(hA.avgTurnaroundDays, 3);
  assert.equal(hA.isSilentRisk, false); // waiting on supervisor, not silent student

  const projectSilent = { id: 'p2', status: 'active', created_at: new Date(now - 25 * 86400000).toISOString() };
  const hSilent = analyzeProjectHealth(projectSilent, [{ id: 'm1', status: 'not_started' }], [], [], now);
  assert.equal(hSilent.isSilentRisk, true);
  assert.ok(hSilent.inactiveDays >= 25);

  const cohort = computeCohortSummary([projectA, projectSilent], { p1: milesA, p2: [] }, { p1: subsA, p2: [] }, {}, now);
  assert.equal(cohort.totalSupervisees, 2);
  assert.equal(cohort.pendingReviews, 1);
  assert.equal(cohort.silentCount, 1);
});

test('File validation enforces allowed formats & 25 MB cap and detects PDF vs DOCX', () => {
  assert.equal(detectThesisFileKind('Chapter_2.PDF', ''), 'pdf');
  assert.equal(detectThesisFileKind('Chapter_2.docx', ''), 'docx');
  assert.equal(validateThesisUploadFile({ name: 'Chapter1.pdf', size: 1024 * 500, type: 'application/pdf' }).ok, true);
  assert.equal(validateThesisUploadFile({ name: 'malware.exe', size: 500 }).ok, false);
  assert.equal(validateThesisUploadFile({ name: 'huge.pdf', size: 30 * 1024 * 1024 }).ok, false);
});

test('Thesis rubric, Excel formula sanitization, Audit Dossier PDF lines, and Bulk parser work cleanly', () => {
  const rub = computeThesisRubricTotal({ problem: 13, literature: 16, methodology: 17, analysis: 20, writing: 8, viva: 8 });
  assert.equal(rub.earned, 82);
  assert.equal(rub.gradeBand, 'Distinction / First Class');

  assert.equal(sanitizeSpreadsheetCell('=CMD|calc'), "'=CMD|calc");
  assert.equal(sanitizeSpreadsheetCell('Normal Title'), 'Normal Title');

  const sheets = buildSupervisionRegisterSheets(
    [{ id: 'p1', student_index_no: 'PSCM/22/01', student_name: 'Ama', degree_level: 'BSc', title: '=EvilFormula', ethics_status: 'approved', status: 'active', rubric_scores: {} }],
    { p1: [{ id: 'm1', title: 'Proposal', status: 'approved', latest_version_no: 1 }] },
    {},
    {},
  );
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].rows[1][5], "'=EvilFormula");

  const dossier = buildSupervisionDossierLines({
    project: { student_name: 'Ama', student_index_no: 'PSCM/22/01', degree_level: 'MSc', title: 'Green Logistics' },
    milestones: [{ id: 'm1', title: 'Proposal', status: 'approved', latest_version_no: 2 }],
    submissions: [],
    meetings: [{ meeting_date: '2026-11-10T10:00:00Z', mode: 'online', summary: 'Reviewed sampling', action_items: [{ text: 'Add Yamane formula' }] }],
  });
  assert.ok(dossier.some((l) => l.includes('OFFICIAL THESIS SUPERVISION AUDIT DOSSIER')));
  assert.ok(dossier.some((l) => l.includes('Add Yamane formula')));

  const annLines = buildAnnotationFeedbackLines({
    title: 'Ch 2',
    studentLabel: 'Ama',
    fileName: 'ch2.pdf',
    annotations: [{ page: 4, tag: 'correction', text: 'Add 2024 source', studentReply: 'Added in v2', studentResolved: true }],
  });
  assert.ok(annLines.some((l) => l.includes('[ADDRESSED]')));
  assert.ok(annLines.some((l) => l.includes('Student Reply: Added in v2')));

  const parsed = parseBulkSuperviseesText('Index No, Name, Title\nPSCM/22/01, Ama Mensah, Green SCM\nPSCM/22/02\tKwame\tHospital Logistics', 'MSc', '2026/2027');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].index_no, 'PSCM/22/01');
  assert.equal(parsed[1].title, 'Hospital Logistics');
});
