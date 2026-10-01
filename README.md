# PSCM E-class

A personal online classroom for procurement, logistics and supply chain courses. It is built with React and Vite and runs on Supabase, all on free plans.

**To put it online, follow [SETUP.md](SETUP.md).**

## What it does

**For students** (works on phones and laptops)
- Sign in with an **index number**. First-time students activate their own account; no email is needed.
- A home page with what's due next, their courses and announcements.
- Weekly materials: PDFs, slides, documents, and YouTube or Drive links.
- Timed quizzes that save each answer as they go. When time runs out, the quiz submits itself. There is a question navigator, flag-for-review and a formula sheet.
- Assignment upload (PDF, Office, ZIP or images, up to 5 MB), with the option to replace before the deadline.
- Grades and feedback once released, and a review of quiz answers.

**For the lecturer**
- Courses, each with its own colour, archive and delete.
- Class lists from Excel or CSV, or pasted in. Shows who has activated. Lecturer resets passwords.
- Materials organised by week.
- **Quiz builder** with five question types:
  - Multiple choice, including bulk paste
  - True/false
  - Short answer, marked automatically with a list of accepted answers
  - Written answers, marked by the lecturer with a marking guide beside each answer
  - Calculations
- **Calculations with figures unique to each student.** For example, an EOQ question gives every student a different D, S and H, and each answer is marked against that student's own correct value.
- Quiz options: opening and closing times, time limit, attempts, practice mode, question and option shuffling, and duplicating a quiz.
- **Gradebook:**
  - Score distribution
  - Filters for needs marking, not submitted and very fast finishers
  - Allow retake
  - Export to Excel
  - Release results, with answers optional
- Assignment marking with feedback, "save and next", late flags, release marks and Excel export.
- Announcements.

## How it is secured

- Every table uses row-level security. Students see only the courses they are enrolled in.
- Students never receive quiz answers. Questions are delivered and marked by database functions (`supabase/schema.sql`), and answers can only be saved before the attempt's deadline.
- Student uploads can only go into the student's own folder, for an open assignment.

## Project layout

```
supabase/schema.sql      database, security rules and marking logic (run in Supabase SQL Editor)
src/lib/                 Supabase client, sign-in, formatting, Excel import/export
src/components/          layout, icons, shared UI pieces
src/pages/student/       home, course, take quiz, review, grades
src/pages/lecturer/      dashboard, course management tabs, quiz builder, results, assignment marking
```

## Tested

- The SQL was run twice on PostgreSQL, to check it can be re-run safely. A 66-check test covered marking for every question type, per-student figures, hidden answers, time limits, upload permissions and lecturer-only actions.
- A full browser run-through against real Supabase Auth and PostgREST covered:
  - The lecturer creating a course, uploading a class list, adding materials, building a quiz, and creating an assignment and an announcement
  - A student activating, taking the quiz and handing in work
  - A second student on a phone
  - The lecturer marking and releasing
  - The student seeing their grades and quiz review
- Gradebook with 800 students: 1.5 s on first load (marking 16,000 answers), 0.05 s after that.
