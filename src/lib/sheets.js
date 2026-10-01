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

// Finds the index-number and name columns, whatever order or headings they have.
export function rowsToStudents(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h ?? '').toLowerCase());
  const looksLikeHeader = header.some((h) => /index|student|name|id|number|ref/.test(h));
  let idxCol = 0;
  let nameCols = [1];
  let body = rows;
  if (looksLikeHeader) {
    body = rows.slice(1);
    const i = header.findIndex((h) => /index|student.?id|id|number|ref/.test(h) && !/name/.test(h));
    if (i >= 0) idxCol = i;
    const full = header.findIndex((h) => /full.?name|^name$|student.?name/.test(h));
    const first = header.findIndex((h) => /first|given|other/.test(h));
    const last = header.findIndex((h) => /last|surname|family/.test(h));
    if (full >= 0) nameCols = [full];
    else if (first >= 0 && last >= 0) nameCols = [first, last];
    else nameCols = header.map((_, k) => k).filter((k) => k !== idxCol).slice(0, 1);
  }
  return body
    .map((r) => ({
      index_no: String(r[idxCol] ?? '').trim(),
      full_name: nameCols.map((c) => String(r[c] ?? '').trim()).filter(Boolean).join(' '),
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
