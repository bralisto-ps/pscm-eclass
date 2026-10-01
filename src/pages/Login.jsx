import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import Icon from '../components/Icon.jsx';
import { Field } from '../components/ui.jsx';

export default function Login({ mode }) {
  const { signIn, activate } = useAuth();
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activating = mode === 'activate';

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!id.trim() || !password) {
      setError(activating ? 'Enter your index number and choose a password.' : 'Enter your index number and password.');
      return;
    }
    if (activating) {
      if (password.length < 6) return setError('Choose a password with at least 6 characters.');
      if (password !== confirm) return setError('The two passwords do not match.');
    }
    setBusy(true);
    try {
      if (activating) await activate(id, password);
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
          <h2>Procurement and supply chain courses, all in one place.</h2>
          <p>Lecture materials, quizzes, assignments and your grades — on your phone or laptop.</p>
        </div>
        <div className="auth-points">
          <div><Icon name="book" /> Weekly slides, notes and recorded lectures</div>
          <div><Icon name="quiz" /> Timed quizzes, marked the moment you submit</div>
          <div><Icon name="upload" /> Hand in assignments online, before the deadline</div>
        </div>
      </aside>

      <main className="auth-main">
        <form className="auth-card" onSubmit={submit} noValidate>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="brand-mark">PS</span>
            <strong>PSCM E-class</strong>
          </div>
          <div className="stack-sm">
            <h1>{activating ? 'Activate your account' : 'Sign in'}</h1>
            <p className="muted">
              {activating
                ? 'First time here? Enter your index number and choose a password you will remember.'
                : 'Students sign in with their index number.'}
            </p>
          </div>

          {error && <div className="notice notice-error" role="alert">{error}</div>}

          <Field label={activating ? 'Index number' : 'Index number (or lecturer email)'}>
            <input
              className="input mono"
              value={id}
              onChange={(e) => setId(e.target.value)}
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="e.g. 4021180"
            />
          </Field>
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
              Forgot your password? Ask your lecturer to reset it.
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
