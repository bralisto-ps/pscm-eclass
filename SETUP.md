# Deploying PSCM E-class

PSCM E-class runs on **Supabase** (PostgreSQL + Auth + Storage + Realtime) and **Cloudflare Pages** (global CDN hosting).

---

## Part A — Core Setup (Supabase + Cloudflare Pages)

### Step 1 — Dedicated student alias email
Create or designate one Gmail address for behind-the-scenes student accounts, for example `pscm.eclass.accounts@gmail.com`.
Students sign in using only their **index number**; Supabase stores `name+INDEX@gmail.com` internally.

### Step 2 — Create the Supabase project
1. Create a Supabase project (EU region such as London, Ireland, or Frankfurt works best for Ghana).
2. In **SQL Editor → New query**, run `supabase/schema.sql` (set `lecturer_email` and `student_email_base` near the top).
3. For updates on an existing database, run only the new numbered file in `supabase/migrations/` — never overwrite live data with an older schema snapshot.
4. Under **Authentication → Sign In / Providers → Email**, disable **Confirm email** (students sign in by index number without a mailbox).
5. Create your lecturer account in **Authentication → Users** (matching `lecturer_email`, with **Auto Confirm User** checked).

### Step 3 — Deploy to Cloudflare Pages
1. Connect the GitHub repository in **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**.
2. Build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. Add Environment Variables under **Settings → Environment variables**:
   - `VITE_SUPABASE_URL` — Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` — Supabase anon / publishable key
   - `VITE_STUDENT_EMAIL_BASE` — Exact `student_email_base` used in SQL
   - `VITE_USE_R2` — `false` (default; uses Supabase Pro 100 GB storage directly) or `true` if using Part B below.
4. Security headers (`CSP`, `X-Frame-Options`, `Permissions-Policy`) and SPA fallback routes are configured automatically via `public/_headers` and `public/_redirects`.

---

## Part B — Optional Cloudflare R2 Storage & Server-Side Edge Functions

1. **R2 File Service (`supabase/functions/files/index.ts`):**
   Deploy Edge Function `files` and set secrets:
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
   Then set `VITE_USE_R2=true` in Cloudflare Pages to route uploads/downloads through short-lived signed R2 URLs.
2. **Server-Side AI Question Drafting (`supabase/functions/ai-draft/index.ts`) & AI Written-Answer & Assignment Marking (`supabase/functions/ai-grade/index.ts`):**
   Deploy Edge Functions `ai-draft`, `ai-grade`, and `ai-topic-check` (`supabase functions deploy ai-grade ai-topic-check`) and set secret `GEMINI_API_KEY` in **Supabase → Edge Functions → Secrets**. The key never leaves Supabase servers.
3. **Database JSON Snapshot Backup (`supabase/functions/backup/index.ts`):**
   Deploy Edge Function `backup` to trigger on-demand or scheduled table backups to R2 (or download JSON snapshots as lecturer).

---

## Storage, Backups & Maintenance
- **Supabase Pro ($25/month):** Provides 100 GB file storage, no 7-day inactivity pause, and automated daily Supabase backups.
- **Additional Redundancy:** Use **Settings → Export full semester workbook (.xlsx)** on any course, or run the `backup` Edge Function on a cron schedule.
- **Local Development:**
  ```bash
  cp .env.example .env.local   # fill VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_STUDENT_EMAIL_BASE
  npm install
  npm run dev
  ```
