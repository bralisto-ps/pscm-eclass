// Encodes optional assignment rubric criteria & syndicate group configuration
// inside assignments.instructions via a hidden HTML comment tag so existing
// tables require zero breaking migrations.

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

export function cleanAssignmentInstructions(raw) {
  return String(raw || '').replace(ASSIGN_META_RE, '').trim();
}

export function parseAssignmentMeta(assignment) {
  const raw = typeof assignment === 'string' ? assignment : (assignment?.instructions || '');
  const match = raw.match(ASSIGN_META_RE);
  const cleanInstructions = cleanAssignmentInstructions(raw);
  const empty = {
    cleanInstructions,
    rubric: [], // [{ id, title, maxMarks }]
    syndicate: {
      enabled: false,
      peerCheck: true,
      groups: [], // [{ id, name, members: ['PSCM/...'] }]
    },
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
          .map((g, i) => ({
            id: String(g.id || `g${i + 1}`),
            name: String(g.name).trim(),
            members: [...new Set((Array.isArray(g.members) ? g.members : []).map(normalizeIndexNo).filter(Boolean))],
          }))
      : [];
    return {
      cleanInstructions,
      rubric,
      syndicate: {
        enabled: Boolean(parsed.syndicate?.enabled),
        peerCheck: parsed.syndicate?.peerCheck !== false,
        groups,
      },
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
  const hasSyndicate = Boolean(meta.syndicate?.enabled) || groups.length > 0;
  if (rubric.length === 0 && !hasSyndicate) return base;
  const payload = {
    rubric,
    syndicate: {
      enabled: Boolean(meta.syndicate?.enabled),
      peerCheck: meta.syndicate?.peerCheck !== false,
      groups,
    },
  };
  return `${base}\n\n<!-- ASSIGN_META:${JSON.stringify(payload)} -->`.trim();
}

export function findStudentSyndicate(meta, indexNo) {
  if (!meta?.syndicate?.enabled || !indexNo) return null;
  const norm = normalizeIndexNo(indexNo);
  return (meta.syndicate.groups || []).find((g) => (g.members || []).includes(norm)) || null;
}

const indexCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function cleanCohortPart(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function cohortBucket(student, cohortMode) {
  const prog = cleanCohortPart(student.programme);
  const stream = cleanCohortPart(student.stream);
  if (cohortMode === "mix") return { key: "all", label: "" };
  if (cohortMode === "stream") {
    return {
      key: stream.toLowerCase() || "__none__",
      label: stream || "Unassigned stream",
    };
  }
  if (cohortMode === "programme") {
    return {
      key: prog.toLowerCase() || "__none__",
      label: prog || "Unassigned programme",
    };
  }
  // Default: "both" — strictly keep students with the same programme AND stream together
  const label = [prog, stream].filter(Boolean).join(" · ") || "Unassigned";
  return {
    key: `${prog.toLowerCase()}||${stream.toLowerCase()}`,
    label,
  };
}

export function autoBuildSyndicateGroups(students = [], groupSize = 4, cohortMode = "both") {
  const size = Math.max(2, Math.min(15, Number(groupSize) || 4));
  const bucketsMap = new Map();
  for (const s of students) {
    const idxNo = normalizeIndexNo(s.index_no);
    if (!idxNo) continue;
    const { key, label } = cohortBucket(s, cohortMode);
    if (!bucketsMap.has(key)) bucketsMap.set(key, { key, label, members: [] });
    bucketsMap.get(key).members.push({ ...s, _normIndex: idxNo });
  }

  const buckets = [...bucketsMap.values()].sort((a, b) =>
    indexCollator.compare(a.label, b.label)
  );
  const showCohortInName = cohortMode !== "mix" && buckets.length > 1;
  const stamp = Date.now().toString(36);
  const groups = [];

  for (const bucket of buckets) {
    bucket.members.sort((a, b) =>
      indexCollator.compare(a._normIndex, b._normIndex) ||
      indexCollator.compare(a.full_name || "", b.full_name || "")
    );
    const bucketSlices = [];
    for (let i = 0; i < bucket.members.length; i += size) {
      bucketSlices.push(bucket.members.slice(i, i + size).map((s) => s._normIndex));
    }
    // Avoid leaving a single isolated student when this same cohort has >= 2 groups
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
