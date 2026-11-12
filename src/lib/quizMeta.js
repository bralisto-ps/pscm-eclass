// Helpers for storing and retrieving quiz-level metadata:
// 1. Format-specific countdown time limits (e.g. 30s MCQ, 20s True/False, 45s Short, 90s Calculation, 180s Essay)
// 2. Stratified format quotas (e.g. draw 10 MCQs, 5 True/False, 2 Calculations, 1 Essay from bank)
// Stored inside quiz.instructions using <!-- QUIZ_META:{...} --> so standard human instructions remain clean.

const META_REGEX = /<!-- QUIZ_META:([\s\S]*?)-->/;

export const FORMAT_LABELS = {
  mcq: 'Multiple choice',
  truefalse: 'True / false',
  short: 'Short answer',
  numeric: 'Calculation',
  essay: 'Written answer',
};

export const cleanText = (str) => String(str || '').replace(META_REGEX, '').trim();

export function parseQuizMeta(quiz) {
  const raw = quiz?.instructions || '';
  const match = raw.match(META_REGEX);
  let cleanInstructions = raw;
  let meta = {
    custom_times_enabled: false,
    format_times: {
      mcq: '',
      truefalse: '',
      short: '',
      numeric: '',
      essay: '',
    },
    format_quotas_enabled: false,
    format_quotas: {
      mcq: '',
      truefalse: '',
      short: '',
      numeric: '',
      essay: '',
    },
  };

  if (match) {
    cleanInstructions = raw.replace(META_REGEX, '').trim();
    try {
      const parsed = JSON.parse(match[1]);
      meta = {
        custom_times_enabled: Boolean(parsed.custom_times_enabled),
        format_times: {
          mcq: parsed.format_times?.mcq ?? '',
          truefalse: parsed.format_times?.truefalse ?? '',
          short: parsed.format_times?.short ?? '',
          numeric: parsed.format_times?.numeric ?? '',
          essay: parsed.format_times?.essay ?? '',
        },
        format_quotas_enabled: Boolean(parsed.format_quotas_enabled),
        format_quotas: {
          mcq: parsed.format_quotas?.mcq ?? '',
          truefalse: parsed.format_quotas?.truefalse ?? '',
          short: parsed.format_quotas?.short ?? '',
          numeric: parsed.format_quotas?.numeric ?? '',
          essay: parsed.format_quotas?.essay ?? '',
        },
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
  const base = String(cleanInstructions || '').trim();
  const payload = {
    custom_times_enabled: Boolean(meta.custom_times_enabled),
    format_times: meta.format_times || {},
    format_quotas_enabled: Boolean(meta.format_quotas_enabled),
    format_quotas: meta.format_quotas || {},
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

export const STRATIFIED_SQL_SNIPPET = `-- Run this in your Supabase SQL Editor to enable automatic stratified format quotas:
CREATE OR REPLACE FUNCTION public.start_attempt(p_quiz uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  qz public.quizzes; w record; a public.attempts; n int;
  v_dead timestamptz; v_order uuid[]; v_id uuid;
  v_meta jsonb;
  q_mcq int; q_tf int; q_num int; q_short int; q_essay int;
  has_quotas boolean := false;
BEGIN
  SELECT * INTO qz FROM public.quizzes WHERE id = p_quiz;
  IF NOT FOUND OR NOT qz.published THEN RAISE EXCEPTION 'Quiz not found.'; END IF;
  IF NOT public.is_enrolled(qz.course_id) THEN RAISE EXCEPTION 'You are not enrolled in this course.'; END IF;

  SELECT * INTO w FROM public.quiz_window_for(p_quiz, auth.uid());
  IF NOT w.allowed THEN RAISE EXCEPTION 'This quiz is not open to you.'; END IF;

  SELECT * INTO a FROM public.attempts
   WHERE quiz_id = p_quiz AND student_id = auth.uid()
   ORDER BY attempt_no DESC LIMIT 1;
  IF FOUND THEN
    IF now() <= a.deadline_at THEN RETURN a.id; END IF;
    PERFORM public.finalize_attempt(a.id);
  END IF;

  IF w.opens_at IS NOT NULL AND now() < w.opens_at THEN
    RAISE EXCEPTION 'This quiz has not opened yet.';
  END IF;
  IF w.closes_at IS NOT NULL AND now() > w.closes_at THEN
    RAISE EXCEPTION 'This quiz has closed.';
  END IF;

  SELECT count(*) INTO n FROM public.attempts WHERE quiz_id = p_quiz AND student_id = auth.uid();
  IF NOT qz.is_practice AND n >= qz.max_attempts + COALESCE((SELECT x.extra_attempts FROM public.quiz_access x
                                                              WHERE x.quiz_id = p_quiz AND x.index_no = public.my_index()), 0) THEN
    RAISE EXCEPTION 'You have used all your attempts for this quiz.';
  END IF;

  -- Check for stratified format quotas in quiz instructions metadata
  IF qz.instructions ~ '<!-- QUIZ_META:(.*?)-->' THEN
    BEGIN
      v_meta := (regexp_match(qz.instructions, '<!-- QUIZ_META:(.*?)-->'))[1]::jsonb;
      IF (v_meta->>'format_quotas_enabled')::boolean = true AND v_meta ? 'format_quotas' THEN
        q_mcq   := COALESCE(NULLIF(v_meta->'format_quotas'->>'mcq', '')::int, 0);
        q_tf    := COALESCE(NULLIF(v_meta->'format_quotas'->>'truefalse', '')::int, 0);
        q_num   := COALESCE(NULLIF(v_meta->'format_quotas'->>'numeric', '')::int, 0);
        q_short := COALESCE(NULLIF(v_meta->'format_quotas'->>'short', '')::int, 0);
        q_essay := COALESCE(NULLIF(v_meta->'format_quotas'->>'essay', '')::int, 0);
        IF (q_mcq + q_tf + q_num + q_short + q_essay) > 0 THEN
          has_quotas := true;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      has_quotas := false;
    END;
  END IF;

  IF has_quotas THEN
    SELECT array_agg(x.id ORDER BY CASE WHEN qz.shuffle_questions THEN random() ELSE 0 END, x.position, x.created_at)
      INTO v_order
      FROM (
        (SELECT id, position, created_at FROM public.questions WHERE quiz_id = p_quiz AND kind = 'mcq' ORDER BY random() LIMIT NULLIF(q_mcq, 0))
        UNION ALL
        (SELECT id, position, created_at FROM public.questions WHERE quiz_id = p_quiz AND kind = 'truefalse' ORDER BY random() LIMIT NULLIF(q_tf, 0))
        UNION ALL
        (SELECT id, position, created_at FROM public.questions WHERE quiz_id = p_quiz AND kind = 'numeric' ORDER BY random() LIMIT NULLIF(q_num, 0))
        UNION ALL
        (SELECT id, position, created_at FROM public.questions WHERE quiz_id = p_quiz AND kind = 'short' ORDER BY random() LIMIT NULLIF(q_short, 0))
        UNION ALL
        (SELECT id, position, created_at FROM public.questions WHERE quiz_id = p_quiz AND kind = 'essay' ORDER BY random() LIMIT NULLIF(q_essay, 0))
      ) x;
  ELSE
    SELECT array_agg(x.id ORDER BY CASE WHEN qz.shuffle_questions THEN random() ELSE 0 END, x.position, x.created_at)
      INTO v_order
      FROM (SELECT id, position, created_at FROM public.questions
             WHERE quiz_id = p_quiz
             ORDER BY random()
             LIMIT COALESCE(NULLIF(qz.pool_size, 0), 100000)) x;
  END IF;

  IF v_order IS NULL THEN RAISE EXCEPTION 'This quiz has no questions yet.'; END IF;

  v_dead := now() + make_interval(mins => qz.duration_minutes);
  IF w.closes_at IS NOT NULL AND w.closes_at < v_dead THEN v_dead := w.closes_at; END IF;

  INSERT INTO public.attempts (quiz_id, student_id, attempt_no, question_order, deadline_at)
  VALUES (p_quiz, auth.uid(), n + 1, v_order, v_dead)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
`;
