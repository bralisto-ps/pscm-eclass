import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cloneCourse } from '../lib/cloneCourse.js';
import { COURSE_COLORS, contrastWithWhite } from '../lib/format.js';
import Icon from './Icon.jsx';
import { Field, Modal, useToast } from './ui.jsx';

export default function CloneCourseModal({ sourceCourse, courses = [], onClose, onCloned }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState(sourceCourse?.id || courses[0]?.id || '');
  const src = sourceCourse || courses.find((c) => c.id === selectedId) || courses[0];

  const [code, setCode] = useState(() => (src ? `${src.code} (NEW)` : ''));
  const [title, setTitle] = useState(() => src?.title || '');
  const [semester, setSemester] = useState('');
  const [color, setColor] = useState(() => src?.color || COURSE_COLORS[0]);
  const [includeMaterials, setIncludeMaterials] = useState(true);
  const [includeQuizzes, setIncludeQuizzes] = useState(true);
  const [includeAssignments, setIncludeAssignments] = useState(true);
  const [includeCA, setIncludeCA] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function pickSource(id) {
    setSelectedId(id);
    const next = courses.find((c) => c.id === id);
    if (next) {
      setCode(`${next.code} (NEW)`);
      setTitle(next.title);
      setColor(next.color || COURSE_COLORS[0]);
    }
  }

  const tooLight = contrastWithWhite(color) < 4.5;

  async function submit(e) {
    e?.preventDefault();
    if (!src) return;
    setError('');
    if (!code.trim() || !title.trim()) return setError('Enter both a new course code and course title.');
    if (code.trim().toUpperCase() === src.code.toUpperCase()) {
      return setError('Use a new unique course code (for example, append the year or semester like "SCM 201 · 2026").');
    }
    setBusy(true);
    try {
      const created = await cloneCourse({
        sourceCourse: src,
        code,
        title,
        semester,
        color,
        includeMaterials,
        includeQuizzes,
        includeAssignments,
        includeCA,
      });
      toast(`Course cloned as ${created.code}.`);
      onClose?.();
      if (onCloned) onCloned(created);
      else navigate(`/teach/course/${created.id}`);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Clone course for new semester"
      onClose={() => !busy && onClose?.()}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !src || tooLight}>
            <Icon name="layers" size={16} />
            {busy ? 'Cloning course…' : 'Create Cloned Course'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="stack">
        <div className="notice notice-info small">
          Creates a clean course shell for the new semester. Old student enrollments, quiz attempts, submissions, grades, attendance, and messages are <strong>not</strong> copied. Quizzes and assignments start unpublished.
        </div>

        {!sourceCourse && courses.length > 0 && (
          <Field label="Course to clone">
            <select className="select" value={selectedId} onChange={(e) => pickSource(e.target.value)}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.title}{c.semester ? ` (${c.semester})` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid-2">
          <Field label="New course code *" hint="must be unique">
            <input
              className="input mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. SCM 101 (2026)"
              required
              autoFocus
            />
          </Field>
          <Field label="Semester / Term">
            <input
              className="input"
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              placeholder="e.g. Sem 2 · 2025/2026"
            />
          </Field>
        </div>

        <Field label="Course title *">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>

        <Field label="Course colour">
          <div className="row-wrap" style={{ gap: 8 }}>
            {COURSE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: color === c ? '3px solid var(--ink)' : '1px solid rgba(0,0,0,0.15)',
                  background: c,
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
          {tooLight && <span className="tiny" style={{ color: 'var(--red-ink)' }}>Pick a darker colour for readable white text.</span>}
        </Field>

        <div className="stack-sm">
          <span className="field-label">What to copy from {src?.code}</span>
          <label className="check">
            <input type="checkbox" checked={includeMaterials} onChange={(e) => setIncludeMaterials(e.target.checked)} />
            <span>Weekly modules &amp; learning materials (PDFs, slides, links)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={includeQuizzes} onChange={(e) => setIncludeQuizzes(e.target.checked)} />
            <span>Quizzes &amp; full question bank (copied as unpublished drafts)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={includeAssignments} onChange={(e) => setIncludeAssignments(e.target.checked)} />
            <span>Assignments (copied as unpublished drafts)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={includeCA} onChange={(e) => setIncludeCA(e.target.checked)} />
            <span>Continuous Assessment (CA 1 &amp; CA 2) component structure</span>
          </label>
        </div>

        {error && <div className="notice notice-error">{error}</div>}
      </form>
    </Modal>
  );
}
