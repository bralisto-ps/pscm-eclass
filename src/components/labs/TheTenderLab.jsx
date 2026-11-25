import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { useToast } from '../ui.jsx';
import {
  buildLabCsvTemplate,
  getLabPreset,
  readLabSpreadsheetRows,
  THE_TENDER_PRESETS,
} from '../../lib/labsCatalog.js';
import {
  evaluateSealedTender,
  stepReverseAuctionRound,
} from '../../lib/psisMilestone3Engine.js';
import { downloadText } from '../../lib/sheets.js';

function fmtMoney(n, currency = 'GHS') {
  return `${currency} ${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function AuctionPriceChart({ rounds = [], ceiling = 500000, currency = 'GHS' }) {
  if (rounds.length < 2) return null;
  const width = 680;
  const height = 190;
  const padL = 62;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const prices = rounds.map((r) => r.leaderPrice);
  const minP = Math.floor(Math.min(...prices) * 0.94);
  const maxP = Math.ceil(Math.max(...prices, ceiling * 0.98) * 1.03);
  const span = Math.max(1, maxP - minP);

  const xAt = (i) => padL + (i / Math.max(1, rounds.length - 1)) * innerW;
  const yAt = (v) => padT + innerH - ((v - minP) / span) * innerH;
  const pts = rounds.map((r, i) => `${xAt(i).toFixed(1)},${yAt(r.leaderPrice).toFixed(1)}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 'auto', display: 'block', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--line-2)' }}
      role="img"
      aria-label="Reverse auction leading bid trajectory across rounds"
    >
      {[minP, Math.round((minP + maxP) / 2), maxP].map((tick) => {
        const y = yAt(tick);
        return (
          <g key={tick}>
            <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#6b7280" fontFamily="ui-monospace, monospace">
              {tick.toLocaleString()}
            </text>
          </g>
        );
      })}
      <polyline fill="none" stroke="#0f766e" strokeWidth="2.5" points={pts} />
      {rounds.map((r, i) => (
        <g key={r.round}>
          <circle cx={xAt(i)} cy={yAt(r.leaderPrice)} r="3.5" fill={r.belowQualityFloor ? '#dc2626' : '#0f766e'}>
            <title>{`Round ${r.round}: ${fmtMoney(r.leaderPrice, currency)} (${r.leaderName})`}</title>
          </circle>
          <text x={xAt(i)} y={height - 8} textAnchor="middle" fontSize="10" fill="#6b7280" fontFamily="ui-monospace, monospace">
            R{r.round}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function TheTenderLab({
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
    () => getLabPreset('psis_the_tender', config?.presetId) || THE_TENDER_PRESETS[0],
    [config?.presetId],
  );
  const initialSource = config?.customDataset?.bids?.length
    ? {
        name: config.customDataset.name || 'Lecturer Tender Dataset',
        currency: config.customDataset.currency || 'GHS',
        budgetCeiling: config.customDataset.budgetCeiling || Math.round(Math.max(...config.customDataset.bids.map((b) => Number(b.price) || 0)) * 1.1),
        weights: config.customDataset.weights || defaultPreset.weights,
        bids: config.customDataset.bids,
      }
    : defaultPreset;

  const [activeRoundTab, setActiveRoundTab] = useState(draftState?.activeRoundTab || 'sealed');
  const [lotName, setLotName] = useState(draftState?.lotName || initialSource.name);
  const [currency, setCurrency] = useState(draftState?.currency || initialSource.currency || 'GHS');
  const [budgetCeiling, setBudgetCeiling] = useState(draftState?.budgetCeiling ?? initialSource.budgetCeiling ?? 480000);
  const [weights, setWeights] = useState(() => draftState?.weights || { ...initialSource.weights });
  const [bids, setBids] = useState(() =>
    draftState?.bids?.length ? draftState.bids : initialSource.bids.map((b) => ({ ...b })),
  );
  const [boxOpened, setBoxOpened] = useState(Boolean(draftState?.boxOpened));

  // Add custom supplier bid form
  const [showAddBid, setShowAddBid] = useState(false);
  const [newBid, setNewBid] = useState({
    supplier: 'Custom Bidder Ltd',
    price: '410000',
    technicalScore: '82',
    leadTimeDays: '25',
    localContentScore: '75',
    reserveFloor: '375000',
  });

  // Round 2: Reverse Auction live state
  const initAuctionBids = (srcBids) =>
    [...srcBids]
      .map((b) => ({
        ...b,
        currentPrice: Number(b.price),
        active: true,
        droppedThisRound: false,
        belowQualityFloor: false,
      }))
      .sort((a, b) => a.currentPrice - b.currentPrice)
      .map((b, i) => ({ ...b, rank: i + 1 }));

  const [minDecrementPct, setMinDecrementPct] = useState(draftState?.minDecrementPct ?? 1.5);
  const [auctionRound, setAuctionRound] = useState(draftState?.auctionRound ?? 0);
  const [auctionBids, setAuctionBids] = useState(() =>
    draftState?.auctionBids?.length ? draftState.auctionBids : initAuctionBids(initialSource.bids),
  );
  const [auctionHistory, setAuctionHistory] = useState(() => {
    if (draftState?.auctionHistory?.length) return draftState.auctionHistory;
    const init = initAuctionBids(initialSource.bids);
    return init.length
      ? [{ round: 0, leaderName: init[0].supplier, leaderPrice: init[0].currentPrice, belowQualityFloor: false }]
      : [];
  });
  const [auctionConverged, setAuctionConverged] = useState(Boolean(draftState?.auctionConverged));
  const [judgement, setJudgement] = useState(draftState?.judgement || '');

  useEffect(() => {
    onDraftChange?.({
      activeRoundTab,
      lotName,
      currency,
      budgetCeiling,
      weights,
      bids,
      boxOpened,
      minDecrementPct,
      auctionRound,
      auctionBids,
      auctionHistory,
      auctionConverged,
      judgement,
    });
  }, [
    activeRoundTab,
    lotName,
    currency,
    budgetCeiling,
    weights,
    bids,
    boxOpened,
    minDecrementPct,
    auctionRound,
    auctionBids,
    auctionHistory,
    auctionConverged,
    judgement,
  ]);

  const sealedEval = useMemo(() => evaluateSealedTender(bids, weights), [bids, weights]);
  const auctionLeader = auctionBids[0] || null;
  const sealedWinnerPrice = sealedEval.winner?.price || 0;
  const auctionSavingsAmt = sealedWinnerPrice && auctionLeader ? sealedWinnerPrice - auctionLeader.currentPrice : 0;
  const auctionSavingsPct = sealedWinnerPrice > 0 ? (auctionSavingsAmt / sealedWinnerPrice) * 100 : 0;

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const lines = [
        `LABORATORY: PSIS Lab 6 — Sealed Tender Evaluation & Live Reverse Auction (The Tender)`,
        `PROCUREMENT LOT: ${lotName} (Budget Ceiling: ${fmtMoney(budgetCeiling, currency)})`,
        `WEIGHTED SCORING MODEL: Price ${sealedEval.normalizedWeights.price}% | Technical ${sealedEval.normalizedWeights.technical}% | Delivery ${sealedEval.normalizedWeights.delivery}% | Local Content ${sealedEval.normalizedWeights.localContent}%`,
        ``,
        `1. ROUND 1 — SEALED TENDER EVALUATION`,
        `- Tender Box Opened: ${boxOpened ? 'YES' : 'NO'}`,
        `- Recommended Best-Value Award: ${sealedEval.winner ? `${sealedEval.winner.supplier} (Score: ${sealedEval.winner.totalScore}/100 · Price: ${fmtMoney(sealedEval.winner.price, currency)})` : 'None'}`,
        `- Lowest-Price Bid: ${sealedEval.lowestPriceBid ? `${sealedEval.lowestPriceBid.supplier} (${fmtMoney(sealedEval.lowestPriceBid.price, currency)})` : 'None'}`,
        `- Best-Value Beat Lowest-Price Bidder: ${sealedEval.bestValueBeatLowestPrice ? 'YES' : 'NO'}`,
        ``,
        `SEALED BID RANKING TABLE:`,
        ...sealedEval.ranked.map(
          (b) => `#${b.rank} ${b.supplier} | Bid: ${fmtMoney(b.price, currency)} (PricePts ${b.weightedPrice}) | Tech: ${b.technicalScore} (${b.weightedTech}) | Lead: ${b.leadTimeDays}d (${b.weightedDelivery}) | Local: ${b.localContentScore} (${b.weightedLocal}) | TOTAL: ${b.totalScore}`,
        ),
        ``,
        `2. ROUND 2 — LIVE REVERSE AUCTION COMPARISON`,
        `- Auction Rounds Completed: ${auctionRound}${auctionConverged ? ' (Converged)' : ''}`,
        `- Reverse Auction Leader: ${auctionLeader ? `${auctionLeader.supplier} @ ${fmtMoney(auctionLeader.currentPrice, currency)}` : 'N/A'}`,
        `- Price Delta vs. Sealed Tender Winner: ${fmtMoney(auctionSavingsAmt, currency)} (${auctionSavingsPct.toFixed(1)}%)`,
        `- Winner’s Curse / Below-Sustainable-Cost Warning: ${auctionLeader?.belowQualityFloor ? 'TRIGGERED — Winning bid dropped below sustainable supplier cost floor!' : 'None triggered'}`,
        ``,
        `3. STUDENT WRITTEN SOURCING & AWARD JUDGEMENT`,
        judgement.trim() || '(No written judgement provided yet.)',
      ];
      return {
        title: `Tender Evaluation & Reverse Auction Report — ${lotName}`,
        body: lines.join('\n'),
        hasJudgement: judgement.trim().length >= 25,
      };
    });
  }, [
    onRegisterReportBuilder,
    lotName,
    currency,
    budgetCeiling,
    sealedEval,
    boxOpened,
    auctionRound,
    auctionConverged,
    auctionLeader,
    auctionSavingsAmt,
    auctionSavingsPct,
    judgement,
  ]);

  function resetAuctionFromBids(srcBids = bids) {
    const init = initAuctionBids(srcBids);
    setAuctionRound(0);
    setAuctionBids(init);
    setAuctionConverged(false);
    setAuctionHistory(
      init.length
        ? [{ round: 0, leaderName: init[0].supplier, leaderPrice: init[0].currentPrice, belowQualityFloor: false }]
        : [],
    );
  }

  function handlePresetChange(pid) {
    const found = THE_TENDER_PRESETS.find((p) => p.id === pid);
    if (!found) return;
    setLotName(found.name);
    setCurrency(found.currency || 'GHS');
    setBudgetCeiling(found.budgetCeiling || 400000);
    setWeights({ ...found.weights });
    const nextBids = found.bids.map((b) => ({ ...b }));
    setBids(nextBids);
    setBoxOpened(false);
    resetAuctionFromBids(nextBids);
    toast(`Loaded procurement lot "${found.name}".`);
  }

  function handleAddCustomBid(e) {
    e.preventDefault();
    const price = Math.max(1, Number(newBid.price) || 100000);
    const floor = Math.max(1, Number(newBid.reserveFloor) || Math.round(price * 0.88));
    const entry = {
      id: `cb_${Date.now()}`,
      supplier: newBid.supplier.trim() || `Supplier ${bids.length + 1}`,
      price,
      technicalScore: Math.max(0, Math.min(100, Number(newBid.technicalScore) || 75)),
      leadTimeDays: Math.max(1, Number(newBid.leadTimeDays) || 20),
      localContentScore: Math.max(0, Math.min(100, Number(newBid.localContentScore) || 60)),
      reserveFloor: floor,
      sustainableCost: Math.round(floor * 1.04),
      aggressiveness: 0.7,
    };
    const next = [...bids, entry];
    setBids(next);
    resetAuctionFromBids(next);
    setShowAddBid(false);
    toast(`Added sealed bid from "${entry.supplier}".`);
  }

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readLabSpreadsheetRows(file);
      const parsed = [];
      rows.forEach((r, idx) => {
        if (r.length < 4) return;
        const price = Number(String(r[1]).replace(/[^0-9.-]/g, ''));
        if (idx === 0 && !Number.isFinite(price)) return;
        if (!Number.isFinite(price) || price <= 0) return;
        const tech = Number(String(r[2]).replace(/[^0-9.-]/g, ''));
        const days = Number(String(r[3]).replace(/[^0-9.-]/g, ''));
        const local = Number(String(r[4] ?? '70').replace(/[^0-9.-]/g, ''));
        const floor = Number(String(r[5] ?? Math.round(price * 0.88)).replace(/[^0-9.-]/g, ''));
        parsed.push({
          id: `csv_b_${idx}_${Date.now()}`,
          supplier: String(r[0] || `Bidder ${idx + 1}`).trim(),
          price,
          technicalScore: Number.isFinite(tech) ? Math.max(0, Math.min(100, tech)) : 75,
          leadTimeDays: Number.isFinite(days) && days > 0 ? days : 21,
          localContentScore: Number.isFinite(local) ? Math.max(0, Math.min(100, local)) : 70,
          reserveFloor: Number.isFinite(floor) && floor > 0 ? floor : Math.round(price * 0.88),
          sustainableCost: Math.round((Number.isFinite(floor) && floor > 0 ? floor : price * 0.88) * 1.04),
          aggressiveness: 0.65 + (idx % 3) * 0.1,
        });
      });
      if (parsed.length < 2) throw new Error('Upload at least 2 supplier bids using the CSV template.');
      setLotName(file.name.replace(/\.[^.]+$/, ''));
      setBids(parsed);
      setBudgetCeiling(Math.round(Math.max(...parsed.map((b) => b.price)) * 1.1));
      setBoxOpened(false);
      resetAuctionFromBids(parsed);
      toast(`Imported ${parsed.length} supplier bids from "${file.name}".`);
    } catch (err) {
      toast(err.message || 'Could not import tender bids CSV.', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function handleNextAuctionRound() {
    if (auctionConverged) {
      toast('Reverse auction has converged — no trailing bidder can profitably undercut the leader.');
      return;
    }
    const nextRoundNum = auctionRound + 1;
    const res = stepReverseAuctionRound({
      currentBids: auctionBids,
      minDecrementPct,
      roundNumber: nextRoundNum,
    });
    setAuctionRound(nextRoundNum);
    setAuctionBids(res.bids);
    setAuctionConverged(res.converged);
    if (res.leader) {
      setAuctionHistory((prev) => [
        ...prev,
        {
          round: nextRoundNum,
          leaderName: res.leader.supplier,
          leaderPrice: res.leader.currentPrice,
          belowQualityFloor: Boolean(res.leader.belowQualityFloor),
        },
      ]);
    }
    if (res.converged) {
      toast(`Auction closed at Round ${nextRoundNum} — Winner: ${res.leader?.supplier} (${fmtMoney(res.leader?.currentPrice, currency)}).`);
    }
  }

  function handleRunAuctionToEnd() {
    let curBids = auctionBids;
    let curRound = auctionRound;
    let hist = [...auctionHistory];
    let converged = auctionConverged;
    let safety = 0;
    while (!converged && safety < 25) {
      safety += 1;
      curRound += 1;
      const res = stepReverseAuctionRound({ currentBids: curBids, minDecrementPct, roundNumber: curRound });
      curBids = res.bids;
      converged = res.converged;
      if (res.leader) {
        hist.push({
          round: curRound,
          leaderName: res.leader.supplier,
          leaderPrice: res.leader.currentPrice,
          belowQualityFloor: Boolean(res.leader.belowQualityFloor),
        });
      }
    }
    setAuctionRound(curRound);
    setAuctionBids(curBids);
    setAuctionHistory(hist);
    setAuctionConverged(true);
    toast(`Reverse auction converged at Round ${curRound}.`);
  }

  function exportEvaluationCsv() {
    const header = 'Rank,Supplier,SealedBidPrice,TechnicalScore,LeadTimeDays,LocalContentScore,TotalWeightedScore,AuctionFinalPrice';
    const body = sealedEval.ranked.map((b) => {
      const ab = auctionBids.find((x) => x.id === b.id);
      return [
        b.rank,
        `"${String(b.supplier).replace(/"/g, '""')}"`,
        b.price,
        b.technicalScore,
        b.leadTimeDays,
        b.localContentScore,
        b.totalScore,
        ab ? ab.currentPrice : '',
      ].join(',');
    });
    downloadText('tender-evaluation-report.csv', [header, ...body].join('\n'));
  }

  return (
    <div className="stack">
      {/* Top Bar */}
      <div className="card stack-sm" style={{ padding: 14 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="tiny muted">STRATEGIC E-SOURCING &amp; BID EVALUATION · {lotName}</div>
            <div className="small" style={{ marginTop: 2 }}>
              Run Round 1 as a transparent weighted Sealed Tender, then run Round 2 as a live Reverse Auction on the exact same lot to evaluate savings vs. quality risk.
            </div>
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            {canEditData && (
              <>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleCsvUpload} />
                <select
                  className="input"
                  style={{ width: 'auto', minWidth: 220, padding: '6px 10px', fontSize: 13 }}
                  value={THE_TENDER_PRESETS.some((p) => p.name === lotName) ? (THE_TENDER_PRESETS.find((p) => p.name === lotName)?.id || '') : ''}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  aria-label="Procurement Lot Preset"
                >
                  <option value="" disabled>Custom Tender Lot</option>
                  {THE_TENDER_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const tpl = buildLabCsvTemplate('psis_the_tender');
                    downloadText(tpl.filename, tpl.content);
                  }}
                >
                  <Icon name="download" size={13} /> CSV Template
                </button>
                <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={13} /> Upload Bids CSV
                </button>
              </>
            )}
            <button type="button" className="btn btn-sm" onClick={exportEvaluationCsv}>
              <Icon name="download" size={13} /> Export Evaluation CSV
            </button>
          </div>
        </div>

        <div className="row-wrap" style={{ gap: 6, paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
          <button
            type="button"
            className={`btn btn-sm ${activeRoundTab === 'sealed' ? 'btn-primary' : ''}`}
            onClick={() => setActiveRoundTab('sealed')}
          >
            Round 1: Sealed Weighted Tender ({bids.length} bids)
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeRoundTab === 'auction' ? 'btn-primary' : ''}`}
            onClick={() => setActiveRoundTab('auction')}
          >
            Round 2: Live Reverse Auction (Round {auctionRound})
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* ROUND 1: SEALED WEIGHTED TENDER                                       */}
      {/* ===================================================================== */}
      {activeRoundTab === 'sealed' && (
        <div className="stack">
          {/* Published Evaluation Weights */}
          <div className="card stack-sm" style={{ padding: 14 }}>
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>Published Evaluation Scoring Weights</strong>
                <div className="tiny muted">
                  Adjust criteria weights to test sensitivity (auto-normalized to 100%). Set weights before opening the sealed tender box!
                </div>
              </div>
              <span className="tiny mono muted">
                Normalized Sum: <strong>100%</strong> (Raw: {sealedEval.weightSum})
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {[
                { key: 'price', label: 'Commercial Price' },
                { key: 'technical', label: 'Technical Spec' },
                { key: 'delivery', label: 'Delivery Speed' },
                { key: 'localContent', label: 'Local Support / ESG' },
              ].map((w) => (
                <label key={w.key} className="card-soft stack-xs tiny" style={{ padding: 10 }}>
                  <div className="between">
                    <span>{w.label}</span>
                    <strong className="mono">{sealedEval.normalizedWeights[w.key]}%</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="80"
                    step="5"
                    value={weights[w.key]}
                    onChange={(e) => setWeights((prev) => ({ ...prev, [w.key]: Number(e.target.value) }))}
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Sealed Tender Box / Evaluation Table */}
          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong>Sealed Tender Box ({bids.length} Compliant Bids Submitted)</strong>
                <div className="tiny muted">Budget Ceiling: <span className="mono">{fmtMoney(budgetCeiling, currency)}</span></div>
              </div>
              <div className="row-wrap" style={{ gap: 6 }}>
                {canEditData && (
                  <button type="button" className="btn btn-sm" onClick={() => setShowAddBid((v) => !v)}>
                    <Icon name="plus" size={13} /> Add Bidder
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setBoxOpened((v) => !v);
                    if (!boxOpened) toast('Sealed tender box opened and evaluated against published weights.');
                  }}
                >
                  <Icon name={boxOpened ? 'lock' : 'check'} size={13} />
                  {boxOpened ? 'Re-Seal Tender Box' : 'Open Sealed Tender Box & Score Bids'}
                </button>
              </div>
            </div>

            {showAddBid && canEditData && (
              <form onSubmit={handleAddCustomBid} className="card-soft stack-sm" style={{ padding: 12 }}>
                <strong className="small">Submit Additional Sealed Supplier Bid</strong>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 8 }}>
                  <label className="stack-xs tiny muted">Supplier<input className="input" value={newBid.supplier} onChange={(e) => setNewBid({ ...newBid, supplier: e.target.value })} required /></label>
                  <label className="stack-xs tiny muted">Bid Price ({currency})<input className="input mono" type="number" value={newBid.price} onChange={(e) => setNewBid({ ...newBid, price: e.target.value })} required /></label>
                  <label className="stack-xs tiny muted">Tech Score (0–100)<input className="input mono" type="number" min="0" max="100" value={newBid.technicalScore} onChange={(e) => setNewBid({ ...newBid, technicalScore: e.target.value })} /></label>
                  <label className="stack-xs tiny muted">Lead Time (Days)<input className="input mono" type="number" min="1" value={newBid.leadTimeDays} onChange={(e) => setNewBid({ ...newBid, leadTimeDays: e.target.value })} /></label>
                  <label className="stack-xs tiny muted">Local Support (0–100)<input className="input mono" type="number" min="0" max="100" value={newBid.localContentScore} onChange={(e) => setNewBid({ ...newBid, localContentScore: e.target.value })} /></label>
                  <label className="stack-xs tiny muted">Private Cost Floor<input className="input mono" type="number" value={newBid.reserveFloor} onChange={(e) => setNewBid({ ...newBid, reserveFloor: e.target.value })} /></label>
                </div>
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-sm" onClick={() => setShowAddBid(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary btn-sm">Seal &amp; Add Bid</button>
                </div>
              </form>
            )}

            {!boxOpened ? (
              <div className="card-soft stack-sm" style={{ padding: 20, textAlign: 'center' }}>
                <div className="mono small" style={{ fontWeight: 700, color: 'var(--teal-700)' }}>
                  ● SEALED TENDER BOX LOCKED — {bids.length} ENCRYPTED BIDS RECEIVED
                </div>
                <div className="small muted">
                  All bid prices and technical scores remain invisible until the tender opening deadline. Finalize your evaluation weights above, then click <strong>Open Sealed Tender Box &amp; Score Bids</strong>.
                </div>
              </div>
            ) : (
              <div className="stack-sm">
                {sealedEval.winner && (
                  <div className="notice small">
                    <strong className="mono">
                      ● RECOMMENDED AWARD: {sealedEval.winner.supplier.toUpperCase()} — {sealedEval.winner.totalScore}/100 PTS ({fmtMoney(sealedEval.winner.price, currency)})
                    </strong>
                    <div style={{ marginTop: 4 }}>
                      {sealedEval.bestValueBeatLowestPrice
                        ? `Notice: ${sealedEval.winner.supplier} won on Best Value even though ${sealedEval.lowestPriceBid.supplier} submitted a lower price (${fmtMoney(sealedEval.lowestPriceBid.price, currency)}) because of stronger technical, delivery, and local support scores.`
                        : `${sealedEval.winner.supplier} achieved both the highest weighted score and the most competitive bid price.`}
                    </div>
                  </div>
                )}

                <div style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Supplier</th>
                        <th className="mono" style={{ textAlign: 'right' }}>Bid Price</th>
                        <th className="mono" style={{ textAlign: 'right' }}>Price Pts</th>
                        <th className="mono" style={{ textAlign: 'right' }}>Tech ({sealedEval.normalizedWeights.technical}%)</th>
                        <th className="mono" style={{ textAlign: 'right' }}>Lead Time</th>
                        <th className="mono" style={{ textAlign: 'right' }}>Local ({sealedEval.normalizedWeights.localContent}%)</th>
                        <th className="mono" style={{ textAlign: 'right' }}>Total Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sealedEval.ranked.map((b) => (
                        <tr key={b.id} style={b.rank === 1 ? { background: 'var(--teal-50)' } : undefined}>
                          <td className="mono small" style={{ fontWeight: 700 }}>#{b.rank}</td>
                          <td className="small" style={{ fontWeight: b.rank === 1 ? 700 : 500 }}>
                            {b.supplier}
                            {b.rank === 1 && (
                              <span className="tiny mono" style={{ marginLeft: 6, color: 'var(--teal-700)' }}>● WINNER</span>
                            )}
                          </td>
                          <td className="mono small" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtMoney(b.price, currency)}</td>
                          <td className="mono small" style={{ textAlign: 'right' }}>{b.weightedPrice}</td>
                          <td className="mono small" style={{ textAlign: 'right' }}>{b.technicalScore} ({b.weightedTech})</td>
                          <td className="mono small" style={{ textAlign: 'right' }}>{b.leadTimeDays}d ({b.weightedDelivery})</td>
                          <td className="mono small" style={{ textAlign: 'right' }}>{b.localContentScore} ({b.weightedLocal})</td>
                          <td className="mono small" style={{ textAlign: 'right', fontWeight: 700, color: b.rank === 1 ? 'var(--teal-700)' : 'var(--text)' }}>
                            {b.totalScore}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* ROUND 2: LIVE REVERSE AUCTION                                         */}
      {/* ===================================================================== */}
      {activeRoundTab === 'auction' && (
        <div className="stack">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">SEALED WINNER PRICE</div>
              <div className="kpi mono" style={{ fontSize: 19, marginTop: 4 }}>{fmtMoney(sealedWinnerPrice, currency)}</div>
              <div className="tiny muted">{sealedEval.winner?.supplier || '—'}</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">AUCTION LEADING BID</div>
              <div className="kpi mono" style={{ fontSize: 19, marginTop: 4, color: 'var(--teal-700)' }}>
                {auctionLeader ? fmtMoney(auctionLeader.currentPrice, currency) : '—'}
              </div>
              <div className="tiny muted">{auctionLeader?.supplier || '—'} (Round {auctionRound})</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">PRICE COMPRESSION</div>
              <div className="kpi mono" style={{ fontSize: 19, marginTop: 4, color: auctionSavingsAmt > 0 ? 'var(--teal-700)' : 'var(--text)' }}>
                {auctionSavingsPct.toFixed(1)}%
              </div>
              <div className="tiny muted">{fmtMoney(auctionSavingsAmt, currency)} vs. Sealed Award</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">QUALITY / DEFAULT RISK</div>
              <div
                className="mono small"
                style={{
                  fontWeight: 700,
                  marginTop: 8,
                  color: auctionLeader?.belowQualityFloor ? 'var(--red)' : 'var(--teal-700)',
                }}
              >
                {auctionLeader?.belowQualityFloor ? '▲ WINNER’S CURSE RISK' : '● SUSTAINABLE MARGIN'}
              </div>
              <div className="tiny muted" style={{ marginTop: 4 }}>
                {auctionLeader?.belowQualityFloor ? 'Bid below sustainable cost' : 'Above delivery cost floor'}
              </div>
            </div>
          </div>

          <div className="lab-split-grid">
            <div className="card stack-sm" style={{ padding: 16 }}>
              <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>Live Reverse Auction Console</strong>
                  <div className="tiny muted">Bidders see real-time rank and undercut the leading price until only one bidder remains above their reserve floor.</div>
                </div>
                <label className="row tiny muted" style={{ gap: 6 }}>
                  Min Step (%):
                  <input
                    className="input mono"
                    type="number"
                    min="0.5"
                    max="5"
                    step="0.5"
                    style={{ width: 64, padding: '4px 6px' }}
                    value={minDecrementPct}
                    onChange={(e) => setMinDecrementPct(Math.max(0.5, Number(e.target.value) || 1.5))}
                  />
                </label>
              </div>

              <div className="row-wrap" style={{ gap: 6 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={auctionConverged} onClick={handleNextAuctionRound}>
                  Step Round {auctionRound + 1} →
                </button>
                <button type="button" className="btn btn-sm" disabled={auctionConverged} onClick={handleRunAuctionToEnd}>
                  Auto-Run to Close
                </button>
                <button type="button" className="btn btn-sm" onClick={() => resetAuctionFromBids(bids)}>
                  Reset Auction
                </button>
              </div>

              {auctionLeader?.belowQualityFloor && (
                <div className="notice-err small">
                  <strong className="mono">▲ WINNER’S CURSE WARNING: BELOW SUSTAINABLE COST</strong>
                  <div style={{ marginTop: 4 }}>
                    {auctionLeader.supplier} bid down to {fmtMoney(auctionLeader.currentPrice, currency)} (below estimated sustainable cost of {fmtMoney(auctionLeader.sustainableCost, currency)}). In real supply chains, awarding solely on lowest reverse-auction price here creates high risk of sub-standard components, warranty disputes, or contract default.
                  </div>
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Supplier</th>
                      <th className="mono" style={{ textAlign: 'right' }}>Start Bid</th>
                      <th className="mono" style={{ textAlign: 'right' }}>Current Bid</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auctionBids.map((b) => (
                      <tr key={b.id} style={b.rank === 1 ? { background: 'var(--teal-50)' } : undefined}>
                        <td className="mono small" style={{ fontWeight: 700 }}>#{b.rank}</td>
                        <td className="small">
                          <div style={{ fontWeight: b.rank === 1 ? 700 : 500 }}>{b.supplier}</div>
                          <div className="tiny muted">Tech: {b.technicalScore}/100 · Lead: {b.leadTimeDays}d</div>
                        </td>
                        <td className="mono tiny muted" style={{ textAlign: 'right' }}>{fmtMoney(b.price, currency)}</td>
                        <td className="mono small" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(b.currentPrice, currency)}</td>
                        <td className="mono tiny" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {b.rank === 1 ? (
                            <span style={{ color: b.belowQualityFloor ? 'var(--red)' : 'var(--teal-700)' }}>
                              {b.belowQualityFloor ? '▲ LEADER (LOW COST RISK)' : '● LEADING'}
                            </span>
                          ) : b.active ? (
                            <span style={{ color: 'var(--text)' }}>ACTIVE</span>
                          ) : (
                            <span className="muted">DROPPED OUT</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card stack-sm" style={{ padding: 16 }}>
              <strong>Leading Price Trajectory Across Rounds</strong>
              {auctionHistory.length < 2 ? (
                <div className="card-soft small muted" style={{ padding: 16 }}>
                  Click <strong>Step Round 1</strong> or <strong>Auto-Run to Close</strong> to watch competitive price drops build live across rounds.
                </div>
              ) : (
                <AuctionPriceChart rounds={auctionHistory} ceiling={budgetCeiling} currency={currency} />
              )}
              <div className="tiny muted">
                Tip: Compare the final auction leader’s technical score against the Sealed Tender winner’s technical score before deciding which sourcing method fits this item!
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WRITTEN JUDGEMENT */}
      <div className="card stack-sm" style={{ padding: 16 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong>Written Award &amp; e-Sourcing Strategy Judgement (Required Deliverable)</strong>
            <div className="tiny muted">
              Defend your recommended supplier award, explain how criteria weights shifted the Sealed Tender outcome, and evaluate whether a Reverse Auction is appropriate for this specification given quality and default risk.
            </div>
          </div>
          <span className="tiny mono muted">{judgement.trim().length} chars</span>
        </div>
        <textarea
          className="input"
          rows={5}
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
          placeholder="Example: Under the published 45/30/15/10 weights, SolarMed Engineering won the Sealed Tender on Best Value despite LowCost Global Imports bidding lower on price. In Round 2, the Reverse Auction compressed the leading price by ...%, but triggered a Winner's Curse quality risk warning..."
        />
      </div>
    </div>
  );
}
