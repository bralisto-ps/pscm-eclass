import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { rpc, run, supabase } from '../../lib/supabase.js';
import { fillVars, fmtNumber, initials } from '../../lib/format.js';
import Icon from '../../components/Icon.jsx';
import { ErrorNote, Loading, Modal, Swatch, useLoad, useToast } from '../../components/ui.jsx';
import { uploadProctorSnapshot } from '../../lib/proctorPhotos.js';
import { deviceLabel } from '../../lib/device.js';
import { cleanText, FORMAT_LABELS, getQuestionTimeLimit, parseQuizMeta } from '../../lib/quizMeta.js';

const LETTERS = 'ABCDEFGHIJ';

function isAnswered(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

function readFlags(id) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`flags:${id}`) || '[]'));
  } catch {
    return new Set();
  }
}
function writeFlags(id, set) {
  try {
    localStorage.setItem(`flags:${id}`, JSON.stringify([...set]));
  } catch {
    /* private browsing: flags just won't persist */
  }
}

const queueKey = (attemptId) => `pscm_quiz_queue_${attemptId}`;

function readAnswerQueue(attemptId) {
  if (!attemptId) return {};
  try {
    const raw = localStorage.getItem(queueKey(attemptId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAnswerQueue(attemptId, map) {
  if (!attemptId) return;
  try {
    const keys = Object.keys(map || {});
    if (keys.length === 0) localStorage.removeItem(queueKey(attemptId));
    else localStorage.setItem(queueKey(attemptId), JSON.stringify(map));
  } catch {
    /* storage quota or private browsing */
  }
}

function upsertQueuedAnswer(attemptId, qid, value) {
  const cur = readAnswerQueue(attemptId);
  cur[qid] = { value, updatedAt: Date.now() };
  writeAnswerQueue(attemptId, cur);
}

function removeQueuedAnswer(attemptId, qid) {
  const cur = readAnswerQueue(attemptId);
  if (qid in cur) {
    delete cur[qid];
    writeAnswerQueue(attemptId, cur);
  }
}

function clearAnswerQueue(attemptId) {
  if (!attemptId) return;
  try { localStorage.removeItem(queueKey(attemptId)); } catch {}
}


function AntiCameraShield({ text, blurred, onResume }) {
  const safe = String(text || 'CONFIDENTIAL EXAM · E-CLASS PSCM').replace(/[<>&'"]/g, '');
  // Subtle 6% opacity watermark: visible on phone camera sensors while transparent to reading text
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='440' height='260'>
    <text x='30' y='130' transform='rotate(-20 220 130)' fill='rgba(15,23,42,0.06)' font-family='Arial, sans-serif' font-size='18' font-weight='600' letter-spacing='0.5px'>${safe}</text>
  </svg>`;
  // Fine grid mesh pattern disrupts digital camera sensor focusing and AI OCR text extraction
  const meshSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'>
    <circle cx='2' cy='2' r='1.1' fill='rgba(0,0,0,0.06)'/>
    <circle cx='6' cy='6' r='1.1' fill='rgba(0,0,0,0.035)'/>
    <line x1='0' y1='4' x2='8' y2='4' stroke='rgba(0,0,0,0.02)' stroke-width='0.5'/>
  </svg>`;
  return (
    <>
      <div aria-hidden="true" style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 30,
        backgroundImage: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`,
      }} />
      <div aria-hidden="true" style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 29,
        backgroundImage: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(meshSvg)}")`,
      }} />
      <div className="anti-camera-scanline" aria-hidden="true" />
      <div aria-hidden="true" style={{
        position: 'fixed', bottom: 12, right: 16, zIndex: 31, pointerEvents: 'none',
        background: 'rgba(15, 23, 42, 0.82)', color: '#fff', padding: '5px 10px',
        borderRadius: 8, fontSize: 10, fontWeight: 600, letterSpacing: '0.5px',
        display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        <span>🔒 ANTI-CHEAT ACTIVE</span>
        <span style={{ opacity: 0.6 }}>·</span>
        <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{safe}</span>
      </div>
      {blurred && (
        <div onClick={onResume} style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(34px)', WebkitBackdropFilter: 'blur(34px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center',
          cursor: 'pointer',
        }}>
          <div className="card stack" style={{ maxWidth: 460, padding: 36, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)', border: '2px solid var(--amber, #f59e0b)' }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#fef3c7', color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontSize: 30 }}>
              ⚠️
            </div>
            <h2 style={{ margin: '8px 0 0', color: '#111827' }}>
              {blurred === 'zoom' ? 'Browser Zoom-Out Blocked' : 'Exam Content Protected & Blurred'}
            </h2>
            <p className="small muted" style={{ margin: '8px 0 16px', lineHeight: 1.6 }}>
              {blurred === 'zoom'
                ? 'Zooming out (Ctrl + - or browser zoom) is not allowed during an exam. Press Ctrl + 0 (or Cmd + 0 on Mac) to reset your browser zoom to 100% and continue.'
                : 'The quiz window is currently not in focus, was resized, or you switched to another tab. All screen exits and unfocus events are logged for your lecturer.'}
            </p>
            <button type="button" className="btn btn-primary" style={{ minHeight: 44, fontWeight: 600 }} onClick={(e) => { e.stopPropagation(); onResume?.(); }}>
              {blurred === 'zoom' ? 'I Reset Zoom to 100% — Resume Exam' : 'Click Here to Resume Exam'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function SelfieModal({ attemptId, onPhotoCaptured, onDone }) {
  const [videoStream, setVideoStream] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [err, setErr] = useState('');
  const videoRef = useRef(null);

  useEffect(() => {
    let s = null;
    navigator.mediaDevices?.getUserMedia?.({ video: { facingMode: 'user', width: 240, height: 180 } })
      .then((stream) => {
        s = stream;
        setVideoStream(stream);
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((e) => setErr('Camera access not available or blocked: ' + e.message));
    return () => {
      s?.getTracks?.().forEach((t) => t.stop());
    };
  }, []);

  function takePhoto() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    // Ultralight 240x180 thumbnail (~5KB)
    canvas.width = 240;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.45);
    setPhoto(dataUrl);
    try {
      localStorage.setItem(`selfie_img:${attemptId}`, dataUrl);
      localStorage.setItem(`selfie:${attemptId}`, 'done');
    } catch {}
    // Non-blocking background upload
    onPhotoCaptured?.(dataUrl);
  }

  function finish() {
    localStorage.setItem(`selfie:${attemptId}`, 'done');
    videoStream?.getTracks?.().forEach((t) => t.stop());
    onDone();
  }

  return (
    <Modal title="Identity Verification Check"
      footer={
        photo ? (
          <button type="button" className="btn btn-primary" onClick={finish}>Continue Exam</button>
        ) : (
          <>
            {err && <button type="button" className="btn btn-ghost" onClick={finish}>Skip (Camera Unavailable)</button>}
            <button type="button" className="btn btn-primary" onClick={takePhoto} disabled={!videoStream}>
              Take Verification Photo
            </button>
          </>
        )
      }>
      <div className="stack" style={{ textAlign: 'center', alignItems: 'center' }}>
        <p className="small muted">Please face the camera directly to verify your identity before continuing.</p>
        {photo ? (
          <div style={{ maxWidth: 280, borderRadius: 8, overflow: 'hidden', border: '2px solid var(--teal)' }}>
            <img src={photo} alt="Verification selfie" style={{ width: '100%', display: 'block' }} />
          </div>
        ) : (
          <div style={{ width: 240, height: 180, background: '#111', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {err && <div style={{ position: 'absolute', inset: 0, padding: 12, color: '#fff', fontSize: 13, display: 'flex', alignItems: 'center' }}>{err}</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

const canFullscreen = () =>
  typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && !/iPhone|iPad|iPod/.test(navigator.userAgent);

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export default function TakeQuiz() {
  const { attemptId } = useParams();
  const { data, error, loading, reload } = useLoad(async () => {
    const res = await rpc('get_attempt', { p_attempt: attemptId, p_device: deviceLabel() });
    if (!res) return null;
    try {
      if (res.quiz?.id) {
        const { data: qRow } = await supabase
          .from('quizzes')
          .select('question_time_limit, lockdown, max_exits, no_backtrack, title, instructions')
          .eq('id', res.quiz.id)
          .maybeSingle();
        if (qRow) {
          res.quiz = {
            ...res.quiz,
            instructions: qRow.instructions ?? res.quiz.instructions,
            question_time_limit: qRow.question_time_limit ?? res.quiz.question_time_limit,
            lockdown: qRow.lockdown ?? res.quiz.lockdown,
            max_exits: qRow.max_exits ?? res.quiz.max_exits,
            no_backtrack: qRow.no_backtrack ?? res.quiz.no_backtrack,
          };
        }
      }
      const parsedMeta = parseQuizMeta(res.quiz);
      res.quiz = {
        ...res.quiz,
        quizMeta: parsedMeta,
        instructions: parsedMeta.cleanInstructions,
      };
      if (!res.student || !res.student.name) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('full_name, index_no')
            .eq('id', user.id)
            .maybeSingle();
          if (prof) {
            res.student = { name: prof.full_name || 'Student', index_no: prof.index_no || '' };
          }
        }
      }
    } catch (e) {
      console.warn('Could not hydrate extra quiz settings:', e);
    }
    return res;
  }, [attemptId]);

  if (loading) return <Loading label="Opening your quiz…" />;
  if (error) {
    return (
      <div className="page page-narrow" style={{ marginTop: 40 }}>
        <ErrorNote error={error} onRetry={reload} />
        <p style={{ marginTop: 16 }}><Link to="/" className="btn btn-sm">Back to home</Link></p>
      </div>
    );
  }
  if (!data || !data.attempt) {
    return (
      <div className="page page-narrow" style={{ marginTop: 40 }}>
        <div className="card stack" style={{ textAlign: 'center', padding: 36 }}>
          <h2>Quiz Attempt Not Available</h2>
          <p className="muted" style={{ maxWidth: 440, margin: '0 auto 16px' }}>
            This attempt could not be loaded. Please ensure your student account is enrolled in this course and the quiz has been published.
          </p>
          <Link to="/" className="btn btn-primary" style={{ alignSelf: 'center' }}>Back to home</Link>
        </div>
      </div>
    );
  }
  if (data.attempt.status !== 'in_progress') return <Done quiz={data.quiz} status={data.attempt.status} />;
  return <Runner initial={data} />;
}

function Done({ quiz, status, autoSubmitted }) {
  return (
    <div className="auth-main" style={{ minHeight: '100vh' }}>
      <div className="card stack" style={{ maxWidth: 520, textAlign: 'center', alignItems: 'center', padding: 36 }}>
        <div className="empty" style={{ padding: 0 }}>
          <div className="icon-circle" style={{ background: 'var(--teal-50)', color: 'var(--teal-dark)' }}>
            <Icon name="check" size={24} />
          </div>
        </div>
        <h1>{autoSubmitted === 'exits' ? 'Quiz submitted automatically' : autoSubmitted === 'staff' ? 'Quiz submitted by your lecturer' : autoSubmitted ? 'Time is up — quiz submitted' : 'Quiz submitted'}</h1>
        {autoSubmitted === 'exits' && (
          <div className="notice notice-error">You left the quiz screen too many times, so your quiz was submitted with the answers you had saved. Your lecturer can see when each exit happened.</div>
        )}
        <p className="muted">
          {quiz.title} ({quiz.course_code}).{' '}
          {status === 'needs_marking'
            ? 'Some written answers will be marked by your lecturer.'
            : 'Your answers have been marked.'}{' '}
          Your score will show on the course page once your lecturer releases the results.
        </p>
        <Link to={`/course/${quiz.course_id}?tab=quizzes`} className="btn btn-dark">Back to course</Link>
      </div>
    </div>
  );
}

function Runner({ initial }) {
  const attempt = initial?.attempt || {};
  const quiz = initial?.quiz || {};
  const questions = Array.isArray(initial?.questions) ? initial.questions : [];
  const student = initial?.student || {};

  if (!questions.length) {
    return (
      <div className="page page-narrow" style={{ marginTop: 40 }}>
        <div className="card stack" style={{ textAlign: 'center', padding: 36 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <h2>No Questions in this Quiz Yet</h2>
          <p className="muted" style={{ maxWidth: 440, margin: '0 auto 16px' }}>
            No questions are currently available for this quiz attempt. If format quotas were configured, ensure the question bank contains questions for those formats.
          </p>
          <Link to="/" className="btn btn-primary" style={{ alignSelf: 'center' }}>
            Back to courses
          </Link>
        </div>
      </div>
    );
  }

  const toast = useToast();
  const strict = !!quiz.lockdown;
  const allowBack = !quiz.no_backtrack;
  const fsSupported = canFullscreen();
  const [offset, setOffset] = useState(() => new Date(attempt.server_now || Date.now()).getTime() - Date.now());
  const [deadlineMs, setDeadlineMs] = useState(() => new Date(attempt.deadline_at || Date.now() + 3600000).getTime());
  const deadlineRef = useRef(deadlineMs);
  deadlineRef.current = deadlineMs;

  const initialQueue = useMemo(() => readAnswerQueue(attempt.id), [attempt.id]);
  const [answers, setAnswers] = useState(() => {
    const base = Object.fromEntries(questions.map((q) => [q.id, q.value ?? '']));
    Object.entries(initialQueue).forEach(([qid, entry]) => {
      if (qid in base && entry && 'value' in entry) base[qid] = entry.value;
    });
    return base;
  });
  const [saveState, setSaveState] = useState(() => {
    const init = {};
    Object.keys(initialQueue).forEach((qid) => { init[qid] = 'error'; });
    return init;
  });
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [pendingCount, setPendingCount] = useState(() => Object.keys(initialQueue).length);
  const [current, setCurrent] = useState(() => (allowBack ? 0 : Math.min(attempt.current_index || 0, Math.max(0, questions.length - 1))));
  const [needFs, setNeedFs] = useState(() => strict && fsSupported && !document.fullscreenElement);
  const [exitWarn, setExitWarn] = useState(null);
  const [exits, setExits] = useState(attempt.exits || 0);
  const [moving, setMoving] = useState(false);
  const doneRef = useRef(false);
  const lastExit = useRef(0);
  const [flags, setFlags] = useState(() => readFlags(attempt.id));
  const [remaining, setRemaining] = useState(() => deadlineMs - (Date.now() + offset));
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(null);
  const [fatal, setFatal] = useState('');

  const quizMeta = useMemo(() => quiz.quizMeta || parseQuizMeta(quiz), [quiz]);
  const currentQ = questions[current] || questions[0];
  const perQSeconds = useMemo(() => {
    return getQuestionTimeLimit(currentQ, quizMeta, quiz.question_time_limit, quiz.is_practice);
  }, [currentQ, quizMeta, quiz.question_time_limit, quiz.is_practice]);
  const [qRemaining, setQRemaining] = useState(perQSeconds);

  const isTwoPhase = Boolean(quizMeta?.two_phase_screens);
  const [phase, setPhase] = useState('question'); // 'question' | 'response'

  const antiCaptureMode = true;
  const [blurred, setBlurred] = useState(false);
  const [zoomBlocked, setZoomBlocked] = useState(false);
  const physicalZoomOutRef = useRef(false);
  const cameraActiveRef = useRef(false);
  const [selfiePrompt, setSelfiePrompt] = useState(false);
  const [selfieDone, setSelfieDone] = useState(() => {
    try { return localStorage.getItem(`selfie:${attempt.id}`) === 'done'; } catch { return false; }
  });

  const latest = useRef(
    Object.fromEntries(Object.entries(initialQueue).map(([qid, entry]) => [qid, entry?.value]))
  ); // question id -> latest value not yet confirmed saved
  const inflight = useRef({});   // question id -> true while saving
  const timers = useRef({});     // debounce timers

  // ---------------- Callbacks & functions declared before any effects ----------------
  const recordExit = useCallback(async (kind) => {
    if (!strict || doneRef.current || cameraActiveRef.current || selfiePrompt) return;
    const now = Date.now();
    if (now - lastExit.current < 2000) return;
    lastExit.current = now;
    try {
      const r = await rpc('log_exit', { p_attempt: attempt.id, p_kind: kind });
      setExits(r.exits);
      if (r.submitted) {
        doneRef.current = true;
        latest.current = {};
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        setFinished({ status: 'marked', auto: 'exits' });
      } else {
        setExitWarn(r);
      }
    } catch {
      /* offline: nothing to record against */
    }
  }, [strict, attempt.id, selfiePrompt]);

  const uploadSelfieBackground = useCallback((dataUrl) => {
    if (!dataUrl || !attempt?.id) return;
    (async () => {
      try {
        await uploadProctorSnapshot({
          courseId: quiz.course_id,
          quizId: quiz.id,
          attemptId: attempt.id,
          dataUrl,
        });
        try { localStorage.removeItem(`pending_photo:${attempt.id}`); } catch {}
      } catch (e) {
        console.warn('Background proctor snapshot upload deferred:', e);
        try { localStorage.setItem(`pending_photo:${attempt.id}`, dataUrl); } catch {}
      }
    })();
  }, [quiz?.course_id, quiz?.id, attempt?.id]);

  const retryPendingPhoto = useCallback(async () => {
    try {
      const pending = localStorage.getItem(`pending_photo:${attempt.id}`);
      if (!pending) return;
      await uploadProctorSnapshot({
        courseId: quiz.course_id,
        quizId: quiz.id,
        attemptId: attempt.id,
        dataUrl: pending,
      });
      localStorage.removeItem(`pending_photo:${attempt.id}`);
    } catch {
      /* keep pending in localStorage for next retry */
    }
  }, [quiz?.course_id, quiz?.id, attempt?.id]);

  const handleSelfieDone = useCallback(() => {
    setSelfiePrompt(false);
    setSelfieDone(true);
    if (fsSupported && !document.fullscreenElement && strict) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
    setTimeout(() => {
      cameraActiveRef.current = false;
    }, 4000);
  }, [fsSupported, strict]);

  const saveNow = useCallback(async (qid) => {
    clearTimeout(timers.current[qid]);
    if (inflight.current[qid] || !(qid in latest.current)) return;
    const value = latest.current[qid];
    inflight.current[qid] = true;
    setSaveState((s) => ({ ...s, [qid]: 'saving' }));
    try {
      await rpc('save_response', { p_attempt: attempt.id, p_question: qid, p_value: value });
      if (latest.current[qid] === value) {
        delete latest.current[qid];
        removeQueuedAnswer(attempt.id, qid);
        setPendingCount(Object.keys(latest.current).length);
      }
      setSaveState((s) => ({ ...s, [qid]: 'saved' }));
    } catch (e) {
      setSaveState((s) => ({ ...s, [qid]: 'error' }));
      if (/locked/i.test(e.message)) {
        delete latest.current[qid];
        removeQueuedAnswer(attempt.id, qid);
        setPendingCount(Object.keys(latest.current).length);
      } else if (/Time is up/i.test(e.message)) {
        setFatal('Time is up for this attempt. Your saved answers have been submitted.');
      } else {
        setPendingCount(Object.keys(latest.current).length);
      }
    } finally {
      inflight.current[qid] = false;
      if (qid in latest.current && latest.current[qid] !== value) saveNow(qid);
    }
  }, [attempt.id]);

  const flushAll = useCallback(async () => {
    const ids = Object.keys(latest.current);
    await Promise.all(ids.map((id) => saveNow(id)));
    for (let i = 0; i < 40 && Object.values(inflight.current).some(Boolean); i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    setPendingCount(Object.keys(latest.current).length);
  }, [saveNow]);

  const syncDeadline = useCallback(async () => {
    if (doneRef.current) return;
    try {
      const info = await rpc('attempt_deadline', { p_attempt: attempt.id });
      if (!info) return;
      if (info.server_now) {
        setOffset(new Date(info.server_now).getTime() - Date.now());
      }
      if (info.status && info.status !== 'in_progress' && !doneRef.current) {
        doneRef.current = true;
        clearAnswerQueue(attempt.id);
        setPendingCount(0);
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        setFinished({ status: info.status, auto: 'staff' });
        return;
      }
      if (info.deadline_at) {
        const nextDead = new Date(info.deadline_at).getTime();
        if (Number.isFinite(nextDead) && Math.abs(nextDead - deadlineRef.current) > 4000) {
          const diffMin = Math.round((nextDead - deadlineRef.current) / 60000);
          setDeadlineMs(nextDead);
          setFatal((prev) => (/Time is up/i.test(prev) ? '' : prev));
          if (diffMin > 0) {
            toast?.(`Extra time granted (+${diffMin} min) — your timer has been updated.`);
          }
        }
      }
    } catch {
      /* ignore if offline or RPC not deployed yet */
    }
  }, [attempt.id, toast]);

  function setAnswer(qid, value, immediate) {
    setAnswers((a) => ({ ...a, [qid]: value }));
    latest.current[qid] = value;
    upsertQueuedAnswer(attempt.id, qid, value);
    setPendingCount(Object.keys(latest.current).length);
    setSaveState((s) => ({ ...s, [qid]: 'pending' }));
    clearTimeout(timers.current[qid]);
    if (immediate) saveNow(qid);
    else timers.current[qid] = setTimeout(() => saveNow(qid), 750);
  }

  const submit = useCallback(async (auto) => {
    if (submitting) return;
    setSubmitting(true);
    doneRef.current = true;
    await flushAll();
    await retryPendingPhoto();

    const unsyncedCount = Object.keys(latest.current).length;
    if (!auto && unsyncedCount > 0) {
      doneRef.current = false;
      setSubmitting(false);
      setConfirming(false);
      setFatal(
        `You appear to be offline and ${unsyncedCount} answer${unsyncedCount === 1 ? '' : 's'} ${unsyncedCount === 1 ? 'is' : 'are'} saved only on this device. Reconnect briefly so your answers sync before submitting.`
      );
      return;
    }

    try {
      const status = await rpc('submit_attempt', { p_attempt: attempt.id });
      clearAnswerQueue(attempt.id);
      setPendingCount(0);
      setFinished({ status, auto });
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch (e) {
      doneRef.current = false;
      setFatal(
        unsyncedCount > 0
          ? `Could not submit while offline (${unsyncedCount} answer${unsyncedCount === 1 ? '' : 's'} safely saved on your device). Keep this page open until your connection returns.`
          : e.message
      );
      setSubmitting(false);
    }
  }, [attempt.id, flushAll, retryPendingPhoto, submitting]);

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      setNeedFs(false);
    } catch {
      setNeedFs(false);
    }
  }

  function toggleFlag() {
    const qid = questions[current]?.id;
    if (!qid) return;
    const next = new Set(flags);
    if (next.has(qid)) next.delete(qid);
    else next.add(qid);
    setFlags(next);
    writeFlags(attempt.id, next);
  }

  async function go(i) {
    const target = Math.max(0, Math.min(questions.length - 1, i));
    if (!allowBack && target < current) return;
    const id = questions[current]?.id;
    if (!allowBack && target > current) {
      setMoving(true);
      if (id && id in latest.current) await saveNow(id);
      try {
        await rpc('advance_attempt', { p_attempt: attempt.id, p_index: target });
      } catch {
        /* offline: the lock still applies on next save */
      }
      setMoving(false);
    } else if (id && id in latest.current) {
      saveNow(id);
    }
    setCurrent(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------- All useEffect hooks (all dependencies declared) ----------------
  useEffect(() => {
    setPhase('question');
  }, [current]);

  useEffect(() => {
    setQRemaining(perQSeconds);
  }, [current, perQSeconds]);

  // Network online/offline listeners + auto-flush queued answers on reconnect or mount
  useEffect(() => {
    if (Object.keys(latest.current).length > 0 && navigator.onLine) {
      flushAll();
    }
    retryPendingPhoto();
    const onOnline = () => {
      setOnline(true);
      setFatal((prev) => (/offline/i.test(prev) ? '' : prev));
      flushAll();
      retryPendingPhoto();
      syncDeadline();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushAll, retryPendingPhoto, syncDeadline]);

  // Poll lecturer-granted extra time or staff force-submit every 25s
  useEffect(() => {
    const t = setInterval(() => {
      if (navigator.onLine) syncDeadline();
    }, 25000);
    return () => clearInterval(t);
  }, [syncDeadline]);

  const midpoint = Math.floor(questions.length / 2);
  useEffect(() => {
    if (strict && !selfieDone && current >= midpoint && questions.length >= 2) {
      cameraActiveRef.current = true;
      setSelfiePrompt(true);
    }
  }, [current, strict, selfieDone, midpoint, questions.length]);

  useEffect(() => {
    const onBlur = () => {
      if (cameraActiveRef.current || selfiePrompt) return;
      setBlurred(true);
      if (strict) recordExit('blur');
    };
    const onFocus = () => {
      setBlurred(false);
    };
    const onVis = () => {
      if (document.hidden) {
        if (cameraActiveRef.current || selfiePrompt) return;
        setBlurred(true);
        if (strict) recordExit('tab');
      } else {
        setBlurred(false);
      }
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [strict, recordExit, selfiePrompt]);

  useEffect(() => {
    const t = setInterval(() => {
      Object.keys(latest.current).forEach((id) => {
        if (!inflight.current[id]) saveNow(id);
      });
    }, 5000);
    return () => clearInterval(t);
  }, [saveNow]);

  useEffect(() => {
    const t = setInterval(() => {
      const left = deadlineMs - (Date.now() + offset);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        submit(true);
      }
    }, 500);
    return () => clearInterval(t);
  }, [deadlineMs, offset, submit]);

  useEffect(() => {
    if (!perQSeconds || doneRef.current) return undefined;
    setQRemaining(perQSeconds);
    const t = setInterval(() => {
      setQRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(t);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [perQSeconds, current]);

  useEffect(() => {
    if (perQSeconds && qRemaining === 0 && !doneRef.current) {
      const qid = questions[current]?.id;
      if (qid && qid in latest.current) {
        saveNow(qid);
      }
      if (current < questions.length - 1) {
        go(current + 1);
      } else {
        submit(true);
      }
    }
  }, [qRemaining, perQSeconds, current, questions.length, submit, saveNow]);

  // Block Ctrl + - / _ / Ctrl + wheel zoom-out & detect zoomed-out viewport across all exams
  useEffect(() => {
    const isZoomedOut = () => {
      if (typeof window === 'undefined') return false;
      // Desktop check: zooming out increases innerWidth beyond outerWidth
      if (window.outerWidth > 400 && window.innerWidth > window.outerWidth * 1.12) {
        return true;
      }
      // Trackpad / browser pinch-zoom out check
      if (window.visualViewport && typeof window.visualViewport.scale === 'number' && window.visualViewport.scale < 0.92) {
        return true;
      }
      return false;
    };

    const evaluateZoom = () => {
      if (doneRef.current || cameraActiveRef.current || selfiePrompt) return;
      if (isZoomedOut()) {
        physicalZoomOutRef.current = true;
        setZoomBlocked(true);
        if (strict) recordExit('zoom-out');
      } else if (physicalZoomOutRef.current) {
        physicalZoomOutRef.current = false;
        setZoomBlocked(false);
      }
    };

    const onZoomKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (
        e.key === '-' ||
        e.key === '_' ||
        e.code === 'Minus' ||
        e.code === 'NumpadSubtract'
      )) {
        e.preventDefault();
        setZoomBlocked(true);
        if (strict) recordExit('zoom-out');
      }
    };

    const onWheel = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.deltaY > 0) {
        e.preventDefault();
        setZoomBlocked(true);
        if (strict) recordExit('zoom-out');
      }
    };

    evaluateZoom();
    window.addEventListener('keydown', onZoomKey, { capture: true });
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('resize', evaluateZoom);
    window.visualViewport?.addEventListener('resize', evaluateZoom);
    const zoomInterval = setInterval(evaluateZoom, 1200);
    return () => {
      window.removeEventListener('keydown', onZoomKey, { capture: true });
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('resize', evaluateZoom);
      window.visualViewport?.removeEventListener('resize', evaluateZoom);
      clearInterval(zoomInterval);
    };
  }, [strict, recordExit, selfiePrompt]);

  useEffect(() => {
    if (!strict) return undefined;
    const onVis = () => {
      if (cameraActiveRef.current || selfiePrompt) return;
      if (document.hidden) recordExit('tab');
    };
    const onBlur = () => {
      if (cameraActiveRef.current || selfiePrompt) return;
      recordExit('blur');
    };
    const onFs = () => {
      if (cameraActiveRef.current || selfiePrompt) return;
      if (fsSupported && !document.fullscreenElement && !doneRef.current) {
        recordExit('fullscreen');
        setNeedFs(true);
      }
    };
    const block = (e) => e.preventDefault();
    const onSelect = (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) e.preventDefault();
    };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'u', 'c', 'x', 'v', 'a'].includes(String(e.key).toLowerCase())) e.preventDefault();
      if (e.key === 'PrintScreen') recordExit('screenshot key');
    };
    const blocked = ['copy', 'cut', 'paste', 'contextmenu', 'dragstart', 'drop'];
    const onResize = () => {
      if (cameraActiveRef.current || selfiePrompt || doneRef.current) return;
      // Detect split-screen tiling: if screen width is large but browser window is constrained
      if (typeof window.screen !== 'undefined' && window.screen.availWidth > 1024) {
        if (window.innerWidth < Math.min(840, window.screen.availWidth * 0.65)) {
          setBlurred(true);
          recordExit('split-screen / resized window');
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('resize', onResize);
    blocked.forEach((t) => document.addEventListener(t, block));
    document.addEventListener('selectstart', onSelect);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('resize', onResize);
      blocked.forEach((t) => document.removeEventListener(t, block));
      document.removeEventListener('selectstart', onSelect);
      document.removeEventListener('keydown', onKey);
    };
  }, [strict, recordExit, fsSupported, selfiePrompt]);

  useEffect(() => {
    const onLeave = (e) => {
      if (Object.keys(latest.current).length) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  if (finished) return <Done quiz={quiz} status={finished.status} autoSubmitted={finished.auto} />;
  const q = questions[current] || questions[0] || {};
  const answeredCount = questions.filter((x) => isAnswered(answers[x.id])).length;
  const unsaved = Object.values(saveState).some((s) => s === 'error');
  const low = remaining < 5 * 60 * 1000;
  const st = q?.id ? saveState[q.id] : undefined;

  return (
    <div className={`quiz-shell ${strict ? 'strict' : ''}`}>
      <AntiCameraShield
        text={student?.name ? `${student.name} · ${student.index_no || ''}` : 'CONFIDENTIAL EXAM · E-CLASS PSCM'}
        blurred={selfiePrompt ? false : (zoomBlocked ? 'zoom' : blurred)}
        onResume={() => {
          if (zoomBlocked) {
            const stillZoomedOut =
              (window.outerWidth > 400 && window.innerWidth > window.outerWidth * 1.12) ||
              (window.visualViewport && window.visualViewport.scale < 0.92);
            if (!stillZoomedOut) setZoomBlocked(false);
          } else {
            setBlurred(false);
          }
        }}
      />
      {selfiePrompt && <SelfieModal attemptId={attempt.id} onPhotoCaptured={uploadSelfieBackground} onDone={handleSelfieDone} />}
      {needFs && (
        <div className="fs-gate" role="dialog" aria-modal="true" aria-label="Full screen required">
          <div className="card stack" style={{ maxWidth: 460, textAlign: 'center', alignItems: 'center' }}>
            <h2>{exits ? 'Return to full screen' : 'This quiz runs in full screen'}</h2>
            <p className="small muted">
              Leaving full screen, switching tabs or opening another app is recorded and shown to your lecturer
              {quiz.max_exits ? `. After ${quiz.max_exits} exits your quiz is submitted automatically` : ''}.
            </p>
            {exits > 0 && <span className="badge badge-red">Exits recorded: {exits}{quiz.max_exits ? ` of ${quiz.max_exits}` : ''}</span>}
            <button type="button" className="btn btn-dark" onClick={enterFullscreen}>{exits ? 'Return to full screen' : 'Enter full screen and begin'}</button>
          </div>
        </div>
      )}
      <header className="quiz-top">
        <div className="quiz-top-inner">
          <div className="row" style={{ minWidth: 0 }}>
            <Swatch color={quiz.course_color} text={initials(quiz.course_code)} size={36} />
            <div className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
              <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{quiz.title}</strong>
              <span className="tiny muted">{quiz.course_code} · answers save automatically{strict ? ' · strict mode' : ''}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span
              className="chip chip-active"
              title="Anti-capture view is automatically enforced so questions and options cannot be photographed together in one shot"
              style={{
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--teal-50, #f0fdfa)',
                borderColor: 'var(--teal, #0d9488)',
                color: 'var(--teal-dark, #0d9488)',
                cursor: 'default',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Icon name="shield" size={13} /> Anti-Capture (Enforced)
            </span>

            <span className="small muted hide-sm">{answeredCount} of {questions.length} answered</span>
            <span className={`timer ${low ? 'low' : ''}`} role="timer" aria-label="Time left">
              <Icon name="clock" size={16} /> {clock(remaining)}
            </span>
          </div>
        </div>
        <div className="progress"><div style={{ width: `${(answeredCount / questions.length) * 100}%` }} /></div>
      </header>

      {(!online || unsaved || pendingCount > 0 || fatal) && (
        <div style={{ padding: '12px 28px 0', maxWidth: 1280, margin: '0 auto', width: '100%' }}>
          <div className={`notice ${fatal ? 'notice-error' : 'notice-warn'}`} role="status" aria-live="polite">
            {fatal
              || (!online
                ? `Connection interrupted — ${pendingCount > 0 ? `${pendingCount} answer${pendingCount === 1 ? '' : 's'} saved safely on your device` : 'answers you enter are saved on this device'} and will sync automatically when you reconnect.`
                : pendingCount > 0
                  ? `Syncing ${pendingCount} queued answer${pendingCount === 1 ? '' : 's'} from this device to the server… Keep this page open.`
                  : 'Some answers could not be saved yet — retrying automatically every few seconds.')}
          </div>
        </div>
      )}

      <div className="quiz-body">
        <main className="question-card" style={{ filter: (blurred || zoomBlocked) ? 'blur(16px)' : 'none', transition: 'filter 0.2s' }}>
          {perQSeconds && (
            <div
              style={{
                marginBottom: 16,
                padding: '10px 16px',
                borderRadius: 10,
                background: qRemaining <= 5 ? '#fef2f2' : qRemaining <= 15 ? '#fffbeb' : '#f0fdf4',
                border: `1.5px solid ${qRemaining <= 5 ? '#ef4444' : qRemaining <= 15 ? '#f59e0b' : '#10b981'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                boxShadow: qRemaining <= 5 ? '0 0 12px rgba(239,68,68,0.25)' : 'none',
                transition: 'all 0.3s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon
                  name="clock"
                  size={18}
                  style={{
                    color: qRemaining <= 5 ? '#ef4444' : qRemaining <= 15 ? '#d97706' : '#15803d',
                  }}
                />
                <div>
                  <strong
                    style={{
                      fontSize: 14,
                      color: qRemaining <= 5 ? '#b91c1c' : qRemaining <= 15 ? '#b45309' : '#166534',
                    }}
                  >
                    {qRemaining <= 5
                      ? '⚠️ Time expiring: '
                      : 'Question Timer: '}
                    {qRemaining}s remaining
                  </strong>
                  <span className="tiny muted" style={{ display: 'block' }}>
                    {perQSeconds}s allocated · Auto-advances when timer reaches 0
                  </span>
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  maxWidth: 200,
                  height: 10,
                  borderRadius: 5,
                  background: 'rgba(0,0,0,0.08)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(0, ((qRemaining ?? 0) / perQSeconds) * 100))}%`,
                    background: qRemaining <= 5 ? '#ef4444' : qRemaining <= 15 ? '#f59e0b' : '#10b981',
                    transition: 'width 1s linear',
                  }}
                />
              </div>
            </div>
          )}
          <div className="between" style={{ flexWrap: 'wrap' }}>
            <span className="eyebrow">Question {current + 1} of {questions.length}</span>
            <div className="row-wrap">
              {isTwoPhase && (
                <span className={`badge ${phase === 'question' ? 'badge-blue' : 'badge-plum'}`} style={{ fontWeight: 700 }}>
                  {phase === 'question' ? 'Screen 1/2: Question' : 'Screen 2/2: Response'}
                </span>
              )}
              <span className="badge badge-teal">{fmtNumber(q.marks)} mark{Number(q.marks) === 1 ? '' : 's'}</span>
              {Object.keys(q.vars || {}).length > 0 && <span className="badge">Figures unique to you</span>}
            </div>
          </div>
          {/* When Two-Phase Screen Mode is active, separate Question and Response screens */}
          {isTwoPhase ? (
            phase === 'question' ? (
              <>
                <div
                  className="question-text"
                  style={{
                    fontSize: '1.75rem',
                    lineHeight: 1.75,
                    letterSpacing: '-0.015em',
                    fontWeight: 500,
                    color: '#0f172a',
                    padding: '36px 30px',
                    background: 'var(--surface)',
                    borderRadius: '12px',
                    border: '1px solid var(--line-2)',
                    minHeight: '44vh',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                  }}
                >
                  <div style={{ wordBreak: 'break-word' }}>{fillVars(q.prompt, q.vars)}</div>
                </div>

                <div
                  style={{
                    marginTop: 24,
                    padding: '24px 20px',
                    borderRadius: 12,
                    background: 'var(--teal-50, #f0fdfa)',
                    border: '1.5px solid var(--teal, #0d9488)',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div style={{ fontSize: 13, color: 'var(--teal-900, #134e4a)', fontWeight: 600 }}>
                    🔒 Anti-Camera Security Mode: Answer options are on Screen 2
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ minHeight: 46, padding: '0 28px', fontSize: 15, fontWeight: 700 }}
                    onClick={() => {
                      setPhase('response');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    Proceed to Answer Options →
                  </button>
                  <span className="tiny muted">
                    Proceeding will display your response choices and hide the question prompt to prevent single-frame capture.
                  </span>
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    padding: '16px 20px',
                    borderRadius: 10,
                    background: '#f8fafc',
                    border: '1px solid var(--line-2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <span className="eyebrow" style={{ color: 'var(--teal-dark)' }}>
                      Response Screen · Question {current + 1}
                    </span>
                    <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>
                      Select or enter your response below.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ fontSize: 12 }}
                    onClick={() => {
                      setPhase('question');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    title="View the question prompt again"
                  >
                    ← View Question Prompt
                  </button>
                </div>

                <div
                  className="answer-box"
                  style={{
                    padding: '24px 22px',
                    borderRadius: '12px',
                    border: '1.5px solid var(--line-2)',
                    background: '#fff',
                  }}
                >
                  <div style={{ marginBottom: 14 }}>
                    <span className="eyebrow" style={{ color: 'var(--teal-dark, #0d9488)', fontWeight: 700, fontSize: 13 }}>
                      {q.kind === 'mcq' ? 'Select One Option:' : 'Your Answer:'}
                    </span>
                  </div>
                  <AnswerInput q={q} value={answers[q.id]} onChange={setAnswer} onBlur={() => saveNow(q.id)} />
                  <span className="save-state" aria-live="polite" style={{ color: st === 'error' ? 'var(--red-ink)' : 'var(--muted)' }}>
                    {st === 'saving' && 'Saving…'}
                    {st === 'pending' && 'Editing…'}
                    {st === 'saved' && <span style={{ color: 'var(--teal-dark)' }}>✓ Saved</span>}
                    {st === 'error' && (online ? 'Not saved yet — retrying' : 'Saved on device · will sync online')}
                  </span>
                </div>
              </>
            )
          ) : (
            <>
              <div
                className="question-text"
                style={{
                  fontSize: antiCaptureMode ? '1.75rem' : '1.125rem',
                  lineHeight: 1.75,
                  letterSpacing: '-0.015em',
                  fontWeight: antiCaptureMode ? 500 : 400,
                  color: '#0f172a',
                  padding: antiCaptureMode ? '36px 30px' : '20px',
                  background: 'var(--surface)',
                  borderRadius: '12px',
                  border: '1px solid var(--line-2)',
                  minHeight: antiCaptureMode ? '52vh' : 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: antiCaptureMode ? '0 2px 10px rgba(0,0,0,0.04)' : 'none',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ wordBreak: 'break-word' }}>{fillVars(q.prompt, q.vars)}</div>
                {antiCaptureMode && (
                  <div
                    style={{
                      marginTop: 40,
                      paddingTop: 16,
                      borderTop: '1px dashed var(--line-2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      fontSize: '0.92rem',
                      color: 'var(--teal-dark, #0d9488)',
                      fontWeight: 600,
                    }}
                  >
                    <Icon name="chevronDown" size={18} />
                    <span>Scroll down to view answer options ↓</span>
                  </div>
                )}
              </div>
              {antiCaptureMode && (
                <div
                  aria-hidden="true"
                  style={{
                    minHeight: '45vh',
                    margin: '16px 0',
                    borderRadius: 12,
                    border: '1.5px dashed rgba(13, 148, 136, 0.28)',
                    background: 'repeating-linear-gradient(-45deg, rgba(15, 23, 42, 0.025), rgba(15, 23, 42, 0.025) 10px, rgba(13, 148, 136, 0.025) 10px, rgba(13, 148, 136, 0.025) 20px)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '24px 16px',
                    textAlign: 'center',
                    userSelect: 'none',
                  }}
                >
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 999, background: 'rgba(15, 23, 42, 0.06)', color: 'var(--text-2)', fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>
                    <span>🛡️ ANTI-CAPTURE SECURITY BUFFER</span>
                  </div>
                  <span className="tiny muted">Keep scrolling down to reach your response options ↓</span>
                </div>
              )}
              <div
                className="answer-box"
                style={{
                  marginTop: antiCaptureMode ? '12px' : '18px',
                  padding: '24px 22px',
                  scrollMarginTop: '80px',
                  border: '1.5px solid var(--line-2)',
                }}
              >
                <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="eyebrow" style={{ color: 'var(--teal-dark, #0d9488)', fontWeight: 700, fontSize: 13 }}>
                    {q.kind === 'mcq' ? 'Select One Option:' : 'Your Answer:'}
                  </span>
                  {antiCaptureMode && (
                    <span className="tiny muted">
                      Answer choices isolated below fold
                    </span>
                  )}
                </div>
                <AnswerInput q={q} value={answers[q.id]} onChange={setAnswer} onBlur={() => saveNow(q.id)} />
                <span className="save-state" aria-live="polite" style={{ color: st === 'error' ? 'var(--red-ink)' : 'var(--muted)' }}>
                  {st === 'saving' && 'Saving…'}
                  {st === 'pending' && 'Editing…'}
                  {st === 'saved' && <span style={{ color: 'var(--teal-dark)' }}>✓ Saved</span>}
                  {st === 'error' && 'Not saved yet — retrying'}
                </span>
              </div>
            </>
          )}

          <div className="spacer" />
          <div className="between" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 18, flexWrap: 'wrap' }}>
            {allowBack ? (
              <button type="button" className="btn" onClick={() => go(current - 1)} disabled={current === 0}>
                <Icon name="chevronLeft" /> Previous
              </button>
            ) : <span className="tiny muted" style={{ maxWidth: 200 }}>You cannot return to a question after moving on.</span>}
            {allowBack && (
              <button type="button" className="btn btn-ghost" onClick={toggleFlag} aria-pressed={flags.has(q.id)}>
                <Icon name="flag" /> {flags.has(q.id) ? 'Unflag' : 'Flag for review'}
              </button>
            )}
            {current < questions.length - 1 ? (
              <button type="button" className="btn btn-dark" onClick={() => go(current + 1)} disabled={moving}>
                {allowBack ? 'Next' : 'Next — lock this answer'} <Icon name="chevronRight" />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)}>
                Review and submit
              </button>
            )}
          </div>
        </main>

        <aside className="stack">
          <section className="card stack" aria-label="Question navigator">
            <h2 style={{ fontSize: 15 }}>Questions</h2>
            <div className="qnav">
              {questions.map((x, i) => {
                const cls = [
                  flags.has(x.id) ? 'flag' : isAnswered(answers[x.id]) ? 'done' : '',
                  i === current ? 'current' : '',
                ].join(' ');
                return (
                  <button key={x.id} type="button" className={cls} onClick={() => go(i)} disabled={!allowBack && i !== current}
                    aria-label={`Question ${i + 1}${isAnswered(answers[x.id]) ? ', answered' : ''}${flags.has(x.id) ? ', flagged' : ''}`}
                    aria-current={i === current ? 'step' : undefined}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="legend">
              <span><i style={{ background: 'var(--teal)' }} />Answered</span>
              <span><i style={{ background: '#f2c98b' }} />Flagged</span>
              <span><i style={{ background: 'var(--grey-50)' }} />To do</span>
            </div>
          </section>

          {quiz.reference && (
            <section className="card stack-sm" aria-label="Formula sheet">
              <h2 style={{ fontSize: 15 }}>Formula sheet</h2>
              <div className="mono small pre" style={{ lineHeight: 1.8 }}>{quiz.reference}</div>
            </section>
          )}

          <button type="button" className="btn btn-primary btn-block" style={{ minHeight: 48 }} onClick={() => setConfirming(true)}>
            Review and submit
          </button>
        </aside>
      </div>

      {exitWarn && !needFs && (
        <Modal title="You left the quiz" onClose={() => setExitWarn(null)}
          footer={<button type="button" className="btn btn-dark" onClick={() => setExitWarn(null)}>Back to the quiz</button>}>
          <div className="notice notice-error">
            This has been recorded ({exitWarn.exits}{exitWarn.max_exits ? ` of ${exitWarn.max_exits} allowed` : ''}) and your lecturer can see it.
            {exitWarn.max_exits ? ` If you reach ${exitWarn.max_exits}, your quiz is submitted automatically.` : ''}
          </div>
          <p className="small muted">Stay on this screen until you submit. Do not switch apps, open other tabs or leave full screen.</p>
        </Modal>
      )}

      {confirming && (
        <Modal
          title="Submit your quiz?"
          onClose={() => !submitting && setConfirming(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={submitting}>Keep working</button>
              <button type="button" className="btn btn-primary" onClick={() => submit(false)} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit now'}
              </button>
            </>
          }
        >
          <p>You have answered <strong>{answeredCount} of {questions.length}</strong> questions.</p>
          {answeredCount < questions.length && (
            <div className="notice notice-warn">
              Unanswered:{' '}
              {questions.map((x, i) => (!isAnswered(answers[x.id]) ? i + 1 : null)).filter(Boolean).join(', ')}
            </div>
          )}
          {flags.size > 0 && (
            <p className="small muted">
              Flagged for review: {questions.map((x, i) => (flags.has(x.id) ? i + 1 : null)).filter(Boolean).join(', ')}
            </p>
          )}
          {(!online || pendingCount > 0) && (
            <div className="notice notice-warn">
              {pendingCount > 0
                ? `${pendingCount} answer${pendingCount === 1 ? '' : 's'} ${pendingCount === 1 ? 'is' : 'are'} queued on your device and will sync automatically before submission completes.`
                : 'Your internet connection looks interrupted. Submitting requires a brief connection.'}
            </div>
          )}
          <p className="small muted">After you submit you cannot change your answers.</p>
        </Modal>
      )}
    </div>
  );
}

function kindLabel(kind) {
  return { mcq: 'Multiple choice', truefalse: 'True or false', numeric: 'Calculation', short: 'Short answer', essay: 'Written answer' }[kind] || 'Question';
}

function AnswerInput({ q, value, onChange, onBlur }) {
  if (q.kind === 'mcq' || q.kind === 'truefalse') {
    return (
      <div className="stack-sm" role="radiogroup" aria-label="Choose one answer">
        {q.options.map((o, i) => {
          const selected = value === o.id;
          return (
            <button key={o.id} type="button" role="radio" aria-checked={selected}
              className={`option ${selected ? 'selected' : ''}`} onClick={() => onChange(q.id, o.id, true)}>
              <span className="letter">{q.kind === 'truefalse' ? (o.id === 'true' ? 'T' : 'F') : LETTERS[i]}</span>
              <span>{o.text}</span>
            </button>
          );
        })}
      </div>
    );
  }
  if (q.kind === 'numeric') {
    return (
      <label className="row-wrap">
        <span className="sr-only">Your answer</span>
        <input
          className="input mono"
          style={{ maxWidth: 240, fontSize: 18, minHeight: 50, borderWidth: 2, borderColor: 'var(--teal)' }}
          inputMode="decimal"
          autoComplete="off"
          value={value ?? ''}
          onChange={(e) => onChange(q.id, e.target.value)}
          onBlur={onBlur}
          placeholder="0"
        />
        {q.unit && <span style={{ fontSize: 16 }}>{q.unit}</span>}
        <span className="tiny muted" style={{ width: '100%' }}>
          {Number(q.decimals) === 0 ? 'Enter a whole number.' : `Enter a number, rounded to ${q.decimals} decimal place${Number(q.decimals) === 1 ? '' : 's'}.`}
        </span>
      </label>
    );
  }
  if (q.kind === 'short') {
    return (
      <label className="field">
        <span className="sr-only">Your answer</span>
        <input className="input" value={value ?? ''} onChange={(e) => onChange(q.id, e.target.value)} onBlur={onBlur} autoComplete="off" maxLength={300} placeholder="Type your answer" />
      </label>
    );
  }
  const words = String(value || '').trim().split(/\s+/).filter(Boolean).length;
  return (
    <label className="field">
      <span className="sr-only">Your answer</span>
      <textarea className="textarea" style={{ minHeight: 220 }} value={value ?? ''} onChange={(e) => onChange(q.id, e.target.value)} onBlur={onBlur} maxLength={15000} placeholder="Write your answer here" />
      <span className="tiny muted">{words} words</span>
    </label>
  );
}
