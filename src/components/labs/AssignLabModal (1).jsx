import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { Field, Modal, useToast } from '../ui.jsx';
import { run, supabase } from '../../lib/supabase.js';
import { parseCourseMeta, serializeCourseMeta } from '../../lib/courseMeta.js';
import { serializeAssignmentMeta } from '../../lib/assignmentMeta.js';
import {
  buildLabCsvTemplate,
  DATA_POLICIES,
  getLabDef,
  readLabSpreadsheetRows,
} from '../../lib/labsCatalog.js';
import { parseSpcCsv } from '../../lib/tqmLabMath.js';
import { downloadText } from '../../lib/sheets.js';

function scaleRubric(criteria, maxMarks) {
  const total = Math.max(1, Number(maxMarks) || 100);
  const rawSum = criteria.reduce((s, c) => s + Number(c.maxMarks || 0), 0) || 100;
  const scaled = criteria.map((c) => ({
    ...c,
    maxMarks: Math.max(0.5, Math.round((c.maxMarks / rawSum) * total * 2) / 2),
  }));
  const diff = Math.round((total - scaled.reduce((s, c) => s + c.maxMarks, 0)) * 2) / 2;
  if (scaled.length && Math.abs(diff) > 0) {
    scaled[0].maxMarks = Math.max(0.5, Number((scaled[0].maxMarks + diff).toFixed(1)));
  }
  return scaled;
}

export default function AssignLabModal({
  labId,
  courses = [],
  lockedCourse = null,
  existingConfig = null,
  onSaved,
  onClose,
}) {
  const toast = useToast();
  const def = getLabDef(labId);
  const fileRef = useRef(null);

  const [courseId, setCourseId] = useState(lockedCourse?.id || courses[0]?.id || '');
  const selectedCourse = lockedCourse || courses.find((c) => c.id === courseId) || null;

  const [assignments, setAssignments] = useState([]);
  const [title, setTitle] = useState(existingConfig?.title || def?.title || '');
  const [enabled, setEnabled] = useState(existingConfig ? existingConfig.enabled !== false : true);
  const [dataMode, setDataMode] = useState(existingConfig?.dataMode || 'both');
  const [presetId, setPresetId] = useState(existingConfig?.presetId || def?.defaultPresetId || '');
  const [instructions, setInstructions] = useState(existingConfig?.instructions || def?.defaultPrompt || '');

  // Custom lecturer dataset state
  const [customDataset, setCustomDataset] = useState(existingConfig?.customDataset || null);
  const [customSpcType, setCustomSpcType] = useState(existingConfig?.customDataset?.chartType || 'xbar_r');
  const [customLsl, setCustomLsl] = useState(String(existingConfig?.customDataset?.lsl ?? ''));
  const [customUsl, setCustomUsl] = useState(String(existingConfig?.customDataset?.usl ?? ''));
  const [customRevenue, setCustomRevenue] = useState(String(existingConfig?.customDataset?.revenue ?? '2000000'));
  const [customUnits, setCustomUnits] = useState(String(existingConfig?.customDataset?.unitsProduced ?? '100000'));
  const [customCurrency, setCustomCurrency] = useState(existingConfig?.customDataset?.currency || 'GHS');
  const [uploadNote, setUploadNote] = useState('');

  // Assignment grading bridge
  const [gradeMode, setGradeMode] = useState(existingConfig?.linkedAssignmentId ? 'existing' : 'practice');
  const [linkedAssignmentId, setLinkedAssignmentId] = useState(existingConfig?.linkedAssignmentId || '');
  const [newAssignTitle, setNewAssignTitle] = useState(`${def?.shortTitle || 'Lab'} Assignment`);
  const [newAssignMarks, setNewAssignMarks] = useState('20');
  const [newAssignDue, setNewAssignDue] = useState('');
  const [newAssignPublish, setNewAssignPublish] = useState(true);
  const [saving, setSaving] = useState(false);

  // Sync existing config when switching course in LabsHub
  useEffect(() => {
    if (!selectedCourse) return;
    let alive = true;
    const meta = parseCourseMeta(selectedCourse);
    const found = existingConfig || (meta.labs_config || []).find((l) => l.labId === labId) || null;
    if (found) {
      setTitle(found.title || def?.title || '');
      setEnabled(found.enabled !== false);
      setDataMode(found.dataMode || 'both');
      setPresetId(found.presetId || def?.defaultPresetId || '');
      setInstructions(found.instructions || def?.defaultPrompt || '');
      setCustomDataset(found.customDataset || null);
      setLinkedAssignmentId(found.linkedAssignmentId || '');
      setGradeMode(found.linkedAssignmentId ? 'existing' : 'practice');
    } else if (!existingConfig) {
      setTitle(def?.title || '');
      setEnabled(true);
      setDataMode('both');
      setPresetId(def?.defaultPresetId || '');
      setInstructions(def?.defaultPrompt || '');
      setCustomDataset(null);
      setLinkedAssignmentId('');
      setGradeMode('practice');
    }
    supabase
      .from('assignments')
      .select('id, title, max_marks, due_at, published')
      .eq('course_id', selectedCourse.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (alive) setAssignments(data || []);
      });
    return () => { alive = false; };
  }, [selectedCourse?.id, labId]);

  if (!def) return null;

  async function handleCustomFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadNote('');
    try {
      const rows = await readLabSpreadsheetRows(file);
      const name = file.name.replace(/\.[^.]+$/, '');

      if (labId === 'tqm_spc') {
        const csv = rows.map((r) => r.join(',')).join('\n');
        const parsed = parseSpcCsv(csv, customSpcType);
        if (!parsed.length) throw new Error('Could not parse SPC rows for the selected chart type.');
        setCustomDataset({
          name,
          chartType: customSpcType,
          lsl: customLsl !== '' ? Number(customLsl) : null,
          usl: customUsl !== '' ? Number(customUsl) : null,
          ...(customSpcType === 'p_chart'
            ? { pSamples: parsed }
            : customSpcType === 'c_chart'
              ? { cSamples: parsed }
              : { subgroups: parsed }),
        });
        setUploadNote(`Loaded ${parsed.length} rows from "${file.name}".`);
      } else if (labId === 'tqm_tools') {
        if (rows.length < 2) throw new Error('Include a header row and at least 1 defect row.');
        const cols = rows[0].slice(1).filter(Boolean);
        const useCols = cols.length ? cols : ['Count'];
        const checkRows = rows.slice(1).map((r, idx) => {
          const counts = {};
          useCols.forEach((c, ci) => { counts[c] = Math.max(0, Number(r[ci + 1]) || 0); });
          return { id: `l_${idx}`, name: r[0] || `Category ${idx + 1}`, counts };
        }).filter((r) => r.name);
        if (!checkRows.length) throw new Error('No valid defect categories found.');
        setCustomDataset({
          name,
          checkSheet: { columns: useCols, rows: checkRows },
        });
        setUploadNote(`Loaded ${checkRows.length} defect categories from "${file.name}".`);
      } else if (labId === 'tqm_coq') {
        const catNorm = (raw) => {
          const s = String(raw || '').toLowerCase().trim();
          if (/^p|prevent/.test(s)) return 'prevention';
          if (/^a|apprais|inspect|test/.test(s)) return 'appraisal';
          if (/^if|internal/.test(s)) return 'internal_failure';
          if (/^ef|external|warranty|return/.test(s)) return 'external_failure';
          return 'internal_failure';
        };
        const items = [];
        rows.forEach((r, idx) => {
          if (r.length < 3) return;
          const amt = Number(String(r[2]).replace(/[^0-9.-]/g, ''));
          if (idx === 0 && !Number.isFinite(amt)) return;
          if (!Number.isFinite(amt) || amt < 0) return;
          items.push({ id: `lc_${idx}`, name: r[0] || `Item ${idx + 1}`, category: catNorm(r[1]), amount: amt });
        });
        if (!items.length) throw new Error('Use columns: CostItem, Category, Amount.');
        setCustomDataset({
          name,
          currency: customCurrency,
          revenue: Math.max(0, Number(customRevenue) || 0),
          unitsProduced: Math.max(0, Number(customUnits) || 0),
          items,
        });
        setUploadNote(`Loaded ${items.length} COQ cost lines from "${file.name}".`);
      } else if (labId === 'psis_seven_names') {
        const masterItems = [];
        rows.forEach((r, idx) => {
          if (r.length < 2) return;
          const stock = Number(String(r[2] ?? '0').replace(/[^0-9.-]/g, ''));
          if (idx === 0 && /code|sku|item|desc/i.test(String(r[0])) && !Number.isFinite(stock)) return;
          if (!String(r[0] || '').trim() && !String(r[1] || '').trim()) return;
          masterItems.push({
            code: String(r[0] || `SKU-${idx + 1}`).trim(),
            name: String(r[1] || r[0] || `Item ${idx + 1}`).trim(),
            stock: Number.isFinite(stock) ? Math.max(0, stock) : 0,
            canonicalId: `custom_${idx}`,
          });
        });
        if (!masterItems.length) throw new Error('Use columns: Code, ItemDescription, StockQty.');
        setCustomDataset({ name, masterItems });
        setUploadNote(`Loaded ${masterItems.length} item master SKUs from "${file.name}".`);
      } else if (labId === 'psis_scan_it') {
        const samples = [];
        rows.forEach((r, idx) => {
          if (!r[0]) return;
          const digits = String(r[0]).replace(/[^0-9]/g, '');
          if (idx === 0 && !digits) return;
          if (!digits) return;
          samples.push({
            barcode: digits,
            product: String(r[1] || `Product ${idx + 1}`).trim(),
            category: String(r[2] || 'General').trim(),
          });
        });
        if (!samples.length) throw new Error('Use columns: Barcode, ProductName, Category.');
        setCustomDataset({ name, samples });
        setUploadNote(`Loaded ${samples.length} GTIN barcode samples from "${file.name}".`);
      } else if (labId === 'psis_the_match') {
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
            id: `lp2p_${idx}`,
            poNo: String(r[0] || `PO-${idx + 1}`).trim(),
            grnNo: grnNo || '(Pending)',
            invoiceNo: String(r[2] || `INV-${idx + 1}`).trim(),
            supplier: String(r[3] || 'Supplier').trim(),
            item: String(r[4] || 'Item').trim(),
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
        if (!packets.length) throw new Error('Use the P2P 3-Way Match CSV template columns (PO_No through BudgetRemaining).');
        setCustomDataset({ name, currency: customCurrency || 'GHS', priceTolPct: 2, qtyTolPct: 0, packets });
        setUploadNote(`Loaded ${packets.length} P2P invoice packets from "${file.name}".`);
      } else if (labId === 'psis_the_whip') {
        const demandSeries = [];
        rows.forEach((r, idx) => {
          const val = Number(String(r[1] ?? r[0]).replace(/[^0-9.-]/g, ''));
          if (idx === 0 && !Number.isFinite(val)) return;
          if (Number.isFinite(val) && val >= 0) demandSeries.push(Math.round(val));
        });
        if (demandSeries.length < 6) throw new Error('Include at least 6 weekly demand rows (Week, ConsumerDemand).');
        setCustomDataset({ name, demandSeries: demandSeries.slice(0, 40) });
        setUploadNote(`Loaded ${Math.min(40, demandSeries.length)} weeks of consumer demand from "${file.name}".`);
      } else if (labId === 'psis_req_to_order') {
        const requisitions = [];
        rows.forEach((r, idx) => {
          if (r.length < 6) return;
          const qty = Number(String(r[4]).replace(/[^0-9.-]/g, ''));
          const unitPrice = Number(String(r[5]).replace(/[^0-9.-]/g, ''));
          if (idx === 0 && !Number.isFinite(qty)) return;
          if (!Number.isFinite(qty) || !Number.isFinite(unitPrice)) return;
          requisitions.push({
            id: `lreq_${idx}`,
            reqNo: String(r[0] || `REQ-${idx + 1}`).trim(),
            item: String(r[1] || 'Item').trim(),
            supplier: String(r[2] || 'Supplier').trim(),
            costCentre: String(r[3] || 'General').trim(),
            qty: Math.max(1, Math.round(qty)),
            unitPrice: Math.max(0, unitPrice),
            paid: false,
          });
        });
        if (!requisitions.length) throw new Error('Use columns: ReqNo, Item, Supplier, CostCentre, Qty, UnitPrice.');
        setCustomDataset({ name, currency: customCurrency || 'GHS', requisitions });
        setUploadNote(`Loaded ${requisitions.length} requisitions from "${file.name}".`);
      } else if (labId === 'psis_the_tender') {
        const bids = [];
        rows.forEach((r, idx) => {
          if (r.length < 4) return;
          const price = Number(String(r[1]).replace(/[^0-9.-]/g, ''));
          if (idx === 0 && !Number.isFinite(price)) return;
          if (!Number.isFinite(price) || price <= 0) return;
          const tech = Number(String(r[2]).replace(/[^0-9.-]/g, ''));
          const days = Number(String(r[3]).replace(/[^0-9.-]/g, ''));
          const local = Number(String(r[4] ?? '70').replace(/[^0-9.-]/g, ''));
          const floor = Number(String(r[5] ?? Math.round(price * 0.88)).replace(/[^0-9.-]/g, ''));
          bids.push({
            id: `lbid_${idx}`,
            supplier: String(r[0] || `Supplier ${idx + 1}`).trim(),
            price,
            technicalScore: Number.isFinite(tech) ? Math.max(0, Math.min(100, tech)) : 75,
            leadTimeDays: Number.isFinite(days) && days > 0 ? days : 21,
            localContentScore: Number.isFinite(local) ? Math.max(0, Math.min(100, local)) : 70,
            reserveFloor: Number.isFinite(floor) && floor > 0 ? floor : Math.round(price * 0.88),
            sustainableCost: Math.round((Number.isFinite(floor) && floor > 0 ? floor : price * 0.88) * 1.04),
            aggressiveness: 0.65 + (idx % 3) * 0.1,
          });
        });
        if (bids.length < 2) throw new Error('Include at least 2 supplier bids (Supplier, BidPrice, TechnicalScore_0_100, LeadTimeDays, LocalContent_0_100, ReserveFloor).');
        setCustomDataset({ name, currency: customCurrency || 'GHS', bids });
        setUploadNote(`Loaded ${bids.length} supplier bids from "${file.name}".`);
      }
    } catch (err) {
      toast(err.message || 'Could not import dataset.', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save() {
    if (!selectedCourse) {
      toast('Select a class to assign this lab to.', 'error');
      return;
    }
    setSaving(true);
    try {
      let finalAssignmentId = null;
      if (gradeMode === 'existing') {
        finalAssignmentId = linkedAssignmentId || null;
      } else if (gradeMode === 'create') {
        const aTitle = newAssignTitle.trim() || `${def.shortTitle} Lab Assignment`;
        const maxMarks = Math.max(1, Number(newAssignMarks) || 20);
        const rubric = scaleRubric(def.rubricCriteria || [], maxMarks);
        const packedInstructions = serializeAssignmentMeta(
          instructions.trim() || def.defaultPrompt,
          { rubric, submission: { mode: 'file', fileFormat: 'pdf', allowPaste: true } },
        );
        const created = await run(
          supabase
            .from('assignments')
            .insert({
              course_id: selectedCourse.id,
              title: aTitle,
              instructions: packedInstructions,
              max_marks: maxMarks,
              due_at: newAssignDue ? new Date(newAssignDue).toISOString() : null,
              allow_late: true,
              published: newAssignPublish,
            })
            .select('id')
            .single(),
        );
        finalAssignmentId = created.id;
      }

      // Sync custom dataset numeric params if present
      let finalCustom = customDataset;
      if (finalCustom && labId === 'tqm_spc') {
        finalCustom = {
          ...finalCustom,
          lsl: customLsl !== '' ? Number(customLsl) : null,
          usl: customUsl !== '' ? Number(customUsl) : null,
        };
      } else if (finalCustom && labId === 'tqm_coq') {
        finalCustom = {
          ...finalCustom,
          currency: customCurrency,
          revenue: Math.max(0, Number(customRevenue) || 0),
          unitsProduced: Math.max(0, Number(customUnits) || 0),
        };
      }

      // Re-fetch freshest course.description before writing to avoid stale overwrites
      const freshCourse = await run(
        supabase.from('courses').select('id, description').eq('id', selectedCourse.id).single(),
      );
      const meta = parseCourseMeta(freshCourse);
      const nextEntry = {
        id: existingConfig?.id || labId,
        labId,
        title: title.trim() || def.title,
        enabled,
        dataMode,
        presetId,
        customDataset: dataMode === 'student_only' ? null : finalCustom,
        instructions: instructions.trim(),
        linkedAssignmentId: finalAssignmentId,
        updatedAt: new Date().toISOString(),
      };
      const others = (meta.labs_config || []).filter((l) => l.labId !== labId);
      const nextLabs = [...others, nextEntry];
      const serialized = serializeCourseMeta(
        meta.about,
        meta.ca_config,
        meta.exam_config,
        meta.course_info,
        nextLabs,
      );
      await run(supabase.from('courses').update({ description: serialized }).eq('id', selectedCourse.id));

      toast(
        gradeMode === 'create'
          ? `Lab opened for ${selectedCourse.code} and linked to new assignment.`
          : `Lab settings saved for ${selectedCourse.code}.`,
      );
      onSaved?.();
      onClose?.();
    } catch (e) {
      toast(e.message || 'Could not save lab assignment.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Configure Lab — ${def.shortTitle}`}
      onClose={onClose}
      wide
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving || !selectedCourse} onClick={save}>
            {saving ? 'Saving…' : 'Save Class Lab Settings'}
          </button>
        </>
      )}
    >
      <div className="stack">
        {!lockedCourse && (
          <Field label="Target Class / Course">
            <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
              ))}
            </select>
          </Field>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'end' }}>
          <Field label="Lab Display Title for Students">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <label className="check" style={{ paddingBottom: 10 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Open to students
          </label>
        </div>

        {/* Data Source Policy */}
        <div className="card-soft stack-sm" style={{ padding: 14 }}>
          <strong className="small">Data Source Policy (Lecturer Data vs. Student Own Data)</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
            {DATA_POLICIES.map((pol) => (
              <label
                key={pol.id}
                style={{
                  border: `1.5px solid ${dataMode === pol.id ? 'var(--teal)' : 'var(--line)'}`,
                  background: dataMode === pol.id ? 'var(--teal-50)' : 'var(--surface)',
                  borderRadius: 8,
                  padding: 10,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span className="row" style={{ gap: 6 }}>
                  <input type="radio" name="dataMode" checked={dataMode === pol.id} onChange={() => setDataMode(pol.id)} />
                  <strong className="small">{pol.label}</strong>
                </span>
                <span className="tiny muted">{pol.desc}</span>
              </label>
            ))}
          </div>

          {dataMode !== 'student_only' && (
            <div className="stack-sm" style={{ paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
              <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <strong className="small">Course Dataset (Starter Preset or Your Own CSV / Excel)</strong>
                <div className="row-wrap" style={{ gap: 6 }}>
                  <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleCustomFile} />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      const tpl = buildLabCsvTemplate(labId, labId === 'tqm_spc' ? customSpcType : '');
                      downloadText(tpl.filename, tpl.content);
                    }}
                  >
                    <Icon name="download" size={13} /> Download CSV Template
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                    <Icon name="upload" size={13} /> Upload My Dataset
                  </button>
                  {customDataset && (
                    <button type="button" className="btn btn-sm" onClick={() => { setCustomDataset(null); setUploadNote(''); }}>
                      Use Preset Instead
                    </button>
                  )}
                </div>
              </div>

              {labId === 'tqm_spc' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 8 }}>
                  <label className="stack-xs tiny muted">
                    Chart Type (for Custom Upload)
                    <select className="input" value={customSpcType} onChange={(e) => setCustomSpcType(e.target.value)}>
                      <option value="xbar_r">X-bar &amp; R</option>
                      <option value="xbar_s">X-bar &amp; S</option>
                      <option value="p_chart">p-Chart</option>
                      <option value="c_chart">c-Chart</option>
                    </select>
                  </label>
                  <label className="stack-xs tiny muted">
                    LSL (optional)
                    <input className="input mono" type="number" step="any" value={customLsl} onChange={(e) => setCustomLsl(e.target.value)} />
                  </label>
                  <label className="stack-xs tiny muted">
                    USL (optional)
                    <input className="input mono" type="number" step="any" value={customUsl} onChange={(e) => setCustomUsl(e.target.value)} />
                  </label>
                </div>
              )}

              {labId === 'tqm_coq' && customDataset && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1.2fr', gap: 8 }}>
                  <label className="stack-xs tiny muted">
                    Currency
                    <select className="input" value={customCurrency} onChange={(e) => setCustomCurrency(e.target.value)}>
                      <option value="GHS">GHS</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
                    </select>
                  </label>
                  <label className="stack-xs tiny muted">
                    Period Revenue
                    <input className="input mono" type="number" value={customRevenue} onChange={(e) => setCustomRevenue(e.target.value)} />
                  </label>
                  <label className="stack-xs tiny muted">
                    Units Produced
                    <input className="input mono" type="number" value={customUnits} onChange={(e) => setCustomUnits(e.target.value)} />
                  </label>
                </div>
              )}

              {customDataset ? (
                <div className="tiny" style={{ color: 'var(--teal-700)', fontWeight: 600 }}>
                  ● Custom lecturer dataset active: {customDataset.name} {uploadNote ? `(${uploadNote})` : ''}
                </div>
              ) : (
                <Field label="Default Starter Preset">
                  <select className="input" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                    {def.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              )}
            </div>
          )}
        </div>

        {/* Assignment & Gradebook Interface */}
        <div className="card-soft stack-sm" style={{ padding: 14 }}>
          <strong className="small">Assignment &amp; Student Portal Gradebook Link</strong>
          <div className="row-wrap" style={{ gap: 10 }}>
            <label className="check">
              <input type="radio" name="gradeMode" checked={gradeMode === 'practice'} onChange={() => setGradeMode('practice')} />
              Practice only (ungraded)
            </label>
            <label className="check">
              <input type="radio" name="gradeMode" checked={gradeMode === 'create'} onChange={() => setGradeMode('create')} />
              Create &amp; link new graded assignment
            </label>
            <label className="check">
              <input type="radio" name="gradeMode" checked={gradeMode === 'existing'} onChange={() => setGradeMode('existing')} />
              Link to existing assignment
            </label>
          </div>

          {gradeMode === 'create' && (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.4fr', gap: 10, paddingTop: 6 }}>
              <Field label="New Assignment Title">
                <input className="input" value={newAssignTitle} onChange={(e) => setNewAssignTitle(e.target.value)} />
              </Field>
              <Field label="Max Marks">
                <input className="input mono" type="number" min="1" value={newAssignMarks} onChange={(e) => setNewAssignMarks(e.target.value)} />
              </Field>
              <Field label="Due Date (optional)">
                <input className="input" type="datetime-local" value={newAssignDue} onChange={(e) => setNewAssignDue(e.target.value)} />
              </Field>
              <label className="check" style={{ gridColumn: '1 / -1' }}>
                <input type="checkbox" checked={newAssignPublish} onChange={(e) => setNewAssignPublish(e.target.checked)} />
                Publish assignment immediately (students can submit straight into Gradebook &amp; CA)
              </label>
            </div>
          )}

          {gradeMode === 'existing' && (
            <Field label="Select Course Assignment">
              <select className="input" value={linkedAssignmentId} onChange={(e) => setLinkedAssignmentId(e.target.value)}>
                <option value="">Choose an assignment…</option>
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} ({a.max_marks} marks{a.published ? '' : ' · Draft'})
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <Field label="Task Brief & Written Judgement Prompt for Students">
          <textarea
            className="input"
            rows={3}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Describe what students must analyze and argue in their written judgement…"
          />
        </Field>
      </div>
    </Modal>
  );
}
