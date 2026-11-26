// Lightweight pure-JS PDF 1.4 builder with optional embedded JPEG chart pages (/DCTDecode).
// Zero external dependencies; works offline in any browser or Node test runtime.

function pdfEscape(s) {
  return String(s ?? '')
    .replace(/[^\x20-\x7e]/g, (ch) => {
      if (ch === '\u2014' || ch === '\u2013') return '-';
      if (ch === '\u2018' || ch === '\u2019') return "'";
      if (ch === '\u201c' || ch === '\u201d') return '"';
      if (ch === '\u2022' || ch === '\u00b7') return '*';
      if (ch === '\u2192') return '->';
      if (ch === '\u2265') return '>=';
      if (ch === '\u2264') return '<=';
      return ' ';
    })
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapLines(text, maxChars = 84) {
  const out = [];
  const paragraphs = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  for (const para of paragraphs) {
    if (!para.trim()) {
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
        line += ` ${w}`;
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

function encodeAscii(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function concatBytes(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/**
 * Builds a valid PDF 1.4 Blob containing formatted text pages plus optional embedded JPEG chart pages.
 * @param {{ title?: string, studentLine?: string, submittedAt?: string, body?: string, images?: Array<{ caption?: string, jpegBytes: Uint8Array, width: number, height: number }> }} params
 */
export function buildTypedResponsePdfBlob({ title, studentLine, submittedAt, body, images = [] }) {
  const lines = [
    ...(title ? [title] : []),
    ...(studentLine ? [studentLine] : []),
    ...(submittedAt ? [`Submitted: ${submittedAt}`] : []),
    '------------------------------------------------------------------------',
    '',
    ...wrapLines(body, 84),
  ];

  const linesPerPage = 44;
  const textPages = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    textPages.push(lines.slice(i, i + linesPerPage));
  }
  if (!textPages.length) textPages.push(['']);

  const validImages = (Array.isArray(images) ? images : []).filter(
    (img) => img && img.jpegBytes instanceof Uint8Array && img.jpegBytes.length > 32 && Number(img.width) > 0 && Number(img.height) > 0,
  );

  // Pair up to 2 charts per landscape-friendly visual appendix page (vertical stack on Letter 612x792)
  const imagePages = [];
  for (let i = 0; i < validImages.length; i += 2) {
    imagePages.push(validImages.slice(i, i + 2));
  }

  // Object IDs: 1 = Catalog, 2 = Pages, 3 = Font Helvetica
  const objChunks = []; // array of Uint8Array, index 0 => obj 1
  const pageObjIds = [];

  // Placeholder slots 0, 1, 2
  objChunks.push(encodeAscii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));
  objChunks.push(null); // obj 2 filled after all pages allocated
  objChunks.push(encodeAscii('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'));

  let nextId = 4;

  // Text pages
  for (const pageLines of textPages) {
    const pageId = nextId++;
    const contentId = nextId++;
    pageObjIds.push(pageId);

    const ops = ['BT', '/F1 11 Tf', '15 TL', '54 756 Td'];
    pageLines.forEach((ln, lineIdx) => {
      if (lineIdx > 0) ops.push('T*');
      ops.push(`(${pdfEscape(ln)}) Tj`);
    });
    ops.push('ET');
    const streamStr = ops.join('\n');

    objChunks.push(encodeAscii(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    ));
    objChunks.push(encodeAscii(
      `${contentId} 0 obj\n<< /Length ${streamStr.length} >>\nstream\n${streamStr}\nendstream\nendobj\n`,
    ));
  }

  // Visual Chart Appendix Pages (2 charts per page max)
  imagePages.forEach((pair, pageIdx) => {
    const pageId = nextId++;
    const contentId = nextId++;
    pageObjIds.push(pageId);

    const imgEntries = pair.map((img, k) => ({
      img,
      name: `Im${k + 1}`,
      objId: nextId++,
    }));

    const xObjRefs = imgEntries.map((e) => `/${e.name} ${e.objId} 0 R`).join(' ');
    const ops = [
      'BT',
      '/F1 13 Tf',
      '54 756 Td',
      `(${pdfEscape(`${title || 'Interactive Lab Report'} - Visual Chart Evidence (Page ${pageIdx + 1})`)}) Tj`,
      'ET',
    ];

    const slotTops = [720, 385];
    const maxW = 504; // 612 - 108 margins
    const maxH = 285;

    imgEntries.forEach((entry, k) => {
      const slotTop = slotTops[k] ?? 385;
      const caption = entry.img.caption || `Chart ${pageIdx * 2 + k + 1}`;
      ops.push('BT', '/F1 10 Tf', `54 ${slotTop} Td`, `(${pdfEscape(caption)}) Tj`, 'ET');

      const scale = Math.min(maxW / entry.img.width, maxH / entry.img.height);
      const drawW = Math.max(40, Math.round(entry.img.width * scale));
      const drawH = Math.max(30, Math.round(entry.img.height * scale));
      const drawX = Math.round(54 + (maxW - drawW) / 2);
      const drawY = Math.round(slotTop - 16 - drawH);

      ops.push('q', `${drawW} 0 0 ${drawH} ${drawX} ${drawY} cm`, `/${entry.name} Do`, 'Q');
    });

    const streamStr = ops.join('\n');
    objChunks.push(encodeAscii(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << ${xObjRefs} >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    ));
    objChunks.push(encodeAscii(
      `${contentId} 0 obj\n<< /Length ${streamStr.length} >>\nstream\n${streamStr}\nendstream\nendobj\n`,
    ));

    for (const entry of imgEntries) {
      const header = encodeAscii(
        `${entry.objId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${Math.round(entry.img.width)} /Height ${Math.round(entry.img.height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${entry.img.jpegBytes.length} >>\nstream\n`,
      );
      const footer = encodeAscii('\nendstream\nendobj\n');
      objChunks.push(concatBytes([header, entry.img.jpegBytes, footer]));
    }
  });

  objChunks[1] = encodeAscii(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>\nendobj\n`,
  );

  const headerBytes = encodeAscii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const parts = [headerBytes];
  const offsets = [0];
  let curLen = headerBytes.length;

  for (const chunk of objChunks) {
    offsets.push(curLen);
    parts.push(chunk);
    curLen += chunk.length;
  }

  const xrefOffset = curLen;
  let trailer = `xref\n0 ${objChunks.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objChunks.length; i++) {
    trailer += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  trailer += `trailer\n<< /Size ${objChunks.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(encodeAscii(trailer));

  return new Blob([concatBytes(parts)], { type: 'application/pdf' });
}
