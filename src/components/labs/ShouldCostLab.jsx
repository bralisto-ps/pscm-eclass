import { useEffect, useMemo, useState } from 'react';
import { getLabPreset } from '../../lib/labsCatalog.js';
import { analyzeShouldCostModel } from '../../lib/labNegotiationEngine.js';

export default function ShouldCostLab({
  config,
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const baseDataset = useMemo(
    () => config?.customDataset || getLabPreset('neg_should_cost', config?.presetId) || {},
    [config?.customDataset, config?.presetId],
  );
  const currency = baseDataset.currency || 'USD';

  const [costLines, setCostLines] = useState(() =>
    Array.isArray(draftState?.costLines) && draftState.costLines.length
      ? draftState.costLines
      : (baseDataset.costLines || []),
  );
  const [supplierProfitMarginQuotedPct, setSupplierProfitMarginQuotedPct] = useState(() =>
    Number(draftState?.supplierProfitMarginQuotedPct ?? baseDataset.supplierProfitMarginQuotedPct ?? 24),
  );
  const [targetProfitMarginPct, setTargetProfitMarginPct] = useState(() =>
    Number(draftState?.targetProfitMarginPct ?? baseDataset.targetProfitMarginPct ?? 11),
  );
  const [commodityIndexShiftPct, setCommodityIndexShiftPct] = useState(() => Number(draftState?.commodityIndexShiftPct ?? 0));
  const [volumeMultiplier, setVolumeMultiplier] = useState(() => Number(draftState?.volumeMultiplier ?? 1));
  const [annualVolume, setAnnualVolume] = useState(() => Number(draftState?.annualVolume ?? baseDataset.annualVolume ?? 4000));
  const [judgement, setJudgement] = useState(() => String(draftState?.judgement || ''));

  useEffect(() => {
    onDraftChange?.({
      costLines,
      supplierProfitMarginQuotedPct,
      targetProfitMarginPct,
      commodityIndexShiftPct,
      volumeMultiplier,
      annualVolume,
      judgement,
    });
  }, [costLines, supplierProfitMarginQuotedPct, targetProfitMarginPct, commodityIndexShiftPct, volumeMultiplier, annualVolume, judgement]);

  const model = useMemo(
    () =>
      analyzeShouldCostModel({
        costLines,
        supplierProfitMarginQuotedPct,
        targetProfitMarginPct,
        commodityIndexShiftPct,
        volumeMultiplier,
        annualVolume,
      }),
    [costLines, supplierProfitMarginQuotedPct, targetProfitMarginPct, commodityIndexShiftPct, volumeMultiplier, annualVolume],
  );

  function updateLine(idx, field, val) {
    setCostLines((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: Number(val) || 0 } : r)));
  }

  const wordCount = judgement.trim() ? judgement.trim().split(/\s+/).length : 0;
  const quantChecks = [
    model.lines.length >= 4,
    model.shouldCostTotal > 0,
    model.targetPrice > 0 && model.recommendedAnchor < model.targetPrice,
    model.paddedLines.length >= 1 || model.overchargePerUnit > 0,
  ];
  const quantPassed = quantChecks.filter(Boolean).length;

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const lines = [
        'LABORATORY: NEG-LAB 03 — Should-Cost Modeling & Open-Book Price Analysis',
        `Scenario: ${baseDataset.name || 'Open-Book Cost Breakdown'} (${currency}, Annual Volume ${annualVolume})`,
        `Auto-Verification Score: ${Math.round((quantPassed / quantChecks.length) * 100)}% (${quantPassed}/${quantChecks.length} checks) | Judgement: ${wordCount >= 40 ? 'PASS' : 'REVIEW'} (${wordCount} words)`,
        '',
        'KEY VERIFIED SHOULD-COST METRICS',
        `- Supplier Quoted Price: ${currency} ${model.supplierTotalQuote.toLocaleString()} / unit (Margin ${supplierProfitMarginQuotedPct}%)`,
        `- Verified Should-Cost Target: ${currency} ${model.shouldCostTotal.toLocaleString()} / unit (Fair Margin ${targetProfitMarginPct}%)`,
        `- Identified Overcharge: ${currency} ${model.overchargePerUnit.toLocaleString()} / unit (+${model.overchargePct}%)`,
        `- Annualized Negotiation Savings Potential: ${currency} ${model.annualizedSavings.toLocaleString()}`,
        `- Recommended Anchor / Target / Reservation: ${currency} ${model.recommendedAnchor} / ${currency} ${model.targetPrice} / ${currency} ${model.reservationPrice}`,
        `- Commodity Index Shift: ${commodityIndexShiftPct}% | Volume Multiplier: ${volumeMultiplier}x`,
        '',
        'COST LINE AUDIT (SUPPLIER QUOTE VS. SHOULD-COST)',
        ...model.lines.map(
          (l) => `• ${l.name}: Quoted ${currency} ${l.quotedCost} vs. Should ${currency} ${l.shouldCost} (Variance ${l.variance >= 0 ? '+' : ''}${l.variance}, ${l.variancePct}%)${l.padded ? ' [PADDED]' : ''}`,
        ),
        '',
        'MANAGERIAL JUDGEMENT & NEGOTIATION PREPARATION BRIEF',
        judgement.trim() || '(No written managerial judgement provided.)',
      ];
      return {
        title: 'NEG-LAB 03 — Should-Cost & Open-Book Negotiation Report',
        body: lines.join('\n'),
        hasJudgement: wordCount >= 30,
      };
    });
  }, [baseDataset.name, currency, annualVolume, model, supplierProfitMarginQuotedPct, targetProfitMarginPct, commodityIndexShiftPct, volumeMultiplier, judgement, wordCount, quantPassed]);

  const chartItems = [
    ...model.lines.map((l) => ({ name: l.name.slice(0, 14), quoted: l.quotedCost, should: l.shouldCost })),
    { name: 'Profit Margin', quoted: model.quotedMarginAmt, should: model.shouldMarginAmt },
  ];
  const maxBar = Math.max(10, ...chartItems.flatMap((c) => [c.quoted, c.should]));

  return (
    <div className="stack">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Supplier Quoted Price</div>
          <div className="kpi mono" style={{ fontSize: 20, marginTop: 4 }}>{currency} {model.supplierTotalQuote.toLocaleString()}</div>
          <div className="tiny muted">Includes {supplierProfitMarginQuotedPct}% margin</div>
        </div>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Verified Should-Cost</div>
          <div className="kpi mono" style={{ fontSize: 20, marginTop: 4, color: 'var(--teal-700)' }}>{currency} {model.shouldCostTotal.toLocaleString()}</div>
          <div className="tiny muted">Target margin {targetProfitMarginPct}%</div>
        </div>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Exposed Overcharge</div>
          <div className="kpi mono" style={{ fontSize: 20, marginTop: 4, color: model.overchargePerUnit > 0 ? 'var(--red)' : 'var(--teal-700)' }}>
            {currency} {model.overchargePerUnit.toLocaleString()} ({model.overchargePct}%)
          </div>
          <div className="tiny muted">Annual savings: {currency} {model.annualizedSavings.toLocaleString()}</div>
        </div>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Anchor / Target / Max</div>
          <div className="kpi mono" style={{ fontSize: 16, marginTop: 6, color: '#6d28d9' }}>
            {model.recommendedAnchor} / {model.targetPrice} / {model.reservationPrice}
          </div>
          <div className="tiny muted">{model.paddedLines.length} padded cost line(s) flagged</div>
        </div>
      </div>

      {/* Live Grouped Bar Chart SVG */}
      <section className="card stack-xs">
        <h3 style={{ margin: 0, fontSize: 15 }}>Supplier Quote vs. Benchmark Should-Cost Breakdown</h3>
        <svg viewBox="0 0 660 220" style={{ width: '100%', height: 'auto', display: 'block' }}>
          <line x1="48" x2="635" y1="180" y2="180" stroke="#94a3b8" strokeWidth="1.4" />
          {chartItems.map((item, i) => {
            const slotW = 580 / Math.max(1, chartItems.length);
            const x0 = 56 + i * slotW;
            const barW = Math.min(26, slotW * 0.34);
            const hQ = (item.quoted / maxBar) * 145;
            const hS = (item.should / maxBar) * 145;
            return (
              <g key={i}>
                <rect x={x0} y={180 - hQ} width={barW} height={hQ} fill="#dc2626" fillOpacity="0.8" rx="3" />
                <rect x={x0 + barW + 4} y={180 - hS} width={barW} height={hS} fill="#0f766e" fillOpacity="0.85" rx="3" />
                <text x={x0 + barW} y="198" textAnchor="middle" fontSize="9.5" fill="#475569" fontFamily="monospace">{item.name}</text>
              </g>
            );
          })}
          <rect x="460" y="10" width="10" height="10" fill="#dc2626" rx="2" />
          <text x="475" y="19" fontSize="10" fill="#334155">Supplier Quote</text>
          <rect x="560" y="10" width="10" height="10" fill="#0f766e" rx="2" />
          <text x="575" y="19" fontSize="10" fill="#334155">Should-Cost</text>
        </svg>
      </section>

      {/* Sensitivity & Open-Book Line Table */}
      <section className="card stack-sm">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 10 }}>
          <label className="stack-xs tiny">
            <span>Commodity Index Shift: <strong>{commodityIndexShiftPct >= 0 ? '+' : ''}{commodityIndexShiftPct}%</strong></span>
            <input type="range" min="-20" max="30" value={commodityIndexShiftPct} onChange={(e) => setCommodityIndexShiftPct(Number(e.target.value))} />
          </label>
          <label className="stack-xs tiny">
            <span>Volume Multiplier (Learning Curve): <strong>{volumeMultiplier}×</strong></span>
            <input type="range" min="1" max="4" step="0.5" value={volumeMultiplier} onChange={(e) => setVolumeMultiplier(Number(e.target.value))} />
          </label>
          <label className="stack-xs tiny">
            <span>Supplier Margin Quoted (%)</span>
            <input className="input" type="number" value={supplierProfitMarginQuotedPct} onChange={(e) => setSupplierProfitMarginQuotedPct(Number(e.target.value))} />
          </label>
          <label className="stack-xs tiny">
            <span>Fair Target Margin (%)</span>
            <input className="input" type="number" value={targetProfitMarginPct} onChange={(e) => setTargetProfitMarginPct(Number(e.target.value))} />
          </label>
          <label className="stack-xs tiny">
            <span>Annual Contract Volume</span>
            <input className="input" type="number" value={annualVolume} onChange={(e) => setAnnualVolume(Math.max(1, Number(e.target.value)))} />
          </label>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5 }}>
            <thead>
              <tr>
                <th>Cost Component</th>
                <th>Supplier Quote ({currency})</th>
                <th>Market Benchmark ({currency})</th>
                <th>Adjusted Should-Cost</th>
                <th>Variance</th>
                <th>Audit Flag</th>
              </tr>
            </thead>
            <tbody>
              {model.lines.map((line, idx) => (
                <tr key={idx}>
                  <td><strong>{line.name}</strong></td>
                  <td>
                    <input
                      className="input mono"
                      style={{ width: 92, padding: '4px 6px' }}
                      type="number"
                      value={line.quotedCost}
                      onChange={(e) => updateLine(idx, 'quotedCost', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="input mono"
                      style={{ width: 92, padding: '4px 6px' }}
                      type="number"
                      value={costLines[idx]?.benchmarkCost ?? 0}
                      onChange={(e) => updateLine(idx, 'benchmarkCost', e.target.value)}
                    />
                  </td>
                  <td className="mono">{currency} {line.shouldCost}</td>
                  <td className="mono" style={{ color: line.variance > 0 ? 'var(--red)' : 'var(--teal-700)', fontWeight: 700 }}>
                    {line.variance >= 0 ? '+' : ''}{line.variance} ({line.variancePct}%)
                  </td>
                  <td className="tiny mono" style={{ color: line.padded ? 'var(--red)' : 'var(--teal-700)', fontWeight: 700 }}>
                    {line.padded ? '▲ PADDED' : '● FAIR'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack-xs">
        <div className="between">
          <h3 style={{ margin: 0, fontSize: 15 }}>Managerial Judgement &amp; Evidence-Based Opening Script</h3>
          <span className="tiny mono muted">{wordCount} words {wordCount >= 40 ? '● READY' : '(target ≥ 40 words)'}</span>
        </div>
        <textarea
          className="textarea"
          rows={4}
          placeholder="Challenge the specific padded cost drivers using your benchmark evidence, justify your opening anchor and reservation price, and explain how raw-material indexing or volume commitments can close the price gap…"
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
        />
      </section>
    </div>
  );
}
