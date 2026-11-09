import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase.js';
import { attendanceDevice } from '../lib/device.js';
import { Modal, useToast } from './ui.jsx';
import Icon from './Icon.jsx';

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
  const [gpsCheckStatus, setGpsCheckStatus] = useState(null); // { ok: bool, text: string }

  // find out whether this session asks for row number or GPS geofence
  useEffect(() => {
    let alive = true;
    rpc('my_open_attendance').then((list) => {
      const s = (list || []).find((x) => x.course_id === courseId);
      if (alive && s) {
        setSessionInfo(s);
        if (askRowProp === undefined) setAskRow(s.ask_row !== false);
        // If GPS is required, proactively test GPS permission
        if (s.lat != null && s.lng != null && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (!alive) return;
              const dist = calculateDistanceMeters(pos.coords.latitude, pos.coords.longitude, s.lat, s.lng);
              const maxDist = s.radius_meters || 100;
              if (dist <= maxDist) {
                setGpsCheckStatus({ ok: true, text: `Location verified: ~${dist}m from lectern (inside hall)` });
              } else {
                setGpsCheckStatus({ ok: false, text: `Warning: You appear to be ${dist}m away (must be within ${maxDist}m)` });
              }
            },
            () => {
              if (alive) setGpsCheckStatus({ ok: null, text: 'Tap check-in to allow GPS location permission' });
            },
            { enableHighAccuracy: true, timeout: 6000 }
          );
        }
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [courseId, askRowProp]);

  async function submit(e) {
    e?.preventDefault();
    const c = code.replace(/\D/g, '');
    if (c.length !== 6) return setMsg('The code has 6 digits.');
    const r = Number(row);
    if (askRow && (!row || !Number.isInteger(r) || r < 1 || r > 200)) {
      return setMsg('Enter the number of the row you are sitting in.');
    }

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
        return setMsg('Location access is required to verify you are inside the lecture hall. Please enable location permissions in your browser.');
      }
    }

    try {
      const res = await rpc('check_in', {
        p_course: courseId,
        p_code: c,
        p_row: askRow ? r : null,
        p_device: attendanceDevice(),
      });
      if (res.ok) {
        toast(`Checked in successfully — ${res.session}`);
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

  const hasGps = sessionInfo && sessionInfo.lat != null && sessionInfo.lng != null;

  return (
    <Modal
      title={`Check In · ${courseCode}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || code.length < 6}>
            {busy ? 'Verifying & Checking In…' : 'Submit Check-In'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="stack">
        {/* Attendance Security Info Banner */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 8,
            background: hasGps ? 'var(--teal-50, #f0fdfa)' : 'var(--surface-2, #f8fafc)',
            border: `1px solid ${hasGps ? 'var(--teal, #0d9488)' : 'var(--line)'}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: hasGps ? 'var(--teal-900, #134e4a)' : 'inherit' }}>
              <Icon name={hasGps ? 'map-pin' : 'clock'} size={16} />
              {hasGps ? 'GPS Location Geofence Active' : 'Live In-Class Attendance'}
            </span>
            <span className="badge badge-teal" style={{ fontSize: 11 }}>
              {hasGps ? 'Geofenced' : '30s Rotating Code'}
            </span>
          </div>

          <p className="tiny muted" style={{ margin: 0 }}>
            {hasGps
              ? `You must be physically inside the lecture hall (${sessionInfo.radius_meters || 100}m radius) to check in.`
              : 'Enter the 6-digit rotating security code projected on the screen in class.'}
          </p>

          {hasGps && gpsCheckStatus && (
            <div
              style={{
                fontSize: 12,
                marginTop: 2,
                color: gpsCheckStatus.ok === true ? 'var(--teal-700, #0f766e)' : gpsCheckStatus.ok === false ? 'var(--red, #dc2626)' : 'var(--text-2)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Icon name={gpsCheckStatus.ok === true ? 'check' : gpsCheckStatus.ok === false ? 'alert' : 'info'} size={14} />
              {gpsCheckStatus.text}
            </div>
          )}
        </div>

        {/* 6-digit code input */}
        <label className="field">
          <span className="field-label" style={{ fontWeight: 600 }}>Enter 6-Digit Code</span>
          <input
            className="input mono"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            style={{
              fontSize: 32,
              letterSpacing: '0.35em',
              textAlign: 'center',
              minHeight: 60,
              fontWeight: 700,
              background: 'var(--surface)',
            }}
            placeholder="000000"
          />
          <span className="tiny muted" style={{ textAlign: 'center' }}>
            The code updates every 30 seconds on the projector screen.
          </span>
        </label>

        {askRow && (
          <label className="field">
            <span className="field-label" style={{ fontWeight: 600 }}>Which row are you sitting in?</span>
            <input
              className="input mono"
              inputMode="numeric"
              type="number"
              min="1"
              max="200"
              aria-label="Row number"
              value={row}
              onChange={(e) => setRow(e.target.value)}
              style={{ maxWidth: 140, fontSize: 22, fontWeight: 600 }}
              placeholder="e.g. 4"
            />
            <span className="tiny muted">Count from the front row. Rows are spot-checked in class against head counts.</span>
          </label>
        )}

        {msg && <div className="notice notice-error" role="alert">{msg}</div>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
