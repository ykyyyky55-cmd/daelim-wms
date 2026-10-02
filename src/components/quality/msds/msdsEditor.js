// ==========================================
// 혼합물 MSDS 작성 편집기 (화면을 덮는 창)
// ==========================================
// CAS 번호와 함유량을 넣으면 물질 정보를 조회하고(services/ghs/chemSubstances.js), 고시 별표 1의 혼합물 분류방법으로
// 분류·경고표지 항목을 계산해(services/ghs/mixtureClassify.js) 별표 4의 16개 항목 본문을 만든다(services/ghs/msdsBuild.js).
// - 창은 본문 밖(body)에 붙인다: 다른 기기의 재고 변경으로 화면이 다시 그려져도 작성 중인 내용이 남는다.
// - 입력은 바로 문서(doc)에 반영하고, 계산 결과로 바뀌는 부분(요약 줄·성분의 분류 칸·합계)만 다시 그린다 — 입력 칸은 다시 그리지 않아 커서가 유지된다.
// - 저장하지 않은 변경이 있으면 닫기·뒤로가기·창 닫기 때 확인한다.
import { esc } from '../../../services/html.js';
import { localDateStr } from '../../../services/searchUtils.js';
import { CONFIDENTIAL_CSS, confidentialHtml } from '../../../services/docMarks.js';
import { listQc, saveQc } from '../../../services/quality.js';
import { addAttachments, listAttachments, removeAttachment, canAttach } from '../../../services/attachments.js';
import { attachItemPicker } from '../../plans/planCommon.js';
import { GHS_CLASSES, GHS_GROUPS, GHS_NOTICE, MSDS_SECTIONS, PICTOGRAMS, SIGNALS, USE_CATEGORIES, classOf, catOf, clsLabel } from '../../../services/ghs/ghsTables.js';
import { ACUTE_ROUTES } from '../../../services/ghs/mixtureClassify.js';
import { emptyDoc, emptyComp, buildMsds, autoRange, versionText, DEFAULT_MEDIA, STATE_LABELS } from '../../../services/ghs/msdsBuild.js';
import { msdsHtml, labelHtml, basisHtml, openDocWindow, LABEL_SIZES } from '../../../services/ghs/msdsPrint.js';
import { pictogramSvg } from '../../../services/ghs/pictograms.js';
import { normCas, isValidCas, emptySubstance } from '../../../services/ghs/substanceParse.js';
import { getSubstanceMap, knownSubstances, lookupSubstance, saveSubstance } from '../../../services/ghs/chemSubstances.js';
import { saveMsdsDoc, saveSupplierDefault } from '../../../services/ghs/msdsDocs.js';
import { openSubstanceDialog } from './substanceDialog.js';
import { openDialog, refreshIcons, ensureMsdsStyle, clsChips, sourceBadge, INPUT, BTN, BTN_PRIMARY, BTN_SUB, BTN_MINI, CARD } from './msdsUi.js';

const HOST_ID = 'msds-editor-host';
const TABS = [['comp', '① 제품·구성성분', 'list-checks'], ['props', '② 물리·화학적 특성', 'thermometer'], ['cls', '③ 분류·경고표지', 'triangle-alert'], ['text', '④ 본문 (16개 항목)', 'file-text']];
const SHOW_OPTIONS = [['AUTO', '자동'], ['SHOW', '항상 적음'], ['SECRET', '대체자료'], ['HIDE', '적지 않음']];
/** 9항의 입력 칸: [문서 경로, 이름, 안내, 분류에 쓰는 값인지] */
const PROP_FIELDS = [
    ['props.color', '색', '예: 담황색 투명'], ['props.odor', '냄새', '예: 약한 석유 냄새'], ['props.odorThr', '냄새 역치', ''], ['props.ph', 'pH', '숫자', true],
    ['props.mp', '녹는점/어는점 (℃)', '유동점 등'], ['props.bp', '초기 끓는점 (℃)', '숫자', true], ['props.fp', '인화점 (℃)', '숫자', true], ['props.fpMethod', '인화점 시험방법', '예: COC, PMCC'],
    ['props.evap', '증발 속도', ''], ['props.flam', '인화성(고체, 기체)', '액체면 비워 둠'], ['props.limits', '인화·폭발 범위 상한/하한', ''], ['props.vp', '증기압', ''],
    ['props.sol', '용해도', '예: 물에 녹지 않음'], ['props.vd', '증기밀도', ''], ['props.sg', '비중', '예: 0.855 (15℃)'], ['props.kow', 'n-옥탄올/물 분배계수', ''],
    ['props.ait', '자연발화 온도 (℃)', ''], ['props.decomp', '분해 온도 (℃)', ''], ['props.kv40', '40℃ 동점도 (mm²/s)', '숫자', true], ['props.visc', '점도 (그 밖의 표기)', '예: 100℃ 10.5 mm²/s'], ['props.mw', '분자량', '혼합물이면 비워 둠']
];

let active = null; // 열려 있는 편집기 { requestClose, isDirty }

/** 편집기가 열려 있고 저장하지 않은 변경이 있는지 */
export const isMsdsEditorDirty = () => !!active?.isDirty();
/** 다른 화면으로 가기 전에: 편집기를 닫는다. 저장하지 않은 변경이 있어 사용자가 취소하면 false */
export const leaveMsdsEditor = () => (active ? active.requestClose() : true);
/** 로그아웃 등으로 바로 닫는다 (확인 없이 — 배합 자료가 화면에 남지 않게) */
export const forceCloseMsdsEditor = () => { active?.destroy(); };

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const setPath = (obj, path, value) => { const keys = path.split('.'); const last = keys.pop(); const target = keys.reduce((o, k) => (o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}), obj); target[last] = value; };
const fmtPct = (n) => String(Number(Number(n).toFixed(4)));

/** 저장된 문서를 지금 문서 모양으로 맞춘다 (빠진 칸은 기본값) */
const normalizeDoc = (source, supplierDefault) => {
    const base = emptyDoc();
    const src = source ? JSON.parse(JSON.stringify(source)) : {};
    const doc = { ...base, ...src, product: { ...base.product, ...(src.product || {}) }, supplier: { ...base.supplier, ...(src.supplier || {}) }, props: { ...base.props, ...(src.props || {}) }, rev: { ...base.rev, ...(src.rev || {}) } };
    doc.comps = (Array.isArray(src.comps) ? src.comps : []).map(c => ({ ...emptyComp(), ...c }));
    doc.physManual = Array.isArray(src.physManual) ? src.physManual : [];
    doc.overrides = src.overrides && typeof src.overrides === 'object' ? src.overrides : {};
    doc.organs = src.organs && typeof src.organs === 'object' ? src.organs : {};
    doc.texts = src.texts && typeof src.texts === 'object' ? src.texts : {};
    if (!source) {
        if (supplierDefault) doc.supplier = { ...doc.supplier, ...supplierDefault };
        doc.rev.firstDate = localDateStr();
        doc.rev.revDate = localDateStr();
        doc.comps = [emptyComp(), emptyComp(), emptyComp()];
    }
    return doc;
};

/**
 * 편집기를 연다.
 * @param {{ doc?: Object|null, supplierDefault?: Object|null, showToast?: (m: string) => void, onSaved?: (doc: Object) => void, onClosed?: () => void }} opt doc이 없으면 새 문서
 */
export const openMsdsEditor = async ({ doc: source = null, supplierDefault = null, showToast = () => {}, onSaved = () => {}, onClosed = () => {} } = {}) => {
    if (active) return;
    const doc = normalizeDoc(source, supplierDefault);
    let lib = new Map();
    try { lib = await getSubstanceMap(doc.comps.map(c => c.cas)); } catch (e) { showToast(e.message); return; }
    let tab = 'comp';
    let isDirty = false;
    let built = buildMsds(doc, lib);
    const busy = new Set(); // 조회 중인 성분 줄
    let isClosing = false;

    const host = document.createElement('div');
    host.id = HOST_ID;
    ensureMsdsStyle();
    host.className = 'msds-ui fixed inset-0 z-[48] bg-slate-100 overflow-y-auto no-print';
    host.innerHTML = `
    <div class="sm:sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm" id="me-head">
        <div class="max-w-[1400px] mx-auto px-3 sm:px-5 pt-2.5 pb-2 flex flex-wrap items-center gap-2">
            <button type="button" id="me-close" class="${BTN_SUB}" title="목록으로 돌아갑니다"><i data-lucide="arrow-left" class="w-4 h-4"></i><span class="hidden sm:inline">목록</span></button>
            <div class="min-w-0 flex-1 basis-48">
                <div class="hidden sm:block text-[11px] font-black text-emerald-700 truncate">품질관리 › MSDS관리 › 혼합물 MSDS 작성</div>
                <h2 id="me-title" class="text-base font-black text-slate-900 truncate"></h2>
            </div>
            <span id="me-dirty" class="text-[11px] font-bold"></span>
            <select id="me-status" class="${INPUT} !w-auto font-bold" title="작성 상태"><option value="DRAFT">작성 중</option><option value="FINAL">확정</option></select>
            <button type="button" id="me-save" class="${BTN_PRIMARY}"><i data-lucide="save" class="w-4 h-4"></i>저장</button>
            <button type="button" id="me-print" class="${BTN_SUB}" title="A4로 인쇄하거나 PDF로 저장합니다"><i data-lucide="printer" class="w-4 h-4 text-blue-600"></i><span class="hidden sm:inline">MSDS </span>인쇄</button>
            <button type="button" id="me-label" class="${BTN_SUB}" title="별표 3 양식의 경고표지"><i data-lucide="tag" class="w-4 h-4 text-rose-600"></i>경고표지</button>
            <button type="button" id="me-basis" class="${BTN_SUB}" title="정확한 함유량과 분류 근거 (사내 보관용)"><i data-lucide="calculator" class="w-4 h-4 text-slate-500"></i><span class="hidden sm:inline">분류 </span>근거</button>
            <button type="button" id="me-publish" class="${BTN} bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100" title="발행본(함유량은 범위로)을 MSDS 대장에 올려 모두가 볼 수 있게 합니다"><i data-lucide="upload" class="w-4 h-4"></i><span class="hidden sm:inline">MSDS </span>대장에 등록</button>
        </div>
        <div class="max-w-[1400px] mx-auto px-3 sm:px-5 pb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div class="flex gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto max-w-full" id="me-tabs">${TABS.map(([k, l, ic]) => `<button type="button" data-tab="${k}" class="px-3 py-1.5 rounded-lg text-xs font-black whitespace-nowrap flex items-center gap-1.5"><i data-lucide="${ic}" class="w-3.5 h-3.5"></i>${l}</button>`).join('')}</div>
            <div id="me-summary" class="flex flex-wrap items-center gap-2 text-xs min-h-[34px]"></div>
        </div>
    </div>
    <div id="me-body" class="max-w-[1400px] mx-auto p-3 sm:p-5 space-y-4 pb-24"></div>`;
    document.body.appendChild(host);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const $ = (s) => host.querySelector(s);
    const $$ = (s) => [...host.querySelectorAll(s)];
    const body = $('#me-body');

    // ---------- 요약 줄 · 제목 ----------
    const paintHead = () => {
        $('#me-title').textContent = doc.product.name || '(제품명 없음)';
        $('#me-dirty').innerHTML = isDirty ? '<span class="text-amber-600">● 저장 안 됨</span>' : doc.id ? '<span class="text-emerald-600">저장됨</span>' : '<span class="text-slate-400">새 문서</span>';
        $('#me-status').value = doc.status === 'FINAL' ? 'FINAL' : 'DRAFT';
        const { label, result, warnings } = built;
        $('#me-summary').innerHTML = `
            <span class="flex items-center gap-1">${label.pictograms.length ? label.pictograms.map(c => `<span title="${esc(PICTOGRAMS[c])}" class="leading-none">${pictogramSvg(c, 30)}</span>`).join('') : '<span class="text-slate-400">그림문자 없음</span>'}</span>
            <span class="px-2 py-1 rounded-lg font-black ${label.signal === 'DANGER' ? 'bg-rose-600 text-white' : label.signal === 'WARNING' ? 'bg-amber-400 text-white' : 'bg-slate-200 text-slate-600'}">${label.signal ? SIGNALS[label.signal] : '신호어 없음'}</span>
            <span class="text-slate-600">분류 <b class="text-slate-900">${result.classes.length}</b>개</span>
            <span class="text-slate-600">성분 합 <b class="${Math.abs(result.totalPct - 100) > 0.5 ? 'text-rose-600' : 'text-slate-900'}">${fmtPct(result.totalPct)}%</b></span>
            ${warnings.length ? `<button type="button" data-goto="cls" class="px-2 py-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 font-bold">확인할 점 ${warnings.length}건</button>` : ''}`;
        $$('#me-tabs [data-tab]').forEach(b => { b.className = `px-3 py-1.5 rounded-lg text-xs font-black whitespace-nowrap flex items-center gap-1.5 ${b.dataset.tab === tab ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`; });
    };
    const recompute = () => { built = buildMsds(doc, lib); };
    /** 문서가 바뀌었다: 다시 계산하고 계산 결과가 보이는 곳만 다시 그린다 */
    const touch = ({ repaint = true } = {}) => {
        isDirty = true;
        recompute();
        paintHead();
        if (!repaint) return;
        if (tab === 'comp') paintCompDerived();
        else if (tab === 'cls') renderCls();
    };

    // ---------- ① 제품·구성성분 ----------
    const field = (path, label, { placeholder = '', type = 'text', cls = '', hint = '', attrs = '' } = {}) => `
        <label class="block ${cls}"><span class="font-bold text-slate-600">${label}</span>
            <input type="${type}" data-f="${path}" value="${esc(getPath(doc, path) ?? '')}" placeholder="${esc(placeholder)}" class="${INPUT} mt-0.5" ${attrs}>${hint ? `<span class="text-[10px] text-slate-400">${hint}</span>` : ''}</label>`;

    const infoCellHtml = (c, i) => {
        if (busy.has(c)) return '<span class="text-blue-600 font-bold"><span class="inline-block w-3 h-3 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin align-middle mr-1"></span>조회 중…</span>';
        const r = built.comps[i];
        const sub = c.cas ? lib.get(c.cas) : null;
        const key = c.own ? 'DOC' : sub ? (sub.source || 'MANUAL') : 'NONE';
        const hasRecord = !!sub || c.own;
        const clsHtml = r?.cls?.length ? clsChips(r.cls) : hasRecord ? `<span class="text-[11px] ${r?.unknown ? 'text-rose-600 font-bold' : 'text-slate-500'}">${r?.unknown ? '유해성 자료 없음(미상)' : '분류되지 않음'}</span>` : '';
        return `<div class="flex flex-wrap items-center gap-1">${sourceBadge(key)}
                ${r?.listed ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-black bg-blue-100 text-blue-800" title="MSDS 3항에 적는 성분">3항 기재</span>' : r?.reportable ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-black bg-rose-600 text-white" title="분류기준에 해당하고 한계농도 이상인데 적지 않기로 한 성분">기재 대상인데 숨김</span>' : ''}</div>
            <div class="mt-1">${clsHtml}</div>
            <div class="flex flex-wrap gap-1 mt-1">
                ${isValidCas(c.cas) && !sub ? `<button type="button" data-act="lookup" class="${BTN_MINI} !text-blue-700">조회</button>` : ''}
                <button type="button" data-act="edit" class="${BTN_MINI}">${hasRecord ? '분류 편집' : '직접 입력'}</button>
                ${!hasRecord ? `<button type="button" data-act="nohaz" class="${BTN_MINI}" title="물처럼 유해성 분류에 해당하지 않는 성분">유해성 없음</button>` : ''}
            </div>`;
    };
    const dispCellHtml = (c) => (c.show === 'SECRET' ? `
        <div class="space-y-1">
            <input data-sk="name" value="${esc(c.secret?.name || '')}" placeholder="대체명칭" class="${INPUT}">
            <input data-sk="pct" value="${esc(c.secret?.pct || '')}" placeholder="대체함유량 (예: 10 – 30)" class="${INPUT}">
            <input data-sk="approval" value="${esc(c.secret?.approval || '')}" placeholder="승인번호" class="${INPUT}">
            <input data-sk="until" value="${esc(c.secret?.until || '')}" placeholder="유효기간 (예: 2031-10-01)" class="${INPUT}">
        </div>` : `<input data-ck="disp" value="${esc(c.disp || '')}" placeholder="${esc(autoRange(c.pct) || '자동')}" class="${INPUT} text-center" title="비워 두면 ±5%P 범위로 자동 표시">`);
    const compRowHtml = (c, i) => `
        <tr data-i="${i}" class="border-t border-slate-100 align-top">
            <td class="p-1.5 text-center text-slate-400 font-bold">${i + 1}</td>
            <td class="p-1"><input data-ck="cas" value="${esc(c.cas || '')}" placeholder="예: 107-21-1" class="${INPUT} font-mono" autocomplete="off" list="me-cas-list"></td>
            <td class="p-1"><input data-ck="name" value="${esc(c.name || '')}" placeholder="${esc(lib.get(c.cas)?.nameKo || lib.get(c.cas)?.nameEn || '물질명')}" class="${INPUT} font-bold"></td>
            <td class="p-1"><input type="number" step="any" min="0" max="100" data-ck="pct" value="${esc(c.pct ?? '')}" class="${INPUT} text-right font-black"></td>
            <td class="p-1.5" data-cell="info">${infoCellHtml(c, i)}</td>
            <td class="p-1"><select data-ck="show" class="${INPUT}">${SHOW_OPTIONS.map(([k, l]) => `<option value="${k}" ${(c.show || 'AUTO') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
            <td class="p-1" data-cell="disp">${dispCellHtml(c)}</td>
            <td class="p-1 text-center"><button type="button" data-act="del" class="text-rose-500 font-black px-2 py-1" title="이 성분 지우기">×</button></td>
        </tr>`;
    const totalHtml = () => {
        const total = built.result.totalPct;
        const off = Math.abs(total - 100) > 0.5;
        return `<td colspan="3" class="p-2 text-right font-bold text-slate-600">함유량 합계</td>
            <td class="p-2 text-right font-black ${off ? 'text-rose-600' : 'text-emerald-700'}">${fmtPct(total)}%</td>
            <td colspan="4" class="p-2 text-[11px] ${off ? 'text-rose-600 font-bold' : 'text-slate-500'}">${off ? '합이 100%가 되어야 합니다 (물·기유처럼 분류되지 않는 성분도 넣으세요).' : `3항에 적는 성분 ${built.s3.length}개 · 분류기준에 해당하는 성분만 한계농도 이상일 때 적습니다.`}</td>`;
    };
    /** 성분 표에서 계산 결과로 바뀌는 칸만 다시 그린다 (입력 칸은 그대로) */
    const paintCompDerived = () => {
        $$('#me-comps tr[data-i]').forEach(tr => {
            const i = Number(tr.dataset.i), c = doc.comps[i];
            if (!c) return;
            tr.querySelector('[data-cell="info"]').innerHTML = infoCellHtml(c, i);
            const disp = tr.querySelector('[data-ck="disp"]');
            if (disp) disp.placeholder = autoRange(c.pct) || '자동';
        });
        const foot = $('#me-total');
        if (foot) foot.innerHTML = totalHtml();
    };
    const renderComp = () => {
        // 제안 목록: 물질 정보(라이브러리)에 저장된 물질 모두 + 이 문서에서 받은 물질
        const known = new Map(knownSubstances().map(s => [s.cas, s]));
        lib.forEach((s, cas) => known.set(cas, s));
        body.innerHTML = `
        <div class="grid lg:grid-cols-3 gap-4">
            <div class="${CARD} lg:col-span-2 space-y-2 text-xs min-w-0">
                <h3 class="font-black text-slate-900 text-sm">1. 제품 정보</h3>
                <div class="grid sm:grid-cols-2 gap-2">
                    <label class="block sm:col-span-2"><span class="font-bold text-slate-600">제품명 * <span class="font-normal text-slate-400">(경고표지에 쓰는 이름과 같게 — 품목을 검색해 고를 수 있습니다)</span></span>
                        <input id="me-product" data-f="product.name" value="${esc(doc.product.name)}" class="${INPUT} mt-0.5 font-bold" autocomplete="off"><span id="me-item-code" class="text-[10px] font-mono text-blue-600">${esc(doc.product.itemCode || '')}</span></label>
                    <label class="block"><span class="font-bold text-slate-600">용도분류 <span class="font-normal text-slate-400">(별표 5)</span></span>
                        <select data-f="product.useNo" class="${INPUT} mt-0.5"><option value="">선택</option>${USE_CATEGORIES.map(u => `<option value="${u.no}" ${doc.product.useNo === u.no ? 'selected' : ''}>${u.no.includes('.') ? '　' : ''}${u.no}. ${esc(u.name)}</option>`).join('')}</select></label>
                    ${field('product.useText', '권고 용도 (설명)', { placeholder: '예: 자동차 엔진 윤활' })}
                    ${field('product.limit', '사용상의 제한', { placeholder: '비워 두면: 권고 용도 외에는 사용하지 마시오.', cls: 'sm:col-span-2' })}
                    ${field('product.msdsNo', 'MSDS 번호', { placeholder: '공단 제출 뒤 받은 번호', hint: '첫 쪽 머리글(제품명 아래)에 적힙니다', cls: 'sm:col-span-2' })}
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:col-span-2">
                        ${field('rev.firstDate', '최초 작성일', { type: 'date' })}
                        ${field('rev.revDate', '최종 개정일', { type: 'date' })}
                        ${field('rev.prevDate', '이전 개정일 <span class="font-normal text-slate-400">(없으면 비움)</span>', { type: 'date' })}
                    </div>
                    <div class="grid grid-cols-3 gap-2 sm:col-span-2 items-end">
                        ${field('rev.no', '버전 <span class="font-normal text-slate-400">(개정 번호: 1 → 1.0)</span>', { placeholder: '1' })}
                        ${field('rev.count', '개정 횟수', { type: 'number', attrs: 'min="0" step="1"' })}
                        <button type="button" data-act="rev-up" class="${BTN_SUB} justify-center" title="버전·개정 횟수를 1 올리고, 지금의 최종 개정일을 이전 개정일로 옮긴 뒤 개정일을 오늘로"><i data-lucide="history" class="w-3.5 h-3.5"></i>개정 +1</button>
                    </div>
                </div>
            </div>
            <div class="${CARD} space-y-2 text-xs min-w-0">
                <h3 class="font-black text-slate-900 text-sm">공급자 정보</h3>
                ${field('supplier.company', '회사명 *')}
                ${field('supplier.address', '주소')}
                ${field('supplier.phone', '긴급전화번호 *', { placeholder: '예: 031-000-0000' })}
                ${field('supplier.fax', '팩스', { placeholder: '적으면 MSDS 1항에 함께 인쇄' })}
                <button type="button" data-act="save-supplier" class="${BTN_SUB} w-full justify-center" title="새 문서를 만들 때 이 값으로 미리 채웁니다">이 값을 기본값으로 저장</button>
            </div>
        </div>
        <div class="${CARD} text-xs">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div><h3 class="font-black text-slate-900 text-sm">2. 구성성분 (CAS 번호 · 함유량)</h3>
                    <p class="text-[11px] text-slate-500">CAS 번호를 넣고 칸을 벗어나면 물질 정보를 자동으로 조회합니다. 조회한 분류는 참고 자료이니 공급사 MSDS와 다르면 [분류 편집]으로 고치세요.</p></div>
                <div class="flex flex-wrap gap-1.5">
                    <button type="button" data-act="add" class="${BTN_SUB}"><i data-lucide="plus" class="w-3.5 h-3.5"></i>성분 추가</button>
                    <button type="button" data-act="paste" class="${BTN_SUB}" title="CAS 번호와 함유량을 여러 줄로 붙여 넣습니다"><i data-lucide="clipboard-paste" class="w-3.5 h-3.5"></i>여러 줄 붙여넣기</button>
                    <button type="button" data-act="from-msds" class="${BTN_SUB}" title="원료 MSDS 대장에 등록된 원료의 CAS 번호로 추가"><i data-lucide="flask-conical" class="w-3.5 h-3.5"></i>원료 MSDS에서</button>
                    <button type="button" data-act="lookup-all" class="${BTN_SUB}"><i data-lucide="search" class="w-3.5 h-3.5 text-blue-600"></i>모두 조회</button>
                </div>
            </div>
            <div class="overflow-x-auto"><table class="w-full text-xs min-w-[1020px]">
                <thead class="bg-slate-50 text-slate-600"><tr>
                    <th class="p-2 w-8">No</th><th class="p-2 text-left w-[130px]">CAS 번호</th><th class="p-2 text-left w-[200px]">물질명</th><th class="p-2 text-right w-[90px]">함유량(%)</th>
                    <th class="p-2 text-left">물질 정보 (분류)</th><th class="p-2 text-left w-[96px]" title="MSDS 3항(구성성분)에 적을지">3항 표시</th><th class="p-2 text-left w-[150px]" title="비워 두면 ±5%P 범위로 자동">표시 함유량</th><th class="p-2 w-8"></th></tr></thead>
                <tbody id="me-comps">${doc.comps.map(compRowHtml).join('')}</tbody>
                <tfoot><tr id="me-total" class="border-t-2 border-slate-200 bg-slate-50/60">${totalHtml()}</tr></tfoot>
            </table></div>
            <datalist id="me-cas-list">${[...known.values()].map(s => `<option value="${esc(s.cas)}">${esc(s.nameKo || s.nameEn || '')}</option>`).join('')}</datalist>
            <p class="text-[11px] text-slate-500 mt-2">※ <b>3항 표시</b> — 자동: 분류기준에 해당하고 한계농도(별표 6) 이상이면 적음 · 대체자료: 영업비밀로 승인받은 대체명칭·대체함유량을 적음(승인번호·유효기간 필요) · 적지 않음: 분류기준에 해당하지 않는 성분.</p>
        </div>`;
        const input = $('#me-product');
        attachItemPicker(input, (it) => {
            doc.product.name = it.name; doc.product.itemCode = it.code;
            input.value = it.name; $('#me-item-code').textContent = it.code;
            touch();
        }, (m) => ['완제품', '원액', '반제품'].includes(m.category));
        refreshIcons();
    };

    /** 성분 한 줄의 물질 정보를 조회한다 */
    const lookupRow = async (c, { force = false, quiet = false } = {}) => {
        const cas = normCas(c.cas);
        if (!isValidCas(cas)) { if (!quiet) showToast(cas ? `${cas}: CAS 번호가 올바르지 않습니다 (검증 숫자가 맞지 않음).` : 'CAS 번호를 넣으세요.'); return false; }
        c.cas = cas;
        busy.add(c);
        if (tab === 'comp') paintCompDerived();
        try {
            const res = await lookupSubstance(cas, { force });
            if (res.from !== 'NONE') {
                lib.set(cas, res.sub);
                if (!c.name) c.name = res.sub.nameKo || res.sub.nameEn || '';
            }
            if (!quiet) {
                const where = { LIBRARY: '저장된 물질 정보', KOSHA: '안전보건공단', PUBCHEM: 'PubChem' }[res.from];
                showToast(res.from === 'NONE' ? `${cas}: 자동으로 찾지 못했습니다 — [직접 입력]으로 공급사 MSDS의 분류를 넣으세요. ${res.notes.join(' ')}`
                    : `${cas} ${res.sub.nameKo || res.sub.nameEn || ''} — ${where}에서 받았습니다.${res.from === 'LIBRARY' ? '' : ` ${res.notes.join(' ')}`}`);
            }
            return res.from !== 'NONE';
        } catch (e) {
            if (!quiet) showToast(e.message);
            return false;
        } finally {
            busy.delete(c);
            if (tab === 'comp') {
                const tr = host.querySelector(`#me-comps tr[data-i="${doc.comps.indexOf(c)}"]`);
                const nameInput = tr?.querySelector('[data-ck="name"]');
                if (nameInput && !nameInput.value && c.name) nameInput.value = c.name;
            }
            touch();
        }
    };
    const lookupMany = async (list) => {
        let ok = 0;
        for (const c of list) if (await lookupRow(c, { quiet: true })) ok += 1;
        showToast(`물질 정보 조회: ${list.length}개 중 ${ok}개를 받았습니다.${ok < list.length ? ' 나머지는 [직접 입력]으로 분류를 넣으세요.' : ''}`);
    };
    const editRow = (c) => {
        const cas = normCas(c.cas);
        const sub = (cas && lib.get(cas)) || { ...emptySubstance(cas), nameKo: c.name || '' };
        openSubstanceDialog({
            sub, comp: c, showToast,
            onSave: async ({ scope, sub: edited }) => {
                if (scope === 'LIB') {
                    const saved = await saveSubstance(edited);
                    lib.set(saved.cas, saved);
                    Object.assign(c, { cas: saved.cas, own: false });
                    delete c.cls; delete c.ate; delete c.m; delete c.unknown; delete c.nonAdditive;
                    if (!c.name) c.name = saved.nameKo || saved.nameEn || '';
                    showToast(`물질 정보를 저장했습니다 (${saved.cas}) — 이 물질을 쓰는 모든 문서에 적용됩니다.`);
                } else {
                    Object.assign(c, { own: true, cls: edited.cls, ate: edited.ate, m: edited.m, unknown: !!edited.unknown, nonAdditive: !!edited.nonAdditive });
                    if (!c.name) c.name = edited.nameKo || edited.nameEn || '';
                    showToast('이 문서에서만 쓰는 분류로 저장했습니다.');
                }
                if (tab === 'comp') renderComp();
                touch();
            }
        });
    };
    const openPaste = () => {
        const dlg = openDialog({
            title: '성분 여러 줄 붙여넣기', sub: '엑셀에서 CAS 번호 · 함유량(%) 두 칸을 복사해 붙여 넣으세요', maxW: 'max-w-xl', icon: 'clipboard-paste',
            bodyHtml: `<textarea id="pd-text" rows="10" class="${INPUT} font-mono" placeholder="64742-54-7	78.5&#10;68649-42-3	1.2&#10;물	5"></textarea>
                <p class="text-[11px] text-slate-500">한 줄에 성분 하나. CAS 번호가 없는 성분은 이름을 적으세요 (예: 물 5). 이름을 함께 넣어도 됩니다 (CAS · 이름 · 함유량).</p>`,
            footHtml: `<button type="button" data-dlg-close class="${BTN_SUB}">닫기</button><button type="button" id="pd-ok" class="${BTN_PRIMARY}">넣기</button>`
        });
        dlg.$('#pd-ok').addEventListener('click', () => {
            const rows = dlg.$('#pd-text').value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
                const cells = line.split(/\t|,|;|\s{2,}/).map(s => s.trim()).filter(Boolean);
                const parts = cells.length > 1 ? cells : line.split(/\s+/);
                const cas = parts.find(p => /^\d{2,7}-\d{2}-\d$/.test(p)) || '';
                const pctText = [...parts].reverse().find(p => /^\d+(\.\d+)?%?$/.test(p) && p !== cas) || '';
                const name = parts.filter(p => p !== cas && p !== pctText).join(' ');
                return { ...emptyComp(), cas, name, pct: pctText ? Number(pctText.replace('%', '')) : '' };
            }).filter(r => r.cas || r.name);
            if (!rows.length) { showToast('읽을 수 있는 줄이 없습니다.'); return; }
            doc.comps = [...doc.comps.filter(c => c.cas || c.name || c.pct), ...rows];
            dlg.close();
            renderComp();
            touch();
            lookupMany(rows.filter(r => r.cas && !lib.get(r.cas)));
        });
    };
    const openFromMsds = async () => {
        let records;
        try { records = (await listQc('MSDS')).filter(m => /\d{2,7}-\d{2}-\d/.test(m.casNo || '')); } catch (e) { showToast(e.message); return; }
        if (!records.length) { showToast('MSDS 대장에 CAS 번호가 적힌 원료가 없습니다.'); return; }
        const dlg = openDialog({
            title: '원료 MSDS 대장에서 성분 추가', sub: 'CAS 번호가 적힌 MSDS만 보입니다', maxW: 'max-w-2xl', icon: 'flask-conical',
            bodyHtml: `<input type="search" id="fm-q" placeholder="품목 · 물질명 · CAS 검색" class="${INPUT}">
                <div id="fm-list" class="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[52vh] overflow-y-auto"></div>`,
            footHtml: `<button type="button" data-dlg-close class="${BTN_SUB}">닫기</button>`
        });
        const paint = () => {
            const q = dlg.$('#fm-q').value.trim().toLowerCase();
            const list = records.filter(m => !q || `${m.itemName} ${m.substance} ${m.casNo} ${m.supplier}`.toLowerCase().includes(q)).slice(0, 80);
            dlg.$('#fm-list').innerHTML = list.length ? list.map(m => `<button type="button" data-id="${esc(m.id)}" class="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-2">
                <span class="min-w-0"><b class="text-slate-800">${esc(m.itemName || m.substance || '')}</b> <span class="text-slate-500">${esc(m.substance && m.substance !== m.itemName ? m.substance : '')}</span>
                    <span class="block font-mono text-[11px] text-blue-700">${esc(m.casNo)}</span></span><span class="text-blue-600 font-bold shrink-0">＋ 추가</span></button>`).join('') : '<p class="p-4 text-center text-slate-400">찾는 원료가 없습니다.</p>';
        };
        paint();
        dlg.$('#fm-q').addEventListener('input', paint);
        dlg.$('#fm-list').addEventListener('click', (e) => {
            const b = e.target.closest('[data-id]');
            if (!b) return;
            const m = records.find(x => x.id === b.dataset.id);
            const casList = [...new Set((m.casNo.match(/\d{2,7}-\d{2}-\d/g) || []).map(normCas))].filter(isValidCas);
            const rows = casList.filter(cas => !doc.comps.some(c => c.cas === cas)).map(cas => ({ ...emptyComp(), cas, name: casList.length === 1 ? (m.substance || m.itemName || '') : '' }));
            if (!rows.length) { showToast('이미 넣은 성분입니다.'); return; }
            doc.comps = [...doc.comps.filter(c => c.cas || c.name || c.pct), ...rows];
            showToast(`${m.itemName || m.substance}: 성분 ${rows.length}개를 넣었습니다. 함유량을 입력하세요.`);
            renderComp();
            touch();
            lookupMany(rows.filter(r => !lib.get(r.cas)));
        });
    };

    // ---------- ② 물리·화학적 특성 ----------
    const physOptions = () => GHS_CLASSES.filter(c => c.group === 'PHYS').map(c => `<option value="${c.key}">${esc(c.label)}</option>`).join('');
    const renderProps = () => {
        body.innerHTML = `
        <div class="${CARD} text-xs space-y-3">
            <div><h3 class="font-black text-slate-900 text-sm">9. 물리화학적 특성 (제품 전체의 값)</h3>
                <p class="text-[11px] text-slate-500">비워 둔 칸은 MSDS에 '자료 없음'으로 적힙니다. <span class="px-1 rounded bg-blue-100 text-blue-800 font-bold">분류</span> 표시가 있는 값은 분류 계산에 쓰입니다 — 인화점·초기 끓는점 → 인화성 액체, 40℃ 동점도 → 흡인 유해성, pH → 부식성.</p></div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                <label class="block"><span class="font-bold text-slate-600">물리적 상태 <span class="px-1 rounded bg-blue-100 text-blue-800 font-bold">분류</span></span>
                    <select data-f="props.state" class="${INPUT} mt-0.5">${Object.entries(STATE_LABELS).map(([k, l]) => `<option value="${k}" ${doc.props.state === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                ${PROP_FIELDS.map(([path, label, ph, isCls]) => `<label class="block"><span class="font-bold text-slate-600">${label}${isCls ? ' <span class="px-1 rounded bg-blue-100 text-blue-800 font-bold">분류</span>' : ''}</span>
                    <input data-f="${path}" value="${esc(getPath(doc, path) ?? '')}" placeholder="${esc(ph)}" class="${INPUT} mt-0.5" ${isCls ? 'inputmode="decimal"' : ''}><span class="text-[10px] text-rose-600 hidden" data-numwarn="${path}">숫자만 넣어야 분류에 쓰입니다</span></label>`).join('')}
            </div>
            <div class="grid md:grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" data-f="props.waterSoluble" ${doc.props.waterSoluble ? 'checked' : ''}> <span><b>수용성 액체</b> <span class="text-slate-500">(위험물안전관리법 석유류 구분의 지정수량이 달라집니다)</span></span></label>
                <label class="block"><span class="font-bold text-slate-600">적절한 소화제 <span class="font-normal text-slate-400">(5항 · 예방조치문구 P378)</span></span>
                    <input data-f="media" value="${esc(doc.media || '')}" placeholder="${esc(DEFAULT_MEDIA)}" class="${INPUT} mt-0.5"></label>
            </div>
        </div>
        <div class="${CARD} text-xs space-y-2">
            <div><h3 class="font-black text-slate-900 text-sm">물리적 위험성 직접 지정</h3>
                <p class="text-[11px] text-slate-500">인화성 액체는 인화점으로 자동 판정합니다. 에어로졸·고압가스·산화성·금속부식성 등 제품 시험으로 정하는 분류는 여기서 넣으세요.</p></div>
            <div id="me-phys" class="flex flex-wrap gap-1.5"></div>
            <div class="flex flex-wrap items-center gap-1.5">
                <select id="me-phys-c" class="${INPUT} !w-auto">${physOptions()}</select><select id="me-phys-k" class="${INPUT} !w-auto"></select>
                <button type="button" data-act="phys-add" class="${BTN_MINI}">＋ 추가</button>
            </div>
        </div>`;
        paintPhys();
        syncPhysCats();
        PROP_FIELDS.filter(f => f[3]).forEach(([path]) => checkNumber(path));
        refreshIcons();
    };
    const paintPhys = () => {
        const el = $('#me-phys');
        if (!el) return;
        el.innerHTML = doc.physManual.length ? doc.physManual.map((e, i) => `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-orange-200 bg-orange-50 text-orange-900 font-bold">${esc(clsLabel(e))}<button type="button" data-act="phys-del" data-i="${i}" class="text-rose-500 font-black">×</button></span>`).join('') : '<span class="text-slate-400">직접 지정한 물리적 위험성이 없습니다.</span>';
    };
    const syncPhysCats = () => { const c = $('#me-phys-c'); if (c) $('#me-phys-k').innerHTML = classOf(c.value).cats.map(ct => `<option value="${ct.k}">${esc(ct.label)}</option>`).join(''); };
    const checkNumber = (path) => {
        const v = String(getPath(doc, path) ?? '').trim();
        const warn = host.querySelector(`[data-numwarn="${path}"]`);
        if (warn) warn.classList.toggle('hidden', !v || Number.isFinite(Number(v)));
    };

    // ---------- ③ 분류·경고표지 ----------
    const renderCls = () => {
        const { result, label, warnings } = built;
        const found = (c) => result.classes.filter(x => x.c === c);
        const row = (cl) => {
            const list = found(cl.key);
            const ov = doc.overrides[cl.key];
            const sel = `<select data-ov="${cl.key}" class="${INPUT} !w-auto ${ov?.k ? 'border-amber-400 bg-amber-50 font-bold' : ''}">
                <option value="">자동 계산</option><option value="NONE" ${ov?.k === 'NONE' ? 'selected' : ''}>분류 안 함</option>
                ${cl.cats.map(ct => `<option value="${ct.k}" ${ov?.k === ct.k ? 'selected' : ''}>${esc(ct.label)}</option>`).join('')}</select>`;
            return `<tr class="border-t border-slate-100 align-top ${list.length ? '' : 'text-slate-400'}">
                <td class="p-2 font-bold ${list.length ? 'text-slate-800' : ''}">${esc(cl.label)}</td>
                <td class="p-2">${list.length ? list.map(x => `<span class="inline-block px-1.5 py-0.5 mr-1 mb-0.5 rounded bg-rose-100 text-rose-800 font-black">${esc(catOf(x.c, x.k)?.label || x.k)}${x.form ? ` · ${esc(ACUTE_ROUTES[{ GAS: 'gas', VAPOR: 'vapor', DUST: 'dust' }[x.form]]?.label.replace('흡입', '').replace(/[()]/g, '') || '')}` : ''}</span>`).join('') : '분류되지 않음'}</td>
                <td class="p-2 text-[11px] text-slate-600">${list.map(x => esc(x.basis)).join('<br>')}</td>
                <td class="p-2">${sel}${ov?.k ? `<input data-ovr="${cl.key}" value="${esc(ov.reason || '')}" placeholder="근거 (예: 제품 시험 결과)" class="${INPUT} mt-1">` : ''}
                    ${(cl.key === 'STOT_SE' || cl.key === 'STOT_RE') && list.some(x => !/^3/.test(x.k)) ? `<input data-org="${cl.key}" value="${esc(doc.organs[cl.key] || '')}" placeholder="표적장기 (예: 중추신경계, 신장)" class="${INPUT} mt-1" title="유해·위험 문구의 '장기(○○)'에 들어갑니다">` : ''}</td></tr>`;
        };
        const group = (g) => `<tr class="bg-slate-100"><td colspan="4" class="px-2 py-1.5 font-black text-slate-700">${GHS_GROUPS[g]}</td></tr>${GHS_CLASSES.filter(c => c.group === g && (g !== 'PHYS' || found(c.key).length || doc.overrides[c.key])).map(row).join('') || '<tr><td colspan="4" class="p-2 text-slate-400">해당하는 분류 없음 (인화점을 넣거나 ② 탭에서 직접 지정)</td></tr>'}`;
        const pList = (title, list) => `<div><div class="font-bold text-slate-600">${title}</div>${list.length ? `<ul class="list-disc pl-4 space-y-0.5">${list.map(x => `<li><b class="font-mono text-slate-500">${esc(x.code)}</b> ${esc(x.text)}</li>`).join('')}</ul>` : '<span class="text-slate-400">해당 없음</span>'}</div>`;
        const ateRows = result.ate.filter(r => r.terms.length);
        body.innerHTML = `
        ${warnings.length || result.notes.some(n => n.level === 'info') ? `<div class="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs space-y-1">
            <b class="text-amber-900 flex items-center gap-1.5"><i data-lucide="triangle-alert" class="w-4 h-4"></i>확인할 점</b>
            <ul class="list-disc pl-5 space-y-0.5 text-amber-900">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}${result.notes.filter(n => n.level === 'info').map(n => `<li class="text-slate-600">${esc(n.text)}</li>`).join('')}</ul></div>` : ''}
        <div class="grid xl:grid-cols-5 gap-4">
            <div class="${CARD} xl:col-span-3 text-xs min-w-0">
                <h3 class="font-black text-slate-900 text-sm">혼합물의 유해성·위험성 분류 <span class="font-normal text-slate-500 text-[11px]">— 구성성분 자료로 계산 (${esc(GHS_NOTICE)} 별표 1)</span></h3>
                <p class="text-[11px] text-slate-500 mb-2">제품 전체로 시험한 자료가 있으면 그 결과가 우선입니다 — [직접 지정]에서 구분을 고르고 근거를 적으세요.</p>
                <div class="overflow-x-auto"><table class="w-full text-xs min-w-[640px]">
                    <thead class="bg-slate-50 text-slate-600"><tr><th class="p-2 text-left w-[26%]">분류</th><th class="p-2 text-left w-[16%]">결과</th><th class="p-2 text-left">근거</th><th class="p-2 text-left w-[24%]">직접 지정</th></tr></thead>
                    <tbody>${group('PHYS')}${group('HEALTH')}${group('ENV')}</tbody></table></div>
                ${ateRows.length ? `<details class="mt-3 text-[11px]"><summary class="cursor-pointer font-bold text-blue-700">급성 독성 계산 내역 (ATEmix)</summary>
                    <div class="overflow-x-auto"><table class="w-full mt-1 min-w-[520px]"><thead class="bg-slate-50"><tr><th class="p-1.5 text-left">경로</th><th class="p-1.5 text-left">성분 (함유량 ÷ ATE)</th><th class="p-1.5 text-right">ATEmix</th><th class="p-1.5 text-center">구분</th></tr></thead>
                    <tbody>${ateRows.map(r => `<tr class="border-t border-slate-100"><td class="p-1.5 font-bold">${ACUTE_ROUTES[r.route].label}</td><td class="p-1.5">${r.terms.map(t => `${esc(t.name)} ${fmtPct(t.pct)}% ÷ ${fmtPct(t.ate)} <span class="text-slate-400">(${t.from})</span>`).join(' + ')}${r.unknownPct > 10 ? ` · 미상 성분 ${fmtPct(r.unknownPct)}% 제외` : ''}</td>
                        <td class="p-1.5 text-right font-mono">${r.ateMix ? `${fmtPct(r.ateMix)} ${ACUTE_ROUTES[r.route].unit}` : '-'}</td><td class="p-1.5 text-center font-bold">${r.cat ? `구분 ${r.cat}` : '분류 안 됨'}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
            </div>
            <div class="${CARD} xl:col-span-2 text-xs space-y-2 min-w-0">
                <h3 class="font-black text-slate-900 text-sm">경고표지 항목 <span class="font-normal text-slate-500 text-[11px]">— MSDS 2항 나.</span></h3>
                <div class="flex flex-wrap items-center gap-2">${label.pictograms.length ? label.pictograms.map(c => `<span title="${esc(PICTOGRAMS[c])}" class="leading-none">${pictogramSvg(c, 64)}</span>`).join('') : '<span class="text-slate-400">그림문자 없음</span>'}
                    <span class="ml-auto px-3 py-1.5 rounded-xl text-base font-black ${label.signal === 'DANGER' ? 'bg-rose-600 text-white' : label.signal === 'WARNING' ? 'bg-amber-400 text-white' : 'bg-slate-200 text-slate-600'}">${label.signal ? SIGNALS[label.signal] : '신호어 없음'}</span></div>
                <div><div class="font-bold text-slate-600">유해·위험 문구</div>${label.h.length ? `<ul class="list-disc pl-4 space-y-0.5">${label.h.map(x => `<li><b class="font-mono text-slate-500">${esc(x.code)}</b> ${esc(x.text)}</li>`).join('')}</ul>` : '<span class="text-slate-400">해당 없음</span>'}</div>
                ${pList('예방조치 문구 — 예방', label.p.prev)}${pList('예방조치 문구 — 대응', label.p.resp)}${pList('예방조치 문구 — 저장', label.p.stor)}${pList('예방조치 문구 — 폐기', label.p.disp)}
                ${label.omitted.length ? `<p class="text-[11px] text-slate-500 border-t border-slate-100 pt-1.5">${label.omitted.map(esc).join('<br>')}</p>` : ''}
            </div>
        </div>`;
        refreshIcons();
    };

    // ---------- ④ 본문 ----------
    const rowsOf = (text) => Math.min(12, Math.max(1, String(text || '').split('\n').length + (String(text || '').length > 160 ? 1 : 0)));
    const renderText = () => {
        const { text, auto, edited } = built;
        const fieldHtml = (x, parentLabel = '') => {
            if (x.key === 's3') return `<div class="overflow-x-auto">${built.s3.length ? `<table class="w-full text-xs min-w-[520px] border border-slate-200"><thead class="bg-slate-50"><tr><th class="p-1.5 text-left">화학물질명</th><th class="p-1.5 text-left">관용명 및 이명</th><th class="p-1.5">CAS번호 또는 식별번호</th><th class="p-1.5">함유량(%)</th></tr></thead>
                <tbody>${built.s3.map(r => `<tr class="border-t border-slate-100"><td class="p-1.5 font-bold">${esc(r.name)}${r.secret ? ' *' : ''}</td><td class="p-1.5">${esc(r.alias || '-')}</td><td class="p-1.5 text-center font-mono">${esc(r.cas)}</td><td class="p-1.5 text-center">${esc(r.content)}</td></tr>`).join('')}</tbody></table>` : ''}
                ${built.s3Note ? `<p class="text-slate-600 mt-1 whitespace-pre-line">${esc(built.s3Note)}</p>` : ''}<p class="text-[11px] text-slate-400 mt-1">구성성분 표는 ① 탭의 성분·3항 표시·표시 함유량에서 만들어집니다.</p></div>`;
            if (x.key === 's2.pic') return `<div class="flex flex-wrap gap-2">${built.label.pictograms.length ? built.label.pictograms.map(c => pictogramSvg(c, 48)).join('') : '<span class="text-slate-400">해당 없음</span>'}</div>`;
            const isEdited = edited.includes(x.key);
            return `<div class="grid md:grid-cols-[minmax(160px,260px)_1fr] gap-x-3 gap-y-0.5 items-start">
                <div class="font-bold text-slate-600 pt-1.5">${parentLabel ? '○ ' : ''}${esc(x.label)}${isEdited ? ` <span class="px-1 rounded bg-amber-100 text-amber-800 text-[10px]" data-mark="${x.key}">수정됨</span>` : ''}</div>
                <div><textarea data-tx="${x.key}" rows="${rowsOf(text[x.key])}" class="${INPUT} resize-y leading-relaxed ${isEdited ? 'border-amber-400 bg-amber-50/40' : ''}">${esc(text[x.key])}</textarea>
                    ${isEdited ? `<button type="button" data-reset="${x.key}" class="text-[11px] text-blue-700 font-bold mt-0.5" title="${esc(String(auto[x.key] || '').slice(0, 300))}">자동 문장으로 되돌리기</button>` : ''}</div></div>`;
        };
        body.innerHTML = `
        <div class="${CARD} text-xs flex flex-wrap items-center justify-between gap-2">
            <div class="text-slate-600 min-w-0 flex-1 basis-72 space-y-1">
                <p>분류 결과와 성분 자료로 만든 문장입니다. 고칠 곳은 바로 고치면 되고(<span class="px-1 rounded bg-amber-100 text-amber-800 font-bold">수정됨</span> 표시), 성분·특성을 바꾸면 고치지 않은 칸은 자동으로 다시 만들어집니다.</p>
                <p class="text-[11px] text-slate-500">인쇄 모양 — <b>항목: 내용</b> 줄은 항목과 내용이 나란히 · <b>○ 제목</b> 줄은 파란 작은 제목 · <b>· 이름: 자료</b> 줄은 표 상자 · 앞에 두 칸을 띄운 줄은 윗줄의 내용에 이어집니다. 15항은 <b>항목: 해당됨 — 내용</b>으로 적으면 세 칸으로 나뉩니다.</p>
            </div>
            <div class="flex gap-1.5"><button type="button" data-act="open-all" class="${BTN_MINI}">모두 펼치기</button><button type="button" data-act="close-all" class="${BTN_MINI}">모두 접기</button></div>
        </div>
        ${MSDS_SECTIONS.map(sec => {
            const keys = sec.items.flatMap(it => (it.sub ? it.sub.map(s => s.key) : [it.key]));
            const n = keys.filter(k => edited.includes(k)).length;
            return `<details class="${CARD} text-xs me-sec" ${n || sec.no <= 3 ? 'open' : ''}>
                <summary class="cursor-pointer font-black text-slate-900 text-sm">${sec.no}. ${esc(sec.title)} ${n ? `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">수정 ${n}</span>` : ''}</summary>
                <div class="space-y-2 mt-3">${sec.items.map(it => (it.sub ? `<div class="font-bold text-slate-700 border-b border-slate-100 pb-0.5">${esc(it.label)}</div>${it.sub.map(s => fieldHtml(s, it.label)).join('')}` : fieldHtml(it))).join('')}</div>
            </details>`;
        }).join('')}`;
        refreshIcons();
    };

    const renderTab = () => {
        if (tab === 'comp') renderComp();
        else if (tab === 'props') renderProps();
        else if (tab === 'cls') renderCls();
        else renderText();
        paintHead();
        host.scrollTop = 0;
    };

    // ---------- 저장 · 인쇄 · 등록 ----------
    const save = async () => {
        if (!String(doc.product.name || '').trim()) { showToast('제품명을 입력하세요.'); tab = 'comp'; renderTab(); $('#me-product')?.focus(); return false; }
        doc.comps = doc.comps.filter(c => c.cas || c.name || Number(c.pct) > 0);
        recompute();
        doc.summary = { signal: built.label.signal, pictograms: built.label.pictograms, classes: built.result.classes.length, comps: doc.comps.length, listed: built.s3.length };
        const btn = $('#me-save');
        btn.disabled = true;
        try {
            const saved = await saveMsdsDoc(doc);
            doc.id = saved.id;
            isDirty = false;
            paintHead();
            if (tab === 'comp') renderComp();
            showToast(`💾 [${doc.product.name}] MSDS 작성 문서를 저장했습니다.`);
            onSaved(saved);
            return true;
        } catch (e) { showToast(e.message); return false; } finally { btn.disabled = false; }
    };
    const printDoc = (html) => { if (!openDocWindow(html)) alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); };
    const openLabelDialog = () => {
        const dlg = openDialog({
            title: '경고표지 인쇄', sub: '별표 3의 양식 — 명칭 · 그림문자 · 신호어 · 유해·위험 문구 · 예방조치 문구 · 공급자 정보', maxW: 'max-w-lg', icon: 'tag',
            bodyHtml: `<label class="block"><span class="font-bold text-slate-600">크기 (용기·포장 용량별 규격)</span><select id="ld-size" class="${INPUT} mt-0.5">${LABEL_SIZES.map(s => `<option value="${s.key}" ${s.key === 'A5' ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
                <label class="flex items-start gap-2 cursor-pointer"><input type="checkbox" id="ld-short" checked class="mt-0.5"> <span><b>예방조치 문구를 6개로 줄이기</b><br><span class="text-slate-500">7개 이상이면 예방·대응·저장·폐기 각 1개 이상을 넣어 6개만 표시하고, 나머지는 MSDS를 참고하게 적습니다 (제6조의2 제5항).</span></span></label>
                <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="ld-codes"> <span>문구 앞에 코드 번호(H·P)도 표시</span></label>
                <p class="text-[11px] text-slate-500">5 L 미만 용기는 용기 표면적의 5% 이상이면 됩니다. 인쇄 창에서 배율을 조절하거나 라벨 만들기 메뉴로 맞춤 라벨을 만드세요.</p>`,
            footHtml: `<button type="button" data-dlg-close class="${BTN_SUB}">닫기</button><button type="button" id="ld-ok" class="${BTN_PRIMARY}">인쇄</button>`
        });
        dlg.$('#ld-ok').addEventListener('click', () => { printDoc(labelHtml(doc, built, { size: dlg.$('#ld-size').value, shortP: dlg.$('#ld-short').checked, codes: dlg.$('#ld-codes').checked })); });
    };
    const openPublish = () => {
        if (!canAttach()) { showToast('MSDS 대장에 올리려면 현장 작업자 이상의 역할이 필요합니다.'); return; }
        const picked = { code: doc.product.itemCode || '', name: doc.product.name || '' };
        const dlg = openDialog({
            title: 'MSDS 대장에 등록', sub: '발행본(구성성분 함유량은 범위로 적은 문서)을 제품 MSDS 대장에 올립니다', maxW: 'max-w-lg', icon: 'upload',
            bodyHtml: `
                ${built.warnings.length ? `<div class="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-amber-900"><b>확인할 점 ${built.warnings.length}건</b>이 남아 있습니다 (③ 분류·경고표지 탭). 그래도 등록할 수 있습니다.</div>` : ''}
                <label class="block"><span class="font-bold text-slate-600">품목 (코드·이름 검색)</span><input id="pb-item" value="${esc(picked.name)}" class="${INPUT} mt-0.5 font-bold" autocomplete="off"><span id="pb-code" class="text-[10px] font-mono text-blue-600">${esc(picked.code)}</span></label>
                <ul class="list-disc pl-5 text-slate-600 space-y-0.5">
                    <li>MSDS 대장(제품 MSDS)에 이 제품의 줄을 만들거나 고치고, 발행본 파일(HTML)을 첨부합니다 — <b>모든 사용자가 열람</b>합니다.</li>
                    <li>발행본에는 3항에 적는 성분만 <b>범위(±5%P)</b>로 들어갑니다. 정확한 함유량은 이 작성 문서에만 남습니다.</li>
                    <li>이 MSDS를 사업장에 제공·게시하기 전에 <b>공단 MSDS 시스템에 제출</b>해 MSDS 번호를 받아 적어야 합니다(제조·수입자 의무).</li>
                </ul>
                <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" id="pb-final" checked> <span>이 작성 문서를 <b>확정</b>으로 바꾸기</span></label>`,
            footHtml: `<button type="button" data-dlg-close class="${BTN_SUB}">닫기</button><button type="button" id="pb-ok" class="${BTN_PRIMARY}">등록</button>`
        });
        attachItemPicker(dlg.$('#pb-item'), (it) => { picked.code = it.code; picked.name = it.name; dlg.$('#pb-item').value = it.name; dlg.$('#pb-code').textContent = it.code; });
        dlg.$('#pb-item').addEventListener('input', () => { picked.code = ''; picked.name = dlg.$('#pb-item').value.trim(); dlg.$('#pb-code').textContent = ''; });
        dlg.$('#pb-ok').addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            try {
                if (dlg.$('#pb-final').checked) doc.status = 'FINAL';
                if (picked.code) doc.product.itemCode = picked.code;
                if (!(await save())) return;
                const rev = doc.rev || {};
                const prev = (await listQc('MSDS')).find(m => m.msdsDocId === doc.id) || null;
                const record = await saveQc('MSDS', {
                    ...(prev || {}), msdsType: 'PRODUCT', itemCode: picked.code || prev?.itemCode || '', itemName: picked.name || doc.product.name, substance: doc.product.name,
                    supplier: doc.supplier.company || '', casNo: built.s3.filter(r => !r.secret).map(r => r.cas).filter(c => c && c !== '-').join(', '),
                    revNo: `Rev.${rev.no || '1'}`, revDate: rev.revDate || rev.firstDate || localDateStr(), date: rev.revDate || rev.firstDate || localDateStr(),
                    signal: built.label.signal || 'NONE', ghs: built.label.pictograms, language: '한국어', msdsDocId: doc.id, generated: true,
                    notes: prev?.notes || `혼합물 MSDS 작성 기능으로 만든 문서 (${GHS_NOTICE} 별표 4)${doc.product.msdsNo ? ` · MSDS 번호 ${doc.product.msdsNo}` : ''}`
                });
                const fileName = `MSDS_${String(doc.product.name).replace(/[\\/:*?"<>|]/g, '_')}_Rev${rev.no || '1'}_${rev.revDate || localDateStr()}.html`;
                const key = `MSDS:${record.id}`;
                for (const a of (await listAttachments(key)).filter(x => x.name === fileName)) await removeAttachment(a); // 같은 개정의 발행본은 바꾼다 (다른 개정은 이력으로 남김)
                await addAttachments(key, [new File([msdsHtml(doc, built, { autoPrint: false })], fileName, { type: 'text/html' })]);
                dlg.close();
                showToast(`✅ [${doc.product.name}] MSDS 대장(제품 MSDS)에 등록했습니다 — ${fileName}`);
            } catch (e) { showToast(e.message); } finally { btn.disabled = false; }
        });
    };

    // ---------- 닫기 ----------
    const onBeforeUnload = (e) => { if (isDirty) { e.preventDefault(); e.returnValue = ''; } };
    const topDialog = () => { const list = document.querySelectorAll('[data-dlg-body]'); return list.length ? list[list.length - 1].closest('.fixed') : null; };
    const onKey = (e) => {
        const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
        if (e.key === 'Escape') { const dlg = topDialog(); if (dlg) { e.stopImmediatePropagation(); dlg.querySelector('[data-dlg-close]')?.click(); } return; }
        // 앱의 '뒤로 가기' 단축키(Backspace · Alt+←)가 편집 중인 문서 뒤의 화면을 바꾸지 않게 막는다
        if (e.key === 'Backspace' && !editing) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); requestClose(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopImmediatePropagation(); save(); return; }
        // 통합 검색 단축키(Ctrl+K · /)로 다른 화면으로 넘어가지 않게
        if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !editing)) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    const onMouseUp = (e) => { if (e.button === 3) { e.preventDefault(); e.stopImmediatePropagation(); requestClose(); } };
    const onPop = () => {
        if (isClosing) return;
        const dlg = topDialog();
        if (dlg) dlg.querySelector('[data-dlg-close]')?.click();
        if (dlg || !requestClose({ fromPop: true })) window.history.pushState({ ...(window.history.state || {}), modal: 'msds-editor' }, '');
    };
    const destroy = () => {
        isClosing = true;
        window.removeEventListener('beforeunload', onBeforeUnload);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('mouseup', onMouseUp, true);
        window.removeEventListener('popstate', onPop);
        document.querySelectorAll('[data-dlg-body]').forEach(el => el.closest('.fixed')?.remove());
        host.remove();
        document.body.style.overflow = prevOverflow;
        active = null;
        delete window.__leaveMsdsEditor;
        onClosed();
    };
    /** 닫기를 청한다. 저장하지 않은 변경이 있으면 확인 — 취소하면 false */
    const requestClose = ({ fromPop = false } = {}) => {
        if (isDirty && !confirm('저장하지 않은 변경이 있습니다. 저장하지 않고 닫을까요?')) return false;
        const hadState = window.history.state?.modal === 'msds-editor';
        destroy();
        if (!fromPop && hadState) { try { window.history.back(); } catch (e) { console.warn('[MSDS 작성] 방문 기록을 되돌리지 못했습니다', e); } }
        return true;
    };

    // ---------- 이벤트 ----------
    host.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('[data-tab]'), goto = e.target.closest('[data-goto]');
        if (tabBtn || goto) { tab = (tabBtn || goto).dataset.tab || goto.dataset.goto; renderTab(); return; }
        const reset = e.target.closest('[data-reset]');
        if (reset) { delete doc.texts[reset.dataset.reset]; touch({ repaint: false }); renderText(); return; }
        const act = e.target.closest('[data-act]');
        if (!act) return;
        const tr = act.closest('tr[data-i]');
        const comp = tr ? doc.comps[Number(tr.dataset.i)] : null;
        switch (act.dataset.act) {
            case 'add': doc.comps.push(emptyComp()); renderComp(); touch(); host.querySelector('#me-comps tr:last-child [data-ck="cas"]')?.focus(); break;
            case 'del': doc.comps.splice(Number(tr.dataset.i), 1); renderComp(); touch(); break;
            case 'lookup': lookupRow(comp); break;
            case 'edit': editRow(comp); break;
            case 'nohaz': Object.assign(comp, { own: true, cls: [], ate: {}, m: {}, unknown: false, nonAdditive: false }); touch(); break;
            case 'paste': openPaste(); break;
            case 'from-msds': openFromMsds(); break;
            case 'lookup-all': {
                const list = doc.comps.filter(c => isValidCas(c.cas) && !lib.get(c.cas));
                if (!list.length) showToast('조회할 성분이 없습니다 (CAS 번호가 있고 물질 정보가 없는 성분만 조회합니다).'); else lookupMany(list);
                break;
            }
            case 'save-supplier': saveSupplierDefault(doc.supplier).then(() => showToast('공급자 정보를 기본값으로 저장했습니다.')).catch(err => showToast(err.message)); break;
            case 'rev-up': {
                doc.rev.count = (Number(doc.rev.count) || 0) + 1;
                doc.rev.no = String((Number(doc.rev.no) || 0) + 1);
                doc.rev.prevDate = doc.rev.revDate || doc.rev.firstDate || '';
                doc.rev.revDate = localDateStr();
                renderComp(); touch();
                showToast(`버전 ${versionText(doc.rev)} (개정 횟수 ${doc.rev.count}회, ${doc.rev.revDate})로 올렸습니다.`);
                break;
            }
            case 'phys-add': {
                const entry = { c: $('#me-phys-c').value, k: $('#me-phys-k').value };
                doc.physManual = [...doc.physManual.filter(x => x.c !== entry.c), entry];
                paintPhys(); touch();
                break;
            }
            case 'phys-del': doc.physManual.splice(Number(act.dataset.i), 1); paintPhys(); touch(); break;
            case 'open-all': $$('.me-sec').forEach(d => { d.open = true; }); break;
            case 'close-all': $$('.me-sec').forEach(d => { d.open = false; }); break;
            default: break;
        }
    });
    host.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.f && t.type !== 'checkbox' && t.tagName !== 'SELECT') {
            setPath(doc, t.dataset.f, t.type === 'number' ? (t.value === '' ? '' : Number(t.value)) : t.value);
            if (t.dataset.f === 'product.name') { doc.product.itemCode = ''; const code = $('#me-item-code'); if (code) code.textContent = ''; }
            if (t.dataset.f.startsWith('props.')) checkNumber(t.dataset.f);
            touch();
            return;
        }
        const tr = t.closest('tr[data-i]');
        if (tr && (t.dataset.ck || t.dataset.sk)) {
            const c = doc.comps[Number(tr.dataset.i)];
            if (t.dataset.sk) c.secret = { ...(c.secret || {}), [t.dataset.sk]: t.value };
            else if (t.dataset.ck === 'pct') c.pct = t.value === '' ? '' : Number(t.value);
            else if (t.dataset.ck !== 'show') c[t.dataset.ck] = t.value;
            touch();
            return;
        }
        if (t.dataset.tx) {
            const key = t.dataset.tx;
            if (t.value === (built.auto[key] ?? '')) delete doc.texts[key]; else doc.texts[key] = t.value;
            t.classList.toggle('border-amber-400', key in doc.texts);
            touch({ repaint: false });
        }
    });
    host.addEventListener('change', (e) => {
        const t = e.target;
        if (t.id === 'me-status') { doc.status = t.value; touch({ repaint: false }); return; }
        if (t.id === 'me-phys-c') { syncPhysCats(); return; }
        if (t.dataset.f && (t.type === 'checkbox' || t.tagName === 'SELECT')) { setPath(doc, t.dataset.f, t.type === 'checkbox' ? t.checked : t.value); touch(); return; }
        if (t.dataset.ov) {
            if (t.value) doc.overrides[t.dataset.ov] = { ...(doc.overrides[t.dataset.ov] || {}), k: t.value }; else delete doc.overrides[t.dataset.ov];
            touch();
            return;
        }
        if (t.dataset.ovr) { if (doc.overrides[t.dataset.ovr]) doc.overrides[t.dataset.ovr].reason = t.value.trim(); touch(); return; }
        if (t.dataset.org) { doc.organs[t.dataset.org] = t.value.trim(); touch(); return; }
        if (t.dataset.tx) { renderText(); return; } // 칸을 벗어나면 '수정됨' 표시를 맞춘다
        const tr = t.closest('tr[data-i]');
        if (!tr) return;
        const c = doc.comps[Number(tr.dataset.i)];
        if (t.dataset.ck === 'show') { c.show = t.value; tr.querySelector('[data-cell="disp"]').innerHTML = dispCellHtml(c); touch(); return; }
        if (t.dataset.ck === 'cas') {
            const cas = normCas(t.value);
            c.cas = cas;
            t.value = cas;
            if (c.own) { c.own = false; delete c.cls; }
            touch();
            if (cas && !lib.get(cas)) lookupRow(c);
            else if (cas && !c.name) { c.name = lib.get(cas).nameKo || lib.get(cas).nameEn || ''; const nameInput = tr.querySelector('[data-ck="name"]'); if (nameInput) nameInput.value = c.name; touch(); }
        }
    });
    $('#me-close').addEventListener('click', () => requestClose());
    $('#me-save').addEventListener('click', () => save());
    $('#me-print').addEventListener('click', () => printDoc(msdsHtml(doc, built)));
    $('#me-label').addEventListener('click', openLabelDialog);
    $('#me-basis').addEventListener('click', () => printDoc(basisHtml(doc, built, { confidentialCss: CONFIDENTIAL_CSS, confidentialMark: confidentialHtml('배합 자료 · 무단 복제·반출 금지') })));
    $('#me-publish').addEventListener('click', openPublish);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('popstate', onPop);
    try { window.history.pushState({ ...(window.history.state || {}), modal: 'msds-editor' }, ''); } catch (e) { console.warn('[MSDS 작성] 방문 기록에 표시하지 못했습니다', e); }

    active = { requestClose, isDirty: () => isDirty, destroy };
    // 다른 화면으로 갈 때(main.js switchTab) 이 창을 닫는다 — 저장 안 한 변경이 있으면 확인
    window.__leaveMsdsEditor = () => requestClose();
    renderTab();
};
