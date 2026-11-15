// One place for uploading, opening and deleting files.
// Paths stored in the database may start with "viewonly:" (read-only in-browser viewer)
// and/or "r2:" (Cloudflare R2 storage).
import { supabase, friendlyError } from './supabase.js';

// Using Supabase Pro 100 GB storage as primary; past files on R2 starting with 'r2:' continue to open seamlessly
export const usingR2 = false;
export const STORAGE_LIMIT_LABEL = '100 GB (Supabase Pro)';

export function isViewOnlyPath(storedPath) {
  return String(storedPath || '').startsWith('viewonly:');
}

export function stripViewOnly(storedPath) {
  return String(storedPath || '').replace(/^viewonly:/, '');
}

export function setViewOnlyFlag(storedPath, viewOnly) {
  const clean = stripViewOnly(storedPath);
  if (!clean) return clean;
  return viewOnly ? `viewonly:${clean}` : clean;
}

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

export async function getSignedFileUrl(bucket, storedPath) {
  const cleanPath = stripViewOnly(storedPath);
  if (String(cleanPath).startsWith('r2:')) {
    return (await callFiles({ action: 'download', bucket, path: cleanPath })).url;
  }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(cleanPath, 60 * 60);
  if (error) throw new Error(friendlyError(error));
  return data.signedUrl;
}

export async function openStoredFile(bucket, storedPath) {
  const win = window.open('', '_blank');
  try {
    const url = await getSignedFileUrl(bucket, storedPath);
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}

export async function removeFiles(bucket, storedPaths) {
  const paths = (storedPaths || []).filter(Boolean).map(stripViewOnly);
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
