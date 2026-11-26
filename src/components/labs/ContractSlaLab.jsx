import { useEffect, useMemo, useState } from 'react';
import { getLabPreset } from '../../lib/labsCatalog.js';
import { evaluateContractSla } from '../../lib/labMilestone8Engine.js';

export default function ContractSlaLab({
  config,
  dataMode = 'both',
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const baseDataset = useMemo(
    () => config?.customDataset || getLabPreset('scm_contract_sla', config?.presetId) || {},
    [config?.customDataset, config?.presetId],
  );
  const currency = baseDataset.currency || 'GHS';

  const [params, setParams] = useState(() => ({
    contractValue: Number(draftState?.params?.contractValue ?? baseDataset.contractValue ?? 600000),
    targetOtifPct: Number(draftState?.params?.targetOtifPct ?? baseDataset.targetOtifPct ?? 95),
    maxDefectPct: Number(draftState?.params?.maxDefectPct ?? baseDataset.maxDefectPct ?? 2.0),
    maxResponseHrs: Number(draftState?.params?.maxResponseHrs ?? baseDataset.maxResponseHrs ?? 24),
    ldRatePerOtifPct: Number(draftState?.params?.ldRatePerOtifPct ?? baseDataset.ldRatePerOtifPct ?? 0.5),
    ldCapPct: Number(draftState?.params?.ldCapPct ?? baseDataset.ldCapPct ?? 10),
    switchingCost: Number(draftState?.params?.switchingCost ?? baseDataset.switchingCost ?? 45000),
    terminationStreakTarget: Number(draftState?.params?.terminationStreakTarget ?? 3),
  }));

  const [periods, setPeriods] = useState(() =>
    Array.isArray(draftState?.periods) && draftState.periods.length
      ? draftState.periods
      : (baseDataset.periods || []),
  );
  const [judgement, setJudgement] = useState(() => String(draftState?.judgement || ''));

  useEffect(() => {
    onDraftChange?.({ params, periods, judgement });
  }, [params, periods, judgement]);

  const result = useMemo(() => evaluateContractSla(params, periods), [params, periods]);
  const wordCount = judgement.trim() ? judgement.trim().split(/\s+/).length : 0;
  const quantChecks = [
    result.periods.length >= 4,
    params.targetOtifPct > 0,
    params.ldCapPct > 0,
    result.avgOtifPct > 0,
  ];
  const quantPassed = quantChecks.filter(Boolean).length;

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const lines = [
        'LABORATORY: SCM-LAB 02 — Contract Governance, SLA Compliance & Liquidated Damages',
        `Contract: ${baseDataset.name || 'Managed Supply Contract'} (${currency} ${params.contractValue.toLocaleString()})`,
        `Auto-Verification Score: ${Math.round((quantPassed / quantChecks.length) * 100)}% (${quantPassed}/${quantChecks.length} checks) | Judgement: ${wordCount >= 40 ? 'PASS' : 'REVIEW'} (${wordCount} words)`,
        '',
        'KEY VERIFIED METRICS',
        `- Average OTIF Performance: ${result.avgOtifPct}% (Target: ${params.targetOtifPct}%)`,
        `- SLA Compliance Rate: ${result.complianceRatePct}% (${result.breachPeriods} breach period(s), ${result.forceMajeureProtected} Force Majeure excused)`,
        `- Raw Liquidated Damages: ${currency} ${result.cumulativeRawLd.toLocaleString()} | Capped Payable LD (${params.ldCapPct}% cap): ${currency} ${result.cappedLd.toLocaleString()}`,
        `- Max Consecutive Breach Streak: ${result.maxBreachStreak} (Material Breach Triggered: ${result.materialBreachTriggered ? 'YES' : 'NO'})`,
        `- Switching Cost Benchmark: ${currency} ${params.switchingCost.toLocaleString()} → Recommended Action: ${result.recommendedAction}`,
        '',
        'PERIOD-BY-PERIOD SLA AUDIT LEDGER',
        ...result.periods.map((p) =>
          `• ${p.period}: OTIF ${p.otifPct}% | Defect ${p.defectPct}% | Resp ${p.responseHrs}h | ${p.status} | Penalty ${currency} ${p.rawPenalty.toLocaleString()}`,
        ),
        '',
        'WRITTEN MANAGERIAL JUDGEMENT',
        judgement.trim() || '(No judgement entered)',
      ];
      return {
        title: config?.title || 'Contract Governance, SLA Compliance & Liquidated Damages Report',
        body: lines.join('\n'),
        hasJudgement: wordCount >= 20,
      };
    });
  }, [result, params, judgement, wordCount, currency, baseDataset.name, config?.title, onRegisterReportBuilder]);

  function updatePeriod(idx, field, val) {
    setPeriods((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: val } : p)));
  }

  return (
    <div className="stack">
      <div className="card-soft stack-xs" style={{ padding: 14 }}>
        <div className="tiny mono" style={{ color: '#b45309', fontWeight: 700 }}>
          SCM-LAB 02 · SLA COMPLIANCE, LIQUIDATED DAMAGES &amp; REMEDY GOVERNANCE
        </div>
        <strong className="small">{baseDataset.name || 'Annual Supply SLA Audit'}</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 6 }}>
          <label className="stack-xs tiny muted">
            Target OTIF (%)
            <input className="input mono" type="number" min="70" max="100" value={params.targetOtifPct} onChange={(e) => setParams((p) => ({ ...p, targetOtifPct: Number(e.target.value) }))} />
          </label>
          <label className="stack-xs tiny muted">
            Max Defect (%)
            <input className="input mono" type="number" step="0.1" value={params.maxDefectPct} onChange={(e) => setParams((p) => ({ ...p, maxDefectPct: Number(e.target.value) }))} />
          </label>
          <label className="stack-xs tiny muted">
            LD Cap (% Contract)
            <input className="input mono" type="number" min="1" max="30" value={params.ldCapPct} onChange={(e) => setParams((p) => ({ ...p, ldCapPct: Number(e.target.value) }))} />
          </label>
          <label className="stack-xs tiny muted">
            LD Rate (% / 1% OTIF miss)
            <input className="input mono" type="number" step="0.1" value={params.ldRatePerOtifPct} onChange={(e) => setParams((p) => ({ ...p, ldRatePerOtifPct: Number(e.target.value) }))} />
          </label>
          <label className="stack-xs tiny muted">
            Supplier Switching Cost
            <input className="input mono" type="number" value={params.switchingCost} onChange={(e) => setParams((p) => ({ ...p, switchingCost: Number(e.target.value) }))} />
          </label>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">Average OTIF / Compliance</div>
          <strong className="mono" style={{ fontSize: 18, color: result.avgOtifPct >= params.targetOtifPct ? 'var(--teal-700)' : 'var(--amber)' }}>
            {result.avgOtifPct}%
          </strong>
          <div className="tiny muted">{result.complianceRatePct}% periods compliant</div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">Capped Liquidated Damages</div>
          <strong className="mono" style={{ fontSize: 18, color: result.capHit ? 'var(--red)' : '#b45309' }}>
            {currency} {result.cappedLd.toLocaleString()}
          </strong>
          <div className="tiny muted">
            Raw: {currency} {result.cumulativeRawLd.toLocaleString()} · Cap: {currency} {result.capAmount.toLocaleString()}
          </div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">Material Breach Status</div>
          <strong className="mono small" style={{ color: result.materialBreachTriggered ? 'var(--red)' : 'var(--teal-700)' }}>
            {result.materialBreachTriggered ? '■ TERMINATION TRIGGERED' : '● BELOW BREACH THRESHOLD'}
          </strong>
          <div className="tiny muted">Max streak: {result.maxBreachStreak} / {params.terminationStreakTarget} consecutive</div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">Governance Recommendation</div>
          <strong className="small">{result.recommendedAction}</strong>
        </div>
      </div>

      {/* Period Audit Table with Force Majeure Toggle */}
      <div className="card stack-xs" style={{ padding: 14, overflowX: 'auto' }}>
        <div className="between">
          <strong className="small">Monthly SLA Ledger &amp; Force Majeure Simulation</strong>
          <span className="tiny muted">Toggle Force Majeure on disrupted months to test contractual excusable delay clauses.</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
              <th style={{ padding: 6 }}>Period</th>
              <th style={{ padding: 6 }}>Invoice ({currency})</th>
              <th style={{ padding: 6 }}>OTIF %</th>
              <th style={{ padding: 6 }}>Defect %</th>
              <th style={{ padding: 6 }}>Response (hrs)</th>
              <th style={{ padding: 6 }}>Force Majeure?</th>
              <th style={{ padding: 6 }}>Status</th>
              <th style={{ padding: 6 }}>Period Penalty</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p, idx) => {
              const ev = result.periods[idx];
              const locked = dataMode === 'lecturer_only';
              return (
                <tr key={p.id || idx} style={{ borderBottom: '1px solid var(--line-2)' }}>
                  <td style={{ padding: 5 }} className="strong">{p.period}</td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" style={{ minHeight: 30, width: 92 }} disabled={locked} value={p.invoiceValue} onChange={(e) => updatePeriod(idx, 'invoiceValue', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" step="0.5" style={{ minHeight: 30, width: 68 }} value={p.otifPct} onChange={(e) => updatePeriod(idx, 'otifPct', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" step="0.1" style={{ minHeight: 30, width: 64 }} value={p.defectPct} onChange={(e) => updatePeriod(idx, 'defectPct', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <input className="input mono" type="number" style={{ minHeight: 30, width: 64 }} value={p.responseHrs} onChange={(e) => updatePeriod(idx, 'responseHrs', Number(e.target.value))} />
                  </td>
                  <td style={{ padding: 5 }}>
                    <label className="check tiny">
                      <input type="checkbox" checked={Boolean(p.forceMajeure)} onChange={(e) => updatePeriod(idx, 'forceMajeure', e.target.checked)} />
                      Excused
                    </label>
                  </td>
                  <td style={{ padding: 5 }}>
                    <span className="mono tiny" style={{ fontWeight: 700, color: ev?.status === 'COMPLIANT' ? 'var(--teal-700)' : ev?.status.includes('FORCE') ? '#1d4ed8' : 'var(--red)' }}>
                      {ev?.status}
                    </span>
                  </td>
                  <td style={{ padding: 5 }} className="mono strong">
                    {currency} {ev?.rawPenalty?.toLocaleString() || 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card stack-xs" style={{ padding: 14 }}>
        <div className="between">
          <strong className="small">Written Managerial Judgement &amp; Contract Remedy Strategy</strong>
          <span className="tiny mono" style={{ color: wordCount >= 40 ? 'var(--teal-700)' : 'var(--amber)' }}>
            {wordCount} words {wordCount >= 40 ? '● Ready' : '(aim for 40+ words)'}
          </span>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>
          {config?.instructions || 'Justify whether to enforce service credits, invoke a Cure Notice/Termination for material breach, or negotiate a corrective action plan—balancing capped liquidated damages against switching cost and supply continuity.'}
        </p>
        <textarea
          className="input"
          rows={4}
          placeholder="Evaluate the liquidated damages cap, Force Majeure validity, consecutive breach streak, and switching cost trade-off to defend your contractual remedy…"
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
        />
      </div>
    </div>
  );
}
