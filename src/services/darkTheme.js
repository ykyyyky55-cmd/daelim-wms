// 다크 모드 보정 CSS
// 화면은 Tailwind 밝은 색 클래스(bg-white, bg-blue-50, text-blue-700 …)로 만들어져 있어, index.html의 몇 줄로는
// 흰 버튼·흰 표 줄·밝은 배지가 그대로 남았다(흰 바탕에 밝은 글자가 되어 안 보임).
// 색 이름 × 명도 조합을 여기서 한 번에 만들어 [data-theme="dark"]일 때만 덮어쓴다.
// 흰 종이처럼 보여야 하는 곳(인쇄 미리보기·라벨·문서 편집기)은 인라인 style로 흰색을 쓰므로 영향이 없다.
const COLORS = {
    red: ['239,68,68', '#fca5a5', '#f87171'], orange: ['249,115,22', '#fdba74', '#fb923c'],
    amber: ['245,158,11', '#fcd34d', '#fbbf24'], yellow: ['234,179,8', '#fde047', '#facc15'],
    lime: ['132,204,22', '#bef264', '#a3e635'], green: ['34,197,94', '#86efac', '#4ade80'],
    emerald: ['16,185,129', '#6ee7b7', '#34d399'], teal: ['20,184,166', '#5eead4', '#2dd4bf'],
    cyan: ['6,182,212', '#67e8f9', '#22d3ee'], sky: ['14,165,233', '#7dd3fc', '#38bdf8'],
    blue: ['59,130,246', '#93c5fd', '#60a5fa'], indigo: ['99,102,241', '#a5b4fc', '#818cf8'],
    violet: ['139,92,246', '#c4b5fd', '#a78bfa'], purple: ['168,85,247', '#d8b4fe', '#c084fc'],
    fuchsia: ['217,70,239', '#f0abfc', '#e879f9'], pink: ['236,72,153', '#f9a8d4', '#f472b6'],
    rose: ['244,63,94', '#fda4af', '#fb7185']
};
const GRAYS = ['slate', 'gray', 'zinc', 'neutral', 'stone'];
const D = '[data-theme="dark"]';
const PANEL = '#131b2e', SUNKEN = '#0f172a', RAISED = '#1e293b', LINE = '#243048';

// 클래스 토큰 선택자 (불투명도 변형 bg-blue-50/40 포함)
const tok = (c) => `${D} [class~="${c}"], ${D} [class*=" ${c}/"], ${D} [class^="${c}/"]`;
const hov = (c) => `${D} [class~="hover:${c}"]:hover`;

const buildCss = () => {
    const r = [];
    const rule = (sel, body) => r.push(`${sel}{${body}}`);

    // 기본 테두리색 (색 지정 없는 border·border-b → Tailwind 기본 회색이 흰 줄처럼 보임)
    rule(`${D} *, ${D} ::before, ${D} ::after`, `border-color:${LINE}`);

    // 흰 바탕: div만 덮던 것을 모든 요소로 (흰 버튼·흰 칩·흰 표 칸)
    rule(tok('bg-white'), `background-color:${PANEL} !important`);
    // 버튼·칩·선택된 탭(세그먼트)은 카드보다 한 단계 밝게 해 눌린 칸이 구분되게
    rule(`${D} button[class~="bg-white"], ${D} label[class~="bg-white"], ${D} a[class~="bg-white"], ${D} span[class~="bg-white"]`, `background-color:${RAISED} !important`);
    rule(hov('bg-white'), `background-color:${RAISED} !important`);
    // 회색 바탕
    for (const g of GRAYS) {
        rule([tok(`bg-${g}-50`), tok(`bg-${g}-100`)].join(','), `background-color:${SUNKEN} !important`);
        rule(tok(`bg-${g}-200`), `background-color:${RAISED} !important`);
        rule(tok(`bg-${g}-300`), `background-color:#334155 !important`);
        rule([hov(`bg-${g}-50`), hov(`bg-${g}-100`), hov(`bg-${g}-200`)].join(','), `background-color:rgba(148,163,184,.14) !important`);
        rule(`${D} [class~="even:bg-${g}-50"]:nth-child(even), ${D} [class~="odd:bg-${g}-50"]:nth-child(odd)`, `background-color:rgba(148,163,184,.05) !important`);
        rule([100, 200, 300].map(s => tok(`border-${g}-${s}`)).join(','), `border-color:${LINE} !important`);
        rule([100, 200, 300].map(s => `${D} .divide-${g}-${s} > * + *`).join(','), `border-color:${LINE} !important`);
        rule([700, 800, 900, 950].map(s => tok(`text-${g}-${s}`)).join(','), `color:#f1f5f9 !important`);
        rule([500, 600].map(s => tok(`text-${g}-${s}`)).join(','), `color:#94a3b8 !important`);
        rule([`from-${g}-50`, `from-${g}-100`].map(tok).join(','), `--tw-gradient-from:${SUNKEN} var(--tw-gradient-from-position) !important;--tw-gradient-to:rgba(15,23,42,0) var(--tw-gradient-to-position) !important`);
        rule([`to-${g}-50`, `to-${g}-100`].map(tok).join(','), `--tw-gradient-to:${SUNKEN} var(--tw-gradient-to-position) !important`);
    }
    rule(tok('text-black'), 'color:#f1f5f9 !important');
    rule(tok('from-white'), `--tw-gradient-from:${PANEL} var(--tw-gradient-from-position) !important;--tw-gradient-to:rgba(19,27,46,0) var(--tw-gradient-to-position) !important`);
    rule(tok('to-white'), `--tw-gradient-to:${PANEL} var(--tw-gradient-to-position) !important`);

    // 색 바탕(연한 배지·안내 상자)은 반투명 색으로, 진한 색 글자는 밝게
    for (const [c, [rgb, t300, t400]] of Object.entries(COLORS)) {
        rule(tok(`bg-${c}-50`), `background-color:rgba(${rgb},.10) !important`);
        rule(tok(`bg-${c}-100`), `background-color:rgba(${rgb},.18) !important`);
        rule(tok(`bg-${c}-200`), `background-color:rgba(${rgb},.28) !important`);
        rule([hov(`bg-${c}-50`), hov(`bg-${c}-100`), hov(`bg-${c}-200`)].join(','), `background-color:rgba(${rgb},.24) !important`);
        rule([100, 200, 300].map(s => tok(`border-${c}-${s}`)).join(','), `border-color:rgba(${rgb},.38) !important`);
        rule(tok(`text-${c}-600`), `color:${t400} !important`);
        rule([700, 800, 900, 950].map(s => tok(`text-${c}-${s}`)).join(','), `color:${t300} !important`);
        rule([`from-${c}-50`, `from-${c}-100`].map(tok).join(','), `--tw-gradient-from:rgba(${rgb},.14) var(--tw-gradient-from-position) !important;--tw-gradient-to:rgba(${rgb},0) var(--tw-gradient-to-position) !important`);
        rule([`via-${c}-50`, `via-${c}-100`].map(tok).join(','), `--tw-gradient-stops:var(--tw-gradient-from), rgba(${rgb},.10) var(--tw-gradient-via-position), var(--tw-gradient-to) !important`);
        rule([`to-${c}-50`, `to-${c}-100`].map(tok).join(','), `--tw-gradient-to:rgba(${rgb},.08) var(--tw-gradient-to-position) !important`);
    }
    // 밝은 원색 바탕(노랑·연두 등) 위의 진한 글자는 그대로 진하게
    rule(['amber', 'yellow', 'lime'].flatMap(c => [300, 400].map(s => tok(`bg-${c}-${s}`))).join(','), 'color:#1e293b !important');
    // 열 필터(ColumnFilter: 인라인 style이라 !important로 덮음)
    rule(`${D} .col-filter-btn:not([title*="적용 중"])`, `background:${RAISED} !important;border-color:#334155 !important;color:#94a3b8 !important`);
    rule(`${D} .col-filter-popover`, `background:#1a233b !important;border-color:#334155 !important;color:#e2e8f0 !important`);
    rule(`${D} .col-filter-popover .cf-clear, ${D} .col-filter-popover .cf-cancel`, `background:${RAISED} !important;border-color:#334155 !important;color:#e2e8f0 !important`);
    rule(`${D} .col-filter-clear`, `background:rgba(59,130,246,.18) !important;border-color:rgba(59,130,246,.4) !important;color:#93c5fd !important`);
    // 인쇄 미리보기처럼 흰 종이로 보여야 하는 곳 (class="theme-paper")
    // (index.html의 [data-theme] div.bg-white보다 우선하도록 클래스를 두 번 씀)
    rule(`${D} .theme-paper.theme-paper`, 'background-color:#fff !important;color:#0f172a !important');    // 입력칸 안내 글자
    rule(`${D} input::placeholder, ${D} textarea::placeholder`, 'color:#64748b !important');
    return r.join('\n');
};

let injected = false;
export const injectDarkThemeCss = () => {
    if (injected || typeof document === 'undefined') return;
    injected = true;
    const el = document.createElement('style');
    el.id = 'dark-theme-extra';
    el.textContent = buildCss();
    // 맨 앞에 넣는다: 기본 테두리색 규칙([data-theme] *)이 Tailwind의 색 있는 테두리 클래스(같은 우선순위, 뒤에 옴)를 덮지 않게
    document.head.prepend(el);
};

export const isDarkTheme = () => document.documentElement.getAttribute('data-theme') === 'dark';

// Chart.js 글자·격자 색 (그래프를 새로 그릴 때마다 부름)
export const applyChartTheme = (Chart) => {
    const dark = isDarkTheme();
    Chart.defaults.color = dark ? '#cbd5e1' : '#666';
    Chart.defaults.borderColor = dark ? 'rgba(148,163,184,0.18)' : 'rgba(0,0,0,0.1)';
    Chart.defaults.elements.arc.borderColor = dark ? PANEL : '#fff';
};
