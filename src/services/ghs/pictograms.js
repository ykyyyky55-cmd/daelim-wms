// ==========================================
// GHS 그림문자 9종 (인라인 SVG) — 빨간 마름모 테두리 · 흰 바탕 · 검은 그림 (고시 제8조제3항)
// ==========================================
// UN GHS 그림문자의 모양을 따라 이 앱에서 벡터로 다시 그린 것이다 (외부 그림 파일을 쓰지 않아 인쇄·첨부 파일에 그대로 들어간다).
// 그림은 100×100 상자에 그리고, 마름모 안쪽(가운데)에 들어가게 둔다.
import { PICTOGRAMS } from './ghsTables.js';

const K = '#111';
// 불꽃 (GHS02·GHS03 공용): 바깥 불꽃 + 안쪽 흰 불꽃
const FLAME = `<path fill="${K}" d="M52 16 C54 27 65 32 66 45 C67 52 66 58 62 62 C59 66 55 68 50 68 C45 68 40 66 37 62 C33 57 33 51 35 46 C36 43 38 40 37 35 C40 38 42 41 42 45 C44 37 50 29 52 16 Z"/>
<path fill="#fff" d="M50 45 C55 51 58 55 57 60 C56 64 53 66.5 50 66.5 C46.5 66.5 43.5 63.5 43.5 59.5 C43.5 55 47 52 50 45 Z"/>`;

/** 마름모 안에 넣는 그림 (검은색) */
const SYMBOLS = {
    // 폭탄의 폭발: 터지는 덩어리 + 사방으로 튀는 조각
    GHS01: `<polygon fill="${K}" points="45,40 49,50 58,44 55,54 66,55 57,61 63,70 52,66 49,77 44,67 34,72 38,62 28,59 38,56 32,47 42,51"/>
<circle fill="${K}" cx="46.5" cy="59.5" r="8.5"/>
<polygon fill="${K}" points="58,34 64,30 64,38"/><polygon fill="${K}" points="67,44 73,43 70,49"/><polygon fill="${K}" points="49,30 54,27 54,34"/>
<polygon fill="${K}" points="34,37 40,36 37,43"/><polygon fill="${K}" points="67,59 73,62 67,66"/><polygon fill="${K}" points="27,49 32,48 30,53"/>`,
    // 불꽃
    GHS02: `${FLAME}<rect fill="${K}" x="30" y="72" width="40" height="4.6"/>`,
    // 원 위의 불꽃
    GHS03: `<g transform="translate(50 49) scale(0.66) translate(-50 -68)">${FLAME}</g>
<circle cx="50" cy="60.5" r="10.5" fill="#fff" stroke="${K}" stroke-width="4.6"/>
<rect fill="${K}" x="30" y="75.5" width="40" height="4.4"/>`,
    // 가스실린더
    GHS04: `<g transform="rotate(-24 50 52)" fill="${K}"><rect x="21" y="43" width="43" height="18" rx="7"/><path d="M62 45 L70 49 L70 55 L62 59 Z"/><rect x="69.5" y="49" width="5.5" height="6"/><rect x="74.5" y="46.5" width="4.2" height="11" rx="1"/></g>`,
    // 부식성: 기울인 시험관 두 개에서 떨어지는 방울 → 파인 금속 조각과 손
    GHS05: `<g fill="${K}">
<g transform="rotate(38 39 41)"><rect x="35.6" y="26" width="6.8" height="15" rx="1.6"/><rect x="33.8" y="39.6" width="10.4" height="2.4"/></g>
<g transform="rotate(38 62 41)"><rect x="58.6" y="26" width="6.8" height="15" rx="1.6"/><rect x="56.8" y="39.6" width="10.4" height="2.4"/></g>
<path d="M36.5 45 c1.6 2.3 2.4 3.5 2.4 4.7 a2.4 2.4 0 0 1 -4.8 0 c0 -1.2 0.8 -2.4 2.4 -4.7 z"/><path d="M37 53 c1.3 1.9 2 2.9 2 3.9 a2 2 0 0 1 -4 0 c0 -1 0.7 -2 2 -3.9 z"/>
<path d="M59.5 45 c1.6 2.3 2.4 3.5 2.4 4.7 a2.4 2.4 0 0 1 -4.8 0 c0 -1.2 0.8 -2.4 2.4 -4.7 z"/><path d="M60 53 c1.3 1.9 2 2.9 2 3.9 a2 2 0 0 1 -4 0 c0 -1 0.7 -2 2 -3.9 z"/>
<path d="M27 61 H33 C33.6 63.6 35 65 37 65 C39 65 40.4 63.6 41 61 H47 V68.5 H27 Z"/>
<path d="M74 60.5 H65 C64.4 63 63 64.3 61 64.3 C59.4 64.3 58.2 63.6 57.4 62.2 L52.6 64.6 C51.2 65.4 51.8 67.2 53.4 66.9 L58.8 65.9 C59.8 67.6 61.4 68.5 63.4 68.5 H74 Z"/>
</g>
<path stroke="${K}" stroke-width="1.2" fill="none" stroke-linecap="round" d="M32.5 59 C31.7 57.4 33.3 56.6 32.5 55 M41.5 59 C40.7 57.4 42.3 56.6 41.5 55 M65.5 58.5 C64.7 56.9 66.3 56.1 65.5 54.5"/>`,
    // 해골과 X자형 뼈
    GHS06: `<g stroke="${K}" stroke-width="4.2" stroke-linecap="round"><path d="M35.5 61 L64.5 72.5"/><path d="M64.5 61 L35.5 72.5"/></g>
<g fill="${K}"><circle cx="34" cy="59.2" r="2.6"/><circle cx="34.4" cy="63.4" r="2.6"/><circle cx="66" cy="59.2" r="2.6"/><circle cx="65.6" cy="63.4" r="2.6"/>
<circle cx="34" cy="74.3" r="2.6"/><circle cx="34.4" cy="70.1" r="2.6"/><circle cx="66" cy="74.3" r="2.6"/><circle cx="65.6" cy="70.1" r="2.6"/>
<path d="M50 19 C40 19 33.5 26 33.5 35.5 C33.5 41 36 45 40 47.8 L40 53.5 C40 55.4 41.4 56.8 43.2 56.8 L56.8 56.8 C58.6 56.8 60 55.4 60 53.5 L60 47.8 C64 45 66.5 41 66.5 35.5 C66.5 26 60 19 50 19 Z"/></g>
<g fill="#fff"><ellipse cx="43.4" cy="36.8" rx="4.4" ry="4.8"/><ellipse cx="56.6" cy="36.8" rx="4.4" ry="4.8"/><path d="M50 41.8 L47.4 47.4 H52.6 Z"/></g>
<path stroke="#fff" stroke-width="1.4" d="M45.8 51.4 V56.8 M50 51.4 V56.8 M54.2 51.4 V56.8"/>`,
    // 감탄부호
    GHS07: `<path fill="${K}" d="M43 22 H57 L54 60 H46 Z"/><circle fill="${K}" cx="50" cy="72" r="6.6"/>`,
    // 건강 유해성: 사람 윗몸 + 가슴에서 퍼지는 별 모양
    GHS08: `<circle fill="${K}" cx="50" cy="27" r="8.6"/>
<path fill="${K}" d="M32 73 V56 C32 46.5 39 41 47 40.5 H53 C61 41 68 46.5 68 56 V73 Z"/>
<polygon fill="#fff" points="50,43.5 52.8,52.5 60,46 56.8,55 66,56 57.6,60 64,68.5 54,64 52.2,73 47.4,64.4 39,71 43,61 33.6,59.2 42.6,55 37.6,47.2 46.6,52.2"/>`,
    // 환경: 잎이 진 나무 + 죽은 물고기
    GHS09: `<g stroke="${K}" fill="none" stroke-linecap="round" stroke-linejoin="round">
<path stroke-width="3.6" d="M37 71 V41"/><path stroke-width="2.4" d="M37 58 L29 50 M37 52 L44 45 M37 46 L31 39 M37 43 L42 36 M29 50 L26 44 M44 45 L48 41 M31 39 L30 33 M42 36 L45 31"/>
<path stroke-width="1.6" d="M50 69.5 C54 67.5 58 71.5 62 69.5 C66 67.5 70 71.5 74 69.5"/></g>
<path fill="${K}" d="M24 71 H50 L47 75 H27 Z"/>
<path fill="${K}" d="M50 61 C54 55.5 63 55 68.5 60 L74 55.5 L73.5 66.5 L68.5 63 C63 67.5 54 67 50 61 Z"/>
<path stroke="#fff" stroke-width="1.1" stroke-linecap="round" d="M53.6 59.8 L55.8 62 M55.8 59.8 L53.6 62"/>`
};

/**
 * 그림문자 SVG 글자
 * @param {string} code GHS01~GHS09
 * @param {number|string} [size] 한 변 크기 (px 숫자, 또는 '14mm' 같은 CSS 길이)
 */
export const pictogramSvg = (code, size = 64) => {
    const body = SYMBOLS[code];
    if (!body) return '';
    const dim = typeof size === 'number' ? `${size}` : size;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${dim}" height="${dim}" role="img" aria-label="${PICTOGRAMS[code] || code}"><title>${PICTOGRAMS[code] || code}</title><polygon points="50,3.5 96.5,50 50,96.5 3.5,50" fill="#fff" stroke="#e1001a" stroke-width="5.5" stroke-linejoin="miter"/>${body}</svg>`;
};

/** 그림문자 여러 개를 나란히 (없으면 빈 글자) */
export const pictogramRow = (codes, size = 64, gap = 6) => (codes || []).map(c => `<span style="display:inline-block;margin-right:${gap}px;line-height:0">${pictogramSvg(c, size)}</span>`).join('');

export const PICTOGRAM_CODES = Object.keys(SYMBOLS);
