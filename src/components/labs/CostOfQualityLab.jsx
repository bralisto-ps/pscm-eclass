import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import {
  computeCoqWhatIf,
  computeIcebergModel,
  computeOptimalQualityCurve,
  computePafSummary,
  PAF_CATEGORIES,
  roundNum,
  scorePafClassification,
} from '../../lib/tqmLabMath.js';
import {
  buildLabCsvTemplate,
  COQ_PRESETS,
  getLabPreset,
  readLabSpreadsheetRows,
} from '../../lib/labsCatalog.js';
import { downloadText } from '../../lib/sheets.js';

const VIEWS = [
  { id: 'paf', label: '1. PAF Ledger & Classifier' },
  { id: 'iceberg', label: '2. Hidden COQ Iceberg' },
  { id: 'optimal', label: '3. Optimal Quality & ROI' },
  { id: 'trend', label: '4. Multi-Period Trend' },
];

const CAT_COLORS = {
  prevention: '#0b7a6f',
  appraisal: '#2563eb',
  internal_failure: '#d97706',
  external_failure: '#dc2626',
};

function fmtMoney(n, currency = 'GHS') {
  const num = Number(n) || 0;
  return `${currency} ${Math.round(num).toLocaleString()}`;
}

function OptimalCurveSvg({ curve, currency }) {
  if (!curve?.points?.length) return null;
  const W = 720;
  const H = 250;
  const pad = { top: 24, right: 26, bottom: 42, left: 68 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const pts = curve.points;
  const maxCost = Math.max(1000, ...pts.map((p) => p.totalCost));
  const minQ = pts[0].qualityPct;
  const maxQ = pts[pts.length - 1].qualityPct;

  const xOf = (q) => pad.left + ((q - minQ) / (maxQ - minQ || 1)) * plotW;
  const yOf = (c) => pad.top + plotH - (Math.min(c, maxCost) / maxCost) * plotH;

  const pathFor = (key) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.qualityPct).toFixed(1)},${yOf(p[key]).toFixed(1)}`).join(' ');
  const opt = curve.optimal;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Optimal Cost of Quality Curve">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = pad.top + t * plotH;
        const val = maxCost * (1 - t);
        return (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="var(--line-2)" />
            <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">
              {Math.round(val / 1000)}k
            </text>
          </g>
        );
      })}
      <line x1={pad.left} x2={W - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} stroke="var(--line)" />

      {/* Curves */}
      <path d={pathFor('failureCost')} fill="none" stroke="#dc2626" strokeWidth="2" strokeDasharray="5 3" />
      <path d={pathFor('conformanceCost')} fill="none" stroke="#0b7a6f" strokeWidth="2" strokeDasharray="5 3" />
      <path d={pathFor('totalCost')} fill="none" stroke="var(--text)" strokeWidth="2.8" />

      {/* Optimal point marker */}
      {opt && (
        <g>
          <line x1={xOf(opt.qualityPct)} x2={xOf(opt.qualityPct)} y1={pad.top} y2={pad.top + plotH} stroke="var(--amber)" strokeWidth="1.5" strokeDasharray="4 3" />
          <circle cx={xOf(opt.qualityPct)} cy={yOf(opt.totalCost)} r="6" fill="var(--amber)" stroke="var(--surface)" strokeWidth="2" />
          <text
            x={Math.min(W - 140, Math.max(pad.left + 10, xOf(opt.qualityPct) - 50))}
            y={Math.max(16, yOf(opt.totalCost) - 12)}
            fontSize="11"
            fontWeight="700"
            fill="var(--amber)"
            fontFamily="var(--mono)"
          >
            Optimum: {opt.qualityPct}% ({fmtMoney(opt.totalCost, currency)})
          </text>
        </g>
      )}

      {[55, 65, 75, 85, 95, 99].map((q) => (
        <text key={q} x={xOf(q)} y={H - 20} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--mono)">{q}%</text>
      ))}
      <text x={pad.left + plotW / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--muted)">
        Quality of Conformance (%) — {curve.model === 'modern' ? 'Modern TQM / Zero-Defects View' : 'Classical Juran / Lundvall View'}
      </text>
    </svg>
  );
}

export default function CostOfQualityLab({
  config,
  dataMode = 'both',
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const defaultPreset = useMemo(
    () => getLabPreset('tqm_coq', config?.presetId) || COQ_PRESETS[0],
    [config?.presetId],
  );
  const lecturerCustom = config?.customDataset || null;
  const allowStudentEdit = dataMode !== 'lecturer_only';

  const [view, setView] = useState(draftState?.view || 'paf');
  const [presetId, setPresetId] = useState(draftState?.presetId || defaultPreset.id);
  const [caseName, setCaseName] = useState(draftState?.caseName || lecturerCustom?.name || defaultPreset.name);
  const [currency, setCurrency] = useState(draftState?.currency || lecturerCustom?.currency || defaultPreset.currency || 'GHS');
  const [revenue, setRevenue] = useState(String(draftState?.revenue ?? lecturerCustom?.revenue ?? defaultPreset.revenue));
  const [unitsProduced, setUnitsProduced] = useState(String(draftState?.unitsProduced ?? lecturerCustom?.unitsProduced ?? defaultPreset.unitsProduced));
  const [items, setItems] = useState(draftState?.items || lecturerCustom?.items || defaultPreset.items);
  const [periods, setPeriods] = useState(draftState?.periods || lecturerCustom?.periods || defaultPreset.periods);

  // Interactive PAF Classification Challenge Mode
  const [quizMode, setQuizMode] = useState(Boolean(draftState?.quizMode));
  const [studentCats, setStudentCats] = useState(draftState?.studentCats || {});
  const [checkedQuiz, setCheckedQuiz] = useState(Boolean(draftState?.checkedQuiz));

  // Iceberg multipliers
  const [mults, setMults] = useState(draftState?.mults || {
    lostCustomers: 1.2,
    brandErosion: 0.75,
    mgmtFirefighting: 0.6,
    expeditedOps: 0.45,
  });

  // Optimal curve + What-if ROI simulator
  const [econModel, setEconModel] = useState(draftState?.econModel || 'classical');
  const [whatIf, setWhatIf] = useState(draftState?.whatIf || {
    deltaPrevention: 25000,
    deltaAppraisal: -5000,
    internalReductionPct: 45,
    externalReductionPct: 55,
  });

  const [judgement, setJudgement] = useState(draftState?.judgement || '');
  const [importError, setImportError] = useState('');
  const fileRef = useRef(null);

  function loadPreset(id) {
    const p = COQ_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(p.id);
    setCaseName(p.name);
    setCurrency(p.currency || 'GHS');
    setRevenue(String(p.revenue));
    setUnitsProduced(String(p.unitsProduced));
    setItems(p.items.map((x) => ({ ...x })));
    setPeriods(p.periods.map((x) => ({ ...x })));
    setStudentCats({});
    setCheckedQuiz(false);
  }

  const revNum = Math.max(0, Number(revenue) || 0);
  const unitsNum = Math.max(0, Number(unitsProduced) || 0);

  const summary = useMemo(() => computePafSummary(items, revNum, unitsNum), [items, revNum, unitsNum]);
  const iceberg = useMemo(() => computeIcebergModel(summary.copq, mults), [summary.copq, mults]);
  const curve = useMemo(
    () => computeOptimalQualityCurve({
      baseFailure: Math.max(10000, summary.copq),
      basePrevention: Math.max(5000, summary.conformance),
      model: econModel,
    }),
    [summary.copq, summary.conformance, econModel],
  );
  const sim = useMemo(
    () => computeCoqWhatIf(summary, { ...whatIf, revenue: revNum }),
    [summary, whatIf, revNum],
  );
  const quizScore = useMemo(() => scorePafClassification(items, studentCats), [items, studentCats]);

  useEffect(() => {
    onDraftChange?.({
      view,
      presetId,
      caseName,
      currency,
      revenue,
      unitsProduced,
      items,
      periods,
      quizMode,
      studentCats,
      checkedQuiz,
      mults,
      econModel,
      whatIf,
      judgement,
    });
  }, [view, presetId, caseName, currency, revenue, unitsProduced, items, periods, quizMode, studentCats, checkedQuiz, mults, econModel, whatIf, judgement, onDraftChange]);

  useEffect(() => {
    if (!onRegisterReportBuilder) return;
    onRegisterReportBuilder(() => {
      const lines = [
        `LABORATORY: Cost of Quality (COQ / PAF & Economics) Models`,
        `Organization / Case: ${caseName}`,
        `Revenue: ${fmtMoney(revNum, currency)} | Output: ${unitsNum.toLocaleString()} units`,
        '',
        '1. PAF COST BREAKDOWN',
        `- Prevention (P):       ${fmtMoney(summary.totals.prevention, currency)} (${roundNum(summary.shareOfCoq.prevention, 1)}% of COQ)`,
        `- Appraisal (A):        ${fmtMoney(summary.totals.appraisal, currency)} (${roundNum(summary.shareOfCoq.appraisal, 1)}% of COQ)`,
        `- Internal Failure (IF):${fmtMoney(summary.totals.internal_failure, currency)} (${roundNum(summary.shareOfCoq.internal_failure, 1)}% of COQ)`,
        `- External Failure (EF):${fmtMoney(summary.totals.external_failure, currency)} (${roundNum(summary.shareOfCoq.external_failure, 1)}% of COQ)`,
        `- Total Cost of Quality: ${fmtMoney(summary.totalCoq, currency)} (${roundNum(summary.coqPctRevenue, 2)}% of Revenue | ${currency} ${roundNum(summary.costPerUnit, 2)}/unit)`,
        `- Conformance (P+A): ${roundNum(summary.conformancePct, 1)}% vs. Non-Conformance / COPQ (IF+EF): ${roundNum(summary.copqPct, 1)}%`,
        `- Quality Maturity Diagnosis: ${summary.maturity}`,
      ];
      if (checkedQuiz) {
        lines.push(`- PAF Classification Challenge Score: ${quizScore.correct}/${quizScore.total} (${quizScore.pct}%)`);
      }
      lines.push('');
      lines.push('2. HIDDEN COQ ICEBERG MODEL');
      lines.push(`- Visible Accounting COPQ: ${fmtMoney(iceberg.visible, currency)}`);
      lines.push(`- Estimated Hidden COPQ:   ${fmtMoney(iceberg.hiddenTotal, currency)} (${roundNum(iceberg.hiddenPct, 1)}% of total impact)`);
      lines.push(`- True Economic COPQ:      ${fmtMoney(iceberg.trueCopq, currency)} (${roundNum(iceberg.ratio, 2)}x visible failure costs)`);
      lines.push('');
      lines.push('3. OPTIMAL QUALITY & WHAT-IF PREVENTION INVESTMENT ROI');
      lines.push(`- Economics Model: ${econModel === 'modern' ? 'Modern TQM / Zero-Defects' : 'Classical Juran / Lundvall'} (Model Optimum: ${curve.optimal?.qualityPct}% conformance)`);
      lines.push(`- Proposed Investment Change: Prevention ${whatIf.deltaPrevention >= 0 ? '+' : ''}${fmtMoney(whatIf.deltaPrevention, currency)}, Appraisal ${whatIf.deltaAppraisal >= 0 ? '+' : ''}${fmtMoney(whatIf.deltaAppraisal, currency)}`);
      lines.push(`- Modeled Failure Reductions: Internal -${whatIf.internalReductionPct}%, External -${whatIf.externalReductionPct}%`);
      lines.push(`- Gross Failure Savings: ${fmtMoney(sim.grossSavings, currency)} | Net Savings: ${fmtMoney(sim.netSavings, currency)} | ROI: ${roundNum(sim.roiPct, 1)}%${sim.paybackMonths ? ` | Payback: ${roundNum(sim.paybackMonths, 1)} months` : ''}`);
      lines.push(`- Projected New Total COQ: ${fmtMoney(sim.newTotalCoq, currency)} (${roundNum(sim.newCoqPctRevenue, 2)}% of Revenue)`);
      lines.push('');
      lines.push('4. STUDENT WRITTEN EXECUTIVE RECOMMENDATION');
      lines.push(judgement.trim() || '(No written judgement entered.)');
      return {
        title: `Cost of Quality Report — ${caseName}`,
        body: lines.join('\n'),
        hasJudgement: judgement.trim().length >= 20,
      };
    });
  }, [onRegisterReportBuilder, caseName, revNum, unitsNum, currency, summary, checkedQuiz, quizScore, iceberg, econModel, curve, whatIf, sim, judgement]);

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    try {
      const rows = await readLabSpreadsheetRows(file);
      const parsed = [];
      const catNorm = (raw) => {
        const s = String(raw || '').toLowerCase().trim();
        if (/^p|prevent/.test(s)) return 'prevention';
        if (/^a|apprais|inspect|test/.test(s)) return 'appraisal';
        if (/^if|internal/.test(s)) return 'internal_failure';
        if (/^ef|external|warranty|return/.test(s)) return 'external_failure';
        return 'internal_failure';
      };
      rows.forEach((r, idx) => {
        if (r.length < 3) return;
        const amt = Number(String(r[2]).replace(/[^0-9.-]/g, ''));
        if (idx === 0 && !Number.isFinite(amt)) return;
        if (!Number.isFinite(amt) || amt < 0) return;
        parsed.push({ id: `u_${idx}`, name: r[0] || `Line ${idx + 1}`, category: catNorm(r[1]), amount: amt });
      });
      if (!parsed.length) throw new Error('Use 3 columns: CostItem, Category (prevention/appraisal/internal_failure/external_failure), Amount.');
      setItems(parsed);
      setCaseName(file.name.replace(/\.[^.]+$/, ''));
      setStudentCats({});
      setCheckedQuiz(false);
    } catch (err) {
      setImportError(err.message || 'Could not parse Cost of Quality file.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function exportCoqCsv() {
    const body = items.map((it) => `"${it.name.replace(/"/g, '""')}",${it.category},${it.amount}`).join('\n');
    downloadText('cost-of-quality-ledger.csv', `CostItem,Category,Amount\n${body}\n`);
  }

  return (
    <div className="stack-lg">
      {/* Toolbar */}
      <div className="between" style={{ flexWrap: 'wrap', gap: 10, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
        <div className="row-wrap" style={{ gap: 6 }}>
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className={`btn btn-sm ${view === v.id ? 'btn-primary' : ''}`} onClick={() => setView(v.id)}>
              {v.label}
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
              {COQ_PRESETS.map((p) => <option key={p.id} value={p.id}>Preset: {p.name}</option>)}
            </select>
          )}
          {allowStudentEdit && (
            <>
              <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleCsvUpload} />
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={14} /> Upload CSV / Excel
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  const tpl = buildLabCsvTemplate('tqm_coq');
                  downloadText(tpl.filename, tpl.content);
                }}
              >
                <Icon name="download" size={14} /> Template
              </button>
            </>
          )}
          <button type="button" className="btn btn-sm" onClick={exportCoqCsv}>Export CSV</button>
        </div>
      </div>

      {importError && <div className="notice notice-err small">{importError}</div>}

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div className="kpi">
          <div className="v mono" style={{ fontSize: 18 }}>{fmtMoney(summary.totalCoq, currency)}</div>
          <div className="l">Total Cost of Quality</div>
        </div>
        <div className="kpi">
          <div className="v mono" style={{ fontSize: 18, color: summary.coqPctRevenue > 15 ? 'var(--red)' : summary.coqPctRevenue > 8 ? 'var(--amber)' : 'var(--teal-700)' }}>
            {roundNum(summary.coqPctRevenue, 1)}%
          </div>
          <div className="l">COQ % of Revenue</div>
        </div>
        <div className="kpi">
          <div className="v mono" style={{ fontSize: 18, color: 'var(--teal-700)' }}>{roundNum(summary.conformancePct, 1)}%</div>
          <div className="l">Conformance (P + A)</div>
        </div>
        <div className="kpi">
          <div className="v mono" style={{ fontSize: 18, color: 'var(--red)' }}>{roundNum(summary.copqPct, 1)}%</div>
          <div className="l">Failure / COPQ (IF + EF)</div>
        </div>
        <div className="kpi">
          <div className="v" style={{ fontSize: 13.5, color: summary.tone === 'good' ? 'var(--teal-700)' : summary.tone === 'warn' ? 'var(--amber)' : 'var(--red)' }}>
            {summary.maturity}
          </div>
          <div className="l">COQ Profile</div>
        </div>
      </div>

      {/* VIEW 1: PAF LEDGER & CLASSIFICATION CHALLENGE */}
      {view === 'paf' && (
        <div className="stack">
          {/* Stacked PAF proportion bar */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, background: 'var(--surface)' }} className="stack-sm">
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: 14 }}>PAF Composition Breakdown</strong>
              <div className="row-wrap tiny mono" style={{ gap: 14 }}>
                {PAF_CATEGORIES.map((c) => (
                  <span key={c.id} style={{ color: CAT_COLORS[c.id], fontWeight: 600 }}>
                    ■ {c.label}: {roundNum(summary.shareOfCoq[c.id], 1)}% ({fmtMoney(summary.totals[c.id], currency)})
                  </span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', background: 'var(--track)' }}>
              {PAF_CATEGORIES.map((c) => {
                const w = summary.shareOfCoq[c.id];
                if (w <= 0) return null;
                return (
                  <div
                    key={c.id}
                    style={{ width: `${w}%`, background: CAT_COLORS[c.id], transition: 'width 200ms var(--ease)' }}
                    title={`${c.label}: ${fmtMoney(summary.totals[c.id], currency)} (${roundNum(w, 1)}%)`}
                  />
                );
              })}
            </div>
          </div>

          {/* Base Revenue / Units + Quiz Toggle */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
            <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div className="row-wrap" style={{ gap: 10 }}>
                <label className="stack-xs tiny muted">
                  Currency
                  <select className="input" style={{ width: 90, padding: '6px 8px' }} value={currency} disabled={!allowStudentEdit} onChange={(e) => setCurrency(e.target.value)}>
                    <option value="GHS">GHS</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </label>
                <label className="stack-xs tiny muted">
                  Period Revenue ({currency})
                  <input className="input mono" type="number" min="0" style={{ width: 150, padding: '6px 8px' }} disabled={!allowStudentEdit} value={revenue} onChange={(e) => setRevenue(e.target.value)} />
                </label>
                <label className="stack-xs tiny muted">
                  Units Produced
                  <input className="input mono" type="number" min="0" style={{ width: 130, padding: '6px 8px' }} disabled={!allowStudentEdit} value={unitsProduced} onChange={(e) => setUnitsProduced(e.target.value)} />
                </label>
              </div>

              <div className="row-wrap" style={{ gap: 8 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${quizMode ? 'btn-primary' : ''}`}
                  onClick={() => {
                    setQuizMode((v) => !v);
                    setCheckedQuiz(false);
                  }}
                >
                  {quizMode ? 'Exit Classification Practice' : 'PAF Classification Practice'}
                </button>
                {allowStudentEdit && !quizMode && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setItems([...items, { id: `c_${Date.now()}`, name: 'New Quality Cost Item', category: 'prevention', amount: 10000 }])}
                  >
                    <Icon name="plus" size={14} /> Add Cost Item
                  </button>
                )}
              </div>
            </div>

            {quizMode && (
              <div className="card-soft between small" style={{ padding: 12, flexWrap: 'wrap', gap: 10 }}>
                <span>
                  Classify each line item into <strong>Prevention, Appraisal, Internal Failure, or External Failure</strong>, then click Verify.
                  {checkedQuiz && <strong style={{ marginLeft: 10, color: quizScore.pct >= 80 ? 'var(--teal-700)' : 'var(--amber)' }}>Score: {quizScore.correct}/{quizScore.total} ({quizScore.pct}%)</strong>}
                </span>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setCheckedQuiz(true)}>Verify My Classifications</button>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Quality Cost Line Item</th>
                    <th>PAF Category</th>
                    <th className="mono">Amount ({currency})</th>
                    {!quizMode && allowStudentEdit && <th />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const picked = studentCats[it.id] || '';
                    const isRight = checkedQuiz && picked === it.category;
                    const isWrong = checkedQuiz && picked !== it.category;
                    return (
                      <tr key={it.id} style={{ background: isWrong ? 'var(--red-50)' : isRight ? 'var(--teal-50)' : undefined }}>
                        <td>
                          {allowStudentEdit && !quizMode ? (
                            <input
                              className="input"
                              style={{ padding: '4px 8px', fontSize: 13 }}
                              value={it.name}
                              onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x)))}
                            />
                          ) : (
                            <strong>{it.name}</strong>
                          )}
                        </td>
                        <td>
                          {quizMode ? (
                            <div className="stack-xs">
                              <select
                                className="input"
                                style={{ padding: '4px 8px', fontSize: 12.5 }}
                                value={picked}
                                onChange={(e) => setStudentCats({ ...studentCats, [it.id]: e.target.value })}
                              >
                                <option value="">Choose PAF category…</option>
                                {PAF_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                              </select>
                              {isWrong && (
                                <span className="tiny" style={{ color: 'var(--red)' }}>
                                  Expected: {PAF_CATEGORIES.find((c) => c.id === it.category)?.label}
                                </span>
                              )}
                            </div>
                          ) : (
                            <select
                              className="input"
                              style={{ padding: '4px 8px', fontSize: 12.5 }}
                              disabled={!allowStudentEdit}
                              value={it.category}
                              onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, category: e.target.value } : x)))}
                            >
                              {PAF_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                          )}
                        </td>
                        <td>
                          {allowStudentEdit && !quizMode ? (
                            <input
                              className="input mono"
                              type="number"
                              min="0"
                              style={{ width: 120, padding: '4px 8px', fontSize: 13 }}
                              value={it.amount}
                              onChange={(e) => setItems(items.map((x, j) => (j === idx ? { ...x, amount: Math.max(0, Number(e.target.value) || 0) } : x)))}
                            />
                          ) : (
                            <span className="mono">{Math.round(it.amount).toLocaleString()}</span>
                          )}
                        </td>
                        {!quizMode && allowStudentEdit && (
                          <td>
                            <button type="button" className="icon-btn plain" aria-label="Delete item" onClick={() => items.length > 1 && setItems(items.filter((_, j) => j !== idx))}>
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
      )}

      {/* VIEW 2: HIDDEN COQ ICEBERG */}
      {view === 'iceberg' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(280px, 1fr)', gap: 16 }} className="lab-split-grid">
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
            <strong style={{ fontSize: 15 }}>Cost of Poor Quality Iceberg (Visible vs. Hidden)</strong>
            <div className="tiny muted">
              Traditional accounting only captures visible scrap, rework, returns, and warranty claims. Below the waterline sit far larger strategic losses.
            </div>
            <div className="card-soft" style={{ padding: 14, borderBottom: '2px dashed var(--teal)' }}>
              <div className="tiny mono" style={{ color: 'var(--teal-700)', fontWeight: 700 }}>▲ ABOVE WATERLINE — VISIBLE ACCOUNTING COPQ ({roundNum(100 - iceberg.hiddenPct, 1)}%)</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }} className="mono">{fmtMoney(iceberg.visible, currency)}</div>
              <div className="tiny muted">Internal Failure ({fmtMoney(summary.totals.internal_failure, currency)}) + External Failure ({fmtMoney(summary.totals.external_failure, currency)})</div>
            </div>

            <div className="stack-sm" style={{ padding: 14, borderRadius: 8, background: 'var(--red-50)', border: '1px solid var(--line)' }}>
              <div className="tiny mono" style={{ color: 'var(--red)', fontWeight: 700 }}>▼ BELOW WATERLINE — HIDDEN STRATEGIC COPQ ({roundNum(iceberg.hiddenPct, 1)}%)</div>
              {iceberg.hiddenBreakdown.map((h) => (
                <div key={h.id} className="between small">
                  <span>{h.label}</span>
                  <strong className="mono">{fmtMoney(h.amount, currency)}</strong>
                </div>
              ))}
              <div className="between" style={{ paddingTop: 8, borderTop: '1px solid var(--line)', fontWeight: 700 }}>
                <span>Total True Economic COPQ ({roundNum(iceberg.ratio, 2)}× visible)</span>
                <span className="mono" style={{ color: 'var(--red)', fontSize: 16 }}>{fmtMoney(iceberg.trueCopq, currency)}</span>
              </div>
            </div>
          </div>

          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
            <strong style={{ fontSize: 14 }}>Adjust Hidden-Cost Multipliers (× Visible COPQ)</strong>
            {[
              { key: 'lostCustomers', label: 'Lost Repeat Customers & Churn' },
              { key: 'brandErosion', label: 'Reputation & Discount Erosion' },
              { key: 'mgmtFirefighting', label: 'Management Firefighting Time' },
              { key: 'expeditedOps', label: 'Expedited Freight & Rush Overtime' },
            ].map((m) => (
              <label key={m.key} className="stack-xs small">
                <div className="between">
                  <span>{m.label}</span>
                  <strong className="mono">{mults[m.key].toFixed(2)}×</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2.5"
                  step="0.05"
                  value={mults[m.key]}
                  onChange={(e) => setMults({ ...mults, [m.key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 3: OPTIMAL QUALITY CURVE + WHAT-IF ROI */}
      {view === 'optimal' && (
        <div className="stack">
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
            <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div>
                <strong style={{ fontSize: 15 }}>Optimal Quality Economics Curve</strong>
                <div className="tiny muted">Compare the Classical Juran/Lundvall trade-off (finite optimum &lt; 100%) with Modern TQM (zero-defects via poka-yoke &amp; SPC).</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className={`btn btn-sm ${econModel === 'classical' ? 'btn-primary' : ''}`} onClick={() => setEconModel('classical')}>Classical Juran Model</button>
                <button type="button" className={`btn btn-sm ${econModel === 'modern' ? 'btn-primary' : ''}`} onClick={() => setEconModel('modern')}>Modern Zero-Defects Model</button>
              </div>
            </div>
            <OptimalCurveSvg curve={curve} currency={currency} />
            <div className="row-wrap tiny mono" style={{ gap: 16 }}>
              <span style={{ color: 'var(--text)', fontWeight: 700 }}>━━ Total COQ</span>
              <span style={{ color: '#0b7a6f' }}>╌╌ Conformance (P + A)</span>
              <span style={{ color: '#dc2626' }}>╌╌ Failure (IF + EF)</span>
            </div>
          </div>

          {/* What-If Prevention Investment Simulator */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
            <strong style={{ fontSize: 15 }}>What-If TQM Prevention Investment &amp; ROI Simulator</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <label className="stack-xs small">
                <div className="between"><span>Change in Prevention Spend</span><strong className="mono">{whatIf.deltaPrevention >= 0 ? '+' : ''}{fmtMoney(whatIf.deltaPrevention, currency)}</strong></div>
                <input type="range" min="-20000" max="100000" step="2500" value={whatIf.deltaPrevention} onChange={(e) => setWhatIf({ ...whatIf, deltaPrevention: Number(e.target.value) })} />
              </label>
              <label className="stack-xs small">
                <div className="between"><span>Change in Appraisal Spend</span><strong className="mono">{whatIf.deltaAppraisal >= 0 ? '+' : ''}{fmtMoney(whatIf.deltaAppraisal, currency)}</strong></div>
                <input type="range" min="-40000" max="60000" step="2500" value={whatIf.deltaAppraisal} onChange={(e) => setWhatIf({ ...whatIf, deltaAppraisal: Number(e.target.value) })} />
              </label>
              <label className="stack-xs small">
                <div className="between"><span>Expected Internal Failure Drop</span><strong className="mono">−{whatIf.internalReductionPct}%</strong></div>
                <input type="range" min="0" max="85" step="5" value={whatIf.internalReductionPct} onChange={(e) => setWhatIf({ ...whatIf, internalReductionPct: Number(e.target.value) })} />
              </label>
              <label className="stack-xs small">
                <div className="between"><span>Expected External Failure Drop</span><strong className="mono">−{whatIf.externalReductionPct}%</strong></div>
                <input type="range" min="0" max="85" step="5" value={whatIf.externalReductionPct} onChange={(e) => setWhatIf({ ...whatIf, externalReductionPct: Number(e.target.value) })} />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, paddingTop: 8 }}>
              <div className="kpi"><div className="v mono" style={{ fontSize: 17 }}>{fmtMoney(sim.grossSavings, currency)}</div><div className="l">Gross Failure Savings</div></div>
              <div className="kpi">
                <div className="v mono" style={{ fontSize: 17, color: sim.netSavings >= 0 ? 'var(--teal-700)' : 'var(--red)' }}>
                  {sim.netSavings >= 0 ? '+' : ''}{fmtMoney(sim.netSavings, currency)}
                </div>
                <div className="l">Net Quality Savings</div>
              </div>
              <div className="kpi"><div className="v mono" style={{ fontSize: 17 }}>{roundNum(sim.roiPct, 1)}%</div><div className="l">Quality Investment ROI</div></div>
              <div className="kpi"><div className="v mono" style={{ fontSize: 17 }}>{sim.paybackMonths ? `${roundNum(sim.paybackMonths, 1)} mo` : 'Immediate'}</div><div className="l">Payback Period</div></div>
              <div className="kpi"><div className="v mono" style={{ fontSize: 17 }}>{roundNum(sim.newCoqPctRevenue, 1)}%</div><div className="l">Projected COQ % Rev</div></div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4: MULTI-PERIOD MATURITY TREND */}
      {view === 'trend' && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack">
          <strong style={{ fontSize: 15 }}>Multi-Period COQ Maturity Shift</strong>
          <div className="tiny muted">Track how investing modestly in Prevention causes Internal &amp; External Failure costs to collapse while Total COQ % of Revenue falls.</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="mono">Prevention</th>
                  <th className="mono">Appraisal</th>
                  <th className="mono">Int. Failure</th>
                  <th className="mono">Ext. Failure</th>
                  <th className="mono">Total COQ</th>
                  <th className="mono">% Revenue</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p, idx) => {
                  const tot = p.prevention + p.appraisal + p.internal_failure + p.external_failure;
                  const pct = p.revenue > 0 ? (tot / p.revenue) * 100 : 0;
                  return (
                    <tr key={idx}>
                      <td><strong>{p.label}</strong></td>
                      <td className="mono" style={{ color: CAT_COLORS.prevention }}>{Math.round(p.prevention).toLocaleString()}</td>
                      <td className="mono" style={{ color: CAT_COLORS.appraisal }}>{Math.round(p.appraisal).toLocaleString()}</td>
                      <td className="mono" style={{ color: CAT_COLORS.internal_failure }}>{Math.round(p.internal_failure).toLocaleString()}</td>
                      <td className="mono" style={{ color: CAT_COLORS.external_failure }}>{Math.round(p.external_failure).toLocaleString()}</td>
                      <td className="mono" style={{ fontWeight: 700 }}>{fmtMoney(tot, currency)}</td>
                      <td className="mono" style={{ fontWeight: 700, color: pct <= 10 ? 'var(--teal-700)' : 'var(--red)' }}>{roundNum(pct, 1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Written Management Recommendation */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--surface)' }} className="stack-sm">
        <strong style={{ fontSize: 15 }}>Executive COQ Diagnosis &amp; Investment Recommendation</strong>
        <span className="tiny muted">
          {config?.instructions || 'Evaluate the firm’s current PAF balance and hidden COPQ exposure, compare Classical vs. Modern TQM economics, and defend your recommended prevention budget to the Finance Director.'}
        </span>
        <textarea
          className="input"
          rows={4}
          placeholder="Write your executive COQ recommendation here. Included directly in your submitted lab report…"
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
        />
      </div>
    </div>
  );
}
