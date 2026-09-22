import { state, getGimpoLogByDate, saveGimpoLog, applyGimpoLogToInventory } from '../services/db.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';

let currentDateStr = '2026-09-22';
let currentActiveSection = 'packaging'; // packaging, labeling, oilBlending, inOut, movement, courier, otherTasks
let selectedMonthFilter = '09'; // 'ALL', '09', '08'

export const renderProductionLog = (container, { showToast }) => {
    // 사용 가능한 일자 목록
    const availableLogs = (state.gimpoLogs || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (availableLogs.length > 0 && !state.gimpoLogs.find(l => l.date === currentDateStr)) {
        currentDateStr = availableLogs[0].date;
    }

    // 월별 필터링된 일지 목록
    const filteredChips = availableLogs.filter(l => {
        if (selectedMonthFilter === 'ALL') return true;
        return l.date && l.date.includes(`-${selectedMonthFilter}-`);
    });

    const currentLog = getGimpoLogByDate(currentDateStr);

    // KPI 합계 계산
    const packQty = (currentLog.packaging || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
    const packBoxes = (currentLog.packaging || []).reduce((sum, r) => sum + (Number(r.box) || 0), 0);
    const packManHours = (currentLog.packaging || []).reduce((sum, r) => sum + (Number(r.manHours) || 0), 0);

    const labelQty = (currentLog.labeling || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
    const labelManHours = (currentLog.labeling || []).reduce((sum, r) => sum + (Number(r.manHours) || 0), 0);

    const oilQty = (currentLog.oilBlending || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
    const oilManHours = (currentLog.oilBlending || []).reduce((sum, r) => sum + (Number(r.manHours) || 0), 0);

    const moveCount = (currentLog.movement || []).length;
    const moveQty = (currentLog.movement || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);

    const otherManHours = (currentLog.otherTasks || []).reduce((sum, r) => sum + (Number(r.manHours) || 0), 0);
    const totalDayManHours = (packManHours + labelManHours + oilManHours + otherManHours).toFixed(2);

    container.innerHTML = `
    <section id="tab-content-production" class="space-y-6">
        <!-- 1. 최상단 제어 바 & 결재 라인 -->
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 no-print">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 border border-blue-200">대림오일 김포공장</span>
                        <span class="text-xs text-slate-500 font-mono">생산공급망 실시간 원장</span>
                    </div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="factory" class="w-5 h-5 text-blue-600"></i>
                        <span>김포공장 생산공급망 일일 업무일지</span>
                    </h2>
                    <p class="text-xs text-slate-500">제품포장·원액생산·라벨부착·입출고·거점이동(본사 ⇄ 김포) 실적 관리 및 WMS 재고 자동 연동</p>
                </div>

                <!-- 결재 라인 위젯 -->
                <div class="flex items-center bg-slate-50 border border-slate-200 rounded-xl p-2 gap-3">
                    <span class="text-[11px] font-bold text-slate-400 pl-1">결재라인</span>
                    <div class="flex items-center divide-x divide-slate-200 text-center text-xs">
                        <div class="px-3">
                            <span class="block text-[10px] text-slate-400 font-bold mb-0.5">담당</span>
                            <span id="log-manager-name" class="font-bold text-slate-800">${currentLog.manager || '최용화'}</span>
                        </div>
                        <div class="px-3">
                            <span class="block text-[10px] text-slate-400 font-bold mb-0.5">검토</span>
                            <span id="log-reviewer-name" class="font-bold text-slate-800">${currentLog.reviewer || '윤경용'}</span>
                        </div>
                        <div class="px-3">
                            <span class="block text-[10px] text-slate-400 font-bold mb-0.5">확인</span>
                            <span id="log-approver-name" class="font-bold text-emerald-600 cursor-pointer hover:underline" title="클릭하여 결재 상태 변경">${currentLog.approver || '승인완료'}</span>
                        </div>
                    </div>
                </div>

                <!-- 상단 액션 버튼 그룹 -->
                <div class="flex items-center flex-wrap gap-2">
                    <button type="button" id="btn-apply-to-stock" class="px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="check-check" class="w-4 h-4"></i>
                        <span>WMS 재고 및 수불부 자동 반영</span>
                    </button>
                    <button type="button" id="btn-print-gimpo-log" class="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>공식 A4 일지 인쇄</span>
                    </button>
                    <button type="button" id="btn-export-gimpo-excel" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="file-spreadsheet" class="w-4 h-4"></i>
                        <span>엑셀 다운로드</span>
                    </button>
                    <button type="button" id="btn-save-gimpo-log" class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="save" class="w-4 h-4"></i>
                        <span>일지 저장</span>
                    </button>
                </div>
            </div>

            <!-- 날짜 선택 및 8월/9월 일일 시트 칩 바 -->
            <div class="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <div class="flex items-center gap-2">
                    <label class="font-bold text-slate-700">작업 일자:</label>
                    <input type="date" id="gimpo-log-date-picker" value="${currentDateStr}" class="border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold bg-white focus:ring-2 focus:ring-blue-500" />
                    <button type="button" id="btn-new-gimpo-log" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1 border border-slate-200">
                        <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                        <span>새 일자 일지</span>
                    </button>
                </div>

                <!-- 월별 필터 버튼 -->
                <div class="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-[11px] font-bold">
                    <button type="button" class="btn-month-filter px-2.5 py-1 rounded-lg transition ${selectedMonthFilter === '09' ? 'bg-white text-blue-600 shadow-2xs font-black' : 'text-slate-600 hover:text-slate-900'}" data-month="09">9월 (16일)</button>
                    <button type="button" class="btn-month-filter px-2.5 py-1 rounded-lg transition ${selectedMonthFilter === '08' ? 'bg-white text-blue-600 shadow-2xs font-black' : 'text-slate-600 hover:text-slate-900'}" data-month="08">8월 (20일)</button>
                    <button type="button" class="btn-month-filter px-2.5 py-1 rounded-lg transition ${selectedMonthFilter === 'ALL' ? 'bg-white text-blue-600 shadow-2xs font-black' : 'text-slate-600 hover:text-slate-900'}" data-month="ALL">전체 (36일)</button>
                </div>

                <div class="flex-1 flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-thin">
                    ${filteredChips.map(l => {
                        const isCurrent = l.date === currentDateStr;
                        const label = l.date ? l.date.slice(5).replace('-', '/') : l.sheetName;
                        return `
                            <button type="button" class="btn-select-date-chip px-2 py-1 rounded-lg text-[11px] font-bold transition whitespace-nowrap ${
                                isCurrent 
                                    ? 'bg-blue-600 text-white shadow-xs' 
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                            }" data-date="${l.date}">
                                ${label}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>

        <!-- 2. 핵심 KPI 요약 카드 -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 no-print">
            <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold">
                    <span>■ 제품포장 실적</span>
                    <i data-lucide="package-check" class="w-4 h-4 text-blue-600"></i>
                </div>
                <div class="flex items-baseline gap-1 mt-2">
                    <span class="text-2xl font-black text-slate-900 font-mono">${packQty.toLocaleString()}</span>
                    <span class="text-xs text-slate-500 font-bold">EA (${packBoxes}BOX)</span>
                </div>
                <div class="text-[11px] text-blue-700 font-bold mt-1">포장 작업공수: ${packManHours.toFixed(2)}공수</div>
            </div>

            <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold">
                    <span>■ 원액생산(블렌딩)</span>
                    <i data-lucide="flask-conical" class="w-4 h-4 text-sky-600"></i>
                </div>
                <div class="flex items-baseline gap-1 mt-2">
                    <span class="text-2xl font-black text-slate-900 font-mono">${oilQty.toLocaleString()}</span>
                    <span class="text-xs text-slate-500 font-bold">L</span>
                </div>
                <div class="text-[11px] text-sky-700 font-bold mt-1">블렌딩 공수: ${oilManHours.toFixed(2)}공수</div>
            </div>

            <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold">
                    <span>■ 이동제품 (김포 ⇄ 본사)</span>
                    <i data-lucide="truck" class="w-4 h-4 text-amber-600"></i>
                </div>
                <div class="flex items-baseline gap-1 mt-2">
                    <span class="text-2xl font-black text-slate-900 font-mono">${moveCount}</span>
                    <span class="text-xs text-slate-500 font-bold">개 품목 (${moveQty.toLocaleString()}EA)</span>
                </div>
                <div class="text-[11px] text-amber-700 font-bold mt-1">3.5T 정기 셔틀 이동</div>
            </div>

            <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold">
                    <span>■ 일일 총 투입공수</span>
                    <i data-lucide="users" class="w-4 h-4 text-purple-600"></i>
                </div>
                <div class="flex items-baseline gap-1 mt-2">
                    <span class="text-2xl font-black text-purple-700 font-mono">${totalDayManHours}</span>
                    <span class="text-xs text-slate-500 font-bold">공수 (7.5hr 기준)</span>
                </div>
                <div class="text-[11px] text-slate-500 mt-1">기타업무 공수: ${otherManHours.toFixed(2)}공수</div>
            </div>
        </div>

        <!-- 3. 업무 영역 탭 네비게이션 -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden no-print">
            <div class="flex overflow-x-auto border-b border-slate-200 bg-slate-50 text-xs font-bold scrollbar-none">
                <button type="button" class="tab-gimpo-section py-3 px-4 flex items-center gap-1.5 border-b-2 transition ${currentActiveSection === 'packaging' ? 'border-blue-600 text-blue-600 bg-white font-extrabold' : 'border-transparent text-slate-600 hover:text-slate-900'}" data-section="packaging">
                    <i data-lucide="package-check" class="w-4 h-4"></i>
                    <span>1. 제품포장작업 (${(currentLog.packaging || []).length})</span>
                </button>
                <button type="button" class="tab-gimpo-section py-3 px-4 flex items-center gap-1.5 border-b-2 transition ${currentActiveSection === 'oilBlending' ? 'border-blue-600 text-blue-600 bg-white font-extrabold' : 'border-transparent text-slate-600 hover:text-slate-900'}" data-section="oilBlending">
                    <i data-lucide="flask-conical" class="w-4 h-4 text-sky-600"></i>
                    <span>2. 원액생산작업 (${(currentLog.oilBlending || []).length})</span>
                </button>
                <button type="button" class="tab-gimpo-section py-3 px-4 flex items-center gap-1.5 border-b-2 transition ${currentActiveSection === 'labeling' ? 'border-blue-600 text-blue-600 bg-white font-extrabold' : 'border-transparent text-slate-600 hover:text-slate-900'}" data-section="labeling">
                    <i data-lucide="tag" class="w-4 h-4 text-indigo-600"></i>
                    <span>3. 라벨부착작업 (${(currentLog.labeling || []).length})</span>
                </button>
                <button type="button" class="tab-gimpo-section py-3 px-4 flex items-center gap-1.5 border-b-2 transition ${currentActiveSection === 'movement' ? 'border-blue-600 text-blue-600 bg-white font-extrabold' : 'border-transparent text-slate-600 hover:text-slate-900'}" data-section="movement">
                    <i data-lucide="truck" class="w-4 h-4 text-amber-600"></i>
                    <span>4. 이동제품 (${(currentLog.movement || []).length})</span>
                </button>
                <button type="button" class="tab-gimpo-section py-3 px-4 flex items-center gap-1.5 border-b-2 transition ${currentActiveSection === 'inOut' ? 'border-blue-600 text-blue-600 bg-white font-extrabold' : 'border-transparent text-slate-600 hover:text-slate-900'}" data-section="inOut">
                    <i data-lucide="arrow-left-right" class="w-4 h-4 text-emerald-600"></i>
                    <span>5. 입고·출고내역 (${(currentLog.receiving || []).length + (currentLog.shipping || []).length})</span>
                </button>
                <button type="button" class="tab-gimpo-section py-3 px-4 flex items-center gap-1.5 border-b-2 transition ${currentActiveSection === 'courier' ? 'border-blue-600 text-blue-600 bg-white font-extrabold' : 'border-transparent text-slate-600 hover:text-slate-900'}" data-section="courier">
                    <i data-lucide="box" class="w-4 h-4 text-teal-600"></i>
                    <span>6. 택배출고 및 특이사항</span>
                </button>
                <button type="button" class="tab-gimpo-section py-3 px-4 flex items-center gap-1.5 border-b-2 transition ${currentActiveSection === 'otherTasks' ? 'border-blue-600 text-blue-600 bg-white font-extrabold' : 'border-transparent text-slate-600 hover:text-slate-900'}" data-section="otherTasks">
                    <i data-lucide="clipboard-list" class="w-4 h-4 text-purple-600"></i>
                    <span>7. 기타업무·공수 (${(currentLog.otherTasks || []).length})</span>
                </button>
            </div>

            <!-- 활성화된 섹션 콘텐츠 -->
            <div class="p-5" id="gimpo-section-content">
                ${renderActiveSectionContent(currentLog, currentActiveSection)}
            </div>
        </div>

        <!-- 4. 인쇄 전용 공식 A4 업무일지 양식 (화면에서는 숨김, 인쇄 시 표시) -->
        <div id="print-area-gimpo" class="hidden print:block font-sans text-black p-4 space-y-4">
            ${renderPrintDocument(currentLog)}
        </div>
    </section>
    `;

    bindEvents(container, currentLog, showToast);
};

// ==========================================
// 섹션별 렌더링 헬퍼
// ==========================================

const renderActiveSectionContent = (log, section) => {
    if (section === 'packaging') {
        const rows = log.packaging || [];
        return `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                        <span>■ 제품포장작업</span>
                        <span class="text-xs text-slate-500 font-normal">완제품 라인 충진 및 박스 포장 실적</span>
                    </h3>
                </div>
                <button type="button" id="btn-add-packaging-row" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1">
                    <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                    <span>포장 작업 행 추가</span>
                </button>
            </div>

            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs text-left">
                    <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                            <th class="p-2.5">품명 (코드 / 품목명)</th>
                            <th class="p-2.5">규격</th>
                            <th class="p-2.5 text-right">수량</th>
                            <th class="p-2.5 text-right">박스</th>
                            <th class="p-2.5 text-right">시간(h)</th>
                            <th class="p-2.5 text-right">인원</th>
                            <th class="p-2.5 text-right">총시간</th>
                            <th class="p-2.5">LINE</th>
                            <th class="p-2.5">LOT 번호</th>
                            <th class="p-2.5">카테고리</th>
                            <th class="p-2.5 text-right">공수</th>
                            <th class="p-2.5">작업자</th>
                            <th class="p-2.5 text-center">관리</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100" id="tbody-packaging">
                        ${rows.length === 0 ? `<tr><td colspan="13" class="p-6 text-center text-slate-400">등록된 제품포장 작업 실적이 없습니다.</td></tr>` : 
                            rows.map((r, i) => `
                            <tr class="hover:bg-slate-50/80 transition" data-index="${i}">
                                <td class="p-2.5 font-bold text-slate-900 max-w-xs truncate" title="${r.item}">${r.item}</td>
                                <td class="p-2.5 text-slate-600">${r.spec || '-'}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-blue-600">${r.qty.toLocaleString()}</td>
                                <td class="p-2.5 text-right font-mono">${r.box || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.workHours || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.workersCount || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.totalWorkHours || 0}</td>
                                <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700">${r.line || '-'}</span></td>
                                <td class="p-2.5 font-mono text-[11px] text-slate-500">${r.lotNo || '-'}</td>
                                <td class="p-2.5 text-slate-600">${r.category || '-'}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-purple-600">${r.manHours || 0}</td>
                                <td class="p-2.5 text-slate-700 max-w-xs truncate" title="${r.workers}">${r.workers || '-'}</td>
                                <td class="p-2.5 text-center">
                                    <button type="button" class="btn-del-packaging-row text-rose-500 hover:text-rose-700 p-1" data-index="${i}">
                                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        `;
    }

    if (section === 'oilBlending') {
        const rows = log.oilBlending || [];
        return `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                        <span>■ 원액생산작업 (블렌딩)</span>
                        <span class="text-xs text-slate-500 font-normal">블렌딩 탱크(BT-1, BT-2 등) 조유 및 원액 제조</span>
                    </h3>
                </div>
                <button type="button" id="btn-add-oil-row" class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1">
                    <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                    <span>원액 생산 행 추가</span>
                </button>
            </div>

            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs text-left">
                    <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                            <th class="p-2.5">품명 (코드 / 원액명)</th>
                            <th class="p-2.5">단위</th>
                            <th class="p-2.5 text-right">생산수량</th>
                            <th class="p-2.5">포장용기</th>
                            <th class="p-2.5 text-right">시간(h)</th>
                            <th class="p-2.5 text-right">인원</th>
                            <th class="p-2.5 text-right">총시간</th>
                            <th class="p-2.5">LINE (BT)</th>
                            <th class="p-2.5">LOT 번호</th>
                            <th class="p-2.5">카테고리</th>
                            <th class="p-2.5 text-right">공수</th>
                            <th class="p-2.5 text-center">관리</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length === 0 ? `<tr><td colspan="12" class="p-6 text-center text-slate-400">등록된 원액 생산 실적이 없습니다.</td></tr>` : 
                            rows.map((r, i) => `
                            <tr class="hover:bg-slate-50/80 transition">
                                <td class="p-2.5 font-bold text-slate-900 max-w-xs truncate" title="${r.item}">${r.item}</td>
                                <td class="p-2.5 text-slate-600">${r.spec || 'L'}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-sky-600">${r.qty.toLocaleString()} L</td>
                                <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-50 text-sky-800 border border-sky-200">${r.packageType || 'TOTE'}</span></td>
                                <td class="p-2.5 text-right font-mono">${r.workHours || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.workersCount || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.totalWorkHours || 0}</td>
                                <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700">${r.line || 'BT-2'}</span></td>
                                <td class="p-2.5 font-mono text-[11px] text-slate-500 font-bold">${r.lotNo || '-'}</td>
                                <td class="p-2.5 text-slate-600">${r.category || '-'}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-purple-600">${r.manHours || 0}</td>
                                <td class="p-2.5 text-center">
                                    <button type="button" class="btn-del-oil-row text-rose-500 hover:text-rose-700 p-1" data-index="${i}">
                                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        `;
    }

    if (section === 'labeling') {
        const rows = log.labeling || [];
        return `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                        <span>■ 라벨부착작업</span>
                        <span class="text-xs text-slate-500 font-normal">공용기 라벨 자동/수동 부착 공정</span>
                    </h3>
                </div>
            </div>

            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs text-left">
                    <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                            <th class="p-2.5">품명</th>
                            <th class="p-2.5">규격</th>
                            <th class="p-2.5 text-right">수량</th>
                            <th class="p-2.5 text-right">박스</th>
                            <th class="p-2.5 text-right">작업시간</th>
                            <th class="p-2.5 text-right">인원</th>
                            <th class="p-2.5 text-right">총시간</th>
                            <th class="p-2.5">LINE</th>
                            <th class="p-2.5">LOT 번호</th>
                            <th class="p-2.5">카테고리</th>
                            <th class="p-2.5 text-right">공수</th>
                            <th class="p-2.5">작업자</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length === 0 ? `<tr><td colspan="12" class="p-6 text-center text-slate-400">등록된 라벨 부착 실적이 없습니다.</td></tr>` : 
                            rows.map((r) => `
                            <tr class="hover:bg-slate-50/80 transition">
                                <td class="p-2.5 font-bold text-slate-900">${r.item}</td>
                                <td class="p-2.5 text-slate-600">${r.spec || '-'}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-indigo-600">${r.qty.toLocaleString()}</td>
                                <td class="p-2.5 text-right font-mono">${r.box || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.workHours || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.workersCount || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.totalWorkHours || 0}</td>
                                <td class="p-2.5">${r.line || '-'}</td>
                                <td class="p-2.5 font-mono text-[11px] text-slate-500">${r.lotNo || '-'}</td>
                                <td class="p-2.5">${r.category || '-'}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-purple-600">${r.manHours || 0}</td>
                                <td class="p-2.5 text-slate-700">${r.workers || '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        `;
    }

    if (section === 'movement') {
        const rows = log.movement || [];
        return `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                        <span>■ 이동제품 (김포 ⇄ 본사 등 거점 이동)</span>
                        <span class="text-xs text-slate-500 font-normal">김포공장에서 완제품/부자재/원액을 본사 창고로 이송</span>
                    </h3>
                </div>
            </div>

            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs text-left">
                    <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                            <th class="p-2.5">품명</th>
                            <th class="p-2.5">용량/규격</th>
                            <th class="p-2.5">단위</th>
                            <th class="p-2.5 text-right">수량</th>
                            <th class="p-2.5">박스/용기</th>
                            <th class="p-2.5">차량</th>
                            <th class="p-2.5">운반자</th>
                            <th class="p-2.5">이동 경로 (출발 &rarr; 도착)</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length === 0 ? `<tr><td colspan="8" class="p-6 text-center text-slate-400">등록된 거점 이동 내역이 없습니다.</td></tr>` : 
                            rows.map((r) => `
                            <tr class="hover:bg-slate-50/80 transition">
                                <td class="p-2.5 font-bold text-slate-900">${r.item}</td>
                                <td class="p-2.5 text-slate-600">${r.spec || '-'}</td>
                                <td class="p-2.5 text-slate-600">${r.unit || 'EA'}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-amber-600">${r.qty.toLocaleString()}</td>
                                <td class="p-2.5 font-mono">${r.box || '-'}</td>
                                <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">${r.vehicle || '3.5T'}</span></td>
                                <td class="p-2.5 font-bold text-slate-700">${r.driver || '-'}</td>
                                <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200">${r.route || '김포 -> 본사'}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        `;
    }

    if (section === 'inOut') {
        const inRows = log.receiving || [];
        const outRows = log.shipping || [];
        return `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- 입고 내역 -->
            <div class="space-y-3">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>■ 입고내역 (원부자재/포장재)</span>
                </h3>
                <div class="overflow-x-auto border border-slate-200 rounded-xl">
                    <table class="w-full text-xs text-left">
                        <thead class="bg-emerald-50/50 text-emerald-900 font-bold border-b border-slate-200">
                            <tr>
                                <th class="p-2.5">품명</th>
                                <th class="p-2.5 text-right">수량</th>
                                <th class="p-2.5">단위</th>
                                <th class="p-2.5">거래처</th>
                                <th class="p-2.5">확인자</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${inRows.length === 0 ? `<tr><td colspan="5" class="p-4 text-center text-slate-400">입고 내역 없음</td></tr>` : 
                                inRows.map(r => `
                                <tr>
                                    <td class="p-2.5 font-bold text-slate-900">${r.item}</td>
                                    <td class="p-2.5 text-right font-mono font-bold text-emerald-600">${r.qty.toLocaleString()}</td>
                                    <td class="p-2.5 text-slate-500">${r.box || 'EA'}</td>
                                    <td class="p-2.5 font-bold text-slate-700">${r.partner || '-'}</td>
                                    <td class="p-2.5 text-slate-600">${r.inspector || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 출고 내역 -->
            <div class="space-y-3">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span>■ 출고내역 (외부 납품/출하)</span>
                </h3>
                <div class="overflow-x-auto border border-slate-200 rounded-xl">
                    <table class="w-full text-xs text-left">
                        <thead class="bg-blue-50/50 text-blue-900 font-bold border-b border-slate-200">
                            <tr>
                                <th class="p-2.5">품명</th>
                                <th class="p-2.5 text-right">수량</th>
                                <th class="p-2.5">단위</th>
                                <th class="p-2.5">거래처</th>
                                <th class="p-2.5">확인자</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${outRows.length === 0 ? `<tr><td colspan="5" class="p-4 text-center text-slate-400">출고 내역 없음</td></tr>` : 
                                outRows.map(r => `
                                <tr>
                                    <td class="p-2.5 font-bold text-slate-900">${r.item}</td>
                                    <td class="p-2.5 text-right font-mono font-bold text-blue-600">${r.qty.toLocaleString()}</td>
                                    <td class="p-2.5 text-slate-500">${r.box || 'EA'}</td>
                                    <td class="p-2.5 font-bold text-slate-700">${r.partner || '-'}</td>
                                    <td class="p-2.5 text-slate-600">${r.inspector || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        `;
    }

    if (section === 'courier') {
        const couriers = log.courier || [];
        const notes = log.otherNotes || [];
        return `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="space-y-3">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                    <i data-lucide="truck" class="w-4 h-4 text-teal-600"></i>
                    <span>■ 택배출고현황</span>
                </h3>
                <div class="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
                    ${couriers.length === 0 ? `<p class="text-slate-400 text-xs">등록된 택배 출고 건이 없습니다.</p>` : 
                        couriers.map(c => `
                        <div class="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg text-xs">
                            <span class="font-bold text-slate-800">${c.type}</span>
                            <div class="flex items-center gap-2">
                                <span class="font-mono font-black text-teal-600">${c.count}건</span>
                                ${c.notes ? `<span class="text-slate-400 text-[11px]">(${c.notes})</span>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="space-y-3">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                    <i data-lucide="message-square" class="w-4 h-4 text-amber-600"></i>
                    <span>■ 공장 일일 특이사항 / 메모</span>
                </h3>
                <div class="border border-slate-200 rounded-xl p-4 bg-amber-50/40 space-y-2">
                    ${notes.length === 0 ? `<p class="text-slate-400 text-xs">등록된 특이사항이 없습니다.</p>` : 
                        notes.map(n => `
                        <div class="flex items-start gap-2 text-xs text-amber-950 bg-white p-2.5 rounded-lg border border-amber-200 shadow-xs">
                            <i data-lucide="chevron-right" class="w-4 h-4 text-amber-500 shrink-0 mt-0.5"></i>
                            <span>${n}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        `;
    }

    if (section === 'otherTasks') {
        const rows = log.otherTasks || [];
        return `
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                        <span>■ 기타업무 및 간접공수 집계</span>
                        <span class="text-xs text-slate-500 font-normal">공장 시설 점검, 환기, 전산 입력, 입고정리 등 작업공수</span>
                    </h3>
                </div>
            </div>

            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs text-left">
                    <thead class="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                            <th class="p-2.5">업무명</th>
                            <th class="p-2.5 text-right">작업시간(h)</th>
                            <th class="p-2.5 text-right">투입인원</th>
                            <th class="p-2.5 text-right">총시간</th>
                            <th class="p-2.5">담당자</th>
                            <th class="p-2.5 text-right">작업공수</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length === 0 ? `<tr><td colspan="6" class="p-6 text-center text-slate-400">등록된 기타업무 내역이 없습니다.</td></tr>` : 
                            rows.map(r => `
                            <tr class="hover:bg-slate-50/80 transition">
                                <td class="p-2.5 font-bold text-slate-900">${r.task}</td>
                                <td class="p-2.5 text-right font-mono">${r.workHours || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.workersCount || 0}</td>
                                <td class="p-2.5 text-right font-mono">${r.totalWorkHours || 0}</td>
                                <td class="p-2.5 font-bold text-slate-700">${r.worker || '-'}</td>
                                <td class="p-2.5 text-right font-mono font-bold text-purple-600">${r.manHours || 0}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        `;
    }

    return '';
};

// ==========================================
// 인쇄 전용 공식 양식 문서 렌더러
// ==========================================

const renderPrintDocument = (log) => {
    return `
    <div style="font-family: 'Malgun Gothic', dotum, sans-serif; color: black; line-height: 1.4;">
        <table style="width: 100%; border: none; margin-bottom: 12px;">
            <tr>
                <td style="font-size: 20px; font-weight: bold; text-align: left;">
                    (김포) 생산공급망 업무일지
                </td>
                <td style="text-align: right;">
                    <table style="display: inline-table; border-collapse: collapse; border: 1px solid black; text-align: center; font-size: 11px;">
                        <tr>
                            <td rowspan="2" style="border: 1px solid black; padding: 4px 8px; background: #eee;">결재</td>
                            <td style="border: 1px solid black; padding: 2px 14px;">담당</td>
                            <td style="border: 1px solid black; padding: 2px 14px;">검토</td>
                            <td style="border: 1px solid black; padding: 2px 14px;">확인</td>
                        </tr>
                        <tr style="height: 38px;">
                            <td style="border: 1px solid black; padding: 4px;">${log.manager || '최용화'}</td>
                            <td style="border: 1px solid black; padding: 4px;">${log.reviewer || '윤경용'}</td>
                            <td style="border: 1px solid black; padding: 4px;">${log.approver || '승인'}</td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>

        <div style="font-size: 12px; margin-bottom: 8px;">
            <b>일자:</b> ${log.date} (시트: ${log.sheetName})
        </div>

        <!-- 1. 제품포장작업 -->
        <div style="font-weight: bold; font-size: 12px; margin-top: 10px; margin-bottom: 4px;">■ 제품포장작업</div>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid black; font-size: 10px; text-align: center;">
            <tr style="background: #f0f0f0;">
                <th style="border: 1px solid black; padding: 3px;">품명</th>
                <th style="border: 1px solid black; padding: 3px;">규격</th>
                <th style="border: 1px solid black; padding: 3px;">수량</th>
                <th style="border: 1px solid black; padding: 3px;">박스</th>
                <th style="border: 1px solid black; padding: 3px;">시간</th>
                <th style="border: 1px solid black; padding: 3px;">인원</th>
                <th style="border: 1px solid black; padding: 3px;">총시간</th>
                <th style="border: 1px solid black; padding: 3px;">라인</th>
                <th style="border: 1px solid black; padding: 3px;">LOT</th>
                <th style="border: 1px solid black; padding: 3px;">공수</th>
                <th style="border: 1px solid black; padding: 3px;">작업자</th>
            </tr>
            ${(log.packaging || []).map(r => `
                <tr>
                    <td style="border: 1px solid black; padding: 3px; text-align: left;">${r.item}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.spec}</td>
                    <td style="border: 1px solid black; padding: 3px; text-align: right;">${r.qty.toLocaleString()}</td>
                    <td style="border: 1px solid black; padding: 3px; text-align: right;">${r.box}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.workHours}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.workersCount}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.totalWorkHours}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.line}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.lotNo}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.manHours}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.workers}</td>
                </tr>
            `).join('')}
        </table>

        <!-- 2. 원액생산작업 -->
        <div style="font-weight: bold; font-size: 12px; margin-top: 10px; margin-bottom: 4px;">■ 원액생산작업</div>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid black; font-size: 10px; text-align: center;">
            <tr style="background: #f0f0f0;">
                <th style="border: 1px solid black; padding: 3px;">품명</th>
                <th style="border: 1px solid black; padding: 3px;">수량(L)</th>
                <th style="border: 1px solid black; padding: 3px;">포장</th>
                <th style="border: 1px solid black; padding: 3px;">시간</th>
                <th style="border: 1px solid black; padding: 3px;">인원</th>
                <th style="border: 1px solid black; padding: 3px;">총시간</th>
                <th style="border: 1px solid black; padding: 3px;">라인</th>
                <th style="border: 1px solid black; padding: 3px;">LOT</th>
                <th style="border: 1px solid black; padding: 3px;">공수</th>
            </tr>
            ${(log.oilBlending || []).map(r => `
                <tr>
                    <td style="border: 1px solid black; padding: 3px; text-align: left;">${r.item}</td>
                    <td style="border: 1px solid black; padding: 3px; text-align: right;">${r.qty.toLocaleString()}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.packageType}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.workHours}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.workersCount}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.totalWorkHours}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.line}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.lotNo}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.manHours}</td>
                </tr>
            `).join('')}
        </table>

        <!-- 3. 이동제품 -->
        <div style="font-weight: bold; font-size: 12px; margin-top: 10px; margin-bottom: 4px;">■ 이동제품 (김포 -> 본사)</div>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid black; font-size: 10px; text-align: center;">
            <tr style="background: #f0f0f0;">
                <th style="border: 1px solid black; padding: 3px;">품명</th>
                <th style="border: 1px solid black; padding: 3px;">수량</th>
                <th style="border: 1px solid black; padding: 3px;">단위</th>
                <th style="border: 1px solid black; padding: 3px;">차량</th>
                <th style="border: 1px solid black; padding: 3px;">운반자</th>
                <th style="border: 1px solid black; padding: 3px;">경로</th>
            </tr>
            ${(log.movement || []).map(r => `
                <tr>
                    <td style="border: 1px solid black; padding: 3px; text-align: left;">${r.item}</td>
                    <td style="border: 1px solid black; padding: 3px; text-align: right;">${r.qty.toLocaleString()}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.unit || 'EA'}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.vehicle}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.driver}</td>
                    <td style="border: 1px solid black; padding: 3px;">${r.route}</td>
                </tr>
            `).join('')}
        </table>
    </div>
    `;
};

// ==========================================
// 이벤트 핸들러 바인딩
// ==========================================

const bindEvents = (container, currentLog, showToast) => {
    createIcons({ icons });

    // 1. 날짜 피커 변경
    const datePicker = container.querySelector('#gimpo-log-date-picker');
    datePicker?.addEventListener('change', (e) => {
        currentDateStr = e.target.value;
        renderProductionLog(container, { showToast });
    });

    // 2. 날짜 칩 클릭
    container.querySelectorAll('.btn-select-date-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            currentDateStr = btn.getAttribute('data-date');
            renderProductionLog(container, { showToast });
        });
    });

    // 2-1. 월별 필터 버튼 클릭
    container.querySelectorAll('.btn-month-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedMonthFilter = btn.getAttribute('data-month');
            const availableLogs = (state.gimpoLogs || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const matching = availableLogs.filter(l => selectedMonthFilter === 'ALL' || l.date?.includes(`-${selectedMonthFilter}-`));
            if (matching.length > 0) {
                currentDateStr = matching[0].date;
            }
            renderProductionLog(container, { showToast });
        });
    });

    // 3. 섹션 탭 변경
    container.querySelectorAll('.tab-gimpo-section').forEach(btn => {
        btn.addEventListener('click', () => {
            currentActiveSection = btn.getAttribute('data-section');
            renderProductionLog(container, { showToast });
        });
    });

    // 4. 결재 상태 토글 (확인란)
    container.querySelector('#log-approver-name')?.addEventListener('click', () => {
        currentLog.approver = currentLog.approver === '승인완료' ? '' : '승인완료';
        saveGimpoLog(currentLog);
        renderProductionLog(container, { showToast });
        showToast(`결재 상태가 '${currentLog.approver || '미결재'}'(으)로 변경되었습니다.`);
    });

    // 5. 공식 A4 일지 인쇄
    container.querySelector('#btn-print-gimpo-log')?.addEventListener('click', () => {
        window.print();
    });

    // 6. 엑셀 다운로드
    container.querySelector('#btn-export-gimpo-excel')?.addEventListener('click', () => {
        const wb = XLSX.utils.book_new();

        // 제품포장 시트
        if ((currentLog.packaging || []).length > 0) {
            const wsPack = XLSX.utils.json_to_sheet(currentLog.packaging);
            XLSX.utils.book_append_sheet(wb, wsPack, '제품포장작업');
        }
        // 원액생산 시트
        if ((currentLog.oilBlending || []).length > 0) {
            const wsOil = XLSX.utils.json_to_sheet(currentLog.oilBlending);
            XLSX.utils.book_append_sheet(wb, wsOil, '원액생산작업');
        }
        // 이동제품 시트
        if ((currentLog.movement || []).length > 0) {
            const wsMove = XLSX.utils.json_to_sheet(currentLog.movement);
            XLSX.utils.book_append_sheet(wb, wsMove, '이동제품');
        }

        XLSX.writeFile(wb, `(김포)생산공급망업무일지_${currentDateStr}.xlsx`);
        showToast('📁 일일 생산공급망 업무일지 엑셀 파일이 다운로드되었습니다.');
    });

    // 7. WMS 재고 및 수불부 자동 반영
    container.querySelector('#btn-apply-to-stock')?.addEventListener('click', async () => {
        const confirmed = confirm(
            `[재고 및 수불부 자동 반영 안내]\n\n` +
            `해당 일자(${currentDateStr})의 제품포장, 원액생산, 거점이동 실적을 WMS 재고와 수불부에 실시간 반영하시겠습니까?\n` +
            `- 포장 완제품: 김포공장 재고 증가 (+)\n` +
            `- 원액 블렌딩: 김포공장 원액 재고 증가 (+)\n` +
            `- 거점 이동: 김포공장 차감 (-), 본사 창고 입고 (+)`
        );
        if (!confirmed) return;

        try {
            const result = await applyGimpoLogToInventory(currentDateStr, state.currentGlobalWorker || '최용화');
            showToast(`✅ WMS 재고 반영 완료: 포장 ${result.packagingCount}건, 원액 ${result.oilCount}건, 이동 ${result.moveCount}건`);
            if (result.errors.length > 0) {
                alert(`일부 품목 처리 실패:\n${result.errors.join('\n')}`);
            }
        } catch (err) {
            alert('재고 반영 중 오류 발생: ' + err.message);
        }
    });

    // 8. 새 일자 일지 생성
    container.querySelector('#btn-new-gimpo-log')?.addEventListener('click', () => {
        const newDate = prompt('신규 생성할 일자를 입력하세요 (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
        if (newDate) {
            currentDateStr = newDate;
            const newLog = getGimpoLogByDate(newDate);
            saveGimpoLog(newLog);
            renderProductionLog(container, { showToast });
            showToast(`신규 일자 (${newDate}) 업무일지가 생성되었습니다.`);
        }
    });

    // 9. 포장 행 추가
    container.querySelector('#btn-add-packaging-row')?.addEventListener('click', () => {
        const itemInput = prompt('품명 또는 품목코드를 입력하세요:');
        if (!itemInput) return;
        const qtyInput = Number(prompt('생산 수량을 입력하세요:', '100')) || 0;
        const boxInput = Number(prompt('박스 수를 입력하세요:', Math.ceil(qtyInput / 12))) || 0;

        currentLog.packaging = currentLog.packaging || [];
        currentLog.packaging.push({
            item: itemInput,
            spec: '1L',
            qty: qtyInput,
            box: boxInput,
            workHours: 4,
            workersCount: 2,
            totalWorkHours: 8,
            line: '수동1',
            lotNo: `G${currentDateStr.replace(/-/g, '').slice(2)}-01`,
            category: '엔진오일',
            manHours: Number((8 / 7.5).toFixed(2)),
            workers: state.currentGlobalWorker || '정화순, 윤상모'
        });
        saveGimpoLog(currentLog);
        renderProductionLog(container, { showToast });
        showToast('포장 작업 행이 추가되었습니다.');
    });

    // 10. 포장 행 삭제
    container.querySelectorAll('.btn-del-packaging-row').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-index'));
            currentLog.packaging.splice(idx, 1);
            saveGimpoLog(currentLog);
            renderProductionLog(container, { showToast });
            showToast('포장 작업 행이 삭제되었습니다.');
        });
    });

    // 11. 원액 행 추가
    container.querySelector('#btn-add-oil-row')?.addEventListener('click', () => {
        const itemInput = prompt('원액 품명 또는 코드를 입력하세요:');
        if (!itemInput) return;
        const qtyInput = Number(prompt('생산 수량 (L)을 입력하세요:', '1000')) || 0;

        currentLog.oilBlending = currentLog.oilBlending || [];
        currentLog.oilBlending.push({
            item: itemInput,
            spec: 'L',
            qty: qtyInput,
            packageType: 'TOTE',
            workHours: 3,
            workersCount: 2,
            totalWorkHours: 6,
            line: 'BT-2',
            lotNo: `G${currentDateStr.replace(/-/g, '').slice(2)}-01`,
            category: '원액',
            manHours: Number((6 / 7.5).toFixed(2))
        });
        saveGimpoLog(currentLog);
        renderProductionLog(container, { showToast });
        showToast('원액 생산 행이 추가되었습니다.');
    });

    // 12. 원액 행 삭제
    container.querySelectorAll('.btn-del-oil-row').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-index'));
            currentLog.oilBlending.splice(idx, 1);
            saveGimpoLog(currentLog);
            renderProductionLog(container, { showToast });
            showToast('원액 생산 행이 삭제되었습니다.');
        });
    });

    // 13. 일지 저장
    container.querySelector('#btn-save-gimpo-log')?.addEventListener('click', () => {
        saveGimpoLog(currentLog);
        showToast('💾 일일 생산공급망 업무일지가 저장되었습니다.');
    });
};
