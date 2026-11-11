// Helpers for storing and retrieving course-level metadata (CA 1 & 2 grouping, exam marks, and release status)
// Safely serialized in courses.description without requiring database schema changes or breaking PostgREST cache.

export function parseCourseMeta(course) {
  const raw = course?.description || '';
  const fallback = {
    about: raw,
    ca_config: {
      ca1_name: 'CA 1',
      ca1_weight: 20,
      ca2_name: 'CA 2',
      ca2_weight: 20,
      ca1_components: [],
      ca2_components: [],
    },
    exam_config: {
      released: false,
      max_score: 60,
      scores: {},
    },
  };

  if (!raw || typeof raw !== 'string') return fallback;
  if (!raw.trim().startsWith('{') || !raw.trim().endsWith('}')) return fallback;

  try {
    const parsed = JSON.parse(raw);
    return {
      about: parsed.about || '',
      ca_config: {
        ca1_name: parsed.ca_config?.ca1_name || 'CA 1',
        ca1_weight: Number(parsed.ca_config?.ca1_weight ?? 20),
        ca2_name: parsed.ca_config?.ca2_name || 'CA 2',
        ca2_weight: Number(parsed.ca_config?.ca2_weight ?? 20),
        ca1_components: Array.isArray(parsed.ca_config?.ca1_components) ? parsed.ca_config.ca1_components : [],
        ca2_components: Array.isArray(parsed.ca_config?.ca2_components) ? parsed.ca_config.ca2_components : [],
      },
      exam_config: {
        released: Boolean(parsed.exam_config?.released),
        max_score: Number(parsed.exam_config?.max_score ?? 60),
        scores: parsed.exam_config?.scores && typeof parsed.exam_config.scores === 'object' ? parsed.exam_config.scores : {},
      },
    };
  } catch {
    return fallback;
  }
}

export function serializeCourseMeta(about, ca_config, exam_config) {
  return JSON.stringify({
    about: String(about || '').trim(),
    ca_config: ca_config || {
      ca1_name: 'CA 1',
      ca1_weight: 20,
      ca2_name: 'CA 2',
      ca2_weight: 20,
      ca1_components: [],
      ca2_components: [],
    },
    exam_config: exam_config || {
      released: false,
      max_score: 60,
      scores: {},
    },
  });
}

// Compute CA 1 (/20), CA 2 (/20), and Total CA (/40) for a student row
export function computeStudentCA(row, savedComponents, caConfig, courseCaTotal = 40) {
  const cfg = caConfig || {
    ca1_name: 'CA 1',
    ca1_weight: 20,
    ca2_name: 'CA 2',
    ca2_weight: 20,
    ca1_components: [],
    ca2_components: [],
  };

  const w1 = Number(cfg.ca1_weight || 20);
  const w2 = Number(cfg.ca2_weight || 20);
  const caTotalTarget = w1 + w2; // typically 40

  const rawTotal = Number(row.total || 0);
  const totalScaleFactor = Number(courseCaTotal) > 0 ? (caTotalTarget / Number(courseCaTotal)) : 1;
  const scaledTotal = rawTotal * totalScaleFactor;

  // If lecturer explicitly partitioned components into CA 1 and CA 2
  const set1 = new Set(cfg.ca1_components || []);
  const set2 = new Set(cfg.ca2_components || []);

  if (set1.size > 0 || set2.size > 0) {
    let p1 = 0;
    let p2 = 0;
    let sumW1 = 0;
    let sumW2 = 0;

    savedComponents.forEach((c) => {
      const pts = Number(row.parts?.[c.id]?.points ?? 0);
      const cw = Number(c.weight || 0);
      if (set1.has(c.id)) {
        p1 += pts;
        sumW1 += cw;
      } else if (set2.has(c.id)) {
        p2 += pts;
        sumW2 += cw;
      } else {
        // Not explicitly assigned, balance across
        p2 += pts;
        sumW2 += cw;
      }
    });

    const ca1 = sumW1 > 0 ? (p1 / sumW1) * w1 : (w1 > 0 ? (p1 / (sumW1 || w1)) * w1 : 0);
    const ca2 = sumW2 > 0 ? (p2 / sumW2) * w2 : (w2 > 0 ? (p2 / (sumW2 || w2)) * w2 : 0);

    return {
      ca1: Number(ca1.toFixed(2)),
      ca2: Number(ca2.toFixed(2)),
      totalCa: Number((ca1 + ca2).toFixed(2)),
      w1,
      w2,
      wTotal: caTotalTarget,
    };
  }

  // Default automatic grouping:
  // If there are 2 components: comp 1 -> CA 1, comp 2 -> CA 2
  if (savedComponents.length === 2) {
    const c1 = savedComponents[0];
    const c2 = savedComponents[1];
    const p1 = Number(row.parts?.[c1.id]?.points ?? 0);
    const p2 = Number(row.parts?.[c2.id]?.points ?? 0);
    const scale1 = Number(c1.weight) > 0 ? (w1 / Number(c1.weight)) : 1;
    const scale2 = Number(c2.weight) > 0 ? (w2 / Number(c2.weight)) : 1;
    const ca1 = p1 * scale1;
    const ca2 = p2 * scale2;
    return {
      ca1: Number(ca1.toFixed(2)),
      ca2: Number(ca2.toFixed(2)),
      totalCa: Number((ca1 + ca2).toFixed(2)),
      w1,
      w2,
      wTotal: caTotalTarget,
    };
  }

  // If multiple components: quizzes to CA 1 (scaled to w1), other work to CA 2 (scaled to w2)
  const quizComps = savedComponents.filter((c) => c.kind === 'quizzes');
  const otherComps = savedComponents.filter((c) => c.kind !== 'quizzes');

  if (quizComps.length > 0 && otherComps.length > 0) {
    const qPts = quizComps.reduce((s, c) => s + Number(row.parts?.[c.id]?.points ?? 0), 0);
    const qW = quizComps.reduce((s, c) => s + Number(c.weight ?? 0), 0);
    const oPts = otherComps.reduce((s, c) => s + Number(row.parts?.[c.id]?.points ?? 0), 0);
    const oW = otherComps.reduce((s, c) => s + Number(c.weight ?? 0), 0);

    const ca1 = qW > 0 ? (qPts / qW) * w1 : (scaledTotal * (w1 / caTotalTarget));
    const ca2 = oW > 0 ? (oPts / oW) * w2 : (scaledTotal * (w2 / caTotalTarget));

    return {
      ca1: Number(ca1.toFixed(2)),
      ca2: Number(ca2.toFixed(2)),
      totalCa: Number((ca1 + ca2).toFixed(2)),
      w1,
      w2,
      wTotal: caTotalTarget,
    };
  }

  // Proportional 50/50 split of the total CA
  const ca1 = scaledTotal * (w1 / caTotalTarget);
  const ca2 = scaledTotal * (w2 / caTotalTarget);
  return {
    ca1: Number(ca1.toFixed(2)),
    ca2: Number(ca2.toFixed(2)),
    totalCa: Number((ca1 + ca2).toFixed(2)),
    w1,
    w2,
    wTotal: caTotalTarget,
  };
}
