// Server-side AI Written-Answer Grading Edge Function (PSCM E-class)
// Compares anonymized student written answers against the lecturer's model answer
// (and optional rubric) using the @google/genai SDK with GEMINI_API_KEY stored
// strictly in Supabase Edge Function Secrets.

import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "npm:@google/genai";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function clampMark(raw: unknown, maxMarks: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || maxMarks <= 0) return 0;
  const clamped = Math.max(0, Math.min(maxMarks, n));
  const step = maxMarks < 2 ? 0.25 : 0.5;
  const rounded = Math.round(clamped / step) * step;
  return Number(Math.max(0, Math.min(maxMarks, rounded)).toFixed(2));
}

function clampSimilarity(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function normConfidence(raw: unknown): "high" | "medium" | "low" {
  const v = String(raw || "").toLowerCase().trim();
  if (v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}

interface IncomingItem {
  id: string;
  answer: string;
}

interface RubricCriterion {
  label?: string;
  marks?: number;
  description?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supaUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supaAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supaUrl || !supaAnon) return reply({ error: "Supabase env missing." }, 500);

    const supabase = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return reply({ error: "Unauthorized" }, 401);

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();

    const isStaffRole = profile?.role === "lecturer" || profile?.role === "ta";
    if (!isStaffRole) return reply({ error: "Staff only." }, 403);

    const body = await req.json();
    const courseId = String(body?.course_id || "").trim();
    if (courseId) {
      const { data: canGrade, error: staffErr } = await supabase.rpc("is_staff", {
        p_course: courseId,
      });
      if (staffErr || !canGrade) {
        return reply({ error: "You are not staff on this course." }, 403);
      }
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return reply(
        { error: "GEMINI_API_KEY is not configured in Supabase Edge Function Secrets." },
        503,
      );
    }

    const questionPrompt = String(body?.question_prompt || "").trim().slice(0, 4000);
    const modelAnswer = String(body?.model_answer || "").trim().slice(0, 8000);
    const maxMarks = Number(body?.max_marks);
    const strictnessRaw = String(body?.strictness || "standard").toLowerCase();
    const strictness =
      strictnessRaw === "lenient" || strictnessRaw === "strict" ? strictnessRaw : "standard";
    const rubric: RubricCriterion[] = Array.isArray(body?.rubric)
      ? body.rubric.slice(0, 20)
      : [];
    const rawItems: IncomingItem[] = Array.isArray(body?.items)
      ? body.items.slice(0, 15).map((it: Record<string, unknown>) => ({
          id: String(it?.id || "").trim(),
          answer: String(it?.answer || "").trim().slice(0, 6000),
        })).filter((it: IncomingItem) => it.id.length > 0)
      : [];

    if (!questionPrompt) return reply({ error: "Question prompt is required." }, 400);
    if (!modelAnswer) {
      return reply(
        { error: "Add a model answer / marking guide for this question before running AI marking." },
        400,
      );
    }
    if (!Number.isFinite(maxMarks) || maxMarks <= 0 || maxMarks > 1000) {
      return reply({ error: "Valid max_marks (> 0) is required." }, 400);
    }
    if (!rawItems.length) {
      return reply({ error: "Provide at least one student answer to grade." }, 400);
    }

    // Handle blank answers deterministically without calling the LLM
    const resultsMap = new Map<
      string,
      { id: string; marks: number; similarity: number; confidence: "high" | "medium" | "low"; feedback: string }
    >();
    const nonEmptyItems: IncomingItem[] = [];
    for (const item of rawItems) {
      if (!item.answer) {
        resultsMap.set(item.id, {
          id: item.id,
          marks: 0,
          similarity: 0,
          confidence: "high",
          feedback: "No answer submitted.",
        });
      } else {
        nonEmptyItems.push(item);
      }
    }

    const model = Deno.env.get("GEMINI_MODEL") || "gemini-4-hydrogen";

    if (nonEmptyItems.length > 0) {
      const strictnessGuide =
        strictness === "lenient"
          ? "Lenient grading: reward core understanding generously even if course terminology or phrasing is imperfect."
          : strictness === "strict"
          ? "Strict grading: award full marks only when the student covers all key points accurately using proper course concepts and terminology."
          : "Standard university grading: award fair partial credit proportional to the key points from the lecturer's model answer that the student accurately explains.";

      const rubricSection = rubric.length
        ? `\nMARKING RUBRIC (allocate marks according to these criteria):\n${rubric
            .map(
              (c, idx) =>
                `${idx + 1}. ${String(c.label || "Criterion")} (${Number(c.marks || 0)} marks)${
                  c.description ? `: ${String(c.description)}` : ""
                }`,
            )
            .join("\n")}\n`
        : "";

      const stepLabel = maxMarks < 2 ? "0.25" : "0.5";
      const systemInstruction = [
        "You are an impartial university examiner grading written exam answers strictly against the lecturer's course-specific Model Answer.",
        "The lecturer's Model Answer (and Rubric, if provided) is the authoritative marking key. Prioritize the specific points, steps, formulas, and concepts in the lecturer's Model Answer over generic textbook definitions.",
        "Evaluate conceptual accuracy and semantic similarity: students who express the same valid points in their own words or with minor spelling errors should receive credit, while off-topic filler, vague restatements of the question, or factually wrong claims should receive low or zero marks.",
        strictnessGuide,
        `Award marks strictly between 0 and ${maxMarks}, rounded to the nearest ${stepLabel} mark.`,
        "For each student answer, return:",
        "- id: exact matching item id",
        `- marks: numeric score from 0 to ${maxMarks}`,
        "- similarity: integer 0-100 reflecting conceptual alignment with the lecturer's Model Answer",
        "- confidence: 'high' when clearly right/wrong, 'medium' for partial/borderline answers, or 'low' if ambiguous and worth lecturer inspection",
        "- feedback: 1-2 concise, constructive sentences (under 30 words) noting which model-answer points were covered or missed.",
        "Return one JSON object per input item in the exact schema requested.",
      ].join("\n");

      const promptBody = [
        `QUESTION (Max marks: ${maxMarks}):`,
        questionPrompt,
        "",
        "LECTURER'S MODEL ANSWER / MARKING GUIDE:",
        modelAnswer,
        rubricSection,
        "ANONYMIZED STUDENT ANSWERS TO GRADE:",
        JSON.stringify(nonEmptyItems),
      ].join("\n");

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      let responseText = "";
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: promptBody,
            config: {
              systemInstruction,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING, description: "Exact student answer id from input" },
                    marks: { type: Type.NUMBER, description: `Marks awarded between 0 and ${maxMarks}` },
                    similarity: { type: Type.INTEGER, description: "Conceptual alignment percentage 0-100" },
                    confidence: { type: Type.STRING, description: "One of: high, medium, low" },
                    feedback: { type: Type.STRING, description: "Concise 1-2 sentence grading feedback" },
                  },
                  required: ["id", "marks", "similarity", "confidence", "feedback"],
                },
              },
            },
          });
          responseText = (response.text ?? "").trim();
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const retryable = /429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|fetch/i.test(msg);
          if (attempt === 0 && retryable) {
            await new Promise((r) => setTimeout(r, 900));
            continue;
          }
          break;
        }
      }

      if (lastErr) {
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        const status = /429|RESOURCE_EXHAUSTED/i.test(msg)
          ? 429
          : /403|PERMISSION_DENIED|API_KEY_INVALID/i.test(msg)
          ? 403
          : 502;
        return reply({ error: `AI grading error: ${msg.slice(0, 260)}` }, status);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText || "[]");
      } catch {
        return reply({ error: "AI returned an unreadable grading response. Please retry this batch." }, 502);
      }

      if (!Array.isArray(parsed)) {
        return reply({ error: "AI grading response format was unexpected. Please retry." }, 502);
      }

      const validIds = new Set(nonEmptyItems.map((it) => it.id));
      for (const row of parsed) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const id = String(r.id || "").trim();
        if (!validIds.has(id)) continue;
        resultsMap.set(id, {
          id,
          marks: clampMark(r.marks, maxMarks),
          similarity: clampSimilarity(r.similarity),
          confidence: normConfidence(r.confidence),
          feedback: String(r.feedback || "").trim().slice(0, 500),
        });
      }
    }

    const grades = rawItems
      .map((it) => resultsMap.get(it.id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    return reply({ grades, model });
  } catch (err) {
    return reply(
      { error: err instanceof Error ? err.message : "Failed to grade written answers." },
      500,
    );
  }
});
