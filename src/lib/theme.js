import { useEffect, useState } from 'react';

const KEY = 'pscm_theme';
const EVENT = 'pscm-theme-change';

export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // ignore storage errors
  }
  return 'light';
}

export function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  const root = document.documentElement;
  root.classList.toggle('dark', next === 'dark');
  root.style.colorScheme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#0b1120' : '#090e17');
  return next;
}

export function initTheme() {
  return applyTheme(getTheme());
}

export function setTheme(theme) {
  const next = applyTheme(theme);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}

export function useTheme() {
  const [theme, setState] = useState(getTheme);
  useEffect(() => {
    const onChange = (e) => setState(e.detail || getTheme());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  return [theme, setTheme, toggle];
}
