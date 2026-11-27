import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { useToast } from '../ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { rpc, supabase } from '../../lib/supabase.js';
import { downloadText } from '../../lib/sheets.js';
import { buildTypedResponsePdfBlob } from '../../lib/textPdf.js';
import { buildLiveSessionDebriefReport } from '../../lib/labMilestone6Engine.js';
import { LAB_CLOUD_SYNC_SQL } from '../../lib/allFeaturesSql.js';
import {
  listLocalLiveHostBackups,
  loadLocalLiveHostBackup,
  saveLocalLiveHostBackup,
} from '../../lib/labMilestone9Engine.js';
import { findMasterDataDuplicates } from '../../lib/psisLabEngine.js';
import {
  assignStudentsToChains,
  assignStudentsToP2pGroups,
  generateSessionCode,
} from '../../lib/psisMilestone4Engine.js';
import {
  advanceLiveAuctionRound,
  assignAuctionBidders,
  computeLiveAuctionMetrics,
  createInitialReverseAuctionState,
  processLiveAuctionBid,
} from '../../lib/labMilestone7Engine.js';
import {
  LIVE_INTEGRATIVE_ISSUES,
  assignNegotiationPairs,
  computeParetoFrontier,
  createInitialLiveNegState,
  evaluateIntegrativePackage,
  processLiveNegotiationMove,
} from '../../lib/labNegotiationEngine.js';

const LIVE_LAB_OPTIONS = [
  {
    id: 'psis_the_whip',
    code: 'PSIS-LAB 01',
    title: 'Demand Amplification — Live 4-Tier Bullwhip Chains',
    desc: 'Deal students into blind Retailer → Wholesaler → Distributor → Factory chains, inject a +40% rumour spike, then switch on Shared POS visibility.',
  },
  {
    id: 'psis_seven_names',
    code: 'PSIS-LAB 02',
    title: 'Item Master Data Governance — Shared Live Catalogue',
    desc: 'Students receive deliveries on their phones and either match existing SKUs or create duplicates. Reveal the live duplicate fragmentation on the projector.',
  },
  {
    id: 'psis_the_match',
    code: 'PSIS-LAB 04',
    title: 'P2P Controls & Segregation of Duties — Live 4-Role Audit',
    desc: 'Deal students into Buyer / Storekeeper / Finance / Manager roles with real 403 SoD blocks, then grant Group 1 Super-User to prove Ghost-Vendor fraud live.',
  },
  {
    id: 'psis_the_tender',
    code: 'PSIS-LAB 06',
    title: 'Electronic Tendering — Live Multi-Student Reverse Auction',
    desc: 'Students compete as rival suppliers on their phones in real-time bidding rounds while the projector tracks live price savings and Winner’s Curse risk.',
  },
  {
    id: 'neg_zopa_batna',
    code: 'NEG-LAB 01',
    title: 'Distributive Bargaining, BATNA & ZOPA — Live Paired Bargaining',
    desc: 'Pair students into confidential Buyer vs. Supplier desks with hidden reservation prices. Watch live settlements and impasses, then reveal the hidden ZOPA on the projector.',
  },
  {
    id: 'neg_integrative_pareto',
    code: 'NEG-LAB 02',
    title: 'Integrative Multi-Issue Negotiation — Live Pareto Frontier',
    desc: 'Pair students to logroll a 5-issue procurement contract using private point schedules, then plot every pair’s deal against the true Pareto Efficiency Frontier.',
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
  if (labId === 'psis_the_tender') {
    return createInitialReverseAuctionState();
  }
  if (labId === 'neg_zopa_batna' || labId === 'neg_integrative_pareto') {
    return createInitialLiveNegState(labId);
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

function LiveReverseAuctionChart({ state }) {
  const bids = state?.bids || [];
  const ceiling = Number(state?.reserveCeiling) || 120000;
  const floor = Number(state?.costFloor) || Math.round(ceiling * 0.78);
  const width = 560;
  const height = 185;
  const pad = { l: 58, r: 16, t: 16, b: 26 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;

  if (!bids.length) {
    return (
      <div className="card-soft small muted" style={{ padding: 18, textAlign: 'center' }}>
        Waiting for student bidders to submit opening bids below the {state?.currency || 'GHS'} {ceiling.toLocaleString()} ceiling…
      </div>
    );
  }

  const pts = [{ label: 'Ceiling', amount: ceiling }, ...bids.map((b, i) => ({ label: `B${i + 1}`, amount: b.amount, belowFloor: b.belowFloor }))];
  const minY = Math.min(floor * 0.92, ...pts.map((p) => p.amount)) * 0.96;
  const maxY = ceiling * 1.04;
  const span = Math.max(1, maxY - minY);
  const xOf = (idx) => (pts.length === 1 ? pad.l + plotW / 2 : pad.l + (idx / (pts.length - 1)) * plotW);
  const yOf = (v) => pad.t + plotH - ((v - minY) / span) * plotH;
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yOf(p.amount).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0, 0.5, 1].map((f) => {
        const val = minY + span * f;
        const y = yOf(val);
        return (
          <g key={f}>
            <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 3" />
            <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--muted)" fontFamily="monospace">
              {Math.round(val).toLocaleString()}
            </text>
          </g>
        );
      })}
      {(state?.revealCostFloor || bids.some((b) => b.belowFloor)) && (
        <g>
          <line x1={pad.l} x2={width - pad.r} y1={yOf(floor)} y2={yOf(floor)} stroke="#dc2626" strokeWidth="1.6" strokeDasharray="5 4" />
          <text x={width - pad.r - 4} y={yOf(floor) - 5} textAnchor="end" fontSize="9.5" fill="#dc2626" fontFamily="monospace">
            Sustainable Cost Floor: {floor.toLocaleString()}
          </text>
        </g>
      )}
      <path d={linePath} fill="none" stroke="#1d4ed8" strokeWidth="2.4" />
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={xOf(i)}
          cy={yOf(p.amount)}
          r={i === pts.length - 1 ? 4.5 : 3}
          fill={p.belowFloor ? '#dc2626' : '#0f766e'}
        />
      ))}
    </svg>
  );
}

function LiveDistributiveZopaChart({ state }) {
  const width = 560;
  const height = 160;
  const padL = 36;
  const padR = 36;
  const minP = 750;
  const maxP = 1350;
  const xOf = (v) => padL + ((Math.max(minP, Math.min(maxP, v)) - minP) / (maxP - minP)) * (width - padL - padR);
  const pairs = Object.entries(state?.pairs || {});
  const agreed = pairs.filter(([, p]) => p.status === 'agreed' && Number.isFinite(Number(p.agreedPrice)));
  const sFloor = Number(state?.supplierReservation) || 920;
  const bMax = Number(state?.buyerReservation) || 1180;
  const reveal = Boolean(state?.revealZopa);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block', background: '#fff', borderRadius: 8, border: '1px solid var(--line)' }}>
      <line x1={padL} y1={86} x2={width - padR} y2={86} stroke="#cbd5e1" strokeWidth="4" strokeLinecap="round" />
      {[800, 900, 1000, 1100, 1200, 1300].map((t) => (
        <g key={t}>
          <line x1={xOf(t)} y1={80} x2={xOf(t)} y2={92} stroke="#94a3b8" strokeWidth="1" />
          <text x={xOf(t)} y={108} textAnchor="middle" fontSize="10" fill="#64748b">{state?.currency || 'GHS'} {t}</text>
        </g>
      ))}
      {reveal ? (
        <>
          <rect x={xOf(sFloor)} y={58} width={Math.max(2, xOf(bMax) - xOf(sFloor))} height={56} rx={6} fill="#6d28d9" opacity="0.14" stroke="#6d28d9" strokeDasharray="4 3" />
          <line x1={xOf(sFloor)} y1={46} x2={xOf(sFloor)} y2={122} stroke="#0f766e" strokeWidth="2" />
          <text x={xOf(sFloor)} y={38} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f766e">Supplier Floor {sFloor}</text>
          <line x1={xOf(bMax)} y1={46} x2={xOf(bMax)} y2={122} stroke="#1d4ed8" strokeWidth="2" />
          <text x={xOf(bMax)} y={38} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1d4ed8">Buyer Max {bMax}</text>
          <text x={(xOf(sFloor) + xOf(bMax)) / 2} y={136} textAnchor="middle" fontSize="10" fontWeight="700" fill="#6d28d9">
            ZOPA = {state?.currency || 'GHS'} {sFloor} – {bMax} (Width {bMax - sFloor})
          </text>
        </>
      ) : (
        <text x={width / 2} y={32} textAnchor="middle" fontSize="11" fill="#64748b">
          Reservation prices & ZOPA hidden during live bargaining — click "Reveal ZOPA" to debrief
        </text>
      )}
      {agreed.map(([pairNo, p], idx) => {
        const cx = xOf(Number(p.agreedPrice));
        const cy = 72 + ((idx % 3) - 1) * 14;
        return (
          <g key={pairNo}>
            <circle cx={cx} cy={cy} r={7} fill="#6d28d9" stroke="#fff" strokeWidth="1.5" />
            <text x={cx} y={cy - 10} textAnchor="middle" fontSize="9" fontWeight="700" fill="#1e293b">P{pairNo}: {p.agreedPrice}</text>
          </g>
        );
      })}
      {agreed.length === 0 && (
        <text x={width / 2} y={148} textAnchor="middle" fontSize="10" fill="#94a3b8">
          Agreed pair settlements will plot along the price spectrum in real time.
        </text>
      )}
    </svg>
  );
}

function LiveIntegrativeParetoChart({ state }) {
  const width = 560;
  const height = 220;
  const pad = { l: 46, r: 20, t: 18, b: 34 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const frontier = computeParetoFrontier(
    state?.issues || LIVE_INTEGRATIVE_ISSUES,
    Number(state?.buyerBatnaPts) || 42,
    Number(state?.supplierBatnaPts) || 42,
  );
  const maxX = Math.max(100, ...frontier.allCombos.map((c) => c.buyerPoints), 105);
  const maxY = Math.max(100, ...frontier.allCombos.map((c) => c.supplierPoints), 105);
  const xOf = (v) => pad.l + (Math.max(0, v) / maxX) * plotW;
  const yOf = (v) => pad.t + plotH - (Math.max(0, v) / maxY) * plotH;
  const pairs = Object.entries(state?.pairs || {});
  const agreed = pairs.filter(([, p]) => p.status === 'agreed');
  const reveal = Boolean(state?.revealFrontier);
  const frontierPath = frontier.frontier
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.buyerPoints).toFixed(1)},${yOf(pt.supplierPoints).toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block', background: '#fff', borderRadius: 8, border: '1px solid var(--line)' }}>
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={pad.l} y1={yOf(v)} x2={width - pad.r} y2={yOf(v)} stroke="#f1f5f9" strokeWidth="1" />
          <text x={pad.l - 6} y={yOf(v) + 3} textAnchor="end" fontSize="9" fill="#64748b">{v}</text>
          <text x={xOf(v)} y={height - 14} textAnchor="middle" fontSize="9" fill="#64748b">{v}</text>
        </g>
      ))}
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={height - pad.b} stroke="#94a3b8" strokeWidth="1.2" />
      <line x1={pad.l} y1={height - pad.b} x2={width - pad.r} y2={height - pad.b} stroke="#94a3b8" strokeWidth="1.2" />
      <text x={width / 2} y={height - 2} textAnchor="middle" fontSize="10" fontWeight="600" fill="#334155">Buyer Utility Points</text>
      <text x={14} y={height / 2} textAnchor="middle" fontSize="10" fontWeight="600" fill="#334155" transform={`rotate(-90 14 ${height / 2})`}>Supplier Pts</text>
      {reveal ? (
        <>
          <line x1={xOf(state.buyerBatnaPts || 42)} y1={pad.t} x2={xOf(state.buyerBatnaPts || 42)} y2={height - pad.b} stroke="#94a3b8" strokeDasharray="4 3" />
          <line x1={pad.l} y1={yOf(state.supplierBatnaPts || 42)} x2={width - pad.r} y2={yOf(state.supplierBatnaPts || 42)} stroke="#94a3b8" strokeDasharray="4 3" />
          {frontier.allCombos.slice(0, 400).map((pt, i) => (
            <circle key={i} cx={xOf(pt.buyerPoints)} cy={yOf(pt.supplierPoints)} r={2} fill={pt.feasible ? '#c4b5fd' : '#e2e8f0'} />
          ))}
          {frontierPath && <path d={frontierPath} fill="none" stroke="#6d28d9" strokeWidth="2.5" />}
          {frontier.frontier.map((pt, i) => (
            <circle key={i} cx={xOf(pt.buyerPoints)} cy={yOf(pt.supplierPoints)} r={3.5} fill="#6d28d9" />
          ))}
        </>
      ) : (
        <text x={width / 2} y={34} textAnchor="middle" fontSize="11" fill="#64748b">
          Pareto Frontier hidden — click "Reveal Pareto Frontier" after pairs settle to expose value left on the table
        </text>
      )}
      {agreed.map(([pairNo, p]) => (
        <g key={pairNo}>
          <circle cx={xOf(p.buyerPts || 0)} cy={yOf(p.supplierPts || 0)} r={6.5} fill="#0f766e" stroke="#fff" strokeWidth="1.5" />
          <text x={xOf(p.buyerPts || 0)} y={yOf(p.supplierPts || 0) - 9} textAnchor="middle" fontSize="9" fontWeight="700" fill="#0f172a">
            P{pairNo} ({p.jointPts}pt)
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function LiveLabSessionModal({
  isHost = false,
  initialLabId = 'psis_seven_names',
  initialCode = '',
  courseId = null,
  courseCode = '',
  courses = [],
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
  const [attCourseId, setAttCourseId] = useState(courseId || courses?.[0]?.id || '');
  const [recordingAtt, setRecordingAtt] = useState(false);
  const [attRecordedCount, setAttRecordedCount] = useState(null);
  const [cloudPersistState, setCloudPersistState] = useState('checking'); // checking | active | local_only
  const [resumableSessions, setResumableSessions] = useState([]);
  const persistTimerRef = useRef(null);

  // Student-side UI controls
  const [studentDeliveryIdx, setStudentDeliveryIdx] = useState(0);
  const [studentNewSkuName, setStudentNewSkuName] = useState('');
  const [studentOrderInput, setStudentOrderInput] = useState('40');
  const [studentVendorInput, setStudentVendorInput] = useState('Ghost Shell Traders Ltd');
  const [studentBidInput, setStudentBidInput] = useState('');
  const [studentNegPriceInput, setStudentNegPriceInput] = useState('');
  const [studentNegPkg, setStudentNegPkg] = useState(() =>
    Object.fromEntries(LIVE_INTEGRATIVE_ISSUES.map((iss) => [iss.id, iss.options[1]?.id || iss.options[0]?.id])),
  );
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

  function persistHostSession(nextLabId, nextState, nextAssignments, nextParticipants, status = 'active') {
    if (!isHost || !sessionCode) return;
    const snap = {
      code: sessionCode,
      labId: nextLabId,
      courseId: courseId || attCourseId || null,
      state: nextState,
      assignments: nextAssignments,
      participants: nextParticipants || participants,
      updatedAt: new Date().toISOString(),
    };
    saveLocalLiveHostBackup(typeof localStorage !== 'undefined' ? localStorage : null, snap);
    if (cloudPersistState === 'local_only') return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      supabase.rpc('upsert_live_lab_session', {
        p_code: sessionCode,
        p_lab_id: nextLabId,
        p_course_id: snap.courseId,
        p_state: nextState,
        p_assignments: nextAssignments,
        p_participants: snap.participants,
        p_status: status,
      }).then(({ error }) => {
        if (error) {
          if (/Could not find|does not exist|schema cache/i.test(String(error.message || ''))) {
            setCloudPersistState('local_only');
          }
        } else {
          setCloudPersistState('active');
        }
      }).catch(() => {});
    }, 700);
  }

  function broadcastState(nextLabId, nextState, nextAssignments, extra = {}) {
    if (isHost) {
      persistHostSession(nextLabId, nextState, nextAssignments, participants, 'active');
    }
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

  // On host open: fetch resumable recent sessions (cloud + local backup)
  useEffect(() => {
    if (!isHost) return undefined;
    let alive = true;
    async function loadResumable() {
      const localList = listLocalLiveHostBackups(typeof localStorage !== 'undefined' ? localStorage : null)
        .filter((s) => s.code !== sessionCode)
        .map((s) => ({
          code: s.code,
          lab_id: s.labId,
          participants_count: (s.participants || []).length,
          updated_at: s.updatedAt,
          source: 'local',
        }));
      try {
        const { data, error } = await supabase.rpc('list_my_live_lab_sessions');
        if (!alive) return;
        if (error) {
          if (/Could not find|does not exist|schema cache/i.test(String(error.message || ''))) {
            setCloudPersistState('local_only');
          }
          setResumableSessions(localList.slice(0, 4));
          return;
        }
        setCloudPersistState('active');
        const cloudList = (Array.isArray(data) ? data : [])
          .filter((s) => s?.code && s.code !== sessionCode)
          .map((s) => ({ ...s, source: 'cloud' }));
        const seen = new Set(cloudList.map((s) => s.code));
        const merged = [...cloudList, ...localList.filter((s) => !seen.has(s.code))];
        setResumableSessions(merged.slice(0, 4));
      } catch {
        if (alive) setResumableSessions(localList.slice(0, 4));
      }
    }
    loadResumable();
    return () => {
      alive = false;
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [isHost, sessionCode]);

  // On student join: hydrate latest server snapshot immediately so reconnects recover exact round/role
  useEffect(() => {
    if (isHost || !sessionCode) return undefined;
    let alive = true;
    supabase.rpc('get_live_lab_session', { p_code: sessionCode }).then(({ data, error }) => {
      if (!alive || error || !data) return;
      if (data.lab_id) setLabId(data.lab_id);
      if (data.state && typeof data.state === 'object') setLabState(data.state);
      if (data.assignments && typeof data.assignments === 'object') setAssignments(data.assignments);
      if (Array.isArray(data.participants) && data.participants.length) setParticipants(data.participants);
    }).catch(() => {});
    return () => { alive = false; };
  }, [isHost, sessionCode]);

  async function resumeSavedSession(item) {
    if (!item?.code) return;
    try {
      let snap = null;
      if (item.source === 'cloud') {
        const { data } = await supabase.rpc('get_live_lab_session', { p_code: item.code });
        if (data) {
          snap = {
            code: data.code,
            labId: data.lab_id,
            state: data.state,
            assignments: data.assignments,
            participants: data.participants,
          };
        }
      }
      if (!snap) {
        snap = loadLocalLiveHostBackup(typeof localStorage !== 'undefined' ? localStorage : null, item.code);
      }
      if (!snap) {
        toast('Saved session snapshot was not found.', 'error');
        return;
      }
      setSessionCode(snap.code);
      if (snap.labId) setLabId(snap.labId);
      if (snap.state) setLabState(snap.state);
      if (snap.assignments) setAssignments(snap.assignments);
      if (Array.isArray(snap.participants)) setParticipants(snap.participants);
      setResumableSessions((prev) => prev.filter((x) => x.code !== snap.code));
      pushLog('Lecturer', 'SESSION_RESUMED', `Resumed live session ${snap.code} with crash-recovery state`);
      toast(`Resumed live session ${snap.code}! Students can rejoin using the same code.`);
    } catch (e) {
      toast(e?.message || 'Could not resume saved session.', 'error');
    }
  }

  async function copyCloudSyncSql() {
    try {
      await navigator.clipboard.writeText(LAB_CLOUD_SYNC_SQL);
      toast('Copied Cloud Draft & Live Session SQL! Paste and Run once in Supabase SQL Editor.');
    } catch {
      toast('Could not copy SQL automatically.', 'error');
    }
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
    } else if (curLab === 'psis_the_tender' && actionType === 'submit_bid') {
      const bidderMeta = curAssign[fromId];
      const bidderLabel = bidderMeta ? `${bidderMeta.bidderCode} (${fromName})` : fromName;
      const res = processLiveAuctionBid(curState, {
        bidId: data.bidId,
        bidderId: fromId,
        bidderName: bidderLabel,
        amount: Number(data.amount),
      });
      if (!res.ok) {
        if (!res.duplicate) {
          pushLog(fromName, 'BID_REJECTED', res.reason);
        }
        return;
      }
      setLabState(res.nextState);
      pushLog(
        bidderLabel,
        res.belowFloor ? 'WINNERS_CURSE_BID' : 'REVERSE_BID',
        `Bid ${res.nextState.currency} ${res.entry.amount.toLocaleString()} (Round ${res.entry.round})${res.belowFloor ? ' — BELOW SUSTAINABLE COST FLOOR!' : ''}`,
      );
      broadcastState(curLab, res.nextState, curAssign);
    } else if ((curLab === 'neg_zopa_batna' || curLab === 'neg_integrative_pareto') && actionType === 'neg_move') {
      const slot = curAssign[fromId] || { pairNo: data.pairNo || 1, role: data.role || 'buyer' };
      const res = processLiveNegotiationMove(curState, {
        moveId: data.moveId,
        pairNo: slot.pairNo,
        role: slot.role,
        fromName,
        action: data.action,
        price: data.price,
        packageChoices: data.packageChoices,
      });
      if (!res.accepted) return;
      setLabState(res.nextState);
      pushLog(
        fromName,
        data.action === 'accept_latest' ? 'DEAL_AGREED' : data.action === 'walk_away' ? 'IMPASSE_BATNA' : 'NEG_OFFER',
        res.summary,
      );
      broadcastState(curLab, res.nextState, curAssign);
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
          persistHostSession(labIdRef.current, stateRef.current, assignmentsRef.current, participants, 'active');
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
    } else if (labId === 'psis_the_tender') {
      const nextA = assignAuctionBidders(participants);
      setAssignments(nextA);
      pushLog('Lecturer', 'DEAL_BIDDERS', `Assigned bidder codes & private cost guidance to ${participants.length} participant(s).`);
      broadcastState(labId, labState, nextA);
      toast(`Assigned bidder IDs to ${participants.length} student(s).`);
    } else if (labId === 'neg_zopa_batna' || labId === 'neg_integrative_pareto') {
      const nextA = assignNegotiationPairs(participants, labId);
      setAssignments(nextA);
      const pairCount = Math.ceil(participants.length / 2);
      pushLog('Lecturer', 'DEAL_NEG_PAIRS', `Paired ${participants.length} student(s) into ${pairCount} Buyer vs. Supplier desk(s).`);
      broadcastState(labId, labState, nextA);
      toast(`Dealt ${participants.length} students into ${pairCount} Buyer vs. Supplier pair(s).`);
    }
  }

  function toggleNegReveal() {
    const field = labId === 'neg_integrative_pareto' ? 'revealFrontier' : 'revealZopa';
    const nextVal = !labState[field];
    const nextState = { ...labState, [field]: nextVal };
    setLabState(nextState);
    pushLog('Lecturer', field === 'revealFrontier' ? 'REVEAL_PARETO' : 'REVEAL_ZOPA', nextVal ? 'Revealed hidden negotiation analysis on projector' : 'Hid negotiation reveal');
    broadcastState(labId, nextState, assignments);
  }

  function nextAuctionRound() {
    const nextState = advanceLiveAuctionRound(labState);
    setLabState(nextState);
    pushLog('Lecturer', 'AUCTION_ROUND', `Opened Reverse Auction Round ${nextState.round}`);
    broadcastState(labId, nextState, assignments);
  }

  function toggleAuctionFloorReveal() {
    const nextState = { ...labState, revealCostFloor: !labState.revealCostFloor };
    setLabState(nextState);
    pushLog('Lecturer', 'COST_FLOOR', nextState.revealCostFloor ? 'Revealed Sustainable Cost Floor on projector' : 'Hid Sustainable Cost Floor');
    broadcastState(labId, nextState, assignments);
  }

  function awardLiveAuction() {
    const nextState = {
      ...labState,
      status: 'awarded',
      revealCostFloor: true,
      winner: labState.leaderName ? { name: labState.leaderName, amount: labState.currentLowestBid } : null,
    };
    setLabState(nextState);
    pushLog(
      'Lecturer',
      'AUCTION_AWARDED',
      nextState.winner
        ? `Awarded contract to ${nextState.winner.name} at ${nextState.currency} ${nextState.winner.amount.toLocaleString()}`
        : 'Closed Reverse Auction with no bids',
    );
    broadcastState(labId, nextState, assignments);
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

  async function recordLiveAttendance() {
    const targetCourseId = courseId || attCourseId;
    if (!targetCourseId) {
      toast('Select a course first before recording attendance.', 'error');
      return;
    }
    const indexed = participants.filter((p) => p.indexNo && String(p.indexNo).trim());
    if (!indexed.length) {
      toast('No connected students with index numbers found yet.', 'error');
      return;
    }
    setRecordingAtt(true);
    try {
      const sessionTitle = `Live Lab: ${activeLabMeta.code} (${sessionCode})`;
      const attSessionId = await rpc('start_manual_rollcall', {
        p_course: targetCourseId,
        p_title: sessionTitle,
        p_streams: [],
        p_classes: [],
      });
      let okCount = 0;
      for (const stu of indexed) {
        try {
          await rpc('set_attendance', {
            p_session: attSessionId,
            p_index: String(stu.indexNo).trim(),
            p_present: true,
          });
          okCount += 1;
        } catch {
          // skip student if not enrolled in selected course
        }
      }
      setAttRecordedCount(okCount);
      pushLog('Lecturer', 'ATTENDANCE_SAVED', `Credited ${okCount} student(s) into Class Attendance (${sessionTitle})`);
      toast(`Recorded attendance for ${okCount} student${okCount === 1 ? '' : 's'} in Class Attendance & CA!`);
    } catch (err) {
      toast(err?.message || 'Could not record attendance. Ensure manual roll-call SQL is enabled.', 'error');
    } finally {
      setRecordingAtt(false);
    }
  }

  function exportDebriefPdf() {
    const body = buildLiveSessionDebriefReport({
      labId,
      labTitle: activeLabMeta.title,
      sessionCode,
      courseCode,
      participants,
      labState,
      dupAudit,
      eventLog,
    });
    const blob = buildTypedResponsePdfBlob({
      title: `Live Lab Debrief — ${activeLabMeta.code} (${sessionCode})`,
      studentLine: `Lecturer: ${profile?.full_name || 'Faculty'}${courseCode ? ` · ${courseCode}` : ''} · ${participants.length} participants`,
      submittedAt: new Date().toLocaleString(),
      body,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `live-lab-debrief-${sessionCode}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported Post-Class Live Debrief PDF (ready to upload to Course Materials).');
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
            {isHost && (
              <div className="row-wrap" style={{ gap: 8, marginTop: 4, alignItems: 'center' }}>
                <span className="tiny mono muted">
                  {cloudPersistState === 'active'
                    ? '● SERVER RECOVERY ACTIVE (SAFE TO REFRESH)'
                    : 'Local crash recovery active'}
                </span>
                {cloudPersistState === 'local_only' && (
                  <button type="button" className="btn btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={copyCloudSyncSql}>
                    Copy Cloud Sync SQL
                  </button>
                )}
              </div>
            )}
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
              <>
                {!courseId && courses?.length > 0 && (
                  <select
                    className="input"
                    style={{ width: 'auto', padding: '5px 8px', fontSize: 12 }}
                    value={attCourseId}
                    onChange={(e) => setAttCourseId(e.target.value)}
                    aria-label="Course for attendance credit"
                  >
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>{c.code}</option>
                    ))}
                  </select>
                )}
                {(courseId || attCourseId) && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={recordingAtt || participants.length === 0}
                    onClick={recordLiveAttendance}
                    title="Create a Class Attendance session and mark all connected students present (flows directly into Attendance CA)"
                  >
                    <Icon name="check" size={13} />{' '}
                    {recordingAtt
                      ? 'Saving Attendance…'
                      : attRecordedCount !== null
                        ? `Attendance Saved (${attRecordedCount})`
                        : 'Credit Attendance'}
                  </button>
                )}
                <button type="button" className="btn btn-sm" onClick={exportDebriefPdf}>
                  <Icon name="file" size={13} /> Debrief PDF
                </button>
                <button type="button" className="btn btn-sm" onClick={exportEventLogCsv}>
                  <Icon name="download" size={13} /> Log CSV
                </button>
              </>
            )}
            <button type="button" className="btn btn-sm" onClick={onClose}>
              <Icon name="close" size={14} /> {isHost ? 'End Live Session' : 'Leave Session'}
            </button>
          </div>
        </div>

        {isHost && resumableSessions.length > 0 && (
          <div
            className="between small"
            style={{
              padding: '8px 20px',
              background: '#eff6ff',
              borderBottom: '1px solid #bfdbfe',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div className="tiny" style={{ color: '#1e3a8a' }}>
              <strong>Resume Previous Live Session:</strong> Pick up where you left off after a browser refresh or Wi-Fi drop.
            </div>
            <div className="row-wrap" style={{ gap: 6 }}>
              {resumableSessions.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => resumeSavedSession(s)}
                >
                  Resume {s.code} ({s.participants_count || 0} students)
                </button>
              ))}
            </div>
          </div>
        )}

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
                      {opt.code}: {opt.id === 'psis_seven_names' ? 'Master Data' : opt.id === 'psis_the_whip' ? 'Bullwhip Chains' : opt.id === 'psis_the_tender' ? 'Reverse Auction' : opt.id === 'neg_zopa_batna' ? 'ZOPA Bargaining' : opt.id === 'neg_integrative_pareto' ? 'Pareto Frontier' : 'P2P Controls'}
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

                  {labId === 'psis_the_tender' && (() => {
                    const metrics = computeLiveAuctionMetrics(labState);
                    return (
                      <>
                        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                          <div>
                            <div className="tiny muted">LIVE MULTI-STUDENT REVERSE AUCTION · ROUND {labState.round || 1} ({labState.status === 'awarded' ? 'AWARDED' : 'BIDDING OPEN'})</div>
                            <div className="small"><strong>{labState.lotTitle}</strong></div>
                          </div>
                          <div className="row-wrap" style={{ gap: 6 }}>
                            <button type="button" className="btn btn-sm" onClick={dealParticipants}>Assign Bidders</button>
                            <button type="button" className="btn btn-sm" disabled={labState.status === 'awarded'} onClick={nextAuctionRound}>Next Round</button>
                            <button type="button" className="btn btn-sm" onClick={toggleAuctionFloorReveal}>
                              {labState.revealCostFloor ? 'Hide Cost Floor' : 'Reveal Cost Floor'}
                            </button>
                            <button type="button" className="btn btn-primary btn-sm" disabled={labState.status === 'awarded'} onClick={awardLiveAuction}>
                              Award Contract
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 8 }}>
                          <div className="card-soft" style={{ padding: 10 }}>
                            <div className="tiny muted">Reserve Ceiling</div>
                            <strong className="mono">{labState.currency} {(labState.reserveCeiling || 0).toLocaleString()}</strong>
                          </div>
                          <div className="card-soft" style={{ padding: 10 }}>
                            <div className="tiny muted">Current Leading Bid</div>
                            <strong className="mono" style={{ color: metrics.winnersCurseTriggered ? 'var(--red)' : 'var(--teal-700)' }}>
                              {labState.currency} {(labState.currentLowestBid || 0).toLocaleString()}
                            </strong>
                            <div className="tiny muted">{labState.leaderName || 'No bids yet'}</div>
                          </div>
                          <div className="card-soft" style={{ padding: 10 }}>
                            <div className="tiny muted">Savings vs Ceiling</div>
                            <strong className="mono" style={{ color: 'var(--teal-700)' }}>{metrics.savingsPct}%</strong>
                            <div className="tiny muted">{labState.currency} {metrics.savingsAmount.toLocaleString()}</div>
                          </div>
                          <div className="card-soft" style={{ padding: 10 }}>
                            <div className="tiny muted">Winner’s Curse Risk</div>
                            <strong className="mono" style={{ color: metrics.winnersCurseTriggered ? 'var(--red)' : 'var(--teal-700)' }}>
                              {metrics.winnersCurseTriggered ? '▲ TRIGGERED' : '● SUSTAINABLE'}
                            </strong>
                            <div className="tiny muted">{metrics.totalBids} total bid{metrics.totalBids === 1 ? '' : 's'}</div>
                          </div>
                        </div>
                        <LiveReverseAuctionChart state={labState} />
                        {labState.status === 'awarded' && labState.winner && (
                          <div className={metrics.winnersCurseTriggered ? 'notice-err small' : 'notice small'}>
                            <strong>Contract Awarded to {labState.winner.name}</strong> at{' '}
                            <strong className="mono">{labState.currency} {labState.winner.amount.toLocaleString()}</strong> ({metrics.savingsPct}% savings).{' '}
                            {metrics.winnersCurseTriggered
                              ? `WARNING: Winning bid is below the ${labState.currency} ${(labState.costFloor || 0).toLocaleString()} sustainable cost floor — debrief quality/default risk!`
                              : 'Winning bid remains above the sustainable delivery cost floor.'}
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {labId === 'neg_zopa_batna' && (() => {
                    const pairEntries = Object.entries(labState.pairs || {});
                    const totalPairs = Math.max(pairEntries.length, Math.ceil(participants.length / 2));
                    const agreedPairs = pairEntries.filter(([, p]) => p.status === 'agreed');
                    const impassePairs = pairEntries.filter(([, p]) => p.status === 'impasse');
                    const avgPrice = agreedPairs.length
                      ? Math.round(agreedPairs.reduce((s, [, p]) => s + (Number(p.agreedPrice) || 0), 0) / agreedPairs.length)
                      : null;
                    return (
                      <>
                        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                          <div>
                            <div className="tiny muted">LIVE PAIRED DISTRIBUTIVE BARGAINING · {labState.itemLabel}</div>
                            <div className="small muted">Students receive private reservation prices. Watch agreements & impasses unfold live.</div>
                          </div>
                          <div className="row-wrap" style={{ gap: 6 }}>
                            <button type="button" className="btn btn-sm" onClick={dealParticipants}>Deal Buyer/Supplier Pairs</button>
                            <button type="button" className={`btn btn-sm ${labState.revealZopa ? '' : 'btn-primary'}`} onClick={toggleNegReveal}>
                              {labState.revealZopa ? 'Hide ZOPA' : 'Reveal Hidden ZOPA'}
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: 8 }}>
                          <div className="card-soft" style={{ padding: 10 }}>
                            <div className="tiny muted">Active Pairs</div>
                            <strong className="mono" style={{ fontSize: 18 }}>{totalPairs}</strong>
                          </div>
                          <div className="card-soft" style={{ padding: 10 }}>
                            <div className="tiny muted">Deals Agreed</div>
                            <strong className="mono" style={{ fontSize: 18, color: 'var(--teal-700)' }}>{agreedPairs.length}</strong>
                          </div>
                          <div className="card-soft" style={{ padding: 10 }}>
                            <div className="tiny muted">Impasses (BATNA)</div>
                            <strong className="mono" style={{ fontSize: 18, color: impassePairs.length ? 'var(--red)' : 'var(--muted)' }}>{impassePairs.length}</strong>
                          </div>
                          <div className="card-soft" style={{ padding: 10 }}>
                            <div className="tiny muted">Avg Settlement</div>
                            <strong className="mono" style={{ fontSize: 18 }}>{avgPrice ? `${labState.currency} ${avgPrice.toLocaleString()}` : '—'}</strong>
                          </div>
                        </div>
                        <LiveDistributiveZopaChart state={labState} />
                        {pairEntries.length > 0 && (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                                  <th style={{ padding: '6px 8px' }}>Pair</th>
                                  <th style={{ padding: '6px 8px' }}>Status</th>
                                  <th style={{ padding: '6px 8px' }}>Offers</th>
                                  <th style={{ padding: '6px 8px' }}>Latest / Agreed</th>
                                  {labState.revealZopa && <th style={{ padding: '6px 8px' }}>Buyer / Supplier Surplus</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {pairEntries.map(([pairNo, p]) => {
                                  const latest = p.offers?.[p.offers.length - 1];
                                  const bSur = p.status === 'agreed' ? (labState.buyerReservation - p.agreedPrice) : null;
                                  const sSur = p.status === 'agreed' ? (p.agreedPrice - labState.supplierReservation) : null;
                                  return (
                                    <tr key={pairNo} style={{ borderBottom: '1px solid var(--line)' }}>
                                      <td className="mono" style={{ padding: '6px 8px', fontWeight: 700 }}>Pair {pairNo}</td>
                                      <td style={{ padding: '6px 8px', color: p.status === 'agreed' ? 'var(--teal-700)' : p.status === 'impasse' ? 'var(--red)' : '#b45309', fontWeight: 600 }}>
                                        {p.status.toUpperCase()}
                                      </td>
                                      <td className="mono" style={{ padding: '6px 8px' }}>{p.offers?.length || 0}</td>
                                      <td className="mono" style={{ padding: '6px 8px' }}>
                                        {p.status === 'agreed' ? `${labState.currency} ${p.agreedPrice.toLocaleString()}` : latest ? `${labState.currency} ${latest.price.toLocaleString()} (${latest.role})` : '—'}
                                      </td>
                                      {labState.revealZopa && (
                                        <td className="mono" style={{ padding: '6px 8px' }}>
                                          {p.status === 'agreed' ? `B: ${bSur >= 0 ? '+' : ''}${bSur} · S: ${sSur >= 0 ? '+' : ''}${sSur}` : '—'}
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {labId === 'neg_integrative_pareto' && (() => {
                    const pairEntries = Object.entries(labState.pairs || {});
                    const totalPairs = Math.max(pairEntries.length, Math.ceil(participants.length / 2));
                    const agreedPairs = pairEntries.filter(([, p]) => p.status === 'agreed');
                    const impassePairs = pairEntries.filter(([, p]) => p.status === 'impasse');
                    const avgJoint = agreedPairs.length
                      ? Math.round(agreedPairs.reduce((s, [, p]) => s + (Number(p.jointPts) || 0), 0) / agreedPairs.length)
                      : null;
                    const frontier = computeParetoFrontier(
                      labState.issues || LIVE_INTEGRATIVE_ISSUES,
                      labState.buyerBatnaPts || 42,
                      labState.supplierBatnaPts || 42,
                    );
                    return (
                      <>
                        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                          <div>
                            <div className="tiny muted">LIVE MULTI-ISSUE INTEGRATIVE NEGOTIATION · 5 ISSUES</div>
                            <div className="small muted">Pairs trade off price, payment terms, lead time, warranty & volume to expand the pie.</div>
                          </div>
                          <div className="row-wrap" style={{ gap: 6 }}>
                            <button type="button" className="btn btn-sm" onClick={dealParticipants}>Deal Buyer/Supplier Pairs</button>
                            <button type="button" className={`btn btn-sm ${labState.revealFrontier ? '' : 'btn-primary'}`} onClick={toggleNegReveal}>
                              {labState.revealFrontier ? 'Hide Pareto Frontier' : 'Reveal Pareto Frontier'}
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: 8 }}>
                          <div className="card-soft" style={{ padding: 10 }}>
                            <div className="tiny muted">Active Pairs</div>
                            <strong className="mono" style={{ fontSize: 18 }}>{totalPairs}</strong>
                          </div>
                          <div className="card-soft" style={{ padding: 10 }}>
                            <div className="tiny muted">Deals Agreed</div>
                            <strong className="mono" style={{ fontSize: 18, color: 'var(--teal-700)' }}>{agreedPairs.length}</strong>
                          </div>
                          <div className="card-soft" style={{ padding: 10 }}>
                            <div className="tiny muted">Avg Joint Score</div>
                            <strong className="mono" style={{ fontSize: 18, color: '#6d28d9' }}>{avgJoint ? `${avgJoint} pts` : '—'}</strong>
                          </div>
                          <div className="card-soft" style={{ padding: 10 }}>
                            <div className="tiny muted">Max Possible Joint</div>
                            <strong className="mono" style={{ fontSize: 18 }}>{labState.revealFrontier ? `${(frontier.maxJointDeal?.jointPoints || 0)} pts` : 'Hidden'}</strong>
                          </div>
                        </div>
                        <LiveIntegrativeParetoChart state={labState} />
                        {pairEntries.length > 0 && (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left' }}>
                                  <th style={{ padding: '6px 8px' }}>Pair</th>
                                  <th style={{ padding: '6px 8px' }}>Status</th>
                                  <th style={{ padding: '6px 8px' }}>Offers</th>
                                  <th style={{ padding: '6px 8px' }}>Buyer / Supplier Pts</th>
                                  <th style={{ padding: '6px 8px' }}>Joint Score</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pairEntries.map(([pairNo, p]) => (
                                  <tr key={pairNo} style={{ borderBottom: '1px solid var(--line)' }}>
                                    <td className="mono" style={{ padding: '6px 8px', fontWeight: 700 }}>Pair {pairNo}</td>
                                    <td style={{ padding: '6px 8px', color: p.status === 'agreed' ? 'var(--teal-700)' : p.status === 'impasse' ? 'var(--red)' : '#b45309', fontWeight: 600 }}>
                                      {p.status.toUpperCase()}
                                    </td>
                                    <td className="mono" style={{ padding: '6px 8px' }}>{p.offers?.length || 0}</td>
                                    <td className="mono" style={{ padding: '6px 8px' }}>
                                      {p.status === 'agreed' ? `B: ${p.buyerPts} · S: ${p.supplierPts}` : 'In negotiation…'}
                                    </td>
                                    <td className="mono" style={{ padding: '6px 8px', fontWeight: 700, color: '#6d28d9' }}>
                                      {p.status === 'agreed' ? `${p.jointPts} / ${(frontier.maxJointDeal?.jointPoints || 0)}` : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    );
                  })()}
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
                          : a?.bidderCode
                            ? a.bidderCode
                          : a?.pairNo
                            ? `P${a.pairNo}·${a.role === 'buyer' ? 'BUYER' : 'SUPPLIER'}`
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

              {labId === 'psis_the_tender' && (() => {
                const curLow = Number(labState.currentLowestBid) || Number(labState.reserveCeiling) || 120000;
                const minDec = Number(labState.minDecrementPct) || 1;
                const maxNextBid = (labState.bids || []).length === 0
                  ? curLow
                  : Math.floor(curLow * (1 - minDec / 100));
                const privateCostEst = Math.round((Number(labState.costFloor) || 93600) * (myAssignment?.costMultiplier || 1));
                const isLeading = labState.leaderId === clientIdRef.current;
                const submitQuickBid = (amt) => {
                  const val = Math.round(Number(amt));
                  if (!val || val <= 0) return;
                  if (val > maxNextBid) {
                    toast(`Bid must be ≤ ${labState.currency} ${maxNextBid.toLocaleString()} (min ${minDec}% below current low).`, 'error');
                    return;
                  }
                  sendStudentAction('submit_bid', {
                    bidId: `${clientIdRef.current}:${Date.now()}:${val}`,
                    amount: val,
                  });
                  setStudentBidInput('');
                  toast(`Submitted bid of ${labState.currency} ${val.toLocaleString()}!`);
                };
                return (
                  <>
                    <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <div className="tiny muted">LIVE REVERSE AUCTION · ROUND {labState.round || 1}</div>
                      <strong className="mono tiny" style={{ color: isLeading ? 'var(--teal-700)' : '#1d4ed8' }}>
                        {myAssignment?.bidderCode || 'BIDDER READY'}{isLeading ? ' · ★ CURRENT LEADER' : ''}
                      </strong>
                    </div>
                    <div className="small"><strong>{labState.lotTitle}</strong></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div className="card-soft" style={{ padding: 10 }}>
                        <div className="tiny muted">Current Lowest Bid</div>
                        <strong className="mono" style={{ fontSize: 17 }}>{labState.currency} {curLow.toLocaleString()}</strong>
                        <div className="tiny muted">{labState.leaderName || 'Opening ceiling'}</div>
                      </div>
                      <div className="card-soft" style={{ padding: 10 }}>
                        <div className="tiny muted">Your Estimated Cost Floor</div>
                        <strong className="mono" style={{ fontSize: 17, color: '#b45309' }}>{labState.currency} {privateCostEst.toLocaleString()}</strong>
                        <div className="tiny muted">Bidding below this risks losses</div>
                      </div>
                    </div>
                    {labState.status === 'awarded' ? (
                      <div className="notice small">
                        <strong>Auction Closed:</strong> Awarded to {labState.winner?.name || '—'} at{' '}
                        <strong className="mono">{labState.currency} {(labState.winner?.amount || curLow).toLocaleString()}</strong>.
                      </div>
                    ) : (
                      <>
                        <div className="row-wrap" style={{ gap: 8 }}>
                          <button type="button" className="btn btn-sm" onClick={() => submitQuickBid(Math.floor(curLow * 0.98))}>
                            Quick Bid −2% ({Math.floor(curLow * 0.98).toLocaleString()})
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => submitQuickBid(Math.floor(curLow * 0.95))}>
                            Aggressive −5% ({Math.floor(curLow * 0.95).toLocaleString()})
                          </button>
                        </div>
                        <div className="row" style={{ gap: 8 }}>
                          <input
                            className="input mono"
                            type="number"
                            style={{ flex: 1 }}
                            placeholder={`Enter bid ≤ ${maxNextBid.toLocaleString()}`}
                            value={studentBidInput}
                            onChange={(e) => setStudentBidInput(e.target.value)}
                          />
                          <button type="button" className="btn btn-primary" onClick={() => submitQuickBid(studentBidInput || maxNextBid)}>
                            Place Bid
                          </button>
                        </div>
                      </>
                    )}
                  </>
                );
              })()}

              {labId === 'neg_zopa_batna' && (() => {
                const pairNo = myAssignment?.pairNo;
                const role = myAssignment?.role;
                const pairState = pairNo ? labState.pairs?.[String(pairNo)] : null;
                const offers = pairState?.offers || [];
                const latest = offers[offers.length - 1];
                const canAccept = Boolean(pairState?.status !== 'agreed' && pairState?.status !== 'impasse' && latest && latest.role !== role);
                const isClosed = pairState?.status === 'agreed' || pairState?.status === 'impasse';
                const privateLimit = role === 'buyer' ? labState.buyerReservation : labState.supplierReservation;
                const sendNegMove = (action, extra = {}) => {
                  if (!pairNo || !role) {
                    toast('Wait for your lecturer to click "Deal Buyer/Supplier Pairs".', 'error');
                    return;
                  }
                  sendStudentAction('neg_move', {
                    moveId: `${clientIdRef.current}:${Date.now()}:${action}`,
                    pairNo,
                    role,
                    action,
                    ...extra,
                  });
                };
                return (
                  <>
                    <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <div className="tiny muted">DISTRIBUTIVE BARGAINING · {labState.itemLabel}</div>
                      <strong className="mono tiny" style={{ color: '#6d28d9' }}>
                        {pairNo ? `PAIR ${pairNo} · ${role === 'buyer' ? 'BUYER DESK' : 'SUPPLIER DESK'}` : 'WAITING FOR PAIR ASSIGNMENT'}
                      </strong>
                    </div>
                    {!pairNo ? (
                      <div className="notice small">Connected! Wait for your lecturer to click <strong>Deal Buyer/Supplier Pairs</strong> to receive your confidential role and reservation price.</div>
                    ) : (
                      <>
                        <div className="card-soft" style={{ padding: 12, borderLeft: '4px solid #6d28d9' }}>
                          <div className="tiny muted">CONFIDENTIAL BRIEF — DO NOT SHOW YOUR COUNTERPART</div>
                          <div className="small" style={{ marginTop: 4 }}>
                            You are the <strong>{myAssignment.roleLabel}</strong> in <strong>Pair {pairNo}</strong>.{' '}
                            {role === 'buyer'
                              ? <>Your maximum Walk-Away Price (Buyer Reservation / BATNA) is <strong className="mono">{labState.currency} {privateLimit.toLocaleString()}</strong>. Negotiate as LOW as possible without losing the deal.</>
                              : <>Your minimum Walk-Away Floor (Supplier Reservation / BATNA) is <strong className="mono">{labState.currency} {privateLimit.toLocaleString()}</strong>. Negotiate as HIGH as possible without triggering an impasse.</>}
                          </div>
                        </div>

                        {offers.length > 0 && (
                          <div className="stack-xs" style={{ maxHeight: 160, overflowY: 'auto', padding: 8, background: 'var(--surface-2)', borderRadius: 8 }}>
                            <div className="tiny muted">PAIR {pairNo} OFFER HISTORY</div>
                            {offers.map((o, idx) => (
                              <div key={idx} className="between small" style={{ padding: '4px 6px', borderBottom: '1px solid var(--line)' }}>
                                <span><strong>{o.role === 'buyer' ? 'Buyer' : 'Supplier'}</strong> ({o.fromName})</span>
                                <strong className="mono">{labState.currency} {o.price.toLocaleString()}</strong>
                              </div>
                            ))}
                          </div>
                        )}

                        {isClosed ? (
                          <div className={pairState.status === 'agreed' ? 'notice small' : 'notice-err small'}>
                            {pairState.status === 'agreed' ? (
                              <>
                                <strong>Deal Agreed at {labState.currency} {pairState.agreedPrice.toLocaleString()}!</strong>{' '}
                                Your private surplus vs. BATNA:{' '}
                                <strong className="mono">
                                  {role === 'buyer'
                                    ? `${labState.buyerReservation - pairState.agreedPrice >= 0 ? '+' : ''}${labState.currency} ${(labState.buyerReservation - pairState.agreedPrice).toLocaleString()}`
                                    : `${pairState.agreedPrice - labState.supplierReservation >= 0 ? '+' : ''}${labState.currency} ${(pairState.agreedPrice - labState.supplierReservation).toLocaleString()}`}
                                </strong>
                              </>
                            ) : (
                              <><strong>Impasse — Walked Away to BATNA.</strong> Closed by {pairState.closedBy}.</>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="row" style={{ gap: 8 }}>
                              <input
                                className="input mono"
                                type="number"
                                style={{ flex: 1 }}
                                placeholder={`Enter ${role === 'buyer' ? 'buy' : 'sell'} offer (${labState.currency})`}
                                value={studentNegPriceInput}
                                onChange={(e) => setStudentNegPriceInput(e.target.value)}
                              />
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => {
                                  const v = Number(studentNegPriceInput);
                                  if (!Number.isFinite(v) || v <= 0) {
                                    toast('Enter a positive price offer.', 'error');
                                    return;
                                  }
                                  sendNegMove('offer', { price: v });
                                  setStudentNegPriceInput('');
                                  toast(`Sent offer: ${labState.currency} ${v.toLocaleString()}`);
                                }}
                              >
                                Send Offer
                              </button>
                            </div>
                            <div className="row-wrap" style={{ gap: 8 }}>
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={!canAccept}
                                onClick={() => sendNegMove('accept_latest')}
                              >
                                {canAccept ? `Accept Counterpart's ${labState.currency} ${latest.price.toLocaleString()}` : 'Accept Counterpart Offer'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{ color: 'var(--red)' }}
                                onClick={() => sendNegMove('walk_away')}
                              >
                                Walk Away (BATNA)
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </>
                );
              })()}

              {labId === 'neg_integrative_pareto' && (() => {
                const pairNo = myAssignment?.pairNo;
                const role = myAssignment?.role;
                const issues = labState.issues || LIVE_INTEGRATIVE_ISSUES;
                const pairState = pairNo ? labState.pairs?.[String(pairNo)] : null;
                const offers = pairState?.offers || [];
                const latest = offers[offers.length - 1];
                const canAccept = Boolean(pairState?.status !== 'agreed' && pairState?.status !== 'impasse' && latest && latest.role !== role);
                const isClosed = pairState?.status === 'agreed' || pairState?.status === 'impasse';
                const myBatna = role === 'buyer' ? (labState.buyerBatnaPts || 42) : (labState.supplierBatnaPts || 42);
                const myDraftEval = evaluateIntegrativePackage(issues, studentNegPkg, labState.buyerBatnaPts || 42, labState.supplierBatnaPts || 42);
                const myDraftPts = role === 'buyer' ? myDraftEval.buyerPoints : myDraftEval.supplierPoints;
                const sendNegMove = (action, extra = {}) => {
                  if (!pairNo || !role) {
                    toast('Wait for your lecturer to click "Deal Buyer/Supplier Pairs".', 'error');
                    return;
                  }
                  sendStudentAction('neg_move', {
                    moveId: `${clientIdRef.current}:${Date.now()}:${action}`,
                    pairNo,
                    role,
                    action,
                    ...extra,
                  });
                };
                return (
                  <>
                    <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <div className="tiny muted">MULTI-ISSUE INTEGRATIVE NEGOTIATION</div>
                      <strong className="mono tiny" style={{ color: '#6d28d9' }}>
                        {pairNo ? `PAIR ${pairNo} · ${role === 'buyer' ? 'BUYER DESK' : 'SUPPLIER DESK'}` : 'WAITING FOR PAIR ASSIGNMENT'}
                      </strong>
                    </div>
                    {!pairNo ? (
                      <div className="notice small">Connected! Wait for your lecturer to click <strong>Deal Buyer/Supplier Pairs</strong> to receive your confidential scoring table.</div>
                    ) : (
                      <>
                        <div className="card-soft" style={{ padding: 10, borderLeft: '4px solid #6d28d9' }}>
                          <div className="tiny muted">CONFIDENTIAL POINT SCHEDULE · YOUR BATNA = {myBatna} PTS</div>
                          <div className="small" style={{ marginTop: 2 }}>
                            Trade issues you value less for issues you value more. Current draft package gives you{' '}
                            <strong className="mono" style={{ color: myDraftPts >= myBatna ? 'var(--teal-700)' : 'var(--red)' }}>
                              {myDraftPts} pts
                            </strong>{' '}
                            ({myDraftPts >= myBatna ? `+${myDraftPts - myBatna} above BATNA` : `${myDraftPts - myBatna} below BATNA`}).
                          </div>
                        </div>

                        {latest && (
                          <div className="card-soft small" style={{ padding: 10 }}>
                            <div className="tiny muted">LATEST PACKAGE ON TABLE ({latest.role.toUpperCase()} — {latest.fromName})</div>
                            <div className="row-wrap" style={{ gap: 6, marginTop: 4 }}>
                              {issues.map((iss) => {
                                const opt = iss.options.find((o) => o.id === latest.packageChoices?.[iss.id]);
                                return (
                                  <span key={iss.id} className="tiny mono" style={{ padding: '2px 6px', borderRadius: 5, background: '#fff', border: '1px solid var(--line)' }}>
                                    {iss.name}: {opt?.label || '—'}
                                  </span>
                                );
                              })}
                            </div>
                            <div className="tiny" style={{ marginTop: 6, fontWeight: 700, color: (role === 'buyer' ? latest.buyerPts : latest.supplierPts) >= myBatna ? 'var(--teal-700)' : 'var(--red)' }}>
                              Value to YOU: {role === 'buyer' ? latest.buyerPts : latest.supplierPts} pts (BATNA: {myBatna} pts)
                            </div>
                          </div>
                        )}

                        {isClosed ? (
                          <div className={pairState.status === 'agreed' ? 'notice small' : 'notice-err small'}>
                            {pairState.status === 'agreed' ? (
                              <>
                                <strong>Multi-Issue Deal Agreed!</strong> Your score:{' '}
                                <strong className="mono">{role === 'buyer' ? pairState.buyerPts : pairState.supplierPts} pts</strong>{' '}
                                {labState.revealFrontier && <>· Joint Score: <strong className="mono">{pairState.jointPts} pts</strong></>}
                              </>
                            ) : (
                              <><strong>Impasse — Walked Away to BATNA ({myBatna} pts).</strong></>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="stack-xs">
                              {issues.map((iss) => (
                                <div key={iss.id} className="between" style={{ gap: 8, flexWrap: 'wrap' }}>
                                  <label className="tiny" style={{ fontWeight: 700, minWidth: 130 }}>{iss.name}</label>
                                  <select
                                    className="input"
                                    style={{ flex: 1, minWidth: 190, padding: '6px 8px', fontSize: 12 }}
                                    value={studentNegPkg[iss.id] || ''}
                                    onChange={(e) => setStudentNegPkg((prev) => ({ ...prev, [iss.id]: e.target.value }))}
                                  >
                                    {iss.options.map((o) => {
                                      const myPts = role === 'buyer' ? o.buyerPoints : o.supplierPoints;
                                      return (
                                        <option key={o.id} value={o.id}>
                                          {o.label} (+{myPts} pts to you)
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>
                              ))}
                            </div>
                            <div className="row-wrap" style={{ gap: 8, marginTop: 6 }}>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => {
                                  sendNegMove('offer', { packageChoices: { ...studentNegPkg } });
                                  toast(`Sent 5-issue package offer (Worth ${myDraftPts} pts to you)`);
                                }}
                              >
                                Send Package Offer ({myDraftPts} pts)
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={!canAccept}
                                onClick={() => sendNegMove('accept_latest')}
                              >
                                Accept Latest Offer
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{ color: 'var(--red)' }}
                                onClick={() => sendNegMove('walk_away')}
                              >
                                Walk Away (BATNA)
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
