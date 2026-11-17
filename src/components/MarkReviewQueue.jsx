import { useState } from 'react';
import { rpc } from '../lib/supabase.js';
import { fmtNumber, relative } from '../lib/format.js';
import Icon from './Icon.jsx';
import { Field, Modal, useAction, useToast } from './ui.jsx';

export default function MarkReviewQueue({ reviews = [], onResolved, title = 'Mark review requests' }) {
  const toast = useToast();
  const [act, busy] = useAction();
  const [editing, setEditing] = useState(null);
  const [newMarks, setNewMarks] = useState('');
  const [note, setNote] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const pending = reviews.filter((r) => r.status === 'pending');
  const resolved = reviews.filter((r) => r.status !== 'pending');
  if (reviews.length === 0) return null;

  function openModal(rev, mode) {
    setEditing({ ...rev, mode });
    setNewMarks(rev.current_marks !== null && rev.current_marks !== undefined ? String(rev.current_marks) : '');
    setNote('');
  }

  async function submitResolution() {
    if (!editing) return;
    const isApprove = editing.mode === 'approved';
    let parsed = null;
    if (isApprove) {
      if (newMarks.trim() === '') {
        toast('Enter the updated mark.', 'error');
        return;
      }
      parsed = Number(newMarks);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > Number(editing.max_marks || 0)) {
        toast(`Marks must be between 0 and ${editing.max_marks}.`, 'error');
        return;
      }
    }
    const ok = await act(
      () =>
        rpc('resolve_mark_review', {
          p_review: editing.id,
          p_status: isApprove ? 'approved' : 'declined',
          p_new_marks: isApprove ? parsed : null,
          p_note: note.trim(),
        }),
      isApprove ? 'Mark adjusted & review resolved.' : 'Review request declined.'
    );
    if (ok !== undefined) {
      setEditing(null);
      onResolved?.();
    }
  }

  const shownList = showResolved ? reviews : pending;

  return (
    <section className="card-flush" style={pending.length > 0 ? { borderColor: 'var(--amber)' } : undefined}>
      <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <Icon name="flag" size={16} style={{ color: pending.length ? 'var(--amber-ink)' : 'var(--muted)' }} />
          <h2>{title}</h2>
          {pending.length > 0 && <span className="badge badge-amber">{pending.length} pending</span>}
          {pending.length === 0 && <span className="badge badge-teal">All resolved</span>}
        </div>
        {resolved.length > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowResolved((s) => !s)}>
            {showResolved ? 'Show pending only' : `Show resolved (${resolved.length})`}
          </button>
        )}
      </div>

      {shownList.length === 0 ? (
        <div className="small muted" style={{ padding: '14px 18px' }}>
          No pending mark review requests.
        </div>
      ) : (
        shownList.map((r) => (
          <div key={r.id} className="list-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div className="list-main" style={{ minWidth: 260 }}>
              <div className="row-wrap" style={{ gap: 6, alignItems: 'center' }}>
                <strong className="small">{r.full_name}</strong>
                <span className="mono tiny muted">{r.index_no}</span>
                {(r.programme || r.stream) && (
                  <span className="tiny muted">· {[r.programme, r.stream].filter(Boolean).join(' ')}</span>
                )}
                <span className={`badge ${r.status === 'pending' ? 'badge-amber' : r.status === 'approved' ? 'badge-teal' : 'badge-red'}`}>
                  {r.status === 'pending' ? 'Pending' : r.status === 'approved' ? 'Adjusted' : 'Declined'}
                </span>
              </div>
              {r.question_prompt && (
                <div className="tiny muted" style={{ marginTop: 2 }}>
                  <strong>Question:</strong> {r.question_prompt.slice(0, 140)}{r.question_prompt.length > 140 ? '…' : ''}
                </div>
              )}
              {r.student_answer && (
                <div className="tiny muted" style={{ marginTop: 2 }}>
                  <strong>Student response:</strong> {r.student_answer.slice(0, 160)}{r.student_answer.length > 160 ? '…' : ''}
                </div>
              )}
              <div className="small pre" style={{ marginTop: 6, padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line-2)' }}>
                <strong>Student note:</strong> {r.reason}
              </div>
              {r.reviewer_note && (
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  <strong>Staff note:</strong> {r.reviewer_note}
                </div>
              )}
              <div className="tiny muted" style={{ marginTop: 4 }}>
                Current: <span className="mono strong">{fmtNumber(r.current_marks)} / {fmtNumber(r.max_marks)}</span>
                {r.status !== 'pending' && r.updated_marks !== null && (
                  <> · Resolved to <span className="mono strong">{fmtNumber(r.updated_marks)}</span></>
                )}
                {' · requested '}
                {relative(r.created_at)}
              </div>
            </div>
            {r.status === 'pending' && (
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => openModal(r, 'approved')}>
                  <Icon name="edit" size={14} /> Adjust mark
                </button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => openModal(r, 'declined')}>
                  Decline
                </button>
              </div>
            )}
          </div>
        ))
      )}

      {editing && (
        <Modal
          title={editing.mode === 'approved' ? 'Adjust mark & resolve review' : 'Decline mark review'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button
                type="button"
                className={`btn ${editing.mode === 'approved' ? 'btn-primary' : ''}`}
                onClick={submitResolution}
                disabled={busy}
              >
                {busy ? 'Saving…' : editing.mode === 'approved' ? 'Save adjusted mark' : 'Decline request'}
              </button>
            </>
          }
        >
          <div className="small muted">
            <strong>{editing.full_name}</strong> (<span className="mono">{editing.index_no}</span>) · Current mark:{' '}
            <span className="mono strong">{fmtNumber(editing.current_marks)} / {fmtNumber(editing.max_marks)}</span>
          </div>
          <div className="small pre" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line-2)' }}>
            {editing.reason}
          </div>
          {editing.mode === 'approved' && (
            <Field label={`Updated mark (out of ${fmtNumber(editing.max_marks)})`}>
              <input
                className="input mono"
                type="number"
                step="any"
                min="0"
                max={editing.max_marks}
                value={newMarks}
                onChange={(e) => setNewMarks(e.target.value)}
                autoFocus
              />
            </Field>
          )}
          <Field label={editing.mode === 'approved' ? 'Note to student (optional)' : 'Reason for declining'} hint="shown to student">
            <textarea
              className="textarea"
              style={{ minHeight: 80 }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={editing.mode === 'approved' ? 'Mark reviewed and updated…' : 'Marking criteria applied correctly because…'}
            />
          </Field>
        </Modal>
      )}
    </section>
  );
}
