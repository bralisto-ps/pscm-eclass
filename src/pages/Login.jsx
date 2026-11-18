import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useBranding } from '../lib/branding.js';
import { useTheme } from '../lib/theme.js';
import Icon, { BrandMark } from '../components/Icon.jsx';
import { Field } from '../components/ui.jsx';
import { OfflineIndicator, PWAInstallButton } from '../components/PWABanner.jsx';
import PrivacyNoticeModal from '../components/PrivacyNoticeModal.jsx';

export default function Login({ mode }) {
  const { signIn, activate, activateStaff } = useAuth();
  const [brand] = useBranding();
  const [theme, , toggleTheme] = useTheme();
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  const staff = mode === 'staff';
  const activating = mode === 'activate' || staff;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!id.trim() || !password) {
      setError(
        staff
          ? 'Enter your email and choose a password.'
          : activating
            ? 'Enter your index number and choose a password.'
            : 'Enter your index number and password.',
      );
      return;
    }
    if (activating) {
      if (password.length < 8) return setError('Choose a password with at least 8 characters.');
      if (password !== confirm) return setError('The two passwords do not match.');
    }
    setBusy(true);
    try {
      if (staff) await activateStaff(id, name, password);
      else if (activating) await activate(id, password);
      else await signIn(id, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <aside className="auth-side">
        
        <div className="brand" style={{ padding: 0 }}>
          <BrandMark size={40} />
          <div>
            <div className="brand-name" style={{ fontSize: 17 }}>{brand.portalName}</div>
            <div className="brand-sub" style={{ color: '#94a3b8' }}>Academic Learning &amp; Assessment</div>
          </div>
        </div>

        <div className="stack">
          <div>
            <h2>Virtual Classroom for Procurement and Supply Chain Management</h2>
            <p>Course Coordinator: <strong style={{ color: '#fff', fontWeight: 600 }}>{brand.coordinator}</strong></p>
          </div>

          <div className="auth-editorial-list">
            <div className="auth-editorial-item">
              <span className="auth-editorial-num">01</span>
              <span>Lecture notes, study desk flashcards, and course materials</span>
            </div>
            <div className="auth-editorial-item">
              <span className="auth-editorial-num">02</span>
              <span>Timed assessments and live hall attendance verification</span>
            </div>
            <div className="auth-editorial-item">
              <span className="auth-editorial-num">03</span>
              <span>Continuous assessment standing and instant feedback</span>
            </div>
          </div>

          <div style={{ alignSelf: 'flex-start', marginTop: 4 }}>
            <PWAInstallButton dark />
          </div>
        </div>

        <div className="tiny" style={{ color: 'rgba(226, 232, 240, 0.72)' }}>
          {brand.department}
        </div>
      </aside>

      <main className="auth-main" style={{ position: 'relative' }}>
        <button
          type="button"
          className="icon-btn"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to night study mode'}
          title={theme === 'dark' ? 'Light mode' : 'Night study mode'}
          style={{ position: 'absolute', top: 18, right: 18 }}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
        <form className="auth-card" onSubmit={submit} noValidate>
          <div className="auth-mobile-banner" aria-hidden="true" />
          <div className="auth-mobile-head stack-sm" style={{ marginBottom: 4 }}>
            <div className="row" style={{ gap: 10 }}>
              <BrandMark size={34} />
              <div>
                <div className="strong" style={{ fontSize: 16 }}>{brand.portalName}</div>
                <div className="tiny muted">Academic Learning &amp; Assessment · {brand.coordinator}</div>
              </div>
            </div>
            <span className="small muted">Virtual Classroom for Procurement and Supply Chain Management Courses</span>
            <div style={{ marginTop: 4 }}><PWAInstallButton /></div>
          </div>

          <nav className="auth-switch" aria-label="Account mode">
            <Link to="/login" className={mode === 'signin' ? 'active' : ''}>Sign in</Link>
            <Link to="/activate" className={mode === 'activate' ? 'active' : ''}>Activate</Link>
            <Link to="/staff" className={mode === 'staff' ? 'active' : ''}>Staff setup</Link>
          </nav>

          <div className="stack-sm" style={{ gap: 4 }}>
            <h1 style={{ fontSize: 22 }}>
              {staff ? 'Teaching assistant account' : activating ? 'Activate your account' : 'Welcome back'}
            </h1>
            <p className="muted small">
              {staff
                ? 'Use the email address your lecturer added for you, and choose a password.'
                : activating
                  ? 'First time here? Enter your index number and choose a password you will remember.'
                  : 'Sign in with your student index number or staff email.'}
            </p>
          </div>

          {error && <div className="notice notice-error" role="alert">{error}</div>}

          <Field label={staff ? 'Email address' : activating ? 'Index number' : 'Index number or staff email'}>
            <input
              className={staff ? 'input' : 'input mono'}
              type={staff ? 'email' : 'text'}
              value={id}
              onChange={(e) => setId(e.target.value)}
              autoComplete={staff ? 'email' : 'username'}
              autoCapitalize={staff ? 'none' : 'characters'}
              spellCheck={false}
              placeholder={staff ? 'you@gmail.com' : 'e.g. 4021180'}
            />
          </Field>

          {staff && (
            <Field label="Full name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Kwame Boateng" />
            </Field>
          )}

          <Field label={activating ? 'Choose a password' : 'Password'} hint={activating ? 'at least 8 characters' : undefined}>
            <div className="input-wrap">
              <input
                className="input"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={activating ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                className="input-eye"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                <Icon name={showPw ? 'eyeOff' : 'eye'} size={17} />
              </button>
            </div>
          </Field>

          {activating && (
            <Field label="Confirm password">
              <input
                className="input"
                type={showPw ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          )}

          <button type="submit" className="btn btn-dark btn-block" disabled={busy}>
            {busy ? 'Please wait…' : activating ? 'Activate and sign in' : 'Sign in'}
          </button>

          {!activating && (
            <p className="tiny muted" style={{ textAlign: 'center' }}>
              Forgot your password? Ask your lecturer to reset it.
            </p>
          )}
                  <p className="tiny muted" style={{ textAlign: 'center', marginTop: 4 }}>
            <button type="button" className="btn btn-sm btn-ghost" style={{ minHeight: 28, fontSize: 12 }} onClick={() => setPrivacyOpen(true)}>
              Privacy &amp; Academic Integrity Notice
            </button>
          </p>
        </form>
      </main>
      {privacyOpen && <PrivacyNoticeModal onClose={() => setPrivacyOpen(false)} />}
      <OfflineIndicator />
    </div>
  );
}
