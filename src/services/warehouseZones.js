// ==========================================
// 창고 구획(존) 배치 — 3D 창고 배치도 (components/Warehouse3D.js, DB supabase/auth/65_warehouse_zones.sql)
// ==========================================
// · 공장(ZONE_PLANTS: 김포1공장 · 김포2공장)마다 좌표 기준·기본 배치·주변 표시(PLANT_EXTRAS)가 따로이고, 화면에서 공장을 골라 본다.
// · 창고 한 줄(kind WAREHOUSE, id = 창고코드): 공장 안 위치(x, z)·바닥 크기(w × d)·벽 높이(h), 단위 m.
//   rot = 돌아 앉은 각도(도, 위에서 볼 때 시계 방향, 기준점 = 창고 왼쪽 위 모서리),
//   outline = 바닥 외곽선(창고 기준 [x, z] m 점 목록 — ㄱ자·계단 모양 동, 비면 w × d 사각형)
// · 구획 한 줄(kind ZONE, id = 구획코드 '김포2A-01'): 창고 왼쪽 위 모서리 기준 위치(x, z)·크기(w × d × h)·종류(랙·바닥·탱크)
// · 재고 위치 = "거점 / 구획코드"(예: "김포공장 / 김포2A-01") — 재고·이력·수불부 로직은 그대로이고,
//   같은 거점 안 이동이라 수불부·업무일지에는 기록되지 않는다. 옮기기 + 이동전표는 services/zoneTransfer.js.
// · 클라우드에 배치가 없는 공장은 기본 배치(DEFAULT_LAYOUT → 배치 편집으로 고침)를 쓴다.
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state, deleteLocation } from './db.js';
import { registerZones, normalizeLocationList, makeLocation, LOCATION_SEP } from './locations.js';

/**
 * @typedef {{ id: string, kind: 'WAREHOUSE'|'ZONE', warehouse: string, site: string, name: string,
 *   zoneType: string, x: number, z: number, w: number, d: number, h: number, sort: number, note: string,
 *   rot?: number, outline?: number[][], slots?: number, tiers?: number, fillFrom?: 'START'|'END' }} ZoneRow
 */

const TABLE = 'wms_warehouse_zones';
const CACHE_KEY = 'daelim_wh_zones';

export const ZONE_SITE = '김포공장';
/**
 * 3D 배치도를 그리는 공장(캠프). id = 캠프 이름(locations.js SITE_LAYOUT), 창고코드로 어느 공장인지 찾는다.
 * defaultNote = 저장된 배치가 없어 기본 배치를 보여 줄 때의 안내.
 * @typedef {{ id: string, site: string, warehouses: { code: string, label: string }[], defaultNote: string }} ZonePlant
 * @type {ZonePlant[]}
 */
export const ZONE_PLANTS = [
    {
        id: '김포1공장', site: ZONE_SITE,
        // 동 이름: A동 = 김포1A(도면의 가동), B동 = 김포1B(나동 기존 + 증축), C동 = 김포1C(다동)
        warehouses: [
            { code: '김포1A', label: '김포1A · A동(생산동)' },
            { code: '김포1B', label: '김포1B · B동(포장동)' },
            { code: '김포1C', label: '김포1C · C동(창고동)' }
        ],
        defaultNote: '건축물현황도(배치도)에서 잰 건물 외곽입니다 — A동(생산동) = 도면 가동 24.2×12.2m, B동(포장동) = 나동(기존 + 증축) 18.1×18.6m, C동(창고동) = 다동 16.2×9.1m(29° 돌아 앉음). 도면에 라인(랙)·출입문·옥외저장소(김포1D)는 없고, 벽 높이는 예시입니다.'
    },
    {
        id: '김포2공장', site: ZONE_SITE,
        // 동 이름: A동 = 김포2A(도면의 가동), B동 = 김포2B(나동), C동 = 김포2C(다동, 사무동)
        warehouses: [
            { code: '김포2A', label: '김포2A · A동' },
            { code: '김포2B', label: '김포2B · B동' },
            { code: '김포2C', label: '김포2C · C동(사무동)' }
        ],
        defaultNote: '동 크기·배치(C동(사무동) 9.5×6.9m · A동 13×25m · B동 20×13m, 1.5m 간격)는 배치도 도면 치수, 라인은 파렛트 6개 × 2단 열 배치이고 벽 높이는 예시입니다.'
    }
];
/** 화면을 처음 열 때 보는 공장 (라인까지 저장된 공장) */
export const DEFAULT_PLANT_ID = '김포2공장';
/** 3D 배치도 대상 창고 (모든 공장) */
export const ZONE_WAREHOUSES = ZONE_PLANTS.flatMap(p => p.warehouses.map(w => ({ ...w, site: p.site, plant: p.id })));
/** 창고코드 → 공장 (배치도 대상 창고가 아니면 null) */
export const plantOfWarehouse = (code) => ZONE_PLANTS.find(p => p.warehouses.some(w => w.code === code)) || null;
export const ZONE_TYPES = { RACK: '랙', FLOOR: '바닥 적재', TANK: '탱크', ETC: '기타' };

// 파렛트 적재 열(라인) 한 줄 = 파렛트 6개 × 2단 (1.1m 파렛트 + 여유 → 길이 6.9m · 폭 1.3m · 높이 2.6m)
export const PALLET_LINE = { pallets: 6, tiers: 2, long: 6.9, wide: 1.3, h: 2.6 };
/**
 * 구획(라인) 목록 만들기. spots = [{ x, z, along: 'x'|'z', pallets? }] (창고 왼쪽 위 모서리 기준, 열이 놓이는 방향)
 */
const palletLines = (warehouse, spots) => spots.map((s, i) => {
    const pallets = s.pallets || PALLET_LINE.pallets;
    const long = Math.round(PALLET_LINE.long * (pallets / PALLET_LINE.pallets) * 10) / 10;
    return {
        id: `${warehouse}-${String(i + 1).padStart(2, '0')}`, kind: 'ZONE', warehouse, site: ZONE_SITE,
        name: `${i + 1}라인`, zoneType: 'FLOOR', x: s.x, z: s.z,
        w: s.along === 'x' ? long : PALLET_LINE.wide, d: s.along === 'x' ? PALLET_LINE.wide : long, h: PALLET_LINE.h,
        slots: pallets, tiers: PALLET_LINE.tiers, fillFrom: s.fillFrom || 'START',
        sort: i + 1, note: `파렛트 ${pallets}개 × ${PALLET_LINE.tiers}단 (${pallets * PALLET_LINE.tiers}파렛트)`
    };
});
// 두 줄씩 등을 맞댄 열 묶음 (쌍 간격 pitch, 쌍 안 두 열 사이 0.2m)
const pairs = (count, start, pitch, fixed, along) => Array.from({ length: count }, (_, p) => [0, PALLET_LINE.wide + 0.2].map(off => {
    const pos = Math.round((start + p * pitch + off) * 100) / 100;
    return along === 'x' ? { x: fixed, z: pos, along } : { x: pos, z: fixed, along };
})).flat();

/**
 * 기본 배치 (공장마다 좌표 기준이 따로, 단위 m, 도면 위쪽 = z 작은 쪽 = 북으로 봄). 벽 높이는 도면에 없어 예시값.
 *
 * 김포2공장 — 배치도(도면) 치수. 세 동의 서쪽 벽을 맞춰 세로로 놓임.
 *   C동 9.5 × 6.9 → 1.5 간격 → A동 13 × 25 → 1.5 간격 → B동 20 × 13 (도면의 다동·가동·나동)
 * 라인 = 2026-09-30 받은 배치 그림 (파렛트 6개 × 2단 열). 번호: A동 서쪽 묶음 북→남 01~12, 동쪽 벽 13(6개)·출입문·14(10개) /
 * B동 남쪽 묶음 서→동 01~10, 북쪽 벽 서→동 11(3파렛트)~12.
 *
 * 김포1공장 — 건축물현황도 배치도(2026-10-01 받은 도면, 갈산리 6-5)의 그림에서 잰 건물 외곽. 도면에 적힌 축척(1:500)이
 *   그림과 맞지 않아 도로 폭 6m·주차 칸 2.3 × 5m·건물~도로 경계 3.2m 치수에 맞춰 쟀다(그림 1px ≈ 0.068m, 오차 ±3%쯤).
 *   기준점 = 다동 서쪽 끝(x 0)·가동 북쪽 벽(z 0), 동쪽(x 40.4~46.4)이 폭 6m 도로.
 *   가동(기존) → 김포1A, 나동(기존 + 증축 — 붙어 있어 한 동으로) → 김포1B, 다동(기존, 29° 돌아 앉음) → 김포1C.
 *   도면에 라인(랙)·출입문·옥외저장소(김포1D)는 없다 → 건물만 두고 라인은 [배치 편집]으로 넣는다.
 */
export const DEFAULT_LAYOUT = [
    // ---------- 김포2공장 ----------
    { id: '김포2A', kind: 'WAREHOUSE', warehouse: '김포2A', site: ZONE_SITE, name: 'A동', zoneType: 'ETC', x: 0, z: 8.4, w: 13, d: 25, h: 7, sort: 1, note: '도면 13,000 × 25,000' },
    { id: '김포2B', kind: 'WAREHOUSE', warehouse: '김포2B', site: ZONE_SITE, name: 'B동', zoneType: 'ETC', x: 0, z: 34.9, w: 20, d: 13, h: 7, sort: 2, note: '도면 20,000 × 13,000' },
    { id: '김포2C', kind: 'WAREHOUSE', warehouse: '김포2C', site: ZONE_SITE, name: 'C동(사무동)', zoneType: 'ETC', x: 0, z: 0, w: 9.5, d: 6.9, h: 4, sort: 3, note: '도면 9,500 × 6,900' },
    // A동: 서쪽에 동서 방향 열 6쌍(12열), 동쪽 벽 따라 남북 방향 열 2개 (사이에 출입문)
    ...palletLines('김포2A', [
        ...pairs(6, 1.4, 3.7, 2.0, 'x'),
        // 13라인(6개) · [동쪽 출입문] · 14라인(10개, 남쪽 끝까지)
        { x: 11.3, z: 1.0, along: 'z', pallets: 4 }, { x: 11.3, z: 12.4, along: 'z', pallets: 10 }
    ]),
    // B동: 남쪽에 남북 방향 열 5쌍(10열), 북쪽 벽(A동 쪽) 따라 동서 방향 열 2개 (11라인은 그림대로 파렛트 3개)
    ...palletLines('김포2B', [
        ...pairs(5, 2.0, 3.6, 4.2, 'z').map(s => ({ ...s, fillFrom: 'END' })), // 안쪽(남쪽 벽)부터 채움
        { x: 2.0, z: 0.4, along: 'x', pallets: 4 }, { x: 7.6, z: 0.4, along: 'x' }
    ]),
    // C동(사무동): 3 × 3 = 9칸 보관 구역 (북서쪽부터 동쪽으로 1~3, 가운데 줄 4~6, 남쪽 줄 7~9)
    ...Array.from({ length: 9 }, (_, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        return {
            id: `김포2C-${String(i + 1).padStart(2, '0')}`, kind: 'ZONE', warehouse: '김포2C', site: ZONE_SITE, name: `${i + 1}칸`, zoneType: 'FLOOR',
            x: Math.round((0.5 + col * 2.93) * 100) / 100, z: Math.round((0.5 + row * 2.07) * 100) / 100, w: 2.63, d: 1.77, h: 2, slots: 0, tiers: 1, sort: i + 1, note: ''
        };
    }),
    // ---------- 김포1공장 (건물 외곽만 — 라인은 배치 편집으로) ----------
    { id: '김포1A', kind: 'WAREHOUSE', warehouse: '김포1A', site: ZONE_SITE, name: 'A동(생산동)', zoneType: 'ETC', x: 13.1, z: 0, w: 24.2, d: 12.2, h: 7, rot: 0,
        outline: [[0, 0], [24.2, 0], [24.2, 12.2], [3.5, 12.2], [3.5, 4.2], [0, 4.2]], sort: 1, note: '도면 가동(기존) — 남서쪽 3.5 × 8m가 빠진 ㄱ자' },
    { id: '김포1B', kind: 'WAREHOUSE', warehouse: '김포1B', site: ZONE_SITE, name: 'B동(포장동)', zoneType: 'ETC', x: 20.6, z: 27, w: 18.1, d: 18.6, h: 7, rot: 0,
        outline: [[8.9, 0], [18.1, 0], [18.1, 18.6], [8.9, 18.6], [0, 13.4], [0, 9.6], [11.9, 9.6], [11.9, 4.7], [8.9, 4.7]], sort: 2, note: '도면 나동(기존 9.2 × 9.6m) + 나동(증축 18.1 × 9m, 남서쪽 모서리 사선)' },
    { id: '김포1C', kind: 'WAREHOUSE', warehouse: '김포1C', site: ZONE_SITE, name: 'C동(창고동)', zoneType: 'ETC', x: 4.4, z: 20.55, w: 16.2, d: 9.1, h: 6, rot: 29,
        outline: [[0, 0], [11.2, 0], [11.2, 1.3], [14.3, 1.3], [14.3, 4.1], [16.2, 4.1], [16.2, 9.1], [0, 9.1]], sort: 3, note: '도면 다동(기존) — 29° 돌아 앉음, 북동쪽 끝이 계단 모양' }
];

/**
 * 배치도 주변 (도면에서 옮긴 참고 표시, 3D에만 그림 — 재고 위치 아님). 공장마다 따로, 좌표는 그 공장 창고와 같은 기준(m).
 * · facilities: 시설 상자 { name, x, z, w, d, h } — 김포2공장 오수처리시설은 2026-09-30 요청으로 표시하지 않음
 * · doors: 출입문 — 창고 기준 벽(E 동·W 서·N 북·S 남)과 벽 위 구간(from~to, 창고 왼쪽 위 모서리 기준 m)
 *     style: FIXED 닫힌 고정문 · DOUBLE_SWING 두 짝이 바깥으로 활짝 열린 문 · SLIDE 벽 바깥을 따라 밀려 열린 문(slide = -1 좌표 작은 쪽 / +1 큰 쪽)
 *            · DOUBLE_SLIDE 두 짝이 가운데서 갈라져 양옆으로 밀려 열린 문. 열린 문은 문틀(열린 자리)을 흰 테두리로 그린다.
 *     외곽선(outline)이 있는 동은 벽을 통으로 그려 문 자리를 비우지 않는다 → 문짝만 겹쳐 보인다.
 * · arrows: 바닥 화살표 (전체 좌표 m, from → to) / floorMarks: 바닥에 칠한 사각형 + 글자 (전체 좌표 m, 남북으로 긴 표시는 글자를 긴 쪽으로 눕혀 씀)
 * · annexes: 건물에 붙은 작은 부속 표시(도면의 현관·캐노피로 보이는 사각형) — 창고 기준 { warehouse, x, z, w, d }, 낮은 판으로만 그린다
 * · homeView: 기본 시점 = 이 창고의 이 벽을 바깥에서 정면으로 봄
 * · labelSide: 동 이름표 자리 — 'W' 동 서쪽 바깥(세 동이 서쪽 벽을 맞춘 김포2공장) · 'N' 북쪽 벽 위 간판(동이 흩어져 있는 김포1공장)
 * · props: 장비 모형 (창고 왼쪽 위 모서리 기준 중심 위치 m, rot = 앞(포크)이 향하는 방향 도: 0 북 · 90 동 · 180 남 · 270 서)
 * · boundaries: 부지 경계선(점선) { name, points: [[x, z], …] } — 2026-09-30 요청으로 표시하지 않음
 */
const PLANT_EXTRAS = {
    '김포2공장': {
        facilities: [],
        doors: [
            // 양쪽 슬라이딩: 두 짝이 북·남 양옆으로 밀려 열림
            { warehouse: '김포2A', wall: 'E', from: 6.0, to: 9.7, name: 'A동 출입문 (양쪽 슬라이딩 · 열림)', style: 'DOUBLE_SLIDE' },
            { warehouse: '김포2A', wall: 'W', from: 6.0, to: 9.7, name: 'A동 고정문', style: 'FIXED' },
            // 바깥(북쪽)에서 볼 때 오른쪽 = 서쪽(A동 쪽)으로 밀려 열림
            { warehouse: '김포2B', wall: 'N', from: 15.2, to: 19.2, name: 'B동 출입문 (슬라이딩 · 열림)', style: 'SLIDE', slide: -1 }
        ],
        // A동 북쪽 벽 앞에서 C동 동쪽 옆을 지나 공장 밖(북쪽)으로
        arrows: [{ from: [11.25, 8.1], to: [11.25, 1.6], name: '' }],
        floorMarks: [{ x: 9.8, z: -1.4, w: 2.9, d: 2.8, text: '출입구\n(공장 외부)', color: '#22c55e' }],
        annexes: [],
        homeView: { warehouse: '김포2A', wall: 'E' },
        labelSide: 'W',
        props: [{ type: 'FORKLIFT', warehouse: '김포2A', x: 10.1, z: 3.4, rot: 0, name: '지게차' }],
        boundaries: []
    },
    // 건축물현황도 배치도에서 옮긴 것: 동쪽 폭 6m 도로, 가동과 나동 사이 동쪽 출입구(대문), 건물에 붙은 작은 사각형 넷.
    // 부지 경계·옹벽·식재·오수처리시설·주차 칸은 김포2공장과 같이 표시하지 않는다.
    '김포1공장': {
        facilities: [],
        doors: [],
        arrows: [{ from: [31.5, 20.2], to: [36.9, 20.2], name: '' }],
        floorMarks: [
            { x: 37.1, z: 16.8, w: 3.3, d: 6.8, text: '출입구\n(동쪽 도로)', color: '#22c55e' },
            { x: 40.4, z: -4.4, w: 6, d: 53, text: '도로 (폭 6m)', color: '#64748b' }
        ],
        annexes: [
            { warehouse: '김포1A', x: 20.8, z: -0.9, w: 1.85, d: 0.9 },
            { warehouse: '김포1A', x: 13.75, z: 12.2, w: 3.9, d: 0.95 },
            { warehouse: '김포1B', x: 10.4, z: -0.9, w: 2.4, d: 0.9 },
            { warehouse: '김포1B', x: 10.95, z: 4.7, w: 0.95, d: 1.45 }
        ],
        homeView: { warehouse: '김포1A', wall: 'E' },
        labelSide: 'N',
        props: [],
        boundaries: []
    }
};
/** 공장의 주변 표시 (없는 공장이면 빈 값) */
export const plantExtras = (plantId) => PLANT_EXTRAS[plantId] || {};

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const myName = () => state.currentUser?.name || state.currentGlobalWorker || '';

// ---------- 창고 모양: 돌아 앉은 각도 · 바닥 외곽선 (supabase/auth/71_zone_rot_outline.sql) ----------
/** 외곽선 점 목록 정리: 숫자 쌍 [x, z]만 남긴다 (3점이 안 되면 빈 목록 = 사각형) */
const cleanOutline = (v) => {
    const pts = (Array.isArray(v) ? v : [])
        .filter(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
        .map(p => [Number(p[0]), Number(p[1])]);
    return pts.length >= 3 ? pts : [];
};
/** 창고 바닥이 사각형이 아닌 외곽선(ㄱ자·계단 모양)인지 */
export const hasOutline = (wh) => cleanOutline(wh.outline).length > 0;
/** 창고 바닥 외곽선 (창고 왼쪽 위 모서리 기준 [x, z] m). 외곽선이 없으면 가로 × 세로 사각형 */
export const warehouseOutline = (wh) => {
    const pts = cleanOutline(wh.outline);
    return pts.length ? pts : [[0, 0], [num(wh.w, 1), 0], [num(wh.w, 1), num(wh.d, 1)], [0, num(wh.d, 1)]];
};
/** 창고 단위 재고 위치 ("거점 / 창고코드" — 구획을 정하지 않은 재고) */
export const warehouseLocation = (wh) => makeLocation(wh.site || ZONE_SITE, wh.id);

/** @returns {ZoneRow} */
const fromDb = (r) => ({
    id: r.id, kind: r.kind, warehouse: r.warehouse, site: r.site || ZONE_SITE, name: r.name || '', zoneType: r.zone_type || 'RACK',
    x: num(r.x), z: num(r.z), w: num(r.w, 1), d: num(r.d, 1), h: num(r.h, 1), sort: num(r.sort), note: r.note || '',
    slots: num(r.slots), tiers: num(r.tiers, 1) || 1, fillFrom: r.fill_from === 'END' ? 'END' : 'START',
    rot: num(r.rot), outline: cleanOutline(r.outline)
});
const toDb = (z) => ({
    id: z.id, kind: z.kind, warehouse: z.warehouse, site: z.site || ZONE_SITE, name: z.name || '', zone_type: z.zoneType || 'RACK',
    x: num(z.x), z: num(z.z), w: num(z.w, 1), d: num(z.d, 1), h: num(z.h, 1), sort: num(z.sort), note: z.note || '',
    slots: Math.max(0, Math.round(num(z.slots))), tiers: Math.max(1, Math.round(num(z.tiers, 1))), fill_from: z.fillFrom === 'END' ? 'END' : 'START',
    rot: num(z.rot), outline: cleanOutline(z.outline),
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
 * 배치 불러오기. 클라우드(로컬 모드는 기기 캐시)에 저장된 배치 + 저장된 줄이 하나도 없는 공장은 기본 배치.
 * 위치 목록에는 저장된 구획만 넣는다 (기본 배치의 구획은 아직 재고 위치가 아니다).
 * @returns {Promise<{ rows: ZoneRow[], isDefault: boolean, defaultPlants: string[] }>}
 *   defaultPlants = 기본 배치를 쓰는 공장 id, isDefault = 모든 공장이 기본 배치
 */
export const loadZones = async () => {
    const sb = cloud();
    let stored = null;
    if (sb) {
        const { data, error } = await sb.from(TABLE).select('*').order('sort');
        if (error) throw new Error(`구획 배치를 불러오지 못했습니다: ${error.message}`);
        stored = (data || []).map(fromDb);
    } else {
        stored = readCache() || [];
    }
    saved = stored;
    const defaultPlants = ZONE_PLANTS.filter(p => !stored.some(r => plantOfWarehouse(r.warehouse) === p)).map(p => p.id);
    const defaults = DEFAULT_LAYOUT.filter(r => defaultPlants.includes(plantOfWarehouse(r.warehouse)?.id)).map(r => ({ ...r }));
    if (stored.length) writeCache(stored);
    applyRegistry(stored.length ? stored : readCache() || []);
    return { rows: [...stored, ...defaults], isDefault: defaultPlants.length === ZONE_PLANTS.length, defaultPlants };
};

/** 구획 위치 문자열 */
export const zoneLocation = (z) => makeLocation(z.site || ZONE_SITE, z.id);

/** 구획의 재고 행 (수량 0 제외) */
export const zoneStock = (z) => {
    const loc = zoneLocation(z);
    return (state.inventory || []).filter(i => i.location === loc && Number(i.quantity) !== 0);
};

/**
 * 구획이 정해지지 않은 재고 (거점만 적힌 김포공장 재고 + 그 공장 창고 단위 재고 — 예: 김포2A·2B·2C)
 * @param {string} [warehouseCode] 창고 하나만 볼 때
 * @param {string} [plantId] 공장 (비우면 배치도 대상 창고 모두)
 */
export const unassignedStock = (warehouseCode = '', plantId = '') => {
    const whLocs = ZONE_WAREHOUSES.filter(w => (!plantId || w.plant === plantId) && (!warehouseCode || w.code === warehouseCode)).map(w => makeLocation(w.site, w.code));
    const accept = new Set([ZONE_SITE, ...whLocs]); // 창고 미지정(거점만) 재고는 어느 창고를 봐도 함께
    return (state.inventory || []).filter(i => accept.has(i.location) && Number(i.quantity) > 0);
};
/** 창고 단위로 적힌 재고 (그 창고의 구획 미지정 재고, 수량 0 제외) */
export const warehouseStock = (wh) => {
    const loc = warehouseLocation(wh);
    return (state.inventory || []).filter(i => i.location === loc && Number(i.quantity) !== 0);
};

/** 새 구획 번호 */
export const nextZoneId = (rows, warehouse) => {
    const used = rows.filter(r => r.kind === 'ZONE' && r.warehouse === warehouse).map(r => Number(String(r.id).split('-').pop()) || 0);
    return `${warehouse}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
};

/**
 * 배치 저장 (매니저). 없어진 구획은 재고가 남아 있으면 막는다.
 * @param {ZoneRow[]} rows 저장할 줄 (plantId를 주면 그 공장의 줄 전체)
 * @param {string} [plantId] 공장 하나만 저장할 때 — 다른 공장의 저장된 배치는 건드리지 않는다 (기본 배치만 보이는 공장을 저장해 버리지 않게)
 */
export const saveZones = async (rows, plantId = '') => {
    const isInScope = (r) => !plantId || plantOfWarehouse(r.warehouse)?.id === plantId;
    const ids = new Set();
    for (const r of rows) {
        if (!r.id || ids.has(r.id)) throw new Error(`구획코드가 비었거나 겹칩니다: ${r.id || '(빈 칸)'}`);
        if (String(r.id).includes('/')) throw new Error(`구획코드에는 '/'를 쓸 수 없습니다: ${r.id}`);
        if (!isInScope(r)) throw new Error(`${r.id}: ${plantId} 창고가 아닙니다.`);
        if (r.kind === 'ZONE' && !String(r.id).startsWith(`${r.warehouse}-`)) throw new Error(`구획코드는 '${r.warehouse}-번호' 모양이어야 합니다: ${r.id}`);
        if (num(r.w) <= 0 || num(r.d) <= 0 || num(r.h) <= 0) throw new Error(`${r.id}: 가로·세로·높이는 0보다 커야 합니다.`);
        ids.add(r.id);
    }
    const others = (saved || []).filter(r => !isInScope(r));
    const before = (saved || []).filter(isInScope);
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
    saved = [...others, ...rows.map(r => ({ ...r }))];
    writeCache(saved);
    applyRegistry(saved);
    // 구획 위치는 registerZones로 위치 목록에 들어간다(wms_locations에 따로 넣지 않음). 지운 구획만 위치 목록에서 뺀다.
    for (const r of removed) {
        try { await deleteLocation(zoneLocation(r)); } catch (e) { console.warn('구획 위치 삭제 실패', r.id, e); }
    }
};

// ---------- 라인 파렛트 칸 · 적재 파렛트 수 · 칸 위치 (supabase/auth/66_zone_pallets.sql · 69_zone_cells.sql) ----------
// 품목마다 그 라인에서 차지하는 파렛트 수와, 파렛트가 놓인 칸(cells)을 저장한다.
// · 칸 키 = 줄 시작 쪽(좌표 작은 쪽)에서 센 칸 × 100 + 단 (0부터). 물리 위치로 저장하므로 채우는 방향(fillFrom)을 바꿔도 파렛트는 제자리다.
// · 화면·옮기기에서 쓰는 '칸 번호' = 채우는 순서 번호(채우는 쪽에서 센 칸 × 단수 + 단) — cellKeyOf / cellIndexOf로 바꾼다.
// · 칸이 저장되지 않은 파렛트(예전 기록, 입출고 화면에서 그 구획으로 넣은 재고)는 빈 칸에 채우는 순서대로 놓인 것으로 본다(자동).
// · 랙이 아닌 구획(바닥 적재 등)은 아래 단이 비면 위 파렛트가 내려온다(settleCells).
const LOAD_TABLE = 'wms_zone_loads';
const LOAD_KEY = 'daelim_zone_loads';
/** @typedef {{ pallets: number, cells: number[] }} ZoneLoad 파렛트 수 · 놓인 칸 키 목록 */
/** @type {Map<string, ZoneLoad>} '<구획>|<품목>' → 적재 기록 */
let loads = new Map();
const loadId = (zoneId, code) => `${zoneId}|${code}`;
const cleanCells = (v) => (Array.isArray(v) ? [...new Set(v.map(Number).filter(n => Number.isInteger(n) && n >= 0))] : []);
const roundPallets = (v) => Math.max(0, Math.round(num(v) * 10) / 10);
const palletCells = (pallets) => Math.ceil(num(pallets) - 1e-9); // 파렛트 수가 차지하는 칸 수 (0.5파렛트도 한 칸)
// 기기 캐시: [id, 파렛트 수, 칸 키 목록] (예전 캐시는 [id, 파렛트 수])
const writeLoadCache = () => {
    try { localStorage.setItem(LOAD_KEY, JSON.stringify([...loads].map(([id, l]) => [id, l.pallets, l.cells]))); } catch (e) { console.warn('적재 기록 캐시 저장 실패', e); }
};
const readLoadCache = () => {
    try {
        return new Map(JSON.parse(localStorage.getItem(LOAD_KEY) || '[]').map(([id, pallets, cells]) => [id, { pallets: num(pallets), cells: cleanCells(cells) }]));
    } catch (e) {
        console.warn('적재 기록 캐시를 읽지 못했습니다.', e);
        return new Map();
    }
};
const loadRow = (zoneId, code, load) => ({
    id: loadId(zoneId, code), zone_id: zoneId, code, pallets: load.pallets, cells: load.cells, updated_by_name: myName(), updated_at: new Date().toISOString()
});
const loadWriteError = (error, what) => new Error(/row-level security|permission/i.test(error.message)
    ? `${what} 기록은 현장 작업자 이상만 할 수 있습니다.` : `${what}를 저장하지 못했습니다: ${error.message}`);

/** 라인 칸 수 = 한 줄 파렛트 수 × 단 (0이면 칸 없음) */
export const zoneCapacity = (z) => Math.max(0, Math.round(num(z.slots))) * Math.max(1, Math.round(num(z.tiers, 1)));
/** 라인의 칸 수(한 줄)와 단 수 */
export const zoneDims = (z) => ({ slots: Math.max(0, Math.round(num(z.slots))), tiers: Math.max(1, Math.round(num(z.tiers, 1))) });

/** 적재 기록 불러오기 (클라우드 → 없으면 기기) */
export const loadZoneLoads = async () => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from(LOAD_TABLE).select('id, pallets, cells');
        if (error) throw new Error(`라인 적재 기록을 불러오지 못했습니다: ${error.message}`);
        loads = new Map((data || []).map(r => [r.id, { pallets: num(r.pallets), cells: cleanCells(r.cells) }]));
        writeLoadCache();
    } else {
        loads = readLoadCache();
    }
    return loads;
};

/** 저장된 배치의 구획 줄 (배치를 아직 불러오지 않았거나 없는 구획이면 null) */
export const savedZone = (zoneId) => (saved || []).find(r => r.kind === 'ZONE' && r.id === zoneId) || null;
/** 라인 안 품목의 파렛트 수 (기록이 없으면 재고가 있는 품목 1파렛트로 봄) */
export const itemPallets = (z, code) => (loads.has(loadId(z.id, code)) ? loads.get(loadId(z.id, code)).pallets : 1);
/** 라인에 쌓인 파렛트 합계 (재고가 남은 품목만) */
export const zonePallets = (z) => zoneStock(z).reduce((s, i) => s + itemPallets(z, i.code), 0);

/** 라인 안 품목의 파렛트 수 정하기 (칸 위치는 그대로 두고, 줄이면 뒤쪽 칸부터 뺀다) */
export const setZoneLoad = async (zoneId, code, pallets) => {
    const id = loadId(zoneId, code);
    const p = roundPallets(pallets);
    const load = { pallets: p, cells: (loads.get(id)?.cells || []).slice(0, palletCells(p)) };
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from(LOAD_TABLE).upsert(loadRow(zoneId, code, load));
        if (error) throw loadWriteError(error, '파렛트 수');
    }
    loads.set(id, load);
    writeLoadCache();
};

/** 구획(라인) 위치 문자열인지 → 그 구획코드 (구획이 아니면 '') */
export const zoneIdOfLocation = (loc) => { const b = String(loc || '').split(LOCATION_SEP).pop().trim(); return /-\d+$/.test(b) ? b : ''; };

// ---------- 칸 배치 ----------
// 칸이 저장되지 않은 파렛트를 채우는 품목 순서: 분류(원료 → 원액 → 부자재 → 완제품 → 그 밖) → 품목코드
const CELL_CAT_ORDER = ['원료', '원액', '부자재', '완제품'];
const cellCatRank = (category) => { const i = CELL_CAT_ORDER.indexOf(category); return i < 0 ? 9 : i; };

/** 칸 번호(채우는 순서) → 칸 키(물리 위치) */
export const cellKeyOf = (z, index) => {
    const { slots, tiers } = zoneDims(z);
    const slot = Math.floor(index / tiers);
    return (z.fillFrom === 'END' ? slots - 1 - slot : slot) * 100 + (index % tiers);
};
/** 칸 키(물리 위치) → 칸 번호(채우는 순서). 지금 배치에 없는 칸이면 -1 */
export const cellIndexOf = (z, key) => {
    const { slots, tiers } = zoneDims(z);
    const pos = Math.floor(key / 100), tier = key % 100;
    if (pos >= slots || tier >= tiers) return -1;
    return (z.fillFrom === 'END' ? slots - 1 - pos : pos) * tiers + tier;
};

/** 바닥 적재(랙이 아닌 구획)는 아래 단이 비면 위 파렛트가 내려온다. 새 배열을 돌려준다 */
export const settleCells = (z, cells) => {
    if (z.zoneType === 'RACK') return cells.slice();
    const { tiers } = zoneDims(z);
    const out = new Array(cells.length).fill(null);
    for (let base = 0; base < cells.length; base += tiers) {
        cells.slice(base, base + tiers).filter(Boolean).forEach((pallet, tier) => { out[base + tier] = pallet; });
    }
    return out;
};

/**
 * @typedef {{ code: string, name: string, category: string, k: number, n: number }} CellPallet
 *   칸에 놓인 파렛트: k = 그 품목의 몇 번째 파렛트(0부터), n = 그 품목의 파렛트 칸 수
 */
/**
 * 라인의 칸 배치: 칸 번호(채우는 순서: 1번 칸 아래 단 → 위 단 → 다음 칸)마다 무엇이 놓였는지.
 * 저장된 칸에 먼저 놓고, 칸이 저장되지 않은 파렛트는 빈 칸에 차례로 놓는다. 칸이 모자라면 overflow(칸 초과).
 * @param {ZoneRow} z
 * @returns {{ cells: (CellPallet|null)[], overflow: CellPallet[] }}
 */
export const zoneCellMap = (z) => {
    const cap = zoneCapacity(z);
    const cells = new Array(cap).fill(null);
    const overflow = [];
    if (!cap) return { cells, overflow };
    const waiting = [];
    [...zoneStock(z)].sort((a, b) => cellCatRank(a.category) - cellCatRank(b.category) || String(a.code).localeCompare(String(b.code)))
        .forEach(item => {
            const n = palletCells(itemPallets(z, item.code));
            const pallet = (k) => ({ code: item.code, name: item.name, category: item.category || '', k, n });
            let k = 0;
            for (const key of loads.get(loadId(z.id, item.code))?.cells || []) {
                if (k >= n) break;
                const index = cellIndexOf(z, key);
                if (index < 0 || cells[index]) continue; // 배치가 바뀌어 없어진 칸, 다른 품목이 먼저 차지한 칸
                cells[index] = pallet(k);
                k += 1;
            }
            for (; k < n; k += 1) waiting.push(pallet(k));
        });
    let free = 0;
    waiting.forEach(pallet => {
        while (free < cap && cells[free]) free += 1;
        if (free < cap) cells[free] = pallet; else overflow.push(pallet);
    });
    return { cells: settleCells(z, cells), overflow };
};

/** 그 칸(채우는 순서로 센 칸, 0부터)의 가장 아래 빈 단 → 칸 번호. 가득 찼으면 -1 */
export const freeIndexInSlot = (z, cells, slot) => {
    const { slots, tiers } = zoneDims(z);
    if (slot < 0 || slot >= slots) return -1;
    for (let tier = 0; tier < tiers; tier += 1) if (!cells[slot * tiers + tier]) return slot * tiers + tier;
    return -1;
};

/**
 * 칸 배치에서 한 품목의 파렛트를 count개 뺀다: firstIndex 칸의 파렛트 먼저, 그다음 채우는 순서 뒤쪽 파렛트부터.
 * @returns {(CellPallet|null)[]} 새 배치 (바닥 적재는 위 파렛트가 내려온 뒤)
 */
export const takePallets = (z, cells, code, count, firstIndex = -1) => {
    const next = cells.slice();
    let left = count;
    if (left > 0 && firstIndex >= 0 && next[firstIndex]?.code === code) { next[firstIndex] = null; left -= 1; }
    for (let i = next.length - 1; i >= 0 && left > 0; i -= 1) {
        if (next[i]?.code === code) { next[i] = null; left -= 1; }
    }
    return settleCells(z, next);
};

/**
 * 칸 배치에 파렛트를 count개 놓는다: startSlot 칸의 가장 아래 빈 단부터, 그 칸이 차면 다음 칸 … 끝에 닿으면 처음 칸부터.
 * startSlot이 -1이면 빈 칸에 채우는 순서대로.
 * @returns {{ cells: (CellPallet|null)[], placed: number[] }} placed = 놓인 칸 번호 (못 놓은 파렛트는 칸 초과로 남는다)
 */
export const putPallets = (z, cells, pallet, count, startSlot = -1) => {
    const { slots, tiers } = zoneDims(z);
    const next = cells.slice();
    const placed = [];
    const first = startSlot >= 0 && startSlot < slots ? startSlot : 0;
    for (let step = 0; step < slots && placed.length < count; step += 1) {
        const slot = (first + step) % slots;
        for (let tier = 0; tier < tiers && placed.length < count; tier += 1) {
            const index = slot * tiers + tier;
            if (next[index]) continue;
            next[index] = { ...pallet };
            placed.push(index);
        }
    }
    return { cells: next, placed };
};

/**
 * 구획의 칸 배치를 통째로 저장한다 (그 구획에 재고가 있는 품목마다 파렛트 수 + 놓인 칸).
 * 한 번 저장하면 자동으로 놓였던 파렛트도 그 칸에 고정되어, 옆 파렛트를 옮겨도 자리가 밀리지 않는다.
 * @param {ZoneRow} z
 * @param {(CellPallet|null)[]} cells 칸 번호순 배치
 * @param {Record<string, number|null>} [palletsByCode] 파렛트 수가 바뀐 품목 (null = 그 구획에서 다 빠짐 → 기록 삭제)
 */
export const saveZoneCells = async (z, cells, palletsByCode = {}) => {
    const keysByCode = new Map();
    cells.forEach((pallet, index) => {
        if (pallet) keysByCode.set(pallet.code, [...(keysByCode.get(pallet.code) || []), cellKeyOf(z, index)]);
    });
    const codes = new Set([...zoneStock(z).map(i => i.code), ...Object.keys(palletsByCode), ...keysByCode.keys()]);
    const kept = [], gone = [];
    codes.forEach(code => {
        if (palletsByCode[code] === null) { gone.push(code); return; }
        const pallets = roundPallets(code in palletsByCode ? palletsByCode[code] : itemPallets(z, code));
        kept.push([code, { pallets, cells: keysByCode.get(code) || [] }]);
    });
    const sb = cloud();
    if (sb) {
        if (kept.length) {
            const { error } = await sb.from(LOAD_TABLE).upsert(kept.map(([code, load]) => loadRow(z.id, code, load)));
            if (error) throw loadWriteError(error, '칸 위치');
        }
        if (gone.length) {
            const { error } = await sb.from(LOAD_TABLE).delete().in('id', gone.map(code => loadId(z.id, code)));
            if (error) throw loadWriteError(error, '칸 위치');
        }
    }
    kept.forEach(([code, load]) => loads.set(loadId(z.id, code), load));
    gone.forEach(code => loads.delete(loadId(z.id, code)));
    writeLoadCache();
};

// ---------- 품목 합치기 (로컬 모드) ----------
// 클라우드는 DB 함수 wms_merge_zone_loads / wms_unmerge_zone_loads(supabase/auth/70_merge_zone_loads.sql)가 같은 규칙으로 처리한다.
// 그 구획에 재고가 있는 쪽만 실제 적재로 본다(다 빠진 뒤 남은 옛 기록은 무시): 두 품목 모두 적재면 파렛트 수를 더하고 칸을 합치고,
// 합쳐지는 품목만 적재면 그 기록이 기준 품목 것이 된다. 합쳐지는 품목의 기록은 지운다.
const hasZoneStock = (code, zoneId) => (state.inventory || [])
    .some(i => i.code === code && Number(i.quantity) !== 0 && zoneIdOfLocation(i.location) === zoneId);

/**
 * 합쳐지는 품목의 구획 적재 기록(파렛트 수·칸 위치)을 기준 품목으로 옮긴다. 재고를 옮기기 전에 불러야 한다(합치기 전 재고로 판단).
 * @param {string} sourceCode 합쳐지는 품목
 * @param {string} targetCode 기준 품목
 * @returns {{ zone: string, wrote: boolean, source: ZoneLoad|null, target: ZoneLoad|null }[]} 되돌리기용 변경 전 값
 */
export const mergeZoneLoadsLocal = (sourceCode, targetCode) => {
    loads = readLoadCache();
    const suffix = `|${sourceCode}`;
    const zoneIds = new Set([
        ...[...loads.keys()].filter(id => id.endsWith(suffix)).map(id => id.slice(0, -suffix.length)),
        ...(state.inventory || []).filter(i => i.code === sourceCode && Number(i.quantity) !== 0).map(i => zoneIdOfLocation(i.location)).filter(Boolean)
    ]);
    const changes = [];
    [...zoneIds].sort().forEach(zone => {
        const source = loads.get(loadId(zone, sourceCode)) || null;
        const target = loads.get(loadId(zone, targetCode)) || null;
        const isSourceLive = hasZoneStock(sourceCode, zone);
        let merged = null;
        if (isSourceLive && hasZoneStock(targetCode, zone)) {
            merged = { pallets: (source?.pallets ?? 1) + (target?.pallets ?? 1), cells: [...new Set([...(target?.cells || []), ...(source?.cells || [])])] };
        } else if (isSourceLive && (source || target)) {
            merged = { pallets: source?.pallets ?? 1, cells: [...(source?.cells || [])] };
        }
        if (merged) loads.set(loadId(zone, targetCode), merged);
        if (source) loads.delete(loadId(zone, sourceCode));
        if (merged || source) changes.push({ zone, wrote: !!merged, source, target });
    });
    writeLoadCache();
    return changes;
};

/**
 * mergeZoneLoadsLocal이 바꾼 기록을 합치기 전 값으로 되돌린다.
 * @param {{ zone: string, wrote: boolean, source: ZoneLoad|null, target: ZoneLoad|null }[]|undefined} changes 예전 합치기 이력처럼 없으면 아무것도 하지 않는다
 */
export const unmergeZoneLoadsLocal = (changes, sourceCode, targetCode) => {
    if (!Array.isArray(changes) || !changes.length) return;
    loads = readLoadCache();
    changes.forEach(c => {
        if (c.wrote && c.target) loads.set(loadId(c.zone, targetCode), c.target);
        else if (c.wrote) loads.delete(loadId(c.zone, targetCode));
        if (c.source) loads.set(loadId(c.zone, sourceCode), c.source);
    });
    writeLoadCache();
};
