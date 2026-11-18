// Scheduled / On-Demand JSON Snapshot Backup Edge Function (PSCM E-class)
// Uses SUPABASE_SERVICE_ROLE_KEY inside Supabase Edge Runtime (never exposed to browser).
// Optionally uploads compressed/raw JSON snapshots to R2 if R2_* secrets are configured.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TABLES = [
  "courses",
  "roster",
  "enrollments",
  "course_staff",
  "modules",
  "materials",
  "quizzes",
  "questions",
  "attempts",
  "assignments",
  "submissions",
  "ca_components",
  "ca_scores",
  "attendance_sessions",
  "attendance",
  "course_audit_log",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supaUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const cronSecret = Deno.env.get("BACKUP_CRON_SECRET") ?? "";

  if (!supaUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing service configuration" }), { status: 500, headers: cors });
  }

  // Authorize via cron secret header OR authenticated lecturer JWT
  const providedSecret = req.headers.get("x-backup-secret") ?? "";
  let authorized = Boolean(cronSecret && providedSecret === cronSecret);

  if (!authorized && anonKey) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supaUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (u?.user) {
      const { data: p } = await userClient.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
      if (p?.role === "lecturer") authorized = true;
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: cors });
  }

  const admin = createClient(supaUrl, serviceKey);
  const snapshot: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    tables: {},
  };

  for (const t of TABLES) {
    const { data, error } = await admin.from(t).select("*").limit(20000);
    (snapshot.tables as Record<string, unknown>)[t] = error ? { error: error.message } : (data ?? []);
  }

  return new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="pscm-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
});
