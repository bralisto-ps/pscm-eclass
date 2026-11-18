import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpcAll, run, safeFileName, supabase } from '../../../lib/supabase.js';
import { useAuth } from '../../../lib/auth.jsx';
import {
  isViewOnlyPath,
  openStoredFile,
  removeFiles,
  setViewOnlyFlag,
  stripViewOnly,
  uploadFile,
} from '../../../lib/files.js';
import { shareWhatsApp } from '../../../lib/share.js';
import { fmtBytes, fmtDateTime, fmtNumber, fromLocalInput, relative, toLocalInput } from '../../../lib/format.js';
import {
  SUBMISSION_FORMATS,
  autoBuildSyndicateGroups,
  formatSubmissionRules,
  classKey,
  cleanCohortPart,
  filterStudentsForAssignment,
  formatAssignmentAudience,
  hasDeadlineOverrides,
  hasAudienceFilter,
  normalizeIndexNo,
  parseAssignmentMeta,
  serializeAssignmentMeta,
} from '../../../lib/assignmentMeta.js';
import Icon from '../../../components/Icon.jsx';
import { RubricEditor } from '../../../components/RubricGrader.jsx';
import { Confirm, Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../../components/ui.jsx';

const SecureSlideViewer = lazy(() => import('../../../components/SecureSlideViewer.jsx'));

const BRIEF_MAX_MB = 25;
const BRIEF_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.jpg,.jpeg,.png,.txt';

export default function AssignmentsTab({ course, ta }) {
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [act, busy] = useAction();

  const { data, error, loading, reload } = useLoad(async () => {
    const [list, enrolled, classes] = await Promise.all([
      run(supabase.from('assignments').select('*, submissions(count)').eq('course_id', course.id).order('due_at', { nullsFirst: false })),
      supabase.from('enrollments').select('index_no', { count: 'exact', head: true }).eq('course_id', course.id)
        .then(({ count, error: e }) => { if (e) throw e; return count || 0; }),
      rpcAll('course_classes', { p_course: course.id }).catch(() => []),
    ]);
    return { list, enrolled, classes: classes || [] };
  }, [course.id]);

  async function remove() {
    await act(async () => {
      const subs = await run(supabase.from('submissions').select('file_path').eq('assignment_id', removing.id));
      await removeFiles('submissions', subs.map((x) => x.file_path));
      const oldMeta = parseAssignmentMeta(removing);
      if (oldMeta.doc?.path) {
        await removeFiles('materials', [oldMeta.doc.path]).catch(() => {});
      }
      await run(supabase.from('assignments').delete().eq('id', removing.id));
    }, 'Assignment deleted.');
    setRemoving(null);
    reload();
  }

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  return (
    <div className="stack" style={{ maxWidth: 1040 }}>
      <div className="between" style={{ flexWrap: 'wrap' }}>
        <p className="small muted" style={{ maxWidth: 640 }}>
          {ta ? 'Open an assignment to mark submissions and give feedback. The lecturer releases the marks.'
            : 'Target specific programmes or streams, attach read-only or downloadable brief documents (up to 25 MB), and configure clickable rubrics or cohort-aware syndicate groups.'}
        </p>
        {!ta && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" /> New assignment</button>}
      </div>

      {data.list.length === 0 ? (
        <div className="card"><Empty icon="clipboard" title="No assignments yet" /></div>
      ) : (
        <div className="card-flush table-wrap">
          <table className="table">
            <thead><tr><th>Assignment</th><th>Status</th><th>Due</th><th className="num">Submitted</th><th /></tr></thead>
            <tbody>
              {data.list.map((a) => {
                const n = a.submissions?.[0]?.count ?? 0;
                const past = a.due_at && new Date(a.due_at) < new Date();
                const meta = parseAssignmentMeta(a);
                const hasFilter = hasAudienceFilter(meta);
                const subRuleLabel = formatSubmissionRules(meta);
                const targetTotal = hasFilter && data.classes.length
                  ? filterStudentsForAssignment(data.classes, meta).reduce((sum, c) => sum + (Number(c.students) || 0), 0)
                  : data.enrolled;
                return (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/teach/assignment/${a.id}`} className="strong" style={{ color: 'var(--text)' }}>{a.title}</Link>
                      <div className="tiny muted">
                        {fmtNumber(a.max_marks)} marks
                        {a.allow_late ? ' · late allowed' : ''}
                        {a.results_released ? ' · marks released' : ''}
                        {meta.rubric.length > 0 ? ` · ${meta.rubric.length}-criterion rubric` : ''}
                        {meta.syndicate.enabled ? ` · Syndicate (${meta.syndicate.groups.length} groups)` : ''}{a.clo_code ? ` · ${a.clo_code}` : ''}
                      </div>
                      {(hasFilter || meta.doc?.path || subRuleLabel || hasDeadlineOverrides(meta)) && (
                        <div className="row-wrap" style={{ gap: 6, marginTop: 4 }}>
                          {hasFilter && (
                            <span className="badge badge-plum">
                              <Icon name="users" size={11} /> {formatAssignmentAudience(meta)}
                            </span>
                          )}
                          {subRuleLabel && (
                            <span className="badge">
                              <Icon name={meta.submission?.mode === 'typed' ? 'edit' : 'file'} size={11} /> {subRuleLabel}
                            </span>
                          )}
                          {hasDeadlineOverrides(meta) && (
                            <span className="badge badge-amber">
                              <Icon name="clock" size={11} /> Custom deadlines
                            </span>
                          )}
                          {meta.doc?.path && (
                            <span className={`badge ${meta.doc.viewOnly ? 'badge-blue' : ''}`}>
                              <Icon name={meta.doc.viewOnly ? 'lock' : 'file'} size={11} />{' '}
                              {meta.doc.viewOnly ? 'Brief (read-only)' : 'Brief (downloadable)'}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${!a.published ? '' : past ? 'badge-plum' : 'badge-teal'}`}>
                        {!a.published ? 'Draft' : past ? 'Closed' : 'Open'}
                      </span>
                    </td>
                    <td className="small nowrap">{a.due_at ? fmtDateTime(a.due_at) : '—'}<div className="tiny muted">{a.due_at ? relative(a.due_at) : ''}</div></td>
                    <td className="num">{n} / {targetTotal}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <Link to={`/teach/assignment/${a.id}`} className="btn btn-sm">Mark</Link>
                        {!ta && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(a)}>Edit</button>}
                        {a.published && <button type="button" className="icon-btn plain" title="Share on WhatsApp" aria-label="Share on WhatsApp"
                          onClick={() => shareWhatsApp(`*${course.code} assignment: ${a.title}*${hasFilter ? `\nFor: ${formatAssignmentAudience(meta)}` : ''}\n${a.due_at ? `Due ${fmtDateTime(a.due_at)}` : 'No deadline'} · ${fmtNumber(a.max_marks)} marks\nHand in on the course page.`)}>
                          <Icon name="megaphone" /></button>}
                        {!ta && <button type="button" className="icon-btn plain" aria-label="Delete assignment" onClick={() => setRemoving(a)}><Icon name="trash" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && <AssignmentForm course={course} a={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {removing && (
        <Confirm title="Delete this assignment?" danger confirmLabel="Delete" busy={busy}
          message={`"${removing.title}" and every uploaded submission and mark will be deleted permanently.`}
          onClose={() => setRemoving(null)} onConfirm={remove} />
      )}
    </div>
  );
}

export function AssignmentForm({ course, a, onClose, onSaved }) {
  const { profile } = useAuth();
  const toast = useToast();
  const initialMeta = useMemo(() => parseAssignmentMeta(a), [a?.id, a?.instructions]);

  const [f, setF] = useState({
    title: a.title || '',
    instructions: initialMeta.cleanInstructions || '',
    due_at: toLocalInput(a.due_at),
    max_marks: a.max_marks ?? 100,
    allow_late: a.allow_late ?? false,
    published: a.published ?? true,
    clo_code: a.clo_code || '',
  });
  const [outcomes, setOutcomes] = useState([]);
  const [rubric, setRubric] = useState(initialMeta.rubric);
  const [syndicateEnabled, setSyndicateEnabled] = useState(initialMeta.syndicate.enabled);
  const [peerCheck, setPeerCheck] = useState(initialMeta.syndicate.peerCheck !== false);
  const [groups, setGroups] = useState(initialMeta.syndicate.groups);
  const [groupSize, setGroupSize] = useState(4);
  const [cohortMode, setCohortMode] = useState('both');
  const [autoBusy, setAutoBusy] = useState(false);

  // Audience / Cohort targeting state
  const [classes, setClasses] = useState([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [audienceMode, setAudienceMode] = useState(() => {
    if (initialMeta.audience.classes?.length) return 'classes';
    if (initialMeta.audience.programmes?.length || initialMeta.audience.streams?.length) return 'cohort';
    return 'all';
  });
  const [selectedClasses, setSelectedClasses] = useState(initialMeta.audience.classes || []);
  const [selectedProgrammes, setSelectedProgrammes] = useState(initialMeta.audience.programmes || []);
  const [selectedStreams, setSelectedStreams] = useState(initialMeta.audience.streams || []);

  // Assignment brief document state
  const briefInputRef = useRef(null);
  const [existingDoc, setExistingDoc] = useState(initialMeta.doc || null);
  const [docFile, setDocFile] = useState(null);
  const [docRemoved, setDocRemoved] = useState(false);
  const [docViewOnly, setDocViewOnly] = useState(() => {
    if (initialMeta.doc) return Boolean(initialMeta.doc.viewOnly || isViewOnlyPath(initialMeta.doc.path));
    return true;
  });
  const [previewingDoc, setPreviewingDoc] = useState(null);
  const [subMode, setSubMode] = useState(initialMeta.submission?.mode || 'file');
  const [subFileFormat, setSubFileFormat] = useState(initialMeta.submission?.fileFormat || 'all');
  const [subAllowPaste, setSubAllowPaste] = useState(initialMeta.submission?.allowPaste !== false);
  const [saving, setSaving] = useState(false);
  const [classDeadlines, setClassDeadlines] = useState(() => {
    const out = {};
    for (const [k, iso] of Object.entries(initialMeta.deadlines?.byClass || {})) {
      out[k] = toLocalInput(iso);
    }
    return out;
  });
  const [showClassDeadlines, setShowClassDeadlines] = useState(
    () => Object.keys(initialMeta.deadlines?.byClass || {}).length > 0
  );

  useEffect(() => {
    let alive = true;
    setClassesLoading(true);
    supabase.from('course_outcomes').select('code, title').eq('course_id', course.id).order('code')
      .then((r) => { if (alive && Array.isArray(r.data)) setOutcomes(r.data); }, () => {});
    rpcAll('course_classes', { p_course: course.id })
      .then((rows) => {
        if (alive) setClasses(rows || []);
      })
      .catch(() => {
        if (alive) setClasses([]);
      })
      .finally(() => {
        if (alive) setClassesLoading(false);
      });
    return () => { alive = false; };
  }, [course.id]);

  // Merge any previously saved class keys that currently have 0 students so nothing disappears silently
  const classOptions = useMemo(() => {
    const map = new Map();
    for (const c of classes) {
      const p = cleanCohortPart(c.programme);
      const st = cleanCohortPart(c.stream);
      const k = classKey(p, st);
      map.set(k.toLowerCase(), { key: k, programme: p, stream: st, students: Number(c.students) || 0 });
    }
    for (const k of selectedClasses) {
      const [p = '', st = ''] = String(k || '').split('|');
      const cleaned = classKey(p, st);
      if (!map.has(cleaned.toLowerCase())) {
        map.set(cleaned.toLowerCase(), {
          key: cleaned,
          programme: cleanCohortPart(p),
          stream: cleanCohortPart(st),
          students: 0,
        });
      }
    }
    return [...map.values()].sort((x, y) => x.key.localeCompare(y.key));
  }, [classes, selectedClasses]);

  const uniqueProgrammes = useMemo(() => {
    const set = new Set([
      ...classOptions.map((c) => c.programme).filter(Boolean),
      ...selectedProgrammes.filter(Boolean),
    ]);
    return [...set].sort();
  }, [classOptions, selectedProgrammes]);

  const uniqueStreams = useMemo(() => {
    const set = new Set([
      ...classOptions.map((c) => c.stream).filter(Boolean),
      ...selectedStreams.filter(Boolean),
    ]);
    return [...set].sort();
  }, [classOptions, selectedStreams]);

  const effectiveAudience = useMemo(() => {
    if (audienceMode === 'classes') {
      return { classes: selectedClasses, programmes: [], streams: [] };
    }
    if (audienceMode === 'cohort') {
      return { classes: [], programmes: selectedProgrammes, streams: selectedStreams };
    }
    return { classes: [], programmes: [], streams: [] };
  }, [audienceMode, selectedClasses, selectedProgrammes, selectedStreams]);

  const totalEnrolledCount = useMemo(
    () => classOptions.reduce((sum, c) => sum + (c.students || 0), 0),
    [classOptions]
  );

  const eligibleEnrolledCount = useMemo(() => {
    if (!hasAudienceFilter(effectiveAudience)) return totalEnrolledCount;
    return filterStudentsForAssignment(classOptions, effectiveAudience).reduce((sum, c) => sum + (c.students || 0), 0);
  }, [classOptions, effectiveAudience, totalEnrolledCount]);

  const activeDocName = docFile ? docFile.name : (!docRemoved && existingDoc ? existingDoc.name : '');
  const activeDocSize = docFile ? docFile.size : (!docRemoved && existingDoc ? existingDoc.sizeBytes : 0);
  const activeDocIsPdf = /\.pdf$/i.test(activeDocName || stripViewOnly(existingDoc?.path || ''));

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  function toggleItem(setter, value) {
    setter((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]));
  }

  function toggleClassesBy(field, value) {
    const matching = classOptions.filter((c) => c[field] === value).map((c) => c.key);
    if (!matching.length) return;
    setSelectedClasses((prev) => {
      const allSelected = matching.every((k) => prev.includes(k));
      if (allSelected) return prev.filter((k) => !matching.includes(k));
      return [...new Set([...prev, ...matching])];
    });
  }

  function onPickBrief(e) {
    const file = e.target.files?.[0] || null;
    if (!file) return;
    if (file.size > BRIEF_MAX_MB * 1024 * 1024) {
      toast(`"${file.name}" is larger than ${BRIEF_MAX_MB} MB. Compress it before uploading.`, 'error');
      if (briefInputRef.current) briefInputRef.current.value = '';
      return;
    }
    setDocFile(file);
    setDocRemoved(false);
    setDocViewOnly(/\.pdf$/i.test(file.name));
  }

  function clearBrief() {
    setDocFile(null);
    setDocRemoved(true);
    if (briefInputRef.current) briefInputRef.current.value = '';
  }

  async function previewExistingDoc() {
    if (!existingDoc?.path) return;
    const isPdf = /\.pdf$/i.test(existingDoc.name || stripViewOnly(existingDoc.path));
    if (isPdf && docViewOnly) {
      setPreviewingDoc({
        id: a.id || 'preview-brief',
        title: existingDoc.name || f.title || 'Assignment brief',
        storage_path: setViewOnlyFlag(existingDoc.path, true),
      });
      return;
    }
    try {
      await openStoredFile('materials', existingDoc.path);
    } catch (e) {
      toast(e.message || 'Could not open brief.', 'error');
    }
  }

  async function autoAssignGroups() {
    setAutoBusy(true);
    try {
      const students = await rpcAll('course_students', { p_course: course.id });
      if (!students.length) {
        toast('No enrolled students in this course yet.', 'error');
        return;
      }
      const eligible = filterStudentsForAssignment(students, effectiveAudience);
      if (!eligible.length) {
        toast('No enrolled students match the selected target classes or cohorts.', 'error');
        return;
      }
      const next = autoBuildSyndicateGroups(students, groupSize, cohortMode, effectiveAudience);
      setGroups(next);
      const modeNote = cohortMode === 'mix' ? 'mixed across selected students' : 'grouped strictly within cohort';
      toast(`Created ${next.length} syndicate group${next.length === 1 ? '' : 's'} from ${eligible.length} eligible student${eligible.length === 1 ? '' : 's'} (${modeNote}).`);
    } catch (e) {
      toast(e.message || 'Could not load class list.', 'error');
    } finally {
      setAutoBusy(false);
    }
  }

  function addGroup() {
    setGroups((g) => [...g, { id: `grp-${Date.now()}`, name: `Syndicate ${g.length + 1}`, members: [] }]);
  }

  function updateGroupName(idx, name) {
    setGroups((g) => g.map((item, i) => (i === idx ? { ...item, name } : item)));
  }

  function updateGroupMembers(idx, rawText) {
    const members = [...new Set(rawText.split(/[\s,;]+/).map(normalizeIndexNo).filter(Boolean))];
    setGroups((g) => g.map((item, i) => (i === idx ? { ...item, members } : item)));
  }

  function removeGroup(idx) {
    setGroups((g) => g.filter((_, i) => i !== idx));
  }

  async function save() {
    if (audienceMode === 'classes' && selectedClasses.length === 0) {
      toast('Select at least one class, or switch target to "All enrolled students".', 'error');
      return;
    }
    if (audienceMode === 'cohort' && selectedProgrammes.length === 0 && selectedStreams.length === 0) {
      toast('Select at least one programme or stream, or switch target to "All enrolled students".', 'error');
      return;
    }
    if (docFile && docFile.size > BRIEF_MAX_MB * 1024 * 1024) {
      toast(`Brief file must be ${BRIEF_MAX_MB} MB or smaller.`, 'error');
      return;
    }

    setSaving(true);
    let newlyUploadedPath = null;
    try {
      const oldDocPath = initialMeta.doc?.path || null;
      let nextDoc = null;

      if (docFile) {
        const rawPath = `${course.id}/assignments/${crypto.randomUUID()}-${safeFileName(docFile.name)}`;
        const stored = await uploadFile('materials', rawPath, docFile);
        newlyUploadedPath = stored;
        const isPdf = /\.pdf$/i.test(docFile.name);
        const finalPath = isPdf && docViewOnly ? setViewOnlyFlag(stored, true) : stripViewOnly(stored);
        nextDoc = {
          path: finalPath,
          name: docFile.name,
          sizeBytes: docFile.size,
          viewOnly: Boolean(isPdf && docViewOnly),
        };
      } else if (existingDoc && !docRemoved) {
        const isPdf = /\.pdf$/i.test(existingDoc.name || stripViewOnly(existingDoc.path));
        const finalPath = isPdf ? setViewOnlyFlag(existingDoc.path, docViewOnly) : stripViewOnly(existingDoc.path);
        nextDoc = {
          ...existingDoc,
          path: finalPath,
          viewOnly: Boolean(isPdf && docViewOnly),
        };
      }

      const encodedInstructions = serializeAssignmentMeta(f.instructions, {
        rubric,
        syndicate: {
          enabled: syndicateEnabled,
          peerCheck,
          groups,
        },
        audience: effectiveAudience,
        doc: nextDoc,
        submission: {
          mode: subMode,
          fileFormat: subFileFormat,
          allowPaste: subAllowPaste,
        },
        deadlines: {
          byClass: Object.fromEntries(
            Object.entries(classDeadlines)
              .map(([k, v]) => [k, fromLocalInput(v)])
              .filter(([, iso]) => Boolean(iso))
          ),
          byStudent: initialMeta.deadlines?.byStudent || {},
        },
      });

      const baseRow = {
        course_id: course.id,
        title: f.title.trim(),
        instructions: encodedInstructions,
        due_at: fromLocalInput(f.due_at),
        max_marks: Number(f.max_marks) || 100,
        allow_late: f.allow_late,
        published: f.published,
      };
      const rowWithClo = { ...baseRow, clo_code: (f.clo_code || '').trim() };

      try {
        await run(a.id ? supabase.from('assignments').update(rowWithClo).eq('id', a.id) : supabase.from('assignments').insert(rowWithClo));
      } catch (colErr) {
        if (!rowWithClo.clo_code && /clo_code|column/i.test(colErr?.message || '')) {
          await run(a.id ? supabase.from('assignments').update(baseRow).eq('id', a.id) : supabase.from('assignments').insert(baseRow));
        } else {
          throw colErr;
        }
      }

      // Clean up superseded document cleanly in background
      if (oldDocPath && stripViewOnly(oldDocPath) !== stripViewOnly(nextDoc?.path || '')) {
        await removeFiles('materials', [oldDocPath]).catch(() => {});
      }

      toast(a.id ? 'Assignment updated.' : 'Assignment created.');
      onClose();
      onSaved();
    } catch (e) {
      if (newlyUploadedPath) {
        await removeFiles('materials', [newlyUploadedPath]).catch(() => {});
      }
      toast(e.message || 'Could not save assignment.', 'error');
    } finally {
      setSaving(false);
    }
  }

  const busy = saving;

  return (
    <>
      <Modal
        title={a.id ? 'Edit assignment' : 'New assignment'}
        onClose={() => !busy && onClose()}
        wide
        footer={
          <>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !f.title.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <Field label="Title"><input className="input" value={f.title} onChange={set('title')} placeholder="Supplier evaluation case study" autoFocus /></Field>
        <Field label="Instructions" hint="optional summary or notes if attaching a brief document">
          <textarea className="textarea" style={{ minHeight: 110 }} value={f.instructions} onChange={set('instructions')} />
        </Field>
        <div className="grid-2">
          <Field label="Deadline"><input className="input" type="datetime-local" value={f.due_at} onChange={set('due_at')} /></Field>
          <Field label="Marks available"><input className="input" type="number" min="1" value={f.max_marks} onChange={set('max_marks')} /></Field>
        </div>
        <Field label="Course Learning Outcome (CLO)" hint="optional — links this assignment to CLO attainment analytics">
          {outcomes.length > 0 ? (
            <select className="select" value={f.clo_code || ''} onChange={set('clo_code')}>
              <option value="">Not tagged to a CLO</option>
              {outcomes.map((o) => (
                <option key={o.code} value={o.code}>{o.code} — {o.title}</option>
              ))}
            </select>
          ) : (
            <input className="input" value={f.clo_code || ''} onChange={set('clo_code')} placeholder="e.g. CLO1 (define outcomes under Outcomes & CLO tab)" />
          )}
        </Field>
        {(classOptions.length > 0 || Object.keys(classDeadlines).length > 0) && (
          <div className="stack-sm" style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <div className="between" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong className="small">Per-class deadline overrides (optional)</strong>
                <div className="tiny muted">Leave blank on a class to inherit the main deadline above. Individual student extensions can also be granted while marking.</div>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowClassDeadlines((v) => !v)}
              >
                <Icon name="clock" size={14} /> {showClassDeadlines ? 'Hide class deadlines' : `Set per class (${Object.values(classDeadlines).filter(Boolean).length})`}
              </button>
            </div>
            {showClassDeadlines && (
              <div className="stack-sm" style={{ marginTop: 4 }}>
                {(hasAudienceFilter(effectiveAudience) ? filterStudentsForAssignment(classOptions, effectiveAudience) : classOptions).map((c) => {
                  const val = classDeadlines[c.key] || '';
                  return (
                    <div key={c.key} className="between" style={{ gap: 8, flexWrap: 'wrap', padding: '6px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--line-2)' }}>
                      <span className="small">
                        <strong>{[c.programme, c.stream].filter(Boolean).join(' · ') || 'Unassigned'}</strong>
                        <span className="tiny muted"> ({c.students})</span>
                      </span>
                      <div className="row" style={{ gap: 6 }}>
                        <input
                          className="input"
                          type="datetime-local"
                          style={{ width: 'auto', minHeight: 34, fontSize: 13 }}
                          value={val}
                          onChange={(e) => setClassDeadlines((prev) => ({ ...prev, [c.key]: e.target.value }))}
                        />
                        {val && (
                          <button
                            type="button"
                            className="icon-btn plain"
                            title="Use default deadline"
                            aria-label="Clear class deadline"
                            onClick={() => setClassDeadlines((prev) => {
                              const next = { ...prev };
                              delete next[c.key];
                              return next;
                            })}
                          >
                            <Icon name="close" size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Target classes / cohorts */}
        <div className="stack-sm" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong className="small">Who gets this assignment</strong>
              <div className="tiny muted">
                {hasAudienceFilter(effectiveAudience)
                  ? `Only students in ${formatAssignmentAudience(effectiveAudience)} will see, submit, and appear in syndicate groups.`
                  : 'Every student enrolled in this course will see this assignment.'}
              </div>
            </div>
            {!classesLoading && totalEnrolledCount > 0 && (
              <span className={`badge ${hasAudienceFilter(effectiveAudience) ? 'badge-plum' : 'badge-teal'}`}>
                {eligibleEnrolledCount} of {totalEnrolledCount} students
              </span>
            )}
          </div>

          <div className="row-wrap" style={{ gap: 14, paddingTop: 4 }}>
            <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="assign-audience" checked={audienceMode === 'all'} onChange={() => setAudienceMode('all')} />
              <span>All enrolled classes</span>
            </label>
            <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="assign-audience" checked={audienceMode === 'classes'} onChange={() => setAudienceMode('classes')} />
              <span>Specific classes (Programme · Stream)</span>
            </label>
            <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="assign-audience" checked={audienceMode === 'cohort'} onChange={() => setAudienceMode('cohort')} />
              <span>By Programme or Stream</span>
            </label>
          </div>

          {audienceMode === 'classes' && (
            <div className="stack-sm" style={{ marginTop: 4 }}>
              {classesLoading ? (
                <span className="tiny muted">Loading course classes…</span>
              ) : classOptions.length === 0 ? (
                <span className="tiny muted">No classes with programme/stream tags found yet. Import a roster with Programme &amp; Stream first, or choose &ldquo;All enrolled classes&rdquo;.</span>
              ) : (
                <>
                  {(uniqueStreams.length > 1 || uniqueProgrammes.length > 1) && (
                    <div className="row-wrap" style={{ gap: 6, alignItems: 'center' }}>
                      <span className="tiny muted">Quick select:</span>
                      {uniqueStreams.map((st) => (
                        <button
                          key={`st-${st}`}
                          type="button"
                          className="btn btn-sm btn-ghost"
                          style={{ minHeight: 28, fontSize: 12 }}
                          onClick={() => toggleClassesBy('stream', st)}
                        >
                          {st} stream
                        </button>
                      ))}
                      {uniqueProgrammes.map((p) => (
                        <button
                          key={`pr-${p}`}
                          type="button"
                          className="btn btn-sm btn-ghost"
                          style={{ minHeight: 28, fontSize: 12 }}
                          onClick={() => toggleClassesBy('programme', p)}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid-2" style={{ gap: 8 }}>
                    {classOptions.map((c) => {
                      const checked = selectedClasses.includes(c.key);
                      const label = [c.programme, c.stream].filter(Boolean).join(' · ') || 'Unassigned cohort';
                      return (
                        <label
                          key={c.key}
                          className="check"
                          style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: checked ? 'var(--teal-50)' : 'var(--surface)',
                            border: `1px solid ${checked ? 'var(--teal)' : 'var(--line-2)'}`,
                            margin: 0,
                          }}
                        >
                          <input type="checkbox" checked={checked} onChange={() => toggleItem(setSelectedClasses, c.key)} />
                          <span className="small" style={{ flex: 1 }}>
                            <strong>{label}</strong>
                            <span className="tiny muted" style={{ marginLeft: 6 }}>({c.students} student{c.students === 1 ? '' : 's'})</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {audienceMode === 'cohort' && (
            <div className="grid-2" style={{ gap: 12, marginTop: 4 }}>
              <div className="stack-sm">
                <span className="eyebrow">Programmes {selectedProgrammes.length ? `(${selectedProgrammes.length} selected)` : '(any)'}</span>
                {uniqueProgrammes.length === 0 ? (
                  <span className="tiny muted">No programmes on roster yet.</span>
                ) : (
                  <div className="stack-sm" style={{ gap: 6 }}>
                    {uniqueProgrammes.map((p) => (
                      <label key={p} className="check small" style={{ margin: 0 }}>
                        <input type="checkbox" checked={selectedProgrammes.includes(p)} onChange={() => toggleItem(setSelectedProgrammes, p)} />
                        <span>{p}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="stack-sm">
                <span className="eyebrow">Streams {selectedStreams.length ? `(${selectedStreams.length} selected)` : '(any)'}</span>
                {uniqueStreams.length === 0 ? (
                  <span className="tiny muted">No streams on roster yet.</span>
                ) : (
                  <div className="stack-sm" style={{ gap: 6 }}>
                    {uniqueStreams.map((st) => (
                      <label key={st} className="check small" style={{ margin: 0 }}>
                        <input type="checkbox" checked={selectedStreams.includes(st)} onChange={() => toggleItem(setSelectedStreams, st)} />
                        <span>{st}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Optional Assignment Document Upload */}
        <div className="stack-sm" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong className="small">Assignment document (optional)</strong>
              <div className="tiny muted">
                Attach a case study, question paper, dataset or template (PDF, Word, Excel, PowerPoint, ZIP, image · up to {BRIEF_MAX_MB} MB).
              </div>
            </div>
            {activeDocName && (
              <span className={`badge ${activeDocIsPdf && docViewOnly ? 'badge-blue' : 'badge-teal'}`}>
                {activeDocIsPdf && docViewOnly ? 'Read online only' : 'Student download'}
              </span>
            )}
          </div>

          {activeDocName ? (
            <div className="stack-sm" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--line-2)' }}>
              <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="row" style={{ gap: 8, minWidth: 0, flex: 1 }}>
                  <Icon name={activeDocIsPdf && docViewOnly ? 'lock' : 'file'} size={16} />
                  <div style={{ minWidth: 0 }}>
                    <div className="small strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {activeDocName}
                    </div>
                    <div className="tiny muted">
                      {activeDocSize ? fmtBytes(activeDocSize) : 'Attached brief'}
                      {docFile ? ' · ready to upload on Save' : ''}
                    </div>
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {!docFile && existingDoc?.path && (
                    <button type="button" className="btn btn-sm" onClick={previewExistingDoc}>
                      <Icon name="eye" size={14} /> Preview
                    </button>
                  )}
                  <button type="button" className="btn btn-sm" onClick={() => briefInputRef.current?.click()}>
                    Replace
                  </button>
                  <button type="button" className="icon-btn plain" aria-label="Remove document" title="Remove document" onClick={clearBrief}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>

              {activeDocIsPdf ? (
                <div className="stack-sm" style={{ paddingTop: 6, borderTop: '1px solid var(--line-2)' }}>
                  <span className="tiny muted">Student access for this PDF:</span>
                  <div className="row-wrap" style={{ gap: 14 }}>
                    <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
                      <input type="radio" name="brief-access" checked={docViewOnly} onChange={() => setDocViewOnly(true)} />
                      <span><strong>Read online only</strong> (watermarked viewer, blocks download &amp; print)</span>
                    </label>
                    <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
                      <input type="radio" name="brief-access" checked={!docViewOnly} onChange={() => setDocViewOnly(false)} />
                      <span><strong>Allow students to download</strong></span>
                    </label>
                  </div>
                </div>
              ) : (
                <p className="tiny muted" style={{ margin: 0, paddingTop: 4, borderTop: '1px solid var(--line-2)' }}>
                  Students will be able to download this file directly. Convert to <strong>PDF</strong> if you want to restrict it to read-only online viewing.
                </p>
              )}
            </div>
          ) : (
            <div className="row-wrap" style={{ gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => briefInputRef.current?.click()}>
                <Icon name="upload" size={14} /> Choose assignment file
              </button>
              <span className="tiny muted">No document attached — students will read your typed instructions above.</span>
            </div>
          )}

          <input
            ref={briefInputRef}
            type="file"
            accept={BRIEF_ACCEPT}
            style={{ display: 'none' }}
            onChange={onPickBrief}
          />
        </div>

{/* Student Response Mode & Format Rules */}
        <div className="stack-sm" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong className="small">How students submit their response</strong>
              <div className="tiny muted">
                Require typed answers in the browser (with or without copy/paste), file attachments (PDF or Word only), or both.
              </div>
            </div>
            {formatSubmissionRules({ mode: subMode, fileFormat: subFileFormat, allowPaste: subAllowPaste }) && (
              <span className="badge badge-teal">
                {formatSubmissionRules({ mode: subMode, fileFormat: subFileFormat, allowPaste: subAllowPaste })}
              </span>
            )}
          </div>

          <div className="row-wrap" style={{ gap: 14, paddingTop: 4 }}>
            <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="sub-mode" checked={subMode === 'file'} onChange={() => setSubMode('file')} />
              <span>File upload only</span>
            </label>
            <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="sub-mode" checked={subMode === 'typed'} onChange={() => setSubMode('typed')} />
              <span>Typed online response</span>
            </label>
            <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="radio" name="sub-mode" checked={subMode === 'both'} onChange={() => setSubMode('both')} />
              <span>Both (typed response + file)</span>
            </label>
          </div>

          {(subMode === 'file' || subMode === 'both') && (
            <div className="stack-sm" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--line-2)' }}>
              <span className="tiny muted">Allowed student upload formats:</span>
              <div className="row-wrap" style={{ gap: 14 }}>
                {Object.values(SUBMISSION_FORMATS).map((fmt) => (
                  <label key={fmt.id} className="row small" style={{ gap: 6, cursor: 'pointer' }}>
                    <input type="radio" name="sub-file-fmt" checked={subFileFormat === fmt.id} onChange={() => setSubFileFormat(fmt.id)} />
                    <span>{fmt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {(subMode === 'typed' || subMode === 'both') && (
            <div className="stack-sm" style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--line-2)' }}>
              <span className="tiny muted">Copy &amp; paste inside the student response editor:</span>
              <div className="row-wrap" style={{ gap: 14 }}>
                <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
                  <input type="radio" name="sub-paste" checked={subAllowPaste} onChange={() => setSubAllowPaste(true)} />
                  <span><strong>Allow copy &amp; paste</strong> (students can draft in Word/Notes and paste)</span>
                </label>
                <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
                  <input type="radio" name="sub-paste" checked={!subAllowPaste} onChange={() => setSubAllowPaste(false)} />
                  <span><strong>Block copy &amp; paste</strong> (must type directly; blocks paste/drop &amp; flags bursts)</span>
                </label>
              </div>
            </div>
          )}
        </div>

        <RubricEditor criteria={rubric} maxMarks={Number(f.max_marks) || 100} onChange={setRubric} />

        <div className="stack-sm" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <label className="check">
            <input
              type="checkbox"
              checked={syndicateEnabled}
              onChange={(e) => setSyndicateEnabled(e.target.checked)}
            />
            <span>
              <strong>Syndicate / Group Case Study Mode</strong>
              <span className="tiny muted" style={{ display: 'block' }}>
                One member uploads on behalf of their group, and one grading pass applies marks &amp; feedback to all group members.
              </span>
            </span>
          </label>

          {syndicateEnabled && (
            <div className="stack-sm" style={{ marginTop: 6 }}>
              <label className="check" style={{ paddingBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={peerCheck}
                  onChange={(e) => setPeerCheck(e.target.checked)}
                />
                <span className="small">
                  <strong>Require Confidential Peer-Contribution Check</strong>{' '}
                  <span className="muted">(teammates privately rate each member 1–5; visible only to lecturers/TAs)</span>
                </span>
              </label>
              <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="row-wrap" style={{ gap: 6, alignItems: 'center' }}>
                  <label className="row small" style={{ gap: 6 }}>
                    <span className="tiny muted">Team size:</span>
                    <input
                      className="input mono"
                      type="number"
                      min="2"
                      max="15"
                      style={{ width: 64, minHeight: 34 }}
                      value={groupSize}
                      onChange={(e) => setGroupSize(e.target.value)}
                    />
                  </label>
                  <label className="row small" style={{ gap: 6 }}>
                    <span className="tiny muted">Cohorts:</span>
                    <select
                      className="select"
                      style={{ minHeight: 34, width: 'auto', fontSize: 12.5 }}
                      value={cohortMode}
                      onChange={(e) => setCohortMode(e.target.value)}
                    >
                      <option value="both">Keep programme &amp; stream separate</option>
                      <option value="stream">Keep stream separate only</option>
                      <option value="programme">Keep programme separate only</option>
                      <option value="mix">Mix eligible students</option>
                    </select>
                  </label>
                  <button type="button" className="btn btn-sm" onClick={autoAssignGroups} disabled={autoBusy}>
                    <Icon name="users" size={14} />{' '}
                    {autoBusy ? 'Grouping…' : hasAudienceFilter(effectiveAudience) ? `Auto-group target (${eligibleEnrolledCount})` : 'Auto-group class'}
                  </button>
                </div>
                <button type="button" className="btn btn-sm btn-primary" onClick={addGroup}>
                  <Icon name="plus" size={14} /> Add group
                </button>
              </div>

              {hasAudienceFilter(effectiveAudience) && (
                <p className="tiny muted" style={{ margin: 0 }}>
                  Auto-group will include only students in <strong>{formatAssignmentAudience(effectiveAudience)}</strong> — excluded classes are skipped.
                </p>
              )}

              {groups.length === 0 ? (
                <p className="tiny muted" style={{ margin: 0 }}>
                  No syndicate groups yet — click <strong>{hasAudienceFilter(effectiveAudience) ? 'Auto-group target' : 'Auto-group class'}</strong> to split eligible students automatically, or add groups manually.
                </p>
              ) : (
                <div className="stack-sm" style={{ maxHeight: 210, overflowY: 'auto', paddingRight: 4 }}>
                  {groups.map((g, idx) => (
                    <div key={g.id || idx} className="row-wrap" style={{ gap: 8, alignItems: 'center', padding: '6px 8px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--line-2)' }}>
                      <input
                        className="input"
                        style={{ width: 210, minHeight: 34 }}
                        value={g.name}
                        onChange={(e) => updateGroupName(idx, e.target.value)}
                        placeholder="Syndicate 1"
                      />
                      <input
                        className="input mono"
                        style={{ flex: 1, minWidth: 180, minHeight: 34, fontSize: 12 }}
                        defaultValue={(g.members || []).join(', ')}
                        onBlur={(e) => updateGroupMembers(idx, e.target.value)}
                        placeholder="Index numbers separated by commas (e.g. PSCM/24/001, PSCM/24/002)"
                      />
                      <span className="badge">{(g.members || []).length}</span>
                      <button type="button" className="icon-btn plain" aria-label="Remove group" onClick={() => removeGroup(idx)}>
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <label className="check"><input type="checkbox" checked={f.allow_late} onChange={set('allow_late')} /> Accept late submissions (they are marked as late)</label>
        <label className="check"><input type="checkbox" checked={f.published} onChange={set('published')} /> Visible to students</label>
      </Modal>

      {previewingDoc && (
        <Suspense fallback={<div className="secure-reader-backdrop" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>}>
          <SecureSlideViewer
            material={previewingDoc}
            courseCode={course?.code}
            watermarkText={profile?.full_name || 'Faculty Preview'}
            onClose={() => setPreviewingDoc(null)}
          />
        </Suspense>
      )}
    </>
  );
}
