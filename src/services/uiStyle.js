// ==========================================
// UI 스타일 (화면 디자인) — 화면 모드(라이트·다크·눈 편한 모드)와 따로 고르는 겉모습
// ==========================================
// 화면은 Tailwind 클래스(포인트 색 = blue-*, 둥근 카드 rounded-2xl)로 만들어져 있다. 스타일을 고르면 <html data-ui="…">를 붙이고,
// 그 스타일의 CSS(포인트 색 바꿔치기 · 모서리 · 그림자 · 글자 크기)를 한 번 만들어 넣는다 — 화면 코드는 고치지 않는다(다크 모드 보정 darkTheme.js와 같은 방식).
//   default 기본        파랑 포인트 · 둥근 카드
//   modern  모던        인디고 포인트 · 더 둥근 모서리 · 부드러운 그림자
//   classic 클래식      대림 남색 포인트 · 각진 모서리 · 그림자 없음 · 글자를 조금 줄여 한 화면에 더 많이 (PC 사무용)
//   field   현장        초록 포인트 · 버튼을 크게 · 진한 테두리 · 폭 640px 이상에서는 글자도 크게 (태블릿·현장용)
// 기기별로 기억한다(daelim_ui_style). 새 화면은 지금처럼 blue-* 포인트 색과 Tailwind 모서리 클래스를 쓰면 저절로 따라간다 —
// 인라인 style로 준 색·모서리는 바뀌지 않는다.

const STORAGE_KEY = 'daelim_ui_style';
const STYLE_ELEMENT_ID = 'ui-style-css';

/**
 * 포인트 색 명도표 (Tailwind blue-50 … blue-900 자리에 들어갈 색)
 * @typedef {Record<50|100|200|300|400|500|600|700|800|900, string>} Palette
 */
/** @type {Record<string, Palette>} */
const PALETTES = {
    indigo: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81' },
    // 대림 로고 남색(#1E3C96)을 600 자리에 둔 명도표
    navy: { 50: '#eef1fb', 100: '#dce3f6', 200: '#b9c6ed', 300: '#8ea3e0', 400: '#5f7bcf', 500: '#3a57b8', 600: '#1e3c96', 700: '#19327d', 800: '#152a69', 900: '#112255' },
    emerald: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b' }
};
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const LIGHT_SHADES = [50, 100, 200, 300];   // 옅은 바탕·테두리 — 다크 모드에서는 반투명으로
const SOLID_SHADES = [400, 500, 600, 700, 800, 900];

/**
 * @typedef {{ name: string, desc: string, accent: string|null, swatch: string[] }} UiStyle
 *   accent = 포인트 색 명도표 이름(PALETTES, null이면 파랑 그대로), swatch = 설정 화면의 미리보기 색
 */
/** @type {Record<string, UiStyle>} */
export const UI_STYLES = {
    default: { name: '기본', desc: '파랑 포인트 · 둥근 카드 (지금까지의 화면)', accent: null, swatch: ['#2563eb', '#ffffff', '#f1f5f9'] },
    modern: { name: '모던', desc: '인디고 포인트 · 더 둥근 모서리 · 부드러운 그림자', accent: 'indigo', swatch: ['#4f46e5', '#ffffff', '#eef2ff'] },
    classic: { name: '클래식', desc: '대림 남색 · 각진 모서리 · 글자를 조금 줄여 한 화면에 더 많이 (PC 사무용)', accent: 'navy', swatch: ['#1e3c96', '#ffffff', '#e2e8f0'] },
    field: { name: '현장', desc: '초록 포인트 · 큰 버튼 · 진한 테두리 · 태블릿·PC에서는 큰 글씨 (현장용)', accent: 'emerald', swatch: ['#059669', '#ffffff', '#d1fae5'] }
};
export const isUiStyle = (id) => Object.prototype.hasOwnProperty.call(UI_STYLES, id);

const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; };

/** 포인트 색 바꿔치기: blue-* 클래스를 그 스타일의 명도표로 */
const accentCss = (id, palette) => {
    const U = `html[data-ui="${id}"]`;
    const light = `${U}:not([data-theme="dark"])`; // 옅은 색은 밝은 화면에서만 (다크 모드는 아래에서 반투명으로)
    const dark = `${U}[data-theme="dark"]`;
    const rules = [];
    const rule = (selectors, body) => rules.push(`${selectors.join(',')}{${body}}`);
    const cls = (scope, name) => `${scope} [class~="${name}"]`;
    const state = (scope, prefix, name, pseudo) => `${scope} [class~="${prefix}:${name}"]:${pseudo}`;
    SHADES.forEach((shade) => {
        const color = palette[shade];
        const scope = LIGHT_SHADES.includes(shade) ? light : U;
        rule([cls(scope, `bg-blue-${shade}`)], `background-color:${color} !important`);
        // 불투명도를 붙여 쓴 옅은 바탕(bg-blue-50/50 등)은 절반 투명한 포인트 색으로
        if (shade <= 100) rule([`${scope} [class*=" bg-blue-${shade}/"]`, `${scope} [class^="bg-blue-${shade}/"]`], `background-color:rgba(${hexToRgb(color)},.5) !important`);
        rule([state(scope, 'hover', `bg-blue-${shade}`, 'hover')], `background-color:${color} !important`);
        rule([cls(scope, `border-blue-${shade}`), state(scope, 'hover', `border-blue-${shade}`, 'hover'), state(scope, 'focus', `border-blue-${shade}`, 'focus')], `border-color:${color} !important`);
        rule([cls(U, `ring-blue-${shade}`), state(U, 'focus', `ring-blue-${shade}`, 'focus')], `--tw-ring-color:${color} !important`);
        rule([cls(scope, `from-blue-${shade}`)], `--tw-gradient-from:${color} var(--tw-gradient-from-position) !important`);
        rule([cls(scope, `to-blue-${shade}`)], `--tw-gradient-to:${color} var(--tw-gradient-to-position) !important`);
        // 글자색: 진한 글자(600 이상)는 밝은 화면에서만 — 다크 모드는 밝은 명도로 따로
        const textScope = shade >= 600 ? light : U;
        rule([cls(textScope, `text-blue-${shade}`), state(textScope, 'hover', `text-blue-${shade}`, 'hover')], `color:${color} !important`);
    });
    // 다크 모드: 옅은 바탕·테두리는 반투명 포인트 색, 진한 글자는 밝은 명도 (darkTheme.js의 규칙을 같은 방식으로 덮는다)
    const rgb = hexToRgb(palette[500]);
    rule([cls(dark, 'bg-blue-50')], `background-color:rgba(${rgb},.10) !important`);
    rule([cls(dark, 'bg-blue-100')], `background-color:rgba(${rgb},.18) !important`);
    rule([cls(dark, 'bg-blue-200')], `background-color:rgba(${rgb},.28) !important`);
    rule(['bg-blue-50', 'bg-blue-100', 'bg-blue-200'].map(name => state(dark, 'hover', name, 'hover')), `background-color:rgba(${rgb},.24) !important`);
    rule([100, 200, 300].map(shade => cls(dark, `border-blue-${shade}`)), `border-color:rgba(${rgb},.38) !important`);
    rule([cls(dark, 'text-blue-600')], `color:${palette[400]} !important`);
    rule([700, 800, 900].map(shade => cls(dark, `text-blue-${shade}`)), `color:${palette[300]} !important`);
    // 체크·라디오·범위 막대의 포인트 색
    rule([`${U} input[type="checkbox"]`, `${U} input[type="radio"]`, `${U} input[type="range"]`, `${U} progress`], `accent-color:${palette[600]}`);
    return rules.join('\n');
};

/** 스타일마다의 모양(모서리·그림자·글자 크기) */
const SHAPE_CSS = {
    modern: (U) => `
${U} [class~="rounded-lg"]{border-radius:.75rem !important}
${U} [class~="rounded-xl"]{border-radius:1rem !important}
${U} [class~="rounded-2xl"]{border-radius:1.35rem !important}
${U}:not([data-theme="dark"]) [class~="shadow-sm"]{box-shadow:0 6px 18px -8px rgba(79,70,229,.22),0 1px 2px rgba(15,23,42,.04) !important}
${U}:not([data-theme="dark"]):not([data-theme="warm"]) body{background-color:#f6f7ff}
${U} button[class~="bg-blue-600"]{box-shadow:0 6px 14px -6px rgba(79,70,229,.55)}`,
    classic: (U) => `
${U}{font-size:15px}
${U} [class~="rounded-md"],${U} [class~="rounded-lg"],${U} [class~="rounded-xl"],${U} [class~="rounded-2xl"],${U} [class~="rounded-3xl"]{border-radius:4px !important}
${U} [class~="rounded-t-xl"],${U} [class~="rounded-t-2xl"]{border-top-left-radius:4px !important;border-top-right-radius:4px !important}
${U} [class~="rounded-b-xl"],${U} [class~="rounded-b-2xl"]{border-bottom-left-radius:4px !important;border-bottom-right-radius:4px !important}
${U} [class~="shadow-sm"],${U} [class~="shadow-xs"],${U} [class~="shadow"]{box-shadow:none !important}
${U}:not([data-theme="dark"]) [class~="border-slate-200"]{border-color:#cbd5e1 !important}
${U}:not([data-theme="dark"]) [class~="border-slate-100"]{border-color:#e2e8f0 !important}
${U}:not([data-theme="dark"]) #main-content thead [class~="bg-slate-50"],${U}:not([data-theme="dark"]) #main-content thead[class~="bg-slate-50"],${U}:not([data-theme="dark"]) #main-content thead [class~="bg-slate-100"],${U}:not([data-theme="dark"]) #main-content thead[class~="bg-slate-100"]{background-color:#e8edf6 !important}`,
    // 글자 키우기는 폭 640px 이상(태블릿·PC)에서만 — 스마트폰에서는 글자를 키우면 좁은 화면에서 줄이 넘친다(375px에서 9개 화면)
    field: (U) => `
@media (min-width:640px){
${U}{font-size:17.5px}
${U} [class~="text-[10px]"]{font-size:12px !important}
${U} [class~="text-[11px]"]{font-size:13px !important}
}
${U} #main-content button,${U} #main-content select,${U} #main-content input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]){min-height:40px}
${U} #main-content button.tap-compact,${U} #main-content .tap-compact button{min-height:0}
${U}:not([data-theme="dark"]) [class~="border-slate-200"]{border-color:#94a3b8 !important}
${U}:not([data-theme="dark"]) [class~="border-slate-300"]{border-color:#64748b !important}
${U}:not([data-theme="dark"]) [class~="text-slate-500"]{color:#475569 !important}
${U}:not([data-theme="dark"]) [class~="text-slate-400"]{color:#64748b !important}
${U} input[type="checkbox"],${U} input[type="radio"]{width:20px;height:20px}`
};

// 인쇄할 때는 글자 크기를 원래대로 (이 문서를 그대로 인쇄하는 라벨·양식의 치수가 스타일에 따라 달라지지 않게)
const PRINT_CSS = '@media print{html[data-ui]{font-size:16px !important}}';
const buildCss = () => `${Object.entries(UI_STYLES).filter(([id]) => id !== 'default').map(([id, style]) => {
    const U = `html[data-ui="${id}"]`;
    return `${style.accent ? accentCss(id, PALETTES[style.accent]) : ''}\n${SHAPE_CSS[id] ? SHAPE_CSS[id](U) : ''}`;
}).join('\n')}\n${PRINT_CSS}`;

let isInjected = false;
const injectCss = () => {
    if (isInjected || typeof document === 'undefined') return;
    isInjected = true;
    const el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    el.textContent = buildCss();
    // 다크 모드 보정(head 맨 앞)·Tailwind보다 뒤에 놓여야 덮인다
    document.head.appendChild(el);
};

/** 저장된 UI 스타일 (없거나 모르는 값이면 기본) */
export const currentUiStyle = () => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return isUiStyle(saved) ? saved : 'default';
    } catch (e) {
        console.warn('[UI 스타일] 저장된 값을 읽지 못해 기본 스타일로 엽니다.', e);
        return 'default';
    }
};

/**
 * UI 스타일을 입힌다 (기억도 함께). 모르는 값이면 기본으로.
 * @param {string} id UI_STYLES의 키
 * @returns {string} 입힌 스타일
 */
export const applyUiStyle = (id) => {
    const style = isUiStyle(id) ? id : 'default';
    injectCss();
    if (style === 'default') document.documentElement.removeAttribute('data-ui');
    else document.documentElement.setAttribute('data-ui', style);
    try { localStorage.setItem(STORAGE_KEY, style); } catch (e) { console.warn('[UI 스타일] 선택을 기억하지 못했습니다.', e); }
    // 글자 크기가 바뀌면 머리글 높이·메뉴 칸 폭을 다시 재도록 알린다 (Header.js가 resize에서 다시 잰다)
    window.dispatchEvent(new Event('resize'));
    return style;
};
