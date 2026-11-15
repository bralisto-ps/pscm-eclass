import { useEffect, useState } from 'react';

const KEY = 'pscm_branding_v1';
const EVENT = 'pscm-branding-change';

export const DEFAULT_BRANDING = {
  portalName: 'PSCM E-class',
  department: 'Department of Procurement & Supply Chain Management',
  coordinator: 'L.O Appiah, PhD',
  logoDataUrl: '',
};

export function getBranding() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_BRANDING;
    const parsed = JSON.parse(raw);
    return {
      portalName: String(parsed?.portalName || '').trim() || DEFAULT_BRANDING.portalName,
      department: String(parsed?.department || '').trim() || DEFAULT_BRANDING.department,
      coordinator: String(parsed?.coordinator || '').trim() || DEFAULT_BRANDING.coordinator,
      logoDataUrl: typeof parsed?.logoDataUrl === 'string' ? parsed.logoDataUrl : '',
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}

export function setBranding(next) {
  const merged = {
    portalName: String(next?.portalName || '').trim() || DEFAULT_BRANDING.portalName,
    department: String(next?.department || '').trim() || DEFAULT_BRANDING.department,
    coordinator: String(next?.coordinator || '').trim() || DEFAULT_BRANDING.coordinator,
    logoDataUrl: typeof next?.logoDataUrl === 'string' ? next.logoDataUrl : '',
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    // ignore storage quota errors
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: merged }));
  return merged;
}

export function resetBranding() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: DEFAULT_BRANDING }));
  return DEFAULT_BRANDING;
}

export function useBranding() {
  const [brand, setState] = useState(getBranding);
  useEffect(() => {
    const onChange = (e) => setState(e.detail || getBranding());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return [brand, setBranding, resetBranding];
}

export function resizeCrestFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file selected.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const size = 180;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.min(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}
