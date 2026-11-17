import { useEffect, useMemo, useState } from 'react';
import { rpc, rpcAll } from '../lib/supabase.js';
import { fmtDateTime, fromLocalInput, toLocalInput } from '../lib/format.js';
import { downloadWorkbook } from '../lib/sheets.js';
import { compareText, byNameIndex } from '../lib/sort.js';
import Icon from './Icon.jsx';
import { ALL_GROUPS, GroupFilters, matchesGroup } from './Groups.jsx';
import PrintReportModal from './PrintReportModal.jsx';
import { Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from './ui.jsx';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPerHallSignInHtml({ course, title, examDate, assignments }) {
  const byRoom = new Map();
  for (const a of assignments) {
    if (!byRoom.has(a.room_name)) byRoom.set(a.room_name, []);
    byRoom.get(a.room_name).push(a);
  }
  const generated = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const roomsHtml = [...byRoom.entries()].map(([room, list], idx) => `
    <section class="hall-page" style="${idx > 0 ? 'page-break-before: always;' : ''}">
      <div class="header">
        <div>
          <div class="brand">PSCM E-Class · Invigilator Hall Verification &amp; Sign-In Sheet</div>
          <h1>${esc(course.code)} · ${esc(title)} — ${esc(room)}</h1>
          <div class="sub">${esc(course.title)}${examDate ? ` · Exam: ${esc(fmtDateTime(examDate))}` : ''} · ${list.length} assigned candidate${list.length === 1 ? '' : 's'}</div>
        </div>
        <div class="meta-right">Generated ${esc(generated)}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:52px">Seat</th>
            <th style="width:120px">Index Number</th>
            <th>Candidate Name</th>
            <th style="width:160px">Programme / Stream</th>
            <th style="width:95px">Booklet No.</th>
            <th style="width:120px">Signature</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((s) => `
            <tr>
              <td class="mono strong">${s.seat_no}</td>
              <td class="mono">${esc(s.index_no)}</td>
              <td>${esc(s.full_name)}</td>
              <td>${esc([s.programme, s.stream].filter(Boolean).join(' · ') || '—')}</td>
              <td></td>
              <td></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="footer-sign">
        <span>Invigilator Name: ______________________________</span>
        <span>Signature: ______________________</span>
        <span>Date: ____________</span>
      </div>
    </section>
  `).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${esc(course.code)} Exam Seating</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, sans-serif; color: #14212e; margin: 0; padding: 14px; font-size: 11px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0e6b63; padding-bottom: 8px; margin-bottom: 12px; }
    .brand { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #0e6b63; }
    h1 { margin: 2px 0; font-size: 15px; }
    .sub { font-size: 10.5px; color: #475569; }
    .meta-right { font-size: 10px; color: #475569; text-align: right; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 7px; text-align: left; }
    th { background: #f1f5f9; font-size: 9.5px; text-transform: uppercase; color: #334155; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .strong { font-weight: 700; }
    .footer-sign { display: flex; justify-content: space-between; font-size: 10.5px; margin-top: 18px; color: #334155; }
  </style></head><body>${roomsHtml}</body></html>`;
}

export default function ExamSeatingModal({ course, quiz = null, onClose }) {
  const toast = useToast();
  const [act, busy] = useAction();

  const { data, error, loading, reload } = useLoad(async () => {
    const [students, plans] = await Promise.all([
      rpcAll('course_students', { p_course: course.id }),
      rpc('course_exam_seating', { p_course: course.id }).catch(() => []),
    ]);
    return {
      students: students || [],
      plans: Array.isArray(plans) ? plans : [],
    };
  }, [course.id]);

  const matchingPlan = useMemo(() => {
    const list = data?.plans || [];
    if (quiz) return list.find((p) => p.quiz_id === quiz.id) || null;
    return list.find((p) => !p.quiz_id) || list[0] || null;
  }, [data?.plans, quiz]);

  const [planId, setPlanId] = useState(null);
  const [title, setTitle] = useState(quiz ? `${quiz.title} — Seating` : `${course.code} Examination Seating`);
  const [examDate, setExamDate] = useState(quiz?.opens_at ? toLocalInput(quiz.opens_at) : '');
  const [rooms, setRooms] = useState([{ name: 'PSCM Main Hall A', capacity: 80 }, { name: 'Auditorium B', capacity: 120 }]);
  const [sortMode, setSortMode] = useState('index');
  const [published, setPublished] = useState(false);
  const [group, setGroup] = useState(ALL_GROUPS);
  const [assignments, setAssignments] = useState([]);
  const [printingHtml, setPrintingHtml] = useState('');

  useEffect(() => {
    if (!matchingPlan) return;
    setPlanId(matchingPlan.id);
    setTitle(matchingPlan.title || (quiz ? `${quiz.title} — Seating` : `${course.code} Examination Seating`));
    setExamDate(matchingPlan.exam_date ? toLocalInput(matchingPlan.exam_date) : '');
    if (Array.isArray(matchingPlan.rooms) && matchingPlan.rooms.length) {
      setRooms(matchingPlan.rooms.map((r) => ({ name: r.name || 'Hall', capacity: Number(r.capacity) || 50 })));
    }
    setSortMode(matchingPlan.sort_mode || 'index');
    setPublished(Boolean(matchingPlan.published));
    setAssignments(Array.isArray(matchingPlan.assignments) ? matchingPlan.assignments : []);
  }, [matchingPlan, quiz, course.code]);

  const eligibleStudents = useMemo(
    () => (data?.students || []).filter((s) => matchesGroup(s, group)),
    [data?.students, group],
  );

  const totalCapacity = useMemo(
    () => rooms.reduce((sum, r) => sum + Math.max(0, Number(r.capacity) || 0), 0),
    [rooms],
  );

  const roomBreakdown = useMemo(() => {
    const map = new Map();
    for (const a of assignments) {
      if (!map.has(a.room_name)) map.set(a.room_name, []);
      map.get(a.room_name).push(a);
    }
    return [...map.entries()];
  }, [assignments]);

  function updateRoom(idx, key, val) {
    setRooms((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: val } : r)));
  }

  function autoAssign() {
    const cleanRooms = rooms
      .map((r) => ({ name: String(r.name || '').trim(), capacity: Math.max(1, parseInt(r.capacity, 10) || 0) }))
      .filter((r) => r.name && r.capacity > 0);
    if (!cleanRooms.length) {
      toast('Add at least one exam room with capacity > 0.', 'error');
      return;
    }
    if (!eligibleStudents.length) {
      toast('No enrolled students match the current filter.', 'error');
      return;
    }
    const sorted = [...eligibleStudents].sort((a, b) => {
      if (sortMode === 'name') return byNameIndex(a, b);
      if (sortMode === 'class_index') {
        return compareText(a.programme, b.programme, 'asc')
          || compareText(a.stream, b.stream, 'asc')
          || compareText(a.index_no, b.index_no, 'asc');
      }
      return compareText(a.index_no, b.index_no, 'asc') || byNameIndex(a, b);
    });

    const allocated = [];
    let cursor = 0;
    for (const rm of cleanRooms) {
      for (let seat = 1; seat <= rm.capacity && cursor < sorted.length; seat += 1) {
        const s = sorted[cursor++];
        allocated.push({
          index_no: s.index_no,
          full_name: s.full_name || '',
          programme: s.programme || '',
          stream: s.stream || '',
          room_name: rm.name,
          seat_no: seat,
        });
      }
    }
    setAssignments(allocated);
    if (cursor < sorted.length) {
      toast(`Assigned ${cursor} students, but ${sorted.length - cursor} still need seats — increase hall capacity.`, 'error');
    } else {
      toast(`Assigned all ${allocated.length} candidates across ${cleanRooms.length} room${cleanRooms.length === 1 ? '' : 's'}.`);
    }
  }

  async function savePlan(publishOverride = published) {
    if (!assignments.length) {
      toast('Click "Auto-Assign Seats" first to allocate candidates.', 'error');
      return;
    }
    const cleanRooms = rooms
      .map((r) => ({ name: String(r.name || '').trim(), capacity: Math.max(1, parseInt(r.capacity, 10) || 0) }))
      .filter((r) => r.name);
    const id = await act(
      () => rpc('save_exam_seating_plan', {
        p_course: course.id,
        p_quiz: quiz?.id || null,
        p_title: title.trim() || 'Exam Seating',
        p_exam_date: examDate ? fromLocalInput(examDate) : null,
        p_rooms: cleanRooms,
        p_sort_mode: sortMode,
        p_published: publishOverride,
        p_assignments: assignments,
        p_plan_id: planId,
      }),
      publishOverride ? 'Exam seating saved & published to students.' : 'Exam seating saved as draft.',
    );
    if (id) {
      setPlanId(id);
      setPublished(publishOverride);
      reload();
    }
  }

  function exportExcel() {
    if (!assignments.length) return;
    const sheets = [
      {
        name: 'All Candidates',
        rows: [
          ['Room', 'Seat #', 'Index Number', 'Full Name', 'Programme', 'Stream'],
          ...assignments.map((a) => [a.room_name, a.seat_no, a.index_no, a.full_name, a.programme, a.stream]),
        ],
        widths: [20, 9, 16, 28, 18, 12],
      },
      ...roomBreakdown.map(([rm, list]) => ({
        name: rm.slice(0, 28),
        rows: [
          ['Seat #', 'Index Number', 'Full Name', 'Programme', 'Stream', 'Booklet No.', 'Signature'],
          ...list.map((a) => [a.seat_no, a.index_no, a.full_name, a.programme, a.stream, '', '']),
        ],
        widths: [9, 16, 28, 18, 12, 14, 18],
      })),
    ];
    downloadWorkbook(`${course.code}_Exam_Seating.xlsx`, sheets);
  }

  return (
    <>
      <Modal
        wide
        title={`Exam Hall & Seat Allocator · ${quiz ? quiz.title : course.code}`}
        onClose={onClose}
        footer={
          <div className="between" style={{ width: '100%', flexWrap: 'wrap', gap: 8 }}>
            <div className="row-wrap" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!assignments.length}
                onClick={() => setPrintingHtml(buildPerHallSignInHtml({
                  course,
                  title,
                  examDate: examDate ? fromLocalInput(examDate) : null,
                  assignments,
                }))}
              >
                <Icon name="printer" size={15} /> Print Hall Sign-In Sheets
              </button>
              <button type="button" className="btn btn-sm" disabled={!assignments.length} onClick={exportExcel}>
                <Icon name="download" size={15} /> Excel
              </button>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={onClose}>Close</button>
              <button type="button" className="btn" disabled={busy || !assignments.length} onClick={() => savePlan(false)}>
                Save Draft
              </button>
              <button type="button" className="btn btn-primary" disabled={busy || !assignments.length} onClick={() => savePlan(true)}>
                {busy ? 'Saving…' : published ? 'Update & Keep Published' : 'Save & Publish to Students'}
              </button>
            </div>
          </div>
        }
      >
        {loading && <Loading />}
        {error && <ErrorNote error={error} onRetry={reload} />}
        {!loading && !error && (
          <div className="stack">
            <div className="grid-2">
              <Field label="Exam / Seating Title">
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Exam Date & Time" hint="optional">
                <input className="input" type="datetime-local" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
              </Field>
            </div>

            <div className="card-soft stack-sm" style={{ padding: 14 }}>
              <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong className="small">Exam Halls / Rooms</strong>
                  <span className="tiny muted" style={{ marginLeft: 8 }}>
                    Total capacity: <strong className={totalCapacity < eligibleStudents.length ? 'text-red' : ''}>{totalCapacity}</strong> seats vs <strong>{eligibleStudents.length}</strong> candidates
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setRooms((prev) => [...prev, { name: `Hall ${String.fromCharCode(65 + prev.length)}`, capacity: 60 }])}
                >
                  <Icon name="plus" size={14} /> Add room
                </button>
              </div>
              <div className="stack-sm" style={{ gap: 8 }}>
                {rooms.map((rm, idx) => (
                  <div key={idx} className="row" style={{ gap: 8 }}>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      value={rm.name}
                      onChange={(e) => updateRoom(idx, 'name', e.target.value)}
                      placeholder="Room name (e.g. PSCM Hall A)"
                    />
                    <input
                      className="input mono"
                      style={{ width: 100 }}
                      type="number"
                      min="1"
                      value={rm.capacity}
                      onChange={(e) => updateRoom(idx, 'capacity', e.target.value)}
                      placeholder="Seats"
                    />
                    {rooms.length > 1 && (
                      <button type="button" className="icon-btn plain" onClick={() => setRooms((prev) => prev.filter((_, i) => i !== idx))}>
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div className="row-wrap" style={{ gap: 8 }}>
                <GroupFilters rows={data.students} value={group} onChange={setGroup} />
                <select className="select" style={{ width: 'auto', minHeight: 38, fontSize: 13 }} value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                  <option value="index">Order: Index number</option>
                  <option value="name">Order: Alphabetical name</option>
                  <option value="class_index">Order: Programme / Stream, then Index</option>
                </select>
              </div>
              <button type="button" className="btn btn-dark" onClick={autoAssign}>
                <Icon name="grid" size={15} /> Auto-Assign Seats ({eligibleStudents.length})
              </button>
            </div>

            {assignments.length === 0 ? (
              <Empty icon="grid" title="No seats assigned yet">
                Configure your exam halls above and click <strong>Auto-Assign Seats</strong> to generate seat numbers and printable invigilator sheets.
              </Empty>
            ) : (
              <div className="stack-sm">
                <div className="row-wrap" style={{ gap: 8 }}>
                  {roomBreakdown.map(([rm, list]) => (
                    <span key={rm} className="badge badge-teal">
                      {rm}: Seats 1–{list.length} ({list[0]?.index_no} → {list[list.length - 1]?.index_no})
                    </span>
                  ))}
                  {published && <span className="badge badge-blue">Visible to students</span>}
                </div>
                <div className="table-wrap card-flush" style={{ maxHeight: '34vh', overflowY: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr><th>Room</th><th className="num">Seat</th><th>Index No.</th><th>Name</th><th className="hide-sm">Class</th></tr>
                    </thead>
                    <tbody>
                      {assignments.slice(0, 300).map((a) => (
                        <tr key={`${a.room_name}-${a.seat_no}-${a.index_no}`}>
                          <td className="strong small">{a.room_name}</td>
                          <td className="num mono strong">{a.seat_no}</td>
                          <td className="mono small">{a.index_no}</td>
                          <td className="small">{a.full_name}</td>
                          <td className="tiny muted hide-sm">{[a.programme, a.stream].filter(Boolean).join(' · ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
      {printingHtml && (
        <PrintReportModal
          title={`Invigilator Hall Sign-In Sheets · ${course.code}`}
          html={printingHtml}
          onClose={() => setPrintingHtml('')}
        />
      )}
    </>
  );
}
