export const AI_STRICTNESS_OPTIONS = [
  { id: 'lenient', label: 'Lenient', desc: 'Generous partial credit when core idea is present' },
  { id: 'standard', label: 'Standard', desc: 'Fair university-level credit against model answer' },
  { id: 'strict', label: 'Strict', desc: 'Requires accurate course terms & full key points' },
];

export function clampAiMark(rawMarks, maxMarks) {
  const max = Number(maxMarks);
  const val = Number(rawMarks);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(val)) return 0;
  const clamped = Math.max(0, Math.min(max, val));
  const step = max < 2 ? 0.25 : 0.5;
  const rounded = Math.round(clamped / step) * step;
  return Number(Math.max(0, Math.min(max, rounded)).toFixed(2));
}

export function chunkArray(list, size = 10) {
  const n = Math.max(1, Number(size) || 10);
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export function normalizeAiGradeRow(row, maxMarks) {
  return {
    marks: clampAiMark(row?.marks, maxMarks),
    similarity: Math.max(0, Math.min(100, Math.round(Number(row?.similarity) || 0))),
    confidence: ['high', 'medium', 'low'].includes(row?.confidence) ? row.confidence : 'medium',
    feedback: String(row?.feedback || '').trim(),
  };
}
