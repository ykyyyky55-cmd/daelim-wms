import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { localDateStr } from '../services/searchUtils.js';
import { saveDocument, DOC_DIRECTIONS, DOC_TYPES, isCloudFiles } from '../services/fileStore.js';
import { summaryCanvas } from '../services/scanShare.js';
// ---------- 방향 판단 (글자 인식 없이 그림 모양으로, 즉시) ----------
// 잉크(어두운 칸) 지도: 긴 변 800px로 줄이고, 글자보다 긴 가로·세로 선(표 선)은 지운다
const inkMap = (src) => {
    const k = Math.min(1, 800 / Math.max(src.width, src.height));
    const w = Math.max(2, Math.round(src.width * k)), h = Math.max(2, Math.round(src.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0, w, h);
    const px = x.getImageData(0, 0, w, h).data;
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) ink[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) < 140 ? 1 : 0;
    const minRun = Math.max(20, Math.round(Math.max(w, h) * 0.035)); // 글자(약 2%)보다 긴 줄 = 선
    const kill = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        let run = 0;
        for (let xx = 0; xx <= w; xx++) {
            if (xx < w && ink[y * w + xx]) { run++; continue; }
            if (run >= minRun) kill.fill(1, y * w + xx - run, y * w + xx);
            run = 0;
        }
    }
    for (let xx = 0; xx < w; xx++) {
        let run = 0;
        for (let y = 0; y <= h; y++) {
            if (y < h && ink[y * w + xx]) { run++; continue; }
            if (run >= minRun) for (let t = y - run; t < y; t++) kill[t * w + xx] = 1;
            run = 0;
        }
    }
    for (let i = 0; i < w * h; i++) if (kill[i]) ink[i] = 0;
    return { ink, w, h };
};
// 글자 줄이 가로면 가로 방향 합(행 합)이 줄·줄 사이로 크게 출렁이고 세로 방향 합은 평평하다 → 출렁임(변동계수) 비교
const profileCv = (p) => {
    const r = Math.max(2, Math.round(p.length * 0.008));
    const s = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) {
        let a = 0, n = 0;
        for (let t = -r; t <= r; t++) { const j = i + t; if (j >= 0 && j < p.length) { a += p[j]; n++; } }
        s[i] = a / n;
    }
    let mx = 0;
    for (const v of s) if (v > mx) mx = v;
    if (!mx) return 0;
    let lo = 0, hi = s.length - 1;
    while (lo < hi && s[lo] < mx * 0.05) lo++;
    while (hi > lo && s[hi] < mx * 0.05) hi--;
    let m = 0;
    for (let i = lo; i <= hi; i++) m += s[i];
    m /= hi - lo + 1;
    let v = 0;
    for (let i = lo; i <= hi; i++) v += (s[i] - m) ** 2;
    return m ? Math.sqrt(v / (hi - lo + 1)) / m : 0;
};
const isSideways = ({ ink, w, h }) => {
    const rows = new Float32Array(h), cols = new Float32Array(w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink[y * w + x]) { rows[y]++; cols[x]++; }
    const rc = profileCv(rows), cc = profileCv(cols);
    return cc > 0.5 && cc > rc * 1.6; // 세로 방향 출렁임이 훨씬 크면 글자가 누운 것
};
// (가로 글자로 세운 그림에서) 줄 시작이 고르게 맞고 글자가 왼쪽에 몰려 있으면 바르게 선 것. +면 바름, −면 거꾸로(180°)
const uprightScore = ({ ink, w, h }) => {
    const rows = new Float32Array(h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows[y] += ink[y * w + x];
    let mx = 0;
    for (const v of rows) if (v > mx) mx = v;
    const starts = [], ends = [];
    let s = -1, sumX = 0, cnt = 0, minX = w, maxX = 0;
    for (let y = 0; y <= h; y++) {
        const on = y < h && rows[y] > mx * 0.08;
        if (on && s < 0) s = y;
        if (!on && s >= 0) {
            if (y - s >= 3) {
                let l = w, r = -1;
                for (let yy = s; yy < y; yy++) for (let x = 0; x < w; x++) if (ink[yy * w + x]) { if (x < l) l = x; if (x > r) r = x; sumX += x; cnt++; }
                if (r > l) { starts.push(l); ends.push(r); minX = Math.min(minX, l); maxX = Math.max(maxX, r); }
            }
            s = -1;
        }
    }
    const mad = (a) => {
        if (!a.length) return 0;
        const q = [...a].sort((p, r) => p - r);
        const med = q[q.length >> 1];
        const d = a.map(v => Math.abs(v - med)).sort((p, r) => p - r);
        return d[d.length >> 1];
    };
    const align = mad(ends) - mad(starts); // 끝이 들쭉날쭉하고 시작이 고르면 +
    if (Math.abs(align) >= 2) return align;
    const com = cnt && maxX > minX ? (sumX / cnt - minX) / (maxX - minX) : 0.5; // 글자 무게중심(0 왼쪽 ~ 1 오른쪽)
    return com < 0.47 ? 1 : com > 0.53 ? -1 : 0;
};

// 캔버스를 deg(0/90/180/270)만큼 돌리며 긴 변 maxSide 이하로 줄인다
const rotatedSmall = (src, deg, maxSide = 1200) => {
    const k = Math.min(1, maxSide / Math.max(src.width, src.height));
    const w = Math.round(src.width * k), h = Math.round(src.height * k);
    const swap = deg === 90 || deg === 270;
    const c = document.createElement('canvas');
    c.width = swap ? h : w;
    c.height = swap ? w : h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
    return c;
};

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
    // 밝은 칸 지도를 닫힘 연산(밝게 번지기 → 다시 줄이기, 폭 약 3%)으로 다듬는다:
    // 접힌 선·글자 줄처럼 가는 어두운 띠가 종이를 두 조각으로 갈라 한쪽이 잘려 나가지 않게
    let bright = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) bright[i] = gray[i] > t ? 1 : 0;
    const R = Math.max(3, Math.round(Math.max(w, h) * 0.03));
    const morph = (src, horiz, grow) => {
        const out = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let v = grow ? 0 : 1;
                for (let d = -R; d <= R; d++) {
                    const xx = horiz ? Math.max(0, Math.min(w - 1, x + d)) : x;
                    const yy = horiz ? y : Math.max(0, Math.min(h - 1, y + d));
                    const s = src[yy * w + xx];
                    if (grow ? s : !s) { v = grow ? 1 : 0; break; }
                }
                out[y * w + x] = v;
            }
        }
        return out;
    };
    bright = morph(morph(bright, true, true), false, true);
    bright = morph(morph(bright, true, false), false, false);
    // 밝은 칸끼리 이어진 덩어리 중 가장 큰 것
    const label = new Int32Array(w * h).fill(-1);
    let bestPts = null;
    const stack = [];
    for (let start = 0; start < w * h; start++) {
        if (label[start] !== -1 || !bright[start]) continue;
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
                if (label[j] === -1 && bright[j]) { label[j] = start; stack.push(j); }
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
        <summary class="font-bold text-slate-700 cursor-pointer flex items-center gap-1"><i data-lucide="file-scan" class="w-4 h-4 text-teal-600"></i>문서 스캔 (등록·저장·공유)</summary>
        <div class="mt-2 space-y-2">
            <button type="button" id="sc-burst" class="w-full px-2 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-black flex items-center justify-center gap-1"><i data-lucide="camera" class="w-4 h-4"></i>여러 장 연속 찍기</button>
            <div class="grid grid-cols-2 gap-2">
                <label class="px-2 py-2 bg-white border border-teal-300 text-teal-800 rounded-lg font-bold flex items-center justify-center gap-1 cursor-pointer">
                    <i data-lucide="camera" class="w-4 h-4"></i>한 장 찍기
                    <input type="file" id="sc-camera" accept="image/*" capture="environment" class="hidden" /></label>
                <label class="px-2 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-lg font-black flex items-center justify-center gap-1 cursor-pointer">
                    <i data-lucide="images" class="w-4 h-4"></i>사진 여러 장 고르기
                    <input type="file" id="sc-files" accept="image/*" multiple class="hidden" /></label>
            </div>
            <button type="button" id="sc-add-current" class="w-full px-2 py-1.5 bg-white border border-teal-300 text-teal-800 rounded-lg font-bold flex items-center justify-center gap-1 disabled:opacity-40"><i data-lucide="corner-left-up" class="w-3.5 h-3.5"></i>위 전표 이미지를 스캔 쪽으로 추가</button>
            <div class="flex flex-wrap items-center gap-2">
                <span class="font-bold text-slate-500">보정</span>
                <select id="sc-mode" class="border border-slate-300 rounded px-1.5 py-1 font-bold">${Object.entries(MODES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
                <span id="sc-count" class="ml-auto text-slate-500 font-bold"></span>
            </div>
            <div id="sc-pages" class="grid grid-cols-3 gap-2"></div>
            <div class="border border-indigo-200 bg-indigo-50 rounded-lg p-2 space-y-1.5">
                <div class="font-black text-indigo-800 flex items-center gap-1"><i data-lucide="archive" class="w-4 h-4"></i>문서로 등록 <span class="font-normal text-indigo-600">(글자 읽기 없이 바로 · 파일 저장소 '접수·발행 문서')</span></div>
                <div class="grid grid-cols-2 gap-1.5">
                    <label><span class="font-bold text-slate-500">구분</span>
                        <select id="sc-r-dir" class="mt-0.5 w-full border border-slate-300 rounded px-1.5 py-1 font-bold bg-white">${Object.entries(DOC_DIRECTIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
                    <label><span class="font-bold text-slate-500">일자</span>
                        <input id="sc-r-date" type="date" class="mt-0.5 w-full border border-slate-300 rounded px-1.5 py-1 font-bold bg-white" /></label>
                    <label><span class="font-bold text-slate-500">종류</span>
                        <select id="sc-r-type" class="mt-0.5 w-full border border-slate-300 rounded px-1.5 py-1 font-bold bg-white">${DOC_TYPES.map(t => `<option>${esc(t)}</option>`).join('')}</select></label>
                    <label><span class="font-bold text-slate-500">상대처</span>
                        <input id="sc-r-party" class="mt-0.5 w-full border border-slate-300 rounded px-1.5 py-1 bg-white" placeholder="거래처·기관" /></label>
                    <label><span class="font-bold text-slate-500">원본 문서번호</span>
                        <input id="sc-r-docno" class="mt-0.5 w-full border border-slate-300 rounded px-1.5 py-1 bg-white" /></label>
                    <label><span class="font-bold text-slate-500">제목 <span class="text-rose-500">*</span></span>
                        <input id="sc-r-title" class="mt-0.5 w-full border border-slate-300 rounded px-1.5 py-1 bg-white" /></label>
                    <label class="col-span-2"><span class="font-bold text-slate-500">메모</span>
                        <input id="sc-r-memo" class="mt-0.5 w-full border border-slate-300 rounded px-1.5 py-1 bg-white" /></label>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <button type="button" id="sc-register" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black flex items-center gap-1 disabled:opacity-40"><i data-lucide="file-plus" class="w-4 h-4"></i>문서로 등록</button>
                    <span id="sc-reg-result" class="font-bold text-indigo-800"></span>
                </div>
                <label class="flex items-center gap-1.5 font-bold text-slate-600"><input type="checkbox" id="sc-cover" disabled /> 저장·공유할 때 등록 정보 표지를 첫 쪽에 넣기</label>
            </div>
            <label class="block"><span class="font-bold text-slate-500">파일 이름</span>
                <input id="sc-name" class="mt-0.5 w-full border border-slate-300 rounded px-2 py-1 font-bold" /></label>
            <div class="grid grid-cols-2 gap-2">
                <button type="button" id="sc-share" class="px-2 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-black flex items-center justify-center gap-1 disabled:opacity-40"><i data-lucide="share-2" class="w-4 h-4"></i><span>PDF 한 파일로 공유</span></button>
                <button type="button" id="sc-share-jpg" class="px-2 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black flex items-center justify-center gap-1 disabled:opacity-40"><i data-lucide="images" class="w-4 h-4"></i><span id="sc-share-jpg-text">사진 여러 장으로 공유</span></button>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <select id="sc-format" class="border border-slate-300 rounded px-1.5 py-1.5 font-bold">
                    <option value="pdf">PDF (여러 쪽 한 파일)</option>
                    <option value="jpg">JPG (쪽마다 한 장)</option>
                </select>
                <button type="button" id="sc-save" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-black flex items-center gap-1 disabled:opacity-40"><i data-lucide="download" class="w-4 h-4"></i>이 기기에 저장</button>
            </div>
            <p class="text-[10px] text-slate-400">스캔 보정은 이 기기 안에서 합니다. [문서로 등록]을 누를 때만 스캔 PDF가 파일 저장소(비공개)에 올라갑니다. 공유는 휴대폰·PC의 공유 창(메신저·메일 등)을 엽니다.</p>
        </div>
    </details>`;
    $('#sc-name').value = `스캔_${stamp()}`;
    $('#sc-r-date').value = localDateStr();
    const canRegister = canPerformAction('WRITE_STOCK');
    let registered = null; // 등록한 문서 { doc, pagesKey, coverCanvas }
    const pagesKey = () => JSON.stringify(pages.map(p => [p.id, p.rotate, p.quad]).concat(mode));

    // 등록 정보 표지 (그림으로 그려 넣으므로 PDF 한글 글꼴이 필요 없다)
    const coverCanvas = () => {
        if (!registered || !$('#sc-cover').checked) return null;
        if (!registered.coverCanvas) {
            const d = registered.doc;
            registered.coverCanvas = summaryCanvas({
                title: `문서 ${DOC_DIRECTIONS[d.direction] || ''} 등록`,
                subtitle: '대림오일 WMS · 파일 저장소 접수·발행 문서',
                fields: [
                    ['접수번호', d.regNo], ['구분', DOC_DIRECTIONS[d.direction]], ['일자', d.date], ['종류', d.type],
                    ['상대처', d.party], ['원본 문서번호', d.docNo], ['제목', d.title], ['메모', d.memo],
                    ['등록자', d.by || state.currentUser?.name || ''], ['첨부', `스캔 ${registered.pageCount}쪽 (${registered.fileName})`]
                ],
                note: `등록 시각 ${new Date(d.at || Date.now()).toLocaleString('ko-KR')} · 다음 쪽부터 스캔 원본`
            });
        }
        return registered.coverCanvas;
    };

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
        // 그림자·접힌 자국 지우기: 부분마다 종이 밝기(배경)를 구해 그 밝기로 나눈다 → 그늘진 곳도 종이는 고르게 흰색.
        // 절반 크기에서 닫힘 연산(최댓값 번지기 → 최솟값 줄이기, 폭 13칸 ≈ 원래 26px)으로 글자 획처럼 가는 어두운 부분만 걷어 내면,
        // 그보다 넓은 그림자·접힌 선의 그늘은 배경에 남아 나눗셈으로 지워진다. 마지막에 살짝 흐리게.
        const S = 2;
        const bw = Math.ceil(W / S), bh = Math.ceil(H / S);
        let bg = new Float32Array(bw * bh);
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) bg[y * bw + x] = gray[Math.min(H - 1, y * S) * W + Math.min(W - 1, x * S)];
        const R = 6;
        const filt = (src, horiz, pick) => {
            const out = new Float32Array(bw * bh);
            for (let y = 0; y < bh; y++) {
                for (let x = 0; x < bw; x++) {
                    let v = pick === 'max' ? 0 : 255;
                    for (let t = -R; t <= R; t++) {
                        const xx = horiz ? Math.max(0, Math.min(bw - 1, x + t)) : x;
                        const yy = horiz ? y : Math.max(0, Math.min(bh - 1, y + t));
                        const s = src[yy * bw + xx];
                        v = pick === 'max' ? (s > v ? s : v) : (s < v ? s : v);
                    }
                    out[y * bw + x] = v;
                }
            }
            return out;
        };
        bg = filt(filt(bg, true, 'max'), false, 'max'); // 번지기: 글자 획을 주변 종이 밝기로 덮음
        bg = filt(filt(bg, true, 'min'), false, 'min'); // 줄이기: 넓은 그늘(그림자·접힌 선)은 원래 모양으로
        const blur = (src) => {
            const out = new Float32Array(bw * bh);
            const at = (x, y) => src[Math.max(0, Math.min(bh - 1, y)) * bw + Math.max(0, Math.min(bw - 1, x))];
            for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
                let s = 0;
                for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += at(x + dx, y + dy);
                out[y * bw + x] = s / 25;
            }
            return out;
        };
        bg = blur(bg);
        const at = (x, y) => bg[Math.max(0, Math.min(bh - 1, y)) * bw + Math.max(0, Math.min(bw - 1, x))];
        const bgAt = (x, y) => { // 양선형으로 원래 크기에 맞춤
            const fx = x / S, fy = y / S;
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
        $('#sc-share-jpg').disabled = !pages.length;
        $('#sc-share-jpg-text').textContent = pages.length > 1 ? `사진 ${pages.length + (coverCanvas() ? 1 : 0)}장으로 공유` : '사진으로 공유';
        $('#sc-register').disabled = !pages.length || !canRegister;
        if (!canRegister) $('#sc-reg-result').textContent = '문서 등록은 작업자(OPERATOR) 이상만 할 수 있습니다.';
        else if (registered && registered.pagesKey !== pagesKey()) $('#sc-reg-result').innerHTML = `<span class="text-amber-700">등록 뒤 쪽이 바뀌었습니다 (등록된 것: ${esc(registered.doc.regNo)}).</span>`;
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
                    <span>${i + 1}쪽${p.orienting ? ' <span class="text-teal-600 font-normal">방향 확인 중…</span>' : ''}</span>
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
    // quiet: 연속 찍기처럼 여러 장을 한꺼번에 넣을 때 (화면 그리기·방향 맞춤은 부르는 쪽이 한 번에)
    const addImage = (img, rotate = 0, { quiet = false } = {}) => {
        let quad = null;
        try { quad = autoQuad(img); } catch (e) { console.warn('[문서 스캔] 문서 영역 찾기 실패', e); }
        const page = { id: pid(), img, rotate, quad, cache: null, orienting: true };
        pages.push(page);
        if (quiet) return page;
        render();
        $('#sc-box').open = true;
        if (quad) showToast('✂ 문서 영역을 자동으로 잘랐습니다. 맞지 않으면 쪽의 ✂ 버튼으로 모서리를 고치세요.');
        queueOrient(page);
    };

    // ---------- 방향 자동 맞춤 ----------
    // 글자 줄이 세로로 누워 있으면(가로로 긴 문서를 세로로 찍은 경우) 90° 또는 270°로 세운다.
    // 어느 쪽으로 돌릴지는 세웠을 때 줄 시작이 고르게 맞는 쪽(왼쪽 정렬) · 글자가 왼쪽에 몰린 쪽으로 고른다.
    // 글자 인식 없이 그림 모양만 보므로 바로 끝난다. 거꾸로(180°) 찍힌 것은 ⟳로 돌린다.
    const queueOrient = (page) => {
        setTimeout(() => {
            try {
                if (!pages.includes(page)) return;
                const base = scanCanvas(page);
                if (isSideways(inkMap(base))) {
                    const deg = uprightScore(inkMap(rotatedSmall(base, 90, 800))) >= 0 ? 90 : 270;
                    page.rotate = (page.rotate + deg) % 360;
                    showToast(`↻ 글자 방향에 맞춰 ${pages.indexOf(page) + 1}쪽을 ${deg}° 돌렸습니다. 맞지 않으면 ⟳로 돌리세요.`);
                }
            } catch (e) {
                console.warn('[문서 스캔] 방향 확인 실패', e);
            } finally {
                page.orienting = false;
                if (pages.includes(page)) render();
            }
        }, 0);
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
    const buildFiles = async (format = $('#sc-format').value, { ascii = false, cover = true } = {}) => {
        const base = ascii ? asciiName() : fileName();
        const cv = cover ? coverCanvas() : null;
        const canvases = [...(cv ? [cv] : []), ...pages.map(scanCanvas)];
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
    // PDF 한 파일과 쪽마다 JPG를 함께 만들어 두어 [PDF 한 파일로 공유]·[사진 여러 장으로 공유] 둘 다 바로 열린다.
    let prepared = { key: '', pdf: null, jpgs: null };
    let preparing = null;
    let prepTimer = null;
    const prepKey = () => JSON.stringify([pages.map(p => [p.id, p.rotate, p.quad]), mode, coverCanvas() ? registered.doc.id : '']);
    const prepare = async () => {
        if (!pages.length) { prepared = { key: '', pdf: null, jpgs: null }; return; }
        const key = prepKey();
        if (prepared.key === key) return;
        const job = Promise.all([buildFiles('pdf', { ascii: true }), buildFiles('jpg', { ascii: true })])
            .then(([pdf, jpgs]) => { if (prepKey() === key) prepared = { key, pdf, jpgs }; });
        preparing = job;
        try { await job; } catch (e) { console.warn('[문서 스캔] 파일 미리 만들기 실패', e); } finally { if (preparing === job) preparing = null; }
    };
    const schedulePrepare = () => { clearTimeout(prepTimer); prepTimer = setTimeout(prepare, 400); };

    // ---------- 문서로 등록 (글자 읽기 없이 스캔 PDF를 그대로 파일 저장소에) ----------
    $('#sc-cover').addEventListener('change', () => render());
    $('#sc-register').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        if (!pages.length) return;
        if (registered && registered.pagesKey === pagesKey() && !confirm(`이 스캔은 이미 ${registered.doc.regNo}로 등록했습니다. 새 문서로 한 번 더 등록할까요?`)) return;
        const type = $('#sc-r-type').value;
        const party = $('#sc-r-party').value.trim();
        let title = $('#sc-r-title').value.trim();
        if (!title) {
            title = `${type}${party ? ` (${party})` : ''}`;
            $('#sc-r-title').value = title;
        }
        const btn = $('#sc-register');
        btn.innerHTML = '등록 중…';
        try {
            const [pdf] = await buildFiles('pdf', { cover: false }); // 보관 파일에는 표지를 넣지 않는다
            if (!isCloudFiles() && pdf.size > 2 * 1024 * 1024) throw new Error(`로컬 모드는 2MB 이하만 저장할 수 있습니다 (지금 ${(pdf.size / 1048576).toFixed(1)}MB). 쪽 수를 줄이거나 흑백으로 바꿔 보세요.`);
            const { doc } = await saveDocument({
                direction: $('#sc-r-dir').value, date: $('#sc-r-date').value || localDateStr(), type, party,
                docNo: $('#sc-r-docno').value.trim(), title, memo: $('#sc-r-memo').value.trim(),
                assignee: state.currentUser?.name || ''
            }, { newFiles: [pdf] });
            registered = { doc, pagesKey: pagesKey(), pageCount: pages.length, fileName: pdf.name, coverCanvas: null };
            $('#sc-cover').disabled = false;
            $('#sc-cover').checked = true;
            $('#sc-reg-result').innerHTML = `✅ <b>${esc(doc.regNo)}</b>로 등록했습니다.`;
            showToast(`📁 ${doc.regNo} · ${doc.title} — 파일 저장소 '접수·발행 문서'에 등록했습니다. 공유하면 등록 정보 표지가 첫 쪽에 들어갑니다.`);
            render();
        } finally {
            btn.innerHTML = '<i data-lucide="file-plus" class="w-4 h-4"></i>문서로 등록';
            createIcons({ icons });
        }
    }));

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
    const shareClick = (btn, asPhotos) => {
        if (typeof navigator.share !== 'function') { alert(NO_SHARE); return; }
        // 미리 만든 파일이 있으면 기다리지 않고 바로 공유 창을 연다
        if (prepared.pdf && prepared.key === prepKey()) {
            const ok = (files) => !navigator.canShare || navigator.canShare({ files });
            let files = asPhotos ? prepared.jpgs : prepared.pdf;
            let note = '';
            if (!asPhotos && !ok(files) && ok(prepared.jpgs)) {
                files = prepared.jpgs; // PDF 공유가 안 되는 브라우저: 같은 쪽을 사진으로
                note = ' (이 브라우저는 PDF 공유를 지원하지 않아 사진으로 보냈습니다)';
            }
            if (!ok(files)) { alert(NO_SHARE); return; }
            // 제목 등을 함께 넘기면 거부하는 휴대폰 브라우저가 있어 파일만 넘긴다
            navigator.share({ files })
                .then(() => showToast(`📤 ${files.length > 1 ? `${files.length}개 파일을 ` : ''}공유했습니다.${note}`))
                .catch(err => {
                    if (err?.name === 'AbortError') return; // 공유 창에서 취소
                    const why = err?.name === 'NotAllowedError' ? '브라우저가 막았습니다. 잠시 뒤 다시 눌러 주세요.' : `${err?.name || ''} ${err?.message || err}`.trim();
                    alert(`공유 창을 열지 못했습니다: ${why}\n안 되면 [이 기기에 저장] 후 첨부해 주세요.`);
                });
            return;
        }
        // 아직 준비 중이면 만든 뒤 한 번 더 누르도록 안내 (기다린 뒤 여는 공유는 브라우저가 막는다)
        btn.disabled = true;
        const label = btn.innerHTML;
        btn.innerHTML = '파일 준비 중…';
        prepare().finally(() => {
            btn.innerHTML = label;
            btn.disabled = !pages.length;
            if (prepared.pdf) showToast('📄 공유할 파일이 준비됐습니다. 공유 버튼을 한 번 더 눌러 주세요.');
        });
    };
    $('#sc-share').addEventListener('click', (e) => shareClick(e.currentTarget, false));
    $('#sc-share-jpg').addEventListener('click', (e) => shareClick(e.currentTarget, true));

    // ---------- 여러 장 연속 찍기 (앱 안 카메라) ----------
    // 휴대폰 기본 카메라(파일 입력)는 한 번에 한 장만 돌려주므로, 카메라 화면을 앱 안에 띄워 셔터를 누를 때마다 쪽을 더한다.
    // 보정·방향 맞춤은 무거우므로 찍는 동안은 쌓아 두기만 하고 [완료] 때 한꺼번에 한다.
    const openBurstCamera = async () => {
        if (!navigator.mediaDevices?.getUserMedia) { $('#sc-camera').click(); return; }
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false });
        } catch (err) {
            alert(`카메라를 열지 못했습니다: ${err?.name === 'NotAllowedError' ? '카메라 권한이 막혀 있습니다. 브라우저 주소창의 자물쇠 → 권한에서 카메라를 허용해 주세요.' : err?.message || err}\n대신 [한 장 찍기]를 쓰세요.`);
            return;
        }
        const shots = [];
        const ov = document.createElement('div');
        ov.className = 'fixed inset-0 z-[9999] bg-black flex flex-col text-xs select-none';
        ov.innerHTML = `
            <div class="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
                <video class="sc-video max-w-full max-h-full" autoplay playsinline muted></video>
                <div class="sc-flash absolute inset-0 bg-white opacity-0 pointer-events-none transition-opacity duration-150"></div>
                <div class="absolute top-3 left-0 right-0 text-center text-white font-black drop-shadow">문서를 화면에 가득 차게 두고 셔터를 누르세요 · 찍은 장수 <span class="sc-n">0</span></div>
            </div>
            <div class="flex items-center justify-between gap-3 p-4 bg-black">
                <button type="button" class="sc-cancel px-3 py-2 bg-slate-700 text-white rounded-lg font-bold">취소</button>
                <button type="button" class="sc-shutter w-16 h-16 rounded-full bg-white border-4 border-teal-400 active:scale-90 transition-transform" title="찍기"></button>
                <button type="button" class="sc-done relative px-3 py-2 bg-teal-500 text-white rounded-lg font-black">
                    <img class="sc-last hidden absolute -top-14 right-0 w-12 h-12 object-cover rounded border-2 border-white" alt="" />완료</button>
            </div>`;
        document.body.appendChild(ov);
        const video = ov.querySelector('.sc-video');
        video.srcObject = stream;
        const stop = () => { stream.getTracks().forEach(t => t.stop()); ov.remove(); };
        ov.querySelector('.sc-shutter').addEventListener('click', () => {
            const w = video.videoWidth, h = video.videoHeight;
            if (!w || !h) return;
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            c.getContext('2d').drawImage(video, 0, 0, w, h);
            shots.push(c);
            ov.querySelector('.sc-n').textContent = shots.length;
            const last = ov.querySelector('.sc-last');
            last.src = c.toDataURL('image/jpeg', 0.4);
            last.classList.remove('hidden');
            const fl = ov.querySelector('.sc-flash');
            fl.style.opacity = '0.8';
            setTimeout(() => { fl.style.opacity = '0'; }, 120);
            navigator.vibrate?.(30);
        });
        ov.querySelector('.sc-cancel').addEventListener('click', () => {
            if (shots.length && !confirm(`찍은 ${shots.length}장을 버리고 닫을까요?`)) return;
            stop();
        });
        ov.querySelector('.sc-done').addEventListener('click', () => {
            stop();
            if (!shots.length) return;
            const added = shots.map(c => addImage(c, 0, { quiet: true }));
            render();
            $('#sc-box').open = true;
            showToast(`📷 ${shots.length}장을 넣었습니다. 문서 영역·방향을 맞추는 중입니다.`);
            added.forEach(queueOrient);
        });
    };
    $('#sc-burst').addEventListener('click', openBurstCamera);

    render();
    createIcons({ icons });
    return { refresh: render };
};
