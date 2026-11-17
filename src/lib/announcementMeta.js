// Helpers for cohort-targeted & pinned announcements (works seamlessly with Section 16 SQL & graceful fallback).
import { assignmentMatchesStudent } from './assignmentMeta.js';

export function normalizeAnnouncementAudience(audience) {
  if (!audience || typeof audience !== 'object') return null;
  const programmes = Array.isArray(audience.programmes)
    ? audience.programmes.map((v) => String(v || '').trim()).filter(Boolean)
    : [];
  const streams = Array.isArray(audience.streams)
    ? audience.streams.map((v) => String(v || '').trim()).filter(Boolean)
    : [];
  if (programmes.length === 0 && streams.length === 0) return null;
  return { programmes, streams };
}

export function announcementMatchesStudent(ann, cohort) {
  const aud = normalizeAnnouncementAudience(ann?.audience);
  if (!aud) return true;
  if (!cohort) return true;
  return assignmentMatchesStudent({ audience: aud }, cohort);
}

export function formatAnnouncementAudience(ann) {
  const aud = normalizeAnnouncementAudience(ann?.audience);
  if (!aud) return '';
  const parts = [];
  if (aud.programmes.length) parts.push(aud.programmes.join(', '));
  if (aud.streams.length) parts.push(aud.streams.join(', '));
  return parts.join(' · ');
}

export function sortAnnouncementsPinnedFirst(list = []) {
  return [...list].sort((a, b) => {
    const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (pinDiff !== 0) return pinDiff;
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
}
