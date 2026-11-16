// Minimal multi-page PDF generator used as an automatic fallback when
// submitting typed responses on projects where the typed-text SQL extension
// has not yet been applied.

function toAscii(str) {
  return String(str || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E\n\r\t]/g, '?');
}

function pdfEscape(str) {
  return toAscii(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLines(text, maxChars = 84) {
  const out = [];
  for (const rawPara of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const para = rawPara.trimEnd();
    if (!para) {
      out.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      if (!line) {
        if (w.length <= maxChars) line = w;
        else {
          for (let i = 0; i < w.length; i += maxChars) out.push(w.slice(i, i + maxChars));
        }
      } else if (line.length + 1 + w.length <= maxChars) {
        line += ' ' + w;
      } else {
        out.push(line);
        if (w.length <= maxChars) line = w;
        else {
          for (let i = 0; i < w.length; i += maxChars) out.push(w.slice(i, i + maxChars));
          line = '';
        }
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [''];
}

export function buildTypedResponsePdfBlob({ title, studentLine, submittedAt, body }) {
  const lines = [
    ...(title ? [title] : []),
    ...(studentLine ? [studentLine] : []),
    ...(submittedAt ? [`Submitted: ${submittedAt}`] : []),
    '------------------------------------------------------------------------',
    '',
    ...wrapLines(body, 84),
  ];

  const linesPerPage = 44;
  const pages = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  if (!pages.length) pages.push(['']);

  const objects = [];
  // 1 = Catalog, 2 = Pages, 3 = Font
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  const pageObjIds = pages.map((_, idx) => 4 + idx * 2);
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  pages.forEach((pageLines, idx) => {
    const pageId = 4 + idx * 2;
    const contentId = pageId + 1;
    const ops = ['BT', '/F1 11 Tf', '15 TL', '54 756 Td'];
    pageLines.forEach((ln, lineIdx) => {
      if (lineIdx > 0) ops.push('T*');
      ops.push(`(${pdfEscape(ln)}) Tj`);
    });
    ops.push('ET');
    const stream = ops.join('\n');
    objects.push(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);
    objects.push(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}
