import { useEffect, useRef, useState } from 'react';
import { getSignedFileUrl } from '../lib/files.js';
import { supabase } from '../lib/supabase.js';
import Icon from './Icon.jsx';
import { Loading, useToast } from './ui.jsx';

export default function LiveSlideSyncModal({
  course,
  material,
  isPresenter = false,
  initialPage = 1,
  onClose,
}) {
  const toast = useToast();
  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const renderTaskRef = useRef(null);
  const channelRef = useRef(null);
  const followingRef = useRef(true);
  const pageRef = useRef(initialPage || 1);
  const numPagesRef = useRef(1);
  const promptRef = useRef('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(initialPage || 1);
  const [numPages, setNumPages] = useState(1);
  const [following, setFollowing] = useState(true);
  const [presenterPage, setPresenterPage] = useState(initialPage || 1);
  const [prompt, setPrompt] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [viewers, setViewers] = useState(0);
  const [pulse, setPulse] = useState({ got_it: 0, recap: 0 });
  const [myPulse, setMyPulse] = useState('');

  followingRef.current = following;
  pageRef.current = page;
  numPagesRef.current = numPages;
  promptRef.current = prompt;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    async function load() {
      try {
        const [pdfjs, workerMod, url] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
          getSignedFileUrl('materials', material.storage_path),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not load slides (${res.status}).`);
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
          setError(e.message || 'Could not load slide deck.');
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
  }, [material.storage_path]);

  useEffect(() => {
    let alive = true;
    async function render() {
      const doc = pdfRef.current;
      const canvas = canvasRef.current;
      if (!doc || !canvas || loading) return;
      try { renderTaskRef.current?.cancel?.(); } catch { /* ignore */ }
      try {
        const p = await doc.getPage(Math.min(numPages, Math.max(1, page)));
        if (!alive) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const vp = p.getViewport({ scale: 1.35 });
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = '100%';
        canvas.style.maxWidth = `${Math.floor(vp.width)}px`;
        canvas.style.height = 'auto';
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const task = p.render({ canvasContext: ctx, viewport: vp });
        renderTaskRef.current = task;
        await task.promise;
      } catch (e) {
        if (alive && e?.name !== 'RenderingCancelledException') {
          setError(e?.message || 'Failed to render slide.');
        }
      }
    }
    render();
    return () => { alive = false; };
  }, [page, numPages, loading]);

  useEffect(() => {
    let alive = true;
    let ch = null;
    const topic = `live-slides:${course.id}`;

    async function connect() {
      try {
        const existing = supabase.getChannels?.().find((c) => c.topic === `realtime:${topic}`);
        if (existing) {
          await supabase.removeChannel(existing).catch(() => {});
          try { existing.teardown?.(); } catch { /* ignore */ }
        }
        if (!alive) return;

        ch = supabase.channel(topic, {
          config: { presence: { key: isPresenter ? 'presenter' : `s_${Math.random().toString(36).slice(2, 8)}` } },
        });
        channelRef.current = ch;

        ch.on('broadcast', { event: 'slide_state' }, ({ payload }) => {
          if (!payload || isPresenter) return;
          if (payload.ended) {
            toast('Live slide session ended.');
            onClose();
            return;
          }
          if (payload.page) {
            setPresenterPage(payload.page);
            if (followingRef.current) setPage(payload.page);
          }
          if (payload.prompt !== undefined) setPrompt(payload.prompt || '');
          if (payload.resetPulse) setMyPulse('');
        });

        ch.on('broadcast', { event: 'student_pulse' }, ({ payload }) => {
          if (!isPresenter || !payload) return;
          setPulse((prev) => ({
            got_it: prev.got_it + (payload.vote === 'got_it' ? 1 : 0),
            recap: prev.recap + (payload.vote === 'recap' ? 1 : 0),
          }));
        });

        ch.on('presence', { event: 'sync' }, () => {
          if (!ch) return;
          const state = ch.presenceState();
          const count = Object.keys(state || {}).filter((k) => k !== 'presenter').length;
          setViewers(count);
          if (isPresenter) {
            ch.send({
              type: 'broadcast',
              event: 'slide_state',
              payload: {
                materialId: material.id,
                title: material.title,
                storage_path: material.storage_path,
                page: pageRef.current,
                numPages: numPagesRef.current,
                prompt: promptRef.current,
              },
            }).catch(() => {});
          }
        });

        ch.subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && alive && ch) {
            const presenceData = isPresenter
              ? { role: 'presenter', materialId: material.id, title: material.title, page: pageRef.current, numPages: numPagesRef.current, at: Date.now() }
              : { role: 'student', at: Date.now() };
            await ch.track(presenceData).catch(() => {});
            if (isPresenter) {
              ch.send({
                type: 'broadcast',
                event: 'slide_state',
                payload: {
                  materialId: material.id,
                  title: material.title,
                  storage_path: material.storage_path,
                  page: pageRef.current,
                  numPages: numPagesRef.current,
                  prompt: promptRef.current,
                },
              }).catch(() => {});
            }
          }
        });
      } catch {
        // Ignore transient realtime setup errors
      }
    }

    connect();

    return () => {
      alive = false;
      if (ch) {
        if (isPresenter) {
          ch.send({ type: 'broadcast', event: 'slide_state', payload: { ended: true } }).catch(() => {});
        }
        supabase.removeChannel(ch).catch(() => {});
        try { ch.teardown?.(); } catch { /* ignore */ }
      }
      channelRef.current = null;
    };
  }, [course.id, isPresenter, material.id, material.title, material.storage_path]);

  useEffect(() => {
    if (!isPresenter || !channelRef.current) return;
    setPulse({ got_it: 0, recap: 0 });
    channelRef.current.track?.({
      role: 'presenter',
      materialId: material.id,
      title: material.title,
      page,
      numPages,
      at: Date.now(),
    }).catch(() => {});
    channelRef.current.send({
      type: 'broadcast',
      event: 'slide_state',
      payload: {
        materialId: material.id,
        title: material.title,
        storage_path: material.storage_path,
        page,
        numPages,
        prompt,
        resetPulse: true,
      },
    }).catch(() => {});
  }, [page, numPages, isPresenter, material.id, material.title, material.storage_path, prompt]);

  function sendPulse(vote) {
    if (myPulse === vote) return;
    setMyPulse(vote);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'student_pulse',
      payload: { vote },
    }).catch(() => {});
  }

  function broadcastPrompt() {
    setPulse({ got_it: 0, recap: 0 });
    setPrompt(draftPrompt.trim());
    channelRef.current?.send({
      type: 'broadcast',
      event: 'slide_state',
      payload: {
        materialId: material.id,
        title: material.title,
        storage_path: material.storage_path,
        page,
        numPages,
        prompt: draftPrompt.trim(),
        resetPulse: true,
      },
    }).catch(() => {});
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Live class slides">
      <div className="modal" style={{ maxWidth: 980, width: '95vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div className="stack-sm" style={{ gap: 2 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="badge badge-teal">LIVE SLIDE SYNC</span>
              <h3 style={{ margin: 0 }}>{material.title}</h3>
            </div>
            <span className="tiny muted">
              {isPresenter
                ? `${viewers} student${viewers === 1 ? '' : 's'} connected · Slide ${page} of ${numPages}`
                : `Presenter on Slide ${presenterPage} · Viewing Slide ${page} of ${numPages}`}
            </span>
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            {!isPresenter && (
              <button
                type="button"
                className={`btn btn-sm ${following ? 'btn-primary' : ''}`}
                onClick={() => {
                  const next = !following;
                  setFollowing(next);
                  if (next) setPage(presenterPage);
                }}
              >
                {following ? 'Following lecturer' : `Jump to Slide ${presenterPage}`}
              </button>
            )}
            <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => { if (!isPresenter) setFollowing(false); setPage((p) => Math.max(1, p - 1)); }}>Prev</button>
            <span className="mono small">{page} / {numPages}</span>
            <button type="button" className="btn btn-sm" disabled={page >= numPages} onClick={() => { if (!isPresenter) setFollowing(false); setPage((p) => Math.min(numPages, p + 1)); }}>Next</button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: 'var(--surface-2)', borderRadius: 10, textAlign: 'center' }}>
          {loading && <Loading label="Preparing live slides…" />}
          {error && <div className="notice notice-error">{error}</div>}
          {!loading && !error && <canvas ref={canvasRef} style={{ borderRadius: 8, boxShadow: 'var(--shadow)' }} />}
        </div>

        {isPresenter ? (
          <div className="between" style={{ marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
            <div className="row-wrap" style={{ gap: 8, flex: 1 }}>
              <input
                className="input"
                style={{ maxWidth: 340, minHeight: 38 }}
                placeholder="Optional quick check prompt for students…"
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
              />
              <button type="button" className="btn btn-sm btn-primary" onClick={broadcastPrompt}>
                Send check
              </button>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <span className="badge badge-teal mono">Got it: {pulse.got_it}</span>
              <span className="badge badge-amber mono">Need recap: {pulse.recap}</span>
            </div>
          </div>
        ) : (
          <div className="between" style={{ marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
            <div className="small">
              {prompt ? <strong>Check: {prompt}</strong> : <span className="muted">Let the lecturer know your pace on this slide:</span>}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className={`btn btn-sm ${myPulse === 'got_it' ? 'btn-primary' : ''}`}
                onClick={() => sendPulse('got_it')}
              >
                <Icon name="check" size={14} /> Got it
              </button>
              <button
                type="button"
                className={`btn btn-sm ${myPulse === 'recap' ? 'btn-danger' : ''}`}
                onClick={() => sendPulse('recap')}
              >
                <Icon name="flag" size={14} /> Need recap
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
