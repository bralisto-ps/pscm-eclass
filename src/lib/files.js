// One place for uploading, opening and deleting files.
// With VITE_FILES_BACKEND=r2 new files go to Cloudflare R2 (through the
// "files" Edge Function); otherwise they go to Supabase Storage.
// Paths stored in the database start with "r2:" when the file is on R2,
// so older Supabase files keep working after switching.
import { supabase, friendlyError } from './supabase.js';

export const usingR2 = (import.meta.env.VITE_FILES_BACKEND || '').toLowerCase() === 'r2';
export const STORAGE_LIMIT_LABEL = usingR2 ? '10 GB (Cloudflare)' : '100 GB (Supabase Pro)';

async function callFiles(body) {
  const { data, error } = await supabase.functions.invoke('files', { body });
  if (error) {
    let msg = error.message;
    try {
      const j = await error.context?.json?.();
      if (j?.error) msg = j.error;
    } catch {
      /* keep the generic message */
    }
    if (/Failed to send|fetch/i.test(msg)) msg = 'The file service could not be reached. Check your connection, or ask your lecturer to check the R2 setup.';
    throw new Error(msg);
  }
  return data;
}

export async function uploadFile(bucket, path, file) {
  const contentType = file.type || 'application/octet-stream';
  if (usingR2) {
    const sig = await callFiles({ action: 'upload', bucket, path, size: file.size, contentType });
    const res = await fetch(sig.url, { method: 'PUT', headers: sig.headers, body: file });
    if (!res.ok) throw new Error(`Upload failed (${res.status}). Please try again.`);
    return sig.path;
  }
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType });
  if (error) {
    if (/mime|type/i.test(error.message)) {
      throw new Error('That file type is not accepted. Upload a PDF, Word, Excel, PowerPoint, ZIP or image file.');
    }
    if (/size|large|exceed/i.test(error.message)) throw new Error('That file is too large.');
    throw new Error(friendlyError(error));
  }
  return path;
}

export async function openStoredFile(bucket, storedPath) {
  const win = window.open('', '_blank');
  try {
    let url;
    if (String(storedPath).startsWith('r2:')) {
      url = (await callFiles({ action: 'download', bucket, path: storedPath })).url;
    } else {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storedPath, 60 * 60);
      if (error) throw new Error(friendlyError(error));
      url = data.signedUrl;
    }
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}

export async function removeFiles(bucket, storedPaths) {
  const paths = (storedPaths || []).filter(Boolean);
  const r2 = paths.filter((p) => p.startsWith('r2:'));
  const local = paths.filter((p) => !p.startsWith('r2:'));
  for (let i = 0; i < r2.length; i += 500) {
    await callFiles({ action: 'delete', bucket, paths: r2.slice(i, i + 500) });
  }
  for (let i = 0; i < local.length; i += 500) {
    await supabase.storage.from(bucket).remove(local.slice(i, i + 500));
  }
}

export const SUBMISSION_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.jpg,.jpeg,.png';
