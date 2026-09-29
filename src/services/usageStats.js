// ==========================================
// 사용 정착 현황 (지원 → 사용 정착 현황, components/UsageBoard.js)
// ==========================================
// WMS 기본업무(업무일지·입출고·수불부) 사용이 자리 잡는지 보는 계산. 저장하지 않고 화면을 열 때 계산한다.
//   · 업무일지: 거점(본사·김포)마다 기간 안 평일(공휴일 제외) 중 작성된 날·빠진 날, 수불부 미반영 날(isSyncedToLedger false)
//   · 입력 건수: 입출고 이력(state.history), 수불부 전표(원료·제품·자재, 수불일자 기준), 발행 전표(wms_slips) — 일자별·사람별
//   · 활동 없는 사용자: 승인된 사용자 중 기간 안 기록(이력·수불부·전표 작성자, 업무일지 작성자)이 없는 사람
//   · 확인할 일: 업무일지 미작성·수불부 미반영 날, 재고 차이(services/stockCheck.js), 출고일 지난 미출고 출고요청서
import { state } from './db.js';
import { localDateStr } from './searchUtils.js';
import { isPublicHoliday } from './holidays.js';
import { computeStockDiff } from './stockCheck.js';
import { listSlipsRange } from './db.js';
import { listChatUsers } from './chat.js';

export const USAGE_SITES = { HQ: '본사', GIMPO: '김포' };
const SYSTEM_WORKERS = new Set(['시스템', 'system', '', '-']);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return localDateStr(x); };

/** 이력 시각 → 'YYYY-MM-DD' (로컬 표기 'YYYY-MM-DD HH:mm' 또는 ISO) */
export const dayOfStamp = (ts) => {
    const s = String(ts || '');
    if (/^\d{4}-\d{2}-\d{2}(?![T\d])/.test(s) && !/[+Z]/.test(s.slice(10))) return s.slice(0, 10);
    const d = new Date(s.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? s.slice(0, 10) : localDateStr(d);
};
/** 위치 글자 → 거점 키 (HQ | GIMPO | '') */
export const siteKeyOf = (loc) => { const s = String(loc || ''); return s.includes('김포') ? 'GIMPO' : s.includes('본사') || s.includes('방산') ? 'HQ' : ''; };
/** 기간 안 평일(주말·공휴일 제외) — 오늘까지만 */
export const workdaysBetween = (from, to) => {
    const out = [];
    const end = to < localDateStr() ? to : localDateStr();
    for (let d = from; d <= end; d = addDays(d, 1)) { const w = new Date(`${d}T00:00:00`).getDay(); if (w && w !== 6 && !isPublicHoliday(d)) out.push(d); }
    return out;
};
const LOG_SECTIONS = ['packaging', 'oilBlending', 'labeling', 'movement', 'receiving', 'shipping', 'otherTasks', 'courier', 'purchaseOrders'];
/** 업무일지에 내용이 있는지 (빈 줄만 있는 일지는 작성 안 한 것으로) */
export const logHasContent = (log) => LOG_SECTIONS.some(k => (log?.[k] || []).some(r => Object.values(r || {}).some(v => v !== '' && v !== null && v !== undefined && v !== 0 && v !== false)));

/** 화면을 열 때 한 번 받는 클라우드 자료 (전표·사용자 목록) */
export const loadUsageExtras = async ({ from }) => {
    const [slips, users] = await Promise.all([listSlipsRange({ from: addDays(from, -30) }).catch(() => []), listChatUsers().catch(() => [])]);
    return { slips, users };
};

/**
 * @param {{ from: string, to: string, site: ''|'HQ'|'GIMPO' }} range
 * @param {{ slips: object[], users: {id: string, name: string, dept?: string}[] }} extras
 */
export const computeUsage = ({ from, to, site = '' }, { slips = [], users = [] } = {}) => {
    const today = localDateStr();
    const inRange = (d) => d && d >= from && d <= to;
    const siteOk = (k) => !site || !k || k === site;
    const days = [];
    for (let d = from; d <= to && d <= today; d = addDays(d, 1)) days.push(d);
    const daily = Object.fromEntries(days.map(d => [d, { history: 0, ledger: 0, slips: 0, logs: { HQ: false, GIMPO: false } }]));
    const people = new Map();
    const person = (name) => {
        const n = String(name || '').trim();
        if (SYSTEM_WORKERS.has(n)) return null;
        if (!people.has(n)) people.set(n, { name: n, history: 0, ledger: 0, slips: 0, logs: 0, last: '' });
        return people.get(n);
    };
    const touch = (p, when) => { if (p && when > p.last) p.last = when; };

    // 업무일지
    const workdays = workdaysBetween(from, to);
    const worklog = {};
    for (const [key, list] of [['HQ', state.hqLogs || []], ['GIMPO', state.gimpoLogs || []]]) {
        if (!siteOk(key)) continue;
        const byDate = new Map(list.filter(l => inRange(l.date)).map(l => [l.date, l]));
        const written = [], missing = [], unsynced = [];
        workdays.forEach(d => { const l = byDate.get(d); if (l && logHasContent(l)) written.push(d); else if (d < today) missing.push(d); });
        byDate.forEach((l, d) => {
            if (!logHasContent(l)) return;
            if (daily[d]) daily[d].logs[key] = true;
            if (l.isSyncedToLedger === false && d < today) unsynced.push(d);
            const p = person(l.manager); if (p) { p.logs += 1; touch(p, d); }
        });
        const due = workdays.filter(d => d < today).length;
        worklog[key] = { label: USAGE_SITES[key], workdays: due, written: written.filter(d => d < today).length, writtenToday: written.includes(today), missing, unsynced: unsynced.sort(), rate: due ? (written.filter(d => d < today).length / due) * 100 : null };
    }

    // 입출고 이력
    const histByType = {};
    let systemHistory = 0;
    (state.history || []).forEach(h => {
        const d = dayOfStamp(h.timestamp);
        if (!inRange(d)) return;
        if (!siteOk(siteKeyOf(h.toLoc !== '-' ? h.toLoc : h.fromLoc))) return;
        if (SYSTEM_WORKERS.has(String(h.worker || '').trim())) { systemHistory += 1; return; }
        if (daily[d]) daily[d].history += 1;
        histByType[h.type] = (histByType[h.type] || 0) + 1;
        const p = person(h.worker); if (p) { p.history += 1; touch(p, d); }
    });

    // 수불부 전표 (수불일자 기준)
    const ledgerByKind = { raw: 0, product: 0, material: 0 };
    for (const [kind, list] of [['raw', state.rawLedger], ['product', state.productLedger], ['material', state.materialLedger]]) {
        (list || []).forEach(e => {
            if (!inRange(e.date) || !siteOk(siteKeyOf(e.location))) return;
            if (String(e.id || '').startsWith('INIT-')) return; // 최초 이관 전표는 사용 기록이 아님
            ledgerByKind[kind] += 1;
            if (daily[e.date]) daily[e.date].ledger += 1;
            const p = person(e.worker); if (p) { p.ledger += 1; touch(p, e.date); }
        });
    }

    // 발행 전표
    const slipByType = {};
    const lateShip = [];
    slips.forEach(s => {
        const k = siteKeyOf(s.fromLoc) || siteKeyOf(s.toLoc);
        if (!siteOk(k)) return;
        if (s.type === 'RELEASE' && !s.shippedAt && s.date && s.date < today) lateShip.push(s);
        if (!inRange(s.date)) return;
        slipByType[s.type] = (slipByType[s.type] || 0) + 1;
        if (daily[s.date]) daily[s.date].slips += 1;
        const p = person(s.worker); if (p) { p.slips += 1; touch(p, s.date); }
    });

    // 사람별: 승인된 사용자 중 기록 없는 사람도 넣는다 (이름으로 맞춤)
    const userNames = new Map(users.map(u => [String(u.name || '').trim(), u]));
    userNames.forEach((u, n) => { if (n && !people.has(n)) people.set(n, { name: n, history: 0, ledger: 0, slips: 0, logs: 0, last: '' }); });
    const rows = [...people.values()].map(p => ({ ...p, dept: userNames.get(p.name)?.dept || '', isUser: userNames.has(p.name), total: p.history + p.ledger + p.slips + p.logs }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ko'));
    const idle = rows.filter(r => r.isUser && !r.total);

    // 재고 차이
    const diffs = computeStockDiff().filter(r => Math.abs(r.diff) > 1e-6 && siteOk(siteKeyOf(r.loc)));
    const diffByKind = diffs.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] || 0) + 1 }), {});

    const totals = {
        history: Object.values(histByType).reduce((a, b) => a + b, 0), systemHistory,
        ledger: ledgerByKind.raw + ledgerByKind.product + ledgerByKind.material,
        slips: Object.values(slipByType).reduce((a, b) => a + b, 0),
        activeDays: days.filter(d => daily[d].history + daily[d].ledger + daily[d].slips > 0 || daily[d].logs.HQ || daily[d].logs.GIMPO).length,
        activePeople: rows.filter(r => r.total > 0).length
    };
    const alerts = [];
    Object.entries(worklog).forEach(([k, w]) => {
        if (w.missing.length) alerts.push({ level: 'red', text: `${w.label} 업무일지 미작성 ${w.missing.length}일`, sub: w.missing.map(d => d.slice(5).replace('-', '/')).join(' · '), tab: k === 'HQ' ? 'hqLog' : 'gimpoLog', site: k, date: w.missing[w.missing.length - 1] });
        if (w.unsynced.length) alerts.push({ level: 'amber', text: `${w.label} 업무일지 수불부 미반영 ${w.unsynced.length}일`, sub: w.unsynced.map(d => d.slice(5).replace('-', '/')).join(' · '), tab: k === 'HQ' ? 'hqLog' : 'gimpoLog', site: k, date: w.unsynced[0] });
    });
    if (diffs.length) alerts.push({ level: 'amber', text: `수불부 ↔ 창고 재고 차이 ${diffs.length}건`, sub: `원료 ${diffByKind.raw || 0} · 제품 ${diffByKind.product || 0} · 자재 ${diffByKind.material || 0}`, tab: 'stockCheck' });
    if (lateShip.length) alerts.push({ level: 'amber', text: `출고일 지난 미출고 출고요청서 ${lateShip.length}건`, sub: lateShip.slice(0, 6).map(s => `${s.docNo} ${s.partner || ''}`).join(' · '), tab: 'slipManage' });
    if (idle.length) alerts.push({ level: 'info', text: `기간 안 기록이 없는 사용자 ${idle.length}명`, sub: idle.slice(0, 12).map(r => r.name).join(' · '), tab: '' });
    return { days, daily, worklog, histByType, ledgerByKind, slipByType, people: rows, idle, diffs: diffs.length, diffByKind, lateShip, totals, alerts };
};
