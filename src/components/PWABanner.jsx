import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { Modal } from './ui.jsx';

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  }

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

export function PWAInstallButton({ compact = false, dark = false }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={dark ? 'btn btn-sm' : 'btn btn-sm btn-primary'}
        style={
          dark
            ? {
                width: '100%',
                justifyContent: 'center',
                background: 'rgba(13, 148, 136, 0.22)',
                borderColor: 'rgba(94, 234, 212, 0.35)',
                color: '#ecfdf5',
              }
            : undefined
        }
        title="Install PSCM E-class on your home screen"
      >
        <Icon name="download" size={15} />
        {compact ? 'Install' : 'Install App'}
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="btn btn-sm"
          style={
            dark
              ? {
                  width: '100%',
                  justifyContent: 'center',
                  background: 'rgba(255,255,255,0.08)',
                  borderColor: 'rgba(255,255,255,0.2)',
                  color: '#f8fafc',
                }
              : undefined
          }
          title="Add PSCM E-class to your iPhone or iPad Home Screen"
        >
          <Icon name="download" size={15} />
          {compact ? 'Install' : 'Install on iPhone'}
        </button>

        {showIOSGuide && (
          <Modal
            title="Install PSCM E-class on iPhone / iPad"
            onClose={() => setShowIOSGuide(false)}
            footer={
              <button type="button" className="btn btn-primary" onClick={() => setShowIOSGuide(false)}>
                Got it
              </button>
            }
          >
            <div className="stack">
              <p className="small muted">
                Install PSCM E-class onto your Home Screen for quick one-tap attendance check-ins, announcements, and grades:
              </p>
              <ol className="stack-sm small" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                <li>
                  Tap the <strong>Share</strong> icon in Safari&apos;s bottom or top toolbar.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
                <li>
                  Tap <strong>Add</strong> in the top-right corner.
                </li>
              </ol>
            </div>
          </Modal>
        )}
      </>
    );
  }

  return null;
}

export function OfflineIndicator() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderRadius: 10,
        background: '#b45309',
        color: '#fff',
        fontSize: 13,
        fontWeight: 600,
        boxShadow: '0 6px 20px rgba(0,0,0,0.22)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#fef3c7',
          display: 'inline-block',
        }}
      />
      You are offline — reconnect to submit attendance, quizzes, or changes.
    </div>
  );
}
