// ==========================================
// 창고 배치도 평면도 편집기 — 레이어로 나눠 보고(보이기·잠금) 끌어서 고친다 (Warehouse3D.js의 [평면도 편집])
// ==========================================
// · 화면: 위에서 본 평면도(SVG, 도면 위쪽이 위 · 단위 m). 레이어마다 보이기(눈)·잠금(자물쇠).
//   배경 도면(이 기기에서 불러온 그림) · 주변 표시(바닥 표시·화살표) · 참고 건물 · 건물(창고) · 부속·출입문 · 구획(층마다 한 레이어) ·
//   모형(지게차·드럼 파렛트·IBC 탱크·화물차·계단·저장 탱크) · 이름표
// · 고치기: 눌러서 고르고 끌어서 옮긴다. 손잡이 = 크기(모서리·변의 네모), 회전(위쪽 동그라미),
//   다각형 건물은 꼭짓점(끌기)·변 가운데 동그라미(꼭짓점 넣기). 오른쪽 '속성'에서 숫자로도 고친다.
//   격자 맞춤, 되돌리기(Ctrl+Z)·다시 하기(Ctrl+Y), 방향키 = 한 칸씩, Delete = 지우기, Ctrl+D = 복제, 휠 = 확대.
// · 여러 개 고르기: 고르기 도구로 빈 곳을 끌면 그 네모 안에 다 들어온 것을 한꺼번에 고른다(잠기지 않은 레이어 · 작업 층의 구획).
//   Shift+누르기 = 하나씩 넣고 빼기, Ctrl+A = 모두. 고른 것 가운데 하나를 끌면 함께 움직이고, 방향키·복제·지우기·층 옮기기도 함께.
//   화면 옮기기 = 손 도구 · Space+끌기 · 가운데 단추 · 두 손가락.
// · 층: 도구줄의 '층'이 작업 층 — 새 구획은 그 층에 놓이고(바닥 높이 y = 층 높이 × (층 − 1)), 평면도에서는 그 층의 구획만 눌린다(다른 층은 흐리게).
//   층 높이는 공장마다 주변 표시와 함께 저장한다(floorHeight). 층은 구획의 바닥 높이로 센다(따로 저장하지 않는다).
//   건물(창고·참고 건물)도 바닥 높이(y)를 가질 수 있다 — 층마다 창고코드가 다른 건물(도창동 본사)은 같은 자리에 창고를 층층이 쌓는다.
//   건물은 작업 층에 걸친 것(바닥 높이 ~ 벽 꼭대기 사이에 그 층 바닥이 있는 것)만 또렷하게 그리고 눌리며, 나머지는 흐리게 — 딸린 부속·출입문·모형도 같다.
//   구획의 층 = 창고 바닥 높이 + 구획의 바닥 높이(y, 창고 바닥에서 잰 값).
// · 건물 밖 구획: 건물 밖(마당)을 누르면 그 공장의 옥외 창고(outdoorWarehouseOf — 김포1D · 본사1D)의 구획이 된다 — 공토트 보관구역·임시보관구역 등.
//   옥외 창고의 바닥 밖이어도 놓인다(창고 기준 좌표로 적을 뿐이다). 옥외 창고가 없는 공장(김포2공장)은 건물 안에만.
// · 저장: 창고·구획은 saveZones(그 공장 줄만), 주변 표시는 바뀌었을 때만 savePlantExtras. 저장 전에는 3D·재고 위치에 반영되지 않는다.
// · 구획 놓기: 랙·바닥 라인(한 줄에 칸 여러 개)·구역(칸 없음) + 파렛트 칸(파렛트 한 칸 = 구획 하나, 가로 × 세로로 여러 칸을 한 번에).
//   구획마다 칸 수(긴 변) × 줄 수(짧은 변) × 단 수로 파렛트 자리를 둔다. 칸이 여럿인 구획은 '칸마다 구획으로 나누기'로 자리 하나하나를 따로 구획으로 만들 수 있다(재고가 없을 때).
// · 출입문: 누른 자리에 — 사각형 창고의 벽 가까이면 벽에 붙인 문(벽 + 구간), 다각형 창고·참고 건물의 벽이면 그 벽 방향의 '찍은 자리의 문'(가운데·각도·길이),
//   벽에서 멀면 그 자리에 따로 선 문(대문·칸막이 문).
// · 좌표: 창고·참고 건물·바닥 표시·화살표는 공장 기준, 구획·부속·출입문은 그 창고 기준 (geometry.js의 frameOf·joinFrames).
//   모형·찍은 자리의 문은 건물 안에 놓으면 그 창고 기준(창고와 같이 움직임), 건물 밖이면 공장 기준.
//   고른 것의 키 = '종류:id' — WH 창고 · ZONE 구획 · REF 참고 건물 · MARK 바닥 표시 · ARROW 화살표 · ANNEX 부속 · DOOR 출입문 · PROP 모형 · BG 배경 도면.
// · 화면을 다 덮는 창이라 열려 있는 동안 앱 단축키(Backspace 뒤로가기·통합 검색)를 막고, 브라우저 뒤로가기는 이 창을 닫는 것으로 받는다
//   (방문 기록에 표시 하나를 넣어 둠 — 모달과 같은 방식).
import { esc } from '../../services/html.js';
import { createIcons, icons } from '../../services/icons.js';
import {
    ZONE_TYPES, DOOR_STYLES, WALL_NAMES, PALLET_LINE, RACK_LINE, PALLET_CELL, PROP_MODELS, isPropType, propSize, FREE_WALL, floorOfY, MAX_GRID, STAIR_STEP, ZONE_PLANTS,
    plantExtras, defaultPlantExtras, cleanExtras, hasSavedExtras, plantLabel, outdoorWarehouseOf, isYard, baseHeight,
    saveZones, savePlantExtras, resetPlantExtras, zoneStock, nextZoneId, warehouseOutline, hasOutline, zoneCapacity, zoneDims
} from '../../services/warehouseZones.js';
import { frameOf, joinFrames, outlineCenter, zoneBaseY, isInOutline, nearestEdge } from './geometry.js';
import { loadBackgroundFile, saveBackgroundFile, deleteBackgroundFile, readBackgroundSetting, writeBackgroundSetting } from './planBackground.js';

// 레이어(아래 → 위): 구획은 층마다 한 레이어 (floor1 = 1층 … — 도구줄의 '층'에서 고른 층만 평면도에서 눌린다)
const MAX_FLOORS = 6;
const floorLayerId = (floor) => `floor${Math.min(MAX_FLOORS, Math.max(1, floor))}`;
const UNDER_LAYERS = [
    { id: 'bg', name: '배경 도면', hint: '이 기기에서 불러온 그림 (저장·공유되지 않음)' },
    { id: 'site', name: '주변 표시', hint: '바닥 표시(도로·출입구)·화살표' },
    { id: 'ref', name: '참고 건물', hint: '사무실동처럼 재고 위치가 아닌 건물' },
    { id: 'wh', name: '건물 (창고)', hint: '창고 외곽 — 옮기면 안의 구획·부속도 같이 움직인다' },
    { id: 'fit', name: '부속·출입문', hint: '건물에 붙은 부속·출입문' }
];
const FLOOR_LAYERS = Array.from({ length: MAX_FLOORS }, (_, i) => ({
    id: floorLayerId(i + 1), floor: i + 1, name: `구획 · ${i + 1}층${i + 1 === MAX_FLOORS ? ' 이상' : ''}`,
    hint: i ? `${i + 1}층에 놓은 구획 (바닥 높이 = 층 높이 × ${i})` : '랙·라인·파렛트 칸·바닥 구역 (바닥 높이 0)'
}));
const OVER_LAYERS = [
    { id: 'prop', name: '모형 (장비·짐·차량·시설)', hint: '지게차·드럼 파렛트·IBC 탱크·화물차·계단·저장 탱크 — 재고와 무관한 참고 모형' },
    { id: 'label', name: '이름표', hint: '이름·크기 글자' }
];
const LAYERS = [...UNDER_LAYERS, ...FLOOR_LAYERS, ...OVER_LAYERS];
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
const MAX_CELL_GRID = 30;                  // 파렛트 칸을 한 번에 놓는 가로·세로 칸 수의 한도
const DOOR_SNAP = 2.5;                     // 출입문을 찍을 때 이 거리(m) 안의 벽에 붙인다 — 더 멀면 그 자리에 따로 선 문(대문)
const DOOR_GLUE = 1.2;                     // 찍은 자리의 문을 끌 때 이 거리(m) 안의 벽에 다시 붙인다
const NEW_DOOR_LEN = 3;                    // 새 출입문 길이 (m)
const KIND_NAMES = { WH: '건물(창고)', ZONE: '구획', REF: '참고 건물', MARK: '바닥 표시', ARROW: '화살표', ANNEX: '부속', DOOR: '출입문', PROP: '모형', BG: '배경 도면' };
const EXTRA_LISTS = { REF: 'buildings', MARK: 'floorMarks', ARROW: 'arrows', ANNEX: 'annexes', DOOR: 'doors', PROP: 'props' };
const NEW_ZONE_WORDS = { RACK: '번 랙', LINE: '라인', AREA: '구역', YARD: '구역' };
const CELL_NOTE = '파렛트 한 칸';
const OUTDOOR_ZONE_NAMES = ['공토트 보관구역', '임시보관구역']; // 옥외 구역에 바로 붙일 수 있는 이름 (속성 칸의 단추)
const OFF_FLOOR = 'opacity="0.3" pointer-events="none"';      // 작업 층에 걸치지 않은 건물과 그 건물에 딸린 것: 흐리게, 눌리지 않게
// 도구 안내 (파렛트 칸·모형은 고른 값에 따라 달라져 renderHud에서 만든다)
const TOOL_HINTS = {
    'add:RACK': '랙을 놓을 자리를 누르세요', 'add:LINE': '바닥 라인을 놓을 자리를 누르세요', 'add:AREA': '구역을 놓을 자리를 누르세요',
    'add:YARD': '옥외 구역(공토트 보관구역·임시보관구역 등)을 놓을 건물 밖 자리를 누르세요',
    'add:MARK': '바닥 표시를 놓을 자리를 누르세요', 'add:ARROW': '화살표가 시작할 자리를 누르세요', 'add:REF': '참고 건물을 놓을 자리를 누르세요',
    'add:ANNEX': '부속을 붙일 건물 가까이를 누르세요', 'add:DOOR': '문을 낼 자리를 누르세요 — 가까운 벽에 붙고, 벽에서 멀면 그 자리에 따로 선 문이 됩니다',
    pan: '끌어서 화면을 옮깁니다',
    calib: '축척 맞추기: 실제 거리를 아는 두 점을 차례로 누르세요 (예: 도로 폭의 양 끝)'
};
const DRUM_SPOTS = [[-0.29, -0.29], [0.29, -0.29], [-0.29, 0.29], [0.29, 0.29]]; // 드럼 파렛트의 드럼 넷 (모형 기준 m)
const TRUCK_CAB = 1.7;                     // 화물차 캡 길이 (m, 평면 모양)

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
    const outdoorCode = outdoorWarehouseOf(plant.id); // 건물 밖에 놓는 구획이 속하는 옥외 창고코드 (없는 공장이면 '')
    const draft = { rows: clone(rows), extras: clone(plantExtras(plantId)) };
    const snapshot = () => JSON.stringify({ rows: draft.rows, extras: draft.extras });
    let baseline = snapshot();
    let needsFirstSave = isUnsaved;
    const history = { undo: [], redo: [] };
    const view = { scale: 8, tx: 0, ty: 0 };
    let isViewTouched = false;   // 사용자가 화면을 옮기거나 확대했는지 — 그 전에는 칸 크기가 바뀔 때마다 전체가 보이게 다시 맞춘다
    let selected = '';           // 하나만 골랐을 때 그 키 (손잡이·속성 칸은 이것만)
    let group = [];              // 여러 개를 골랐을 때 그 키들 (둘 이상 — 이때 selected는 '')
    let marquee = null;          // 끌어서 여러 개 고르는 중인 네모 (화면 좌표 { x0, y0, x1, y1 })
    let marqueeHits = [];        // 그 네모 안에 지금 들어와 있는 것들의 키 (끄는 동안 파랗게 보여 준다)
    let selVertex = -1;          // 고른 꼭짓점 (다각형 건물)
    // 도구: select 고르기(빈 곳을 끌면 여러 개 고르기) · pan 화면 옮기기 · add:RACK · add:LINE · add:CELL · add:AREA · add:MARK · add:ARROW · add:REF · add:ANNEX · add:DOOR · add:PROP · calib
    let tool = canEdit ? 'select' : 'pan';
    let activeFloor = 1;         // 작업 층: 새 구획이 놓이는 층이고, 평면도에서는 이 층의 구획만 눌린다 (다른 층은 흐리게)
    let propKind = 'FORKLIFT';   // [+ 놓기]로 놓을 모형 종류 (PROP_MODELS의 키)
    const cellGrid = { cols: 1, rows: 1, tiers: 1 }; // [+ 파렛트 칸]으로 한 번에 놓을 칸 수(가로 × 세로)와 단 수
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
        // 예전 이름(1층 = zone1 · 2층 이상 = zone2)으로 기억한 값도 읽는다
        if (saved.zone1 && !saved.floor1) saved.floor1 = saved.zone1;
        if (saved.zone2 && !saved.floor2) saved.floor2 = saved.zone2;
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
    // 층: 지면에서 잰 바닥 높이를 층 높이로 나눠 센다 (1층 = 지면). 층 높이는 공장마다 주변 표시와 함께 저장된다
    const floorHeight = () => draft.extras.floorHeight;
    /** 구획의 층: 창고 바닥 높이(위층 창고) + 구획의 바닥 높이(창고 바닥에서 잰 값) */
    const floorOf = (z) => Math.min(MAX_FLOORS, floorOfY(baseHeight(whOf(z.warehouse)) + zoneBaseY(z), floorHeight()));
    const floorY = (floor) => r2((floor - 1) * floorHeight());
    const zoneLayer = (z) => floorLayerId(floorOf(z));
    /** 건물(창고·참고 건물)이 놓인 층 (1층 = 지면에 선 건물) */
    const buildingFloor = (o) => Math.min(MAX_FLOORS, floorOfY(baseHeight(o), floorHeight()));
    /** 건물이 그 층에 걸쳐 있는지: 그 층 바닥이 건물의 바닥 높이 ~ 벽 꼭대기 사이에 있다 */
    const coversFloor = (o, floor) => { const y = floorY(floor), base = baseHeight(o); return y >= base - 0.01 && y < base + Math.max(0.1, Number(o.h) || 0) - 0.01; };
    /** 건물이 작업 층에 걸쳐 있는지 (걸치지 않은 건물은 평면도에서 흐리게 그리고 눌리지 않는다) */
    const isOnFloor = (o) => coversFloor(o, activeFloor);
    /** 그 창고에 딸린 것(부속·출입문·모형)을 작업 층에서 다룰 수 있는지 — 건물 밖(공장 기준)의 것은 늘 */
    const isHomeOnFloor = (whId) => { const wh = whOf(whId); return !wh || isOnFloor(wh); };
    /** 건물 그리는 순서: 마당(벽 없는 옥외 창고) 먼저, 그다음 아래층부터 — 겹친 자리는 위에 그린 것이 눌린다 */
    const stacked = (list) => [...list].sort((a, b) => Number(isYard(b)) - Number(isYard(a)) || baseHeight(a) - baseHeight(b));
    /** 지금 보여 줄 층 수: 구획·건물이 있는 가장 높은 층과 작업 층 중 큰 쪽 */
    const shownFloors = () => Math.max(activeFloor, ...zoneRows().map(floorOf), ...whRows().map(buildingFloor), ...draft.extras.buildings.map(buildingFloor), 1);
    /** 레이어 목록 (아래 → 위): 쓰는 층까지만 */
    const layerList = () => [...UNDER_LAYERS, ...FLOOR_LAYERS.slice(0, shownFloors()), ...OVER_LAYERS];
    /** 층을 고르는 목록에 보일 층: 3층까지는 늘, 그 위는 쓰는 층보다 한 층 위까지 */
    const floorChoices = () => Array.from({ length: Math.min(MAX_FLOORS, Math.max(3, shownFloors() + 1)) }, (_, i) => i + 1);

    // ---------- 고른 것: 하나(selected) 또는 여럿(group) ----------
    const selection = () => (group.length ? group : selected ? [selected] : []);
    /** 고른 것처럼 파랗게 그릴지: 고른 것 + 끌어서 고르는 중인 네모 안에 들어온 것 */
    const isSel = (key) => key === selected || group.includes(key) || marqueeHits.includes(key);

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
            case 'ZONE': { const o = draft.rows.find(r => r.kind === 'ZONE' && r.id === id); return inWarehouse(o, { layer: o ? zoneLayer(o) : floorLayerId(1), isBox: true, canRotate: true }); }
            case 'REF': { const o = draft.extras.buildings[index]; return o ? { kind, o, layer: 'ref', parent: IDENT, isBox: true, canRotate: true } : null; }
            case 'MARK': { const o = draft.extras.floorMarks[index]; return o ? { kind, o, layer: 'site', parent: IDENT, isBox: true, canRotate: false } : null; }
            case 'ARROW': { const o = draft.extras.arrows[index]; return o ? { kind, o, layer: 'site', parent: IDENT } : null; }
            case 'ANNEX': return inWarehouse(draft.extras.annexes[index], { layer: 'fit', isBox: true, canRotate: false });
            case 'DOOR': {
                // 찍은 자리의 문(isFreeDoor): 좌표·각도로 적는 문 — 건물이 있으면 그 창고 기준, 없으면(따로 선 문) 공장 기준
                const o = draft.extras.doors[index];
                if (!o || o.wall !== FREE_WALL) return inWarehouse(o, { layer: 'fit' });
                const wh = whOf(o.warehouse);
                return { kind, o, wh, layer: 'fit', parent: wh ? frameOf(wh) : IDENT, isFreeDoor: true };
            }
            case 'PROP': {
                // 창고가 적힌 모형은 그 창고 기준, 아니면(건물 밖 — 화물차 등) 공장 기준
                const o = draft.extras.props[index];
                if (!o) return null;
                const wh = whOf(o.warehouse);
                return { kind, o, wh, layer: 'prop', parent: wh ? frameOf(wh) : IDENT };
            }
            case 'BG': return bg.url ? { kind, o: bg.setting, layer: 'bg', parent: IDENT } : null;
            default: return null;
        }
    };
    /** 물체 기준 → 전체 좌표 변환 (그 순간의 값으로 굳힌 사본) */
    const fullFrame = (item) => joinFrames(item.parent, ownFrame(item.o));
    /** 문이 벽을 벗어나지 않게 (벽에 붙인 문 — 찍은 자리의 문은 좌표로 적으므로 맞출 것이 없다) */
    const fitDoor = (door) => {
        const wh = whOf(door.warehouse);
        if (!wh || door.wall === FREE_WALL) return;
        const length = wallOf(wh, door.wall).length;
        door.from = r2(clamp(door.from, 0, Math.max(0, length - MIN_DOOR)));
        door.to = r2(clamp(door.to, door.from + MIN_DOOR, Math.max(length, door.from + MIN_DOOR)));
    };

    // ---------- 화면 틀 ----------
    host.innerHTML = `
    <div id="pe-root" class="flex flex-col h-full bg-slate-100 text-slate-800">
        <div class="flex flex-wrap items-center gap-2 px-3 py-2 bg-white border-b">
            <div class="font-bold flex items-center gap-1.5"><i data-lucide="layers" class="w-4 h-4 text-blue-600"></i>평면도 ${canEdit ? '편집' : '보기'} · ${esc(plantLabel(plant))}</div>
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
        // 창고 바닥 밖에 놓인 구획(마당 밖까지 나간 옥외 구획)도 화면에 들어오게
        zoneRows().forEach(z => {
            const wh = whOf(z.warehouse);
            if (!wh) return;
            const f = joinFrames(frameOf(wh), ownFrame(z));
            [[0, 0], [z.w, 0], [z.w, z.d], [0, z.d]].forEach(([x, zz]) => { const p = f.toWorld(x, zz); add(p.x, p.z); });
        });
        draft.extras.floorMarks.forEach(m => { add(m.x, m.z); add(m.x + m.w, m.z + m.d); });
        (draft.extras.boundaries || []).forEach(b => b.points.forEach(p => add(p[0], p[1])));
        draft.extras.arrows.forEach(a => { add(a.from[0], a.from[1]); add(a.to[0], a.to[1]); });
        draft.extras.props.forEach(p => {
            const wh = whOf(p.warehouse), at = (wh ? frameOf(wh) : IDENT).toWorld(p.x, p.z), size = propSize(p);
            const reach = Math.max(size.front, size.back, size.w / 2);
            add(at.x - reach, at.z - reach); add(at.x + reach, at.z + reach);
        });
        draft.extras.doors.forEach(d => { if (d.wall === FREE_WALL && !whOf(d.warehouse)) { add(d.x - d.len / 2, d.z - d.len / 2); add(d.x + d.len / 2, d.z + d.len / 2); } });
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
        // 여럿을 골랐으면 남아 있는 것만 (하나 이하가 되면 하나 고른 것으로)
        const left = group.filter(key => resolve(key));
        group = left.length > 1 ? left : [];
        if (left.length === 1) selected = left[0];
        // 고른 것이 되돌린 뒤 다른 층에 있으면(건물의 층을 바꿨다가 되돌림) 작업 층도 그 층으로 — 흐려져 눌리지 않는 채로 남지 않게
        const now = resolve(selected);
        const reach = now ? floorToReach(now) : 0;
        if (reach) activeFloor = reach;
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
        const isOn = isSel(key);
        const isOpenYard = !isRef && isYard(o); // 벽 없는 옥외저장소·마당
        // 작업 층에 걸치지 않은 건물(층으로 쌓인 건물의 다른 층)은 흐리게 그리고 눌리지 않는다 — 같은 자리에 겹친 층을 가려 집는다
        return `<g transform="${whTransform(o)}" data-key="${esc(key)}" style="cursor:pointer" ${isOnFloor(o) ? '' : OFF_FLOOR}>
            <polygon points="${pointsAttr(warehouseOutline(o))}" fill="${isRef ? '#e2e8f0' : isOpenYard ? '#f8fafc' : '#eef2f7'}" fill-opacity="${isRef ? 0.7 : 1}"
                stroke="${isOn ? '#2563eb' : isRef ? '#64748b' : '#1e293b'}" stroke-width="${isOn ? 3 : isRef ? 1.5 : 2.2}" ${isOpenYard || isRef ? 'stroke-dasharray="7 4"' : ''} stroke-linejoin="round" ${NS}/></g>`;
    };
    /** 구획 하나 (칸이 있으면 칸·줄 사이 선, 채우기 시작하는 칸에 점) */
    const zoneSvg = (z, wh) => {
        const key = `ZONE:${z.id}`, isOn = isSel(key), st = zoneStyle(z);
        const { slots, cols, lanes } = zoneDims(z);
        const isAlongX = z.w >= z.d;
        const L = isAlongX ? z.w : z.d, C = isAlongX ? z.d : z.w;
        // 긴 변 쪽 자리 t · 짧은 변 쪽 자리 u → 구획 기준 좌표의 선 (칸은 긴 변을 따라, 줄은 짧은 변 쪽으로)
        const line = (t1, u1, t2, u2) => (isAlongX ? `<line x1="${t1}" y1="${u1}" x2="${t2}" y2="${u2}"` : `<line x1="${u1}" y1="${t1}" x2="${u2}" y2="${t2}"`);
        const lines = [];
        if (slots) {
            for (let i = 1; i < cols; i += 1) lines.push(line((L * i) / cols, 0, (L * i) / cols, C));
            for (let j = 1; j < lanes; j += 1) lines.push(line(0, (C * j) / lanes, L, (C * j) / lanes));
        }
        // 채우기 시작하는 칸(첫 줄의 첫 칸, 반대쪽부터면 마지막 줄의 마지막 칸) 한가운데에 점
        const isFromEnd = z.fillFrom === 'END';
        const cellL = slots ? L / cols : L, cellC = slots ? C / lanes : C;
        const dotT = isFromEnd ? L - cellL / 2 : cellL / 2, dotU = isFromEnd ? C - cellC / 2 : cellC / 2;
        return `<g transform="${whTransform(wh)} translate(${z.x} ${z.z}) rotate(${Number(z.rot) || 0})" data-key="${esc(key)}" style="cursor:pointer">
            <rect width="${z.w}" height="${z.d}" fill="${st.fill}" stroke="${isOn ? '#2563eb' : st.stroke}" stroke-width="${isOn ? 3 : 1.8}" ${slots ? '' : 'stroke-dasharray="5 3"'} ${NS}/>
            ${lines.map(l => `${l} stroke="${st.stroke}" stroke-width="1" ${NS} pointer-events="none"/>`).join('')}
            ${slots > 1 ? `<circle cx="${isAlongX ? dotT : dotU}" cy="${isAlongX ? dotU : dotT}" r="${Math.min(cellL, cellC) * 0.11}" fill="${st.stroke}" pointer-events="none"/>` : ''}</g>`;
    };
    /** 모형의 평면 모양 (모형 기준 좌표 m — 중심이 원점, 앞이 위쪽(-y)) */
    const propShape = (prop, stroke, strokeWidth) => {
        const edge = `stroke="${stroke}" stroke-width="${strokeWidth}" ${NS}`;
        const size = propSize(prop), x = -size.w / 2, y = -size.front, len = size.front + size.back;
        switch (prop.type) {
            case 'DRUM_PALLET': // 파렛트 + 드럼 넷
                return `<rect x="${x}" y="${y}" width="${size.w}" height="${len}" fill="#d6b27c" ${edge}/>
                    ${DRUM_SPOTS.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="0.27" fill="#2563eb" stroke="#1e3a8a" stroke-width="1" ${NS}/>`).join('')}`;
            case 'IBC': // 흰 통 + 철망 줄 + 뚜껑 + 앞의 밸브
                return `<rect x="${x}" y="${y}" width="${size.w}" height="${len}" fill="#f1f5f9" ${edge}/>
                    <path d="M${x} -0.2H${-x}M${x} 0.2H${-x}M-0.17 ${y}V${-y}M0.17 ${y}V${-y}" stroke="#94a3b8" stroke-width="1" fill="none" ${NS}/>
                    <circle r="0.12" fill="#1e293b"/><rect x="-0.07" y="${y - 0.09}" width="0.14" height="0.09" fill="#dc2626"/>`;
            case 'TRUCK_1T': case 'TRUCK_35T': // 적재함 + 캡 + 앞 유리
                return `<rect x="${x}" y="${y + TRUCK_CAB + 0.08}" width="${size.w}" height="${len - TRUCK_CAB - 0.08}" fill="#cbd5e1" ${edge}/>
                    <rect x="${x + 0.02}" y="${y}" width="${size.w - 0.04}" height="${TRUCK_CAB}" rx="0.15" fill="${prop.type === 'TRUCK_1T' ? '#3b82f6' : '#f8fafc'}" ${edge}/>
                    <rect x="${x + 0.16}" y="${y + 0.2}" width="${size.w - 0.32}" height="0.34" rx="0.05" fill="#0f172a" fill-opacity="0.75"/>`;
            case 'STAIRS': { // 디딤판 선 + 오르는 방향 화살표 (아래 = 뒤, 위 = 앞)
                const steps = Math.round(len / STAIR_STEP.tread), head = size.w * 0.22;
                const treads = Array.from({ length: Math.max(0, steps - 1) }, (_, i) => `M${x} ${r2(y + STAIR_STEP.tread * (i + 1))}H${-x}`).join('');
                return `<rect x="${x}" y="${y}" width="${size.w}" height="${len}" fill="#e2e8f0" ${edge}/>
                    <path d="${treads}" stroke="#94a3b8" stroke-width="1" fill="none" ${NS}/>
                    <path d="M0 ${-y - 0.25}V${y + 0.3}M${-head} ${y + 0.3 + head}L0 ${y + 0.3}L${head} ${y + 0.3 + head}" stroke="#f59e0b" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" ${NS}/>`;
            }
            case 'TANK': // 위에서 본 원통 + 지붕 맨홀 + 앞의 사다리
                return `<circle r="${size.w / 2}" fill="#e2e8f0" ${edge}/><circle r="${size.w * 0.36}" fill="none" stroke="#94a3b8" stroke-width="1" ${NS}/>
                    <circle r="${Math.min(0.3, size.w * 0.15)}" fill="#475569"/><rect x="-0.2" y="${y - 0.16}" width="0.4" height="0.16" fill="#475569"/>`;
            default: // 지게차: 차체 + 앞(포크) 방향 세모
                return `<rect x="-0.55" y="-0.75" width="1.1" height="1.9" rx="0.15" fill="#f59e0b" ${edge}/><path d="M-0.3 -0.75L0 -1.7L0.3 -0.75z" fill="#475569"/>`;
        }
    };
    const propSvg = (p, i) => {
        const wh = whOf(p.warehouse), isOn = isSel(`PROP:${i}`);
        return `<g transform="${wh ? `${whTransform(wh)} ` : ''}translate(${p.x} ${p.z}) rotate(${Number(p.rot) || 0})" data-key="PROP:${i}" style="cursor:pointer" ${isHomeOnFloor(p.warehouse) ? '' : OFF_FLOOR}>${propShape(p, isOn ? '#2563eb' : '#475569', isOn ? 3 : 1.2)}</g>`;
    };
    /** 화살표: 선 + 끝의 세모 (세모 크기는 화면에서 13px쯤) */
    const arrowSvg = (a, i) => {
        const color = isSel(`ARROW:${i}`) ? '#2563eb' : '#16a34a';
        const dx = a.to[0] - a.from[0], dz = a.to[1] - a.from[1], len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len, head = Math.min(len * 0.5, 13 / view.scale), half = head * 0.45;
        const bx = a.to[0] - ux * head, bz = a.to[1] - uz * head;
        return `<g data-key="ARROW:${i}" style="cursor:pointer"><line x1="${a.from[0]}" y1="${a.from[1]}" x2="${a.to[0]}" y2="${a.to[1]}" stroke="transparent" stroke-width="16" ${NS}/>
            <line x1="${a.from[0]}" y1="${a.from[1]}" x2="${bx}" y2="${bz}" stroke="${color}" stroke-width="3" ${NS}/>
            <polygon points="${a.to[0]},${a.to[1]} ${bx - uz * half},${bz + ux * half} ${bx + uz * half},${bz - ux * half}" fill="${color}"/></g>`;
    };
    /** 출입문: 벽에 붙인 문 = 벽 위의 구간, 찍은 자리의 문 = 가운데·각도·길이 (바깥쪽을 가리키는 짧은 금을 함께 그린다) */
    const doorSvg = (d, i) => {
        const wh = whOf(d.warehouse), key = `DOOR:${i}`;
        const color = isSel(key) ? '#2563eb' : d.style === 'FIXED' ? '#64748b' : '#f97316';
        const stroke = (line, width, tone) => `<line ${line} stroke="${tone}" stroke-width="${width}" stroke-linecap="round" ${NS}/>`;
        const fade = isHomeOnFloor(d.warehouse) ? '' : OFF_FLOOR; // 다른 층 건물의 문
        if (d.wall === FREE_WALL) {
            const line = `x1="${-d.len / 2}" y1="0" x2="${d.len / 2}" y2="0"`;
            return `<g transform="${wh ? `${whTransform(wh)} ` : ''}translate(${d.x} ${d.z}) rotate(${Number(d.rot) || 0})" data-key="${key}" style="cursor:pointer" ${fade}>
                ${stroke(line, 18, 'transparent')}${stroke(line, 6, color)}${stroke('x1="0" y1="0" x2="0" y2="-0.45"', 2, color)}</g>`;
        }
        if (!wh) return '';
        const wall = wallOf(wh, d.wall), p1 = wall.point(d.from), p2 = wall.point(d.to);
        const line = `x1="${p1.x}" y1="${p1.z}" x2="${p2.x}" y2="${p2.z}"`;
        return `<g transform="${whTransform(wh)}" data-key="${key}" style="cursor:pointer" ${fade}>${stroke(line, 18, 'transparent')}${stroke(line, 6, color)}</g>`;
    };
    const worldSvg = () => {
        const out = [];
        if (layers.site.isVisible) {
            out.push(layerOpen('site'));
            draft.extras.floorMarks.forEach((m, i) => {
                const isOn = isSel(`MARK:${i}`);
                out.push(`<rect data-key="MARK:${i}" x="${m.x}" y="${m.z}" width="${m.w}" height="${m.d}" fill="${esc(m.color)}" fill-opacity="0.22" stroke="${isOn ? '#2563eb' : esc(m.color)}" stroke-width="${isOn ? 3 : 1.5}" ${NS} style="cursor:pointer"/>`);
            });
            draft.extras.arrows.forEach((a, i) => out.push(arrowSvg(a, i)));
            // 공장 외곽 경계선 (참고 표시 — 여기서는 고르거나 고치지 않는다)
            (draft.extras.boundaries || []).forEach(b => out.push(`<polygon points="${b.points.map(p => p.join(',')).join(' ')}" fill="none" stroke="#ef4444" stroke-width="2.5" vector-effect="non-scaling-stroke" pointer-events="none" />`));
            out.push('</g>');
        }
        // 건물은 마당 → 아래층 → 위층 순으로 그린다 (작업 층에 걸치지 않은 건물은 흐리고 눌리지 않아, 겹친 자리에서는 작업 층의 건물이 눌린다)
        if (layers.ref.isVisible) out.push(`${layerOpen('ref')}${stacked(draft.extras.buildings).map(b => buildingSvg(b, `REF:${draft.extras.buildings.indexOf(b)}`, true)).join('')}</g>`);
        if (layers.wh.isVisible) out.push(`${layerOpen('wh')}${stacked(whRows()).map(wh => buildingSvg(wh, `WH:${wh.id}`, false)).join('')}</g>`);
        if (layers.fit.isVisible) {
            out.push(layerOpen('fit'));
            draft.extras.annexes.forEach((a, i) => {
                const wh = whOf(a.warehouse);
                if (!wh) return;
                const isOn = isSel(`ANNEX:${i}`);
                out.push(`<g transform="${whTransform(wh)}" ${isOnFloor(wh) ? '' : OFF_FLOOR}><rect data-key="ANNEX:${i}" x="${a.x}" y="${a.z}" width="${a.w}" height="${a.d}" fill="#cbd5e1" fill-opacity="0.75" stroke="${isOn ? '#2563eb' : '#64748b'}" stroke-width="${isOn ? 3 : 1.2}" ${NS} style="cursor:pointer"/></g>`);
            });
            out.push(draft.extras.doors.map(doorSvg).join(''), '</g>');
        }
        // 구획: 층마다 한 레이어(아래층부터). 작업 층이 아닌 층은 흐리게 그리고 눌리지 않는다 — 같은 자리에 겹친 1층·2층을 가려 집을 수 있게
        FLOOR_LAYERS.slice(0, shownFloors()).forEach(({ id, floor }) => {
            if (!layers[id].isVisible) return;
            const isActive = floor === activeFloor;
            out.push(`<g data-layer="${id}" ${layers[id].isLocked || !isActive ? 'pointer-events="none"' : ''} ${isActive ? '' : 'opacity="0.38"'}>`);
            zoneRows().filter(z => floorOf(z) === floor).forEach(z => { const wh = whOf(z.warehouse); if (wh) out.push(zoneSvg(z, wh)); });
            out.push('</g>');
        });
        // 모형은 구획 위에 (구획 위에 올려놓은 드럼 파렛트도 눌러서 고를 수 있게)
        if (layers.prop.isVisible) out.push(`${layerOpen('prop')}${draft.extras.props.map(propSvg).join('')}</g>`);
        return out.join('');
    };

    // ---------- 그리기: 화면 좌표 (이름표 · 축척 · 고른 것의 테두리·손잡이·치수 · 여러 개 고르는 네모) ----------
    const yardSpots = new Map(); // 마당 id → { key, spot } (배치가 그대로면 다시 찾지 않는다)
    /**
     * 마당(옥외 창고) 이름을 적을 자리 (전체 좌표). 한가운데가 다른 건물 안이 아니면 null(한가운데 그대로),
     * 건물 안이면 마당 안에서 마당 가장자리·다른 건물과 가장 멀리 떨어진 곳
     */
    const yardLabelSpot = (yard) => {
        const others = whRows().filter(wh => wh !== yard && !isYard(wh));
        const shapeOf = (o) => [o.x, o.z, o.rot || 0, o.w, o.d, o.outline];
        const key = JSON.stringify([shapeOf(yard), others.map(shapeOf)]);
        const cached = yardSpots.get(yard.id);
        if (cached?.key === key) return cached.spot;
        const yardFrame = ownFrame(yard), yardLine = warehouseOutline(yard);
        const shapes = others.map(o => ({ frame: ownFrame(o), line: warehouseOutline(o) }));
        /** 그 점(전체 좌표)이 다른 건물 안이면 -1, 아니면 가장 가까운 건물 벽까지 거리 */
        const roomAt = (x, z) => shapes.reduce((room, s) => {
            const p = s.frame.toLocal(x, z);
            return room < 0 || isInOutline(s.line, p.x, p.z) ? -1 : Math.min(room, nearestEdge(s.line, p.x, p.z)?.dist ?? Infinity);
        }, Infinity);
        const center = outlineCenter(yardLine), mid = yardFrame.toWorld(center.x, center.z);
        let spot = null;
        if (roomAt(mid.x, mid.z) < 0) {
            let best = -1;
            const STEPS = 14;
            for (let i = 1; i < STEPS; i += 1) {
                for (let j = 1; j < STEPS; j += 1) {
                    const lx = (yard.w * i) / STEPS, lz = (yard.d * j) / STEPS;
                    if (!isInOutline(yardLine, lx, lz)) continue;
                    const at = yardFrame.toWorld(lx, lz);
                    const room = Math.min(roomAt(at.x, at.z), nearestEdge(yardLine, lx, lz)?.dist ?? 0);
                    if (room > best) { best = room; spot = at; }
                }
            }
        }
        yardSpots.set(yard.id, { key, spot });
        return spot;
    };
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
            // 건물 이름은 작업 층에 걸친 건물만 (층으로 쌓인 건물은 이름이 같은 자리에 겹친다)
            if (layers.ref.isVisible) draft.extras.buildings.filter(isOnFloor).forEach(b => text(centerOf(b), isWide(b) ? [b.name || b.id, `${fmt(b.w)}×${fmt(b.d)}m · 재고 위치 아님`] : [b.name || b.id], { size: 12, color: '#475569' }));
            if (layers.wh.isVisible) {
                whRows().filter(isOnFloor).forEach(wh => {
                    // 마당(옥외 창고)이 건물을 둘러싸고 있으면 한가운데가 건물 안이다 — 건물과 겹치지 않는 넓은 곳에 적는다
                    const spot = isYard(wh) ? yardLabelSpot(wh) : null;
                    text(spot ? toScreen(spot.x, spot.z) : centerOf(wh), isWide(wh) ? [`${wh.name || wh.id} · ${wh.id}`, `${fmt(wh.w)}×${fmt(wh.d)}m`] : [wh.name || wh.id], { size: isWide(wh) ? 13 : 11, ...(spot ? { color: '#475569' } : {}) });
                });
            }
            zoneRows().forEach(z => {
                const wh = whOf(z.warehouse), floor = floorOf(z);
                if (!wh || !layers[zoneLayer(z)].isVisible) return;
                const longPx = Math.max(z.w, z.d) * view.scale;
                if (longPx < 26) return;
                const no = z.id.split('-').pop();
                const at = sp(joinFrames(frameOf(wh), ownFrame(z)), z.w / 2, z.d / 2);
                // 위층 구획 이름은 층마다 한 줄씩 아래에 (같은 자리에 겹친 아래층 이름을 가리지 않게), 작업 층이 아니면 옅게
                text({ x: at.x, y: at.y + 14 * (floor - 1) }, [longPx < 90 ? no : `${no} ${z.name || ''}${floor > 1 && !String(z.name || '').includes('층') ? ` · ${floor}층` : ''}`],
                    { color: floor === activeFloor ? zoneStyle(z).stroke : '#94a3b8' });
            });
        }
        // 축척 막대(왼쪽 위) · 북쪽 표시(오른쪽 위 — 도면 방향 그대로 놓은 공장은 실제 북쪽으로 화살표를 돌린다: plant.north)
        const barM = SCALE_BAR_STEPS.find(n => n * view.scale >= 70) || 100, barW = barM * view.scale;
        const north = Number(plant.north) || 0, nx = rect.width - 22, ny = 36;
        const northAt = { x: nx + Math.sin((north * Math.PI) / 180) * 20, y: ny - Math.cos((north * Math.PI) / 180) * 20 }; // 화살표 끝 너머의 'N' 글자 자리
        out.push(`<g pointer-events="none" stroke="#334155" fill="none" stroke-width="1.5"><path d="M12 14v6h${barW.toFixed(1)}v-6"/><path transform="rotate(${north} ${nx} ${ny})" d="M${nx} ${ny + 10}V${ny - 10}m-5 7l5-7l5 7"/></g>
            <g pointer-events="none" font-size="11" font-weight="700" fill="#334155" stroke="#ffffff" stroke-width="3" paint-order="stroke" text-anchor="middle"><text x="${(12 + barW / 2).toFixed(1)}" y="34">${barM}m</text><text x="${northAt.x.toFixed(1)}" y="${northAt.y.toFixed(1)}" dominant-baseline="middle">N</text></g>`);
        if (calibFirst) { const p = toScreen(calibFirst.x, calibFirst.z); out.push(`<g pointer-events="none"><circle cx="${p.x}" cy="${p.y}" r="6" fill="none" stroke="#dc2626" stroke-width="2"/><circle cx="${p.x}" cy="${p.y}" r="1.5" fill="#dc2626"/></g>`); }
        // 끌어서 여러 개 고르는 네모
        if (marquee) {
            const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
            out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.abs(marquee.x1 - marquee.x0).toFixed(1)}" height="${Math.abs(marquee.y1 - marquee.y0).toFixed(1)}" fill="rgba(37,99,235,0.08)" stroke="#2563eb" stroke-width="1" stroke-dasharray="5 3" pointer-events="none"/>`);
        }

        // 손잡이·치수는 하나만 골랐을 때 (여러 개를 골랐으면 테두리 색으로만 표시)
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
        const turnHandle = (p, name, title) => handle(p, name, { round: true, fill: '#bfdbfe', cursor: 'grab', title });
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
                // 아주 작으면(파렛트 한 칸 등) 크기 손잡이 없이 — 확대하거나 속성에서 고친다, 가늘고 긴 것(랙·라인)은 양 끝 둘(길이), 작은 네모는 모서리 넷
                const sw = o.w * view.scale, sh = o.d * view.scale;
                const corner = [['nw', 0, 0], ['ne', o.w, 0], ['se', o.w, o.d], ['sw', 0, o.d]];
                const ends = { flat: [['e', o.w, o.d / 2], ['w', 0, o.d / 2]], slim: [['n', o.w / 2, 0], ['s', o.w / 2, o.d]] };
                const isFlat = sh < 48, isSlim = sw < 48;
                const spots = sw < 28 && sh < 28 ? [] : isFlat && isSlim ? corner : isFlat ? ends.flat : isSlim ? ends.slim : [...corner, ...ends.flat, ...ends.slim];
                spots.forEach(([name, lx, lz]) => handle(sp(f, lx, lz), `resize:${name}`, { title: '크기 바꾸기' }));
            }
            if (item.canRotate) {
                const top = sp(f, o.w / 2, 0), mid = sp(f, o.w / 2, o.d / 2);
                const len = Math.hypot(top.x - mid.x, top.y - mid.y) || 1;
                const at = { x: top.x + ((top.x - mid.x) / len) * 26, y: top.y + ((top.y - mid.y) / len) * 26 };
                out.push(`<line x1="${top.x.toFixed(1)}" y1="${top.y.toFixed(1)}" x2="${at.x.toFixed(1)}" y2="${at.y.toFixed(1)}" stroke="#2563eb" stroke-width="1" pointer-events="none"/>`);
                turnHandle(at, 'rotate', '돌리기 (Shift = 15°씩)');
            }
        } else if (item.kind === 'ARROW') {
            if (canChange) {
                handle(toScreen(item.o.from[0], item.o.from[1]), 'arrow:from', { round: true, cursor: 'move', title: '화살표 시작' });
                handle(toScreen(item.o.to[0], item.o.to[1]), 'arrow:to', { round: true, cursor: 'move', title: '화살표 끝' });
            }
        } else if (item.isFreeDoor) {
            // 찍은 자리의 문: 양 끝(길이) + 바깥쪽의 동그라미(방향)
            const f = fullFrame(item), half = item.o.len / 2;
            const pa = sp(f, -half, 0), pb = sp(f, half, 0);
            dimension(pa, pb, `${fmt(item.o.len)}m`);
            if (canChange) {
                handle(pa, 'fdoor:a', { cursor: 'move', title: '문 끝 — 끌어서 길이 바꾸기' });
                handle(pb, 'fdoor:b', { cursor: 'move', title: '문 끝 — 끌어서 길이 바꾸기' });
                turnHandle(sp(f, 0, -(0.45 + 22 / view.scale)), 'fdoor:rot', '문 방향 돌리기 (Shift = 15°씩)');
            }
        } else if (item.kind === 'DOOR') {
            const wall = wallOf(item.wh, item.o.wall);
            const a = wall.point(item.o.from), b = wall.point(item.o.to);
            const pa = sp(item.parent, a.x, a.z), pb = sp(item.parent, b.x, b.z);
            dimension(pa, pb, `${fmt(item.o.to - item.o.from)}m`);
            if (canChange) { handle(pa, 'door:from', { cursor: 'move', title: '문 시작' }); handle(pb, 'door:to', { cursor: 'move', title: '문 끝' }); }
        } else if (item.kind === 'PROP') {
            // 방향 손잡이: 모형 앞 끝에서 22px 더 나간 자리
            if (canChange) turnHandle(sp(fullFrame(item), 0, -(propSize(item.o).front + 22 / view.scale)), 'prop:rot', '방향 돌리기 (Shift = 15°씩)');
        } else if (item.kind === 'BG') {
            const s = bg.setting, h = s.widthM * bg.aspect;
            const corners = [toScreen(s.x, s.z), toScreen(s.x + s.widthM, s.z), toScreen(s.x + s.widthM, s.z + h), toScreen(s.x, s.z + h)];
            frameBox(corners);
            dimension(corners[3], corners[2], `${fmt(s.widthM)}m`);
            if (canChange) handle(corners[2], 'bg:scale', { cursor: 'nwse-resize', title: '그림 크기 (가로 폭)' });
        }
        return out.join('');
    };

    /** 평면도 위의 커서: 화면 옮기기(손 도구·Space) = 손, 고르기 = 화살표, 놓기·축척 맞추기 = 십자 */
    const cursorNow = () => (tool === 'pan' || isSpaceDown ? 'grab' : tool === 'select' ? 'default' : 'crosshair');
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
        svg.style.cursor = cursorNow();
    };
    // 화면이 가려져 있으면 requestAnimationFrame이 멈추므로 타이머로도 그린다
    const scheduleDraw = () => {
        if (drawQueued) return;
        drawQueued = requestAnimationFrame(drawSvg);
        drawTimer = setTimeout(drawSvg, 150);
    };

    // ---------- 물체 이름·요약 ----------
    const doorPlace = (o) => (o.wall === FREE_WALL ? (o.warehouse ? `${o.warehouse} 찍은 자리` : '따로 선 문') : `${o.warehouse} ${WALL_NAMES[o.wall]}`);
    const itemTitle = (key, item) => {
        const o = item.o;
        switch (item.kind) {
            case 'WH': case 'ZONE': return `${o.id} ${o.name || ''}`;
            case 'REF': return o.name || o.id;
            case 'MARK': return `바닥 표시 ${String(o.text || '').split('\n')[0]}`;
            case 'ARROW': return '화살표';
            case 'ANNEX': return `${o.warehouse} 부속`;
            case 'DOOR': return o.name || `${doorPlace(o)} 출입문`;
            case 'PROP': return o.name || PROP_MODELS[o.type].name;
            case 'BG': return `배경 도면 ${bg.name}`;
            default: return key;
        }
    };
    const itemSummary = (item) => {
        const o = item.o;
        if (item.isBox) {
            const floor = item.kind === 'ZONE' ? floorOf(o) : item.kind === 'WH' || item.kind === 'REF' ? buildingFloor(o) : 1;
            return ` · x ${fmt(o.x)} z ${fmt(o.z)} · ${fmt(o.w)}×${fmt(o.d)}m${item.canRotate ? ` · ${fmt(o.rot || 0)}°` : ''}${floor > 1 ? ` · ${floor}층` : ''}`;
        }
        if (item.isFreeDoor) return ` · ${doorPlace(o)} · x ${fmt(o.x)} z ${fmt(o.z)} · ${fmt(o.len)}m · ${fmt(o.rot || 0)}°`;
        if (item.kind === 'DOOR') return ` · ${WALL_NAMES[o.wall]} ${fmt(o.from)}~${fmt(o.to)}m`;
        if (item.kind === 'PROP') return ` · ${o.warehouse || '건물 밖'} · x ${fmt(o.x)} z ${fmt(o.z)} · ${fmt(o.rot || 0)}°`;
        if (item.kind === 'BG') return ` · 가로 ${fmt(o.widthM)}m`;
        return '';
    };
    /** 레이어의 물체 목록 [키, 이름] */
    const itemsOfLayer = (layer) => {
        if (layer.floor) return zoneRows().filter(z => floorOf(z) === layer.floor).sort((a, b) => a.id.localeCompare(b.id)).map(z => [`ZONE:${z.id}`, `${z.id} ${z.name || ''}`]);
        switch (layer.id) {
            case 'bg': return bg.url ? [['BG', bg.name || '배경 도면']] : [];
            case 'site': return [...draft.extras.floorMarks.map((m, i) => [`MARK:${i}`, `바닥 표시 · ${String(m.text || '').split('\n')[0] || '(글자 없음)'}`]), ...draft.extras.arrows.map((a, i) => [`ARROW:${i}`, `화살표 ${i + 1}`])];
            case 'ref': return draft.extras.buildings.map((b, i) => [`REF:${i}`, b.name || b.id]);
            case 'wh': return whRows().map(wh => [`WH:${wh.id}`, `${wh.id} ${wh.name || ''}`]);
            case 'fit': return [...draft.extras.annexes.map((a, i) => [`ANNEX:${i}`, `부속 ${i + 1} · ${a.warehouse}`]), ...draft.extras.doors.map((d, i) => [`DOOR:${i}`, d.name || `출입문 · ${doorPlace(d)}`])];
            case 'prop': return draft.extras.props.map((p, i) => [`PROP:${i}`, `${p.name || PROP_MODELS[p.type].name} · ${p.warehouse || '건물 밖'}`]);
            default: return [];
        }
    };

    // ---------- 위쪽 도구줄 · 상태 · 안내 ----------
    const renderTools = () => {
        const TOOL_BTN = 'shrink-0 whitespace-nowrap min-h-[34px] sm:min-h-0 rounded-md border'; // 스마트폰은 손가락 크기
        const btn = (id, label, title, isOn = false) => `<button data-tool="${id}" title="${esc(title)}" class="${TOOL_BTN} px-2 py-1 ${isOn ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-slate-50'}">${label}</button>`;
        const addBtn = (id, label, title) => btn(`add:${id}`, `+ ${label}`, title, tool === `add:${id}`);
        const viewBtn = (id, icon, title) => `<button data-view="${id}" class="${TOOL_BTN} min-w-[34px] sm:min-w-0 px-1.5 py-1 bg-white hover:bg-slate-50" title="${title}"><i data-lucide="${icon}" class="w-3.5 h-3.5"></i></button>`;
        const SMALL_BOX = 'border rounded px-1 py-0.5 min-h-[34px] sm:min-h-0';
        const GROUP = 'flex items-center gap-1 shrink-0', HEAD = 'text-slate-500 shrink-0';
        const gridBox = (key, title) => `<input data-cell="${key}" type="number" min="1" max="${MAX_CELL_GRID}" step="1" value="${cellGrid[key]}" title="${title}" class="w-11 text-right ${SMALL_BOX}">`;
        // 파렛트 칸 도구를 고른 동안에만: 한 번에 놓을 칸 수(가로 × 세로)와 단 수
        const cellGridHtml = tool === 'add:CELL' ? `<span class="${GROUP} whitespace-nowrap text-blue-700">가로 ${gridBox('cols', '가로로 놓을 칸 수')} × 세로 ${gridBox('rows', '세로로 놓을 칸 수')} 칸 · ${gridBox('tiers', '한 칸에 쌓는 단 수')} 단</span>` : '';
        $('#pe-tools').innerHTML = `
            ${canEdit ? btn('select', '<i data-lucide="mouse-pointer-2" class="w-3.5 h-3.5 inline"></i> 고르기', '눌러서 고르고 끌어서 옮기기 · 빈 곳을 끌면 그 네모 안의 것을 한꺼번에 고른다 · Shift+누르기 = 넣고 빼기 (Esc)', tool === 'select') : ''}
            ${btn('pan', '<i data-lucide="hand" class="w-3.5 h-3.5 inline"></i> 화면 옮기기', '끌어서 화면을 옮긴다 (고르기 도구에서는 Space를 누른 채 끌기 · 두 손가락 끌기)', tool === 'pan')}
            <span class="${GROUP} whitespace-nowrap" title="작업 층: 새 구획이 이 층에 놓이고, 평면도에서는 이 층의 구획과 이 층에 걸친 건물만 눌립니다 (다른 층은 흐리게 — 층마다 창고가 다른 건물은 층을 바꿔 가며 봅니다)"><b class="${HEAD}">층</b>
                <select id="pe-floor" class="${SMALL_BOX} font-bold">${floorChoices().map(f => `<option value="${f}" ${activeFloor === f ? 'selected' : ''}>${f}층</option>`).join('')}</select>
                ${canEdit ? `<label class="flex items-center gap-1" title="한 층의 높이 — 2층 바닥 = 이 값, 3층 바닥 = 이 값의 두 배. 바꾸면 위층에 놓은 구획·계단의 높이도 따라 바뀝니다">층 높이 <input id="pe-floor-h" type="number" min="2" max="10" step="0.1" value="${floorHeight()}" class="w-14 text-right ${SMALL_BOX}">m</label>` : ''}</span>
            ${canEdit ? `<span class="${GROUP}"><b class="${HEAD}">구획</b>
                ${addBtn('RACK', '랙', '파렛트랙 한 줄 (6칸 × 3단 — 천장이 낮은 층에서는 들어가는 단 수만큼) — 놓은 뒤 길이·칸 수·줄 수를 고친다')}${addBtn('LINE', '바닥 라인', '바닥 적재 열 (파렛트 6개 × 2단)')}
                ${addBtn('CELL', '파렛트 칸', `파렛트 한 칸 = 구획 하나 (${PALLET_CELL.w} × ${PALLET_CELL.d}m) — 가로 × 세로 칸 수를 정해 여러 칸을 한 번에 놓을 수 있다`)}${cellGridHtml}
                ${addBtn('AREA', '구역', '구역 (층 구역 등) — 속성에서 칸 수·줄 수를 넣으면 그 안에 파렛트 자리가 가로 × 세로로 생긴다')}
                ${outdoorCode ? addBtn('YARD', '옥외 구역', `건물 밖(마당)에 놓는 보관 구역 — 공토트 보관구역·임시보관구역 등. 옥외 창고 ${outdoorCode}의 구획(재고 위치)이 된다. 랙·바닥 라인·파렛트 칸·구역도 건물 밖을 누르면 옥외 구획으로 놓인다`) : ''}</span>
            <span class="${GROUP}"><b class="${HEAD}">주변</b>
                ${addBtn('MARK', '바닥 표시', '바닥에 칠한 사각형 + 글자 (도로·출입구 등)')}${addBtn('ARROW', '화살표', '바닥 화살표')}${addBtn('REF', '참고 건물', '재고 위치가 아닌 건물 (사무실동 등)')}
                ${addBtn('ANNEX', '부속', '건물에 붙은 작은 부속 (현관·캐노피)')}${addBtn('DOOR', '출입문', '누른 자리에 출입문 — 가까운 벽(비스듬한 벽 포함)에 붙고, 벽에서 멀면 그 자리에 따로 선 문(대문)이 된다')}</span>
            <span class="${GROUP}"><b class="${HEAD}">모형</b>
                <select id="pe-prop-kind" class="${SMALL_BOX}" title="놓을 모형 — 고르면 바로 놓기 도구가 켜진다">${Object.entries(PROP_MODELS).map(([type, model]) => `<option value="${type}" ${propKind === type ? 'selected' : ''}>${esc(model.name)}</option>`).join('')}</select>
                ${addBtn('PROP', '놓기', '고른 모형을 누른 자리에 놓는다 — 건물 안이면 그 건물과 같이 움직이고, 건물 밖(도로·마당)에도 놓을 수 있다')}</span>
            <label class="${GROUP} whitespace-nowrap" title="옮기거나 크기를 바꿀 때 이 간격에 맞춘다"><i data-lucide="magnet" class="w-3.5 h-3.5 text-slate-500"></i>맞춤
                <select id="pe-snap" class="${SMALL_BOX}"><option value="0" ${snapStep === 0 ? 'selected' : ''}>끔</option>${SNAP_STEPS.map(s => `<option value="${s}" ${snapStep === s ? 'selected' : ''}>${s}m</option>`).join('')}</select></label>` : ''}
            <span class="${GROUP}">${viewBtn('out', 'zoom-out', '축소')}${viewBtn('in', 'zoom-in', '확대')}${viewBtn('fit', 'maximize', '전체가 보이게')}</span>
            <span class="${GROUP}"><b class="${HEAD}">배경 도면</b>
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
    /** 고른 도구의 안내 글 */
    const toolHint = () => {
        const where = activeFloor > 1 ? `${activeFloor}층에 ` : '';
        // 건물 밖에 놓을 수 있는지: 1층에서, 그 공장에 옥외 창고가 있을 때 (그 창고의 구획이 된다)
        const outside = activeFloor > 1 ? ' (위층은 건물 안에만)' : outdoorCode ? ` — 건물 안, 또는 건물 밖 마당(옥외 창고 ${outdoorCode}의 구획)` : ' (건물 안)';
        if (tool === 'calib' && calibFirst) return '두 번째 점을 누르세요';
        if (tool === 'add:CELL') return `${where}파렛트 칸 ${cellGrid.cols} × ${cellGrid.rows} = ${cellGrid.cols * cellGrid.rows}개(${cellGrid.tiers}단)를 놓을 자리를 누르세요 — 누른 곳이 한가운데${outside}`;
        if (tool === 'add:PROP') return `${PROP_MODELS[propKind].name} 놓을 자리를 누르세요 (건물 밖에도 놓을 수 있습니다)`;
        if (['add:RACK', 'add:LINE', 'add:AREA'].includes(tool)) return `${where}${TOOL_HINTS[tool]}${outside}`;
        if (tool === 'add:YARD') return `${TOOL_HINTS[tool]} — 옥외 창고 ${outdoorCode}의 구획이 됩니다`;
        return TOOL_HINTS[tool] || '';
    };
    const renderHud = (world = null) => {
        const item = resolve(selected);
        const lines = [];
        if (tool !== baseTool) lines.push(`<b class="text-amber-300">${esc(toolHint())}</b> · Esc = ${tool === 'pan' ? '고르기 도구로' : '그만두기'}`);
        if (group.length) lines.push(`<b>${group.length}개 고름</b> · 끌어서 함께 옮기기 · 방향키 = 한 칸씩 · Shift+누르기 = 넣고 빼기`);
        if (item) lines.push(`<b>${esc(itemTitle(selected, item))}</b>${itemSummary(item)}`);
        if (world) lines.push(`x ${world.x.toFixed(2)} · z ${world.z.toFixed(2)} m${activeFloor > 1 ? ` · 작업 층 ${activeFloor}층` : ''}`);
        if (!lines.length) lines.push(canEdit ? '눌러서 고르고 끌어서 옮깁니다 · 빈 곳을 끌면 여러 개 고르기 · 화면 옮기기 = Space+끌기(또는 손 도구) · 휠 = 확대' : '끌어서 화면 옮기기 · 휠 = 확대');
        $('#pe-hud').innerHTML = lines.join('<br>');
    };

    // ---------- 오른쪽: 레이어 ----------
    const hasChangedExtras = () => JSON.stringify(cleanExtras(draft.extras)) !== JSON.stringify(defaultPlantExtras(plantId));
    const renderLayers = () => {
        $('#pe-layers').innerHTML = `
            <div class="flex items-center justify-between mb-1"><b class="text-sm">레이어</b><span class="text-[11px] text-slate-400">눈 = 보이기 · 자물쇠 = 잠금</span></div>
            ${[...layerList()].reverse().map(l => {
                const st = layers[l.id], list = itemsOfLayer(l), hasList = l.id !== 'label';
                const isWorkFloor = l.floor === activeFloor && shownFloors() > 1;
                return `<div class="border-t first:border-t-0">
                    <div class="flex items-center gap-1 py-0.5 text-xs" title="${esc(l.hint)}">
                        <button data-eye="${l.id}" class="p-1.5 sm:p-1 rounded hover:bg-slate-100 ${st.isVisible ? 'text-slate-700' : 'text-slate-300'}" title="${st.isVisible ? '숨기기' : '보이기'}"><i data-lucide="${st.isVisible ? 'eye' : 'eye-off'}" class="w-4 h-4"></i></button>
                        ${hasList ? `<button data-lock="${l.id}" class="p-1.5 sm:p-1 rounded hover:bg-slate-100 ${st.isLocked ? 'text-amber-600' : 'text-slate-300'}" title="${st.isLocked ? '잠금 풀기 (평면도에서 고를 수 있게)' : '잠그기 (눌러도 고르지 않게)'}"><i data-lucide="${st.isLocked ? 'lock' : 'lock-open'}" class="w-4 h-4"></i></button>` : '<span class="w-7 sm:w-6"></span>'}
                        <button data-open="${l.id}" class="flex-1 text-left py-1.5 sm:py-0.5 ${st.isVisible ? '' : 'text-slate-400'}"><b>${esc(l.name)}</b>${hasList ? ` <span class="text-slate-400">${list.length}</span>` : ''}${isWorkFloor ? ' <span class="text-[10px] px-1 rounded bg-blue-100 text-blue-700 font-bold">작업 층</span>' : ''}</button>
                    </div>
                    ${openList === l.id && hasList ? `<div class="pl-9 pb-1.5 space-y-0.5">${list.map(([key, name]) => `<button data-pick="${esc(key)}" class="tap-compact block w-full text-left text-[11px] px-1.5 py-1.5 sm:py-0.5 rounded ${isSel(key) ? 'bg-blue-100 text-blue-800 font-bold' : 'hover:bg-slate-100 text-slate-600'}">${esc(name)}</button>`).join('') || '<span class="text-[11px] text-slate-400">없음</span>'}</div>` : ''}
                </div>`;
            }).join('')}
            ${canEdit && hasChangedExtras() ? '<button data-act="extras-default" class="mt-2 px-2 py-1 min-h-[34px] sm:min-h-0 rounded-lg text-[11px] border bg-white hover:bg-slate-50" title="주변 표시·참고 건물·부속·출입문·모형·층 높이를 처음 값(앱 기본값)으로 — [저장]을 눌러야 반영">주변·참고·부속·모형을 기본값으로</button>' : ''}`;
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
            case 'floor': return item.kind === 'ZONE' ? floorOf(o) : buildingFloor(o);
            case 'slots': return o.slots || 0;
            case 'lanes': return o.lanes || 1;
            case 'tiers': return o.tiers || 1;
            case 'fillFrom': return o.fillFrom === 'END' ? 'END' : 'START';
            case 'slide': return o.slide > 0 ? 1 : -1;
            default: return o[prop] ?? '';
        }
    };
    /** 속성 칸 아래의 한 줄 요약: 구획 = 칸 수·한 칸 크기·재고, 계단 = 단 수·길이, 저장 탱크 = 부피 */
    const infoHtml = (item) => {
        const o = item.o;
        if (item.kind === 'ZONE') {
            const { slots, tiers, cols, lanes } = zoneDims(o);
            const stock = zoneStock(o).length;
            const grid = slots
                ? `파렛트 자리 ${cols}칸${lanes > 1 ? ` × ${lanes}줄` : ''} × ${tiers}단 = <b>${slots * tiers}칸</b> · 한 칸 ${fmt(Math.max(o.w, o.d) / cols)} × ${fmt(Math.min(o.w, o.d) / lanes)}m`
                : '칸 없는 구역 (보관 품목이 한 덩어리로 보임) — 칸 수·줄 수를 넣으면 파렛트 자리가 생깁니다';
            return `${grid}${stock ? ` · <b class="text-amber-700">재고 ${stock}품목</b>` : ''}`;
        }
        if (item.kind === 'PROP' && o.type === 'STAIRS') {
            const size = propSize(o), run = size.front + size.back, from = Number(o.y) || 0;
            return `${Math.round(run / STAIR_STEP.tread)}단 · 평면 길이 ${fmt(run)}m · 높이 ${fmt(from)}m → ${fmt(from + (Number(o.h) || 0))}m (화살표 = 오르는 쪽)`;
        }
        if (item.kind === 'PROP' && o.type === 'TANK') return `부피 약 ${fmt(Math.PI * (o.dia / 2) ** 2 * o.h)}㎥ — 참고 모형이라 재고와는 무관합니다`;
        return '';
    };
    const ACT_BTN = 'px-2.5 py-1 min-h-[34px] sm:min-h-0 rounded-lg text-xs';
    /** 여러 개를 골랐을 때의 속성 칸: 종류별 개수 + 함께 하는 일(층 옮기기·복제·지우기) */
    const groupHtml = () => {
        const items = group.map(resolve).filter(Boolean);
        const counts = {};
        items.forEach(item => { counts[item.kind] = (counts[item.kind] || 0) + 1; });
        const hasZone = !!counts.ZONE;
        const btn = (id, label, tone = 'border bg-white hover:bg-slate-50', title = '') => `<button data-act="${id}" title="${esc(title)}" class="${ACT_BTN} ${tone}">${label}</button>`;
        return `<div class="flex items-center justify-between gap-2"><b class="text-sm">${items.length}개 고름</b><span class="text-[11px] text-slate-400 shrink-0">여러 개</span></div>
            <div class="space-y-1.5 text-xs">
                <p class="text-slate-600">${Object.entries(counts).map(([kind, n]) => `${esc(KIND_NAMES[kind])} ${n}`).join(' · ')}</p>
                ${canEdit ? `<p class="text-[11px] text-slate-500">고른 것 가운데 하나를 끌면 모두 함께 움직입니다. 방향키 = 한 칸씩 · Shift+누르기 = 하나씩 넣고 빼기 · 고른 것 하나를 그냥 누르면 그것만 고릅니다.</p>
                ${hasZone ? `<label class="flex items-center justify-between gap-2" title="고른 구획을 그 층으로 옮긴다 (바닥 높이 = 층 높이 × (층 − 1))"><span class="text-slate-500 shrink-0">구획 ${counts.ZONE}개를 다른 층으로</span>
                    <select id="pe-group-floor" class="w-32 border rounded px-1.5 py-1"><option value="">층 고르기</option>${floorChoices().map(f => `<option value="${f}">${f}층${f > 1 ? ` (바닥 ${fmt(floorY(f))}m)` : ''}</option>`).join('')}</select></label>` : ''}
                <div class="flex flex-wrap gap-1.5">${btn('group-duplicate', '복제', undefined, '고른 것을 같은 배치 그대로 오른쪽 옆에 하나 더 (Ctrl+D)')}${btn('group-delete', '지우기', 'border border-red-200 text-red-600 hover:bg-red-50', '창고와 재고가 남은 구획은 지우지 않는다 (Delete)')}${btn('group-clear', '선택 풀기', undefined, 'Esc')}</div>`
                    : `<div class="flex flex-wrap gap-1.5">${btn('group-clear', '선택 풀기', undefined, 'Esc')}</div>`}
            </div>`;
    };
    const propsHtml = () => {
        if (group.length) return groupHtml();
        const item = resolve(selected);
        if (!item) {
            return `<p class="text-xs text-slate-500">평면도나 레이어 목록에서 건물·구획·표시를 고르면 여기서 숫자로 고칠 수 있습니다.${canEdit
                ? ' 빈 곳을 끌어 네모를 그리면 그 안에 다 들어온 것을 한꺼번에 골라 함께 옮깁니다(Shift+누르기 = 하나씩 넣고 빼기). 잠긴 레이어(자물쇠)는 평면도에서 눌러도 고를 수 없으니, 끌어서 고치려면 자물쇠를 푸세요.' : ''}</p>`;
        }
        const o = item.o;
        const off = canEdit ? '' : 'disabled';
        const field = (label, prop, { type = 'number', step = 0.1, min = '', max = '', unit = '', title = '' } = {}) => `
            <label class="flex items-center justify-between gap-2" title="${esc(title)}"><span class="text-slate-500 shrink-0">${esc(label)}</span>
                <span class="flex items-center gap-1"><input data-prop="${prop}" type="${type}" ${type === 'number' ? `step="${step}" ${min !== '' ? `min="${min}"` : ''} ${max !== '' ? `max="${max}"` : ''}` : ''} value="${esc(propValue(item, prop))}" ${off}
                    class="${type === 'number' ? 'w-24 text-right' : 'w-40'} border rounded px-1.5 py-1"><span class="text-slate-400 w-5">${esc(unit)}</span></span></label>`;
        const selectField = (label, prop, options, title = '') => `
            <label class="flex items-center justify-between gap-2" title="${esc(title)}"><span class="text-slate-500 shrink-0">${esc(label)}</span>
                <span class="flex items-center gap-1"><select data-prop="${prop}" ${off} class="w-40 border rounded px-1.5 py-1">${options.map(([v, text]) => `<option value="${esc(v)}" ${String(v) === String(propValue(item, prop)) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select><span class="w-5"></span></span></label>`;
        const act = (id, label, tone = 'border bg-white hover:bg-slate-50', title = '') => (canEdit ? `<button data-act="${id}" title="${esc(title)}" class="${ACT_BTN} ${tone}">${label}</button>` : '');
        const delBtn = act('delete', '지우기', 'border border-red-200 text-red-600 hover:bg-red-50');
        const whOptions = whRows().map(wh => [wh.id, `${wh.id} ${wh.name || ''}`]);
        const outsideOption = ['', '건물 밖 (공장 기준)'];
        const isSite = item.parent === IDENT;
        const xz = `${field(isSite ? 'x (동쪽 +)' : 'x (창고 기준)', 'x', { unit: 'm' })}${field(isSite ? 'z (남쪽 +)' : 'z (창고 기준)', 'z', { unit: 'm' })}`;
        const size = `${field('가로', 'w', { min: MIN_SIZE, unit: 'm' })}${field('세로', 'd', { min: MIN_SIZE, unit: 'm' })}`;
        const info = infoHtml(item);
        const infoRow = info ? `<div id="pe-info" class="text-[11px] text-slate-600">${info}</div>` : '';
        const doorStyle = `${selectField('모양', 'style', Object.entries(DOOR_STYLES))}${o.style === 'SLIDE' ? selectField('밀리는 쪽', 'slide', [[-1, '시작 쪽으로'], [1, '끝 쪽으로']]) : ''}`;
        const outlineRow = () => `<div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">${hasOutline(o)
            ? `바닥이 다각형(${warehouseOutline(o).length}점)입니다 — 꼭짓점을 끌어 고치고, 변 가운데 동그라미로 점을 넣습니다. ${act('rect', '사각형으로')}`
            : `바닥이 사각형입니다. ${act('polygon', '다각형으로 (꼭짓점 편집)')}`}</div>`;
        const floorOptions = (floors) => floors.map(f => [f, `${f}층${f > 1 ? ` (바닥 ${fmt(floorY(f))}m)` : ''}`]);
        // 건물(창고·참고 건물)이 놓인 층: 층마다 창고코드가 다른 건물은 같은 자리에 창고를 층층이 쌓는다
        const buildingFloorFields = `${selectField('층', 'floor', floorOptions(floorChoices()), '이 건물이 놓인 층 — 지면에 선 건물은 1층. 층마다 창고코드가 다른 건물이면 층마다 창고를 같은 자리에 놓고 그 층을 고릅니다 (바닥 높이 = 층 높이 × (층 − 1))')}
            ${field('바닥 높이', 'y', { min: 0, unit: 'm', title: '층을 고르면 저절로 들어갑니다 (0 = 지면). 층 사이 높이면 직접 적습니다' })}`;
        let body = '';
        switch (item.kind) {
            case 'WH':
                body = `${field('이름', 'name', { type: 'text' })}${xz}${size}${field('벽 높이', 'h', { min: 0.1, unit: 'm', title: '0.6m 이하면 벽 없는 옥외(바닥 턱만)로 그립니다. 층으로 쌓은 창고는 한 층 높이로 둡니다' })}${field('회전', 'rot', { step: 0.5, unit: '°', title: '위에서 볼 때 시계 방향' })}${buildingFloorFields}${outlineRow()}
                    <p class="text-[11px] text-slate-500">건물을 옮기거나 돌리면 그 안의 구획·부속·출입문·모형도 같이 움직입니다. 창고코드(${esc(o.id)})는 재고 위치라 바꾸거나 지울 수 없습니다.${o.id === outdoorCode ? ' <b>옥외 창고</b>입니다 — 건물 밖에 놓는 구획이 이 창고의 구획이 됩니다.' : ''}</p>`;
                break;
            case 'ZONE': {
                const { cols, lanes } = zoneDims(o);
                // 구획이 갈 수 있는 층: 그 창고 바닥 높이부터 (위층 창고의 구획을 아래층으로 내릴 수는 없다 — 창고코드가 다르다)
                const zoneFloors = floorChoices().filter(f => floorY(f) >= baseHeight(item.wh) - 0.01);
                const quickNames = isYard(item.wh) && canEdit
                    ? `<div class="flex flex-wrap items-center gap-1 text-[11px] text-slate-500" title="옥외 구역에 자주 쓰는 이름 — 누르면 이름이 바뀝니다">옥외 구역 이름 ${OUTDOOR_ZONE_NAMES.map(name => `<button data-act="name:${esc(name)}" class="px-2 py-1 min-h-[30px] sm:min-h-0 rounded-lg border bg-white hover:bg-sky-50 text-sky-700 font-bold">${esc(name)}</button>`).join('')}</div>` : '';
                body = `${field('이름', 'name', { type: 'text' })}${quickNames}${selectField('종류', 'zoneType', Object.entries(ZONE_TYPES))}${xz}${size}${field('높이', 'h', { min: 0.1, unit: 'm' })}
                    ${field('회전', 'rot', { step: 0.5, unit: '°', title: '창고 기준으로 돌린 각도 — 비스듬한 벽을 따라 놓을 때' })}
                    ${selectField('층', 'floor', floorOptions(zoneFloors), '이 구획이 놓인 층 — 고르면 바닥 높이가 층 높이에 맞춰 들어갑니다 (층 높이는 위쪽 도구줄)')}
                    ${field('바닥 높이', 'y', { min: 0, unit: 'm', title: '창고 바닥에서 잰 높이 — 층을 고르면 저절로 들어갑니다. 중이층처럼 층 사이 높이면 직접 적습니다 (0 = 창고 바닥)' })}
                    ${field('칸 수 (한 줄)', 'slots', { step: 1, min: 0, max: MAX_GRID, title: '긴 변을 따라 한 줄에 놓이는 파렛트 수 (0 = 칸 없음)' })}
                    ${field('줄 수', 'lanes', { step: 1, min: 1, max: MAX_GRID, title: '짧은 변 쪽으로 나란히 놓이는 줄 수 — 칸 수 × 줄 수 = 바닥에 놓이는 파렛트 자리' })}
                    ${field('단 수', 'tiers', { step: 1, min: 1, title: '위로 쌓는 단 수' })}
                    ${selectField('채우는 쪽', 'fillFrom', [['START', '시작 쪽부터 (점 표시)'], ['END', '반대쪽부터']])}
                    ${infoRow}
                    <div class="flex flex-wrap gap-1.5">${act('fit-slots', '크기에 맞춰 칸·줄 수', undefined, `긴 변은 ${RACK_LINE.pitch}m 간격의 칸으로, 짧은 변은 ${RACK_LINE.wide}m 폭의 줄로 나눠 칸 수·줄 수를 넣는다`)}
                        ${cols * lanes >= 2 ? act('split-cells', '칸마다 구획으로 나누기', undefined, '이 구획의 파렛트 자리 하나하나를 따로 구획(재고 위치)으로 만든다 — 첫 칸이 지금 구획코드를 잇고 나머지는 새 코드를 받는다 (재고가 없는 구획만)') : ''}
                        ${act('duplicate', '복제')}${delBtn}</div>
                    <p class="text-[11px] text-slate-500">구획코드(${esc(o.id)})는 저장하면 재고 위치 이름이 됩니다. 재고가 남은 구획은 지울 수 없습니다.</p>`;
                break;
            }
            case 'REF':
                body = `${field('이름', 'name', { type: 'text' })}${xz}${size}${field('높이', 'h', { min: 0.1, unit: 'm' })}${field('회전', 'rot', { step: 0.5, unit: '°' })}${buildingFloorFields}${outlineRow()}
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
                body = item.isFreeDoor
                    ? `${field('이름', 'name', { type: 'text' })}${selectField('건물', 'warehouse', [outsideOption, ...whOptions], '건물을 고르면 그 건물을 옮기거나 돌릴 때 같이 움직입니다 (보이는 자리는 그대로)')}${xz}
                        ${field('길이', 'len', { min: MIN_DOOR, unit: 'm' })}${field('방향', 'rot', { step: 1, unit: '°', title: '문이 놓인 방향: 0이면 동서로 놓이고 바깥이 위(북)쪽, 90이면 남북으로 놓이고 바깥이 오른쪽(동) — 짧은 금이 바깥쪽' })}${doorStyle}
                        <p class="text-[11px] text-slate-500">찍은 자리에 놓은 문입니다. 끌면 가까운 벽(${DOOR_GLUE}m 안 — 비스듬한 벽·참고 건물 포함)에 붙어 벽 방향을 따르고, 벽에서 멀면 그 자리에 따로 섭니다(대문·칸막이 문). 양 끝 네모 = 길이, 동그라미 = 방향.</p>`
                    : `${field('이름', 'name', { type: 'text' })}${selectField('건물', 'warehouse', whOptions)}${selectField('벽', 'wall', Object.entries(WALL_NAMES))}
                        ${field('시작', 'from', { min: 0, unit: 'm', title: '벽의 왼쪽(위쪽) 끝에서 잰 거리' })}${field('끝', 'to', { min: 0, unit: 'm' })}${doorStyle}
                        <p class="text-[11px] text-slate-500">벽에 붙인 문입니다 — 끌면 벽을 따라 움직이고 모퉁이를 지나면 옆 벽으로 넘어갑니다. 3D에서는 벽을 뚫고 문짝 모양으로 보입니다.</p>`;
                body += `<div class="flex flex-wrap gap-1.5">${act('duplicate', '복제')}${delBtn}</div>`;
                break;
            case 'PROP': {
                const sizeFields = o.type === 'STAIRS'
                    ? `${field('오르는 높이', 'h', { min: 0.3, unit: 'm', title: '계단이 오르는 높이 — 처음 값은 층 높이' })}${field('폭', 'wide', { min: 0.6, unit: 'm' })}${field('시작 높이', 'y', { min: 0, unit: 'm', title: '계단이 시작하는 바닥 높이 (2층에서 3층으로 오르는 계단이면 2층 바닥 높이)' })}`
                    : o.type === 'TANK' ? `${field('지름', 'dia', { min: 0.5, unit: 'm' })}${field('높이', 'h', { min: 0.3, unit: 'm' })}` : '';
                body = `${selectField('종류', 'type', Object.entries(PROP_MODELS).map(([type, model]) => [type, model.name]))}${field('이름', 'name', { type: 'text' })}
                    ${selectField('건물', 'warehouse', [outsideOption, ...whOptions])}${xz}${field('방향', 'rot', { step: 5, unit: '°', title: '앞(포크·운전석·계단을 오르는 쪽)이 향하는 쪽: 0 위 · 90 오른쪽 · 180 아래 · 270 왼쪽' })}${sizeFields}${infoRow}
                    <p class="text-[11px] text-slate-500">3D와 평면도에 그리는 참고 모형입니다(재고와 무관). 건물 안에 두면 그 건물을 옮기거나 돌릴 때 같이 움직이고, 건물을 바꿔도 보이는 자리는 그대로입니다.</p>
                    <div class="flex flex-wrap gap-1.5">${act('duplicate', '복제')}${delBtn}</div>`;
                break;
            }
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
        const info = $('#pe-info');
        if (info) info.innerHTML = infoHtml(item);
    };
    const renderAll = () => { drawSvg(); renderLayers(); renderProps(); renderTools(); renderState(); renderHud(); };

    // ---------- 고르기: 하나 · 여럿 ----------
    const select = (key, vertex = -1) => {
        group = [];
        selected = resolve(key) ? key : '';
        selVertex = selected ? vertex : -1;
        const item = resolve(selected);
        if (item) openList = item.layer;
    };
    /** 여러 개를 고른다 (하나만 남으면 하나 고른 것과 같다). 배경 도면은 여럿에 넣지 않는다 */
    const setSelection = (keys) => {
        const list = [...new Set(keys)].filter(key => key !== 'BG' && resolve(key));
        if (list.length <= 1) { select(list[0] || ''); return; }
        group = list;
        selected = '';
        selVertex = -1;
    };
    /** Shift+누르기: 고른 것에 넣거나 뺀다 */
    const toggleInSelection = (key) => {
        if (key === 'BG' || !resolve(key)) return;
        const now = selection();
        setSelection(now.includes(key) ? now.filter(k => k !== key) : [...now, key]);
    };
    /**
     * 평면도에서 고를 수 있는 것들의 키: 보이고 잠기지 않은 레이어의 물체, 구획은 작업 층 것만 (배경 도면 제외)
     * — 끌어서 여러 개 고르기·모두 고르기(Ctrl+A)에 쓴다
     */
    const pickableKeys = () => {
        const isOpen = (id) => layers[id].isVisible && isEditable(id);
        const keys = [];
        if (isOpen('site')) { draft.extras.floorMarks.forEach((_, i) => keys.push(`MARK:${i}`)); draft.extras.arrows.forEach((_, i) => keys.push(`ARROW:${i}`)); }
        if (isOpen('ref')) draft.extras.buildings.forEach((_, i) => keys.push(`REF:${i}`));
        if (isOpen('wh')) whRows().forEach(wh => keys.push(`WH:${wh.id}`));
        if (isOpen('fit')) { draft.extras.annexes.forEach((_, i) => keys.push(`ANNEX:${i}`)); draft.extras.doors.forEach((_, i) => keys.push(`DOOR:${i}`)); }
        if (isOpen(floorLayerId(activeFloor))) zoneRows().filter(z => floorOf(z) === activeFloor).forEach(z => keys.push(`ZONE:${z.id}`));
        if (isOpen('prop')) draft.extras.props.forEach((_, i) => keys.push(`PROP:${i}`));
        return keys.filter(isKeyOnFloor);
    };
    /**
     * 그것을 작업 층에서 다룰 수 있는지: 구획은 그 층의 것, 건물(창고·참고 건물)은 그 층에 걸친 것,
     * 건물에 딸린 것(부속·출입문·모형)은 그 건물이 그 층에 걸칠 때. 건물 밖의 것(바닥 표시·화살표·공장 기준 모형)은 늘
     */
    const isKeyOnFloor = (key) => {
        const item = resolve(key);
        if (!item) return false;
        if (item.kind === 'ZONE') return floorOf(item.o) === activeFloor;
        if (item.kind === 'WH' || item.kind === 'REF') return isOnFloor(item.o);
        return !item.wh || isOnFloor(item.wh);
    };
    /** 그것을 다루려면 가야 할 층 (지금 작업 층에서 다룰 수 있으면 0) */
    const floorToReach = (item) => {
        if (item.kind === 'ZONE') return floorOf(item.o) === activeFloor ? 0 : floorOf(item.o);
        const home = item.kind === 'WH' || item.kind === 'REF' ? item.o : item.wh;
        return !home || isOnFloor(home) ? 0 : buildingFloor(home);
    };
    /** 물체의 테두리 점들 (전체 좌표) — 네모 안에 다 들어왔는지, 묶음의 크기를 잴 때 */
    const worldPoints = (item) => {
        const o = item.o;
        const through = (frame, pts) => pts.map(([x, z]) => frame.toWorld(x, z));
        if (item.isBox) return through(fullFrame(item), hasOutline(o) ? warehouseOutline(o) : [[0, 0], [o.w, 0], [o.w, o.d], [0, o.d]]);
        if (item.kind === 'ARROW') return [{ x: o.from[0], z: o.from[1] }, { x: o.to[0], z: o.to[1] }];
        if (item.isFreeDoor) return through(fullFrame(item), [[-o.len / 2, 0], [o.len / 2, 0]]);
        if (item.kind === 'DOOR') { const wall = wallOf(item.wh, o.wall); return [wall.point(o.from), wall.point(o.to)].map(p => item.parent.toWorld(p.x, p.z)); }
        if (item.kind === 'PROP') { const s = propSize(o); return through(fullFrame(item), [[-s.w / 2, -s.front], [s.w / 2, -s.front], [s.w / 2, s.back], [-s.w / 2, s.back]]); }
        return [];
    };
    /** 화면의 네모(두 점) 안에 다 들어온 것들 */
    const keysInRect = (a, b) => {
        const p = toWorld(Math.min(a.x, b.x), Math.min(a.y, b.y)), q = toWorld(Math.max(a.x, b.x), Math.max(a.y, b.y));
        return pickableKeys().filter(key => {
            const pts = worldPoints(resolve(key));
            return pts.length > 0 && pts.every(pt => pt.x >= p.x && pt.x <= q.x && pt.z >= p.z && pt.z <= q.z);
        });
    };
    const baseTool = canEdit ? 'select' : 'pan'; // 놓기·축척 맞추기를 마치면 돌아가는 도구 (보기 전용은 화면 옮기기)
    const setTool = (next) => { tool = next; calibFirst = null; svg.style.cursor = cursorNow(); renderTools(); renderHud(); scheduleDraw(); };
    /** 작업 층을 바꾼다: 다른 층의 구획·건물(과 그 건물에 딸린 것)은 눌리지 않으므로 고른 것에서 뺀다 */
    const setActiveFloor = (floor) => {
        activeFloor = clamp(Math.round(Number(floor)) || 1, 1, MAX_FLOORS);
        const layerId = floorLayerId(activeFloor);
        if (!layers[layerId].isVisible) { layers[layerId].isVisible = true; saveLayers(); }
        const now = selection(), left = now.filter(isKeyOnFloor);
        if (left.length !== now.length) setSelection(left);
    };
    /** 그 레이어를 보이게 하고 잠금을 푼다 (새로 놓은 것·다각형으로 바꾼 것을 바로 고칠 수 있게) */
    const openLayer = (layerId) => {
        if (layers[layerId].isVisible && !layers[layerId].isLocked) return;
        Object.assign(layers[layerId], { isVisible: true, isLocked: false });
        saveLayers();
    };

    // ---------- 고치기: 건물 원점이 바뀔 때 안의 것들을 제자리에 ----------
    const isWallDoor = (d) => d.wall !== FREE_WALL;
    /**
     * 누른 자리(전체 좌표)가 들어 있는 창고 가운데 작업 층에 걸친 것 — 벽 있는 건물 먼저(마당보다), 겹쳐 쌓인 층이면 위층 먼저. 없으면 null
     */
    const homeAt = (world) => stacked(whRows().filter(wh => {
        if (!isOnFloor(wh)) return false;
        const p = ownFrame(wh).toLocal(world.x, world.z);
        return isInOutline(warehouseOutline(wh), p.x, p.z);
    })).pop() || null;
    /** 그 창고 기준 좌표 (x, z)로 적힌 것들: 구획 · 부속 · 모형 · 찍은 자리의 문 */
    const spotsIn = (whId) => [...zoneRows(), ...draft.extras.annexes, ...draft.extras.props, ...draft.extras.doors.filter(d => !isWallDoor(d))].filter(a => a.warehouse === whId);
    /** 그 창고의 벽에 붙인 문 (벽을 따라 잰 구간 from·to로 적힌다) */
    const wallDoorsIn = (whId) => draft.extras.doors.filter(d => isWallDoor(d) && d.warehouse === whId);
    /** 창고 원점이 창고 기준으로 (dx, dz)만큼 옮겨졌을 때 그 안의 구획·부속·모형·출입문 좌표를 맞춘다 (전체에서 본 자리는 그대로) */
    const shiftChildren = (whId, dx, dz) => {
        if (!dx && !dz) return;
        spotsIn(whId).forEach(a => { a.x = r2(a.x - dx); a.z = r2(a.z - dz); });
        wallDoorsIn(whId).forEach(d => {
            const shift = d.wall === 'N' || d.wall === 'S' ? dx : dz;
            d.from = r2(d.from - shift); d.to = r2(d.to - shift);
        });
    };
    /** 끌기 시작 때 창고 안의 것들 좌표를 적어 둔다 → 끄는 동안 매번 처음 값에서 다시 계산 */
    const childrenOf = (whId) => ({
        spots: spotsIn(whId).map(a => [a, a.x, a.z]),
        doors: wallDoorsIn(whId).map(d => [d, d.from, d.to])
    });
    const restoreChildren = (saved) => {
        saved.spots.forEach(([a, x, z]) => { a.x = x; a.z = z; });
        saved.doors.forEach(([d, from, to]) => { d.from = from; d.to = to; });
    };
    /** 각도를 -180° ~ 180°로 */
    const turnOf = (deg) => ((((deg % 360) + 540) % 360) - 180);
    /** 모형·찍은 자리의 문을 다른 건물 기준(whId가 비면 건물 밖 = 공장 기준)으로 바꾼다 — 평면도에서 보이는 자리·방향은 그대로 */
    const rehome = (o, whId) => {
        const from = whOf(o.warehouse), to = whOf(whId);
        if (whId && !to) return;
        const world = (from ? frameOf(from) : IDENT).toWorld(o.x, o.z);
        const local = (to ? frameOf(to) : IDENT).toLocal(world.x, world.z);
        const rot = (o.rot || 0) + (Number(from?.rot) || 0) - (Number(to?.rot) || 0);
        Object.assign(o, { warehouse: to ? to.id : '', x: r2(local.x), z: r2(local.z), rot: r2(((rot % 360) + 360) % 360) });
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

    // ---------- 출입문을 벽에 붙이기 ----------
    const RECT_WALLS = ['N', 'E', 'S', 'W']; // 사각형 건물 외곽선의 변 번호 → 벽 (warehouseOutline의 점 순서: 북 → 동 → 남 → 서)
    /**
     * 그 점(전체 좌표)에서 reach(m) 안의 가장 가까운 벽 — 창고·참고 건물 외곽선의 변.
     * @returns {{ wh: object|null, o: object, edge: { index: number, dist: number, along: number, length: number, angle: number } }|null}
     *   wh = 창고(참고 건물이면 null), o = 그 건물, edge = 그 건물 기준의 변 (geometry.js nearestEdge)
     */
    const wallNear = (world, reach) => {
        let best = null;
        const look = (o, wh) => {
            const p = ownFrame(o).toLocal(world.x, world.z);
            const edge = nearestEdge(warehouseOutline(o), p.x, p.z);
            if (edge && edge.dist <= reach && (!best || edge.dist < best.edge.dist)) best = { wh, o, edge };
        };
        // 작업 층에 걸친 건물의 벽만 (층으로 쌓인 건물은 벽이 같은 자리에 겹친다)
        whRows().filter(isOnFloor).forEach(wh => look(wh, wh));
        draft.extras.buildings.filter(isOnFloor).forEach(b => look(b, null));
        return best;
    };
    /** 그 변 위에서 길이 len인 문의 가운데 (건물 기준 좌표) — 문이 변을 벗어나지 않게, 변 시작점에서 잰 거리는 격자에 맞춘다 */
    const doorSpotOnEdge = (outline, edge, len) => {
        const [x1, z1] = outline[edge.index], [x2, z2] = outline[(edge.index + 1) % outline.length];
        const half = Math.min(len, edge.length) / 2;
        const along = clamp(snap(edge.along), half, edge.length - half);
        return { x: x1 + ((x2 - x1) * along) / edge.length, z: z1 + ((z2 - z1) * along) / edge.length };
    };
    /**
     * 찍은 자리의 문을 그 점(전체 좌표)에 놓는다: reach 안에 벽이 있으면 그 벽 위에 벽 방향으로 붙이고(창고 벽이면 그 창고 기준, 참고 건물 벽이면 공장 기준),
     * 없으면 그 점 그대로 — 건물 안이면 그 건물 기준(칸막이 문), 밖이면 공장 기준(대문)이고 보이는 방향은 그대로다.
     * @returns {boolean} 벽에 붙었는지
     */
    const putFreeDoor = (door, world, reach) => {
        const near = wallNear(world, reach);
        if (near) {
            const { wh, o, edge } = near;
            const spot = doorSpotOnEdge(warehouseOutline(o), edge, door.len);
            if (wh) { Object.assign(door, { warehouse: wh.id, x: r2(spot.x), z: r2(spot.z), rot: r2(edge.angle) }); return true; }
            const at = ownFrame(o).toWorld(spot.x, spot.z);
            Object.assign(door, { warehouse: '', x: r2(at.x), z: r2(at.z), rot: r2(turnOf(edge.angle + (Number(o.rot) || 0))) });
            return true;
        }
        const wh = homeAt(world);
        const p = (wh ? frameOf(wh) : IDENT).toLocal(world.x, world.z);
        const seenRot = (door.rot || 0) + (Number(whOf(door.warehouse)?.rot) || 0);
        Object.assign(door, { warehouse: wh ? wh.id : '', x: snap(p.x), z: snap(p.z), rot: r2(turnOf(seenRot - (Number(wh?.rot) || 0))) });
        return false;
    };
    /**
     * 사각형 건물의 벽에 딱 붙은 '찍은 자리의 문'은 벽에 붙인 문(벽 + 구간)으로 바꾼다 — 3D에서 그 자리의 벽이 뚫려 보이게.
     * 다각형 건물·참고 건물·따로 선 문은 그대로 둔다.
     */
    const settleDoor = (door) => {
        if (isWallDoor(door)) return;
        const wh = whOf(door.warehouse);
        if (!wh || hasOutline(wh)) return;
        const edge = nearestEdge(warehouseOutline(wh), door.x, door.z);
        if (!edge || edge.dist > 0.05 || Math.abs(turnOf(door.rot - edge.angle)) > 1) return;
        const wallName = RECT_WALLS[edge.index], wall = wallOf(wh, wallName);
        const len = Math.min(door.len, wall.length);
        const from = r2(clamp((wall.isAlongX ? door.x : door.z) - len / 2, 0, wall.length - len));
        ['x', 'z', 'rot', 'len'].forEach(k => { delete door[k]; });
        Object.assign(door, { wall: wallName, from, to: r2(from + len) });
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
    /** 물체를 전체 좌표로 (dx, dz)만큼 옮긴다 (before = 옮기기 전 값). 벽에 붙인 문은 벽을 따라서만 움직인다 */
    const shiftItem = (item, before, dx, dz) => {
        const o = item.o;
        if (item.kind === 'ARROW') {
            o.from = [r2(before.from[0] + dx), r2(before.from[1] + dz)];
            o.to = [r2(before.to[0] + dx), r2(before.to[1] + dz)];
            return;
        }
        const local = item.parent.toLocalDir(dx, dz);
        if (item.kind === 'DOOR' && !item.isFreeDoor) {
            const wall = wallOf(item.wh, o.wall), length = before.to - before.from;
            o.from = r2(clamp(before.from + (wall.isAlongX ? local.x : local.z), 0, Math.max(0, wall.length - length)));
            o.to = r2(o.from + length);
            return;
        }
        o.x = r2(before.x + local.x);
        o.z = r2(before.z + local.z);
    };
    /** 여럿을 함께 옮길 때 실제로 옮길 것들: 창고도 같이 골랐으면 그 안의 것(구획·부속·문·모형)은 창고를 따라가므로 뺀다 */
    const groupMembers = () => {
        const whIds = new Set(group.filter(key => splitKey(key)[0] === 'WH').map(key => splitKey(key)[1]));
        return group.map(resolve).filter(item => item && isEditable(item.layer) && !(item.kind !== 'WH' && item.wh && whIds.has(item.wh.id)));
    };
    /** 모두 한 창고 안의 것이면 그 창고 기준(돌아 앉은 건물의 격자를 따른다), 아니면 공장 기준 */
    const commonFrame = (items) => {
        const wh = items[0]?.wh;
        return wh && items.every(item => item.wh === wh) ? frameOf(wh) : IDENT;
    };
    const beginGroupMove = (world) => {
        const items = groupMembers();
        return { type: 'group-move', startWorld: world, frame: commonFrame(items), members: items.map(item => ({ item, before: clone(item.o) })) };
    };
    const applyGroupMove = (world) => {
        // 끈 거리를 묶음의 기준 방향에서 격자에 맞춘 뒤 모두 같은 만큼 옮긴다 (서로의 자리가 그대로)
        const local = drag.frame.toLocalDir(world.x - drag.startWorld.x, world.z - drag.startWorld.z);
        const d = drag.frame.toWorldDir(snap(local.x), snap(local.z));
        drag.members.forEach(({ item, before }) => shiftItem(item, before, d.x, d.z));
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
                if (item.isFreeDoor) {
                    // 찍은 자리의 문: 끌어 간 곳 가까이에 벽이 있으면 그 벽에 붙는다 (Alt = 붙이지 않고 그 자리에)
                    const from = item.parent.toWorld(before.x, before.z);
                    Object.assign(o, { warehouse: before.warehouse, rot: before.rot }); // 벽에서 떨어지면 처음 방향으로
                    putFreeDoor(o, { x: from.x + delta.x, z: from.z + delta.z }, ev?.altKey ? 0 : DOOR_GLUE);
                    break;
                }
                if (item.kind === 'DOOR') {
                    // 벽에 붙인 문: 벽을 따라 움직이고, 사각형 건물이면 가리키는 곳에서 가장 가까운 벽으로 넘어간다 (모퉁이를 돌아 옆 벽으로)
                    const p = item.parent.toLocal(world.x, world.z), p0 = item.parent.toLocal(drag.startWorld.x, drag.startWorld.z);
                    const wall0 = wallOf(item.wh, before.wall);
                    const grab = (wall0.isAlongX ? p0.x : p0.z) - (before.from + before.to) / 2; // 문 가운데에서 잡은 곳까지
                    if (!hasOutline(item.wh)) o.wall = RECT_WALLS[nearestEdge(warehouseOutline(item.wh), p.x, p.z).index];
                    const wall = wallOf(item.wh, o.wall), length = Math.min(before.to - before.from, wall.length);
                    const center = (wall.isAlongX ? p.x : p.z) - (o.wall === before.wall ? grab : 0);
                    o.from = clamp(snap(center - length / 2), 0, Math.max(0, r2(wall.length - length)));
                    o.to = r2(o.from + length);
                    break;
                }
                const local = item.parent.toLocalDir(delta.x, delta.z);
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
                o.rot = r2(Math.round(turnOf(raw) / step) * step);
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
            case 'fdoor': {
                // 찍은 자리의 문의 한쪽 끝: 문 방향으로만 늘이고 줄인다 (반대쪽 끝은 제자리)
                const own = ownFrame(before);
                const inParent = item.parent.toLocal(world.x, world.z), p = own.toLocal(inParent.x, inParent.z);
                const sign = drag.end === 'b' ? 1 : -1, fixed = (-sign * before.len) / 2;
                const len = Math.max(MIN_DOOR, snap(sign * (p.x - fixed)));
                const mid = own.toWorld(fixed + (sign * len) / 2, 0);
                Object.assign(o, { len: r2(len), x: r2(mid.x), z: r2(mid.z) });
                break;
            }
            case 'prop-rot': {
                // 방향: 0 = 위(북, -z), 90 = 오른쪽(동, +x) — 모형의 앞, 찍은 자리의 문의 바깥쪽
                const p = item.parent.toLocal(world.x, world.z);
                const step = ev?.shiftKey ? 15 : drag.step;
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
            case 'fdoor': return arg === 'rot' ? beginEdit('prop-rot', world, { step: 1 }) : beginEdit('fdoor', world, { end: arg });
            case 'prop': return beginEdit('prop-rot', world, { step: 5 });
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
            marquee = null;
            marqueeHits = [];
            return;
        }
        if (ev.button === 2) return;
        const pt = eventPoint(ev), world = toWorld(pt.x, pt.y);
        const base = { start: pt, hasMoved: false, slop: ev.pointerType === 'mouse' ? 4 : 10 }; // 이만큼(px) 움직여야 끌기 (손가락은 넉넉히)
        const pan = (more = {}) => ({ ...base, type: 'pan', tx: view.tx, ty: view.ty, ...more });
        const pressedKey = ev.target.closest?.('[data-key]')?.dataset.key || '';
        if (ev.button === 1 || isSpaceDown) { drag = pan(); return; }
        // 화면 옮기기 도구: 끌면 화면이 움직이고, 끌지 않고 누르면 그것을 고른다
        if (tool === 'pan') { drag = pan({ pickKey: pressedKey, isOnEmpty: !pressedKey }); return; }
        if (tool !== 'select') { drag = pan({ isPlacing: true }); return; }
        const handleEl = ev.target.closest?.('[data-handle]');
        if (handleEl && resolve(selected)) {
            const edit = dragOfHandle(handleEl.dataset.handle, world);
            drag = edit ? { ...base, ...edit } : null;
            scheduleDraw();
            return;
        }
        // Shift: 끌면 네모 안의 것을 더 고르고, 끌지 않고 누르면 그것을 넣거나 뺀다
        if (ev.shiftKey && canEdit) { drag = { ...base, type: 'marquee', isAdding: true, toggleKey: pressedKey }; return; }
        // 빈 곳: 끌면 네모로 여러 개 고르기, 그냥 누르면 선택 풀기
        if (!pressedKey) { drag = canEdit ? { ...base, type: 'marquee' } : pan({ isOnEmpty: true }); return; }
        // 여럿을 골라 둔 것 가운데 하나를 잡으면 함께 옮긴다 (끌지 않고 누르기만 하면 그것 하나만 고른다)
        if (group.includes(pressedKey)) { drag = { ...base, ...beginGroupMove(world), clickKey: pressedKey }; return; }
        if (pressedKey !== selected) { select(pressedKey); drawSvg(); renderLayers(); renderProps(); renderHud(world); }
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
            if (drag.type === 'group-move' || (drag.item && drag.item.kind !== 'BG' && !drag.isPushed)) pushHistory();
        }
        if (drag.type === 'pan') {
            isViewTouched = true;
            view.tx = drag.tx + pt.x - drag.start.x;
            view.ty = drag.ty + pt.y - drag.start.y;
        } else if (drag.type === 'marquee') {
            marquee = { x0: drag.start.x, y0: drag.start.y, x1: pt.x, y1: pt.y };
            marqueeHits = keysInRect(drag.start, pt);
        } else if (drag.type === 'group-move') applyGroupMove(world);
        else { applyDrag(world, ev); syncPropInputs(); }
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
            else if (done.pickKey) { select(done.pickKey); renderAll(); }
            else if (done.isOnEmpty && selection().length) { select(''); renderAll(); }
            return;
        }
        if (done.type === 'marquee') {
            const hits = marqueeHits;
            marquee = null;
            marqueeHits = [];
            if (done.hasMoved) setSelection(done.isAdding ? [...selection(), ...hits] : hits);
            else if (done.toggleKey) toggleInSelection(done.toggleKey);
            else if (!done.isAdding) select('');
            renderAll();
            return;
        }
        if (done.type === 'group-move') {
            if (!done.hasMoved) select(done.clickKey);
            renderAll();
            return;
        }
        if (!done.hasMoved && !done.isPushed) return;
        if (done.type === 'vertex') rebaseOutline(done.item);
        if (done.type === 'move' && done.item.isFreeDoor) settleDoor(done.item.o);
        if (done.item.kind === 'BG') writeBackgroundSetting(plantId, bg.setting);
        renderAll();
    };
    const onWheel = (ev) => {
        ev.preventDefault();
        const pt = eventPoint(ev);
        zoomAt(pt.x, pt.y, Math.exp(-ev.deltaY * 0.0016));
    };

    // ---------- 새로 놓기 ----------
    /**
     * 그 점에서 가장 가까운 건물과 그 건물 기준 좌표 (가로 × 세로 상자까지의 거리로) — 부속을 붙일 건물.
     * 작업 층에 걸친 벽 있는 건물 가운데서 찾는다 (마당·다른 층은 그런 건물이 하나도 없을 때만)
     */
    const nearestWarehouse = (world) => {
        const onFloor = whRows().filter(wh => isOnFloor(wh) && !isYard(wh));
        return (onFloor.length ? onFloor : whRows()).reduce((best, wh) => {
            const p = ownFrame(wh).toLocal(world.x, world.z);
            const dist = Math.hypot(Math.max(-p.x, 0, p.x - wh.w), Math.max(-p.z, 0, p.z - wh.d));
            return !best || dist < best.dist ? { wh, dist, p } : best;
        }, null);
    };
    /**
     * 새 구획이 들어갈 창고와 놓는 방향. 건물 안을 눌렀으면 그 건물(작업 층에 걸친 것 — homeAt)이고 건물 방향대로 놓는다.
     * 건물 밖이면 1층에서만, 그 공장의 옥외 창고 구획이 된다 — 옥외 창고의 바닥 밖이어도 되고(창고 기준 좌표로 적을 뿐),
     * 그때는 도면 방향대로 놓는다(isAligned false — 돌아 앉은 옥외저장소를 따라 돌지 않게).
     * 놓을 수 없으면 알리고 null.
     * @param {{ x: number, z: number }} world 누른 자리 (전체 좌표)
     * @param {boolean} [isOutdoorOnly] 옥외 구역 도구 — 건물 안에는 놓지 않는다
     * @returns {{ wh: object, isAligned: boolean }|null}
     */
    const zoneHomeAt = (world, isOutdoorOnly = false) => {
        const home = homeAt(world);
        if (home && !(isOutdoorOnly && !isYard(home))) return { wh: home, isAligned: true };
        const yard = whOf(outdoorCode);
        if (isOutdoorOnly) {
            if (!home && activeFloor === 1 && yard) return { wh: yard, isAligned: false };
            showToast(home ? '옥외 구역은 건물 밖(마당)을 눌러 주세요. 건물 안에는 [+ 구역]으로 놓습니다.'
                : activeFloor > 1 ? '옥외 구역은 1층에서 놓습니다 — 위쪽 도구줄의 층을 1층으로 바꾸세요.' : '이 공장에는 옥외 창고가 없습니다.');
            return null;
        }
        if (activeFloor === 1 && yard) return { wh: yard, isAligned: false };
        // 건물 밖, 또는 건물 안이지만 그 층에 걸친 창고가 없는 자리 (마당은 건물로 치지 않는다)
        const isInsideOtherFloor = whRows().some(wh => { const p = ownFrame(wh).toLocal(world.x, world.z); return !isYard(wh) && isInOutline(warehouseOutline(wh), p.x, p.z); });
        showToast(isInsideOtherFloor
            ? `${activeFloor}층 높이(바닥 ${fmt(floorY(activeFloor))}m)에 걸친 창고가 이 자리에 없습니다 — 그 층에 창고가 없거나 건물의 벽 높이가 그 층까지 닿지 않습니다.`
            : activeFloor > 1 ? '위층에서는 건물(창고) 안에만 구획을 놓을 수 있습니다.'
                : `건물(창고) 안을 눌러 주세요 — ${plantLabel(plant)}에는 옥외 창고코드가 없어 건물 밖에는 구획을 놓을 수 없습니다.`);
        return null;
    };
    /**
     * 구획 줄의 자리: 놓는 기준 좌표(isAligned면 그 창고 기준, 아니면 전체 좌표)의 왼쪽 위 (left, top) → 창고 기준 x·z·rot.
     * 도면 방향대로 놓는 구획은 창고가 돌아 앉은 만큼 거꾸로 돌려 적는다 (평면도에서 반듯하게 보이게)
     */
    const zoneSpot = (home, left, top) => {
        if (home.isAligned) return { x: r2(left), z: r2(top), rot: 0 };
        const p = frameOf(home.wh).toLocal(left, top);
        return { x: r2(p.x), z: r2(p.z), rot: r2(turnOf(-(Number(home.wh.rot) || 0))) };
    };
    /** 누른 자리를 놓는 기준 좌표로 */
    const zonePoint = (home, world) => (home.isAligned ? ownFrame(home.wh).toLocal(world.x, world.z) : world);
    /** 새 구획의 바닥 높이: 작업 층 바닥을 그 창고 바닥에서 잰 높이 (위층 창고에 놓으면 0) */
    const newZoneY = (wh) => Math.max(0, r2(floorY(activeFloor) - baseHeight(wh)));
    /**
     * 새 구획 이름: 창고 바닥보다 위(2층 구역·중이층)에 놓으면 앞에 층을 적는다 ('2층 5번 랙').
     * 위층 창고(층마다 창고코드가 다른 건물)의 바닥에 놓은 구획은 창고 이름에 층이 있으므로 적지 않는다
     */
    const zoneName = (no, word, wh) => `${newZoneY(wh) > 0 ? `${activeFloor}층 ` : ''}${no}${word}`;
    /** 구획 이름에 적을 층: 창고 바닥보다 위에 놓인 구획만 그 층 (창고 바닥에 놓인 구획은 1 = 층을 적지 않는다) */
    const nameFloorOf = (z) => (zoneBaseY(z) > 0.01 ? floorOf(z) : 1);
    /**
     * 다른 층으로 옮긴 구획의 이름: 앞에 적힌 층('2층 5번 랙')을 새 층으로 바꾸고 1층이면 뺀다. 이름이 층뿐이면('2층') 새 층으로.
     * 저절로 붙인 이름('5번 랙' · '5라인' · '5구역' · '5칸')은 위층으로 가면 층을 붙이고, 직접 지은 이름('A구역')은 그대로 둔다
     */
    const refloorName = (name, floor) => {
        const text = String(name || '');
        if (/^\d+층$/.test(text)) return `${floor}층`;
        const prefix = text.match(/^\d+층\s+(?=\S)/);
        if (!prefix && !/^\d+(번 랙|라인|구역|칸)$/.test(text)) return text;
        const rest = prefix ? text.slice(prefix[0].length) : text;
        return floor > 1 ? `${floor}층 ${rest}` : rest;
    };
    /** 복제한 구획의 이름: 이름 앞의 번호('5번 랙' · '2층 5번 랙')를 새 번호로, 번호로 시작하지 않으면('2층') 뒤에 새 번호를 붙인다 */
    const renumbered = (name, no) => {
        const text = String(name || '');
        const m = text.match(/^((?:\d+층\s*)?)\d+(?!\d*층)/);
        return m ? `${m[1]}${no}${text.slice(m[0].length)}` : text ? `${text} ${no}` : `${no}구획`;
    };
    /** 크기를 정하는 모형(계단·저장 탱크)의 처음 값 — 계단은 작업 층 바닥에서 한 층을 오른다 */
    const propParams = (type, wh = null) => (type === 'STAIRS'
        ? { ...PROP_MODELS.STAIRS.params, h: floorHeight(), y: Math.max(0, r2(floorY(activeFloor) - baseHeight(wh))) } // 시작 높이는 그 건물 바닥에서 잰다
        : { ...(PROP_MODELS[type].params || {}) });
    /**
     * 파렛트 칸 구획을 가로 × 세로로 놓는다: 칸 하나가 구획 하나(1칸 × 단 수), 누른 곳이 묶음 한가운데, 작업 층에.
     * 번호는 왼쪽 위부터 오른쪽으로, 줄을 바꿔 아래로. 건물 방향에 맞춰 놓인다(건물 기준 좌표).
     * @returns {string} 첫 칸의 키 (건물 밖을 눌렀으면 '')
     */
    const createCells = (world) => {
        const home = zoneHomeAt(world);
        if (!home) return '';
        const { wh } = home;
        const { cols, rows, tiers } = cellGrid;
        const p = zonePoint(home, world);
        const x0 = snap(p.x - (cols * PALLET_CELL.w) / 2), z0 = snap(p.z - (rows * PALLET_CELL.d) / 2);
        const ids = [];
        for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const id = nextZoneId(draft.rows, wh.id), no = Number(id.split('-').pop());
                ids.push(id);
                draft.rows.push({
                    id, kind: 'ZONE', warehouse: wh.id, site: wh.site, name: zoneName(no, '칸', wh), zoneType: 'FLOOR',
                    ...zoneSpot(home, x0 + col * PALLET_CELL.w, z0 + row * PALLET_CELL.d), w: PALLET_CELL.w, d: PALLET_CELL.d, h: r2(PALLET_CELL.tierHeight * tiers),
                    y: newZoneY(wh), slots: 1, lanes: 1, tiers, fillFrom: 'START', sort: no, note: CELL_NOTE, outline: []
                });
            }
        }
        if (ids.length > 1) showToast(`파렛트 칸 ${ids.length}개를 놓았습니다 (${ids[0]} ~ ${ids[ids.length - 1]}). 저장하면 칸마다 재고 위치가 됩니다.`);
        return `ZONE:${ids[0]}`;
    };
    /**
     * 칸이 여러 개인 구획(칸 × 줄)을 파렛트 자리마다 구획 하나로 나눈다: 첫 칸이 원래 구획코드를 잇고 나머지는 새 구획
     * (단 수·높이·종류·층은 그대로). 번호는 첫 줄의 칸부터 차례로, 다음 줄로.
     * @returns {number} 나눈 칸 수 (나눌 칸이 없으면 0)
     */
    const splitIntoCells = (zone) => {
        const { cols, lanes } = zoneDims(zone);
        if (cols * lanes < 2) return 0;
        // 칸은 긴 변을 따라(pitch), 줄은 짧은 변 쪽으로(laneWide)
        const isAlongX = zone.w >= zone.d;
        const pitch = (isAlongX ? zone.w : zone.d) / cols, laneWide = (isAlongX ? zone.d : zone.w) / lanes;
        const frame = ownFrame(zone), base = clone(zone);
        const cellAt = (col, lane) => {
            const origin = frame.toWorld(isAlongX ? pitch * col : laneWide * lane, isAlongX ? laneWide * lane : pitch * col); // 구획 기준 → 창고 기준
            return { x: r2(origin.x), z: r2(origin.z), w: r2(isAlongX ? pitch : laneWide), d: r2(isAlongX ? laneWide : pitch), slots: 1, lanes: 1, fillFrom: 'START', note: CELL_NOTE };
        };
        for (let lane = 0; lane < lanes; lane += 1) {
            for (let col = 0; col < cols; col += 1) {
                if (!lane && !col) continue;
                const id = nextZoneId(draft.rows, zone.warehouse), no = Number(id.split('-').pop());
                draft.rows.push({ ...base, ...cellAt(col, lane), id, sort: no, name: `${no}칸` });
            }
        }
        Object.assign(zone, cellAt(0, 0), { name: `${Number(zone.id.split('-').pop())}칸` });
        return cols * lanes;
    };
    /**
     * 누른 자리에 출입문: 가까운 벽(DOOR_SNAP 안)이 사각형 창고의 벽이면 벽에 붙인 문(3D에서 그 자리의 벽이 뚫린다),
     * 다각형 창고·참고 건물의 벽이면 그 벽 위에 벽 방향으로 놓은 '찍은 자리의 문', 벽에서 멀면 누른 자리에 따로 선 문(대문·칸막이 문).
     * @returns {string} 새 문의 키
     */
    const createDoor = (world) => {
        const { doors } = draft.extras;
        const near = wallNear(world, DOOR_SNAP);
        const nameOf = (o) => `${o.name || o.id || ''} 출입문`.trim();
        if (near?.wh && !hasOutline(near.wh)) {
            const { wh, edge } = near;
            const wallName = RECT_WALLS[edge.index], wall = wallOf(wh, wallName), length = Math.min(NEW_DOOR_LEN, wall.length);
            const p = ownFrame(wh).toLocal(world.x, world.z);
            const from = clamp(snap((wall.isAlongX ? p.x : p.z) - length / 2), 0, r2(wall.length - length));
            doors.push({ warehouse: wh.id, wall: wallName, from, to: r2(from + length), name: nameOf(wh), style: 'OPENING' });
            return `DOOR:${doors.length - 1}`;
        }
        const door = { warehouse: '', wall: FREE_WALL, x: 0, z: 0, rot: 0, len: near ? Math.min(NEW_DOOR_LEN, r2(near.edge.length)) : NEW_DOOR_LEN, name: '', style: 'OPENING' };
        putFreeDoor(door, world, DOOR_SNAP);
        const home = near ? near.o : whOf(door.warehouse);
        door.name = home ? nameOf(home) : '출입문';
        doors.push(door);
        return `DOOR:${doors.length - 1}`;
    };
    /** 새 물체를 만들어 넣고 그 키를 돌려준다 (놓을 수 없으면 '') */
    const createAt = (preset, world) => {
        const { extras } = draft;
        if (preset === 'CELL') return createCells(world);
        if (preset === 'DOOR') return createDoor(world);
        if (preset === 'PROP') {
            // 건물 안을 누르면 그 건물 기준(건물과 같이 움직인다 — 층으로 쌓인 건물은 작업 층의 창고), 밖이면 공장 기준
            const wh = homeAt(world);
            const p = wh ? ownFrame(wh).toLocal(world.x, world.z) : world;
            extras.props.push({ type: propKind, warehouse: wh ? wh.id : '', x: snap(p.x), z: snap(p.z), rot: 0, name: PROP_MODELS[propKind].name, ...propParams(propKind, wh) });
            return `PROP:${extras.props.length - 1}`;
        }
        if (NEW_ZONE_WORDS[preset]) {
            // 건물 안이면 그 창고의 구획, 건물 밖이면 옥외 창고의 구획 (옥외 구역 도구는 건물 밖에만)
            const home = zoneHomeAt(world, preset === 'YARD');
            if (!home) return '';
            const { wh } = home;
            // 랙의 단 수: 그 층의 천장(창고 벽 꼭대기)까지 들어가는 만큼 — 한 층 높이(3.5m)로 쌓은 창고에서는 3단(4.5m)이 위층 바닥을 뚫고 나간다. 마당은 그대로 3단
            const rackTiers = isYard(wh) ? RACK_LINE.tiers : clamp(Math.floor((Number(wh.h) - newZoneY(wh) - 0.2) / RACK_LINE.tierHeight), 1, RACK_LINE.tiers);
            const shape = preset === 'RACK' ? { zoneType: 'RACK', w: r2(RACK_LINE.pitch * 6), d: RACK_LINE.wide, h: RACK_LINE.tierHeight * rackTiers, slots: 6, tiers: rackTiers }
                : preset === 'LINE' ? { zoneType: 'FLOOR', w: PALLET_LINE.long, d: PALLET_LINE.wide, h: PALLET_LINE.h, slots: PALLET_LINE.pallets, tiers: PALLET_LINE.tiers }
                    : preset === 'YARD' ? { zoneType: 'FLOOR', w: 6, d: 4, h: 2.5, slots: 0, tiers: 1 }
                        : { zoneType: 'FLOOR', w: 4, d: 3, h: 3, slots: 0, tiers: 1 };
            const id = nextZoneId(draft.rows, wh.id), no = Number(id.split('-').pop());
            const p = zonePoint(home, world);
            // 작업 층에 놓는다 (바닥 높이 = 그 층 바닥을 창고 바닥에서 잰 높이)
            draft.rows.push({
                id, kind: 'ZONE', warehouse: wh.id, site: wh.site, name: zoneName(no, NEW_ZONE_WORDS[preset], wh), ...shape, lanes: 1,
                ...zoneSpot(home, snap(p.x - shape.w / 2), snap(p.z - shape.d / 2)), y: newZoneY(wh), fillFrom: 'START', sort: no, note: '', outline: []
            });
            if (isYard(wh)) showToast(`${id}: 옥외 창고 ${wh.id}의 구획으로 놓았습니다. 오른쪽 속성에서 이름(공토트 보관구역·임시보관구역 등)과 크기를 정하고 [저장]하면 재고 위치가 됩니다.`);
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
        if (preset === 'ANNEX') {
            const near = nearestWarehouse(world);
            if (!near) return '';
            extras.annexes.push({ warehouse: near.wh.id, x: snap(near.p.x - 1), z: snap(near.p.z - 0.5), w: 2, d: 1 });
            return `ANNEX:${extras.annexes.length - 1}`;
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
        tool = baseTool;
        select(key);
        openLayer(resolve(key).layer);
        renderAll();
    };

    // ---------- 지우기 · 복제 · 한 칸씩 옮기기 ----------
    const DUPLICABLE = ['ZONE', 'MARK', 'ANNEX', 'DOOR', 'PROP'];
    /** 고른 여럿을 지운다: 창고와 재고가 남은 구획은 남기고 알려 준다 */
    const removeGroup = () => {
        const zones = new Set(), indexes = {};
        let kept = 0;
        group.forEach(key => {
            const item = resolve(key);
            if (!item || !isEditable(item.layer)) return;
            if (item.kind === 'WH' || (item.kind === 'ZONE' && zoneStock(item.o).length)) { kept += 1; return; }
            if (item.kind === 'ZONE') { zones.add(item.o); return; }
            const list = EXTRA_LISTS[item.kind];
            indexes[list] = [...(indexes[list] || []), Number(splitKey(key)[1])];
        });
        const note = kept ? ` 창고·재고가 남은 구획 ${kept}개는 지우지 않았습니다.` : '';
        if (!zones.size && !Object.keys(indexes).length) { showToast(`지울 수 있는 것이 없습니다.${note}`); return; }
        pushHistory();
        draft.rows = draft.rows.filter(r => !zones.has(r));
        // 뒤 번호부터 지운다 (앞의 것을 먼저 지우면 뒤의 번호가 당겨진다)
        Object.entries(indexes).forEach(([list, at]) => at.sort((a, b) => b - a).forEach(i => draft.extras[list].splice(i, 1)));
        select('');
        if (note) showToast(`고른 것을 지웠습니다.${note}`);
        renderAll();
    };
    const removeSelected = () => {
        if (!canEdit) return;
        if (group.length) { removeGroup(); return; }
        const item = resolve(selected);
        if (!item) return;
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
    /** 고른 여럿을 같은 배치 그대로 오른쪽 옆에 하나 더 놓는다 (창고·참고 건물·화살표는 복제하지 않는다) */
    const duplicateGroup = () => {
        const items = group.map(resolve).filter(item => item && DUPLICABLE.includes(item.kind) && isEditable(item.layer));
        if (!items.length) { showToast('고른 것 가운데 복제할 수 있는 것(구획·바닥 표시·부속·출입문·모형)이 없습니다.'); return; }
        pushHistory();
        // 묶음의 폭(묶음 기준 방향으로 잰)만큼 오른쪽으로 — 파렛트 칸끼리는 틈 없이, 그 밖에는 0.2m 띄워
        const frame = commonFrame(items);
        const xs = items.flatMap(item => worldPoints(item).map(p => frame.toLocal(p.x, p.z).x));
        const isCells = items.every(item => item.kind === 'ZONE' && zoneDims(item.o).slots === 1);
        const d = frame.toWorldDir(r2(Math.max(...xs) - Math.min(...xs)) + (isCells ? 0 : 0.2), 0);
        const keys = items.map(item => {
            const copy = clone(item.o);
            shiftItem({ ...item, o: copy }, item.o, d.x, d.z);
            if (item.kind === 'ZONE') {
                const id = nextZoneId(draft.rows, copy.warehouse), no = Number(id.split('-').pop());
                Object.assign(copy, { id, sort: no, name: renumbered(copy.name, no) });
                draft.rows.push(copy);
                return `ZONE:${id}`;
            }
            const list = draft.extras[EXTRA_LISTS[item.kind]];
            list.push(copy);
            return `${item.kind}:${list.length - 1}`;
        });
        setSelection(keys);
        renderAll();
    };
    const duplicateSelected = () => {
        if (!canEdit) return;
        if (group.length) { duplicateGroup(); return; }
        const item = resolve(selected);
        if (!item || !DUPLICABLE.includes(item.kind)) return;
        pushHistory();
        const copy = clone(item.o);
        if (item.kind === 'ZONE') {
            // 짧은 변 쪽으로 한 줄 옆에 (구획이 돌아 있으면 그 방향대로). 파렛트 한 칸은 오른쪽에 틈 없이 붙여 놓는다
            const id = nextZoneId(draft.rows, copy.warehouse), no = Number(id.split('-').pop());
            const isAlongX = copy.w > copy.d, gap = zoneDims(copy).slots === 1 ? 0 : 0.2;
            const step = ownFrame(copy).toWorldDir(isAlongX ? 0 : copy.w + gap, isAlongX ? copy.d + gap : 0);
            Object.assign(copy, { id, sort: no, x: r2(copy.x + step.x), z: r2(copy.z + step.z), name: renumbered(copy.name, no) });
            draft.rows.push(copy);
            select(`ZONE:${id}`);
        } else {
            if (item.isFreeDoor) {
                // 찍은 자리의 문은 문 방향으로 한 짝 옆에
                const side = ownFrame(copy).toWorldDir(copy.len + 0.5, 0);
                copy.x = r2(copy.x + side.x); copy.z = r2(copy.z + side.z);
            } else if (item.kind === 'DOOR') { const length = copy.to - copy.from; copy.from = r2(copy.to + 0.5); copy.to = r2(copy.from + length); fitDoor(copy); } else if (item.kind === 'PROP') {
                // 모형은 제 오른쪽 옆에 나란히 (드럼 파렛트·IBC는 바짝, 차량·계단·탱크는 0.8m 띄워)
                const width = propSize(copy).w, side = ownFrame(copy).toWorldDir(width + (width > 1.5 ? 0.8 : 0.05), 0);
                copy.x = r2(copy.x + side.x); copy.z = r2(copy.z + side.z);
            } else { copy.x = r2(copy.x + 1); copy.z = r2(copy.z + 1); }
            const list = draft.extras[EXTRA_LISTS[item.kind]];
            list.push(copy);
            select(`${item.kind}:${list.length - 1}`);
        }
        renderAll();
    };
    /** 방향키: 고른 것(하나·여럿)을 한 칸씩. 돌아 앉은 건물 안의 것은 누른 방향에 가장 가까운 그 건물의 축을 따라 움직인다 (건물의 격자를 벗어나지 않게) */
    const nudge = (dx, dz) => {
        const one = resolve(selected);
        const items = group.length ? groupMembers() : one && one.kind !== 'BG' && isEditable(one.layer) ? [one] : [];
        if (!items.length) return;
        pushHistory();
        const frame = commonFrame(items), local = frame.toLocalDir(dx, dz), step = Math.hypot(dx, dz);
        const d = Math.abs(local.x) >= Math.abs(local.z) ? frame.toWorldDir(Math.sign(local.x) * step, 0) : frame.toWorldDir(0, Math.sign(local.z) * step);
        items.forEach(item => shiftItem(item, clone(item.o), d.x, d.z));
        drawSvg(); syncPropInputs(); renderState(); renderHud();
    };
    /** 고른 구획들을 그 층으로 옮긴다 (작업 층도 그 층으로 — 옮긴 뒤에도 이어서 고르고 끌 수 있게) */
    const moveGroupToFloor = (floor) => {
        const zones = group.map(resolve).filter(item => item && item.kind === 'ZONE');
        if (!zones.length) return;
        pushHistory();
        // 바닥 높이는 그 창고 바닥에서 잰다 — 위층 창고의 구획은 그 창고 바닥보다 아래로 내려가지 않는다(창고코드가 다르다)
        zones.forEach(item => {
            item.o.y = Math.max(0, r2(floorY(floor) - baseHeight(item.wh)));
            item.o.name = refloorName(item.o.name, nameFloorOf(item.o));
        });
        if (zones.some(item => floorOf(item.o) !== floor)) showToast('위층 창고의 구획은 그 창고 바닥보다 아래층으로 옮길 수 없어 그 창고의 층에 두었습니다.');
        activeFloor = zones.some(item => floorOf(item.o) === floor) ? floor : floorOf(zones[0].o);
        openLayer(floorLayerId(activeFloor));
    };
    /**
     * 층 높이를 바꾼다: 층 바닥에 딱 맞춰 놓은 구획·계단은 새 층 높이를 따라가고(2층 구획은 새 2층 바닥으로),
     * 층 사이 높이로 따로 적은 것은 그대로 둔다. 한 층을 오르던 계단은 오르는 높이도 새 층 높이로.
     * 층으로 쌓은 건물(위층 창고·참고 층이 있는 공장)은 층 바닥에 놓인 건물이 새 높이로 옮겨 가고, 한 층 높이로 지은 벽도 새 층 높이가 된다.
     */
    const setFloorHeight = (raw) => {
        const old = floorHeight(), next = clamp(r2(Number(raw)), 2, 10);
        if (!Number.isFinite(next) || next === old) return;
        pushHistory();
        const levelOf = (y) => { const n = Math.round(y / old); return n >= 1 && Math.abs(y - n * old) < 0.011 ? n : 0; };
        const buildings = [...whRows(), ...draft.extras.buildings];
        if (buildings.some(b => baseHeight(b) > 0)) {
            buildings.forEach(b => {
                const n = levelOf(baseHeight(b));
                if (n) b.y = r2(n * next);
                if (Math.abs(Number(b.h) - old) < 0.011) b.h = next;
            });
        }
        zoneRows().forEach(z => { const n = levelOf(zoneBaseY(z)); if (n) z.y = r2(n * next); });
        draft.extras.props.filter(p => p.type === 'STAIRS').forEach(p => {
            const n = levelOf(Number(p.y) || 0);
            if (n) p.y = r2(n * next);
            if (Math.abs(p.h - old) < 0.011) p.h = next;
        });
        draft.extras.floorHeight = next;
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
            case 'warehouse': if (item.kind === 'PROP' || item.isFreeDoor) rehome(o, raw); else if (whOf(raw)) o.warehouse = raw; break;
            case 'type':
                if (item.kind !== 'PROP' || !isPropType(raw)) break;
                // 이름을 따로 짓지 않았으면 새 종류 이름으로, 크기 값(계단·저장 탱크)은 새 종류의 처음 값으로
                if (!o.name || o.name === PROP_MODELS[o.type].name) o.name = PROP_MODELS[raw].name;
                Object.keys(PROP_MODELS[o.type].params || {}).forEach(k => { delete o[k]; });
                Object.assign(o, { type: raw }, propParams(raw, item.wh));
                break;
            case 'x': case 'z': if (isNumber) o[prop] = r2(n); break;
            case 'rot': if (isNumber) o.rot = r2(n); break;
            case 'y': if (isNumber) o.y = Math.max(0, r2(n)); break;
            case 'floor': {
                if (!isNumber) break;
                const floor = clamp(Math.round(n), 1, MAX_FLOORS);
                // 건물(창고·참고 건물): 그 층 바닥 높이에 놓는다 — 안의 구획은 창고 바닥에서 잰 높이라 그대로 따라 올라간다
                if (item.kind !== 'ZONE') { o.y = floorY(floor); break; }
                // 구획: 바닥 높이가 그 층 바닥으로(창고 바닥에서 잰 값), 이름에 적힌 층도 따라간다
                o.y = Math.max(0, r2(floorY(floor) - baseHeight(item.wh)));
                o.name = refloorName(o.name, nameFloorOf(o));
                break;
            }
            case 'h': case 'wide': case 'dia': if (isNumber && n > 0) o[prop] = r2(n); break;
            case 'len': if (isNumber && n >= MIN_DOOR) o.len = r2(n); break;
            case 'slots': if (isNumber) o.slots = clamp(Math.round(n), 0, MAX_GRID); break;
            case 'lanes': if (isNumber) o.lanes = clamp(Math.round(n), 1, MAX_GRID); break;
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
        const info = $('#pe-info');
        if (info) info.innerHTML = infoHtml(item);
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
        tool = baseTool;
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
    // 표시에는 그 화면의 칸 번호(idx — main.js의 방문 기록 표시)를 그대로 싣는다
    const pushHistoryMark = () => { try { window.history.pushState({ ...(window.history.state || {}), modal: HISTORY_MARK, tab: markTab }, '', `#${markTab}`); } catch (e) { console.warn('방문 기록 표시 실패', e); } };
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
        destroy();
        // 방문 기록의 표시 칸은 그대로 둔다 — 곧 main.js switchTab이 그 칸을 새 화면의 칸으로 바꾼다
        return true;
    };

    // ---------- 이벤트 ----------
    const onKeyDown = (ev) => {
        if (!root.isConnected) { destroy(); return; }
        ev.stopImmediatePropagation(); // 이 창이 열려 있는 동안 앱 단축키(Backspace 뒤로가기·통합 검색 등)가 먹지 않게
        if (ev.altKey && ev.key === 'ArrowLeft') { ev.preventDefault(); close(); return; }
        if (isTyping(ev.target)) { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') ev.target.blur(); return; }
        if (ev.key === ' ') { isSpaceDown = true; ev.preventDefault(); svg.style.cursor = cursorNow(); return; }
        if (ev.key === 'Escape') {
            // 끌어서 고르는 중이면 그만두고, 놓기 도구면 고르기로, 아니면 고른 것을 푼다
            if (drag?.type === 'marquee') { drag = null; marquee = null; marqueeHits = []; scheduleDraw(); } else if (tool !== baseTool) setTool(baseTool); else if (selection().length) { select(''); renderAll(); }
            return;
        }
        if (!canEdit) return;
        const isCtrl = ev.ctrlKey || ev.metaKey;
        const key = ev.key.toLowerCase();
        if (isCtrl && key === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
        if (isCtrl && key === 'y') { ev.preventDefault(); redo(); return; }
        if (isCtrl && key === 'd') { ev.preventDefault(); duplicateSelected(); return; }
        if (isCtrl && key === 's') { ev.preventDefault(); save(); return; }
        if (isCtrl && key === 'a') { ev.preventDefault(); setSelection(pickableKeys()); renderAll(); return; } // 고를 수 있는 것 모두 (잠기지 않은 레이어 · 작업 층)
        if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); removeSelected(); return; }
        const step = (snapStep || 0.1) * (ev.shiftKey ? 10 : 1);
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[ev.key]) { ev.preventDefault(); nudge(moves[ev.key][0], moves[ev.key][1]); }
    };
    const onKeyUp = (ev) => { if (ev.key === ' ') { isSpaceDown = false; svg.style.cursor = cursorNow(); } };
    // 마우스 뒤로가기 단추 = 이 창 닫기 (앱의 이전 화면으로 가지 않게)
    const onMouseUp = (ev) => { if (ev.button === 3) { ev.preventDefault(); ev.stopImmediatePropagation(); close(); } };
    // 브라우저 뒤로가기로 표시 칸에서 내려왔으면 닫는다. 닫기를 취소하면 표시 칸으로 되돌아간다
    // (표시를 새로 쌓지 않는다 — 사용자 동작 없이 쌓은 칸은 브라우저 뒤로 단추가 건너뛰어 다음 뒤로가기가 화면까지 넘긴다)
    const onPopState = () => {
        if (isDestroyed || hasHistoryMark()) return;
        if (!confirmDiscard('저장하지 않은 변경이 있습니다. 저장하지 않고 닫을까요?')) { window.history.forward(); return; }
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
        if (t.dataset.open) {
            // 레이어 이름: 물체 목록을 펴고 접는다. 층 레이어면 그 층이 작업 층이 된다
            const floor = FLOOR_LAYERS.find(l => l.id === t.dataset.open)?.floor;
            if (floor && floor !== activeFloor) { setActiveFloor(floor); openList = t.dataset.open; renderAll(); return; }
            openList = openList === t.dataset.open ? '' : t.dataset.open;
            renderLayers();
            return;
        }
        if (t.dataset.pick) {
            // 다른 층의 구획·건물(과 그 건물에 딸린 것)을 목록에서 고르면 작업 층도 그 층으로 (평면도에서 바로 끌 수 있게)
            const picked = resolve(t.dataset.pick);
            const reach = picked ? floorToReach(picked) : 0;
            if (reach) setActiveFloor(reach);
            select(t.dataset.pick);
            const item = resolve(selected);
            if (item && !layers[item.layer].isVisible) { layers[item.layer].isVisible = true; saveLayers(); }
            renderAll();
            return;
        }
        const item = resolve(selected);
        // 옥외 구역 이름 단추: 고른 구획의 이름을 그 이름으로
        if (t.dataset.act?.startsWith('name:')) {
            if (item?.kind === 'ZONE' && canEdit) { pushHistory(); item.o.name = t.dataset.act.slice(5); renderAll(); }
            return;
        }
        switch (t.dataset.act || t.id) {
            case 'pe-undo': undo(); break;
            case 'pe-redo': redo(); break;
            case 'pe-save': await save(); break;
            case 'pe-close': close(); break;
            case 'pe-bg-load': $('#pe-file').click(); break;
            case 'delete': removeSelected(); break;
            case 'duplicate': duplicateSelected(); break;
            case 'group-delete': removeSelected(); break;
            case 'group-duplicate': duplicateSelected(); break;
            case 'group-clear': select(''); renderAll(); break;
            case 'rect':
                if (item && confirm('다각형 외곽선을 지우고 가로 × 세로 사각형으로 바꿀까요?')) { pushHistory(); item.o.outline = []; selVertex = -1; renderAll(); }
                break;
            case 'polygon':
                if (item) { pushHistory(); item.o.outline = [[0, 0], [item.o.w, 0], [item.o.w, item.o.d], [0, item.o.d]]; openLayer(item.layer); renderAll(); }
                break;
            case 'fit-slots': {
                // 긴 변은 칸 간격(1.15m)으로, 짧은 변은 줄 폭(1.3m)으로 나눈 수
                if (item?.kind !== 'ZONE') break;
                pushHistory();
                const long = Math.max(item.o.w, item.o.d), short = Math.min(item.o.w, item.o.d);
                item.o.slots = clamp(Math.floor(long / RACK_LINE.pitch + 1e-6), 1, MAX_GRID);
                item.o.lanes = clamp(Math.floor(short / RACK_LINE.wide + 1e-6), 1, MAX_GRID);
                renderAll();
                break;
            }
            case 'split-cells': {
                if (item?.kind !== 'ZONE') break;
                const zone = item.o, { cols, lanes } = zoneDims(zone), count = cols * lanes;
                // 재고가 있으면 나누지 않는다: 재고는 구획코드에 붙어 있어, 나누면 모두 첫 칸에 몰린다
                if (zoneStock(zone).length) { showToast(`${zone.id}에 재고가 있어 나눌 수 없습니다. 재고를 다른 곳으로 옮긴 뒤 나누세요.`, 'error'); break; }
                if (!confirm(`${zone.id}의 ${cols}칸${lanes > 1 ? ` × ${lanes}줄 = ${count}칸` : ''}을 칸마다 따로 구획(재고 위치)으로 나눌까요?\n첫 칸이 ${zone.id}를 잇고, 나머지 ${count - 1}칸은 새 구획코드를 받습니다.`)) break;
                pushHistory();
                splitIntoCells(zone);
                renderAll();
                break;
            }
            case 'extras-default':
                if (confirm('주변 표시·참고 건물·부속·출입문·모형·층 높이를 처음 값으로 되돌릴까요?\n[저장]을 눌러야 반영되고, 되돌리기(Ctrl+Z)로 취소할 수 있습니다.')) { pushHistory(); draft.extras = clone(defaultPlantExtras(plantId)); select(''); renderAll(); }
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
                if (tool === 'calib') tool = baseTool;
                renderAll();
                break;
            default: break;
        }
    });
    let floorAtFocus = 0; // 바닥 높이 칸에 들어갈 때의 층 — 칸에서 나올 때 층이 바뀌었으면 이름에 적힌 층을 맞춘다
    root.addEventListener('focusin', (ev) => {
        if (!ev.target.dataset?.prop) return;
        isHistoryArmed = true;
        const item = resolve(selected);
        floorAtFocus = item?.kind === 'ZONE' ? floorOf(item.o) : 0;
    });
    root.addEventListener('input', (ev) => {
        const el = ev.target;
        if (el.dataset?.prop && el.tagName !== 'SELECT') applyProp(el.dataset.prop, el.value);
        else if (el.dataset?.bg) applyBackground(el.dataset.bg, el.value);
        else if (el.dataset?.cell) { cellGrid[el.dataset.cell] = clamp(Math.round(Number(el.value)) || 1, 1, MAX_CELL_GRID); renderHud(); }
    });
    root.addEventListener('change', (ev) => {
        const el = ev.target;
        if (el.id === 'pe-snap') { snapStep = Number(el.value) || 0; try { localStorage.setItem(SNAP_KEY, String(snapStep)); } catch (e) { console.warn('맞춤 간격 저장 실패', e); } return; }
        if (el.id === 'pe-prop-kind') { if (isPropType(el.value)) { propKind = el.value; setTool('add:PROP'); } return; }
        if (el.id === 'pe-floor') { setActiveFloor(el.value); renderAll(); return; }
        if (el.id === 'pe-floor-h') { setFloorHeight(el.value); renderAll(); return; }
        if (el.id === 'pe-group-floor') { if (el.value) { moveGroupToFloor(Number(el.value)); renderAll(); } return; }
        if (el.dataset?.cell) { el.value = String(cellGrid[el.dataset.cell]); return; } // 한도를 넘게 적었으면 맞춘 값으로
        if (el.id === 'pe-file') { const file = el.files?.[0]; el.value = ''; loadBackgroundFromFile(file); return; }
        if (!el.dataset?.prop) return;
        const isSelect = el.tagName === 'SELECT';
        if (isSelect) { isHistoryArmed = true; applyProp(el.dataset.prop, el.value); }
        // 칸에서 나올 때: 문은 벽 안으로, 모형의 크기 값은 정해진 범위 안으로(저장할 때와 같은 값), 레이어 목록의 이름·자리(층)를 맞춘다.
        // 숫자 칸은 다시 그리지 않고 값만 맞춘다 (다음 칸으로 넘어간 입력이 끊기지 않게)
        const item = resolve(selected);
        if (item?.kind === 'DOOR') fitDoor(item.o);
        if (item?.kind === 'PROP') Object.assign(item.o, cleanExtras({ props: [item.o] }).props[0]);
        if (item?.kind === 'ZONE') {
            const floor = floorOf(item.o);
            // 바닥 높이를 직접 적어 층이 바뀌었으면 이름에 적힌 층도 맞춘다 ('층'을 골랐을 때는 applyProp이 이미 맞췄다)
            if (el.dataset.prop === 'y' && floorAtFocus && floor !== floorAtFocus) item.o.name = refloorName(item.o.name, nameFloorOf(item.o));
            floorAtFocus = floor;
            // 작업 층도 그 층으로 (다른 층의 구획은 평면도에서 눌리지 않는다)
            if (floor !== activeFloor) { activeFloor = floor; renderTools(); }
        }
        // 건물(창고·참고 건물)의 층·바닥 높이·벽 높이를 바꿔 작업 층에 걸치지 않게 됐으면 작업 층도 그 건물의 층으로 (이어서 고칠 수 있게)
        if ((item?.kind === 'WH' || item?.kind === 'REF') && !isOnFloor(item.o)) { activeFloor = buildingFloor(item.o); renderTools(); }
        const now = resolve(selected);
        if (now) openList = now.layer;
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
