import { useEffect, useMemo, useState } from 'react';
import { rpc, supabase } from '../lib/supabase.js';
import { fmtFull } from '../lib/format.js';
import { downloadWorkbook } from '../lib/sheets.js';
import { extractEdgeError } from '../lib/aiGrade.js';
import Icon from './Icon.jsx';
import { Empty, Loading, Modal, useToast } from './ui.jsx';

export default function AssignmentTopicsModal({ a, assignMeta, readOnly = false, onClose, onChanged }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState([]);
  const [unavailable, setUnavailable] = useState(false);
  const [q, setQ] = useState('');

  const [auditing, setAuditing] = useState(false);
  const [aiDupes, setAiDupes] = useState([]);
  const [auditNote, setAuditNote] = useState('');

  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState('');

  const topicCfg = assignMeta?.topicRegistration || {};
  const uniqueness = topicCfg.uniqueness || 'product';

  async function loadClaims() {
    setLoading(true);
    try {
      const res = await rpc('assignment_topic_claims_staff', { p_assignment: a.id });
      setClaims(Array.isArray(res) ? res : []);
      setUnavailable(false);
    } catch (err) {
      if (/assignment_topic_claims_staff|Could not find|does not exist|schema cache/i.test(err?.message || '')) {
        setUnavailable(true);
      } else {
        toast(err.message || 'Could not load registered products.', 'error');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClaims();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id]);

  const approved = useMemo(() => claims.filter((c) => c.status === 'approved'), [claims]);
  const rejected = useMemo(() => claims.filter((c) => c.status === 'rejected'), [claims]);

  const byId = useMemo(() => new Map(claims.map((c) => [c.id, c])), [claims]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return claims;
    return claims.filter((c) =>
      [c.firm_name, c.product_name, c.syndicate_name, c.full_name, c.index_no]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(s)
    );
  }, [claims, q]);

  async function runAiAudit() {
    if (approved.length < 2) return toast('Need at least 2 active registrations to audit.');
    setAuditing(true);
    setAiDupes([]);
    setAuditNote('');
    try {
      const { data, error } = await supabase.functions.invoke('ai-topic-check', {
        body: {
          mode: 'audit_all',
          course_id: a.course_id,
          uniqueness,
          claims: approved.map((c) => ({
            id: c.id,
            firm_name: c.firm_name,
            product_name: c.product_name,
          })),
        },
      });
      if (error || data?.error) {
        const msg = await extractEdgeError(error, data);
        setAuditNote(msg);
        toast(msg, 'error');
        return;
      }
      const list = Array.isArray(data?.duplicates) ? data.duplicates : [];
      setAiDupes(list);
      if (!list.length) {
        setAuditNote('AI audit found no duplicate products or firms across all active registrations.');
        toast('No duplicates detected!');
      } else {
        toast(`AI flagged ${list.length} possible duplicate${list.length === 1 ? '' : 's'} — review below.`);
      }
    } catch (err) {
      const msg = err?.message || 'AI audit failed.';
      setAuditNote(msg);
      toast(msg, 'error');
    } finally {
      setAuditing(false);
    }
  }

  async function confirmReject(claim, reasonText) {
    setBusyId(claim.id);
    try {
      await rpc('staff_reject_assignment_topic', {
        p_claim: claim.id,
        p_reason: reasonText || '',
      });
      toast('Registration rejected and student/group notified to pick a new choice.');
      setRejectTarget(null);
      setRejectReason('');
      setAiDupes((prev) => prev.filter((d) => d.later_id !== claim.id && d.earlier_id !== claim.id));
      await loadClaims();
      onChanged?.();
    } catch (err) {
      toast(err.message || 'Could not reject registration.', 'error');
    } finally {
      setBusyId('');
    }
  }

  function exportExcel() {
    const header = ['Order', 'Status', 'Syndicate / Group', 'Registered By', 'Index No.', 'Firm / Company', 'Product / Service', 'Registered At'];
    const body = claims.map((c, i) => [
      i + 1,
      c.status === 'approved' ? 'Active' : 'Rejected',
      c.syndicate_name || 'Individual',
      c.full_name || '',
      c.index_no || '',
      c.firm_name || '',
      c.product_name || '',
      c.created_at ? fmtFull(c.created_at) : '',
    ]);
    downloadWorkbook(`${a.courses?.code || 'course'}-${a.title}-registered-products.xlsx`, [
      { name: 'Registrations', rows: [header, ...body] },
    ]);
  }

  return (
    <Modal title={`Registered Products / Firms · ${a.title}`} onClose={onClose} wide>
      {loading ? (
        <Loading label="Loading registered products…" />
      ) : unavailable ? (
        <div className="notice notice-warn small">
          Run the <code>20261124_assignment_topic_registration.sql</code> migration in Supabase SQL Editor to enable product &amp; firm pre-registration.
        </div>
      ) : (
        <div className="stack">
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="row-wrap" style={{ gap: 8 }}>
              <span className="badge badge-teal">{approved.length} active</span>
              {rejected.length > 0 && <span className="badge badge-amber">{rejected.length} asked to change</span>}
              <span className="badge">
                Rule: {uniqueness === 'firm' ? 'Unique Firm' : uniqueness === 'both' ? 'Unique Firm & Product' : 'Unique Product'}
              </span>
            </div>
            <div className="row-wrap" style={{ gap: 6 }}>
              {!readOnly && approved.length >= 2 && (
                <button type="button" className="btn btn-sm btn-primary" disabled={auditing} onClick={runAiAudit}>
                  <Icon name="sparkles" size={14} /> {auditing ? 'Auditing…' : 'AI audit duplicates'}
                </button>
              )}
              {claims.length > 0 && (
                <button type="button" className="btn btn-sm" onClick={exportExcel}>
                  <Icon name="download" size={14} /> Export Excel
                </button>
              )}
            </div>
          </div>

          {auditNote && <div className="notice notice-info small">{auditNote}</div>}

          {aiDupes.length > 0 && (
            <div className="card stack-sm" style={{ borderColor: 'var(--amber)' }}>
              <strong className="small">
                <Icon name="alert" size={14} /> AI Flagged Possible Duplicates (earliest keeps slot; later asked to change)
              </strong>
              {aiDupes.map((d, i) => {
                const earlier = byId.get(d.earlier_id);
                const later = byId.get(d.later_id);
                if (!earlier || !later) return null;
                return (
                  <div
                    key={i}
                    className="between"
                    style={{
                      flexWrap: 'wrap',
                      gap: 8,
                      padding: '8px 10px',
                      background: 'var(--surface-2)',
                      borderRadius: 8,
                    }}
                  >
                    <div className="stack-sm" style={{ gap: 2, flex: 1, minWidth: 240 }}>
                      <div className="small">
                        <strong>Earlier:</strong> {earlier.syndicate_name || earlier.full_name} —{' '}
                        <span className="strong">{earlier.firm_name}{earlier.product_name ? ` · ${earlier.product_name}` : ''}</span>
                      </div>
                      <div className="small">
                        <strong>Later:</strong> {later.syndicate_name || later.full_name} —{' '}
                        <span className="strong">{later.firm_name}{later.product_name ? ` · ${later.product_name}` : ''}</span>
                      </div>
                      <div className="tiny muted">
                        {d.reason} <span className="badge" style={{ marginLeft: 4 }}>{d.confidence}</span>
                      </div>
                    </div>
                    {!readOnly && later.status === 'approved' && (
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={busyId === later.id}
                        onClick={() =>
                          confirmReject(
                            later,
                            `${d.reason || 'Duplicates an earlier registration.'} Please register a different ${uniqueness === 'firm' ? 'firm' : 'product / firm'}.`
                          )
                        }
                      >
                        {busyId === later.id ? 'Notifying…' : 'Reject later & notify'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {rejectTarget && (
            <div className="card stack-sm" style={{ borderColor: 'var(--red)' }}>
              <strong className="small">
                Ask {rejectTarget.syndicate_name || rejectTarget.full_name} to change "{rejectTarget.firm_name}{rejectTarget.product_name ? ` — ${rejectTarget.product_name}` : ''}"
              </strong>
              <input
                className="input"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason sent to student/group (e.g. Already chosen by an earlier group — pick another product)"
              />
              <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={() => setRejectTarget(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={busyId === rejectTarget.id}
                  onClick={() => confirmReject(rejectTarget, rejectReason)}
                >
                  {busyId === rejectTarget.id ? 'Sending…' : 'Reject & notify'}
                </button>
              </div>
            </div>
          )}

          {claims.length > 0 && (
            <label className="search">
              <Icon name="search" size={15} />
              <input
                className="input"
                style={{ minHeight: 38 }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search firm, product, syndicate, or student…"
              />
            </label>
          )}

          {shown.length === 0 ? (
            <Empty icon="tag" title="No registrations yet">
              Students and syndicates will appear here in first-come order as soon as they register their product/firm.
            </Empty>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Student / Group</th>
                    <th>Firm / Company</th>
                    <th>Product / Service</th>
                    <th>Registered</th>
                    <th>Status</th>
                    {!readOnly && <th />}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c, idx) => (
                    <tr key={c.id}>
                      <td className="mono tiny muted">{idx + 1}</td>
                      <td>
                        <div className="strong small">{c.syndicate_name || c.full_name || 'Student'}</div>
                        <div className="tiny muted">
                          {c.syndicate_name ? `by ${c.full_name || c.index_no}` : <span className="mono">{c.index_no}</span>}
                        </div>
                      </td>
                      <td className="strong small">{c.firm_name}</td>
                      <td className="small">{c.product_name || '—'}</td>
                      <td className="tiny muted">{c.created_at ? fmtFull(c.created_at) : '—'}</td>
                      <td>
                        {c.status === 'approved' ? (
                          <span className="badge badge-teal">Active</span>
                        ) : (
                          <span className="badge badge-red" title={c.rejection_reason}>Change requested</span>
                        )}
                      </td>
                      {!readOnly && (
                        <td style={{ textAlign: 'right' }}>
                          {c.status === 'approved' && (
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              disabled={busyId === c.id}
                              onClick={() => {
                                setRejectTarget(c);
                                setRejectReason('This product/firm duplicates an earlier registration. Please register a different choice.');
                              }}
                            >
                              Ask to change
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
