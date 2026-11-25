import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { useToast } from '../ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { supabase } from '../../lib/supabase.js';
import { downloadText } from '../../lib/sheets.js';
import { findMasterDataDuplicates } from '../../lib/psisLabEngine.js';
import {
  assignStudentsToChains,
  assignStudentsToP2pGroups,
  generateSessionCode,
} from '../../lib/psisMilestone4Engine.js';

const LIVE_LAB_OPTIONS = [
  {
    id: 'psis_seven_names',
    code: 'PSIS-LAB 02',
    title: 'Seven Names — Shared Live Item Master',
    desc: 'Students receive deliveries on their phones and either match existing SKUs or create duplicates. Reveal the live duplicate chaos on the projector.',
  },
  {
    id: 'psis_the_whip',
    code: 'PSIS-LAB 01',
    title: 'The Whip — Live 4-Tier Bullwhip Chains',
    desc: 'Deal students into blind Retailer → Wholesaler → Distributor → Factory chains, inject a +40% rumour spike, then switch on Shared POS visibility.',
  },
  {
    id: 'psis_the_match',
    code: 'PSIS-LAB 04',
    title: 'The Match — Live 4-Role P2P & Super-User Fraud Demo',
    desc: 'Deal students into Buyer / Storekeeper / Finance / Manager roles with real 403 SoD blocks, then grant Group 1 Super-User to prove Ghost-Vendor fraud live.',
  },
];

const INITIAL_MASTER_ITEMS = [
  { code: 'SKU-101', name: 'A4 Photocopy Paper 80gsm (Ream of 500)', stock: 120, addedBy: 'System' },
  { code: 'SKU-102', name: 'Nitrile Examination Gloves Medium (Box of 100)', stock: 85, addedBy: 'System' },
  { code: 'SKU-103', name: 'Laser Toner Cartridge Black 85A', stock: 30, addedBy: 'System' },
  { code: 'SKU-104', name: 'Hand Sanitizer Gel 500ml Pump Bottle', stock: 64, addedBy: 'System' },
];

const DELIVERY_PROMPTS = [
  { id: 'd1', note: '50 reams of 80g A4 Copier Paper (white, 500 sheets)', qty: 50 },
  { id: 'd2', note: '40 boxes of Med-size Nitrile Exam Gloves (100ct)', qty: 40 },
  { id: 'd3', note: '15 units of Black 85A LaserJet Printer Toner', qty: 15 },
  { id: 'd4', note: '35 bottles of 500ml Alcohol Hand Sanitizer Pump', qty: 35 },
];

const WHIP_TIERS = ['retailer', 'wholesaler', 'distributor', 'factory'];
const WHIP_TIER_LABELS = {
  retailer: 'Tier 1: Retailer',
  wholesaler: 'Tier 2: Wholesaler',
  distributor: 'Tier 3: Distributor',
  factory: 'Tier 4: Factory',
};

const P2P_ACTIONS = [
  { id: 'create_vendor', role: 'buyer', label: '1. Create / Onboard Vendor', desc: 'Master data creation' },
  { id: 'approve_po', role: 'manager', label: '2. Approve Purchase Order', desc: 'Budget & PO sign-off' },
  { id: 'post_grn', role: 'storekeeper', label: '3. Post Goods Receipt (GRN)', desc: 'Physical dock confirmation' },
  { id: 'release_payment', role: 'finance', label: '4. Release Supplier Payment', desc: 'Treasury bank transfer' },
];

function createInitialLabState(labId) {
  if (labId === 'psis_seven_names') {
    return {
      masterItems: INITIAL_MASTER_ITEMS.map((x) => ({ ...x })),
      revealDuplicates: false,
    };
  }
  if (labId === 'psis_the_whip') {
    return {
      week: 1,
      consumerDemand: 40,
      rumourActive: false,
      sharedPos: false,
      pendingOrders: {}, // { [participantId]: number }
      history: [], // [{ week, demand, avgByTier: { retailer, wholesaler, distributor, factory } }]
    };
  }
  // psis_the_match
  return {
    grantGroup1SuperUser: false,
    groupProgress: {}, // { [groupNo]: { vendorName, steps: { create_vendor, approve_po, post_grn, release_payment }, ghostFraudCompleted } }
    deniedCount: 0,
    fraudCount: 0,
  };
}

function LiveBullwhipChart({ history }) {
  const width = 560;
  const height = 190;
  const pad = { l: 44, r: 16, t: 16, b: 28 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;

  if (!history.length) {
    return (
      <div className="card-soft small muted" style={{ padding: 18, textAlign: 'center' }}>
        Advance Week 1 after students submit orders to plot live Bullwhip oscillations across all 4 tiers.
      </div>
    );
  }

  const allVals = history.flatMap((h) => [
    h.demand,
    h.avgByTier.retailer,
    h.avgByTier.wholesaler,
    h.avgByTier.distributor,
    h.avgByTier.factory,
  ]);
  const maxY = Math.max(80, ...allVals) * 1.12;
  const xOf = (idx) => (history.length === 1 ? pad.l + plotW / 2 : pad.l + (idx / (history.length - 1)) * plotW);
  const yOf = (v) => pad.t + plotH - (Math.max(0, v) / maxY) * plotH;
  const path = (fn) => history.map((h, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(fn(h)).toFixed(1)}`).join(' ');

  const series = [
    { key: 'demand', label: 'Consumer POS', color: '#64748b', dash: '4 3', fn: (h) => h.demand },
    { key: 'retailer', label: 'Retailer', color: '#0f766e', fn: (h) => h.avgByTier.retailer },
    { key: 'wholesaler', label: 'Wholesaler', color: '#2563eb', fn: (h) => h.avgByTier.wholesaler },
    { key: 'distributor', label: 'Distributor', color: '#d97706', fn: (h) => h.avgByTier.distributor },
    { key: 'factory', label: 'Factory', color: '#dc2626', fn: (h) => h.avgByTier.factory },
  ];

  return (
    <div className="stack-xs">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {[0, 0.5, 1].map((f) => {
          const y = pad.t + plotH * (1 - f);
          return (
            <g key={f}>
              <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 3" />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--muted)" fontFamily="monospace">
                {Math.round(maxY * f)}
              </text>
            </g>
          );
        })}
        {series.map((s) => (
          <path
            key={s.key}
            d={path(s.fn)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.key === 'factory' ? 2.6 : 1.8}
            strokeDasharray={s.dash || undefined}
          />
        ))}
        {history.map((h, i) => (
          <text key={h.week} x={xOf(i)} y={height - 6} textAnchor="middle" fontSize="9.5" fill="var(--muted)" fontFamily="monospace">
            W{h.week}
          </text>
        ))}
      </svg>
      <div className="row-wrap tiny" style={{ gap: 12, justifyContent: 'center' }}>
        {series.map((s) => (
          <span key={s.key} className="mono" style={{ color: s.color, fontWeight: 700 }}>
            ● {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function LiveLabSessionModal({
  isHost = false,
  initialLabId = 'psis_seven_names',
  initialCode = '',
  courseCode = '',
  onClose,
}) {
  const toast = useToast();
  const { session, profile } = useAuth();

  const [labId, setLabId] = useState(initialLabId);
  const [sessionCode, setSessionCode] = useState(() =>
    isHost ? generateSessionCode(6) : String(initialCode || '').trim().toUpperCase(),
  );
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState([]); // [{ id, name, indexNo }]
  const [assignments, setAssignments] = useState({});
  const [labState, setLabState] = useState(() => createInitialLabState(initialLabId));
  const [eventLog, setEventLog] = useState([]);

  // Student-side UI controls
  const [studentDeliveryIdx, setStudentDeliveryIdx] = useState(0);
  const [studentNewSkuName, setStudentNewSkuName] = useState('');
  const [studentOrderInput, setStudentOrderInput] = useState('40');
  const [studentVendorInput, setStudentVendorInput] = useState('Ghost Shell Traders Ltd');
  const [lastStudentFeedback, setLastStudentFeedback] = useState(null);

  const clientIdRef = useRef(
    isHost
      ? 'host'
      : `stu_${session?.user?.id?.slice(0, 8) || Math.random().toString(36).slice(2, 8)}`,
  );
  const channelRef = useRef(null);
  const stateRef = useRef(labState);
  const assignmentsRef = useRef(assignments);
  const labIdRef = useRef(labId);

  useEffect(() => { stateRef.current = labState; }, [labState]);
  useEffect(() => { assignmentsRef.current = assignments; }, [assignments]);
  useEffect(() => { labIdRef.current = labId; }, [labId]);

  const activeLabMeta = useMemo(
    () => LIVE_LAB_OPTIONS.find((l) => l.id === labId) || LIVE_LAB_OPTIONS[0],
    [labId],
  );

  const dupAudit = useMemo(
    () => (labId === 'psis_seven_names' ? findMasterDataDuplicates(labState.masterItems || []) : null),
    [labId, labState.masterItems],
  );

  const myAssignment = assignments[clientIdRef.current] || null;

  function pushLog(actor, eventType, detail) {
    setEventLog((prev) => [
      {
        ts: new Date().toLocaleTimeString(),
        actor,
        eventType,
        detail,
      },
      ...prev.slice(0, 199),
    ]);
  }

  function broadcastState(nextLabId, nextState, nextAssignments, extra = {}) {
    const ch = channelRef.current;
    if (!ch || !isHost) return;
    ch.send({
      type: 'broadcast',
      event: 'session_state',
      payload: {
        labId: nextLabId,
        sessionCode,
        state: nextState,
        assignments: nextAssignments,
        ...extra,
      },
    }).catch(() => {});
  }

  // Host handler for incoming student actions
  function handleHostStudentAction(payload) {
    if (!payload) return;
    const { fromId, fromName, actionType, data } = payload;
    const curLab = labIdRef.current;
    const curState = stateRef.current;
    const curAssign = assignmentsRef.current;

    if (curLab === 'psis_seven_names') {
      if (actionType === 'match_sku') {
        const nextItems = (curState.masterItems || []).map((it) =>
          it.code === data.code ? { ...it, stock: it.stock + (Number(data.qty) || 0) } : it,
        );
        const nextState = { ...curState, masterItems: nextItems };
        setLabState(nextState);
        pushLog(fromName, 'MATCH_SKU', `Matched +${data.qty} units to ${data.code}`);
        broadcastState(curLab, nextState, curAssign);
      } else if (actionType === 'create_sku') {
        const cleanName = String(data.name || '').trim();
        if (!cleanName) return;
        const nextCode = `SKU-${101 + (curState.masterItems || []).length}`;
        const nextItems = [
          ...(curState.masterItems || []),
          { code: nextCode, name: cleanName, stock: Math.max(1, Number(data.qty) || 10), addedBy: fromName, createdByStudent: true },
        ];
        const nextState = { ...curState, masterItems: nextItems };
        setLabState(nextState);
        pushLog(fromName, 'CREATE_SKU', `Created ${nextCode}: "${cleanName}" (+${data.qty})`);
        broadcastState(curLab, nextState, curAssign);
      }
      return;
    }

    if (curLab === 'psis_the_whip') {
      if (actionType === 'submit_order') {
        const qty = Math.max(0, Math.round(Number(data.qty) || 0));
        const nextPending = { ...(curState.pendingOrders || {}), [fromId]: qty };
        const nextState = { ...curState, pendingOrders: nextPending };
        setLabState(nextState);
        const slot = curAssign[fromId];
        pushLog(
          fromName,
          'ORDER_PLACED',
          `Chain ${slot?.chainNo || '?'} (${slot?.tier || 'unassigned'}) ordered ${qty} units for Week ${curState.week}`,
        );
        broadcastState(curLab, nextState, curAssign);
      }
      return;
    }

    if (curLab === 'psis_the_match') {
      if (actionType === 'p2p_action') {
        const slot = curAssign[fromId];
        const groupNo = slot?.groupNo || 1;
        const allowedRoles = slot?.roles || [];
        const actDef = P2P_ACTIONS.find((a) => a.id === data.actionId);
        if (!actDef) return;

        if (!allowedRoles.includes(actDef.role)) {
          const nextState = { ...curState, deniedCount: (curState.deniedCount || 0) + 1 };
          setLabState(nextState);
          pushLog(
            fromName,
            '403_SOD_BLOCKED',
            `Group ${groupNo} (${allowedRoles.join('/') || 'no role'}) blocked from "${actDef.label}"`,
          );
          broadcastState(curLab, nextState, curAssign);
          return;
        }

        const prevGroup = (curState.groupProgress || {})[groupNo] || {
          vendorName: data.vendorName || 'Vendor',
          steps: {},
          actors: {},
          ghostFraudCompleted: false,
        };
        const nextSteps = { ...prevGroup.steps, [actDef.id]: true };
        const nextActors = { ...prevGroup.actors, [actDef.id]: fromName };
        const allFourDone = P2P_ACTIONS.every((a) => nextSteps[a.id]);
        const uniqueActors = new Set(Object.values(nextActors));
        const isGhostFraud = allFourDone && uniqueActors.size === 1;

        const nextGroup = {
          vendorName: data.vendorName || prevGroup.vendorName,
          steps: nextSteps,
          actors: nextActors,
          ghostFraudCompleted: prevGroup.ghostFraudCompleted || isGhostFraud,
        };
        const nextState = {
          ...curState,
          groupProgress: { ...(curState.groupProgress || {}), [groupNo]: nextGroup },
          fraudCount: isGhostFraud && !prevGroup.ghostFraudCompleted
            ? (curState.fraudCount || 0) + 1
            : curState.fraudCount || 0,
        };
        setLabState(nextState);
        pushLog(
          fromName,
          isGhostFraud ? 'GHOST_VENDOR_PAID' : 'P2P_STEP_OK',
          isGhostFraud
            ? `ALERT: Group ${groupNo} (${fromName}) executed ALL 4 P2P steps alone and paid "${nextGroup.vendorName}"!`
            : `Group ${groupNo} executed "${actDef.label}" (${nextGroup.vendorName})`,
        );
        broadcastState(curLab, nextState, curAssign);
      }
    }
  }

  // Subscribe to Supabase Realtime channel
  useEffect(() => {
    if (!sessionCode || sessionCode.length < 4) return undefined;
    let alive = true;
    const topic = `live-lab:${sessionCode.toUpperCase()}`;
    let ch = null;

    async function connect() {
      try {
        const existing = supabase.getChannels?.().find((c) => c.topic === `realtime:${topic}` || c.topic === topic);
        if (existing) {
          await supabase.removeChannel(existing).catch(() => {});
        }
        if (!alive) return;

        ch = supabase.channel(topic, {
          config: {
            broadcast: { self: false },
            presence: { key: clientIdRef.current },
          },
        });
        channelRef.current = ch;

        ch.on('broadcast', { event: 'session_state' }, ({ payload }) => {
          if (!payload || isHost) return;
          if (payload.ended) {
            toast('Lecturer ended the live classroom session.');
            onClose?.();
            return;
          }
          if (payload.labId) setLabId(payload.labId);
          if (payload.state) setLabState(payload.state);
          if (payload.assignments) setAssignments(payload.assignments);
        });

        ch.on('broadcast', { event: 'student_action' }, ({ payload }) => {
          if (!isHost) return;
          handleHostStudentAction(payload);
        });

        ch.on('presence', { event: 'sync' }, () => {
          if (!ch) return;
          const pState = ch.presenceState() || {};
          const list = [];
          Object.entries(pState).forEach(([key, metas]) => {
            if (key === 'host') return;
            const m = Array.isArray(metas) ? metas[0] : metas;
            if (m) {
              list.push({
                id: key,
                name: m.name || 'Student',
                indexNo: m.indexNo || '',
              });
            }
          });
          setParticipants(list);
          if (isHost) {
            broadcastState(labIdRef.current, stateRef.current, assignmentsRef.current);
          }
        });

        ch.subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && alive && ch) {
            setConnected(true);
            const presencePayload = isHost
              ? { role: 'host', name: profile?.full_name || 'Lecturer', labId: labIdRef.current, at: Date.now() }
              : { role: 'student', name: profile?.full_name || 'Student', indexNo: profile?.index_no || '', at: Date.now() };
            await ch.track(presencePayload).catch(() => {});
            if (isHost) {
              broadcastState(labIdRef.current, stateRef.current, assignmentsRef.current);
            }
          }
        });
      } catch (err) {
        toast(err?.message || 'Could not connect to live session channel.', 'error');
      }
    }

    connect();

    return () => {
      alive = false;
      if (ch) {
        if (isHost) {
          ch.send({ type: 'broadcast', event: 'session_state', payload: { ended: true } }).catch(() => {});
        }
        supabase.removeChannel(ch).catch(() => {});
      }
      channelRef.current = null;
    };
  }, [sessionCode, isHost]);

  // Host controls
  function switchHostLab(nextLabId) {
    const fresh = createInitialLabState(nextLabId);
    setLabId(nextLabId);
    setLabState(fresh);
    setAssignments({});
    pushLog('Lecturer', 'SWITCH_LAB', `Switched live classroom lab to ${nextLabId}`);
    broadcastState(nextLabId, fresh, {});
  }

  function dealParticipants() {
    if (!participants.length) {
      toast('Wait for at least 1 student to join using the 6-letter code first.', 'error');
      return;
    }
    if (labId === 'psis_the_whip') {
      const nextA = assignStudentsToChains(participants);
      setAssignments(nextA);
      pushLog('Lecturer', 'DEAL_CHAINS', `Dealt ${participants.length} student(s) into 4-tier Bullwhip chains.`);
      broadcastState(labId, labState, nextA);
      toast(`Dealt ${participants.length} students into Bullwhip chains.`);
    } else if (labId === 'psis_the_match') {
      const nextA = assignStudentsToP2pGroups(participants, Boolean(labState.grantGroup1SuperUser));
      setAssignments(nextA);
      pushLog('Lecturer', 'DEAL_P2P_ROLES', `Dealt ${participants.length} student(s) into 4-role P2P groups.`);
      broadcastState(labId, labState, nextA);
      toast(`Dealt ${participants.length} students into 4-role P2P control groups.`);
    }
  }

  function toggleSuperUserDemo() {
    const nextGrant = !labState.grantGroup1SuperUser;
    const nextState = { ...labState, grantGroup1SuperUser: nextGrant };
    const nextA = assignStudentsToP2pGroups(participants, nextGrant);
    setLabState(nextState);
    setAssignments(nextA);
    pushLog(
      'Lecturer',
      nextGrant ? 'GRANT_SUPERUSER_GROUP1' : 'REVOKE_SUPERUSER_GROUP1',
      nextGrant
        ? 'Granted Group 1 ALL 4 P2P roles (Super-User Ghost-Vendor Fraud Demo ACTIVE)'
        : 'Restored strict Segregation of Duties for Group 1',
    );
    broadcastState(labId, nextState, nextA);
    toast(nextGrant ? 'Group 1 now holds Super-User permissions!' : 'Strict SoD restored for Group 1.');
  }

  function advanceWhipWeek() {
    const cur = labState;
    const byTier = { retailer: [], wholesaler: [], distributor: [], factory: [] };
    Object.entries(cur.pendingOrders || {}).forEach(([pid, qty]) => {
      const tier = assignments[pid]?.tier || 'retailer';
      byTier[tier].push(Number(qty) || 0);
    });
    const avg = (arr, fallback) => (arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : fallback);
    const d = cur.rumourActive ? 56 : 40;
    const rAvg = avg(byTier.retailer, d);
    const wAvg = avg(byTier.wholesaler, Math.round(rAvg * 1.15));
    const distAvg = avg(byTier.distributor, Math.round(wAvg * 1.2));
    const fAvg = avg(byTier.factory, Math.round(distAvg * 1.25));

    const entry = {
      week: cur.week,
      demand: d,
      avgByTier: { retailer: rAvg, wholesaler: wAvg, distributor: distAvg, factory: fAvg },
    };
    const nextState = {
      ...cur,
      week: cur.week + 1,
      consumerDemand: d,
      pendingOrders: {},
      history: [...(cur.history || []), entry],
    };
    setLabState(nextState);
    pushLog('Lecturer', 'ADVANCE_WEEK', `Closed Week ${cur.week} (POS=${d}, Factory Avg=${fAvg})`);
    broadcastState(labId, nextState, assignments);
  }

  function toggleWhipFlag(field) {
    const nextVal = !labState[field];
    const nextState = {
      ...labState,
      [field]: nextVal,
      consumerDemand: field === 'rumourActive' ? (nextVal ? 56 : 40) : labState.consumerDemand,
    };
    setLabState(nextState);
    pushLog('Lecturer', field.toUpperCase(), `${field} set to ${nextVal ? 'ON' : 'OFF'}`);
    broadcastState(labId, nextState, assignments);
  }

  function toggleSevenNamesReveal() {
    const nextState = { ...labState, revealDuplicates: !labState.revealDuplicates };
    setLabState(nextState);
    pushLog('Lecturer', 'PROJECTOR_REVEAL', nextState.revealDuplicates ? 'Revealed duplicate SKU clusters' : 'Hid duplicate audit');
    broadcastState(labId, nextState, assignments);
  }

  function exportEventLogCsv() {
    const header = 'Timestamp,Actor,EventType,Detail';
    const rows = [...eventLog].reverse().map((e) => [
      `"${e.ts}"`,
      `"${String(e.actor).replace(/"/g, '""')}"`,
      `"${e.eventType}"`,
      `"${String(e.detail).replace(/"/g, '""')}"`,
    ].join(','));
    downloadText(`live-lab-${sessionCode}-log.csv`, [header, ...rows].join('\n'));
    toast('Exported live classroom event log CSV.');
  }

  // Student broadcast helper
  function sendStudentAction(actionType, data) {
    const ch = channelRef.current;
    if (!ch) {
      toast('Not connected to live classroom channel yet.', 'error');
      return;
    }
    ch.send({
      type: 'broadcast',
      event: 'student_action',
      payload: {
        fromId: clientIdRef.current,
        fromName: profile?.full_name || profile?.index_no || 'Student',
        actionType,
        data,
      },
    }).catch(() => {});
  }

  return (
    <div
      className="modal-bg"
      role="dialog"
      aria-modal="true"
      aria-label="Live Classroom Lab Session"
      style={{ alignItems: 'stretch', padding: 12, zIndex: 130 }}
    >
      <div
        className="modal"
        style={{
          width: '100%',
          maxWidth: 1180,
          maxHeight: 'calc(100vh - 24px)',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          className="between"
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--surface)',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="tiny muted">
              {isHost ? 'LECTURER LIVE PROJECTOR CONSOLE' : 'STUDENT LIVE CLASSROOM TERMINAL'}
              {courseCode ? ` · ${courseCode}` : ''}
              {' · '}
              <span className="mono" style={{ color: connected ? 'var(--teal-700)' : 'var(--amber)', fontWeight: 700 }}>
                {connected ? '● LIVE REALTIME CONNECTED' : '▲ CONNECTING…'}
              </span>
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: 18 }}>{activeLabMeta.title}</h2>
          </div>

          <div className="row-wrap" style={{ gap: 10 }}>
            <div
              className="card-soft row"
              style={{ padding: '6px 12px', gap: 8, borderColor: 'var(--teal-700)' }}
            >
              <span className="tiny muted">JOIN CODE</span>
              <strong className="mono" style={{ fontSize: 18, letterSpacing: '0.14em', color: 'var(--teal-700)' }}>
                {sessionCode}
              </strong>
            </div>
            <div className="tiny mono muted" style={{ fontWeight: 700 }}>
              {participants.length} STUDENT{participants.length === 1 ? '' : 'S'} ONLINE
            </div>
            {isHost && (
              <button type="button" className="btn btn-sm" onClick={exportEventLogCsv}>
                <Icon name="download" size={13} /> Export Event Log CSV
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={onClose}>
              <Icon name="close" size={14} /> {isHost ? 'End Live Session' : 'Leave Session'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: 'var(--ground)' }} className="stack">
          {/* HOST VIEW */}
          {isHost && (
            <>
              {/* Switch Active Live Game */}
              <div className="card-soft between" style={{ padding: 12, flexWrap: 'wrap', gap: 10 }}>
                <div className="row-wrap" style={{ gap: 6 }}>
                  {LIVE_LAB_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`btn btn-sm ${labId === opt.id ? 'btn-primary' : ''}`}
                      onClick={() => switchHostLab(opt.id)}
                    >
                      {opt.code}: {opt.id === 'psis_seven_names' ? 'Seven Names' : opt.id === 'psis_the_whip' ? 'The Whip' : 'The Match'}
                    </button>
                  ))}
                </div>
                <span className="tiny muted">
                  Tell students to open <strong>Labs</strong> in their course and enter Join Code <strong className="mono">{sessionCode}</strong>.
                </span>
              </div>

              <div className="lab-split-grid">
                {/* Left: Main Projector Stage */}
                <div className="card stack-sm" style={{ padding: 16 }}>
                  {labId === 'psis_seven_names' && (
                    <>
                      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <div className="tiny muted">SHARED LIVE CLASSROOM ITEM MASTER</div>
                          <div className="small muted">{activeLabMeta.desc}</div>
                        </div>
                        <button
                          type="button"
                          className={`btn btn-sm ${labState.revealDuplicates ? '' : 'btn-primary'}`}
                          onClick={toggleSevenNamesReveal}
                        >
                          {labState.revealDuplicates ? 'Hide Duplicate Audit' : 'Reveal Duplicate Chaos on Projector'}
                        </button>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                        <div className="kpi">
                          <span className="tiny muted">Total SKU Records</span>
                          <strong className="mono" style={{ fontSize: 22 }}>{dupAudit?.totalRecords || 0}</strong>
                        </div>
                        <div className="kpi">
                          <span className="tiny muted">Duplicate Clusters</span>
                          <strong className="mono" style={{ fontSize: 22, color: labState.revealDuplicates && (dupAudit?.duplicateClusters?.length || 0) > 0 ? 'var(--red)' : 'var(--muted)' }}>
                            {labState.revealDuplicates ? dupAudit?.duplicateClusters?.length || 0 : 'Hidden'}
                          </strong>
                        </div>
                        <div className="kpi">
                          <span className="tiny muted">Master Hygiene Score</span>
                          <strong className="mono" style={{ fontSize: 22, color: labState.revealDuplicates ? ((dupAudit?.hygieneScore ?? 100) < 75 ? 'var(--red)' : 'var(--teal-700)') : 'var(--muted)' }}>
                            {labState.revealDuplicates ? `${dupAudit?.hygieneScore ?? 100}%` : 'Hidden'}
                          </strong>
                        </div>
                      </div>

                      {labState.revealDuplicates && dupAudit?.duplicateClusters?.length > 0 && (
                        <div className="notice-err stack-xs small">
                          <strong>LIVE DUPLICATE CLUSTERS DETECTED ({dupAudit.duplicateClusters.length}):</strong>
                          {dupAudit.duplicateClusters.map((c) => (
                            <div key={c.id} className="mono tiny">
                              • {c.count} separate SKUs for "{c.primaryName}" (Fragmented Total Stock: {c.totalStock}):{' '}
                              {c.members.map((m) => `${m.code}="${m.name}"`).join(' | ')}
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{ overflowX: 'auto', maxHeight: 280 }}>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Code</th>
                              <th>Item Description</th>
                              <th style={{ textAlign: 'right' }}>Stock</th>
                              <th>Created By</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(labState.masterItems || []).map((it) => (
                              <tr key={it.code}>
                                <td className="mono tiny">{it.code}</td>
                                <td className="small">{it.name}</td>
                                <td className="mono small" style={{ textAlign: 'right' }}>{it.stock}</td>
                                <td className="tiny muted">{it.addedBy}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {labId === 'psis_the_whip' && (
                    <>
                      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <div className="tiny muted">LIVE 4-TIER BULLWHIP PROJECTOR · WEEK {labState.week}</div>
                          <div className="small muted">
                            Orders received this week: <strong className="mono">{Object.keys(labState.pendingOrders || {}).length} / {participants.length}</strong>
                          </div>
                        </div>
                        <div className="row-wrap" style={{ gap: 6 }}>
                          <button type="button" className="btn btn-sm" onClick={dealParticipants}>
                            Deal 4-Tier Chains
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${labState.rumourActive ? 'btn-primary' : ''}`}
                            onClick={() => toggleWhipFlag('rumourActive')}
                          >
                            {labState.rumourActive ? '● Rumour Spike (+40%) ON' : 'Inject +40% Rumour Spike'}
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${labState.sharedPos ? 'btn-primary' : ''}`}
                            onClick={() => toggleWhipFlag('sharedPos')}
                          >
                            {labState.sharedPos ? '● Shared POS ON' : 'Enable Shared POS'}
                          </button>
                          <button type="button" className="btn btn-sm btn-primary" onClick={advanceWhipWeek}>
                            Advance to Week {labState.week + 1} →
                          </button>
                        </div>
                      </div>

                      <LiveBullwhipChart history={labState.history || []} />
                    </>
                  )}

                  {labId === 'psis_the_match' && (
                    <>
                      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <div className="tiny muted">LIVE 4-ROLE P2P CONTROL &amp; SUPER-USER FRAUD STAGE</div>
                          <div className="small muted">
                            Blocked 403 SoD Attempts: <strong className="mono" style={{ color: 'var(--teal-700)' }}>{labState.deniedCount || 0}</strong> ·
                            Ghost-Vendor Frauds Completed: <strong className="mono" style={{ color: 'var(--red)' }}>{labState.fraudCount || 0}</strong>
                          </div>
                        </div>
                        <div className="row-wrap" style={{ gap: 6 }}>
                          <button type="button" className="btn btn-sm" onClick={dealParticipants}>
                            Deal 4-Role Groups
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{
                              background: labState.grantGroup1SuperUser ? 'var(--red)' : undefined,
                              color: labState.grantGroup1SuperUser ? '#fff' : 'var(--red)',
                              borderColor: 'var(--red)',
                            }}
                            onClick={toggleSuperUserDemo}
                          >
                            {labState.grantGroup1SuperUser
                              ? '● Revoke Group 1 Super-User'
                              : '▲ Grant Super-User to Group 1 (Fraud Demo)'}
                          </button>
                        </div>
                      </div>

                      {Object.keys(labState.groupProgress || {}).length === 0 ? (
                        <div className="card-soft small muted" style={{ padding: 16 }}>
                          Click <strong>Deal 4-Role Groups</strong> once students join, then ask everyone to attempt all 4 P2P steps on their phone to watch Segregation of Duties block unauthorized actions in real time.
                        </div>
                      ) : (
                        <div className="stack-xs">
                          {Object.entries(labState.groupProgress).map(([gNo, g]) => (
                            <div key={gNo} className={g.ghostFraudCompleted ? 'notice-err stack-xs' : 'card-soft stack-xs'} style={{ padding: 12 }}>
                              <div className="between small">
                                <strong>Group {gNo} — Vendor: {g.vendorName}</strong>
                                <span className="mono tiny" style={{ fontWeight: 700, color: g.ghostFraudCompleted ? 'var(--red)' : 'var(--teal-700)' }}>
                                  {g.ghostFraudCompleted ? '■ GHOST-VENDOR FRAUD EXECUTED BY 1 USER' : '● CONTROLLED WORKFLOW'}
                                </span>
                              </div>
                              <div className="row-wrap tiny mono" style={{ gap: 10 }}>
                                {P2P_ACTIONS.map((a) => (
                                  <span key={a.id} style={{ color: g.steps?.[a.id] ? 'var(--teal-700)' : 'var(--muted)' }}>
                                    {g.steps?.[a.id] ? `✓ ${a.role.toUpperCase()} (${g.actors?.[a.id]})` : `○ ${a.role.toUpperCase()}`}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Right: Live Student Roster & Append-Only Event Log */}
                <div className="card stack-sm" style={{ padding: 16 }}>
                  <div className="tiny muted">CONNECTED CLASSROOM ROSTER ({participants.length})</div>
                  {participants.length === 0 ? (
                    <div className="small muted">Waiting for students to join with code <strong className="mono">{sessionCode}</strong>…</div>
                  ) : (
                    <div className="row-wrap" style={{ gap: 6, maxHeight: 110, overflowY: 'auto' }}>
                      {participants.map((p) => {
                        const a = assignments[p.id];
                        const tag = a?.tier
                          ? `C${a.chainNo}·${a.tier}`
                          : a?.groupNo
                            ? `G${a.groupNo}·${a.isSuperUserDemo ? 'SUPER-USER' : a.roles?.[0]}`
                            : 'ready';
                        return (
                          <span
                            key={p.id}
                            className="tiny mono"
                            style={{
                              padding: '3px 8px',
                              borderRadius: 6,
                              border: '1px solid var(--line)',
                              background: a?.isSuperUserDemo ? 'var(--red-50)' : 'var(--surface-2)',
                              color: a?.isSuperUserDemo ? 'var(--red)' : 'var(--text)',
                            }}
                          >
                            {p.name} ({tag})
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <div className="tiny muted" style={{ marginTop: 6 }}>APPEND-ONLY LIVE AUDIT EVENT LOG ({eventLog.length})</div>
                  <div className="stack-xs" style={{ maxHeight: 270, overflowY: 'auto' }}>
                    {eventLog.length === 0 ? (
                      <div className="tiny muted">Student and lecturer actions will stream here in real time.</div>
                    ) : (
                      eventLog.map((ev, i) => (
                        <div key={i} className="tiny" style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
                          <span className="mono muted">{ev.ts}</span>{' '}
                          <strong className="mono" style={{ color: /403|FRAUD|GHOST/.test(ev.eventType) ? 'var(--red)' : 'var(--teal-700)' }}>
                            [{ev.eventType}]
                          </strong>{' '}
                          <strong>{ev.actor}:</strong> {ev.detail}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* STUDENT PHONE / LAPTOP TERMINAL VIEW */}
          {!isHost && (
            <div className="card stack-sm" style={{ padding: 18, maxWidth: 680, margin: '0 auto', width: '100%' }}>
              {labId === 'psis_seven_names' && (
                <>
                  <div className="tiny muted">INCOMING RECEIVING DOCK DELIVERY ({studentDeliveryIdx + 1} / {DELIVERY_PROMPTS.length})</div>
                  <div className="notice small">
                    <strong>Delivery Note:</strong> {DELIVERY_PROMPTS[studentDeliveryIdx % DELIVERY_PROMPTS.length].note}
                  </div>

                  <div className="tiny muted">OPTION A — MATCH TO AN EXISTING SHARED CLASSROOM SKU</div>
                  <div className="stack-xs" style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {(labState.masterItems || []).map((it) => (
                      <div key={it.code} className="between card-soft" style={{ padding: '8px 10px', gap: 8 }}>
                        <div className="small">
                          <strong className="mono">{it.code}</strong> · {it.name}
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            const del = DELIVERY_PROMPTS[studentDeliveryIdx % DELIVERY_PROMPTS.length];
                            sendStudentAction('match_sku', { code: it.code, qty: del.qty });
                            setStudentDeliveryIdx((i) => i + 1);
                            toast(`Matched delivery to ${it.code}!`);
                          }}
                        >
                          Match (+{DELIVERY_PROMPTS[studentDeliveryIdx % DELIVERY_PROMPTS.length].qty})
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="tiny muted" style={{ marginTop: 6 }}>OPTION B — CREATE A NEW SKU IN THE SHARED MASTER</div>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      placeholder="Type your item description to create a new SKU…"
                      value={studentNewSkuName}
                      onChange={(e) => setStudentNewSkuName(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        if (!studentNewSkuName.trim()) return;
                        const del = DELIVERY_PROMPTS[studentDeliveryIdx % DELIVERY_PROMPTS.length];
                        sendStudentAction('create_sku', { name: studentNewSkuName.trim(), qty: del.qty });
                        setStudentNewSkuName('');
                        setStudentDeliveryIdx((i) => i + 1);
                        toast('Created new SKU in the shared classroom Item Master!');
                      }}
                    >
                      Create SKU
                    </button>
                  </div>
                </>
              )}

              {labId === 'psis_the_whip' && (
                <>
                  <div className="between">
                    <div className="tiny muted">LIVE BULLWHIP CHAIN · WEEK {labState.week}</div>
                    <strong className="mono tiny" style={{ color: 'var(--teal-700)' }}>
                      {myAssignment?.tier
                        ? `CHAIN ${myAssignment.chainNo} · ${WHIP_TIER_LABELS[myAssignment.tier]}`
                        : 'Waiting for lecturer to deal chains…'}
                    </strong>
                  </div>

                  <div className="card-soft stack-xs" style={{ padding: 12 }}>
                    <div className="small">
                      <strong>Information Visibility Mode:</strong>{' '}
                      {labState.sharedPos ? 'SHARED POS VISIBILITY (ALL TIERS SEE TRUE CONSUMER DEMAND)' : 'BLIND MODE (LOCAL ORDER SIGNAL ONLY)'}
                    </div>
                    {(labState.sharedPos || myAssignment?.tier === 'retailer') ? (
                      <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--teal-700)' }}>
                        Current End-Consumer POS Demand: {labState.consumerDemand} units/week
                      </div>
                    ) : (
                      <div className="small muted">
                        You cannot see end-consumer demand directly. Base your replenishment order on your last week’s downstream signal:{' '}
                        <strong className="mono">
                          {labState.history?.length
                            ? labState.history[labState.history.length - 1].avgByTier[
                                WHIP_TIERS[Math.max(0, WHIP_TIERS.indexOf(myAssignment?.tier || 'wholesaler') - 1)]
                              ]
                            : 40}{' '}
                          units
                        </strong>
                      </div>
                    )}
                  </div>

                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="input mono"
                      type="number"
                      min="0"
                      style={{ flex: 1 }}
                      value={studentOrderInput}
                      onChange={(e) => setStudentOrderInput(e.target.value)}
                      placeholder="Order quantity"
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        sendStudentAction('submit_order', { qty: Number(studentOrderInput) || 0 });
                        toast(`Submitted Week ${labState.week} order (${studentOrderInput} units).`);
                      }}
                    >
                      Submit Week {labState.week} Order
                    </button>
                  </div>
                </>
              )}

              {labId === 'psis_the_match' && (
                <>
                  <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div className="tiny muted">LIVE P2P SEGREGATION OF DUTIES TERMINAL</div>
                    <strong
                      className="mono tiny"
                      style={{ color: myAssignment?.isSuperUserDemo ? 'var(--red)' : 'var(--teal-700)' }}
                    >
                      {myAssignment?.groupNo
                        ? `GROUP ${myAssignment.groupNo} · ROLE: ${myAssignment.isSuperUserDemo ? 'SUPER-USER (ALL 4 ROLES!)' : (myAssignment.roles || []).join(', ').toUpperCase()}`
                        : 'Waiting for lecturer to deal P2P roles…'}
                    </strong>
                  </div>

                  {myAssignment?.isSuperUserDemo && (
                    <div className="notice-err small">
                      <strong>SUPER-USER DEMO ACTIVE:</strong> The lecturer granted your account all 4 P2P permissions. Try clicking steps 1 → 2 → 3 → 4 to pay a Ghost Vendor by yourself!
                    </div>
                  )}

                  <label className="stack-xs">
                    <span className="tiny muted">Supplier / Vendor Name</span>
                    <input
                      className="input"
                      value={studentVendorInput}
                      onChange={(e) => setStudentVendorInput(e.target.value)}
                    />
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                    {P2P_ACTIONS.map((act) => {
                      const permitted = (myAssignment?.roles || []).includes(act.role);
                      return (
                        <button
                          key={act.id}
                          type="button"
                          className={`btn ${permitted ? 'btn-primary' : ''}`}
                          style={{ justifyContent: 'space-between', textAlign: 'left', padding: '12px 14px' }}
                          onClick={() => {
                            sendStudentAction('p2p_action', { actionId: act.id, vendorName: studentVendorInput });
                            if (!permitted) {
                              setLastStudentFeedback({
                                type: 'error',
                                msg: `403 FORBIDDEN — Segregation of Duties blocked "${act.label}". Required role: ${act.role.toUpperCase()}.`,
                              });
                            } else {
                              setLastStudentFeedback({
                                type: 'ok',
                                msg: `✓ Executed "${act.label}" for "${studentVendorInput}".`,
                              });
                            }
                          }}
                        >
                          <div>
                            <div className="small" style={{ fontWeight: 700 }}>{act.label}</div>
                            <div className="tiny" style={{ opacity: 0.85 }}>{act.desc}</div>
                          </div>
                          <span className="mono tiny">{permitted ? 'ALLOW' : 'LOCKED'}</span>
                        </button>
                      );
                    })}
                  </div>

                  {lastStudentFeedback && (
                    <div className={lastStudentFeedback.type === 'error' ? 'notice-err small' : 'notice small'}>
                      {lastStudentFeedback.msg}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
