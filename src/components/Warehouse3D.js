// ==========================================
// 창고 배치도 (3D) — 김포2공장 창고(2A·2B·2C)의 구획(라인)과 구획별 재고
// ==========================================
// · 3D(three.js, 동적 import): 콘크리트 바닥 + 벽(불투명 굽도리 + 반투명 벽, 열린 문 자리는 비움) + 5m 격자 + 그림자.
//   라인 = 바닥 노란 칸 선(빈 칸) + 파렛트(나무 받침 + 짐, 짐 색 = 품목 분류, 칸 초과는 빨강). 번호표는 넣는 쪽 끝에 '번호 · 적재/칸'.
// · 시점: 화면 비율에 맞춰 범위가 다 들어오게(fitDistance) 부드럽게 이동, 기본 = A동 출입문 정면. 마우스를 올리면 라인 테두리·풍선 도움말.
// · 구획을 누르면 오른쪽에 그 구획 재고, 품목 검색은 들어 있는 구획만 밝게. 칩·오른쪽 위·목록에 동별 적재/칸.
// · 구획 미지정 재고(김포공장·김포2A/2B/2C 창고 단위)를 [구획 지정]으로 구획에 옮긴다(같은 거점 안 이동 — 수불부·업무일지 기록 없음).
// · 배치 편집(매니저): 창고 크기·위치, 구획 추가·삭제·위치·크기(m). 저장하면 구획 위치가 입출고·이동·실사 위치 선택과 위치 QR에 생긴다.
import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { zoneCapacity, zonePallets, itemPallets, setZoneLoad, loadZoneLoads } from '../services/warehouseZones.js';
import { ZONE_WAREHOUSES, ZONE_TYPES, SITE_EXTRAS, loadZones, saveZones, zoneStock, zoneLocation, unassignedStock, nextZoneId, moveToZone } from '../services/warehouseZones.js';
import { locationLabel, buildingOf } from '../services/locations.js';
import { fieldQrUrl } from '../services/fieldQr.js';
import { qrDataUrl } from '../services/qrCode.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const CAT_COLORS = { 원료: '#f59e0b', 원액: '#8b5cf6', 완제품: '#3b82f6', 부자재: '#10b981' };
const EMPTY_COLOR = '#cbd5e1';
const OTHER_COLOR = '#64748b';
const catColor = (cat) => CAT_COLORS[cat] || OTHER_COLOR;
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

/** 구획 재고 요약: 품목 수·분류별 수·대표 분류 */
const summarize = (rows) => {
    const byCat = {};
    rows.forEach(r => { byCat[r.category || '기타'] = (byCat[r.category || '기타'] || 0) + 1; });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    return { count: rows.length, byCat, top };
};

let activeView = null; // 지금 떠 있는 3D 화면 (다시 그릴 때 정리)

export const renderWarehouse3D = async (container, { showToast, onSwitchTab }) => {
    activeView?.dispose();
    activeView = null;
    const canEdit = canPerformAction('EDIT_MASTER');
    const canMove = canPerformAction('WRITE_STOCK');

    const ui = { wh: '', selected: '', search: '', edit: false, draft: null, unFilter: '' };
    let rows = [];
    let isDefault = false;

    container.innerHTML = `
    <div class="max-w-[1680px] mx-auto space-y-3" id="w3-root">
        <div class="flex flex-wrap items-end justify-between gap-2">
            <div>
                <h2 class="text-xl font-bold text-slate-800 flex items-center gap-2"><i data-lucide="box" class="w-5 h-5 text-blue-600"></i> 창고 배치도 (3D) · 김포2공장</h2>
                <p class="text-xs text-slate-500">구획(라인)을 누르면 그 구획의 원부자재·제품이 보입니다. 끌어서 돌리고, 휠로 확대, 오른쪽 버튼으로 옮깁니다.</p>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <div class="relative"><input id="w3-search" type="search" placeholder="품목코드·품명으로 위치 찾기" class="border rounded-lg pl-8 pr-3 py-2 text-sm w-64"><i data-lucide="search" class="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400"></i></div>
                <button id="w3-top" class="px-3 py-2 text-sm border rounded-lg bg-white hover:bg-slate-50">위에서 보기</button>
                <button id="w3-reset" class="px-3 py-2 text-sm border rounded-lg bg-white hover:bg-slate-50" title="A동 출입문을 바깥에서 정면으로 (동을 고르면 그 동)">기본 시점</button>
                <button id="w3-qr" class="px-3 py-2 text-sm border rounded-lg bg-white hover:bg-slate-50">구획 QR 라벨</button>
                ${canEdit ? '<button id="w3-edit" class="px-3 py-2 text-sm rounded-lg bg-slate-800 text-white hover:bg-slate-700">배치 편집</button>' : ''}
            </div>
        </div>
        <div id="w3-banner"></div>
        <div class="flex flex-wrap gap-2" id="w3-chips"></div>
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
    const zonesAll = () => (ui.edit ? ui.draft : rows);
    const zonesOf = (wh) => zonesAll().filter(r => r.kind === 'ZONE' && (!wh || r.warehouse === wh)).sort((a, b) => a.warehouse.localeCompare(b.warehouse) || a.sort - b.sort || a.id.localeCompare(b.id));
    const whRow = (code) => zonesAll().find(r => r.kind === 'WAREHOUSE' && r.id === code);

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

    // 동(또는 전체)의 적재 현황: 파렛트 칸이 있는 라인의 적재/칸 + 품목 수
    const whStats = (code = '') => {
        let cap = 0, used = 0, items = 0, lines = 0;
        zonesOf(code).forEach(z => {
            const c = zoneCapacity(z);
            if (c) { cap += c; used += zonePallets(z); lines += 1; }
            items += zoneStock(z).length;
        });
        return { cap, used, items, lines, zones: zonesOf(code).length };
    };
    const pctText = (used, cap) => (cap ? `${Math.round((used / cap) * 100)}%` : '');
    // 3D 오른쪽 위 요약
    const renderSum = () => {
        const box = $('#w3-sum');
        if (!box) return;
        const st = whStats(ui.wh);
        const scope = ui.wh ? (ZONE_WAREHOUSES.find(w => w.code === ui.wh)?.label || ui.wh) : '김포2공장 전체';
        box.innerHTML = `<div class="font-bold">${esc(scope)}</div>`
            + (st.cap ? `<div>적재 <b class="${st.used > st.cap ? 'text-red-300' : 'text-emerald-300'}">${fmt(st.used)}</b> / ${fmt(st.cap)} 파렛트 · ${pctText(st.used, st.cap)}</div>` : '')
            + `<div class="text-white/70">구획 ${st.zones}곳 · 보관 품목 ${st.items}</div>`;
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
        let siteBox = null;         // 시점 맞춤 범위 { minX, maxX, minZ, maxZ, maxY }
        let whBoxes = new Map();
        const disposables = [];
        const track = (o) => { disposables.push(o); return o; };

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
                group.add(o);
                return o;
            };
            const flatPlane = (w, d, m, x, y, z) => { const o = mesh(track(new THREE.PlaneGeometry(w, d)), m, x, y, z); o.rotation.x = -Math.PI / 2; return o; };

            const hits = searchHits();
            hitIds = new Set(hits ? [...hits.keys()] : []);
            const whs = zonesAll().filter(r => r.kind === 'WAREHOUSE');
            const doors = SITE_EXTRAS.doors || [];
            const doorH = (wh) => Math.min(4, Math.max(2.2, wh.h - 1));

            // ---------- 시점 맞춤 범위 (동 서쪽 이름표 자리 포함) ----------
            const grow = (b, x0, z0, x1, z1, y = 0) => { b.minX = Math.min(b.minX, x0); b.maxX = Math.max(b.maxX, x1); b.minZ = Math.min(b.minZ, z0); b.maxZ = Math.max(b.maxZ, z1); b.maxY = Math.max(b.maxY, y); };
            const empty = () => ({ minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxY: 3 });
            const bx = empty();
            whBoxes = new Map();
            whs.forEach(wh => {
                const b = empty();
                grow(b, wh.x - 13, wh.z - 0.6, wh.x + wh.w + 1.6, wh.z + wh.d + 0.6, wh.h); // 서쪽 = 이름표 자리
                whBoxes.set(wh.id, b);
                grow(bx, b.minX, b.minZ, b.maxX, b.maxZ, b.maxY);
            });
            (SITE_EXTRAS.floorMarks || []).forEach(fm => grow(bx, fm.x, fm.z, fm.x + fm.w, fm.z + fm.d));
            (SITE_EXTRAS.arrows || []).forEach(ar => grow(bx, Math.min(ar.from[0], ar.to[0]), Math.min(ar.from[1], ar.to[1]), Math.max(ar.from[0], ar.to[0]), Math.max(ar.from[1], ar.to[1])));
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
            (SITE_EXTRAS.arrows || []).forEach(ar => {
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
            (SITE_EXTRAS.floorMarks || []).forEach(fm => {
                const cx = fm.x + fm.w / 2, cz = fm.z + fm.d / 2;
                flatPlane(fm.w, fm.d, mat(fm.color || '#22c55e', { opacity: 0.4, basic: true }), cx, 0.02, cz);
                const edge = new THREE.LineSegments(edges(fm.w, 0.02, fm.d), lineMat('#ffffff'));
                edge.position.set(cx, 0.04, cz);
                group.add(edge);
                // 바닥에 누운 글자 (위에서 볼 때 북쪽이 위)
                const cv = document.createElement('canvas');
                cv.width = 512; cv.height = Math.round(512 * (fm.d / fm.w));
                const ctx = cv.getContext('2d');
                const lines = String(fm.text || '').split('\n');
                const fs = Math.min(cv.width / 5.5, cv.height / (lines.length * 1.4));
                ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                lines.forEach((l, i) => { ctx.font = `bold ${i ? fs * 0.7 : fs}px sans-serif`; ctx.fillText(l, cv.width / 2, cv.height / 2 + (i - (lines.length - 1) / 2) * fs * 1.25); });
                const tex = track(new THREE.CanvasTexture(cv));
                tex.colorSpace = THREE.SRGBColorSpace;
                flatPlane(fm.w * 0.95, fm.d * 0.95, track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })), cx, 0.05, cz);
            });

            // ---------- 동: 콘크리트 바닥 · 벽(아래 굽도리 + 반투명 벽, 열린 문 자리는 비움) · 이름표 ----------
            whs.forEach(wh => {
                const dim = !!(ui.wh && ui.wh !== wh.id);
                const cx = wh.x + wh.w / 2, cz = wh.z + wh.d / 2;
                const H = wh.h, T = 0.2, PL = 0.35, dh = doorH(wh);
                mesh(box(wh.w, 0.12, wh.d), mat(dim ? '#334155' : '#e5e7eb'), cx, -0.05, cz, { receive: true });
                const wallMat = mat('#e2e8f0', { opacity: dim ? 0.05 : 0.13 });
                const plinthMat = mat(dim ? '#475569' : '#94a3b8');
                [
                    { wall: 'N', len: wh.w, alongX: true, at: wh.z - T / 2 },
                    { wall: 'S', len: wh.w, alongX: true, at: wh.z + wh.d + T / 2 },
                    { wall: 'W', len: wh.d, alongX: false, at: wh.x - T / 2 },
                    { wall: 'E', len: wh.d, alongX: false, at: wh.x + wh.w + T / 2 }
                ].forEach(sd => {
                    const seg = (a, b, y0, y1, m, cast) => {
                        const l = b - a, hh = y1 - y0;
                        if (l < 0.02 || hh < 0.02) return;
                        const mid = (a + b) / 2;
                        mesh(box(sd.alongX ? l : T, hh, sd.alongX ? T : l), m, sd.alongX ? wh.x + mid : sd.at, y0 + hh / 2, sd.alongX ? sd.at : wh.z + mid, { cast, receive: true });
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
                const roof = new THREE.LineSegments(edges(wh.w + T * 2, H, wh.d + T * 2), lineMat(dim ? '#475569' : '#94a3b8', dim ? 0.35 : 0.75));
                roof.position.set(cx, H / 2, cz);
                group.add(roof);
                // 이름표: 동 서쪽 바깥 (오른쪽 끝이 서쪽 벽 앞). 세 동이 같은 쪽에 있어 화면 고정 크기면 겹치므로 실제 크기
                const st = whStats(wh.id);
                const wl = badge([
                    { text: `${wh.name || wh.id} · ${wh.id}`, size: 44 },
                    { text: `${fmt(wh.w)}×${fmt(wh.d)}m · ${st.cap ? `적재 ${fmt(st.used)}/${st.cap}` : `${st.items}품목`}`, size: 30, color: '#cbd5e1', bold: false }
                ], { hM: 3, center: [1, 0.5], bg: dim ? 'rgba(15,23,42,0.45)' : 'rgba(15,23,42,0.85)' });
                wl.position.set(wh.x - 0.9, 2.2, cz);
                group.add(wl);
            });

            // ---------- 출입문: 열린 문은 흰 문틀 + 밀려 난(또는 열린) 문짝, 고정문은 회색 판 ----------
            doors.forEach(dr => {
                const wh = whs.find(w => w.id === dr.warehouse);
                if (!wh) return;
                const dim = !!(ui.wh && ui.wh !== wh.id);
                const len = dr.to - dr.from, mid = (dr.from + dr.to) / 2, dh = doorH(wh);
                const alongZ = dr.wall === 'E' || dr.wall === 'W';
                const px = dr.wall === 'E' ? wh.x + wh.w + 0.1 : dr.wall === 'W' ? wh.x - 0.1 : wh.x + mid;
                const pz = dr.wall === 'N' ? wh.z - 0.1 : dr.wall === 'S' ? wh.z + wh.d + 0.1 : wh.z + mid;
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
                    group.add(frame);
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
                if (!dim) {
                    const short = String(dr.name || '').replace(/\s*\(.*\)\s*$/, '');
                    // 문 이름표: 실제 크기, 멀리서 너무 작으면 숨김 (문은 주황 문짝으로 보임)
                    const lab = badge([{ text: `${fixed ? '🔒' : '🚪'} ${short}`, size: 34 }], { hM: 0.85, center: [0.5, 0], bg: fixed ? 'rgba(71,85,105,0.92)' : 'rgba(194,65,12,0.92)' });
                    lab.position.set(px + nx * 0.4, dh + 0.4, pz + nz * 0.4);
                    group.add(lab);
                    zoneLabels.push(lab);
                }
            });

            // ---------- 장비 모형: 지게차 (카운터밸런스형, 길이 약 3.4m(포크 포함) · 폭 1.1m · 헤드가드 2.2m, 앞 = -z) ----------
            const forklift = () => {
                const g = new THREE.Group();
                const m = (color, extra = {}) => track(new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...extra }));
                const part = (w, h, d, mm, x, y, z) => { const o = new THREE.Mesh(box(w, h, d), mm); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
                const yellow = m('#f59e0b'), dark = m('#1f2937'), steel = m('#64748b', { metalness: 0.6 }), black = m('#0f172a');
                part(1.1, 0.6, 1.9, yellow, 0, 0.55, 0.1);          // 차체
                part(1.1, 0.75, 0.45, dark, 0, 0.62, 1.2);          // 카운터웨이트
                part(0.5, 0.12, 0.5, black, 0, 0.92, 0.35);         // 시트
                part(0.5, 0.45, 0.08, black, 0, 1.18, 0.6);         // 등받이
                part(0.9, 0.35, 0.3, yellow, 0, 1.0, -0.55);        // 계기판·핸들 받침
                [[-0.47, -0.45], [0.47, -0.45], [-0.47, 0.75], [0.47, 0.75]].forEach(([x, z]) => part(0.06, 1.35, 0.06, dark, x, 1.5, z)); // 헤드가드 기둥
                part(1.05, 0.05, 1.3, dark, 0, 2.2, 0.15);          // 헤드가드 지붕
                [-0.34, 0.34].forEach(x => part(0.1, 2.3, 0.12, steel, x, 1.2, -1.05)); // 마스트
                part(0.8, 0.08, 0.1, steel, 0, 2.3, -1.05);
                part(0.9, 0.5, 0.06, steel, 0, 0.45, -1.15);        // 캐리지
                [-0.25, 0.25].forEach(x => part(0.1, 0.05, 1.1, steel, x, 0.13, -1.72)); // 포크
                const wheelGeo = track(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 18));
                [[-0.56, -0.62], [0.56, -0.62], [-0.56, 0.78], [0.56, 0.78]].forEach(([x, z]) => {
                    const w = new THREE.Mesh(wheelGeo, black); w.rotation.z = Math.PI / 2; w.position.set(x, 0.28, z); w.castShadow = true; g.add(w);
                });
                return g;
            };
            (SITE_EXTRAS.props || []).forEach(pr => {
                const wh = whs.find(w => w.id === pr.warehouse);
                if (!wh || pr.type !== 'FORKLIFT') return;
                const fl = forklift();
                fl.position.set(wh.x + pr.x, 0.01, wh.z + pr.z);
                fl.rotation.y = -((pr.rot || 0) * Math.PI) / 180;
                group.add(fl);
            });
            (SITE_EXTRAS.facilities || []).forEach(fc => {
                mesh(box(fc.w, fc.h, fc.d), mat('#0ea5e9', { opacity: 0.75 }), fc.x + fc.w / 2, fc.h / 2, fc.z + fc.d / 2);
                const lab = badge([{ text: fc.name, size: 32 }], { hM: 0.6, bg: 'rgba(3,105,161,0.85)' });
                lab.position.set(fc.x + fc.w / 2 + 2.5, fc.h + 0.8, fc.z + fc.d / 2);
                group.add(lab);
            });

            // ---------- 구획(라인): 바닥 노란 칸 선 · 파렛트(나무 받침 + 짐) · 번호표 ----------
            const pallet = (x, y0, z, sx, sz, th, color, dim, glow) => {
                const base = 0.14;
                mesh(box(sx, base, sz), mat(dim ? '#475569' : '#a16207', { opacity: dim ? 0.3 : 1 }), x, y0 + base / 2, z, { cast: !dim, receive: true });
                const ch = Math.max(0.2, th - base - 0.06);
                mesh(box(sx * 0.94, ch, sz * 0.94), mat(color, { opacity: dim ? 0.25 : 1, emissive: dim ? '' : glow }), x, y0 + base + ch / 2, z, { cast: !dim, receive: true });
            };
            const slotLines = (cx, cz, L, C, alongX, slots, color, opacity) => {
                const y = 0.025, pts = [];
                const P = (a, b) => (alongX ? [cx + a, y, cz + b] : [cx + b, y, cz + a]);
                const seg = (a1, b1, a2, b2) => pts.push(...P(a1, b1), ...P(a2, b2));
                seg(-L / 2, -C / 2, L / 2, -C / 2); seg(-L / 2, C / 2, L / 2, C / 2); seg(-L / 2, -C / 2, -L / 2, C / 2); seg(L / 2, -C / 2, L / 2, C / 2);
                for (let i = 1; i < slots; i += 1) { const a = -L / 2 + (L / slots) * i; seg(a, -C / 2, a, C / 2); }
                const g = track(new THREE.BufferGeometry());
                g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
                group.add(new THREE.LineSegments(g, lineMat(color, opacity)));
            };
            const hitMat = mat('#ffffff', { opacity: 0, basic: true });
            const CAT_ORDER = ['원료', '원액', '부자재', '완제품'];
            const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 9 : i; };
            zonesOf('').forEach(z => {
                const wh = whRow(z.warehouse);
                if (!wh) return;
                const stock = zoneStock(z);
                const selected = ui.selected === z.id;
                const isHit = hitIds.has(z.id);
                const outOfScope = !!(ui.wh && ui.wh !== z.warehouse);
                const dim = outOfScope || (!!hits && !isHit);
                const cx = wh.x + z.x + z.w / 2, cz = wh.z + z.z + z.d / 2;
                const cap = zoneCapacity(z);
                const used = cap ? zonePallets(z) : 0;
                const alongX = z.w >= z.d;
                const L = alongX ? z.w : z.d, C = alongX ? z.d : z.w;
                const glow = selected ? '#1d4ed8' : isHit ? '#ca8a04' : '';
                // 바닥: 옅게 칠한 구역 + 칸 선 (빈 칸 = 선만)
                flatPlane(z.w, z.d, mat(cap ? '#facc15' : '#e2e8f0', { opacity: dim ? 0.03 : 0.09, basic: true }), cx, 0.015, cz);
                slotLines(cx, cz, L, C, alongX, cap ? Math.max(1, Math.round(z.slots)) : 1,
                    selected ? '#60a5fa' : isHit ? '#fde047' : cap ? '#eab308' : '#cbd5e1', dim ? 0.25 : 0.95);
                if (cap) {
                    // 1번 칸부터(채우는 쪽 끝에서) 아래 → 위 → 다음 칸 순서로 파렛트를 쌓는다. 색 = 품목 분류
                    const slots = Math.max(1, Math.round(z.slots)), tiers = Math.max(1, Math.round(z.tiers || 1));
                    const step = L / slots, th = z.h / tiers;
                    const colors = [];
                    [...stock].sort((a, b) => catRank(a.category) - catRank(b.category) || String(a.code).localeCompare(String(b.code)))
                        .forEach(i => { for (let k = 0; k < Math.ceil(itemPallets(z, i.code) - 1e-9); k += 1) colors.push(catColor(i.category)); });
                    const over = colors.length > cap;
                    const n = Math.min(cap, colors.length);
                    const sx = alongX ? step * 0.86 : C * 0.84, sz = alongX ? C * 0.84 : step * 0.86;
                    for (let idx = 0; idx < n; idx += 1) {
                        const p = Math.floor(idx / tiers), t = idx % tiers;
                        const pos = z.fillFrom === 'END' ? slots - 1 - p : p;
                        const off = -L / 2 + step * (pos + 0.5);
                        pallet(alongX ? cx + off : cx, th * t + 0.01, alongX ? cz : cz + off, sx, sz, th, over && idx === n - 1 ? '#ef4444' : colors[idx], dim, glow);
                    }
                } else if (stock.length) {
                    pallet(cx, 0.01, cz, z.w * 0.8, z.d * 0.8, Math.min(1.5, z.h * 0.75), catColor(summarize(stock).top), dim, glow);
                }
                // 누르기용 투명 상자 + 테두리 (선택 파랑 · 검색 노랑 · 마우스 올림 흰색)
                const hit = mesh(box(z.w, z.h, z.d), hitMat, cx, z.h / 2, cz);
                hit.userData.zoneId = z.id;
                pickables.push(hit);
                const ol = new THREE.LineSegments(edges(z.w + 0.1, z.h + 0.1, z.d + 0.1), lineMat(selected ? '#60a5fa' : isHit ? '#fde047' : '#f8fafc'));
                ol.position.set(cx, (z.h + 0.1) / 2, cz);
                ol.visible = selected || isHit;
                group.add(ol);
                outlines.set(z.id, ol);
                // 번호표: 파렛트를 넣는 쪽(채우기 시작하는 쪽의 반대편) 끝 바닥 가까이, 적재/칸
                if (!outOfScope && (!hits || isHit || selected)) {
                    const short = z.id.split('-').pop();
                    const second = cap ? { text: `${fmt(used)}/${cap}`, size: 30, color: used > cap ? '#fca5a5' : used > 0 ? '#86efac' : '#94a3b8' }
                        : stock.length ? { text: `${stock.length}품목`, size: 30, color: '#86efac' } : null;
                    const lb = badge([{ text: short, size: 42 }, ...(second ? [second] : [])], { hM: second ? 0.95 : 0.55, bg: selected ? 'rgba(37,99,235,0.95)' : 'rgba(15,23,42,0.82)' });
                    if (cap) {
                        const sign = z.fillFrom === 'END' ? -1 : 1, off = L / 2 + 0.55;
                        lb.position.set(alongX ? cx + sign * off : cx, 0.7, alongX ? cz : cz + sign * off);
                    } else lb.position.set(cx, 1.9, cz);
                    lb.userData.always = selected; // 고른 라인은 멀리서도 보이게
                    group.add(lb);
                    zoneLabels.push(lb);
                }
                if (selected) {
                    const info = badge([
                        { text: `${wh.name || wh.id} ${z.name || z.id}`, size: 40 },
                        { text: cap ? `적재 ${fmt(used)}/${cap} 파렛트${used > cap ? ' · 초과' : ''}` : `${stock.length}품목`, size: 30, color: '#dbeafe', bold: false }
                    ], { hM: 0.055, screen: true, center: [0.5, 0], bg: 'rgba(37,99,235,0.95)' });
                    info.position.set(cx, z.h + 0.4, cz);
                    group.add(info);
                }
            });
            render();
        };

        // ---------- 시점: 화면 비율에 맞춰 범위가 다 들어오게, 부드럽게 이동 ----------
        let anim = 0;
        const flyTo = (pos, target, instant = false) => {
            cancelAnimationFrame(anim);
            const reduce = instant || document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            if (reduce) { camera.position.copy(pos); controls.target.copy(target); controls.update(); render(); return; }
            const p0 = camera.position.clone(), t0 = controls.target.clone(), start = performance.now(), dur = 550;
            const step = (now) => {
                const k = Math.min(1, (now - start) / dur), e = 1 - (1 - k) ** 3;
                camera.position.lerpVectors(p0, pos, e);
                controls.target.lerpVectors(t0, target, e);
                controls.update();
                render();
                if (k < 1) anim = requestAnimationFrame(step);
            };
            anim = requestAnimationFrame(step);
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
        const focus = (mode = 'persp', instant = false) => {
            const wh = ui.wh && whRow(ui.wh);
            const b = (wh && whBoxes.get(wh.id)) || siteBox;
            if (!b) return;
            const target = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
            let dir;
            if (mode === 'top') dir = new THREE.Vector3(0, 1, 0.0015).normalize();
            else {
                // 기본 시점 문(SITE_EXTRAS.homeView)을 바깥에서 정면으로 보는 방향 (가운데는 범위 가운데 — 한쪽이 비지 않게)
                const hv = SITE_EXTRAS.homeView;
                const hw = hv && whRow(hv.warehouse);
                const wall = hw ? hv.wall : 'E';
                const nx = wall === 'E' ? 1 : wall === 'W' ? -1 : 0, nz = wall === 'S' ? 1 : wall === 'N' ? -1 : 0;
                const el = ((wh ? 48 : 42) * Math.PI) / 180;
                dir = new THREE.Vector3(nx * Math.cos(el), Math.sin(el), nz * Math.cos(el)).normalize();
            }
            const p0 = camera.position.clone(), t0 = controls.target.clone();
            const d = fitDistance(dir, target, corners(b));
            camera.position.copy(p0);
            camera.lookAt(t0);
            flyTo(target.clone().addScaledVector(dir, d), target, instant);
        };

        // 그리기 전에: 화면에서 13px보다 작게 보일 라인 번호표는 숨긴다 (멀리서 볼 때 점처럼 어지럽지 않게)
        const render = () => {
            if (zoneLabels.length) {
                const H = renderer.domElement.clientHeight || 600, k = 2 * Math.tan((camera.fov * Math.PI) / 360);
                zoneLabels.forEach(sp => { sp.visible = sp.userData.always || (sp.scale.y / (camera.position.distanceTo(sp.position) * k)) * H >= 13; });
            }
            renderer.render(scene, camera);
        };
        controls.addEventListener('change', render);

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
        const ray = new THREE.Raycaster();
        const ptr = new THREE.Vector2();
        const pick = (ev) => {
            const r = renderer.domElement.getBoundingClientRect();
            ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
            ray.setFromCamera(ptr, camera);
            return ray.intersectObjects(pickables, false)[0]?.object?.userData.zoneId || '';
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
        let down = null;
        const onDown = (ev) => { down = { x: ev.clientX, y: ev.clientY }; };
        const onUp = (ev) => {
            if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) { down = null; return; }
            down = null;
            const id = pick(ev);
            ui.selected = id === ui.selected ? '' : id;
            rebuild();
            renderSide();
        };
        const tip = $('#w3-tip');
        const onMove = (ev) => {
            const id = pick(ev);
            renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
            setHover(id);
            if (!id) { tip.classList.add('hidden'); return; }
            const z = zonesAll().find(r => r.id === id);
            const s = summarize(zoneStock(z));
            const cap = zoneCapacity(z);
            const r = renderer.domElement.getBoundingClientRect();
            tip.innerHTML = `<b>${esc(z.id)}</b> ${esc(z.name)}${cap ? ` · 적재 <b>${fmt(zonePallets(z))}/${cap}</b>` : ''}<br>${s.count ? Object.entries(s.byCat).map(([k, v]) => `${esc(k)} ${v}품목`).join(' · ') : '비어 있음'}`;
            tip.style.left = `${Math.min(ev.clientX - r.left + 12, r.width - 190)}px`;
            tip.style.top = `${ev.clientY - r.top + 12}px`;
            tip.classList.remove('hidden');
        };
        const el = renderer.domElement;
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerleave', () => { tip.classList.add('hidden'); setHover(''); });

        // 화면을 떠나면 정리
        const watch = setInterval(() => { if (!host.isConnected) dispose(); }, 2000);
        let disposed = false;
        const dispose = () => {
            if (disposed) return;
            disposed = true;
            cancelAnimationFrame(anim);
            clearInterval(watch);
            ro.disconnect();
            controls.dispose();
            disposables.splice(0).forEach(o => o.dispose?.());
            renderer.dispose();
            renderer.forceContextLoss?.();
            if (activeView === api) activeView = null;
        };
        const api = { rebuild, focus, dispose };
        resize();
        rebuild();
        focus('persp', true);
        return api;
    };

    const redraw = () => { view?.rebuild(); renderSide(); renderChips(); renderSum(); };

    // ---------- 칩·안내 ----------
    const renderChips = () => {
        const chip = (val, label) => {
            const st = whStats(val), on = ui.wh === val;
            const sub = st.cap ? `${fmt(st.used)}/${fmt(st.cap)}` : st.items ? `${st.items}품목` : '';
            return `<button data-wh="${esc(val)}" class="px-3 py-1.5 rounded-full text-sm border flex items-center gap-1.5 ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 hover:bg-slate-50'}">${esc(label)}${sub ? `<span class="text-[11px] px-1.5 rounded-full ${on ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}">${sub}</span>` : ''}</button>`;
        };
        $('#w3-chips').innerHTML = (ui.edit ? '' : chip('', '김포2공장 전체')) + ZONE_WAREHOUSES.map(w => chip(w.code, w.label)).join('');
        $('#w3-banner').innerHTML = isDefault && !ui.edit
            ? `<div class="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">아직 저장된 배치가 없어 <b>기본 배치</b>를 보여 줍니다. 동 크기·배치(C동(사무동) 9.5×6.9m · A동 13×25m · B동 20×13m, 1.5m 간격)는 배치도 도면 치수, 라인은 파렛트 6개 × 2단 열 배치이고 벽 높이는 예시입니다. ${canEdit ? '[배치 편집]에서 실제 창고 크기·구획을 맞춘 뒤 저장하면 구획에 재고를 넣을 수 있습니다.' : '매니저가 배치를 저장하면 구획에 재고를 넣을 수 있습니다.'}</div>`
            : ui.edit ? '<div class="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg px-3 py-2">배치 편집 중: 창고를 고르고 오른쪽 표에서 크기·위치(m)를 고치면 3D에 바로 보입니다. 위치 x·z는 창고 왼쪽 위 모서리 기준입니다. [저장]을 눌러야 반영됩니다.</div>' : '';
    };

    // ---------- 오른쪽 ----------
    const stockTable = (items, { zone = null, moveBtn = false } = {}) => items.length ? `
        <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-500"><tr><th class="p-1.5 text-left">품목</th><th class="p-1.5 text-right">재고</th></tr></thead><tbody>
        ${items.map(i => `<tr class="border-t align-top"><td class="p-1.5"><span class="inline-block w-2 h-2 rounded-sm mr-1" style="background:${catColor(i.category)}"></span><b>${esc(i.name)}</b><div class="text-slate-400">${esc(i.code)} · ${esc(i.category || '')}${zone ? '' : ` · ${esc(buildingOf(i.location) || '창고 미지정')}`}</div>
            ${moveBtn ? `<button data-move="${esc(i.code)}" data-from="${esc(i.location)}" class="mt-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 text-[11px] font-bold">${zone ? '다른 구획으로 옮기기' : '구획 지정'}</button>` : ''}</td>
            <td class="p-1.5 text-right whitespace-nowrap font-bold">${fmt(i.quantity)} <span class="text-slate-400 font-normal">${esc(i.unit || '')}</span>
                ${zone && zoneCapacity(zone) ? `<div class="font-normal text-slate-500 mt-0.5">${canMove && !isDefault ? `<input type="number" min="0" step="1" value="${itemPallets(zone, i.code)}" data-pallets="${esc(i.code)}" class="w-12 border rounded px-1 py-0.5 text-right" title="이 품목이 차지하는 파렛트 수">` : fmt(itemPallets(zone, i.code))} 파렛트</div>` : ''}</td></tr>`).join('')}
        </tbody></table>` : '<p class="text-xs text-slate-400 py-2">재고가 없습니다.</p>';

    const renderSide = () => {
        const side = $('#w3-side');
        if (ui.edit) { side.innerHTML = editorHtml(); return; }
        const hits = searchHits();
        const sel = ui.selected && zonesAll().find(r => r.id === ui.selected);
        if (sel) {
            const items = zoneStock(sel);
            side.innerHTML = `
                <div class="flex items-start justify-between gap-2">
                    <div><div class="text-xs text-slate-400">${esc(locationLabel(zoneLocation(sel)))}</div><div class="text-lg font-bold">${esc(sel.id)} <span class="text-slate-500 font-normal">${esc(sel.name)}</span></div>
                    <div class="text-xs text-slate-500">${esc(ZONE_TYPES[sel.zoneType] || '')} · ${fmt(sel.w)}×${fmt(sel.d)}m, 높이 ${fmt(sel.h)}m</div></div>
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
                        <div class="text-[11px] text-slate-500 mt-1">한 줄 ${sel.slots}칸 × ${sel.tiers || 1}단. 칸 위치는 고르지 않고, 적재 파렛트 수만큼 ${sel.fillFrom === 'END' ? '안쪽(반대쪽 끝)' : '줄 시작 쪽'} 1번 칸부터 차례로 칠해집니다.</div></div>`;
                })() : ''}
                <div class="text-sm font-bold">보관 품목 ${items.length}개</div>
                ${stockTable(items, { zone: sel, moveBtn: canMove && !isDefault })}`;
        } else {
            const un = unassignedStock(ui.wh).filter(i => !ui.unFilter || norm(i.code).includes(norm(ui.unFilter)) || norm(i.name).includes(norm(ui.unFilter)));
            const hitRows = hits ? [...hits.entries()] : [];
            side.innerHTML = `
                ${hits ? `<div><div class="text-sm font-bold mb-1">'${esc(ui.search)}' 위치 ${hitRows.length}곳</div>
                    ${hitRows.length ? hitRows.map(([id, items]) => `<button data-zone="${esc(id)}" class="w-full text-left border rounded-lg p-2 mb-1 hover:bg-yellow-50"><b>${esc(id)}</b> ${esc(zonesAll().find(r => r.id === id)?.name || '')}<div class="text-xs text-slate-500">${items.map(i => `${esc(i.name)} ${fmt(i.quantity)}${esc(i.unit || '')}`).join(', ')}</div></button>`).join('') : '<p class="text-xs text-slate-400">구획에 들어 있는 재고가 없습니다. 아래 구획 미지정 재고를 확인하세요.</p>'}</div>` : ''}
                <div class="border rounded-lg p-2 space-y-1.5">
                    <div class="text-sm font-bold">적재 현황</div>
                    ${ZONE_WAREHOUSES.filter(w => !ui.wh || w.code === ui.wh).map(w => {
                        const st = whStats(w.code), pct = st.cap ? Math.min(100, (st.used / st.cap) * 100) : 0;
                        return `<button data-wh="${esc(w.code)}" class="w-full text-left hover:bg-slate-50 rounded px-1 py-0.5">
                            <div class="flex justify-between text-xs"><b>${esc(w.label)}</b><span class="${st.used > st.cap && st.cap ? 'text-red-600 font-bold' : 'text-slate-500'}">${st.cap ? `${fmt(st.used)}/${fmt(st.cap)} 파렛트 · ${pctText(st.used, st.cap)}` : `구획 ${st.zones}곳 · ${st.items}품목`}</span></div>
                            ${st.cap ? `<div class="h-1.5 bg-slate-100 rounded-full mt-0.5 overflow-hidden"><div class="h-1.5 ${st.used > st.cap ? 'bg-red-500' : 'bg-blue-500'}" style="width:${pct}%"></div></div>` : ''}</button>`;
                    }).join('')}
                </div>
                <div><div class="text-sm font-bold mb-1">구획 ${zonesOf(ui.wh).length}곳 <span class="text-[11px] font-normal text-slate-400">누르면 3D에서 표시</span></div>
                <div class="grid grid-cols-2 gap-1">${zonesOf(ui.wh).map(z => {
                    const s = summarize(zoneStock(z)), cap = zoneCapacity(z), used = cap ? zonePallets(z) : 0;
                    return `<button data-zone="${esc(z.id)}" class="text-left border rounded-lg p-2 hover:bg-slate-50">
                        <div class="text-xs font-bold flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background:${s.count ? catColor(s.top) : EMPTY_COLOR}"></span>${esc(z.id)}
                            <span class="ml-auto font-normal ${cap && used > cap ? 'text-red-600' : 'text-slate-500'}">${cap ? `${fmt(used)}/${cap}` : ''}</span></div>
                        <div class="text-[11px] text-slate-500">${esc(z.name)} · ${s.count ? `${s.count}품목` : '비어 있음'}</div>
                        ${cap ? `<div class="h-1 bg-slate-100 rounded-full mt-1 overflow-hidden"><div class="h-1 ${used > cap ? 'bg-red-500' : 'bg-blue-500'}" style="width:${Math.min(100, (used / cap) * 100)}%"></div></div>` : ''}</button>`;
                }).join('')}</div></div>
                <div><div class="flex items-center justify-between mb-1"><div class="text-sm font-bold">구획 미지정 재고 <span class="text-slate-400 font-normal">${un.length}품목</span></div></div>
                <p class="text-[11px] text-slate-500 mb-1">김포공장(창고 미지정)·${ui.wh || '김포2A/2B/2C'} 창고 단위로 적힌 재고입니다. [구획 지정]으로 구획에 옮기세요${isDefault ? ' (배치 저장 후 가능)' : ''}.</p>
                <input id="w3-un-filter" value="${esc(ui.unFilter)}" placeholder="미지정 재고에서 찾기" class="border rounded-lg px-2 py-1 text-xs w-full mb-1">
                ${stockTable(un.slice(0, 200), { moveBtn: canMove && !isDefault })}
                ${un.length > 200 ? `<p class="text-[11px] text-slate-400">처음 200개만 보입니다. 위 칸으로 찾으세요.</p>` : ''}</div>`;
        }
        refreshIcons();
    };
    const refreshIcons = () => import('../services/icons.js').then(({ createIcons, icons }) => createIcons({ icons })).catch(e => console.warn(e));

    // ---------- 구획 지정·옮기기 창 ----------
    const openMove = ({ code, fromLoc, toZone = '' }) => {
        const inv = state.inventory.find(i => i.code === code && i.location === fromLoc);
        if (!inv) return;
        const options = zonesOf('').filter(z => zoneLocation(z) !== fromLoc)
            .map(z => `<option value="${esc(z.id)}" ${z.id === toZone ? 'selected' : ''}>${esc(z.id)} ${esc(z.name)}</option>`).join('');
        const m = $('#w3-modal');
        m.innerHTML = `<div class="bg-white rounded-xl w-full max-w-md p-4 space-y-3">
            <div class="font-bold">구획으로 옮기기</div>
            <div class="text-sm"><b>${esc(inv.name)}</b> <span class="text-slate-400">${esc(inv.code)}</span><div class="text-xs text-slate-500">지금 위치: ${esc(locationLabel(fromLoc))} · 재고 ${fmt(inv.quantity)} ${esc(inv.unit || '')}</div></div>
            <label class="block text-sm">옮길 구획<select id="w3-m-zone" class="w-full border rounded-lg px-2 py-2 mt-1">${options}</select></label>
            <label class="block text-sm">수량 (${esc(inv.unit || '')})<input id="w3-m-qty" type="number" step="any" min="0" value="${Number(inv.quantity)}" class="w-full border rounded-lg px-2 py-2 mt-1"></label>
            <label class="block text-sm">파렛트 수 <span class="text-[11px] text-slate-500">라인 칸에 칠해질 수 — 칸 위치는 고르지 않아도 1번 칸부터 차례로 채워집니다</span>
                <input id="w3-m-pal" type="number" step="1" min="0" value="1" class="w-full border rounded-lg px-2 py-2 mt-1"></label>
            <div id="w3-m-room" class="text-[11px] text-slate-500"></div>
            <p class="text-[11px] text-slate-500">같은 거점(김포공장) 안 이동이라 수불부·업무일지에는 기록되지 않고, 입출고 이력에만 남습니다.</p>
            <div class="flex justify-end gap-2"><button id="w3-m-cancel" class="px-3 py-2 text-sm border rounded-lg">취소</button><button id="w3-m-ok" class="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white">옮기기</button></div></div>`;
        m.classList.remove('hidden');
        const close = () => { m.classList.add('hidden'); m.innerHTML = ''; };
        const room = () => {
            const zone = zonesOf('').find(z => z.id === m.querySelector('#w3-m-zone').value);
            const cap = zone ? zoneCapacity(zone) : 0;
            m.querySelector('#w3-m-room').textContent = cap ? `${zone.id}: 지금 ${fmt(zonePallets(zone))} / ${cap}칸 적재 · 빈 칸 ${fmt(Math.max(0, cap - zonePallets(zone)))}` : '';
        };
        m.querySelector('#w3-m-zone').onchange = room;
        room();
        m.querySelector('#w3-m-cancel').onclick = close;
        m.querySelector('#w3-m-ok').onclick = async (ev) => {
            const zone = zonesOf('').find(z => z.id === m.querySelector('#w3-m-zone').value);
            const qty = Number(m.querySelector('#w3-m-qty').value);
            const pallets = Number(m.querySelector('#w3-m-pal').value);
            if (!(pallets >= 0)) { showToast('파렛트 수를 확인하세요.', 'error'); return; }
            if (!zone) { showToast('구획을 고르세요.', 'error'); return; }
            if (!(qty > 0) || qty > Number(inv.quantity) + 1e-9) { showToast('수량을 확인하세요.', 'error'); return; }
            ev.target.disabled = true;
            try {
                await moveToZone({ code, fromLoc, zone, qty, pallets });
                showToast(`${inv.name} ${fmt(qty)}${inv.unit || ''} (${fmt(pallets)}파렛트) → ${zone.id}`, 'success');
                close();
                ui.selected = zone.id;
                redraw();
            } catch (e) {
                showToast(e.message, 'error');
                ev.target.disabled = false;
            }
        };
    };

    // 선택 구획에 넣을 미지정 재고 고르기
    const openPut = (zone) => {
        const m = $('#w3-modal');
        const list = () => {
            const q = norm(m.querySelector('#w3-p-q')?.value || '');
            return unassignedStock('').filter(i => !q || norm(i.code).includes(q) || norm(i.name).includes(q)).slice(0, 100);
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
            if (b) openMove({ code: b.dataset.pick, fromLoc: b.dataset.from, toZone: zone.id });
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
                <div class="flex flex-wrap gap-2 items-center">가로 ${numInput('w', wh.w, wh.id)} 세로 ${numInput('d', wh.d, wh.id)} 벽 높이 ${numInput('h', wh.h, wh.id)} m</div>
            </div>
            <div class="flex items-center justify-between"><div class="text-sm font-bold">구획 ${zs.length}곳</div><button id="w3-e-add" class="px-2 py-1 text-xs rounded bg-slate-800 text-white">+ 구획 추가</button></div>
            <table class="w-full text-xs"><thead class="text-slate-500"><tr><th class="text-left">코드·이름·종류</th><th>x</th><th>z</th><th>가로</th><th>세로</th><th>높이</th><th title="한 줄 파렛트 칸 수 × 단 (0이면 칸 없음)">칸×단</th><th></th></tr></thead><tbody>
            ${zs.map(z => `<tr class="border-t align-top"><td class="py-1 pr-1"><div class="font-bold">${esc(z.id)}</div><input data-f="name" data-id="${esc(z.id)}" value="${esc(z.name)}" class="w-24 border rounded px-1 py-0.5 mt-0.5">
                <select data-f="zoneType" data-id="${esc(z.id)}" class="border rounded px-1 py-0.5 mt-0.5">${Object.entries(ZONE_TYPES).map(([k, v]) => `<option value="${k}" ${z.zoneType === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
                <td class="py-1">${numInput('x', z.x, z.id)}</td><td class="py-1">${numInput('z', z.z, z.id)}</td><td class="py-1">${numInput('w', z.w, z.id)}</td><td class="py-1">${numInput('d', z.d, z.id)}</td><td class="py-1">${numInput('h', z.h, z.id)}</td>
                <td class="py-1 whitespace-nowrap">${numInput('slots', z.slots || 0, z.id)}×${numInput('tiers', z.tiers || 1, z.id)}
                    <select data-f="fillFrom" data-id="${esc(z.id)}" class="border rounded px-1 py-0.5 mt-0.5 block" title="파렛트를 채우기 시작하는 쪽"><option value="START" ${z.fillFrom !== 'END' ? 'selected' : ''}>시작 쪽부터</option><option value="END" ${z.fillFrom === 'END' ? 'selected' : ''}>반대쪽부터</option></select></td>
                <td class="py-1"><button data-del="${esc(z.id)}" class="text-red-500 px-1" title="구획 삭제">✕</button></td></tr>`).join('')}
            </tbody></table>
            <p class="text-[11px] text-slate-500">재고가 남은 구획은 지울 수 없습니다. 구획코드는 저장 뒤 재고 위치 이름이 되므로 번호를 바꾸지 않습니다.</p>`;
    };

    const startEdit = () => {
        ui.edit = true;
        ui.draft = rows.map(r => ({ ...r }));
        ui.wh = ui.wh || ZONE_WAREHOUSES[0].code;
        ui.selected = '';
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

    // ---------- 이벤트 ----------
    container.addEventListener('click', async (ev) => {
        const t = ev.target.closest('button');
        if (!t || !container.contains(t)) return;
        if (t.dataset.wh !== undefined) { ui.wh = t.dataset.wh; ui.selected = ''; renderChips(); redraw(); view?.focus(ui.edit ? 'top' : 'persp'); return; }
        if (t.dataset.zone) { ui.selected = t.dataset.zone; redraw(); return; }
        if (t.dataset.move) { openMove({ code: t.dataset.move, fromLoc: t.dataset.from }); return; }
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
            case 'w3-edit': (ui.edit ? stopEdit : startEdit)(); break;
            case 'w3-close': ui.selected = ''; redraw(); break;
            case 'w3-audit': window.__auditLocation = zoneLocation(zonesAll().find(r => r.id === ui.selected)); onSwitchTab('audit'); break;
            case 'w3-put': openPut(zonesAll().find(r => r.id === ui.selected)); break;
            case 'w3-zone-qr': {
                const z = zonesAll().find(r => r.id === ui.selected);
                const url = await qrDataUrl(fieldQrUrl('LOC', zoneLocation(z)), { width: 220 });
                $('#w3-qr-box').innerHTML = `<div class="flex items-center gap-3 border rounded-lg p-2"><img src="${url}" class="w-28 h-28" alt="위치 QR"><div class="text-xs text-slate-600">현장 스캔으로 찍으면 이 구획이 위치로 잡힙니다.<br>여러 장 인쇄는 [구획 QR 라벨](현장 QR 라벨)에서 하세요.${isDefault ? '<br><b class="text-amber-600">배치를 저장해야 쓸 수 있습니다.</b>' : ''}</div></div>`;
                break;
            }
            case 'w3-e-cancel': stopEdit(); break;
            case 'w3-e-add': {
                const wh = whRow(ui.wh);
                const zs = zonesOf(ui.wh);
                const last = zs[zs.length - 1];
                const id = nextZoneId(ui.draft, ui.wh);
                ui.draft.push({ id, kind: 'ZONE', warehouse: ui.wh, site: wh.site, name: `${zs.length + 1}라인`, zoneType: 'RACK',
                    x: last ? Math.min(last.x + last.w + 1.5, Math.max(wh.w - 4, 0)) : 1, z: last ? last.z : 1, w: last?.w || 4, d: last?.d || 10, h: last?.h || 4, slots: last?.slots || 0, tiers: last?.tiers || 1, sort: zs.length + 1, note: last?.note || '' });
                redraw();
                break;
            }
            case 'w3-e-save': {
                t.disabled = true;
                try {
                    await saveZones(ui.draft);
                    rows = ui.draft.map(r => ({ ...r }));
                    isDefault = false;
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
    // 라인 안 품목의 파렛트 수 고치기
    container.addEventListener('change', async (ev) => {
        const el = ev.target;
        if (!el.dataset?.pallets || !ui.selected) return;
        try {
            await setZoneLoad(ui.selected, el.dataset.pallets, Number(el.value));
            redraw();
        } catch (e) { showToast(e.message, 'error'); }
    });
    container.addEventListener('input', (ev) => {
        const el = ev.target;
        if (el.id === 'w3-search') { ui.search = el.value.trim(); ui.selected = ''; redraw(); return; }
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
            r[el.dataset.f] = el.type === 'number' ? Number(el.value) || 0 : el.value;
            view?.rebuild();
        }
    });

    // ---------- 시작 ----------
    try {
        const res = await loadZones();
        rows = res.rows;
        isDefault = res.isDefault;
        await loadZoneLoads().catch(e => showToast(e.message, 'error'));
    } catch (e) {
        showToast(e.message, 'error');
        rows = [];
    }
    renderChips();
    renderSide();
    renderSum();
    await buildView();
};
