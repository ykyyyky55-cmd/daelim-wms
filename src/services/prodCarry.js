// ==========================================
// 생산(포장) 스케줄 자동 넘김: 그날 끝나지 않은 줄 → 다음 작성일자
// ==========================================
// 앱을 열거나 생산(포장) 스케줄 화면을 열 때, 최신 작성일자가 오늘보다 앞이면 오늘 작성일자를 새로 만들고
// 최신 작성일자에서 끝나지 않은 줄(미정·보류, 생산 예정, 부자재 준비, 생산중)을 그대로 옮겨 적는다.
// 완료·출고대기(DONE)와 출고완료(SHIPPED)는 넘기지 않는다. 새 작성일자에는 [줄 추가]로 스케줄을 더 넣는다.
// · 기준일 CARRY_BASE(2026-09-28) 이전 작성일자에서는 넘기지 않는다 (그 전은 엑셀에서 옮긴 예전 기록).
// · 토·일요일에는 만들지 않는다 (금요일 스케줄이 월요일로 넘어감).
// · 여러 기기가 동시에 열어도 한 번만: 오늘 작성일자가 이미 있으면 건너뛰고, 줄 id를 (날짜, 원래 줄 id)로 정해 겹쳐 써도 같은 줄이 된다.
// · 쓰기 권한(현장 작업자 이상, RLS wms_prod_sched_insert)이 있을 때만 한다.
import { listProdDates, listProdSchedule, saveProdRows } from './prodSchedule.js';
import { canPerformAction } from './auth.js';
import { localDateStr } from './searchUtils.js';

export const CARRY_BASE = '2026-09-28';
export const CARRY_STATUSES = ['HOLD', 'PLANNED', 'PREP', 'PRODUCING'];
const DONE_KEY = 'daelim_prod_carry_day';

// 짧은 해시 (줄 id가 날마다 길어지지 않게)
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
export const carryId = (date, srcId) => `PS-C${date.replace(/-/g, '')}-${hash(srcId)}`;

let running = null;

/**
 * 최신 작성일자의 미완료 줄을 오늘 작성일자로 넘긴다.
 * @returns {Promise<{ from: string, to: string, count: number, skipped: number } | null>} 만들지 않았으면 null
 */
export const carryOverSchedule = async ({ today = localDateStr(), force = false } = {}) => {
    if (running) return running;
    running = (async () => {
        if (!canPerformAction('PRODUCTION')) return null;
        if (!force) { try { if (localStorage.getItem(DONE_KEY) === today) return null; } catch { /* 무시 */ } }
        const dow = new Date(`${today}T00:00:00`).getDay();
        if (dow === 0 || dow === 6) return null;
        const dates = await listProdDates();
        const latest = dates[0]?.date || '';
        const mark = () => { try { localStorage.setItem(DONE_KEY, today); } catch { /* 무시 */ } };
        if (!latest || latest >= today || latest < CARRY_BASE) { mark(); return null; }
        // 다른 기기가 방금 만들었는지 한 번 더
        if ((await listProdSchedule(today)).length) { mark(); return null; }
        const src = await listProdSchedule(latest);
        const carry = src.filter(r => CARRY_STATUSES.includes(r.status));
        if (!carry.length) { mark(); return { from: latest, to: today, count: 0, skipped: src.length }; }
        await saveProdRows(carry.map((r, i) => ({ ...r, id: carryId(today, r.id), sheetDate: today, sort: i + 1 })));
        mark();
        return { from: latest, to: today, count: carry.length, skipped: src.length - carry.length };
    })();
    try { return await running; } finally { running = null; }
};
