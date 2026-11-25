import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import Icon from './Icon.jsx';

export default function QuickJumpModal({ courses = [], isStaff, onClose }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [items, setItems] = useState({ quizzes: [], assignments: [], materials: [], students: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    const courseIds = courses.map((c) => c.id);
    if (!courseIds.length) {
      setLoading(false);
      return;
    }
    Promise.all([
      supabase.from('quizzes').select('id, title, course_id, published').in('course_id', courseIds).limit(60),
      supabase.from('assignments').select('id, title, course_id, published').in('course_id', courseIds).limit(60),
      supabase.from('materials').select('id, title, course_id, kind').in('course_id', courseIds).limit(80),
      isStaff
        ? supabase.from('enrollments').select('course_id, index_no, roster(full_name)').in('course_id', courseIds).limit(300)
        : Promise.resolve({ data: [] }),
    ])
      .then(([qz, asg, mat, enr]) => {
        if (!alive) return;
        setItems({
          quizzes: qz?.data || [],
          assignments: asg?.data || [],
          materials: mat?.data || [],
          students: enr?.data || [],
        });
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [courses, isStaff]);

  const courseMap = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = [];
    const base = (cId) => (isStaff ? `/teach/course/${cId}` : `/course/${cId}`);
    if (isStaff && (!term || 'software labs tqm spc pareto fishbone cost of quality'.includes(term))) {
      out.push({
        key: 'labs-hub',
        kind: 'Labs',
        icon: 'flask',
        title: 'Software Labs Hub',
        sub: 'SPC, 7 Tools of Quality, Cost of Quality — assign to classes',
        to: '/teach/labs',
      });
    }

    for (const c of courses) {
      const hay = `${c.code} ${c.title}`.toLowerCase();
      if (!term || hay.includes(term)) {
        out.push({
          key: `c-${c.id}`,
          kind: 'Course',
          icon: 'book',
          color: c.color,
          title: `${c.code} — ${c.title}`,
          sub: isStaff ? 'Manage course' : 'Open course',
          to: base(c.id),
        });
      }
    }

    if (term.length >= 1) {
      for (const qz of items.quizzes) {
        if (!isStaff && !qz.published) continue;
        const c = courseMap.get(qz.course_id);
        if (!c) continue;
        if (`${qz.title} ${c.code}`.toLowerCase().includes(term)) {
          out.push({
            key: `q-${qz.id}`,
            kind: 'Quiz',
            icon: 'quiz',
            color: c.color,
            title: qz.title,
            sub: `${c.code} · ${isStaff ? 'Results & gradebook' : 'Quizzes tab'}`,
            to: isStaff ? `/teach/quiz/${qz.id}/results` : `${base(c.id)}?tab=quizzes`,
          });
        }
      }

      for (const a of items.assignments) {
        if (!isStaff && !a.published) continue;
        const c = courseMap.get(a.course_id);
        if (!c) continue;
        if (`${a.title} ${c.code}`.toLowerCase().includes(term)) {
          out.push({
            key: `a-${a.id}`,
            kind: 'Assignment',
            icon: 'clipboard',
            color: c.color,
            title: a.title,
            sub: `${c.code} · ${isStaff ? 'Marking' : 'Assignments tab'}`,
            to: isStaff ? `/teach/assignment/${a.id}` : `${base(c.id)}?tab=assignments`,
          });
        }
      }

      for (const m of items.materials) {
        const c = courseMap.get(m.course_id);
        if (!c) continue;
        if (`${m.title} ${c.code}`.toLowerCase().includes(term)) {
          out.push({
            key: `m-${m.id}`,
            kind: 'Material',
            icon: 'file',
            color: c.color,
            title: m.title,
            sub: `${c.code} · Materials`,
            to: `${base(c.id)}?tab=materials`,
          });
        }
      }

      if (isStaff && term.length >= 2) {
        for (const s of items.students) {
          const name = s.roster?.full_name || '';
          const c = courseMap.get(s.course_id);
          if (!c) continue;
          if (`${s.index_no} ${name}`.toLowerCase().includes(term)) {
            out.push({
              key: `s-${s.course_id}-${s.index_no}`,
              kind: 'Student',
              icon: 'user',
              color: c.color,
              title: `${name || s.index_no} (${s.index_no})`,
              sub: `${c.code} · Class list`,
              to: `${base(c.id)}?tab=students`,
            });
          }
        }
      }
    }

    return out.slice(0, 14);
  }, [q, courses, items, courseMap, isStaff]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  function pick(item) {
    if (!item) return;
    onClose();
    navigate(item.to);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      pick(results[active]);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quick-jump" role="dialog" aria-modal="true" aria-label="Quick search">
        <div className="quick-jump-head">
          <Icon name="search" size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="quick-jump-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isStaff ? 'Jump to course, quiz, material, or student index…' : 'Jump to course, quiz, assignment, or material…'}
          />
          <button type="button" className="icon-btn plain" aria-label="Close search" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="quick-jump-list">
          {loading && !results.length && <div className="small muted" style={{ padding: 18 }}>Loading courses…</div>}
          {!loading && results.length === 0 && (
            <div className="small muted" style={{ padding: 20, textAlign: 'center' }}>
              No matches for “{q}”. Try a course code, quiz title{isStaff ? ', or index number' : ''}.
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={r.key}
              type="button"
              className={`quick-jump-row ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r)}
            >
              <span className="quick-jump-ico" style={{ background: r.color || 'var(--teal)' }}>
                <Icon name={r.icon} size={15} />
              </span>
              <span className="list-main">
                <span className="title">{r.title}</span>
                <span className="tiny muted">{r.sub}</span>
              </span>
              <span className="tiny muted nowrap">{r.kind}</span>
            </button>
          ))}
        </div>

        <div className="quick-jump-foot tiny muted">
          <span>Use ↑ ↓ to move · Enter to open · Esc to close</span>
        </div>
      </div>
    </div>
  );
}
