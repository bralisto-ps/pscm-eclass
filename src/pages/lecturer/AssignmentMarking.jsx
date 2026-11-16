import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rpc, rpcAll, run, supabase } from '../../lib/supabase.js';
import { useAuth } from '../../lib/auth.jsx';
import { isViewOnlyPath, openStoredFile, setViewOnlyFlag } from '../../lib/files.js';
import { fmtFull, fmtNumber, pct, relative } from '../../lib/format.js';
import { downloadWorkbook } from '../../lib/sheets.js';
import { assignmentMatchesStudent, findStudentSyndicate, formatAssignmentAudience, hasAudienceFilter, normalizeIndexNo, parseAssignmentMeta } from '../../lib/assignmentMeta.js';
import { ALL_NEW_FEATURES_SQL } from '../../lib/allFeaturesSql.js';
import { ALL_GROUPS, GroupFilters, GroupSummaryTable, groupLabel, groupSummary, matchesGroup } from '../../components/Groups.jsx';
import { SortSelect, SortTh } from '../../components/SortBar.jsx';
import { byNameIndex, compareDate, compareNumber, compareText } from '../../lib/sort.js';
import Icon from '../../components/Icon.jsx';
import { Topbar } from '../../components/Layout.jsx';
import RubricGrader from '../../components/RubricGrader.jsx';
import { Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../components/ui.jsx';
import { AssignmentForm } from './course/AssignmentsTab.jsx';

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

export default function AssignmentMarking() {
  const { assignmentId } = useParams();
  const { isTA, profile } = useAuth();
  const { data, error, loading, reload, setData } = useLoad(async () => {
    const a = await run(supabase.from('assignments').select('*, courses(id, code, title)').eq('id', assignmentId).single());
    const [students, subs, peerData] = await Promise.all([
      rpcAll('course_students', { p_course: a.course_id }),
      allSubmissions(assignmentId),
      rpc('assignment_peer_reviews', { p_assignment: assignmentId }).catch(() => ({ reviews: [], _missing: true })),
    ]);
    const byIndex = new Map(subs.map((s) => [s.profiles?.index_no, s]));
    const rows = students.map((st) => ({ ...st, sub: byIndex.get(st.index_no) || null }));
    subs.filter((s) => !students.some((st) => st.index_no === s.profiles?.index_no))
      .forEach((s) => rows.push({ index_no: s.profiles?.index_no, full_name: s.profiles?.full_name, activated: true, sub: s }));
    return { a, rows, peerReviews: peerData?.reviews || [], peerMissingRpc: Boolean(peerData?._missing) };
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
  }, [data?.peerReviews]);

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
      return { ...r, _syn: syn, _synLeaderSub: synLeaderSub, _peer: peer };
    });
  }, [data, assignMeta, peerStatsByIndex]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = enrichedRows.filter((r) => {
      if (!matchesGroup(r, group)) return false;
      const effectiveSub = r.sub || r._synLeaderSub;
      if (filter === 'tomark' && !(effectiveSub && (r.sub ? r.sub.marks === null : true))) return false;
      if (filter === 'marked' && !(r.sub && r.sub.marks !== null)) return false;
      if (filter === 'missing' && effectiveSub) return false;
      if (filter === 'late' && !effectiveSub?.is_late) return false;
      if (term) {
        const hay = [r.full_name, r.index_no, r.programme, r.stream, r._syn?.name].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'syn_asc': return compareText(a._syn?.name || 'zzz', b._syn?.name || 'zzz', 'asc') || byNameIndex(a, b);
        case 'marks_desc': return compareNumber(a.sub?.marks, b.sub?.marks, 'desc') || byNameIndex(a, b);
        case 'marks_asc': return compareNumber(a.sub?.marks, b.sub?.marks, 'asc') || byNameIndex(a, b);
        case 'sub_desc': return compareDate((a.sub || a._synLeaderSub)?.submitted_at, (b.sub || b._synLeaderSub)?.submitted_at, 'desc') || byNameIndex(a, b);
        case 'sub_asc': return compareDate((a.sub || a._synLeaderSub)?.submitted_at, (b.sub || b._synLeaderSub)?.submitted_at, 'asc') || byNameIndex(a, b);
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
  }, [enrichedRows, filter, q, group, sort]);

  if (loading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} onRetry={reload} /></div>;

  const { a } = data;
  const rows = enrichedRows.filter((r) => matchesGroup(r, group));
  const summary = groupSummary(enrichedRows, (r) => !!r.sub && r.sub.marks !== null, (r) => pct(r.sub.marks, a.max_marks));
  const submitted = rows.filter((r) => r.sub || r._synLeaderSub);
  const marked = rows.filter((r) => r.sub && r.sub.marks !== null);
  const late = submitted.filter((r) => (r.sub || r._synLeaderSub)?.is_late);
  const showPeerCol = assignMeta.syndicate.enabled && assignMeta.syndicate.peerCheck !== false;
  const flaggedPeerCount = showPeerCol ? rows.filter((r) => r._peer?.flagged).length : 0;
  const avg = marked.length ? Math.round(marked.reduce((s, r) => s + pct(r.sub.marks, a.max_marks), 0) / marked.length) : null;

  async function toggleRelease() {
    const next = !a.results_released;
    const ok = await act(() => run(supabase.from('assignments').update({ results_released: next }).eq('id', a.id)),
      next ? 'Marks released to students.' : 'Marks hidden from students.');
    if (ok !== undefined) setData((d) => ({ ...d, a: { ...d.a, results_released: next } }));
  }

  function exportXlsx() {
    const header = ['Index number', 'Name', 'Programme', 'Stream', ...(assignMeta.syndicate.enabled ? ['Syndicate Group'] : []), 'Submitted', 'Late', 'File', 'Marks', 'Out of', 'Percent', 'Feedback'];
    const line = (r) => [
      r.index_no, r.full_name, r.programme || '', r.stream || '',
      ...(assignMeta.syndicate.enabled ? [r._syn?.name || ''] : []),
      r.sub ? fmtFull(r.sub.submitted_at) : 'Not submitted', r.sub?.is_late ? 'Yes' : '',
      r.sub?.file_name || '', r.sub?.marks !== null && r.sub?.marks !== undefined ? Number(r.sub.marks) : '', Number(a.max_marks),
      r.sub?.marks !== null && r.sub?.marks !== undefined ? pct(r.sub.marks, a.max_marks) : '', r.sub?.feedback || '',
    ];
    const widths = [16, 30, 18, 12, ...(assignMeta.syndicate.enabled ? [16] : []), 22, 8, 30, 10, 10, 10, 50];
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

  function copySql() {
    navigator.clipboard?.writeText?.(ALL_NEW_FEATURES_SQL);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 3000);
  }

  return (
    <>
      <Topbar title={a.title} sub={`${a.courses.code} · ${a.due_at ? `due ${fmtFull(a.due_at)}` : 'no deadline'} · ${fmtNumber(a.max_marks)} marks`}>
        <Link to={`/teach/course/${a.course_id}?tab=assignments`} className="btn"><Icon name="chevronLeft" /> Assignments</Link>
        {!isTA && <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> Edit</button>}
        {!isTA && (
          <button type="button" className={`btn ${a.results_released ? '' : 'btn-primary'}`} onClick={toggleRelease} disabled={busy}>
            {a.results_released ? 'Hide marks' : 'Release marks'}
          </button>
        )}
      </Topbar>

      <div className="page stack">
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

        {(assignMeta.rubric.length > 0 || assignMeta.syndicate.enabled || hasAudienceFilter(assignMeta) || assignMeta.doc?.path) && (
          <div className="notice notice-info row-wrap" style={{ justifyContent: 'space-between', gap: 10 }}>
            <div className="row-wrap" style={{ gap: 8 }}>
              {hasAudienceFilter(assignMeta) && (
                <span className="badge badge-plum"><Icon name="users" size={13} /> Target: {formatAssignmentAudience(assignMeta)}</span>
              )}
              {assignMeta.syndicate.enabled && (
                <span className="badge badge-teal"><Icon name="users" size={13} /> Syndicate Mode ({assignMeta.syndicate.groups.length} groups)</span>
              )}
              {flaggedPeerCount > 0 && (
                <span className="badge badge-red"><Icon name="alert" size={13} /> {flaggedPeerCount} Low Peer Rating{flaggedPeerCount === 1 ? '' : 's'}</span>
              )}
              {assignMeta.rubric.length > 0 && (
                <span className="badge badge-blue"><Icon name="clipboard" size={13} /> Clickable Rubric ({assignMeta.rubric.length} criteria)</span>
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
              {!isTA && assignMeta.syndicate.enabled && assignMeta.syndicate.groups.length > 0 && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setGradingPres(true)}>
                  <Icon name="award" size={14} /> Grade live presentation
                </button>
              )}
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
                <input className="input" style={{ width: 230, minHeight: 40 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, index, syndicate, stream" />
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
            <button type="button" className="btn btn-sm" onClick={exportXlsx}><Icon name="download" size={16} /> Export to Excel</button>
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
                    return (
                      <tr key={r.index_no}>
                        <td className="mono small">{r.index_no}</td>
                        <td>{r.full_name}</td>
                        {assignMeta.syndicate.enabled && (
                          <td>
                            {r._syn ? <span className="badge badge-blue">{r._syn.name}</span> : <span className="tiny muted">—</span>}
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
                        <td className="small muted hide-sm">{[r.programme, r.stream].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="small">
                          {effectiveSub ? (
                            <>
                              {relative(effectiveSub.submitted_at)} {effectiveSub.is_late && <span className="badge badge-amber">Late</span>}
                              {!r.sub && r._synLeaderSub && <span className="badge" style={{ marginLeft: 4 }}>Group file</span>}
                              <div className="tiny muted" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{effectiveSub.file_name}</div>
                            </>
                          ) : <span className="muted">Not submitted</span>}
                        </td>
                        <td className="num">{r.sub?.marks !== null && r.sub?.marks !== undefined ? `${fmtNumber(r.sub.marks)} / ${fmtNumber(a.max_marks)}` : '—'}</td>
                        <td>
                          {effectiveSub && (
                            <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                              {effectiveSub.file_path && effectiveSub.file_path !== 'presentation:in-class' ? (
                                <button type="button" className="icon-btn plain" aria-label="Open file" onClick={() => act(() => openStoredFile('submissions', effectiveSub.file_path))}><Icon name="eye" /></button>
                              ) : (
                                <span className="badge badge-teal" title="Graded live in class">In-class</span>
                              )}
                              <button type="button" className="btn btn-sm btn-primary" onClick={() => setMarking(i)}>
                                {r.sub?.marks !== null && r.sub?.marks !== undefined ? 'Edit mark' : 'Mark'}
                              </button>
                            </div>
                          )}
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
          hasNext={shown.slice(marking + 1).some((r) => r.sub || r._synLeaderSub)}
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
          onClose={() => setGradingPres(false)}
          onSaved={reload}
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

function MarkModal({ a, assignMeta, allRows, row, hasNext, onShowSql, onClose, onSaved }) {
  const toast = useToast();
  const [act] = useAction();
  const effectiveSub = row.sub || row._synLeaderSub;
  const [marks, setMarks] = useState(row.sub?.marks ?? '');
  const [feedback, setFeedback] = useState(row.sub?.feedback || '');
  const [busy, setBusy] = useState(false);

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

  return (
    <Modal
      title={syndicate ? `${row.full_name} · ${syndicate.name}` : row.full_name}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="tiny muted hide-sm" style={{ marginRight: 'auto' }}>Tip: Ctrl/Cmd + ↵ to save &amp; continue</span>
          <button type="button" className="btn" onClick={onClose}>Close</button>
          {row.sub?.id && (
            <button type="button" className="btn" onClick={() => save(false, false)} disabled={busy}>Save single</button>
          )}
          {syndicate && syndicatePeers.length > 1 && (
            <button type="button" className="btn btn-primary" onClick={() => save(hasNext, true)} disabled={busy}>
              {hasNext ? `Save & apply to group (${syndicatePeers.length}) →` : `Save & apply to all ${syndicatePeers.length} members`}
            </button>
          )}
          {(!syndicate || syndicatePeers.length <= 1) && (
            <>
              {!hasNext && <button type="button" className="btn btn-primary" onClick={() => save(false, false)} disabled={busy}>Save</button>}
              {hasNext && <button type="button" className="btn btn-primary" onClick={() => save(true, false)} disabled={busy}>Save and next</button>}
            </>
          )}
        </>
      }
    >
      <div className="notice notice-info row-wrap">
        <Icon name="file" />
        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          <strong>{effectiveSub.file_name}</strong><br />
          <span className="small">Submitted {fmtFull(effectiveSub.submitted_at)}{effectiveSub.is_late ? ' · LATE' : ''}</span>
        </span>
        {!isInClass && <button type="button" className="btn btn-sm" onClick={() => act(() => openStoredFile('submissions', effectiveSub.file_path))}>Open file</button>}
      </div>

      {syndicate && (
        <div className="stack-sm" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--teal-50)', border: '1px solid var(--teal)' }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 6 }}>
            <strong className="small" style={{ color: 'var(--teal-dark)' }}>
              {syndicate.name} ({syndicatePeers.length} members)
            </strong>
            {assignMeta.syndicate.peerCheck !== false && syndicatePeers.length > 1 && (
              <label className="check" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={customSplit}
                  onChange={(e) => setCustomSplit(e.target.checked)}
                />
                <span className="tiny strong">Adjust individual marks{hasFlaggedPeer ? ' (low peer score detected)' : ''}</span>
              </label>
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
                    <span className="mono strong small">{m.index_no}</span>
                    {m.full_name && m.full_name !== m.index_no && <span className="small">{m.full_name}</span>}
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
                          From {n.fromName} ({n.score}/5){n.note ? `: “${n.note}”` : ''}
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

      <Field label="Feedback to the student" hint="shown when you release marks">
        <textarea className="textarea" rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </Field>
    </Modal>
  );
}


function PresentationModal({ a, assignMeta, allRows, onClose, onSaved }) {
  const toast = useToast();
  const groups = assignMeta.syndicate.groups || [];
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
                  {g.name} ({markedMembers}/{g.members.length} marked)
                </option>
              );
            })}
          </select>
        </Field>
        <div className="row" style={{ gap: 6, alignSelf: 'flex-end' }}>
          <button type="button" className="btn btn-sm" disabled={groupIdx === 0} onClick={() => setGroupIdx((i) => Math.max(0, i - 1))}>← Prev</button>
          <button type="button" className="btn btn-sm" disabled={!hasNext} onClick={() => setGroupIdx((i) => Math.min(groups.length - 1, i + 1))}>Next →</button>
        </div>
      </div>

      <div className="stack-sm" style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--teal-50)', border: '1px solid var(--teal)' }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <strong className="small" style={{ color: 'var(--teal-dark)' }}>{syndicate.name} · {peers.length} members</strong>
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
