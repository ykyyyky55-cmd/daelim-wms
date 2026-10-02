// 현장 공용계정의 작업자 고르기 창
// 공용계정(wms_profiles.is_shared)은 여러 사람이 함께 쓰므로, 누가 작업했는지 남도록 작업자 이름을 골라야 화면을 쓸 수 있다.
// 고른 이름은 '이름 (공용계정 이름)'으로 입출고 이력·전표·수불부의 작업자 칸에 남는다 (services/auth.js setCurrentWorker).
// 덮개는 document.body에 둔다 — 다른 기기의 변경으로 화면이 다시 그려져도 고르는 중인 창이 남게.
import { state } from '../services/db.js';
import { setCurrentWorker, currentWorkerName } from '../services/auth.js';
import { esc } from '../services/html.js';
import { createIcons, icons } from '../services/icons.js';

const HOST_ID = 'worker-picker';
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

export const closeWorkerPicker = () => document.getElementById(HOST_ID)?.remove();

/**
 * @param {Object} opts
 * @param {boolean} [opts.required] true면 고르기 전에는 닫을 수 없다 (로그인 직후)
 * @param {(label: string) => void} [opts.onPicked] 고른 뒤 (기록에 남는 작업자 글자)
 * @param {() => void} [opts.onLogout] 필수 창의 [로그아웃]
 */
export const openWorkerPicker = ({ required = false, onPicked = () => {}, onLogout = null } = {}) => {
    closeWorkerPicker();
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.className = 'no-print fixed inset-0 z-[70] bg-slate-900/70 flex items-center justify-center p-3';
    if (required) host.dataset.backLock = '1'; // 고르기 전에는 뒤로가기·Esc로도 닫지 않는다 (services/overlays.js)
    document.body.appendChild(host);

    const account = state.currentUser?.name || '공용계정';
    const current = currentWorkerName();
    const workers = [...(state.workers || [])].filter(w => w.name).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    let keyword = '';

    const listHtml = () => {
        const key = norm(keyword);
        const shown = key ? workers.filter(w => norm(`${w.name}${w.dept || ''}${w.role || ''}`).includes(key)) : workers;
        if (!shown.length) {
            return `<div class="col-span-full p-4 text-center text-xs text-slate-400">${workers.length ? '찾는 이름이 명단에 없습니다. 아래에 이름을 직접 적으세요.' : '등록된 작업자 명단이 없습니다. 아래에 이름을 직접 적으세요.'}</div>`;
        }
        return shown.map(w => `
            <button type="button" class="wp-pick text-left px-3 py-2.5 rounded-xl border ${w.name === current ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50'} transition" data-name="${esc(w.name)}">
                <b class="block text-sm text-slate-900">${esc(w.name)}</b>
                <span class="block text-[11px] text-slate-500 truncate">${esc([w.dept, w.role].filter(Boolean).join(' · ') || '작업자')}</span>
            </button>`).join('');
    };

    host.innerHTML = `
    <div class="w-full max-w-lg max-h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-label="작업자 고르기">
        <div class="px-4 py-3 bg-slate-900 text-white flex items-center gap-2">
            <i data-lucide="user-check" class="w-5 h-5 text-emerald-400"></i>
            <div class="min-w-0">
                <b class="block text-sm">작업자를 골라 주세요</b>
                <span class="block text-[11px] text-slate-300 truncate">${esc(account)} 공용계정 · 고른 이름이 작업 기록에 남습니다</span>
            </div>
            ${required ? '' : '<button type="button" id="wp-close" class="ml-auto min-w-[36px] min-h-[36px] rounded-lg text-slate-300 hover:text-white hover:bg-white/10" title="닫기" aria-label="닫기">✕</button>'}
        </div>
        <div class="p-3 border-b border-slate-100">
            <input type="search" id="wp-search" placeholder="이름·부서로 찾기" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-bold focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
        </div>
        <div id="wp-list" class="flex-1 overflow-auto p-3 grid grid-cols-2 sm:grid-cols-3 gap-2 content-start">${listHtml()}</div>
        <form id="wp-form" class="p-3 border-t border-slate-200 bg-slate-50 flex gap-2">
            <input type="text" id="wp-name" maxlength="20" placeholder="명단에 없으면 이름을 직접 적기" class="flex-1 min-w-0 bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            <button type="submit" class="shrink-0 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl">확인</button>
        </form>
        ${required && onLogout ? '<button type="button" id="wp-logout" class="px-3 py-2.5 text-xs font-bold text-rose-600 hover:bg-rose-50 border-t border-slate-200">로그아웃</button>' : ''}
    </div>`;
    createIcons({ icons });

    const pick = (name) => {
        const clean = String(name || '').trim();
        if (!clean) return;
        const label = setCurrentWorker(clean);
        closeWorkerPicker();
        onPicked(label);
    };

    const list = host.querySelector('#wp-list');
    list.addEventListener('click', (e) => {
        const button = e.target.closest('.wp-pick');
        if (button) pick(button.getAttribute('data-name'));
    });
    host.querySelector('#wp-search').addEventListener('input', (e) => {
        keyword = e.target.value;
        list.innerHTML = listHtml();
    });
    host.querySelector('#wp-form').addEventListener('submit', (e) => {
        e.preventDefault();
        pick(host.querySelector('#wp-name').value);
    });
    host.querySelector('#wp-close')?.addEventListener('click', closeWorkerPicker);
    host.querySelector('#wp-logout')?.addEventListener('click', () => { closeWorkerPicker(); onLogout(); });
    if (!required) host.addEventListener('click', (e) => { if (e.target === host) closeWorkerPicker(); });
};
