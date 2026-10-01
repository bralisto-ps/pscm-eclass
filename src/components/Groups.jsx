import { useMemo } from 'react';

const label = (v) => v || 'Not set';

export function groupOptions(rows) {
  const programmes = [...new Set(rows.map((r) => r.programme || ''))].sort();
  const streams = [...new Set(rows.map((r) => r.stream || ''))].sort();
  return { programmes, streams };
}

export function matchesGroup(r, g) {
  if (g.programme !== '*' && (r.programme || '') !== g.programme) return false;
  if (g.stream !== '*' && (r.stream || '') !== g.stream) return false;
  return true;
}

export const ALL_GROUPS = { programme: '*', stream: '*' };

// Two dropdowns: programme and stream. Hidden when the class list has no groups.
export function GroupFilters({ rows, value, onChange }) {
  const { programmes, streams } = useMemo(() => groupOptions(rows), [rows]);
  const hasProg = programmes.some(Boolean);
  const hasStream = streams.some(Boolean);
  if (!hasProg && !hasStream) return null;
  return (
    <div className="row-wrap">
      {hasProg && (
        <label className="row small" style={{ gap: 6 }}>
          <span className="muted">Programme</span>
          <select aria-label="Filter by programme" className="select" style={{ minHeight: 40, width: 'auto' }} value={value.programme}
            onChange={(e) => onChange({ ...value, programme: e.target.value })}>
            <option value="*">All</option>
            {programmes.map((p) => <option key={p} value={p}>{label(p)}</option>)}
          </select>
        </label>
      )}
      {hasStream && (
        <label className="row small" style={{ gap: 6 }}>
          <span className="muted">Stream</span>
          <select aria-label="Filter by stream" className="select" style={{ minHeight: 40, width: 'auto' }} value={value.stream}
            onChange={(e) => onChange({ ...value, stream: e.target.value })}>
            <option value="*">All</option>
            {streams.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

// One row per programme × stream: students, submitted, average percent.
export function groupSummary(rows, isDone, pctOf) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.programme || ''}\u0000${r.stream || ''}`;
    if (!map.has(key)) map.set(key, { programme: r.programme || '', stream: r.stream || '', students: 0, submitted: 0, sum: 0, n: 0 });
    const g = map.get(key);
    g.students += 1;
    if (isDone(r)) {
      g.submitted += 1;
      const p = pctOf(r);
      if (p !== null && p !== undefined) { g.sum += p; g.n += 1; }
    }
  }
  return [...map.values()]
    .map((g) => ({ ...g, average: g.n ? Math.round(g.sum / g.n) : null }))
    .sort((a, b) => a.programme.localeCompare(b.programme) || a.stream.localeCompare(b.stream));
}

export function GroupSummaryTable({ summary, doneLabel = 'Submitted' }) {
  if (summary.length < 2) return null;
  return (
    <section className="card-flush table-wrap" aria-label="Results by group">
      <div className="card-head"><h2>By programme and stream</h2></div>
      <table className="table">
        <thead><tr><th>Programme</th><th>Stream</th><th className="num">Students</th><th className="num">{doneLabel}</th><th className="num">Average</th></tr></thead>
        <tbody>
          {summary.map((g) => (
            <tr key={g.programme + '|' + g.stream}>
              <td>{label(g.programme)}</td>
              <td>{label(g.stream)}</td>
              <td className="num">{g.students}</td>
              <td className="num">{g.submitted}</td>
              <td className="num">{g.average === null ? '—' : `${g.average}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export { label as groupLabel };
