// Pure, zero-dependency engine for the PSCM E-Class Thesis & Dissertation Supervision Portal.

export const DEGREE_LEVELS = ['HND', 'BSc', 'BBA', 'MSc', 'MBA', 'MPhil', 'PhD'];

export const MILESTONE_TEMPLATES = {
  undergrad: [
    { stage_key: 'proposal', title: 'Topic Proposal & Synopsis', sort_order: 1 },
    { stage_key: 'chapter_1', title: 'Chapter 1: Introduction & Background', sort_order: 2 },
    { stage_key: 'chapter_2', title: 'Chapter 2: Literature Review', sort_order: 3 },
    { stage_key: 'chapter_3', title: 'Chapter 3: Research Methodology', sort_order: 4 },
    { stage_key: 'chapter_4', title: 'Chapter 4: Data Analysis & Findings', sort_order: 5 },
    { stage_key: 'chapter_5', title: 'Chapter 5: Conclusions & Recommendations', sort_order: 6 },
    { stage_key: 'final_draft', title: 'Full Draft & Plagiarism Clearance', sort_order: 7 },
  ],
  masters: [
    { stage_key: 'proposal', title: 'Research Proposal & Objectives', sort_order: 1 },
    { stage_key: 'ethics', title: 'Instrument & Ethics Approval', sort_order: 2 },
    { stage_key: 'chapter_1', title: 'Chapter 1: Introduction', sort_order: 3 },
    { stage_key: 'chapter_2', title: 'Chapter 2: Literature & Conceptual Framework', sort_order: 4 },
    { stage_key: 'chapter_3', title: 'Chapter 3: Methodology & Sampling', sort_order: 5 },
    { stage_key: 'chapter_4', title: 'Chapter 4: Empirical Analysis & Discussion', sort_order: 6 },
    { stage_key: 'chapter_5', title: 'Chapter 5: Contributions & Recommendations', sort_order: 7 },
    { stage_key: 'final_draft', title: 'Full Dissertation & Viva Readiness', sort_order: 8 },
  ],
  doctoral: [
    { stage_key: 'concept', title: 'Concept Note & Research Gap', sort_order: 1 },
    { stage_key: 'proposal_defence', title: 'Proposal & Confirmation Defence', sort_order: 2 },
    { stage_key: 'ethics_field', title: 'Ethics Clearance & Fieldwork Protocol', sort_order: 3 },
    { stage_key: 'lit_review', title: 'Systematic Literature & Theory Chapter', sort_order: 4 },
    { stage_key: 'methodology', title: 'Research Design & Methodology Chapter', sort_order: 5 },
    { stage_key: 'findings', title: 'Empirical Findings & Modelling', sort_order: 6 },
    { stage_key: 'discussion', title: 'Discussion & Theoretical Contributions', sort_order: 7 },
    { stage_key: 'full_thesis', title: 'Complete Thesis Submission', sort_order: 8 },
    { stage_key: 'viva_corrections', title: 'Viva Voce & Post-Defence Corrections', sort_order: 9 },
  ],
};

export function getMilestonesForDegree(degreeLevel = 'BSc') {
  const lvl = String(degreeLevel || 'BSc').toUpperCase();
  if (lvl === 'PHD') return MILESTONE_TEMPLATES.doctoral.map((m) => ({ ...m }));
  if (lvl === 'MSC' || lvl === 'MBA' || lvl === 'MPHIL') {
    return MILESTONE_TEMPLATES.masters.map((m) => ({ ...m }));
  }
  return MILESTONE_TEMPLATES.undergrad.map((m) => ({ ...m }));
}

export const MILESTONE_STATUS_META = {
  not_started: { label: 'Not Started', cls: 'badge-muted', color: '#64748b' },
  submitted: { label: 'Needs Review', cls: 'badge-amber', color: '#d97706' },
  under_review: { label: 'Under Review', cls: 'badge-blue', color: '#2563eb' },
  revisions_requested: { label: 'Revisions Needed', cls: 'badge-red', color: '#dc2626' },
  approved: { label: 'Approved', cls: 'badge-teal', color: '#0f766e' },
};

export const ETHICS_STATUS_META = {
  not_required: { label: 'Not Required', cls: 'badge-muted' },
  pending: { label: 'Ethics Pending', cls: 'badge-amber' },
  submitted: { label: 'Ethics Submitted', cls: 'badge-blue' },
  approved: { label: 'Ethics Cleared', cls: 'badge-teal' },
};

export const PROJECT_STATUS_META = {
  active: { label: 'Active Supervision', cls: 'badge-blue' },
  submitted_for_defence: { label: 'Ready for Defence', cls: 'badge-teal' },
  completed: { label: 'Completed / Graduated', cls: 'badge-teal' },
  on_hold: { label: 'On Hold', cls: 'badge-amber' },
};

export const THESIS_RUBRIC_CRITERIA = [
  { id: 'problem', label: 'Problem Statement & Research Objectives', max: 15, hint: 'Clarity of research gap, scope, and measurable objectives' },
  { id: 'literature', label: 'Literature Review & Theoretical Grounding', max: 20, hint: 'Critical synthesis of recent peer-reviewed scholarship & framework' },
  { id: 'methodology', label: 'Methodology, Sampling & Ethics Rigour', max: 20, hint: 'Appropriate research design, validity, reliability, and ethical compliance' },
  { id: 'analysis', label: 'Data Analysis, Results & Discussion', max: 25, hint: 'Statistical/qualitative rigour linked directly back to objectives' },
  { id: 'writing', label: 'Academic Writing, Structure & Referencing', max: 10, hint: 'Coherence, scholarly tone, and APA/Harvard citation accuracy' },
  { id: 'viva', label: 'Originality, Practical Impact & Viva Readiness', max: 10, hint: 'Managerial/policy relevance and defence preparedness' },
];

export const THESIS_ANNOTATION_SNIPPETS = [
  { id: 'cite', title: 'Add recent citation', text: 'Support this claim with a recent peer-reviewed citation (2021 or newer).' },
  { id: 'obj', title: 'Link to objective', text: 'Explicitly tie this section back to your stated Research Objectives in Chapter 1.' },
  { id: 'sample', title: 'Justify sample size', text: 'Provide a formal justification (e.g., Yamane, Krejcie & Morgan, or G*Power) for this sample size.' },
  { id: 'apa', title: 'Citation / APA format', text: 'Check in-text citation formatting and ensure this source appears in the Reference List.' },
  { id: 'clarity', title: 'Tighten academic tone', text: 'Rewrite this paragraph more concisely in formal academic prose; avoid unsupported generalisations.' },
  { id: 'data', title: 'Interpret table/figure', text: 'Do not merely repeat numbers from the table — interpret what the result means for procurement practice.' },
  { id: 'strong', title: 'Strong section', text: 'Well-argued section with strong synthesis of literature and practical PSCM relevance.' },
];

export function computeThesisRubricTotal(scores = {}) {
  let earned = 0;
  let maxTotal = 0;
  let filled = 0;
  for (const c of THESIS_RUBRIC_CRITERIA) {
    maxTotal += c.max;
    const raw = scores?.[c.id];
    if (raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))) {
      earned += Math.max(0, Math.min(c.max, Number(raw)));
      filled += 1;
    }
  }
  const pct = maxTotal > 0 ? Math.round((earned / maxTotal) * 100) : 0;
  let gradeBand = 'Unscored';
  if (filled > 0) {
    if (pct >= 80) gradeBand = 'Distinction / First Class';
    else if (pct >= 70) gradeBand = 'Very Good / 2:1';
    else if (pct >= 60) gradeBand = 'Good / 2:2';
    else if (pct >= 50) gradeBand = 'Pass (Revisions Needed)';
    else gradeBand = 'Below Pass Standard';
  }
  return {
    earned: Number(earned.toFixed(1)),
    maxTotal,
    pct,
    filled,
    totalCriteria: THESIS_RUBRIC_CRITERIA.length,
    gradeBand,
  };
}

export function detectThesisFileKind(fileName = '', mimeType = '') {
  const lower = String(fileName || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  if (lower.endsWith('.pdf') || mime.includes('pdf')) return 'pdf';
  if (lower.endsWith('.docx') || mime.includes('wordprocessingml')) return 'docx';
  return 'other';
}

export const THESIS_MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTS = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'zip', 'png', 'jpg', 'jpeg']);

export function validateThesisUploadFile(file) {
  if (!file) return { ok: false, error: 'Choose a file to upload.' };
  const name = String(file.name || '');
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!ALLOWED_EXTS.has(ext)) {
    return {
      ok: false,
      error: 'Unsupported file format. Upload a PDF (recommended for inline page annotations), Word (.docx/.doc), Excel, PowerPoint, ZIP, or image.',
    };
  }
  if (Number(file.size) > THESIS_MAX_BYTES) {
    return { ok: false, error: 'File exceeds the 25 MB thesis upload limit. Compress large images or export a compressed PDF.' };
  }
  return { ok: true, kind: detectThesisFileKind(name, file.type) };
}

export function daysBetween(fromIso, toMs = Date.now()) {
  if (!fromIso) return null;
  const start = new Date(fromIso).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((toMs - start) / 86400000));
}

export function analyzeProjectHealth(project, milestones = [], submissions = [], meetings = [], nowMs = Date.now()) {
  const totalMilestones = milestones.length;
  const approvedCount = milestones.filter((m) => m.status === 'approved').length;
  const submittedCount = milestones.filter((m) => m.status === 'submitted' || m.status === 'under_review').length;
  const revisionsCount = milestones.filter((m) => m.status === 'revisions_requested').length;

  // Weighted progress: approved = 1.0, revisions/under_review = 0.6, submitted = 0.45
  let weightSum = 0;
  for (const m of milestones) {
    if (m.status === 'approved') weightSum += 1;
    else if (m.status === 'under_review' || m.status === 'revisions_requested') weightSum += 0.6;
    else if (m.status === 'submitted') weightSum += 0.45;
  }
  const progressPct = totalMilestones > 0 ? Math.round((weightSum / totalMilestones) * 100) : 0;

  // Pending reviews awaiting supervisor
  const pendingSubs = submissions.filter((s) => s.review_status === 'pending' || s.review_status === 'under_review');
  const oldestPendingDays = pendingSubs.length
    ? Math.max(...pendingSubs.map((s) => daysBetween(s.submitted_at, nowMs) ?? 0))
    : null;

  let slaLevel = 'ok';
  if (oldestPendingDays !== null) {
    if (oldestPendingDays >= 7) slaLevel = 'overdue';
    else if (oldestPendingDays >= 3) slaLevel = 'due_soon';
  }

  // Turnaround times for reviewed submissions
  const turnarounds = submissions
    .filter((s) => s.submitted_at && s.reviewed_at)
    .map((s) => Math.max(0, (new Date(s.reviewed_at).getTime() - new Date(s.submitted_at).getTime()) / 86400000))
    .filter((d) => Number.isFinite(d));
  const avgTurnaroundDays = turnarounds.length
    ? Number((turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length).toFixed(1))
    : null;

  // Last meaningful activity (submission, meeting, or project creation)
  const timestamps = [
    project?.created_at,
    ...submissions.map((s) => s.submitted_at),
    ...submissions.map((s) => s.reviewed_at),
    ...meetings.map((m) => m.meeting_date),
  ]
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => !Number.isNaN(t));

  const lastActivityMs = timestamps.length ? Math.max(...timestamps) : nowMs;
  const inactiveDays = Math.max(0, Math.floor((nowMs - lastActivityMs) / 86400000));
  const isActiveProject = project?.status === 'active';
  const isSilentRisk = isActiveProject && pendingSubs.length === 0 && inactiveDays >= 14;

  // Total open annotations (unresolved by student)
  let totalAnnotations = 0;
  let unresolvedAnnotations = 0;
  for (const s of submissions) {
    const anns = Array.isArray(s.annotations) ? s.annotations : [];
    totalAnnotations += anns.length;
    unresolvedAnnotations += anns.filter((a) => !a.studentResolved).length;
  }

  return {
    totalMilestones,
    approvedCount,
    submittedCount,
    revisionsCount,
    progressPct,
    pendingReviewCount: pendingSubs.length,
    oldestPendingDays,
    slaLevel,
    avgTurnaroundDays,
    inactiveDays,
    isSilentRisk,
    meetingCount: meetings.length,
    submissionCount: submissions.length,
    totalAnnotations,
    unresolvedAnnotations,
  };
}

export function computeCohortSummary(projects = [], milestonesByProj = {}, subsByProj = {}, meetingsByProj = {}, nowMs = Date.now()) {
  let pendingReviews = 0;
  let silentCount = 0;
  let defenceReady = 0;
  let totalProgress = 0;
  const turnarounds = [];
  const healthById = {};

  for (const p of projects) {
    const h = analyzeProjectHealth(
      p,
      milestonesByProj[p.id] || [],
      subsByProj[p.id] || [],
      meetingsByProj[p.id] || [],
      nowMs,
    );
    healthById[p.id] = h;
    pendingReviews += h.pendingReviewCount;
    if (h.isSilentRisk) silentCount += 1;
    if (p.status === 'submitted_for_defence' || p.status === 'completed' || h.progressPct >= 95) defenceReady += 1;
    totalProgress += h.progressPct;
    if (h.avgTurnaroundDays !== null) turnarounds.push(h.avgTurnaroundDays);
  }

  const avgTurnaroundDays = turnarounds.length
    ? Number((turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length).toFixed(1))
    : null;
  const avgProgressPct = projects.length ? Math.round(totalProgress / projects.length) : 0;

  return {
    totalSupervisees: projects.length,
    pendingReviews,
    silentCount,
    defenceReady,
    avgProgressPct,
    avgTurnaroundDays,
    healthById,
  };
}

// Neutralize spreadsheet formula prefixes (=, +, -, @) for safe Excel export
export function sanitizeSpreadsheetCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value;
  const s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

export function buildSupervisionRegisterSheets(projects = [], milestonesByProj = {}, subsByProj = {}, meetingsByProj = {}, nowMs = Date.now()) {
  const summary = computeCohortSummary(projects, milestonesByProj, subsByProj, meetingsByProj, nowMs);
  const registerRows = [
    [
      'Index No.',
      'Student Name',
      'Level',
      'Programme',
      'Academic Year',
      'Thesis Title',
      'Ethics',
      'Status',
      'Progress %',
      'Approved Chapters',
      'Pending Reviews',
      'Meetings Logged',
      'Avg Turnaround (Days)',
      'Inactive Days',
      'Rubric Score / 100',
    ],
  ];

  const milestoneRows = [
    ['Index No.', 'Student Name', 'Milestone', 'Status', 'Latest Version', 'Due Date'],
  ];

  for (const p of projects) {
    const h = summary.healthById[p.id] || {};
    const rub = computeThesisRubricTotal(p.rubric_scores || {});
    registerRows.push([
      sanitizeSpreadsheetCell(p.student_index_no),
      sanitizeSpreadsheetCell(p.student_name),
      sanitizeSpreadsheetCell(p.degree_level),
      sanitizeSpreadsheetCell(p.programme),
      sanitizeSpreadsheetCell(p.academic_year),
      sanitizeSpreadsheetCell(p.title),
      sanitizeSpreadsheetCell(ETHICS_STATUS_META[p.ethics_status]?.label || p.ethics_status),
      sanitizeSpreadsheetCell(PROJECT_STATUS_META[p.status]?.label || p.status),
      h.progressPct ?? 0,
      `${h.approvedCount ?? 0}/${h.totalMilestones ?? 0}`,
      h.pendingReviewCount ?? 0,
      h.meetingCount ?? 0,
      h.avgTurnaroundDays ?? '',
      h.inactiveDays ?? 0,
      rub.filled > 0 ? rub.earned : '',
    ]);

    for (const m of milestonesByProj[p.id] || []) {
      milestoneRows.push([
        sanitizeSpreadsheetCell(p.student_index_no),
        sanitizeSpreadsheetCell(p.student_name),
        sanitizeSpreadsheetCell(m.title),
        sanitizeSpreadsheetCell(MILESTONE_STATUS_META[m.status]?.label || m.status),
        m.latest_version_no ? `v${m.latest_version_no}` : '—',
        sanitizeSpreadsheetCell(m.due_date || ''),
      ]);
    }
  }

  return [
    { name: 'Supervision Register', rows: registerRows, widths: [16, 24, 10, 22, 14, 42, 16, 18, 12, 16, 14, 14, 18, 12, 16] },
    { name: 'Chapter Milestones', rows: milestoneRows, widths: [16, 24, 36, 18, 14, 14] },
  ];
}

export function buildSupervisionDossierLines({ project, supervisorName = 'Supervisor', milestones = [], submissions = [], meetings = [] }) {
  const health = analyzeProjectHealth(project, milestones, submissions, meetings);
  const rubric = computeThesisRubricTotal(project?.rubric_scores || {});
  const lines = [
    'OFFICIAL THESIS SUPERVISION AUDIT DOSSIER',
    `Generated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    '------------------------------------------------------------------------',
    `Student Name:      ${project?.student_name || '—'} (${project?.student_index_no || '—'})`,
    `Degree & Program:  ${project?.degree_level || 'BSc'} — ${project?.programme || 'PSCM'}`,
    `Academic Year:     ${project?.academic_year || '—'}`,
    `Supervisor:        ${supervisorName}`,
    `Thesis Title:      ${project?.title || 'Untitled Research Topic'}`,
    `Ethics Clearance:  ${ETHICS_STATUS_META[project?.ethics_status]?.label || project?.ethics_status || '—'}`,
    `Target Defence:    ${project?.target_defence_date || 'Not scheduled'}`,
    `Overall Progress:  ${health.progressPct}% (${health.approvedCount}/${health.totalMilestones} chapters approved)`,
    `Total Drafts:      ${health.submissionCount} versions | Meetings Logged: ${health.meetingCount}`,
    `Avg Turnaround:    ${health.avgTurnaroundDays !== null ? `${health.avgTurnaroundDays} days` : 'Pending first review'}`,
    '',
    '1. CHAPTER MILESTONE PROGRESSION',
  ];

  milestones.forEach((m, idx) => {
    const st = MILESTONE_STATUS_META[m.status]?.label || m.status;
    lines.push(`   ${idx + 1}. ${m.title} — [${st}] (Latest: ${m.latest_version_no ? `v${m.latest_version_no}` : 'None'}${m.due_date ? `, Due ${m.due_date}` : ''})`);
  });

  lines.push('', '2. SUBMISSION & FEEDBACK AUDIT TRAIL');
  if (!submissions.length) {
    lines.push('   No chapter drafts submitted yet.');
  } else {
    submissions.slice(0, 30).forEach((s) => {
      const mTitle = milestones.find((m) => m.id === s.milestone_id)?.title || 'Chapter';
      const annCount = Array.isArray(s.annotations) ? s.annotations.length : 0;
      const subDate = s.submitted_at ? new Date(s.submitted_at).toLocaleDateString('en-GB') : '—';
      lines.push(`   - ${mTitle} (v${s.version_no}) | Submitted ${subDate} | Status: ${s.review_status} | Inline comments: ${annCount}`);
      if (s.supervisor_feedback) {
        lines.push(`     Supervisor Note: ${s.supervisor_feedback.slice(0, 240)}`);
      }
    });
  }

  lines.push('', '3. SUPERVISION MEETING LOG');
  if (!meetings.length) {
    lines.push('   No supervision meetings recorded yet.');
  } else {
    meetings.forEach((mt, i) => {
      const dt = mt.meeting_date ? new Date(mt.meeting_date).toLocaleDateString('en-GB') : '—';
      const ack = mt.student_acknowledged_at ? 'Student Acknowledged' : 'Awaiting Student Ack';
      lines.push(`   ${i + 1}. ${dt} (${mt.mode || 'in_person'}) — ${ack}`);
      if (mt.summary) lines.push(`      Summary: ${mt.summary}`);
      const items = Array.isArray(mt.action_items) ? mt.action_items : [];
      items.forEach((it) => lines.push(`      * Action: ${typeof it === 'string' ? it : it.text || ''}`));
    });
  }

  if (rubric.filled > 0) {
    lines.push('', `4. THESIS READINESS RUBRIC (${rubric.earned} / ${rubric.maxTotal} — ${rubric.gradeBand})`);
    THESIS_RUBRIC_CRITERIA.forEach((c) => {
      const sc = project?.rubric_scores?.[c.id];
      lines.push(`   - ${c.label}: ${sc !== undefined && sc !== '' ? sc : '—'} / ${c.max}`);
    });
  }

  return lines;
}

export function buildAnnotationFeedbackLines({ title, studentLabel, fileName, annotations = [] }) {
  const lines = [
    'INLINE THESIS ANNOTATION FEEDBACK REPORT',
    `Document: ${fileName || 'Draft'}`,
    `Student:  ${studentLabel || '—'}`,
    `Context:  ${title || 'Thesis Chapter Review'}`,
    `Total Inline Comments: ${annotations.length}`,
    '------------------------------------------------------------------------',
  ];
  if (!annotations.length) {
    lines.push('No inline annotations recorded on this draft.');
    return lines;
  }
  const sorted = [...annotations].sort((a, b) => (Number(a.page || a.paraIndex || 0) - Number(b.page || b.paraIndex || 0)));
  sorted.forEach((a, idx) => {
    const loc = a.paraIndex !== undefined ? `Paragraph ${a.paraIndex + 1}` : `Page ${a.page || 1}`;
    const tag = String(a.tag || 'comment').toUpperCase();
    lines.push(`${idx + 1}. [${tag}] (${loc})${a.studentResolved ? ' [ADDRESSED]' : ''}`);
    lines.push(`   Supervisor: ${a.text || ''}`);
    if (a.studentReply) {
      lines.push(`   Student Reply: ${a.studentReply}`);
    }
    lines.push('');
  });
  return lines;
}

export function parseBulkSuperviseesText(rawText = '', defaultDegree = 'BSc', defaultYear = '') {
  const lines = String(rawText || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const sep = lines[i].includes('\t') ? '\t' : ',';
    const cols = lines[i].split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (i === 0 && /index|matric|student/i.test(cols[0]) && /name/i.test(cols[1] || '')) continue;
    const index_no = String(cols[0] || '').replace(/\s+/g, '').toUpperCase();
    if (!index_no) continue;
    out.push({
      index_no,
      student_name: cols[1] || index_no,
      title: cols[2] || 'Untitled Research Topic',
      programme: cols[3] || '',
      degree_level: DEGREE_LEVELS.includes(cols[4]) ? cols[4] : defaultDegree,
      academic_year: cols[5] || defaultYear,
    });
  }
  return out;
}
