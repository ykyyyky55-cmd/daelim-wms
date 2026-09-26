import { state, addRawLedgerEntry, updateRawLedgerEntry, deleteRawLedgerEntry, saveRawLedger, rawSecurityCodeOf, setRawSecurityCode } from '../services/db.js';
import { matchesQuery, isDateInRange, localDateStr } from '../services/searchUtils.js';
import { createIcons, icons } from 'lucide';
import * as XLSX from 'xlsx';
import { createColumnFilter } from './ColumnFilter.js';
import { RAW_LEDGER_REGIONS } from '../services/locations.js';
import { esc } from '../services/html.js';

// 원료수불부 지역 배지
const REGION_BADGE_TONES = { '본사': 'bg-purple-50 text-purple-700 border-purple-200', '방산': 'bg-amber-50 text-amber-700 border-amber-200', '김포2': 'bg-teal-50 text-teal-700 border-teal-200' };
const regionBadge = (loc) => `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold border ${REGION_BADGE_TONES[loc] || 'bg-blue-50 text-blue-700 border-blue-200'}">${esc(loc)}</span>`;

const fmt1 = (n) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// 원료 수불원장 엑셀식 열 필터 (행: 원료수불 전표)
const rawLedgerColFilter = createColumnFilter('rawLedger', [
    { id: 'location', label: '지역', value: r => r.location || '김포' },
    { id: 'date', label: '수불일자', value: r => r.date },
    { id: 'code', label: '품목코드', value: r => r.code },
    { id: 'rawCode', label: '원료코드', value: r => r.rawCode || '' },
    { id: 'name', label: '원료 품명', value: r => r.name },
    { id: 'type', label: '분류', value: r => r.type },
    { id: 'notes', label: '적요', value: r => r.notes },
    { id: 'manufacturer', label: '제조원', value: r => r.manufacturer || '' },
    { id: 'inQty', label: '수 (입고 L)', value: r => (Number(r.inQty) > 0 ? fmt1(r.inQty) : '') },
    { id: 'outQty', label: '불 (출고 L)', value: r => (Number(r.outQty) > 0 ? fmt1(r.outQty) : '') },
    { id: 'stockQty', label: '재고 (L)', value: r => fmt1(r.stockQty) },
    { id: 'sg', label: '비중 (SG)', value: r => (r.sg !== undefined ? Number(r.sg).toFixed(4) : '1.0000') },
    { id: 'unitPrice', label: '단가', value: r => (Number(r.unitPrice) > 0 ? Number(r.unitPrice).toLocaleString() : '') },
    { id: 'remark', label: '비고', value: r => r.remark }
]);

// 원료 현재고량 보기 엑셀식 열 필터 (행: 품목별 최종 전표 요약)
const rawStockColFilter = createColumnFilter('rawStock', [
    { id: 'location', label: '지역', value: r => r.location },
    { id: 'code', label: '품목코드', value: r => r.code },
    { id: 'rawCode', label: '원료코드', value: r => r.rawCode || '' },
    { id: 'name', label: '원료 품명', value: r => r.name },
    { id: 'lastDate', label: '최종 수불일자', value: r => r.lastDate },
    { id: 'lastType', label: '최종구분', value: r => r.lastType },
    { id: 'lastNotes', label: '최종 적요 / 거래처', value: r => r.lastNotes },
    { id: 'lastManufacturer', label: '최종 제조원', value: r => r.lastManufacturer || '' },
    { id: 'currentStock', label: '현재고량 (L)', value: r => fmt1(r.currentStock) },
    { id: 'sg', label: '비중 (SG)', value: r => r.sg.toFixed(4) },
    { id: 'unitPrice', label: '단가', value: r => (r.unitPrice > 0 ? r.unitPrice.toLocaleString() : '') },
    { id: 'lastRemark', label: '최종 비고', value: r => r.lastRemark }
]);

/**
 * 김포공장/본사 원료수불부 및 원료 현재고 현황 컴포넌트
 * - 지역구분 (본사, 김포) 완벽 분리 및 기본값 김포 할당
 * - 원료 수불원장 (누적 상세) & 현재고량 보기 (품목별 최종일자 값 기준) 2대 뷰 지원
 * - 품명 및 기간별 검색, 순차 누적 입력, 품목코드 등록, 수정, 공식 A4 인쇄 및 엑셀 출력
 */
export const renderRawMaterialLedger = (container, { showToast }) => {
    // 뷰 모드 및 필터 상태 관리
    let currentView = 'ledger';         // 'ledger' (원료 수불원장) | 'stock' (현재고량 보기)
    let selectedLocation = 'ALL';      // 'ALL' | '김포' | '본사'
    let selectedMaterial = 'ALL';      // 'ALL' 또는 특정 품목명
    let selectedType = 'ALL';          // 분류 필터 (ALL, 입고, 사용, 재고확인, 이동 등)
    let selectedStockStatus = 'ALL';   // 현재고 뷰용 필터: 'ALL' | 'positive' (재고보유) | 'zero' (재고소진)
    let sortMode = 'sequential';       // ledger: sequential, dateDesc, dateAsc | stock: stockDesc, stockAsc, nameAsc, dateDesc
    let editingItem = null;            // 현재 수정 중인 전표 객체

    container.innerHTML = `
    <div class="space-y-5">
        <!-- 1. 상단 타이틀 및 뷰 모드 전환 헤더 -->
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 rounded-3xl shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-500/20 text-blue-300 border border-blue-400/30">대림오일 스마트 WMS</span>
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">지역구분: 김포 · 본사 · 방산 · 김포2</span>
                    <span class="text-xs text-slate-400 font-mono">구글시트 99종 실물 연동</span>
                </div>
                <h2 class="text-xl font-black tracking-tight flex items-center gap-2.5">
                    <i data-lucide="cylinder" class="w-6 h-6 text-indigo-400"></i>
                    <span id="page-main-title">원료 수불부 (Raw Material Ledger)</span>
                </h2>
                <p class="text-xs text-slate-400 mt-1" id="page-main-desc">공장·창고별 원료의 수·불 누적 원장 및 품목별 최종일자 기준 현재고량을 통합 관리합니다.</p>
            </div>

            <!-- 헤더 우측 액션 버튼 -->
            <div class="flex items-center flex-wrap gap-2">
                <!-- 공식 A4 인쇄 버튼 -->
                <button type="button" id="btn-print-active-view" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white border border-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                    <i data-lucide="printer" class="w-4 h-4 text-sky-400"></i>
                    <span id="btn-print-text">공식 A4 인쇄</span>
                </button>

                <!-- 엑셀 다운로드 버튼 -->
                <button type="button" id="btn-export-active-view" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                    <i data-lucide="file-spreadsheet" class="w-4 h-4"></i>
                    <span>엑셀 다운로드</span>
                </button>

                <!-- 품명 일괄변경 버튼 -->
                <button type="button" id="btn-open-bulk-rename" class="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                    <i data-lucide="pencil-line" class="w-4 h-4"></i>
                    <span>품명 일괄변경</span>
                </button>

                <!-- 신규 전표 등록 버튼 (수불원장 뷰에서만 유효) -->
                <button type="button" id="btn-scroll-to-input" class="px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-95 text-white rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 shadow-sm">
                    <i data-lucide="plus-circle" class="w-4 h-4"></i>
                    <span>원료 수불 등록</span>
                </button>
            </div>
        </div>

        <!-- 2. 메뉴 탭 전환: [원료 수불원장] vs [현재고량 보기] -->
        <div class="bg-white p-2 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2">
                <button type="button" id="view-tab-ledger" class="px-4 py-2.5 rounded-xl font-extrabold text-xs transition flex items-center gap-2 ${currentView === 'ledger' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
                    <i data-lucide="book-open" class="w-4 h-4"></i>
                    <span>원료 수불원장 (누적 상세)</span>
                </button>

                <button type="button" id="view-tab-stock" class="px-4 py-2.5 rounded-xl font-extrabold text-xs transition flex items-center gap-2 ${currentView === 'stock' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
                    <i data-lucide="boxes" class="w-4 h-4"></i>
                    <span>현재고량 보기 (품목별 최종일자)</span>
                    <span id="badge-stock-count" class="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-mono font-bold">99종</span>
                </button>
            </div>

            <!-- 지역구분 퀵 토글 (전체 / 김포 / 본사) -->
            <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                <span class="text-[11px] text-slate-500 px-2 flex items-center gap-1">
                    <i data-lucide="map-pin" class="w-3.5 h-3.5 text-slate-400"></i>
                    <span>지역:</span>
                </span>
                <button type="button" class="btn-location-toggle px-3 py-1 rounded-lg transition ${selectedLocation === 'ALL' ? 'bg-white text-blue-700 shadow-2xs font-black' : 'text-slate-600 hover:text-slate-900'}" data-location="ALL">전체</button>
                ${RAW_LEDGER_REGIONS.map(r => `<button type="button" class="btn-location-toggle px-3 py-1 rounded-lg transition ${selectedLocation === r.value ? `bg-white ${r.value === '본사' ? 'text-purple-700' : 'text-blue-700'} shadow-2xs font-black` : 'text-slate-600 hover:text-slate-900'}" data-location="${esc(r.value)}">${r.label.split(' (')[0]}</button>`).join('')}
            </div>
        </div>

        <!-- 3. 실시간 집계 요약 KPI 카드 (뷰 모드에 따라 다르게 표시) -->
        <div id="kpi-container" class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <!-- 동적으로 채워짐 -->
        </div>

        <!-- 4. 원료 수불 전표 빠른 신규 입력 폼 (수불원장 뷰에서만 노출) -->
        <div id="section-raw-input" class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <div class="flex items-center gap-2">
                    <span class="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                        <i data-lucide="edit-3" class="w-4 h-4"></i>
                    </span>
                    <div>
                        <h3 class="font-extrabold text-sm text-slate-900">신규 원료 수불 전표 입력 (누적 등록)</h3>
                        <p class="text-[11px] text-slate-500">지역구분(김포/본사/방산/김포2)을 지정하여 순서대로 누적되며 직전 재고 기반 자동 산출됩니다.</p>
                    </div>
                </div>
                <span class="px-2.5 py-1 text-[10px] font-bold bg-blue-50 text-blue-700 rounded-lg border border-blue-200">
                    직전 재고 기반 자동 산출
                </span>
            </div>

            <form id="form-raw-ledger" class="space-y-3">
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    <!-- 1. 일자 -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">수불 일자 <span class="text-rose-500">*</span></label>
                        <input type="date" id="input-raw-date" required value="${localDateStr()}" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>

                    <!-- 2. 지역구분 (김포 / 본사) -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">지역구분 <span class="text-rose-500">*</span></label>
                        <select id="input-raw-location" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer">
                            ${RAW_LEDGER_REGIONS.map(r => `<option value="${esc(r.value)}" ${r.value === '김포' ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
                        </select>
                    </div>

                    <!-- 3. 품목코드 (입력하면 원료 품명 자동 채움) -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1 flex items-center justify-between">
                            <span>품목코드</span>
                            <button type="button" id="btn-quick-fill-code" class="text-[10px] text-blue-600 hover:underline font-bold" title="품명으로 마스터에서 코드 자동 찾기">자동 검색</button>
                        </label>
                        <input type="text" id="input-raw-code" list="datalist-raw-codes" placeholder="예: DP030006, 6BO00020" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-indigo-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" autocomplete="off" />
                        <datalist id="datalist-raw-codes"></datalist>
                    </div>

                    <!-- 4. 원료코드 (보안 코드: 작업지시서에 품명 대신 인쇄) -->
                    <div>
                        <label class="block text-[11px] font-bold text-amber-700 mb-1" title="작업지시서 출력 시 원료 품명 대신 인쇄되는 보안 코드">원료코드 🔒</label>
                        <input type="text" id="input-raw-seccode" placeholder="보안 코드" class="w-full bg-amber-50/60 border border-amber-300 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-amber-900 focus:bg-white focus:ring-2 focus:ring-amber-500 focus:outline-none" autocomplete="off" />
                    </div>

                    <!-- 5. 원료 품명 -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">원료 품명 <span class="text-rose-500">*</span></label>
                        <input type="text" id="input-raw-name" list="datalist-raw-names" required placeholder="예: 그레핀, D40, 용제9호" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" autocomplete="off" />
                        <datalist id="datalist-raw-names"></datalist>
                    </div>

                    <!-- 5. 분류 (입고, 사용, 재고확인, 이동 등) -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">수불 분류 <span class="text-rose-500">*</span></label>
                        <select id="input-raw-type" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer">
                            <option value="입고" selected>📥 입고</option>
                            <option value="사용">📤 사용 (생산·투입)</option>
                            <option value="재고확인">🔍 재고확인 (실사)</option>
                            <option value="이동">🚚 거점이동 (본사↔김포)</option>
                            <option value="입출고">🔄 입출고 동시</option>
                            <option value="조정">⚙️ 재고조정</option>
                        </select>
                    </div>

                    <!-- 6. 적요 (상세 내용) -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">적요 / 거래처 / 세부용도</label>
                        <input type="text" id="input-raw-notes" placeholder="예: 호진상사 입고, 그래핀희석액 15L 제조 등" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>

                    <!-- 6-1. 제조원 (거래처와 별개로 실제 제조사 구분, 입고·사용 관리용) -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">제조원</label>
                        <input type="text" id="input-raw-manufacturer" list="datalist-raw-manufacturers" placeholder="예: 쉐브론, 엑슨모빌" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" autocomplete="off" />
                        <datalist id="datalist-raw-manufacturers"></datalist>
                    </div>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-1">
                    <!-- 7. 수 (입고량 L) -->
                    <div>
                        <label class="block text-[11px] font-bold text-blue-700 mb-1">수 (입고 L)</label>
                        <input type="number" id="input-raw-in" step="any" min="0" placeholder="0.0" class="w-full bg-blue-50/50 border border-blue-200 rounded-xl px-2.5 py-1.5 text-xs font-black text-blue-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>

                    <!-- 8. 불 (출고량 L) -->
                    <div>
                        <label class="block text-[11px] font-bold text-rose-700 mb-1">불 (출고/사용 L)</label>
                        <input type="number" id="input-raw-out" step="any" min="0" placeholder="0.0" class="w-full bg-rose-50/50 border border-rose-200 rounded-xl px-2.5 py-1.5 text-xs font-black text-rose-800 focus:bg-white focus:ring-2 focus:ring-rose-500 focus:outline-none" />
                    </div>

                    <!-- 9. 비중 (SG) -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">비중 (SG)</label>
                        <input type="number" id="input-raw-sg" step="0.0001" min="0.1" max="3" value="1.0000" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>

                    <!-- 10. D/M (드럼수) -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">D/M (드럼/용기)</label>
                        <input type="number" id="input-raw-dm" step="any" min="0" placeholder="0" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>

                    <!-- 11. 단가 -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">단가 (원)</label>
                        <input type="number" id="input-raw-price" step="any" min="0" placeholder="0" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>

                    <!-- 12. 등록 실행 버튼 -->
                    <div class="flex items-end">
                        <button type="submit" class="w-full py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-extrabold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5 h-[34px]">
                            <i data-lucide="plus" class="w-4 h-4"></i>
                            <span>전표 누적 등록</span>
                        </button>
                    </div>
                </div>
            </form>
        </div>

        <!-- 5. 검색 및 필터 툴바 -->
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <!-- 품명 및 키워드 실시간 부분 검색창 -->
                <div class="flex items-center gap-2 flex-1 max-w-md">
                    <div class="relative flex-1">
                        <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-3 top-2.5"></i>
                        <input type="text" id="raw-search-input" placeholder="원료품명, 품목코드, 적요, 비고 (문자 일부 검색)..." class="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <button type="button" id="btn-raw-search-reset" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition">
                        초기화
                    </button>
                </div>

                <!-- 수불원장 뷰 전용 기간 선택 필터 -->
                <div id="filter-period-wrapper" class="flex items-center flex-wrap gap-1.5">
                    <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                        <button type="button" class="btn-raw-period px-2.5 py-1 rounded-lg transition bg-white text-blue-700 shadow-2xs" data-range="all">전체</button>
                        <button type="button" class="btn-raw-period px-2.5 py-1 rounded-lg transition" data-range="month">당월</button>
                        <button type="button" class="btn-raw-period px-2.5 py-1 rounded-lg transition" data-range="3month">3개월</button>
                        <button type="button" class="btn-raw-period px-2.5 py-1 rounded-lg transition" data-range="year">1년</button>
                    </div>

                    <div class="flex items-center gap-1 text-xs">
                        <input type="date" id="raw-date-from" class="bg-white border border-slate-300 rounded-xl px-2 py-1 text-xs font-bold text-slate-700" />
                        <span class="text-slate-400 font-bold">~</span>
                        <input type="date" id="raw-date-to" class="bg-white border border-slate-300 rounded-xl px-2 py-1 text-xs font-bold text-slate-700" />
                        <button type="button" id="btn-raw-date-apply" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs">적용</button>
                    </div>
                </div>

                <!-- 현재고 뷰 전용 재고상태 필터 -->
                <div id="filter-stock-status-wrapper" class="hidden flex items-center gap-2">
                    <select id="raw-filter-stock-status" class="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700">
                        <option value="ALL">전체 품목 (재고보유+소진)</option>
                        <option value="positive">재고 보유 품목 (> 0 L)</option>
                        <option value="zero">재고 소진 품목 (0 L)</option>
                    </select>
                </div>

                <!-- 정렬 및 수불 분류 선택 -->
                <div class="flex items-center gap-2">
                    <!-- 수불 분류 (원장 뷰용) -->
                    <select id="raw-filter-type" class="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700">
                        <option value="ALL">모든 분류</option>
                        <option value="입고">입고</option>
                        <option value="사용">사용 (출고)</option>
                        <option value="재고확인">재고확인 (실사)</option>
                        <option value="이동">거점이동</option>
                    </select>

                    <!-- 정렬 모드 -->
                    <select id="raw-sort-mode" class="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700">
                        <!-- 동적으로 채워짐 -->
                    </select>
                </div>
            </div>

            <!-- 원료 품목별 99종 드롭다운 선택 및 퀵 선택 칩 (수불원장 뷰 전용) -->
            <div id="chips-and-dropdown-container" class="pt-2 border-t border-slate-100 flex flex-col md:flex-row md:items-center gap-2 text-xs">
                <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-[11px] font-bold text-slate-500 whitespace-nowrap">원료 품목:</span>
                    <select id="raw-material-dropdown-select" class="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-800 max-w-[220px]">
                        <option value="ALL">전체 원료 (전체 보기)</option>
                    </select>
                </div>
                <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 pb-1" id="raw-material-chips-wrapper">
                    <!-- 동적으로 채워짐 -->
                </div>
            </div>
        </div>

        <!-- 6. 메인 테이블 영역 (수불원장 테이블 OR 현재고량 보기 테이블). 좁은 화면(폰)에서는 카드 목록으로 -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" id="main-table-card">
            <div id="raw-colfilter-clear" class="flex justify-end px-3 pt-2 empty:hidden"></div>
            <!-- 표 위쪽 가로 스크롤바 (표가 길 때 아래까지 내려가지 않고도 좌우로 넘길 수 있도록 아래 표와 스크롤을 맞춘다) -->
            <div class="overflow-x-auto hidden md:block" id="raw-top-scroll">
                <div id="raw-top-scroll-inner" style="height:1px;"></div>
            </div>
            <div class="overflow-auto hidden md:block max-h-[65vh]" id="raw-table-wrap">
                <table class="w-full text-left text-xs" id="raw-active-table">
                    <!-- 동적으로 thead와 tbody가 렌더링됨 -->
                </table>
            </div>
            <div id="raw-card-list" class="md:hidden p-3 space-y-2.5">
                <!-- 동적으로 카드가 렌더링됨 -->
            </div>

            <!-- 페이지 나누기 (전표 7천여 건을 한 번에 그리면 화면이 느려지므로) -->
            <div id="raw-pagination-bar" class="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 border-t border-slate-200 text-xs no-print">
                <div class="flex items-center gap-2 text-slate-600 font-medium">
                    <span id="raw-page-info" class="font-bold text-slate-700">총 0건 중 0~0건 표시</span>
                    <div class="flex items-center gap-1 ml-2">
                        <span class="text-slate-400 text-[11px]">페이지당:</span>
                        <select id="raw-page-size" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer">
                            <option value="50">50건</option>
                            <option value="100" selected>100건</option>
                            <option value="200">200건</option>
                            <option value="500">500건</option>
                            <option value="all">전체 (모두 표시, 느릴 수 있음)</option>
                        </select>
                    </div>
                </div>
                <div class="flex items-center gap-1 select-none" id="raw-page-buttons"></div>
            </div>

            <!-- 하단 카운트 및 합계 푸터 -->
            <div class="p-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between text-xs text-slate-600 gap-2" id="table-footer-bar">
                <!-- 동적으로 채워짐 -->
            </div>
        </div>
    </div>

    <!-- 7. 전표 수정 모달 -->
    <div id="modal-edit-raw" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 no-print">
        <div class="bg-white max-w-lg w-full rounded-2xl shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div class="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <i data-lucide="edit" class="w-4 h-4 text-blue-400"></i>
                    <h3 class="font-bold text-sm">원료 수불 전표 수정</h3>
                </div>
                <button type="button" id="btn-close-edit-modal" class="text-slate-400 hover:text-white text-lg font-bold">&times;</button>
            </div>

            <form id="form-edit-raw-entry" class="p-5 space-y-3 text-xs">
                <input type="hidden" id="edit-raw-id" />

                <div class="grid grid-cols-3 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">수불 일자 *</label>
                        <input type="date" id="edit-raw-date" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">지역구분 *</label>
                        <select id="edit-raw-location" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold">
                            ${RAW_LEDGER_REGIONS.map(r => `<option value="${esc(r.value)}">${esc(r.label)}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">수불 분류 *</label>
                        <select id="edit-raw-type" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold">
                            <option value="입고">입고</option>
                            <option value="사용">사용 (출고)</option>
                            <option value="재고확인">재고확인 (실사)</option>
                            <option value="이동">거점이동</option>
                            <option value="입출고">입출고 동시</option>
                            <option value="조정">재고조정</option>
                        </select>
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">품목코드</label>
                        <input type="text" id="edit-raw-code" placeholder="예: DP030006" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono font-bold" />
                    </div>
                    <div>
                        <label class="block font-bold text-amber-700 mb-1" title="이 원료의 모든 전표에 함께 적용됩니다">원료코드 🔒</label>
                        <input type="text" id="edit-raw-seccode" placeholder="보안 코드" class="w-full bg-amber-50/60 border border-amber-300 rounded-xl px-3 py-2 font-mono font-bold text-amber-900" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">원료 품명 *</label>
                        <input type="text" id="edit-raw-name" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold" />
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">적요 (세부내용)</label>
                        <input type="text" id="edit-raw-notes" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">제조원</label>
                        <input type="text" id="edit-raw-manufacturer" placeholder="예: 쉐브론, 엑슨모빌" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2" />
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-3">
                    <div>
                        <label class="block font-bold text-blue-700 mb-1">수 (입고 L)</label>
                        <input type="number" id="edit-raw-in" step="any" min="0" class="w-full bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 font-bold text-blue-800" />
                    </div>
                    <div>
                        <label class="block font-bold text-rose-700 mb-1">불 (출고 L)</label>
                        <input type="number" id="edit-raw-out" step="any" min="0" class="w-full bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold text-rose-800" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">재고 (L)</label>
                        <input type="number" id="edit-raw-stock" step="any" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold" />
                    </div>
                </div>

                <div class="grid grid-cols-4 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">중량 (KG)</label>
                        <input type="number" id="edit-raw-weight" step="any" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">비중 (SG)</label>
                        <input type="number" id="edit-raw-sg" step="0.0001" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">D/M</label>
                        <input type="number" id="edit-raw-dm" step="any" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">단가 (원)</label>
                        <input type="number" id="edit-raw-price" step="any" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2" />
                    </div>
                </div>

                <div>
                    <label class="block font-bold text-slate-700 mb-1">비고 (상세 메모)</label>
                    <input type="text" id="edit-raw-remark" placeholder="예: 15L 제조" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2" />
                </div>

                <div class="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                    <button type="button" id="btn-cancel-edit-modal" class="px-4 py-2 border border-slate-300 rounded-xl font-bold text-slate-600 hover:bg-slate-50">취소</button>
                    <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-sm">변경사항 저장</button>
                </div>
            </form>
        </div>
    </div>

    <!-- 8. 품명 일괄변경 모달 -->
    <div id="modal-bulk-rename" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 no-print">
        <div class="bg-white max-w-lg w-full rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
            <div class="px-5 py-4 bg-amber-600 text-white flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <i data-lucide="pencil-line" class="w-4 h-4"></i>
                    <h3 class="font-bold text-sm">원료 품명 일괄변경</h3>
                </div>
                <button type="button" id="btn-close-bulk-rename" class="text-amber-100 hover:text-white text-lg font-bold">&times;</button>
            </div>

            <div class="p-5 space-y-4 text-xs">
                <!-- 현재 품명 선택 -->
                <div>
                    <label class="block font-bold text-slate-700 mb-1.5">변경할 품명 (현재 품명 선택) <span class="text-rose-500">*</span></label>
                    <div class="flex gap-2">
                        <select id="bulk-rename-from-select" class="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                            <option value="">-- 변경할 품명 선택 --</option>
                        </select>
                        <input type="text" id="bulk-rename-from-input" placeholder="또는 직접 입력..." class="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                    </div>
                    <p class="text-[11px] text-slate-400 mt-1">선택 또는 직접 입력 중 하나를 사용하세요. 직접 입력이 우선 적용됩니다.</p>
                </div>

                <!-- 새 품명 입력 -->
                <div>
                    <label class="block font-bold text-slate-700 mb-1.5">새 품명 (변경 후 이름) <span class="text-rose-500">*</span></label>
                    <input type="text" id="bulk-rename-to" placeholder="예: D-40, 그래핀, 용제9호(코코졸)" class="w-full bg-white border-2 border-amber-300 rounded-xl px-3 py-2 font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm" />
                </div>

                <!-- 적용 지역 선택 -->
                <div>
                    <label class="block font-bold text-slate-700 mb-1.5">적용 지역</label>
                    <div class="flex flex-wrap gap-2">
                        <label class="flex items-center gap-1.5 cursor-pointer">
                            <input type="radio" name="bulk-rename-location" value="ALL" checked class="accent-amber-500" /> 전체 지역
                        </label>
                        ${RAW_LEDGER_REGIONS.map(r => `
                        <label class="flex items-center gap-1.5 cursor-pointer">
                            <input type="radio" name="bulk-rename-location" value="${esc(r.value)}" class="accent-amber-500" /> ${r.label.split(' (')[0]}만
                        </label>`).join('')}
                    </div>
                </div>

                <!-- 미리보기 -->
                <div id="bulk-rename-preview" class="hidden bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px]">
                    <p class="font-bold text-amber-800 mb-1">📋 변경 미리보기</p>
                    <p id="bulk-rename-preview-text" class="text-amber-700"></p>
                </div>

                <!-- 버튼 -->
                <div class="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button type="button" id="btn-bulk-rename-preview" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition flex items-center gap-1.5">
                        <i data-lucide="eye" class="w-3.5 h-3.5"></i>
                        미리보기
                    </button>
                    <div class="flex gap-2">
                        <button type="button" id="btn-cancel-bulk-rename" class="px-4 py-2 border border-slate-300 rounded-xl font-bold text-slate-600 hover:bg-slate-50">취소</button>
                        <button type="button" id="btn-confirm-bulk-rename" class="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold shadow-sm flex items-center gap-1.5">
                            <i data-lucide="check" class="w-3.5 h-3.5"></i>
                            일괄변경 실행
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;

    // ==========================================
    // DOM 엘리먼트 참조
    // ==========================================
    const searchInput = container.querySelector('#raw-search-input');
    const dateFromInput = container.querySelector('#raw-date-from');
    const dateToInput = container.querySelector('#raw-date-to');
    const typeSelect = container.querySelector('#raw-filter-type');
    const stockStatusSelect = container.querySelector('#raw-filter-stock-status');
    const sortSelect = container.querySelector('#raw-sort-mode');
    const activeTable = container.querySelector('#raw-active-table');
    const kpiContainer = container.querySelector('#kpi-container');
    const chipsWrapper = container.querySelector('#raw-material-chips-wrapper');
    const materialDropdown = container.querySelector('#raw-material-dropdown-select');
    const chipsAndDropdownContainer = container.querySelector('#chips-and-dropdown-container');
    const inputSection = container.querySelector('#section-raw-input');
    const filterPeriodWrapper = container.querySelector('#filter-period-wrapper');
    const filterStockStatusWrapper = container.querySelector('#filter-stock-status-wrapper');
    const tableFooterBar = container.querySelector('#table-footer-bar');

    // 표 위쪽 가로 스크롤바를 아래 표와 폭·스크롤 위치 양방향으로 동기화
    const topScroll = container.querySelector('#raw-top-scroll');
    const topScrollInner = container.querySelector('#raw-top-scroll-inner');
    const tableWrap = container.querySelector('#raw-table-wrap');
    let syncingScroll = false;
    const syncTopScrollWidth = () => {
        if (topScrollInner && activeTable) topScrollInner.style.width = `${activeTable.scrollWidth}px`;
    };
    topScroll?.addEventListener('scroll', () => {
        if (syncingScroll) return;
        syncingScroll = true;
        tableWrap.scrollLeft = topScroll.scrollLeft;
        syncingScroll = false;
    });
    tableWrap?.addEventListener('scroll', () => {
        if (syncingScroll) return;
        syncingScroll = true;
        topScroll.scrollLeft = tableWrap.scrollLeft;
        syncingScroll = false;
    });
    window.addEventListener('resize', syncTopScrollWidth);
    if (window.ResizeObserver && activeTable) {
        new ResizeObserver(syncTopScrollWidth).observe(activeTable);
    }

    const editModal = container.querySelector('#modal-edit-raw');
    const editForm = container.querySelector('#form-edit-raw-entry');

    // ==========================================
    // 정렬 드롭다운 옵션 갱신 함수
    // ==========================================
    const updateSortOptions = () => {
        if (currentView === 'ledger') {
            sortSelect.innerHTML = `
                <option value="sequential" ${sortMode === 'sequential' ? 'selected' : ''}>입력 누적순 (기본)</option>
                <option value="dateDesc" ${sortMode === 'dateDesc' ? 'selected' : ''}>최신 일자순 (최신→과거)</option>
                <option value="dateAsc" ${sortMode === 'dateAsc' ? 'selected' : ''}>일자순 (과거→최신)</option>
            `;
        } else {
            sortSelect.innerHTML = `
                <option value="stockDesc" ${sortMode === 'stockDesc' ? 'selected' : ''}>현재고 많은순 (내림차순)</option>
                <option value="stockAsc" ${sortMode === 'stockAsc' ? 'selected' : ''}>현재고 적은순 (오름차순)</option>
                <option value="nameAsc" ${sortMode === 'nameAsc' ? 'selected' : ''}>품목명순 (가나다)</option>
                <option value="dateDesc" ${sortMode === 'dateDesc' ? 'selected' : ''}>최종일자 최신순</option>
            `;
        }
    };

    // ==========================================
    // 뷰 모드 전환 (원료 수불원장 vs 현재고량 보기)
    // ==========================================
    const setViewMode = (mode) => {
        currentView = mode;
        const tabLedger = container.querySelector('#view-tab-ledger');
        const tabStock = container.querySelector('#view-tab-stock');
        const printText = container.querySelector('#btn-print-text');
        const pageTitle = container.querySelector('#page-main-title');
        const pageDesc = container.querySelector('#page-main-desc');

        if (mode === 'ledger') {
            tabLedger.className = 'px-4 py-2.5 rounded-xl font-extrabold text-xs transition flex items-center gap-2 bg-blue-600 text-white shadow-sm';
            tabStock.className = 'px-4 py-2.5 rounded-xl font-extrabold text-xs transition flex items-center gap-2 bg-slate-100 text-slate-700 hover:bg-slate-200';
            inputSection.classList.remove('hidden');
            chipsAndDropdownContainer.classList.remove('hidden');
            filterPeriodWrapper.classList.remove('hidden');
            filterStockStatusWrapper.classList.add('hidden');
            typeSelect.classList.remove('hidden');
            printText.textContent = '공식 원장 A4 인쇄';
            pageTitle.textContent = '원료 수불부 (Raw Material Ledger)';
            pageDesc.textContent = '공장·창고별 원료의 입출고·사용 누적 거래 원장입니다. 생산 입고를 등록하면 투입 원료(사용)와 생산 원액(입고)이 자동 기입됩니다.';
            if (!['sequential', 'dateDesc', 'dateAsc'].includes(sortMode)) sortMode = 'sequential';
        } else {
            tabLedger.className = 'px-4 py-2.5 rounded-xl font-extrabold text-xs transition flex items-center gap-2 bg-slate-100 text-slate-700 hover:bg-slate-200';
            tabStock.className = 'px-4 py-2.5 rounded-xl font-extrabold text-xs transition flex items-center gap-2 bg-emerald-600 text-white shadow-sm';
            inputSection.classList.add('hidden');
            chipsAndDropdownContainer.classList.add('hidden');
            filterPeriodWrapper.classList.add('hidden');
            filterStockStatusWrapper.classList.remove('hidden');
            typeSelect.classList.add('hidden');
            printText.textContent = '현재고 현황 A4 인쇄';
            pageTitle.textContent = '원료 현재고 현황 (품목별 최종일자 기준)';
            pageDesc.textContent = '각 원료 품목의 최종 수불일자 재고를 집계하여 실시간 현재고량(L/KG)을 확인합니다.';
            if (!['stockDesc', 'stockAsc', 'nameAsc', 'dateDesc'].includes(sortMode)) sortMode = 'stockDesc';
        }

        updateSortOptions();
        renderView();
        createIcons({ icons });
    };

    container.querySelector('#view-tab-ledger')?.addEventListener('click', () => setViewMode('ledger'));
    container.querySelector('#view-tab-stock')?.addEventListener('click', () => setViewMode('stock'));

    // 지역구분 토글 버튼
    container.querySelectorAll('.btn-location-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedLocation = btn.getAttribute('data-location') || 'ALL';
            container.querySelectorAll('.btn-location-toggle').forEach(b => {
                const loc = b.getAttribute('data-location');
                if (loc === selectedLocation) {
                    b.className = `btn-location-toggle px-3 py-1 rounded-lg transition bg-white ${loc === '본사' ? 'text-purple-700' : 'text-blue-700'} shadow-2xs font-black`;
                } else {
                    b.className = 'btn-location-toggle px-3 py-1 rounded-lg transition text-slate-600 hover:text-slate-900';
                }
            });
            renderMaterialChips();
            renderView();
        });
    });

    // ==========================================
    // 자동 완성 및 데이터리스트 동기화
    // ==========================================
    const updateDatalists = () => {
        const rawNames = new Set(state.rawLedger.map(r => r.name).filter(Boolean));
        state.master
            .filter(m => m.category === '원료' || m.category === '원액')
            .forEach(m => rawNames.add(m.name));

        const nameDatalist = container.querySelector('#datalist-raw-names');
        if (nameDatalist) {
            nameDatalist.innerHTML = Array.from(rawNames).map(n => `<option value="${esc(n)}"></option>`).join('');
        }

        // 품목코드 목록 (코드 → 원료수불부 품명, 없으면 마스터 품명을 함께 표시)
        const rawCodes = new Map();
        state.rawLedger.forEach(r => { if (r.code) rawCodes.set(r.code, r.name); });
        state.master
            .filter(m => m.category === '원료' || m.category === '원액')
            .forEach(m => { if (!rawCodes.has(m.code)) rawCodes.set(m.code, m.name); });

        const codeDatalist = container.querySelector('#datalist-raw-codes');
        if (codeDatalist) {
            codeDatalist.innerHTML = Array.from(rawCodes).map(([c, n]) => `<option value="${esc(c)}">${esc(n || '')}</option>`).join('');
        }

        // 제조원 목록 (기존 전표 + 마스터 품목에 등록된 값)
        const manufacturers = new Set(state.rawLedger.map(r => r.manufacturer).filter(Boolean));
        state.master.forEach(m => { if (m.manufacturer) manufacturers.add(m.manufacturer); });
        const manufacturerDatalist = container.querySelector('#datalist-raw-manufacturers');
        if (manufacturerDatalist) {
            manufacturerDatalist.innerHTML = Array.from(manufacturers).map(n => `<option value="${esc(n)}"></option>`).join('');
        }
    };
    updateDatalists();

    // ==========================================
    // 품명 입력 시 마스터 품목코드 및 비중 자동 매핑
    // ==========================================
    const rawNameInput = container.querySelector('#input-raw-name');
    const rawCodeInput = container.querySelector('#input-raw-code');
    const rawSgInput = container.querySelector('#input-raw-sg');

    const autoMatchCodeFromName = (name) => {
        if (!name) return;
        const existing = state.rawLedger.find(r => r.name.toLowerCase() === name.toLowerCase() && r.code);
        if (existing) {
            rawCodeInput.value = existing.code;
            if (existing.sg) rawSgInput.value = existing.sg;
            return;
        }

        const match = state.master.find(m => m.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(m.name.toLowerCase()));
        if (match) {
            rawCodeInput.value = match.code;
        }
    };

    const rawSecInput = container.querySelector('#input-raw-seccode');
    // 이 원료에 이미 지정된 원료코드(보안 코드)를 채운다
    const fillSecurityCode = () => {
        if (!rawSecInput || rawSecInput.value.trim()) return;
        const sec = rawSecurityCodeOf(rawCodeInput.value.trim(), rawNameInput.value.trim());
        if (sec) rawSecInput.value = sec;
    };

    rawNameInput?.addEventListener('blur', (e) => {
        if (!rawCodeInput.value.trim()) autoMatchCodeFromName(e.target.value.trim()); // 품목코드를 먼저 입력했으면 그대로 둔다
        fillSecurityCode();
    });

    // 품목코드 입력 시 원료수불부(같은 코드의 최근 전표) → 품목 마스터 순으로 원료 품명·비중 자동 채움
    const autoFillNameFromCode = (code) => {
        if (!code) return;
        let existing = null;
        for (let i = state.rawLedger.length - 1; i >= 0; i--) {
            if (state.rawLedger[i].code === code) { existing = state.rawLedger[i]; break; }
        }
        if (existing) {
            rawNameInput.value = existing.name;
            if (existing.sg) rawSgInput.value = existing.sg;
            return;
        }
        const m = state.master.find(x => x.code === code);
        if (m) rawNameInput.value = m.name;
    };
    rawCodeInput?.addEventListener('change', (e) => {
        autoFillNameFromCode(e.target.value.trim());
        if (rawSecInput) rawSecInput.value = '';
        fillSecurityCode();
    });

    container.querySelector('#btn-quick-fill-code')?.addEventListener('click', () => {
        const val = rawNameInput.value.trim();
        if (!val) {
            alert('먼저 원료 품명을 입력하세요.');
            rawNameInput.focus();
            return;
        }
        autoMatchCodeFromName(val);
        showToast(`🔍 [${val}] 품목코드를 자동 매핑하였습니다.`);
    });

    // ==========================================
    // 원료 칩 (Tabs) 및 드롭다운 렌더링
    // ==========================================
    const renderMaterialChips = () => {
        const materialCounts = {};
        state.rawLedger.forEach(r => {
            if (selectedLocation !== 'ALL' && (r.location || '김포') !== selectedLocation) return;
            const n = r.name || '미지정';
            materialCounts[n] = (materialCounts[n] || 0) + 1;
        });

        const distinctNames = Object.keys(materialCounts).sort((a, b) => a.localeCompare(b, 'ko'));

        // 1. 드롭다운 옵션 갱신
        if (materialDropdown) {
            let dropHtml = `<option value="ALL">전체 원료 (${distinctNames.length}종 / 선택 지역)</option>`;
            distinctNames.forEach(name => {
                dropHtml += `<option value="${esc(name)}" ${selectedMaterial === name ? 'selected' : ''}>${esc(name)} (${materialCounts[name]}건)</option>`;
            });
            materialDropdown.innerHTML = dropHtml;
            materialDropdown.value = selectedMaterial;
        }

        // 2. 가로 스크롤 칩 갱신
        let html = `
            <button type="button" class="btn-material-chip px-3 py-1 rounded-xl font-black transition whitespace-nowrap ${
                selectedMaterial === 'ALL' 
                    ? 'bg-blue-600 text-white shadow-2xs' 
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }" data-material="ALL">
                전체 원료 (${distinctNames.length}종)
            </button>
        `;

        distinctNames.forEach(name => {
            const isSelected = selectedMaterial === name;
            html += `
                <button type="button" class="btn-material-chip px-3 py-1 rounded-xl font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
                    isSelected 
                        ? 'bg-blue-600 text-white shadow-2xs font-black' 
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                }" data-material="${esc(name)}">
                    <span>${esc(name)}</span>
                    <span class="px-1.5 py-0.2 rounded-full text-[10px] ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'} font-mono">${materialCounts[name]}</span>
                </button>
            `;
        });

        chipsWrapper.innerHTML = html;

        chipsWrapper.querySelectorAll('.btn-material-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedMaterial = btn.getAttribute('data-material') || 'ALL';
                renderMaterialChips();
                renderView();
            });
        });
    };

    materialDropdown?.addEventListener('change', (e) => {
        selectedMaterial = e.target.value;
        renderMaterialChips();
        renderView();
    });

    // ==========================================
    // 핵심 뷰 렌더링 디스패처
    // ==========================================
    // ==========================================
    // 페이지 나누기 (검색·필터 조건이 바뀌면 첫 페이지로, 전표 수정·삭제 후에는 현재 페이지 유지)
    // ==========================================
    let currentPage = 1;
    let pageSize = 100;
    let lastFilterSignature = '';
    const pageInfoEl = container.querySelector('#raw-page-info');
    const pageButtonsEl = container.querySelector('#raw-page-buttons');
    const pageSizeSelect = container.querySelector('#raw-page-size');

    const pageBtn = (label, page, { disabled = false, active = false, title = '' } = {}) => `
        <button type="button" class="btn-raw-page px-2.5 py-1 border rounded-md text-[11px] font-bold transition disabled:opacity-30 disabled:pointer-events-none ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}"
            data-page="${page}" ${disabled ? 'disabled' : ''} ${title ? `title="${esc(title)}"` : ''}>${esc(label)}</button>`;

    const renderPageButtons = (total, start, end, totalPages) => {
        pageInfoEl.textContent = `총 ${total.toLocaleString()}건 중 ${total > 0 ? (start + 1).toLocaleString() : 0}~${end.toLocaleString()}건 표시 (페이지 ${currentPage}/${totalPages})`;
        if (totalPages <= 1) { pageButtonsEl.innerHTML = ''; return; }
        const from = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
        const to = Math.min(totalPages, from + 4);
        let html = pageBtn('«', 1, { disabled: currentPage === 1, title: '첫 페이지' })
            + pageBtn('‹', currentPage - 1, { disabled: currentPage === 1, title: '이전 페이지' });
        for (let p = from; p <= to; p++) html += pageBtn(String(p), p, { active: p === currentPage });
        html += pageBtn('›', currentPage + 1, { disabled: currentPage === totalPages, title: '다음 페이지' })
            + pageBtn('»', totalPages, { disabled: currentPage === totalPages, title: '마지막 페이지' });
        pageButtonsEl.innerHTML = html;
    };

    // rows를 현재 페이지만큼 잘라 반환 (signature가 바뀌면 첫 페이지로)
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
        renderPageButtons(total, start, end, totalPages);
        return { pageRows: rows.slice(start, end), start };
    };

    pageButtonsEl?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-raw-page');
        if (!btn || btn.disabled) return;
        currentPage = Number(btn.getAttribute('data-page')) || 1;
        renderView();
        container.querySelector('#main-table-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    pageSizeSelect?.addEventListener('change', (e) => {
        pageSize = e.target.value === 'all' ? 'all' : Number(e.target.value);
        currentPage = 1;
        renderView();
    });

    const renderView = () => {
        if (currentView === 'ledger') {
            renderLedgerTable();
        } else {
            renderStockTable();
        }
        createIcons({ icons });
    };

    // ==========================================
    // 1. 원료 수불원장 테이블 렌더링
    // ==========================================
    const renderLedgerTable = () => {
        const query = searchInput.value.trim();
        const dateFrom = dateFromInput.value;
        const dateTo = dateToInput.value;
        const filterType = typeSelect.value;

        // 필터링
        let filtered = state.rawLedger.filter(item => {
            const itemLoc = item.location || '김포';
            if (selectedLocation !== 'ALL' && itemLoc !== selectedLocation) return false;
            if (selectedMaterial !== 'ALL' && item.name !== selectedMaterial) return false;
            if (filterType !== 'ALL' && item.type !== filterType) return false;
            if (!isDateInRange(item.date, dateFrom, dateTo)) return false;
            if (!matchesQuery(item, query, ['code', 'rawCode', 'name', 'type', 'notes', 'remark', 'worker', 'location'])) return false;
            return true;
        });

        // 정렬
        if (sortMode === 'dateAsc') {
            filtered.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
        } else if (sortMode === 'dateDesc') {
            filtered.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
        }

        // 엑셀식 열 필터 (합계·건수도 필터 결과 기준)
        const baseLedgerRows = filtered;
        filtered = rawLedgerColFilter.apply(filtered);

        // 수불원장 KPI 계산
        let totalIn = 0;
        let totalOut = 0;
        let currentStock = 0;
        let currentWeight = 0;

        filtered.forEach(r => {
            totalIn += Number(r.inQty) || 0;
            totalOut += Number(r.outQty) || 0;
        });

        // 현재 기말 재고
        if (selectedMaterial !== 'ALL') {
            const matRows = state.rawLedger.filter(r => r.name === selectedMaterial && (selectedLocation === 'ALL' || (r.location || '김포') === selectedLocation));
            if (matRows.length > 0) {
                const last = matRows[matRows.length - 1];
                currentStock = Number(last.stockQty) || 0;
                currentWeight = Number(last.weight) || (currentStock * (Number(last.sg) || 1.0));
            }
        } else {
            const latestByMat = {};
            state.rawLedger.forEach(r => {
                if (selectedLocation === 'ALL' || (r.location || '김포') === selectedLocation) {
                    latestByMat[r.name] = r;
                }
            });
            Object.values(latestByMat).forEach(lr => {
                const s = Number(lr.stockQty) || 0;
                currentStock += s;
                currentWeight += Number(lr.weight) || (s * (Number(lr.sg) || 1.0));
            });
        }

        const distinctMats = new Set(filtered.map(r => r.name)).size;

        kpiContainer.innerHTML = `
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
                    <span>총 누적 입고량 (수)</span>
                    <i data-lucide="arrow-down-left" class="w-4 h-4 text-blue-600"></i>
                </div>
                <div class="flex items-baseline gap-1">
                    <span class="text-xl font-black text-blue-700 font-mono">${totalIn.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                    <span class="text-xs text-slate-500 font-bold">L</span>
                </div>
                <span class="text-[10px] text-slate-400 mt-1 block">${filtered.filter(r => (Number(r.inQty) || 0) > 0).length}건 입고 전표</span>
            </div>

            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
                    <span>총 누적 사용량 (불)</span>
                    <i data-lucide="arrow-up-right" class="w-4 h-4 text-rose-600"></i>
                </div>
                <div class="flex items-baseline gap-1">
                    <span class="text-xl font-black text-rose-700 font-mono">${totalOut.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                    <span class="text-xs text-slate-500 font-bold">L</span>
                </div>
                <span class="text-[10px] text-slate-400 mt-1 block">${filtered.filter(r => (Number(r.outQty) || 0) > 0).length}건 생산·투입 전표</span>
            </div>

            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
                    <span>현재 기말 재고량</span>
                    <i data-lucide="database" class="w-4 h-4 text-emerald-600"></i>
                </div>
                <div class="flex items-baseline gap-1">
                    <span class="text-xl font-black text-emerald-700 font-mono">${currentStock.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                    <span class="text-xs text-slate-500 font-bold">L</span>
                </div>
                <span class="text-[10px] text-emerald-600 font-bold mt-1 block">환산 중량: ${currentWeight.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KG</span>
            </div>

            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
                    <span>조회 원료 품목</span>
                    <i data-lucide="layers" class="w-4 h-4 text-purple-600"></i>
                </div>
                <div class="flex items-baseline gap-1">
                    <span class="text-xl font-black text-purple-700 font-mono">${distinctMats}</span>
                    <span class="text-xs text-slate-500 font-bold">개 품목</span>
                </div>
                <span class="text-[10px] text-slate-400 mt-1 block">${selectedLocation === 'ALL' ? '전체 지역' : esc(selectedLocation)} 총 ${filtered.length.toLocaleString()}건 전표</span>
            </div>
        `;

        // 테이블 thead & tbody
        let theadHtml = `
            <thead class="bg-slate-100 text-slate-600 font-bold border-b border-slate-200 sticky top-0 z-10">
                <tr>
                    <th class="p-3 text-center w-12">순번</th>
                    <th class="p-3 text-center whitespace-nowrap" data-filter-col="location">지역</th>
                    <th class="p-3 whitespace-nowrap" data-filter-col="date">수불일자</th>
                    <th class="p-3 whitespace-nowrap" data-filter-col="code">품목코드</th>
                    <th class="p-3 whitespace-nowrap text-amber-700" data-filter-col="rawCode" title="작업지시서에 원료 품명 대신 인쇄되는 보안 코드">원료코드</th>
                    <th class="p-3 whitespace-nowrap" data-filter-col="name">원료 품명</th>
                    <th class="p-3 text-center whitespace-nowrap" data-filter-col="type">분류</th>
                    <th class="p-3 whitespace-nowrap" data-filter-col="notes">적요 (세부내용)</th>
                    <th class="p-3 whitespace-nowrap" data-filter-col="manufacturer">제조원</th>
                    <th class="p-3 text-right whitespace-nowrap text-blue-700 bg-blue-50/30" data-filter-col="inQty">수 (입고 L)</th>
                    <th class="p-3 text-right whitespace-nowrap text-rose-700 bg-rose-50/30" data-filter-col="outQty">불 (출고 L)</th>
                    <th class="p-3 text-right whitespace-nowrap font-black bg-slate-50" data-filter-col="stockQty">재고 (L)</th>
                    <th class="p-3 text-right whitespace-nowrap">중량 (KG)</th>
                    <th class="p-3 text-center whitespace-nowrap" data-filter-col="sg">비중 (SG)</th>
                    <th class="p-3 text-right whitespace-nowrap">D/M</th>
                    <th class="p-3 text-right whitespace-nowrap" data-filter-col="unitPrice">단가</th>
                    <th class="p-3 whitespace-nowrap" data-filter-col="remark">비고</th>
                    <th class="p-3 text-center whitespace-nowrap no-print w-20">관리</th>
                </tr>
            </thead>
        `;

        // 페이지 나누기 (합계·건수는 위에서 전체 결과 기준으로 계산됨)
        const { pageRows, start: pageStart } = paginate(filtered, JSON.stringify([
            'ledger', query, dateFrom, dateTo, filterType, selectedLocation, selectedMaterial, sortMode, rawLedgerColFilter.signature()
        ]));

        let tbodyHtml = '';
        let cardListHtml = '';
        if (filtered.length === 0) {
            tbodyHtml = `<tbody><tr><td colspan="18" class="p-8 text-center text-slate-400 text-xs">일치하는 원료 수불 전표가 없습니다. (검색어, 지역구분 또는 일자 범위를 확인하세요)</td></tr></tbody>`;
            cardListHtml = `<div class="p-8 text-center text-slate-400 text-xs">일치하는 원료 수불 전표가 없습니다.</div>`;
        } else {
            let rowSeq = pageStart + 1; // 페이지를 넘겨도 순번이 이어지도록
            const builtRows = pageRows.map(item => {
                const inQty = Number(item.inQty) || 0;
                const outQty = Number(item.outQty) || 0;
                const stockQty = Number(item.stockQty) || 0;
                const weight = Number(item.weight) || (stockQty * (Number(item.sg) || 1.0));
                const sg = item.sg !== undefined ? Number(item.sg).toFixed(4) : '1.0000';
                const dm = item.dm ? Number(item.dm).toFixed(1) : '-';
                const price = Number(item.unitPrice) || 0;
                const loc = item.location || '김포';

                let locBadge = regionBadge(loc);

                let typeBadge = 'bg-slate-100 text-slate-700 border-slate-200';
                if (item.type === '입고') typeBadge = 'bg-blue-100 text-blue-800 border-blue-200 font-black';
                else if (item.type === '사용') typeBadge = 'bg-rose-100 text-rose-800 border-rose-200 font-bold';
                else if (item.type === '재고확인') typeBadge = 'bg-emerald-100 text-emerald-800 border-emerald-200 font-bold';
                else if (item.type === '이동') typeBadge = 'bg-purple-100 text-purple-800 border-purple-200 font-bold';
                else if (item.type === '입출고') typeBadge = 'bg-amber-100 text-amber-800 border-amber-200 font-bold';

                const seqNo = rowSeq++;
                const codeHtml = item.code ? `
                            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                🏷️ ${esc(item.code)}
                            </span>
                        ` : `<span class="text-slate-300 text-[10px]">-</span>`;
                const inHtml = inQty > 0 ? inQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-';
                const outHtml = outQty > 0 ? outQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-';
                const stockHtml = stockQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                const weightHtml = weight > 0 ? weight.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-';
                const priceHtml = price > 0 ? price.toLocaleString() + '원' : '-';
                const actionsHtml = `
                            <button type="button" class="btn-edit-row p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition min-w-11 min-h-11 inline-flex items-center justify-center" title="수정" data-id="${esc(item.id)}">
                                <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                            </button>
                            <button type="button" class="btn-delete-row p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition min-w-11 min-h-11 inline-flex items-center justify-center" title="삭제" data-id="${esc(item.id)}">
                                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                            </button>`;

                const tr = `
                <tr class="hover:bg-slate-50 transition" data-id="${esc(item.id)}">
                    <td class="p-3 text-center text-slate-400 font-mono text-[11px]">${seqNo}</td>
                    <td class="p-3 text-center whitespace-nowrap">${locBadge}</td>
                    <td class="p-3 whitespace-nowrap font-bold text-slate-700">${esc(item.date)}</td>
                    <td class="p-3 whitespace-nowrap">${codeHtml}</td>
                    <td class="p-3 whitespace-nowrap font-mono text-[11px] font-bold text-amber-800">${esc(item.rawCode) || '<span class="text-slate-300 font-normal">-</span>'}</td>
                    <td class="p-3 whitespace-nowrap font-extrabold text-slate-900">${esc(item.name)}</td>
                    <td class="p-3 text-center whitespace-nowrap">
                        <span class="px-2 py-0.5 rounded-full text-[10px] border ${typeBadge}">
                            ${esc(item.type)}
                        </span>
                    </td>
                    <td class="p-3 max-w-[200px] truncate text-slate-600" title="${esc(item.notes || '')}">${esc(item.notes || '-')}</td>
                    <td class="p-3 whitespace-nowrap text-slate-600">${esc(item.manufacturer) || '<span class="text-slate-300">-</span>'}</td>
                    <td class="p-3 text-right whitespace-nowrap font-bold text-blue-700 bg-blue-50/20">
                        ${inQty > 0 ? inHtml : '<span class="text-slate-300 font-normal">-</span>'}
                    </td>
                    <td class="p-3 text-right whitespace-nowrap font-bold text-rose-700 bg-rose-50/20">
                        ${outQty > 0 ? outHtml : '<span class="text-slate-300 font-normal">-</span>'}
                    </td>
                    <td class="p-3 text-right whitespace-nowrap font-black text-slate-900 bg-slate-50/80">
                        ${stockHtml}
                    </td>
                    <td class="p-3 text-right whitespace-nowrap font-semibold text-emerald-700">
                        ${weightHtml}
                    </td>
                    <td class="p-3 text-center whitespace-nowrap font-mono text-slate-600">${sg}</td>
                    <td class="p-3 text-right whitespace-nowrap text-slate-600 font-mono">${dm}</td>
                    <td class="p-3 text-right whitespace-nowrap font-mono text-slate-600">
                        ${priceHtml}
                    </td>
                    <td class="p-3 max-w-[140px] truncate text-slate-400 text-[11px]" title="${esc(item.remark || '')}">
                        ${esc(item.remark || '-')}
                    </td>
                    <td class="p-3 text-center whitespace-nowrap no-print">
                        <div class="flex items-center justify-center gap-1">${actionsHtml}
                        </div>
                    </td>
                </tr>
                `;

                const card = `
                <div class="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm" data-id="${esc(item.id)}">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5 flex-wrap mb-1">
                                <span class="text-slate-400 font-mono text-[10px]">#${seqNo}</span>
                                ${locBadge}
                                <span class="px-2 py-0.5 rounded-full text-[10px] border ${typeBadge}">${esc(item.type)}</span>
                            </div>
                            <div class="font-extrabold text-slate-900 truncate">${esc(item.name)}</div>
                            <div class="flex items-center gap-1.5 flex-wrap mt-1">${codeHtml}
                                ${item.rawCode ? `<span class="font-mono text-[11px] font-bold text-amber-800">🔒${esc(item.rawCode)}</span>` : ''}
                            </div>
                        </div>
                        <div class="flex items-center gap-1 flex-shrink-0">${actionsHtml}</div>
                    </div>
                    <div class="mt-2 pt-2 border-t border-slate-100 grid grid-cols-4 gap-1.5 text-center text-[11px]">
                        <div><div class="text-slate-400">입고</div><div class="font-bold text-blue-700">${inHtml}</div></div>
                        <div><div class="text-slate-400">출고</div><div class="font-bold text-rose-700">${outHtml}</div></div>
                        <div><div class="text-slate-400">재고</div><div class="font-black text-slate-900">${stockHtml}</div></div>
                        <div><div class="text-slate-400">중량</div><div class="font-semibold text-emerald-700">${weightHtml}</div></div>
                    </div>
                    <div class="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                        <span>${esc(item.date)}</span>
                        <span>비중 ${sg} · D-M ${dm} · ${priceHtml}</span>
                    </div>
                    ${item.notes ? `<div class="mt-1 text-[11px] text-slate-500 truncate" title="${esc(item.notes)}">${esc(item.notes)}</div>` : ''}
                    ${item.manufacturer ? `<div class="mt-0.5 text-[11px] text-slate-500 truncate">제조원: ${esc(item.manufacturer)}</div>` : ''}
                    ${item.remark ? `<div class="mt-0.5 text-[11px] text-slate-400 truncate" title="${esc(item.remark)}">비고: ${esc(item.remark)}</div>` : ''}
                </div>`;

                return { tr, card };
            });
            tbodyHtml = `<tbody class="divide-y divide-slate-100">` + builtRows.map(r => r.tr).join('') + `</tbody>`;
            cardListHtml = builtRows.map(r => r.card).join('');
        }

        activeTable.innerHTML = theadHtml + tbodyHtml;
        syncTopScrollWidth();
        const rawCardList = container.querySelector('#raw-card-list');
        if (rawCardList) rawCardList.innerHTML = cardListHtml;
        rawLedgerColFilter.attach(activeTable, () => baseLedgerRows, renderView, { clearHost: container.querySelector('#raw-colfilter-clear') });

        // 하단 서머리 푸터
        tableFooterBar.innerHTML = `
            <span class="font-bold text-slate-700">총 ${filtered.length.toLocaleString()}건의 원료수불 전표 (지역: ${selectedLocation === 'ALL' ? '전체' : esc(selectedLocation)})</span>
            <div class="flex items-center gap-4 text-xs font-bold flex-wrap">
                <span>선택 입고계: <strong class="text-blue-700">${totalIn.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong> L</span>
                <span>사용계: <strong class="text-rose-700">${totalOut.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong> L</span>
                <span>기말 잔여재고: <strong class="text-emerald-700 font-black">${currentStock.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong> L</span>
            </div>
        `;

        bindTableActions();
    };

    // ==========================================
    // 2. 원료 현재고량 보기 테이블 렌더링 (품목별 최종일자 값 기준)
    // ==========================================
    const renderStockTable = () => {
        const query = searchInput.value.trim().toLowerCase();
        const stockStatus = stockStatusSelect.value;

        // 품목별 그룹화 후 최종일자 전표 도출
        const itemsMap = new Map();

        // 1. 전체 전표를 순회하며 품목별 최신 전표 탐색
        state.rawLedger.forEach(row => {
            const loc = row.location || '김포';
            // 지역구분 필터
            if (selectedLocation !== 'ALL' && loc !== selectedLocation) return;

            const name = (row.name || '').trim();
            if (!name) return;

            if (!itemsMap.has(name)) {
                itemsMap.set(name, row);
            } else {
                const existing = itemsMap.get(name);
                // 일자 기준 비교 (더 최신 일자이거나, 동일 일자면 배열 뒤쪽 행 우선)
                if ((row.date || '') >= (existing.date || '')) {
                    itemsMap.set(name, row);
                }
            }
        });

        // 2. 현재고 품목 리스트 구성
        let stockList = Array.from(itemsMap.values()).map(lastRow => {
            const stockQty = Number(lastRow.stockQty) || 0;
            const sg = Number(lastRow.sg) || 1.0;
            const weight = Number(lastRow.weight) || (stockQty * sg);
            return {
                code: lastRow.code || '',
                rawCode: lastRow.rawCode || '',
                name: lastRow.name,
                location: lastRow.location || '김포',
                lastDate: lastRow.date || '-',
                lastType: lastRow.type || '수불',
                lastNotes: lastRow.notes || '',
                lastManufacturer: lastRow.manufacturer || '',
                currentStock: stockQty,
                currentWeight: weight,
                sg: sg,
                dm: Number(lastRow.dm) || 0,
                unitPrice: Number(lastRow.unitPrice) || 0,
                lastRemark: lastRow.remark || '',
                lastWorker: lastRow.worker || '관리자',
                rawId: lastRow.id
            };
        });

        // 3. 검색어 필터
        if (query) {
            stockList = stockList.filter(item => 
                item.name.toLowerCase().includes(query) ||
                item.code.toLowerCase().includes(query) ||
                item.lastNotes.toLowerCase().includes(query) ||
                item.lastRemark.toLowerCase().includes(query)
            );
        }

        // 4. 재고 상태 필터 (보유/소진)
        if (stockStatus === 'positive') {
            stockList = stockList.filter(i => i.currentStock > 0);
        } else if (stockStatus === 'zero') {
            stockList = stockList.filter(i => i.currentStock <= 0);
        }

        // 5. 정렬
        if (sortMode === 'stockDesc') {
            stockList.sort((a, b) => b.currentStock - a.currentStock);
        } else if (sortMode === 'stockAsc') {
            stockList.sort((a, b) => a.currentStock - b.currentStock);
        } else if (sortMode === 'nameAsc') {
            stockList.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        } else if (sortMode === 'dateDesc') {
            stockList.sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
        }

        // 엑셀식 열 필터 (합계·품목수도 필터 결과 기준)
        const baseStockRows = stockList;
        stockList = rawStockColFilter.apply(stockList);

        // 현재고 뷰 KPI 계산
        let totalCurrentStock = 0;
        let totalCurrentWeight = 0;
        let inStockItemCount = 0;
        const regionStock = {};

        stockList.forEach(item => {
            totalCurrentStock += item.currentStock;
            totalCurrentWeight += item.currentWeight;
            if (item.currentStock > 0) inStockItemCount++;
            const region = item.location || '김포';
            regionStock[region] = (regionStock[region] || 0) + item.currentStock;
        });

        container.querySelector('#badge-stock-count').textContent = `${stockList.length}종`;

        kpiContainer.innerHTML = `
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
                    <span>관리 원료 품목수</span>
                    <i data-lucide="layers" class="w-4 h-4 text-indigo-600"></i>
                </div>
                <div class="flex items-baseline gap-1">
                    <span class="text-xl font-black text-indigo-700 font-mono">${stockList.length}</span>
                    <span class="text-xs text-slate-500 font-bold">개 품목</span>
                </div>
                <span class="text-[10px] text-slate-400 mt-1 block">재고보유: ${inStockItemCount}종 / 소진: ${stockList.length - inStockItemCount}종</span>
            </div>

            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
                    <span>총 원료 현재고량 (L)</span>
                    <i data-lucide="database" class="w-4 h-4 text-emerald-600"></i>
                </div>
                <div class="flex items-baseline gap-1">
                    <span class="text-xl font-black text-emerald-700 font-mono">${totalCurrentStock.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                    <span class="text-xs text-slate-500 font-bold">L</span>
                </div>
                <span class="text-[10px] text-emerald-600 font-bold mt-1 block">품목별 최종일자 재고 총합</span>
            </div>

            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
                    <span>총 환산 중량 (KG)</span>
                    <i data-lucide="scale" class="w-4 h-4 text-blue-600"></i>
                </div>
                <div class="flex items-baseline gap-1">
                    <span class="text-xl font-black text-blue-700 font-mono">${totalCurrentWeight.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                    <span class="text-xs text-slate-500 font-bold">KG</span>
                </div>
                <span class="text-[10px] text-slate-400 mt-1 block">재고(L) × 품목별 비중(SG)</span>
            </div>

            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
                    <span>지역별 재고 분포</span>
                    <i data-lucide="map-pin" class="w-4 h-4 text-purple-600"></i>
                </div>
                <div class="flex flex-wrap items-baseline gap-x-2 text-xs font-bold">
                    ${Object.keys(regionStock).length === 0 ? '<span class="text-slate-400">-</span>' : Object.entries(regionStock).map(([region, qty]) => `<span class="${region === '본사' ? 'text-purple-700' : 'text-blue-700'}">${esc(region)}: ${qty.toLocaleString(undefined, { maximumFractionDigits: 0 })}L</span>`).join('')}
                </div>
                <span class="text-[10px] text-slate-400 mt-1 block">선택 지역: ${selectedLocation === 'ALL' ? '전체 거점' : esc(selectedLocation)}</span>
            </div>
        `;

        // 테이블 thead & tbody (현재고량 보기 전용)
        let theadHtml = `
            <thead class="bg-emerald-50/70 text-emerald-950 font-bold border-b border-emerald-200 sticky top-0 z-10">
                <tr>
                    <th class="p-3 text-center w-12">순번</th>
                    <th class="p-3 text-center whitespace-nowrap" data-filter-col="location">지역</th>
                    <th class="p-3 whitespace-nowrap" data-filter-col="code">품목코드</th>
                    <th class="p-3 whitespace-nowrap text-amber-700" data-filter-col="rawCode" title="작업지시서에 원료 품명 대신 인쇄되는 보안 코드">원료코드</th>
                    <th class="p-3 whitespace-nowrap" data-filter-col="name">원료 품명</th>
                    <th class="p-3 text-center whitespace-nowrap bg-emerald-100/50 text-emerald-900" data-filter-col="lastDate">최종 수불일자</th>
                    <th class="p-3 text-center whitespace-nowrap" data-filter-col="lastType">최종구분</th>
                    <th class="p-3 whitespace-nowrap" data-filter-col="lastNotes">최종 적요 / 거래처</th>
                    <th class="p-3 whitespace-nowrap" data-filter-col="lastManufacturer">최종 제조원</th>
                    <th class="p-3 text-right whitespace-nowrap font-black text-emerald-800 bg-emerald-100/80 text-sm" data-filter-col="currentStock">현재고량 (L)</th>
                    <th class="p-3 text-right whitespace-nowrap font-bold text-emerald-900 bg-emerald-50">환산 중량 (KG)</th>
                    <th class="p-3 text-center whitespace-nowrap font-mono" data-filter-col="sg">비중 (SG)</th>
                    <th class="p-3 text-right whitespace-nowrap">잔여 D/M</th>
                    <th class="p-3 text-right whitespace-nowrap" data-filter-col="unitPrice">단가</th>
                    <th class="p-3 whitespace-nowrap" data-filter-col="lastRemark">최종 비고</th>
                    <th class="p-3 text-center whitespace-nowrap no-print w-24">상세원장</th>
                </tr>
            </thead>
        `;

        // 페이지 나누기 (합계·품목수는 위에서 전체 결과 기준으로 계산됨)
        const { pageRows, start: pageStart } = paginate(stockList, JSON.stringify([
            'stock', query, stockStatus, selectedLocation, sortMode, rawStockColFilter.signature()
        ]));

        let tbodyHtml = '';
        let cardListHtml = '';
        if (stockList.length === 0) {
            tbodyHtml = `<tbody><tr><td colspan="16" class="p-8 text-center text-slate-400 text-xs">일치하는 원료 현재고 데이터가 없습니다.</td></tr></tbody>`;
            cardListHtml = `<div class="p-8 text-center text-slate-400 text-xs">일치하는 원료 현재고 데이터가 없습니다.</div>`;
        } else {
            let rowSeq = pageStart + 1; // 페이지를 넘겨도 순번이 이어지도록
            const builtRows = pageRows.map(item => {
                const loc = item.location || '김포';
                let locBadge = regionBadge(loc);

                const isPositive = item.currentStock > 0;
                const seqNo = rowSeq++;

                const codeHtml = item.code ? `
                            <span class="inline-flex items-center px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-800 border border-slate-200">
                                🏷️ ${esc(item.code)}
                            </span>
                        ` : `<span class="text-slate-300">-</span>`;
                const typeBadgeClass = item.lastType === '입고' ? 'bg-blue-100 text-blue-800' :
                            item.lastType === '사용' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700';
                const stockHtml = `${item.currentStock.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;
                const weightHtml = item.currentWeight > 0 ? item.currentWeight.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' KG' : '-';
                const priceHtml = item.unitPrice > 0 ? item.unitPrice.toLocaleString() + '원' : '-';
                const jumpBtnHtml = `<button type="button" class="btn-jump-to-ledger px-2 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-lg text-[10px] font-bold transition flex items-center justify-center gap-1 min-h-11" data-name="${esc(item.name)}">
                            <i data-lucide="external-link" class="w-3 h-3"></i>
                            <span>원장 보기</span>
                        </button>`;

                const tr = `
                <tr class="hover:bg-emerald-50/30 transition">
                    <td class="p-3 text-center text-slate-400 font-mono text-[11px]">${seqNo}</td>
                    <td class="p-3 text-center whitespace-nowrap">${locBadge}</td>
                    <td class="p-3 whitespace-nowrap font-mono text-[11px]">${codeHtml}</td>
                    <td class="p-3 whitespace-nowrap font-mono text-[11px] font-bold text-amber-800">${esc(item.rawCode) || '<span class="text-slate-300 font-normal">-</span>'}</td>
                    <td class="p-3 whitespace-nowrap font-black text-slate-900 text-xs flex items-center gap-1.5">
                        <i data-lucide="cylinder" class="w-3.5 h-3.5 text-indigo-500"></i>
                        <span>${esc(item.name)}</span>
                    </td>
                    <td class="p-3 text-center whitespace-nowrap font-bold text-slate-700 bg-emerald-50/30 font-mono">
                        📅 ${esc(item.lastDate)}
                    </td>
                    <td class="p-3 text-center whitespace-nowrap">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClass}">
                            ${esc(item.lastType)}
                        </span>
                    </td>
                    <td class="p-3 max-w-[180px] truncate text-slate-600 text-[11px]" title="${esc(item.lastNotes)}">
                        ${esc(item.lastNotes || '-')}
                    </td>
                    <td class="p-3 whitespace-nowrap text-slate-600 text-[11px]">${esc(item.lastManufacturer || '-')}</td>
                    <td class="p-3 text-right whitespace-nowrap bg-emerald-50/50">
                        <span class="inline-block px-2 py-0.5 rounded-lg font-black font-mono text-sm ${
                            isPositive ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-slate-200 text-slate-500'
                        }">
                            ${stockHtml}
                        </span>
                    </td>
                    <td class="p-3 text-right whitespace-nowrap font-bold font-mono text-emerald-800">
                        ${weightHtml}
                    </td>
                    <td class="p-3 text-center whitespace-nowrap font-mono text-slate-600">${item.sg.toFixed(4)}</td>
                    <td class="p-3 text-right whitespace-nowrap font-mono text-slate-600">${item.dm > 0 ? item.dm.toFixed(1) : '-'}</td>
                    <td class="p-3 text-right whitespace-nowrap font-mono text-slate-600">
                        ${priceHtml}
                    </td>
                    <td class="p-3 max-w-[130px] truncate text-slate-400 text-[11px]" title="${esc(item.lastRemark)}">
                        ${esc(item.lastRemark || '-')}
                    </td>
                    <td class="p-3 text-center whitespace-nowrap no-print">
                        <div class="flex items-center justify-center">${jumpBtnHtml}</div>
                    </td>
                </tr>
                `;

                const card = `
                <div class="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5 flex-wrap mb-1">
                                <span class="text-slate-400 font-mono text-[10px]">#${seqNo}</span>
                                ${locBadge}
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${typeBadgeClass}">${esc(item.lastType)}</span>
                            </div>
                            <div class="font-black text-slate-900 text-xs flex items-center gap-1.5">
                                <i data-lucide="cylinder" class="w-3.5 h-3.5 text-indigo-500"></i>
                                <span class="truncate">${esc(item.name)}</span>
                            </div>
                            <div class="flex items-center gap-1.5 flex-wrap mt-1">${codeHtml}
                                ${item.rawCode ? `<span class="font-mono text-[11px] font-bold text-amber-800">🔒${esc(item.rawCode)}</span>` : ''}
                            </div>
                        </div>
                        ${jumpBtnHtml}
                    </div>
                    <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                        <span class="inline-block px-2 py-0.5 rounded-lg font-black font-mono text-sm ${isPositive ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-slate-200 text-slate-500'}">${stockHtml}</span>
                        <span class="font-bold font-mono text-emerald-800 text-xs">${weightHtml}</span>
                    </div>
                    <div class="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                        <span>📅 ${esc(item.lastDate)}</span>
                        <span>비중 ${item.sg.toFixed(4)} · D-M ${item.dm > 0 ? item.dm.toFixed(1) : '-'} · ${priceHtml}</span>
                    </div>
                    ${item.lastNotes ? `<div class="mt-1 text-[11px] text-slate-500 truncate" title="${esc(item.lastNotes)}">${esc(item.lastNotes)}</div>` : ''}
                    ${item.lastManufacturer ? `<div class="mt-0.5 text-[11px] text-slate-500 truncate">제조원: ${esc(item.lastManufacturer)}</div>` : ''}
                    ${item.lastRemark ? `<div class="mt-0.5 text-[11px] text-slate-400 truncate" title="${esc(item.lastRemark)}">비고: ${esc(item.lastRemark)}</div>` : ''}
                </div>`;

                return { tr, card };
            });
            tbodyHtml = `<tbody class="divide-y divide-slate-100">` + builtRows.map(r => r.tr).join('') + `</tbody>`;
            cardListHtml = builtRows.map(r => r.card).join('');
        }

        activeTable.innerHTML = theadHtml + tbodyHtml;
        syncTopScrollWidth();
        const rawCardList2 = container.querySelector('#raw-card-list');
        if (rawCardList2) rawCardList2.innerHTML = cardListHtml;
        rawStockColFilter.attach(activeTable, () => baseStockRows, renderView, { clearHost: container.querySelector('#raw-colfilter-clear') });

        // 하단 서머리 푸터
        tableFooterBar.innerHTML = `
            <span class="font-bold text-slate-700">원료 현재고 집계: 총 ${stockList.length}개 품목 (지역: ${selectedLocation === 'ALL' ? '전체' : esc(selectedLocation)})</span>
            <div class="flex items-center gap-4 text-xs font-bold flex-wrap">
                <span>재고보유 품목: <strong class="text-blue-700">${inStockItemCount}</strong>종</span>
                <span>총 현재고 합계: <strong class="text-emerald-700 font-black text-sm">${totalCurrentStock.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong> L</span>
                <span>총 환산중량: <strong class="text-emerald-800">${totalCurrentWeight.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong> KG</span>
            </div>
        `;

        // 원장 보기 클릭 시 원료 수불원장 탭으로 즉시 이동 & 품목 필터링
        container.querySelectorAll('.btn-jump-to-ledger').forEach(btn => {
            btn.addEventListener('click', () => {
                const matName = btn.getAttribute('data-name');
                if (matName) {
                    selectedMaterial = matName;
                    setViewMode('ledger');
                    renderMaterialChips();
                    renderView();
                    showToast(`📋 [${matName}] 원료 수불원장으로 이동했습니다.`);
                }
            });
        });
    };

    // ==========================================
    // 테이블 수정 및 삭제 이벤트 바인딩
    // ==========================================
    const bindTableActions = () => {
        // 수정 버튼
        container.querySelectorAll('.btn-edit-row').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const item = state.rawLedger.find(r => r.id === id);
                if (!item) return;

                editingItem = item;
                container.querySelector('#edit-raw-id').value = item.id;
                container.querySelector('#edit-raw-date').value = item.date || '';
                container.querySelector('#edit-raw-location').value = item.location || '김포';
                container.querySelector('#edit-raw-type').value = item.type || '입고';
                container.querySelector('#edit-raw-name').value = item.name || '';
                container.querySelector('#edit-raw-code').value = item.code || '';
                container.querySelector('#edit-raw-seccode').value = item.rawCode || rawSecurityCodeOf(item.code, item.name) || '';
                container.querySelector('#edit-raw-notes').value = item.notes || '';
                container.querySelector('#edit-raw-manufacturer').value = item.manufacturer || '';
                container.querySelector('#edit-raw-in').value = item.inQty || '';
                container.querySelector('#edit-raw-out').value = item.outQty || '';
                container.querySelector('#edit-raw-stock').value = item.stockQty || '';
                container.querySelector('#edit-raw-weight').value = item.weight || '';
                container.querySelector('#edit-raw-sg').value = item.sg || 1.0;
                container.querySelector('#edit-raw-dm').value = item.dm || '';
                container.querySelector('#edit-raw-price').value = item.unitPrice || '';
                container.querySelector('#edit-raw-remark').value = item.remark || '';

                editModal.classList.remove('hidden');
            });
        });

        // 삭제 버튼
        container.querySelectorAll('.btn-delete-row').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                const item = state.rawLedger.find(r => r.id === id);
                if (!item) return;

                if (confirm(`정말 [${item.date} ${item.name} (${item.type})] 전표를 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`)) {
                    await deleteRawLedgerEntry(id);
                    showToast('🗑️ 전표가 삭제되었습니다.');
                    renderMaterialChips();
                    renderView();
                }
            });
        });
    };

    // ==========================================
    // 신규 전표 등록 폼 제출 이벤트
    // ==========================================
    const newForm = container.querySelector('#form-raw-ledger');
    newForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const date = container.querySelector('#input-raw-date').value;
        const location = container.querySelector('#input-raw-location').value;
        const name = container.querySelector('#input-raw-name').value.trim();
        const code = container.querySelector('#input-raw-code').value.trim();
        const rawCode = container.querySelector('#input-raw-seccode').value.trim();
        const type = container.querySelector('#input-raw-type').value;
        const notes = container.querySelector('#input-raw-notes').value.trim();
        const manufacturer = container.querySelector('#input-raw-manufacturer').value.trim();
        const inQty = container.querySelector('#input-raw-in').value;
        const outQty = container.querySelector('#input-raw-out').value;
        const sg = container.querySelector('#input-raw-sg').value;
        const dm = container.querySelector('#input-raw-dm').value;
        const unitPrice = container.querySelector('#input-raw-price').value;

        if (!name) {
            alert('원료 품명을 입력해주세요.');
            return;
        }

        try {
            // 원료코드는 원료 하나에 하나: 새로 입력했거나 바꾼 경우 이 원료의 기존 전표에도 함께 적용
            const prevRawCode = rawSecurityCodeOf(code, name);
            if (rawCode && rawCode !== prevRawCode) {
                if (prevRawCode && !confirm(`[${name}]의 원료코드를 '${prevRawCode}'에서 '${rawCode}'(으)로 바꾸고 이 원료의 모든 전표에 적용하시겠습니까?`)) return;
                await setRawSecurityCode({ code, name }, rawCode);
            }
            await addRawLedgerEntry({
                date,
                location,
                name,
                code,
                rawCode: rawCode || prevRawCode,
                type,
                notes,
                manufacturer,
                inQty,
                outQty,
                sg,
                dm,
                unitPrice
            });

            showToast(`✅ [${name}] 수불 전표가 누적 등록되었습니다.`);
            newForm.reset();
            container.querySelector('#input-raw-date').value = localDateStr();
            container.querySelector('#input-raw-location').value = location;
            container.querySelector('#input-raw-sg').value = '1.0000';

            renderMaterialChips();
            renderView();
        } catch (err) {
            alert(`등록 실패: ${err.message}`);
        }
    });

    // ==========================================
    // 전표 수정 모달 저장 이벤트
    // ==========================================
    editForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = container.querySelector('#edit-raw-id').value;
        if (!id) return;

        try {
            // 원료코드 변경은 이 원료의 모든 전표에 적용 (전표 품목코드·품명이 바뀌었으면 바뀐 원료 기준)
            const newCode = container.querySelector('#edit-raw-code').value.trim();
            const newName = container.querySelector('#edit-raw-name').value.trim();
            const newRawCode = container.querySelector('#edit-raw-seccode').value.trim();
            const current = state.rawLedger.find(r => r.id === id);
            const prevRawCode = current?.rawCode || '';
            // 중복 원료코드면 여기서 예외가 나므로 전표는 바뀌지 않는다
            let appliedMsg = '';
            if (newRawCode !== prevRawCode) {
                const n = await setRawSecurityCode({ code: newCode, name: newName }, newRawCode);
                appliedMsg = newRawCode ? ` 원료코드를 이 원료의 전표 ${n}건에 적용했습니다.` : ` 이 원료의 원료코드를 해제했습니다(${n}건).`;
            }
            await updateRawLedgerEntry(id, {
                rawCode: newRawCode,
                date: container.querySelector('#edit-raw-date').value,
                location: container.querySelector('#edit-raw-location').value,
                type: container.querySelector('#edit-raw-type').value,
                name: container.querySelector('#edit-raw-name').value.trim(),
                code: container.querySelector('#edit-raw-code').value.trim(),
                notes: container.querySelector('#edit-raw-notes').value.trim(),
                manufacturer: container.querySelector('#edit-raw-manufacturer').value.trim(),
                inQty: parseFloat(container.querySelector('#edit-raw-in').value) || 0,
                outQty: parseFloat(container.querySelector('#edit-raw-out').value) || 0,
                stockQty: parseFloat(container.querySelector('#edit-raw-stock').value) || 0,
                weight: parseFloat(container.querySelector('#edit-raw-weight').value) || 0,
                sg: parseFloat(container.querySelector('#edit-raw-sg').value) || 1.0,
                dm: parseFloat(container.querySelector('#edit-raw-dm').value) || 0,
                unitPrice: parseFloat(container.querySelector('#edit-raw-price').value) || 0,
                remark: container.querySelector('#edit-raw-remark').value.trim()
            });

            editModal.classList.add('hidden');
            showToast(`💾 전표 수정 사항이 저장되었습니다.${appliedMsg}`);
            renderMaterialChips();
            renderView();
        } catch (err) {
            alert(`수정 실패: ${err.message}`);
        }
    });

    // 모달 닫기
    container.querySelector('#btn-close-edit-modal')?.addEventListener('click', () => editModal.classList.add('hidden'));
    container.querySelector('#btn-cancel-edit-modal')?.addEventListener('click', () => editModal.classList.add('hidden'));

    // 스크롤 이동 버튼
    container.querySelector('#btn-scroll-to-input')?.addEventListener('click', () => {
        if (currentView !== 'ledger') {
            setViewMode('ledger');
        }
        inputSection.scrollIntoView({ behavior: 'smooth' });
        rawNameInput?.focus();
    });

    // ==========================================
    // 검색 및 필터 이벤트 바인딩
    // ==========================================
    searchInput?.addEventListener('input', () => renderView());
    typeSelect?.addEventListener('change', () => renderView());
    stockStatusSelect?.addEventListener('change', () => renderView());
    sortSelect?.addEventListener('change', (e) => {
        sortMode = e.target.value;
        renderView();
    });

    container.querySelector('#btn-raw-search-reset')?.addEventListener('click', () => {
        searchInput.value = '';
        selectedMaterial = 'ALL';
        selectedLocation = 'ALL';
        typeSelect.value = 'ALL';
        stockStatusSelect.value = 'ALL';
        dateFromInput.value = '';
        dateToInput.value = '';
        renderMaterialChips();
        renderView();
    });

    // 기간 빠른 버튼
    container.querySelectorAll('.btn-raw-period').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.btn-raw-period').forEach(b => b.classList.remove('bg-white', 'text-blue-700', 'shadow-2xs'));
            btn.classList.add('bg-white', 'text-blue-700', 'shadow-2xs');

            const range = btn.getAttribute('data-range');
            const now = new Date();
            if (range === 'all') {
                dateFromInput.value = '';
                dateToInput.value = '';
            } else if (range === 'month') {
                const y = now.getFullYear();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                dateFromInput.value = `${y}-${m}-01`;
                dateToInput.value = localDateStr(now);
            } else if (range === '3month') {
                const past = new Date(now);
                past.setMonth(past.getMonth() - 3);
                dateFromInput.value = localDateStr(past);
                dateToInput.value = localDateStr(now);
            } else if (range === 'year') {
                const past = new Date(now);
                past.setFullYear(past.getFullYear() - 1);
                dateFromInput.value = localDateStr(past);
                dateToInput.value = localDateStr(now);
            }
            renderView();
        });
    });

    container.querySelector('#btn-raw-date-apply')?.addEventListener('click', () => renderView());

    // ==========================================
    // 통합 A4 공식 인쇄 (수불원장 인쇄 OR 현재고 현황표 인쇄)
    // ==========================================
    container.querySelector('#btn-print-active-view')?.addEventListener('click', () => {
        let printContainer = document.getElementById('raw-ledger-print-container');
        if (!printContainer) {
            printContainer = document.createElement('div');
            printContainer.id = 'raw-ledger-print-container';
            printContainer.className = 'printable-area';
            document.body.appendChild(printContainer);
        }

        const nowStr = new Date().toLocaleString('ko-KR');

        if (currentView === 'ledger') {
            // [1] 수불원장 A4 인쇄
            const dateFrom = dateFromInput.value;
            const dateTo = dateToInput.value;
            const filterType = typeSelect.value;
            const query = searchInput.value.trim();

            const filtered = state.rawLedger.filter(item => {
                const itemLoc = item.location || '김포';
                if (selectedLocation !== 'ALL' && itemLoc !== selectedLocation) return false;
                if (selectedMaterial !== 'ALL' && item.name !== selectedMaterial) return false;
                if (filterType !== 'ALL' && item.type !== filterType) return false;
                if (!isDateInRange(item.date, dateFrom, dateTo)) return false;
                if (!matchesQuery(item, query, ['code', 'rawCode', 'name', 'type', 'notes', 'remark', 'worker', 'location'])) return false;
                return true;
            });
            const printRows = rawLedgerColFilter.apply(filtered); // 화면과 같게 열 필터 적용

            let totalIn = 0;
            let totalOut = 0;
            let lastStock = 0;
            let rowIdx = 1;

            const rowsHtml = printRows.map(item => {
                const inQty = Number(item.inQty) || 0;
                const outQty = Number(item.outQty) || 0;
                const stockQty = Number(item.stockQty) || 0;
                const weight = Number(item.weight) || (stockQty * (Number(item.sg) || 1.0));
                totalIn += inQty;
                totalOut += outQty;
                lastStock = stockQty;

                return `
                <tr>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${rowIdx++}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center; font-weight:bold;">${esc(item.location || '김포')}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${esc(item.date)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; font-family:monospace; text-align:center;">${esc(item.code || '-')}</td><td style="border:1px solid #cbd5e1; padding:4px; font-family:monospace; text-align:center;">${esc(item.rawCode || '-')}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; font-weight:bold;">${esc(item.name)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${esc(item.type)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px;">${esc(item.notes || '-')}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:right; color:#1d4ed8; font-weight:bold;">${inQty > 0 ? inQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:right; color:#b91c1c; font-weight:bold;">${outQty > 0 ? outQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:right; font-weight:bold; background:#f8fafc;">${stockQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:right; color:#047857;">${weight > 0 ? weight.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center; font-family:monospace;">${item.sg || '1.0000'}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:right;">${item.dm || '-'}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px;">${esc(item.remark || '-')}</td>
                </tr>
                `;
            }).join('');

            printContainer.innerHTML = `
                <div style="font-family:'Noto Sans KR', sans-serif; color:#0f172a; padding:15px; width:100%; box-sizing:border-box;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; border-bottom:2px solid #0f172a; padding-bottom:8px;">
                        <div>
                            <h1 style="font-size:20px; font-weight:900; margin:0 0 4px 0;">(주)대림오일 원료수불부 (Raw Material Ledger)</h1>
                            <div style="font-size:11px; color:#475569; display:flex; gap:12px; flex-wrap:wrap;">
                                <span><strong>지역구분:</strong> ${selectedLocation === 'ALL' ? '전체 (본사+김포)' : esc(selectedLocation)}</span>
                                <span><strong>대상 원료:</strong> ${selectedMaterial === 'ALL' ? '전체 원료' : esc(selectedMaterial)}</span>
                                <span><strong>집계 기간:</strong> ${dateFrom || '최초'} ~ ${dateTo || '현재'}</span>
                                <span><strong>출력 일시:</strong> ${nowStr}</span>
                            </div>
                        </div>
                        <table style="border-collapse:collapse; text-align:center; font-size:10px; width:220px;">
                            <tr>
                                <td rowspan="2" style="border:1px solid #64748b; background:#f1f5f9; width:20px; font-weight:bold; vertical-align:middle;">결<br>재</td>
                                <td style="border:1px solid #64748b; background:#f8fafc; padding:2px; font-weight:bold;">담당</td>
                                <td style="border:1px solid #64748b; background:#f8fafc; padding:2px; font-weight:bold;">팀장</td>
                                <td style="border:1px solid #64748b; background:#f8fafc; padding:2px; font-weight:bold;">공장장</td>
                                <td style="border:1px solid #64748b; background:#f8fafc; padding:2px; font-weight:bold;">대표</td>
                            </tr>
                            <tr style="height:35px;">
                                <td style="border:1px solid #64748b;"></td>
                                <td style="border:1px solid #64748b;"></td>
                                <td style="border:1px solid #64748b;"></td>
                                <td style="border:1px solid #64748b;"></td>
                            </tr>
                        </table>
                    </div>

                    <table style="width:100%; border-collapse:collapse; font-size:10px; margin-bottom:10px;">
                        <thead style="background:#f1f5f9; font-weight:bold;">
                            <tr>
                                <th style="border:1px solid #cbd5e1; padding:4px;">No</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">지역</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">일자</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">품목코드</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">원료품명</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">분류</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">적요</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">수(입고 L)</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">불(출고 L)</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">재고(L)</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">중량(KG)</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">비중(SG)</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">D/M</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">비고</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                        <tfoot style="background:#f8fafc; font-weight:bold;">
                            <tr>
                                <td colspan="8" style="border:1px solid #cbd5e1; padding:6px; text-align:center;">합계 및 기말 잔여 재고</td>
                                <td style="border:1px solid #cbd5e1; padding:6px; text-align:right; color:#1d4ed8;">+${totalIn.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                <td style="border:1px solid #cbd5e1; padding:6px; text-align:right; color:#b91c1c;">-${totalOut.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                <td style="border:1px solid #cbd5e1; padding:6px; text-align:right;">${lastStock.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L</td>
                                <td colspan="4" style="border:1px solid #cbd5e1; padding:6px; text-align:center; color:#64748b;">(주)대림오일 스마트 WMS 전산 원장</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;
        } else {
            // [2] 원료 현재고 현황표 A4 인쇄
            const itemsMap = new Map();
            state.rawLedger.forEach(row => {
                const loc = row.location || '김포';
                if (selectedLocation !== 'ALL' && loc !== selectedLocation) return;
                const name = (row.name || '').trim();
                if (!name) return;
                if (!itemsMap.has(name) || (row.date || '') >= (itemsMap.get(name).date || '')) {
                    itemsMap.set(name, row);
                }
            });

            let list = Array.from(itemsMap.values());
            list.sort((a, b) => (Number(b.stockQty) || 0) - (Number(a.stockQty) || 0));

            let totalStock = 0;
            let totalWeight = 0;
            let idx = 1;

            const rowsHtml = list.map(item => {
                const s = Number(item.stockQty) || 0;
                const sg = Number(item.sg) || 1.0;
                const w = Number(item.weight) || (s * sg);
                totalStock += s;
                totalWeight += w;

                return `
                <tr>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${idx++}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center; font-weight:bold;">${esc(item.location || '김포')}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center; font-family:monospace;">${esc(item.code || '-')}</td><td style="border:1px solid #cbd5e1; padding:4px; text-align:center; font-family:monospace;">${esc(item.rawCode || '-')}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; font-weight:bold;">${esc(item.name)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center; font-family:monospace;">${esc(item.date)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${esc(item.type)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px;">${esc(item.notes || '-')}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:right; font-weight:bold; background:#ecfdf5; color:#065f46;">${s.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:right; font-weight:bold; color:#047857;">${w.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KG</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:center; font-family:monospace;">${sg.toFixed(4)}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px; text-align:right;">${item.dm || '-'}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px;">${esc(item.remark || '-')}</td>
                </tr>
                `;
            }).join('');

            printContainer.innerHTML = `
                <div style="font-family:'Noto Sans KR', sans-serif; color:#0f172a; padding:15px; width:100%; box-sizing:border-box;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; border-bottom:2px solid #0f172a; padding-bottom:8px;">
                        <div>
                            <h1 style="font-size:20px; font-weight:900; margin:0 0 4px 0;">(주)대림오일 원료 현재고 현황표 (품목별 최종일자 기준)</h1>
                            <div style="font-size:11px; color:#475569; display:flex; gap:12px; flex-wrap:wrap;">
                                <span><strong>지역구분:</strong> ${selectedLocation === 'ALL' ? '전체 (본사+김포)' : esc(selectedLocation)}</span>
                                <span><strong>총 품목수:</strong> ${list.length}종</span>
                                <span><strong>출력 일시:</strong> ${nowStr}</span>
                            </div>
                        </div>
                        <table style="border-collapse:collapse; text-align:center; font-size:10px; width:220px;">
                            <tr>
                                <td rowspan="2" style="border:1px solid #64748b; background:#f1f5f9; width:20px; font-weight:bold; vertical-align:middle;">결<br>재</td>
                                <td style="border:1px solid #64748b; background:#f8fafc; padding:2px; font-weight:bold;">담당</td>
                                <td style="border:1px solid #64748b; background:#f8fafc; padding:2px; font-weight:bold;">팀장</td>
                                <td style="border:1px solid #64748b; background:#f8fafc; padding:2px; font-weight:bold;">공장장</td>
                                <td style="border:1px solid #64748b; background:#f8fafc; padding:2px; font-weight:bold;">대표</td>
                            </tr>
                            <tr style="height:35px;">
                                <td style="border:1px solid #64748b;"></td>
                                <td style="border:1px solid #64748b;"></td>
                                <td style="border:1px solid #64748b;"></td>
                                <td style="border:1px solid #64748b;"></td>
                            </tr>
                        </table>
                    </div>

                    <table style="width:100%; border-collapse:collapse; font-size:10px; margin-bottom:10px;">
                        <thead style="background:#ecfdf5; color:#064e3b; font-weight:bold;">
                            <tr>
                                <th style="border:1px solid #cbd5e1; padding:4px;">No</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">지역</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">품목코드</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">원료품명</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">최종일자</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">최종구분</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">최종적요</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">현재고량 (L)</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">환산중량 (KG)</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">비중(SG)</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">잔여 D/M</th>
                                <th style="border:1px solid #cbd5e1; padding:4px;">비고</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                        <tfoot style="background:#f8fafc; font-weight:bold;">
                            <tr>
                                <td colspan="8" style="border:1px solid #cbd5e1; padding:6px; text-align:center;">전체 원료 현재고 총합계</td>
                                <td style="border:1px solid #cbd5e1; padding:6px; text-align:right; color:#047857; font-size:11px;">${totalStock.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L</td>
                                <td style="border:1px solid #cbd5e1; padding:6px; text-align:right; color:#065f46; font-size:11px;">${totalWeight.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KG</td>
                                <td colspan="3" style="border:1px solid #cbd5e1; padding:6px; text-align:center; color:#64748b;">(주)대림오일 스마트 WMS 전산 원장</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;
        }

        window.print();
    });

    // ==========================================
    // 엑셀 다운로드 (원장 OR 현재고 현황)
    // ==========================================
    container.querySelector('#btn-export-active-view')?.addEventListener('click', () => {
        const nowIso = localDateStr();

        if (currentView === 'ledger') {
            const query = searchInput.value.trim();
            const dateFrom = dateFromInput.value;
            const dateTo = dateToInput.value;
            const filterType = typeSelect.value;

            const filtered = state.rawLedger.filter(item => {
                const itemLoc = item.location || '김포';
                if (selectedLocation !== 'ALL' && itemLoc !== selectedLocation) return false;
                if (selectedMaterial !== 'ALL' && item.name !== selectedMaterial) return false;
                if (filterType !== 'ALL' && item.type !== filterType) return false;
                if (!isDateInRange(item.date, dateFrom, dateTo)) return false;
                if (!matchesQuery(item, query, ['code', 'rawCode', 'name', 'type', 'notes', 'remark', 'worker', 'location'])) return false;
                return true;
            });

            const excelData = rawLedgerColFilter.apply(filtered).map((item, idx) => ({ // 화면과 같게 열 필터 적용
                "순번": idx + 1,
                "지역구분": item.location || '김포',
                "수불일자": item.date,
                "품목코드": item.code || '',
                "원료품명": item.name,
                "분류": item.type,
                "적요": item.notes || '',
                "제조원": item.manufacturer || '',
                "수(입고 L)": Number(item.inQty) || 0,
                "불(출고 L)": Number(item.outQty) || 0,
                "재고(L)": Number(item.stockQty) || 0,
                "중량(KG)": Number(item.weight) || (Number(item.stockQty) * (Number(item.sg) || 1.0)),
                "비중(SG)": Number(item.sg) || 1.0,
                "D/M(드럼)": Number(item.dm) || 0,
                "단가(원)": Number(item.unitPrice) || 0,
                "비고": item.remark || '',
                "작업자": item.worker || ''
            }));

            const ws = XLSX.utils.json_to_sheet(excelData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "원료수불원장");
            const fileName = `대림오일_원료수불원장_${selectedLocation}_${nowIso}.xlsx`;
            XLSX.writeFile(wb, fileName);
            showToast(`📊 '${fileName}' 엑셀 파일이 저장되었습니다.`);
        } else {
            const itemsMap = new Map();
            state.rawLedger.forEach(row => {
                const loc = row.location || '김포';
                if (selectedLocation !== 'ALL' && loc !== selectedLocation) return;
                const name = (row.name || '').trim();
                if (!name) return;
                if (!itemsMap.has(name) || (row.date || '') >= (itemsMap.get(name).date || '')) {
                    itemsMap.set(name, row);
                }
            });

            let list = Array.from(itemsMap.values());
            list.sort((a, b) => (Number(b.stockQty) || 0) - (Number(a.stockQty) || 0));

            const excelData = list.map((item, idx) => {
                const s = Number(item.stockQty) || 0;
                const sg = Number(item.sg) || 1.0;
                const w = Number(item.weight) || (s * sg);
                return {
                    "순번": idx + 1,
                    "지역구분": item.location || '김포',
                    "품목코드": item.code || '',
                    "원료품명": item.name,
                    "최종수불일자": item.date,
                    "최종분류": item.type,
                    "최종적요": item.notes || '',
                    "최종제조원": item.manufacturer || '',
                    "현재고량(L)": s,
                    "환산중량(KG)": w,
                    "비중(SG)": sg,
                    "잔여D/M": Number(item.dm) || 0,
                    "단가(원)": Number(item.unitPrice) || 0,
                    "최종비고": item.remark || ''
                };
            });

            const ws = XLSX.utils.json_to_sheet(excelData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "원료현재고현황");
            const fileName = `대림오일_원료현재고현황_${selectedLocation}_${nowIso}.xlsx`;
            XLSX.writeFile(wb, fileName);
            showToast(`📊 '${fileName}' 엑셀 파일이 저장되었습니다.`);
        }
    });

    // ==========================================
    // 초기 렌더링 실행
    // ==========================================
    updateSortOptions();
    renderMaterialChips();
    renderView();

    // ==========================================
    // 품명 일괄변경 모달 이벤트 핸들러
    // ==========================================
    const bulkRenameModal       = container.querySelector('#modal-bulk-rename');
    const bulkRenameFromSelect  = container.querySelector('#bulk-rename-from-select');
    const bulkRenameFromInput   = container.querySelector('#bulk-rename-from-input');
    const bulkRenameToInput     = container.querySelector('#bulk-rename-to');
    const bulkRenamePreviewDiv  = container.querySelector('#bulk-rename-preview');
    const bulkRenamePreviewText = container.querySelector('#bulk-rename-preview-text');

    // 모달 열기: 현재 원료 품명 목록을 드롭다운에 채워서 표시
    container.querySelector('#btn-open-bulk-rename')?.addEventListener('click', () => {
        // 모든 품명 고유값 추출 (지역 무관)
        const allNames = [...new Set(state.rawLedger.map(r => r.name || r.itemName).filter(Boolean))].sort();
        bulkRenameFromSelect.innerHTML = '<option value="">-- 변경할 품명 선택 --</option>' +
            allNames.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
        // 필드 초기화
        bulkRenameFromInput.value = '';
        bulkRenameToInput.value   = '';
        bulkRenamePreviewDiv.classList.add('hidden');
        container.querySelectorAll('input[name="bulk-rename-location"]').forEach(r => { r.checked = r.value === 'ALL'; });
        bulkRenameModal.classList.remove('hidden');
        createIcons({ icons });
    });

    // 모달 닫기
    const closeBulkRenameModal = () => bulkRenameModal.classList.add('hidden');
    container.querySelector('#btn-close-bulk-rename')?.addEventListener('click', closeBulkRenameModal);
    container.querySelector('#btn-cancel-bulk-rename')?.addEventListener('click', closeBulkRenameModal);
    bulkRenameModal?.addEventListener('click', (e) => { if (e.target === bulkRenameModal) closeBulkRenameModal(); });

    // 드롭다운 선택 시 직접입력 필드 자동 채우기
    bulkRenameFromSelect?.addEventListener('change', () => {
        if (bulkRenameFromSelect.value) bulkRenameFromInput.value = '';
    });
    bulkRenameFromInput?.addEventListener('input', () => {
        if (bulkRenameFromInput.value) bulkRenameFromSelect.value = '';
    });

    // 미리보기 버튼
    container.querySelector('#btn-bulk-rename-preview')?.addEventListener('click', () => {
        const fromName = (bulkRenameFromInput.value.trim() || bulkRenameFromSelect.value).trim();
        const toName   = bulkRenameToInput.value.trim();
        const locFilter = container.querySelector('input[name="bulk-rename-location"]:checked')?.value || 'ALL';

        if (!fromName || !toName) {
            showToast('⚠️ 변경할 품명과 새 품명을 모두 입력하세요.');
            return;
        }

        // 대상 건수 카운트
        const targets = state.rawLedger.filter(r => {
            const rName = (r.name || r.itemName || '').trim();
            const rLoc  = r.location || '김포';
            const matchName = rName === fromName;
            const matchLoc  = locFilter === 'ALL' || rLoc === locFilter;
            return matchName && matchLoc;
        });

        bulkRenamePreviewDiv.classList.remove('hidden');
        bulkRenamePreviewText.innerHTML =
            `"<strong>${esc(fromName)}</strong>" → "<strong>${esc(toName)}</strong>" 으로<br>` +
            `대상 지역: <strong>${locFilter === 'ALL' ? '전체(김포+본사)' : esc(locFilter)}</strong> | ` +
            `변경 대상 전표: <strong>${targets.length.toLocaleString()}건</strong>`;
    });

    // 일괄변경 실행
    container.querySelector('#btn-confirm-bulk-rename')?.addEventListener('click', async () => {
        const fromName = (bulkRenameFromInput.value.trim() || bulkRenameFromSelect.value).trim();
        const toName   = bulkRenameToInput.value.trim();
        const locFilter = container.querySelector('input[name="bulk-rename-location"]:checked')?.value || 'ALL';

        if (!fromName || !toName) {
            showToast('⚠️ 변경할 품명과 새 품명을 모두 입력하세요.');
            return;
        }
        if (fromName === toName) {
            showToast('⚠️ 현재 품명과 새 품명이 동일합니다.');
            return;
        }

        let changedCount = 0;
        // state.rawLedger를 직접 순회하며 name/itemName 일괄 변경
        const updatedLedger = state.rawLedger.map(r => {
            const rName = (r.name || r.itemName || '').trim();
            const rLoc  = r.location || '김포';
            const matchName = rName === fromName;
            const matchLoc  = locFilter === 'ALL' || rLoc === locFilter;
            if (matchName && matchLoc) {
                changedCount++;
                return { ...r, name: toName, itemName: toName };
            }
            return r;
        });

        if (changedCount === 0) {
            showToast(`⚠️ "${fromName}" 품명을 가진 전표를 찾을 수 없습니다.`);
            return;
        }

        await saveRawLedger(updatedLedger); // state.rawLedger 업데이트 + localStorage 저장
        closeBulkRenameModal();
        renderMaterialChips(); // 품목 칩 새로고침
        renderView();          // 테이블 재렌더링
        showToast(`✅ "${fromName}" → "${toName}" 품명이 ${changedCount.toLocaleString()}건 일괄 변경되었습니다.`);
    });
};
