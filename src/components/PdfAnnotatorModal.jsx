import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSignedFileUrl } from '../lib/files.js';
import { rpc } from '../lib/supabase.js';
import Icon from './Icon.jsx';
import { Loading, useToast } from './ui.jsx';

const TAGS = [
  { id: 'comment', label: 'Comment', cls: 'badge-blue', color: '#2563eb' },
  { id: 'strength', label: 'Strength', cls: 'badge-teal', color: '#0f766e' },
  { id: 'correction', label: 'Correction', cls: 'badge-amber', color: '#d97706' },
  { id: 'deduction', label: 'Deduction', cls: 'badge-red', color: '#dc2626' },
];

export default function PdfAnnotatorModal({
  submissionId,
  filePath,
  fileName,
  studentLabel,
  initialAnnotations = [],
  snippets = [],
  readOnly = false,
  onSaved,
  onClose,
}) {
  const toast = useToast();
  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [numPages, setNumPages] = useState(1);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.25);
  const [annotations, setAnnotations] = useState(() =>
    Array.isArray(initialAnnotations) ? initialAnnotations : []
  );
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    async function load() {
      try {
        const [pdfjs, workerMod, url] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
          getSignedFileUrl('submissions', filePath),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not load PDF (${res.status}).`);
        const bytes = await res.arrayBuffer();
        if (!alive) return;
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (!alive) {
          doc.destroy?.();
          return;
        }
        pdfRef.current = doc;
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (e) {
        if (alive) {
          setError(e.message || 'Could not render submission PDF.');
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      alive = false;
      try { renderTaskRef.current?.cancel?.(); } catch { /* ignore */ }
      try { pdfRef.current?.destroy?.(); } catch { /* ignore */ }
      pdfRef.current = null;
    };
  }, [filePath]);

  const renderPage = useCallback(async () => {
    const doc = pdfRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || loading) return;
    try { renderTaskRef.current?.cancel?.(); } catch { /* ignore */ }
    try {
      const p = await doc.getPage(Math.min(numPages, Math.max(1, page)));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = p.getViewport({ scale });
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${Math.floor(vp.width)}px`;
      canvas.style.height = `${Math.floor(vp.height)}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const task = p.render({ canvasContext: ctx, viewport: vp });
      renderTaskRef.current = task;
      await task.promise;
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') {
        setError(e?.message || 'Failed to render PDF page.');
      }
    }
  }, [page, numPages, scale, loading]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  const pagePins = useMemo(
    () => annotations.filter((a) => Number(a.page) === Number(page)),
    [annotations, page]
  );

  function handleStageClick(e) {
    if (readOnly || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(2, Math.min(98, +(((e.clientX - rect.left) / rect.width) * 100).toFixed(2)));
    const y = Math.max(2, Math.min(98, +(((e.clientY - rect.top) / rect.height) * 100).toFixed(2)));
    const id = `pin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setDraft({ id, page, x, y, tag: 'comment', text: '', delta: '' });
    setSelectedId(id);
  }

  function commitDraft() {
    if (!draft || !draft.text.trim()) return;
    const clean = {
      ...draft,
      text: draft.text.trim(),
      delta: draft.delta === '' ? null : Number(draft.delta),
    };
    setAnnotations((prev) => {
      const exists = prev.some((x) => x.id === clean.id);
      return exists ? prev.map((x) => (x.id === clean.id ? clean : x)) : [...prev, clean];
    });
    setSelectedId(clean.id);
    setDraft(null);
  }

  function removePin(id) {
    setAnnotations((prev) => prev.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (draft?.id === id) setDraft(null);
  }

  async function saveAll() {
    if (readOnly) return;
    setSaving(true);
    try {
      const saved = await rpc('save_submission_annotations', {
        p_submission: submissionId,
        p_annotations: annotations,
      });
      toast(`Saved ${annotations.length} PDF annotation${annotations.length === 1 ? '' : 's'}.`);
      onSaved?.(Array.isArray(saved) ? saved : annotations);
      onClose();
    } catch (err) {
      toast(err.message || 'Could not save annotations.', 'error');
    } finally {
      setSaving(false);
    }
  }

  const tagInfo = (id) => TAGS.find((t) => t.id === id) || TAGS[0];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="PDF annotation studio">
      <div className="modal pdf-annotator-modal" style={{ maxWidth: 1120, width: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div className="stack-sm" style={{ gap: 2 }}>
            <h3 style={{ margin: 0 }}>{readOnly ? 'Annotated submission PDF' : 'Inline PDF Annotation Grading'}</h3>
            <span className="tiny muted">
              {studentLabel ? `${studentLabel} · ` : ''}{fileName || 'Submission PDF'} · {annotations.length} pin{annotations.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <span className="mono small" style={{ padding: '0 6px' }}>Page {page} / {numPages}</span>
            <button type="button" className="btn btn-sm" disabled={page >= numPages} onClick={() => setPage((p) => Math.min(numPages, p + 1))}>Next</button>
            <button type="button" className="btn btn-sm" onClick={() => setScale((s) => Math.max(0.75, +(s - 0.15).toFixed(2)))} aria-label="Zoom out">−</button>
            <span className="mono tiny">{Math.round(scale * 100)}%</span>
            <button type="button" className="btn btn-sm" onClick={() => setScale((s) => Math.min(2.2, +(s + 0.15).toFixed(2)))} aria-label="Zoom in">+</button>
            {!readOnly && (
              <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={saveAll}>
                {saving ? 'Saving…' : 'Save annotations'}
              </button>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </div>
        </div>

        <div className="pdf-annotator-body">
          <div className="pdf-annotator-canvas-wrap">
            {loading && <Loading label="Rendering PDF pages…" />}
            {error && <div className="notice notice-error">{error}</div>}
            {!loading && !error && (
              <div
                className={`pdf-stage ${readOnly ? '' : 'clickable'}`}
                onClick={handleStageClick}
                title={readOnly ? undefined : 'Click anywhere on the page to pin a comment'}
              >
                <canvas ref={canvasRef} style={{ display: 'block' }} />
                {pagePins.map((pin, idx) => {
                  const t = tagInfo(pin.tag);
                  const active = selectedId === pin.id;
                  return (
                    <button
                      key={pin.id}
                      type="button"
                      className={`pdf-pin-marker ${active ? 'active' : ''}`}
                      style={{
                        left: `${pin.x}%`,
                        top: `${pin.y}%`,
                        background: t.color,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(pin.id);
                        if (!readOnly) setDraft({ ...pin, delta: pin.delta ?? '' });
                      }}
                      title={pin.text}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
                {draft && draft.page === page && !annotations.some((x) => x.id === draft.id) && (
                  <span
                    className="pdf-pin-marker active"
                    style={{ left: `${draft.x}%`, top: `${draft.y}%`, background: tagInfo(draft.tag).color }}
                  >
                    +
                  </span>
                )}
              </div>
            )}
          </div>

          <aside className="pdf-annotator-side stack">
            {!readOnly && (
              <div className="notice notice-info tiny">
                Click anywhere on the PDF page to drop an inline comment pin or mark deduction.
              </div>
            )}

            {draft && !readOnly && (
              <div className="card stack-sm" style={{ padding: 12, borderColor: 'var(--teal)' }}>
                <strong className="small">Pin on Page {draft.page}</strong>
                <div className="row-wrap" style={{ gap: 6 }}>
                  {TAGS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`chip ${draft.tag === t.id ? 'active' : ''}`}
                      aria-pressed={draft.tag === t.id}
                      onClick={() => setDraft((d) => ({ ...d, tag: t.id }))}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="Write inline feedback at this spot…"
                  value={draft.text}
                  onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                  autoFocus
                />
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input mono"
                    type="number"
                    step="0.5"
                    placeholder="Mark +/- (opt.)"
                    style={{ minHeight: 34 }}
                    value={draft.delta}
                    onChange={(e) => setDraft((d) => ({ ...d, delta: e.target.value }))}
                  />
                </div>
                {snippets.length > 0 && (
                  <select
                    className="select"
                    style={{ minHeight: 34, fontSize: 12 }}
                    value=""
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val) setDraft((d) => ({ ...d, text: d.text ? `${d.text}\n${val}` : val }));
                    }}
                  >
                    <option value="">Insert quick snippet…</option>
                    {snippets.map((sn, i) => (
                      <option key={sn.id || i} value={sn.text}>{sn.title || sn.text.slice(0, 48)}</option>
                    ))}
                  </select>
                )}
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-sm" onClick={() => setDraft(null)}>Cancel</button>
                  <button type="button" className="btn btn-sm btn-primary" disabled={!draft.text.trim()} onClick={commitDraft}>
                    Pin note
                  </button>
                </div>
              </div>
            )}

            <div className="stack-sm">
              <strong className="small">All Annotations ({annotations.length})</strong>
              {annotations.length === 0 ? (
                <span className="tiny muted">No pins added yet.</span>
              ) : (
                <div className="stack-sm" style={{ maxHeight: 380, overflowY: 'auto' }}>
                  {annotations.map((pin, idx) => {
                    const t = tagInfo(pin.tag);
                    const active = selectedId === pin.id;
                    return (
                      <div
                        key={pin.id}
                        className="card stack-sm"
                        style={{
                          padding: 10,
                          borderColor: active ? 'var(--teal)' : 'var(--line)',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setPage(Number(pin.page) || 1);
                          setSelectedId(pin.id);
                          if (!readOnly) setDraft({ ...pin, delta: pin.delta ?? '' });
                        }}
                      >
                        <div className="between" style={{ gap: 6 }}>
                          <div className="row" style={{ gap: 6 }}>
                            <span className={`badge ${t.cls}`} style={{ fontSize: 11 }}>{t.label}</span>
                            <span className="mono tiny muted">#{idx + 1} · p.{pin.page}</span>
                            {pin.delta !== null && pin.delta !== undefined && pin.delta !== '' && (
                              <span className="mono tiny strong">{Number(pin.delta) > 0 ? `+${pin.delta}` : pin.delta}</span>
                            )}
                          </div>
                          {!readOnly && (
                            <button
                              type="button"
                              className="icon-btn plain"
                              aria-label="Delete pin"
                              onClick={(e) => {
                                e.stopPropagation();
                                removePin(pin.id);
                              }}
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          )}
                        </div>
                        <div className="small pre">{pin.text}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
