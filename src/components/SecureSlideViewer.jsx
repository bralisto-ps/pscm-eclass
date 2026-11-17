import { useEffect, useRef, useState } from 'react';
import { getSignedFileUrl } from '../lib/files.js';
import Icon from './Icon.jsx';

export default function SecureSlideViewer({ material, bucket = 'materials', watermarkText, courseCode, onAskSlide, onClose }) {
  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const renderTaskRef = useRef(null);

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.25);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');

  // "Ask about this slide" drawer state
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [sending, setSending] = useState(false);
  const [askErr, setAskErr] = useState('');

  // Prevent body scroll & block Save/Print/Copy shortcuts while open
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => {
      if (askOpen) {
        if (e.key === 'Escape') setAskOpen(false);
        return;
      }
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'c', 'a', 'u'].includes(String(e.key).toLowerCase())) {
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        setPage((p) => (numPages ? Math.min(numPages, p + 1) : p));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setPage((p) => Math.max(1, p - 1));
      }
    };

    const block = (e) => {
      if (askOpen) return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('copy', block);
    document.addEventListener('cut', block);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('copy', block);
      document.removeEventListener('cut', block);
    };
  }, [numPages, onClose, askOpen]);

  // Dynamically load pdfjs-dist + fetch PDF bytes into memory
  useEffect(() => {
    let alive = true;
    let doc = null;

    async function loadPdf() {
      setLoading(true);
      setError('');
      try {
        const [pdfjs, workerMod, signedUrl] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
          getSignedFileUrl(material.bucket || bucket, material.storage_path),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;

        const res = await fetch(signedUrl);
        if (!res.ok) throw new Error(`Could not load document (${res.status}).`);
        const bytes = await res.arrayBuffer();
        if (!alive) return;

        doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (!alive) {
          doc.destroy?.();
          return;
        }
        pdfRef.current = doc;
        setNumPages(doc.numPages);
        setPage(1);
        setLoading(false);
      } catch (e) {
        if (alive) {
          setError(e.message || 'Could not open this read-only document.');
          setLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      alive = false;
      try {
        renderTaskRef.current?.cancel?.();
      } catch {
        // ignore
      }
      try {
        doc?.destroy?.();
      } catch {
        // ignore
      }
      pdfRef.current = null;
    };
  }, [material.storage_path]);

  // Render active page + bake diagonal student watermark onto canvas pixels
  useEffect(() => {
    const doc = pdfRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || !page || loading) return;

    let cancelled = false;
    async function renderPage() {
      setRendering(true);
      try {
        try {
          renderTaskRef.current?.cancel?.();
        } catch {
          // ignore
        }
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;

        const viewport = pdfPage.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, viewport.width, viewport.height);

        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;

        // Bake subtle repeating student watermark into canvas pixels
        const label = `${watermarkText || 'PSCM E-class'} · READ-ONLY`;
        ctx.save();
        ctx.globalAlpha = 0.11;
        ctx.fillStyle = '#0f172a';
        ctx.font = '600 13px "IBM Plex Mono", monospace';
        ctx.rotate(-0.42);
        const stepX = 320;
        const stepY = 170;
        for (let y = -viewport.height; y < viewport.height * 2; y += stepY) {
          for (let x = -viewport.width; x < viewport.width * 2; x += stepX) {
            ctx.fillText(label, x, y);
          }
        }
        ctx.restore();
      } catch (e) {
        if (!cancelled && e?.name !== 'RenderingCancelledException') {
          setError(e.message || 'Could not render slide.');
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    }

    renderPage();
    return () => {
      cancelled = true;
    };
  }, [page, scale, loading, watermarkText]);

  async function submitQuestion(e) {
    e?.preventDefault();
    if (!onAskSlide || question.trim().length < 3 || sending) return;
    setSending(true);
    setAskErr('');
    try {
      await onAskSlide(page, question.trim(), anonymous);
      setQuestion('');
      setAskOpen(false);
    } catch (err) {
      setAskErr(err.message || 'Could not post question.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="secure-reader-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Read-only viewer: ${material.title}`}
      onContextMenu={(e) => {
        if (!askOpen) e.preventDefault();
      }}
      onDragStart={(e) => e.preventDefault()}
    >
      <header className="secure-reader-bar">
        <div className="row" style={{ minWidth: 0, gap: 10 }}>
          <Icon name="lock" size={16} style={{ color: '#5eead4', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {material.title}
            </div>
            <div className="tiny" style={{ color: '#94a3b8' }}>
              Read-only viewer · download, copy, and print disabled
            </div>
          </div>
        </div>

        <div className="row-wrap" style={{ gap: 8 }}>
          {numPages > 0 && (
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="icon-btn-dark"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous slide"
              >
                <Icon name="chevronLeft" size={18} />
              </button>
              <span className="mono small" style={{ minWidth: 74, textAlign: 'center', color: '#e2e8f0' }}>
                {page} / {numPages}
              </span>
              <button
                type="button"
                className="icon-btn-dark"
                onClick={() => setPage((p) => Math.min(numPages, p + 1))}
                disabled={page >= numPages}
                aria-label="Next slide"
              >
                <Icon name="chevronRight" size={18} />
              </button>
            </div>
          )}

          <div className="row hide-sm" style={{ gap: 4 }}>
            <button
              type="button"
              className="icon-btn-dark"
              onClick={() => setScale((s) => Math.max(0.7, Number((s - 0.2).toFixed(2))))}
              aria-label="Zoom out"
              title="Zoom out"
            >
              −
            </button>
            <span className="mono tiny" style={{ color: '#cbd5e1', minWidth: 42, textAlign: 'center' }}>
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className="icon-btn-dark"
              onClick={() => setScale((s) => Math.min(2.2, Number((s + 0.2).toFixed(2))))}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
          </div>

          {onAskSlide && !loading && !error && (
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: '#0d9488', color: '#fff', borderColor: '#0d9488' }}
              onClick={() => {
                setAskErr('');
                setAskOpen(true);
              }}
            >
              <Icon name="chat" size={15} /> Ask about slide {page}
            </button>
          )}

          <button type="button" className="icon-btn-dark" onClick={onClose} aria-label="Close reader">
            <Icon name="close" size={20} />
          </button>
        </div>
      </header>

      <div className="secure-reader-stage">
        {loading && (
          <div className="stack" style={{ alignItems: 'center', color: '#cbd5e1', padding: 48 }}>
            <div className="spinner" />
            <span className="small">Preparing protected slides…</span>
          </div>
        )}
        {error && (
          <div className="notice notice-error" style={{ maxWidth: 460 }}>
            {error}
          </div>
        )}
        {!loading && !error && (
          <div className="secure-canvas-wrap" style={{ opacity: rendering ? 0.78 : 1 }}>
            <canvas ref={canvasRef} className="secure-canvas" />
          </div>
        )}
      </div>

      {numPages > 1 && (
        <footer className="secure-reader-foot">
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: 'rgba(255,255,255,0.2)' }}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            <Icon name="chevronLeft" size={16} /> Previous
          </button>
          <input
            type="range"
            min={1}
            max={numPages}
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
            aria-label="Slide scrubber"
            style={{ flex: 1, maxWidth: 340, accentColor: '#2dd4bf' }}
          />
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: 'rgba(255,255,255,0.2)' }}
            onClick={() => setPage((p) => Math.min(numPages, p + 1))}
            disabled={page >= numPages}
          >
            Next <Icon name="chevronRight" size={16} />
          </button>
        </footer>
      )}

      {askOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 95,
            background: 'rgba(9, 14, 23, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !sending) setAskOpen(false);
          }}
        >
          <form
            onSubmit={submitQuestion}
            className="card stack"
            style={{
              width: '100%',
              maxWidth: 480,
              userSelect: 'text',
              WebkitUserSelect: 'text',
            }}
          >
            <div className="between">
              <div>
                <span className="eyebrow" style={{ color: 'var(--teal-dark)' }}>
                  {courseCode ? `${courseCode} · ` : ''}Course Q&amp;A
                </span>
                <h2 style={{ marginTop: 2 }}>Ask about Slide {page}</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close question box"
                onClick={() => !sending && setAskOpen(false)}
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="notice notice-info small" style={{ padding: '8px 12px' }}>
              Tagged automatically with <strong>[{material.title} · Slide {page}]</strong> so your lecturer and classmates know which slide you mean.
            </div>

            {askErr && <div className="notice notice-error small">{askErr}</div>}

            <textarea
              className="textarea"
              style={{ minHeight: 110 }}
              maxLength={1800}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`What part of Slide ${page} would you like clarified?`}
              autoFocus
            />

            <label className="check small">
              <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              Hide my name from classmates (lecturer can always see who asked)
            </label>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn" onClick={() => setAskOpen(false)} disabled={sending}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={sending || question.trim().length < 3}>
                {sending ? 'Posting…' : 'Post to Q&A'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
