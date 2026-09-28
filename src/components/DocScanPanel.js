import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

/**
 * 문서 스캔 (전표 스캔 등록 화면 안): 카메라·이미지로 여러 쪽을 스캔 보정해 PDF/JPG로 이 기기에 저장하거나 공유한다.
 * 이미지는 이 기기 안에서만 처리하고 서버로 올리지 않는다.
 * @param host 붙일 요소
 * @param getCurrent () => ({ img, rotate }) 위쪽 전표 이미지(없으면 img null)
 */
export const mountDocScanPanel = (host, { getCurrent = () => ({ img: null, rotate: 0 }), showToast = () => {} } = {}) => {
    let pages = []; // { id, img, rotate, cache: { key, canvas } }
    let mode = 'bw'; // bw 흑백 문서 · gray 회색 · color 컬러
    const MODES = { bw: '흑백 문서', gray: '회색', color: '컬러' };
    const $ = (s) => host.querySelector(s);
    const pid = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e5)}`;
    const stamp = () => {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
    };

    host.innerHTML = `
    <details id="sc-box" class="border border-slate-200 rounded-xl p-2">
        <summary class="font-bold text-slate-700 cursor-pointer flex items-center gap-1"><i data-lucide="file-scan" class="w-4 h-4 text-teal-600"></i>문서 스캔 (이 기기에 저장·공유)</summary>
        <div class="mt-2 space-y-2">
            <div class="grid grid-cols-2 gap-2">
                <label class="px-2 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-black flex items-center justify-center gap-1 cursor-pointer">
                    <i data-lucide="camera" class="w-4 h-4"></i>쪽 찍기
                    <input type="file" id="sc-camera" accept="image/*" capture="environment" class="hidden" /></label>
                <label class="px-2 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-lg font-black flex items-center justify-center gap-1 cursor-pointer">
                    <i data-lucide="images" class="w-4 h-4"></i>이미지 추가
                    <input type="file" id="sc-files" accept="image/*" multiple class="hidden" /></label>
            </div>
            <button type="button" id="sc-add-current" class="w-full px-2 py-1.5 bg-white border border-teal-300 text-teal-800 rounded-lg font-bold flex items-center justify-center gap-1 disabled:opacity-40"><i data-lucide="corner-left-up" class="w-3.5 h-3.5"></i>위 전표 이미지를 스캔 쪽으로 추가</button>
            <div class="flex flex-wrap items-center gap-2">
                <span class="font-bold text-slate-500">보정</span>
                <select id="sc-mode" class="border border-slate-300 rounded px-1.5 py-1 font-bold">${Object.entries(MODES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
                <span id="sc-count" class="ml-auto text-slate-500 font-bold"></span>
            </div>
            <div id="sc-pages" class="grid grid-cols-3 gap-2"></div>
            <label class="block"><span class="font-bold text-slate-500">파일 이름</span>
                <input id="sc-name" class="mt-0.5 w-full border border-slate-300 rounded px-2 py-1 font-bold" /></label>
            <div class="flex flex-wrap items-center gap-2">
                <select id="sc-format" class="border border-slate-300 rounded px-1.5 py-1.5 font-bold">
                    <option value="pdf">PDF (여러 쪽 한 파일)</option>
                    <option value="jpg">JPG (쪽마다 한 장)</option>
                </select>
                <button type="button" id="sc-save" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-black flex items-center gap-1 disabled:opacity-40"><i data-lucide="download" class="w-4 h-4"></i>이 기기에 저장</button>
                <button type="button" id="sc-share" class="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-black flex items-center gap-1 disabled:opacity-40"><i data-lucide="share-2" class="w-4 h-4"></i>공유</button>
            </div>
            <p class="text-[10px] text-slate-400">스캔한 이미지는 이 기기 안에서만 처리되고 서버에 올라가지 않습니다. 공유는 휴대폰·PC의 공유 창(메신저·메일 등)을 엽니다.</p>
        </div>
    </details>`;
    $('#sc-name').value = `스캔_${stamp()}`;

    // ---------- 스캔 보정 ----------
    // 긴 변 최대 2200px로 줄이고(파일 크기), 회색·흑백은 종이 밝기·글자 진하기를 기준으로 밝기를 늘린다
    const scanCanvas = (page) => {
        const key = `${page.rotate}|${mode}`;
        if (page.cache?.key === key) return page.cache.canvas;
        const src = page.img;
        const sw = src.naturalWidth || src.width;
        const sh = src.naturalHeight || src.height;
        const scale = Math.min(1, 2200 / Math.max(sw, sh));
        const w = Math.round(sw * scale);
        const h = Math.round(sh * scale);
        const swap = page.rotate === 90 || page.rotate === 270;
        const c = document.createElement('canvas');
        c.width = swap ? h : w;
        c.height = swap ? w : h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate((page.rotate * Math.PI) / 180);
        ctx.drawImage(src, -w / 2, -h / 2, w, h);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const px = d.data;
        // 밝기 분포: 문서는 대부분이 종이라 60% 지점 = 종이 밝기(→ 흰색), 가장 어두운 1% = 글자(→ 검은색).
        // (글자는 면적이 작아 5%처럼 넉넉히 잡으면 종이가 글자로 잡혀 화면이 새까매진다)
        const hist = new Uint32Array(256);
        for (let i = 0; i < px.length; i += 4) hist[Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2])]++;
        const total = px.length / 4;
        const pct = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * p) return v; } return 255; };
        const hi = Math.max(60, pct(0.6));
        const lo = Math.max(0, Math.min(pct(0.01), hi - 60));
        const stretch = (v) => Math.max(0, Math.min(255, Math.round((v - lo) * (255 / (hi - lo)))));
        for (let i = 0; i < px.length; i += 4) {
            if (mode === 'color') {
                px[i] = stretch(px[i]); px[i + 1] = stretch(px[i + 1]); px[i + 2] = stretch(px[i + 2]);
                continue;
            }
            let g = stretch(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
            if (mode === 'bw') g = g > 190 ? 255 : g < 70 ? 0 : Math.round((g - 70) * (255 / 120)); // 종이는 희게, 글자는 검게
            px[i] = px[i + 1] = px[i + 2] = g;
        }
        ctx.putImageData(d, 0, 0);
        page.cache = { key, canvas: c };
        return c;
    };

    // ---------- 쪽 목록 ----------
    const render = () => {
        $('#sc-count').textContent = pages.length ? `${pages.length}쪽` : '';
        $('#sc-save').disabled = !pages.length;
        $('#sc-share').disabled = !pages.length;
        $('#sc-add-current').disabled = !getCurrent().img;
        const box = $('#sc-pages');
        box.innerHTML = pages.length ? '' : '<div class="col-span-3 p-3 text-center text-slate-400 border border-dashed border-slate-300 rounded-lg">스캔할 쪽을 찍거나 추가하세요.</div>';
        pages.forEach((p, i) => {
            const cell = document.createElement('div');
            cell.className = 'relative border border-slate-200 rounded-lg p-1 bg-slate-50';
            const c = scanCanvas(p);
            const thumb = document.createElement('img');
            thumb.src = c.toDataURL('image/jpeg', 0.6);
            thumb.className = 'w-full h-28 object-contain bg-white rounded';
            cell.appendChild(thumb);
            cell.insertAdjacentHTML('beforeend', `
                <div class="flex items-center justify-between mt-1 text-[10px] font-bold text-slate-600">
                    <span>${i + 1}쪽</span>
                    <span class="flex gap-0.5">
                        <button type="button" class="sc-left px-1 hover:text-teal-700 disabled:opacity-30" ${i === 0 ? 'disabled' : ''} title="앞으로">◀</button>
                        <button type="button" class="sc-right px-1 hover:text-teal-700 disabled:opacity-30" ${i === pages.length - 1 ? 'disabled' : ''} title="뒤로">▶</button>
                        <button type="button" class="sc-rot px-1 hover:text-teal-700" title="90° 회전">⟳</button>
                        <button type="button" class="sc-del px-1 hover:text-rose-600" title="이 쪽 빼기">✕</button>
                    </span>
                </div>`);
            cell.querySelector('.sc-left').addEventListener('click', () => { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; render(); });
            cell.querySelector('.sc-right').addEventListener('click', () => { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; render(); });
            cell.querySelector('.sc-rot').addEventListener('click', () => { p.rotate = (p.rotate + 90) % 360; render(); });
            cell.querySelector('.sc-del').addEventListener('click', () => { pages = pages.filter(x => x !== p); render(); });
            box.appendChild(cell);
        });
    };

    const addImage = (img, rotate = 0) => { pages.push({ id: pid(), img, rotate, cache: null }); render(); $('#sc-box').open = true; };
    const loadFiles = (files) => {
        const list = [...(files || [])].filter(f => /^image\//.test(f.type));
        if (!list.length) { alert('이미지 파일(JPG·PNG)을 골라 주세요.'); return; }
        list.forEach(f => {
            const url = URL.createObjectURL(f);
            const im = new Image();
            im.onload = () => { addImage(im); URL.revokeObjectURL(url); };
            im.onerror = () => alert(`${f.name}: 이미지를 열지 못했습니다.`);
            im.src = url;
        });
    };
    $('#sc-camera').addEventListener('change', (e) => { loadFiles(e.target.files); e.target.value = ''; });
    $('#sc-files').addEventListener('change', (e) => { loadFiles(e.target.files); e.target.value = ''; });
    $('#sc-add-current').addEventListener('click', () => { const { img, rotate } = getCurrent(); if (img) addImage(img, rotate || 0); });
    $('#sc-mode').addEventListener('change', (e) => { mode = e.target.value; render(); });

    // ---------- 파일 만들기 ----------
    const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));
    const fileName = () => ($('#sc-name').value.trim() || `스캔_${stamp()}`).replace(/[\\/:*?"<>|]/g, '_');
    const buildFiles = async () => {
        const base = fileName();
        const canvases = pages.map(scanCanvas);
        if ($('#sc-format').value === 'jpg') {
            const blobs = await Promise.all(canvases.map(c => toBlob(c, 'image/jpeg', 0.88)));
            return blobs.map((b, i) => new File([b], canvases.length > 1 ? `${base}_${i + 1}.jpg` : `${base}.jpg`, { type: 'image/jpeg' }));
        }
        const { PDFDocument } = await import('pdf-lib');
        const pdf = await PDFDocument.create();
        for (const c of canvases) {
            const jpg = await pdf.embedJpg(new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.85)).arrayBuffer()));
            // A4 폭(595pt)에 맞추고 높이는 쪽 비율대로
            const w = 595;
            const h = Math.round((w * c.height) / c.width);
            pdf.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h });
        }
        const bytes = await pdf.save();
        return [new File([bytes], `${base}.pdf`, { type: 'application/pdf' })];
    };
    const busy = async (btn, fn) => {
        btn.disabled = true;
        try { await fn(); } catch (err) { if (err?.name !== 'AbortError') alert(`처리하지 못했습니다: ${err.message || err}`); } finally { btn.disabled = !pages.length; }
    };

    $('#sc-save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const files = await buildFiles();
        for (const f of files) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(f);
            a.download = f.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 10000);
            if (files.length > 1) await new Promise(r => setTimeout(r, 300)); // 여러 장 저장 시 브라우저가 막지 않게 간격
        }
        showToast(`💾 ${files.length === 1 ? files[0].name : `${files.length}개 파일`}을 이 기기에 저장했습니다.`);
    }));

    $('#sc-share').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const files = await buildFiles();
        if (!navigator.canShare || !navigator.canShare({ files })) {
            alert('이 기기·브라우저에서는 파일 바로 공유를 지원하지 않습니다.\n[이 기기에 저장]으로 저장한 뒤 메신저·메일에 첨부해 주세요.');
            return;
        }
        await navigator.share({ files, title: fileName() });
        showToast('📤 공유 창을 열었습니다.');
    }));

    render();
    createIcons({ icons });
    return { refresh: render };
};
