// ==========================================
// 서류 표시: 대림 로고(자체 발행 전표·서류) · 대외비 마크(보안 서류)
// ==========================================
// 인쇄 창은 빈 창(about:blank)에 글을 써 넣으므로 로고는 앱 주소 기준의 절대 주소로 넣는다.

export const LOGO_URL = new URL(`${import.meta.env.BASE_URL}logo.png`, window.location.href).href;

/** 인쇄용 로고 <img> (높이 mm) */
export const logoImgHtml = (heightMm = 9, style = '') =>
    `<img src="${LOGO_URL}" alt="대림" style="height:${heightMm}mm;width:auto;vertical-align:middle;${style}" onerror="this.remove()" />`;

// 캔버스에 그릴 로고 (처음 불러올 때 한 번 받아 둔다)
let logoPromise = null;
export const loadLogo = () => {
    if (!logoPromise) {
        logoPromise = new Promise((resolve) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = LOGO_URL;
        });
    }
    return logoPromise;
};
let logoImage = null;
loadLogo().then(im => { logoImage = im; });
/** 이미 받아 둔 로고 (아직이면 null) — 동기로 그리는 곳에서 쓴다 */
export const logoNow = () => logoImage;

/** 캔버스에 로고 그리기: (x, y) 왼쪽 위, 높이 h px. 그린 너비를 돌려준다 */
export const drawLogo = (ctx, im, x, y, h) => {
    if (!im?.naturalWidth) return 0;
    const w = (im.naturalWidth / im.naturalHeight) * h;
    ctx.drawImage(im, x, y, w, h);
    return w;
};

// ---------- 대외비 ----------
// 인쇄물 CSS: 오른쪽 위 빨간 도장 + 모든 쪽 가운데 옅은 사선 워터마크(position: fixed는 인쇄 때 쪽마다 반복된다)
export const CONFIDENTIAL_CSS = `
.conf-stamp { position: fixed; top: 2mm; right: 2mm; z-index: 50; border: 0.8mm solid #c81e1e; color: #c81e1e; padding: 1mm 3mm;
    font: 900 13pt 'Malgun Gothic', sans-serif; letter-spacing: 3px; transform: rotate(-6deg); background: rgba(255,255,255,.85); text-align: center; line-height: 1.15; }
.conf-stamp small { display: block; font-size: 6pt; letter-spacing: 0; font-weight: 700; }
.conf-wm { position: fixed; left: 50%; top: 50%; z-index: 40; transform: translate(-50%, -50%) rotate(-32deg); pointer-events: none;
    font: 900 70pt 'Malgun Gothic', sans-serif; color: rgba(200, 30, 30, .08); white-space: nowrap; letter-spacing: 8px; text-align: center; line-height: 1.1; }
.conf-wm small { display: block; font-size: 26pt; letter-spacing: 12px; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;
/** 인쇄물 본문 맨 앞에 넣는 대외비 도장·워터마크 */
export const confidentialHtml = (note = '무단 복제·반출 금지') =>
    `<div class="conf-stamp">대 외 비<small>${note}</small></div><div class="conf-wm">대 외 비<small>CONFIDENTIAL</small></div>`;
