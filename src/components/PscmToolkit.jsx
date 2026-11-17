import { useMemo, useState } from 'react';
import { fmtNumber } from '../lib/format.js';
import Icon from './Icon.jsx';
import { Bar, Field, Modal } from './ui.jsx';

const TOOLS = [
  { id: 'eoq', label: 'EOQ & Cost' },
  { id: 'rop', label: 'ROP & Safety Stock' },
  { id: 'abc', label: 'ABC Pareto' },
  { id: 'landed', label: 'Total Landed Cost' },
  { id: 'ccc', label: 'Inventory & Cash Cycle' },
];

const Z_OPTIONS = [
  { label: '90% (Z = 1.28)', z: 1.28 },
  { label: '95% (Z = 1.65)', z: 1.65 },
  { label: '97.5% (Z = 1.96)', z: 1.96 },
  { label: '99% (Z = 2.33)', z: 2.33 },
];

const DEFAULT_ABC_TEXT = `A-01 Pump Valve, 1200, 180
B-04 Steel Flange, 2400, 28
C-11 Packing Tape, 8000, 2.5
A-09 Hydraulic Seal, 900, 140
B-12 Pallet Wrap, 1500, 22
C-08 Cable Tie Pack, 6000, 1.8
A-03 Control Sensor, 450, 260`;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export default function PscmToolkitModal({ onClose, courseCode = '' }) {
  const [tool, setTool] = useState('eoq');

  // 1. EOQ state
  const [eoqD, setEoqD] = useState('12000');
  const [eoqS, setEoqS] = useState('150');
  const [eoqH, setEoqH] = useState('18');
  const [eoqC, setEoqC] = useState('90');
  const [eoqDays, setEoqDays] = useState('250');

  const eoqRes = useMemo(() => {
    const D = num(eoqD);
    const S = num(eoqS);
    const H = num(eoqH);
    const C = num(eoqC);
    const days = Math.max(1, num(eoqDays, 250));
    if (D <= 0 || S <= 0 || H <= 0) return null;
    const Q = Math.sqrt((2 * D * S) / H);
    const orders = D / Q;
    const cycleDays = days / orders;
    const orderingCost = (D / Q) * S;
    const holdingCost = (Q / 2) * H;
    const purchaseCost = D * C;
    return {
      Q,
      orders,
      cycleDays,
      orderingCost,
      holdingCost,
      relevantCost: orderingCost + holdingCost,
      totalCost: orderingCost + holdingCost + purchaseCost,
    };
  }, [eoqD, eoqS, eoqH, eoqC, eoqDays]);

  // 2. ROP & Safety Stock state
  const [ropD, setRopD] = useState('45');
  const [ropL, setRopL] = useState('6');
  const [ropSigma, setRopSigma] = useState('10');
  const [ropZ, setRopZ] = useState(1.65);

  const ropRes = useMemo(() => {
    const d = num(ropD);
    const L = num(ropL);
    const sig = num(ropSigma);
    const z = Number(ropZ) || 1.65;
    const baseDemand = d * L;
    const ss = z * sig * Math.sqrt(Math.max(0, L));
    const rop = baseDemand + ss;
    return { baseDemand, ss, rop, z, L };
  }, [ropD, ropL, ropSigma, ropZ]);

  // 3. ABC Pareto state
  const [abcInput, setAbcInput] = useState(DEFAULT_ABC_TEXT);
  const abcRes = useMemo(() => {
    const lines = abcInput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const items = [];
    for (const line of lines) {
      const parts = line.split(/[,\t;]+/).map((s) => s.trim());
      if (parts.length < 3) continue;
      const name = parts[0];
      const qty = Number(parts[1]);
      const cost = Number(parts[2]);
      if (!name || !Number.isFinite(qty) || !Number.isFinite(cost) || qty < 0 || cost < 0) continue;
      items.push({ name, qty, cost, value: qty * cost });
    }
    items.sort((a, b) => b.value - a.value);
    const total = items.reduce((s, x) => s + x.value, 0);
    let cum = 0;
    const classified = items.map((x) => {
      cum += x.value;
      const share = total > 0 ? (x.value / total) * 100 : 0;
      const cumPct = total > 0 ? (cum / total) * 100 : 0;
      const cls = cumPct <= 80.5 ? 'A' : cumPct <= 95.5 ? 'B' : 'C';
      return { ...x, share, cumPct, cls };
    });
    const countA = classified.filter((x) => x.cls === 'A').length;
    const countB = classified.filter((x) => x.cls === 'B').length;
    const countC = classified.filter((x) => x.cls === 'C').length;
    return { items: classified, total, countA, countB, countC };
  }, [abcInput]);

  // 4. Total Landed Cost Comparison
  const [lcQty, setLcQty] = useState('500');
  const [supA, setSupA] = useState({ name: 'Supplier A (Local/Regional)', unit: '48', freight: '1800', insurance: '250', dutyPct: '5', clearing: '400', defectPct: '1.5' });
  const [supB, setSupB] = useState({ name: 'Supplier B (Overseas FOB)', unit: '41', freight: '3600', insurance: '480', dutyPct: '12', clearing: '950', defectPct: '3.0' });

  function calcLanded(s, qVal) {
    const q = Math.max(1, num(qVal, 1));
    const goods = num(s.unit) * q;
    const cif = goods + num(s.freight) + num(s.insurance);
    const duty = (cif * num(s.dutyPct)) / 100;
    const qualityRisk = (goods * num(s.defectPct)) / 100;
    const total = cif + duty + num(s.clearing) + qualityRisk;
    return { goods, cif, duty, qualityRisk, total, perUnit: total / q };
  }
  const lcA = useMemo(() => calcLanded(supA, lcQty), [supA, lcQty]);
  const lcB = useMemo(() => calcLanded(supB, lcQty), [supB, lcQty]);

  // 5. Inventory Turnover & Cash-to-Cash Cycle
  const [cogs, setCogs] = useState('4500000');
  const [avgInv, setAvgInv] = useState('750000');
  const [arDays, setArDays] = useState('42');
  const [apDays, setApDays] = useState('35');

  const cccRes = useMemo(() => {
    const c = num(cogs);
    const inv = num(avgInv);
    const turn = inv > 0 ? c / inv : 0;
    const dio = turn > 0 ? 365 / turn : 0;
    const dso = num(arDays);
    const dpo = num(apDays);
    const ccc = dio + dso - dpo;
    return { turn, dio, dso, dpo, ccc };
  }, [cogs, avgInv, arDays, apDays]);

  return (
    <Modal
      wide
      title={`PSCM Supply Chain & Procurement Toolkit${courseCode ? ` · ${courseCode}` : ''}`}
      onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Close Toolkit</button>}
    >
      <div className="stack">
        <div className="chips" role="tablist" aria-label="PSCM calculators">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tool === t.id}
              aria-pressed={tool === t.id}
              className="chip"
              onClick={() => setTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tool === 'eoq' && (
          <div className="stack">
            <div className="notice notice-info small">
              <strong>Economic Order Quantity:</strong> <span className="mono">EOQ = √(2 × D × S ÷ H)</span> — balances annual setup/ordering costs against annual inventory holding costs.
            </div>
            <div className="grid-3">
              <Field label="Annual demand (D)" hint="units / year">
                <input className="input mono" type="number" min="0" value={eoqD} onChange={(e) => setEoqD(e.target.value)} />
              </Field>
              <Field label="Ordering cost (S)" hint="per order">
                <input className="input mono" type="number" min="0" value={eoqS} onChange={(e) => setEoqS(e.target.value)} />
              </Field>
              <Field label="Holding cost (H)" hint="per unit / year">
                <input className="input mono" type="number" min="0" value={eoqH} onChange={(e) => setEoqH(e.target.value)} />
              </Field>
              <Field label="Unit price (C)" hint="optional, for total cost">
                <input className="input mono" type="number" min="0" value={eoqC} onChange={(e) => setEoqC(e.target.value)} />
              </Field>
              <Field label="Operating days / year">
                <input className="input mono" type="number" min="1" value={eoqDays} onChange={(e) => setEoqDays(e.target.value)} />
              </Field>
            </div>
            {eoqRes ? (
              <div className="stack-sm">
                <div className="grid-4">
                  <div className="kpi"><span className="l">Optimal EOQ (Q*)</span><span className="v mono" style={{ color: 'var(--teal-dark)' }}>{fmtNumber(eoqRes.Q, 1)}</span></div>
                  <div className="kpi"><span className="l">Orders / Year</span><span className="v mono">{fmtNumber(eoqRes.orders, 2)}</span></div>
                  <div className="kpi"><span className="l">Order Cycle</span><span className="v mono">{fmtNumber(eoqRes.cycleDays, 1)} d</span></div>
                  <div className="kpi"><span className="l">Ordering + Holding</span><span className="v mono">{fmtNumber(eoqRes.relevantCost, 2)}</span></div>
                </div>
                <div className="card-soft small" style={{ padding: 12 }}>
                  <span className="eyebrow">Step-by-step derivation</span>
                  <div className="mono" style={{ marginTop: 4, lineHeight: 1.7 }}>
                    Q* = √(2 × {fmtNumber(num(eoqD))} × {fmtNumber(num(eoqS))} ÷ {fmtNumber(num(eoqH))}) = √({fmtNumber((2 * num(eoqD) * num(eoqS)) / Math.max(0.0001, num(eoqH)), 2)}) = <strong>{fmtNumber(eoqRes.Q, 2)} units</strong>
                    <br />
                    Annual Ordering Cost = ({fmtNumber(num(eoqD))} ÷ {fmtNumber(eoqRes.Q, 2)}) × {fmtNumber(num(eoqS))} = <strong>{fmtNumber(eoqRes.orderingCost, 2)}</strong> · Holding Cost = ({fmtNumber(eoqRes.Q, 2)} ÷ 2) × {fmtNumber(num(eoqH))} = <strong>{fmtNumber(eoqRes.holdingCost, 2)}</strong>
                    {num(eoqC) > 0 && <><br />Total Annual Cost (incl. Purchase) = <strong>{fmtNumber(eoqRes.totalCost, 2)}</strong></>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="notice notice-warn small">Enter positive values for D, S, and H to compute EOQ.</div>
            )}
          </div>
        )}

        {tool === 'rop' && (
          <div className="stack">
            <div className="notice notice-info small">
              <strong>Reorder Point with Safety Stock:</strong> <span className="mono">ROP = (d × L) + (Z × σ_d × √L)</span> — prevents stockouts when demand fluctuates during supplier lead time.
            </div>
            <div className="grid-2">
              <Field label="Average daily demand (d)">
                <input className="input mono" type="number" min="0" value={ropD} onChange={(e) => setRopD(e.target.value)} />
              </Field>
              <Field label="Supplier lead time in days (L)">
                <input className="input mono" type="number" min="0" value={ropL} onChange={(e) => setRopL(e.target.value)} />
              </Field>
              <Field label="Daily demand std. dev. (σ_d)">
                <input className="input mono" type="number" min="0" value={ropSigma} onChange={(e) => setRopSigma(e.target.value)} />
              </Field>
              <Field label="Target cycle service level">
                <select className="select" value={ropZ} onChange={(e) => setRopZ(Number(e.target.value))}>
                  {Z_OPTIONS.map((z) => <option key={z.z} value={z.z}>{z.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid-3">
              <div className="kpi"><span className="l">Lead-time Demand</span><span className="v mono">{fmtNumber(ropRes.baseDemand, 1)}</span></div>
              <div className="kpi"><span className="l">Safety Stock (SS)</span><span className="v mono" style={{ color: 'var(--blue-ink)' }}>{fmtNumber(ropRes.ss, 1)}</span></div>
              <div className="kpi"><span className="l">Reorder Point (ROP)</span><span className="v mono" style={{ color: 'var(--teal-dark)' }}>{Math.ceil(ropRes.rop)} units</span></div>
            </div>
            <div className="card-soft small mono" style={{ padding: 12 }}>
              SS = {ropRes.z} × {num(ropSigma)} × √{ropRes.L} = <strong>{fmtNumber(ropRes.ss, 2)}</strong> · Place a replenishment order whenever stock position drops to <strong>{Math.ceil(ropRes.rop)} units</strong>.
            </div>
          </div>
        )}

        {tool === 'abc' && (
          <div className="stack">
            <div className="notice notice-info small">
              <strong>ABC Pareto Inventory Analysis:</strong> Enter one SKU per line as <span className="mono">SKU Name, Annual Qty, Unit Cost</span>. Items contributing the first ~80% of annual spend are Class A.
            </div>
            <Field label="Inventory items (SKU, Annual Qty, Unit Cost)">
              <textarea
                className="textarea mono"
                style={{ minHeight: 110, fontSize: 12 }}
                value={abcInput}
                onChange={(e) => setAbcInput(e.target.value)}
              />
            </Field>
            <div className="grid-4">
              <div className="kpi"><span className="l">Total Annual Spend</span><span className="v mono">{fmtNumber(abcRes.total, 0)}</span></div>
              <div className="kpi"><span className="l">Class A SKUs</span><span className="v mono" style={{ color: 'var(--red-ink)' }}>{abcRes.countA}</span></div>
              <div className="kpi"><span className="l">Class B SKUs</span><span className="v mono" style={{ color: 'var(--amber-ink)' }}>{abcRes.countB}</span></div>
              <div className="kpi"><span className="l">Class C SKUs</span><span className="v mono" style={{ color: 'var(--teal-dark)' }}>{abcRes.countC}</span></div>
            </div>
            <div className="table-wrap card-flush">
              <table className="table">
                <thead>
                  <tr><th>SKU</th><th className="num">Annual Value</th><th className="num">Share</th><th className="num">Cum. %</th><th>Class</th></tr>
                </thead>
                <tbody>
                  {abcRes.items.map((it, idx) => (
                    <tr key={`${it.name}-${idx}`}>
                      <td className="strong small">{it.name}</td>
                      <td className="num mono small">{fmtNumber(it.value, 2)}</td>
                      <td className="num mono small" style={{ width: 120 }}>
                        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <div style={{ width: 48 }}><Bar value={it.share} color={it.cls === 'A' ? 'var(--red-ink)' : it.cls === 'B' ? 'var(--amber)' : 'var(--teal)'} /></div>
                          <span>{it.share.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="num mono small">{it.cumPct.toFixed(1)}%</td>
                      <td>
                        <span className={`badge ${it.cls === 'A' ? 'badge-red' : it.cls === 'B' ? 'badge-amber' : 'badge-teal'}`}>
                          Class {it.cls}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tool === 'landed' && (
          <div className="stack">
            <div className="between" style={{ flexWrap: 'wrap', gap: 12 }}>
              <p className="small muted" style={{ margin: 0, maxWidth: 520 }}>
                Compare two supplier quotations on true <strong>Total Landed Cost</strong> (including freight, insurance, customs duty, port clearing, and defect risk) rather than unit price alone.
              </p>
              <Field label="Order quantity (units)">
                <input className="input mono" style={{ width: 130 }} type="number" min="1" value={lcQty} onChange={(e) => setLcQty(e.target.value)} />
              </Field>
            </div>
            <div className="grid-2">
              {[{ st: supA, set: setSupA, res: lcA, other: lcB }, { st: supB, set: setSupB, res: lcB, other: lcA }].map((col, idx) => {
                const winner = col.res.total <= col.other.total;
                return (
                  <div key={idx} className="card-soft stack-sm" style={{ padding: 14, border: winner ? '1.5px solid var(--teal)' : '1px solid var(--line)' }}>
                    <div className="between">
                      <input className="input" style={{ fontWeight: 600 }} value={col.st.name} onChange={(e) => col.set({ ...col.st, name: e.target.value })} />
                      {winner && <span className="badge badge-teal" style={{ marginLeft: 8 }}>Lower TCO</span>}
                    </div>
                    <div className="grid-2" style={{ gap: 8 }}>
                      <Field label="Unit price"><input className="input mono" type="number" min="0" value={col.st.unit} onChange={(e) => col.set({ ...col.st, unit: e.target.value })} /></Field>
                      <Field label="Freight total"><input className="input mono" type="number" min="0" value={col.st.freight} onChange={(e) => col.set({ ...col.st, freight: e.target.value })} /></Field>
                      <Field label="Insurance total"><input className="input mono" type="number" min="0" value={col.st.insurance} onChange={(e) => col.set({ ...col.st, insurance: e.target.value })} /></Field>
                      <Field label="Import duty (%)"><input className="input mono" type="number" min="0" value={col.st.dutyPct} onChange={(e) => col.set({ ...col.st, dutyPct: e.target.value })} /></Field>
                      <Field label="Port / clearing fees"><input className="input mono" type="number" min="0" value={col.st.clearing} onChange={(e) => col.set({ ...col.st, clearing: e.target.value })} /></Field>
                      <Field label="Defect / rework (%)"><input className="input mono" type="number" min="0" value={col.st.defectPct} onChange={(e) => col.set({ ...col.st, defectPct: e.target.value })} /></Field>
                    </div>
                    <div className="between small" style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 4 }}>
                      <span className="muted">Unit Landed Cost: <strong className="mono">{fmtNumber(col.res.perUnit, 2)}</strong></span>
                      <span className="strong mono" style={{ color: winner ? 'var(--teal-dark)' : 'var(--text)' }}>Total: {fmtNumber(col.res.total, 2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="notice notice-info small">
              Total Landed Cost difference: <strong>{fmtNumber(Math.abs(lcA.total - lcB.total), 2)}</strong> in favour of{' '}
              <strong>{lcA.total <= lcB.total ? supA.name : supB.name}</strong>.
            </div>
          </div>
        )}

        {tool === 'ccc' && (
          <div className="stack">
            <div className="notice notice-info small">
              <strong>Working Capital &amp; Cash-to-Cash Cycle:</strong> <span className="mono">CCC = DIO + DSO − DPO</span> — measures how many days cash is tied up in inventory and receivables before supplier payment.
            </div>
            <div className="grid-2">
              <Field label="Annual Cost of Goods Sold (COGS)">
                <input className="input mono" type="number" min="0" value={cogs} onChange={(e) => setCogs(e.target.value)} />
              </Field>
              <Field label="Average Inventory Value">
                <input className="input mono" type="number" min="0" value={avgInv} onChange={(e) => setAvgInv(e.target.value)} />
              </Field>
              <Field label="Receivables Days (DSO)">
                <input className="input mono" type="number" min="0" value={arDays} onChange={(e) => setArDays(e.target.value)} />
              </Field>
              <Field label="Payables Days (DPO)">
                <input className="input mono" type="number" min="0" value={apDays} onChange={(e) => setApDays(e.target.value)} />
              </Field>
            </div>
            <div className="grid-3">
              <div className="kpi"><span className="l">Inventory Turnover</span><span className="v mono">{fmtNumber(cccRes.turn, 2)}×</span></div>
              <div className="kpi"><span className="l">Days Inventory (DIO)</span><span className="v mono">{fmtNumber(cccRes.dio, 1)} d</span></div>
              <div className="kpi">
                <span className="l">Cash Conversion Cycle</span>
                <span className="v mono" style={{ color: cccRes.ccc <= 0 ? 'var(--teal-dark)' : 'var(--blue-ink)' }}>
                  {fmtNumber(cccRes.ccc, 1)} d
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
