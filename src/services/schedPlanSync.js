// ==========================================
// 생산(포장) 스케줄 → 주간 생산계획(PROD_WEEK) 자동 반영 (월간 계획은 주간 계획을 모은 것이라 같이 반영됨)
// ==========================================
// · 기준: 최신 작성일자 스케줄. 날짜 = 포장계획일(planDate) → 없으면 납품예정일(dueDate). 둘 다 없으면(미정) 넣지 않는다.
// · 스케줄 줄 id는 작성일자가 넘어갈 때마다 바뀌므로, 계획 줄은 '주문 키'(ref 'SCHED:수주일|거래처|품목#순번')로 잇는다.
// · 생산요청서에서 온 스케줄 줄(reqRef)은 요청서가 이미 계획에 넣으므로(REQ 줄) 건너뛴다.
// · 이미 있는 줄: 스케줄이 완료·출고면 계획 줄 '완료', 보류면 '보류'. 진행 중이면 손대지 않은 줄(상태 계획·실적 없음)만
//   날짜·수량·거래처·라인·납기·입수를 스케줄 값으로 고친다 (날짜가 다른 주로 가면 그 주 문서로 옮김).
// · 주간 계획 쓰기는 매니저 이상(MRP_PLANNING, RLS)이라 그 권한이 있을 때만 돈다. 화면을 열 때 5분에 한 번 (force면 바로).
import { state } from './db.js';
import { listProdDates, listProdSchedule } from './prodSchedule.js';
import { loadWeek, savePlan, weekStart, newLineId, addDays } from './plans.js';
import { localDateStr } from './searchUtils.js';
import { canPerformAction } from './auth.js';

const OLDEST_DAYS = 60; // 이보다 오래된 날짜의 스케줄 줄은 새로 넣지 않음
const untouched = (l) => (l.status || 'PLAN') === 'PLAN' && (l.doneQty === '' || l.doneQty === undefined || l.doneQty === null || Number(l.doneQty) === 0);
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const dateOf = (r) => r.planDate || r.dueDate || '';

/** 스케줄 줄마다 작성일자가 바뀌어도 같은 값인 키 (같은 수주일·거래처·품목이 여러 줄이면 순번) */
const keysOf = (rows) => {
    const seen = new Map();
    return new Map([...rows].sort((a, b) => (a.sort || 0) - (b.sort || 0)).map(r => {
        const base = `SCHED:${r.orderDate || ''}|${norm(r.partner)}|${r.itemCode || norm(r.itemName)}`;
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        return [r.id, `${base}#${n}`];
    }));
};

const lineFor = (r, key, date) => {
    const m = state.master.find(x => x.code === r.itemCode) || state.master.find(x => x.name === r.itemName);
    const perBox = Number(r.perBox) || '';
    const qty = Number(r.qty) || '';
    return {
        id: newLineId(), date, site: r.site === '김포' ? '김포' : '본사', type: m?.category === '원액' ? '원액' : '완제품',
        code: m?.code || r.itemCode || '', name: m?.name || r.itemName, spec: r.spec || m?.spec || '',
        qty, unit: m?.unit || 'EA', perBox, box: perBox && qty ? Math.ceil(qty / perBox) : '',
        line: r.line || '', partner: r.partner || '', due: r.dueDate || '', source: 'SCHED', ref: key, schedId: r.id, status: 'PLAN', note: r.notes || ''
    };
};

let lastRun = 0;
let running = null;

/**
 * @returns {Promise<{ added: number, updated: number, closed: number, moved: number, undated: number, errors: string[] } | null>} 권한 없음·건너뜀이면 null
 */
export const syncScheduleToPlans = async ({ force = false } = {}) => {
    if (!canPerformAction('MRP_PLANNING')) return null;
    if (running) return running;
    if (!force && Date.now() - lastRun < 5 * 60 * 1000) return null;
    running = (async () => {
        const out = { added: 0, updated: 0, closed: 0, moved: 0, undated: 0, errors: [] };
        const dates = await listProdDates();
        if (!dates.length) return out;
        const rows = (await listProdSchedule(dates[0].date)).filter(r => !r.reqRef && (r.itemCode || r.itemName));
        const keys = keysOf(rows);
        const oldest = addDays(localDateStr(), -OLDEST_DAYS);

        // 관련 주 문서 모으기: 스케줄 날짜의 주 + 기존 SCHED 줄이 있을 만한 주(스케줄 날짜 ± 앞뒤 주)
        const weeks = new Map();
        const load = async (w) => { if (!weeks.has(w)) weeks.set(w, { doc: await loadWeek('PROD_WEEK', w), dirty: false }); return weeks.get(w); };
        const weekSet = new Set(rows.map(dateOf).filter(Boolean).filter(d => d >= oldest).map(weekStart));
        const thisWeek = weekStart(localDateStr());
        for (let i = -4; i <= 8; i++) weekSet.add(addDays(thisWeek, i * 7));
        for (const w of weekSet) { try { await load(w); } catch (e) { out.errors.push(`${w}: ${e.message}`); } }

        // 기존 SCHED 줄 찾기: 새 키(ref) → 예전 방식(ref = 스케줄 줄 id) → 품목·거래처·수량이 같은 줄
        const findLine = (r, key) => {
            for (const [w, e] of weeks) {
                const l = (e.doc.lines || []).find(x => x.source === 'SCHED' && (x.ref === key || x.ref === r.id || x.schedId === r.id));
                if (l) return { w, e, l };
            }
            for (const [w, e] of weeks) {
                const l = (e.doc.lines || []).find(x => x.source === 'SCHED' && !String(x.ref || '').startsWith('SCHED:')
                    && (x.code ? x.code === r.itemCode : norm(x.name) === norm(r.itemName)) && norm(x.partner) === norm(r.partner) && Number(x.qty) === Number(r.qty));
                if (l) return { w, e, l };
            }
            return null;
        };

        for (const r of rows) {
            const key = keys.get(r.id);
            const date = dateOf(r);
            const hit = findLine(r, key);
            const closed = ['DONE', 'SHIPPED'].includes(r.status);
            if (hit) {
                const { l, e } = hit;
                if (l.ref !== key) { l.ref = key; e.dirty = true; }
                if (l.schedId !== r.id) { l.schedId = r.id; e.dirty = true; }
                if (closed) {
                    if (l.status !== 'DONE') { l.status = 'DONE'; if (!Number(l.doneQty)) l.doneQty = Number(r.qty) || l.qty; e.dirty = true; out.closed++; }
                    continue;
                }
                if (r.status === 'HOLD') {
                    if (untouched(l)) { l.status = 'HOLD'; e.dirty = true; out.updated++; }
                    continue;
                }
                if (l.status === 'HOLD' && r.status !== 'HOLD') { l.status = 'PLAN'; e.dirty = true; }
                if (!untouched(l)) continue;
                const fresh = lineFor(r, key, date || l.date);
                const fields = ['qty', 'partner', 'line', 'due', 'perBox'];
                const changed = fields.filter(f => String(l[f] ?? '') !== String(fresh[f] ?? ''));
                if (changed.length) {
                    changed.forEach(f => { l[f] = fresh[f]; });
                    if (!l.boxManual && fresh.box !== '') l.box = fresh.box;
                    e.dirty = true; out.updated++;
                }
                // 날짜가 바뀌어 다른 주로 가면 옮긴다
                if (date && date !== l.date) {
                    const nw = weekStart(date);
                    if (nw === hit.w) { l.date = date; e.dirty = true; out.updated++; }
                    else {
                        try {
                            const ne = await load(nw);
                            e.doc.lines = e.doc.lines.filter(x => x !== l);
                            ne.doc.lines = [...(ne.doc.lines || []), { ...l, date }];
                            e.dirty = true; ne.dirty = true; out.moved++;
                        } catch (err) { out.errors.push(`${r.itemName}: ${err.message}`); }
                    }
                }
                continue;
            }
            // 새 줄: 진행 중(보류·완료·출고 제외)이고 날짜가 있는 줄만
            if (closed || r.status === 'HOLD') continue;
            if (!date) { out.undated++; continue; }
            if (date < oldest) continue;
            try {
                const e = await load(weekStart(date));
                e.doc.lines = [...(e.doc.lines || []), lineFor(r, key, date)];
                e.dirty = true; out.added++;
            } catch (err) { out.errors.push(`${r.itemName}: ${err.message}`); }
        }

        for (const [w, e] of weeks) {
            if (!e.dirty) continue;
            e.doc.lines.sort((a, b) => String(a.date).localeCompare(String(b.date)));
            try { await savePlan(e.doc); } catch (err) { out.errors.push(`${w} 저장: ${err.message}`); }
        }
        lastRun = Date.now();
        return out;
    })();
    try { return await running; } finally { running = null; }
};

/** 알림 글 */
export const schedSyncSummary = (r) => (!r ? '' : [r.added ? `새 줄 ${r.added}` : '', r.updated ? `수정 ${r.updated}` : '', r.moved ? `날짜 이동 ${r.moved}` : '', r.closed ? `완료 ${r.closed}` : ''].filter(Boolean).join(' · '));
