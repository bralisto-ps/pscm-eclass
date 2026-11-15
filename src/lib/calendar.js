// Generates standard RFC 5545 (.ics) calendar files and Google Calendar links
// for student quiz windows and assignment deadlines.

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toIcsUtc(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    'Z'
  );
}

function escapeIcsText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldLine(line) {
  if (line.length <= 74) return line;
  const parts = [];
  let i = 0;
  while (i < line.length) {
    parts.push((i === 0 ? '' : ' ') + line.slice(i, i + (i === 0 ? 74 : 73)));
    i += i === 0 ? 74 : 73;
  }
  return parts.join('\r\n');
}

function eventTimes(item) {
  const dueMs = new Date(item.due).getTime();
  if (Number.isNaN(dueMs)) return null;

  if (item.kind === 'quiz') {
    const startMs = item.opens_at ? new Date(item.opens_at).getTime() : dueMs;
    const durMs = Math.max(15, Number(item.duration_minutes) || 30) * 60 * 1000;
    const closeMs = item.closes_at ? new Date(item.closes_at).getTime() : startMs + durMs;
    // If window spans several days, anchor the calendar reminder at the target deadline/window
    const safeStart = startMs;
    const safeEnd = closeMs > safeStart && closeMs - safeStart <= 6 * 3600 * 1000
      ? closeMs
      : safeStart + durMs;
    return { startMs: safeStart, endMs: safeEnd };
  }

  // Assignment: 30-minute block ending right at the submission deadline
  return { startMs: dueMs - 30 * 60 * 1000, endMs: dueMs };
}

export function buildDeadlinesIcs(items = [], originUrl = 'https://eclasspscm.com') {
  const stamp = toIcsUtc(Date.now());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PSCM E-class//Academic Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:PSCM E-class Deadlines',
  ];

  for (const item of items) {
    const times = eventTimes(item);
    if (!times) continue;
    const dtStart = toIcsUtc(times.startMs);
    const dtEnd = toIcsUtc(times.endMs);
    if (!dtStart || !dtEnd) continue;

    const typeLabel = item.kind === 'quiz' ? 'Quiz' : 'Assignment Due';
    const summary = `[${item.course_code}] ${typeLabel}: ${item.title}`;
    const descParts = [
      `Course: ${item.course_code}`,
      `Type: ${typeLabel}`,
      item.kind === 'quiz' && item.duration_minutes ? `Duration: ${item.duration_minutes} minutes` : null,
      item.kind === 'quiz' && item.question_count ? `Questions: ${item.question_count}` : null,
      item.closes_at ? `Window closes: ${new Date(item.closes_at).toLocaleString('en-GB')}` : null,
      `Open in PSCM E-class: ${originUrl}/course/${item.course_id}?tab=${item.kind === 'quiz' ? 'quizzes' : 'assignments'}`,
    ].filter(Boolean);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:pscm-${item.kind}-${item.id}@eclasspscm.com`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
    lines.push(foldLine(`SUMMARY:${escapeIcsText(summary)}`));
    lines.push(foldLine(`DESCRIPTION:${escapeIcsText(descParts.join('\n'))}`));
    lines.push(`CATEGORIES:${item.kind === 'quiz' ? 'QUIZ' : 'ASSIGNMENT'}`);
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:-PT24H');
    lines.push('ACTION:DISPLAY');
    lines.push(foldLine(`DESCRIPTION:Reminder (24h): ${escapeIcsText(summary)}`));
    lines.push('END:VALARM');
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:-PT1H');
    lines.push('ACTION:DISPLAY');
    lines.push(foldLine(`DESCRIPTION:Starting soon (1h): ${escapeIcsText(summary)}`));
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function googleCalendarUrl(item, originUrl = 'https://eclasspscm.com') {
  const times = eventTimes(item);
  if (!times) return null;
  const start = toIcsUtc(times.startMs);
  const end = toIcsUtc(times.endMs);
  if (!start || !end) return null;
  const typeLabel = item.kind === 'quiz' ? 'Quiz' : 'Assignment Due';
  const title = `[${item.course_code}] ${typeLabel}: ${item.title}`;
  const details = `PSCM E-class (${item.course_code})\nOpen: ${originUrl}/course/${item.course_id}?tab=${item.kind === 'quiz' ? 'quizzes' : 'assignments'}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${start}/${end}`,
    details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
