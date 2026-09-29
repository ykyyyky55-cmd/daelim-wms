import { createIcons, icons } from '../../services/icons.js';
import { esc } from '../../services/html.js';

/**
 * 이미지 뷰어·간단 편집기 — 이 브라우저 안에서만 처리 (서버로 올리지 않음)
 * - 열기: 파일 선택(여러 장)·끌어다 놓기·붙여넣기(Ctrl+V). jpg·png·gif·webp·bmp·svg·avif (HEIC는 브라우저가 못 읽음)
 * - 보기: 화면 맞춤·100%·확대/축소(휠·단추·+/−), 끌어서 이동, 이전/다음(←/→), 썸네일 목록, 전체화면, 정보(크기·해상도)
 * - 편집: 회전(90°)·좌우/상하 반전, 자르기(끌어서 영역), 밝기·대비·채도·흑백, 크기 조정(가로 px, 비율 유지), 원래대로
 * - 저장: PNG·JPG·WEBP(품질), 클립보드 복사, 인쇄
 * 편집은 원본을 바꾸지 않고, 저장할 때 캔버스로 새 파일을 만든다.
 */
const TYPES = /^image\/(jpeg|png|gif|webp|bmp|svg\+xml|avif|x-icon|vnd\.microsoft\.icon)$/;
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const blankEdits = () => ({ rot: 0, flipH: false, flipV: false, crop: null, bright: 100, contrast: 100, sat: 100, gray: false, width: 0 });

export const renderImageViewer = (el, opts = {}) => {
    const { showToast = () => {} } = opts;
    let items = []; // { name, size, type, url, img, edits }
    let idx = -1;
    let zoom = 1, fit = true, panX = 0, panY = 0;
    let cropMode = false, cropRect = null;
    let dirty = false;

    el.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" id="iv-root">
        <div class="flex flex-wrap items-center gap-1.5 p-2 border-b border-slate-200 bg-slate-50 text-xs font-bold">
            <label class="iv-btn cursor-pointer !bg-indigo-600 !text-white !border-indigo-600"><i data-lucide="folder-open" class="w-4 h-4"></i>이미지 열기<input type="file" id="iv-open" accept="image/*" multiple class="hidden" /></label>
            <span class="w-px h-5 bg-slate-300 mx-0.5"></span>
            <button type="button" class="iv-btn" data-act="prev" title="이전 (←)"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
            <button type="button" class="iv-btn" data-act="next" title="다음 (→)"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
            <button type="button" class="iv-btn" data-act="zoomOut" title="축소 (−)"><i data-lucide="zoom-out" class="w-4 h-4"></i></button>
            <span id="iv-zoom" class="min-w-[48px] text-center text-slate-600">-</span>
            <button type="button" class="iv-btn" data-act="zoomIn" title="확대 (+)"><i data-lucide="zoom-in" class="w-4 h-4"></i></button>
            <button type="button" class="iv-btn" data-act="fit" title="화면 맞춤 (0)"><i data-lucide="maximize-2" class="w-4 h-4"></i>맞춤</button>
            <button type="button" class="iv-btn" data-act="actual" title="실제 크기 (1)">100%</button>
            <button type="button" class="iv-btn" data-act="full" title="전체화면 (F)"><i data-lucide="expand" class="w-4 h-4"></i></button>
            <span class="w-px h-5 bg-slate-300 mx-0.5"></span>
            <button type="button" class="iv-btn" data-act="rotL" title="왼쪽으로 회전"><i data-lucide="rotate-ccw" class="w-4 h-4"></i></button>
            <button type="button" class="iv-btn" data-act="rotR" title="오른쪽으로 회전 (R)"><i data-lucide="rotate-cw" class="w-4 h-4"></i></button>
            <button type="button" class="iv-btn" data-act="flipH" title="좌우 반전"><i data-lucide="flip-horizontal-2" class="w-4 h-4"></i></button>
            <button type="button" class="iv-btn" data-act="flipV" title="상하 반전"><i data-lucide="flip-vertical-2" class="w-4 h-4"></i></button>
            <button type="button" class="iv-btn" data-act="crop" id="iv-crop-btn" title="자르기 (C)"><i data-lucide="crop" class="w-4 h-4"></i>자르기</button>
            <button type="button" class="iv-btn" data-act="reset" title="편집 모두 되돌리기"><i data-lucide="undo-2" class="w-4 h-4"></i>원래대로</button>
            <span class="w-px h-5 bg-slate-300 mx-0.5"></span>
            <select id="iv-format" class="border border-slate-300 rounded-lg px-1.5 py-1 bg-white"><option value="image/png">PNG</option><option value="image/jpeg">JPG</option><option value="image/webp">WEBP</option></select>
            <button type="button" class="iv-btn !bg-emerald-600 !text-white !border-emerald-600" data-act="save"><i data-lucide="download" class="w-4 h-4"></i>저장</button>
            <button type="button" class="iv-btn" data-act="copy" title="클립보드로 복사"><i data-lucide="copy" class="w-4 h-4"></i></button>
            <button type="button" class="iv-btn" data-act="print" title="인쇄"><i data-lucide="printer" class="w-4 h-4"></i></button>
            <button type="button" class="iv-btn text-rose-600" data-act="close" title="이 이미지 닫기"><i data-lucide="x" class="w-4 h-4"></i></button>
        </div>
        <div class="flex flex-col lg:flex-row">
            <div class="flex-1 min-w-0">
                <div id="iv-stage" class="relative bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:20px_20px] overflow-hidden h-[62vh] min-h-[320px] select-none touch-none">
                    <div id="iv-empty" class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400 text-sm font-bold text-center p-6">
                        <i data-lucide="image" class="w-10 h-10"></i>
                        이미지를 끌어다 놓거나, [이미지 열기]를 누르거나, 복사한 이미지를 <b>Ctrl+V</b>로 붙여넣으세요.
                        <span class="text-[11px] font-normal">여러 장을 한 번에 열 수 있습니다 · jpg·png·gif·webp·bmp·svg·avif</span>
                    </div>
                    <canvas id="iv-canvas" class="absolute left-0 top-0 origin-top-left hidden" style="image-rendering:auto"></canvas>
                    <div id="iv-crop" class="absolute border-2 border-dashed border-indigo-500 bg-indigo-500/10 hidden pointer-events-none"></div>
                </div>
                <div id="iv-thumbs" class="flex gap-1.5 p-2 overflow-x-auto border-t border-slate-200 bg-slate-50 min-h-[64px]"></div>
            </div>
            <aside class="lg:w-64 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 p-3 space-y-3 text-xs">
                <div id="iv-info" class="space-y-0.5 text-slate-600"><div class="text-slate-400">열린 이미지가 없습니다.</div></div>
                <div id="iv-crop-bar" class="hidden p-2 rounded-lg bg-indigo-50 border border-indigo-200 space-y-1.5">
                    <div class="font-bold text-indigo-900">자를 영역을 끌어서 고르세요.</div>
                    <div class="flex gap-1.5"><button type="button" data-act="cropApply" class="iv-btn !bg-indigo-600 !text-white !border-indigo-600">자르기 적용</button><button type="button" data-act="cropCancel" class="iv-btn">취소</button></div>
                </div>
                <div class="space-y-2">
                    <div class="font-black text-slate-700">보정</div>
                    ${[['bright', '밝기'], ['contrast', '대비'], ['sat', '채도']].map(([k, l]) => `<label class="block"><span class="flex justify-between text-slate-600">${l}<b id="iv-${k}-v">100%</b></span><input type="range" min="0" max="200" value="100" data-adj="${k}" class="iv-adj w-full" /></label>`).join('')}
                    <label class="flex items-center gap-2 font-bold text-slate-700"><input type="checkbox" id="iv-gray" />흑백</label>
                </div>
                <div class="space-y-1">
                    <div class="font-black text-slate-700">크기 조정 <span class="font-normal text-slate-400">(저장할 때, 비율 유지)</span></div>
                    <div class="flex items-center gap-1"><input type="number" id="iv-width" min="1" placeholder="가로 px" class="w-24 border border-slate-300 rounded-lg px-2 py-1" /><span class="text-slate-400">px</span><span id="iv-height" class="text-slate-500"></span></div>
                    <div class="flex gap-1">${[25, 50, 75].map(p => `<button type="button" class="iv-pct px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 font-bold" data-pct="${p}">${p}%</button>`).join('')}<button type="button" class="iv-pct px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 font-bold" data-pct="0">원래</button></div>
                </div>
                <label class="block"><span class="flex justify-between text-slate-600">JPG·WEBP 품질<b id="iv-q-v">90</b></span><input type="range" id="iv-quality" min="40" max="100" value="90" class="w-full" /></label>
                <p class="text-[11px] text-slate-400 leading-relaxed">휠 = 확대/축소 · 끌기 = 이동 · ←/→ 이전·다음 · R 회전 · C 자르기 · F 전체화면. 편집은 원본 파일을 바꾸지 않고 [저장]할 때 새 파일로 받습니다.</p>
            </aside>
        </div>
    </div>`;
    const style = document.createElement('style');
    style.textContent = '#iv-root .iv-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155}#iv-root .iv-btn:hover{background:#f1f5f9}#iv-root .iv-btn.on{background:#4f46e5;color:#fff;border-color:#4f46e5}';
    el.appendChild(style);
    createIcons({ icons });
    const $ = (s) => el.querySelector(s);
    const stage = $('#iv-stage'), canvas = $('#iv-canvas'), cropBox = $('#iv-crop');
    const cur = () => items[idx] || null;

    // ---------- 그리기 (회전·반전 → 자르기 → 보정) ----------
    const filterOf = (e) => `brightness(${e.bright}%) contrast(${e.contrast}%) saturate(${e.sat}%)${e.gray ? ' grayscale(100%)' : ''}`;
    const baseDims = (it) => { const r = ((it.edits.rot % 360) + 360) % 360; const w = it.img.naturalWidth || it.img.width, h = it.img.naturalHeight || it.img.height; return r % 180 ? [h, w] : [w, h]; };
    const outDims = (it) => { const [w, h] = baseDims(it); const c = it.edits.crop; return c ? [c.w, c.h] : [w, h]; };
    const renderTo = (cv, it, scaleW = 0) => {
        const e = it.edits;
        const [bw, bh] = baseDims(it);
        // 1) 회전·반전한 전체 이미지
        const a = document.createElement('canvas'); a.width = bw; a.height = bh;
        const ax = a.getContext('2d');
        ax.translate(bw / 2, bh / 2);
        ax.rotate((e.rot * Math.PI) / 180);
        ax.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
        const w0 = it.img.naturalWidth || it.img.width, h0 = it.img.naturalHeight || it.img.height;
        ax.drawImage(it.img, -w0 / 2, -h0 / 2, w0, h0);
        // 2) 자르기 3) 보정·크기
        const c = e.crop || { x: 0, y: 0, w: bw, h: bh };
        const outW = scaleW > 0 ? Math.round(scaleW) : c.w;
        const outH = Math.max(1, Math.round(c.h * (outW / c.w)));
        cv.width = outW; cv.height = outH;
        const cx = cv.getContext('2d');
        cx.filter = filterOf(e);
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(a, c.x, c.y, c.w, c.h, 0, 0, outW, outH);
        cx.filter = 'none';
    };
    const applyView = () => {
        const it = cur();
        if (!it) return;
        const [w, h] = [canvas.width, canvas.height];
        const sw = stage.clientWidth, sh = stage.clientHeight;
        if (fit) { zoom = Math.min(1, (sw - 20) / w, (sh - 20) / h); panX = (sw - w * zoom) / 2; panY = (sh - h * zoom) / 2; }
        canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        $('#iv-zoom').textContent = `${Math.round(zoom * 100)}%`;
    };
    const redraw = () => {
        const it = cur();
        $('#iv-empty').classList.toggle('hidden', !!it);
        canvas.classList.toggle('hidden', !it);
        drawThumbs();
        if (!it) { $('#iv-info').innerHTML = '<div class="text-slate-400">열린 이미지가 없습니다.</div>'; $('#iv-zoom').textContent = '-'; return; }
        renderTo(canvas, it);
        applyView();
        const e = it.edits;
        const [ow, oh] = outDims(it);
        const sw = e.width > 0 ? e.width : ow, shh = Math.round(oh * (sw / ow));
        $('#iv-info').innerHTML = `<div class="font-black text-slate-900 break-all">${esc(it.name)}</div>
            <div>${idx + 1} / ${items.length}장 · ${esc(it.type.replace('image/', '').toUpperCase())} · ${fmtBytes(it.size)}</div>
            <div>원본 ${it.img.naturalWidth || it.img.width} × ${it.img.naturalHeight || it.img.height}px</div>
            <div>편집 결과 ${ow} × ${oh}px${e.width > 0 ? ` → 저장 ${sw} × ${shh}px` : ''}</div>
            ${dirty ? '<div class="text-amber-600 font-bold">편집함 (저장 안 됨)</div>' : ''}`;
        ['bright', 'contrast', 'sat'].forEach(k => { el.querySelector(`[data-adj="${k}"]`).value = e[k]; $(`#iv-${k}-v`).textContent = `${e[k]}%`; });
        $('#iv-gray').checked = e.gray;
        $('#iv-width').value = e.width || '';
        $('#iv-height').textContent = e.width > 0 ? `× ${shh}px` : '';
    };
    const drawThumbs = () => {
        $('#iv-thumbs').innerHTML = items.map((it, i) => `<button type="button" class="iv-thumb shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 ${i === idx ? 'border-indigo-600' : 'border-transparent hover:border-slate-300'} bg-white" data-i="${i}" title="${esc(it.name)}"><img src="${it.url}" class="w-full h-full object-cover" alt="" /></button>`).join('')
            || '<span class="text-[11px] text-slate-400 self-center px-1">썸네일</span>';
        el.querySelectorAll('.iv-thumb').forEach(b => b.addEventListener('click', () => go(Number(b.dataset.i))));
    };
    const go = (i) => { if (!items.length) return; endCrop(); idx = (i + items.length) % items.length; fit = true; redraw(); };

    // ---------- 열기 ----------
    const addFiles = async (files) => {
        const list = [...files].filter(f => TYPES.test(f.type) || /\.(jpe?g|png|gif|webp|bmp|svg|avif|ico)$/i.test(f.name || ''));
        if (!list.length) { showToast('⚠️ 열 수 있는 이미지 파일이 없습니다. (HEIC 사진은 jpg로 바꿔 주세요)'); return; }
        let added = 0;
        for (const f of list) {
            const url = URL.createObjectURL(f);
            const img = new Image();
            try {
                await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('read')); img.src = url; });
                items.push({ name: f.name || `붙여넣은 이미지 ${items.length + 1}.png`, size: f.size, type: f.type || 'image/png', url, img, edits: blankEdits() });
                added++;
            } catch { URL.revokeObjectURL(url); showToast(`⚠️ ${f.name}: 이미지를 읽지 못했습니다.`); }
        }
        if (added) { idx = items.length - added; fit = true; redraw(); showToast(`🖼️ 이미지 ${added}장을 열었습니다.`); }
    };
    $('#iv-open').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
    stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('ring-4', 'ring-indigo-300'); });
    stage.addEventListener('dragleave', () => stage.classList.remove('ring-4', 'ring-indigo-300'));
    stage.addEventListener('drop', (e) => { e.preventDefault(); stage.classList.remove('ring-4', 'ring-indigo-300'); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
    const onPaste = (e) => {
        if (!el.isConnected) { document.removeEventListener('paste', onPaste); return; }
        const files = [...(e.clipboardData?.items || [])].filter(x => x.kind === 'file' && x.type.startsWith('image/')).map(x => x.getAsFile()).filter(Boolean);
        if (files.length) { e.preventDefault(); addFiles(files); }
    };
    document.addEventListener('paste', onPaste);

    // ---------- 확대·이동 ----------
    const zoomAt = (factor, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) => {
        if (!cur()) return;
        const nz = Math.min(20, Math.max(0.02, zoom * factor));
        panX = cx - (cx - panX) * (nz / zoom); panY = cy - (cy - panY) * (nz / zoom);
        zoom = nz; fit = false; applyView();
    };
    stage.addEventListener('wheel', (e) => { if (!cur()) return; e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    let drag = null;
    const toCanvas = (clientX, clientY) => { const r = canvas.getBoundingClientRect(); return { x: (clientX - r.left) / (r.width / canvas.width), y: (clientY - r.top) / (r.height / canvas.height) }; };
    stage.addEventListener('pointerdown', (e) => {
        if (!cur()) return;
        stage.setPointerCapture(e.pointerId);
        if (cropMode) { const p = toCanvas(e.clientX, e.clientY); drag = { crop: true, sx: p.x, sy: p.y }; return; }
        drag = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    });
    stage.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (drag.crop) {
            const p = toCanvas(e.clientX, e.clientY);
            const clamp = (v, m) => Math.max(0, Math.min(m, v));
            const x1 = clamp(Math.min(drag.sx, p.x), canvas.width), y1 = clamp(Math.min(drag.sy, p.y), canvas.height);
            const x2 = clamp(Math.max(drag.sx, p.x), canvas.width), y2 = clamp(Math.max(drag.sy, p.y), canvas.height);
            cropRect = { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
            const cr = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect(), k = cr.width / canvas.width;
            Object.assign(cropBox.style, { left: `${cr.left - sr.left + cropRect.x * k}px`, top: `${cr.top - sr.top + cropRect.y * k}px`, width: `${cropRect.w * k}px`, height: `${cropRect.h * k}px` });
            cropBox.classList.remove('hidden');
            return;
        }
        panX = drag.px + (e.clientX - drag.x); panY = drag.py + (e.clientY - drag.y); fit = false; applyView();
    });
    stage.addEventListener('pointerup', () => { drag = null; });
    stage.addEventListener('dblclick', () => { if (!cropMode) { fit = !fit; if (!fit) zoomAt(1 / zoom); else applyView(); } });
    if (window.ResizeObserver) new ResizeObserver(() => { if (fit && cur()) applyView(); }).observe(stage);

    // ---------- 편집 ----------
    const edit = (fn) => { const it = cur(); if (!it) return; fn(it.edits, it); dirty = true; fit = true; redraw(); };
    // 회전·반전 때 자르기 영역을 새 좌표로 옮긴다 (자른 결과가 그대로 유지되게)
    const rotateCrop = (e, W, H, dir) => { const c = e.crop; if (!c) return; e.crop = dir > 0 ? { x: H - c.y - c.h, y: c.x, w: c.h, h: c.w } : { x: c.y, y: W - c.x - c.w, w: c.h, h: c.w }; };
    const endCrop = () => { cropMode = false; cropRect = null; cropBox.classList.add('hidden'); $('#iv-crop-bar').classList.add('hidden'); $('#iv-crop-btn').classList.remove('on'); stage.style.cursor = ''; };
    const actions = {
        prev: () => go(idx - 1), next: () => go(idx + 1),
        zoomIn: () => zoomAt(1.25), zoomOut: () => zoomAt(0.8),
        fit: () => { fit = true; applyView(); }, actual: () => { zoomAt(1 / zoom); },
        full: () => { const r = $('#iv-root'); if (document.fullscreenElement) document.exitFullscreen(); else r.requestFullscreen?.(); },
        rotR: () => edit((e, it) => { const [W, H] = baseDims(it); rotateCrop(e, W, H, 1); e.rot = (e.rot + 90) % 360; }),
        rotL: () => edit((e, it) => { const [W, H] = baseDims(it); rotateCrop(e, W, H, -1); e.rot = (e.rot + 270) % 360; }),
        // 반전은 회전 뒤 좌표에서 한다: 화면에서 좌우가 바뀌도록 회전 각도에 따라 반전 축을 고른다
        flipH: () => edit((e, it) => { const [W] = baseDims(it); if (e.rot % 180) e.flipV = !e.flipV; else e.flipH = !e.flipH; if (e.crop) e.crop = { ...e.crop, x: W - e.crop.x - e.crop.w }; }),
        flipV: () => edit((e, it) => { const [, H] = baseDims(it); if (e.rot % 180) e.flipH = !e.flipH; else e.flipV = !e.flipV; if (e.crop) e.crop = { ...e.crop, y: H - e.crop.y - e.crop.h }; }),
        crop: () => { if (!cur()) return; if (cropMode) { endCrop(); return; } cropMode = true; $('#iv-crop-bar').classList.remove('hidden'); $('#iv-crop-btn').classList.add('on'); stage.style.cursor = 'crosshair'; },
        cropApply: () => {
            if (!cropRect || cropRect.w < 2 || cropRect.h < 2) { showToast('자를 영역을 끌어서 고르세요.'); return; }
            const r = cropRect;
            edit((e) => { const c = e.crop || { x: 0, y: 0 }; e.crop = { x: c.x + r.x, y: c.y + r.y, w: r.w, h: r.h }; e.width = 0; });
            endCrop();
        },
        cropCancel: () => endCrop(),
        reset: () => { const it = cur(); if (!it) return; it.edits = blankEdits(); endCrop(); dirty = items.some(x => JSON.stringify(x.edits) !== JSON.stringify(blankEdits())); fit = true; redraw(); },
        close: () => {
            const it = cur(); if (!it) return;
            if (JSON.stringify(it.edits) !== JSON.stringify(blankEdits()) && !confirm('편집한 내용을 저장하지 않고 닫을까요?')) return;
            URL.revokeObjectURL(it.url); items.splice(idx, 1); idx = Math.min(idx, items.length - 1); endCrop();
            dirty = items.some(x => JSON.stringify(x.edits) !== JSON.stringify(blankEdits())); fit = true; redraw();
        },
        save: async () => {
            const it = cur(); if (!it) return;
            const type = $('#iv-format').value, q = Number($('#iv-quality').value) / 100;
            const out = document.createElement('canvas');
            renderTo(out, it, it.edits.width);
            if (type === 'image/jpeg') { const ctx = out.getContext('2d'); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height); }
            const blob = await new Promise(res => out.toBlob(res, type, q));
            if (!blob) { showToast('⚠️ 저장하지 못했습니다.'); return; }
            const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type];
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${it.name.replace(/\.[^.]+$/, '')}_편집.${ext}`;
            a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
            dirty = false; redraw();
            showToast(`💾 ${a.download} (${out.width}×${out.height}, ${fmtBytes(blob.size)})로 저장했습니다.`);
        },
        copy: async () => {
            const it = cur(); if (!it) return;
            try {
                const out = document.createElement('canvas'); renderTo(out, it, it.edits.width);
                const blob = await new Promise(res => out.toBlob(res, 'image/png'));
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                showToast('📋 이미지를 클립보드에 복사했습니다. 메일·채팅에 붙여넣으세요.');
            } catch { showToast('⚠️ 이 브라우저에서는 이미지를 복사할 수 없습니다.'); }
        },
        print: () => {
            const it = cur(); if (!it) return;
            const out = document.createElement('canvas'); renderTo(out, it, it.edits.width);
            const w = window.open('', '_blank');
            if (!w) { showToast('⚠️ 팝업이 막혀 인쇄 창을 열지 못했습니다.'); return; }
            w.document.write(`<!doctype html><title>${esc(it.name)}</title><style>@page{margin:10mm}body{margin:0;display:flex;justify-content:center}img{max-width:100%;max-height:100vh}</style><img src="${out.toDataURL('image/png')}" onload="setTimeout(()=>{print();},100)">`);
            w.document.close();
        }
    };
    el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => actions[b.dataset.act]?.()));
    el.querySelectorAll('.iv-adj').forEach(r => r.addEventListener('input', () => { const it = cur(); if (!it) return; it.edits[r.dataset.adj] = Number(r.value); dirty = true; $(`#iv-${r.dataset.adj}-v`).textContent = `${r.value}%`; renderTo(canvas, it); }));
    $('#iv-gray').addEventListener('change', (e) => edit(ed => { ed.gray = e.target.checked; }));
    $('#iv-width').addEventListener('change', (e) => edit(ed => { ed.width = Math.max(0, Math.round(Number(e.target.value) || 0)); }));
    el.querySelectorAll('.iv-pct').forEach(b => b.addEventListener('click', () => edit((ed, it) => { const p = Number(b.dataset.pct); ed.width = p ? Math.round(outDims(it)[0] * p / 100) : 0; })));
    $('#iv-quality').addEventListener('input', (e) => { $('#iv-q-v').textContent = e.target.value; });

    // ---------- 단축키 (입력칸 밖에서만) ----------
    const onKey = (e) => {
        if (!el.isConnected) { document.removeEventListener('keydown', onKey); return; }
        if (!cur() || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key;
        const map = { ArrowLeft: 'prev', ArrowRight: 'next', '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', 0: 'fit', 1: 'actual', r: 'rotR', R: 'rotR', c: 'crop', C: 'crop', f: 'full', F: 'full', Escape: cropMode ? 'cropCancel' : '' };
        if (map[k]) { e.preventDefault(); actions[map[k]](); }
        else if (k === 'Enter' && cropMode) { e.preventDefault(); actions.cropApply(); }
    };
    document.addEventListener('keydown', onKey);

    redraw();
    return { isDirty: () => dirty };
};
