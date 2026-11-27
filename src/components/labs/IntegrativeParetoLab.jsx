import { useEffect, useMemo, useState } from 'react';
import { getLabPreset } from '../../lib/labsCatalog.js';
import {
  computeParetoFrontier,
  evaluateIntegrativePackage,
  scoreDealAgainstFrontier,
} from '../../lib/labNegotiationEngine.js';

export default function IntegrativeParetoLab({
  config,
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const baseDataset = useMemo(
    () => config?.customDataset || getLabPreset('neg_integrative_pareto', config?.presetId) || {},
    [config?.customDataset, config?.presetId],
  );
  const issues = useMemo(() => baseDataset.issues || [], [baseDataset.issues]);
  const buyerBatnaPts = Number(baseDataset.buyerBatnaPts ?? 42);
  const supplierBatnaPts = Number(baseDataset.supplierBatnaPts ?? 42);

  const defaultChoices = useMemo(() => {
    const init = {};
    issues.forEach((iss) => {
      init[iss.id] = iss.options?.[Math.floor(iss.options.length / 2)]?.id || iss.options?.[0]?.id;
    });
    return init;
  }, [issues]);

  const [selected, setSelected] = useState(() => (draftState?.selected && Object.keys(draftState.selected).length ? draftState.selected : defaultChoices));
  const [mesoList, setMesoList] = useState(() => (Array.isArray(draftState?.mesoList) ? draftState.mesoList : []));
  const [showFrontier, setShowFrontier] = useState(() => Boolean(draftState?.showFrontier ?? true));
  const [judgement, setJudgement] = useState(() => String(draftState?.judgement || ''));

  useEffect(() => {
    onDraftChange?.({ selected, mesoList, showFrontier, judgement });
  }, [selected, mesoList, showFrontier, judgement]);

  const frontierData = useMemo(
    () => computeParetoFrontier(issues, buyerBatnaPts, supplierBatnaPts),
    [issues, buyerBatnaPts, supplierBatnaPts],
  );
  const currentEval = useMemo(
    () => evaluateIntegrativePackage(issues, selected, buyerBatnaPts, supplierBatnaPts),
    [issues, selected, buyerBatnaPts, supplierBatnaPts],
  );
  const score = useMemo(
    () => scoreDealAgainstFrontier(currentEval, frontierData),
    [currentEval, frontierData],
  );

  function saveMesoPackage() {
    if (mesoList.length >= 3) return;
    setMesoList((prev) => [
      ...prev,
      {
        label: `MESO Option ${String.fromCharCode(65 + prev.length)}`,
        selections: { ...selected },
        buyerPoints: currentEval.buyerPoints,
        supplierPoints: currentEval.supplierPoints,
        jointPoints: currentEval.jointPoints,
        isParetoOptimal: score.isParetoOptimal,
      },
    ]);
  }

  function applyNashOptimal() {
    if (frontierData.nashDeal?.selections) {
      setSelected({ ...frontierData.nashDeal.selections });
    }
  }

  const wordCount = judgement.trim() ? judgement.trim().split(/\s+/).length : 0;
  const quantChecks = [
    currentEval.bothAboveBatna,
    score.paretoEfficiencyPct >= 88,
    score.isParetoOptimal || score.valueLeftOnTable <= 6,
    mesoList.length >= 1,
  ];
  const quantPassed = quantChecks.filter(Boolean).length;

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const lines = [
        'LABORATORY: NEG-LAB 02 — Integrative Multi-Issue Negotiation & Pareto Frontier Analysis',
        `Scenario: ${baseDataset.name || 'Multi-Issue Commercial Contract'}`,
        `Auto-Verification Score: ${Math.round((quantPassed / quantChecks.length) * 100)}% (${quantPassed}/${quantChecks.length} checks) | Judgement: ${wordCount >= 40 ? 'PASS' : 'REVIEW'} (${wordCount} words)`,
        '',
        'KEY VERIFIED INTEGRATIVE & PARETO METRICS',
        `- Buyer Points: ${currentEval.buyerPoints} (BATNA ${buyerBatnaPts}) | Supplier Points: ${currentEval.supplierPoints} (BATNA ${supplierBatnaPts})`,
        `- Joint Value Created: ${currentEval.jointPoints} / ${score.maxJointPoints} max feasible (${score.paretoEfficiencyPct}% Pareto Efficiency)`,
        `- On Pareto Efficient Frontier: ${score.isParetoOptimal ? 'YES (Optimal — Zero Value Left on Table)' : `NO (${score.valueLeftOnTable} joint points left on table)`}`,
        `- Both Parties Beat BATNA: ${currentEval.bothAboveBatna ? 'YES' : 'NO'}`,
        `- MESO Packages Prepared: ${mesoList.length}`,
        '',
        'SELECTED CONTRACT PACKAGE BREAKDOWN',
        ...currentEval.breakdown.map((b) => `• ${b.issueName}: ${b.optionLabel} (Buyer ${b.buyerPoints} pts / Supplier ${b.supplierPoints} pts)`),
        '',
        'MANAGERIAL JUDGEMENT & LOGROLLING STRATEGY',
        judgement.trim() || '(No written managerial judgement provided.)',
      ];
      return {
        title: 'NEG-LAB 02 — Integrative Negotiation & Pareto Frontier Report',
        body: lines.join('\n'),
        hasJudgement: wordCount >= 30,
      };
    });
  }, [baseDataset.name, currentEval, score, buyerBatnaPts, supplierBatnaPts, mesoList.length, judgement, wordCount, quantPassed]);

  // SVG Scatter Plot geometry
  const maxX = Math.max(100, ...frontierData.allCombos.map((c) => c.buyerPoints)) + 8;
  const maxY = Math.max(100, ...frontierData.allCombos.map((c) => c.supplierPoints)) + 8;
  const xOf = (b) => 52 + (b / maxX) * 530;
  const yOf = (s) => 240 - (s / maxY) * 205;
  const frontierPath = frontierData.frontier
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.buyerPoints).toFixed(1)} ${yOf(p.supplierPoints).toFixed(1)}`)
    .join(' ');

  return (
    <div className="stack">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Buyer Score (BATNA {buyerBatnaPts})</div>
          <div className="kpi mono" style={{ fontSize: 20, marginTop: 4, color: currentEval.buyerPoints >= buyerBatnaPts ? 'var(--teal-700)' : 'var(--red)' }}>
            {currentEval.buyerPoints} pts
          </div>
          <div className="tiny muted">Surplus: {currentEval.buyerSurplus >= 0 ? '+' : ''}{currentEval.buyerSurplus}</div>
        </div>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Supplier Score (BATNA {supplierBatnaPts})</div>
          <div className="kpi mono" style={{ fontSize: 20, marginTop: 4, color: currentEval.supplierPoints >= supplierBatnaPts ? 'var(--teal-700)' : 'var(--red)' }}>
            {currentEval.supplierPoints} pts
          </div>
          <div className="tiny muted">Surplus: {currentEval.supplierSurplus >= 0 ? '+' : ''}{currentEval.supplierSurplus}</div>
        </div>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Pareto Efficiency</div>
          <div className="kpi mono" style={{ fontSize: 20, marginTop: 4, color: score.isParetoOptimal ? 'var(--teal-700)' : 'var(--amber)' }}>
            {score.paretoEfficiencyPct}%
          </div>
          <div className="tiny muted">{score.isParetoOptimal ? 'On Pareto Frontier' : `${score.valueLeftOnTable} pts left on table`}</div>
        </div>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Joint Value / Max Possible</div>
          <div className="kpi mono" style={{ fontSize: 20, marginTop: 4 }}>
            {currentEval.jointPoints} / {score.maxJointPoints}
          </div>
          <div className="tiny muted">MESO saved: {mesoList.length} / 3</div>
        </div>
      </div>

      {/* Live Pareto Efficient Frontier Scatter Plot */}
      <section className="card stack-xs">
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Integrative Deal Space &amp; Mathematical Pareto Efficient Frontier</h3>
          <div className="row-wrap" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm" onClick={() => setShowFrontier((v) => !v)}>
              {showFrontier ? 'Hide Frontier Curve' : 'Reveal Pareto Frontier'}
            </button>
            <button type="button" className="btn btn-sm" onClick={applyNashOptimal}>
              Inspect Nash Solution
            </button>
          </div>
        </div>
        <svg viewBox="0 0 620 278" style={{ width: '100%', height: 'auto', display: 'block' }}>
          <line x1="52" x2="582" y1="240" y2="240" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="52" x2="52" y1="30" y2="240" stroke="#94a3b8" strokeWidth="1.5" />
          {/* BATNA thresholds */}
          <line x1={xOf(buyerBatnaPts)} x2={xOf(buyerBatnaPts)} y1="30" y2="240" stroke="#dc2626" strokeDasharray="4 4" strokeWidth="1.2" />
          <line x1="52" x2="582" y1={yOf(supplierBatnaPts)} y2={yOf(supplierBatnaPts)} stroke="#dc2626" strokeDasharray="4 4" strokeWidth="1.2" />
          <text x={xOf(buyerBatnaPts) + 4} y="42" fontSize="9.5" fill="#dc2626" fontFamily="monospace">Buyer BATNA ({buyerBatnaPts})</text>
          <text x="56" y={yOf(supplierBatnaPts) - 5} fontSize="9.5" fill="#dc2626" fontFamily="monospace">Supplier BATNA ({supplierBatnaPts})</text>

          {/* All feasible & infeasible combinations */}
          {frontierData.allCombos.map((c, idx) => (
            <circle
              key={idx}
              cx={xOf(c.buyerPoints)}
              cy={yOf(c.supplierPoints)}
              r="2.4"
              fill={c.feasible ? '#94a3b8' : '#e2e8f0'}
              fillOpacity="0.7"
            />
          ))}

          {/* Pareto Frontier */}
          {showFrontier && frontierPath && (
            <>
              <path d={frontierPath} fill="none" stroke="#0f766e" strokeWidth="2.4" />
              {frontierData.frontier.map((p, idx) => (
                <circle key={idx} cx={xOf(p.buyerPoints)} cy={yOf(p.supplierPoints)} r="4" fill="#0f766e" />
              ))}
            </>
          )}

          {/* Nash Bargaining Solution */}
          {showFrontier && frontierData.nashDeal && (
            <g>
              <circle cx={xOf(frontierData.nashDeal.buyerPoints)} cy={yOf(frontierData.nashDeal.supplierPoints)} r="6" fill="#6d28d9" />
              <text x={xOf(frontierData.nashDeal.buyerPoints) - 6} y={yOf(frontierData.nashDeal.supplierPoints) - 10} textAnchor="end" fontSize="9.5" fontWeight="700" fill="#6d28d9" fontFamily="monospace">
                Nash ({frontierData.nashDeal.buyerPoints},{frontierData.nashDeal.supplierPoints})
              </text>
            </g>
          )}

          {/* Current Student Package */}
          <circle cx={xOf(currentEval.buyerPoints)} cy={yOf(currentEval.supplierPoints)} r="7.5" fill="#2563eb" stroke="#1e3a8a" strokeWidth="2" />
          <text x={xOf(currentEval.buyerPoints) + 10} y={yOf(currentEval.supplierPoints) + 4} fontSize="10.5" fontWeight="700" fill="#1d4ed8" fontFamily="monospace">
            Your Deal ({currentEval.buyerPoints}, {currentEval.supplierPoints})
          </text>

          <text x="317" y="268" textAnchor="middle" fontSize="10.5" fill="#475569" fontFamily="monospace">Buyer Utility Points →</text>
          <text x="16" y="135" textAnchor="middle" fontSize="10.5" fill="#475569" fontFamily="monospace" transform="rotate(-90 16 135)">Supplier Utility Points →</text>
        </svg>
      </section>

      {/* Multi-Issue Package & MESO Builder */}
      <section className="card stack-sm">
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15 }}>5-Issue Commercial Package &amp; Logrolling Trade-Offs</h3>
            <div className="tiny muted">Trade low-priority issues for high-priority issues to push your deal onto the Pareto Frontier.</div>
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={mesoList.length >= 3} onClick={saveMesoPackage}>
              Save as MESO Package ({mesoList.length}/3)
            </button>
            {mesoList.length > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => setMesoList([])}>Clear MESOs</button>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {issues.map((issue) => (
            <div key={issue.id} className="card-soft stack-xs" style={{ padding: 10 }}>
              <strong className="small">{issue.name}</strong>
              {(issue.options || []).map((opt) => {
                const active = selected[issue.id] === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`btn btn-sm ${active ? 'btn-primary' : ''}`}
                    style={{ justifyContent: 'space-between', width: '100%', textAlign: 'left', whiteSpace: 'normal', height: 'auto', padding: '6px 8px' }}
                    onClick={() => setSelected((prev) => ({ ...prev, [issue.id]: opt.id }))}
                  >
                    <span>{opt.label}</span>
                    <span className="mono tiny">B:{opt.buyerPoints} / S:{opt.supplierPoints}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {mesoList.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 6 }}>
            <table className="table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>MESO Package</th>
                  <th>Buyer Pts</th>
                  <th>Supplier Pts</th>
                  <th>Joint Pts</th>
                  <th>Pareto Optimal</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {mesoList.map((m, idx) => (
                  <tr key={idx}>
                    <td><strong>{m.label}</strong></td>
                    <td className="mono">{m.buyerPoints}</td>
                    <td className="mono">{m.supplierPoints}</td>
                    <td className="mono">{m.jointPoints}</td>
                    <td className="mono" style={{ color: m.isParetoOptimal ? 'var(--teal-700)' : 'var(--amber)', fontWeight: 700 }}>
                      {m.isParetoOptimal ? 'YES' : 'NO'}
                    </td>
                    <td>
                      <button type="button" className="btn btn-sm" onClick={() => setSelected({ ...m.selections })}>Load</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack-xs">
        <div className="between">
          <h3 style={{ margin: 0, fontSize: 15 }}>Managerial Judgement &amp; Value-Creation Debrief</h3>
          <span className="tiny mono muted">{wordCount} words {wordCount >= 40 ? '● READY' : '(target ≥ 40 words)'}</span>
        </div>
        <textarea
          className="textarea"
          rows={4}
          placeholder="Identify which asymmetric issues created the largest joint-gain logrolling trades, explain how presenting MESO packages reveals counterpart preferences without exposing your reservation point, and evaluate how close your deal sits to the Pareto Frontier…"
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
        />
      </section>
    </div>
  );
}
