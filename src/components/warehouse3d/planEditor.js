// ==========================================
// 창고 배치도 평면도 편집기 — 레이어로 나눠 보고(보이기·잠금) 끌어서 고친다 (Warehouse3D.js의 [평면도 편집])
// ==========================================
// · 화면: 위에서 본 평면도(SVG, 도면 위쪽이 위 · 단위 m). 레이어마다 보이기(눈)·잠금(자물쇠).
//   배경 도면(이 기기에서 불러온 그림) · 주변 표시(바닥 표시·화살표) · 참고 건물 · 건물(창고) · 부속·출입문·장비 · 구획 1층 · 구획 2층 이상 · 이름표
// · 고치기: 눌러서 고르고 끌어서 옮긴다. 손잡이 = 크기(모서리·변의 네모), 회전(위쪽 동그라미),
//   다각형 건물은 꼭짓점(끌기)·변 가운데 동그라미(꼭짓점 넣기). 오른쪽 '속성'에서 숫자로도 고친다.
//   격자 맞춤, 되돌리기(Ctrl+Z)·다시 하기(Ctrl+Y), 방향키 = 한 칸씩, Delete = 지우기, Ctrl+D = 복제, 휠 = 확대, 빈 곳 끌기 = 화면 옮기기.
// · 저장: 창고·구획은 saveZones(그 공장 줄만), 주변 표시는 바뀌었을 때만 savePlantExtras. 저장 전에는 3D·재고 위치에 반영되지 않는다.
// · 좌표: 창고·참고 건물·바닥 표시·화살표는 공장 기준, 구획·부속·출입문·장비는 그 창고 기준 (geometry.js의 frameOf·joinFrames).
//   고른 것의 키 = '종류:id' — WH 창고 · ZONE 구획 · REF 참고 건물 · MARK 바닥 표시 · ARROW 화살표 · ANNEX 부속 · DOOR 출입문 · PROP 장비 · BG 배경 도면.
// · 화면을 다 덮는 창이라 열려 있는 동안 앱 단축키(Backspace 뒤로가기·통합 검색)를 막고, 브라우저 뒤로가기는 이 창을 닫는 것으로 받는다
//   (방문 기록에 표시 하나를 넣어 둠 — 모달과 같은 방식).
import { esc } from '../../services/html.js';
import { createIcons, icons } from '../../services/icons.js';
import {
    ZONE_TYPES, DOOR_STYLES, WALL_NAMES, PALLET_LINE, RACK_LINE, ZONE_PLANTS, plantExtras, defaultPlantExtras, cleanExtras, hasSavedExtras,
    saveZones, savePlantExtras, resetPlantExtras, zoneStock, nextZoneId, warehouseOutline, hasOutline, zoneCapacity
} from '../../services/warehouseZones.js';
import { frameOf, joinFrames, outlineCenter, zoneBaseY, isInOutline } from './geometry.js';
import { loadBackgroundFile, saveBackgroundFile, deleteBackgroundFile, readBackgroundSetting, writeBackgroundSetting } from './planBackground.js';

const LAYERS = [
    { id: 'bg', name: '배경 도면', hint: '이 기기에서 불러온 그림 (저장·공유되지 않음)' },
    { id: 'site', name: '주변 표시', hint: '바닥 표시(도로·출입구)·화살표' },
    { id: 'ref', name: '참고 건물', hint: '사무실동처럼 재고 위치가 아닌 건물' },
    { id: 'wh', name: '건물 (창고)', hint: '창고 외곽 — 옮기면 안의 구획·부속도 같이 움직인다' },
    { id: 'fit', name: '부속·출입문·장비', hint: '건물에 붙은 부속·출입문·지게차' },
    { id: 'zone1', name: '구획 · 1층', hint: '랙·라인·바닥 구역 (바닥 높이 0)' },
    { id: 'zone2', name: '구획 · 2층 이상', hint: '바닥 높이가 있는 구획' },
    { id: 'label', name: '이름표', hint: '이름·크기 글자' }
];
// 처음에는 실수로 건드리면 안 되는 큰 것(배경·주변 표시·건물)을 잠가 둔다 — 구획·부속만 바로 고칠 수 있다
const LOCKED_AT_FIRST = ['bg', 'site', 'ref', 'wh'];
const LAYER_KEY = 'daelim_w3_plan_layers'; // 레이어 보이기·잠금 (기기별)
const SNAP_KEY = 'daelim_w3_plan_snap';    // 격자 맞춤 간격 (기기별)
const SNAP_STEPS = [0.05, 0.1, 0.5, 1];
const SCALE_BAR_STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100];
const MIN_SCALE = 1.2, MAX_SCALE = 320;    // 화면 px / m
const MIN_SIZE = 0.2;                      // 가장 작은 가로·세로 (m)
const MIN_DOOR = 0.4;                      // 가장 좁은 문 (m)
const HANDLE = 9;                          // 손잡이 크기 (px)
const HIT = 10;                            // 손잡이를 잡을 수 있는 반지름 (px)
const HISTORY_MARK = 'w3-plan';            // 방문 기록에 넣어 두는 표시 (뒤로가기 = 이 창 닫기)
const KIND_NAMES = { WH: '건물(창고)', ZONE: '구획', REF: '참고 건물', MARK: '바닥 표시', ARROW: '화살표', ANNEX: '부속', DOOR: '출입문', PROP: '장비', BG: '배경 도면' };
const EXTRA_LISTS = { REF: 'buildings', MARK: 'floorMarks', ARROW: 'arrows', ANNEX: 'annexes', DOOR: 'doors', PROP: 'props' };
const NEW_ZONE_WORDS = { RACK: '번 랙', LINE: '라인', AREA: '구역' };
const TOOL_HINTS = {
    'add:RACK': '랙을 놓을 건물 안을 누르세요', 'add:LINE': '바닥 라인을 놓을 건물 안을 누르세요', 'add:AREA': '구역을 놓을 건물 안을 누르세요',
    'add:MARK': '바닥 표시를 놓을 자리를 누르세요', 'add:ARROW': '화살표가 시작할 자리를 누르세요', 'add:REF': '참고 건물을 놓을 자리를 누르세요',
    'add:ANNEX': '부속을 붙일 건물 가까이를 누르세요', 'add:DOOR': '문을 낼 건물 벽 가까이를 누르세요', 'add:PROP': '지게차를 놓을 건물 안을 누르세요',
    calib: '축척 맞추기: 실제 거리를 아는 두 점을 차례로 누르세요 (예: 도로 폭의 양 끝)'
};

const r2 = (v) => Math.round(Number(v) * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clone = (v) => JSON.parse(JSON.stringify(v));
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const IDENT = frameOf({ x: 0, z: 0, rot: 0 });
const splitKey = (key) => { const i = String(key).indexOf(':'); return i < 0 ? [String(key), ''] : [key.slice(0, i), key.slice(i + 1)]; };
const isTyping = (el) => !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
const ownFrame = (o) => frameOf({ x: o.x, z: o.z, rot: o.rot || 0 });
const pointsAttr = (pts) => pts.map(p => `${r2(p[0])},${r2(p[1])}`).join(' ');
const screenPoints = (pts) => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
const NS = 'vector-effect="non-scaling-stroke"'; // 선 굵기는 확대해도 화면 px 그대로

/** 구획 색: 2층 이상 자주 · 랙 주황 · 탱크 보라 · 파렛트 칸 있는 바닥 라인 노랑 · 칸 없는 구역 파랑 */
const zoneStyle = (z) => {
    if (zoneBaseY(z) > 0) return { stroke: '#a21caf', fill: 'rgba(192,38,211,0.16)' };
    if (z.zoneType === 'RACK') return { stroke: '#ea580c', fill: 'rgba(249,115,22,0.2)' };
    if (z.zoneType === 'TANK') return { stroke: '#7c3aed', fill: 'rgba(124,58,237,0.16)' };
    if (zoneCapacity(z)) return { stroke: '#ca8a04', fill: 'rgba(250,204,21,0.25)' };
    return { stroke: '#0284c7', fill: 'rgba(14,165,233,0.13)' };
};
/** 출입문이 붙은 벽: 벽을 따라가는 축(x 또는 z)·벽 길이·벽 위 한 점 → 창고 기준 좌표 */
const wallOf = (wh, wall) => {
    const isAlongX = wall === 'N' || wall === 'S';
    const at = wall === 'N' ? 0 : wall === 'S' ? wh.d : wall === 'W' ? 0 : wh.w;
    return { isAlongX, length: isAlongX ? wh.w : wh.d, point: (along) => (isAlongX ? { x: along, z: at } : { x: at, z: along }) };
};

/**
 * 평면도 편집기를 연다.
 * @param {HTMLElement} host 편집기를 띄울 덮개 (화면을 다 덮는 칸)
 * @param {{ plantId: string, rows: object[], canEdit: boolean, isUnsaved?: boolean, showToast: (message: string, kind?: string) => void,
 *   onSaved?: () => Promise<void>|void, onClose?: () => void }} opts
 *   rows = 그 공장의 배치 줄(창고 + 구획) 사본, isUnsaved = 아직 저장된 적 없는 기본 배치(고치지 않아도 저장할 수 있다),
 *   onClose = 사용자가 닫았을 때 (leave·destroy로 닫을 때는 부르지 않는다)
 * @returns {{ isDirty: () => boolean, close: () => boolean, leave: () => boolean, destroy: () => void }}
 *   close = 닫기(저장 안 한 변경이 있으면 묻는다), leave = 다른 화면으로 갈 때 닫기(방문 기록 표시만 지움), destroy = 묻지 않고 정리
 */
export const openPlanEditor = (host, { plantId, rows, canEdit, isUnsaved = false, showToast, onSaved, onClose }) => {
    const plant = ZONE_PLANTS.find(p => p.id === plantId) || ZONE_PLANTS[0];
    const draft = { rows: clone(rows), extras: clone(plantExtras(plantId)) };
    const snapshot = () => JSON.stringify({ rows: draft.rows, extras: draft.extras });
    let baseline = snapshot();
    let needsFirstSave = isUnsaved;
    const history = { undo: [], redo: [] };
    const view = { scale: 8, tx: 0, ty: 0 };
    let isViewTouched = false;   // 사용자가 화면을 옮기거나 확대했는지 — 그 전에는 칸 크기가 바뀔 때마다 전체가 보이게 다시 맞춘다
    let selected = '';
    let selVertex = -1;          // 고른 꼭짓점 (다각형 건물)
    let tool = 'select';         // select · add:RACK · add:LINE · add:AREA · add:MARK · add:ARROW · add:REF · add:ANNEX · add:DOOR · add:PROP · calib
    let calibFirst = null;       // 축척 맞추기: 첫 점 (전체 좌표)
    let openList = '';           // 물체 목록을 펼친 레이어
    let isBusy = false;
    let isSpaceDown = false;
    let isDestroyed = false;
    let snapStep = 0.1;
    const bg = { url: '', name: '', aspect: 0.707, setting: readBackgroundSetting(plantId, plant.drawing) };

    // ---------- 레이어 보이기·잠금 · 맞춤 간격 (기기별로 기억) ----------
    const layers = Object.fromEntries(LAYERS.map(l => [l.id, { isVisible: true, isLocked: LOCKED_AT_FIRST.includes(l.id) }]));
    try {
        const saved = JSON.parse(localStorage.getItem(LAYER_KEY) || '{}');
        LAYERS.forEach(l => { if (saved[l.id]) Object.assign(layers[l.id], { isVisible: saved[l.id].isVisible !== false, isLocked: !!saved[l.id].isLocked }); });
        const step = localStorage.getItem(SNAP_KEY);
        if (step !== null && (Number(step) === 0 || SNAP_STEPS.includes(Number(step)))) snapStep = Number(step);
    } catch (e) { console.warn('평면도 설정을 읽지 못했습니다.', e); }
    const saveLayers = () => { try { localStorage.setItem(LAYER_KEY, JSON.stringify(layers)); } catch (e) { console.warn('레이어 설정 저장 실패', e); } };
    const isEditable = (layerId) => canEdit && !layers[layerId].isLocked;

    const snap = (v) => r2(snapStep ? Math.round(v / snapStep) * snapStep : v);
    const whRows = () => draft.rows.filter(r => r.kind === 'WAREHOUSE');
    const zoneRows = () => draft.rows.filter(r => r.kind === 'ZONE');
    const whOf = (code) => draft.rows.find(r => r.kind === 'WAREHOUSE' && r.id === code) || null;
    const zoneLayer = (z) => (zoneBaseY(z) > 0 ? 'zone2' : 'zone1');

    /**
     * 고른 것(키) → 물체 · 레이어 · 바깥 기준 좌표(parent). 없으면 null.
     * isBox = 가로 × 세로 상자(크기 손잡이), canRotate = 회전 손잡이, wh = 그 물체가 놓인 창고
     */
    const resolve = (key) => {
        const [kind, id] = splitKey(key);
        const index = Number(id);
        const inWarehouse = (o, more) => { const wh = o ? whOf(o.warehouse) : null; return wh ? { kind, o, wh, parent: frameOf(wh), ...more } : null; };
        switch (kind) {
            case 'WH': { const o = whOf(id); return o ? { kind, o, layer: 'wh', parent: IDENT, isBox: true, canRotate: true } : null; }
            case 'ZONE': { const o = draft.rows.find(r => r.kind === 'ZONE' && r.id === id); return inWarehouse(o, { layer: o ? zoneLayer(o) : 'zone1', isBox: true, canRotate: true }); }
            case 'REF': { const o = draft.extras.buildings[index]; return o ? { kind, o, layer: 'ref', parent: IDENT, isBox: true, canRotate: true } : null; }
            case 'MARK': { const o = draft.extras.floorMarks[index]; return o ? { kind, o, layer: 'site', parent: IDENT, isBox: true, canRotate: false } : null; }
            case 'ARROW': { const o = draft.extras.arrows[index]; return o ? { kind, o, layer: 'site', parent: IDENT } : null; }
            case 'ANNEX': return inWarehouse(draft.extras.annexes[index], { layer: 'fit', isBox: true, canRotate: false });
            case 'DOOR': return inWarehouse(draft.extras.doors[index], { layer: 'fit' });
            case 'PROP': return inWarehouse(draft.extras.props[index], { layer: 'fit' });
            case 'BG': return bg.url ? { kind, o: bg.setting, layer: 'bg', parent: IDENT } : null;
            default: return null;
        }
    };
    /** 물체 기준 → 전체 좌표 변환 (그 순간의 값으로 굳힌 사본) */
    const fullFrame = (item) => joinFrames(item.parent, ownFrame(item.o));
    /** 문이 벽을 벗어나지 않게 */
    const fitDoor = (door) => {
        const wh = whOf(door.warehouse);
        if (!wh) return;
        const length = wallOf(wh, door.wall).length;
        door.from = r2(clamp(door.from, 0, Math.max(0, length - MIN_DOOR)));
        door.to = r2(clamp(door.to, door.from + MIN_DOOR, Math.max(length, door.from + MIN_DOOR)));
    };

    // ---------- 화면 틀 ----------
    host.innerHTML = `
    <div id="pe-root" class="flex flex-col h-full bg-slate-100 text-slate-800">
        <div class="flex flex-wrap items-center gap-2 px-3 py-2 bg-white border-b">
            <div class="font-bold flex items-center gap-1.5"><i data-lucide="layers" class="w-4 h-4 text-blue-600"></i>평면도 ${canEdit ? '편집' : '보기'} · ${esc(plantId)}</div>
            <span id="pe-state" class="text-xs"></span>
            <div class="ml-auto flex flex-wrap items-center gap-1.5">
                ${canEdit ? `<button id="pe-undo" class="px-2 py-1.5 border rounded-lg bg-white hover:bg-slate-50" title="되돌리기 (Ctrl+Z)"><i data-lucide="undo-2" class="w-4 h-4"></i></button>
                <button id="pe-redo" class="px-2 py-1.5 border rounded-lg bg-white hover:bg-slate-50" title="다시 하기 (Ctrl+Y)"><i data-lucide="redo-2" class="w-4 h-4"></i></button>
                <button id="pe-save" class="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-bold flex items-center gap-1" title="저장 (Ctrl+S)"><i data-lucide="save" class="w-4 h-4"></i>저장</button>` : ''}
                <button id="pe-close" class="px-3 py-1.5 border rounded-lg bg-white hover:bg-slate-50 text-sm flex items-center gap-1"><i data-lucide="x" class="w-4 h-4"></i>닫기</button>
            </div>
        </div>
        <div id="pe-tools" class="flex items-center gap-x-3 gap-y-1.5 px-3 py-1.5 bg-white border-b text-xs overflow-x-auto sm:flex-wrap sm:overflow-visible"></div>
        <div class="flex-1 min-h-0 flex flex-col lg:flex-row">
            <div id="pe-stage" class="theme-paper bg-white relative flex-1 min-h-[42vh] overflow-hidden select-none" style="touch-action:none">
                <svg id="pe-svg" class="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
                    <g id="pe-world"><g id="pe-bg-layer"><image id="pe-bg-img" data-key="BG" preserveAspectRatio="none" style="cursor:pointer"/></g><g id="pe-content"></g></g>
                    <g id="pe-over"></g>
                </svg>
                <div id="pe-hud" class="absolute left-2 bottom-2 pointer-events-none text-[11px] bg-slate-900/75 text-white rounded-lg px-2.5 py-1.5 leading-snug max-w-[92%]"></div>
            </div>
            <div class="w-full lg:w-[340px] min-h-0 lg:shrink-0 bg-white border-t lg:border-t-0 lg:border-l overflow-y-auto max-h-[46vh] lg:max-h-none">
                <div id="pe-layers" class="p-3 border-b"></div>
                <div id="pe-props" class="p-3 space-y-2"></div>
            </div>
        </div>
        <input id="pe-file" type="file" accept="image/*" class="hidden">
    </div>`;
    host.classList.remove('hidden');
    const $ = (sel) => host.querySelector(sel);
    const root = $('#pe-root');
    const svg = $('#pe-svg');
    const worldEl = $('#pe-world'), bgLayerEl = $('#pe-bg-layer'), bgImgEl = $('#pe-bg-img'), contentEl = $('#pe-content'), overEl = $('#pe-over');
    const refreshIcons = () => createIcons({ icons });

    // ---------- 화면 ↔ 좌표 ----------
    let rect = { left: 0, top: 0, width: 0, height: 0 }; // 평면도 칸의 화면 자리 (크기가 바뀔 때만 다시 잰다)
    const measure = () => { const r = svg.getBoundingClientRect(); rect = { left: r.left, top: r.top, width: r.width, height: r.height }; };
    const toScreen = (x, z) => ({ x: x * view.scale + view.tx, y: z * view.scale + view.ty });
    const toWorld = (sx, sy) => ({ x: (sx - view.tx) / view.scale, z: (sy - view.ty) / view.scale });
    const eventPoint = (ev) => ({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
    const contentBounds = () => {
        const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
        const add = (x, z) => { b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z); };
        [...whRows(), ...draft.extras.buildings].forEach(o => { const f = ownFrame(o); warehouseOutline(o).forEach(([x, z]) => { const p = f.toWorld(x, z); add(p.x, p.z); }); });
        draft.extras.floorMarks.forEach(m => { add(m.x, m.z); add(m.x + m.w, m.z + m.d); });
        draft.extras.arrows.forEach(a => { add(a.from[0], a.from[1]); add(a.to[0], a.to[1]); });
        return Number.isFinite(b.minX) ? b : { minX: 0, minZ: 0, maxX: 40, maxZ: 30 };
    };
    const fitView = () => {
        if (!rect.width || !rect.height) return;
        const b = contentBounds(), pad = 48;
        view.scale = clamp(Math.min((rect.width - pad * 2) / Math.max(1, b.maxX - b.minX), (rect.height - pad * 2) / Math.max(1, b.maxZ - b.minZ)), MIN_SCALE, MAX_SCALE);
        view.tx = rect.width / 2 - ((b.minX + b.maxX) / 2) * view.scale;
        view.ty = rect.height / 2 - ((b.minZ + b.maxZ) / 2) * view.scale;
    };
    /**
     * 평면도 칸의 크기·자리를 다시 재고, 크기가 바뀌었으면 다시 그린다 (화면을 아직 만지지 않았으면 전체가 보이게 맞춤).
     * 화면 틀의 스타일(Tailwind CDN)은 조금 늦게 붙으므로 처음 잰 크기는 믿을 수 없다 — 크기가 바뀔 때마다 부른다.
     */
    const syncSize = () => {
        const { width, height } = rect;
        measure();
        if (width === rect.width && height === rect.height) return;
        if (!isViewTouched) fitView();
        scheduleDraw();
    };
    const zoomAt = (sx, sy, factor) => {
        isViewTouched = true;
        const before = toWorld(sx, sy);
        view.scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
        view.tx = sx - before.x * view.scale;
        view.ty = sy - before.z * view.scale;
        scheduleDraw();
    };

    // ---------- 되돌리기 ----------
    const isDirty = () => snapshot() !== baseline;
    const pushHistory = () => {
        const now = snapshot();
        if (history.undo[history.undo.length - 1] === now) return;
        history.undo.push(now);
        if (history.undo.length > 100) history.undo.shift();
        history.redo = [];
    };
    const restore = (json) => {
        const v = JSON.parse(json);
        draft.rows = v.rows;
        draft.extras = v.extras;
        selVertex = -1;
        if (!resolve(selected)) selected = '';
    };
    const undo = () => { if (!history.undo.length) return; history.redo.push(snapshot()); restore(history.undo.pop()); renderAll(); };
    const redo = () => { if (!history.redo.length) return; history.undo.push(snapshot()); restore(history.redo.pop()); renderAll(); };

    // ---------- 그리기: 평면 (m 좌표 — 확대·이동은 묶음의 transform으로) ----------
    const whTransform = (wh) => `translate(${wh.x} ${wh.z}) rotate(${Number(wh.rot) || 0})`;
    const layerOpen = (id) => `<g data-layer="${id}" ${layers[id].isLocked ? 'pointer-events="none"' : ''}>`;

    const gridSvg = () => {
        const a = toWorld(0, 0), b = toWorld(rect.width, rect.height);
        let step = view.scale >= 14 ? 1 : 5;
        while ((b.x - a.x) / step > 240) step *= 2;
        const color = (v) => (v === 0 ? '#94a3b8' : Math.round(v) % 5 === 0 ? '#dbe2ea' : '#eef2f6');
        const out = [];
        for (let x = Math.floor(a.x / step) * step; x <= b.x; x += step) out.push(`<line x1="${x}" y1="${a.z}" x2="${x}" y2="${b.z}" stroke="${color(x)}" stroke-width="1" ${NS}/>`);
        for (let z = Math.floor(a.z / step) * step; z <= b.z; z += step) out.push(`<line x1="${a.x}" y1="${z}" x2="${b.x}" y2="${z}" stroke="${color(z)}" stroke-width="1" ${NS}/>`);
        return `<g pointer-events="none">${out.join('')}</g>`;
    };
    /** 건물(창고·참고 건물) 한 채 */
    const buildingSvg = (o, key, isRef) => {
        const isSel = key === selected;
        const isYard = !isRef && Number(o.h) <= 0.6; // 벽 없는 옥외저장소
        return `<g transform="${whTransform(o)}" data-key="${esc(key)}" style="cursor:pointer">
            <polygon points="${pointsAttr(warehouseOutline(o))}" fill="${isRef ? '#e2e8f0' : isYard ? '#f8fafc' : '#eef2f7'}" fill-opacity="${isRef ? 0.7 : 1}"
                stroke="${isSel ? '#2563eb' : isRef ? '#64748b' : '#1e293b'}" stroke-width="${isSel ? 3 : isRef ? 1.5 : 2.2}" ${isYard || isRef ? 'stroke-dasharray="7 4"' : ''} stroke-linejoin="round" ${NS}/></g>`;
    };
    /** 구획 한 줄 (칸이 있으면 칸 선, 채우기 시작하는 쪽에 점) */
    const zoneSvg = (z, wh) => {
        const key = `ZONE:${z.id}`, isSel = key === selected, st = zoneStyle(z);
        const slots = Math.max(0, Math.round(Number(z.slots) || 0));
        const isAlongX = z.w >= z.d;
        const lines = [];
        for (let i = 1; i < slots; i += 1) {
            const t = ((isAlongX ? z.w : z.d) * i) / slots;
            lines.push(isAlongX ? `<line x1="${t}" y1="0" x2="${t}" y2="${z.d}"` : `<line x1="0" y1="${t}" x2="${z.w}" y2="${t}"`);
        }
        const m = Math.min(z.w, z.d) * 0.36, isFromEnd = z.fillFrom === 'END';
        const dot = isAlongX ? [isFromEnd ? z.w - m * 0.6 : m * 0.6, z.d / 2] : [z.w / 2, isFromEnd ? z.d - m * 0.6 : m * 0.6];
        return `<g transform="${whTransform(wh)} translate(${z.x} ${z.z}) rotate(${Number(z.rot) || 0})" data-key="${esc(key)}" style="cursor:pointer">
            <rect width="${z.w}" height="${z.d}" fill="${st.fill}" stroke="${isSel ? '#2563eb' : st.stroke}" stroke-width="${isSel ? 3 : 1.8}" ${slots ? '' : 'stroke-dasharray="5 3"'} ${NS}/>
            ${lines.map(l => `${l} stroke="${st.stroke}" stroke-width="1" ${NS} pointer-events="none"/>`).join('')}
            ${slots ? `<circle cx="${dot[0]}" cy="${dot[1]}" r="${m * 0.3}" fill="${st.stroke}" pointer-events="none"/>` : ''}</g>`;
    };
    /** 화살표: 선 + 끝의 세모 (세모 크기는 화면에서 13px쯤) */
    const arrowSvg = (a, i) => {
        const color = selected === `ARROW:${i}` ? '#2563eb' : '#16a34a';
        const dx = a.to[0] - a.from[0], dz = a.to[1] - a.from[1], len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len, head = Math.min(len * 0.5, 13 / view.scale), half = head * 0.45;
        const bx = a.to[0] - ux * head, bz = a.to[1] - uz * head;
        return `<g data-key="ARROW:${i}" style="cursor:pointer"><line x1="${a.from[0]}" y1="${a.from[1]}" x2="${a.to[0]}" y2="${a.to[1]}" stroke="transparent" stroke-width="16" ${NS}/>
            <line x1="${a.from[0]}" y1="${a.from[1]}" x2="${bx}" y2="${bz}" stroke="${color}" stroke-width="3" ${NS}/>
            <polygon points="${a.to[0]},${a.to[1]} ${bx - uz * half},${bz + ux * half} ${bx + uz * half},${bz - ux * half}" fill="${color}"/></g>`;
    };
    const worldSvg = () => {
        const out = [];
        if (layers.site.isVisible) {
            out.push(layerOpen('site'));
            draft.extras.floorMarks.forEach((m, i) => {
                const isSel = selected === `MARK:${i}`;
                out.push(`<rect data-key="MARK:${i}" x="${m.x}" y="${m.z}" width="${m.w}" height="${m.d}" fill="${esc(m.color)}" fill-opacity="0.22" stroke="${isSel ? '#2563eb' : esc(m.color)}" stroke-width="${isSel ? 3 : 1.5}" ${NS} style="cursor:pointer"/>`);
            });
            draft.extras.arrows.forEach((a, i) => out.push(arrowSvg(a, i)));
            out.push('</g>');
        }
        if (layers.ref.isVisible) out.push(`${layerOpen('ref')}${draft.extras.buildings.map((b, i) => buildingSvg(b, `REF:${i}`, true)).join('')}</g>`);
        if (layers.wh.isVisible) out.push(`${layerOpen('wh')}${whRows().map(wh => buildingSvg(wh, `WH:${wh.id}`, false)).join('')}</g>`);
        if (layers.fit.isVisible) {
            out.push(layerOpen('fit'));
            draft.extras.annexes.forEach((a, i) => {
                const wh = whOf(a.warehouse);
                if (!wh) return;
                const isSel = selected === `ANNEX:${i}`;
                out.push(`<g transform="${whTransform(wh)}"><rect data-key="ANNEX:${i}" x="${a.x}" y="${a.z}" width="${a.w}" height="${a.d}" fill="#cbd5e1" fill-opacity="0.75" stroke="${isSel ? '#2563eb' : '#64748b'}" stroke-width="${isSel ? 3 : 1.2}" ${NS} style="cursor:pointer"/></g>`);
            });
            draft.extras.doors.forEach((d, i) => {
                const wh = whOf(d.warehouse);
                if (!wh) return;
                const wall = wallOf(wh, d.wall), p1 = wall.point(d.from), p2 = wall.point(d.to);
                const line = `x1="${p1.x}" y1="${p1.z}" x2="${p2.x}" y2="${p2.z}"`;
                out.push(`<g transform="${whTransform(wh)}" data-key="DOOR:${i}" style="cursor:pointer"><line ${line} stroke="transparent" stroke-width="18" ${NS}/>
                    <line ${line} stroke="${selected === `DOOR:${i}` ? '#2563eb' : d.style === 'FIXED' ? '#64748b' : '#f97316'}" stroke-width="6" stroke-linecap="round" ${NS}/></g>`);
            });
            draft.extras.props.forEach((p, i) => {
                const wh = whOf(p.warehouse);
                if (!wh) return;
                const isSel = selected === `PROP:${i}`;
                // 지게차: 차체 1.1 × 1.9m + 앞(포크) 방향 세모
                out.push(`<g transform="${whTransform(wh)} translate(${p.x} ${p.z}) rotate(${Number(p.rot) || 0})" data-key="PROP:${i}" style="cursor:pointer">
                    <rect x="-0.55" y="-0.75" width="1.1" height="1.9" rx="0.15" fill="#f59e0b" stroke="${isSel ? '#2563eb' : '#92400e'}" stroke-width="${isSel ? 3 : 1.2}" ${NS}/>
                    <path d="M-0.3 -0.75L0 -1.7L0.3 -0.75z" fill="#475569"/></g>`);
            });
            out.push('</g>');
        }
        ['zone1', 'zone2'].forEach(layerId => {
            if (!layers[layerId].isVisible) return;
            out.push(layerOpen(layerId));
            zoneRows().filter(z => zoneLayer(z) === layerId).forEach(z => { const wh = whOf(z.warehouse); if (wh) out.push(zoneSvg(z, wh)); });
            out.push('</g>');
        });
        return out.join('');
    };

    // ---------- 그리기: 화면 좌표 (이름표 · 축척 · 고른 것의 테두리·손잡이·치수) ----------
    const overlaySvg = () => {
        const out = [];
        const text = (p, lines, { size = 11, color = '#0f172a' } = {}) => {
            const lh = size * 1.25, y0 = p.y - ((lines.length - 1) * lh) / 2;
            out.push(`<text x="${p.x.toFixed(1)}" y="${y0.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${size}" font-weight="700" fill="${color}" stroke="#ffffff" stroke-width="3" paint-order="stroke" pointer-events="none">${
                lines.map((l, i) => `<tspan x="${p.x.toFixed(1)}" dy="${i ? lh : 0}"${i ? ` font-weight="500" font-size="${size - 1}"` : ''}>${esc(l)}</tspan>`).join('')}</text>`);
        };
        const sp = (frame, lx, lz) => { const w = frame.toWorld(lx, lz); return toScreen(w.x, w.z); };
        const centerOf = (o) => { const c = outlineCenter(warehouseOutline(o)); return sp(ownFrame(o), c.x, c.z); };
        if (layers.label.isVisible) {
            // 화면에서 작게 보이면 이름만 (글자끼리 겹치지 않게), 더 작은 바닥 표시는 글자를 뺀다
            const isWide = (o) => o.w * view.scale >= 130;
            if (layers.site.isVisible) draft.extras.floorMarks.forEach(m => { if (m.text && Math.max(m.w, m.d) * view.scale >= 44) text(toScreen(m.x + m.w / 2, m.z + m.d / 2), m.text.split('\n').slice(0, isWide(m) ? 2 : 1), { color: '#334155' }); });
            if (layers.ref.isVisible) draft.extras.buildings.forEach(b => text(centerOf(b), isWide(b) ? [b.name || b.id, `${fmt(b.w)}×${fmt(b.d)}m · 재고 위치 아님`] : [b.name || b.id], { size: 12, color: '#475569' }));
            if (layers.wh.isVisible) whRows().forEach(wh => text(centerOf(wh), isWide(wh) ? [`${wh.name || wh.id} · ${wh.id}`, `${fmt(wh.w)}×${fmt(wh.d)}m`] : [wh.name || wh.id], { size: isWide(wh) ? 13 : 11 }));
            zoneRows().forEach(z => {
                const wh = whOf(z.warehouse);
                if (!wh || !layers[zoneLayer(z)].isVisible) return;
                const longPx = Math.max(z.w, z.d) * view.scale;
                if (longPx < 26) return;
                const no = z.id.split('-').pop();
                const at = sp(joinFrames(frameOf(wh), ownFrame(z)), z.w / 2, z.d / 2);
                // 위층 구획 이름은 한 줄 아래에 (같은 자리에 겹친 1층 이름을 가리지 않게)
                text(zoneBaseY(z) > 0 ? { x: at.x, y: at.y + 14 } : at, [longPx < 90 ? no : `${no} ${z.name || ''}${zoneBaseY(z) > 0 ? ` ▲${fmt(z.y)}m` : ''}`], { color: zoneStyle(z).stroke });
            });
        }
        // 축척 막대(왼쪽 위) · 북쪽 표시(오른쪽 위)
        const barM = SCALE_BAR_STEPS.find(n => n * view.scale >= 70) || 100, barW = barM * view.scale;
        out.push(`<g pointer-events="none" stroke="#334155" fill="none" stroke-width="1.5"><path d="M12 14v6h${barW.toFixed(1)}v-6"/><path d="M${rect.width - 22} 46V26m-5 7l5-7l5 7"/></g>
            <g pointer-events="none" font-size="11" font-weight="700" fill="#334155" stroke="#ffffff" stroke-width="3" paint-order="stroke" text-anchor="middle"><text x="${(12 + barW / 2).toFixed(1)}" y="34">${barM}m</text><text x="${rect.width - 22}" y="20">N</text></g>`);
        if (calibFirst) { const p = toScreen(calibFirst.x, calibFirst.z); out.push(`<g pointer-events="none"><circle cx="${p.x}" cy="${p.y}" r="6" fill="none" stroke="#dc2626" stroke-width="2"/><circle cx="${p.x}" cy="${p.y}" r="1.5" fill="#dc2626"/></g>`); }

        const item = resolve(selected);
        if (!item || !layers[item.layer].isVisible) return out.join('');
        const canChange = item.kind === 'BG' ? !layers.bg.isLocked : isEditable(item.layer);
        /** 손잡이: 보이는 모양보다 넓은 투명 원이 잡는 자리 */
        const handle = (p, name, { round = false, cursor = 'crosshair', fill = '#ffffff', title = '' } = {}) => {
            const x = p.x.toFixed(1), y = p.y.toFixed(1);
            out.push(`<g data-handle="${name}" style="cursor:${cursor}"><title>${esc(title)}</title><circle cx="${x}" cy="${y}" r="${HIT}" fill="transparent"/>${round
                ? `<circle cx="${x}" cy="${y}" r="${HANDLE / 2 + 1}" fill="${fill}" stroke="#2563eb" stroke-width="2"/>`
                : `<rect x="${(p.x - HANDLE / 2).toFixed(1)}" y="${(p.y - HANDLE / 2).toFixed(1)}" width="${HANDLE}" height="${HANDLE}" fill="${fill}" stroke="#2563eb" stroke-width="2"/>`}</g>`);
        };
        /** 치수 글자: a → b 변의 오른쪽(진행 방향 기준)으로 14px 띄워 적는다 */
        const dimension = (a, b, label) => {
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            out.push(`<text x="${((a.x + b.x) / 2 - ((b.y - a.y) / len) * 14).toFixed(1)}" y="${((a.y + b.y) / 2 + ((b.x - a.x) / len) * 14).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="#1d4ed8" stroke="#ffffff" stroke-width="3" paint-order="stroke" pointer-events="none">${esc(label)}</text>`);
        };
        const frameBox = (corners) => out.push(`<polygon points="${screenPoints(corners)}" fill="none" stroke="#2563eb" stroke-width="1" stroke-dasharray="4 3" pointer-events="none"/>`);

        if (item.isBox) {
            const o = item.o, f = fullFrame(item);
            const corners = [sp(f, 0, 0), sp(f, o.w, 0), sp(f, o.w, o.d), sp(f, 0, o.d)];
            frameBox(corners);
            dimension(corners[3], corners[2], `${fmt(o.w)}m`); // 가로: 아래 변 밖
            dimension(corners[0], corners[3], `${fmt(o.d)}m`); // 세로: 왼쪽 변 밖
            if (!canChange) return out.join('');
            if (hasOutline(o)) {
                const pts = warehouseOutline(o);
                pts.forEach(([x, z], i) => {
                    const [x2, z2] = pts[(i + 1) % pts.length];
                    handle(sp(f, (x + x2) / 2, (z + z2) / 2), `addv:${i}`, { round: true, fill: '#dbeafe', cursor: 'copy', title: '변 가운데 — 눌러서 꼭짓점 넣기' });
                });
                pts.forEach(([x, z], i) => handle(sp(f, x, z), `vertex:${i}`, { fill: i === selVertex ? '#2563eb' : '#ffffff', cursor: 'move', title: '꼭짓점 — 끌어서 옮기기 (고른 뒤 Delete = 지우기)' }));
            } else {
                // 화면에서 작게 보이는 물체는 손잡이를 줄인다 (서로 겹치지 않고, 몸통 가운데를 잡고 옮길 수 있게):
                // 아주 작으면 오른쪽 아래 하나, 가늘고 긴 것(랙·라인)은 양 끝 둘(길이 — 폭은 확대하거나 속성에서), 작은 네모는 모서리 넷
                const sw = o.w * view.scale, sh = o.d * view.scale;
                const corner = [['nw', 0, 0], ['ne', o.w, 0], ['se', o.w, o.d], ['sw', 0, o.d]];
                const ends = { flat: [['e', o.w, o.d / 2], ['w', 0, o.d / 2]], slim: [['n', o.w / 2, 0], ['s', o.w / 2, o.d]] };
                const isFlat = sh < 48, isSlim = sw < 48;
                const spots = sw < 28 && sh < 28 ? [corner[2]] : isFlat && isSlim ? corner : isFlat ? ends.flat : isSlim ? ends.slim : [...corner, ...ends.flat, ...ends.slim];
                spots.forEach(([name, lx, lz]) => handle(sp(f, lx, lz), `resize:${name}`, { title: '크기 바꾸기' }));
            }
            if (item.canRotate) {
                const top = sp(f, o.w / 2, 0), mid = sp(f, o.w / 2, o.d / 2);
                const len = Math.hypot(top.x - mid.x, top.y - mid.y) || 1;
                const at = { x: top.x + ((top.x - mid.x) / len) * 26, y: top.y + ((top.y - mid.y) / len) * 26 };
                out.push(`<line x1="${top.x.toFixed(1)}" y1="${top.y.toFixed(1)}" x2="${at.x.toFixed(1)}" y2="${at.y.toFixed(1)}" stroke="#2563eb" stroke-width="1" pointer-events="none"/>`);
                handle(at, 'rotate', { round: true, fill: '#bfdbfe', cursor: 'grab', title: '돌리기 (Shift = 15°씩)' });
            }
        } else if (item.kind === 'ARROW') {
            if (canChange) {
                handle(toScreen(item.o.from[0], item.o.from[1]), 'arrow:from', { round: true, cursor: 'move', title: '화살표 시작' });
                handle(toScreen(item.o.to[0], item.o.to[1]), 'arrow:to', { round: true, cursor: 'move', title: '화살표 끝' });
            }
        } else if (item.kind === 'DOOR') {
            const wall = wallOf(item.wh, item.o.wall);
            const a = wall.point(item.o.from), b = wall.point(item.o.to);
            const pa = sp(item.parent, a.x, a.z), pb = sp(item.parent, b.x, b.z);
            dimension(pa, pb, `${fmt(item.o.to - item.o.from)}m`);
            if (canChange) { handle(pa, 'door:from', { cursor: 'move', title: '문 시작' }); handle(pb, 'door:to', { cursor: 'move', title: '문 끝' }); }
        } else if (item.kind === 'PROP') {
            if (canChange) handle(sp(fullFrame(item), 0, -2.4), 'prop:rot', { round: true, fill: '#bfdbfe', cursor: 'grab', title: '방향 돌리기 (Shift = 15°씩)' });
        } else if (item.kind === 'BG') {
            const s = bg.setting, h = s.widthM * bg.aspect;
            const corners = [toScreen(s.x, s.z), toScreen(s.x + s.widthM, s.z), toScreen(s.x + s.widthM, s.z + h), toScreen(s.x, s.z + h)];
            frameBox(corners);
            dimension(corners[3], corners[2], `${fmt(s.widthM)}m`);
            if (canChange) handle(corners[2], 'bg:scale', { cursor: 'nwse-resize', title: '그림 크기 (가로 폭)' });
        }
        return out.join('');
    };

    let drawQueued = 0, drawTimer = 0;
    const drawSvg = () => {
        cancelAnimationFrame(drawQueued);
        clearTimeout(drawTimer);
        drawQueued = 0;
        if (isDestroyed) return;
        worldEl.setAttribute('transform', `translate(${view.tx.toFixed(2)} ${view.ty.toFixed(2)}) scale(${view.scale.toFixed(4)})`);
        // 배경 그림은 다시 만들지 않고 값만 바꾼다 (끄는 동안 깜박이지 않게)
        const isBgOn = !!bg.url && layers.bg.isVisible;
        bgLayerEl.setAttribute('display', isBgOn ? 'inline' : 'none');
        bgLayerEl.setAttribute('pointer-events', layers.bg.isLocked ? 'none' : 'auto');
        if (isBgOn) {
            if (bgImgEl.getAttribute('href') !== bg.url) bgImgEl.setAttribute('href', bg.url);
            const s = bg.setting;
            Object.entries({ x: s.x, y: s.z, width: s.widthM, height: s.widthM * bg.aspect, opacity: s.opacity }).forEach(([k, v]) => bgImgEl.setAttribute(k, v));
        }
        contentEl.innerHTML = gridSvg() + worldSvg();
        overEl.innerHTML = overlaySvg();
        svg.style.cursor = tool === 'select' ? (isSpaceDown ? 'grab' : 'default') : 'crosshair';
    };
    // 화면이 가려져 있으면 requestAnimationFrame이 멈추므로 타이머로도 그린다
    const scheduleDraw = () => {
        if (drawQueued) return;
        drawQueued = requestAnimationFrame(drawSvg);
        drawTimer = setTimeout(drawSvg, 150);
    };

    // ---------- 물체 이름·요약 ----------
    const itemTitle = (key, item) => {
        const o = item.o;
        switch (item.kind) {
            case 'WH': case 'ZONE': return `${o.id} ${o.name || ''}`;
            case 'REF': return o.name || o.id;
            case 'MARK': return `바닥 표시 ${String(o.text || '').split('\n')[0]}`;
            case 'ARROW': return '화살표';
            case 'ANNEX': return `${o.warehouse} 부속`;
            case 'DOOR': return o.name || `${o.warehouse} ${WALL_NAMES[o.wall]} 출입문`;
            case 'PROP': return o.name || '지게차';
            case 'BG': return `배경 도면 ${bg.name}`;
            default: return key;
        }
    };
    const itemSummary = (item) => {
        const o = item.o;
        if (item.isBox) return ` · x ${fmt(o.x)} z ${fmt(o.z)} · ${fmt(o.w)}×${fmt(o.d)}m${item.canRotate ? ` · ${fmt(o.rot || 0)}°` : ''}`;
        if (item.kind === 'DOOR') return ` · ${WALL_NAMES[o.wall]} ${fmt(o.from)}~${fmt(o.to)}m`;
        if (item.kind === 'PROP') return ` · x ${fmt(o.x)} z ${fmt(o.z)} · ${fmt(o.rot || 0)}°`;
        if (item.kind === 'BG') return ` · 가로 ${fmt(o.widthM)}m`;
        return '';
    };
    /** 레이어의 물체 목록 [키, 이름] */
    const itemsOfLayer = (layerId) => {
        switch (layerId) {
            case 'bg': return bg.url ? [['BG', bg.name || '배경 도면']] : [];
            case 'site': return [...draft.extras.floorMarks.map((m, i) => [`MARK:${i}`, `바닥 표시 · ${String(m.text || '').split('\n')[0] || '(글자 없음)'}`]), ...draft.extras.arrows.map((a, i) => [`ARROW:${i}`, `화살표 ${i + 1}`])];
            case 'ref': return draft.extras.buildings.map((b, i) => [`REF:${i}`, b.name || b.id]);
            case 'wh': return whRows().map(wh => [`WH:${wh.id}`, `${wh.id} ${wh.name || ''}`]);
            case 'fit': return [...draft.extras.annexes.map((a, i) => [`ANNEX:${i}`, `부속 ${i + 1} · ${a.warehouse}`]), ...draft.extras.doors.map((d, i) => [`DOOR:${i}`, d.name || `출입문 · ${d.warehouse} ${WALL_NAMES[d.wall]}`]),
                ...draft.extras.props.map((p, i) => [`PROP:${i}`, `${p.name || '지게차'} · ${p.warehouse}`])];
            case 'zone1': case 'zone2': return zoneRows().filter(z => zoneLayer(z) === layerId).sort((a, b) => a.id.localeCompare(b.id)).map(z => [`ZONE:${z.id}`, `${z.id} ${z.name || ''}`]);
            default: return [];
        }
    };

    // ---------- 위쪽 도구줄 · 상태 · 안내 ----------
    const renderTools = () => {
        const TOOL_BTN = 'shrink-0 whitespace-nowrap min-h-[34px] sm:min-h-0 rounded-md border'; // 스마트폰은 손가락 크기
        const btn = (id, label, title, isOn = false) => `<button data-tool="${id}" title="${esc(title)}" class="${TOOL_BTN} px-2 py-1 ${isOn ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-slate-50'}">${label}</button>`;
        const addBtn = (id, label, title) => btn(`add:${id}`, `+ ${label}`, title, tool === `add:${id}`);
        const viewBtn = (id, icon, title) => `<button data-view="${id}" class="${TOOL_BTN} min-w-[34px] sm:min-w-0 px-1.5 py-1 bg-white hover:bg-slate-50" title="${title}"><i data-lucide="${icon}" class="w-3.5 h-3.5"></i></button>`;
        $('#pe-tools').innerHTML = `
            ${btn('select', '<i data-lucide="mouse-pointer-2" class="w-3.5 h-3.5 inline"></i> 고르기', '눌러서 고르고 끌어서 옮기기 (Esc)', tool === 'select')}
            ${canEdit ? `<span class="flex items-center gap-1 shrink-0"><b class="text-slate-500 shrink-0">구획</b>
                ${addBtn('RACK', '랙', '파렛트랙 한 줄 (6칸 × 3단) — 놓은 뒤 길이·칸 수를 고친다')}${addBtn('LINE', '바닥 라인', '바닥 적재 열 (파렛트 6개 × 2단)')}${addBtn('AREA', '구역', '칸 없는 구역 (층 구역 등 — 속성에서 바닥 높이를 주면 2층)')}</span>
            <span class="flex items-center gap-1 shrink-0"><b class="text-slate-500 shrink-0">주변</b>
                ${addBtn('MARK', '바닥 표시', '바닥에 칠한 사각형 + 글자 (도로·출입구 등)')}${addBtn('ARROW', '화살표', '바닥 화살표')}${addBtn('REF', '참고 건물', '재고 위치가 아닌 건물 (사무실동 등)')}
                ${addBtn('ANNEX', '부속', '건물에 붙은 작은 부속 (현관·캐노피)')}${addBtn('DOOR', '출입문', '건물 벽의 출입문')}${addBtn('PROP', '지게차', '지게차 모형')}</span>
            <label class="flex items-center gap-1 shrink-0 whitespace-nowrap" title="옮기거나 크기를 바꿀 때 이 간격에 맞춘다"><i data-lucide="magnet" class="w-3.5 h-3.5 text-slate-500"></i>맞춤
                <select id="pe-snap" class="border rounded px-1 py-0.5 min-h-[34px] sm:min-h-0"><option value="0" ${snapStep === 0 ? 'selected' : ''}>끔</option>${SNAP_STEPS.map(s => `<option value="${s}" ${snapStep === s ? 'selected' : ''}>${s}m</option>`).join('')}</select></label>` : ''}
            <span class="flex items-center gap-1 shrink-0">${viewBtn('out', 'zoom-out', '축소')}${viewBtn('in', 'zoom-in', '확대')}${viewBtn('fit', 'maximize', '전체가 보이게')}</span>
            <span class="flex items-center gap-1 shrink-0"><b class="text-slate-500 shrink-0">배경 도면</b>
                <button id="pe-bg-load" class="${TOOL_BTN} px-2 py-1 bg-white hover:bg-slate-50" title="이 기기의 도면 그림(PNG·JPG)을 밑그림으로 깐다 — 서버로 올리지 않는다"><i data-lucide="image-plus" class="w-3.5 h-3.5 inline"></i> 그림 불러오기</button>
                ${bg.url ? btn('calib', '<i data-lucide="ruler" class="w-3.5 h-3.5 inline"></i> 축척 맞추기', '실제 거리를 아는 두 점을 눌러 그림 크기를 맞춘다', tool === 'calib') : ''}</span>`;
        refreshIcons();
    };
    const canSaveNow = () => canEdit && !isBusy && (needsFirstSave || isDirty());
    const renderState = () => {
        const isChanged = isDirty();
        $('#pe-state').innerHTML = !canEdit ? '<span class="text-slate-500">보기 전용 (고치기는 매니저 이상)</span>'
            : isChanged ? '<b class="text-amber-600">● 저장하지 않은 변경이 있습니다</b>'
                : needsFirstSave ? '<span class="text-amber-600">아직 저장하지 않은 기본 배치 — [저장]하면 구획이 재고 위치가 됩니다</span>' : '<span class="text-emerald-600">저장됨</span>';
        const set = (id, isOff) => { const el = $(id); if (el) { el.disabled = isOff; el.classList.toggle('opacity-40', isOff); } };
        set('#pe-undo', !history.undo.length);
        set('#pe-redo', !history.redo.length);
        set('#pe-save', !canSaveNow());
    };
    const renderHud = (world = null) => {
        const item = resolve(selected);
        const lines = [];
        if (tool !== 'select') lines.push(`<b class="text-amber-300">${esc(tool === 'calib' && calibFirst ? '두 번째 점을 누르세요' : TOOL_HINTS[tool] || '')}</b> · Esc = 그만두기`);
        if (item) lines.push(`<b>${esc(itemTitle(selected, item))}</b>${itemSummary(item)}`);
        if (world) lines.push(`x ${world.x.toFixed(2)} · z ${world.z.toFixed(2)} m`);
        if (!lines.length) lines.push(canEdit ? '눌러서 고르고 끌어서 옮깁니다 · 빈 곳 끌기 = 화면 옮기기 · 휠 = 확대' : '빈 곳 끌기 = 화면 옮기기 · 휠 = 확대');
        $('#pe-hud').innerHTML = lines.join('<br>');
    };

    // ---------- 오른쪽: 레이어 ----------
    const hasChangedExtras = () => JSON.stringify(cleanExtras(draft.extras)) !== JSON.stringify(defaultPlantExtras(plantId));
    const renderLayers = () => {
        $('#pe-layers').innerHTML = `
            <div class="flex items-center justify-between mb-1"><b class="text-sm">레이어</b><span class="text-[11px] text-slate-400">눈 = 보이기 · 자물쇠 = 잠금</span></div>
            ${[...LAYERS].reverse().map(l => {
                const st = layers[l.id], list = itemsOfLayer(l.id), hasList = l.id !== 'label';
                return `<div class="border-t first:border-t-0">
                    <div class="flex items-center gap-1 py-0.5 text-xs" title="${esc(l.hint)}">
                        <button data-eye="${l.id}" class="p-1.5 sm:p-1 rounded hover:bg-slate-100 ${st.isVisible ? 'text-slate-700' : 'text-slate-300'}" title="${st.isVisible ? '숨기기' : '보이기'}"><i data-lucide="${st.isVisible ? 'eye' : 'eye-off'}" class="w-4 h-4"></i></button>
                        ${hasList ? `<button data-lock="${l.id}" class="p-1.5 sm:p-1 rounded hover:bg-slate-100 ${st.isLocked ? 'text-amber-600' : 'text-slate-300'}" title="${st.isLocked ? '잠금 풀기 (평면도에서 고를 수 있게)' : '잠그기 (눌러도 고르지 않게)'}"><i data-lucide="${st.isLocked ? 'lock' : 'lock-open'}" class="w-4 h-4"></i></button>` : '<span class="w-7 sm:w-6"></span>'}
                        <button data-open="${l.id}" class="flex-1 text-left py-1.5 sm:py-0.5 ${st.isVisible ? '' : 'text-slate-400'}"><b>${esc(l.name)}</b>${hasList ? ` <span class="text-slate-400">${list.length}</span>` : ''}</button>
                    </div>
                    ${openList === l.id && hasList ? `<div class="pl-9 pb-1.5 space-y-0.5">${list.map(([key, name]) => `<button data-pick="${esc(key)}" class="tap-compact block w-full text-left text-[11px] px-1.5 py-1.5 sm:py-0.5 rounded ${key === selected ? 'bg-blue-100 text-blue-800 font-bold' : 'hover:bg-slate-100 text-slate-600'}">${esc(name)}</button>`).join('') || '<span class="text-[11px] text-slate-400">없음</span>'}</div>` : ''}
                </div>`;
            }).join('')}
            ${canEdit && hasChangedExtras() ? '<button data-act="extras-default" class="mt-2 px-2 py-1 min-h-[34px] sm:min-h-0 rounded-lg text-[11px] border bg-white hover:bg-slate-50" title="주변 표시·참고 건물·부속·출입문·장비를 처음 값(앱 기본값)으로 — [저장]을 눌러야 반영">주변·참고·부속을 기본값으로</button>' : ''}`;
        refreshIcons();
    };

    // ---------- 오른쪽: 속성 ----------
    /** 속성 칸에 보일 값 */
    const propValue = (item, prop) => {
        const o = item.o;
        switch (prop) {
            case 'fx': return o.from[0];
            case 'fz': return o.from[1];
            case 'tx': return o.to[0];
            case 'tz': return o.to[1];
            case 'rot': return o.rot || 0;
            case 'y': return o.y || 0;
            case 'slots': return o.slots || 0;
            case 'tiers': return o.tiers || 1;
            case 'fillFrom': return o.fillFrom === 'END' ? 'END' : 'START';
            case 'slide': return o.slide > 0 ? 1 : -1;
            default: return o[prop] ?? '';
        }
    };
    const zoneInfoHtml = (z) => {
        const slots = Math.max(0, Math.round(Number(z.slots) || 0)), tiers = Math.max(1, Math.round(Number(z.tiers) || 1));
        const stock = zoneStock(z).length;
        return `${slots ? `파렛트 칸 ${slots} × ${tiers}단 = <b>${slots * tiers}칸</b> · 칸 간격 ${fmt(Math.max(z.w, z.d) / slots)}m` : '칸 없는 구역 (보관 품목이 한 덩어리로 보임)'}${stock ? ` · <b class="text-amber-700">재고 ${stock}품목</b>` : ''}`;
    };
    const propsHtml = () => {
        const item = resolve(selected);
        if (!item) return `<p class="text-xs text-slate-500">평면도나 레이어 목록에서 건물·구획·표시를 고르면 여기서 숫자로 고칠 수 있습니다.${canEdit ? ' 잠긴 레이어(자물쇠)는 평면도에서 눌러도 고를 수 없으니, 끌어서 고치려면 자물쇠를 푸세요.' : ''}</p>`;
        const o = item.o;
        const off = canEdit ? '' : 'disabled';
        const field = (label, prop, { type = 'number', step = 0.1, min = '', unit = '', title = '' } = {}) => `
            <label class="flex items-center justify-between gap-2" title="${esc(title)}"><span class="text-slate-500 shrink-0">${esc(label)}</span>
                <span class="flex items-center gap-1"><input data-prop="${prop}" type="${type}" ${type === 'number' ? `step="${step}" ${min !== '' ? `min="${min}"` : ''}` : ''} value="${esc(propValue(item, prop))}" ${off}
                    class="${type === 'number' ? 'w-24 text-right' : 'w-40'} border rounded px-1.5 py-1"><span class="text-slate-400 w-5">${esc(unit)}</span></span></label>`;
        const selectField = (label, prop, options) => `
            <label class="flex items-center justify-between gap-2"><span class="text-slate-500 shrink-0">${esc(label)}</span>
                <span class="flex items-center gap-1"><select data-prop="${prop}" ${off} class="w-40 border rounded px-1.5 py-1">${options.map(([v, text]) => `<option value="${esc(v)}" ${String(v) === String(propValue(item, prop)) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select><span class="w-5"></span></span></label>`;
        const ACT_BTN = 'px-2.5 py-1 min-h-[34px] sm:min-h-0 rounded-lg text-xs';
        const act = (id, label, tone = 'border bg-white hover:bg-slate-50') => (canEdit ? `<button data-act="${id}" class="${ACT_BTN} ${tone}">${label}</button>` : '');
        const delBtn = act('delete', '지우기', 'border border-red-200 text-red-600 hover:bg-red-50');
        const whOptions = whRows().map(wh => [wh.id, `${wh.id} ${wh.name || ''}`]);
        const isSite = item.parent === IDENT;
        const xz = `${field(isSite ? 'x (동쪽 +)' : 'x (창고 기준)', 'x', { unit: 'm' })}${field(isSite ? 'z (남쪽 +)' : 'z (창고 기준)', 'z', { unit: 'm' })}`;
        const size = `${field('가로', 'w', { min: MIN_SIZE, unit: 'm' })}${field('세로', 'd', { min: MIN_SIZE, unit: 'm' })}`;
        const outlineRow = () => `<div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">${hasOutline(o)
            ? `바닥이 다각형(${warehouseOutline(o).length}점)입니다 — 꼭짓점을 끌어 고치고, 변 가운데 동그라미로 점을 넣습니다. ${act('rect', '사각형으로')}`
            : `바닥이 사각형입니다. ${act('polygon', '다각형으로 (꼭짓점 편집)')}`}</div>`;
        let body = '';
        switch (item.kind) {
            case 'WH':
                body = `${field('이름', 'name', { type: 'text' })}${xz}${size}${field('벽 높이', 'h', { min: 0.1, unit: 'm', title: '0.6m 이하면 벽 없는 옥외(바닥 턱만)로 그립니다' })}${field('회전', 'rot', { step: 0.5, unit: '°', title: '위에서 볼 때 시계 방향' })}${outlineRow()}
                    <p class="text-[11px] text-slate-500">건물을 옮기거나 돌리면 그 안의 구획·부속·출입문도 같이 움직입니다. 창고코드(${esc(o.id)})는 재고 위치라 바꾸거나 지울 수 없습니다.</p>`;
                break;
            case 'ZONE':
                body = `${field('이름', 'name', { type: 'text' })}${selectField('종류', 'zoneType', Object.entries(ZONE_TYPES))}${xz}${size}${field('높이', 'h', { min: 0.1, unit: 'm' })}
                    ${field('회전', 'rot', { step: 0.5, unit: '°', title: '창고 기준으로 돌린 각도 — 비스듬한 벽을 따라 놓을 때' })}${field('바닥 높이', 'y', { min: 0, unit: 'm', title: '2층처럼 위에 있는 구획이면 그 바닥 높이 (0 = 창고 바닥)' })}
                    ${field('칸 수 (한 줄)', 'slots', { step: 1, min: 0, title: '한 줄에 놓이는 파렛트 수 (0 = 칸 없음)' })}${field('단 수', 'tiers', { step: 1, min: 1 })}
                    ${selectField('채우는 쪽', 'fillFrom', [['START', '시작 쪽부터 (점 표시)'], ['END', '반대쪽부터']])}
                    <div id="pe-zone-info" class="text-[11px] text-slate-600">${zoneInfoHtml(o)}</div>
                    <div class="flex flex-wrap gap-1.5">${act('fit-slots', `길이에 맞춰 칸 수 (${RACK_LINE.pitch}m 간격)`)}${act('duplicate', '복제')}${delBtn}</div>
                    <p class="text-[11px] text-slate-500">구획코드(${esc(o.id)})는 저장하면 재고 위치 이름이 됩니다. 재고가 남은 구획은 지울 수 없습니다.</p>`;
                break;
            case 'REF':
                body = `${field('이름', 'name', { type: 'text' })}${xz}${size}${field('높이', 'h', { min: 0.1, unit: 'm' })}${field('회전', 'rot', { step: 0.5, unit: '°' })}${outlineRow()}
                    <div class="flex flex-wrap gap-1.5">${delBtn}</div>`;
                break;
            case 'MARK':
                body = `<label class="block"><span class="text-slate-500">글자 (줄을 바꿔 두 줄까지)</span><textarea data-prop="text" rows="2" ${off} class="w-full border rounded px-1.5 py-1 mt-0.5">${esc(o.text || '')}</textarea></label>
                    <label class="flex items-center justify-between gap-2"><span class="text-slate-500">색</span><input data-prop="color" type="color" value="${esc(o.color)}" ${off} class="w-24 h-7 border rounded"></label>${xz}${size}
                    <div class="flex flex-wrap gap-1.5">${act('duplicate', '복제')}${delBtn}</div>`;
                break;
            case 'ARROW':
                body = `${field('시작 x', 'fx', { unit: 'm' })}${field('시작 z', 'fz', { unit: 'm' })}${field('끝 x', 'tx', { unit: 'm' })}${field('끝 z', 'tz', { unit: 'm' })}
                    <div class="flex flex-wrap gap-1.5">${delBtn}</div>`;
                break;
            case 'ANNEX':
                body = `${selectField('건물', 'warehouse', whOptions)}${xz}${size}<div class="flex flex-wrap gap-1.5">${act('duplicate', '복제')}${delBtn}</div>`;
                break;
            case 'DOOR':
                body = `${field('이름', 'name', { type: 'text' })}${selectField('건물', 'warehouse', whOptions)}${selectField('벽', 'wall', Object.entries(WALL_NAMES))}
                    ${field('시작', 'from', { min: 0, unit: 'm', title: '벽의 왼쪽(위쪽) 끝에서 잰 거리' })}${field('끝', 'to', { min: 0, unit: 'm' })}${selectField('모양', 'style', Object.entries(DOOR_STYLES))}
                    ${o.style === 'SLIDE' ? selectField('밀리는 쪽', 'slide', [[-1, '시작 쪽으로'], [1, '끝 쪽으로']]) : ''}
                    <p class="text-[11px] text-slate-500">3D에서 문짝 모양으로 보입니다. 바닥이 다각형인 건물은 벽을 비우지 않고 문짝만 겹쳐 그립니다.</p>
                    <div class="flex flex-wrap gap-1.5">${act('duplicate', '복제')}${delBtn}</div>`;
                break;
            case 'PROP':
                body = `${field('이름', 'name', { type: 'text' })}${selectField('건물', 'warehouse', whOptions)}${xz}${field('방향', 'rot', { step: 5, unit: '°', title: '앞(포크)이 향하는 쪽: 0 위 · 90 오른쪽 · 180 아래 · 270 왼쪽' })}
                    <div class="flex flex-wrap gap-1.5">${act('duplicate', '복제')}${delBtn}</div>`;
                break;
            case 'BG': {
                const bgField = (label, prop, unit, more = '') => `<label class="flex items-center justify-between gap-2"><span class="text-slate-500">${label}</span><span class="flex items-center gap-1"><input data-bg="${prop}" type="number" step="0.1" ${more} value="${r2(o[prop])}" class="w-24 text-right border rounded px-1.5 py-1"><span class="text-slate-400 w-5">${unit}</span></span></label>`;
                body = `<p class="text-[11px] text-slate-500">이 기기에만 있는 밑그림입니다(저장·공유되지 않음). 레이어의 자물쇠를 풀면 끌어서 옮기고 오른쪽 아래 손잡이로 크기를 바꿉니다. 실제 거리를 아는 두 점이 있으면 위쪽 [축척 맞추기]가 빠릅니다.</p>
                    ${bgField('왼쪽 위 x', 'x', 'm')}${bgField('왼쪽 위 z', 'z', 'm')}${bgField('그림 가로 폭', 'widthM', 'm', 'min="1"')}
                    <label class="flex items-center justify-between gap-2"><span class="text-slate-500">진하기</span><input data-bg="opacity" type="range" min="0.05" max="1" step="0.05" value="${o.opacity}" class="w-32"></label>
                    <div class="flex flex-wrap gap-1.5"><button data-act="bg-reset" class="${ACT_BTN} border bg-white hover:bg-slate-50">처음 맞춤값으로</button>
                        <button data-act="bg-remove" class="${ACT_BTN} border border-red-200 text-red-600 hover:bg-red-50">그림 지우기</button></div>`;
                break;
            }
            default: break;
        }
        const lockNote = canEdit && item.kind !== 'BG' && layers[item.layer].isLocked ? '<p class="text-[11px] text-amber-700">이 레이어는 잠겨 있어 평면도에서 끌 수 없습니다 (숫자는 고칠 수 있음).</p>' : '';
        return `<div class="flex items-center justify-between gap-2"><b class="text-sm">${esc(itemTitle(selected, item))}</b><span class="text-[11px] text-slate-400 shrink-0">${esc(KIND_NAMES[item.kind])}</span></div>
            ${lockNote}<div class="space-y-1.5 text-xs">${body}</div>`;
    };
    const renderProps = () => { $('#pe-props').innerHTML = propsHtml(); };
    /** 속성 칸의 값을 지금 값으로 맞춘다 (끌어서 고치는 동안·칸에서 나올 때 — 다시 그리지 않아 입력 중인 칸이 그대로다) */
    const syncPropInputs = (skip = null) => {
        const item = resolve(selected);
        if (!item) return;
        $('#pe-props').querySelectorAll('[data-prop]').forEach(el => {
            if (el === skip || el.type === 'color' || el.tagName === 'TEXTAREA') return;
            const value = propValue(item, el.dataset.prop);
            const text = typeof value === 'number' ? String(r2(value)) : String(value);
            if (el.value !== text) el.value = text;
        });
        $('#pe-props').querySelectorAll('[data-bg]').forEach(el => { if (el !== skip && el.type === 'number') el.value = String(r2(bg.setting[el.dataset.bg])); });
        const info = $('#pe-zone-info');
        if (info && item.kind === 'ZONE') info.innerHTML = zoneInfoHtml(item.o);
    };
    const renderAll = () => { drawSvg(); renderLayers(); renderProps(); renderTools(); renderState(); renderHud(); };

    const select = (key, vertex = -1) => {
        selected = resolve(key) ? key : '';
        selVertex = selected ? vertex : -1;
        const item = resolve(selected);
        if (item) openList = item.layer;
    };
    const setTool = (next) => { tool = next; calibFirst = null; renderTools(); renderHud(); scheduleDraw(); };
    /** 그 레이어를 보이게 하고 잠금을 푼다 (새로 놓은 것·다각형으로 바꾼 것을 바로 고칠 수 있게) */
    const openLayer = (layerId) => {
        if (layers[layerId].isVisible && !layers[layerId].isLocked) return;
        Object.assign(layers[layerId], { isVisible: true, isLocked: false });
        saveLayers();
    };

    // ---------- 고치기: 건물 원점이 바뀔 때 안의 것들을 제자리에 ----------
    /** 창고 원점이 창고 기준으로 (dx, dz)만큼 옮겨졌을 때 그 안의 구획·부속·장비·출입문 좌표를 맞춘다 (전체에서 본 자리는 그대로) */
    const shiftChildren = (whId, dx, dz) => {
        if (!dx && !dz) return;
        zoneRows().filter(z => z.warehouse === whId).forEach(z => { z.x = r2(z.x - dx); z.z = r2(z.z - dz); });
        [...draft.extras.annexes, ...draft.extras.props].filter(a => a.warehouse === whId).forEach(a => { a.x = r2(a.x - dx); a.z = r2(a.z - dz); });
        draft.extras.doors.filter(d => d.warehouse === whId).forEach(d => {
            const shift = d.wall === 'N' || d.wall === 'S' ? dx : dz;
            d.from = r2(d.from - shift); d.to = r2(d.to - shift);
        });
    };
    /** 끌기 시작 때 창고 안의 것들 좌표를 적어 둔다 → 끄는 동안 매번 처음 값에서 다시 계산 */
    const childrenOf = (whId) => ({
        spots: [...zoneRows(), ...draft.extras.annexes, ...draft.extras.props].filter(a => a.warehouse === whId).map(a => [a, a.x, a.z]),
        doors: draft.extras.doors.filter(d => d.warehouse === whId).map(d => [d, d.from, d.to])
    });
    const restoreChildren = (saved) => {
        saved.spots.forEach(([a, x, z]) => { a.x = x; a.z = z; });
        saved.doors.forEach(([d, from, to]) => { d.from = from; d.to = to; });
    };
    /** 다각형 외곽선을 고친 뒤: 가장 왼쪽 위가 (0, 0)이 되게 원점을 옮기고 가로·세로를 다시 잰다 */
    const rebaseOutline = (item) => {
        const o = item.o;
        if (!hasOutline(o)) return;
        const xs = o.outline.map(p => p[0]), zs = o.outline.map(p => p[1]);
        const minX = Math.min(...xs), minZ = Math.min(...zs);
        if (minX || minZ) {
            const origin = ownFrame(o).toWorld(minX, minZ);
            o.outline = o.outline.map(([x, z]) => [r2(x - minX), r2(z - minZ)]);
            o.x = r2(origin.x); o.z = r2(origin.z);
            if (item.kind === 'WH') shiftChildren(o.id, minX, minZ);
        }
        o.w = r2(Math.max(...xs) - minX);
        o.d = r2(Math.max(...zs) - minZ);
    };

    // ---------- 끌기 ----------
    /** @type {null|{ type: string, start: { x: number, y: number }, hasMoved: boolean, slop: number, [k: string]: any }} */
    let drag = null;
    const pointers = new Map(); // 누르고 있는 손가락 (두 손가락 = 확대·이동)
    let pinch = null;
    const angleAt = (c, world) => (Math.atan2(world.z - c.z, world.x - c.x) * 180) / Math.PI;

    const beginEdit = (type, world, extra = {}) => {
        const item = resolve(selected);
        return { type, startWorld: world, item, before: clone(item.o), frame: item.isBox ? fullFrame(item) : item.parent, ...extra };
    };
    const applyDrag = (world, ev) => {
        const { item, before } = drag;
        const o = item.o;
        const delta = { x: world.x - drag.startWorld.x, z: world.z - drag.startWorld.z };
        switch (drag.type) {
            case 'move': {
                if (item.kind === 'ARROW') {
                    o.from = [snap(before.from[0] + delta.x), snap(before.from[1] + delta.z)];
                    o.to = [r2(o.from[0] + before.to[0] - before.from[0]), r2(o.from[1] + before.to[1] - before.from[1])];
                    break;
                }
                if (item.kind === 'BG') { o.x = r2(before.x + delta.x); o.z = r2(before.z + delta.z); break; }
                const local = item.parent.toLocalDir(delta.x, delta.z);
                if (item.kind === 'DOOR') {
                    const wall = wallOf(item.wh, o.wall), length = before.to - before.from;
                    o.from = clamp(snap(before.from + (wall.isAlongX ? local.x : local.z)), 0, Math.max(0, r2(wall.length - length)));
                    o.to = r2(o.from + length);
                    break;
                }
                o.x = snap(before.x + local.x);
                o.z = snap(before.z + local.z);
                break;
            }
            case 'resize': {
                // 끌기 시작 때의 물체 기준 좌표로 잰다 (끄는 동안 원점이 바뀌어도 흔들리지 않게)
                const p = drag.frame.toLocal(world.x, world.z);
                const name = drag.handle;
                const left = name.includes('w') ? Math.min(snap(p.x), before.w - MIN_SIZE) : 0;
                const right = name.includes('e') ? Math.max(snap(p.x), left + MIN_SIZE) : before.w;
                const top = name.includes('n') ? Math.min(snap(p.z), before.d - MIN_SIZE) : 0;
                const bottom = name.includes('s') ? Math.max(snap(p.z), top + MIN_SIZE) : before.d;
                const origin = ownFrame(before).toWorld(left, top);
                o.x = r2(origin.x); o.z = r2(origin.z);
                o.w = r2(right - left); o.d = r2(bottom - top);
                // 창고는 원점이 옮겨진 만큼 안의 것들을 되돌려 제자리에 둔다
                if (drag.children) { restoreChildren(drag.children); shiftChildren(o.id, left, top); }
                break;
            }
            case 'rotate': {
                // 물체 한가운데를 축으로 돌린다: 각도를 바꾸고, 한가운데가 제자리에 있게 원점을 옮긴다
                const step = ev?.shiftKey ? 15 : 0.5;
                const raw = (before.rot || 0) + angleAt(drag.center, world) - drag.angle0;
                o.rot = r2(Math.round(((((raw % 360) + 540) % 360) - 180) / step) * step);
                const center = ownFrame(before).toWorld(before.w / 2, before.d / 2);
                const half = frameOf({ x: 0, z: 0, rot: o.rot }).toWorld(before.w / 2, before.d / 2);
                o.x = r2(center.x - half.x);
                o.z = r2(center.z - half.z);
                break;
            }
            case 'vertex': {
                const p = drag.frame.toLocal(world.x, world.z);
                o.outline = before.outline.map((pt, i) => (i === drag.index ? [snap(p.x), snap(p.z)] : pt));
                break;
            }
            case 'arrow': o[drag.end] = [snap(world.x), snap(world.z)]; break;
            case 'door': {
                const wall = wallOf(item.wh, o.wall);
                const p = item.parent.toLocal(world.x, world.z);
                const along = clamp(snap(wall.isAlongX ? p.x : p.z), 0, r2(wall.length));
                if (drag.end === 'from') o.from = Math.min(along, r2(before.to - MIN_DOOR)); else o.to = Math.max(along, r2(before.from + MIN_DOOR));
                break;
            }
            case 'prop-rot': {
                // 방향: 0 = 위(북, -z), 90 = 오른쪽(동, +x)
                const p = item.parent.toLocal(world.x, world.z);
                const step = ev?.shiftKey ? 15 : 5;
                o.rot = (Math.round(((Math.atan2(p.x - o.x, -(p.z - o.z)) * 180) / Math.PI) / step) * step + 360) % 360;
                break;
            }
            case 'bg-scale': o.widthM = r2(Math.max(1, world.x - o.x)); break;
            default: break;
        }
    };
    /** 손잡이를 잡았을 때의 끌기 */
    const dragOfHandle = (name, world) => {
        const [type, arg] = splitKey(name);
        const item = resolve(selected);
        switch (type) {
            case 'resize': return beginEdit('resize', world, { handle: arg, children: item.kind === 'WH' ? childrenOf(item.o.id) : null });
            case 'rotate': {
                const center = fullFrame(item).toWorld(item.o.w / 2, item.o.d / 2);
                return beginEdit('rotate', world, { center, angle0: angleAt(center, world) });
            }
            case 'vertex': selVertex = Number(arg); return beginEdit('vertex', world, { index: Number(arg) });
            case 'addv': {
                // 변 가운데에 꼭짓점을 넣고 바로 끈다
                pushHistory();
                const pts = item.o.outline, i = Number(arg), [x, z] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
                pts.splice(i + 1, 0, [r2((x + x2) / 2), r2((z + z2) / 2)]);
                selVertex = i + 1;
                return beginEdit('vertex', world, { index: i + 1, isPushed: true });
            }
            case 'arrow': return beginEdit('arrow', world, { end: arg });
            case 'door': return beginEdit('door', world, { end: arg });
            case 'prop': return beginEdit('prop-rot', world);
            case 'bg': return beginEdit('bg-scale', world);
            default: return null;
        }
    };

    const onDown = (ev) => {
        syncSize(); // 누를 때마다 칸 자리를 다시 잰다 (가려진 화면에서는 크기 변화 알림이 오지 않는다)
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* 만들어 낸 이벤트(시험)는 잡을 수 없다 — 그대로 진행 */ }
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y) || 1, scale: view.scale, world: toWorld((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top) };
            drag = null;
            return;
        }
        if (ev.button === 2) return;
        const pt = eventPoint(ev), world = toWorld(pt.x, pt.y);
        const base = { start: pt, hasMoved: false, slop: ev.pointerType === 'mouse' ? 4 : 10 }; // 이만큼(px) 움직여야 끌기 (손가락은 넉넉히)
        const pan = (more = {}) => ({ ...base, type: 'pan', tx: view.tx, ty: view.ty, ...more });
        if (ev.button === 1 || isSpaceDown) { drag = pan(); return; }
        if (tool !== 'select') { drag = pan({ isPlacing: true }); return; }
        const handleEl = ev.target.closest?.('[data-handle]');
        if (handleEl && resolve(selected)) {
            const edit = dragOfHandle(handleEl.dataset.handle, world);
            drag = edit ? { ...base, ...edit } : null;
            scheduleDraw();
            return;
        }
        const keyEl = ev.target.closest?.('[data-key]');
        if (!keyEl) { drag = pan({ isOnEmpty: true }); return; }
        if (keyEl.dataset.key !== selected) { select(keyEl.dataset.key); drawSvg(); renderLayers(); renderProps(); renderHud(world); }
        const item = resolve(selected);
        const isMovable = item && (item.kind === 'BG' ? !layers.bg.isLocked : isEditable(item.layer));
        drag = isMovable ? { ...base, ...beginEdit('move', world) } : pan(); // 고칠 수 없는 것 위에서 끌면 화면 옮기기
    };
    const onMove = (ev) => {
        if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        const pt = eventPoint(ev), world = toWorld(pt.x, pt.y);
        if (pinch && pointers.size >= 2) {
            const [a, b] = [...pointers.values()];
            isViewTouched = true;
            view.scale = clamp(pinch.scale * ((Math.hypot(b.x - a.x, b.y - a.y) || 1) / pinch.dist), MIN_SCALE, MAX_SCALE);
            view.tx = (a.x + b.x) / 2 - rect.left - pinch.world.x * view.scale;
            view.ty = (a.y + b.y) / 2 - rect.top - pinch.world.z * view.scale;
            scheduleDraw();
            return;
        }
        if (!drag) { renderHud(world); return; }
        if (!drag.hasMoved) {
            if (Math.hypot(pt.x - drag.start.x, pt.y - drag.start.y) < drag.slop) return;
            drag.hasMoved = true;
            if (drag.item && drag.item.kind !== 'BG' && !drag.isPushed) pushHistory();
        }
        if (drag.type === 'pan') { isViewTouched = true; view.tx = drag.tx + pt.x - drag.start.x; view.ty = drag.ty + pt.y - drag.start.y; } else { applyDrag(world, ev); syncPropInputs(); }
        scheduleDraw();
        renderHud(world);
    };
    const onUp = (ev) => {
        pointers.delete(ev.pointerId);
        if (pinch) { if (pointers.size < 2) pinch = null; return; }
        const done = drag;
        drag = null;
        if (!done) return;
        if (done.type === 'pan') {
            if (done.hasMoved) return;
            const pt = eventPoint(ev);
            if (done.isPlacing) placeAt(toWorld(pt.x, pt.y));
            else if (done.isOnEmpty && selected) { select(''); renderAll(); }
            return;
        }
        if (!done.hasMoved && !done.isPushed) return;
        if (done.type === 'vertex') rebaseOutline(done.item);
        if (done.item.kind === 'BG') writeBackgroundSetting(plantId, bg.setting);
        renderAll();
    };
    const onWheel = (ev) => {
        ev.preventDefault();
        const pt = eventPoint(ev);
        zoomAt(pt.x, pt.y, Math.exp(-ev.deltaY * 0.0016));
    };

    // ---------- 새로 놓기 ----------
    /** 그 점이 들어 있는 창고 (없으면 null) */
    const warehouseAt = (world) => whRows().find(wh => { const p = ownFrame(wh).toLocal(world.x, world.z); return isInOutline(warehouseOutline(wh), p.x, p.z); }) || null;
    /** 그 점에서 가장 가까운 창고와 그 창고 기준 좌표 (가로 × 세로 상자까지의 거리로) */
    const nearestWarehouse = (world) => whRows().reduce((best, wh) => {
        const p = ownFrame(wh).toLocal(world.x, world.z);
        const dist = Math.hypot(Math.max(-p.x, 0, p.x - wh.w), Math.max(-p.z, 0, p.z - wh.d));
        return !best || dist < best.dist ? { wh, dist, p } : best;
    }, null);
    /** 새 물체를 만들어 넣고 그 키를 돌려준다 (놓을 수 없으면 '') */
    const createAt = (preset, world) => {
        const { extras } = draft;
        if (NEW_ZONE_WORDS[preset]) {
            const wh = warehouseAt(world);
            if (!wh) { showToast('건물(창고) 안을 눌러 주세요. 구획은 창고 안에만 놓을 수 있습니다.'); return ''; }
            const shape = preset === 'RACK' ? { zoneType: 'RACK', w: r2(RACK_LINE.pitch * 6), d: RACK_LINE.wide, h: RACK_LINE.tierHeight * RACK_LINE.tiers, slots: 6, tiers: RACK_LINE.tiers }
                : preset === 'LINE' ? { zoneType: 'FLOOR', w: PALLET_LINE.long, d: PALLET_LINE.wide, h: PALLET_LINE.h, slots: PALLET_LINE.pallets, tiers: PALLET_LINE.tiers }
                    : { zoneType: 'FLOOR', w: 4, d: 3, h: 3, slots: 0, tiers: 1 };
            const id = nextZoneId(draft.rows, wh.id), no = Number(id.split('-').pop());
            const p = ownFrame(wh).toLocal(world.x, world.z);
            draft.rows.push({
                id, kind: 'ZONE', warehouse: wh.id, site: wh.site, name: `${no}${NEW_ZONE_WORDS[preset]}`, ...shape,
                x: snap(p.x - shape.w / 2), z: snap(p.z - shape.d / 2), rot: 0, y: 0, fillFrom: 'START', sort: no, note: '', outline: []
            });
            return `ZONE:${id}`;
        }
        if (preset === 'MARK') { extras.floorMarks.push({ x: snap(world.x - 2), z: snap(world.z - 1.5), w: 4, d: 3, text: '표시', color: '#22c55e' }); return `MARK:${extras.floorMarks.length - 1}`; }
        if (preset === 'ARROW') { extras.arrows.push({ from: [snap(world.x), snap(world.z)], to: [snap(world.x + 5), snap(world.z)], name: '' }); return `ARROW:${extras.arrows.length - 1}`; }
        if (preset === 'REF') {
            const used = new Set(extras.buildings.map(b => b.id));
            let n = extras.buildings.length + 1;
            while (used.has(`참고건물${n}`)) n += 1;
            extras.buildings.push({ id: `참고건물${n}`, name: `참고 건물 ${n}`, x: snap(world.x - 4), z: snap(world.z - 3), w: 8, d: 6, h: 4, rot: 0, outline: [] });
            return `REF:${extras.buildings.length - 1}`;
        }
        const near = nearestWarehouse(world);
        if (!near) return '';
        const { wh, p } = near;
        if (preset === 'ANNEX') { extras.annexes.push({ warehouse: wh.id, x: snap(p.x - 1), z: snap(p.z - 0.5), w: 2, d: 1 }); return `ANNEX:${extras.annexes.length - 1}`; }
        if (preset === 'PROP') { extras.props.push({ type: 'FORKLIFT', warehouse: wh.id, x: snap(p.x), z: snap(p.z), rot: 0, name: '지게차' }); return `PROP:${extras.props.length - 1}`; }
        if (preset === 'DOOR') {
            // 가장 가까운 벽(가로 × 세로 상자의 네 변)에 3m 문
            const [wallName, , along] = [['N', Math.abs(p.z), p.x], ['S', Math.abs(p.z - wh.d), p.x], ['W', Math.abs(p.x), p.z], ['E', Math.abs(p.x - wh.w), p.z]].sort((a, b) => a[1] - b[1])[0];
            const wall = wallOf(wh, wallName), length = Math.min(3, wall.length);
            const from = clamp(snap(along - length / 2), 0, r2(wall.length - length));
            extras.doors.push({ warehouse: wh.id, wall: wallName, from, to: r2(from + length), name: `${wh.name || wh.id} 출입문`, style: 'OPENING' });
            return `DOOR:${extras.doors.length - 1}`;
        }
        return '';
    };
    const placeAt = (world) => {
        if (tool === 'calib') { calibrate(world); return; }
        const before = snapshot();
        const key = createAt(splitKey(tool)[1], world);
        if (!key) return;
        history.undo.push(before);
        history.redo = [];
        tool = 'select';
        select(key);
        openLayer(resolve(key).layer);
        renderAll();
    };

    // ---------- 지우기 · 복제 · 한 칸씩 옮기기 ----------
    const removeSelected = () => {
        const item = resolve(selected);
        if (!item || !canEdit) return;
        if (item.isBox && hasOutline(item.o) && selVertex >= 0) {
            if (item.o.outline.length <= 3) { showToast('꼭짓점은 세 개 이상이어야 합니다.'); return; }
            pushHistory();
            item.o.outline.splice(selVertex, 1);
            selVertex = -1;
            rebaseOutline(item);
            renderAll();
            return;
        }
        if (item.kind === 'WH') { showToast(`창고(${item.o.id})는 재고 위치라 지울 수 없습니다. 크기·위치만 고칩니다.`); return; }
        if (item.kind === 'BG') return;
        if (item.kind === 'ZONE') {
            const stock = zoneStock(item.o).length;
            if (stock) { showToast(`${item.o.id}에 재고 ${stock}품목이 있어 지울 수 없습니다. 재고를 먼저 다른 곳으로 옮기세요.`, 'error'); return; }
            pushHistory();
            draft.rows = draft.rows.filter(r => r !== item.o);
        } else {
            pushHistory();
            draft.extras[EXTRA_LISTS[item.kind]].splice(Number(splitKey(selected)[1]), 1);
        }
        select('');
        renderAll();
    };
    const duplicateSelected = () => {
        const item = resolve(selected);
        if (!item || !canEdit || !['ZONE', 'MARK', 'ANNEX', 'DOOR', 'PROP'].includes(item.kind)) return;
        pushHistory();
        const copy = clone(item.o);
        if (item.kind === 'ZONE') {
            // 짧은 변 쪽으로 한 줄 옆에 (구획이 돌아 있으면 그 방향대로)
            const id = nextZoneId(draft.rows, copy.warehouse), no = Number(id.split('-').pop());
            const isAlongX = copy.w >= copy.d;
            const step = ownFrame(copy).toWorldDir(isAlongX ? 0 : copy.w + 0.2, isAlongX ? copy.d + 0.2 : 0);
            Object.assign(copy, { id, sort: no, x: r2(copy.x + step.x), z: r2(copy.z + step.z), name: /^\d+/.test(copy.name || '') ? copy.name.replace(/^\d+/, String(no)) : `${no}구획` });
            draft.rows.push(copy);
            select(`ZONE:${id}`);
        } else {
            if (item.kind === 'DOOR') { const length = copy.to - copy.from; copy.from = r2(copy.to + 0.5); copy.to = r2(copy.from + length); fitDoor(copy); } else { copy.x = r2(copy.x + 1); copy.z = r2(copy.z + 1); }
            const list = draft.extras[EXTRA_LISTS[item.kind]];
            list.push(copy);
            select(`${item.kind}:${list.length - 1}`);
        }
        renderAll();
    };
    const nudge = (dx, dz) => {
        const item = resolve(selected);
        if (!item || !isEditable(item.layer) || item.kind === 'BG') return;
        pushHistory();
        const o = item.o;
        if (item.kind === 'ARROW') { o.from = [r2(o.from[0] + dx), r2(o.from[1] + dz)]; o.to = [r2(o.to[0] + dx), r2(o.to[1] + dz)]; } else {
            const local = item.parent.toLocalDir(dx, dz);
            if (item.kind === 'DOOR') {
                const move = wallOf(item.wh, o.wall).isAlongX ? local.x : local.z;
                o.from = r2(o.from + move); o.to = r2(o.to + move);
                fitDoor(o);
            } else { o.x = r2(o.x + local.x); o.z = r2(o.z + local.z); }
        }
        drawSvg(); syncPropInputs(); renderState(); renderHud();
    };

    // ---------- 속성 고치기 ----------
    let isHistoryArmed = true; // 칸에 들어가 처음 고칠 때 한 번만 되돌리기 지점을 남긴다
    const applyProp = (prop, raw) => {
        const item = resolve(selected);
        if (!item || !canEdit) return;
        if (isHistoryArmed) { pushHistory(); isHistoryArmed = false; }
        const o = item.o;
        const n = Number(raw);
        const isNumber = raw !== '' && Number.isFinite(n);
        switch (prop) {
            case 'name': case 'text': o[prop] = String(raw); break;
            case 'color': if (/^#[0-9a-fA-F]{6}$/.test(raw)) o.color = raw; break;
            case 'zoneType': case 'fillFrom': case 'style': case 'wall': o[prop] = raw; break;
            case 'slide': o.slide = n > 0 ? 1 : -1; break;
            case 'warehouse': if (whOf(raw)) o.warehouse = raw; break;
            case 'x': case 'z': if (isNumber) o[prop] = r2(n); break;
            case 'rot': if (isNumber) o.rot = r2(n); break;
            case 'y': if (isNumber) o.y = Math.max(0, r2(n)); break;
            case 'h': if (isNumber && n > 0) o.h = r2(n); break;
            case 'slots': if (isNumber) o.slots = Math.max(0, Math.round(n)); break;
            case 'tiers': if (isNumber) o.tiers = Math.max(1, Math.round(n)); break;
            case 'from': case 'to': if (isNumber) o[prop] = Math.max(0, r2(n)); break;
            case 'fx': if (isNumber) o.from = [r2(n), o.from[1]]; break;
            case 'fz': if (isNumber) o.from = [o.from[0], r2(n)]; break;
            case 'tx': if (isNumber) o.to = [r2(n), o.to[1]]; break;
            case 'tz': if (isNumber) o.to = [o.to[0], r2(n)]; break;
            case 'w': case 'd':
                if (isNumber && n >= MIN_SIZE) {
                    // 다각형 바닥은 그 길이에 맞춰 외곽선도 늘린다 (외곽선의 지금 폭 기준)
                    if (hasOutline(o)) {
                        const axis = prop === 'w' ? 0 : 1;
                        const extent = Math.max(...o.outline.map(p => p[axis]));
                        if (extent > 0) o.outline = o.outline.map(p => p.map((v, i) => (i === axis ? r2(v * (n / extent)) : v)));
                    }
                    o[prop] = r2(n);
                }
                break;
            default: break;
        }
        // 문은 벽 길이 안에 (벽·건물을 바꿨을 때 — 숫자를 치는 동안에는 칸에서 나올 때 맞춘다)
        if (item.kind === 'DOOR' && (prop === 'wall' || prop === 'warehouse')) fitDoor(o);
        const info = $('#pe-zone-info');
        if (info && item.kind === 'ZONE') info.innerHTML = zoneInfoHtml(o);
        scheduleDraw();
        renderState();
    };
    const applyBackground = (prop, raw) => {
        const n = Number(raw);
        if (raw === '' || !Number.isFinite(n)) return;
        if (prop === 'widthM') bg.setting.widthM = Math.max(1, n); else if (prop === 'opacity') bg.setting.opacity = clamp(n, 0.05, 1); else bg.setting[prop] = n;
        writeBackgroundSetting(plantId, bg.setting);
        scheduleDraw();
    };

    // ---------- 배경 도면 (이 기기에서만) ----------
    const setBackground = (blob, name) => new Promise((done) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            if (isDestroyed) { URL.revokeObjectURL(url); done(false); return; }
            if (bg.url) URL.revokeObjectURL(bg.url);
            Object.assign(bg, { url, name: name || '배경 도면', aspect: img.naturalHeight / Math.max(1, img.naturalWidth) });
            done(true);
        };
        img.onerror = () => { URL.revokeObjectURL(url); done(false); };
        img.src = url;
    });
    const loadBackgroundFromFile = async (file) => {
        if (!file) return;
        if (!/^image\//.test(file.type)) { showToast('그림 파일(PNG·JPG 등)을 골라 주세요. PDF는 그림으로 바꾼 뒤 불러옵니다.'); return; }
        if (!(await setBackground(file, file.name))) { showToast('그림을 읽지 못했습니다.', 'error'); return; }
        try { await saveBackgroundFile(plantId, file); } catch (e) { showToast(`그림을 이 기기에 저장하지 못해 이번에만 보입니다: ${e.message}`); }
        layers.bg.isVisible = true;
        saveLayers();
        showToast('배경 도면을 깔았습니다(이 기기에서만 보임). 크기가 안 맞으면 [축척 맞추기]로 실제 거리를 아는 두 점을 누르세요.');
        select('BG');
        renderAll();
    };
    /** 축척 맞추기: 두 점 사이 실제 거리를 물어 그림 크기를 맞춘다 (첫 점은 제자리) */
    const calibrate = (world) => {
        if (!calibFirst) { calibFirst = world; renderHud(world); scheduleDraw(); return; }
        const first = calibFirst;
        const measured = Math.hypot(world.x - first.x, world.z - first.z);
        calibFirst = null;
        tool = 'select';
        if (measured < 0.05) { showToast('두 점이 너무 가깝습니다. 다시 해 주세요.'); renderAll(); return; }
        const answer = prompt(`두 점 사이가 지금 ${measured.toFixed(2)}m로 재집니다.\n실제 거리(m)를 넣으세요 — 예: 도로 폭 6`, measured.toFixed(2));
        const real = Number(answer);
        if (answer !== null && Number.isFinite(real) && real > 0) {
            const k = real / measured;
            Object.assign(bg.setting, { x: r2(first.x - (first.x - bg.setting.x) * k), z: r2(first.z - (first.z - bg.setting.z) * k), widthM: r2(bg.setting.widthM * k) });
            writeBackgroundSetting(plantId, bg.setting);
            showToast(`배경 도면 크기를 맞췄습니다 (가로 폭 ${fmt(bg.setting.widthM)}m).`);
        }
        renderAll();
    };

    // ---------- 저장 · 닫기 ----------
    const save = async () => {
        if (!canSaveNow()) return;
        isBusy = true;
        renderState();
        try {
            await saveZones(draft.rows.map(r => ({ ...r })), plantId);
            const extras = cleanExtras(draft.extras);
            if (JSON.stringify(extras) !== JSON.stringify(plantExtras(plantId))) {
                // 기본값과 같아졌으면 저장된 줄을 지워 기본값을 쓰게 한다
                if (JSON.stringify(extras) !== JSON.stringify(defaultPlantExtras(plantId))) await savePlantExtras(plantId, extras);
                else if (hasSavedExtras(plantId)) await resetPlantExtras(plantId);
            }
            baseline = snapshot();
            needsFirstSave = false;
            showToast('평면도를 저장했습니다. 구획은 재고 위치(위치 선택·위치 QR)가 되고 3D 배치도에도 반영됩니다.', 'success');
            await onSaved?.();
        } catch (e) {
            showToast(e.message, 'error');
        }
        isBusy = false;
        if (!isDestroyed) renderState();
    };
    // 뒤로가기(브라우저·안드로이드 제스처)로 닫을 수 있게 방문 기록에 표시를 하나 넣는다
    const markTab = window.__activeTab || 'warehouse3d';
    const hasHistoryMark = () => window.history.state?.modal === HISTORY_MARK;
    const pushHistoryMark = () => { try { window.history.pushState({ modal: HISTORY_MARK, tab: markTab }, '', `#${markTab}`); } catch (e) { console.warn('방문 기록 표시 실패', e); } };
    const confirmDiscard = (question) => !isDirty() || confirm(question);
    const destroy = () => {
        if (isDestroyed) return;
        isDestroyed = true;
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('keyup', onKeyUp, true);
        window.removeEventListener('mouseup', onMouseUp, true);
        window.removeEventListener('popstate', onPopState);
        window.removeEventListener('beforeunload', onBeforeUnload);
        resizeObserver.disconnect();
        cancelAnimationFrame(drawQueued);
        clearTimeout(drawTimer);
        if (bg.url) URL.revokeObjectURL(bg.url);
        host.classList.add('hidden');
        host.innerHTML = '';
    };
    const close = () => {
        if (!confirmDiscard('저장하지 않은 변경이 있습니다. 저장하지 않고 닫을까요?')) return false;
        const hadMark = hasHistoryMark();
        destroy();
        onClose?.();
        if (hadMark) window.history.back(); // 넣어 둔 표시를 뺀다
        return true;
    };
    const leave = () => {
        if (!confirmDiscard('평면도에 저장하지 않은 변경이 있습니다. 저장하지 않고 나갈까요?')) return false;
        const hadMark = hasHistoryMark();
        destroy();
        // 곧 다른 화면의 방문 기록이 쌓이므로 표시만 지금 화면 것으로 바꿔 둔다
        if (hadMark) { try { window.history.replaceState({ tab: markTab }, '', `#${markTab}`); } catch (e) { console.warn('방문 기록 표시 지우기 실패', e); } }
        return true;
    };

    // ---------- 이벤트 ----------
    const onKeyDown = (ev) => {
        if (!root.isConnected) { destroy(); return; }
        ev.stopImmediatePropagation(); // 이 창이 열려 있는 동안 앱 단축키(Backspace 뒤로가기·통합 검색 등)가 먹지 않게
        if (ev.altKey && ev.key === 'ArrowLeft') { ev.preventDefault(); close(); return; }
        if (isTyping(ev.target)) { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') ev.target.blur(); return; }
        if (ev.key === ' ') { isSpaceDown = true; ev.preventDefault(); svg.style.cursor = 'grab'; return; }
        if (ev.key === 'Escape') { if (tool !== 'select') setTool('select'); else if (selected) { select(''); renderAll(); } return; }
        if (!canEdit) return;
        const isCtrl = ev.ctrlKey || ev.metaKey;
        const key = ev.key.toLowerCase();
        if (isCtrl && key === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
        if (isCtrl && key === 'y') { ev.preventDefault(); redo(); return; }
        if (isCtrl && key === 'd') { ev.preventDefault(); duplicateSelected(); return; }
        if (isCtrl && key === 's') { ev.preventDefault(); save(); return; }
        if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); removeSelected(); return; }
        const step = (snapStep || 0.1) * (ev.shiftKey ? 10 : 1);
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[ev.key]) { ev.preventDefault(); nudge(moves[ev.key][0], moves[ev.key][1]); }
    };
    const onKeyUp = (ev) => { if (ev.key === ' ') { isSpaceDown = false; svg.style.cursor = tool === 'select' ? 'default' : 'crosshair'; } };
    // 마우스 뒤로가기 단추 = 이 창 닫기 (앱의 이전 화면으로 가지 않게)
    const onMouseUp = (ev) => { if (ev.button === 3) { ev.preventDefault(); ev.stopImmediatePropagation(); close(); } };
    // 브라우저 뒤로가기로 표시가 빠졌으면 닫는다 (닫기를 취소하면 표시를 다시 넣는다)
    const onPopState = () => {
        if (isDestroyed || hasHistoryMark()) return;
        if (!confirmDiscard('저장하지 않은 변경이 있습니다. 저장하지 않고 닫을까요?')) { pushHistoryMark(); return; }
        destroy();
        onClose?.();
    };
    const onBeforeUnload = (ev) => { if (isDirty()) { ev.preventDefault(); ev.returnValue = ''; } };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('pointerleave', () => { if (!drag) renderHud(); });
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('contextmenu', (ev) => ev.preventDefault());
    const resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe($('#pe-stage'));

    root.addEventListener('click', async (ev) => {
        const t = ev.target.closest('button');
        if (!t || !root.contains(t)) return;
        if (t.dataset.tool) { setTool(t.dataset.tool); return; }
        if (t.dataset.view) {
            if (t.dataset.view === 'fit') { isViewTouched = false; fitView(); scheduleDraw(); } else zoomAt(rect.width / 2, rect.height / 2, t.dataset.view === 'in' ? 1.3 : 1 / 1.3);
            return;
        }
        if (t.dataset.eye) { layers[t.dataset.eye].isVisible = !layers[t.dataset.eye].isVisible; saveLayers(); renderAll(); return; }
        if (t.dataset.lock) { layers[t.dataset.lock].isLocked = !layers[t.dataset.lock].isLocked; saveLayers(); renderAll(); return; }
        if (t.dataset.open) { openList = openList === t.dataset.open ? '' : t.dataset.open; renderLayers(); return; }
        if (t.dataset.pick) {
            select(t.dataset.pick);
            const item = resolve(selected);
            if (item && !layers[item.layer].isVisible) { layers[item.layer].isVisible = true; saveLayers(); }
            renderAll();
            return;
        }
        const item = resolve(selected);
        switch (t.dataset.act || t.id) {
            case 'pe-undo': undo(); break;
            case 'pe-redo': redo(); break;
            case 'pe-save': await save(); break;
            case 'pe-close': close(); break;
            case 'pe-bg-load': $('#pe-file').click(); break;
            case 'delete': removeSelected(); break;
            case 'duplicate': duplicateSelected(); break;
            case 'rect':
                if (item && confirm('다각형 외곽선을 지우고 가로 × 세로 사각형으로 바꿀까요?')) { pushHistory(); item.o.outline = []; selVertex = -1; renderAll(); }
                break;
            case 'polygon':
                if (item) { pushHistory(); item.o.outline = [[0, 0], [item.o.w, 0], [item.o.w, item.o.d], [0, item.o.d]]; openLayer(item.layer); renderAll(); }
                break;
            case 'fit-slots':
                if (item?.kind === 'ZONE') { pushHistory(); item.o.slots = Math.max(1, Math.floor(Math.max(item.o.w, item.o.d) / RACK_LINE.pitch + 1e-6)); renderAll(); }
                break;
            case 'extras-default':
                if (confirm('주변 표시·참고 건물·부속·출입문·장비를 처음 값으로 되돌릴까요?\n[저장]을 눌러야 반영되고, 되돌리기(Ctrl+Z)로 취소할 수 있습니다.')) { pushHistory(); draft.extras = clone(defaultPlantExtras(plantId)); select(''); renderAll(); }
                break;
            case 'bg-reset':
                writeBackgroundSetting(plantId, null);
                bg.setting = readBackgroundSetting(plantId, plant.drawing);
                renderAll();
                break;
            case 'bg-remove':
                if (!confirm('배경 도면 그림을 이 기기에서 지울까요?')) break;
                try { await deleteBackgroundFile(plantId); } catch (e) { console.warn('배경 도면 지우기 실패', e); }
                if (bg.url) URL.revokeObjectURL(bg.url);
                Object.assign(bg, { url: '', name: '' });
                bgImgEl.removeAttribute('href');
                select('');
                if (tool === 'calib') tool = 'select';
                renderAll();
                break;
            default: break;
        }
    });
    root.addEventListener('focusin', (ev) => { if (ev.target.dataset?.prop) isHistoryArmed = true; });
    root.addEventListener('input', (ev) => {
        const el = ev.target;
        if (el.dataset?.prop && el.tagName !== 'SELECT') applyProp(el.dataset.prop, el.value);
        else if (el.dataset?.bg) applyBackground(el.dataset.bg, el.value);
    });
    root.addEventListener('change', (ev) => {
        const el = ev.target;
        if (el.id === 'pe-snap') { snapStep = Number(el.value) || 0; try { localStorage.setItem(SNAP_KEY, String(snapStep)); } catch (e) { console.warn('맞춤 간격 저장 실패', e); } return; }
        if (el.id === 'pe-file') { const file = el.files?.[0]; el.value = ''; loadBackgroundFromFile(file); return; }
        if (!el.dataset?.prop) return;
        const isSelect = el.tagName === 'SELECT';
        if (isSelect) { isHistoryArmed = true; applyProp(el.dataset.prop, el.value); }
        // 칸에서 나올 때: 문은 벽 안으로, 레이어 목록의 이름·자리(1층 ↔ 2층)를 맞춘다.
        // 숫자 칸은 다시 그리지 않고 값만 맞춘다 (다음 칸으로 넘어간 입력이 끊기지 않게)
        const item = resolve(selected);
        if (item?.kind === 'DOOR') fitDoor(item.o);
        if (item) openList = item.layer;
        drawSvg(); renderLayers(); renderState(); renderHud();
        if (isSelect) { renderProps(); $(`#pe-props [data-prop="${el.dataset.prop}"]`)?.focus(); } else syncPropInputs();
    });

    // ---------- 시작 ----------
    pushHistoryMark();
    measure();
    fitView();
    renderAll();
    loadBackgroundFile(plantId).then(async (saved) => {
        if (saved?.blob && !isDestroyed && await setBackground(saved.blob, saved.name)) renderAll();
    }).catch(e => console.warn('[평면도] 배경 도면을 불러오지 못했습니다:', e.message));

    return { isDirty, close, leave, destroy };
};
