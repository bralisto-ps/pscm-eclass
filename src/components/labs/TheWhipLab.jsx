import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { useToast } from '../ui.jsx';
import {
  buildLabCsvTemplate,
  getLabPreset,
  readLabSpreadsheetRows,
  THE_WHIP_PRESETS,
} from '../../lib/labsCatalog.js';
import {
  runBullwhipSimulation,
  TIER_KEYS,
  TIER_LABELS,
} from '../../lib/psisMilestone3Engine.js';
import { downloadText } from '../../lib/sheets.js';

const TIER_COLORS = {
  consumer: '#111827',
  retailer: '#0f766e',
  wholesaler: '#2563eb',
  distributor: '#d97706',
  factory: '#dc2626',
};

function BullwhipChart({ history = [], visibleWeeks = 20, showAllTiers = true }) {
  const rows = history.slice(0, Math.max(1, visibleWeeks));
  const width = 760;
  const height = 260;
  const padL = 46;
  const padR = 18;
  const padT = 18;
  const padB = 30;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const seriesList = [
    { key: 'consumer', label: 'Consumer Demand', color: TIER_COLORS.consumer, dash: '4 3', values: rows.map((r) => r.consumerDemand) },
    { key: 'retailer', label: 'Retailer Orders', color: TIER_COLORS.retailer, dash: '', values: rows.map((r) => r.orders.retailer) },
    ...(showAllTiers
      ? [
          { key: 'wholesaler', label: 'Wholesaler Orders', color: TIER_COLORS.wholesaler, dash: '', values: rows.map((r) => r.orders.wholesaler) },
          { key: 'distributor', label: 'Distributor Orders', color: TIER_COLORS.distributor, dash: '', values: rows.map((r) => r.orders.distributor) },
          { key: 'factory', label: 'Factory Orders', color: TIER_COLORS.factory, dash: '', values: rows.map((r) => r.orders.factory) },
        ]
      : []),
  ];

  const allVals = seriesList.flatMap((s) => s.values);
  const maxVal = Math.max(20, Math.ceil(Math.max(...allVals, 10) * 1.12));
  const n = Math.max(2, rows.length);

  const xAt = (i) => padL + (i / Math.max(1, n - 1)) * innerW;
  const yAt = (v) => padT + innerH - (v / maxVal) * innerH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxVal));

  return (
    <div className="stack-xs">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--line-2)' }}
        role="img"
        aria-label="Bullwhip order amplification chart across supply chain tiers"
      >
        {yTicks.map((t) => {
          const y = yAt(t);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#e5e7eb" strokeWidth="1" />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#6b7280" fontFamily="ui-monospace, monospace">
                {t}
              </text>
            </g>
          );
        })}

        {rows.map((r, i) => {
          if (rows.length > 12 && i % 2 !== 0 && i !== rows.length - 1) return null;
          return (
            <text
              key={r.week}
              x={xAt(i)}
              y={height - 10}
              textAnchor="middle"
              fontSize="10"
              fill="#6b7280"
              fontFamily="ui-monospace, monospace"
            >
              W{r.week}
            </text>
          );
        })}

        {seriesList.map((s) => {
          const pts = s.values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
          return (
            <g key={s.key}>
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={s.key === 'factory' || s.key === 'consumer' ? 2.4 : 1.8}
                strokeDasharray={s.dash || undefined}
                points={pts}
              />
              {s.values.map((v, i) => (
                <circle key={i} cx={xAt(i)} cy={yAt(v)} r={2.5} fill={s.color}>
                  <title>{`${s.label} — Week ${i + 1}: ${v} units`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      <div className="row-wrap tiny" style={{ gap: 12 }}>
        {seriesList.map((s) => (
          <span key={s.key} className="row" style={{ gap: 5 }}>
            <span style={{ width: 12, height: 3, background: s.color, display: 'inline-block' }} />
            <span>{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function TheWhipLab({
  config,
  dataMode = 'both',
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const toast = useToast();
  const fileRef = useRef(null);
  const canEditData = dataMode !== 'lecturer_only';

  const defaultPreset = useMemo(
    () => getLabPreset('psis_the_whip', config?.presetId) || THE_WHIP_PRESETS[0],
    [config?.presetId],
  );
  const initialSource = config?.customDataset?.demandSeries?.length
    ? {
        name: config.customDataset.name || 'Lecturer Demand Series',
        leadTimeWeeks: config.customDataset.leadTimeWeeks ?? 2,
        holdingCost: config.customDataset.holdingCost ?? 1,
        backlogCost: config.customDataset.backlogCost ?? 4,
        initialStock: config.customDataset.initialStock ?? 60,
        demandSeries: config.customDataset.demandSeries,
      }
    : defaultPreset;

  const [datasetName, setDatasetName] = useState(draftState?.datasetName || initialSource.name);
  const [demandSeries, setDemandSeries] = useState(() =>
    draftState?.demandSeries?.length ? draftState.demandSeries : [...initialSource.demandSeries],
  );
  const [leadTimeWeeks, setLeadTimeWeeks] = useState(draftState?.leadTimeWeeks ?? initialSource.leadTimeWeeks ?? 2);
  const [infoDelayWeeks, setInfoDelayWeeks] = useState(draftState?.infoDelayWeeks ?? 0);
  const [holdingCost, setHoldingCost] = useState(draftState?.holdingCost ?? initialSource.holdingCost ?? 1);
  const [backlogCost, setBacklogCost] = useState(draftState?.backlogCost ?? initialSource.backlogCost ?? 4);
  const [activeRegime, setActiveRegime] = useState(draftState?.activeRegime || 'blind'); // 'blind' | 'pos_shared'
  const [retailerManualOrders, setRetailerManualOrders] = useState(() => draftState?.retailerManualOrders || []);
  const [currentOrderInput, setCurrentOrderInput] = useState('40');
  const [revealedUpstream, setRevealedUpstream] = useState(
    draftState?.revealedUpstream !== undefined ? draftState.revealedUpstream : true,
  );
  const [playWeekLimit, setPlayWeekLimit] = useState(
    draftState?.playWeekLimit ?? (initialSource.demandSeries?.length || 20),
  );
  const [judgement, setJudgement] = useState(draftState?.judgement || '');

  useEffect(() => {
    onDraftChange?.({
      datasetName,
      demandSeries,
      leadTimeWeeks,
      infoDelayWeeks,
      holdingCost,
      backlogCost,
      activeRegime,
      retailerManualOrders,
      revealedUpstream,
      playWeekLimit,
      judgement,
    });
  }, [
    datasetName,
    demandSeries,
    leadTimeWeeks,
    infoDelayWeeks,
    holdingCost,
    backlogCost,
    activeRegime,
    retailerManualOrders,
    revealedUpstream,
    playWeekLimit,
    judgement,
  ]);

  // Run BOTH Blind Mode and Shared POS Mode on the exact same demand & parameters for instant comparison
  const blindSim = useMemo(
    () =>
      runBullwhipSimulation({
        demandSeries,
        retailerManualOrders,
        regime: 'blind',
        leadTimeWeeks,
        infoDelayWeeks,
        holdingCost,
        backlogCost,
        initialStock: initialSource.initialStock ?? 60,
      }),
    [demandSeries, retailerManualOrders, leadTimeWeeks, infoDelayWeeks, holdingCost, backlogCost, initialSource.initialStock],
  );

  const posSim = useMemo(
    () =>
      runBullwhipSimulation({
        demandSeries,
        retailerManualOrders,
        regime: 'pos_shared',
        leadTimeWeeks,
        infoDelayWeeks: 0, // Shared POS eliminates paper-order delay
        holdingCost,
        backlogCost,
        initialStock: initialSource.initialStock ?? 60,
      }),
    [demandSeries, retailerManualOrders, leadTimeWeeks, holdingCost, backlogCost, initialSource.initialStock],
  );

  const activeSim = activeRegime === 'blind' ? blindSim : posSim;
  const costReductionPct = blindSim.metrics.totalChainCost > 0
    ? ((blindSim.metrics.totalChainCost - posSim.metrics.totalChainCost) / blindSim.metrics.totalChainCost) * 100
    : 0;

  // Report builder for PDF & Assignment Gradebook submission
  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const lines = [
        `LABORATORY: PSIS-LAB 01 — Demand Amplification & Supply Chain Visibility`,
        `DATASET: ${datasetName} (${demandSeries.length} weeks)`,
        `PARAMETERS: Shipment Lead Time = ${leadTimeWeeks} wk(s) | Paper-Mode Info Delay = ${infoDelayWeeks} wk(s) | Holding = ${holdingCost}/u | Shortage = ${backlogCost}/u`,
        `STUDENT MANUAL RETAILER ORDERS ENTERED: ${retailerManualOrders.filter((x) => x !== '' && x != null).length} week(s)`,
        ``,
        `1. ROUND A — BLIND INFORMATION ASYMMETRY MODE`,
        `- Consumer Demand: Mean ${blindSim.metrics.consumerMean}, Peak ${blindSim.metrics.consumerPeak}, CV ${blindSim.metrics.consumerCv}`,
        ...blindSim.metrics.tiers.map(
          (t) => `  * ${t.label}: Peak ${t.peak} | Mean ${t.meanOrder} | CV ${t.cv} | Bullwhip Ratio ${t.bullwhipRatio}x | Cost ${t.totalCost.toLocaleString()}`,
        ),
        `- Total 4-Tier Chain Cost (Blind): ${blindSim.metrics.totalChainCost.toLocaleString()}`,
        ``,
        `2. ROUND B — SHARED POS DEMAND VISIBILITY MODE`,
        ...posSim.metrics.tiers.map(
          (t) => `  * ${t.label}: Peak ${t.peak} | Mean ${t.meanOrder} | CV ${t.cv} | Bullwhip Ratio ${t.bullwhipRatio}x | Cost ${t.totalCost.toLocaleString()}`,
        ),
        `- Total 4-Tier Chain Cost (Shared POS): ${posSim.metrics.totalChainCost.toLocaleString()}`,
        `- Chain Cost Reduction from POS Sharing: ${costReductionPct.toFixed(1)}%`,
        `- Factory Bullwhip Ratio Compression: ${blindSim.metrics.tiers[3]?.bullwhipRatio}x -> ${posSim.metrics.tiers[3]?.bullwhipRatio}x`,
        ``,
        `3. STUDENT WRITTEN MANAGERIAL JUDGEMENT`,
        judgement.trim() || '(No written judgement provided yet.)',
      ];
      return {
        title: `Bullwhip Effect Lab Report — ${datasetName}`,
        body: lines.join('\n'),
        hasJudgement: judgement.trim().length >= 25,
      };
    });
  }, [
    onRegisterReportBuilder,
    datasetName,
    demandSeries.length,
    leadTimeWeeks,
    infoDelayWeeks,
    holdingCost,
    backlogCost,
    retailerManualOrders,
    blindSim,
    posSim,
    costReductionPct,
    judgement,
  ]);

  function handlePresetChange(pid) {
    const found = THE_WHIP_PRESETS.find((p) => p.id === pid);
    if (!found) return;
    setDatasetName(found.name);
    setDemandSeries([...found.demandSeries]);
    setLeadTimeWeeks(found.leadTimeWeeks);
    setHoldingCost(found.holdingCost);
    setBacklogCost(found.backlogCost);
    setRetailerManualOrders([]);
    setPlayWeekLimit(found.demandSeries.length);
    setRevealedUpstream(true);
    toast(`Loaded demand scenario "${found.name}".`);
  }

  function startInteractiveBlindPlay() {
    setRetailerManualOrders([]);
    setPlayWeekLimit(1);
    setRevealedUpstream(false);
    setActiveRegime('blind');
    setCurrentOrderInput(String(demandSeries[0] || 40));
    toast('Interactive Blind Mode started at Week 1 — place your Retailer order each week without seeing upstream tiers!');
  }

  function submitWeeklyRetailerOrder(e) {
    e.preventDefault();
    const wIdx = Math.min(demandSeries.length - 1, Math.max(0, playWeekLimit - 1));
    const qty = Math.max(0, Math.round(Number(currentOrderInput) || 0));
    const nextManual = [...retailerManualOrders];
    nextManual[wIdx] = qty;
    setRetailerManualOrders(nextManual);
    if (playWeekLimit < demandSeries.length) {
      setPlayWeekLimit(playWeekLimit + 1);
    } else {
      setRevealedUpstream(true);
      toast('Final week completed! Upstream Bullwhip Amplification is now revealed.');
    }
  }

  function injectRumourSpike() {
    const next = [...demandSeries];
    const startW = Math.min(Math.max(4, Math.floor(next.length / 2) - 2), next.length - 3);
    for (let i = startW; i < Math.min(next.length, startW + 3); i++) {
      next[i] = Math.round((next[i] || 40) * 1.4);
    }
    setDemandSeries(next);
    toast(`Injected +40% consumer rumour spike across Weeks ${startW + 1}–${Math.min(next.length, startW + 3)}!`);
  }

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readLabSpreadsheetRows(file);
      const series = [];
      rows.forEach((r, idx) => {
        const val = Number(String(r[1] ?? r[0]).replace(/[^0-9.-]/g, ''));
        if (idx === 0 && !Number.isFinite(val)) return;
        if (Number.isFinite(val) && val >= 0) series.push(Math.round(val));
      });
      if (series.length < 6) throw new Error('Upload at least 6 weekly demand values (columns: Week, ConsumerDemand).');
      setDatasetName(file.name.replace(/\.[^.]+$/, ''));
      setDemandSeries(series.slice(0, 40));
      setRetailerManualOrders([]);
      setPlayWeekLimit(Math.min(40, series.length));
      setRevealedUpstream(true);
      toast(`Imported ${Math.min(40, series.length)} weeks of consumer demand from "${file.name}".`);
    } catch (err) {
      toast(err.message || 'Could not import demand CSV.', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function exportSeriesCsv() {
    const header = 'Week,ConsumerDemand,Blind_Retailer,Blind_Wholesaler,Blind_Distributor,Blind_Factory,POS_Retailer,POS_Wholesaler,POS_Distributor,POS_Factory';
    const rows = blindSim.history.map((b, i) => {
      const p = posSim.history[i];
      return [
        b.week,
        b.consumerDemand,
        b.orders.retailer,
        b.orders.wholesaler,
        b.orders.distributor,
        b.orders.factory,
        p.orders.retailer,
        p.orders.wholesaler,
        p.orders.distributor,
        p.orders.factory,
      ].join(',');
    });
    downloadText('bullwhip-simulation-series.csv', [header, ...rows].join('\n'));
  }

  const curWeekRow = activeSim.history[Math.min(activeSim.history.length - 1, Math.max(0, playWeekLimit - 1))];

  return (
    <div className="stack">
      {/* Top Control & Data Source Bar */}
      <div className="card stack-sm" style={{ padding: 14 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="tiny muted">4-TIER SUPPLY CHAIN BULLWHIP SIMULATOR · {datasetName}</div>
            <div className="small" style={{ marginTop: 2 }}>
              Play Retailer week-by-week in Blind Mode or test Paper-Mode information delays, then compare against Shared POS Visibility on the exact same demand shock.
            </div>
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            {canEditData && (
              <>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleCsvUpload} />
                <select
                  className="input"
                  style={{ width: 'auto', minWidth: 210, padding: '6px 10px', fontSize: 13 }}
                  value={THE_WHIP_PRESETS.some((p) => p.name === datasetName) ? (THE_WHIP_PRESETS.find((p) => p.name === datasetName)?.id || '') : ''}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  aria-label="Demand Scenario Preset"
                >
                  <option value="" disabled>Custom Demand Series</option>
                  {THE_WHIP_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const tpl = buildLabCsvTemplate('psis_the_whip');
                    downloadText(tpl.filename, tpl.content);
                  }}
                >
                  <Icon name="download" size={13} /> CSV Template
                </button>
                <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={13} /> Upload Demand CSV
                </button>
              </>
            )}
            <button type="button" className="btn btn-sm" onClick={exportSeriesCsv}>
              <Icon name="download" size={13} /> Export Series CSV
            </button>
          </div>
        </div>

        {/* Simulation Controls: Regime Switch + Paper-Mode Latency Switch + Rumour Injector */}
        <div className="between" style={{ paddingTop: 10, borderTop: '1px solid var(--line-2)', flexWrap: 'wrap', gap: 10 }}>
          <div className="row-wrap" style={{ gap: 6 }}>
            <button
              type="button"
              className={`btn btn-sm ${activeRegime === 'blind' ? 'btn-primary' : ''}`}
              onClick={() => setActiveRegime('blind')}
            >
              Round A: Blind Mode (Asymmetric)
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeRegime === 'pos_shared' ? 'btn-primary' : ''}`}
              onClick={() => { setActiveRegime('pos_shared'); setRevealedUpstream(true); }}
            >
              Round B: Shared POS Visibility
            </button>
            <button type="button" className="btn btn-sm" onClick={startInteractiveBlindPlay}>
              Play Retailer Week-by-Week
            </button>
            {canEditData && (
              <button type="button" className="btn btn-sm" onClick={injectRumourSpike}>
                Inject +40% Rumour Spike
              </button>
            )}
          </div>

          <div className="row-wrap" style={{ gap: 10 }}>
            <label className="row tiny muted" style={{ gap: 6 }}>
              Latency (Paper Mode):
              <select
                className="input mono"
                style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                value={infoDelayWeeks}
                onChange={(e) => setInfoDelayWeeks(Number(e.target.value))}
              >
                <option value={0}>0 wks (Digital EDI)</option>
                <option value={1}>1 wk (Paper Batch)</option>
                <option value={2}>2 wks (Heavy Paper Lag)</option>
              </select>
            </label>
            <label className="row tiny muted" style={{ gap: 6 }}>
              Lead Time:
              <select
                className="input mono"
                style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                value={leadTimeWeeks}
                onChange={(e) => setLeadTimeWeeks(Number(e.target.value))}
              >
                <option value={1}>1 wk</option>
                <option value={2}>2 wks</option>
                <option value={3}>3 wks</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* Interactive Week-by-Week Retailer Console (when playing blind) */}
      {!revealedUpstream && curWeekRow && (
        <div className="card stack-sm" style={{ padding: 16 }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div className="tiny mono" style={{ color: 'var(--red)', fontWeight: 700 }}>
                ▲ BLIND INFORMATION ASYMMETRY ACTIVE — UPSTREAM TIERS HIDDEN
              </div>
              <strong style={{ fontSize: 16 }}>
                Week {playWeekLimit} of {demandSeries.length} — Your Retailer Terminal
              </strong>
            </div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => { setPlayWeekLimit(demandSeries.length); setRevealedUpstream(true); }}
            >
              Finish &amp; Reveal All 4 Tiers
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <div className="card-soft" style={{ padding: 10 }}>
              <div className="tiny muted">CUSTOMER DEMAND</div>
              <div className="kpi mono" style={{ fontSize: 22 }}>{curWeekRow.consumerDemand}</div>
              <div className="tiny muted">units this week</div>
            </div>
            <div className="card-soft" style={{ padding: 10 }}>
              <div className="tiny muted">ON-HAND STOCK</div>
              <div className="kpi mono" style={{ fontSize: 22 }}>{curWeekRow.stocks.retailer}</div>
              <div className="tiny muted">holding: {holdingCost}/unit</div>
            </div>
            <div className="card-soft" style={{ padding: 10 }}>
              <div className="tiny muted">BACKLOG (SHORTAGE)</div>
              <div className="kpi mono" style={{ fontSize: 22, color: curWeekRow.backlogs.retailer > 0 ? 'var(--red)' : 'var(--teal-700)' }}>
                {curWeekRow.backlogs.retailer}
              </div>
              <div className="tiny muted">penalty: {backlogCost}/unit</div>
            </div>
            <div className="card-soft" style={{ padding: 10 }}>
              <div className="tiny muted">UPSTREAM VISIBILITY</div>
              <div className="mono small" style={{ fontWeight: 700, marginTop: 6, color: 'var(--muted)' }}>BLIND</div>
              <div className="tiny muted">Wholesaler/Factory hidden</div>
            </div>
          </div>

          <form onSubmit={submitWeeklyRetailerOrder} className="row-wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
            <label className="stack-xs tiny muted">
              Order Quantity to Place to Wholesaler (Week {playWeekLimit})
              <input
                type="number"
                min="0"
                max="500"
                className="input mono"
                style={{ width: 160, fontWeight: 700, fontSize: 16 }}
                value={currentOrderInput}
                onChange={(e) => setCurrentOrderInput(e.target.value)}
              />
            </label>
            <button type="submit" className="btn btn-primary">
              Place Week {playWeekLimit} Order →
            </button>
          </form>
        </div>
      )}

      {/* Comparative KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">CONSUMER PEAK DEMAND</div>
          <div className="kpi mono" style={{ fontSize: 22, marginTop: 4 }}>{blindSim.metrics.consumerPeak}</div>
          <div className="tiny muted">CV: {blindSim.metrics.consumerCv} (baseline)</div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">BLIND FACTORY PEAK</div>
          <div className="kpi mono" style={{ fontSize: 22, marginTop: 4, color: 'var(--red)' }}>
            {revealedUpstream ? blindSim.metrics.tiers[3]?.peak : 'Hidden'}
          </div>
          <div className="tiny muted">
            {revealedUpstream ? `Bullwhip Ratio: ${blindSim.metrics.tiers[3]?.bullwhipRatio}x` : 'Complete rounds to reveal'}
          </div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">SHARED POS FACTORY PEAK</div>
          <div className="kpi mono" style={{ fontSize: 22, marginTop: 4, color: 'var(--teal-700)' }}>
            {revealedUpstream ? posSim.metrics.tiers[3]?.peak : 'Hidden'}
          </div>
          <div className="tiny muted">
            {revealedUpstream ? `Bullwhip Ratio: ${posSim.metrics.tiers[3]?.bullwhipRatio}x` : 'Compare in Round B'}
          </div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="tiny muted">POS VISIBILITY SAVINGS</div>
          <div
            className="kpi mono"
            style={{
              fontSize: 22,
              marginTop: 4,
              color: costReductionPct > 0 ? 'var(--teal-700)' : 'var(--text)',
            }}
          >
            {revealedUpstream ? `${costReductionPct.toFixed(1)}%` : 'Hidden'}
          </div>
          <div className="tiny muted">
            {revealedUpstream
              ? `${blindSim.metrics.totalChainCost.toLocaleString()} → ${posSim.metrics.totalChainCost.toLocaleString()}`
              : 'Total chain cost delta'}
          </div>
        </div>
      </div>

      {/* Live Multi-Tier Chart */}
      <div className="card stack-sm" style={{ padding: 16 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong>
              {activeRegime === 'blind'
                ? `Order Amplification Chart — Round A: Blind Mode${infoDelayWeeks > 0 ? ` (+${infoDelayWeeks} wk Paper Delay)` : ''}`
                : 'Order Amplification Chart — Round B: Shared POS Visibility'}
            </strong>
            <div className="tiny muted">
              Watch how a small consumer demand ripple magnifies upstream from Retailer → Wholesaler → Distributor → Factory.
            </div>
          </div>
          {!revealedUpstream && (
            <span className="tiny mono" style={{ color: 'var(--red)', fontWeight: 700 }}>
              Showing Retailer only until Reveal
            </span>
          )}
        </div>
        <BullwhipChart
          history={activeSim.history}
          visibleWeeks={playWeekLimit}
          showAllTiers={revealedUpstream}
        />
      </div>

      {/* Tier-by-Tier League & Comparison Table */}
      {revealedUpstream && (
        <div className="card stack-sm" style={{ padding: 16 }}>
          <strong>Blind Mode vs. Shared POS Mode — Tier-by-Tier Quantitative Evidence</strong>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Supply Chain Tier</th>
                  <th className="mono" style={{ textAlign: 'right' }}>Blind Peak</th>
                  <th className="mono" style={{ textAlign: 'right' }}>Blind CV</th>
                  <th className="mono" style={{ textAlign: 'right' }}>Blind Bullwhip</th>
                  <th className="mono" style={{ textAlign: 'right' }}>Blind Cost</th>
                  <th className="mono" style={{ textAlign: 'right' }}>POS Peak</th>
                  <th className="mono" style={{ textAlign: 'right' }}>POS Bullwhip</th>
                  <th className="mono" style={{ textAlign: 'right' }}>POS Cost</th>
                </tr>
              </thead>
              <tbody>
                {TIER_KEYS.map((key, idx) => {
                  const bt = blindSim.metrics.tiers[idx];
                  const pt = posSim.metrics.tiers[idx];
                  return (
                    <tr key={key}>
                      <td className="small" style={{ fontWeight: 600 }}>
                        <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: TIER_COLORS[key], marginRight: 7 }} />
                        {TIER_LABELS[key]}
                      </td>
                      <td className="mono small" style={{ textAlign: 'right' }}>{bt.peak}</td>
                      <td className="mono small" style={{ textAlign: 'right' }}>{bt.cv}</td>
                      <td className="mono small" style={{ textAlign: 'right', fontWeight: 700, color: bt.bullwhipRatio >= 2 ? 'var(--red)' : 'var(--text)' }}>
                        {bt.bullwhipRatio}×
                      </td>
                      <td className="mono small" style={{ textAlign: 'right' }}>{bt.totalCost.toLocaleString()}</td>
                      <td className="mono small" style={{ textAlign: 'right', color: 'var(--teal-700)' }}>{pt.peak}</td>
                      <td className="mono small" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--teal-700)' }}>{pt.bullwhipRatio}×</td>
                      <td className="mono small" style={{ textAlign: 'right', color: 'var(--teal-700)' }}>{pt.totalCost.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Written Managerial Judgement */}
      <div className="card stack-sm" style={{ padding: 16 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong>Written Supply Chain Diagnosis (Required Deliverable)</strong>
            <div className="tiny muted">
              Cite the Factory Bullwhip Ratio and total chain cost in Blind Mode vs. Shared POS Mode, explain why rational local ordering amplified the +40% rumour spike, and specify what information system change you recommend.
            </div>
          </div>
          <span className="tiny mono muted">{judgement.trim().length} chars</span>
        </div>
        <textarea
          className="input"
          rows={5}
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
          placeholder="Example: Under Blind Mode, consumer demand only peaked at 56 units (+40%), yet upstream Factory orders amplified to ... with a Bullwhip Ratio of ...x. Switching to Shared POS Visibility reduced Factory amplification to ...x and cut total chain cost by ...%. Adding 1-week Paper-Mode delay further..."
        />
      </div>
    </div>
  );
}
