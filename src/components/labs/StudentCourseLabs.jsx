import { lazy, Suspense, useMemo, useState } from 'react';
import Icon from '../Icon.jsx';
import { Empty, Loading } from '../ui.jsx';
import { parseCourseMeta } from '../../lib/courseMeta.js';
import { findStudentSyndicate, parseAssignmentMeta } from '../../lib/assignmentMeta.js';
import { useAuth } from '../../lib/auth.jsx';
import { DATA_POLICIES, getLabDef } from '../../lib/labsCatalog.js';
import { LAB_TRACK_META } from '../../lib/labScoringBridge.js';
import { buildStudentLabPortfolioText } from '../../lib/labMilestone8Engine.js';
import { buildTypedResponsePdfBlob } from '../../lib/textPdf.js';
import { fmtFull, fmtNumber, relative } from '../../lib/format.js';

const LabRunnerModal = lazy(() => import('./LabRunnerModal.jsx'));
const LiveLabSessionModal = lazy(() => import('./LiveLabSessionModal.jsx'));

export default function StudentCourseLabs({ course, assignments = [], previewOnly = false, reload }) {
  const { profile } = useAuth();
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

  const progressStats = useMemo(() => {
    let gradedTotal = 0;
    let gradedSubmitted = 0;
    let gradedMarked = 0;
    openLabs.forEach((cfg) => {
      const linked = cfg.linkedAssignmentId ? assignById.get(cfg.linkedAssignmentId) : null;
      if (linked) {
        gradedTotal += 1;
        if (linked.submission) gradedSubmitted += 1;
        if (linked.submission?.marked && (linked.released || linked.results_released)) gradedMarked += 1;
      }
    });
    const pct = gradedTotal > 0 ? Math.round((gradedSubmitted / gradedTotal) * 100) : 0;
    return { gradedTotal, gradedSubmitted, gradedMarked, pct };
  }, [openLabs, assignById]);

  const liveJoinCard = !previewOnly ? (
    <section className="card-soft between" style={{ padding: '14px 18px', flexWrap: 'wrap', gap: 12 }}>
      <div className="stack-xs" style={{ flex: 1, minWidth: 230 }}>
        <div className="tiny mono" style={{ color: 'var(--teal-700)', fontWeight: 700 }}>
          ● LIVE MULTI-STUDENT CLASSROOM LAB
        </div>
        <div className="small">
          In class right now? Enter the 6-letter join code displayed on your lecturer’s projector to join the live simulation.
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
          style={{ width: 132, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700 }}
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
      <div className="stack" style={{ maxWidth: 960 }}>
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
    <div className="stack" style={{ maxWidth: 1020 }}>
      {liveJoinCard}

      {/* Graded Lab Completion Progress Banner */}
      {progressStats.gradedTotal > 0 && (
        <section className="card stack-xs" style={{ padding: '14px 18px' }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="small">
              <strong>{course?.code || 'Course'} Lab Progress:</strong>{' '}
              <span className="mono" style={{ fontWeight: 700, color: 'var(--teal-700)' }}>
                {progressStats.gradedSubmitted} / {progressStats.gradedTotal}
              </span>{' '}
              graded lab{progressStats.gradedTotal === 1 ? '' : 's'} submitted
              {progressStats.gradedMarked > 0 ? ` · ${progressStats.gradedMarked} marked & released to CA` : ''}
            </div>
            <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
              <span className="mono tiny" style={{ fontWeight: 700, color: 'var(--teal-700)' }}>
                {progressStats.pct}% COMPLETE
              </span>
              {!previewOnly && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const portfolio = buildStudentLabPortfolioText({
                      course,
                      profile,
                      openLabs,
                      assignById,
                      getLabDefFn: getLabDef,
                    });
                    const blob = buildTypedResponsePdfBlob({
                      title: portfolio.title,
                      studentLine: `${profile?.full_name || 'Student'} (${profile?.index_no || ''})`,
                      submittedAt: new Date().toLocaleDateString(),
                      body: portfolio.body,
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${(course?.code || 'pscm').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-lab-portfolio.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  <Icon name="download" size={13} /> Export Lab Portfolio PDF
                </button>
              )}
            </div>
          </div>
          <div className="lab-progress-track">
            <div className="lab-progress-fill" style={{ width: `${progressStats.pct}%` }} />
          </div>
        </section>
      )}

      {/* 2-Column Studio Lab Gallery */}
      <div className="lab-gallery-grid">
        {openLabs.map((cfg) => {
          const def = getLabDef(cfg.labId);
          const track = LAB_TRACK_META[def.id] || { track: def.domain, accent: 'var(--teal-700)', stage: 'Interactive Lab' };
          const linked = cfg.linkedAssignmentId ? assignById.get(cfg.linkedAssignmentId) : null;
          const sub = linked?.submission || null;
          const policy = DATA_POLICIES.find((p) => p.id === cfg.dataMode)?.short || 'Course or own data';
          const markedReleased = Boolean(sub?.marked && (linked?.released || linked?.results_released));
          const linkedMeta = linked ? parseAssignmentMeta(linked) : null;
          const mySyn = linkedMeta && !previewOnly ? findStudentSyndicate(linkedMeta, profile?.index_no) : null;

          return (
            <article
              key={cfg.labId}
              className="lab-gallery-card"
              style={{ '--lab-accent': track.accent }}
            >
              <div className="stack-xs">
                <div className="between" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="tiny mono" style={{ fontWeight: 700, color: track.accent }}>
                    {def.code} · {track.track.toUpperCase()}
                  </span>
                  {linked ? (
                    <span
                      className="tiny mono"
                      style={{
                        fontWeight: 700,
                        color: markedReleased || sub ? 'var(--teal-700)' : 'var(--amber)',
                      }}
                    >
                      {markedReleased
                        ? `● ${fmtNumber(sub.marks)} / ${fmtNumber(linked.max_marks)}`
                        : sub
                          ? '● SUBMITTED'
                          : '▲ NOT SUBMITTED'}
                    </span>
                  ) : (
                    <span className="tiny mono muted">PRACTICE LAB</span>
                  )}
                </div>

                <h2 style={{ margin: '2px 0 0', fontSize: 17, lineHeight: 1.3 }}>
                  {cfg.title || def.title}
                </h2>

                <div className="tiny muted">
                  {track.stage} · {def.duration} · {policy}
                  {cfg.customDataset?.name ? ` · Dataset: ${cfg.customDataset.name}` : ''}
                  {cfg.uniqueVariant && !cfg.customDataset ? ' · Unique Data Variant' : ''}
                  {Array.isArray(cfg.mappedClos) && cfg.mappedClos.length > 0 ? ` · ${cfg.mappedClos.join(', ')}` : ''}
                </div>

                <p className="small muted" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
                  {cfg.instructions || def.summary}
                </p>
              </div>

              <div className="stack-xs" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                {linked ? (
                  <div className="tiny muted">
                    {mySyn && (
                      <div className="mono" style={{ color: 'var(--teal-700)', fontWeight: 700, marginBottom: 2 }}>
                        ● SYNDICATE: {mySyn.name} ({(mySyn.members || []).length} members · Live Sync Ready)
                      </div>
                    )}
                    <strong style={{ color: 'var(--text)' }}>CA Assignment:</strong> {linked.title} ({fmtNumber(linked.max_marks)} marks)
                    {linked.due_at ? ` · Due ${fmtFull(linked.due_at)} (${relative(linked.due_at)})` : ''}
                  </div>
                ) : (
                  <div className="tiny muted">Ungraded sandbox · Export PDF reports anytime</div>
                )}

                <div className="between" style={{ gap: 8, marginTop: 4 }}>
                  <span className="tiny muted">Auto-saves locally</span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setActiveLab({ cfg, linked })}
                  >
                    <Icon name="flask" size={14} /> {sub ? 'Open Lab / View Draft' : 'Launch Interactive Lab'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
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
