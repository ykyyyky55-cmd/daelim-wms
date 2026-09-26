import QRCode from 'qrcode';

// 앱에서 만드는 모든 QR의 공통 규칙 (인식률 향상)
//  1) 흰 여백(Quiet zone)을 표준대로 모듈 4칸 둔다 — 인식률에 가장 중요
//  2) 그 바깥에 얇은 테두리선을 둘러 QR 영역을 분명히 한다 (테두리가 코드에 바로 붙지 않게 여백 바깥에)
//  3) 바탕은 항상 흰색 (투명·색 바탕 위에서도 대비 유지)
export const QR_QUIET_ZONE = 4;

// 캔버스에 그린 QR 둘레에 흰 여백 조금 + 테두리선을 더한 새 캔버스
const addFrame = (src, color) => {
    const w = src.width;
    const line = Math.max(2, Math.round(w * 0.02));
    const gap = Math.max(1, Math.round(w * 0.01));
    const c = document.createElement('canvas');
    c.width = c.height = w + 2 * (line + gap);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, line + gap, line + gap);
    ctx.lineWidth = line;
    ctx.strokeStyle = color;
    ctx.strokeRect(line / 2, line / 2, c.width - line, c.height - line);
    return c;
};

const renderFramed = async (text, { width = 200, ecc = 'M', dark = '#000000', frameColor } = {}) => {
    const c = document.createElement('canvas');
    await QRCode.toCanvas(c, String(text ?? ''), { width, margin: QR_QUIET_ZONE, errorCorrectionLevel: ecc, color: { dark, light: '#ffffff' } });
    return addFrame(c, frameColor || dark);
};

// <img src>용 PNG dataURL
export const qrDataUrl = async (text, opts = {}) => (await renderFramed(text, opts)).toDataURL('image/png');

// 이미 있는 <canvas>에 그린다 (화면 표시 크기는 width px 유지)
export const drawQrOnCanvas = async (canvasEl, text, opts = {}) => {
    const framed = await renderFramed(text, opts);
    canvasEl.width = framed.width;
    canvasEl.height = framed.height;
    canvasEl.getContext('2d').drawImage(framed, 0, 0);
    const size = `${opts.width || 200}px`;
    canvasEl.style.width = size;
    canvasEl.style.height = size;
};

// 라벨 인쇄용 SVG (크기에 맞춰 늘어나도 선명). 테두리는 여백 바깥 끝에 반 칸 두께로.
export const qrSvg = async (text, { ecc = 'M', dark = '#000000' } = {}) => {
    const svg = await QRCode.toString(String(text ?? ''), { type: 'svg', margin: QR_QUIET_ZONE, errorCorrectionLevel: ecc, color: { dark, light: '#ffffff' } });
    const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
    if (!m) return svg;
    const n = Number(m[1]);
    const frame = `<rect x="0.25" y="0.25" width="${n - 0.5}" height="${n - 0.5}" fill="none" stroke="${dark}" stroke-width="0.5"/>`;
    return svg.replace('</svg>', `${frame}</svg>`);
};
