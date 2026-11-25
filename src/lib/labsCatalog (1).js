// Central catalog of interactive software laboratories, neutral starter presets,
// CSV/Excel templates, and the direct submission bridge into Course Assignments & CA.

import { rpc } from './supabase.js';
import { uploadFile } from './files.js';
import { buildTypedResponsePdfBlob } from './textPdf.js';
import { findStudentSyndicate, parseAssignmentMeta } from './assignmentMeta.js';
import { parseDelimited } from './sheets.js';

export const LAB_DOMAINS = [
  { id: 'all', label: 'All Labs' },
  { id: 'TQM', label: 'Total Quality Management' },
  { id: 'PSIS', label: 'Purchasing & Supply IS' },
];

export const DATA_POLICIES = [
  {
    id: 'both',
    label: 'Lecturer data + Student own data',
    short: 'Course or own data',
    desc: 'Students load your class dataset by default and can switch to upload or enter their own firm/field data.',
  },
  {
    id: 'lecturer_only',
    label: 'Lecturer dataset only',
    short: 'Course data only',
    desc: 'Students must analyze the exact dataset you assigned to the class (best for standardized grading).',
  },
  {
    id: 'student_only',
    label: 'Student brings own data',
    short: 'Student own data',
    desc: 'Students enter, paste, or upload their own CSV/Excel measurements from a real firm or field exercise.',
  },
];

// ============================================================================
// NEUTRAL STARTER PRESETS (Lecturers can pick any preset or upload custom data)
// ============================================================================

export const SPC_PRESETS = [
  {
    id: 'water_fill_xbar_r',
    name: 'Bottled Water Fill Volume (500 ml) — Xbar-R',
    unit: 'ml',
    chartType: 'xbar_r',
    lsl: 495,
    usl: 505,
    target: 500,
    context: 'Hourly 5-bottle subgroup checks from a mineral water bottling line. Investigate special-cause shift around subgroups 11–14.',
    subgroups: [
      { label: 'S01', values: [500.4, 499.6, 500.2, 499.8, 500.5] },
      { label: 'S02', values: [499.7, 500.3, 500.1, 499.5, 500.2] },
      { label: 'S03', values: [500.6, 499.9, 500.0, 500.4, 499.8] },
      { label: 'S04', values: [499.5, 500.1, 499.8, 500.4, 499.7] },
      { label: 'S05', values: [500.2, 500.5, 499.6, 500.1, 499.9] },
      { label: 'S06', values: [499.8, 500.0, 500.3, 499.4, 500.2] },
      { label: 'S07', values: [500.1, 499.7, 500.4, 500.0, 499.6] },
      { label: 'S08', values: [499.9, 500.2, 499.5, 500.3, 500.1] },
      { label: 'S09', values: [500.3, 499.8, 500.1, 499.7, 500.4] },
      { label: 'S10', values: [500.0, 500.2, 499.9, 500.5, 499.8] },
      { label: 'S11', values: [501.4, 501.8, 500.9, 501.5, 501.2] },
      { label: 'S12', values: [501.9, 502.3, 501.6, 502.1, 501.7] },
      { label: 'S13', values: [502.8, 503.4, 501.9, 503.1, 502.6] },
      { label: 'S14', values: [500.4, 500.1, 499.8, 500.3, 500.0] },
      { label: 'S15', values: [499.9, 500.2, 500.1, 499.7, 500.3] },
    ],
  },
  {
    id: 'cement_bag_xbar_s',
    name: 'Cement Bag Weight (50 kg) — Xbar-S',
    unit: 'kg',
    chartType: 'xbar_s',
    lsl: 49.5,
    usl: 50.5,
    target: 50.0,
    context: 'Six-bag random samples weighed per shift at a bagging plant. Evaluate statistical stability and process capability (Cp / Cpk).',
    subgroups: [
      { label: 'B01', values: [50.02, 49.94, 50.11, 49.89, 50.05, 49.98] },
      { label: 'B02', values: [49.96, 50.08, 50.01, 49.92, 50.04, 49.97] },
      { label: 'B03', values: [50.05, 49.99, 50.14, 49.95, 50.02, 50.07] },
      { label: 'B04', values: [49.91, 50.03, 49.97, 50.09, 49.94, 50.01] },
      { label: 'B05', values: [50.04, 50.12, 49.96, 50.00, 50.06, 49.98] },
      { label: 'B06', values: [49.98, 49.90, 50.05, 49.93, 50.02, 49.95] },
      { label: 'B07', values: [50.07, 50.01, 49.94, 50.08, 50.03, 49.99] },
      { label: 'B08', values: [49.95, 50.04, 50.10, 49.92, 49.99, 50.03] },
      { label: 'B09', values: [50.01, 49.97, 50.06, 50.02, 49.94, 50.00] },
      { label: 'B10', values: [50.16, 50.29, 50.18, 50.34, 50.22, 50.26] },
      { label: 'B11', values: [49.99, 50.05, 49.96, 50.03, 50.01, 49.97] },
      { label: 'B12', values: [50.02, 49.95, 50.08, 49.98, 50.04, 50.00] },
    ],
  },
  {
    id: 'garment_p_chart',
    name: 'Apparel Stitching Rejects — p-Chart',
    unit: 'proportion',
    chartType: 'p_chart',
    context: 'Daily end-of-line quality audits across varying batch sizes at a garment factory. Spot any shift where proportion defective exceeds UCL.',
    pSamples: [
      { label: 'Day 1', n: 150, defects: 6 },
      { label: 'Day 2', n: 160, defects: 7 },
      { label: 'Day 3', n: 140, defects: 5 },
      { label: 'Day 4', n: 150, defects: 8 },
      { label: 'Day 5', n: 180, defects: 7 },
      { label: 'Day 6', n: 150, defects: 6 },
      { label: 'Day 7', n: 145, defects: 5 },
      { label: 'Day 8', n: 150, defects: 18 },
      { label: 'Day 9', n: 165, defects: 7 },
      { label: 'Day 10', n: 155, defects: 6 },
      { label: 'Day 11', n: 150, defects: 5 },
      { label: 'Day 12', n: 170, defects: 8 },
    ],
  },
  {
    id: 'warehouse_c_chart',
    name: 'Order-Packing Errors per Dispatch Lot — c-Chart',
    unit: 'defects/lot',
    chartType: 'c_chart',
    context: 'Count of non-conformities (wrong label, missing invoice, damaged carton) per standardized 100-parcel dispatch batch.',
    cSamples: [
      { label: 'Lot 1', defects: 4 },
      { label: 'Lot 2', defects: 6 },
      { label: 'Lot 3', defects: 5 },
      { label: 'Lot 4', defects: 3 },
      { label: 'Lot 5', defects: 7 },
      { label: 'Lot 6', defects: 5 },
      { label: 'Lot 7', defects: 4 },
      { label: 'Lot 8', defects: 6 },
      { label: 'Lot 9', defects: 14 },
      { label: 'Lot 10', defects: 5 },
      { label: 'Lot 11', defects: 4 },
      { label: 'Lot 12', defects: 6 },
    ],
  },
];

export const TOOLS_PRESETS = [
  {
    id: 'packaging_defects',
    name: 'Consumer Goods Packaging Line Audit',
    context: 'A 3-shift packaging audit covering defect counts, root causes, fill-time variation, line speed vs. defects, and order-release process steps.',
    checkSheet: {
      columns: ['Morning', 'Afternoon', 'Night'],
      rows: [
        { id: 'd1', name: 'Weak Seal / Leak', counts: { Morning: 14, Afternoon: 19, Night: 31 } },
        { id: 'd2', name: 'Misaligned Label', counts: { Morning: 12, Afternoon: 15, Night: 17 } },
        { id: 'd3', name: 'Underweight Pack', counts: { Morning: 6, Afternoon: 8, Night: 12 } },
        { id: 'd4', name: 'Crushed Carton', counts: { Morning: 5, Afternoon: 4, Night: 7 } },
        { id: 'd5', name: 'Smudged Batch Code', counts: { Morning: 3, Afternoon: 4, Night: 5 } },
        { id: 'd6', name: 'Missing Tamper Cap', counts: { Morning: 2, Afternoon: 1, Night: 3 } },
      ],
    },
    fishbone: {
      problem: 'High Rate of Weak Seals on Night Shift',
      template: '6M',
      branches: {
        Man: ['Temp operators lack sealing-jaw checklist', 'Fatigue after 2:00 AM changeover'],
        Machine: ['Sealing jaw thermostat drifts +8°C', 'Worn Teflon strip on Line 2'],
        Method: ['No mid-shift peel-strength test', 'Unstandardized warmup time'],
        Material: ['Film thickness varies across supplier lots', 'Humidity dampens laminated roll'],
        Measurement: ['Manual squeeze test is subjective'],
        Environment: ['Night ambient humidity rises 15%'],
      },
    },
    histogram: {
      label: 'Cycle Time per Pallet (minutes)',
      lsl: 10,
      usl: 18,
      values: [12.1, 13.4, 14.0, 14.2, 13.8, 15.1, 12.9, 14.5, 16.2, 13.7, 14.8, 15.6, 13.2, 14.1, 17.4, 18.6, 12.6, 13.9, 14.4, 15.0, 16.8, 19.1, 13.5, 14.3, 15.2, 14.7, 13.1, 15.9],
    },
    scatter: {
      xLabel: 'Conveyor Speed (packs/min)',
      yLabel: 'Seal Defects per 1,000',
      points: [
        { label: 'Run 1', x: 40, y: 2.1 },
        { label: 'Run 2', x: 45, y: 2.8 },
        { label: 'Run 3', x: 50, y: 3.4 },
        { label: 'Run 4', x: 55, y: 4.5 },
        { label: 'Run 5', x: 60, y: 5.8 },
        { label: 'Run 6', x: 65, y: 7.2 },
        { label: 'Run 7', x: 70, y: 8.9 },
        { label: 'Run 8', x: 75, y: 11.4 },
        { label: 'Run 9', x: 52, y: 3.9 },
        { label: 'Run 10', x: 62, y: 6.4 },
      ],
    },
    stratification: {
      metricLabel: 'Defects per 1,000 Packs',
      records: [
        { stratum: 'Morning Shift', value: 4.2 }, { stratum: 'Morning Shift', value: 3.9 }, { stratum: 'Morning Shift', value: 4.5 }, { stratum: 'Morning Shift', value: 4.1 },
        { stratum: 'Afternoon Shift', value: 5.8 }, { stratum: 'Afternoon Shift', value: 6.1 }, { stratum: 'Afternoon Shift', value: 5.4 }, { stratum: 'Afternoon Shift', value: 5.9 },
        { stratum: 'Night Shift', value: 11.2 }, { stratum: 'Night Shift', value: 12.4 }, { stratum: 'Night Shift', value: 10.8 }, { stratum: 'Night Shift', value: 11.9 },
      ],
    },
    flowchart: [
      { id: 'f1', name: 'Receive Batch Order', type: 'start', minutes: 5, valueAdd: 'bnva', owner: 'Planner' },
      { id: 'f2', name: 'Wait for Film Roll Staging', type: 'delay', minutes: 22, valueAdd: 'nva', owner: 'Stores' },
      { id: 'f3', name: 'Fill & Heat-Seal Units', type: 'process', minutes: 18, valueAdd: 'va', owner: 'Line Op' },
      { id: 'f4', name: 'Peel-Strength Inspection?', type: 'decision', minutes: 8, valueAdd: 'bnva', owner: 'QA Tech' },
      { id: 'f5', name: 'Rework Failed Pouches', type: 'delay', minutes: 16, valueAdd: 'nva', owner: 'Line Op' },
      { id: 'f6', name: 'Pack & Palletize for Dispatch', type: 'end', minutes: 11, valueAdd: 'va', owner: 'Dispatch' },
    ],
  },
  {
    id: 'logistics_service_audit',
    name: 'Regional Delivery & Service Quality Audit',
    context: 'Service-operations quality audit across urban & peri-urban delivery routes, customer wait times, and order fulfillment steps.',
    checkSheet: {
      columns: ['Zone A', 'Zone B', 'Zone C'],
      rows: [
        { id: 's1', name: 'Late Delivery (>2 hrs)', counts: { 'Zone A': 11, 'Zone B': 24, 'Zone C': 19 } },
        { id: 's2', name: 'Short / Missing Item', counts: { 'Zone A': 8, 'Zone B': 14, 'Zone C': 10 } },
        { id: 's3', name: 'Transit Damage', counts: { 'Zone A': 4, 'Zone B': 9, 'Zone C': 12 } },
        { id: 's4', name: 'Wrong Invoice Price', counts: { 'Zone A': 5, 'Zone B': 4, 'Zone C': 3 } },
        { id: 's5', name: 'Missing POD Signature', counts: { 'Zone A': 2, 'Zone B': 3, 'Zone C': 4 } },
      ],
    },
    fishbone: {
      problem: 'Frequent Late Deliveries in Zone B',
      template: '4P',
      branches: {
        People: ['Drivers unfamiliar with alternate routes', 'Single picker at morning peak'],
        Policies: ['Rigid 8:00 AM credit sign-off delays loading'],
        Procedures: ['Manual waybill entry duplicates picking list', 'No route clustering before loading'],
        Plant: ['Only one loading bay available for 6 vans', 'Van #4 recurring alternator fault'],
      },
    },
    histogram: {
      label: 'Order Dispatch Lead Time (minutes)',
      lsl: 20,
      usl: 60,
      values: [28, 34, 39, 42, 44, 37, 48, 52, 61, 68, 33, 41, 45, 38, 49, 55, 74, 31, 40, 46, 51, 58, 63, 36],
    },
    scatter: {
      xLabel: 'Stops per Route',
      yLabel: 'Average Delay (minutes)',
      points: [
        { label: 'R1', x: 6, y: 8 }, { label: 'R2', x: 8, y: 12 }, { label: 'R3', x: 10, y: 19 },
        { label: 'R4', x: 12, y: 27 }, { label: 'R5', x: 14, y: 38 }, { label: 'R6', x: 16, y: 52 },
        { label: 'R7', x: 9, y: 15 }, { label: 'R8', x: 13, y: 31 },
      ],
    },
    stratification: {
      metricLabel: 'On-Time Delivery Delay (mins)',
      records: [
        { stratum: 'Zone A', value: 12 }, { stratum: 'Zone A', value: 15 }, { stratum: 'Zone A', value: 10 },
        { stratum: 'Zone B', value: 44 }, { stratum: 'Zone B', value: 51 }, { stratum: 'Zone B', value: 39 },
        { stratum: 'Zone C', value: 26 }, { stratum: 'Zone C', value: 31 }, { stratum: 'Zone C', value: 28 },
      ],
    },
    flowchart: [
      { id: 'l1', name: 'Customer Order Confirmed', type: 'start', minutes: 4, valueAdd: 'va', owner: 'Sales' },
      { id: 'l2', name: 'Await Credit Approval Queue', type: 'delay', minutes: 35, valueAdd: 'nva', owner: 'Finance' },
      { id: 'l3', name: 'Pick & Pack Items', type: 'process', minutes: 14, valueAdd: 'va', owner: 'Warehouse' },
      { id: 'l4', name: 'Double-Check Waybill?', type: 'decision', minutes: 9, valueAdd: 'bnva', owner: 'Supervisor' },
      { id: 'l5', name: 'Load & Dispatch Van', type: 'end', minutes: 12, valueAdd: 'va', owner: 'Logistics' },
    ],
  },
];

export const COQ_PRESETS = [
  {
    id: 'beverage_bottling',
    name: 'Beverage Bottling Plant (Quarterly COQ)',
    currency: 'GHS',
    revenue: 2_400_000,
    unitsProduced: 480_000,
    context: 'Quarterly quality cost ledger for a medium-scale bottling plant experiencing high bottle breakage, rework, and distributor returns.',
    items: [
      { id: 'c1', name: 'Operator TQM & Hygiene Training', category: 'prevention', amount: 18_500 },
      { id: 'c2', name: 'Preventive Maintenance & Calibration Planning', category: 'prevention', amount: 24_000 },
      { id: 'c3', name: 'Supplier Quality Qualification Audits', category: 'prevention', amount: 14_500 },
      { id: 'c4', name: 'Incoming Bottle & Cap Inspection', category: 'appraisal', amount: 31_000 },
      { id: 'c5', name: 'In-Process Lab Microbiological Testing', category: 'appraisal', amount: 42_000 },
      { id: 'c6', name: 'Finished Goods Sampling & Audit', category: 'appraisal', amount: 22_000 },
      { id: 'c7', name: 'Scrap (Broken Bottles & Ruined Labels)', category: 'internal_failure', amount: 76_000 },
      { id: 'c8', name: 'Rework (Re-labeling & Re-capping Lots)', category: 'internal_failure', amount: 54_000 },
      { id: 'c9', name: 'Unplanned Line Downtime (Quality Stops)', category: 'internal_failure', amount: 48_000 },
      { id: 'c10', name: 'Distributor Returns & Credit Notes', category: 'external_failure', amount: 92_000 },
      { id: 'c11', name: 'Customer Complaint Handling & Replacement Freight', category: 'external_failure', amount: 38_000 },
      { id: 'c12', name: 'Retailer Shelf-Penalty & Recall Costs', category: 'external_failure', amount: 45_000 },
    ],
    periods: [
      { label: 'Q1 (Baseline)', prevention: 38000, appraisal: 92000, internal_failure: 210000, external_failure: 195000, revenue: 2300000 },
      { label: 'Q2 (Current)', prevention: 57000, appraisal: 95000, internal_failure: 178000, external_failure: 175000, revenue: 2400000 },
      { label: 'Q3 (Target)', prevention: 82000, appraisal: 78000, internal_failure: 96000, external_failure: 72000, revenue: 2550000 },
      { label: 'Q4 (Mature)', prevention: 92000, appraisal: 62000, internal_failure: 48000, external_failure: 31000, revenue: 2700000 },
    ],
  },
  {
    id: 'commercial_printing',
    name: 'Commercial Printing & Packaging Press',
    currency: 'GHS',
    revenue: 1_500_000,
    unitsProduced: 120_000,
    context: 'Quarterly cost of quality ledger for a print house dealing with colour misregistration, paper scrap, and rush reprints for corporate clients.',
    items: [
      { id: 'p1', name: 'Pre-Press Digital Proofing Software & SOPs', category: 'prevention', amount: 15_000 },
      { id: 'p2', name: 'Press Crew Colour-Management Training', category: 'prevention', amount: 12_000 },
      { id: 'p3', name: 'Incoming Paper & Ink Spec Testing', category: 'appraisal', amount: 19_000 },
      { id: 'p4', name: 'First-Article Sheet Inspection', category: 'appraisal', amount: 26_000 },
      { id: 'p5', name: 'Misregistered Paper & Ink Scrap', category: 'internal_failure', amount: 68_000 },
      { id: 'p6', name: 'Internal Plate Remakes & Press Washups', category: 'internal_failure', amount: 41_000 },
      { id: 'p7', name: 'Client Rejected Jobs & Free Reprints', category: 'external_failure', amount: 84_000 },
      { id: 'p8', name: 'Late-Delivery Discount Penalties', category: 'external_failure', amount: 29_000 },
    ],
    periods: [
      { label: 'Q1', prevention: 19000, appraisal: 42000, internal_failure: 126000, external_failure: 130000, revenue: 1420000 },
      { label: 'Q2', prevention: 27000, appraisal: 45000, internal_failure: 109000, external_failure: 113000, revenue: 1500000 },
      { label: 'Q3 (Plan)', prevention: 48000, appraisal: 36000, internal_failure: 58000, external_failure: 44000, revenue: 1620000 },
    ],
  },
  {
    id: 'private_clinic',
    name: 'Private Diagnostic & Outpatient Clinic',
    currency: 'GHS',
    revenue: 980_000,
    unitsProduced: 14_500,
    context: 'Service-sector COQ model tracking diagnostic re-tests, billing rework, patient wait-time compensation, and preventive clinical protocols.',
    items: [
      { id: 'h1', name: 'Clinical SOP Audits & Staff Safety Training', category: 'prevention', amount: 14_000 },
      { id: 'h2', name: 'Lab Equipment Calibration & Software Validation', category: 'prevention', amount: 16_500 },
      { id: 'h3', name: 'Daily Lab Control Reagent Checks', category: 'appraisal', amount: 21_000 },
      { id: 'h4', name: 'Insurance Claims Pre-Submission Verification', category: 'appraisal', amount: 12_500 },
      { id: 'h5', name: 'Sample Contamination & Internal Lab Re-Tests', category: 'internal_failure', amount: 34_000 },
      { id: 'h6', name: 'Rejected NHIS/Private Claims Rework', category: 'internal_failure', amount: 28_000 },
      { id: 'h7', name: 'Patient Refunds & Repeat Consultations (No Charge)', category: 'external_failure', amount: 39_000 },
      { id: 'h8', name: 'Malpractice Insurance Surcharge & Escalations', category: 'external_failure', amount: 22_000 },
    ],
    periods: [
      { label: 'Q1', prevention: 22000, appraisal: 31000, internal_failure: 74000, external_failure: 72000, revenue: 940000 },
      { label: 'Q2', prevention: 30500, appraisal: 33500, internal_failure: 62000, external_failure: 61000, revenue: 980000 },
      { label: 'Q3 (Plan)', prevention: 44000, appraisal: 28000, internal_failure: 32000, external_failure: 24000, revenue: 1050000 },
    ],
  },
];

// ============================================================================
// CENTRAL LAB CATALOG
// ============================================================================

export const SEVEN_NAMES_PRESETS = [
  {
    id: 'medical_office_stores',
    name: 'Regional Hospital & Admin Stores Receiving Dock',
    context: 'Incoming supplier dockets arrive with inconsistent wording. Match each docket to an existing ERP Item Master SKU, or quick-create a new code under dock time pressure.',
    masterItems: [
      { code: 'SKU-101', name: 'A4 Photocopy Paper 80gsm (500 Sheets)', stock: 140, canonicalId: 'c_paper' },
      { code: 'SKU-102', name: 'Nitrile Examination Gloves Medium (Box of 100)', stock: 85, canonicalId: 'c_gloves' },
      { code: 'SKU-103', name: 'Hand Sanitizer Alcohol Gel 500ml', stock: 60, canonicalId: 'c_sanitizer' },
      { code: 'SKU-104', name: 'HP 85A Black LaserJet Toner Cartridge', stock: 18, canonicalId: 'c_toner' },
      { code: 'SKU-105', name: 'Paracetamol 500mg Tablets (Box of 1000)', stock: 42, canonicalId: 'c_para' },
    ],
    dockets: [
      { id: 'dk1', supplier: 'Apex Stationery Depot', docketText: 'Paper A4 80g Ream (500sh)', qty: 50, trueCode: 'SKU-101', canonicalId: 'c_paper' },
      { id: 'dk2', supplier: 'MediCore Supplies', docketText: 'Exam Gloves Nitrile Size Med 100s', qty: 40, trueCode: 'SKU-102', canonicalId: 'c_gloves' },
      { id: 'dk3', supplier: 'CleanCare Hygiene', docketText: 'Alcohol Hand Sanitiser Gel 500 mls', qty: 35, trueCode: 'SKU-103', canonicalId: 'c_sanitizer' },
      { id: 'dk4', supplier: 'PrintMax Solutions', docketText: 'LaserJet Cartridge Black 85A HP', qty: 12, trueCode: 'SKU-104', canonicalId: 'c_toner' },
      { id: 'dk5', supplier: 'GoldCoast Pharma', docketText: 'Paracetamol Tabs 500 mg (1000 pack)', qty: 25, trueCode: 'SKU-105', canonicalId: 'c_para' },
      { id: 'dk6', supplier: 'Metro Office Mart', docketText: 'Copier Paper A4 80gsm 500 Sheets', qty: 60, trueCode: 'SKU-101', canonicalId: 'c_paper' },
      { id: 'dk7', supplier: 'WestMed Distributors', docketText: 'Gloves Nitrile Examination Medium Box 100', qty: 30, trueCode: 'SKU-102', canonicalId: 'c_gloves' },
      { id: 'dk8', supplier: 'SafeHands Ghana', docketText: 'Gel Hand Sanitizer 500ml Alcohol', qty: 20, trueCode: 'SKU-103', canonicalId: 'c_sanitizer' },
    ],
  },
  {
    id: 'fmcg_warehouse',
    name: 'FMCG Distribution Hub Receiving Bay',
    context: 'Fast-moving consumer goods arrive from wholesalers using trade abbreviations. Keep the Item Master clean without stalling the receiving bay.',
    masterItems: [
      { code: 'FM-01', name: 'Natural Mineral Water 500ml (Pack of 16)', stock: 320, canonicalId: 'f_water' },
      { code: 'FM-02', name: 'Evaporated Milk Unsweetened 160g Tin', stock: 210, canonicalId: 'f_milk' },
      { code: 'FM-03', name: 'Long Grain Perfumed Rice 5kg Bag', stock: 150, canonicalId: 'f_rice' },
      { code: 'FM-04', name: 'Vegetable Cooking Oil 2L Bottle', stock: 95, canonicalId: 'f_oil' },
    ],
    dockets: [
      { id: 'fdk1', supplier: 'Volta Bottlers', docketText: 'Mineral Water 500 ml 16pk', qty: 100, trueCode: 'FM-01', canonicalId: 'f_water' },
      { id: 'fdk2', supplier: 'DairyLink Trade', docketText: 'Unsweetened Evap Milk Tin 160gm', qty: 80, trueCode: 'FM-02', canonicalId: 'f_milk' },
      { id: 'fdk3', supplier: 'Tema Grain Imports', docketText: 'Perfumed Rice Long Grain 5kg', qty: 60, trueCode: 'FM-03', canonicalId: 'f_rice' },
      { id: 'fdk4', supplier: 'Golden Oil Co', docketText: 'Cooking Oil Vegetable 2 Litres', qty: 45, trueCode: 'FM-04', canonicalId: 'f_oil' },
      { id: 'fdk5', supplier: 'Accra Beverage Hub', docketText: 'Water Natural Mineral 500ml (16)', qty: 90, trueCode: 'FM-01', canonicalId: 'f_water' },
    ],
  },
];

export const SCAN_IT_PRESETS = [
  {
    id: 'west_africa_retail',
    name: 'West African Retail & Pharmacy Basket (GS1 Prefix Audit)',
    context: 'Scan real products in the room with your camera or dissect this starter basket of valid GTIN-13 barcodes to compare where products are licensed (e.g., 603 = GS1 Ghana, 615 = GS1 Nigeria) and prove how Mod-10 check digits catch human keying errors.',
    samples: [
      { barcode: '6031204001016', product: 'Natural Mineral Water 500ml', category: 'Beverage' },
      { barcode: '6038810002451', product: 'Artisan Cocoa Chocolate Bar 100g', category: 'Confectionery' },
      { barcode: '6151100045218', product: 'Instant Noodles Family Pack', category: 'Dry Goods' },
      { barcode: '6001087341202', product: 'Antiseptic Disinfectant 500ml', category: 'Personal Care' },
      { barcode: '5010029000016', product: 'Wholegrain Breakfast Cereal 430g', category: 'Grocery' },
      { barcode: '6901234567892', product: 'LED Rechargeable Torchlight', category: 'Hardware' },
      { barcode: '8901058851236', product: 'Paracetamol 500mg Blister Pack', category: 'Pharmacy' },
      { barcode: '036000291452', product: 'Facial Tissue Box (UPC-A / GTIN-12)', category: 'Household' },
    ],
  },
];

export const THE_MATCH_PRESETS = [
  {
    id: 'hospital_p2p',
    name: 'Regional Health Facility Procure-to-Pay Audit',
    currency: 'GHS',
    priceTolPct: 2,
    qtyTolPct: 0,
    context: 'Review 6 supplier invoice packets against Purchase Orders, Cost-Centre Budgets, and Storekeeper Goods Receipts. Decide whether each payment should RELEASE or BLOCK.',
    packets: [
      {
        id: 'p2p_1',
        poNo: 'PO-2026-041',
        grnNo: 'GRN-0812',
        invoiceNo: 'INV-9011',
        supplier: 'MediCore Supplies Ltd',
        item: 'Surgical Gloves Box (100s)',
        costCentre: 'Clinical Stores',
        budgetRemaining: 45000,
        poApproved: true,
        grnPosted: true,
        duplicateInvoice: false,
        poQty: 200,
        poUnitPrice: 120,
        grnQty: 200,
        invQty: 200,
        invUnitPrice: 120,
      },
      {
        id: 'p2p_2',
        poNo: 'PO-2026-042',
        grnNo: 'GRN-0813',
        invoiceNo: 'INV-9012',
        supplier: 'Accra Pharma Traders',
        item: 'IV Drip Giving Sets',
        costCentre: 'Emergency Ward',
        budgetRemaining: 30000,
        poApproved: true,
        grnPosted: true,
        duplicateInvoice: false,
        poQty: 500,
        poUnitPrice: 35,
        grnQty: 420,
        invQty: 500,
        invUnitPrice: 35,
      },
      {
        id: 'p2p_3',
        poNo: 'PO-2026-043',
        grnNo: 'GRN-0814',
        invoiceNo: 'INV-9013',
        supplier: 'Apex Paper & Print',
        item: 'A4 Paper Boxes (5 Reams)',
        costCentre: 'Administration',
        budgetRemaining: 28000,
        poApproved: true,
        grnPosted: true,
        duplicateInvoice: false,
        poQty: 60,
        poUnitPrice: 310,
        grnQty: 60,
        invQty: 60,
        invUnitPrice: 345,
      },
      {
        id: 'p2p_4',
        poNo: 'PO-2026-044',
        grnNo: '(Pending)',
        invoiceNo: 'INV-9014',
        supplier: 'FastLine Cold Chain',
        item: 'Vaccine Carrier Cooler Boxes',
        costCentre: 'Immunization',
        budgetRemaining: 40000,
        poApproved: true,
        grnPosted: false,
        duplicateInvoice: false,
        poQty: 25,
        poUnitPrice: 680,
        grnQty: 0,
        invQty: 25,
        invUnitPrice: 680,
      },
      {
        id: 'p2p_5',
        poNo: 'PO-2026-045',
        grnNo: 'GRN-0815',
        invoiceNo: 'INV-8840',
        supplier: 'CleanCare Janitorial',
        item: 'Hospital Disinfectant 20L',
        costCentre: 'Facilities',
        budgetRemaining: 22000,
        poApproved: true,
        grnPosted: true,
        duplicateInvoice: true,
        poQty: 40,
        poUnitPrice: 280,
        grnQty: 40,
        invQty: 40,
        invUnitPrice: 280,
      },
      {
        id: 'p2p_6',
        poNo: 'PO-2026-046',
        grnNo: 'GRN-0816',
        invoiceNo: 'INV-9016',
        supplier: 'PowerGrid Backup Systems',
        item: 'UPS Battery Bank 12V',
        costCentre: 'IT Infrastructure',
        budgetRemaining: 12000,
        poApproved: true,
        grnPosted: true,
        duplicateInvoice: false,
        poQty: 10,
        poUnitPrice: 1850,
        grnQty: 10,
        invQty: 10,
        invUnitPrice: 1850,
      },
    ],
    users: [
      { id: 'u1', name: 'Ama Mensah', department: 'Procurement', roles: ['buyer'] },
      { id: 'u2', name: 'Kofi Boateng', department: 'Central Stores', roles: ['storekeeper'] },
      { id: 'u3', name: 'Esi Owusu', department: 'Accounts Payable', roles: ['finance'] },
      { id: 'u4', name: 'Yaw Appiah', department: 'Operations', roles: ['manager'] },
      { id: 'u5', name: 'Daniel Tetteh (Relief Clerk)', department: 'Branch Annex', roles: ['buyer', 'storekeeper'] },
      { id: 'u6', name: 'Super-Admin Test Account', department: 'IT / Uncontrolled', roles: ['buyer', 'storekeeper', 'finance', 'manager'] },
    ],
  },
];

export const THE_WHIP_PRESETS = [
  {
    id: 'rumour_spike_40',
    name: 'Classic +40% Rumour Spike (20 Weeks)',
    context: 'Weeks 1–8 run steady at 40 units/week. In Week 9 a supply rumour triggers a +40% consumer demand spike (56 units/week) for 3 weeks before returning to 40 units/week.',
    leadTimeWeeks: 2,
    holdingCost: 1,
    backlogCost: 4,
    initialStock: 60,
    demandSeries: [40, 40, 40, 40, 40, 40, 40, 40, 56, 56, 56, 40, 40, 40, 40, 40, 40, 40, 40, 40],
  },
  {
    id: 'festive_promotion',
    name: 'Holiday Promotion Surge & Post-Promo Slump (20 Weeks)',
    context: 'Consumer demand holds at 50/wk, surges to 80/wk during a 3-week festive promotion, then dips to 35/wk as households work through pantry stock.',
    leadTimeWeeks: 2,
    holdingCost: 1.5,
    backlogCost: 5,
    initialStock: 75,
    demandSeries: [50, 50, 50, 50, 50, 52, 75, 85, 80, 35, 35, 42, 48, 50, 50, 50, 50, 50, 50, 50],
  },
  {
    id: 'step_shift_permanent',
    name: 'Permanent Demand Step-Up (30 to 50 Units/Week)',
    context: 'Baseline demand shifts permanently from 30 to 50 units/week in Week 6 following a new regional hospital contract.',
    leadTimeWeeks: 2,
    holdingCost: 1,
    backlogCost: 4,
    initialStock: 50,
    demandSeries: [30, 30, 30, 30, 30, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
  },
];

export const REQ_TO_ORDER_PRESETS = [
  {
    id: 'university_procurement',
    name: 'Public Institution Catalogue & Commitment Audit',
    currency: 'GHS',
    context: 'Process a batch of department requisitions under Delegation-of-Authority thresholds, toggle Commitment vs Spent-Only budget checks to observe double-commitment risk, and evaluate Blanket Order ROI.',
    budgets: {
      'Clinical & Lab': { budget: 32000, spent: 4000 },
      'IT & Campus Ops': { budget: 24000, spent: 2000 },
      'Facilities': { budget: 40000, spent: 5000 },
    },
    catalogue: [
      { sku: 'CAT-01', item: 'A4 Copier Paper (Box of 5 Reams)', supplier: 'Apex Stationery Depot', unitPrice: 320, defaultCostCentre: 'IT & Campus Ops' },
      { sku: 'CAT-02', item: 'Laboratory Reagent Kit (Pack)', supplier: 'BioLab Supplies Ltd', unitPrice: 1450, defaultCostCentre: 'Clinical & Lab' },
      { sku: 'CAT-03', item: 'Enterprise Network Switch 24-Port', supplier: 'NetCore Ghana', unitPrice: 4800, defaultCostCentre: 'IT & Campus Ops' },
      { sku: 'CAT-04', item: 'Industrial Floor Disinfectant 20L', supplier: 'CleanCare Janitorial', unitPrice: 290, defaultCostCentre: 'Facilities' },
      { sku: 'CAT-05', item: 'LED Security Floodlight Assembly', supplier: 'VoltEdge Electricals', unitPrice: 850, defaultCostCentre: 'Facilities' },
    ],
    requisitions: [
      { id: 'r1', reqNo: 'REQ-001', item: 'Laboratory Reagent Kit (Pack)', supplier: 'BioLab Supplies Ltd', costCentre: 'Clinical & Lab', qty: 12, unitPrice: 1450, paid: false },
      { id: 'r2', reqNo: 'REQ-002', item: 'Laboratory Reagent Kit (Pack)', supplier: 'BioLab Supplies Ltd', costCentre: 'Clinical & Lab', qty: 10, unitPrice: 1450, paid: false },
      { id: 'r3', reqNo: 'REQ-003', item: 'A4 Copier Paper (Box of 5 Reams)', supplier: 'Apex Stationery Depot', costCentre: 'IT & Campus Ops', qty: 15, unitPrice: 320, paid: false },
      { id: 'r4', reqNo: 'REQ-004', item: 'A4 Copier Paper (Box of 5 Reams)', supplier: 'Apex Stationery Depot', costCentre: 'IT & Campus Ops', qty: 14, unitPrice: 320, paid: false },
      { id: 'r5', reqNo: 'REQ-005', item: 'Enterprise Network Switch 24-Port', supplier: 'NetCore Ghana', costCentre: 'IT & Campus Ops', qty: 4, unitPrice: 4800, paid: false },
      { id: 'r6', reqNo: 'REQ-006', item: 'LED Security Floodlight Assembly', supplier: 'VoltEdge Electricals', costCentre: 'Facilities', qty: 32, unitPrice: 850, paid: false },
    ],
    blanketDefaults: {
      orderCount: 11,
      standardPoCost: 650,
      standardCycleHours: 36,
      blanketSetupCost: 1800,
      callOffCost: 95,
      callOffCycleHours: 3,
    },
  },
];

export const THE_TENDER_PRESETS = [
  {
    id: 'medical_cold_chain_rfp',
    name: 'Solar-Powered Vaccine Cold-Chain Fridges (20 Units)',
    currency: 'GHS',
    budgetCeiling: 480000,
    context: 'Evaluate 5 sealed supplier bids against published multi-criteria weights (Price, Technical Spec, Delivery Speed, Local Support), then run a live Reverse Auction to compare price compression against below-cost quality risk.',
    weights: { price: 45, technical: 30, delivery: 15, localContent: 10 },
    bids: [
      { id: 'b1', supplier: 'SolarMed Engineering Ltd', price: 438000, technicalScore: 91, leadTimeDays: 21, localContentScore: 86, reserveFloor: 392000, sustainableCost: 405000, aggressiveness: 0.55 },
      { id: 'b2', supplier: 'LowCost Global Imports', price: 396000, technicalScore: 68, leadTimeDays: 42, localContentScore: 35, reserveFloor: 352000, sustainableCost: 378000, aggressiveness: 0.90 },
      { id: 'b3', supplier: 'WestAfrica ColdTech', price: 422000, technicalScore: 84, leadTimeDays: 28, localContentScore: 90, reserveFloor: 380000, sustainableCost: 394000, aggressiveness: 0.70 },
      { id: 'b4', supplier: 'Nordic Freeze Systems', price: 465000, technicalScore: 95, leadTimeDays: 35, localContentScore: 48, reserveFloor: 428000, sustainableCost: 438000, aggressiveness: 0.35 },
      { id: 'b5', supplier: 'Accra Biomedical Traders', price: 414000, technicalScore: 76, leadTimeDays: 24, localContentScore: 78, reserveFloor: 368000, sustainableCost: 386000, aggressiveness: 0.80 },
    ],
  },
  {
    id: 'fleet_tyres_framework',
    name: 'Distribution Fleet Heavy-Duty Tyres (Annual Lot)',
    currency: 'GHS',
    budgetCeiling: 260000,
    context: 'Standardized commodity specification where multiple certified distributors compete closely on price and delivery lead time.',
    weights: { price: 60, technical: 20, delivery: 15, localContent: 5 },
    bids: [
      { id: 't1', supplier: 'Tema Tyre Centre', price: 238000, technicalScore: 84, leadTimeDays: 7, localContentScore: 80, reserveFloor: 204000, sustainableCost: 214000, aggressiveness: 0.75 },
      { id: 't2', supplier: 'RoadGrip West Africa', price: 229000, technicalScore: 80, leadTimeDays: 10, localContentScore: 72, reserveFloor: 196000, sustainableCost: 208000, aggressiveness: 0.85 },
      { id: 't3', supplier: 'Continental Fleet Hub', price: 248000, technicalScore: 92, leadTimeDays: 12, localContentScore: 60, reserveFloor: 218000, sustainableCost: 226000, aggressiveness: 0.45 },
      { id: 't4', supplier: 'Budget Rubber Direct', price: 219000, technicalScore: 66, leadTimeDays: 18, localContentScore: 55, reserveFloor: 186000, sustainableCost: 202000, aggressiveness: 0.92 },
    ],
  },
];

export const LAB_CATALOG = [
  {
    id: 'tqm_spc',
    domain: 'TQM',
    code: 'TQM-LAB 01',
    title: 'Statistical Process Control (SPC) & Capability',
    shortTitle: 'SPC & Capability',
    summary: 'Construct Xbar-R, Xbar-S, p-charts, and c-charts; detect Western Electric out-of-control signals; and compute Cp, Cpk, Pp, Ppk & estimated PPM.',
    duration: '45–60 min',
    supportsOwnData: true,
    presets: SPC_PRESETS,
    defaultPresetId: SPC_PRESETS[0].id,
    defaultPrompt: 'State whether the process is in statistical control (citing specific subgroups and Western Electric rules), evaluate Cp/Cpk against specification limits, and recommend concrete root-cause and corrective actions.',
    rubricCriteria: [
      { id: 'c1', title: 'Control Chart Selection & Limit Accuracy', maxMarks: 25 },
      { id: 'c2', title: 'Special-Cause Signal Detection (Rules 1–3)', maxMarks: 25 },
      { id: 'c3', title: 'Process Capability (Cp / Cpk) Interpretation', maxMarks: 25 },
      { id: 'c4', title: 'Corrective Action & Managerial Judgement', maxMarks: 25 },
    ],
  },
  {
    id: 'tqm_tools',
    domain: 'TQM',
    code: 'TQM-LAB 02',
    title: 'Seven Basic Tools of Quality (7 QC Tools)',
    shortTitle: '7 Tools of Quality',
    summary: 'Hands-on quality workbench: Check Sheet → 1-click Pareto 80/20, interactive Ishikawa Fishbone diagram, Histogram, Scatter/OLS correlation, Stratification, and Process Flowchart.',
    duration: '60 min',
    supportsOwnData: true,
    presets: TOOLS_PRESETS,
    defaultPresetId: TOOLS_PRESETS[0].id,
    defaultPrompt: 'Synthesize findings across your Quality Tools: identify the Vital Few defects (Pareto 80/20), trace verified root causes (Fishbone & Stratification), interpret distribution/correlation evidence, and propose a prioritized quality improvement plan.',
    rubricCriteria: [
      { id: 'c1', title: 'Check Sheet & Pareto 80/20 Prioritization', maxMarks: 25 },
      { id: 'c2', title: 'Fishbone Root-Cause Depth & Structure', maxMarks: 25 },
      { id: 'c3', title: 'Quantitative Tools (Histogram, Scatter, Stratification, Flow)', maxMarks: 25 },
      { id: 'c4', title: 'Integrated Action Plan & Justification', maxMarks: 25 },
    ],
  },
  {
    id: 'tqm_coq',
    domain: 'TQM',
    code: 'TQM-LAB 03',
    title: 'Cost of Quality (COQ / PAF & Economics) Models',
    shortTitle: 'Cost of Quality Models',
    summary: 'Classify Prevention, Appraisal, Internal & External Failure costs; model the Hidden COQ Iceberg; compare Classical vs. Modern Optimal Quality curves; and calculate What-If TQM investment ROI.',
    duration: '45–60 min',
    supportsOwnData: true,
    presets: COQ_PRESETS,
    defaultPresetId: COQ_PRESETS[0].id,
    defaultPrompt: 'Diagnose the firm’s PAF balance and COQ % of revenue, evaluate hidden COPQ exposure, compare Classical vs. Modern TQM optimal quality economics, and defend your recommended prevention investment using ROI and payback.',
    rubricCriteria: [
      { id: 'c1', title: 'PAF Cost Classification & Ledger Accuracy', maxMarks: 25 },
      { id: 'c2', title: 'Hidden COQ Iceberg & Non-Conformance Diagnosis', maxMarks: 25 },
      { id: 'c3', title: 'Optimal Quality Curve & What-If ROI Analysis', maxMarks: 25 },
      { id: 'c4', title: 'Executive Recommendation to Management', maxMarks: 25 },
    ],
  },
  {
    id: 'psis_seven_names',
    domain: 'PSIS',
    code: 'PSIS-LAB 02',
    title: 'Master Data & Duplicate SKUs (Seven Names)',
    shortTitle: 'Seven Names (Master Data)',
    summary: 'Simulate a busy receiving dock under queue pressure: match incoming dockets to existing SKUs or quick-create new codes, then run fuzzy duplicate clustering to reveal stock fragmentation.',
    duration: '45 min',
    supportsOwnData: true,
    presets: SEVEN_NAMES_PRESETS,
    defaultPresetId: SEVEN_NAMES_PRESETS[0].id,
    defaultPrompt: 'Analyze how duplicate SKU creation fragments inventory visibility and procurement spend, cite the duplicate clusters and hygiene score from your audit, and propose an item master governance rule for receiving clerks.',
    rubricCriteria: [
      { id: 'c1', title: 'Receiving Dock Matching Discipline', maxMarks: 25 },
      { id: 'c2', title: 'Duplicate Cluster & Stock Fragmentation Diagnosis', maxMarks: 25 },
      { id: 'c3', title: 'Impact on Reorder Points & Spend Analytics', maxMarks: 25 },
      { id: 'c4', title: 'Master Data Governance Controls Recommendation', maxMarks: 25 },
    ],
  },
  {
    id: 'psis_scan_it',
    domain: 'PSIS',
    code: 'PSIS-LAB 03',
    title: 'Barcode & GTIN Capture (Scan It)',
    shortTitle: 'Scan It (GTIN & AIDC)',
    summary: 'Scan real product barcodes with your phone or webcam (or enter GTIN-8/12/13/14 digits), inspect GS1 Member Organization licensing (e.g., 603 = GS1 Ghana), verify Mod-10 check-digit math, and trigger the transposition error trap.',
    duration: '30–45 min',
    supportsOwnData: true,
    presets: SCAN_IT_PRESETS,
    defaultPresetId: SCAN_IT_PRESETS[0].id,
    defaultPrompt: 'Summarize the GS1 licensing geography of your collected products (distinguishing country of licensing vs. country of manufacture), explain how the Mod-10 check digit caught your transposition error, and argue why barcode capture outperforms manual keying.',
    rubricCriteria: [
      { id: 'c1', title: 'GTIN Structure & GS1 Prefix Identification', maxMarks: 25 },
      { id: 'c2', title: 'Mod-10 Check Digit & Transposition Trap Proof', maxMarks: 25 },
      { id: 'c3', title: 'Field Product Collection & Licensing Analysis', maxMarks: 25 },
      { id: 'c4', title: 'AIDC Implementation Judgement for Supply Chains', maxMarks: 25 },
    ],
  },
  {
    id: 'psis_the_match',
    domain: 'PSIS',
    code: 'PSIS-LAB 04',
    title: 'Procure-to-Pay 3-Way Match & Segregation of Duties (The Match)',
    shortTitle: 'The Match (P2P & SoD)',
    summary: 'Audit supplier invoices against Purchase Orders, Cost-Centre Budgets, and Goods Receipts; simulate a Ghost-Vendor fraud when one account holds all four roles; and remediate toxic SoD conflicts.',
    duration: '60–90 min',
    supportsOwnData: true,
    presets: THE_MATCH_PRESETS,
    defaultPresetId: THE_MATCH_PRESETS[0].id,
    defaultPrompt: 'Justify every invoice you blocked or released with exact variance reasons, explain why a properly working 3-way match released payment in the Super-User fraud simulation, and specify the minimum Segregation of Duties matrix required to prevent ghost-vendor fraud.',
    rubricCriteria: [
      { id: 'c1', title: '3-Way Match Audit Accuracy & Variance Identification', maxMarks: 25 },
      { id: 'c2', title: 'Ghost-Vendor Fraud Mechanism Explanation', maxMarks: 25 },
      { id: 'c3', title: 'RBAC & Toxic Role Matrix Remediation', maxMarks: 25 },
      { id: 'c4', title: 'Internal Control & Governance Judgement', maxMarks: 25 },
    ],
  },
  {
    id: 'psis_the_whip',
    domain: 'PSIS',
    code: 'PSIS-LAB 01',
    title: 'The Bullwhip Effect Simulator (The Whip)',
    shortTitle: 'The Whip (Bullwhip)',
    summary: 'Operate a 4-tier supply chain under genuine information asymmetry, inject a +40% demand rumour spike or Paper-Mode latency delay, then replay with shared POS visibility to quantify bullwhip compression.',
    duration: '60 min',
    supportsOwnData: true,
    presets: THE_WHIP_PRESETS,
    defaultPresetId: THE_WHIP_PRESETS[0].id,
    defaultPrompt: 'Quantify the order variance amplification (Bullwhip Ratio, Peak Order, CV, and Total Chain Cost) across tiers in Blind Mode vs. Shared POS Mode, explain how Paper-Mode information delay worsens oscillations, and recommend two information-sharing mechanisms.',
    rubricCriteria: [
      { id: 'c1', title: 'Bullwhip Ratio & Order Amplification Quantification', maxMarks: 25 },
      { id: 'c2', title: 'Blind Mode vs. Shared POS Visibility Comparison', maxMarks: 25 },
      { id: 'c3', title: 'Impact of Lead Time & Paper-Mode Information Delay', maxMarks: 25 },
      { id: 'c4', title: 'Managerial Information-Sharing Recommendation', maxMarks: 25 },
    ],
  },
  {
    id: 'psis_req_to_order',
    domain: 'PSIS',
    code: 'PSIS-LAB 05',
    title: 'Requisition to Order, DoA & Commitment Accounting',
    shortTitle: 'Requisition to Order',
    summary: 'Route catalogue requisitions through Delegation-of-Authority thresholds, detect split-order avoidance, switch between Spent-Only and Commitment Accounting to witness double-commitment failure, and calculate Blanket Order ROI.',
    duration: '60 min',
    supportsOwnData: true,
    presets: REQ_TO_ORDER_PRESETS,
    defaultPresetId: REQ_TO_ORDER_PRESETS[0].id,
    defaultPrompt: 'Explain how Spent-Only accounting allowed the organization to commit itself beyond budget, identify any split-order avoidance risks in your DoA queue, and justify when to replace standard POs with a Blanket Purchase Agreement using break-even analysis.',
    rubricCriteria: [
      { id: 'c1', title: 'Delegation of Authority Routing & Split-Order Detection', maxMarks: 25 },
      { id: 'c2', title: 'Commitment vs. Spent-Only Budget Trap Analysis', maxMarks: 25 },
      { id: 'c3', title: 'Blanket Order vs. Standard PO Cost & Break-Even Math', maxMarks: 25 },
      { id: 'c4', title: 'Procurement Policy & ERP Configuration Judgement', maxMarks: 25 },
    ],
  },
  {
    id: 'psis_the_tender',
    domain: 'PSIS',
    code: 'PSIS-LAB 06',
    title: 'Sealed Tender Evaluation & Live Reverse Auction (The Tender)',
    shortTitle: 'The Tender (e-Sourcing)',
    summary: 'Conduct a transparent weighted sealed-bid evaluation (Price, Technical, Delivery, Local Content), test award sensitivity to criteria weights, and run a multi-round live Reverse Auction to evaluate savings vs. winner’s curse risk.',
    duration: '60–75 min',
    supportsOwnData: true,
    presets: THE_TENDER_PRESETS,
    defaultPresetId: THE_TENDER_PRESETS[0].id,
    defaultPrompt: 'Defend your tender award by comparing Lowest-Price vs. Best-Value weighted scores, evaluate the price savings achieved in the Reverse Auction against below-cost quality/default risks, and specify which sourcing method fits strategic vs. commodity spend.',
    rubricCriteria: [
      { id: 'c1', title: 'Weighted Multi-Criteria Sealed Tender Evaluation', maxMarks: 25 },
      { id: 'c2', title: 'Criteria Weight Sensitivity & Transparency Analysis', maxMarks: 25 },
      { id: 'c3', title: 'Reverse Auction Dynamics & Winner’s Curse Diagnosis', maxMarks: 25 },
      { id: 'c4', title: 'Strategic Award & Sourcing Method Recommendation', maxMarks: 25 },
    ],
  },
];

export function getLabDef(labId) {
  return LAB_CATALOG.find((l) => l.id === labId) || null;
}

export function getLabPreset(labId, presetId) {
  const def = getLabDef(labId);
  if (!def) return null;
  return def.presets.find((p) => p.id === presetId) || def.presets[0] || null;
}

// Downloadable CSV templates so lecturers or students can prepare clean Excel/CSV data
export function buildLabCsvTemplate(labId, variant = '') {
  if (labId === 'tqm_spc') {
    if (variant === 'p_chart') {
      return {
        filename: 'spc-p-chart-template.csv',
        content: 'Sample,SampleSize_n,Defects_d\nDay 1,150,6\nDay 2,160,7\nDay 3,140,5\nDay 4,150,15\nDay 5,155,6\n',
      };
    }
    if (variant === 'c_chart') {
      return {
        filename: 'spc-c-chart-template.csv',
        content: 'Unit,Defects_c\nLot 1,4\nLot 2,6\nLot 3,5\nLot 4,13\nLot 5,5\n',
      };
    }
    return {
      filename: 'spc-subgroups-template.csv',
      content: 'Subgroup,X1,X2,X3,X4,X5\nS01,500.4,499.6,500.2,499.8,500.5\nS02,499.7,500.3,500.1,499.5,500.2\nS03,500.6,499.9,500.0,500.4,499.8\nS04,502.1,502.6,501.8,502.4,502.0\n',
    };
  }
  if (labId === 'tqm_tools') {
    if (variant === 'scatter') {
      return {
        filename: 'quality-scatter-template.csv',
        content: 'Run,X_Value,Y_Value\nRun 1,40,2.1\nRun 2,50,3.4\nRun 3,60,5.8\nRun 4,70,8.9\n',
      };
    }
    if (variant === 'histogram') {
      return {
        filename: 'quality-histogram-template.csv',
        content: 'Measurement\n12.1\n13.4\n14.0\n14.2\n13.8\n15.1\n16.2\n14.5\n',
      };
    }
    if (variant === 'stratification') {
      return {
        filename: 'quality-stratification-template.csv',
        content: 'Stratum,Value\nMorning Shift,4.2\nMorning Shift,3.9\nAfternoon Shift,5.8\nNight Shift,11.4\nNight Shift,12.1\n',
      };
    }
    return {
      filename: 'quality-pareto-checksheet-template.csv',
      content: 'DefectCategory,Shift1,Shift2,Shift3\nWeak Seal,14,19,31\nMisaligned Label,12,15,17\nUnderweight Pack,6,8,12\nCrushed Carton,5,4,7\n',
    };
  }
  if (labId === 'psis_seven_names') {
    return {
      filename: 'master-data-items-template.csv',
      content: 'Code,ItemDescription,StockQty\nSKU-101,A4 Photocopy Paper 80gsm (500 Sheets),140\nSKU-102,Paper A4 80g Ream 500sh,50\nSKU-103,Nitrile Examination Gloves Medium (Box of 100),85\nSKU-104,Exam Gloves Nitrile Size M,45\n',
    };
  }
  if (labId === 'psis_scan_it') {
    return {
      filename: 'gtin-barcode-log-template.csv',
      content: 'Barcode,ProductName,Category\n6031204001016,Natural Mineral Water 500ml,Beverage\n6038810002451,Local Cocoa Chocolate Bar 100g,Confectionery\n6151100045218,Instant Noodles Family Pack,Dry Goods\n',
    };
  }
  if (labId === 'psis_the_match') {
    return {
      filename: 'p2p-three-way-match-template.csv',
      content: 'PO_No,GRN_No,Invoice_No,Supplier,Item,PO_Qty,PO_UnitPrice,GRN_Qty,Inv_Qty,Inv_UnitPrice,BudgetRemaining\nPO-101,GRN-501,INV-901,Apex Supplies,A4 Paper Box,60,310,60,60,310,30000\nPO-102,GRN-502,INV-902,MediSafe Ltd,Surgical Gloves,200,120,160,200,120,30000\n',
    };
  }
  if (labId === 'psis_the_whip') {
    return {
      filename: 'bullwhip-demand-series-template.csv',
      content: 'Week,ConsumerDemand\n1,40\n2,40\n3,40\n4,40\n5,40\n6,40\n7,40\n8,40\n9,56\n10,56\n11,56\n12,40\n13,40\n14,40\n15,40\n16,40\n',
    };
  }
  if (labId === 'psis_req_to_order') {
    return {
      filename: 'requisitions-doa-template.csv',
      content: 'ReqNo,Item,Supplier,CostCentre,Qty,UnitPrice\nREQ-001,Laboratory Reagent Kit,BioLab Supplies Ltd,Clinical & Lab,12,1450\nREQ-002,Laboratory Reagent Kit,BioLab Supplies Ltd,Clinical & Lab,10,1450\nREQ-003,A4 Copier Paper Box,Apex Stationery Depot,IT & Campus Ops,15,320\n',
    };
  }
  if (labId === 'psis_the_tender') {
    return {
      filename: 'tender-supplier-bids-template.csv',
      content: 'Supplier,BidPrice,TechnicalScore_0_100,LeadTimeDays,LocalContent_0_100,ReserveFloor\nSolarMed Engineering Ltd,438000,91,21,86,392000\nLowCost Global Imports,396000,68,42,35,352000\nWestAfrica ColdTech,422000,84,28,90,380000\n',
    };
  }
  // tqm_coq
  return {
    filename: 'cost-of-quality-paf-template.csv',
    content: 'CostItem,Category,Amount\nOperator TQM Training,prevention,18500\nIncoming Material Inspection,appraisal,31000\nScrap and Rework,internal_failure,76000\nCustomer Returns and Warranty,external_failure,92000\n',
  };
}

// Read uploaded .csv or .xlsx into raw 2D string rows
export async function readLabSpreadsheetRows(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file');
    const rows = await readXlsxFile(file);
    return rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c).trim())));
  }
  if (name.endsWith('.xls')) {
    throw new Error('Legacy .xls files are not supported. Save as .xlsx or .csv first.');
  }
  return parseDelimited(await file.text());
}

// Direct submission bridge into PSCM E-class Assignments -> Marking -> Student Grades -> CA
export async function submitLabReportToAssignment({
  assignment,
  profile,
  session,
  reportTitle,
  reportBody,
  note = '',
}) {
  if (!assignment?.id) throw new Error('No linked assignment found for this lab.');
  if (!session?.user?.id) throw new Error('You must be signed in to submit a lab report.');

  const assignMeta = parseAssignmentMeta(assignment);
  const mySyndicate = findStudentSyndicate(assignMeta, profile?.index_no);
  const useGroup = Boolean(mySyndicate?.members?.length);

  const studentLine = [
    profile?.full_name,
    profile?.index_no ? `(${profile.index_no})` : '',
    useGroup ? `· ${mySyndicate.name}` : '',
  ].filter(Boolean).join(' ');

  const submittedAt = new Date().toLocaleString();
  const pdfBlob = buildTypedResponsePdfBlob({
    title: reportTitle || assignment.title || 'Interactive Lab Report',
    studentLine,
    submittedAt,
    body: reportBody,
  });

  const safeSlug = String(reportTitle || 'lab-report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'lab-report';
  const fileName = `${safeSlug}-${Date.now()}.pdf`;
  const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
  const storagePath = `${assignment.id}/${session.user.id}/${Date.now()}-${fileName}`;

  const savedPath = await uploadFile('submissions', storagePath, pdfFile);

  const baseArgs = {
    p_assignment: assignment.id,
    p_path: savedPath,
    p_name: fileName,
    p_note: note || `Interactive Lab Report (${reportTitle})`,
  };
  const extendedArgs = {
    ...baseArgs,
    p_response_text: reportBody,
    p_typing_meta: { source: 'interactive_lab', labReport: true },
  };

  try {
    if (useGroup) {
      await rpc('submit_group_assignment', { ...extendedArgs, p_member_indexes: mySyndicate.members });
    } else {
      await rpc('submit_assignment', extendedArgs);
    }
  } catch (err) {
    const msg = err?.message || '';
    if (/p_response_text|p_typing_meta|Could not find|does not exist|schema cache/i.test(msg)) {
      if (useGroup) {
        await rpc('submit_group_assignment', { ...baseArgs, p_member_indexes: mySyndicate.members });
      } else {
        await rpc('submit_assignment', baseArgs);
      }
    } else {
      throw err;
    }
  }

  return { fileName, savedPath, groupName: useGroup ? mySyndicate.name : null };
}
