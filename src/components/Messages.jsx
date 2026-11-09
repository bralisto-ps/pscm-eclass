import { useState } from 'react';
import { run, supabase } from '../lib/supabase.js';
import { relative } from '../lib/format.js';
import Icon from './Icon.jsx';
import { Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad } from './ui.jsx';

export default function Messages({ course, isLecturer, studentIndex, studentName }) {
  const { data, error, loading, reload } = useLoad(async () => {
    let q = supabase
      .from('course_messages')
      .select('*, profiles:student_id(full_name, index_no)')
      .eq('course_id', course.id)
      .order('created_at', { ascending: false });
    return run(q);
  }, [course.id]);

  const [sending, setSending] = useState(false);
  const [replying, setReplying] = useState(null);
  const [filter, setFilter] = useState('all'); // all | unreplied | replied

  const [act, busy] = useAction();

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  const list = (data || []).filter((m) => {
    if (filter === 'unreplied') return !m.reply;
    if (filter === 'replied') return !!m.reply;
    return true;
  });

  return (
    <div className="stack" style={{ maxWidth: 840 }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2>{isLecturer ? 'Student inquiries & office hours' : 'Message your lecturer'}</h2>
          <p className="small muted">
            {isLecturer
              ? 'Private messages sent to you by students in this course.'
              : 'Send a private message or inquiry directly to your course lecturer.'}
          </p>
        </div>
        {!isLecturer && (
          <button type="button" className="btn btn-primary" onClick={() => setSending(true)}>
            <Icon name="plus" size={16} /> New message
          </button>
        )}
      </div>

      {isLecturer && (
        <div className="chips" role="group" aria-label="Filter messages">
          <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All ({data?.length || 0})
          </button>
          <button type="button" className="chip" aria-pressed={filter === 'unreplied'} onClick={() => setFilter('unreplied')}>
            Needs reply ({data?.filter((m) => !m.reply).length || 0})
          </button>
          <button type="button" className="chip" aria-pressed={filter === 'replied'} onClick={() => setFilter('replied')}>
            Replied ({data?.filter((m) => m.reply).length || 0})
          </button>
        </div>
      )}

      {list.length === 0 && (
        <div className="card">
          <Empty icon="chat" title={isLecturer ? 'No messages from students yet' : 'No messages yet'}>
            {isLecturer
              ? 'When students send private inquiries or questions, they will appear here.'
              : 'Have a question about a grade, missed class, or topic? Click "New message" to contact your lecturer.'}
          </Empty>
        </div>
      )}

      {list.map((m) => (
        <div key={m.id} className="card stack-sm" style={{ borderLeft: m.reply ? '4px solid var(--teal)' : '4px solid var(--amber)' }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              {isLecturer && (
                <strong className="small">
                  {m.profiles?.full_name || 'Student'} ({m.profiles?.index_no || 'No Index'})
                </strong>
              )}
              <span className="small muted">· {relative(m.created_at)}</span>
            </div>
            {m.reply ? (
              <span className="badge badge-teal">Replied</span>
            ) : (
              <span className="badge badge-amber">Awaiting reply</span>
            )}
          </div>

          <h3 style={{ margin: '4px 0' }}>{m.subject || 'Course inquiry'}</h3>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{m.message}</p>

          {m.reply && (
            <div className="card-soft stack-sm" style={{ marginTop: 12, padding: '12px 16px', background: 'var(--teal-50)' }}>
              <div className="row" style={{ gap: 8 }}>
                <strong className="small" style={{ color: 'var(--teal-dark)' }}>Lecturer Reply:</strong>
                {m.replied_at && <span className="tiny muted">{relative(m.replied_at)}</span>}
              </div>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{m.reply}</p>
            </div>
          )}

          {isLecturer && !m.reply && (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => setReplying(m)}>
                <Icon name="chat" size={14} /> Reply to student
              </button>
            </div>
          )}
        </div>
      ))}

      {sending && (
        <NewMessageModal courseId={course.id} onClose={() => setSending(false)} onSent={reload} />
      )}

      {replying && (
        <ReplyModal message={replying} onClose={() => setReplying(null)} onReplied={reload} />
      )}
    </div>
  );
}

function NewMessageModal({ courseId, onClose, onSent }) {
  const [act, busy] = useAction();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  async function send(e) {
    e?.preventDefault();
    if (!message.trim()) throw new Error('Please enter your message.');
    await act(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      await run(
        supabase.from('course_messages').insert({
          course_id: courseId,
          student_id: user.id,
          subject: subject.trim() || 'General inquiry',
          message: message.trim(),
        })
      );
    }, 'Message sent to lecturer.');
    onSent();
    onClose();
  }

  return (
    <Modal title="Message course lecturer" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={send} disabled={busy}>Send message</button></>}>
      <form onSubmit={send} className="stack">
        <Field label="Subject (optional)">
          <input className="input" placeholder="e.g. Question on Quiz 1, Missed Class excuse..." value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Message *">
          <textarea className="input" rows={5} placeholder="Write your message here..." value={message} onChange={(e) => setMessage(e.target.value)} required autoFocus />
        </Field>
      </form>
    </Modal>
  );
}

function ReplyModal({ message, onClose, onReplied }) {
  const [act, busy] = useAction();
  const [replyText, setReplyText] = useState('');

  async function saveReply(e) {
    e?.preventDefault();
    if (!replyText.trim()) throw new Error('Please type your reply.');
    await act(
      () =>
        run(
          supabase
            .from('course_messages')
            .update({ reply: replyText.trim(), replied_at: new Date().toISOString() })
            .eq('id', message.id)
        ),
      'Reply sent to student.'
    );
    onReplied();
    onClose();
  }

  return (
    <Modal title={`Reply to ${message.profiles?.full_name || 'student'}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={saveReply} disabled={busy}>Send reply</button></>}>
      <div className="stack">
        <div className="card-soft stack-sm" style={{ padding: 12 }}>
          <strong className="small">{message.subject}</strong>
          <p className="small muted" style={{ margin: 0 }}>{message.message}</p>
        </div>
        <Field label="Your reply *">
          <textarea className="input" rows={4} placeholder="Type your response to the student..." value={replyText} onChange={(e) => setReplyText(e.target.value)} required autoFocus />
        </Field>
      </div>
    </Modal>
  );
}
