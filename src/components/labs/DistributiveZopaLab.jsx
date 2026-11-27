import { useEffect, useMemo, useState } from 'react';
import { getLabPreset } from '../../lib/labsCatalog.js';
import {
  analyzeDistributiveZopa,
  evaluateCounterpartOffer,
} from '../../lib/labNegotiationEngine.js';

export default function DistributiveZopaLab({
  config,
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const baseDataset = useMemo(
    () => config?.customDataset || getLabPreset('neg_zopa_batna', config?.presetId) || {},
    [config?.customDataset, config?.presetId],
  );
  const currency = baseDataset.currency || 'GHS';

  const [buyerBatna, setBuyerBatna] = useState(() => Number(draftState?.buyerBatna ?? baseDataset.buyerBatna ?? 1180));
  const [buyerSwitchingCost, setBuyerSwitchingCost] = useState(() => Number(draftState?.buyerSwitchingCost ?? baseDataset.buyerSwitchingCost ?? 60));
  const [buyerTarget, setBuyerTarget] = useState(() => Number(draftState?.buyerTarget ?? baseDataset.buyerTarget ?? 980));
  const [buyerAnchor, setBuyerAnchor] = useState(() => Number(draftState?.buyerAnchor ?? baseDataset.buyerAnchor ?? 910));
  const [supplierCost, setSupplierCost] = useState(() => Number(draftState?.supplierCost ?? baseDataset.supplierCost ?? 820));
  const [supplierMinMarginPct, setSupplierMinMarginPct] = useState(() => Number(draftState?.supplierMinMarginPct ?? baseDataset.supplierMinMarginPct ?? 12));
  const [supplierAltOffer, setSupplierAltOffer] = useState(() => Number(draftState?.supplierAltOffer ?? baseDataset.supplierAltOffer ?? 910));
  const [supplierAnchor, setSupplierAnchor] = useState(() => Number(draftState?.supplierAnchor ?? baseDataset.supplierAnchor ?? 1290));
  const [quantity, setQuantity] = useState(() => Number(draftState?.quantity ?? baseDataset.quantity ?? 500));
  const [persona, setPersona] = useState(() => String(draftState?.persona || 'firm_anchorer'));
  const [offerInput, setOfferInput] = useState(() => String(draftState?.offerInput ?? buyerAnchor));
  const [rounds, setRounds] = useState(() => (Array.isArray(draftState?.rounds) ? draftState.rounds : []));
  const [dealStatus, setDealStatus] = useState(() => String(draftState?.dealStatus || 'open')); // open | accepted | impasse | walked_away
  const [agreedPrice, setAgreedPrice] = useState(() => (draftState?.agreedPrice ?? null));
  const [judgement, setJudgement] = useState(() => String(draftState?.judgement || ''));

  useEffect(() => {
    onDraftChange?.({
      buyerBatna,
      buyerSwitchingCost,
      buyerTarget,
      buyerAnchor,
      supplierCost,
      supplierMinMarginPct,
      supplierAltOffer,
      supplierAnchor,
      quantity,
      persona,
      offerInput,
      rounds,
      dealStatus,
      agreedPrice,
      judgement,
    });
  }, [
    buyerBatna, buyerSwitchingCost, buyerTarget, buyerAnchor,
    supplierCost, supplierMinMarginPct, supplierAltOffer, supplierAnchor,
    quantity, persona, offerInput, rounds, dealStatus, agreedPrice, judgement,
  ]);

  const zopa = useMemo(
    () =>
      analyzeDistributiveZopa({
        buyerBatna,
        buyerSwitchingCost,
        buyerTarget,
        buyerAnchor,
        supplierCost,
        supplierMinMarginPct,
        supplierAltOffer,
        supplierAnchor,
        agreedPrice,
        quantity,
      }),
    [buyerBatna, buyerSwitchingCost, buyerTarget, buyerAnchor, supplierCost, supplierMinMarginPct, supplierAltOffer, supplierAnchor, agreedPrice, quantity],
  );

  const lastSupplierAsk = rounds.length ? rounds[rounds.length - 1].supplierCounter : supplierAnchor;

  function submitBuyerOffer() {
    if (dealStatus !== 'open') return;
    const nextRound = rounds.length + 1;
    const res = evaluateCounterpartOffer({
      offerPrice: Number(offerInput),
      round: nextRound,
      maxRounds: 6,
      persona,
      supplierReservation: zopa.supplierReservation,
      supplierAnchor,
      lastSupplierOffer: lastSupplierAsk,
    });
    if (res.status === 'invalid') return;
    const entry = {
      round: nextRound,
      buyerOffer: Number(offerInput),
      supplierCounter: res.supplierCounter,
      status: res.status,
      message: res.message,
    };
    setRounds((prev) => [...prev, entry]);
    if (res.status === 'accepted') {
      setDealStatus('accepted');
      setAgreedPrice(res.agreedPrice);
    } else if (res.status === 'impasse') {
      setDealStatus('impasse');
    }
  }

  function acceptSupplierAsk() {
    if (dealStatus !== 'open') return;
    setAgreedPrice(lastSupplierAsk);
    setDealStatus('accepted');
    setRounds((prev) => [
      ...prev,
      {
        round: prev.length + 1,
        buyerOffer: lastSupplierAsk,
        supplierCounter: lastSupplierAsk,
        status: 'accepted',
        message: `Buyer accepted supplier ask at ${currency} ${lastSupplierAsk.toLocaleString()}.`,
      },
    ]);
  }

  function walkAwayBatna() {
    if (dealStatus !== 'open') return;
    setDealStatus('walked_away');
    setAgreedPrice(null);
  }

  function resetTable() {
    setRounds([]);
    setDealStatus('open');
    setAgreedPrice(null);
    setOfferInput(String(buyerAnchor));
  }

  const wordCount = judgement.trim() ? judgement.trim().split(/\s+/).length : 0;
  const quantChecks = [
    zopa.buyerReservation > 0 && zopa.supplierReservation > 0,
    rounds.length >= 2 || dealStatus !== 'open',
    dealStatus === 'accepted'
      ? Boolean(zopa.dealMetrics?.withinZopa)
      : dealStatus === 'walked_away' || dealStatus === 'impasse'
        ? !zopa.zopaExists || lastSupplierAsk > zopa.buyerReservation
        : false,
    buyerAnchor < zopa.buyerReservation,
  ];
  const quantPassed = quantChecks.filter(Boolean).length;

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const lines = [
        'LABORATORY: NEG-LAB 01 — Distributive Bargaining, BATNA & ZOPA Dynamics',
        `Scenario: ${baseDataset.name || 'Procurement Price Negotiation'} (${currency}, Qty ${quantity})`,
        `Auto-Verification Score: ${Math.round((quantPassed / quantChecks.length) * 100)}% (${quantPassed}/${quantChecks.length} checks) | Judgement: ${wordCount >= 40 ? 'PASS' : 'REVIEW'} (${wordCount} words)`,
        '',
        'KEY VERIFIED ZOPA & BATNA METRICS',
        `- Buyer Reservation Price (BATNA + Switching): ${currency} ${zopa.buyerReservation.toLocaleString()}`,
        `- Supplier Reservation Floor: ${currency} ${zopa.supplierReservation.toLocaleString()}`,
        `- ZOPA Exists: ${zopa.zopaExists ? `YES (${currency} ${zopa.zopaLow.toLocaleString()} to ${currency} ${zopa.zopaHigh.toLocaleString()}, Width ${currency} ${zopa.zopaWidth.toLocaleString()})` : `NO (Negative Zone Gap: ${currency} ${zopa.zopaWidth.toLocaleString()})`}`,
        `- Counterpart Persona: ${persona} | Bargaining Outcome: ${dealStatus.toUpperCase()}`,
        ...(zopa.dealMetrics
          ? [
              `- Agreed Unit Price: ${currency} ${zopa.dealMetrics.agreedPrice.toLocaleString()} (${zopa.dealMetrics.verdict})`,
              `- Buyer Surplus Share: ${zopa.dealMetrics.buyerSharePct}% (${currency} ${zopa.dealMetrics.buyerTotalSavings.toLocaleString()} total savings vs. BATNA)`,
            ]
          : ['- Agreed Unit Price: No Agreement (Walked to BATNA / Impasse)']),
        '',
        'ROUND-BY-ROUND BARGAINING LOG',
        ...(rounds.length
          ? rounds.map((r) => `• Round ${r.round}: Buyer ${currency} ${r.buyerOffer} -> Supplier ${currency} ${r.supplierCounter} [${r.status}]`)
          : ['• No rounds played yet.']),
        '',
        'MANAGERIAL JUDGEMENT & NEGOTIATION DEBRIEF',
        judgement.trim() || '(No written managerial judgement provided.)',
      ];
      return {
        title: 'NEG-LAB 01 — Distributive Bargaining, BATNA & ZOPA Report',
        body: lines.join('\n'),
        hasJudgement: wordCount >= 30,
      };
    });
  }, [baseDataset.name, currency, quantity, zopa, persona, dealStatus, rounds, judgement, wordCount, quantPassed]);

  // SVG ZOPA Spectrum coordinates
  const minVal = Math.min(buyerAnchor, zopa.supplierReservation, zopa.buyerReservation, supplierAnchor, agreedPrice ?? buyerAnchor) * 0.9;
  const maxVal = Math.max(buyerAnchor, zopa.supplierReservation, zopa.buyerReservation, supplierAnchor, agreedPrice ?? supplierAnchor) * 1.06;
  const span = Math.max(1, maxVal - minVal);
  const xOf = (v) => 44 + ((v - minVal) / span) * 572;

  return (
    <div className="stack">
      {/* KPI Summary Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10 }}>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Buyer Reservation (Ceiling)</div>
          <div className="kpi mono" style={{ fontSize: 20, marginTop: 4 }}>{currency} {zopa.buyerReservation.toLocaleString()}</div>
          <div className="tiny muted">BATNA + switching cost</div>
        </div>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Supplier Floor (Estimate)</div>
          <div className="kpi mono" style={{ fontSize: 20, marginTop: 4 }}>{currency} {zopa.supplierReservation.toLocaleString()}</div>
          <div className="tiny muted">Cost + min margin / alt offer</div>
        </div>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Zone of Possible Agreement</div>
          <div className="kpi mono" style={{ fontSize: 20, marginTop: 4, color: zopa.zopaExists ? 'var(--teal-700)' : 'var(--red)' }}>
            {zopa.zopaExists ? `${currency} ${zopa.zopaWidth.toLocaleString()}` : 'NEGATIVE ZOPA'}
          </div>
          <div className="tiny muted">
            {zopa.zopaExists ? `Midpoint: ${currency} ${zopa.midpoint.toLocaleString()}` : 'Walk away or create value'}
          </div>
        </div>
        <div className="card-soft" style={{ padding: 12 }}>
          <div className="tiny muted">Deal Outcome &amp; Capture</div>
          <div className="kpi mono" style={{ fontSize: 20, marginTop: 4, color: zopa.dealMetrics?.withinZopa ? 'var(--teal-700)' : 'var(--amber)' }}>
            {zopa.dealMetrics ? `${currency} ${zopa.dealMetrics.agreedPrice.toLocaleString()}` : dealStatus.toUpperCase()}
          </div>
          <div className="tiny muted">
            {zopa.dealMetrics ? `Buyer surplus: ${zopa.dealMetrics.buyerSharePct}%` : `${rounds.length} / 6 rounds`}
          </div>
        </div>
      </div>

      {/* Live ZOPA Spectrum SVG Chart */}
      <section className="card stack-xs">
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>ZOPA Spectrum, Anchors &amp; Settlement Map</h3>
          <span className="tiny mono muted">{zopa.zopaExists ? '● POSITIVE BARGAINING ZONE' : '▲ IMPASSE ZONE (NO PRICE OVERLAP)'}</span>
        </div>
        <svg viewBox="0 0 660 155" style={{ width: '100%', height: 'auto', display: 'block' }}>
          <line x1="44" x2="616" y1="82" y2="82" stroke="#cbd5e1" strokeWidth="4" strokeLinecap="round" />
          {zopa.zopaExists ? (
            <rect
              x={xOf(zopa.zopaLow)}
              y="62"
              width={Math.max(4, xOf(zopa.zopaHigh) - xOf(zopa.zopaLow))}
              height="40"
              rx="6"
              fill="#0f766e"
              fillOpacity="0.18"
              stroke="#0f766e"
              strokeWidth="1.6"
            />
          ) : (
            <rect
              x={xOf(zopa.zopaLow)}
              y="62"
              width={Math.max(4, xOf(zopa.zopaHigh) - xOf(zopa.zopaLow))}
              height="40"
              rx="6"
              fill="#dc2626"
              fillOpacity="0.15"
              stroke="#dc2626"
              strokeWidth="1.6"
              strokeDasharray="4 3"
            />
          )}
          {[
            { label: `B-Anchor ${buyerAnchor}`, val: buyerAnchor, y: 34, color: '#2563eb' },
            { label: `S-Floor ${zopa.supplierReservation}`, val: zopa.supplierReservation, y: 134, color: '#0f766e' },
            { label: `B-Max ${zopa.buyerReservation}`, val: zopa.buyerReservation, y: 134, color: '#6d28d9' },
            { label: `S-Anchor ${supplierAnchor}`, val: supplierAnchor, y: 34, color: '#d97706' },
          ].map((m, idx) => (
            <g key={idx}>
              <line x1={xOf(m.val)} x2={xOf(m.val)} y1="54" y2="110" stroke={m.color} strokeWidth="2" />
              <circle cx={xOf(m.val)} cy="82" r="5" fill={m.color} />
              <text x={xOf(m.val)} y={m.y} textAnchor="middle" fontSize="10" fontWeight="700" fill={m.color} fontFamily="monospace">
                {m.label}
              </text>
            </g>
          ))}
          {zopa.dealMetrics && (
            <g>
              <circle cx={xOf(zopa.dealMetrics.agreedPrice)} cy="82" r="7.5" fill="#10b981" stroke="#064e3b" strokeWidth="2" />
              <text x={xOf(zopa.dealMetrics.agreedPrice)} y="52" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#065f46" fontFamily="monospace">
                DEAL {zopa.dealMetrics.agreedPrice}
              </text>
            </g>
          )}
        </svg>
      </section>

      {/* Parameter Sliders & Interactive Counterpart Table */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        <section className="card stack-sm">
          <h3 style={{ margin: 0, fontSize: 15 }}>BATNA &amp; Reservation Price Parameters</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="stack-xs tiny">
              <span>Buyer BATNA ({currency})</span>
              <input className="input" type="number" value={buyerBatna} onChange={(e) => setBuyerBatna(Number(e.target.value))} />
            </label>
            <label className="stack-xs tiny">
              <span>Switching Cost ({currency})</span>
              <input className="input" type="number" value={buyerSwitchingCost} onChange={(e) => setBuyerSwitchingCost(Number(e.target.value))} />
            </label>
            <label className="stack-xs tiny">
              <span>Buyer Opening Anchor</span>
              <input className="input" type="number" value={buyerAnchor} onChange={(e) => setBuyerAnchor(Number(e.target.value))} />
            </label>
            <label className="stack-xs tiny">
              <span>Buyer Target Price</span>
              <input className="input" type="number" value={buyerTarget} onChange={(e) => setBuyerTarget(Number(e.target.value))} />
            </label>
            <label className="stack-xs tiny">
              <span>Est. Supplier Cost</span>
              <input className="input" type="number" value={supplierCost} onChange={(e) => setSupplierCost(Number(e.target.value))} />
            </label>
            <label className="stack-xs tiny">
              <span>Supplier Min Margin (%)</span>
              <input className="input" type="number" value={supplierMinMarginPct} onChange={(e) => setSupplierMinMarginPct(Number(e.target.value))} />
            </label>
            <label className="stack-xs tiny">
              <span>Supplier Opening Ask</span>
              <input className="input" type="number" value={supplierAnchor} onChange={(e) => setSupplierAnchor(Number(e.target.value))} />
            </label>
            <label className="stack-xs tiny">
              <span>Order Quantity (Units)</span>
              <input className="input" type="number" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} />
            </label>
          </div>
          <label className="stack-xs tiny">
            <span>Simulated Counterpart Style</span>
            <select className="input" value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value="collaborative">Collaborative Counterpart (Faster Concessions)</option>
              <option value="firm_anchorer">Firm Anchorer (Standard Commercial Buyer/Seller)</option>
              <option value="hardball">Hardball Negotiator (Slow Concessions, High Walk-Away Risk)</option>
            </select>
          </label>
        </section>

        <section className="card stack-sm">
          <div className="between">
            <h3 style={{ margin: 0, fontSize: 15 }}>Live Bargaining Table (Max 6 Rounds)</h3>
            <button type="button" className="btn btn-sm" onClick={resetTable}>Reset Table</button>
          </div>
          <div className="card-soft small" style={{ padding: 10 }}>
            <strong>Current Supplier Ask:</strong> <span className="mono">{currency} {lastSupplierAsk.toLocaleString()}</span>
            {zopa.dealMetrics && (
              <div className="tiny" style={{ marginTop: 4, color: zopa.dealMetrics.withinZopa ? 'var(--teal-700)' : 'var(--red)', fontWeight: 700 }}>
                {zopa.dealMetrics.verdict} — Total Savings vs. BATNA: {currency} {zopa.dealMetrics.buyerTotalSavings.toLocaleString()}
              </div>
            )}
          </div>
          {dealStatus === 'open' && (
            <div className="row-wrap" style={{ gap: 8 }}>
              <input
                className="input mono"
                style={{ width: 130 }}
                type="number"
                value={offerInput}
                onChange={(e) => setOfferInput(e.target.value)}
                aria-label="Buyer counter-offer price"
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={submitBuyerOffer}>
                Send Offer (Rd {rounds.length + 1})
              </button>
              <button type="button" className="btn btn-sm" onClick={acceptSupplierAsk}>
                Accept {currency} {lastSupplierAsk}
              </button>
              <button type="button" className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={walkAwayBatna}>
                Walk Away (BATNA)
              </button>
            </div>
          )}
          <div style={{ maxHeight: 195, overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Rd</th>
                  <th>Buyer Offer</th>
                  <th>Supplier Ask</th>
                  <th>Signal</th>
                </tr>
              </thead>
              <tbody>
                {rounds.length === 0 ? (
                  <tr><td colSpan={4} className="muted">Make your opening anchor offer to begin bargaining.</td></tr>
                ) : rounds.map((r) => (
                  <tr key={r.round}>
                    <td className="mono">{r.round}</td>
                    <td className="mono">{currency} {r.buyerOffer}</td>
                    <td className="mono">{currency} {r.supplierCounter}</td>
                    <td className="tiny">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Managerial Judgement */}
      <section className="card stack-xs">
        <div className="between">
          <h3 style={{ margin: 0, fontSize: 15 }}>Managerial Judgement &amp; Negotiation Strategy Debrief</h3>
          <span className="tiny mono muted">{wordCount} words {wordCount >= 40 ? '● READY' : '(target ≥ 40 words)'}</span>
        </div>
        <textarea
          className="textarea"
          rows={4}
          placeholder="Explain how your BATNA defined your reservation price, evaluate the anchoring and concession curve observed across rounds, and justify whether settling or walking away created superior commercial value…"
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
        />
      </section>
    </div>
  );
}
