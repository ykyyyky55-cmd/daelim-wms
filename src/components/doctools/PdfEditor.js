import { createIcons, icons } from 'lucide';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { esc } from '../../services/html.js';

/**
 * PDF 뷰어·간단 편집기 — 이 브라우저 안에서만 처리
 * - 보기: pdf.js (한글 CMap은 jsDelivr에서 받음), 확대·축소·폭 맞춤, 보이는 페이지만 그림
 * - 편집: 글자(한글 포함, 그림으로 넣음)·펜·형광펜·흰색 가리기·지우개·되돌리기, 페이지 회전·순서 바꾸기·삭제, 다른 PDF 합치기
 * - 저장: pdf-lib로 원본 페이지를 그대로 복사하고 그 위에 주석을 그린다(원본 글자·그림 품질 유지)
 * 주석 좌표는 PDF 좌표(pt, 원래 방향)로 저장하므로 페이지를 돌려도 내용에 붙어 다닌다.
 */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}`;
const TOOLS = [
    ['view', 'mouse-pointer-2', '보기'], ['text', 'type', '글자'], ['pen', 'pen-line', '펜'],
    ['hl', 'highlighter', '형광펜'], ['white', 'square', '흰색 가리기'], ['erase', 'eraser', '지우개']
];
const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export const renderPdfEditor = (el, { showToast = () => {} } = {}) => {
    let sources = [];   // [{ name, bytes, pdf }]
    let pages = [];     // [{ id, src, index, baseRot, rot, annots: [] }]
    let tool = 'view';
    let color = '#dc2626';
    let penWidth = 2;   // pt
    let fontSize = 12;  // pt
    let zoom = 1;       // 1 = 100%
    let dirty = false;
    let busy = '';
    let fileName = '';
    const undo = [];    // [{ pageId, annot }]
    let seq = 0;
    let observer = null;
    const pageObjs = new Map(); // pageId → { vp, canvas, overlay, rendered }

    const scale = () => zoom * (96 / 72);

    // ---------- 불러오기 ----------
    const loadPdf = async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // pdf.js가 버퍼를 워커로 넘기며 비우므로 사본을 준다
        const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), cMapUrl: `${CDN}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${CDN}/standard_fonts/` }).promise;
        return { name: file.name, bytes, pdf };
    };
    const addFile = async (file, { replace }) => {
        if (!file) return;
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { alert('PDF 파일만 열 수 있습니다.'); return; }
        if (replace && dirty && !confirm('저장하지 않은 변경 내용이 있습니다. 다른 PDF를 열까요?')) return;
        busy = '여는 중…'; draw();
        try {
            const src = await loadPdf(file);
            if (replace) { sources = []; pages = []; undo.length = 0; fileName = file.name; dirty = false; }
            const si = sources.push(src) - 1;
            for (let i = 0; i < src.pdf.numPages; i++) {
                const p = await src.pdf.getPage(i + 1);
                pages.push({ id: ++seq, src: si, index: i, baseRot: p.rotate || 0, rot: 0, annots: [] });
            }
            if (!replace) dirty = true;
            showToast(replace ? `📕 ${file.name} (${src.pdf.numPages}쪽)을 열었습니다.` : `➕ ${file.name} ${src.pdf.numPages}쪽을 뒤에 붙였습니다.`);
        } catch (e) {
            alert(`PDF를 열지 못했습니다: ${e?.name === 'PasswordException' ? '암호가 걸린 PDF입니다.' : e.message}`);
        }
        busy = ''; draw();
    };

    // ---------- 그리기 ----------
    // 도구 모음은 따로 그려서, 도구를 바꿀 때 페이지를 다시 그리지 않는다
    const toolsHtml = () => `
        ${TOOLS.map(([k, ic, t]) => `<button type="button" class="pe-tool pe-btn ${tool === k ? '!bg-slate-800 !text-white !border-slate-800' : ''}" data-t="${k}" title="${t}"><i data-lucide="${ic}" class="w-4 h-4"></i><span class="hidden xl:inline">${t}</span></button>`).join('')}
        <button type="button" id="pe-undo" class="pe-btn disabled:opacity-40" ${undo.length ? '' : 'disabled'} title="되돌리기 (Ctrl+Z)"><i data-lucide="undo-2" class="w-4 h-4"></i></button>
        <label class="pe-btn relative cursor-pointer" title="색"><span class="w-4 h-4 rounded-full border border-slate-300" style="background:${color}"></span><input type="color" id="pe-color" value="${color}" class="absolute inset-0 opacity-0 cursor-pointer" /></label>
        ${tool === 'pen' ? `<label class="flex items-center gap-1 text-slate-600">굵기<input type="range" id="pe-width" min="0.5" max="12" step="0.5" value="${penWidth}" class="w-20" /><span class="w-7">${penWidth}</span></label>` : ''}
        ${tool === 'text' ? `<label class="flex items-center gap-1 text-slate-600">크기<select id="pe-font" class="border border-slate-300 rounded px-1 py-0.5">${[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48].map(s => `<option ${s === fontSize ? 'selected' : ''}>${s}</option>`).join('')}</select>pt</label>` : ''}`;
    const cursorOf = () => (tool === 'view' ? 'default' : tool === 'text' ? 'text' : 'crosshair');
    const setTool = (t) => {
        // 형광펜은 기본 빨강 대신 노랑으로 (사용자가 고른 색은 그대로)
        if (t === 'hl' && color === '#dc2626') color = '#facc15';
        else if (t !== 'hl' && tool === 'hl' && color === '#facc15') color = '#dc2626';
        tool = t;
        const box = el.querySelector('#pe-tools');
        if (!box) { draw(); return; }
        box.innerHTML = toolsHtml();
        createIcons({ icons });
        bindTools();
        el.querySelectorAll('.pe-overlay').forEach(o => { o.style.cursor = cursorOf(); });
        const help = el.querySelector('#pe-help'); if (help && !busy) help.textContent = toolHelp();
    };
    const bindTools = () => {
        const $ = (s) => el.querySelector(s);
        el.querySelectorAll('.pe-tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.t)));
        $('#pe-undo')?.addEventListener('click', doUndo);
        $('#pe-color')?.addEventListener('input', (e) => { color = e.target.value; const dot = e.target.previousElementSibling; if (dot) dot.style.background = color; });
        $('#pe-width')?.addEventListener('input', (e) => { penWidth = Number(e.target.value); e.target.nextElementSibling.textContent = penWidth; });
        $('#pe-font')?.addEventListener('change', (e) => { fontSize = Number(e.target.value); });
    };

    const draw = () => {
        observer?.disconnect();
        pageObjs.clear();
        el.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" id="pe-root">
            <div class="flex flex-wrap items-center gap-1.5 p-2 border-b border-slate-200 bg-slate-50 text-xs font-bold">
                <label class="pe-btn cursor-pointer"><i data-lucide="folder-open" class="w-4 h-4"></i>열기<input type="file" id="pe-open" accept="application/pdf,.pdf" class="hidden" /></label>
                <label class="pe-btn cursor-pointer ${pages.length ? '' : 'opacity-50 pointer-events-none'}" title="다른 PDF를 뒤에 붙이기"><i data-lucide="file-plus-2" class="w-4 h-4"></i>PDF 합치기<input type="file" id="pe-add" accept="application/pdf,.pdf" multiple class="hidden" /></label>
                <button type="button" id="pe-save" class="pe-btn !bg-rose-600 !text-white !border-rose-600 hover:!bg-rose-700 disabled:opacity-50" ${pages.length && !busy ? '' : 'disabled'}><i data-lucide="save" class="w-4 h-4"></i>PDF 저장</button>
                <button type="button" id="pe-print" class="pe-btn disabled:opacity-50" ${pages.length ? '' : 'disabled'} title="원본 PDF를 새 창에서 열어 인쇄"><i data-lucide="printer" class="w-4 h-4"></i>인쇄</button>
                <span class="w-px h-6 bg-slate-300 mx-1"></span>
                <span id="pe-tools" class="contents">${toolsHtml()}</span>
                <div class="ml-auto flex items-center gap-1">
                    <button type="button" class="pe-zoom pe-btn" data-z="-" title="축소"><i data-lucide="zoom-out" class="w-4 h-4"></i></button>
                    <span class="w-12 text-center">${Math.round(zoom * 100)}%</span>
                    <button type="button" class="pe-zoom pe-btn" data-z="+" title="확대"><i data-lucide="zoom-in" class="w-4 h-4"></i></button>
                    <button type="button" class="pe-zoom pe-btn" data-z="fit" title="폭 맞춤"><i data-lucide="move-horizontal" class="w-4 h-4"></i></button>
                </div>
            </div>
            <div class="flex items-center gap-2 px-3 py-1.5 border-b border-slate-100 text-[11px] text-slate-500">
                <span class="font-black text-slate-700 truncate max-w-[280px]"><i data-lucide="file-type" class="w-3.5 h-3.5 inline text-rose-600"></i> ${esc(fileName || 'PDF를 열어 주세요')}${dirty ? ' <span class="text-amber-600">●</span>' : ''}</span>
                ${pages.length ? `<span>${pages.length}쪽</span>` : ''}
                <span class="ml-auto" id="pe-help">${busy ? `<span class="text-indigo-700 font-black">${esc(busy)}</span>` : toolHelp()}</span>
            </div>
            <div id="pe-pages" class="bg-slate-200/70 p-4 max-h-[74vh] overflow-auto space-y-4">
                ${pages.length ? pages.map((p, i) => `
                    <div class="pe-page mx-auto w-fit" data-id="${p.id}">
                        <div class="flex items-center gap-1 mb-1 text-[11px] font-bold text-slate-600">
                            <span class="px-2 py-0.5 rounded bg-white border border-slate-300">${i + 1} / ${pages.length}쪽</span>
                            ${sources.length > 1 ? `<span class="text-slate-400 truncate max-w-[160px]">${esc(sources[p.src].name)}</span>` : ''}
                            <span class="ml-auto"></span>
                            <button type="button" class="pe-pg px-1.5 py-0.5 rounded hover:bg-white" data-op="rotL" title="왼쪽으로 돌리기"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i></button>
                            <button type="button" class="pe-pg px-1.5 py-0.5 rounded hover:bg-white" data-op="rotR" title="오른쪽으로 돌리기"><i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i></button>
                            <button type="button" class="pe-pg px-1.5 py-0.5 rounded hover:bg-white disabled:opacity-30" data-op="up" ${i === 0 ? 'disabled' : ''} title="앞으로"><i data-lucide="arrow-up" class="w-3.5 h-3.5"></i></button>
                            <button type="button" class="pe-pg px-1.5 py-0.5 rounded hover:bg-white disabled:opacity-30" data-op="down" ${i === pages.length - 1 ? 'disabled' : ''} title="뒤로"><i data-lucide="arrow-down" class="w-3.5 h-3.5"></i></button>
                            <button type="button" class="pe-pg px-1.5 py-0.5 rounded hover:bg-rose-100 text-rose-600" data-op="del" title="이 페이지 삭제"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                        </div>
                        <div class="pe-sheet relative bg-white shadow-md" style="min-width:200px;min-height:260px">
                            <canvas class="pe-canvas block"></canvas>
                            <canvas class="pe-overlay absolute inset-0" style="touch-action:none;cursor:${cursorOf()}"></canvas>
                        </div>
                    </div>`).join('') : `
                    <label class="block mx-auto max-w-lg bg-white border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center cursor-pointer hover:border-rose-400">
                        <i data-lucide="file-up" class="w-10 h-10 mx-auto text-rose-500"></i>
                        <div class="mt-2 font-black text-slate-700">PDF 파일을 끌어다 놓거나 눌러서 고르세요</div>
                        <div class="text-xs text-slate-400 mt-1">파일은 이 브라우저 안에서만 열립니다.</div>
                        <input type="file" id="pe-open2" accept="application/pdf,.pdf" class="hidden" />
                    </label>`}
            </div>
        </div>
        <style>#pe-root .pe-btn{display:inline-flex;align-items:center;gap:.3rem;padding:.35rem .55rem;border-radius:.6rem;border:1px solid #cbd5e1;background:#fff;color:#334155}#pe-root .pe-btn:hover{background:#f1f5f9}</style>`;
        createIcons({ icons });
        bind();
        setupPages();
    };
    const toolHelp = () => ({
        view: '도구를 골라 페이지 위에 표시하세요.',
        text: '글자 넣을 곳을 누르고 입력 → 바깥을 누르거나 Ctrl+Enter로 확정, Esc 취소',
        pen: '끌어서 그리기',
        hl: '끌어서 형광펜 칠하기',
        white: '끌어서 흰색으로 가리기 (원본 글자는 PDF 안에 남습니다)',
        erase: '지울 표시를 누르세요'
    }[tool]);

    // ---------- 페이지 그림 ----------
    const setupPages = () => {
        const wrap = el.querySelector('#pe-pages');
        if (!pages.length) return;
        observer = new IntersectionObserver((entries) => entries.forEach(en => { if (en.isIntersecting) renderPage(Number(en.target.dataset.id)); }), { root: wrap, rootMargin: '600px 0px' });
        el.querySelectorAll('.pe-page').forEach(node => {
            const p = pages.find(x => x.id === Number(node.dataset.id));
            // 그리기 전에도 자리를 잡아 스크롤이 튀지 않게
            const [w, h] = sizeGuess(p);
            const sheet = node.querySelector('.pe-sheet');
            sheet.style.width = `${w}px`; sheet.style.height = `${h}px`;
            observer.observe(node);
            bindOverlay(node, p);
        });
        // 앞의 몇 쪽은 바로 그린다 (화면 밖 감지가 늦는 브라우저 대비)
        pages.slice(0, 3).forEach(p => renderPage(p.id));
    };
    const sizeGuess = (p) => {
        const o = pageObjs.get(p.id);
        if (o?.vp) return [o.vp.width, o.vp.height];
        const s = scale();
        const rotated = ((p.baseRot + p.rot) % 180) !== 0;
        return rotated ? [842 * s, 595 * s] : [595 * s, 842 * s];
    };
    const renderPage = async (id) => {
        const p = pages.find(x => x.id === id);
        const node = el.querySelector(`.pe-page[data-id="${id}"]`);
        if (!p || !node) return;
        let o = pageObjs.get(id);
        if (o?.rendered || o?.rendering) return;
        o = { rendering: true };
        pageObjs.set(id, o);
        try {
            const page = await sources[p.src].pdf.getPage(p.index + 1);
            const vp = page.getViewport({ scale: scale(), rotation: (p.baseRot + p.rot) % 360 });
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const canvas = node.querySelector('.pe-canvas');
            const overlay = node.querySelector('.pe-overlay');
            const sheet = node.querySelector('.pe-sheet');
            sheet.style.width = `${vp.width}px`; sheet.style.height = `${vp.height}px`;
            [canvas, overlay].forEach(c => { c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr); c.style.width = `${vp.width}px`; c.style.height = `${vp.height}px`; });
            // 크기가 정해지면 바로 표시를 받을 수 있게 (원본 그림은 뒤이어 그려진다)
            Object.assign(o, { vp, dpr, canvas, overlay, rendered: true });
            paintOverlay(p);
            await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
            o.rendering = false;
        } catch (e) {
            o.rendering = false;
            if (!o.vp) o.rendered = false;
            console.warn('PDF 페이지 그리기 실패', e);
        }
    };

    // 주석 그리기 (PDF 좌표계로 변환한 상태에서)
    const imgCache = new Map();
    const imgOf = (a) => {
        let img = imgCache.get(a.png);
        if (!img) { img = new Image(); img.src = a.png; imgCache.set(a.png, img); }
        return img;
    };
    const drawAnnot = (ctx, a) => {
        if (a.type === 'pen') {
            ctx.strokeStyle = a.color; ctx.lineWidth = a.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath();
            a.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            if (a.pts.length === 1) ctx.lineTo(a.pts[0][0] + 0.01, a.pts[0][1]);
            ctx.stroke();
        } else if (a.type === 'hl' || a.type === 'white') {
            ctx.save();
            ctx.globalAlpha = a.type === 'hl' ? 0.35 : 1;
            ctx.fillStyle = a.type === 'hl' ? a.color : '#ffffff';
            ctx.fillRect(Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1));
            ctx.restore();
        } else if (a.type === 'text') {
            const img = imgOf(a);
            const doDraw = () => { ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.angle); ctx.scale(1, -1); ctx.drawImage(img, 0, -a.h, a.w, a.h); ctx.restore(); };
            if (img.complete) doDraw(); else img.onload = () => { const pg = pages.find(x => x.annots.includes(a)); if (pg) paintOverlay(pg); };
        }
    };
    const paintOverlay = (p, extra = null) => {
        const o = pageObjs.get(p.id);
        if (!o?.overlay) return;
        const ctx = o.overlay.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, o.overlay.width, o.overlay.height);
        ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
        ctx.transform(...o.vp.transform);
        p.annots.forEach(a => drawAnnot(ctx, a));
        if (extra) drawAnnot(ctx, extra);
    };

    // ---------- 페이지 위 입력 ----------
    const bindOverlay = (node, p) => {
        const overlay = node.querySelector('.pe-overlay');
        const toPdf = (e) => {
            const o = pageObjs.get(p.id);
            const r = overlay.getBoundingClientRect();
            return o.vp.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
        };
        let drawing = null;
        overlay.addEventListener('pointerdown', (e) => {
            const o = pageObjs.get(p.id);
            if (tool === 'view' || e.button !== 0) return;
            if (!o?.rendered) { renderPage(p.id); return; }
            e.preventDefault();
            const pt = toPdf(e);
            if (tool === 'text') { startText(node, p, e); return; }
            if (tool === 'erase') { eraseAt(p, pt); return; }
            overlay.setPointerCapture(e.pointerId);
            drawing = tool === 'pen' ? { type: 'pen', color, width: penWidth, pts: [pt] } : { type: tool, color, x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1] };
            paintOverlay(p, drawing);
        });
        overlay.addEventListener('pointermove', (e) => {
            if (!drawing) return;
            const pt = toPdf(e);
            if (drawing.type === 'pen') {
                const last = drawing.pts[drawing.pts.length - 1];
                if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 0.8 / zoom) return;
                drawing.pts.push(pt);
            } else { drawing.x2 = pt[0]; drawing.y2 = pt[1]; }
            paintOverlay(p, drawing);
        });
        const finish = () => {
            if (!drawing) return;
            const a = drawing; drawing = null;
            if (a.type !== 'pen' && (Math.abs(a.x2 - a.x1) < 2 || Math.abs(a.y2 - a.y1) < 2)) { paintOverlay(p); return; }
            addAnnot(p, a);
        };
        overlay.addEventListener('pointerup', finish);
        overlay.addEventListener('pointercancel', finish);
    };
    const addAnnot = (p, a) => {
        p.annots.push(a);
        undo.push({ pageId: p.id, annot: a });
        dirty = true;
        paintOverlay(p);
        refreshBar();
    };
    const refreshBar = () => {
        const u = el.querySelector('#pe-undo'); if (u) u.disabled = !undo.length;
    };
    const eraseAt = (p, [x, y]) => {
        const hit = [...p.annots].reverse().find(a => {
            if (a.type === 'pen') return a.pts.some(([px, py]) => Math.hypot(px - x, py - y) < a.width / 2 + 4);
            if (a.type === 'hl' || a.type === 'white') return x >= Math.min(a.x1, a.x2) && x <= Math.max(a.x1, a.x2) && y >= Math.min(a.y1, a.y2) && y <= Math.max(a.y1, a.y2);
            // 글자: 회전된 사각형 안인지 (그림의 로컬 좌표로 바꿔서)
            const dx = x - a.x; const dy = y - a.y;
            const lx = dx * Math.cos(-a.angle) - dy * Math.sin(-a.angle);
            const ly = dx * Math.sin(-a.angle) + dy * Math.cos(-a.angle);
            return lx >= 0 && lx <= a.w && ly >= 0 && ly <= a.h;
        });
        if (!hit) return;
        p.annots = p.annots.filter(a => a !== hit);
        const i = undo.findIndex(u => u.annot === hit); if (i >= 0) undo.splice(i, 1);
        dirty = true;
        paintOverlay(p);
        refreshBar();
    };

    // 글자 넣기: 페이지 위에 입력칸을 띄우고, 확정하면 글자를 그림(PNG)으로 만들어 붙인다 (한글 글꼴 문제 없음)
    const startText = (node, p, e) => {
        node.querySelector('.pe-textbox')?.blur();
        const o = pageObjs.get(p.id);
        const sheet = node.querySelector('.pe-sheet');
        const r = sheet.getBoundingClientRect();
        const x = e.clientX - r.left; const y = e.clientY - r.top;
        const ta = document.createElement('textarea');
        ta.className = 'pe-textbox absolute bg-white/70 border border-dashed border-sky-500 outline-none resize p-0 m-0 leading-[1.3] z-10';
        const px = fontSize * scale();
        Object.assign(ta.style, { left: `${x}px`, top: `${y}px`, fontSize: `${px}px`, color, fontFamily: "'Malgun Gothic', sans-serif", minWidth: `${px * 4}px`, minHeight: `${px * 1.4}px`, width: `${Math.min(r.width - x - 4, px * 14)}px`, height: `${px * 1.5}px` });
        sheet.appendChild(ta);
        setTimeout(() => ta.focus(), 0);
        let done = false;
        const commit = (keep) => {
            if (done) return; done = true;
            const text = ta.value.replace(/\s+$/, '');
            ta.remove();
            if (!keep || !text) return;
            const k = 4; // 선명하게 4배로 그림
            const lines = text.split('\n');
            const cv = document.createElement('canvas');
            const cx = cv.getContext('2d');
            const font = `${fontSize * k}px 'Malgun Gothic', '맑은 고딕', sans-serif`;
            cx.font = font;
            const lh = fontSize * 1.3;
            const wPt = Math.max(...lines.map(l => cx.measureText(l || ' ').width)) / k + 1;
            const hPt = lines.length * lh;
            cv.width = Math.ceil(wPt * k); cv.height = Math.ceil(hPt * k);
            cx.font = font; cx.fillStyle = color; cx.textBaseline = 'top';
            lines.forEach((l, i) => cx.fillText(l, 0, (i * lh + (lh - fontSize) / 2) * k));
            // 화면의 오른쪽·아래 방향을 PDF 좌표로
            const pA = o.vp.convertToPdfPoint(x, y);
            const pR = o.vp.convertToPdfPoint(x + 10, y);
            const pD = o.vp.convertToPdfPoint(x, y + 10);
            const ux = [pR[0] - pA[0], pR[1] - pA[1]]; const ul = Math.hypot(...ux);
            const dn = [pD[0] - pA[0], pD[1] - pA[1]]; const dl = Math.hypot(...dn);
            const angle = Math.atan2(ux[1] / ul, ux[0] / ul);
            const p0 = [pA[0] + dn[0] / dl * hPt, pA[1] + dn[1] / dl * hPt];
            addAnnot(p, { type: 'text', text, size: fontSize, color, png: cv.toDataURL('image/png'), x: p0[0], y: p0[1], w: wPt, h: hPt, angle });
        };
        ta.addEventListener('blur', () => commit(true));
        ta.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
            if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); commit(true); }
        });
        ta.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    };

    // ---------- 페이지 조작 ----------
    const pageOp = (id, op) => {
        const i = pages.findIndex(x => x.id === id);
        const p = pages[i];
        if (op === 'rotL' || op === 'rotR') { p.rot = (p.rot + (op === 'rotR' ? 90 : 270)) % 360; pageObjs.delete(id); }
        if (op === 'up' && i > 0) [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]];
        if (op === 'down' && i < pages.length - 1) [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]];
        if (op === 'del') {
            if (pages.length === 1) { alert('마지막 한 쪽은 삭제할 수 없습니다.'); return; }
            if (!confirm(`${i + 1}쪽을 삭제할까요?`)) return;
            pages.splice(i, 1);
            for (let k = undo.length - 1; k >= 0; k--) if (undo[k].pageId === id) undo.splice(k, 1);
        }
        dirty = true;
        const top = el.querySelector('#pe-pages')?.scrollTop || 0;
        draw();
        el.querySelector('#pe-pages').scrollTop = top;
    };

    // ---------- 저장 ----------
    const save = async () => {
        if (!pages.length || busy) return;
        const name = (prompt('저장할 파일 이름', fileName ? fileName.replace(/\.pdf$/i, '_편집.pdf') : '문서.pdf') || '').trim();
        if (!name) return;
        busy = 'PDF 만드는 중…'; draw();
        try {
            const { PDFDocument, rgb, degrees, LineCapStyle, pushGraphicsState, popGraphicsState } = await import('pdf-lib');
            const out = await PDFDocument.create();
            const libDocs = new Map();
            const libOf = async (si) => {
                if (!libDocs.has(si)) libDocs.set(si, await PDFDocument.load(sources[si].bytes, { ignoreEncryption: true }));
                return libDocs.get(si);
            };
            for (const p of pages) {
                const src = await libOf(p.src);
                const [cp] = await out.copyPages(src, [p.index]);
                cp.setRotation(degrees((((cp.getRotation().angle || 0) + p.rot) % 360 + 360) % 360));
                out.addPage(cp);
                if (!p.annots.length) continue;
                // 원본 내용이 좌표계를 바꿔 놓아도 주석 위치가 틀어지지 않게 원본을 q … Q로 감싼다
                cp.node.normalize();
                const start = out.context.register(out.context.contentStream([pushGraphicsState()]));
                const end = out.context.register(out.context.contentStream([popGraphicsState()]));
                cp.node.wrapContentStreams(start, end);
                for (const a of p.annots) {
                    if (a.type === 'pen') {
                        const [r, g, b] = hexToRgb(a.color);
                        const c = rgb(r / 255, g / 255, b / 255);
                        if (a.pts.length === 1) { cp.drawCircle({ x: a.pts[0][0], y: a.pts[0][1], size: a.width / 2, color: c }); continue; }
                        for (let k = 1; k < a.pts.length; k++) {
                            cp.drawLine({ start: { x: a.pts[k - 1][0], y: a.pts[k - 1][1] }, end: { x: a.pts[k][0], y: a.pts[k][1] }, thickness: a.width, color: c, lineCap: LineCapStyle.Round });
                        }
                    } else if (a.type === 'hl' || a.type === 'white') {
                        const [r, g, b] = a.type === 'hl' ? hexToRgb(a.color) : [255, 255, 255];
                        cp.drawRectangle({ x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), width: Math.abs(a.x2 - a.x1), height: Math.abs(a.y2 - a.y1), color: rgb(r / 255, g / 255, b / 255), opacity: a.type === 'hl' ? 0.35 : 1, borderWidth: 0 });
                    } else if (a.type === 'text') {
                        const png = await out.embedPng(a.png);
                        cp.drawImage(png, { x: a.x, y: a.y, width: a.w, height: a.h, rotate: degrees(a.angle * 180 / Math.PI) });
                    }
                }
            }
            const bytes = await out.save();
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = /\.pdf$/i.test(name) ? name : `${name}.pdf`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 3000);
            dirty = false;
            showToast(`💾 ${a.download} 저장(다운로드)했습니다.`);
        } catch (e) {
            console.error(e);
            alert(`PDF를 저장하지 못했습니다: ${e.message}${/encrypt/i.test(e.message) ? '\n(보안이 걸린 PDF는 편집 저장이 안 될 수 있습니다.)' : ''}`);
        }
        busy = ''; draw();
    };

    // ---------- 이벤트 ----------
    const bind = () => {
        const $ = (s) => el.querySelector(s);
        const onOpen = (e) => { const f = e.target.files?.[0]; e.target.value = ''; addFile(f, { replace: true }); };
        $('#pe-open')?.addEventListener('change', onOpen);
        $('#pe-open2')?.addEventListener('change', onOpen);
        $('#pe-add')?.addEventListener('change', async (e) => { const files = [...(e.target.files || [])]; e.target.value = ''; for (const f of files) await addFile(f, { replace: false }); });
        $('#pe-save')?.addEventListener('click', save);
        $('#pe-print')?.addEventListener('click', () => {
            // 편집한 내용이 있으면 먼저 저장한 뒤 그 파일을 인쇄하도록 안내
            if (dirty && !confirm('편집한 내용은 [PDF 저장] 후 그 파일로 인쇄해야 들어갑니다. 원본을 인쇄할까요?')) return;
            const src = sources[pages[0].src];
            const url = URL.createObjectURL(new Blob([src.bytes], { type: 'application/pdf' }));
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        });
        bindTools();
        el.querySelectorAll('.pe-zoom').forEach(b => b.addEventListener('click', () => {
            if (b.dataset.z === '+') zoom = Math.min(4, Math.round((zoom + 0.25) * 100) / 100);
            else if (b.dataset.z === '-') zoom = Math.max(0.25, Math.round((zoom - 0.25) * 100) / 100);
            else {
                const wrapW = (el.querySelector('#pe-pages')?.clientWidth || 800) - 48;
                const first = pages[0];
                const o = first && pageObjs.get(first.id);
                const wPt = o?.vp ? o.vp.width / scale() : 595;
                zoom = Math.max(0.25, Math.min(4, wrapW / (wPt * 96 / 72)));
            }
            draw();
        }));
        el.querySelectorAll('.pe-pg').forEach(b => b.addEventListener('click', () => pageOp(Number(b.closest('.pe-page').dataset.id), b.dataset.op)));
        // 끌어놓기
        const root = $('#pe-root');
        root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); root.classList.add('ring-4', 'ring-rose-300'); } });
        root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('ring-4', 'ring-rose-300'); });
        root.addEventListener('drop', async (e) => {
            const files = [...(e.dataTransfer?.files || [])];
            if (!files.length) return;
            e.preventDefault(); root.classList.remove('ring-4', 'ring-rose-300');
            if (pages.length && confirm(`PDF ${files.length}개를 지금 문서 뒤에 붙일까요?\n[취소]를 누르면 새로 엽니다.`)) { for (const f of files) await addFile(f, { replace: false }); }
            else await addFile(files[0], { replace: true });
        });
    };
    const doUndo = () => {
        const u = undo.pop();
        if (!u) return;
        const p = pages.find(x => x.id === u.pageId);
        if (p) { p.annots = p.annots.filter(a => a !== u.annot); paintOverlay(p); }
        dirty = true;
        refreshBar();
    };
    const onKey = (e) => {
        if (!el.isConnected || !el.querySelector('#pe-root')) { document.removeEventListener('keydown', onKey); return; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target?.closest?.('input, textarea, [contenteditable]')) { e.preventDefault(); doUndo(); }
    };
    if (renderPdfEditor._onKey) document.removeEventListener('keydown', renderPdfEditor._onKey);
    renderPdfEditor._onKey = onKey;
    document.addEventListener('keydown', onKey);

    draw();
    return { isDirty: () => dirty };
};
