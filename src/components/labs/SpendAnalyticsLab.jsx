import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { useToast } from '../ui.jsx';
import {
  buildLabCsvTemplate,
  getLabPreset,
  readLabSpreadsheetRows,
  SPEND_ANALYTICS_PRESETS,
} from '../../lib/labsCatalog.js';
import {
  computeSpendCubeAnalytics,
  computeSupplierScorecards,
} from '../../lib/psisMilestone4Engine.js';
import { downloadText } from '../../lib/sheets.js';

function fmtMoney(currency, val) {
  const n = Number(val || 0);
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function tierColor(tier) {
  if (tier === 'PREFERRED') return 'var(--teal-700)';
  if (tier === 'APPROVED') return 'var(--text)';
  if (tier === 'WATCHLIST') return 'var(--amber)';
  return 'var(--red)';
}

function tierLabel(tier) {
  if (tier === 'PREFERRED') return '● PREFERRED';
  if (tier === 'APPROVED') return '○ APPROVED';
  if (tier === 'WATCHLIST') return '▲ WATCHLIST';
  return '■ AT RISK';
}

function parseCrossLabOrSpendRows(rows) {
  if (!rows?.length) return { suppliers: [], sourceLabel: '' };
  const hdr = rows[0].map((c) => String(c || '').toLowerCase().trim());

  // 1. Detect "The Match" (P2P 3-Way Match) export: PO_No, GRN_No, Invoice_No, Supplier, Item, PO_Qty, PO_UnitPrice, GRN_Qty, Inv_Qty, Inv_UnitPrice
  if (hdr.some((h) => /po_no|invoice_no/.test(h)) && hdr.some((h) => /supplier/.test(h))) {
    const supIdx = hdr.findIndex((h) => /supplier/.test(h));
    const itemIdx = hdr.findIndex((h) => /item|category/.test(h));
    const poQtyIdx = hdr.findIndex((h) => /po_qty/.test(h));
    const poPriceIdx = hdr.findIndex((h) => /po_unitprice|po_price/.test(h));
    const grnQtyIdx = hdr.findIndex((h) => /grn_qty/.test(h));
    const invQtyIdx = hdr.findIndex((h) => /inv_qty/.test(h));
    const invPriceIdx = hdr.findIndex((h) => /inv_unitprice|inv_price/.test(h));
    const map = new Map();

    rows.slice(1).forEach((r) => {
      const sup = String(r[supIdx] || '').trim();
      if (!sup) return;
      const poQty = Number(String(r[poQtyIdx] || 0).replace(/[^0-9.-]/g, '')) || 0;
      const poPrice = Number(String(r[poPriceIdx] || 0).replace(/[^0-9.-]/g, '')) || 0;
      const grnQty = Number(String(r[grnQtyIdx] || 0).replace(/[^0-9.-]/g, '')) || 0;
      const invQty = Number(String(r[invQtyIdx] || poQty).replace(/[^0-9.-]/g, '')) || 0;
      const invPrice = Number(String(r[invPriceIdx] || poPrice).replace(/[^0-9.-]/g, '')) || 0;
      const spend = Math.max(0, invQty * invPrice);
      const prev = map.get(sup) || {
        supplier: sup,
        category: String(r[itemIdx] || 'P2P Imported').trim(),
        annualSpend: 0,
        totalLines: 0,
        fullDeliveries: 0,
        priceVarSum: 0,
      };
      prev.annualSpend += spend;
      prev.totalLines += 1;
      if (poQty > 0 && grnQty >= poQty) prev.fullDeliveries += 1;
      if (poPrice > 0) prev.priceVarSum += ((invPrice - poPrice) / poPrice) * 100;
      map.set(sup, prev);
    });

    const suppliers = [...map.values()].map((s, idx) => ({
      id: `p2p_imp_${idx + 1}`,
      supplier: s.supplier,
      category: s.category,
      annualSpend: Number(s.annualSpend.toFixed(2)),
      otifPct: s.totalLines ? Math.round((s.fullDeliveries / s.totalLines) * 100) : 85,
      defectPpm: s.fullDeliveries < s.totalLines ? 6500 : 1200,
      priceVariancePct: s.totalLines ? Number((s.priceVarSum / s.totalLines).toFixed(1)) : 0,
      responsivenessScore: s.fullDeliveries === s.totalLines ? 88 : 68,
      onContract: s.priceVarSum <= 2,
    }));
    return { suppliers, sourceLabel: 'Imported from The Match (P2P 3-Way Match CSV)' };
  }

  // 2. Detect "Requisition to Order" export: ReqNo, Item, Supplier, CostCentre, Qty, UnitPrice
  if (hdr.some((h) => /reqno|requisition/.test(h)) && hdr.some((h) => /supplier/.test(h))) {
    const supIdx = hdr.findIndex((h) => /supplier/.test(h));
    const ccIdx = hdr.findIndex((h) => /costcentre|cost_centre|dept/.test(h));
    const qtyIdx = hdr.findIndex((h) => /^qty|quantity/.test(h));
    const priceIdx = hdr.findIndex((h) => /unitprice|price/.test(h));
    const map = new Map();

    rows.slice(1).forEach((r) => {
      const sup = String(r[supIdx] || '').trim();
      if (!sup) return;
      const qty = Number(String(r[qtyIdx] || 0).replace(/[^0-9.-]/g, '')) || 0;
      const price = Number(String(r[priceIdx] || 0).replace(/[^0-9.-]/g, '')) || 0;
      const prev = map.get(sup) || {
        supplier: sup,
        category: String(r[ccIdx] || 'Requisitioned Spend').trim(),
        annualSpend: 0,
        reqCount: 0,
      };
      prev.annualSpend += Math.max(0, qty * price);
      prev.reqCount += 1;
      map.set(sup, prev);
    });

    const suppliers = [...map.values()].map((s, idx) => ({
      id: `req_imp_${idx + 1}`,
      supplier: s.supplier,
      category: s.category,
      annualSpend: Number(s.annualSpend.toFixed(2)),
      otifPct: 86,
      defectPpm: 2400,
      priceVariancePct: s.reqCount > 2 ? 4.5 : 1.0,
      responsivenessScore: 82,
      onContract: s.reqCount <= 2,
    }));
    return { suppliers, sourceLabel: 'Imported from Requisition to Order (DoA CSV)' };
  }

  // 3. Standard Supplier Scorecard / Spend Cube CSV: Supplier, Category, AnnualSpend, OTIF_Pct, Defect_PPM, PriceVariance_Pct, Responsiveness_0_100, OnContract
  const suppliers = [];
  rows.forEach((r, idx) => {
    if (r.length < 3) return;
    const spend = Number(String(r[2]).replace(/[^0-9.-]/g, ''));
    if (idx === 0 && !Number.isFinite(spend)) return;
    if (!Number.isFinite(spend)) return;
    const otif = Number(String(r[3] ?? '88').replace(/[^0-9.-]/g, ''));
    const ppm = Number(String(r[4] ?? '2000').replace(/[^0-9.-]/g, ''));
    const pvar = Number(String(r[5] ?? '1.5').replace(/[^0-9.-]/g, ''));
    const resp = Number(String(r[6] ?? '80').replace(/[^0-9.-]/g, ''));
    const onContract = r[7] !== undefined ? !/no|false|0|off|maverick/i.test(String(r[7])) : true;
    suppliers.push({
      id: `csv_sup_${idx + 1}`,
      supplier: String(r[0] || `Supplier ${idx + 1}`).trim(),
      category: String(r[1] || 'General').trim(),
      annualSpend: Math.max(0, spend),
      otifPct: Number.isFinite(otif) ? otif : 85,
      defectPpm: Number.isFinite(ppm) ? ppm : 2000,
      priceVariancePct: Number.isFinite(pvar) ? pvar : 1.5,
      responsivenessScore: Number.isFinite(resp) ? resp : 80,
      onContract,
    });
  });
  return { suppliers, sourceLabel: 'Imported from Supplier Spend CSV' };
}

export default function SpendAnalyticsLab({
  config,
  dataMode = 'both',
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const toast = useToast();
  const fileRef = useRef(null);

  const lecturerCustom = config?.customDataset || null;
  const defaultPreset = getLabPreset('psis_spend_analytics', config?.presetId) || SPEND_ANALYTICS_PRESETS[0];
  const allowStudentEdit = dataMode !== 'lecturer_only';

  const [activeTab, setActiveTab] = useState(draftState?.activeTab || 'scorecard');
  const [presetId, setPresetId] = useState(draftState?.presetId || defaultPreset.id);
  const [currency, setCurrency] = useState(draftState?.currency || lecturerCustom?.currency || defaultPreset.currency || 'GHS');
  const [weights, setWeights] = useState(
    draftState?.weights || defaultPreset.defaultWeights || { otif: 35, quality: 30, price: 20, responsiveness: 15 },
  );
  const [suppliers, setSuppliers] = useState(
    draftState?.suppliers || lecturerCustom?.suppliers || defaultPreset.suppliers,
  );
  const [importBanner, setImportBanner] = useState(draftState?.importBanner || '');
  const [judgement, setJudgement] = useState(draftState?.judgement || '');

  const [newSup, setNewSup] = useState({
    supplier: '',
    category: 'Packaging & Stores',
    annualSpend: '95000',
    otifPct: '88',
    defectPpm: '1800',
    priceVariancePct: '2.0',
    responsivenessScore: '84',
    onContract: true,
  });

  useEffect(() => {
    onDraftChange?.({ activeTab, presetId, currency, weights, suppliers, importBanner, judgement });
  }, [activeTab, presetId, currency, weights, suppliers, importBanner, judgement]);

  const scorecard = useMemo(() => computeSupplierScorecards(suppliers, weights), [suppliers, weights]);
  const spendCube = useMemo(() => computeSpendCubeAnalytics(suppliers), [suppliers]);

  function loadPreset(id) {
    const p = getLabPreset('psis_spend_analytics', id) || SPEND_ANALYTICS_PRESETS[0];
    setPresetId(p.id);
    setCurrency(p.currency || 'GHS');
    setWeights({ ...p.defaultWeights });
    setSuppliers(p.suppliers.map((s) => ({ ...s })));
    setImportBanner('');
    toast(`Loaded preset: ${p.name}`);
  }

  function addSupplier(e) {
    e.preventDefault();
    if (!newSup.supplier.trim()) {
      toast('Enter a supplier name first.', 'error');
      return;
    }
    setSuppliers((prev) => [
      ...prev,
      {
        id: `sup_${Date.now()}`,
        supplier: newSup.supplier.trim(),
        category: newSup.category.trim() || 'General',
        annualSpend: Math.max(0, Number(newSup.annualSpend) || 0),
        otifPct: Math.max(0, Math.min(100, Number(newSup.otifPct) || 0)),
        defectPpm: Math.max(0, Number(newSup.defectPpm) || 0),
        priceVariancePct: Number(newSup.priceVariancePct) || 0,
        responsivenessScore: Math.max(0, Math.min(100, Number(newSup.responsivenessScore) || 0)),
        onContract: Boolean(newSup.onContract),
      },
    ]);
    setNewSup((s) => ({ ...s, supplier: '' }));
    toast('Added supplier to scorecard & spend cube.');
  }

  async function handleCsvImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readLabSpreadsheetRows(file);
      const { suppliers: parsed, sourceLabel } = parseCrossLabOrSpendRows(rows);
      if (!parsed.length) {
        throw new Error('Could not parse rows. Upload a Supplier Scorecard CSV, or a CSV exported from The Match / Requisition to Order.');
      }
      setSuppliers(parsed);
      setImportBanner(`${sourceLabel} — ${parsed.length} suppliers consolidated from "${file.name}".`);
      toast(`Loaded ${parsed.length} suppliers (${sourceLabel}).`);
    } catch (err) {
      toast(err.message || 'Could not import CSV/Excel file.', 'error');
    } finally {
      e.target.value = '';
    }
  }

  function exportScorecardCsv() {
    const header = 'Rank,Supplier,Category,AnnualSpend,OTIF_Pct,Defect_PPM,PriceVar_Pct,Responsiveness,CompositeScore,Tier,OnContract';
    const lines = scorecard.rows.map((r, i) => [
      i + 1,
      `"${r.supplier.replace(/"/g, '""')}"`,
      `"${r.category.replace(/"/g, '""')}"`,
      r.annualSpend,
      r.otifPct,
      r.defectPpm,
      r.priceVariancePct,
      r.responsivenessScore,
      r.compositeScore,
      r.tier,
      r.onContract ? 'Yes' : 'No',
    ].join(','));
    downloadText('supplier-scorecard-spend-report.csv', [header, ...lines].join('\n'));
    toast('Exported ranked Supplier Scorecard CSV.');
  }

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const w = scorecard.normalizedWeights;
      const topRows = scorecard.rows.map(
        (r, i) =>
          `  ${i + 1}. ${r.supplier} (${r.category}) | Spend: ${fmtMoney(currency, r.annualSpend)} | OTIF: ${r.otifPct}% | PPM: ${r.defectPpm} | PriceVar: ${r.priceVariancePct}% | Score: ${r.compositeScore}/100 [${r.tier}] ${r.onContract ? 'On-Contract' : 'MAVERICK/OFF-CONTRACT'}`,
      );
      const catRows = spendCube.categoryPareto.map(
        (c) => `  - ${c.category}: ${fmtMoney(currency, c.spend)} (${c.sharePct}% share | Cum ${c.cumPct}% | ${c.suppliers} supplier(s))`,
      );

      const body = [
        `PSIS-LAB 08 — SUPPLIER KPI SCORECARD & SPEND CUBE ANALYTICS REPORT`,
        `====================================================================`,
        ``,
        `1. WEIGHTED SUPPLIER PERFORMANCE SCORECARD`,
        `- Active Weights (Normalized): OTIF ${w.otif}% | Quality (PPM) ${w.quality}% | Price Variance ${w.price}% | Responsiveness ${w.responsiveness}%`,
        `- Portfolio Average Supplier Score: ${scorecard.avgScore} / 100`,
        `- Tier Distribution: Preferred = ${scorecard.preferredCount} | Watchlist / At-Risk = ${scorecard.atRiskCount} | Total Suppliers = ${scorecard.rows.length}`,
        ...(importBanner ? [`- Data Continuity Source: ${importBanner}`] : []),
        ...topRows,
        ``,
        `2. SPEND CUBE PARETO, MAVERICK & TAIL SPEND DIAGNOSTICS`,
        `- Total Addressable Annual Spend: ${fmtMoney(currency, spendCube.totalSpend)}`,
        `- Maverick (Off-Contract) Spend: ${fmtMoney(currency, spendCube.maverickSpend)} (${spendCube.maverickPct}% of total spend)`,
        `- Top-3 Supplier Concentration: ${spendCube.top3SharePct}% of total spend`,
        `- Tail Spend (Bottom 20% Cumulative Spend): ${spendCube.tailSupplierCount} supplier(s) totaling ${fmtMoney(currency, spendCube.tailSpend)}`,
        `- Category Spend Pareto:`,
        ...catRows,
        ``,
        `3. STUDENT MANAGERIAL JUDGEMENT & CATEGORY STRATEGY`,
        judgement.trim() || '(No written judgement entered.)',
      ].join('\n');

      return {
        title: config?.title || 'Supplier Scorecard & Spend Cube Analytics Lab Report',
        body,
        hasJudgement: judgement.trim().length >= 30,
      };
    });
  }, [config?.title, currency, scorecard, spendCube, importBanner, judgement, onRegisterReportBuilder]);

  return (
    <div className="stack">
      {/* Top Toolbar */}
      <div className="card-soft stack-sm" style={{ padding: 14 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="row-wrap" style={{ gap: 6 }}>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'scorecard' ? 'btn-primary' : ''}`}
              onClick={() => setActiveTab('scorecard')}
            >
              1. Weighted Supplier KPI Scorecard
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTab === 'spendcube' ? 'btn-primary' : ''}`}
              onClick={() => setActiveTab('spendcube')}
            >
              2. Spend Cube, Maverick &amp; Tail Spend
            </button>
          </div>

          <div className="row-wrap" style={{ gap: 6 }}>
            {allowStudentEdit && !lecturerCustom && (
              <select
                className="input"
                style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
                value={presetId}
                onChange={(e) => loadPreset(e.target.value)}
                aria-label="Select spend portfolio preset"
              >
                {SPEND_ANALYTICS_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            {allowStudentEdit && (
              <>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleCsvImport} />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const tpl = buildLabCsvTemplate('psis_spend_analytics');
                    downloadText(tpl.filename, tpl.content);
                  }}
                >
                  <Icon name="download" size={13} /> CSV Template
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => fileRef.current?.click()}
                  title="Import your own Spend CSV or directly import CSV exports from The Match (P2P) or Requisition to Order"
                >
                  <Icon name="upload" size={13} /> Import Spend / Cross-Lab CSV
                </button>
              </>
            )}
            <button type="button" className="btn btn-sm" onClick={exportScorecardCsv}>
              <Icon name="download" size={13} /> Export Scorecard CSV
            </button>
          </div>
        </div>

        {importBanner && (
          <div className="notice small" style={{ margin: 0 }}>
            <strong>Cross-Lab Data Continuity Active:</strong> {importBanner}
          </div>
        )}
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div className="kpi">
          <span className="tiny muted">Total Annual Spend</span>
          <strong className="mono" style={{ fontSize: 18 }}>{fmtMoney(currency, spendCube.totalSpend)}</strong>
          <span className="tiny muted">{suppliers.length} active suppliers</span>
        </div>
        <div className="kpi">
          <span className="tiny muted">Portfolio Avg Score</span>
          <strong className="mono" style={{ fontSize: 20, color: scorecard.avgScore >= 80 ? 'var(--teal-700)' : 'var(--amber)' }}>
            {scorecard.avgScore} / 100
          </strong>
          <span className="tiny muted">{scorecard.preferredCount} Preferred · {scorecard.atRiskCount} Watch/Risk</span>
        </div>
        <div className="kpi">
          <span className="tiny muted">Maverick (Off-Contract)</span>
          <strong className="mono" style={{ fontSize: 20, color: spendCube.maverickPct > 15 ? 'var(--red)' : 'var(--teal-700)' }}>
            {spendCube.maverickPct}%
          </strong>
          <span className="tiny muted">{fmtMoney(currency, spendCube.maverickSpend)} off-contract</span>
        </div>
        <div className="kpi">
          <span className="tiny muted">Tail Spend Suppliers</span>
          <strong className="mono" style={{ fontSize: 20 }}>{spendCube.tailSupplierCount}</strong>
          <span className="tiny muted">Bottom 20% = {fmtMoney(currency, spendCube.tailSpend)}</span>
        </div>
      </div>

      {/* TAB 1: Weighted Supplier KPI Scorecard */}
      {activeTab === 'scorecard' && (
        <div className="stack">
          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="tiny muted">
                KPI EVALUATION WEIGHTS (AUTO-NORMALIZED TO 100%)
              </div>
              <div className="tiny mono muted">
                OTIF {scorecard.normalizedWeights.otif}% · Quality {scorecard.normalizedWeights.quality}% · Price {scorecard.normalizedWeights.price}% · Resp {scorecard.normalizedWeights.responsiveness}%
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {[
                { key: 'otif', label: 'OTIF Delivery Weight' },
                { key: 'quality', label: 'Quality (Defect PPM) Weight' },
                { key: 'price', label: 'Price Variance Weight' },
                { key: 'responsiveness', label: 'Responsiveness Weight' },
              ].map((w) => (
                <label key={w.key} className="stack-xs">
                  <div className="between tiny">
                    <span className="muted">{w.label}</span>
                    <strong className="mono">{weights[w.key]}</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="60"
                    value={weights[w.key]}
                    onChange={(e) => setWeights((prev) => ({ ...prev, [w.key]: Number(e.target.value) }))}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="tiny muted">RANKED SUPPLIER SCORECARD (EDIT KPIs OR CONTRACT STATUS LIVE)</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Supplier &amp; Category</th>
                    <th style={{ textAlign: 'right' }}>Annual Spend</th>
                    <th style={{ textAlign: 'right' }}>OTIF %</th>
                    <th style={{ textAlign: 'right' }}>Defect PPM</th>
                    <th style={{ textAlign: 'right' }}>Price Var %</th>
                    <th style={{ textAlign: 'right' }}>Resp.</th>
                    <th style={{ textAlign: 'right' }}>Score</th>
                    <th>Tier</th>
                    <th>Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecard.rows.map((r, idx) => (
                    <tr key={r.id}>
                      <td className="mono tiny muted">{idx + 1}</td>
                      <td>
                        <div className="small" style={{ fontWeight: 600 }}>{r.supplier}</div>
                        <div className="tiny muted">{r.category}</div>
                      </td>
                      <td className="mono small" style={{ textAlign: 'right' }}>{fmtMoney(currency, r.annualSpend)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          className="input mono"
                          type="number"
                          min="0"
                          max="100"
                          style={{ width: 64, textAlign: 'right', padding: '3px 6px' }}
                          value={r.otifPct}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                            setSuppliers((prev) => prev.map((s) => (s.id === r.id ? { ...s, otifPct: val } : s)));
                          }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          className="input mono"
                          type="number"
                          min="0"
                          step="100"
                          style={{ width: 76, textAlign: 'right', padding: '3px 6px' }}
                          value={r.defectPpm}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value) || 0);
                            setSuppliers((prev) => prev.map((s) => (s.id === r.id ? { ...s, defectPpm: val } : s)));
                          }}
                        />
                      </td>
                      <td className="mono tiny" style={{ textAlign: 'right', color: r.priceVariancePct > 5 ? 'var(--red)' : 'var(--text)' }}>
                        {r.priceVariancePct > 0 ? `+${r.priceVariancePct}%` : `${r.priceVariancePct}%`}
                      </td>
                      <td className="mono tiny" style={{ textAlign: 'right' }}>{r.responsivenessScore}</td>
                      <td className="mono small" style={{ textAlign: 'right', fontWeight: 700, color: tierColor(r.tier) }}>
                        {r.compositeScore}
                      </td>
                      <td className="mono tiny" style={{ fontWeight: 700, color: tierColor(r.tier) }}>
                        {tierLabel(r.tier)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm mono"
                          style={{
                            fontSize: 11,
                            color: r.onContract ? 'var(--teal-700)' : 'var(--red)',
                            borderColor: r.onContract ? 'var(--line)' : 'var(--red)',
                          }}
                          onClick={() =>
                            setSuppliers((prev) => prev.map((s) => (s.id === r.id ? { ...s, onContract: !s.onContract } : s)))
                          }
                        >
                          {r.onContract ? 'On-Contract' : 'Maverick'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {allowStudentEdit && (
              <form onSubmit={addSupplier} className="row-wrap" style={{ gap: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 160 }}
                  placeholder="Add supplier name…"
                  value={newSup.supplier}
                  onChange={(e) => setNewSup((s) => ({ ...s, supplier: e.target.value }))}
                />
                <input
                  className="input"
                  style={{ width: 145 }}
                  placeholder="Category"
                  value={newSup.category}
                  onChange={(e) => setNewSup((s) => ({ ...s, category: e.target.value }))}
                />
                <input
                  className="input mono"
                  style={{ width: 100 }}
                  type="number"
                  placeholder="Spend"
                  value={newSup.annualSpend}
                  onChange={(e) => setNewSup((s) => ({ ...s, annualSpend: e.target.value }))}
                />
                <input
                  className="input mono"
                  style={{ width: 72 }}
                  type="number"
                  placeholder="OTIF%"
                  value={newSup.otifPct}
                  onChange={(e) => setNewSup((s) => ({ ...s, otifPct: e.target.value }))}
                />
                <button type="submit" className="btn btn-sm btn-primary">
                  <Icon name="plus" size={13} /> Add Supplier
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Spend Cube Pareto, Maverick & Tail Spend */}
      {activeTab === 'spendcube' && (
        <div className="lab-split-grid">
          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="tiny muted">CATEGORY SPEND PARETO (80/20 CONCENTRATION)</div>
            <div className="stack-xs">
              {spendCube.categoryPareto.map((c) => (
                <div key={c.category} className="stack-xs" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <div className="between small">
                    <strong>{c.category}</strong>
                    <span className="mono">
                      {fmtMoney(currency, c.spend)} · <strong>{c.sharePct}%</strong> (Cum {c.cumPct}%)
                    </span>
                  </div>
                  <div style={{ height: 8, background: 'var(--track)', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, c.sharePct)}%`,
                        height: '100%',
                        background: c.cumPct <= 82 ? 'var(--teal-700)' : 'var(--amber)',
                      }}
                    />
                  </div>
                  <div className="tiny muted">{c.suppliers} active supplier(s) in category</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="tiny muted">COMPLIANCE &amp; CONSOLIDATION DIAGNOSTICS</div>
            <div className={spendCube.maverickPct > 15 ? 'notice-err small' : 'notice small'}>
              <strong>Maverick / Off-Contract Spend: {spendCube.maverickPct}%</strong> ({fmtMoney(currency, spendCube.maverickSpend)}).
              {spendCube.maverickPct > 15
                ? ' Exceeds the 15% governance ceiling — buyers are bypassing negotiated framework contracts, inflating price variance and defect risk.'
                : ' Within controlled compliance thresholds. Continue enforcing catalogue punch-out and PO approval gates.'}
            </div>
            <div className="card-soft stack-xs" style={{ padding: 12 }}>
              <div className="between small">
                <span>Top-3 Supplier Share</span>
                <strong className="mono">{spendCube.top3SharePct}%</strong>
              </div>
              <div className="between small">
                <span>Tail Spend Suppliers (Bottom 20% Spend)</span>
                <strong className="mono">{spendCube.tailSupplierCount} supplier(s)</strong>
              </div>
              <div className="between small">
                <span>Tail Spend Value</span>
                <strong className="mono">{fmtMoney(currency, spendCube.tailSpend)}</strong>
              </div>
            </div>
            <div className="small muted">
              <strong>Cross-Lab Tip:</strong> Export your P2P audit CSV from <em>The Match</em> or your requisition queue from <em>Requisition to Order</em>, then click <strong>Import Spend / Cross-Lab CSV</strong> above to watch upstream transactional records roll straight into executive Spend Analytics.
            </div>
          </div>
        </div>
      )}

      {/* Managerial Judgement */}
      <div className="card stack-xs" style={{ padding: 16 }}>
        <div className="between">
          <strong className="small">Managerial Judgement &amp; Category Management Action Plan</strong>
          <span className="tiny mono muted">{judgement.trim().length} chars {judgement.trim().length >= 30 ? '· ● Ready' : '· min 30 chars'}</span>
        </div>
        <div className="tiny muted">
          {config?.instructions || 'Defend your KPI weights, identify which At-Risk/Watchlist suppliers require corrective action or re-tendering, and propose a concrete plan to eliminate Maverick and Tail Spend.'}
        </div>
        <textarea
          className="input"
          rows={4}
          placeholder="Write your supplier scorecard and category spend strategy here…"
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
        />
      </div>
    </div>
  );
}
