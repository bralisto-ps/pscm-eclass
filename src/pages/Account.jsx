import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { supabase, friendlyError } from '../lib/supabase.js';
import { Topbar } from '../components/Layout.jsx';
import { Field, useToast } from '../components/ui.jsx';

export default function Account() {
  const { profile, isStaff: isLecturer, session, signOut } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function change(e) {
    e.preventDefault();
    setError('');
    if (pw.length < 6) return setError('Use at least 6 characters.');
    if (pw !== pw2) return setError('The two passwords do not match.');
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(friendlyError(err));
    setPw('');
    setPw2('');
    toast('Password changed.');
  }

  return (
    <>
      <Topbar title="Account" />
      <div className="page page-narrow stack-lg">
        <section className="card stack">
          <h2>Your details</h2>
          <div className="grid-2">
            <div className="stack-sm">
              <span className="eyebrow">Name</span>
              <span>{profile.full_name}</span>
            </div>
            <div className="stack-sm">
              <span className="eyebrow">{isLecturer ? 'Email' : 'Index number'}</span>
              <span className="mono">{isLecturer ? session.user.email : profile.index_no}</span>
            </div>
          </div>
          {!isLecturer && (
            <p className="small muted">If your name is spelt wrongly, ask your lecturer to correct it on the class list.</p>
          )}
        </section>

        <form className="card stack" onSubmit={change}>
          <h2>Change password</h2>
          {error && <div className="notice notice-error">{error}</div>}
          <div className="grid-2">
            <Field label="New password">
              <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Type it again">
              <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </form>

        <div>
          <button type="button" className="btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
