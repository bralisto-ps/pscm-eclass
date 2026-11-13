import { useMemo, useState } from 'react';
import { rpc, rpcAll, run, supabase } from '../../../lib/supabase.js';
import { fmtNumber } from '../../../lib/format.js';
import { downloadWorkbook, downloadText, parseDelimited } from '../../../lib/sheets.js';
import { parseCourseMeta, serializeCourseMeta, computeStudentCA } from '../../../lib/courseMeta.js';
import Icon from '../../../components/Icon.jsx';
import { Confirm, Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from '../../../components/ui.jsx';
import { ALL_GROUPS, GroupFilters, groupLabel, matchesGroup } from '../../../components/Groups.jsx';
import PrintReportModal from '../../../components/PrintReportModal.jsx';
import { buildCAReportHtml } from '../../../lib/printReport.js';
import { SortSelect, SortTh } from '../../../components/SortBar.jsx';
import { byNameIndex, compareNumber, compareText } from '../../../lib/sort.js';

const KINDS = [
  { id: 'quizzes', label: 'Quizzes' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'manual', label: 'Marks I enter (e.g. mid-semester exam)' },
];

const kindLabel = (k) => ({ quizzes: 'Quizzes', assignments: 'Assignments', attendance: 'Attendance', manual: 'Entered marks' }[k] || k);

export const GRADE_THRESHOLDS = {
  'A': 80,
  'B+': 75,
  'B': 70,
  'C+': 65,
  'C': 60,
  'D+': 55,
  'D': 50,
};

export function getGradeLetter(score) {
  if (score === null || score === undefined || score === '') return '—';
  const n = Number(score);
  if (Number.isNaN(n)) return '—';
  if (n >= 80) return 'A';
  if (n >= 75) return 'B+';
  if (n >= 70) return 'B';
  if (n >= 65) return 'C+';
  if (n >= 60) return 'C';
  if (n >= 55) return 'D+';
  if (n >= 50) return 'D';
  return 'E';
}

export function getGradeRemarks(score) {
  if (score === null || score === undefined || score === '') return '—';
  const n = Number(score);
  if (Number.isNaN(n)) return '—';
  if (n >= 80) return 'Excellent';
  if (n >= 75) return 'Very Good';
  if (n >= 70) return 'Good';
  if (n >= 65) return 'Credit';
  if (n >= 60) return 'Credit';
  if (n >= 55) return 'Pass';
  if (n >= 50) return 'Pass';
  return 'Fail';
}

let tempId = 0;
const blank = (kind, weight) => ({
  key: `new-${++tempId}`,
  id: null,
  name: { quizzes: 'Quizzes', assignments: 'Assignments', attendance: 'Attendance', manual: 'Mid-semester exam' }[kind],
  kind,
  weight,
  item_ids: [],
  drop_lowest: 0,
  max_score: kind === 'manual' ? 100 : 100,
});

export default function CATab({ course, onCourseChanged }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [components, quizzes, assignments, rows, freshCourse] = await Promise.all([
      run(supabase.from('ca_components').select('*').eq('course_id', course.id).order('position').order('created_at')),
      run(supabase.from('quizzes').select('id, title').eq('course_id', course.id).eq('published', true).eq('is_practice', false).order('created_at')),
      run(supabase.from('assignments').select('id, title').eq('course_id', course.id).eq('published', true).order('created_at')),
      rpcAll('course_ca', { p_course: course.id }),
      run(supabase.from('courses').select('*').eq('id', course.id).maybeSingle()),
    ]);
    return {
      components: components.map((c) => ({ ...c, key: c.id })),
      quizzes,
      assignments,
      rows,
      course: freshCourse || course,
    };
  }, [course.id]);

  if (loading) return <Loading label="Working out CA scores…" />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  return <CAInner key={data.components.map((c) => c.id).join()} course={data.course} data={data} reload={reload} onCourseChanged={onCourseChanged} />;
}

function CAInner({ course, data, reload, onCourseChanged }) {
  const toast = useToast();
  const [act, busy] = useAction();
  const [comps, setComps] = useState(data.components);
  const [dirty, setDirty] = useState(false);
  const [settings, setSettings] = useState({ ca_total: course.ca_total ?? 40, ca_decimals: course.ca_decimals ?? 0 });
  const [picking, setPicking] = useState(null);
  const [entering, setEntering] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [examModal, setExamModal] = useState(false);
  const [printingReport, setPrintingReport] = useState(false);
  const [group, setGroup] = useState(ALL_GROUPS);
  const [q, setQ] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [sort, setSort] = useState('name_asc');

  // Course metadata (CA 1 & CA 2 split and final exam marks)
  const meta = useMemo(() => parseCourseMeta(course), [course]);
  const [caConfig, setCaConfig] = useState(meta.ca_config);
  const [examConfig, setExamConfig] = useState(meta.exam_config);

  const totalWeight = comps.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const weightOk = Math.abs(totalWeight - Number(settings.ca_total)) < 0.001;
  const saved = data.components;
  const dec = Number(course.ca_decimals ?? 0);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const enriched = data.rows.map((r) => {
      const { ca1, ca2, totalCa } = computeStudentCA(r, saved, caConfig, course.ca_total);
      const ex = examConfig.scores?.[r.index_no] !== undefined && examConfig.scores[r.index_no] !== ''
        ? Number(examConfig.scores[r.index_no])
        : null;
      const total100 = ex !== null ? Number((totalCa + ex).toFixed(dec)) : null;
      const grade = total100 !== null ? getGradeLetter(total100) : (totalCa >= 20 ? 'Pending' : 'At Risk');
      return { ...r, _ca1: ca1, _ca2: ca2, _totalCa: totalCa, _exam: ex, _total100: total100, _grade: grade };
    });

    const filtered = enriched.filter((r) => {
      if (!matchesGroup(r, group)) return false;
      if (gradeFilter === 'A' && r._grade !== 'A') return false;
      if (gradeFilter === 'B' && r._grade !== 'B+' && r._grade !== 'B') return false;
      if (gradeFilter === 'C' && r._grade !== 'C+' && r._grade !== 'C') return false;
      if (gradeFilter === 'D' && r._grade !== 'D+' && r._grade !== 'D') return false;
      if (gradeFilter === 'E' && r._grade !== 'E' && r._grade !== 'At Risk') return false;
      if (gradeFilter === 'ca_pass' && r._totalCa < 20) return false;
      if (gradeFilter === 'ca_risk' && r._totalCa >= 20) return false;
      if (term) {
        const hay = [r.full_name, r.index_no, r.programme, r.stream].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'total100_desc': return compareNumber(a._total100, b._total100, 'desc') || compareNumber(a._totalCa, b._totalCa, 'desc') || byNameIndex(a, b);
        case 'total100_asc': return compareNumber(a._total100, b._total100, 'asc') || compareNumber(a._totalCa, b._totalCa, 'asc') || byNameIndex(a, b);
        case 'ca_desc': return compareNumber(a._totalCa, b._totalCa, 'desc') || byNameIndex(a, b);
        case 'ca_asc': return compareNumber(a._totalCa, b._totalCa, 'asc') || byNameIndex(a, b);
        case 'ca1_desc': return compareNumber(a._ca1, b._ca1, 'desc') || byNameIndex(a, b);
        case 'ca1_asc': return compareNumber(a._ca1, b._ca1, 'asc') || byNameIndex(a, b);
        case 'ca2_desc': return compareNumber(a._ca2, b._ca2, 'desc') || byNameIndex(a, b);
        case 'ca2_asc': return compareNumber(a._ca2, b._ca2, 'asc') || byNameIndex(a, b);
        case 'exam_desc': return compareNumber(a._exam, b._exam, 'desc') || byNameIndex(a, b);
        case 'exam_asc': return compareNumber(a._exam, b._exam, 'asc') || byNameIndex(a, b);
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
  }, [data.rows, saved, caConfig, course.ca_total, examConfig, dec, group, gradeFilter, q, sort]);

  const hasFilters = Boolean(q.trim() || gradeFilter !== 'all' || group.programme !== '*' || group.stream !== '*' || sort !== 'name_asc');
  function clearFilters() {
    setQ('');
    setGradeFilter('all');
    setGroup(ALL_GROUPS);
    setSort('name_asc');
  }

  const avg = rows.length ? rows.reduce((s, r) => s + Number(r.total), 0) / rows.length : null;
  const change = (key, patch) => { setComps(comps.map((c) => (c.key === key ? { ...c, ...patch } : c))); setDirty(true); };
  const add = (kind) => { setComps([...comps, blank(kind, 0)]); setDirty(true); };

  function useTemplate() {
    setComps([blank('quizzes', 15), blank('assignments', 10), blank('attendance', 5), blank('manual', 10)]);
    setSettings({ ...settings, ca_total: 40 });
    setDirty(true);
  }

  // Update bucket for a component
  function setComponentBucket(cid, bucket) {
    const next1 = new Set(caConfig.ca1_components || []);
    const next2 = new Set(caConfig.ca2_components || []);
    if (bucket === 'ca1') {
      next1.add(cid);
      next2.delete(cid);
    } else {
      next2.add(cid);
      next1.delete(cid);
    }
    const updated = {
      ...caConfig,
      ca1_components: [...next1],
      ca2_components: [...next2],
    };
    setCaConfig(updated);
    setDirty(true);
  }

  function getComponentBucket(c, index) {
    if (caConfig.ca1_components?.includes(c.id)) return 'ca1';
    if (caConfig.ca2_components?.includes(c.id)) return 'ca2';
    // Fallback default
    if (c.kind === 'quizzes' || index === 0) return 'ca1';
    return 'ca2';
  }

  async function save() {
    for (const c of comps) {
      if (!String(c.name).trim()) throw new Error('Give every part a name.');
      if (c.kind === 'manual' && !(Number(c.max_score) > 0)) throw new Error(`Set what "${c.name}" is marked out of.`);
    }

    // Save description with serialized metadata
    const serialized = serializeCourseMeta(meta.about, caConfig, examConfig);

    await run(
      supabase.from('courses').update({
        ca_total: Number(settings.ca_total) || 40,
        ca_decimals: Number(settings.ca_decimals),
        description: serialized,
      }).eq('id', course.id)
    );

    const keep = new Set(comps.filter((c) => c.id).map((c) => c.id));
    const gone = saved.filter((c) => !keep.has(c.id)).map((c) => c.id);
    if (gone.length) await run(supabase.from('ca_components').delete().in('id', gone));
    const row = (c, i) => ({
      course_id: course.id, name: String(c.name).trim(), kind: c.kind, weight: Number(c.weight) || 0,
      item_ids: c.item_ids || [], drop_lowest: Number(c.drop_lowest) || 0, max_score: Number(c.max_score) || 100, position: i,
    });
    for (const [i, c] of comps.entries()) {
      if (c.id) await run(supabase.from('ca_components').update(row(c, i)).eq('id', c.id));
      else await run(supabase.from('ca_components').insert(row(c, i)));
    }
    setDirty(false);
    onCourseChanged?.();
    reload();
    return true;
  }

  async function toggleRelease() {
    const next = !course.ca_released;
    const ok = await act(() => run(supabase.from('courses').update({ ca_released: next }).eq('id', course.id)),
      next ? 'Students can now see their CA.' : 'CA hidden from students.');
    if (ok !== undefined) onCourseChanged?.();
  }

  // 1-Click Official Grade Sheet Export with 2 CA columns (CA 1 + CA 2 = 40) and Final Exam (/60)
  function exportOfficialXlsx() {
    const w1 = caConfig.ca1_weight || 20;
    const w2 = caConfig.ca2_weight || 20;

    const header = [
      'S/N',
      'Index Number',
      'Student Name',
      'Programme',
      'Stream',
      `CA 1 (/${w1})`,
      `CA 2 (/${w2})`,
      'Total CA (/40)',
      'Final Exam (/60)',
      'Total Score (/100)',
      'Grade',
      'Remarks',
    ];

    const widths = [6, 16, 32, 20, 14, 14, 14, 15, 16, 16, 10, 16];

    const buildLine = (r, idx) => {
      const { ca1, ca2, totalCa } = computeStudentCA(r, saved, caConfig, course.ca_total);
      const ex = examConfig.scores?.[r.index_no] !== undefined && examConfig.scores[r.index_no] !== ''
        ? Number(examConfig.scores[r.index_no])
        : null;

      const total100 = ex !== null ? Number((totalCa + ex).toFixed(dec || 1)) : null;
      const grade = total100 !== null ? getGradeLetter(total100) : (totalCa >= 20 ? 'Pending Exam' : 'At Risk (<20)');
      const remarks = total100 !== null ? getGradeRemarks(total100) : (totalCa < 20 ? 'At Risk (<50% CA)' : 'Good Standing');

      return [
        idx + 1,
        r.index_no,
        r.full_name,
        r.programme || '',
        r.stream || '',
        ca1,
        ca2,
        totalCa,
        ex !== null ? ex : '',
        total100 !== null ? total100 : '',
        grade,
        remarks,
      ];
    };

    const sheets = [
      {
        name: 'Master Grade Sheet (CA1-CA2)',
        rows: [
          header,
          ...data.rows.map((r, i) => buildLine(r, i)),
        ],
        widths,
      },
    ];

    // Detailed components breakdown sheet
    const detailHeader = [
      'Index Number',
      'Student Name',
      'Stream',
      ...saved.map((c) => `${c.name} (/${fmtNumber(c.weight)})`),
      `CA 1 (/${w1})`,
      `CA 2 (/${w2})`,
      'Total CA (/40)',
    ];
    const detailWidths = [16, 30, 14, ...saved.map(() => 16), 14, 14, 15];
    sheets.push({
      name: 'CA Components Breakdown',
      rows: [
        detailHeader,
        ...data.rows.map((r) => {
          const { ca1, ca2, totalCa } = computeStudentCA(r, saved, caConfig, course.ca_total);
          return [
            r.index_no,
            r.full_name,
            r.stream || '',
            ...saved.map((c) => Number(r.parts?.[c.id]?.points ?? 0)),
            ca1,
            ca2,
            totalCa,
          ];
        }),
      ],
      widths: detailWidths,
    });

    // Per-stream sheets
    const streams = [...new Set(data.rows.map((r) => r.stream || ''))].filter(Boolean).sort();
    if (streams.length > 0) {
      streams.forEach((st) => {
        const streamRows = data.rows.filter((r) => (r.stream || '') === st);
        sheets.push({
          name: groupLabel(st).slice(0, 31),
          rows: [
            header,
            ...streamRows.map((r, i) => buildLine(r, i)),
          ],
          widths,
        });
      });
    }

    // Summary Sheet
    sheets.push({
      name: 'Grading Scale & Distribution',
      rows: [
        ['OFFICIAL DEPARTMENTAL ASSESSMENT STRUCTURE', '', '', ''],
        ['Continuous Assessment Column 1 (CA 1)', `${w1}%`, 'Assigned Coursework / Quizzes', ''],
        ['Continuous Assessment Column 2 (CA 2)', `${w2}%`, 'Assigned Mid-Sem / Assignments / Attendance', ''],
        ['Total Continuous Assessment', '40%', 'Sum of CA 1 and CA 2', ''],
        ['Final Examination', '60%', 'Semester Examination / Exams Office Entry', ''],
        ['Total Score', '100%', 'Total CA (40%) + Final Exam (60%)', ''],
        ['', '', '', ''],
        ['Grade Scale', 'Score Range', 'Remarks', 'Status'],
        ['A', '80.00% – 100.00%', 'Excellent', 'Pass'],
        ['B+', '75.00% – 79.99%', 'Very Good', 'Pass'],
        ['B', '70.00% – 74.99%', 'Good', 'Pass'],
        ['C+', '65.00% – 69.99%', 'Credit', 'Pass'],
        ['C', '60.00% – 64.99%', 'Credit', 'Pass'],
        ['D+', '55.00% – 59.99%', 'Pass', 'Pass'],
        ['D', '50.00% – 54.99%', 'Pass (Lowest Pass)', 'Pass'],
        ['E', '0.00% – 49.99%', 'Fail', 'Fail (<50%)'],
      ],
      widths: [26, 22, 42, 16],
    });

    downloadWorkbook(`${course.code}_Departmental_Grade_Sheet_CA1_CA2_Exam.xlsx`, sheets);
  }

  // 1-Click Departmental CSV Export with CA 1 and CA 2
  function exportOfficialCsv() {
    const w1 = caConfig.ca1_weight || 20;
    const w2 = caConfig.ca2_weight || 20;
    const header = ['S/N', 'Index Number', 'Student Name', 'Programme', 'Stream', `CA_1_${w1}`, `CA_2_${w2}`, 'Total_CA_40', 'Exam_60', 'Total_100', 'Grade', 'Remarks'];

    const lines = data.rows.map((r, i) => {
      const { ca1, ca2, totalCa } = computeStudentCA(r, saved, caConfig, course.ca_total);
      const ex = examConfig.scores?.[r.index_no] !== undefined && examConfig.scores[r.index_no] !== ''
        ? Number(examConfig.scores[r.index_no])
        : '';
      const total100 = ex !== '' ? Number((totalCa + Number(ex)).toFixed(dec || 1)) : '';
      const grade = total100 !== '' ? getGradeLetter(total100) : '';
      const remarks = total100 !== '' ? getGradeRemarks(total100) : (totalCa < 20 ? 'At Risk (<50% CA)' : 'Good Standing');
      return [
        i + 1,
        `"${r.index_no}"`,
        `"${r.full_name}"`,
        `"${r.programme || ''}"`,
        `"${r.stream || ''}"`,
        ca1,
        ca2,
        totalCa,
        ex,
        total100,
        grade,
        remarks,
      ].join(',');
    });

    downloadText(`${course.code}_Departmental_Grade_Sheet_CA1_CA2_Exam.csv`, [header.join(','), ...lines].join('\n'), 'text/csv');
  }

  const itemsFor = (c) => (c.kind === 'quizzes' ? data.quizzes : data.assignments);

  return (
    <div className="stack-lg" style={{ maxWidth: 1180 }}>
      {/* Official 2-Column CA + Final Exam Banner */}
      <div className="card-soft between" style={{ padding: '16px 20px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, flexWrap: 'wrap', gap: 14 }}>
        <div className="stack-sm" style={{ gap: 4 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="badge badge-teal" style={{ fontWeight: 700 }}>Departmental Dual-CA Format</span>
            <span className="small strong">CA 1 ({caConfig.ca1_weight}) + CA 2 ({caConfig.ca2_weight}) = CA Total (40) · Exam (60) = 100</span>
          </div>
          <p className="small muted">
            Generates 2 separate CA columns directly compatible with the school's exam platform submission format. The sum of CA 1 and CA 2 is shown to students as their CA score.
          </p>
        </div>
        <div className="row-wrap">
          <button type="button" className={`btn btn-sm ${examConfig.released ? 'btn-primary' : ''}`} onClick={() => setExamModal(true)} title="Enter marks or release full exam scores to students">
            <Icon name="edit" size={15} /> {examConfig.released ? 'Exam Scores (Released ✓)' : 'Enter/Release Exam (/60)'}
          </button>
          <button type="button" className="btn btn-sm" onClick={exportOfficialCsv} title="Download 2-CA CSV for Registrar / SIS upload">
            <Icon name="download" size={15} /> Export CSV
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={exportOfficialXlsx} title="Download official multi-sheet Excel gradebook with CA1 and CA2">
            <Icon name="download" size={15} /> Export Grade Sheet (Excel)
          </button>
        </div>
      </div>

      {/* CA Configuration Section */}
      <section className="card stack">
        <div className="between" style={{ flexWrap: 'wrap' }}>
          <div className="stack-sm" style={{ gap: 2 }}>
            <h2>How CA (40%) is worked out</h2>
            <p className="small muted">Assign components to <strong>CA 1</strong> and <strong>CA 2</strong> to match the school's submission columns.</p>
          </div>
          <div className="row-wrap">
            <label className="row small" style={{ gap: 6 }}>CA 1 Target
              <input className="input" type="number" min="1" max="39" style={{ width: 70, minHeight: 38 }} value={caConfig.ca1_weight}
                onChange={(e) => {
                  const val = Number(e.target.value) || 20;
                  setCaConfig({ ...caConfig, ca1_weight: val, ca2_weight: 40 - val });
                  setDirty(true);
                }} />
            </label>
            <label className="row small" style={{ gap: 6 }}>CA 2 Target
              <input className="input" type="number" min="1" max="39" style={{ width: 70, minHeight: 38 }} value={caConfig.ca2_weight}
                onChange={(e) => {
                  const val = Number(e.target.value) || 20;
                  setCaConfig({ ...caConfig, ca2_weight: val, ca1_weight: 40 - val });
                  setDirty(true);
                }} />
            </label>
            <label className="row small" style={{ gap: 6 }}>Round to
              <select className="select" style={{ width: 'auto', minHeight: 38 }} value={settings.ca_decimals}
                onChange={(e) => { setSettings({ ...settings, ca_decimals: e.target.value }); setDirty(true); }}>
                <option value={0}>whole marks</option><option value={1}>1 decimal</option><option value={2}>2 decimals</option>
              </select>
            </label>
          </div>
        </div>

        {comps.length === 0 && (
          <div className="notice notice-info row-wrap">
            <span style={{ flex: 1 }}>No components yet. Start from a typical 40-mark split and adjust.</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={useTemplate}>Use standard template</button>
          </div>
        )}

        {comps.map((c, i) => {
          const currentBucket = getComponentBucket(c, i);
          return (
            <div key={c.key} className="row-wrap" style={{ alignItems: 'flex-end', padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 10, gap: 10 }}>
              <span className="mono strong" style={{ alignSelf: 'center', width: 18 }}>{i + 1}</span>
              <div style={{ flex: '2 1 180px' }}><Field label="Name"><input className="input" value={c.name} onChange={(e) => change(c.key, { name: e.target.value })} /></Field></div>
              <div style={{ flex: '2 1 180px' }}>
                <Field label="Counts">
                  <select className="select" value={c.kind} onChange={(e) => change(c.key, { kind: e.target.value, item_ids: [] })}>
                    {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ width: 85 }}><Field label="Weight"><input className="input mono" type="number" min="0" step="0.5" value={c.weight} onChange={(e) => change(c.key, { weight: e.target.value })} /></Field></div>
              <div style={{ width: 140 }}>
                <Field label="School Platform Column">
                  <select
                    className="select"
                    value={currentBucket}
                    onChange={(e) => setComponentBucket(c.id, e.target.value)}
                    style={{ fontWeight: 600, color: currentBucket === 'ca1' ? 'var(--teal-dark)' : 'var(--blue-ink)' }}
                  >
                    <option value="ca1">CA 1 (/{caConfig.ca1_weight})</option>
                    <option value="ca2">CA 2 (/{caConfig.ca2_weight})</option>
                  </select>
                </Field>
              </div>

              {(c.kind === 'quizzes' || c.kind === 'assignments') && (
                <>
                  <button type="button" className="btn btn-sm" style={{ minHeight: 44 }} onClick={() => setPicking(c.key)}>
                    {c.item_ids.length ? `${c.item_ids.length} chosen` : `All ${c.kind}`} <Icon name="edit" size={14} />
                  </button>
                  <div style={{ width: 100 }}><Field label="Drop lowest"><input className="input mono" type="number" min="0" value={c.drop_lowest} onChange={(e) => change(c.key, { drop_lowest: e.target.value })} /></Field></div>
                </>
              )}
              {c.kind === 'manual' && (
                <>
                  <div style={{ width: 110 }}><Field label="Marked out of"><input className="input mono" type="number" min="1" value={c.max_score} onChange={(e) => change(c.key, { max_score: e.target.value })} /></Field></div>
                  <button type="button" className="btn btn-sm" style={{ minHeight: 44 }} disabled={!c.id || dirty}
                    title={!c.id || dirty ? 'Save the setup first' : ''} onClick={() => setEntering(c)}>Enter marks</button>
                </>
              )}
              <button type="button" className="icon-btn plain" style={{ marginBottom: 2 }} aria-label={`Remove ${c.name}`} onClick={() => setRemoving(c)}><Icon name="trash" /></button>
            </div>
          );
        })}

        <div className="between" style={{ flexWrap: 'wrap' }}>
          <div className="row-wrap">
            <span className="small muted">Add component:</span>
            {KINDS.map((k) => <button key={k.id} type="button" className="btn btn-sm" onClick={() => add(k.id)}><Icon name="plus" size={14} /> {kindLabel(k.id)}</button>)}
          </div>
          <div className="row-wrap">
            <span className={`badge ${weightOk ? 'badge-teal' : 'badge-amber'}`}>Weights add up to {fmtNumber(totalWeight)} of {fmtNumber(settings.ca_total)}</span>
            {dirty && <span className="badge badge-amber">Unsaved changes</span>}
            <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => act(save, 'CA and column setup saved.')}>Save setup</button>
          </div>
        </div>
      </section>

      {/* Grade Table Section */}
      <section className="card-flush">
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="row-wrap" style={{ flex: 1, minWidth: 260 }}>
            <h2>Dual-CA & Final Exam Gradebook</h2>
            <label className="search">
              <span className="sr-only">Search</span>
              <Icon name="search" size={16} />
              <input className="input" style={{ width: 220, minHeight: 40 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, index, programme, stream" />
            </label>
            <GroupFilters rows={data.rows} value={group} onChange={setGroup} />
            <label className="row small" style={{ gap: 6 }}>
              <span className="muted">Standing</span>
              <select
                aria-label="Filter by grade or CA standing"
                className="select"
                style={{ minHeight: 40, width: 'auto', fontSize: 13 }}
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
              >
                <option value="all">All grades</option>
                <option value="A">Grade A (80–100)</option>
                <option value="B">Grade B+ / B (70–79)</option>
                <option value="C">Grade C+ / C (60–69)</option>
                <option value="D">Grade D+ / D (50–59)</option>
                <option value="E">Grade E / At Risk (&lt; 50)</option>
                <option value="ca_pass">CA ≥ 20 / 40</option>
                <option value="ca_risk">CA &lt; 20 / 40 (At Risk)</option>
              </select>
            </label>
            <SortSelect
              value={sort}
              onChange={setSort}
              options={[
                { value: 'ca_desc', label: 'Total CA: High → Low' },
                { value: 'ca_asc', label: 'Total CA: Low → High' },
                { value: 'total100_desc', label: 'Final Total (/100): High → Low' },
                { value: 'total100_asc', label: 'Final Total (/100): Low → High' },
                { value: 'ca1_desc', label: 'CA 1: High → Low' },
                { value: 'ca2_desc', label: 'CA 2: High → Low' },
                { value: 'exam_desc', label: 'Exam (/60): High → Low' },
                { value: 'exam_asc', label: 'Exam (/60): Low → High' },
                { value: 'name_asc', label: 'Name (A → Z)' },
                { value: 'name_desc', label: 'Name (Z → A)' },
                { value: 'index_asc', label: 'Index no. (Ascending)' },
                { value: 'index_desc', label: 'Index no. (Descending)' },
                { value: 'prog_asc', label: 'Programme / Class (A → Z)' },
                { value: 'stream_asc', label: 'Stream (A → Z)' },
              ]}
            />
          </div>
          <div className="row-wrap">
            {avg !== null && <span className="small muted">Class CA Avg: {fmtNumber(avg, 1)} / 40</span>}
            <button type="button" className="btn btn-sm" onClick={() => setPrintingReport(true)} disabled={!saved.length}><Icon name="file" size={16} /> Print / PDF Sign-Off</button>
            <button type="button" className="btn btn-sm" onClick={exportOfficialXlsx} disabled={!saved.length}><Icon name="download" size={16} /> Export Excel (CA 1 & 2)</button>
            <button type="button" className={`btn btn-sm ${course.ca_released ? '' : 'btn-primary'}`} onClick={toggleRelease} disabled={!saved.length}>
              {course.ca_released ? 'Hide CA from students' : 'Show CA to students'}
            </button>
          </div>
        </div>
        {hasFilters && data.rows.length > 0 && (
          <div className="filter-meta">
            <span className="muted">Showing <strong>{rows.length}</strong> of {data.rows.length} student{data.rows.length === 1 ? '' : 's'}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={clearFilters}>Reset filters &amp; sort</button>
          </div>
        )}

        {saved.length === 0 ? <Empty icon="chart" title="Set up the CA first">Add the parts above and save. Scores appear here straight away.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortTh label="Index no." ascKey="index_asc" descKey="index_desc" current={sort} onSort={setSort} />
                  <SortTh label="Name" ascKey="name_asc" descKey="name_desc" current={sort} onSort={setSort} />
                  <SortTh label="Group" ascKey="prog_asc" descKey="prog_desc" current={sort} onSort={setSort} className="hide-sm" />
                  <SortTh label="CA 1" sub={<div className="tiny" style={{ textTransform: 'none' }}>/ {caConfig.ca1_weight || 20}</div>} ascKey="ca1_asc" descKey="ca1_desc" defaultDir="desc" current={sort} onSort={setSort} className="num" style={{ color: 'var(--teal-dark)' }} />
                  <SortTh label="CA 2" sub={<div className="tiny" style={{ textTransform: 'none' }}>/ {caConfig.ca2_weight || 20}</div>} ascKey="ca2_asc" descKey="ca2_desc" defaultDir="desc" current={sort} onSort={setSort} className="num" style={{ color: 'var(--blue-ink)' }} />
                  <SortTh label="Total CA" sub={<div className="tiny" style={{ textTransform: 'none' }}>/ 40</div>} ascKey="ca_asc" descKey="ca_desc" defaultDir="desc" current={sort} onSort={setSort} className="num strong" />
                  <SortTh label="Exam" sub={<div className="tiny" style={{ textTransform: 'none' }}>/ 60</div>} ascKey="exam_asc" descKey="exam_desc" defaultDir="desc" current={sort} onSort={setSort} className="num" />
                  <SortTh label="Total" sub={<div className="tiny" style={{ textTransform: 'none' }}>/ 100</div>} ascKey="total100_asc" descKey="total100_desc" defaultDir="desc" current={sort} onSort={setSort} className="num" />
                  <SortTh label="Grade" ascKey="total100_asc" descKey="total100_desc" defaultDir="desc" current={sort} onSort={setSort} />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map((r) => {
                  const ca1 = r._ca1;
                  const ca2 = r._ca2;
                  const totalCa = r._totalCa;
                  const ex = r._exam;
                  const total100 = r._total100;
                  const grade = r._grade;

                  return (
                    <tr key={r.index_no}>
                      <td className="mono small">{r.index_no}</td>
                      <td>{r.full_name}</td>
                      <td className="small muted hide-sm">{[r.programme, r.stream].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="num mono" style={{ color: 'var(--teal-dark)' }}>{ca1.toFixed(dec)}</td>
                      <td className="num mono" style={{ color: 'var(--blue-ink)' }}>{ca2.toFixed(dec)}</td>
                      <td className="num strong" style={{ color: totalCa < 20 ? 'var(--red-ink)' : 'inherit' }}>
                        {totalCa.toFixed(dec)}
                      </td>
                      <td className="num mono small muted">
                        {ex !== null ? ex.toFixed(dec) : '—'}
                      </td>
                      <td className="num strong">
                        {total100 !== null ? total100.toFixed(dec) : '—'}
                      </td>
                      <td>
                        <span className={`badge ${
                          grade === 'A' ? 'badge-teal' :
                          grade === 'B+' || grade === 'B' ? 'badge-blue' :
                          grade === 'C+' || grade === 'C' ? 'badge-amber' :
                          grade === 'D+' || grade === 'D' ? 'badge' :
                          grade === 'E' || grade === 'At Risk' ? 'badge-red' : ''
                        }`}>
                          {grade}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 400 && <p className="small muted" style={{ padding: '12px 18px' }}>Showing 400 of {rows.length}. Export to Excel for everyone.</p>}
            {rows.length === 0 && <Empty>No students match.</Empty>}
          </div>
        )}
      </section>

      {picking && (() => {
        const c = comps.find((x) => x.key === picking);
        return <PickItems comp={c} items={itemsFor(c)} onClose={() => setPicking(null)} onSave={(ids) => { change(c.key, { item_ids: ids }); setPicking(null); }} />;
      })()}

      {entering && <ManualMarks comp={entering} course={course} onClose={() => setEntering(null)} onSaved={() => { toast('Marks saved.'); reload(); }} />}

      {removing && (
        <Confirm title={`Remove “${removing.name}”?`} danger confirmLabel="Remove"
          message={removing.kind === 'manual' ? 'Any marks entered for this part are deleted when you save.' : 'It stops counting towards the CA when you save.'}
          onClose={() => setRemoving(null)} onConfirm={() => { setComps(comps.filter((c) => c.key !== removing.key)); setDirty(true); setRemoving(null); }} />
      )}

      {printingReport && (
        <PrintReportModal
          title={`CA & Exam Sign-Off Sheet · ${course.code}`}
          html={buildCAReportHtml({
            course,
            rows,
            caConfig,
            dec,
            getGradeLetter,
            getGradeRemarks,
            groupLabelText: [
              group.programme !== '*' ? (group.programme || 'Not set') : '',
              group.stream !== '*' ? (group.stream || 'Not set') : '',
              gradeFilter !== 'all' ? `Standing: ${gradeFilter}` : '',
            ].filter(Boolean).join(' · '),
          })}
          onClose={() => setPrintingReport(false)}
        />
      )}
      {examModal && (
        <ExamReleaseModal
          course={course}
          data={data}
          dec={dec}
          savedComponents={saved}
          caConfig={caConfig}
          examConfig={examConfig}
          onSave={async (updatedExamConfig) => {
            setExamConfig(updatedExamConfig);
            const serialized = serializeCourseMeta(meta.about, caConfig, updatedExamConfig);
            await run(supabase.from('courses').update({ description: serialized }).eq('id', course.id));
            toast(updatedExamConfig.released ? 'Final exam scores released to students!' : 'Exam marks saved.');
            reload();
          }}
          onClose={() => setExamModal(false)}
          onExport={exportOfficialXlsx}
        />
      )}
    </div>
  );
}

function PickItems({ comp, items, onClose, onSave }) {
  const [all, setAll] = useState(comp.item_ids.length === 0);
  const [ids, setIds] = useState(new Set(comp.item_ids));
  return (
    <Modal title={`Which ${comp.kind} count?`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!all && ids.size === 0} onClick={() => onSave(all ? [] : [...ids])}>Done</button></>}>
      <label className="check"><input type="radio" checked={all} onChange={() => setAll(true)} /> <span><strong>All published {comp.kind}</strong>, including ones you add later</span></label>
      <label className="check"><input type="radio" checked={!all} onChange={() => setAll(false)} /> <strong>Only these:</strong></label>
      <div className="stack-sm" style={{ paddingLeft: 28, opacity: all ? 0.5 : 1 }}>
        {items.length === 0 && <span className="small muted">None published yet.</span>}
        {items.map((it) => (
          <label key={it.id} className="check">
            <input type="checkbox" disabled={all} checked={ids.has(it.id)} onChange={(e) => {
              const n = new Set(ids); if (e.target.checked) n.add(it.id); else n.delete(it.id); setIds(n);
            }} /> {it.title}
          </label>
        ))}
      </div>
    </Modal>
  );
}

function ManualMarks({ comp, course, onClose, onSaved }) {
  const { data, error, loading } = useLoad(async () => {
    const [students, scores] = await Promise.all([
      rpcAll('course_students', { p_course: course.id }),
      run(supabase.from('ca_scores').select('index_no, score').eq('component_id', comp.id)),
    ]);
    return { students, scores: Object.fromEntries(scores.map((s) => [s.index_no, String(s.score)])) };
  }, [comp.id]);
  const [edits, setEdits] = useState({});
  const [q, setQ] = useState('');
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Modal title={comp.name} onClose={onClose}><Loading /></Modal>;
  if (error) return <Modal title={comp.name} onClose={onClose}><ErrorNote error={error} /></Modal>;

  const value = (idx) => (idx in edits ? edits[idx] : data.scores[idx] ?? '');
  const shown = data.students.filter((s) => !q.trim() || s.full_name.toLowerCase().includes(q.toLowerCase()) || s.index_no.toLowerCase().includes(q.toLowerCase()));
  const max = Number(comp.max_score);

  function applyPaste() {
    const rows = parseDelimited(paste);
    const known = new Set(data.students.map((s) => s.index_no.toUpperCase()));
    const next = { ...edits };
    let n = 0; let unknown = 0;
    for (const r of rows) {
      const idx = String(r[0] || '').trim().toUpperCase().replace(/\s+/g, '');
      const sc = String(r[r.length - 1] || '').trim();
      if (!idx || Number.isNaN(Number(sc)) || sc === '') continue;
      if (!known.has(idx)) { unknown++; continue; }
      next[idx] = sc; n++;
    }
    setEdits(next);
    setPaste('');
    setMsg(`${n} marks filled in${unknown ? `, ${unknown} index numbers not on this course were skipped` : ''}. Press Save to keep them.`);
  }

  async function save() {
    const rows = Object.entries(edits).map(([index_no, score]) => ({ index_no, score: String(score).trim() }));
    const badRow = rows.find((r) => r.score !== '' && (Number.isNaN(Number(r.score)) || Number(r.score) < 0 || Number(r.score) > max));
    if (badRow) return setMsg(`${badRow.index_no}: marks must be between 0 and ${max}.`);
    setBusy(true);
    try {
      for (let i = 0; i < rows.length; i += 500) await rpc('save_ca_scores', { p_component: comp.id, p_rows: rows.slice(i, i + 500) });
      onSaved();
      onClose();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const changed = Object.keys(edits).length;
  return (
    <Modal title={`${comp.name} · marks out of ${fmtNumber(max)}`} onClose={onClose} wide
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !changed}>{busy ? 'Saving…' : `Save ${changed || ''} mark${changed === 1 ? '' : 's'}`}</button></>}>
      <Field label="Paste from Excel" hint="two columns: index number and mark">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <textarea className="textarea mono" style={{ minHeight: 70 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'4021180\t24\n4021214\t19.5'} />
          <button type="button" className="btn btn-sm" disabled={!paste.trim()} onClick={applyPaste}>Fill in</button>
        </div>
      </Field>
      {msg && <div className="notice notice-info">{msg}</div>}
      <label className="search">
        <span className="sr-only">Search</span>
        <Icon name="search" size={16} />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a student" />
      </label>
      <div className="card-flush" style={{ maxHeight: 380, overflowY: 'auto' }}>
        {shown.slice(0, 300).map((s) => (          <div key={s.index_no} className="list-row" style={{ padding: '6px 14px' }}>
            <span className="mono small" style={{ width: 130 }}>{s.index_no}</span>
            <span className="list-main"><span className="title small">{s.full_name}</span></span>
            <input className="input mono" style={{ width: 100, minHeight: 38, borderColor: s.index_no in edits ? 'var(--teal)' : undefined }}
              aria-label={`Mark for ${s.full_name}`} inputMode="decimal" value={value(s.index_no)}
              onChange={(e) => setEdits({ ...edits, [s.index_no]: e.target.value })} />
          </div>
        ))}
      </div>
      {shown.length > 300 && <span className="tiny muted">Showing 300 — search for others, or paste from Excel.</span>}
    </Modal>
  );
}

// Modal for Entering Final Exam Marks (/60) and Toggling Student Visibility
function ExamReleaseModal({ course, data, dec, savedComponents, caConfig, examConfig, onSave, onClose, onExport }) {
  const [scores, setScores] = useState(() => ({ ...(examConfig.scores || {}) }));
  const [released, setReleased] = useState(Boolean(examConfig.released));
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  function applyPaste() {
    const lines = parseDelimited(paste);
    const known = new Set(data.rows.map((r) => r.index_no.toUpperCase()));
    const next = { ...scores };
    let n = 0; let skipped = 0;
    for (const l of lines) {
      const idx = String(l[0] || '').trim().toUpperCase().replace(/\s+/g, '');
      const sc = String(l[l.length - 1] || '').trim();
      if (!idx || Number.isNaN(Number(sc)) || sc === '') continue;
      if (!known.has(idx)) { skipped++; continue; }
      next[idx] = sc; n++;
    }
    setScores(next);
    setPaste('');
    setMsg(`${n} exam marks filled in out of 60${skipped ? `, ${skipped} unrecognized index numbers skipped` : ''}.`);
  }

  const calculated = data.rows.map((r) => {
    const { ca1, ca2, totalCa } = computeStudentCA(r, savedComponents, caConfig, course.ca_total);
    const ex = scores[r.index_no] !== undefined && scores[r.index_no] !== '' ? Number(scores[r.index_no]) : null;
    const total = ex !== null ? totalCa + ex : null;
    return {
      index_no: r.index_no,
      full_name: r.full_name,
      stream: r.stream,
      ca1,
      ca2,
      totalCa,
      ex,
      total,
      grade: total !== null ? getGradeLetter(total) : '—',
    };
  });

  const filledCount = calculated.filter((c) => c.ex !== null).length;
  const avgTotal = filledCount ? calculated.filter((c) => c.total !== null).reduce((s, c) => s + c.total, 0) / filledCount : null;
  const passCount = calculated.filter((c) => c.total !== null && c.total >= 50).length;
  const passRate = filledCount ? Math.round((passCount / filledCount) * 100) : null;

  const dist = { 'A': 0, 'B+': 0, 'B': 0, 'C+': 0, 'C': 0, 'D+': 0, 'D': 0, 'E': 0 };
  calculated.forEach((c) => {
    if (c.grade && dist[c.grade] !== undefined) dist[c.grade]++;
  });

  const shown = calculated.filter((c) => !q.trim() || c.full_name.toLowerCase().includes(q.toLowerCase()) || c.index_no.toLowerCase().includes(q.toLowerCase()));

  async function handleSave() {
    setBusy(true);
    try {
      await onSave({
        released,
        max_score: 60,
        scores,
      });
      onClose();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Final Exam Marks (/60) & Student Portal Release · ${course.code}`} onClose={onClose} wide
      footer={
        <div className="between" style={{ width: '100%', flexWrap: 'wrap', gap: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="small strong">{filledCount} of {data.rows.length} exam marks</span>
            {released && <span className="badge badge-teal">Visible to Students ✓</span>}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={busy}>
              {busy ? 'Saving…' : 'Save Marks & Status'}
            </button>
          </div>
        </div>
      }>
      <div className="stack">
        {/* Release Status Box */}
        <div className={`notice ${released ? 'notice-info' : 'notice-warn'} between`} style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <strong>Student Portal Visibility:</strong>{' '}
            {released
              ? 'Final Exam marks and overall letter grades (A, B+, B...) are currently VISIBLE to students on their portal.'
              : 'Final Exam marks and overall letter grades are currently HIDDEN from students (only CA is visible).'}
          </div>
          <button
            type="button"
            className={`btn btn-sm ${released ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => setReleased(!released)}
          >
            {released ? 'Hide Exam from Students' : 'Release Exam to Students Now'}
          </button>
        </div>

        {/* Live KPI bar */}
        <div className="grid-3">
          <div className="kpi">
            <span className="l">Exam Marks Entered</span>
            <span className="v">{filledCount} / {data.rows.length}</span>
          </div>
          <div className="kpi">
            <span className="l">Class Average Total (/100)</span>
            <span className="v">{avgTotal !== null ? avgTotal.toFixed(1) : '—'}</span>
          </div>
          <div className="kpi">
            <span className="l">Passing Rate (&ge;50%)</span>
            <span className="v" style={{ color: passRate !== null && passRate < 70 ? 'var(--amber-ink)' : 'inherit' }}>
              {passRate !== null ? `${passRate}%` : '—'}
            </span>
          </div>
        </div>

        {/* Grade Distribution */}
        <div className="card-soft stack-sm" style={{ padding: '12px 16px', background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
          <span className="eyebrow">Grade Distribution Preview (Institutional Scale: 80% A, 75% B+, 70% B, 65% C+, 60% C, 55% D+, 50% D, &lt;50% E)</span>
          <div className="row-wrap" style={{ gap: 8, marginTop: 4 }}>
            {Object.entries(dist).map(([g, count]) => (
              <span key={g} className="badge" style={{ padding: '4px 10px', fontSize: 13 }}>
                <strong>{g}:</strong> {count}
              </span>
            ))}
          </div>
        </div>

        <Field label="Paste Exam Marks from Excel" hint="Index number in column 1, Exam mark (out of 60) in column 2">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <textarea className="textarea mono" style={{ minHeight: 64 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'4021180\t48\n4021214\t39.5'} />
            <button type="button" className="btn btn-sm" disabled={!paste.trim()} onClick={applyPaste}>Fill in</button>
          </div>
        </Field>
        {msg && <div className="notice notice-info">{msg}</div>}

        <label className="search">
          <span className="sr-only">Search</span>
          <Icon name="search" size={16} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter student" />
        </label>

        <div className="card-flush" style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Index no.</th>
                <th>Name</th>
                <th className="num" style={{ color: 'var(--teal-dark)' }}>CA 1 (/{caConfig.ca1_weight || 20})</th>
                <th className="num" style={{ color: 'var(--blue-ink)' }}>CA 2 (/{caConfig.ca2_weight || 20})</th>
                <th className="num">CA (/40)</th>
                <th className="num" style={{ width: 110 }}>Exam (/60)</th>
                <th className="num">Total (/100)</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 300).map((s) => (
                <tr key={s.index_no}>
                  <td className="mono small">{s.index_no}</td>
                  <td>{s.full_name}</td>
                  <td className="num mono small" style={{ color: 'var(--teal-dark)' }}>{s.ca1.toFixed(dec)}</td>
                  <td className="num mono small" style={{ color: 'var(--blue-ink)' }}>{s.ca2.toFixed(dec)}</td>
                  <td className="num strong">{s.totalCa.toFixed(dec)}</td>
                  <td className="num">
                    <input
                      className="input mono"
                      style={{ width: 85, minHeight: 34, padding: '0 8px', textAlign: 'right' }}
                      inputMode="decimal"
                      value={scores[s.index_no] ?? ''}
                      onChange={(e) => setScores({ ...scores, [s.index_no]: e.target.value })}
                      placeholder="0–60"
                    />
                  </td>
                  <td className="num strong">{s.total !== null ? s.total.toFixed(dec) : '—'}</td>
                  <td>
                    <span className={`badge ${
                      s.grade === 'A' ? 'badge-teal' :
                      s.grade === 'B+' || s.grade === 'B' ? 'badge-blue' :
                      s.grade === 'C+' || s.grade === 'C' ? 'badge-amber' :
                      s.grade === 'D+' || s.grade === 'D' ? 'badge' :
                      s.grade === 'E' ? 'badge-red' : ''
                    }`}>
                      {s.grade}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
