// ==========================================
// 묶음 화면: 주메뉴(생산업무 · 일정관리 · 생산관리 …)마다 그 안의 메뉴를 카드로 모아 보여 주는 화면
// ==========================================
// 상단 메뉴의 묶음 이름을 누르면 열린다 (탭 이름 'hub-<묶음 id>', navMenu.js의 hubTabOf/hubGroupOf).
// 카드를 누르면 그 메뉴로 들어가고, ☆로 사이드바 즐겨찾기에 넣고 뺀다. 권한이 없는 메뉴는 보이지 않는다.
// 메뉴 구성은 navMenu.js의 NAV_TREE·TAB_META 하나에서 나온다 — 메뉴를 더하면 이 화면에도 저절로 나온다.
import { esc } from '../services/html.js';
import { canAccessTab } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { TAB_META, NAV_TREE, hubTabOf, openHubWindow } from './navMenu.js';
import { getPinnedMenus } from './Sidebar.js';

/** 메뉴 경로 글자색: 화면 머리 규칙과 같다 (품질관리 = 초록, 현황판 = 남색, 그 밖 = 파랑) */
const CRUMB_TONE = { quality: 'text-emerald-700', analyticsGroup: 'text-indigo-600' };

/**
 * 권한 있는 메뉴만 작은 제목(heading)별로 묶는다
 * @param {{ items: Array<string | { heading: string }> }} group
 * @returns {Array<{ heading: string, tabs: string[] }>} 메뉴가 없는 묶음은 뺀다
 */
export const hubSections = (group) => {
    const sections = [];
    let cur = { heading: '', tabs: [] };
    group.items.forEach(x => {
        if (typeof x !== 'string') { if (cur.tabs.length) sections.push(cur); cur = { heading: x.heading, tabs: [] }; return; }
        if (canAccessTab(x)) cur.tabs.push(x);
    });
    if (cur.tabs.length) sections.push(cur);
    return sections;
};

/**
 * @param {HTMLElement} container
 * @param {{ group: { id: string, label: string, icon: string, desc?: string, items: Array<string | { heading: string }> }, onSwitchTab: (tab: string) => void, showToast?: (msg: string) => void }} opt
 */
export const renderMenuHub = (container, { group, onSwitchTab, showToast = () => {} }) => {
    const sections = hubSections(group);
    const count = sections.reduce((n, s) => n + s.tabs.length, 0);
    const isFav = (id) => (window.__isFavorite ? window.__isFavorite(id) : getPinnedMenus().includes(id));
    const tone = CRUMB_TONE[group.id] || 'text-blue-600';
    // 다른 주메뉴: 권한 있는 메뉴가 하나라도 든 묶음만
    const others = NAV_TREE.filter(n => n.items && n.id !== group.id && n.items.some(x => typeof x === 'string' && canAccessTab(x)));

    const favCls = (on) => `hub-fav tap-compact absolute top-2 right-2 w-8 h-8 rounded-lg text-base leading-none ${on ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}`;
    const favTitle = (on) => (on ? '사이드바 즐겨찾기에서 빼기' : '사이드바 즐겨찾기에 등록');
    const favBtn = (id) => {
        const on = isFav(id);
        return `<button type="button" data-fav="${esc(id)}" class="${favCls(on)}" title="${favTitle(on)}" aria-label="${favTitle(on)}">${on ? '★' : '☆'}</button>`;
    };
    const card = (id) => {
        const m = TAB_META[id] || { icon: 'circle', label: id, desc: '' };
        return `
        <div class="relative">
            <button type="button" data-hub-tab="${esc(id)}" class="group w-full h-full text-left bg-white rounded-2xl border border-slate-200 shadow-sm hover:border-blue-400 hover:shadow transition p-3.5 sm:p-4 pr-11 flex items-start gap-3">
                <span class="shrink-0 w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition"><i data-lucide="${m.icon}" class="w-5 h-5"></i></span>
                <span class="min-w-0 flex-1">
                    <span class="block text-sm font-black text-slate-900 group-hover:text-blue-700">${esc(m.label)}</span>
                    <span class="block text-xs text-slate-500 mt-0.5 leading-snug">${esc(m.desc || '')}</span>
                </span>
            </button>
            ${favBtn(id)}
        </div>`;
    };

    container.innerHTML = `
    <section id="menu-hub" class="space-y-4" data-group="${esc(group.id)}">
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
                <div class="text-[11px] font-black ${tone} flex items-center gap-1"><i data-lucide="layout-grid" class="w-3.5 h-3.5"></i>주메뉴 › ${esc(group.label)}</div>
                <h2 class="text-lg font-black text-slate-900 flex items-center gap-2 mt-0.5"><i data-lucide="${group.icon}" class="w-5 h-5 ${tone}"></i>${esc(group.label)}</h2>
                <p class="text-xs text-slate-500 mt-0.5">${esc(group.desc || '')}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <span class="text-xs font-bold text-slate-500">메뉴 <b class="text-slate-900">${count}</b>개 · 카드를 누르면 들어갑니다</span>
                <!-- 이 주메뉴만의 창을 따로 띄운다 (PC: 다른 화면과 나란히 놓고 쓰기) -->
                <button type="button" id="hub-new-window" class="max-md:hidden px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5" title="${esc(group.label)} 화면을 따로 떨어진 새 창으로 엽니다 (메뉴 줄의 주메뉴 이름을 Ctrl·Shift와 함께 눌러도 됩니다)"><i data-lucide="external-link" class="w-3.5 h-3.5 text-blue-600"></i>새 창으로 열기</button>
            </div>
        </div>

        ${sections.map(sec => `
        <div class="space-y-2">
            ${sec.heading ? `<h3 class="px-1 text-xs font-black text-slate-500 flex items-center gap-2"><span>${esc(sec.heading)}</span><span class="flex-1 h-px bg-slate-200"></span></h3>` : ''}
            <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">${sec.tabs.map(card).join('')}</div>
        </div>`).join('')}

        ${count ? '' : '<div class="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm font-bold text-slate-400">이 메뉴에서 쓸 수 있는 화면이 없습니다.</div>'}

        ${others.length ? `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-4">
            <div class="text-[11px] font-black text-slate-500 mb-2">다른 주메뉴</div>
            <div class="flex flex-wrap gap-1.5">${others.map(n => `<button type="button" data-hub-tab="${esc(hubTabOf(n.id))}" class="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-xs font-bold text-slate-700 flex items-center gap-1.5"><i data-lucide="${n.icon}" class="w-3.5 h-3.5 text-slate-400"></i>${esc(n.label)}</button>`).join('')}</div>
        </div>` : ''}
    </section>`;

    const root = container.querySelector('#menu-hub');
    root.addEventListener('click', (e) => {
        if (e.target.closest('#hub-new-window')) {
            if (!openHubWindow(group.id)) showToast('⚠️ 새 창이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.');
            return;
        }
        const fav = e.target.closest('.hub-fav');
        if (fav) {
            if (!window.__toggleFavorite) return;
            const on = window.__toggleFavorite(fav.dataset.fav);
            fav.textContent = on ? '★' : '☆';
            fav.className = favCls(on);
            fav.title = favTitle(on);
            fav.setAttribute('aria-label', favTitle(on));
            return;
        }
        const go = e.target.closest('[data-hub-tab]');
        if (go) onSwitchTab(go.dataset.hubTab);
    });
    createIcons({ icons });
};
