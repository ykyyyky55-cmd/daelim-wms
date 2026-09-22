import { state } from '../services/db.js';
import * as XLSX from 'xlsx';

export const renderHistoryManager = (container, { showToast }) => {
    container.innerHTML = `
    <section id="tab-content-history" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="history" class="w-5 h-5 text-blue-600"></i>
                        <span>현장 작업 이력 & 감사 로그 (Audit Trail)</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">모든 작업자의 입고, 출고, 이동, 실사 변경 내역이 타임스탬프와 함께 위변조 없이 기록됩니다.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-export-history-excel" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="download" class="w-4 h-4"></i>
                        <span>이력 엑셀 다운로드</span>
                    </button>
                </div>
            </div>

            <!-- 필터 바 -->
            <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-bold text-slate-600">유형 필터:</span>
                    <select id="hist-filter-type" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                        <option value="">전체 작업 (${state.history.length})</option>
                        <option value="IN">입고 (IN)</option>
                        <option value="OUT">출고 (OUT)</option>
                        <option value="USE">생산투입 (USE)</option>
                        <option value="MOVE">거점 간 이동 (MOVE)</option>
                        <option value="AUDIT">실사보정 (AUDIT)</option>
                    </select>
                </div>

                <div class="relative">
                    <input type="text" id="hist-search-input" placeholder="작업자 또는 품목 검색..." class="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none w-64" />
                    <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2"></i>
                </div>
            </div>

            <!-- 이력 테이블 -->
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 text-slate-600 border-b border-slate-200">
                        <tr>
                            <th class="p-3">일시</th>
                            <th class="p-3">구분</th>
                            <th class="p-3">품목코드</th>
                            <th class="p-3">품목명</th>
                            <th class="p-3 text-right">수량</th>
                            <th class="p-3">출발 &rarr; 도착 거점</th>
                            <th class="p-3">작업자</th>
                            <th class="p-3">사유 및 비고</th>
                        </tr>
                    </thead>
                    <tbody id="history-table-body" class="divide-y divide-slate-100"></tbody>
                </table>
            </div>
        </div>
    </section>
    `;

    const renderTable = () => {
        const typeFilter = container.querySelector('#hist-filter-type').value;
        const search = container.querySelector('#hist-search-input').value.toLowerCase().trim();

        const filtered = state.history.filter(h => {
            const matchesType = !typeFilter || h.type === typeFilter;
            const matchesSearch = !search || h.worker?.toLowerCase().includes(search) || h.code?.toLowerCase().includes(search) || h.name?.toLowerCase().includes(search);
            return matchesType && matchesSearch;
        });

        const tbody = container.querySelector('#history-table-body');
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-400 text-xs">일치하는 작업 이력이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(h => {
            const typeBadge = {
                IN: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">입고</span>',
                OUT: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">출고</span>',
                USE: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800">투입</span>',
                MOVE: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">이동</span>',
                AUDIT: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800">실사</span>'
            }[h.type] || h.type;

            return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-mono text-slate-500">${h.timestamp}</td>
                <td class="p-3">${typeBadge}</td>
                <td class="p-3 font-mono font-bold text-blue-600">${h.code}</td>
                <td class="p-3 font-bold text-slate-900">${h.name}</td>
                <td class="p-3 text-right font-black text-blue-600">${h.qty} EA</td>
                <td class="p-3 text-slate-600">${h.fromLoc} &rarr; ${h.toLoc}</td>
                <td class="p-3 font-bold text-slate-700">${h.worker}</td>
                <td class="p-3 text-slate-500">${h.reason || '-'}</td>
            </tr>
            `;
        }).join('');
    };

    container.querySelector('#hist-filter-type')?.addEventListener('change', renderTable);
    container.querySelector('#hist-search-input')?.addEventListener('input', renderTable);

    container.querySelector('#btn-export-history-excel')?.addEventListener('click', () => {
        const ws = XLSX.utils.json_to_sheet(state.history.map(h => ({
            "일시": h.timestamp,
            "구분": h.type,
            "품목코드": h.code,
            "품목명": h.name,
            "수량": h.qty,
            "출발거점": h.fromLoc,
            "도착거점": h.toLoc,
            "작업자": h.worker,
            "사유": h.reason
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "작업이력");
        XLSX.writeFile(wb, `WMS_작업이력_${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('📥 작업 이력 엑셀 파일이 다운로드되었습니다.');
    });

    renderTable();
};
