import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase.js';
import { attendanceDevice } from '../lib/device.js';
import { Modal, useToast } from './ui.jsx';

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export default function CheckInModal({ courseId, courseCode, askRow: askRowProp, onClose, onDone }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [row, setRow] = useState('');
  const [askRow, setAskRow] = useState(askRowProp ?? true);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // find out whether this session asks for row number or GPS geofence
  useEffect(() => {
    let alive = true;
    rpc('my_open_attendance').then((list) => {
      const s = (list || []).find((x) => x.course_id === courseId);
      if (alive && s) {
        setSessionInfo(s);
        if (askRowProp === undefined) setAskRow(s.ask_row !== false);
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [courseId, askRowProp]);

  async function submit(e) {
    e?.preventDefault();
    const c = code.replace(/\D/g, '');
    if (c.length !== 6) return setMsg('The code has 6 digits.');
    const r = Number(row);
    if (askRow && (!row || !Number.isInteger(r) || r < 1 || r > 200)) return setMsg('Enter the number of the row you are sitting in.');
    setBusy(true);
    setMsg('');

    // Check GPS geofence if required for this session
    if (sessionInfo && sessionInfo.lat != null && sessionInfo.lng != null) {
      if (!navigator.geolocation) {
        setBusy(false);
        return setMsg('This attendance session requires GPS verification, but your browser does not support Geolocation.');
      }
      setMsg('Verifying your GPS location in the lecture hall…');
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000 });
        });
        const dist = calculateDistanceMeters(pos.coords.latitude, pos.coords.longitude, sessionInfo.lat, sessionInfo.lng);
        const maxDist = sessionInfo.radius_meters || 100;
        if (dist > maxDist) {
          setBusy(false);
          return setMsg(`Check-in rejected: You are ${dist}m away from the lecture hall (allowed: ${maxDist}m). You must be physically inside the hall.`);
        }
      } catch (geoErr) {
        setBusy(false);
        return setMsg('Location access is required to verify you are inside the lecture hall. Please allow location permissions on your phone.');
      }
    }

    try {
      const res = await rpc('check_in', { p_course: courseId, p_code: c, p_row: askRow ? r : null, p_device: attendanceDevice() });
      if (res.ok) {
        toast(`Checked in — ${res.session}`);
        onDone?.();
        onClose();
      } else {
        if (res.need_row) setAskRow(true);
        else setCode('');
        setMsg(res.message);
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
        <p className="small muted">Type the 6-digit code shown on screen. Your device automatically verifies your physical GPS presence in the lecture hall.</p>
        <label className="field">
          <span className="sr-only">Attendance code</span>
          <input className="input mono" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7}
            value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            style={{ fontSize: 34, letterSpacing: '0.3em', textAlign: 'center', minHeight: 64 }} placeholder="000000" />
        </label>
        {askRow && (
          <label className="field">
            <span className="field-label">Which row are you sitting in?</span>
            <input className="input mono" inputMode="numeric" type="number" min="1" max="200" aria-label="Row number"
              value={row} onChange={(e) => setRow(e.target.value)} style={{ maxWidth: 140, fontSize: 22 }} placeholder="e.g. 4" />
            <span className="tiny muted">Count from the front. Rows are checked against a head count, so give your real row.</span>
          </label>
        )}
        {msg && <div className="notice notice-error" role="alert">{msg}</div>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
