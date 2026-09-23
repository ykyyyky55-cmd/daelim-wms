import { state, saveSchedule, deleteSchedule, toggleScheduleStatus } from '../services/db.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';
import { openModalByName } from './Modals.js';
import { matchesQuery, searchMasterItems, determineSubCategory } from '../services/searchUtils.js';

export const renderLedgerCalendar = (container, { mode = 'ledger', showToast }) => {
    let currentCalendarDate = new Date();
    let scheduleFilterType = 'ALL';

    const render = () => {
        container.innerHTML = `
        <section id="tab-content-ledger-calendar" class="space-y-6">
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                    <div>
                        <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                            <i data-lucide="${mode === 'ledger' ? 'book-open-check' : 'calendar'}" class="w-5 h-5 ${mode === 'ledger' ? 'text-blue-600' : 'text-indigo-600'}"></i>
                            <span>${mode === 'ledger' ? '자재 수불부 (기초·입고·출고·현재고 원장)' : '월간 자재 수불 & 일정관리 캘린더'}</span>
                        </h2>
                        <p class="text-xs text-slate-500 mt-1">
                            ${mode === 'ledger' 
                                ? '선택 기간별 기초(전기이월) 재고, 기간 내 총 입고량(+), 총 출고량(-), 실시간 기말 현재고를 정밀 집계합니다.' 
                                : '날짜별 입출고 작업 실적과 입고예정·출고예정·재고실사·정기점검 일정을 통합 등록 및 관리합니다.'}
                        </p>
                    </div>

                    ${mode === 'ledger' ? `
                    <div class="flex items-center flex-wrap gap-2">
                        <button type="button" id="btn-open-bstock-modal" class="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                            <i data-lucide="archive" class="w-4 h-4"></i>
                            <span>기초/이월재고 설정</span>
                        </button>
                        <button type="button" id="btn-export-ledger-excel" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                            <i data-lucide="download" class="w-4 h-4"></i>
                            <span>수불부 엑셀 다운로드</span>
                        </button>
                        <button type="button" id="btn-print-ledger" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm" title="공식 A4 규격 수불 원장 일괄 인쇄 및 PDF 저장">
                            <i data-lucide="printer" class="w-4 h-4"></i>
                            <span>수불부 화면 일괄 인쇄 (PDF)</span>
                        </button>
                    </div>
                    ` : `
                    <div class="flex items-center flex-wrap gap-2">
                        <button type="button" id="btn-open-schedule-create" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                            <i data-lucide="plus-circle" class="w-4 h-4"></i>
                            <span>신규 일정 등록</span>
                        </button>
                        <div class="flex items-center gap-1 bg-slate-50 p-1 border border-slate-200 rounded-xl">
                            <button type="button" id="btn-cal-prev" class="p-1.5 bg-white hover:bg-slate-100 rounded-lg transition text-slate-700 font-bold text-xs"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
                            <span id="cal-month-title" class="font-black text-xs text-slate-800 px-2 font-mono"></span>
                            <button type="button" id="btn-cal-next" class="p-1.5 bg-white hover:bg-slate-100 rounded-lg transition text-slate-700 font-bold text-xs"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
                            <button type="button" id="btn-cal-today" class="px-2.5 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-lg font-bold text-xs transition">오늘</button>
                        </div>
                    </div>
                    `}
                </div>

                ${mode === 'ledger' ? `
                    <!-- 수불부 달력 기간 필터 바 (일자등록 및 연동검색) -->
                    <div class="bg-gradient-to-r from-blue-50/70 via-indigo-50/50 to-slate-50 p-3.5 rounded-xl border border-blue-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="font-bold text-blue-900 flex items-center gap-1.5">
                                <i data-lucide="calendar-range" class="w-4 h-4 text-blue-600"></i>
                                <span>수불 집계 기간:</span>
                            </span>
                            <div class="flex items-center gap-1.5 bg-white px-2.5 py-1 border border-slate-300 rounded-lg shadow-2xs">
                                <span class="text-[11px] font-bold text-slate-500">시작:</span>
                                <input type="date" id="ledger-date-from" class="text-xs font-bold text-slate-800 bg-transparent focus:outline-none" />
                            </div>
                            <span class="text-slate-400 font-bold">~</span>
                            <div class="flex items-center gap-1.5 bg-white px-2.5 py-1 border border-slate-300 rounded-lg shadow-2xs">
                                <span class="text-[11px] font-bold text-slate-500">종료:</span>
                                <input type="date" id="ledger-date-to" class="text-xs font-bold text-slate-800 bg-transparent focus:outline-none" />
                            </div>
                            <button type="button" id="btn-ledger-date-apply" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs shadow-2xs transition">기간 집계</button>
                        </div>

                        <div class="flex flex-wrap items-center gap-1">
                            <span class="text-[11px] text-slate-500 font-bold mr-1">빠른 기간:</span>
                            <button type="button" class="btn-ledger-quick-date px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 rounded-md text-[11px] font-bold text-slate-700 transition" data-range="all">전체(누적)</button>
                            <button type="button" class="btn-ledger-quick-date px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 rounded-md text-[11px] font-bold text-slate-700 transition" data-range="today">당일</button>
                            <button type="button" class="btn-ledger-quick-date px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 rounded-md text-[11px] font-bold text-slate-700 transition" data-range="week">금주</button>
                            <button type="button" class="btn-ledger-quick-date px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 rounded-md text-[11px] font-bold text-slate-700 transition" data-range="month">당월(이번달)</button>
                            <button type="button" class="btn-ledger-quick-date px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 rounded-md text-[11px] font-bold text-slate-700 transition" data-range="3months">최근 3개월</button>
                            <button type="button" class="btn-ledger-quick-date px-2 py-1 bg-white hover:bg-blue-50 border border-slate-200 rounded-md text-[11px] font-bold text-slate-700 transition" data-range="year">금년(연간)</button>
                        </div>
                    </div>

                    <!-- 종류별 빠른 선택 칩 바 (라벨, 아웃박스, 인박스, 캡, 용기 등) -->
                    <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs select-none" id="ledger-subcat-chips">
                        <span class="text-slate-500 font-bold text-[11px] whitespace-nowrap mr-1 flex items-center gap-1">
                            <i data-lucide="tag" class="w-3.5 h-3.5 text-blue-600"></i> 종류별 선택:
                        </span>
                        <button type="button" class="btn-ledger-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-blue-600 text-white shadow-2xs" data-sub="ALL">
                            전체 (<span id="ledger-cnt-sub-all">${state.master.length}</span>)
                        </button>
                        <button type="button" class="btn-ledger-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-300" data-sub="라벨">
                            🏷️ 라벨 (<span id="ledger-cnt-sub-label">0</span>)
                        </button>
                        <button type="button" class="btn-ledger-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300" data-sub="아웃박스">
                            📦 아웃박스 (<span id="ledger-cnt-sub-outbox">0</span>)
                        </button>
                        <button type="button" class="btn-ledger-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-indigo-50 hover:text-indigo-800 hover:border-indigo-300" data-sub="인박스">
                            📥 인박스 (<span id="ledger-cnt-sub-inbox">0</span>)
                        </button>
                        <button type="button" class="btn-ledger-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-cyan-50 hover:text-cyan-800 hover:border-cyan-300" data-sub="캡">
                            🔘 캡 (<span id="ledger-cnt-sub-cap">0</span>)
                        </button>
                        <button type="button" class="btn-ledger-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-purple-50 hover:text-purple-800 hover:border-purple-300" data-sub="용기">
                            🫙 용기 (<span id="ledger-cnt-sub-bottle">0</span>)
                        </button>
                        <button type="button" class="btn-ledger-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-blue-50 hover:text-blue-800 hover:border-blue-300" data-sub="완제품">
                            ⚙️ 완제품 (<span id="ledger-cnt-sub-finished">0</span>)
                        </button>
                        <button type="button" class="btn-ledger-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-rose-50 hover:text-rose-800 hover:border-rose-300" data-sub="원료">
                            🧪 원료 (<span id="ledger-cnt-sub-raw">0</span>)
                        </button>
                    </div>

                    <!-- 분류, 일괄출력 토글 및 검색 바 -->
                    <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div class="flex flex-wrap items-center gap-2">
                            <div class="flex items-center gap-1.5">
                                <span class="text-xs font-bold text-slate-600">분류:</span>
                                <select id="ledger-filter-category" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                                    <option value="">전체 분류 (${state.categories.length})</option>
                                    ${state.categories.map(c => `<option value="${c}">${c}</option>`).join('')}
                                </select>
                            </div>

                            <div class="flex items-center gap-1.5">
                                <span class="text-xs font-bold text-slate-600">거래처:</span>
                                <select id="ledger-filter-partner" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                                    <option value="">전체 거래처</option>
                                    ${(state.partners || []).map(p => `<option value="${p}">${p}</option>`).join('')}
                                </select>
                            </div>

                            <!-- 0000 임시코드 수불 모아보기 토글 버튼 -->
                            <button type="button" id="btn-ledger-filter-temp" class="px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-white text-slate-700 border-slate-300 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300">
                                <i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-amber-500"></i>
                                <span>임시코드(0000) 모아보기</span>
                                <span id="badge-ledger-temp-count" class="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-amber-800 font-black">0</span>
                            </button>

                            <!-- 모든내역 화면 일괄출력(전체보기) 토글 버튼 -->
                            <button type="button" id="btn-ledger-toggle-all" class="px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-white text-slate-700 border-slate-300 hover:bg-indigo-50 hover:text-indigo-800 hover:border-indigo-300 shadow-2xs" title="페이징 없이 모든 품목 내역을 한 화면에 일괄 출력">
                                <i data-lucide="layers" class="w-3.5 h-3.5 text-indigo-600"></i>
                                <span id="lbl-ledger-toggle-all">모든내역 화면 일괄출력</span>
                            </button>
                        </div>

                        <!-- 검색창 및 검색/초기화 버튼 -->
                        <div class="flex items-center gap-1.5">
                            <div class="relative">
                                <input type="text" id="ledger-search-input" placeholder="코드, 품명, 규격, 거래처 검색..." class="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none w-56 sm:w-64" />
                                <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2"></i>
                            </div>
                            <button type="button" id="btn-ledger-search" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-2xs" title="검색 실행 (Enter)">
                                <i data-lucide="search" class="w-3.5 h-3.5"></i>
                                <span>검색</span>
                            </button>
                            <button type="button" id="btn-ledger-search-reset" class="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-bold text-slate-600 transition" title="검색어 및 필터 초기화">
                                <span>초기화</span>
                            </button>
                        </div>
                    </div>

                    <!-- 수불부 요약 카드 -->
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <span class="text-slate-500 font-bold block">조회 대상 품목수</span>
                            <span id="stat-ledger-items" class="text-lg font-black text-slate-900">${state.master.length.toLocaleString()}개</span>
                        </div>
                        <div class="bg-blue-50 p-3 rounded-xl border border-blue-200">
                            <span class="text-blue-700 font-bold block">선택 기간 총 입고량 (+)</span>
                            <span id="stat-ledger-in" class="text-lg font-black text-blue-700">-</span>
                        </div>
                        <div class="bg-rose-50 p-3 rounded-xl border border-rose-200">
                            <span class="text-rose-700 font-bold block">선택 기간 총 출고량 (-)</span>
                            <span id="stat-ledger-out" class="text-lg font-black text-rose-700">-</span>
                        </div>
                        <div class="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                            <span class="text-emerald-700 font-bold block">기말 현재고 총합</span>
                            <span id="stat-ledger-stock" class="text-lg font-black text-emerald-700">-</span>
                        </div>
                    </div>

                    <!-- 수불부 테이블 -->
                    <div class="overflow-x-auto border border-slate-200 rounded-xl">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-slate-100 text-slate-700 border-b border-slate-200 font-bold">
                                <tr>
                                    <th class="p-3">품목코드</th>
                                    <th class="p-3">분류 / 종류</th>
                                    <th class="p-3">품목명</th>
                                    <th class="p-3">주요 거래처</th>
                                    <th class="p-3 text-right bg-amber-50/70 text-amber-900">기초(이월)재고</th>
                                    <th class="p-3 text-right bg-blue-50/70 text-blue-900">기간 총 입고 (+)</th>
                                    <th class="p-3 text-right bg-rose-50/70 text-rose-900">기간 총 출고 (-)</th>
                                    <th class="p-3 text-right bg-slate-200/70 text-slate-900 font-black">기말 현재고 잔량</th>
                                    <th class="p-3 text-center">단위</th>
                                    <th class="p-3 text-right">안전재고</th>
                                    <th class="p-3 text-center">수불 상태</th>
                                </tr>
                            </thead>
                            <tbody id="ledger-table-body" class="divide-y divide-slate-100"></tbody>
                        </table>
                    </div>

                    <!-- 자재수불부 페이지네이션 컨트롤 바 -->
                    <div id="ledger-pagination-bar" class="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs">
                        <div class="flex items-center gap-2 text-slate-600 font-medium">
                            <span id="ledger-page-info" class="font-bold text-slate-700">총 0건 중 0~0건 표시</span>
                            <div class="flex items-center gap-1 ml-2">
                                <span class="text-slate-400 text-[11px]">페이지당:</span>
                                <select id="ledger-page-size" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer">
                                    <option value="30">30개</option>
                                    <option value="50" selected>50개</option>
                                    <option value="100">100개</option>
                                    <option value="200">200개</option>
                                    <option value="all">전체 (모두 표시)</option>
                                </select>
                            </div>
                        </div>
                        <div class="flex items-center gap-1 select-none" id="ledger-page-buttons"></div>
                    </div>
                ` : `
                    <!-- 캘린더 일정 필터 탭 -->
                    <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                        <div class="flex flex-wrap items-center gap-1.5" id="cal-schedule-filter-group">
                            <span class="font-bold text-slate-600 mr-1">일정 구분:</span>
                            <button type="button" class="btn-sched-filter px-2.5 py-1 rounded-lg font-bold bg-indigo-600 text-white shadow-2xs" data-type="ALL">전체 (${state.schedules.length})</button>
                            <button type="button" class="btn-sched-filter px-2.5 py-1 rounded-lg font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-100" data-type="IN_PLAN">입고예정</button>
                            <button type="button" class="btn-sched-filter px-2.5 py-1 rounded-lg font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-100" data-type="OUT_PLAN">출고예정</button>
                            <button type="button" class="btn-sched-filter px-2.5 py-1 rounded-lg font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-100" data-type="AUDIT">재고실사</button>
                            <button type="button" class="btn-sched-filter px-2.5 py-1 rounded-lg font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-100" data-type="MAINTENANCE">설비/점검</button>
                            <button type="button" class="btn-sched-filter px-2.5 py-1 rounded-lg font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-100" data-type="TODO_ONLY">미완료만</button>
                        </div>
                        <div class="text-[11px] text-slate-500 font-medium">
                            날짜를 클릭하면 해당 일자의 상세 일정 조회, 완료 체크, 신규 일정 등록이 가능합니다.
                        </div>
                    </div>

                    <!-- 캘린더 요일 헤더 -->
                    <div class="grid grid-cols-7 gap-2 text-center text-xs font-bold text-slate-500 mb-2">
                        <div class="text-rose-500 py-1">일</div>
                        <div class="py-1">월</div>
                        <div class="py-1">화</div>
                        <div class="py-1">수</div>
                        <div class="py-1">목</div>
                        <div class="py-1">금</div>
                        <div class="text-blue-500 py-1">토</div>
                    </div>
                    <div class="grid grid-cols-7 gap-2" id="calendar-days-grid"></div>

                    <!-- 하단: 다가오는 주요 일정 목록 (Upcoming Schedules) -->
                    <div class="pt-4 border-t border-slate-200 space-y-3">
                        <div class="flex items-center justify-between">
                            <h3 class="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                                <i data-lucide="clock" class="w-4 h-4 text-indigo-600"></i>
                                <span>다가오는 주요 작업 일정</span>
                            </h3>
                            <button type="button" id="btn-add-schedule-bottom" class="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1">
                                <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                                <span>새 일정 추가</span>
                            </button>
                        </div>
                        <div id="upcoming-schedules-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"></div>
                    </div>

                    <!-- 일자별 상세 모달 (일정 + 작업 내역) -->
                    <div id="cal-day-detail-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
                        <div class="bg-white max-w-xl w-full rounded-2xl shadow-2xl overflow-hidden border border-slate-100 max-h-[85vh] flex flex-col">
                            <div class="px-5 py-3.5 bg-slate-900 text-white flex justify-between items-center flex-shrink-0">
                                <h3 id="cal-day-modal-title" class="font-bold text-sm">일자별 일정 & 작업 내역</h3>
                                <button type="button" id="btn-close-day-modal" class="text-slate-400 hover:text-white text-xl">&times;</button>
                            </div>
                            <div class="p-5 overflow-y-auto space-y-4 flex-1 text-xs" id="cal-day-modal-content"></div>
                        </div>
                    </div>

                    <!-- 신규 일정 등록 모달 -->
                    <div id="modal-schedule-create" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
                        <div class="bg-white max-w-md w-full rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
                            <div class="px-5 py-3.5 bg-indigo-900 text-white flex justify-between items-center">
                                <h3 class="font-bold text-sm flex items-center gap-1.5">
                                    <i data-lucide="calendar-plus" class="w-4 h-4 text-indigo-300"></i>
                                    <span>신규 WMS 작업 일정 등록</span>
                                </h3>
                                <button type="button" id="btn-close-sched-modal" class="text-slate-400 hover:text-white text-xl">&times;</button>
                            </div>
                            <form id="form-schedule-create" class="p-5 space-y-3.5 text-xs">
                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label class="block font-bold text-slate-700 mb-1">일정 일자 *</label>
                                        <input type="date" id="sched-input-date" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-900" />
                                    </div>
                                    <div>
                                        <label class="block font-bold text-slate-700 mb-1">일정 구분 *</label>
                                        <select id="sched-input-type" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-800">
                                            <option value="IN_PLAN">입고예정 (+)</option>
                                            <option value="OUT_PLAN">출고/납품예정 (-)</option>
                                            <option value="AUDIT">정기 재고실사</option>
                                            <option value="MAINTENANCE">설비/안전점검</option>
                                            <option value="ORDER_DEADLINE">발주 마감</option>
                                            <option value="TRAINING">안전/직무교육</option>
                                            <option value="OTHER">일반 / 기타</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label class="block font-bold text-slate-700 mb-1">일정 제목 *</label>
                                    <input type="text" id="sched-input-title" required placeholder="예: SK엔무브 원료 40드럼 입고 검수" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-900" />
                                </div>

                                <div>
                                    <label class="block font-bold text-slate-700 mb-1">연계 품목 (선택 / 일부문자 검색)</label>
                                    <div class="relative">
                                        <input type="text" id="sched-input-item" placeholder="품목코드 또는 품명 일부 입력..." class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-medium" autocomplete="off" />
                                        <div id="sched-item-suggestions" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-20 max-h-40 overflow-y-auto divide-y divide-slate-100"></div>
                                    </div>
                                </div>

                                <div class="grid grid-cols-2 gap-3">
                                    <div>
                                        <label class="block font-bold text-slate-700 mb-1">관련 거래처</label>
                                        <select id="sched-input-partner" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-700">
                                            <option value="">선택 안 함</option>
                                            ${(state.partners || []).map(p => `<option value="${p}">${p}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div>
                                        <label class="block font-bold text-slate-700 mb-1">담당 작업자</label>
                                        <select id="sched-input-worker" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold text-slate-700">
                                            ${state.workers.map(w => `<option value="${w.name}" ${state.currentGlobalWorker.includes(w.name) ? 'selected' : ''}>${w.name}</option>`).join('')}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label class="block font-bold text-slate-700 mb-1">세부 메모 / 비고사항</label>
                                    <textarea id="sched-input-notes" rows="2" placeholder="준비물, 주의사항, 검수 체크리스트 등" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2"></textarea>
                                </div>

                                <div class="pt-2 flex justify-end gap-2">
                                    <button type="button" id="btn-cancel-sched" class="px-4 py-2 border border-slate-300 rounded-xl text-slate-600 font-bold hover:bg-slate-50">취소</button>
                                    <button type="submit" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-sm">일정 저장 및 클라우드 반영</button>
                                </div>
                            </form>
                        </div>
                    </div>
                `}
            </div>
        </section>
        `;

        if (mode === 'ledger') {
            setupLedger();
        } else {
            setupCalendar();
        }

        createIcons({ icons });
    };

    // ==========================================
    // 1. 자재 수불부 (Ledger) 로직
    // ==========================================
    const setupLedger = () => {
        const catSelect = container.querySelector('#ledger-filter-category');
        const partnerSelect = container.querySelector('#ledger-filter-partner');
        const searchInput = container.querySelector('#ledger-search-input');
        const btnSearch = container.querySelector('#btn-ledger-search');
        const btnSearchReset = container.querySelector('#btn-ledger-search-reset');
        const btnToggleAll = container.querySelector('#btn-ledger-toggle-all');
        const lblToggleAll = container.querySelector('#lbl-ledger-toggle-all');
        const btnPrint = container.querySelector('#btn-print-ledger');
        const dateFromInput = container.querySelector('#ledger-date-from');
        const dateToInput = container.querySelector('#ledger-date-to');
        const tbody = container.querySelector('#ledger-table-body');
        const btnBStock = container.querySelector('#btn-open-bstock-modal');
        const btnExcel = container.querySelector('#btn-export-ledger-excel');
        const btnFilterTemp = container.querySelector('#btn-ledger-filter-temp');
        const pageSizeSelect = container.querySelector('#ledger-page-size');
        const pageInfoEl = container.querySelector('#ledger-page-info');
        const pageButtonsEl = container.querySelector('#ledger-page-buttons');

        let filterTempOnly = false;
        let selectedSubCategory = 'ALL';
        let currentPage = 1;
        let pageSize = 50;
        let cachedCalculatedList = null;

        btnBStock?.addEventListener('click', () => openModalByName('beginning-stock'));

        // 기본 기간: 당월 (이번달 1일 ~ 오늘)
        const today = new Date();
        const formatDate = (d) => d.toISOString().slice(0, 10);
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        dateFromInput.value = formatDate(firstDayOfMonth);
        dateToInput.value = formatDate(today);

        const setLedgerPeriod = (rangeType) => {
            container.querySelectorAll('.btn-ledger-quick-date').forEach(b => {
                if (b.getAttribute('data-range') === rangeType) {
                    b.classList.add('bg-blue-600', 'text-white');
                    b.classList.remove('bg-white', 'text-slate-700');
                } else {
                    b.classList.remove('bg-blue-600', 'text-white');
                    b.classList.add('bg-white', 'text-slate-700');
                }
            });

            if (rangeType === 'all') {
                dateFromInput.value = '';
                dateToInput.value = '';
            } else if (rangeType === 'today') {
                dateFromInput.value = formatDate(today);
                dateToInput.value = formatDate(today);
            } else if (rangeType === 'week') {
                const day = today.getDay();
                const diff = today.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(today.setDate(diff));
                dateFromInput.value = formatDate(monday);
                dateToInput.value = formatDate(new Date());
            } else if (rangeType === 'month') {
                dateFromInput.value = formatDate(firstDayOfMonth);
                dateToInput.value = formatDate(new Date());
            } else if (rangeType === '3months') {
                const past3m = new Date();
                past3m.setMonth(past3m.getMonth() - 3);
                dateFromInput.value = formatDate(past3m);
                dateToInput.value = formatDate(new Date());
            } else if (rangeType === 'year') {
                const firstDayOfYear = new Date(today.getFullYear(), 0, 1);
                dateFromInput.value = formatDate(firstDayOfYear);
                dateToInput.value = formatDate(new Date());
            }
            currentPage = 1;
            renderLedgerRows(true);
        };

        container.querySelectorAll('.btn-ledger-quick-date').forEach(btn => {
            btn.addEventListener('click', () => setLedgerPeriod(btn.getAttribute('data-range')));
        });

        container.querySelector('#btn-ledger-date-apply')?.addEventListener('click', () => {
            currentPage = 1;
            renderLedgerRows(true);
        });

        // 0000 임시코드 수 카운트 갱신
        const updateLedgerTempBadge = () => {
            const tempCount = state.master.filter(m => m.code.startsWith('0000')).length;
            const badge = container.querySelector('#badge-ledger-temp-count');
            if (badge) {
                badge.textContent = tempCount;
                if (tempCount > 0) {
                    badge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-black animate-pulse';
                } else {
                    badge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-600 font-bold';
                }
            }
        };

        // 종류별 빠른 선택 칩 카운트 갱신
        const updateLedgerSubCategoryChipCounts = () => {
            const counts = { ALL: state.master.length, '라벨': 0, '아웃박스': 0, '인박스': 0, '캡': 0, '용기': 0, '완제품': 0, '원료': 0 };
            for (const m of state.master) {
                const sub = m.subCategory || determineSubCategory(m);
                if (counts[sub] !== undefined) counts[sub]++;
            }
            const setTxt = (id, val) => {
                const el = container.querySelector(id);
                if (el) el.textContent = val.toLocaleString();
            };
            setTxt('#ledger-cnt-sub-all', counts.ALL);
            setTxt('#ledger-cnt-sub-label', counts['라벨']);
            setTxt('#ledger-cnt-sub-outbox', counts['아웃박스']);
            setTxt('#ledger-cnt-sub-inbox', counts['인박스']);
            setTxt('#ledger-cnt-sub-cap', counts['캡']);
            setTxt('#ledger-cnt-sub-bottle', counts['용기']);
            setTxt('#ledger-cnt-sub-finished', counts['완제품']);
            setTxt('#ledger-cnt-sub-raw', counts['원료']);
        };

        // 재고 및 수불 이력 사전 인덱싱 Map 빌더 (1회 O(N)으로 2,882건 연산 대폭 최적화)
        const buildLedgerCache = () => {
            const invTotalMap = new Map();
            for (const inv of (state.inventory || [])) {
                const code = inv.code;
                const qty = Number(inv.quantity) || 0;
                invTotalMap.set(code, (invTotalMap.get(code) || 0) + qty);
            }

            const histMap = new Map();
            for (const h of (state.history || [])) {
                const code = h.code;
                let list = histMap.get(code);
                if (!list) {
                    list = [];
                    histMap.set(code, list);
                }
                let dStr = '';
                if (h.timestamp) {
                    const m = h.timestamp.match(/(\d{4})[-\.\/](\d{1,2})[-\.\/](\d{1,2})/);
                    if (m) {
                        dStr = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
                    }
                }
                list.push({
                    qty: Number(h.qty) || 0,
                    type: h.type,
                    dStr
                });
            }

            return { invTotalMap, histMap };
        };

        // 개별 품목의 기간 수불 초고속 계산 엔진
        const calculateItemLedger = (m, dateFrom, dateTo, cache) => {
            const hasExplicitBStock = (state.beginningStock && state.beginningStock[m.code] !== undefined) || (m.beginningStock !== undefined);
            
            let baseBStock = 0;
            if (hasExplicitBStock) {
                baseBStock = (state.beginningStock && state.beginningStock[m.code] !== undefined)
                    ? Number(state.beginningStock[m.code])
                    : Number(m.beginningStock);
            } else {
                const totalInv = cache.invTotalMap.get(m.code) || 0;
                const allItemLogs = cache.histMap.get(m.code) || [];
                let allIn = 0;
                let allOut = 0;
                for (let i = 0; i < allItemLogs.length; i++) {
                    const h = allItemLogs[i];
                    if (h.type === 'IN') allIn += h.qty;
                    else if (h.type === 'OUT' || h.type === 'USE') allOut += h.qty;
                }
                baseBStock = Math.max(0, totalInv - allIn + allOut);
            }

            const logs = cache.histMap.get(m.code) || [];
            let priorIn = 0;
            let priorOut = 0;
            let periodIn = 0;
            let periodOut = 0;

            for (let i = 0; i < logs.length; i++) {
                const l = logs[i];
                const qty = l.qty;
                const dStr = l.dStr;

                if (dateFrom && dStr && dStr < dateFrom) {
                    if (l.type === 'IN') priorIn += qty;
                    else if (l.type === 'OUT' || l.type === 'USE') priorOut += qty;
                } else if ((!dateFrom || (dStr && dStr >= dateFrom)) && (!dateTo || (dStr && dStr <= dateTo))) {
                    if (l.type === 'IN') periodIn += qty;
                    else if (l.type === 'OUT' || l.type === 'USE') periodOut += qty;
                }
            }

            const effectiveBeginning = baseBStock + priorIn - priorOut;
            const currentStock = effectiveBeginning + periodIn - periodOut;
            return {
                beginning: effectiveBeginning,
                inQty: periodIn,
                outQty: periodOut,
                ending: currentStock
            };
        };

        // [모든내역 화면 일괄출력] 버튼 시각 상태 갱신
        const updateToggleAllButtonState = (isAll) => {
            if (!btnToggleAll) return;
            if (isAll) {
                btnToggleAll.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-indigo-600 text-white border-indigo-700 shadow-sm';
                if (lblToggleAll) lblToggleAll.textContent = '50개씩 페이징 보기';
            } else {
                btnToggleAll.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-white text-slate-700 border-slate-300 hover:bg-indigo-50 hover:text-indigo-800 hover:border-indigo-300 shadow-2xs';
                if (lblToggleAll) lblToggleAll.textContent = '모든내역 화면 일괄출력';
            }
        };

        // 페이지네이션 컨트롤러 렌더링
        const renderPaginationControls = (totalCount, startIndex, endIndex, totalPages) => {
            if (!pageInfoEl || !pageButtonsEl) return;
            pageInfoEl.textContent = `총 ${totalCount.toLocaleString()}건 중 ${totalCount > 0 ? (startIndex + 1).toLocaleString() : 0}~${endIndex.toLocaleString()}건 표시 (페이지 ${currentPage}/${totalPages})`;

            if (totalPages <= 1) {
                pageButtonsEl.innerHTML = '';
                return;
            }

            let html = `
                <button type="button" class="btn-page px-2 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition" data-page="1" ${currentPage === 1 ? 'disabled' : ''} title="첫 페이지">
                    &laquo;
                </button>
                <button type="button" class="btn-page px-2.5 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} title="이전 페이지">
                    &lsaquo; 이전
                </button>
            `;

            let startP = Math.max(1, currentPage - 2);
            let endP = Math.min(totalPages, startP + 4);
            if (endP - startP < 4) {
                startP = Math.max(1, endP - 4);
            }

            for (let p = startP; p <= endP; p++) {
                const isActive = p === currentPage;
                html += `
                    <button type="button" class="btn-page px-2.5 py-1 rounded-md text-[11px] font-bold transition ${isActive ? 'bg-blue-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'}" data-page="${p}">
                        ${p}
                    </button>
                `;
            }

            html += `
                <button type="button" class="btn-page px-2.5 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''} title="다음 페이지">
                    다음 &rsaquo;
                </button>
                <button type="button" class="btn-page px-2 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition" data-page="${totalPages}" ${currentPage === totalPages ? 'disabled' : ''} title="마지막 페이지">
                    &raquo;
                </button>
            `;

            pageButtonsEl.innerHTML = html;
            pageButtonsEl.querySelectorAll('.btn-page').forEach(btn => {
                btn.addEventListener('click', () => {
                    const targetPage = Number(btn.getAttribute('data-page'));
                    if (targetPage && targetPage !== currentPage && targetPage >= 1 && targetPage <= totalPages) {
                        currentPage = targetPage;
                        renderLedgerRows(false);
                    }
                });
            });
        };

        const renderLedgerRows = (recalculate = true) => {
            const cat = catSelect.value;
            const partner = partnerSelect.value;
            const q = searchInput.value.trim();
            const dateFrom = dateFromInput.value;
            const dateTo = dateToInput.value;

            if (recalculate || !cachedCalculatedList) {
                const cache = buildLedgerCache();
                let totalIn = 0;
                let totalOut = 0;
                let totalStock = 0;

                const filtered = state.master.filter(m => {
                    const isTemp = m.code.startsWith('0000');
                    if (filterTempOnly && !isTemp) return false;
                    const sub = m.subCategory || determineSubCategory(m);
                    if (selectedSubCategory !== 'ALL' && sub !== selectedSubCategory) return false;
                    const matchesCat = !cat || m.category === cat;
                    const matchesPartner = !partner || m.supplier === partner;
                    const matchesQ = !q || matchesQuery(m, q, ['code', 'name', 'spec', 'supplier', 'category', 'subCategory']);
                    return matchesCat && matchesPartner && matchesQ;
                });

                updateLedgerTempBadge();
                updateLedgerSubCategoryChipCounts();
                container.querySelector('#stat-ledger-items').textContent = `${filtered.length.toLocaleString()}개`;

                if (filtered.length === 0) {
                    cachedCalculatedList = [];
                    tbody.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-slate-400 text-xs">일치하는 수불 내역이 없습니다. (검색 조건 또는 기간을 확인하세요)</td></tr>';
                    container.querySelector('#stat-ledger-in').textContent = '0';
                    container.querySelector('#stat-ledger-out').textContent = '0';
                    container.querySelector('#stat-ledger-stock').textContent = '0';
                    renderPaginationControls(0, 0, 0, 1);
                    return;
                }

                // 전체 필터 품목 수불 일괄 계산 (Map 캐시로 2,882건도 0.02초 이내 완료)
                cachedCalculatedList = filtered.map(m => {
                    const ledger = calculateItemLedger(m, dateFrom, dateTo, cache);
                    totalIn += ledger.inQty;
                    totalOut += ledger.outQty;
                    totalStock += ledger.ending;
                    return {
                        master: m,
                        ledger
                    };
                });

                container.querySelector('#stat-ledger-in').textContent = `+${totalIn.toLocaleString()}`;
                container.querySelector('#stat-ledger-out').textContent = `-${totalOut.toLocaleString()}`;
                container.querySelector('#stat-ledger-stock').textContent = `${totalStock.toLocaleString()}`;
            }

            const totalCount = cachedCalculatedList.length;
            const isAll = pageSize === 'all';
            const actualSize = isAll ? totalCount : Number(pageSize);
            const totalPages = Math.max(1, Math.ceil(totalCount / actualSize));
            if (currentPage > totalPages) currentPage = totalPages;
            if (currentPage < 1) currentPage = 1;

            const startIndex = (currentPage - 1) * actualSize;
            const endIndex = Math.min(startIndex + actualSize, totalCount);
            const pagedList = cachedCalculatedList.slice(startIndex, endIndex);

            // 대량 일괄 렌더링 시 브라우저 버벅임을 방지하기 위해 경량 텍스트/뱃지 사용
            tbody.innerHTML = pagedList.map(({ master: m, ledger }) => {
                const { beginning, inQty, outQty, ending } = ledger;
                const safety = Number(m.safety) || 0;
                const isShort = ending <= safety;
                const isTemp = m.code.startsWith('0000');
                const sub = m.subCategory || determineSubCategory(m);

                let subBadgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
                let subIcon = '🏷️';
                if (sub === '라벨') { subBadgeClass = 'bg-emerald-50 text-emerald-800 border-emerald-200'; subIcon = '🏷️'; }
                else if (sub === '아웃박스') { subBadgeClass = 'bg-amber-50 text-amber-800 border-amber-200'; subIcon = '📦'; }
                else if (sub === '인박스') { subBadgeClass = 'bg-indigo-50 text-indigo-800 border-indigo-200'; subIcon = '📥'; }
                else if (sub === '캡') { subBadgeClass = 'bg-cyan-50 text-cyan-800 border-cyan-200'; subIcon = '🔘'; }
                else if (sub === '용기') { subBadgeClass = 'bg-purple-50 text-purple-800 border-purple-200'; subIcon = '🫙'; }
                else if (sub === '완제품') { subBadgeClass = 'bg-blue-50 text-blue-800 border-blue-200'; subIcon = '⚙️'; }
                else if (sub === '원료') { subBadgeClass = 'bg-rose-50 text-rose-800 border-rose-200'; subIcon = '🧪'; }

                return `
                <tr class="hover:bg-slate-50 transition ${isTemp ? 'bg-amber-50/30' : ''}">
                    <td class="p-3">
                        ${isTemp ? `
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-black bg-amber-100 text-amber-800 border border-amber-300">
                                <span class="text-amber-600 text-xs">⚠️</span>
                                ${m.code} <span class="text-[9px] bg-amber-500 text-white px-1 rounded">임시</span>
                            </span>
                        ` : `
                            <span class="font-mono font-bold text-blue-600">${m.code}</span>
                        `}
                    </td>
                    <td class="p-3">
                        <div class="flex flex-col gap-1 items-start">
                            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${subBadgeClass}">
                                <span>${subIcon}</span> <span>${sub}</span>
                            </span>
                            ${m.category && m.category !== sub ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isTemp ? 'bg-amber-200 text-amber-900' : 'bg-slate-100 text-slate-600'}">${m.category}</span>` : ''}
                        </div>
                    </td>
                    <td class="p-3 font-bold text-slate-900">${m.name}</td>
                    <td class="p-3 text-slate-600 font-bold">${m.supplier || '-'}</td>
                    <td class="p-3 text-right font-mono font-bold text-amber-800 bg-amber-50/40">${beginning.toLocaleString()}</td>
                    <td class="p-3 text-right font-black text-blue-600 bg-blue-50/40">+${inQty.toLocaleString()}</td>
                    <td class="p-3 text-right font-black text-rose-600 bg-rose-50/40">-${outQty.toLocaleString()}</td>
                    <td class="p-3 text-right font-black text-sm text-slate-900 bg-slate-100/50">${ending.toLocaleString()}</td>
                    <td class="p-3 text-center font-bold text-slate-500">${m.unit || 'EA'}</td>
                    <td class="p-3 text-right font-bold text-slate-400">${safety.toLocaleString()}</td>
                    <td class="p-3 text-center">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isShort ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}">
                            ${isShort ? '부족' : '안정'}
                        </span>
                    </td>
                </tr>
                `;
            }).join('');

            renderPaginationControls(totalCount, startIndex, endIndex, totalPages);
            updateToggleAllButtonState(isAll);
            if (!isAll) {
                createIcons({ icons });
            }
        };

        // 0000 임시코드 토글 버튼 이벤트
        btnFilterTemp?.addEventListener('click', () => {
            filterTempOnly = !filterTempOnly;
            if (filterTempOnly) {
                btnFilterTemp.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-amber-500 text-white border-amber-600 shadow-xs';
            } else {
                btnFilterTemp.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-white text-slate-700 border-slate-300 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300';
            }
            currentPage = 1;
            renderLedgerRows(true);
        });

        // [모든내역 화면 일괄출력] 토글 버튼 이벤트
        btnToggleAll?.addEventListener('click', () => {
            if (pageSize === 'all') {
                pageSize = 50;
                if (pageSizeSelect) pageSizeSelect.value = '50';
            } else {
                pageSize = 'all';
                if (pageSizeSelect) pageSizeSelect.value = 'all';
            }
            currentPage = 1;
            renderLedgerRows(false);
        });

        // 하단 페이지당 건수 셀렉트 변경 이벤트
        pageSizeSelect?.addEventListener('change', (e) => {
            pageSize = e.target.value;
            currentPage = 1;
            renderLedgerRows(false);
        });

        // 명시적 검색 버튼 클릭 이벤트
        btnSearch?.addEventListener('click', () => {
            currentPage = 1;
            renderLedgerRows(true);
        });

        // 검색창 엔터(Enter) 키 이벤트
        searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                currentPage = 1;
                renderLedgerRows(true);
            }
        });

        // 검색어 입력 시 디바운스 실시간 검색
        let searchDebounceTimer = null;
        searchInput?.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                currentPage = 1;
                renderLedgerRows(true);
            }, 300);
        });

        // 종류별 퀵 선택 칩 클릭 이벤트
        container.querySelectorAll('.btn-ledger-subcat-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedSubCategory = btn.getAttribute('data-sub');
                container.querySelectorAll('.btn-ledger-subcat-chip').forEach(b => {
                    if (b.getAttribute('data-sub') === selectedSubCategory) {
                        b.className = 'btn-ledger-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-blue-600 text-white shadow-2xs';
                    } else {
                        b.className = 'btn-ledger-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-slate-100';
                    }
                });
                currentPage = 1;
                renderLedgerRows(true);
            });
        });

        // 검색 및 필터 초기화 버튼
        btnSearchReset?.addEventListener('click', () => {
            searchInput.value = '';
            catSelect.value = '';
            partnerSelect.value = '';
            filterTempOnly = false;
            selectedSubCategory = 'ALL';
            container.querySelectorAll('.btn-ledger-subcat-chip').forEach(b => {
                if (b.getAttribute('data-sub') === 'ALL') {
                    b.className = 'btn-ledger-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-blue-600 text-white shadow-2xs';
                } else {
                    b.className = 'btn-ledger-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-slate-100';
                }
            });
            if (btnFilterTemp) {
                btnFilterTemp.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-white text-slate-700 border-slate-300 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300';
            }
            setLedgerPeriod('month');
            showToast('🔄 자재수불부 검색 조건 및 기간이 초기화되었습니다.');
        });

        catSelect?.addEventListener('change', () => {
            currentPage = 1;
            renderLedgerRows(true);
        });
        partnerSelect?.addEventListener('change', () => {
            currentPage = 1;
            renderLedgerRows(true);
        });
        dateFromInput?.addEventListener('change', () => {
            currentPage = 1;
            renderLedgerRows(true);
        });
        dateToInput?.addEventListener('change', () => {
            currentPage = 1;
            renderLedgerRows(true);
        });
        renderLedgerRows(true);

        // 공식 A4 규격 수불 원장 화면 일괄 인쇄 (PDF 출력 지원)
        btnPrint?.addEventListener('click', () => {
            const dateFrom = dateFromInput.value;
            const dateTo = dateToInput.value;
            const cache = buildLedgerCache();

            const filtered = state.master.filter(m => {
                const isTemp = m.code.startsWith('0000');
                if (filterTempOnly && !isTemp) return false;
                const sub = m.subCategory || determineSubCategory(m);
                if (selectedSubCategory !== 'ALL' && sub !== selectedSubCategory) return false;
                const matchesCat = !catSelect.value || m.category === catSelect.value;
                const matchesPartner = !partnerSelect.value || m.supplier === partnerSelect.value;
                const matchesQ = !searchInput.value.trim() || matchesQuery(m, searchInput.value.trim(), ['code', 'name', 'spec', 'supplier', 'category', 'subCategory']);
                return matchesCat && matchesPartner && matchesQ;
            });

            if (filtered.length === 0) {
                showToast('⚠️ 인쇄할 수불 내역이 없습니다.');
                return;
            }

            let sumBStock = 0;
            let sumIn = 0;
            let sumOut = 0;
            let sumCurrent = 0;
            let rowIdx = 1;

            const tableRowsHtml = filtered.map(m => {
                const { beginning, inQty, outQty, ending } = calculateItemLedger(m, dateFrom, dateTo, cache);
                sumBStock += beginning;
                sumIn += inQty;
                sumOut += outQty;
                sumCurrent += ending;

                const safety = Number(m.safety) || 0;
                const isShort = ending <= safety;
                const sub = m.subCategory || determineSubCategory(m);

                return `
                <tr>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${rowIdx++}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; font-family:monospace; font-weight:bold;">${m.code}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px;">${m.category}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; font-weight:bold;">${sub}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; font-weight:bold;">${m.name}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; color:#475569;">${m.spec || '-'}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px;">${m.supplier || '-'}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center;">${m.unit || 'EA'}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right;">${beginning.toLocaleString()}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right; font-weight:bold; color:#1d4ed8;">+${inQty.toLocaleString()}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right; font-weight:bold; color:#b91c1c;">-${outQty.toLocaleString()}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right; font-weight:bold; background-color:#f8fafc;">${ending.toLocaleString()}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right; color:#64748b;">${safety.toLocaleString()}</td>
                    <td style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center; font-weight:bold; color:${isShort ? '#b91c1c' : '#047857'};">${isShort ? '부족' : '정상'}</td>
                </tr>
                `;
            }).join('');

            let printContainer = document.getElementById('ledger-print-report-container');
            if (!printContainer) {
                printContainer = document.createElement('div');
                printContainer.id = 'ledger-print-report-container';
                printContainer.className = 'printable-area';
                document.body.appendChild(printContainer);
            }

            const nowStr = new Date().toLocaleString('ko-KR');
            const periodStr = `${dateFrom || '최초'} ~ ${dateTo || '현재'}`;

            printContainer.innerHTML = `
                <div style="font-family:'Noto Sans KR', sans-serif; color:#0f172a; padding:15px; width:100%; box-sizing:border-box;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:15px; border-bottom:2px solid #0f172a; padding-bottom:10px;">
                        <div>
                            <h1 style="font-size:20px; font-weight:900; margin:0 0 5px 0; letter-spacing:-0.5px;">자재 수불 원장 (Material Inventory Ledger)</h1>
                            <div style="font-size:11px; color:#475569; display:flex; gap:12px;">
                                <span><strong>회사명:</strong> (주)대림오일</span>
                                <span><strong>집계 기간:</strong> ${periodStr}</span>
                                <span><strong>출력 일시:</strong> ${nowStr}</span>
                                <span><strong>대상 품목수:</strong> ${filtered.length.toLocaleString()}건</span>
                            </div>
                        </div>
                        <table style="border-collapse:collapse; text-align:center; font-size:10px; width:180px;">
                            <tr>
                                <td rowspan="2" style="border:1px solid #64748b; background:#f1f5f9; width:20px; font-weight:bold; vertical-align:middle;">결<br>재</td>
                                <td style="border:1px solid #64748b; background:#f8fafc; padding:2px; font-weight:bold;">담당</td>
                                <td style="border:1px solid #64748b; background:#f8fafc; padding:2px; font-weight:bold;">팀장</td>
                                <td style="border:1px solid #64748b; background:#f8fafc; padding:2px; font-weight:bold;">대표</td>
                            </tr>
                            <tr style="height:35px;">
                                <td style="border:1px solid #64748b;"></td>
                                <td style="border:1px solid #64748b;"></td>
                                <td style="border:1px solid #64748b;"></td>
                            </tr>
                        </table>
                    </div>

                    <div style="display:flex; justify-content:space-between; background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:6px 12px; font-size:11px; margin-bottom:12px; font-weight:bold;">
                        <span>기초재고 합계: <strong>${sumBStock.toLocaleString()}</strong></span>
                        <span style="color:#1d4ed8;">총 입고량 합계(+): <strong>${sumIn.toLocaleString()}</strong></span>
                        <span style="color:#b91c1c;">총 출고량 합계(-): <strong>${sumOut.toLocaleString()}</strong></span>
                        <span style="color:#047857; font-size:12px;">기말 현재고 총합: <strong>${sumCurrent.toLocaleString()}</strong></span>
                    </div>

                    <table style="width:100%; border-collapse:collapse; font-size:10px; text-align:left;">
                        <thead>
                            <tr style="background:#e2e8f0; font-weight:bold; border-top:1px solid #94a3b8; border-bottom:1px solid #94a3b8;">
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center; width:30px;">No</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; width:70px;">품목코드</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; width:50px;">분류</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; width:55px;">상세종류</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px;">품목명</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; width:80px;">규격/사양</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; width:70px;">주요거래처</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center; width:35px;">단위</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right; width:65px;">기초(이월)</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right; width:65px;">총입고(+)</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right; width:65px;">총출고(-)</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right; width:70px; background:#f1f5f9;">기말현재고</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; text-align:right; width:50px;">안전재고</th>
                                <th style="border:1px solid #cbd5e1; padding:4px 6px; text-align:center; width:45px;">상태</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRowsHtml}
                            <tr style="background:#f1f5f9; font-weight:bold; border-top:2px solid #64748b;">
                                <td colspan="8" style="border:1px solid #cbd5e1; padding:6px; text-align:center;">총 ${filtered.length.toLocaleString()}개 품목 합계</td>
                                <td style="border:1px solid #cbd5e1; padding:6px; text-align:right;">${sumBStock.toLocaleString()}</td>
                                <td style="border:1px solid #cbd5e1; padding:6px; text-align:right; color:#1d4ed8;">+${sumIn.toLocaleString()}</td>
                                <td style="border:1px solid #cbd5e1; padding:6px; text-align:right; color:#b91c1c;">-${sumOut.toLocaleString()}</td>
                                <td style="border:1px solid #cbd5e1; padding:6px; text-align:right; color:#047857; font-size:11px;">${sumCurrent.toLocaleString()}</td>
                                <td colspan="2" style="border:1px solid #cbd5e1; padding:6px; text-align:center;">-</td>
                            </tr>
                        </tbody>
                    </table>

                    <div style="margin-top:15px; text-align:right; font-size:10px; color:#64748b;">
                        (주)대림오일 스마트 WMS 수불관리 시스템 | 출력 담당자: ${state.currentGlobalWorker || '시스템관리자'}
                    </div>
                </div>
            `;

            showToast('🖨️ 수불부 인쇄 창을 호출합니다. (A4 가로 설정 권장)');
            setTimeout(() => {
                window.print();
                setTimeout(() => {
                    if (printContainer && printContainer.parentNode) {
                        printContainer.parentNode.removeChild(printContainer);
                    }
                }, 2000);
            }, 300);
        });

        // 수불부 정밀 엑셀 다운로드 (초고속 Map 캐시 엔진 적용)
        btnExcel?.addEventListener('click', () => {
            const dateFrom = dateFromInput.value;
            const dateTo = dateToInput.value;
            const cache = buildLedgerCache();
            let rowNo = 1;
            let sumBStock = 0;
            let sumIn = 0;
            let sumOut = 0;
            let sumCurrent = 0;

            const rows = state.master.map(m => {
                const { beginning, inQty, outQty, ending } = calculateItemLedger(m, dateFrom, dateTo, cache);

                sumBStock += beginning;
                sumIn += inQty;
                sumOut += outQty;
                sumCurrent += ending;

                const safety = Number(m.safety) || 0;
                const status = ending <= safety ? '안전재고 미달(부족)' : '정상 보관';
                const sub = m.subCategory || determineSubCategory(m);

                return {
                    "No": rowNo++,
                    "품목코드": m.code,
                    "자재분류": m.category,
                    "상세종류(소분류)": sub,
                    "품목명": m.name,
                    "규격사양": m.spec || '-',
                    "주요거래처": m.supplier || '-',
                    "단위": m.unit || 'EA',
                    "기초(이월)재고": beginning,
                    "기간총입고(+)": inQty,
                    "기간총출고(-)": outQty,
                    "기말현재고잔량": ending,
                    "기준안전재고": safety,
                    "수불상태": status
                };
            });

            rows.push({
                "No": "합계",
                "품목코드": `총 ${state.master.length}개 품목`,
                "자재분류": "-",
                "상세종류(소분류)": "-",
                "품목명": `집계 기간: ${dateFrom || '최초'} ~ ${dateTo || '현재'} 누계`,
                "규격사양": "-",
                "주요거래처": "-",
                "단위": "-",
                "기초(이월)재고": sumBStock,
                "기간총입고(+)": sumIn,
                "기간총출고(-)": sumOut,
                "기말현재고잔량": sumCurrent,
                "기준안전재고": "-",
                "수불상태": "-"
            });

            const ws = XLSX.utils.json_to_sheet(rows);
            ws['!cols'] = [
                { wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 30 }, { wch: 20 },
                { wch: 16 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
                { wch: 14 }, { wch: 12 }, { wch: 18 }
            ];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "자재수불부");
            const periodStr = dateFrom || dateTo ? `_${dateFrom || '시작'}~${dateTo || '현재'}` : `_${new Date().toISOString().slice(0, 10)}`;
            XLSX.writeFile(wb, `대림오일_자재수불부${periodStr}.xlsx`);
            showToast('📥 자재 수불부 정밀 엑셀 파일이 다운로드되었습니다.');
        });
    };

    // ==========================================
    // 2. 월간 캘린더 & 일정관리 (Calendar & Schedule) 로직
    // ==========================================
    const setupCalendar = () => {
        const titleEl = container.querySelector('#cal-month-title');
        const grid = container.querySelector('#calendar-days-grid');
        const modalDay = container.querySelector('#cal-day-detail-modal');
        const modalDayTitle = container.querySelector('#cal-day-modal-title');
        const modalDayContent = container.querySelector('#cal-day-modal-content');
        const btnCloseDay = container.querySelector('#btn-close-day-modal');

        const modalSched = container.querySelector('#modal-schedule-create');
        const btnOpenSched = container.querySelector('#btn-open-schedule-create');
        const btnAddSchedBottom = container.querySelector('#btn-add-schedule-bottom');
        const btnCloseSched = container.querySelector('#btn-close-sched-modal');
        const btnCancelSched = container.querySelector('#btn-cancel-sched');
        const formSched = container.querySelector('#form-schedule-create');
        const schedItemInput = container.querySelector('#sched-input-item');
        const schedItemSuggestions = container.querySelector('#sched-item-suggestions');

        btnCloseDay?.addEventListener('click', () => modalDay?.classList.add('hidden'));

        // 일정 등록 모달 열기/닫기
        const openScheduleModal = (targetDate) => {
            const dateInput = container.querySelector('#sched-input-date');
            dateInput.value = targetDate || new Date().toISOString().slice(0, 10);
            container.querySelector('#sched-input-title').value = '';
            schedItemInput.value = '';
            container.querySelector('#sched-input-notes').value = '';
            schedItemSuggestions.classList.add('hidden');
            modalSched.classList.remove('hidden');
        };

        btnOpenSched?.addEventListener('click', () => openScheduleModal());
        btnAddSchedBottom?.addEventListener('click', () => openScheduleModal());
        btnCloseSched?.addEventListener('click', () => modalSched?.classList.add('hidden'));
        btnCancelSched?.addEventListener('click', () => modalSched?.classList.add('hidden'));

        // 연계 품목 자동완성
        schedItemInput?.addEventListener('input', (e) => {
            const q = e.target.value.trim();
            if (!q) {
                schedItemSuggestions.classList.add('hidden');
                return;
            }
            const matches = searchMasterItems(q, 6);
            if (matches.length === 0) {
                schedItemSuggestions.innerHTML = '<div class="p-2 text-center text-slate-400">일치하는 품목 없음</div>';
            } else {
                schedItemSuggestions.innerHTML = matches.map(m => `
                    <div class="p-2 hover:bg-indigo-50 cursor-pointer sched-suggest-pick" data-code="${m.code}" data-name="${m.name}">
                        <div class="font-bold text-slate-900">[${m.code}] ${m.name}</div>
                        <div class="text-[10px] text-slate-400">${m.spec || '-'}</div>
                    </div>
                `).join('');
                schedItemSuggestions.querySelectorAll('.sched-suggest-pick').forEach(item => {
                    item.addEventListener('click', () => {
                        const code = item.getAttribute('data-code');
                        const name = item.getAttribute('data-name');
                        schedItemInput.value = `[${code}] ${name}`;
                        schedItemInput.setAttribute('data-code', code);
                        schedItemInput.setAttribute('data-name', name);
                        schedItemSuggestions.classList.add('hidden');
                    });
                });
            }
            schedItemSuggestions.classList.remove('hidden');
        });

        // 일정 폼 제출
        formSched?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const date = container.querySelector('#sched-input-date').value;
            const type = container.querySelector('#sched-input-type').value;
            const title = container.querySelector('#sched-input-title').value.trim();
            const partner = container.querySelector('#sched-input-partner').value;
            const worker = container.querySelector('#sched-input-worker').value;
            const notes = container.querySelector('#sched-input-notes').value.trim();
            const itemCode = schedItemInput.getAttribute('data-code') || '';
            const itemName = schedItemInput.getAttribute('data-name') || schedItemInput.value.trim();

            if (!date || !title) {
                alert('일자 및 제목을 입력해주세요.');
                return;
            }

            const newSched = {
                id: `SCHED-${Date.now()}`,
                date,
                type,
                title,
                itemCode,
                itemName,
                partner,
                worker,
                notes,
                status: 'TODO'
            };

            await saveSchedule(newSched);
            modalSched.classList.add('hidden');
            showToast(`📅 [${date}] '${title}' 일정이 등록되었습니다.`);
            renderDays();
            renderUpcomingSchedules();
        });

        // 일정 필터 버튼
        container.querySelectorAll('.btn-sched-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                scheduleFilterType = btn.getAttribute('data-type');
                container.querySelectorAll('.btn-sched-filter').forEach(b => {
                    b.classList.remove('bg-indigo-600', 'text-white', 'shadow-2xs');
                    b.classList.add('bg-white', 'text-slate-700');
                });
                btn.classList.remove('bg-white', 'text-slate-700');
                btn.classList.add('bg-indigo-600', 'text-white', 'shadow-2xs');
                renderDays();
            });
        });

        const typeBadgeMap = {
            IN_PLAN: { label: '입고예정', color: 'bg-blue-100 text-blue-800 border-blue-200' },
            OUT_PLAN: { label: '출고예정', color: 'bg-rose-100 text-rose-800 border-rose-200' },
            AUDIT: { label: '재고실사', color: 'bg-amber-100 text-amber-800 border-amber-200' },
            MAINTENANCE: { label: '설비점검', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
            ORDER_DEADLINE: { label: '발주마감', color: 'bg-purple-100 text-purple-800 border-purple-200' },
            TRAINING: { label: '안전교육', color: 'bg-sky-100 text-sky-800 border-sky-200' },
            OTHER: { label: '일반일정', color: 'bg-slate-100 text-slate-800 border-slate-200' }
        };

        // 월간 캘린더 그리드 렌더링
        const renderDays = () => {
            const year = currentCalendarDate.getFullYear();
            const month = currentCalendarDate.getMonth();
            titleEl.textContent = `${year}년 ${month + 1}월`;

            const today = new Date();
            const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            let cells = '';
            for (let i = 0; i < firstDay; i++) {
                cells += `<div class="bg-slate-50/50 rounded-xl p-3 min-h-[105px] border border-transparent"></div>`;
            }

            for (let d = 1; d <= daysInMonth; d++) {
                const isToday = isCurrentMonth && d === today.getDate();
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                
                // 날짜별 이력 조회
                const dayLogs = state.history.filter(h => h.timestamp && h.timestamp.includes(dateStr));
                const inCount = dayLogs.filter(h => h.type === 'IN').length;
                const outCount = dayLogs.filter(h => h.type === 'OUT' || h.type === 'USE').length;

                // 날짜별 일정 조회 (필터 반영)
                const daySchedules = state.schedules.filter(s => {
                    if (s.date !== dateStr) return false;
                    if (scheduleFilterType === 'ALL') return true;
                    if (scheduleFilterType === 'TODO_ONLY') return s.status !== 'DONE';
                    return s.type === scheduleFilterType;
                });

                cells += `
                <div class="cal-day-card bg-white border ${isToday ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-slate-200'} rounded-xl p-2 min-h-[105px] flex flex-col justify-between hover:shadow-md hover:border-indigo-400 transition cursor-pointer" data-date="${dateStr}">
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-xs ${isToday ? 'text-indigo-600 font-black' : 'text-slate-700'}">${d}</span>
                        ${isToday ? '<span class="px-1.5 py-0.2 bg-indigo-600 text-white rounded text-[9px] font-bold">오늘</span>' : ''}
                    </div>

                    <!-- 등록된 일정 배지 목록 -->
                    <div class="space-y-1 my-1 flex-1 overflow-hidden">
                        ${daySchedules.slice(0, 2).map(s => {
                            const badge = typeBadgeMap[s.type] || typeBadgeMap.OTHER;
                            const isDone = s.status === 'DONE';
                            return `
                            <div class="px-1.5 py-0.5 rounded text-[9px] font-bold border truncate ${badge.color} ${isDone ? 'line-through opacity-50' : ''}" title="${s.title}">
                                ${isDone ? '✓ ' : ''}[${badge.label}] ${s.title}
                            </div>
                            `;
                        }).join('')}
                        ${daySchedules.length > 2 ? `<div class="text-[9px] text-indigo-600 font-bold px-1">+${daySchedules.length - 2}건 더보기</div>` : ''}

                        <!-- 수불 실적 카운트 -->
                        ${inCount > 0 ? `<div class="text-[9px] font-bold text-blue-700 bg-blue-50/80 rounded px-1 truncate">입고 ${inCount}건</div>` : ''}
                        ${outCount > 0 ? `<div class="text-[9px] font-bold text-rose-700 bg-rose-50/80 rounded px-1 truncate">출고 ${outCount}건</div>` : ''}

                        <!-- 김포공장 생산공급망 일지 배지 -->
                        ${(() => {
                            const gLog = state.gimpoLogs?.find(l => l.date === dateStr || l.sheetName === dateStr.replace(/-/g, '').slice(-4));
                            if (!gLog) return '';
                            const pCount = (gLog.packaging || []).length;
                            const oCount = (gLog.oilBlending || []).length;
                            const mCount = (gLog.movement || []).length;
                            if (pCount === 0 && oCount === 0 && mCount === 0) return '';
                            return `<div class="text-[9px] font-bold text-sky-800 bg-sky-50 border border-sky-200 rounded px-1 truncate">🏭 김포일지: 포장${pCount}·원액${oCount}</div>`;
                        })()}
                    </div>

                    <div class="flex justify-between items-center text-[9px] text-slate-400 font-mono pt-1 border-t border-slate-100">
                        <span>${daySchedules.length > 0 ? `일정 ${daySchedules.length}` : ''}</span>
                        <span>${(() => {
                            const gLog = state.gimpoLogs?.find(l => l.date === dateStr || l.sheetName === dateStr.replace(/-/g, '').slice(-4));
                            return gLog ? '🏭공장일지' : (dayLogs.length > 0 ? `실적 ${dayLogs.length}` : '-');
                        })()}</span>
                    </div>
                </div>
                `;
            }

            grid.innerHTML = cells;

            grid.querySelectorAll('.cal-day-card').forEach(card => {
                card.addEventListener('click', () => {
                    const dateStr = card.getAttribute('data-date');
                    openDayDetailModal(dateStr);
                });
            });
        };

        // 일자별 상세 모달 열기
        const openDayDetailModal = (dateStr) => {
            const daySchedules = state.schedules.filter(s => s.date === dateStr);
            const dayLogs = state.history.filter(h => h.timestamp && h.timestamp.includes(dateStr));
            modalDayTitle.textContent = `${dateStr} 일정 & 현장 작업 상세`;

            let html = `
            <div class="space-y-4">
                <!-- 1. 일정 관리 영역 -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                            <i data-lucide="calendar" class="w-4 h-4 text-indigo-600"></i>
                            <span>등록된 일정 (${daySchedules.length}건)</span>
                        </span>
                        <button type="button" class="btn-add-day-sched text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1" data-date="${dateStr}">
                            <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                            <span>이 날짜에 새 일정 등록</span>
                        </button>
                    </div>

                    ${daySchedules.length === 0 ? `
                        <div class="p-3 bg-slate-50 rounded-xl text-center text-slate-400 text-xs border border-dashed border-slate-200">
                            등록된 일정이 없습니다. 위 버튼을 눌러 일정을 추가하세요.
                        </div>
                    ` : `
                        <div class="space-y-2">
                            ${daySchedules.map(s => {
                                const badge = typeBadgeMap[s.type] || typeBadgeMap.OTHER;
                                const isDone = s.status === 'DONE';
                                return `
                                <div class="p-3 rounded-xl border flex items-start justify-between gap-3 ${isDone ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-indigo-100 shadow-2xs'}">
                                    <div class="flex items-start gap-2.5">
                                        <input type="checkbox" class="chk-toggle-sched mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer" data-id="${s.id}" ${isDone ? 'checked' : ''} />
                                        <div>
                                            <div class="flex items-center gap-1.5 flex-wrap">
                                                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ${badge.color}">${badge.label}</span>
                                                <span class="font-bold text-slate-900 ${isDone ? 'line-through text-slate-500' : ''}">${s.title}</span>
                                            </div>
                                            <div class="text-[11px] text-slate-500 mt-1">
                                                ${s.itemName ? `품목: <b>${s.itemName}</b> | ` : ''}
                                                ${s.partner ? `거래처: <b>${s.partner}</b> | ` : ''}
                                                담당: <b>${s.worker || '-'}</b>
                                            </div>
                                            ${s.notes ? `<div class="text-[11px] text-slate-600 bg-slate-100/80 rounded px-2 py-1 mt-1">${s.notes}</div>` : ''}
                                        </div>
                                    </div>
                                    <button type="button" class="btn-del-sched text-slate-400 hover:text-rose-600 p-1" data-id="${s.id}" title="일정 삭제">
                                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                                    </button>
                                </div>
                                `;
                            }).join('')}
                        </div>
                    `}
                </div>

                <!-- 2. 입출고 작업 실적 내역 -->
                <div class="space-y-2 pt-2 border-t border-slate-100">
                    <span class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                        <i data-lucide="clock" class="w-4 h-4 text-blue-600"></i>
                        <span>현장 작업 실적 로그 (${dayLogs.length}건)</span>
                    </span>

                    ${dayLogs.length === 0 ? `
                        <div class="p-3 bg-slate-50 rounded-xl text-center text-slate-400 text-xs border border-dashed border-slate-200">
                            기록된 현장 작업 내역이 없습니다.
                        </div>
                    ` : `
                        <div class="space-y-1.5 max-h-48 overflow-y-auto">
                            ${dayLogs.map(l => {
                                const logTypeKo = { IN: '입고', OUT: '출고', USE: '생산투입', MOVE: '거점이동', AUDIT: '재고실사' }[l.type] || l.type;
                                return `
                            <div class="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                                <div>
                                    <div class="flex items-center gap-1.5">
                                        <span class="px-1.5 py-0.5 rounded text-[10px] font-black ${
                                            l.type === 'IN' ? 'bg-blue-100 text-blue-800' :
                                            l.type === 'OUT' || l.type === 'USE' ? 'bg-rose-100 text-rose-800' : 'bg-purple-100 text-purple-800'
                                        }">${logTypeKo}</span>
                                        <span class="font-bold text-slate-900">${l.name}</span>
                                        <span class="font-mono text-[10px] text-slate-500">${l.code}</span>
                                    </div>
                                    <div class="text-[11px] text-slate-500 mt-0.5">
                                        작업자: <b>${l.worker || '-'}</b> | 거점: ${l.fromLoc} &rarr; ${l.toLoc}
                                    </div>
                                </div>
                                <span class="font-black text-sm text-slate-900">${Number(l.qty).toLocaleString()}개</span>
                            </div>
                            `;
                            }).join('')}
                        </div>
                    `}
                </div>

                <!-- 3. 김포공장 생산공급망 일지 연동 카드 -->
                ${(() => {
                    const gLog = state.gimpoLogs?.find(l => l.date === dateStr || l.sheetName === dateStr.replace(/-/g, '').slice(-4));
                    if (!gLog) return '';
                    const packQty = (gLog.packaging || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
                    const oilQty = (gLog.oilBlending || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
                    const moveQty = (gLog.movement || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
                    return `
                    <div class="space-y-2 pt-2 border-t border-slate-100">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                                <i data-lucide="factory" class="w-4 h-4 text-blue-600"></i>
                                <span>김포공장 생산공급망 일지 실적</span>
                            </span>
                            <button type="button" class="btn-goto-gimpo-log px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold transition flex items-center gap-1" data-date="${gLog.date}">
                                <span>공장 일지 상세 보기 &rarr;</span>
                            </button>
                        </div>
                        <div class="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
                            <div>
                                <span class="text-[10px] text-slate-400 font-bold block">제품포장</span>
                                <span class="font-mono font-black text-blue-600">${packQty.toLocaleString()}EA</span>
                            </div>
                            <div>
                                <span class="text-[10px] text-slate-400 font-bold block">원액생산</span>
                                <span class="font-mono font-black text-sky-600">${oilQty.toLocaleString()}L</span>
                            </div>
                            <div>
                                <span class="text-[10px] text-slate-400 font-bold block">거점이동</span>
                                <span class="font-mono font-black text-amber-600">${moveQty.toLocaleString()}EA</span>
                            </div>
                        </div>
                    </div>
                    `;
                })()}
            </div>
            `;

            modalDayContent.innerHTML = html;

            // 모달 내 이벤트 바인딩
            modalDayContent.querySelector('.btn-add-day-sched')?.addEventListener('click', (e) => {
                const dt = e.currentTarget.getAttribute('data-date');
                modalDay.classList.add('hidden');
                openScheduleModal(dt);
            });

            modalDayContent.querySelector('.btn-goto-gimpo-log')?.addEventListener('click', (e) => {
                modalDay.classList.add('hidden');
                if (window.__switchTab) {
                    window.__switchTab('gimpoLog');
                }
            });

            modalDayContent.querySelectorAll('.chk-toggle-sched').forEach(chk => {
                chk.addEventListener('change', async () => {
                    const id = chk.getAttribute('data-id');
                    await toggleScheduleStatus(id);
                    renderDays();
                    renderUpcomingSchedules();
                    openDayDetailModal(dateStr);
                });
            });

            modalDayContent.querySelectorAll('.btn-del-sched').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.getAttribute('data-id');
                    if (confirm('이 일정을 삭제하시겠습니까?')) {
                        await deleteSchedule(id);
                        showToast('🗑️ 일정이 삭제되었습니다.');
                        renderDays();
                        renderUpcomingSchedules();
                        openDayDetailModal(dateStr);
                    }
                });
            });

            createIcons({ icons });
            modalDay.classList.remove('hidden');
        };

        // 다가오는 일정 목록 렌더링
        const renderUpcomingSchedules = () => {
            const listEl = container.querySelector('#upcoming-schedules-list');
            if (!listEl) return;

            const todayStr = new Date().toISOString().slice(0, 10);
            const sorted = [...state.schedules].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            const upcoming = sorted.slice(0, 6);

            if (upcoming.length === 0) {
                listEl.innerHTML = '<div class="col-span-3 p-6 text-center text-slate-400 text-xs">등록된 일정이 없습니다. [+ 신규 일정 등록] 버튼을 눌러 일정을 생성하세요.</div>';
                return;
            }

            listEl.innerHTML = upcoming.map(s => {
                const badge = typeBadgeMap[s.type] || typeBadgeMap.OTHER;
                const isDone = s.status === 'DONE';
                let dDayStr = '';
                if (s.date === todayStr) {
                    dDayStr = '<span class="px-1.5 py-0.2 rounded text-[10px] font-black bg-rose-500 text-white">당일 (오늘)</span>';
                } else if (s.date > todayStr) {
                    const diffDays = Math.ceil((new Date(s.date) - new Date(todayStr)) / (1000 * 60 * 60 * 24));
                    dDayStr = `<span class="px-1.5 py-0.2 rounded text-[10px] font-black bg-indigo-100 text-indigo-700">${diffDays}일 전 (D-${diffDays})</span>`;
                } else {
                    dDayStr = `<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-200 text-slate-600">기한 경과</span>`;
                }

                return `
                <div class="bg-slate-50 hover:bg-white p-3 rounded-xl border border-slate-200 hover:border-indigo-300 transition shadow-2xs space-y-2 ${isDone ? 'opacity-60' : ''}">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-1.5">
                            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ${badge.color}">${badge.label}</span>
                            ${dDayStr}
                        </div>
                        <span class="font-mono font-bold text-xs text-slate-600">${s.date}</span>
                    </div>
                    <div class="font-bold text-slate-900 text-xs truncate ${isDone ? 'line-through text-slate-500' : ''}" title="${s.title}">${s.title}</div>
                    <div class="text-[11px] text-slate-500 truncate">
                        ${s.itemName ? `품목: ${s.itemName} | ` : ''}담당: ${s.worker || '-'}
                    </div>
                    <div class="flex justify-between items-center pt-1.5 border-t border-slate-200/60">
                        <button type="button" class="btn-upcoming-toggle text-[11px] font-bold ${isDone ? 'text-slate-500' : 'text-indigo-600 hover:underline'}" data-id="${s.id}">
                            ${isDone ? '다시 진행' : '✓ 완료 처리'}
                        </button>
                        <button type="button" class="btn-upcoming-del text-slate-400 hover:text-rose-600" data-id="${s.id}">
                            <i data-lucide="trash" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </div>
                `;
            }).join('');

            listEl.querySelectorAll('.btn-upcoming-toggle').forEach(b => {
                b.addEventListener('click', async () => {
                    const id = b.getAttribute('data-id');
                    await toggleScheduleStatus(id);
                    renderDays();
                    renderUpcomingSchedules();
                });
            });

            listEl.querySelectorAll('.btn-upcoming-del').forEach(b => {
                b.addEventListener('click', async () => {
                    const id = b.getAttribute('data-id');
                    if (confirm('이 일정을 삭제하시겠습니까?')) {
                        await deleteSchedule(id);
                        showToast('🗑️ 일정이 삭제되었습니다.');
                        renderDays();
                        renderUpcomingSchedules();
                    }
                });
            });

            createIcons({ icons });
        };

        container.querySelector('#btn-cal-prev')?.addEventListener('click', () => {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
            renderDays();
        });
        container.querySelector('#btn-cal-next')?.addEventListener('click', () => {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
            renderDays();
        });
        container.querySelector('#btn-cal-today')?.addEventListener('click', () => {
            currentCalendarDate = new Date();
            renderDays();
        });

        renderDays();
        renderUpcomingSchedules();
    };

    render();
};
