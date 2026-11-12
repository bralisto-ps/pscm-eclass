// Universal question parser supporting:
// 1. Text paste with format indicator tags: [MCQ], [True/False], [Short Answer], [Calculation], [Essay]
// 2. Direct upload of Word (.docx) files via mammoth
// 3. Direct upload of Excel (.xlsx) / CSV files via read-excel-file
// 4. Tab-delimited copy-paste directly from Excel sheets

import { downloadExcel, downloadText } from './sheets.js';

export const KIND_LABELS = {
  mcq: 'Multiple choice',
  truefalse: 'True / false',
  short: 'Short answer',
  numeric: 'Calculation',
  essay: 'Written answer',
};

const LETTERS = 'abcdefgh';

export function parseQuestionsFromText(text, defaultMarks = 1, defaultTopic = '') {
  const raw = String(text || '').replace(/\r/g, '').trim();
  if (!raw) return [];

  // Check if text is a pasted Excel table (contains tabs and linebreaks)
  const firstLine = raw.split('\n')[0] || '';
  if (firstLine.includes('\t')) {
    const rows = raw.split('\n').map((l) => l.split('\t').map((c) => c.trim()));
    const excelParsed = parseQuestionsFromRows(rows, defaultMarks, defaultTopic);
    if (excelParsed.length > 0) return excelParsed;
  }

  // Split by double line breaks or question divider blocks
  const blocks = raw.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  const out = [];

  for (const block of blocks) {
    const q = parseSingleBlock(block, defaultMarks, defaultTopic);
    if (q) out.push(q);
  }

  return out;
}

function parseSingleBlock(block, defaultMarks, defaultTopic) {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  let explicitKind = null;
  let marks = defaultMarks;
  let topic = defaultTopic;
  let explanation = '';
  let tolerance = 0.01;
  let unit = '';
  let explicitAnswer = null;

  const cleanLines = [];
  const options = [];

  for (const line of lines) {
    // 1. Format Indicator e.g. [MCQ], [True/False], [Short Answer], [Calculation], [Essay], Type: MCQ
    const mType = line.match(/^(?:\[|\()(?:type|format|kind)?\s*([a-zA-Z\s\/\-_]+)(?:\]|\))\s*$/i) ||
                  line.match(/^(?:type|format|kind)\s*[:=-]\s*([a-zA-Z\s\/\-_]+)$/i);
    if (mType) {
      const t = mType[1].trim().toLowerCase().replace(/[\s\/\-_]/g, '');
      if (['mcq', 'multiplechoice', 'choice', 'multi'].includes(t)) {
        explicitKind = 'mcq';
      } else if (['tf', 'truefalse', 'trueorfalse'].includes(t)) {
        explicitKind = 'truefalse';
      } else if (['short', 'shortanswer', 'sa'].includes(t)) {
        explicitKind = 'short';
      } else if (['calc', 'calculation', 'numeric', 'num', 'math'].includes(t)) {
        explicitKind = 'numeric';
      } else if (['essay', 'written', 'writtenanswer', 'long', 'longanswer', 'descriptive'].includes(t)) {
        explicitKind = 'essay';
      }
      continue;
    }

    // 2. Marks e.g. [Marks: 2], Points: 3, [Pts: 5]
    const mMarks = line.match(/^(?:\[|\()?\s*(?:marks?|points?|pts?)\s*[:=-]\s*([0-9.]+)\s*(?:\]|\))?$/i);
    if (mMarks) {
      const val = parseFloat(mMarks[1]);
      if (!Number.isNaN(val)) marks = val;
      continue;
    }

    // 3. Topic e.g. [Topic: Inventory], Category: Supply Chain
    const mTopic = line.match(/^(?:\[|\()?\s*(?:topic|category|tag)\s*[:=-]\s*(.*?)\s*(?:\]|\))?$/i);
    if (mTopic) {
      topic = mTopic[1].trim();
      continue;
    }

    // 4. Explanation e.g. [Explanation: ...], Rationale: ...
    const mExp = line.match(/^(?:\[|\()?\s*(?:explanation|rationale|feedback)\s*[:=-]\s*(.*?)\s*(?:\]|\))?$/i);
    if (mExp) {
      explanation = mExp[1].trim();
      continue;
    }

    // 5. Tolerance e.g. [Tolerance: 0.5]
    const mTol = line.match(/^(?:\[|\()?\s*tolerance\s*[:=-]\s*([0-9.]+)\s*(?:\]|\))?$/i);
    if (mTol) {
      const val = parseFloat(mTol[1]);
      if (!Number.isNaN(val)) tolerance = val;
      continue;
    }

    // 6. Unit e.g. [Unit: kg], Unit: units
    const mUnit = line.match(/^(?:\[|\()?\s*unit\s*[:=-]\s*(.*?)\s*(?:\]|\))?$/i);
    if (mUnit) {
      unit = mUnit[1].trim();
      continue;
    }

    // 7. Answer line e.g. Answer: B, Ans: True, Correct: 42.5
    const mAns = line.match(/^(?:answer|ans|correct(?:\s*answer)?|accepted)\s*[:=-]\s*(.*)$/i);
    if (mAns) {
      explicitAnswer = mAns[1].trim();
      continue;
    }

    // 8. MCQ Option line: A) Option text or A. Option text or [A] Option text
    const mOpt = line.match(/^\(?([A-Ha-h])[).:\]]\s+(.*)$/);
    if (mOpt) {
      const letter = mOpt[1].toLowerCase();
      let textVal = mOpt[2].trim();
      const starred = /\s*\*$/.test(textVal) || /^\*\s*/.test(textVal);
      textVal = textVal.replace(/\s*\*$/, '').replace(/^\*\s*/, '').trim();
      options.push({ letter, text: textVal, starred });
      continue;
    }

    cleanLines.push(line);
  }

  let prompt = cleanLines.join('\n').trim();
  // Strip leading question number e.g. "1. ", "Question 1: "
  prompt = prompt.replace(/^(?:q(?:uestion)?\s*)?\d+\s*[.):-]\s*/i, '').trim();

  // Deduce question kind if not explicitly tagged
  let kind = explicitKind;
  if (!kind) {
    if (options.length >= 2) {
      kind = 'mcq';
    } else if (explicitAnswer && ['true', 'false', 't', 'f'].includes(explicitAnswer.toLowerCase())) {
      kind = 'truefalse';
    } else if (explicitAnswer && /^-?[0-9]+(?:\.[0-9]+)?$/.test(explicitAnswer.trim())) {
      kind = 'numeric';
    } else if (explicitAnswer) {
      kind = 'short';
    } else {
      kind = 'essay';
    }
  }

  const q = {
    kind,
    prompt,
    marks: Number(marks) || 1,
    topic: topic || '',
    explanation: explanation || '',
    valid: true,
    errors: [],
  };

  if (!prompt) {
    q.valid = false;
    q.errors.push('Missing question prompt text');
  }

  if (kind === 'mcq') {
    if (options.length < 2) {
      q.valid = false;
      q.errors.push('MCQ requires at least 2 options (A, B...)');
      q.options = [];
      q.answer = {};
    } else {
      q.options = options.map((o, idx) => ({ id: LETTERS[idx], text: o.text }));
      let correctId = null;

      if (explicitAnswer) {
        const ansClean = explicitAnswer.toLowerCase().replace(/[()]/g, '').trim();
        const found = options.findIndex((o) => o.letter === ansClean || o.text.toLowerCase() === ansClean);
        if (found >= 0) correctId = LETTERS[found];
      }

      if (!correctId) {
        const starredIdx = options.findIndex((o) => o.starred);
        if (starredIdx >= 0) correctId = LETTERS[starredIdx];
      }

      if (!correctId) {
        correctId = 'a';
        q.warning = 'No correct option marked (defaulted to A)';
      }

      q.answer = { correct: correctId };
    }
  } else if (kind === 'truefalse') {
    q.options = [
      { id: 'true', text: 'True' },
      { id: 'false', text: 'False' },
    ];
    let isFalse = false;
    if (explicitAnswer) {
      const clean = explicitAnswer.toLowerCase().trim();
      if (['false', 'f', 'no', '0'].includes(clean)) isFalse = true;
    }
    q.answer = { correct: isFalse ? 'false' : 'true' };
  } else if (kind === 'numeric') {
    q.options = [];
    q.decimals = 2;
    q.tolerance = tolerance;
    q.unit = unit;
    if (explicitAnswer) {
      const matchNum = explicitAnswer.match(/-?[0-9]+(?:\.[0-9]+)?/);
      if (matchNum) {
        q.answer = { value: parseFloat(matchNum[0]) };
      } else {
        q.valid = false;
        q.errors.push('Calculation requires a numeric answer');
      }
    } else {
      q.valid = false;
      q.errors.push('Calculation requires an Answer (e.g. Answer: 42)');
    }
  } else if (kind === 'short') {
    q.options = [];
    if (explicitAnswer) {
      const accepted = explicitAnswer.split(/[,|;\n]+/).map((s) => s.trim()).filter(Boolean);
      q.answer = { accepted: accepted.length ? accepted : [explicitAnswer] };
    } else {
      q.valid = false;
      q.errors.push('Short answer requires an accepted answer');
    }
  } else if (kind === 'essay') {
    q.options = [];
    q.answer = {};
    if (marks === 1) {
      q.marks = 5; // standard essay default
    }
  }

  return q;
}

export function parseQuestionsFromRows(rows, defaultMarks = 1, defaultTopic = '') {
  if (!rows || rows.length < 2) return [];

  const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase());

  const findCol = (...patterns) => {
    for (const pat of patterns) {
      const idx = header.findIndex((h) => pat.test(h));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const colType = findCol(/^(type|kind|format)$/i);
  const colPrompt = findCol(/^(question|prompt|text|q)$/i, /question/i, /prompt/i);
  const colAns = findCol(/^(answer|correct|solution|key)$/i, /answer/i, /correct/i);
  const colMarks = findCol(/^(marks|points|weight)$/i, /marks/i);
  const colTopic = findCol(/^(topic|category|tag)$/i);
  const colExp = findCol(/^(explanation|rationale|feedback)$/i);
  const colTol = findCol(/^(tolerance)$/i);
  const colUnit = findCol(/^(unit)$/i);

  const colOpts = [];
  for (const letter of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const c = findCol(new RegExp(`^(option\\s*${letter}|opt\\s*${letter}|choice\\s*${letter}|^${letter})$`, 'i'));
    if (c >= 0) colOpts.push({ letter, col: c });
  }

  const out = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const cell = (idx) => (idx >= 0 && idx < row.length ? String(row[idx] ?? '').trim() : '');

    const prompt = cell(colPrompt);
    if (!prompt) continue;

    const rawType = cell(colType).toLowerCase().replace(/[\s\/\-_]/g, '');
    const rawAns = cell(colAns);
    const rawMarks = cell(colMarks);
    const rawTopic = cell(colTopic) || defaultTopic;
    const rawExp = cell(colExp);
    const rawTol = cell(colTol);
    const rawUnit = cell(colUnit);

    const marksVal = parseFloat(rawMarks);
    const marks = !Number.isNaN(marksVal) && marksVal > 0 ? marksVal : defaultMarks;

    const options = [];
    for (const { letter, col } of colOpts) {
      const val = cell(col);
      if (val) options.push({ letter, text: val });
    }

    let kind = null;
    if (['mcq', 'multiplechoice', 'choice', 'multi'].includes(rawType)) {
      kind = 'mcq';
    } else if (['tf', 'truefalse', 'trueorfalse'].includes(rawType)) {
      kind = 'truefalse';
    } else if (['short', 'shortanswer', 'sa'].includes(rawType)) {
      kind = 'short';
    } else if (['calc', 'calculation', 'numeric', 'num', 'math'].includes(rawType)) {
      kind = 'numeric';
    } else if (['essay', 'written', 'long', 'descriptive'].includes(rawType)) {
      kind = 'essay';
    }

    if (!kind) {
      if (options.length >= 2) kind = 'mcq';
      else if (['true', 'false', 't', 'f'].includes(rawAns.toLowerCase())) kind = 'truefalse';
      else if (rawAns && /^-?[0-9]+(?:\.[0-9]+)?$/.test(rawAns.trim())) kind = 'numeric';
      else if (rawAns) kind = 'short';
      else kind = 'essay';
    }

    const q = {
      kind,
      prompt: prompt.replace(/^(?:q(?:uestion)?\s*)?\d+\s*[.):-]\s*/i, '').trim(),
      marks,
      topic: rawTopic,
      explanation: rawExp,
      valid: true,
      errors: [],
    };

    if (kind === 'mcq') {
      if (options.length < 2) {
        q.valid = false;
        q.errors.push('MCQ requires at least 2 options');
      } else {
        q.options = options.map((o, idx) => ({ id: LETTERS[idx], text: o.text }));
        const cleanAns = rawAns.toLowerCase().replace(/[()]/g, '').trim();
        const found = options.findIndex((o) => o.letter === cleanAns || o.text.toLowerCase() === cleanAns);
        q.answer = { correct: found >= 0 ? LETTERS[found] : 'a' };
        if (found < 0 && rawAns) q.warning = `Could not match answer "${rawAns}", defaulted to A`;
      }
    } else if (kind === 'truefalse') {
      q.options = [
        { id: 'true', text: 'True' },
        { id: 'false', text: 'False' },
      ];
      const isFalse = ['false', 'f', 'no', '0'].includes(rawAns.toLowerCase().trim());
      q.answer = { correct: isFalse ? 'false' : 'true' };
    } else if (kind === 'numeric') {
      q.options = [];
      q.decimals = 2;
      q.tolerance = parseFloat(rawTol) || 0.01;
      q.unit = rawUnit;
      const mNum = rawAns.match(/-?[0-9]+(?:\.[0-9]+)?/);
      if (mNum) {
        q.answer = { value: parseFloat(mNum[0]) };
      } else {
        q.valid = false;
        q.errors.push('Calculation requires a numeric answer');
      }
    } else if (kind === 'short') {
      q.options = [];
      const accepted = rawAns.split(/[,|;\n]+/).map((s) => s.trim()).filter(Boolean);
      q.answer = { accepted: accepted.length ? accepted : [rawAns] };
    } else if (kind === 'essay') {
      q.options = [];
      q.answer = {};
      if (marks === 1) q.marks = 5;
    }

    out.push(q);
  }

  return out;
}

export async function parseQuestionsFromFile(file, defaultMarks = 1, defaultTopic = '') {
  const name = file.name.toLowerCase();

  // 1. Word Document (.docx)
  if (name.endsWith('.docx')) {
    const { default: mammoth } = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return parseQuestionsFromText(result.value, defaultMarks, defaultTopic);
  }

  // 2. Excel Document (.xlsx)
  if (name.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file');
    const rows = await readXlsxFile(file);
    return parseQuestionsFromRows(rows, defaultMarks, defaultTopic);
  }

  if (name.endsWith('.xls')) {
    throw new Error('Old .xls format is not supported. In Excel, please click "Save As" and choose .xlsx or CSV.');
  }

  // 3. CSV or Plain Text (.csv, .txt, .tsv)
  const text = await file.text();
  return parseQuestionsFromText(text, defaultMarks, defaultTopic);
}

// ---------------- Sample Template Downloads ----------------

export async function downloadSampleExcel() {
  const rows = [
    ['Type', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Answer', 'Marks', 'Topic', 'Explanation'],
    ['MCQ', 'Which inventory cost rises when order quantity increases?', 'Ordering cost', 'Holding cost', 'Stockout cost', 'Purchase price', 'B', 1, 'Inventory', 'Holding costs increase with larger inventory.'],
    ['True/False', 'Cross-docking eliminates inventory storage by moving goods directly from inbound to outbound.', '', '', '', '', 'True', 1, 'Warehousing', 'Goods are sorted and consolidated directly without putaway.'],
    ['Short Answer', 'What does the acronym EOQ stand for in inventory management?', '', '', '', '', 'Economic Order Quantity', 2, 'Inventory', 'Economic Order Quantity minimizes total holding and ordering costs.'],
    ['Calculation', 'Calculate reorder point: Daily demand = 25 units, Lead time = 4 days.', '', '', '', '', '100', 3, 'Inventory', 'ROP = Demand * Lead Time = 25 * 4 = 100 units.'],
    ['Essay', 'Critically analyze how supply chain visibility helps mitigate the bullwhip effect.', '', '', '', '', '', 5, 'Strategy', 'Graded manually using course rubric.'],
  ];

  const widths = [14, 45, 18, 18, 18, 18, 15, 8, 14, 30];
  await downloadExcel('quiz_questions_template.xlsx', rows, widths);
}

export function downloadSampleWord() {
  const sampleText = `========================================================================
PSCM E-CLASS: UNIVERSAL QUIZ QUESTION TEMPLATE (WORD / TEXT)
========================================================================
Instructions:
- Paste or type questions below. Leave a blank line between questions.
- Format tags: [MCQ], [True/False], [Short Answer], [Calculation], [Essay]
- Optional tags: [Marks: 2], [Topic: Inventory], [Explanation: ...]
========================================================================

[MCQ]
1. Which inventory cost rises when order quantity increases?
A) Ordering cost
B) Holding cost *
C) Stockout cost
D) Purchase price
[Marks: 1]
[Topic: Inventory]
[Explanation: Holding costs rise proportionally with average inventory.]

[True/False]
2. Cross-docking eliminates warehouse holding by moving goods directly from inbound to outbound transport.
Answer: True
[Marks: 1]
[Topic: Warehousing]

[Short Answer]
3. What does the acronym EOQ stand for in inventory management?
Answer: Economic Order Quantity | Economic Order Qty
[Marks: 2]
[Topic: Inventory]

[Calculation]
4. Calculate reorder point: Daily demand = 25 units, Lead time = 4 days.
Answer: 100
[Tolerance: 0.1]
[Unit: units]
[Marks: 3]
[Topic: Inventory]

[Essay]
5. Critically analyze how supply chain visibility helps mitigate the bullwhip effect.
[Marks: 5]
[Topic: Strategy]
`;

  downloadText('quiz_questions_template.txt', sampleText, 'text/plain');
}

export const SAMPLE_PASTE_TEXT = `[MCQ]
1. Which inventory cost rises when order quantity increases?
A) Ordering cost
B) Holding cost *
C) Stockout cost
D) Purchase price
[Marks: 1]
[Topic: Inventory]

[True/False]
2. Cross-docking eliminates inventory storage by transferring goods directly from inbound to outbound trailers.
Answer: True
[Marks: 1]
[Topic: Warehousing]

[Short Answer]
3. What does the acronym EOQ stand for in inventory management?
Answer: Economic Order Quantity
[Marks: 2]
[Topic: Inventory]

[Calculation]
4. Calculate reorder point: Daily demand = 25 units, Lead time = 4 days.
Answer: 100
[Marks: 3]
[Topic: Inventory]

[Essay]
5. Critically analyze how supply chain visibility helps mitigate the bullwhip effect.
[Marks: 5]
[Topic: Strategy]`;
