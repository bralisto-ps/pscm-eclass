import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { useToast } from '../ui.jsx';
import {
  buildLabCsvTemplate,
  getLabPreset,
  readLabSpreadsheetRows,
  REQ_TO_ORDER_PRESETS,
} from '../../lib/labsCatalog.js';
import {
  compareBlanketVsStandard,
  DEFAULT_DOA_TIERS,
  evaluateRequisitionBatch,
} from '../../lib/psisMilestone3Engine.js';
import { downloadText } from '../../lib/sheets.js';

function fmtMoney(n, currency = 'GHS') {
  return `${currency} ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ReqToOrderLab({
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
    () => getLabPreset('psis_req_to_order', config?.presetId) || REQ_TO_ORDER_PRESETS[0],
    [config?.presetId],
  );
  const initialSource = config?.customDataset?.requisitions?.length
    ? {
        name: config.customDataset.name || 'Lecturer Requisition Dataset',
        currency: config.customDataset.currency || 'GHS',
        budgets: config.customDataset.budgets || defaultPreset.budgets,
        catalogue: config.customDataset.catalogue || defaultPreset.catalogue,
        requisitions: config.customDataset.requisitions,
        blanketDefaults: config.customDataset.blanketDefaults || defaultPreset.blanketDefaults,
      }
    : defaultPreset;

  const [activeTab, setActiveTab] = useState(draftState?.activeTab || 'doa');
  const [datasetName, setDatasetName] = useState(draftState?.datasetName || initialSource.name);
  const [currency, setCurrency] = useState(draftState?.currency || initialSource.currency || 'GHS');
  const [accountingMode, setAccountingMode] = useState(draftState?.accountingMode || 'spent_only');
  const [testedBothModes, setTestedBothModes] = useState(Boolean(draftState?.testedBothModes));
  const [budgets, setBudgets] = useState(() => draftState?.budgets || initialSource.budgets);
  const [requisitions, setRequisitions] = useState(() =>
    draftState?.requisitions?.length ? draftState.requisitions : initialSource.requisitions.map((r) => ({ ...r })),
  );

  // Quick catalogue requisition builder
  const [selectedSku, setSelectedSku] = useState(initialSource.catalogue[0]?.sku || 'CAT-01');
  const [reqQty, setReqQty] = useState('10');

  // Blanket order vs Standard PO inputs
  const bDef = initialSource.blanketDefaults || defaultPreset.blanketDefaults;
  const [orderCount, setOrderCount] = useState(draftState?.orderCount ?? bDef.orderCount);
  const [standardPoCost, setStandardPoCost] = useState(draftState?.standardPoCost ?? bDef.standardPoCost);
  const [standardCycleHours, setStandardCycleHours] = useState(draftState?.standardCycleHours ?? bDef.standardCycleHours);
  const [blanketSetupCost, setBlanketSetupCost] = useState(draftState?.blanketSetupCost ?? bDef.blanketSetupCost);
  const [callOffCost, setCallOffCost] = useState(draftState?.callOffCost ?? bDef.callOffCost);
  const [callOffCycleHours, setCallOffCycleHours] = useState(draftState?.callOffCycleHours ?? bDef.callOffCycleHours);

  const [judgement, setJudgement] = useState(draftState?.judgement || '');

  useEffect(() => {
    onDraftChange?.({
      activeTab,
      datasetName,
      currency,
      accountingMode,
      testedBothModes,
      budgets,
      requisitions,
      orderCount,
      standardPoCost,
      standardCycleHours,
      blanketSetupCost,
      callOffCost,
      callOffCycleHours,
      judgement,
    });
  }, [
    activeTab,
    datasetName,
    currency,
    accountingMode,
    testedBothModes,
    budgets,
    requisitions,
    orderCount,
    standardPoCost,
    standardCycleHours,
    blanketSetupCost,
    callOffCost,
    callOffCycleHours,
    judgement,
  ]);

  const evalActive = useMemo(
    () => evaluateRequisitionBatch({ requisitions, budgets, accountingMode, doaTiers: DEFAULT_DOA_TIERS }),
    [requisitions, budgets, accountingMode],
  );
  const evalSpent = useMemo(
    () => evaluateRequisitionBatch({ requisitions, budgets, accountingMode: 'spent_only', doaTiers: DEFAULT_DOA_TIERS }),
    [requisitions, budgets],
  );
  const evalCommit = useMemo(
    () => evaluateRequisitionBatch({ requisitions, budgets, accountingMode: 'commitment', doaTiers: DEFAULT_DOA_TIERS }),
    [requisitions, budgets],
  );
  const blanketCalc = useMemo(
    () =>
      compareBlanketVsStandard({
        orderCount,
        standardPoCost,
        standardCycleHours,
        blanketSetupCost,
        callOffCost,
        callOffCycleHours,
      }),
    [orderCount, standardPoCost, standardCycleHours, blanketSetupCost, callOffCost, callOffCycleHours],
  );

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const lines = [
        `LABORATORY: PSIS-LAB 05 — Requisition Workflow, Delegation of Authority & Commitment Accounting`,
        `DATASET: ${datasetName} (${requisitions.length} requisitions · Currency: ${currency})`,
        ``,
        `1. BUDGET ACCOUNTING COMPARISON (SPENT-ONLY VS. COMMITMENT ACCOUNTING)`,
        `- Spent-Only Mode: Approved ${evalSpent.summary.approvedCount}/${evalSpent.summary.totalReqs} | Bounced ${evalSpent.summary.bouncedCount} | Over-Committed Exposure: ${fmtMoney(evalSpent.summary.totalOverCommitment, currency)} (${evalSpent.summary.doubleCommitCount} double-committed reqs)`,
        `- Commitment Accounting Mode: Approved ${evalCommit.summary.approvedCount}/${evalCommit.summary.totalReqs} | Bounced ${evalCommit.summary.bouncedCount} | Over-Committed Exposure: ${fmtMoney(evalCommit.summary.totalOverCommitment, currency)}`,
        `- Potential Split-Order Avoidance Flags Detected: ${evalCommit.summary.splitFlagsCount}`,
        `- Average Approval Cycle Time (DoA SLA): ${evalCommit.summary.avgCycleHours} hours`,
        ``,
        `REQUISITION ROUTING LOG (COMMITMENT MODE):`,
        ...evalCommit.results.map(
          (r, i) => `${i + 1}. ${r.reqNo} | ${r.item} (${r.costCentre}) | ${fmtMoney(r.total, currency)} -> ${r.approver} (${r.slaHours}h) | ${r.status}${r.splitOrderFlag ? ' [SPLIT-ORDER FLAG]' : ''}`,
        ),
        ``,
        `2. BLANKET ORDER VS. STANDARD PO TRANSACTION COST ANALYSIS`,
        `- Annual Orders / Call-Offs Evaluated: ${blanketCalc.orderCount}`,
        `- ${blanketCalc.orderCount} Standard POs: ${fmtMoney(blanketCalc.totalStandardCost, currency)} (${blanketCalc.totalStandardHours} hrs cycle time)`,
        `- 1 Blanket Order + ${blanketCalc.orderCount} Call-Offs: ${fmtMoney(blanketCalc.totalBlanketCost, currency)} (${blanketCalc.totalBlanketHours} hrs cycle time)`,
        `- Net Transaction Cost Savings: ${fmtMoney(blanketCalc.costSavings, currency)} (${blanketCalc.savingsPct}%) | Time Saved: ${blanketCalc.hoursSaved} hrs | Break-Even: ${blanketCalc.breakEvenOrders || 'N/A'} orders`,
        ``,
        `3. STUDENT WRITTEN PROCUREMENT CONTROL JUDGEMENT`,
        judgement.trim() || '(No written judgement provided yet.)',
      ];
      return {
        title: `Requisition-to-Order & Commitment Lab Report — ${datasetName}`,
        body: lines.join('\n'),
        hasJudgement: judgement.trim().length >= 25,
      };
    });
  }, [
    onRegisterReportBuilder,
    datasetName,
    currency,
    requisitions.length,
    evalSpent,
    evalCommit,
    blanketCalc,
    judgement,
  ]);

  function handleSwitchAccountingMode(mode) {
    if (mode !== accountingMode) setTestedBothModes(true);
    setAccountingMode(mode);
  }

  function handleAddCatalogueReq(e) {
    e.preventDefault();
    const item = (initialSource.catalogue || []).find((c) => c.sku === selectedSku) || initialSource.catalogue[0];
    if (!item) return;
    const qty = Math.max(1, Math.round(Number(reqQty) || 1));
    const nextNo = `REQ-${String(requisitions.length + 1).padStart(3, '0')}`;
    setRequisitions((prev) => [
      ...prev,
      {
        id: `req_${Date.now()}`,
        reqNo: nextNo,
        item: item.item,
        supplier: item.supplier,
        costCentre: item.defaultCostCentre,
        qty,
        unitPrice: item.unitPrice,
        paid: false,
      },
    ]);
    toast(`Raised ${nextNo} (${qty} × ${item.item}) into the approval queue.`);
  }

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readLabSpreadsheetRows(file);
      const parsed = [];
      rows.forEach((r, idx) => {
        if (r.length < 6) return;
        const qty = Number(String(r[4]).replace(/[^0-9.-]/g, ''));
        const unitPrice = Number(String(r[5]).replace(/[^0-9.-]/g, ''));
        if (idx === 0 && !Number.isFinite(qty)) return;
        if (!Number.isFinite(qty) || !Number.isFinite(unitPrice)) return;
        parsed.push({
          id: `csv_r_${idx}_${Date.now()}`,
          reqNo: String(r[0] || `REQ-${idx + 1}`).trim(),
          item: String(r[1] || 'Item').trim(),
          supplier: String(r[2] || 'Supplier').trim(),
          costCentre: String(r[3] || 'General').trim(),
          qty: Math.max(1, Math.round(qty)),
          unitPrice: Math.max(0, unitPrice),
          paid: false,
        });
      });
      if (!parsed.length) throw new Error('Use columns: ReqNo, Item, Supplier, CostCentre, Qty, UnitPrice.');
      setDatasetName(file.name.replace(/\.[^.]+$/, ''));
      setRequisitions(parsed);
      toast(`Loaded ${parsed.length} requisitions from "${file.name}".`);
    } catch (err) {
      toast(err.message || 'Could not import requisition CSV.', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function exportQueueCsv() {
    const header = 'ReqNo,Item,Supplier,CostCentre,Qty,UnitPrice,Total,Approver,SLA_Hours,Status,SplitOrderFlag,TrueRemainingAfter';
    const body = evalActive.results.map((r) => [
      r.reqNo,
      `"${String(r.item).replace(/"/g, '""')}"`,
      `"${String(r.supplier).replace(/"/g, '""')}"`,
      `"${String(r.costCentre).replace(/"/g, '""')}"`,
      r.qty,
      r.unitPrice,
      r.total,
      `"${r.approver}"`,
      r.slaHours,
      r.status,
      r.splitOrderFlag ? 'FLAGGED' : 'OK',
      r.trueRemainingAfter,
    ].join(','));
    downloadText('requisition-to-order-audit.csv', [header, ...body].join('\n'));
  }

  const maxBar = Math.max(1, blanketCalc.totalStandardCost, blanketCalc.totalBlanketCost);

  return (
    <div className="stack">
      {/* Top Bar */}
      <div className="card stack-sm" style={{ padding: 14 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="tiny muted">REQUISITION-TO-ORDER &amp; BUDGET CONTROL ENGINE · {datasetName}</div>
            <div className="small" style={{ marginTop: 2 }}>
              Route requisitions through Delegation of Authority (DoA), test Commitment vs. Spent-Only budget checks, and compare Standard POs against Blanket Orders.
            </div>
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            {canEditData && (
              <>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleCsvUpload} />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const tpl = buildLabCsvTemplate('psis_req_to_order');
                    downloadText(tpl.filename, tpl.content);
                  }}
                >
                  <Icon name="download" size={13} /> CSV Template
                </button>
                <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={13} /> Upload Requisitions
                </button>
              </>
            )}
            <button type="button" className="btn btn-sm" onClick={exportQueueCsv}>
              <Icon name="download" size={13} /> Export Audit CSV
            </button>
          </div>
        </div>

        <div className="row-wrap" style={{ gap: 6, paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'doa' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('doa')}
          >
            1. Catalogue, DoA &amp; Commitment Check ({requisitions.length} reqs)
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'blanket' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('blanket')}
          >
            2. Blanket Order vs. Standard PO ROI ({blanketCalc.savingsPct}% savings)
          </button>
        </div>
      </div>

      {/* TAB 1: DoA ROUTING & COMMITMENT VS SPENT-ONLY ACCOUNTING */}
      {activeTab === 'doa' && (
        <div className="stack">
          {/* Accounting Mode Toggle Banner */}
          <div className="card stack-sm" style={{ padding: 14 }}>
            <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div>
                <strong>Budget Control Switch (The Double-Commitment Trap)</strong>
                <div className="tiny muted">
                  Switch between Spent-Only and Commitment Accounting to watch how unrecorded PO encumbrances cause over-budget exposure.
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={accountingMode === 'spent_only' ? { background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' } : undefined}
                  onClick={() => handleSwitchAccountingMode('spent_only')}
                >
                  Mode A: Spent-Only (Cash Basis)
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${accountingMode === 'commitment' ? 'btn-primary' : ''}`}
                  onClick={() => handleSwitchAccountingMode('commitment')}
                >
                  Mode B: Commitment Accounting (ERP Standard)
                </button>
              </div>
            </div>

            {accountingMode === 'spent_only' && evalActive.summary.totalOverCommitment > 0 ? (
              <div className="notice-err small">
                <strong className="mono">
                  ▲ BUDGET BREACH: {fmtMoney(evalActive.summary.totalOverCommitment, currency)} DOUBLE-COMMITTED OVER BUDGET
                </strong>
                <div style={{ marginTop: 4 }}>
                  Because Spent-Only mode ignores open Purchase Orders until invoices are paid, {evalActive.summary.doubleCommitCount} requisition(s) were approved past the real cost-centre ceiling. Switch to <strong>Commitment Accounting</strong> to see how ERP encumbrance stops this immediately.
                </div>
              </div>
            ) : (
              <div className="notice small">
                <strong className="mono">
                  ● COMMITMENT ACCOUNTING ACTIVE — ZERO OVER-COMMITMENT ({evalActive.summary.bouncedCount} OVER-BUDGET REQ BLOCKED)
                </strong>
                <div style={{ marginTop: 4 }}>
                  Every approved PO immediately reserves budget before the next requisition is checked, protecting cost centres from double-spending.
                </div>
              </div>
            )}
          </div>

          {/* KPI Strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 10 }}>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">APPROVED / BOUNCED</div>
              <div className="kpi mono" style={{ fontSize: 22, marginTop: 4 }}>
                {evalActive.summary.approvedCount} / {evalActive.summary.bouncedCount}
              </div>
              <div className="tiny muted">of {evalActive.summary.totalReqs} requisitions</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">OVER-COMMITTED EXPOSURE</div>
              <div className="kpi mono" style={{ fontSize: 20, marginTop: 4, color: evalActive.summary.totalOverCommitment > 0 ? 'var(--red)' : 'var(--teal-700)' }}>
                {fmtMoney(evalActive.summary.totalOverCommitment, currency)}
              </div>
              <div className="tiny muted">{evalActive.summary.doubleCommitCount} breached reqs</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">SPLIT-ORDER FLAGS</div>
              <div className="kpi mono" style={{ fontSize: 22, marginTop: 4, color: evalActive.summary.splitFlagsCount ? 'var(--red)' : 'var(--teal-700)' }}>
                {evalActive.summary.splitFlagsCount}
              </div>
              <div className="tiny muted">Threshold-splitting alerts</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">AVG APPROVAL CYCLE</div>
              <div className="kpi mono" style={{ fontSize: 22, marginTop: 4 }}>{evalActive.summary.avgCycleHours}h</div>
              <div className="tiny muted">Weighted DoA SLA</div>
            </div>
          </div>

          <div className="lab-split-grid">
            {/* Left: Requisition Queue & Catalogue Entry */}
            <div className="card stack-sm" style={{ padding: 14 }}>
              <strong>Requisition Approval Queue &amp; DoA Routing</strong>
              {canEditData && (
                <form onSubmit={handleAddCatalogueReq} className="card-soft row-wrap" style={{ padding: 10, gap: 8, alignItems: 'flex-end' }}>
                  <label className="stack-xs tiny muted" style={{ flex: '2 1 200px' }}>
                    Raise Catalogue Item
                    <select className="input" value={selectedSku} onChange={(e) => setSelectedSku(e.target.value)}>
                      {(initialSource.catalogue || []).map((c) => (
                        <option key={c.sku} value={c.sku}>
                          {c.item} ({fmtMoney(c.unitPrice, currency)} · {c.defaultCostCentre})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="stack-xs tiny muted" style={{ width: 90 }}>
                    Qty
                    <input className="input mono" type="number" min="1" value={reqQty} onChange={(e) => setReqQty(e.target.value)} />
                  </label>
                  <button type="submit" className="btn btn-primary btn-sm">
                    <Icon name="plus" size={13} /> Raise Req
                  </button>
                </form>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Req &amp; Item</th>
                      <th className="mono" style={{ textAlign: 'right' }}>Total</th>
                      <th>DoA Route</th>
                      <th>Status</th>
                      {canEditData && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {evalActive.results.map((r) => (
                      <tr key={r.id}>
                        <td className="small">
                          <div style={{ fontWeight: 600 }}>
                            <span className="mono">{r.reqNo}</span> · {r.item}
                          </div>
                          <div className="tiny muted">
                            {r.costCentre} · {r.qty} × {r.unitPrice.toLocaleString()} · {r.supplier}
                          </div>
                          {r.splitOrderFlag && (
                            <div className="tiny mono" style={{ color: 'var(--red)', fontWeight: 700 }}>
                              ▲ SPLIT-ORDER ALERT: Combined vendor spend crosses next DoA threshold
                            </div>
                          )}
                        </td>
                        <td className="mono small" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {fmtMoney(r.total, currency)}
                        </td>
                        <td className="tiny">
                          <div style={{ fontWeight: 600 }}>{r.approver}</div>
                          <div className="mono muted">{r.slaHours}h SLA · {r.steps} step{r.steps > 1 ? 's' : ''}</div>
                        </td>
                        <td className="mono tiny" style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
                          {r.status === 'BOUNCED_BUDGET' ? (
                            <span style={{ color: 'var(--red)' }}>▲ BOUNCED</span>
                          ) : r.causedDoubleCommit ? (
                            <span style={{ color: 'var(--red)' }}>⚠ OVER-COMMITTED</span>
                          ) : (
                            <span style={{ color: 'var(--teal-700)' }}>● APPROVED</span>
                          )}
                        </td>
                        {canEditData && (
                          <td>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label="Remove requisition"
                              onClick={() => setRequisitions((prev) => prev.filter((x) => x.id !== r.id))}
                            >
                              <Icon name="close" size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right: Cost Centre Budgets + DoA Table */}
            <div className="stack">
              <div className="card stack-sm" style={{ padding: 14 }}>
                <strong>Cost-Centre Budget Exposure</strong>
                {evalActive.budgetSummaries.map((b) => {
                  const over = b.trueRemaining < -0.01;
                  return (
                    <div key={b.costCentre} className="card-soft stack-xs" style={{ padding: 10 }}>
                      <div className="between small">
                        <strong>{b.costCentre}</strong>
                        <span className="mono tiny" style={{ fontWeight: 700, color: over ? 'var(--red)' : 'var(--teal-700)' }}>
                          {b.utilizationPct}% USED
                        </span>
                      </div>
                      <div style={{ height: 7, background: 'var(--track)', borderRadius: 4, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${Math.min(100, b.utilizationPct)}%`,
                            height: '100%',
                            background: over ? 'var(--red)' : 'var(--teal)',
                          }}
                        />
                      </div>
                      <div className="between tiny mono muted" style={{ flexWrap: 'wrap', gap: 6 }}>
                        <span>Budget: {b.budget.toLocaleString()}</span>
                        <span>Spent: {b.spent.toLocaleString()}</span>
                        <span>Committed: {b.committed.toLocaleString()}</span>
                        <span style={{ color: over ? 'var(--red)' : 'var(--text)', fontWeight: 700 }}>
                          True Left: {b.trueRemaining.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="card stack-sm" style={{ padding: 14 }}>
                <strong>Delegation of Authority (DoA) Threshold Table</strong>
                <table className="table tiny">
                  <thead>
                    <tr>
                      <th>Threshold ({currency})</th>
                      <th>Approving Authority</th>
                      <th className="mono" style={{ textAlign: 'right' }}>SLA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DEFAULT_DOA_TIERS.map((t, i) => (
                      <tr key={t.id}>
                        <td className="mono">
                          {i === 0 ? `Up to ${t.maxAmount.toLocaleString()}` : Number.isFinite(t.maxAmount) ? `Up to ${t.maxAmount.toLocaleString()}` : 'Above 100,000'}
                        </td>
                        <td style={{ fontWeight: 600 }}>{t.approver}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{t.slaHours}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BLANKET ORDER VS STANDARD PO COST COMPARATOR */}
      {activeTab === 'blanket' && (
        <div className="lab-split-grid">
          <div className="card stack-sm" style={{ padding: 16 }}>
            <strong>Transaction Cost Parameters (Standard PO vs. Blanket Call-Off)</strong>
            <div className="tiny muted">
              Compare issuing repeated standalone purchase orders against negotiating one annual Blanket Purchase Agreement (BPA) and releasing fast call-offs.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <label className="stack-xs tiny muted">
                Repeat Orders / Year (N)
                <input className="input mono" type="number" min="1" max="200" value={orderCount} onChange={(e) => setOrderCount(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="stack-xs tiny muted">
                Standard PO Admin Cost ({currency})
                <input className="input mono" type="number" min="0" value={standardPoCost} onChange={(e) => setStandardPoCost(Math.max(0, Number(e.target.value) || 0))} />
              </label>
              <label className="stack-xs tiny muted">
                Standard PO Cycle (Hours)
                <input className="input mono" type="number" min="1" value={standardCycleHours} onChange={(e) => setStandardCycleHours(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="stack-xs tiny muted">
                Blanket Setup Cost ({currency})
                <input className="input mono" type="number" min="0" value={blanketSetupCost} onChange={(e) => setBlanketSetupCost(Math.max(0, Number(e.target.value) || 0))} />
              </label>
              <label className="stack-xs tiny muted">
                Call-Off Admin Cost ({currency})
                <input className="input mono" type="number" min="0" value={callOffCost} onChange={(e) => setCallOffCost(Math.max(0, Number(e.target.value) || 0))} />
              </label>
              <label className="stack-xs tiny muted">
                Call-Off Cycle (Hours)
                <input className="input mono" type="number" min="0.5" step="0.5" value={callOffCycleHours} onChange={(e) => setCallOffCycleHours(Math.max(0.5, Number(e.target.value) || 1))} />
              </label>
            </div>
          </div>

          <div className="card stack-sm" style={{ padding: 16 }}>
            <strong>Comparative Cost &amp; Cycle-Time Verdict</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 8 }}>
              <div className="card-soft" style={{ padding: 10 }}>
                <div className="tiny muted">COST SAVINGS</div>
                <div className="kpi mono" style={{ fontSize: 18, color: blanketCalc.blanketWins ? 'var(--teal-700)' : 'var(--red)' }}>
                  {fmtMoney(blanketCalc.costSavings, currency)}
                </div>
                <div className="tiny muted">{blanketCalc.savingsPct}% reduction</div>
              </div>
              <div className="card-soft" style={{ padding: 10 }}>
                <div className="tiny muted">CYCLE TIME SAVED</div>
                <div className="kpi mono" style={{ fontSize: 18 }}>{blanketCalc.hoursSaved} hrs</div>
                <div className="tiny muted">{blanketCalc.totalStandardHours}h → {blanketCalc.totalBlanketHours}h</div>
              </div>
              <div className="card-soft" style={{ padding: 10 }}>
                <div className="tiny muted">BREAK-EVEN VOLUME</div>
                <div className="kpi mono" style={{ fontSize: 18 }}>
                  {blanketCalc.breakEvenOrders ? `${blanketCalc.breakEvenOrders} orders` : 'N/A'}
                </div>
                <div className="tiny muted">Min annual call-offs</div>
              </div>
            </div>

            <div className="stack-sm" style={{ paddingTop: 6 }}>
              <div className="stack-xs">
                <div className="between small">
                  <span>{blanketCalc.orderCount} Standard Purchase Orders</span>
                  <strong className="mono">{fmtMoney(blanketCalc.totalStandardCost, currency)}</strong>
                </div>
                <div style={{ height: 14, background: 'var(--track)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(blanketCalc.totalStandardCost / maxBar) * 100}%`, height: '100%', background: 'var(--red)' }} />
                </div>
              </div>
              <div className="stack-xs">
                <div className="between small">
                  <span>1 Blanket Order + {blanketCalc.orderCount} Call-Offs</span>
                  <strong className="mono">{fmtMoney(blanketCalc.totalBlanketCost, currency)}</strong>
                </div>
                <div style={{ height: 14, background: 'var(--track)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(blanketCalc.totalBlanketCost / maxBar) * 100}%`, height: '100%', background: 'var(--teal)' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WRITTEN JUDGEMENT */}
      <div className="card stack-sm" style={{ padding: 16 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong>Written Procurement Control Judgement (Required Deliverable)</strong>
            <div className="tiny muted">
              Explain why Commitment Accounting prevented budget overruns where Spent-Only failed, identify the split-order warning in your queue, and recommend which recurring spend lines should move onto Blanket Purchase Agreements.
            </div>
          </div>
          <span className="tiny mono muted">{judgement.trim().length} chars</span>
        </div>
        <textarea
          className="input"
          rows={5}
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
          placeholder="Write your managerial recommendation citing your Commitment vs. Spent-Only over-commitment figure, DoA routing bottlenecks, split-order flags, and Blanket Order break-even volume..."
        />
      </div>
    </div>
  );
}
