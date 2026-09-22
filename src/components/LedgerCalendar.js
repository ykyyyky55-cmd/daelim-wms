import { state } from '../services/db.js';

export const renderLedgerCalendar = (container, { mode = 'ledger', showToast }) => {
    container.innerHTML = `
    <section id="tab-content-ledger-calendar" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="${mode === 'ledger' ? 'book-open-check' : 'calendar'}" class="w-5 h-5 ${mode === 'ledger' ? 'text-blue-600' : 'text-indigo-600'}"></i>
                        <span>${mode === 'ledger' ? '자재 수불부 (입·출고·현재고 원장)' : '월간 수불·입출고 캘린더'}</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">
                        ${mode === 'ledger' ? '품목별 기초재고, 기간 내 총 입고량, 출고량, 실시간 기말 현재고를 한눈에 대조합니다.' : '날짜별 자재 수불 및 현장 작업 일정을 캘린더 상에서 확인합니다.'}
                    </p>
                </div>
            </div>

            ${mode === 'ledger' ? `
                <!-- 수불부 테이블 -->
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-100 text-slate-600 border-b border-slate-200">
                            <tr>
                                <th class="p-3">품목코드</th>
                                <th class="p-3">분류</th>
                                <th class="p-3">품목명</th>
                                <th class="p-3 text-right">총 입고량 (+)</th>
                                <th class="p-3 text-right">총 출고량 (-)</th>
                                <th class="p-3 text-right">현재고 잔량</th>
                                <th class="p-3 text-center">단위</th>
                                <th class="p-3 text-center">상태</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${state.master.map(m => {
                                const inTotal = state.history
                                    .filter(h => h.code === m.code && h.type === 'IN')
                                    .reduce((acc, cur) => acc + (Number(cur.qty) || 0), 0);
                                const outTotal = state.history
                                    .filter(h => h.code === m.code && (h.type === 'OUT' || h.type === 'USE'))
                                    .reduce((acc, cur) => acc + (Number(cur.qty) || 0), 0);
                                const currentStock = state.inventory
                                    .filter(i => i.code === m.code)
                                    .reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);

                                return `
                                <tr class="hover:bg-slate-50 transition">
                                    <td class="p-3 font-mono font-bold text-blue-600">${m.code}</td>
                                    <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">${m.category}</span></td>
                                    <td class="p-3 font-bold text-slate-900">${m.name}</td>
                                    <td class="p-3 text-right font-black text-blue-600">+${inTotal.toLocaleString()}</td>
                                    <td class="p-3 text-right font-black text-rose-600">-${outTotal.toLocaleString()}</td>
                                    <td class="p-3 text-right font-black text-sm text-slate-900">${currentStock.toLocaleString()}</td>
                                    <td class="p-3 text-center font-bold text-slate-500">${m.unit}</td>
                                    <td class="p-3 text-center">
                                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${currentStock <= m.safety ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}">
                                            ${currentStock <= m.safety ? '부족' : '안정'}
                                        </span>
                                    </td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `
                <!-- 캘린더 그리드 -->
                <div class="grid grid-cols-7 gap-2 text-center text-xs font-bold text-slate-500 mb-2">
                    <div class="text-rose-500">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div class="text-blue-500">토</div>
                </div>
                <div class="grid grid-cols-7 gap-2">
                    ${generateCalendarDays()}
                </div>
            `}
        </div>
    </section>
    `;

    function generateCalendarDays() {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let cells = '';
        for (let i = 0; i < firstDay; i++) {
            cells += `<div class="bg-slate-50/50 rounded-xl p-3 min-h-[90px]"></div>`;
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = d === today.getDate();
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            
            // 해당 날짜 작업 필터링
            const dayLogs = state.history.filter(h => h.timestamp && h.timestamp.includes(dateStr));
            const inCount = dayLogs.filter(h => h.type === 'IN').length;
            const outCount = dayLogs.filter(h => h.type === 'OUT' || h.type === 'USE').length;

            cells += `
            <div class="bg-white border ${isToday ? 'border-indigo-600 ring-2 ring-indigo-100' : 'border-slate-200'} rounded-xl p-2.5 min-h-[90px] flex flex-col justify-between hover:shadow-md transition">
                <div class="flex justify-between items-center">
                    <span class="font-bold text-xs ${isToday ? 'text-indigo-600 font-black' : 'text-slate-700'}">${d}</span>
                    ${isToday ? '<span class="px-1.5 py-0.2 bg-indigo-600 text-white rounded text-[9px] font-bold">오늘</span>' : ''}
                </div>
                <div class="space-y-1 my-1">
                    ${inCount > 0 ? `<div class="text-[10px] font-bold text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 truncate">입고 ${inCount}건</div>` : ''}
                    ${outCount > 0 ? `<div class="text-[10px] font-bold text-rose-700 bg-rose-50 rounded px-1.5 py-0.5 truncate">출고 ${outCount}건</div>` : ''}
                </div>
                <span class="text-[9px] text-slate-400 text-right font-mono">${dayLogs.length > 0 ? `${dayLogs.length}건 작업` : '-'}</span>
            </div>
            `;
        }

        return cells;
    }
};
