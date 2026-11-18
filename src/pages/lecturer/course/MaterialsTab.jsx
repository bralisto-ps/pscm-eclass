import { lazy, Suspense, useMemo, useState } from 'react';
import { useAuth } from '../../../lib/auth.jsx';
import { rpc, run, supabase, safeFileName } from '../../../lib/supabase.js';
import { isViewOnlyPath, openStoredFile, removeFiles, setViewOnlyFlag, uploadFile, STORAGE_LIMIT_LABEL } from '../../../lib/files.js';
const SecureSlideViewer = lazy(() => import('../../../components/SecureSlideViewer.jsx'));
import { fmtBytes, fmtDateTime, hostOf, relative } from '../../../lib/format.js';
import { isItemLocked, toLocalInputValue } from '../../../lib/courseMeta.js';
import Icon from '../../../components/Icon.jsx';
import BulkNudgeModal from '../../../components/BulkNudgeModal.jsx';
import PscmToolkitModal from '../../../components/PscmToolkit.jsx';
import LiveSlideSyncModal from '../../../components/LiveSlideSyncModal.jsx';
import { Bar, Confirm, Empty, ErrorNote, Field, KindTag, Loading, Modal, Tabs, useAction, useLoad, useToast } from '../../../components/ui.jsx';

const MAX_MB = 25;

function kindFromName(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (/\.(ppt|pptx|key|odp)$/.test(n)) return 'slides';
  if (/\.(doc|docx|odt|rtf|txt|xls|xlsx|csv)$/.test(n)) return 'doc';
  if (/\.(mp4|mov|webm|m4v)$/.test(n)) return 'video';
  return 'file';
}
function kindFromUrl(url) {
  if (/youtube\.com|youtu\.be|vimeo\.com/i.test(url)) return 'video';
  if (/docs\.google\.com\/presentation/i.test(url)) return 'slides';
  if (/\.pdf($|\?)/i.test(url)) return 'pdf';
  return 'link';
}

export default function MaterialsTab({ course }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [modules, materials, stats, quizzes] = await Promise.all([
      run(supabase.from('modules').select('*').eq('course_id', course.id).order('week_no', { nullsFirst: false }).order('position')),
      run(supabase.from('materials').select('*').eq('course_id', course.id).order('position').order('created_at')),
      rpc('material_engagement', { p_course: course.id }).catch(() => null),
      supabase.from('quizzes').select('id, title').eq('course_id', course.id).order('created_at').then((r) => r.data || [], () => []),
    ]);
    const statMap = new Map();
    if (Array.isArray(stats)) {
      stats.forEach((s) => statMap.set(s.material_id, s));
    }
    return { modules, materials, statMap, statsSupported: Array.isArray(stats), quizzes: Array.isArray(quizzes) ? quizzes : [] };
  }, [course.id]);
  const [editingWeek, setEditingWeek] = useState(null); // {} for new
  const [adding, setAdding] = useState(null); // module id or 'general'
  const { profile } = useAuth();
  const [removing, setRemoving] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [viewersOf, setViewersOf] = useState(null);
  const [toolkitOpen, setToolkitOpen] = useState(false);
  const [liveSyncing, setLiveSyncing] = useState(null);
  const [act, busy] = useAction();

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  const general = data.materials.filter((m) => !m.module_id);
  const courseBytes = data.materials.reduce((s, m) => s + (m.size_bytes || 0), 0);
  const totalAccountBytes = Math.max(courseBytes, data.totalUsed || 0);
  const usedBytes = totalAccountBytes;
  const nextWeek = Math.max(0, ...data.modules.map((m) => m.week_no || 0)) + 1;

  async function doRemove() {
    const r = removing;
    await act(async () => {
      if (r.type === 'material') {
        if (r.item.storage_path) await removeFiles('materials', [r.item.storage_path]);
        await run(supabase.from('materials').delete().eq('id', r.item.id));
      } else {
        const files = data.materials.filter((m) => m.module_id === r.item.id && m.storage_path).map((m) => m.storage_path);
        if (files.length) await removeFiles('materials', files);
        await run(supabase.from('modules').delete().eq('id', r.item.id));
      }
    }, 'Deleted.');
    setRemoving(null);
    reload();
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 980 }}>
      <div className="between" style={{ flexWrap: 'wrap' }}>
        <p className="small muted" style={{ maxWidth: 560 }}>
          Organise materials by week. Files you upload here use your total {STORAGE_LIMIT_LABEL} storage
          ({fmtBytes(usedBytes) || '0 KB'} used) — for videos, upload to YouTube (unlisted) or Google Drive and add the link instead.
        </p>
        <div className="row-wrap" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={() => setToolkitOpen(true)}>
            <Icon name="calculator" size={16} /> PSCM Toolkit
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditingWeek({ week_no: nextWeek })}>
            <Icon name="plus" /> Add week
          </button>
        </div>
      </div>

      {data.modules.length === 0 && general.length === 0 && (
        <div className="card">
          <Empty icon="book" title="No materials yet" action={<button type="button" className="btn btn-primary" onClick={() => setEditingWeek({ week_no: 1 })}>Add week 1</button>}>
            Start by adding a week, then upload slides, notes and links into it.
          </Empty>
        </div>
      )}

      {data.modules.map((m) => (
        <WeekCard
          key={m.id}
          title={m.week_no ? `Week ${m.week_no} · ${m.title}` : m.title}
          summary={m.summary}
          unlockAt={m.unlock_at}
          hasPrereq={Boolean(m.prereq_module_id || m.prereq_quiz_id)}
          items={data.materials.filter((x) => x.module_id === m.id)}
          onAdd={() => setAdding(m.id)}
          onEdit={() => setEditingWeek(m)}
          onDeleteWeek={() => setRemoving({ type: 'module', item: m })}
          onDelete={(item) => setRemoving({ type: 'material', item })}
          onPreview={(item) => setPreviewing(item)}
          onLiveSync={(item) => setLiveSyncing(item)}
          onViewers={(item) => setViewersOf(item)}
          onToggleLock={async (item) => {
            const nextPath = setViewOnlyFlag(item.storage_path, !isViewOnlyPath(item.storage_path));
            const ok = await act(
              () => run(supabase.from('materials').update({ storage_path: nextPath }).eq('id', item.id)),
              isViewOnlyPath(item.storage_path) ? 'Download enabled for this PDF.' : 'Set to Read-Only (no download).'
            );
            if (ok !== undefined) reload();
          }}
          statMap={data.statMap}
          statsSupported={data.statsSupported}
          act={act}
        />
      ))}

      <WeekCard
        title="General (not tied to a week)"
        summary="Course outline, reading list, past questions and similar."
        items={general}
        onAdd={() => setAdding('general')}
        onDelete={(item) => setRemoving({ type: 'material', item })}
        onPreview={(item) => setPreviewing(item)}
        onLiveSync={(item) => setLiveSyncing(item)}
        onViewers={(item) => setViewersOf(item)}
        onToggleLock={async (item) => {
          const nextPath = setViewOnlyFlag(item.storage_path, !isViewOnlyPath(item.storage_path));
          const ok = await act(
            () => run(supabase.from('materials').update({ storage_path: nextPath }).eq('id', item.id)),
            isViewOnlyPath(item.storage_path) ? 'Download enabled for this PDF.' : 'Set to Read-Only (no download).'
          );
          if (ok !== undefined) reload();
        }}
        statMap={data.statMap}
        statsSupported={data.statsSupported}
        act={act}
        muted
      />

      {editingWeek && <WeekForm course={course} week={editingWeek} modules={data.modules || []} quizzes={data.quizzes || []} onClose={() => setEditingWeek(null)} onSaved={reload} />}
      {liveSyncing && <LiveSlideSyncModal course={course} material={liveSyncing} isPresenter onClose={() => setLiveSyncing(null)} />}
      {adding && <MaterialForm course={course} moduleId={adding === 'general' ? null : adding} onClose={() => setAdding(null)} onSaved={reload} />}
      {previewing && (
        <Suspense fallback={<div className="secure-reader-backdrop" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>}>
          <SecureSlideViewer
            material={previewing}
            watermarkText={profile?.full_name || 'Faculty Preview'}
            onClose={() => setPreviewing(null)}
          />
        </Suspense>
      )}
      {viewersOf && (
        <MaterialViewersModal
          course={course}
          material={viewersOf}
          onClose={() => setViewersOf(null)}
        />
      )}
      {toolkitOpen && (
        <PscmToolkitModal courseCode={course.code} onClose={() => setToolkitOpen(false)} />
      )}
      {removing && (
        <Confirm
          title={removing.type === 'module' ? 'Delete this week?' : 'Delete this material?'}
          message={removing.type === 'module'
            ? 'The week and every material inside it will be deleted. Students will no longer see them.'
            : `"${removing.item.title}" will be removed for everyone.`}
          danger
          confirmLabel="Delete"
          busy={busy}
          onClose={() => setRemoving(null)}
          onConfirm={doRemove}
        />
      )}
    </div>
  );
}

function WeekCard({ title, summary, unlockAt, hasPrereq, items, onAdd, onEdit, onDeleteWeek, onDelete, onPreview, onLiveSync, onViewers, onToggleLock, statMap, statsSupported, act, muted }) {
  const weekLocked = isItemLocked(unlockAt);
  return (
    <section className="card-flush" style={muted ? { background: 'var(--surface-2)' } : undefined}>
      <div className="card-head">
        <div className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
          <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
            <h2>{title}</h2>
            {weekLocked && (
              <span className="badge badge-amber" style={{ fontSize: 11 }}>
                <Icon name="clock" size={11} /> Scheduled · unlocks {fmtDateTime(unlockAt)}
              </span>
            )}
            {hasPrereq && (
              <span className="badge badge-plum" style={{ fontSize: 11 }}>
                <Icon name="lock" size={11} /> Mastery prerequisite
              </span>
            )}
          </div>
          {summary && <span className="small muted pre">{summary}</span>}
        </div>
        <div className="row">
          {onEdit && <button type="button" className="icon-btn plain" onClick={onEdit} aria-label="Edit week"><Icon name="edit" /></button>}
          {onDeleteWeek && <button type="button" className="icon-btn plain" onClick={onDeleteWeek} aria-label="Delete week"><Icon name="trash" /></button>}
          <button type="button" className="btn btn-sm" onClick={onAdd}><Icon name="plus" size={16} /> Add</button>
        </div>
      </div>
      {items.length === 0 && <p className="small muted" style={{ padding: '14px 18px' }}>Nothing here yet.</p>}
      {items.map((m) => {
        const st = statMap?.get(m.id);
        const viewOnly = isViewOnlyPath(m.storage_path);
        const isPdf = m.storage_path && (m.kind === 'pdf' || /\.pdf$/i.test(m.storage_path));
        const itemLocked = isItemLocked(m.unlock_at);
        return (
          <div key={m.id} className="list-row">
            <KindTag kind={m.kind} />
            <span className="list-main">
              <span className="title row-wrap" style={{ gap: 6, alignItems: 'center' }}>
                <span>{m.title}</span>
                {viewOnly && (
                  <span className="badge badge-teal" style={{ fontSize: 11 }}>
                    <Icon name="lock" size={11} /> Read-only
                  </span>
                )}
                {itemLocked && (
                  <span className="badge badge-amber" style={{ fontSize: 11 }}>
                    <Icon name="clock" size={11} /> Unlocks {fmtDateTime(m.unlock_at)}
                  </span>
                )}
              </span>
              <span className="tiny muted">
                {m.url ? hostOf(m.url) : fmtBytes(m.size_bytes)} · added {relative(m.created_at)}
                {statsSupported && (
                  <> · <strong style={{ color: st?.unique_students ? 'var(--teal-dark)' : 'var(--text-2)' }}>{st?.unique_students || 0} student{(st?.unique_students || 0) === 1 ? '' : 's'} opened</strong>{st?.total_opens ? ` (${st.total_opens} opens)` : ''}</>
                )}
              </span>
            </span>
            <div className="list-actions">
            {statsSupported && onViewers && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => onViewers(m)}
                title="See who viewed and nudge students who haven't opened yet"
              >
                <Icon name="users" size={14} /> Viewers
              </button>
            )}
            {isPdf && !m.url && onLiveSync && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                title="Present slides live — students follow your page & pulse clarity in real time"
                onClick={() => onLiveSync(m)}
              >
                <Icon name="play" size={14} /> Live sync
              </button>
            )}
            {isPdf && onToggleLock && (
              <button
                type="button"
                className="icon-btn plain"
                title={viewOnly ? 'Currently read-only — click to allow downloads' : 'Currently downloadable — click to lock as read-only'}
                aria-label={viewOnly ? `Allow downloads for ${m.title}` : `Make ${m.title} read-only`}
                onClick={() => onToggleLock(m)}
                style={{ color: viewOnly ? 'var(--teal-dark)' : 'var(--muted)' }}
              >
                <Icon name="lock" size={16} />
              </button>
            )}
            <button type="button" className="icon-btn plain" aria-label={`Open ${m.title}`}
              onClick={() => (m.url ? window.open(m.url, '_blank', 'noopener') : viewOnly ? onPreview?.(m) : act(() => openStoredFile('materials', m.storage_path)))}>
              <Icon name={m.url ? 'link' : 'eye'} />
            </button>
            <button type="button" className="icon-btn plain" aria-label={`Delete ${m.title}`} onClick={() => onDelete(m)}>
              <Icon name="trash" />
            </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function MaterialViewersModal({ course, material, onClose }) {
  const toast = useToast();
  const { data, error, loading } = useLoad(
    () => rpc('material_viewer_breakdown', { p_course: course.id, p_material: material.id }),
    [course.id, material.id],
  );
  const [tab, setTab] = useState('unviewed');
  const [classKey, setClassKey] = useState('ALL');
  const [nudging, setNudging] = useState(false);

  const students = useMemo(() => data?.students || [], [data?.students]);
  const classes = useMemo(() => {
    const map = new Map();
    for (const s of students) {
      const key = `${s.programme || ''}|${s.stream || ''}`;
      const label = [s.programme, s.stream].filter(Boolean).join(' · ') || 'No class assigned';
      if (!map.has(key)) map.set(key, { key, label, total: 0, viewed: 0 });
      const b = map.get(key);
      b.total += 1;
      if (s.viewed) b.viewed += 1;
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [students]);

  const filtered = useMemo(() => {
    if (classKey === 'ALL') return students;
    return students.filter((s) => `${s.programme || ''}|${s.stream || ''}` === classKey);
  }, [students, classKey]);

  const viewedList = useMemo(() => filtered.filter((s) => s.viewed), [filtered]);
  const unviewedList = useMemo(() => filtered.filter((s) => !s.viewed), [filtered]);
  const overallPct = filtered.length ? Math.round((viewedList.length / filtered.length) * 100) : 0;

  return (
    <>
      <Modal
        wide
        title={`Viewers · ${material.title}`}
        onClose={onClose}
        footer={
          <div className="between" style={{ width: '100%', flexWrap: 'wrap', gap: 8 }}>
            <span className="tiny muted">
              {viewedList.length} of {filtered.length} student{filtered.length === 1 ? '' : 's'} opened ({overallPct}%)
            </span>
            <div className="row" style={{ gap: 8 }}>
              {unviewedList.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const activeUnviewed = unviewedList.filter((s) => s.activated);
                    if (!activeUnviewed.length) {
                      toast('None of the unviewed students have activated accounts yet.', 'error');
                      return;
                    }
                    setNudging(true);
                  }}
                >
                  <Icon name="bell" size={15} /> Nudge {unviewedList.length} non-viewer{unviewedList.length === 1 ? '' : 's'}
                </button>
              )}
              <button type="button" className="btn" onClick={onClose}>Close</button>
            </div>
          </div>
        }
      >
        {loading && <Loading />}
        {error && (
          <div className="notice notice-warn small">
            Viewer breakdown requires the latest Supabase SQL migration (Section 16). Once run, you can inspect per-class read rates and nudge non-viewers from here.
          </div>
        )}
        {!loading && !error && data && (
          <div className="stack">
            {classes.length > 1 && (
              <div className="card-soft stack-sm" style={{ padding: 12 }}>
                <div className="between">
                  <strong className="small">Class completion breakdown</strong>
                  {classKey !== 'ALL' && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setClassKey('ALL')}>
                      Show all classes
                    </button>
                  )}
                </div>
                <div className="grid-2" style={{ gap: 10 }}>
                  {classes.map((c) => {
                    const p = c.total ? Math.round((c.viewed / c.total) * 100) : 0;
                    const active = classKey === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setClassKey(active ? 'ALL' : c.key)}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: active ? '1.5px solid var(--teal)' : '1px solid var(--line)',
                          background: active ? 'var(--teal-50)' : 'var(--surface)',
                          cursor: 'pointer',
                        }}
                      >
                        <div className="between small" style={{ marginBottom: 4 }}>
                          <span className="strong">{c.label}</span>
                          <span className="mono tiny muted">{c.viewed}/{c.total} ({p}%)</span>
                        </div>
                        <Bar value={p} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Tabs
              tabs={[
                { id: 'unviewed', label: 'Not viewed yet', count: unviewedList.length },
                { id: 'viewed', label: 'Viewed', count: viewedList.length },
              ]}
              value={tab}
              onChange={setTab}
            />

            <div className="card-flush" style={{ maxHeight: 340, overflowY: 'auto' }}>
              {(tab === 'unviewed' ? unviewedList : viewedList).length === 0 ? (
                <div className="small muted" style={{ padding: '18px 16px' }}>
                  {tab === 'unviewed' ? 'Every student in this filter has opened this material.' : 'No students have opened this material yet.'}
                </div>
              ) : (
                (tab === 'unviewed' ? unviewedList : viewedList).map((s) => (
                  <div key={s.index_no} className="list-row small">
                    <span className="list-main">
                      <span className="title">{s.full_name} <span className="mono tiny muted">({s.index_no})</span></span>
                      <span className="tiny muted">
                        {[s.programme, s.stream].filter(Boolean).join(' · ') || 'No class'}
                        {!s.activated && ' · Account not activated yet'}
                      </span>
                    </span>
                    {s.viewed ? (
                      <span className="tiny muted mono">
                        {s.view_count}× · {relative(s.last_viewed_at)}
                      </span>
                    ) : (
                      <span className="badge">Not opened</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </Modal>

      {nudging && (
        <BulkNudgeModal
          courseId={course.id}
          courseCode={course.code}
          title={`Nudge non-viewers · ${material.title}`}
          subtitle={`Remind students who haven't opened "${material.title}" yet.`}
          students={unviewedList.map((s) => ({ ...s, activated: s.activated }))}
          defaultSubject={`Please review: ${material.title} (${course.code})`}
          defaultMessage={`Hi {first_name},\n\nPlease make sure to open and review "${material.title}" on PSCM E-Class before our next class.\n\nThank you.`}
          onClose={() => setNudging(false)}
        />
      )}
    </>
  );
}

function WeekForm({ course, week, modules = [], quizzes = [], onClose, onSaved }) {
  const [act, busy] = useAction();
  const [f, setF] = useState({
    week_no: week.week_no ?? '',
    title: week.title || '',
    summary: week.summary || '',
    unlock_at: toLocalInputValue(week.unlock_at),
    prereq_module_id: week.prereq_module_id || '',
    prereq_quiz_id: week.prereq_quiz_id || '',
    prereq_min_pct: week.prereq_min_pct ?? 50,
  });
  const otherModules = modules.filter((m) => m.id !== week.id);
  async function save() {
    const baseRow = {
      course_id: course.id,
      week_no: f.week_no === '' ? null : Number(f.week_no),
      title: f.title.trim(),
      summary: f.summary,
    };
    const unlockIso = f.unlock_at ? new Date(f.unlock_at).toISOString() : null;
    const rowWithUnlock = {
      ...baseRow,
      unlock_at: unlockIso,
      prereq_module_id: f.prereq_module_id || null,
      prereq_quiz_id: f.prereq_quiz_id || null,
      prereq_min_pct: Math.max(0, Math.min(100, Number(f.prereq_min_pct) || 50)),
    };
    const ok = await act(async () => {
      try {
        return week.id
          ? await run(supabase.from('modules').update(rowWithUnlock).eq('id', week.id))
          : await run(supabase.from('modules').insert(rowWithUnlock));
      } catch (err) {
        if (/prereq_|unlock_at|column/i.test(err?.message || '')) {
          if (!f.prereq_module_id && !f.prereq_quiz_id) {
            const safeRow = /unlock_at/i.test(err?.message || '') && !f.unlock_at ? baseRow : { ...baseRow, unlock_at: unlockIso };
            return week.id
              ? await run(supabase.from('modules').update(safeRow).eq('id', week.id))
              : await run(supabase.from('modules').insert(safeRow));
          }
        }
        throw err;
      }
    }, week.id ? 'Week updated.' : 'Week added.');
    if (ok !== undefined) {
      onClose();
      onSaved();
    }
  }
  return (
    <Modal title={week.id ? 'Edit week' : 'Add week'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !f.title.trim()}>Save</button></>}>
      <div className="grid-2" style={{ gridTemplateColumns: '120px minmax(0,1fr)' }}>
        <Field label="Week"><input className="input" type="number" min="0" value={f.week_no} onChange={(e) => setF({ ...f, week_no: e.target.value })} /></Field>
        <Field label="Topic"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Inventory models: EOQ and reorder points" autoFocus /></Field>
      </div>
      <Field label="What this week covers" hint="optional, shown to students">
        <textarea className="textarea" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
      </Field>
      <Field label="Unlock date & time" hint="optional — leave blank to make available immediately">
        <div className="row" style={{ gap: 8 }}>
          <input className="input" type="datetime-local" value={f.unlock_at} onChange={(e) => setF({ ...f, unlock_at: e.target.value })} />
          {f.unlock_at && (
            <button type="button" className="btn btn-sm" onClick={() => setF({ ...f, unlock_at: '' })}>Clear</button>
          )}
        </div>
      </Field>
      <div className="stack-sm" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
        <strong className="small">Mastery / Prerequisite Gate (optional)</strong>
        <span className="tiny muted">Lock this week for students until they open every material in a previous week and/or pass a prerequisite quiz.</span>
        <div className="grid-2">
          <Field label="Must open all items in week">
            <select className="select" value={f.prereq_module_id} onChange={(e) => setF({ ...f, prereq_module_id: e.target.value })}>
              <option value="">No prior week required</option>
              {otherModules.map((m) => (
                <option key={m.id} value={m.id}>{m.week_no ? `Week ${m.week_no} · ${m.title}` : m.title}</option>
              ))}
            </select>
          </Field>
          <Field label="Must pass quiz">
            <select className="select" value={f.prereq_quiz_id} onChange={(e) => setF({ ...f, prereq_quiz_id: e.target.value })}>
              <option value="">No prerequisite quiz</option>
              {quizzes.map((qz) => (
                <option key={qz.id} value={qz.id}>{qz.title}</option>
              ))}
            </select>
          </Field>
        </div>
        {f.prereq_quiz_id && (
          <Field label="Minimum quiz score (%)">
            <input className="input mono" type="number" min="0" max="100" style={{ maxWidth: 120 }} value={f.prereq_min_pct} onChange={(e) => setF({ ...f, prereq_min_pct: e.target.value })} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function MaterialForm({ course, moduleId, onClose, onSaved }) {
  const [mode, setMode] = useState('upload');
  const [files, setFiles] = useState([]);
  const [viewOnly, setViewOnly] = useState(true);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [unlockAt, setUnlockAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function insertMaterial(row) {
    const unlockIso = unlockAt ? new Date(unlockAt).toISOString() : null;
    try {
      await run(supabase.from('materials').insert(unlockIso ? { ...row, unlock_at: unlockIso } : row));
    } catch (err) {
      if (!unlockIso && /unlock_at|column/i.test(err?.message || '')) {
        await run(supabase.from('materials').insert(row));
      } else {
        throw err;
      }
    }
  }

  async function save() {
    setError('');
    setBusy(true);
    try {
      if (mode === 'link') {
        if (!/^https?:\/\//i.test(url.trim())) throw new Error('Paste a full link starting with https://');
        await insertMaterial({
          course_id: course.id, module_id: moduleId, kind: kindFromUrl(url), title: title.trim() || hostOf(url), url: url.trim(),
        });
      } else {
        if (!files.length) throw new Error('Choose at least one file.');
        const big = files.find((f) => f.size > MAX_MB * 1024 * 1024);
        if (big) throw new Error(`"${big.name}" is larger than ${MAX_MB} MB. Compress it, or put it on Google Drive and add the link instead.`);
        for (const file of files) {
          const path = `${course.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
          let stored;
          try {
            stored = await uploadFile('materials', path, file);
          } catch (upErr) {
            throw new Error(`Upload of "${file.name}" failed: ${upErr.message}`);
          }
          const isPdfFile = /\.pdf$/i.test(file.name);
          const finalPath = viewOnly && isPdfFile ? setViewOnlyFlag(stored, true) : stored;
          const niceTitle = files.length === 1 && title.trim() ? title.trim() : file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
          await insertMaterial({
            course_id: course.id, module_id: moduleId, kind: kindFromName(file.name), title: niceTitle, storage_path: finalPath, size_bytes: file.size,
          });
        }
      }
      onClose();
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add material" onClose={() => !busy && onClose()}
      footer={<><button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Uploading…' : 'Add'}</button></>}>
      <div className="chips" role="group" aria-label="Type">
        <button type="button" className="chip" aria-pressed={mode === 'upload'} onClick={() => setMode('upload')}>Upload files</button>
        <button type="button" className="chip" aria-pressed={mode === 'link'} onClick={() => setMode('link')}>Add a link or video</button>
      </div>
      {error && <div className="notice notice-error">{error}</div>}
      {mode === 'upload' ? (
        <>
          <Field label="Files" hint={`PDF, slides, Word, Excel · up to ${MAX_MB} MB each · you can pick several`}>
            <input type="file" multiple className="input" style={{ paddingTop: 9 }} onChange={(e) => setFiles([...(e.target.files || [])])} />
          </Field>
          {files.length === 1 && (
            <Field label="Title shown to students" hint="optional">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={files[0].name.replace(/\.[^.]+$/, '')} />
            </Field>
          )}
          {files.length > 1 && <p className="small muted">{files.length} files — each will be titled from its file name. You can rename by deleting and re-adding.</p>}
          <label className="check" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={viewOnly} onChange={(e) => setViewOnly(e.target.checked)} />
            <span>
              <strong>Read-only in browser (no download)</strong> — for PDFs, blocks downloading/copying and stamps each student&apos;s index number across every slide
            </span>
          </label>
          {viewOnly && files.some((f) => /\.(ppt|pptx|key|odp)$/i.test(f.name)) && (
            <div className="notice notice-warn small">
              <strong>PowerPoint file selected:</strong> Browsers cannot display raw <span className="mono">.pptx</span> files without downloading. To block downloads and AI uploads, export your slides in PowerPoint (<em>File → Save As → PDF</em>) and upload the PDF instead.
            </div>
          )}
        </>
      ) : (
        <>
          <Field label="Link" hint="YouTube, Google Drive, a website…">
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoFocus />
          </Field>
          <Field label="Title shown to students">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Recorded lecture — week 6" />
          </Field>
          <p className="small muted">For Google Drive files, set sharing to “Anyone with the link can view”.</p>
        </>
      )}
      <Field label="Schedule unlock" hint="optional — leave blank to unlock immediately">
        <div className="row" style={{ gap: 8 }}>
          <input className="input" type="datetime-local" value={unlockAt} onChange={(e) => setUnlockAt(e.target.value)} />
          {unlockAt && <button type="button" className="btn btn-sm" onClick={() => setUnlockAt('')}>Clear</button>}
        </div>
      </Field>
    </Modal>
  );
}
