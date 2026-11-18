import test from 'node:test';
import assert from 'node:assert/strict';

import { compareSubmissionTexts, compareArchiveTexts } from '../src/lib/similarity.js';
import { parseQuestionsFromText, SAMPLE_PASTE_TEXT } from '../src/lib/questionParser.js';
import {
  assignmentMatchesStudent,
  parseAssignmentMeta,
  resolveEffectiveDue,
  serializeAssignmentMeta,
  validateSubmissionFile,
} from '../src/lib/assignmentMeta.js';
import {
  getQuestionTimeLimit,
  parseQuizMeta,
  serializeQuizMeta,
} from '../src/lib/quizMeta.js';
import { computeStudentCA, isItemLocked } from '../src/lib/courseMeta.js';
import { rowsToStudents } from '../src/lib/sheets.js';

test('similarity: detects collusion while skipping same-syndicate teammates and boilerplate', () => {
  const sharedBody =
    'Economic order quantity balances annual ordering cost against annual holding cost across uncertain supplier lead times and demand cycles in modern procurement networks.';
  const boilerplate =
    'Analyze the procurement scenario below and explain how supplier lead times affect safety stock.';

  const report = compareSubmissionTexts(
    [
      { id: 's1', indexNo: 'PSCM/24/001', fullName: 'Ama', text: `${boilerplate} ${sharedBody}` },
      { id: 's2', indexNo: 'PSCM/24/002', fullName: 'Kojo', text: `${boilerplate} ${sharedBody}` },
      { id: 's3', indexNo: 'PSCM/24/003', fullName: 'Esi', syndicateId: 'syn-1', text: sharedBody },
      { id: 's4', indexNo: 'PSCM/24/004', fullName: 'Yaw', syndicateId: 'syn-1', text: sharedBody },
    ],
    { boilerplateText: boilerplate, thresholdPct: 50 }
  );

  assert.equal(report.pairs.some((p) => p.a.indexNo === 'PSCM/24/001' && p.b.indexNo === 'PSCM/24/002'), true);
  assert.equal(report.pairs.some((p) => p.a.indexNo === 'PSCM/24/003' && p.b.indexNo === 'PSCM/24/004'), false);
});

test('similarity archive: matches current script against prior semester archive', () => {
  const essay =
    'Strategic supplier relationship management requires joint performance scorecards, quarterly business reviews, and contingency dual-sourcing agreements for critical tier-one components.';
  const res = compareArchiveTexts(
    [{ id: 'cur-1', indexNo: 'PSCM/25/011', fullName: 'Nana', text: essay }],
    [{ id: 'arc-9', index_no: 'PSCM/23/088', full_name: 'Past Student', course_code: 'PSCM301', semester: '2023/24 Sem 1', title: 'Case Study 1', text: essay }],
    { thresholdPct: 50 }
  );

  assert.equal(res.checkedArchiveCount, 1);
  assert.equal(res.matches.length, 1);
  assert.equal(res.matches[0].archive.courseCode, 'PSCM301');
  assert.ok(res.matches[0].scorePct >= 80);
});

test('questionParser: parses sample multi-format questions cleanly', () => {
  const parsed = parseQuestionsFromText(SAMPLE_PASTE_TEXT);
  assert.equal(parsed.length, 5);
  assert.deepEqual(
    parsed.map((q) => q.kind),
    ['mcq', 'truefalse', 'short', 'numeric', 'essay']
  );
  assert.equal(parsed[0].answer.correct, 'b');
  assert.equal(parsed[1].answer.correct, 'true');
  assert.equal(parsed[3].answer.value, 100);
});

test('assignmentMeta: roundtrips metadata, resolves deadlines, and validates cohort & file formats', () => {
  const encoded = serializeAssignmentMeta('Submit a PDF supplier audit.', {
    audience: { classes: ['BSc PSCM|Regular'], programmes: [], streams: [] },
    submission: { mode: 'file', fileFormat: 'pdf', allowPaste: false },
    deadlines: {
      byClass: { 'BSc PSCM|Regular': '2026-10-10T18:00:00.000Z' },
      byStudent: { 'PSCM/24/009': '2026-10-15T18:00:00.000Z' },
    },
  });
  const meta = parseAssignmentMeta({ instructions: encoded });

  assert.equal(meta.cleanInstructions, 'Submit a PDF supplier audit.');
  assert.equal(assignmentMatchesStudent(meta, { programme: 'BSc PSCM', stream: 'Regular' }), true);
  assert.equal(assignmentMatchesStudent(meta, { programme: 'BBA', stream: 'Weekend' }), false);
  assert.equal(validateSubmissionFile('report.pdf', 'pdf'), null);
  assert.ok(validateSubmissionFile('report.docx', 'pdf'));

  const base = { due_at: '2026-10-05T18:00:00.000Z' };
  assert.equal(resolveEffectiveDue(base, meta, { index_no: 'PSCM/24/009', programme: 'BSc PSCM', stream: 'Regular' }).source, 'student');
  assert.equal(resolveEffectiveDue(base, meta, { index_no: 'PSCM/24/010', programme: 'BSc PSCM', stream: 'Regular' }).source, 'class');
  assert.equal(resolveEffectiveDue(base, meta, { index_no: 'PSCM/24/011', programme: 'Other', stream: 'Evening' }).source, 'default');
});

test('quizMeta: serializes per-format rules and resolves question time limits', () => {
  const encoded = serializeQuizMeta('Closed-book exam.', {
    custom_times_enabled: true,
    format_times: { mcq: 45, essay: 300 },
    two_phase_screens: true,
  });
  const meta = parseQuizMeta({ instructions: encoded });
  assert.equal(meta.cleanInstructions, 'Closed-book exam.');
  assert.equal(meta.two_phase_screens, true);
  assert.equal(getQuestionTimeLimit({ kind: 'mcq' }, meta, 60, false), 45);
  assert.equal(getQuestionTimeLimit({ kind: 'short' }, meta, 60, false), 60);
  assert.equal(getQuestionTimeLimit({ kind: 'mcq' }, meta, 60, true), null);
});

test('courseMeta: computes partitioned CA1/CA2 and lock timestamps', () => {
  const components = [
    { id: 'c1', weight: 20 },
    { id: 'c2', weight: 20 },
  ];
  const row = { total: 30, parts: { c1: { points: 16 }, c2: { points: 14 } } };
  const caConfig = { ca1_weight: 20, ca2_weight: 20, ca1_components: ['c1'], ca2_components: ['c2'] };
  const res = computeStudentCA(row, components, caConfig, 40);
  assert.equal(res.ca1, 16);
  assert.equal(res.ca2, 14);
  assert.equal(res.totalCa, 30);

  const now = Date.parse('2026-11-18T10:00:00.000Z');
  assert.equal(isItemLocked('2026-11-19T10:00:00.000Z', now), true);
  assert.equal(isItemLocked('2026-11-17T10:00:00.000Z', now), false);
});

test('sheets: rowsToStudents skips serial number columns and detects name vs index cleanly', () => {
  const rows = [
    ['S/N', 'Index Number', 'Full Name', 'Programme', 'Stream'],
    ['1', 'PSCM/25/001', 'Ama Mensah', 'BSc PSCM', 'Regular'],
    ['2', 'PSCM/25/002', 'PSCM/25/002', 'BSc PSCM', 'Evening'],
  ];
  const parsed = rowsToStudents(rows);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].index_no, 'PSCM/25/001');
  assert.equal(parsed[0].full_name, 'Ama Mensah');
  assert.equal(parsed[0].programme, 'BSc PSCM');
  assert.equal(parsed[1].index_no, 'PSCM/25/002');
  assert.equal(parsed[1].full_name, 'PSCM/25/002');
});
