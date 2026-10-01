// Reading class lists and writing gradebooks.

function splitCsvLine(line, delim) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseDelimited(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const first = lines[0];
  const delim = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
  return lines.map((l) => splitCsvLine(l, delim).map((c) => c.trim()));
}

// Finds the index-number, name, programme and stream columns, whatever order or headings they have.
export function rowsToStudents(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h ?? '').toLowerCase().trim());
  const looksLikeHeader = header.some((h) => /index|student|name|id|number|ref|programme|program|stream/.test(h));
  let idxCol = 0;
  let nameCols = [1];
  let progCol = -1;
  let streamCol = -1;
  let body = rows;
  if (looksLikeHeader) {
    body = rows.slice(1);
    progCol = header.findIndex((h) => /programme|program|specialisation|specialization|major|department|option/.test(h));
    streamCol = header.findIndex((h) => /stream|session|mode|category|shift/.test(h));
    const used = new Set([progCol, streamCol]);
    const i = header.findIndex((h, k) => !used.has(k) && /index|student.?id|^id$|number|ref|matric/.test(h) && !/name/.test(h));
    if (i >= 0) idxCol = i;
    used.add(idxCol);
    const full = header.findIndex((h, k) => !used.has(k) && /full.?name|^name$|student.?name|^names?$/.test(h));
    const first = header.findIndex((h, k) => !used.has(k) && /first|given|other/.test(h));
    const last = header.findIndex((h, k) => !used.has(k) && /last|surname|family/.test(h));
    if (full >= 0) nameCols = [full];
    else if (first >= 0 && last >= 0) nameCols = [first, last];
    else nameCols = header.map((_, k) => k).filter((k) => !used.has(k)).slice(0, 1);
  } else if (rows[0].length >= 4) {
    // no headings: index, name, programme, stream
    progCol = 2;
    streamCol = 3;
  }
  const cell = (r, c) => (c >= 0 ? String(r[c] ?? '').trim() : '');
  return body
    .map((r) => ({
      index_no: cell(r, idxCol),
      full_name: nameCols.map((c) => cell(r, c)).filter(Boolean).join(' '),
      programme: cell(r, progCol),
      stream: cell(r, streamCol),
    }))
    .filter((r) => r.index_no);
}

export async function readStudentFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file');
    const rows = await readXlsxFile(file);
    return rowsToStudents(rows.map((r) => r.map((c) => (c === null ? '' : String(c)))));
  }
  if (name.endsWith('.xls')) {
    throw new Error('Old .xls files are not supported. In Excel, use Save As → Excel Workbook (.xlsx) or CSV.');
  }
  return rowsToStudents(parseDelimited(await file.text()));
}

// rows: array of arrays; first row is the header
export async function downloadExcel(fileName, rows, widths) {
  const { default: writeXlsxFile } = await import('write-excel-file');
  const data = rows.map((r, i) =>
    r.map((v) => {
      if (v === null || v === undefined || v === '') return null;
      if (i === 0) return { value: String(v), fontWeight: 'bold' };
      if (typeof v === 'number') return { value: v, type: Number };
      return { value: String(v), type: String };
    }),
  );
  await writeXlsxFile(data, {
    fileName,
    columns: widths ? widths.map((w) => ({ width: w })) : undefined,
    stickyRowsCount: 1,
  });
}

// sheets: [{ name, rows (first row = header), widths }]
export async function downloadWorkbook(fileName, sheets) {
  const { default: writeXlsxFile } = await import('write-excel-file');
  const toCells = (rows) => rows.map((r, i) =>
    r.map((v) => {
      if (v === null || v === undefined || v === '') return null;
      if (i === 0) return { value: String(v), fontWeight: 'bold' };
      if (typeof v === 'number') return { value: v, type: Number };
      return { value: String(v), type: String };
    }));
  const used = new Set();
  const names = sheets.map((s) => {
    let n = String(s.name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet';
    let k = 2;
    while (used.has(n)) n = `${n.slice(0, 28)} ${k++}`;
    used.add(n);
    return n;
  });
  await writeXlsxFile(sheets.map((s) => toCells(s.rows)), {
    fileName,
    sheets: names,
    columns: sheets.map((s) => (s.widths || []).map((w) => ({ width: w }))),
    stickyRowsCount: 1,
  });
}

export function downloadText(fileName, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
