// ==========================================
// 주문관리: 생산요청서(주문) 한 건을 출하까지 따라가는 진행 단계 + 기간별(주·월·분기·반기·년) 집계
// ==========================================
// 주문 = 생산요청서(wms_plans PROD_REQ). 단계는 따로 저장하지 않고 다른 기록에서 읽는다:
//   요청 → 접수(status) → 계획반영(planWeek) → 스케줄(최신 작성일자 생산(포장) 스케줄의 req_ref 'REQ:<id>:' 줄)
//   → 생산(스케줄 줄 생산중·완료·출고, 또는 요청서 완료) → 출하요청(출고요청서 RQ 전표) → 출하완료(전표 출고 완료 shippedAt).
// 출하요청서(RQ)와 주문의 연결: 요청서 data.shipNos(주문관리에서 작성·연결) 또는 전표 사유(reason)에 요청서 번호(PR-/BR-…)가 있으면.
// 원액생산요청서는 포장 스케줄·출하가 없으므로 생산(완료)까지가 끝이다(연결 전표가 있으면 출하까지).
import { listPlans, reqTypeOf, savePlan, weekStart, addDays } from './plans.js';
import { listSlipsRange } from './db.js';
import { listProdDates, listProdSchedule } from './prodSchedule.js';
import { localDateStr } from './searchUtils.js';

export const isShipSlip = (s) => s.type === 'RELEASE' || (!s.type && String(s.docNo || '').startsWith('RQ-'));
const DOCNO_RE = /\b(?:PR|BR)-\d{8}-\d{3}\b/g;
export const docNosInText = (t) => String(t || '').match(DOCNO_RE) || [];
const isoDay = (iso) => {
    if (!iso) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const maxOf = (arr) => arr.filter(Boolean).sort().pop() || '';
const minOf = (arr) => arr.filter(Boolean).sort()[0] || '';
const dayDiff = (from, to) => Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000);
const addQty = (map, unit, q) => { const u = String(unit || 'EA').toUpperCase(); map[u] = (map[u] || 0) + (Number(q) || 0); return map; };
export const qtyMapText = (m) => Object.entries(m || {}).filter(([, q]) => q).map(([u, q]) => `${q.toLocaleString('ko-KR', { maximumFractionDigits: 3 })} ${u}`).join(' · ') || '-';

/** 전표가 이 요청서에 연결됐는지 */
export const slipLinked = (r, s) => (r.shipNos || []).includes(s.docNo) || docNosInText(s.reason).includes(r.docNo);

/** 요청서 하나 → 주문 진행 정보 */
export const buildOrder = (r, rows = [], slips = [], today = localDateStr()) => {
    const raw = reqTypeOf(r) === 'RAW';
    const lines = (r.lines || []).filter(l => l.code || l.name);
    const unitOf = (l) => l.unit || (raw ? 'L' : 'EA');
    const sched = rows.filter(x => String(x.reqRef || '').startsWith(`REQ:${r.id}:`));
    const linked = slips.filter(s => slipLinked(r, s)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const codes = new Set(lines.map(l => l.code).filter(Boolean));
    const reqQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    const reqQtyMap = lines.reduce((m, l) => addQty(m, unitOf(l), l.qty), {});
    const slipQty = (s) => (s.items || []).filter(it => !codes.size || codes.has(it.code)).reduce((n, it) => n + (Number(it.qty) || 0), 0);
    const shipReqQty = linked.reduce((n, s) => n + slipQty(s), 0);
    const shippedQty = linked.filter(s => s.shippedAt).reduce((n, s) => n + slipQty(s), 0);
    const rejected = r.status === 'REJECTED';
    const rowsDone = sched.length > 0 && sched.every(x => ['DONE', 'SHIPPED'].includes(x.status));
    const rowsShipped = sched.length > 0 && sched.every(x => x.status === 'SHIPPED');
    const producing = sched.some(x => ['PRODUCING', 'DONE', 'SHIPPED'].includes(x.status));
    const slipsAllShipped = linked.length > 0 && linked.every(s => s.shippedAt) && (reqQty <= 0 || shippedQty >= reqQty - 1e-6);
    const shipped = r.status === 'DONE' || rowsShipped || slipsAllShipped;
    const produced = shipped || rowsDone;
    const updated = isoDay(r.updatedAt);
    const shippedAt = shipped ? (maxOf(linked.map(s => isoDay(s.shippedAt))) || maxOf(sched.map(x => x.shipDate)) || updated) : '';
    const producedAt = produced ? (maxOf(sched.map(x => x.prodEnd)) || (rowsDone ? maxOf(sched.map(x => isoDay(x.updatedAt))) : '') || shippedAt || updated) : '';
    const shipNa = raw && !linked.length;
    const steps = [
        { k: 'REQ', label: '요청', done: true, date: r.reqDate || r.period },
        { k: 'ACC', label: '접수', done: ['ACCEPTED', 'PLANNED', 'DONE'].includes(r.status) || !!r.planWeek },
        { k: 'PLAN', label: '계획반영', done: !!r.planWeek || r.status === 'DONE', date: r.planWeek ? `${r.planWeek.slice(5).replace('-', '/')}주` : '' },
        { k: 'SCHED', label: '스케줄', na: raw, done: sched.length > 0 || produced, date: minOf(sched.map(x => x.planDate)) || r.planDate || '' },
        { k: 'PROD', label: '생산', done: produced, partial: !produced && producing, date: producedAt || minOf(sched.map(x => x.prodStart)) },
        { k: 'SREQ', label: '출하요청', na: shipNa, done: linked.length > 0 || (shipped && !raw), date: minOf(linked.map(s => s.date)) },
        { k: 'SHIP', label: '출하완료', na: shipNa, done: shipped, partial: !shipped && shippedQty > 0, date: shippedAt }
    ];
    const complete = !rejected && (shipNa ? produced : shipped);
    const completedAt = complete ? (shipNa ? producedAt : shippedAt) : '';
    const next = steps.find(s => !s.na && !s.done);
    const due = r.dueDate || '';
    return {
        r, id: r.id, docNo: r.docNo, raw, lines, unitOf, sched, slips: linked, reqQty, reqQtyMap, shipReqQty, shippedQty,
        steps, produced, producedAt, shipped, shippedAt, rejected, complete, completedAt,
        state: rejected ? 'REJECTED' : complete ? 'DONE' : 'OPEN',
        stage: rejected ? '반려' : complete ? '완료' : !next ? '진행' : next.k === 'PROD' ? (next.partial ? '생산중' : '생산 대기') : next.k === 'SHIP' ? (next.partial ? '일부 출하' : '출하 대기') : `${next.label} 대기`,
        due, daysLeft: due ? dayDiff(today, due) : null, overdue: !complete && !rejected && !!due && due < today,
        onTime: complete && due ? completedAt <= due : null,
        needsReflect: !rejected && r.status !== 'DONE' && !(r.planWeek && !r.autoPlan) && (!r.planWeek || !r.schedSynced)
    };
};

/** 주문·출하요청서 불러오기 (from ~ to: 요청일 기준, 출하요청서는 from 이후 발행분) */
export const loadOrderData = async ({ from, to = '9999-12-31' }) => {
    const [reqs, slips, dates] = await Promise.all([
        listPlans('PROD_REQ', from, to),
        listSlipsRange({ from }),
        listProdDates().catch(() => [])
    ]);
    const sheetDate = dates[0]?.date || '';
    const rows = sheetDate ? await listProdSchedule(sheetDate).catch(() => []) : [];
    const ship = slips.filter(isShipSlip);
    const today = localDateStr();
    const orders = reqs.filter(r => r.docNo).map(r => buildOrder(r, rows, ship, today));
    return { orders, slips: ship, sheetDate };
};

/** 출하요청서를 주문에 잇기/끊기 (요청서 data.shipNos) */
export const linkSlipToOrder = async (r, docNo, link = true) => {
    const set = new Set(r.shipNos || []);
    if (link) set.add(docNo); else set.delete(docNo);
    return savePlan({ ...r, shipNos: [...set] });
};

// ---------- 기간별 집계 ----------
export const PERIOD_UNITS = { week: '주간', month: '월간', quarter: '분기', half: '반기', year: '년간' };
export const periodOf = (date, unit) => {
    const d = String(date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    const y = d.slice(0, 4), m = Number(d.slice(5, 7));
    if (unit === 'week') { const w = weekStart(d); return { key: w, label: `${w.slice(2, 4)}.${w.slice(5, 7)}.${w.slice(8)} 주 (~${addDays(w, 6).slice(5).replace('-', '/')})` }; }
    if (unit === 'month') return { key: d.slice(0, 7), label: `${y}년 ${m}월` };
    if (unit === 'quarter') { const q = Math.ceil(m / 3); return { key: `${y}-Q${q}`, label: `${y}년 ${q}분기` }; }
    if (unit === 'half') { const h = m <= 6 ? 1 : 2; return { key: `${y}-H${h}`, label: `${y}년 ${h === 1 ? '상반기' : '하반기'}` }; }
    return { key: y, label: `${y}년` };
};
/** from~to 사이 기간 목록 (빈 기간도 표에 나오게) */
export const periodsBetween = (from, to, unit) => {
    const out = [];
    const seen = new Set();
    for (let d = from; d <= to; d = addDays(d, unit === 'week' ? 7 : unit === 'year' ? 180 : 14)) {
        const p = periodOf(d, unit); if (p && !seen.has(p.key)) { seen.add(p.key); out.push(p); }
    }
    const last = periodOf(to, unit); if (last && !seen.has(last.key)) out.push(last);
    return out;
};

/**
 * 주문·출하요청서 → 기간별 행 (from~to 안의 사건만 센다)
 * 요청(요청일) · 반려 · 생산완료(생산 완료일) · 완료(출하완료일, 납기 준수) · 출하요청(전표 발행일) · 출하완료(출고 완료일, 수량)
 */
export const aggregateOrders = (orders, slips, unit, from, to) => {
    const periods = periodsBetween(from, to, unit);
    const map = new Map(periods.map(p => [p.key, { ...p, req: 0, reqQty: {}, rejected: 0, produced: 0, done: 0, onTime: 0, late: 0, shipReq: 0, shipped: 0, shippedQty: {} }]));
    const inRange = (d) => d && d >= from && d <= to;
    const at = (d) => (inRange(d) ? map.get(periodOf(d, unit)?.key) : null);
    orders.forEach(o => {
        const b = at(o.r.reqDate || o.r.period);
        if (b) { b.req += 1; o.lines.forEach(l => addQty(b.reqQty, o.unitOf(l), l.qty)); if (o.rejected) b.rejected += 1; }
        const p = o.produced && at(o.producedAt); if (p) p.produced += 1;
        const c = o.complete && at(o.completedAt);
        if (c) { c.done += 1; if (o.onTime === true) c.onTime += 1; else if (o.onTime === false) c.late += 1; }
    });
    slips.forEach(s => {
        const b = at(s.date); if (b) b.shipReq += 1;
        const d = s.shippedAt && at(isoDay(s.shippedAt));
        if (d) { d.shipped += 1; (s.items || []).forEach(it => addQty(d.shippedQty, it.unit, it.qty)); }
    });
    // 누계 (기간 순서대로 쌓기)
    let cReq = 0, cDone = 0, cShip = 0;
    return [...map.values()].map(b => { cReq += b.req; cDone += b.done; cShip += b.shipped; return { ...b, cumReq: cReq, cumDone: cDone, cumShipped: cShip }; });
};
