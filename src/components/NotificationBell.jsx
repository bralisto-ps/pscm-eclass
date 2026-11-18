import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { rpc, supabase } from '../lib/supabase.js';
import { relative } from '../lib/format.js';
import Icon from './Icon.jsx';

export default function NotificationBell({ dark = false }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [supported, setSupported] = useState(true);
  const [pushPerm, setPushPerm] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const load = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const list = await rpc('my_notifications', { p_limit: 40 });
      setItems(Array.isArray(list) ? list : []);
      setSupported(true);
    } catch {
      setSupported(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    const ch = supabase
      .channel(`notifications:${uid}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
        (payload) => {
          const row = payload?.new;
          if (!row) return;
          setItems((prev) => (prev.some((x) => x.id === row.id) ? prev : [row, ...prev].slice(0, 40)));
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
            try {
              new Notification(row.title, { body: row.body || '' });
            } catch { /* ignore */ }
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [session?.user?.id]);

  if (!supported) return null;

  const unread = items.filter((i) => !i.read_at).length;

  async function openItem(n) {
    if (!n.read_at) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      rpc('mark_notification_read', { p_id: n.id }).catch(() => {});
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  async function markAll() {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at || now })));
    await rpc('mark_all_notifications_read').catch(() => {});
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
