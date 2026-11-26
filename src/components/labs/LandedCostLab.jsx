import { useEffect, useMemo, useState } from 'react';
import { getLabPreset } from '../../lib/labsCatalog.js';
import {
  INCOTERM_DEFS,
  compareLandedCostRoutes,
} from '../../lib/labMilestone8Engine.js';

export default function LandedCostLab({
  config,
  dataMode = 'both',
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const baseDataset = useMemo(
    () => config?.customDataset || getLabPreset('scm_landed_cost', config?.presetId) || {},
    [config?.customDataset, config?.presetId],
  );
  const currency = baseDataset.currency || 'USD';

  const [routes, setRoutes] = useState(() =>
    Array.isArray(draftState?.routes) && draftState.routes.length
      ? draftState.routes
      : (baseDataset.routes || []),
  );
  const [holdingPct, setHoldingPct] = useState(() => Number(draftState?.holdingPct ?? 18));
  const [judgement, setJudgement] = useState(() => String(draftState?.judgement || ''));

  useEffect(() => {
    onDraftChange?.({ routes, holdingPct, judgement });
  }, [routes, holdingPct, judgement]);

  const enrichedRoutes = useMemo(
    () => routes.map((r) => ({ ...r, annualHoldingPct: holdingPct })),
    [routes, holdingPct],
  );
  const comparison = useMemo(() => compareLandedCostRoutes(enrichedRoutes), [enrichedRoutes]);

  const wordCount = judgement.trim() ? judgement.trim().split(/\s+/).length : 0;
  const quantChecks = [
    comparison.routes.length >= 2,
    comparison.lowestLanded !== null,
    comparison.routes.some((r) => r.importDuty > 0 || r.mainFreight > 0),
    holdingPct > 0,
  ];
  const quantPassed = quantChecks.filter(Boolean).length;

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const winner = comparison.lowestEconomic || comparison.lowestLanded;
      const lines = [
        'LABORATORY: SCM-LAB 01 — Global Logistics, Incoterms & Landed Cost Analysis',
        `Dataset: ${baseDataset.name || 'Custom Landed Cost Routes'} (${currency})`,
        `Auto-Verification Score: ${Math.round((quantPassed / quantChecks.length) * 100)}% (${quantPassed}/${quantChecks.length} checks) | Judgement: ${wordCount >= 40 ? 'PASS' : 'REVIEW'} (${wordCount} words)`,
        '',
        'KEY VERIFIED METRICS',
        `- Lowest Landed Route: ${comparison.lowestLanded?.name || '—'} (${currency} ${comparison.lowestLanded?.totalLandedCost?.toLocaleString() || 0})`,
        `- Lowest Economic Cost (incl. Pipeline Holding): ${winner?.name || '—'} (${currency} ${winner?.totalEconomicCost?.toLocaleString() || 0})`,
        `- FOB Price Trap Detected: ${comparison.fobTrapDetected ? 'YES (Lowest FOB is NOT lowest Landed Cost!)' : 'NO'}`,
        `- Pipeline Capital Cost Rate: ${holdingPct}% p.a.`,
        '',
        'ROUTE-BY-ROUTE INCOTERMS & LANDED COST WATERFALL',
        ...comparison.routes.map((r) =>
          `• ${r.name} [${r.mode} | ${r.incoterm}]: EXW ${r.exwTotal.toLocaleString()} → FOB ${r.fobValue.toLocaleString()} → CIF ${r.cifValue.toLocaleString()} → Duty+VAT ${(r.importDuty + r.importVat).toLocaleString()} → Landed ${r.totalLandedCost.toLocaleString()} (${r.landedPerUnit}/unit, +${r.upliftPct}% uplift) | Transit ${r.transitDays}d Holding ${r.pipelineHoldingCost.toLocaleString()}`,
        ),
        '',
        'WRITTEN MANAGERIAL JUDGEMENT',
        judgement.trim() || '(No judgement entered)',
      ];
      return {
        title: config?.title || 'Global Logistics, Incoterms & Landed Cost Lab Report',
        body: lines.join('\n'),
        hasJudgement: wordCount >= 20,
      };
    });
  }, [comparison, holdingPct, judgement, wordCount, currency, baseDataset.name, config?.title, onRegisterReportBuilder]);

  function updateRoute(idx, field, val) {
    setRoutes((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
  }

  function addRoute() {
    setRoutes((prev) => [
      ...prev,
      {
        id: `route_${Date.now()}`,
        name: `Alternative Route ${prev.length + 1}`,
        mode: 'Ocean',
        incoterm: 'CIF',
        qty: 500,
        unitExw: 42,
        originInland: 450,
        exportClearance: 250,
        mainFreight: 2800,
        insuranceRatePct: 0.6,
        dutyRatePct: 10,
        vatRatePct: 15,
        destPort: 950,
        destInland: 550,
        transitDays: 28,
      },
    ]);
  }

  const maxEconomic = Math.max(1, ...comparison.routes.map((r) => r.totalEconomicCost));

  return (
    <div className="stack">
      <div className="card-soft between" style={{ padding: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="tiny mono" style={{ color: 'var(--teal-700)', fontWeight: 700 }}>
            SCM-LAB 01 · INCOTERMS 2020 &amp; TOTAL LANDED COST ENGINE
          </div>
          <strong className="small">{baseDataset.name || 'Import Sourcing & Landed Cost Comparison'}</strong>
        </div>
        <div className="row-wrap" style={{ gap: 10, alignItems: 'center' }}>
          <label className="row tiny muted" style={{ gap: 6 }}>
            Pipeline Capital Rate (% p.a.)
            <input
              type="range"
              min="5"
              max="35"
              value={holdingPct}
              onChange={(e) => setHoldingPct(Number(e.target.value))}
            />
            <strong className="mono">{holdingPct}%</strong>
          </label>
          {dataMode !== 'lecturer_only' && (
            <button type="button" className="btn btn-sm" onClick={addRoute}>+ Add Route</button>
          )}
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: 10 }}>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">Lowest Landed Cost Route</div>
          <strong className="small">{comparison.lowestLanded?.name || '—'}</strong>
          <div className="mono" style={{ color: 'var(--teal-700)', fontWeight: 700 }}>
            {currency} {comparison.lowestLanded?.totalLandedCost?.toLocaleString() || 0} ({comparison.lowestLanded?.landedPerUnit}/unit)
          </div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">Best Economic Total (incl. Transit Capital)</div>
          <strong className="small">{comparison.lowestEconomic?.name || '—'}</strong>
          <div className="mono" style={{ color: '#1d4ed8', fontWeight: 700 }}>
            {currency} {comparison.lowestEconomic?.totalEconomicCost?.toLocaleString() || 0}
          </div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">FOB Price Trap Diagnostic</div>
          <strong className="mono small" style={{ color: comparison.fobTrapDetected ? 'var(--red)' : 'var(--teal-700)' }}>
            {comparison.fobTrapDetected ? '▲ FOB TRAP DETECTED' : '● ALIGNED WITH FOB'}
          </strong>
          <div className="tiny muted">
            {comparison.fobTrapDetected
              ? `Cheapest FOB (${comparison.lowestFob?.name}) loses on true Landed Cost!`
              : 'Lowest FOB route also delivers lowest Landed Cost.'}
          </div>
        </div>
      </div>

      {/* Visual Cost Waterfall Comparison */}
      <div className="card stack-xs" style={{ padding: 14 }}>
        <strong className="small">Total Landed &amp; Economic Cost Comparison ({currency})</strong>
        {comparison.routes.map((r) => {
          const fobW = (r.fobValue / maxEconomic) * 100;
          const freightW = ((r.mainFreight + r.insurance) / maxEconomic) * 100;
          const taxW = ((r.importDuty + r.importVat) / maxEconomic) * 100;
          const destW = ((r.destPort + r.destInland + r.pipelineHoldingCost) / maxEconomic) * 100;
          return (
            <div key={r.id} className="stack-xs" style={{ padding: '6px 0' }}>
              <div className="between tiny">
                <span>
                  <strong>{r.name}</strong> ({r.mode} · <span className="mono">{r.incoterm}</span> · {r.transitDays}d transit)
                </span>
                <span className="mono">
                  Landed: <strong>{currency} {r.totalLandedCost.toLocaleString()}</strong> (+{r.upliftPct}% over EXW) · Risk: {r.riskPoint}
                </span>
              </div>
              <div style={{ display: 'flex', height: 14, borderRadius: 6, overflow: 'hidden', background: 'var(--surface-2)' }}>
                <div style={{ width: `${fobW}%`, background: '#0f766e' }} title={`FOB: ${r.fobValue}`} />
                <div style={{ width: `${freightW}%`, background: '#2563eb' }} title={`Freight & Ins: ${r.mainFreight + r.insurance}`} />
                <div style={{ width: `${taxW}%`, background: '#d97706' }} title={`Duty & VAT: ${r.importDuty + r.importVat}`} />
                <div style={{ width: `${destW}%`, background: '#7c3aed' }} title={`Dest & Pipeline: ${r.destPort + r.destInland + r.pipelineHoldingCost}`} />
              </div>
            </div>
          );
        })}
        <div className="row-wrap tiny muted" style={{ gap: 14, marginTop: 4 }}>
          <span><span style={{ color: '#0f766e' }}>■</span> FOB Goods &amp; Export</span>
          <span><span style={{ color: '#2563eb' }}>■</span> Freight &amp; Insurance</span>
          <span><span style={{ color: '#d97706' }}>■</span> Import Duty &amp; VAT</span>
          <span><span style={{ color: '#7c3aed' }}>■</span> Port Clearance, Inland &amp; Transit Holding</span>
        </div>
      </div>

      {/* Editable Route Parameters Table */}
      <div className="card stack-xs" style={{ padding: 14, overflowX: 'auto' }}>
        <strong className="small">Interactive Incoterms &amp; Customs Cost Parameters</strong>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
              <th style={{ padding: 6 }}>Route / Origin</th>
              <th style={{ padding: 6 }}>Incoterm</th>
              <th style={{ padding: 6 }}>Qty</th>
              <th style={{ padding: 6 }}>Unit EXW</th>
              <th style={{ padding: 6 }}>Main Freight</th>
              <th style={{ padding: 6 }}>Duty %</th>
              <th style={{ padding: 6 }}>VAT %</th>
              <th style={{ padding: 6 }}>Dest Port/Inland</th>
              <th style={{ padding: 6 }}>Transit (d)</th>
              <th style={{ padding: 6 }}>Landed / Unit</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r, idx) => {
              const c = comparison.routes[idx];
              const locked = dataMode === 'lecturer_only';
              return (
                <tr key={r.id || idx} style={{ borderBottom: '1px solid var(--line-2)' }}>
                  <td style={{ padding: 5 }}>
                    <input className="input" style={{ minHeight: 30, minWidth: 145 }} disabled={locked} value={r.name} onChange={(e) => updateRoute(idx, 'name', e.target.value)} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <select className="input" style={{ minHeight: 30 }} value={r.incoterm} onChange={(e) => updateRoute(idx, 'incoterm', e.target.value)}>
                      {Object.keys(INCOTERM_DEFS).map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" style={{ minHeight: 30, width: 70 }} disabled={locked} value={r.qty} onChange={(e) => updateRoute(idx, 'qty', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" style={{ minHeight: 30, width: 74 }} disabled={locked} value={r.unitExw} onChange={(e) => updateRoute(idx, 'unitExw', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" style={{ minHeight: 30, width: 84 }} value={r.mainFreight} onChange={(e) => updateRoute(idx, 'mainFreight', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" style={{ minHeight: 30, width: 62 }} value={r.dutyRatePct} onChange={(e) => updateRoute(idx, 'dutyRatePct', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" style={{ minHeight: 30, width: 62 }} value={r.vatRatePct} onChange={(e) => updateRoute(idx, 'vatRatePct', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" style={{ minHeight: 30, width: 84 }} value={(Number(r.destPort) || 0) + (Number(r.destInland) || 0)} onChange={(e) => { updateRoute(idx, 'destPort', Number(e.target.value)); updateRoute(idx, 'destInland', 0); }} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" style={{ minHeight: 30, width: 60 }} value={r.transitDays} onChange={(e) => updateRoute(idx, 'transitDays', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }} className="mono strong">
                    {currency} {c?.landedPerUnit}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Written Managerial Judgement */}
      <div className="card stack-xs" style={{ padding: 14 }}>
        <div className="between">
          <strong className="small">Written Managerial Judgement &amp; Incoterms Recommendation</strong>
          <span className="tiny mono" style={{ color: wordCount >= 40 ? 'var(--teal-700)' : 'var(--amber)' }}>
            {wordCount} words {wordCount >= 40 ? '● Ready' : '(aim for 40+ words)'}
          </span>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>
          {config?.instructions || 'Defend your optimal route and Incoterm choice using exact landed cost uplift, customs valuation (CIF), risk transfer point, and transit-time working capital impact.'}
        </p>
        <textarea
          className="input"
          rows={4}
          placeholder="Explain why the lowest FOB/EXW quote may not yield the lowest total landed cost, distinguish risk vs. cost transfer under your chosen Incoterm, and defend your final sourcing recommendation…"
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
        />
      </div>
    </div>
  );
}
