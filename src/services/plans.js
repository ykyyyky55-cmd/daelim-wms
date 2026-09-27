// ==========================================
// 생산관리: 생산계획 · 구매계획 · 생산요청서 · 제품 BOM
// ==========================================
// - 문서는 wms_plans(supabase/auth/27_production_planning.sql) 한 줄 = 문서 하나(data JSONB). 로컬 모드는 localStorage.
//   PROD_WEEK / PURCH_WEEK : 주간 계획(period = 그 주 월요일). 줄(lines)마다 날짜가 있어 일일 계획 = 주간 줄을 날짜로 본 것.
//   PROD_MONTH / PURCH_MONTH : 월간 계획 머리(비고)만. 줄은 그 달 날짜의 주간 줄을 취합해 계산한다(monthLines).
//   PROD_REQ : 생산요청서 (doc_no = PR-YYYYMMDD-NNN)
// - 제품 BOM(wms_product_boms): 완제품 1단위당 원액·부자재 소요량. 원액의 원료 배합은 보안 시방서(wms_recipes)만 쓴다.
// - 부족량: 계획 줄 × BOM(원액·원료는 보안 시방서) = 필요량, 수불부 재고 + 계획된 원액 생산 + 구매계획 = 공급 → 모자라면 부족.
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state, rawLedgerStockSummary } from './db.js';
import { ledgerKindOfCategory, LEDGER_KINDS } from './db.js';
import { siteOf } from './locations.js';
import { localDateStr } from './searchUtils.js';

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const LOCAL_KEY = 'daelim_plans';
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const saveLocal = (rows) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(rows)); } catch (e) { console.warn('[계획] 로컬 저장 실패', e); } };
const newId = (p) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
export const newLineId = () => newId('PL');
export const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

export const PLAN_SITES = ['본사', '김포'];
const SITE_INFO = { 본사: { invSite: '본사', region: '본사', cal: 'HQ' }, 김포: { invSite: '김포공장', region: '김포', cal: 'GIMPO' } };
export const siteInfo = (site) => SITE_INFO[site] || SITE_INFO.본사;

export const PROD_LINE_STATUS = { PLAN: '계획', WORK: '진행', DONE: '완료', HOLD: '보류' };
export const PURCH_LINE_STATUS = { PLAN: '계획', ORDER: '발주', RECEIVED: '입고완료', HOLD: '보류' };
export const REQ_STATUS = { REQUESTED: '요청', ACCEPTED: '접수', PLANNED: '계획반영', DONE: '완료', REJECTED: '반려' };
export const SOURCE_LABEL = { MANUAL: '직접', SCHED: '생산스케줄', REQ: '생산요청', CAL: '캘린더', SHORT: '부족 연동', SAFETY: '안전재고', PREQ: '구매요청' };

// 요청서 종류: 제품생산요청서·원액생산요청서(PROD_REQ, data.reqType), 구매요청서(PURCH_REQ)
export const REQ_TYPES = {
    PRODUCT: { kind: 'PROD_REQ', reqType: 'PRODUCT', prefix: 'PR', label: '제품생산요청서', printTitle: '제 품 생 산 요 청 서', sub: 'PRODUCT PRODUCTION REQUEST', unit: 'EA', itemFilter: (m) => m.category === '완제품' },
    RAW: { kind: 'PROD_REQ', reqType: 'RAW', prefix: 'BR', label: '원액생산요청서', printTitle: '원 액 생 산 요 청 서', sub: 'BULK OIL PRODUCTION REQUEST', unit: 'L', itemFilter: (m) => m.category === '원액' },
    PURCH: { kind: 'PURCH_REQ', reqType: 'PURCH', prefix: 'PQ', label: '구매요청서', printTitle: '구 매 요 청 서', sub: 'PURCHASE REQUEST', unit: 'EA', itemFilter: (m) => m.category !== '완제품' }
};
// 예전 생산요청서(reqType 없음)는 제품생산요청서
export const reqTypeOf = (doc) => (doc.kind === 'PURCH_REQ' ? 'PURCH' : doc.reqType === 'RAW' ? 'RAW' : 'PRODUCT');

// ---------- 날짜·주 ----------
const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
export const weekStart = (s = localDateStr()) => { const d = parse(s); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return fmt(d); };
export const weekDays = (monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
export const DOW = ['월', '화', '수', '목', '금', '토', '일'];
export const dowOf = (s) => DOW[(parse(s).getDay() + 6) % 7];
export const md = (s) => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
// 'N월 M주차': 그 주 목요일이 속한 달 기준
export const weekLabel = (monday) => {
    const thu = parse(addDays(monday, 3)); // 그 달의 목요일은 1~7일이 1주차, 8~14일이 2주차 …
    return `${thu.getFullYear()}년 ${thu.getMonth() + 1}월 ${Math.ceil(thu.getDate() / 7)}주차 (${md(monday)}~${md(addDays(monday, 6))})`;
};
export const monthOf = (s) => String(s).slice(0, 7);
export const monthDays = (ym) => { const [y, m] = ym.split('-').map(Number); const n = new Date(y, m, 0).getDate(); return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`); };
// 그 달과 겹치는 주(월요일) 목록
export const monthWeeks = (ym) => { const days = monthDays(ym); const out = []; days.forEach(d => { const w = weekStart(d); if (!out.includes(w)) out.push(w); }); return out; };

// ---------- 문서 ----------
const fromRow = (r) => ({ ...(r.data || {}), id: r.id, kind: r.kind, period: r.period, docNo: r.doc_no || '', status: r.status || '', createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by || '' });
const toRow = (doc) => {
    const { id, kind, period, docNo, status, createdAt, updatedAt, updatedBy, ...data } = doc;
    return { id, kind, period, doc_no: docNo || null, status: status || null, data, updated_at: new Date().toISOString(), updated_by: state.currentGlobalWorker || state.currentUser?.name || '' };
};
const fail = (error, what) => {
    const msg = error?.message || String(error);
    if (/row-level security|permission denied/i.test(msg)) throw new Error(`${what} 권한이 없습니다.`);
    if (/wms_plans|relation .* does not exist/i.test(msg) && /exist/i.test(msg)) throw new Error(`${what} 실패: 생산관리 DB 설정(27_production_planning.sql)이 적용되지 않았습니다.`);
    throw new Error(`${what} 실패: ${msg}`);
};

// kind 문서 목록 (period 범위, 둘 다 포함)
export const listPlans = async (kind, from = '', to = '9999') => {
    const sb = cloud();
    if (sb) {
        let q = sb.from('wms_plans').select('*').eq('kind', kind);
        if (from) q = q.gte('period', from);
        if (to) q = q.lte('period', to);
        const { data, error } = await q.order('period', { ascending: false });
        if (error) fail(error, '계획 조회');
        return (data || []).map(fromRow);
    }
    return loadLocal().filter(r => r.kind === kind && (!from || r.period >= from) && (!to || r.period <= to))
        .sort((a, b) => b.period.localeCompare(a.period)).map(fromRow);
};

// 주간·월간 계획 하나 (없으면 null). id는 종류·기간으로 고정.
export const planId = (kind, period) => `${kind}-${period}`;
export const getPlan = async (kind, period) => (await listPlans(kind, period, period))[0] || null;

export const savePlan = async (doc) => {
    const row = toRow({ ...doc, id: doc.id || (doc.kind === 'PROD_REQ' || doc.kind === 'PURCH_REQ' ? newId(doc.kind === 'PURCH_REQ' ? 'PQ' : 'PR') : planId(doc.kind, doc.period)) });
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_plans').upsert(row, { onConflict: 'id' }).select().single();
        if (error) fail(error, '계획 저장');
        return fromRow(data);
    }
    const rows = loadLocal();
    const i = rows.findIndex(r => r.id === row.id);
    const saved = { ...row, created_at: i >= 0 ? rows[i].created_at : new Date().toISOString() };
    if (i >= 0) rows[i] = saved; else rows.push(saved);
    saveLocal(rows);
    return fromRow(saved);
};

export const deletePlan = async (id) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_plans').delete().eq('id', id);
        if (error) fail(error, '계획 삭제');
        return;
    }
    saveLocal(loadLocal().filter(r => r.id !== id));
};

// 빈 주간 계획
export const blankWeek = (kind, monday) => ({ id: planId(kind, monday), kind, period: monday, lines: [], notes: '', author: state.currentGlobalWorker || '' });
export const loadWeek = async (kind, monday) => (await getPlan(kind, monday)) || blankWeek(kind, monday);

// 월간: 그 달 날짜의 주간 줄 모음 [{ ...line, week }]
export const loadMonthLines = async (weekKind, ym) => {
    const weeks = monthWeeks(ym);
    const docs = await listPlans(weekKind, weeks[0], weeks[weeks.length - 1]);
    const out = [];
    docs.forEach(doc => (doc.lines || []).forEach(l => { if (monthOf(l.date) === ym) out.push({ ...l, week: doc.period }); }));
    return { weeks, docs, lines: out.sort((a, b) => String(a.date).localeCompare(String(b.date))) };
};

// ---------- 생산요청서 번호 ----------
export const nextReqNo = async (date = localDateStr(), code = 'PR') => {
    const prefix = `${code}-${String(date).replace(/-/g, '')}-`;
    let max = 0;
    const bump = (no) => { if (String(no || '').startsWith(prefix)) max = Math.max(max, parseInt(String(no).slice(prefix.length), 10) || 0); };
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_plans').select('doc_no').like('doc_no', `${prefix}%`);
        if (error) fail(error, '요청번호 확인');
        (data || []).forEach(r => bump(r.doc_no));
    } else loadLocal().forEach(r => bump(r.doc_no));
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
};

// 요청서 저장: 새 요청서는 번호를 정하고, 번호가 겹치면 다음 번호로 다시
export const saveRequest = async (req, type = REQ_TYPES[reqTypeOf(req)]) => {
    if (!(req.lines || []).some(l => l.code || l.name)) throw new Error('요청 품목을 1개 이상 넣으세요.');
    if ((req.lines || []).some(l => (l.code || l.name) && !(Number(l.qty) > 0))) throw new Error('수량이 0인 품목이 있습니다.');
    const base = { ...req, kind: type.kind, reqType: type.reqType, period: req.reqDate || localDateStr() };
    if (req.docNo) return savePlan(base);
    for (let i = 0; i < 5; i++) {
        const docNo = await nextReqNo(req.reqDate || localDateStr(), type.prefix);
        try {
            return await savePlan({ ...base, docNo, status: req.status || 'REQUESTED' });
        } catch (e) {
            if (!/duplicate|unique|23505/i.test(e.message)) throw e;
        }
    }
    throw new Error('요청번호가 계속 겹쳐 저장하지 못했습니다. 잠시 후 다시 시도하세요.');
};

// ---------- 제품 BOM ----------
const BOM_LOCAL_KEY = 'daelim_product_recipes'; // 제품생산 화면이 쓰던 키 (기기별)
const loadLocalBoms = () => { try { return JSON.parse(localStorage.getItem(BOM_LOCAL_KEY) || '{}'); } catch { return {}; } };
let cloudBoms = null; // code → { rawList, subList, updatedAt }

export const loadBoms = async (force = false) => {
    const sb = cloud();
    if (sb && (force || !cloudBoms)) {
        const { data, error } = await sb.from('wms_product_boms').select('*');
        if (error) { console.warn('[BOM] 클라우드 BOM을 불러오지 못했습니다:', error.message); cloudBoms = cloudBoms || {}; }
        else cloudBoms = Object.fromEntries((data || []).map(r => [r.code, { rawList: r.raw_list || [], subList: r.sub_list || [], updatedAt: r.updated_at }]));
    }
    return getBoms();
};
// 이 기기 배합비 위에 클라우드 BOM을 덮어 쓴 표 (클라우드가 기준)
export const getBoms = () => ({ ...loadLocalBoms(), ...(cloudBoms || {}) });

export const saveBom = async (code, rawList, subList) => {
    const local = loadLocalBoms();
    local[code] = { rawList, subList, savedAt: new Date().toISOString() };
    try { localStorage.setItem(BOM_LOCAL_KEY, JSON.stringify(local)); } catch { /* 저장 불가 */ }
    const item = state.master.find(m => m.code === code);
    const sb = cloud();
    // 원액의 원료 배합은 보안 자료라 클라우드 BOM(모든 사용자가 조회)에 올리지 않는다
    if (!sb || item?.category === '원액' || item?.category === '원료') return { cloud: false };
    // slot: 생산스케줄 원부자재 분류 칸 (있으면 함께 저장)
    const clean = (list) => (list || []).filter(x => x.code && Number(x.rate) > 0).map(x => ({ code: x.code, rate: Number(x.rate), ...(x.slot !== undefined ? { slot: x.slot } : {}) }));
    const { error } = await sb.from('wms_product_boms').upsert({ code, raw_list: clean(rawList), sub_list: clean(subList), updated_at: new Date().toISOString(), updated_by: state.currentGlobalWorker || '' }, { onConflict: 'code' });
    if (error) throw new Error(`BOM을 클라우드에 저장하지 못했습니다: ${error.message}`);
    cloudBoms = { ...(cloudBoms || {}), [code]: { rawList: clean(rawList), subList: clean(subList), updatedAt: new Date().toISOString() } };
    return { cloud: true };
};

// ---------- 수불부 재고 ----------
const masterOf = (code) => state.master.find(m => m.code === code);
// code 품목의 거점 재고 (원료·원액: 원료수불부 지역 재고, 그 밖: 제품·자재수불부 마지막 재고, 수불부에 없으면 창고 재고)
export const ledgerStock = (code, site) => {
    const m = masterOf(code);
    const { invSite, region } = siteInfo(site);
    const kind = ledgerKindOfCategory(m?.category);
    if (kind === 'raw') {
        const rows = rawLedgerStockSummary('region', region);
        const hit = rows.find(r => r.last?.code === code) || rows.find(r => m && r.name === m.name);
        if (hit) return { qty: round3(hit.stockQty), from: '원료수불부' };
    } else {
        const list = state[LEDGER_KINDS[kind].stateKey] || [];
        for (let i = list.length - 1; i >= 0; i--) {
            const e = list[i];
            if (e.code === code && siteOf(e.location) === invSite) return { qty: round3(e.stockQty), from: LEDGER_KINDS[kind].label };
        }
    }
    const inv = state.inventory.filter(i => i.code === code && siteOf(i.location) === invSite).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    return { qty: round3(inv), from: '창고 재고' };
};
export const otherSitesStock = (code, site) => PLAN_SITES.filter(s => s !== site).map(s => ({ site: s, qty: ledgerStock(code, s).qty })).filter(x => x.qty > 0);

// ---------- 부족량 계산 ----------
// prodLines: 생산계획 줄, purchLines: 같은 기간 구매계획 줄, recipes: 보안 시방서(권한 있을 때만, 없으면 null)
export const computeShortage = ({ prodLines, purchLines = [], recipes = null, site = '' }) => {
    const boms = getBoms();
    const need = new Map(); // code|site → row
    const missingBom = [];
    const noRecipe = [];
    const add = (code, qty, s, date, by) => {
        if (!code || !(qty > 0)) return;
        const key = `${code}|${s}`;
        const m = masterOf(code) || {};
        const cur = need.get(key) || { code, site: s, name: m.name || code, category: m.category || '', unit: m.unit || '', spec: m.spec || '', supplier: m.supplier || '', need: 0, firstDate: date, by: new Set() };
        cur.need = round3(cur.need + qty);
        if (date && (!cur.firstDate || date < cur.firstDate)) cur.firstDate = date;
        if (by) cur.by.add(by);
        need.set(key, cur);
    };
    const lines = prodLines.filter(l => (!site || l.site === site) && l.status !== 'HOLD' && l.code && Number(l.qty) > 0);
    for (const l of lines) {
        const qty = Number(l.qty) - (l.status === 'DONE' ? Number(l.qty) : 0); // 완료된 줄은 이미 재고에 반영됨
        if (!(qty > 0)) continue;
        if (l.type === '원액') {
            // 원액 생산 → 원료 소요 (보안 시방서, 품목코드가 연결된 원료만)
            if (!recipes) { noRecipe.push(l); continue; }
            const cands = recipes.filter(r => r.productItemCode === l.code && r.active !== false && !r.archived);
            const r = cands[0];
            if (!r || !(Number(r.baseLiters) > 0)) { noRecipe.push(l); continue; }
            const factor = qty / Number(r.baseLiters);
            (r.materials || []).forEach(mt => { if (mt.itemCode && Number(mt.liters) > 0) add(mt.itemCode, round3(Number(mt.liters) * factor), l.site, l.date, null); });
            continue;
        }
        const b = boms[l.code];
        if (!b || (!(b.rawList || []).length && !(b.subList || []).length)) { missingBom.push(l); continue; }
        [...(b.rawList || []), ...(b.subList || [])].forEach(x => add(x.code, round3(Number(x.rate) * qty), l.site, l.date, l.name || l.code));
    }
    const rows = [...need.values()].map(r => {
        const stock = ledgerStock(r.code, r.site);
        // 같은 기간에 이미 계획된 공급: 원액 생산계획 줄 + 구매계획 줄(입고완료 제외 — 입고되면 재고에 들어감)
        const plannedProd = prodLines.filter(l => l.type === '원액' && l.code === r.code && l.site === r.site && l.status !== 'HOLD' && l.status !== 'DONE').reduce((s, l) => s + (Number(l.qty) || 0), 0);
        const plannedBuy = purchLines.filter(l => l.code === r.code && l.site === r.site && l.status !== 'HOLD' && l.status !== 'RECEIVED').reduce((s, l) => s + (Number(l.qty) || 0), 0);
        const short = round3(r.need - stock.qty - plannedProd - plannedBuy);
        return {
            ...r, by: [...r.by], stock: stock.qty, stockFrom: stock.from, plannedProd: round3(plannedProd), plannedBuy: round3(plannedBuy),
            short: short > 0 ? short : 0, others: otherSitesStock(r.code, r.site),
            target: r.category === '원액' ? 'PROD' : 'PURCH' // 원액은 원액생산계획, 원료·부자재는 구매계획
        };
    }).sort((a, b) => (b.short > 0) - (a.short > 0) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'ko'));
    return { rows, missingBom, noRecipe };
};

// ---------- 제품 안전재고 부족 ----------
// 대시보드와 같은 기준: 완제품 중 안전재고(품목 마스터 safety) > 0 이고 모든 창고 합계 재고 ≤ 안전재고.
// planned: 넘겨받은 생산계획 줄 중 그 품목의 미완료 계획 수량 → 제안 수량 = 안전재고 − 재고 − 계획 (0 이하면 이미 계획됨)
export const safetyShortages = (prodLines = []) => state.master
    .filter(m => m.category === '완제품' && Number(m.safety) > 0)
    .map(m => {
        const stock = round3(state.inventory.filter(i => i.code === m.code).reduce((s, i) => s + (Number(i.quantity) || 0), 0));
        if (stock > Number(m.safety)) return null;
        const planned = round3(prodLines.filter(l => l.code === m.code && l.status !== 'DONE' && l.status !== 'HOLD').reduce((s, l) => s + (Number(l.qty) || 0), 0));
        const need = round3(Number(m.safety) - stock);
        return {
            code: m.code, name: m.name, spec: m.spec && m.spec !== '-' ? m.spec : '', unit: m.unit || 'EA', safety: Number(m.safety), stock, planned,
            need, suggest: Math.max(0, Math.ceil(need - planned)), bySite: PLAN_SITES.map(s => ({ site: s, qty: ledgerStock(m.code, s).qty }))
        };
    })
    .filter(Boolean)
    .sort((a, b) => b.suggest - a.suggest || a.name.localeCompare(b.name, 'ko'));

// 줄들을 날짜가 속한 주의 주간 계획에 넣는다 (주별로 저장)
export const addLinesToWeeks = async (kind, lines) => {
    const byWeek = new Map();
    lines.forEach(l => { const w = weekStart(l.date); if (!byWeek.has(w)) byWeek.set(w, []); byWeek.get(w).push(l); });
    for (const [w, ls] of byWeek) {
        const doc = await loadWeek(kind, w);
        doc.lines = [...(doc.lines || []), ...ls.map(l => ({ id: newLineId(), ...l }))]
            .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        await savePlan(doc);
    }
    return [...byWeek.keys()];
};

// 월간 화면에서 고친 줄을 주간 계획에 되돌려 저장한다.
// keepFn(line): 월간 화면에서 편집 대상이 아닌 줄(다른 달·다른 거점)은 그대로 둔다. edited: 편집한 그 달의 줄 전체.
export const saveMonthLines = async (kind, ym, edited, keepFn) => {
    const weeks = new Set([...monthWeeks(ym), ...edited.map(l => weekStart(l.date))]);
    const list = [...weeks].sort();
    const docs = await listPlans(kind, list[0], list[list.length - 1]);
    const changed = [];
    for (const w of list) {
        const doc = docs.find(d => d.period === w) || blankWeek(kind, w);
        const keep = (doc.lines || []).filter(l => monthOf(l.date) !== ym || keepFn(l));
        const add = edited.filter(l => weekStart(l.date) === w).map(({ week, ...l }) => l);
        const next = [...keep, ...add].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.site).localeCompare(String(b.site)));
        if (JSON.stringify(next) === JSON.stringify(doc.lines || [])) continue;
        if (next.length === 0 && !doc.createdAt) continue;
        doc.lines = next;
        await savePlan(doc);
        changed.push(w);
    }
    return changed;
};

// 부족분을 주간 계획에 반영 (같은 품목·거점의 '부족 연동' 줄이 있으면 수량을 더함). 주별로 나눠 저장.
// kind: 'PROD_WEEK'(원액 생산) | 'PURCH_WEEK'(구매)
export const applyShortages = async (kind, shortRows) => {
    const byWeek = new Map();
    shortRows.filter(r => r.short > 0).forEach(r => {
        const w = weekStart(r.firstDate || localDateStr());
        if (!byWeek.has(w)) byWeek.set(w, []);
        byWeek.get(w).push(r);
    });
    let count = 0;
    for (const [w, rows] of byWeek) {
        const doc = await loadWeek(kind, w);
        doc.lines = doc.lines || [];
        rows.forEach(r => {
            const qty = kind === 'PURCH_WEEK' ? Math.ceil(r.short) : round3(r.short);
            const date = r.firstDate && r.firstDate >= w ? r.firstDate : w;
            // ref가 있으면(생산스케줄 줄·품목) 같은 ref 줄의 수량을 지금 부족량으로 맞춘다 → 여러 번 눌러도 쌓이지 않음
            const byRef = r.ref && doc.lines.find(l => l.ref === r.ref && l.status !== 'DONE' && l.status !== 'RECEIVED');
            const ex = byRef || (!r.ref && doc.lines.find(l => l.source === 'SHORT' && !l.ref && l.code === r.code && l.site === r.site && l.status !== 'DONE' && l.status !== 'RECEIVED'));
            if (byRef) { byRef.qty = qty; byRef.note = `${r.note || '부족분 자동 반영'} (${localDateStr()} 갱신)`; }
            else if (ex) { ex.qty = round3(Number(ex.qty) + qty); ex.note = `부족분 자동 반영 (${localDateStr()} 갱신)`; }
            else {
                doc.lines.push(kind === 'PROD_WEEK'
                    ? { id: newLineId(), date, site: r.site, type: '원액', code: r.code, name: r.name, spec: r.spec, qty, unit: r.unit || 'L', line: '', partner: '', due: r.firstDate || '', source: 'SHORT', ...(r.ref ? { ref: r.ref } : {}), status: 'PLAN', note: r.note || '부족분 자동 반영 (원액 재고 부족)' }
                    : { id: newLineId(), date, site: r.site, code: r.code, name: r.name, spec: r.spec, qty, unit: r.unit || 'EA', supplier: r.supplier || '', needDate: r.firstDate || '', eta: '', source: 'SHORT', ...(r.ref ? { ref: r.ref } : {}), status: 'PLAN', note: r.note || `부족분 자동 반영${r.category === '원료' ? ' (원액 생산용 원료)' : ''}` });
            }
            count++;
        });
        await savePlan(doc);
    }
    return { count, weeks: [...byWeek.keys()] };
};
