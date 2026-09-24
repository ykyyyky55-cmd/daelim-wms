import { state, addRawLedgerEntry, updateRawLedgerEntry, deleteRawLedgerEntry } from '../services/db.js';
import { matchesQuery, isDateInRange, searchMasterItems } from '../services/searchUtils.js';
import { createIcons, icons } from 'lucide';
import * as XLSX from 'xlsx';

/**
 * 김포공장 원료수불부 (Raw Material Inventory Ledger) 컴포넌트
 * 구글 시트 원료수불부(1,김포캠프 원료수불부.xlsx) 실물 데이터 완벽 연동
 * 품명 및 기간별 검색, 누적 입력, 품목코드 등록, 수정 및 공식 A4 인쇄 지원
 */
export const renderRawMaterialLedger = (container, { showToast }) => {
    // 필터 상태 관리
    let selectedMaterial = 'ALL';      // 선택된 원료 품목 (ALL or 품목명)
    let selectedType = 'ALL';          // 분류 필터 (ALL, 입고, 사용, 재고확인, 이동 등)
    let sortMode = 'sequential';       // sequential (입력 누적순), dateAsc (일자 오름차순), dateDesc (최신순)
    let editingItem = null;            // 현재 수정 중인 전표 객체

    container.innerHTML = `
    <div class="space-y-6">
        <!-- 1. 상단 타이틀 및 주요 액션 헤더 -->
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 rounded-3xl shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <div class="flex items-center gap-2 mb-1.5">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-500/20 text-blue-300 border border-blue-400/30">대림오일 김포공장</span>
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">공식 원료수불원장</span>
                    <span class="text-xs text-slate-400 font-mono">구글시트 1:1 호환 연동</span>
                </div>
                <h2 class="text-xl font-black tracking-tight flex items-center gap-2.5">
                    <i data-lucide="cylinder" class="w-6 h-6 text-indigo-400"></i>
                    <span>원료 수불부 (Raw Material Ledger)</span>
                </h2>
                <p class="text-xs text-slate-400 mt-1">원료별 입고(수)·출고/사용(불)·잔여재고(L)·중량(KG)·비중(SG)·드럼수를 입력 순서대로 누적 관리합니다.</p>
            </div>

            <div class="flex items-center flex-wrap gap-2">
                <!-- 공식 A4 인쇄 버튼 -->
                <button type="button" id="btn-print-raw-ledger" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white border border-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm" title="공식 결재란 포함 A4 원료수불원장 인쇄">
                    <i data-lucide="printer" class="w-4 h-4 text-sky-400"></i>
                    <span>공식 A4 인쇄</span>
                </button>

                <!-- 엑셀 다운로드 버튼 -->
                <button type="button" id="btn-export-raw-excel" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm" title="원료수불부 엑셀(.xlsx) 파일 다운로드">
                    <i data-lucide="file-spreadsheet" class="w-4 h-4"></i>
                    <span>엑셀 다운로드</span>
                </button>

                <!-- 신규 전표 등록 앵커 버튼 -->
                <button type="button" id="btn-scroll-to-input" class="px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-95 text-white rounded-xl text-xs font-extrabold transition flex items-center gap-1.5 shadow-sm">
                    <i data-lucide="plus-circle" class="w-4 h-4"></i>
                    <span>원료 수불 등록</span>
                </button>
            </div>
        </div>

        <!-- 2. 실시간 집계 요약 KPI 카드 -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
                    <span>총 누적 입고량 (수)</span>
                    <i data-lucide="arrow-down-left" class="w-4 h-4 text-blue-600"></i>
                </div>
                <div class="flex items-baseline gap-1">
                    <span id="kpi-total-in" class="text-xl font-black text-blue-700 font-mono">0.0</span>
                    <span class="text-xs text-slate-500 font-bold">L</span>
                </div>
                <span id="kpi-in-count" class="text-[10px] text-slate-400 mt-1 block">0건 입고 완료</span>
            </div>

            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
                    <span>총 누적 사용량 (불)</span>
                    <i data-lucide="arrow-up-right" class="w-4 h-4 text-rose-600"></i>
                </div>
                <div class="flex items-baseline gap-1">
                    <span id="kpi-total-out" class="text-xl font-black text-rose-700 font-mono">0.0</span>
                    <span class="text-xs text-slate-500 font-bold">L</span>
                </div>
                <span id="kpi-out-count" class="text-[10px] text-slate-400 mt-1 block">0건 생산·희석 투입</span>
            </div>

            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
                    <span>현재 기말 재고량</span>
                    <i data-lucide="database" class="w-4 h-4 text-emerald-600"></i>
                </div>
                <div class="flex items-baseline gap-1">
                    <span id="kpi-current-stock" class="text-xl font-black text-emerald-700 font-mono">0.0</span>
                    <span class="text-xs text-slate-500 font-bold">L</span>
                </div>
                <span id="kpi-current-weight" class="text-[10px] text-emerald-600 font-bold mt-1 block">중량: 0.0 KG</span>
            </div>

            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold mb-1">
                    <span>관리 중인 원료 품목</span>
                    <i data-lucide="layers" class="w-4 h-4 text-purple-600"></i>
                </div>
                <div class="flex items-baseline gap-1">
                    <span id="kpi-material-types" class="text-xl font-black text-purple-700 font-mono">0</span>
                    <span class="text-xs text-slate-500 font-bold">개 품목</span>
                </div>
                <span id="kpi-total-records" class="text-[10px] text-slate-400 mt-1 block">총 0건의 수불 누적 전표</span>
            </div>
        </div>

        <!-- 3. 원료 수불 전표 빠른 신규 입력 폼 (입력 순서대로 누적 및 품목코드 등록 지원) -->
        <div id="section-raw-input" class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <div class="flex items-center gap-2">
                    <span class="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                        <i data-lucide="edit-3" class="w-4 h-4"></i>
                    </span>
                    <div>
                        <h3 class="font-extrabold text-sm text-slate-900">신규 원료 수불 전표 입력 (누적 등록)</h3>
                        <p class="text-[11px] text-slate-500">입력된 데이터는 순서대로 누적되어 쌓이며 잔여 재고와 중량이 자동 계산됩니다.</p>
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
                        <input type="date" id="input-raw-date" required value="${new Date().toISOString().slice(0, 10)}" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>

                    <!-- 2. 품목명 -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">원료 품명 <span class="text-rose-500">*</span></label>
                        <input type="text" id="input-raw-name" list="datalist-raw-names" required placeholder="예: 그레핀, D40, 용제9호" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" autocomplete="off" />
                        <datalist id="datalist-raw-names"></datalist>
                    </div>

                    <!-- 3. 품목코드 등록 -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1 flex items-center justify-between">
                            <span>품목코드 등록</span>
                            <button type="button" id="btn-quick-fill-code" class="text-[10px] text-blue-600 hover:underline font-bold" title="마스터에서 코드 자동 찾기">자동 검색</button>
                        </label>
                        <input type="text" id="input-raw-code" list="datalist-raw-codes" placeholder="예: DP030006, 6BO00020" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-indigo-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" autocomplete="off" />
                        <datalist id="datalist-raw-codes"></datalist>
                    </div>

                    <!-- 4. 분류 (입고, 사용, 재고확인, 이동 등) -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">수불 분류 <span class="text-rose-500">*</span></label>
                        <select id="input-raw-type" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer">
                            <option value="입고" selected>📥 입고</option>
                            <option value="사용">📤 사용 (생산·투입)</option>
                            <option value="재고확인">🔍 재고확인 (실사)</option>
                            <option value="이동">🚚 거점이동 (미산동/김포)</option>
                            <option value="입출고">🔄 입출고 동시</option>
                            <option value="조정">⚙️ 재고조정</option>
                        </select>
                    </div>

                    <!-- 5. 적요 (상세 내용) -->
                    <div class="sm:col-span-2">
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">적요 / 거래처 / 세부용도</label>
                        <input type="text" id="input-raw-notes" placeholder="예: 미산동 입고, 그래핀희석액 15L 제조 등" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-1">
                    <!-- 6. 수 (입고량 L) -->
                    <div>
                        <label class="block text-[11px] font-bold text-blue-700 mb-1">수 (입고 L)</label>
                        <input type="number" id="input-raw-in" step="any" min="0" placeholder="0.0" class="w-full bg-blue-50/50 border border-blue-200 rounded-xl px-2.5 py-1.5 text-xs font-black text-blue-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>

                    <!-- 7. 불 (출고량 L) -->
                    <div>
                        <label class="block text-[11px] font-bold text-rose-700 mb-1">불 (출고/사용 L)</label>
                        <input type="number" id="input-raw-out" step="any" min="0" placeholder="0.0" class="w-full bg-rose-50/50 border border-rose-200 rounded-xl px-2.5 py-1.5 text-xs font-black text-rose-800 focus:bg-white focus:ring-2 focus:ring-rose-500 focus:outline-none" />
                    </div>

                    <!-- 8. 비중 (SG) -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">비중 (SG)</label>
                        <input type="number" id="input-raw-sg" step="0.0001" min="0.1" max="3" value="1.0000" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>

                    <!-- 9. D/M (드럼수) -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">D/M (드럼/용기)</label>
                        <input type="number" id="input-raw-dm" step="any" min="0" placeholder="0" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>

                    <!-- 10. 단가 -->
                    <div>
                        <label class="block text-[11px] font-bold text-slate-700 mb-1">단가 (원)</label>
                        <input type="number" id="input-raw-price" step="any" min="0" placeholder="0" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>

                    <!-- 11. 등록 실행 버튼 -->
                    <div class="flex items-end">
                        <button type="submit" class="w-full py-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-extrabold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5 h-[34px]">
                            <i data-lucide="plus" class="w-4 h-4"></i>
                            <span>전표 누적 등록</span>
                        </button>
                    </div>
                </div>
            </form>
        </div>

        <!-- 4. 검색 및 필터 툴바 (품명 및 기간별 검색 지원) -->
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <!-- 품명 및 키워드 실시간 부분 검색창 -->
                <div class="flex items-center gap-2 flex-1 max-w-md">
                    <div class="relative flex-1">
                        <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-3 top-2.5"></i>
                        <input type="text" id="raw-search-input" placeholder="원료품명, 품목코드, 적요 검색 (일부문자 인식)..." class="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <button type="button" id="btn-raw-search-reset" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition">
                        초기화
                    </button>
                </div>

                <!-- 기간 빠른 선택 및 일자 범위 -->
                <div class="flex items-center flex-wrap gap-1.5">
                    <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                        <button type="button" class="btn-raw-period px-2.5 py-1 rounded-lg transition" data-range="all">전체</button>
                        <button type="button" class="btn-raw-period px-2.5 py-1 rounded-lg transition bg-white text-blue-700 shadow-2xs" data-range="month">당월</button>
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

                <!-- 정렬 방식 및 분류 선택 -->
                <div class="flex items-center gap-2">
                    <select id="raw-filter-type" class="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700">
                        <option value="ALL">모든 분류</option>
                        <option value="입고">입고</option>
                        <option value="사용">사용 (출고)</option>
                        <option value="재고확인">재고확인 (실사)</option>
                        <option value="이동">거점이동</option>
                    </select>

                    <select id="raw-sort-mode" class="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-700">
                        <option value="sequential" selected>입력 누적순 (기본)</option>
                        <option value="dateDesc">최신 일자순 (최신→과거)</option>
                        <option value="dateAsc">일자순 (과거→최신)</option>
                    </select>
                </div>
            </div>

            <!-- 원료 품목별 99종 드롭다운 선택 및 퀵 선택 칩 (Tabs) -->
            <div class="pt-2 border-t border-slate-100 flex flex-col md:flex-row md:items-center gap-2 text-xs">
                <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-[11px] font-bold text-slate-500 whitespace-nowrap">원료 품목 선택:</span>
                    <select id="raw-material-dropdown-select" class="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-800 max-w-[220px]">
                        <option value="ALL">전체 원료 (전체 보기)</option>
                    </select>
                </div>
                <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 pb-1" id="raw-material-chips-wrapper">
                    <!-- 동적으로 채워짐 -->
                </div>
            </div>
        </div>

        <!-- 5. 원료수불부 누적 거래 테이블 -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                            <th class="p-3 text-center w-12">순번</th>
                            <th class="p-3 whitespace-nowrap">수불일자</th>
                            <th class="p-3 whitespace-nowrap">품목코드</th>
                            <th class="p-3 whitespace-nowrap">원료 품명</th>
                            <th class="p-3 text-center whitespace-nowrap">분류</th>
                            <th class="p-3 whitespace-nowrap">적요 (세부내용)</th>
                            <th class="p-3 text-right whitespace-nowrap text-blue-700 bg-blue-50/30">수 (입고 L)</th>
                            <th class="p-3 text-right whitespace-nowrap text-rose-700 bg-rose-50/30">불 (출고 L)</th>
                            <th class="p-3 text-right whitespace-nowrap font-black bg-slate-50">재고 (L)</th>
                            <th class="p-3 text-right whitespace-nowrap">중량 (KG)</th>
                            <th class="p-3 text-center whitespace-nowrap">비중 (SG)</th>
                            <th class="p-3 text-right whitespace-nowrap">D/M</th>
                            <th class="p-3 text-right whitespace-nowrap">단가</th>
                            <th class="p-3 whitespace-nowrap">비고</th>
                            <th class="p-3 text-center whitespace-nowrap no-print w-20">관리</th>
                        </tr>
                    </thead>
                    <tbody id="raw-ledger-tbody" class="divide-y divide-slate-100">
                        <!-- 동적으로 렌더링 -->
                    </tbody>
                </table>
            </div>

            <!-- 하단 카운트 및 합계 푸터 -->
            <div class="p-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between text-xs text-slate-600 gap-2">
                <span id="raw-table-summary" class="font-bold text-slate-700">총 0건의 수불 내역</span>
                <div class="flex items-center gap-4 text-xs font-bold">
                    <span>선택 원료 입고계: <strong id="raw-sum-in" class="text-blue-700">0.0</strong> L</span>
                    <span>사용계: <strong id="raw-sum-out" class="text-rose-700">0.0</strong> L</span>
                    <span>현재재고: <strong id="raw-sum-stock" class="text-emerald-700 font-black">0.0</strong> L</span>
                </div>
            </div>
        </div>
    </div>

    <!-- 6. 전표 수정 모달 -->
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

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">수불 일자 *</label>
                        <input type="date" id="edit-raw-date" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold" />
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

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">원료 품명 *</label>
                        <input type="text" id="edit-raw-name" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">품목코드 등록</label>
                        <input type="text" id="edit-raw-code" placeholder="예: DP030006" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono font-bold" />
                    </div>
                </div>

                <div>
                    <label class="block font-bold text-slate-700 mb-1">적요 (세부내용)</label>
                    <input type="text" id="edit-raw-notes" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2" />
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
                        <label class="block font-bold text-emerald-700 mb-1">재고 (L)</label>
                        <input type="number" id="edit-raw-stock" step="any" class="w-full bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 font-bold text-emerald-800" />
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">비중 (SG)</label>
                        <input type="number" id="edit-raw-sg" step="0.0001" min="0.1" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">D/M (드럼)</label>
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
    `;

    // ==========================================
    // DOM 엘리먼트 참조
    // ==========================================
    const searchInput = container.querySelector('#raw-search-input');
    const dateFromInput = container.querySelector('#raw-date-from');
    const dateToInput = container.querySelector('#raw-date-to');
    const typeSelect = container.querySelector('#raw-filter-type');
    const sortSelect = container.querySelector('#raw-sort-mode');
    const tbody = container.querySelector('#raw-ledger-tbody');
    const chipsWrapper = container.querySelector('#raw-material-chips-wrapper');

    const editModal = container.querySelector('#modal-edit-raw');
    const editForm = container.querySelector('#form-edit-raw-entry');

    // 기본 기간 설정: 전체 (Google Sheets가 2023년부터 누적되어 있으므로 전체 표시)
    dateFromInput.value = '';
    dateToInput.value = '';

    // ==========================================
    // 자동 완성 및 데이터리스트 동기화
    // ==========================================
    const updateDatalists = () => {
        // 기존 원료수불부 내 품목명 + 마스터 내 원료/원액 품목명 취합
        const rawNames = new Set(state.rawLedger.map(r => r.name).filter(Boolean));
        state.master
            .filter(m => m.category === '원료' || m.category === '원액')
            .forEach(m => rawNames.add(m.name));

        const nameDatalist = container.querySelector('#datalist-raw-names');
        if (nameDatalist) {
            nameDatalist.innerHTML = Array.from(rawNames).map(n => `<option value="${n}"></option>`).join('');
        }

        // 품목코드 목록 취합
        const rawCodes = new Set(state.rawLedger.map(r => r.code).filter(Boolean));
        state.master
            .filter(m => m.category === '원료' || m.category === '원액')
            .forEach(m => rawCodes.add(m.code));

        const codeDatalist = container.querySelector('#datalist-raw-codes');
        if (codeDatalist) {
            codeDatalist.innerHTML = Array.from(rawCodes).map(c => `<option value="${c}"></option>`).join('');
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
        // 1. 기존 원료수불부에서 동일 품명의 코드가 있는지 확인
        const existing = state.rawLedger.find(r => r.name.toLowerCase() === name.toLowerCase() && r.code);
        if (existing) {
            rawCodeInput.value = existing.code;
            if (existing.sg) rawSgInput.value = existing.sg;
            return;
        }

        // 2. 마스터 품목에서 검색
        const match = state.master.find(m => m.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(m.name.toLowerCase()));
        if (match) {
            rawCodeInput.value = match.code;
        }
    };

    rawNameInput?.addEventListener('blur', (e) => {
        autoMatchCodeFromName(e.target.value.trim());
    });

    container.querySelector('#btn-quick-fill-code')?.addEventListener('click', () => {
        const val = rawNameInput.value.trim();
        if (!val) {
            alert('먼저 원료 품명을 입력하세요.');
            rawNameInput.focus();
            return;
        }
        autoMatchCodeFromName(val);
        showToast(`🔍 [${val}] 품목코드를 자동 검색하여 채웠습니다.`);
    });

    // ==========================================
    // 원료 칩 (Tabs) 및 드롭다운 렌더링
    // ==========================================
    const materialDropdown = container.querySelector('#raw-material-dropdown-select');

    const renderMaterialChips = () => {
        const materialCounts = {};
        state.rawLedger.forEach(r => {
            const n = r.name || '미지정';
            materialCounts[n] = (materialCounts[n] || 0) + 1;
        });

        const distinctNames = Object.keys(materialCounts).sort((a, b) => a.localeCompare(b, 'ko'));

        // 1. 드롭다운 옵션 갱신
        if (materialDropdown) {
            let dropHtml = `<option value="ALL">전체 원료 (${distinctNames.length}종 / 총 ${state.rawLedger.length}건)</option>`;
            distinctNames.forEach(name => {
                dropHtml += `<option value="${name}" ${selectedMaterial === name ? 'selected' : ''}>${name} (${materialCounts[name]}건)</option>`;
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
                전체 원료 (${state.rawLedger.length})
            </button>
        `;

        distinctNames.forEach(name => {
            const isSelected = selectedMaterial === name;
            html += `
                <button type="button" class="btn-material-chip px-3 py-1 rounded-xl font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
                    isSelected 
                        ? 'bg-blue-600 text-white shadow-2xs font-black' 
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                }" data-material="${name}">
                    <span>${name}</span>
                    <span class="px-1.5 py-0.2 rounded-full text-[10px] ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'} font-mono">${materialCounts[name]}</span>
                </button>
            `;
        });

        chipsWrapper.innerHTML = html;

        chipsWrapper.querySelectorAll('.btn-material-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedMaterial = btn.getAttribute('data-material') || 'ALL';
                renderMaterialChips();
                renderLedgerTable();
            });
        });
    };

    // 드롭다운 변경 이벤트
    materialDropdown?.addEventListener('change', (e) => {
        selectedMaterial = e.target.value;
        renderMaterialChips();
        renderLedgerTable();
    });

    // ==========================================
    // 테이블 및 KPI 계산 렌더링
    // ==========================================
    const renderLedgerTable = () => {
        const query = searchInput.value.trim();
        const dateFrom = dateFromInput.value;
        const dateTo = dateToInput.value;
        const filterType = typeSelect.value;

        // 1. 조건에 따른 필터링
        let filtered = state.rawLedger.filter(item => {
            // 원료 칩 필터
            if (selectedMaterial !== 'ALL' && item.name !== selectedMaterial) return false;

            // 분류 필터
            if (filterType !== 'ALL' && item.type !== filterType) return false;

            // 일자 범위 필터
            if (!isDateInRange(item.date, dateFrom, dateTo)) return false;

            // 키워드 부분 검색 (정규화 부분 일치 검사)
            if (!matchesQuery(item, query, ['code', 'name', 'type', 'notes', 'remark', 'worker'])) return false;

            return true;
        });

        // 2. 정렬 방식 적용
        if (sortMode === 'dateAsc') {
            filtered.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
        } else if (sortMode === 'dateDesc') {
            filtered.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
        }
        // 'sequential'인 경우 배열에 입력 누적된 순서 유지

        // 3. KPI 통계 산출
        let totalIn = 0;
        let totalOut = 0;
        let currentStock = 0;
        let currentWeight = 0;

        filtered.forEach(r => {
            totalIn += Number(r.inQty) || 0;
            totalOut += Number(r.outQty) || 0;
        });

        // 현재 기말 재고는 필터링된 마지막 유효 행의 재고량 또는 전체 재고 합계
        if (selectedMaterial !== 'ALL') {
            const materialAllRows = state.rawLedger.filter(r => r.name === selectedMaterial);
            if (materialAllRows.length > 0) {
                const lastRow = materialAllRows[materialAllRows.length - 1];
                currentStock = Number(lastRow.stockQty) || 0;
                currentWeight = Number(lastRow.weight) || (currentStock * (Number(lastRow.sg) || 1.0));
            }
        } else {
            // 전체 원료인 경우 원료별 최종 재고의 합
            const latestByMat = {};
            state.rawLedger.forEach(r => {
                latestByMat[r.name] = r;
            });
            Object.values(latestByMat).forEach(lr => {
                const s = Number(lr.stockQty) || 0;
                currentStock += s;
                currentWeight += Number(lr.weight) || (s * (Number(lr.sg) || 1.0));
            });
        }

        const distinctMats = new Set(state.rawLedger.map(r => r.name)).size;

        container.querySelector('#kpi-total-in').textContent = totalIn.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        container.querySelector('#kpi-in-count').textContent = `${filtered.filter(r => (Number(r.inQty) || 0) > 0).length}건 입고`;
        container.querySelector('#kpi-total-out').textContent = totalOut.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        container.querySelector('#kpi-out-count').textContent = `${filtered.filter(r => (Number(r.outQty) || 0) > 0).length}건 생산·투입`;
        container.querySelector('#kpi-current-stock').textContent = currentStock.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        container.querySelector('#kpi-current-weight').textContent = `환산 중량: ${currentWeight.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KG`;
        container.querySelector('#kpi-material-types').textContent = distinctMats;
        container.querySelector('#kpi-total-records').textContent = `총 ${state.rawLedger.length}건 누적 전표`;

        container.querySelector('#raw-sum-in').textContent = totalIn.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        container.querySelector('#raw-sum-out').textContent = totalOut.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        container.querySelector('#raw-sum-stock').textContent = currentStock.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        container.querySelector('#raw-table-summary').textContent = `총 ${filtered.length.toLocaleString()}건의 원료수불 전표 (누적 순서)`;

        // 4. 테이블 렌더링
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="15" class="p-8 text-center text-slate-400 text-xs">일치하는 원료 수불 전표가 없습니다. (검색어 또는 일자 범위를 확인하세요)</td></tr>`;
            return;
        }

        let rowSeq = 1;
        tbody.innerHTML = filtered.map(item => {
            const inQty = Number(item.inQty) || 0;
            const outQty = Number(item.outQty) || 0;
            const stockQty = Number(item.stockQty) || 0;
            const weight = Number(item.weight) || (stockQty * (Number(item.sg) || 1.0));
            const sg = item.sg !== undefined ? Number(item.sg).toFixed(4) : '1.0000';
            const dm = item.dm ? Number(item.dm).toFixed(1) : '-';
            const price = Number(item.unitPrice) || 0;

            // 분류 뱃지 색상
            let typeBadge = 'bg-slate-100 text-slate-700 border-slate-200';
            if (item.type === '입고') typeBadge = 'bg-blue-100 text-blue-800 border-blue-200 font-black';
            else if (item.type === '사용') typeBadge = 'bg-rose-100 text-rose-800 border-rose-200 font-bold';
            else if (item.type === '재고확인') typeBadge = 'bg-emerald-100 text-emerald-800 border-emerald-200 font-bold';
            else if (item.type === '이동') typeBadge = 'bg-purple-100 text-purple-800 border-purple-200 font-bold';
            else if (item.type === '입출고') typeBadge = 'bg-amber-100 text-amber-800 border-amber-200 font-bold';

            return `
            <tr class="hover:bg-slate-50 transition" data-id="${item.id}">
                <td class="p-3 text-center text-slate-400 font-mono text-[11px]">${rowSeq++}</td>
                <td class="p-3 whitespace-nowrap font-bold text-slate-700">${item.date}</td>
                <td class="p-3 whitespace-nowrap">
                    ${item.code ? `
                        <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            🏷️ ${item.code}
                        </span>
                    ` : `<span class="text-slate-300 text-[10px]">-</span>`}
                </td>
                <td class="p-3 whitespace-nowrap font-extrabold text-slate-900">${item.name}</td>
                <td class="p-3 text-center whitespace-nowrap">
                    <span class="px-2 py-0.5 rounded-full text-[10px] border ${typeBadge}">
                        ${item.type}
                    </span>
                </td>
                <td class="p-3 text-slate-600 font-medium">${item.notes || '-'}</td>
                <td class="p-3 text-right font-black text-blue-700 bg-blue-50/20 font-mono">
                    ${inQty > 0 ? `+${inQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : '-'}
                </td>
                <td class="p-3 text-right font-black text-rose-600 bg-rose-50/20 font-mono">
                    ${outQty > 0 ? `-${outQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : '-'}
                </td>
                <td class="p-3 text-right font-black text-slate-900 bg-slate-50/60 font-mono">
                    ${stockQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L
                </td>
                <td class="p-3 text-right font-bold text-emerald-700 font-mono">
                    ${weight > 0 ? `${weight.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : '-'}
                </td>
                <td class="p-3 text-center font-mono text-slate-600">${sg}</td>
                <td class="p-3 text-right font-mono text-slate-600">${dm}</td>
                <td class="p-3 text-right font-mono text-slate-600">${price > 0 ? price.toLocaleString() + '원' : '-'}</td>
                <td class="p-3 text-slate-500 text-[11px]">${item.remark || '-'}</td>
                <td class="p-3 text-center whitespace-nowrap no-print">
                    <div class="flex items-center justify-center gap-1">
                        <button type="button" class="btn-edit-raw p-1 text-blue-600 hover:text-blue-800 rounded transition" data-id="${item.id}" title="전표 수정">
                            <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                        </button>
                        <button type="button" class="btn-del-raw p-1 text-rose-500 hover:text-rose-700 rounded transition" data-id="${item.id}" title="전표 삭제">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        // 수정 모달 열기 이벤트
        tbody.querySelectorAll('.btn-edit-raw').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const target = state.rawLedger.find(r => r.id === id);
                if (target) openEditModal(target);
            });
        });

        // 삭제 이벤트
        tbody.querySelectorAll('.btn-del-raw').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                const target = state.rawLedger.find(r => r.id === id);
                if (!target) return;
                if (confirm(`[${target.date}] ${target.name} (${target.type}) 수불 전표를 삭제하시겠습니까?`)) {
                    await deleteRawLedgerEntry(id);
                    showToast('🗑️ 원료 수불 전표가 삭제되었습니다.');
                    renderMaterialChips();
                    renderLedgerTable();
                }
            });
        });

        createIcons({ icons });
    };

    // ==========================================
    // 신규 수불 전표 제출 (누적 등록)
    // ==========================================
    const formRaw = container.querySelector('#form-raw-ledger');
    formRaw?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const date = container.querySelector('#input-raw-date').value;
        const name = container.querySelector('#input-raw-name').value.trim();
        const code = container.querySelector('#input-raw-code').value.trim();
        const type = container.querySelector('#input-raw-type').value;
        const notes = container.querySelector('#input-raw-notes').value.trim();
        const inQty = parseFloat(container.querySelector('#input-raw-in').value) || 0;
        const outQty = parseFloat(container.querySelector('#input-raw-out').value) || 0;
        const sg = parseFloat(container.querySelector('#input-raw-sg').value) || 1.0;
        const dm = parseFloat(container.querySelector('#input-raw-dm').value) || 0;
        const unitPrice = parseFloat(container.querySelector('#input-raw-price').value) || 0;

        if (!name) {
            alert('원료 품명을 입력하세요.');
            return;
        }

        if (inQty === 0 && outQty === 0 && type !== '재고확인') {
            alert('입고량(수) 또는 출고량(불) 중 하나 이상의 수량을 입력하세요.');
            return;
        }

        try {
            await addRawLedgerEntry({
                date,
                name,
                code,
                type,
                notes,
                inQty,
                outQty,
                sg,
                dm,
                unitPrice
            });

            showToast(`✅ [${name}] 원료수불 전표가 성공적으로 누적 등록되었습니다.`);

            // 입력 폼 리셋 (일자와 품목명, 코드는 연속 입력을 위해 유지)
            container.querySelector('#input-raw-in').value = '';
            container.querySelector('#input-raw-out').value = '';
            container.querySelector('#input-raw-notes').value = '';
            container.querySelector('#input-raw-dm').value = '';

            updateDatalists();
            renderMaterialChips();
            renderLedgerTable();
        } catch (err) {
            alert('등록 실패: ' + err.message);
        }
    });

    // ==========================================
    // 수정 모달 제어
    // ==========================================
    const openEditModal = (item) => {
        editingItem = item;
        container.querySelector('#edit-raw-id').value = item.id;
        container.querySelector('#edit-raw-date').value = item.date;
        container.querySelector('#edit-raw-name').value = item.name;
        container.querySelector('#edit-raw-code').value = item.code || '';
        container.querySelector('#edit-raw-type').value = item.type;
        container.querySelector('#edit-raw-notes').value = item.notes || '';
        container.querySelector('#edit-raw-in').value = item.inQty || 0;
        container.querySelector('#edit-raw-out').value = item.outQty || 0;
        container.querySelector('#edit-raw-stock').value = item.stockQty || 0;
        container.querySelector('#edit-raw-sg').value = item.sg || 1.0;
        container.querySelector('#edit-raw-dm').value = item.dm || '';
        container.querySelector('#edit-raw-price').value = item.unitPrice || '';
        container.querySelector('#edit-raw-remark').value = item.remark || '';

        editModal.classList.remove('hidden');
    };

    const closeEditModal = () => {
        editingItem = null;
        editModal.classList.add('hidden');
    };

    container.querySelector('#btn-close-edit-modal')?.addEventListener('click', closeEditModal);
    container.querySelector('#btn-cancel-edit-modal')?.addEventListener('click', closeEditModal);

    editForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = container.querySelector('#edit-raw-id').value;
        if (!id) return;

        const updatedFields = {
            date: container.querySelector('#edit-raw-date').value,
            name: container.querySelector('#edit-raw-name').value.trim(),
            code: container.querySelector('#edit-raw-code').value.trim(),
            type: container.querySelector('#edit-raw-type').value,
            notes: container.querySelector('#edit-raw-notes').value.trim(),
            inQty: parseFloat(container.querySelector('#edit-raw-in').value) || 0,
            outQty: parseFloat(container.querySelector('#edit-raw-out').value) || 0,
            stockQty: parseFloat(container.querySelector('#edit-raw-stock').value) || 0,
            sg: parseFloat(container.querySelector('#edit-raw-sg').value) || 1.0,
            dm: parseFloat(container.querySelector('#edit-raw-dm').value) || 0,
            unitPrice: parseFloat(container.querySelector('#edit-raw-price').value) || 0,
            remark: container.querySelector('#edit-raw-remark').value.trim()
        };

        updatedFields.weight = parseFloat((updatedFields.stockQty * updatedFields.sg).toFixed(2));

        try {
            await updateRawLedgerEntry(id, updatedFields);
            closeEditModal();
            showToast('✅ 원료 수불 전표가 수정되었습니다.');
            renderMaterialChips();
            renderLedgerTable();
        } catch (err) {
            alert('수정 실패: ' + err.message);
        }
    });

    // ==========================================
    // 필터 및 검색 이벤트 바인딩
    // ==========================================
    let searchDebounce = null;
    searchInput?.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(renderLedgerTable, 200);
    });

    container.querySelector('#btn-raw-search-reset')?.addEventListener('click', () => {
        searchInput.value = '';
        dateFromInput.value = '';
        dateToInput.value = '';
        typeSelect.value = 'ALL';
        selectedMaterial = 'ALL';
        renderMaterialChips();
        renderLedgerTable();
        showToast('🔄 원료수불부 검색 조건이 초기화되었습니다.');
    });

    // 빠른 기간 선택 버튼
    container.querySelectorAll('.btn-raw-period').forEach(btn => {
        btn.addEventListener('click', () => {
            const range = btn.getAttribute('data-range');
            container.querySelectorAll('.btn-raw-period').forEach(b => {
                b.className = 'btn-raw-period px-2.5 py-1 rounded-lg transition';
            });
            btn.className = 'btn-raw-period px-2.5 py-1 rounded-lg transition bg-white text-blue-700 shadow-2xs font-bold';

            const today = new Date();
            const format = d => d.toISOString().slice(0, 10);

            if (range === 'all') {
                dateFromInput.value = '';
                dateToInput.value = '';
            } else if (range === 'month') {
                const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
                dateFromInput.value = format(firstDay);
                dateToInput.value = format(today);
            } else if (range === '3month') {
                const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 1);
                dateFromInput.value = format(threeMonthsAgo);
                dateToInput.value = format(today);
            } else if (range === 'year') {
                const firstOfYear = new Date(today.getFullYear(), 0, 1);
                dateFromInput.value = format(firstOfYear);
                dateToInput.value = format(today);
            }
            renderLedgerTable();
        });
    });

    container.querySelector('#btn-raw-date-apply')?.addEventListener('click', renderLedgerTable);
    typeSelect?.addEventListener('change', renderLedgerTable);
    sortSelect?.addEventListener('change', (e) => {
        sortMode = e.target.value;
        renderLedgerTable();
    });

    container.querySelector('#btn-scroll-to-input')?.addEventListener('click', () => {
        container.querySelector('#section-raw-input')?.scrollIntoView({ behavior: 'smooth' });
        rawNameInput?.focus();
    });

    // ==========================================
    // 공식 A4 원료수불부 인쇄 기능
    // ==========================================
    container.querySelector('#btn-print-raw-ledger')?.addEventListener('click', () => {
        const query = searchInput.value.trim();
        const dateFrom = dateFromInput.value;
        const dateTo = dateToInput.value;
        const filterType = typeSelect.value;

        const filtered = state.rawLedger.filter(item => {
            if (selectedMaterial !== 'ALL' && item.name !== selectedMaterial) return false;
            if (filterType !== 'ALL' && item.type !== filterType) return false;
            if (!isDateInRange(item.date, dateFrom, dateTo)) return false;
            if (!matchesQuery(item, query, ['code', 'name', 'type', 'notes', 'remark', 'worker'])) return false;
            return true;
        });

        if (filtered.length === 0) {
            showToast('⚠️ 인쇄할 원료 수불 내역이 없습니다.');
            return;
        }

        let printContainer = document.getElementById('raw-ledger-print-container');
        if (!printContainer) {
            printContainer = document.createElement('div');
            printContainer.id = 'raw-ledger-print-container';
            printContainer.className = 'printable-area';
            document.body.appendChild(printContainer);
        }

        const nowStr = new Date().toLocaleString('ko-KR');
        const periodStr = `${dateFrom || '최초'} ~ ${dateTo || '현재'}`;
        const targetTitle = selectedMaterial === 'ALL' ? '전체 원료' : selectedMaterial;

        let totalIn = 0;
        let totalOut = 0;
        let lastStock = 0;
        let rowIdx = 1;

        const rowsHtml = filtered.map(item => {
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
                <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${item.date}</td>
                <td style="border:1px solid #cbd5e1; padding:4px; font-family:monospace; text-align:center;">${item.code || '-'}</td>
                <td style="border:1px solid #cbd5e1; padding:4px; font-weight:bold;">${item.name}</td>
                <td style="border:1px solid #cbd5e1; padding:4px; text-align:center;">${item.type}</td>
                <td style="border:1px solid #cbd5e1; padding:4px;">${item.notes || '-'}</td>
                <td style="border:1px solid #cbd5e1; padding:4px; text-align:right; color:#1d4ed8; font-weight:bold;">${inQty > 0 ? inQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}</td>
                <td style="border:1px solid #cbd5e1; padding:4px; text-align:right; color:#b91c1c; font-weight:bold;">${outQty > 0 ? outQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}</td>
                <td style="border:1px solid #cbd5e1; padding:4px; text-align:right; font-weight:bold; background:#f8fafc;">${stockQty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                <td style="border:1px solid #cbd5e1; padding:4px; text-align:right; color:#047857;">${weight > 0 ? weight.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}</td>
                <td style="border:1px solid #cbd5e1; padding:4px; text-align:center; font-family:monospace;">${item.sg || '1.0000'}</td>
                <td style="border:1px solid #cbd5e1; padding:4px; text-align:right;">${item.dm || '-'}</td>
                <td style="border:1px solid #cbd5e1; padding:4px;">${item.remark || '-'}</td>
            </tr>
            `;
        }).join('');

        printContainer.innerHTML = `
            <div style="font-family:'Noto Sans KR', sans-serif; color:#0f172a; padding:15px; width:100%; box-sizing:border-box;">
                <!-- 인쇄 상단 헤더 및 결재선 -->
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; border-bottom:2px solid #0f172a; padding-bottom:8px;">
                    <div>
                        <h1 style="font-size:20px; font-weight:900; margin:0 0 4px 0; letter-spacing:-0.5px;">(주)대림오일 원료수불부 (Raw Material Ledger)</h1>
                        <div style="font-size:11px; color:#475569; display:flex; gap:12px;">
                            <span><strong>대상 원료:</strong> ${targetTitle}</span>
                            <span><strong>집계 기간:</strong> ${periodStr}</span>
                            <span><strong>출력 일시:</strong> ${nowStr}</span>
                            <span><strong>총 건수:</strong> ${filtered.length.toLocaleString()}건</span>
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

                <!-- 테이블 -->
                <table style="width:100%; border-collapse:collapse; font-size:10px; margin-bottom:10px;">
                    <thead style="background:#f1f5f9; font-weight:bold;">
                        <tr>
                            <th style="border:1px solid #cbd5e1; padding:4px;">No</th>
                            <th style="border:1px solid #cbd5e1; padding:4px;">일자</th>
                            <th style="border:1px solid #cbd5e1; padding:4px;">품목코드</th>
                            <th style="border:1px solid #cbd5e1; padding:4px;">원료품명</th>
                            <th style="border:1px solid #cbd5e1; padding:4px;">분류</th>
                            <th style="border:1px solid #cbd5e1; padding:4px;">적요 (세부내용)</th>
                            <th style="border:1px solid #cbd5e1; padding:4px;">수(입고 L)</th>
                            <th style="border:1px solid #cbd5e1; padding:4px;">불(출고 L)</th>
                            <th style="border:1px solid #cbd5e1; padding:4px;">재고(L)</th>
                            <th style="border:1px solid #cbd5e1; padding:4px;">중량(KG)</th>
                            <th style="border:1px solid #cbd5e1; padding:4px;">비중(SG)</th>
                            <th style="border:1px solid #cbd5e1; padding:4px;">D/M</th>
                            <th style="border:1px solid #cbd5e1; padding:4px;">비고</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                    <tfoot style="background:#f8fafc; font-weight:bold;">
                        <tr>
                            <td colspan="6" style="border:1px solid #cbd5e1; padding:6px; text-align:center;">합계 및 기말 잔여 재고</td>
                            <td style="border:1px solid #cbd5e1; padding:6px; text-align:right; color:#1d4ed8;">+${totalIn.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                            <td style="border:1px solid #cbd5e1; padding:6px; text-align:right; color:#b91c1c;">-${totalOut.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                            <td style="border:1px solid #cbd5e1; padding:6px; text-align:right;">${lastStock.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L</td>
                            <td colspan="4" style="border:1px solid #cbd5e1; padding:6px; text-align:center; color:#64748b;">(주)대림오일 스마트 WMS 전산 원장</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;

        window.print();
    });

    // ==========================================
    // 엑셀 다운로드 기능
    // ==========================================
    container.querySelector('#btn-export-raw-excel')?.addEventListener('click', () => {
        const query = searchInput.value.trim();
        const dateFrom = dateFromInput.value;
        const dateTo = dateToInput.value;
        const filterType = typeSelect.value;

        const filtered = state.rawLedger.filter(item => {
            if (selectedMaterial !== 'ALL' && item.name !== selectedMaterial) return false;
            if (filterType !== 'ALL' && item.type !== filterType) return false;
            if (!isDateInRange(item.date, dateFrom, dateTo)) return false;
            if (!matchesQuery(item, query, ['code', 'name', 'type', 'notes', 'remark', 'worker'])) return false;
            return true;
        });

        const excelData = filtered.map((item, idx) => ({
            "순번": idx + 1,
            "수불일자": item.date,
            "품목코드": item.code || '',
            "원료품명": item.name,
            "분류": item.type,
            "적요": item.notes || '',
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
        XLSX.utils.book_append_sheet(wb, ws, "원료수불부");
        const fileName = `대림오일_원료수불부_${selectedMaterial}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, fileName);
        showToast(`📊 '${fileName}' 파일이 다운로드되었습니다.`);
    });

    // ==========================================
    // 초기 실행
    // ==========================================
    renderMaterialChips();
    renderLedgerTable();
};
