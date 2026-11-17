import { useMemo, useState } from 'react';
import { run, supabase } from '../lib/supabase.js';
import { normalizeIndexNo } from '../lib/assignmentMeta.js';
import Icon from './Icon.jsx';
import { Field, Modal, useAction, useToast } from './ui.jsx';

function formatNudgeText(tpl, student, courseCode) {
  const fullName = student?.full_name || student?.index_no || 'Student';
  const firstName = fullName.split(/\s+/)[0] || fullName;
  return String(tpl || '')
    .replaceAll('{name}', fullName)
    .replaceAll('{first_name}', firstName)
    .replaceAll('{index_no}', student?.index_no || '')
    .replaceAll('{course}', courseCode || '');
}

export default function BulkNudgeModal({
  courseId,
  courseCode = '',
  title = 'Nudge Students',
  subtitle = '',
  students = [],
  defaultSubject = '',
  defaultMessage = '',
  onClose,
}) {
  const toast = useToast();
  const [act, busy] = useAction();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(() => new Set(students.map((s) => s.index_no).filter(Boolean)));
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [unactivatedList, setUnactivatedList] = useState([]);
  const [sentSummary, setSentSummary] = useState(null);

  const visibleStudents = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return students;
    return students.filter((s) =>
      [s.full_name, s.index_no, s.programme, s.stream].filter(Boolean).join(' ').toLowerCase().includes(term)
    );
  }, [students, q]);

  const studentByIdx = useMemo(
    () => new Map(students.map((s) => [s.index_no, s])),
    [students],
  );

  const toggle = (idx) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAllVisible = () => {
    const allVisSelected = visibleStudents.length > 0 && visibleStudents.every((s) => selected.has(s.index_no));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisSelected) {
        visibleStudents.forEach((s) => next.delete(s.index_no));
      } else {
        visibleStudents.forEach((s) => next.add(s.index_no));
      }
      return next;
    });
  };

  const previewIdx = [...selected][0] || visibleStudents[0]?.index_no;
  const previewStudent = previewIdx ? studentByIdx.get(previewIdx) : null;

  async function sendNudge() {
    if (!subject.trim()) {
      toast('Enter a message subject line.', 'error');
      return;
    }
    if (!message.trim()) {
      toast('Enter a message body.', 'error');
      return;
    }
    if (selected.size === 0) {
      toast('Select at least one student.', 'error');
      return;
    }

    const targetIndexes = [...selected];
    const queryIndexes = [...new Set([
      ...targetIndexes,
      ...targetIndexes.map((idx) => normalizeIndexNo(idx)),
    ].filter(Boolean))];

    const ok = await act(async () => {
      const profiles = await run(
        supabase.from('profiles').select('id, index_no, full_name').in('index_no', queryIndexes)
      );
      const activeByNorm = new Map((profiles || []).map((p) => [normalizeIndexNo(p.index_no), p]));

      const activeTargets = [];
      const missingProfiles = [];
      for (const idx of targetIndexes) {
        const st = studentByIdx.get(idx) || { index_no: idx, full_name: idx };
        const prof = activeByNorm.get(normalizeIndexNo(idx));
        if (prof) activeTargets.push({ profile: prof, student: st });
        else missingProfiles.push(st);
      }

      setUnactivatedList(missingProfiles);

      if (activeTargets.length === 0) {
        setSentSummary({ sent: 0, unactivated: missingProfiles.length });
        return 'none-active';
      }

      const inserts = activeTargets.map(({ profile: prof, student: st }) => ({
        course_id: courseId,
        student_id: prof.id,
        subject: formatNudgeText(subject.trim(), st, courseCode),
        message: formatNudgeText(message.trim(), st, courseCode),
      }));

      for (let i = 0; i < inserts.length; i += 100) {
        await run(supabase.from('course_messages').insert(inserts.slice(i, i + 100)));
      }
      setSentSummary({ sent: inserts.length, unactivated: missingProfiles.length });
      return missingProfiles.length === 0 ? 'all-sent' : 'partial';
    });

    if (ok === 'all-sent') {
      toast(`Reminder sent to ${targetIndexes.length} student${targetIndexes.length === 1 ? '' : 's'} via Course Messages.`);
      onClose();
    } else if (ok === 'partial') {
      toast(`Sent to ${targetIndexes.length - unactivatedList.length} active students. See unactivated index numbers below.`);
    } else if (ok === 'none-active') {
      toast('Selected students have not activated their portal accounts yet — copy their index numbers below.', 'error');
    }
  }

  function copyUnactivated() {
    const text = unactivatedList
      .map((s) => `${s.index_no} - ${s.full_name}${s.programme ? ` (${[s.programme, s.stream].filter(Boolean).join(' · ')})` : ''}`)
      .join('\n');
    navigator.clipboard?.writeText?.(text);
    toast('Copied unactivated list to clipboard.');
  }

  return (
    <Modal
      title={
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="mail" size={18} />
          <span>{title}</span>
        </div>
      }
      onClose={() => !busy && onClose()}
      wide
      footer={
        <div className="between" style={{ width: '100%', flexWrap: 'wrap', gap: 10 }}>
          <span className="small muted">
            {selected.size} of {students.length} student{students.length === 1 ? '' : 's'} selected
          </span>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Close</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={sendNudge}
              disabled={busy || selected.size === 0}
            >
              <Icon name="mail" size={15} />
              {busy ? 'Sending…' : `Send reminder (${selected.size})`}
            </button>
          </div>
        </div>
      }
    >
      <div className="stack">
        {subtitle && <p className="small muted" style={{ margin: 0 }}>{subtitle}</p>}

        {sentSummary && (
          <div className={`notice ${sentSummary.sent > 0 ? 'notice-info' : 'notice-warn'} small`}>
            Sent to <strong>{sentSummary.sent}</strong> activated student{sentSummary.sent === 1 ? '' : 's'} in Course Messages.
            {sentSummary.unactivated > 0 && (
              <> <strong>{sentSummary.unactivated}</strong> student{sentSummary.unactivated === 1 ? ' has' : 's have'} not activated their portal account yet (listed below).</>
            )}
          </div>
        )}

        {unactivatedList.length > 0 && (
          <div className="stack-sm" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--amber-50, #fef3c7)', border: '1px solid var(--amber)' }}>
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <strong className="small">Unactivated portal accounts ({unactivatedList.length}) — reach on WhatsApp/SMS</strong>
              <button type="button" className="btn btn-sm" onClick={copyUnactivated}>
                <Icon name="copy" size={13} /> Copy list
              </button>
            </div>
            <div className="row-wrap" style={{ gap: 6, maxHeight: 110, overflowY: 'auto' }}>
              {unactivatedList.map((s) => (
                <span key={s.index_no} className="badge mono tiny">
                  {s.index_no} · {s.full_name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="two-col" style={{ gridTemplateColumns: 'minmax(240px, 1fr) minmax(260px, 1.25fr)', gap: 16 }}>
          <div className="stack-sm">
            <div className="between" style={{ gap: 6 }}>
              <strong className="small">Recipients ({visibleStudents.length})</strong>
              <button type="button" className="btn btn-sm btn-ghost" onClick={toggleAllVisible}>
                {visibleStudents.length > 0 && visibleStudents.every((s) => selected.has(s.index_no)) ? 'Unselect all' : 'Select all'}
              </button>
            </div>
            {students.length > 6 && (
              <label className="search">
                <span className="sr-only">Filter recipients</span>
                <Icon name="search" size={14} />
                <input
                  className="input"
                  style={{ minHeight: 34, fontSize: 13 }}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name, index, stream…"
                />
              </label>
            )}
            <div className="card-flush" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {visibleStudents.length === 0 ? (
                <div className="small muted" style={{ padding: 12 }}>No matching students.</div>
              ) : (
                visibleStudents.map((s) => {
                  const checked = selected.has(s.index_no);
                  return (
                    <label
                      key={s.index_no}
                      className="list-row"
                      style={{ cursor: 'pointer', padding: '8px 10px', gap: 10 }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(s.index_no)}
                      />
                      <span className="list-main">
                        <span className="small strong">
                          {s.full_name}{' '}
                          {!s.activated && <span className="badge badge-amber" style={{ marginLeft: 4 }}>No account</span>}
                          {s.extraTag && <span className="badge" style={{ marginLeft: 4 }}>{s.extraTag}</span>}
                        </span>
                        <span className="tiny muted mono">
                          {s.index_no}
                          {[s.programme, s.stream].filter(Boolean).length ? ` · ${[s.programme, s.stream].filter(Boolean).join(' · ')}` : ''}
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="stack-sm">
            <Field label="Subject">
              <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field
              label="Message body"
              hint="Placeholders: {name}, {first_name}, {index_no}, {course}"
            >
              <textarea
                className="textarea"
                style={{ minHeight: 155 }}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </Field>
            {previewStudent && (
              <div className="stack-sm" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line-2)' }}>
                <span className="tiny muted">Preview for {previewStudent.full_name} ({previewStudent.index_no}):</span>
                <div className="tiny strong">{formatNudgeText(subject, previewStudent, courseCode)}</div>
                <div className="tiny muted pre" style={{ maxHeight: 70, overflowY: 'auto' }}>
                  {formatNudgeText(message, previewStudent, courseCode)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
