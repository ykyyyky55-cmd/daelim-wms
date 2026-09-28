// ==========================================
// 품목 드롭다운(<select>)에 품명 일부 검색 붙이기
// ==========================================
// select는 그대로 두고(값을 읽는 기존 코드 유지) 바로 위에 검색칸을 넣는다.
// 품명·코드·규격 일부를 치면 아래에 후보 목록이 뜨고, 고르면(클릭·Enter) select 값을 바꾸고 change를 보낸다.
// 공백·특수문자 무시, 여러 단어는 모두 포함 (searchUtils.matchesQuery). ↑↓로 이동, Esc로 닫기.
import { matchesQuery } from './searchUtils.js';
import { esc } from './html.js';

const MAX = 30;
let openList = null; // 한 번에 하나만
const closeList = () => { openList?.remove(); openList = null; };
document.addEventListener('mousedown', (e) => {
    if (openList && !openList.contains(e.target) && !e.target.classList?.contains('sel-search-input')) closeList();
});
window.addEventListener('scroll', (e) => { if (openList && !openList.contains(e.target)) closeList(); }, true);

/**
 * @param {HTMLSelectElement} select 품목 select (option value = 품목코드)
 * @param {Array<{code,name,spec,category}>} items select에 들어 있는 품목들
 * @param {{ placeholder?: string, ring?: string }} opts
 */
export const attachSelectSearch = (select, items, { placeholder = '품명 일부 검색 (예: 드럼, 5W30)', ring = 'focus:ring-blue-500' } = {}) => {
    if (!select || select.dataset.searchAttached) return;
    select.dataset.searchAttached = '1';
    const input = document.createElement('input');
    input.type = 'search';
    input.autocomplete = 'off';
    input.placeholder = placeholder;
    input.className = `sel-search-input w-full mb-1 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:ring-1 ${ring} focus:outline-none`;
    select.parentNode.insertBefore(input, select);

    let matches = [];
    let active = 0;

    const pick = (m) => {
        if (!m) return;
        select.value = m.code;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        input.value = '';
        closeList();
    };

    const paint = () => {
        openList?.querySelectorAll('[data-i]').forEach((b) => b.classList.toggle('bg-blue-50', Number(b.dataset.i) === active));
        openList?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    };

    const show = () => {
        const q = input.value.trim();
        closeList();
        if (!q) return;
        matches = items.filter(m => matchesQuery(m, q, ['code', 'name', 'spec'])).slice(0, MAX);
        active = 0;
        const r = input.getBoundingClientRect();
        const el = document.createElement('div');
        el.className = 'fixed z-[80] bg-white border border-slate-300 rounded-xl shadow-2xl max-h-72 overflow-y-auto text-xs';
        el.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - Math.max(r.width, 300) - 4))}px`;
        el.style.top = `${r.bottom + 2}px`;
        el.style.width = `${Math.min(Math.max(r.width, 300), window.innerWidth - 8)}px`;
        el.innerHTML = matches.length === 0
            ? '<div class="p-3 text-slate-400 text-center">일치하는 품목이 없습니다.</div>'
            : matches.map((m, i) => `<button type="button" data-i="${i}" class="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100">
                <span class="font-bold text-slate-800">${esc(m.name)}</span> <span class="font-mono text-[10px] text-blue-600">${esc(m.code)}</span>
                ${m.spec ? `<span class="block text-[10px] text-slate-400 truncate">${esc(m.spec)}</span>` : ''}</button>`).join('');
        document.body.appendChild(el);
        openList = el;
        el.querySelectorAll('[data-i]').forEach(b => b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(matches[Number(b.dataset.i)]); }));
        paint();
    };

    input.addEventListener('input', show);
    input.addEventListener('focus', () => { if (input.value.trim()) show(); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeList(); return; }
        if (!openList || matches.length === 0) { if (e.key === 'Enter') e.preventDefault(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % matches.length; paint(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + matches.length) % matches.length; paint(); }
        else if (e.key === 'Enter') { e.preventDefault(); pick(matches[active]); } // 폼 제출 막고 선택
    });
};
