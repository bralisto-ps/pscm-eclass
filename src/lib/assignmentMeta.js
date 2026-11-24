// Encodes optional assignment rubric criteria, syndicate group configuration,
// cohort targeting (programmes / streams / classes), brief document metadata,
// submission rules, and per-class/per-student deadline overrides inside
// assignments.instructions via a hidden HTML comment tag so existing tables
// require zero breaking migrations.
const ASSIGN_META_RE = /\n?\s*<!--\s*ASSIGN_META:(\{[\s\S]*?\})\s*-->\s*$/;

export const RUBRIC_PRESETS = [
  {
    id: 'pscm_case',
    label: 'PSCM Case Study (4 criteria)',
    build: (total = 100) => {
      const w = [0.3, 0.3, 0.25, 0.15];
      const names = [
        'Problem Diagnosis & Supply Chain Context',
        'Quantitative / Analytical Rigour',
        'Strategic Recommendations & Feasibility',
        'Clarity, Evidence & Referencing',
      ];
      return allocateMarks(names, w, total);
    },
  },
  {
    id: 'procurement',
    label: 'Procurement / Vendor Evaluation',
    build: (total = 100) => {
      const w = [0.25, 0.35, 0.25, 0.15];
      const names = [
        'Evaluation Framework & Criteria Selection',
        'Weighted Scoring & TCO Calculations',
        'Risk Mitigation & Contract Terms',
        'Executive Summary & Presentation',
      ];
      return allocateMarks(names, w, total);
    },
  },
  {
    id: 'written_essay',
    label: 'Written Exam Answer (3 criteria)',
    build: (total = 10) => {
      const w = [0.4, 0.4, 0.2];
      const names = [
        'Core Concept Accuracy',
        'Applied Examples & Depth',
        'Structure & Conciseness',
      ];
      return allocateMarks(names, w, total);
    },
  },
];

function allocateMarks(names, weights, total) {
  const max = Math.max(1, Number(total) || 10);
  const raw = weights.map((wt) => Math.round(wt * max * 2) / 2);
  const sum = raw.reduce((s, n) => s + n, 0);
  const diff = Math.round((max - sum) * 2) / 2;
  if (raw.length > 0 && Math.abs(diff) > 0) {
    raw[0] = Math.max(0.5, Number((raw[0] + diff).toFixed(1)));
  }
  return names.map((title, i) => ({
    id: `c${i + 1}`,
    title,
    maxMarks: raw[i],
  }));
}

export function normalizeIndexNo(v) {
  return String(v || '').trim().toUpperCase();
}

export function cleanCohortPart(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function classKey(programme, stream) {
  return `${cleanCohortPart(programme)}|${cleanCohortPart(stream)}`;
}

function normClassKey(programme, stream) {
  return `${cleanCohortPart(programme).toLowerCase()}|${cleanCohortPart(stream).toLowerCase()}`;
}

function normalizeStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((x) => cleanCohortPart(x)).filter(Boolean))];
}

function normalizeClassesArray(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const [p = '', s = ''] = String(item || '').split('|');
    const cleaned = classKey(p, s);
    const norm = cleaned.toLowerCase();
    if (!seen.has(norm) && cleaned !== '|') {
      seen.add(norm);
      out.push(cleaned);
    } else if (!seen.has(norm) && String(item || '').includes('|')) {
      seen.add(norm);
      out.push('|');
    }
  }
  return out;
}

function normalizeIsoDate(val) {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function normalizeDeadlinesConfig(deadlines) {
  const byClass = {};
  const byStudent = {};
  if (deadlines && typeof deadlines === 'object') {
    if (deadlines.byClass && typeof deadlines.byClass === 'object') {
      const seenClass = new Set();
      for (const [rawKey, rawVal] of Object.entries(deadlines.byClass)) {
        const iso = normalizeIsoDate(rawVal);
        if (!iso) continue;
        const [p = '', st = ''] = String(rawKey || '').split('|');
        const cleaned = classKey(p, st);
        const norm = cleaned.toLowerCase();
        if (!seenClass.has(norm)) {
          seenClass.add(norm);
          byClass[cleaned] = iso;
        }
      }
    }
    if (deadlines.byStudent && typeof deadlines.byStudent === 'object') {
      for (const [rawIdx, rawVal] of Object.entries(deadlines.byStudent)) {
        const idx = normalizeIndexNo(rawIdx);
        const iso = normalizeIsoDate(rawVal);
        if (idx && iso) byStudent[idx] = iso;
      }
    }
  }
  return { byClass, byStudent };
}

export function hasDeadlineOverrides(metaOrDeadlines) {
  const dl = metaOrDeadlines?.deadlines || metaOrDeadlines;
  if (!dl) return false;
  return Object.keys(dl.byClass || {}).length > 0 || Object.keys(dl.byStudent || {}).length > 0;
}

export function resolveEffectiveDue(assignment, meta, student) {
  const parsed = meta || parseAssignmentMeta(assignment);
  const dl = parsed?.deadlines || { byClass: {}, byStudent: {} };
  const defaultDue = assignment?.due_at || null;

  if (student) {
    const idx = normalizeIndexNo(student.index_no ?? student.indexNo);
    if (idx && dl.byStudent?.[idx]) {
      return { dueAt: dl.byStudent[idx], source: 'student', label: 'Extended deadline' };
    }
    const prog = student.programme;
    const stream = student.stream;
    if (prog !== undefined || stream !== undefined) {
      const targetNorm = normClassKey(prog, stream);
      for (const [k, iso] of Object.entries(dl.byClass || {})) {
        const [kp = '', ks = ''] = String(k).split('|');
        if (normClassKey(kp, ks) === targetNorm) {
          return { dueAt: iso, source: 'class', label: 'Class deadline' };
        }
      }
    }
  }
  return { dueAt: defaultDue, source: 'default', label: '' };
}

export const SUBMISSION_FORMATS = {
  all: {
    id: 'all',
    label: 'Any supported file (PDF, Word, Excel, PowerPoint, ZIP, image)',
    shortLabel: 'Any supported file',
    accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.jpg,.jpeg,.png',
    exts: null,
  },
  pdf: {
    id: 'pdf',
    label: 'PDF only (.pdf)',
    shortLabel: 'PDF only',
    accept: '.pdf,application/pdf',
    exts: ['pdf'],
  },
  docs: {
    id: 'docs',
    label: 'PDF or Word document (.pdf, .doc, .docx)',
    shortLabel: 'PDF or Word',
    accept: '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    exts: ['pdf', 'doc', 'docx'],
  },
};

export function normalizeSubmissionConfig(sub) {
  const mode = sub?.mode === 'typed' || sub?.mode === 'both' ? sub.mode : 'file';
  const fileFormat = sub?.fileFormat === 'pdf' || sub?.fileFormat === 'docs' ? sub.fileFormat : 'all';
  const allowPaste = sub?.allowPaste !== false;
  return { mode, fileFormat, allowPaste };
}

export function validateSubmissionFile(fileName, fileFormat = 'all') {
  const preset = SUBMISSION_FORMATS[fileFormat] || SUBMISSION_FORMATS.all;
  if (!preset.exts) return null;
  const ext = String(fileName || '').split('.').pop()?.toLowerCase() || '';
  if (preset.exts.includes(ext)) return null;
  if (preset.id === 'pdf') return 'Only PDF files (.pdf) are accepted for this assignment.';
  if (preset.id === 'docs') return 'Only PDF or Word documents (.pdf, .doc, .docx) are accepted for this assignment.';
  return 'That file type is not accepted for this assignment.';
}

export function formatSubmissionRules(metaOrSub) {
  const sub = normalizeSubmissionConfig(metaOrSub?.submission || metaOrSub);
  const fmt = SUBMISSION_FORMATS[sub.fileFormat] || SUBMISSION_FORMATS.all;
  if (sub.mode === 'typed') {
    return sub.allowPaste ? 'Typed online response' : 'Typed online (copy & paste blocked)';
  }
  if (sub.mode === 'both') {
    const pastePart = sub.allowPaste ? '' : ', no copy/paste';
    const filePart = sub.fileFormat === 'all' ? 'file attachment' : fmt.shortLabel;
    return `Typed + ${filePart}${pastePart}`;
  }
  if (sub.fileFormat !== 'all') return fmt.shortLabel;
  return '';
}

export function cleanAssignmentInstructions(raw) {
  return String(raw || '').replace(ASSIGN_META_RE, '').trim();
}

export function normalizeTopicRegistration(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const enabled = Boolean(obj.enabled);
  const u = String(obj.uniqueness || 'product').toLowerCase();
  const uniqueness = u === 'firm' || u === 'both' ? u : 'product';
  const rawDl = String(obj.deadline || "").trim();
  const parsedDl = rawDl ? new Date(rawDl) : null;
  const deadline = parsedDl && !Number.isNaN(parsedDl.getTime()) ? parsedDl.toISOString() : "";
  const requireBeforeSubmit = obj.requireBeforeSubmit !== false;
  const useAiCheck = obj.useAiCheck !== false;
  return { enabled, uniqueness, deadline, requireBeforeSubmit, useAiCheck };
}

export function formatTopicRuleLabel(metaOrTopic) {
  const t = metaOrTopic?.topicRegistration || metaOrTopic;
  if (!t?.enabled) return '';
  if (t.uniqueness === 'firm') return 'Unique Firm pre-registration';
  if (t.uniqueness === 'both') return 'Unique Firm & Product pre-registration';
  return 'Unique Product pre-registration';
}

export function parseAssignmentMeta(assignment) {
  const raw = typeof assignment === 'string' ? assignment : (assignment?.instructions || '');
  const match = raw.match(ASSIGN_META_RE);
  const cleanInstructions = cleanAssignmentInstructions(raw);
  const empty = {
    cleanInstructions,
    rubric: [],
    syndicate: {
      enabled: false,
      peerCheck: true,
      groups: [],
    },
    audience: {
      classes: [],
      programmes: [],
      streams: [],
    },
    doc: null,
    submission: { mode: 'file', fileFormat: 'all', allowPaste: true },
    deadlines: { byClass: {}, byStudent: {} },
    topicRegistration: normalizeTopicRegistration(null),
  };
  if (!match) return empty;
  try {
    const parsed = JSON.parse(match[1]);
    const rubric = Array.isArray(parsed.rubric)
      ? parsed.rubric
          .filter((c) => c && String(c.title || '').trim())
          .map((c, i) => ({
            id: String(c.id || `c${i + 1}`),
            title: String(c.title).trim(),
            maxMarks: Math.max(0.5, Number(c.maxMarks) || 1),
          }))
      : [];
    const groups = Array.isArray(parsed.syndicate?.groups)
      ? parsed.syndicate.groups
          .filter((g) => g && String(g.name || '').trim())
          .map((g, i) => {
            const rawNames = g.member_names && typeof g.member_names === 'object' ? g.member_names : {};
            const memberNames = {};
            for (const [k, v] of Object.entries(rawNames)) {
              const nk = normalizeIndexNo(k);
              const nv = String(v || '').trim();
              if (nk && nv && normalizeIndexNo(nv) !== nk) memberNames[nk] = nv;
            }
            return {
              id: String(g.id || `g${i + 1}`),
              name: String(g.name).trim(),
              members: [...new Set((Array.isArray(g.members) ? g.members : []).map(normalizeIndexNo).filter(Boolean))],
              ...(Object.keys(memberNames).length ? { memberNames } : {}),
            };
          })
      : [];
    const audience = {
      classes: normalizeClassesArray(parsed.audience?.classes),
      programmes: normalizeStringArray(parsed.audience?.programmes),
      streams: normalizeStringArray(parsed.audience?.streams),
    };
    const rawDoc = parsed.doc;
    const doc = rawDoc && String(rawDoc.path || '').trim()
      ? {
          path: String(rawDoc.path).trim(),
          name: String(rawDoc.name || 'Assignment brief').trim(),
          sizeBytes: Number(rawDoc.sizeBytes) || 0,
          viewOnly: Boolean(rawDoc.viewOnly || String(rawDoc.path).startsWith('viewonly:')),
        }
      : null;

    return {
      cleanInstructions,
      rubric,
      syndicate: {
        enabled: Boolean(parsed.syndicate?.enabled),
        peerCheck: parsed.syndicate?.peerCheck !== false,
        groups,
      },
      audience,
      doc,
      submission: normalizeSubmissionConfig(parsed.submission),
      deadlines: normalizeDeadlinesConfig(parsed.deadlines),
      topicRegistration: normalizeTopicRegistration(parsed.topicRegistration),
    };
  } catch {
    return empty;
  }
}

export function serializeAssignmentMeta(cleanInstructions, meta = {}) {
  const base = cleanAssignmentInstructions(cleanInstructions);
  const rubric = (Array.isArray(meta.rubric) ? meta.rubric : [])
    .filter((c) => c && String(c.title || '').trim())
    .map((c, i) => ({
      id: String(c.id || `c${i + 1}`),
      title: String(c.title).trim(),
      maxMarks: Math.max(0.5, Number(c.maxMarks) || 1),
    }));
  const groups = (Array.isArray(meta.syndicate?.groups) ? meta.syndicate.groups : [])
    .filter((g) => g && String(g.name || '').trim())
    .map((g, i) => ({
      id: String(g.id || `g${i + 1}`),
      name: String(g.name).trim(),
      members: [...new Set((Array.isArray(g.members) ? g.members : []).map(normalizeIndexNo).filter(Boolean))],
    }));
  const audience = {
    classes: normalizeClassesArray(meta.audience?.classes),
    programmes: normalizeStringArray(meta.audience?.programmes),
    streams: normalizeStringArray(meta.audience?.streams),
  };
  const hasAudience = audience.classes.length > 0 || audience.programmes.length > 0 || audience.streams.length > 0;
  const doc = meta.doc && String(meta.doc.path || '').trim()
    ? {
        path: String(meta.doc.path).trim(),
        name: String(meta.doc.name || 'Assignment brief').trim(),
        sizeBytes: Number(meta.doc.sizeBytes) || 0,
        viewOnly: Boolean(meta.doc.viewOnly || String(meta.doc.path).startsWith('viewonly:')),
      }
    : null;
  const submission = normalizeSubmissionConfig(meta.submission);
  const hasCustomSubmission = submission.mode !== 'file' || submission.fileFormat !== 'all' || !submission.allowPaste;
  const deadlines = normalizeDeadlinesConfig(meta.deadlines);
  const hasDeadlines = hasDeadlineOverrides(deadlines);
  const topicRegistration = normalizeTopicRegistration(meta.topicRegistration);
  const hasTopicReg = Boolean(topicRegistration.enabled);
  const hasSyndicate = Boolean(meta.syndicate?.enabled) || groups.length > 0;
  if (rubric.length === 0 && !hasSyndicate && !hasAudience && !doc && !hasCustomSubmission && !hasDeadlines && !hasTopicReg) return base;
  const payload = {
    rubric,
    syndicate: {
      enabled: Boolean(meta.syndicate?.enabled),
      peerCheck: meta.syndicate?.peerCheck !== false,
      groups,
    },
    ...(hasAudience ? { audience } : {}),
    ...(doc ? { doc } : {}),
    ...(hasCustomSubmission ? { submission } : {}),
    ...(hasDeadlines ? { deadlines } : {}),
    ...(hasTopicReg ? { topicRegistration } : {}),
  };
  return `${base}\n\n<!-- ASSIGN_META:${JSON.stringify(payload)} -->`.trim();
}

export function hasAudienceFilter(metaOrAudience) {
  const aud = metaOrAudience?.audience || metaOrAudience;
  if (!aud) return false;
  return Boolean(
    (aud.classes && aud.classes.length > 0) ||
    (aud.programmes && aud.programmes.length > 0) ||
    (aud.streams && aud.streams.length > 0)
  );
}

export function assignmentMatchesStudent(metaOrAudience, student) {
  const aud = metaOrAudience?.audience || metaOrAudience;
  if (!aud || !hasAudienceFilter(aud)) return true;
  if (!student) return true;

  const sProg = cleanCohortPart(student.programme).toLowerCase();
  const sStream = cleanCohortPart(student.stream).toLowerCase();
  const sKey = `${sProg}|${sStream}`;

  if (aud.classes && aud.classes.length > 0) {
    return aud.classes.some((c) => {
      const [p = '', st = ''] = String(c || '').split('|');
      return normClassKey(p, st) === sKey;
    });
  }
  if (aud.programmes && aud.programmes.length > 0) {
    if (!aud.programmes.some((p) => cleanCohortPart(p).toLowerCase() === sProg)) return false;
  }
  if (aud.streams && aud.streams.length > 0) {
    if (!aud.streams.some((st) => cleanCohortPart(st).toLowerCase() === sStream)) return false;
  }
  return true;
}

export function filterStudentsForAssignment(students = [], metaOrAudience) {
  if (!hasAudienceFilter(metaOrAudience)) return students;
  return students.filter((s) => assignmentMatchesStudent(metaOrAudience, s));
}

export function formatAssignmentAudience(metaOrAudience) {
  const aud = metaOrAudience?.audience || metaOrAudience;
  if (!aud || !hasAudienceFilter(aud)) return 'All enrolled classes';
  if (aud.classes && aud.classes.length > 0) {
    const labels = aud.classes.map((c) => {
      const [p, st] = String(c || '').split('|');
      return [cleanCohortPart(p), cleanCohortPart(st)].filter(Boolean).join(' · ') || 'Unassigned';
    });
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2} more`;
  }
  const parts = [];
  if (aud.programmes?.length) parts.push(aud.programmes.join(', '));
  if (aud.streams?.length) parts.push(aud.streams.join(', '));
  return parts.join(' · ') || 'Selected cohorts';
}

export function findStudentSyndicate(meta, indexNo) {
  if (!meta?.syndicate?.enabled || !indexNo) return null;
  const norm = normalizeIndexNo(indexNo);
  return (meta.syndicate.groups || []).find((g) => (g.members || []).includes(norm)) || null;
}

const indexCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function cohortBucket(student, cohortMode) {
  const prog = cleanCohortPart(student.programme);
  const stream = cleanCohortPart(student.stream);
  if (cohortMode === 'mix') return { key: 'all', label: '' };
  if (cohortMode === 'stream') {
    return {
      key: stream.toLowerCase() || '__none__',
      label: stream || 'Unassigned stream',
    };
  }
  if (cohortMode === 'programme') {
    return {
      key: prog.toLowerCase() || '__none__',
      label: prog || 'Unassigned programme',
    };
  }
  const label = [prog, stream].filter(Boolean).join(' · ') || 'Unassigned';
  return {
    key: `${prog.toLowerCase()}||${stream.toLowerCase()}`,
    label,
  };
}

export function nextSyndicateNumber(existingGroups = []) {
  let maxN = 0;
  for (const g of existingGroups || []) {
    const m = String(g?.name || '').match(/(?:syndicate|group|team)s*(d+)/i);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  }
  return Math.max(maxN, (existingGroups || []).length) + 1;
}

function orderBucketMembers(members, orderMode = 'random', rng = Math.random) {
  const list = [...members];
  if (orderMode === 'name') {
    list.sort((a, b) =>
      indexCollator.compare(a.full_name || '', b.full_name || '') ||
      indexCollator.compare(a._normIndex, b._normIndex)
    );
    return list;
  }
  if (orderMode === 'index') {
    list.sort((a, b) =>
      indexCollator.compare(a._normIndex, b._normIndex) ||
      indexCollator.compare(a.full_name || '', b.full_name || '')
    );
    return list;
  }
  // Default: unbiased Fisher-Yates random shuffle
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function autoBuildSyndicateGroups(
  students = [],
  groupSize = 4,
  cohortMode = 'both',
  audience = null,
  orderMode = 'random',
  rng = Math.random
) {
  const eligible = audience ? filterStudentsForAssignment(students, audience) : students;
  const size = Math.max(2, Math.min(15, Number(groupSize) || 4));
  const bucketsMap = new Map();
  for (const s of eligible) {
    const idxNo = normalizeIndexNo(s.index_no);
    if (!idxNo) continue;
    const { key, label } = cohortBucket(s, cohortMode);
    if (!bucketsMap.has(key)) bucketsMap.set(key, { key, label, members: [] });
    bucketsMap.get(key).members.push({ ...s, _normIndex: idxNo });
  }

  const buckets = [...bucketsMap.values()].sort((a, b) =>
    indexCollator.compare(a.label, b.label)
  );
  const showCohortInName = cohortMode !== 'mix' && buckets.length > 1;
  const stamp = Date.now().toString(36);
  const groups = [];

  for (const bucket of buckets) {
    const ordered = orderBucketMembers(bucket.members, orderMode, rng);
    const bucketSlices = [];
    for (let i = 0; i < ordered.length; i += size) {
      bucketSlices.push(ordered.slice(i, i + size).map((s) => s._normIndex));
    }
    if (bucketSlices.length >= 2 && bucketSlices[bucketSlices.length - 1].length === 1) {
      const lone = bucketSlices.pop()[0];
      bucketSlices[bucketSlices.length - 1].push(lone);
    }
    for (const members of bucketSlices) {
      const n = groups.length + 1;
      groups.push({
        id: `grp-${stamp}-${n}`,
        name: showCohortInName ? `Syndicate ${n} · ${bucket.label}` : `Syndicate ${n}`,
        members,
      });
    }
  }
  return groups;
}

/**
 * Places ONLY ungrouped eligible students into groups while leaving every existing
 * group's ID, name, and current members completely intact.
 *
 * strategy:
 *   - 'new_groups' (default): creates new sequential Syndicate groups for ungrouped students.
 *   - 'fill_first': tops up existing groups (in matching cohort) below groupSize first,
 *                   then forms new sequential Syndicate groups for any remaining students.
 */
export function assignUngroupedToSyndicates(existingGroups = [], students = [], opts = {}) {
  const {
    groupSize = 4,
    cohortMode = 'both',
    audience = null,
    orderMode = 'random',
    strategy = 'new_groups',
    rng = Math.random,
  } = opts;

  const size = Math.max(2, Math.min(15, Number(groupSize) || 4));
  const eligible = audience ? filterStudentsForAssignment(students, audience) : students;

  const assignedSet = new Set();
  const nextGroups = (existingGroups || []).map((g) => {
    const cleanMembers = [...new Set((g.members || []).map(normalizeIndexNo).filter(Boolean))];
    cleanMembers.forEach((m) => assignedSet.add(m));
    return { ...g, members: cleanMembers };
  });

  // Lookup student cohort by index number so fill_first respects cohort boundaries
  const studentByIdx = new Map();
  const allCohortKeys = new Set();
  for (const s of eligible) {
    const idxNo = normalizeIndexNo(s.index_no);
    if (!idxNo) continue;
    const b = cohortBucket(s, cohortMode);
    studentByIdx.set(idxNo, { ...s, _normIndex: idxNo, _bucket: b });
    allCohortKeys.add(b.key);
  }

  const ungrouped = [];
  for (const s of studentByIdx.values()) {
    if (!assignedSet.has(s._normIndex)) ungrouped.push(s);
  }

  if (!ungrouped.length) {
    return { groups: nextGroups, addedCount: 0, newGroupsCount: 0, toppedUpCount: 0 };
  }

  const bucketsMap = new Map();
  for (const s of ungrouped) {
    const { key, label } = s._bucket;
    if (!bucketsMap.has(key)) bucketsMap.set(key, { key, label, members: [] });
    bucketsMap.get(key).members.push(s);
  }
  const buckets = [...bucketsMap.values()].sort((a, b) =>
    indexCollator.compare(a.label, b.label)
  );

  const showCohortInName = cohortMode !== 'mix' && (
    allCohortKeys.size > 1 ||
    nextGroups.some((g) => String(g.name || '').includes('·'))
  );

  let nextNum = nextSyndicateNumber(nextGroups);
  const stamp = Date.now().toString(36);
  let toppedUpCount = 0;
  let newGroupsCount = 0;

  function groupCohortKey(g) {
    if (cohortMode === 'mix') return 'all';
    for (const m of g.members || []) {
      const stu = studentByIdx.get(m);
      if (stu) return stu._bucket.key;
    }
    return null;
  }

  for (const bucket of buckets) {
    let remaining = orderBucketMembers(bucket.members, orderMode, rng).map((s) => s._normIndex);

    if (strategy === 'fill_first' && nextGroups.length > 0) {
      const candidates = nextGroups
        .filter((g) => {
          if (g.members.length >= size) return false;
          if (cohortMode === 'mix') return true;
          const gk = groupCohortKey(g);
          return gk === null || gk === bucket.key;
        })
        .sort((a, b) => a.members.length - b.members.length);

      for (const grp of candidates) {
        while (remaining.length > 0 && grp.members.length < size) {
          grp.members.push(remaining.shift());
          toppedUpCount += 1;
        }
        if (!remaining.length) break;
      }
    }

    if (!remaining.length) continue;

    // If only 1 ungrouped student remains and fill_first is active, place into smallest matching group
    if (strategy === 'fill_first' && remaining.length === 1 && nextGroups.length > 0) {
      const matchExisting = nextGroups
        .filter((g) => cohortMode === 'mix' || groupCohortKey(g) === bucket.key)
        .sort((a, b) => a.members.length - b.members.length)[0];
      if (matchExisting) {
        matchExisting.members.push(remaining.shift());
        toppedUpCount += 1;
        continue;
      }
    }

    const slices = [];
    for (let i = 0; i < remaining.length; i += size) {
      slices.push(remaining.slice(i, i + size));
    }
    if (slices.length >= 2 && slices[slices.length - 1].length === 1) {
      const lone = slices.pop()[0];
      slices[slices.length - 1].push(lone);
    }

    for (const members of slices) {
      const n = nextNum++;
      nextGroups.push({
        id: `grp-${stamp}-${n}`,
        name: showCohortInName && bucket.label ? `Syndicate ${n} · ${bucket.label}` : `Syndicate ${n}`,
        members,
      });
      newGroupsCount += 1;
    }
  }

  return {
    groups: nextGroups,
    addedCount: ungrouped.length,
    newGroupsCount,
    toppedUpCount,
  };
}
