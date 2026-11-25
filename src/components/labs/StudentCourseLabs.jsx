import { lazy, Suspense, useMemo, useState } from 'react';
import Icon from '../Icon.jsx';
import { Empty, Loading } from '../ui.jsx';
import { parseCourseMeta } from '../../lib/courseMeta.js';
import { DATA_POLICIES, getLabDef } from '../../lib/labsCatalog.js';
import { fmtFull, fmtNumber, relative } from '../../lib/format.js';

const LabRunnerModal = lazy(() => import('./LabRunnerModal.jsx'));
const LiveLabSessionModal = lazy(() => import('./LiveLabSessionModal.jsx'));

export default function StudentCourseLabs({ course, assignments = [], previewOnly = false, reload }) {
  const [activeLab, setActiveLab] = useState(null);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [liveJoinCode, setLiveJoinCode] = useState('');

  const openLabs = useMemo(() => {
    const meta = parseCourseMeta(course);
    return (meta.labs_config || []).filter((l) => l.enabled !== false && getLabDef(l.labId));
  }, [course]);

  const assignById = useMemo(
    () => new Map((assignments || []).map((a) => [a.id, a])),
    [assignments],
  );

  const liveJoinCard = !previewOnly ? (
    <section className="card-soft between" style={{ padding: '12px 16px', flexWrap: 'wrap', gap: 12 }}>
      <div className="stack-xs" style={{ flex: 1, minWidth: 220 }}>
        <div className="tiny muted">LIVE MULTI-STUDENT CLASSROOM LAB</div>
        <div className="small">
          Running a live simulation in class right now? Enter the 6-letter join code displayed on the projector.
        </div>
      </div>
      <form
        className="row"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          const clean = joinCodeInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (clean.length < 4) return;
          setLiveJoinCode(clean);
        }}
      >
        <input
          className="input mono"
          style={{ width: 132, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}
          placeholder="CODE"
          maxLength={8}
          value={joinCodeInput}
          onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={joinCodeInput.trim().length < 4}>
          Join Live Lab
        </button>
      </form>
    </section>
  ) : null;

  if (!openLabs.length) {
    return (
      <div className="stack" style={{ maxWidth: 860 }}>
        {liveJoinCard}
        <div className="card">
          <Empty icon="flask" title="No software labs opened yet">
            When your lecturer enables interactive software laboratories for {course?.code || 'this course'}, they will appear here.
          </Empty>
        </div>
        {liveJoinCode && (
          <Suspense fallback={<Loading label="Connecting to live classroom lab…" />}>
            <LiveLabSessionModal
              isHost={false}
              initialCode={liveJoinCode}
              courseCode={course?.code || ''}
              onClose={() => setLiveJoinCode('')}
            />
          </Suspense>
        )}
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 920 }}>
      {liveJoinCard}
      {openLabs.map((cfg) => {
        const def = getLabDef(cfg.labId);
        const linked = cfg.linkedAssignmentId ? assignById.get(cfg.linkedAssignmentId) : null;
        const sub = linked?.submission || null;
        const policy = DATA_POLICIES.find((p) => p.id === cfg.dataMode)?.short || 'Course or own data';

        return (
          <section key={cfg.labId} className="card stack-sm">
            <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
              <div className="stack-xs" style={{ flex: 1, minWidth: 240 }}>
                <div className="tiny muted">
                  {def.code} · {def.domain} · {policy}
                  {cfg.customDataset?.name ? ` · Dataset: ${cfg.customDataset.name}` : ''}
                </div>
                <h2 style={{ margin: 0, fontSize: 18 }}>{cfg.title || def.title}</h2>
                <p className="small muted" style={{ margin: '2px 0 0' }}>
                  {cfg.instructions || def.summary}
                </p>

                {linked ? (
                  <div className="small" style={{ marginTop: 6 }}>
                    <strong>Graded Assignment:</strong> {linked.title} · {fmtNumber(linked.max_marks)} marks
                    {linked.due_at ? ` · Due ${fmtFull(linked.due_at)} (${relative(linked.due_at)})` : ''}
                  </div>
                ) : (
                  <div className="tiny muted" style={{ marginTop: 6 }}>
                    Practice Lab · Export PDF reports anytime
                  </div>
                )}
              </div>

              <div className="stack-xs" style={{ alignItems: 'flex-end' }}>
                {linked && (
                  <span
                    className="tiny mono"
                    style={{
                      fontWeight: 700,
                      color: sub?.marked && (linked.released || linked.results_released)
                        ? 'var(--teal-700)'
                        : sub
                          ? 'var(--teal-700)'
                          : 'var(--amber)',
                    }}
                  >
                    {sub?.marked && (linked.released || linked.results_released)
                      ? `● MARKED: ${fmtNumber(sub.marks)} / ${fmtNumber(linked.max_marks)}`
                      : sub
                        ? '● SUBMITTED'
                        : '▲ NOT SUBMITTED'}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setActiveLab({ cfg, linked })}
                >
                  <Icon name="flask" size={16} /> {sub ? 'Open Lab / View Draft' : 'Launch Interactive Lab'}
                </button>
              </div>
            </div>
          </section>
        );
      })}

      {liveJoinCode && (
        <Suspense fallback={<Loading label="Connecting to live classroom lab…" />}>
          <LiveLabSessionModal
            isHost={false}
            initialCode={liveJoinCode}
            courseCode={course?.code || ''}
            onClose={() => setLiveJoinCode('')}
          />
        </Suspense>
      )}

      {activeLab && (
        <Suspense fallback={<Loading label="Opening interactive lab…" />}>
          <LabRunnerModal
            labConfig={activeLab.cfg}
            course={course}
            assignment={activeLab.linked}
            previewOnly={previewOnly}
            onSubmitted={reload}
            onClose={() => setActiveLab(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
