// Zero-dependency pure-JS EAN-13 / UPC-A 1D barcode decoder from grayscale scanlines.
// Used as automatic fallback in ScanItLab when native BarcodeDetector is unavailable (iOS Safari / Firefox).
import { parseAndValidateGtin } from './psisLabEngine.js';

// Standard GS1 EAN-13 module width patterns (4 alternating space/bar widths summing to 7 modules)
const L_PATTERNS = [
  '3211', '2221', '2122', '1411', '1132',
  '1231', '1114', '1312', '1213', '3112',
];
const G_PATTERNS = [
  '1123', '1222', '2212', '1141', '2311',
  '1321', '4111', '2131', '3121', '2113',
];
// R-patterns are identical width sequences to L-patterns (starting with bar instead of space)
const R_PATTERNS = L_PATTERNS;

// First digit of EAN-13 is encoded by the L/G parity pattern of the 6 left digits
const FIRST_DIGIT_BY_PARITY = {
  LLLLLL: '0',
  LLGLGG: '1',
  LLGGLG: '2',
  LLGGGL: '3',
  LGLLGG: '4',
  LGGLLG: '5',
  LGGGLL: '6',
  LGLGLG: '7',
  LGLGGL: '8',
  LGGLGL: '9',
};

function matchDigitPattern(widths, patterns) {
  const sum = widths[0] + widths[1] + widths[2] + widths[3];
  if (sum <= 0) return { digit: -1, err: Infinity };
  const unit = sum / 7;
  const norm = widths.map((w) => w / unit);
  let bestDigit = -1;
  let bestErr = Infinity;
  for (let d = 0; d < patterns.length; d++) {
    const p = patterns[d];
    let err = 0;
    for (let k = 0; k < 4; k++) {
      err += Math.abs(norm[k] - Number(p[k]));
    }
    if (err < bestErr) {
      bestErr = err;
      bestDigit = d;
    }
  }
  return { digit: bestDigit, err: bestErr };
}

function decodeRunsForward(runs) {
  // EAN-13 has 59 runs: 3 start guard (B S B) + 24 left (6x4) + 5 center guard (S B S B S) + 24 right (6x4) + 3 end guard (B S B)
  if (runs.length < 59) return null;

  for (let start = 0; start <= runs.length - 59; start++) {
    if (!runs[start].dark) continue;
    const g0 = runs[start].len;
    const g1 = runs[start + 1].len;
    const g2 = runs[start + 2].len;
    const unit = (g0 + g1 + g2) / 3;
    if (unit < 0.7) continue;
    // Start guard bars must be roughly 1:1:1
    if (
      Math.abs(g0 / unit - 1) > 0.65 ||
      Math.abs(g1 / unit - 1) > 0.65 ||
      Math.abs(g2 / unit - 1) > 0.65
    ) {
      continue;
    }

    // Verify center guard (indices start+27 .. start+31 -> S B S B S, 1:1:1:1:1)
    const cStart = start + 27;
    const cSum =
      runs[cStart].len +
      runs[cStart + 1].len +
      runs[cStart + 2].len +
      runs[cStart + 3].len +
      runs[cStart + 4].len;
    const cUnit = cSum / 5;
    if (cUnit < 0.7 || Math.abs(cUnit - unit) / unit > 0.55) continue;

    // Decode 6 left digits (S B S B)
    let leftDigits = '';
    let parity = '';
    let ok = true;
    for (let i = 0; i < 6; i++) {
      const idx = start + 3 + i * 4;
      const w = [runs[idx].len, runs[idx + 1].len, runs[idx + 2].len, runs[idx + 3].len];
      const lMatch = matchDigitPattern(w, L_PATTERNS);
      const gMatch = matchDigitPattern(w, G_PATTERNS);
      const best = lMatch.err <= gMatch.err ? { ...lMatch, p: 'L' } : { ...gMatch, p: 'G' };
      if (best.err > 1.35 || best.digit < 0) {
        ok = false;
        break;
      }
      leftDigits += String(best.digit);
      parity += best.p;
    }
    if (!ok) continue;

    const firstDigit = FIRST_DIGIT_BY_PARITY[parity];
    if (firstDigit === undefined) continue;

    // Decode 6 right digits (B S B S)
    let rightDigits = '';
    for (let i = 0; i < 6; i++) {
      const idx = start + 32 + i * 4;
      const w = [runs[idx].len, runs[idx + 1].len, runs[idx + 2].len, runs[idx + 3].len];
      const rMatch = matchDigitPattern(w, R_PATTERNS);
      if (rMatch.err > 1.35 || rMatch.digit < 0) {
        ok = false;
        break;
      }
      rightDigits += String(rMatch.digit);
    }
    if (!ok) continue;

    const candidate = firstDigit + leftDigits + rightDigits;
    const parsed = parseAndValidateGtin(candidate);
    if (parsed.valid) return candidate;
  }

  return null;
}

/**
 * Decodes an EAN-13 (or UPC-A as 0-prefixed EAN-13) barcode from a 1D luminance array (0-255).
 * Tests both forward and upside-down scanline directions across adaptive threshold offsets.
 */
export function decodeEan13FromLuminance(luma) {
  const n = luma?.length || 0;
  if (n < 95) return null;

  let minL = 255;
  let maxL = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = luma[i];
    if (v < minL) minL = v;
    if (v > maxL) maxL = v;
    sum += v;
  }
  if (maxL - minL < 24) return null; // Too little contrast

  const mid = (minL + maxL) * 0.5;
  const avg = sum / n;
  const thresholds = [mid, avg, mid * 0.88 + avg * 0.12, mid * 1.12];

  for (const thr of thresholds) {
    const runs = [];
    let curDark = luma[0] < thr;
    let curLen = 1;
    for (let i = 1; i < n; i++) {
      const dark = luma[i] < thr;
      if (dark === curDark) {
        curLen += 1;
      } else {
        runs.push({ dark: curDark, len: curLen });
        curDark = dark;
        curLen = 1;
      }
    }
    runs.push({ dark: curDark, len: curLen });

    const fwd = decodeRunsForward(runs);
    if (fwd) return fwd;

    const rev = decodeRunsForward([...runs].reverse());
    if (rev) return rev;
  }

  return null;
}

/**
 * Generates a synthetic EAN-13 bit vector (95 modules: 1=dark, 0=light) for verification & testing.
 */
export function encodeEan13Modules(code13) {
  const digits = String(code13 || '').replace(/\D+/g, '');
  if (digits.length !== 13) return null;
  const first = digits[0];
  const parityEntry = Object.entries(FIRST_DIGIT_BY_PARITY).find(([, d]) => d === first);
  if (!parityEntry) return null;
  const parity = parityEntry[0];

  const bits = [1, 0, 1]; // Start guard
  // Left 6 digits (S B S B -> 0, 1, 0, 1)
  for (let i = 0; i < 6; i++) {
    const d = Number(digits[i + 1]);
    const pat = parity[i] === 'L' ? L_PATTERNS[d] : G_PATTERNS[d];
    for (let k = 0; k < 4; k++) {
      const dark = k % 2 === 1 ? 1 : 0;
      for (let r = 0; r < Number(pat[k]); r++) bits.push(dark);
    }
  }
  bits.push(0, 1, 0, 1, 0); // Center guard
  // Right 6 digits (B S B S -> 1, 0, 1, 0)
  for (let i = 0; i < 6; i++) {
    const d = Number(digits[i + 7]);
    const pat = R_PATTERNS[d];
    for (let k = 0; k < 4; k++) {
      const dark = k % 2 === 0 ? 1 : 0;
      for (let r = 0; r < Number(pat[k]); r++) bits.push(dark);
    }
  }
  bits.push(1, 0, 1); // End guard
  return bits;
}

/**
 * Scans multiple horizontal strips across an HTMLVideoElement using an offscreen canvas.
 * Works on iOS Safari, Firefox, and older Android WebViews without native BarcodeDetector.
 */
export function decodeBarcodeFromVideoCanvas(videoEl, canvasEl) {
  if (!videoEl || !canvasEl || videoEl.readyState < 2) return null;
  const vw = videoEl.videoWidth || 0;
  const vh = videoEl.videoHeight || 0;
  if (vw < 120 || vh < 80) return null;

  const targetW = Math.min(vw, 720);
  const targetH = Math.round((vh / vw) * targetW);
  if (canvasEl.width !== targetW || canvasEl.height !== targetH) {
    canvasEl.width = targetW;
    canvasEl.height = targetH;
  }
  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(videoEl, 0, 0, targetW, targetH);

  // Sample 7 horizontal scanlines concentrated across the middle band of the viewfinder
  const yFractions = [0.5, 0.44, 0.56, 0.38, 0.62, 0.3, 0.7];
  for (const frac of yFractions) {
    const y = Math.min(targetH - 1, Math.max(0, Math.floor(targetH * frac)));
    const imgData = ctx.getImageData(0, y, targetW, 1).data;
    const luma = new Uint8Array(targetW);
    for (let x = 0; x < targetW; x++) {
      const off = x * 4;
      luma[x] = Math.round(0.299 * imgData[off] + 0.587 * imgData[off + 1] + 0.114 * imgData[off + 2]);
    }
    const found = decodeEan13FromLuminance(luma);
    if (found) return found;
  }
  return null;
}
