// Pure deterministic engine for Milestone 6:
// 1. Seeded Per-Student / Per-Syndicate Anti-Copying Lab Dataset Variants
// 2. Class-Wide Lab Debrief Analytics for Assignment Marking
// 3. Post-Class Live Classroom Session Debrief Report Builder

import { parseLabVerificationSummary } from './labScoringBridge.js';

// ============================================================================
// 1. DETERMINISTIC SEEDED ANTI-COPYING DATASET VARIANT ENGINE
// ============================================================================

export function hashSeedString(input = '') {
  const str = String(input || 'default-seed');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createSeededRng(seedStr = '') {
  let a = hashSeedString(seedStr) || 1;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatVariantTag(seedStr = '') {
  const h = hashSeedString(seedStr);
  return `V-${h.toString(36).toUpperCase().slice(0, 5).padStart(5, '0')}`;
}

function jitter(rng, base, minFactor = 0.84, maxFactor = 1.18, decimals = 0) {
  const f = minFactor + rng() * (maxFactor - minFactor);
  const val = Number(base || 0) * f;
  if (decimals <= 0) return Math.max(1, Math.round(val));
  const p = 10 ** decimals;
  return Math.round(val * p) / p;
}

/**
 * Deterministically builds a unique, realistic, valid dataset variant for a student
 * (or syndicate group) from a base lab preset so no two students/groups share identical numbers.
 */
export function generateUniqueLabVariant({ labId, basePreset, seedKey }) {
  if (!labId || !basePreset || !seedKey) return null;
  const fullSeed = `${labId}::${String(seedKey).trim().toUpperCase()}`;
  const rng = createSeededRng(fullSeed);
  const variantTag = formatVariantTag(fullSeed);
  const name = `Unique Variant (${variantTag})`;

  if (labId === 'tqm_spc') {
    const shift = (rng() - 0.5) * 1.4;
    const scale = 0.92 + rng() * 0.16;
    if (Array.isArray(basePreset.subgroups) && basePreset.subgroups.length) {
      const subgroups = basePreset.subgroups.map((sg) => ({
        ...sg,
        values: (sg.values || []).map((v) => Number((Number(v) * scale + shift).toFixed(2))),
      }));
      return {
        variantTag,
        customDataset: {
          ...basePreset,
          name,
          subgroups,
          lsl: basePreset.lsl != null ? Number((basePreset.lsl * scale + shift).toFixed(2)) : null,
          usl: basePreset.usl != null ? Number((basePreset.usl * scale + shift).toFixed(2)) : null,
        },
      };
    }
    if (Array.isArray(basePreset.pSamples)) {
      return {
        variantTag,
        customDataset: {
          ...basePreset,
          name,
          pSamples: basePreset.pSamples.map((s) => ({
            ...s,
            n: jitter(rng, s.n, 0.9, 1.12, 0),
            d: Math.max(0, Math.round((Number(s.d) || 0) * (0.85 + rng() * 0.35))),
          })),
        },
      };
    }
    if (Array.isArray(basePreset.cSamples)) {
      return {
        variantTag,
        customDataset: {
          ...basePreset,
          name,
          cSamples: basePreset.cSamples.map((s) => ({
            ...s,
            c: Math.max(0, Math.round((Number(s.c) || 0) * (0.85 + rng() * 0.35))),
          })),
        },
      };
    }
  }

  if (labId === 'tqm_tools' && basePreset.checkSheet?.rows) {
    const cols = basePreset.checkSheet.columns || [];
    return {
      variantTag,
      customDataset: {
        ...basePreset,
        name,
        checkSheet: {
          columns: [...cols],
          rows: basePreset.checkSheet.rows.map((r) => {
            const counts = {};
            cols.forEach((c) => {
              counts[c] = jitter(rng, Math.max(1, Number(r.counts?.[c] || 1)), 0.78, 1.28, 0);
            });
            return { ...r, counts };
          }),
        },
      },
    };
  }

  if (labId === 'tqm_coq' && Array.isArray(basePreset.items)) {
    const revScale = 0.85 + rng() * 0.32;
    return {
      variantTag,
      customDataset: {
        ...basePreset,
        name,
        revenue: Math.round((Number(basePreset.revenue) || 2000000) * revScale / 1000) * 1000,
        unitsProduced: jitter(rng, basePreset.unitsProduced || 100000, 0.85, 1.2, 0),
        items: basePreset.items.map((it) => ({
          ...it,
          amount: Math.round(jitter(rng, it.amount, 0.82, 1.24, 0) / 100) * 100,
        })),
      },
    };
  }

  if (labId === 'psis_seven_names' && Array.isArray(basePreset.masterItems)) {
    return {
      variantTag,
      customDataset: {
        ...basePreset,
        name,
        masterItems: basePreset.masterItems.map((it) => ({
          ...it,
          stock: jitter(rng, Math.max(5, Number(it.stock) || 10), 0.75, 1.3, 0),
        })),
      },
    };
  }

  if (labId === 'psis_the_whip' && Array.isArray(basePreset.demandSeries)) {
    const factor = 0.8 + rng() * 0.45;
    return {
      variantTag,
      customDataset: {
        ...basePreset,
        name,
        demandSeries: basePreset.demandSeries.map((d) => Math.max(10, Math.round(Number(d) * factor))),
      },
    };
  }

  if (labId === 'psis_the_match' && Array.isArray(basePreset.packets)) {
    // Preserve exact exception ratios (qty/price/budget variance) while shifting base prices & quantities!
    return {
      variantTag,
      customDataset: {
        ...basePreset,
        name,
        packets: basePreset.packets.map((pkt) => {
          const pFactor = 0.86 + rng() * 0.30;
          const qFactor = 0.85 + rng() * 0.30;
          const poQty = Math.max(2, Math.round((Number(pkt.poQty) || 10) * qFactor));
          const grnRatio = pkt.poQty > 0 ? pkt.grnQty / pkt.poQty : 0;
          const invQtyRatio = pkt.poQty > 0 ? pkt.invQty / pkt.poQty : 1;
          const poUnitPrice = Math.max(5, Math.round((Number(pkt.poUnitPrice) || 50) * pFactor));
          const invPriceRatio = pkt.poUnitPrice > 0 ? pkt.invUnitPrice / pkt.poUnitPrice : 1;
          const poTotal = poQty * poUnitPrice;
          const oldPoTotal = (Number(pkt.poQty) || 1) * (Number(pkt.poUnitPrice) || 1);
          const budgetRatio = pkt.budgetRemaining != null && oldPoTotal > 0 ? pkt.budgetRemaining / oldPoTotal : null;
          return {
            ...pkt,
            poQty,
            grnQty: Math.round(poQty * grnRatio),
            invQty: Math.round(poQty * invQtyRatio),
            poUnitPrice,
            invUnitPrice: Number((poUnitPrice * invPriceRatio).toFixed(2)),
            budgetRemaining: budgetRatio != null ? Math.round(poTotal * budgetRatio) : null,
          };
        }),
      },
    };
  }

  if (labId === 'psis_req_to_order' && Array.isArray(basePreset.requisitions)) {
    const scale = 0.88 + rng() * 0.24;
    return {
      variantTag,
      customDataset: {
        ...basePreset,
        name,
        requisitions: basePreset.requisitions.map((r) => ({
          ...r,
          unitPrice: Math.max(10, Math.round((Number(r.unitPrice) || 100) * scale)),
        })),
      },
    };
  }

  if (labId === 'psis_the_tender' && Array.isArray(basePreset.bids)) {
    const priceScale = 0.88 + rng() * 0.26;
    return {
      variantTag,
      customDataset: {
        ...basePreset,
        name,
        bids: basePreset.bids.map((b) => ({
          ...b,
          price: Math.round((Number(b.price) || 100000) * priceScale / 500) * 500,
          reserveFloor: Math.round((Number(b.reserveFloor) || 85000) * priceScale / 500) * 500,
          sustainableCost: Math.round((Number(b.sustainableCost) || 88000) * priceScale / 500) * 500,
        })),
      },
    };
  }

  if (labId === 'psis_inventory_wms') {
    const dFactor = 0.82 + rng() * 0.36;
    const cFactor = 0.85 + rng() * 0.30;
    return {
      variantTag,
      customDataset: {
        ...basePreset,
        name,
        eoqDefaults: basePreset.eoqDefaults
          ? {
              ...basePreset.eoqDefaults,
              annualDemand: Math.round((Number(basePreset.eoqDefaults.annualDemand) || 12000) * dFactor / 100) * 100,
              unitCost: Math.max(2, Math.round((Number(basePreset.eoqDefaults.unitCost) || 40) * cFactor)),
              orderingCost: Math.round((Number(basePreset.eoqDefaults.orderingCost) || 450) * (0.85 + rng() * 0.3) / 10) * 10,
              dailyDemandStd: Math.max(2, Math.round((Number(basePreset.eoqDefaults.dailyDemandStd) || 12) * dFactor)),
            }
          : undefined,
        abcItems: (basePreset.abcItems || []).map((it) => ({
          ...it,
          annualQty: jitter(rng, it.annualQty, 0.8, 1.24, 0),
          unitCost: jitter(rng, it.unitCost, 0.85, 1.2, 0),
        })),
        cycleCountBins: (basePreset.cycleCountBins || []).map((b) => {
          const factor = 0.82 + rng() * 0.35;
          const sys = Math.max(5, Math.round((Number(b.systemQty) || 20) * factor));
          const ratio = b.systemQty > 0 ? b.physicalQty / b.systemQty : 1;
          return {
            ...b,
            systemQty: sys,
            physicalQty: Math.max(0, Math.round(sys * ratio)),
            unitCost: jitter(rng, b.unitCost, 0.85, 1.2, 0),
          };
        }),
      },
    };
  }

  if (labId === 'scm_landed_cost' && Array.isArray(basePreset.routes)) {
    const scale = 0.88 + rng() * 0.24;
    return {
      variantTag,
      customDataset: {
        ...basePreset,
        name,
        routes: basePreset.routes.map((r) => ({
          ...r,
          unitExw: Math.max(5, Math.round((Number(r.unitExw) || 40) * scale * 10) / 10),
          mainFreight: Math.max(200, Math.round((Number(r.mainFreight) || 2000) * (0.85 + rng() * 0.3) / 50) * 50),
          destPort: Math.max(100, Math.round((Number(r.destPort) || 500) * (0.85 + rng() * 0.3) / 25) * 25),
        })),
      },
    };
  }
  if (labId === 'scm_contract_sla' && Array.isArray(basePreset.periods)) {
    const valScale = 0.85 + rng() * 0.3;
    const nextVal = Math.round((Number(basePreset.contractValue) || 600000) * valScale / 10000) * 10000;
    const perInv = Math.round(nextVal / Math.max(1, basePreset.periods.length));
    return {
      variantTag,
      customDataset: {
        ...basePreset,
        name,
        contractValue: nextVal,
        periods: basePreset.periods.map((p) => ({
          ...p,
          invoiceValue: perInv,
          otifPct: Math.max(68, Math.min(99.5, Number(((Number(p.otifPct) || 92) + (rng() - 0.5) * 4).toFixed(1)))),
        })),
      },
    };
  }
  if (labId === 'scm_green_procurement' && Array.isArray(basePreset.suppliers)) {
    return {
      variantTag,
      customDataset: {
        ...basePreset,
        name,
        annualTonnes: Math.round((Number(basePreset.annualTonnes) || 120) * (0.85 + rng() * 0.3) / 5) * 5,
        suppliers: basePreset.suppliers.map((s) => ({
          ...s,
          unitPricePerTonne: Math.round((Number(s.unitPricePerTonne) || 900) * (0.9 + rng() * 0.2) / 5) * 5,
          mfgKgCo2PerTonne: Math.round((Number(s.mfgKgCo2PerTonne) || 400) * (0.88 + rng() * 0.24) / 10) * 10,
        })),
      },
    };
  }
  if (labId === 'psis_spend_analytics' && Array.isArray(basePreset.suppliers)) {
    return {
      variantTag,
      customDataset: {
        ...basePreset,
        name,
        suppliers: basePreset.suppliers.map((s) => ({
          ...s,
          annualSpend: Math.round(jitter(rng, s.annualSpend, 0.82, 1.25, 0) / 1000) * 1000,
          otifPct: Math.max(45, Math.min(99, Math.round((Number(s.otifPct) || 85) + (rng() - 0.5) * 6))),
        })),
      },
    };
  }

  return null;
}

// ============================================================================
// 2. CLASS-WIDE LAB DEBRIEF ANALYTICS (FOR ASSIGNMENT MARKING SCREEN)
// ============================================================================

/**
 * Aggregates quantitative lab evidence across all submitted rows (deduplicating syndicates)
 * to give lecturers instant debrief metrics and common student pitfalls.
 */
export function summarizeClassLabSubmissions(enrichedRows = [], assignMeta = null) {
  const seenUnits = new Set();
  const parsedList = [];

  (enrichedRows || []).forEach((r) => {
    const sub = r.sub || r._synLeaderSub;
    if (!sub) return;
    const unitKey = assignMeta?.syndicate?.enabled && r._syn?.id ? `syn:${r._syn.id}` : `stu:${r.student_id || r.index_no}`;
    if (seenUnits.has(unitKey)) return;
    seenUnits.add(unitKey);

    const parsed = parseLabVerificationSummary(sub.response_text || '', sub.typing_meta || {});
    if (parsed) {
      parsedList.push(parsed);
    }
  });

  if (!parsedList.length) {
    return { labSubmissionCount: 0, avgQuantPct: null, avgJudgementWords: 0, judgementPassPct: 0, pitfalls: [], metricSummary: [] };
  }

  const avgQuantPct = Math.round(
    (parsedList.reduce((s, p) => s + (p.quantRatio || 0), 0) / parsedList.length) * 100,
  );
  const avgJudgementWords = Math.round(
    parsedList.reduce((s, p) => s + (p.judgementWords || 0), 0) / parsedList.length,
  );
  const judgePasses = parsedList.filter((p) => p.judgementPass).length;
  const judgementPassPct = Math.round((judgePasses / parsedList.length) * 100);

  let shortJudgementCount = 0;
  let sodNotFixedCount = 0;
  let transTrapMissedCount = 0;
  let lowHygieneCount = 0;
  let lowAccuracyCount = 0;
  const metricBuckets = new Map();

  parsedList.forEach((p) => {
    if (!p.judgementPass || p.judgementWords < 25) shortJudgementCount += 1;
    p.metrics.forEach((m) => {
      const pctMatch = m.value.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pctMatch) {
        const val = Number(pctMatch[1]);
        const bucket = metricBuckets.get(m.label) || [];
        bucket.push(val);
        metricBuckets.set(m.label, bucket);
        if (/Hygiene/i.test(m.label) && val < 75) lowHygieneCount += 1;
        if (/Accuracy/i.test(m.label) && val < 75) lowAccuracyCount += 1;
      }
      if (/SoD Remaining/i.test(m.label)) {
        const num = Number((m.value.match(/(\d+)/) || [])[1] || 0);
        if (num > 0) sodNotFixedCount += 1;
      }
      if (/Transposition Trap/i.test(m.label) && !/YES|PASS|TESTED/i.test(m.value)) {
        transTrapMissedCount += 1;
      }
    });
  });

  const metricSummary = [...metricBuckets.entries()].map(([label, vals]) => ({
    label,
    avgPct: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length),
    count: vals.length,
  }));

  const pitfalls = [];
  if (lowAccuracyCount > 0) {
    pitfalls.push(`${lowAccuracyCount} of ${parsedList.length} submission(s) scored below 75% on quantitative audit accuracy — review edge-case exceptions in class.`);
  }
  if (sodNotFixedCount > 0) {
    pitfalls.push(`${sodNotFixedCount} submission(s) left unresolved toxic Segregation of Duties conflicts — highlight Vendor-Create + Payment-Release separation.`);
  }
  if (transTrapMissedCount > 0) {
    pitfalls.push(`${transTrapMissedCount} submission(s) did not trigger the Mod-10 Transposition Error Trap.`);
  }
  if (lowHygieneCount > 0) {
    pitfalls.push(`${lowHygieneCount} submission(s) ended with Master Data Hygiene below 75% (excess duplicate SKUs created).`);
  }
  if (shortJudgementCount > 0) {
    pitfalls.push(`${shortJudgementCount} submission(s) had brief managerial judgement paragraphs (< 25 words) — remind students to tie numbers to business recommendations.`);
  }

  return {
    labSubmissionCount: parsedList.length,
    moduleLine: parsedList[0].moduleLine,
    avgQuantPct,
    avgJudgementWords,
    judgementPassPct,
    metricSummary,
    pitfalls,
  };
}

// ============================================================================
// 3. POST-CLASS LIVE CLASSROOM SESSION DEBRIEF REPORT BUILDER
// ============================================================================

export function buildLiveSessionDebriefReport({
  labId,
  labTitle,
  sessionCode,
  courseCode = '',
  participants = [],
  labState = {},
  dupAudit = null,
  eventLog = [],
}) {
  const lines = [
    `LIVE CLASSROOM SIMULATION DEBRIEF SUMMARY`,
    `====================================================================`,
    `Session Code: ${sessionCode || 'LIVE'} | Course: ${courseCode || 'General Class'}`,
    `Module: ${labTitle || labId}`,
    `Date/Time: ${new Date().toLocaleString()}`,
    `Connected Student Participants: ${participants.length}`,
    ``,
  ];

  if (labId === 'psis_seven_names' && dupAudit) {
    lines.push(
      `1. SHARED ITEM MASTER CHAOS METRICS`,
      `- Total SKU Records Created: ${dupAudit.totalRecords}`,
      `- Unique Physical Items: ${dupAudit.uniquePhysicalItems}`,
      `- Duplicate Clusters Detected: ${dupAudit.duplicateClusters?.length || 0}`,
      `- Final Master Data Hygiene Score: ${dupAudit.hygieneScore}%`,
      ``,
    );
    if (dupAudit.duplicateClusters?.length) {
      lines.push(`2. LIVE DUPLICATE CLUSTERS REVEALED IN CLASS`);
      dupAudit.duplicateClusters.forEach((c) => {
        lines.push(
          `  - "${c.primaryName}" split into ${c.count} separate SKUs (Total Fragmented Stock: ${c.totalStock}): ${c.members.map((m) => `${m.code}="${m.name}"`).join(' | ')}`,
        );
      });
      lines.push('');
    }
  } else if (labId === 'psis_the_whip') {
    const hist = labState.history || [];
    lines.push(
      `1. LIVE 4-TIER BULLWHIP SIMULATION SUMMARY`,
      `- Weeks Completed: ${hist.length} | Shared POS Enabled: ${labState.sharedPos ? 'YES' : 'NO'} | Rumour Spike Triggered: ${labState.rumourActive ? 'YES' : 'NO'}`,
      ``,
      `2. WEEKLY AVERAGE ORDER WAVE (POS vs. TIERS)`,
    );
    if (!hist.length) {
      lines.push('  (No completed weeks recorded yet.)');
    } else {
      hist.forEach((h) => {
        lines.push(
          `  - Week ${h.week}: POS=${h.demand} | Retailer=${h.avgByTier.retailer} | Wholesaler=${h.avgByTier.wholesaler} | Distributor=${h.avgByTier.distributor} | Factory=${h.avgByTier.factory}`,
        );
      });
    }
    lines.push('');
  } else if (labId === 'psis_the_match') {
    lines.push(
      `1. LIVE P2P SEGREGATION OF DUTIES & GHOST-VENDOR AUDIT`,
      `- Unauthorized 403 SoD Attempts Blocked: ${labState.deniedCount || 0}`,
      `- Ghost-Vendor Frauds Completed Under Super-User Mode: ${labState.fraudCount || 0}`,
      `- Group 1 Super-User Fraud Demo Triggered: ${labState.grantGroup1SuperUser ? 'ACTIVE' : 'REVOKED / STRICT SOD'}`,
      ``,
    );
    const groups = Object.entries(labState.groupProgress || {});
    if (groups.length) {
      lines.push(`2. GROUP WORKFLOW OUTCOMES`);
      groups.forEach(([gNo, g]) => {
        lines.push(
          `  - Group ${gNo} (Vendor: ${g.vendorName}): ${g.ghostFraudCompleted ? 'GHOST-VENDOR FRAUD EXECUTED BY 1 USER' : 'Controlled multi-role workflow'}`,
        );
      });
      lines.push('');
    }
  }

  lines.push(
    `3. KEY CLASSROOM TAKEAWAYS FOR REVIEW`,
    `- Data hygiene, visibility, and role controls are governance design problems—not just software features.`,
    `- Refer back to the event trail below when writing your individual or syndicate lab judgement.`,
    ``,
    `4. APPEND-ONLY CLASSROOM EVENT TRAIL (LAST ${Math.min(40, eventLog.length)} EVENTS)`,
  );
  const recent = [...(eventLog || [])].reverse().slice(-40);
  if (!recent.length) {
    lines.push('  (No live events logged.)');
  } else {
    recent.forEach((ev) => {
      lines.push(`  [${ev.ts}] [${ev.eventType}] ${ev.actor}: ${ev.detail}`);
    });
  }

  return lines.join('\n');
}
