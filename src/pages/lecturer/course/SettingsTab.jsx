import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc, rpcAll, run, supabase } from '../../../lib/supabase.js';
import { hasCourseInfo, parseCourseMeta } from '../../../lib/courseMeta.js';
import { fmtDateTime, fmtNumber } from '../../../lib/format.js';
import { removeFiles } from '../../../lib/files.js';
import { downloadWorkbook } from '../../../lib/sheets.js';
import Icon from '../../../components/Icon.jsx';
import AuditLogPanel from '../../../components/AuditLogPanel.jsx';
import CloneCourseModal from '../../../components/CloneCourseModal.jsx';
import { Confirm, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../../components/ui.jsx';
import { CourseForm } from '../Dashboard.jsx';

export default function SettingsTab({ course, staffRole = 'lecturer', reload }) {
  const isOwner = staffRole === 'lecturer';
  const isExaminer = staffRole === 'external_examiner';
  const navigate = useNavigate();
  const toast = useToast();
  const [act, busy] = useAction();
  const [editing, setEditing] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [typed, setTyped] = useState('');

  async function toggleArchive() {
    const ok = await act(
      () => run(supabase.from('courses').update({ archived: !course.archived }).eq('id', course.id)),
      course.archived ? 'Course restored.' : 'Course archived. Students no longer see it in their menu.',
    );
    if (ok !== undefined) reload();
  }

  async function remove() {
    const ok = await act(async () => {
      const mats = await run(supabase.from('materials').select('storage_path').eq('course_id', course.id).not('storage_path', 'is', null));
      const subs = await run(supabase.from('submissions').select('file_path, assignments!inner(course_id)').eq('assignments.course_id', course.id));
      await removeFiles('materials', mats.map((m) => m.storage_path));
      await removeFiles('submissions', subs.map((x) => x.file_path));
      return run(supabase.from('courses').delete().eq('id', course.id));
    }, 'Course deleted.');
    if (ok !== undefined) navigate('/');
  }

  async function exportFullCourse() {
    setExporting(true);
    try {
      const [studentsRes, caRes, attRes, quizzesRes, assignRes, auditRes] = await Promise.allSettled([
        rpcAll('course_students', { p_course: course.id }),
        rpcAll('course_ca', { p_course: course.id }),
        rpcAll('course_attendance', { p_course: course.id }),
        run(supabase.from('quizzes').select('title, published, results_released, duration_minutes, max_attempts, opens_at, closes_at, is_practice').eq('course_id', course.id).order('created_at')),
        run(supabase.from('assignments').select('title, max_marks, due_at, published, allow_late').eq('course_id', course.id).order('created_at')),
        rpcAll('course_audit_log_list', { p_course: course.id, p_limit: 500 }),
      ]);

      const students = studentsRes.status === 'fulfilled' ? studentsRes.value : [];
      const ca = caRes.status === 'fulfilled' ? caRes.value : [];
      const att = attRes.status === 'fulfilled' ? attRes.value : [];
      const quizzes = quizzesRes.status === 'fulfilled' ? quizzesRes.value : [];
      const assigns = assignRes.status === 'fulfilled' ? assignRes.value : [];
      const audit = auditRes.status === 'fulfilled' ? auditRes.value : [];

      const safeCode = (course.code || 'COURSE').replace(/[^A-Za-z0-9_-]+/g, '_');
      const sheets = [
        {
          name: 'Roster',
          rows: [
            ['Index No', 'Full Name', 'Programme', 'Stream', 'Activated', 'Submissions', 'Avg Quiz %', 'Last Seen'],
            ...students.map((s) => [
              s.index_no,
              s.full_name,
              s.programme || '',
              s.stream || '',
              s.activated ? 'Yes' : 'No',
              s.submissions_count ?? 0,
              s.quiz_avg ?? '',
              s.last_sign_in ? fmtDateTime(s.last_sign_in) : '',
            ]),
          ],
          widths: [16, 28, 22, 12, 10, 12, 12, 20],
        },
        {
          name: 'CA Gradebook',
          rows: [
            ['Index No', 'Full Name', 'Programme', 'Stream', 'Total CA'],
            ...ca.map((r) => [r.index_no, r.full_name, r.programme || '', r.stream || '', r.total != null ? Number(fmtNumber(r.total)) : 0]),
          ],
          widths: [16, 28, 22, 12, 12],
        },
        {
          name: 'Attendance',
          rows: [
            ['Index No', 'Full Name', 'Programme', 'Stream', 'Present', 'Total Sessions', 'Rate %'],
            ...att.map((a) => {
              const p = Number(a.present_count || 0);
              const t = Number(a.total_sessions || 0);
              return [a.index_no, a.full_name, a.programme || '', a.stream || '', p, t, t > 0 ? Math.round((p / t) * 100) : 0];
            }),
          ],
          widths: [16, 28, 22, 12, 10, 14, 10],
        },
        {
          name: 'Quizzes',
          rows: [
            ['Title', 'Status', 'Type', 'Duration (min)', 'Max Attempts', 'Opens', 'Closes'],
            ...quizzes.map((q) => [
              q.title,
              q.published ? 'Published' : 'Draft',
              q.is_practice ? 'Practice' : 'Graded',
              q.duration_minutes ?? 0,
              q.max_attempts ?? 1,
              q.opens_at ? fmtDateTime(q.opens_at) : 'Any time',
              q.closes_at ? fmtDateTime(q.closes_at) : 'No close',
            ]),
          ],
          widths: [32, 12, 10, 14, 14, 20, 20],
        },
        {
          name: 'Assignments',
          rows: [
            ['Title', 'Status', 'Max Marks', 'Due Date', 'Late Allowed'],
            ...assigns.map((a) => [
              a.title,
              a.published ? 'Published' : 'Draft',
              Number(a.max_marks || 0),
              a.due_at ? fmtDateTime(a.due_at) : 'No deadline',
              a.allow_late ? 'Yes' : 'No',
            ]),
          ],
          widths: [32, 12, 12, 22, 12],
        },
        {
          name: 'Audit Log',
          rows: [
            ['Timestamp', 'Action', 'Summary', 'Actor'],
            ...audit.map((l) => [fmtDateTime(l.created_at), l.action, l.summary, l.actor_name || l.actor_email || 'Staff']),
          ],
          widths: [20, 22, 42, 24],
        },
      ];

      await downloadWorkbook(`${safeCode}_Course_Archive.xlsx`, sheets);
      toast('Full course archive workbook downloaded.');
    } catch (err) {
      toast(err?.message || 'Could not export full course archive.');
    } finally {
      setExporting(false);
    }
  }

  const meta = parseCourseMeta(course);
  const info = meta.course_info || {};

  return (
    <div className="stack-lg" style={{ maxWidth: 880 }}>
      <section className="card stack">
        <div className="between">
          <h2>Course details &amp; timetable</h2>
          {!isExaminer && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit details</button>}
        </div>
        <dl className="grid-2" style={{ margin: 0, gap: 14 }}>
          <div><dt className="eyebrow">Code</dt><dd className="mono" style={{ margin: 0 }}>{course.code}</dd></div>
          <div><dt className="eyebrow">Semester</dt><dd style={{ margin: 0 }}>{course.semester || '—'}</dd></div>
          <div><dt className="eyebrow">Lecture venue</dt><dd style={{ margin: 0 }}>{info.venue || '—'}</dd></div>
          <div><dt className="eyebrow">Office hours</dt><dd className="pre" style={{ margin: 0 }}>{info.officeHours || '—'}</dd></div>
          <div style={{ gridColumn: '1 / -1' }}><dt className="eyebrow">Lecture timetable</dt><dd className="pre" style={{ margin: 0 }}>{info.schedule || '—'}</dd></div>
          <div style={{ gridColumn: '1 / -1' }}><dt className="eyebrow">Description</dt><dd className="pre" style={{ margin: 0 }}>{meta.about || (hasCourseInfo(meta) ? '—' : '—')}</dd></div>
          {info.syllabusNote && <div style={{ gridColumn: '1 / -1' }}><dt className="eyebrow">Key course note</dt><dd className="pre" style={{ margin: 0 }}>{info.syllabusNote}</dd></div>}
        </dl>
      </section>

      <section className="card stack">
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2>End-of-semester course archive export</h2>
            <p className="small muted" style={{ marginTop: 4 }}>
              Download one multi-sheet Excel workbook containing the class roster, CA gradebook, attendance register, quizzes, assignments, and governance audit log for departmental records.
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={exportFullCourse} disabled={exporting}>
            <Icon name="download" size={16} /> {exporting ? 'Preparing workbook…' : 'Export full course (.xlsx)'}
          </button>
        </div>
      </section>

      <StaffPanel course={course} canEdit={isOwner} />

      <AuditLogPanel course={course} />

      {isOwner && (
        <section className="card stack">
          <h2>Clone course for new semester</h2>
          <p className="small muted">
            Create a fresh copy of {course.code} with your weekly modules, learning materials, quizzes, question bank, assignments, and CA structure — without copying old students, attempts, submissions, grades, or attendance.
          </p>
          <div>
            <button type="button" className="btn" onClick={() => setCloning(true)}>
              <Icon name="layers" size={16} /> Clone for new semester
            </button>
          </div>
        </section>
      )}

      {isOwner && (
        <>
          <section className="card stack">
            <h2>{course.archived ? 'Restore course' : 'Archive course'}</h2>
            <p className="small muted">
              Archiving hides the course from the menu at the end of a semester. Nothing is deleted and you can restore it any time.
            </p>
            <div><button type="button" className="btn" onClick={toggleArchive} disabled={busy}>{course.archived ? 'Restore course' : 'Archive course'}</button></div>
          </section>

          <section className="card stack" style={{ borderColor: 'var(--red-ink)' }}>
            <h2>Delete course</h2>
            <p className="small muted">
              Permanently deletes the course with all its materials, quizzes, attempts, assignments and grades. This cannot be undone —
              export the full course archive first.
            </p>
            <div><button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>Delete this course…</button></div>
          </section>
        </>
      )}

      {editing && <CourseForm course={course} onClose={() => setEditing(false)} onSaved={reload} />}
      {cloning && <CloneCourseModal sourceCourse={course} onClose={() => setCloning(false)} />}
      {deleting && (
        <Confirm
          title="Delete course permanently?"
          danger
          busy={busy || typed.trim().toUpperCase() !== course.code}
          confirmLabel="Delete forever"
          onClose={() => setDeleting(false)}
          onConfirm={remove}
        >
          <p>Type <strong className="mono">{course.code}</strong> to confirm.</p>
          <input className="input mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </Confirm>
      )}
    </div>
  );
}

const STAFF_ROLE_LABELS = {
  ta: ['Teaching Assistant', 'badge'],
  co_lecturer: ['Co-Lecturer', 'badge-blue'],
  external_examiner: ['External Examiner (Read-Only)', 'badge-plum'],
};

function StaffPanel({ course, canEdit = true }) {
  const { data, error, loading, reload } = useLoad(() => rpcAll('course_staff_list', { p_course: course.id }), [course.id]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [act, busy] = useAction();

  async function remove() {
    const ok = await act(() => rpc('remove_staff', { p_course: course.id, p_email: removing.email }), 'Removed from this course.');
    setRemoving(null);
    if (ok !== undefined) reload();
  }

  return (
    <section className="card stack" aria-label="Course teaching staff and examiners">
      <div className="between">
        <h2>Co-Lecturers, TAs &amp; External Examiners</h2>
        {canEdit && (
          <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Add staff / examiner
          </button>
        )}
      </div>
      <p className="small muted">
        <strong>Co-Lecturers</strong> can manage materials, quizzes, rubrics, CA, and grades. <strong>Teaching Assistants</strong> handle attendance, marking, Q&amp;A, and roster updates.{' '}
        <strong>External Examiners</strong> receive read-only governance access to scripts, gradebooks, audit trails, CLO attainment, and moderation sign-offs.
      </p>
      {loading && <Loading />}
      <ErrorNote error={error} onRetry={reload} />
      {data && data.length === 0 && <span className="small muted">No additional staff or examiners on this course.</span>}
      {data && data.length > 0 && (
        <div className="card-flush">
          {data.map((t) => {
            const [roleLabel, roleCls] = STAFF_ROLE_LABELS[t.staff_role || 'ta'] || STAFF_ROLE_LABELS.ta;
            return (
              <div key={t.email} className="list-row">
                <span className="list-main">
                  <span className="title row-wrap" style={{ gap: 6, alignItems: 'center' }}>
                    <span>{t.full_name || t.email}</span>
                    <span className={`badge ${roleCls}`}>{roleLabel}</span>
                  </span>
                  <span className="tiny muted">{t.email}</span>
                </span>
                <div className="list-actions">
                  {t.activated
                    ? <span className="badge badge-teal" title={t.last_sign_in ? `Last signed in ${fmtDateTime(t.last_sign_in)}` : ''}>Active</span>
                    : <span className="badge badge-amber">Not set up yet</span>}
                  {canEdit && (
                    <button type="button" className="icon-btn plain" aria-label={`Remove ${t.full_name || t.email}`} onClick={() => setRemoving(t)}><Icon name="trash" /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {data && data.some((t) => !t.activated) && (
        <p className="tiny muted">
          Invitees open the site, choose <strong>Teaching assistant? Set up your account</strong> under the sign-in form,
          and sign up with the exact email address entered here.
        </p>
      )}
      {adding && <AddStaffModal course={course} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); reload(); }} />}
      {removing && (
        <Confirm title="Remove staff member?" confirmLabel="Remove" busy={busy} onClose={() => setRemoving(null)} onConfirm={remove}
          message={`${removing.full_name || removing.email} will no longer see ${course.code}. Marks and moderation notes they already recorded stay.`} />
      )}
    </section>
  );
}

function AddStaffModal({ course, onClose, onAdded }) {
  const [act, busy] = useAction();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [staffRole, setStaffRole] = useState('ta');
  async function save() {
    const ok = await act(async () => {
      try {
        return await rpc('add_staff', { p_course: course.id, p_email: email, p_name: name, p_staff_role: staffRole });
      } catch (err) {
        if (staffRole === 'ta' && /add_staff|parameter|function/i.test(err?.message || '')) {
          return await rpc('add_staff', { p_course: course.id, p_email: email, p_name: name });
        }
        throw err;
      }
    }, 'Course staff member added.');
    if (ok !== undefined) onAdded();
  }
  return (
    <Modal title={`Add staff or examiner to ${course.code}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !email.trim()}>Add</button></>}>
      <Field label="Their email address" hint="their own Gmail or institutional email">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="name@gmail.com" />
      </Field>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Role in this course">
        <select className="select" value={staffRole} onChange={(e) => setStaffRole(e.target.value)}>
          <option value="ta">Teaching Assistant — attendance, marking, Q&amp;A, roster</option>
          <option value="co_lecturer">Co-Lecturer — full materials, quizzes, CA, and grades</option>
          <option value="external_examiner">External Examiner — read-only scripts, CA &amp; moderation sign-off</option>
        </select>
      </Field>
      <p className="tiny muted">You can assign the same staff member or examiner to multiple courses. They set their own password on first sign-in.</p>
    </Modal>
  );
}
