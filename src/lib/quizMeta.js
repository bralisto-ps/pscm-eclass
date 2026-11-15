// Helper for encoding and decoding rich per-quiz metadata cleanly inside quizzes.instructions
// using a zero-friction hidden HTML comment tag so no schema migrations are needed for extra settings.

const META_REGEX = /\n?\s*<!--\s*QUIZ_META:(\{[\s\S]*?\})\s*-->\s*$/;

export const FORMAT_LABELS = {
  mcq: 'Multiple choice',
  multiselect: 'Multi-select',
  truefalse: 'True / false',
  short: 'Short answer',
  numeric: 'Calculation',
  essay: 'Written answer',
};

export const cleanText = (str) => String(str || '').replace(META_REGEX, '').trim();

export function parseQuizMeta(quiz) {
  const raw = typeof quiz === 'string' ? quiz : (quiz?.instructions || '');
  const match = raw.match(META_REGEX);
  let cleanInstructions = raw;
  let meta = {
    custom_times_enabled: false,
    format_times: {
      mcq: '',
      multiselect: '',
      truefalse: '',
      short: '',
      numeric: '',
      essay: '',
    },
    format_quotas_enabled: false,
    format_quotas: {
      mcq: '',
      multiselect: '',
      truefalse: '',
      short: '',
      numeric: '',
      essay: '',
    },
    two_phase_screens: false,
    question_rubrics: {},
  };

  if (match) {
    cleanInstructions = raw.replace(META_REGEX, '').trim();
    try {
      const parsed = JSON.parse(match[1]);
      meta = {
        custom_times_enabled: Boolean(parsed.custom_times_enabled),
        format_times: {
          mcq: parsed.format_times?.mcq ?? '',
          multiselect: parsed.format_times?.multiselect ?? '',
          truefalse: parsed.format_times?.truefalse ?? '',
          short: parsed.format_times?.short ?? '',
          numeric: parsed.format_times?.numeric ?? '',
          essay: parsed.format_times?.essay ?? '',
        },
        format_quotas_enabled: Boolean(parsed.format_quotas_enabled),
        format_quotas: {
          mcq: parsed.format_quotas?.mcq ?? '',
          multiselect: parsed.format_quotas?.multiselect ?? '',
          truefalse: parsed.format_quotas?.truefalse ?? '',
          short: parsed.format_quotas?.short ?? '',
          numeric: parsed.format_quotas?.numeric ?? '',
          essay: parsed.format_quotas?.essay ?? '',
        },
        two_phase_screens: Boolean(parsed.two_phase_screens),
        question_rubrics:
          parsed.question_rubrics && typeof parsed.question_rubrics === 'object'
            ? parsed.question_rubrics
            : {},
      };
    } catch {
      // ignore
    }
  }

  return {
    cleanInstructions,
    ...meta,
  };
}

export function serializeQuizMeta(cleanInstructions, meta) {
  const base = String(cleanInstructions || '').replace(META_REGEX, '').trim();
  const payload = {
    custom_times_enabled: Boolean(meta.custom_times_enabled),
    format_times: meta.format_times || {},
    format_quotas_enabled: Boolean(meta.format_quotas_enabled),
    format_quotas: meta.format_quotas || {},
    two_phase_screens: Boolean(meta.two_phase_screens),
    question_rubrics: meta.question_rubrics && typeof meta.question_rubrics === 'object' ? meta.question_rubrics : {},
  };
  return `${base}\n\n<!-- QUIZ_META:${JSON.stringify(payload)} -->`.trim();
}

export function getQuestionTimeLimit(question, quizMeta, globalTimeLimit, isPractice) {
  if (isPractice) return null;
  const kind = question?.kind;
  if (quizMeta?.custom_times_enabled && quizMeta?.format_times?.[kind]) {
    const val = Number(quizMeta.format_times[kind]);
    if (val > 0) return Math.floor(val);
  }
  return globalTimeLimit ? Number(globalTimeLimit) : 60;
}

export { ALL_NEW_FEATURES_SQL as STRATIFIED_SQL_SNIPPET } from './allFeaturesSql.js';
