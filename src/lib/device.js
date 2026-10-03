// A random id kept in this browser, plus the phone/computer type.
// Used to spot one phone being used for several students.
function deviceId() {
  try {
    let id = localStorage.getItem('pscm-device');
    if (!id) {
      id = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
      localStorage.setItem('pscm-device', id);
    }
    return id;
  } catch {
    return null;
  }
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${deviceId() || 'nostore'} ${os} ${br}`;
}

// Only the stored id counts for attendance; without it we send nothing rather
// than lumping every such phone together.
export function attendanceDevice() {
  return deviceId();
}
