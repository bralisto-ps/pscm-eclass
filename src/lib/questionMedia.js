import { supabase, friendlyError } from './supabase.js';

export const QUESTION_MEDIA_BUCKET = 'question_media';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function questionImageUrl(path) {
  const clean = String(path || '').trim();
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean) || /^data:image\//i.test(clean)) return clean;
  const { data } = supabase.storage.from(QUESTION_MEDIA_BUCKET).getPublicUrl(clean);
  return data?.publicUrl || '';
}

export async function uploadQuestionImage(courseId, quizId, file) {
  if (!file) throw new Error('Select an image file first.');
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('Only image files (PNG, JPG, WebP, GIF, SVG) are supported for diagrams.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Diagram image is larger than 5 MB. Compress or resize it before uploading.');
  }
  const extMatch = String(file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : 'png';
  const path = `${courseId || 'course'}/${quizId || 'quiz'}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(QUESTION_MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type || 'image/png', upsert: false });
  if (error) {
    if (/bucket|not found/i.test(error.message || '')) {
      throw new Error('Question diagrams storage bucket ("question_media") is not set up yet. Run the Features SQL script in Supabase SQL Editor.');
    }
    throw new Error(friendlyError(error));
  }
  return path;
}

export async function removeQuestionImage(path) {
  const clean = String(path || '').trim();
  if (!clean || /^https?:\/\//i.test(clean) || /^data:/i.test(clean)) return;
  try {
    await supabase.storage.from(QUESTION_MEDIA_BUCKET).remove([clean]);
  } catch {
    // Non-fatal cleanup
  }
}
