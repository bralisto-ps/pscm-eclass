// Pure deterministic engine for Purchasing & Supply Information Systems (PSIS) labs:
// 1. Lab 2 (Seven Names): Item Master duplicate detection & stock fragmentation audit
// 2. Lab 3 (Scan It): GS1 GTIN-8/12/13/14 dissector, Mod-10 check digit proof & transposition trap
// 3. Lab 4 (The Match): Procure-to-Pay 3-Way Match engine & Segregation of Duties (SoD) auditor

// ============================================================================
// 1. MASTER DATA NEAR-DUPLICATE DETECTION (LAB 2: SEVEN NAMES)
// ============================================================================

const STOP_WORDS = new Set([
  'the', 'of', 'and', 'for', 'with', 'in', 'a', 'an', 'per', 'by', 'no', 'size', 'pack', 'box', 'pkt', 'pcs', 'pc', 'ctn', 'carton',
]);

export function normalizeSkuText(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/(\d+)\s*(g|gm|gms|gsm)\b/g, '$1gsm')
    .replace(/(\d+)\s*(ml|mls)\b/g, '$1ml')
    .replace(/(\d+)\s*(l|ltr|ltrs|litre|litres|liter|liters)\b/g, '$1l')
    .replace(/(\d+)\s*(mg|mgs)\b/g, '$1mg')
    .replace(/(\d+)\s*(sh|sht|shts|sheets)\b/g, '$1sheets')
    .replace(/\b(med|md)\b/g, 'medium')
    .replace(/\b(lg|lrg)\b/g, 'large')
    .replace(/\b(sm|sml)\b/g, 'small')
    .replace(/\b(exam)\b/g, 'examination')
    .replace(/\b(photocopy|copier|copy)\b/g, 'paper')
    .replace(/\b(ream|reams)\b/g, '500sheets')
    .replace(/\b(tabs|tab|tablet|tablets)\b/g, 'tablets')
    .replace(/\b(sanitiser|sanitizer)\b/g, 'sanitizer')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeSku(raw) {
  const norm = normalizeSkuText(raw);
  if (!norm) return [];
  return [...new Set(norm.split(' ').filter((w) => w.length > 1 && !STOP_WORDS.has(w)))];
}

export function levenshteinDistance(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const dp = Array.from({ length: s.length + 1 }, () => new Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i++) dp[i][0] = i;
  for (let j = 0; j <= t.length; j++) dp[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[s.length][t.length];
}

export function skuSimilarityScore(nameA, nameB) {
  const normA = normalizeSkuText(nameA);
  const normB = normalizeSkuText(nameB);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const tokA = tokenizeSku(nameA);
  const tokB = tokenizeSku(nameB);
  const setA = new Set(tokA);
  const setB = new Set(tokB);

  let inter = 0;
  for (const t of setA) {
    if (setB.has(t)) {
      inter += 1;
    } else {
      for (const u of setB) {
        if (t.length >= 4 && u.length >= 4 && levenshteinDistance(t, u) <= 1) {
          inter += 0.85;
          break;
        }
      }
    }
  }
  const union = Math.max(1, setA.size + setB.size - inter);
  const jaccard = Math.min(1, inter / union);
  const maxLen = Math.max(normA.length, normB.length);
  const editSim = maxLen > 0 ? 1 - levenshteinDistance(normA, normB) / maxLen : 0;
  return Math.min(1, Number((0.72 * jaccard + 0.28 * editSim).toFixed(3)));
}

export function findMasterDataDuplicates(items, threshold = 0.52) {
  const list = (items || []).map((it, idx) => ({
    code: String(it.code || `SKU-${idx + 1}`).trim(),
    name: String(it.name || '').trim(),
    stock: Math.max(0, Number(it.stock) || 0),
    canonicalId: it.canonicalId || null,
    createdByStudent: Boolean(it.createdByStudent),
  })).filter((it) => it.name);

  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const sameCanon = list[i].canonicalId && list[j].canonicalId && list[i].canonicalId === list[j].canonicalId;
      const sim = skuSimilarityScore(list[i].name, list[j].name);
      if (sameCanon || sim >= threshold) {
        unite(i, j);
      }
    }
  }

  const groupsMap = new Map();
  list.forEach((item, idx) => {
    const root = find(idx);
    if (!groupsMap.has(root)) groupsMap.set(root, []);
    groupsMap.get(root).push(item);
  });

  const clusters = [...groupsMap.values()].map((members, idx) => {
    const totalStock = members.reduce((s, m) => s + m.stock, 0);
    return {
      id: `cluster_${idx + 1}`,
      primaryName: members[0].name,
      count: members.length,
      isDuplicateCluster: members.length > 1,
      totalStock,
      members,
    };
  });

  clusters.sort((a, b) => b.count - a.count || b.totalStock - a.totalStock);
  const duplicateClusters = clusters.filter((c) => c.isDuplicateCluster);
  const extraDuplicateRecords = duplicateClusters.reduce((s, c) => s + (c.count - 1), 0);
  const uniquePhysicalItems = clusters.length;
  const totalRecords = list.length;
  const duplicateRatePct = totalRecords > 0 ? (extraDuplicateRecords / totalRecords) * 100 : 0;
  const hygieneScore = totalRecords > 0 ? Math.max(0, Math.round((uniquePhysicalItems / totalRecords) * 100)) : 100;

  return {
    totalRecords,
    uniquePhysicalItems,
    extraDuplicateRecords,
    duplicateRatePct,
    hygieneScore,
    clusters,
    duplicateClusters,
  };
}

// ============================================================================
// 2. GS1 GTIN / BARCODE ARITHMETIC & MEMBER ORG LOOKUP (LAB 3: SCAN IT)
// ============================================================================

const GS1_PREFIX_RANGES = [
  [0, 19, 'GS1 US'],
  [20, 29, 'Restricted Circulation (In-Store / Variable Weight)'],
  [30, 39, 'GS1 US (Drugs / NDC)'],
  [40, 49, 'Restricted Circulation (Local)'],
  [50, 59, 'GS1 US (Coupons)'],
  [60, 139, 'GS1 US'],
  [200, 299, 'Restricted Circulation (In-Store)'],
  [300, 379, 'GS1 France'],
  [380, 380, 'GS1 Bulgaria'],
  [400, 440, 'GS1 Germany'],
  [450, 459, 'GS1 Japan'],
  [460, 469, 'GS1 Russia'],
  [471, 471, 'GS1 Taiwan'],
  [489, 489, 'GS1 Hong Kong'],
  [490, 499, 'GS1 Japan'],
  [500, 509, 'GS1 UK'],
  [520, 521, 'GS1 Greece'],
  [539, 539, 'GS1 Ireland'],
  [540, 549, 'GS1 Belgium & Luxembourg'],
  [560, 560, 'GS1 Portugal'],
  [570, 579, 'GS1 Denmark'],
  [590, 590, 'GS1 Poland'],
  [600, 601, 'GS1 South Africa'],
  [603, 603, 'GS1 Ghana'],
  [604, 604, 'GS1 Senegal'],
  [608, 608, 'GS1 Bahrain'],
  [609, 609, 'GS1 Mauritius'],
  [611, 611, 'GS1 Morocco'],
  [613, 613, 'GS1 Algeria'],
  [615, 615, 'GS1 Nigeria'],
  [616, 616, 'GS1 Kenya'],
  [617, 617, 'GS1 Cameroon'],
  [618, 618, 'GS1 Cote d’Ivoire'],
  [619, 619, 'GS1 Tunisia'],
  [620, 620, 'GS1 Tanzania'],
  [622, 622, 'GS1 Egypt'],
  [628, 628, 'GS1 Saudi Arabia'],
  [629, 629, 'GS1 UAE'],
  [640, 649, 'GS1 Finland'],
  [690, 699, 'GS1 China'],
  [700, 709, 'GS1 Norway'],
  [729, 729, 'GS1 Israel'],
  [730, 739, 'GS1 Sweden'],
  [750, 750, 'GS1 Mexico'],
  [754, 755, 'GS1 Canada'],
  [760, 769, 'GS1 Switzerland'],
  [789, 790, 'GS1 Brazil'],
  [800, 839, 'GS1 Italy'],
  [840, 849, 'GS1 Spain'],
  [868, 869, 'GS1 Turkey'],
  [870, 879, 'GS1 Netherlands'],
  [880, 880, 'GS1 South Korea'],
  [885, 885, 'GS1 Thailand'],
  [888, 888, 'GS1 Singapore'],
  [890, 890, 'GS1 India'],
  [893, 893, 'GS1 Vietnam'],
  [899, 899, 'GS1 Indonesia'],
  [900, 919, 'GS1 Austria'],
  [930, 939, 'GS1 Australia'],
  [940, 949, 'GS1 New Zealand'],
  [955, 955, 'GS1 Malaysia'],
  [977, 977, 'Serial Publications (ISSN)'],
  [978, 979, 'Bookland (ISBN)'],
];

export function lookupGs1MemberOrg(prefix3) {
  const num = Number(prefix3);
  if (!Number.isInteger(num) || num < 0 || num > 999) return 'Unknown GS1 Prefix';
  for (const [lo, hi, org] of GS1_PREFIX_RANGES) {
    if (num >= lo && num <= hi) return org;
  }
  return `Unassigned / Other GS1 Prefix (${String(prefix3).padStart(3, '0')})`;
}

export function cleanBarcodeDigits(raw) {
  return String(raw || '').replace(/\D+/g, '');
}

export function computeGtinCheckDigit(payloadDigits) {
  const digits = cleanBarcodeDigits(payloadDigits);
  if (!digits.length) return null;
  let sum = 0;
  const steps = [];
  for (let i = 0; i < digits.length; i++) {
    const posFromRight = digits.length - i;
    const weight = posFromRight % 2 === 1 ? 3 : 1;
    const d = Number(digits[i]);
    const prod = d * weight;
    sum += prod;
    steps.push({ index: i + 1, digit: d, weight, product: prod });
  }
  const mod = sum % 10;
  const checkDigit = mod === 0 ? 0 : 10 - mod;
  return { sum, mod, checkDigit, steps };
}

export function parseAndValidateGtin(rawCode) {
  const digits = cleanBarcodeDigits(rawCode);
  const validLengths = new Set([8, 12, 13, 14]);
  if (!validLengths.has(digits.length)) {
    return {
      raw: String(rawCode || ''),
      digits,
      format: null,
      valid: false,
      error: `Expected 8, 12, 13, or 14 digits (got ${digits.length}).`,
    };
  }

  const formatMap = {
    8: 'GTIN-8 (EAN-8)',
    12: 'GTIN-12 (UPC-A)',
    13: 'GTIN-13 (EAN-13)',
    14: 'GTIN-14 (ITF-14 / Case)',
  };

  const payload = digits.slice(0, -1);
  const actualCheck = Number(digits.slice(-1));
  const calc = computeGtinCheckDigit(payload);
  const valid = calc.checkDigit === actualCheck;

  let indicator = null;
  let prefix3 = '';
  let companyPrefix = '';
  let itemRef = '';
  if (digits.length === 14) {
    indicator = digits[0];
    prefix3 = digits.slice(1, 4);
    companyPrefix = digits.slice(4, 9);
    itemRef = digits.slice(9, 13);
  } else if (digits.length === 13) {
    prefix3 = digits.slice(0, 3);
    companyPrefix = digits.slice(3, 8);
    itemRef = digits.slice(8, 12);
  } else if (digits.length === 12) {
    prefix3 = `0${digits.slice(0, 2)}`;
    companyPrefix = digits.slice(2, 6);
    itemRef = digits.slice(6, 11);
  } else {
    prefix3 = digits.slice(0, 3);
    companyPrefix = digits.slice(3, 5);
    itemRef = digits.slice(5, 7);
  }

  return {
    raw: String(rawCode || ''),
    digits,
    format: formatMap[digits.length],
    indicator,
    gs1Prefix: prefix3,
    memberOrg: lookupGs1MemberOrg(prefix3),
    companyPrefix,
    itemRef,
    actualCheck,
    expectedCheck: calc.checkDigit,
    weightedSum: calc.sum,
    mod10: calc.mod,
    steps: calc.steps,
    valid,
    error: valid
      ? null
      : `Check digit mismatch: calculated ${calc.checkDigit}, but barcode ends with ${actualCheck}. Entry rejected.`,
  };
}

export function transposeAdjacentDigits(rawCode, position = -1) {
  const digits = cleanBarcodeDigits(rawCode);
  if (digits.length < 4) return digits;
  let idx = position >= 0 && position < digits.length - 2 ? position : Math.floor(digits.length / 2);
  for (let tries = 0; tries < digits.length - 1; tries++) {
    const k = (idx + tries) % (digits.length - 1);
    if (digits[k] !== digits[k + 1]) {
      return digits.slice(0, k) + digits[k + 1] + digits[k] + digits.slice(k + 2);
    }
  }
  return digits;
}

// ============================================================================
// 3. PROCURE-TO-PAY 3-WAY MATCH & SEGREGATION OF DUTIES (LAB 4: THE MATCH)
// ============================================================================

export function evaluateThreeWayMatch(packet, tolerances = {}) {
  const priceTolPct = Math.max(0, Number(tolerances.priceTolPct ?? 2));
  const qtyTolPct = Math.max(0, Number(tolerances.qtyTolPct ?? 0));

  const poQty = Math.max(0, Number(packet.poQty) || 0);
  const poUnitPrice = Math.max(0, Number(packet.poUnitPrice) || 0);
  const grnQty = Math.max(0, Number(packet.grnQty) || 0);
  const invQty = Math.max(0, Number(packet.invQty) || 0);
  const invUnitPrice = Math.max(0, Number(packet.invUnitPrice) || 0);
  const budgetRemaining = packet.budgetRemaining != null ? Number(packet.budgetRemaining) : null;

  const poTotal = poQty * poUnitPrice;
  const grnValue = grnQty * poUnitPrice;
  const invTotal = invQty * invUnitPrice;
  const varianceAmount = invTotal - grnValue;

  const blocks = [];

  if (!packet.poApproved) {
    blocks.push({ code: 'UNAPPROVED_PO', label: 'Unapproved Purchase Order', detail: 'PO has not been authorized by Manager / DoA.' });
  }
  if (budgetRemaining !== null && poTotal > budgetRemaining + 0.01) {
    blocks.push({
      code: 'OVER_BUDGET',
      label: 'Budget Exceeded',
      detail: `PO total (${poTotal.toLocaleString()}) exceeds cost-centre budget (${budgetRemaining.toLocaleString()}).`,
    });
  }
  if (packet.duplicateInvoice) {
    blocks.push({
      code: 'DUPLICATE_INVOICE',
      label: 'Duplicate Invoice Number',
      detail: `Invoice ${packet.invoiceNo} has already been posted for this supplier.`,
    });
  }
  if (!packet.grnPosted || grnQty === 0) {
    blocks.push({
      code: 'NO_GOODS_RECEIPT',
      label: 'Missing Goods Receipt (GRN)',
      detail: 'Storekeeper has not confirmed physical delivery on the dock.',
    });
  }

  const maxAllowedQty = grnQty * (1 + qtyTolPct / 100);
  if (packet.grnPosted && invQty > maxAllowedQty + 1e-6) {
    blocks.push({
      code: 'QTY_OVERBILLED',
      label: 'Quantity Mismatch (Short Delivery / Over-Billing)',
      detail: `Supplier invoiced ${invQty} units, but Storekeeper only received ${grnQty} (Ordered: ${poQty}).`,
    });
  }

  const priceDiffPct = poUnitPrice > 0 ? ((invUnitPrice - poUnitPrice) / poUnitPrice) * 100 : 0;
  if (priceDiffPct > priceTolPct + 1e-6) {
    blocks.push({
      code: 'PRICE_VARIANCE',
      label: 'Unit Price Exceeds Tolerance',
      detail: `Invoiced unit price (${invUnitPrice}) is +${priceDiffPct.toFixed(1)}% above PO price (${poUnitPrice}), exceeding ±${priceTolPct}% tolerance.`,
    });
  }

  const decision = blocks.length === 0 ? 'RELEASE' : 'BLOCK';
  return {
    decision,
    blocks,
    poTotal,
    grnValue,
    invTotal,
    varianceAmount,
    priceDiffPct,
    shortDeliveryQty: Math.max(0, poQty - grnQty),
  };
}

export const SOD_TOXIC_RULES = [
  {
    id: 'buyer_storekeeper',
    roles: ['buyer', 'storekeeper'],
    severity: 'critical',
    title: 'Buyer + Storekeeper (Create PO & Confirm Receipt)',
    risk: 'User can raise an order to a shell supplier and falsely confirm goods arrived without any physical delivery.',
  },
  {
    id: 'buyer_finance',
    roles: ['buyer', 'finance'],
    severity: 'critical',
    title: 'Buyer + Finance (Create PO & Post/Pay Invoice)',
    risk: 'User can inflate PO pricing or approve fictitious supplier invoices directly for payment.',
  },
  {
    id: 'storekeeper_finance',
    roles: ['storekeeper', 'finance'],
    severity: 'high',
    title: 'Storekeeper + Finance (Receive Goods & Post Invoice)',
    risk: 'User can log phantom receipts and immediately match and release invoices against them.',
  },
  {
    id: 'buyer_manager',
    roles: ['buyer', 'manager'],
    severity: 'high',
    title: 'Buyer + Manager (Raise & Self-Approve PO)',
    risk: 'Bypasses budget and delegation-of-authority oversight; enables split orders and uncompetitive awards.',
  },
  {
    id: 'finance_manager',
    roles: ['finance', 'manager'],
    severity: 'medium',
    title: 'Finance + Manager (Post Invoice & Override Match Blocks)',
    risk: 'User can override 3-way match blocks on their own posted invoices without independent review.',
  },
];

export function auditSegregationOfDuties(users) {
  const violations = [];
  (users || []).forEach((u) => {
    const roleSet = new Set(u.roles || []);
    SOD_TOXIC_RULES.forEach((rule) => {
      if (rule.roles.every((r) => roleSet.has(r))) {
        violations.push({
          userId: u.id,
          userName: u.name,
          department: u.department || '',
          ruleId: rule.id,
          severity: rule.severity,
          title: rule.title,
          risk: rule.risk,
        });
      }
    });
  });
  const cleanUsers = (users || []).filter((u) => !violations.some((v) => v.userId === u.id)).length;
  return {
    totalUsers: (users || []).length,
    cleanUsers,
    violatingUsers: (users || []).length - cleanUsers,
    violations,
  };
}
