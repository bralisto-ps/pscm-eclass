import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import {
  computeCheckSheetTotals,
  computeHistogram,
  computePareto,
  computeProcessFlow,
  computeScatter,
  computeStratification,
  roundNum,
} from '../../lib/tqmLabMath.js';
import {
  buildLabCsvTemplate,
  getLabPreset,
  readLabSpreadsheetRows,
  TOOLS_PRESETS,
} from '../../lib/labsCatalog.js';
import { downloadText } from '../../lib/sheets.js';

const QC_TOOLS = [
  { id: 'checksheet', label: '1. Check Sheet' },
  { id: 'pareto', label: '2. Pareto (80/20)' },
  { id: 'fishbone', label: '3. Fishbone (Ishikawa)' },
  { id: 'histogram', label: '4. Histogram' },
  { id: 'scatter', label: '5. Scatter & r' },
  { id: 'stratification', label: '6. Stratification' },
  { id: 'flowchart', label: '7. Flowchart' },
];

function ParetoSvg({ pareto }) {
  if (!pareto?.rows?.length) return <div className="muted small">Add defect categories with positive counts to plot the Pareto chart.</div>;
  const W = 720;
  const H = 260;
  const pad = { top: 24, right: 54, bottom: 58, left: 50 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const rows = pareto.rows;
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const slotW = plotW / rows.length;
  const barW = Math.min(54, Math.max(18, slotW * 0.62));

  const yCount = (c) => pad.top + plotH - (c / maxCount) * plotH;
  const yPct = (p) => pad.top + plotH - (p / 100) * plotH;
  const xCenter = (i) => pad.left + slotW * i + slotW / 2;

  const cumPath = rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${xCenter(i).toFixed(1)},${yPct(r.cumPct).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Pareto Chart">
      {[0, 25, 50, 75, 100].map((pct) => {
        const y = yPct(pct);
        return (
          <g key={pct}>
            <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="var(--line-2)" />
            <text x={W - pad.right + 6} y={y + 4} fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">{pct}%</text>
          </g>
        );
      })}
      {/* 80% threshold line */}
      <line x1={pad.left} x2={W - pad.right} y1={yPct(80)} y2={yPct(80)} stroke="var(--amber)" strokeWidth="1.4" strokeDasharray="5 4" />
      <text x={pad.left + 6} y={yPct(80) - 5} fontSize="10" fill="var(--amber)" fontFamily="var(--mono)" fontWeight="600">80% Vital Few Cutoff</text>

      {rows.map((r, i) => {
        const x = xCenter(i) - barW / 2;
        const y = yCount(r.count);
        const h = Math.max(2, pad.top + plotH - y);
        const shortName = r.category.length > 14 ? `${r.category.slice(0, 13)}…` : r.category;
        return (
          <g key={r.category}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              rx="3"
              fill={r.vitalFew ? 'var(--teal)' : 'var(--field)'}
              fillOpacity={r.vitalFew ? 0.85 : 0.5}
            >
              <title>{`${r.category}: ${r.count} (${roundNum(r.pct, 1)}%, Cum: ${roundNum(r.cumPct, 1)}%)`}</title>
            </rect>
            <text x={xCenter(i)} y={y - 5} textAnchor="middle" fontSize="10" fill="var(--text)" fontFamily="var(--mono)" fontWeight="600">
              {r.count}
            </text>
            <text
              x={xCenter(i)}
              y={pad.top + plotH + 14}
              textAnchor="end"
              fontSize="10"
              fill="var(--muted)"
              transform={`rotate(-22 ${xCenter(i)} ${pad.top + plotH + 14})`}
            >
              {shortName}
            </text>
          </g>
        );
      })}

      {/* Cumulative % curve */}
      <path d={cumPath} fill="none" stroke="var(--red)" strokeWidth="2.2" />
      {rows.map((r, i) => (
        <circle key={i} cx={xCenter(i)} cy={yPct(r.cumPct)} r="4" fill="var(--red)" stroke="var(--surface)" strokeWidth="1.5">
          <title>{`${r.category}: Cumulative ${roundNum(r.cumPct, 1)}%`}</title>
        </circle>
      ))}
    </svg>
  );
}

function FishboneSvg({ problem, branches }) {
  const entries = Object.entries(branches || {});
  const topBones = entries.filter((_, i) => i % 2 === 0);
  const botBones = entries.filter((_, i) => i % 2 === 1);
  const W = 760;
  const H = 330;
  const spineY = 165;
  const headX = 610;
  const cols = Math.max(topBones.length, botBones.length, 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Ishikawa Fishbone Diagram">
      {/* Main spine */}
      <line x1="28" y1={spineY} x2={headX} y2={spineY} stroke="var(--text)" strokeWidth="2.5" />
      <polygon points={`${headX},${spineY - 6} ${headX + 12},${spineY} ${headX},${spineY + 6}`} fill="var(--text)" />
      {/* Problem effect head */}
      <rect x={headX + 12} y={spineY - 38} width="132" height="76" rx="8" fill="var(--teal-50)" stroke="var(--teal)" strokeWidth="1.8" />
      <foreignObject x={headX + 18} y={spineY - 32} width="120" height="64">
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ fontSize: 11, fontWeight: 700, color: 'var(--teal-900)', lineHeight: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>
          {problem || 'Quality Problem'}
        </div>
      </foreignObject>

      {/* Top bones */}
      {topBones.map(([cat, items], idx) => {
        const bx = 95 + idx * ((headX - 150) / Math.max(1, cols - 0.5));
        const tipX = bx - 52;
        const tipY = 34;
        return (
          <g key={cat}>
            <line x1={tipX} y1={tipY} x2={bx} y2={spineY} stroke="var(--teal)" strokeWidth="1.8" />
            <rect x={tipX - 38} y={8} width="96" height="22" rx="5" fill="var(--surface-2)" stroke="var(--line)" />
            <text x={tipX + 10} y={23} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">{cat}</text>
            {(items || []).slice(0, 4).map((cause, cIdx) => {
              const frac = 0.24 + cIdx * 0.21;
              const y = tipY + frac * (spineY - tipY);
              const xOnBone = tipX + frac * (bx - tipX);
              const txt = cause.length > 26 ? `${cause.slice(0, 25)}…` : cause;
              return (
                <g key={cIdx}>
                  <line x1={xOnBone - 18} y1={y} x2={xOnBone} y2={y} stroke="var(--muted)" strokeWidth="1" />
                  <text x={xOnBone - 22} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--text-2)">{txt}</text>
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Bottom bones */}
      {botBones.map(([cat, items], idx) => {
        const bx = 135 + idx * ((headX - 180) / Math.max(1, cols - 0.5));
        const tipX = bx - 52;
        const tipY = H - 34;
        return (
          <g key={cat}>
            <line x1={tipX} y1={tipY} x2={bx} y2={spineY} stroke="var(--teal)" strokeWidth="1.8" />
            <rect x={tipX - 38} y={H - 30} width="96" height="22" rx="5" fill="var(--surface-2)" stroke="var(--line)" />
            <text x={tipX + 10} y={H - 15} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">{cat}</text>
            {(items || []).slice(0, 4).map((cause, cIdx) => {
              const frac = 0.24 + cIdx * 0.21;
              const y = tipY - frac * (tipY - spineY);
              const xOnBone = tipX + frac * (bx - tipX);
              const txt = cause.length > 26 ? `${cause.slice(0, 25)}…` : cause;
              return (
                <g key={cIdx}>
                  <line x1={xOnBone - 18} y1={y} x2={xOnBone} y2={y} stroke="var(--muted)" strokeWidth="1" />
                  <text x={xOnBone - 22} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--text-2)">{txt}</text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function ScatterSvg({ scatter, xLabel, yLabel }) {
  if (!scatter) return <div className="muted small">Enter at least 2 (X, Y) pairs to plot the scatter diagram.</div>;
  const W = 720;
  const H = 250;
  const pad = { top: 20, right: 26, bottom: 44, left: 56 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const spanX = scatter.maxX - scatter.minX || 1;
  const spanY = scatter.maxY - scatter.minY || 1;
  const minX = scatter.minX - spanX * 0.1;
  const maxX = scatter.maxX + spanX * 0.1;
  const minY = scatter.minY - spanY * 0.12;
  const maxY = scatter.maxY + spanY * 0.12;

  const xOf = (x) => pad.left + ((x - minX) / (maxX - minX || 1)) * plotW;
  const yOf = (y) => pad.top + ((maxY - y) / (maxY - minY || 1)) * plotH;

  const regY1 = scatter.intercept + scatter.slope * scatter.minX;
  const regY2 = scatter.intercept + scatter.slope * scatter.maxX;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Scatter Diagram">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = pad.top + t * plotH;
        const val = maxY - t * (maxY - minY);
        return (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="var(--line-2)" />
            <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">{roundNum(val, 1)}</text>
          </g>
        );
      })}
      <line x1={pad.left} x2={W - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} stroke="var(--line)" />
      <line x1={xOf(scatter.minX)} y1={yOf(regY1)} x2={xOf(scatter.maxX)} y2={yOf(regY2)} stroke="var(--amber)" strokeWidth="2" strokeDasharray="5 4" />
      {scatter.points.map((p, i) => (
        <circle key={i} cx={xOf(p.x)} cy={yOf(p.y)} r="5" fill="var(--teal)" stroke="var(--surface)" strokeWidth="1.5">
          <title>{`${p.label}: (${p.x}, ${p.y})`}</title>
        </circle>
      ))}
      <text x={pad.left + plotW / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{xLabel}</text>
      <text x={14} y={pad.top + plotH / 2} textAnchor="middle" fontSize="11" fill="var(--muted)" transform={`rotate(-90 14 ${pad.top + plotH / 2})`}>{yLabel}</text>
    </svg>
  );
}

export default function QualityToolsLab({
  config,
  dataMode = 'both',
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const defaultPreset = useMemo(
    () => getLabPreset('tqm_tools', config?.presetId) || TOOLS_PRESETS[0],
    [config?.presetId],
  );
  const lecturerCustom = config?.customDataset || null;
  const allowStudentEdit = dataMode !== 'lecturer_only';

  const [activeTool, setActiveTool] = useState(draftState?.activeTool || 'checksheet');
  const [presetId, setPresetId] = useState(draftState?.presetId || defaultPreset.id);
  const [caseName, setCaseName] = useState(draftState?.caseName || lecturerCustom?.name || defaultPreset.name);

  // Tool states
  const [checkSheet, setCheckSheet] = useState(draftState?.checkSheet || lecturerCustom?.checkSheet || defaultPreset.checkSheet);
  const [fishbone, setFishbone] = useState(draftState?.fishbone || lecturerCustom?.fishbone || defaultPreset.fishbone);
  const [histState, setHistState] = useState(draftState?.histState || lecturerCustom?.histogram || defaultPreset.histogram);
  const [histBins, setHistBins] = useState(draftState?.histBins || 7);
  const [scatterState, setScatterState] = useState(draftState?.scatterState || lecturerCustom?.scatter || defaultPreset.scatter);
  const [stratState, setStratState] = useState(draftState?.stratState || lecturerCustom?.stratification || defaultPreset.stratification);
  const [flowSteps, setFlowSteps] = useState(draftState?.flowSteps || lecturerCustom?.flowchart || defaultPreset.flowchart);
  const [judgement, setJudgement] = useState(draftState?.judgement || '');

  const [newDefectName, setNewDefectName] = useState('');
  const [newBoneCat, setNewBoneCat] = useState('Man');
  const [newBoneCause, setNewBoneCause] = useState('');
  const [importError, setImportError] = useState('');
  const fileRef = useRef(null);

  function loadPreset(id) {
    const p = TOOLS_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(p.id);
    setCaseName(p.name);
    setCheckSheet(JSON.parse(JSON.stringify(p.checkSheet)));
    setFishbone(JSON.parse(JSON.stringify(p.fishbone)));
    setHistState(JSON.parse(JSON.stringify(p.histogram)));
    setScatterState(JSON.parse(JSON.stringify(p.scatter)));
    setStratState(JSON.parse(JSON.stringify(p.stratification)));
    setFlowSteps(JSON.parse(JSON.stringify(p.flowchart)));
    setNewBoneCat(Object.keys(p.fishbone.branches)[0] || 'Man');
  }

  const checkTotals = useMemo(
    () => computeCheckSheetTotals(checkSheet.rows, checkSheet.columns),
    [checkSheet],
  );

  const pareto = useMemo(
    () => computePareto(checkTotals.rows.map((r) => ({ category: r.name, count: r.total }))),
    [checkTotals],
  );

  const hist = useMemo(
    () => computeHistogram(histState.values, histBins, histState.lsl, histState.usl),
    [histState, histBins],
  );

  const scatter = useMemo(() => computeScatter(scatterState.points), [scatterState]);
  const strat = useMemo(() => computeStratification(stratState.records), [stratState]);
  const flow = useMemo(() => computeProcessFlow(flowSteps), [flowSteps]);

  useEffect(() => {
    onDraftChange?.({
      activeTool,
      presetId,
      caseName,
      checkSheet,
      fishbone,
      histState,
      histBins,
      scatterState,
      stratState,
      flowSteps,
      judgement,
    });
  }, [activeTool, presetId, caseName, checkSheet, fishbone, histState, histBins, scatterState, stratState, flowSteps, judgement, onDraftChange]);

  useEffect(() => {
    if (!onRegisterReportBuilder) return;
    onRegisterReportBuilder(() => {
      const lines = [
        `LABORATORY: TQM-LAB 02 — Seven Basic Tools of Quality`,
        `Case / Dataset: ${caseName}`,
        '',
        `1. CHECK SHEET & PARETO (80/20) ANALYSIS`,
        `- Total Defects Recorded: ${pareto.total}`,
        `- Vital Few Categories (${pareto.vitalFewCount} of ${pareto.rows.length}, accounting for ${roundNum(pareto.vitalFewShare, 1)}%):`,
        ...pareto.rows.map((r) => `    * ${r.category}: ${r.count} (${roundNum(r.pct, 1)}%, Cum ${roundNum(r.cumPct, 1)}%)${r.vitalFew ? ' [VITAL FEW]' : ''}`),
        '',
        `2. CAUSE-AND-EFFECT (ISHIKAWA FISHBONE): ${fishbone.problem}`,
        ...Object.entries(fishbone.branches || {}).map(([cat, list]) => `- ${cat}: ${(list || []).join('; ') || '(none)'}`),
        '',
        `3. HISTOGRAM (${histState.label})`,
        hist
          ? `- n = ${hist.n}, Mean = ${roundNum(hist.mean, 2)}, Median = ${roundNum(hist.median, 2)}, Std Dev = ${roundNum(hist.stdDev, 2)}, Shape: ${hist.shape}${hist.withinSpecPct != null ? `, Within Spec: ${roundNum(hist.withinSpecPct, 1)}%` : ''}`
          : '- No histogram values entered.',
        '',
        `4. SCATTER DIAGRAM (${scatterState.xLabel} vs. ${scatterState.yLabel})`,
        scatter
          ? `- Pearson r = ${roundNum(scatter.r, 3)}, R^2 = ${roundNum(scatter.r2, 3)}, Slope = ${roundNum(scatter.slope, 3)} (${scatter.strength})`
          : '- Insufficient scatter points.',
        '',
        `5. STRATIFICATION (${stratState.metricLabel})`,
        ...strat.strata.map((s) => `- ${s.name}: Mean = ${roundNum(s.mean, 2)} (n=${s.count}, Min=${roundNum(s.min, 2)}, Max=${roundNum(s.max, 2)})`),
        strat.highest && strat.lowest ? `- Highest vs. Lowest Stratum Spread Ratio: ${roundNum(strat.spreadRatio, 2)}x` : '',
        '',
        `6. PROCESS FLOWCHART & CYCLE EFFICIENCY`,
        `- Total Lead Time: ${flow.totalMin} min | Value-Added: ${flow.vaMin} min (${roundNum(flow.pcePct, 1)}% PCE) | Non-Value-Added Waste: ${flow.nvaMin} min`,
        flow.bottleneck ? `- Primary Bottleneck Step: ${flow.bottleneck.name} (${flow.bottleneck.minutes} min)` : '',
        '',
        `7. STUDENT WRITTEN QUALITY IMPROVEMENT PLAN`,
        judgement.trim() || '(No written judgement entered.)',
      ].filter((x) => x !== undefined);
      return {
        title: `7 Tools of Quality Report — ${caseName}`,
        body: lines.join('\n'),
        hasJudgement: judgement.trim().length >= 20,
      };
    });
  }, [onRegisterReportBuilder, caseName, pareto, fishbone, histState, hist, scatterState, scatter, stratState, strat, flow, judgement]);

  async function handleCsvImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    try {
      const rows = await readLabSpreadsheetRows(file);
      if (rows.length < 2) throw new Error('File must contain a header row and at least one data row.');
      if (activeTool === 'checksheet' || activeTool === 'pareto') {
        const cols = rows[0].slice(1).filter(Boolean);
        const useCols = cols.length ? cols : ['Count'];
        const nextRows = rows.slice(1).map((r, idx) => {
          const counts = {};
          useCols.forEach((c, ci) => { counts[c] = Math.max(0, Number(r[ci + 1]) || 0); });
          return { id: `imp_${idx}`, name: r[0] || `Category ${idx + 1}`, counts };
        }).filter((r) => r.name);
        if (!nextRows.length) throw new Error('No defect rows found.');
        setCheckSheet({ columns: useCols, rows: nextRows });
        setCaseName(file.name.replace(/\.[^.]+$/, ''));
      } else if (activeTool === 'histogram') {
        const vals = rows.flat().map(Number).filter(Number.isFinite);
        if (vals.length < 3) throw new Error('Need at least 3 numeric values for Histogram.');
        setHistState({ ...histState, label: rows[0][0] || file.name, values: vals });
      } else if (activeTool === 'scatter') {
        const pts = rows.slice(1).map((r, idx) => ({
          label: r.length >= 3 ? r[0] : `P${idx + 1}`,
          x: Number(r.length >= 3 ? r[1] : r[0]),
          y: Number(r.length >= 3 ? r[2] : r[1]),
        })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (pts.length < 2) throw new Error('Need at least 2 (X, Y) rows for Scatter Diagram.');
        setScatterState({
          xLabel: rows[0][rows[0].length >= 3 ? 1 : 0] || 'X',
          yLabel: rows[0][rows[0].length >= 3 ? 2 : 1] || 'Y',
          points: pts,
        });
      } else if (activeTool === 'stratification') {
        const recs = rows.slice(1).map((r) => ({ stratum: r[0], value: Number(r[1]) })).filter((r) => r.stratum && Number.isFinite(r.value));
        if (!recs.length) throw new Error('Use two columns: Stratum, Value.');
        setStratState({ metricLabel: rows[0][1] || 'Measured Metric', records: recs });
      }
    } catch (err) {
      setImportError(err.message || 'Could not import file.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function tally(rowId, col, delta) {
    if (!allowStudentEdit) return;
    setCheckSheet((prev) => ({
      ...prev,
      rows: prev.rows.map((r) =>
        r.id === rowId
          ? { ...r, counts: { ...r.counts, [col]: Math.max(0, (Number(r.counts[col]) || 0) + delta) } }
          : r,
      ),
    }));
  }

  function addDefectCategory() {
    const clean = newDefectName.trim();
    if (!clean) return;
    const counts = {};
    checkSheet.columns.forEach((c) => { counts[c] = 0; });
    setCheckSheet((prev) => ({
      ...prev,
      rows: [...prev.rows, { id: `d_${Date.now()}`, name: clean, counts }],
    }));
    setNewDefectName('');
  }

  function addFishboneCause() {
    const clean = newBoneCause.trim();
    if (!clean) return;
    setFishbone((prev) => ({
      ...prev,
      branches: {
        ...prev.branches,
        [newBoneCat]: [...(prev.branches[newBoneCat] || []), clean],
      },
    }));
    setNewBoneCause('');
  }

  function switchFishboneTemplate(tpl) {
    const cats = tpl === '4P'
      ? ['People', 'Policies', 'Procedures', 'Plant']
      : ['Man', 'Machine', 'Method', 'Material', 'Measurement', 'Environment'];
    const nextBranches = {};
    cats.forEach((c) => { nextBranches[c] = fishbone.branches[c] || []; });
    setFishbone({ ...fishbone, template: tpl, branches: nextBranches });
    setNewBoneCat(cats[0]);
  }

  return (
    <div className="stack-lg">
      {/* Tool Selector + Data Source Controls */}
      <div className="between" style={{ flexWrap: 'wrap', gap: 10, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
        <div className="row-wrap" style={{ gap: 6 }}>
          {QC_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`btn btn-sm ${activeTool === t.id ? 'btn-primary' : ''}`}
              onClick={() => setActiveTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="row-wrap" style={{ gap: 8 }}>
          {dataMode !== 'student_only' && allowStudentEdit && (
            <select
              className="input"
              style={{ width: 'auto', minWidth: 200, padding: '6px 10px', fontSize: 13 }}
              value={presetId}
              onChange={(e) => loadPreset(e.target.value)}
            >
              {TOOLS_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>Preset: {p.name}</option>
              ))}
            </select>
          )}
          {allowStudentEdit && ['checksheet', 'pareto', 'histogram', 'scatter', 'stratification'].includes(activeTool) && (
            <>
              <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleCsvImport} />
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={14} /> Upload CSV / Excel
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  const tpl = buildLabCsvTemplate('tqm_tools', activeTool);
                  downloadText(tpl.filename, tpl.content);
                }}
              >
                <Icon name="download" size={14} /> Template
              </button>
            </>
          )}
        </div>
      </div>

      {importError && <div className="notice notice-err small">{importError}</div>}

      {/* TOOL 1: CHECK SHEET */}
      {activeTool === 'checksheet' && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
          <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong style={{ fontSize: 15 }}>Defect Tally Check Sheet</strong>
              <div className="tiny muted">Record live tallies per shift or location. Totals flow directly into the Pareto (80/20) chart.</div>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setActiveTool('pareto')}>
              View Live Pareto Chart <Icon name="arrowRight" size={14} />
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Defect Category</th>
                  {checkSheet.columns.map((c) => <th key={c} className="mono">{c}</th>)}
                  <th className="mono">Total</th>
                </tr>
              </thead>
              <tbody>
                {checkTotals.rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong></td>
                    {checkSheet.columns.map((col) => (
                      <td key={col}>
                        <div className="row" style={{ gap: 6 }}>
                          {allowStudentEdit && (
                            <button type="button" className="btn btn-sm" style={{ padding: '2px 8px' }} onClick={() => tally(r.id, col, -1)}>−</button>
                          )}
                          <span className="mono" style={{ minWidth: 26, textAlign: 'center', fontWeight: 600 }}>{r.counts[col] || 0}</span>
                          {allowStudentEdit && (
                            <button type="button" className="btn btn-sm" style={{ padding: '2px 8px' }} onClick={() => tally(r.id, col, 1)}>+</button>
                          )}
                        </div>
                      </td>
                    ))}
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--teal-700)' }}>{r.total}</td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--surface-2)', fontWeight: 700 }}>
                  <td>Column Total</td>
                  {checkTotals.colTotals.map((t, i) => <td key={i} className="mono">{t}</td>)}
                  <td className="mono">{checkTotals.grandTotal}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {allowStudentEdit && (
            <div className="row" style={{ gap: 8, maxWidth: 460 }}>
              <input
                className="input"
                placeholder="Add new defect category…"
                value={newDefectName}
                onChange={(e) => setNewDefectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addDefectCategory()}
              />
              <button type="button" className="btn btn-sm" onClick={addDefectCategory}>
                <Icon name="plus" size={14} /> Add
              </button>
            </div>
          )}
        </div>
      )}

      {/* TOOL 2: PARETO CHART */}
      {activeTool === 'pareto' && (
        <div className="stack">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <div className="kpi"><div className="v mono" style={{ fontSize: 18 }}>{pareto.total}</div><div className="l">Total Defect Events</div></div>
            <div className="kpi"><div className="v mono" style={{ fontSize: 18, color: 'var(--teal-700)' }}>{pareto.vitalFewCount} of {pareto.rows.length}</div><div className="l">Vital Few Categories</div></div>
            <div className="kpi"><div className="v mono" style={{ fontSize: 18 }}>{roundNum(pareto.vitalFewShare, 1)}%</div><div className="l">Vital Few Share</div></div>
          </div>

          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
            <strong style={{ fontSize: 15 }}>Pareto Chart — Vital Few vs. Trivial Many</strong>
            <ParetoSvg pareto={pareto} />
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr><th>Rank</th><th>Category</th><th className="mono">Count</th><th className="mono">Share %</th><th className="mono">Cumulative %</th><th>Priority</th></tr>
              </thead>
              <tbody>
                {pareto.rows.map((r, i) => (
                  <tr key={r.category}>
                    <td className="mono">{i + 1}</td>
                    <td><strong>{r.category}</strong></td>
                    <td className="mono">{r.count}</td>
                    <td className="mono">{roundNum(r.pct, 1)}%</td>
                    <td className="mono">{roundNum(r.cumPct, 1)}%</td>
                    <td className="tiny mono" style={{ fontWeight: 600, color: r.vitalFew ? 'var(--teal-700)' : 'var(--muted)' }}>
                      {r.vitalFew ? '● VITAL FEW' : 'TRIVIAL MANY'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TOOL 3: FISHBONE / ISHIKAWA */}
      {activeTool === 'fishbone' && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
          <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="stack-xs tiny muted">
                Problem Statement (Fish Head)
                <input
                  className="input"
                  value={fishbone.problem}
                  disabled={!allowStudentEdit}
                  onChange={(e) => setFishbone({ ...fishbone, problem: e.target.value })}
                />
              </label>
            </div>
            {allowStudentEdit && (
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className={`btn btn-sm ${fishbone.template !== '4P' ? 'btn-primary' : ''}`} onClick={() => switchFishboneTemplate('6M')}>6M Manufacturing</button>
                <button type="button" className={`btn btn-sm ${fishbone.template === '4P' ? 'btn-primary' : ''}`} onClick={() => switchFishboneTemplate('4P')}>4P Service</button>
              </div>
            )}
          </div>

          <FishboneSvg problem={fishbone.problem} branches={fishbone.branches} />

          {allowStudentEdit && (
            <div className="row-wrap" style={{ gap: 8, paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
              <select className="input" style={{ width: 'auto' }} value={newBoneCat} onChange={(e) => setNewBoneCat(e.target.value)}>
                {Object.keys(fishbone.branches).map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <input
                className="input"
                style={{ flex: 1, minWidth: 220 }}
                placeholder="Add a root cause to this branch…"
                value={newBoneCause}
                onChange={(e) => setNewBoneCause(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addFishboneCause()}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={addFishboneCause}>Add Cause</button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {Object.entries(fishbone.branches).map(([cat, causes]) => (
              <div key={cat} className="card-soft stack-xs" style={{ padding: 10 }}>
                <strong className="small">{cat} ({causes.length})</strong>
                {causes.length === 0 && <span className="tiny muted">No causes listed yet.</span>}
                {causes.map((c, idx) => (
                  <div key={idx} className="between tiny" style={{ gap: 6 }}>
                    <span>{c}</span>
                    {allowStudentEdit && (
                      <button
                        type="button"
                        className="icon-btn plain"
                        aria-label="Remove cause"
                        onClick={() => setFishbone((prev) => ({
                          ...prev,
                          branches: { ...prev.branches, [cat]: prev.branches[cat].filter((_, j) => j !== idx) },
                        }))}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TOOL 4: HISTOGRAM */}
      {activeTool === 'histogram' && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
          <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong style={{ fontSize: 15 }}>Frequency Histogram — {histState.label}</strong>
              {hist && (
                <div className="tiny mono muted">
                  Mean {roundNum(hist.mean, 2)} · Median {roundNum(hist.median, 2)} · SD {roundNum(hist.stdDev, 2)} · {hist.shape}
                </div>
              )}
            </div>
            <label className="row tiny muted" style={{ gap: 8 }}>
              Bins: <strong className="mono">{histBins}</strong>
              <input type="range" min="4" max="14" value={histBins} onChange={(e) => setHistBins(Number(e.target.value))} />
            </label>
          </div>

          {hist && (
            <svg viewBox="0 0 720 220" style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Histogram">
              {hist.bins.map((b, i) => {
                const plotW = 630;
                const plotH = 160;
                const barW = plotW / hist.bins.length - 4;
                const x = 50 + i * (plotW / hist.bins.length) + 2;
                const h = (b.count / hist.maxBinCount) * plotH;
                const y = 20 + plotH - h;
                const out = (histState.lsl !== '' && b.mid < Number(histState.lsl)) || (histState.usl !== '' && b.mid > Number(histState.usl));
                return (
                  <g key={b.index}>
                    <rect x={x} y={y} width={Math.max(8, barW)} height={Math.max(2, h)} rx="3" fill={out ? 'var(--red)' : 'var(--teal)'} fillOpacity="0.72">
                      <title>{`${roundNum(b.lo, 2)}–${roundNum(b.hi, 2)}: ${b.count}`}</title>
                    </rect>
                    <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize="10" fill="var(--text)" fontFamily="var(--mono)">{b.count}</text>
                    <text x={x + barW / 2} y={200} textAnchor="middle" fontSize="9.5" fill="var(--muted)" fontFamily="var(--mono)">{roundNum(b.mid, 1)}</text>
                  </g>
                );
              })}
              <line x1="50" x2="680" y1="180" y2="180" stroke="var(--line)" />
            </svg>
          )}

          {allowStudentEdit && (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
              <label className="stack-xs tiny muted">
                Measurements (comma or space separated)
                <textarea
                  className="input mono"
                  rows={2}
                  defaultValue={histState.values.join(', ')}
                  key={histState.values.join(',')}
                  onBlur={(e) => {
                    const nums = e.target.value.split(/[,\s]+/).map(Number).filter(Number.isFinite);
                    if (nums.length >= 3) setHistState({ ...histState, values: nums });
                  }}
                />
              </label>
              <label className="stack-xs tiny muted">
                LSL (optional)
                <input className="input mono" type="number" step="any" value={histState.lsl ?? ''} onChange={(e) => setHistState({ ...histState, lsl: e.target.value })} />
              </label>
              <label className="stack-xs tiny muted">
                USL (optional)
                <input className="input mono" type="number" step="any" value={histState.usl ?? ''} onChange={(e) => setHistState({ ...histState, usl: e.target.value })} />
              </label>
            </div>
          )}
        </div>
      )}

      {/* TOOL 5: SCATTER & CORRELATION */}
      {activeTool === 'scatter' && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
          <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong style={{ fontSize: 15 }}>Scatter Diagram &amp; Linear Regression</strong>
              {scatter && (
                <div className="tiny mono muted">
                  r = {roundNum(scatter.r, 3)} · R² = {roundNum(scatter.r2, 3)} · y = {roundNum(scatter.intercept, 2)} + {roundNum(scatter.slope, 3)}x · <strong>{scatter.strength}</strong>
                </div>
              )}
            </div>
            {allowStudentEdit && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setScatterState({
                  ...scatterState,
                  points: [...scatterState.points, { label: `P${scatterState.points.length + 1}`, x: 50, y: 5 }],
                })}
              >
                <Icon name="plus" size={14} /> Add Point
              </button>
            )}
          </div>

          <ScatterSvg scatter={scatter} xLabel={scatterState.xLabel} yLabel={scatterState.yLabel} />

          <div style={{ maxHeight: 220, overflow: 'auto' }}>
            <table className="table" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Observation</th><th>{scatterState.xLabel} (X)</th><th>{scatterState.yLabel} (Y)</th>{allowStudentEdit && <th />}</tr></thead>
              <tbody>
                {scatterState.points.map((pt, i) => (
                  <tr key={i}>
                    <td className="mono">{pt.label}</td>
                    <td>
                      <input
                        className="input mono"
                        type="number"
                        step="any"
                        disabled={!allowStudentEdit}
                        style={{ width: 90, padding: '4px 6px' }}
                        value={pt.x}
                        onChange={(e) => setScatterState({
                          ...scatterState,
                          points: scatterState.points.map((p, j) => (j === i ? { ...p, x: Number(e.target.value) } : p)),
                        })}
                      />
                    </td>
                    <td>
                      <input
                        className="input mono"
                        type="number"
                        step="any"
                        disabled={!allowStudentEdit}
                        style={{ width: 90, padding: '4px 6px' }}
                        value={pt.y}
                        onChange={(e) => setScatterState({
                          ...scatterState,
                          points: scatterState.points.map((p, j) => (j === i ? { ...p, y: Number(e.target.value) } : p)),
                        })}
                      />
                    </td>
                    {allowStudentEdit && (
                      <td>
                        <button type="button" className="icon-btn plain" onClick={() => scatterState.points.length > 2 && setScatterState({ ...scatterState, points: scatterState.points.filter((_, j) => j !== i) })}>
                          <Icon name="trash" size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TOOL 6: STRATIFICATION */}
      {activeTool === 'stratification' && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
          <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong style={{ fontSize: 15 }}>Stratification Analysis — {stratState.metricLabel}</strong>
              <div className="tiny mono muted">
                Overall Mean: {roundNum(strat.overallMean, 2)} · Highest/Lowest Ratio: <strong>{roundNum(strat.spreadRatio, 2)}×</strong>
              </div>
            </div>
          </div>

          <div className="stack-sm">
            {strat.strata.map((st, idx) => {
              const maxM = Math.max(1, strat.highest?.mean || 1);
              const pct = (st.mean / maxM) * 100;
              const isWorst = idx === 0 && strat.spreadRatio >= 1.5;
              return (
                <div key={st.name} className="stack-xs">
                  <div className="between small">
                    <strong>{st.name} <span className="tiny muted">(n = {st.count})</span></strong>
                    <span className="mono" style={{ fontWeight: 600, color: isWorst ? 'var(--red)' : 'var(--text)' }}>
                      Mean {roundNum(st.mean, 2)} · Range [{roundNum(st.min, 1)}–{roundNum(st.max, 1)}]
                    </span>
                  </div>
                  <div style={{ height: 14, background: 'var(--track)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: isWorst ? 'var(--red)' : 'var(--teal)', borderRadius: 6 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TOOL 7: PROCESS FLOWCHART */}
      {activeTool === 'flowchart' && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <div className="kpi"><div className="v mono" style={{ fontSize: 18 }}>{flow.totalMin} min</div><div className="l">Total Cycle Time</div></div>
            <div className="kpi"><div className="v mono" style={{ fontSize: 18, color: 'var(--teal-700)' }}>{roundNum(flow.pcePct, 1)}%</div><div className="l">Process Cycle Efficiency</div></div>
            <div className="kpi"><div className="v mono" style={{ fontSize: 18, color: 'var(--red)' }}>{flow.nvaMin} min</div><div className="l">Non-Value-Added Waste</div></div>
            <div className="kpi"><div className="v" style={{ fontSize: 14 }}>{flow.bottleneck?.name || '—'}</div><div className="l">Primary Bottleneck</div></div>
          </div>

          {/* Visual horizontal process flow */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '12px 0' }}>
            {flow.steps.map((s, idx) => (
              <div key={s.id} className="row" style={{ gap: 8 }}>
                <div
                  style={{
                    border: `1.5px solid ${s.valueAdd === 'nva' ? 'var(--red)' : s.valueAdd === 'va' ? 'var(--teal)' : 'var(--amber)'}`,
                    borderRadius: s.type === 'start' || s.type === 'end' ? 999 : s.type === 'decision' ? 4 : 8,
                    padding: '8px 12px',
                    background: 'var(--surface-2)',
                    minWidth: 130,
                  }}
                >
                  <div className="tiny mono muted">{s.type.toUpperCase()} · {s.minutes}m</div>
                  <div className="small" style={{ fontWeight: 600 }}>{s.name}</div>
                  <div className="tiny" style={{ color: s.valueAdd === 'nva' ? 'var(--red)' : s.valueAdd === 'va' ? 'var(--teal-700)' : 'var(--amber)' }}>
                    {s.valueAdd === 'va' ? 'Value-Added' : s.valueAdd === 'nva' ? 'Waste (NVA)' : 'Business NVA'}
                  </div>
                </div>
                {idx < flow.steps.length - 1 && <Icon name="arrowRight" size={16} className="muted" />}
              </div>
            ))}
          </div>

          {allowStudentEdit && (
            <div className="stack-xs">
              <div className="between">
                <strong className="small">Edit Process Steps</strong>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setFlowSteps([...flowSteps, { id: `st_${Date.now()}`, name: 'New Step', type: 'process', minutes: 10, valueAdd: 'va', owner: 'Ops' }])}
                >
                  <Icon name="plus" size={14} /> Add Step
                </button>
              </div>
              <table className="table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>Step Name</th><th>Type</th><th>Minutes</th><th>Classification</th><th /></tr></thead>
                <tbody>
                  {flowSteps.map((s, idx) => (
                    <tr key={s.id}>
                      <td>
                        <input className="input" style={{ padding: '4px 6px' }} value={s.name} onChange={(e) => setFlowSteps(flowSteps.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x)))} />
                      </td>
                      <td>
                        <select className="input" style={{ padding: '4px 6px' }} value={s.type} onChange={(e) => setFlowSteps(flowSteps.map((x, j) => (j === idx ? { ...x, type: e.target.value } : x)))}>
                          <option value="start">Start</option>
                          <option value="process">Process</option>
                          <option value="decision">Decision / Inspect</option>
                          <option value="delay">Delay / Queue</option>
                          <option value="end">End</option>
                        </select>
                      </td>
                      <td>
                        <input className="input mono" type="number" min="0" style={{ width: 72, padding: '4px 6px' }} value={s.minutes} onChange={(e) => setFlowSteps(flowSteps.map((x, j) => (j === idx ? { ...x, minutes: Math.max(0, Number(e.target.value) || 0) } : x)))} />
                      </td>
                      <td>
                        <select className="input" style={{ padding: '4px 6px' }} value={s.valueAdd} onChange={(e) => setFlowSteps(flowSteps.map((x, j) => (j === idx ? { ...x, valueAdd: e.target.value } : x)))}>
                          <option value="va">Value-Added (VA)</option>
                          <option value="bnva">Necessary NVA</option>
                          <option value="nva">Waste (NVA)</option>
                        </select>
                      </td>
                      <td>
                        <button type="button" className="icon-btn plain" onClick={() => flowSteps.length > 2 && setFlowSteps(flowSteps.filter((_, j) => j !== idx))}>
                          <Icon name="trash" size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Written Management Judgement */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack-sm">
        <strong style={{ fontSize: 15 }}>Integrated Quality Diagnosis &amp; Improvement Plan</strong>
        <span className="tiny muted">
          {config?.instructions || 'Synthesize evidence from your Pareto 80/20 chart, Fishbone root causes, Histogram/Scatter/Stratification, and Process Cycle Efficiency into a prioritized action plan.'}
        </span>
        <textarea
          className="input"
          rows={4}
          placeholder="Write your quality engineering diagnosis and prioritized corrective actions here…"
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
        />
      </div>
    </div>
  );
}
