// Pure, deterministic statistical & financial math engine for TQM Interactive Labs:
// 1. Statistical Process Control (Xbar-R, Xbar-S, p-Chart, c-Chart, Cp/Cpk/Pp/Ppk, Western Electric rules)
// 2. Seven Basic Tools of Quality (Check Sheet, Pareto, Histogram, Scatter/OLS, Stratification, Process Flow)
// 3. Cost of Quality Models (PAF Ledger, Hidden COQ Iceberg, Optimal Quality Curve, What-If ROI, Classifier)

import { parseDelimited } from './sheets.js';

// Exact ASTM / Montgomery SPC Control Chart Constants (subgroup sizes n = 2..10)
export const SPC_CONSTANTS = {
  2:  { A2: 1.880, D3: 0,     D4: 3.267, d2: 1.128, A3: 2.659, B3: 0,     B4: 3.267, c4: 0.7979 },
  3:  { A2: 1.023, D3: 0,     D4: 2.574, d2: 1.693, A3: 1.954, B3: 0,     B4: 2.568, c4: 0.8862 },
  4:  { A2: 0.729, D3: 0,     D4: 2.282, d2: 2.059, A3: 1.628, B3: 0,     B4: 2.266, c4: 0.9213 },
  5:  { A2: 0.577, D3: 0,     D4: 2.114, d2: 2.326, A3: 1.427, B3: 0,     B4: 2.089, c4: 0.9400 },
  6:  { A2: 0.483, D3: 0,     D4: 2.004, d2: 2.534, A3: 1.287, B3: 0.030, B4: 1.970, c4: 0.9515 },
  7:  { A2: 0.419, D3: 0.076, D4: 1.924, d2: 2.704, A3: 1.182, B3: 0.118, B4: 1.882, c4: 0.9594 },
  8:  { A2: 0.373, D3: 0.136, D4: 1.864, d2: 2.847, A3: 1.099, B3: 0.185, B4: 1.815, c4: 0.9650 },
  9:  { A2: 0.337, D3: 0.184, D4: 1.816, d2: 2.970, A3: 1.032, B3: 0.239, B4: 1.761, c4: 0.9693 },
  10: { A2: 0.308, D3: 0.223, D4: 1.777, d2: 3.078, A3: 0.975, B3: 0.284, B4: 1.716, c4: 0.9727 },
};

export function roundNum(val, decimals = 3) {
  if (!Number.isFinite(val)) return 0;
  const f = Math.pow(10, decimals);
  return Math.round((val + Number.EPSILON) * f) / f;
}

export function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

export function sampleStdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// Standard Normal CDF using Abramowitz & Stegun 7.1.26 approximation (accuracy < 1.5e-7)
export function normalCdf(z) {
  if (!Number.isFinite(z)) return 0.5;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

// Western Electric / Nelson Rules for a series of points against CL, UCL, LCL
export function detectControlSignals(values, cl, uclArr, lclArr, labels = []) {
  const signals = [];
  const pointFlags = values.map(() => []);
  const getUcl = (i) => (Array.isArray(uclArr) ? uclArr[i] : uclArr);
  const getLcl = (i) => (Array.isArray(lclArr) ? lclArr[i] : lclArr);
  const labelOf = (i) => labels[i] || `#${i + 1}`;

  // Rule 1: Any point beyond UCL or LCL (3-sigma violation)
  values.forEach((v, i) => {
    const u = getUcl(i);
    const l = getLcl(i);
    if (v > u + 1e-9) {
      const msg = `${labelOf(i)}: Above UCL (${roundNum(v, 4)} > ${roundNum(u, 4)})`;
      signals.push({ index: i, label: labelOf(i), rule: 'Rule 1 (Beyond 3σ)', severity: 'high', detail: msg });
      pointFlags[i].push('Rule 1: Above UCL');
    } else if (v < l - 1e-9) {
      const msg = `${labelOf(i)}: Below LCL (${roundNum(v, 4)} < ${roundNum(l, 4)})`;
      signals.push({ index: i, label: labelOf(i), rule: 'Rule 1 (Beyond 3σ)', severity: 'high', detail: msg });
      pointFlags[i].push('Rule 1: Below LCL');
    }
  });

  // Rule 2: 7 consecutive points strictly on one side of CL (shift in process mean)
  let runSide = 0;
  let runLen = 0;
  for (let i = 0; i < values.length; i++) {
    const side = values[i] > cl + 1e-9 ? 1 : values[i] < cl - 1e-9 ? -1 : 0;
    if (side !== 0 && side === runSide) {
      runLen++;
    } else {
      runSide = side;
      runLen = side === 0 ? 0 : 1;
    }
    if (runLen === 7) {
      const dir = runSide > 0 ? 'above' : 'below';
      signals.push({
        index: i,
        label: labelOf(i),
        rule: 'Rule 2 (7-Point Run)',
        severity: 'medium',
        detail: `${labelOf(i - 6)}–${labelOf(i)}: 7 consecutive points ${dir} center line`,
      });
      for (let k = i - 6; k <= i; k++) {
        if (!pointFlags[k].includes(`Rule 2: Run ${dir} CL`)) pointFlags[k].push(`Rule 2: Run ${dir} CL`);
      }
    } else if (runLen > 7) {
      const dir = runSide > 0 ? 'above' : 'below';
      if (!pointFlags[i].includes(`Rule 2: Run ${dir} CL`)) pointFlags[i].push(`Rule 2: Run ${dir} CL`);
    }
  }

  // Rule 3: 6 consecutive points steadily increasing or decreasing (process drift/tool wear)
  let trendDir = 0;
  let trendLen = 1;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const dir = diff > 1e-9 ? 1 : diff < -1e-9 ? -1 : 0;
    if (dir !== 0 && dir === trendDir) {
      trendLen++;
    } else {
      trendDir = dir;
      trendLen = dir === 0 ? 1 : 2;
    }
    if (trendLen === 6) {
      const word = trendDir > 0 ? 'increasing' : 'decreasing';
      signals.push({
        index: i,
        label: labelOf(i),
        rule: 'Rule 3 (6-Point Trend)',
        severity: 'medium',
        detail: `${labelOf(i - 5)}–${labelOf(i)}: 6 consecutive points steadily ${word}`,
      });
      for (let k = i - 5; k <= i; k++) {
        if (!pointFlags[k].includes(`Rule 3: ${word} trend`)) pointFlags[k].push(`Rule 3: ${word} trend`);
      }
    } else if (trendLen > 6) {
      const word = trendDir > 0 ? 'increasing' : 'decreasing';
      if (!pointFlags[i].includes(`Rule 3: ${word} trend`)) pointFlags[i].push(`Rule 3: ${word} trend`);
    }
  }

  return { signals, pointFlags };
}

export function computeXbarR(subgroups) {
  const clean = (subgroups || [])
    .map((sg, idx) => ({
      label: String(sg.label || `S${idx + 1}`).trim(),
      values: (sg.values || []).map(Number).filter(Number.isFinite),
    }))
    .filter((sg) => sg.values.length >= 2);

  if (!clean.length) return null;
  const n = Math.min(10, Math.max(2, clean[0].values.length));
  const c = SPC_CONSTANTS[n] || SPC_CONSTANTS[5];

  const points = clean.map((sg) => {
    const vals = sg.values.slice(0, n);
    const xbar = mean(vals);
    const range = Math.max(...vals) - Math.min(...vals);
    const s = sampleStdDev(vals);
    return { label: sg.label, values: vals, xbar, range, s };
  });

  const xDoubleBar = mean(points.map((p) => p.xbar));
  const rBar = mean(points.map((p) => p.range));
  const uclX = xDoubleBar + c.A2 * rBar;
  const lclX = xDoubleBar - c.A2 * rBar;
  const uclR = c.D4 * rBar;
  const lclR = c.D3 * rBar;

  const sigmaWithin = c.d2 > 0 ? rBar / c.d2 : 0;
  const allValues = points.flatMap((p) => p.values);
  const sigmaOverall = sampleStdDev(allValues);

  const labels = points.map((p) => p.label);
  const xDiag = detectControlSignals(points.map((p) => p.xbar), xDoubleBar, uclX, lclX, labels);
  const rDiag = detectControlSignals(points.map((p) => p.range), rBar, uclR, lclR, labels);

  return {
    chartType: 'xbar_r',
    n,
    k: points.length,
    constants: c,
    points,
    allValues,
    primary: {
      title: 'X-bar Chart (Subgroup Means)',
      values: points.map((p) => p.xbar),
      cl: xDoubleBar,
      ucl: uclX,
      lcl: lclX,
      signals: xDiag.signals,
      pointFlags: xDiag.pointFlags,
    },
    secondary: {
      title: 'R Chart (Subgroup Ranges)',
      values: points.map((p) => p.range),
      cl: rBar,
      ucl: uclR,
      lcl: lclR,
      signals: rDiag.signals,
      pointFlags: rDiag.pointFlags,
    },
    sigmaWithin,
    sigmaOverall,
    inControl: xDiag.signals.length === 0 && rDiag.signals.length === 0,
    totalSignals: xDiag.signals.length + rDiag.signals.length,
  };
}

export function computeXbarS(subgroups) {
  const clean = (subgroups || [])
    .map((sg, idx) => ({
      label: String(sg.label || `S${idx + 1}`).trim(),
      values: (sg.values || []).map(Number).filter(Number.isFinite),
    }))
    .filter((sg) => sg.values.length >= 2);

  if (!clean.length) return null;
  const n = Math.min(10, Math.max(2, clean[0].values.length));
  const c = SPC_CONSTANTS[n] || SPC_CONSTANTS[5];

  const points = clean.map((sg) => {
    const vals = sg.values.slice(0, n);
    const xbar = mean(vals);
    const s = sampleStdDev(vals);
    const range = Math.max(...vals) - Math.min(...vals);
    return { label: sg.label, values: vals, xbar, s, range };
  });

  const xDoubleBar = mean(points.map((p) => p.xbar));
  const sBar = mean(points.map((p) => p.s));
  const uclX = xDoubleBar + c.A3 * sBar;
  const lclX = xDoubleBar - c.A3 * sBar;
  const uclS = c.B4 * sBar;
  const lclS = c.B3 * sBar;

  const sigmaWithin = c.c4 > 0 ? sBar / c.c4 : 0;
  const allValues = points.flatMap((p) => p.values);
  const sigmaOverall = sampleStdDev(allValues);

  const labels = points.map((p) => p.label);
  const xDiag = detectControlSignals(points.map((p) => p.xbar), xDoubleBar, uclX, lclX, labels);
  const sDiag = detectControlSignals(points.map((p) => p.s), sBar, uclS, lclS, labels);

  return {
    chartType: 'xbar_s',
    n,
    k: points.length,
    constants: c,
    points,
    allValues,
    primary: {
      title: 'X-bar Chart (Subgroup Means)',
      values: points.map((p) => p.xbar),
      cl: xDoubleBar,
      ucl: uclX,
      lcl: lclX,
      signals: xDiag.signals,
      pointFlags: xDiag.pointFlags,
    },
    secondary: {
      title: 'S Chart (Subgroup Std. Dev.)',
      values: points.map((p) => p.s),
      cl: sBar,
      ucl: uclS,
      lcl: lclS,
      signals: sDiag.signals,
      pointFlags: sDiag.pointFlags,
    },
    sigmaWithin,
    sigmaOverall,
    inControl: xDiag.signals.length === 0 && sDiag.signals.length === 0,
    totalSignals: xDiag.signals.length + sDiag.signals.length,
  };
}

export function computePChart(samples) {
  const clean = (samples || [])
    .map((row, idx) => ({
      label: String(row.label || `L${idx + 1}`).trim(),
      n: Math.max(1, Math.round(Number(row.n) || 0)),
      defects: Math.max(0, Math.round(Number(row.defects) || 0)),
    }))
    .filter((row) => row.n > 0);

  if (!clean.length) return null;
  const totalN = clean.reduce((s, r) => s + r.n, 0);
  const totalDefects = clean.reduce((s, r) => s + Math.min(r.n, r.defects), 0);
  const pBar = totalN > 0 ? totalDefects / totalN : 0;

  const points = clean.map((r) => {
    const def = Math.min(r.n, r.defects);
    const p = def / r.n;
    const se = Math.sqrt((pBar * (1 - pBar)) / r.n);
    const ucl = Math.min(1, pBar + 3 * se);
    const lcl = Math.max(0, pBar - 3 * se);
    return { ...r, defects: def, p, ucl, lcl };
  });

  const labels = points.map((p) => p.label);
  const values = points.map((p) => p.p);
  const uclArr = points.map((p) => p.ucl);
  const lclArr = points.map((p) => p.lcl);
  const variableN = new Set(points.map((p) => p.n)).size > 1;
  const diag = detectControlSignals(values, pBar, uclArr, lclArr, labels);

  return {
    chartType: 'p_chart',
    k: points.length,
    totalN,
    totalDefects,
    variableN,
    points,
    primary: {
      title: 'p-Chart (Proportion Defective)',
      values,
      cl: pBar,
      ucl: variableN ? uclArr : uclArr[0],
      lcl: variableN ? lclArr : lclArr[0],
      signals: diag.signals,
      pointFlags: diag.pointFlags,
    },
    secondary: null,
    inControl: diag.signals.length === 0,
    totalSignals: diag.signals.length,
  };
}

export function computeCChart(samples) {
  const clean = (samples || [])
    .map((row, idx) => ({
      label: String(row.label || `U${idx + 1}`).trim(),
      defects: Math.max(0, Number(row.defects) || 0),
    }))
    .filter((row) => Number.isFinite(row.defects));

  if (!clean.length) return null;
  const values = clean.map((r) => r.defects);
  const cBar = mean(values);
  const ucl = cBar + 3 * Math.sqrt(Math.max(0, cBar));
  const lcl = Math.max(0, cBar - 3 * Math.sqrt(Math.max(0, cBar)));
  const labels = clean.map((r) => r.label);
  const diag = detectControlSignals(values, cBar, ucl, lcl, labels);

  return {
    chartType: 'c_chart',
    k: clean.length,
    totalDefects: values.reduce((s, v) => s + v, 0),
    points: clean,
    primary: {
      title: 'c-Chart (Defects per Inspection Unit)',
      values,
      cl: cBar,
      ucl,
      lcl,
      signals: diag.signals,
      pointFlags: diag.pointFlags,
    },
    secondary: null,
    inControl: diag.signals.length === 0,
    totalSignals: diag.signals.length,
  };
}

export function computeCapability(allValues, sigmaWithin, lsl, usl, target = null) {
  const vals = (allValues || []).map(Number).filter(Number.isFinite);
  const lo = Number(lsl);
  const hi = Number(usl);
  if (!vals.length || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;

  const mu = mean(vals);
  const sigW = Number(sigmaWithin) > 0 ? Number(sigmaWithin) : sampleStdDev(vals);
  const sigO = sampleStdDev(vals);
  if (sigW <= 0) return null;

  const cp = (hi - lo) / (6 * sigW);
  const cpu = (hi - mu) / (3 * sigW);
  const cpl = (mu - lo) / (3 * sigW);
  const cpk = Math.min(cpu, cpl);

  const pp = sigO > 0 ? (hi - lo) / (6 * sigO) : cp;
  const ppu = sigO > 0 ? (hi - mu) / (3 * sigO) : cpu;
  const ppl = sigO > 0 ? (mu - lo) / (3 * sigO) : cpl;
  const ppk = Math.min(ppu, ppl);

  const pBelow = normalCdf((lo - mu) / sigW);
  const pAbove = 1 - normalCdf((hi - mu) / sigW);
  const estDefectRate = Math.max(0, Math.min(1, pBelow + pAbove));
  const estPpm = Math.round(estDefectRate * 1_000_000);
  const observedOut = vals.filter((v) => v < lo || v > hi).length;
  const sigmaLevel = cpk * 3;

  let verdict = 'Not Capable';
  let tone = 'bad';
  if (cpk >= 1.67) { verdict = 'World-Class Capable'; tone = 'good'; }
  else if (cpk >= 1.33) { verdict = 'Capable (Standard)'; tone = 'good'; }
  else if (cpk >= 1.0) { verdict = 'Marginally Capable'; tone = 'warn'; }

  const specTarget = Number.isFinite(Number(target)) && target !== '' && target !== null
    ? Number(target)
    : (lo + hi) / 2;

  return {
    mean: mu,
    sigmaWithin: sigW,
    sigmaOverall: sigO,
    lsl: lo,
    usl: hi,
    target: specTarget,
    cp,
    cpu,
    cpl,
    cpk,
    pp,
    ppk,
    sigmaLevel,
    estPpm,
    yieldPct: (1 - estDefectRate) * 100,
    observedOut,
    totalCount: vals.length,
    verdict,
    tone,
  };
}

export function parseSpcCsv(text, chartType) {
  const rows = parseDelimited(text);
  if (!rows.length) return [];

  if (chartType === 'xbar_r' || chartType === 'xbar_s') {
    const out = [];
    rows.forEach((r, idx) => {
      const nums = r.map((c) => Number(String(c).trim())).filter(Number.isFinite);
      if (idx === 0 && nums.length < 2) return; // skip header row
      if (nums.length < 2) return;
      const firstIsLabel = !Number.isFinite(Number(String(r[0]).trim())) || r.length > nums.length;
      const label = firstIsLabel ? String(r[0]).trim() || `S${out.length + 1}` : `S${out.length + 1}`;
      const values = firstIsLabel
        ? r.slice(1).map((c) => Number(String(c).trim())).filter(Number.isFinite)
        : nums;
      if (values.length >= 2) out.push({ label, values });
    });
    return out;
  }

  if (chartType === 'p_chart') {
    const out = [];
    rows.forEach((r, idx) => {
      if (r.length < 2) return;
      const maybeFirstNum = Number(r[0]);
      const maybeSecondNum = Number(r[1]);
      const maybeThirdNum = Number(r[2]);
      if (idx === 0 && !Number.isFinite(maybeSecondNum) && !Number.isFinite(maybeThirdNum)) return;
      if (r.length >= 3 && Number.isFinite(maybeSecondNum) && Number.isFinite(maybeThirdNum)) {
        out.push({ label: String(r[0] || `L${out.length + 1}`).trim(), n: maybeSecondNum, defects: maybeThirdNum });
      } else if (Number.isFinite(maybeFirstNum) && Number.isFinite(maybeSecondNum)) {
        out.push({ label: `L${out.length + 1}`, n: maybeFirstNum, defects: maybeSecondNum });
      }
    });
    return out;
  }

  // c_chart
  const out = [];
  rows.forEach((r, idx) => {
    if (!r.length) return;
    if (r.length >= 2 && Number.isFinite(Number(r[1]))) {
      out.push({ label: String(r[0] || `U${out.length + 1}`).trim(), defects: Number(r[1]) });
    } else if (Number.isFinite(Number(r[0]))) {
      out.push({ label: `U${out.length + 1}`, defects: Number(r[0]) });
    } else if (idx === 0) {
      return;
    }
  });
  return out;
}

// ============================================================================
// 2. SEVEN BASIC TOOLS OF QUALITY MATH
// ============================================================================

export function computeCheckSheetTotals(rows, columns) {
  const colTotals = columns.map((col) =>
    rows.reduce((s, r) => s + Math.max(0, Number(r.counts?.[col]) || 0), 0),
  );
  const enrichedRows = rows.map((r) => {
    const total = columns.reduce((s, col) => s + Math.max(0, Number(r.counts?.[col]) || 0), 0);
    return { ...r, total };
  });
  const grandTotal = enrichedRows.reduce((s, r) => s + r.total, 0);
  return { rows: enrichedRows, colTotals, grandTotal };
}

export function computePareto(items) {
  const clean = (items || [])
    .map((it) => ({
      category: String(it.category || it.name || '').trim(),
      count: Math.max(0, Number(it.count ?? it.value) || 0),
    }))
    .filter((it) => it.category && it.count > 0)
    .sort((a, b) => b.count - a.count);

  const total = clean.reduce((s, x) => s + x.count, 0);
  let cum = 0;
  let reached80 = false;
  const rows = clean.map((x) => {
    const prevCumPct = total > 0 ? (cum / total) * 100 : 0;
    cum += x.count;
    const pct = total > 0 ? (x.count / total) * 100 : 0;
    const cumPct = total > 0 ? (cum / total) * 100 : 0;
    const vitalFew = !reached80 || prevCumPct < 80;
    if (cumPct >= 80) reached80 = true;
    return { ...x, pct, cumCount: cum, cumPct, vitalFew };
  });

  const vitalFewCount = rows.filter((r) => r.vitalFew).length;
  const vitalFewShare = rows.filter((r) => r.vitalFew).reduce((s, r) => s + r.pct, 0);

  return { rows, total, vitalFewCount, vitalFewShare };
}

export function computeHistogram(values, requestedBins = 0, lsl = null, usl = null) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  if (!nums.length) return null;

  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;
  const minVal = sorted[0];
  const maxVal = sorted[n - 1];
  const mu = mean(sorted);
  const med = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const sd = sampleStdDev(sorted);

  const binCount = requestedBins > 1
    ? Math.min(20, Math.max(3, Math.round(requestedBins)))
    : Math.min(14, Math.max(4, Math.ceil(1 + 3.322 * Math.log10(Math.max(2, n)))));

  const span = maxVal - minVal || 1;
  const width = span / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => {
    const lo = minVal + i * width;
    const hi = i === binCount - 1 ? maxVal : minVal + (i + 1) * width;
    return { index: i, lo, hi, mid: (lo + hi) / 2, count: 0 };
  });

  sorted.forEach((v) => {
    let idx = Math.floor((v - minVal) / width);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  });

  let skew = 0;
  if (sd > 0 && n >= 3) {
    skew = sorted.reduce((s, v) => s + ((v - mu) / sd) ** 3, 0) / n;
  }

  let shape = 'Roughly Symmetric / Bell-Shaped';
  if (skew > 0.5) shape = 'Right-Skewed (Positive Tail)';
  else if (skew < -0.5) shape = 'Left-Skewed (Negative Tail)';

  const loSpec = lsl !== null && lsl !== '' && Number.isFinite(Number(lsl)) ? Number(lsl) : null;
  const hiSpec = usl !== null && usl !== '' && Number.isFinite(Number(usl)) ? Number(usl) : null;
  let withinSpecPct = null;
  if (loSpec !== null || hiSpec !== null) {
    const inside = sorted.filter((v) => (loSpec === null || v >= loSpec) && (hiSpec === null || v <= hiSpec)).length;
    withinSpecPct = (inside / n) * 100;
  }

  return {
    n,
    min: minVal,
    max: maxVal,
    mean: mu,
    median: med,
    stdDev: sd,
    skewness: skew,
    shape,
    bins,
    maxBinCount: Math.max(1, ...bins.map((b) => b.count)),
    withinSpecPct,
  };
}

export function computeScatter(points) {
  const clean = (points || [])
    .map((p, idx) => ({
      label: String(p.label || `P${idx + 1}`).trim(),
      x: Number(p.x),
      y: Number(p.y),
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  if (clean.length < 2) return null;
  const mx = mean(clean.map((p) => p.x));
  const my = mean(clean.map((p) => p.y));

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  clean.forEach((p) => {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  });

  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const r2 = r * r;

  const absR = Math.abs(r);
  const dir = r >= 0 ? 'Positive' : 'Negative';
  let strength = 'No Linear Correlation';
  if (absR >= 0.8) strength = `Strong ${dir} Correlation`;
  else if (absR >= 0.5) strength = `Moderate ${dir} Correlation`;
  else if (absR >= 0.25) strength = `Weak ${dir} Correlation`;

  return {
    points: clean,
    n: clean.length,
    meanX: mx,
    meanY: my,
    slope,
    intercept,
    r,
    r2,
    strength,
    minX: Math.min(...clean.map((p) => p.x)),
    maxX: Math.max(...clean.map((p) => p.x)),
    minY: Math.min(...clean.map((p) => p.y)),
    maxY: Math.max(...clean.map((p) => p.y)),
  };
}

export function computeStratification(records) {
  const byGroup = new Map();
  (records || []).forEach((rec) => {
    const stratum = String(rec.stratum || 'Unassigned').trim() || 'Unassigned';
    const val = Number(rec.value);
    if (!Number.isFinite(val)) return;
    if (!byGroup.has(stratum)) byGroup.set(stratum, []);
    byGroup.get(stratum).push(val);
  });

  const strata = [...byGroup.entries()].map(([name, vals]) => ({
    name,
    count: vals.length,
    total: vals.reduce((s, v) => s + v, 0),
    mean: mean(vals),
    min: Math.min(...vals),
    max: Math.max(...vals),
    stdDev: sampleStdDev(vals),
  }));

  strata.sort((a, b) => b.mean - a.mean);
  const allVals = strata.flatMap((s) => Array(s.count).fill(s.mean));
  const overallMean = allVals.length ? mean(allVals) : 0;
  const highest = strata[0] || null;
  const lowest = strata[strata.length - 1] || null;
  const spreadRatio = highest && lowest && lowest.mean > 0 ? highest.mean / lowest.mean : 1;

  return { strata, overallMean, highest, lowest, spreadRatio };
}

export function computeProcessFlow(steps) {
  const clean = (steps || []).map((s, idx) => ({
    id: s.id || `step_${idx + 1}`,
    name: String(s.name || `Step ${idx + 1}`).trim(),
    type: s.type || 'process', // start | process | decision | delay | end
    minutes: Math.max(0, Number(s.minutes) || 0),
    valueAdd: s.valueAdd || 'va', // va | nva | bnva
    owner: String(s.owner || '').trim(),
  }));

  const totalMin = clean.reduce((sum, s) => sum + s.minutes, 0);
  const vaMin = clean.filter((s) => s.valueAdd === 'va').reduce((sum, s) => sum + s.minutes, 0);
  const bnvaMin = clean.filter((s) => s.valueAdd === 'bnva').reduce((sum, s) => sum + s.minutes, 0);
  const nvaMin = clean.filter((s) => s.valueAdd === 'nva').reduce((sum, s) => sum + s.minutes, 0);
  const pcePct = totalMin > 0 ? (vaMin / totalMin) * 100 : 0;
  const bottleneck = clean.reduce((best, s) => (!best || s.minutes > best.minutes ? s : best), null);

  return { steps: clean, totalMin, vaMin, bnvaMin, nvaMin, pcePct, bottleneck };
}

// ============================================================================
// 3. COST OF QUALITY (COQ) MODELS MATH
// ============================================================================

export const PAF_CATEGORIES = [
  { id: 'prevention', label: 'Prevention', short: 'P', group: 'conformance', desc: 'Training, SPC setup, quality planning, supplier qualification' },
  { id: 'appraisal', label: 'Appraisal', short: 'A', group: 'conformance', desc: 'Inspection, lab testing, incoming audits, gauge calibration' },
  { id: 'internal_failure', label: 'Internal Failure', short: 'IF', group: 'nonconformance', desc: 'Scrap, rework, re-inspection, machine downtime before shipment' },
  { id: 'external_failure', label: 'External Failure', short: 'EF', group: 'nonconformance', desc: 'Returns, warranty claims, recalls, complaints, penalties after delivery' },
];

export function computePafSummary(items, revenue = 0, unitsProduced = 0) {
  const totals = { prevention: 0, appraisal: 0, internal_failure: 0, external_failure: 0 };
  (items || []).forEach((it) => {
    const amt = Math.max(0, Number(it.amount) || 0);
    if (totals[it.category] !== undefined) totals[it.category] += amt;
  });

  const conformance = totals.prevention + totals.appraisal;
  const copq = totals.internal_failure + totals.external_failure;
  const totalCoq = conformance + copq;
  const rev = Math.max(0, Number(revenue) || 0);
  const units = Math.max(0, Number(unitsProduced) || 0);

  const shareOfCoq = {
    prevention: totalCoq > 0 ? (totals.prevention / totalCoq) * 100 : 0,
    appraisal: totalCoq > 0 ? (totals.appraisal / totalCoq) * 100 : 0,
    internal_failure: totalCoq > 0 ? (totals.internal_failure / totalCoq) * 100 : 0,
    external_failure: totalCoq > 0 ? (totals.external_failure / totalCoq) * 100 : 0,
  };

  const coqPctRevenue = rev > 0 ? (totalCoq / rev) * 100 : 0;
  const copqPctRevenue = rev > 0 ? (copq / rev) * 100 : 0;
  const costPerUnit = units > 0 ? totalCoq / units : 0;
  const failureToConformance = conformance > 0 ? copq / conformance : copq > 0 ? Infinity : 0;

  let maturity = 'High-Firefighting (Reactive)';
  let tone = 'bad';
  if (totalCoq === 0) { maturity = 'No Cost Data'; tone = 'muted'; }
  else if (coqPctRevenue > 0 && coqPctRevenue <= 4 && totals.prevention >= totals.external_failure) {
    maturity = 'World-Class TQM (Prevention-Led)';
    tone = 'good';
  } else if (conformance >= copq) {
    maturity = 'Transitioning (Control-Focused)';
    tone = 'warn';
  }

  return {
    totals,
    shareOfCoq,
    conformance,
    copq,
    totalCoq,
    conformancePct: totalCoq > 0 ? (conformance / totalCoq) * 100 : 0,
    copqPct: totalCoq > 0 ? (copq / totalCoq) * 100 : 0,
    coqPctRevenue,
    copqPctRevenue,
    costPerUnit,
    failureToConformance,
    maturity,
    tone,
  };
}

export function computeIcebergModel(visibleCopq, multipliers = {}) {
  const vis = Math.max(0, Number(visibleCopq) || 0);
  const lostCustomers = vis * Math.max(0, Number(multipliers.lostCustomers ?? 1.2));
  const expeditedOps = vis * Math.max(0, Number(multipliers.expeditedOps ?? 0.45));
  const mgmtFirefighting = vis * Math.max(0, Number(multipliers.mgmtFirefighting ?? 0.6));
  const brandErosion = vis * Math.max(0, Number(multipliers.brandErosion ?? 0.75));
  const hiddenTotal = lostCustomers + expeditedOps + mgmtFirefighting + brandErosion;
  const trueCopq = vis + hiddenTotal;
  const ratio = vis > 0 ? trueCopq / vis : 0;

  return {
    visible: vis,
    hiddenBreakdown: [
      { id: 'lostCustomers', label: 'Lost Repeat Customers & Churn', amount: lostCustomers },
      { id: 'brandErosion', label: 'Reputation & Price-Discount Erosion', amount: brandErosion },
      { id: 'mgmtFirefighting', label: 'Management & Engineering Firefighting', amount: mgmtFirefighting },
      { id: 'expeditedOps', label: 'Expedited Freight & Rush Overtime', amount: expeditedOps },
    ],
    hiddenTotal,
    trueCopq,
    ratio,
    hiddenPct: trueCopq > 0 ? (hiddenTotal / trueCopq) * 100 : 0,
  };
}

// Classical Juran/Lundvall (finite optimum < 100%) vs Modern Zero-Defect TQM (optimum at ~100%)
export function computeOptimalQualityCurve({ baseFailure = 120000, basePrevention = 15000, model = 'classical' }) {
  const fBase = Math.max(1000, Number(baseFailure) || 120000);
  const pBase = Math.max(500, Number(basePrevention) || 15000);
  const points = [];

  for (let q = 55; q <= 99; q += 2) {
    const frac = q / 100;
    const defectFrac = Math.max(0.005, 1 - frac);
    // Failure costs drop smoothly toward 0 as conformance approaches 100%
    const failureCost = fBase * Math.pow(defectFrac / 0.45, 1.55);
    // Classical: P+A shoots up asymptotically as q -> 100% (100% inspection bottleneck)
    // Modern TQM: poka-yoke & SPC make P+A rise gradually to a finite ceiling
    const conformanceCost = model === 'modern'
      ? pBase * (0.4 + 1.45 * Math.pow((frac - 0.5) / 0.5, 1.35))
      : pBase * (0.35 + 0.16 / Math.pow(defectFrac, 1.15));
    const totalCost = failureCost + conformanceCost;
    points.push({
      qualityPct: q,
      failureCost: roundNum(failureCost, 0),
      conformanceCost: roundNum(conformanceCost, 0),
      totalCost: roundNum(totalCost, 0),
    });
  }

  const optimal = points.reduce((best, pt) => (!best || pt.totalCost < best.totalCost ? pt : best), null);
  return { model, points, optimal };
}

export function computeCoqWhatIf(summary, {
  deltaPrevention = 0,
  deltaAppraisal = 0,
  internalReductionPct = 0,
  externalReductionPct = 0,
  revenue = 0,
}) {
  const dp = Number(deltaPrevention) || 0;
  const da = Number(deltaAppraisal) || 0;
  const intRed = Math.min(95, Math.max(0, Number(internalReductionPct) || 0)) / 100;
  const extRed = Math.min(95, Math.max(0, Number(externalReductionPct) || 0)) / 100;

  const newP = Math.max(0, summary.totals.prevention + dp);
  const newA = Math.max(0, summary.totals.appraisal + da);
  const savedIF = summary.totals.internal_failure * intRed;
  const savedEF = summary.totals.external_failure * extRed;
  const newIF = summary.totals.internal_failure - savedIF;
  const newEF = summary.totals.external_failure - savedEF;

  const addedInvestment = Math.max(0, dp + da);
  const grossSavings = savedIF + savedEF;
  const netSavings = grossSavings - (dp + da);
  const newTotalCoq = newP + newA + newIF + newEF;
  const roiPct = addedInvestment > 0 ? (netSavings / addedInvestment) * 100 : 0;
  const paybackMonths = addedInvestment > 0 && grossSavings > 0 ? (addedInvestment / grossSavings) * 12 : null;
  const newCoqPctRevenue = revenue > 0 ? (newTotalCoq / revenue) * 100 : 0;

  return {
    newTotals: { prevention: newP, appraisal: newA, internal_failure: newIF, external_failure: newEF },
    newTotalCoq,
    addedInvestment,
    grossSavings,
    netSavings,
    roiPct,
    paybackMonths,
    newCoqPctRevenue,
  };
}

export function scorePafClassification(items, studentMap) {
  const gradable = (items || []).filter((it) => it.category);
  if (!gradable.length) return { correct: 0, total: 0, pct: 0, missed: [] };
  let correct = 0;
  const missed = [];
  gradable.forEach((it) => {
    const picked = studentMap?.[it.id] || '';
    if (picked === it.category) correct++;
    else missed.push({ id: it.id, name: it.name, picked: picked || 'Unassigned', expected: it.category });
  });
  return {
    correct,
    total: gradable.length,
    pct: Math.round((correct / gradable.length) * 100),
    missed,
  };
}
