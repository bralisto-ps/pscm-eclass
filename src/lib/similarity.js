// Client-side academic integrity / collusion detector for typed responses, PDFs, DOCX, and TXT files.
// Pure comparison functions are exported separately so they can run on already-extracted texts
// without network requests and be unit-tested cleanly.

function stripViewOnly(storedPath) {
  return String(storedPath || '').replace(/^viewonly:/, '');
}

export function normalizeTextForSimilarity(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeWords(raw) {
  const norm = normalizeTextForSimilarity(raw);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

export function buildShingles(words, k = 5, excludeSet = null) {
  const out = [];
  if (!Array.isArray(words) || words.length < k) return out;
  for (let i = 0; i <= words.length - k; i++) {
    const sh = words.slice(i, i + k).join(' ');
    if (excludeSet && excludeSet.has(sh)) continue;
    out.push({ sh, idx: i });
  }
  return out;
}

export function buildBoilerplateSet(boilerplateText) {
  const words = tokenizeWords(boilerplateText);
  const set = new Set();
  for (const k of [3, 5]) {
    for (let i = 0; i <= words.length - k; i++) {
      set.add(words.slice(i, i + k).join(' '));
    }
  }
  return set;
}

function reconstructMatchedPassages(wordsA, sharedShinglesSet, k) {
  if (!sharedShinglesSet.size || wordsA.length < k) return [];
  const covered = new Array(wordsA.length).fill(false);
  for (let i = 0; i <= wordsA.length - k; i++) {
    const sh = wordsA.slice(i, i + k).join(' ');
    if (sharedShinglesSet.has(sh)) {
      for (let j = i; j < i + k; j++) covered[j] = true;
    }
  }
  const passages = [];
  let start = -1;
  for (let i = 0; i <= covered.length; i++) {
    if (i < covered.length && covered[i]) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start >= k) {
        passages.push(wordsA.slice(start, i).join(' '));
      }
      start = -1;
    }
  }
  // Deduplicate and return longest distinct excerpts
  const uniq = [];
  const seen = new Set();
  for (const p of passages.sort((x, y) => y.length - x.length)) {
    if (seen.has(p)) continue;
    seen.add(p);
    uniq.push(p.length > 260 ? `${p.slice(0, 257)}…` : p);
    if (uniq.length >= 6) break;
  }
  return uniq;
}

/**
 * Compares extracted submission texts and returns flagged pairs sorted by similarity descending.
 * docs: [{ id, indexNo, fullName, syndicateId, syndicateName, text, fileName }]
 */
export function compareSubmissionTexts(docs, options = {}) {
  const thresholdPct = Math.max(10, Math.min(95, Number(options.thresholdPct) || 45));
  const boilerplateSet = options.boilerplateText ? buildBoilerplateSet(options.boilerplateText) : new Set();

  const prepared = (docs || []).map((d) => {
    const words = tokenizeWords(d.text);
    const k = words.length < 45 ? 3 : 5;
    const shingles = buildShingles(words, k, boilerplateSet);
    const shingleSet = new Set(shingles.map((x) => x.sh));
    // Also keep 3-word set if k === 5 so short vs long papers still compare reliably
    const shingleSet3 = k === 3 ? shingleSet : new Set(buildShingles(words, 3, boilerplateSet).map((x) => x.sh));
    return {
      ...d,
      words,
      wordCount: words.length,
      k,
      shingleSet,
      shingleSet3,
      tooShort: words.length < 12 || shingleSet3.size < 5,
    };
  });

  const pairs = [];
  for (let i = 0; i < prepared.length; i++) {
    const a = prepared[i];
    if (a.tooShort) continue;
    for (let j = i + 1; j < prepared.length; j++) {
      const b = prepared[j];
      if (b.tooShort) continue;
      if (a.indexNo && b.indexNo && a.indexNo === b.indexNo) continue;
      if (a.syndicateId && b.syndicateId && a.syndicateId === b.syndicateId) continue;

      const use3 = a.k === 3 || b.k === 3;
      const setA = use3 ? a.shingleSet3 : a.shingleSet;
      const setB = use3 ? b.shingleSet3 : b.shingleSet;
      if (!setA.size || !setB.size) continue;

      const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
      const shared = new Set();
      for (const sh of smaller) {
        if (larger.has(sh)) shared.add(sh);
      }
      if (shared.size === 0) continue;

      const unionSize = setA.size + setB.size - shared.size;
      const jaccardPct = Math.round((shared.size / unionSize) * 100);
      const containmentPct = Math.round((shared.size / smaller.size) * 100);
      // Balanced score emphasizes containment when one text is embedded in another without inflating noise
      const scorePct = Math.min(100, Math.round(Math.max(jaccardPct, containmentPct * 0.9)));

      if (scorePct >= thresholdPct) {
        const snippets = reconstructMatchedPassages(a.words, shared, use3 ? 3 : 5);
        pairs.push({
          id: `${a.id}::${b.id}`,
          a: {
            id: a.id,
            indexNo: a.indexNo,
            fullName: a.fullName,
            syndicateName: a.syndicateName,
            wordCount: a.wordCount,
            fileName: a.fileName,
            text: a.text,
          },
          b: {
            id: b.id,
            indexNo: b.indexNo,
            fullName: b.fullName,
            syndicateName: b.syndicateName,
            wordCount: b.wordCount,
            fileName: b.fileName,
            text: b.text,
          },
          scorePct,
          jaccardPct,
          containmentPct,
          sharedCount: shared.size,
          snippets,
        });
      }
    }
  }

  pairs.sort((x, y) => y.scorePct - x.scorePct || y.sharedCount - x.sharedCount);
  return {
    checkedCount: prepared.filter((d) => !d.tooShort).length,
    skippedShortCount: prepared.filter((d) => d.tooShort).length,
    pairs,
  };
}

let cachedPdfjs = null;
async function getPdfJs() {
  if (cachedPdfjs) return cachedPdfjs;
  const [pdfjs, workerMod] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
  cachedPdfjs = pdfjs;
  return pdfjs;
}

async function extractPdfTextFromBuffer(arrayBuffer) {
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const doc = await loadingTask.promise;
  try {
    const maxPages = Math.min(doc.numPages || 0, 45);
    const chunks = [];
    for (let p = 1; p <= maxPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const pageStr = (tc.items || []).map((item) => item.str || '').join(' ');
      if (pageStr.trim()) chunks.push(pageStr);
    }
    return chunks.join('\n');
  } finally {
    await doc.destroy?.().catch(() => {});
  }
}

async function extractDocxTextFromBuffer(arrayBuffer) {
  const mod = await import('mammoth');
  const mammoth = mod.default || mod;
  const res = await mammoth.extractRawText({ arrayBuffer });
  return res?.value || '';
}

export async function extractTextFromFileUrl(signedUrl, fileName) {
  const ext = String(fileName || '').split('.').pop()?.toLowerCase() || '';
  if (!['pdf', 'docx', 'txt', 'md', 'csv'].includes(ext)) {
    return { text: '', unsupported: true, reason: `.${ext || 'file'} not supported for auto-text extraction` };
  }
  const resp = await fetch(signedUrl);
  if (!resp.ok) throw new Error(`Could not fetch file (${resp.status})`);
  if (ext === 'txt' || ext === 'md' || ext === 'csv') {
    return { text: await resp.text(), unsupported: false };
  }
  const buf = await resp.arrayBuffer();
  if (ext === 'pdf') {
    return { text: await extractPdfTextFromBuffer(buf), unsupported: false };
  }
  if (ext === 'docx') {
    return { text: await extractDocxTextFromBuffer(buf), unsupported: false };
  }
  return { text: '', unsupported: true };
}

export async function extractTextFromLocalFile(file) {
  if (!file) return { text: '', unsupported: true, reason: 'No file selected' };
  const ext = String(file.name || '').split('.').pop()?.toLowerCase() || '';
  if (!['pdf', 'docx', 'txt', 'md', 'csv'].includes(ext)) {
    return { text: '', unsupported: true, reason: `.${ext || "file"} is not supported. Use .docx, text-based .pdf, or .txt.` };
  }
  if (ext === 'txt' || ext === 'md' || ext === 'csv') {
    return { text: await file.text(), unsupported: false };
  }
  const buf = await file.arrayBuffer();
  if (ext === 'pdf') {
    return { text: await extractPdfTextFromBuffer(buf), unsupported: false };
  }
  if (ext === 'docx') {
    return { text: await extractDocxTextFromBuffer(buf), unsupported: false };
  }
  return { text: '', unsupported: true };
}

/**
 * Extracts text across assignment rows in batches of 4.
 * Automatically deduplicates syndicate members so each syndicate is extracted & checked once.
 */
export async function extractAssignmentTexts(rows, getSignedUrl, onProgress) {
  const seenSyndicates = new Set();
  const seenFilePaths = new Set();
  const targets = [];

  for (const r of rows || []) {
    const sub = r.sub || r._synLeaderSub;
    if (!sub) continue;
    if (sub.file_path === 'presentation:in-class') continue;
    if (r._syn?.id) {
      if (seenSyndicates.has(r._syn.id)) continue;
      seenSyndicates.add(r._syn.id);
    } else if (sub.file_path && sub.file_path !== 'typed:online') {
      const cleanPath = stripViewOnly(sub.file_path);
      if (seenFilePaths.has(cleanPath)) continue;
      seenFilePaths.add(cleanPath);
    }
    targets.push({ r, sub });
  }

  const docs = [];
  const skipped = [];
  let done = 0;
  onProgress?.({ done: 0, total: targets.length });

  const CONCURRENCY = 4;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const slice = targets.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async ({ r, sub }) => {
      try {
        const parts = [];
        if (sub.response_text && sub.response_text.trim()) {
          parts.push(sub.response_text.trim());
        }
        const hasUpload = sub.file_path && sub.file_path !== 'typed:online' && sub.file_path !== 'presentation:in-class';
        if (hasUpload) {
          const url = await getSignedUrl('submissions', sub.file_path);
          const extRes = await extractTextFromFileUrl(url, sub.file_name || sub.file_path);
          if (extRes.text?.trim()) parts.push(extRes.text.trim());
          else if (extRes.unsupported && parts.length === 0) {
            skipped.push({
              name: r._syn ? r._syn.name : r.full_name,
              fileName: sub.file_name,
              reason: extRes.reason,
            });
          }
        }
        const combined = parts.join('\n\n').trim();
        if (combined) {
          docs.push({
            id: sub.id || r.index_no,
            indexNo: r.index_no,
            fullName: r.full_name,
            syndicateId: r._syn?.id || null,
            syndicateName: r._syn?.name || '',
            fileName: sub.file_name || 'Typed online',
            text: combined,
          });
        }
      } catch (err) {
        skipped.push({
          name: r._syn ? r._syn.name : r.full_name,
          fileName: sub.file_name,
          reason: err.message || 'Extraction error',
        });
      } finally {
        done += 1;
        onProgress?.({ done, total: targets.length });
      }
    }));
  }

  return { docs, skipped, totalTargets: targets.length };
}


/**
 * Compares current assignment submissions against past-semester archived submissions.
 * archiveItems: [{ id, index_no, full_name, course_code, semester, title, text }]
 */
export function compareArchiveTexts(currentDocs, archiveItems, options = {}) {
  const thresholdPct = Math.max(10, Math.min(95, Number(options.thresholdPct) || 45));
  const boilerplateSet = options.boilerplateText ? buildBoilerplateSet(options.boilerplateText) : new Set();

  const prep = (text) => {
    const words = tokenizeWords(text);
    const k = words.length < 45 ? 3 : 5;
    const shingleSet = new Set(buildShingles(words, k, boilerplateSet).map((x) => x.sh));
    const shingleSet3 = k === 3 ? shingleSet : new Set(buildShingles(words, 3, boilerplateSet).map((x) => x.sh));
    return { words, wordCount: words.length, k, shingleSet, shingleSet3, tooShort: words.length < 12 || shingleSet3.size < 5 };
  };

  const curPrep = (currentDocs || []).map((d) => ({ ...d, ...prep(d.text) })).filter((d) => !d.tooShort);
  const arcPrep = (archiveItems || []).map((d) => ({ ...d, ...prep(d.text) })).filter((d) => !d.tooShort);
  const matches = [];

  for (const a of curPrep) {
    for (const b of arcPrep) {
      const use3 = a.k === 3 || b.k === 3;
      const setA = use3 ? a.shingleSet3 : a.shingleSet;
      const setB = use3 ? b.shingleSet3 : b.shingleSet;
      if (!setA.size || !setB.size) continue;
      const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
      const shared = new Set();
      for (const sh of smaller) {
        if (larger.has(sh)) shared.add(sh);
      }
      if (shared.size === 0) continue;
      const unionSize = setA.size + setB.size - shared.size;
      const jaccardPct = Math.round((shared.size / unionSize) * 100);
      const containmentPct = Math.round((shared.size / smaller.size) * 100);
      const scorePct = Math.min(100, Math.round(Math.max(jaccardPct, containmentPct * 0.9)));
      if (scorePct >= thresholdPct) {
        matches.push({
          id: `arc:${a.id}::${b.id}`,
          current: {
            id: a.id,
            indexNo: a.indexNo,
            fullName: a.fullName,
            syndicateName: a.syndicateName,
            wordCount: a.wordCount,
            fileName: a.fileName,
            text: a.text,
          },
          archive: {
            id: b.id,
            indexNo: b.index_no || b.indexNo,
            fullName: b.full_name || b.fullName,
            courseCode: b.course_code || b.courseCode || "",
            semester: b.semester || "",
            title: b.title || "Past assignment",
            wordCount: b.wordCount,
            text: b.text,
          },
          scorePct,
          jaccardPct,
          containmentPct,
          sharedCount: shared.size,
          snippets: reconstructMatchedPassages(a.words, shared, use3 ? 3 : 5),
        });
      }
    }
  }
  matches.sort((x, y) => y.scorePct - x.scorePct || y.sharedCount - x.sharedCount);
  return { checkedArchiveCount: arcPrep.length, matches };
}
