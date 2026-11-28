import { useEffect, useMemo, useState } from 'react';
import { getSignedFileUrl, openStoredFile } from '../lib/files.js';
import { buildTypedResponsePdfBlob } from '../lib/textPdf.js';
import { buildAnnotationFeedbackLines } from '../lib/thesisEngine.js';
import Icon from './Icon.jsx';
import { Loading, useToast } from './ui.jsx';

const TAGS = [
  { id: 'comment', label: 'Comment', cls: 'badge-blue', color: '#2563eb' },
  { id: 'strength', label: 'Strength', cls: 'badge-teal', color: '#0f766e' },
  { id: 'correction', label: 'Correction', cls: 'badge-amber', color: '#d97706' },
  { id: 'deduction', label: 'Major Revision', cls: 'badge-red', color: '#dc2626' },
];

export default function DocxAnnotatorModal({
  bucket = 'theses',
  filePath,
  fileName,
  reviewedFilePath,
  reviewedFileName,
  studentLabel,
  titleLabel,
  initialAnnotations = [],
  snippets = [],
  readOnly = false,
  allowStudentReplies = false,
  onSaveAnnotations,
  onReplyAnnotation,
  onSaved,
  onClose,
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paragraphs, setParagraphs] = useState([]);
  const [search, setSearch] = useState('');
  const [annotations, setAnnotations] = useState(() =>
    Array.isArray(initialAnnotations) ? initialAnnotations : []
  );
  const [selectedPara, setSelectedPara] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyBusyId, setReplyBusyId] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    async function load() {
      try {
        const [mammothMod, url] = await Promise.all([
          import('mammoth'),
          getSignedFileUrl(bucket, filePath),
        ]);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not load Word document (${res.status}).`);
        const arrayBuffer = await res.arrayBuffer();
        const mammoth = mammothMod.default || mammothMod;
        const result = await mammoth.extractRawText({ arrayBuffer });
        if (!alive) return;
        const paras = String(result?.value || '')
          .replace(/\r\n/g, '\n')
          .split(/\n+/)
          .map((p) => p.trim())
          .filter(Boolean);
        setParagraphs(paras);
        setLoading(false);
      } catch (e) {
        if (alive) {
          setError(e.message || 'Could not read Word (.docx) document. You can still download the original file.');
          setLoading(false);
        }
      }
    }
    load();
    return () => { alive = false; };
  }, [bucket, filePath]);

  const annsByPara = useMemo(() => {
    const map = {};
    for (const a of annotations) {
      const idx = Number(a.paraIndex ?? 0);
      if (!map[idx]) map[idx] = [];
      map[idx].push(a);
    }
    return map;
  }, [annotations]);

  const filteredIndexes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return paragraphs
      .map((text, idx) => ({ text, idx }))
      .filter((item) => !q || item.text.toLowerCase().includes(q));
  }, [paragraphs, search]);

  const tagInfo = (id) => TAGS.find((t) => t.id === id) || TAGS[0];

  function startCommentOnPara(idx) {
    setSelectedPara(idx);
    if (readOnly) return;
    const id = `docx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setDraft({ id, paraIndex: idx, page: idx + 1, tag: 'comment', text: '' });
  }

  function commitDraft() {
    if (!draft || !draft.text.trim()) return;
    const clean = { ...draft, text: draft.text.trim() };
    setAnnotations((prev) => {
      const exists = prev.some((x) => x.id === clean.id);
      return exists ? prev.map((x) => (x.id === clean.id ? clean : x)) : [...prev, clean];
    });
    setDraft(null);
  }

  function removePin(id) {
    setAnnotations((prev) => prev.filter((x) => x.id !== id));
    if (draft?.id === id) setDraft(null);
  }

  async function saveAll() {
    if (readOnly || !onSaveAnnotations) return;
    setSaving(true);
    try {
      const saved = await onSaveAnnotations(annotations);
      toast(`Saved ${annotations.length} paragraph comment${annotations.length === 1 ? '' : 's'} & notified student.`);
      onSaved?.(Array.isArray(saved) ? saved : annotations);
      onClose();
    } catch (e) {
      toast(e.message || 'Could not save comments.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function submitReply(pin, nextResolved) {
    if (!onReplyAnnotation) return;
    const replyText = (replyDrafts[pin.id] ?? pin.studentReply ?? '').trim();
    setReplyBusyId(pin.id);
    try {
      const updated = await onReplyAnnotation(pin.id, replyText, nextResolved);
      if (Array.isArray(updated)) setAnnotations(updated);
      else {
        setAnnotations((prev) =>
          prev.map((a) => (a.id === pin.id ? { ...a, studentReply: replyText, studentResolved: nextResolved } : a))
        );
      }
      toast(nextResolved ? 'Marked addressed & notified supervisor.' : 'Reply saved & supervisor notified.');
    } catch (e) {
      toast(e.message || 'Could not save reply.', 'error');
    } finally {
      setReplyBusyId(null);
    }
  }

  function exportCommentsPdf() {
    const lines = buildAnnotationFeedbackLines({
      title: titleLabel || 'Word Draft Paragraph Feedback',
      studentLabel,
      fileName,
      annotations,
    });
    const blob = buildTypedResponsePdfBlob({
      title: titleLabel || 'Word Draft Comments',
      studentLine: studentLabel || fileName || 'Document Review',
      submittedAt: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      body: lines.join('\n'),
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${String(fileName || 'draft').replace(/\.docx?$/i, '')}_comments.pdf`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Word document annotation studio">
      <div className="modal pdf-annotator-modal" style={{ maxWidth: 1140, width: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div className="stack-sm" style={{ gap: 2 }}>
            <h3 style={{ margin: 0 }}>
              {titleLabel || (readOnly ? 'Commented Word Draft (.docx)' : 'Word Draft Reader & Paragraph Annotator')}
            </h3>
            <span className="tiny muted">
              {studentLabel ? `${studentLabel} · ` : ''}{fileName || 'Draft.docx'} · {paragraphs.length} paragraphs · {annotations.length} comment{annotations.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm" onClick={() => openStoredFile(bucket, filePath).catch((e) => toast(e.message, 'error'))}>
              <Icon name="download" size={14} /> Original .docx
            </button>
            {reviewedFilePath && (
              <button type="button" className="btn btn-sm" onClick={() => openStoredFile(bucket, reviewedFilePath).catch((e) => toast(e.message, 'error'))}>
                <Icon name="download" size={14} /> Track-Changes Copy
              </button>
            )}
            {annotations.length > 0 && (
              <button type="button" className="btn btn-sm" onClick={exportCommentsPdf}>
                <Icon name="file" size={14} /> Comments PDF
              </button>
            )}
            {!readOnly && (
              <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={saveAll}>
                {saving ? 'Saving…' : 'Save & Notify'}
              </button>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </div>
        </div>

        <div className="pdf-annotator-body">
          <div className="pdf-annotator-canvas-wrap" style={{ padding: 18, background: 'var(--surface-2)', alignItems: 'stretch' }}>
            {loading && <Loading label="Extracting Word document paragraphs…" />}
            {error && <div className="notice notice-error">{error}</div>}
            {!loading && !error && (
              <div className="stack-sm" style={{ maxWidth: 740, width: '100%', margin: '0 auto' }}>
                <input
                  className="input"
                  placeholder="Search inside Word draft text…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ background: 'var(--surface)' }}
                />
                {reviewedFilePath && (
                  <div className="notice notice-info small between" style={{ gap: 8 }}>
                    <span>Supervisor also attached a marked-up Track-Changes copy: <strong>{reviewedFileName || 'Reviewed Copy'}</strong></span>
                    <button type="button" className="btn btn-sm" onClick={() => openStoredFile(bucket, reviewedFilePath).catch((e) => toast(e.message, 'error'))}>
                      Download
                    </button>
                  </div>
                )}
                <div className="card stack-sm" style={{ padding: 20, gap: 10 }}>
                  {filteredIndexes.length === 0 ? (
                    <div className="small muted">No matching paragraphs found.</div>
                  ) : (
                    filteredIndexes.map(({ text, idx }) => {
                      const pAnns = annsByPara[idx] || [];
                      const isSel = selectedPara === idx;
                      return (
                        <div
                          key={idx}
                          onClick={() => startCommentOnPara(idx)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            border: isSel ? '1.5px solid var(--teal)' : pAnns.length ? '1px solid #f59e0b' : '1px solid transparent',
                            background: pAnns.length ? 'rgba(245, 158, 11, 0.08)' : isSel ? 'var(--surface-2)' : 'transparent',
                            cursor: readOnly ? 'default' : 'pointer',
                            transition: 'background 0.15s',
                          }}
                          title={readOnly ? undefined : 'Click paragraph to pin a comment'}
                        >
                          <div className="between" style={{ gap: 8, marginBottom: 4 }}>
                            <span className="mono tiny muted">¶{idx + 1}</span>
                            {pAnns.length > 0 && (
                              <span className="badge badge-amber" style={{ fontSize: 10 }}>
                                {pAnns.length} comment{pAnns.length === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                          <p className="small" style={{ margin: 0, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{text}</p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <aside className="pdf-annotator-side stack">
            <div className="notice notice-info tiny">
              {readOnly
                ? 'Highlighted paragraphs carry supervisor feedback. Reply and mark each revision addressed.'
                : 'Click any paragraph on the left to attach a comment. You can also upload a Track-Changes .docx on the main review card.'}
            </div>

            {draft && !readOnly && (
              <div className="card stack-sm" style={{ padding: 12, borderColor: 'var(--teal)' }}>
                <strong className="small">Comment on Paragraph ¶{draft.paraIndex + 1}</strong>
                <div className="row-wrap" style={{ gap: 6 }}>
                  {TAGS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`chip ${draft.tag === t.id ? 'active' : ''}`}
                      onClick={() => setDraft((d) => ({ ...d, tag: t.id }))}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="Write your revision note for this paragraph…"
                  value={draft.text}
                  onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                  autoFocus
                />
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
                    <option value="">Insert quick academic snippet…</option>
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
              <strong className="small">All Paragraph Comments ({annotations.length})</strong>
              {annotations.length === 0 ? (
                <span className="tiny muted">No paragraph comments yet.</span>
              ) : (
                <div className="stack-sm" style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {annotations.map((pin, idx) => {
                    const t = tagInfo(pin.tag);
                    const draftReply = replyDrafts[pin.id] ?? pin.studentReply ?? '';
                    return (
                      <div
                        key={pin.id}
                        className="card stack-sm"
                        style={{
                          padding: 10,
                          borderColor: selectedPara === pin.paraIndex ? 'var(--teal)' : 'var(--line)',
                          background: pin.studentResolved ? 'var(--surface-2)' : 'var(--surface)',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setSelectedPara(pin.paraIndex);
                          if (!readOnly) setDraft({ ...pin });
                        }}
                      >
                        <div className="between" style={{ gap: 6 }}>
                          <div className="row-wrap" style={{ gap: 6 }}>
                            <span className={`badge ${t.cls}`} style={{ fontSize: 11 }}>{t.label}</span>
                            <span className="mono tiny muted">#{idx + 1} · ¶{(pin.paraIndex ?? 0) + 1}</span>
                            {pin.studentResolved && <span className="badge badge-teal" style={{ fontSize: 10 }}>Addressed ✓</span>}
                          </div>
                          {!readOnly && (
                            <button
                              type="button"
                              className="icon-btn plain"
                              aria-label="Delete comment"
                              onClick={(e) => { e.stopPropagation(); removePin(pin.id); }}
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          )}
                        </div>
                        <div className="small pre">{pin.text}</div>
                        {pin.studentReply && !allowStudentReplies && (
                          <div className="tiny" style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--surface-2)', borderLeft: '3px solid var(--teal)' }}>
                            <strong>Student reply:</strong> {pin.studentReply}
                          </div>
                        )}
                        {allowStudentReplies && (
                          <div className="stack-sm" style={{ gap: 6, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                            <input
                              className="input"
                              style={{ minHeight: 32, fontSize: 12 }}
                              placeholder="Reply to supervisor…"
                              value={draftReply}
                              onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [pin.id]: e.target.value }))}
                            />
                            <div className="row-wrap" style={{ gap: 6 }}>
                              <button type="button" className="btn btn-sm" disabled={replyBusyId === pin.id} onClick={() => submitReply(pin, Boolean(pin.studentResolved))}>
                                Save Reply
                              </button>
                              <button
                                type="button"
                                className={`btn btn-sm ${pin.studentResolved ? '' : 'btn-primary'}`}
                                disabled={replyBusyId === pin.id}
                                onClick={() => submitReply(pin, !pin.studentResolved)}
                              >
                                {pin.studentResolved ? 'Reopen' : 'Mark Addressed ✓'}
                              </button>
                            </div>
                          </div>
                        )}
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
