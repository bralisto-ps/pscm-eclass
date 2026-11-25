import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import {
  computeCapability,
  computeCChart,
  computeHistogram,
  computePChart,
  computeXbarR,
  computeXbarS,
  parseSpcCsv,
  roundNum,
} from '../../lib/tqmLabMath.js';
import {
  buildLabCsvTemplate,
  getLabPreset,
  readLabSpreadsheetRows,
  SPC_PRESETS,
} from '../../lib/labsCatalog.js';
import { downloadText } from '../../lib/sheets.js';

const CHART_TYPES = [
  { id: 'xbar_r', label: 'X-bar & R', desc: 'Subgroup mean & range (n = 2–10)' },
  { id: 'xbar_s', label: 'X-bar & S', desc: 'Subgroup mean & std. dev.' },
  { id: 'p_chart', label: 'p-Chart', desc: 'Proportion defective (attributes)' },
  { id: 'c_chart', label: 'c-Chart', desc: 'Defects per unit (attributes)' },
];

function SpcSvgChart({ title, series, labels, unit = '', decimals = 3, onSelectPoint, selectedIndex }) {
  const { values, cl, ucl, lcl, pointFlags } = series;
  const W = 720;
  const H = 220;
  const pad = { top: 22, right: 64, bottom: 32, left: 56 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const uclArr = Array.isArray(ucl) ? ucl : values.map(() => ucl);
  const lclArr = Array.isArray(lcl) ? lcl : values.map(() => lcl);
  const allNums = [...values, ...uclArr, ...lclArr, cl].filter(Number.isFinite);
  const rawMin = Math.min(...allNums);
  const rawMax = Math.max(...allNums);
  const span = rawMax - rawMin || 1;
  const yMin = rawMin - span * 0.14;
  const yMax = rawMax + span * 0.14;

  const xOf = (i) => (values.length <= 1 ? pad.left + plotW / 2 : pad.left + (i / (values.length - 1)) * plotW);
  const yOf = (v) => pad.top + ((yMax - v) / (yMax - yMin || 1)) * plotH;

  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const uclPath = uclArr.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const lclPath = lclArr.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');

  const lastUcl = uclArr[uclArr.length - 1];
  const lastLcl = lclArr[lclArr.length - 1];
  const hasViolation = series.signals.length > 0;

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)', padding: 14 }}>
      <div className="between" style={{ marginBottom: 8, gap: 10, flexWrap: 'wrap' }}>
        <div>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <span className="muted tiny" style={{ marginLeft: 10 }}>
            UCL {roundNum(lastUcl, decimals)} · CL {roundNum(cl, decimals)} · LCL {roundNum(lastLcl, decimals)}{unit ? ` ${unit}` : ''}
          </span>
        </div>
        <span
          className="tiny mono"
          style={{
            fontWeight: 600,
            color: hasViolation ? 'var(--red)' : 'var(--teal-700)',
          }}
        >
          {hasViolation ? `▲ ${series.signals.length} SIGNAL${series.signals.length === 1 ? '' : 'S'}` : '● IN CONTROL'}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }} role="img" aria-label={title}>
        {/* Horizontal gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = pad.top + t * plotH;
          const val = yMax - t * (yMax - yMin);
          return (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="var(--line-2)" strokeWidth="1" />
              <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">
                {roundNum(val, decimals)}
              </text>
            </g>
          );
        })}

        {/* Control limit lines */}
        <path d={uclPath} fill="none" stroke="var(--red)" strokeWidth="1.5" strokeDasharray="5 4" />
        <line x1={pad.left} x2={W - pad.right} y1={yOf(cl)} y2={yOf(cl)} stroke="var(--teal)" strokeWidth="1.5" />
        <path d={lclPath} fill="none" stroke="var(--red)" strokeWidth="1.5" strokeDasharray="5 4" />

        {/* Right-side limit labels */}
        <text x={W - pad.right + 6} y={yOf(lastUcl) + 3} fontSize="10" fill="var(--red)" fontFamily="var(--mono)" fontWeight="600">UCL</text>
        <text x={W - pad.right + 6} y={yOf(cl) + 3} fontSize="10" fill="var(--teal-700)" fontFamily="var(--mono)" fontWeight="600">CL</text>
        <text x={W - pad.right + 6} y={yOf(lastLcl) + 3} fontSize="10" fill="var(--red)" fontFamily="var(--mono)" fontWeight="600">LCL</text>

        {/* Main series line */}
        <path d={linePath} fill="none" stroke="var(--text)" strokeWidth="1.8" />

        {/* Data points */}
        {values.map((v, i) => {
          const flags = pointFlags[i] || [];
          const bad = flags.length > 0;
          const active = selectedIndex === i;
          const cx = xOf(i);
          const cy = yOf(v);
          const step = values.length > 14 ? 2 : 1;
          return (
            <g key={i} style={{ cursor: 'pointer' }} onClick={() => onSelectPoint?.(i)}>
              {active && <circle cx={cx} cy={cy} r="9" fill="none" stroke="var(--teal)" strokeWidth="2" />}
              <circle
                cx={cx}
                cy={cy}
                r={bad ? 5 : 3.8}
                fill={bad ? 'var(--red)' : 'var(--teal)'}
                stroke="var(--surface)"
                strokeWidth="1.5"
              >
                <title>{`${labels[i]}: ${roundNum(v, decimals)}${flags.length ? ` (${flags.join('; ')})` : ''}`}</title>
              </circle>
              {(i % step === 0 || i === values.length - 1) && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">
                  {labels[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function CapabilityHistogramSvg({ hist, capability, unit = '' }) {
  if (!hist || !capability) return null;
  const W = 720;
  const H = 180;
  const pad = { top: 22, right: 20, bottom: 30, left: 42 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const minX = Math.min(hist.min, capability.lsl) - (capability.usl - capability.lsl) * 0.08;
  const maxX = Math.max(hist.max, capability.usl) + (capability.usl - capability.lsl) * 0.08;
  const spanX = maxX - minX || 1;
  const xOf = (v) => pad.left + ((v - minX) / spanX) * plotW;
  const yOf = (count) => pad.top + plotH - (count / hist.maxBinCount) * plotH;

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface)', padding: 14 }}>
      <div className="between" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Capability Distribution vs. Specification Limits</strong>
        <span className="tiny mono muted">
          LSL {capability.lsl} · Target {roundNum(capability.target, 2)} · USL {capability.usl}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Capability Histogram">
        {hist.bins.map((b) => {
          const x1 = xOf(b.lo);
          const x2 = xOf(b.hi);
          const barW = Math.max(4, x2 - x1 - 2);
          const y = yOf(b.count);
          const out = b.mid < capability.lsl || b.mid > capability.usl;
          return (
            <g key={b.index}>
              <rect
                x={x1 + 1}
                y={y}
                width={barW}
                height={Math.max(0, pad.top + plotH - y)}
                rx="2"
                fill={out ? 'var(--red)' : 'var(--teal)'}
                fillOpacity={out ? 0.55 : 0.35}
                stroke={out ? 'var(--red)' : 'var(--teal)'}
                strokeWidth="1"
              >
                <title>{`[${roundNum(b.lo, 2)}, ${roundNum(b.hi, 2)}]: ${b.count} readings`}</title>
              </rect>
            </g>
          );
        })}

        {/* LSL, Mean, USL vertical markers */}
        {[
          { x: capability.lsl, label: 'LSL', color: 'var(--red)', dash: '4 3' },
          { x: capability.mean, label: 'Mean', color: 'var(--text)', dash: '' },
          { x: capability.usl, label: 'USL', color: 'var(--red)', dash: '4 3' },
        ].map((m) => (
          <g key={m.label}>
            <line
              x1={xOf(m.x)}
              x2={xOf(m.x)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke={m.color}
              strokeWidth="1.8"
              strokeDasharray={m.dash || undefined}
            />
            <text x={xOf(m.x)} y={pad.top - 6} textAnchor="middle" fontSize="10" fill={m.color} fontFamily="var(--mono)" fontWeight="600">
              {m.label}
            </text>
          </g>
        ))}

        {/* X axis labels */}
        <line x1={pad.left} x2={W - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} stroke="var(--line)" />
        {[minX, capability.lsl, capability.mean, capability.usl, maxX].map((v, i) => (
          <text key={i} x={xOf(v)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">
            {roundNum(v, 2)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export default function SpcLab({
  config,
  dataMode = 'both',
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const defaultPreset = useMemo(
    () => getLabPreset('tqm_spc', config?.presetId) || SPC_PRESETS[0],
    [config?.presetId],
  );
  const lecturerCustom = config?.customDataset || null;

  const initialSource = draftState?.sourceMode
    || (dataMode === 'student_only' ? 'student' : lecturerCustom ? 'lecturer' : 'preset');

  const [sourceMode, setSourceMode] = useState(initialSource);
  const [presetId, setPresetId] = useState(draftState?.presetId || defaultPreset.id);
  const [chartType, setChartType] = useState(
    draftState?.chartType || lecturerCustom?.chartType || defaultPreset.chartType || 'xbar_r',
  );
  const [datasetName, setDatasetName] = useState(
    draftState?.datasetName || lecturerCustom?.name || defaultPreset.name,
  );
  const [unit, setUnit] = useState(draftState?.unit ?? lecturerCustom?.unit ?? defaultPreset.unit ?? '');
  const [lsl, setLsl] = useState(String(draftState?.lsl ?? lecturerCustom?.lsl ?? defaultPreset.lsl ?? ''));
  const [usl, setUsl] = useState(String(draftState?.usl ?? lecturerCustom?.usl ?? defaultPreset.usl ?? ''));
  const [target, setTarget] = useState(String(draftState?.target ?? lecturerCustom?.target ?? defaultPreset.target ?? ''));

  const [subgroups, setSubgroups] = useState(
    draftState?.subgroups || lecturerCustom?.subgroups || defaultPreset.subgroups || SPC_PRESETS[0].subgroups,
  );
  const [pSamples, setPSamples] = useState(
    draftState?.pSamples || lecturerCustom?.pSamples || SPC_PRESETS[2].pSamples,
  );
  const [cSamples, setCSamples] = useState(
    draftState?.cSamples || lecturerCustom?.cSamples || SPC_PRESETS[3].cSamples,
  );

  const [selectedPoint, setSelectedPoint] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importError, setImportError] = useState('');
  const fileRef = useRef(null);

  // Interactive student diagnostic & written judgement
  const [studentControlCall, setStudentControlCall] = useState(draftState?.studentControlCall || '');
  const [studentCapCall, setStudentCapCall] = useState(draftState?.studentCapCall || '');
  const [judgement, setJudgement] = useState(draftState?.judgement || '');

  const allowStudentEdit = dataMode !== 'lecturer_only';

  function loadPreset(id) {
    const p = SPC_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(p.id);
    setSourceMode('preset');
    setChartType(p.chartType);
    setDatasetName(p.name);
    setUnit(p.unit || '');
    setLsl(p.lsl != null ? String(p.lsl) : '');
    setUsl(p.usl != null ? String(p.usl) : '');
    setTarget(p.target != null ? String(p.target) : '');
    if (p.subgroups) setSubgroups(p.subgroups.map((sg) => ({ ...sg, values: [...sg.values] })));
    if (p.pSamples) setPSamples(p.pSamples.map((r) => ({ ...r })));
    if (p.cSamples) setCSamples(p.cSamples.map((r) => ({ ...r })));
    setSelectedPoint(null);
  }

  function loadLecturerDataset() {
    if (!lecturerCustom) {
      loadPreset(defaultPreset.id);
      return;
    }
    setSourceMode('lecturer');
    setChartType(lecturerCustom.chartType || 'xbar_r');
    setDatasetName(lecturerCustom.name || 'Course Assigned Dataset');
    setUnit(lecturerCustom.unit || '');
    setLsl(lecturerCustom.lsl != null ? String(lecturerCustom.lsl) : '');
    setUsl(lecturerCustom.usl != null ? String(lecturerCustom.usl) : '');
    setTarget(lecturerCustom.target != null ? String(lecturerCustom.target) : '');
    if (lecturerCustom.subgroups?.length) setSubgroups(lecturerCustom.subgroups);
    if (lecturerCustom.pSamples?.length) setPSamples(lecturerCustom.pSamples);
    if (lecturerCustom.cSamples?.length) setCSamples(lecturerCustom.cSamples);
    setSelectedPoint(null);
  }

  const spcResult = useMemo(() => {
    if (chartType === 'xbar_r') return computeXbarR(subgroups);
    if (chartType === 'xbar_s') return computeXbarS(subgroups);
    if (chartType === 'p_chart') return computePChart(pSamples);
    return computeCChart(cSamples);
  }, [chartType, subgroups, pSamples, cSamples]);

  const isVariableChart = chartType === 'xbar_r' || chartType === 'xbar_s';

  const capability = useMemo(() => {
    if (!isVariableChart || !spcResult?.allValues?.length) return null;
    return computeCapability(spcResult.allValues, spcResult.sigmaWithin, lsl, usl, target);
  }, [isVariableChart, spcResult, lsl, usl, target]);

  const capHistogram = useMemo(() => {
    if (!capability || !spcResult?.allValues?.length) return null;
    return computeHistogram(spcResult.allValues, 8, capability.lsl, capability.usl);
  }, [capability, spcResult]);

  // Auto-verification check of student's diagnostic classification
  const diagCheck = useMemo(() => {
    if (!spcResult) return null;
    const expectedControl = spcResult.inControl ? 'in_control' : 'out_of_control';
    const expectedCap = !capability ? null : capability.cpk >= 1.33 ? 'capable' : capability.cpk >= 1.0 ? 'marginal' : 'not_capable';
    let checks = 0;
    let correct = 0;
    if (studentControlCall) {
      checks++;
      if (studentControlCall === expectedControl) correct++;
    }
    if (expectedCap && studentCapCall) {
      checks++;
      if (studentCapCall === expectedCap) correct++;
    }
    const maxChecks = expectedCap ? 2 : 1;
    return { expectedControl, expectedCap, checks, correct, maxChecks };
  }, [spcResult, capability, studentControlCall, studentCapCall]);

  // Persist draft state upward
  useEffect(() => {
    onDraftChange?.({
      sourceMode,
      presetId,
      chartType,
      datasetName,
      unit,
      lsl,
      usl,
      target,
      subgroups,
      pSamples,
      cSamples,
      studentControlCall,
      studentCapCall,
      judgement,
    });
  }, [sourceMode, presetId, chartType, datasetName, unit, lsl, usl, target, subgroups, pSamples, cSamples, studentControlCall, studentCapCall, judgement, onDraftChange]);

  // Register report generator for PDF export and direct Assignment submission
  useEffect(() => {
    if (!onRegisterReportBuilder) return;
    onRegisterReportBuilder(() => {
      const lines = [
        `LABORATORY: Statistical Process Control (SPC) & Process Capability`,
        `Dataset: ${datasetName} (${sourceMode === 'student' ? 'Student-Supplied Data' : sourceMode === 'lecturer' ? 'Course-Assigned Data' : 'Starter Preset'})`,
        `Chart Type: ${CHART_TYPES.find((c) => c.id === chartType)?.label || chartType}`,
        '',
        '1. CONTROL CHART PARAMETERS & LIMITS',
      ];
      if (spcResult) {
        const p = spcResult.primary;
        const u = Array.isArray(p.ucl) ? `${roundNum(Math.min(...p.ucl), 4)} to ${roundNum(Math.max(...p.ucl), 4)} (variable n)` : roundNum(p.ucl, 4);
        const l = Array.isArray(p.lcl) ? `${roundNum(Math.min(...p.lcl), 4)} to ${roundNum(Math.max(...p.lcl), 4)}` : roundNum(p.lcl, 4);
        lines.push(`- Subgroups / Samples (k): ${spcResult.k}${spcResult.n ? `, Subgroup size (n): ${spcResult.n}` : ''}`);
        lines.push(`- Primary Chart (${p.title}): UCL = ${u}, CL = ${roundNum(p.cl, 4)}, LCL = ${l}`);
        if (spcResult.secondary) {
          const s = spcResult.secondary;
          lines.push(`- Secondary Chart (${s.title}): UCL = ${roundNum(s.ucl, 4)}, CL = ${roundNum(s.cl, 4)}, LCL = ${roundNum(s.lcl, 4)}`);
        }
        lines.push(`- Statistical Control Verdict: ${spcResult.inControl ? 'IN STATISTICAL CONTROL (0 signals)' : `OUT OF CONTROL (${spcResult.totalSignals} signal(s) detected)`}`);
        const allSignals = [...(p.signals || []), ...(spcResult.secondary?.signals || [])];
        if (allSignals.length) {
          lines.push('- Signals Detected (Western Electric Rules 1–3):');
          allSignals.forEach((sig) => lines.push(`    * ${sig.rule}: ${sig.detail}`));
        }
      }
      if (capability) {
        lines.push('');
        lines.push('2. PROCESS CAPABILITY INDICES');
        lines.push(`- Spec Limits: LSL = ${capability.lsl}, Target = ${roundNum(capability.target, 3)}, USL = ${capability.usl} ${unit}`);
        lines.push(`- Process Mean = ${roundNum(capability.mean, 4)}, Within Sigma = ${roundNum(capability.sigmaWithin, 4)}, Overall Sigma = ${roundNum(capability.sigmaOverall, 4)}`);
        lines.push(`- Cp = ${roundNum(capability.cp, 3)}, Cpk = ${roundNum(capability.cpk, 3)} (Cpu = ${roundNum(capability.cpu, 3)}, Cpl = ${roundNum(capability.cpl, 3)})`);
        lines.push(`- Pp = ${roundNum(capability.pp, 3)}, Ppk = ${roundNum(capability.ppk, 3)}`);
        lines.push(`- Estimated Yield = ${roundNum(capability.yieldPct, 2)}%, Est. PPM Defectives = ${capability.estPpm.toLocaleString()}, Observed Out-of-Spec = ${capability.observedOut}/${capability.totalCount}`);
        lines.push(`- Capability Classification: ${capability.verdict}`);
      }
      lines.push('');
      lines.push('3. STUDENT DIAGNOSTIC CHECK');
      if (diagCheck) {
        lines.push(`- Auto-Verified Diagnostic Score: ${diagCheck.correct}/${diagCheck.maxChecks} (${Math.round((diagCheck.correct / diagCheck.maxChecks) * 100)}%)`);
        lines.push(`- Student Control Verdict: ${studentControlCall || 'Not selected'}`);
        if (capability) lines.push(`- Student Capability Verdict: ${studentCapCall || 'Not selected'}`);
      }
      lines.push('');
      lines.push('4. STUDENT WRITTEN MANAGEMENT JUDGEMENT & CORRECTIVE ACTION');
      lines.push(judgement.trim() || '(No written judgement entered.)');
      return {
        title: `SPC Lab Report — ${datasetName}`,
        body: lines.join('\n'),
        hasJudgement: judgement.trim().length >= 20,
      };
    });
  }, [onRegisterReportBuilder, datasetName, sourceMode, chartType, spcResult, capability, unit, diagCheck, studentControlCall, studentCapCall, judgement]);

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    try {
      const rows = await readLabSpreadsheetRows(file);
      const csv = rows.map((r) => r.join(',')).join('\n');
      applyImportedCsv(csv, file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      setImportError(err.message || 'Could not read spreadsheet.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function applyImportedCsv(text, labelName = 'My Uploaded Dataset') {
    setImportError('');
    const parsed = parseSpcCsv(text, chartType);
    if (!parsed.length) {
      setImportError(
        chartType === 'p_chart'
          ? 'Could not parse p-Chart rows. Use columns: Sample, SampleSize_n, Defects_d'
          : chartType === 'c_chart'
            ? 'Could not parse c-Chart rows. Use columns: Unit, Defects_c'
            : 'Could not parse subgroups. Use columns: Subgroup, X1, X2, X3, ... (at least 2 numbers per row).',
      );
      return;
    }
    setSourceMode('student');
    setDatasetName(labelName);
    if (isVariableChart) setSubgroups(parsed);
    else if (chartType === 'p_chart') setPSamples(parsed);
    else setCSamples(parsed);
    setPasteOpen(false);
    setPasteText('');
    setSelectedPoint(null);
  }

  function exportCurrentCsv() {
    if (isVariableChart) {
      const nCols = subgroups[0]?.values?.length || 5;
      const head = ['Subgroup', ...Array.from({ length: nCols }, (_, i) => `X${i + 1}`)].join(',');
      const body = subgroups.map((sg) => [sg.label, ...sg.values].join(',')).join('\n');
      downloadText('spc-data.csv', `${head}\n${body}\n`);
    } else if (chartType === 'p_chart') {
      const body = pSamples.map((r) => `${r.label},${r.n},${r.defects}`).join('\n');
      downloadText('spc-p-chart.csv', `Sample,SampleSize_n,Defects_d\n${body}\n`);
    } else {
      const body = cSamples.map((r) => `${r.label},${r.defects}`).join('\n');
      downloadText('spc-c-chart.csv', `Unit,Defects_c\n${body}\n`);
    }
  }

  function addRow() {
    setSourceMode('student');
    if (isVariableChart) {
      const nCols = subgroups[0]?.values?.length || 5;
      const base = spcResult?.primary?.cl || 500;
      setSubgroups([...subgroups, { label: `S${String(subgroups.length + 1).padStart(2, '0')}`, values: Array(nCols).fill(roundNum(base, 2)) }]);
    } else if (chartType === 'p_chart') {
      setPSamples([...pSamples, { label: `Day ${pSamples.length + 1}`, n: 150, defects: 6 }]);
    } else {
      setCSamples([...cSamples, { label: `Lot ${cSamples.length + 1}`, defects: 5 }]);
    }
  }

  const decimals = chartType === 'p_chart' ? 4 : 3;
  const labels = spcResult?.points?.map((p) => p.label) || [];
  const allSignals = [
    ...(spcResult?.primary?.signals || []),
    ...(spcResult?.secondary?.signals || []),
  ];

  return (
    <div className="stack-lg">
      {/* Top Toolbar: Chart Type + Data Source Switcher */}
      <div className="between" style={{ flexWrap: 'wrap', gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
        <div className="row-wrap" style={{ gap: 6 }}>
          {CHART_TYPES.map((ct) => (
            <button
              key={ct.id}
              type="button"
              className={`btn btn-sm ${chartType === ct.id ? 'btn-primary' : ''}`}
              disabled={!allowStudentEdit && lecturerCustom?.chartType && lecturerCustom.chartType !== ct.id}
              onClick={() => {
                setChartType(ct.id);
                setSelectedPoint(null);
              }}
              title={ct.desc}
            >
              {ct.label}
            </button>
          ))}
        </div>

        <div className="row-wrap" style={{ gap: 8 }}>
          {dataMode !== 'student_only' && (
            <select
              className="input"
              style={{ width: 'auto', minWidth: 210, padding: '6px 10px', fontSize: 13 }}
              aria-label="Select SPC dataset"
              value={sourceMode === 'lecturer' ? '__lecturer__' : sourceMode === 'student' ? '__student__' : presetId}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__lecturer__') loadLecturerDataset();
                else if (v === '__student__') setSourceMode('student');
                else loadPreset(v);
              }}
            >
              {lecturerCustom && <option value="__lecturer__">Course Dataset: {lecturerCustom.name || 'Assigned Case'}</option>}
              {allowStudentEdit && SPC_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>Preset: {p.name}</option>
              ))}
              {sourceMode === 'student' && <option value="__student__">My Own Data: {datasetName}</option>}
            </select>
          )}

          {allowStudentEdit && (
            <>
              <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleFileUpload} />
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={14} /> Upload CSV / Excel
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setPasteOpen((v) => !v)}>
                Paste Data
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  const tpl = buildLabCsvTemplate('tqm_spc', chartType);
                  downloadText(tpl.filename, tpl.content);
                }}
              >
                <Icon name="download" size={14} /> Template
              </button>
            </>
          )}
          <button type="button" className="btn btn-sm" onClick={exportCurrentCsv}>
            Export CSV
          </button>
        </div>
      </div>

      {importError && <div className="notice notice-err small">{importError}</div>}

      {pasteOpen && allowStudentEdit && (
        <div className="card-soft stack-sm" style={{ padding: 14 }}>
          <div className="between">
            <strong className="small">Paste CSV / Excel rows ({chartType === 'p_chart' ? 'Sample, n, Defects' : chartType === 'c_chart' ? 'Unit, Defects' : 'Subgroup, X1, X2, X3, ...'})</strong>
            <button type="button" className="btn btn-sm" onClick={() => setPasteOpen(false)}>Close</button>
          </div>
          <textarea
            className="input mono"
            rows={5}
            placeholder={buildLabCsvTemplate('tqm_spc', chartType).content}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ maxWidth: 280 }}
              placeholder="Name your dataset (e.g. Kumasi Mill Shift A)"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => applyImportedCsv(pasteText, datasetName || 'My Pasted Data')}>
              Load Into Chart
            </button>
          </div>
        </div>
      )}

      {/* KPI Strip */}
      {spcResult && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <div className="kpi">
            <div className="v mono" style={{ color: spcResult.inControl ? 'var(--teal-700)' : 'var(--red)', fontSize: 18 }}>
              {spcResult.inControl ? '● Stable' : `▲ ${spcResult.totalSignals} Alert${spcResult.totalSignals === 1 ? '' : 's'}`}
            </div>
            <div className="l">Statistical Control</div>
          </div>
          <div className="kpi">
            <div className="v mono" style={{ fontSize: 18 }}>{roundNum(spcResult.primary.cl, decimals)}</div>
            <div className="l">Center Line (CL)</div>
          </div>
          {isVariableChart && capability ? (
            <>
              <div className="kpi">
                <div className="v mono" style={{ fontSize: 18 }}>{roundNum(capability.cp, 2)}</div>
                <div className="l">Process Potential (Cp)</div>
              </div>
              <div className="kpi">
                <div className="v mono" style={{ fontSize: 18, color: capability.cpk >= 1.33 ? 'var(--teal-700)' : capability.cpk >= 1 ? 'var(--amber)' : 'var(--red)' }}>
                  {roundNum(capability.cpk, 2)}
                </div>
                <div className="l">Actual Capability (Cpk)</div>
              </div>
              <div className="kpi">
                <div className="v mono" style={{ fontSize: 18 }}>{capability.estPpm.toLocaleString()}</div>
                <div className="l">Est. Defect PPM</div>
              </div>
            </>
          ) : (
            <>
              <div className="kpi">
                <div className="v mono" style={{ fontSize: 18 }}>{spcResult.k}</div>
                <div className="l">Samples Inspected</div>
              </div>
              <div className="kpi">
                <div className="v mono" style={{ fontSize: 18 }}>{spcResult.totalDefects}</div>
                <div className="l">Total Non-Conformities</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Two-Zone Educational Layout: Left Visual Stage (Charts) + Right Control/Data Deck */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(300px, 1fr)', gap: 18, alignItems: 'start' }} className="lab-split-grid">
        {/* LEFT ZONE: Interactive SPC Charts & Capability Distribution */}
        <div className="stack">
          {spcResult ? (
            <>
              <SpcSvgChart
                title={spcResult.primary.title}
                series={spcResult.primary}
                labels={labels}
                unit={unit}
                decimals={decimals}
                selectedIndex={selectedPoint}
                onSelectPoint={setSelectedPoint}
              />
              {spcResult.secondary && (
                <SpcSvgChart
                  title={spcResult.secondary.title}
                  series={spcResult.secondary}
                  labels={labels}
                  unit={unit}
                  decimals={decimals}
                  selectedIndex={selectedPoint}
                  onSelectPoint={setSelectedPoint}
                />
              )}
              {isVariableChart && capability && capHistogram && (
                <CapabilityHistogramSvg hist={capHistogram} capability={capability} unit={unit} />
              )}
            </>
          ) : (
            <div className="card muted small">Add at least one valid subgroup or sample to render SPC charts.</div>
          )}

          {/* Western Electric Signal Log */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, background: 'var(--surface)' }}>
            <strong style={{ fontSize: 14 }}>Special-Cause Signal Log (Western Electric Rules 1–3)</strong>
            {allSignals.length === 0 ? (
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                No Rule 1 (beyond 3σ), Rule 2 (7-point run), or Rule 3 (6-point trend) violations detected. Variation appears consistent with common-cause noise.
              </p>
            ) : (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }} className="stack-xs small">
                {allSignals.map((sig, i) => (
                  <li key={i}>
                    <strong style={{ color: sig.severity === 'high' ? 'var(--red)' : 'var(--amber)' }}>{sig.rule}:</strong>{' '}
                    <span className="mono">{sig.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT ZONE: Specification Controls + Interactive Data Table */}
        <div className="stack">
          {isVariableChart && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, background: 'var(--surface)' }} className="stack-sm">
              <strong style={{ fontSize: 14 }}>Specification Limits &amp; Capability Inputs</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <label className="stack-xs tiny muted">
                  LSL
                  <input className="input mono" type="number" step="any" value={lsl} disabled={!allowStudentEdit} onChange={(e) => setLsl(e.target.value)} />
                </label>
                <label className="stack-xs tiny muted">
                  Target
                  <input className="input mono" type="number" step="any" value={target} disabled={!allowStudentEdit} onChange={(e) => setTarget(e.target.value)} />
                </label>
                <label className="stack-xs tiny muted">
                  USL
                  <input className="input mono" type="number" step="any" value={usl} disabled={!allowStudentEdit} onChange={(e) => setUsl(e.target.value)} />
                </label>
              </div>
              {capability && (
                <div className="tiny mono muted" style={{ paddingTop: 6, borderTop: '1px solid var(--line-2)' }}>
                  Verdict: <strong style={{ color: capability.tone === 'good' ? 'var(--teal-700)' : capability.tone === 'warn' ? 'var(--amber)' : 'var(--red)' }}>{capability.verdict}</strong>
                  {' · '}Pp {roundNum(capability.pp, 2)} · Ppk {roundNum(capability.ppk, 2)} · Yield {roundNum(capability.yieldPct, 2)}%
                </div>
              )}
              {spcResult?.constants && (
                <div className="tiny mono muted">
                  Constants (n={spcResult.n}): {chartType === 'xbar_r'
                    ? `A2=${spcResult.constants.A2}, D3=${spcResult.constants.D3}, D4=${spcResult.constants.D4}, d2=${spcResult.constants.d2}`
                    : `A3=${spcResult.constants.A3}, B3=${spcResult.constants.B3}, B4=${spcResult.constants.B4}, c4=${spcResult.constants.c4}`}
                </div>
              )}
            </div>
          )}

          {/* Live Editable Subgroup / Sample Table */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, background: 'var(--surface)' }} className="stack-sm">
            <div className="between">
              <strong style={{ fontSize: 14 }}>
                {isVariableChart ? `Subgroup Readings (${subgroups.length} subgroups)` : chartType === 'p_chart' ? `Inspection Samples (${pSamples.length})` : `Inspection Units (${cSamples.length})`}
              </strong>
              {allowStudentEdit && (
                <button type="button" className="btn btn-sm" onClick={addRow}>
                  <Icon name="plus" size={14} /> Add Row
                </button>
              )}
            </div>

            <div style={{ maxHeight: 330, overflow: 'auto', border: '1px solid var(--line-2)', borderRadius: 8 }}>
              <table className="table" style={{ fontSize: 12 }}>
                <thead>
                  {isVariableChart ? (
                    <tr>
                      <th>ID</th>
                      <th>Readings (comma-separated)</th>
                      <th className="mono">X-bar</th>
                      <th className="mono">{chartType === 'xbar_r' ? 'R' : 'S'}</th>
                      {allowStudentEdit && <th />}
                    </tr>
                  ) : chartType === 'p_chart' ? (
                    <tr>
                      <th>Sample</th>
                      <th className="mono">n</th>
                      <th className="mono">Defects</th>
                      <th className="mono">p</th>
                      {allowStudentEdit && <th />}
                    </tr>
                  ) : (
                    <tr>
                      <th>Unit</th>
                      <th className="mono">Defects (c)</th>
                      {allowStudentEdit && <th />}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {isVariableChart && subgroups.map((sg, idx) => {
                    const pt = spcResult?.points?.[idx];
                    const flagged = (spcResult?.primary?.pointFlags?.[idx]?.length || 0) > 0
                      || (spcResult?.secondary?.pointFlags?.[idx]?.length || 0) > 0;
                    return (
                      <tr key={idx} style={{ background: selectedPoint === idx ? 'var(--teal-50)' : flagged ? 'var(--red-50)' : undefined }}>
                        <td className="mono" style={{ fontWeight: 600 }}>{sg.label}</td>
                        <td>
                          {allowStudentEdit ? (
                            <input
                              className="input mono"
                              style={{ padding: '4px 6px', fontSize: 11.5 }}
                              defaultValue={sg.values.join(', ')}
                              key={`${sg.label}-${sg.values.join(',')}`}
                              onBlur={(e) => {
                                const nums = e.target.value.split(/[,\s]+/).map(Number).filter(Number.isFinite);
                                if (nums.length >= 2) {
                                  const next = subgroups.map((item, j) => (j === idx ? { ...item, values: nums } : item));
                                  setSubgroups(next);
                                  setSourceMode('student');
                                }
                              }}
                            />
                          ) : (
                            <span className="mono">{sg.values.join(', ')}</span>
                          )}
                        </td>
                        <td className="mono">{pt ? roundNum(pt.xbar, 2) : '—'}</td>
                        <td className="mono">{pt ? roundNum(chartType === 'xbar_r' ? pt.range : pt.s, 3) : '—'}</td>
                        {allowStudentEdit && (
                          <td>
                            <button
                              type="button"
                              className="icon-btn plain"
                              aria-label="Remove row"
                              onClick={() => subgroups.length > 2 && setSubgroups(subgroups.filter((_, j) => j !== idx))}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}

                  {chartType === 'p_chart' && pSamples.map((row, idx) => {
                    const pt = spcResult?.points?.[idx];
                    const flagged = (spcResult?.primary?.pointFlags?.[idx]?.length || 0) > 0;
                    return (
                      <tr key={idx} style={{ background: selectedPoint === idx ? 'var(--teal-50)' : flagged ? 'var(--red-50)' : undefined }}>
                        <td className="mono">{row.label}</td>
                        <td>
                          <input
                            className="input mono"
                            type="number"
                            min="1"
                            disabled={!allowStudentEdit}
                            style={{ width: 70, padding: '4px 6px', fontSize: 12 }}
                            value={row.n}
                            onChange={(e) => {
                              setPSamples(pSamples.map((r, j) => (j === idx ? { ...r, n: Math.max(1, Number(e.target.value) || 1) } : r)));
                              setSourceMode('student');
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="input mono"
                            type="number"
                            min="0"
                            disabled={!allowStudentEdit}
                            style={{ width: 64, padding: '4px 6px', fontSize: 12 }}
                            value={row.defects}
                            onChange={(e) => {
                              setPSamples(pSamples.map((r, j) => (j === idx ? { ...r, defects: Math.max(0, Number(e.target.value) || 0) } : r)));
                              setSourceMode('student');
                            }}
                          />
                        </td>
                        <td className="mono">{pt ? roundNum(pt.p, 4) : '—'}</td>
                        {allowStudentEdit && (
                          <td>
                            <button
                              type="button"
                              className="icon-btn plain"
                              aria-label="Remove sample"
                              onClick={() => pSamples.length > 2 && setPSamples(pSamples.filter((_, j) => j !== idx))}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}

                  {chartType === 'c_chart' && cSamples.map((row, idx) => {
                    const flagged = (spcResult?.primary?.pointFlags?.[idx]?.length || 0) > 0;
                    return (
                      <tr key={idx} style={{ background: selectedPoint === idx ? 'var(--teal-50)' : flagged ? 'var(--red-50)' : undefined }}>
                        <td className="mono">{row.label}</td>
                        <td>
                          <input
                            className="input mono"
                            type="number"
                            min="0"
                            disabled={!allowStudentEdit}
                            style={{ width: 84, padding: '4px 6px', fontSize: 12 }}
                            value={row.defects}
                            onChange={(e) => {
                              setCSamples(cSamples.map((r, j) => (j === idx ? { ...r, defects: Math.max(0, Number(e.target.value) || 0) } : r)));
                              setSourceMode('student');
                            }}
                          />
                        </td>
                        {allowStudentEdit && (
                          <td>
                            <button
                              type="button"
                              className="icon-btn plain"
                              aria-label="Remove unit"
                              onClick={() => cSamples.length > 2 && setCSamples(cSamples.filter((_, j) => j !== idx))}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Diagnostic Self-Check + Written Management Judgement */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <strong style={{ fontSize: 15 }}>Process Diagnosis &amp; Management Judgement</strong>
          {diagCheck && diagCheck.checks > 0 && (
            <span className="small mono" style={{ fontWeight: 600, color: diagCheck.correct === diagCheck.maxChecks ? 'var(--teal-700)' : 'var(--amber)' }}>
              Diagnostic Check: {diagCheck.correct}/{diagCheck.maxChecks} verified
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <label className="stack-xs small">
            <strong>1. Is this process in statistical control?</strong>
            <select className="input" value={studentControlCall} onChange={(e) => setStudentControlCall(e.target.value)}>
              <option value="">Select your diagnosis…</option>
              <option value="in_control">Yes — Statistically in control (common-cause only)</option>
              <option value="out_of_control">No — Out of control (special-cause signals present)</option>
            </select>
          </label>

          {capability && (
            <label className="stack-xs small">
              <strong>2. Based on Cpk, how capable is the process?</strong>
              <select className="input" value={studentCapCall} onChange={(e) => setStudentCapCall(e.target.value)}>
                <option value="">Select capability verdict…</option>
                <option value="capable">Capable (Cpk ≥ 1.33)</option>
                <option value="marginal">Marginally Capable (1.00 ≤ Cpk &lt; 1.33)</option>
                <option value="not_capable">Not Capable (Cpk &lt; 1.00)</option>
              </select>
            </label>
          )}
        </div>

        <label className="stack-xs small">
          <strong>Written Managerial Judgement &amp; Corrective Action</strong>
          <span className="tiny muted">
            {config?.instructions || 'Cite specific out-of-control subgroups, interpret Cp vs. Cpk (centering vs. spread), and recommend concrete actions for production and quality teams.'}
          </span>
          <textarea
            className="input"
            rows={4}
            placeholder="Write your engineering & managerial interpretation here. This is included directly in your lab report submission…"
            value={judgement}
            onChange={(e) => setJudgement(e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
