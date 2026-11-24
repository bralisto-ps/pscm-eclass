// Server-side AI Semantic Duplicate Detector for Product / Firm Pre-Registration (PSCM E-class)
// Catches aliases, acronyms, abbreviations, brand nicknames, and spelling variations
// (e.g. GCB vs Ghana Commercial Bank, MTN vs Scancom PLC, Voltic Water vs Voltic Mineral Water,
// Coca-Cola vs Coke, Kasapreko vs Kasapreco) using @google/genai with GEMINI_API_KEY
// stored strictly in Supabase Edge Function Secrets.

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

    const body = await req.json();
    const mode = body?.mode === "audit_all" ? "audit_all" : "check_one";
    const courseId = String(body?.course_id || "").trim();
    if (!courseId) return reply({ error: "course_id is required." }, 400);

    const uniquenessRaw = String(body?.uniqueness || "product").toLowerCase();
    const uniqueness =
      uniquenessRaw === "firm" || uniquenessRaw === "both" ? uniquenessRaw : "product";

    if (mode === "audit_all") {
      const { data: isStaff, error: staffErr } = await supabase.rpc("is_staff", {
        p_course: courseId,
      });
      if (staffErr || !isStaff) return reply({ error: "Staff only." }, 403);
    } else {
      const [{ data: enrolled }, { data: isStaff }] = await Promise.all([
        supabase.rpc("is_enrolled", { p_course: courseId }),
        supabase.rpc("is_staff", { p_course: courseId }),
      ]);
      if (!enrolled && !isStaff) {
        return reply({ error: "You are not enrolled in this course." }, 403);
      }
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return reply(
        { error: "GEMINI_API_KEY is not configured in Supabase Edge Function Secrets." },
        503,
      );
    }

    const model = Deno.env.get("GEMINI_MODEL") || "gemini-4-hydrogen";
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const ruleExplanation =
      uniqueness === "firm"
        ? "UNIQUENESS RULE = FIRM: Two entries are duplicates if they refer to the SAME firm, company, parent/trading name, acronym, or brand owner (e.g. 'MTN Ghana' and 'Scancom PLC'; 'GCB' and 'Ghana Commercial Bank'; 'Kasapreko' and 'Kasapreco Ltd'; 'FanMilk' and 'Fan Milk PLC'), regardless of which product they chose."
        : uniqueness === "both"
        ? "UNIQUENESS RULE = FIRM AND PRODUCT: Two entries are duplicates if EITHER the firm is the same company/brand owner OR the product/service is the same product under different spelling, wording, or alias."
        : "UNIQUENESS RULE = PRODUCT ONLY: Two entries are duplicates if they refer to the SAME product/service (including spelling variations, typos, abbreviations, brand nicknames, or minor wording differences like 'Voltic Water' vs 'Voltic Mineral Water', 'Coca-Cola' vs 'Coke', 'Milo' vs 'Nestle Milo Drink', 'Indomie' vs 'Indomie Instant Noodles'). IMPORTANT: Two genuinely DIFFERENT products from the same large firm (e.g. 'Nestlé — Milo' vs 'Nestlé — Cerelac', or 'Unilever — Pepsodent' vs 'Unilever — Geisha Soap') are NOT duplicates under this rule.";

    if (mode === "check_one") {
      const firmName = String(body?.firm_name || "").trim().slice(0, 120);
      const productName = String(body?.product_name || "").trim().slice(0, 120);
      const existing = Array.isArray(body?.existing)
        ? body.existing.slice(0, 160).map((e: Record<string, unknown>) => ({
            firm_name: String(e?.firm_name || "").trim().slice(0, 120),
            product_name: String(e?.product_name || "").trim().slice(0, 120),
          }))
        : [];

      if (!firmName) return reply({ error: "firm_name is required." }, 400);
      if (!existing.length) {
        return reply({
          is_duplicate: false,
          matched_firm: "",
          matched_product: "",
          confidence: "high",
          reason: "",
          model,
        });
      }

      const systemInstruction = [
        "You are a strict duplicate detector for university assignment product/firm registrations (especially Ghanaian, West African, and global consumer/industrial brands).",
        ruleExplanation,
        "Check whether the NEW CANDIDATE duplicates ANY entry in ALREADY REGISTERED.",
        "Be accurate: catch typos, misspellings, spacing/hyphen differences, acronyms/abbreviations, corporate legal names vs trading names, and generic word additions ('Drink', 'Water', 'Ltd', 'Ghana'), but do NOT produce false positives for genuinely different companies or genuinely different products.",
        "Return strict JSON matching the schema.",
      ].join("\n");

      const prompt = [
        "NEW CANDIDATE:",
        JSON.stringify({ firm_name: firmName, product_name: productName }),
        "",
        "ALREADY REGISTERED (anonymized):",
        JSON.stringify(existing),
      ].join("\n");

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              is_duplicate: { type: Type.BOOLEAN },
              matched_firm: { type: Type.STRING },
              matched_product: { type: Type.STRING },
              confidence: { type: Type.STRING, description: "high, medium, or low" },
              reason: { type: Type.STRING, description: "Short plain-English explanation (under 25 words)" },
            },
            required: ["is_duplicate", "matched_firm", "matched_product", "confidence", "reason"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim());
      return reply({
        is_duplicate: Boolean(parsed?.is_duplicate),
        matched_firm: String(parsed?.matched_firm || "").trim(),
        matched_product: String(parsed?.matched_product || "").trim(),
        confidence: ["high", "medium", "low"].includes(String(parsed?.confidence || "").toLowerCase())
          ? String(parsed.confidence).toLowerCase()
          : "medium",
        reason: String(parsed?.reason || "").trim().slice(0, 240),
        model,
      });
    }

    // mode === "audit_all": scan chronological claims list and flag later duplicates
    const claims = Array.isArray(body?.claims)
      ? body.claims.slice(0, 180).map((c: Record<string, unknown>, idx: number) => ({
          order: idx + 1,
          id: String(c?.id || ""),
          firm_name: String(c?.firm_name || "").trim().slice(0, 120),
          product_name: String(c?.product_name || "").trim().slice(0, 120),
        })).filter((c: { id: string }) => c.id)
      : [];

    if (claims.length < 2) return reply({ duplicates: [], model });

    const auditSystem = [
      "You are auditing a chronological list of student/syndicate product & firm registrations for a university assignment (ordered from earliest order=1 to latest).",
      ruleExplanation,
      "Find every LATER entry (higher order number) that duplicates an EARLIER entry (lower order number), including misspellings, acronyms, brand nicknames, parent-company aliases, and wording variations.",
      "Always mark the EARLIER entry as earlier_id and the LATER entry as later_id.",
      "Return an empty array if there are no genuine duplicates. Avoid false positives.",
    ].join("\n");

    const response = await ai.models.generateContent({
      model,
      contents: `CHRONOLOGICAL CLAIMS:\n${JSON.stringify(claims)}`,
      config: {
        systemInstruction: auditSystem,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              earlier_id: { type: Type.STRING },
              later_id: { type: Type.STRING },
              confidence: { type: Type.STRING, description: "high, medium, or low" },
              reason: { type: Type.STRING, description: "Concise reason (under 25 words)" },
            },
            required: ["earlier_id", "later_id", "confidence", "reason"],
          },
        },
      },
    });

    const parsed = JSON.parse((response.text ?? "[]").trim());
    const validIds = new Set(claims.map((c: { id: string }) => c.id));
    const duplicates = Array.isArray(parsed)
      ? parsed
          .filter((d: Record<string, unknown>) =>
            validIds.has(String(d?.earlier_id || "")) &&
            validIds.has(String(d?.later_id || "")) &&
            String(d?.earlier_id) !== String(d?.later_id)
          )
          .map((d: Record<string, unknown>) => ({
            earlier_id: String(d.earlier_id),
            later_id: String(d.later_id),
            confidence: ["high", "medium", "low"].includes(String(d.confidence || "").toLowerCase())
              ? String(d.confidence).toLowerCase()
              : "medium",
            reason: String(d.reason || "").trim().slice(0, 240),
          }))
      : [];

    return reply({ duplicates, model });
  } catch (err) {
    return reply(
      { error: err instanceof Error ? err.message : "Failed to run duplicate check." },
      500,
    );
  }
});
