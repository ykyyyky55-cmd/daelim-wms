import { state, LEDGER_KINDS, ledgerKindOfCategory, addItemLedgerEntry, updateItemLedgerEntry, deleteItemLedgerEntry } from '../services/db.js';
import { matchesQuery, localDateStr } from '../services/searchUtils.js';
import { sitesOf } from '../services/locations.js';
import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import * as XLSX from 'xlsx';
import { createColumnFilter } from './ColumnFilter.js';
import { esc } from '../services/html.js';

// ==========================================
// 제품(완제품)·자재 수불부 — 원료수불부(RawMaterialLedger.js)와 같은 구성·방식
// ==========================================
// · 재고는 수불일자 순서로 누적한다 (같은 날짜는 입력 순서). 지난 날짜로 입력해도 그 날짜 자리에서 다시 계산된다
//   (services/db.js recalcItemLedgerByDate — 저장·불러오기 때 적용).
// · 두 보기: [수불원장 (누적 상세)] · [현재고량 보기 (품목별 최종일자)] — 재고 기준 거점별 / 전체 통합
// · 거점 퀵 토글, 검색, 기간(전체·당월·3개월·1년·직접), 구분, 재고상태, 정렬, 품목 드롭다운·칩, 엑셀식 열 필터,
//   페이지 크기, 합계 푸터, 공식 A4 인쇄(결재란), 엑셀 다운로드, 전표 등록·수정·삭제
// 원료수불부 전용 항목(비중·중량·D/M·원료코드·제조원·단가)은 없다.
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const ITEM_LEDGER_TYPES = ['입고', '생산입고', '출고', '사용', '이동입고', '이동출고', '재고조사', '이월'];
const TYPE_TONES = {
    '입고': 'bg-blue-50 text-blue-700 border-blue-200',
    '생산입고': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    '출고': 'bg-rose-50 text-rose-700 border-rose-200',
    '사용': 'bg-amber-50 text-amber-700 border-amber-200',
    '이동입고': 'bg-indigo-50 text-indigo-700 border-indigo-200',
    '이동출고': 'bg-violet-50 text-violet-700 border-violet-200',
    '재고조사': 'bg-teal-50 text-teal-700 border-teal-200',
    '이월': 'bg-slate-100 text-slate-700 border-slate-300'
};
export const typeBadge = (t) => `<span class="inline-block whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-extrabold border ${TYPE_TONES[t] || 'bg-slate-50 text-slate-600 border-slate-200'}">${esc(t)}</span>`;
const futureBadge = (date) => (date && date > localDateStr()
    ? ' <span class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200" title="오늘 이후 날짜입니다. 수불일자를 확인하세요.">미래일자</span>' : '');
// 일자순 (같은 날짜는 입력 순서)
const dateOrder = (list) => list.map((e, i) => [e, i]).sort((a, b) => (a[0].date || '').localeCompare(b[0].date || '') || a[1] - b[1]).map(x => x[0]);

const colFilters = {};
const ledgerFilterOf = (kind) => (colFilters[`L${kind}`] ||= createColumnFilter(`itemLedger_${kind}`, [
    { id: 'location', label: '거점', value: r => r.location },
    { id: 'date', label: '수불일자', value: r => r.date },
    { id: 'code', label: '품목코드', value: r => r.code },
    { id: 'name', label: '품목명', value: r => r.name },
    { id: 'type', label: '구분', value: r => r.type },
    { id: 'notes', label: '적요', value: r => r.notes },
    { id: 'inQty', label: '입고', value: r => (Number(r.inQty) ? fmt(r.inQty) : '') },
    { id: 'outQty', label: '출고', value: r => (Number(r.outQty) ? fmt(r.outQty) : '') },
    { id: 'stock', label: '재고', value: r => fmt(r._stock) },
    { id: 'remark', label: '비고', value: r => r.remark },
    { id: 'worker', label: '작업자', value: r => r.worker }
]));
const stockFilterOf = (kind) => (colFilters[`S${kind}`] ||= createColumnFilter(`itemStock_${kind}`, [
    { id: 'location', label: '거점', value: r => r.location },
    { id: 'code', label: '품목코드', value: r => r.code },
    { id: 'name', label: '품목명', value: r => r.name },
    { id: 'lastDate', label: '최종 수불일자', value: r => r.lastDate },
    { id: 'lastType', label: '최종구분', value: r => r.lastType },
    { id: 'current', label: '현재고', value: r => fmt(r.current) }
]));

/**
 * 제품(완제품)·자재 수불부
 * @param {'product'|'material'} kind
 */
export const renderItemLedger = (container, { kind = 'material', showToast, onSwitchTab }) => {
    const info = LEDGER_KINDS[kind];
    const P = kind === 'product';
    const canWrite = canPerformAction('WRITE_STOCK');
    const sites = sitesOf(state.locations);
    const items = state.master.filter(m => ledgerKindOfCategory(m.category) === kind);
    const PREF = `daelim_itemLedger_${kind}`;
    let pref = {};
    try { pref = JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { /* 기본값 */ }
    let view = pref.view === 'stock' ? 'stock' : 'ledger';
    let stockMode = pref.stockMode === 'total' ? 'total' : 'site';
    let site = 'ALL';
    let item = 'ALL';
    let type = 'ALL';
    let stockStatus = 'ALL';
    let sortMode = 'codeDate';
    let q = '';
    let from = '', to = '';
    let page = 1;
    let pageSize = 100;
    let editingId = null;
    const colL = ledgerFilterOf(kind);
    const colS = stockFilterOf(kind);
    const ledger = () => state[info.stateKey] || [];
    const savePref = () => { try { localStorage.setItem(PREF, JSON.stringify({ view, stockMode })); } catch { /* 무시 */ } };
    const itemLabel = P ? '제품' : '자재';

    container.innerHTML = `
    <div class="space-y-5">
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
                <div class="text-[11px] font-black text-blue-600 flex items-center gap-1"><i data-lucide="boxes" class="w-3.5 h-3.5"></i>재고·수불 › ${esc(info.label)}</div>
                <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="${P ? 'package-check' : 'book-open-check'}" class="w-5 h-5 text-blue-600"></i><span>${esc(info.label)}</span><span class="max-sm:hidden px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">${P ? '완제품' : '부자재 · 소모품 · 기타'}</span></h2>
                <p class="text-xs text-slate-500 mt-1">거점별 ${itemLabel}의 수·불 누적 원장과 품목별 현재고량을 봅니다. 입고·출고·이동·생산·실사는 자동으로 기입되며, 재고는 수불일자 순서로 누적됩니다.</p>
            </div>
            <div class="flex items-center flex-wrap gap-2">
                <button type="button" id="il-print" class="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5"><i data-lucide="printer" class="w-4 h-4"></i><span>공식 A4 인쇄</span></button>
                <button type="button" id="il-export" class="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5"><i data-lucide="file-spreadsheet" class="w-4 h-4 text-emerald-600"></i><span>엑셀 다운로드</span></button>
                <button type="button" id="il-viewer" class="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5"><i data-lucide="library" class="w-4 h-4"></i><span>수불부 조회·인쇄</span></button>
                ${canWrite ? `<button type="button" id="il-scroll-input" class="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5"><i data-lucide="plus-circle" class="w-4 h-4"></i><span>${itemLabel} 수불 등록</span></button>` : ''}
            </div>
        </div>

        <div class="bg-white p-2 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2 flex-wrap">
                <button type="button" data-view="ledger" class="il-view px-4 py-2.5 rounded-xl font-extrabold text-xs flex items-center gap-2"><i data-lucide="book-open" class="w-4 h-4"></i><span>${itemLabel} 수불원장 (누적 상세)</span></button>
                <button type="button" data-view="stock" class="il-view px-4 py-2.5 rounded-xl font-extrabold text-xs flex items-center gap-2"><i data-lucide="boxes" class="w-4 h-4"></i><span>현재고량 보기 (품목별 최종일자)</span><span id="il-stock-badge" class="px-1.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-mono font-bold"></span></button>
            </div>
            <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold" title="재고는 수불일자 순서로 누적됩니다">
                <span class="text-[11px] text-slate-500 px-2 flex items-center gap-1"><i data-lucide="calendar-range" class="w-3.5 h-3.5 text-slate-400"></i>재고 기준(일자순):</span>
                <button type="button" data-mode="site" class="il-mode px-3 py-1 rounded-lg">거점별</button>
                <button type="button" data-mode="total" class="il-mode px-3 py-1 rounded-lg">전체 통합</button>
            </div>
            <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                <span class="text-[11px] text-slate-500 px-2 flex items-center gap-1"><i data-lucide="map-pin" class="w-3.5 h-3.5 text-slate-400"></i>거점:</span>
                ${['ALL', ...sites].map(s => `<button type="button" data-site="${esc(s)}" class="il-site px-3 py-1 rounded-lg">${s === 'ALL' ? '전체' : esc(s)}</button>`).join('')}
            </div>
        </div>

        <div id="il-kpi" class="grid grid-cols-2 md:grid-cols-4 gap-3 max-sm:gap-2"></div>

        ${canWrite ? `
        <div id="il-input" class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <div class="flex items-center gap-2">
                    <span class="p-1.5 bg-blue-100 text-blue-700 rounded-lg"><i data-lucide="edit-3" class="w-4 h-4"></i></span>
                    <div><h3 class="font-extrabold text-sm text-slate-900">신규 ${itemLabel} 수불 전표 입력 (누적 등록)</h3>
                        <p class="text-[11px] text-slate-500">재고는 수불일자 순서로 자동 누적됩니다. 직접 입력한 전표는 창고 재고를 바꾸지 않습니다 (재고를 바꾸려면 입출고 화면).</p></div>
                </div>
                <span class="px-2.5 py-1 text-[10px] font-bold bg-blue-50 text-blue-700 rounded-lg border border-blue-200">일자순 자동 누적</span>
            </div>
            <form id="il-form" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 text-xs">
                <label class="block"><span class="block text-[11px] font-bold text-slate-700 mb-1">수불 일자 *</span><input type="date" id="il-date" required value="${localDateStr()}" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 font-bold" /></label>
                <label class="block"><span class="block text-[11px] font-bold text-slate-700 mb-1">거점 *</span><select id="il-location" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 font-bold">${sites.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></label>
                <label class="block col-span-2"><span class="block text-[11px] font-bold text-slate-700 mb-1">품목 * <span class="text-slate-400 font-normal">(코드·품명 검색)</span></span>
                    <input type="text" id="il-item" list="il-item-list" required placeholder="예: 2AA40001 또는 품명" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 font-bold" autocomplete="off" />
                    <datalist id="il-item-list">${items.map(m => `<option value="${esc(m.code)}">${esc(m.name)}${m.spec ? ` / ${esc(m.spec)}` : ''}</option>`).join('')}</datalist></label>
                <label class="block"><span class="block text-[11px] font-bold text-slate-700 mb-1">수불 분류 *</span><select id="il-type" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 font-bold">${ITEM_LEDGER_TYPES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></label>
                <label class="block"><span class="block text-[11px] font-bold text-blue-700 mb-1">수 (입고)</span><input type="number" id="il-in" min="0" step="any" placeholder="0" class="w-full bg-blue-50/50 border border-blue-200 rounded-xl px-2.5 py-1.5 font-black text-blue-800 text-right" /></label>
                <label class="block"><span class="block text-[11px] font-bold text-rose-700 mb-1">불 (출고/사용)</span><input type="number" id="il-out" min="0" step="any" placeholder="0" class="w-full bg-rose-50/50 border border-rose-200 rounded-xl px-2.5 py-1.5 font-black text-rose-800 text-right" /></label>
                <label class="block"><span class="block text-[11px] font-bold text-slate-700 mb-1">적요 / 거래처</span><input type="text" id="il-notes" placeholder="거래처·사유" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5" /></label>
                <label class="block col-span-2 md:col-span-3 lg:col-span-7"><span class="block text-[11px] font-bold text-slate-700 mb-1">비고</span><input type="text" id="il-remark" placeholder="비고 (선택)" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5" /></label>
                <div class="flex items-end"><button type="submit" class="w-full h-[34px] bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl flex items-center justify-center gap-1.5"><i data-lucide="plus" class="w-4 h-4"></i>전표 누적 등록</button></div>
            </form>
        </div>` : ''}

        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2 flex-1 max-w-md">
                    <div class="relative flex-1"><i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-3 top-2.5"></i>
                        <input type="text" id="il-q" placeholder="품목명, 품목코드, 적요, 비고, 작업자 (문자 일부 검색)..." class="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium" /></div>
                    <button type="button" id="il-reset" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold">초기화</button>
                </div>
                <div id="il-period-wrap" class="flex items-center flex-wrap gap-1.5">
                    <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">${[['all', '전체'], ['month', '당월'], ['3month', '3개월'], ['year', '1년']].map(([k, l]) => `<button type="button" data-range="${k}" class="il-period px-2.5 py-1 rounded-lg">${l}</button>`).join('')}</div>
                    <div class="flex items-center gap-1 text-xs"><input type="date" id="il-from" class="bg-white border border-slate-300 rounded-xl px-2 py-1 font-bold" /><span class="text-slate-400 font-bold">~</span><input type="date" id="il-to" class="bg-white border border-slate-300 rounded-xl px-2 py-1 font-bold" />
                        <button type="button" id="il-date-apply" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold">적용</button></div>
                </div>
                <div id="il-status-wrap" class="hidden">
                    <select id="il-status" class="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700">
                        <option value="ALL">전체 품목 (재고보유+소진)</option><option value="positive">재고 보유 품목 (> 0)</option><option value="zero">재고 소진 품목 (0)</option><option value="negative">재고 마이너스 품목 (&lt; 0)</option>
                    </select>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <select id="il-type-f" class="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700"><option value="ALL">모든 분류</option>${ITEM_LEDGER_TYPES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
                    <select id="il-sort" class="max-w-full bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700"></select>
                </div>
            </div>
            <div id="il-chips-wrap" class="pt-2 border-t border-slate-100 flex flex-col md:flex-row md:items-center gap-2 text-xs">
                <div class="flex items-center gap-1.5 shrink-0"><span class="text-[11px] font-bold text-slate-500 whitespace-nowrap">${itemLabel} 품목:</span>
                    <select id="il-item-select" class="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-800 max-w-[260px]"></select></div>
                <div id="il-chips" class="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 pb-1"></div>
            </div>
        </div>

        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="flex justify-end px-3 pt-2"><div id="il-colfilter-clear" class="empty:hidden"></div></div>
            <div class="overflow-auto hidden md:block max-h-[65vh]"><table class="w-full text-left text-xs" id="il-table"></table></div>
            <div id="il-cards" class="md:hidden p-3 space-y-2.5"></div>
            <div class="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 border-t border-slate-200 text-xs no-print">
                <div class="flex items-center gap-2 text-slate-600"><span id="il-page-info" class="font-bold text-slate-700"></span>
                    <span class="text-slate-400 text-[11px] ml-2">페이지당:</span>
                    <select id="il-page-size" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold"><option value="50">50건</option><option value="100" selected>100건</option><option value="200">200건</option><option value="500">500건</option><option value="all">전체</option></select></div>
                <div id="il-pages" class="flex items-center gap-1 select-none flex-wrap"></div>
            </div>
            <div id="il-footer" class="p-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between text-xs text-slate-600 gap-2"></div>
        </div>
    </div>

    <div id="il-edit-modal" class="fixed inset-0 bg-slate-900/60 z-50 hidden items-center justify-center p-4">
        <form id="il-edit-form" class="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden text-xs">
            <div class="px-5 py-4 bg-slate-900 text-white font-black text-sm">수불 전표 수정</div>
            <div class="p-5 space-y-3">
                <p id="il-edit-item" class="font-bold text-slate-600"></p>
                <div class="grid grid-cols-2 gap-2.5">
                    <label class="block"><span class="font-bold text-slate-700">일자</span><input type="date" id="il-e-date" required class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold" /></label>
                    <label class="block"><span class="font-bold text-slate-700">거점</span><select id="il-e-location" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold">${sites.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></label>
                    <label class="block"><span class="font-bold text-slate-700">구분</span><select id="il-e-type" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold">${ITEM_LEDGER_TYPES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></label>
                    <label class="block"><span class="font-bold text-slate-700">적요</span><input type="text" id="il-e-notes" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5" /></label>
                    <label class="block"><span class="font-bold text-blue-700">입고</span><input type="number" id="il-e-in" step="any" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold text-right" /></label>
                    <label class="block"><span class="font-bold text-rose-700">출고</span><input type="number" id="il-e-out" min="0" step="any" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold text-right" /></label>
                    <label class="block col-span-2"><span class="font-bold text-slate-700">비고</span><input type="text" id="il-e-remark" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5" /></label>
                </div>
                <p class="text-[11px] text-slate-500">수정·삭제하면 같은 품목·거점의 재고가 수불일자 순서로 다시 계산됩니다. 창고 재고는 바뀌지 않습니다.</p>
                <div class="flex justify-end gap-2">
                    <button type="button" id="il-e-cancel" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">취소</button>
                    <button type="submit" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black">저장</button>
                </div>
            </div>
        </form>
    </div>`;
    const $ = (s) => container.querySelector(s);

    // ---------- 자료 ----------
    // 전체 통합 재고: 전표 id → 그 전표까지 품목코드별(모든 거점 합산) 일자순 누적
    const totalBalances = () => {
        const m = new Map(); const by = new Map();
        dateOrder(ledger()).forEach(e => { const s = Math.round(((by.get(e.code) || 0) + (Number(e.inQty) || 0) - (Number(e.outQty) || 0)) * 1000) / 1000; by.set(e.code, s); m.set(e.id, s); });
        return m;
    };
    const inPeriod = (d) => (!from || d >= from) && (!to || d <= to);
    const baseLedgerRows = () => {
        let list = ledger().filter(e => (site === 'ALL' || e.location === site) && (item === 'ALL' || e.code === item) && (type === 'ALL' || e.type === type) && inPeriod(e.date)
            && (!q || matchesQuery(e, q, ['code', 'name', 'notes', 'remark', 'worker', 'type'])));
        const tb = stockMode === 'total' ? totalBalances() : null;
        list = list.map(e => ({ ...e, _stock: tb ? (tb.get(e.id) ?? 0) : Number(e.stockQty) || 0 }));
        const idx = new Map(ledger().map((e, i) => [e.id, i]));
        const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || idx.get(a.id) - idx.get(b.id);
        if (sortMode === 'codeDate') list.sort((a, b) => String(a.code).localeCompare(String(b.code)) || (stockMode === 'total' ? 0 : String(a.location).localeCompare(String(b.location))) || byDate(a, b));
        else if (sortMode === 'dateAsc') list.sort(byDate);
        else if (sortMode === 'dateDesc') list.sort((a, b) => byDate(b, a));
        else list.sort((a, b) => idx.get(b.id) - idx.get(a.id)); // 최근 입력순
        return list;
    };
    // 현재고: 품목(·거점)별 일자순 마지막 전표
    const stockRows = () => {
        const last = new Map();
        dateOrder(ledger()).forEach(e => {
            if (site !== 'ALL' && stockMode !== 'total' && e.location !== site) return;
            const k = stockMode === 'total' ? e.code : `${e.code}___${e.location}`;
            last.set(k, e);
        });
        const tb = stockMode === 'total' ? totalBalances() : null;
        // 통합일 때 거점별 재고
        const regions = new Map();
        if (stockMode === 'total') {
            const lastSite = new Map();
            dateOrder(ledger()).forEach(e => lastSite.set(`${e.code}___${e.location}`, e));
            lastSite.forEach(e => { const r = regions.get(e.code) || {}; r[e.location] = Number(e.stockQty) || 0; regions.set(e.code, r); });
        }
        const inCount = new Map(), outCount = new Map();
        ledger().forEach(e => { if (!inPeriod(e.date)) return; const k = stockMode === 'total' ? e.code : `${e.code}___${e.location}`; inCount.set(k, (inCount.get(k) || 0) + (Number(e.inQty) || 0)); outCount.set(k, (outCount.get(k) || 0) + (Number(e.outQty) || 0)); });
        let list = [...last.entries()].map(([k, e]) => {
            const m = state.master.find(x => x.code === e.code);
            return { key: k, code: e.code, name: m?.name || e.name, spec: m?.spec || '', unit: e.unit || m?.unit || 'EA', location: stockMode === 'total' ? '통합' : e.location,
                regions: stockMode === 'total' ? regions.get(e.code) : null, lastDate: e.date, lastType: e.type, lastNotes: e.notes, lastRemark: e.remark,
                current: tb ? (tb.get(e.id) ?? 0) : Number(e.stockQty) || 0, periodIn: inCount.get(k) || 0, periodOut: outCount.get(k) || 0, safety: Number(m?.safety) || 0 };
        });
        list = list.filter(r => (item === 'ALL' || r.code === item) && (!q || matchesQuery(r, q, ['code', 'name', 'spec', 'lastNotes', 'lastRemark']))
            && (stockStatus === 'ALL' || (stockStatus === 'positive' && r.current > 0) || (stockStatus === 'zero' && r.current === 0) || (stockStatus === 'negative' && r.current < 0)));
        const S = { codeAsc: (a, b) => String(a.code).localeCompare(String(b.code)) || String(a.location).localeCompare(String(b.location)), stockDesc: (a, b) => b.current - a.current, stockAsc: (a, b) => a.current - b.current,
            nameAsc: (a, b) => String(a.name).localeCompare(String(b.name), 'ko'), dateDesc: (a, b) => String(b.lastDate).localeCompare(String(a.lastDate)) };
        return list.sort(S[sortMode] || S.codeAsc);
    };
    const regionsText = (r) => Object.entries(r || {}).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ');
    const stockLabel = () => (stockMode === 'total' ? '통합 재고' : '재고');

    // ---------- 그리기 ----------
    const paint = () => {
        container.querySelectorAll('.il-view').forEach(b => { const on = b.dataset.view === view; b.className = `il-view px-4 py-2.5 rounded-xl font-extrabold text-xs flex items-center gap-2 ${on ? (view === 'ledger' ? 'bg-blue-600 text-white shadow-sm' : 'bg-emerald-600 text-white shadow-sm') : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`; });
        container.querySelectorAll('.il-mode').forEach(b => { b.className = `il-mode px-3 py-1 rounded-lg ${b.dataset.mode === stockMode ? 'bg-white text-indigo-700 shadow-2xs font-black' : 'text-slate-600 hover:text-slate-900'}`; });
        container.querySelectorAll('.il-site').forEach(b => { b.className = `il-site px-3 py-1 rounded-lg ${b.dataset.site === site ? 'bg-white text-blue-700 shadow-2xs font-black' : 'text-slate-600 hover:text-slate-900'}`; });
        const range = !from && !to ? 'all' : null;
        container.querySelectorAll('.il-period').forEach(b => { b.className = `il-period px-2.5 py-1 rounded-lg ${b.dataset.range === (range || periodKey) ? 'bg-white text-blue-700 shadow-2xs' : ''}`; });
        $('#il-input')?.classList.toggle('hidden', view !== 'ledger');
        $('#il-chips-wrap').classList.toggle('hidden', false);
        $('#il-status-wrap').classList.toggle('hidden', view !== 'stock');
        $('#il-type-f').classList.toggle('hidden', view !== 'ledger');
        const opts = view === 'ledger'
            ? [['codeDate', '품목코드순 → 일자순 (기본)'], ['dateAsc', '수불일자 오름차순'], ['dateDesc', '수불일자 내림차순 (최근 먼저)'], ['input', '최근 입력순']]
            : [['codeAsc', '품목코드순'], ['stockDesc', '재고 많은 순'], ['stockAsc', '재고 적은 순'], ['nameAsc', '품목명 가나다순'], ['dateDesc', '최근 수불일자순']];
        if (!opts.some(o => o[0] === sortMode)) sortMode = opts[0][0];
        $('#il-sort').innerHTML = opts.map(([k, l]) => `<option value="${k}" ${k === sortMode ? 'selected' : ''}>${l}</option>`).join('');
    };
    let periodKey = 'all';

    const renderChips = () => {
        const count = new Map();
        ledger().forEach(e => { if (site === 'ALL' || e.location === site) count.set(e.code, (count.get(e.code) || 0) + 1); });
        const nameOf = (c) => state.master.find(m => m.code === c)?.name || ledger().find(e => e.code === c)?.name || c;
        const all = [...count.entries()].sort((a, b) => String(nameOf(a[0])).localeCompare(String(nameOf(b[0])), 'ko'));
        $('#il-item-select').innerHTML = `<option value="ALL">전체 ${itemLabel} (${all.length}종)</option>${all.map(([c, n]) => `<option value="${esc(c)}" ${c === item ? 'selected' : ''}>${esc(nameOf(c))} (${esc(c)}) · ${n}건</option>`).join('')}`;
        const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
        $('#il-chips').innerHTML = [`<button type="button" data-item="ALL" class="il-chip shrink-0 px-2.5 py-1 rounded-full border font-bold ${item === 'ALL' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200'}">전체</button>`,
            ...top.map(([c, n]) => `<button type="button" data-item="${esc(c)}" class="il-chip shrink-0 px-2.5 py-1 rounded-full border font-bold whitespace-nowrap ${item === c ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}">${esc(nameOf(c))} <span class="${item === c ? 'text-blue-100' : 'text-slate-400'}">${n}</span></button>`)].join('');
        container.querySelectorAll('.il-chip').forEach(b => b.addEventListener('click', () => { item = b.dataset.item; page = 1; renderChips(); render(); }));
    };

    const renderKpi = (rows) => {
        const month = localDateStr().slice(0, 7);
        const card = (label, value, tone, sub = '') => `<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs"><span class="text-[11px] font-bold text-slate-500">${esc(label)}</span><div class="text-xl font-black font-mono ${tone} mt-1">${esc(value)}</div>${sub ? `<div class="text-[10px] text-slate-400">${esc(sub)}</div>` : ''}</div>`;
        if (view === 'ledger') {
            const inSite = ledger().filter(e => site === 'ALL' || e.location === site);
            const m = inSite.filter(e => String(e.date).startsWith(month) && e.type !== '이월');
            $('#il-kpi').innerHTML = [card('전표 수', `${inSite.length.toLocaleString()}건`, 'text-slate-900', `조건에 맞는 전표 ${rows.length.toLocaleString()}건`), card('관리 품목', `${new Set(inSite.map(e => e.code)).size.toLocaleString()}종`, 'text-indigo-700'),
                card(`${Number(month.slice(5))}월 입고 합계`, fmt(m.reduce((s, e) => s + (Number(e.inQty) || 0), 0)), 'text-blue-700', '이월 제외'), card(`${Number(month.slice(5))}월 출고 합계`, fmt(m.reduce((s, e) => s + (Number(e.outQty) || 0), 0)), 'text-rose-700')].join('');
        } else {
            $('#il-kpi').innerHTML = [card('품목 수', `${rows.length.toLocaleString()}종`, 'text-slate-900'), card('재고 보유', `${rows.filter(r => r.current > 0).length.toLocaleString()}종`, 'text-emerald-700'),
                card('재고 소진', `${rows.filter(r => r.current === 0).length.toLocaleString()}종`, 'text-slate-500', rows.some(r => r.current < 0) ? `마이너스 ${rows.filter(r => r.current < 0).length}종` : ''),
                card('안전재고 미달', `${rows.filter(r => r.safety > 0 && r.current < r.safety).length.toLocaleString()}종`, 'text-rose-600', '품목마스터 안전재고 기준')].join('');
        }
        $('#il-stock-badge').textContent = `${stockRows().length}종`;
    };

    const pager = (total) => {
        const size = pageSize === 'all' ? total || 1 : pageSize;
        const pages = Math.max(1, Math.ceil(total / size));
        if (page > pages) page = pages;
        const start = (page - 1) * size;
        $('#il-page-info').textContent = `총 ${total.toLocaleString()}건${total ? ` 중 ${(start + 1).toLocaleString()}~${Math.min(start + size, total).toLocaleString()}건 표시` : ''}`;
        const btns = [];
        if (pages > 1) {
            const set = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter(p => p >= 1 && p <= pages));
            let prev = 0;
            [...set].sort((a, b) => a - b).forEach(p => { if (p - prev > 1) btns.push('<span class="px-1 text-slate-400">…</span>'); btns.push(`<button type="button" data-page="${p}" class="il-page px-2.5 py-1 rounded-lg font-bold ${p === page ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">${p}</button>`); prev = p; });
        }
        $('#il-pages').innerHTML = btns.join('');
        container.querySelectorAll('.il-page').forEach(b => b.addEventListener('click', () => { page = Number(b.dataset.page); render(); }));
        return [start, start + size];
    };

    const th = (label, col, cls = '') => `<th class="p-2.5 whitespace-nowrap ${cls}" ${col ? `data-filter-col="${col}"` : ''}>${label}</th>`;
    const render = () => {
        paint();
        if (view === 'ledger') {
            const base = baseLedgerRows();
            const rows = colL.apply(base);
            renderKpi(rows);
            const [s, e] = pager(rows.length);
            const pageRows = rows.slice(s, e);
            let prevGroup = null;
            const body = pageRows.map(r => {
                let g = '';
                const gk = stockMode === 'total' ? r.code : `${r.code}___${r.location}`;
                if (sortMode === 'codeDate' && gk !== prevGroup) {
                    prevGroup = gk;
                    g = `<tr class="bg-indigo-50/70"><td colspan="${canWrite ? 12 : 11}" class="px-2.5 py-1.5 font-black text-indigo-900">${esc(r.code || '코드 없음')} · ${esc(r.name)} <span class="font-bold text-indigo-500">(${stockMode === 'total' ? '전 거점 통합' : esc(r.location)})</span></td></tr>`;
                }
                return `${g}<tr class="hover:bg-slate-50">
                    <td class="p-2.5 font-bold text-slate-700 whitespace-nowrap">${esc(r.location)}</td>
                    <td class="p-2.5 font-mono whitespace-nowrap">${esc(r.date)}${futureBadge(r.date)}</td>
                    <td class="p-2.5 font-mono text-blue-700 whitespace-nowrap">${esc(r.code)}</td>
                    <td class="p-2.5 font-bold text-slate-900 min-w-[160px]">${esc(r.name)}</td>
                    <td class="p-2.5 text-center">${typeBadge(r.type)}</td>
                    <td class="p-2.5 text-slate-600 max-w-[220px] truncate" title="${esc(r.notes)}">${esc(r.notes)}</td>
                    <td class="p-2.5 text-right font-mono text-blue-700">${Number(r.inQty) ? fmt(r.inQty) : ''}</td>
                    <td class="p-2.5 text-right font-mono text-rose-700">${Number(r.outQty) ? fmt(r.outQty) : ''}</td>
                    <td class="p-2.5 text-right font-mono font-black ${r._stock < 0 ? 'text-rose-600' : 'text-slate-900'}">${fmt(r._stock)} <span class="text-[10px] text-slate-400 font-normal">${esc(r.unit || '')}</span></td>
                    <td class="p-2.5 text-slate-500 max-w-[160px] truncate" title="${esc(r.remark)}">${esc(r.remark)}</td>
                    <td class="p-2.5 text-slate-500 whitespace-nowrap">${esc(r.worker)}</td>
                    ${canWrite ? `<td class="p-2.5 text-center whitespace-nowrap"><button type="button" class="il-edit p-1 text-slate-400 hover:text-blue-600" data-id="${esc(r.id)}" title="수정"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button><button type="button" class="il-del p-1 text-slate-400 hover:text-rose-600" data-id="${esc(r.id)}" title="삭제"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></td>` : ''}
                </tr>`;
            }).join('');
            $('#il-table').innerHTML = `<thead class="bg-slate-50 text-slate-600 font-bold sticky top-0 z-10"><tr>${th('거점', 'location')}${th('수불일자', 'date')}${th('품목코드', 'code')}${th('품목명', 'name')}${th('구분', 'type', 'text-center')}${th('적요', 'notes')}${th('수 (입고)', 'inQty', 'text-right')}${th('불 (출고)', 'outQty', 'text-right')}${th(stockLabel(), 'stock', 'text-right')}${th('비고', 'remark')}${th('작업자', 'worker')}${canWrite ? th('관리', '', 'text-center') : ''}</tr></thead>
                <tbody class="divide-y divide-slate-100">${body || `<tr><td colspan="12" class="p-8 text-center text-slate-400 font-bold">조건에 맞는 전표가 없습니다.</td></tr>`}</tbody>`;
            $('#il-cards').innerHTML = pageRows.map(r => `<div class="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
                <div class="flex items-start justify-between gap-2"><div class="min-w-0"><div class="flex items-center gap-1.5 flex-wrap mb-1"><span class="font-mono text-[11px] text-slate-500">${esc(r.date)}</span><span class="font-bold text-slate-700 text-[11px]">${esc(r.location)}</span>${typeBadge(r.type)}${futureBadge(r.date)}</div>
                    <div class="font-bold text-slate-900 truncate">${esc(r.name)}</div><div class="font-mono text-blue-700 text-[11px]">${esc(r.code)}</div></div>
                    ${canWrite ? `<div class="flex gap-1"><button type="button" class="il-edit p-2 text-slate-400" data-id="${esc(r.id)}"><i data-lucide="pencil" class="w-4 h-4"></i></button><button type="button" class="il-del p-2 text-slate-400" data-id="${esc(r.id)}"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>` : ''}</div>
                <div class="mt-2 pt-2 border-t border-slate-100 grid grid-cols-3 gap-1.5 text-center text-[11px]"><div><div class="text-slate-400">입고</div><div class="font-bold text-blue-700">${Number(r.inQty) ? fmt(r.inQty) : '-'}</div></div><div><div class="text-slate-400">출고</div><div class="font-bold text-rose-700">${Number(r.outQty) ? fmt(r.outQty) : '-'}</div></div><div><div class="text-slate-400">${stockLabel()}</div><div class="font-black ${r._stock < 0 ? 'text-rose-600' : ''}">${fmt(r._stock)}</div></div></div>
                ${r.notes ? `<div class="mt-1.5 text-[11px] text-slate-600 truncate">${esc(r.notes)}</div>` : ''}</div>`).join('') || '<div class="p-8 text-center text-slate-400 font-bold text-xs">조건에 맞는 전표가 없습니다.</div>';
            const tIn = rows.reduce((a, r) => a + (Number(r.inQty) || 0), 0), tOut = rows.reduce((a, r) => a + (Number(r.outQty) || 0), 0);
            $('#il-footer').innerHTML = `<span>조건에 맞는 전표 <b>${rows.length.toLocaleString()}</b>건 · 품목 ${new Set(rows.map(r => r.code)).size}종</span><span>입고 합계 <b class="text-blue-700">+${fmt(tIn)}</b> · 출고 합계 <b class="text-rose-700">-${fmt(tOut)}</b> · 순증감 <b>${fmt(tIn - tOut)}</b></span>`;
            colL.attach($('#il-table'), () => baseLedgerRows(), () => { page = 1; render(); }, { clearHost: $('#il-colfilter-clear') });
        } else {
            const base = stockRows();
            const rows = colS.apply(base);
            renderKpi(rows);
            const [s, e] = pager(rows.length);
            const pageRows = rows.slice(s, e);
            $('#il-table').innerHTML = `<thead class="bg-emerald-50 text-emerald-900 font-bold sticky top-0 z-10"><tr>${th('거점', 'location')}${th('품목코드', 'code')}${th('품목명', 'name')}${th('규격')}${th('최종 수불일자', 'lastDate')}${th('최종구분', 'lastType', 'text-center')}${th('최종 적요')}${th('기간 입고', '', 'text-right')}${th('기간 출고', '', 'text-right')}${th(`현재고 (${stockLabel()})`, 'current', 'text-right')}${th('안전재고', '', 'text-right')}</tr></thead>
                <tbody class="divide-y divide-slate-100">${pageRows.map(r => `<tr class="hover:bg-slate-50 cursor-pointer il-stock-row" data-code="${esc(r.code)}">
                    <td class="p-2.5 font-bold text-slate-700 whitespace-nowrap">${esc(r.location)}${r.regions ? `<div class="text-[10px] font-normal text-slate-400">${esc(regionsText(r.regions))}</div>` : ''}</td>
                    <td class="p-2.5 font-mono text-blue-700 whitespace-nowrap">${esc(r.code)}</td><td class="p-2.5 font-bold text-slate-900">${esc(r.name)}</td><td class="p-2.5 text-slate-500">${esc(r.spec)}</td>
                    <td class="p-2.5 font-mono whitespace-nowrap">${esc(r.lastDate)}</td><td class="p-2.5 text-center">${typeBadge(r.lastType)}</td><td class="p-2.5 text-slate-500 max-w-[200px] truncate">${esc(r.lastNotes || '')}</td>
                    <td class="p-2.5 text-right font-mono text-blue-700">${r.periodIn ? fmt(r.periodIn) : ''}</td><td class="p-2.5 text-right font-mono text-rose-700">${r.periodOut ? fmt(r.periodOut) : ''}</td>
                    <td class="p-2.5 text-right font-mono font-black ${r.current < 0 ? 'text-rose-600' : r.current === 0 ? 'text-slate-400' : 'text-emerald-700'} bg-emerald-50/40">${fmt(r.current)} <span class="text-[10px] text-slate-400 font-normal">${esc(r.unit)}</span></td>
                    <td class="p-2.5 text-right font-mono ${r.safety > 0 && r.current < r.safety ? 'text-rose-600 font-black' : 'text-slate-400'}">${r.safety ? fmt(r.safety) : ''}</td></tr>`).join('') || '<tr><td colspan="11" class="p-8 text-center text-slate-400 font-bold">조건에 맞는 품목이 없습니다.</td></tr>'}</tbody>`;
            $('#il-cards').innerHTML = pageRows.map(r => `<div class="il-stock-row bg-white rounded-2xl border border-slate-200 p-3 shadow-sm" data-code="${esc(r.code)}"><div class="flex justify-between gap-2"><div class="min-w-0"><div class="font-bold text-slate-900 truncate">${esc(r.name)}</div><div class="font-mono text-blue-700 text-[11px]">${esc(r.code)} · ${esc(r.location)}</div><div class="text-[11px] text-slate-400">최종 ${esc(r.lastDate)} ${esc(r.lastType)}</div></div>
                <div class="text-right"><div class="text-lg font-black ${r.current < 0 ? 'text-rose-600' : 'text-emerald-700'}">${fmt(r.current)}</div><div class="text-[10px] text-slate-400">${esc(r.unit)}</div></div></div></div>`).join('') || '<div class="p-8 text-center text-slate-400 font-bold text-xs">조건에 맞는 품목이 없습니다.</div>';
            $('#il-footer').innerHTML = `<span>품목 <b>${rows.length.toLocaleString()}</b>종 · 재고 보유 ${rows.filter(r => r.current > 0).length}종</span><span>현재고 합계 <b class="text-emerald-700">${fmt(rows.reduce((a, r) => a + r.current, 0))}</b> (단위 혼합 주의)</span>`;
            colS.attach($('#il-table'), () => stockRows(), () => { page = 1; render(); }, { clearHost: $('#il-colfilter-clear') });
            // 현재고 줄을 누르면 그 품목의 수불원장으로
            container.querySelectorAll('.il-stock-row').forEach(tr => tr.addEventListener('click', () => { item = tr.dataset.code; view = 'ledger'; sortMode = 'codeDate'; page = 1; savePref(); renderChips(); render(); }));
        }
        container.querySelectorAll('.il-edit').forEach(b => b.addEventListener('click', () => openEdit(b.dataset.id)));
        container.querySelectorAll('.il-del').forEach(b => b.addEventListener('click', () => removeEntry(b.dataset.id)));
        createIcons({ icons });
    };

    // ---------- 등록·수정·삭제 ----------
    const resolveItem = (text) => {
        const t = text.trim();
        if (!t) return null;
        const code = t.split(/\s/)[0];
        return items.find(m => m.code === code) || items.find(m => m.name === t)
            || (() => { const c = items.filter(m => matchesQuery(m, t, ['code', 'name'])); return c.length === 1 ? c[0] : null; })();
    };
    $('#il-form')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const it = resolveItem($('#il-item').value);
        if (!it) { alert(`${info.short} 품목을 찾을 수 없습니다. 목록에서 품목코드를 골라 주세요.`); return; }
        const inQty = Number($('#il-in').value) || 0, outQty = Number($('#il-out').value) || 0;
        if (!inQty && !outQty) { alert('입고 또는 출고 수량을 입력하세요.'); return; }
        try {
            await addItemLedgerEntry(kind, { date: $('#il-date').value, location: $('#il-location').value, code: it.code, name: it.name, unit: it.unit,
                type: $('#il-type').value, inQty, outQty, notes: $('#il-notes').value, remark: $('#il-remark').value });
            showToast(`✅ [${it.code}] ${it.name} 수불 전표를 등록했습니다 (일자순으로 재고 누적).`);
            ['#il-item', '#il-in', '#il-out', '#il-notes', '#il-remark'].forEach(s => { $(s).value = ''; });
            page = 1; renderChips(); render();
        } catch (err) { alert(`전표 등록 실패: ${err.message}`); }
    });
    const modal = $('#il-edit-modal');
    const openEdit = (id) => {
        const e = ledger().find(x => x.id === id);
        if (!e) return;
        editingId = id;
        $('#il-edit-item').textContent = `[${e.code}] ${e.name}`;
        $('#il-e-date').value = e.date; $('#il-e-location').value = e.location;
        $('#il-e-type').value = ITEM_LEDGER_TYPES.includes(e.type) ? e.type : '입고';
        $('#il-e-notes').value = e.notes || ''; $('#il-e-in').value = e.inQty || 0; $('#il-e-out').value = e.outQty || 0; $('#il-e-remark').value = e.remark || '';
        modal.classList.remove('hidden'); modal.classList.add('flex');
    };
    const closeEdit = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); editingId = null; };
    $('#il-e-cancel').addEventListener('click', closeEdit);
    $('#il-edit-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
            await updateItemLedgerEntry(kind, editingId, { date: $('#il-e-date').value, location: $('#il-e-location').value, type: $('#il-e-type').value,
                notes: $('#il-e-notes').value.trim(), inQty: Number($('#il-e-in').value) || 0, outQty: Number($('#il-e-out').value) || 0, remark: $('#il-e-remark').value.trim() });
            closeEdit(); showToast('✏️ 전표를 수정하고 재고를 일자순으로 다시 계산했습니다.'); render();
        } catch (err) { alert(`전표 수정 실패: ${err.message}`); }
    });
    const removeEntry = async (id) => {
        const e = ledger().find(x => x.id === id);
        if (!e || !confirm(`[${e.date}] ${e.name} ${e.type} 전표를 삭제하시겠습니까?\n같은 품목·거점의 재고가 일자순으로 다시 계산됩니다.`)) return;
        await deleteItemLedgerEntry(kind, id);
        showToast('🗑️ 전표를 삭제했습니다.'); renderChips(); render();
    };

    // ---------- 인쇄·엑셀 ----------
    const cell = 'border:1px solid #cbd5e1; padding:4px;';
    const approval = `<table style="border-collapse:collapse; text-align:center; font-size:10px; width:220px;"><tr><td rowspan="2" style="border:1px solid #64748b; background:#f1f5f9; width:20px; font-weight:bold;">결<br>재</td>${['담당', '팀장', '공장장', '대표'].map(x => `<td style="border:1px solid #64748b; background:#f8fafc; padding:2px; font-weight:bold;">${x}</td>`).join('')}</tr><tr style="height:35px;">${'<td style="border:1px solid #64748b;"></td>'.repeat(4)}</tr></table>`;
    const itemText = () => (item === 'ALL' ? `전체 ${itemLabel}` : `${state.master.find(m => m.code === item)?.name || item} (${item})`);
    $('#il-print').addEventListener('click', () => {
        let host = document.getElementById('item-ledger-print-container');
        if (!host) { host = document.createElement('div'); host.id = 'item-ledger-print-container'; host.className = 'printable-area'; document.body.appendChild(host); }
        const now = new Date().toLocaleString('ko-KR');
        const head = (title, meta) => `<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; border-bottom:2px solid #0f172a; padding-bottom:8px;"><div><h1 style="font-size:20px; font-weight:900; margin:0 0 4px 0;">${title}</h1><div style="font-size:11px; color:#475569; display:flex; gap:12px; flex-wrap:wrap;">${meta.map(([k, v]) => `<span><strong>${k}:</strong> ${esc(v)}</span>`).join('')}</div></div>${approval}</div>`;
        if (view === 'ledger') {
            const rows = colL.apply(baseLedgerRows());
            let tIn = 0, tOut = 0, n = 1, prevG = null;
            const body = rows.map(r => {
                tIn += Number(r.inQty) || 0; tOut += Number(r.outQty) || 0;
                const gk = stockMode === 'total' ? r.code : `${r.code}___${r.location}`;
                let g = '';
                if (sortMode === 'codeDate' && gk !== prevG) { prevG = gk; g = `<tr><td colspan="11" style="${cell} background:#eef2ff; font-weight:bold;">${esc(r.code)} &nbsp; ${esc(r.name)} <span style="font-weight:normal; color:#475569;">(${stockMode === 'total' ? '전 거점 통합' : esc(r.location)})</span></td></tr>`; }
                return `${g}<tr><td style="${cell} text-align:center;">${n++}</td><td style="${cell} text-align:center;">${esc(r.location)}</td><td style="${cell} text-align:center;">${esc(r.date)}</td><td style="${cell} font-family:monospace;">${esc(r.code)}</td><td style="${cell} font-weight:bold;">${esc(r.name)}</td><td style="${cell} text-align:center;">${esc(r.type)}</td><td style="${cell}">${esc(r.notes || '-')}</td>
                    <td style="${cell} text-align:right; color:#1d4ed8; font-weight:bold;">${Number(r.inQty) ? fmt(r.inQty) : '-'}</td><td style="${cell} text-align:right; color:#b91c1c; font-weight:bold;">${Number(r.outQty) ? fmt(r.outQty) : '-'}</td><td style="${cell} text-align:right; font-weight:bold; background:#f8fafc;">${fmt(r._stock)}</td><td style="${cell}">${esc(r.remark || '-')}</td></tr>`;
            }).join('');
            host.innerHTML = `<div style="font-family:'Noto Sans KR', sans-serif; color:#0f172a; padding:15px;">${head(`(주)대림오일 ${esc(info.label)}`, [['거점', site === 'ALL' ? '전체' : site], ['대상', itemText()], ['재고 기준', `${stockMode === 'total' ? '전체 통합' : '거점별'} (수불일자순)`], ['기간', `${from || '최초'} ~ ${to || '현재'}`], ['출력', now]])}
                <table style="width:100%; border-collapse:collapse; font-size:10px;"><thead style="background:#f1f5f9;"><tr>${['No', '거점', '일자', '품목코드', '품목명', '분류', '적요', '수(입고)', '불(출고)', stockLabel(), '비고'].map(x => `<th style="${cell}">${x}</th>`).join('')}</tr></thead><tbody>${body}</tbody>
                <tfoot style="background:#f8fafc; font-weight:bold;"><tr><td colspan="7" style="${cell} text-align:center;">합계</td><td style="${cell} text-align:right; color:#1d4ed8;">+${fmt(tIn)}</td><td style="${cell} text-align:right; color:#b91c1c;">-${fmt(tOut)}</td><td colspan="2" style="${cell} text-align:center; color:#64748b;">(주)대림오일 스마트 WMS 전산 원장</td></tr></tfoot></table></div>`;
        } else {
            const rows = colS.apply(stockRows());
            host.innerHTML = `<div style="font-family:'Noto Sans KR', sans-serif; color:#0f172a; padding:15px;">${head(`(주)대림오일 ${itemLabel} 현재고 현황표 (품목별 최종일자 기준)`, [['거점', site === 'ALL' ? '전체' : site], ['재고 기준', stockMode === 'total' ? '전체 통합' : '거점별'], ['품목 수', `${rows.length}종`], ['출력', now]])}
                <table style="width:100%; border-collapse:collapse; font-size:10px;"><thead style="background:#ecfdf5; color:#064e3b;"><tr>${['No', '거점', '품목코드', '품목명', '규격', '최종일자', '최종구분', '최종적요', '현재고', '단위'].map(x => `<th style="${cell}">${x}</th>`).join('')}</tr></thead>
                <tbody>${rows.map((r, i) => `<tr><td style="${cell} text-align:center;">${i + 1}</td><td style="${cell} text-align:center;">${esc(r.location)}${r.regions ? `<br><span style="font-size:9px;">${esc(regionsText(r.regions))}</span>` : ''}</td><td style="${cell} font-family:monospace;">${esc(r.code)}</td><td style="${cell} font-weight:bold;">${esc(r.name)}</td><td style="${cell}">${esc(r.spec)}</td><td style="${cell} text-align:center;">${esc(r.lastDate)}</td><td style="${cell} text-align:center;">${esc(r.lastType)}</td><td style="${cell}">${esc(r.lastNotes || '-')}</td><td style="${cell} text-align:right; font-weight:bold; background:#ecfdf5;">${fmt(r.current)}</td><td style="${cell} text-align:center;">${esc(r.unit)}</td></tr>`).join('')}</tbody></table></div>`;
        }
        window.print();
    });
    $('#il-export').addEventListener('click', () => {
        const today = localDateStr();
        let data, sheet, file;
        if (view === 'ledger') {
            data = colL.apply(baseLedgerRows()).map((r, i) => ({ 순번: i + 1, 거점: r.location, 수불일자: r.date, 품목코드: r.code, 품목명: r.name, 분류: r.type, 적요: r.notes || '', '수(입고)': Number(r.inQty) || 0, '불(출고)': Number(r.outQty) || 0, [stockLabel()]: r._stock, 단위: r.unit || '', 비고: r.remark || '', 작업자: r.worker || '' }));
            sheet = `${itemLabel}수불원장`; file = `대림오일_${info.label}_원장_${site === 'ALL' ? '전체' : site}_${today}.xlsx`;
        } else {
            data = colS.apply(stockRows()).map((r, i) => ({ 순번: i + 1, 거점: r.location, ...(r.regions ? { '거점별 재고': regionsText(r.regions) } : {}), 품목코드: r.code, 품목명: r.name, 규격: r.spec, 최종수불일자: r.lastDate, 최종분류: r.lastType, 최종적요: r.lastNotes || '', 기간입고: r.periodIn, 기간출고: r.periodOut, 현재고: r.current, 단위: r.unit, 안전재고: r.safety || '' }));
            sheet = `${itemLabel}현재고현황`; file = `대림오일_${itemLabel}현재고현황_${stockMode === 'total' ? '통합' : site === 'ALL' ? '전체' : site}_${today}.xlsx`;
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), sheet);
        XLSX.writeFile(wb, file);
        showToast(`📊 '${file}' 엑셀 파일을 저장했습니다.`);
    });

    // ---------- 이벤트 ----------
    container.querySelectorAll('.il-view').forEach(b => b.addEventListener('click', () => { view = b.dataset.view; page = 1; savePref(); render(); }));
    container.querySelectorAll('.il-mode').forEach(b => b.addEventListener('click', () => { stockMode = b.dataset.mode; page = 1; savePref(); render(); }));
    container.querySelectorAll('.il-site').forEach(b => b.addEventListener('click', () => { site = b.dataset.site; page = 1; renderChips(); render(); }));
    container.querySelectorAll('.il-period').forEach(b => b.addEventListener('click', () => {
        const t = localDateStr(); const d = new Date(); periodKey = b.dataset.range;
        if (periodKey === 'all') { from = ''; to = ''; }
        else if (periodKey === 'month') { from = `${t.slice(0, 7)}-01`; to = ''; }
        else { d.setMonth(d.getMonth() - (periodKey === '3month' ? 3 : 12)); from = localDateStr(d); to = ''; }
        $('#il-from').value = from; $('#il-to').value = to; page = 1; render();
    }));
    $('#il-date-apply').addEventListener('click', () => { from = $('#il-from').value; to = $('#il-to').value; periodKey = 'custom'; page = 1; render(); });
    $('#il-status').addEventListener('change', (e) => { stockStatus = e.target.value; page = 1; render(); });
    $('#il-type-f').addEventListener('change', (e) => { type = e.target.value; page = 1; render(); });
    $('#il-sort').addEventListener('change', (e) => { sortMode = e.target.value; page = 1; render(); });
    $('#il-item-select').addEventListener('change', (e) => { item = e.target.value; page = 1; renderChips(); render(); });
    $('#il-page-size').addEventListener('change', (e) => { pageSize = e.target.value === 'all' ? 'all' : Number(e.target.value); page = 1; render(); });
    let qt = null;
    $('#il-q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { q = e.target.value.trim(); page = 1; render(); }, 200); });
    $('#il-reset').addEventListener('click', () => { q = ''; $('#il-q').value = ''; item = 'ALL'; type = 'ALL'; $('#il-type-f').value = 'ALL'; from = ''; to = ''; periodKey = 'all'; $('#il-from').value = ''; $('#il-to').value = ''; stockStatus = 'ALL'; $('#il-status').value = 'ALL'; colL.clear(); colS.clear(); page = 1; renderChips(); render(); });
    $('#il-viewer').addEventListener('click', () => { window.__ledgerViewerKind = kind; onSwitchTab?.('ledgerViewer'); });
    $('#il-scroll-input')?.addEventListener('click', () => { if (view !== 'ledger') { view = 'ledger'; render(); } $('#il-input')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => $('#il-item')?.focus(), 300); });

    renderChips();
    render();
};
