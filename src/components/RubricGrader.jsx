import { useMemo, useState } from 'react';
import { RUBRIC_PRESETS } from '../lib/assignmentMeta.js';
import { fmtNumber } from '../lib/format.js';
import Icon from './Icon.jsx';

const LEVEL_STEPS = [
  { label: '0%', pct: 0 },
  { label: '50%', pct: 0.5 },
  { label: '75%', pct: 0.75 },
  { label: '100%', pct: 1 },
];

export function RubricEditor({ criteria = [], maxMarks = 100, onChange, compact = false }) {
  const sum = criteria.reduce((s, c) => s + (Number(c.maxMarks) || 0), 0);
  const diff = Number((Number(maxMarks || 0) - sum).toFixed(2));

  function addCriterion() {
    onChange([
      ...criteria,
      {
        id: `c-${Date.now()}-${criteria.length + 1}`,
        title: `Criterion ${criteria.length + 1}`,
        maxMarks: Math.max(1, Math.round((Number(maxMarks || 10) / Math.max(1, criteria.length + 1)) * 2) / 2),
      },
    ]);
  }

  function update(idx, patch) {
    onChange(criteria.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function remove(idx) {
    onChange(criteria.filter((_, i) => i !== idx));
  }

  function applyPreset(presetId) {
    const p = RUBRIC_PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    onChange(p.build(Number(maxMarks) || 10));
  }

  return (
    <div className="stack-sm" style={{ padding: compact ? '10px 12px' : '12px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <span className="eyebrow">Marking Rubric Criteria</span>
          <div className="tiny muted">
            {criteria.length === 0
              ? 'Optional — add clickable criteria so marking automatically totals scores & structures feedback.'
              : `Criteria total: ${fmtNumber(sum)} / ${fmtNumber(maxMarks)} marks${Math.abs(diff) > 0.01 ? ` (${diff > 0 ? `+${fmtNumber(diff)} remaining` : `${fmtNumber(Math.abs(diff))} over`})` : ' · Balanced'}`}
          </div>
        </div>
        <div className="row-wrap" style={{ gap: 6 }}>
          {RUBRIC_PRESETS.map((p) => (
            <button key={p.id} type="button" className="btn btn-sm" onClick={() => applyPreset(p.id)}>
              {p.label.split(' (')[0]}
            </button>
          ))}
          <button type="button" className="btn btn-sm btn-primary" onClick={addCriterion}>
            <Icon name="plus" size={14} /> Criterion
          </button>
        </div>
      </div>

      {criteria.length > 0 && (
        <div className="stack-sm" style={{ gap: 6, marginTop: 4 }}>
          {criteria.map((c, idx) => (
            <div key={c.id || idx} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                style={{ flex: 1, minHeight: 36 }}
                value={c.title}
                onChange={(e) => update(idx, { title: e.target.value })}
                placeholder={`Criterion ${idx + 1} (e.g. Analytical Depth)`}
              />
              <label className="row small" style={{ gap: 4, flexShrink: 0 }}>
                <span className="tiny muted">Max</span>
                <input
                  className="input mono"
                  type="number"
                  min="0.5"
                  step="0.5"
                  style={{ width: 76, minHeight: 36 }}
                  value={c.maxMarks}
                  onChange={(e) => update(idx, { maxMarks: Math.max(0.5, Number(e.target.value) || 0.5) })}
                />
              </label>
              <button type="button" className="icon-btn plain" aria-label="Remove criterion" onClick={() => remove(idx)}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const RUBRIC_BLOCK_RE = /\n*\[Rubric Breakdown\][\s\S]*$/m;

export function mergeRubricIntoFeedback(existingFeedback, breakdownLines) {
  const base = String(existingFeedback || '').replace(RUBRIC_BLOCK_RE, '').trim();
  if (!breakdownLines.length) return base;
  const block = `[Rubric Breakdown]\n${breakdownLines.join('\n')}`;
  return base ? `${base}\n\n${block}` : block;
}

export default function RubricGrader({
  criteria: savedCriteria = [],
  maxMarks = 10,
  currentFeedback = '',
  onApply,
  compact = false,
}) {
  const defaultCriteria = useMemo(
    () => (savedCriteria.length > 0 ? savedCriteria : RUBRIC_PRESETS[savedCriteria.length ? 0 : 2].build(Number(maxMarks) || 10)),
    [savedCriteria, maxMarks]
  );

  const [open, setOpen] = useState(savedCriteria.length > 0);
  const [scores, setScores] = useState({}); // criterion.id -> numeric marks

  if (!open) {
    return (
      <div className="row-wrap" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          <Icon name="clipboard" size={14} /> Clickable Rubric ({defaultCriteria.length} criteria)
        </button>
      </div>
    );
  }

  function pick(criterion, val) {
    const next = { ...scores, [criterion.id]: val };
    setScores(next);

    const pickedCount = defaultCriteria.filter((c) => next[c.id] !== undefined).length;
    if (pickedCount === 0) return;

    const rawTotal = defaultCriteria.reduce((s, c) => s + Number(next[c.id] ?? 0), 0);
    const critSum = defaultCriteria.reduce((s, c) => s + Number(c.maxMarks || 0), 0);
    const scaled = critSum > 0 && Math.abs(critSum - Number(maxMarks)) > 0.01
      ? (rawTotal / critSum) * Number(maxMarks)
      : rawTotal;
    const total = Math.min(Number(maxMarks), Math.max(0, Math.round(scaled * 2) / 2));

    const lines = defaultCriteria
      .filter((c) => next[c.id] !== undefined)
      .map((c) => `• ${c.title}: ${fmtNumber(next[c.id])} / ${fmtNumber(c.maxMarks)}`);

    const mergedFeedback = mergeRubricIntoFeedback(currentFeedback, lines);
    onApply(total, mergedFeedback);
  }

  function clear() {
    setScores({});
    const clean = String(currentFeedback || '').replace(RUBRIC_BLOCK_RE, '').trim();
    onApply(null, clean);
  }

  return (
    <div
      className="stack-sm"
      style={{
        padding: compact ? '10px 12px' : '12px 14px',
        borderRadius: 10,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
      }}
    >
      <div className="between" style={{ gap: 8 }}>
        <span className="eyebrow" style={{ color: 'var(--teal-dark)' }}>
          {savedCriteria.length > 0 ? 'Clickable Rubric' : 'Quick Rubric (auto-proportioned)'}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {Object.keys(scores).length > 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={clear}>
              Reset
            </button>
          )}
          {savedCriteria.length === 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
              Hide
            </button>
          )}
        </div>
      </div>

      <div className="stack-sm" style={{ gap: 8 }}>
        {defaultCriteria.map((c) => {
          const maxC = Number(c.maxMarks) || 1;
          const options = [...new Set(LEVEL_STEPS.map((st) => Math.round(maxC * st.pct * 2) / 2))];
          const chosen = scores[c.id];
          return (
            <div key={c.id} className="between" style={{ flexWrap: 'wrap', gap: 8, paddingTop: 4, borderTop: '1px solid var(--line-2)' }}>
              <span className="small" style={{ fontWeight: 600, flex: '1 1 180px' }}>
                {c.title} <span className="tiny muted mono">/{fmtNumber(maxC)}</span>
              </span>
              <div className="chips" role="group" aria-label={`Score ${c.title}`}>
                {options.map((val, idx) => {
                  const active = chosen === val;
                  const lbl = idx === 0 && val === 0 ? '0' : idx === options.length - 1 ? `${fmtNumber(val)} (Full)` : fmtNumber(val);
                  return (
                    <button
                      key={val}
                      type="button"
                      className="chip"
                      aria-pressed={active}
                      onClick={() => pick(c, val)}
                      style={{ minHeight: 30, padding: '2px 10px', fontSize: 12 }}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
