// 혼합물 MSDS 작성 화면 공용 도우미 (창 틀 · 분류 칩 · 출처 배지)
import { esc } from '../../../services/html.js';
import { createIcons, icons } from '../../../services/icons.js';
import { classOf, catOf, clsLabel } from '../../../services/ghs/ghsTables.js';

export const INPUT = 'w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white';
export const BTN = 'px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition';
export const BTN_PRIMARY = `${BTN} bg-blue-600 hover:bg-blue-700 text-white shadow-sm`;
export const BTN_SUB = `${BTN} border border-slate-200 bg-white hover:bg-slate-50 text-slate-700`;
export const BTN_MINI = 'px-2 py-1 rounded-lg text-[11px] font-bold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700';
export const CARD = 'bg-white rounded-2xl border border-slate-200 shadow-sm p-4';

/** 분류 짧은 이름 (칩용) */
const SHORT = {
    EXPL: '폭발성', FLAM_GAS: '인화성 가스', AEROSOL: '에어로졸', OX_GAS: '산화성 가스', PRESS_GAS: '고압가스', FLAM_LIQ: '인화성 액체', FLAM_SOL: '인화성 고체', SELF_REACT: '자기반응성',
    PYR_LIQ: '자연발화 액체', PYR_SOL: '자연발화 고체', SELF_HEAT: '자기발열성', WATER_REACT: '물반응성', OX_LIQ: '산화성 액체', OX_SOL: '산화성 고체', ORG_PEROX: '유기과산화물', MET_CORR: '금속부식성',
    ACUTE_ORAL: '급성독성(경구)', ACUTE_DERMAL: '급성독성(경피)', ACUTE_INH: '급성독성(흡입)', SKIN: '피부', EYE: '눈', RESP_SENS: '호흡기 과민성', SKIN_SENS: '피부 과민성',
    MUTA: '변이원성', CARC: '발암성', REPRO: '생식독성', STOT_SE: '표적장기(1회)', STOT_RE: '표적장기(반복)', ASP: '흡인', AQ_ACUTE: '수생(급성)', AQ_CHRONIC: '수생(만성)', OZONE: '오존층'
};
const GROUP_TONE = { PHYS: 'bg-orange-50 text-orange-800 border-orange-200', HEALTH: 'bg-rose-50 text-rose-800 border-rose-200', ENV: 'bg-emerald-50 text-emerald-800 border-emerald-200' };

/** 분류 칩 (마우스를 올리면 전체 이름) */
export const clsChip = (entry) => {
    const cls = classOf(entry.c), ct = catOf(entry.c, entry.k);
    if (!cls || !ct) return '';
    const short = `${SHORT[entry.c] || cls.label} ${ct.label.replace('구분 ', '')}`;
    return `<span class="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded border text-[10px] font-bold ${GROUP_TONE[cls.group]}" title="${esc(clsLabel(entry))}">${esc(short)}</span>`;
};
export const clsChips = (list) => (list || []).map(clsChip).join('');

const SOURCE_BADGE = {
    KOSHA: ['공단', 'bg-sky-100 text-sky-800'], PUBCHEM: ['PubChem', 'bg-violet-100 text-violet-800'], MANUAL: ['직접 입력', 'bg-slate-200 text-slate-700'],
    DOC: ['이 문서 전용', 'bg-amber-100 text-amber-800'], NONE: ['정보 없음', 'bg-rose-100 text-rose-700']
};
/** 물질 정보 출처 배지 */
export const sourceBadge = (key) => {
    const [label, tone] = SOURCE_BADGE[key] || SOURCE_BADGE.NONE;
    return `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-black ${tone}">${label}</span>`;
};

/**
 * 화면을 덮는 창 (본문 밖 body에 붙여, 화면이 다시 그려져도 닫히지 않는다)
 * @param {{ title: string, sub?: string, bodyHtml: string, footHtml?: string, maxW?: string, icon?: string }} opt
 * @returns {{ el: HTMLElement, $: (s: string) => Element|null, $$: (s: string) => Element[], close: () => void, onClose: (fn: () => void) => void }}
 */
export const openDialog = ({ title, sub = '', bodyHtml, footHtml = '', maxW = 'max-w-3xl', icon = 'flask-conical' }) => {
    ensureMsdsStyle();
    const el = document.createElement('div');
    el.className = 'msds-ui fixed inset-0 z-[49] bg-slate-900/60 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto no-print';
    el.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full ${maxW} my-2 text-xs overflow-hidden flex flex-col max-h-[94vh]">
        <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
            <div class="min-w-0"><h3 class="font-black text-sm flex items-center gap-2"><i data-lucide="${icon}" class="w-4 h-4 text-sky-300"></i><span class="truncate">${esc(title)}</span></h3>
                ${sub ? `<div class="text-[11px] text-slate-300 mt-0.5">${esc(sub)}</div>` : ''}</div>
            <button type="button" data-dlg-close class="text-xl leading-none px-1" aria-label="닫기">&times;</button>
        </div>
        <div class="p-4 space-y-3 overflow-y-auto" data-dlg-body>${bodyHtml}</div>
        ${footHtml ? `<div class="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap justify-end gap-2 shrink-0" data-dlg-foot>${footHtml}</div>` : ''}
    </div>`;
    document.body.appendChild(el);
    createIcons({ icons });
    const closeFns = [];
    const close = () => { el.remove(); closeFns.forEach(fn => fn()); };
    el.addEventListener('click', (e) => { if (e.target.closest('[data-dlg-close]')) close(); });
    return { el, $: (s) => el.querySelector(s), $$: (s) => [...el.querySelectorAll(s)], close, onClose: (fn) => closeFns.push(fn) };
};

export const refreshIcons = () => createIcons({ icons });

/**
 * 이 화면의 창들은 본문(#main-content) 밖에 떠서 앱의 스마트폰 공통 규칙이 걸리지 않는다 — 같은 규칙을 따로 넣는다.
 * (버튼·선택 칸 높이 34px 이상, 표 머리글 한 줄, 한글 낱말 단위 줄바꿈)
 */
export const ensureMsdsStyle = () => {
    if (document.getElementById('msds-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'msds-ui-style';
    style.textContent = `.msds-ui { word-break: keep-all; overflow-wrap: break-word; }
        @media (max-width: 639px) { .msds-ui button, .msds-ui select { min-height: 34px; } .msds-ui input[type="checkbox"], .msds-ui input[type="radio"] { min-width: 18px; min-height: 18px; } .msds-ui th { white-space: nowrap; } }`;
    document.head.appendChild(style);
};
