import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Field } from '../components/ui.jsx';

export default function Login({ mode }) {
  const { signIn, activate, activateStaff } = useAuth();
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const staff = mode === 'staff';
  const activating = mode === 'activate' || staff;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!id.trim() || !password) {
      setError(staff ? 'Enter your email and choose a password.' : activating ? 'Enter your index number and choose a password.' : 'Enter your index number and password.');
      return;
    }
    if (activating) {
      if (password.length < 6) return setError('Choose a password with at least 6 characters.');
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
          <span className="brand-mark">PS</span>
          <span className="brand-name">PSCM E-class</span>
        </div>
        <div>
          <h2>Virtual Classroom for Procurement and Supply Chain Management Courses</h2>
          <p>L.O Appiah, PhD</p>
        </div>
        <div />
      </aside>

      <main className="auth-main">
        <form className="auth-card" onSubmit={submit} noValidate>
          <div className="auth-mobile-head stack-sm" style={{ marginBottom: 8 }}>
            <div className="row">
              <span className="brand-mark">PS</span>
              <strong>PSCM E-class</strong>
            </div>
            <span className="small muted">Virtual Classroom for Procurement and Supply Chain Management Courses · L.O Appiah, PhD</span>
          </div>
          <div className="stack-sm">
            <h1>{staff ? 'Teaching assistant account' : activating ? 'Activate your account' : 'Sign in'}</h1>
            <p className="muted">
              {staff
                ? 'Use the email address your lecturer added for you, and choose a password.'
                : activating
                  ? 'First time here? Enter your index number and choose a password you will remember.'
                  : 'Students sign in with their index number.'}
            </p>
          </div>

          {error && <div className="notice notice-error" role="alert">{error}</div>}

          <Field label={staff ? 'Email' : activating ? 'Index number' : 'Index number (or staff email)'}>
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
            <Field label="Your name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
          )}
          <Field label={activating ? 'Choose a password' : 'Password'} hint={activating ? 'at least 6 characters' : undefined}>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={activating ? 'new-password' : 'current-password'}
            />
          </Field>
          {activating && (
            <Field label="Type the password again">
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          )}

          <button type="submit" className="btn btn-dark btn-block" disabled={busy}>
            {busy ? 'Please wait…' : activating ? 'Activate and sign in' : 'Sign in'}
          </button>

          <div className="small muted" style={{ textAlign: 'center' }}>
            {activating ? (
              <>Already activated? <Link to="/login">Sign in</Link></>
            ) : (
              <>First time? <Link to="/activate">Activate your account</Link></>
            )}
          </div>
          {!activating && (
            <p className="tiny muted" style={{ textAlign: 'center' }}>
              Teaching assistant? <Link to="/staff">Set up your account</Link>
            </p>
          )}
          {!activating && (
            <p className="tiny muted" style={{ textAlign: 'center' }}>
              Forgot your password? Ask your lecturer to reset it.
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
