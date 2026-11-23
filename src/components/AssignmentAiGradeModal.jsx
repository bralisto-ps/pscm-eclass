import { useMemo, useRef, useState } from 'react';
import { rpc, supabase } from '../lib/supabase.js';
import { getSignedFileUrl } from '../lib/files.js';
import { fmtNumber } from '../lib/format.js';
import { AI_STRICTNESS_OPTIONS, aiGradeAssignmentDocs } from '../lib/aiGrade.js';
import { extractAssignmentTexts, extractTextFromLocalFile } from '../lib/similarity.js';
import Icon from './Icon.jsx';
import { Modal, useToast } from './ui.jsx';

export const AI_MODEL_ANSWER_PREFIX = '__ai_model_answer__:';

export default function AssignmentAiGradeModal({
  a,
  assignMeta,
  rows,
  blindMode = false,
  blindMap = new Map(),
  profileId = '',
  initialModelAnswer = '',
  initialSnippetId = null,
  onModelAnswerSaved,
  onApplied,
  onShowSql,
  onClose,
}) {
  const toast = useToast();
  const [modelAnswer, setModelAnswer] = useState(initialModelAnswer || '');
  const [snippetId, setSnippetId] = useState(initialSnippetId || null);
  const [savingGuide, setSavingGuide] = useState(false);
  const [uploadingGuide, setUploadingGuide] = useState(false);

  const [scope, setScope] = useState('unmarked'); // 'unmarked' | 'all'
  const [strictness, setStrictness] = useState('standard');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(null); // { step, label, done, total }
  const [error, setError] = useState('');

  const [results, setResults] = useState([]); // [{ id, label, subLabel, fileName, wordCount, syndicate, row, marks, similarity, confidence, feedback, selected }]
  const [skipped, setSkipped] = useState([]);
  const [confFilter, setConfFilter] = useState('all'); // 'all' | 'flagged' | 'high'
  const [savingMarks, setSavingMarks] = useState(false);
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);

  const maxMarks = Number(a.max_marks) || 100;

  const submittedRows = useMemo(() => {
    const out = [];
    const seenSyn = new Set();
    for (const r of rows || []) {
      const eff = r.sub || r._synLeaderSub;
      if (!eff || eff.file_path === 'presentation:in-class') continue;
      if (r._syn?.id) {
        if (seenSyn.has(r._syn.id)) continue;
        seenSyn.add(r._syn.id);
      }
      out.push(r);
    }
    return out;
  }, [rows]);

  const unmarkedRows = useMemo(
    () =>
      submittedRows.filter((r) => {
        const eff = r.sub || r._synLeaderSub;
        return eff && (eff.marks === null || eff.marks === undefined);
      }),
    [submittedRows]
  );

  const targetRows = scope === 'unmarked' ? unmarkedRows : submittedRows;

  async function persistModelAnswer(text) {
    const cleaned = String(text || '').trim();
    const label = `${AI_MODEL_ANSWER_PREFIX}${a.id}`;
    const localKey = `pscm_ai_model_answer:${a.id}`;
    try {
      if (cleaned) localStorage.setItem(localKey, cleaned);
      else localStorage.removeItem(localKey);
    } catch {
      // ignore storage quota errors
    }

    setSavingGuide(true);
    let nextId = snippetId;
    try {
      if (snippetId && !String(snippetId).startsWith('local-')) {
        if (cleaned) {
          await supabase.from('grading_snippets').update({ body: cleaned }).eq('id', snippetId);
        } else {
          await supabase.from('grading_snippets').delete().eq('id', snippetId);
          nextId = null;
        }
      } else if (cleaned && profileId) {
        const { data: inserted, error: insErr } = await supabase
          .from('grading_snippets')
          .insert({ owner_id: profileId, label, body: cleaned })
          .select('id')
          .single();
        if (!insErr && inserted?.id) nextId = inserted.id;
      }
      setSnippetId(nextId);
      onModelAnswerSaved?.(cleaned, nextId);
      return true;
    } catch {
      // localStorage already saved as fallback
      onModelAnswerSaved?.(cleaned, nextId);
      return true;
    } finally {
      setSavingGuide(false);
    }
  }

  async function handleGuideFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingGuide(true);
    setError('');
    try {
      const res = await extractTextFromLocalFile(file);
      if (res.unsupported || !res.text?.trim()) {
        toast(res.reason || 'Could not extract readable text from that file. Try .docx, text-based .pdf, or .txt.', 'error');
        return;
      }
      const extracted = res.text.trim();
      setModelAnswer(extracted);
      await persistModelAnswer(extracted);
      toast(`Loaded model answer from ${file.name} (${extracted.split(/\s+/).length} words).`);
    } catch (err) {
      toast(err.message || 'Could not read that file.', 'error');
    } finally {
      setUploadingGuide(false);
    }
  }

  async function runAiMarking() {
    const cleanModel = modelAnswer.trim();
    if (!cleanModel) {
      setError('Paste or upload your model answer / marking guide first.');
      return;
    }
    if (!targetRows.length) {
      toast(scope === 'unmarked' ? 'All submitted work is already marked.' : 'No submissions found to grade.');
      return;
    }

    await persistModelAnswer(cleanModel);

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError('');
    setResults([]);
    setSkipped([]);

    try {
      setPhase({ step: 1, label: 'Extracting text from student submissions…', done: 0, total: targetRows.length });
      const { docs, skipped: skippedList } = await extractAssignmentTexts(
        targetRows,
        (bucket, path) => getSignedFileUrl(bucket, path),
        ({ done, total }) => {
          setPhase({
            step: 1,
            label: `Reading submissions (${done} / ${total})…`,
            done,
            total,
          });
        }
      );

      setSkipped(skippedList || []);

      if (controller.signal.aborted) {
        toast('AI marking stopped.', 'info');
        return;
      }

      if (!docs.length) {
        setError('No readable text could be extracted from the selected submissions (e.g. scanned image PDFs require manual marking).');
        return;
      }

      const rowBySubId = new Map();
      for (const r of targetRows) {
        const eff = r.sub || r._synLeaderSub;
        const key = String(eff?.id || r.index_no);
        rowBySubId.set(key, r);
      }

      const promptText = [a.title, assignMeta.cleanInstructions].filter(Boolean).join('\n\n');
      setPhase({ step: 2, label: `AI grading 0 / ${docs.length} submissions…`, done: 0, total: docs.length });

      const { gradesById } = await aiGradeAssignmentDocs({
        courseId: a.course_id,
        assignmentId: a.id,
        prompt: promptText,
        modelAnswer: cleanModel,
        maxMarks,
        rubric: assignMeta.rubric || [],
        strictness,
        docs,
        batchSize: 4,
        signal: controller.signal,
        onProgress: (done, total) => {
          setPhase({
            step: 2,
            label: `AI grading ${done} / ${total} submissions…`,
            done,
            total,
          });
        },
      });

      const built = docs
        .map((d) => {
          const g = gradesById[String(d.id)];
          const row = rowBySubId.get(String(d.id));
          if (!g || !row) return null;
          const isSyn = Boolean(row._syn?.id);
          const label = isSyn
            ? row._syn.name
            : blindMode
            ? blindMap.get(row.index_no) || 'Candidate'
            : row.full_name;
          const subLabel = isSyn
            ? `${row._syn.members?.length || 1} members`
            : blindMode
            ? ''
            : row.index_no;
          return {
            id: String(d.id),
            label,
            subLabel,
            fileName: d.fileName,
            wordCount: d.text.trim().split(/\s+/).filter(Boolean).length,
            syndicate: row._syn || null,
            row,
            marks: g.marks,
            similarity: g.similarity,
            confidence: g.confidence,
            feedback: g.feedback,
            selected: true,
          };
        })
        .filter(Boolean);

      setResults(built);
      toast(`AI graded ${built.length} submission${built.length === 1 ? '' : 's'}. Review below and save when ready.`);
    } catch (err) {
      const msg = err?.message || 'AI marking failed.';
      if (!/cancelled/i.test(msg)) setError(msg);
      toast(msg, /cancelled/i.test(msg) ? 'info' : 'error');
    } finally {
      abortRef.current = null;
      setBusy(false);
      setPhase(null);
    }
  }

  async function saveSelected(onlyHigh = false) {
    const toSave = results.filter((r) => (onlyHigh ? r.confidence === 'high' : r.selected));
    if (!toSave.length) {
      toast('Select at least one graded submission to save.', 'error');
      return;
    }

    setSavingMarks(true);
    let savedCount = 0;
    let needsSyndicateSql = false;

    try {
      for (let i = 0; i < toSave.length; i += 5) {
        const batch = toSave.slice(i, i + 5);
        await Promise.all(
          batch.map(async (item) => {
            const m = Number(item.marks);
            if (!Number.isFinite(m) || m < 0 || m > maxMarks) return;
            const effSub = item.row.sub || item.row._synLeaderSub;
            if (!effSub?.id) return;

            if (item.syndicate && item.syndicate.members?.length > 1) {
              try {
                await rpc('mark_syndicate_submission', {
                  p_assignment: a.id,
                  p_source_submission: effSub.id,
                  p_member_indexes: item.syndicate.members,
                  p_marks: m,
                  p_feedback: item.feedback || '',
                });
                savedCount += 1;
                return;
              } catch (synErr) {
                if (/mark_syndicate_submission|Could not find|does not exist|schema cache/i.test(synErr.message || '')) {
                  needsSyndicateSql = true;
                  const peers = (rows || []).filter(
                    (x) => x._syn?.id === item.syndicate.id && x.sub?.id
                  );
                  await Promise.all(
                    peers.map((p) =>
                      rpc('mark_submission', {
                        p_submission: p.sub.id,
                        p_marks: m,
                        p_feedback: item.feedback || '',
                      })
                    )
                  );
                  savedCount += 1;
                  return;
                }
                throw synErr;
              }
            }

            await rpc('mark_submission', {
              p_submission: effSub.id,
              p_marks: m,
              p_feedback: item.feedback || '',
            });
            savedCount += 1;
          })
        );
      }

      const savedIds = new Set(toSave.map((x) => x.id));
      setResults((prev) => prev.filter((x) => !savedIds.has(x.id)));
      onApplied?.();

      if (needsSyndicateSql) {
        toast(`Saved marks for ${savedCount} submission(s). Install Syndicate SQL to also sync marks to un-uploaded teammates.`, 'error');
        onShowSql?.();
      } else {
        toast(`Saved AI marks for ${savedCount} submission${savedCount === 1 ? '' : 's'}.`);
      }

      if (savedIds.size === results.length) onClose?.();
    } catch (err) {
      toast(err.message || 'Could not save marks.', 'error');
    } finally {
      setSavingMarks(false);
    }
  }

  const highCount = results.filter((r) => r.confidence === 'high').length;
  const flaggedCount = results.filter((r) => r.confidence !== 'high').length;
  const selectedCount = results.filter((r) => r.selected).length;

  const visibleResults = results.filter((r) => {
    if (confFilter === 'high') return r.confidence === 'high';
    if (confFilter === 'flagged') return r.confidence !== 'high';
    return true;
  });

  function updateResult(id, patch) {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <Modal title={`AI Mark Submissions · ${a.title}`} onClose={busy || savingMarks ? undefined : onClose} wide>
      <div className="stack">
        <div className="notice notice-info tiny">
          Compares anonymized student submissions (<strong>Typed online, Word .docx, text PDF, .txt</strong>) directly against your private model answer
          {assignMeta.rubric?.length ? ` and ${assignMeta.rubric.length}-criterion rubric` : ''}. Your model answer is stored privately to your staff account — students can never view it.
        </div>

        <div className="stack-sm">
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="small strong">Your private model answer / marking scheme</span>
            <div className="row-wrap" style={{ gap: 6 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.pdf,.txt,.md"
                style={{ display: 'none' }}
                onChange={handleGuideFile}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || uploadingGuide}
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon name="upload" size={14} /> {uploadingGuide ? 'Reading file…' : 'Load from .docx / .pdf / .txt'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busy || savingGuide}
                onClick={async () => {
                  await persistModelAnswer(modelAnswer);
                  toast('Model answer saved privately.');
                }}
              >
                {savingGuide ? 'Saving…' : 'Save guide'}
              </button>
            </div>
          </div>
          <textarea
            className="textarea"
            style={{ minHeight: 130 }}
            value={modelAnswer}
            onChange={(e) => setModelAnswer(e.target.value)}
            disabled={busy}
            placeholder="Paste your course-specific model answer, key points, expected calculations, or marking breakdown here…"
          />
        </div>

        <div className="row-wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            <span className="tiny">Submissions to grade</span>
            <select className="select" value={scope} onChange={(e) => setScope(e.target.value)} disabled={busy}>
              <option value="unmarked">Only unmarked ({unmarkedRows.length})</option>
              <option value="all">All submitted ({submittedRows.length})</option>
            </select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 220 }}>
            <span className="tiny">Grading strictness</span>
            <select className="select" value={strictness} onChange={(e) => setStrictness(e.target.value)} disabled={busy}>
              {AI_STRICTNESS_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label} — {o.desc}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || savingMarks || !modelAnswer.trim() || targetRows.length === 0}
            onClick={runAiMarking}
          >
            <Icon name="sparkles" size={15} />
            {busy ? 'Grading…' : `Run AI marking (${targetRows.length})`}
          </button>
        </div>

        {phase && (
          <div className="stack-sm" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8 }}>
            <div className="between tiny">
              <span>{phase.label}</span>
              {phase.total > 0 && <span className="mono">{Math.round((phase.done / phase.total) * 100)}%</span>}
            </div>
            <div style={{ height: 6, background: 'var(--line)', borderRadius: 999, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${phase.total > 0 ? Math.min(100, Math.round((phase.done / phase.total) * 100)) : 20}%`,
                  background: 'var(--teal)',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ alignSelf: 'flex-end' }}
              onClick={() => abortRef.current?.abort()}
            >
              Stop
            </button>
          </div>
        )}

        {error && <div className="notice notice-error small">{error}</div>}

        {skipped.length > 0 && (
          <div className="notice notice-warn stack-sm">
            <span className="small strong">
              {skipped.length} submission{skipped.length === 1 ? '' : 's'} skipped (mark manually)
            </span>
            <div className="row-wrap" style={{ gap: 6 }}>
              {skipped.slice(0, 12).map((s, i) => (
                <span key={i} className="badge">
                  {s.name}: {s.reason || 'Unreadable file'}
                </span>
              ))}
              {skipped.length > 12 && <span className="tiny muted">+{skipped.length - 12} more</span>}
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div className="stack-sm">
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="chips" role="group" aria-label="Filter AI results">
                <button type="button" className="chip" aria-pressed={confFilter === 'all'} onClick={() => setConfFilter('all')}>
                  All ({results.length})
                </button>
                <button type="button" className="chip" aria-pressed={confFilter === 'flagged'} onClick={() => setConfFilter('flagged')}>
                  Flagged to review ({flaggedCount})
                </button>
                <button type="button" className="chip" aria-pressed={confFilter === 'high'} onClick={() => setConfFilter('high')}>
                  High confidence ({highCount})
                </button>
              </div>
              <div className="row-wrap" style={{ gap: 6 }}>
                {highCount > 0 && highCount < results.length && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={savingMarks}
                    onClick={() => saveSelected(true)}
                  >
                    Save high-confidence ({highCount})
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={savingMarks || selectedCount === 0}
                  onClick={() => saveSelected(false)}
                >
                  {savingMarks ? 'Saving marks…' : `Save selected (${selectedCount})`}
                </button>
              </div>
            </div>

            <div className="stack-sm" style={{ maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
              {visibleResults.map((r) => {
                const confBadge =
                  r.confidence === 'high'
                    ? { text: 'High', cls: 'badge-teal' }
                    : r.confidence === 'low'
                    ? { text: 'Low — check', cls: 'badge-red' }
                    : { text: 'Medium', cls: 'badge-amber' };
                return (
                  <div
                    key={r.id}
                    className="card stack-sm"
                    style={{ padding: '10px 12px', borderColor: r.selected ? 'var(--line)' : undefined, opacity: r.selected ? 1 : 0.6 }}
                  >
                    <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <label className="check small" style={{ gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={r.selected}
                          onChange={(e) => updateResult(r.id, { selected: e.target.checked })}
                        />
                        <span className="strong">{r.label}</span>
                        {r.subLabel && <span className="mono tiny muted">{r.subLabel}</span>}
                        <span className="tiny muted">· {r.wordCount} words</span>
                      </label>
                      <div className="row-wrap" style={{ gap: 6 }}>
                        <span className="badge">{r.similarity}% match</span>
                        <span className={`badge ${confBadge.cls}`}>{confBadge.text}</span>
                      </div>
                    </div>
                    <div className="row-wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
                      <label className="field" style={{ width: 110 }}>
                        <span className="tiny">Marks / {fmtNumber(maxMarks)}</span>
                        <input
                          className="input mono"
                          type="number"
                          min="0"
                          max={maxMarks}
                          step="0.5"
                          value={r.marks}
                          onChange={(e) => updateResult(r.id, { marks: e.target.value })}
                        />
                      </label>
                      <label className="field" style={{ flex: 1, minWidth: 200 }}>
                        <span className="tiny">AI feedback (editable before saving)</span>
                        <input
                          className="input"
                          value={r.feedback}
                          onChange={(e) => updateResult(r.id, { feedback: e.target.value })}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
