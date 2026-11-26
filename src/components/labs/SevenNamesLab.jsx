import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { useToast } from '../ui.jsx';
import {
  buildLabCsvTemplate,
  getLabPreset,
  readLabSpreadsheetRows,
  SEVEN_NAMES_PRESETS,
} from '../../lib/labsCatalog.js';
import {
  findMasterDataDuplicates,
  skuSimilarityScore,
} from '../../lib/psisLabEngine.js';
import { downloadText } from '../../lib/sheets.js';

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function SevenNamesLab({
  config,
  dataMode = 'both',
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const toast = useToast();
  const defaultPreset = useMemo(
    () => getLabPreset('psis_seven_names', config?.presetId) || SEVEN_NAMES_PRESETS[0],
    [config?.presetId],
  );
  const lecturerCustom = config?.customDataset || null;
  const allowStudentEdit = dataMode !== 'lecturer_only';

  const [view, setView] = useState(draftState?.view || 'dock');
  const [presetId, setPresetId] = useState(draftState?.presetId || defaultPreset.id);
  const [caseName, setCaseName] = useState(draftState?.caseName || lecturerCustom?.name || defaultPreset.name);
  const [masterItems, setMasterItems] = useState(
    draftState?.masterItems || lecturerCustom?.masterItems || defaultPreset.masterItems.map((x) => ({ ...x })),
  );
  const [dockets, setDockets] = useState(
    draftState?.dockets || lecturerCustom?.dockets || defaultPreset.dockets.map((x) => ({ ...x, status: 'pending', action: null, chosenCode: null })),
  );
  const [activeIdx, setActiveIdx] = useState(draftState?.activeIdx || 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [threshold, setThreshold] = useState(draftState?.threshold ?? 0.52);
  const [timerActive, setTimerActive] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(draftState?.elapsedSec || 0);
  const [judgement, setJudgement] = useState(draftState?.judgement || '');
  const [importError, setImportError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (!timerActive) return undefined;
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timerActive]);

  useEffect(() => {
    onDraftChange?.({
      view,
      presetId,
      caseName,
      masterItems,
      dockets,
      activeIdx,
      threshold,
      elapsedSec,
      judgement,
    });
  }, [view, presetId, caseName, masterItems, dockets, activeIdx, threshold, elapsedSec, judgement]);

  const pendingDockets = useMemo(() => dockets.filter((d) => d.status !== 'done'), [dockets]);
  const activeDocket = dockets[activeIdx] || pendingDockets[0] || null;
  const completedCount = dockets.length - pendingDockets.length;
  const createdByClerkCount = useMemo(
    () => dockets.filter((d) => d.action === 'created').length,
    [dockets],
  );
  const matchedCorrectCount = useMemo(
    () => dockets.filter((d) => d.action === 'matched' && (!d.trueCode || d.chosenCode === d.trueCode)).length,
    [dockets],
  );

  const searchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return masterItems;
    const lower = q.toLowerCase();
    return masterItems
      .map((item) => ({
        item,
        score: item.code.toLowerCase().includes(lower) || item.name.toLowerCase().includes(lower)
          ? 1
          : skuSimilarityScore(q, item.name),
      }))
      .filter((x) => x.score >= 0.22)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }, [masterItems, searchQuery]);

  const audit = useMemo(
    () => findMasterDataDuplicates(masterItems, threshold),
    [masterItems, threshold],
  );

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const lines = [
        `LABORATORY: PSIS-LAB 02 — Item Master Data Governance & SKU Deduplication`,
        `DATASET: ${caseName}`,
        `DOCK SIMULATION TIME: ${fmtTime(elapsedSec)}`,
        ``,
        `1. RECEIVING DOCK PERFORMANCE`,
        `- Delivery Dockets Processed: ${completedCount}/${dockets.length}`,
        `- Matched to Existing Canonical SKU: ${matchedCorrectCount}`,
        `- Quick-Created New SKU Records: ${createdByClerkCount}`,
        ``,
        `2. ITEM MASTER HYGIENE AUDIT (SIMILARITY THRESHOLD: ${Math.round(threshold * 100)}%)`,
        `- Total Item Master Records: ${audit.totalRecords}`,
        `- Estimated Distinct Physical Products: ${audit.uniquePhysicalItems}`,
        `- Extra Duplicate Records Created: ${audit.extraDuplicateRecords} (${audit.duplicateRatePct.toFixed(1)}%)`,
        `- Master Data Hygiene Score: ${audit.hygieneScore}%`,
        ``,
        `DUPLICATE CLUSTERS & FRAGMENTED STOCK:`,
        ...(audit.duplicateClusters.length
          ? audit.duplicateClusters.map((c, idx) => (
              `${idx + 1}. "${c.primaryName}" — ${c.count} separate SKU codes · Combined Physical Stock = ${c.totalStock} units\n   Codes: ${c.members.map((m) => `${m.code} (${m.stock} u): ${m.name}`).join(' | ')}`
            ))
          : ['No duplicate clusters detected at the current threshold.']),
        ``,
        `3. STUDENT WRITTEN GOVERNANCE JUDGEMENT`,
        judgement.trim() || '(No written judgement provided yet.)',
      ];
      return {
        title: `Master Data Duplicate Audit Report — ${caseName}`,
        body: lines.join('\n'),
        hasJudgement: judgement.trim().length >= 25,
      };
    });
  }, [
    onRegisterReportBuilder,
    caseName,
    elapsedSec,
    completedCount,
    dockets.length,
    matchedCorrectCount,
    createdByClerkCount,
    threshold,
    audit,
    judgement,
  ]);

  function advanceNextPending(updatedDockets) {
    const nextIdx = updatedDockets.findIndex((d) => d.status !== 'done');
    if (nextIdx >= 0) {
      setActiveIdx(nextIdx);
      setSearchQuery('');
    } else {
      setTimerActive(false);
      setView('audit');
      toast('All trucks cleared! Review the Master Data Duplicate Audit reveal.');
    }
  }

  function handleReceiveToExisting(itemCode) {
    if (!activeDocket || activeDocket.status === 'done') return;
    setTimerActive(true);
    setMasterItems((prev) =>
      prev.map((it) => (it.code === itemCode ? { ...it, stock: (Number(it.stock) || 0) + activeDocket.qty } : it)),
    );
    const updated = dockets.map((d) =>
      d.id === activeDocket.id ? { ...d, status: 'done', action: 'matched', chosenCode: itemCode } : d,
    );
    setDockets(updated);
    toast(`Received +${activeDocket.qty} units into ${itemCode}.`);
    advanceNextPending(updated);
  }

  function handleQuickCreateSku() {
    if (!activeDocket || activeDocket.status === 'done') return;
    setTimerActive(true);
    const newCode = `SKU-${String(masterItems.length + 101)}`;
    const newRec = {
      code: newCode,
      name: activeDocket.docketText,
      stock: activeDocket.qty,
      canonicalId: activeDocket.canonicalId || null,
      createdByStudent: true,
    };
    setMasterItems((prev) => [...prev, newRec]);
    const updated = dockets.map((d) =>
      d.id === activeDocket.id ? { ...d, status: 'done', action: 'created', chosenCode: newCode } : d,
    );
    setDockets(updated);
    toast(`Quick-created ${newCode} ("${activeDocket.docketText}") and received ${activeDocket.qty} units.`);
    advanceNextPending(updated);
  }

  function loadPreset(pid) {
    const found = SEVEN_NAMES_PRESETS.find((p) => p.id === pid) || SEVEN_NAMES_PRESETS[0];
    setPresetId(found.id);
    setCaseName(found.name);
    setMasterItems(found.masterItems.map((x) => ({ ...x })));
    setDockets(found.dockets.map((x) => ({ ...x, status: 'pending', action: null, chosenCode: null })));
    setActiveIdx(0);
    setElapsedSec(0);
    setTimerActive(false);
    setView('dock');
    setSearchQuery('');
    toast(`Loaded preset "${found.name}".`);
  }

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    try {
      const rows = await readLabSpreadsheetRows(file);
      const parsed = [];
      rows.forEach((r, idx) => {
        if (r.length < 2) return;
        const stock = Number(String(r[2] ?? '0').replace(/[^0-9.-]/g, ''));
        if (idx === 0 && /code|sku|item|desc/i.test(String(r[0])) && !Number.isFinite(stock)) return;
        if (!String(r[0] || '').trim() && !String(r[1] || '').trim()) return;
        parsed.push({
          code: String(r[0] || `SKU-${idx + 1}`).trim(),
          name: String(r[1] || r[0] || `Item ${idx + 1}`).trim(),
          stock: Number.isFinite(stock) ? Math.max(0, stock) : 0,
          canonicalId: null,
        });
      });
      if (!parsed.length) throw new Error('Use columns: Code, ItemDescription, StockQty.');
      setCaseName(file.name.replace(/\.[^.]+$/, ''));
      setMasterItems(parsed);
      setView('audit');
      toast(`Imported ${parsed.length} SKU records for duplicate audit.`);
    } catch (err) {
      setImportError(err.message || 'Could not import CSV/Excel file.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function exportMasterCsv() {
    const header = 'Code,ItemDescription,StockQty,CreatedAtDock';
    const body = masterItems.map((m) =>
      `${m.code},"${String(m.name).replace(/"/g, '""')}",${m.stock},${m.createdByStudent ? 'Yes' : 'No'}`,
    );
    downloadText('item-master-audit.csv', [header, ...body].join('\n'));
  }

  return (
    <div className="stack">
      {/* Top Controls */}
      <div className="card stack-sm" style={{ padding: 14 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="tiny muted">MASTER DATA GOVERNANCE SIMULATOR · {caseName}</div>
            <div className="small" style={{ marginTop: 2 }}>
              Process waiting delivery trucks on the receiving dock, then audit the Item Master to see how quick-created SKUs fragment real stock levels.
            </div>
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            {allowStudentEdit && (
              <>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleCsvUpload} />
                <select
                  className="input"
                  style={{ width: 'auto', minWidth: 210, padding: '6px 10px', fontSize: 13 }}
                  value={presetId}
                  onChange={(e) => loadPreset(e.target.value)}
                  aria-label="Receiving Dock Preset"
                >
                  {SEVEN_NAMES_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const tpl = buildLabCsvTemplate('psis_seven_names');
                    downloadText(tpl.filename, tpl.content);
                  }}
                >
                  <Icon name="download" size={13} /> CSV Template
                </button>
                <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={13} /> Audit Own SKU CSV
                </button>
              </>
            )}
            <button type="button" className="btn btn-sm" onClick={exportMasterCsv}>
              <Icon name="download" size={13} /> Export Item Master
            </button>
          </div>
        </div>

        {importError && <div className="notice-err small">{importError}</div>}

        <div className="between" style={{ paddingTop: 10, borderTop: '1px solid var(--line-2)', flexWrap: 'wrap', gap: 8 }}>
          <div className="row-wrap" style={{ gap: 6 }}>
            <button
              type="button"
              className={`btn btn-sm ${view === 'dock' ? 'btn-primary' : ''}`}
              onClick={() => setView('dock')}
            >
              1. Receiving Dock ({pendingDockets.length} waiting)
            </button>
            <button
              type="button"
              className={`btn btn-sm ${view === 'audit' ? 'btn-primary' : ''}`}
              onClick={() => setView('audit')}
            >
              2. Duplicate Audit Reveal ({audit.duplicateClusters.length} clusters)
            </button>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <span className="tiny mono muted">QUEUE TIME: <strong>{fmtTime(elapsedSec)}</strong></span>
            <span className="tiny mono muted">HYGIENE: <strong style={{ color: audit.hygieneScore >= 85 ? 'var(--teal-700)' : 'var(--red)' }}>{audit.hygieneScore}%</strong></span>
          </div>
        </div>
      </div>

      {/* VIEW 1: RECEIVING DOCK SIMULATOR */}
      {view === 'dock' && (
        <div className="lab-split-grid">
          {/* Left: Active Delivery Docket & Queue */}
          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="between">
              <strong>Incoming Delivery Docket</strong>
              <span className="tiny mono" style={{ fontWeight: 700, color: pendingDockets.length ? 'var(--red)' : 'var(--teal-700)' }}>
                {pendingDockets.length ? `▲ ${pendingDockets.length} TRUCKS WAITING` : '● DOCK CLEAR'}
              </span>
            </div>

            {activeDocket && activeDocket.status !== 'done' ? (
              <div className="card-soft stack-sm" style={{ padding: 14 }}>
                <div className="between">
                  <span className="tiny muted">SUPPLIER: {activeDocket.supplier}</span>
                  <span className="mono small" style={{ fontWeight: 700 }}>QTY: {activeDocket.qty} units</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  “{activeDocket.docketText}”
                </div>
                <div className="tiny muted">
                  Search the Item Master on the right to post this receipt to the true canonical SKU, OR click Quick-Create below to clear the truck immediately under a new SKU code.
                </div>
                <div className="row-wrap" style={{ gap: 8, paddingTop: 4 }}>
                  <button type="button" className="btn btn-sm" onClick={handleQuickCreateSku}>
                    <Icon name="plus" size={13} /> Quick-Create New SKU (Fast — 1 Tap)
                  </button>
                </div>
              </div>
            ) : (
              <div className="notice small">
                <strong>● All delivery dockets processed.</strong> Switch to <strong>2. Duplicate Audit Reveal</strong> to inspect the Item Master you created.
              </div>
            )}

            <div className="stack-xs" style={{ paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
              <div className="tiny muted" style={{ fontWeight: 600 }}>DELIVERY QUEUE ({completedCount}/{dockets.length} RECEIVED)</div>
              {dockets.map((d, idx) => (
                <button
                  key={d.id}
                  type="button"
                  className="card-soft between small"
                  onClick={() => setActiveIdx(idx)}
                  style={{
                    padding: '8px 10px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: idx === activeIdx ? '1px solid var(--teal)' : '1px solid var(--line-2)',
                    background: idx === activeIdx ? 'var(--teal-50)' : undefined,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{d.docketText}</div>
                    <div className="tiny muted">{d.supplier} · {d.qty} units</div>
                  </div>
                  <span className="mono tiny" style={{ fontWeight: 700, color: d.status === 'done' ? (d.action === 'created' ? 'var(--red)' : 'var(--teal-700)') : 'var(--muted)' }}>
                    {d.status === 'done' ? (d.action === 'created' ? `▲ NEW ${d.chosenCode}` : `● ${d.chosenCode}`) : 'WAITING'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Right: Live Item Master Search */}
          <div className="card stack-sm" style={{ padding: 16 }}>
            <div>
              <strong>ERP Item Master Lookup ({masterItems.length} SKUs)</strong>
              <div className="tiny muted">Search by keyword, weight, or SKU code, then click Receive to post the active truck to that record.</div>
            </div>
            <input
              className="input"
              placeholder="Search Item Master (e.g., paper, gloves, 500ml, toner)…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>SKU Code</th>
                    <th>Description</th>
                    <th className="mono" style={{ textAlign: 'right' }}>On Hand</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((item) => (
                    <tr key={item.code}>
                      <td className="mono small" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{item.code}</td>
                      <td className="small">
                        {item.name}
                        {item.createdByStudent && (
                          <span className="tiny mono" style={{ marginLeft: 6, color: 'var(--red)', fontWeight: 600 }}>[NEW]</span>
                        )}
                      </td>
                      <td className="mono small" style={{ textAlign: 'right' }}>{item.stock}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={!activeDocket || activeDocket.status === 'done'}
                          onClick={() => handleReceiveToExisting(item.code)}
                        >
                          Receive
                        </button>
                      </td>
                    </tr>
                  ))}
                  {searchResults.length === 0 && (
                    <tr>
                      <td colSpan={4} className="small muted" style={{ textAlign: 'center', padding: 16 }}>
                        No SKU matched “{searchQuery}”. Try shorter keywords (e.g., “gloves” or “80g”).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: DUPLICATE AUDIT REVEAL */}
      {view === 'audit' && (
        <div className="stack">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">TOTAL MASTER RECORDS</div>
              <div className="kpi mono" style={{ fontSize: 22, marginTop: 4 }}>{audit.totalRecords}</div>
              <div className="tiny muted">Active SKU codes in ERP</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">TRUE PHYSICAL PRODUCTS</div>
              <div className="kpi mono" style={{ fontSize: 22, marginTop: 4 }}>{audit.uniquePhysicalItems}</div>
              <div className="tiny muted">Distinct items after clustering</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">DUPLICATE SKUs CREATED</div>
              <div className="kpi mono" style={{ fontSize: 22, marginTop: 4, color: audit.extraDuplicateRecords ? 'var(--red)' : 'var(--teal-700)' }}>
                {audit.extraDuplicateRecords}
              </div>
              <div className="tiny muted">{audit.duplicateRatePct.toFixed(1)}% catalog bloat</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="tiny muted">HYGIENE SCORE</div>
              <div className="kpi mono" style={{ fontSize: 22, marginTop: 4, color: audit.hygieneScore >= 85 ? 'var(--teal-700)' : 'var(--red)' }}>
                {audit.hygieneScore}%
              </div>
              <div className="tiny muted">
                Sensitivity: <span className="mono">{Math.round(threshold * 100)}%</span>
              </div>
            </div>
          </div>

          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div>
                <strong>Master Data Duplicate Clusters &amp; Fragmented Stock</strong>
                <div className="tiny muted">
                  Every record below looks accurate on its own screen, yet real inventory is fractured across duplicate codes.
                </div>
              </div>
              <label className="row tiny muted" style={{ gap: 8 }}>
                Match Threshold ({Math.round(threshold * 100)}%)
                <input
                  type="range"
                  min="0.35"
                  max="0.80"
                  step="0.01"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                />
              </label>
            </div>

            {audit.duplicateClusters.length === 0 ? (
              <div className="notice small">
                <strong className="mono">● ZERO DUPLICATE CLUSTERS DETECTED</strong>
                <div style={{ marginTop: 4 }}>
                  All {audit.totalRecords} records in your Item Master represent distinct physical items at the {Math.round(threshold * 100)}% similarity threshold.
                </div>
              </div>
            ) : (
              <div className="stack-sm">
                {audit.duplicateClusters.map((cluster) => (
                  <div key={cluster.id} className="notice-err stack-xs" style={{ padding: 12 }}>
                    <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <strong>{cluster.primaryName}</strong>
                      <span className="mono tiny" style={{ fontWeight: 700 }}>
                        ▲ {cluster.count} CODES · TRUE COMBINED STOCK: {cluster.totalStock} UNITS
                      </span>
                    </div>
                    <table className="table" style={{ background: 'var(--surface)', marginTop: 4 }}>
                      <thead>
                        <tr>
                          <th>SKU Code</th>
                          <th>Recorded Description</th>
                          <th className="mono" style={{ textAlign: 'right' }}>Visible Stock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cluster.members.map((m) => (
                          <tr key={m.code}>
                            <td className="mono small" style={{ fontWeight: 600 }}>{m.code}</td>
                            <td className="small">{m.name}</td>
                            <td className="mono small" style={{ textAlign: 'right' }}>{m.stock}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* WRITTEN JUDGEMENT */}
      <div className="card stack-sm" style={{ padding: 16 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong>Written Master Data Governance Judgement (Required Deliverable)</strong>
            <div className="tiny muted">
              Explain why receiving clerks create duplicate SKUs under queue pressure, how fragmented stock corrupts reorder points and spend analysis, and what ERP control prevents it.
            </div>
          </div>
          <span className="tiny mono muted">{judgement.trim().length} chars</span>
        </div>
        <textarea
          className="input"
          rows={5}
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
          placeholder="Write your managerial diagnosis citing your hygiene score, duplicate clusters, fragmented stock totals, and recommended Item Master governance policy..."
        />
      </div>
    </div>
  );
}
