import React, { Component, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// ---------- data loading ----------
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const mounted = useRef(true);
  const run = useCallback(async (quiet) => {
    if (!quiet) setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await loader();
      if (mounted.current) setState({ data, error: '', loading: false });
    } catch (e) {
      if (mounted.current) setState((s) => ({ ...s, error: e.message || String(e), loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    mounted.current = true;
    run();
    return () => {
      mounted.current = false;
    };
  }, [run]);
  return { ...state, reload: () => run(true), setData: (fn) => setState((s) => ({ ...s, data: fn(s.data) })) };
}

// ---------- toasts ----------
const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, text, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            <Icon name={t.kind === 'error' ? 'alert' : 'check'} size={17} />
            <span style={{ flex: 1 }}>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// Wraps an async action: shows errors as toasts, tracks busy state.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const act = useCallback(
    async (fn, success) => {
      setBusy(true);
      try {
        const r = await fn();
        if (success) toast(success);
        return r;
      } catch (e) {
        toast(e.message || String(e), 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return [act, busy];
}

// ---------- pieces ----------
export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="stack-lg" aria-hidden="true">
      <div className="skel-card" style={{ minHeight: 156, justifyContent: 'space-between', padding: '24px 26px' }}>
        <div className="skel" style={{ width: '22%', height: 12 }} />
        <div className="skel" style={{ width: '54%', height: 26 }} />
        <div className="grid-4" style={{ marginTop: 8 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skel" style={{ width: '80%', height: 22 }} />
          ))}
        </div>
      </div>
      <div className="grid-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel-card" style={{ minHeight: 150 }}>
            <div className="row">
              <div className="skel" style={{ width: 42, height: 42, borderRadius: 10 }} />
              <div className="stack-sm" style={{ flex: 1, gap: 6 }}>
                <div className="skel" style={{ width: '65%', height: 16 }} />
                <div className="skel" style={{ width: '40%', height: 12 }} />
              </div>
            </div>
            <div className="skel" style={{ width: '100%', height: 24, marginTop: 6 }} />
            <div className="skel" style={{ width: '100%', height: 6 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CourseSkeleton() {
  return (
    <div aria-hidden="true">
      <div style={{ background: 'var(--ink)', padding: '24px 32px' }}>
        <div className="skel" style={{ width: 90, height: 14, opacity: 0.28 }} />
        <div className="skel" style={{ width: 120, height: 14, marginTop: 18, opacity: 0.28 }} />
        <div className="skel" style={{ width: '42%', height: 28, marginTop: 8, opacity: 0.28 }} />
      </div>
      <div className="page stack-lg">
        <div className="grid-2">
          {[0, 1].map((i) => (
            <div key={i} className="skel-card" style={{ minHeight: 140 }}>
              <div className="skel" style={{ width: '45%', height: 16 }} />
              <div className="skel" style={{ width: '85%', height: 13 }} />
              <div className="skel" style={{ width: '70%', height: 13 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="notice notice-error row-wrap" role="alert">
      <span style={{ flex: 1 }}>{error}</span>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-danger" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ icon = 'inbox', title, children, action }) {
  return (
    <div className="empty">
      <div className="icon-circle">
        <Icon name={icon} size={22} />
      </div>
      {title && <strong>{title}</strong>}
      {children && <div className="small">{children}</div>}
      {action}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn plain" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>
        {label}
        {hint && <span className="hint"> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Tabs({ tabs, value, onChange, dark, primaryCount }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDoc = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  const split = dark && primaryCount && tabs.length > primaryCount;
  const primaryTabs = split ? tabs.slice(0, primaryCount) : tabs;
  const extraTabs = split ? tabs.slice(primaryCount) : [];
  const activeExtra = extraTabs.find((t) => t.id === value);
  const extraCountSum = extraTabs.reduce((s, t) => s + (Number(t.count) || 0), 0);

  if (!split) {
    return (
      <div className={dark ? 'band-tabs' : 'tabs'} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={value === t.id}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {t.count ? <span className="badge badge-amber" style={{ marginLeft: 8 }}>{t.count}</span> : null}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="band-tabs-wrap">
      <div className="band-tabs" role="tablist">
        {primaryTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={value === t.id}
            onClick={() => { setMoreOpen(false); onChange(t.id); }}
          >
            {t.label}
            {t.count ? <span className="badge badge-amber" style={{ marginLeft: 8 }}>{t.count}</span> : null}
          </button>
        ))}
      </div>
      <div className="band-more-wrap" ref={moreRef}>
        <button
          type="button"
          className={`band-more-btn ${activeExtra ? 'active' : ''}`}
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          onClick={() => setMoreOpen((v) => !v)}
        >
          <span>{activeExtra ? activeExtra.label : 'More'}</span>
          {extraCountSum > 0 && <span className="badge badge-amber">{extraCountSum}</span>}
          <Icon name={moreOpen ? 'chevronUp' : 'chevronDown'} size={14} />
        </button>
        {moreOpen && (
          <div className="band-more-menu" role="menu">
            {extraTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className="band-more-item"
                aria-selected={value === t.id}
                onClick={() => { setMoreOpen(false); onChange(t.id); }}
              >
                <span>{t.label}</span>
                {t.count ? <span className="badge badge-amber">{t.count}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const KIND_STYLE = {
  pdf: ['PDF', 'var(--red-50)', 'var(--red-ink)'],
  slides: ['Slides', 'var(--blue-50)', 'var(--blue-ink)'],
  video: ['Video', 'var(--plum-50)', 'var(--plum-ink)'],
  link: ['Link', 'var(--teal-50)', 'var(--teal-dark)'],
  doc: ['Doc', 'var(--blue-50)', 'var(--blue-ink)'],
  file: ['File', 'var(--grey-50)', 'var(--text-2)'],
  quiz: ['Quiz', 'var(--amber-50)', 'var(--amber-ink)'],
  practice: ['Practice', 'var(--amber-50)', 'var(--amber-ink)'],
  assignment: ['Task', 'var(--teal-50)', 'var(--teal-dark)'],
};

export function KindTag({ kind }) {
  const [label, bg, fg] = KIND_STYLE[kind] || KIND_STYLE.file;
  return (
    <span className="kind" style={{ background: bg, color: fg }}>
      {label}
    </span>
  );
}

export function Bar({ value, color = 'var(--teal)' }) {
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, value || 0))}%`, background: color }} />
    </div>
  );
}

export function Swatch({ color, text, size = 42 }) {
  return (
    <div className="swatch" style={{ background: color, width: size, height: size }}>
      {text}
    </div>
  );
}

export function Confirm({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, busy, children }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {message && <p>{message}</p>}
      {children}
    </Modal>
  );
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="card stack" style={{ margin: '20px 0', borderColor: 'var(--red-ink)' }}>
          <div className="row" style={{ gap: 10 }}>
            <Icon name="alert" size={22} style={{ color: 'var(--red-ink)' }} />
            <div>
              <h3 style={{ margin: '0 0 4px' }}>Something went wrong loading this section</h3>
              <p className="small muted" style={{ margin: 0 }}>{this.state.error?.message || 'An unexpected error occurred.'}</p>
            </div>
          </div>
          <div>
            <button type="button" className="btn btn-sm" onClick={() => this.setState({ hasError: false, error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
