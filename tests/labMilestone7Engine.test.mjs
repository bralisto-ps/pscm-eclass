import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LAB_DATASET_SCHEMAS,
  parsePastedTableText,
  autoDetectColumnMapping,
  transformMappedRowsToDataset,
  mergeSubmissionPeerRatings,
  suggestPeerAdjustedMarks,
  createInitialReverseAuctionState,
  assignAuctionBidders,
  processLiveAuctionBid,
  advanceLiveAuctionRound,
  computeLiveAuctionMetrics,
  buildCarryForwardPayload,
  extractCarryForwardImport,
  generateLabVivaQuestions,
  normalizeLabDatasetsLibrary,
  normalizeMappedClos,
} from '../src/lib/labMilestone7Engine.js';
import { parseCourseMeta, serializeCourseMeta } from '../src/lib/courseMeta.js';

test('Universal Dataset Mapper covers all 11 labs and parses CSV + Excel TSV paste', () => {
  assert.equal(Object.keys(LAB_DATASET_SCHEMAS).length, 11);

  const tsv = 'Material No\tItem Name\tQty On Hand\tUOM\nMAT-01\tSurgical Gloves Medium\t120\tBox\nMAT-02\tGloves Surgical Med\t45\tBox';
  const rows = parsePastedTableText(tsv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['Material No', 'Item Name', 'Qty On Hand', 'UOM']);

  const map = autoDetectColumnMapping('psis_seven_names', rows[0]);
  assert.equal(map.code, 0);
  assert.equal(map.name, 1);
  assert.equal(map.stock, 2);
  assert.equal(map.unit, 3);

  const res = transformMappedRowsToDataset('psis_seven_names', rows.slice(1), map, { name: 'Hospital SKU Sheet' });
  assert.equal(res.rowCount, 2);
  assert.equal(res.dataset.initialCatalog[0].code, 'MAT-01');
  assert.equal(res.dataset.initialCatalog[0].name, 'Surgical Gloves Medium (Box)');
  assert.equal(res.dataset.initialCatalog[0].stock, 120);
});

test('Universal Dataset Mapper transforms Spend Analytics & P2P spreadsheets with custom headers', () => {
  const csv = 'Vendor,Commodity,Total Spend,OTIF,PPM,Contracted\nApex Med,Consumables,"45,000",96,500,Yes\nQuickBuy,Stationery,12000,74,4200,No';
  const rows = parsePastedTableText(csv);
  const map = autoDetectColumnMapping('psis_spend_analytics', rows[0]);
  const res = transformMappedRowsToDataset('psis_spend_analytics', rows.slice(1), map, { currency: 'GHS' });
  assert.equal(res.rowCount, 2);
  assert.equal(res.dataset.suppliers[0].annualSpend, 45000);
  assert.equal(res.dataset.suppliers[0].onContract, true);
  assert.equal(res.dataset.suppliers[1].onContract, false);
});

test('Syndicate Peer Contribution merges lab ratings and suggests fair peer-weighted marks', () => {
  const merged = mergeSubmissionPeerRatings(
    [{ reviewee_index: 'PSCM/002', score: 2, comment: 'Missed meetings', reviewer_index: 'PSCM/001' }],
    [
      {
        student_index: 'PSCM/003',
        typing_meta: {
          submittedByIndex: 'PSCM/003',
          syndicatePeerRatings: [
            { indexNo: 'PSCM/001', score: 5, note: 'Led analysis' },
            { indexNo: 'PSCM/002', score: 2, note: 'Low participation' },
          ],
        },
      },
    ],
  );
  assert.equal(merged.get('PSCM/001').avgScore, 5);
  assert.equal(merged.get('PSCM/001').flagged, false);
  assert.equal(merged.get('PSCM/002').avgScore, 2);
  assert.equal(merged.get('PSCM/002').flagged, true);

  const adjusted = suggestPeerAdjustedMarks(80, 100, [
    { id: 'PSCM/001', _peer: merged.get('PSCM/001') },
    { id: 'PSCM/002', _peer: merged.get('PSCM/002') },
  ]);
  assert.equal(adjusted['PSCM/001'], 80);
  assert.equal(adjusted['PSCM/002'], 40);
});

test('Live Reverse Auction enforces minimum decrement, idempotency, and Winner’s Curse detection', () => {
  let state = createInitialReverseAuctionState({ reserveCeiling: 100000, costFloor: 80000, minDecrementPct: 2 });
  const bidders = assignAuctionBidders([{ id: 'u1', name: 'Ama' }, { id: 'u2', name: 'Kojo' }]);
  assert.equal(bidders.u1.bidderCode, 'BIDDER-01');

  // Opening bid at ceiling allowed
  const b1 = processLiveAuctionBid(state, { bidId: 'bid-1', bidderId: 'u1', bidderName: 'BIDDER-01', amount: 98000 });
  assert.equal(b1.ok, true);
  state = b1.nextState;

  // Duplicate bidId ignored idempotently
  const dup = processLiveAuctionBid(state, { bidId: 'bid-1', bidderId: 'u1', bidderName: 'BIDDER-01', amount: 98000 });
  assert.equal(dup.ok, false);
  assert.equal(dup.duplicate, true);

  // Too-small decrement rejected (< 2% below 98000 = 96040)
  const small = processLiveAuctionBid(state, { bidId: 'bid-2', bidderId: 'u2', bidderName: 'BIDDER-02', amount: 97500 });
  assert.equal(small.ok, false);

  // Advance round and bid below costFloor triggers Winner's Curse
  state = advanceLiveAuctionRound(state);
  assert.equal(state.round, 2);
  const b3 = processLiveAuctionBid(state, { bidId: 'bid-3', bidderId: 'u2', bidderName: 'BIDDER-02', amount: 76000 });
  assert.equal(b3.ok, true);
  assert.equal(b3.belowFloor, true);
  state = b3.nextState;

  const metrics = computeLiveAuctionMetrics(state);
  assert.equal(metrics.savingsPct, 24);
  assert.equal(metrics.winnersCurseTriggered, true);
});

test('Supply Chain Carry Forward builds downstream payloads from Item Master and P2P', () => {
  const mdPayload = buildCarryForwardPayload('psis_seven_names', {
    catalog: [
      { code: 'SKU-101', name: 'A4 Paper 80gsm', stock: 100 },
      { code: 'SKU-102', name: 'Paper A4 80g Duplicate', stock: 40 },
    ],
  }, { currency: 'GHS' });
  assert.ok(mdPayload);
  const wmsImport = extractCarryForwardImport('psis_inventory_wms', mdPayload);
  assert.ok(wmsImport);
  assert.equal(wmsImport.dataset.abcItems.length, 2);
  assert.equal(wmsImport.dataset.cycleCountBins.length, 2);

  const reqImport = extractCarryForwardImport('psis_req_to_order', mdPayload);
  assert.equal(reqImport.dataset.requisitions.length, 2);
});

test('Variant-Specific Oral Defense / Viva Generator produces tailored questions with cues', () => {
  const viva = generateLabVivaQuestions({
    labId: 'psis_seven_names',
    variantTag: 'VAR-7A2F',
    studentOrGroupLabel: 'Syndicate 3',
    labEvidence: {
      metrics: [
        { label: 'Hygiene Score', value: '62.5%' },
        { label: 'Duplicate Clusters', value: '3' },
      ],
    },
  });
  assert.equal(viva.questions.length, 4);
  assert.ok(viva.header.includes('VAR-7A2F'));
  assert.ok(viva.questions[0].q.includes('62.5%'));
  assert.ok(viva.questions[0].cue.length > 10);
});

test('courseMeta round-trips lab_datasets, uniqueVariant, and mappedClos safely', () => {
  const library = normalizeLabDatasetsLibrary([
    { id: 'ds1', labId: 'psis_seven_names', name: 'Ghana Hospital SKUs', rowCount: 15, dataset: { name: 'Ghana Hospital SKUs', initialCatalog: [] } },
  ]);
  const desc = serializeCourseMeta(
    'PSIS Course',
    { ca1_weight: 20, ca2_weight: 20 },
    { released: false, max_score: 60, scores: {} },
    { venue: 'Lab 2' },
    [{ id: 'psis_seven_names', labId: 'psis_seven_names', title: 'Item Master Data Governance', uniqueVariant: true, mappedClos: normalizeMappedClos(['clo1', 'CLO2', 'clo1']) }],
    library,
  );
  const parsed = parseCourseMeta({ description: desc });
  assert.equal(parsed.labs_config[0].uniqueVariant, true);
  assert.deepEqual(parsed.labs_config[0].mappedClos, ['CLO1', 'CLO2']);
  assert.equal(parsed.lab_datasets.length, 1);
  assert.equal(parsed.lab_datasets[0].name, 'Ghana Hospital SKUs');
});
