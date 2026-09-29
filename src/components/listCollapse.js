// ==========================================
// 목록 접기 / 펼치기 (품목관리·창고 재고·원료수불부 공용)
// ==========================================
// 화면을 처음 열면 목록은 접혀 있고(그리지 않아 빨리 열림), [펼치기]를 누르거나
// 구분·종류를 고르거나 검색하면 펼쳐진다. 펼쳐져 있을 때만 [모두 접기]가 켜진다.
import { esc } from '../services/html.js';

// Tailwind md(768px) 미만이면 카드 목록, 이상이면 표 (화면의 md:hidden / hidden md:block과 같은 기준).
// 목록 화면은 둘 다 그려 한쪽을 숨기지 말고 이 값으로 보이는 쪽만 그린다.
export const mobileLayoutQuery = window.matchMedia('(max-width: 767.98px)');

/**
 * 화면 폭이 PC ↔ 스마트폰 기준을 넘나들면 다시 그린다. 목록이 화면에서 사라지면 스스로 해제한다.
 * @param {Element | null} anchor 이 요소가 문서에서 빠지면 해제
 * @param {() => void} rerender
 */
export const watchLayoutChange = (anchor, rerender) => {
    const onChange = () => {
        if (!anchor || !document.body.contains(anchor)) {
            mobileLayoutQuery.removeEventListener('change', onChange);
            return;
        }
        rerender();
    };
    mobileLayoutQuery.addEventListener('change', onChange);
};

const COLLAPSE_BUTTON_CLASS = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed';

/** [펼치기]·[모두 접기] 버튼 묶음 HTML (둘 다 같은 모양) */
const controlsMarkup = (label) => `
    <div class="list-collapse-controls flex items-center gap-1.5 no-print">
        <button type="button" data-list-collapse="expand" class="${COLLAPSE_BUTTON_CLASS} bg-blue-600 text-white border-blue-600 hover:bg-blue-700" title="${esc(label)} 전체를 펼칩니다">▾ 펼치기</button>
        <button type="button" data-list-collapse="collapse" class="${COLLAPSE_BUTTON_CLASS} bg-white text-slate-700 border-slate-300 hover:bg-slate-100" title="펼친 ${esc(label)}을(를) 모두 접습니다" disabled>▴ 모두 접기</button>
    </div>`;

/**
 * @typedef {Object} GroupCollapse
 * @property {(key: string) => boolean} isOpen 그 묶음(분류)이 펼쳐져 있는지
 * @property {(key: string) => void} toggle 머리줄을 눌렀을 때 그 묶음만 펼치거나 접는다
 * @property {(keys: string[]) => void} openKeys 여러 묶음을 펼친다 (분류·종류 선택·검색 결과)
 * @property {(keys: string[]) => void} setKeys 지금 목록에 있는 묶음 목록 (버튼 켜짐 상태 계산용, 그릴 때마다 호출)
 * @property {() => string} controlsHtml [펼치기]·[모두 접기] 버튼 HTML
 * @property {(host: Element | null) => void} mount 버튼 묶음에 클릭 처리를 붙인다 (다시 그린 버튼마다 호출)
 */

/**
 * 분류별로 묶인 목록의 묶음 단위 접기. 처음에는 모든 묶음이 접혀 머리줄(건수)만 보이고,
 * [펼치기]는 전부 펼치며, 펼친 묶음이 하나라도 있으면 [모두 접기]가 켜진다.
 * @param {{ label?: string, onToggle: () => void }} options onToggle: 버튼·머리줄로 접고 펼쳤을 때 다시 그리기
 * @returns {GroupCollapse}
 */
export const createGroupCollapse = ({ label = '목록', onToggle }) => {
    const opened = new Set();
    let keys = [];
    let host = null;
    const paintButtons = () => {
        if (!host) return;
        const expandButton = host.querySelector('[data-list-collapse="expand"]');
        const collapseButton = host.querySelector('[data-list-collapse="collapse"]');
        if (expandButton) expandButton.disabled = keys.length === 0 || keys.every(k => opened.has(k));
        if (collapseButton) collapseButton.disabled = !keys.some(k => opened.has(k));
    };
    return {
        isOpen: (key) => opened.has(key),
        toggle: (key) => { if (opened.has(key)) opened.delete(key); else opened.add(key); },
        openKeys: (list) => list.forEach(k => opened.add(k)),
        setKeys: (list) => { keys = list; paintButtons(); },
        controlsHtml: () => controlsMarkup(label),
        mount: (element) => {
            host = element;
            if (!host) return;
            host.addEventListener('click', (e) => {
                const button = e.target.closest('[data-list-collapse]');
                if (!button || button.disabled) return;
                if (button.dataset.listCollapse === 'expand') keys.forEach(k => opened.add(k));
                else opened.clear();
                onToggle();
            });
            paintButtons();
        }
    };
};

/**
 * @typedef {Object} ListCollapse
 * @property {() => boolean} isExpanded 지금 펼쳐져 있는지
 * @property {() => void} expand 펼친다 (다시 그리기는 호출한 쪽이 한다)
 * @property {() => void} collapse 접는다 (다시 그리기는 호출한 쪽이 한다)
 * @property {() => string} controlsHtml [펼치기]·[모두 접기] 버튼 HTML
 * @property {(host: Element | null) => void} mount 버튼 묶음에 클릭 처리를 붙인다
 * @property {(summary: string) => string} placeholderHtml 접힌 목록 자리에 보일 안내 (div)
 * @property {(summary: string, colspan: number) => string} placeholderRowHtml 접힌 표 자리에 보일 안내 (tr)
 */

/**
 * @param {{ label?: string, onToggle: () => void }} options label: 안내 문구에 쓰는 목록 이름, onToggle: 버튼으로 접고 펼쳤을 때 다시 그리기
 * @returns {ListCollapse}
 */
export const createListCollapse = ({ label = '목록', onToggle }) => {
    let expanded = false;
    let host = null;

    const paintButtons = () => {
        if (!host) return;
        const expandButton = host.querySelector('[data-list-collapse="expand"]');
        const collapseButton = host.querySelector('[data-list-collapse="collapse"]');
        if (expandButton) expandButton.disabled = expanded;
        if (collapseButton) collapseButton.disabled = !expanded;
    };
    const setExpanded = (value) => {
        expanded = value;
        paintButtons();
    };

    return {
        isExpanded: () => expanded,
        expand: () => setExpanded(true),
        collapse: () => setExpanded(false),
        controlsHtml: () => controlsMarkup(label),
        mount: (element) => {
            host = element;
            if (!host) return;
            host.addEventListener('click', (e) => {
                const button = e.target.closest('[data-list-collapse]');
                if (!button || button.disabled) return;
                setExpanded(button.dataset.listCollapse === 'expand');
                onToggle();
            });
            paintButtons();
        },
        placeholderHtml: (summary) => `
            <div class="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
                <div class="font-bold text-slate-700">${esc(label)}이(가) 접혀 있습니다${summary ? ` · ${esc(summary)}` : ''}</div>
                <div class="mt-1">[▾ 펼치기]를 누르거나 구분·종류를 고르거나 검색하면 펼쳐집니다.</div>
            </div>`,
        placeholderRowHtml: (summary, colspan) => `
            <tr><td colspan="${colspan}" class="p-8 text-center text-xs text-slate-500 bg-slate-50">
                <div class="font-bold text-slate-700">${esc(label)}이(가) 접혀 있습니다${summary ? ` · ${esc(summary)}` : ''}</div>
                <div class="mt-1">[▾ 펼치기]를 누르거나 구분·종류를 고르거나 검색하면 펼쳐집니다.</div>
            </td></tr>`
    };
};
