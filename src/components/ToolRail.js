// ==========================================
// TOOL 도구 막대 — 화면 오른쪽 가장자리에 세로로 선 TOOL 메뉴 (PC · 폭 768px 이상)
// ==========================================
// 기본은 아이콘만 보이고(폭 44px), 커서를 올리면 이름까지 펼쳐진다(본문 위에 겹쳐 뜸).
// 맨 위 [TOOL] 단추를 누르면 펼친 채로 고정되고(본문이 그만큼 왼쪽으로 물러남), 다시 누르면 아이콘만 남는다 — 기기별로 기억(daelim_tool_rail_pinned).
// 메뉴 구성은 navMenu.js NAV_TREE의 rail 묶음(TOOL)에서 가져온다 — 그 묶음은 상단 메뉴 줄에는 그리지 않는다(Header.js).
// 스마트폰은 예전처럼 ☰ 서랍의 TOOL 묶음·주메뉴 화면(hub-tool)으로 들어간다.
import { NAV_TREE, TAB_META } from './navMenu.js';
import { canAccessTab } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

const RAIL_ID = 'tool-rail';
const STYLE_ID = 'tool-rail-style';
const PIN_KEY = 'daelim_tool_rail_pinned';
const COLLAPSED_WIDTH = 44; // 아이콘만 (px)
const EXPANDED_WIDTH = 208; // 이름까지 (px)

/** 도구 막대로 뺀 묶음 (NAV_TREE에서 rail 표시가 있는 묶음) */
export const railGroup = () => NAV_TREE.find(n => n.rail && n.items) || null;

const isPinned = () => { try { return localStorage.getItem(PIN_KEY) === '1'; } catch { return false; } };
const savePinned = (on) => { try { localStorage.setItem(PIN_KEY, on ? '1' : '0'); } catch (e) { console.warn('[도구 막대] 고정 상태를 기억하지 못했습니다.', e); } };

const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    // 펼침 = 커서를 올렸거나(hover) 고정(is-pinned). 본문은 막대 폭만큼 오른쪽을 비운다(고정이면 펼친 폭만큼)
    style.textContent = `
#${RAIL_ID}{width:${COLLAPSED_WIDTH}px;transition:width .16s ease}
#${RAIL_ID}:hover,#${RAIL_ID}.is-pinned,#${RAIL_ID}:focus-within{width:${EXPANDED_WIDTH}px}
#${RAIL_ID} .tr-label{opacity:0;white-space:nowrap;transition:opacity .12s ease}
#${RAIL_ID}:hover .tr-label,#${RAIL_ID}.is-pinned .tr-label,#${RAIL_ID}:focus-within .tr-label{opacity:1}
body.an-full #${RAIL_ID}{display:none !important}
@media (min-width:768px){
body.has-tool-rail #main-content{padding-right:${COLLAPSED_WIDTH + 28}px}
body.has-tool-rail.tool-rail-pinned #main-content{padding-right:${EXPANDED_WIDTH + 24}px}
}
@media print{#${RAIL_ID}{display:none !important}}`;
    document.head.appendChild(style);
};

/** 도구 막대를 없앤다 (로그아웃) */
export const unmountToolRail = () => {
    document.getElementById(RAIL_ID)?.remove();
    document.body.classList.remove('has-tool-rail', 'tool-rail-pinned');
};

/**
 * 도구 막대를 그린다 (메뉴 줄을 다시 그릴 때마다 — 켜진 메뉴 표시를 맞춘다)
 * @param {{ activeTab: string, onSwitchTab: (tab: string) => void }} opts
 */
export const renderToolRail = ({ activeTab, onSwitchTab }) => {
    const group = railGroup();
    const tabs = group ? group.items.filter(x => typeof x === 'string' && canAccessTab(x)) : [];
    if (!tabs.length) { unmountToolRail(); return; }
    ensureStyle();
    let rail = document.getElementById(RAIL_ID);
    if (!rail) {
        rail = document.createElement('aside');
        rail.id = RAIL_ID;
        rail.setAttribute('aria-label', `${group.label} 도구 막대`);
        // 머리글(z-40) 아래 · 떠 있는 단추(오른쪽 아래) 위쪽 자리. 본문 위에 겹쳐 뜨므로 그림자를 준다
        rail.className = 'no-print hidden md:flex fixed right-0 z-[39] flex-col overflow-hidden bg-white border border-r-0 border-slate-200 rounded-l-2xl shadow-lg';
        rail.style.top = 'calc(var(--header-h, 104px) + 14px)';
        document.body.appendChild(rail);
        rail.addEventListener('click', (ev) => {
            const button = ev.target.closest('button');
            if (!button) return;
            if (button.dataset.railPin !== undefined) {
                const on = !rail.classList.contains('is-pinned');
                savePinned(on);
                rail.classList.toggle('is-pinned', on);
                document.body.classList.toggle('tool-rail-pinned', on);
                button.setAttribute('aria-pressed', String(on));
                button.title = on ? '고정 풀기 (아이콘만 보이기)' : '펼친 채로 고정';
                // 본문 폭이 바뀌었으니 그래프·표가 다시 재도록 알린다
                window.dispatchEvent(new Event('resize'));
                return;
            }
            if (button.dataset.railTab) rail.onSwitch?.(button.dataset.railTab);
        });
    }
    rail.onSwitch = onSwitchTab;
    const pinned = isPinned();
    rail.classList.toggle('is-pinned', pinned);
    document.body.classList.add('has-tool-rail');
    document.body.classList.toggle('tool-rail-pinned', pinned);
    const row = 'tap-compact w-full h-10 flex items-center gap-3 pl-[13px] pr-3 text-left text-xs font-bold transition';
    rail.innerHTML = `
        <button type="button" data-rail-pin aria-pressed="${pinned}" title="${pinned ? '고정 풀기 (아이콘만 보이기)' : '펼친 채로 고정'}"
            class="${row} bg-slate-900 text-white hover:bg-slate-800">
            <i data-lucide="${esc(group.icon)}" class="w-[18px] h-[18px] shrink-0"></i>
            <span class="tr-label flex-1">${esc(group.label)}</span>
            <i data-lucide="pin" class="tr-label w-3.5 h-3.5 shrink-0 ${pinned ? 'text-amber-300' : 'text-white/60'}"></i>
        </button>
        ${tabs.map((tab) => {
            const meta = TAB_META[tab];
            const on = tab === activeTab;
            return `<button type="button" data-rail-tab="${esc(tab)}" title="${esc(meta.label)} — ${esc(meta.desc || '')}" ${on ? 'aria-current="page"' : ''}
                class="${row} ${on ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700'}">
                <i data-lucide="${esc(meta.icon)}" class="w-[18px] h-[18px] shrink-0 ${on ? 'text-white' : 'text-slate-500'}"></i>
                <span class="tr-label">${esc(meta.label)}</span>
            </button>`;
        }).join('')}`;
    createIcons({ icons });
};
