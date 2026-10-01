import { useState } from 'react';
import { rpc } from '../lib/supabase.js';
import { Modal, useToast } from './ui.jsx';

export default function CheckInModal({ courseId, courseCode, onClose, onDone }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e?.preventDefault();
    const c = code.replace(/\D/g, '');
    if (c.length !== 6) return setMsg('The code has 6 digits.');
    setBusy(true);
    setMsg('');
    try {
      const r = await rpc('check_in', { p_course: courseId, p_code: c });
      if (r.ok) {
        toast(`Checked in — ${r.session}`);
        onDone?.();
        onClose();
      } else {
        setMsg(r.message);
        setCode('');
      }
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Check in · ${courseCode}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Checking…' : 'Check in'}</button></>}>
      <form onSubmit={submit} className="stack">
        <p className="small muted">Type the 6-digit code shown on the screen in class. It changes every 30 seconds.</p>
        <label className="field">
          <span className="sr-only">Attendance code</span>
          <input className="input mono" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7}
            value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            style={{ fontSize: 34, letterSpacing: '0.3em', textAlign: 'center', minHeight: 64 }} placeholder="000000" />
        </label>
        {msg && <div className="notice notice-error" role="alert">{msg}</div>}
      </form>
    </Modal>
  );
}
