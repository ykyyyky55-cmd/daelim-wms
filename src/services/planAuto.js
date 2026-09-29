// ==========================================
// 접수 업무 → 생산·구매계획 자동 반영 (supabase/auth/57_plan_auto_reflect.sql)
// ==========================================
// · 생산요청서(제품·원액) 등록·수정 → 주간 생산계획(PROD_WEEK) 줄 (생산 예정일 → 납기 → 오늘, 지난 날짜면 오늘)
//   구매요청서 → 주간 구매계획(PURCH_WEEK) 줄 (필요일). 요청서는 '계획반영'(PLANNED) + planWeek + autoPlan
//   줄 ref = 'REQ:<요청서id>:<순번>' / 'PREQ:…' — 다시 저장하면 손대지 않은 줄(상태 계획·실적 없음)만 바꾼다. 반려하면 뺀다.
// · 출고요청서(RQ)·이동전표(TR·WT) 발행 → 그 날짜 일일 생산계획의 업무 계획(dayTasks '<날짜>|전체')에
//   5. 출고 / 4. 이동제품 업무 (auto 'SLIP', slipNo). 일일 계획에서 만든 전표는 이미 업무가 있으므로 건너뛴다.
// · 생산·구매계획 화면을 열면 아직 반영 안 된 요청서·전표를 찾아 반영한다 (autoReflectOpen, 5분에 한 번).
// 주간 계획은 매니저 이상만 쓸 수 있어, 클라우드에서는 범위를 좁힌 DB 함수(wms_plan_merge_lines / wms_plan_merge_day_task)로 넣는다.
import { state, listSlipsRange } from './db.js';
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { loadWeek, savePlan, weekStart, newLineId, listPlans, addDays } from './plans.js';
import { localDateStr } from './searchUtils.js';
import { locationLabel } from './locations.js';
import { canPerformAction } from './auth.js';

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const untouched = (l) => (l.status || 'PLAN') === 'PLAN' && (l.doneQty === '' || l.doneQty === undefined || l.doneQty === null || Number(l.doneQty) === 0);
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

// 주간 문서의 접두어 줄 바꾸기 (클라우드 = DB 함수, 로컬 = 같은 규칙)
const mergeLines = async (kind, monday, prefix, lines) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.rpc('wms_plan_merge_lines', { p_kind: kind, p_period: monday, p_prefix: prefix, p_lines: lines });
        if (error) throw new Error(`계획 자동 반영 실패: ${error.message}`);
        return;
    }
    const doc = await loadWeek(kind, monday);
    if (!doc.createdAt && !lines.length) return;
    const kept = (doc.lines || []).filter(l => !String(l.ref || '').startsWith(prefix) || !untouched(l));
    doc.lines = [...kept, ...lines.filter(n => !kept.some(k => k.ref === n.ref))].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    await savePlan(doc);
};

// ---------- 요청서 → 주간 계획 ----------
const isPurch = (r) => r.kind === 'PURCH_REQ';
const targetDate = (r) => {
    const today = localDateStr();
    const d = isPurch(r) ? (r.dueDate || today) : (r.planDate || r.dueDate || today);
    return d < today ? today : d;
};
const reqLines = (r, prefix, date) => (r.lines || []).filter(l => l.code || l.name).map((l, i) => {
    const m = state.master.find(x => x.code === l.code);
    const note = [r.urgent ? '긴급' : '', l.note || ''].filter(Boolean).join(' · ');
    return isPurch(r)
        ? { id: newLineId(), date, site: r.site || '김포', code: l.code || '', name: l.name, spec: l.spec || '', qty: Number(l.qty) || '', unit: l.unit || 'EA',
            supplier: l.supplier || '', price: l.price || '', eta: r.dueDate || '', source: 'PREQ', ref: `${prefix}${i}`, refNo: r.docNo, status: 'PLAN', note: [note, r.partner || ''].filter(Boolean).join(' · ') }
        : { id: newLineId(), date, site: r.site || '본사', type: m?.category === '원액' || r.reqType === 'RAW' ? '원액' : '완제품', code: l.code || '', name: l.name, spec: l.spec || '',
            qty: Number(l.qty) || '', unit: l.unit || m?.unit || (r.reqType === 'RAW' ? 'L' : 'EA'), line: '', partner: r.partner || (r.moveTo ? `→ ${locationLabel(r.moveTo)}` : ''),
            due: r.dueDate || '', source: 'REQ', ref: `${prefix}${i}`, refNo: r.docNo, status: 'PLAN', note };
});

/**
 * 요청서 하나를 주간 계획에 반영 (등록·수정·반려 뒤에 부른다)
 * @returns { req: 저장된 요청서, monday, count } | null (반영 대상 아님)
 */
export const reflectRequest = async (r) => {
    if (!r?.id || !r.docNo || r.status === 'DONE') return null;
    // 예전에 [생산요청서 불러오기]로 직접 넣은 요청서(autoPlan 없음)는 그 계획에서 관리한다
    if (r.planWeek && !r.autoPlan) return null;
    const kind = isPurch(r) ? 'PURCH_WEEK' : 'PROD_WEEK';
    const prefix = `${isPurch(r) ? 'PREQ' : 'REQ'}:${r.id}:`;
    const active = r.status !== 'REJECTED';
    const date = targetDate(r);
    const monday = weekStart(date);
    const lines = active ? reqLines(r, prefix, date) : [];
    if (r.planWeek && r.planWeek !== monday) await mergeLines(kind, r.planWeek, prefix, []);
    await mergeLines(kind, monday, prefix, lines);
    const next = active
        ? { status: ['REQUESTED', 'ACCEPTED'].includes(r.status) ? 'PLANNED' : r.status, planWeek: monday, autoPlan: true }
        : { planWeek: '', autoPlan: true };
    const changed = Object.entries(next).some(([k, v]) => (r[k] || '') !== v);
    const req = changed ? await savePlan({ ...r, ...next }) : r;
    return { req, monday, count: lines.length, removed: !active };
};

// ---------- 출고·이동 전표 → 일일 업무 ----------
const SLIP_SEC = { RELEASE: 'shipping', TRANSFER: 'movement', WAREHOUSE: 'movement' };
export const slipTaskOf = (s) => {
    const sec = SLIP_SEC[s.type];
    const external = s.type === 'RELEASE' || !s.toLoc || s.toLoc === '외부 거래처';
    const to = external ? (s.partner || '외부 거래처') : (s.partner ? `${locationLabel(s.toLoc)} (${s.partner})` : locationLabel(s.toLoc));
    const it = s.items || [];
    const first = it[0];
    return {
        id: `S${String(s.docNo).replace(/[^A-Za-z0-9]/g, '')}`, sec, auto: 'SLIP', slipNo: s.docNo, slipSig: '',
        text: `${locationLabel(s.fromLoc) || '-'} → ${to} ${sec === 'shipping' ? '출고' : '이동'}${first ? ` · ${first.name} ${fmt(first.qty)}${first.unit || ''}${it.length > 1 ? ` 외 ${it.length - 1}품목` : ''}` : ''}`,
        time: s.shipTime || '', people: s.assigneeId ? [{ id: s.assigneeId, name: s.assigneeName || '' }] : [], note: `전표 ${s.docNo}`,
        slip: { from: s.fromLoc || '', to: s.toLoc || '', partner: s.partner || '', items: it.map(x => ({ code: x.code || '', name: x.name || '', spec: x.spec || '', qty: Number(x.qty) || 0, unit: x.unit || 'EA' })) }
    };
};
const fromDayPlan = (s) => String(s.reason || '').startsWith('일일 생산계획');

/** 전표 하나를 그 날짜 일일 계획 업무로 (발행 뒤에 부른다). 'ADDED' | 'UPDATED' | 'EXISTS' | null */
export const reflectSlip = async (s) => {
    if (!s?.docNo || !SLIP_SEC[s.type] || fromDayPlan(s) || !/^\d{4}-\d{2}-\d{2}$/.test(String(s.date || ''))) return null;
    const task = slipTaskOf(s);
    const monday = weekStart(s.date);
    const key = `${s.date}|전체`;
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.rpc('wms_plan_merge_day_task', { p_period: monday, p_key: key, p_task: task });
        if (error) throw new Error(`일일 계획 반영 실패: ${error.message}`);
        return data;
    }
    const doc = await loadWeek('PROD_WEEK', monday);
    if (!doc.dayTasks || typeof doc.dayTasks !== 'object') doc.dayTasks = {};
    for (const [k, e] of Object.entries(doc.dayTasks)) {
        if (k.split('|')[0] !== s.date) continue;
        const t = (e.tasks || []).find(x => x.slipNo === s.docNo);
        if (!t) continue;
        if (t.auto !== 'SLIP') return 'EXISTS';
        const { id, people, ...rest } = task;
        Object.assign(t, rest);
        await savePlan(doc);
        return 'UPDATED';
    }
    if (!doc.dayTasks[key]) doc.dayTasks[key] = { tasks: [], dist: null };
    doc.dayTasks[key].tasks.push(task);
    await savePlan(doc);
    return 'ADDED';
};

// ---------- 계획 화면을 열 때: 빠진 요청서·전표 반영 ----------
let lastRun = 0;
let running = null;
/**
 * @param scope 'PROD' | 'PURCH'
 * @returns { reqs, slips } 반영한 건수
 */
export const autoReflectOpen = async (scope = 'PROD', { force = false } = {}) => {
    if (!canPerformAction('PRODUCTION')) return { reqs: 0, slips: 0 };
    if (running) return running;
    if (!force && Date.now() - lastRun < 5 * 60 * 1000) return { reqs: 0, slips: 0 };
    running = (async () => {
        const out = { reqs: 0, slips: 0, errors: [] };
        const today = localDateStr();
        const kinds = scope === 'PURCH' ? ['PURCH_REQ'] : ['PROD_REQ', 'PURCH_REQ'];
        for (const kind of kinds) {
            const open = (await listPlans(kind, addDays(today, -180), '9999').catch(() => [])).filter(r => ['REQUESTED', 'ACCEPTED'].includes(r.status) && !r.planWeek);
            for (const r of open) {
                try { if (await reflectRequest(r)) out.reqs += 1; } catch (e) { out.errors.push(`${r.docNo}: ${e.message}`); }
            }
        }
        if (scope === 'PROD') {
            const slips = (await listSlipsRange({ from: addDays(today, -3), to: addDays(today, 21) }).catch(() => []))
                .filter(s => SLIP_SEC[s.type] && !fromDayPlan(s) && !s.shippedAt);
            // 주별로 문서를 한 번만 읽어 이미 있는 전표는 건너뛴다
            const weeks = new Map();
            for (const s of slips) {
                const w = weekStart(s.date);
                if (!weeks.has(w)) weeks.set(w, await loadWeek('PROD_WEEK', w).catch(() => ({})));
                const doc = weeks.get(w);
                const has = Object.entries(doc.dayTasks || {}).some(([k, e]) => k.split('|')[0] === s.date && (e.tasks || []).some(t => t.slipNo === s.docNo));
                if (has) continue;
                try { if ((await reflectSlip(s)) === 'ADDED') out.slips += 1; } catch (e) { out.errors.push(`${s.docNo}: ${e.message}`); }
            }
        }
        lastRun = Date.now();
        return out;
    })();
    try { return await running; } finally { running = null; }
};
