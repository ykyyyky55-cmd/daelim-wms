// ==========================================
// 창고 배치도 (3D) — 김포2공장 창고(2A·2B·2C)의 구획(라인)과 구획별 재고
// ==========================================
// · 3D(three.js, 동적 import): 창고 바닥·벽 윤곽 + 구획 상자. 상자 색 = 가장 많은 품목 분류(원료·원액·완제품·부자재), 빈 구획은 회색.
// · 구획을 누르면 오른쪽에 그 구획 재고, 품목 검색은 들어 있는 구획만 밝게.
// · 구획 미지정 재고(김포공장·김포2A/2B/2C 창고 단위)를 [구획 지정]으로 구획에 옮긴다(같은 거점 안 이동 — 수불부·업무일지 기록 없음).
// · 배치 편집(매니저): 창고 크기·위치, 구획 추가·삭제·위치·크기(m). 저장하면 구획 위치가 입출고·이동·실사 위치 선택과 위치 QR에 생긴다.
import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
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
                <button id="w3-reset" class="px-3 py-2 text-sm border rounded-lg bg-white hover:bg-slate-50">시점 초기화</button>
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
                <div class="absolute left-2 bottom-2 flex flex-wrap gap-2 text-[11px] text-white/90 bg-black/40 rounded-lg px-2 py-1">
                    ${Object.entries(CAT_COLORS).map(([k, c]) => `<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm" style="background:${c}"></span>${k}</span>`).join('')}
                    <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm" style="background:${OTHER_COLOR}"></span>기타</span>
                    <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm" style="background:${EMPTY_COLOR}"></span>빈 구획</span>
                </div>
            </div>
            <div id="w3-side" class="bg-white border rounded-xl p-3 space-y-3 lg:h-[620px] overflow-y-auto"></div>
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
        host.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#0f172a');
        const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.maxPolarAngle = Math.PI / 2 - 0.05;
        scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1));
        const sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.position.set(40, 80, 30);
        scene.add(sun);

        let group = new THREE.Group();
        scene.add(group);
        let pickables = [];
        let bounds = { cx: 0, cz: 0, span: 60 };
        const disposables = [];
        const track = (o) => { disposables.push(o); return o; };

        const labelSprite = (text, { size = 48, color = '#ffffff', bg = 'rgba(15,23,42,0.75)', scale = 1 } = {}) => {
            const cv = document.createElement('canvas');
            const ctx = cv.getContext('2d');
            ctx.font = `bold ${size}px sans-serif`;
            const lines = String(text).split('\n');
            const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + size;
            const h = lines.length * size * 1.25 + size * 0.5;
            cv.width = Math.ceil(w); cv.height = Math.ceil(h);
            ctx.font = `bold ${size}px sans-serif`;
            ctx.fillStyle = bg;
            ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, cv.width, cv.height, size * 0.3) : ctx.rect(0, 0, cv.width, cv.height); ctx.fill();
            ctx.fillStyle = color; ctx.textBaseline = 'top';
            lines.forEach((l, i) => ctx.fillText(l, size / 2, size * 0.25 + i * size * 1.25));
            const tex = track(new THREE.CanvasTexture(cv));
            tex.colorSpace = THREE.SRGBColorSpace;
            const mat = track(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
            const sp = new THREE.Sprite(mat);
            const k = 0.02 * scale;
            sp.scale.set(cv.width * k, cv.height * k, 1);
            sp.renderOrder = 10;
            return sp;
        };

        const rebuild = () => {
            scene.remove(group);
            disposables.splice(0).forEach(o => o.dispose?.());
            group = new THREE.Group();
            scene.add(group);
            pickables = [];
            const hits = searchHits();
            const whs = zonesAll().filter(r => r.kind === 'WAREHOUSE');
            let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
            // 도면 주변: 부지 바닥 · 경계선(점선) · 오수처리시설 (참고용, 누를 수 없음)
            const bpts = SITE_EXTRAS.boundaries.flatMap(b => b.points);
            if (bpts.length) {
                const xs = [...bpts.map(p => p[0]), ...whs.map(w => w.x), ...whs.map(w => w.x + w.w)];
                const zs = [...bpts.map(p => p[1]), ...whs.map(w => w.z), ...whs.map(w => w.z + w.d)];
                const gx0 = Math.min(...xs) - 4, gx1 = Math.max(...xs) + 4, gz0 = Math.min(...zs) - 4, gz1 = Math.max(...zs) + 4;
                const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(gx1 - gx0, gz1 - gz0)), track(new THREE.MeshStandardMaterial({ color: '#334155' })));
                ground.rotation.x = -Math.PI / 2;
                ground.position.set((gx0 + gx1) / 2, -0.02, (gz0 + gz1) / 2);
                group.add(ground);
            }
            SITE_EXTRAS.boundaries.forEach(b => {
                const geo = track(new THREE.BufferGeometry().setFromPoints(b.points.map(([x, z]) => new THREE.Vector3(x, 0.05, z))));
                const line = new THREE.Line(geo, track(new THREE.LineDashedMaterial({ color: '#fbbf24', dashSize: 1, gapSize: 0.6 })));
                line.computeLineDistances();
                group.add(line);
                const mid = b.points[Math.floor(b.points.length / 2)];
                const lab = labelSprite(b.name, { size: 34, color: '#fde68a', bg: 'rgba(15,23,42,0.6)' });
                lab.position.set(mid[0] + 1.5, 0.8, mid[1]);
                group.add(lab);
            });
            SITE_EXTRAS.facilities.forEach(fc => {
                const box = new THREE.Mesh(track(new THREE.BoxGeometry(fc.w, fc.h, fc.d)), track(new THREE.MeshStandardMaterial({ color: '#0ea5e9', transparent: true, opacity: 0.75 })));
                box.position.set(fc.x + fc.w / 2, fc.h / 2, fc.z + fc.d / 2);
                group.add(box);
                const lab = labelSprite(fc.name, { size: 32, color: '#e0f2fe', bg: 'rgba(3,105,161,0.8)' });
                lab.position.set(fc.x + fc.w / 2 + 2.5, fc.h + 0.8, fc.z + fc.d / 2);
                group.add(lab);
            });
            whs.forEach(wh => {
                minX = Math.min(minX, wh.x - 9); minZ = Math.min(minZ, wh.z); maxX = Math.max(maxX, wh.x + wh.w); maxZ = Math.max(maxZ, wh.z + wh.d);
                const dim = ui.wh && ui.wh !== wh.id;
                // 바닥
                const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(wh.w, wh.d)), track(new THREE.MeshStandardMaterial({ color: dim ? '#1e293b' : '#e2e8f0', transparent: true, opacity: dim ? 0.5 : 1 })));
                floor.rotation.x = -Math.PI / 2;
                floor.position.set(wh.x + wh.w / 2, 0, wh.z + wh.d / 2);
                group.add(floor);
                // 벽 윤곽
                const edges = new THREE.LineSegments(track(new THREE.EdgesGeometry(track(new THREE.BoxGeometry(wh.w, wh.h, wh.d)))), track(new THREE.LineBasicMaterial({ color: dim ? '#475569' : '#94a3b8' })));
                edges.position.set(wh.x + wh.w / 2, wh.h / 2, wh.z + wh.d / 2);
                group.add(edges);
                const wl = labelSprite(`${wh.id} ${wh.name || ''}\n${fmt(wh.w)} × ${fmt(wh.d)} m`, { size: 56, scale: 1.4 });
                // 이름표는 동 서쪽 바깥 (동이 붙어 있어 북쪽 벽 위에 두면 옆 동을 가림)
                wl.position.set(wh.x - wl.scale.x / 2 - 1, wh.h * 0.6, wh.z + wh.d / 2);
                group.add(wl);
            });
            zonesOf('').forEach(z => {
                const wh = whRow(z.warehouse);
                if (!wh) return;
                const stock = zoneStock(z);
                const sum = summarize(stock);
                const color = sum.count ? catColor(sum.top) : EMPTY_COLOR;
                const selected = ui.selected === z.id;
                const dimmed = (hits && !hits.has(z.id)) || (ui.wh && ui.wh !== z.warehouse);
                const mat = track(new THREE.MeshStandardMaterial({
                    color, transparent: true, opacity: dimmed ? 0.18 : (sum.count ? 0.9 : 0.45),
                    emissive: selected ? '#2563eb' : (hits?.has(z.id) ? '#facc15' : '#000000'), emissiveIntensity: selected || hits?.has(z.id) ? 0.6 : 0
                }));
                const box = new THREE.Mesh(track(new THREE.BoxGeometry(z.w, z.h, z.d)), mat);
                const cx = wh.x + z.x + z.w / 2, cz = wh.z + z.z + z.d / 2;
                box.position.set(cx, z.h / 2, cz);
                box.userData.zoneId = z.id;
                group.add(box);
                pickables.push(box);
                const ed = new THREE.LineSegments(track(new THREE.EdgesGeometry(box.geometry)), track(new THREE.LineBasicMaterial({ color: selected ? '#60a5fa' : '#0f172a' })));
                ed.position.copy(box.position);
                group.add(ed);
                if (!dimmed || selected) {
                    const short = z.id.split('-').pop();
                    // 라인이 많으면(파렛트 열) 번호만 작게 — 고른 구획은 자세히
                    const dense = !selected && zonesOf(ui.wh).length > 8;
                    const text = dense ? `${short}${sum.count ? ` · ${sum.count}` : ''}` : `${short} ${z.name || ''}\n${sum.count ? `${sum.count}품목` : '비어 있음'}`;
                    const lab = labelSprite(text, { size: dense ? 30 : 40, bg: selected ? 'rgba(37,99,235,0.9)' : 'rgba(15,23,42,0.75)' });
                    lab.position.set(cx, z.h + 1.2, cz);
                    group.add(lab);
                }
            });
            if (Number.isFinite(minX)) bounds = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, span: Math.max(maxX - minX, maxZ - minZ, 20) };
            render();
        };

        const focus = (mode = 'persp') => {
            let { cx, cz, span } = bounds;
            const wh = ui.wh && whRow(ui.wh);
            if (wh) { cx = wh.x + wh.w / 2; cz = wh.z + wh.d / 2; span = Math.max(wh.w, wh.d, 12); }
            controls.target.set(cx, 0, cz);
            if (mode === 'top') camera.position.set(cx, span * 1.6, cz + 0.01);
            else camera.position.set(cx + span * 0.15, span * 0.75, cz + span * 0.95);
            controls.update();
            render();
        };

        const render = () => renderer.render(scene, camera);
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
            if (!id) { tip.classList.add('hidden'); return; }
            const z = zonesAll().find(r => r.id === id);
            const s = summarize(zoneStock(z));
            const r = renderer.domElement.getBoundingClientRect();
            tip.innerHTML = `<b>${esc(z.id)}</b> ${esc(z.name)}<br>${s.count ? Object.entries(s.byCat).map(([k, v]) => `${esc(k)} ${v}`).join(' · ') : '비어 있음'}`;
            tip.style.left = `${ev.clientX - r.left + 12}px`;
            tip.style.top = `${ev.clientY - r.top + 12}px`;
            tip.classList.remove('hidden');
        };
        const el = renderer.domElement;
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerleave', () => tip.classList.add('hidden'));

        // 화면을 떠나면 정리
        const watch = setInterval(() => { if (!host.isConnected) dispose(); }, 2000);
        let disposed = false;
        const dispose = () => {
            if (disposed) return;
            disposed = true;
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
        focus();
        return api;
    };

    const redraw = () => { view?.rebuild(); renderSide(); };

    // ---------- 칩·안내 ----------
    const renderChips = () => {
        const chip = (val, label) => `<button data-wh="${esc(val)}" class="px-3 py-1.5 rounded-full text-sm border ${ui.wh === val ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 hover:bg-slate-50'}">${esc(label)}</button>`;
        $('#w3-chips').innerHTML = (ui.edit ? '' : chip('', '김포2공장 전체')) + ZONE_WAREHOUSES.map(w => chip(w.code, w.label)).join('');
        $('#w3-banner').innerHTML = isDefault && !ui.edit
            ? `<div class="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">아직 저장된 배치가 없어 <b>기본 배치</b>를 보여 줍니다. 동 크기·배치(C동(사무동) 9.5×6.9m · A동 13×25m · B동 20×13m, 1.5m 간격)는 배치도 도면 치수, 라인은 파렛트 6개 × 2단 열 배치이고 벽 높이는 예시입니다. ${canEdit ? '[배치 편집]에서 실제 창고 크기·구획을 맞춘 뒤 저장하면 구획에 재고를 넣을 수 있습니다.' : '매니저가 배치를 저장하면 구획에 재고를 넣을 수 있습니다.'}</div>`
            : ui.edit ? '<div class="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg px-3 py-2">배치 편집 중: 창고를 고르고 오른쪽 표에서 크기·위치(m)를 고치면 3D에 바로 보입니다. 위치 x·z는 창고 왼쪽 위 모서리 기준입니다. [저장]을 눌러야 반영됩니다.</div>' : '';
    };

    // ---------- 오른쪽 ----------
    const stockTable = (items, { zone = null, moveBtn = false } = {}) => items.length ? `
        <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-500"><tr><th class="p-1.5 text-left">품목</th><th class="p-1.5 text-right">재고</th>${moveBtn ? '<th></th>' : ''}</tr></thead><tbody>
        ${items.map(i => `<tr class="border-t"><td class="p-1.5"><span class="inline-block w-2 h-2 rounded-sm mr-1" style="background:${catColor(i.category)}"></span><b>${esc(i.name)}</b><div class="text-slate-400">${esc(i.code)} · ${esc(i.category || '')}${zone ? '' : ` · ${esc(buildingOf(i.location) || '창고 미지정')}`}</div></td>
            <td class="p-1.5 text-right whitespace-nowrap font-bold">${fmt(i.quantity)} <span class="text-slate-400 font-normal">${esc(i.unit || '')}</span></td>
            ${moveBtn ? `<td class="p-1.5 text-right"><button data-move="${esc(i.code)}" data-from="${esc(i.location)}" class="px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 whitespace-nowrap">${zone ? '옮기기' : '구획 지정'}</button></td>` : ''}</tr>`).join('')}
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
                <div class="text-sm font-bold">보관 품목 ${items.length}개</div>
                ${stockTable(items, { zone: sel, moveBtn: canMove && !isDefault })}`;
        } else {
            const un = unassignedStock(ui.wh).filter(i => !ui.unFilter || norm(i.code).includes(norm(ui.unFilter)) || norm(i.name).includes(norm(ui.unFilter)));
            const hitRows = hits ? [...hits.entries()] : [];
            side.innerHTML = `
                ${hits ? `<div><div class="text-sm font-bold mb-1">'${esc(ui.search)}' 위치 ${hitRows.length}곳</div>
                    ${hitRows.length ? hitRows.map(([id, items]) => `<button data-zone="${esc(id)}" class="w-full text-left border rounded-lg p-2 mb-1 hover:bg-yellow-50"><b>${esc(id)}</b> ${esc(zonesAll().find(r => r.id === id)?.name || '')}<div class="text-xs text-slate-500">${items.map(i => `${esc(i.name)} ${fmt(i.quantity)}${esc(i.unit || '')}`).join(', ')}</div></button>`).join('') : '<p class="text-xs text-slate-400">구획에 들어 있는 재고가 없습니다. 아래 구획 미지정 재고를 확인하세요.</p>'}</div>` : ''}
                <div><div class="text-sm font-bold mb-1">구획 ${zonesOf(ui.wh).length}곳</div>
                <div class="grid grid-cols-2 gap-1">${zonesOf(ui.wh).map(z => { const s = summarize(zoneStock(z)); return `<button data-zone="${esc(z.id)}" class="text-left border rounded-lg p-2 hover:bg-slate-50"><div class="text-xs font-bold flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm" style="background:${s.count ? catColor(s.top) : EMPTY_COLOR}"></span>${esc(z.id)}</div><div class="text-[11px] text-slate-500">${esc(z.name)} · ${s.count ? `${s.count}품목` : '비어 있음'}</div></button>`; }).join('')}</div></div>
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
            <p class="text-[11px] text-slate-500">같은 거점(김포공장) 안 이동이라 수불부·업무일지에는 기록되지 않고, 입출고 이력에만 남습니다.</p>
            <div class="flex justify-end gap-2"><button id="w3-m-cancel" class="px-3 py-2 text-sm border rounded-lg">취소</button><button id="w3-m-ok" class="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white">옮기기</button></div></div>`;
        m.classList.remove('hidden');
        const close = () => { m.classList.add('hidden'); m.innerHTML = ''; };
        m.querySelector('#w3-m-cancel').onclick = close;
        m.querySelector('#w3-m-ok').onclick = async (ev) => {
            const zone = zonesOf('').find(z => z.id === m.querySelector('#w3-m-zone').value);
            const qty = Number(m.querySelector('#w3-m-qty').value);
            if (!zone) { showToast('구획을 고르세요.', 'error'); return; }
            if (!(qty > 0) || qty > Number(inv.quantity) + 1e-9) { showToast('수량을 확인하세요.', 'error'); return; }
            ev.target.disabled = true;
            try {
                await moveToZone({ code, fromLoc, zone, qty });
                showToast(`${inv.name} ${fmt(qty)}${inv.unit || ''} → ${zone.id}`, 'success');
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
            <table class="w-full text-xs"><thead class="text-slate-500"><tr><th class="text-left">코드·이름·종류</th><th>x</th><th>z</th><th>가로</th><th>세로</th><th>높이</th><th></th></tr></thead><tbody>
            ${zs.map(z => `<tr class="border-t align-top"><td class="py-1 pr-1"><div class="font-bold">${esc(z.id)}</div><input data-f="name" data-id="${esc(z.id)}" value="${esc(z.name)}" class="w-24 border rounded px-1 py-0.5 mt-0.5">
                <select data-f="zoneType" data-id="${esc(z.id)}" class="border rounded px-1 py-0.5 mt-0.5">${Object.entries(ZONE_TYPES).map(([k, v]) => `<option value="${k}" ${z.zoneType === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
                <td class="py-1">${numInput('x', z.x, z.id)}</td><td class="py-1">${numInput('z', z.z, z.id)}</td><td class="py-1">${numInput('w', z.w, z.id)}</td><td class="py-1">${numInput('d', z.d, z.id)}</td><td class="py-1">${numInput('h', z.h, z.id)}</td>
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
                    x: last ? Math.min(last.x + last.w + 1.5, Math.max(wh.w - 4, 0)) : 1, z: last ? last.z : 1, w: last?.w || 4, d: last?.d || 10, h: last?.h || 4, sort: zs.length + 1, note: '' });
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
    } catch (e) {
        showToast(e.message, 'error');
        rows = [];
    }
    renderChips();
    renderSide();
    await buildView();
};
