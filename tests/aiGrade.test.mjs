import test from 'node:test';
import assert from 'node:assert/strict';
import { clampAiMark, chunkArray, normalizeAiGradeRow } from '../src/lib/aiGradeUtils.js';

test('aiGrade: clampAiMark bounds and rounds cleanly', () => {
  assert.equal(clampAiMark(4.3, 5), 4.5);
  assert.equal(clampAiMark(4.1, 5), 4);
  assert.equal(clampAiMark(7, 5), 5);
  assert.equal(clampAiMark(-2, 5), 0);
  assert.equal(clampAiMark(0.7, 1), 0.75);
  assert.equal(clampAiMark('invalid', 5), 0);
});

test('aiGrade: chunkArray splits batches evenly', () => {
  const batches = chunkArray([1, 2, 3, 4, 5], 2);
  assert.deepEqual(batches, [[1, 2], [3, 4], [5]]);
});

test('aiGrade: normalizeAiGradeRow sanitizes marks, similarity, and confidence', () => {
  const res = normalizeAiGradeRow(
    { marks: 9.2, similarity: 112.4, confidence: 'weird', feedback: '  Good core concept.  ' },
    5,
  );
  assert.deepEqual(res, {
    marks: 5,
    similarity: 100,
    confidence: 'medium',
    feedback: 'Good core concept.',
  });
});
