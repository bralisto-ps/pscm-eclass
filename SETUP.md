# Putting PSCM E-class online

This takes about 45 minutes the first time. Everything here is free. You need a computer, a web browser and a Gmail account.

You will create four free accounts:

| Service | What it does |
|---|---|
| A new Gmail address | A behind-the-scenes address for student logins (never receives mail) |
| **Supabase** (supabase.com) | Database, logins and file storage |
| **GitHub** (github.com) | Stores the website's code |
| **Netlify** (netlify.com) | Puts the website online |

---

## Step 1 — Create a Gmail address for the app

Create a new Gmail account just for the app, for example `pscm.eclass.accounts@gmail.com`.

Why: Supabase logins must look like email addresses, but your students sign in with their **index number**. Behind the scenes, index number `4021180` becomes `pscm.eclass.accounts+4021180@gmail.com`. No email is ever sent to it. It only needs to be a real Gmail address so Supabase accepts it.

Write it down. You will type it in two places: step 3 and step 6.

---

## Step 2 — Create the Supabase project

1. Go to **supabase.com** and sign up (you can use "Continue with GitHub" after step 5, or your email now).
2. Click **New project**.
   - Name: `pscm-eclass`
   - Database password: click **Generate** and save it somewhere safe
   - Region: pick the one closest to Ghana that is offered (a European region such as London, Ireland or Frankfurt is usually fastest)
   - Plan: **Free**
3. Wait about two minutes for the project to finish setting up.

---

## Step 3 — Create the database

1. Open the file `supabase/schema.sql` from this project in any text editor (Notepad is fine).
2. Near the top, find these two lines and replace the placeholder addresses:
   ```sql
   ('lecturer_email',     'YOUR-EMAIL@gmail.com'),
   ('student_email_base', 'YOUR-APP-ACCOUNT@gmail.com')
   ```
   - `lecturer_email`: the email **you** will sign in with as the lecturer.
   - `student_email_base`: the Gmail address from step 1.
3. In Supabase, open **SQL Editor** (left menu) → **New query**.
4. Paste the **whole** file and click **Run**. It should end with "Success. No rows returned".

You can run the file again later without losing data. That is how you would install an update.

---

## Step 4 — Two login settings and your lecturer account

**Turn off email confirmation** (students have no mailbox to confirm):

1. Go to **Authentication** → **Sign In / Providers** (in some versions: **Providers → Email**).
2. Turn **off** "Confirm email" and click **Save**.

**Create your lecturer account:**

1. Go to **Authentication** → **Users** → **Add user** → **Create new user**.
2. Enter the same email you put in `lecturer_email` and a strong password.
3. Tick **Auto Confirm User**, then click **Create user**.

**Set your display name** (optional). In the SQL Editor, run:
```sql
update public.profiles set full_name = 'Dr. Your Name' where role = 'lecturer';
```

**Copy your connection details.** Go to **Project Settings** → **API** (or the **Connect** button at the top) and copy two values:
- **Project URL**, which looks like `https://abcdefgh.supabase.co`
- The **anon / public** key (it may be called the "publishable" key)

Never use the `service_role` or "secret" key in the website.

---

## Step 5 — Put the code on GitHub

1. Sign up at **github.com**.
2. Click **+** (top right) → **New repository**. Name it `pscm-eclass`, choose **Private**, and click **Create repository**.
3. On the next page, click **uploading an existing file**.
4. Unzip `pscm-eclass.zip` on your computer. Open the unzipped folder, select **everything inside it**, and drag it into the GitHub page.
   - Check that the files `package.json`, `index.html` and the folders `src`, `public` and `supabase` appear at the top level, not inside another folder.
5. Click **Commit changes**.

---

## Step 6 — Put the site online with Netlify

1. Sign up at **netlify.com** using **Sign up with GitHub**.
2. Click **Add new site** → **Import an existing project** → **GitHub**, and choose `pscm-eclass`.
3. The build settings fill themselves in (`npm run build`, publish `dist`). Do not change them.
4. Click **Add environment variables** and add these three:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL from step 4 |
   | `VITE_SUPABASE_ANON_KEY` | your anon/public key from step 4 |
   | `VITE_STUDENT_EMAIL_BASE` | the Gmail address from step 1 (exactly as in `schema.sql`) |

5. Click **Deploy**. After one or two minutes you get an address like `https://random-name-123.netlify.app`.
6. Optional: under **Site configuration → Change site name**, rename it, for example `pscm-eclass.netlify.app`.

If you add or change an environment variable later, go to **Deploys → Trigger deploy → Deploy site** so the change takes effect.

---

## Step 7 — First run

1. Open your site and sign in with your lecturer email and password.
2. Click **Create your first course**, for example `SCM 101`.
3. On the **Students** tab, click **Upload class list** and choose your Excel file. It needs a column of index numbers and a column of names; a heading row is fine.
4. **Test it as a student before your class does:**
   - Upload a class list containing a made-up student, for example `TEST001, Test Student`.
   - Open the site in a private/incognito window, choose **Activate your account**, and use `TEST001`.
5. Add materials, build a quiz and publish it. Then tell students:

   > Go to **https://your-site.netlify.app** → **Activate your account** → enter your index number and choose a password.

---

## Day-to-day

- **Forgotten passwords:** Course → **Students** → **Reset password**. The site creates a temporary password for you to give the student.
- **Late registrations:** upload the class list again. Existing students are not duplicated.
- **Quizzes:** results stay hidden until you press **Release results**. **Allow retake** in the gradebook deletes one student's attempt so they can try again.
- **Assignments:** mark on the assignment page, then press **Release marks**.
- **End of semester:** Course → **Settings** → **Archive course**.

## Staying within the free plan

- **File storage is 1 GB in total.** Slides and PDFs are small. Put **videos on YouTube (unlisted) or Google Drive** and add them as links. Student uploads are limited to 5 MB each.
- **The database is 500 MB.** Quiz answers and grades are tiny, so many semesters fit.
- **Inactivity pause.** A free project pauses after 7 days with no activity, for example over a long break. Open your Supabase dashboard and click **Restore** before classes resume. During term your students keep it awake.
- **No automatic backups on the free plan.** Use **Export to Excel** on each gradebook after every quiz and assignment, and keep those files.
- If the school ever funds it, Supabase Pro ($25/month) removes the pause, adds daily backups and raises storage to 100 GB. No code changes are needed.

## Running it on your own computer (optional)

This is for testing changes before putting them online. It needs Node.js 20 or newer.

```bash
cp .env.example .env.local      # then fill in the three values
npm install
npm run dev                     # opens on http://localhost:5173
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Site says "almost ready" | An environment variable is missing or misspelt. Fix it in Netlify, then **Trigger deploy**. |
| Lecturer signs in but sees "Account not ready" | The email in `lecturer_email` does not match your account. Fix it with `update public.app_settings set value = 'you@gmail.com' where key = 'lecturer_email';`, then delete the user in Authentication → Users and add it again. |
| Student: "not on any class list" | Their index number is not uploaded, or is typed differently. Check the Students tab. |
| Student: "already has an account" | They activated before. They should sign in instead, or you can reset their password. |
| "Account created, but sign-in did not start" | "Confirm email" is still on. See step 4. |
| Everything suddenly fails | The Supabase project is paused. Restore it from the Supabase dashboard. |
