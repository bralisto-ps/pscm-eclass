import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { useToast } from '../ui.jsx';
import {
  buildLabCsvTemplate,
  getLabPreset,
  INVENTORY_WMS_PRESETS,
  readLabSpreadsheetRows,
} from '../../lib/labsCatalog.js';
import {
  auditCycleCount,
  classifyAbcXyzMatrix,
  computeEoqRopPolicy,
  SERVICE_LEVEL_Z,
} from '../../lib/psisMilestone4Engine.js';
import { downloadText } from '../../lib/sheets.js';

const ROOT_CAUSE_OPTIONS = [
  '',
  'Unposted GRN / Receiving Lag',
  'Unrecorded Issue / Pick Error',
  'Duplicate SKU / Bin Misplacement',
  'Damaged / Expired Stock',
  'Suspected Shrinkage / Theft',
  'Count Verified — No Variance',
];

function fmtMoney(currency, val) {
  const n = Number(val || 0);
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function EoqCostCurveChart({ policy, params, currency }) {
  const width = 560;
  const height = 210;
  const pad = { l: 64, r: 22, t: 18, b: 36 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;

  const qStar = Math.max(10, policy.eoq);
  const qMin = Math.max(5, Math.round(qStar * 0.35));
  const qMax = Math.round(qStar * 2.2);
  const steps = 28;
  const D = Math.max(1, Number(params.annualDemand) || 1);
  const S = Math.max(1, Number(params.orderingCost) || 1);
  const H = Math.max(0.01, policy.holdingCostPerUnit);

  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const q = qMin + ((qMax - qMin) * i) / steps;
    const orderCost = (D / q) * S;
    const holdCost = (q / 2) * H;
    pts.push({ q, orderCost, holdCost, total: orderCost + holdCost });
  }

  const maxY = Math.max(...pts.map((p) => p.total), 1) * 1.08;
  const xOf = (q) => pad.l + ((q - qMin) / Math.max(1, qMax - qMin)) * plotW;
  const yOf = (y) => pad.t + plotH - (Math.min(y, maxY) / maxY) * plotH;

  const pathFor = (fn) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.q).toFixed(1)} ${yOf(fn(p)).toFixed(1)}`).join(' ');
  const eoqTotal = policy.annualOrderingCost + policy.annualCycleHoldingCost;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = pad.t + plotH * (1 - f);
        const val = maxY * f;
        return (
          <g key={f}>
            <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 3" />
            <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--muted)" fontFamily="monospace">
              {Math.round(val).toLocaleString()}
            </text>
          </g>
        );
      })}

      <path d={pathFor((p) => p.orderCost)} fill="none" stroke="var(--amber)" strokeWidth="1.6" strokeDasharray="4 3" />
      <path d={pathFor((p) => p.holdCost)} fill="none" stroke="#3b82f6" strokeWidth="1.6" strokeDasharray="4 3" />
      <path d={pathFor((p) => p.total)} fill="none" stroke="var(--teal-700)" strokeWidth="2.4" />

      <line
        x1={xOf(qStar)}
        x2={xOf(qStar)}
        y1={pad.t}
        y2={pad.t + plotH}
        stroke="var(--teal-700)"
        strokeDasharray="3 3"
      />
      <circle cx={xOf(qStar)} cy={yOf(eoqTotal)} r="5" fill="var(--teal-700)" />
      <text
        x={Math.min(width - 135, xOf(qStar) + 8)}
        y={Math.max(pad.t + 14, yOf(eoqTotal) - 8)}
        fontSize="10"
        fontWeight="700"
        fill="var(--teal-700)"
        fontFamily="monospace"
      >
        EOQ = {qStar.toLocaleString()} ({currency} {Math.round(eoqTotal).toLocaleString()})
      </text>

      <text x={pad.l + plotW / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">
        Order Quantity Q (units) · Green = Total Cycle Cost · Amber = Ordering Cost · Blue = Holding Cost
      </text>
    </svg>
  );
}

export default function InventoryWmsLab({
  config,
  dataMode = 'both',
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const toast = useToast();
  const fileRef = useRef(null);

  const lecturerCustom = config?.customDataset || null;
  const defaultPreset = getLabPreset('psis_inventory_wms', config?.presetId) || INVENTORY_WMS_PRESETS[0];
  const allowStudentEdit = dataMode !== 'lecturer_only';

  const [activeTab, setActiveTab] = useState(draftState?.activeTab || 'eoq');
  const [presetId, setPresetId] = useState(draftState?.presetId || defaultPreset.id);
  const [currency, setCurrency] = useState(draftState?.currency || lecturerCustom?.currency || defaultPreset.currency || 'GHS');

  const [eoqParams, setEoqParams] = useState(
    draftState?.eoqParams || lecturerCustom?.eoqDefaults || defaultPreset.eoqDefaults,
  );
  const [abcItems, setAbcItems] = useState(
    draftState?.abcItems || lecturerCustom?.abcItems || defaultPreset.abcItems,
  );
  const [bins, setBins] = useState(
    draftState?.bins || lecturerCustom?.cycleCountBins || defaultPreset.cycleCountBins,
  );
  const [tolerancePct, setTolerancePct] = useState(draftState?.tolerancePct ?? 2);
  const [selectedCell, setSelectedCell] = useState('ALL');
  const [judgement, setJudgement] = useState(draftState?.judgement || '');

  // Quick-add SKU form
  const [newSku, setNewSku] = useState({ code: '', name: '', annualQty: '1200', unitCost: '50', demandCv: '0.25' });

  useEffect(() => {
    onDraftChange?.({ activeTab, presetId, currency, eoqParams, abcItems, bins, tolerancePct, judgement });
  }, [activeTab, presetId, currency, eoqParams, abcItems, bins, tolerancePct, judgement]);

  const eoqPolicy = useMemo(() => computeEoqRopPolicy(eoqParams), [eoqParams]);
  const abcResult = useMemo(() => classifyAbcXyzMatrix(abcItems), [abcItems]);
  const cycleAudit = useMemo(() => auditCycleCount(bins, tolerancePct), [bins, tolerancePct]);

  const filteredAbcRows = useMemo(
    () => (selectedCell === 'ALL' ? abcResult.items : abcResult.items.filter((r) => r.segment === selectedCell)),
    [abcResult.items, selectedCell],
  );

  function loadPreset(id) {
    const p = getLabPreset('psis_inventory_wms', id) || INVENTORY_WMS_PRESETS[0];
    setPresetId(p.id);
    setCurrency(p.currency || 'GHS');
    setEoqParams({ ...p.eoqDefaults });
    setAbcItems(p.abcItems.map((x) => ({ ...x })));
    setBins(p.cycleCountBins.map((x) => ({ ...x })));
    setSelectedCell('ALL');
    toast(`Loaded preset: ${p.name}`);
  }

  function addCustomSku(e) {
    e.preventDefault();
    if (!newSku.name.trim()) {
      toast('Enter an item name first.', 'error');
      return;
    }
    const row = {
      code: newSku.code.trim() || `SKU-${abcItems.length + 501}`,
      name: newSku.name.trim(),
      annualQty: Math.max(1, Number(newSku.annualQty) || 1),
      unitCost: Math.max(0.01, Number(newSku.unitCost) || 1),
      demandCv: Math.max(0, Number(newSku.demandCv) || 0.2),
    };
    setAbcItems((prev) => [...prev, row]);
    setNewSku({ code: '', name: '', annualQty: '1200', unitCost: '50', demandCv: '0.25' });
    toast(`Added ${row.code} to ABC-XYZ classification.`);
  }

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readLabSpreadsheetRows(file);
      const nextAbc = [];
      const nextBins = [];
      rows.forEach((r, idx) => {
        if (r.length < 4) return;
        const qty = Number(String(r[2]).replace(/[^0-9.-]/g, ''));
        const cost = Number(String(r[3]).replace(/[^0-9.-]/g, ''));
        if (idx === 0 && !Number.isFinite(qty)) return;
        if (!Number.isFinite(qty) || !Number.isFinite(cost)) return;
        const cv = Number(String(r[4] ?? '0.25').replace(/[^0-9.-]/g, ''));
        const code = String(r[0] || `SKU-${idx + 1}`).trim();
        const name = String(r[1] || `Item ${idx + 1}`).trim();
        nextAbc.push({
          code,
          name,
          annualQty: Math.max(0, qty),
          unitCost: Math.max(0, cost),
          demandCv: Number.isFinite(cv) ? Math.max(0, cv) : 0.25,
        });
        if (r.length >= 7) {
          const sys = Number(String(r[5]).replace(/[^0-9.-]/g, ''));
          const phys = Number(String(r[6]).replace(/[^0-9.-]/g, ''));
          if (Number.isFinite(sys) && Number.isFinite(phys)) {
            nextBins.push({
              bin: String(r[7] || `BIN-${idx + 1}`).trim(),
              code,
              item: name,
              systemQty: Math.max(0, sys),
              physicalQty: Math.max(0, phys),
              unitCost: Math.max(0, cost),
              reason: '',
            });
          }
        }
      });
      if (!nextAbc.length) throw new Error('Use columns: Code, ItemName, AnnualQty, UnitCost, DemandCV, [SystemQty, PhysicalQty, Bin].');
      setAbcItems(nextAbc);
      if (nextBins.length) setBins(nextBins);
      toast(`Imported ${nextAbc.length} SKUs${nextBins.length ? ` and ${nextBins.length} cycle-count bins` : ''} from ${file.name}.`);
    } catch (err) {
      toast(err.message || 'Could not parse CSV/Excel file.', 'error');
    } finally {
      e.target.value = '';
    }
  }

  function exportAuditCsv() {
    const header = 'Code,ItemName,AnnualQty,UnitCost,AnnualSpend,DemandCV,ABC,XYZ,Segment,RecommendedPolicy';
    const lines = abcResult.items.map((r) => [
      `"${r.code}"`,
      `"${r.name.replace(/"/g, '""')}"`,
      r.annualQty,
      r.unitCost,
      r.annualSpend,
      r.demandCv,
      r.abc,
      r.xyz,
      r.segment,
      `"${r.policy}"`,
    ].join(','));
    downloadText('inventory-abc-xyz-export.csv', [header, ...lines].join('\n'));
    toast('Exported ABC-XYZ classification CSV.');
  }

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const discrepancyLines = cycleAudit.rows
        .filter((r) => !r.withinTolerance)
        .map(
          (r) =>
            `  - Bin ${r.bin} (${r.code} · ${r.item}): System ${r.systemQty} vs Physical ${r.physicalQty} | Var ${r.unitVariance > 0 ? '+' : ''}${r.unitVariance} (${r.variancePct}%) | Value ${fmtMoney(currency, r.valueVariance)} | Cause: ${r.reason || 'Unassigned'}`,
        );

      const body = [
        `LABORATORY: PSIS-LAB 07 — Inventory Replenishment, ABC-XYZ Segmentation & Cycle Counting`,
        `====================================================================`,
        ``,
        `1. EOQ, SAFETY STOCK & REORDER POINT POLICY (${eoqParams.skuName || 'Selected SKU'})`,
        `- Annual Demand (D): ${Number(eoqParams.annualDemand).toLocaleString()} units/yr | Avg Daily Demand: ${eoqPolicy.avgDailyDemand} units/day`,
        `- Unit Cost (C): ${fmtMoney(currency, eoqParams.unitCost)} | Ordering Cost (S): ${fmtMoney(currency, eoqParams.orderingCost)} | Holding Cost (H): ${fmtMoney(currency, eoqPolicy.holdingCostPerUnit)}/unit/yr (${eoqParams.holdingRatePct}%)`,
        `- Optimal EOQ (Q*): ${eoqPolicy.eoq.toLocaleString()} units (${eoqPolicy.ordersPerYear} orders/yr, every ${eoqPolicy.daysBetweenOrders} operating days)`,
        `- Target Service Level: ${eoqParams.serviceLevelPct}% (z = ${eoqPolicy.zScore}) | Lead Time: ${eoqParams.leadTimeDays} days | Daily Demand Std Dev: ${eoqParams.dailyDemandStd}`,
        `- Safety Stock (SS): ${eoqPolicy.safetyStock.toLocaleString()} units | Reorder Point (ROP): ${eoqPolicy.reorderPoint.toLocaleString()} units`,
        `- Total Relevant Annual Inventory Cost (Order + Cycle Hold + Safety Hold): ${fmtMoney(currency, eoqPolicy.totalRelevantAnnualCost)}`,
        ``,
        `2. ABC-XYZ 9-QUADRANT PORTFOLIO SEGMENTATION`,
        `- Total SKUs Classified: ${abcResult.totalSkus} | Total Annual Consumption Value: ${fmtMoney(currency, abcResult.totalSpend)}`,
        `- ABC Breakdown: Class A = ${abcResult.aCount} SKUs | Class B = ${abcResult.bCount} SKUs | Class C = ${abcResult.cCount} SKUs`,
        `- Matrix Counts: AX=${abcResult.matrixCounts.AX}, AY=${abcResult.matrixCounts.AY}, AZ=${abcResult.matrixCounts.AZ} | BX=${abcResult.matrixCounts.BX}, BY=${abcResult.matrixCounts.BY}, BZ=${abcResult.matrixCounts.BZ} | CX=${abcResult.matrixCounts.CX}, CY=${abcResult.matrixCounts.CY}, CZ=${abcResult.matrixCounts.CZ}`,
        ``,
        `3. WAREHOUSE CYCLE COUNT VARIANCE AUDIT (±${tolerancePct}% Tolerance)`,
        `- Book-to-Physical Bin Accuracy: ${cycleAudit.binAccuracyPct}% (${cycleAudit.accurateBins}/${cycleAudit.totalBins} bins within tolerance)`,
        `- Inventory Value Accuracy: ${cycleAudit.valueAccuracyPct}% | System Stock Value: ${fmtMoney(currency, cycleAudit.totalSystemValue)}`,
        `- Net Shrinkage / Adjustment Value: ${fmtMoney(currency, cycleAudit.netShrinkageValue)} | Absolute Variance: ${fmtMoney(currency, cycleAudit.totalAbsVarianceValue)}`,
        ...(discrepancyLines.length
          ? [`- Out-of-Tolerance Bins Flagged (${discrepancyLines.length}):`, ...discrepancyLines]
          : [`- All audited bins passed within the ±${tolerancePct}% tolerance threshold.`]),
        ``,
        `4. STUDENT MANAGERIAL JUDGEMENT & WMS CONTROL PLAN`,
        judgement.trim() || '(No written judgement entered.)',
      ].join('\n');

      return {
        title: config?.title || 'Inventory Replenishment, ABC-XYZ Segmentation & Cycle Counting Lab Report',
        body,
        hasJudgement: judgement.trim().length >= 30,
      };
    });
  }, [config?.title, currency, eoqParams, eoqPolicy, abcResult, cycleAudit, tolerancePct, judgement, onRegisterReportBuilder]);

  return (
    <div className="stack">
      {/* Top Toolbar */}
      <div className="card-soft stack-sm" style={{ padding: 14 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="row-wrap" style={{ gap: 6 }}>
            {[
              { id: 'eoq', label: '1. EOQ, Safety Stock & ROP' },
              { id: 'abc', label: '2. ABC-XYZ Matrix' },
              { id: 'cycle', label: '3. Cycle Count Audit' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                className={`btn btn-sm ${activeTab === t.id ? 'btn-primary' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="row-wrap" style={{ gap: 6 }}>
            {allowStudentEdit && !lecturerCustom && (
              <select
                className="input"
                style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                value={presetId}
                onChange={(e) => loadPreset(e.target.value)}
                aria-label="Select inventory preset"
              >
                {INVENTORY_WMS_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            {allowStudentEdit && (
              <>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleCsvUpload} />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const tpl = buildLabCsvTemplate('psis_inventory_wms');
                    downloadText(tpl.filename, tpl.content);
                  }}
                >
                  <Icon name="download" size={13} /> CSV Template
                </button>
                <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={13} /> Import SKU CSV
                </button>
              </>
            )}
            <button type="button" className="btn btn-sm" onClick={exportAuditCsv}>
              <Icon name="download" size={13} /> Export ABC-XYZ CSV
            </button>
          </div>
        </div>
      </div>

      {/* TAB 1: EOQ, Safety Stock & Reorder Point */}
      {activeTab === 'eoq' && (
        <div className="lab-split-grid">
          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="tiny muted">INVENTORY REPLENISHMENT PARAMETERS</div>
            <label className="stack-xs">
              <span className="tiny muted">SKU Description</span>
              <input
                className="input"
                value={eoqParams.skuName || ''}
                onChange={(e) => setEoqParams((p) => ({ ...p, skuName: e.target.value }))}
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label className="stack-xs">
                <span className="tiny muted">Annual Demand (D, units/yr)</span>
                <input
                  className="input mono"
                  type="number"
                  min="1"
                  value={eoqParams.annualDemand}
                  onChange={(e) => setEoqParams((p) => ({ ...p, annualDemand: Number(e.target.value) || 0 }))}
                />
              </label>
              <label className="stack-xs">
                <span className="tiny muted">Unit Cost ({currency})</span>
                <input
                  className="input mono"
                  type="number"
                  min="0.01"
                  step="0.5"
                  value={eoqParams.unitCost}
                  onChange={(e) => setEoqParams((p) => ({ ...p, unitCost: Number(e.target.value) || 0 }))}
                />
              </label>
              <label className="stack-xs">
                <span className="tiny muted">Ordering Cost per PO ({currency})</span>
                <input
                  className="input mono"
                  type="number"
                  min="1"
                  value={eoqParams.orderingCost}
                  onChange={(e) => setEoqParams((p) => ({ ...p, orderingCost: Number(e.target.value) || 0 }))}
                />
              </label>
              <label className="stack-xs">
                <span className="tiny muted">Holding Rate (% of Unit Cost/yr)</span>
                <input
                  className="input mono"
                  type="number"
                  min="1"
                  max="80"
                  value={eoqParams.holdingRatePct}
                  onChange={(e) => setEoqParams((p) => ({ ...p, holdingRatePct: Number(e.target.value) || 1 }))}
                />
              </label>
              <label className="stack-xs">
                <span className="tiny muted">Supplier Lead Time (Days)</span>
                <input
                  className="input mono"
                  type="number"
                  min="1"
                  value={eoqParams.leadTimeDays}
                  onChange={(e) => setEoqParams((p) => ({ ...p, leadTimeDays: Number(e.target.value) || 1 }))}
                />
              </label>
              <label className="stack-xs">
                <span className="tiny muted">Daily Demand Std Dev (σd)</span>
                <input
                  className="input mono"
                  type="number"
                  min="0"
                  step="0.5"
                  value={eoqParams.dailyDemandStd}
                  onChange={(e) => setEoqParams((p) => ({ ...p, dailyDemandStd: Number(e.target.value) || 0 }))}
                />
              </label>
            </div>

            <div className="stack-xs">
              <span className="tiny muted">Cycle Service Level Target (z-score)</span>
              <div className="row-wrap" style={{ gap: 6 }}>
                {Object.keys(SERVICE_LEVEL_Z).map((sl) => {
                  const pct = Number(sl);
                  const active = Number(eoqParams.serviceLevelPct) === pct;
                  return (
                    <button
                      key={sl}
                      type="button"
                      className={`btn btn-sm mono ${active ? 'btn-primary' : ''}`}
                      onClick={() => setEoqParams((p) => ({ ...p, serviceLevelPct: pct }))}
                    >
                      {pct}% (z={SERVICE_LEVEL_Z[pct]})
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="tiny muted">OPTIMAL REPLENISHMENT OUTPUT &amp; COST TRADE-OFF</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
              <div className="kpi">
                <span className="tiny muted">Optimal EOQ (Q*)</span>
                <strong className="mono" style={{ fontSize: 20, color: 'var(--teal-700)' }}>{eoqPolicy.eoq.toLocaleString()}</strong>
                <span className="tiny muted">{eoqPolicy.ordersPerYear} orders/yr · q/{eoqPolicy.daysBetweenOrders}d</span>
              </div>
              <div className="kpi">
                <span className="tiny muted">Reorder Point (ROP)</span>
                <strong className="mono" style={{ fontSize: 20 }}>{eoqPolicy.reorderPoint.toLocaleString()}</strong>
                <span className="tiny muted">Trigger PO when net stock hits ROP</span>
              </div>
              <div className="kpi">
                <span className="tiny muted">Safety Stock (SS)</span>
                <strong className="mono" style={{ fontSize: 20, color: 'var(--amber)' }}>{eoqPolicy.safetyStock.toLocaleString()}</strong>
                <span className="tiny muted">Buffer cost {fmtMoney(currency, eoqPolicy.annualSafetyHoldingCost)}/yr</span>
              </div>
              <div className="kpi">
                <span className="tiny muted">Total Annual Cost</span>
                <strong className="mono" style={{ fontSize: 16 }}>{fmtMoney(currency, eoqPolicy.totalRelevantAnnualCost)}</strong>
                <span className="tiny muted">Order + Cycle + Safety Hold</span>
              </div>
            </div>

            <div className="card-soft" style={{ padding: 10 }}>
              <EoqCostCurveChart policy={eoqPolicy} params={eoqParams} currency={currency} />
            </div>

            <div className="small muted">
              Notice how pushing Service Level from <strong>95%</strong> to <strong>99.9%</strong> nearly doubles Safety Stock holding cost (nonlinear z-tail).
              Use 99%+ only on critical Class A/life-safety SKUs.
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ABC-XYZ 9-Quadrant Matrix */}
      {activeTab === 'abc' && (
        <div className="stack">
          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div className="tiny muted">9-QUADRANT ABC (ANNUAL SPEND) × XYZ (DEMAND VOLATILITY CV) MATRIX</div>
                <div className="small muted">
                  Click any cell to filter the SKU register · X (CV ≤ 0.20 Steady) · Y (0.20–0.50 Seasonal) · Z (CV &gt; 0.50 Erratic)
                </div>
              </div>
              <button
                type="button"
                className={`btn btn-sm ${selectedCell === 'ALL' ? 'btn-primary' : ''}`}
                onClick={() => setSelectedCell('ALL')}
              >
                Show All ({abcResult.totalSkus} SKUs)
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '64px repeat(3, 1fr)', gap: 8, alignItems: 'stretch' }}>
              <div />
              <div className="tiny mono muted" style={{ textAlign: 'center', fontWeight: 700 }}>X — Steady (CV ≤ 0.20)</div>
              <div className="tiny mono muted" style={{ textAlign: 'center', fontWeight: 700 }}>Y — Variable (0.21–0.50)</div>
              <div className="tiny mono muted" style={{ textAlign: 'center', fontWeight: 700 }}>Z — Erratic (CV &gt; 0.50)</div>

              {['A', 'B', 'C'].map((abc) => (
                <div key={abc} style={{ display: 'contents' }}>
                  <div className="tiny mono muted" style={{ display: 'flex', alignItems: 'center', fontWeight: 700 }}>
                    Class {abc}
                  </div>
                  {['X', 'Y', 'Z'].map((xyz) => {
                    const cell = `${abc}${xyz}`;
                    const count = abcResult.matrixCounts[cell] || 0;
                    const active = selectedCell === cell;
                    const bg =
                      cell === 'AX'
                        ? 'var(--teal-50)'
                        : cell === 'AZ'
                          ? 'var(--red-50)'
                          : 'var(--surface-2)';
                    return (
                      <button
                        key={cell}
                        type="button"
                        onClick={() => setSelectedCell(active ? 'ALL' : cell)}
                        style={{
                          padding: '12px 10px',
                          borderRadius: 8,
                          border: active ? '2px solid var(--teal-700)' : '1px solid var(--line)',
                          background: bg,
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <div className="between">
                          <strong className="mono" style={{ fontSize: 14 }}>{cell}</strong>
                          <span className="mono" style={{ fontSize: 16, fontWeight: 700 }}>{count}</span>
                        </div>
                        <div className="tiny muted" style={{ marginTop: 4 }}>
                          {cell === 'AX' && 'JIT / Blanket Call-Off'}
                          {cell === 'AY' && 'Continuous ROP + Review'}
                          {cell === 'AZ' && 'Make-to-Order / Consignment'}
                          {cell === 'BX' && 'Automated ROP'}
                          {cell === 'BY' && 'Periodic Buffer'}
                          {cell === 'BZ' && 'Order on Demand'}
                          {cell === 'CX' && 'Two-Bin / Kanban'}
                          {cell === 'CY' && 'Min-Max Catalogue'}
                          {cell === 'CZ' && 'Spot Buy / Rationalize'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="tiny muted">
                CLASSIFIED SKU REGISTER · TOTAL VALUE: <strong className="mono">{fmtMoney(currency, abcResult.totalSpend)}</strong>
              </div>
              {selectedCell !== 'ALL' && (
                <span className="tiny mono" style={{ color: 'var(--teal-700)', fontWeight: 700 }}>
                  FILTERED: SEGMENT {selectedCell}
                </span>
              )}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>SKU Description</th>
                    <th style={{ textAlign: 'right' }}>Annual Qty</th>
                    <th style={{ textAlign: 'right' }}>Unit Cost</th>
                    <th style={{ textAlign: 'right' }}>Annual Value</th>
                    <th style={{ textAlign: 'right' }}>Cum %</th>
                    <th style={{ textAlign: 'right' }}>CV</th>
                    <th>Segment</th>
                    <th>Recommended WMS Policy</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAbcRows.map((r) => (
                    <tr key={r.code}>
                      <td className="mono tiny">{r.code}</td>
                      <td className="small">{r.name}</td>
                      <td className="mono small" style={{ textAlign: 'right' }}>{r.annualQty.toLocaleString()}</td>
                      <td className="mono small" style={{ textAlign: 'right' }}>{r.unitCost.toLocaleString()}</td>
                      <td className="mono small" style={{ textAlign: 'right', fontWeight: 600 }}>
                        {fmtMoney(currency, r.annualSpend)}
                      </td>
                      <td className="mono tiny" style={{ textAlign: 'right' }}>{r.cumSpendPct}%</td>
                      <td className="mono tiny" style={{ textAlign: 'right' }}>{r.demandCv.toFixed(2)}</td>
                      <td
                        className="mono tiny"
                        style={{
                          fontWeight: 700,
                          color: r.segment === 'AZ' ? 'var(--red)' : r.abc === 'A' ? 'var(--teal-700)' : 'var(--text)',
                        }}
                      >
                        {r.segment}
                      </td>
                      <td className="tiny muted">{r.policy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {allowStudentEdit && (
              <form onSubmit={addCustomSku} className="row-wrap" style={{ gap: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                <input
                  className="input"
                  style={{ width: 96 }}
                  placeholder="SKU-510"
                  value={newSku.code}
                  onChange={(e) => setNewSku((s) => ({ ...s, code: e.target.value }))}
                />
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 170 }}
                  placeholder="Add custom SKU description…"
                  value={newSku.name}
                  onChange={(e) => setNewSku((s) => ({ ...s, name: e.target.value }))}
                />
                <input
                  className="input mono"
                  style={{ width: 96 }}
                  type="number"
                  placeholder="Ann Qty"
                  value={newSku.annualQty}
                  onChange={(e) => setNewSku((s) => ({ ...s, annualQty: e.target.value }))}
                />
                <input
                  className="input mono"
                  style={{ width: 90 }}
                  type="number"
                  placeholder="Unit Cost"
                  value={newSku.unitCost}
                  onChange={(e) => setNewSku((s) => ({ ...s, unitCost: e.target.value }))}
                />
                <input
                  className="input mono"
                  style={{ width: 82 }}
                  type="number"
                  step="0.05"
                  placeholder="CV"
                  value={newSku.demandCv}
                  onChange={(e) => setNewSku((s) => ({ ...s, demandCv: e.target.value }))}
                />
                <button type="submit" className="btn btn-sm btn-primary">
                  <Icon name="plus" size={13} /> Add SKU
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Warehouse Cycle Count Audit */}
      {activeTab === 'cycle' && (
        <div className="card stack-sm" style={{ padding: 16 }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div className="tiny muted">WAREHOUSE CYCLE COUNT — BOOK-TO-PHYSICAL RECONCILIATION</div>
              <div className="small muted">
                Compare ERP system stock against physical bin counts, flag out-of-tolerance variances, and assign root-cause adjustments.
              </div>
            </div>
            <label className="row" style={{ gap: 8 }}>
              <span className="tiny muted">Tolerance (±%):</span>
              <input
                className="input mono"
                type="number"
                min="0"
                max="20"
                step="0.5"
                style={{ width: 72 }}
                value={tolerancePct}
                onChange={(e) => setTolerancePct(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <div className="kpi">
              <span className="tiny muted">Bin Accuracy</span>
              <strong className="mono" style={{ fontSize: 20, color: cycleAudit.binAccuracyPct >= 95 ? 'var(--teal-700)' : 'var(--amber)' }}>
                {cycleAudit.binAccuracyPct}%
              </strong>
              <span className="tiny muted">{cycleAudit.accurateBins}/{cycleAudit.totalBins} bins pass</span>
            </div>
            <div className="kpi">
              <span className="tiny muted">Value Accuracy</span>
              <strong className="mono" style={{ fontSize: 20 }}>{cycleAudit.valueAccuracyPct}%</strong>
              <span className="tiny muted">System: {fmtMoney(currency, cycleAudit.totalSystemValue)}</span>
            </div>
            <div className="kpi">
              <span className="tiny muted">Net Shrinkage / Adj</span>
              <strong className="mono" style={{ fontSize: 18, color: cycleAudit.netShrinkageValue < 0 ? 'var(--red)' : 'var(--teal-700)' }}>
                {fmtMoney(currency, cycleAudit.netShrinkageValue)}
              </strong>
              <span className="tiny muted">Abs Var: {fmtMoney(currency, cycleAudit.totalAbsVarianceValue)}</span>
            </div>
            <div className="kpi">
              <span className="tiny muted">Bins Requiring Audit</span>
              <strong className="mono" style={{ fontSize: 20, color: cycleAudit.discrepancyBins > 0 ? 'var(--red)' : 'var(--teal-700)' }}>
                {cycleAudit.discrepancyBins}
              </strong>
              <span className="tiny muted">Exceeding ±{tolerancePct}%</span>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Bin</th>
                  <th>Item</th>
                  <th style={{ textAlign: 'right' }}>ERP Qty</th>
                  <th style={{ textAlign: 'right' }}>Physical Count</th>
                  <th style={{ textAlign: 'right' }}>Var (Units / %)</th>
                  <th style={{ textAlign: 'right' }}>Value Impact</th>
                  <th>Status</th>
                  <th>Root Cause Diagnosis</th>
                </tr>
              </thead>
              <tbody>
                {cycleAudit.rows.map((r, idx) => (
                  <tr key={r.bin + idx}>
                    <td className="mono tiny" style={{ fontWeight: 700 }}>{r.bin}</td>
                    <td className="small">
                      <strong>{r.code}</strong> · {r.item}
                    </td>
                    <td className="mono small" style={{ textAlign: 'right' }}>{r.systemQty.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        className="input mono"
                        type="number"
                        min="0"
                        style={{ width: 84, textAlign: 'right', padding: '4px 8px' }}
                        value={r.physicalQty}
                        onChange={(e) => {
                          const val = Math.max(0, Number(e.target.value) || 0);
                          setBins((prev) => prev.map((b, i) => (i === idx ? { ...b, physicalQty: val } : b)));
                        }}
                      />
                    </td>
                    <td className="mono tiny" style={{ textAlign: 'right', color: r.unitVariance < 0 ? 'var(--red)' : 'var(--text)' }}>
                      {r.unitVariance > 0 ? '+' : ''}{r.unitVariance} ({r.variancePct}%)
                    </td>
                    <td className="mono tiny" style={{ textAlign: 'right', fontWeight: 600 }}>
                      {fmtMoney(currency, r.valueVariance)}
                    </td>
                    <td className="mono tiny" style={{ fontWeight: 700, color: r.withinTolerance ? 'var(--teal-700)' : 'var(--red)' }}>
                      {r.withinTolerance ? '● PASS' : '▲ RECOUNT'}
                    </td>
                    <td>
                      <select
                        className="input"
                        style={{ fontSize: 12, padding: '4px 6px', minWidth: 165 }}
                        value={r.reason || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBins((prev) => prev.map((b, i) => (i === idx ? { ...b, reason: val } : b)));
                        }}
                      >
                        {ROOT_CAUSE_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt || 'Select root cause…'}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Managerial Judgement */}
      <div className="card stack-xs" style={{ padding: 16 }}>
        <div className="between">
          <strong className="small">Managerial Judgement &amp; Warehouse Control Recommendation</strong>
          <span className="tiny mono muted">{judgement.trim().length} chars {judgement.trim().length >= 30 ? '· ● Ready' : '· min 30 chars'}</span>
        </div>
        <div className="tiny muted">
          {config?.instructions || 'Justify your EOQ/ROP service-level choice, contrast your AX vs. AZ/CZ replenishment policies, and explain how barcode scanning + cycle counting eliminates the shrinkage observed above.'}
        </div>
        <textarea
          className="input"
          rows={4}
          placeholder="Write your quantitative inventory and WMS control analysis here…"
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
        />
      </div>
    </div>
  );
}
