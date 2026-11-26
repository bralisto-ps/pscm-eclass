import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { useToast } from '../ui.jsx';
import {
  buildLabCsvTemplate,
  readLabSpreadsheetRows,
  THE_MATCH_PRESETS,
} from '../../lib/labsCatalog.js';
import {
  auditSegregationOfDuties,
  evaluateThreeWayMatch,
  SOD_TOXIC_RULES,
} from '../../lib/psisLabEngine.js';
import { downloadText } from '../../lib/sheets.js';

const ROLES = [
  { id: 'buyer', label: 'Buyer', scope: 'Raise Purchase Orders' },
  { id: 'storekeeper', label: 'Storekeeper', scope: 'Confirm Goods Receipts (GRN)' },
  { id: 'finance', label: 'Finance / AP', scope: 'Post Invoices & Release Payment' },
  { id: 'manager', label: 'Manager', scope: 'Approve POs & Budgets' },
];

const DEFAULT_USERS = THE_MATCH_PRESETS[0].users;

function cloneUsers(list) {
  return (list || DEFAULT_USERS).map((u) => ({
    ...u,
    roles: [...(u.roles || [])],
  }));
}

function fmtMoney(n, currency = 'GHS') {
  const num = Number(n) || 0;
  return `${currency} ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseP2pCsvRows(rows) {
  const packets = [];
  rows.forEach((r, idx) => {
    if (r.length < 10) return;
    const poQty = Number(String(r[5]).replace(/[^0-9.-]/g, ''));
    const poUnitPrice = Number(String(r[6]).replace(/[^0-9.-]/g, ''));
    const grnQty = Number(String(r[7]).replace(/[^0-9.-]/g, ''));
    const invQty = Number(String(r[8]).replace(/[^0-9.-]/g, ''));
    const invUnitPrice = Number(String(r[9]).replace(/[^0-9.-]/g, ''));
    if (idx === 0 && !Number.isFinite(poQty)) return;
    if (!Number.isFinite(poQty) || !Number.isFinite(poUnitPrice)) return;
    const budgetRaw = r[10] !== undefined && String(r[10]).trim() !== ''
      ? Number(String(r[10]).replace(/[^0-9.-]/g, ''))
      : null;
    const grnNo = String(r[1] || '').trim();
    const grnPosted = Boolean(grnNo && !/pending|none|missing|-|^$/i.test(grnNo) && (Number.isFinite(grnQty) ? grnQty > 0 : false));
    packets.push({
      id: `csv_p2p_${idx}_${Date.now()}`,
      poNo: String(r[0] || `PO-${idx + 1}`).trim(),
      grnNo: grnNo || '(Pending)',
      invoiceNo: String(r[2] || `INV-${idx + 1}`).trim(),
      supplier: String(r[3] || 'Supplier').trim(),
      item: String(r[4] || 'Line Item').trim(),
      costCentre: String(r[11] || 'General Operations').trim(),
      budgetRemaining: Number.isFinite(budgetRaw) ? budgetRaw : null,
      poApproved: r[12] ? !/false|no|0/i.test(String(r[12])) : true,
      grnPosted,
      duplicateInvoice: r[13] ? /true|yes|1/i.test(String(r[13])) : false,
      poQty: Math.max(0, poQty),
      poUnitPrice: Math.max(0, poUnitPrice),
      grnQty: Number.isFinite(grnQty) ? Math.max(0, grnQty) : 0,
      invQty: Number.isFinite(invQty) ? Math.max(0, invQty) : 0,
      invUnitPrice: Number.isFinite(invUnitPrice) ? Math.max(0, invUnitPrice) : 0,
    });
  });
  return packets;
}

export default function TheMatchLab({
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
    () => THE_MATCH_PRESETS.find((p) => p.id === (config?.presetId || 'hospital_p2p')) || THE_MATCH_PRESETS[0],
    [config?.presetId],
  );

  const initialSource = config?.customDataset?.packets?.length
    ? {
        name: config.customDataset.name || 'Lecturer P2P Dataset',
        currency: config.customDataset.currency || 'GHS',
        priceTolPct: config.customDataset.priceTolPct ?? 2,
        qtyTolPct: config.customDataset.qtyTolPct ?? 0,
        context: config.customDataset.context || defaultPreset.context,
        packets: config.customDataset.packets,
        users: config.customDataset.users?.length ? config.customDataset.users : defaultPreset.users,
      }
    : defaultPreset;

  const [activeTab, setActiveTab] = useState(draftState?.activeTab || 'audit');
  const [datasetName, setDatasetName] = useState(draftState?.datasetName || initialSource.name);
  const [currency, setCurrency] = useState(draftState?.currency || initialSource.currency || 'GHS');
  const [priceTolPct, setPriceTolPct] = useState(
    draftState?.priceTolPct !== undefined ? draftState.priceTolPct : (initialSource.priceTolPct ?? 2),
  );
  const [qtyTolPct, setQtyTolPct] = useState(
    draftState?.qtyTolPct !== undefined ? draftState.qtyTolPct : (initialSource.qtyTolPct ?? 0),
  );
  const [packets, setPackets] = useState(() =>
    draftState?.packets?.length ? draftState.packets : initialSource.packets.map((p) => ({ ...p })),
  );
  const [selectedPacketId, setSelectedPacketId] = useState(
    () => draftState?.selectedPacketId || (draftState?.packets?.[0]?.id || initialSource.packets[0]?.id || ''),
  );
  const [decisions, setDecisions] = useState(() => draftState?.decisions || {});
  const [auditRevealed, setAuditRevealed] = useState(Boolean(draftState?.auditRevealed));

  const [showAddPacket, setShowAddPacket] = useState(false);
  const [newPkt, setNewPkt] = useState({
    poNo: 'PO-2026-099',
    grnNo: 'GRN-0991',
    invoiceNo: 'INV-9901',
    supplier: 'Custom Vendor Ltd',
    item: 'Printer Toner Cartridge',
    costCentre: 'Administration',
    budgetRemaining: '15000',
    poQty: '20',
    poUnitPrice: '420',
    grnQty: '18',
    invQty: '20',
    invUnitPrice: '420',
    duplicateInvoice: false,
  });

  const [fraudMode, setFraudMode] = useState(draftState?.fraudMode || 'segregated');
  const [fraudVendor, setFraudVendor] = useState(draftState?.fraudVendor || 'Phantom Logistics Ltd (Shell Vendor)');
  const [fraudItem, setFraudItem] = useState(draftState?.fraudItem || 'IT Consulting & Emergency Spares');
  const [fraudQty, setFraudQty] = useState(draftState?.fraudQty ?? 100);
  const [fraudPrice, setFraudPrice] = useState(draftState?.fraudPrice ?? 450);
  const [fraudSteps, setFraudSteps] = useState(() => draftState?.fraudSteps || {
    poRaised: false,
    grnFaked: false,
    invoicePosted: false,
    matched: false,
  });
  const [fraudLog, setFraudLog] = useState(() => draftState?.fraudLog || []);
  const [fraudCompletedSuperuser, setFraudCompletedSuperuser] = useState(
    Boolean(draftState?.fraudCompletedSuperuser),
  );

  const [users, setUsers] = useState(() =>
    draftState?.users?.length ? cloneUsers(draftState.users) : cloneUsers(initialSource.users),
  );
  const [newUserName, setNewUserName] = useState('');
  const [newUserDept, setNewUserDept] = useState('Procurement');
  const [judgement, setJudgement] = useState(draftState?.judgement || '');

  useEffect(() => {
    onDraftChange?.({
      activeTab,
      datasetName,
      currency,
      priceTolPct,
      qtyTolPct,
      packets,
      selectedPacketId,
      decisions,
      auditRevealed,
      fraudMode,
      fraudVendor,
      fraudItem,
      fraudQty,
      fraudPrice,
      fraudSteps,
      fraudLog,
      fraudCompletedSuperuser,
      users,
      judgement,
    });
  }, [
    activeTab,
    datasetName,
    currency,
    priceTolPct,
    qtyTolPct,
    packets,
    selectedPacketId,
    decisions,
    auditRevealed,
    fraudMode,
    fraudVendor,
    fraudItem,
    fraudQty,
    fraudPrice,
    fraudSteps,
    fraudLog,
    fraudCompletedSuperuser,
    users,
    judgement,
  ]);

  const evaluations = useMemo(() => {
    const map = {};
    packets.forEach((p) => {
      map[p.id] = evaluateThreeWayMatch(p, { priceTolPct, qtyTolPct });
    });
    return map;
  }, [packets, priceTolPct, qtyTolPct]);

  const auditSummary = useMemo(() => {
    let decided = 0;
    let correct = 0;
    let engineBlocked = 0;
    let engineReleased = 0;
    let blockedValue = 0;
    let releasedValue = 0;
    packets.forEach((p) => {
      const ev = evaluations[p.id];
      if (!ev) return;
      if (ev.decision === 'BLOCK') {
        engineBlocked += 1;
        blockedValue += ev.invTotal;
      } else {
        engineReleased += 1;
        releasedValue += ev.invTotal;
      }
      if (decisions[p.id]) {
        decided += 1;
        if (decisions[p.id] === ev.decision) correct += 1;
      }
    });
    const accuracyPct = packets.length ? Math.round((correct / packets.length) * 100) : 0;
    return {
      total: packets.length,
      decided,
      correct,
      accuracyPct,
      engineBlocked,
      engineReleased,
      blockedValue,
      releasedValue,
    };
  }, [packets, evaluations, decisions]);

  const selectedPacket = useMemo(
    () => packets.find((p) => p.id === selectedPacketId) || packets[0] || null,
    [packets, selectedPacketId],
  );

  const initialSodAudit = useMemo(
    () => auditSegregationOfDuties(initialSource.users || DEFAULT_USERS),
    [initialSource.users],
  );
  const sodAudit = useMemo(() => auditSegregationOfDuties(users), [users]);

  const fraudEval = useMemo(() => {
    const qty = Math.max(1, Number(fraudQty) || 1);
    const price = Math.max(1, Number(fraudPrice) || 1);
    return evaluateThreeWayMatch(
      {
        poNo: 'PO-FRAUD-901',
        grnNo: fraudSteps.grnFaked ? 'GRN-FAKE-901' : '(Pending)',
        invoiceNo: 'INV-FAKE-901',
        supplier: fraudVendor,
        item: fraudItem,
        poApproved: fraudSteps.poRaised,
        grnPosted: fraudSteps.grnFaked,
        duplicateInvoice: false,
        budgetRemaining: qty * price * 2,
        poQty: qty,
        poUnitPrice: price,
        grnQty: fraudSteps.grnFaked ? qty : 0,
        invQty: fraudSteps.invoicePosted ? qty : 0,
        invUnitPrice: price,
      },
      { priceTolPct, qtyTolPct },
    );
  }, [fraudVendor, fraudItem, fraudQty, fraudPrice, fraudSteps, priceTolPct, qtyTolPct]);

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const lines = [
        `LABORATORY: PSIS-LAB 04 — Procure-to-Pay Controls, Three-Way Matching & Segregation of Duties`,
        `DATASET: ${datasetName} (${packets.length} P2P invoice packets · Currency: ${currency})`,
        `TOLERANCE SETTINGS: Price Tolerance +/-${priceTolPct}% | Quantity Tolerance +${qtyTolPct}%`,
        ``,
        `1. THREE-WAY MATCH AUDIT SUMMARY`,
        `- Packets Reviewed: ${auditSummary.decided}/${auditSummary.total}`,
        `- Student Audit Accuracy vs Engine: ${auditSummary.correct}/${auditSummary.total} (${auditSummary.accuracyPct}%)`,
        `- Engine Released Payments: ${auditSummary.engineReleased} (${fmtMoney(auditSummary.releasedValue, currency)})`,
        `- Engine Blocked Payments: ${auditSummary.engineBlocked} (${fmtMoney(auditSummary.blockedValue, currency)} exposure prevented)`,
        ``,
        `PACKET-BY-PACKET AUDIT FINDINGS:`,
        ...packets.map((p, idx) => {
          const ev = evaluations[p.id];
          const studentChoice = decisions[p.id] || 'UNDECIDED';
          const reasons = ev.blocks.length
            ? ev.blocks.map((b) => `${b.code}: ${b.detail}`).join(' | ')
            : 'All 3 documents (PO, GRN, Invoice) and budget verified within tolerance.';
          return `${idx + 1}. ${p.poNo} / ${p.invoiceNo} (${p.supplier} — ${p.item})\n   PO: ${p.poQty} x ${p.poUnitPrice} | GRN: ${p.grnQty} | Invoice: ${p.invQty} x ${p.invUnitPrice} (${fmtMoney(ev.invTotal, currency)})\n   Student Decision: ${studentChoice} | System Engine: ${ev.decision}\n   Control Reason: ${reasons}`;
        }),
        ``,
        `2. GHOST-VENDOR FRAUD SIMULATION (SEGREGATION OF DUTIES FAILURE)`,
        `- Super-User Fraud Walkthrough Completed: ${fraudCompletedSuperuser ? 'YES — Verified that a single user holding Buyer + Storekeeper + Finance + Manager passes 3-way match cleanly.' : 'In progress'}`,
        `- Simulated Shell Invoice Value: ${fmtMoney((Number(fraudQty) || 0) * (Number(fraudPrice) || 0), currency)} to ${fraudVendor}`,
        ``,
        `3. ROLE ACCESS MATRIX & SEGREGATION OF DUTIES (SoD) AUDIT`,
        `- Initial Toxic Conflicts: ${initialSodAudit.violations.length} violation(s)`,
        `- Current Remaining Toxic Conflicts: ${sodAudit.violations.length} violation(s) (${sodAudit.cleanUsers}/${sodAudit.totalUsers} compliant accounts)`,
        ...(sodAudit.violations.length
          ? sodAudit.violations.map((v) => `  * [${v.severity.toUpperCase()}] ${v.userName}: ${v.title}`)
          : [`  * All user accounts remediated — zero toxic role combinations remain.`]),
        ``,
        `4. STUDENT WRITTEN INTERNAL CONTROL JUDGEMENT`,
        judgement.trim() || '(No written judgement provided yet.)',
      ];
      return {
        title: `P2P 3-Way Match & SoD Lab Report — ${datasetName}`,
        body: lines.join('\n'),
        hasJudgement: judgement.trim().length >= 25,
      };
    });
  }, [
    onRegisterReportBuilder,
    datasetName,
    currency,
    priceTolPct,
    qtyTolPct,
    packets,
    evaluations,
    decisions,
    auditSummary,
    fraudCompletedSuperuser,
    fraudQty,
    fraudPrice,
    fraudVendor,
    initialSodAudit,
    sodAudit,
    judgement,
  ]);

  function setPacketDecision(packetId, choice) {
    setDecisions((prev) => ({ ...prev, [packetId]: choice }));
  }

  function handlePresetChange(presetId) {
    const found = THE_MATCH_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setDatasetName(found.name);
    setCurrency(found.currency || 'GHS');
    setPriceTolPct(found.priceTolPct ?? 2);
    setQtyTolPct(found.qtyTolPct ?? 0);
    setPackets(found.packets.map((p) => ({ ...p })));
    setSelectedPacketId(found.packets[0]?.id || '');
    setDecisions({});
    setAuditRevealed(false);
    setUsers(cloneUsers(found.users));
    toast(`Loaded preset "${found.name}".`);
  }

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readLabSpreadsheetRows(file);
      const parsed = parseP2pCsvRows(rows);
      if (!parsed.length) {
        throw new Error('Could not parse P2P packets. Download the CSV template to see the exact columns.');
      }
      setDatasetName(file.name.replace(/\.[^.]+$/, ''));
      setPackets(parsed);
      setSelectedPacketId(parsed[0].id);
      setDecisions({});
      setAuditRevealed(false);
      toast(`Loaded ${parsed.length} P2P invoice packets from "${file.name}".`);
    } catch (err) {
      toast(err.message || 'Could not import P2P dataset.', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function handleAddCustomPacket(e) {
    e.preventDefault();
    const grnQtyNum = Math.max(0, Number(newPkt.grnQty) || 0);
    const pkt = {
      id: `custom_p2p_${Date.now()}`,
      poNo: newPkt.poNo.trim() || `PO-${packets.length + 1}`,
      grnNo: newPkt.grnNo.trim() || (grnQtyNum > 0 ? `GRN-${packets.length + 1}` : '(Pending)'),
      invoiceNo: newPkt.invoiceNo.trim() || `INV-${packets.length + 1}`,
      supplier: newPkt.supplier.trim() || 'Custom Supplier',
      item: newPkt.item.trim() || 'Procurement Item',
      costCentre: newPkt.costCentre.trim() || 'Operations',
      budgetRemaining: newPkt.budgetRemaining !== '' ? Number(newPkt.budgetRemaining) : null,
      poApproved: true,
      grnPosted: grnQtyNum > 0 && !/pending|none/i.test(newPkt.grnNo),
      duplicateInvoice: Boolean(newPkt.duplicateInvoice),
      poQty: Math.max(0, Number(newPkt.poQty) || 0),
      poUnitPrice: Math.max(0, Number(newPkt.poUnitPrice) || 0),
      grnQty: grnQtyNum,
      invQty: Math.max(0, Number(newPkt.invQty) || 0),
      invUnitPrice: Math.max(0, Number(newPkt.invUnitPrice) || 0),
    };
    setPackets((prev) => [...prev, pkt]);
    setSelectedPacketId(pkt.id);
    setShowAddPacket(false);
    toast(`Added ${pkt.poNo} to the 3-way match audit queue.`);
  }

  function exportAuditCsv() {
    const header = [
      'PO_No', 'GRN_No', 'Invoice_No', 'Supplier', 'Item',
      'PO_Qty', 'PO_UnitPrice', 'GRN_Qty', 'Inv_Qty', 'Inv_UnitPrice',
      'BudgetRemaining', 'Student_Decision', 'Engine_Decision', 'Block_Reasons',
    ];
    const csvRows = packets.map((p) => {
      const ev = evaluations[p.id];
      const reasons = ev.blocks.map((b) => b.code).join('; ');
      return [
        p.poNo, p.grnNo, p.invoiceNo,
        `"${String(p.supplier).replace(/"/g, '""')}"`,
        `"${String(p.item).replace(/"/g, '""')}"`,
        p.poQty, p.poUnitPrice, p.grnQty, p.invQty, p.invUnitPrice,
        p.budgetRemaining ?? '', decisions[p.id] || '', ev.decision, `"${reasons}"`,
      ].join(',');
    });
    downloadText('p2p-three-way-match-audit.csv', [header.join(','), ...csvRows].join('\n'));
  }

  function switchFraudMode(mode) {
    setFraudMode(mode);
    setFraudSteps({ poRaised: false, grnFaked: false, invoicePosted: false, matched: false });
    setFraudLog([
      mode === 'segregated'
        ? 'Switched to SEGREGATED CONTROL MODE: Logged in as Ama Mensah [Buyer role only].'
        : 'Switched to UNCONTROLLED SUPER-USER MODE: Logged in with [Buyer + Storekeeper + Finance + Manager] on one account.',
    ]);
  }

  function runFraudStep(stepKey) {
    const total = (Number(fraudQty) || 0) * (Number(fraudPrice) || 0);
    if (stepKey === 'po') {
      setFraudSteps((prev) => ({ ...prev, poRaised: true }));
      setFraudLog((prev) => [
        ...prev,
        `✓ STEP 1 [Buyer]: Raised PO-FRAUD-901 to "${fraudVendor}" for ${fraudQty} x ${fraudPrice} (${fmtMoney(total, currency)}).${fraudMode === 'superuser' ? ' Self-approved via Manager role.' : ''}`,
      ]);
      return;
    }
    if (stepKey === 'grn') {
      if (!fraudSteps.poRaised) {
        toast('Raise the Purchase Order first.', 'error');
        return;
      }
      if (fraudMode === 'segregated') {
        setFraudLog((prev) => [
          ...prev,
          `✕ STEP 2 BLOCKED BY RBAC: Account lacks [Storekeeper] permission. Buyer cannot self-certify Goods Receipt (GRN-FAKE-901). Fraud halted at the dock!`,
        ]);
        toast('Access denied: Buyer cannot post a Goods Receipt Note.', 'error');
        return;
      }
      setFraudSteps((prev) => ({ ...prev, grnFaked: true }));
      setFraudLog((prev) => [
        ...prev,
        `⚠ STEP 2 [Storekeeper on same account]: Posted phantom GRN-FAKE-901 confirming ${fraudQty} units received. Physical goods delivered: 0.`,
      ]);
      return;
    }
    if (stepKey === 'invoice') {
      if (!fraudSteps.grnFaked) {
        toast('A Goods Receipt must be posted before matching an invoice.', 'error');
        return;
      }
      if (fraudMode === 'segregated') {
        setFraudLog((prev) => [
          ...prev,
          `✕ STEP 3 BLOCKED BY RBAC: Account lacks [Finance / AP] permission to post supplier invoices.`,
        ]);
        return;
      }
      setFraudSteps((prev) => ({ ...prev, invoicePosted: true }));
      setFraudLog((prev) => [
        ...prev,
        `⚠ STEP 3 [Finance on same account]: Posted INV-FAKE-901 for ${fraudQty} x ${fraudPrice} (${fmtMoney(total, currency)}) matching the fake PO and fake GRN.`,
      ]);
      return;
    }
    if (stepKey === 'match') {
      if (!fraudSteps.invoicePosted) {
        toast('Post the supplier invoice first.', 'error');
        return;
      }
      setFraudSteps((prev) => ({ ...prev, matched: true }));
      setFraudCompletedSuperuser(true);
      setFraudLog((prev) => [
        ...prev,
        `● STEP 4 [3-Way Match Engine]: PO (${fraudQty} x ${fraudPrice}) == GRN (${fraudQty}) == Invoice (${fraudQty} x ${fraudPrice}). ZERO VARIANCE DETECTED — PAYMENT OF ${fmtMoney(total, currency)} RELEASED TO SHELL VENDOR.`,
      ]);
    }
  }

  function toggleUserRole(userId, roleId) {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== userId) return u;
        const has = u.roles.includes(roleId);
        return {
          ...u,
          roles: has ? u.roles.filter((r) => r !== roleId) : [...u.roles, roleId],
        };
      }),
    );
  }

  function addStaffUser(e) {
    e.preventDefault();
    if (!newUserName.trim()) return;
    setUsers((prev) => [
      ...prev,
      {
        id: `usr_${Date.now()}`,
        name: newUserName.trim(),
        department: newUserDept.trim() || 'Operations',
        roles: ['buyer'],
      },
    ]);
    setNewUserName('');
    toast('Added staff account to access matrix.');
  }

  function resetSodMatrix() {
    setUsers(cloneUsers(initialSource.users));
    toast('Reset user access matrix to initial pre-audit roles.');
  }

  return (
    <div className="stack">
      <div className="card stack-sm" style={{ padding: 14 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="tiny muted">PROCURE-TO-PAY CONTROL ENGINE · {datasetName}</div>
            <div className="small" style={{ marginTop: 2 }}>
              Inspect POs, Cost-Centre Budgets, Storekeeper GRNs, and Supplier Invoices — then test how Segregation of Duties protects the 3-way match.
            </div>
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            {canEditData && (
              <>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleCsvUpload} />
                <select
                  className="input"
                  style={{ width: 'auto', minWidth: 210, padding: '6px 10px', fontSize: 13 }}
                  value={THE_MATCH_PRESETS.some((p) => p.name === datasetName) ? (THE_MATCH_PRESETS.find((p) => p.name === datasetName)?.id || '') : ''}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  aria-label="Starter P2P Preset"
                >
                  <option value="" disabled>Custom Dataset Active</option>
                  {THE_MATCH_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const tpl = buildLabCsvTemplate('psis_the_match');
                    downloadText(tpl.filename, tpl.content);
                  }}
                >
                  <Icon name="download" size={13} /> CSV Template
                </button>
                <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={13} /> Upload P2P Data
                </button>
              </>
            )}
            <button type="button" className="btn btn-sm" onClick={exportAuditCsv}>
              <Icon name="download" size={13} /> Export Audit CSV
            </button>
          </div>
        </div>

        <div className="row-wrap" style={{ gap: 6, paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
          {[
            { id: 'audit', label: `1. 3-Way Match Audit (${auditSummary.decided}/${auditSummary.total})` },
            { id: 'fraud', label: `2. Ghost-Vendor Fraud Demo${fraudCompletedSuperuser ? ' ✓' : ''}` },
            { id: 'sod', label: `3. SoD Access Matrix (${sodAudit.violations.length} conflicts)` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'audit' && (
        <div className="stack">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">PRICE TOLERANCE</div>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <input
                  type="number"
                  min="0"
                  max="25"
                  step="0.5"
                  className="input mono"
                  style={{ width: 74, padding: '4px 8px' }}
                  value={priceTolPct}
                  onChange={(e) => setPriceTolPct(Math.max(0, Number(e.target.value) || 0))}
                />
                <span className="small muted">% max over PO</span>
              </div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">QTY TOLERANCE</div>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="1"
                  className="input mono"
                  style={{ width: 74, padding: '4px 8px' }}
                  value={qtyTolPct}
                  onChange={(e) => setQtyTolPct(Math.max(0, Number(e.target.value) || 0))}
                />
                <span className="small muted">% over GRN</span>
              </div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">YOUR DECISIONS</div>
              <div className="kpi mono" style={{ fontSize: 22, marginTop: 4 }}>
                {auditSummary.decided}/{auditSummary.total}
              </div>
              <div className="tiny muted">Packets classified</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">ENGINE AUDIT SCORE</div>
              <div
                className="kpi mono"
                style={{
                  fontSize: 22,
                  marginTop: 4,
                  color: !auditRevealed ? 'var(--muted)' : auditSummary.accuracyPct >= 80 ? 'var(--teal-700)' : 'var(--red)',
                }}
              >
                {auditRevealed ? `${auditSummary.correct}/${auditSummary.total} (${auditSummary.accuracyPct}%)` : 'Hidden'}
              </div>
              <div className="tiny muted">
                {auditRevealed
                  ? `Blocked exposure: ${fmtMoney(auditSummary.blockedValue, currency)}`
                  : 'Run check to grade'}
              </div>
            </div>
          </div>

          <div className="lab-split-grid">
            <div className="card stack-sm" style={{ padding: 14 }}>
              <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>Accounts Payable Matching Queue</strong>
                  <div className="tiny muted">Select each packet to inspect PO, Budget, GRN, and Invoice evidence.</div>
                </div>
                <div className="row-wrap" style={{ gap: 6 }}>
                  {canEditData && (
                    <button type="button" className="btn btn-sm" onClick={() => setShowAddPacket((v) => !v)}>
                      <Icon name="plus" size={13} /> Add Packet
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setAuditRevealed(true);
                      toast(`3-Way Match Engine executed: ${auditSummary.engineReleased} released, ${auditSummary.engineBlocked} blocked.`);
                    }}
                  >
                    <Icon name="check" size={13} /> {auditRevealed ? 'Re-Run Match Check' : 'Run Automated 3-Way Match'}
                  </button>
                </div>
              </div>

              {showAddPacket && canEditData && (
                <form onSubmit={handleAddCustomPacket} className="card-soft stack-sm" style={{ padding: 12 }}>
                  <strong className="small">Add Custom P2P Invoice Packet</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                    <label className="stack-xs tiny muted">PO No<input className="input mono" value={newPkt.poNo} onChange={(e) => setNewPkt({ ...newPkt, poNo: e.target.value })} required /></label>
                    <label className="stack-xs tiny muted">GRN No<input className="input mono" value={newPkt.grnNo} onChange={(e) => setNewPkt({ ...newPkt, grnNo: e.target.value })} /></label>
                    <label className="stack-xs tiny muted">Invoice No<input className="input mono" value={newPkt.invoiceNo} onChange={(e) => setNewPkt({ ...newPkt, invoiceNo: e.target.value })} required /></label>
                    <label className="stack-xs tiny muted">Supplier<input className="input" value={newPkt.supplier} onChange={(e) => setNewPkt({ ...newPkt, supplier: e.target.value })} required /></label>
                    <label className="stack-xs tiny muted">Item<input className="input" value={newPkt.item} onChange={(e) => setNewPkt({ ...newPkt, item: e.target.value })} required /></label>
                    <label className="stack-xs tiny muted">Budget ({currency})<input className="input mono" type="number" value={newPkt.budgetRemaining} onChange={(e) => setNewPkt({ ...newPkt, budgetRemaining: e.target.value })} /></label>
                    <label className="stack-xs tiny muted">PO Qty<input className="input mono" type="number" value={newPkt.poQty} onChange={(e) => setNewPkt({ ...newPkt, poQty: e.target.value })} /></label>
                    <label className="stack-xs tiny muted">PO Unit Price<input className="input mono" type="number" step="any" value={newPkt.poUnitPrice} onChange={(e) => setNewPkt({ ...newPkt, poUnitPrice: e.target.value })} /></label>
                    <label className="stack-xs tiny muted">GRN Qty<input className="input mono" type="number" value={newPkt.grnQty} onChange={(e) => setNewPkt({ ...newPkt, grnQty: e.target.value })} /></label>
                    <label className="stack-xs tiny muted">Invoice Qty<input className="input mono" type="number" value={newPkt.invQty} onChange={(e) => setNewPkt({ ...newPkt, invQty: e.target.value })} /></label>
                    <label className="stack-xs tiny muted">Inv Unit Price<input className="input mono" type="number" step="any" value={newPkt.invUnitPrice} onChange={(e) => setNewPkt({ ...newPkt, invUnitPrice: e.target.value })} /></label>
                  </div>
                  <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <label className="check tiny">
                      <input type="checkbox" checked={newPkt.duplicateInvoice} onChange={(e) => setNewPkt({ ...newPkt, duplicateInvoice: e.target.checked })} />
                      Flag as duplicate invoice number
                    </label>
                    <div className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn btn-sm" onClick={() => setShowAddPacket(false)}>Cancel</button>
                      <button type="submit" className="btn btn-primary btn-sm">Add to Queue</button>
                    </div>
                  </div>
                </form>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Packet</th>
                      <th>Supplier &amp; Item</th>
                      <th className="mono" style={{ textAlign: 'right' }}>Invoice Total</th>
                      <th>Your Decision</th>
                      {auditRevealed && <th>Engine</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {packets.map((p) => {
                      const ev = evaluations[p.id];
                      const myChoice = decisions[p.id] || '';
                      const isSel = selectedPacket?.id === p.id;
                      const matchOk = auditRevealed && myChoice && myChoice === ev.decision;
                      return (
                        <tr
                          key={p.id}
                          onClick={() => setSelectedPacketId(p.id)}
                          style={{
                            cursor: 'pointer',
                            background: isSel ? 'var(--teal-50)' : undefined,
                          }}
                        >
                          <td className="mono small">
                            <div style={{ fontWeight: 600 }}>{p.poNo}</div>
                            <div className="tiny muted">{p.invoiceNo}</div>
                          </td>
                          <td className="small">
                            <div style={{ fontWeight: 500 }}>{p.supplier}</div>
                            <div className="tiny muted">{p.item}</div>
                          </td>
                          <td className="mono small" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {fmtMoney(ev.invTotal, currency)}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="row" style={{ gap: 4 }}>
                              <button
                                type="button"
                                className={`btn btn-sm ${myChoice === 'RELEASE' ? 'btn-primary' : ''}`}
                                style={{ padding: '4px 8px', fontSize: 12 }}
                                onClick={() => setPacketDecision(p.id, 'RELEASE')}
                              >
                                Release
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{
                                  padding: '4px 8px',
                                  fontSize: 12,
                                  background: myChoice === 'BLOCK' ? 'var(--red)' : undefined,
                                  color: myChoice === 'BLOCK' ? '#fff' : undefined,
                                  borderColor: myChoice === 'BLOCK' ? 'var(--red)' : undefined,
                                }}
                                onClick={() => setPacketDecision(p.id, 'BLOCK')}
                              >
                                Block
                              </button>
                            </div>
                          </td>
                          {auditRevealed && (
                            <td className="mono tiny" style={{ whiteSpace: 'nowrap' }}>
                              <div style={{ fontWeight: 700, color: ev.decision === 'RELEASE' ? 'var(--teal-700)' : 'var(--red)' }}>
                                {ev.decision === 'RELEASE' ? '● RELEASE' : '▲ BLOCK'}
                              </div>
                              <div className="muted">
                                {!myChoice ? 'No answer' : matchOk ? '✓ Correct' : '✕ Mismatch'}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedPacket && (() => {
              const ev = evaluations[selectedPacket.id];
              return (
                <div className="card stack-sm" style={{ padding: 14 }}>
                  <div className="between" style={{ gap: 8 }}>
                    <div>
                      <div className="tiny muted">DOCUMENT EVIDENCE INSPECTOR</div>
                      <strong style={{ fontSize: 16 }}>
                        {selectedPacket.poNo} · {selectedPacket.supplier}
                      </strong>
                      <div className="small muted">{selectedPacket.item} ({selectedPacket.costCentre})</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                    <div className="card-soft stack-xs" style={{ padding: 10 }}>
                      <div className="tiny muted">1. BUYER — PURCHASE ORDER</div>
                      <div className="mono small" style={{ fontWeight: 700 }}>{selectedPacket.poNo}</div>
                      <div className="small">
                        Ordered: <span className="mono">{selectedPacket.poQty}</span> units @ <span className="mono">{fmtMoney(selectedPacket.poUnitPrice, currency)}</span>
                      </div>
                      <div className="mono small" style={{ fontWeight: 600 }}>
                        PO Total: {fmtMoney(ev.poTotal, currency)}
                      </div>
                    </div>

                    <div className="card-soft stack-xs" style={{ padding: 10 }}>
                      <div className="tiny muted">2. MANAGER — BUDGET CHECK</div>
                      <div className="small">
                        PO Approval: <span className="mono" style={{ fontWeight: 600 }}>{selectedPacket.poApproved ? '● APPROVED' : '▲ PENDING'}</span>
                      </div>
                      <div className="small">Cost Centre: {selectedPacket.costCentre}</div>
                      <div className="mono small" style={{ fontWeight: 600 }}>
                        Budget Left: {selectedPacket.budgetRemaining != null ? fmtMoney(selectedPacket.budgetRemaining, currency) : 'Not Set'}
                      </div>
                    </div>

                    <div className="card-soft stack-xs" style={{ padding: 10 }}>
                      <div className="tiny muted">3. STOREKEEPER — GOODS RECEIPT</div>
                      <div className="mono small" style={{ fontWeight: 700 }}>{selectedPacket.grnNo}</div>
                      <div className="small">
                        Status: <span className="mono" style={{ fontWeight: 600 }}>{selectedPacket.grnPosted ? '● RECEIVED ON DOCK' : '▲ NOT RECEIVED'}</span>
                      </div>
                      <div className="mono small" style={{ fontWeight: 600 }}>
                        Qty Received: {selectedPacket.grnQty} (Short: {ev.shortDeliveryQty})
                      </div>
                    </div>

                    <div className="card-soft stack-xs" style={{ padding: 10 }}>
                      <div className="tiny muted">4. FINANCE — SUPPLIER INVOICE</div>
                      <div className="mono small" style={{ fontWeight: 700 }}>{selectedPacket.invoiceNo}</div>
                      <div className="small">
                        Billed: <span className="mono">{selectedPacket.invQty}</span> units @ <span className="mono">{fmtMoney(selectedPacket.invUnitPrice, currency)}</span>
                      </div>
                      <div className="mono small" style={{ fontWeight: 600 }}>
                        Invoice Total: {fmtMoney(ev.invTotal, currency)}
                      </div>
                      {selectedPacket.duplicateInvoice && (
                        <div className="tiny mono" style={{ color: 'var(--red)', fontWeight: 700 }}>
                          ▲ DUPLICATE INVOICE NUMBER DETECTED IN AP LEDGER
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="card-soft between small" style={{ padding: '10px 12px', flexWrap: 'wrap', gap: 8 }}>
                    <span>
                      Price Diff vs PO: <strong className="mono">{ev.priceDiffPct >= 0 ? '+' : ''}{ev.priceDiffPct.toFixed(1)}%</strong>
                    </span>
                    <span>
                      Billed vs Received Value: <strong className="mono">{ev.varianceAmount >= 0 ? '+' : ''}{fmtMoney(ev.varianceAmount, currency)}</strong>
                    </span>
                  </div>

                  {auditRevealed ? (
                    ev.decision === 'RELEASE' ? (
                      <div className="notice small">
                        <strong className="mono">● ENGINE VERDICT: RELEASE PAYMENT</strong>
                        <div style={{ marginTop: 4 }}>
                          PO approval, cost-centre budget, physical Goods Receipt quantity, and supplier invoice price all match within tolerance.
                        </div>
                      </div>
                    ) : (
                      <div className="notice-err stack-xs small">
                        <strong className="mono">▲ ENGINE VERDICT: BLOCK PAYMENT ({ev.blocks.length} EXCEPTION{ev.blocks.length > 1 ? 'S' : ''})</strong>
                        {ev.blocks.map((b) => (
                          <div key={b.code}>
                            <span className="mono" style={{ fontWeight: 700 }}>[{b.code}]</span> {b.label} — {b.detail}
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    <div className="tiny muted">
                      Decide whether to <strong>Release</strong> or <strong>Block</strong> each packet in the table, then click <strong>Run Automated 3-Way Match</strong> to inspect system tolerances and compare your audit accuracy.
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {activeTab === 'fraud' && (
        <div className="lab-split-grid">
          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div className="tiny muted">THE SECOND HALF OF THE LESSON</div>
                <strong style={{ fontSize: 16 }}>Why 3-Way Match Fails Without Segregation of Duties</strong>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${fraudMode === 'segregated' ? 'btn-primary' : ''}`}
                  onClick={() => switchFraudMode('segregated')}
                >
                  Mode A: Segregated (Buyer Only)
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={fraudMode === 'superuser' ? { background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' } : undefined}
                  onClick={() => switchFraudMode('superuser')}
                >
                  Mode B: Super-User (All 4 Roles)
                </button>
              </div>
            </div>

            <div className={fraudMode === 'segregated' ? 'notice small' : 'notice-err small'}>
              {fraudMode === 'segregated' ? (
                <>
                  <strong>Active Account:</strong> Ama Mensah — Roles: <span className="mono">[buyer]</span>. Try executing all 4 steps of a ghost-vendor payment to see where role permissions stop the fraud.
                </>
              ) : (
                <>
                  <strong>Active Account:</strong> Uncontrolled Super-User — Roles: <span className="mono">[buyer, storekeeper, finance, manager]</span>. Step through the exact same transaction and watch a properly functioning 3-way match release payment for goods that never existed.
                </>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              <label className="stack-xs tiny muted">
                Shell Vendor Name
                <input className="input" value={fraudVendor} onChange={(e) => setFraudVendor(e.target.value)} />
              </label>
              <label className="stack-xs tiny muted">
                Fictitious Line Item
                <input className="input" value={fraudItem} onChange={(e) => setFraudItem(e.target.value)} />
              </label>
              <label className="stack-xs tiny muted">
                Qty
                <input className="input mono" type="number" min="1" value={fraudQty} onChange={(e) => setFraudQty(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="stack-xs tiny muted">
                Unit Price ({currency})
                <input className="input mono" type="number" min="1" value={fraudPrice} onChange={(e) => setFraudPrice(Math.max(1, Number(e.target.value) || 1))} />
              </label>
            </div>

            <div className="stack-xs">
              {[
                { key: 'po', step: 'STEP 1', role: 'Buyer + Manager', title: 'Raise & Approve PO-FRAUD-901 to Shell Vendor', done: fraudSteps.poRaised, actionLabel: 'Execute Step 1' },
                { key: 'grn', step: 'STEP 2', role: 'Storekeeper', title: 'Post Phantom GRN-FAKE-901 (Zero Physical Delivery)', done: fraudSteps.grnFaked, actionLabel: 'Execute Step 2' },
                { key: 'invoice', step: 'STEP 3', role: 'Finance / AP', title: 'Post Matching Supplier Invoice INV-FAKE-901', done: fraudSteps.invoicePosted, actionLabel: 'Execute Step 3' },
                { key: 'match', step: 'STEP 4', role: 'ERP Engine', title: 'Run Automated 3-Way Match & Payment Release', done: fraudSteps.matched, actionLabel: 'Run 3-Way Match' },
              ].map((s) => (
                <div
                  key={s.key}
                  className="card-soft between"
                  style={{
                    padding: '10px 12px',
                    gap: 10,
                    background: s.done ? (fraudMode === 'superuser' ? 'var(--red-50)' : 'var(--teal-50)') : undefined,
                  }}
                >
                  <div>
                    <div className="tiny mono muted">{s.step} · REQUIRED ROLE: {s.role.toUpperCase()}</div>
                    <div className="small" style={{ fontWeight: 600 }}>{s.title}</div>
                  </div>
                  <button
                    type="button"
                    className={`btn btn-sm ${s.done ? '' : 'btn-primary'}`}
                    onClick={() => runFraudStep(s.key)}
                  >
                    {s.done ? '✓ Executed' : s.actionLabel}
                  </button>
                </div>
              ))}
            </div>

            {fraudSteps.matched && (
              <div className="notice-err stack-xs small">
                <strong className="mono">
                  ● ERP RESULT: {fraudEval.decision} — {fmtMoney(fraudEval.invTotal, currency)} PAID TO {fraudVendor.toUpperCase()}
                </strong>
                <div>
                  The ERP 3-way match engine reported <strong>0 exceptions</strong> because all three documents agreed numerically. Without Segregation of Duties separating PO creation, physical receiving, and invoice posting across different people, an automated ERP validates fraud as clean.
                </div>
              </div>
            )}
          </div>

          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="between">
              <strong>System Event &amp; Permission Log</strong>
              <button type="button" className="btn btn-sm" onClick={() => switchFraudMode(fraudMode)}>
                Reset Demo
              </button>
            </div>
            <div className="tiny muted">
              Every permission check and document event is recorded below in append-only order.
            </div>
            <div className="stack-xs" style={{ maxHeight: 360, overflowY: 'auto' }}>
              {fraudLog.length === 0 ? (
                <div className="card-soft small muted" style={{ padding: 12 }}>
                  Click <strong>Execute Step 1</strong> to start in Segregated Mode, then switch to <strong>Mode B: Super-User</strong> to observe how collapsing all four roles defeats the 3-way match.
                </div>
              ) : (
                fraudLog.map((entry, idx) => (
                  <div
                    key={idx}
                    className="card-soft mono tiny"
                    style={{
                      padding: '8px 10px',
                      color: entry.startsWith('✕')
                        ? 'var(--teal-700)'
                        : entry.startsWith('●') || entry.startsWith('⚠')
                          ? 'var(--red)'
                          : 'var(--text)',
                    }}
                  >
                    <span className="muted">#{idx + 1} </span>
                    {entry}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sod' && (
        <div className="stack">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">ACCOUNTS AUDITED</div>
              <div className="kpi mono" style={{ fontSize: 22, marginTop: 4 }}>{sodAudit.totalUsers}</div>
              <div className="tiny muted">{sodAudit.cleanUsers} compliant</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">CONFLICTING ACCOUNTS</div>
              <div className="kpi mono" style={{ fontSize: 22, marginTop: 4, color: sodAudit.violatingUsers ? 'var(--red)' : 'var(--teal-700)' }}>
                {sodAudit.violatingUsers}
              </div>
              <div className="tiny muted">Holding toxic role pairs</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">ACTIVE SoD VIOLATIONS</div>
              <div className="kpi mono" style={{ fontSize: 22, marginTop: 4, color: sodAudit.violations.length ? 'var(--red)' : 'var(--teal-700)' }}>
                {sodAudit.violations.length}
              </div>
              <div className="tiny muted">Started with {initialSodAudit.violations.length}</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">CONTROL STATUS</div>
              <div
                className="mono small"
                style={{
                  fontWeight: 700,
                  marginTop: 8,
                  color: sodAudit.violations.length === 0 ? 'var(--teal-700)' : 'var(--red)',
                }}
              >
                {sodAudit.violations.length === 0 ? '● COMPLIANT (0 CONFLICTS)' : '▲ AUDIT BREACH'}
              </div>
              <div className="tiny muted" style={{ marginTop: 4 }}>Remediate roles below</div>
            </div>
          </div>

          <div className="lab-split-grid">
            <div className="card stack-sm" style={{ padding: 14 }}>
              <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>User Role Assignment Matrix</strong>
                  <div className="tiny muted">Uncheck incompatible roles until all Segregation of Duties conflicts are eliminated.</div>
                </div>
                <button type="button" className="btn btn-sm" onClick={resetSodMatrix}>
                  Reset Roles
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Staff Account</th>
                      {ROLES.map((r) => (
                        <th key={r.id} style={{ textAlign: 'center' }} title={r.scope}>{r.label}</th>
                      ))}
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const userViolations = sodAudit.violations.filter((v) => v.userId === u.id);
                      return (
                        <tr key={u.id}>
                          <td className="small">
                            <div style={{ fontWeight: 600 }}>{u.name}</div>
                            <div className="tiny muted">{u.department}</div>
                          </td>
                          {ROLES.map((r) => (
                            <td key={r.id} style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                aria-label={`${u.name} ${r.label}`}
                                checked={u.roles.includes(r.id)}
                                onChange={() => toggleUserRole(u.id, r.id)}
                              />
                            </td>
                          ))}
                          <td className="mono tiny" style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
                            {userViolations.length === 0 ? (
                              <span style={{ color: 'var(--teal-700)' }}>● CLEAN</span>
                            ) : (
                              <span style={{ color: 'var(--red)' }}>▲ {userViolations.length} CONFLICT{userViolations.length > 1 ? 'S' : ''}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <form onSubmit={addStaffUser} className="row-wrap" style={{ gap: 8, paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
                <input
                  className="input"
                  style={{ flex: '1 1 160px' }}
                  placeholder="Add staff name…"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                />
                <input
                  className="input"
                  style={{ flex: '1 1 130px' }}
                  placeholder="Department"
                  value={newUserDept}
                  onChange={(e) => setNewUserDept(e.target.value)}
                />
                <button type="submit" className="btn btn-sm">
                  <Icon name="plus" size={13} /> Add User
                </button>
              </form>
            </div>

            <div className="card stack-sm" style={{ padding: 14 }}>
              <strong>Detected Toxic Role Combinations</strong>
              {sodAudit.violations.length === 0 ? (
                <div className="notice small">
                  <strong className="mono">● ZERO TOXIC CONFLICTS</strong>
                  <div style={{ marginTop: 4 }}>
                    Every user account respects Segregation of Duties across Procurement, Receiving, Finance, and Management approval.
                  </div>
                </div>
              ) : (
                <div className="stack-xs">
                  {sodAudit.violations.map((v, i) => (
                    <div
                      key={`${v.userId}_${v.ruleId}_${i}`}
                      className={v.severity === 'critical' ? 'notice-err stack-xs small' : 'notice-warn stack-xs small'}
                      style={{ padding: '10px 12px' }}
                    >
                      <div className="between" style={{ gap: 8 }}>
                        <strong>{v.userName}</strong>
                        <span className="mono tiny" style={{ fontWeight: 700 }}>{v.severity.toUpperCase()}</span>
                      </div>
                      <div style={{ fontWeight: 600 }}>{v.title}</div>
                      <div className="tiny">{v.risk}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="stack-xs" style={{ paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
                <div className="tiny muted" style={{ fontWeight: 600 }}>REFERENCE: 5 TOXIC P2P ROLE PAIRS</div>
                {SOD_TOXIC_RULES.map((rule) => (
                  <div key={rule.id} className="tiny muted">
                    <span className="mono" style={{ fontWeight: 600, color: 'var(--text)' }}>[{rule.severity.toUpperCase()}]</span> {rule.title}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card stack-sm" style={{ padding: 16 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong>Written Internal Control Judgement (Required Deliverable)</strong>
            <div className="tiny muted">
              Explain which invoices you blocked and why, why the Super-User bypassed a working 3-way match, and what minimum role separation prevents ghost-vendor fraud.
            </div>
          </div>
          <span className="tiny mono muted">{judgement.trim().length} chars</span>
        </div>
        <textarea
          className="input"
          rows={5}
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
          placeholder="Example: In the P2P audit, I blocked PO-2026-042 (short delivery of 80 units), PO-2026-043 (+11.3% unit price variance above 2% tolerance), PO-2026-044 (no Goods Receipt posted), PO-2026-045 (duplicate invoice), and PO-2026-046 (exceeded cost-centre budget). In the fraud walkthrough, the 3-way match released payment to Phantom Logistics because one account controlled PO creation, GRN confirmation, and invoice posting..."
        />
      </div>
    </div>
  );
}
