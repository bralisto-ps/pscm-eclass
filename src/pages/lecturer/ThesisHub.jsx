import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Topbar } from '../../components/Layout.jsx';
import Icon from '../../components/Icon.jsx';
import { Bar, Confirm, Empty, Loading, Modal, Tabs, useToast } from '../../components/ui.jsx';
import PdfAnnotatorModal from '../../components/PdfAnnotatorModal.jsx';
import DocxAnnotatorModal from '../../components/DocxAnnotatorModal.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { openStoredFile, uploadFile } from '../../lib/files.js';
import { fmtBytes, fmtDate, fmtDateTime, relative } from '../../lib/format.js';
import { downloadText, downloadWorkbook } from '../../lib/sheets.js';
import { rpc, safeFileName, supabase } from '../../lib/supabase.js';
import { buildTypedResponsePdfBlob } from '../../lib/textPdf.js';
import { THESIS_PORTAL_SQL } from '../../lib/allFeaturesSql.js';
import {
  DEGREE_LEVELS,
  ETHICS_STATUS_META,
  MILESTONE_STATUS_META,
  PROJECT_STATUS_META,
  THESIS_ANNOTATION_SNIPPETS,
  THESIS_RUBRIC_CRITERIA,
  buildSupervisionDossierLines,
  buildSupervisionRegisterSheets,
  computeCohortSummary,
  computeThesisRubricTotal,
  detectThesisFileKind,
  getMilestonesForDegree,
  parseBulkSuperviseesText,
  validateThesisUploadFile,
} from '../../lib/thesisEngine.js';

function defaultAcademicYear() {
  const y = new Date().getFullYear();
  return `${y}/${y + 1}`;
}

export default function ThesisHub() {
  const { profile } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [needsSql, setNeedsSql] = useState(false);
  const [sqlModalOpen, setSqlModalOpen] = useState(false);

  const [projects, setProjects] = useState([]);
  const [milestonesByProj, setMilestonesByProj] = useState({});
  const [subsByProj, setSubsByProj] = useState({});
  const [meetingsByProj, setMeetingsByProj] = useState({});
  const [messagesByProj, setMessagesByProj] = useState({});

  // Filters & selection
  const [filterMode, setFilterMode] = useState('all'); // all | pending | silent | defence
  const [degreeFilter, setDegreeFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(() => searchParams.get('project') || '');
  const [detailTab, setDetailTab] = useState('chapters'); // chapters | messages | meetings | rubric

  // Modals
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [annotatorSub, setAnnotatorSub] = useState(null); // { sub, milestone, kind }

  // Add Supervisee form
  const [newForm, setNewForm] = useState({
    index_no: '',
    student_name: '',
    programme: 'BSc Procurement & Supply Chain Management',
    degree_level: 'BSc',
    academic_year: defaultAcademicYear(),
    title: '',
    research_area: '',
    target_defence_date: '',
  });
  const [adding, setAdding] = useState(false);

  // Bulk import
  const [bulkText, setBulkText] = useState('');
  const [bulkDegree, setBulkDegree] = useState('BSc');
  const [bulkYear, setBulkYear] = useState(defaultAcademicYear());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Review editor state per submission
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [reviewBusyId, setReviewBusyId] = useState(null);
  const [reviewedUploadBusyId, setReviewedUploadBusyId] = useState(null);

  // Add custom milestone
  const [customMilestoneTitle, setCustomMilestoneTitle] = useState('');
  const [addingMilestone, setAddingMilestone] = useState(false);

  // Message composer
  const [msgText, setMsgText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  // Meeting logger
  const [meetingForm, setMeetingForm] = useState({
    meeting_date: new Date().toISOString().slice(0, 16),
    mode: 'in_person',
    summary: '',
    action_items_text: '',
    next_meeting_date: '',
  });
  const [loggingMeeting, setLoggingMeeting] = useState(false);

  // Project metadata & rubric editing
  const [metaDraft, setMetaDraft] = useState(null);
  const [savingMeta, setSavingMeta] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data: projs, error: pErr } = await supabase
        .from('thesis_projects')
        .select('*')
        .order('updated_at', { ascending: false });

      if (pErr) {
        if (/relation .* does not exist|schema cache|42P01/i.test(pErr.message || '')) {
          setNeedsSql(true);
          setLoading(false);
          return;
        }
        throw pErr;
      }

      setNeedsSql(false);
      const list = projs || [];
      setProjects(list);

      if (!list.length) {
        setMilestonesByProj({});
        setSubsByProj({});
        setMeetingsByProj({});
        setMessagesByProj({});
        setLoading(false);
        return;
      }

      const ids = list.map((p) => p.id);
      const [mRes, sRes, mtRes, msgRes] = await Promise.all([
        supabase.from('thesis_milestones').select('*').in('project_id', ids).order('sort_order', { ascending: true }),
        supabase.from('thesis_submissions').select('*').in('project_id', ids).order('version_no', { ascending: false }),
        supabase.from('thesis_meetings').select('*').in('project_id', ids).order('meeting_date', { ascending: false }),
        supabase.from('thesis_messages').select('*').in('project_id', ids).order('created_at', { ascending: true }),
      ]);

      const groupBy = (rows = []) => {
        const map = {};
        for (const r of rows || []) {
          if (!map[r.project_id]) map[r.project_id] = [];
          map[r.project_id].push(r);
        }
        return map;
      };

      setMilestonesByProj(groupBy(mRes.data));
      setSubsByProj(groupBy(sRes.data));
      setMeetingsByProj(groupBy(mtRes.data));
      setMessagesByProj(groupBy(msgRes.data));

      const qp = searchParams.get('project');
      setSelectedId((prev) => {
        if (qp && list.some((p) => p.id === qp)) return qp;
        if (prev && list.some((p) => p.id === prev)) return prev;
        return list[0].id;
      });
    } catch (err) {
      toast(err.message || 'Could not load Thesis Supervision Portal.', 'error');
    } finally {
      setLoading(false);
    }
  }, [searchParams, toast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const cohort = useMemo(
    () => computeCohortSummary(projects, milestonesByProj, subsByProj, meetingsByProj),
    [projects, milestonesByProj, subsByProj, meetingsByProj],
  );

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      const h = cohort.healthById[p.id] || {};
      if (filterMode === 'pending' && !h.pendingReviewCount) return false;
      if (filterMode === 'silent' && !h.isSilentRisk) return false;
      if (filterMode === 'defence' && !(p.status === 'submitted_for_defence' || p.status === 'completed' || h.progressPct >= 95)) return false;
      if (degreeFilter !== 'ALL' && p.degree_level !== degreeFilter) return false;
      if (q) {
        const hay = `${p.student_name} ${p.student_index_no} ${p.title} ${p.programme} ${p.research_area}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projects, cohort, filterMode, degreeFilter, search]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === selectedId) || filteredProjects[0] || null,
    [projects, selectedId, filteredProjects],
  );

  useEffect(() => {
    if (activeProject) {
      setMetaDraft({
        title: activeProject.title || '',
        programme: activeProject.programme || '',
        degree_level: activeProject.degree_level || 'BSc',
        academic_year: activeProject.academic_year || '',
        research_area: activeProject.research_area || '',
        abstract: activeProject.abstract || '',
        ethics_status: activeProject.ethics_status || 'not_required',
        status: activeProject.status || 'active',
        target_defence_date: activeProject.target_defence_date || '',
        rubric_scores: { ...(activeProject.rubric_scores || {}) },
      });
    } else {
      setMetaDraft(null);
    }
  }, [activeProject?.id]);

  const activeMilestones = activeProject ? milestonesByProj[activeProject.id] || [] : [];
  const activeSubs = activeProject ? subsByProj[activeProject.id] || [] : [];
  const activeMeetings = activeProject ? meetingsByProj[activeProject.id] || [] : [];
  const activeMessages = activeProject ? messagesByProj[activeProject.id] || [] : [];
  const activeHealth = activeProject ? cohort.healthById[activeProject.id] || {} : {};

  function selectProject(id) {
    setSelectedId(id);
    setSearchParams(id ? { project: id } : {}, { replace: true });
  }

  async function handleAddSupervisee(e) {
    e.preventDefault();
    if (!newForm.index_no.trim() || !newForm.student_name.trim()) {
      toast('Enter both student index number and full name.', 'error');
      return;
    }
    setAdding(true);
    try {
      const milestones = getMilestonesForDegree(newForm.degree_level);
      const projId = await rpc('create_thesis_project', {
        p_index_no: newForm.index_no.trim(),
        p_student_name: newForm.student_name.trim(),
        p_programme: newForm.programme.trim(),
        p_degree_level: newForm.degree_level,
        p_academic_year: newForm.academic_year.trim(),
        p_title: newForm.title.trim() || 'Untitled Research Topic',
        p_research_area: newForm.research_area.trim(),
        p_target_defence_date: newForm.target_defence_date || null,
        p_milestones: milestones,
      });
      toast(`Added ${newForm.student_name.trim()} to Thesis Supervision.`);
      setAddOpen(false);
      setNewForm((f) => ({ ...f, index_no: '', student_name: '', title: '', research_area: '', target_defence_date: '' }));
      await loadAll();
      if (projId) selectProject(projId);
    } catch (err) {
      toast(err.message || 'Could not add supervisee.', 'error');
    } finally {
      setAdding(false);
    }
  }

  async function handleBulkImport() {
    const rows = parseBulkSuperviseesText(bulkText, bulkDegree, bulkYear);
    if (!rows.length) {
      toast('Paste at least one row: Index No, Student Name, Thesis Title (optional).', 'error');
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    try {
      for (const r of rows) {
        await rpc('create_thesis_project', {
          p_index_no: r.index_no,
          p_student_name: r.student_name,
          p_programme: r.programme,
          p_degree_level: r.degree_level,
          p_academic_year: r.academic_year,
          p_title: r.title,
          p_research_area: '',
          p_target_defence_date: null,
          p_milestones: getMilestonesForDegree(r.degree_level),
        });
        ok += 1;
      }
      toast(`Imported ${ok} supervisee${ok === 1 ? '' : 's'} with full milestone pipelines.`);
      setBulkOpen(false);
      setBulkText('');
      await loadAll();
    } catch (err) {
      toast(`Imported ${ok}/${rows.length}. Error: ${err.message}`, 'error');
      await loadAll();
    } finally {
      setBulkBusy(false);
    }
  }

  async function saveSubmissionReview(sub) {
    const draft = reviewDrafts[sub.id] || {
      status: sub.review_status === 'pending' ? 'revisions_requested' : sub.review_status,
      feedback: sub.supervisor_feedback || '',
    };
    setReviewBusyId(sub.id);
    try {
      await rpc('review_thesis_submission', {
        p_submission_id: sub.id,
        p_review_status: draft.status,
        p_feedback: draft.feedback,
        p_reviewed_file_path: null,
        p_reviewed_file_name: null,
      });
      toast('Feedback saved & student notified!');
      await loadAll();
    } catch (err) {
      toast(err.message || 'Could not save feedback.', 'error');
    } finally {
      setReviewBusyId(null);
    }
  }

  async function handleUploadReviewedFile(sub, file) {
    const check = validateThesisUploadFile(file);
    if (!check.ok) {
      toast(check.error, 'error');
      return;
    }
    setReviewedUploadBusyId(sub.id);
    try {
      const storagePath = `${sub.project_id}/${sub.milestone_id}/review/${Date.now()}_${safeFileName(file.name)}`;
      await uploadFile('theses', storagePath, file);
      const draft = reviewDrafts[sub.id] || {
        status: sub.review_status === 'pending' ? 'revisions_requested' : sub.review_status,
        feedback: sub.supervisor_feedback || '',
      };
      await rpc('review_thesis_submission', {
        p_submission_id: sub.id,
        p_review_status: draft.status,
        p_feedback: draft.feedback || `Uploaded reviewed file: ${file.name}`,
        p_reviewed_file_path: storagePath,
        p_reviewed_file_name: file.name,
      });
      toast(`Uploaded reviewed copy (${file.name}) & notified student!`);
      await loadAll();
    } catch (err) {
      toast(err.message || 'Could not upload reviewed copy.', 'error');
    } finally {
      setReviewedUploadBusyId(null);
    }
  }

  async function updateMilestoneDueDate(milestoneId, dueDate) {
    try {
      const { error } = await supabase
        .from('thesis_milestones')
        .update({ due_date: dueDate || null, updated_at: new Date().toISOString() })
        .eq('id', milestoneId);
      if (error) throw error;
      setMilestonesByProj((prev) => ({
        ...prev,
        [activeProject.id]: (prev[activeProject.id] || []).map((m) => (m.id === milestoneId ? { ...m, due_date: dueDate || null } : m)),
      }));
      toast('Milestone due date updated.');
    } catch (err) {
      toast(err.message || 'Could not update due date.', 'error');
    }
  }

  async function addCustomMilestone(e) {
    e.preventDefault();
    if (!activeProject || !customMilestoneTitle.trim()) return;
    setAddingMilestone(true);
    try {
      const sortOrder = activeMilestones.length + 1;
      const stageKey = `custom_${Date.now()}`;
      const { error } = await supabase.from('thesis_milestones').insert({
        project_id: activeProject.id,
        stage_key: stageKey,
        title: customMilestoneTitle.trim(),
        sort_order: sortOrder,
      });
      if (error) throw error;
      setCustomMilestoneTitle('');
      toast('Added custom milestone.');
      await loadAll();
    } catch (err) {
      toast(err.message || 'Could not add milestone.', 'error');
    } finally {
      setAddingMilestone(false);
    }
  }

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!activeProject || !msgText.trim()) return;
    setSendingMsg(true);
    try {
      await rpc('post_thesis_message', {
        p_project_id: activeProject.id,
        p_body: msgText.trim(),
        p_milestone_id: null,
      });
      setMsgText('');
      toast('Message sent & student notified.');
      await loadAll();
    } catch (err) {
      toast(err.message || 'Could not send message.', 'error');
    } finally {
      setSendingMsg(false);
    }
  }

  async function handleLogMeeting(e) {
    e.preventDefault();
    if (!activeProject || !meetingForm.summary.trim()) {
      toast('Enter a short meeting summary.', 'error');
      return;
    }
    setLoggingMeeting(true);
    try {
      const actionItems = meetingForm.action_items_text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((text) => ({ text, done: false }));
      await rpc('log_thesis_meeting', {
        p_project_id: activeProject.id,
        p_meeting_date: meetingForm.meeting_date ? new Date(meetingForm.meeting_date).toISOString() : new Date().toISOString(),
        p_mode: meetingForm.mode,
        p_summary: meetingForm.summary.trim(),
        p_action_items: actionItems,
        p_next_meeting_date: meetingForm.next_meeting_date || null,
      });
      setMeetingForm({
        meeting_date: new Date().toISOString().slice(0, 16),
        mode: 'in_person',
        summary: '',
        action_items_text: '',
        next_meeting_date: '',
      });
      toast('Supervision meeting logged & student notified.');
      await loadAll();
    } catch (err) {
      toast(err.message || 'Could not log meeting.', 'error');
    } finally {
      setLoggingMeeting(false);
    }
  }

  async function saveProjectMetaAndRubric() {
    if (!activeProject || !metaDraft) return;
    setSavingMeta(true);
    try {
      const { error } = await supabase
        .from('thesis_projects')
        .update({
          title: metaDraft.title.trim() || 'Untitled Research Topic',
          programme: metaDraft.programme.trim(),
          degree_level: metaDraft.degree_level,
          academic_year: metaDraft.academic_year.trim(),
          research_area: metaDraft.research_area.trim(),
          abstract: metaDraft.abstract.trim(),
          ethics_status: metaDraft.ethics_status,
          status: metaDraft.status,
          target_defence_date: metaDraft.target_defence_date || null,
          rubric_scores: metaDraft.rubric_scores || {},
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeProject.id);
      if (error) throw error;
      toast('Supervision record & thesis rubric saved.');
      await loadAll();
    } catch (err) {
      toast(err.message || 'Could not save supervision record.', 'error');
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleDeleteProject() {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from('thesis_projects').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      toast(`Removed ${deleteTarget.student_name} from Thesis Portal.`);
      setDeleteTarget(null);
      setSelectedId('');
      await loadAll();
    } catch (err) {
      toast(err.message || 'Could not delete supervision record.', 'error');
    }
  }

  function exportAuditDossierPdf() {
    if (!activeProject) return;
    const lines = buildSupervisionDossierLines({
      project: activeProject,
      supervisorName: profile?.full_name || 'Supervisor',
      milestones: activeMilestones,
      submissions: activeSubs,
      meetings: activeMeetings,
    });
    const blob = buildTypedResponsePdfBlob({
      title: `Supervision Dossier — ${activeProject.student_name}`,
      studentLine: `${activeProject.student_name} (${activeProject.student_index_no}) · ${activeProject.degree_level}`,
      submittedAt: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      body: lines.join('\n'),
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Supervision_Dossier_${safeFileName(activeProject.student_index_no)}.pdf`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  async function exportSupervisionRegisterExcel() {
    try {
      const sheets = buildSupervisionRegisterSheets(projects, milestonesByProj, subsByProj, meetingsByProj);
      await downloadWorkbook(`PSCM_Thesis_Supervision_Register_${new Date().toISOString().slice(0, 10)}.xlsx`, sheets);
      toast('Downloaded Supervision Register (.xlsx).');
    } catch (err) {
      toast(err.message || 'Could not export Excel register.', 'error');
    }
  }

  if (needsSql) {
    return (
      <>
        <Topbar title="Thesis & Dissertation Supervision" sub="Standalone research supervision hub" />
        <div className="page">
          <div className="card stack" style={{ maxWidth: 740, margin: '24px auto', padding: 28 }}>
            <div className="row" style={{ gap: 12 }}>
              <Icon name="award" size={28} />
              <div>
                <h2 style={{ margin: 0 }}>Activate Thesis Supervision Portal (1-Minute Setup)</h2>
                <div className="small muted">Run the Thesis Portal SQL once in your Supabase SQL Editor to enable private chapter storage, inline PDF/Word annotations, meeting logs, and real-time notifications.</div>
              </div>
            </div>
            <div className="row-wrap" style={{ gap: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  navigator.clipboard?.writeText(THESIS_PORTAL_SQL);
                  toast('Copied Thesis Portal SQL to clipboard!');
                }}
              >
                Copy Setup SQL
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => downloadText('thesis-portal.sql', THESIS_PORTAL_SQL, 'application/sql')}
              >
                <Icon name="download" size={15} /> Download thesis-portal.sql
              </button>
              <button type="button" className="btn" onClick={loadAll}>
                <Icon name="refresh" size={15} /> I Ran It — Reload Portal
              </button>
            </div>
            <pre className="mono tiny" style={{ maxHeight: 260, overflow: 'auto', padding: 12, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
              {THESIS_PORTAL_SQL.slice(0, 1800)}
              {'\n-- ... (click Copy Setup SQL or Download for full script)'}
            </pre>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title="Thesis & Dissertation Supervision"
        sub="Track supervisees, annotate PDF/Word chapters, log meetings, and notify students automatically"
      >
        <button type="button" className="btn btn-sm" onClick={() => setBulkOpen(true)}>
          <Icon name="upload" size={15} /> Bulk Import
        </button>
        {projects.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={exportSupervisionRegisterExcel}>
            <Icon name="download" size={15} /> Export Register (.xlsx)
          </button>
        )}
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setAddOpen(true)}>
          <Icon name="plus" size={15} /> Add Supervisee
        </button>
      </Topbar>

      <div className="page stack">
        {/* KPI Command Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 12 }}>
          <button type="button" className="card kpi" style={{ textAlign: 'left', cursor: 'pointer', borderColor: filterMode === 'all' ? 'var(--teal)' : undefined }} onClick={() => setFilterMode('all')}>
            <span className="tiny muted">Active Supervisees</span>
            <strong className="mono" style={{ fontSize: 24 }}>{cohort.totalSupervisees}</strong>
            <span className="tiny muted">Avg progress {cohort.avgProgressPct}%</span>
          </button>
          <button type="button" className="card kpi" style={{ textAlign: 'left', cursor: 'pointer', borderColor: filterMode === 'pending' ? '#d97706' : undefined }} onClick={() => setFilterMode(filterMode === 'pending' ? 'all' : 'pending')}>
            <span className="tiny muted">Needs My Review</span>
            <strong className="mono" style={{ fontSize: 24, color: cohort.pendingReviews > 0 ? '#d97706' : 'var(--teal)' }}>{cohort.pendingReviews}</strong>
            <span className="tiny muted">{cohort.pendingReviews ? 'Click to filter queue' : 'All drafts reviewed'}</span>
          </button>
          <button type="button" className="card kpi" style={{ textAlign: 'left', cursor: 'pointer', borderColor: filterMode === 'silent' ? 'var(--red)' : undefined }} onClick={() => setFilterMode(filterMode === 'silent' ? 'all' : 'silent')}>
            <span className="tiny muted">Silent 14+ Days</span>
            <strong className="mono" style={{ fontSize: 24, color: cohort.silentCount > 0 ? 'var(--red)' : 'var(--muted)' }}>{cohort.silentCount}</strong>
            <span className="tiny muted">Needs supervisor check-in</span>
          </button>
          <div className="card kpi">
            <span className="tiny muted">Avg Turnaround</span>
            <strong className="mono" style={{ fontSize: 24 }}>{cohort.avgTurnaroundDays !== null ? `${cohort.avgTurnaroundDays}d` : '—'}</strong>
            <span className="tiny muted">Submit → feedback SLA</span>
          </div>
          <button type="button" className="card kpi" style={{ textAlign: 'left', cursor: 'pointer', borderColor: filterMode === 'defence' ? 'var(--teal)' : undefined }} onClick={() => setFilterMode(filterMode === 'defence' ? 'all' : 'defence')}>
            <span className="tiny muted">Defence Ready</span>
            <strong className="mono" style={{ fontSize: 24, color: 'var(--teal)' }}>{cohort.defenceReady}</strong>
            <span className="tiny muted">Completed or ≥95%</span>
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div className="card row-wrap" style={{ padding: 12, gap: 10, alignItems: 'center' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 210 }}
            placeholder="Search student name, index number, or thesis topic…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="select" style={{ width: 140 }} value={degreeFilter} onChange={(e) => setDegreeFilter(e.target.value)}>
            <option value="ALL">All Levels</option>
            {DEGREE_LEVELS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button type="button" className="btn btn-sm" onClick={loadAll} title="Refresh">
            <Icon name="refresh" size={14} /> Refresh
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSqlModalOpen(true)}>
            SQL
          </button>
        </div>

        {loading ? (
          <Loading label="Loading thesis supervisees…" />
        ) : projects.length === 0 ? (
          <Empty
            icon="award"
            title="No thesis supervisees yet"
            action={
              <div className="row-wrap" style={{ gap: 8, justifyContent: 'center' }}>
                <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
                  <Icon name="plus" size={15} /> Add First Supervisee
                </button>
                <button type="button" className="btn" onClick={() => setBulkOpen(true)}>
                  Bulk Paste Supervisee List
                </button>
              </div>
            }
          >
            Add your BSc, MSc, MBA, MPhil, or PhD supervisees here. Even students not enrolled in your regular courses can activate their PSCM E-Class account and submit chapters directly.
          </Empty>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(270px, 340px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
            {/* Left: Supervisee List */}
            <div className="stack-sm">
              {filteredProjects.length === 0 ? (
                <div className="card small muted" style={{ padding: 18 }}>No supervisees match the current filter.</div>
              ) : (
                filteredProjects.map((p) => {
                  const h = cohort.healthById[p.id] || {};
                  const selected = activeProject?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className="card stack-sm"
                      onClick={() => selectProject(p.id)}
                      style={{
                        textAlign: 'left',
                        padding: 14,
                        cursor: 'pointer',
                        borderColor: selected ? 'var(--teal)' : 'var(--line)',
                        boxShadow: selected ? '0 0 0 2px rgba(15,118,110,0.14)' : undefined,
                      }}
                    >
                      <div className="between" style={{ gap: 8 }}>
                        <strong className="small">{p.student_name}</strong>
                        <span className="badge badge-blue" style={{ fontSize: 10 }}>{p.degree_level}</span>
                      </div>
                      <div className="mono tiny muted">{p.student_index_no}{p.academic_year ? ` · ${p.academic_year}` : ''}</div>
                      <div className="tiny" style={{ color: 'var(--text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {p.title}
                      </div>
                      <Bar value={h.progressPct || 0} color={h.progressPct >= 95 ? '#0f766e' : 'var(--teal)'} />
                      <div className="between tiny" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <span className="muted">{h.approvedCount || 0}/{h.totalMilestones || 0} approved</span>
                        {h.pendingReviewCount > 0 ? (
                          <span className={`badge ${h.slaLevel === 'overdue' ? 'badge-red' : 'badge-amber'}`} style={{ fontSize: 10 }}>
                            {h.pendingReviewCount} to review{h.oldestPendingDays !== null ? ` · ${h.oldestPendingDays}d` : ''}
                          </span>
                        ) : h.isSilentRisk ? (
                          <span className="badge badge-red" style={{ fontSize: 10 }}>Silent {h.inactiveDays}d</span>
                        ) : (
                          <span className="muted">{relative(p.updated_at)}</span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Right: Selected Supervisee Workspace */}
            {activeProject && (
              <div className="card stack" style={{ padding: 20 }}>
                <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
                  <div className="stack-sm" style={{ gap: 4 }}>
                    <div className="row-wrap" style={{ gap: 8 }}>
                      <h2 style={{ margin: 0 }}>{activeProject.student_name}</h2>
                      <span className="mono small muted">({activeProject.student_index_no})</span>
                      <span className="badge badge-blue">{activeProject.degree_level}</span>
                      <span className={`badge ${ETHICS_STATUS_META[activeProject.ethics_status]?.cls || 'badge-muted'}`}>
                        {ETHICS_STATUS_META[activeProject.ethics_status]?.label || activeProject.ethics_status}
                      </span>
                      {!activeProject.student_id && (
                        <span className="badge badge-amber" title="Student has not yet activated their account">Not Activated Yet</span>
                      )}
                    </div>
                    <div className="small" style={{ fontWeight: 600 }}>{activeProject.title}</div>
                    <div className="tiny muted">
                      {activeProject.programme || 'PSCM'} · Progress: <strong>{activeHealth.progressPct || 0}%</strong> ({activeHealth.approvedCount || 0}/{activeHealth.totalMilestones || 0} chapters approved)
                      {activeProject.target_defence_date ? ` · Target Defence: ${fmtDate(activeProject.target_defence_date)}` : ''}
                    </div>
                  </div>
                  <div className="row-wrap" style={{ gap: 8 }}>
                    <button type="button" className="btn btn-sm" onClick={exportAuditDossierPdf}>
                      <Icon name="printer" size={14} /> Supervision Dossier PDF
                    </button>
                  </div>
                </div>

                <Tabs
                  value={detailTab}
                  onChange={setDetailTab}
                  tabs={[
                    { id: 'chapters', label: `Chapters & Reviews (${activeSubs.length})` },
                    { id: 'messages', label: `Messages (${activeMessages.length})` },
                    { id: 'meetings', label: `Meeting Log (${activeMeetings.length})` },
                    { id: 'rubric', label: 'Rubric & Details' },
                  ]}
                />

                {/* TAB 1: CHAPTERS & SUBMISSIONS */}
                {detailTab === 'chapters' && (
                  <div className="stack">
                    {activeMilestones.map((m, idx) => {
                      const mSubs = activeSubs.filter((s) => s.milestone_id === m.id);
                      const st = MILESTONE_STATUS_META[m.status] || MILESTONE_STATUS_META.not_started;
                      return (
                        <div key={m.id} className="card-soft stack-sm" style={{ padding: 14, borderLeft: `4px solid ${st.color}` }}>
                          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                            <div className="row-wrap" style={{ gap: 8 }}>
                              <span className="mono tiny muted">#{idx + 1}</span>
                              <strong className="small">{m.title}</strong>
                              <span className={`badge ${st.cls}`}>{st.label}</span>
                            </div>
                            <div className="row" style={{ gap: 6 }}>
                              <span className="tiny muted">Due:</span>
                              <input
                                type="date"
                                className="input"
                                style={{ minHeight: 30, padding: '2px 8px', fontSize: 12, width: 142 }}
                                value={m.due_date || ''}
                                onChange={(e) => updateMilestoneDueDate(m.id, e.target.value)}
                              />
                            </div>
                          </div>

                          {mSubs.length === 0 ? (
                            <div className="tiny muted">No draft uploaded for this milestone yet.</div>
                          ) : (
                            <div className="stack-sm">
                              {mSubs.map((sub) => {
                                const fileKind = detectThesisFileKind(sub.file_name, sub.mime_type);
                                const anns = Array.isArray(sub.annotations) ? sub.annotations : [];
                                const unresolved = anns.filter((a) => !a.studentResolved).length;
                                const draft = reviewDrafts[sub.id] || {
                                  status: sub.review_status === 'pending' ? 'revisions_requested' : sub.review_status,
                                  feedback: sub.supervisor_feedback || '',
                                };
                                return (
                                  <div key={sub.id} className="card stack-sm" style={{ padding: 12 }}>
                                    <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                                      <div className="row-wrap" style={{ gap: 8 }}>
                                        <span className="badge badge-blue mono">v{sub.version_no}</span>
                                        <strong className="small">{sub.file_name}</strong>
                                        <span className="tiny muted">{fmtBytes(sub.file_size)} · {fmtDateTime(sub.submitted_at)}</span>
                                      </div>
                                      <div className="row-wrap" style={{ gap: 6 }}>
                                        {(fileKind === 'pdf' || fileKind === 'docx') && (
                                          <button
                                            type="button"
                                            className="btn btn-sm btn-primary"
                                            onClick={() => setAnnotatorSub({ sub, milestone: m, kind: fileKind })}
                                          >
                                            <Icon name="edit" size={14} /> {fileKind === 'pdf' ? 'Annotate PDF' : 'Annotate Word'}
                                            {anns.length > 0 ? ` (${anns.length}${unresolved ? ` · ${unresolved} open` : ' ✓'})` : ''}
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          className="btn btn-sm"
                                          onClick={() => openStoredFile('theses', sub.file_path).catch((e) => toast(e.message, 'error'))}
                                        >
                                          <Icon name="download" size={14} /> Download
                                        </button>
                                      </div>
                                    </div>

                                    {sub.student_note && (
                                      <div className="tiny" style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)' }}>
                                        <strong>Student Note:</strong> {sub.student_note}
                                      </div>
                                    )}

                                    {/* Supervisor review controls */}
                                    <div className="stack-sm" style={{ gap: 8, paddingTop: 6, borderTop: '1px solid var(--line)' }}>
                                      <div className="row-wrap" style={{ gap: 8 }}>
                                        <select
                                          className="select"
                                          style={{ width: 195, minHeight: 34, fontSize: 13 }}
                                          value={draft.status}
                                          onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [sub.id]: { ...draft, status: e.target.value } }))}
                                        >
                                          <option value="under_review">Under Review</option>
                                          <option value="revisions_requested">Revisions Requested</option>
                                          <option value="approved">Approved ✓</option>
                                        </select>
                                        <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                                          <Icon name="upload" size={14} /> {reviewedUploadBusyId === sub.id ? 'Uploading…' : 'Upload Track-Changes File'}
                                          <input
                                            type="file"
                                            accept=".pdf,.doc,.docx,.xlsx,.pptx,.zip"
                                            style={{ display: 'none' }}
                                            disabled={reviewedUploadBusyId === sub.id}
                                            onChange={(e) => {
                                              const f = e.target.files?.[0];
                                              e.target.value = '';
                                              if (f) handleUploadReviewedFile(sub, f);
                                            }}
                                          />
                                        </label>
                                        {sub.reviewed_file_path && (
                                          <button
                                            type="button"
                                            className="btn btn-sm btn-ghost"
                                            onClick={() => openStoredFile('theses', sub.reviewed_file_path).catch((e) => toast(e.message, 'error'))}
                                          >
                                            Reviewed Copy: {sub.reviewed_file_name || 'Download'}
                                          </button>
                                        )}
                                      </div>
                                      <textarea
                                        className="textarea"
                                        rows={2}
                                        placeholder="Write overall supervisor feedback for this chapter version…"
                                        value={draft.feedback}
                                        onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [sub.id]: { ...draft, feedback: e.target.value } }))}
                                      />
                                      <div className="between" style={{ gap: 8 }}>
                                        <span className="tiny muted">
                                          {sub.reviewed_at ? `Last reviewed ${fmtDateTime(sub.reviewed_at)}` : 'Awaiting supervisor review'}
                                        </span>
                                        <button
                                          type="button"
                                          className="btn btn-sm btn-primary"
                                          disabled={reviewBusyId === sub.id}
                                          onClick={() => saveSubmissionReview(sub)}
                                        >
                                          {reviewBusyId === sub.id ? 'Saving…' : 'Save Review & Notify Student'}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <form onSubmit={addCustomMilestone} className="row" style={{ gap: 8 }}>
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        placeholder="Add custom milestone (e.g., Turnitin Similarity Check, Pilot Survey)…"
                        value={customMilestoneTitle}
                        onChange={(e) => setCustomMilestoneTitle(e.target.value)}
                      />
                      <button type="button" className="btn btn-sm" disabled={addingMilestone || !customMilestoneTitle.trim()} onClick={addCustomMilestone}>
                        + Add Stage
                      </button>
                    </form>
                  </div>
                )}

                {/* TAB 2: MESSAGES */}
                {detailTab === 'messages' && (
                  <div className="stack-sm">
                    <div className="stack-sm" style={{ maxHeight: 380, overflowY: 'auto', padding: 8, background: 'var(--surface-2)', borderRadius: 10 }}>
                      {activeMessages.length === 0 ? (
                        <div className="small muted" style={{ padding: 20, textAlign: 'center' }}>
                          No messages yet. Send a note to {activeProject.student_name} — they receive an instant notification.
                        </div>
                      ) : (
                        activeMessages.map((m) => {
                          const mine = m.sender_role === 'lecturer';
                          return (
                            <div
                              key={m.id}
                              className="card stack-sm"
                              style={{
                                padding: '10px 14px',
                                maxWidth: '86%',
                                alignSelf: mine ? 'flex-end' : 'flex-start',
                                borderColor: mine ? 'var(--teal)' : 'var(--line)',
                              }}
                            >
                              <div className="between tiny muted" style={{ gap: 12 }}>
                                <strong>{m.sender_name}</strong>
                                <span>{fmtDateTime(m.created_at)}</span>
                              </div>
                              <div className="small pre">{m.body}</div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <form onSubmit={handleSendMessage} className="row" style={{ gap: 8 }}>
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        placeholder={`Message ${activeProject.student_name}…`}
                        value={msgText}
                        onChange={(e) => setMsgText(e.target.value)}
                      />
                      <button type="submit" className="btn btn-primary" disabled={sendingMsg || !msgText.trim()}>
                        {sendingMsg ? 'Sending…' : 'Send & Notify'}
                      </button>
                    </form>
                  </div>
                )}

                {/* TAB 3: MEETING LOG */}
                {detailTab === 'meetings' && (
                  <div className="stack">
                    <form onSubmit={handleLogMeeting} className="card-soft stack-sm" style={{ padding: 14 }}>
                      <strong className="small">Log New Supervision Meeting</strong>
                      <div className="row-wrap" style={{ gap: 8 }}>
                        <input
                          type="datetime-local"
                          className="input"
                          style={{ width: 210 }}
                          value={meetingForm.meeting_date}
                          onChange={(e) => setMeetingForm((f) => ({ ...f, meeting_date: e.target.value }))}
                        />
                        <select
                          className="select"
                          style={{ width: 150 }}
                          value={meetingForm.mode}
                          onChange={(e) => setMeetingForm((f) => ({ ...f, mode: e.target.value }))}
                        >
                          <option value="in_person">In-Person Office</option>
                          <option value="online">Online (Zoom/Meet)</option>
                          <option value="phone">Phone Call</option>
                        </select>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="tiny muted">Next Meeting:</span>
                          <input
                            type="date"
                            className="input"
                            style={{ width: 150 }}
                            value={meetingForm.next_meeting_date}
                            onChange={(e) => setMeetingForm((f) => ({ ...f, next_meeting_date: e.target.value }))}
                          />
                        </div>
                      </div>
                      <textarea
                        className="textarea"
                        rows={2}
                        placeholder="Discussion summary (what was reviewed, methodological decisions)…"
                        value={meetingForm.summary}
                        onChange={(e) => setMeetingForm((f) => ({ ...f, summary: e.target.value }))}
                      />
                      <textarea
                        className="textarea"
                        rows={2}
                        placeholder="Agreed student action items (one per line)…"
                        value={meetingForm.action_items_text}
                        onChange={(e) => setMeetingForm((f) => ({ ...f, action_items_text: e.target.value }))}
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button type="submit" className="btn btn-sm btn-primary" disabled={loggingMeeting}>
                          {loggingMeeting ? 'Saving…' : 'Log Meeting & Notify Student'}
                        </button>
                      </div>
                    </form>

                    {activeMeetings.length === 0 ? (
                      <div className="small muted">No supervision meetings logged yet.</div>
                    ) : (
                      activeMeetings.map((mt) => (
                        <div key={mt.id} className="card stack-sm" style={{ padding: 14 }}>
                          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                            <div className="row-wrap" style={{ gap: 8 }}>
                              <strong className="small">{fmtDateTime(mt.meeting_date)}</strong>
                              <span className="badge badge-blue">{mt.mode === 'in_person' ? 'In-Person' : mt.mode === 'online' ? 'Online' : 'Phone'}</span>
                              {mt.next_meeting_date && <span className="tiny muted">Next: {fmtDate(mt.next_meeting_date)}</span>}
                            </div>
                            {mt.student_acknowledged_at ? (
                              <span className="badge badge-teal">Student Acknowledged ✓</span>
                            ) : (
                              <span className="badge badge-amber">Awaiting Student Ack</span>
                            )}
                          </div>
                          <div className="small pre">{mt.summary}</div>
                          {Array.isArray(mt.action_items) && mt.action_items.length > 0 && (
                            <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                              {mt.action_items.map((it, i) => (
                                <li key={i}>{typeof it === 'string' ? it : it.text}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* TAB 4: RUBRIC & PROJECT DETAILS */}
                {detailTab === 'rubric' && metaDraft && (() => {
                  const rub = computeThesisRubricTotal(metaDraft.rubric_scores);
                  return (
                    <div className="stack">
                      <div className="card-soft stack-sm" style={{ padding: 14 }}>
                        <strong className="small">Thesis Metadata & Clearance</strong>
                        <input
                          className="input"
                          placeholder="Approved Thesis / Dissertation Title"
                          value={metaDraft.title}
                          onChange={(e) => setMetaDraft((d) => ({ ...d, title: e.target.value }))}
                        />
                        <div className="row-wrap" style={{ gap: 8 }}>
                          <input
                            className="input"
                            style={{ flex: 1, minWidth: 180 }}
                            placeholder="Programme"
                            value={metaDraft.programme}
                            onChange={(e) => setMetaDraft((d) => ({ ...d, programme: e.target.value }))}
                          />
                          <select className="select" style={{ width: 110 }} value={metaDraft.degree_level} onChange={(e) => setMetaDraft((d) => ({ ...d, degree_level: e.target.value }))}>
                            {DEGREE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                          </select>
                          <select className="select" style={{ width: 170 }} value={metaDraft.ethics_status} onChange={(e) => setMetaDraft((d) => ({ ...d, ethics_status: e.target.value }))}>
                            {Object.entries(ETHICS_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                          <select className="select" style={{ width: 180 }} value={metaDraft.status} onChange={(e) => setMetaDraft((d) => ({ ...d, status: e.target.value }))}>
                            {Object.entries(PROJECT_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                          <input
                            type="date"
                            className="input"
                            style={{ width: 155 }}
                            value={metaDraft.target_defence_date || ''}
                            onChange={(e) => setMetaDraft((d) => ({ ...d, target_defence_date: e.target.value }))}
                            title="Target Defence Date"
                          />
                        </div>
                        <textarea
                          className="textarea"
                          rows={2}
                          placeholder="Abstract / Research Focus Notes…"
                          value={metaDraft.abstract}
                          onChange={(e) => setMetaDraft((d) => ({ ...d, abstract: e.target.value }))}
                        />
                      </div>

                      <div className="card-soft stack-sm" style={{ padding: 14 }}>
                        <div className="between">
                          <strong className="small">Thesis Readiness & Defence Rubric</strong>
                          <span className="badge badge-teal mono">{rub.earned} / {rub.maxTotal} ({rub.gradeBand})</span>
                        </div>
                        <div className="stack-sm">
                          {THESIS_RUBRIC_CRITERIA.map((c) => (
                            <div key={c.id} className="between" style={{ gap: 12, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                              <div>
                                <div className="small" style={{ fontWeight: 600 }}>{c.label}</div>
                                <div className="tiny muted">{c.hint}</div>
                              </div>
                              <div className="row" style={{ gap: 6 }}>
                                <input
                                  type="number"
                                  min={0}
                                  max={c.max}
                                  step={0.5}
                                  className="input mono"
                                  style={{ width: 74, textAlign: 'right' }}
                                  value={metaDraft.rubric_scores?.[c.id] ?? ''}
                                  onChange={(e) =>
                                    setMetaDraft((d) => ({
                                      ...d,
                                      rubric_scores: { ...(d.rubric_scores || {}), [c.id]: e.target.value },
                                    }))
                                  }
                                />
                                <span className="mono tiny muted">/ {c.max}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="between">
                        <button type="button" className="btn btn-sm" style={{ color: 'var(--red)' }} onClick={() => setDeleteTarget(activeProject)}>
                          <Icon name="trash" size={14} /> Remove Supervisee
                        </button>
                        <button type="button" className="btn btn-primary" disabled={savingMeta} onClick={saveProjectMetaAndRubric}>
                          {savingMeta ? 'Saving…' : 'Save Details & Rubric'}
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Supervisee Modal */}
      {addOpen && (
        <Modal
          title="Add Thesis Supervisee"
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setAddOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={adding} onClick={handleAddSupervisee}>
                {adding ? 'Creating…' : 'Create Supervision Workspace'}
              </button>
            </>
          }
        >
          <form onSubmit={handleAddSupervisee} className="stack-sm">
            <div className="notice notice-info tiny">
              Students are automatically added to your portal roster so even non-course supervisees can activate their account with their Index Number.
            </div>
            <div className="row-wrap" style={{ gap: 8 }}>
              <input className="input mono" style={{ flex: 1 }} placeholder="Student Index No. *" value={newForm.index_no} onChange={(e) => setNewForm((f) => ({ ...f, index_no: e.target.value }))} required />
              <input className="input" style={{ flex: 1.5 }} placeholder="Student Full Name *" value={newForm.student_name} onChange={(e) => setNewForm((f) => ({ ...f, student_name: e.target.value }))} required />
            </div>
            <input className="input" placeholder="Working Thesis / Dissertation Title" value={newForm.title} onChange={(e) => setNewForm((f) => ({ ...f, title: e.target.value }))} />
            <div className="row-wrap" style={{ gap: 8 }}>
              <select className="select" style={{ width: 120 }} value={newForm.degree_level} onChange={(e) => setNewForm((f) => ({ ...f, degree_level: e.target.value }))}>
                {DEGREE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <input className="input" style={{ flex: 1 }} placeholder="Programme" value={newForm.programme} onChange={(e) => setNewForm((f) => ({ ...f, programme: e.target.value }))} />
              <input className="input" style={{ width: 120 }} placeholder="Acad. Year" value={newForm.academic_year} onChange={(e) => setNewForm((f) => ({ ...f, academic_year: e.target.value }))} />
            </div>
            <div className="row-wrap" style={{ gap: 8 }}>
              <input className="input" style={{ flex: 1 }} placeholder="Research Area (e.g., Green Procurement, AI in SCM)" value={newForm.research_area} onChange={(e) => setNewForm((f) => ({ ...f, research_area: e.target.value }))} />
              <input type="date" className="input" style={{ width: 165 }} value={newForm.target_defence_date} onChange={(e) => setNewForm((f) => ({ ...f, target_defence_date: e.target.value }))} title="Target Defence Date" />
            </div>
            <div className="tiny muted">
              Milestone pipeline ({getMilestonesForDegree(newForm.degree_level).length} stages) will be pre-populated automatically for <strong>{newForm.degree_level}</strong>.
            </div>
          </form>
        </Modal>
      )}

      {/* Bulk Import Modal */}
      {bulkOpen && (
        <Modal
          title="Bulk Import Supervisees"
          onClose={() => setBulkOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setBulkOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={bulkBusy} onClick={handleBulkImport}>
                {bulkBusy ? 'Importing…' : 'Import Supervisees'}
              </button>
            </>
          }
        >
          <div className="stack-sm">
            <div className="small muted">
              Paste rows from Excel or CSV: <code className="mono">Index No, Full Name, Thesis Topic (optional), Programme (optional)</code>
            </div>
            <div className="row-wrap" style={{ gap: 8 }}>
              <select className="select" style={{ width: 130 }} value={bulkDegree} onChange={(e) => setBulkDegree(e.target.value)}>
                {DEGREE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <input className="input" style={{ width: 150 }} value={bulkYear} onChange={(e) => setBulkYear(e.target.value)} placeholder="2026/2027" />
            </div>
            <textarea
              className="textarea mono"
              rows={8}
              placeholder={'PSCM/22/001, Ama Mensah, Sustainable Public Procurement in Ghana\nPSCM/22/014, Kwame Boateng, Inventory Resilience in Hospital Supply Chains'}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
          </div>
        </Modal>
      )}

      {/* SQL Modal */}
      {sqlModalOpen && (
        <Modal title="Thesis Portal Database SQL" wide onClose={() => setSqlModalOpen(false)}>
          <div className="stack-sm">
            <div className="row-wrap" style={{ gap: 8 }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => { navigator.clipboard?.writeText(THESIS_PORTAL_SQL); toast('Copied SQL!'); }}>
                Copy Full SQL
              </button>
              <button type="button" className="btn btn-sm" onClick={() => downloadText('thesis-portal.sql', THESIS_PORTAL_SQL, 'application/sql')}>
                Download thesis-portal.sql
              </button>
            </div>
            <pre className="mono tiny" style={{ maxHeight: 360, overflow: 'auto', padding: 12, background: 'var(--surface-2)', borderRadius: 8 }}>
              {THESIS_PORTAL_SQL}
            </pre>
          </div>
        </Modal>
      )}

      {/* Confirm Delete */}
      {deleteTarget && (
        <Confirm
          title="Remove thesis supervisee?"
          message={`Remove ${deleteTarget.student_name} (${deleteTarget.student_index_no}) and their thesis milestones/logs from this portal?`}
          confirmLabel="Remove"
          danger
          onConfirm={handleDeleteProject}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* Inline PDF Annotator */}
      {annotatorSub && annotatorSub.kind === 'pdf' && (
        <PdfAnnotatorModal
          bucket="theses"
          submissionId={annotatorSub.sub.id}
          filePath={annotatorSub.sub.file_path}
          fileName={annotatorSub.sub.file_name}
          studentLabel={`${activeProject?.student_name || ''} · ${annotatorSub.milestone.title} (v${annotatorSub.sub.version_no})`}
          titleLabel={`Thesis PDF Review — ${annotatorSub.milestone.title} v${annotatorSub.sub.version_no}`}
          initialAnnotations={annotatorSub.sub.annotations || []}
          snippets={THESIS_ANNOTATION_SNIPPETS}
          hideDelta
          onSaveAnnotations={async (anns) => {
            await rpc('save_thesis_annotations', { p_submission_id: annotatorSub.sub.id, p_annotations: anns });
            return anns;
          }}
          onSaved={() => loadAll()}
          onClose={() => setAnnotatorSub(null)}
        />
      )}

      {/* Inline Word (.docx) Annotator */}
      {annotatorSub && annotatorSub.kind === 'docx' && (
        <DocxAnnotatorModal
          bucket="theses"
          filePath={annotatorSub.sub.file_path}
          fileName={annotatorSub.sub.file_name}
          reviewedFilePath={annotatorSub.sub.reviewed_file_path}
          reviewedFileName={annotatorSub.sub.reviewed_file_name}
          studentLabel={`${activeProject?.student_name || ''} · ${annotatorSub.milestone.title} (v${annotatorSub.sub.version_no})`}
          titleLabel={`Thesis Word Review — ${annotatorSub.milestone.title} v${annotatorSub.sub.version_no}`}
          initialAnnotations={annotatorSub.sub.annotations || []}
          snippets={THESIS_ANNOTATION_SNIPPETS}
          onSaveAnnotations={async (anns) => {
            await rpc('save_thesis_annotations', { p_submission_id: annotatorSub.sub.id, p_annotations: anns });
            return anns;
          }}
          onSaved={() => loadAll()}
          onClose={() => setAnnotatorSub(null)}
        />
      )}
    </>
  );
}
