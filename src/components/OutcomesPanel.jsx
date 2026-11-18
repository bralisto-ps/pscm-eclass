import { useState } from 'react';
import { rpc, rpcAll } from '../lib/supabase.js';
import { downloadExcel } from '../lib/sheets.js';
import Icon from './Icon.jsx';
import { Bar, Confirm, Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from './ui.jsx';

export default function OutcomesPanel({ course, readOnly = false }) {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(
    () => rpcAll('course_clo_attainment', { p_course: course.id }),
    [course.id]
  );
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [act, busy] = useAction();

  async function remove() {
    const ok = await act(() => rpc('delete_course_outcome', { p_id: removing.id }), 'Outcome removed.');
    setRemoving(null);
    if (ok !== undefined) reload();
  }

  async function exportReport() {
    const rows = data || [];
    await downloadExcel(
      `${course.code}-CLO-Attainment.xlsx`,
      [
        ['CLO Code', 'Mapped PLO', 'Outcome Title', 'Target %', 'Tagged Questions', 'Tagged Assignments', 'Assessed Students', 'Average %', 'Met Target', 'Met Rate %'],
        ...rows.map((r) => {
          const metRate = r.assessed_students > 0 ? Math.round((r.met_count / r.assessed_students) * 100) : '';
          return [
            r.code,
            r.plo_code || '',
            r.title,
            Number(r.target_pct || 60),
            Number(r.question_count || 0),
            Number(r.assignment_count || 0),
            Number(r.assessed_students || 0),
            r.avg_pct !== null && r.avg_pct !== undefined ? Number(r.avg_pct) : '',
            Number(r.met_count || 0),
            metRate,
          ];
        }),
      ],
      [12, 12, 34, 10, 16, 18, 16, 12, 12, 12]
    );
    toast('CLO/PLO attainment report exported.');
  }

  if (loading) return <Loading label="Calculating CLO attainment…" />;
  if (error) {
    return (
      <div className="stack" style={{ maxWidth: 920 }}>
        <ErrorNote error={error} onRetry={reload} />
      </div>
    );
  }

  const rows = data || [];

  return (
    <div className="stack-lg" style={{ maxWidth: 960 }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Course Learning Outcomes (CLO / PLO)</h2>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            Define learning outcomes and tag quiz questions or assignments to measure real-time cohort attainment for accreditation audits.
          </p>
        </div>
        <div className="row-wrap" style={{ gap: 8 }}>
          {rows.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={exportReport}>
              <Icon name="download" size={15} /> Export Excel
            </button>
          )}
          {!readOnly && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing({})}>
              <Icon name="plus" size={15} /> Add CLO
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <Empty icon="award" title="No learning outcomes yet">
            Add CLO1, CLO2, etc. and map them to quiz questions or assignments to track outcome attainment automatically.
          </Empty>
        </div>
      ) : (
        <div className="stack">
          {rows.map((r) => {
            const avg = r.avg_pct !== null && r.avg_pct !== undefined ? Number(r.avg_pct) : null;
            const target = Number(r.target_pct || 60);
            const metRate = r.assessed_students > 0 ? Math.round((r.met_count / r.assessed_students) * 100) : null;
            const metTarget = avg !== null && avg >= target;
            return (
              <section key={r.id} className="card stack-sm">
                <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                  <div className="stack-sm" style={{ gap: 4, flex: 1, minWidth: 240 }}>
                    <div className="row-wrap" style={{ gap: 8 }}>
                      <span className="badge badge-teal mono">{r.code}</span>
                      {r.plo_code && <span className="badge badge-blue mono">PLO: {r.plo_code}</span>}
                      <strong style={{ fontSize: 16 }}>{r.title}</strong>
                    </div>
                    {r.description && <p className="small muted" style={{ margin: 0 }}>{r.description}</p>}
                    <div className="row-wrap tiny muted" style={{ gap: 12 }}>
                      <span>Target: <strong>{target}%</strong></span>
                      <span>{r.question_count || 0} tagged question{r.question_count === 1 ? '' : 's'}</span>
                      <span>{r.assignment_count || 0} tagged assignment{r.assignment_count === 1 ? '' : 's'}</span>
                      <span>{r.assessed_students || 0} student{r.assessed_students === 1 ? '' : 's'} assessed</span>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    {avg !== null ? (
                      <span className={`badge ${metTarget ? 'badge-teal' : 'badge-amber'} mono`}>
                        Avg {avg}%{metRate !== null ? ` · ${metRate}% met target` : ''}
                      </span>
                    ) : (
                      <span className="badge">No marks yet</span>
                    )}
                    {!readOnly && (
                      <>
                        <button type="button" className="icon-btn plain" onClick={() => setEditing(r)} aria-label={`Edit ${r.code}`}>
                          <Icon name="edit" size={16} />
                        </button>
                        <button type="button" className="icon-btn plain" onClick={() => setRemoving(r)} aria-label={`Delete ${r.code}`}>
                          <Icon name="trash" size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {avg !== null && <Bar value={avg} color={metTarget ? 'var(--teal)' : 'var(--amber)'} />}
              </section>
            );
          })}
        </div>
      )}

      {editing && (
        <OutcomeModal
          course={course}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      {removing && (
        <Confirm
          title={`Remove ${removing.code}?`}
          danger
          confirmLabel="Remove"
          busy={busy}
          message="Tagged quiz questions and assignments keep their scores, but this outcome row will be removed."
          onClose={() => setRemoving(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

function OutcomeModal({ course, initial, onClose, onSaved }) {
  const [act, busy] = useAction();
  const [code, setCode] = useState(initial.code || '');
  const [ploCode, setPloCode] = useState(initial.plo_code || '');
  const [title, setTitle] = useState(initial.title || '');
  const [description, setDescription] = useState(initial.description || '');
  const [targetPct, setTargetPct] = useState(initial.target_pct ?? 60);

  async function save() {
    const ok = await act(
      () => rpc('save_course_outcome', {
        p_course: course.id,
        p_code: code.trim(),
        p_title: title.trim(),
        p_plo_code: ploCode.trim(),
        p_description: description.trim(),
        p_target_pct: Number(targetPct) || 60,
        p_id: initial.id || null,
      }),
      'Learning outcome saved.'
    );
    if (ok !== undefined) onSaved();
  }

  return (
    <Modal
      title={initial.id ? `Edit ${initial.code}` : 'Add Course Learning Outcome'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || !code.trim() || !title.trim()} onClick={save}>
            Save outcome
          </button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="CLO Code" hint="e.g. CLO1">
          <input className="input mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CLO1" autoFocus />
        </Field>
        <Field label="Mapped PLO" hint="optional, e.g. PLO3">
          <input className="input mono" value={ploCode} onChange={(e) => setPloCode(e.target.value)} placeholder="PLO3" />
        </Field>
      </div>
      <Field label="Outcome title">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Apply EOQ and safety stock models to stochastic demand" />
      </Field>
      <Field label="Description" hint="optional">
        <textarea className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Attainment target (%)" hint="benchmark for passing this outcome">
        <input className="input mono" type="number" min="0" max="100" style={{ maxWidth: 140 }} value={targetPct} onChange={(e) => setTargetPct(e.target.value)} />
      </Field>
    </Modal>
  );
}
