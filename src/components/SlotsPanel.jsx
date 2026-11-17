import { useMemo, useState } from 'react';
import { rpc, run, supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDateTime, fmtFull, fromLocalInput } from '../lib/format.js';
import { findStudentSyndicate, parseAssignmentMeta } from '../lib/assignmentMeta.js';
import Icon from './Icon.jsx';
import PrintReportModal from './PrintReportModal.jsx';
import { Confirm, Empty, ErrorNote, Field, Loading, Modal, useAction, useLoad, useToast } from './ui.jsx';

const KIND_META = {
  presentation: { label: 'Syndicate / Case Presentation', cls: 'badge-teal' },
  viva: { label: 'Oral Viva / Defence', cls: 'badge-plum' },
  consultation: { label: 'Office-Hour Consultation', cls: 'badge-blue' },
};

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildSlotsPrintHtml(course, ev) {
  const rows = (ev.slots || []).map((sl) => {
    const start = new Date(sl.starts_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const end = new Date(sl.ends_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const who = sl.booked
      ? (sl.syndicate_name ? `${sl.syndicate_name} (${sl.booked_name || sl.booked_index_no})` : `${sl.booked_name || ''} · ${sl.booked_index_no || ''}`)
      : 'Open slot';
    return `<tr><td>${esc(fmtFull(sl.starts_at))}</td><td class="mono">${start} – ${end}</td><td>${esc(sl.room || ev.location || '—')}</td><td>${esc(who)}</td><td></td></tr>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${esc(ev.title)}</title>
  <style>
    body{font-family:system-ui,sans-serif;padding:20px;font-size:12px;color:#14212e}
    h1{font-size:17px;margin:0 0 4px} .sub{color:#475569;margin-bottom:14px}
    table{width:100%;border-collapse:collapse} th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
    th{background:#f1f5f9;font-size:10px;text-transform:uppercase} .mono{font-family:monospace}
  </style></head><body>
  <h1>${esc(course.code)} · ${esc(ev.title)}</h1>
  <div class="sub">${esc(KIND_META[ev.kind]?.label || ev.kind)}${ev.location ? ` · ${esc(ev.location)}` : ''}</div>
  <table><thead><tr><th>Date</th><th>Time</th><th>Venue / Room</th><th>Booked By</th><th style="width:120px">Notes / Sign</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}

export default function SlotsPanel({ course, staff = false }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [act, busy] = useAction();

  const { data, error, loading, reload } = useLoad(async () => {
    const [events, assignments] = await Promise.all([
      rpc('course_booking_events', { p_course: course.id }),
      run(supabase.from('assignments').select('id, title, instructions').eq('course_id', course.id).order('created_at', { ascending: false })),
    ]);
    return {
      events: Array.isArray(events) ? events : [],
      assignments: assignments || [],
    };
  }, [course.id]);

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [printingEv, setPrintingEv] = useState(null);

  const assignmentById = useMemo(
    () => new Map((data?.assignments || []).map((a) => [a.id, a])),
    [data?.assignments],
  );

  const myNormIndex = String(profile?.index_no || '').trim().toUpperCase();

  function studentSyndicateForEvent(ev) {
    if (!ev.allow_syndicate || !ev.assignment_id) return null;
    const assign = assignmentById.get(ev.assignment_id);
    if (!assign) return null;
    const meta = parseAssignmentMeta(assign);
    return findStudentSyndicate(meta, profile?.index_no);
  }

  function slotBelongsToMe(sl) {
    if (!sl.booked) return false;
    if (sl.booked_by_me) return true;
    if (myNormIndex && sl.syndicate_members && typeof sl.syndicate_members === 'object') {
      if (Array.isArray(sl.syndicate_members)) return sl.syndicate_members.includes(myNormIndex);
      return Boolean(sl.syndicate_members[myNormIndex]);
    }
    return false;
  }

  async function bookSlot(ev, sl) {
    const syn = studentSyndicateForEvent(ev);
    let synMap = null;
    if (syn?.members?.length) {
      synMap = Object.fromEntries(syn.members.map((m) => [String(m).trim().toUpperCase(), true]));
    }
    const res = await act(
      () => rpc('book_slot', {
        p_slot: sl.id,
        p_syndicate_name: syn?.name || null,
        p_syndicate_members: synMap,
      }),
      syn ? `Booked ${syn.name} for ${fmtDateTime(sl.starts_at)}` : `Booked slot for ${fmtDateTime(sl.starts_at)}`,
    );
    if (res) reload();
  }

  async function releaseSlot(sl) {
    const ok = await act(
      () => rpc('cancel_slot_booking', { p_slot: sl.id }),
      'Slot booking released.',
    );
    if (ok !== undefined) reload();
  }

  async function deleteEvent() {
    if (!deleting) return;
    const ok = await act(
      () => rpc('delete_booking_event', { p_event: deleting.id }),
      'Schedule deleted.',
    );
    if (ok !== undefined) {
      setDeleting(null);
      reload();
    }
  }

  if (loading) return <Loading />;
  if (error) {
    return (
      <div className="stack" style={{ maxWidth: 920 }}>
        <ErrorNote error={error} onRetry={reload} />
        {staff && (
          <div className="notice notice-warn small">
            Presentation &amp; consultation slot booking requires running the Section 17 SQL migration in Supabase.
          </div>
        )}
      </div>
    );
  }

  const events = data?.events || [];

  return (
    <div className="stack-lg" style={{ maxWidth: 980 }}>
      <div className="between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="stack-sm" style={{ gap: 2 }}>
          <h2 style={{ margin: 0 }}>Presentations, Vivas &amp; Consultation Slots</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {staff
              ? 'Generate bookable time slots for syndicate case presentations, oral vivas, or student consultations.'
              : 'Pick an open time slot below. For syndicate schedules, booking a slot reserves it for your entire group.'}
          </p>
        </div>
        {staff && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> Create Slot Schedule
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <div className="card">
          <Empty
            icon="calendar"
            title="No slot schedules yet"
            action={staff ? <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>Create slot schedule</button> : undefined}
          >
            {staff
              ? 'Create a schedule to let students or syndicate groups self-book their presentation or consultation time.'
              : 'Your lecturer has not opened any presentation or consultation booking schedules yet.'}
          </Empty>
        </div>
      ) : events.map((ev) => {
        const km = KIND_META[ev.kind] || KIND_META.presentation;
        const slots = ev.slots || [];
        const bookedCount = slots.filter((s) => s.booked).length;
        const mySlot = !staff ? slots.find((s) => slotBelongsToMe(s)) : null;
        const closed = ev.booking_closes_at && new Date(ev.booking_closes_at).getTime() < Date.now();
        const mySyn = !staff ? studentSyndicateForEvent(ev) : null;

        return (
          <section key={ev.id} className="card-flush">
            <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div className="stack-sm" style={{ gap: 4 }}>
                <div className="row-wrap" style={{ gap: 8 }}>
                  <h3 style={{ margin: 0 }}>{ev.title}</h3>
                  <span className={`badge ${km.cls}`}>{km.label}</span>
                  {ev.allow_syndicate && <span className="badge badge-amber">Syndicate booking</span>}
                  {closed && <span className="badge badge-red">Booking closed</span>}
                </div>
                <div className="tiny muted">
                  {ev.location ? `Venue: ${ev.location} · ` : ''}
                  {bookedCount} / {slots.length} booked
                  {ev.assignment_title ? ` · Linked to ${ev.assignment_title}` : ''}
                  {ev.booking_closes_at ? ` · Closes ${fmtDateTime(ev.booking_closes_at)}` : ''}
                </div>
              </div>
              {staff && (
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn btn-sm" onClick={() => setPrintingEv(ev)}>
                    <Icon name="printer" size={14} /> Print Schedule
                  </button>
                  <button type="button" className="icon-btn plain" title="Delete schedule" onClick={() => setDeleting(ev)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              )}
            </div>

            {!staff && mySlot && (
              <div className="notice notice-info between small" style={{ margin: '12px 16px', flexWrap: 'wrap', gap: 8 }}>
                <span>
                  <Icon name="check" size={14} /> <strong>Your booked slot:</strong> {fmtFull(mySlot.starts_at)} –{' '}
                  {new Date(mySlot.ends_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  {mySlot.room ? ` · ${mySlot.room}` : ''}
                  {mySlot.syndicate_name ? ` (${mySlot.syndicate_name})` : ''}
                </span>
                {!closed && (
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => releaseSlot(mySlot)}>
                    Cancel booking
                  </button>
                )}
              </div>
            )}

            {!staff && ev.allow_syndicate && !mySyn && ev.assignment_id && (
              <div className="notice notice-warn small" style={{ margin: '12px 16px' }}>
                This schedule is linked to a syndicate assignment — you do not appear in a syndicate group yet. Ask your lecturer to assign your group before booking.
              </div>
            )}

            <div>
              {slots.map((sl) => {
                const startT = new Date(sl.starts_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                const endT = new Date(sl.ends_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                const dateStr = new Date(sl.starts_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                const isMine = !staff && slotBelongsToMe(sl);

                return (
                  <div
                    key={sl.id}
                    className="list-row"
                    style={isMine ? { background: 'var(--teal-50)' } : undefined}
                  >
                    <div className="stack-sm" style={{ gap: 2, minWidth: 165 }}>
                      <span className="mono strong small">{startT} – {endT}</span>
                      <span className="tiny muted">{dateStr}{sl.room ? ` · ${sl.room}` : ''}</span>
                    </div>
                    <div className="list-main">
                      {sl.booked ? (
                        <div className="row-wrap" style={{ gap: 6 }}>
                          {sl.syndicate_name ? (
                            <span className="badge badge-teal">{sl.syndicate_name}</span>
                          ) : null}
                          <span className="small strong">
                            {staff || isMine ? (sl.booked_name || sl.booked_index_no || 'Booked') : 'Reserved'}
                          </span>
                          {(staff || isMine) && sl.booked_index_no && (
                            <span className="mono tiny muted">{sl.booked_index_no}</span>
                          )}
                        </div>
                      ) : (
                        <span className="small muted">Available</span>
                      )}
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      {staff ? (
                        sl.booked ? (
                          <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => releaseSlot(sl)}>
                            Clear
                          </button>
                        ) : (
                          <span className="badge">Open</span>
                        )
                      ) : isMine ? (
                        <span className="badge badge-teal">Your slot</span>
                      ) : !sl.booked && !closed && (!ev.allow_syndicate || !ev.assignment_id || mySyn) ? (
                        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => bookSlot(ev, sl)}>
                          {mySlot ? 'Switch here' : 'Book slot'}
                        </button>
                      ) : (
                        <span className="badge">{sl.booked ? 'Taken' : 'Closed'}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {creating && (
        <CreateSlotEventModal
          course={course}
          assignments={data?.assignments || []}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); reload(); }}
          toast={toast}
        />
      )}

      {deleting && (
        <Confirm
          title="Delete slot schedule?"
          message={`"${deleting.title}" and all ${deleting.slots?.length || 0} slots inside it will be deleted.`}
          danger
          confirmLabel="Delete schedule"
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={deleteEvent}
        />
      )}

      {printingEv && (
        <PrintReportModal
          title={`${course.code} · ${printingEv.title}`}
          html={buildSlotsPrintHtml(course, printingEv)}
          onClose={() => setPrintingEv(null)}
        />
      )}
    </div>
  );
}

function CreateSlotEventModal({ course, assignments, onClose, onSaved, toast }) {
  const [act, busy] = useAction();
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState('Syndicate Case Presentations');
  const [kind, setKind] = useState('presentation');
  const [location, setLocation] = useState('PSCM Seminar Room');
  const [assignmentId, setAssignmentId] = useState('');
  const [allowSyndicate, setAllowSyndicate] = useState(false);
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('12:00');
  const [slotMinutes, setSlotMinutes] = useState('15');
  const [breakMinutes, setBreakMinutes] = useState('0');
  const [closesAt, setClosesAt] = useState('');

  const previewSlots = useMemo(() => {
    if (!date || !startTime || !endTime) return [];
    const s = new Date(`${date}T${startTime}:00`);
    const e = new Date(`${date}T${endTime}:00`);
    const dur = Math.max(5, parseInt(slotMinutes, 10) || 15);
    const brk = Math.max(0, parseInt(breakMinutes, 10) || 0);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return [];
    const out = [];
    let cur = s.getTime();
    while (cur + dur * 60000 <= e.getTime() && out.length < 60) {
      out.push({
        starts_at: new Date(cur).toISOString(),
        ends_at: new Date(cur + dur * 60000).toISOString(),
        room: location.trim(),
      });
      cur += (dur + brk) * 60000;
    }
    return out;
  }, [date, startTime, endTime, slotMinutes, breakMinutes, location]);

  async function save() {
    if (!title.trim()) {
      toast('Enter a title for this slot schedule.', 'error');
      return;
    }
    if (!previewSlots.length) {
      toast('Adjust your date, start/end times, or slot duration so at least 1 slot fits.', 'error');
      return;
    }
    const id = await act(
      () => rpc('create_booking_event', {
        p_course: course.id,
        p_title: title.trim(),
        p_kind: kind,
        p_location: location.trim(),
        p_assignment: assignmentId || null,
        p_allow_syndicate: allowSyndicate,
        p_closes_at: closesAt ? fromLocalInput(closesAt) : null,
        p_slots: previewSlots,
      }),
      `Created ${previewSlots.length} bookable slots.`,
    );
    if (id) onSaved();
  }

  return (
    <Modal
      wide
      title="Create Presentation / Consultation Slots"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || !previewSlots.length} onClick={save}>
            {busy ? 'Creating…' : `Create ${previewSlots.length} Slot${previewSlots.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="grid-2">
          <Field label="Schedule Title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Type">
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="presentation">Syndicate / Case Presentation</option>
              <option value="viva">Oral Viva / Defence</option>
              <option value="consultation">Office-Hour Consultation</option>
            </select>
          </Field>
          <Field label="Venue / Room">
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. PSCM Room B12" />
          </Field>
          <Field label="Link to Assignment" hint="optional — links syndicate groups">
            <select
              className="select"
              value={assignmentId}
              onChange={(e) => {
                const v = e.target.value;
                setAssignmentId(v);
                if (v) {
                  const a = assignments.find((x) => x.id === v);
                  const meta = a ? parseAssignmentMeta(a) : null;
                  if (meta?.syndicate?.enabled) setAllowSyndicate(true);
                }
              }}
            >
              <option value="">None (individual booking)</option>
              {assignments.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          </Field>
        </div>

        <label className="check">
          <input type="checkbox" checked={allowSyndicate} onChange={(e) => setAllowSyndicate(e.target.checked)} />
          <span className="small"><strong>Syndicate mode:</strong> One teammate booking reserves the slot for the whole syndicate group</span>
        </label>

        <div className="grid-3">
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start Time">
            <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="End Time">
            <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
          <Field label="Slot Length (min)">
            <select className="select" value={slotMinutes} onChange={(e) => setSlotMinutes(e.target.value)}>
              {['5', '10', '15', '20', '30', '45'].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </Field>
          <Field label="Buffer Between Slots">
            <select className="select" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)}>
              {['0', '5', '10'].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </Field>
          <Field label="Booking Cutoff" hint="optional">
            <input className="input" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
          </Field>
        </div>

        <div className="notice notice-info small">
          Preview: <strong>{previewSlots.length}</strong> slot{previewSlots.length === 1 ? '' : 's'} will be generated
          {previewSlots.length > 0 ? ` (${new Date(previewSlots[0].starts_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} – ${new Date(previewSlots[previewSlots.length - 1].ends_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })})` : ''}.
        </div>
      </div>
    </Modal>
  );
}
