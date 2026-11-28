import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Topbar } from '../../components/Layout.jsx';
import Icon from '../../components/Icon.jsx';
import { Bar, Empty, Loading, Tabs, useToast } from '../../components/ui.jsx';
import PdfAnnotatorModal from '../../components/PdfAnnotatorModal.jsx';
import DocxAnnotatorModal from '../../components/DocxAnnotatorModal.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { openStoredFile, uploadFile } from '../../lib/files.js';
import { fmtBytes, fmtDate, fmtDateTime } from '../../lib/format.js';
import { rpc, safeFileName, supabase } from '../../lib/supabase.js';
import {
  ETHICS_STATUS_META,
  MILESTONE_STATUS_META,
  PROJECT_STATUS_META,
  THESIS_RUBRIC_CRITERIA,
  analyzeProjectHealth,
  computeThesisRubricTotal,
  detectThesisFileKind,
  validateThesisUploadFile,
} from '../../lib/thesisEngine.js';

export default function ThesisPortal() {
  const { session } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [notSetup, setNotSetup] = useState(false);
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(() => searchParams.get('project') || '');
  const [milestones, setMilestones] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [messages, setMessages] = useState([]);
  const [tab, setTab] = useState('chapters'); // chapters | messages | meetings

  // Per-milestone upload draft state
  const [noteByMilestone, setNoteByMilestone] = useState({});
  const [uploadingMilestoneId, setUploadingMilestoneId] = useState(null);

  // Message composer
  const [msgText, setMsgText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [ackBusyId, setAckBusyId] = useState(null);

  // Viewer modal (read-only + student replies)
  const [viewerSub, setViewerSub] = useState(null); // { sub, milestone, kind }

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      // Auto-link any thesis project assigned to this student's index number
      await rpc('claim_my_thesis_projects').catch(() => {});

      const { data: projs, error: pErr } = await supabase
        .from('thesis_projects')
        .select('*')
        .order('created_at', { ascending: false });

      if (pErr) {
        if (/relation .* does not exist|schema cache|42P01/i.test(pErr.message || '')) {
          setNotSetup(true);
          setLoading(false);
          return;
        }
        throw pErr;
      }

      setNotSetup(false);
      const list = projs || [];
      setProjects(list);
      if (!list.length) {
        setMilestones([]);
        setSubmissions([]);
        setMeetings([]);
        setMessages([]);
        setLoading(false);
        return;
      }

      const qp = searchParams.get('project');
      const targetId = (qp && list.some((p) => p.id === qp))
        ? qp
        : (selectedId && list.some((p) => p.id === selectedId) ? selectedId : list[0].id);
      setSelectedId(targetId);

      const [mRes, sRes, mtRes, msgRes] = await Promise.all([
        supabase.from('thesis_milestones').select('*').eq('project_id', targetId).order('sort_order', { ascending: true }),
        supabase.from('thesis_submissions').select('*').eq('project_id', targetId).order('version_no', { ascending: false }),
        supabase.from('thesis_meetings').select('*').eq('project_id', targetId).order('meeting_date', { ascending: false }),
        supabase.from('thesis_messages').select('*').eq('project_id', targetId).order('created_at', { ascending: true }),
      ]);

      setMilestones(mRes.data || []);
      setSubmissions(sRes.data || []);
      setMeetings(mtRes.data || []);
      setMessages(msgRes.data || []);
    } catch (err) {
      toast(err.message || 'Could not load your thesis workspace.', 'error');
    } finally {
      setLoading(false);
    }
  }, [searchParams, selectedId, toast]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === selectedId) || projects[0] || null,
    [projects, selectedId],
  );

  const health = useMemo(
    () => (activeProject ? analyzeProjectHealth(activeProject, milestones, submissions, meetings) : null),
    [activeProject, milestones, submissions, meetings],
  );

  const rubric = useMemo(
    () => computeThesisRubricTotal(activeProject?.rubric_scores || {}),
    [activeProject?.rubric_scores],
  );

  async function handleUploadDraft(milestone, file) {
    if (!activeProject || !session?.user?.id) return;
    const check = validateThesisUploadFile(file);
    if (!check.ok) {
      toast(check.error, 'error');
      return;
    }
    setUploadingMilestoneId(milestone.id);
    try {
      const storagePath = `${activeProject.id}/${milestone.id}/${session.user.id}/${Date.now()}_${safeFileName(file.name)}`;
      await uploadFile('theses', storagePath, file);
      const res = await rpc('submit_thesis_version', {
        p_project_id: activeProject.id,
        p_milestone_id: milestone.id,
        p_file_path: storagePath,
        p_file_name: file.name,
        p_file_size: file.size || 0,
        p_mime_type: file.type || '',
        p_student_note: (noteByMilestone[milestone.id] || '').trim(),
      });
      setNoteByMilestone((prev) => ({ ...prev, [milestone.id]: '' }));
      toast(`Uploaded v${res?.version_no || ''} for ${milestone.title}! Your supervisor has been notified.`);
      await loadWorkspace();
    } catch (err) {
      toast(err.message || 'Could not upload chapter draft.', 'error');
    } finally {
      setUploadingMilestoneId(null);
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
      toast('Message sent to your supervisor.');
      await loadWorkspace();
    } catch (err) {
      toast(err.message || 'Could not send message.', 'error');
    } finally {
      setSendingMsg(false);
    }
  }

  async function handleAcknowledgeMeeting(meetingId) {
    setAckBusyId(meetingId);
    try {
      await rpc('acknowledge_thesis_meeting', { p_meeting_id: meetingId });
      toast('Meeting minutes acknowledged.');
      await loadWorkspace();
    } catch (err) {
      toast(err.message || 'Could not acknowledge meeting.', 'error');
    } finally {
      setAckBusyId(null);
    }
  }

  if (loading) {
    return (
      <>
        <Topbar title="My Thesis Supervision" sub="Chapters, inline supervisor feedback & meeting logs" />
        <div className="page"><Loading label="Opening your thesis workspace…" /></div>
      </>
    );
  }

  if (notSetup || !activeProject) {
    return (
      <>
        <Topbar title="My Thesis Supervision" sub="Standalone dissertation & project supervision portal" />
        <div className="page">
          <Empty icon="award" title="No active thesis supervision assigned yet">
            Once your thesis supervisor adds your index number to the Thesis Supervision Portal, your chapter milestones, annotated drafts, and meeting logs will appear here automatically.
          </Empty>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title="My Thesis Supervision"
        sub={`${activeProject.degree_level} · ${activeProject.programme || 'Research Supervision'}`}
      >
        {projects.length > 1 && (
          <select
            className="select"
            style={{ width: 220 }}
            value={activeProject.id}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setSearchParams({ project: e.target.value }, { replace: true });
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.degree_level}: {p.title.slice(0, 42)}</option>
            ))}
          </select>
        )}
        <button type="button" className="btn btn-sm" onClick={loadWorkspace}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </Topbar>

      <div className="page stack">
        {/* Thesis Overview Card */}
        <div className="card stack-sm" style={{ padding: 20 }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div className="stack-sm" style={{ gap: 4 }}>
              <div className="row-wrap" style={{ gap: 8 }}>
                <span className="badge badge-blue">{activeProject.degree_level}</span>
                <span className={`badge ${PROJECT_STATUS_META[activeProject.status]?.cls || 'badge-blue'}`}>
                  {PROJECT_STATUS_META[activeProject.status]?.label || activeProject.status}
                </span>
                <span className={`badge ${ETHICS_STATUS_META[activeProject.ethics_status]?.cls || 'badge-muted'}`}>
                  {ETHICS_STATUS_META[activeProject.ethics_status]?.label || activeProject.ethics_status}
                </span>
                {activeProject.academic_year && <span className="mono tiny muted">{activeProject.academic_year}</span>}
              </div>
              <h2 style={{ margin: '4px 0 0' }}>{activeProject.title}</h2>
              {activeProject.target_defence_date && (
                <div className="tiny muted">Target Defence Date: <strong>{fmtDate(activeProject.target_defence_date)}</strong></div>
              )}
            </div>
            <div className="card-soft" style={{ padding: '10px 16px', minWidth: 180 }}>
              <div className="tiny muted">Overall Completion</div>
              <strong className="mono" style={{ fontSize: 22, color: 'var(--teal)' }}>{health?.progressPct || 0}%</strong>
              <div className="tiny muted">{health?.approvedCount || 0} of {health?.totalMilestones || 0} stages approved</div>
            </div>
          </div>
          <Bar value={health?.progressPct || 0} color="var(--teal)" />
          <div className="notice notice-info tiny">
            <strong>Best Practice:</strong> Upload chapter drafts as <strong>PDF</strong> (or Word <code>.docx</code>) so your supervisor can pin comments directly onto specific pages/paragraphs — you will get an instant notification and can reply to each comment right inside this portal.
          </div>
        </div>

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'chapters', label: `Chapters & Drafts (${milestones.length})` },
            { id: 'messages', label: `Supervisor Messages (${messages.length})` },
            { id: 'meetings', label: `Meeting Log (${meetings.length})` },
          ]}
        />

        {/* TAB 1: CHAPTERS & SUBMISSIONS */}
        {tab === 'chapters' && (
          <div className="stack">
            {milestones.map((m, idx) => {
              const mSubs = submissions.filter((s) => s.milestone_id === m.id);
              const st = MILESTONE_STATUS_META[m.status] || MILESTONE_STATUS_META.not_started;
              const isUploading = uploadingMilestoneId === m.id;
              return (
                <div key={m.id} className="card stack-sm" style={{ padding: 16, borderLeft: `4px solid ${st.color}` }}>
                  <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div className="row-wrap" style={{ gap: 8 }}>
                      <span className="mono tiny muted">Stage {idx + 1}</span>
                      <strong className="small">{m.title}</strong>
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                    </div>
                    {m.due_date && <span className="tiny muted">Target Date: <strong>{fmtDate(m.due_date)}</strong></span>}
                  </div>

                  {/* Upload new draft version */}
                  <div className="card-soft row-wrap" style={{ padding: 10, gap: 8, alignItems: 'center' }}>
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 200, minHeight: 34, fontSize: 13 }}
                      placeholder={mSubs.length ? 'Note what you revised in this new version (e.g., Added 2024 citations & fixed Table 4.2)…' : 'Optional note to your supervisor with this draft…'}
                      value={noteByMilestone[m.id] || ''}
                      onChange={(e) => setNoteByMilestone((prev) => ({ ...prev, [m.id]: e.target.value }))}
                    />
                    <label className="btn btn-sm btn-primary" style={{ cursor: isUploading ? 'wait' : 'pointer' }}>
                      <Icon name="upload" size={14} /> {isUploading ? 'Uploading…' : mSubs.length ? `Upload v${(m.latest_version_no || mSubs.length) + 1}` : 'Upload Draft (PDF / DOCX)'}
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,.xlsx,.pptx,.zip"
                        style={{ display: 'none' }}
                        disabled={isUploading}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) handleUploadDraft(m, f);
                        }}
                      />
                    </label>
                  </div>

                  {/* Version History & Supervisor Feedback */}
                  {mSubs.length > 0 && (
                    <div className="stack-sm">
                      {mSubs.map((sub) => {
                        const fileKind = detectThesisFileKind(sub.file_name, sub.mime_type);
                        const anns = Array.isArray(sub.annotations) ? sub.annotations : [];
                        const openCount = anns.filter((a) => !a.studentResolved).length;
                        const revMeta = MILESTONE_STATUS_META[sub.review_status === 'pending' ? 'submitted' : sub.review_status] || MILESTONE_STATUS_META.submitted;
                        return (
                          <div key={sub.id} className="card-soft stack-sm" style={{ padding: 12, background: 'var(--surface)' }}>
                            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                              <div className="row-wrap" style={{ gap: 8 }}>
                                <span className="badge badge-blue mono">v{sub.version_no}</span>
                                <strong className="small">{sub.file_name}</strong>
                                <span className={`badge ${revMeta.cls}`}>{revMeta.label}</span>
                                <span className="tiny muted">{fmtBytes(sub.file_size)} · {fmtDateTime(sub.submitted_at)}</span>
                              </div>
                              <div className="row-wrap" style={{ gap: 6 }}>
                                {(fileKind === 'pdf' || fileKind === 'docx') && (
                                  <button
                                    type="button"
                                    className={`btn btn-sm ${anns.length > 0 ? 'btn-primary' : ''}`}
                                    onClick={() => setViewerSub({ sub, milestone: m, kind: fileKind })}
                                  >
                                    <Icon name="eye" size={14} />{' '}
                                    {anns.length > 0
                                      ? `View Annotated ${fileKind.toUpperCase()} (${anns.length} comment${anns.length === 1 ? '' : 's'}${openCount ? ` · ${openCount} open` : ' ✓'})`
                                      : `Preview ${fileKind.toUpperCase()}`}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => openStoredFile('theses', sub.file_path).catch((e) => toast(e.message, 'error'))}
                                >
                                  <Icon name="download" size={14} /> My File
                                </button>
                                {sub.reviewed_file_path && (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-primary"
                                    onClick={() => openStoredFile('theses', sub.reviewed_file_path).catch((e) => toast(e.message, 'error'))}
                                  >
                                    <Icon name="download" size={14} /> Supervisor’s Track-Changes Copy
                                  </button>
                                )}
                              </div>
                            </div>

                            {sub.student_note && (
                              <div className="tiny muted"><strong>Your Note:</strong> {sub.student_note}</div>
                            )}

                            {sub.supervisor_feedback && (
                              <div className="small" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', borderLeft: '3px solid var(--teal)' }}>
                                <div className="tiny muted" style={{ marginBottom: 4 }}>
                                  <strong>Supervisor Feedback</strong> {sub.reviewed_at ? `· ${fmtDateTime(sub.reviewed_at)}` : ''}
                                </div>
                                <div className="pre">{sub.supervisor_feedback}</div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {rubric.filled > 0 && (
              <div className="card stack-sm" style={{ padding: 16 }}>
                <div className="between">
                  <strong className="small">Supervisor Readiness Evaluation</strong>
                  <span className="badge badge-teal mono">{rubric.earned} / {rubric.maxTotal} ({rubric.gradeBand})</span>
                </div>
                <div className="stack-sm">
                  {THESIS_RUBRIC_CRITERIA.map((c) => {
                    const val = activeProject.rubric_scores?.[c.id];
                    if (val === undefined || val === '') return null;
                    return (
                      <div key={c.id} className="between small" style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                        <span>{c.label}</span>
                        <strong className="mono">{val} / {c.max}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: MESSAGES */}
        {tab === 'messages' && (
          <div className="card stack-sm" style={{ padding: 16 }}>
            <div className="stack-sm" style={{ maxHeight: 380, overflowY: 'auto', padding: 8, background: 'var(--surface-2)', borderRadius: 10 }}>
              {messages.length === 0 ? (
                <div className="small muted" style={{ padding: 20, textAlign: 'center' }}>
                  No messages yet. Ask your supervisor a question here instead of sending scattered emails.
                </div>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_role === 'student';
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
                placeholder="Write a message to your supervisor…"
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={sendingMsg || !msgText.trim()}>
                {sendingMsg ? 'Sending…' : 'Send'}
              </button>
            </form>
          </div>
        )}

        {/* TAB 3: MEETING LOG */}
        {tab === 'meetings' && (
          <div className="stack-sm">
            {meetings.length === 0 ? (
              <Empty icon="calendar" title="No supervision meetings logged yet">
                When your supervisor records supervision meeting notes and agreed action items, they will appear here for you to review and acknowledge.
              </Empty>
            ) : (
              meetings.map((mt) => (
                <div key={mt.id} className="card stack-sm" style={{ padding: 16 }}>
                  <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div className="row-wrap" style={{ gap: 8 }}>
                      <strong className="small">{fmtDateTime(mt.meeting_date)}</strong>
                      <span className="badge badge-blue">{mt.mode === 'in_person' ? 'In-Person' : mt.mode === 'online' ? 'Online' : 'Phone'}</span>
                      {mt.next_meeting_date && <span className="tiny muted">Next Meeting: <strong>{fmtDate(mt.next_meeting_date)}</strong></span>}
                    </div>
                    {mt.student_acknowledged_at ? (
                      <span className="badge badge-teal">Acknowledged ✓ ({fmtDate(mt.student_acknowledged_at)})</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={ackBusyId === mt.id}
                        onClick={() => handleAcknowledgeMeeting(mt.id)}
                      >
                        {ackBusyId === mt.id ? 'Confirming…' : 'Acknowledge Minutes ✓'}
                      </button>
                    )}
                  </div>
                  <div className="small pre">{mt.summary}</div>
                  {Array.isArray(mt.action_items) && mt.action_items.length > 0 && (
                    <div className="stack-sm" style={{ gap: 4 }}>
                      <div className="tiny muted"><strong>Agreed Action Items:</strong></div>
                      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                        {mt.action_items.map((it, i) => (
                          <li key={i}>{typeof it === 'string' ? it : it.text}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Student Read-Only + Reply PDF Annotator */}
      {viewerSub && viewerSub.kind === 'pdf' && (
        <PdfAnnotatorModal
          bucket="theses"
          submissionId={viewerSub.sub.id}
          filePath={viewerSub.sub.file_path}
          fileName={viewerSub.sub.file_name}
          studentLabel={`${viewerSub.milestone.title} · v${viewerSub.sub.version_no}`}
          titleLabel={`Supervisor Annotations — ${viewerSub.milestone.title} v${viewerSub.sub.version_no}`}
          initialAnnotations={viewerSub.sub.annotations || []}
          readOnly
          allowStudentReplies
          onReplyAnnotation={async (pinId, replyText, resolved) => {
            const updated = await rpc('reply_thesis_annotation', {
              p_submission_id: viewerSub.sub.id,
              p_annotation_id: pinId,
              p_reply: replyText,
              p_resolved: resolved,
            });
            await loadWorkspace();
            return updated;
          }}
          onClose={() => setViewerSub(null)}
        />
      )}

      {/* Student Read-Only + Reply DOCX Annotator */}
      {viewerSub && viewerSub.kind === 'docx' && (
        <DocxAnnotatorModal
          bucket="theses"
          filePath={viewerSub.sub.file_path}
          fileName={viewerSub.sub.file_name}
          reviewedFilePath={viewerSub.sub.reviewed_file_path}
          reviewedFileName={viewerSub.sub.reviewed_file_name}
          studentLabel={`${viewerSub.milestone.title} · v${viewerSub.sub.version_no}`}
          titleLabel={`Supervisor Comments — ${viewerSub.milestone.title} v${viewerSub.sub.version_no}`}
          initialAnnotations={viewerSub.sub.annotations || []}
          readOnly
          allowStudentReplies
          onReplyAnnotation={async (pinId, replyText, resolved) => {
            const updated = await rpc('reply_thesis_annotation', {
              p_submission_id: viewerSub.sub.id,
              p_annotation_id: pinId,
              p_reply: replyText,
              p_resolved: resolved,
            });
            await loadWorkspace();
            return updated;
          }}
          onClose={() => setViewerSub(null)}
        />
      )}
    </>
  );
}
