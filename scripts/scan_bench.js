// QR 스캐너 · 글자 인식 · 문서 스캔 정확도 측정 (브라우저에서 실행)
//
// 개발 서버(npm run dev)를 띄운 뒤 앱 화면의 콘솔에서:
//   const bench = await import('/scripts/scan_bench.js');
//   await bench.qrBench();    // QR 해독: 화면에서 QR이 차지하는 폭 × 조건별 성공률
//   await bench.ocrBench();   // 전표 글자 인식: 글자 정확도 · 품목/수량을 맞춘 줄 수
//   bench.quadBench();        // 문서 영역 자동 찾기: 모서리 오차
// 모든 그림은 이 파일이 캔버스로 그린 가짜 예시다(실제 전표·품목 자료 없음). 합성 그림이라 실제 사진보다 조건이 좋다는 점을 감안해 읽을 것.
import { qrDataUrl } from '../src/services/qrCode.js';
import { itemQrUrl, fieldQrUrl } from '../src/services/fieldQr.js';
import { state } from '../src/services/db.js';
import { preprocessImage, recognizeBest, parseSlipText } from '../src/services/docOcr.js';
import { autoQuad } from '../src/components/DocScanPanel.js';

// 다시 돌려도 같은 결과가 나오게 고정한 난수
let seed = 7;
const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---------- QR ----------
const QR_PAYLOADS = () => ({
    '품목 QR': itemQrUrl('AA0123-4567'),
    '위치 QR': fieldQrUrl('LOC', '김포공장 / 김포2A-01'),
    '작업지시서 QR': JSON.stringify({ type: 'DAELIM_SECURE_WO', orderNo: 'WO-20261002-001', productItemCode: 'AA0123-4567', prodQty: 10, prodUnit: 'D/M', mfgDate: '2026-10-02', lotNo: '20261002-01', materials: Array.from({ length: 8 }, (_, i) => [`RM00${i}-0001`, 123.45 * (i + 1)]) })
});
const QR_CONDITIONS = { '정상': {}, '기울임 25°': { rot: 25 }, '비스듬히(원근)': { skew: true, rot: 8 }, '초점 흐림': { blur: 1.2 }, '어두움+잡음': { dim: 0.45, noise: 40 } };

/** 가상 카메라 화면: 회색 바탕 가운데에 QR(폭 = frac × 화면 폭) */
const cameraFrame = (w, h, qrImage, frac, cond) => {
    const c = canvasOf(w, h);
    const x = c.getContext('2d');
    x.fillStyle = '#9aa0a6';
    x.fillRect(0, 0, w, h);
    const size = frac * w;
    x.save();
    x.translate(w / 2 + (random() - 0.5) * w * 0.04, h / 2 + (random() - 0.5) * h * 0.04);
    x.rotate(((cond.rot || 0) * Math.PI) / 180);
    if (cond.skew) x.transform(1, 0.12, 0.25, 0.85, 0, 0);
    if (cond.blur) x.filter = `blur(${(cond.blur * w) / 640}px)`;
    x.imageSmoothingQuality = 'high';
    x.drawImage(qrImage, -size / 2, -size / 2, size, size);
    x.restore();
    if (cond.dim || cond.noise) {
        const d = x.getImageData(0, 0, w, h);
        const p = d.data;
        for (let i = 0; i < p.length; i += 4) {
            const n = (random() - 0.5) * (cond.noise || 0);
            for (let j = 0; j < 3; j++) p[i + j] = Math.max(0, Math.min(255, (p[i + j] - 128) * (cond.dim || 1) + 110 + n));
        }
        x.putImageData(d, 0, 0);
    }
    return c;
};

/** 앱의 스캐너(qrCamera.js)와 같은 방식: 가운데 정사각형(짧은 변의 85%)을 원본 해상도로 ZXing C++ 해독 */
const decodeFrame = async (reader, frame) => {
    const side = Math.round(Math.min(frame.width, frame.height) * 0.85);
    const data = frame.getContext('2d').getImageData((frame.width - side) / 2, (frame.height - side) / 2, side, side);
    const found = await reader.readBarcodes(data, { tryHarder: true, tryInvert: true, formats: ['QRCode'], maxNumberOfSymbols: 1 });
    return found[0]?.text || '';
};

export const qrBench = async ({ trials = 4, fracs = [0.06, 0.08, 0.12, 0.18, 0.26, 0.38] } = {}) => {
    const reader = await import('zxing-wasm/reader');
    const wasm = await import('zxing-wasm/reader/zxing_reader.wasm?url');
    reader.prepareZXingModule({ overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasm.default : prefix + path) } });
    const rows = [];
    for (const [name, text] of Object.entries(QR_PAYLOADS())) {
        const image = await createImageBitmap(await (await fetch(await qrDataUrl(text, { width: 900 }))).blob());
        for (const [condName, cond] of Object.entries(QR_CONDITIONS)) {
            for (const frac of fracs) {
                const hit = { '640x480': 0, '1280x720': 0, '1920x1080': 0 };
                for (let t = 0; t < trials; t++) {
                    for (const key of Object.keys(hit)) {
                        const [w, h] = key.split('x').map(Number);
                        if ((await decodeFrame(reader, cameraFrame(w, h, image, frac, cond))) === text) hit[key]++;
                    }
                }
                rows.push({ QR: name, 조건: condName, '화면 폭 대비': `${Math.round(frac * 100)}%`, ...Object.fromEntries(Object.entries(hit).map(([k, v]) => [k, `${v}/${trials}`])) });
            }
        }
    }
    console.table(rows);
    return rows;
};

// ---------- 전표 글자 인식 ----------
const SAMPLE_ITEMS = [
    ['ZT-0001', '샘플 엔진오일 5W30 1L', '1L x 12', 'EA', '완제품'], ['ZT-0002', '샘플 엔진오일 5W40 4L', '4L x 4', 'EA', '완제품'],
    ['ZT-0003', '샘플 기어오일 75W90 20L', '20L', 'EA', '완제품'], ['ZT-0004', '테스트 용기 1L 백색', '1L', 'EA', '부자재'],
    ['ZT-0005', '테스트 캡 38파이 적색', '38mm', 'EA', '부자재'], ['ZT-0006', '테스트 아웃박스 405*285*295', '405*285*295', 'EA', '부자재'],
    ['ZT-0007', 'Sample Base Oil 150N', '200L', 'L', '원료'], ['ZT-0008', 'Sample Additive PK-200', '180KG', 'KG', '원료']
];
const SAMPLE_ROWS = [[0, 240, 'EA'], [1, 96, 'EA'], [2, 30, 'EA'], [3, 5000, 'EA'], [4, 5000, 'EA'], [5, 400, 'EA'], [6, 1600, 'L'], [7, 360, 'KG']];
const TRUTH = ['거래명세서', '일자 2026.10.02', '상호 (주)샘플화학', '품명 규격 수량 단위',
    ...SAMPLE_ROWS.map(([i, qty, unit]) => `${SAMPLE_ITEMS[i][1]} ${SAMPLE_ITEMS[i][2]} ${qty.toLocaleString()} ${unit}`)];

/** 표로 된 예시 거래명세서 (폭 width px) */
const drawSlip = (width = 1240) => {
    const k = width / 1240;
    const c = canvasOf(width, Math.round(900 * k));
    const x = c.getContext('2d');
    x.scale(k, k);
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 1240, 900);
    x.fillStyle = '#111';
    x.textBaseline = 'middle';
    x.font = 'bold 44px "Malgun Gothic", sans-serif';
    x.fillText('거래명세서', 500, 70);
    x.font = '24px "Malgun Gothic", sans-serif';
    x.fillText('일자 2026.10.02', 80, 150);
    x.fillText('상호 (주)샘플화학', 700, 150);
    const cols = [80, 620, 860, 1010, 1160];
    const top = 200;
    const rowH = 56;
    x.lineWidth = 2;
    x.strokeStyle = '#111';
    for (let r = 0; r <= SAMPLE_ROWS.length + 1; r++) { x.beginPath(); x.moveTo(cols[0], top + r * rowH); x.lineTo(cols[4], top + r * rowH); x.stroke(); }
    cols.forEach((cx) => { x.beginPath(); x.moveTo(cx, top); x.lineTo(cx, top + (SAMPLE_ROWS.length + 1) * rowH); x.stroke(); });
    x.font = 'bold 24px "Malgun Gothic", sans-serif';
    ['품명', '규격', '수량', '단위'].forEach((head, i) => x.fillText(head, cols[i] + 16, top + rowH / 2));
    x.font = '24px "Malgun Gothic", sans-serif';
    SAMPLE_ROWS.forEach(([i, qty, unit], r) => {
        const y = top + (r + 1.5) * rowH;
        x.fillText(SAMPLE_ITEMS[i][1], cols[0] + 16, y);
        x.fillText(SAMPLE_ITEMS[i][2], cols[1] + 16, y);
        x.fillText(qty.toLocaleString(), cols[2] + 16, y);
        x.fillText(unit, cols[3] + 16, y);
    });
    return c;
};

/** 스마트폰 사진처럼: 살짝 돌리고 · 흐리고 · 그림자 · 잡음 */
const asPhoto = (src, { rot = 1.5, blur = 0.8, shadow = 0.35, noise = 14 } = {}) => {
    const c = canvasOf(src.width, src.height);
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.save();
    x.translate(c.width / 2, c.height / 2);
    x.rotate((rot * Math.PI) / 180);
    x.filter = `blur(${(blur * src.width) / 1240}px)`;
    x.drawImage(src, -c.width / 2, -c.height / 2);
    x.restore();
    const d = x.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    for (let y = 0; y < c.height; y++) {
        for (let xx = 0; xx < c.width; xx++) {
            const i = (y * c.width + xx) * 4;
            const shade = 1 - shadow * (xx / c.width) * (y / c.height);
            const n = (random() - 0.5) * noise;
            for (let j = 0; j < 3; j++) p[i + j] = Math.max(0, Math.min(255, p[i + j] * shade * 0.92 + n));
        }
    }
    x.putImageData(d, 0, 0);
    return c;
};

const levenshtein = (a, b) => {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
};
// 글자 정확도는 앱이 덧붙이는 '[수량칸 n]' 표시를 뺀 글자로 잰다
const plain = (s) => s.normalize('NFKC').replace(/\[수량칸[^\]]*\]/g, '').replace(/[\s|[\]_—–-]/g, '').toLowerCase();

export const OCR_CASES = {
    '스캔본 (1240px)': () => drawSlip(1240),
    '스마트폰 사진 (2000px, 기울임·흐림·그림자)': () => asPhoto(drawSlip(2000)),
    '작게 찍힌 사진 (900px, 흐림)': () => asPhoto(drawSlip(900), { blur: 1.0 }),
    '어두운 곳 (그림자 60%)': () => asPhoto(drawSlip(2000), { shadow: 0.6, noise: 24 })
};

/** 전표 글자 인식 측정. 처음 실행하면 글자 인식 엔진(약 10MB)을 받는다. */
export const ocrBench = async (onProgress) => {
    // 예시 품목을 잠깐 품목마스터에 넣고 끝나면 뺀다 (메모리에서만 — 저장하지 않음)
    const added = SAMPLE_ITEMS.filter(([code]) => !state.master.some(m => m.code === code)).map(([code, name, spec, unit, category]) => ({ code, name, spec, unit, category }));
    state.master.push(...added);
    const rows = [];
    try {
        for (const [name, make] of Object.entries(OCR_CASES)) {
            seed = 7;
            const started = performance.now();
            const best = await recognizeBest(make(), { contrast: true }, (m) => onProgress?.(`${name}: ${m.status}`));
            const parsed = parseSlipText(best.text);
            const truth = plain(TRUTH.join(''));
            rows.push({
                전표: name,
                '글자 정확도(%)': Math.round((1 - levenshtein(truth, plain(best.text)) / truth.length) * 1000) / 10,
                '품목 맞음': `${SAMPLE_ROWS.filter(([i]) => parsed.lines.some(l => l.item?.code === SAMPLE_ITEMS[i][0])).length}/${SAMPLE_ROWS.length}`,
                '품목+수량 맞음': `${SAMPLE_ROWS.filter(([i, qty]) => parsed.lines.some(l => l.item?.code === SAMPLE_ITEMS[i][0] && Number(l.qty) === qty)).length}/${SAMPLE_ROWS.length}`,
                '잘못 맞은 줄': parsed.lines.filter(l => l.item && !SAMPLE_ROWS.some(([i, qty]) => l.item.code === SAMPLE_ITEMS[i][0] && Number(l.qty) === qty)).length,
                일자: parsed.date || '-',
                거래처: parsed.partner || '-',
                '읽은 횟수': best.pass,
                '걸린 시간(초)': Math.round((performance.now() - started) / 100) / 10,
                text: best.text
            });
        }
    } finally {
        added.forEach((item) => { const i = state.master.indexOf(item); if (i >= 0) state.master.splice(i, 1); });
    }
    console.table(rows.map(({ text, ...rest }) => rest));
    return rows;
};

/** 글자 인식 전 보정(흑백·표 선 지우기) 결과를 눈으로 볼 때 */
export const previewSlip = (name = Object.keys(OCR_CASES)[1]) => preprocessImage(OCR_CASES[name](), { contrast: true, target: 1800 });

// ---------- 문서 영역 자동 찾기 ----------
const DESKS = {
    '어두운 책상': (x, w, h) => { x.fillStyle = '#3b3f45'; x.fillRect(0, 0, w, h); },
    '나무 책상': (x, w, h) => {
        x.fillStyle = '#b98a5a'; x.fillRect(0, 0, w, h);
        for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(90,55,25,${0.05 + random() * 0.12})`; x.fillRect(0, random() * h, w, 2 + random() * 6); }
    },
    '밝은 회색 책상': (x, w, h) => { x.fillStyle = '#c6c9cc'; x.fillRect(0, 0, w, h); },
    '무늬 바닥': (x, w, h) => {
        x.fillStyle = '#7d8a96'; x.fillRect(0, 0, w, h);
        for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(255,255,255,${0.05 + random() * 0.1})`; x.fillRect(random() * w, random() * h, 40 + random() * 160, 40 + random() * 160); }
    }
};
const POSES = { '정면': { rot: 0, tilt: 0 }, '살짝 기울임 8°': { rot: 8, tilt: 0.04 }, '비스듬히 20°': { rot: 20, tilt: 0.08 }, '많이 돌림 40°': { rot: 40, tilt: 0.05 }, '원근 심함': { rot: 4, tilt: 0.18 } };

/** 책상 위 종이 사진과 실제 네 모서리 (0~1 비율, 왼위 · 오위 · 오아래 · 왼아래) */
const paperPhoto = (desk, pose, { shadow = 0.25 } = {}) => {
    const w = 1600;
    const h = 1200;
    const c = canvasOf(w, h);
    const x = c.getContext('2d');
    DESKS[desk](x, w, h);
    const pw = 620;
    const ph = 860;
    const rad = (pose.rot * Math.PI) / 180;
    // 위쪽이 멀어 좁아 보이는 원근: 위 변을 tilt만큼 줄인다
    const local = [[-pw / 2 * (1 - pose.tilt * 2), -ph / 2], [pw / 2 * (1 - pose.tilt * 2), -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]];
    const corners = local.map(([px, py]) => [w / 2 + px * Math.cos(rad) - py * Math.sin(rad), h / 2 + px * Math.sin(rad) + py * Math.cos(rad)]);
    x.beginPath();
    corners.forEach(([cx, cy], i) => (i ? x.lineTo(cx, cy) : x.moveTo(cx, cy)));
    x.closePath();
    x.fillStyle = '#f4f4f1';
    x.fill();
    // 글자 줄 (회색 띠)
    x.save();
    x.clip();
    x.translate(w / 2, h / 2);
    x.rotate(rad);
    x.fillStyle = '#555';
    for (let i = 0; i < 22; i++) x.fillRect(-pw / 2 + 60, -ph / 2 + 80 + i * 32, (pw - 120) * (0.5 + random() * 0.5) * (1 - pose.tilt), 9);
    x.restore();
    // 한쪽에서 드리운 그림자
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${shadow})`);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    return { canvas: c, corners: corners.map(([cx, cy]) => [cx / (w - 1), cy / (h - 1)]) };
};

/** 화면 기준 왼위 · 오위 · 오아래 · 왼아래 순서로 맞춘 뒤의 모서리 평균 오차 (사진 대각선에 대한 %) */
const cornerError = (found, truth) => {
    const diag = Math.hypot(1600, 1200);
    const px = (q) => q.map(([a, b]) => [a * 1599, b * 1199]);
    const f = px(found);
    const t = px(truth);
    // 순서가 돌아가 있어도(많이 돌린 종이) 가장 잘 맞는 돌림으로 비교
    let best = Infinity;
    for (let shift = 0; shift < 4; shift++) {
        const sum = f.reduce((acc, p, i) => acc + Math.hypot(p[0] - t[(i + shift) % 4][0], p[1] - t[(i + shift) % 4][1]), 0);
        best = Math.min(best, sum / 4);
    }
    return (best / diag) * 100;
};

export const quadBench = () => {
    const rows = [];
    for (const desk of Object.keys(DESKS)) {
        for (const [poseName, pose] of Object.entries(POSES)) {
            seed = 11;
            const { canvas, corners } = paperPhoto(desk, pose);
            const found = autoQuad(canvas);
            const error = found ? cornerError(found, corners) : null;
            rows.push({ 배경: desk, 자세: poseName, 결과: !found ? '못 찾음' : error < 1.5 ? '맞음' : error < 4 ? '조금 어긋남' : '틀림', '모서리 오차(%)': error === null ? '-' : Math.round(error * 100) / 100 });
        }
    }
    console.table(rows);
    return rows;
};

/** 문서 영역 찾기 예시 사진 (눈으로 볼 때) */
export const previewPaper = (desk = '나무 책상', pose = '비스듬히 20°') => paperPhoto(desk, POSES[pose]);
