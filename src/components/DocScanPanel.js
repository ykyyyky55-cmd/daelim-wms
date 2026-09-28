import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

// ---------- 문서 영역 (자동 찾기 · 반듯하게 펴기) ----------
// 네 모서리는 원본 그림 기준 0~1 비율 좌표 [[x,y] 왼위, 오위, 오아래, 왼아래]

// 밝은 종이가 가장 크게 이어진 부분을 찾아 네 모서리를 고른다 (책상·바닥보다 종이가 밝다는 가정)
const autoQuad = (img) => {
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    const s = Math.min(1, 400 / Math.max(sw, sh));
    const w = Math.max(2, Math.round(sw * s));
    const h = Math.max(2, Math.round(sh * s));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    const hist = new Uint32Array(256);
    for (let i = 0; i < w * h; i++) {
        const g = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
        gray[i] = g;
        hist[g]++;
    }
    // Otsu: 종이(밝음)와 배경(어두움)을 가르는 밝기
    let sum = 0;
    for (let v = 0; v < 256; v++) sum += v * hist[v];
    let sumB = 0, wB = 0, best = 0, t = 128;
    for (let v = 0; v < 256; v++) {
        wB += hist[v];
        if (!wB) continue;
        const wF = w * h - wB;
        if (!wF) break;
        sumB += v * hist[v];
        const between = wB * wF * ((sumB / wB) - ((sum - sumB) / wF)) ** 2;
        if (between > best) { best = between; t = v; }
    }
    // 밝은 칸끼리 이어진 덩어리 중 가장 큰 것 (글자 구멍은 무시)
    const label = new Int32Array(w * h).fill(-1);
    let bestPts = null;
    const stack = [];
    for (let start = 0; start < w * h; start++) {
        if (label[start] !== -1 || gray[start] <= t) continue;
        const pts = [];
        label[start] = start;
        stack.push(start);
        while (stack.length) {
            const i = stack.pop();
            pts.push(i);
            const x = i % w, y = (i / w) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const j = ny * w + nx;
                if (label[j] === -1 && gray[j] > t) { label[j] = start; stack.push(j); }
            }
        }
        if (!bestPts || pts.length > bestPts.length) bestPts = pts;
    }
    if (!bestPts) return null;
    const ratio = bestPts.length / (w * h);
    if (ratio < 0.15 || ratio > 0.97) return null; // 너무 작거나 거의 전체면 자르지 않음
    // 모서리: x+y 최소(왼위)·최대(오아래), x−y 최대(오위)·최소(왼아래)
    let tl, tr, br, bl;
    for (const i of bestPts) {
        const x = i % w, y = (i / w) | 0;
        if (!tl || x + y < tl[0] + tl[1]) tl = [x, y];
        if (!br || x + y > br[0] + br[1]) br = [x, y];
        if (!tr || x - y > tr[0] - tr[1]) tr = [x, y];
        if (!bl || x - y < bl[0] - bl[1]) bl = [x, y];
    }
    return [tl, tr, br, bl].map(([x, y]) => [x / (w - 1), y / (h - 1)]);
};

// 8개 미지수 선형방정식 풀이 (가우스 소거)
const solve = (A, b) => {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        let piv = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
        [M[col], M[piv]] = [M[piv], M[col]];
        const d = M[col][col] || 1e-12;
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = M[r][col] / d;
            for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
        }
    }
    return M.map((row, i) => row[n] / (row[i] || 1e-12));
};
// 결과 직사각형(0..W, 0..H) → 원본 사각형 좌표로 보내는 원근 변환
const homography = (W, H, quad) => {
    const dst = [[0, 0], [W, 0], [W, H], [0, H]];
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
        const [x, y] = dst[i];
        const [u, v] = quad[i];
        A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
        A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    return solve(A, b);
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 원본에서 네 모서리 안쪽만 반듯한 직사각형으로 펴서 캔버스로 (긴 변 최대 maxSide) */
export const warpQuad = (img, quadN, maxSide = 2200) => {
    // 휴대폰 사진(1200만 화소 이상)은 먼저 긴 변 2600px로 줄여 메모리·시간을 아낀다
    const s0 = Math.min(1, 2600 / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const sw = Math.max(2, Math.round((img.naturalWidth || img.width) * s0));
    const sh = Math.max(2, Math.round((img.naturalHeight || img.height) * s0));
    const src = document.createElement('canvas');
    src.width = sw;
    src.height = sh;
    const sctx = src.getContext('2d');
    sctx.drawImage(img, 0, 0, sw, sh);
    const sp = sctx.getImageData(0, 0, sw, sh).data;
    const q = quadN.map(([x, y]) => [x * (sw - 1), y * (sh - 1)]);
    let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
    let H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const k = Math.min(1, maxSide / Math.max(W, H));
    W = Math.max(2, Math.round(W * k));
    H = Math.max(2, Math.round(H * k));
    const [a, b, c, d, e, f, g, h] = homography(W, H, q);
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const octx = out.getContext('2d');
    const od = octx.createImageData(W, H);
    const op = od.data;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const den = g * x + h * y + 1;
            const u = (a * x + b * y + c) / den;
            const v = (d * x + e * y + f) / den;
            // 양선형 보간
            const x0 = Math.max(0, Math.min(sw - 2, Math.floor(u)));
            const y0 = Math.max(0, Math.min(sh - 2, Math.floor(v)));
            const fx = Math.max(0, Math.min(1, u - x0));
            const fy = Math.max(0, Math.min(1, v - y0));
            const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
            const o = (y * W + x) * 4;
            for (let ch = 0; ch < 3; ch++) {
                op[o + ch] = (sp[i00 + ch] * (1 - fx) + sp[i10 + ch] * fx) * (1 - fy) + (sp[i01 + ch] * (1 - fx) + sp[i11 + ch] * fx) * fy;
            }
            op[o + 3] = 255;
        }
    }
    octx.putImageData(od, 0, 0);
    return out;
};

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
        const key = `${page.rotate}|${mode}|${JSON.stringify(page.quad || null)}`;
        if (page.cache?.key === key) return page.cache.canvas;
        // 문서 영역이 있으면 먼저 그 부분만 반듯하게 편 뒤 회전·보정
        const src = page.quad ? warpQuad(page.img, page.quad) : page.img;
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
        const W = c.width, H = c.height;
        const gray = new Float32Array(W * H);
        for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        // 그림자 지우기: 부분마다 종이 밝기(배경)를 어림해 그 밝기로 나눈다 → 폰·손 그림자로 어두운 곳도 종이는 고르게 흰색
        // (조각 16px 크기로 줄여 조각마다 가장 밝은 값 = 종이, 글자 자국은 주변 최댓값으로 메우고 흐리게 한 뒤 다시 키움)
        const B = 16;
        const bw = Math.ceil(W / B), bh = Math.ceil(H / B);
        let bg = new Float32Array(bw * bh);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const k = ((y / B) | 0) * bw + ((x / B) | 0);
            if (gray[y * W + x] > bg[k]) bg[k] = gray[y * W + x];
        }
        const pass = (fn) => { const out = new Float32Array(bw * bh); for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) out[y * bw + x] = fn(x, y); bg = out; };
        const at = (x, y) => bg[Math.max(0, Math.min(bh - 1, y)) * bw + Math.max(0, Math.min(bw - 1, x))];
        for (let r = 0; r < 2; r++) pass((x, y) => Math.max(at(x - 1, y - 1), at(x, y - 1), at(x + 1, y - 1), at(x - 1, y), at(x, y), at(x + 1, y), at(x - 1, y + 1), at(x, y + 1), at(x + 1, y + 1)));
        for (let r = 0; r < 3; r++) pass((x, y) => (at(x - 1, y - 1) + at(x, y - 1) + at(x + 1, y - 1) + at(x - 1, y) + at(x, y) + at(x + 1, y) + at(x - 1, y + 1) + at(x, y + 1) + at(x + 1, y + 1)) / 9);
        const bgAt = (x, y) => { // 양선형으로 원래 크기에 맞춤
            const fx = x / B - 0.5, fy = y / B - 0.5;
            const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
            return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
        };
        const gain = new Float32Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) gain[y * W + x] = 245 / Math.max(40, bgAt(x, y));
        // 밝기 분포(그림자 지운 뒤): 60% 지점 = 종이(→ 흰색), 가장 어두운 1% = 글자(→ 검은색)
        const hist = new Uint32Array(256);
        for (let j = 0; j < gray.length; j++) hist[Math.min(255, Math.round(gray[j] * gain[j]))]++;
        const total = gray.length;
        const pct = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * p) return v; } return 255; };
        const hi = Math.max(60, pct(0.6));
        const lo = Math.max(0, Math.min(pct(0.01), hi - 60));
        const stretch = (v) => Math.max(0, Math.min(255, Math.round((v - lo) * (255 / (hi - lo)))));
        for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
            if (mode === 'color') {
                px[i] = stretch(px[i] * gain[j]); px[i + 1] = stretch(px[i + 1] * gain[j]); px[i + 2] = stretch(px[i + 2] * gain[j]);
                continue;
            }
            let g = stretch(gray[j] * gain[j]);
            if (mode === 'bw') g = g > 190 ? 255 : g < 70 ? 0 : Math.round((g - 70) * (255 / 120)); // 종이는 희게, 글자는 검게
            else g = Math.min(255, Math.round(g * (255 / 215))); // 회색: 종이에 가까운 밝기는 흰색으로 (그림자 가장자리의 옅은 얼룩 제거)
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
                        <button type="button" class="sc-crop px-1 hover:text-teal-700 ${p.quad ? 'text-teal-700' : ''}" title="문서 영역 자르기">✂</button>
                        <button type="button" class="sc-rot px-1 hover:text-teal-700" title="90° 회전">⟳</button>
                        <button type="button" class="sc-del px-1 hover:text-rose-600" title="이 쪽 빼기">✕</button>
                    </span>
                </div>`);
            cell.querySelector('.sc-left').addEventListener('click', () => { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; render(); });
            cell.querySelector('.sc-right').addEventListener('click', () => { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; render(); });
            cell.querySelector('.sc-rot').addEventListener('click', () => { p.rotate = (p.rotate + 90) % 360; render(); });
            cell.querySelector('.sc-crop').addEventListener('click', () => openCropEditor(p));
            cell.querySelector('.sc-del').addEventListener('click', () => { pages = pages.filter(x => x !== p); render(); });
            box.appendChild(cell);
        });
        schedulePrepare();
    };

    // 쪽을 넣을 때 문서 영역(밝은 종이)을 자동으로 찾아 둔다. 못 찾으면 전체.
    const addImage = (img, rotate = 0) => {
        let quad = null;
        try { quad = autoQuad(img); } catch (e) { console.warn('[문서 스캔] 문서 영역 찾기 실패', e); }
        pages.push({ id: pid(), img, rotate, quad, cache: null });
        render();
        $('#sc-box').open = true;
        if (quad) showToast('✂ 문서 영역을 자동으로 잘랐습니다. 맞지 않으면 쪽의 ✂ 버튼으로 모서리를 고치세요.');
    };

    // ---------- 문서 영역 편집 (네 모서리 끌기) ----------
    const openCropEditor = (page) => {
        const img = page.img;
        const sw = img.naturalWidth || img.width;
        const sh = img.naturalHeight || img.height;
        let quad = (page.quad || [[0, 0], [1, 0], [1, 1], [0, 1]]).map(p => [...p]);
        const ov = document.createElement('div');
        ov.className = 'fixed inset-0 z-[9999] bg-slate-900/90 flex flex-col items-center justify-center p-3 text-xs select-none';
        ov.innerHTML = `
            <div class="text-white font-black mb-2">네 모서리(동그라미)를 문서 모서리에 맞춰 끌어 주세요</div>
            <div class="sc-stage relative touch-none"></div>
            <div class="flex flex-wrap justify-center gap-2 mt-3">
                <button type="button" class="sc-auto px-3 py-2 bg-white rounded-lg font-bold">자동 찾기</button>
                <button type="button" class="sc-full px-3 py-2 bg-white rounded-lg font-bold">전체 (자르지 않기)</button>
                <button type="button" class="sc-cancel px-3 py-2 bg-slate-600 text-white rounded-lg font-bold">취소</button>
                <button type="button" class="sc-apply px-4 py-2 bg-teal-500 text-white rounded-lg font-black">적용</button>
            </div>`;
        document.body.appendChild(ov);
        const stage = ov.querySelector('.sc-stage');
        const maxW = Math.min(window.innerWidth - 24, 900);
        const maxH = window.innerHeight - 140;
        const k = Math.min(maxW / sw, maxH / sh);
        const dw = Math.round(sw * k);
        const dh = Math.round(sh * k);
        stage.style.width = `${dw}px`;
        stage.style.height = `${dh}px`;
        const base = document.createElement('canvas');
        base.width = dw;
        base.height = dh;
        base.getContext('2d').drawImage(img, 0, 0, dw, dh);
        base.className = 'absolute inset-0 rounded';
        stage.appendChild(base);
        const line = document.createElement('canvas');
        line.width = dw;
        line.height = dh;
        line.className = 'absolute inset-0 pointer-events-none';
        stage.appendChild(line);
        const handles = quad.map((_, i) => {
            const hnd = document.createElement('div');
            hnd.className = 'absolute w-11 h-11 -ml-[22px] -mt-[22px] flex items-center justify-center cursor-grab';
            hnd.innerHTML = '<div class="w-5 h-5 rounded-full bg-teal-400 border-2 border-white shadow"></div>';
            hnd.dataset.i = i;
            stage.appendChild(hnd);
            return hnd;
        });
        const draw = () => {
            const ctx = line.getContext('2d');
            ctx.clearRect(0, 0, dw, dh);
            // 잘려 나갈 바깥은 어둡게
            ctx.fillStyle = 'rgba(15,23,42,0.45)';
            ctx.fillRect(0, 0, dw, dh);
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = '#000'; // 안쪽은 어둡게 한 것을 완전히 지운다 (반투명 색으로 지우면 반만 지워짐)
            ctx.beginPath();
            quad.forEach(([x, y], i) => (i ? ctx.lineTo(x * dw, y * dh) : ctx.moveTo(x * dw, y * dh)));
            ctx.closePath();
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = '#2dd4bf';
            ctx.lineWidth = 2;
            ctx.stroke();
            handles.forEach((hnd, i) => { hnd.style.left = `${quad[i][0] * dw}px`; hnd.style.top = `${quad[i][1] * dh}px`; });
        };
        let dragging = -1;
        const posOf = (e) => {
            const r = stage.getBoundingClientRect();
            return [Math.max(0, Math.min(1, (e.clientX - r.left) / dw)), Math.max(0, Math.min(1, (e.clientY - r.top) / dh))];
        };
        handles.forEach(hnd => hnd.addEventListener('pointerdown', (e) => { dragging = Number(hnd.dataset.i); hnd.setPointerCapture(e.pointerId); e.preventDefault(); }));
        stage.addEventListener('pointermove', (e) => { if (dragging < 0) return; quad[dragging] = posOf(e); draw(); });
        stage.addEventListener('pointerup', () => { dragging = -1; });
        stage.addEventListener('pointercancel', () => { dragging = -1; });
        const close = () => ov.remove();
        ov.querySelector('.sc-auto').addEventListener('click', () => {
            const q = autoQuad(img);
            if (!q) { alert('문서 영역을 자동으로 찾지 못했습니다. 모서리를 직접 끌어 주세요.'); return; }
            quad = q;
            draw();
        });
        ov.querySelector('.sc-full').addEventListener('click', () => { quad = [[0, 0], [1, 0], [1, 1], [0, 1]]; draw(); });
        ov.querySelector('.sc-cancel').addEventListener('click', close);
        ov.querySelector('.sc-apply').addEventListener('click', () => {
            const full = quad.every(([x, y], i) => Math.abs(x - [0, 1, 1, 0][i]) < 0.005 && Math.abs(y - [0, 0, 1, 1][i]) < 0.005);
            page.quad = full ? null : quad;
            close();
            render();
        });
        draw();
    };
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
    $('#sc-format').addEventListener('change', () => schedulePrepare());
    $('#sc-name').addEventListener('input', () => schedulePrepare());

    // ---------- 파일 만들기 ----------
    const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));
    const fileName = () => ($('#sc-name').value.trim() || `스캔_${stamp()}`).replace(/[\\/:*?"<>|]/g, '_');
    // ascii: 공유용. 일부 안드로이드 공유 창은 한글 파일 이름을 못 읽어 계속 불러오기만 하므로 영문·숫자 이름을 쓴다
    const asciiName = () => `scan_${stamp()}`;
    const buildFiles = async (format = $('#sc-format').value, { ascii = false } = {}) => {
        const base = ascii ? asciiName() : fileName();
        const canvases = pages.map(scanCanvas);
        if (format === 'jpg') {
            const blobs = await Promise.all(canvases.map(c => toBlob(c, 'image/jpeg', 0.82)));
            return blobs.map((b, i) => new File([b], canvases.length > 1 ? `${base}_${i + 1}.jpg` : `${base}.jpg`, { type: 'image/jpeg' }));
        }
        const { PDFDocument } = await import('pdf-lib');
        const pdf = await PDFDocument.create();
        for (const c of canvases) {
            const jpg = await pdf.embedJpg(new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.8)).arrayBuffer()));
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

    // 공유는 누른 직후(사용자 동작 안)에 바로 불러야 브라우저가 공유 창을 연다.
    // 누른 뒤 PDF를 만들면 시간이 걸려 막히므로, 쪽·보정·형식·이름이 바뀔 때마다 파일을 미리 만들어 둔다.
    // PDF 공유를 막는 브라우저(일부 삼성 인터넷 등)를 위해 PDF일 때는 같은 쪽의 JPG도 함께 만들어 두었다가 대신 공유한다.
    let prepared = { key: '', files: null, jpgs: null };
    let preparing = null;
    let prepTimer = null;
    const prepKey = () => JSON.stringify([pages.map(p => [p.id, p.rotate, p.quad]), mode, $('#sc-format').value, fileName()]);
    const prepare = async () => {
        if (!pages.length) { prepared = { key: '', files: null, jpgs: null }; return; }
        const key = prepKey();
        if (prepared.key === key) return;
        const fmt = $('#sc-format').value;
        const job = Promise.all([buildFiles(fmt, { ascii: true }), fmt === 'pdf' ? buildFiles('jpg', { ascii: true }) : null])
            .then(([files, jpgs]) => { if (prepKey() === key) prepared = { key, files, jpgs: jpgs || files }; });
        preparing = job;
        try { await job; } catch (e) { console.warn('[문서 스캔] 파일 미리 만들기 실패', e); } finally { if (preparing === job) preparing = null; }
    };
    const schedulePrepare = () => { clearTimeout(prepTimer); prepTimer = setTimeout(prepare, 400); };

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

    const NO_SHARE = '이 기기·브라우저에서는 파일 바로 공유를 지원하지 않습니다.\n(카카오톡 등 앱 안에서 연 화면은 공유가 막혀 있을 수 있습니다. 크롬·사파리·삼성 인터넷으로 열어 보세요.)\n[이 기기에 저장]으로 저장한 뒤 메신저·메일에 첨부해도 됩니다.';
    $('#sc-share').addEventListener('click', () => {
        if (typeof navigator.share !== 'function') { alert(NO_SHARE); return; }
        // 미리 만든 파일이 있으면 기다리지 않고 바로 공유 창을 연다
        if (prepared.files && prepared.key === prepKey()) {
            const ok = (files) => !navigator.canShare || navigator.canShare({ files });
            let files = prepared.files;
            let note = '';
            if (!ok(files) && prepared.jpgs && prepared.jpgs !== files && ok(prepared.jpgs)) {
                files = prepared.jpgs; // PDF 공유가 안 되는 브라우저: 같은 쪽을 JPG로
                note = ' (이 브라우저는 PDF 공유를 지원하지 않아 JPG로 보냈습니다)';
            }
            if (!ok(files)) { alert(NO_SHARE); return; }
            // 제목 등을 함께 넘기면 거부하는 휴대폰 브라우저가 있어 파일만 넘긴다
            navigator.share({ files })
                .then(() => showToast(`📤 공유했습니다.${note}`))
                .catch(err => {
                    if (err?.name === 'AbortError') return; // 공유 창에서 취소
                    const why = err?.name === 'NotAllowedError' ? '브라우저가 막았습니다. 잠시 뒤 [공유]를 다시 눌러 주세요.' : `${err?.name || ''} ${err?.message || err}`.trim();
                    alert(`공유 창을 열지 못했습니다: ${why}\n안 되면 형식을 JPG로 바꾸거나 [이 기기에 저장] 후 첨부해 주세요.`);
                });
            return;
        }
        // 아직 준비 중이면 만든 뒤 한 번 더 누르도록 안내 (기다린 뒤 여는 공유는 브라우저가 막는다)
        const btn = $('#sc-share');
        btn.disabled = true;
        const label = btn.innerHTML;
        btn.innerHTML = '파일 준비 중…';
        prepare().finally(() => {
            btn.innerHTML = label;
            btn.disabled = !pages.length;
            createIcons({ icons });
            if (prepared.files) showToast('📄 공유할 파일이 준비됐습니다. [공유]를 한 번 더 눌러 주세요.');
        });
    });

    render();
    createIcons({ icons });
    return { refresh: render };
};
