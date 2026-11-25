import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  auditSegregationOfDuties,
  computeGtinCheckDigit,
  evaluateThreeWayMatch,
  findMasterDataDuplicates,
  lookupGs1MemberOrg,
  parseAndValidateGtin,
  skuSimilarityScore,
  transposeAdjacentDigits,
} from '../src/lib/psisLabEngine.js';

test('Master Data: detects near-duplicate SKUs and computes fragmented stock', () => {
  const items = [
    { code: 'SKU-101', name: 'A4 Photocopy Paper 80gsm (500 Sheets)', stock: 140 },
    { code: 'SKU-201', name: 'Paper A4 80gsm Ream 500 Sheets', stock: 55 },
    { code: 'SKU-102', name: 'Nitrile Examination Gloves Medium Box 100', stock: 85 },
    { code: 'SKU-202', name: 'Examination Gloves Nitrile Medium (100)', stock: 40 },
    { code: 'SKU-103', name: 'Hand Sanitizer Alcohol Gel 500ml', stock: 60 },
  ];

  assert.ok(skuSimilarityScore(items[0].name, items[1].name) >= 0.52);
  assert.ok(skuSimilarityScore(items[0].name, items[4].name) < 0.35);

  const audit = findMasterDataDuplicates(items, 0.52);
  assert.equal(audit.totalRecords, 5);
  assert.equal(audit.duplicateClusters.length, 2);
  assert.equal(audit.extraDuplicateRecords, 2);
  assert.equal(audit.uniquePhysicalItems, 3);
  assert.equal(audit.hygieneScore, 60);

  const paperCluster = audit.duplicateClusters.find((c) => c.members.some((m) => m.code === 'SKU-101'));
  assert.ok(paperCluster);
  assert.equal(paperCluster.totalStock, 195);
});

test('GTIN Dissector: validates GS1 Ghana (603), Nigeria (615), and all Scan It presets in labsCatalog.js', () => {
  assert.equal(lookupGs1MemberOrg('603'), 'GS1 Ghana');
  assert.equal(lookupGs1MemberOrg('615'), 'GS1 Nigeria');

  const calc = computeGtinCheckDigit('603120400101');
  assert.equal(calc.checkDigit, 6);
  assert.equal(calc.steps.length, 12);

  const parsed = parseAndValidateGtin('6031204001016');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.format, 'GTIN-13 (EAN-13)');
  assert.equal(parsed.gs1Prefix, '603');
  assert.equal(parsed.memberOrg, 'GS1 Ghana');
  assert.equal(parsed.actualCheck, 6);
  assert.equal(parsed.expectedCheck, 6);
  assert.equal(parsed.steps.length, 12);

  const catalogSrc = fs.readFileSync(new URL('../src/lib/labsCatalog.js', import.meta.url), 'utf8');
  const start = catalogSrc.indexOf('export const SCAN_IT_PRESETS');
  const end = catalogSrc.indexOf('export const THE_MATCH_PRESETS');
  const slice = catalogSrc.slice(start, end);
  const matches = [...slice.matchAll(/barcode:\s*'(\d+)'/g)].map((m) => m[1]);
  assert.ok(matches.length >= 5, 'Expected starter preset barcodes in SCAN_IT_PRESETS');
  for (const code of matches) {
    const r = parseAndValidateGtin(code);
    assert.equal(r.valid, true, `Preset barcode ${code} should pass Mod-10 check digit validation`);
  }
});

test('GTIN Transposition Trap: swapping two adjacent non-equal digits fails check digit validation', () => {
  const original = '6031204001016';
  const corrupted = transposeAdjacentDigits(original);
  assert.equal(typeof corrupted, 'string');
  assert.notEqual(corrupted, original);

  const bad = parseAndValidateGtin(corrupted);
  assert.equal(bad.valid, false);
  assert.notEqual(bad.actualCheck, bad.expectedCheck);

  const invalidLen = parseAndValidateGtin('12345');
  assert.equal(invalidLen.valid, false);
  assert.ok(invalidLen.error);
});

test('3-Way Match Engine: releases clean packets and blocks all 6 exception types', () => {
  const clean = evaluateThreeWayMatch({
    poNo: 'PO-1', invoiceNo: 'INV-1', poApproved: true, grnPosted: true, duplicateInvoice: false,
    budgetRemaining: 45000, poQty: 200, poUnitPrice: 120, grnQty: 200, invQty: 200, invUnitPrice: 120,
  }, { priceTolPct: 2, qtyTolPct: 0 });
  assert.equal(clean.decision, 'RELEASE');
  assert.equal(clean.blocks.length, 0);

  const shortDelivery = evaluateThreeWayMatch({
    poNo: 'PO-2', invoiceNo: 'INV-2', poApproved: true, grnPosted: true, duplicateInvoice: false,
    budgetRemaining: 30000, poQty: 500, poUnitPrice: 35, grnQty: 420, invQty: 500, invUnitPrice: 35,
  }, { priceTolPct: 2, qtyTolPct: 0 });
  assert.equal(shortDelivery.decision, 'BLOCK');
  assert.ok(shortDelivery.blocks.some((b) => b.code === 'QTY_OVERBILLED'));

  const priceVar = evaluateThreeWayMatch({
    poNo: 'PO-3', invoiceNo: 'INV-3', poApproved: true, grnPosted: true, duplicateInvoice: false,
    budgetRemaining: 28000, poQty: 60, poUnitPrice: 310, grnQty: 60, invQty: 60, invUnitPrice: 345,
  }, { priceTolPct: 2, qtyTolPct: 0 });
  assert.equal(priceVar.decision, 'BLOCK');
  assert.ok(priceVar.blocks.some((b) => b.code === 'PRICE_VARIANCE'));

  const noGrn = evaluateThreeWayMatch({
    poNo: 'PO-4', invoiceNo: 'INV-4', poApproved: true, grnPosted: false, duplicateInvoice: false,
    budgetRemaining: 40000, poQty: 25, poUnitPrice: 680, grnQty: 0, invQty: 25, invUnitPrice: 680,
  }, { priceTolPct: 2, qtyTolPct: 0 });
  assert.equal(noGrn.decision, 'BLOCK');
  assert.ok(noGrn.blocks.some((b) => b.code === 'NO_GOODS_RECEIPT'));

  const dupInv = evaluateThreeWayMatch({
    poNo: 'PO-5', invoiceNo: 'INV-5', poApproved: true, grnPosted: true, duplicateInvoice: true,
    budgetRemaining: 22000, poQty: 40, poUnitPrice: 280, grnQty: 40, invQty: 40, invUnitPrice: 280,
  }, { priceTolPct: 2, qtyTolPct: 0 });
  assert.equal(dupInv.decision, 'BLOCK');
  assert.ok(dupInv.blocks.some((b) => b.code === 'DUPLICATE_INVOICE'));

  const overBudget = evaluateThreeWayMatch({
    poNo: 'PO-6', invoiceNo: 'INV-6', poApproved: true, grnPosted: true, duplicateInvoice: false,
    budgetRemaining: 12000, poQty: 10, poUnitPrice: 1850, grnQty: 10, invQty: 10, invUnitPrice: 1850,
  }, { priceTolPct: 2, qtyTolPct: 0 });
  assert.equal(overBudget.decision, 'BLOCK');
  assert.ok(overBudget.blocks.some((b) => b.code === 'OVER_BUDGET'));

  const unapproved = evaluateThreeWayMatch({
    poNo: 'PO-7', invoiceNo: 'INV-7', poApproved: false, grnPosted: true, duplicateInvoice: false,
    budgetRemaining: 10000, poQty: 10, poUnitPrice: 100, grnQty: 10, invQty: 10, invUnitPrice: 100,
  });
  assert.equal(unapproved.decision, 'BLOCK');
  assert.ok(unapproved.blocks.some((b) => b.code === 'UNAPPROVED_PO'));
});

test('Segregation of Duties Audit: flags toxic role combinations and confirms clean remediation', () => {
  const initialUsers = [
    { id: 'u1', name: 'Ama Mensah', department: 'Procurement', roles: ['buyer'] },
    { id: 'u2', name: 'Kofi Boateng', department: 'Central Stores', roles: ['storekeeper'] },
    { id: 'u3', name: 'Esi Owusu', department: 'Accounts Payable', roles: ['finance'] },
    { id: 'u4', name: 'Yaw Appiah', department: 'Operations', roles: ['manager'] },
    { id: 'u5', name: 'Daniel Tetteh', department: 'Branch Annex', roles: ['buyer', 'storekeeper'] },
    { id: 'u6', name: 'Super-Admin', department: 'IT', roles: ['buyer', 'storekeeper', 'finance', 'manager'] },
  ];

  const audit = auditSegregationOfDuties(initialUsers);
  assert.equal(audit.totalUsers, 6);
  assert.equal(audit.cleanUsers, 4);
  assert.equal(audit.violatingUsers, 2);
  assert.equal(audit.violations.length, 6);

  const cleanAudit = auditSegregationOfDuties(initialUsers.slice(0, 4));
  assert.equal(cleanAudit.violations.length, 0);
  assert.equal(cleanAudit.violatingUsers, 0);
  assert.equal(cleanAudit.cleanUsers, 4);
});
