// ==========================================
// 창고 구획(존) 배치 — 3D 창고 배치도 (components/Warehouse3D.js, DB supabase/auth/65_warehouse_zones.sql)
// ==========================================
// · 창고 한 줄(kind WAREHOUSE, id = 창고코드): 거점 안 위치(x, z)·바닥 크기(w × d)·벽 높이(h), 단위 m
// · 구획 한 줄(kind ZONE, id = 구획코드 '김포2A-01'): 창고 왼쪽 위 모서리 기준 위치(x, z)·크기(w × d × h)·종류(랙·바닥·탱크)
// · 재고 위치 = "거점 / 구획코드"(예: "김포공장 / 김포2A-01") — 재고·이력·수불부 로직은 그대로이고,
//   같은 거점 안 이동이라 수불부·업무일지에는 기록되지 않는다.
// · 클라우드에 배치가 없으면 기본 배치(DEFAULT_LAYOUT, 실제 치수 아님 → 배치 편집으로 고침)를 쓴다.
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state, deleteLocation, processStockAction } from './db.js';
import { registerZones, normalizeLocationList, makeLocation, LOCATION_SEP } from './locations.js';

/**
 * @typedef {{ id: string, kind: 'WAREHOUSE'|'ZONE', warehouse: string, site: string, name: string,
 *   zoneType: string, x: number, z: number, w: number, d: number, h: number, sort: number, note: string }} ZoneRow
 */

const TABLE = 'wms_warehouse_zones';
const CACHE_KEY = 'daelim_wh_zones';

/** 3D 배치도 대상 창고 (김포2공장) */
export const ZONE_WAREHOUSES = [
    { code: '김포2A', site: '김포공장', label: '김포2A · A동' },
    { code: '김포2B', site: '김포공장', label: '김포2B · B동' },
    { code: '김포2C', site: '김포공장', label: '김포2C · 사무동' }
];
export const ZONE_SITE = '김포공장';
export const ZONE_TYPES = { RACK: '랙', FLOOR: '바닥 적재', TANK: '탱크', ETC: '기타' };

const lines = (warehouse, count, { x0 = 2, step = 5.5, w = 4, d = 14, h = 5 } = {}) =>
    Array.from({ length: count }, (_, i) => ({
        id: `${warehouse}-${String(i + 1).padStart(2, '0')}`, kind: 'ZONE', warehouse, site: ZONE_SITE,
        name: `${i + 1}라인`, zoneType: 'RACK', x: x0 + i * step, z: 2, w, d, h, sort: i + 1, note: ''
    }));

/** 기본 배치 (실측 전 임시값) */
export const DEFAULT_LAYOUT = [
    { id: '김포2A', kind: 'WAREHOUSE', warehouse: '김포2A', site: ZONE_SITE, name: 'A동', zoneType: 'ETC', x: 0, z: 0, w: 36, d: 18, h: 7, sort: 1, note: '' },
    { id: '김포2B', kind: 'WAREHOUSE', warehouse: '김포2B', site: ZONE_SITE, name: 'B동', zoneType: 'ETC', x: 0, z: 24, w: 36, d: 18, h: 7, sort: 2, note: '' },
    { id: '김포2C', kind: 'WAREHOUSE', warehouse: '김포2C', site: ZONE_SITE, name: '사무동', zoneType: 'ETC', x: 42, z: 0, w: 16, d: 10, h: 4, sort: 3, note: '' },
    ...lines('김포2A', 6),
    ...lines('김포2B', 6),
    { id: '김포2C-01', kind: 'ZONE', warehouse: '김포2C', site: ZONE_SITE, name: '보관 구역', zoneType: 'FLOOR', x: 2, z: 2, w: 12, d: 6, h: 2, sort: 1, note: '' }
];

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const myName = () => state.currentUser?.name || state.currentGlobalWorker || '';

/** @returns {ZoneRow} */
const fromDb = (r) => ({
    id: r.id, kind: r.kind, warehouse: r.warehouse, site: r.site || ZONE_SITE, name: r.name || '', zoneType: r.zone_type || 'RACK',
    x: num(r.x), z: num(r.z), w: num(r.w, 1), d: num(r.d, 1), h: num(r.h, 1), sort: num(r.sort), note: r.note || ''
});
const toDb = (z) => ({
    id: z.id, kind: z.kind, warehouse: z.warehouse, site: z.site || ZONE_SITE, name: z.name || '', zone_type: z.zoneType || 'RACK',
    x: num(z.x), z: num(z.z), w: num(z.w, 1), d: num(z.d, 1), h: num(z.h, 1), sort: num(z.sort), note: z.note || '',
    updated_by_name: myName(), updated_at: new Date().toISOString()
});

const readCache = () => { try { const v = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return Array.isArray(v) ? v : null; } catch { return null; } };
const writeCache = (rows) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch (e) { console.warn('구획 캐시 저장 실패', e); }
};

/** 등록된 구획을 위치 목록에 반영 (드롭다운·QR·실사에 구획이 보이게) */
const applyRegistry = (rows) => {
    registerZones(rows);
    state.locations = normalizeLocationList(state.locations || []);
};

let saved = null; // 마지막으로 클라우드(또는 기기)에 저장된 배치 — 삭제 대상 계산용

/**
 * 배치 불러오기. 클라우드 → 없으면 기기 캐시 → 없으면 기본 배치.
 * @returns {Promise<{ rows: ZoneRow[], isDefault: boolean }>}
 */
export const loadZones = async () => {
    const sb = cloud();
    let rows = null;
    if (sb) {
        const { data, error } = await sb.from(TABLE).select('*').order('sort');
        if (error) throw new Error(`구획 배치를 불러오지 못했습니다: ${error.message}`);
        rows = (data || []).map(fromDb);
        saved = rows;
    } else {
        rows = readCache();
        saved = rows || [];
    }
    const isDefault = !rows || rows.length === 0;
    const out = isDefault ? DEFAULT_LAYOUT.map(r => ({ ...r })) : rows;
    if (!isDefault) writeCache(out);
    applyRegistry(isDefault ? readCache() || [] : out);
    return { rows: out, isDefault };
};

/** 구획 위치 문자열 */
export const zoneLocation = (z) => makeLocation(z.site || ZONE_SITE, z.id);

/** 구획의 재고 행 (수량 0 제외) */
export const zoneStock = (z) => {
    const loc = zoneLocation(z);
    return (state.inventory || []).filter(i => i.location === loc && Number(i.quantity) !== 0);
};

/** 구획이 정해지지 않은 재고 (거점만 적힌 김포공장 재고 + 김포2A·2B·2C 창고 단위 재고) */
export const unassignedStock = (warehouseCode = '') => {
    const whLocs = ZONE_WAREHOUSES.filter(w => !warehouseCode || w.code === warehouseCode).map(w => makeLocation(w.site, w.code));
    const accept = new Set([ZONE_SITE, ...whLocs]); // 창고 미지정(거점만) 재고는 어느 창고를 봐도 함께
    return (state.inventory || []).filter(i => accept.has(i.location) && Number(i.quantity) > 0);
};

/** 새 구획 번호 */
export const nextZoneId = (rows, warehouse) => {
    const used = rows.filter(r => r.kind === 'ZONE' && r.warehouse === warehouse).map(r => Number(String(r.id).split('-').pop()) || 0);
    return `${warehouse}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
};

/**
 * 배치 저장 (매니저). 없어진 구획은 재고가 남아 있으면 막는다.
 * @param {ZoneRow[]} rows
 */
export const saveZones = async (rows) => {
    const ids = new Set();
    for (const r of rows) {
        if (!r.id || ids.has(r.id)) throw new Error(`구획코드가 비었거나 겹칩니다: ${r.id || '(빈 칸)'}`);
        if (String(r.id).includes('/')) throw new Error(`구획코드에는 '/'를 쓸 수 없습니다: ${r.id}`);
        if (r.kind === 'ZONE' && !String(r.id).startsWith(`${r.warehouse}-`)) throw new Error(`구획코드는 '${r.warehouse}-번호' 모양이어야 합니다: ${r.id}`);
        if (num(r.w) <= 0 || num(r.d) <= 0 || num(r.h) <= 0) throw new Error(`${r.id}: 가로·세로·높이는 0보다 커야 합니다.`);
        ids.add(r.id);
    }
    const before = saved || [];
    const removed = before.filter(r => r.kind === 'ZONE' && !ids.has(r.id));
    const busy = removed.filter(r => zoneStock(r).length);
    if (busy.length) throw new Error(`재고가 남은 구획은 지울 수 없습니다: ${busy.map(r => r.id).join(', ')}\n재고를 다른 구획으로 옮긴 뒤 지우세요.`);

    const sb = cloud();
    if (sb) {
        const { error } = await sb.from(TABLE).upsert(rows.map(toDb));
        if (error) throw new Error(`구획 배치 저장 실패: ${error.message}`);
        if (removed.length) {
            const { error: delErr } = await sb.from(TABLE).delete().in('id', removed.map(r => r.id));
            if (delErr) throw new Error(`구획 삭제 실패: ${delErr.message}`);
        }
    }
    saved = rows.map(r => ({ ...r }));
    writeCache(saved);
    applyRegistry(saved);
    // 구획 위치는 registerZones로 위치 목록에 들어간다(wms_locations에 따로 넣지 않음). 지운 구획만 위치 목록에서 뺀다.
    for (const r of removed) {
        try { await deleteLocation(zoneLocation(r)); } catch (e) { console.warn('구획 위치 삭제 실패', r.id, e); }
    }
};

/**
 * 재고를 구획으로 옮기기 (같은 거점 안 이동 — 수불부·업무일지 기록 없음)
 * @param {{ code: string, fromLoc: string, zone: ZoneRow, qty: number }} p
 */
export const moveToZone = async ({ code, fromLoc, zone, qty }) => processStockAction({
    type: 'MOVE', code, qty, fromLoc, toLoc: zoneLocation(zone),
    worker: state.currentGlobalWorker || myName(), reason: `구획 지정 (창고 배치도) ${String(fromLoc).split(LOCATION_SEP).pop()} → ${zone.id}`
});
