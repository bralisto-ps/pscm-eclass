import { supabase } from './supabase.js';

export const PROCTOR_BUCKET = 'proctor_photos';

export function proctorPhotoPath(courseId, quizId, attemptId) {
  return `${courseId}/${quizId}/${attemptId}.jpg`;
}

export function dataUrlToBlob(dataUrl) {
  const parts = String(dataUrl || '').split(',');
  if (parts.length < 2) return null;
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bin = atob(parts[1]);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * Uploads a proctor webcam snapshot to Supabase Storage (`proctor_photos/<course>/<quiz>/<attempt>.jpg`).
 * If the `proctor_photos` bucket or policy isn't provisioned yet in Supabase, falls back cleanly
 * to the legacy `course_messages` table so mid-exam capture continues uninterrupted.
 */
export async function uploadProctorSnapshot({ courseId, quizId, attemptId, dataUrl, blob: inputBlob }) {
  if (!attemptId || !courseId) return { ok: false, reason: 'missing_ids' };

  const blob = inputBlob || dataUrlToBlob(dataUrl);
  if (quizId && blob) {
    const path = proctorPhotoPath(courseId, quizId, attemptId);
    const { error: storageErr } = await supabase.storage
      .from(PROCTOR_BUCKET)
      .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });

    if (!storageErr) {
      return { ok: true, mode: 'storage', path };
    }
    // Only fall back to course_messages when bucket/RLS isn't configured or storage rejects;
    // on offline network errors we let the caller queue `dataUrl` locally and retry.
    const msg = String(storageErr.message || '');
    const isOffline = /Failed to fetch|NetworkError|network|timeout/i.test(msg);
    if (isOffline) {
      throw storageErr;
    }
  }

  // Fallback to legacy course_messages if bucket isn't set up yet
  if (!dataUrl) throw new Error('Could not upload verification photo.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No active session.');
  const { error: msgErr } = await supabase.from('course_messages').insert({
    course_id: courseId,
    student_id: user.id,
    subject: `__PROCTOR_PHOTO__:${attemptId}`,
    message: dataUrl,
  });
  if (msgErr) throw msgErr;
  return { ok: true, mode: 'legacy' };
}

/**
 * Loads proctor photos for a specific quiz from BOTH Supabase Storage (`proctor_photos`)
 * and legacy `course_messages` rows (backwards compatible, scoped to this quiz's attempts).
 */
export async function loadQuizProctorPhotos({ courseId, quizId, rows = [] }) {
  const photos = new Map();
  const meta = new Map(); // attempt_id or student_id -> { source, path?, subject?, attemptId }

  if (!courseId || !quizId) return { photos, meta };

  const attemptIds = new Set(rows.map((r) => r.attempt_id).filter(Boolean));

  // 1. Load from Supabase Storage bucket (`proctor_photos/<courseId>/<quizId>/...`)
  try {
    const prefix = `${courseId}/${quizId}`;
    const { data: files, error: listErr } = await supabase.storage
      .from(PROCTOR_BUCKET)
      .list(prefix, { limit: 1000 });

    if (!listErr && Array.isArray(files) && files.length > 0) {
      const validFiles = files.filter((f) => f.name && !f.name.endsWith('/'));
      const fullPaths = validFiles.map((f) => `${prefix}/${f.name}`);

      for (let i = 0; i < fullPaths.length; i += 100) {
        const chunk = fullPaths.slice(i, i + 100);
        const { data: signedList } = await supabase.storage
          .from(PROCTOR_BUCKET)
          .createSignedUrls(chunk, 60 * 60);

        (signedList || []).forEach((item, idx) => {
          const path = chunk[idx];
          if (!item?.signedUrl || !path) return;
          const fileName = path.split('/').pop() || '';
          const attemptId = fileName.replace(/\.(jpg|jpeg|png|webp)$/i, '');
          if (!attemptId) return;
          photos.set(attemptId, item.signedUrl);
          meta.set(attemptId, { source: 'storage', path, attemptId });
        });
      }
    }
  } catch {
    /* Storage bucket might not exist yet; ignore cleanly */
  }

  // 2. Load legacy `course_messages` rows scoped to this quiz's attempts
  try {
    const { data: legacyRows } = await supabase
      .from('course_messages')
      .select('student_id, subject, message, created_at')
      .eq('course_id', courseId)
      .ilike('subject', '__PROCTOR_PHOTO__:%');

    (legacyRows || []).forEach((p) => {
      const attemptId = p.subject?.replace('__PROCTOR_PHOTO__:', '')?.trim();
      if (!attemptId || !p.message) return;
      // Only attach if this photo's attempt belongs to this quiz (or no attempts exist yet in rows)
      if (!attemptIds.has(attemptId)) return;
      if (!photos.has(attemptId)) {
        photos.set(attemptId, p.message);
        meta.set(attemptId, { source: 'legacy', subject: p.subject, attemptId });
      }
      if (p.student_id && !photos.has(p.student_id)) {
        photos.set(p.student_id, p.message);
      }
    });
  } catch {
    /* ignore */
  }

  return { photos, meta };
}

export async function deleteQuizProctorPhoto({ courseId, quizId, attemptId, studentId, meta }) {
  const entry = attemptId ? meta?.get(attemptId) : null;

  // Attempt Storage delete if from storage or if path may exist
  if (attemptId && (entry?.source === 'storage' || quizId)) {
    const path = entry?.path || proctorPhotoPath(courseId, quizId, attemptId);
    const { error } = await supabase.storage.from(PROCTOR_BUCKET).remove([path]);
    if (error && entry?.source === 'storage') {
      throw new Error(error.message || 'Could not delete verification photo from storage.');
    }
  }

  // Also clean up any legacy course_messages row for this attempt/student
  if (attemptId) {
    const { error } = await supabase
      .from('course_messages')
      .delete()
      .eq('course_id', courseId)
      .eq('subject', `__PROCTOR_PHOTO__:${attemptId}`);
    if (error) throw new Error(error.message);
  } else if (studentId) {
    const { error } = await supabase
      .from('course_messages')
      .delete()
      .eq('course_id', courseId)
      .eq('student_id', studentId)
      .ilike('subject', '__PROCTOR_PHOTO__:%');
    if (error) throw new Error(error.message);
  }
}

export async function purgeQuizProctorPhotos({ courseId, quizId, rows = [], meta }) {
  // 1. Delete all Storage files under `<courseId>/<quizId>/`
  try {
    const prefix = `${courseId}/${quizId}`;
    const { data: files } = await supabase.storage.from(PROCTOR_BUCKET).list(prefix, { limit: 1000 });
    const paths = (files || []).filter((f) => f.name && !f.name.endsWith('/')).map((f) => `${prefix}/${f.name}`);
    for (let i = 0; i < paths.length; i += 100) {
      await supabase.storage.from(PROCTOR_BUCKET).remove(paths.slice(i, i + 100));
    }
  } catch {
    /* ignore if bucket missing */
  }

  // 2. Delete ONLY legacy course_messages scoped to attempts of THIS quiz
  const subjects = new Set();
  rows.forEach((r) => {
    if (r.attempt_id) subjects.add(`__PROCTOR_PHOTO__:${r.attempt_id}`);
  });
  meta?.forEach((v) => {
    if (v?.source === 'legacy' && v?.subject) subjects.add(v.subject);
  });

  const subjectList = [...subjects];
  for (let i = 0; i < subjectList.length; i += 100) {
    const { error } = await supabase
      .from('course_messages')
      .delete()
      .eq('course_id', courseId)
      .in('subject', subjectList.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
}
