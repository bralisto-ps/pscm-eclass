import { useEffect, useMemo, useState } from 'react';
import { getLabPreset } from '../../lib/labsCatalog.js';
import {
  MODE_EMISSION_FACTORS,
  evaluateGreenProcurement,
} from '../../lib/labMilestone8Engine.js';

export default function GreenProcurementLab({
  config,
  dataMode = 'both',
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const baseDataset = useMemo(
    () => config?.customDataset || getLabPreset('scm_green_procurement', config?.presetId) || {},
    [config?.customDataset, config?.presetId],
  );
  const currency = baseDataset.currency || 'USD';

  const [suppliers, setSuppliers] = useState(() =>
    Array.isArray(draftState?.suppliers) && draftState.suppliers.length
      ? draftState.suppliers
      : (baseDataset.suppliers || []),
  );
  const [shadowCarbonPrice, setShadowCarbonPrice] = useState(() => Number(draftState?.shadowCarbonPrice ?? baseDataset.shadowCarbonPrice ?? 85));
  const [annualTonnes, setAnnualTonnes] = useState(() => Number(draftState?.annualTonnes ?? baseDataset.annualTonnes ?? 120));
  const [carbonBudgetTonnes, setCarbonBudgetTonnes] = useState(() => Number(draftState?.carbonBudgetTonnes ?? baseDataset.carbonBudgetTonnes ?? 90));
  const [judgement, setJudgement] = useState(() => String(draftState?.judgement || ''));

  useEffect(() => {
    onDraftChange?.({ suppliers, shadowCarbonPrice, annualTonnes, carbonBudgetTonnes, judgement });
  }, [suppliers, shadowCarbonPrice, annualTonnes, carbonBudgetTonnes, judgement]);

  const evalRes = useMemo(
    () => evaluateGreenProcurement(suppliers, { shadowCarbonPrice, annualTonnes, carbonBudgetTonnes }),
    [suppliers, shadowCarbonPrice, annualTonnes, carbonBudgetTonnes],
  );

  const wordCount = judgement.trim() ? judgement.trim().split(/\s+/).length : 0;
  const quantChecks = [
    evalRes.suppliers.length >= 2,
    evalRes.bestEsgComposite !== null,
    shadowCarbonPrice >= 0,
    carbonBudgetTonnes > 0,
  ];
  const quantPassed = quantChecks.filter(Boolean).length;

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const lines = [
        'LABORATORY: SCM-LAB 03 — Sustainable Procurement & Carbon Footprint Trade-Offs',
        `Dataset: ${baseDataset.name || 'Sustainable Sourcing Evaluation'} (${annualTonnes} tonnes/yr | Shadow Carbon Price: ${currency} ${shadowCarbonPrice}/tCO2e | Budget Cap: ${carbonBudgetTonnes} tCO2e)`,
        `Auto-Verification Score: ${Math.round((quantPassed / quantChecks.length) * 100)}% (${quantPassed}/${quantChecks.length} checks) | Judgement: ${wordCount >= 40 ? 'PASS' : 'REVIEW'} (${wordCount} words)`,
        '',
        'KEY VERIFIED METRICS',
        `- Cheapest Direct Price: ${evalRes.cheapestDirect?.name || '—'} (${currency} ${evalRes.cheapestDirect?.directAnnualSpend?.toLocaleString() || 0}, ${evalRes.cheapestDirect?.totalCo2Tonnes || 0} tCO2e)`,
        `- Best Carbon-Adjusted Cost: ${evalRes.bestCarbonAdjusted?.name || '—'} (${currency} ${evalRes.bestCarbonAdjusted?.carbonAdjustedCost?.toLocaleString() || 0})`,
        `- Top ESG Composite Supplier: ${evalRes.bestEsgComposite?.name || '—'} (Score ${evalRes.bestEsgComposite?.esgComposite || 0}/100)`,
        `- Shadow Carbon Price Flips Winner: ${evalRes.carbonPriceFlipsWinner ? 'YES' : 'NO'}`,
        '',
        'SUPPLIER CARBON & ESG EVALUATION TABLE',
        ...evalRes.suppliers.map((s) =>
          `• ${s.name} (${s.origin} · ${s.mode} ${s.distanceKm}km): Direct ${currency} ${s.directAnnualSpend.toLocaleString()} | Scope1/2 ${s.scope12Tonnes}t + Scope3 ${s.scope3TransportTonnes}t = ${s.totalCo2Tonnes} tCO2e (${s.withinBudget ? 'WITHIN CAP' : 'OVER CAP'}) | Carbon-Adj ${currency} ${s.carbonAdjustedCost.toLocaleString()} | ESG ${s.esgComposite}/100`,
        ),
        '',
        'WRITTEN MANAGERIAL JUDGEMENT',
        judgement.trim() || '(No judgement entered)',
      ];
      return {
        title: config?.title || 'Sustainable Procurement & Carbon Footprint Trade-Offs Report',
        body: lines.join('\n'),
        hasJudgement: wordCount >= 20,
      };
    });
  }, [evalRes, shadowCarbonPrice, annualTonnes, carbonBudgetTonnes, judgement, wordCount, currency, baseDataset.name, config?.title, onRegisterReportBuilder]);

  function updateSupplier(id, field, val) {
    setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: val } : s)));
  }

  const maxCo2 = Math.max(carbonBudgetTonnes, ...evalRes.suppliers.map((s) => s.totalCo2Tonnes), 1);

  return (
    <div className="stack">
      <div className="card-soft stack-xs" style={{ padding: 14 }}>
        <div className="tiny mono" style={{ color: '#0f766e', fontWeight: 700 }}>
          SCM-LAB 03 · SCOPE 1/2/3 CARBON PRICING &amp; SUSTAINABLE SOURCING ENGINE
        </div>
        <strong className="small">{baseDataset.name || 'Green Sourcing Carbon vs. Cost Trade-Off'}</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginTop: 6 }}>
          <label className="stack-xs tiny muted">
            Shadow Carbon Price ({currency} / tonne CO₂e): <strong className="mono">{shadowCarbonPrice}</strong>
            <input type="range" min="0" max="350" step="5" value={shadowCarbonPrice} onChange={(e) => setShadowCarbonPrice(Number(e.target.value))} />
          </label>
          <label className="stack-xs tiny muted">
            Corporate Carbon Cap (tCO₂e / yr): <strong className="mono">{carbonBudgetTonnes} t</strong>
            <input type="range" min="20" max="300" step="5" value={carbonBudgetTonnes} onChange={(e) => setCarbonBudgetTonnes(Number(e.target.value))} />
          </label>
          <label className="stack-xs tiny muted">
            Annual Purchase Volume (Tonnes)
            <input className="input mono" type="number" min="10" value={annualTonnes} onChange={(e) => setAnnualTonnes(Math.max(1, Number(e.target.value)))} />
          </label>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">Cheapest Direct Cost</div>
          <strong className="small">{evalRes.cheapestDirect?.name || '—'}</strong>
          <div className="mono tiny muted">
            {currency} {evalRes.cheapestDirect?.directAnnualSpend?.toLocaleString() || 0} · {evalRes.cheapestDirect?.totalCo2Tonnes || 0} tCO₂e
          </div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">Winner After Carbon Pricing</div>
          <strong className="small" style={{ color: 'var(--teal-700)' }}>{evalRes.bestCarbonAdjusted?.name || '—'}</strong>
          <div className="mono tiny">
            {currency} {evalRes.bestCarbonAdjusted?.carbonAdjustedCost?.toLocaleString() || 0}
          </div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">Carbon Price Impact</div>
          <strong className="mono small" style={{ color: evalRes.carbonPriceFlipsWinner ? 'var(--teal-700)' : 'var(--amber)' }}>
            {evalRes.carbonPriceFlipsWinner ? '● FLIPS SOURCING WINNER' : '○ NO RANKING FLIP YET'}
          </strong>
          <div className="tiny muted">Adjust shadow carbon price slider to find tipping point</div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">Top ESG Composite Winner</div>
          <strong className="small">{evalRes.bestEsgComposite?.name || '—'}</strong>
          <div className="mono tiny" style={{ color: '#0f766e', fontWeight: 700 }}>
            {evalRes.bestEsgComposite?.esgComposite || 0} / 100
          </div>
        </div>
      </div>

      {/* Visual Carbon Footprint Bar Chart vs Cap */}
      <div className="card stack-xs" style={{ padding: 14 }}>
        <strong className="small">Annual Carbon Footprint (Scope 1/2 Manufacturing vs. Scope 3 Freight) vs. {carbonBudgetTonnes} tCO₂e Cap</strong>
        {evalRes.suppliers.map((s) => {
          const s12W = (s.scope12Tonnes / maxCo2) * 100;
          const s3W = (s.scope3TransportTonnes / maxCo2) * 100;
          const capX = (carbonBudgetTonnes / maxCo2) * 100;
          return (
            <div key={s.id} className="stack-xs" style={{ padding: '4px 0' }}>
              <div className="between tiny">
                <span>
                  <strong>{s.name}</strong> ({s.mode} · {s.distanceKm.toLocaleString()} km)
                </span>
                <span className="mono" style={{ color: s.withinBudget ? 'var(--teal-700)' : 'var(--red)', fontWeight: 700 }}>
                  {s.totalCo2Tonnes} tCO₂e {s.withinBudget ? '● WITHIN CAP' : '▲ OVER CAP'}
                  {s.abatementCostPerTonne !== null ? ` · Abatement: ${currency} ${s.abatementCostPerTonne}/t` : ''}
                </span>
              </div>
              <div style={{ position: 'relative', display: 'flex', height: 14, borderRadius: 6, overflow: 'hidden', background: 'var(--surface-2)' }}>
                <div style={{ width: `${s12W}%`, background: '#0f766e' }} title={`Scope 1/2 Mfg: ${s.scope12Tonnes}t`} />
                <div style={{ width: `${s3W}%`, background: '#dc2626' }} title={`Scope 3 Freight: ${s.scope3TransportTonnes}t`} />
                <div style={{ position: 'absolute', left: `${Math.min(99, capX)}%`, top: 0, bottom: 0, width: 2, background: '#0f172a' }} title={`Cap: ${carbonBudgetTonnes}t`} />
              </div>
            </div>
          );
        })}
        <div className="row-wrap tiny muted" style={{ gap: 14 }}>
          <span><span style={{ color: '#0f766e' }}>■</span> Scope 1 &amp; 2 Manufacturing</span>
          <span><span style={{ color: '#dc2626' }}>■</span> Scope 3 Inbound Freight</span>
          <span><strong>|</strong> Corporate Carbon Budget Cap ({carbonBudgetTonnes} tCO₂e)</span>
        </div>
      </div>

      {/* Interactive Supplier Table */}
      <div className="card stack-xs" style={{ padding: 14, overflowX: 'auto' }}>
        <strong className="small">Supplier Pricing, Freight Mode &amp; ESG Attributes</strong>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
              <th style={{ padding: 6 }}>Supplier</th>
              <th style={{ padding: 6 }}>Freight Mode</th>
              <th style={{ padding: 6 }}>Distance (km)</th>
              <th style={{ padding: 6 }}>Price / Tonne</th>
              <th style={{ padding: 6 }}>Mfg kgCO₂/t</th>
              <th style={{ padding: 6 }}>Recyclable %</th>
              <th style={{ padding: 6 }}>Carbon-Adj Cost</th>
              <th style={{ padding: 6 }}>ESG Score</th>
            </tr>
          </thead>
          <tbody>
            {evalRes.suppliers.map((s) => {
              const locked = dataMode === 'lecturer_only';
              return (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                  <td style={{ padding: 5 }} className="strong">{s.name}</td>
                  <td style={{ padding: 5 }}>
                    <select className="input" style={{ minHeight: 30 }} value={s.mode} onChange={(e) => updateSupplier(s.id, 'mode', e.target.value)}>
                      {Object.keys(MODE_EMISSION_FACTORS).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" style={{ minHeight: 30, width: 78 }} disabled={locked} value={s.distanceKm} onChange={(e) => updateSupplier(s.id, 'distanceKm', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" style={{ minHeight: 30, width: 80 }} disabled={locked} value={s.unitPricePerTonne} onChange={(e) => updateSupplier(s.id, 'unitPricePerTonne', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" style={{ minHeight: 30, width: 74 }} value={s.mfgKgCo2PerTonne ?? Math.round((s.scope12Tonnes * 1000) / annualTonnes)} onChange={(e) => updateSupplier(s.id, 'mfgKgCo2PerTonne', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" min="0" max="100" style={{ minHeight: 30, width: 64 }} value={s.recyclablePct} onChange={(e) => updateSupplier(s.id, 'recyclablePct', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }} className="mono strong">{currency} {s.carbonAdjustedCost.toLocaleString()}</td>
                  <td style={{ padding: 5 }} className="mono strong">{s.esgComposite}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card stack-xs" style={{ padding: 14 }}>
        <div className="between">
          <strong className="small">Written Managerial Judgement &amp; Net-Zero Sourcing Recommendation</strong>
          <span className="tiny mono" style={{ color: wordCount >= 40 ? 'var(--teal-700)' : 'var(--amber)' }}>
            {wordCount} words {wordCount >= 40 ? '● Ready' : '(aim for 40+ words)'}
          </span>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>
          {config?.instructions || 'Defend your sustainable sourcing award by weighing direct budget cost, Scope 3 freight emissions, carbon abatement cost per tonne, and corporate net-zero compliance.'}
        </p>
        <textarea
          className="input"
          rows={4}
          placeholder="Quantify the green premium vs. CO₂e saved, explain how modal shift (Air → Sea/Rail) or shadow carbon pricing changes supplier ranking, and defend your final sourcing strategy…"
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
        />
      </div>
    </div>
  );
}
