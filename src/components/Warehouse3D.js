// ==========================================
// 창고 배치도 (3D) — 김포공장 창고의 구획(라인)과 구획별 재고. 위에서 공장(김포1공장 · 김포2공장)을 골라 본다.
// ==========================================
// · 공장마다 좌표 기준·기본 배치·주변 표시가 따로다 (warehouseZones.js ZONE_PLANTS · DEFAULT_LAYOUT · plantExtras).
//   창고는 돌아 앉을 수 있고(rot) 바닥이 다각형일 수 있다(outline) — 창고마다 묶음(Group)을 만들어 창고 기준 좌표로 그리고,
//   전체 좌표가 필요한 곳(놓을 곳 표시·끌어 놓을 칸 찾기·시점 맞춤)은 frameOf의 toWorld/toLocal로 바꾼다.
//   구획도 창고 안에서 돌려 놓거나(rot — 비스듬한 벽의 랙) 바닥을 띄울 수 있다(y — 2층 구역): 창고 묶음 안에 구획 묶음을 하나 더 두고
//   구획 기준 좌표로 그린다(joinFrames). 벽 높이 0.6m 이하인 창고는 벽 없이 바닥 턱만(옥외저장소),
//   참고 건물(plantExtras의 buildings — 사무실동)은 창고처럼 그리되 흐린 색이고 누를 수 없다.
// · 3D(three.js, 동적 import): 콘크리트 바닥 + 벽(불투명 굽도리 + 반투명 벽, 열린 문 자리는 비움) + 5m 격자 + 그림자.
//   라인 = 바닥 노란 칸 선(빈 칸) + 파렛트(나무 받침 + 짐, 짐 색 = 품목 분류, 칸 초과는 빨강). 번호표는 넣는 쪽 끝에 '번호 · 적재/칸'.
// · 시점: 화면 비율에 맞춰 범위가 다 들어오게(fitDistance) 부드럽게 이동, 기본 = 공장마다 정한 벽을 바깥에서 정면으로(김포2공장 = A동 출입문, 김포1공장 = 동쪽 도로 쪽).
//   마우스를 올리면 라인 테두리·풍선 도움말.
// · 구획(라인)을 누르면 그 라인만 화면에 차게 확대(focusZone)되고 다른 라인은 흐려진다. 오른쪽에 그 구획 재고.
//   그 라인의 칸(파렛트)을 누르면 무엇이 들어 있는지 보인다 — 칸 배치는 warehouseZones.zoneCellMap(저장된 칸 위치 + 자동).
// · 고른 칸을 끌어서(마우스·터치) 다른 라인이나 위쪽 [다른 거점·창고] 칸에 놓으면 옮기기 창(전체량 / 일부량)이 뜨고,
//   옮기면서 창고간 이동전표(WT)를 자동 발행한다 (warehouse3d/dragDrop.js · moveDialog.js, services/zoneTransfer.js).
//   라인 위에 놓으면 가리킨 칸(dropAt: 보이는 파렛트 → 그 칸 위, 아니면 바닥의 칸)의 가장 아래 빈 단에 놓이고 칸 위치가 저장된다.
//   같은 라인의 다른 칸에 놓으면 자리만 옮긴다(재고·전표 변화 없음).
//   오른쪽 목록의 품목 줄도 끌 수 있다(터치는 줄 앞 손잡이 .w3-grip). [다른 거점·창고] 칸을 누르면 그 창고 재고가 오른쪽에 나온다.
// · 품목 검색은 들어 있는 구획만 밝게. 칩·오른쪽 위·목록에 동별 적재/칸.
// · 구획 미지정 재고(김포공장·그 공장 창고 단위)를 [구획 지정]으로 구획에 옮긴다(같은 거점 안 이동 — 수불부·업무일지 기록 없음).
// · 동(건물) 바닥을 누르면 그 동만 본다(칩과 같음). 라인이 없는 동은 동 전체가 끌어다 놓을 곳이다(창고 단위 위치로 옮김).
// · 배치 편집(매니저): 창고 크기·위치·회전, 구획 추가·삭제·위치·크기(m). 저장하면 구획 위치가 입출고·이동·실사 위치 선택과 위치 QR에 생긴다.
// · 평면도 편집([평면도 편집], warehouse3d/planEditor.js): 위에서 본 평면도를 레이어로 나눠 보고 끌어서 고친다 — 창고·구획에 더해
//   주변 표시(참고 건물·바닥 표시·화살표·부속·출입문)와 모형(지게차·드럼 파렛트·IBC 탱크·화물차 — warehouse3d/propModels.js)도 고쳐 저장한다.
//   파렛트 한 칸을 구획 하나로 놓을 수도 있다(칸이 하나인 구획 — 3D에서는 번호만 작게 칸 위에). 화면을 다 덮는 창이고 본문 밖(body)에 띄운다.
import { state } from '../services/db.js';
import { canPerformAction, canAccessTab } from '../services/auth.js';
import { zoneCapacity, zoneDims, zonePallets, itemPallets, setZoneLoad, loadZoneLoads, zoneCellMap, freeIndexInSlot, zoneIdOfLocation, slotLabel } from '../services/warehouseZones.js';
import { ZONE_PLANTS, DEFAULT_PLANT_ID, ZONE_SITE, ZONE_TYPES, PALLET_LINE, plantExtras, loadZones, saveZones, zoneStock, zoneLocation, unassignedStock, nextZoneId } from '../services/warehouseZones.js';
import { hasOutline, warehouseOutline, warehouseLocation, warehouseStock, isPropType, propSize, FREE_WALL } from '../services/warehouseZones.js';
import { locationLabel, buildingOf, siteOf, sitesOf, campOf, warehouseDesc, isZoneLocation, normalizeLocationList } from '../services/locations.js';
import { shortLocation, cellLabel, movePalletWithinZone } from '../services/zoneTransfer.js';
import { fieldQrUrl } from '../services/fieldQr.js';
import { qrDataUrl } from '../services/qrCode.js';
import { createDragDrop } from './warehouse3d/dragDrop.js';
import { openMoveDialog, moveResultText } from './warehouse3d/moveDialog.js';
import { frameOf, joinFrames, outlineCenter, offsetOutline, zoneBaseY } from './warehouse3d/geometry.js';
import { createPropBuilder } from './warehouse3d/propModels.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const CAT_COLORS = { 원료: '#f59e0b', 원액: '#8b5cf6', 완제품: '#3b82f6', 부자재: '#10b981' };
const EMPTY_COLOR = '#cbd5e1';
const OTHER_COLOR = '#64748b';
const catColor = (cat) => CAT_COLORS[cat] || OTHER_COLOR;
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const cut = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));
const DOCK_SITE_KEY = 'daelim_w3_dock_site'; // [다른 거점·창고]에서 보고 있던 거점 (기기별)
const PLANT_KEY = 'daelim_w3_plant';         // 보고 있던 공장 (기기별)
const CELL_GLOW = '#7dd3fc';

/** 구획 재고 요약: 품목 수·분류별 수·대표 분류 */
const summarize = (rows) => {
    const byCat = {};
    rows.forEach(r => { byCat[r.category || '기타'] = (byCat[r.category || '기타'] || 0) + 1; });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    return { count: rows.length, byCat, top };
};

let activeView = null; // 지금 떠 있는 3D 화면 (다시 그릴 때 정리)

// 평면도 편집기(화면을 다 덮는 창)는 본문 밖(body)에 띄운다 — 다른 기기의 재고 변경으로 이 화면이 다시 그려져도 편집 중인 내용이 남는다.
const PLAN_HOST_ID = 'w3-plan-host';
let activePlan = null; // 열려 있는 평면도 편집기
let planHooks = {};    // 편집기가 알리는 곳 { onSaved, onClose } — 화면을 다시 그리면 새로 그린 화면 것으로 바뀐다
const planHost = () => {
    let host = document.getElementById(PLAN_HOST_ID);
    if (!host) {
        host = document.createElement('div');
        host.id = PLAN_HOST_ID;
        // 머리글(z-40)·떠 있는 버튼(z-45) 위, 알림 글(z-50) 아래
        host.className = 'hidden fixed inset-0 z-[48] bg-white no-print';
        document.body.appendChild(host);
    }
    return host;
};
/**
 * 다른 화면으로 가기 전에(main.js switchTab): 평면도 편집기가 열려 있으면 닫는다.
 * @returns {boolean} 저장하지 않은 변경이 있어 사용자가 나가기를 취소하면 false
 */
export const confirmLeaveWarehouse3D = () => {
    if (!activePlan) return true;
    if (!activePlan.leave()) return false;
    activePlan = null;
    return true;
};

export const renderWarehouse3D = async (container, { showToast, onSwitchTab }) => {
    activeView?.dispose();
    activeView = null;
    const canEdit = canPerformAction('EDIT_MASTER');
    const canMove = canPerformAction('WRITE_STOCK');

    // plant = 보고 있는 공장, wh = 고른 동(창고), selected = 고른 구획, cell = 그 구획에서 고른 칸 번호(없으면 null),
    // dockLoc = [다른 거점·창고]에서 고른 창고 위치, moves = 방금 옮긴 내역(전표 번호), dragging = 끄는 중(다른 라인을 흐리지 않음)
    const ui = { plant: DEFAULT_PLANT_ID, wh: '', selected: '', cell: null, search: '', edit: false, draft: null, unFilter: '', dockSite: '', dockLoc: '', moves: [], dragging: false };
    let rows = [];                 // 모든 공장의 배치 (저장된 배치 + 저장 전인 공장의 기본 배치)
    let defaultPlants = new Set(); // 저장된 배치가 없어 기본 배치를 보여 주는 공장
    let isUnsaved = false;         // 지금 보는 공장이 기본 배치인지 (안내 표시)
    let isDefault = false;         // 그 기본 배치에 구획이 있는지 — 저장 전 구획은 재고 위치가 아니라 옮기기·구획 지정을 막는다

    container.innerHTML = `
    <div class="max-w-[1680px] mx-auto space-y-3" id="w3-root">
        <div class="flex flex-wrap items-end justify-between gap-2">
            <div>
                <h2 class="text-xl font-bold text-slate-800 flex flex-wrap items-center gap-2"><i data-lucide="box" class="w-5 h-5 text-blue-600"></i> 창고 배치도 (3D)
                    <span id="w3-plants" class="inline-flex rounded-lg border overflow-hidden"></span></h2>
                <p class="text-xs text-slate-500">라인을 누르면 확대되고, 칸을 누르면 보관 품목이 보입니다. 고른 칸을 끌어서 다른 칸·라인·창고에 놓으면 그 자리로 옮기고(칸 위치 저장) 이동전표를 발행합니다. 빈 곳을 끌면 돌리고, 휠로 확대합니다.</p>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <div class="relative"><input id="w3-search" type="search" placeholder="품목코드·품명으로 위치 찾기" class="border rounded-lg pl-8 pr-3 py-2 text-sm w-64"><i data-lucide="search" class="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400"></i></div>
                <button id="w3-top" class="px-3 py-2 text-sm border rounded-lg bg-white hover:bg-slate-50">위에서 보기</button>
                <button id="w3-reset" class="px-3 py-2 text-sm border rounded-lg bg-white hover:bg-slate-50" title="처음 보던 방향으로 전체가 보이게 (동을 고르면 그 동)">기본 시점</button>
                <button id="w3-qr" class="px-3 py-2 text-sm border rounded-lg bg-white hover:bg-slate-50">구획 QR 라벨</button>
                <button id="w3-plan" class="px-3 py-2 text-sm border rounded-lg bg-white hover:bg-slate-50 flex items-center gap-1" title="위에서 본 평면도 — 레이어별로 보고${canEdit ? ' 끌어서 고칩니다' : ''}"><i data-lucide="layers" class="w-4 h-4"></i>${canEdit ? '평면도 편집' : '평면도 보기'}</button>
                ${canEdit ? '<button id="w3-edit" class="px-3 py-2 text-sm rounded-lg bg-slate-800 text-white hover:bg-slate-700">배치 편집</button>' : ''}
            </div>
        </div>
        <div id="w3-banner"></div>
        <div class="flex flex-wrap gap-2" id="w3-chips"></div>
        <div id="w3-dock"></div>
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-3">
            <div class="relative bg-slate-900 rounded-xl overflow-hidden h-[420px] lg:h-[620px]" id="w3-stage">
                <div id="w3-canvas" class="absolute inset-0"></div>
                <div id="w3-tip" class="hidden absolute pointer-events-none bg-white/95 text-slate-800 text-xs rounded-lg shadow px-2 py-1"></div>
                <div id="w3-sum" class="absolute right-2 top-2 pointer-events-none text-[11px] text-white bg-black/55 rounded-lg px-2.5 py-1.5 text-right leading-snug"></div>
                <div class="absolute left-2 bottom-2 right-2 sm:right-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/90 bg-black/55 rounded-lg px-2.5 py-1.5 pointer-events-none">
                    <span class="font-bold text-white/70">파렛트</span>
                    ${Object.entries(CAT_COLORS).map(([k, c]) => `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm" style="background:${c}"></span>${k}</span>`).join('')}
                    <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm" style="background:${OTHER_COLOR}"></span>기타</span>
                    <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-red-500"></span>칸 초과</span>
                    <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm border-2 border-yellow-400"></span>빈 칸</span>
                    <span class="hidden sm:flex items-center gap-1 text-white/60">번호표 = 라인 · 적재/칸</span>
                </div>
            </div>
            <div id="w3-side" class="bg-white border rounded-xl p-3 lg:pr-14 space-y-3 lg:h-[620px] overflow-y-auto"></div>
        </div>
    </div>
    <div id="w3-modal" class="hidden fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4"></div>`;

    const $ = (sel) => container.querySelector(sel);
    // 보고 있는 공장과 그 공장의 창고 (배치 줄은 공장별로 걸러 쓴다 — 공장마다 좌표 기준이 다르다)
    const plantInfo = () => ZONE_PLANTS.find(p => p.id === ui.plant) || ZONE_PLANTS[0];
    const plantWarehouses = () => plantInfo().warehouses;
    const isInPlant = (r) => plantWarehouses().some(w => w.code === r.warehouse);
    const whLabel = (code) => plantWarehouses().find(w => w.code === code)?.label || code;
    const zonesAll = () => (ui.edit ? ui.draft : rows.filter(isInPlant));
    const zonesOf = (wh) => zonesAll().filter(r => r.kind === 'ZONE' && (!wh || r.warehouse === wh)).sort((a, b) => a.warehouse.localeCompare(b.warehouse) || a.sort - b.sort || a.id.localeCompare(b.id));
    const whRow = (code) => zonesAll().find(r => r.kind === 'WAREHOUSE' && r.id === code);
    const root = $('#w3-root');
    const zoneById = (id) => (id ? zonesAll().find(r => r.kind === 'ZONE' && r.id === id) : null) || null;
    const syncDefault = () => {
        isUnsaved = defaultPlants.has(ui.plant);
        isDefault = isUnsaved && rows.some(r => r.kind === 'ZONE' && isInPlant(r));
    };
    // 끌어서 옮기기: 재고를 쓸 수 있는 사람만, 배치가 저장된 뒤에만 (구획이 위치로 등록되어야 옮길 수 있음)
    const canDrag = () => canMove && !isDefault && !ui.edit;
    const stockAt = (loc) => (state.inventory || []).filter(i => i.location === loc && Number(i.quantity) !== 0);

    /**
     * 고른 라인의 칸 내용. 칸이 있는 라인은 칸 하나에 품목 하나(zoneCellMap), 칸이 없는 구획은 구획 전체가 한 덩어리.
     * @returns {{ label: string, items: { code: string, name: string, category: string, quantity: number, unit: string }[], k: number, n: number, overflow: number }}
     *   k = 그 품목의 몇 번째 파렛트(0부터), n = 그 품목 파렛트 칸 수, overflow = 칸이 모자라 못 그린 파렛트 수(마지막 칸)
     */
    const cellInfo = (z, idx) => {
        const stock = zoneStock(z);
        const cap = zoneCapacity(z);
        if (!cap) return { label: '구획 전체', items: stock, k: 0, n: 1, overflow: 0 };
        const map = zoneCellMap(z);
        const cell = map.cells[idx];
        const item = cell ? stock.find(i => i.code === cell.code) : null;
        return { label: cellLabel(z, idx), items: item ? [item] : [], k: cell?.k || 0, n: cell?.n || 0, overflow: idx === cap - 1 ? map.overflow.length : 0 };
    };
    // 고른 칸 번호가 그 라인에 없으면(옮긴 뒤 칸 수가 바뀜 등) 선택을 푼다
    const normalizeCell = () => {
        const z = zoneById(ui.selected);
        if (!z || ui.cell === null) { ui.cell = null; return; }
        const cap = zoneCapacity(z);
        if (cap ? ui.cell >= cap : (ui.cell !== 0 || !zoneStock(z).length)) ui.cell = null;
    };
    /** 고른 칸을 끌 때 옮길 대상 (빈 칸이면 null) */
    const cellSource = () => {
        const z = zoneById(ui.selected);
        if (!z || ui.cell === null) return null;
        const { items } = cellInfo(z, ui.cell);
        if (!items.length) return null;
        return { fromLoc: zoneLocation(z), codes: items.map(i => i.code), label: items.length === 1 ? items[0].name : `${z.id} 보관 품목 ${items.length}개`, cell: zoneCapacity(z) ? ui.cell : -1 };
    };
    const cellTipHtml = (z, idx) => {
        const info = cellInfo(z, idx);
        const head = `<b>${esc(z.id)} · ${esc(info.label)}</b>`;
        if (!info.items.length) return `${head}<br>빈 칸`;
        if (info.items.length > 1) return `${head}<br>${info.items.length}품목 보관`;
        const it = info.items[0];
        return `${head}<br>${esc(it.name)}<br>재고 <b>${fmt(it.quantity)}</b> ${esc(it.unit || '')}${info.n > 1 ? ` · 파렛트 ${info.k + 1}/${info.n}` : ''}`;
    };

    // 검색: 품목 → 들어 있는 구획
    const searchHits = () => {
        const q = norm(ui.search);
        if (!q) return null;
        const hits = new Map();
        zonesOf('').forEach(z => {
            const items = zoneStock(z).filter(i => norm(i.code).includes(q) || norm(i.name).includes(q));
            if (items.length) hits.set(z.id, items);
        });
        return hits;
    };

    // 동(또는 전체)의 적재 현황: 파렛트 칸이 있는 라인의 적재/칸 + 구획에 든 품목 수(items) + 창고 단위로 적힌 구획 미지정 품목 수(loose)
    const whStats = (code = '') => {
        let cap = 0, used = 0, items = 0, lines = 0;
        zonesOf(code).forEach(z => {
            const c = zoneCapacity(z);
            if (c) { cap += c; used += zonePallets(z); lines += 1; }
            items += zoneStock(z).length;
        });
        const loose = zonesAll().filter(r => r.kind === 'WAREHOUSE' && (!code || r.id === code)).reduce((sum, wh) => sum + warehouseStock(wh).length, 0);
        return { cap, used, items, lines, loose, zones: zonesOf(code).length };
    };
    const pctText = (used, cap) => (cap ? `${Math.round((used / cap) * 100)}%` : '');
    // 3D 오른쪽 위 요약
    const renderSum = () => {
        const box = $('#w3-sum');
        if (!box) return;
        const st = whStats(ui.wh);
        const scope = ui.wh ? whLabel(ui.wh) : `${ui.plant} 전체`;
        box.innerHTML = `<div class="font-bold">${esc(scope)}</div>`
            + (st.cap ? `<div>적재 <b class="${st.used > st.cap ? 'text-red-300' : 'text-emerald-300'}">${fmt(st.used)}</b> / ${fmt(st.cap)} 파렛트 · ${pctText(st.used, st.cap)}</div>` : '')
            + `<div class="text-white/70">구획 ${st.zones}곳 · 보관 품목 ${st.items}${st.loose ? ` · 구획 미지정 ${st.loose}` : ''}</div>`;
    };
    // 동(건물)에 마우스를 올렸을 때 풍선 도움말
    const whTipHtml = (wh) => {
        const st = whStats(wh.id);
        return `<b>${esc(wh.id)}</b> ${esc(wh.name || '')} · ${fmt(wh.w)}×${fmt(wh.d)}m<br>`
            + `${st.zones ? `구획 ${st.zones}곳${st.cap ? ` · 적재 <b>${fmt(st.used)}/${fmt(st.cap)}</b>` : ''} · 보관 ${st.items}품목` : '구획(라인) 없음'}`
            + `${st.loose ? ` · 구획 미지정 ${st.loose}품목` : ''}`
            + (ui.wh === wh.id ? '' : '<br><span class="text-blue-600">누르면 이 동만 봅니다</span>');
    };

    // ---------- 3D ----------
    let view = null;
    const buildView = async () => {
        const host = $('#w3-canvas');
        try {
            const THREE = await import('three');
            const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
            view = createView(THREE, OrbitControls, host);
            activeView = view;
        } catch (e) {
            console.error(e);
            host.innerHTML = `<div class="text-white/80 text-sm p-6">3D 화면을 열 수 없습니다 (${esc(e.message)}). 오른쪽 목록으로 구획 재고를 볼 수 있습니다.</div>`;
        }
    };

    const createView = (THREE, OrbitControls, host) => {
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.shadowMap.autoUpdate = false; // rebuild에서만 needsUpdate (매 그리기마다 그림자를 다시 만들지 않음)
        host.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#0b1220');
        const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 3000);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.maxPolarAngle = Math.PI / 2 - 0.05;
        scene.add(new THREE.HemisphereLight(0xf8fafc, 0x1e293b, 1.15));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 0.02;
        scene.add(sun, sun.target);
        const fillLight = new THREE.DirectionalLight(0xc7d2fe, 0.35);
        fillLight.position.set(-40, 30, -30);
        scene.add(fillLight);

        let group = new THREE.Group();
        scene.add(group);
        let pickables = [];
        let outlines = new Map();   // 구획 id → 테두리 (마우스 올림·선택·검색 표시)
        let hitIds = new Set();     // 검색에 걸린 구획
        let hoverId = '';
        let siteBox = null;         // 시점 맞춤 범위 { minX, maxX, minZ, maxZ, maxY } (전체 좌표)
        let whBoxes = new Map();    // 창고 id → 시점 맞춤 범위 (전체 좌표)
        // 구획 id → 상자: 전체 좌표의 가운데(x, y, z)·크기(sx, sy, sz)·회전(rotY) + 창고 기준 가운데(lx, lz)·좌표 변환(frame)
        //   + 칸 계산(cap·slots·tiers·step·cellBoxOf = 칸 번호 → 전체 좌표 상자)
        let zoneBoxes = new Map();
        let whPickables = [];       // 동 바닥 (userData.whId) — 구획이 아닌 곳을 눌렀을 때 어느 동인지
        let whMarks = new Map();    // 창고 id → 동 전체 상자 (전체 좌표 가운데·크기·회전) — 라인이 없는 동에 놓을 때 테두리
        let lineFreeWhs = new Set(); // 구획(라인)이 없는 동 — 동 전체가 끌어다 놓을 곳
        let palletPickables = [];   // 모든 라인의 파렛트 (끌어다 놓을 때 가리킨 칸: userData.dropZone · dropCell)
        let cellPickables = [];     // 고른 라인의 칸 (파렛트 또는 빈 칸의 투명 상자, userData.cell = 칸 번호)
        let cellBoxes = [];         // 고른 라인의 칸 자리 (칸 번호순, 전체 좌표 상자)
        let hoverCell = -1;
        const disposables = [];
        const track = (o) => { disposables.push(o); return o; };

        // 다시 그려도 남는 표시: 놓을 라인 테두리 · 마우스가 올라간 칸 테두리 · 끄는 동안 바닥을 따라다니는 파렛트
        const unitBox = new THREE.BoxGeometry(1, 1, 1);
        const unitEdges = new THREE.EdgesGeometry(unitBox);
        const markMaterials = [];
        const marker = (color) => {
            const m = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
            markMaterials.push(m);
            const o = new THREE.LineSegments(unitEdges, m);
            o.visible = false;
            o.renderOrder = 9;
            scene.add(o);
            return o;
        };
        const dropMark = marker('#4ade80');
        const cellHoverMark = marker('#ffffff');
        const ghostMaterial = new THREE.MeshBasicMaterial({ color: CELL_GLOW, transparent: true, opacity: 0.6, depthWrite: false });
        const ghost = new THREE.Mesh(unitBox, ghostMaterial);
        ghost.visible = false;
        ghost.renderOrder = 8;
        scene.add(ghost);
        // 표시(테두리·끄는 파렛트)를 전체 좌표 상자에 맞춘다 — 돌아 앉은 창고의 칸이면 같이 돌린다
        const placeBox = (o, b, pad = 0) => { o.scale.set(b.sx + pad, b.sy + pad, b.sz + pad); o.position.set(b.x, b.y, b.z); o.rotation.set(0, b.rotY || 0, 0); };

        /**
         * 이름표 (카메라를 보는 글자판): lines = [{ text, size, color, bold }]
         * hM = 높이(m). screen이면 멀어져도 같은 크기(hM = 화면 높이 비율 쯤), center = 기준점(0~1, 기본 가운데)
         */
        const badge = (lines, { bg = 'rgba(15,23,42,0.82)', hM = 0.9, screen = false, center = null } = {}) => {
            const pad = 14;
            const cv = document.createElement('canvas');
            const ctx = cv.getContext('2d');
            const font = (l) => `${l.bold === false ? '500' : 'bold'} ${l.size}px sans-serif`;
            const w = Math.ceil(Math.max(...lines.map(l => { ctx.font = font(l); return ctx.measureText(l.text).width; })) + pad * 2);
            const h = Math.ceil(lines.reduce((s, l) => s + l.size * 1.2, 0) + pad * 1.1);
            cv.width = w; cv.height = h;
            ctx.fillStyle = bg;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(0, 0, w, h, 12); else ctx.rect(0, 0, w, h);
            ctx.fill();
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            let y = pad * 0.55;
            lines.forEach(l => { ctx.font = font(l); ctx.fillStyle = l.color || '#ffffff'; ctx.fillText(l.text, w / 2, y); y += l.size * 1.2; });
            const tex = track(new THREE.CanvasTexture(cv));
            tex.colorSpace = THREE.SRGBColorSpace;
            const sp = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: !screen })));
            const k = hM / h;
            sp.scale.set(w * k, h * k, 1);
            if (center) sp.center.set(center[0], center[1]);
            sp.renderOrder = 10;
            return sp;
        };
        let zoneLabels = []; // 라인 번호표·문 이름표 (화면에서 너무 작게 보이면 숨김)

        const rebuild = () => {
            scene.remove(group);
            disposables.splice(0).forEach(o => o.dispose?.());
            group = new THREE.Group();
            scene.add(group);
            pickables = [];
            outlines = new Map();
            zoneLabels = [];
            hoverId = '';
            zoneBoxes = new Map();
            whPickables = [];
            whMarks = new Map();
            palletPickables = [];
            cellPickables = [];
            cellBoxes = [];
            hoverCell = -1;
            cellHoverMark.visible = false;
            dropMark.visible = false;
            // 물체를 넣을 곳: 공장 전체(group) 또는 그리는 중인 창고의 묶음(창고 기준 좌표, 창고가 돌아 앉았으면 묶음째 돈다)
            let parent = group;
            // 같은 색·크기는 재질·모양을 함께 쓴다 (다시 그릴 때 모두 정리)
            const mats = new Map(), geos = new Map();
            const mat = (color, { opacity = 1, emissive = '', basic = false } = {}) => {
                const key = `${color}|${opacity}|${emissive}|${basic}`;
                if (!mats.has(key)) {
                    const opts = { color, transparent: opacity < 1, opacity, ...(opacity < 1 ? { depthWrite: false } : {}) };
                    mats.set(key, track(basic ? new THREE.MeshBasicMaterial(opts)
                        : new THREE.MeshStandardMaterial({ ...opts, roughness: 0.8, metalness: 0.05, ...(emissive ? { emissive, emissiveIntensity: 0.55 } : {}) })));
                }
                return mats.get(key);
            };
            const lineMat = (color, opacity = 1) => {
                const key = `L${color}|${opacity}`;
                if (!mats.has(key)) mats.set(key, track(new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })));
                return mats.get(key);
            };
            const box = (w, h, d) => {
                const k = `B${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
                if (!geos.has(k)) geos.set(k, track(new THREE.BoxGeometry(w, h, d)));
                return geos.get(k);
            };
            const edges = (w, h, d) => {
                const k = `E${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
                if (!geos.has(k)) geos.set(k, track(new THREE.EdgesGeometry(box(w, h, d))));
                return geos.get(k);
            };
            const mesh = (geo, m, x, y, z, { cast = false, receive = false } = {}) => {
                const o = new THREE.Mesh(geo, m);
                o.position.set(x, y, z);
                o.castShadow = cast; o.receiveShadow = receive;
                parent.add(o);
                return o;
            };
            const flatPlane = (w, d, m, x, y, z) => { const o = mesh(track(new THREE.PlaneGeometry(w, d)), m, x, y, z); o.rotation.x = -Math.PI / 2; return o; };
            // 바닥 외곽선([x, z] m)을 높이 h만큼 세운 기둥 모양 (hole = 안쪽을 비울 외곽선 → 벽처럼 고리 모양). 바닥이 y 0, 위가 y h
            const prism = (pts, h, hole = null) => {
                const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
                if (hole) shape.holes.push(new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
                const geo = track(new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }));
                geo.rotateX(-Math.PI / 2); // 도형의 y → -z(그래서 위에서 -z로 넣음), 두께 방향 → 위(y)
                return geo;
            };

            const hits = searchHits();
            hitIds = new Set(hits ? [...hits.keys()] : []);
            // 라인을 고르면 그 라인만 또렷하게: 나머지 라인은 흐리게, 동·문·다른 라인 이름표는 숨긴다
            // (이름표는 항상 맨 앞에 그려져, 확대하면 카메라 가까이 있는 이름표가 고른 라인을 가린다). 끄는 동안은 놓을 곳이 보이게 모두 그린다
            const focusId = !ui.edit && !ui.dragging ? ui.selected : '';
            // 라인을 확대한 채 끄는 동안에도 큰 이름표(동·문)는 숨긴다 — 가장자리로 끌어 넓게 보면(widenView) 다시 보인다
            const hideBigLabels = !!focusId || (ui.dragging && isAtZoom());
            const whs = zonesAll().filter(r => r.kind === 'WAREHOUSE');
            const extras = plantExtras(ui.plant);
            const doors = extras.doors || [];
            const isLabelNorth = extras.labelSide === 'N'; // 동 이름표를 북쪽 벽 위에 (아니면 동 서쪽 바깥)
            const doorH = (wh) => Math.min(4, Math.max(2.2, wh.h - 1));
            lineFreeWhs = new Set(whs.filter(wh => !zonesOf(wh.id).length).map(wh => wh.id));

            // 창고가 아닌 참고 건물(사무실동 등): 창고처럼 그리되 누를 수 없고 재고 위치가 아니다
            const refBuildings = (extras.buildings || []).map(b => ({ ...b, isRef: true }));
            const buildings = [...whs, ...refBuildings];

            // ---------- 건물마다 묶음 하나: 건물 왼쪽 위 모서리가 원점, 돌아 앉은 만큼 돌린다 ----------
            const frames = new Map(), whGroups = new Map();
            buildings.forEach(wh => {
                const frame = frameOf(wh);
                const g = new THREE.Group();
                g.position.set(wh.x, 0, wh.z);
                g.rotation.y = frame.rotY;
                group.add(g);
                frames.set(wh.id, frame);
                whGroups.set(wh.id, g);
            });
            /** 묶음 기준 좌표로 그린다 (draw 안에서 만든 물체는 그 묶음에 들어간다 — 창고 묶음, 그 안의 구획 묶음) */
            const inGroup = (g, draw) => {
                const outer = parent;
                parent = g || group;
                try { draw(); } finally { parent = outer; }
            };
            const inWarehouse = (whId, draw) => inGroup(whGroups.get(whId), draw);

            // ---------- 시점 맞춤 범위 (이름표 자리 포함, 전체 좌표) ----------
            const grow = (b, x0, z0, x1, z1, y = 0) => { b.minX = Math.min(b.minX, x0); b.maxX = Math.max(b.maxX, x1); b.minZ = Math.min(b.minZ, z0); b.maxZ = Math.max(b.maxZ, z1); b.maxY = Math.max(b.maxY, y); };
            const empty = () => ({ minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxY: 3 });
            const bx = empty();
            const whFoots = new Map();   // 건물 id → 바닥 외곽선이 차지하는 범위 (전체 좌표)
            const whCenters = new Map(); // 창고 id → 바닥 한가운데 (전체 좌표) — 돌려 놓은 구획을 안쪽에서 볼 때
            whBoxes = new Map();
            buildings.forEach(wh => {
                const frame = frames.get(wh.id);
                const outline = warehouseOutline(wh);
                const foot = empty();
                outline.forEach(([x, z]) => { const p = frame.toWorld(x, z); grow(foot, p.x, p.z, p.x, p.z); });
                whFoots.set(wh.id, foot);
                const b = empty();
                // 이름표 자리: 서쪽 바깥 13m, 또는 북쪽 벽 위(북쪽 바깥 3.4m · 벽 위 3m)
                if (isLabelNorth) grow(b, foot.minX - 1.6, foot.minZ - 3.4, foot.maxX + 1.6, foot.maxZ + 0.6, wh.h + 3);
                else grow(b, foot.minX - 13, foot.minZ - 0.6, foot.maxX + 1.6, foot.maxZ + 0.6, wh.h);
                grow(bx, b.minX, b.minZ, b.maxX, b.maxZ, b.maxY);
                if (wh.isRef) return;
                whBoxes.set(wh.id, b);
                const center = outlineCenter(outline);
                whCenters.set(wh.id, frame.toWorld(center.x, center.z));
                const mid = frame.toWorld(wh.w / 2, wh.d / 2);
                whMarks.set(wh.id, { x: mid.x, y: wh.h / 2, z: mid.z, sx: wh.w, sy: wh.h, sz: wh.d, rotY: frame.rotY });
            });
            (extras.floorMarks || []).forEach(fm => grow(bx, fm.x, fm.z, fm.x + fm.w, fm.z + fm.d));
            (extras.arrows || []).forEach(ar => grow(bx, Math.min(ar.from[0], ar.to[0]), Math.min(ar.from[1], ar.to[1]), Math.max(ar.from[0], ar.to[0]), Math.max(ar.from[1], ar.to[1])));
            // 건물 밖에 둔 모형(화물차 등)도 화면 맞춤 범위에 넣는다
            (extras.props || []).forEach(pr => {
                if (!isPropType(pr.type)) return;
                const size = propSize(pr);
                const p = frames.get(pr.warehouse)?.toWorld(pr.x, pr.z) || pr;
                const reach = Math.max(size.front, size.back, size.w / 2);
                grow(bx, p.x - reach, p.z - reach, p.x + reach, p.z + reach);
            });
            siteBox = Number.isFinite(bx.minX) ? bx : null;

            // ---------- 바닥 · 격자(5m) · 해 ----------
            if (siteBox) {
                const cx = (bx.minX + bx.maxX) / 2, cz = (bx.minZ + bx.maxZ) / 2;
                const size = Math.ceil((Math.max(bx.maxX - bx.minX, bx.maxZ - bx.minZ) + 24) / 10) * 10;
                const ground = flatPlane(size, size, mat('#1e293b'), cx, -0.02, cz);
                ground.receiveShadow = true;
                const grid = new THREE.GridHelper(size, size / 5, '#3b4a63', '#2a364b');
                grid.position.set(cx, -0.012, cz);
                grid.material.transparent = true;
                grid.material.opacity = 0.55;
                track(grid.geometry); track(grid.material);
                group.add(grid);
                const s = size / 2;
                sun.position.set(cx + s * 0.6, s * 1.6, cz + s * 0.45);
                sun.target.position.set(cx, 0, cz);
                Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: s * 5 });
                sun.shadow.camera.updateProjectionMatrix();
            }
            // 공장 밖으로 나가는 길: 바닥 화살표 + 바닥 출입구 표시 (참고용, 누를 수 없음)
            (extras.arrows || []).forEach(ar => {
                const [x0, z0] = ar.from, [x1, z1] = ar.to;
                const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
                if (l < 0.5) return;
                const head = Math.min(1.2, l * 0.4), sw = 0.3, hw = 0.75;
                const shape = new THREE.Shape();
                shape.moveTo(0, -sw); shape.lineTo(l - head, -sw); shape.lineTo(l - head, -hw); shape.lineTo(l, 0);
                shape.lineTo(l - head, hw); shape.lineTo(l - head, sw); shape.lineTo(0, sw); shape.lineTo(0, -sw);
                const arrow = new THREE.Mesh(track(new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false })), mat('#22c55e', { emissive: '#16a34a' }));
                arrow.rotation.x = -Math.PI / 2;
                const holder = new THREE.Group();
                holder.add(arrow);
                holder.rotation.y = Math.atan2(-dz, dx);
                holder.position.set(x0, 0.03, z0);
                group.add(holder);
                if (ar.name) {
                    const lab = badge([{ text: `➜ ${ar.name}`, size: 30 }], { hM: 0.6, bg: 'rgba(21,128,61,0.9)' });
                    lab.position.set((x0 + x1) / 2 + 2.2, 1.2, (z0 + z1) / 2);
                    group.add(lab);
                }
            });
            (extras.floorMarks || []).forEach(fm => {
                const cx = fm.x + fm.w / 2, cz = fm.z + fm.d / 2;
                flatPlane(fm.w, fm.d, mat(fm.color || '#22c55e', { opacity: 0.4, basic: true }), cx, 0.02, cz);
                const edge = new THREE.LineSegments(edges(fm.w, 0.02, fm.d), lineMat('#ffffff'));
                edge.position.set(cx, 0.04, cz);
                group.add(edge);
                // 바닥에 누운 글자 (위에서 볼 때 북쪽이 위). 남북으로 긴 표시(도로 등)는 글자를 긴 쪽으로 눕혀 쓴다 — 남 → 북으로 읽힌다
                const isTall = fm.d > fm.w * 1.5;
                const tw = isTall ? fm.d : fm.w, td = isTall ? fm.w : fm.d; // 글자판 가로 × 세로 (m)
                const cv = document.createElement('canvas');
                if (isTall) { cv.height = 232; cv.width = Math.min(2048, Math.round(232 * (tw / td))); } else { cv.width = 512; cv.height = Math.round(512 * (td / tw)); }
                const ctx = cv.getContext('2d');
                const lines = String(fm.text || '').split('\n');
                // 눕혀 쓴 한 줄 글자는 폭을 다 채우지 않게 (도로 이름이 건물보다 크게 보이지 않도록)
                const fs = Math.min(cv.width / 5.5, cv.height / (isTall ? Math.max(2.6, lines.length * 1.4) : lines.length * 1.4));
                ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                lines.forEach((l, i) => { ctx.font = `bold ${i ? fs * 0.7 : fs}px sans-serif`; ctx.fillText(l, cv.width / 2, cv.height / 2 + (i - (lines.length - 1) / 2) * fs * 1.25); });
                const tex = track(new THREE.CanvasTexture(cv));
                tex.colorSpace = THREE.SRGBColorSpace;
                const label = flatPlane(tw * 0.95, td * 0.95, track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })), cx, 0.05, cz);
                if (isTall) label.rotation.z = Math.PI / 2;
            });

            // ---------- 동: 콘크리트 바닥 · 벽(아래 굽도리 + 반투명 벽, 열린 문 자리는 비움) · 이름표 ----------
            // 벽 높이가 0.6m 이하면 벽 없이 그 높이의 바닥 턱만 그린다 — 옥외저장소. 참고 건물(isRef)은 흐린 색, 누를 수 없음
            buildings.forEach(wh => inWarehouse(wh.id, () => {
                const dim = wh.isRef ? !!ui.wh : !!(ui.wh && ui.wh !== wh.id);
                const cx = wh.w / 2, cz = wh.d / 2;
                const H = wh.h, T = 0.2, PL = H <= 0.6 ? H : 0.35, dh = doorH(wh);
                const floorMat = mat(dim ? '#334155' : wh.isRef ? '#aab4c3' : '#e5e7eb');
                const wallMat = mat('#e2e8f0', { opacity: dim ? 0.05 : wh.isRef ? 0.08 : 0.13 });
                const plinthMat = mat(dim ? '#475569' : '#94a3b8');
                const roofMat = lineMat(dim ? '#475569' : '#94a3b8', dim ? 0.35 : 0.75);
                const outline = warehouseOutline(wh);
                let floor = null;
                if (hasOutline(wh)) {
                    // 다각형 동(ㄱ자·계단 모양): 바닥 = 외곽선 그대로, 벽 = 외곽선 바깥으로 벽 두께만큼 넓힌 고리 (문 자리는 비우지 않는다)
                    const outer = offsetOutline(outline, T);
                    floor = mesh(prism(outline, 0.12), floorMat, 0, -0.11, 0, { receive: true });
                    mesh(prism(outer, PL, outline), plinthMat, 0, 0, 0, { cast: true, receive: true });
                    if (H - PL > 0.02) mesh(prism(outer, H - PL, outline), wallMat, 0, PL, 0, { receive: true });
                    parent.add(new THREE.LineSegments(track(new THREE.EdgesGeometry(prism(outer, H))), roofMat));
                } else {
                    floor = mesh(box(wh.w, 0.12, wh.d), floorMat, cx, -0.05, cz, { receive: true });
                    [
                        { wall: 'N', len: wh.w, alongX: true, at: -T / 2 },
                        { wall: 'S', len: wh.w, alongX: true, at: wh.d + T / 2 },
                        { wall: 'W', len: wh.d, alongX: false, at: -T / 2 },
                        { wall: 'E', len: wh.d, alongX: false, at: wh.w + T / 2 }
                    ].forEach(sd => {
                        const seg = (a, b, y0, y1, m, cast) => {
                            const l = b - a, hh = y1 - y0;
                            if (l < 0.02 || hh < 0.02) return;
                            const mid = (a + b) / 2;
                            mesh(box(sd.alongX ? l : T, hh, sd.alongX ? T : l), m, sd.alongX ? mid : sd.at, y0 + hh / 2, sd.alongX ? sd.at : mid, { cast, receive: true });
                        };
                        const opens = doors.filter(d => d.warehouse === wh.id && d.wall === sd.wall && d.style !== 'FIXED' && !d.fixed)
                            .map(d => [Math.max(0, d.from), Math.min(sd.len, d.to)]).sort((p, q) => p[0] - q[0]);
                        let cur = sd.alongX ? -T : 0;
                        const end = sd.alongX ? sd.len + T : sd.len;
                        opens.forEach(([a, b]) => {
                            seg(cur, a, 0, PL, plinthMat, true);
                            seg(cur, a, PL, H, wallMat, false);
                            seg(a, b, dh, H, wallMat, false); // 문 위 벽
                            cur = b;
                        });
                        seg(cur, end, 0, PL, plinthMat, true);
                        seg(cur, end, PL, H, wallMat, false);
                    });
                    const roof = new THREE.LineSegments(edges(wh.w + T * 2, H, wh.d + T * 2), roofMat);
                    roof.position.set(cx, H / 2, cz);
                    parent.add(roof);
                }
                // 바닥을 누르면 이 동 (구획이 아닌 곳) — 참고 건물은 누를 수 없다
                if (!wh.isRef) {
                    floor.userData.whId = wh.id;
                    whPickables.push(floor);
                }
                // 건물에 붙은 작은 부속(도면의 현관·캐노피로 보이는 사각형): 낮은 판 + 테두리
                (extras.annexes || []).filter(an => an.warehouse === wh.id).forEach(an => {
                    const ax = an.x + an.w / 2, az = an.z + an.d / 2;
                    mesh(box(an.w, 0.1, an.d), mat(dim ? '#334155' : '#cbd5e1'), ax, 0.04, az, { receive: true });
                    const rim = new THREE.LineSegments(edges(an.w, 0.1, an.d), roofMat);
                    rim.position.set(ax, 0.04, az);
                    parent.add(rim);
                });
                if (hideBigLabels) return;
                const st = wh.isRef ? null : whStats(wh.id);
                const lines = wh.isRef
                    ? [{ text: wh.name || wh.id, size: 44, color: '#e2e8f0' }, { text: `${fmt(wh.w)}×${fmt(wh.d)}m · 재고 위치 아님`, size: 30, color: '#94a3b8', bold: false }]
                    : [
                        { text: `${wh.name || wh.id} · ${wh.id}`, size: 44 },
                        { text: `${fmt(wh.w)}×${fmt(wh.d)}m · ${st.cap ? `적재 ${fmt(st.used)}/${st.cap}` : `${st.items + st.loose}품목`}`, size: 30, color: '#cbd5e1', bold: false }
                    ];
                const bg = dim ? 'rgba(15,23,42,0.45)' : wh.isRef ? 'rgba(51,65,85,0.8)' : 'rgba(15,23,42,0.85)';
                if (isLabelNorth) {
                    // 이름표: 북쪽 벽 위에 세운 간판 (동이 흩어져 있는 공장 — 서쪽 바깥에 두면 옆 동과 겹친다).
                    // 동이 돌아 앉아도 북쪽에 오도록 전체 좌표로 놓는다. 위에서 볼 때 바닥(라인)을 가리지 않는다
                    const foot = whFoots.get(wh.id);
                    const wl = badge(lines, { hM: 2.4, center: [0.5, 0], bg });
                    wl.position.set((foot.minX + foot.maxX) / 2, H + 0.3, foot.minZ - 0.4);
                    group.add(wl);
                    return;
                }
                // 이름표: 동 서쪽 바깥 (오른쪽 끝이 서쪽 벽 앞). 세 동이 같은 쪽에 있어 화면 고정 크기면 겹치므로 실제 크기
                const wl = badge(lines, { hM: 3, center: [1, 0.5], bg });
                wl.position.set(-0.9, 2.2, cz);
                parent.add(wl);
            }));

            // ---------- 출입문: 열린 문은 흰 문틀 + 밀려 난(또는 열린) 문짝, 고정문은 회색 판 ----------
            // 문 하나 (창고 기준 좌표 — 그 창고 묶음 안에서 부른다)
            const drawDoor = (dr, wh) => {
                const dim = !!(ui.wh && ui.wh !== wh.id);
                const len = dr.to - dr.from, mid = (dr.from + dr.to) / 2, dh = doorH(wh);
                const alongZ = dr.wall === 'E' || dr.wall === 'W';
                const px = dr.wall === 'E' ? wh.w + 0.1 : dr.wall === 'W' ? -0.1 : mid;
                const pz = dr.wall === 'N' ? -0.1 : dr.wall === 'S' ? wh.d + 0.1 : mid;
                const fixed = dr.style === 'FIXED' || dr.fixed;
                const nx = dr.wall === 'E' ? 1 : dr.wall === 'W' ? -1 : 0, nz = dr.wall === 'S' ? 1 : dr.wall === 'N' ? -1 : 0;
                const tx = alongZ ? 0 : 1, tz = alongZ ? 1 : 0;
                const doorMat = mat(fixed ? '#94a3b8' : '#f97316', { opacity: dim ? 0.35 : 1 });
                const flat = (l, th, x, z) => mesh(box(alongZ ? th : l, dh, alongZ ? l : th), doorMat, x, dh / 2, z, { cast: !dim });
                if (fixed) {
                    flat(len, 0.26, px, pz);
                } else {
                    const frame = new THREE.LineSegments(edges(alongZ ? 0.34 : len, dh, alongZ ? len : 0.34), lineMat('#ffffff', dim ? 0.4 : 1));
                    frame.position.set(px, dh / 2, pz);
                    parent.add(frame);
                    flatPlane(alongZ ? 0.34 : len, alongZ ? len : 0.34, mat('#ffffff', { opacity: 0.85, basic: true }), px, 0.035, pz);
                    if (dr.style === 'SLIDE') {
                        const s = dr.slide || -1;
                        flat(len, 0.1, px + nx * 0.22 + tx * s * len, pz + nz * 0.22 + tz * s * len);
                    } else if (dr.style === 'DOUBLE_SLIDE') {
                        const leaf = len / 2;
                        [-1, 1].forEach(side => { const off = side * (len / 2 + leaf / 2); flat(leaf, 0.1, px + nx * 0.22 + tx * off, pz + nz * 0.22 + tz * off); });
                    } else if (dr.style !== 'OPENING') {
                        const leaf = len / 2;
                        [-1, 1].forEach(side => {
                            const hx = px + tx * side * (len / 2 - 0.05), hz = pz + tz * side * (len / 2 - 0.05);
                            mesh(box(nx ? leaf : 0.08, dh, nz ? leaf : 0.08), doorMat, hx + nx * leaf / 2, dh / 2, hz + nz * leaf / 2, { cast: !dim });
                        });
                    }
                }
                if (!dim && !hideBigLabels) {
                    const short = String(dr.name || '').replace(/\s*\(.*\)\s*$/, '');
                    // 문 이름표: 실제 크기, 멀리서 너무 작으면 숨김 (문은 주황 문짝으로 보임)
                    const lab = badge([{ text: `${fixed ? '🔒' : '🚪'} ${short}`, size: 34 }], { hM: 0.85, center: [0.5, 0], bg: fixed ? 'rgba(71,85,105,0.92)' : 'rgba(194,65,12,0.92)' });
                    lab.position.set(px + nx * 0.4, dh + 0.4, pz + nz * 0.4);
                    parent.add(lab);
                    zoneLabels.push(lab);
                }
            };
            doors.forEach(dr => {
                const wh = whs.find(w => w.id === dr.warehouse);
                if (dr.wall === FREE_WALL) {
                    // 찍은 자리의 문(다각형 건물의 비스듬한 벽 · 건물 밖 대문): 문 가운데가 원점이고 문 방향으로 돌린 묶음 안에
                    // 북쪽 벽의 문처럼 그린다 (바깥 = 문 방향의 왼쪽). 건물이 없으면 공장 기준 좌표, 문 높이 2.4m
                    const doorGroup = new THREE.Group();
                    doorGroup.position.set(dr.x, 0, dr.z);
                    doorGroup.rotation.y = frameOf({ x: 0, z: 0, rot: dr.rot }).rotY;
                    (whGroups.get(dr.warehouse) || group).add(doorGroup);
                    inGroup(doorGroup, () => drawDoor({ ...dr, wall: 'N', from: -dr.len / 2, to: dr.len / 2 }, { id: wh?.id || '', h: wh?.h || 3.4, w: 0, d: 0 }));
                    return;
                }
                if (wh) inWarehouse(wh.id, () => drawDoor(dr, wh));
            });

            // ---------- 모형(장비·짐·차량·시설): 지게차 · 드럼 파렛트 · IBC 탱크 · 화물차 · 계단 · 저장 탱크 (warehouse3d/propModels.js — 재고와 무관한 참고 표시) ----------
            // 창고가 적힌 모형은 그 창고 묶음 안(창고 기준 좌표 — 창고와 같이 돈다), 없으면 공장 기준 좌표(건물 밖의 화물차 등). 앞 = rot 방향.
            // 계단·탱크는 줄에 적힌 크기(높이·폭·지름)로 만들고, 계단은 시작 높이(y — 2층에서 오르는 계단)만큼 올려 놓는다
            const buildProp = createPropBuilder(THREE, track);
            (extras.props || []).forEach(pr => {
                const model = buildProp(pr.type, pr);
                if (!model) return;
                model.position.set(pr.x, 0.01 + (Number(pr.y) || 0), pr.z);
                model.rotation.y = -((pr.rot || 0) * Math.PI) / 180;
                (whGroups.get(pr.warehouse) || group).add(model);
            });
            (extras.facilities || []).forEach(fc => {
                mesh(box(fc.w, fc.h, fc.d), mat('#0ea5e9', { opacity: 0.75 }), fc.x + fc.w / 2, fc.h / 2, fc.z + fc.d / 2);
                const lab = badge([{ text: fc.name, size: 32 }], { hM: 0.6, bg: 'rgba(3,105,161,0.85)' });
                lab.position.set(fc.x + fc.w / 2 + 2.5, fc.h + 0.8, fc.z + fc.d / 2);
                group.add(lab);
            });

            // ---------- 구획(라인): 바닥 노란 칸 선 · 파렛트(나무 받침 + 짐) · 번호표 ----------
            // 파렛트 하나 = 나무 받침 + 짐. 누르기용으로 두 덩어리를 돌려준다
            const pallet = (x, y0, z, sx, sz, th, color, dim, glow) => {
                const base = 0.14;
                const board = mesh(box(sx, base, sz), mat(dim ? '#475569' : '#a16207', { opacity: dim ? 0.3 : 1 }), x, y0 + base / 2, z, { cast: !dim, receive: true });
                const ch = Math.max(0.2, th - base - 0.06);
                const cargo = mesh(box(sx * 0.94, ch, sz * 0.94), mat(color, { opacity: dim ? 0.25 : 1, emissive: dim ? '' : glow }), x, y0 + base + ch / 2, z, { cast: !dim, receive: true });
                return [board, cargo];
            };
            // 바닥 칸 선: 테두리 + 칸 사이 선(긴 변을 cols칸으로) + 줄 사이 선(짧은 변을 lanes줄로)
            const slotLines = (cx, cz, L, C, alongX, cols, lanes, color, opacity) => {
                const y = 0.025, pts = [];
                const P = (a, b) => (alongX ? [cx + a, y, cz + b] : [cx + b, y, cz + a]);
                const seg = (a1, b1, a2, b2) => pts.push(...P(a1, b1), ...P(a2, b2));
                seg(-L / 2, -C / 2, L / 2, -C / 2); seg(-L / 2, C / 2, L / 2, C / 2); seg(-L / 2, -C / 2, -L / 2, C / 2); seg(L / 2, -C / 2, L / 2, C / 2);
                for (let i = 1; i < cols; i += 1) { const a = -L / 2 + (L / cols) * i; seg(a, -C / 2, a, C / 2); }
                for (let j = 1; j < lanes; j += 1) { const b = -C / 2 + (C / lanes) * j; seg(-L / 2, b, L / 2, b); }
                const g = track(new THREE.BufferGeometry());
                g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
                parent.add(new THREE.LineSegments(g, lineMat(color, opacity)));
            };
            const hitMat = mat('#ffffff', { opacity: 0, basic: true });
            // 위층 구획은 저마다 바닥판을 그리지만, 같은 높이의 더 넓은 구획 안에 놓인 구획(2층 구역 위의 랙·파렛트 칸)은
            // 그 넓은 구획의 바닥판을 같이 쓴다 (같은 높이에 판을 겹쳐 그리면 번쩍거린다)
            const upperZones = zonesOf('').filter(o => zoneBaseY(o) > 0);
            const sharesSlab = (z) => upperZones.some(o => {
                if (o === z || o.warehouse !== z.warehouse || Math.abs(zoneBaseY(o) - zoneBaseY(z)) > 0.05 || o.w * o.d <= z.w * z.d) return false;
                const mid = frameOf({ x: z.x, z: z.z, rot: z.rot }).toWorld(z.w / 2, z.d / 2); // 창고 기준 가운데
                const at = frameOf({ x: o.x, z: o.z, rot: o.rot }).toLocal(mid.x, mid.z);
                return at.x >= 0 && at.x <= o.w && at.z >= 0 && at.z <= o.d;
            });
            // 구획 하나 — 구획 묶음 기준 좌표로 그린다: 창고 묶음 안에서 구획의 (x, z) 모서리가 원점, 바닥 높이 y만큼 올리고
            // 창고 기준으로 rot만큼 돌린 묶음. 표시·끌어 놓기에 쓸 상자는 전체 좌표(+ 회전·바닥 높이)로 적어 둔다
            const drawZone = (z, wh) => {
                const baseY = zoneBaseY(z);
                const isTurned = !!(Number(z.rot) || 0); // 창고 벽과 나란하지 않게 돌려 놓은 구획 (비스듬한 벽을 따라 놓인 랙)
                const frame = joinFrames(frames.get(wh.id), frameOf({ x: z.x, z: z.z, rot: z.rot }));
                const toWorldBox = (b) => ({ ...b, ...frame.toWorld(b.x, b.z), y: b.y + baseY, rotY: frame.rotY });
                const stock = zoneStock(z);
                const selected = ui.selected === z.id;
                const isHit = hitIds.has(z.id);
                const outOfScope = !!(ui.wh && ui.wh !== z.warehouse);
                const dim = outOfScope || (!!hits && !isHit) || (!!focusId && !selected);
                const cx = z.w / 2, cz = z.d / 2;
                const cap = zoneCapacity(z);
                const used = cap ? zonePallets(z) : 0;
                const alongX = z.w >= z.d;
                const L = alongX ? z.w : z.d, C = alongX ? z.d : z.w;
                // slots = 바닥 자리 수(한 줄 칸 수 cols × 줄 수 lanes). 칸은 긴 변을 따라 step 간격, 줄은 짧은 변 쪽으로 laneW 간격
                const { slots, tiers, cols, lanes } = zoneDims(z);
                const step = cap ? L / cols : L, laneW = C / lanes, th = z.h / tiers;
                const cellSize = { sx: alongX ? step * 0.86 : laneW * 0.84, sy: th, sz: alongX ? laneW * 0.84 : step * 0.86 };
                // 칸 번호(채우는 쪽에서 센 자리 × 단수 + 단) → 그 칸의 자리 (구획 기준)
                const cellBoxOf = (idx) => {
                    const slot = Math.floor(idx / tiers), tier = idx % tiers;
                    const pos = z.fillFrom === 'END' ? slots - 1 - slot : slot; // 줄 시작 쪽·첫 줄부터 센 바닥 자리
                    const off = -L / 2 + step * ((pos % cols) + 0.5), side = -C / 2 + laneW * (Math.floor(pos / cols) + 0.5);
                    return { x: alongX ? cx + off : cx + side, y: th * tier + 0.01 + th / 2, z: alongX ? cz + side : cz + off, ...cellSize };
                };
                zoneBoxes.set(z.id, {
                    ...toWorldBox({ x: cx, y: z.h / 2, z: cz, sx: z.w, sy: z.h, sz: z.d }),
                    lx: cx, lz: cz, frame, baseY, isTurned, warehouse: wh.id, whCenter: whCenters.get(wh.id),
                    // 창고 기준 가운데·벽 — 옆 라인·벽과의 거리를 잴 때 (돌려 놓지 않은 구획끼리)
                    wx: z.x + cx, wz: z.z + cz, wall: { minX: 0, maxX: wh.w, minZ: 0, maxZ: wh.d },
                    cap, slots, tiers, cols, lanes, alongX, step, laneW, isFillFromEnd: z.fillFrom === 'END', cellBoxOf: (idx) => toWorldBox(cellBoxOf(idx))
                });
                if (baseY > 0 && !sharesSlab(z)) {
                    // 위층(2층·3층) 바닥판: 아래층이 비쳐 보이게 반투명 판 + 가장자리 선
                    mesh(box(z.w, 0.16, z.d), mat(dim ? '#475569' : '#cbd5e1', { opacity: dim ? 0.25 : 0.6 }), cx, -0.09, cz, { receive: true });
                    const slabRim = new THREE.LineSegments(edges(z.w, 0.16, z.d), lineMat('#94a3b8', dim ? 0.3 : 0.9));
                    slabRim.position.set(cx, -0.09, cz);
                    parent.add(slabRim);
                }
                // 고른 라인은 다른 라인을 흐리게 해서 구분하므로 짐 색(품목 분류)을 그대로 둔다. 배치 편집·끄는 중에는 파랗게 빛나게
                const glow = selected ? (focusId ? '' : '#1d4ed8') : isHit ? '#ca8a04' : '';
                // 고른 라인만 칸을 따로 누를 수 있다: 파렛트(없으면 투명 상자)에 칸 번호를 단다
                const cellPick = selected && !ui.edit;
                const localCells = []; // 고른 라인의 칸 자리 (구획 기준 — 이 묶음 안에 그릴 때)
                const addCell = (idx, b, meshes) => {
                    localCells[idx] = b;
                    cellBoxes[idx] = toWorldBox(b);
                    (meshes.length ? meshes : [mesh(box(b.sx, b.sy, b.sz), hitMat, b.x, b.y, b.z)]).forEach(o => { o.userData.cell = idx; cellPickables.push(o); });
                };
                // 바닥: 옅게 칠한 구역 + 칸 선 (빈 칸 = 선만)
                flatPlane(z.w, z.d, mat(cap ? '#facc15' : '#e2e8f0', { opacity: dim ? 0.03 : 0.09, basic: true }), cx, 0.015, cz);
                slotLines(cx, cz, L, C, alongX, cap ? cols : 1, cap ? lanes : 1,
                    selected ? '#60a5fa' : isHit ? '#fde047' : cap ? '#eab308' : '#cbd5e1', dim ? 0.25 : 0.95);
                // 끌어다 놓을 때 가리킨 파렛트를 알 수 있게 구획·칸 번호를 단다 (칸이 없는 구획의 덩어리는 -1)
                const asDropSpot = (meshes, idx) => meshes.forEach(o => { o.userData.dropZone = z.id; o.userData.dropCell = idx; palletPickables.push(o); });
                if (cap) {
                    // 칸마다 놓인 파렛트를 그린다 (저장된 칸 위치, 저장되지 않은 파렛트는 빈 칸에 차례로). 색 = 품목 분류, 칸이 모자라면 마지막 칸 빨강
                    const map = zoneCellMap(z);
                    const isOver = map.overflow.length > 0;
                    for (let idx = 0; idx < cap; idx += 1) {
                        const cell = map.cells[idx];
                        if (!cell && !cellPick) continue;
                        const b = cellBoxOf(idx);
                        // 고른 칸은 제 색으로 밝게 빛난다 (분류 색은 그대로 알아볼 수 있게)
                        const color = isOver && idx === cap - 1 ? '#ef4444' : catColor(cell?.category);
                        const meshes = cell ? pallet(b.x, b.y - th / 2, b.z, b.sx, b.sz, th, color, dim, cellPick && ui.cell === idx ? color : glow) : [];
                        asDropSpot(meshes, idx);
                        if (cellPick) addCell(idx, b, meshes);
                    }
                } else if (stock.length) {
                    // 칸이 없는 구획: 보관 품목을 한 덩어리로 (넓은 층 구역에서는 3m까지만 — 구역을 다 덮지 않게)
                    const bh = Math.min(1.5, z.h * 0.75), bw = Math.min(z.w * 0.8, 3), bd = Math.min(z.d * 0.8, 3);
                    const color = catColor(summarize(stock).top);
                    const meshes = pallet(cx, 0.01, cz, bw, bd, bh, color, dim, cellPick && ui.cell === 0 ? color : glow);
                    asDropSpot(meshes, -1);
                    if (cellPick) addCell(0, { x: cx, y: 0.01 + bh / 2, z: cz, sx: bw, sy: bh, sz: bd }, meshes);
                }
                // 누르기용 투명 상자 + 테두리 (선택 파랑 · 검색 노랑 · 마우스 올림 흰색)
                const hit = mesh(box(z.w, z.h, z.d), hitMat, cx, z.h / 2, cz);
                hit.userData.zoneId = z.id;
                pickables.push(hit);
                const ol = new THREE.LineSegments(edges(z.w + 0.1, z.h + 0.1, z.d + 0.1), lineMat(selected ? '#60a5fa' : isHit ? '#fde047' : '#f8fafc'));
                ol.position.set(cx, (z.h + 0.1) / 2, cz);
                ol.visible = selected || isHit;
                parent.add(ol);
                outlines.set(z.id, ol);
                // 번호표: 파렛트를 넣는 쪽(채우기 시작하는 쪽의 반대편) 끝 바닥 가까이, 적재/칸.
                // 칸이 없는 구획에서 덩어리를 고른 동안에는 같은 자리에 고른 칸 이름표가 뜨므로 번호표를 그리지 않는다
                const isLumpPicked = !cap && cellPick && ui.cell !== null;
                // 파렛트 한 칸 구획(칸이 하나): 번호만 작게, 칸 바로 위에 — 칸끼리 붙어 있어 줄 끝 바깥에 두면 옆 칸을 가린다.
                // 고른 동안에는 같은 자리에 구획 이름표(또는 고른 칸 이름표)가 뜨므로 번호표를 그리지 않는다
                const isOneCell = cap > 0 && slots === 1;
                if (!outOfScope && (!hits || isHit || selected) && (!focusId || selected) && !isLumpPicked && !(isOneCell && selected)) {
                    // 번호 대신 이름: 칸이 없고 이름을 따로 지은 구획('1층'·'2층' 등 — 'N라인'·'N칸'은 번호 그대로)
                    const short = !cap && z.name && !/^\d+\s*(라인|칸)$/.test(z.name) ? cut(z.name, 6) : z.id.split('-').pop();
                    const second = isOneCell ? null : cap ? { text: `${fmt(used)}/${cap}`, size: 30, color: used > cap ? '#fca5a5' : used > 0 ? '#86efac' : '#94a3b8' }
                        : stock.length ? { text: `${stock.length}품목`, size: 30, color: '#86efac' } : null;
                    const first = { text: short, size: 42, ...(isOneCell ? { color: used > cap ? '#fca5a5' : used > 0 ? '#86efac' : '#ffffff' } : {}) };
                    const lb = badge([first, ...(second ? [second] : [])], { hM: isOneCell ? 0.42 : second ? 0.95 : 0.55, bg: selected ? 'rgba(37,99,235,0.95)' : 'rgba(15,23,42,0.82)' });
                    if (isOneCell) lb.position.set(cx, z.h + 0.3, cz);
                    else if (cap) {
                        const sign = z.fillFrom === 'END' ? -1 : 1, off = L / 2 + 0.55;
                        lb.position.set(alongX ? cx + sign * off : cx, 0.7, alongX ? cz : cz + sign * off);
                    } else lb.position.set(cx, 1.9, cz);
                    lb.userData.always = selected; // 고른 라인은 멀리서도 보이게
                    parent.add(lb);
                    zoneLabels.push(lb);
                }
                const pickedBox = cellPick && ui.cell !== null ? localCells[ui.cell] : null;
                if (pickedBox) {
                    // 고른 칸: 흰 테두리 + 칸 이름·품목·재고 이름표 (라인 이름표 대신)
                    const pickedEdge = new THREE.LineSegments(edges(pickedBox.sx + 0.1, pickedBox.sy + 0.1, pickedBox.sz + 0.1), lineMat('#ffffff'));
                    pickedEdge.position.set(pickedBox.x, pickedBox.y, pickedBox.z);
                    parent.add(pickedEdge);
                    // 끄는 동안에는 이름표가 놓을 곳을 가리므로 테두리만 둔다 (품목은 커서 옆 꼬리표에 나온다)
                    if (!ui.dragging) {
                        const info = cellInfo(z, ui.cell);
                        const one = info.items.length === 1 ? info.items[0] : null;
                        const lb = badge([
                            { text: `${info.label} · ${one ? cut(one.name, 18) : info.items.length ? `${info.items.length}품목` : '빈 칸'}`, size: 38 },
                            ...(one ? [{ text: `${fmt(one.quantity)} ${one.unit || ''}${info.n > 1 ? ` · 파렛트 ${info.k + 1}/${info.n}` : ''}`, size: 28, color: '#cffafe', bold: false }] : [])
                        ], { hM: one ? 0.06 : 0.036, screen: true, center: [0.5, 0], bg: 'rgba(8,145,178,0.96)' });
                        lb.position.set(pickedBox.x, pickedBox.y + pickedBox.sy / 2 + 0.2, pickedBox.z);
                        parent.add(lb);
                    }
                } else if (selected) {
                    const info = badge([
                        { text: `${wh.name || wh.id} ${z.name || z.id}`, size: 40 },
                        { text: cap ? `적재 ${fmt(used)}/${cap} 파렛트${used > cap ? ' · 초과' : ''}` : `${stock.length}품목`, size: 30, color: '#dbeafe', bold: false }
                    ], { hM: 0.055, screen: true, center: [0.5, 0], bg: 'rgba(37,99,235,0.95)' });
                    info.position.set(cx, z.h + 0.4, cz);
                    parent.add(info);
                }
            };
            zonesOf('').forEach(z => {
                const wh = whRow(z.warehouse);
                const whGroup = wh ? whGroups.get(wh.id) : null;
                if (!whGroup) return;
                const zoneGroup = new THREE.Group();
                zoneGroup.position.set(z.x, zoneBaseY(z), z.z);
                zoneGroup.rotation.y = frameOf({ x: 0, z: 0, rot: z.rot }).rotY;
                whGroup.add(zoneGroup);
                inGroup(zoneGroup, () => drawZone(z, wh));
            });
            scene.updateMatrixWorld(); // 누르기 판정(광선)이 그리기 전에도 새 물체 위치를 알도록
            renderer.shadowMap.needsUpdate = true; // 그림자는 물체가 바뀔 때만 다시 만든다 (시점을 돌리거나 끄는 동안에는 그대로)
            render();
        };

        // ---------- 시점: 화면 비율에 맞춰 범위가 다 들어오게, 부드럽게 이동 ----------
        let anim = 0;
        let flight = null; // 옮겨 가는 중인 목적지 (다 가면 null)
        // 라인 확대 상태 { pos, target, back } — pos·target = 확대한 시점, back = 확대하기 전 시점(선택을 풀거나 칸을 끌기 시작하면 돌아간다)
        let zoom = null;
        const flyTo = (pos, target, instant = false) => {
            cancelAnimationFrame(anim);
            flight = null;
            const reduce = instant || document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            if (reduce) { camera.position.copy(pos); controls.target.copy(target); controls.update(); render(); return; }
            const p0 = camera.position.clone(), t0 = controls.target.clone(), start = performance.now(), dur = 550;
            flight = pos;
            const step = (now) => {
                const k = Math.min(1, (now - start) / dur), e = 1 - (1 - k) ** 3;
                camera.position.lerpVectors(p0, pos, e);
                controls.target.lerpVectors(t0, target, e);
                controls.update();
                render();
                if (k < 1) anim = requestAnimationFrame(step); else flight = null;
            };
            anim = requestAnimationFrame(step);
        };
        // 아직 라인을 확대한 시점 그대로인지 (누를 때 조금 흔들린 정도는 그대로로 보고, 사용자가 돌리거나 멀리 빼면 아님)
        const isAtZoom = () => {
            if (!zoom) return false;
            if (flight === zoom.pos) return true;
            const reach = zoom.pos.distanceTo(zoom.target) * 0.25;
            return camera.position.distanceTo(zoom.pos) < reach && controls.target.distanceTo(zoom.target) < reach;
        };
        const corners = (b) => {
            const pts = [];
            [b.minX, b.maxX].forEach(x => [b.minZ, b.maxZ].forEach(z => [0, b.maxY].forEach(y => pts.push(new THREE.Vector3(x, y, z)))));
            return pts;
        };
        // dir 방향에서 target을 볼 때 pts가 화면 가장자리 안(±0.9)에 들어오는 거리
        const fitDistance = (dir, target, pts) => {
            let d = 60;
            for (let i = 0; i < 10; i += 1) {
                camera.position.copy(target).addScaledVector(dir, d);
                camera.lookAt(target);
                camera.updateMatrixWorld();
                let ext = 0, behind = false;
                pts.forEach(p => { const v = p.clone().project(camera); if (v.z > 1 || v.z < -1) behind = true; ext = Math.max(ext, Math.abs(v.x), Math.abs(v.y)); });
                d = behind ? d * 1.6 : d * (ext / 0.9);
            }
            return d;
        };
        // 기본 시점: 그 공장의 homeView 벽(문)을 바깥에서 정면으로 보는 방향, 올려다보는 각도 deg
        const homeDir = (deg) => {
            const hv = plantExtras(ui.plant).homeView;
            const wall = hv && whRow(hv.warehouse) ? hv.wall : 'E';
            const nx = wall === 'E' ? 1 : wall === 'W' ? -1 : 0, nz = wall === 'S' ? 1 : wall === 'N' ? -1 : 0;
            const el = (deg * Math.PI) / 180;
            return new THREE.Vector3(nx * Math.cos(el), Math.sin(el), nz * Math.cos(el)).normalize();
        };
        const focus = (mode = 'persp', instant = false) => {
            const wh = ui.wh && whRow(ui.wh);
            const b = (wh && whBoxes.get(wh.id)) || siteBox;
            if (!b) return;
            const target = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
            // 가운데는 범위 가운데 (한쪽이 비지 않게)
            const dir = mode === 'top' ? new THREE.Vector3(0, 1, 0.0015).normalize() : homeDir(wh ? 48 : 42);
            const p0 = camera.position.clone(), t0 = controls.target.clone();
            const d = fitDistance(dir, target, corners(b));
            camera.position.copy(p0);
            camera.lookAt(t0);
            zoom = null;
            flyTo(target.clone().addScaledVector(dir, d), target, instant);
        };

        // ---------- 라인 확대: 고른 라인만 화면에 차게, 옆(통로 쪽)에서 비스듬히 본다 ----------
        // 긴 변과 직각인 두 쪽 중 옆 라인과 더 떨어진(통로) 쪽에서 보고, 비슷하면 지금 카메라가 있는 쪽에서 본다
        // 옆 라인·벽과의 거리는 그 창고 기준 좌표(wx·wz)로 잰다 (창고가 돌아 앉았어도 라인은 창고 벽과 나란하다).
        // 창고 안에서 돌려 놓은 구획(비스듬한 벽의 랙)은 벽과 나란하지 않으므로 동 한가운데 쪽(안쪽)에서 본다
        const focusZone = (id) => {
            const b = zoneBoxes.get(id);
            if (!b) return;
            const alongX = b.sx >= b.sz;
            const half = (o) => (alongX ? o.sz : o.sx) / 2, mid = (o) => (alongX ? o.wz : o.wx);
            const gapOn = (sign) => {
                // 창고 벽까지 거리 (벽에 붙은 라인은 창고 안쪽에서 본다)
                const w = b.wall;
                let gap = sign > 0 ? (alongX ? w.maxZ : w.maxX) - mid(b) - half(b) : mid(b) - half(b) - (alongX ? w.minZ : w.minX);
                zoneBoxes.forEach((o, oid) => {
                    if (oid === id || o.warehouse !== b.warehouse || o.isTurned) return;
                    const overlap = alongX ? Math.min(o.wx + o.sx / 2, b.wx + b.sx / 2) - Math.max(o.wx - o.sx / 2, b.wx - b.sx / 2)
                        : Math.min(o.wz + o.sz / 2, b.wz + b.sz / 2) - Math.max(o.wz - o.sz / 2, b.wz - b.sz / 2);
                    const g = sign * (mid(o) - mid(b)) - half(o) - half(b);
                    if (overlap > 0.5 && g > -0.05) gap = Math.min(gap, g);
                });
                return Math.min(gap, 6);
            };
            // 구획 기준 좌표에서 그 점이 구획의 어느 쪽인지 (+1 / -1)
            const sideOf = (wx, wz) => { const p = b.frame.toLocal(wx, wz); return (alongX ? p.z - b.lz : p.x - b.lx) >= 0 ? 1 : -1; };
            let side = 0;
            if (b.isTurned) side = sideOf(b.whCenter.x, b.whCenter.z);
            else {
                const gapPlus = gapOn(1), gapMinus = gapOn(-1);
                side = Math.abs(gapPlus - gapMinus) < 0.3 ? sideOf(camera.position.x, camera.position.z) : gapPlus > gapMinus ? 1 : -1;
            }
            const el = (40 * Math.PI) / 180;
            const flat = b.frame.toWorldDir(alongX ? 0 : side * Math.cos(el), alongX ? side * Math.cos(el) : 0);
            const dir = new THREE.Vector3(flat.x, Math.sin(el), flat.z).normalize();
            // 둘레 여유: 보통 0.7m, 작은 구획(파렛트 한 칸)은 3.6m 폭이 보이게 넉넉히 — 너무 바짝 다가가지 않고 옆 칸도 보인다
            const m = Math.max(0.7, (3.6 - Math.max(b.sx, b.sz)) / 2);
            const fitPts = [];
            [b.lx - b.sx / 2 - m, b.lx + b.sx / 2 + m].forEach(x => [b.lz - b.sz / 2 - m, b.lz + b.sz / 2 + m].forEach(z => {
                const p = b.frame.toWorld(x, z);
                [b.baseY, b.baseY + b.sy + 0.9].forEach(y => fitPts.push(new THREE.Vector3(p.x, y, p.z)));
            }));
            const target = new THREE.Vector3(b.x, b.baseY + b.sy * 0.35, b.z);
            const p0 = camera.position.clone(), t0 = controls.target.clone();
            // 다른 라인을 확대한 채 이 라인을 고르면 돌아갈 시점은 처음 확대하기 전 그대로
            const back = isAtZoom() ? zoom.back : { pos: p0, target: t0 };
            const d = fitDistance(dir, target, fitPts);
            camera.position.copy(p0);
            camera.lookAt(t0);
            const pos = target.clone().addScaledVector(dir, d);
            zoom = { pos, target, back };
            flyTo(pos, target);
        };
        // 확대하기 전 시점으로 (확대한 뒤 사용자가 시점을 직접 바꿨으면 그대로 둔다)
        const unzoom = () => {
            const back = isAtZoom() ? zoom.back : null;
            zoom = null;
            if (back) flyTo(back.pos, back.target);
        };

        // 그리기 전에: 화면에서 13px보다 작게 보일 라인 번호표는 숨긴다 (멀리서 볼 때 점처럼 어지럽지 않게)
        const labelSpot = new THREE.Vector3();
        const render = () => {
            if (zoneLabels.length) {
                const H = renderer.domElement.clientHeight || 600, k = 2 * Math.tan((camera.fov * Math.PI) / 360);
                // 이름표는 창고 묶음 안에 있으므로 전체 좌표 위치로 거리를 잰다
                zoneLabels.forEach(sp => { sp.visible = sp.userData.always || (sp.scale.y / (camera.position.distanceTo(sp.getWorldPosition(labelSpot)) * k)) * H >= 13; });
            }
            renderer.render(scene, camera);
        };
        controls.addEventListener('change', render);
        // 끄는 동안처럼 이벤트가 잦을 때는 화면 한 번에 한 번만 그린다
        let renderQueued = 0;
        const renderSoon = () => {
            if (renderQueued) return;
            renderQueued = requestAnimationFrame(() => { renderQueued = 0; render(); });
        };

        const resize = () => {
            const w = host.clientWidth, h = host.clientHeight;
            if (!w || !h) return;
            renderer.setSize(w, h, false);
            renderer.domElement.style.width = '100%';
            renderer.domElement.style.height = '100%';
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            render();
        };
        const ro = new ResizeObserver(resize);
        ro.observe(host);

        // 클릭(끌기와 구분)·마우스 올림
        const el = renderer.domElement;
        const ray = new THREE.Raycaster();
        const ptr = new THREE.Vector2();
        const aim = (x, y) => {
            const r = el.getBoundingClientRect();
            ptr.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
            camera.updateMatrixWorld(); // 그리기와 상관없이 지금 시점으로 (WebGL이 끊긴 동안에는 그리기가 행렬을 맞춰 주지 않는다)
            ray.setFromCamera(ptr, camera);
            return r;
        };
        /**
         * 누른 자리의 구획·칸. 라인으로 확대한 채면 고른 라인의 칸이 앞의 흐린 라인보다 먼저 잡히고,
         * 시점을 직접 바꾼 뒤(멀리서 볼 때)에는 가장 가까운 구획이 고른 라인일 때만 칸을 잡는다
         */
        // whId = 구획이 아닌 곳을 눌렀을 때 그 자리의 동(바닥) — 동 밖이면 ''
        const whAt = () => ray.intersectObjects(whPickables, false)[0]?.object?.userData.whId || '';
        const pickAt = (x, y) => {
            aim(x, y);
            const zoneId = ray.intersectObjects(pickables, false)[0]?.object?.userData.zoneId || '';
            const cellHit = cellPickables.length && (zoneId === ui.selected || isAtZoom()) ? ray.intersectObjects(cellPickables, false)[0] : null;
            if (cellHit) return { zoneId: ui.selected, cell: cellHit.object.userData.cell, whId: '' };
            return { zoneId, cell: -1, whId: zoneId ? '' : whAt() };
        };
        const setHover = (id) => {
            if (id === hoverId) return;
            const prev = outlines.get(hoverId);
            if (prev && hoverId !== ui.selected && !hitIds.has(hoverId)) prev.visible = false;
            hoverId = id;
            const cur = outlines.get(id);
            if (cur) cur.visible = true;
            render();
        };
        const setHoverCell = (idx) => {
            if (idx === hoverCell) return;
            hoverCell = idx;
            const b = idx >= 0 ? cellBoxes[idx] : null;
            cellHoverMark.visible = !!b && idx !== ui.cell;
            if (b) placeBox(cellHoverMark, b, 0.06);
            render();
        };
        const tip = $('#w3-tip');
        const hideHover = () => { tip.classList.add('hidden'); setHover(''); setHoverCell(-1); };
        let down = null;
        // 고른 칸 위에서 누르면 시점 돌리기 대신 칸 끌기 — OrbitControls보다 먼저 받아(capture) 이번 누르기만 끈다
        const onDownCapture = (ev) => {
            if (ev.button > 0 || ev.target !== el || ui.cell === null || !canDrag()) return;
            if (pickAt(ev.clientX, ev.clientY).cell !== ui.cell) return;
            const source = cellSource();
            if (!source) return;
            controls.enabled = false;
            dnd.begin(ev, source);
        };
        const onDown = (ev) => { down = { x: ev.clientX, y: ev.clientY }; };
        const onUp = (ev) => {
            if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) { down = null; return; }
            down = null;
            onPick(pickAt(ev.clientX, ev.clientY));
        };
        const onMove = (ev) => {
            if (dnd.isDragging()) { hideHover(); return; }
            const { zoneId: id, cell, whId } = pickAt(ev.clientX, ev.clientY);
            const z = id ? zonesAll().find(r => r.id === id) : null;
            // 구획이 아닌 동 바닥: 라인을 고르지 않았을 때만 동 도움말 (고른 라인이 있으면 빈 곳 누르기 = 선택 풀기)
            const wh = !z && whId && !ui.selected ? whRow(whId) : null;
            const isGrabbable = !!z && cell >= 0 && cell === ui.cell && canDrag() && !!cellSource();
            el.style.cursor = z ? (isGrabbable ? 'move' : 'pointer') : wh && ui.wh !== wh.id ? 'pointer' : 'grab';
            setHover(z ? id : '');
            setHoverCell(z ? cell : -1);
            if (!z && !wh) { tip.classList.add('hidden'); return; }
            const r = el.getBoundingClientRect();
            if (z) {
                const s = summarize(zoneStock(z));
                const cap = zoneCapacity(z);
                tip.innerHTML = cell >= 0
                    ? `${cellTipHtml(z, cell)}${isGrabbable ? '<br><span class="text-blue-600">끌어서 옮기기</span>' : ''}`
                    : `<b>${esc(z.id)}</b> ${esc(z.name)}${cap ? ` · 적재 <b>${fmt(zonePallets(z))}/${cap}</b>` : ''}<br>${s.count ? Object.entries(s.byCat).map(([k, v]) => `${esc(k)} ${v}품목`).join(' · ') : '비어 있음'}`;
            } else tip.innerHTML = whTipHtml(wh);
            tip.style.left = `${Math.min(ev.clientX - r.left + 12, r.width - 190)}px`;
            tip.style.top = `${ev.clientY - r.top + 12}px`;
            tip.classList.remove('hidden');
        };
        host.addEventListener('pointerdown', onDownCapture, true);
        // 오래 가려 두어 WebGL이 끊겼다가 돌아오면 다시 그린다 (재질·모양을 새로 만들어 올림)
        el.addEventListener('webglcontextrestored', () => rebuild());
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerleave', hideHover);

        // ---------- 끌어서 옮기기: 놓을 라인 테두리 · 바닥을 따라다니는 파렛트 ----------
        const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const floorPoint = new THREE.Vector3();
        // 놓을 곳 테두리: 라인이면 그 라인, 라인이 없는 동이면 동 전체
        const setDropMark = (zoneId, ok, whId = '') => {
            const b = (zoneId ? zoneBoxes.get(zoneId) : null) || (whId ? whMarks.get(whId) : null) || null;
            dropMark.visible = !!b;
            if (b) { placeBox(dropMark, b, 0.3); dropMark.material.color.set(ok ? '#4ade80' : '#f87171'); }
        };
        /**
         * 끌어다 놓을 자리: 보이는 파렛트를 가리키면 그 칸(그 위에 쌓임), 아니면 바닥에서 가리킨 라인의 칸.
         * 바닥이 어느 라인도 아니면 광선이 지나는 가장 가까운 구획(칸은 정하지 않음), 그것도 없으면 라인이 없는 동(동 전체가 놓을 곳).
         * @returns {{ zoneId: string, slot: number, whId: string }} slot = 채우는 쪽에서 센 칸(0부터), 칸을 가리키지 않았으면 -1 ·
         *   whId = 구획 없이 동에 놓을 때 그 창고
         */
        const dropAt = (x, y) => {
            aim(x, y);
            const palletHit = ray.intersectObjects(palletPickables, false)[0] || null;
            // 바닥에서 가리킨 구획: 구획마다 그 구획 바닥 높이에서 광선이 지나는 점이 구획 안이면 후보,
            // 그중 카메라에 가장 가까운 것 (2층 바닥을 가리키면 그 아래 1층이 아니라 2층)
            const { origin, direction } = ray.ray;
            let floorHit = null;
            if (Math.abs(direction.y) > 1e-6) {
                for (const [id, g] of zoneBoxes) {
                    const reach = (g.baseY - origin.y) / direction.y;
                    if (reach <= 0 || (floorHit && reach >= floorHit.reach)) continue;
                    const q = g.frame.toLocal(origin.x + direction.x * reach, origin.z + direction.z * reach); // 구획 기준 좌표
                    if (Math.abs(q.x - g.lx) > g.sx / 2 || Math.abs(q.z - g.lz) > g.sz / 2) continue;
                    floorHit = { id, g, q, reach };
                }
            }
            // 파렛트가 바닥보다 앞에 있으면 그 파렛트의 칸 (위층 바닥 너머로 비쳐 보이는 아래층 파렛트는 위층 바닥이 먼저다)
            if (palletHit && (!floorHit || palletHit.distance <= floorHit.reach)) {
                const onPallet = palletHit.object.userData;
                const g = zoneBoxes.get(onPallet.dropZone);
                return { zoneId: onPallet.dropZone, slot: g?.cap && onPallet.dropCell >= 0 ? Math.floor(onPallet.dropCell / g.tiers) : -1, whId: '' };
            }
            if (floorHit) {
                const { id, g, q } = floorHit;
                if (!g.cap) return { zoneId: id, slot: -1, whId: '' };
                // 가리킨 바닥 자리: 긴 변 쪽으로 몇 번째 칸(col), 짧은 변 쪽으로 몇 번째 줄(lane)
                const along = g.alongX ? q.x - g.lx + g.sx / 2 : q.z - g.lz + g.sz / 2;
                const across = g.alongX ? q.z - g.lz + g.sz / 2 : q.x - g.lx + g.sx / 2;
                const col = Math.min(g.cols - 1, Math.max(0, Math.floor(along / g.step)));
                const lane = Math.min(g.lanes - 1, Math.max(0, Math.floor(across / g.laneW)));
                const pos = lane * g.cols + col;
                return { zoneId: id, slot: g.isFillFromEnd ? g.slots - 1 - pos : pos, whId: '' };
            }
            const zoneId = ray.intersectObjects(pickables, false)[0]?.object?.userData.zoneId || '';
            if (zoneId) return { zoneId, slot: -1, whId: '' };
            const whId = whAt();
            return { zoneId: '', slot: -1, whId: lineFreeWhs.has(whId) ? whId : '' };
        };
        // 끄는 동안 화면 가장자리에 닿을 때마다 한 단계씩 넓게 본다: 라인 확대 → 그 동 전체(칸이 잘 보이게 위에서 비스듬히) → 확대 전 시점.
        // 끌기 시작 때는 확대한 채로 둔다 — 같은 라인의 다른 칸이나 바로 옆 라인에 놓기 쉽게.
        const EDGE_PX = 40;
        let wideStep = 0;      // 0 = 라인 확대 그대로, 1 = 그 동 전체, 2 = 확대 전 시점
        let wideBack = null;   // 확대 전 시점 (2단계에서 돌아갈 곳)
        let wasOnEdge = null;  // 직전에 가장자리였는지 (null = 끌기 시작 직후, 아직 모름)
        const widenView = () => {
            if (wideStep === 0) {
                if (!isAtZoom()) return; // 사용자가 직접 맞춘 시점은 그대로 둔다
                wideBack = zoom.back;
                zoom = null;
                wideStep = 1;
                rebuild(); // 동·문 이름표를 다시 보이게
                const b = whBoxes.get(zonesAll().find(r => r.id === ui.selected)?.warehouse);
                if (b) {
                    const target = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
                    const dir = homeDir(66);
                    const p0 = camera.position.clone(), t0 = controls.target.clone();
                    const d = fitDistance(dir, target, corners(b));
                    camera.position.copy(p0);
                    camera.lookAt(t0);
                    flyTo(target.clone().addScaledVector(dir, d), target);
                    return;
                }
            }
            if (wideStep === 1 && wideBack) {
                flyTo(wideBack.pos, wideBack.target);
                wideBack = null;
                wideStep = 2;
            }
        };
        // 끄는 동안의 파렛트: 놓일 칸이 정해졌으면 그 칸에 붙고, 아니면 바닥을 따라다닌다
        const setGhost = (x, y, zoneId = '', cellIndex = -1) => {
            const r = aim(x, y);
            const isInside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
            const isOnEdge = isInside && (x - r.left < EDGE_PX || r.right - x < EDGE_PX || y - r.top < EDGE_PX || r.bottom - y < EDGE_PX);
            if (isOnEdge && wasOnEdge === false) widenView();
            wasOnEdge = isOnEdge;
            const g = zoneId ? zoneBoxes.get(zoneId) : null;
            const snap = g?.cap && cellIndex >= 0 ? g.cellBoxOf(cellIndex) : null;
            const hit = !snap && isInside ? ray.ray.intersectPlane(floor, floorPoint) : null;
            ghost.visible = !!(snap || hit);
            if (snap) placeBox(ghost, snap, 0.04);
            else if (hit) {
                const b = (ui.cell !== null && cellBoxes[ui.cell]) || { sx: 1.1, sy: 1.2, sz: 1.1 };
                placeBox(ghost, { ...b, x: hit.x, y: b.sy / 2 + 0.05, z: hit.z });
            }
            renderSoon();
        };
        // 끌기 시작: 다른 라인을 다시 또렷하게 그린다 (놓을 칸이 보이게). 시점은 그대로 둔다
        const beginDrag = () => { wideStep = 0; wideBack = null; wasOnEdge = null; hideHover(); rebuild(); };
        const endDrag = (wasDragging) => {
            controls.enabled = true;
            ghost.visible = false;
            dropMark.visible = false;
            if (wasDragging) rebuild(); else render();
        };

        // 화면을 떠나면 정리
        const watch = setInterval(() => { if (!host.isConnected) dispose(); }, 2000);
        let disposed = false;
        const dispose = () => {
            if (disposed) return;
            disposed = true;
            cancelAnimationFrame(anim);
            cancelAnimationFrame(renderQueued);
            clearInterval(watch);
            ro.disconnect();
            host.removeEventListener('pointerdown', onDownCapture, true);
            dnd.cancel();
            controls.dispose();
            disposables.splice(0).forEach(o => o.dispose?.());
            [unitBox, unitEdges, ghostMaterial, ...markMaterials].forEach(o => o.dispose());
            renderer.dispose();
            renderer.forceContextLoss?.();
            if (activeView === api) activeView = null;
        };
        const api = { rebuild, focus, focusZone, unzoom, dropAt, setDropMark, setGhost, beginDrag, endDrag, canvas: el, dispose };
        resize();
        rebuild();
        focus('persp', true);
        return api;
    };

    const redraw = () => { normalizeCell(); view?.rebuild(); renderSide(); renderChips(); renderDock(); renderSum(); };
    const redrawSelection = () => { view?.rebuild(); renderSide(); };

    // 구획 고르기: 고르면 그 라인으로 확대, 풀면 확대 전 시점으로
    const selectZone = (id) => {
        ui.selected = id || '';
        ui.cell = null;
        if (id) ui.dockLoc = '';
        redraw();
        if (ui.edit) return;
        if (id) view?.focusZone(id); else view?.unzoom();
    };
    // 동(창고) 고르기: 그 동만 또렷하게 보고 시점을 맞춘다 ('' = 공장 전체) — 위쪽 칩·3D의 동 바닥·오른쪽 적재 현황에서
    const selectWarehouse = (code) => {
        ui.wh = code || '';
        ui.selected = '';
        ui.cell = null;
        renderChips();
        redraw();
        view?.focus(ui.edit ? 'top' : 'persp');
    };
    // 3D에서 누른 자리 (구획·칸, 구획이 아니면 그 자리의 동)
    const onPick = ({ zoneId, cell, whId }) => {
        // 고른 라인이 없을 때 동 바닥을 누르면 그 동만 본다 (고른 라인이 있으면 빈 곳 누르기 = 선택 풀기)
        if (!zoneId && whId && whId !== ui.wh && (ui.edit || !ui.selected)) { selectWarehouse(whId); return; }
        if (ui.edit) { ui.selected = zoneId === ui.selected ? '' : zoneId; redrawSelection(); return; }
        if (!zoneId || zoneId !== ui.selected) { selectZone(zoneId); return; }
        if (cell >= 0) { if (ui.cell !== cell) { ui.cell = cell; redrawSelection(); } return; }
        if (ui.cell !== null) { ui.cell = null; redrawSelection(); return; }
        selectZone('');
    };

    // ---------- 끌어서 옮기기 ----------
    /**
     * 놓을 곳 정보. 칸이 있는 라인의 칸을 가리켰으면(slot) 그 칸의 가장 아래 빈 단(cellIndex)에 놓인다.
     * 같은 라인의 다른 칸이면 자리만 옮기고(재고·전표 변화 없음), 같은 칸이나 가득 찬 칸에는 놓을 수 없다.
     */
    const dropTargetOf = (loc, source, zoneId = '', slot = -1) => {
        const zone = zoneById(zoneId);
        const isSame = loc === source.fromLoc;
        const place = siteOf(loc) === siteOf(source.fromLoc) || !buildingOf(loc) ? shortLocation(loc) : `${siteOf(loc)} ${shortLocation(loc)}`;
        const target = { loc, zoneId, slot: -1, cellIndex: -1, label: place, ok: !isSame, note: isSame ? '같은 위치입니다' : '' };
        if (!zone || !zoneCapacity(zone) || slot < 0) return target;
        const { tiers } = zoneDims(zone);
        if (isSame && source.cell < 0) return target;
        if (isSame && Math.floor(source.cell / tiers) === slot) return { ...target, note: '같은 칸입니다' };
        const cellIndex = freeIndexInSlot(zone, zoneCellMap(zone).cells, slot);
        if (cellIndex < 0) return { ...target, ok: false, note: `${slotLabel(zone, slot)}은 가득 찼습니다 — 다른 칸에 놓으세요` };
        return { ...target, slot, cellIndex, ok: true, note: '', label: isSame ? `${cellLabel(zone, cellIndex)}(으)로 자리 옮기기` : `${place} · ${cellLabel(zone, cellIndex)}` };
    };
    // 놓을 곳: 창고 칸·구획 목록(data-drop-loc) 또는 3D의 라인(가리킨 칸), 라인이 없는 동은 동 전체(창고 단위 위치)
    const targetAt = (x, y, source) => {
        const at = document.elementFromPoint(x, y);
        if (!at) return null;
        const tile = at.closest('[data-drop-loc]');
        if (tile && root.contains(tile)) return dropTargetOf(tile.dataset.dropLoc, source, tile.dataset.zone || '');
        if (!view || at !== view.canvas) return null;
        const spot = view.dropAt(x, y);
        const z = zoneById(spot.zoneId);
        if (z) return dropTargetOf(zoneLocation(z), source, z.id, spot.slot);
        const wh = spot.whId ? whRow(spot.whId) : null;
        return wh ? { ...dropTargetOf(warehouseLocation(wh), source), whId: wh.id } : null;
    };
    // 같은 라인 안에서 파렛트 자리만 옮기기 (끝나면 그 라인으로 다시 확대하고 옮긴 칸을 고른 채 둔다)
    const rearrange = async (source, target) => {
        const zone = zoneById(target.zoneId);
        try {
            const index = await movePalletWithinZone(zone, source.cell, target.slot, source.codes[0]);
            showToast(`✅ ${zone.id}: ${cellLabel(zone, source.cell)} → ${cellLabel(zone, index)} 자리를 옮겼습니다`);
            ui.cell = index;
        } catch (e) {
            showToast(`⚠️ ${e.message}`);
        }
        redraw();
        if (ui.selected) view?.focusZone(ui.selected);
    };
    let litTile = null; // 끄는 동안 테두리를 켠 놓을 곳 (창고 칸·구획 목록)
    const lightTile = (target) => {
        const tile = target ? [...root.querySelectorAll('[data-drop-loc]')].find(t => t.dataset.dropLoc === target.loc) || null : null;
        if (tile === litTile) return;
        if (litTile) litTile.style.outline = '';
        litTile = tile;
        if (litTile) litTile.style.outline = `3px solid ${target.ok ? '#10b981' : '#ef4444'}`;
    };
    const dnd = createDragDrop({
        targetAt,
        onStart: () => { ui.dragging = true; view?.beginDrag(); },
        onMove: (target, x, y) => {
            view?.setDropMark(target?.zoneId || '', !!target?.ok, target?.whId || '');
            view?.setGhost(x, y, target?.ok ? target.zoneId : '', target?.ok ? target.cellIndex : -1);
            lightTile(target);
        },
        onDrop: (source, target) => {
            if (!target.ok) { showToast(target.note); return; }
            if (target.loc === source.fromLoc) { rearrange(source, target); return; }
            openMove({ codes: source.codes, fromLoc: source.fromLoc, toLoc: target.loc, fromCell: source.cell, toSlot: target.slot });
        },
        onEnd: (wasDragging) => { lightTile(null); ui.dragging = false; view?.endDrag(wasDragging); }
    });

    // ---------- 칩·안내 ----------
    const renderChips = () => {
        const chip = (val, label) => {
            const st = whStats(val), on = ui.wh === val;
            const sub = st.cap ? `${fmt(st.used)}/${fmt(st.cap)}` : st.items + st.loose ? `${st.items + st.loose}품목` : '';
            return `<button data-wh="${esc(val)}" class="px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 hover:bg-slate-50'}">${esc(label)}${sub ? `<span class="text-[11px] px-1.5 rounded-full ${on ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}">${sub}</span>` : ''}</button>`;
        };
        // 공장 고르기 (배치 편집 중에는 바꿀 수 없다 — 편집 중인 배치가 그 공장 것).
        // 버튼 자리(#w3-plants)는 제목(h2) 안에 둔다 — 제목 바로 아래 설명(h2 + p)을 스마트폰에서 숨기는 공통 규칙이 그대로 먹게
        $('#w3-plants').innerHTML = ZONE_PLANTS.map(p => `<button data-plant="${esc(p.id)}" ${ui.edit && p.id !== ui.plant ? 'disabled title="배치 편집을 끝낸 뒤 바꿀 수 있습니다"' : ''}
            class="px-3 py-1.5 text-sm font-bold ${p.id === ui.plant ? 'bg-slate-800 text-white' : `bg-white text-slate-600 ${ui.edit ? 'opacity-40' : 'hover:bg-slate-50'}`}">${esc(p.id)}</button>`).join('');
        $('#w3-chips').innerHTML = (ui.edit ? '' : chip('', `${ui.plant} 전체`)) + plantWarehouses().map(w => chip(w.code, w.label)).join('');
        $('#w3-banner').innerHTML = isUnsaved && !ui.edit
            ? `<div class="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">${esc(ui.plant)}은 아직 저장된 배치가 없어 <b>기본 배치</b>를 보여 줍니다. ${esc(plantInfo().defaultNote)} ${canEdit ? '[배치 편집]에서 실제 창고 크기·구획(라인)을 맞춘 뒤 저장하면 구획에 재고를 넣을 수 있습니다.' : '매니저가 배치를 저장하면 구획에 재고를 넣을 수 있습니다.'}</div>`
            : ui.edit ? '<div class="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg px-3 py-2">배치 편집 중: 창고를 고르고 오른쪽 표에서 크기·위치(m)를 고치면 3D에 바로 보입니다. 구획의 위치 x·z는 창고 왼쪽 위 모서리 기준입니다. [저장]을 눌러야 반영됩니다.</div>' : '';
    };

    // ---------- 다른 거점·창고 (끌어다 놓을 곳 · 누르면 그 창고 재고) ----------
    // 거점의 모든 창고 단위 위치를 칸으로 보여 준다: 3D 배치가 없는 창고(본사 등), 다른 공장의 창고, 라인이 있는 창고의 구획 미지정 위치.
    const dockSites = () => sitesOf(state.locations || []);
    const dockLocations = (site) => normalizeLocationList(state.locations || []).filter(loc => siteOf(loc) === site && !isZoneLocation(loc));
    const renderDock = () => {
        const host = $('#w3-dock');
        if (!host) return;
        if (ui.edit) { host.innerHTML = ''; return; }
        const sites = dockSites();
        if (!sites.includes(ui.dockSite)) ui.dockSite = sites.find(s => s !== ZONE_SITE) || sites[0] || '';
        const counts = new Map();
        (state.inventory || []).forEach(i => { if (Number(i.quantity) !== 0) counts.set(i.location, (counts.get(i.location) || 0) + 1); });
        // 창고를 정하지 않은 거점 위치는 재고가 있을 때만 (꺼내 옮길 수 있게)
        const locs = dockLocations(ui.dockSite).filter(loc => buildingOf(loc) || counts.get(loc));
        const groups = [];
        locs.forEach(loc => {
            const camp = campOf(loc) || (buildingOf(loc) ? '기타 창고' : '');
            const g = groups.find(x => x.camp === camp) || groups[groups.push({ camp, locs: [] }) - 1];
            g.locs.push(loc);
        });
        const tile = (loc) => {
            const code = buildingOf(loc), on = ui.dockLoc === loc, n = counts.get(loc) || 0;
            // 구획(라인)이 있는 창고의 창고 단위 위치 = 구획을 정하지 않은 재고
            const hasZones = rows.some(r => r.kind === 'ZONE' && r.warehouse === code);
            const desc = !code ? '거점만 적힌 재고' : hasZones ? '구획 미지정' : (warehouseDesc(code) || '');
            // 스마트폰은 한 줄(코드 + 품목 수)로 줄여 3D 화면이 밀려 내려가지 않게 한다
            return `<button data-dock="${esc(loc)}" data-drop-loc="${esc(loc)}" title="${esc(desc)}" class="text-left px-2.5 py-1 sm:py-1.5 rounded-lg border text-xs leading-tight ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 hover:bg-slate-50'}">
                <b>${esc(code || '창고 미지정')}</b><span class="sm:hidden ml-1 text-[11px] ${on ? 'text-white/80' : 'text-slate-500'}">${n}</span>
                <span class="hidden sm:block text-[11px] ${on ? 'text-white/80' : 'text-slate-500'}">${esc(desc)}${desc ? ' · ' : ''}${n}품목</span></button>`;
        };
        host.innerHTML = `<div class="bg-white border rounded-xl p-2 space-y-1.5">
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-bold text-slate-700 flex items-center gap-1"><i data-lucide="arrow-left-right" class="w-4 h-4 text-blue-600"></i>다른 거점·창고</span>
                <div class="inline-flex rounded-lg border overflow-hidden">${sites.map(s => `<button data-dock-site="${esc(s)}" class="px-3 py-1 text-xs font-bold ${s === ui.dockSite ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}">${esc(s)}</button>`).join('')}</div>
                <span class="hidden sm:inline text-[11px] text-slate-500">${canDrag() ? '칸이나 품목을 끌어다 창고 위에 놓으면 그 창고로 옮깁니다 · ' : ''}창고를 누르면 그 창고 재고가 오른쪽에 나옵니다</span>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">${groups.map(g => `${g.camp ? `<span class="text-[11px] font-bold text-slate-400 pl-1">${esc(g.camp)}</span>` : ''}${g.locs.map(tile).join('')}`).join('') || '<span class="text-xs text-slate-400">창고가 없습니다.</span>'}</div>
        </div>`;
        refreshIcons();
    };

    // ---------- 오른쪽 ----------
    const GRIP = '<span class="w3-grip inline-flex items-center justify-center w-6 h-6 -ml-1.5 align-middle cursor-grab text-slate-400" style="touch-action:none" title="끌어서 옮기기"><i data-lucide="grip-vertical" class="w-4 h-4"></i></span>';
    // showLoc = 품목 아래에 창고 이름, hotCode = 고른 칸의 품목(강조). 끌 수 있으면 줄에 data-drag-*를 단다(마우스는 줄 어디서나, 터치는 줄 앞 손잡이)
    const stockTable = (items, { zone = null, moveBtn = false, showLoc = !zone, moveLabel = '옮기기', hotCode = '' } = {}) => items.length ? `
        <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-500"><tr><th class="p-1.5 text-left">품목</th><th class="p-1.5 text-right">재고</th></tr></thead><tbody>
        ${items.map(i => `<tr class="border-t align-top ${hotCode === i.code ? 'bg-sky-50' : ''} ${canDrag() ? 'select-none cursor-grab' : ''}" ${canDrag() ? `data-drag-code="${esc(i.code)}" data-drag-from="${esc(i.location)}" data-drag-name="${esc(i.name)}"` : ''}>
            <td class="p-1.5">${canDrag() ? GRIP : ''}<span class="inline-block w-2 h-2 rounded-sm mr-1" style="background:${catColor(i.category)}"></span><b>${esc(i.name)}</b><div class="text-slate-400">${esc(i.code)} · ${esc(i.category || '')}${showLoc ? ` · ${esc(buildingOf(i.location) || '창고 미지정')}` : ''}</div>
            ${moveBtn ? `<button data-move="${esc(i.code)}" data-from="${esc(i.location)}" class="mt-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 text-[11px] font-bold">${esc(moveLabel)}</button>` : ''}</td>
            <td class="p-1.5 text-right whitespace-nowrap font-bold">${fmt(i.quantity)} <span class="text-slate-400 font-normal">${esc(i.unit || '')}</span>
                ${zone && zoneCapacity(zone) ? `<div class="font-normal text-slate-500 mt-0.5">${canMove && !isDefault ? `<input type="number" min="0" step="1" value="${itemPallets(zone, i.code)}" data-pallets="${esc(i.code)}" class="w-12 border rounded px-1 py-0.5 text-right" title="이 품목이 차지하는 파렛트 수">` : fmt(itemPallets(zone, i.code))} 파렛트</div>` : ''}</td></tr>`).join('')}
        </tbody></table>` : '<p class="text-xs text-slate-400 py-2">재고가 없습니다.</p>';

    // 방금 옮긴 내역 (전표 번호를 누르면 전표 보기·인쇄)
    const movesHtml = () => (ui.moves.length ? `<div class="border border-emerald-200 bg-emerald-50 rounded-lg p-2 text-xs space-y-1">
        <div class="font-bold text-emerald-800">방금 옮긴 내역</div>
        ${ui.moves.map(m => `<div class="flex items-start justify-between gap-2"><span class="text-emerald-900">${esc(m.text)}</span>${m.docNo
            ? `<button data-slip="${esc(m.docNo)}" class="shrink-0 px-2 py-0.5 rounded bg-white border border-emerald-300 text-emerald-800 font-bold whitespace-nowrap" title="전표 보기·인쇄">${esc(m.docNo)}</button>`
            : '<span class="shrink-0 text-emerald-700">전표 없음</span>'}</div>`).join('')}</div>` : '');

    // 고른 칸에 무엇이 있는지
    const cellCardHtml = (zone) => {
        if (ui.cell === null) return canDrag() && zoneStock(zone).length ? '<p class="text-[11px] text-slate-500">3D에서 이 라인의 칸(파렛트)을 누르면 그 칸에 무엇이 있는지 보이고, 고른 칸을 끌어서 다른 칸·라인·창고로 옮길 수 있습니다.</p>' : '';
        const info = cellInfo(zone, ui.cell);
        const one = info.items.length === 1 ? info.items[0] : null;
        const perPallet = one && info.n > 1 ? Number(one.quantity) / info.n : 0;
        const body = !info.items.length
            ? '<div class="text-slate-500">비어 있는 칸입니다. 다른 칸이나 품목을 끌어다 이 칸에 놓을 수 있습니다.</div>'
            : one
                ? `<div><span class="inline-block w-2 h-2 rounded-sm mr-1" style="background:${catColor(one.category)}"></span><b>${esc(one.name)}</b> <span class="text-slate-400 text-xs">${esc(one.code)} · ${esc(one.category || '')}</span></div>
                   <div class="text-xs text-slate-600">이 라인 재고 <b>${fmt(one.quantity)} ${esc(one.unit || '')}</b>${info.n > 1 ? ` · 파렛트 ${info.n}개 중 ${info.k + 1}번째 (파렛트당 약 ${fmt(perPallet)} ${esc(one.unit || '')})` : ''}</div>
                   ${info.overflow ? `<div class="text-xs text-red-600">칸이 모자라 ${info.overflow}파렛트는 그리지 못했습니다 — 아래 목록에서 확인하세요.</div>` : ''}`
                : `<div class="text-xs text-slate-600">칸을 나누지 않은 구획이라 보관 품목 ${info.items.length}개가 한 덩어리로 보입니다. 끌어다 놓은 뒤 옮길 품목을 고릅니다.</div>`;
        const action = info.items.length && canDrag()
            ? `<div class="flex flex-wrap items-center gap-2 mt-1"><button id="w3-cell-move" class="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold">옮기기…</button><span class="text-[11px] text-slate-500">또는 3D에서 이 칸을 끌어 다른 칸·라인·창고에 놓으세요</span></div>` : '';
        return `<div class="border-2 border-sky-300 bg-sky-50 rounded-lg p-2 text-sm space-y-1">
            <div class="flex items-center justify-between"><b class="text-sky-900">고른 칸 · ${esc(info.label)}</b><button id="w3-cell-close" class="text-slate-400 hover:text-slate-700 px-1" title="칸 선택 풀기">✕</button></div>
            ${body}${action}</div>`;
    };

    const renderSide = () => {
        const side = $('#w3-side');
        if (ui.edit) { side.innerHTML = editorHtml(); return; }
        const hits = searchHits();
        const sel = ui.selected && zonesAll().find(r => r.id === ui.selected);
        if (sel) {
            const items = zoneStock(sel);
            const cellItems = ui.cell === null ? [] : cellInfo(sel, ui.cell).items;
            side.innerHTML = `
                ${movesHtml()}
                <div class="flex items-start justify-between gap-2">
                    <div><div class="text-xs text-slate-400">${esc(locationLabel(zoneLocation(sel)))}</div><div class="text-lg font-bold">${esc(sel.id)} <span class="text-slate-500 font-normal">${esc(sel.name)}</span></div>
                    <div class="text-xs text-slate-500">${esc(ZONE_TYPES[sel.zoneType] || '')} · ${fmt(sel.w)}×${fmt(sel.d)}m, 높이 ${fmt(sel.h)}m${zoneBaseY(sel) ? ` · 바닥 높이 ${fmt(zoneBaseY(sel))}m` : ''}</div></div>
                    <button id="w3-close" class="p-1 text-slate-400 hover:text-slate-700" title="닫기"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>
                <div class="flex flex-wrap gap-2">
                    ${canMove && !isDefault ? '<button id="w3-put" class="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white">이 구획에 재고 넣기</button>' : ''}
                    <button id="w3-audit" class="px-3 py-1.5 text-xs rounded-lg border">이 구획 재고실사</button>
                    <button id="w3-zone-qr" class="px-3 py-1.5 text-xs rounded-lg border">위치 QR</button>
                </div>
                <div id="w3-qr-box"></div>
                ${zoneCapacity(sel) ? (() => {
                    const cap = zoneCapacity(sel), used = zonePallets(sel), pct = Math.min(100, (used / cap) * 100);
                    return `<div class="border rounded-lg p-2">
                        <div class="flex justify-between text-sm"><b>적재 파렛트</b><span class="${used > cap ? 'text-red-600 font-bold' : ''}">${fmt(used)} / ${cap}칸 ${used > cap ? '(초과)' : `· 빈 칸 ${fmt(cap - used)}`}</span></div>
                        <div class="h-2 bg-slate-100 rounded-full mt-1 overflow-hidden"><div class="h-2 ${used > cap ? 'bg-red-500' : 'bg-blue-500'}" style="width:${pct}%"></div></div>
                        <div class="text-[11px] text-slate-500 mt-1">한 줄 ${sel.slots}칸${zoneDims(sel).lanes > 1 ? ` × ${zoneDims(sel).lanes}줄` : ''} × ${sel.tiers || 1}단. 끌어다 놓은 칸 위치가 저장됩니다. 칸을 정하지 않은 파렛트는 ${sel.fillFrom === 'END' ? '안쪽(반대쪽 끝)' : '줄 시작 쪽'} 1번 칸부터 빈 칸에 차례로 놓입니다.</div></div>`;
                })() : ''}
                ${cellCardHtml(sel)}
                <div class="text-sm font-bold">보관 품목 ${items.length}개</div>
                ${stockTable(items, { zone: sel, moveBtn: canMove && !isDefault, hotCode: cellItems.length === 1 ? cellItems[0].code : '' })}`;
        } else if (ui.dockLoc) {
            // [다른 거점·창고]에서 고른 창고의 재고 (끌어서 3D 라인·다른 창고로)
            const all = stockAt(ui.dockLoc);
            const q = norm(ui.unFilter);
            const items = all.filter(i => !q || norm(i.code).includes(q) || norm(i.name).includes(q));
            const code = buildingOf(ui.dockLoc);
            side.innerHTML = `
                ${movesHtml()}
                <div class="flex items-start justify-between gap-2">
                    <div><div class="text-xs text-slate-400">${esc(siteOf(ui.dockLoc))}${campOf(ui.dockLoc) ? ` › ${esc(campOf(ui.dockLoc))}` : ''}</div>
                    <div class="text-lg font-bold">${esc(code || '창고 미지정')} <span class="text-slate-500 font-normal text-sm">${esc(code ? warehouseDesc(code) : '거점만 적힌 재고')}</span></div></div>
                    <button id="w3-dock-close" class="p-1 text-slate-400 hover:text-slate-700" title="닫기"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>
                ${canDrag() ? '<p class="text-[11px] text-slate-500">품목을 끌어서 3D의 라인이나 위쪽 다른 창고에 놓으면 옮깁니다(스마트폰은 줄 앞 손잡이). [옮기기]를 눌러도 됩니다.</p>' : ''}
                <div class="text-sm font-bold">보관 품목 ${all.length}개</div>
                <input id="w3-un-filter" value="${esc(ui.unFilter)}" placeholder="이 창고 재고에서 찾기" class="border rounded-lg px-2 py-1 text-xs w-full">
                ${stockTable(items.slice(0, 200), { moveBtn: canMove && !isDefault, showLoc: false })}
                ${items.length > 200 ? '<p class="text-[11px] text-slate-400">처음 200개만 보입니다. 위 칸으로 찾으세요.</p>' : ''}`;
        } else {
            const un = unassignedStock(ui.wh, ui.plant).filter(i => !ui.unFilter || norm(i.code).includes(norm(ui.unFilter)) || norm(i.name).includes(norm(ui.unFilter)));
            const hitRows = hits ? [...hits.entries()] : [];
            const zoneList = zonesOf(ui.wh);
            side.innerHTML = `
                ${movesHtml()}
                ${hits ? `<div><div class="text-sm font-bold mb-1">'${esc(ui.search)}' 위치 ${hitRows.length}곳</div>
                    ${hitRows.length ? hitRows.map(([id, items]) => `<button data-zone="${esc(id)}" data-drop-loc="${esc(zoneLocation(zoneById(id)))}" class="w-full text-left border rounded-lg p-2 mb-1 hover:bg-yellow-50"><b>${esc(id)}</b> ${esc(zonesAll().find(r => r.id === id)?.name || '')}<div class="text-xs text-slate-500">${items.map(i => `${esc(i.name)} ${fmt(i.quantity)}${esc(i.unit || '')}`).join(', ')}</div></button>`).join('') : '<p class="text-xs text-slate-400">구획에 들어 있는 재고가 없습니다. 아래 구획 미지정 재고를 확인하세요.</p>'}</div>` : ''}
                <div class="border rounded-lg p-2 space-y-1.5">
                    <div class="text-sm font-bold">적재 현황</div>
                    ${plantWarehouses().filter(w => !ui.wh || w.code === ui.wh).map(w => {
                        const st = whStats(w.code), pct = st.cap ? Math.min(100, (st.used / st.cap) * 100) : 0;
                        return `<button data-wh="${esc(w.code)}" class="w-full text-left hover:bg-slate-50 rounded px-1 py-0.5">
                            <div class="flex justify-between text-xs"><b>${esc(w.label)}</b><span class="${st.used > st.cap && st.cap ? 'text-red-600 font-bold' : 'text-slate-500'}">${st.cap ? `${fmt(st.used)}/${fmt(st.cap)} 파렛트 · ${pctText(st.used, st.cap)}` : `구획 ${st.zones}곳 · ${st.items + st.loose}품목`}</span></div>
                            ${st.cap ? `<div class="h-1.5 bg-slate-100 rounded-full mt-0.5 overflow-hidden"><div class="h-1.5 ${st.used > st.cap ? 'bg-red-500' : 'bg-blue-500'}" style="width:${pct}%"></div></div>` : ''}</button>`;
                    }).join('')}
                </div>
                <div><div class="text-sm font-bold mb-1">구획 ${zoneList.length}곳 <span class="text-[11px] font-normal text-slate-400">${zoneList.length ? '누르면 3D에서 표시' : ''}</span></div>
                ${zoneList.length ? '' : `<p class="text-[11px] text-slate-500 border border-dashed rounded-lg p-2">${esc(ui.wh || ui.plant)}에는 아직 구획(라인)이 없습니다. ${canEdit ? '<b>[배치 편집]</b> → <b>+ 구획 추가</b>로 라인을 놓고 저장하면 그 라인에 재고를 넣을 수 있습니다. ' : '매니저가 배치 편집으로 라인을 넣을 수 있습니다. '}라인이 없는 동은 3D의 동 바닥이나 위쪽 [다른 거점·창고]의 창고 칸에 끌어다 놓아 창고 단위로 옮깁니다.</p>`}
                <div class="grid grid-cols-2 gap-1">${zoneList.map(z => {
                    const s = summarize(zoneStock(z)), cap = zoneCapacity(z), used = cap ? zonePallets(z) : 0;
                    return `<button data-zone="${esc(z.id)}" data-drop-loc="${esc(zoneLocation(z))}" class="text-left border rounded-lg p-2 hover:bg-slate-50">
                        <div class="text-xs font-bold flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background:${s.count ? catColor(s.top) : EMPTY_COLOR}"></span>${esc(z.id)}
                            <span class="ml-auto font-normal ${cap && used > cap ? 'text-red-600' : 'text-slate-500'}">${cap ? `${fmt(used)}/${cap}` : ''}</span></div>
                        <div class="text-[11px] text-slate-500">${esc(z.name)} · ${s.count ? `${s.count}품목` : '비어 있음'}</div>
                        ${cap ? `<div class="h-1 bg-slate-100 rounded-full mt-1 overflow-hidden"><div class="h-1 ${used > cap ? 'bg-red-500' : 'bg-blue-500'}" style="width:${Math.min(100, (used / cap) * 100)}%"></div></div>` : ''}</button>`;
                }).join('')}</div></div>
                <div><div class="flex items-center justify-between mb-1"><div class="text-sm font-bold">구획 미지정 재고 <span class="text-slate-400 font-normal">${un.length}품목</span></div></div>
                <p class="text-[11px] text-slate-500 mb-1">${esc(ZONE_SITE)}(창고 미지정)·${esc(ui.wh || plantWarehouses().map(w => w.code).join('·'))} 창고 단위로 적힌 재고입니다. [구획 지정]을 누르거나 품목을 3D의 라인에 끌어다 놓아 구획에 옮기세요${isDefault ? ' (배치 저장 후 가능)' : ''}.</p>
                <input id="w3-un-filter" value="${esc(ui.unFilter)}" placeholder="미지정 재고에서 찾기" class="border rounded-lg px-2 py-1 text-xs w-full mb-1">
                ${stockTable(un.slice(0, 200), { moveBtn: canMove && !isDefault, moveLabel: '구획 지정' })}
                ${un.length > 200 ? `<p class="text-[11px] text-slate-400">처음 200개만 보입니다. 위 칸으로 찾으세요.</p>` : ''}</div>`;
        }
        refreshIcons();
    };
    const refreshIcons = () => import('../services/icons.js').then(({ createIcons, icons }) => createIcons({ icons })).catch(e => console.warn(e));

    // ---------- 옮기기 창 (구획 지정 · 칸·품목 끌어 놓기 · [옮기기]) ----------
    // 옮긴 뒤: 방금 옮긴 내역에 남기고, 받은 곳이 라인이면 그 라인으로 확대해 옮겨진 칸을 고른 채 보여 준다.
    // 다른 창고의 재고 목록에서 옮기는 중(dockLoc)이면 이어서 옮길 수 있게 그 목록에 머문다.
    const afterMove = (r) => {
        ui.moves = [{ text: moveResultText(r), docNo: r.slip?.docNo || '' }, ...ui.moves].slice(0, 5);
        showToast(`✅ ${moveResultText(r)}${r.slip ? ` · 창고간 이동전표 ${r.slip.docNo} 발행` : ''}${r.offline ? ' (오프라인 — 연결되면 반영)' : ''}`);
        r.warnings.forEach(w => showToast(`⚠️ ${w}`));
        ui.cell = null;
        const toZone = zoneById(zoneIdOfLocation(r.toLoc));
        if (toZone && !ui.dockLoc) {
            selectZone(toZone.id);
            // 옮겨 놓인 칸 (칸이 없는 구획은 덩어리 하나, 놓인 칸을 모르면 그 품목의 마지막 파렛트 칸)
            const cellIndex = !zoneCapacity(toZone) ? 0 : r.placed.length ? r.placed[0] : zoneCellMap(toZone).cells.map(c => c?.code).lastIndexOf(r.code);
            if (cellIndex >= 0) { ui.cell = cellIndex; redrawSelection(); }
            return;
        }
        redraw();
        if (ui.selected) view?.focusZone(ui.selected);
    };
    // fromCell = 끌어 온 칸 번호, toSlot = 놓은 칸 (없으면 -1 — 옮기기 창에서 고른다)
    // zones = 모든 공장의 구획 (옮기기 창에서 다른 공장의 라인을 도착지로 고를 수도 있다)
    const openMove = ({ codes, fromLoc, toLoc = '', fromCell = -1, toSlot = -1 }) => openMoveDialog($('#w3-modal'), {
        codes, fromLoc, toLoc, fromCell, toSlot, zones: rows.filter(r => r.kind === 'ZONE'), showToast, onDone: afterMove
    });

    // 선택 구획에 넣을 미지정 재고 고르기
    const openPut = (zone) => {
        const m = $('#w3-modal');
        const list = () => {
            const q = norm(m.querySelector('#w3-p-q')?.value || '');
            return unassignedStock('', ui.plant).filter(i => !q || norm(i.code).includes(q) || norm(i.name).includes(q)).slice(0, 100);
        };
        m.innerHTML = `<div class="bg-white rounded-xl w-full max-w-lg p-4 space-y-3 max-h-[85vh] flex flex-col">
            <div class="font-bold">${esc(zone.id)} ${esc(zone.name)}에 넣을 재고</div>
            <input id="w3-p-q" placeholder="품목코드·품명" class="border rounded-lg px-2 py-2 text-sm">
            <div id="w3-p-list" class="overflow-y-auto flex-1"></div>
            <div class="flex justify-end"><button id="w3-p-close" class="px-3 py-2 text-sm border rounded-lg">닫기</button></div></div>`;
        m.classList.remove('hidden');
        const draw = () => {
            const items = list();
            m.querySelector('#w3-p-list').innerHTML = items.length ? items.map(i => `<button data-pick="${esc(i.code)}" data-from="${esc(i.location)}" class="w-full text-left border-b p-2 hover:bg-blue-50 text-sm"><b>${esc(i.name)}</b> <span class="text-slate-400 text-xs">${esc(i.code)} · ${esc(buildingOf(i.location) || '창고 미지정')}</span><span class="float-right font-bold">${fmt(i.quantity)} ${esc(i.unit || '')}</span></button>`).join('') : '<p class="text-sm text-slate-400 p-2">구획 미지정 재고가 없습니다.</p>';
        };
        draw();
        m.querySelector('#w3-p-q').oninput = draw;
        m.querySelector('#w3-p-close').onclick = () => { m.classList.add('hidden'); m.innerHTML = ''; };
        m.querySelector('#w3-p-list').onclick = (ev) => {
            const b = ev.target.closest('[data-pick]');
            if (b) openMove({ codes: [b.dataset.pick], fromLoc: b.dataset.from, toLoc: zoneLocation(zone) });
        };
    };

    // ---------- 배치 편집 ----------
    const numInput = (field, v, id) => `<input data-f="${field}" data-id="${esc(id)}" type="number" step="0.5" value="${Number(v)}" class="w-14 border rounded px-1 py-0.5 text-xs text-right">`;
    const editorHtml = () => {
        const wh = whRow(ui.wh);
        if (!wh) return '<p class="text-sm text-slate-500">위에서 창고를 고르세요.</p>';
        const zs = zonesOf(ui.wh);
        return `
            <div class="flex items-center justify-between"><div class="font-bold">${esc(wh.id)} 배치 편집</div>
                <div class="flex gap-1"><button id="w3-e-cancel" class="px-3 py-1.5 text-xs border rounded-lg">취소</button><button id="w3-e-save" class="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white">저장</button></div></div>
            <div class="border rounded-lg p-2 text-xs space-y-1">
                <div class="font-bold text-slate-600">창고</div>
                <div class="flex flex-wrap gap-2 items-center">이름 <input data-f="name" data-id="${esc(wh.id)}" value="${esc(wh.name)}" class="w-24 border rounded px-1 py-0.5">
                위치 x ${numInput('x', wh.x, wh.id)} z ${numInput('z', wh.z, wh.id)}</div>
                <div class="flex flex-wrap gap-2 items-center">가로 ${numInput('w', wh.w, wh.id)} 세로 ${numInput('d', wh.d, wh.id)} 벽 높이 ${numInput('h', wh.h, wh.id)} m
                <span title="창고 왼쪽 위 모서리를 축으로 시계 방향 (위에서 볼 때)">회전 ${numInput('rot', wh.rot || 0, wh.id)}°</span></div>
                ${hasOutline(wh) ? `<div class="text-[11px] text-slate-500">바닥이 사각형이 아닌 <b>도면 외곽선</b>(${warehouseOutline(wh).length}점)입니다. 가로·세로를 바꾸면 외곽선도 같은 비율로 늘어납니다.
                    <button id="w3-e-rect" class="ml-1 px-1.5 py-0.5 border rounded text-slate-600 hover:bg-slate-50" title="외곽선을 지우고 가로 × 세로 사각형으로">사각형으로</button></div>` : ''}
            </div>
            <div class="flex items-center justify-between"><div class="text-sm font-bold">구획 ${zs.length}곳</div><button id="w3-e-add" class="px-2 py-1 text-xs rounded bg-slate-800 text-white">+ 구획 추가</button></div>
            <table class="w-full text-xs"><thead class="text-slate-500"><tr><th class="text-left">코드·이름·종류</th><th>x</th><th>z</th><th>가로</th><th>세로</th><th>높이</th><th title="한 줄 파렛트 칸 수 × 줄 수, 아래 칸이 단 수 (칸이 0이면 칸 없음)">칸×줄 · 단</th><th></th></tr></thead><tbody>
            ${zs.map(z => `<tr class="border-t align-top"><td class="py-1 pr-1"><div class="font-bold">${esc(z.id)}</div><input data-f="name" data-id="${esc(z.id)}" value="${esc(z.name)}" class="w-24 border rounded px-1 py-0.5 mt-0.5">
                <select data-f="zoneType" data-id="${esc(z.id)}" class="border rounded px-1 py-0.5 mt-0.5">${Object.entries(ZONE_TYPES).map(([k, v]) => `<option value="${k}" ${z.zoneType === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
                <td class="py-1">${numInput('x', z.x, z.id)}</td><td class="py-1">${numInput('z', z.z, z.id)}</td><td class="py-1">${numInput('w', z.w, z.id)}</td><td class="py-1">${numInput('d', z.d, z.id)}</td><td class="py-1">${numInput('h', z.h, z.id)}</td>
                <td class="py-1 whitespace-nowrap">${numInput('slots', z.slots || 0, z.id)}×${numInput('lanes', z.lanes || 1, z.id)}<div class="mt-0.5">${numInput('tiers', z.tiers || 1, z.id)}단</div>
                    <select data-f="fillFrom" data-id="${esc(z.id)}" class="border rounded px-1 py-0.5 mt-0.5 block" title="파렛트를 채우기 시작하는 쪽"><option value="START" ${z.fillFrom !== 'END' ? 'selected' : ''}>시작 쪽부터</option><option value="END" ${z.fillFrom === 'END' ? 'selected' : ''}>반대쪽부터</option></select></td>
                <td class="py-1"><button data-del="${esc(z.id)}" class="text-red-500 px-1" title="구획 삭제">✕</button></td></tr>
                <tr><td colspan="8" class="pb-1.5 text-slate-500 whitespace-nowrap">
                    <span title="구획의 (x, z) 모서리를 축으로 시계 방향(도) — 비스듬한 벽을 따라 놓을 때">회전 ${numInput('rot', z.rot || 0, z.id)}°</span>
                    <span class="ml-2" title="구획 바닥 높이(m) — 2층처럼 위에 있는 구획이면 그 바닥 높이, 창고 바닥이면 0">바닥 높이 ${numInput('y', z.y || 0, z.id)}m</span></td></tr>`).join('')}
            </tbody></table>
            <p class="text-[11px] text-slate-500">재고가 남은 구획은 지울 수 없습니다. 구획코드는 저장 뒤 재고 위치 이름이 되므로 번호를 바꾸지 않습니다. 회전·바닥 높이는 대부분 0입니다(비스듬한 벽의 랙, 2층 구역에만 씁니다).</p>`;
    };

    // 배치 줄 사본 (외곽선 점까지 따로 — 편집 중인 값이 저장된 배치를 건드리지 않게)
    const copyRow = (r) => ({ ...r, outline: hasOutline(r) ? warehouseOutline(r).map(p => [...p]) : [] });
    // 배치 편집은 보고 있는 공장만 (다른 공장의 배치는 건드리지 않는다)
    const startEdit = () => {
        ui.draft = rows.filter(isInPlant).map(copyRow);
        ui.edit = true;
        ui.wh = ui.wh || plantWarehouses()[0].code;
        ui.selected = '';
        ui.cell = null;
        ui.dockLoc = '';
        $('#w3-edit').textContent = '편집 끝내기';
        renderChips();
        redraw();
        view?.focus('top');
    };
    const stopEdit = () => {
        ui.edit = false;
        ui.draft = null;
        if ($('#w3-edit')) $('#w3-edit').textContent = '배치 편집';
        renderChips();
        redraw();
    };

    // ---------- 평면도 편집기 (레이어로 나눠 보고 끌어서 고치기 — warehouse3d/planEditor.js) ----------
    let hasPlanSaved = false; // 편집기에서 저장했는지 (닫을 때 3D 시점을 새 배치에 맞춘다)
    planHooks = {
        // 저장한 배치·주변 표시를 다시 받아 3D·목록에 반영한다
        onSaved: async () => {
            if (!root.isConnected) return;
            const res = await loadZones();
            rows = res.rows;
            defaultPlants = new Set(res.defaultPlants);
            if (!zoneById(ui.selected)) { ui.selected = ''; ui.cell = null; }
            hasPlanSaved = true;
            syncDefault();
            renderChips();
            redraw();
        },
        onClose: () => {
            if (!root.isConnected || !hasPlanSaved) return;
            hasPlanSaved = false;
            view?.focus('persp', true);
        }
    };
    const openPlan = async () => {
        if (activePlan) return;
        if (ui.edit) { showToast('표로 하는 배치 편집을 끝낸(저장 또는 취소) 뒤에 평면도를 여세요.'); return; }
        try {
            const { openPlanEditor } = await import('./warehouse3d/planEditor.js');
            if (activePlan || !root.isConnected) return;
            activePlan = openPlanEditor(planHost(), {
                plantId: ui.plant, rows: rows.filter(isInPlant).map(copyRow), canEdit, isUnsaved: isUnsaved && canEdit, showToast,
                onSaved: () => planHooks.onSaved?.(),
                onClose: () => { activePlan = null; planHooks.onClose?.(); }
            });
        } catch (e) {
            console.error(e);
            showToast(`평면도를 열지 못했습니다: ${e.message}`, 'error');
        }
    };

    // ---------- 이벤트 ----------
    // #w3-root(화면을 열 때마다 새로 만들어짐)에 붙인다 — container에 붙이면 화면을 다시 열 때마다 쌓여 한 번 눌러도 여러 번 처리된다
    const openSlip = (docNo) => {
        if (!canAccessTab('slipIssue')) { showToast(`전표 ${docNo}는 전표관리에서 볼 수 있습니다.`); onSwitchTab('slipManage'); return; }
        window.__slipOpenDocNo = docNo;
        onSwitchTab('slipIssue');
    };
    root.addEventListener('click', async (ev) => {
        const t = ev.target.closest('button');
        if (!t || !root.contains(t)) return;
        if (t.dataset.plant) { selectPlant(t.dataset.plant); return; }
        if (t.dataset.wh !== undefined) { selectWarehouse(t.dataset.wh); return; }
        if (t.dataset.dockSite) {
            ui.dockSite = t.dataset.dockSite;
            try { localStorage.setItem(DOCK_SITE_KEY, ui.dockSite); } catch (e) { console.warn('거점 선택 저장 실패', e); }
            renderDock();
            return;
        }
        if (t.dataset.dock) {
            ui.dockLoc = ui.dockLoc === t.dataset.dock ? '' : t.dataset.dock;
            ui.selected = '';
            ui.cell = null;
            ui.unFilter = '';
            redraw();
            view?.unzoom();
            return;
        }
        if (t.dataset.zone) { selectZone(t.dataset.zone); return; }
        if (t.dataset.move) { openMove({ codes: [t.dataset.move], fromLoc: t.dataset.from }); return; }
        if (t.dataset.slip) { openSlip(t.dataset.slip); return; }
        if (t.dataset.del) {
            const z = ui.draft.find(r => r.id === t.dataset.del);
            if (z && zoneStock(z).length) { showToast(`${z.id}에 재고가 있어 지울 수 없습니다.`, 'error'); return; }
            ui.draft = ui.draft.filter(r => r.id !== t.dataset.del);
            redraw();
            return;
        }
        switch (t.id) {
            case 'w3-top': view?.focus('top'); break;
            case 'w3-reset': view?.focus('persp'); break;
            case 'w3-qr': onSwitchTab('fieldQr'); break;
            case 'w3-plan': await openPlan(); break;
            case 'w3-edit': (ui.edit ? stopEdit : startEdit)(); break;
            case 'w3-close': selectZone(''); break;
            case 'w3-cell-close': ui.cell = null; redrawSelection(); break;
            case 'w3-cell-move': {
                const source = cellSource();
                if (source) openMove({ codes: source.codes, fromLoc: source.fromLoc, fromCell: source.cell });
                break;
            }
            case 'w3-dock-close': ui.dockLoc = ''; ui.unFilter = ''; redraw(); break;
            case 'w3-audit': window.__auditLocation = zoneLocation(zonesAll().find(r => r.id === ui.selected)); onSwitchTab('audit'); break;
            case 'w3-put': openPut(zonesAll().find(r => r.id === ui.selected)); break;
            case 'w3-zone-qr': {
                const z = zonesAll().find(r => r.id === ui.selected);
                const url = await qrDataUrl(fieldQrUrl('LOC', zoneLocation(z)), { width: 220 });
                $('#w3-qr-box').innerHTML = `<div class="flex items-center gap-3 border rounded-lg p-2"><img src="${url}" class="w-28 h-28" alt="위치 QR"><div class="text-xs text-slate-600">현장 스캔으로 찍으면 이 구획이 위치로 잡힙니다.<br>여러 장 인쇄는 [구획 QR 라벨](현장 QR 라벨)에서 하세요.${isDefault ? '<br><b class="text-amber-600">배치를 저장해야 쓸 수 있습니다.</b>' : ''}</div></div>`;
                break;
            }
            case 'w3-e-cancel': stopEdit(); break;
            case 'w3-e-rect': {
                // 도면 외곽선을 지우고 가로 × 세로 사각형으로
                const wh = whRow(ui.wh);
                if (wh && confirm(`${wh.id}의 도면 외곽선을 지우고 ${fmt(wh.w)} × ${fmt(wh.d)}m 사각형으로 바꿀까요?\n[저장]을 눌러야 반영되고, [취소]하면 그대로입니다.`)) { wh.outline = []; redraw(); }
                break;
            }
            case 'w3-e-add': {
                const wh = whRow(ui.wh);
                const zs = zonesOf(ui.wh);
                const last = zs[zs.length - 1];
                const id = nextZoneId(ui.draft, ui.wh);
                // 그 창고의 마지막 구획 옆에 같은 크기로, 첫 구획이면 파렛트 6개 × 2단 열 하나 (크기·방향은 표에서 고친다)
                const shape = last
                    ? { zoneType: last.zoneType || 'RACK', x: Math.min(last.x + last.w + 1.5, Math.max(wh.w - 4, 0)), z: last.z, w: last.w, d: last.d, h: last.h, rot: last.rot || 0, y: last.y || 0, slots: last.slots || 0, lanes: last.lanes || 1, tiers: last.tiers || 1, fillFrom: last.fillFrom || 'START', note: last.note || '' }
                    : { zoneType: 'FLOOR', x: 1, z: 1, w: PALLET_LINE.long, d: PALLET_LINE.wide, h: PALLET_LINE.h, rot: 0, y: 0, slots: PALLET_LINE.pallets, tiers: PALLET_LINE.tiers, fillFrom: 'START', note: `파렛트 ${PALLET_LINE.pallets}개 × ${PALLET_LINE.tiers}단 (${PALLET_LINE.pallets * PALLET_LINE.tiers}파렛트)` };
                ui.draft.push({ id, kind: 'ZONE', warehouse: ui.wh, site: wh.site, name: `${zs.length + 1}라인`, sort: zs.length + 1, ...shape });
                redraw();
                break;
            }
            case 'w3-e-save': {
                t.disabled = true;
                try {
                    await saveZones(ui.draft, ui.plant);
                    rows = [...rows.filter(r => !isInPlant(r)), ...ui.draft.map(copyRow)];
                    defaultPlants.delete(ui.plant);
                    syncDefault();
                    showToast('창고 배치를 저장했습니다. 구획이 위치 선택·위치 QR에 생겼습니다.', 'success');
                    stopEdit();
                } catch (e) {
                    showToast(e.message, 'error');
                    t.disabled = false;
                }
                break;
            }
            default: break;
        }
    });
    // 목록의 품목 줄 끌기: 마우스는 줄 어디서나, 터치는 줄 앞 손잡이로만 (목록 스크롤과 구분)
    root.addEventListener('pointerdown', (ev) => {
        if (ev.button > 0 || !canDrag()) return;
        const row = ev.target.closest('[data-drag-code]');
        if (!row || ev.target.closest('button, input, select, a')) return;
        if (ev.pointerType !== 'mouse' && !ev.target.closest('.w3-grip')) return;
        dnd.begin(ev, { fromLoc: row.dataset.dragFrom, codes: [row.dataset.dragCode], label: row.dataset.dragName || row.dataset.dragCode, cell: -1 });
    });
    // 라인 안 품목의 파렛트 수 고치기
    root.addEventListener('change', async (ev) => {
        const el = ev.target;
        if (!el.dataset?.pallets || !ui.selected) return;
        try {
            await setZoneLoad(ui.selected, el.dataset.pallets, Number(el.value));
            redraw();
        } catch (e) { showToast(e.message, 'error'); }
    });
    root.addEventListener('input', (ev) => {
        const el = ev.target;
        if (el.id === 'w3-search') { ui.search = el.value.trim(); ui.selected = ''; ui.cell = null; redraw(); view?.unzoom(); return; }
        if (el.id === 'w3-un-filter') {
            ui.unFilter = el.value;
            const pos = el.selectionStart;
            renderSide();
            const again = $('#w3-un-filter');
            again?.focus();
            again?.setSelectionRange(pos, pos);
            return;
        }
        if (ui.edit && el.dataset.f && el.dataset.id) {
            const r = ui.draft.find(x => x.id === el.dataset.id);
            if (!r) return;
            const field = el.dataset.f, value = el.type === 'number' ? Number(el.value) || 0 : el.value;
            // 도면 외곽선이 있는 창고는 가로·세로를 바꾸면 외곽선도 그 길이에 맞춰 늘린다 (외곽선의 지금 폭 기준 — 칸을 지웠다 다시 써도 맞게)
            if (r.kind === 'WAREHOUSE' && hasOutline(r) && (field === 'w' || field === 'd') && value > 0) {
                const axis = field === 'w' ? 0 : 1;
                const extent = Math.max(...warehouseOutline(r).map(p => p[axis]));
                if (extent > 0) r.outline = warehouseOutline(r).map(p => p.map((v, i) => (i === axis ? Math.round(v * (value / extent) * 100) / 100 : v)));
            }
            r[field] = value;
            view?.rebuild();
        }
    });

    // 공장 바꾸기: 그 공장의 배치만 그리고 시점을 바로 맞춘다 (공장마다 좌표 기준이 달라 날아가지 않는다)
    const selectPlant = (id) => {
        if (ui.edit || id === ui.plant || !ZONE_PLANTS.some(p => p.id === id)) return;
        ui.plant = id;
        ui.wh = '';
        ui.selected = '';
        ui.cell = null;
        try { localStorage.setItem(PLANT_KEY, id); } catch (e) { console.warn('공장 선택 저장 실패', e); }
        syncDefault();
        renderChips();
        redraw();
        view?.focus('persp', true);
    };

    // ---------- 시작 ----------
    try {
        ui.dockSite = localStorage.getItem(DOCK_SITE_KEY) || '';
        const lastPlant = localStorage.getItem(PLANT_KEY);
        if (ZONE_PLANTS.some(p => p.id === lastPlant)) ui.plant = lastPlant;
    } catch (e) { console.warn('거점·공장 선택 읽기 실패', e); }
    try {
        const res = await loadZones();
        rows = res.rows;
        defaultPlants = new Set(res.defaultPlants);
        await loadZoneLoads().catch(e => showToast(e.message, 'error'));
    } catch (e) {
        showToast(e.message, 'error');
        rows = [];
    }
    syncDefault();
    renderChips();
    renderDock();
    renderSide();
    renderSum();
    await buildView();
};
