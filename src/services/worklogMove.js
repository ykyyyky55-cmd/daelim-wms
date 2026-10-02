// ==========================================
// 업무일지 줄을 다른 거점 일지로 옮기기 (본사 ⇄ 김포) — 거점을 잘못 골라 적은 일지 바로잡기
// ==========================================
// · 같은 날짜의 상대 거점 일지 끝에 줄을 붙이고 원래 일지에서는 뺀다 (components/worklog/moveSiteDialog.js가 줄을 고르게 한다).
// · 재고: 그 줄이 원래 거점 재고에 이미 반영됐으면(수불부 반영된 일지 + 그 줄의 입출고 이력) 재고를 상대 거점으로 맞춘다
//   — 원래 거점에서 일어난 증감을 되돌리고 상대 거점 기준 증감을 넣은 '차이'만큼 이동(MOVE)·입고·출고로 기록한다.
//   옮긴 줄에는 stockDone을 달아, 받은 일지를 나중에 수불부 반영해도 다시 들어가지 않는다.
//   아직 반영 전인 줄은 그대로 옮기고(받은 일지에서 수불부 반영 때 들어간다), 받은 일지가 이미 반영된 일지면 그 줄만 바로 반영한다.
// · 줄 하나의 재고 증감은 applyGimpoLogToInventory와 같은 규칙으로 계산한다(effectsOf) — 그쪽 규칙을 바꾸면 여기도 맞춘다.
//   앱에서 이미 재고 처리된 줄(stockDone — 생산입고·앱 입출고)과 원액 줄의 공토트·IBC 대장은 건드리지 않는다.
import {
    state, WORKLOG_SITES, BANGSAN_LOC, getGimpoLogByDate, saveGimpoLog, checkGimpoLogSyncStatus,
    processStockAction, allocateMaterialStock, findMasterItem, strictMasterMatch, parseMoveRoute
} from './db.js';
import { buildingOf } from './locations.js';

/** 옮길 수 있는 항목과 이름 (일지에 나오는 순서) */
export const MOVE_SECTIONS = [
    ['packaging', '제품포장작업'], ['oilBlending', '원액생산작업'], ['labeling', '라벨부착작업'], ['movement', '이동제품'],
    ['receiving', '입고내역'], ['shipping', '출고내역'], ['purchaseOrders', '구매발주내역'], ['courier', '택배출고'],
    ['otherNotes', '특이사항'], ['otherTasks', '기타업무']
];
const TITLE = Object.fromEntries(MOVE_SECTIONS);
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;
const hasLog = (date, site) => (state[WORKLOG_SITES[site].stateKey] || []).some(l => l.date === date);

/** 이미 제품생산/입고로 들어간 LOT (수불부 반영 때 건너뛰는 줄 — applyGimpoLogToInventory와 같은 기준) */
const inboundLots = () => new Set([
    ...(state.productions || []).map(p => String(p.lotNo || '').trim()),
    ...(state.history || []).map(h => /생산 입고 \[([^\]]+)\]/.exec(h.reason || '')?.[1]?.trim())
].filter(Boolean));

/**
 * 줄 하나가 그 거점 일지에서 수불부 반영될 때의 재고 증감.
 * @returns {{ deltas: { code: string, name: string, loc: string, delta: number }[], why: string }} why = 재고 증감이 없는 까닭
 */
const effectsOf = (site, listKey, row, lots) => {
    const none = (why) => ({ deltas: [], why });
    if (!row || typeof row !== 'object') return none('');
    const s = WORKLOG_SITES[site];
    const qty = Number(row.qty) || 0;
    if (!['packaging', 'oilBlending', 'movement', 'receiving', 'shipping'].includes(listKey)) return none('');
    if (qty <= 0) return none('');
    // siteFixed = 이 기능으로 옮기면서 재고를 맞춘 줄 — 다시 옮기면(되돌리기) 재고도 다시 옮긴다
    if (row.stockDone && !row.siteFixed) return none('앱에서 이미 재고 처리된 줄 — 재고는 그대로');
    const workLoc = site === 'HQ' && /방산/.test(String(row.line || '')) ? BANGSAN_LOC : s.location;
    const one = (m, loc, sign) => (m ? { deltas: [{ code: m.code, name: m.name, loc, delta: sign * qty }], why: '' } : none('품목 마스터에서 찾지 못함'));
    if (listKey === 'packaging' || listKey === 'oilBlending') {
        if (String(row.lotNo || '').trim() && lots.has(String(row.lotNo).trim())) return none('생산입고로 이미 들어간 LOT — 재고는 그대로');
        return one(listKey === 'packaging' ? findMasterItem(row.item, row.spec, row.category || '완제품') : findMasterItem(row.item, row.spec || 'L', '원액'), workLoc, 1);
    }
    if (listKey === 'receiving') return one(findMasterItem(row.item, row.spec, '부자재'), s.location, 1);
    if (listKey === 'shipping') return one(findMasterItem(row.item, row.spec, '완제품'), s.location, -1);
    // 이동제품: 본사 일지는 경로(출발>도착)를 읽고, 김포 일지는 김포에서 상대 거점으로 보낸 것으로 본다
    const pair = (m, from, to) => ({ deltas: [...(from ? [{ code: m.code, name: m.name, loc: from, delta: -qty }] : []), ...(to ? [{ code: m.code, name: m.name, loc: to, delta: qty }] : [])], why: '' });
    if (site === 'HQ') {
        if (row.ledgerSkip) return none('수불부 건너뜀 표시가 있는 이동');
        const r = parseMoveRoute(row.route);
        const m = strictMasterMatch(row.item);
        if (!r || !m || (!r.from && !r.to) || r.from === r.to) return none(!m ? '품목 마스터에서 찾지 못함' : '경로를 읽을 수 없음');
        return pair(m, r.from, r.to);
    }
    const m = findMasterItem(row.item, row.spec, '');
    return m ? pair(m, s.location, s.moveTo(row.route || '')) : none('품목 마스터에서 찾지 못함');
};

/** 그 줄이 원래 거점 재고에 반영됐는지: 반영된 일지이고, 그 일지 머리말의 이력에 같은 품목·수량이 있다 (머리말 이력이 하나도 안 보이면 반영된 것으로 본다) */
const wasApplied = (site, date, isSynced, deltas, qty) => {
    if (!isSynced || !deltas.length) return false;
    const tag = `[${date} ${WORKLOG_SITES[site].tag}]`;
    const tagged = (state.history || []).filter(h => String(h.reason || '').includes(tag));
    if (!tagged.length) return true;
    return tagged.some(h => h.code === deltas[0].code && Math.abs(Number(h.qty) - qty) < 1e-6);
};

/** 증감 목록을 품목·위치별로 합쳐 0이 아닌 것만 */
const netOf = (deltas) => {
    const map = new Map();
    deltas.forEach(d => {
        const key = `${d.code}|${d.loc}`;
        map.set(key, { ...d, delta: round3((map.get(key)?.delta || 0) + d.delta) });
    });
    return [...map.values()].filter(d => Math.abs(d.delta) > 1e-9);
};

/**
 * 줄 하나를 옮길 때의 재고 처리 계획
 * @returns {{ mode: 'FIX'|'APPLY'|'LATER'|'NONE', net: object[], text: string }}
 *   FIX = 원래 거점에 반영된 재고를 상대 거점으로 맞춤 · APPLY = 받은 일지가 이미 반영돼 그 줄만 바로 반영 ·
 *   LATER = 받은 일지를 수불부 반영할 때 들어감 · NONE = 재고 증감 없음
 */
const planRow = ({ date, fromSite, toSite, listKey, row, srcSynced, dstSynced, lots }) => {
    const a = effectsOf(fromSite, listKey, row, lots), b = effectsOf(toSite, listKey, row, lots);
    const show = (net) => net.map(d => `${d.loc} ${d.delta > 0 ? '+' : '−'}${fmt(Math.abs(d.delta))}`).join(' · ');
    if ((row?.siteFixed && a.deltas.length) || wasApplied(fromSite, date, srcSynced, a.deltas, Number(row?.qty) || 0)) {
        const net = netOf([...a.deltas.map(d => ({ ...d, delta: -d.delta })), ...b.deltas]);
        return { mode: 'FIX', net, text: net.length ? `재고 반영됨 → ${show(net)}` : '재고 반영됨 → 바뀌는 재고 없음' };
    }
    if (!b.deltas.length) return { mode: 'NONE', net: [], text: b.why || a.why || '' };
    if (dstSynced) return { mode: 'APPLY', net: netOf(b.deltas), text: `${WORKLOG_SITES[toSite].name} 일지가 이미 반영돼 바로 반영 → ${show(netOf(b.deltas))}` };
    return { mode: 'LATER', net: [], text: `재고 미반영 — ${WORKLOG_SITES[toSite].name} 일지에서 수불부 반영 때 들어감` };
};

const rowLabel = (listKey, row) => (typeof row === 'string' ? row
    : [row.item || row.task || row.name || row.product || row.partner || '(이름 없음)', row.spec, row.lotNo ? `LOT ${row.lotNo}` : '', row.route].filter(Boolean).join(' · '));

/**
 * 옮기기 미리보기: 그 날짜 일지의 줄마다 이름·수량·재고 처리
 * @returns {{ srcSynced: boolean, dstSynced: boolean, hasTarget: boolean, sections: { listKey: string, title: string, rows: { index: number, label: string, qty: string, mode: string, stock: string }[] }[] }}
 */
export const previewWorklogMove = ({ date, fromSite, toSite }) => {
    const src = getGimpoLogByDate(date, fromSite);
    const hasTarget = hasLog(date, toSite);
    const srcSynced = hasLog(date, fromSite) && checkGimpoLogSyncStatus(src, fromSite).isSynced;
    const dstSynced = hasTarget && checkGimpoLogSyncStatus(getGimpoLogByDate(date, toSite), toSite).isSynced;
    const lots = inboundLots();
    const sections = MOVE_SECTIONS.map(([listKey, title]) => ({
        listKey, title,
        rows: (src[listKey] || []).map((row, index) => {
            const plan = planRow({ date, fromSite, toSite, listKey, row, srcSynced, dstSynced, lots });
            return { index, label: rowLabel(listKey, row), qty: typeof row === 'object' && row.qty ? fmt(row.qty) : '', mode: plan.mode, stock: plan.text };
        })
    })).filter(sec => sec.rows.length);
    return { srcSynced, dstSynced, hasTarget, sections };
};

/** 재고 증감(차이)을 이동·입고·출고로 기록한다. 거점만 적힌 위치에서 뺄 때는 그 거점의 창고·구획 재고까지 찾아 꺼낸다 */
const applyNet = async (net, { date, reason, worker }) => {
    const used = new Map();
    const byCode = new Map();
    net.forEach(d => byCode.set(d.code, [...(byCode.get(d.code) || []), d]));
    // 먼저 모자라지 않는지 모두 확인한다 (중간에 멈춰 반만 바뀌지 않게)
    const jobs = [];
    for (const [code, list] of byCode) {
        const takes = [];
        for (const d of list.filter(x => x.delta < 0)) {
            const need = Math.abs(d.delta);
            const alloc = allocateMaterialStock(code, d.loc, need, used);
            if (alloc.short > 0) throw new Error(`${d.name}: ${d.loc}${buildingOf(d.loc) ? '' : '(창고 포함)'} 재고가 ${fmt(alloc.short)} 모자랍니다 (지금 ${fmt(alloc.available)}) — 이미 출고·사용된 재고는 옮길 수 없습니다`);
            takes.push(...alloc.parts.map(p => ({ loc: p.location, qty: p.qty })));
        }
        jobs.push({ code, takes, gives: list.filter(x => x.delta > 0).map(x => ({ loc: x.loc, qty: x.delta })) });
    }
    const base = { worker, at: date, reason, worklog: false };
    for (const { code, takes, gives } of jobs) {
        for (const give of gives) {
            while (give.qty > 1e-9 && takes.length) {
                const take = takes[0];
                const qty = round3(Math.min(take.qty, give.qty));
                if (take.loc !== give.loc) await processStockAction({ ...base, type: 'MOVE', code, qty, fromLoc: take.loc, toLoc: give.loc });
                take.qty = round3(take.qty - qty);
                give.qty = round3(give.qty - qty);
                if (take.qty <= 1e-9) takes.shift();
            }
            if (give.qty > 1e-9) await processStockAction({ ...base, type: 'IN', code, qty: give.qty, location: give.loc });
        }
        for (const take of takes.filter(t => t.qty > 1e-9)) await processStockAction({ ...base, type: 'OUT', code, qty: take.qty, location: take.loc });
    }
};

/**
 * 고른 줄을 상대 거점의 같은 날짜 일지로 옮긴다.
 * @param {{ date: string, fromSite: 'HQ'|'GIMPO', toSite: 'HQ'|'GIMPO', picks: { listKey: string, index: number }[], withStock?: boolean, worker?: string }} p
 *   withStock = false면 일지 줄만 옮기고 재고는 건드리지 않는다
 * @returns {Promise<{ moved: number, stockFixed: number, stockApplied: number, errors: string[], notes: string[] }>}
 *   재고를 맞추지 못한 줄은 옮기지 않고 errors에 적는다
 */
export const moveWorklogRows = async ({ date, fromSite, toSite, picks, withStock = true, worker = '' }) => {
    if (!WORKLOG_SITES[fromSite] || !WORKLOG_SITES[toSite] || fromSite === toSite) throw new Error('옮길 거점을 확인하세요.');
    if (!hasLog(date, fromSite)) throw new Error('옮길 일지를 찾을 수 없습니다. 먼저 일지를 저장하세요.');
    const src = getGimpoLogByDate(date, fromSite), dst = getGimpoLogByDate(date, toSite);
    const from = WORKLOG_SITES[fromSite], to = WORKLOG_SITES[toSite];
    const srcSynced = checkGimpoLogSyncStatus(src, fromSite).isSynced;
    const dstSynced = hasLog(date, toSite) && checkGimpoLogSyncStatus(dst, toSite).isSynced;
    const lots = inboundLots();
    const result = { moved: 0, stockFixed: 0, stockApplied: 0, errors: [], notes: [] };
    const removed = [];

    // 1. 줄마다 재고 처리 계획
    const jobs = picks.map(({ listKey, index }) => ({ listKey, index, row: (src[listKey] || [])[index] }))
        .filter(j => j.row != null && TITLE[j.listKey])
        .map(j => ({ ...j, label: `[${TITLE[j.listKey]}] ${rowLabel(j.listKey, j.row)}`, plan: planRow({ date, fromSite, toSite, listKey: j.listKey, row: j.row, srcSynced, dstSynced, lots }) }));

    // 2. 재고: 고른 줄의 증감을 품목별로 합쳐 한 번에 옮긴다 — 같은 품목의 포장(+)과 출고(−)를 함께 옮길 때
    //    줄 순서 때문에 재고가 모자라다고 나오지 않게 (포장 1,200 − 출고 200 = 1,000만 옮기면 된다)
    const failed = new Map(); // 품목코드 → 재고를 맞추지 못한 까닭
    if (withStock) {
        const stockJobs = jobs.filter(j => (j.plan.mode === 'FIX' || j.plan.mode === 'APPLY') && j.plan.net.length);
        for (const code of new Set(stockJobs.map(j => j.plan.net[0].code))) {
            const mine = stockJobs.filter(j => j.plan.net[0].code === code);
            const isFix = mine.some(j => j.plan.mode === 'FIX');
            const parts = [...new Set(mine.map(j => TITLE[j.listKey]))].join('·');
            const reason = isFix ? `[${date} 업무일지 거점 정정 ${from.name}→${to.name}] ${parts} ${mine.length}줄`
                : `[${date} ${to.tag}] ${parts} ${mine.length}줄 (${from.name} 일지에서 옮김)`;
            try { await applyNet(netOf(mine.flatMap(j => j.plan.net)), { date, worker, reason }); } catch (e) { failed.set(code, e.message); }
        }
    }

    // 3. 일지 줄 옮기기 (재고를 맞추지 못한 품목의 줄은 원래 일지에 둔다)
    for (const { listKey, index, row, label, plan } of jobs) {
        const isStockRow = plan.mode === 'FIX' || plan.mode === 'APPLY';
        const code = plan.net[0]?.code;
        if (withStock && isStockRow && code && failed.has(code)) { result.errors.push(`${label}: ${failed.get(code)}`); continue; }
        // 원래 거점에 이미 반영된 줄(FIX)은 재고를 건드리지 않고 옮겨도 받은 일지에서 다시 반영되지 않게 표시한다
        const isStockDone = plan.mode === 'FIX' || (withStock && plan.mode === 'APPLY');
        if (withStock && plan.mode === 'FIX') {
            result.stockFixed += 1;
            if (listKey === 'oilBlending') result.notes.push(`${label}: 공토트 차감·IBC 대장은 자동으로 옮기지 않았습니다 — IBC 토트 관리에서 확인하세요.`);
        }
        if (withStock && plan.mode === 'APPLY') result.stockApplied += 1;
        const copy = typeof row === 'object' ? { ...row, movedFrom: fromSite, ...(isStockDone ? { stockDone: true, siteFixed: true } : {}) } : row;
        dst[listKey] = [...(dst[listKey] || []), copy];
        removed.push({ listKey, index });
        result.moved += 1;
    }

    if (result.moved) {
        removed.sort((x, y) => y.index - x.index).forEach(({ listKey, index }) => src[listKey].splice(index, 1));
        // 받은 일지를 먼저 저장한다 (중간에 끊겨도 줄이 사라지지 않게)
        saveGimpoLog(dst, toSite);
        saveGimpoLog(src, fromSite);
    }
    return result;
};
