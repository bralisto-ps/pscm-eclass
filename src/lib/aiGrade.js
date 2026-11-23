import { supabase } from './supabase.js';
import { AI_STRICTNESS_OPTIONS, chunkArray, clampAiMark, normalizeAiGradeRow } from './aiGradeUtils.js';

export { AI_STRICTNESS_OPTIONS, chunkArray, clampAiMark, normalizeAiGradeRow };

export async function extractEdgeError(error, data) {
  if (data?.error) return String(data.error);
  if (error?.context && typeof error.context.json === 'function') {
    try {
      const payload = await error.context.json();
      if (payload?.error) return String(payload.error);
    } catch {
      // ignore parse failure
    }
  }
  const msg = String(error?.message || '');
  if (/Failed to send a request|Failed to fetch|NetworkError/i.test(msg)) {
    return 'Could not reach the ai-grade Edge Function. Make sure it is deployed in Supabase.';
  }
  return msg || 'AI grading failed.';
}

/**
 * Calls the server-side `ai-grade` Supabase Edge Function in batches for a single
 * written-answer quiz question, deduplicating identical answers to save time and tokens.
 */
export async function aiGradeQuestionGroups({
  courseId,
  quizId,
  prompt,
  modelAnswer,
  maxMarks,
  rubric = [],
  strictness = 'standard',
  groups = [],
  batchSize = 10,
  onProgress,
  signal,
}) {
  if (!String(modelAnswer || '').trim()) {
    throw new Error('Add a model answer / marking guide for this question first.');
  }
  if (!groups.length) return { suggestions: {}, model: null };

  const batches = chunkArray(groups, batchSize);
  const suggestions = {};
  let usedModel = null;
  let completed = 0;

  for (const batch of batches) {
    if (signal?.aborted) throw new Error('AI grading cancelled.');

    const payload = {
      context_type: 'quiz',
      course_id: courseId,
      quiz_id: quizId,
      question_prompt: prompt,
      model_answer: modelAnswer,
      max_marks: Number(maxMarks),
      rubric: Array.isArray(rubric) ? rubric : [],
      strictness,
      items: batch.map((g) => ({ id: g.key, answer: g.sampleAnswer || '' })),
    };

    const { data, error } = await supabase.functions.invoke('ai-grade', { body: payload });
    if (error || data?.error) {
      const reason = await extractEdgeError(error, data);
      throw new Error(reason);
    }

    if (data?.model) usedModel = data.model;
    const grades = Array.isArray(data?.grades) ? data.grades : [];
    const byKey = new Map(grades.map((g) => [g.id, g]));

    for (const g of batch) {
      const result = byKey.get(g.key);
      if (!result) continue;
      const normalized = normalizeAiGradeRow(result, maxMarks);
      for (const r of g.items) {
        suggestions[r.response_id] = normalized;
      }
    }

    completed += batch.length;
    onProgress?.(completed, groups.length);
  }

  return { suggestions, model: usedModel };
}

/**
 * Calls the server-side `ai-grade` Edge Function in smaller batches for extracted
 * assignment submissions (typed answers, PDFs, Word .docx, or .txt).
 * Only anonymized submission IDs and text are sent — never student names or index numbers.
 */
export async function aiGradeAssignmentDocs({
  courseId,
  assignmentId,
  prompt,
  modelAnswer,
  maxMarks,
  rubric = [],
  strictness = 'standard',
  docs = [],
  batchSize = 4,
  onProgress,
  signal,
}) {
  if (!String(modelAnswer || '').trim()) {
    throw new Error('Provide a model answer / marking guide first.');
  }
  if (!docs.length) return { gradesById: {}, model: null };

  const batches = chunkArray(docs, batchSize);
  const gradesById = {};
  let usedModel = null;
  let completed = 0;

  for (const batch of batches) {
    if (signal?.aborted) throw new Error('AI grading cancelled.');

    const payload = {
      context_type: 'assignment',
      course_id: courseId,
      assignment_id: assignmentId,
      question_prompt: prompt,
      model_answer: modelAnswer,
      max_marks: Number(maxMarks),
      rubric: Array.isArray(rubric) ? rubric : [],
      strictness,
      items: batch.map((d) => ({ id: String(d.id), answer: String(d.text || '') })),
    };

    const { data, error } = await supabase.functions.invoke('ai-grade', { body: payload });
    if (error || data?.error) {
      const reason = await extractEdgeError(error, data);
      throw new Error(reason);
    }

    if (data?.model) usedModel = data.model;
    const grades = Array.isArray(data?.grades) ? data.grades : [];
    for (const row of grades) {
      if (!row?.id) continue;
      gradesById[String(row.id)] = normalizeAiGradeRow(row, maxMarks);
    }

    completed += batch.length;
    onProgress?.(completed, docs.length);
  }

  return { gradesById, model: usedModel };
}
