import { getBranding } from './branding.js';
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function baseHtml(title, subtitle, bodyHtml) {
  const generated = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #14212e;
    margin: 0;
    padding: 18px;
    font-size: 11.5px;
    line-height: 1.4;
    background: #fff;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #0e6b63;
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .brand {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #0e6b63;
  }
  h1 {
    margin: 2px 0 2px;
    font-size: 17px;
    font-weight: 700;
    color: #14212e;
  }
  .sub { font-size: 11px; color: #475569; }
  .meta-right { text-align: right; font-size: 10.5px; color: #475569; }
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 14px;
  }
  .kpi {
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 7px 10px;
    background: #f8fafc;
  }
  .kpi .l { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
  .kpi .v { font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  th {
    background: #f1f5f9;
    border-top: 1px solid #94a3b8;
    border-bottom: 1px solid #94a3b8;
    padding: 6px 7px;
    text-align: left;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #334155;
  }
  td {
    border-bottom: 1px solid #e2e8f0;
    padding: 5px 7px;
    vertical-align: middle;
  }
  tr { break-inside: avoid; }
  tr:nth-child(even) td { background: #fafafa; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 10.5px; }
  .badge {
    display: inline-block;
    padding: 1.5px 6px;
    border-radius: 999px;
    font-size: 9.5px;
    font-weight: 600;
  }
  .ok { background: #dcfce7; color: #166534; }
  .warn { background: #fef3c7; color: #92400e; }
  .bad { background: #fee2e2; color: #991b1b; }
  .neutral { background: #e2e8f0; color: #334155; }
  .signoff {
    margin-top: 22px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
    break-inside: avoid;
  }
  .sig-box { border-top: 1px solid #64748b; padding-top: 6px; font-size: 10.5px; color: #334155; }
  .sig-role { font-weight: 700; color: #0f172a; }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <div class="header">
    <div style="display:flex;align-items:center;gap:12px;">
      ${getBranding().logoDataUrl ? `<img src="${getBranding().logoDataUrl}" alt="Crest" style="width:42px;height:42px;object-fit:contain;border-radius:6px;border:1px solid #cbd5e1;padding:2px;" />` : ''}
      <div>
        <div class="brand">${esc(getBranding().portalName)} · ${esc(getBranding().department)}</div>
        <h1>${esc(title)}</h1>
        <div class="sub">${esc(subtitle)}</div>
      </div>
    </div>
    <div class="meta-right">
      <div>Generated: ${esc(generated)}</div>
    </div>
  </div>
  ${bodyHtml}
</body>
</html>`;
}

export function buildAttendanceReportHtml({ course, sessions, students, groupLabelText }) {
  const total = students.length;
  const withSess = students.filter((s) => s.applicable > 0);
  const eligible = withSess.filter((s) => (s.attended / s.applicable) * 100 >= 75).length;
  const below75 = withSess.length - eligible;

  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="l">Students Listed</div><div class="v">${total}</div></div>
      <div class="kpi"><div class="l">Sessions Held</div><div class="v">${sessions.length}</div></div>
      <div class="kpi"><div class="l">Eligible (≥ 75%)</div><div class="v" style="color:#166534">${eligible}</div></div>
      <div class="kpi"><div class="l">Below 75% Threshold</div><div class="v" style="color:${below75 ? '#991b1b' : '#0f172a'}">${below75}</div></div>
    </div>`;

  const rowsHtml = students
    .map((r, i) => {
      const p = r.applicable ? Math.round((r.attended / r.applicable) * 100) : null;
      const cls = p === null ? 'neutral' : p >= 75 ? 'ok' : p >= 50 ? 'warn' : 'bad';
      const status = p === null ? 'No sessions' : p >= 75 ? 'Eligible' : 'Below 75%';
      const grp = [r.programme, r.stream].filter(Boolean).join(' · ') || '—';
      return `<tr>
        <td class="num">${i + 1}</td>
        <td class="mono">${esc(r.index_no)}</td>
        <td><strong>${esc(r.full_name)}</strong></td>
        <td>${esc(grp)}</td>
        <td class="num mono">${r.attended} / ${r.applicable}</td>
        <td class="num mono">${p === null ? '—' : `${p}%`}</td>
        <td><span class="badge ${cls}">${status}</span></td>
      </tr>`;
    })
    .join('');

  const body = `
    ${kpis}
    <table>
      <thead>
        <tr>
          <th class="num" style="width:28px">#</th>
          <th style="width:110px">Index No.</th>
          <th>Student Name</th>
          <th>Programme / Stream</th>
          <th class="num" style="width:82px">Attended</th>
          <th class="num" style="width:55px">Rate</th>
          <th style="width:92px">Status</th>
        </tr>
      </thead>
      <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:#64748b">No students match this filter.</td></tr>'}</tbody>
    </table>
    <div class="signoff">
      <div class="sig-box"><div class="sig-role">Course Lecturer</div><div>Signature &amp; Date: ____________________</div></div>
      <div class="sig-box"><div class="sig-role">Teaching Assistant</div><div>Signature &amp; Date: ____________________</div></div>
      <div class="sig-box"><div class="sig-role">Head of Department</div><div>Signature &amp; Date: ____________________</div></div>
    </div>`;

  const sub = `${course.code} — ${course.title}${course.semester ? ` · ${course.semester}` : ''}${groupLabelText ? ` · Filter: ${groupLabelText}` : ''}`;
  return baseHtml('Course Attendance Register', sub, body);
}

export function buildCAReportHtml({ course, rows, caConfig, dec, getGradeLetter, getGradeRemarks, groupLabelText }) {
  const total = rows.length;
  const caPass = rows.filter((r) => r._totalCa >= 20).length;
  const withExam = rows.filter((r) => r._total100 !== null);
  const avgCa = total ? (rows.reduce((s, r) => s + r._totalCa, 0) / total).toFixed(1) : '—';
  const avgTotal = withExam.length ? (withExam.reduce((s, r) => s + r._total100, 0) / withExam.length).toFixed(1) : '—';

  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="l">Students</div><div class="v">${total}</div></div>
      <div class="kpi"><div class="l">Class CA Avg (/40)</div><div class="v">${avgCa}</div></div>
      <div class="kpi"><div class="l">CA ≥ 20 / 40</div><div class="v" style="color:#166534">${caPass}</div></div>
      <div class="kpi"><div class="l">Final Avg (/100)</div><div class="v">${avgTotal}</div></div>
    </div>`;

  const rowsHtml = rows
    .map((r, i) => {
      const grp = [r.programme, r.stream].filter(Boolean).join(' · ') || '—';
      const grade = r._total100 !== null ? getGradeLetter(r._total100) : r._totalCa >= 20 ? 'Pending' : 'At Risk';
      const remarks = r._total100 !== null ? getGradeRemarks(r._total100) : r._totalCa >= 20 ? 'Awaiting Exam' : 'Below CA Half';
      const cls = grade === 'A' || grade === 'B+' || grade === 'B' ? 'ok' : grade === 'C+' || grade === 'C' || grade === 'D+' || grade === 'D' ? 'warn' : grade === 'Pending' ? 'neutral' : 'bad';
      return `<tr>
        <td class="num">${i + 1}</td>
        <td class="mono">${esc(r.index_no)}</td>
        <td><strong>${esc(r.full_name)}</strong></td>
        <td>${esc(grp)}</td>
        <td class="num mono">${r._ca1.toFixed(dec)}</td>
        <td class="num mono">${r._ca2.toFixed(dec)}</td>
        <td class="num mono"><strong>${r._totalCa.toFixed(dec)}</strong></td>
        <td class="num mono">${r._exam !== null ? r._exam.toFixed(dec) : '—'}</td>
        <td class="num mono"><strong>${r._total100 !== null ? r._total100.toFixed(dec) : '—'}</strong></td>
        <td><span class="badge ${cls}">${esc(grade)}</span></td>
        <td>${esc(remarks)}</td>
      </tr>`;
    })
    .join('');

  const w1 = caConfig?.ca1_weight || 20;
  const w2 = caConfig?.ca2_weight || 20;
  const body = `
    ${kpis}
    <table>
      <thead>
        <tr>
          <th class="num" style="width:26px">#</th>
          <th style="width:96px">Index No.</th>
          <th>Student Name</th>
          <th>Programme / Stream</th>
          <th class="num">CA 1<br/>/${w1}</th>
          <th class="num">CA 2<br/>/${w2}</th>
          <th class="num">Total CA<br/>/40</th>
          <th class="num">Exam<br/>/60</th>
          <th class="num">Total<br/>/100</th>
          <th>Grade</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody>${rowsHtml || '<tr><td colspan="11" style="text-align:center;color:#64748b">No students match this filter.</td></tr>'}</tbody>
    </table>
    <div class="signoff">
      <div class="sig-box"><div class="sig-role">Course Lecturer</div><div>Signature &amp; Date: ____________________</div></div>
      <div class="sig-box"><div class="sig-role">Internal Moderator / HOD</div><div>Signature &amp; Date: ____________________</div></div>
      <div class="sig-box"><div class="sig-role">Examinations Officer</div><div>Signature &amp; Date: ____________________</div></div>
    </div>`;

  const sub = `${course.code} — ${course.title}${course.semester ? ` · ${course.semester}` : ''}${groupLabelText ? ` · Filter: ${groupLabelText}` : ''}`;
  return baseHtml('Continuous Assessment & Final Examination Sign-Off Sheet', sub, body);
}

export function buildStudentSummaryHtml({
  course,
  student,
  attRow,
  quizzes = [],
  attempts = [],
  assignments = [],
  submissions = [],
  caSummary = null,
  materialStats = null,
}) {
  const attPct = attRow?.applicable ? Math.round((attRow.attended / attRow.applicable) * 100) : null;
  const attCls = attPct === null ? 'neutral' : attPct >= 75 ? 'ok' : attPct >= 50 ? 'warn' : 'bad';
  const grp = [student.programme, student.stream].filter(Boolean).join(' · ') || '—';

  const kpis = `
    <div class="kpis">
      <div class="kpi"><div class="l">Index No.</div><div class="v mono" style="font-size:13px">${esc(student.index_no)}</div></div>
      <div class="kpi"><div class="l">Programme / Stream</div><div class="v" style="font-size:12px">${esc(grp)}</div></div>
      <div class="kpi"><div class="l">Attendance</div><div class="v" style="color:${attPct !== null && attPct >= 75 ? '#166534' : attPct !== null && attPct < 50 ? '#991b1b' : '#0f172a'}">${attPct !== null ? `${attPct}% (${attRow.attended}/${attRow.applicable})` : '—'}</div></div>
      <div class="kpi"><div class="l">${caSummary ? 'Total CA / 40' : 'Account'}</div><div class="v">${caSummary ? `${caSummary.totalCa.toFixed(caSummary.dec)} / 40` : (student.activated ? 'Activated' : 'Not Activated')}</div></div>
    </div>`;

  const caBlock = caSummary ? `
    <h3 style="margin:12px 0 6px;font-size:12px;text-transform:uppercase;color:#334155">Continuous Assessment &amp; Exam Standing</h3>
    <table>
      <thead>
        <tr>
          <th class="num">CA 1</th>
          <th class="num">CA 2</th>
          <th class="num">Total CA / 40</th>
          <th class="num">Exam / 60</th>
          <th class="num">Final Total / 100</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="num mono">${caSummary.ca1.toFixed(caSummary.dec)}</td>
          <td class="num mono">${caSummary.ca2.toFixed(caSummary.dec)}</td>
          <td class="num mono"><strong>${caSummary.totalCa.toFixed(caSummary.dec)}</strong></td>
          <td class="num mono">${caSummary.exam !== null ? caSummary.exam.toFixed(caSummary.dec) : '—'}</td>
          <td class="num mono"><strong>${caSummary.total100 !== null ? caSummary.total100.toFixed(caSummary.dec) : '—'}</strong></td>
        </tr>
      </tbody>
    </table>` : '';

  const matBlock = materialStats ? `
    <div style="margin:8px 0 12px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;font-size:11px">
      <strong>Course Materials Engagement:</strong>
      Opened <strong>${materialStats.viewed_count}</strong> of <strong>${materialStats.total_materials}</strong> posted materials
      (${materialStats.total_opens} total file opens).
    </div>` : '';

  const quizRows = quizzes.map((q) => {
    const mine = attempts.filter((a) => a.quiz_id === q.id);
    const best = mine.reduce((b, x) => (!b || (x.score ?? -1) > (b.score ?? -1) ? x : b), null);
    const p = best && best.score !== null && best.max_score ? Math.round((best.score / best.max_score) * 100) : null;
    const statusText = best ? (best.status === 'marked' ? 'Marked' : best.status === 'needs_marking' ? 'Needs marking' : 'In progress') : 'Not attempted';
    const cls = p === null ? 'neutral' : p >= 70 ? 'ok' : p >= 50 ? 'warn' : 'bad';
    return `<tr>
      <td><strong>${esc(q.title)}</strong>${q.is_practice ? ' <span class="badge neutral">Practice</span>' : ''}</td>
      <td class="num mono">${mine.length}</td>
      <td class="num mono">${best && best.score !== null ? `${best.score} / ${best.max_score}` : '—'}</td>
      <td class="num mono">${p !== null ? `${p}%` : '—'}</td>
      <td class="num mono">${best ? best.exits || 0 : '—'}</td>
      <td><span class="badge ${cls}">${esc(statusText)}</span></td>
    </tr>`;
  }).join('');

  const assignRows = assignments.map((a) => {
    const sub = submissions.find((s) => s.assignment_id === a.id);
    const cls = !sub ? 'bad' : sub.marks !== null ? 'ok' : 'warn';
    const st = !sub ? 'Missing' : sub.marks !== null ? 'Marked' : sub.is_late ? 'Submitted late' : 'Submitted';
    return `<tr>
      <td><strong>${esc(a.title)}</strong></td>
      <td class="num mono">${sub && sub.marks !== null ? `${sub.marks} / ${a.max_marks}` : `— / ${a.max_marks}`}</td>
      <td><span class="badge ${cls}">${esc(st)}</span></td>
      <td>${esc(sub?.feedback || '—')}</td>
    </tr>`;
  }).join('');

  const body = `
    ${kpis}
    ${caBlock}
    ${matBlock}
    <h3 style="margin:12px 0 6px;font-size:12px;text-transform:uppercase;color:#334155">Quizzes (${quizzes.length})</h3>
    <table>
      <thead>
        <tr>
          <th>Quiz Title</th>
          <th class="num" style="width:70px">Attempts</th>
          <th class="num" style="width:90px">Best Score</th>
          <th class="num" style="width:55px">%</th>
          <th class="num" style="width:55px">Exits</th>
          <th style="width:100px">Status</th>
        </tr>
      </thead>
      <tbody>${quizRows || '<tr><td colspan="6" style="text-align:center;color:#64748b">No quizzes in this course yet.</td></tr>'}</tbody>
    </table>
    <h3 style="margin:12px 0 6px;font-size:12px;text-transform:uppercase;color:#334155">Assignments (${assignments.length})</h3>
    <table>
      <thead>
        <tr>
          <th>Assignment</th>
          <th class="num" style="width:90px">Marks</th>
          <th style="width:105px">Status</th>
          <th>Feedback</th>
        </tr>
      </thead>
      <tbody>${assignRows || '<tr><td colspan="4" style="text-align:center;color:#64748b">No assignments in this course yet.</td></tr>'}</tbody>
    </table>
    <div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:#475569">
      <span>Attendance standing: <span class="badge ${attCls}">${attPct !== null ? `${attPct}%` : 'No sessions'}</span></span>
      <span>Signed (Lecturer / Coordinator): _______________________________</span>
    </div>
  `;

  const sub = `${student.full_name} (${student.index_no}) · ${course.code} — ${course.title}${course.semester ? ` · ${course.semester}` : ''}`;
  return baseHtml('Individual Student Academic Record', sub, body);
}
