import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { rpc, supabase } from '../lib/supabase.js';
import { relative } from '../lib/format.js';
import Icon from './Icon.jsx';

// Shared singleton store per user so multiple mounted <NotificationBell /> instances
// (desktop Topbar, mobile header, course pages) share ONE Realtime channel and stay in sync.
let channelSeq = 0;
const stores = new Map();

function getStore(uid) {
  let s = stores.get(uid);
  if (s) return s;
  s = {
    uid,
    items: [],
    supported: true,
    loaded: false,
    listeners: new Set(),
    channel: null,
    cleanupTimer: null,
    emit() {
      for (const fn of this.listeners) fn({ items: this.items, supported: this.supported });
    },
    async load() {
      try {
        const list = await rpc('my_notifications', { p_limit: 40 });
        this.items = Array.isArray(list) ? list : [];
        this.supported = true;
      } catch {
        this.supported = false;
      }
      this.loaded = true;
      this.emit();
    },
    ensureSubscribed() {
      if (this.cleanupTimer) {
        clearTimeout(this.cleanupTimer);
        this.cleanupTimer = null;
      }
      if (this.channel || !supabase) return;
      try {
        const topic = `notifications:${this.uid}:${++channelSeq}`;
        const ch = supabase
          .channel(topic)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${this.uid}` },
            (payload) => {
              const row = payload?.new;
              if (!row) return;
              if (!this.items.some((x) => x.id === row.id)) {
                this.items = [row, ...this.items].slice(0, 40);
                this.emit();
              }
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
                try {
                  new Notification(row.title, { body: row.body || '' });
                } catch { /* ignore */ }
              }
            }
          )
          .subscribe();
        this.channel = ch;
      } catch {
        // Never crash UI if Realtime fails to initialize
      }
    },
    subscribe(listener) {
      this.listeners.add(listener);
      this.ensureSubscribed();
      if (!this.loaded) this.load();
      else listener({ items: this.items, supported: this.supported });
      return () => {
        this.listeners.delete(listener);
        if (this.listeners.size === 0) {
          this.cleanupTimer = setTimeout(() => {
            if (this.listeners.size === 0 && this.channel) {
              const ch = this.channel;
              this.channel = null;
              try {
                supabase?.removeChannel?.(ch)?.catch?.(() => {});
                ch?.teardown?.();
              } catch { /* ignore */ }
              stores.delete(this.uid);
            }
          }, 250);
        }
      };
    },
    markRead(id) {
      const now = new Date().toISOString();
      this.items = this.items.map((x) => (x.id === id ? { ...x, read_at: x.read_at || now } : x));
      this.emit();
      rpc('mark_notification_read', { p_id: id }).catch(() => {});
    },
    async markAllRead() {
      const now = new Date().toISOString();
      this.items = this.items.map((x) => ({ ...x, read_at: x.read_at || now }));
      this.emit();
      await rpc('mark_all_notifications_read').catch(() => {});
    },
  };
  stores.set(uid, s);
  return s;
}

export default function NotificationBell({ dark = false }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState({ items: [], supported: true });
  const [open, setOpen] = useState(false);
  const [pushPerm, setPushPerm] = useState(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );

  const uid = session?.user?.id;

  useEffect(() => {
    if (!uid) {
      setState({ items: [], supported: true });
      return undefined;
    }
    const store = getStore(uid);
    return store.subscribe(setState);
  }, [uid]);

  if (!state.supported) return null;

  const items = state.items;
  const unread = items.filter((i) => !i.read_at).length;

  function openItem(n) {
    if (!n.read_at && uid) getStore(uid).markRead(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  async function markAll() {
    if (uid) await getStore(uid).markAllRead();
  }

  async function enableAlerts() {
    if (typeof Notification === 'undefined') return;
    try {
      const perm = await Notification.requestPermission();
      setPushPerm(perm);
      if (perm === 'granted' && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager?.getSubscription?.();
        if (sub?.endpoint) {
          const j = sub.toJSON();
          await rpc('save_push_subscription', {
            p_endpoint: sub.endpoint,
            p_p256dh: j.keys?.p256dh || '',
            p_auth: j.keys?.auth || '',
          }).catch(() => {});
        }
      }
    } catch { /* ignore */ }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className={dark ? 'icon-btn-dark' : 'icon-btn'}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        title="Notifications"
        style={{ position: 'relative' }}
      >
        <Icon name="bell" size={16} />
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 110 }}
            onClick={() => setOpen(false)}
          />
          <div className="notif-popover card stack-sm" role="dialog" aria-label="Notifications">
            <div className="between" style={{ gap: 8 }}>
              <strong className="small">Notifications</strong>
              <div className="row" style={{ gap: 6 }}>
                {unread > 0 && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={markAll}>
                    Mark all read
                  </button>
                )}
                <button type="button" className="icon-btn plain" onClick={() => setOpen(false)} aria-label="Close">
                  <Icon name="x" size={15} />
                </button>
              </div>
            </div>
            {pushPerm === 'default' && (
              <div className="notice notice-info tiny between" style={{ gap: 8 }}>
                <span>Enable browser alerts for deadlines &amp; grades.</span>
                <button type="button" className="btn btn-sm" onClick={enableAlerts}>Enable</button>
              </div>
            )}
            <div className="stack-sm" style={{ maxHeight: 340, overflowY: 'auto' }}>
              {items.length === 0 ? (
                <div className="small muted" style={{ padding: '18px 8px', textAlign: 'center' }}>
                  You are all caught up.
                </div>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`notif-item ${n.read_at ? '' : 'unread'}`}
                    onClick={() => openItem(n)}
                  >
                    <div className="between" style={{ gap: 8, width: '100%' }}>
                      <strong className="small" style={{ textAlign: 'left' }}>{n.title}</strong>
                      <span className="tiny muted nowrap">{relative(n.created_at)}</span>
                    </div>
                    {n.body && <div className="tiny muted" style={{ textAlign: 'left' }}>{n.body}</div>}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
