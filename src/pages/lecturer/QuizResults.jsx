import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rpc, rpcAll, run, supabase } from '../../lib/supabase.js';
import { fmtFull, fmtNumber, pct } from '../../lib/format.js';
import { downloadWorkbook } from '../../lib/sheets.js';
import { ALL_GROUPS, GroupFilters, GroupSummaryTable, groupLabel, groupSummary, matchesGroup } from '../../components/Groups.jsx';
import { SortSelect, SortTh } from '../../components/SortBar.jsx';
import { byNameIndex, compareNumber, compareText } from '../../lib/sort.js';
import Icon from '../../components/Icon.jsx';
import { Topbar } from '../../components/Layout.jsx';
import { Confirm, Empty, ErrorNote, Loading, Modal, Tabs, useAction, useLoad, useToast } from '../../components/ui.jsx';
import { ItemAnalysis, Integrity } from './QuizInsights.jsx';
import { useAuth } from '../../lib/auth.jsx';
import LiveQuizMonitor from '../../components/LiveQuizMonitor.jsx';
import StudentScriptModal from '../../components/StudentScriptModal.jsx';
import { deleteQuizProctorPhoto, loadQuizProctorPhotos, purgeQuizProctorPhotos } from '../../lib/proctorPhotos.js';
import { ALL_NEW_FEATURES_SQL } from '../../lib/allFeaturesSql.js';
import { parseQuizMeta, serializeQuizMeta } from '../../lib/quizMeta.js';
import RubricGrader, { RubricEditor } from '../../components/RubricGrader.jsx';

const BINS = [
  { label: '0–39%', lo: 0, hi: 39.999, color: 'var(--amber)' },
  { label: '40–49%', lo: 40, hi: 49.999 },
  { label: '50–59%', lo: 50, hi: 59.999 },
  { label: '60–69%', lo: 60, hi: 69.999 },
  { label: '70–79%', lo: 70, hi: 79.999 },
  { label: '80–100%', lo: 80, hi: 100 },
];

const STATUS = {
  marked: ['Marked', 'badge-teal'],
  needs_marking: ['Needs marking', 'badge-amber'],
  in_progress: ['In progress', 'badge-blue'],
  not_started: ['Not submitted', ''],
  not_activated: ['No account', ''],
};

export default function QuizResults() {
  const { quizId } = useParams();
  const { isTA } = useAuth();
  const [tab, setTab] = useState('gradebook');
  const [regrading, setRegrading] = useState(false);
  const [showFeaturesSql, setShowFeaturesSql] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const { data, error, loading, reload, setData } = useLoad(async () => {
    const quiz = await run(supabase.from('quizzes').select('*, courses(id, code, title)').eq('id', quizId).single());
    const [rows, queue] = await Promise.all([
      rpcAll('quiz_gradebook', { p_quiz: quizId }),
      rpcAll('marking_queue', { p_quiz: quizId }),
    ]);
    const { photos, meta: photoMeta } = await loadQuizProctorPhotos({
      courseId: quiz.course_id,
      quizId: quiz.id,
      rows,
    });
    return { quiz, rows, queue, photos, photoMeta };
  }, [quizId]);

  const photoMap = data?.photos || new Map();
  const photoMeta = data?.photoMeta || new Map();
  const [act, busy] = useAction();
  const toast = useToast();

  if (loading) return <Loading label="Collecting results…" />;
  if (error) return <div className="page"><ErrorNote error={error} onRetry={reload} /></div>;

  const { quiz, rows, queue } = data;
  const pending = queue.filter((r) => r.marks_awarded === null).length;
  const activeCount = rows.filter((r) => r.status === 'in_progress').length;

  async function doRegrade() {
    try {
      const res = await rpc('regrade_quiz', { p_quiz: quiz.id, p_preserve_manual: true });
      setRegrading(false);
      toast(`Regraded ${res?.attempts_updated ?? 0} attempt(s) using the current answer key.`);
      reload();
    } catch (e) {
      setRegrading(false);
      if (/regrade_quiz|Could not find|does not exist|schema cache/i.test(e.message || '')) {
        setShowFeaturesSql(true);
      } else {
        toast(e.message || 'Could not regrade quiz.', 'error');
      }
    }
  }

  function copyFeaturesSql() {
    navigator.clipboard?.writeText?.(ALL_NEW_FEATURES_SQL);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 3000);
  }

  async function toggleRelease() {
    const next = !quiz.results_released;
    const ok = await act(
      () => run(supabase.from('quizzes').update({ results_released: next }).eq('id', quiz.id)),
      next ? 'Results released — students can now see their scores.' : 'Results hidden from students.',
    );
    if (ok !== undefined) setData((d) => ({ ...d, quiz: { ...d.quiz, results_released: next } }));
  }

  return (
    <>
      <Topbar title={quiz.title} sub={`${quiz.courses.code} · results`}>
        {isTA ? (
          <Link to={`/teach/course/${quiz.courses.id}?tab=quizzes`} className="btn"><Icon name="chevronLeft" /> Quizzes</Link>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => setRegrading(true)} disabled={busy} title="Re-score all submitted objective & short-answer attempts using current keys/marks">
              <Icon name="refresh" size={16} /> Regrade quiz
            </button>
            <Link to={`/teach/quiz/${quiz.id}`} className="btn"><Icon name="edit" /> Edit quiz</Link>
            <button type="button" className={`btn ${quiz.results_released ? '' : 'btn-primary'}`} onClick={toggleRelease} disabled={busy}>
              {quiz.results_released ? 'Hide results' : 'Release results'}
            </button>
          </>
        )}
      </Topbar>
      <div className="page stack">
        {quiz.results_released
          ? <div className="notice notice-info">Results are released. Students can see their scores{quiz.show_answers ? ' and the correct answers' : ''}.</div>
          : <div className="notice notice-warn">Results are hidden. Students only see "submitted" until {isTA ? 'the lecturer releases' : 'you release'} them.</div>}
        <Tabs tabs={[
          { id: 'gradebook', label: 'Gradebook' },
          { id: 'live', label: 'Live monitor', count: activeCount },
          { id: 'short', label: 'Short answers' },
          { id: 'marking', label: 'Written answers', count: pending },
          ...(isTA ? [] : [{ id: 'analysis', label: 'Question analysis' }, { id: 'integrity', label: 'Integrity checks' }]),
        ]} value={tab}
          onChange={(t) => { setTab(t); if (t === 'gradebook') reload(); }} />
        {tab === 'gradebook' && <Gradebook quiz={quiz} rows={rows} reload={reload} ta={isTA} photos={photoMap} photoMeta={photoMeta} />}
        {tab === 'live' && <LiveQuizMonitor quiz={quiz} isTA={isTA} onMutate={reload} />}
        {tab === 'short' && <ShortAnswerClusterTab quiz={quiz} onUpdated={reload} onShowSql={() => setShowFeaturesSql(true)} />}
        {tab === 'marking' && <Marking quiz={quiz} isTA={isTA} queue={queue} onQuizUpdated={(nextQ) => setData((d) => ({ ...d, quiz: nextQ }))} onMarked={(id, marks, feedback) => setData((d) => ({ ...d, queue: d.queue.map((r) => (r.response_id === id ? { ...r, marks_awarded: marks, feedback } : r)) }))} reload={reload} />}
        {tab === 'analysis' && !isTA && <ItemAnalysis quiz={quiz} />}
        {tab === 'integrity' && !isTA && <Integrity quiz={quiz} rows={rows} photos={photoMap} onShowSql={() => setShowFeaturesSql(true)} />}
      </div>
      {regrading && (
        <Confirm
          title="Regrade all submitted attempts?"
          confirmLabel="Regrade now"
          busy={busy}
          message={`This re-scores every submitted attempt in "${quiz.title}" across Multiple Choice, Multi-Select, True/False, Calculation, and Short Answer using the latest answer key and marks. Any manual mark overrides and essay marks are preserved.`}
          onClose={() => setRegrading(false)}
          onConfirm={() => act(doRegrade)}
        />
      )}
      {showFeaturesSql && (
        <Modal title="Enable New Feature RPCs in Supabase" onClose={() => setShowFeaturesSql(false)} wide>
          <p className="small muted">
            Run this one-time SQL script in your <strong>Supabase Dashboard → SQL Editor</strong> to enable Regrade, Short-Answer Clustering, Multi-Select, Question Diagrams, Hall Access PIN, and Material Counters.
          </p>
          <pre className="mono small" style={{ maxHeight: 260, overflowY: 'auto', padding: 12, background: 'var(--surface-2)', borderRadius: 8, fontSize: 11 }}>
            {ALL_NEW_FEATURES_SQL}
          </pre>
          <div className="between" style={{ alignItems: 'center', marginTop: 12 }}>
            <span className="tiny muted">100% idempotent — safe to run once on your live project.</span>
            <button type="button" className="btn btn-primary" onClick={copyFeaturesSql}>
              {copiedSql ? '✓ Copied SQL' : 'Copy SQL to Clipboard'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function exitText(r) {
  if (!r.exits) return '';
  const kinds = { tab: 'switched tab or app', blur: 'left the window', fullscreen: 'left full screen', 'split-screen / resized window': 'split-screen / window resized', 'zoom-out': 'zoomed out browser' };
  return (r.exit_log || []).map((e) => `${new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} — ${kinds[e.kind] || e.kind}`).join('\n');
}

function Gradebook({ quiz, rows: allRows, reload, ta, photos = new Map(), photoMeta = new Map() }) {
  const [filter, setFilter] = useState('all');
  const [scoreBand, setScoreBand] = useState('all');
  const [group, setGroup] = useState(ALL_GROUPS);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('name_asc');
  const [retake, setRetake] = useState(null);
  const [showLog, setShowLog] = useState(null);
  const [viewPhoto, setViewPhoto] = useState(null);
  const [viewScript, setViewScript] = useState(null);
  const [purgingPhotos, setPurgingPhotos] = useState(false);
  const [act, busy] = useAction();

  async function deleteSinglePhoto(item) {
    if (!item?.student) return;
    const ok = await act(async () => {
      await deleteQuizProctorPhoto({
        courseId: quiz.course_id,
        quizId: quiz.id,
        attemptId: item.student.attempt_id,
        studentId: item.student.student_id,
        meta: photoMeta,
      });
    }, 'Verification photo deleted.');
    if (ok !== undefined) {
      setViewPhoto(null);
      reload();
    }
  }

  async function purgeAllPhotos() {
    const ok = await act(async () => {
      await purgeQuizProctorPhotos({
        courseId: quiz.course_id,
        quizId: quiz.id,
        rows: allRows,
        meta: photoMeta,
      });
    }, 'All verification photos for this quiz purged permanently.');
    if (ok !== undefined) {
      setPurgingPhotos(false);
      reload();
    }
  }

  const rows = useMemo(() => allRows.filter((r) => matchesGroup(r, group)), [allRows, group]);
  const isDone = (r) => r.status === 'marked' || r.status === 'needs_marking';
  const fastLimit = Math.max(2, quiz.duration_minutes * 0.2);
  const done = rows.filter(isDone);
  const withPct = done.map((r) => ({ ...r, p: pct(r.score, r.max_score) })).filter((r) => r.p !== null);
  const avg = withPct.length ? Math.round(withPct.reduce((s, r) => s + r.p, 0) / withPct.length) : null;
  const fast = done.filter((r) => r.minutes_used !== null && Number(r.minutes_used) < fastLimit);
  const suspicious = rows.filter((r) => r.exits > 0 || r.devices > 1);
  const counts = BINS.map((b) => withPct.filter((r) => r.p >= b.lo && r.p <= b.hi).length);
  const maxCount = Math.max(1, ...counts);
  const summary = useMemo(() => groupSummary(allRows, isDone, (r) => pct(r.score, r.max_score)), [allRows]);

  const compareRows = (a, b) => {
    const scorePct = (r) => (r.status !== 'in_progress' && r.score !== null ? pct(r.score, r.max_score) : null);
    const rawScore = (r) => (r.status !== 'in_progress' && r.score !== null ? Number(r.score) : null);
    const mins = (r) => (r.minutes_used !== null ? Number(r.minutes_used) : null);
    const statusOrder = { marked: 1, needs_marking: 2, in_progress: 3, not_started: 4, not_activated: 5 };
    switch (sort) {
      case 'score_desc':
        return compareNumber(scorePct(a), scorePct(b), 'desc') || compareNumber(rawScore(a), rawScore(b), 'desc') || byNameIndex(a, b);
      case 'score_asc':
        return compareNumber(scorePct(a), scorePct(b), 'asc') || compareNumber(rawScore(a), rawScore(b), 'asc') || byNameIndex(a, b);
      case 'name_desc':
        return compareText(a.full_name, b.full_name, 'desc') || compareText(a.index_no, b.index_no, 'asc');
      case 'index_asc':
        return compareText(a.index_no, b.index_no, 'asc') || byNameIndex(a, b);
      case 'index_desc':
        return compareText(a.index_no, b.index_no, 'desc') || byNameIndex(a, b);
      case 'prog_asc':
        return compareText(a.programme, b.programme, 'asc') || compareText(a.stream, b.stream, 'asc') || byNameIndex(a, b);
      case 'prog_desc':
        return compareText(a.programme, b.programme, 'desc') || compareText(a.stream, b.stream, 'asc') || byNameIndex(a, b);
      case 'stream_asc':
        return compareText(a.stream, b.stream, 'asc') || compareText(a.programme, b.programme, 'asc') || byNameIndex(a, b);
      case 'stream_desc':
        return compareText(a.stream, b.stream, 'desc') || compareText(a.programme, b.programme, 'asc') || byNameIndex(a, b);
      case 'time_asc':
        return compareNumber(mins(a), mins(b), 'asc') || byNameIndex(a, b);
      case 'time_desc':
        return compareNumber(mins(a), mins(b), 'desc') || byNameIndex(a, b);
      case 'exits_desc':
        return compareNumber(a.exits, b.exits, 'desc') || compareNumber(a.devices, b.devices, 'desc') || byNameIndex(a, b);
      case 'exits_asc':
        return compareNumber(a.exits, b.exits, 'asc') || compareNumber(a.devices, b.devices, 'asc') || byNameIndex(a, b);
      case 'status_asc':
        return compareNumber(statusOrder[a.status] ?? 9, statusOrder[b.status] ?? 9, 'asc') || byNameIndex(a, b);
      case 'status_desc':
        return compareNumber(statusOrder[a.status] ?? 9, statusOrder[b.status] ?? 9, 'desc') || byNameIndex(a, b);
      case 'name_asc':
      default:
        return byNameIndex(a, b);
    }
  };

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (filter === 'marked' && r.status !== 'marked') return false;
      if (filter === 'marking' && r.status !== 'needs_marking') return false;
      if (filter === 'missing' && isDone(r)) return false;
      if (filter === 'fast' && !(r.minutes_used !== null && Number(r.minutes_used) < fastLimit && r.submitted_at)) return false;
      if (filter === 'flagged' && !(r.exits > 0 || r.devices > 1)) return false;
      if (scoreBand !== 'all') {
        const p = r.status !== 'in_progress' && r.score !== null ? pct(r.score, r.max_score) : null;
        if (p === null) return false;
        if (scoreBand === '80' && p < 80) return false;
        if (scoreBand === '60' && (p < 60 || p >= 80)) return false;
        if (scoreBand === '40' && (p < 40 || p >= 60)) return false;
        if (scoreBand === 'low' && p >= 40) return false;
      }
      if (term) {
        const hay = [r.full_name, r.index_no, r.programme, r.stream].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    return [...filtered].sort(compareRows);
  }, [rows, filter, scoreBand, q, fastLimit, sort]);

  const hasFilters = Boolean(q.trim() || filter !== 'all' || scoreBand !== 'all' || group.programme !== '*' || group.stream !== '*' || sort !== 'name_asc');
  function clearFilters() {
    setQ('');
    setFilter('all');
    setScoreBand('all');
    setGroup(ALL_GROUPS);
    setSort('name_asc');
  }

  function exportXlsx() {
    const header = ['Index number', 'Name', 'Programme', 'Stream', 'Status', 'Verification Photo', 'Auto-marked', 'Written', 'Total', 'Out of', 'Percent',
      'Minutes used', 'Times left quiz', 'Devices used', 'Submitted', 'Attempts', 'Special sitting'];
    const line = (r) => [
      r.index_no, r.full_name, r.programme, r.stream, (STATUS[r.status] || [r.status])[0],
      (photos?.get(r.attempt_id) || photos?.get(r.student_id)) ? 'Verified (Photo On File)' : 'None',
      r.auto_score !== null && r.attempt_id ? Number(r.auto_score) : '', r.manual_score !== null ? Number(r.manual_score) : '',
      r.score !== null ? Number(r.score) : '', r.max_score !== null ? Number(r.max_score) : '',
      pct(r.score, r.max_score) ?? '', r.minutes_used !== null ? Number(r.minutes_used) : '',
      r.attempt_id ? r.exits : '', r.attempt_id ? r.devices : '',
      r.submitted_at ? fmtFull(r.submitted_at) : '', r.attempts_used, r.special ? 'Yes' : '',
    ];
    const widths = [16, 30, 18, 12, 16, 20, 12, 10, 10, 10, 10, 12, 14, 12, 22, 10, 14];
    const sortedAll = [...allRows].sort(compareRows);
    const sheets = [
      { name: 'All students', rows: [header, ...sortedAll.map(line)], widths },
      { name: 'Summary', rows: [['Programme', 'Stream', 'Students', 'Submitted', 'Average %'],
        ...summary.map((g) => [groupLabel(g.programme), groupLabel(g.stream), g.students, g.submitted, g.average ?? ''])], widths: [22, 14, 10, 10, 10] },
    ];
    const streams = [...new Set(allRows.map((r) => r.stream || ''))];
    if (streams.length > 1) {
      streams.sort().forEach((st) => sheets.push({ name: groupLabel(st), rows: [header, ...sortedAll.filter((r) => (r.stream || '') === st).map(line)], widths }));
    }
    downloadWorkbook(`${quiz.courses.code} - ${quiz.title}.xlsx`, sheets);
  }

  async function allowRetake() {
    await act(() => run(supabase.from('attempts').delete().eq('quiz_id', quiz.id).eq('student_id', retake.student_id)),
      `${retake.full_name} can now take the quiz again.`);
    setRetake(null);
    reload();
  }

  return (
    <div className="stack-lg">
      <GroupFilters rows={allRows} value={group} onChange={setGroup} />
      <div className="two-col" style={{ gridTemplateColumns: '440px minmax(0,1fr)' }}>
        <div className="grid-2">
          <div className="kpi">
            <div className="kpi-head"><span className="l">Submitted</span><span className="kpi-icon"><Icon name="check" size={16} /></span></div>
            <span className="v">{done.length}</span>
            <span className="tiny muted">of {rows.length} students</span>
          </div>
          <div className="kpi">
            <div className="kpi-head"><span className="l">Average</span><span className="kpi-icon blue"><Icon name="chart" size={16} /></span></div>
            <span className="v">{avg === null ? '—' : `${avg}%`}</span>
            <span className="tiny muted">of submitted work</span>
          </div>
          <div className="kpi">
            <div className="kpi-head"><span className="l">Needs marking</span><span className="kpi-icon amber"><Icon name="edit" size={16} /></span></div>
            <span className="v" style={{ color: 'var(--amber-ink)' }}>{rows.filter((r) => r.status === 'needs_marking').length}</span>
            <span className="tiny muted">written answers pending</span>
          </div>
          <div className="kpi">
            <div className="kpi-head"><span className="l">Flagged</span><span className="kpi-icon red"><Icon name="alert" size={16} /></span></div>
            <span className="v" style={{ color: suspicious.length ? 'var(--red-ink)' : undefined }}>{suspicious.length}</span>
            <span className="tiny muted">left the quiz or used 2+ devices</span>
          </div>
        </div>
        <section className="card stack-sm" aria-label="Score distribution">
          <div className="between"><h2>Score distribution</h2><span className="tiny muted">students per score band</span></div>
          <div className="dist">
            {counts.map((c, i) => (
              <div key={BINS[i].label} className="dist-col">
                <span className="mono tiny">{c}</span>
                <div className="dist-bar" style={{ height: `${(c / maxCount) * 88}px`, background: BINS[i].color || 'var(--teal)' }} />
              </div>
            ))}
          </div>
          <div className="dist-labels">{BINS.map((b) => <span key={b.label}>{b.label}</span>)}</div>
        </section>
      </div>

      <GroupSummaryTable summary={summary} />

      <section className="card-flush">
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="row-wrap" style={{ flex: 1, minWidth: 260 }}>
            <label className="search">
              <span className="sr-only">Search</span>
              <Icon name="search" size={16} />
              <input className="input" style={{ width: 230, minHeight: 40 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, index, programme, stream" />
            </label>
            <div className="chips" role="group" aria-label="Filter">
              {[['all', `All · ${rows.length}`], ['marked', `Marked · ${rows.filter((r) => r.status === 'marked').length}`], ['marking', 'Needs marking'], ['missing', 'Not submitted'], ['flagged', `Flagged · ${suspicious.length}`], ['fast', `Under ${fmtNumber(fastLimit, 1)} min · ${fast.length}`]].map(([id, label]) => (
                <button key={id} type="button" className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
              ))}
            </div>
            <label className="row small" style={{ gap: 6 }}>
              <span className="muted">Score</span>
              <select
                aria-label="Filter by score band"
                className="select"
                style={{ minHeight: 40, width: 'auto', fontSize: 13 }}
                value={scoreBand}
                onChange={(e) => setScoreBand(e.target.value)}
              >
                <option value="all">All scores</option>
                <option value="80">80% – 100%</option>
                <option value="60">60% – 79%</option>
                <option value="40">40% – 59%</option>
                <option value="low">Under 40%</option>
              </select>
            </label>
            <SortSelect
              value={sort}
              onChange={setSort}
              options={[
                { value: 'score_desc', label: 'Score: High → Low' },
                { value: 'score_asc', label: 'Score: Low → High' },
                { value: 'name_asc', label: 'Name (A → Z)' },
                { value: 'name_desc', label: 'Name (Z → A)' },
                { value: 'index_asc', label: 'Index no. (Ascending)' },
                { value: 'index_desc', label: 'Index no. (Descending)' },
                { value: 'prog_asc', label: 'Programme / Class (A → Z)' },
                { value: 'stream_asc', label: 'Stream (A → Z)' },
                { value: 'time_asc', label: 'Time used (Fastest first)' },
                { value: 'time_desc', label: 'Time used (Slowest first)' },
                { value: 'exits_desc', label: 'Left quiz / Exits (Most first)' },
                { value: 'status_asc', label: 'Status' },
              ]}
            />
          </div>
          <div className="row-wrap" style={{ gap: 8 }}>
            {photos?.size > 0 && !ta && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ color: 'var(--red-ink)' }}
                onClick={() => setPurgingPhotos(true)}
                title="Permanently remove candidate snapshot photos to save storage"
              >
                <Icon name="trash" size={14} /> Clear Photos ({photoMeta.size || photos.size})
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={exportXlsx}><Icon name="download" size={16} /> Export to Excel</button>
          </div>
        </div>
        {hasFilters && allRows.length > 0 && (
          <div className="filter-meta">
            <span className="muted">Showing <strong>{shown.length}</strong> of {allRows.length} student{allRows.length === 1 ? '' : 's'}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={clearFilters}>Reset filters &amp; sort</button>
          </div>
        )}
        {rows.length === 0 ? <Empty icon="users" title="No students in this group" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortTh label="Index no." ascKey="index_asc" descKey="index_desc" current={sort} onSort={setSort} />
                  <SortTh label="Student" ascKey="name_asc" descKey="name_desc" current={sort} onSort={setSort} />
                  <SortTh label="Group" ascKey="prog_asc" descKey="prog_desc" current={sort} onSort={setSort} className="hide-sm" />
                  <SortTh label="Total" ascKey="score_asc" descKey="score_desc" defaultDir="desc" current={sort} onSort={setSort} className="num" />
                  <SortTh label="%" ascKey="score_asc" descKey="score_desc" defaultDir="desc" current={sort} onSort={setSort} className="num" />
                  <SortTh label="Time" ascKey="time_asc" descKey="time_desc" current={sort} onSort={setSort} className="num hide-sm" />
                  <SortTh label="Left quiz" ascKey="exits_asc" descKey="exits_desc" defaultDir="desc" current={sort} onSort={setSort} />
                  <SortTh label="Status" ascKey="status_asc" descKey="status_desc" current={sort} onSort={setSort} />
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 400).map((r) => {
                  const [label, cls] = STATUS[r.status] || [r.status, ''];
                  const p = pct(r.score, r.max_score);
                  return (
                    <tr key={r.index_no}>
                      <td className="mono small">{r.index_no}</td>
                      <td>
                        <div className="row" style={{ alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>{r.full_name}</span>
                          {r.attempts_used > 1 ? <span className="tiny muted">· {r.attempts_used} att.</span> : null}
                          {r.special && <span className="badge badge-plum" title="Has special access to this quiz">Special</span>}
                          {(photos?.get(r.attempt_id) || photos?.get(r.student_id)) && (
                            <button
                              type="button"
                              className="badge badge-teal"
                              style={{ border: 0, cursor: 'pointer', padding: '2px 7px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                              onClick={() => setViewPhoto({ student: r, photo: photos.get(r.attempt_id) || photos.get(r.student_id) })}
                              title="View mid-quiz verification photo"
                            >
                              <Icon name="camera" size={12} /> Photo
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="small muted hide-sm">{[r.programme, r.stream].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="num strong">{r.score !== null && r.status !== 'in_progress' ? `${fmtNumber(r.score)} / ${fmtNumber(r.max_score)}` : '—'}</td>
                      <td className="num">{p !== null && r.status !== 'in_progress' ? `${p}%` : '—'}</td>
                      <td className="num hide-sm">{r.minutes_used !== null ? `${fmtNumber(r.minutes_used, 1)}m` : '—'}</td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {r.exits > 0 && (
                            <button type="button" className="badge badge-red" style={{ border: 0, cursor: 'pointer' }} onClick={() => setShowLog(r)} title={exitText(r)}>
                              {r.exits}×
                            </button>
                          )}
                          {r.devices > 1 && <span className="badge badge-amber" title="Opened on more than one device or browser">{r.devices} devices</span>}
                          {!r.exits && r.devices <= 1 && <span className="muted small">—</span>}
                        </div>
                      </td>
                      <td><span className={`badge ${cls}`}>{label}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div className="row" style={{ gap: 4 }}>
                          {r.attempt_id && (
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setViewScript(r)} title="View every question and student answer choice">
                              <Icon name="eye" size={14} /> View script
                            </button>
                          )}
                          {!ta && r.attempts_used > 0 && (
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRetake(r)}>Allow retake</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length > 400 && <p className="small muted" style={{ padding: '12px 18px' }}>Showing 400 of {shown.length}. Search, or export to Excel for the full list.</p>}
            {shown.length === 0 && <Empty>No students match.</Empty>}
          </div>
        )}
      </section>

      {retake && (
        <Confirm title="Allow a retake?" danger confirmLabel="Delete attempt and allow retake" busy={busy}
          message={`${retake.full_name}'s attempt${retake.attempts_used > 1 ? 's' : ''} and score will be deleted so they can take the quiz again (while it is open).`}
          onClose={() => setRetake(null)} onConfirm={allowRetake} />
      )}
      {showLog && (
        <Modal title={`${showLog.full_name} — left the quiz ${showLog.exits} time${showLog.exits === 1 ? '' : 's'}`} onClose={() => setShowLog(null)}>
          {(photos?.get(showLog.attempt_id) || photos?.get(showLog.student_id)) && (
            <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 14, padding: 10, background: 'var(--teal-50)', borderRadius: 8 }}>
              <img
                src={photos.get(showLog.attempt_id) || photos.get(showLog.student_id)}
                alt="Verification snapshot"
                style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--teal)' }}
              />
              <div className="stack-sm" style={{ gap: 2 }}>
                <strong className="small">Mid-Quiz Verification Photo On File</strong>
                <span className="tiny muted">Captured candidate webcam presence during exam</span>
              </div>
            </div>
          )}
          <p className="small muted">Times are when the quiz screen was left. {showLog.devices > 1 ? `The attempt was also opened on ${showLog.devices} different devices or browsers.` : ''}</p>
          <pre className="mono small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{exitText(showLog)}</pre>
        </Modal>
      )}
      {purgingPhotos && (
        <Confirm
          title="Delete all verification photos for this quiz?"
          danger
          confirmLabel="Permanently delete all photos"
          busy={busy}
          message={`This will permanently delete all ${photoMeta.size || photos.size} student webcam verification snapshots stored for this quiz to free up storage and protect student privacy.`}
          onClose={() => setPurgingPhotos(false)}
          onConfirm={purgeAllPhotos}
        />
      )}
      {viewScript && (
        <StudentScriptModal
          attemptId={viewScript.attempt_id}
          student={viewScript}
          quiz={quiz}
          isTA={ta}
          onClose={() => setViewScript(null)}
          onMarked={reload}
        />
      )}
      {viewPhoto && (
        <Modal title={`Verification Photo · ${viewPhoto.student.full_name}`} onClose={() => setViewPhoto(null)}>
          <div className="stack" style={{ textAlign: 'center', alignItems: 'center', gap: 14 }}>
            <div style={{ maxWidth: 320, width: '100%', borderRadius: 10, overflow: 'hidden', border: '2px solid var(--teal)', boxShadow: '0 4px 14px rgba(0,0,0,0.1)' }}>
              <img
                src={viewPhoto.photo}
                alt={`Identity snapshot of ${viewPhoto.student.full_name}`}
                style={{ width: '100%', height: 'auto', display: 'block', background: '#000' }}
              />
            </div>
            <div className="stack-sm" style={{ gap: 4 }}>
              <strong style={{ fontSize: 16 }}>{viewPhoto.student.full_name}</strong>
              <span className="mono muted">{viewPhoto.student.index_no} {viewPhoto.student.programme ? `· ${viewPhoto.student.programme}` : ''}</span>
              <span className="small muted">
                Captured mid-exam from the student camera during the live test session.
              </span>
            </div>
            <div className="row-wrap" style={{ gap: 10, justifyContent: 'center', marginTop: 6 }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ color: 'var(--red-ink)', borderColor: 'var(--red-ink)' }}
                onClick={() => deleteSinglePhoto(viewPhoto)}
                disabled={busy}
              >
                <Icon name="trash" size={14} /> Delete this photo
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setViewPhoto(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function normalizeWrittenAnswer(text) {
  const raw = String(text || '').trim();
  if (!raw) return '__EMPTY__';
  return raw.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim() || raw.toLowerCase();
}

function Marking({ quiz, isTA, queue, onMarked, onQuizUpdated }) {
  const toast = useToast();
  const [editingRubric, setEditingRubric] = useState(false);
  const [savingRubric, setSavingRubric] = useState(false);
  const quizMeta = useMemo(() => parseQuizMeta(quiz), [quiz]);

  const questions = useMemo(() => {
    const m = new Map();
    queue.forEach((r) => {
      if (!m.has(r.question_id)) m.set(r.question_id, { id: r.question_id, prompt: r.prompt, max: r.max_marks, guide: r.model_answer, items: [] });
      m.get(r.question_id).items.push(r);
    });
    return [...m.values()];
  }, [queue]);
  const [selected, setSelected] = useState(questions[0]?.id);
  const [onlyPending, setOnlyPending] = useState(true);
  const [groupSimilar, setGroupSimilar] = useState(true);

  const current = questions.find((x) => x.id === selected) || questions[0] || null;
  const items = useMemo(
    () => (current ? current.items.filter((r) => !onlyPending || r.marks_awarded === null) : []),
    [current, onlyPending]
  );
  const markedCount = current ? current.items.filter((r) => r.marks_awarded !== null).length : 0;

  const groups = useMemo(() => {
    const m = new Map();
    for (const r of items) {
      const k = normalizeWrittenAnswer(r.answer);
      if (!m.has(k)) m.set(k, { key: k, sampleAnswer: r.answer, max_marks: r.max_marks, items: [] });
      m.get(k).items.push(r);
    }
    return [...m.values()].sort((a, b) => b.items.length - a.items.length);
  }, [items]);

  if (!questions.length) return <div className="card"><Empty icon="edit" title="No written answers">This quiz has no written-answer questions, or nobody has submitted yet.</Empty></div>;

  const savedClusters = items.length - groups.length;
  const activeRubric = (current && quizMeta.question_rubrics?.[current.id]) || [];

  return (
    <div className="two-col" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
      <main className="stack">
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span className="small muted">
            {markedCount} of {current.items.length} marked for this question
            {groupSimilar && savedClusters > 0 ? ` · ${groups.length} distinct answer groups (saves ${savedClusters} clicks)` : ''}
          </span>
          <div className="row-wrap" style={{ gap: 14 }}>
            <label className="check small">
              <input type="checkbox" checked={groupSimilar} onChange={(e) => setGroupSimilar(e.target.checked)} />
              Group matching answers
            </label>
            <label className="check small">
              <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
              Show only unmarked
            </label>
          </div>
        </div>
        {items.length === 0 && <div className="card"><Empty icon="check" title="All marked">Every answer to this question has marks.</Empty></div>}
        {groupSimilar ? (
          <>
            {groups.slice(0, 50).map((g) => (
              g.items.length === 1
                ? <MarkCard key={g.items[0].response_id} r={g.items[0]} rubric={activeRubric} onMarked={onMarked} />
                : <MarkGroupCard key={g.key + '-' + g.items.map((x) => x.response_id).join(',')} group={g} rubric={activeRubric} onMarked={onMarked} />
            ))}
            {groups.length > 50 && <p className="small muted">Showing 50 groups at a time — marked groups disappear from this list as you go.</p>}
          </>
        ) : (
          <>
            {items.slice(0, 50).map((r) => <MarkCard key={r.response_id} r={r} rubric={activeRubric} onMarked={onMarked} />)}
            {items.length > 50 && <p className="small muted">Showing 50 at a time — marked answers disappear from this list as you go.</p>}
          </>
        )}
      </main>
      <aside className="stack" style={{ position: 'sticky', top: 90, alignSelf: 'start' }}>
        {questions.length > 1 && (
          <div className="card-flush">
            {questions.map((x, i) => {
              const left = x.items.filter((r) => r.marks_awarded === null).length;
              return (
                <button key={x.id} type="button" className="list-row" onClick={() => setSelected(x.id)}
                  style={{ background: x.id === current.id ? 'var(--teal-50)' : undefined }}>
                  <span className="list-main"><span className="title small">Written question {i + 1}</span><span className="tiny muted">{x.prompt.slice(0, 60)}…</span></span>
                  {left > 0 ? <span className="badge badge-amber">{left}</span> : <span className="badge badge-teal">Done</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="card stack-sm">
          <div className="between">
            <span className="eyebrow">Question · {fmtNumber(current.max)} marks</span>
            {!isTA && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditingRubric(!editingRubric)}>
                {editingRubric ? 'Close rubric' : activeRubric.length ? `Edit rubric (${activeRubric.length})` : '+ Custom rubric'}
              </button>
            )}
          </div>
          <p className="pre small">{current.prompt}</p>
          {current.guide && (<><span className="eyebrow" style={{ marginTop: 8 }}>Your marking guide</span><p className="pre small" style={{ color: 'var(--text-2)' }}>{current.guide}</p></>)}
          {editingRubric && !isTA && (
            <QuestionRubricBox
              key={current.id}
              initial={activeRubric}
              maxMarks={Number(current.max)}
              busy={savingRubric}
              onSave={async (criteria) => {
                setSavingRubric(true);
                try {
                  const nextMap = { ...(quizMeta.question_rubrics || {}) };
                  if (criteria.length) nextMap[current.id] = criteria;
                  else delete nextMap[current.id];
                  const nextInstructions = serializeQuizMeta(quizMeta.cleanInstructions, { ...quizMeta, question_rubrics: nextMap });
                  await run(supabase.from('quizzes').update({ instructions: nextInstructions }).eq('id', quiz.id));
                  onQuizUpdated?.({ ...quiz, instructions: nextInstructions });
                  setEditingRubric(false);
                  toast('Question rubric saved.');
                } catch (e) {
                  toast(e.message || 'Could not save rubric.', 'error');
                } finally {
                  setSavingRubric(false);
                }
              }}
            />
          )}
        </div>
      </aside>
    </div>
  );
}


function QuestionRubricBox({ initial, maxMarks, busy, onSave }) {
  const [criteria, setCriteria] = useState(initial || []);
  return (
    <div className="stack-sm" style={{ marginTop: 8 }}>
      <RubricEditor criteria={criteria} maxMarks={maxMarks} onChange={setCriteria} compact />
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => onSave(criteria)}>
          {busy ? 'Saving…' : 'Save rubric'}
        </button>
      </div>
    </div>
  );
}

function MarkGroupCard({ group, rubric = [], onMarked }) {
  const toast = useToast();
  const max = Number(group.max_marks);
  const firstAwarded = group.items.every((x) => x.marks_awarded === group.items[0].marks_awarded) ? group.items[0].marks_awarded : null;
  const [marks, setMarks] = useState(firstAwarded ?? (group.key === '__EMPTY__' ? 0 : ''));
  const [feedback, setFeedback] = useState(group.items[0].feedback || '');
  const [busy, setBusy] = useState(false);
  const [showStudents, setShowStudents] = useState(false);

  async function saveAll(overrideMarks) {
    const val = overrideMarks !== undefined ? overrideMarks : marks;
    const m = Number(val);
    if (val === '' || Number.isNaN(m)) return toast('Enter marks first.', 'error');
    setBusy(true);
    try {
      for (let i = 0; i < group.items.length; i += 8) {
        const batch = group.items.slice(i, i + 8);
        await Promise.all(batch.map((r) => rpc('mark_response', { p_response: r.response_id, p_marks: m, p_feedback: feedback })));
      }
      group.items.forEach((r) => onMarked(r.response_id, m, feedback));
      toast(`Saved ${m} / ${fmtNumber(max)} for ${group.items.length} matching answers.`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card stack-sm" style={{ borderColor: 'var(--teal)' }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row-wrap" style={{ gap: 8 }}>
          <span className="badge badge-teal">{group.items.length} matching answers</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowStudents(!showStudents)}>
            {showStudents ? 'Hide students' : `View ${group.items.length} students`}
          </button>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-sm" onClick={() => setMarks(0)} disabled={busy}>0</button>
          <button type="button" className="btn btn-sm" onClick={() => setMarks(Number((max / 2).toFixed(2)))} disabled={busy}>50%</button>
          <button type="button" className="btn btn-sm" onClick={() => setMarks(max)} disabled={busy}>Full ({fmtNumber(max)})</button>
        </div>
      </div>
      {showStudents && (
        <div className="row-wrap" style={{ gap: 6, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8 }}>
          {group.items.map((r) => (
            <span key={r.response_id} className="badge" style={{ fontSize: 12 }}>
              {r.full_name} <span className="mono tiny muted" style={{ marginLeft: 4 }}>{r.index_no}</span>
            </span>
          ))}
        </div>
      )}
      <p className="pre" style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: 8 }}>
        {group.sampleAnswer || <span className="muted">No answer submitted</span>}
      </p>
      <RubricGrader
        criteria={rubric}
        maxMarks={max}
        currentFeedback={feedback}
        compact
        onApply={(total, mergedFb) => {
          if (total !== null) setMarks(total);
          setFeedback(mergedFb);
        }}
      />
      <div className="row-wrap" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 120 }}>
          <span>Marks / {fmtNumber(max)}</span>
          <input className="input mono" type="number" min="0" max={max} step="0.5" value={marks} onChange={(e) => setMarks(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveAll(); } }} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span>Feedback for all {group.items.length} <span className="hint">· Ctrl+Enter to save</span></span>
          <input className="input" value={feedback} onChange={(e) => setFeedback(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveAll(); } }} />
        </label>
        <button type="button" className="btn btn-primary" onClick={() => saveAll()} disabled={busy} title="Shortcut: Ctrl/Cmd + Enter">
          {busy ? 'Saving…' : `Save all (${group.items.length})`}
        </button>
      </div>
    </article>
  );
}

function MarkCard({ r, rubric = [], onMarked }) {
  const toast = useToast();
  const max = Number(r.max_marks);
  const [marks, setMarks] = useState(r.marks_awarded ?? '');
  const [feedback, setFeedback] = useState(r.feedback || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    const m = Number(marks);
    if (marks === '' || Number.isNaN(m)) return toast('Enter marks first.', 'error');
    setBusy(true);
    try {
      await rpc('mark_response', { p_response: r.response_id, p_marks: m, p_feedback: feedback });
      onMarked(r.response_id, m, feedback);
      toast(`Saved · ${r.full_name}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card stack-sm">
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="strong">{r.full_name} <span className="mono tiny muted">{r.index_no}</span></span>
        <div className="row" style={{ gap: 4 }}>
          {r.marks_awarded !== null && <span className="badge badge-teal">{fmtNumber(r.marks_awarded)} / {fmtNumber(max)}</span>}
          <button type="button" className="btn btn-sm" onClick={() => setMarks(0)} disabled={busy}>0</button>
          <button type="button" className="btn btn-sm" onClick={() => setMarks(Number((max / 2).toFixed(2)))} disabled={busy}>50%</button>
          <button type="button" className="btn btn-sm" onClick={() => setMarks(max)} disabled={busy}>Full</button>
        </div>
      </div>
      <p className="pre" style={{ background: 'var(--surface-2)', padding: '12px 14px', borderRadius: 8 }}>{r.answer || <span className="muted">No answer</span>}</p>
      <RubricGrader
        criteria={rubric}
        maxMarks={max}
        currentFeedback={feedback}
        compact
        onApply={(total, mergedFb) => {
          if (total !== null) setMarks(total);
          setFeedback(mergedFb);
        }}
      />
      <div className="row-wrap" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 120 }}>
          <span>Marks / {fmtNumber(max)}</span>
          <input className="input mono" type="number" min="0" max={max} step="0.5" value={marks} onChange={(e) => setMarks(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span>Feedback <span className="hint">· Ctrl+Enter to save</span></span>
          <input className="input" value={feedback} onChange={(e) => setFeedback(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
        </label>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy} title="Shortcut: Ctrl/Cmd + Enter">Save</button>
      </div>
    </article>
  );
}


function ShortAnswerClusterTab({ quiz, onUpdated, onShowSql }) {
  const toast = useToast();
  const [onlyUnaccepted, setOnlyUnaccepted] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const { data: rows, error, loading, reload } = useLoad(
    () => rpcAll('short_answer_groups', { p_quiz: quiz.id }),
    [quiz.id],
  );

  const groupedByQuestion = useMemo(() => {
    const map = new Map();
    for (const r of rows || []) {
      if (onlyUnaccepted && r.already_accepted && r.all_full_marks) continue;
      const g = map.get(r.question_id) || {
        question_id: r.question_id,
        qposition: r.qposition,
        prompt: r.prompt,
        max_marks: r.max_marks,
        accepted: Array.isArray(r.accepted) ? r.accepted : [],
        clusters: [],
      };
      g.clusters.push(r);
      map.set(r.question_id, g);
    }
    return [...map.values()];
  }, [rows, onlyUnaccepted]);

  async function acceptCluster(cluster) {
    const key = `${cluster.question_id}:${cluster.norm_answer}`;
    setBusyKey(key);
    try {
      const res = await rpc('accept_short_answer', {
        p_quiz: quiz.id,
        p_question: cluster.question_id,
        p_answer: cluster.sample_answer,
      });
      toast(`Accepted "${cluster.sample_answer}" — full marks awarded to ${res?.updated_count ?? cluster.student_count} student(s).`);
      await reload();
      onUpdated?.();
    } catch (e) {
      toast(e.message || 'Could not accept short answer.', 'error');
    } finally {
      setBusyKey('');
    }
  }

  if (loading) return <Loading label="Grouping student short answers…" />;
  if (error) {
    const missing = /short_answer_groups|Could not find|does not exist|schema cache/i.test(error);
    return (
      <div className="stack">
        <ErrorNote error={error} onRetry={reload} />
        {missing && (
          <div className="card row-wrap between">
            <span className="small muted">Install the Features SQL script in Supabase to activate Short-Answer Clustering.</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={onShowSql}>View Setup SQL</button>
          </div>
        )}
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="card">
        <Empty icon="check" title="No submitted short-answer responses yet">
          Grouped short-answer spellings will appear here as soon as students submit answers to short-answer questions.
        </Empty>
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 960 }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Identical or similarly spelled student responses are grouped automatically. Accept a valid spelling variation once to award full marks to everyone who wrote it.
        </p>
        <label className="check small">
          <input type="checkbox" checked={onlyUnaccepted} onChange={(e) => setOnlyUnaccepted(e.target.checked)} />
          Show unaccepted variations only
        </label>
      </div>

      {groupedByQuestion.length === 0 ? (
        <div className="card"><Empty icon="check" title="All variations reviewed">Switch off the filter to see accepted answers too.</Empty></div>
      ) : groupedByQuestion.map((q) => (
        <section key={q.question_id} className="card stack-sm">
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="eyebrow">Question · {fmtNumber(q.max_marks)} marks</span>
            <div className="row-wrap" style={{ gap: 6 }}>
              <span className="tiny muted">Accepted keys:</span>
              {(q.accepted || []).map((acc, idx) => (
                <span key={idx} className="badge badge-teal">{acc}</span>
              ))}
            </div>
          </div>
          <p className="pre" style={{ margin: '2px 0 8px' }}>{q.prompt}</p>
          <div className="stack-sm">
            {q.clusters.map((c) => {
              const key = `${c.question_id}:${c.norm_answer}`;
              const isBusy = busyKey === key;
              const isDone = c.already_accepted && c.all_full_marks;
              return (
                <div
                  key={key}
                  className="between"
                  style={{
                    flexWrap: 'wrap',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: isDone ? 'var(--teal-50)' : 'var(--surface-2)',
                    border: `1px solid ${isDone ? 'var(--teal)' : 'var(--line-2)'}`,
                  }}
                >
                  <div className="stack-sm" style={{ gap: 2, flex: 1, minWidth: 220 }}>
                    <div className="row-wrap" style={{ gap: 8 }}>
                      <span className="badge badge-blue">{c.student_count} student{c.student_count === 1 ? '' : 's'}</span>
                      <strong className="mono" style={{ fontSize: 14 }}>"{c.sample_answer}"</strong>
                    </div>
                    <span className="tiny muted">
                      Average awarded: {fmtNumber(c.avg_marks)} / {fmtNumber(q.max_marks)}
                      {c.already_accepted ? ' · matches accepted key' : ''}
                    </span>
                  </div>
                  {isDone ? (
                    <span className="badge badge-teal">✓ Accepted for all</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={isBusy || busyKey !== ''}
                      onClick={() => acceptCluster(c)}
                    >
                      {isBusy ? 'Awarding…' : `Accept for all (${c.student_count})`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
