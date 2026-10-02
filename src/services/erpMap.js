// ==========================================
// ECOUNT ERP 코드 대응표 (품목 및 재고관리 → ERP 코드 대응표, components/ErpMap.js, DB supabase/auth/63_erp_map.sql)
// ==========================================
// ERP 연동 1단계(준비): WMS 품목·거래처·창고를 ECOUNT 코드와 1:1로 짝짓고 단위 환산을 정한다.
// - ECOUNT 목록: ECOUNT 화면에서 내려받은 엑셀(품목등록·거래처등록·창고등록 목록)을 올린다 (parseErpWorkbook).
//   코드·이름·규격·단위만 저장하고 단가·사업자번호 같은 다른 칸은 버린다.
// - 대응 행: { kind, wmsKey, wmsName, erpCode, erpName, status(MATCHED·NO_SEND·PENDING), erpUnit, conv(SAME·SG·FACTOR), factor, note }
//   품목 wmsKey = 품목코드, 거래처 = 이름 정규화(partnerNorm), 창고 = 위치("거점 / 창고코드" 또는 거점만)
// - 추천(suggest): 코드 같음 100 → 이름(+규격) 같음 90 → 글자 비슷함(2글자 조각 겹침) 순.
// 원료코드(보안)·배합은 다루지 않는다.
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state, latestRawSg, listSlipsRange, ledgerKindOfCategory } from './db.js';
import { listPlans } from './plans.js';
import { localDateStr } from './searchUtils.js';
import { LAYOUT_LOCATIONS, DEFAULT_SITES, warehouseDesc, buildingOf, siteOf } from './locations.js';
import { classifyRawEntry, supplierOf } from '../components/analytics/rawInbound.js';

export const ERP_KINDS = { ITEM: '품목', PARTNER: '거래처', WAREHOUSE: '창고' };
export const MAP_STATUS = { MATCHED: '대응', NO_SEND: '보내지 않음', PENDING: '미정' };
export const CONV_TYPES = { SAME: '같은 단위', SG: '비중 환산 (kg = L × 비중)', FACTOR: '배수 (1 WMS 단위 = n ERP 단위)' };
const MASTER_TABLE = 'wms_erp_master';
const MAP_TABLE = 'wms_erp_map';
const LOCAL_MASTER = 'daelim_erp_master';
const LOCAL_MAP = 'daelim_erp_map';
const BATCH = 500;

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readLocal = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { throw new Error('이 기기의 저장 공간이 부족합니다.'); } };
const myName = () => state.currentUser?.name || state.currentGlobalWorker || '';
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return localDateStr(x); };

// ---------- 글자 맞추기 ----------
export const normText = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s·.,_\-/()[\]{}]/g, '');
/** 거래처 이름 정규화: (주)·주식회사·㈜·유한회사 등과 공백·기호를 뗀다 */
export const partnerNorm = (s) => normText(String(s || '').normalize('NFKC').replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(합\)|합자회사|co\.?,?\s*ltd\.?|inc\.?/gi, ''));
const bigrams = (s) => { const out = new Map(); for (let i = 0; i < s.length - 1; i += 1) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; };
/** 0~1 글자 비슷함 (Dice) */
export const similarity = (a, b) => {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return a.includes(b) || b.includes(a) ? 0.5 : 0;
    const A = bigrams(a), B = bigrams(b);
    let inter = 0;
    A.forEach((n, g) => { inter += Math.min(n, B.get(g) || 0); });
    return (2 * inter) / (a.length - 1 + b.length - 1);
};

// ---------- 저장소 ----------
const masterFromRow = (r) => ({ kind: r.kind, code: r.code, name: r.name || '', spec: r.spec || '', unit: r.unit || '', importedAt: r.imported_at, importedBy: r.imported_by_name || '' });
const mapFromRow = (r) => ({ id: r.id, kind: r.kind, wmsKey: r.wms_key, wmsName: r.wms_name || '', erpCode: r.erp_code || '', erpName: r.erp_name || '', status: r.status || 'PENDING', ...(r.data || {}), updatedBy: r.updated_by_name || '', updatedAt: r.updated_at });
const mapToRow = (m) => ({
    id: `${m.kind}:${m.wmsKey}`, kind: m.kind, wms_key: m.wmsKey, wms_name: m.wmsName || '', erp_code: String(m.erpCode || '').trim(), erp_name: m.erpName || '',
    status: m.status || 'PENDING', data: { erpUnit: m.erpUnit || '', conv: m.conv || 'SAME', factor: m.factor === '' || m.factor == null ? '' : Number(m.factor), note: m.note || '' },
    updated_by_name: myName(), updated_at: new Date().toISOString()
});
const fetchAll = async (sb, table) => {
    const all = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from(table).select('*').range(from, from + 999);
        if (error) throw new Error(`대응표를 불러오지 못했습니다: ${error.message}`);
        all.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    return all;
};

/** ECOUNT 목록 + 대응 행 */
export const loadErpData = async () => {
    const sb = cloud();
    if (sb) {
        const [masters, maps] = await Promise.all([fetchAll(sb, MASTER_TABLE), fetchAll(sb, MAP_TABLE)]);
        return { masters: masters.map(masterFromRow), maps: maps.map(mapFromRow) };
    }
    return { masters: readLocal(LOCAL_MASTER), maps: readLocal(LOCAL_MAP) };
};

/** 대응 행 저장 (여러 줄) */
export const saveErpMaps = async (list) => {
    if (!list.length) return;
    const rows = list.map(mapToRow);
    const sb = cloud();
    if (sb) {
        for (let i = 0; i < rows.length; i += BATCH) {
            const { error } = await sb.from(MAP_TABLE).upsert(rows.slice(i, i + BATCH), { onConflict: 'id' });
            if (error) throw new Error(/row-level security|permission/i.test(error.message) ? '대응표 저장은 매니저 이상만 할 수 있습니다.' : `대응표를 저장하지 못했습니다: ${error.message}`);
        }
        return;
    }
    const byId = new Map(readLocal(LOCAL_MAP).map(m => [`${m.kind}:${m.wmsKey}`, m]));
    rows.forEach(r => byId.set(r.id, mapFromRow(r)));
    writeLocal(LOCAL_MAP, [...byId.values()]);
};

/** ECOUNT 목록 바꾸기 (그 종류 전체를 새 목록으로) */
export const replaceErpMaster = async (kind, list) => {
    const now = new Date().toISOString();
    const rows = [...new Map(list.map(x => [x.code, x])).values()].map(x => ({ id: `${kind}:${x.code}`, kind, code: x.code, name: x.name || '', spec: x.spec || '', unit: x.unit || '', imported_at: now, imported_by_name: myName() }));
    const sb = cloud();
    if (sb) {
        const { error: delErr } = await sb.from(MASTER_TABLE).delete().eq('kind', kind);
        if (delErr) throw new Error(/row-level security|permission/i.test(delErr.message) ? 'ECOUNT 목록 올리기는 매니저 이상만 할 수 있습니다.' : `이전 목록을 지우지 못했습니다: ${delErr.message}`);
        for (let i = 0; i < rows.length; i += BATCH) {
            const { error } = await sb.from(MASTER_TABLE).insert(rows.slice(i, i + BATCH));
            if (error) throw new Error(`ECOUNT 목록을 올리지 못했습니다: ${error.message}`);
        }
        return rows.length;
    }
    writeLocal(LOCAL_MASTER, [...readLocal(LOCAL_MASTER).filter(m => m.kind !== kind), ...rows.map(masterFromRow)]);
    return rows.length;
};

// ---------- ECOUNT 엑셀 읽기 ----------
const HEAD = {
    ITEM: { code: /^품목코드$|^품목\s*코드$|PROD_CD/i, name: /^품목명$|^품명$|PROD_DES/i },
    PARTNER: { code: /^거래처코드$|^거래처\s*코드$|CUST(_CD)?$/i, name: /^거래처명$|^상호|CUST_DES/i },
    WAREHOUSE: { code: /^창고코드$|^창고\s*코드$|WH_CD/i, name: /^창고명$|WH_DES/i }
};
/**
 * ECOUNT 목록 엑셀 → { kind, rows: [{code,name,spec,unit}], skipped }
 * 머리줄(처음 15줄 안)의 '품목코드'·'거래처코드'·'창고코드' 글자로 종류와 칸을 찾는다.
 */
export const parseErpWorkbook = (XLSX, wb) => {
    for (const sheetName of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: false });
        for (let h = 0; h < Math.min(15, aoa.length); h += 1) {
            const head = aoa[h].map(v => String(v).trim());
            for (const [kind, re] of Object.entries(HEAD)) {
                const ci = head.findIndex(v => re.code.test(v));
                if (ci < 0) continue;
                let ni = head.findIndex(v => re.name.test(v));
                if (ni < 0) ni = head.findIndex((v, i) => i !== ci && /명$/.test(v));
                const si = head.findIndex(v => /^규격/.test(v));
                const ui = head.findIndex(v => /^단위$|^단위명|UNIT/i.test(v));
                const rows = [];
                let skipped = 0;
                aoa.slice(h + 1).forEach(r => {
                    const code = String(r[ci] ?? '').trim();
                    if (!code || /^합계|^계$/.test(code)) { skipped += 1; return; }
                    rows.push({ code, name: ni >= 0 ? String(r[ni] ?? '').trim() : '', spec: si >= 0 ? String(r[si] ?? '').trim() : '', unit: ui >= 0 ? String(r[ui] ?? '').trim() : '' });
                });
                return { kind, sheetName, rows, skipped };
            }
        }
    }
    throw new Error("ECOUNT 목록의 머리줄을 찾지 못했습니다. '품목코드'·'거래처코드'·'창고코드' 칸이 있는 엑셀인지 확인하세요.");
};

// ---------- WMS 쪽 대상 ----------
/** 임시코드 품목 (ERP 연동 전 정리): 0000-·HRAW- 코드, 분류 '미확정/임시' */
export const isTempItem = (m) => /^0000-|^HRAW-|^TMP|^TM[A-Z0-9]{4}$/i.test(String(m.code || '')) || /미확정|임시/.test(String(m.category || ''));

/** 품목 대상: 품목마스터 전체 + 사용량(재고·최근 1년 수불부 전표 수) */
export const wmsItems = () => {
    const since = addDays(localDateStr(), -365);
    const inv = new Map();
    (state.inventory || []).forEach(i => inv.set(i.code, (inv.get(i.code) || 0) + (Number(i.quantity) || 0)));
    const uses = new Map();
    const byName = new Map(state.master.map(m => [m.name, m.code]));
    const bump = (code) => { if (code) uses.set(code, (uses.get(code) || 0) + 1); };
    const counts = (e) => e.date >= since && !String(e.id || '').startsWith('INIT-'); // 최초 이관 '이월' 전표는 거래가 아님
    (state.rawLedger || []).forEach(e => { if (counts(e)) bump(e.code || byName.get(e.name)); });
    (state.productLedger || []).forEach(e => { if (counts(e)) bump(e.code); });
    (state.materialLedger || []).forEach(e => { if (counts(e)) bump(e.code); });
    return state.master.map(m => {
        const kind = ledgerKindOfCategory(m.category);
        return {
            key: m.code, code: m.code, name: m.name || '', spec: m.spec || '', category: m.category || '', unit: m.unit || (kind === 'raw' ? 'L' : 'EA'),
            stock: Math.round((inv.get(m.code) || 0) * 1000) / 1000, uses: uses.get(m.code) || 0, temp: isTempItem(m),
            sg: kind === 'raw' ? latestRawSg(m.code, m.name) : null
        };
    }).map(x => ({ ...x, active: x.stock !== 0 || x.uses > 0 }));
};

const INTERNAL_PARTNER = /대림|자사|임시|미기재|미확정|^-$|^$/;
/** 거래처 대상: 출고요청서·생산요청서(판매) + 원료 매입 입고·구매요청서 공급처·품목 공급처(구매), 최근 1년 */
export const wmsPartners = async () => {
    const today = localDateStr();
    const since = addDays(today, -365);
    const [slips, preqs, reqs] = await Promise.all([
        listSlipsRange({ from: since }).catch(() => []),
        listPlans('PURCH_REQ', since, '9999').catch(() => []),
        listPlans('PROD_REQ', since, '9999').catch(() => [])
    ]);
    const map = new Map();
    const add = (name, side, when = '') => {
        const raw = String(name || '').trim();
        if (!raw || raw === '외부 거래처' || INTERNAL_PARTNER.test(raw)) return;
        const key = partnerNorm(raw);
        if (!key) return;
        if (!map.has(key)) map.set(key, { key, name: raw, names: new Set(), sale: 0, buy: 0, last: '' });
        const p = map.get(key);
        p.names.add(raw); p[side] += 1;
        if (when > p.last) p.last = when;
    };
    slips.filter(s => s.type === 'RELEASE').forEach(s => add(s.partner, 'sale', s.date));
    reqs.forEach(r => add(r.partner, 'sale', r.reqDate || r.period));
    preqs.forEach(r => (r.lines || []).forEach(l => add(l.supplier, 'buy', r.reqDate || r.period)));
    (state.rawLedger || []).filter(e => e.date >= since && classifyRawEntry(e) === 'BUY').forEach(e => add(supplierOf(e), 'buy', e.date));
    state.master.filter(m => ['원료', '부자재'].includes(m.category)).forEach(m => add(m.supplier, 'buy'));
    return [...map.values()].map(p => ({ ...p, names: [...p.names], uses: p.sale + p.buy, active: true }));
};

/** 창고 대상: 구성 창고 14개 + 거점 대표(창고 미지정 재고) */
export const wmsWarehouses = () => {
    const inv = new Map();
    (state.inventory || []).forEach(i => { if (Number(i.quantity)) inv.set(i.location, (inv.get(i.location) || 0) + 1); });
    return [
        ...LAYOUT_LOCATIONS.map(loc => ({ key: loc, code: buildingOf(loc), name: warehouseDesc(buildingOf(loc)), site: siteOf(loc), uses: inv.get(loc) || 0 })),
        ...DEFAULT_SITES.map(site => ({ key: site, code: site, name: `${site} (창고 미지정)`, site, uses: inv.get(site) || 0 }))
    ].map(w => ({ ...w, active: true }));
};

// ---------- 추천 ----------
/**
 * ECOUNT 목록에서 가장 알맞은 후보 (점수 순 최대 n개)
 * @returns {{ code: string, name: string, spec: string, unit: string, score: number }[]}
 */
// ECOUNT 목록을 정규화해 둔다 (목록 배열이 같으면 다시 계산하지 않음)
const prepCache = new WeakMap();
const prepared = (masters, kind) => {
    let byKind = prepCache.get(masters);
    if (!byKind) { byKind = {}; prepCache.set(masters, byKind); }
    if (!byKind[kind]) {
        byKind[kind] = masters.filter(m => m.kind === kind).map(m => {
            const nName = kind === 'PARTNER' ? partnerNorm(m.name) : normText(m.name);
            const full = kind === 'ITEM' ? nName + normText(m.spec) : kind === 'WAREHOUSE' ? normText(`${m.code} ${m.name}`) : nName;
            return { m, nCode: normText(m.code), nName, nSpec: normText(m.spec), full, grams: bigrams(kind === 'WAREHOUSE' ? nName : full), len: Math.max(0, (kind === 'WAREHOUSE' ? nName : full).length - 1) };
        });
    }
    return byKind[kind];
};
const diceWith = (s, grams, len) => {
    if (!s || s.length < 2 || !len) return 0;
    const A = bigrams(s);
    let inter = 0;
    A.forEach((n, g) => { inter += Math.min(n, grams.get(g) || 0); });
    return (2 * inter) / (s.length - 1 + len);
};

export const suggest = (kind, target, masters, n = 3) => {
    const list = prepared(masters, kind);
    if (!list.length) return [];
    const tCode = normText(target.code), tName = kind === 'PARTNER' ? target.key : normText(target.name), tSpec = normText(target.spec);
    const scored = list.map(p => {
        let score = 0;
        if (kind === 'ITEM') {
            if (tCode && p.nCode === tCode) score = 100;
            else if (tName && tName === p.nName) score = !tSpec || !p.nSpec || tSpec === p.nSpec ? 90 : 80;
            else score = Math.round(diceWith(tName + tSpec, p.grams, p.len) * 85);
        } else if (kind === 'PARTNER') {
            score = tName === p.nName ? 95 : p.nCode === tName ? 90 : tName && p.nName && (tName.includes(p.nName) || p.nName.includes(tName)) ? 75 : Math.round(diceWith(tName, p.grams, p.len) * 80);
        } else {
            score = p.full.includes(tCode) ? 95 : p.full.includes(tName) ? 85 : Math.round(diceWith(tName, p.grams, p.len) * 70);
        }
        return { code: p.m.code, name: p.m.name, spec: p.m.spec, unit: p.m.unit, score };
    }).filter(x => x.score >= 40);
    return scored.sort((a, b) => b.score - a.score).slice(0, n);
};

/** 단위 환산 설명 (예: '1 L = 0.872 kg (최신 비중)') */
export const convText = (wmsUnit, m, sg) => {
    if (!m?.erpUnit || m.conv === 'SAME' || !m.conv) return m?.erpUnit && m.erpUnit !== wmsUnit ? `⚠ 단위 다름 (${wmsUnit} ↔ ${m.erpUnit}) — 환산을 정하세요` : '';
    if (m.conv === 'SG') return sg ? `1 ${wmsUnit} = ${Math.round(sg * 1000) / 1000} ${m.erpUnit} (최신 비중)` : '⚠ 비중 기록 없음 — 원료수불부 비중을 넣으세요';
    return Number(m.factor) > 0 ? `1 ${wmsUnit} = ${m.factor} ${m.erpUnit}` : '⚠ 배수를 넣으세요';
};

/** 종류별 대응률 (active 대상만) */
export const mapStats = (targets, mapById, kind) => {
    const act = targets.filter(t => t.active);
    const st = (t) => mapById.get(`${kind}:${t.key}`)?.status || 'PENDING';
    const matched = act.filter(t => st(t) === 'MATCHED').length;
    const noSend = act.filter(t => st(t) === 'NO_SEND').length;
    return { total: act.length, matched, noSend, pending: act.length - matched - noSend, rate: act.length ? ((matched + noSend) / act.length) * 100 : 100 };
};
