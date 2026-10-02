// ==========================================
// 거래처별 실적 현황 (현황·보고 › 거래처별 실적, components/PartnerBoard.js)
// ==========================================
// 거래처 이름이 적힌 기록을 거래처별로 모은다:
//   · 주문 = 제품생산요청서(partner) — services/orders.js buildOrder (완료·납기 준수·진행 중·납기 지남)
//   · 출하 = 출고요청서(RQ, partner) — 발행 건수·출고 완료·수량
//   · 생산(포장) 스케줄 = 최신 작성일자의 진행 중 줄(partner)
//   · 품질 = 제품 출하검사(INSPECT, area PRODUCT, partner) 불량률·불합격 + 제품 부적합(NCR area PRODUCT, place = 거래처)
// 거래처 이름 맞추기: 공백·대소문자 무시. '묶어 보기'를 켜면 괄호·대괄호 안(예: 'SM벡셀 [국군복지단]', '영남(세양상사)')을 떼고 본 거래처로 합친다.
import { loadOrderData } from './orders.js';
import { listProdDates, listProdSchedule } from './prodSchedule.js';
import { listQc, defectQtyOf, rateOf } from './quality.js';
import { localDateStr } from './searchUtils.js';

const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return localDateStr(x); };
export const partnerKey = (name, merge = false) => {
    let s = String(name || '').trim();
    if (merge) s = s.replace(/\s*[[(（【].*?[\])）】]\s*/g, ' ').trim();
    return s.replace(/\s+/g, '').toLowerCase();
};
const isoDay = (v) => (v ? (/^\d{4}-\d{2}-\d{2}/.test(v) ? String(v).slice(0, 10) : localDateStr(new Date(v))) : '');

/** 기간 자료 한 번에 받기 (주문은 기간 시작 1년 전부터 — 기간 안에 완료·출하된 예전 주문도 세려고) */
export const loadPartnerData = async ({ from, to }) => {
    const [od, dates, inspect, ncr] = await Promise.all([
        loadOrderData({ from: addDays(from, -365), to }),
        listProdDates().catch(() => []),
        listQc('INSPECT').catch(() => []),
        listQc('NCR').catch(() => [])
    ]);
    const sheetDate = dates[0]?.date || '';
    const sched = sheetDate ? await listProdSchedule(sheetDate).catch(() => []) : [];
    return { orders: od.orders.filter(o => !o.raw), slips: od.slips, sched, sheetDate, inspect: inspect.filter(r => r.area === 'PRODUCT'), ncr: ncr.filter(r => r.area === 'PRODUCT') };
};

/**
 * @returns { rows: [...거래처], totals }
 * 행: { key, name, aliases[], orders, orderQty, reqIn(기간 요청), done, onTime, late, open, overdue, slips, shipped, shipQty, schedRows, schedQty, inspected, defect, rate, fail, ncr, lastOrder, items: [{name, qty}], months: {ym: {orders, ship}} , list: {orders[], slips[], quality[]} }
 */
export const computePartnerStats = (data, { from, to, merge = false }) => {
    const map = new Map();
    const inRange = (d) => d && d >= from && d <= to;
    const get = (name) => {
        const raw = String(name || '').trim();
        if (!raw || raw === '외부 거래처') return null;
        const k = partnerKey(raw, merge);
        if (!k) return null;
        if (!map.has(k)) map.set(k, { key: k, name: merge ? raw.replace(/\s*[[(（【].*?[\])）】]\s*/g, ' ').trim() : raw, aliases: new Set(), orders: 0, orderQty: 0, done: 0, onTime: 0, late: 0, open: 0, overdue: 0,
            slips: 0, shipped: 0, shipQty: 0, schedRows: 0, schedQty: 0, inspected: 0, defect: 0, inspCount: 0, fail: 0, ncr: 0, lastOrder: '', items: new Map(), months: {}, list: { orders: [], slips: [], quality: [] } });
        const p = map.get(k);
        p.aliases.add(raw);
        return p;
    };
    const month = (p, d) => { const m = String(d).slice(0, 7); p.months[m] = p.months[m] || { orders: 0, ship: 0, shipQty: 0 }; return p.months[m]; };
    data.orders.forEach(o => {
        const p = get(o.r.partner);
        if (!p) return;
        const reqDate = o.r.reqDate || o.r.period;
        if (inRange(reqDate)) {
            p.orders += 1; p.orderQty += o.reqQty || 0; month(p, reqDate).orders += 1;
            o.lines.forEach(l => { const k = l.name || l.code; p.items.set(k, (p.items.get(k) || 0) + (Number(l.qty) || 0)); });
            if (!p.lastOrder || reqDate > p.lastOrder) p.lastOrder = reqDate;
            p.list.orders.push(o);
        }
        if (o.complete && inRange(o.completedAt)) { p.done += 1; if (o.onTime === true) p.onTime += 1; else if (o.onTime === false) p.late += 1; if (!p.list.orders.includes(o)) p.list.orders.push(o); }
        if (o.state === 'OPEN') { p.open += 1; if (o.overdue) p.overdue += 1; if (!p.list.orders.includes(o)) p.list.orders.push(o); }
    });
    data.slips.forEach(s => {
        const p = get(s.partner);
        if (!p) return;
        const qty = (s.items || []).reduce((n, it) => n + (Number(it.qty) || 0), 0);
        if (inRange(s.date)) { p.slips += 1; p.list.slips.push(s); }
        const sd = isoDay(s.shippedAt);
        if (s.shippedAt && inRange(sd)) { p.shipped += 1; p.shipQty += qty; const m = month(p, sd); m.ship += 1; m.shipQty += qty; if (!p.list.slips.includes(s)) p.list.slips.push(s); }
    });
    data.sched.filter(r => !['DONE', 'SHIPPED'].includes(r.status)).forEach(r => { const p = get(r.partner); if (p) { p.schedRows += 1; p.schedQty += Number(r.qty) || 0; } });
    data.inspect.filter(r => inRange(r.date)).forEach(r => {
        const p = get(r.partner);
        if (!p) return;
        p.inspCount += 1; p.inspected += Number(r.inspectedQty) || 0; p.defect += defectQtyOf(r); if (r.result === 'FAIL') p.fail += 1;
        p.list.quality.push({ date: r.date, kind: '출하검사', name: r.itemName, result: { PASS: '합격', COND: '조건부', FAIL: '불합격' }[r.result] || '', defect: defectQtyOf(r) });
    });
    data.ncr.filter(r => inRange(r.date)).forEach(r => {
        const p = get(r.place || r.partner);
        if (!p) return;
        p.ncr += 1;
        p.list.quality.push({ date: r.date, kind: '부적합', name: r.itemName, result: { OPEN: '발생', ACTION: '조치 중', CLOSED: '완료' }[r.status] || '', defect: Number(r.qty) || 0 });
    });
    const rows = [...map.values()].map(p => ({
        ...p, aliases: [...p.aliases], rate: rateOf(p.defect, p.inspected), onTimeRate: p.onTime + p.late ? (p.onTime / (p.onTime + p.late)) * 100 : null,
        items: [...p.items.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty)
    })).filter(p => p.orders || p.done || p.open || p.slips || p.shipped || p.schedRows || p.inspCount || p.ncr);
    const t = rows.reduce((a, p) => ({ orders: a.orders + p.orders, done: a.done + p.done, onTime: a.onTime + p.onTime, late: a.late + p.late, shipped: a.shipped + p.shipped, shipQty: a.shipQty + p.shipQty, inspected: a.inspected + p.inspected, defect: a.defect + p.defect, overdue: a.overdue + p.overdue }),
        { orders: 0, done: 0, onTime: 0, late: 0, shipped: 0, shipQty: 0, inspected: 0, defect: 0, overdue: 0 });
    return { rows, totals: { ...t, partners: rows.length, onTimeRate: t.onTime + t.late ? (t.onTime / (t.onTime + t.late)) * 100 : null, rate: rateOf(t.defect, t.inspected) } };
};
