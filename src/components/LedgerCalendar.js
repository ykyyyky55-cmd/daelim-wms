import { state, saveSchedule, deleteSchedule, toggleScheduleStatus } from '../services/db.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';
import { openModalByName } from './Modals.js';
import { matchesQuery, searchMasterItems } from '../services/searchUtils.js';

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
                    <div class="flex items-center gap-2">
                        <button type="button" id="btn-open-bstock-modal" class="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                            <i data-lucide="archive" class="w-4 h-4"></i>
                            <span>기초/이월재고 설정</span>
                        </button>
                        <button type="button" id="btn-export-ledger-excel" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                            <i data-lucide="download" class="w-4 h-4"></i>
                            <span>수불부 정밀 엑셀 다운로드</span>
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

                    <!-- 분류 및 검색 바 -->
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
                                <span>임시코드(0000) 수불 모아보기</span>
                                <span id="badge-ledger-temp-count" class="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-amber-800 font-black">0</span>
                            </button>
                        </div>

                        <div class="relative">
                            <input type="text" id="ledger-search-input" placeholder="품목코드, 품명, 규격, 거래처 검색 (일부문자 인식)..." class="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none w-72" />
                            <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2"></i>
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
                                    <th class="p-3">분류</th>
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
        const dateFromInput = container.querySelector('#ledger-date-from');
        const dateToInput = container.querySelector('#ledger-date-to');
        const tbody = container.querySelector('#ledger-table-body');
        const btnBStock = container.querySelector('#btn-open-bstock-modal');
        const btnExcel = container.querySelector('#btn-export-ledger-excel');
        const btnFilterTemp = container.querySelector('#btn-ledger-filter-temp');
        let filterTempOnly = false;

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
            renderLedgerRows();
        };

        container.querySelectorAll('.btn-ledger-quick-date').forEach(btn => {
            btn.addEventListener('click', () => setLedgerPeriod(btn.getAttribute('data-range')));
        });

        container.querySelector('#btn-ledger-date-apply')?.addEventListener('click', renderLedgerRows);

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

        // 개별 품목의 기간 수불 정밀 계산 엔진
        const calculateItemLedger = (m, dateFrom, dateTo) => {
            const hasExplicitBStock = (state.beginningStock && state.beginningStock[m.code] !== undefined) || (m.beginningStock !== undefined);
            
            let baseBStock = 0;
            if (hasExplicitBStock) {
                baseBStock = (state.beginningStock && state.beginningStock[m.code] !== undefined)
                    ? Number(state.beginningStock[m.code])
                    : Number(m.beginningStock);
            } else {
                // 기초재고 미설정 품목: 현재 창고 실재고 합산에서 전체 누적 이력을 역산하여 정확한 기초재고 산출
                const totalInv = (state.inventory || [])
                    .filter(i => i.code === m.code)
                    .reduce((sum, cur) => sum + (Number(cur.quantity) || 0), 0);
                
                const allItemLogs = state.history.filter(h => h.code === m.code);
                let allIn = 0;
                let allOut = 0;
                for (const h of allItemLogs) {
                    const q = Number(h.qty) || 0;
                    if (h.type === 'IN') allIn += q;
                    else if (h.type === 'OUT' || h.type === 'USE') allOut += q;
                }
                baseBStock = Math.max(0, totalInv - allIn + allOut);
            }

            const logs = state.history.filter(h => h.code === m.code);

            let priorIn = 0;
            let priorOut = 0;
            let periodIn = 0;
            let periodOut = 0;

            for (const l of logs) {
                const qty = Number(l.qty) || 0;
                let dStr = '';
                const match = (l.timestamp || '').match(/(\d{4})[-\.\/](\d{1,2})[-\.\/](\d{1,2})/);
                if (match) {
                    dStr = `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
                }

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

        const renderLedgerRows = () => {
            const cat = catSelect.value;
            const partner = partnerSelect.value;
            const q = searchInput.value.trim();
            const dateFrom = dateFromInput.value;
            const dateTo = dateToInput.value;

            let totalIn = 0;
            let totalOut = 0;
            let totalStock = 0;

            const filtered = state.master.filter(m => {
                const isTemp = m.code.startsWith('0000');
                if (filterTempOnly && !isTemp) return false;
                const matchesCat = !cat || m.category === cat;
                const matchesPartner = !partner || m.supplier === partner;
                const matchesQ = !q || matchesQuery(m, q, ['code', 'name', 'spec', 'supplier', 'category']);
                return matchesCat && matchesPartner && matchesQ;
            });

            updateLedgerTempBadge();
            container.querySelector('#stat-ledger-items').textContent = `${filtered.length.toLocaleString()}개`;

            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-slate-400 text-xs">일치하는 수불 내역이 없습니다. (검색 조건 또는 기간을 확인하세요)</td></tr>';
                container.querySelector('#stat-ledger-in').textContent = '0';
                container.querySelector('#stat-ledger-out').textContent = '0';
                container.querySelector('#stat-ledger-stock').textContent = '0';
                return;
            }

            tbody.innerHTML = filtered.map(m => {
                const { beginning, inQty, outQty, ending } = calculateItemLedger(m, dateFrom, dateTo);

                totalIn += inQty;
                totalOut += outQty;
                totalStock += ending;

                const safety = Number(m.safety) || 0;
                const isShort = ending <= safety;
                const isTemp = m.code.startsWith('0000');

                return `
                <tr class="hover:bg-slate-50 transition ${isTemp ? 'bg-amber-50/30' : ''}">
                    <td class="p-3">
                        ${isTemp ? `
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-black bg-amber-100 text-amber-800 border border-amber-300">
                                <i data-lucide="alert-triangle" class="w-3 h-3 text-amber-600"></i>
                                ${m.code} <span class="text-[9px] bg-amber-500 text-white px-1 rounded">임시</span>
                            </span>
                        ` : `
                            <span class="font-mono font-bold text-blue-600">${m.code}</span>
                        `}
                    </td>
                    <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isTemp ? 'bg-amber-200 text-amber-900' : 'bg-slate-100 text-slate-700'}">${m.category}</span></td>
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

            container.querySelector('#stat-ledger-in').textContent = `+${totalIn.toLocaleString()}`;
            container.querySelector('#stat-ledger-out').textContent = `-${totalOut.toLocaleString()}`;
            container.querySelector('#stat-ledger-stock').textContent = `${totalStock.toLocaleString()}`;
            createIcons({ icons });
        };

        // 0000 임시코드 토글 버튼 이벤트
        btnFilterTemp?.addEventListener('click', () => {
            filterTempOnly = !filterTempOnly;
            if (filterTempOnly) {
                btnFilterTemp.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-amber-500 text-white border-amber-600 shadow-xs';
            } else {
                btnFilterTemp.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-white text-slate-700 border-slate-300 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300';
            }
            renderLedgerRows();
        });

        catSelect?.addEventListener('change', renderLedgerRows);
        partnerSelect?.addEventListener('change', renderLedgerRows);
        searchInput?.addEventListener('input', renderLedgerRows);
        dateFromInput?.addEventListener('change', renderLedgerRows);
        dateToInput?.addEventListener('change', renderLedgerRows);
        renderLedgerRows();

        // 수불부 정밀 엑셀 다운로드 (기간 집계 포함)
        btnExcel?.addEventListener('click', () => {
            const dateFrom = dateFromInput.value;
            const dateTo = dateToInput.value;
            let rowNo = 1;
            let sumBStock = 0;
            let sumIn = 0;
            let sumOut = 0;
            let sumCurrent = 0;

            const rows = state.master.map(m => {
                const { beginning, inQty, outQty, ending } = calculateItemLedger(m, dateFrom, dateTo);

                sumBStock += beginning;
                sumIn += inQty;
                sumOut += outQty;
                sumCurrent += ending;

                const safety = Number(m.safety) || 0;
                const status = ending <= safety ? '안전재고 미달(부족)' : '정상 보관';

                return {
                    "No": rowNo++,
                    "품목코드": m.code,
                    "자재분류": m.category,
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
                { wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 30 }, { wch: 20 },
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
