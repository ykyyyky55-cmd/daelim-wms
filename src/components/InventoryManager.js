import { state, updateInventoryDate, latestRawSg, commitStockAudit } from '../services/db.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';
import { matchesQuery, isDateInRange, determineSubCategory, localDateStr, toDateKey } from '../services/searchUtils.js';
import { locationFilterOptionsHtml, locationOptionsHtml, matchesLocationFilter, siteOf, buildingOf } from '../services/locations.js';
import { createColumnFilter } from './ColumnFilter.js';
import { esc } from '../services/html.js';

// 품목코드 → 마스터 조회 캐시 (재고 행마다 state.master를 순회하지 않도록)
let masterMapCache = null;
let masterMapSource = null;
const masterOf = (code) => {
    if (masterMapSource !== state.master || masterMapCache.size !== state.master.length) {
        masterMapCache = new Map(state.master.map(m => [m.code, m]));
        masterMapSource = state.master;
    }
    return masterMapCache.get(code) || {};
};

// 분류 표시 순서 (그 밖의 분류는 뒤에 가나다순)
const CATEGORY_ORDER = ['완제품', '원액', '원료', '부자재', '소모품', '기타'];
const catOf = (item) => item.category || masterOf(item.code).category || '완제품';
const isRawCategory = (cat) => cat === '원료' || cat === '원액';
// 원료·원액 재고: 원료수불부와 같이 L 기준 + 무게(kg = L × 비중). 단위를 KG로 관리하는 품목만 KG 기준.
const rawAmounts = (item, qty) => {
    const sg = latestRawSg(item.code, item.name) || 1;
    const n = Number(qty) || 0;
    if (String(item.unit || '').toUpperCase() === 'KG') return { liters: n / sg, kg: n, sg, base: 'KG' };
    return { liters: n, kg: n * sg, sg, base: 'L' };
};
const VIEW_KEY = 'daelim_inv_view';
const fmt1 = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

const stockStatusOf = (item) => {
    const qty = Number(item.quantity) || 0;
    if (qty === 0) return '결품 위험 (0EA)';
    return qty <= (Number(masterOf(item.code).safety) || 0) ? '안전재고 부족' : '정상 보관';
};

// 창고 재고 현황 엑셀식 열 필터
const invColFilter = createColumnFilter('inventory', [
    { id: 'location', label: '보관 거점', value: i => i.location },
    { id: 'code', label: '품목코드', value: i => i.code },
    { id: 'category', label: '분류', value: i => i.category || masterOf(i.code).category || '완제품' },
    { id: 'name', label: '품목명', value: i => i.name },
    { id: 'supplier', label: '주요 거래처', value: i => masterOf(i.code).supplier || '-' },
    { id: 'quantity', label: '보관 수량', value: i => Number(i.quantity) || 0 },
    { id: 'safety', label: '기준 안전재고', value: i => Number(masterOf(i.code).safety) || 0 },
    { id: 'status', label: '재고 상태', value: stockStatusOf },
    { id: 'lastUpdated', label: '기준/갱신 일자', value: i => i.lastUpdated }
]);

export const GOOGLE_AUDIT_URL = "https://script.google.com/macros/s/AKfycbw169OmPBTWmBgzgHfMeSJa9yxRLSEPYBbPQbL0vF13tv_8WQNG4I6sg2XVf_KAXcNF/exec";

export const renderInventoryManager = (container, { showToast, onSwitchTab }) => {
    container.innerHTML = `
    <section id="tab-content-inventory" class="space-y-6">
        <!-- 4대 거점 구글 실시간 재고실사 연동 시스템 안내 배너 -->
        <div class="bg-gradient-to-r from-teal-900 via-slate-900 to-indigo-950 text-white p-4 sm:p-5 rounded-2xl border border-teal-800/80 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div class="space-y-1.5">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-teal-400 text-slate-950 flex items-center gap-1.5">
                        <span class="w-1.5 h-1.5 rounded-full bg-slate-950 animate-pulse"></span>
                        실시간 연동 가동중
                    </span>
                    <span class="text-xs text-teal-300 font-bold">4대 거점: 본사 · 김포 · 방산 · 김포2</span>
                </div>
                <h3 class="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                    <i data-lucide="globe" class="w-5 h-5 text-teal-400"></i>
                    <span>대림기업 4대 거점 실시간 재고실사 연동 시스템</span>
                </h3>
                <p class="text-xs text-slate-300 max-w-2xl leading-relaxed">
                    구글 클라우드 기반 실시간 재고실사 웹앱과 연동되어 본사·방산·김포·대림오일의 현장 실사 데이터를 실시간으로 조회하고 WMS 전산 재고에 즉시 반영할 수 있습니다.
                </p>
            </div>
            <div class="flex flex-wrap items-center gap-2 w-full md:w-auto">
                <button type="button" id="btn-inv-open-google-audit" class="flex-1 md:flex-initial px-3.5 py-2.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black text-xs rounded-xl transition flex items-center justify-center gap-1.5 shadow-md shadow-teal-500/20 whitespace-nowrap">
                    <i data-lucide="external-link" class="w-4 h-4"></i>
                    <span>실사 웹앱 새 창 열기</span>
                </button>
                <button type="button" id="btn-inv-goto-audit-tab" class="flex-1 md:flex-initial px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 border border-white/20 whitespace-nowrap">
                    <i data-lucide="clipboard-check" class="w-4 h-4 text-teal-300"></i>
                    <span>재고실사 관리 이동</span>
                </button>
            </div>
        </div>

        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="database" class="w-5 h-5 text-blue-600"></i>
                        <span>창고별 실시간 재고 현황판</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">모든 공장 및 물류 거점에 분산 보관된 원료·자재·완제품의 실시간 수량을 모니터링하고 기준일자별로 조회합니다.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-open-warehouse-stock" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="warehouse" class="w-4 h-4"></i>
                        <span>창고별 재고 등록</span>
                    </button>
                    <button type="button" id="btn-export-inventory-excel" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="download" class="w-4 h-4"></i>
                        <span>재고 엑셀 다운로드</span>
                    </button>
                </div>
            </div>

            <!-- 상단 달력 & 기간 필터 바 (일자등록 및 연동검색) -->
            <div class="bg-gradient-to-r from-blue-50/70 via-indigo-50/50 to-slate-50 p-3.5 rounded-xl border border-blue-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="font-bold text-blue-900 flex items-center gap-1.5">
                        <i data-lucide="calendar" class="w-4 h-4 text-blue-600"></i>
                        <span>재고 기준/갱신 일자:</span>
                    </span>
                    <div class="flex items-center gap-1.5 bg-white px-2.5 py-1 border border-slate-300 rounded-lg shadow-2xs">
                        <span class="text-[11px] font-bold text-slate-500">시작:</span>
                        <input type="date" id="inv-date-from" class="text-xs font-bold text-slate-800 focus:outline-none bg-transparent" />
                    </div>
                    <span class="text-slate-400 font-bold">~</span>
                    <div class="flex items-center gap-1.5 bg-white px-2.5 py-1 border border-slate-300 rounded-lg shadow-2xs">
                        <span class="text-[11px] font-bold text-slate-500">종료:</span>
                        <input type="date" id="inv-date-to" class="text-xs font-bold text-slate-800 focus:outline-none bg-transparent" />
                    </div>
                    <button type="button" id="btn-inv-date-apply" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs shadow-2xs transition">달력 조회</button>
                </div>

                <div class="flex flex-wrap items-center gap-1">
                    <span class="text-[11px] text-slate-500 font-bold mr-1">빠른 선택:</span>
                    <button type="button" class="btn-inv-quick-date px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 rounded-md text-[11px] font-bold text-slate-700 transition active" data-range="all">전체</button>
                    <button type="button" class="btn-inv-quick-date px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 rounded-md text-[11px] font-bold text-slate-700 transition" data-range="today">오늘</button>
                    <button type="button" class="btn-inv-quick-date px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 rounded-md text-[11px] font-bold text-slate-700 transition" data-range="7days">최근 7일</button>
                    <button type="button" class="btn-inv-quick-date px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 rounded-md text-[11px] font-bold text-slate-700 transition" data-range="30days">최근 30일</button>
                    <button type="button" class="btn-inv-quick-date px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 rounded-md text-[11px] font-bold text-slate-700 transition" data-range="month">이번달</button>
                </div>
            </div>

            <!-- 필터 및 검색 바 -->
            <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div class="flex flex-wrap items-center gap-2">
                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-bold text-slate-600">거점:</span>
                        <select id="inv-filter-location" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                            <option value="">전체 거점 통합</option>
                            ${locationFilterOptionsHtml(state.locations)}
                        </select>
                    </div>

                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-bold text-slate-600">거래처:</span>
                        <select id="inv-filter-partner" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                            <option value="">전체 거래처</option>
                            ${(state.partners || []).map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
                        </select>
                    </div>

                    <label class="flex items-center gap-1.5 ml-2 cursor-pointer bg-white px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-700">
                        <input type="checkbox" id="inv-filter-danger" class="rounded text-rose-600 focus:ring-rose-500" />
                        <span class="text-rose-600">안전재고 부족만 보기</span>
                    </label>
                </div>

                <div class="relative">
                    <input type="text" id="inv-search-input" placeholder="품목코드, 품명, 규격, 거래처 검색 (일부문자 인식)..." class="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none w-72" />
                    <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2"></i>
                </div>
            </div>

            <!-- 분류별 보기: 분류 칩(건수) + 분류별 묶어 보기 -->
            <div class="flex flex-wrap items-center gap-1.5 text-xs" id="inv-cat-bar"></div>

            <!-- 재고 테이블. 좁은 화면(폰)에서는 표 대신 카드 목록으로 -->
            <div id="inv-colfilter-clear" class="flex justify-end"></div>
            <div class="overflow-auto hidden md:block max-h-[65vh]" id="inv-table-wrap">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 text-slate-600 border-b border-slate-200 font-bold sticky top-0 z-10">
                        <tr>
                            <th class="p-3" data-filter-col="location">보관 거점</th>
                            <th class="p-3 text-center w-12">사진</th>
                            <th class="p-3" data-filter-col="code">품목코드</th>
                            <th class="p-3" data-filter-col="category">분류 / 종류</th>
                            <th class="p-3" data-filter-col="name">품목명</th>
                            <th class="p-3" data-filter-col="supplier">주요 거래처</th>
                            <th class="p-3 text-right" data-filter-col="quantity">보관 수량</th>
                            <th class="p-3 text-right" data-filter-col="safety">기준 안전재고</th>
                            <th class="p-3 text-center" data-filter-col="status">재고 상태</th>
                            <th class="p-3" data-filter-col="lastUpdated">기준/갱신 일자 (일자등록)</th>
                        </tr>
                    </thead>
                    <tbody id="inventory-table-body" class="divide-y divide-slate-100"></tbody>
                </table>
            </div>
            <div id="inv-card-list" class="md:hidden space-y-2.5"></div>

            <!-- 페이지 나누기 (기본: 전체 표시) -->
            <div id="inv-pagination-bar" class="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs no-print">
                <div class="flex items-center gap-2 text-slate-600 font-medium">
                    <span id="inv-page-info" class="font-bold text-slate-700">총 0건 중 0~0건 표시</span>
                    <div class="flex items-center gap-1 ml-2">
                        <span class="text-slate-400 text-[11px]">페이지당:</span>
                        <select id="inv-page-size" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer">
                            <option value="100">100개</option>
                            <option value="200">200개</option>
                            <option value="500">500개</option>
                            <option value="1000">1,000개</option>
                            <option value="all" selected>전체 (모두 표시)</option>
                        </select>
                    </div>
                </div>
                <div class="flex items-center gap-1 select-none" id="inv-page-buttons"></div>
            </div>
        </div>

        <!-- 재고 일자 변경 모달 -->
        <div id="modal-inv-date-edit" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
            <div class="bg-white max-w-sm w-full rounded-2xl shadow-2xl p-5 border border-slate-100 space-y-4">
                <div class="flex justify-between items-center border-b border-slate-100 pb-3">
                    <h3 class="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                        <i data-lucide="calendar" class="w-4 h-4 text-blue-600"></i>
                        <span>재고 일자 등록 및 변경</span>
                    </h3>
                    <button type="button" id="btn-close-inv-date-modal" class="text-slate-400 hover:text-slate-700 text-lg">&times;</button>
                </div>
                <div class="space-y-3 text-xs">
                    <div>
                        <span class="text-slate-500 font-bold block">대상 품목:</span>
                        <span id="modal-inv-item-info" class="font-black text-slate-900 text-sm block mt-0.5">-</span>
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">등록 일자 (달력 선택)</label>
                        <input type="date" id="modal-inv-input-date" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <div class="pt-2 flex justify-end gap-2">
                        <button type="button" id="btn-cancel-inv-date" class="px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50">취소</button>
                        <button type="button" id="btn-save-inv-date" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm">저장 및 클라우드 반영</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 품목별 창고(건물)별 보관재고 등록 모달 -->
        <div id="modal-warehouse-stock" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
            <div class="bg-white max-w-md w-full rounded-2xl shadow-2xl p-5 border border-slate-100 space-y-4">
                <div class="flex justify-between items-center border-b border-slate-100 pb-3">
                    <h3 class="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                        <i data-lucide="warehouse" class="w-4 h-4 text-indigo-600"></i>
                        <span>창고(건물)별 보관재고 등록</span>
                    </h3>
                    <button type="button" id="btn-close-warehouse-stock" class="text-slate-400 hover:text-slate-700 text-lg">&times;</button>
                </div>
                <p class="text-[11px] text-slate-500 -mt-2">품목과 위치(거점 또는 거점의 특정 건물)를 골라 그 위치의 보관 수량을 그대로 등록/수정합니다. 등록하면 수불부에 '재고조사' 전표로 자동 반영됩니다.</p>
                <form id="form-warehouse-stock" class="space-y-3 text-xs">
                    <div class="relative">
                        <label class="block font-bold text-slate-700 mb-1">품목 (코드 또는 품명 검색) *</label>
                        <input type="text" id="wh-item-input" list="wh-item-datalist" required placeholder="예: 6BO10006 또는 PAO 6" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none" autocomplete="off" />
                        <datalist id="wh-item-datalist"></datalist>
                        <div id="wh-item-name" class="text-[10px] mt-0.5 text-slate-400"></div>
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">보관 위치 (거점 또는 거점 · 건물) *</label>
                        <select id="wh-location-select" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                            ${locationOptionsHtml(state.locations)}
                        </select>
                    </div>
                    <div class="bg-slate-50 rounded-xl border border-slate-200 p-2.5 flex items-center justify-between">
                        <span class="text-slate-500 font-bold">현재 등록된 수량</span>
                        <span id="wh-current-qty" class="font-mono font-black text-slate-700">-</span>
                    </div>
                    <div>
                        <label class="block font-bold text-indigo-700 mb-1">등록할 보관 수량 *</label>
                        <input type="number" id="wh-qty-input" required min="0" step="any" placeholder="0" class="w-full bg-indigo-50/50 border border-indigo-200 rounded-xl px-3 py-2 text-xs font-black text-indigo-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">비고 (선택)</label>
                        <input type="text" id="wh-reason-input" placeholder="예: 신규 창고 배치 등록" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs" />
                    </div>
                    <div class="pt-1 flex justify-end gap-2">
                        <button type="button" id="btn-cancel-warehouse-stock" class="px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50">취소</button>
                        <button type="submit" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm">등록 및 클라우드 반영</button>
                    </div>
                </form>
            </div>
        </div>
    </section>
    `;

    let activeDateRange = 'all';
    let editingInvItem = null;

    const dateFromInput = container.querySelector('#inv-date-from');
    const dateToInput = container.querySelector('#inv-date-to');
    const modalDateEdit = container.querySelector('#modal-inv-date-edit');
    const modalItemInfo = container.querySelector('#modal-inv-item-info');
    const modalInputDate = container.querySelector('#modal-inv-input-date');

    const setDateRange = (rangeType) => {
        activeDateRange = rangeType;
        container.querySelectorAll('.btn-inv-quick-date').forEach(b => {
            if (b.getAttribute('data-range') === rangeType) {
                b.classList.add('bg-blue-600', 'text-white');
                b.classList.remove('bg-white', 'text-slate-700');
            } else {
                b.classList.remove('bg-blue-600', 'text-white');
                b.classList.add('bg-white', 'text-slate-700');
            }
        });

        const today = new Date();
        const formatDate = (d) => localDateStr(d);

        if (rangeType === 'all') {
            dateFromInput.value = '';
            dateToInput.value = '';
        } else if (rangeType === 'today') {
            dateFromInput.value = formatDate(today);
            dateToInput.value = formatDate(today);
        } else if (rangeType === '7days') {
            const past7 = new Date();
            past7.setDate(today.getDate() - 7);
            dateFromInput.value = formatDate(past7);
            dateToInput.value = formatDate(today);
        } else if (rangeType === '30days') {
            const past30 = new Date();
            past30.setDate(today.getDate() - 30);
            dateFromInput.value = formatDate(past30);
            dateToInput.value = formatDate(today);
        } else if (rangeType === 'month') {
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            dateFromInput.value = formatDate(firstDay);
            dateToInput.value = formatDate(today);
        }
        renderTable();
    };

    container.querySelectorAll('.btn-inv-quick-date').forEach(btn => {
        btn.addEventListener('click', () => {
            setDateRange(btn.getAttribute('data-range'));
        });
    });

    container.querySelector('#btn-inv-date-apply')?.addEventListener('click', () => {
        activeDateRange = 'custom';
        renderTable();
    });

    // ==========================================
    // 페이지 나누기 (기본: 전체 표시. 검색·필터 조건이 바뀌면 첫 페이지로, 일자 수정 후에는 현재 페이지 유지)
    // ==========================================
    let currentPage = 1;
    let pageSize = 'all';
    let lastFilterSignature = '';
    const pageInfoEl = container.querySelector('#inv-page-info');
    const pageButtonsEl = container.querySelector('#inv-page-buttons');

    const pageBtn = (label, page, { disabled = false, active = false, title = '' } = {}) => `
        <button type="button" class="btn-inv-page px-2.5 py-1 border rounded-md text-[11px] font-bold transition disabled:opacity-30 disabled:pointer-events-none ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}"
            data-page="${page}" ${disabled ? 'disabled' : ''} ${title ? `title="${esc(title)}"` : ''}>${esc(label)}</button>`;

    // rows를 현재 페이지만큼 잘라 반환하고 페이지 표시줄을 갱신 (signature가 바뀌면 첫 페이지로)
    const paginate = (rows, signature) => {
        if (signature !== lastFilterSignature) {
            currentPage = 1;
            lastFilterSignature = signature;
        }
        const total = rows.length;
        const size = pageSize === 'all' ? Math.max(total, 1) : pageSize;
        const totalPages = Math.max(1, Math.ceil(total / size));
        currentPage = Math.min(Math.max(1, currentPage), totalPages);
        const start = (currentPage - 1) * size;
        const end = Math.min(start + size, total);

        pageInfoEl.textContent = `총 ${total.toLocaleString()}건 중 ${total > 0 ? (start + 1).toLocaleString() : 0}~${end.toLocaleString()}건 표시${totalPages > 1 ? ` (페이지 ${currentPage}/${totalPages})` : ''}`;
        if (totalPages <= 1) {
            pageButtonsEl.innerHTML = '';
        } else {
            const from = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
            const to = Math.min(totalPages, from + 4);
            let html = pageBtn('«', 1, { disabled: currentPage === 1, title: '첫 페이지' })
                + pageBtn('‹', currentPage - 1, { disabled: currentPage === 1, title: '이전 페이지' });
            for (let p = from; p <= to; p++) html += pageBtn(String(p), p, { active: p === currentPage });
            html += pageBtn('›', currentPage + 1, { disabled: currentPage === totalPages, title: '다음 페이지' })
                + pageBtn('»', totalPages, { disabled: currentPage === totalPages, title: '마지막 페이지' });
            pageButtonsEl.innerHTML = html;
        }
        return rows.slice(start, end);
    };

    pageButtonsEl?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-inv-page');
        if (!btn || btn.disabled) return;
        currentPage = Number(btn.getAttribute('data-page')) || 1;
        renderTable();
        createIcons({ icons });
        container.querySelector('#inv-table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    container.querySelector('#inv-page-size')?.addEventListener('change', (e) => {
        pageSize = e.target.value === 'all' ? 'all' : Number(e.target.value);
        currentPage = 1;
        renderTable();
        createIcons({ icons });
    });

    // 분류별 보기 상태 (기기별 기억)
    const view = (() => { try { return { cat: '', group: false, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') }; } catch { return { cat: '', group: false }; } })();
    const saveView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* 무시 */ } };
    const catRank = (c) => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? 100 : i; };
    const sortCats = (cats) => [...cats].sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b, 'ko'));

    // 분류 합계: 원료·원액은 L·kg, 그 밖은 단위별 수량
    const totalsText = (items) => {
        if (items.length && items.every(i => isRawCategory(catOf(i)))) {
            let l = 0; let kg = 0;
            items.forEach(i => { const a = rawAmounts(i, i.quantity); l += a.liters; kg += a.kg; });
            return `${fmt1(l)} L · ${fmt1(kg)} kg`;
        }
        const byUnit = new Map();
        items.forEach(i => byUnit.set(i.unit || 'EA', (byUnit.get(i.unit || 'EA') || 0) + (Number(i.quantity) || 0)));
        return [...byUnit].map(([u, q]) => `${fmt1(q)} ${u}`).join(' · ');
    };

    const drawCatBar = (base) => {
        const bar = container.querySelector('#inv-cat-bar');
        if (!bar) return;
        const counts = new Map();
        base.forEach(i => counts.set(catOf(i), (counts.get(catOf(i)) || 0) + 1));
        if (view.cat && !counts.has(view.cat)) counts.set(view.cat, 0);
        const chip = (value, label, n) => `<button type="button" class="inv-cat-chip px-2.5 py-1 rounded-lg border font-bold transition ${view.cat === value ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}" data-cat="${esc(value)}">${esc(label)} <span class="${view.cat === value ? 'text-blue-100' : 'text-slate-400'}">${n.toLocaleString()}</span></button>`;
        bar.innerHTML = `<span class="font-bold text-slate-600 mr-0.5">분류:</span>`
            + chip('', '전체', base.length)
            + sortCats(counts.keys()).map(c => chip(c, c, counts.get(c))).join('')
            + `<label class="ml-auto flex items-center gap-1.5 cursor-pointer bg-white px-2.5 py-1 border border-slate-300 rounded-lg font-bold text-slate-700"><input type="checkbox" id="inv-group-cat" ${view.group ? 'checked' : ''} class="rounded text-blue-600" />분류별 묶어 보기</label>`;
        bar.querySelectorAll('.inv-cat-chip').forEach(b => b.addEventListener('click', () => { view.cat = b.dataset.cat; saveView(); renderTable(); }));
        bar.querySelector('#inv-group-cat').addEventListener('change', (e) => { view.group = e.target.checked; saveView(); renderTable(); });
    };

    const renderTable = () => {
        const locFilter = container.querySelector('#inv-filter-location').value;
        const partnerFilter = container.querySelector('#inv-filter-partner').value;
        const dangerOnly = container.querySelector('#inv-filter-danger').checked;
        const search = container.querySelector('#inv-search-input').value.trim();
        const dateFrom = dateFromInput.value;
        const dateTo = dateToInput.value;

        const baseFiltered = state.inventory.filter(item => {
            const masterItem = masterOf(item.code);
            const matchesLoc = matchesLocationFilter(item.location, locFilter);
            const matchesPartner = !partnerFilter || (masterItem.supplier === partnerFilter);
            
            // 부분 문자 인식 검색 (코드, 품목명, 규격, 거래처, 분류)
            const matchesSearch = !search || matchesQuery({
                ...item,
                supplier: masterItem.supplier || '',
                spec: item.spec || masterItem.spec || '',
                category: item.category || masterItem.category || ''
            }, search, ['code', 'name', 'spec', 'supplier', 'category', 'location']);

            // 달력 일자 범위 검사
            const matchesDate = isDateInRange(item.lastUpdated, dateFrom, dateTo);

            const isLow = (Number(item.quantity) || 0) <= (Number(masterItem.safety) || 0);
            if (dangerOnly && !isLow) return false;

            return matchesLoc && matchesPartner && matchesSearch && matchesDate;
        });
        // 분류 칩 (다른 조건으로 거른 뒤의 분류별 건수)
        drawCatBar(baseFiltered);
        const catFiltered = view.cat ? baseFiltered.filter(i => catOf(i) === view.cat) : baseFiltered;
        // 엑셀식 열 필터
        let filtered = invColFilter.apply(catFiltered);
        // 분류별 묶어 보기: 분류 순서로 정렬 (분류 안에서는 원래 순서)
        if (view.group) filtered = filtered.map((it, idx) => ({ it, idx })).sort((a, b) => catRank(catOf(a.it)) - catRank(catOf(b.it)) || catOf(a.it).localeCompare(catOf(b.it), 'ko') || a.idx - b.idx).map(x => x.it);
        invColFilter.attach(container.querySelector('#inv-table-wrap'), () => catFiltered, () => {
            renderTable();
            createIcons({ icons });
        }, { clearHost: container.querySelector('#inv-colfilter-clear') });

        // 페이지 나누기 (검색·필터 조건이 바뀌면 첫 페이지로)
        const pageRows = paginate(filtered, JSON.stringify([
            locFilter, partnerFilter, dangerOnly, search, dateFrom, dateTo, invColFilter.signature(), view.cat, view.group
        ]));

        const tbody = container.querySelector('#inventory-table-body');
        const cardList = container.querySelector('#inv-card-list');
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-slate-400 text-xs">일치하는 재고 내역이 없습니다. (검색어, 일자 범위 또는 열 필터를 확인하세요)</td></tr>`;
            if (cardList) cardList.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">일치하는 재고 내역이 없습니다.</div>`;
            return;
        }

        const rows = pageRows.map(item => {
            const masterItem = masterOf(item.code);
            const safety = Number(masterItem.safety) || 0;
            const qty = Number(item.quantity) || 0;
            const isDanger = qty <= safety;
            const isZero = qty === 0;

            let badge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">정상 보관</span>`;
            if (isZero) {
                badge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 animate-pulse">결품 위험 (0EA)</span>`;
            } else if (isDanger) {
                badge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">안전재고 부족</span>`;
            }

            const sub = masterItem.subCategory || determineSubCategory(masterItem);
            const cat = item.category || masterItem.category || '완제품';

            // 원료·원액은 원료수불부 단위: L(재고량) + kg(중량 = L × 비중)
            const isRawCat = isRawCategory(cat);
            const dualQtyHtml = (v) => {
                const n = Number(v) || 0;
                if (!isRawCat) return `${n.toLocaleString()} ${esc(item.unit || 'EA')}`;
                const a = rawAmounts(item, n);
                return `${fmt1(a.liters)} L<span class="block text-[10px] font-bold text-slate-400" title="비중(SG) ${a.sg}">${fmt1(a.kg)} kg</span>`;
            };

            let catBadgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
            if (cat === '완제품') catBadgeClass = 'bg-blue-50 text-blue-700 border-blue-200';
            else if (cat === '부자재') catBadgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
            else if (cat === '원료') catBadgeClass = 'bg-rose-50 text-rose-700 border-rose-200';
            else if (cat === '소모품') catBadgeClass = 'bg-purple-50 text-purple-700 border-purple-200';

            let subBadgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
            let subIcon = '🏷️';
            if (sub === 'ODM') { subBadgeClass = 'bg-blue-100 text-blue-800 border-blue-300'; subIcon = '🏢'; }
            else if (sub === '자사') { subBadgeClass = 'bg-amber-100 text-amber-800 border-amber-300'; subIcon = '⭐'; }
            else if (sub === '기타제품') { subBadgeClass = 'bg-slate-100 text-slate-800 border-slate-300'; subIcon = '📦'; }
            else if (sub === '라벨') { subBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300'; subIcon = '🏷️'; }
            else if (sub === '아웃박스') { subBadgeClass = 'bg-amber-100 text-amber-800 border-amber-300'; subIcon = '📦'; }
            else if (sub === '인박스') { subBadgeClass = 'bg-indigo-100 text-indigo-800 border-indigo-300'; subIcon = '📥'; }
            else if (sub === '캡') { subBadgeClass = 'bg-cyan-100 text-cyan-800 border-cyan-300'; subIcon = '🔘'; }
            else if (sub === '용기') { subBadgeClass = 'bg-purple-100 text-purple-800 border-purple-300'; subIcon = '🫙'; }
            else if (sub === '드럼') { subBadgeClass = 'bg-slate-100 text-slate-800 border-slate-300'; subIcon = '🛢️'; }
            else if (sub === '원료') { subBadgeClass = 'bg-rose-100 text-rose-800 border-rose-300'; subIcon = '🧪'; }

            const thumbHtml = masterItem.imageUrl ? `<img src="${esc(masterItem.imageUrl)}" alt="${esc(item.name)}" class="w-full h-full object-cover">` : `<i data-lucide="package" class="w-4 h-4 text-slate-400"></i>`;

            const card = `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3">
                <div class="flex items-start gap-3">
                    <div class="btn-thumb-inv w-11 h-11 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0 cursor-pointer" data-code="${esc(item.code)}">
                        ${thumbHtml}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center flex-wrap gap-1.5 mb-1">
                            <span class="font-mono font-bold text-blue-600">${esc(item.code)}</span>
                            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black border ${catBadgeClass}">${esc(cat)}</span>
                            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${subBadgeClass}"><span>${subIcon}</span><span>${esc(sub)}</span></span>
                        </div>
                        <div class="font-bold text-slate-900 text-sm break-words">${esc(item.name)}</div>
                        <div class="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                            <span class="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0"></span>
                            <span>${esc(item.location)}</span><span>·</span><span class="truncate">${esc(masterItem.supplier || '거래처 미등록')}</span>
                        </div>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100 text-[11px]">
                    <div><span class="text-slate-400 block">보관 수량</span><span class="font-black text-sm ${isDanger ? 'text-rose-600' : 'text-blue-600'}">${dualQtyHtml(qty)}</span></div>
                    <div><span class="text-slate-400 block">기준 안전재고</span><span class="font-bold text-slate-500">${dualQtyHtml(safety)}</span></div>
                </div>
                <div class="mt-2">${badge}</div>
                <div class="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-100">
                    <span class="font-mono text-[11px] text-slate-500">최종 갱신: ${item.lastUpdated || '-'}</span>
                    <button type="button" class="btn-edit-date px-3 py-2 rounded-lg text-[11px] font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 flex items-center gap-1 min-h-11" data-code="${esc(item.code)}" data-loc="${esc(item.location)}" title="일자 등록/수정"><i data-lucide="calendar" class="w-3.5 h-3.5"></i><span>일자 수정</span></button>
                </div>
            </div>
            `;

            const tr = `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-bold text-slate-800 flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span>${esc(item.location)}</span>
                </td>
                <td class="p-2 text-center">
                    <div class="btn-thumb-inv w-8 h-8 mx-auto rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-blue-400 transition" data-code="${esc(item.code)}">
                        ${thumbHtml}
                    </div>
                </td>
                <td class="p-3 font-mono font-bold text-blue-600">${esc(item.code)}</td>
                <td class="p-3">
                    <div class="flex flex-col gap-1 items-start">
                        <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black border ${catBadgeClass}">
                            ${esc(cat)}
                        </span>
                        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${subBadgeClass}">
                            <span>${subIcon}</span> <span>${esc(sub)}</span>
                        </span>
                    </div>
                </td>
                <td class="p-3 font-bold text-slate-900">${esc(item.name)}</td>
                <td class="p-3 text-slate-600 font-bold">${esc(masterItem.supplier || '-')}</td>
                <td class="p-3 text-right font-black text-sm ${isDanger ? 'text-rose-600' : 'text-blue-600'}">${dualQtyHtml(qty)}</td>
                <td class="p-3 text-right font-bold text-slate-400">${dualQtyHtml(safety)}</td>
                <td class="p-3 text-center">${badge}</td>
                <td class="p-3">
                    <div class="flex items-center justify-between gap-1">
                        <span class="font-mono text-[11px] text-slate-600">${item.lastUpdated || '-'}</span>
                        <button type="button" class="btn-edit-date p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition min-w-11 min-h-11 inline-flex items-center justify-center" data-code="${esc(item.code)}" data-loc="${esc(item.location)}" title="일자 등록/수정">
                            <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </td>
            </tr>
            `;
            return { tr, card };
        });

        if (view.group) {
            // 분류 머리줄: 품목 수와 합계 (합계는 페이지와 무관하게 조건에 맞는 전체 기준)
            const byCat = new Map();
            filtered.forEach(i => { const c = catOf(i); if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(i); });
            let trs = ''; let cards = ''; let prev = null;
            pageRows.forEach((item, idx) => {
                const c = catOf(item);
                if (c !== prev) {
                    const list = byCat.get(c) || [];
                    const head = `${esc(c)} <span class="font-bold opacity-80">${list.length.toLocaleString()}개 품목 · 합계 ${esc(totalsText(list))}</span>`;
                    trs += `<tr class="bg-blue-50/80"><td colspan="10" class="px-3 py-2 font-black text-blue-900 text-xs">${head}</td></tr>`;
                    cards += `<div class="px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 font-black text-blue-900 text-xs">${head}</div>`;
                    prev = c;
                }
                trs += rows[idx].tr;
                cards += rows[idx].card;
            });
            tbody.innerHTML = trs;
            if (cardList) cardList.innerHTML = cards;
        } else {
            tbody.innerHTML = rows.map(r => r.tr).join('');
            if (cardList) cardList.innerHTML = rows.map(r => r.card).join('');
        }

        container.querySelectorAll('.btn-thumb-inv').forEach(b => {
            b.addEventListener('click', () => {
                const code = b.getAttribute('data-code');
                const m = state.master.find(item => item.code === code);
                if (m && window.__openImagePreview) {
                    window.__openImagePreview(m.code, m.name, m.spec, m.imageUrl);
                }
            });
        });

        // 일자 등록/수정 버튼 클릭 이벤트
        container.querySelectorAll('.btn-edit-date').forEach(b => {
            b.addEventListener('click', () => {
                const code = b.getAttribute('data-code');
                const loc = b.getAttribute('data-loc');
                const inv = state.inventory.find(i => i.code === code && i.location === loc);
                if (!inv) return;

                editingInvItem = inv;
                modalItemInfo.textContent = `[${inv.code}] ${inv.name} (${inv.location})`;
                
                // 기존 날짜 추출 (YYYY-MM-DD)
                modalInputDate.value = toDateKey(inv.lastUpdated) || localDateStr();
                modalDateEdit.classList.remove('hidden');
            });
        });

        createIcons({ icons });
    };

    container.querySelector('#btn-close-inv-date-modal')?.addEventListener('click', () => {
        modalDateEdit.classList.add('hidden');
    });
    container.querySelector('#btn-cancel-inv-date')?.addEventListener('click', () => {
        modalDateEdit.classList.add('hidden');
    });

    container.querySelector('#btn-save-inv-date')?.addEventListener('click', async () => {
        if (!editingInvItem) return;
        const newDate = modalInputDate.value;
        if (!newDate) {
            alert('등록할 일자를 선택하세요.');
            return;
        }

        const formatted = `${newDate} ${new Date().toLocaleTimeString('ko-KR')}`;
        await updateInventoryDate(editingInvItem.code, editingInvItem.location, formatted);
        modalDateEdit.classList.add('hidden');
        showToast(`📅 [${editingInvItem.code}] 재고 일자가 '${newDate}'(으)로 등록되었습니다.`);
        renderTable();
    });

    // ==========================================
    // 품목별 창고(건물)별 보관재고 등록
    // ==========================================
    const modalWarehouseStock = container.querySelector('#modal-warehouse-stock');
    const whItemInput = container.querySelector('#wh-item-input');
    const whItemDatalist = container.querySelector('#wh-item-datalist');
    const whItemNameEl = container.querySelector('#wh-item-name');
    const whLocationSelect = container.querySelector('#wh-location-select');
    const whCurrentQtyEl = container.querySelector('#wh-current-qty');
    const whQtyInput = container.querySelector('#wh-qty-input');

    const resolveWhItem = () => {
        const val = whItemInput.value.trim();
        if (!val) return null;
        const code = val.split(/\s/)[0];
        return state.master.find(m => m.code === code) || state.master.find(m => m.name === val) || null;
    };

    const refreshWhCurrentQty = () => {
        const item = resolveWhItem();
        const loc = whLocationSelect.value;
        if (!item || !loc) {
            whCurrentQtyEl.textContent = '-';
            whItemNameEl.textContent = '';
            return;
        }
        whItemNameEl.textContent = item.name;
        whItemNameEl.className = 'text-[10px] mt-0.5 text-emerald-700';
        const inv = state.inventory.find(i => i.code === item.code && i.location === loc);
        const qty = Number(inv?.quantity) || 0;
        whCurrentQtyEl.textContent = `${qty.toLocaleString()} ${item.unit || 'EA'}`;
        if (document.activeElement !== whQtyInput) whQtyInput.value = qty;
    };

    const openWarehouseStockModal = () => {
        whItemDatalist.innerHTML = state.master.map(m => `<option value="${esc(m.code)}">${esc(m.name)}</option>`).join('');
        whItemInput.value = '';
        whItemNameEl.textContent = '';
        whLocationSelect.innerHTML = locationOptionsHtml(state.locations);
        whCurrentQtyEl.textContent = '-';
        whQtyInput.value = '';
        container.querySelector('#wh-reason-input').value = '';
        modalWarehouseStock.classList.remove('hidden');
    };
    const closeWarehouseStockModal = () => modalWarehouseStock.classList.add('hidden');

    container.querySelector('#btn-open-warehouse-stock')?.addEventListener('click', openWarehouseStockModal);
    container.querySelector('#btn-close-warehouse-stock')?.addEventListener('click', closeWarehouseStockModal);
    container.querySelector('#btn-cancel-warehouse-stock')?.addEventListener('click', closeWarehouseStockModal);

    whItemInput?.addEventListener('input', refreshWhCurrentQty);
    whItemInput?.addEventListener('change', refreshWhCurrentQty);
    whLocationSelect?.addEventListener('change', refreshWhCurrentQty);

    container.querySelector('#form-warehouse-stock')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const item = resolveWhItem();
        if (!item) {
            alert('품목 마스터에 있는 품목코드 또는 정확한 품명을 입력하세요.');
            return;
        }
        const loc = whLocationSelect.value;
        const qty = Number(whQtyInput.value);
        if (!(qty >= 0)) {
            alert('등록할 보관 수량을 입력하세요.');
            return;
        }
        const reason = container.querySelector('#wh-reason-input').value.trim();
        await commitStockAudit(
            { [`${item.code}___${loc}`]: { actualQty: qty, reason: reason || '창고별 보관재고 등록' } },
            state.currentGlobalWorker,
            localDateStr()
        );
        closeWarehouseStockModal();
        showToast(`🏬 [${item.code}] ${item.name}의 '${loc}' 보관 수량을 ${qty.toLocaleString()} ${item.unit || 'EA'}(으)로 등록했습니다.`);
        renderTable();
    });

    container.querySelector('#inv-filter-location')?.addEventListener('change', renderTable);
    container.querySelector('#inv-filter-partner')?.addEventListener('change', renderTable);
    container.querySelector('#inv-filter-danger')?.addEventListener('change', renderTable);
    
    // 검색창 문자 일부입력 실시간 디바운스 검색
    let invSearchDebounce = null;
    container.querySelector('#inv-search-input')?.addEventListener('input', () => {
        clearTimeout(invSearchDebounce);
        invSearchDebounce = setTimeout(renderTable, 180);
    });
    dateFromInput?.addEventListener('change', renderTable);
    dateToInput?.addEventListener('change', renderTable);

    container.querySelector('#btn-export-inventory-excel')?.addEventListener('click', () => {
        const dateFrom = dateFromInput.value;
        const dateTo = dateToInput.value;
        const search = container.querySelector('#inv-search-input').value.trim();
        const locFilter = container.querySelector('#inv-filter-location').value;

        const filtered = state.inventory.filter(item => {
            if (!matchesLocationFilter(item.location, locFilter)) return false;
            const masterItem = state.master.find(m => m.code === item.code) || {};
            const matchesSearch = !search || matchesQuery({
                ...item,
                supplier: masterItem.supplier || ''
            }, search, ['code', 'name', 'spec', 'supplier', 'location']);
            const matchesDate = isDateInRange(item.lastUpdated, dateFrom, dateTo);
            return matchesSearch && matchesDate;
        });

        // 화면과 같게: 분류 칩 → 열 필터 → (묶어 보기면) 분류 순서
        let rowsOut = invColFilter.apply(view.cat ? filtered.filter(i => catOf(i) === view.cat) : filtered);
        if (view.group) rowsOut = rowsOut.map((it, idx) => ({ it, idx })).sort((a, b) => catRank(catOf(a.it)) - catRank(catOf(b.it)) || catOf(a.it).localeCompare(catOf(b.it), 'ko') || a.idx - b.idx).map(x => x.it);
        const ws = XLSX.utils.json_to_sheet(rowsOut.map(i => {
            const masterItem = state.master.find(m => m.code === i.code) || {};
            const raw = isRawCategory(catOf(i)) ? rawAmounts(i, i.quantity) : null;
            return {
                "보관거점": siteOf(i.location),
                "건물": buildingOf(i.location) || '-',
                "품목코드": i.code,
                "대분류": i.category,
                "소분류(종류)": masterItem.subCategory || determineSubCategory(masterItem),
                "품목명": i.name,
                "주요거래처": masterItem.supplier || '-',
                "규격": i.spec,
                // 원료·원액은 원료수불부 단위 (L, kg)
                "수량": raw ? Math.round(raw.liters * 1000) / 1000 : i.quantity,
                "단위": raw ? 'L' : i.unit,
                "중량(kg)": raw ? Math.round(raw.kg * 10) / 10 : '',
                "비중(SG)": raw ? raw.sg : '',
                "안전재고": masterItem.safety || 0,
                "상태": i.status,
                "최종갱신일자": i.lastUpdated
            };
        }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "창고재고현황");
        const dateSuffix = dateFrom || dateTo ? `_${dateFrom || '시작'}~${dateTo || '현재'}` : `_${localDateStr()}`;
        XLSX.writeFile(wb, `WMS_창고재고현황${dateSuffix}.xlsx`);
        showToast('📥 재고 엑셀 파일이 다운로드되었습니다.');
    });

    // 실사 웹앱 새 창 열기 & 재고실사 탭 이동 이벤트
    container.querySelector('#btn-inv-open-google-audit')?.addEventListener('click', () => {
        const w = 1040;
        const h = 880;
        const left = Math.max(0, Math.round((window.screen.width - w) / 2));
        const top = Math.max(0, Math.round((window.screen.height - h) / 2));
        const popup = window.open(
            GOOGLE_AUDIT_URL, 
            'GoogleAuditAppPopup', 
            `width=${w},height=${h},top=${top},left=${left},status=yes,toolbar=no,menubar=no,location=yes,scrollbars=yes,resizable=yes`
        );
        if (popup) {
            popup.focus();
            localStorage.setItem('daelim_google_connected', 'true');
            showToast('🔐 구글 로그인 및 실시간 재고실사 웹앱 창이 열렸습니다.');
        } else {
            window.open(GOOGLE_AUDIT_URL, '_blank');
            showToast('🚀 새 탭에서 구글 실사 웹앱이 열렸습니다.');
        }
    });

    container.querySelector('#btn-inv-goto-audit-tab')?.addEventListener('click', () => {
        if (onSwitchTab) {
            onSwitchTab('audit');
        } else {
            window.location.hash = '#audit';
        }
    });

    renderTable();
    createIcons({ icons });
};
