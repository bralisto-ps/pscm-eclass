// Pure deterministic engine for Milestone 7 PSCM E-Class Lab Upgrades (Zero external deps):
// 1. Universal Custom Dataset Column Mapper + Paste-from-Excel parser (all 11 labs)
// 2. Syndicate Peer Contribution Aggregation & Peer-Weighted Individual Mark Suggestions
// 3. Live Multi-Student Reverse Auction state machine (host-authoritative, idempotent)
// 4. End-to-End Supply Chain "Carry Forward" cross-lab data pipeline
// 5. Variant-Specific Oral Defense / Post-Lab Viva Question Generator (all 11 labs)
// 6. Course Dataset Library & CLO Mapping normalization

// ============================================================================
// 1. UNIVERSAL CUSTOM DATASET MAPPER (ALL 11 LABS)
// ============================================================================

export const LAB_DATASET_SCHEMAS = {
  tqm_spc: {
    label: 'Statistical Process Control Dataset',
    fields: [
      { key: 'subgroup', label: 'Subgroup / Sample ID', required: false, aliases: ['subgroup', 'sample', 'batch', 'lot', 'id', 'day', 'shift', 'no'] },
      { key: 'value1', label: 'Measurement / Defect Count Col 1', required: true, aliases: ['x1', 'obs1', 'm1', 'reading1', 'defects', 'defectives', 'count', 'value', 'weight', 'fill', 'measurement'] },
      { key: 'value2', label: 'Measurement 2 / Sample Size (n)', required: false, aliases: ['x2', 'obs2', 'm2', 'reading2', 'n', 'samplesize', 'inspected', 'size'] },
      { key: 'value3', label: 'Measurement 3 (optional)', required: false, aliases: ['x3', 'obs3', 'm3', 'reading3'] },
      { key: 'value4', label: 'Measurement 4 (optional)', required: false, aliases: ['x4', 'obs4', 'm4', 'reading4'] },
      { key: 'value5', label: 'Measurement 5 (optional)', required: false, aliases: ['x5', 'obs5', 'm5', 'reading5'] },
    ],
  },
  tqm_tools: {
    label: 'Quality Tools Defect / Check Sheet Dataset',
    fields: [
      { key: 'category', label: 'Defect / Issue Category', required: true, aliases: ['category', 'defect', 'issue', 'type', 'cause', 'problem', 'failure', 'name', 'item'] },
      { key: 'count', label: 'Count / Frequency', required: true, aliases: ['count', 'freq', 'frequency', 'qty', 'quantity', 'total', 'occurrences', 'number', 'defects'] },
      { key: 'shift', label: 'Shift / Stratum (optional)', required: false, aliases: ['shift', 'line', 'machine', 'stratum', 'group', 'department', 'team'] },
    ],
  },
  tqm_coq: {
    label: 'Cost of Quality (PAF) Ledger Dataset',
    fields: [
      { key: 'name', label: 'Cost Line Item', required: true, aliases: ['name', 'item', 'activity', 'description', 'costitem', 'line', 'account'] },
      { key: 'category', label: 'PAF Category (prevention / appraisal / internal / external)', required: true, aliases: ['category', 'paf', 'bucket', 'type', 'class', 'group'] },
      { key: 'amount', label: 'Cost Amount', required: true, aliases: ['amount', 'cost', 'value', 'spend', 'ghs', 'usd', 'total', 'budget'] },
    ],
  },
  psis_the_whip: {
    label: 'Weekly Consumer Demand Time Series',
    fields: [
      { key: 'week', label: 'Week / Period', required: false, aliases: ['week', 'period', 'day', 'month', 't', 'time', 'no'] },
      { key: 'demand', label: 'End-Consumer Demand', required: true, aliases: ['demand', 'consumerdemand', 'pos', 'sales', 'orders', 'qty', 'volume', 'units'] },
    ],
  },
  psis_seven_names: {
    label: 'Item Master / SKU Catalogue Dataset',
    fields: [
      { key: 'code', label: 'SKU / Material Code', required: false, aliases: ['code', 'sku', 'skucode', 'itemcode', 'materialno', 'partno', 'id', 'catalogno'] },
      { key: 'name', label: 'Item Description / Name', required: true, aliases: ['name', 'itemdescription', 'description', 'item', 'itemname', 'product', 'material', 'title', 'spec'] },
      { key: 'stock', label: 'On-Hand Stock Qty', required: false, aliases: ['stock', 'stockqty', 'qty', 'quantity', 'onhand', 'balance', 'units', 'inventory', 'soh'] },
      { key: 'unit', label: 'Unit of Measure (optional)', required: false, aliases: ['unit', 'uom', 'pack', 'measure', 'packsize'] },
    ],
  },
  psis_scan_it: {
    label: 'Barcode / GTIN Product Log',
    fields: [
      { key: 'barcode', label: 'Barcode / GTIN Digits', required: true, aliases: ['barcode', 'gtin', 'ean', 'ean13', 'upc', 'code', 'digits', 'number'] },
      { key: 'name', label: 'Product Name', required: true, aliases: ['productname', 'name', 'product', 'item', 'description', 'title'] },
      { key: 'category', label: 'Category (optional)', required: false, aliases: ['category', 'group', 'dept', 'department', 'type', 'class'] },
    ],
  },
  psis_the_match: {
    label: 'Procure-to-Pay Three-Way Match Packets',
    fields: [
      { key: 'poNo', label: 'PO Number', required: false, aliases: ['pono', 'po', 'ponumber', 'purchaseorder', 'orderno'] },
      { key: 'grnNo', label: 'GRN Number', required: false, aliases: ['grnno', 'grn', 'receipt', 'receiptno', 'goodsreceipt'] },
      { key: 'invNo', label: 'Invoice Number', required: false, aliases: ['invoiceno', 'invno', 'invoice', 'inv', 'billno'] },
      { key: 'supplier', label: 'Supplier Name', required: true, aliases: ['supplier', 'vendor', 'suppliername', 'vendorname', 'company'] },
      { key: 'item', label: 'Item / Service Description', required: true, aliases: ['item', 'description', 'product', 'material', 'service', 'goods'] },
      { key: 'poQty', label: 'PO Quantity', required: true, aliases: ['poqty', 'orderqty', 'orderedqty', 'qty', 'quantity'] },
      { key: 'poUnitPrice', label: 'PO Unit Price', required: true, aliases: ['pounitprice', 'poprice', 'unitprice', 'price', 'rate', 'contractprice'] },
      { key: 'grnQty', label: 'GRN Received Qty', required: true, aliases: ['grnqty', 'receivedqty', 'deliveredqty', 'receiptqty'] },
      { key: 'invQty', label: 'Invoiced Qty', required: true, aliases: ['invqty', 'invoiceqty', 'billedqty', 'invoicedqty'] },
      { key: 'invUnitPrice', label: 'Invoiced Unit Price', required: true, aliases: ['invunitprice', 'invprice', 'invoiceprice', 'billedprice', 'billedrate'] },
      { key: 'budgetRemaining', label: 'Cost Centre Budget Remaining (optional)', required: false, aliases: ['budgetremaining', 'budget', 'availablebudget', 'costcentrebudget'] },
    ],
  },
  psis_req_to_order: {
    label: 'Requisition & DoA Approval Queue',
    fields: [
      { key: 'reqNo', label: 'Requisition No', required: false, aliases: ['reqno', 'requisition', 'req', 'id', 'prno'] },
      { key: 'item', label: 'Item Description', required: true, aliases: ['item', 'description', 'material', 'product', 'service', 'name'] },
      { key: 'supplier', label: 'Proposed Supplier', required: true, aliases: ['supplier', 'vendor', 'suppliername', 'vendorname'] },
      { key: 'costCentre', label: 'Cost Centre / Department', required: false, aliases: ['costcentre', 'costcenter', 'department', 'dept', 'unit', 'budgethead'] },
      { key: 'qty', label: 'Quantity', required: true, aliases: ['qty', 'quantity', 'units', 'count'] },
      { key: 'unitPrice', label: 'Unit Price', required: true, aliases: ['unitprice', 'price', 'rate', 'cost', 'unitcost'] },
    ],
  },
  psis_the_tender: {
    label: 'Sealed Tender Supplier Bids',
    fields: [
      { key: 'supplier', label: 'Bidder / Supplier Name', required: true, aliases: ['supplier', 'bidder', 'vendor', 'company', 'name'] },
      { key: 'bidPrice', label: 'Bid Price', required: true, aliases: ['bidprice', 'price', 'quote', 'amount', 'totalbid', 'bid', 'offer'] },
      { key: 'technicalScore', label: 'Technical Score (0–100)', required: true, aliases: ['technicalscore', 'technical', 'tech', 'quality', 'qualityscore'] },
      { key: 'deliveryDays', label: 'Delivery Lead Time (Days)', required: false, aliases: ['deliverydays', 'delivery', 'leadtime', 'days'] },
      { key: 'localContentPct', label: 'Local Content %', required: false, aliases: ['localcontentpct', 'localcontent', 'local', 'sustainability', 'esg'] },
      { key: 'costFloor', label: 'Estimated Cost Floor (optional)', required: false, aliases: ['costfloor', 'floor', 'mincost', 'breakeven'] },
    ],
  },
  psis_inventory_wms: {
    label: 'Inventory ABC-XYZ & Cycle Count Dataset',
    fields: [
      { key: 'sku', label: 'SKU Code', required: false, aliases: ['sku', 'code', 'skucode', 'itemcode', 'id', 'partno'] },
      { key: 'name', label: 'Item Description', required: true, aliases: ['name', 'item', 'description', 'itemname', 'product', 'material'] },
      { key: 'annualDemand', label: 'Annual Demand (Units)', required: true, aliases: ['annualdemand', 'demand', 'annualqty', 'usage', 'annualusage', 'qty'] },
      { key: 'unitCost', label: 'Unit Cost', required: true, aliases: ['unitcost', 'cost', 'price', 'unitprice', 'rate'] },
      { key: 'cv', label: 'Demand Variability CV (optional)', required: false, aliases: ['cv', 'variability', 'demandcv', 'coeffvar'] },
      { key: 'bookQty', label: 'Book Stock Qty (for Cycle Count)', required: false, aliases: ['bookqty', 'systemqty', 'wmsqty', 'book', 'onhand', 'stock'] },
      { key: 'countedQty', label: 'Physical Counted Qty (for Cycle Count)', required: false, aliases: ['countedqty', 'physicalqty', 'actualqty', 'counted', 'count'] },
    ],
  },
  psis_spend_analytics: {
    label: 'Supplier Scorecard & Spend Cube Dataset',
    fields: [
      { key: 'name', label: 'Supplier Name', required: true, aliases: ['supplier', 'name', 'vendor', 'suppliername', 'vendorname'] },
      { key: 'category', label: 'Spend Category', required: false, aliases: ['category', 'spendcategory', 'group', 'commodity', 'segment'] },
      { key: 'annualSpend', label: 'Annual Spend', required: true, aliases: ['annualspend', 'spend', 'totalspend', 'amount', 'value', 'turnover'] },
      { key: 'otifPct', label: 'OTIF Delivery %', required: false, aliases: ['otifpct', 'otif', 'ontime', 'deliverypct', 'servicelevel'] },
      { key: 'defectPpm', label: 'Defect Rate (PPM)', required: false, aliases: ['defectppm', 'ppm', 'defects', 'qualityppm', 'rejects'] },
      { key: 'priceVariancePct', label: 'Price Variance %', required: false, aliases: ['pricevariancepct', 'pricevariance', 'variance', 'pricevar'] },
      { key: 'responsiveness', label: 'Responsiveness (0–100)', required: false, aliases: ['responsiveness', 'responsiveness0100', 'communication', 'service', 'score'] },
      { key: 'onContract', label: 'On Contract (Yes/No)', required: false, aliases: ['oncontract', 'contract', 'contracted', 'compliant', 'preferred'] },
    ],
  },
  scm_landed_cost: {
    label: 'Global Logistics & Landed Cost Routes',
    fields: [
      { key: 'name', label: 'Route / Origin Name', required: true, aliases: ['routename', 'route', 'origin', 'supplier', 'name'] },
      { key: 'mode', label: 'Transport Mode (Ocean/Air/Road)', required: false, aliases: ['mode', 'transport', 'freightmode'] },
      { key: 'incoterm', label: 'Incoterm (EXW/FOB/CIF/DAP/DDP)', required: false, aliases: ['incoterm', 'incoterms', 'term'] },
      { key: 'qty', label: 'Shipment Qty', required: true, aliases: ['qty', 'quantity', 'units'] },
      { key: 'unitExw', label: 'Unit EXW Price', required: true, aliases: ['unitexw', 'exw', 'unitprice', 'price'] },
      { key: 'mainFreight', label: 'Main Freight Cost', required: true, aliases: ['mainfreight', 'freight', 'shipping'] },
      { key: 'dutyRatePct', label: 'Import Duty %', required: false, aliases: ['dutypct', 'dutyratepct', 'duty', 'tariff'] },
      { key: 'vatRatePct', label: 'Import VAT %', required: false, aliases: ['vatpct', 'vatratepct', 'vat', 'tax'] },
      { key: 'destPort', label: 'Destination Port / Clearance', required: false, aliases: ['destport', 'port', 'clearance', 'demurrage'] },
      { key: 'transitDays', label: 'Transit Days', required: false, aliases: ['transitdays', 'transit', 'days', 'leadtime'] },
    ],
  },
  scm_contract_sla: {
    label: 'Contract SLA Performance Periods',
    fields: [
      { key: 'period', label: 'Period / Month', required: true, aliases: ['period', 'month', 'quarter', 'date', 'cycle'] },
      { key: 'invoiceValue', label: 'Period Invoice Value', required: true, aliases: ['invoicevalue', 'invoice', 'spend', 'value', 'amount'] },
      { key: 'otifPct', label: 'OTIF Delivery %', required: true, aliases: ['otifpct', 'otif', 'ontime', 'delivery'] },
      { key: 'defectPct', label: 'Defect Rate %', required: false, aliases: ['defectpct', 'defect', 'defects', 'reject'] },
      { key: 'responseHrs', label: 'Response Time (Hours)', required: false, aliases: ['responsehrs', 'response', 'hours', 'sla'] },
      { key: 'forceMajeure', label: 'Force Majeure Excused (Yes/No)', required: false, aliases: ['forcemajeure', 'excused', 'fm'] },
    ],
  },
  scm_green_procurement: {
    label: 'Sustainable Procurement Supplier Options',
    fields: [
      { key: 'name', label: 'Supplier Name', required: true, aliases: ['supplier', 'name', 'vendor'] },
      { key: 'origin', label: 'Origin / Region', required: false, aliases: ['origin', 'region', 'country'] },
      { key: 'mode', label: 'Transport Mode (Sea/Rail/Road/Air)', required: false, aliases: ['mode', 'transport', 'freightmode'] },
      { key: 'distanceKm', label: 'Inbound Distance (km)', required: true, aliases: ['distancekm', 'distance', 'km'] },
      { key: 'unitPricePerTonne', label: 'Price per Tonne', required: true, aliases: ['unitpricepertonne', 'price', 'unitprice', 'cost'] },
      { key: 'mfgKgCo2PerTonne', label: 'Manufacturing kg CO2e / Tonne', required: true, aliases: ['mfgkgco2pertonne', 'mfgco2', 'co2', 'emissions'] },
      { key: 'recyclablePct', label: 'Recyclable Packaging %', required: false, aliases: ['recyclablepct', 'recyclable', 'circular'] },
      { key: 'ethicsScore', label: 'Ethical Audit Score (0–100)', required: false, aliases: ['ethicsscore', 'ethics', 'esg', 'audit'] },
    ],
  },
};

function normalizeHeaderToken(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseNum(v, fallback = 0) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const cleaned = String(v ?? '').replace(/[,\s%$£€]/g, '').replace(/^(ghs|usd|eur|gbp)/i, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function parseBool(v, fallback = true) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return fallback;
  if (['no', 'false', '0', 'off', 'maverick', 'n', 'uncontracted'].includes(s)) return false;
  if (['yes', 'true', '1', 'on', 'contracted', 'y', 'preferred'].includes(s)) return true;
  return fallback;
}

/**
 * Parses pasted CSV, TSV (Excel / Google Sheets copy-paste), or semicolon-delimited text
 * into a 2D array of trimmed strings [headers, ...dataRows].
 */
export function parsePastedTableText(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) return [];
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (!lines.length) return [];

  // Detect delimiter from header line
  const first = lines[0];
  const tabCount = (first.match(/\t/g) || []).length;
  const semiCount = (first.match(/;/g) || []).length;
  const commaCount = (first.match(/,/g) || []).length;
  const delim = tabCount >= commaCount && tabCount > 0 ? '\t' : semiCount > commaCount ? ';' : ',';

  return lines.map((line) => {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delim && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  });
}

/**
 * Automatically maps arbitrary spreadsheet column headers to a lab's semantic fields.
 * Returns { [fieldKey]: columnIndex | -1 }
 */
export function autoDetectColumnMapping(labId, headers) {
  const schema = LAB_DATASET_SCHEMAS[labId];
  if (!schema || !Array.isArray(headers)) return {};
  const normHeaders = headers.map((h) => normalizeHeaderToken(h));
  const usedCols = new Set();
  const mapping = {};

  // Pass 1: exact alias matches
  for (const field of schema.fields) {
    let matchedIdx = -1;
    for (const alias of field.aliases || []) {
      const idx = normHeaders.findIndex((nh, i) => !usedCols.has(i) && nh === alias);
      if (idx !== -1) {
        matchedIdx = idx;
        break;
      }
    }
    if (matchedIdx !== -1) {
      mapping[field.key] = matchedIdx;
      usedCols.add(matchedIdx);
    } else {
      mapping[field.key] = -1;
    }
  }

  // Pass 2: partial/substring alias matches for remaining unmapped fields
  for (const field of schema.fields) {
    if (mapping[field.key] !== -1) continue;
    let bestIdx = -1;
    for (const alias of field.aliases || []) {
      if (alias.length < 3) continue;
      const idx = normHeaders.findIndex(
        (nh, i) => !usedCols.has(i) && nh && (nh.includes(alias) || alias.includes(nh))
      );
      if (idx !== -1) {
        bestIdx = idx;
        break;
      }
    }
    if (bestIdx !== -1) {
      mapping[field.key] = bestIdx;
      usedCols.add(bestIdx);
    }
  }

  return mapping;
}

/**
 * Transforms raw 2D rows (data rows excluding header) using the lecturer's column mapping
 * into the exact `customDataset` object consumed by the target lab.
 */
export function transformMappedRowsToDataset(labId, dataRows, mapping, options = {}) {
  const schema = LAB_DATASET_SCHEMAS[labId];
  if (!schema) throw new Error(`Unsupported lab schema: ${labId}`);
  const rows = (Array.isArray(dataRows) ? dataRows : []).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
  if (!rows.length) throw new Error('No data rows found to import.');

  for (const f of schema.fields) {
    if (f.required && !(Number.isInteger(mapping?.[f.key]) && mapping[f.key] >= 0)) {
      throw new Error(`Please map the required column: "${f.label}".`);
    }
  }

  const getCell = (row, key) => {
    const idx = mapping?.[key];
    return Number.isInteger(idx) && idx >= 0 ? row[idx] : undefined;
  };

  const datasetName = String(options.name || 'Custom Course Dataset').trim();
  const currency = String(options.currency || 'GHS').trim() || 'GHS';
  const warnings = [];

  if (labId === 'tqm_spc') {
    const chartType = options.chartType || 'xbar_r';
    const lsl = options.lsl !== '' && options.lsl != null ? Number(options.lsl) : null;
    const usl = options.usl !== '' && options.usl != null ? Number(options.usl) : null;
    if (chartType === 'p_chart') {
      const pSubgroups = rows.map((r, i) => ({
        id: String(getCell(r, 'subgroup') || `S${i + 1}`),
        defects: Math.max(0, Math.round(parseNum(getCell(r, 'value1'), 0))),
        n: Math.max(1, Math.round(parseNum(getCell(r, 'value2'), 100))),
      }));
      return { dataset: { name: datasetName, chartType, lsl, usl, pSubgroups }, rowCount: pSubgroups.length, warnings };
    }
    if (chartType === 'c_chart') {
      const cSubgroups = rows.map((r, i) => ({
        id: String(getCell(r, 'subgroup') || `S${i + 1}`),
        count: Math.max(0, Math.round(parseNum(getCell(r, 'value1'), 0))),
      }));
      return { dataset: { name: datasetName, chartType, lsl, usl, cSubgroups }, rowCount: cSubgroups.length, warnings };
    }
    const subgroups = rows.map((r, i) => {
      const vals = ['value1', 'value2', 'value3', 'value4', 'value5']
        .map((k) => getCell(r, k))
        .filter((v) => v !== undefined && String(v).trim() !== '')
        .map((v) => parseNum(v, NaN))
        .filter(Number.isFinite);
      return { id: String(getCell(r, 'subgroup') || `S${i + 1}`), values: vals.length ? vals : [0] };
    });
    return { dataset: { name: datasetName, chartType, lsl, usl, subgroups }, rowCount: subgroups.length, warnings };
  }

  if (labId === 'tqm_tools') {
    const defectCategories = rows.map((r, i) => ({
      category: String(getCell(r, 'category') || `Defect ${i + 1}`).trim(),
      count: Math.max(0, Math.round(parseNum(getCell(r, 'count'), 0))),
      ...(getCell(r, 'shift') ? { shift: String(getCell(r, 'shift')).trim() } : {}),
    })).filter((x) => x.category);
    return { dataset: { name: datasetName, defectCategories }, rowCount: defectCategories.length, warnings };
  }

  if (labId === 'tqm_coq') {
    const mapCat = (raw) => {
      const s = String(raw || '').toLowerCase();
      if (s.includes('prev')) return 'prevention';
      if (s.includes('apprais') || s.includes('inspect') || s.includes('test')) return 'appraisal';
      if (s.includes('ext') || s.includes('warrant') || s.includes('return')) return 'external_failure';
      return 'internal_failure';
    };
    const items = rows.map((r, i) => ({
      id: `c_${i + 1}`,
      name: String(getCell(r, 'name') || `Cost Item ${i + 1}`).trim(),
      category: mapCat(getCell(r, 'category')),
      amount: Math.max(0, parseNum(getCell(r, 'amount'), 0)),
    }));
    return {
      dataset: {
        name: datasetName,
        currency,
        revenue: Math.max(0, Number(options.revenue) || 2000000),
        unitsProduced: Math.max(0, Number(options.unitsProduced) || 100000),
        items,
      },
      rowCount: items.length,
      warnings,
    };
  }

  if (labId === 'psis_the_whip') {
    const demandSeries = rows.map((r) => Math.max(1, Math.round(parseNum(getCell(r, 'demand'), 40))));
    if (demandSeries.length < 4) warnings.push('Fewer than 4 weeks imported; consider at least 8–16 weeks to observe Bullwhip oscillation.');
    return { dataset: { name: datasetName, demandSeries }, rowCount: demandSeries.length, warnings };
  }

  if (labId === 'psis_seven_names') {
    const initialCatalog = rows.map((r, i) => {
      const uom = String(getCell(r, 'unit') || '').trim();
      const rawName = String(getCell(r, 'name') || `Item ${i + 1}`).trim();
      return {
        code: String(getCell(r, 'code') || `SKU-${101 + i}`).trim(),
        name: uom && !rawName.toLowerCase().includes(uom.toLowerCase()) ? `${rawName} (${uom})` : rawName,
        stock: Math.max(0, Math.round(parseNum(getCell(r, 'stock'), 25))),
        canonicalId: `custom_${i}`,
      };
    }).filter((x) => x.name);
    return { dataset: { name: datasetName, initialCatalog }, rowCount: initialCatalog.length, warnings };
  }

  if (labId === 'psis_scan_it') {
    const sampleProducts = rows.map((r, i) => ({
      barcode: String(getCell(r, 'barcode') || '').replace(/\D/g, ''),
      name: String(getCell(r, 'name') || `Product ${i + 1}`).trim(),
      category: String(getCell(r, 'category') || 'General').trim(),
    })).filter((x) => x.barcode.length >= 8);
    if (!sampleProducts.length) throw new Error('No valid 8–14 digit GTIN/barcode numbers found in the mapped Barcode column.');
    return { dataset: { name: datasetName, sampleProducts }, rowCount: sampleProducts.length, warnings };
  }

  if (labId === 'psis_the_match') {
    const packets = rows.map((r, i) => {
      const poQty = Math.max(0, parseNum(getCell(r, 'poQty'), 0));
      const poUnitPrice = Math.max(0, parseNum(getCell(r, 'poUnitPrice'), 0));
      const grnQty = Math.max(0, parseNum(getCell(r, 'grnQty'), poQty));
      const invQty = Math.max(0, parseNum(getCell(r, 'invQty'), poQty));
      const invUnitPrice = Math.max(0, parseNum(getCell(r, 'invUnitPrice'), poUnitPrice));
      const budgetRemaining = getCell(r, 'budgetRemaining') !== undefined
        ? Math.max(0, parseNum(getCell(r, 'budgetRemaining'), 500000))
        : 500000;
      return {
        id: `pkt_${i + 1}`,
        poNo: String(getCell(r, 'poNo') || `PO-${101 + i}`).trim(),
        grnNo: String(getCell(r, 'grnNo') || `GRN-${501 + i}`).trim(),
        invNo: String(getCell(r, 'invNo') || `INV-${901 + i}`).trim(),
        supplier: String(getCell(r, 'supplier') || `Supplier ${i + 1}`).trim(),
        item: String(getCell(r, 'item') || `Item ${i + 1}`).trim(),
        poApproved: true,
        poQty,
        poUnitPrice,
        grnPosted: grnQty > 0,
        grnQty,
        invQty,
        invUnitPrice,
        budgetRemaining,
        duplicateOf: null,
      };
    });
    return { dataset: { name: datasetName, currency, priceTolPct: 2, qtyTolPct: 0, packets }, rowCount: packets.length, warnings };
  }

  if (labId === 'psis_req_to_order') {
    const requisitions = rows.map((r, i) => ({
      id: `req_${i + 1}`,
      reqNo: String(getCell(r, 'reqNo') || `REQ-${String(i + 1).padStart(3, '0')}`).trim(),
      item: String(getCell(r, 'item') || `Item ${i + 1}`).trim(),
      supplier: String(getCell(r, 'supplier') || `Supplier ${i + 1}`).trim(),
      costCentre: String(getCell(r, 'costCentre') || 'Operations').trim(),
      qty: Math.max(1, parseNum(getCell(r, 'qty'), 1)),
      unitPrice: Math.max(0, parseNum(getCell(r, 'unitPrice'), 0)),
      day: (i % 5) + 1,
    }));
    return { dataset: { name: datasetName, currency, requisitions }, rowCount: requisitions.length, warnings };
  }

  if (labId === 'psis_the_tender') {
    const bids = rows.map((r, i) => {
      const bidPrice = Math.max(1, parseNum(getCell(r, 'bidPrice'), 10000));
      const floorRaw = getCell(r, 'costFloor');
      const costFloor = floorRaw !== undefined && String(floorRaw).trim() !== ''
        ? Math.max(1, parseNum(floorRaw, Math.round(bidPrice * 0.84)))
        : Math.round(bidPrice * 0.84);
      return {
        id: `bid_${i + 1}`,
        supplier: String(getCell(r, 'supplier') || `Bidder ${i + 1}`).trim(),
        bidPrice,
        technicalScore: Math.max(0, Math.min(100, parseNum(getCell(r, 'technicalScore'), 75))),
        deliveryDays: Math.max(1, Math.round(parseNum(getCell(r, 'deliveryDays'), 14))),
        localContentPct: Math.max(0, Math.min(100, parseNum(getCell(r, 'localContentPct'), 40))),
        costFloor,
      };
    });
    return { dataset: { name: datasetName, currency, bids }, rowCount: bids.length, warnings };
  }

  if (labId === 'psis_inventory_wms') {
    const abcItems = [];
    const cycleCountBins = [];
    rows.forEach((r, i) => {
      const sku = String(getCell(r, 'sku') || `SKU-${201 + i}`).trim();
      const name = String(getCell(r, 'name') || `Item ${i + 1}`).trim();
      const annualDemand = Math.max(1, parseNum(getCell(r, 'annualDemand'), 100));
      const unitCost = Math.max(0.01, parseNum(getCell(r, 'unitCost'), 10));
      const cv = Math.max(0.02, parseNum(getCell(r, 'cv'), 0.25));
      abcItems.push({ sku, name, annualDemand, unitCost, cv });

      const hasBook = mapping?.bookQty >= 0 && getCell(r, 'bookQty') !== undefined && String(getCell(r, 'bookQty')).trim() !== '';
      const hasCount = mapping?.countedQty >= 0 && getCell(r, 'countedQty') !== undefined && String(getCell(r, 'countedQty')).trim() !== '';
      if (hasBook || hasCount) {
        const bookQty = Math.max(0, Math.round(parseNum(getCell(r, 'bookQty'), Math.round(annualDemand / 12))));
        const countedQty = hasCount ? Math.max(0, Math.round(parseNum(getCell(r, 'countedQty'), bookQty))) : bookQty;
        cycleCountBins.push({
          bin: `BIN-${String(i + 1).padStart(2, '0')}`,
          sku,
          name,
          unitCost,
          bookQty,
          countedQty,
        });
      }
    });
    return {
      dataset: {
        name: datasetName,
        currency,
        abcItems,
        ...(cycleCountBins.length ? { cycleCountBins } : {}),
      },
      rowCount: abcItems.length,
      warnings,
    };
  }

  if (labId === 'psis_spend_analytics') {
    const suppliers = rows.map((r, i) => ({
      id: `sup_${i + 1}`,
      name: String(getCell(r, 'name') || `Supplier ${i + 1}`).trim(),
      category: String(getCell(r, 'category') || 'General Procurement').trim(),
      annualSpend: Math.max(0, parseNum(getCell(r, 'annualSpend'), 0)),
      otifPct: Math.max(0, Math.min(100, parseNum(getCell(r, 'otifPct'), 90))),
      defectPpm: Math.max(0, parseNum(getCell(r, 'defectPpm'), 1500)),
      priceVariancePct: parseNum(getCell(r, 'priceVariancePct'), 0),
      responsiveness: Math.max(0, Math.min(100, parseNum(getCell(r, 'responsiveness'), 80))),
      onContract: parseBool(getCell(r, 'onContract'), true),
    }));
    return { dataset: { name: datasetName, currency, suppliers }, rowCount: suppliers.length, warnings };
  }

  if (labId === 'scm_landed_cost') {
    const routes = rows.map((r, i) => ({
      id: `route_${i + 1}`,
      name: String(getCell(r, 'name') || `Route ${i + 1}`).trim(),
      mode: String(getCell(r, 'mode') || 'Ocean').trim(),
      incoterm: String(getCell(r, 'incoterm') || 'FOB').trim().toUpperCase(),
      qty: Math.max(1, parseNum(getCell(r, 'qty'), 100)),
      unitExw: Math.max(0, parseNum(getCell(r, 'unitExw'), 20)),
      originInland: 350,
      exportClearance: 200,
      mainFreight: Math.max(0, parseNum(getCell(r, 'mainFreight'), 1500)),
      insuranceRatePct: 0.6,
      dutyRatePct: Math.max(0, parseNum(getCell(r, 'dutyRatePct'), 10)),
      vatRatePct: Math.max(0, parseNum(getCell(r, 'vatRatePct'), 15)),
      destPort: Math.max(0, parseNum(getCell(r, 'destPort'), 600)),
      destInland: 400,
      transitDays: Math.max(1, Math.round(parseNum(getCell(r, 'transitDays'), 21))),
    }));
    return { dataset: { name: datasetName, currency, routes }, rowCount: routes.length, warnings };
  }

  if (labId === 'scm_contract_sla') {
    const periods = rows.map((r, i) => ({
      id: `p_${i + 1}`,
      period: String(getCell(r, 'period') || `Month ${i + 1}`).trim(),
      invoiceValue: Math.max(0, parseNum(getCell(r, 'invoiceValue'), 100000)),
      otifPct: Math.max(0, Math.min(100, parseNum(getCell(r, 'otifPct'), 95))),
      defectPct: Math.max(0, parseNum(getCell(r, 'defectPct'), 1.0)),
      responseHrs: Math.max(0, parseNum(getCell(r, 'responseHrs'), 18)),
      forceMajeure: parseBool(getCell(r, 'forceMajeure'), false),
    }));
    const contractValue = periods.reduce((s, p) => s + p.invoiceValue, 0) || 600000;
    return { dataset: { name: datasetName, currency, contractValue, periods }, rowCount: periods.length, warnings };
  }

  if (labId === 'scm_green_procurement') {
    const suppliers = rows.map((r, i) => ({
      id: `gs_${i + 1}`,
      name: String(getCell(r, 'name') || `Supplier ${i + 1}`).trim(),
      origin: String(getCell(r, 'origin') || 'Regional').trim(),
      mode: String(getCell(r, 'mode') || 'Road').trim(),
      distanceKm: Math.max(0, parseNum(getCell(r, 'distanceKm'), 500)),
      unitPricePerTonne: Math.max(1, parseNum(getCell(r, 'unitPricePerTonne'), 950)),
      mfgKgCo2PerTonne: Math.max(0, parseNum(getCell(r, 'mfgKgCo2PerTonne'), 400)),
      recyclablePct: Math.max(0, Math.min(100, parseNum(getCell(r, 'recyclablePct'), 70))),
      ethicsScore: Math.max(0, Math.min(100, parseNum(getCell(r, 'ethicsScore'), 80))),
    }));
    return { dataset: { name: datasetName, currency, suppliers }, rowCount: suppliers.length, warnings };
  }

  throw new Error(`No mapper implemented for lab: ${labId}`);
}

// ============================================================================
// 2. SYNDICATE PEER CONTRIBUTION & WEIGHTED MARK SUGGESTIONS
// ============================================================================

function normIdx(x) {
  return String(x || '').trim().toUpperCase();
}

/**
 * Extracts and aggregates confidential peer contribution ratings stored in
 * submission `typing_meta.syndicatePeerRatings` alongside DB `peerReviews`.
 * Returns Map<normalizedIndexNo, { avgScore, count, flagged, notes }>.
 */
export function mergeSubmissionPeerRatings(dbReviews = [], submissions = []) {
  const byTarget = new Map();

  const addRating = (targetIdx, score, note, reviewerLabel) => {
    const key = normIdx(targetIdx);
    const num = Number(score);
    if (!key || !Number.isFinite(num) || num < 1 || num > 5) return;
    if (!byTarget.has(key)) byTarget.set(key, { sum: 0, count: 0, notes: [] });
    const entry = byTarget.get(key);
    entry.sum += num;
    entry.count += 1;
    const cleanNote = String(note || '').trim();
    if (cleanNote) {
      entry.notes.push(reviewerLabel ? `${reviewerLabel}: ${cleanNote}` : cleanNote);
    }
  };

  for (const rev of Array.isArray(dbReviews) ? dbReviews : []) {
    const target = rev.reviewee_index || rev.target_index || rev.index_no;
    addRating(target, rev.score ?? rev.rating, rev.comment || rev.note, rev.reviewer_index || '');
  }

  for (const sub of Array.isArray(submissions) ? submissions : []) {
    const ratings = sub?.typing_meta?.syndicatePeerRatings;
    if (!Array.isArray(ratings)) continue;
    const reviewer = sub?.typing_meta?.submittedByIndex || sub?.student_index || 'Teammate';
    for (const r of ratings) {
      addRating(r.indexNo || r.index_no, r.score, r.note, reviewer);
    }
  }

  const out = new Map();
  for (const [key, val] of byTarget.entries()) {
    const avg = Number((val.sum / val.count).toFixed(2));
    out.set(key, {
      avgScore: avg,
      count: val.count,
      flagged: avg < 3.0,
      notes: val.notes.slice(0, 6),
    });
  }
  return out;
}

/**
 * Suggests fair peer-weighted individual marks from a Syndicate Group mark.
 * Members at or above the team average (or >= 4.0/5) receive 100% of the group mark;
 * members rated below 4.0/5 scale smoothly by (score / 4.0), clamped cleanly to [0, maxMarks].
 */
export function suggestPeerAdjustedMarks(groupMark, maxMarks, peers = []) {
  const base = Number(groupMark);
  const max = Math.max(1, Number(maxMarks) || 100);
  if (!Number.isFinite(base)) return {};
  const result = {};

  for (const p of Array.isArray(peers) ? peers : []) {
    const studentId = p.student_id || p.id;
    if (!studentId) continue;
    const peerScore = Number(p._peer?.avgScore);
    if (!Number.isFinite(peerScore) || peerScore <= 0) {
      result[studentId] = Math.round(Math.max(0, Math.min(max, base)) * 10) / 10;
      continue;
    }
    const factor = peerScore >= 4.0 ? 1.0 : Math.max(0.25, peerScore / 4.0);
    const adjusted = Math.round(Math.max(0, Math.min(max, base * factor)) * 10) / 10;
    result[studentId] = adjusted;
  }
  return result;
}

// ============================================================================
// 3. LIVE MULTI-STUDENT REVERSE AUCTION ENGINE (PSIS-LAB 06)
// ============================================================================

export function createInitialReverseAuctionState(opts = {}) {
  const reserveCeiling = Math.max(1000, Number(opts.reserveCeiling) || 120000);
  const costFloor = Math.max(500, Math.min(reserveCeiling - 100, Number(opts.costFloor) || Math.round(reserveCeiling * 0.78)));
  return {
    lotTitle: String(opts.lotTitle || 'Annual Supply of Hospital Sterile Consumables (12-Month Contract)'),
    currency: String(opts.currency || 'GHS'),
    reserveCeiling,
    costFloor,
    minDecrementPct: Number(opts.minDecrementPct) || 1,
    round: 1,
    status: 'open', // 'open' | 'awarded'
    revealCostFloor: false,
    currentLowestBid: reserveCeiling,
    leaderId: null,
    leaderName: null,
    bids: [], // [{ bidId, round, bidderId, bidderName, amount, belowFloor, ts }]
    processedBidIds: [],
    winner: null,
  };
}

export function assignAuctionBidders(participants = []) {
  const map = {};
  const sorted = [...participants].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  sorted.forEach((p, i) => {
    const syndicateNo = i + 1;
    // Slight deterministic variation in each bidder's private cost hint around ±4% of floor
    const costMultiplier = Number((0.96 + ((i % 5) * 0.02)).toFixed(2));
    map[p.id] = {
      bidderCode: `BIDDER-${String(syndicateNo).padStart(2, '0')}`,
      syndicateNo,
      costMultiplier,
    };
  });
  return map;
}

/**
 * Host-authoritative idempotent bid processor.
 * Rejects duplicate bidIds, closed auctions, and bids above the minimum decrement threshold.
 */
export function processLiveAuctionBid(state, { bidId, bidderId, bidderName, amount, ts }) {
  if (!state || state.status !== 'open') {
    return { ok: false, reason: 'Auction is already closed/awarded.', nextState: state };
  }
  const cleanId = String(bidId || `${bidderId}:${amount}:${state.round}`);
  if ((state.processedBidIds || []).includes(cleanId)) {
    return { ok: false, duplicate: true, reason: 'Duplicate bid ignored.', nextState: state };
  }
  const numAmount = Math.round(Number(amount));
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return { ok: false, reason: 'Bid must be a positive number.', nextState: state };
  }

  const maxAllowed = state.bids.length === 0
    ? state.reserveCeiling
    : Math.floor(state.currentLowestBid * (1 - (state.minDecrementPct || 1) / 100));

  if (numAmount > maxAllowed) {
    return {
      ok: false,
      reason: `Bid must be ≤ ${state.currency} ${maxAllowed.toLocaleString()} (minimum ${state.minDecrementPct || 1}% decrement).`,
      nextState: state,
    };
  }

  const belowFloor = numAmount < state.costFloor;
  const entry = {
    bidId: cleanId,
    round: state.round,
    bidderId,
    bidderName: String(bidderName || 'Bidder'),
    amount: numAmount,
    belowFloor,
    ts: ts || new Date().toLocaleTimeString(),
  };

  const nextState = {
    ...state,
    currentLowestBid: numAmount,
    leaderId: bidderId,
    leaderName: entry.bidderName,
    bids: [...(state.bids || []), entry],
    processedBidIds: [...(state.processedBidIds || []), cleanId].slice(-300),
  };

  return { ok: true, entry, belowFloor, nextState };
}

export function advanceLiveAuctionRound(state) {
  if (!state || state.status !== 'open') return state;
  return { ...state, round: (state.round || 1) + 1 };
}

export function computeLiveAuctionMetrics(state) {
  const ceiling = Number(state?.reserveCeiling) || 120000;
  const lowest = Number(state?.currentLowestBid) || ceiling;
  const floor = Number(state?.costFloor) || Math.round(ceiling * 0.78);
  const savingsAmount = Math.max(0, ceiling - lowest);
  const savingsPct = ceiling > 0 ? Number(((savingsAmount / ceiling) * 100).toFixed(1)) : 0;
  const winnersCurseTriggered = (state?.bids || []).length > 0 && lowest < floor;
  const belowFloorBids = (state?.bids || []).filter((b) => b.belowFloor).length;
  return {
    savingsAmount,
    savingsPct,
    winnersCurseTriggered,
    belowFloorBids,
    totalBids: (state?.bids || []).length,
  };
}

// ============================================================================
// 4. END-TO-END SUPPLY CHAIN "CARRY FORWARD" PIPELINE
// ============================================================================

export const CARRY_FORWARD_LINKS = {
  psis_seven_names: [
    { targetLabId: 'psis_req_to_order', label: 'Carry SKU Master → Requisition Workflow (PSIS-LAB 05)' },
    { targetLabId: 'psis_inventory_wms', label: 'Carry SKU Master → Inventory Control & Cycle Counting (PSIS-LAB 07)' },
  ],
  psis_req_to_order: [
    { targetLabId: 'psis_the_match', label: 'Carry Approved POs → P2P Three-Way Matching (PSIS-LAB 04)' },
    { targetLabId: 'psis_spend_analytics', label: 'Carry Requisitions → Supplier & Spend Analytics (PSIS-LAB 08)' },
  ],
  psis_the_tender: [
    { targetLabId: 'psis_the_match', label: 'Carry Awarded Contract → P2P Three-Way Matching (PSIS-LAB 04)' },
  ],
  psis_the_match: [
    { targetLabId: 'psis_spend_analytics', label: 'Carry Audited P2P Ledger → Supplier & Spend Analytics (PSIS-LAB 08)' },
  ],
};

export function getCarryForwardTargets(sourceLabId) {
  return CARRY_FORWARD_LINKS[sourceLabId] || [];
}

export function getCarryForwardSources(targetLabId) {
  const sources = [];
  for (const [src, list] of Object.entries(CARRY_FORWARD_LINKS)) {
    if (list.some((x) => x.targetLabId === targetLabId)) sources.push(src);
  }
  return sources;
}

/**
 * Converts a student's working draft & active dataset from an upstream lab into
 * ready-to-use `customDataset` payloads for downstream supply chain labs.
 */
export function buildCarryForwardPayload(sourceLabId, draftState = {}, activeDataset = {}) {
  const currency = activeDataset?.currency || 'GHS';
  const createdAt = new Date().toISOString();

  if (sourceLabId === 'psis_seven_names') {
    const items = Array.isArray(draftState?.catalog) && draftState.catalog.length
      ? draftState.catalog
      : Array.isArray(activeDataset?.initialCatalog) ? activeDataset.initialCatalog : [];
    if (!items.length) return null;

    const requisitions = items.slice(0, 14).map((it, idx) => ({
      id: `cf_req_${idx + 1}`,
      reqNo: `REQ-MD-${String(idx + 1).padStart(3, '0')}`,
      item: `${it.code || `SKU-${101 + idx}`}: ${it.name}`,
      supplier: idx % 3 === 0 ? 'Apex Medical & Office Ltd' : idx % 3 === 1 ? 'Accra Industrial Supplies' : 'Gold Coast Distributors',
      costCentre: idx % 2 === 0 ? 'Stores & Warehousing' : 'Clinical Operations',
      qty: Math.max(10, Math.round((Number(it.stock) || 30) * 0.5)),
      unitPrice: 120 + ((idx * 45) % 380),
      day: (idx % 5) + 1,
    }));

    const abcItems = items.slice(0, 18).map((it, idx) => ({
      sku: String(it.code || `SKU-${101 + idx}`),
      name: String(it.name || `Item ${idx + 1}`),
      annualDemand: Math.max(40, (Number(it.stock) || 25) * 12),
      unitCost: 45 + ((idx * 35) % 420),
      cv: Number((0.12 + ((idx % 5) * 0.14)).toFixed(2)),
    }));
    const cycleCountBins = items.slice(0, 10).map((it, idx) => {
      const bookQty = Math.max(5, Number(it.stock) || 25);
      // Deliberately mirror slight physical variance when duplicates fragment stock
      const delta = idx % 3 === 0 ? -Math.max(2, Math.round(bookQty * 0.08)) : idx % 4 === 0 ? 3 : 0;
      return {
        bin: `BIN-${String(idx + 1).padStart(2, '0')}`,
        sku: String(it.code || `SKU-${101 + idx}`),
        name: String(it.name || `Item ${idx + 1}`),
        unitCost: 45 + ((idx * 35) % 420),
        bookQty,
        countedQty: Math.max(0, bookQty + delta),
      };
    });

    return {
      sourceLabId,
      sourceLabel: 'PSIS-LAB 02 — Item Master Data Governance',
      createdAt,
      itemCount: items.length,
      targets: {
        psis_req_to_order: { name: `Carried Forward from Item Master (${items.length} SKUs)`, currency, requisitions },
        psis_inventory_wms: { name: `Carried Forward from Item Master (${items.length} SKUs)`, currency, abcItems, cycleCountBins },
      },
    };
  }

  if (sourceLabId === 'psis_req_to_order') {
    const reqs = Array.isArray(draftState?.requisitions) && draftState.requisitions.length
      ? draftState.requisitions
      : Array.isArray(activeDataset?.requisitions) ? activeDataset.requisitions : [];
    if (!reqs.length) return null;

    const packets = reqs.slice(0, 10).map((r, idx) => {
      const poQty = Math.max(1, Number(r.qty) || 10);
      const poUnitPrice = Math.max(1, Number(r.unitPrice) || 100);
      // Inject realistic P2P variances on two packets so students can audit downstream
      const grnQty = idx === 1 ? Math.max(1, Math.round(poQty * 0.8)) : poQty;
      const invUnitPrice = idx === 2 ? Math.round(poUnitPrice * 1.12) : poUnitPrice;
      return {
        id: `cf_p2p_${idx + 1}`,
        poNo: `PO-CF-${101 + idx}`,
        grnNo: `GRN-CF-${501 + idx}`,
        invNo: `INV-CF-${901 + idx}`,
        supplier: String(r.supplier || `Supplier ${idx + 1}`),
        item: String(r.item || `Item ${idx + 1}`),
        poApproved: true,
        poQty,
        poUnitPrice,
        grnPosted: true,
        grnQty,
        invQty: poQty,
        invUnitPrice,
        budgetRemaining: 250000,
        duplicateOf: null,
      };
    });

    const supMap = new Map();
    reqs.forEach((r) => {
      const sup = String(r.supplier || 'General Supplier');
      const spend = (Number(r.qty) || 0) * (Number(r.unitPrice) || 0);
      if (!supMap.has(sup)) {
        supMap.set(sup, { name: sup, category: String(r.costCentre || 'Operations'), annualSpend: 0, count: 0 });
      }
      const e = supMap.get(sup);
      e.annualSpend += spend;
      e.count += 1;
    });
    const suppliers = [...supMap.values()].map((s, idx) => ({
      id: `cf_sup_${idx + 1}`,
      name: s.name,
      category: s.category,
      annualSpend: Math.round(s.annualSpend),
      otifPct: Math.max(72, 96 - (idx * 4) % 20),
      defectPpm: 800 + (idx * 650) % 4200,
      priceVariancePct: Number((((idx % 5) - 1) * 1.4).toFixed(1)),
      responsiveness: Math.max(65, 92 - (idx * 5) % 24),
      onContract: idx % 3 !== 2,
    }));

    return {
      sourceLabId,
      sourceLabel: 'PSIS-LAB 05 — Requisition Workflow & DoA',
      createdAt,
      itemCount: reqs.length,
      targets: {
        psis_the_match: { name: `Carried Forward from Requisitions (${packets.length} POs)`, currency, priceTolPct: 2, qtyTolPct: 0, packets },
        psis_spend_analytics: { name: `Carried Forward from Requisitions (${suppliers.length} Suppliers)`, currency, suppliers },
      },
    };
  }

  if (sourceLabId === 'psis_the_tender') {
    const bids = Array.isArray(draftState?.bids) && draftState.bids.length
      ? draftState.bids
      : Array.isArray(activeDataset?.bids) ? activeDataset.bids : [];
    if (!bids.length) return null;

    const sorted = [...bids].sort((a, b) => (Number(a.bidPrice) || 0) - (Number(b.bidPrice) || 0));
    const winner = sorted[0];
    const unitBase = Math.max(50, Math.round((Number(winner.bidPrice) || 50000) / 100));
    const packets = [
      {
        id: 'cf_tnd_1',
        poNo: 'PO-AWARD-01',
        grnNo: 'GRN-AWARD-01',
        invNo: 'INV-AWARD-01',
        supplier: winner.supplier,
        item: 'Contract Lot Delivery — Tranche 1 (Awarded Tender Rate)',
        poApproved: true,
        poQty: 50,
        poUnitPrice: unitBase,
        grnPosted: true,
        grnQty: 50,
        invQty: 50,
        invUnitPrice: unitBase,
        budgetRemaining: 500000,
        duplicateOf: null,
      },
      {
        id: 'cf_tnd_2',
        poNo: 'PO-AWARD-02',
        grnNo: 'GRN-AWARD-02',
        invNo: 'INV-AWARD-02',
        supplier: winner.supplier,
        item: 'Contract Lot Delivery — Tranche 2 (Post-Award Price Creep Test)',
        poApproved: true,
        poQty: 50,
        poUnitPrice: unitBase,
        grnPosted: true,
        grnQty: 50,
        invQty: 50,
        invUnitPrice: Math.round(unitBase * 1.09),
        budgetRemaining: 500000,
        duplicateOf: null,
      },
    ];

    return {
      sourceLabId,
      sourceLabel: 'PSIS-LAB 06 — Electronic Tendering & Reverse Auction',
      createdAt,
      itemCount: bids.length,
      targets: {
        psis_the_match: { name: `Awarded Contract (${winner.supplier}) → P2P Audit`, currency, priceTolPct: 2, qtyTolPct: 0, packets },
      },
    };
  }

  if (sourceLabId === 'psis_the_match') {
    const packets = Array.isArray(draftState?.packets) && draftState.packets.length
      ? draftState.packets
      : Array.isArray(activeDataset?.packets) ? activeDataset.packets : [];
    if (!packets.length) return null;

    const supMap = new Map();
    packets.forEach((p) => {
      const sup = String(p.supplier || 'Supplier');
      const poVal = (Number(p.poQty) || 0) * (Number(p.poUnitPrice) || 0);
      const invVal = (Number(p.invQty) || 0) * (Number(p.invUnitPrice) || 0);
      const shortShip = (Number(p.grnQty) || 0) < (Number(p.poQty) || 0);
      const priceDiffPct = poVal > 0 ? ((invVal - poVal) / poVal) * 100 : 0;
      if (!supMap.has(sup)) {
        supMap.set(sup, { name: sup, spend: 0, total: 0, shortShips: 0, varSum: 0 });
      }
      const s = supMap.get(sup);
      s.spend += invVal;
      s.total += 1;
      if (shortShip) s.shortShips += 1;
      s.varSum += priceDiffPct;
    });

    const suppliers = [...supMap.values()].map((s, idx) => ({
      id: `cf_p2p_sup_${idx + 1}`,
      name: s.name,
      category: 'P2P Audited Suppliers',
      annualSpend: Math.round(s.spend),
      otifPct: Math.round(((s.total - s.shortShips) / Math.max(1, s.total)) * 100),
      defectPpm: s.shortShips > 0 ? 4800 : 600,
      priceVariancePct: Number((s.varSum / Math.max(1, s.total)).toFixed(1)),
      responsiveness: s.shortShips > 0 ? 70 : 90,
      onContract: Math.abs(s.varSum / Math.max(1, s.total)) <= 2,
    }));

    return {
      sourceLabId,
      sourceLabel: 'PSIS-LAB 04 — P2P Controls & Three-Way Matching',
      createdAt,
      itemCount: packets.length,
      targets: {
        psis_spend_analytics: { name: `Carried Forward from P2P Controls (${suppliers.length} Suppliers)`, currency, suppliers },
      },
    };
  }

  return null;
}

export function extractCarryForwardImport(targetLabId, storedHandoff) {
  if (!storedHandoff || !storedHandoff.targets || !storedHandoff.targets[targetLabId]) return null;
  return {
    sourceLabId: storedHandoff.sourceLabId,
    sourceLabel: storedHandoff.sourceLabel,
    createdAt: storedHandoff.createdAt,
    dataset: storedHandoff.targets[targetLabId],
  };
}

// ============================================================================
// 5. VARIANT-SPECIFIC ORAL DEFENSE / VIVA QUESTION GENERATOR (ALL 11 LABS)
// ============================================================================

/**
 * Generates 4 tailored oral defense / post-lab verification questions grounded in
 * the student or syndicate's exact seeded variant ID and computed metrics.
 */
export function generateLabVivaQuestions({ labId, labEvidence, variantTag, studentOrGroupLabel }) {
  const who = studentOrGroupLabel || 'this submission';
  const variantNote = variantTag ? ` (Variant ${variantTag})` : '';
  const metrics = Array.isArray(labEvidence?.metrics) ? labEvidence.metrics : [];
  const metricText = (keyword, fallback) => {
    const found = metrics.find((m) => String(m.label || '').toLowerCase().includes(keyword.toLowerCase()));
    return found ? `${found.label}: ${found.value}` : fallback;
  };
  const topMetrics = metrics.slice(0, 3).map((m) => `${m.label} = ${m.value}`).join(', ');

  const templates = {
    tqm_spc: [
      {
        q: `In your SPC run${variantNote} (${metricText('cpk', 'your capability results')}), why must you verify statistical control on the control chart BEFORE interpreting Cp or Cpk?`,
        cue: 'Capability ratios assume a stable, predictable distribution; special-cause signals make Cpk mathematically unreliable.',
      },
      {
        q: `Point to one out-of-control signal or shift in your dataset (${metricText('signal', 'your plotted subgroups')}) and distinguish whether it indicates a common-cause or special-cause issue.`,
        cue: 'Must cite Rule 1 (±3σ breach) or run/trend rule and name a concrete assignable operational cause.',
      },
      {
        q: `If Cp is noticeably higher than Cpk in your results, what single operational change improves process capability fastest without buying new machinery?`,
        cue: 'Re-centering the process mean toward the target midpoint of USL/LSL.',
      },
      {
        q: `How would your control limits change if you increased subgroup size n, and why does that improve shift detection?`,
        cue: 'Tighter limits (smaller A2 / √n effect) increase sensitivity to smaller process mean shifts.',
      },
    ],
    tqm_tools: [
      {
        q: `Based on your Pareto 80/20 output${variantNote} (${topMetrics || 'your defect ledger'}), which vital-few categories would you tackle first and why not the trivial many?`,
        cue: 'Should cite top cumulative ~80% categories and resource focus principle.',
      },
      {
        q: `Walk through one root cause from your Ishikawa Fishbone diagram and explain how you would verify it using Stratification or a Scatter plot.`,
        cue: 'Connects qualitative 6M hypothesis to quantitative verification.',
      },
      {
        q: `What hidden risk arises if you only count defect frequency on a Check Sheet without weighting by cost per defect?`,
        cue: 'High-frequency minor defects may mask rare catastrophic external-failure defects.',
      },
      {
        q: `If your correlation r in the Scatter tool is strong, why is that still not proof of causation?`,
        cue: 'Confounding variables or reverse causality require controlled testing or stratification.',
      },
    ],
    tqm_coq: [
      {
        q: `Looking at your PAF ledger${variantNote} (${topMetrics || 'your COQ breakdown'}), which failure bucket dominates your Cost of Poor Quality and what hidden iceberg costs sit beneath it?`,
        cue: 'Should identify internal vs external failure share plus hidden costs (lost goodwill, expediting, rework capacity loss).',
      },
      {
        q: `Explain why your Prevention investment scenario achieved its ROI/payback under the Modern TQM curve compared to the Classical COQ curve.`,
        cue: 'Modern TQM shows optimal quality approaches zero defects as prevention technology lowers conformance cost.',
      },
      {
        q: `What happens to External Failure costs if management cuts Appraisal inspection without first investing in Prevention?`,
        cue: 'Defects escape to customers, multiplying total COQ sharply.',
      },
      {
        q: `How would you defend your proposed Prevention budget to a sceptical Finance Director using your exact COQ % of revenue?`,
        cue: 'Tie prevention spend directly to net COQ reduction and payback period.',
      },
    ],
    psis_the_whip: [
      {
        q: `In your simulation${variantNote} (${metricText('bullwhip', topMetrics || 'your tier variance metrics')}), why did Factory order variance exceed Retailer variance even when consumer demand changed modestly?`,
        cue: 'Information distortion, order batching, forecast updating, and lead-time amplification across tiers.',
      },
      {
        q: `Compare your Blind Mode vs. Shared POS Mode Total Chain Cost — what single information change drove the compression?`,
        cue: 'Upstream tiers reacting to true end-consumer POS rather than distorted local downstream orders.',
      },
      {
        q: `Why did Paper-Mode information delay amplify stockouts and over-ordering simultaneously?`,
        cue: 'Longer order-processing latency creates phantom shortages, triggering panic over-orders that arrive after demand stabilizes.',
      },
      {
        q: `Name two real ERP/EDI mechanisms (e.g., VMI, CPFR, POS feeds) you would deploy to lock in the Shared POS gains.`,
        cue: 'Specific operational mechanism + governance owner.',
      },
    ],
    psis_seven_names: [
      {
        q: `Your Master Data audit${variantNote} reported (${metricText('hygiene', topMetrics || 'your duplicate cluster metrics')}). Explain step-by-step how two duplicate SKUs for the same item trigger an unnecessary emergency Purchase Order.`,
        cue: 'Stock split across SKU-A and SKU-B drops each below ROP even when combined physical stock is sufficient.',
      },
      {
        q: `Why did receiving clerks create duplicate SKUs under queue pressure in this lab, and what ERP UI/governance gate prevents it?`,
        cue: 'Free-text creation without mandatory fuzzy search, barcode scan, or central Master Data Steward approval.',
      },
      {
        q: `How do duplicate SKUs distort downstream Spend Cube Analytics and supplier volume rebates?`,
        cue: 'Fragmented item spend hides total volume leverage during supplier negotiations.',
      },
      {
        q: `Before merging two duplicate SKU records in a live ERP, what three records must be reconciled first?`,
        cue: 'Open POs, on-hand inventory/bin balances, and historical transaction/costing links.',
      },
    ],
    psis_scan_it: [
      {
        q: `Using one GTIN from your barcode log${variantNote} (${topMetrics || 'your scanned items'}), explain why a GS1 prefix like 603 identifies the licensing Member Organization rather than the factory’s country of manufacture.`,
        cue: 'GS1 prefix denotes where the brand owner licensed its Company Prefix, not necessarily production origin.',
      },
      {
        q: `Walk through the GS1 Mod-10 check-digit math that caught your transposition trap when two adjacent digits were swapped.`,
        cue: 'Alternating 3-and-1 weights change the weighted sum modulo 10 whenever adjacent digits differ (except rare |a-b|=5 cases).',
      },
      {
        q: `Why does barcode/AIDC scanning at goods receipt eliminate both Master Data duplication and P2P quantity errors?`,
        cue: 'Direct lookup against canonical GTIN master removes manual keying and description ambiguity.',
      },
      {
        q: `When would an organization need GS1-128 or QR/DataMatrix instead of a standard EAN-13 barcode?`,
        cue: 'When capturing variable attributes like batch/lot number, expiry date, or serial number (e.g., pharmaceuticals).',
      },
    ],
    psis_the_match: [
      {
        q: `In your P2P audit${variantNote} (${metricText('accuracy', topMetrics || 'your invoice audit results')}), justify one invoice you blocked by naming the exact control gate that failed.`,
        cue: 'Must distinguish Qty variance (Inv vs GRN), Price variance (Inv vs PO), missing GRN, duplicate invoice, or budget breach.',
      },
      {
        q: `Why did an automated, properly configured Three-Way Match STILL release payment in the Super-User Ghost-Vendor simulation?`,
        cue: 'Because the same user fabricated a matching PO, GRN, and Invoice — 3-way match checks document consistency, NOT role separation.',
      },
      {
        q: `Which specific toxic role pair must be separated at minimum in a small procurement unit, and what compensating control is needed if headcount is tight?`,
        cue: 'Vendor Master Create + Payment Release (or PO Approve + GRN Post); compensating control = independent bank-change audit log & director review.',
      },
      {
        q: `Why is a 2% price tolerance acceptable on certain commodities while 0% quantity tolerance is stricter for controlled stock?`,
        cue: 'FX/freight rounding vs physical theft/short-delivery exposure.',
      },
    ],
    psis_req_to_order: [
      {
        q: `Based on your DoA & Commitment run${variantNote} (${topMetrics || 'your requisition audit'}), explain how Spent-Only accounting allows a department to exceed its annual budget without any single PO looking over-budget.`,
        cue: 'Open approved POs are not encumbered until invoiced/paid, allowing double-commitment of the same budget balance.',
      },
      {
        q: `How did you detect split-order avoidance in your requisition queue, and what automated ERP rule stops it?`,
        cue: 'Cumulative rolling-window spend aggregation per supplier/item/cost centre before DoA tier evaluation.',
      },
      {
        q: `Using your Blanket Order break-even calculation, at what annual call-off volume does a Blanket Purchase Agreement beat standard POs?`,
        cue: 'Break-even = Setup Cost / (Standard PO Processing Cost − Call-Off Cost).',
      },
      {
        q: `What governance risk must be controlled when delegating Blanket Order call-offs to user departments?`,
        cue: 'Enforcing maximum contract value cap, expiry date, and approved catalogue line pricing.',
      },
    ],
    psis_the_tender: [
      {
        q: `In your evaluation${variantNote} (${topMetrics || 'your sealed tender & auction results'}), did the Lowest-Price bidder also win the Best-Value weighted score? Defend your award decision.`,
        cue: 'Must weigh total cost of ownership, technical quality, delivery, and local content against raw bid price.',
      },
      {
        q: `What is the "Winner’s Curse" in a live Reverse Auction, and how can an excessively low winning bid end up costing the buyer MORE over the contract life?`,
        cue: 'Bidding below sustainable cost floor leads to quality cutting, change-order claims, delivery delays, or supplier default.',
      },
      {
        q: `Why must evaluation criteria weights be locked and disclosed BEFORE opening sealed financial bids?`,
        cue: 'Prevents post-hoc weight manipulation to favour a preferred bidder (procurement integrity & auditability).',
      },
      {
        q: `For which category of spend is a Reverse Auction appropriate versus a two-envelope Quality-and-Cost-Based Selection (QCBS)?`,
        cue: 'Reverse auctions fit standardized commodities with clear specs & multiple capable bidders; QCBS fits complex/strategic services.',
      },
    ],
    psis_inventory_wms: [
      {
        q: `Using your EOQ and Safety Stock output${variantNote} (${topMetrics || 'your replenishment settings'}), explain why raising target service level from 95% to 99.9% nearly doubles Safety Stock.`,
        cue: 'Normal distribution z-score rises nonlinearly from 1.645 to 3.09.',
      },
      {
        q: `How should your replenishment policy differ between an AX SKU and an AZ or CZ SKU in your ABC-XYZ matrix?`,
        cue: 'AX = tight JIT/blanket automated replenishment; AZ = buffer or make-to-order/vendor-held stock; CZ = rationalize/spot buy.',
      },
      {
        q: `In your Cycle Count audit, why is high inventory shrinkage financially dangerous even if total net unit variance across all bins looks close to zero?`,
        cue: 'Positive and negative bin errors cancel in net totals while hiding high-value shrinkage and causing stockouts on specific SKUs.',
      },
      {
        q: `Why do world-class warehouses prefer continuous ABC-frequency Cycle Counting over a single annual wall-to-wall stocktake?`,
        cue: 'No warehouse shutdown, faster root-cause correction on A-items, and continuously reliable ERP stock records.',
      },
    ],
    psis_spend_analytics: [
      {
        q: `In your Supplier Scorecard & Spend Cube${variantNote} (${topMetrics || 'your scorecard results'}), which supplier sits on Watchlist/At-Risk and what specific KPI dragged their weighted score down?`,
        cue: 'Should cite exact OTIF, Defect PPM, Price Variance, or Responsiveness gap.',
      },
      {
        q: `Explain the operational and financial difference between Maverick (off-contract) Spend and Tail Spend in your Spend Cube.`,
        cue: 'Maverick spend bypasses existing negotiated contracts (compliance leakage); Tail spend is the long tail of tiny suppliers in the bottom 20% of spend (high PO admin cost).',
      },
      {
        q: `How does changing scorecard weights (e.g., prioritizing Quality PPM over Price Variance) shift your Preferred supplier ranking?`,
        cue: 'Demonstrates category strategy alignment (e.g., critical clinical items vs indirect stationery).',
      },
      {
        q: `What concrete 90-day corrective action plan would you give your lowest-ranked strategic supplier before switching vendors?`,
        cue: 'Time-bound SLA targets, root-cause corrective action (CAPA), dual-sourcing contingency, and quarterly QBR review.',
      },
    ],
    scm_landed_cost: [
      {
        q: `In your landed cost run${variantNote} (${topMetrics || 'your route comparison'}), explain why an offshore supplier with the lowest FOB price can still lose on Total Landed Cost.`,
        cue: 'Ocean freight, customs duty/VAT cascading on CIF value, port demurrage, and transit working capital outweigh FOB savings.',
      },
      {
        q: `Under CIF, who pays ocean freight to the destination port, and where does physical risk of loss transfer to the buyer?`,
        cue: 'Seller pays freight & minimum insurance to destination port, but risk transfers on board vessel at the ORIGIN port.',
      },
      {
        q: `Why does Import VAT compound on top of (CIF + Import Duty) rather than on Ex-Works invoice value?`,
        cue: 'Standard customs valuation taxes landed customs value inclusive of freight, insurance, and tariff duty.',
      },
      {
        q: `How does rising financing cost (% p.a. capital rate) shift the trade-off between slow ocean freight and faster air/regional sourcing?`,
        cue: 'Higher pipeline holding cost and safety stock requirements penalize long transit times.',
      },
    ],
    scm_contract_sla: [
      {
        q: `In your SLA audit${variantNote} (${topMetrics || 'your liquidated damages summary'}), explain the difference between raw accrued penalties and capped payable liquidated damages.`,
        cue: 'Liability caps limit supplier exposure (typically 5–15% of contract value) so remedies remain commercially enforceable rather than punitive.',
      },
      {
        q: `Why did toggling Force Majeure on a disrupted month change both payable penalties and the consecutive breach streak?`,
        cue: 'Excusable extraordinary events pause penalty accrual and reset material-breach termination streaks when properly notified.',
      },
      {
        q: `If a supplier hits the Material Breach threshold, why shouldn’t a procurement manager immediately terminate the contract without checking Switching Cost?`,
        cue: 'Re-tendering delays, requalification costs, and supply stockouts may cost more than a structured Cure Notice or dual-source transition.',
      },
      {
        q: `What makes Liquidated Damages legally enforceable compared to an unenforceable "penalty clause"?`,
        cue: 'Must represent a genuine, pre-agreed estimate of foreseeable operational loss rather than arbitrary punishment.',
      },
    ],
    scm_green_procurement: [
      {
        q: `Using your carbon trade-off results${variantNote} (${topMetrics || 'your ESG scores'}), explain why switching from Air freight to Sea freight dramatically cuts Scope 3 emissions.`,
        cue: 'Air freight emits ~0.602 kg CO2e/t-km vs ~0.016 for ocean (~38× reduction in freight intensity).',
      },
      {
        q: `At what Shadow Carbon Price did the sustainable supplier overtake the cheapest direct-price bidder in your analysis?`,
        cue: 'Tipping point equals the Carbon Abatement Cost = (Green Premium) / (Tonnes CO2e Saved).',
      },
      {
        q: `Why should procurement measure BOTH Scope 1/2 supplier manufacturing emissions AND Scope 3 inbound logistics emissions?`,
        cue: 'Focusing on only one can hide carbon leakage (e.g., low-carbon factory air-freighted across continents).',
      },
      {
        q: `How would you defend paying a modest green premium to a budget-constrained CFO?`,
        cue: 'Cite carbon-cap compliance, CBAM/regulatory tariff exposure, brand risk, and low abatement cost per tonne CO2e.',
      },
    ],
  };

  const questions = templates[labId] || [
    {
      q: `Walk through the key quantitative outputs for ${who}${variantNote} (${topMetrics || 'your lab metrics'}) and explain the primary managerial implication.`,
      cue: 'Verify student understands how their computed figures drive operational decisions.',
    },
  ];

  return {
    header: `Oral Defense / Viva Prompts — ${who}${variantNote}`,
    metricsContext: topMetrics || 'Standard dataset metrics',
    questions,
  };
}

// ============================================================================
// 6. COURSE DATASET LIBRARY & CLO MAPPING HELPERS
// ============================================================================

export function normalizeLabDatasetsLibrary(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((d) => d && typeof d === 'object' && d.id && d.labId && d.dataset && typeof d.dataset === 'object')
    .slice(0, 24)
    .map((d) => ({
      id: String(d.id),
      labId: String(d.labId),
      name: String(d.name || d.dataset?.name || 'Saved Dataset').trim().slice(0, 120),
      rowCount: Math.max(0, Number(d.rowCount) || 0),
      savedAt: d.savedAt || new Date().toISOString(),
      dataset: d.dataset,
    }));
}

export function normalizeMappedClos(clos) {
  if (!Array.isArray(clos)) return [];
  const seen = new Set();
  const out = [];
  for (const c of clos) {
    const code = String(typeof c === 'string' ? c : c?.code || '').trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out.slice(0, 12);
}
