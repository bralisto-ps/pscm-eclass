const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareText(a, b, dir = 'asc', emptyLast = true) {
  const sa = String(a ?? '').trim();
  const sb = String(b ?? '').trim();
  if (emptyLast && (!sa || !sb)) {
    if (!sa && !sb) return 0;
    return !sa ? 1 : -1;
  }
  const cmp = collator.compare(sa, sb);
  return dir === 'desc' ? -cmp : cmp;
}

export function compareNumber(a, b, dir = 'desc') {
  const na = a === null || a === undefined || a === '' ? NaN : Number(a);
  const nb = b === null || b === undefined || b === '' ? NaN : Number(b);
  const va = Number.isFinite(na);
  const vb = Number.isFinite(nb);
  if (!va && !vb) return 0;
  if (!va) return 1;
  if (!vb) return -1;
  return dir === 'desc' ? nb - na : na - nb;
}

export function compareDate(a, b, dir = 'desc') {
  const ta = a ? new Date(a).getTime() : NaN;
  const tb = b ? new Date(b).getTime() : NaN;
  const va = Number.isFinite(ta);
  const vb = Number.isFinite(tb);
  if (!va && !vb) return 0;
  if (!va) return 1;
  if (!vb) return -1;
  return dir === 'desc' ? tb - ta : ta - tb;
}

export function compareBool(a, b, dir = 'desc') {
  const ba = Boolean(a) ? 1 : 0;
  const bb = Boolean(b) ? 1 : 0;
  return dir === 'desc' ? bb - ba : ba - bb;
}

export function byNameIndex(a, b) {
  return compareText(a.full_name, b.full_name, 'asc') || compareText(a.index_no, b.index_no, 'asc');
}
