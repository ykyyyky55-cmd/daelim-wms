// ==========================================
// IBC(공토트) · 유종별 전용 공토트 · IBC 탱크 대장 (supabase/auth/56_ibc_totes.sql)
// ==========================================
// 품목: 990001 IBC(공토트) = 용도 없는 공토트, 990001-n IBC(공토트)(유종) = 그 유종 전용 공토트
//   한 번 어떤 유종의 원액을 담은 IBC는 계속 같은 유종만 담는다 (비면 그 유종 공토트로 돌아옴).
// 흐름
//   1) 원액을 IBC에 담아 생산 입고: 그 유종 공토트를 먼저, 없으면 990001을 IBC 개수만큼 차감 + 탱크 대장에 등록 (planToteUse → registerFill)
//   2) 완제품 등 생산에 원액 투입: 같은 원액을 담은 IBC를 먼저 채운 것부터 남은 양 차감, 0이 되면 '비움' + 그 유종 공토트 1개 입고 (consumeBlend)
//   3) IBC 관리 화면의 [비움] (emptyTank)
// 로컬 모드는 localStorage(daelim_ibc_tanks).
import { state, processStockAction } from './db.js';
import { getSupabase, isSupabaseConfigured } from './supabase.js';

export const TOTE_BASE = '990001';
export const TOTE_NAME = 'IBC(공토트)';
export const IBC_LITERS = 1000;
// 유종 = 원액 품목코드 2~3번째 글자 (완제품·원액 공통 분류). 순서가 곧 -1, -2 … 번호.
export const OIL_TYPES = [
    { key: 'AA', label: '엔진오일', re: /엔진오일|\d+W-?\d+|2T|4T|SAE/i },
    { key: 'AB', label: '엔진코팅제', re: /코팅제|ATF 첨가제/ },
    { key: 'AC', label: '연료첨가제', re: /연료첨가제|옥탄|세탄|수분제거|엔진시스템|클리너 가솔린|클리너 디젤|부스터/ },
    { key: 'AD', label: 'DPF 클리너', re: /DPF/i },
    { key: 'AE', label: '요소수 첨가제', re: /요소수|SCR/i },
    { key: 'AF', label: '방청윤활제', re: /방청/ },
    { key: 'AG', label: '부동액', re: /부동액/ },
    { key: 'AH', label: '브레이크액', re: /브레이크액|DOT/i },
    { key: 'AJ', label: '세정제·기타', re: /세척제|세정제|녹 ?제거|철분/ }
].map((t, i) => ({ ...t, code: `${TOTE_BASE}-${i + 1}`, name: `${TOTE_NAME}(${t.label})` }));
const BY_KEY = Object.fromEntries(OIL_TYPES.map(t => [t.key, t]));
const OTHER = BY_KEY.AJ;

export const isToteCode = (code) => code === TOTE_BASE || /^990001-\d+$/.test(String(code || ''));
export const oilTypeByTote = (code) => OIL_TYPES.find(t => t.code === code) || null;
/** 원액 → 유종 (품목코드 분류 글자, 없으면 품명 낱말, 그래도 없으면 세정제·기타) */
export const oilTypeOf = (blendCode, blendName = '') => {
    const m = String(blendCode || '').match(/^\d(A[A-Z])/);
    if (m && BY_KEY[m[1]]) return BY_KEY[m[1]];
    const name = blendName || state.master.find(x => x.code === blendCode)?.name || '';
    return OIL_TYPES.find(t => t.re.test(name)) || OTHER;
};
export const isIbcPack = (packaging) => /IBC|토트|TOTE/i.test(String(packaging || ''));
export const ibcCountOf = (liters) => Math.max(1, Math.ceil((Number(liters) || 0) / IBC_LITERS));

const siteOf = (loc) => String(loc || '').split(' / ')[0];
const stockAt = (code, loc) => state.inventory.filter(i => i.code === code && i.location === loc).reduce((s, i) => s + (Number(i.quantity) || 0), 0);

/**
 * IBC n개에 원액을 담을 때 차감할 공토트: 그 유종 공토트를 먼저, 모자라면 990001(용도 없음)
 * @returns { type, rows: [{ code, name, qty }], short } — short = 재고가 모자라 차감하지 못하는 개수
 */
export const planToteUse = (blendCode, blendName, location, n) => {
    const type = oilTypeOf(blendCode, blendName);
    let need = Math.max(0, Math.round(Number(n) || 0));
    const rows = [];
    const own = Math.min(need, stockAt(type.code, location));
    if (own > 0) { rows.push({ code: type.code, name: type.name, qty: own }); need -= own; }
    const base = Math.min(need, stockAt(TOTE_BASE, location));
    if (base > 0) { rows.push({ code: TOTE_BASE, name: TOTE_NAME, qty: base }); need -= base; }
    return { type, rows, short: need };
};

// ---------- 탱크 대장 ----------
const LOCAL_KEY = 'daelim_ibc_tanks';
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const saveLocal = (list) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(-3000))); } catch { /* 저장 불가 */ } };
const fromRow = (r) => ({
    id: r.id, toteCode: r.tote_code, oilType: r.oil_type, blendCode: r.blend_code, blendName: r.blend_name || '', lot: r.lot || '',
    location: r.location, filledQty: Number(r.filled_qty) || 0, remaining: Number(r.remaining) || 0, status: r.status || 'FILLED',
    filledAt: r.filled_at, emptiedAt: r.emptied_at || '', source: r.source || '', notes: r.notes || '', createdBy: r.created_by || ''
});
const toRow = (t) => ({
    id: t.id, tote_code: t.toteCode, oil_type: t.oilType, blend_code: t.blendCode, blend_name: t.blendName || null, lot: t.lot || null,
    location: t.location, filled_qty: Number(t.filledQty) || 0, remaining: Math.max(0, Number(t.remaining) || 0), status: t.status || 'FILLED',
    filled_at: t.filledAt || new Date().toISOString(), emptied_at: t.emptiedAt || null, source: t.source || null, notes: t.notes || null,
    created_by: t.createdBy || null, updated_at: new Date().toISOString()
});
const fail = (e, what) => {
    const msg = e?.message || String(e);
    if (/wms_ibc_tanks/.test(msg) && /exist/.test(msg)) throw new Error(`${what} 실패: IBC 대장 DB 설정(56_ibc_totes.sql)이 적용되지 않았습니다.`);
    if (/row-level security|permission/i.test(msg)) throw new Error(`${what} 권한이 없습니다 (현장 작업자 이상).`);
    throw new Error(`${what} 실패: ${msg}`);
};

export const listTanks = async ({ status = '' } = {}) => {
    const sb = cloud();
    if (sb) {
        const all = [];
        for (let from = 0; ; from += 1000) {
            let q = sb.from('wms_ibc_tanks').select('*').order('filled_at', { ascending: true }).range(from, from + 999);
            if (status) q = q.eq('status', status);
            const { data, error } = await q;
            if (error) fail(error, 'IBC 대장 조회');
            all.push(...(data || []).map(fromRow));
            if (!data || data.length < 1000) break;
        }
        return all;
    }
    return loadLocal().map(fromRow).filter(t => !status || t.status === status).sort((a, b) => String(a.filledAt).localeCompare(String(b.filledAt)));
};

const saveTanks = async (tanks) => {
    if (!tanks.length) return;
    const rows = tanks.map(toRow);
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_ibc_tanks').upsert(rows, { onConflict: 'id' });
        if (error) fail(error, 'IBC 대장 저장');
        return;
    }
    const list = loadLocal();
    rows.forEach(r => { const i = list.findIndex(x => x.id === r.id); if (i >= 0) list[i] = r; else list.push(r); });
    saveLocal(list);
};

export const deleteTank = async (id) => {
    const sb = cloud();
    if (sb) { const { error } = await sb.from('wms_ibc_tanks').delete().eq('id', id); if (error) fail(error, 'IBC 대장 삭제'); return; }
    saveLocal(loadLocal().filter(x => x.id !== id));
};

const newId = () => `IBC-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const who = () => state.currentGlobalWorker || state.currentUser?.name || '';

/**
 * 원액을 IBC에 담은 기록 (IBC count개에 liters를 1,000L씩 나눠 담음)
 * @returns 만든 탱크 목록
 */
export const registerFill = async ({ blendCode, blendName = '', lot = '', location, liters, count = 0, source = '', notes = '', at = '' }) => {
    const type = oilTypeOf(blendCode, blendName);
    const n = count > 0 ? Math.round(count) : ibcCountOf(liters);
    let left = Number(liters) || 0;
    const base = at && /^\d{4}-\d{2}-\d{2}$/.test(at) ? new Date(`${at}T18:00:00`).getTime() : Date.now();
    const tanks = Array.from({ length: n }, (_, i) => {
        const q = i === n - 1 ? Math.max(0, left) : Math.min(IBC_LITERS, left);
        left -= q;
        return {
            id: newId() + i, toteCode: type.code, oilType: type.key, blendCode, blendName: blendName || state.master.find(m => m.code === blendCode)?.name || blendCode,
            lot, location, filledQty: Math.round(q * 1000) / 1000, remaining: Math.round(q * 1000) / 1000, status: 'FILLED',
            filledAt: new Date(base + i).toISOString(), source, notes, createdBy: who()
        };
    });
    await saveTanks(tanks);
    return tanks;
};

// 비운 IBC → 그 유종 공토트 1개 입고
const returnTote = async (t, reason) => {
    const type = oilTypeByTote(t.toteCode) || BY_KEY[t.oilType] || OTHER;
    await processStockAction({
        type: 'IN', code: type.code, qty: 1, location: t.location, worker: who(), ledgerType: '회수',
        reason: `[IBC 비움] ${t.blendName} ${t.lot ? `LOT ${t.lot} ` : ''}→ ${type.name} 회수${reason ? ` (${reason})` : ''}`
    });
};

/**
 * 원액 사용 → 같은 원액을 담은 IBC를 먼저 채운 것부터 차감. 0이 된 IBC는 비움 처리 + 유종 공토트 회수.
 * @returns { emptied: [탱크], used: 대장에서 뺀 양, unmatched: 대장에 없어 못 뺀 양, errors: [] }
 */
export const consumeBlend = async ({ blendCode, location, qty, reason = '' }) => {
    let left = Number(qty) || 0;
    const res = { emptied: [], used: 0, unmatched: 0, errors: [] };
    if (left <= 0) return res;
    const open = (await listTanks({ status: 'FILLED' })).filter(t => t.blendCode === blendCode);
    // 같은 위치 먼저, 그다음 같은 거점
    const order = [...open.filter(t => t.location === location), ...open.filter(t => t.location !== location && siteOf(t.location) === siteOf(location))];
    const changed = [];
    for (const t of order) {
        if (left <= 0) break;
        const take = Math.min(left, t.remaining);
        t.remaining = Math.round((t.remaining - take) * 1000) / 1000;
        left = Math.round((left - take) * 1000) / 1000;
        res.used += take;
        if (t.remaining <= 0.5) { t.remaining = 0; t.status = 'EMPTY'; t.emptiedAt = new Date().toISOString(); res.emptied.push(t); }
        changed.push(t);
    }
    res.unmatched = Math.max(0, left);
    await saveTanks(changed);
    for (const t of res.emptied) {
        try { await returnTote(t, reason); } catch (e) { res.errors.push(`${t.blendName}: 공토트 회수 실패 (${e.message})`); }
    }
    return res;
};

/** [비움] 버튼: 남은 양과 상관없이 비움 처리 + 공토트 회수 */
export const emptyTank = async (t, reason = '수동 비움') => {
    const next = { ...t, remaining: 0, status: 'EMPTY', emptiedAt: new Date().toISOString(), notes: [t.notes, reason].filter(Boolean).join(' · ') };
    await saveTanks([next]);
    await returnTote(next, reason);
    return next;
};

/** 남은 양 고치기 (실측) */
export const setRemaining = async (t, liters) => {
    const next = { ...t, remaining: Math.max(0, Number(liters) || 0) };
    await saveTanks([next]);
    return next;
};

/** 공토트 재고 요약: [{ code, name, label, bySite: { 거점: 수량 }, total }] */
export const toteStock = () => {
    const codes = [{ code: TOTE_BASE, name: TOTE_NAME, label: '용도 없음' }, ...OIL_TYPES.map(t => ({ code: t.code, name: t.name, label: t.label }))];
    return codes.map(c => {
        const bySite = {};
        state.inventory.filter(i => i.code === c.code).forEach(i => { const s = siteOf(i.location); bySite[s] = (bySite[s] || 0) + (Number(i.quantity) || 0); });
        return { ...c, bySite, total: Object.values(bySite).reduce((a, b) => a + b, 0) };
    });
};
