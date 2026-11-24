import { useEffect, useMemo, useState } from 'react';
import { rpc, supabase } from '../lib/supabase.js';
import { fmtFull, relative } from '../lib/format.js';
import Icon from './Icon.jsx';
import { useToast } from './ui.jsx';

export default function StudentTopicClaimBox({
  assignment,
  courseId,
  topicCfg,
  mySyndicate,
  hasSubmitted = false,
  onStatusChange,
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  const [firm, setFirm] = useState('');
  const [product, setProduct] = useState('');
  const [busy, setBusy] = useState(false);
  const [dupAlert, setDupAlert] = useState('');
  const [showTaken, setShowTaken] = useState(false);
  const [takenFilter, setTakenFilter] = useState('');

  const uniqueness = topicCfg?.uniqueness || 'product';
  const needsProduct = uniqueness !== 'firm';
  const deadlineIso = topicCfg?.deadline || assignment?.due_at || '';
  const deadlinePassed = Boolean(deadlineIso && new Date(deadlineIso) < new Date());
  const isSyndicateMode = Boolean(mySyndicate);

  async function loadStatus() {
    try {
      const res = await rpc('assignment_topic_status', { p_assignment: assignment.id });
      setStatus(res || null);
      setUnavailable(false);
      onStatusChange?.(res || null);
    } catch (err) {
      if (/assignment_topic_status|Could not find|does not exist|schema cache/i.test(err?.message || '')) {
        setUnavailable(true);
        onStatusChange?.({ unavailable: true });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment.id]);

  const myClaim = status?.my_claim || null;
  const isApproved = myClaim?.status === 'approved';
  const isRejected = myClaim?.status === 'rejected';
  const takenList = useMemo(() => (Array.isArray(status?.taken) ? status.taken : []), [status]);
  const othersTaken = useMemo(() => takenList.filter((t) => !t.is_mine), [takenList]);

  const filteredTaken = useMemo(() => {
    const q = takenFilter.trim().toLowerCase();
    if (!q) return takenList;
    return takenList.filter(
      (t) =>
        String(t.firm_name || '').toLowerCase().includes(q) ||
        String(t.product_name || '').toLowerCase().includes(q)
    );
  }, [takenList, takenFilter]);

  async function submitClaim(e) {
    e.preventDefault();
    const f = firm.trim();
    const p = product.trim();
    if (f.length < 2) return toast('Enter the firm or company name.', 'error');
    if (needsProduct && p.length < 2) return toast('Enter the product or service name.', 'error');

    setBusy(true);
    setDupAlert('');

    try {
      // Layer 2: AI semantic duplicate check (catches acronyms, aliases, brand nicknames, spelling variations)
      if (topicCfg?.useAiCheck !== false && othersTaken.length > 0 && courseId) {
        try {
          const { data: aiRes, error: aiErr } = await supabase.functions.invoke('ai-topic-check', {
            body: {
              mode: 'check_one',
              course_id: courseId,
              uniqueness,
              firm_name: f,
              product_name: p,
              existing: othersTaken.map((t) => ({
                firm_name: t.firm_name,
                product_name: t.product_name,
              })),
            },
          });

          if (!aiErr && aiRes && !aiRes.error && aiRes.is_duplicate && aiRes.confidence !== 'low') {
            const matchedLabel = [aiRes.matched_firm, aiRes.matched_product].filter(Boolean).join(' — ');
            const msg = aiRes.reason
              ? `${aiRes.reason}${matchedLabel ? ` (Matches already registered: ${matchedLabel}.)` : ''} Please choose a different ${uniqueness === 'firm' ? 'firm' : 'product / firm'}.`
              : `This choice duplicates an already registered entry${matchedLabel ? ` (${matchedLabel})` : ''}. Please choose a different ${uniqueness === 'firm' ? 'firm' : 'product / firm'}.`;
            setDupAlert(msg);
            toast('Already taken — please pick a different choice.', 'error');
            setBusy(false);
            return;
          }
        } catch {
          // Graceful fallback: Layer 1 PostgreSQL exact + fuzzy spelling lock still runs below
        }
      }

      // Layer 1: Race-safe PostgreSQL exact + fuzzy spelling duplicate lock
      const res = await rpc('claim_assignment_topic', {
        p_assignment: assignment.id,
        p_firm: f,
        p_product: p,
      });

      if (res && res.duplicate) {
        setDupAlert(res.reason || 'This product/firm is already registered by another student or group. Please choose a different one.');
        toast('Already taken — choose a different product/firm.', 'error');
        await loadStatus();
        return;
      }

      setFirm('');
      setProduct('');
      setDupAlert('');
      toast(isSyndicateMode ? `Registered for ${mySyndicate.name}!` : 'Product / firm registered!');
      await loadStatus();
    } catch (err) {
      toast(err.message || 'Could not register choice.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function releaseClaim() {
    setBusy(true);
    try {
      await rpc('release_my_assignment_topic', { p_assignment: assignment.id });
      toast('Registration released — you can now register a different choice.');
      await loadStatus();
    } catch (err) {
      toast(err.message || 'Could not release registration.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (unavailable) return null;

  const ruleText =
    uniqueness === 'firm'
      ? 'Unique firm required — once a firm is claimed, nobody else can pick it.'
      : uniqueness === 'both'
      ? 'Both firm and product must be unique across the class.'
      : 'Unique product required — different products from the same firm are allowed.';

  return (
    <div
      className="stack-sm"
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        background: isApproved ? 'var(--teal-50)' : 'var(--surface-2)',
        border: `1px solid ${isApproved ? 'var(--teal)' : isRejected ? 'var(--red)' : 'var(--line)'}`,
      }}
    >
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <Icon name="tag" size={16} />
          <div>
            <strong className="small">
              {uniqueness === 'firm' ? 'Firm / Company Registration' : 'Product & Firm Pre-Registration'}
            </strong>
            <div className="tiny muted">
              {ruleText}
              {deadlineIso ? ` · Register by ${fmtFull(deadlineIso)} (${relative(deadlineIso)})` : ''}
            </div>
          </div>
        </div>
        <div className="row-wrap" style={{ gap: 6 }}>
          {isApproved && (
            <span className="badge badge-teal">
              <Icon name="check" size={12} /> Registered
            </span>
          )}
          {isRejected && (
            <span className="badge badge-red">
              <Icon name="alert" size={12} /> Change required
            </span>
          )}
          {!isApproved && !isRejected && !loading && (
            <span className="badge badge-amber">Not registered yet</span>
          )}
          {takenList.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setShowTaken((v) => !v)}
            >
              {showTaken ? 'Hide taken list' : `Already taken (${takenList.length})`}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="tiny muted">Checking registration status…</p>
      ) : isApproved ? (
        <div className="between" style={{ flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
          <div className="small">
            <strong>{myClaim.firm_name}</strong>
            {myClaim.product_name ? <> — <strong>{myClaim.product_name}</strong></> : null}
            <span className="tiny muted" style={{ marginLeft: 8 }}>
              Registered {fmtFull(myClaim.created_at)}
              {isSyndicateMode ? ` · locked for ${mySyndicate.name}` : ''}
            </span>
          </div>
          {!deadlinePassed && !hasSubmitted && (
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={releaseClaim}>
              {busy ? 'Releasing…' : 'Change choice'}
            </button>
          )}
        </div>
      ) : (
        <div className="stack-sm" style={{ paddingTop: 4 }}>
          {isRejected && (
            <div className="notice notice-error small">
              <strong>Please choose a different {uniqueness === 'firm' ? 'firm' : 'product / firm'}:</strong>{' '}
              Your previous choice ({myClaim.firm_name}{myClaim.product_name ? ` — ${myClaim.product_name}` : ''}) was released.{' '}
              {myClaim.rejection_reason}
            </div>
          )}

          {dupAlert && (
            <div className="notice notice-error small">
              <strong>Already registered by another {isSyndicateMode ? 'group' : 'student'}:</strong> {dupAlert}
            </div>
          )}

          {deadlinePassed ? (
            <div className="notice notice-warn small">
              The registration deadline has passed. Contact your lecturer if you still need to register a choice.
            </div>
          ) : (
            <form onSubmit={submitClaim} className="row-wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
              <label className="field" style={{ flex: 1, minWidth: 180 }}>
                <span className="tiny">Firm / Company name *</span>
                <input
                  className="input"
                  value={firm}
                  onChange={(e) => { setFirm(e.target.value); setDupAlert(''); }}
                  placeholder="e.g. Nestlé Ghana, Kasapreko, MTN"
                  maxLength={120}
                  disabled={busy}
                  required
                />
              </label>
              {needsProduct && (
                <label className="field" style={{ flex: 1, minWidth: 180 }}>
                  <span className="tiny">Product / Service name *</span>
                  <input
                    className="input"
                    value={product}
                    onChange={(e) => { setProduct(e.target.value); setDupAlert(''); }}
                    placeholder="e.g. Milo, Voltic Mineral Water"
                    maxLength={120}
                    disabled={busy}
                    required
                  />
                </label>
              )}
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <Icon name="check" size={15} />
                {busy ? 'Checking…' : isSyndicateMode ? `Register for ${mySyndicate.name}` : 'Register choice'}
              </button>
            </form>
          )}
        </div>
      )}

      {showTaken && takenList.length > 0 && (
        <div
          className="stack-sm"
          style={{
            marginTop: 6,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
          }}
        >
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="tiny muted">
              Anonymized list of already-registered choices ({takenList.length}) — pick something not listed here:
            </span>
            {takenList.length >= 6 && (
              <input
                className="input"
                style={{ maxWidth: 200, minHeight: 32, fontSize: 12 }}
                value={takenFilter}
                onChange={(e) => setTakenFilter(e.target.value)}
                placeholder="Filter taken list…"
              />
            )}
          </div>
          <div className="row-wrap" style={{ gap: 6, maxHeight: 160, overflowY: 'auto' }}>
            {filteredTaken.map((t, i) => (
              <span key={i} className={`badge ${t.is_mine ? 'badge-teal' : ''}`}>
                {t.firm_name}
                {t.product_name ? ` — ${t.product_name}` : ''}
                {t.is_mine ? ' (Yours)' : ''}
              </span>
            ))}
            {filteredTaken.length === 0 && <span className="tiny muted">No match in taken list.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
