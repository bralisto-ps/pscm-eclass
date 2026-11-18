// Server-side AI Question Drafting Edge Function (PSCM E-class)
// Uses GEMINI_API_KEY stored strictly in Supabase Edge Function Secrets.
// Validates that the caller is an authenticated lecturer or co-lecturer.

import { createClient } from "npm:@supabase/supabase-js@2";

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

    const isAllowed = profile?.role === "lecturer" || profile?.role === "ta";
    if (!isAllowed) return reply({ error: "Staff only." }, 403);

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return reply({ error: "GEMINI_API_KEY is not configured in Edge Function Secrets.", fallback: true }, 503);
    }

    const { topic = "", notes = "", count = 5 } = await req.json();
    const safeCount = Math.max(1, Math.min(20, Number(count) || 5));
    const sourceText = String(notes || topic || "").trim().slice(0, 14000);
    if (!sourceText) return reply({ error: "Provide a topic or lecture notes." }, 400);

    const prompt = `You are an expert university examiner in Procurement and Supply Chain Management (PSCM).
Generate ${safeCount} high-quality multiple-choice questions strictly grounded in the topic/notes below.
Vary the correct option letter naturally across A, B, C, and D so there is no predictable answer pattern.
Format every question cleanly in plain text as:
1. Question stem?
A) Option A
B) Option B
C) Option C
D) Option D
Answer: B

Topic / Lecture Notes:
${sourceText}`;

    const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
        }),
      },
    );

    if (!resp.ok) {
      const txt = await resp.text();
      return reply({ error: `AI provider error (${resp.status}): ${txt.slice(0, 200)}` }, 502);
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return reply({ text, model });
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : "Failed to draft questions." }, 500);
  }
});
