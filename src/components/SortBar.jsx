import Icon from './Icon.jsx';

export function SortSelect({ value, onChange, options, label = 'Sort by' }) {
  return (
    <label className="row small" style={{ gap: 6 }}>
      <span className="muted">{label}</span>
      <select
        aria-label={label}
        className="select"
        style={{ minHeight: 40, width: 'auto', fontSize: 13 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SortTh({
  label,
  sub,
  ascKey,
  descKey,
  defaultDir = 'asc',
  current,
  onSort,
  className = '',
  style,
}) {
  const isAsc = current === ascKey;
  const isDesc = current === descKey;
  const active = isAsc || isDesc;
  const isNum = className.split(/\s+/).includes('num');

  function toggle() {
    if (isAsc && descKey) onSort(descKey);
    else if (isDesc && ascKey) onSort(ascKey);
    else onSort(defaultDir === 'desc' && descKey ? descKey : ascKey || descKey);
  }

  return (
    <th className={className} style={style}>
      <button
        type="button"
        className={`th-sort-btn ${isNum ? 'num' : ''} ${active ? 'active' : ''}`}
        onClick={toggle}
        title={`Sort by ${label}`}
      >
        <span>
          {label}
          {sub}
        </span>
        {active ? (
          <Icon name={isAsc ? 'arrowUp' : 'arrowDown'} size={12} />
        ) : (
          <span className="tiny muted" style={{ opacity: 0.45, fontSize: 10 }}>⇅</span>
        )}
      </button>
    </th>
  );
}
