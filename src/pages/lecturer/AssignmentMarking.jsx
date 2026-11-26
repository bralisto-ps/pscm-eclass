import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rpc, rpcAll, run, supabase } from '../../lib/supabase.js';
import { useAuth } from '../../lib/auth.jsx';
import { getSignedFileUrl, isViewOnlyPath, openStoredFile, setViewOnlyFlag } from '../../lib/files.js';
import { fmtDateTime, fmtFull, fmtNumber, fromLocalInput, pct, relative, toLocalInput } from '../../lib/format.js';
import { downloadWorkbook } from '../../lib/sheets.js';
import { assignmentMatchesStudent, findStudentSyndicate, formatAssignmentAudience, formatSubmissionRules, formatTopicRuleLabel, hasAudienceFilter, normalizeIndexNo, parseAssignmentMeta, resolveEffectiveDue, serializeAssignmentMeta } from '../../lib/assignmentMeta.js';
import { ALL_NEW_FEATURES_SQL } from '../../lib/allFeaturesSql.js';
import { ALL_GROUPS, GroupFilters, GroupSummaryTable, groupLabel, groupSummary, matchesGroup } from '../../components/Groups.jsx';
import { SortSelect, SortTh } from '../../components/SortBar.jsx';
import { byNameIndex, compareDate, compareNumber, compareText } from '../../lib/sort.js';
import Icon from '../../components/Icon.jsx';
import { Topbar } from '../../components/Layout.jsx';
import RubricGrader from '../../components/RubricGrader.jsx';
import { parseLabVerificationSummary, suggestLabRubricMarks } from '../../lib/labScoringBridge.js';
import { summarizeClassLabSubmissions } from '../../lib/labMilestone6Engine.js';
import { generateLabVivaQuestions, suggestPeerAdjustedMarks } from '../../lib/labMilestone7Engine.js';
import { computeBatchLabAutoScores, detectJudgementSimilarityPairs } from '../../lib/labMilestone8Engine.js';
import { Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../components/ui.jsx';
import { AssignmentForm } from './course/AssignmentsTab.jsx';
import BulkNudgeModal from '../../components/BulkNudgeModal.jsx';
import MarkReviewQueue from '../../components/MarkReviewQueue.jsx';
import PdfAnnotatorModal from '../../components/PdfAnnotatorModal.jsx';
import AssignmentAiGradeModal, { AI_MODEL_ANSWER_PREFIX } from '../../components/AssignmentAiGradeModal.jsx';
import AssignmentTopicsModal from '../../components/AssignmentTopicsModal.jsx';
import { compareArchiveTexts, compareSubmissionTexts, extractAssignmentTexts } from '../../lib/similarity.js';

const SecureSlideViewer = lazy(() => import('../../components/SecureSlideViewer.jsx'));

async function allSubmissions(assignmentId) {
  let all = [];
  for (let from = 0; ; from += 1000) {
    const page = await run(supabase.from('submissions').select('*, profiles!submissions_student_id_fkey(index_no, full_name)').eq('assignment_id', assignmentId)
      .order('submitted_at').range(from, from + 999));
    all = all.concat(page);
    if (page.length < 1000) return all;
  }
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function synAlphaLabel(n) {
  let num = n + 1;
  let out = '';
  while (num > 0) {
    const rem = (num - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    num = Math.floor((num - 1) / 26);
  }
  return `Syndicate ${out}`;
}

const DEFAULT_PSCM_SNIPPETS = [
  { id: 'def-inco', label: 'Incoterms 2020', body: 'Clarify the applicable Incoterms 2020 rule (cost, risk, and insurance transfer points).', builtin: true },
  { id: 'def-eoq', label: 'EOQ steps', body: 'Show all EOQ derivation steps, including annual demand, ordering cost, and holding cost.', builtin: true },
  { id: 'def-ss', label: 'Safety stock', body: 'Include safety stock and reorder point calculations factoring in demand variability and lead time.', builtin: true },
  { id: 'def-risk', label: 'Supplier risk', body: 'Strengthen your supplier risk evaluation with specific contingency and dual-sourcing options.', builtin: true },
  { id: 'def-exec', label: 'Strong summary', body: 'Well-structured executive summary with clear, quantified procurement recommendations.', builtin: true },
];

export default function AssignmentMarking() {
  const { assignmentId } = useParams();
  const { isTA, profile } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useLoad(async () => {
    const a = await run(supabase.from('assignments').select('*, courses(id, code, title)').eq('id', assignmentId).single());
    const [students, subs, peerData, reviews, courseExemplars, snippetRes, bookingEvents, staffRole, annMap] = await Promise.all([
      rpcAll('course_students', { p_course: a.course_id }),
      allSubmissions(assignmentId),
      rpc('assignment_peer_reviews', { p_assignment: assignmentId }).catch(() => ({ reviews: [], _missing: true })),
      rpc('course_mark_reviews', { p_course: a.course_id, p_assignment: assignmentId }).catch(() => []),
      rpc('course_assignment_exemplars', { p_course: a.course_id }).catch(() => []),
      supabase.from('grading_snippets').select('id, label, body').order('created_at', { ascending: false }).then((r) => r.data || [], () => []),
      rpc('course_booking_events', { p_course: a.course_id }).catch(() => []),
      rpc('my_course_staff_role', { p_course: a.course_id }).catch(() => null),
      rpc('assignment_annotations_map', { p_assignment: assignmentId }).catch(() => ({})),
    ]);
    const byIndex = new Map(subs.map((s) => [s.profiles?.index_no, s]));
    const rows = students.map((st) => ({ ...st, sub: byIndex.get(st.index_no) || null }));
    subs.filter((s) => !students.some((st) => st.index_no === s.profiles?.index_no))
      .forEach((s) => rows.push({ index_no: s.profiles?.index_no, full_name: s.profiles?.full_name, activated: true, sub: s }));
    const localSnipKey = `pscm_grading_snippets:${profile?.id || 'staff'}`;
    let localSnips = [];
    try { localSnips = JSON.parse(localStorage.getItem(localSnipKey) || '[]'); } catch { localSnips = []; }
    const rawDbSnips = Array.isArray(snippetRes) ? snippetRes : [];
    const modelLabel = `${AI_MODEL_ANSWER_PREFIX}${assignmentId}`;
    const modelRow = rawDbSnips.find((s) => s.label === modelLabel) || null;
    let localModelAnswer = '';
    try { localModelAnswer = localStorage.getItem(`pscm_ai_model_answer:${assignmentId}`) || ''; } catch { /* ignore */ }
    const dbSnips = rawDbSnips.filter((s) => !String(s.label || '').startsWith(AI_MODEL_ANSWER_PREFIX));
    const seenLabels = new Set(dbSnips.map((s) => s.label));
    const customSnippets = [...dbSnips, ...localSnips.filter((s) => !seenLabels.has(s.label))];
    const exemplars = (Array.isArray(courseExemplars) ? courseExemplars : []).filter((ex) => ex.assignment_id === assignmentId);
    return {
      a,
      rows,
      peerReviews: peerData?.reviews || [],
      peerMissingRpc: Boolean(peerData?._missing),
      reviews: Array.isArray(reviews) ? reviews : [],
      exemplars,
      customSnippets,
      aiModelAnswer: modelRow?.body || localModelAnswer || '',
      aiModelSnippetId: modelRow?.id || null,
      bookingEvents: Array.isArray(bookingEvents) ? bookingEvents : [],
      staffRole: staffRole || 'lecturer',
      annMap: annMap && typeof annMap === 'object' ? annMap : {},
    };
  }, [assignmentId]);

  const [filter, setFilter] = useState('tomark');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState(ALL_GROUPS);
  const [sort, setSort] = useState('name_asc');
  const [marking, setMarking] = useState(null);
  const [gradingPres, setGradingPres] = useState(false);
  const [editing, setEditing] = useState(false);
  const [previewingDoc, setPreviewingDoc] = useState(null);
  const [showSql, setShowSql] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [act, busy] = useAction();
  const [blindMode, setBlindMode] = useState(false);
  const [extTarget, setExtTarget] = useState(null);
  const [nudging, setNudging] = useState(false);
  const [checkingSim, setCheckingSim] = useState(false);
  const [aiGrading, setAiGrading] = useState(false);
  const [viewingTopics, setViewingTopics] = useState(false);
  const [annotating, setAnnotating] = useState(null);
  const isExaminer = data?.staffRole === 'external_examiner';
  const isPureTA = isTA && data?.staffRole !== 'co_lecturer' && !isExaminer;
  const restrictedEdit = isPureTA || isExaminer;

  const assignMeta = useMemo(() => parseAssignmentMeta(data?.a), [data?.a]);

  const peerStatsByIndex = useMemo(() => {
    const map = new Map();
    for (const rev of data?.peerReviews || []) {
      const fromIdx = normalizeIndexNo(rev.reviewer_index);
      const fromName = rev.reviewer_name || fromIdx;
      for (const item of rev.ratings || []) {
        const target = normalizeIndexNo(item.index_no);
        const score = Number(item.score);
        if (!target || Number.isNaN(score) || score <= 0) continue;
        if (!map.has(target)) map.set(target, { scores: [], notes: [] });
        const entry = map.get(target);
        entry.scores.push(score);
        if (item.note || score <= 2) {
          entry.notes.push({
            fromIndex: fromIdx,
            fromName,
            score,
            note: String(item.note || '').trim(),
          });
        }
      }
    }
    for (const r of data?.rows || []) {
      const labRatings = r?.sub?.typing_meta?.syndicatePeerRatings;
      if (!Array.isArray(labRatings) || !labRatings.length) continue;
      const fromIdx = normalizeIndexNo(r?.sub?.typing_meta?.submittedByIndex || r.index_no);
      const fromName = r.full_name || fromIdx || 'Teammate';
      for (const item of labRatings) {
        const target = normalizeIndexNo(item.indexNo || item.index_no);
        const score = Number(item.score);
        if (!target || Number.isNaN(score) || score <= 0) continue;
        if (!map.has(target)) map.set(target, { scores: [], notes: [] });
        const entry = map.get(target);
        entry.scores.push(score);
        if (item.note || score <= 3) {
          entry.notes.push({
            fromIndex: fromIdx,
            fromName,
            score,
            note: String(item.note || '').trim(),
          });
        }
      }
    }
    const out = new Map();
    for (const [k, v] of map.entries()) {
      const avgScore = Number((v.scores.reduce((s, n) => s + n, 0) / v.scores.length).toFixed(1));
      const minScore = Math.min(...v.scores);
      out.set(k, {
        avgScore,
        minScore,
        count: v.scores.length,
        flagged: avgScore < 2.8 || minScore <= 2,
        notes: v.notes,
      });
    }
    return out;
  }, [data?.peerReviews, data?.rows]);

  // Filter by target programme/stream/class & attach syndicate group, peer check stats & fallback teammate upload
  const enrichedRows = useMemo(() => {
    if (!data) return [];
    const restricted = hasAudienceFilter(assignMeta);
    const eligibleRows = restricted
      ? data.rows.filter((r) => assignmentMatchesStudent(assignMeta, r) || Boolean(r.sub))
      : data.rows;
    const byNorm = new Map(eligibleRows.map((r) => [normalizeIndexNo(r.index_no), r]));
    return eligibleRows.map((r) => {
      const syn = findStudentSyndicate(assignMeta, r.index_no);
      let synLeaderSub = null;
      if (syn && !r.sub) {
        for (const mIdx of syn.members) {
          const mate = byNorm.get(mIdx);
          if (mate?.sub) {
            synLeaderSub = mate.sub;
            break;
          }
        }
      }
      const peer = peerStatsByIndex.get(normalizeIndexNo(r.index_no)) || null;
      const dueInfo = resolveEffectiveDue(data.a, assignMeta, r);
      const effSub = r.sub || synLeaderSub;
      const isLate = effSub
        ? (dueInfo.source !== 'default' && dueInfo.dueAt
            ? new Date(effSub.submitted_at) > new Date(dueInfo.dueAt)
            : Boolean(effSub.is_late))
        : false;
      return { ...r, _syn: syn, _synLeaderSub: synLeaderSub, _peer: peer, _dueInfo: dueInfo, _isLate: isLate };
    });
  }, [data, assignMeta, peerStatsByIndex]);

  const blindMap = useMemo(() => {
    const map = new Map();
    const aId = data?.a?.id || '';
    const pad = Math.max(2, String(enrichedRows.length).length);
    const shuffled = [...enrichedRows].sort((x, y) =>
      hashSeed(`${aId}:${x.index_no}`) - hashSeed(`${aId}:${y.index_no}`)
    );
    shuffled.forEach((r, idx) => {
      map.set(normalizeIndexNo(r.index_no), {
        num: idx + 1,
        label: `Candidate #${String(idx + 1).padStart(pad, '0')}`,
      });
    });
    const synMap = new Map();
    const syns = [...(assignMeta.syndicate?.groups || [])].sort((x, y) =>
      hashSeed(`${aId}:${x.id}`) - hashSeed(`${aId}:${y.id}`)
    );
    syns.forEach((g, idx) => synMap.set(g.id, synAlphaLabel(idx)));
    return { students: map, syndicates: synMap };
  }, [enrichedRows, data?.a?.id, assignMeta.syndicate?.groups]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = enrichedRows.filter((r) => {
      if (!matchesGroup(r, group)) return false;
      const effectiveSub = r.sub || r._synLeaderSub;
      if (filter === 'tomark' && !(effectiveSub && (r.sub ? r.sub.marks === null : true))) return false;
      if (filter === 'marked' && !(r.sub && r.sub.marks !== null)) return false;
      if (filter === 'missing' && effectiveSub) return false;
      if (filter === 'late' && !r._isLate) return false;
      if (term) {
        if (blindMode) {
          const blindInfo = blindMap.students.get(normalizeIndexNo(r.index_no));
          const blindSyn = r._syn ? (blindMap.syndicates.get(r._syn.id) || '') : '';
          const hay = [blindInfo?.label, blindSyn].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(term)) return false;
        } else {
          const hay = [r.full_name, r.index_no, r.programme, r.stream, r._syn?.name].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(term)) return false;
        }
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      const blindCmp = () => {
        const na = blindMap.students.get(normalizeIndexNo(a.index_no))?.num ?? 0;
        const nb = blindMap.students.get(normalizeIndexNo(b.index_no))?.num ?? 0;
        return na - nb;
      };
      if (blindMode && ['name_asc', 'name_desc', 'index_asc', 'index_desc', 'prog_asc', 'prog_desc', 'stream_asc'].includes(sort)) {
        return blindCmp();
      }
      switch (sort) {
        case 'syn_asc': return compareText(
          blindMode ? (blindMap.syndicates.get(a._syn?.id) || 'zzz') : (a._syn?.name || 'zzz'),
          blindMode ? (blindMap.syndicates.get(b._syn?.id) || 'zzz') : (b._syn?.name || 'zzz'),
          'asc'
        ) || (blindMode ? blindCmp() : byNameIndex(a, b));
        case 'marks_desc': return compareNumber(a.sub?.marks, b.sub?.marks, 'desc') || (blindMode ? blindCmp() : byNameIndex(a, b));
        case 'marks_asc': return compareNumber(a.sub?.marks, b.sub?.marks, 'asc') || (blindMode ? blindCmp() : byNameIndex(a, b));
        case 'sub_desc': return compareDate((a.sub || a._synLeaderSub)?.submitted_at, (b.sub || b._synLeaderSub)?.submitted_at, 'desc') || (blindMode ? blindCmp() : byNameIndex(a, b));
        case 'sub_asc': return compareDate((a.sub || a._synLeaderSub)?.submitted_at, (b.sub || b._synLeaderSub)?.submitted_at, 'asc') || (blindMode ? blindCmp() : byNameIndex(a, b));
        case 'name_desc': return compareText(a.full_name, b.full_name, 'desc') || compareText(a.index_no, b.index_no, 'asc');
        case 'index_asc': return compareText(a.index_no, b.index_no, 'asc') || byNameIndex(a, b);
        case 'index_desc': return compareText(a.index_no, b.index_no, 'desc') || byNameIndex(a, b);
        case 'prog_asc': return compareText(a.programme, b.programme, 'asc') || compareText(a.stream, b.stream, 'asc') || byNameIndex(a, b);
        case 'prog_desc': return compareText(a.programme, b.programme, 'desc') || compareText(a.stream, b.stream, 'asc') || byNameIndex(a, b);
        case 'stream_asc': return compareText(a.stream, b.stream, 'asc') || compareText(a.programme, b.programme, 'asc') || byNameIndex(a, b);
        case 'name_asc':
        default: return byNameIndex(a, b);
      }
    });
  }, [enrichedRows, filter, q, group, sort, blindMode, blindMap]);

  if (loading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} onRetry={reload} /></div>;

  const { a } = data;
  const rows = enrichedRows.filter((r) => matchesGroup(r, group));
  const summary = groupSummary(enrichedRows, (r) => !!r.sub && r.sub.marks !== null, (r) => pct(r.sub.marks, a.max_marks));
  const submitted = rows.filter((r) => r.sub || r._synLeaderSub);
  const missingRows = rows.filter((r) => !(r.sub || r._synLeaderSub));
  const marked = rows.filter((r) => r.sub && r.sub.marks !== null);
  const late = submitted.filter((r) => r._isLate);
  const showPeerCol = assignMeta.syndicate.enabled && assignMeta.syndicate.peerCheck !== false;
  const flaggedPeerCount = showPeerCol ? rows.filter((r) => r._peer?.flagged).length : 0;
  const ungroupedCount = assignMeta.syndicate.enabled ? rows.filter((r) => !r._syn).length : 0;
  const subRuleLabel = formatSubmissionRules(assignMeta);
  const avg = marked.length ? Math.round(marked.reduce((s, r) => s + pct(r.sub.marks, a.max_marks), 0) / marked.length) : null;

  async function toggleRelease() {
    const next = !a.results_released;
    const ok = await act(() => run(supabase.from('assignments').update({ results_released: next }).eq('id', a.id)),
      next ? 'Marks released to students.' : 'Marks hidden from students.');
    if (ok !== undefined) setData((d) => ({ ...d, a: { ...d.a, results_released: next } }));
  }

  function exportXlsx() {
    const includeTypedCol = assignMeta.submission?.mode !== 'file' || enrichedRows.some((r) => Boolean(r.sub?.response_text));
    const header = ['Index number', 'Name', 'Programme', 'Stream', ...(assignMeta.syndicate.enabled ? ['Syndicate Group'] : []), 'Submitted', 'Late', 'File', ...(includeTypedCol ? ['Typed Response'] : []), 'Marks', 'Out of', 'Percent', 'Feedback'];
    const line = (r) => [
      r.index_no, r.full_name, r.programme || '', r.stream || '',
      ...(assignMeta.syndicate.enabled ? [r._syn?.name || ''] : []),
      r.sub ? fmtFull(r.sub.submitted_at) : 'Not submitted', r.sub?.is_late ? 'Yes' : '',
      r.sub?.file_name || '', ...(includeTypedCol ? [r.sub?.response_text || ''] : []), r.sub?.marks !== null && r.sub?.marks !== undefined ? Number(r.sub.marks) : '', Number(a.max_marks),
      r.sub?.marks !== null && r.sub?.marks !== undefined ? pct(r.sub.marks, a.max_marks) : '', r.sub?.feedback || '',
    ];
    const widths = [16, 30, 18, 12, ...(assignMeta.syndicate.enabled ? [16] : []), 22, 8, 30, ...(includeTypedCol ? [60] : []), 10, 10, 10, 50];
    const sheets = [
      { name: 'All students', rows: [header, ...enrichedRows.map(line)], widths },
      { name: 'Summary', rows: [['Programme', 'Stream', 'Students', 'Marked', 'Average %'],
        ...summary.map((g) => [groupLabel(g.programme), groupLabel(g.stream), g.students, g.submitted, g.average ?? ''])], widths: [22, 14, 10, 10, 10] },
    ];
    const streams = [...new Set(enrichedRows.map((r) => r.stream || ''))];
    if (streams.length > 1) streams.sort().forEach((st) => sheets.push({ name: groupLabel(st), rows: [header, ...enrichedRows.filter((r) => (r.stream || '') === st).map(line)], widths }));
    downloadWorkbook(`${a.courses.code} - ${a.title}.xlsx`, sheets);
  }

  function updateSub(id, patch) {
    setData((d) => ({ ...d, rows: d.rows.map((r) => (r.sub?.id === id ? { ...r, sub: { ...r.sub, ...patch } } : r)) }));
  }

  function openBriefDoc() {
    const doc = assignMeta.doc;
    if (!doc?.path) return;
    const isPdf = /\.pdf$/i.test(doc.name || doc.path);
    if (isPdf && (doc.viewOnly || isViewOnlyPath(doc.path))) {
      setPreviewingDoc({
        id: a.id,
        title: doc.name || a.title,
        storage_path: setViewOnlyFlag(doc.path, true),
      });
      return;
    }
    act(() => openStoredFile('materials', doc.path));
  }

  async function addSnippet(label, body) {
    const cleanLabel = label.trim();
    const cleanBody = body.trim();
    if (!cleanLabel || !cleanBody) return;
    let savedRow = { id: `local-${Date.now()}`, label: cleanLabel, body: cleanBody, local: true };
    try {
      const { data: inserted, error: insErr } = await supabase
        .from('grading_snippets')
        .insert({ owner_id: profile?.id, label: cleanLabel, body: cleanBody })
        .select('id, label, body')
        .single();
      if (!insErr && inserted) savedRow = inserted;
    } catch { /* fallback to localStorage */ }
    try {
      const k = `pscm_grading_snippets:${profile?.id || 'staff'}`;
      const cur = JSON.parse(localStorage.getItem(k) || '[]');
      localStorage.setItem(k, JSON.stringify([savedRow, ...cur.filter((x) => x.label !== cleanLabel)].slice(0, 30)));
    } catch { /* ignore */ }
    setData((d) => ({ ...d, customSnippets: [savedRow, ...(d.customSnippets || []).filter((x) => x.id !== savedRow.id && x.label !== cleanLabel)] }));
    toast(`Saved feedback snippet "${cleanLabel}".`);
  }
  async function deleteSnippet(snip) {
    try {
      if (snip.id && !String(snip.id).startsWith('local-')) {
        await supabase.from('grading_snippets').delete().eq('id', snip.id);
      }
      const k = `pscm_grading_snippets:${profile?.id || 'staff'}`;
      const cur = JSON.parse(localStorage.getItem(k) || '[]');
      localStorage.setItem(k, JSON.stringify(cur.filter((x) => x.id !== snip.id && x.label !== snip.label)));
    } catch { /* ignore */ }
    setData((d) => ({ ...d, customSnippets: (d.customSnippets || []).filter((x) => x.id !== snip.id) }));
  }
  function copySql() {
    navigator.clipboard?.writeText?.(ALL_NEW_FEATURES_SQL);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 3000);
  }

  return (
    <>
      <Topbar title={a.title} sub={`${a.courses.code} · ${a.due_at ? `due ${fmtFull(a.due_at)}` : 'no deadline'} · ${fmtNumber(a.max_marks)} marks`}>
        <Link to={`/teach/course/${a.course_id}?tab=assignments`} className="btn"><Icon name="chevronLeft" /> Assignments</Link>
        {isExaminer && <span className="badge badge-plum">External Examiner · Read-Only</span>}
        {!restrictedEdit && <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> Edit</button>}
        {!restrictedEdit && (
          <button type="button" className={`btn ${a.results_released ? '' : 'btn-primary'}`} onClick={toggleRelease} disabled={busy}>
            {a.results_released ? 'Hide marks' : 'Release marks'}
          </button>
        )}
      </Topbar>

      <div className="page stack">
        {isExaminer && (
          <div className="notice notice-info small">
            <strong>External Examiner Mode:</strong> You can inspect submissions, inline PDF annotations, similarity reports, and marks in read-only mode. Editing marks or releasing grades is disabled.
          </div>
        )}
        {!isExaminer && data.reviews?.length > 0 && (
          <MarkReviewQueue reviews={data.reviews} onResolved={reload} title="Assignment mark review requests" />
        )}

        <div className="grid-4">
          <div className="kpi">
            <div className="kpi-head"><span className="l">Submitted</span><span className="kpi-icon"><Icon name="upload" size={16} /></span></div>
            <span className="v">{submitted.length}</span>
            <span className="tiny muted">of {rows.length} students</span>
          </div>
          <div className="kpi">
            <div className="kpi-head"><span className="l">Marked</span><span className="kpi-icon"><Icon name="check" size={16} /></span></div>
            <span className="v">{marked.length}</span>
            <span className="tiny muted">{Math.max(0, submitted.length - marked.length)} still to mark</span>
          </div>
          <div className="kpi">
            <div className="kpi-head"><span className="l">Late</span><span className="kpi-icon amber"><Icon name="clock" size={16} /></span></div>
            <span className="v" style={{ color: late.length ? 'var(--amber-ink)' : undefined }}>{late.length}</span>
          </div>
          <div className="kpi">
            <div className="kpi-head"><span className="l">Average mark</span><span className="kpi-icon blue"><Icon name="chart" size={16} /></span></div>
            <span className="v">{avg === null ? '—' : `${avg}%`}</span>
          </div>
        </div>

        {(() => {
          const debrief = summarizeClassLabSubmissions(enrichedRows, assignMeta);
          if (!debrief.labSubmissionCount) return null;
          const batchCandidates = computeBatchLabAutoScores(enrichedRows, assignMeta, Number(data?.a?.max_marks) || 100);
          const simPairs = detectJudgementSimilarityPairs(enrichedRows, 0.55);
          const runBatchAutoScore = async () => {
            if (!batchCandidates.length) return;
            let saved = 0;
            for (const item of batchCandidates) {
              try {
                await rpc('mark_submission', {
                  p_submission: item.submissionId,
                  p_marks: item.suggestedTotal,
                  p_feedback: item.feedbackNote,
                });
                saved += 1;
              } catch {
                // continue remaining submissions
              }
            }
            toast(`Batch auto-scored ${saved} of ${batchCandidates.length} ungraded lab submission${batchCandidates.length === 1 ? '' : 's'}. Review written judgements before releasing marks.`);
            reload();
          };
          return (
            <section className="lab-evidence-card">
              <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div className="tiny mono" style={{ color: 'var(--teal-700)', fontWeight: 700 }}>
                    ● CLASS-WIDE INTERACTIVE LAB DEBRIEF ANALYTICS
                  </div>
                  <strong className="small">{debrief.moduleLine}</strong>
                </div>
                <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="tiny mono muted">
                    {debrief.labSubmissionCount} lab report{debrief.labSubmissionCount === 1 ? '' : 's'} analyzed
                  </span>
                  {!restrictedEdit && batchCandidates.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={runBatchAutoScore}
                      title="Applies auto-suggested quantitative rubric marks across all ungraded lab reports (does not release marks yet)"
                    >
                      <Icon name="check" size={13} /> Batch Auto-Score Quantitative ({batchCandidates.length})
                    </button>
                  )}
                </div>
              </div>

              <div className="lab-evidence-grid">
                <div className="lab-evidence-metric">
                  <span className="tiny muted">Class Avg Quantitative Score</span>
                  <strong className="mono small" style={{ color: debrief.avgQuantPct >= 75 ? 'var(--teal-700)' : 'var(--amber)' }}>
                    {debrief.avgQuantPct}%
                  </strong>
                </div>
                <div className="lab-evidence-metric">
                  <span className="tiny muted">Judgement Pass Rate</span>
                  <strong className="mono small">{debrief.judgementPassPct}%</strong>
                </div>
                <div className="lab-evidence-metric">
                  <span className="tiny muted">Avg Written Judgement</span>
                  <strong className="mono small">{debrief.avgJudgementWords} words</strong>
                </div>
                {debrief.metricSummary.slice(0, 3).map((m) => (
                  <div key={m.label} className="lab-evidence-metric">
                    <span className="tiny muted">Class Avg {m.label}</span>
                    <strong className="mono small">{m.avgPct}%</strong>
                  </div>
                ))}
              </div>

              {simPairs.length > 0 && (
                <div className="notice-err stack-xs" style={{ marginTop: 8, padding: 10 }}>
                  <strong className="tiny">
                    ▲ Written Managerial Judgement Similarity Alert ({simPairs.length} high-overlap pair{simPairs.length === 1 ? '' : 's'} detected)
                  </strong>
                  {simPairs.slice(0, 5).map((p, idx) => (
                    <div key={idx} className="tiny">
                      <strong className="mono">{p.similarityPct}% overlap:</strong> {p.aLabel} ↔ {p.bLabel}
                    </div>
                  ))}
                </div>
              )}
              {debrief.pitfalls.length > 0 && (
                <div className="stack-xs" style={{ background: 'var(--surface)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)' }}>
                  <span className="tiny mono" style={{ color: 'var(--amber)', fontWeight: 700 }}>
                    ▲ LECTURE DEBRIEF TALKING POINTS (COMMON STUDENT PITFALLS):
                  </span>
                  {debrief.pitfalls.map((tip, i) => (
                    <div key={i} className="tiny">• {tip}</div>
                  ))}
                </div>
              )}
            </section>
          );
        })()}

        {(assignMeta.rubric.length > 0 || assignMeta.syndicate.enabled || hasAudienceFilter(assignMeta) || assignMeta.doc?.path || subRuleLabel || assignMeta.topicRegistration?.enabled) && (
          <div className="notice notice-info row-wrap" style={{ justifyContent: 'space-between', gap: 10 }}>
            <div className="row-wrap" style={{ gap: 8 }}>
              {hasAudienceFilter(assignMeta) && (
                <span className="badge badge-plum"><Icon name="users" size={13} /> Target: {formatAssignmentAudience(assignMeta)}</span>
              )}
              {subRuleLabel && (
                <span className="badge"><Icon name={assignMeta.submission?.mode === 'typed' ? 'edit' : 'file'} size={13} /> {subRuleLabel}</span>
              )}
              {assignMeta.syndicate.enabled && (
                <span className="badge badge-teal"><Icon name="users" size={13} /> Syndicate Mode ({assignMeta.syndicate.groups.length} groups)</span>
              )}
              {ungroupedCount > 0 && (
                <span className="badge badge-amber">
                  <Icon name="alert" size={13} /> {ungroupedCount} ungrouped student{ungroupedCount === 1 ? '' : 's'}
                </span>
              )}
              {flaggedPeerCount > 0 && (
                <span className="badge badge-red"><Icon name="alert" size={13} /> {flaggedPeerCount} Low Peer Rating{flaggedPeerCount === 1 ? '' : 's'}</span>
              )}
              {assignMeta.rubric.length > 0 && (
                <span className="badge badge-blue"><Icon name="clipboard" size={13} /> Clickable Rubric ({assignMeta.rubric.length} criteria)</span>
              )}
              {assignMeta.topicRegistration?.enabled && (
                <span className="badge badge-teal"><Icon name="tag" size={13} /> {formatTopicRuleLabel(assignMeta)}</span>
              )}
            </div>
            <div className="row-wrap" style={{ gap: 8 }}>
              {assignMeta.doc?.path && (
                <button type="button" className="btn btn-sm" onClick={openBriefDoc}>
                  <Icon name={assignMeta.doc.viewOnly ? 'lock' : 'file'} size={14} /> {assignMeta.doc.name} ({assignMeta.doc.viewOnly ? 'Read-only' : 'Download'})
                </button>
              )}
              {assignMeta.syndicate.enabled && (
                <span className="tiny muted">Marking one group submission can apply scores across every member in that syndicate.</span>
              )}
              {!restrictedEdit && ungroupedCount > 0 && (
                <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
                  <Icon name="users" size={14} /> Assign ungrouped ({ungroupedCount})
                </button>
              )}
              {!restrictedEdit && assignMeta.syndicate.enabled && assignMeta.syndicate.groups.length > 0 && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setGradingPres(true)}>
                  <Icon name="award" size={14} /> Grade live presentation
                </button>
              )}
            </div>
          </div>
        )}

        {data.exemplars?.length > 0 && (
          <div className="notice notice-info stack-sm" style={{ padding: '10px 14px' }}>
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span className="small">
                <strong><Icon name="award" size={14} /> {data.exemplars.length} Anonymized Model Exemplar{data.exemplars.length === 1 ? '' : 's'}</strong>{' '}
                {a.results_released ? '(visible to students under this assignment)' : '(will become visible to students when you release marks)'}
              </span>
            </div>
            <div className="row-wrap" style={{ gap: 6 }}>
              {data.exemplars.map((ex) => (
                <span key={ex.id} className="badge badge-teal" style={{ gap: 6 }}>
                  {ex.title} ({ex.marks !== null && ex.marks !== undefined ? `${fmtNumber(ex.marks)}/${fmtNumber(a.max_marks)}` : 'Exemplar'})
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ padding: '0 3px', minHeight: 16, fontSize: 12, lineHeight: 1 }}
                    aria-label={`Remove ${ex.title}`}
                    onClick={() => act(async () => { await rpc('remove_assignment_exemplar', { p_exemplar: ex.id }); reload(); }, 'Exemplar removed.')}
                  >×</button>
                </span>
              ))}
            </div>
          </div>
        )}
        <GroupFilters rows={enrichedRows} value={group} onChange={setGroup} />
        <GroupSummaryTable summary={summary} doneLabel="Marked" />

        {!a.results_released && marked.length > 0 && (
          <div className="notice notice-warn">
            {isTA ? 'Students cannot see these marks until the lecturer releases them.' : <>Students cannot see their marks yet. Press <strong>Release marks</strong> when you have finished.</>}
          </div>
        )}

        <section className="card-flush">
          <div className="card-head" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="row-wrap" style={{ flex: 1, minWidth: 260 }}>
              <label className="search">
                <span className="sr-only">Search</span>
                <Icon name="search" size={16} />
                <input className="input" style={{ width: 230, minHeight: 40 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={blindMode ? "Candidate # (blind mode)" : "Name, index, syndicate, stream"} />
              </label>
              <div className="chips" role="group" aria-label="Filter">
                {[['tomark', `To mark · ${Math.max(0, submitted.length - marked.length)}`], ['marked', 'Marked'], ['late', 'Late'], ['missing', 'Not submitted'], ['all', 'All']].map(([id, label]) => (
                  <button key={id} type="button" className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
                ))}
              </div>
              <SortSelect
                value={sort}
                onChange={setSort}
                options={[
                  ...(assignMeta.syndicate.enabled ? [{ value: 'syn_asc', label: 'Syndicate Group (A → Z)' }] : []),
                  { value: 'marks_desc', label: 'Marks: High → Low' },
                  { value: 'marks_asc', label: 'Marks: Low → High' },
                  { value: 'name_asc', label: 'Name (A → Z)' },
                  { value: 'name_desc', label: 'Name (Z → A)' },
                  { value: 'index_asc', label: 'Index no. (Ascending)' },
                  { value: 'index_desc', label: 'Index no. (Descending)' },
                  { value: 'prog_asc', label: 'Programme / Class (A → Z)' },
                  { value: 'stream_asc', label: 'Stream (A → Z)' },
                  { value: 'sub_desc', label: 'Submitted (Newest first)' },
                  { value: 'sub_asc', label: 'Submitted (Oldest first)' },
                ]}
              />
            </div>
            <div className="row-wrap" style={{ gap: 8 }}>
              <button
                type="button"
                className={`btn btn-sm ${blindMode ? 'btn-primary' : ''}`}
                onClick={() => { setBlindMode((v) => !v); setQ(''); }}
                title="Mask student names and index numbers during grading to reduce bias"
              >
                <Icon name={blindMode ? 'eyeOff' : 'eye'} size={15} /> {blindMode ? 'Blind mode ON' : 'Blind marking'}
              </button>
              {assignMeta.topicRegistration?.enabled && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setViewingTopics(true)}
                  title="View registered products/firms, audit for duplicates with AI, or ask a group to change"
                >
                  <Icon name="tag" size={15} /> Registered products
                </button>
              )}
              {!isExaminer && submitted.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => setAiGrading(true)}
                  title="Grade submitted typed answers, Word docs, and text PDFs against your private model answer"
                >
                  <Icon name="sparkles" size={15} /> AI mark
                </button>
              )}
              {submitted.length >= 2 && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setCheckingSim(true)}
                  title="Compare submitted texts, PDFs, and Word docs for collusion"
                >
                  <Icon name="shield" size={15} /> Check similarities
                </button>
              )}
              {!restrictedEdit && missingRows.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setNudging(true)}
                  title="Send personalized reminder messages to eligible students who have not submitted"
                >
                  <Icon name="mail" size={15} /> Nudge missing ({missingRows.length})
                </button>
              )}
              <button type="button" className="btn btn-sm" onClick={exportXlsx}><Icon name="download" size={16} /> Export to Excel</button>
            </div>
          </div>

          {shown.length === 0 ? <Empty icon="inbox">{filter === 'tomark' ? 'Nothing waiting to be marked.' : 'No students match.'}</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortTh label="Index no." ascKey="index_asc" descKey="index_desc" current={sort} onSort={setSort} />
                    <SortTh label="Student" ascKey="name_asc" descKey="name_desc" current={sort} onSort={setSort} />
                    {assignMeta.syndicate.enabled && <SortTh label="Syndicate" ascKey="syn_asc" descKey="syn_asc" current={sort} onSort={setSort} />}
                    {showPeerCol && <th>Peer Check</th>}
                    <SortTh label="Group" ascKey="prog_asc" descKey="prog_desc" current={sort} onSort={setSort} className="hide-sm" />
                    <SortTh label="Submitted" ascKey="sub_asc" descKey="sub_desc" defaultDir="desc" current={sort} onSort={setSort} />
                    <SortTh label="Marks" ascKey="marks_asc" descKey="marks_desc" defaultDir="desc" current={sort} onSort={setSort} className="num" />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 400).map((r, i) => {
                    const effectiveSub = r.sub || r._synLeaderSub;
                    const blindInfo = blindMap.students.get(normalizeIndexNo(r.index_no));
                    const displayIdx = blindMode ? (blindInfo?.label || 'Candidate') : r.index_no;
                    const displayName = blindMode ? 'Anonymous candidate' : r.full_name;
                    const displaySyn = r._syn ? (blindMode ? (blindMap.syndicates.get(r._syn.id) || 'Syndicate') : r._syn.name) : '';
                    return (
                      <tr key={r.index_no}>
                        <td className="mono small">{displayIdx}</td>
                        <td className={blindMode ? 'muted' : ''}>{displayName}</td>
                        {assignMeta.syndicate.enabled && (
                          <td>
                            {r._syn ? <span className="badge badge-blue">{displaySyn}</span> : <span className="tiny muted">—</span>}
                          </td>
                        )}
                        {showPeerCol && (
                          <td>
                            {r._peer ? (
                              <span className={`badge ${r._peer.flagged ? 'badge-red' : 'badge-teal'}`} title={`Average from ${r._peer.count} teammate rating(s)`}>
                                {r._peer.avgScore} / 5{r._peer.flagged ? ' · Flagged' : ''}
                              </span>
                            ) : (
                              <span className="tiny muted">—</span>
                            )}
                          </td>
                        )}
                        <td className="small muted hide-sm">{blindMode ? 'Hidden' : ([r.programme, r.stream].filter(Boolean).join(' · ') || '—')}</td>
                        <td className="small">
                          {effectiveSub ? (
                            <>
                              {relative(effectiveSub.submitted_at)} {r._isLate && <span className="badge badge-amber">Late</span>}
                              {!r.sub && r._synLeaderSub && <span className="badge" style={{ marginLeft: 4 }}>Group file</span>}
                              {r._dueInfo?.source !== 'default' && (
                                <span className={`badge ${r._dueInfo.source === 'student' ? 'badge-plum' : ''}`} style={{ marginLeft: 4 }} title={r._dueInfo.dueAt ? fmtFull(r._dueInfo.dueAt) : ''}>
                                  {r._dueInfo.source === 'student' ? 'Extended' : 'Class due'}
                                </span>
                              )}
                              <div className="tiny muted" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {effectiveSub.response_text
                                  ? `Typed (${effectiveSub.response_text.trim().split(/\s+/).filter(Boolean).length} words)${effectiveSub.file_path && effectiveSub.file_path !== 'typed:online' ? ` + ${effectiveSub.file_name}` : ''}`
                                  : effectiveSub.file_name}
                              </div>
                            </>
                          ) : (
                            <>
                              <span className="muted">Not submitted</span>
                              {r._dueInfo?.source !== 'default' && r._dueInfo.dueAt && (
                                <div className="tiny" style={{ color: 'var(--teal-dark)' }}>
                                  {r._dueInfo.source === 'student' ? 'Extended' : 'Class due'}: {fmtDateTime(r._dueInfo.dueAt)}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td className="num">{r.sub?.marks !== null && r.sub?.marks !== undefined ? `${fmtNumber(r.sub.marks)} / ${fmtNumber(a.max_marks)}` : '—'}</td>
                        <td>
                          <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                            {!restrictedEdit && (
                              <button
                                type="button"
                                className="icon-btn plain"
                                aria-label="Grant deadline extension"
                                title={r._dueInfo?.source === 'student' ? `Extended: ${fmtDateTime(r._dueInfo.dueAt)}` : 'Grant individual deadline extension'}
                                onClick={() => setExtTarget(r)}
                                style={r._dueInfo?.source === 'student' ? { color: 'var(--teal)' } : undefined}
                              >
                                <Icon name="clock" size={15} />
                              </button>
                            )}
                            {effectiveSub && (() => {
                              const isPdfSub = effectiveSub.file_path && !['presentation:in-class', 'typed:online'].includes(effectiveSub.file_path) && /\.pdf(?:$|\?|#)/i.test(effectiveSub.file_name || effectiveSub.file_path);
                              const annCount = Array.isArray(data.annMap?.[effectiveSub.id]) ? data.annMap[effectiveSub.id].length : 0;
                              return (
                                <>
                                  {effectiveSub.file_path === 'presentation:in-class' ? (
                                    <span className="badge badge-teal" title="Graded live in class">In-class</span>
                                  ) : effectiveSub.file_path === 'typed:online' ? (
                                    <button type="button" className="icon-btn plain" aria-label="Read typed response" title="Read typed response" onClick={() => setMarking(i)}><Icon name="eye" /></button>
                                  ) : effectiveSub.file_path ? (
                                    <button type="button" className="icon-btn plain" aria-label="Open file" onClick={() => act(() => openStoredFile('submissions', effectiveSub.file_path))}><Icon name="eye" /></button>
                                  ) : null}
                                  {isPdfSub && (
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      title={isExaminer ? 'View inline PDF annotations' : 'Annotate PDF submission inline'}
                                      onClick={() => setAnnotating({
                                        sub: effectiveSub,
                                        studentLabel: blindMode ? (blindMap.students.get(normalizeIndexNo(r.index_no))?.label || 'Candidate') : `${r.full_name} (${r.index_no})`,
                                      })}
                                    >
                                      <Icon name="pin" size={14} /> {annCount > 0 ? annCount : (isExaminer ? 'Pins' : 'Annotate')}
                                    </button>
                                  )}
                                  <button type="button" className={`btn btn-sm ${isExaminer ? '' : 'btn-primary'}`} onClick={() => setMarking(i)}>
                                    {isExaminer ? 'View' : (r.sub?.marks !== null && r.sub?.marks !== undefined ? 'Edit mark' : 'Mark')}
                                  </button>
                                </>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {marking !== null && (shown[marking]?.sub || shown[marking]?._synLeaderSub) && (
        <MarkModal
          key={(shown[marking].sub || shown[marking]._synLeaderSub).id + ':' + shown[marking].index_no}
          a={a}
          assignMeta={assignMeta}
          allRows={enrichedRows}
          row={shown[marking]}
          blindMode={blindMode}
          blindMap={blindMap}
          readOnly={isExaminer}
          annMap={data.annMap || {}}
          onOpenAnnotator={(targetSub, sLabel) => setAnnotating({ sub: targetSub, studentLabel: sLabel })}
          hasNext={shown.slice(marking + 1).some((r) => r.sub || r._synLeaderSub)}
          exemplars={data.exemplars || []}
          snippets={[...(data.customSnippets || []), ...DEFAULT_PSCM_SNIPPETS]}
          onAddSnippet={addSnippet}
          onDeleteSnippet={deleteSnippet}
          onExemplarChanged={reload}
          onShowSql={() => setShowSql(true)}
          onClose={() => setMarking(null)}
          onSaved={(patch, next, reloadFull) => {
            if (reloadFull) {
              reload();
            } else if (shown[marking].sub) {
              updateSub(shown[marking].sub.id, patch);
            }
            if (next) {
              const rest = shown.findIndex((r, k) => k > marking && (r.sub || r._synLeaderSub));
              setMarking(filter === 'tomark' ? (rest > -1 ? rest - 1 : null) : rest > -1 ? rest : null);
            } else setMarking(null);
          }}
        />
      )}

      {editing && <AssignmentForm course={{ id: a.course_id, code: a.courses?.code }} a={a} onClose={() => setEditing(false)} onSaved={reload} />}
      {previewingDoc && (
        <Suspense fallback={<div className="secure-reader-backdrop" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>}>
          <SecureSlideViewer
            material={previewingDoc}
            courseCode={a.courses?.code}
            watermarkText={profile?.full_name || 'Faculty Preview'}
            onClose={() => setPreviewingDoc(null)}
          />
        </Suspense>
      )}

      {gradingPres && (
        <PresentationModal
          a={a}
          assignMeta={assignMeta}
          allRows={enrichedRows}
          bookingEvents={data.bookingEvents || []}
          onClose={() => setGradingPres(false)}
          onSaved={reload}
        />
      )}
      {extTarget && (
        <ExtensionModal
          a={a}
          assignMeta={assignMeta}
          row={extTarget}
          onClose={() => setExtTarget(null)}
          onSaved={reload}
        />
      )}

      {viewingTopics && (
        <AssignmentTopicsModal
          a={a}
          assignMeta={assignMeta}
          readOnly={isExaminer}
          onChanged={reload}
          onClose={() => setViewingTopics(false)}
        />
      )}
      {aiGrading && !isExaminer && (
        <AssignmentAiGradeModal
          a={a}
          assignMeta={assignMeta}
          rows={enrichedRows}
          blindMode={blindMode}
          blindMap={blindMap}
          profileId={profile?.id || ''}
          initialModelAnswer={data.aiModelAnswer || ''}
          initialSnippetId={data.aiModelSnippetId || null}
          onModelAnswerSaved={(text, nextId) => setData((d) => ({ ...d, aiModelAnswer: text, aiModelSnippetId: nextId }))}
          onApplied={reload}
          onShowSql={() => setShowSql(true)}
          onClose={() => setAiGrading(false)}
        />
      )}
      {checkingSim && (
        <SimilarityModal
          a={a}
          assignMeta={assignMeta}
          rows={enrichedRows}
          blindMode={blindMode}
          blindMap={blindMap}
          onClose={() => setCheckingSim(false)}
        />
      )}

      {annotating?.sub && (
        <PdfAnnotatorModal
          submissionId={annotating.sub.id}
          filePath={annotating.sub.file_path}
          fileName={annotating.sub.file_name}
          studentLabel={annotating.studentLabel}
          initialAnnotations={data.annMap?.[annotating.sub.id] || []}
          snippets={[...(data.customSnippets || []), ...DEFAULT_PSCM_SNIPPETS]}
          readOnly={isExaminer}
          onSaved={(savedPins) => {
            setData((d) => ({
              ...d,
              annMap: { ...(d.annMap || {}), [annotating.sub.id]: savedPins },
            }));
          }}
          onClose={() => setAnnotating(null)}
        />
      )}

      {nudging && (
        <BulkNudgeModal
          courseId={a.course_id}
          courseCode={a.courses?.code || ''}
          title={`Nudge non-submitters · ${a.title}`}
          subtitle={`Eligible enrolled students with no submission recorded yet for "${a.title}".`}
          students={missingRows}
          defaultSubject={`Assignment Reminder: ${a.title} ({course})`}
          defaultMessage={[
            'Dear {name},',
            '',
            `We noticed you have not yet submitted "${a.title}" in {course}.`,
            a.due_at ? `Default deadline: ${fmtDateTime(a.due_at)}.` : '',
            '',
            'Please submit your work on the portal as soon as possible, or reply to this message if you are experiencing any difficulty.',
            '',
            'Regards,',
            'Course Lecturer',
          ].filter((line, idx, arr) => !(line === '' && arr[idx - 1] === '')).join('\n')}
          onClose={() => setNudging(false)}
        />
      )}

      {showSql && (
        <Modal title="Enable Syndicate Group Sync in Supabase" onClose={() => setShowSql(false)} wide>
          <p className="small muted">
            Run this one-time SQL script in your <strong>Supabase Dashboard → SQL Editor</strong> to enable automatic teammate syncing when one syndicate member uploads or gets marked.
          </p>
          <pre className="mono small" style={{ maxHeight: 260, overflowY: 'auto', padding: 12, background: 'var(--surface-2)', borderRadius: 8, fontSize: 11 }}>
            {ALL_NEW_FEATURES_SQL}
          </pre>
          <div className="between" style={{ alignItems: 'center', marginTop: 12 }}>
            <span className="tiny muted">100% idempotent — safe to run once on your live project.</span>
            <button type="button" className="btn btn-primary" onClick={copySql}>
              {copiedSql ? 'Copied SQL' : 'Copy SQL to Clipboard'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function MarkModal({ a, assignMeta, allRows, row, blindMode = false, blindMap = null, readOnly = false, annMap = {}, onOpenAnnotator, hasNext, exemplars = [], snippets = DEFAULT_PSCM_SNIPPETS, onAddSnippet, onDeleteSnippet, onExemplarChanged, onShowSql, onClose, onSaved }) {
  const toast = useToast();
  const [act] = useAction();
  const effectiveSub = row.sub || row._synLeaderSub;
  const [marks, setMarks] = useState(row.sub?.marks ?? '');
  const [feedback, setFeedback] = useState(row.sub?.feedback || '');
  const [busy, setBusy] = useState(false);
  const [addingSnip, setAddingSnip] = useState(false);
  const [snipLabel, setSnipLabel] = useState('');
  const [exOpen, setExOpen] = useState(false);
  const [exTitle, setExTitle] = useState('Model A-Grade Submission');
  const [exNote, setExNote] = useState('');
  const [exBusy, setExBusy] = useState(false);

  const syndicate = row._syn;
  const syndicatePeers = useMemo(() => {
    if (!syndicate) return [];
    const byNorm = new Map(allRows.map((r) => [normalizeIndexNo(r.index_no), r]));
    return syndicate.members.map((idx) => byNorm.get(idx) || { index_no: idx, full_name: idx });
  }, [syndicate, allRows]);

  const hasFlaggedPeer = syndicatePeers.some((p) => p._peer?.flagged);
  const [customSplit, setCustomSplit] = useState(false);
  const [memberMarks, setMemberMarks] = useState(() => {
    const init = {};
    syndicatePeers.forEach((p) => {
      if (p.sub?.marks !== null && p.sub?.marks !== undefined) init[p.index_no] = String(p.sub.marks);
    });
    return init;
  });

  function applyScaleToMember(indexNo, ratio) {
    const base = Number(marks);
    if (marks === '' || Number.isNaN(base)) {
      toast('Enter the base group mark first.', 'error');
      return;
    }
    const scaled = Number((base * ratio).toFixed(1));
    setMemberMarks((prev) => ({ ...prev, [indexNo]: String(scaled) }));
  }

  async function save(next, applyToGroup = false) {
    const m = Number(marks);
    if (marks === '' || Number.isNaN(m) || m < 0 || m > Number(a.max_marks)) {
      toast(`Marks must be between 0 and ${fmtNumber(a.max_marks)}.`, 'error');
      return;
    }
    if (customSplit) {
      for (const p of syndicatePeers) {
        const raw = memberMarks[p.index_no];
        const pm = raw === undefined || raw === '' ? m : Number(raw);
        if (Number.isNaN(pm) || pm < 0 || pm > Number(a.max_marks)) {
          toast(`Invalid mark for ${p.index_no} (must be 0 to ${fmtNumber(a.max_marks)}).`, 'error');
          return;
        }
      }
    }
    setBusy(true);
    try {
      const patch = { marks: m, feedback, marked_at: new Date().toISOString() };
      if (applyToGroup && syndicate?.members?.length) {
        let usedSqlSync = false;
        try {
          const updatedCount = await rpc('mark_syndicate_submission', {
            p_assignment: a.id,
            p_source_submission: effectiveSub.id,
            p_member_indexes: syndicate.members,
            p_marks: m,
            p_feedback: feedback,
          });
          usedSqlSync = true;

          // Apply any individual peer-contribution adjustments after ensuring all rows exist
          if (customSplit) {
            const overrides = syndicatePeers.filter((p) => {
              const raw = memberMarks[p.index_no];
              return raw !== undefined && raw !== '' && Number(raw) !== m;
            });
            if (overrides.length > 0) {
              const freshSubs = await allSubmissions(a.id);
              const subByIdx = new Map(freshSubs.map((s) => [normalizeIndexNo(s.profiles?.index_no), s]));
              await Promise.all(
                overrides.map((p) => {
                  const targetSub = subByIdx.get(normalizeIndexNo(p.index_no));
                  if (!targetSub) return Promise.resolve();
                  const pm = Number(memberMarks[p.index_no]);
                  return rpc('mark_submission', { p_submission: targetSub.id, p_marks: pm, p_feedback: feedback });
                })
              );
            }
          }

          toast(`Saved · ${syndicate.name} (${updatedCount} member${updatedCount === 1 ? '' : 's'} marked${customSplit ? ' with custom adjustments' : ''})`);
          onSaved(patch, next, true);
          return;
        } catch (synErr) {
          if (!usedSqlSync && /mark_syndicate_submission|Could not find|does not exist|schema cache/i.test(synErr.message || '')) {
            const withSub = syndicatePeers.filter((p) => p.sub?.id);
            await Promise.all(
              withSub.map((p) => {
                const raw = customSplit ? memberMarks[p.index_no] : undefined;
                const pm = raw !== undefined && raw !== '' ? Number(raw) : m;
                return rpc('mark_submission', { p_submission: p.sub.id, p_marks: pm, p_feedback: feedback });
              })
            );
            const missingCount = syndicatePeers.length - withSub.length;
            if (missingCount > 0) {
              toast(`Marked ${withSub.length} submitted member(s). Install Syndicate SQL to also sync marks to ${missingCount} un-uploaded member(s).`, 'error');
              onShowSql?.();
            } else {
              toast(`Saved · ${syndicate.name} (${withSub.length} members)`);
            }
            onSaved(patch, next, true);
            return;
          }
          throw synErr;
        }
      }

      if (!row.sub?.id) {
        toast('This teammate has not uploaded individually — use "Save & apply to group" or install Syndicate SQL.', 'error');
        return;
      }
      await rpc('mark_submission', { p_submission: row.sub.id, p_marks: m, p_feedback: feedback });
      toast(`Saved · ${row.full_name}`);
      onSaved(patch, next, false);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const saveRef = useRef(null);
  saveRef.current = () => {
    if (busy) return;
    if (syndicate && syndicatePeers.length > 1) save(hasNext, true);
    else save(hasNext, false);
  };
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        saveRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isInClass = effectiveSub.file_path === 'presentation:in-class';
  const isTypedOnly = effectiveSub.file_path === 'typed:online';
  const typedText = effectiveSub.response_text || '';
  const typedWords = typedText.trim() ? typedText.trim().split(/\s+/).length : 0;
  const tMeta = effectiveSub.typing_meta || {};
  const labEvidence = useMemo(
    () => parseLabVerificationSummary(typedText, tMeta),
    [typedText, tMeta],
  );
  const labSuggestion = useMemo(
    () => (labEvidence ? suggestLabRubricMarks({ parsed: labEvidence, criteria: assignMeta.rubric, maxMarks: Number(a.max_marks) }) : null),
    [labEvidence, assignMeta.rubric, a.max_marks],
  );

  return (
    <Modal
      title={(() => {
        const bStud = blindMode ? (blindMap?.students?.get(normalizeIndexNo(row.index_no))?.label || 'Candidate') : row.full_name;
        const bSyn = syndicate ? (blindMode ? (blindMap?.syndicates?.get(syndicate.id) || 'Syndicate') : syndicate.name) : '';
        return syndicate ? `${bStud} · ${bSyn}` : bStud;
      })()}
      wide
      onClose={onClose}
      footer={
        <>
          {!readOnly && <span className="tiny muted hide-sm" style={{ marginRight: 'auto' }}>Tip: Ctrl/Cmd + ↵ to save &amp; continue</span>}
          <button type="button" className="btn" onClick={onClose}>Close</button>
          {!readOnly && row.sub?.id && (
            <button type="button" className="btn" onClick={() => save(false, false)} disabled={busy}>Save single</button>
          )}
          {!readOnly && syndicate && syndicatePeers.length > 1 && (
            <button type="button" className="btn btn-primary" onClick={() => save(hasNext, true)} disabled={busy}>
              {hasNext ? `Save & apply to group (${syndicatePeers.length}) →` : `Save & apply to all ${syndicatePeers.length} members`}
            </button>
          )}
          {!readOnly && (!syndicate || syndicatePeers.length <= 1) && (
            <>
              {!hasNext && <button type="button" className="btn btn-primary" onClick={() => save(false, false)} disabled={busy}>Save</button>}
              {hasNext && <button type="button" className="btn btn-primary" onClick={() => save(true, false)} disabled={busy}>Save and next</button>}
            </>
          )}
        </>
      }
    >
      <div className="notice notice-info row-wrap">
        <Icon name={isTypedOnly ? 'edit' : 'file'} />
        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          <strong>{isTypedOnly ? `Typed online response (${typedWords} words)` : effectiveSub.file_name}</strong><br />
          <span className="small">Submitted {fmtFull(effectiveSub.submitted_at)}{effectiveSub.is_late ? ' · LATE' : ''}</span>
        </span>
        {!isInClass && !isTypedOnly && effectiveSub.file_path && /\.pdf(?:$|\?|#)/i.test(effectiveSub.file_name || effectiveSub.file_path) && onOpenAnnotator && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => onOpenAnnotator(effectiveSub, blindMode ? (blindMap?.students?.get(normalizeIndexNo(row.index_no))?.label || 'Candidate') : `${row.full_name} (${row.index_no})`)}
          >
            <Icon name="pin" size={14} /> {readOnly ? 'View PDF pins' : 'Annotate PDF'}
            {Array.isArray(annMap?.[effectiveSub.id]) && annMap[effectiveSub.id].length > 0 ? ` (${annMap[effectiveSub.id].length})` : ''}
          </button>
        )}
        {!isInClass && !isTypedOnly && effectiveSub.file_path && (
          <button type="button" className="btn btn-sm" onClick={() => act(() => openStoredFile('submissions', effectiveSub.file_path))}>Open file</button>
        )}
      </div>

      {typedText && (
        <div className="stack-sm" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 6 }}>
            <strong className="small">Student Typed Response · {typedWords} word{typedWords === 1 ? '' : 's'}</strong>
            <div className="row-wrap" style={{ gap: 6 }}>
              {(tMeta.pasteAttempts > 0 || tMeta.burstEvents > 0) && (
                <span className="badge badge-amber">
                  {tMeta.pasteAttempts > 0 ? `${tMeta.pasteAttempts} blocked paste attempt${tMeta.pasteAttempts === 1 ? '' : 's'}` : `${tMeta.burstEvents} rapid burst${tMeta.burstEvents === 1 ? '' : 's'}`}
                </span>
              )}
              {tMeta.activeMs > 0 && (
                <span className="tiny muted">{Math.max(1, Math.round(tMeta.activeMs / 60000))} min active typing</span>
              )}
            </div>
          </div>
          <div className="pre small" style={{ maxHeight: 260, overflowY: 'auto', padding: '10px 12px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--line-2)', lineHeight: 1.55 }}>
            {typedText}
          </div>
        </div>
      )}

      {syndicate && (
        <div className="stack-sm" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--teal-50)', border: '1px solid var(--teal)' }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 6 }}>
            <strong className="small" style={{ color: 'var(--teal-dark)' }}>
              {blindMode ? (blindMap?.syndicates?.get(syndicate.id) || 'Syndicate') : syndicate.name} ({syndicatePeers.length} members)
            </strong>
            {assignMeta.syndicate.peerCheck !== false && syndicatePeers.length > 1 && (
              <div className="row-wrap" style={{ gap: 8 }}>
                <label className="check" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={customSplit}
                    onChange={(e) => setCustomSplit(e.target.checked)}
                  />
                  <span className="tiny strong">Adjust individual marks{hasFlaggedPeer ? ' (low peer score detected)' : ''}</span>
                </label>
                {syndicatePeers.some((p) => p._peer) && marks !== '' && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ minHeight: 28, fontSize: 11.5 }}
                    onClick={() => {
                      const suggested = suggestPeerAdjustedMarks(
                        Number(marks),
                        Number(a.max_marks),
                        syndicatePeers.map((p) => ({ id: p.index_no, _peer: p._peer })),
                      );
                      setCustomSplit(true);
                      setMemberMarks((prev) => {
                        const next = { ...prev };
                        Object.entries(suggested).forEach(([k, val]) => { next[k] = String(val); });
                        return next;
                      });
                      toast('Suggested peer-weighted individual marks applied. Review before saving.');
                    }}
                  >
                    Auto-Weight by Peer Ratings
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="stack-sm" style={{ gap: 6 }}>
            {syndicatePeers.map((m) => (
              <div
                key={m.index_no}
                className="between"
                style={{
                  flexWrap: 'wrap',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 8,
                  background: 'var(--surface)',
                  border: m._peer?.flagged ? '1px solid var(--red-ink)' : '1px solid var(--line-2)',
                }}
              >
                <div className="stack-sm" style={{ gap: 2, flex: 1, minWidth: 200 }}>
                  <div className="row-wrap" style={{ gap: 6 }}>
                    <span className="mono strong small">{blindMode ? (blindMap?.students?.get(normalizeIndexNo(m.index_no))?.label || 'Candidate') : m.index_no}</span>
                    {!blindMode && m.full_name && m.full_name !== m.index_no && <span className="small">{m.full_name}</span>}
                    {m._peer && (
                      <span className={`badge ${m._peer.flagged ? 'badge-red' : 'badge-teal'}`}>
                        Peer: {m._peer.avgScore}/5 ({m._peer.count}){m._peer.flagged ? ' · Low contribution' : ''}
                      </span>
                    )}
                  </div>
                  {m._peer?.notes?.length > 0 && (
                    <div className="stack-sm" style={{ gap: 2, marginTop: 2 }}>
                      {m._peer.notes.map((n, ni) => (
                        <span key={ni} className="tiny muted">
                          From {blindMode ? 'Teammate' : n.fromName} ({n.score}/5){n.note ? `: “${n.note}”` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {customSplit && (
                  <div className="row" style={{ gap: 4 }}>
                    {[
                      { r: 1, l: '100%' },
                      { r: 0.75, l: '75%' },
                      { r: 0.5, l: '50%' },
                      { r: 0, l: '0%' },
                    ].map((btn) => (
                      <button
                        key={btn.l}
                        type="button"
                        className="btn btn-sm"
                        style={{ minHeight: 28, padding: '0 6px', fontSize: 11 }}
                        onClick={() => applyScaleToMember(m.index_no, btn.r)}
                      >
                        {btn.l}
                      </button>
                    ))}
                    <input
                      className="input mono"
                      style={{ width: 68, minHeight: 30, padding: '0 6px', textAlign: 'right', fontSize: 13 }}
                      type="number"
                      min="0"
                      max={a.max_marks}
                      step="0.5"
                      placeholder={marks === '' ? '—' : String(marks)}
                      value={memberMarks[m.index_no] ?? ''}
                      onChange={(e) => setMemberMarks((prev) => ({ ...prev, [m.index_no]: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {effectiveSub.note && <p className="small"><span className="eyebrow">Student&apos;s note: </span>{effectiveSub.note}</p>}

      {labEvidence && (
        <div className="lab-evidence-card">
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div className="tiny mono" style={{ color: 'var(--teal-700)', fontWeight: 700 }}>
                ● INTERACTIVE LAB VERIFICATION EVIDENCE
              </div>
              <strong className="small">{labEvidence.moduleLine}</strong>
            </div>
            {!readOnly && labSuggestion && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setMarks(labSuggestion.suggestedTotal);
                  setFeedback((prev) =>
                    prev && prev.trim()
                      ? (prev.includes('Lab Rubric Assessment') || prev.includes('Lab Evidence Verification')
                          ? labSuggestion.feedbackNote
                          : `${labSuggestion.feedbackNote}\n\n${prev.trim()}`)
                      : labSuggestion.feedbackNote,
                  );
                  toast(`Applied suggested mark (${labSuggestion.suggestedTotal} / ${fmtNumber(a.max_marks)}). Review the Managerial Judgement criterion before saving.`);
                }}
              >
                <Icon name="check" size={14} /> Auto-Suggest Quantitative Marks ({labSuggestion.suggestedTotal} / {fmtNumber(a.max_marks)})
              </button>
            )}
          </div>

          <div className="lab-evidence-grid">
            {labEvidence.metrics.map((m, idx) => (
              <div key={idx} className="lab-evidence-metric">
                <span className="tiny muted">{m.label}</span>
                <strong className="mono small">{m.value}</strong>
              </div>
            ))}
            <div className="lab-evidence-metric">
              <span className="tiny muted">Managerial Judgement</span>
              <strong
                className="mono small"
                style={{ color: labEvidence.judgementPass ? 'var(--teal-700)' : 'var(--amber)' }}
              >
                {labEvidence.judgementPass ? `● PASS (${labEvidence.judgementWords} words)` : `▲ REVIEW (${labEvidence.judgementWords} words)`}
              </strong>
            </div>
          </div>

          {labEvidence.judgementExcerpt && (
            <div className="small" style={{ background: 'var(--surface)', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)' }}>
              <span className="tiny muted" style={{ display: 'block', marginBottom: 2 }}>STUDENT WRITTEN JUDGEMENT EXCERPT:</span>
              {labEvidence.judgementExcerpt}{labEvidence.judgementExcerpt.length >= 420 ? '…' : ''}
            </div>
          )}
          {(() => {
            const variantMatch = String(effectiveSub.response_text || '').match(/Dataset Variant ID:\s*([A-Za-z0-9_-]+)/i);
            const variantTag = tMeta.variantTag || variantMatch?.[1] || null;
            const detectedLabId = tMeta.labId || labEvidence.labId || null;
            const viva = generateLabVivaQuestions({
              labId: detectedLabId,
              labEvidence,
              variantTag,
              studentOrGroupLabel: syndicate?.name || (blindMode ? 'Candidate' : (row.full_name || row.index_no)),
            });
            const copyViva = () => {
              const txt = [
                viva.header,
                `Metrics Context: ${viva.metricsContext}`,
                '',
                ...viva.questions.map((item, idx) => `Q${idx + 1}: ${item.q}\nExpected Cue: ${item.cue}`),
              ].join('\n');
              navigator.clipboard?.writeText(txt).then(
                () => toast('Copied variant-specific Viva questions to clipboard!'),
                () => toast('Could not access clipboard.', 'error'),
              );
            };
            return (
              <details style={{ marginTop: 6, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}>
                <summary className="tiny strong" style={{ cursor: 'pointer', color: '#1d4ed8' }}>
                  Oral Defense / Post-Lab Viva Questions ({viva.questions.length} tailored to {variantTag ? `Variant ${variantTag}` : 'this submission'})
                </summary>
                <div className="stack-xs" style={{ marginTop: 8 }}>
                  <div className="between" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="tiny muted">{viva.header}</span>
                    <button type="button" className="btn btn-sm" onClick={copyViva}>Copy Viva Questions</button>
                  </div>
                  {viva.questions.map((item, idx) => (
                    <div key={idx} className="tiny" style={{ padding: '6px 8px', background: 'var(--surface-2)', borderRadius: 6 }}>
                      <div><strong>Q{idx + 1}.</strong> {item.q}</div>
                      <div className="muted" style={{ marginTop: 2 }}><em>Expected answer cue:</em> {item.cue}</div>
                    </div>
                  ))}
                </div>
              </details>
            );
          })()}
        </div>
      )}

      <RubricGrader
        criteria={assignMeta.rubric}
        maxMarks={Number(a.max_marks)}
        currentFeedback={feedback}
        onApply={(total, mergedFeedback) => {
          if (total !== null) setMarks(total);
          setFeedback(mergedFeedback);
        }}
      />

      <Field label={`Base group mark out of ${fmtNumber(a.max_marks)}`}>
        <input className="input mono" type="number" min="0" max={a.max_marks} step="0.5" style={{ maxWidth: 160 }} value={marks} onChange={(e) => setMarks(e.target.value)} autoFocus />
      </Field>

      <div className="stack-sm">
        <div className="between" style={{ flexWrap: 'wrap', gap: 6 }}>
          <span className="eyebrow">Quick feedback snippets</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setAddingSnip((v) => !v)}
          >
            <Icon name="bookmark" size={13} /> {addingSnip ? 'Cancel' : 'Save current feedback as snippet'}
          </button>
        </div>
        {addingSnip && (
          <div className="row-wrap" style={{ gap: 6, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 160, minHeight: 34 }}
              value={snipLabel}
              onChange={(e) => setSnipLabel(e.target.value)}
              placeholder="Short chip label (e.g. Missing lead time)"
            />
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!snipLabel.trim() || !feedback.trim()}
              onClick={async () => {
                await onAddSnippet?.(snipLabel, feedback);
                setSnipLabel('');
                setAddingSnip(false);
              }}
            >
              Save chip
            </button>
          </div>
        )}
        <div className="row-wrap" style={{ gap: 6 }}>
          {snippets.map((sn) => (
            <span key={sn.id || sn.label} className="row" style={{ gap: 2 }}>
              <button
                type="button"
                className="chip"
                title={sn.body}
                onClick={() => setFeedback((cur) => (cur.trim() ? `${cur.trimEnd()}\n• ${sn.body}` : sn.body))}
              >
                + {sn.label}
              </button>
              {!sn.builtin && onDeleteSnippet && (
                <button
                  type="button"
                  className="btn-ghost tiny"
                  style={{ minHeight: 24, padding: '0 4px' }}
                  aria-label={`Delete snippet ${sn.label}`}
                  onClick={() => onDeleteSnippet(sn)}
                >×</button>
              )}
            </span>
          ))}
        </div>
      </div>
      <Field label="Feedback to the student" hint="shown when you release marks">
        <textarea className="textarea" rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </Field>
      {effectiveSub?.id && !isInClass && (() => {
        const existingEx = exemplars.find((ex) => ex.submission_id === effectiveSub.id);
        return (
          <div className="stack-sm" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            {existingEx ? (
              <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="row" style={{ gap: 6 }}>
                  <Icon name="award" size={15} style={{ color: 'var(--teal)' }} />
                  <span className="small">Promoted as anonymized exemplar: <strong>{existingEx.title}</strong></span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={exBusy}
                  onClick={async () => {
                    setExBusy(true);
                    try {
                      await rpc('remove_assignment_exemplar', { p_exemplar: existingEx.id });
                      toast('Exemplar removed.');
                      onExemplarChanged?.();
                    } catch (e) {
                      toast(e.message, 'error');
                    } finally {
                      setExBusy(false);
                    }
                  }}
                >
                  Remove exemplar
                </button>
              </div>
            ) : (
              <>
                <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <span className="small muted">Share this submission (stripped of student name &amp; index) as a study benchmark?</span>
                  <button type="button" className="btn btn-sm" onClick={() => setExOpen((v) => !v)}>
                    <Icon name="award" size={14} /> {exOpen ? 'Hide' : 'Promote as Anonymized Exemplar'}
                  </button>
                </div>
                {exOpen && (
                  <div className="stack-sm" style={{ paddingTop: 6, borderTop: '1px solid var(--line-2)' }}>
                    <Field label="Exemplar label">
                      <input className="input" value={exTitle} onChange={(e) => setExTitle(e.target.value)} placeholder="e.g. Model A-Grade Case Study" />
                    </Field>
                    <Field label="Why this is a model answer" hint="optional note shown to students">
                      <input className="input" value={exNote} onChange={(e) => setExNote(e.target.value)} placeholder="e.g. Clear EOQ sensitivity table & practical Incoterms choice." />
                    </Field>
                    <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <span className="tiny muted">Student identity is completely stripped and only visible after marks are released.</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={exBusy || !exTitle.trim()}
                        onClick={async () => {
                          setExBusy(true);
                          try {
                            await rpc('promote_assignment_exemplar', {
                              p_submission: effectiveSub.id,
                              p_title: exTitle.trim(),
                              p_note: exNote.trim(),
                            });
                            toast('Published as anonymized model exemplar.');
                            setExOpen(false);
                            onExemplarChanged?.();
                          } catch (e) {
                            toast(e.message || 'Could not publish exemplar (ensure Section 17 SQL is applied).', 'error');
                          } finally {
                            setExBusy(false);
                          }
                        }}
                      >
                        {exBusy ? 'Publishing…' : 'Publish Anonymized Exemplar'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}
    </Modal>
  );
}


function PresentationModal({ a, assignMeta, allRows, bookingEvents = [], onClose, onSaved }) {
  const toast = useToast();
  const [bookedFirst, setBookedFirst] = useState(true);
  const slotBySyndicateId = useMemo(() => {
    const map = new Map();
    const rawGroups = assignMeta.syndicate.groups || [];
    const sortedEvs = [...bookingEvents].sort((e1, e2) => {
      const s1 = e1.assignment_id === a.id ? 0 : e1.kind === 'presentation' ? 1 : 2;
      const s2 = e2.assignment_id === a.id ? 0 : e2.kind === 'presentation' ? 1 : 2;
      return s1 - s2;
    });
    for (const ev of sortedEvs) {
      for (const sl of (ev.slots || [])) {
        if (!sl.booked) continue;
        for (const g of rawGroups) {
          if (map.has(g.id)) continue;
          const synMatch = sl.syndicate_name && sl.syndicate_name.trim().toLowerCase() === g.name.trim().toLowerCase();
          const memMatch = sl.booked_index_no && g.members.includes(normalizeIndexNo(sl.booked_index_no));
          if (synMatch || memMatch) {
            map.set(g.id, { ...sl, eventTitle: ev.title, room: sl.room || ev.location });
          }
        }
      }
    }
    return map;
  }, [bookingEvents, assignMeta.syndicate.groups, a.id]);
  const groups = useMemo(() => {
    const raw = assignMeta.syndicate.groups || [];
    if (!bookedFirst || slotBySyndicateId.size === 0) return raw;
    return [...raw].sort((g1, g2) => {
      const s1 = slotBySyndicateId.get(g1.id);
      const s2 = slotBySyndicateId.get(g2.id);
      if (s1 && !s2) return -1;
      if (!s1 && s2) return 1;
      if (s1 && s2) return new Date(s1.starts_at).getTime() - new Date(s2.starts_at).getTime();
      return 0;
    });
  }, [assignMeta.syndicate.groups, bookedFirst, slotBySyndicateId]);
  const byNorm = useMemo(() => new Map(allRows.map((r) => [normalizeIndexNo(r.index_no), r])), [allRows]);

  const initialIdx = useMemo(() => {
    const unmarked = groups.findIndex((g) => g.members.some((m) => {
      const st = byNorm.get(m);
      return st?.sub?.marks === null || st?.sub?.marks === undefined;
    }));
    return unmarked > -1 ? unmarked : 0;
  }, [groups, byNorm]);

  const [groupIdx, setGroupIdx] = useState(initialIdx);
  const syndicate = groups[groupIdx] || groups[0];

  const peers = useMemo(() => {
    if (!syndicate) return [];
    return syndicate.members.map((idx) => byNorm.get(idx) || { index_no: idx, full_name: idx, activated: false });
  }, [syndicate, byNorm]);

  const [marks, setMarks] = useState(() => {
    const existing = peers.find((p) => p.sub?.marks !== null && p.sub?.marks !== undefined)?.sub?.marks;
    return existing ?? '';
  });
  const [feedback, setFeedback] = useState(() => peers.find((p) => p.sub?.feedback)?.sub?.feedback || '');
  const [customSplit, setCustomSplit] = useState(false);
  const [memberMarks, setMemberMarks] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const existing = peers.find((p) => p.sub?.marks !== null && p.sub?.marks !== undefined)?.sub?.marks;
    const fb = peers.find((p) => p.sub?.feedback)?.sub?.feedback || '';
    setMarks(existing ?? '');
    setFeedback(fb);
    const nextMap = {};
    peers.forEach((p) => {
      nextMap[p.index_no] = p.sub?.marks ?? existing ?? '';
    });
    setMemberMarks(nextMap);
    setCustomSplit(false);
  }, [groupIdx, peers]);

  const hasNext = groupIdx < groups.length - 1;

  async function save(advance) {
    if (!syndicate) return;
    const m = Number(marks);
    if (marks === '' || Number.isNaN(m) || m < 0 || m > Number(a.max_marks)) {
      toast(`Enter a mark between 0 and ${fmtNumber(a.max_marks)}.`, 'error');
      return;
    }
    if (customSplit) {
      for (const p of peers) {
        const raw = memberMarks[p.index_no];
        const pm = raw === undefined || raw === '' ? m : Number(raw);
        if (Number.isNaN(pm) || pm < 0 || pm > Number(a.max_marks)) {
          toast(`Invalid mark for ${p.index_no} (0 to ${fmtNumber(a.max_marks)}).`, 'error');
          return;
        }
      }
    }
    setBusy(true);
    try {
      const profiles = await run(
        supabase.from('profiles').select('id, index_no').in('index_no', syndicate.members)
      );
      const profileByIdx = new Map((profiles || []).map((pr) => [normalizeIndexNo(pr.index_no), pr.id]));
      const nowIso = new Date().toISOString();
      const upsertRows = [];
      const unactivated = [];

      for (const p of peers) {
        const studentId = profileByIdx.get(normalizeIndexNo(p.index_no));
        if (!studentId) {
          unactivated.push(p.index_no);
          continue;
        }
        const raw = customSplit ? memberMarks[p.index_no] : undefined;
        const memberScore = raw !== undefined && raw !== '' ? Number(raw) : m;
        upsertRows.push({
          assignment_id: a.id,
          student_id: studentId,
          file_path: p.sub?.file_path || 'presentation:in-class',
          file_name: p.sub?.file_name || 'In-class presentation',
          note: p.sub?.note || 'Graded live in class',
          is_late: p.sub?.is_late || false,
          marks: memberScore,
          feedback,
          marked_at: nowIso,
        });
      }

      if (upsertRows.length === 0) {
        toast(`None of the students in ${syndicate.name} have activated their portal accounts yet.`, 'error');
        return;
      }

      await run(supabase.from('submissions').upsert(upsertRows, { onConflict: 'assignment_id,student_id' }));
      if (unactivated.length > 0) {
        toast(`Saved ${syndicate.name} (${upsertRows.length} marked). ${unactivated.length} not activated yet: ${unactivated.join(', ')}`);
      } else {
        toast(`Saved live presentation · ${syndicate.name} (${upsertRows.length} members)`);
      }
      onSaved?.();
      if (advance && hasNext) setGroupIdx((i) => i + 1);
      else onClose();
    } catch (e) {
      toast(e.message || 'Could not save presentation marks.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const saveRef = useRef(null);
  saveRef.current = () => { if (!busy) save(hasNext); };
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        saveRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!syndicate) return null;

  return (
    <Modal
      title="Grade live syndicate presentation"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="tiny muted hide-sm" style={{ marginRight: 'auto' }}>Tip: Ctrl/Cmd + ↵ to save{hasNext ? ' & next group' : ''}</span>
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={() => save(hasNext)} disabled={busy}>
            {busy ? 'Saving…' : hasNext ? 'Save & next group →' : 'Save presentation marks'}
          </button>
        </>
      }
    >
      <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Field label="Select syndicate group" style={{ flex: 1, minWidth: 240 }}>
          <select className="select" value={groupIdx} onChange={(e) => setGroupIdx(Number(e.target.value))}>
            {groups.map((g, idx) => {
              const markedMembers = g.members.filter((m) => {
                const st = byNorm.get(m);
                return st?.sub?.marks !== null && st?.sub?.marks !== undefined;
              }).length;
              return (
                <option key={g.id || idx} value={idx}>
                  {g.name}{slotBySyndicateId.get(g.id) ? ` · ${fmtDateTime(slotBySyndicateId.get(g.id).starts_at)}` : ''} ({markedMembers}/{g.members.length} marked)
                </option>
              );
            })}
          </select>
        </Field>
        <div className="row-wrap" style={{ gap: 6, alignSelf: 'flex-end' }}>
          {slotBySyndicateId.size > 0 && (
            <button
              type="button"
              className={`btn btn-sm ${bookedFirst ? 'btn-primary' : ''}`}
              onClick={() => { setBookedFirst((v) => !v); setGroupIdx(0); }}
            >
              <Icon name="clock" size={13} /> {bookedFirst ? 'Ordered by slot' : 'Group order'}
            </button>
          )}
          <button type="button" className="btn btn-sm" disabled={groupIdx === 0} onClick={() => setGroupIdx((i) => Math.max(0, i - 1))}>← Prev</button>
          <button type="button" className="btn btn-sm" disabled={!hasNext} onClick={() => setGroupIdx((i) => Math.min(groups.length - 1, i + 1))}>Next →</button>
        </div>
      </div>

      <div className="stack-sm" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--teal-50)', border: '1px solid var(--teal)' }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="row-wrap" style={{ gap: 8 }}>
            <strong className="small" style={{ color: 'var(--teal-dark)' }}>{syndicate.name} · {peers.length} members</strong>
            {slotBySyndicateId.get(syndicate.id) && (
              <span className="badge badge-blue">
                <Icon name="clock" size={12} /> Booked: {fmtDateTime(slotBySyndicateId.get(syndicate.id).starts_at)}
                {slotBySyndicateId.get(syndicate.id).room ? ` · ${slotBySyndicateId.get(syndicate.id).room}` : ''}
              </span>
            )}
          </div>
          <label className="check" style={{ gap: 6 }}>
            <input type="checkbox" checked={customSplit} onChange={(e) => setCustomSplit(e.target.checked)} />
            <span className="tiny strong">Adjust individual member marks</span>
          </label>
        </div>
        <div className="stack-sm" style={{ gap: 6 }}>
          {peers.map((p) => (
            <div key={p.index_no} className="between" style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--line-2)', gap: 8 }}>
              <span className="small">
                <strong>{p.full_name}</strong> <span className="mono tiny muted">{p.index_no}</span>
                {p.activated === false && <span className="badge badge-amber" style={{ marginLeft: 6 }}>Not activated</span>}
              </span>
              {customSplit ? (
                <input
                  className="input mono"
                  type="number"
                  min="0"
                  max={a.max_marks}
                  step="0.5"
                  style={{ width: 92, minHeight: 32 }}
                  value={memberMarks[p.index_no] ?? marks}
                  onChange={(e) => setMemberMarks((mMap) => ({ ...mMap, [p.index_no]: e.target.value }))}
                />
              ) : (
                <span className="tiny muted mono">
                  {p.sub?.marks !== null && p.sub?.marks !== undefined ? `Current: ${fmtNumber(p.sub.marks)}` : 'Unmarked'}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <RubricGrader
        criteria={assignMeta.rubric}
        maxMarks={Number(a.max_marks)}
        currentFeedback={feedback}
        onApply={(total, mergedFeedback) => {
          if (total !== null) setMarks(total);
          setFeedback(mergedFeedback);
        }}
      />

      <Field label={`Group presentation mark out of ${fmtNumber(a.max_marks)}`}>
        <input className="input mono" type="number" min="0" max={a.max_marks} step="0.5" style={{ maxWidth: 160 }} value={marks} onChange={(e) => setMarks(e.target.value)} autoFocus />
      </Field>
      <Field label="Feedback for group" hint="shown when marks are released">
        <textarea className="textarea" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Strong analytical structure and clear delivery…" />
      </Field>
    </Modal>
  );
}


function ExtensionModal({ a, assignMeta, row, onClose, onSaved }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const existingOverride = assignMeta.deadlines?.byStudent?.[normalizeIndexNo(row.index_no)] || '';
  const defaultBase = existingOverride || row._dueInfo?.dueAt || a.due_at || new Date(Date.now() + 2 * 86400000).toISOString();
  const [dueLocal, setDueLocal] = useState(() => toLocalInput(defaultBase));

  function bumpHours(hours) {
    const baseMs = dueLocal ? new Date(dueLocal).getTime() : Date.now();
    const validMs = Number.isNaN(baseMs) ? Date.now() : Math.max(baseMs, Date.now());
    setDueLocal(toLocalInput(new Date(validMs + hours * 3600000).toISOString()));
  }

  async function saveExtension(clear = false) {
    const nextIso = clear ? null : fromLocalInput(dueLocal);
    if (!clear && !nextIso) {
      toast('Choose a valid extension date and time.', 'error');
      return;
    }
    setBusy(true);
    try {
      const nextByStudent = { ...(assignMeta.deadlines?.byStudent || {}) };
      const key = normalizeIndexNo(row.index_no);
      if (clear) delete nextByStudent[key];
      else nextByStudent[key] = nextIso;

      const encoded = serializeAssignmentMeta(assignMeta.cleanInstructions, {
        ...assignMeta,
        deadlines: {
          byClass: assignMeta.deadlines?.byClass || {},
          byStudent: nextByStudent,
        },
      });
      await run(supabase.from('assignments').update({ instructions: encoded }).eq('id', a.id));
      toast(clear ? `Cleared custom extension for ${row.full_name}.` : `Extension saved for ${row.full_name}.`);
      onClose();
      onSaved();
    } catch (e) {
      toast(e.message || 'Could not update deadline extension.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Deadline extension · ${row.full_name}`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          {existingOverride && (
            <button type="button" className="btn" style={{ marginRight: 'auto', color: 'var(--red-ink)' }} onClick={() => saveExtension(true)} disabled={busy}>
              Remove extension
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => saveExtension(false)} disabled={busy || !dueLocal}>
            {busy ? 'Saving…' : 'Save extension'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="notice notice-info small">
          <strong>{row.full_name}</strong> (<span className="mono">{row.index_no}</span>)
          {[row.programme, row.stream].filter(Boolean).length ? ` · ${[row.programme, row.stream].filter(Boolean).join(' · ')}` : ''}
          <div className="tiny muted" style={{ marginTop: 2 }}>
            {a.due_at ? `Course deadline: ${fmtDateTime(a.due_at)}` : 'No course-wide deadline set'}
          </div>
        </div>

        <Field label="Extended deadline for this student">
          <input className="input" type="datetime-local" value={dueLocal} onChange={(e) => setDueLocal(e.target.value)} />
        </Field>

        <div className="row-wrap" style={{ gap: 6 }}>
          <span className="tiny muted">Quick add:</span>
          <button type="button" className="btn btn-sm" onClick={() => bumpHours(24)}>+24 hours</button>
          <button type="button" className="btn btn-sm" onClick={() => bumpHours(48)}>+48 hours</button>
          <button type="button" className="btn btn-sm" onClick={() => bumpHours(7 * 24)}>+7 days</button>
        </div>
      </div>
    </Modal>
  );
}

function SimilarityModal({ a, assignMeta, rows, blindMode, blindMap, onClose }) {
  const [threshold, setThreshold] = useState(45);
  const [phase, setPhase] = useState('scanning');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [extracted, setExtracted] = useState(null);
  const [scanError, setScanError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [includeArchive, setIncludeArchive] = useState(true);
  const [archiveRows, setArchiveRows] = useState([]);
  const [archiveSupported, setArchiveSupported] = useState(true);

  useEffect(() => {
    let alive = true;
    setPhase('scanning');
    setScanError('');
    extractAssignmentTexts(rows, getSignedFileUrl, (p) => {
      if (alive) setProgress(p);
    })
      .then(async (res) => {
        if (!alive) return;
        setExtracted(res);
        setPhase('done');
        if (res?.docs?.length) {
          const archivePayload = res.docs.map((d) => ({
            index_no: d.indexNo || d.id,
            student_name: d.fullName || '',
            title: a.title || '',
            text: (d.text || '').slice(0, 12000),
            word_count: d.wordCount || 0,
          }));
          rpc('save_submission_archive_texts', { p_assignment: a.id, p_rows: archivePayload }).catch(() => {});
        }
        try {
          const past = await rpc('past_similarity_texts', { p_course: a.course_id, p_assignment: a.id });
          if (alive) {
            setArchiveRows(Array.isArray(past) ? past : []);
            setArchiveSupported(true);
          }
        } catch {
          if (alive) setArchiveSupported(false);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setScanError(e.message || 'Could not scan submissions.');
        setPhase('error');
      });
    return () => { alive = false; };
  }, [a.id, a.course_id, a.title]);

  const report = useMemo(() => {
    if (!extracted?.docs) return null;
    return compareSubmissionTexts(extracted.docs, {
      boilerplateText: assignMeta.cleanInstructions,
      thresholdPct: threshold,
    });
  }, [extracted, assignMeta.cleanInstructions, threshold]);

  const archiveReport = useMemo(() => {
    if (!includeArchive || !extracted?.docs || !archiveRows.length) return { checkedArchiveCount: 0, matches: [] };
    return compareArchiveTexts(extracted.docs, archiveRows, {
      boilerplateText: assignMeta.cleanInstructions,
      thresholdPct: threshold,
    });
  }, [includeArchive, extracted, archiveRows, assignMeta.cleanInstructions, threshold]);

  function displayParticipant(p) {
    if (blindMode) {
      return p.syndicateName
        ? 'Syndicate group'
        : (blindMap?.students?.get(normalizeIndexNo(p.indexNo))?.label || 'Candidate');
    }
    return p.syndicateName ? p.syndicateName : `${p.fullName} (${p.indexNo})`;
  }

  return (
    <Modal
      title="Submission Similarity & Collusion Check"
      onClose={onClose}
      wide
      footer={<button type="button" className="btn" onClick={onClose}>Close</button>}
    >
      <div className="stack">
        {phase === 'scanning' && (
          <div className="stack-sm" style={{ padding: '18px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
            <div className="between">
              <strong className="small">Extracting text from typed responses, PDFs, and Word docs…</strong>
              <span className="mono small">{progress.done} / {progress.total}</span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 10}%`,
                  background: 'var(--teal)',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>
              Runs privately inside your browser — prompt instructions and same-syndicate teammates are automatically excluded.
            </p>
          </div>
        )}

        {phase === 'error' && <div className="notice notice-warn small">{scanError}</div>}

        {phase === 'done' && report && (
          <>
            <div className="between" style={{ flexWrap: 'wrap', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <div className="row-wrap" style={{ gap: 10 }}>
                <span className="badge badge-teal">{report.checkedCount} compared</span>
                <span className={`badge ${report.pairs.length > 0 ? 'badge-red' : ''}`}>
                  {report.pairs.length} pair{report.pairs.length === 1 ? '' : 's'} ≥ {threshold}%
                </span>
                {archiveSupported && archiveRows.length > 0 && (
                  <label className="check small" style={{ margin: 0 }}>
                    <input type="checkbox" checked={includeArchive} onChange={(e) => setIncludeArchive(e.target.checked)} />
                    <span>Past semesters ({archiveRows.length})</span>
                  </label>
                )}
                {extracted.skipped.length > 0 && (
                  <span className="badge badge-amber">{extracted.skipped.length} unsupported/unreadable file{extracted.skipped.length === 1 ? '' : 's'}</span>
                )}
              </div>
              <label className="row small" style={{ gap: 8 }}>
                <span className="tiny muted">Flag threshold:</span>
                <input
                  type="range"
                  min={25}
                  max={85}
                  step={5}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                />
                <span className="mono strong">{threshold}%</span>
              </label>
            </div>

            {report.pairs.length === 0 ? (
              <div className="card">
                <Empty icon="check" title={`No pairs above ${threshold}% similarity`}>
                  No non-syndicate submissions exceeded the {threshold}% overlap threshold after stripping assignment prompt boilerplate.
                </Empty>
              </div>
            ) : (
              <div className="stack-sm" style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
                {report.pairs.map((pair) => {
                  const isOpen = expandedId === pair.id;
                  const sevClass = pair.scorePct >= 75 ? 'badge-red' : 'badge-amber';
                  return (
                    <div key={pair.id} className="card stack-sm" style={{ borderColor: pair.scorePct >= 75 ? 'var(--red-ink)' : 'var(--line)' }}>
                      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <div className="stack-sm" style={{ gap: 2 }}>
                          <div className="row-wrap" style={{ gap: 6, alignItems: 'center' }}>
                            <span className={`badge ${sevClass} mono`}>{pair.scorePct}% overlap</span>
                            <strong className="small">{displayParticipant(pair.a)}</strong>
                            <span className="tiny muted">↔</span>
                            <strong className="small">{displayParticipant(pair.b)}</strong>
                          </div>
                          <span className="tiny muted">
                            Containment: {pair.containmentPct}% · Jaccard: {pair.jaccardPct}% · {pair.sharedCount} shared phrases
                          </span>
                        </div>
                        <button type="button" className="btn btn-sm" onClick={() => setExpandedId(isOpen ? null : pair.id)}>
                          {isOpen ? 'Hide match' : 'Compare passages'}
                        </button>
                      </div>

                      {isOpen && (
                        <div className="stack-sm" style={{ paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
                          {pair.snippets.length > 0 && (
                            <div className="stack-sm" style={{ gap: 4 }}>
                              <span className="tiny strong muted">Longest matched sequences:</span>
                              {pair.snippets.map((snip, idx) => (
                                <div key={idx} className="tiny" style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--amber-50)', color: 'var(--amber-ink)', border: '1px solid var(--amber)' }}>
                                  “{snip}”
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="two-col" style={{ gap: 10 }}>
                            <div className="stack-sm">
                              <span className="tiny strong">{displayParticipant(pair.a)} ({pair.a.wordCount} words)</span>
                              <div className="pre tiny" style={{ maxHeight: 160, overflowY: 'auto', padding: 8, borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--line-2)' }}>
                                {pair.a.text.slice(0, 1500)}{pair.a.text.length > 1500 ? '…' : ''}
                              </div>
                            </div>
                            <div className="stack-sm">
                              <span className="tiny strong">{displayParticipant(pair.b)} ({pair.b.wordCount} words)</span>
                              <div className="pre tiny" style={{ maxHeight: 160, overflowY: 'auto', padding: 8, borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--line-2)' }}>
                                {pair.b.text.slice(0, 1500)}{pair.b.text.length > 1500 ? '…' : ''}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {includeArchive && archiveReport.matches.length > 0 && (
              <div className="stack-sm" style={{ marginTop: 8 }}>
                <div className="between">
                  <strong className="small">Cross-Semester Archive Matches ({archiveReport.matches.length})</strong>
                  <span className="tiny muted">Checked against {archiveReport.checkedArchiveCount} prior submission{archiveReport.checkedArchiveCount === 1 ? '' : 's'}</span>
                </div>
                {archiveReport.matches.slice(0, 30).map((m) => {
                  const isOpen = expandedId === m.id;
                  return (
                    <div key={m.id} className="card stack-sm" style={{ borderColor: m.scorePct >= 75 ? 'var(--red-ink)' : 'var(--amber)' }}>
                      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <div className="stack-sm" style={{ gap: 2 }}>
                          <div className="row-wrap" style={{ gap: 6, alignItems: 'center' }}>
                            <span className={`badge ${m.scorePct >= 75 ? 'badge-red' : 'badge-amber'} mono`}>{m.scorePct}% past match</span>
                            <strong className="small">{displayParticipant(m.current)}</strong>
                            <span className="tiny muted">↔</span>
                            <strong className="small">{blindMode ? 'Prior cohort script' : `${m.archive.fullName || m.archive.indexNo} (${m.archive.indexNo})`}</strong>
                          </div>
                          <span className="tiny muted">
                            Prior archive: {m.archive.courseCode} {m.archive.semester ? `(${m.archive.semester}) ` : ''}· {m.archive.title} · {m.sharedCount} shared phrases
                          </span>
                        </div>
                        <button type="button" className="btn btn-sm" onClick={() => setExpandedId(isOpen ? null : m.id)}>
                          {isOpen ? 'Hide match' : 'Compare passages'}
                        </button>
                      </div>
                      {isOpen && m.snippets?.length > 0 && (
                        <div className="stack-sm" style={{ paddingTop: 8, borderTop: '1px solid var(--line-2)', gap: 4 }}>
                          {m.snippets.map((snip, idx) => (
                            <div key={idx} className="tiny" style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--amber-50)', color: 'var(--amber-ink)', border: '1px solid var(--amber)' }}>
                              “{snip}”
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {extracted.skipped.length > 0 && (
              <details className="tiny muted">
                <summary style={{ cursor: 'pointer' }}>{extracted.skipped.length} submission file(s) skipped (.doc, images, spreadsheets, or empty)</summary>
                <div style={{ marginTop: 4 }}>
                  {extracted.skipped.map((sk, idx) => (
                    <div key={idx}>{blindMode ? 'Submission' : sk.name} — {sk.fileName}: {sk.reason}</div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
