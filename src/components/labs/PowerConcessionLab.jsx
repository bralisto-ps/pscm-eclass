import { useEffect, useMemo, useState } from 'react';
import { getLabPreset } from '../../lib/labsCatalog.js';
import { analyzePowerAndConcessions } from '../../lib/labNegotiationEngine.js';

const DRIVER_LABELS = [
  { key: 'spendAttractiveness', label: 'Buyer Spend Attractiveness (1–5)', side: 'Buyer' },
  { key: 'buyerBatnaStrength', label: 'Buyer BATNA Credibility (1–5)', side: 'Buyer' },
  { key: 'marketTransparency', label: 'Cost & Market Transparency (1–5)', side: 'Buyer' },
  { key: 'switchingCost', label: 'Switching Cost Barrier (1–5)', side: 'Supplier' },
  { key: 'supplyScarcity', label: 'Supplier Capacity Scarcity (1–5)', side: 'Supplier' },
  { key: 'buyerUrgency', label: 'Buyer Schedule Urgency (1–5)', side: 'Supplier' },
];

export default function PowerConcessionLab({
  config,
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const baseDataset = useMemo(
    () => config?.customDataset || getLabPreset('neg_power_concession', config?.presetId) || {},
    [config?.customDataset, config?.presetId],
  );
  const currency = baseDataset.currency || 'GHS';

  const [drivers, setDrivers] = useState(() => ({
    spendAttractiveness: 4,
    buyerBatnaStrength: 3,
    marketTransparency: 4,
    switchingCost: 3,
    supplyScarcity: 3,
    buyerUrgency: 2,
    ...(baseDataset.drivers || {}),
    ...(draftState?.drivers || {}),
  }));
  const [buyerAnchor, setBuyerAnchor] = useState(() => Number(draftState?.buyerAnchor ?? baseDataset.buyerAnchor ?? 900));
  const [buyerReservation, setBuyerReservation] = useState(() => Number(draftState?.buyerReservation ?? baseDataset.buyerReservation ?? 1120));
  const [supplierAnchor, setSupplierAnchor] = useState(() => Number(draftState?.supplierAnchor ?? baseDataset.supplierAnchor ?? 1260));
  const [concessionSteps, setConcessionSteps] = useState(() =>
    Array.isArray(draftState?.concessionSteps) && draftState.concessionSteps.length
      ? draftState.concessionSteps
      : (baseDataset.concessionSteps || [
          { concessionAmount: 80, ifThenTrade: 'IF supplier reduces lead time from 21 to 10 days' },
          { concessionAmount: 50, ifThenTrade: 'IF supplier extends warranty to 24 months' },
          { concessionAmount: 30, ifThenTrade: 'IF supplier accepts Net 45 payment terms' },
          { concessionAmount: 15, ifThenTrade: 'IF supplier locks price for 18 months (final move)' },
        ]),
  );
  const [judgement, setJudgement] = useState(() => String(draftState?.judgement || ''));

  useEffect(() => {
    onDraftChange?.({ drivers, buyerAnchor, buyerReservation, supplierAnchor, concessionSteps, judgement });
  }, [drivers, buyerAnchor, buyerReservation, supplierAnchor, concessionSteps, judgement]);

  const analysis = useMemo(
    () =>
      analyzePowerAndConcessions({
        drivers,
        buyerAnchor,
        buyerReservation,
        supplierAnchor,
        concessionSteps,
      }),
    [drivers, buyerAnchor, buyerReservation, supplierAnchor, concessionSteps],
  );

  function updateStep(idx, field, value) {
    setConcessionSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: field === 'concessionAmount' ? Number(value) || 0 : value } : s)),
    );
  }

  const wordCount = judgement.trim() ? judgement.trim().split(/\s+/).length : 0;
  const quantChecks = [
    analysis.staysWithinReservation,
    analysis.diminishingPattern,
    analysis.conditionalCoveragePct >= 75,
    analysis.readinessScore >= 80,
  ];
  const quantPassed = quantChecks.filter(Boolean).length;

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const lines = [
        'LABORATORY: NEG-LAB 04 — Bargaining Power, Concession Planning & Deadlock Resolution',
        `Scenario: ${baseDataset.name || 'Commercial Contract Strategy Plan'} (${currency})`,
        `Auto-Verification Score: ${Math.round((quantPassed / quantChecks.length) * 100)}% (${quantPassed}/${quantChecks.length} checks) | Judgement: ${wordCount >= 40 ? 'PASS' : 'REVIEW'} (${wordCount} words)`,
        '',
        'KEY VERIFIED POWER & CONCESSION METRICS',
        `- Buyer Power Index: ${analysis.buyerPowerScore}/100 | Supplier Power Index: ${analysis.supplierPowerScore}/100`,
        `- Power Quadrant: ${analysis.quadrant} — ${analysis.posture}`,
        `- Concession Readiness Score: ${analysis.readinessScore}/100`,
        `- Diminishing Concession Pattern: ${analysis.diminishingPattern ? 'PASS' : 'FAIL'} | Conditional Give-Get Coverage: ${analysis.conditionalCoveragePct}%`,
        `- Planned Final Offer: ${currency} ${analysis.finalPlannedOffer} vs. Walk-Away Ceiling ${currency} ${analysis.buyerReservation} (${analysis.staysWithinReservation ? 'WITHIN LIMIT' : 'BREACHED CEILING'})`,
        '',
        '4-ROUND CONCESSION SCHEDULE',
        ...analysis.trajectory.map(
          (t) => `• Round ${t.round}: +${currency} ${t.move} -> Offer ${currency} ${t.offerAtRound} | Condition: ${t.ifThenTrade || '(UNCONDITIONAL — RISK!)'}`,
        ),
        '',
        'MANAGERIAL JUDGEMENT & DEADLOCK PLAYBOOK',
        judgement.trim() || '(No written managerial judgement provided.)',
      ];
      return {
        title: 'NEG-LAB 04 — Bargaining Power & Concession Plan Report',
        body: lines.join('\n'),
        hasJudgement: wordCount >= 30,
      };
    });
  }, [baseDataset.name, currency, analysis, judgement, wordCount, quantPassed]);

  const px = 48 + (analysis.buyerPowerScore / 100) * 230;
  const py = 210 - (analysis.supplierPowerScore / 100) * 170;

  return (
    <div className="stack">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Power Balance Quadrant</div>
          <div className="kpi" style={{ fontSize: 16, marginTop: 6, color: '#6d28d9' }}>{analysis.quadrant}</div>
          <div className="tiny muted">Buyer {analysis.buyerPowerScore} vs. Supplier {analysis.supplierPowerScore}</div>
        </div>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Plan Readiness Score</div>
          <div className="kpi mono" style={{ fontSize: 20, marginTop: 4, color: analysis.readinessScore >= 80 ? 'var(--teal-700)' : 'var(--amber)' }}>
            {analysis.readinessScore} / 100
          </div>
          <div className="tiny muted">Conditional trades: {analysis.conditionalCoveragePct}%</div>
        </div>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Concession Discipline</div>
          <div className="kpi mono" style={{ fontSize: 18, marginTop: 4, color: analysis.diminishingPattern ? 'var(--teal-700)' : 'var(--red)' }}>
            {analysis.diminishingPattern ? 'DIMINISHING ●' : 'ERRATIC ▲'}
          </div>
          <div className="tiny muted">Signals convergence without weakness</div>
        </div>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Walk-Away Guardrail</div>
          <div className="kpi mono" style={{ fontSize: 18, marginTop: 4, color: analysis.staysWithinReservation ? 'var(--teal-700)' : 'var(--red)' }}>
            {currency} {analysis.finalPlannedOffer} / {analysis.buyerReservation}
          </div>
          <div className="tiny muted">{analysis.staysWithinReservation ? 'Stays inside BATNA ceiling' : 'Breaches reservation price!'}</div>
        </div>
      </div>

      {/* Power Balance Matrix + Driver Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(295px, 1fr))', gap: 14 }}>
        <section className="card stack-xs">
          <h3 style={{ margin: 0, fontSize: 15 }}>Buyer–Supplier Power Balance Matrix</h3>
          <svg viewBox="0 0 320 245" style={{ width: '100%', height: 'auto', display: 'block' }}>
            <rect x="48" y="40" width="115" height="85" fill="#fef2f2" stroke="#e2e8f0" />
            <rect x="163" y="40" width="115" height="85" fill="#f5f3ff" stroke="#e2e8f0" />
            <rect x="48" y="125" width="115" height="85" fill="#f8fafc" stroke="#e2e8f0" />
            <rect x="163" y="125" width="115" height="85" fill="#f0fdfa" stroke="#e2e8f0" />
            <text x="105" y="60" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#991b1b">SUPPLIER DOMINANCE</text>
            <text x="220" y="60" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#5b21b6">INTERDEPENDENCE</text>
            <text x="105" y="198" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#475569">COMPETITIVE MARKET</text>
            <text x="220" y="198" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#0f766e">BUYER DOMINANCE</text>
            <circle cx={px} cy={py} r="8" fill="#6d28d9" stroke="#ffffff" strokeWidth="2.5" />
            <text x="163" y="232" textAnchor="middle" fontSize="9.5" fill="#475569" fontFamily="monospace">Buyer Power ({analysis.buyerPowerScore}) →</text>
            <text x="16" y="125" textAnchor="middle" fontSize="9.5" fill="#475569" fontFamily="monospace" transform="rotate(-90 16 125)">Supplier Power ({analysis.supplierPowerScore}) →</text>
          </svg>
          <div className="tiny muted"><strong>Recommended Posture:</strong> {analysis.posture}</div>
        </section>

        <section className="card stack-xs">
          <h3 style={{ margin: 0, fontSize: 15 }}>Power Diagnostic Drivers (1 = Low, 5 = High)</h3>
          {DRIVER_LABELS.map((d) => (
            <label key={d.key} className="between tiny" style={{ gap: 10 }}>
              <span>{d.label}</span>
              <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={drivers[d.key] ?? 3}
                  onChange={(e) => setDrivers((prev) => ({ ...prev, [d.key]: Number(e.target.value) }))}
                />
                <strong className="mono" style={{ width: 14 }}>{drivers[d.key] ?? 3}</strong>
              </span>
            </label>
          ))}
        </section>
      </div>

      {/* 4-Round Concession Planner */}
      <section className="card stack-sm">
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>4-Round Diminishing Concession Schedule &amp; Conditional Give-Gets</h3>
          <div className="row-wrap tiny" style={{ gap: 10 }}>
            <label className="row" style={{ gap: 4, alignItems: 'center' }}>
              <span>Anchor:</span>
              <input className="input mono" style={{ width: 82, padding: '4px 6px' }} type="number" value={buyerAnchor} onChange={(e) => setBuyerAnchor(Number(e.target.value))} />
            </label>
            <label className="row" style={{ gap: 4, alignItems: 'center' }}>
              <span>Walk-Away Max:</span>
              <input className="input mono" style={{ width: 82, padding: '4px 6px' }} type="number" value={buyerReservation} onChange={(e) => setBuyerReservation(Number(e.target.value))} />
            </label>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5 }}>
            <thead>
              <tr>
                <th>Round</th>
                <th>Concession Step ({currency})</th>
                <th>Cumulative Offer</th>
                <th>Conditional If–Then Trade (Required Give–Get)</th>
              </tr>
            </thead>
            <tbody>
              {analysis.trajectory.map((step, idx) => (
                <tr key={step.round}>
                  <td className="mono"><strong>Rd {step.round}</strong></td>
                  <td>
                    <input
                      className="input mono"
                      style={{ width: 88, padding: '4px 6px' }}
                      type="number"
                      min="0"
                      value={concessionSteps[idx]?.concessionAmount ?? 0}
                      onChange={(e) => updateStep(idx, 'concessionAmount', e.target.value)}
                    />
                  </td>
                  <td className="mono" style={{ color: step.offerAtRound <= buyerReservation ? 'var(--teal-700)' : 'var(--red)', fontWeight: 700 }}>
                    {currency} {step.offerAtRound}
                  </td>
                  <td>
                    <input
                      className="input"
                      style={{ width: '100%', minWidth: 240, padding: '4px 8px' }}
                      placeholder="IF supplier grants [non-price value]…"
                      value={concessionSteps[idx]?.ifThenTrade || ''}
                      onChange={(e) => updateStep(idx, 'ifThenTrade', e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack-xs">
        <div className="between">
          <h3 style={{ margin: 0, fontSize: 15 }}>Managerial Judgement &amp; Deadlock Resolution Playbook</h3>
          <span className="tiny mono muted">{wordCount} words {wordCount >= 40 ? '● READY' : '(target ≥ 40 words)'}</span>
        </div>
        <textarea
          className="textarea"
          rows={4}
          placeholder="Explain how your power quadrant dictates your negotiation posture, how you will harden a weak BATNA before meeting the supplier, and what exact deadlock-breaking mechanism you will deploy if the supplier stalls…"
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
        />
      </section>
    </div>
  );
}
