// ==========================================
// 주문 → 원부자재 소요 계산 (주문관리 · 생산요청서)
// ==========================================
// 생산요청서(주문) 품목 × 제품 BOM(wms_product_boms: rawList 원액·원료, subList 부자재) = 필요량.
// 재고는 거점(본사·김포) 수불부 기준(plans.ledgerStock — 원료·원액 L은 원료수불부, 부자재는 자재수불부, 없으면 창고 재고).
// **납기 순으로 재고를 배정**해 주문마다 판정한다: 재고로 됨(READY) → 구매·원액 생산 계획까지 치면 됨(WAIT) → 모자람(SHORT) · BOM 없음(NO_BOM).
//   공급 계획 = 주간 구매계획 줄(입고완료·보류 제외) + 원액 생산 계획(주간 생산계획의 원액 줄 중 요청서에서 온 것 제외 + 진행 중 원액생산요청서).
// 원액생산요청서의 원료 소요는 보안(원액 작업지시서)이라 계산하지 않고, 그 원액 수량을 공급으로만 센다.
// 생산이 끝난 주문(스케줄 완료·출고, 요청서 완료)은 뺀다.
import { state } from './db.js';
import { loadBoms, getBoms, listPlans, ledgerStock, weekStart, addDays, round3 } from './plans.js';
import { localDateStr } from './searchUtils.js';

const masterOf = (code) => state.master.find(m => m.code === code);
export const ORDER_MAT_STATUS = {
    READY: { label: '자재 준비됨', cls: 'bg-emerald-100 text-emerald-700' },
    WAIT: { label: '입고·생산 대기', cls: 'bg-amber-100 text-amber-800' },
    SHORT: { label: '자재 부족', cls: 'bg-rose-600 text-white' },
    NO_BOM: { label: 'BOM 없음', cls: 'bg-slate-200 text-slate-600' },
    DONE: { label: '생산 완료', cls: 'bg-slate-100 text-slate-400' },
    RAW: { label: '원액 요청', cls: 'bg-cyan-50 text-cyan-700' }
};

/** 앞으로의 구매·원액 생산 계획 줄 */
export const loadSupplyPlans = async () => {
    const from = weekStart(addDays(localDateStr(), -7));
    const [purch, prod] = await Promise.all([listPlans('PURCH_WEEK', from, '9999').catch(() => []), listPlans('PROD_WEEK', from, '9999').catch(() => [])]);
    const purchLines = purch.flatMap(d => (d.lines || []).filter(l => l.code && l.status !== 'HOLD' && l.status !== 'RECEIVED').map(l => ({ ...l, week: d.period })));
    const rawLines = prod.flatMap(d => (d.lines || []).filter(l => l.code && l.type === '원액' && l.status !== 'HOLD' && l.status !== 'DONE' && !String(l.ref || '').startsWith('REQ:')));
    return { purchLines, rawLines };
};

/** 한 주문(요청서)의 품목별 필요 원부자재 [{ code, qty, from }] 과 BOM 없는 품목 */
export const orderNeeds = (r, boms = getBoms()) => {
    const needs = [], missing = [];
    (r.lines || []).filter(l => (l.code || l.name) && Number(l.qty) > 0).forEach(l => {
        const b = l.code ? boms[l.code] : null;
        const list = [...(b?.rawList || []), ...(b?.subList || [])].filter(x => x.code && Number(x.rate) > 0);
        if (!list.length) { missing.push(l); return; }
        list.forEach(x => needs.push({ code: x.code, qty: round3(Number(x.rate) * Number(l.qty)), from: `${l.name || l.code} ${Number(l.qty).toLocaleString('ko-KR')}${l.unit || ''}` }));
    });
    return { needs, missing };
};

/**
 * 진행 중 주문 전체 계산
 * @param orders services/orders.js buildOrder 결과 (진행 중인 것만 넘겨도 되고 전부 넘겨도 됨)
 * @param supply loadSupplyPlans() 결과
 * @returns { orders: Map(id → { status, lines: [...] , shortCount }), materials: [...], missingBom: [...] }
 */
export const computeOrderMaterials = (orders, supply = { purchLines: [], rawLines: [] }) => {
    const boms = getBoms();
    const siteOf = (o) => (o.r.site === '김포' ? '김포' : '본사');
    const pools = new Map(); // code|site → { stock, buy, prod }
    const pool = (code, site) => {
        const k = `${code}|${site}`;
        if (!pools.has(k)) {
            const buy = supply.purchLines.filter(l => l.code === code && (l.site || '김포') === site).reduce((s, l) => s + (Number(l.qty) || 0), 0);
            const prod = supply.rawLines.filter(l => l.code === code && (l.site || '본사') === site).reduce((s, l) => s + (Number(l.qty) || 0), 0);
            pools.set(k, { stock: Math.max(0, ledgerStock(code, site).qty), buy: round3(buy), prod: round3(prod), stock0: ledgerStock(code, site).qty, buy0: round3(buy), prod0: round3(prod) });
        }
        return pools.get(k);
    };
    const active = orders.filter(o => o.state === 'OPEN');
    // 진행 중 원액생산요청서 = 그 원액의 공급 예정
    active.filter(o => o.raw && !o.produced).forEach(o => o.lines.forEach(l => { if (l.code) { const p = pool(l.code, siteOf(o)); p.prod = round3(p.prod + (Number(l.qty) || 0)); p.prod0 = p.prod; } }));
    const result = new Map();
    const mats = new Map(); // code|site → 합계
    const missingBom = [];
    const byDue = [...active].filter(o => !o.raw).sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.r.reqDate).localeCompare(String(b.r.reqDate)));
    for (const o of byDue) {
        if (o.produced) { result.set(o.id, { status: 'DONE', lines: [], shortCount: 0 }); continue; }
        const { needs, missing } = orderNeeds(o.r, boms);
        missing.forEach(l => missingBom.push({ order: o, line: l }));
        const site = siteOf(o);
        // 같은 원부자재는 합쳐서 배정
        const agg = new Map();
        needs.forEach(n => { const a = agg.get(n.code) || { code: n.code, qty: 0, from: [] }; a.qty = round3(a.qty + n.qty); a.from.push(n.from); agg.set(n.code, a); });
        const lines = [...agg.values()].map(n => {
            const p = pool(n.code, site);
            let left = n.qty;
            const fromStock = Math.min(left, p.stock); p.stock = round3(p.stock - fromStock); left = round3(left - fromStock);
            const fromBuy = Math.min(left, p.buy); p.buy = round3(p.buy - fromBuy); left = round3(left - fromBuy);
            const fromProd = Math.min(left, p.prod); p.prod = round3(p.prod - fromProd); left = round3(left - fromProd);
            const m = masterOf(n.code) || {};
            const t = mats.get(`${n.code}|${site}`) || { code: n.code, site, name: m.name || n.code, category: m.category || '', unit: m.unit || '', supplier: m.supplier && m.supplier !== '-' ? m.supplier : '', need: 0, short: 0, orders: [], firstDue: '' };
            t.need = round3(t.need + n.qty); t.short = round3(t.short + left);
            t.orders.push(o.docNo);
            if (o.due && (!t.firstDue || o.due < t.firstDue)) t.firstDue = o.due;
            mats.set(`${n.code}|${site}`, t);
            return { code: n.code, name: m.name || n.code, category: m.category || '', unit: m.unit || '', need: n.qty, fromStock: round3(fromStock), fromBuy: round3(fromBuy), fromProd: round3(fromProd), short: left, from: n.from };
        });
        const shortCount = lines.filter(l => l.short > 0).length;
        const status = !lines.length ? 'NO_BOM' : shortCount ? 'SHORT' : lines.some(l => l.fromBuy > 0 || l.fromProd > 0) ? 'WAIT' : missing.length ? 'NO_BOM' : 'READY';
        result.set(o.id, { status, lines, shortCount, missing: missing.length, site });
    }
    active.filter(o => o.raw).forEach(o => result.set(o.id, { status: o.produced ? 'DONE' : 'RAW', lines: [], shortCount: 0 }));
    const materials = [...mats.values()].map(t => {
        const p = pools.get(`${t.code}|${t.site}`);
        return { ...t, stock: round3(p.stock0), buy: p.buy0, prod: p.prod0, target: t.category === '원액' ? 'RAW' : 'PURCH' };
    }).sort((a, b) => (b.short > 0) - (a.short > 0) || String(a.firstDue || '9999').localeCompare(String(b.firstDue || '9999')) || a.name.localeCompare(b.name, 'ko'));
    return { orders: result, materials, missingBom };
};

/** 부족분 → 요청서 초안 (원료·부자재 → 구매요청서, 원액 → 원액생산요청서). window.__reqDraft를 넣고 탭 이름을 돌려준다 */
export const draftForShortages = (materials, target, site) => {
    const list = materials.filter(m => m.short > 0 && m.target === target && (!site || m.site === site));
    if (!list.length) return null;
    const today = localDateStr();
    const due = list.map(m => m.firstDue).filter(Boolean).sort()[0] || addDays(today, 7);
    const raw = target === 'RAW';
    const s = site || list[0].site;
    window.__reqDraft = {
        type: raw ? 'RAW' : 'PURCH',
        source: { kind: 'orderMaterials' },
        draft: {
            reqDate: today, dueDate: due < today ? today : addDays(due, raw ? -2 : -3) < today ? today : addDays(due, raw ? -2 : -3), site: s,
            partner: raw ? '' : '주문 생산 원부자재', reason: `진행 중 주문의 원부자재 부족분 (${list.length}품목, 관련 주문 ${[...new Set(list.flatMap(m => m.orders))].join(', ')}). 주문관리 소요 계산 기준 — 수량·날짜를 확인하세요.`,
            sourceKey: `ORDMAT:${today}:${target}:${s}:${list.map(m => m.code).sort().join(',').slice(0, 180)}`,
            sourceText: list.map(m => `${m.name} (${m.code}) 필요 ${m.need} / 재고 ${m.stock} / 계획 ${round3(m.buy + m.prod)} → 부족 ${m.short} ${m.unit} · ${m.orders.join(', ')}`).join('\n'),
            lines: list.map(m => ({ code: m.code, name: m.name, qty: /^(EA|BOX|SET|ROLL|PAIL|DRUM|개)$/i.test(m.unit || '') ? Math.ceil(m.short) : Math.ceil(m.short * 1000) / 1000, unit: m.unit || (raw ? 'L' : 'EA'), supplier: raw ? '' : m.supplier, note: `주문 ${m.orders.slice(0, 3).join(', ')}${m.orders.length > 3 ? ' 외' : ''}` }))
        }
    };
    return raw ? 'prodRequest' : 'purchRequest';
};

export { loadBoms };
