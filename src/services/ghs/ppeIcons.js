// ==========================================
// 개인 보호구 기호 4종 (인라인 SVG) — 파란 원 · 흰 그림 (지시 표지 모양)
// ==========================================
// MSDS 8항 다.(개인 보호구) 아래에 넣는 그림이다. 표준 그림 파일을 받아 넣은 것이 아니라 이 앱에서 벡터로 그린 것이며,
// 외부 파일을 쓰지 않아 인쇄·첨부 파일에 그대로 들어간다. 그림은 100×100 상자에 그린다.
const BLUE = '#0056a4';

export const PPE_ICONS = { GLOVES: '보호장갑 착용', GOGGLES: '보안경 착용', CLOTHING: '보호복 착용', RESPIRATOR: '호흡 보호구 착용' };

const SYMBOLS = {
    // 장갑: 손가락 넷 + 손바닥 + 엄지 + 손목
    GLOVES: `<g fill="#fff" transform="rotate(-8 50 50)">
<rect x="33" y="25" width="7.6" height="30" rx="3.8"/><rect x="42.1" y="18" width="7.6" height="36" rx="3.8"/><rect x="51.2" y="20" width="7.6" height="34" rx="3.8"/><rect x="60.3" y="27" width="7.6" height="28" rx="3.8"/>
<path d="M33 46 H67.9 V63 C67.9 70.5 62 76 54.5 76 H46 C38.6 76 33 70.5 33 63 Z"/>
<path d="M34 63.5 L22.6 50.5 C20.6 48 21.2 44.6 23.8 43.2 C26.2 42 28.8 42.8 30.2 45 L38 56 Z"/>
<rect x="38.5" y="78.5" width="24" height="6.5" rx="1.6"/></g>`,
    // 보안경: 얼굴 윤곽 + 끈 + 렌즈 둘
    GOGGLES: `<path fill="none" stroke="#fff" stroke-width="4.4" stroke-linejoin="round" d="M30 41 C30 25 39.5 16.5 50 16.5 C60.5 16.5 70 25 70 41 V52 C70 68 60.5 81 50 81 C39.5 81 30 68 30 52 Z"/>
<g fill="#fff"><rect x="23.5" y="38.5" width="53" height="6"/><rect x="30" y="34" width="18.4" height="15.4" rx="5.4"/><rect x="51.6" y="34" width="18.4" height="15.4" rx="5.4"/></g>
<g fill="${BLUE}"><rect x="33.8" y="37.8" width="10.8" height="7.8" rx="2.8"/><rect x="55.4" y="37.8" width="10.8" height="7.8" rx="2.8"/></g>`,
    // 보호복: 깃 · 소매 · 몸통 · 바지 한 벌
    CLOTHING: `<path fill="#fff" d="M43.5 15.5 H56.5 L59.5 21 L73 27 L80 53 L72 56 L65.5 39 V53 L69 85 H56.5 L50 61 L43.5 85 H31 L34.5 53 V39 L28 56 L20 53 L27 27 L40.5 21 Z"/>
<path fill="none" stroke="${BLUE}" stroke-width="1.8" stroke-linecap="round" d="M50 22 V52 M43.5 15.5 L50 22 L56.5 15.5"/>`,
    // 호흡 보호구: 얼굴 + 눈 + 마스크(정화통)
    RESPIRATOR: `<path fill="#fff" d="M50 15 C37 15 28.5 25 28.5 39 V50 C28.5 66 38.5 82 50 82 C61.5 82 71.5 66 71.5 50 V39 C71.5 25 63 15 50 15 Z"/>
<g fill="${BLUE}"><ellipse cx="41" cy="38" rx="5" ry="3.4"/><ellipse cx="59" cy="38" rx="5" ry="3.4"/>
<path d="M34 51 C40 46 60 46 66 51 V60 C66 68.5 58.5 75 50 75 C41.5 75 34 68.5 34 60 Z"/></g>
<circle cx="50" cy="61.5" r="6.4" fill="#fff"/>
<path stroke="${BLUE}" stroke-width="3" stroke-linecap="round" d="M28.5 50 L34.5 53.5 M71.5 50 L65.5 53.5"/>`
};

/**
 * 보호구 기호 SVG 글자
 * @param {string} code GLOVES · GOGGLES · CLOTHING · RESPIRATOR
 * @param {number|string} [size] 지름 (px 숫자, 또는 '17mm' 같은 CSS 길이)
 */
export const ppeIconSvg = (code, size = 64) => {
    const body = SYMBOLS[code];
    if (!body) return '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${PPE_ICONS[code]}"><title>${PPE_ICONS[code]}</title><circle cx="50" cy="50" r="49" fill="${BLUE}"/>${body}</svg>`;
};
