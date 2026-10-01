const dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const fullFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export const fmtDate = (d) => (d ? dateFmt.format(new Date(d)) : '—');
export const fmtDateTime = (d) => (d ? dateTimeFmt.format(new Date(d)) : '—');
export const fmtFull = (d) => (d ? fullFmt.format(new Date(d)) : '—');

export function fmtNumber(n, maxDecimals = 2) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  return num.toLocaleString('en-US', { maximumFractionDigits: maxDecimals });
}

export function pct(score, max) {
  if (score === null || score === undefined || !max) return null;
  return Math.round((Number(score) / Number(max)) * 100);
}

export function relative(d) {
  if (!d) return '';
  const diff = new Date(d).getTime() - Date.now();
  const mins = Math.round(diff / 60000);
  const abs = Math.abs(mins);
  const past = mins < 0;
  let text;
  if (abs < 1) return 'just now';
  if (abs < 60) text = `${abs} min`;
  else if (abs < 60 * 24) text = `${Math.round(abs / 60)} h`;
  else text = `${Math.round(abs / 1440)} days`;
  return past ? `${text} ago` : `in ${text}`;
}

export function dayChip(d) {
  if (!d) return { day: '—', date: '' };
  const x = new Date(d);
  return {
    day: x.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(),
    date: String(x.getDate()).padStart(2, '0'),
    month: x.toLocaleDateString('en-GB', { month: 'short' }),
  };
}

// For <input type="datetime-local">
export function toLocalInput(d) {
  if (!d) return '';
  const x = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
export function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null;
}

export function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(text) {
  const words = String(text || '').replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// Replace {D} style tokens in a question with the student's own figures.
export function fillVars(text, vars) {
  if (!vars || !Object.keys(vars).length) return text;
  return String(text).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? fmtNumber(vars[k], 6) : m,
  );
}

// Course colours — all dark enough for white text on top.
export const COURSE_COLORS = [
  '#0E6B63', '#0F766E', '#276749', '#3F6212', '#4D7C0F', '#166534',
  '#1E40AF', '#2A4F8F', '#1D4ED8', '#0369A1', '#155E75', '#3730A3',
  '#6B3B6E', '#7E22CE', '#86198F', '#9D174D', '#BE123C', '#8A2A18',
  '#9A5B0B', '#B45309', '#A16207', '#7C2D12', '#57534E', '#3F5563',
  '#334155', '#1F2937', '#14532D', '#4A044E',
];

// Contrast of white text on a colour (WCAG). 4.5 or more is comfortable to read.
export function contrastWithWhite(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return 1.05 / (L + 0.05);
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
}
