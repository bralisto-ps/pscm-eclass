import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const STUDENT_EMAIL_BASE = (import.meta.env.VITE_STUDENT_EMAIL_BASE || '').trim().toLowerCase();
export const isConfigured = Boolean(url && key && STUDENT_EMAIL_BASE.includes('@'));

export const supabase = isConfigured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

// Must match public.norm_index() in the database.
export function normIndex(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

// Must match public.student_email() in the database.
export function studentEmail(index) {
  const [local, domain] = STUDENT_EMAIL_BASE.split('@');
  const tag = normIndex(index).toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `${local}+${tag}@${domain}`;
}

// Turns Supabase errors into plain sentences.
export function friendlyError(error) {
  if (!error) return '';
  const msg = error.message || String(error);
  if (/Invalid login credentials/i.test(msg)) return 'That index number (or email) and password do not match.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Could not reach the server. Check your internet connection and try again.';
  if (/JWT expired|session/i.test(msg)) return 'Your session has expired. Please sign in again.';
  if (/Database error saving new user/i.test(msg)) return 'Your account could not be created. Check your index number with your lecturer.';
  if (/Password should be/i.test(msg)) return 'Password must be at least 6 characters.';
  if (/row-level security/i.test(msg)) return 'You do not have permission to do that.';
  if (/duplicate key/i.test(msg)) return 'That already exists.';
  return msg;
}

// Runs a database function and throws a readable error.
export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(friendlyError(error));
  return data;
}

// For functions that return many rows: fetches past Supabase's 1,000-row page limit.
export async function rpcAll(name, args) {
  const page = 1000;
  let all = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.rpc(name, args).range(from, from + page - 1);
    if (error) throw new Error(friendlyError(error));
    all = all.concat(data || []);
    if (!data || data.length < page) return all;
  }
}

// Runs a query builder and throws a readable error.
export async function run(query) {
  const { data, error } = await query;
  if (error) throw new Error(friendlyError(error));
  return data;
}

export function safeFileName(name) {
  const clean = String(name || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_');
  return clean.slice(-80) || 'file';
}
