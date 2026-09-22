import { state } from '../services/db.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';
import { openModalByName } from './Modals.js';

export const renderLedgerCalendar = (container, { mode = 'ledger', showToast }) => {
    let currentCalendarDate = new Date();

    const render = () => {
        container.innerHTML = `
        <section id="tab-content-ledger-calendar" class="space-y-6">
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                    <div>
                        <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                            <i data-lucide="${mode === 'ledger' ? 'book-open-check' : 'calendar'}" class="w-5 h-5 ${mode === 'ledger' ? 'text-blue-600' : 'text-indigo-600'}"></i>
                            <span>${mode === 'ledger' ? '자재 수불부 (기초·입고·출고·현재고 원장)' : '월간 수불·입출고 캘린더'}</span>
                        </h2>
                        <p class="text-xs text-slate-500 mt-1">
                            ${mode === 'ledger' 
                                ? '품목별 기초(전기이월) 재고, 기간 내 총 입고량(+), 총 출고량(-), 실시간 기말 현재고를 정밀 집계합니다.' 
                                : '날짜별 자재 수불 및 현장 작업 일정을 캘린더 상에서 확인하고 일자별 상세 내역을 조회합니다.'}
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
                    <div class="flex items-center gap-2">
                        <button type="button" id="btn-cal-prev" class="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl transition text-slate-700 font-bold text-xs"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
                        <span id="cal-month-title" class="font-black text-sm text-slate-800 px-2 font-mono"></span>
                        <button type="button" id="btn-cal-next" class="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl transition text-slate-700 font-bold text-xs"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
                        <button type="button" id="btn-cal-today" class="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-xl font-bold text-xs transition">오늘</button>
                    </div>
                    `}
                </div>

                ${mode === 'ledger' ? `
                    <!-- 필터 및 검색 바 -->
                    <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <div class="flex flex-wrap items-center gap-2">
                            <div class="flex items-center gap-1.5">
                                <span class="text-xs font-bold text-slate-600">분류:</span>
                                <select id="ledger-filter-category" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                                    <option value="">전체 분류 (${state.master.length})</option>
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
                        </div>

                        <div class="relative">
                            <input type="text" id="ledger-search-input" placeholder="품목코드 또는 품명 검색..." class="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none w-64" />
                            <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2"></i>
                        </div>
                    </div>

                    <!-- 수불부 요약 카드 -->
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <span class="text-slate-500 font-bold block">관리 품목 총수</span>
                            <span id="stat-ledger-items" class="text-lg font-black text-slate-900">${state.master.length.toLocaleString()}개</span>
                        </div>
                        <div class="bg-blue-50 p-3 rounded-xl border border-blue-200">
                            <span class="text-blue-700 font-bold block">누적 총 입고량 (+)</span>
                            <span id="stat-ledger-in" class="text-lg font-black text-blue-700">-</span>
                        </div>
                        <div class="bg-rose-50 p-3 rounded-xl border border-rose-200">
                            <span class="text-rose-700 font-bold block">누적 총 출고량 (-)</span>
                            <span id="stat-ledger-out" class="text-lg font-black text-rose-700">-</span>
                        </div>
                        <div class="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                            <span class="text-emerald-700 font-bold block">실시간 기말 현재고 총합</span>
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
                    <!-- 캘린더 그리드 -->
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

                    <!-- 일자별 상세 모달/시트 -->
                    <div id="cal-day-detail-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
                        <div class="bg-white max-w-lg w-full rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
                            <div class="px-5 py-3.5 bg-slate-900 text-white flex justify-between items-center">
                                <h3 id="cal-day-modal-title" class="font-bold text-sm">일자별 작업 내역</h3>
                                <button type="button" id="btn-close-day-modal" class="text-slate-400 hover:text-white">&times;</button>
                            </div>
                            <div class="p-5 max-h-80 overflow-y-auto space-y-2 text-xs" id="cal-day-modal-content"></div>
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

    const setupLedger = () => {
        const catSelect = container.querySelector('#ledger-filter-category');
        const partnerSelect = container.querySelector('#ledger-filter-partner');
        const searchInput = container.querySelector('#ledger-search-input');
        const tbody = container.querySelector('#ledger-table-body');
        const btnBStock = container.querySelector('#btn-open-bstock-modal');
        const btnExcel = container.querySelector('#btn-export-ledger-excel');

        btnBStock?.addEventListener('click', () => openModalByName('beginning-stock'));

        const renderLedgerRows = () => {
            const cat = catSelect.value;
            const partner = partnerSelect.value;
            const q = searchInput.value.toLowerCase().trim();

            let totalIn = 0;
            let totalOut = 0;
            let totalStock = 0;

            const filtered = state.master.filter(m => {
                const matchesCat = !cat || m.category === cat;
                const matchesPartner = !partner || m.supplier === partner;
                const matchesQ = !q || m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
                return matchesCat && matchesPartner && matchesQ;
            });

            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-slate-400 text-xs">일치하는 수불 내역이 없습니다.</td></tr>';
                return;
            }

            tbody.innerHTML = filtered.map(m => {
                const bStock = (state.beginningStock && state.beginningStock[m.code] !== undefined)
                    ? Number(state.beginningStock[m.code])
                    : (Number(m.beginningStock) || 0);

                const inTotal = state.history
                    .filter(h => h.code === m.code && h.type === 'IN')
                    .reduce((acc, cur) => acc + (Number(cur.qty) || 0), 0);

                const outTotal = state.history
                    .filter(h => h.code === m.code && (h.type === 'OUT' || h.type === 'USE'))
                    .reduce((acc, cur) => acc + (Number(cur.qty) || 0), 0);

                const currentStock = state.inventory
                    .filter(i => i.code === m.code)
                    .reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);

                totalIn += inTotal;
                totalOut += outTotal;
                totalStock += currentStock;

                const safety = Number(m.safety) || 0;
                const isShort = currentStock <= safety;

                return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="p-3 font-mono font-bold text-blue-600">${m.code}</td>
                    <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">${m.category}</span></td>
                    <td class="p-3 font-bold text-slate-900">${m.name}</td>
                    <td class="p-3 text-slate-600 font-bold">${m.supplier || '-'}</td>
                    <td class="p-3 text-right font-mono font-bold text-amber-800 bg-amber-50/40">${bStock.toLocaleString()}</td>
                    <td class="p-3 text-right font-black text-blue-600 bg-blue-50/40">+${inTotal.toLocaleString()}</td>
                    <td class="p-3 text-right font-black text-rose-600 bg-rose-50/40">-${outTotal.toLocaleString()}</td>
                    <td class="p-3 text-right font-black text-sm text-slate-900 bg-slate-100/50">${currentStock.toLocaleString()}</td>
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
        };

        catSelect?.addEventListener('change', renderLedgerRows);
        partnerSelect?.addEventListener('change', renderLedgerRows);
        searchInput?.addEventListener('input', renderLedgerRows);
        renderLedgerRows();

        // 수불부 정밀 엑셀 다운로드
        btnExcel?.addEventListener('click', () => {
            let rowNo = 1;
            let sumBStock = 0;
            let sumIn = 0;
            let sumOut = 0;
            let sumCurrent = 0;

            const rows = state.master.map(m => {
                const bStock = (state.beginningStock && state.beginningStock[m.code] !== undefined)
                    ? Number(state.beginningStock[m.code])
                    : (Number(m.beginningStock) || 0);

                const inTotal = state.history
                    .filter(h => h.code === m.code && h.type === 'IN')
                    .reduce((acc, cur) => acc + (Number(cur.qty) || 0), 0);

                const outTotal = state.history
                    .filter(h => h.code === m.code && (h.type === 'OUT' || h.type === 'USE'))
                    .reduce((acc, cur) => acc + (Number(cur.qty) || 0), 0);

                const currentStock = state.inventory
                    .filter(i => i.code === m.code)
                    .reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);

                sumBStock += bStock;
                sumIn += inTotal;
                sumOut += outTotal;
                sumCurrent += currentStock;

                const safety = Number(m.safety) || 0;
                const status = currentStock <= safety ? '안전재고 미달(부족)' : '정상 보관';

                return {
                    "No": rowNo++,
                    "품목코드": m.code,
                    "자재분류": m.category,
                    "품목명": m.name,
                    "규격사양": m.spec || '-',
                    "주요거래처": m.supplier || '-',
                    "단위": m.unit || 'EA',
                    "기초(이월)재고": bStock,
                    "기간총입고(+)": inTotal,
                    "기간총출고(-)": outTotal,
                    "기말현재고잔량": currentStock,
                    "기준안전재고": safety,
                    "수불상태": status
                };
            });

            // 요약 합계 행 추가
            rows.push({
                "No": "합계",
                "품목코드": `총 ${state.master.length}개 품목`,
                "자재분류": "-",
                "품목명": "전체 품목 누계 합계",
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
            // 열 너비 자동 조정
            ws['!cols'] = [
                { wch: 6 },  // No
                { wch: 14 }, // 코드
                { wch: 10 }, // 분류
                { wch: 30 }, // 품목명
                { wch: 20 }, // 규격
                { wch: 16 }, // 거래처
                { wch: 8 },  // 단위
                { wch: 14 }, // 기초
                { wch: 14 }, // 입고
                { wch: 14 }, // 출고
                { wch: 14 }, // 기말
                { wch: 12 }, // 안전재고
                { wch: 18 }  // 상태
            ];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "자재수불부");
            XLSX.writeFile(wb, `대림오일_자재수불부_${new Date().toISOString().slice(0, 10)}.xlsx`);
            showToast('📥 자재 수불부 정밀 엑셀 파일이 다운로드되었습니다.');
        });
    };

    const setupCalendar = () => {
        const titleEl = container.querySelector('#cal-month-title');
        const grid = container.querySelector('#calendar-days-grid');
        const modal = container.querySelector('#cal-day-detail-modal');
        const modalTitle = container.querySelector('#cal-day-modal-title');
        const modalContent = container.querySelector('#cal-day-modal-content');
        const btnClose = container.querySelector('#btn-close-day-modal');

        btnClose?.addEventListener('click', () => modal?.classList.add('hidden'));

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
                cells += `<div class="bg-slate-50/50 rounded-xl p-3 min-h-[90px] border border-transparent"></div>`;
            }

            for (let d = 1; d <= daysInMonth; d++) {
                const isToday = isCurrentMonth && d === today.getDate();
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                
                // 날짜별 이력 조회
                const dayLogs = state.history.filter(h => h.timestamp && h.timestamp.includes(dateStr));
                const inCount = dayLogs.filter(h => h.type === 'IN').length;
                const outCount = dayLogs.filter(h => h.type === 'OUT' || h.type === 'USE').length;
                const moveCount = dayLogs.filter(h => h.type === 'MOVE').length;

                cells += `
                <div class="cal-day-card bg-white border ${isToday ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-slate-200'} rounded-xl p-2.5 min-h-[95px] flex flex-col justify-between hover:shadow-md hover:border-indigo-400 transition cursor-pointer" data-date="${dateStr}">
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-xs ${isToday ? 'text-indigo-600 font-black' : 'text-slate-700'}">${d}</span>
                        ${isToday ? '<span class="px-1.5 py-0.2 bg-indigo-600 text-white rounded text-[9px] font-bold">오늘</span>' : ''}
                    </div>
                    <div class="space-y-1 my-1">
                        ${inCount > 0 ? `<div class="text-[10px] font-bold text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 truncate">입고 ${inCount}건</div>` : ''}
                        ${outCount > 0 ? `<div class="text-[10px] font-bold text-rose-700 bg-rose-50 rounded px-1.5 py-0.5 truncate">출고 ${outCount}건</div>` : ''}
                        ${moveCount > 0 ? `<div class="text-[10px] font-bold text-purple-700 bg-purple-50 rounded px-1.5 py-0.5 truncate">이동 ${moveCount}건</div>` : ''}
                    </div>
                    <span class="text-[9px] text-slate-400 text-right font-mono">${dayLogs.length > 0 ? `${dayLogs.length}건 기록` : '-'}</span>
                </div>
                `;
            }

            grid.innerHTML = cells;

            grid.querySelectorAll('.cal-day-card').forEach(card => {
                card.addEventListener('click', () => {
                    const dateStr = card.getAttribute('data-date');
                    const dayLogs = state.history.filter(h => h.timestamp && h.timestamp.includes(dateStr));
                    modalTitle.textContent = `${dateStr} 작업 상세 내역 (${dayLogs.length}건)`;

                    if (dayLogs.length === 0) {
                        modalContent.innerHTML = '<div class="p-6 text-center text-slate-400 text-xs">해당 일자에 기록된 작업 내역이 없습니다.</div>';
                    } else {
                        modalContent.innerHTML = dayLogs.map(l => `
                            <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center">
                                <div>
                                    <div class="flex items-center gap-1.5">
                                        <span class="px-1.5 py-0.5 rounded text-[10px] font-black ${
                                            l.type === 'IN' ? 'bg-blue-100 text-blue-800' :
                                            l.type === 'OUT' || l.type === 'USE' ? 'bg-rose-100 text-rose-800' : 'bg-purple-100 text-purple-800'
                                        }">${l.type}</span>
                                        <span class="font-bold text-slate-900">${l.name}</span>
                                        <span class="font-mono text-[10px] text-slate-500">${l.code}</span>
                                    </div>
                                    <div class="text-[11px] text-slate-500 mt-1">
                                        작업자: <b>${l.worker || '-'}</b> | 거점: ${l.fromLoc || '-'} &rarr; ${l.toLoc || '-'} | 사유: ${l.reason || '-'}
                                    </div>
                                </div>
                                <span class="font-black text-sm text-slate-900">${Number(l.qty).toLocaleString()}EA</span>
                            </div>
                        `).join('');
                    }
                    modal.classList.remove('hidden');
                });
            });
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
    };

    render();
};
