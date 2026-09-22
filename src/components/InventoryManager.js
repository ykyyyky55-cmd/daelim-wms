import { state } from '../services/db.js';
import * as XLSX from 'xlsx';

export const renderInventoryManager = (container, { showToast }) => {
    container.innerHTML = `
    <section id="tab-content-inventory" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="database" class="w-5 h-5 text-blue-600"></i>
                        <span>창고별 실시간 재고 현황판</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">모든 공장 및 물류 거점에 분산 보관된 원료·자재·완제품의 실시간 수량을 모니터링합니다.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-export-inventory-excel" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="download" class="w-4 h-4"></i>
                        <span>재고 엑셀 다운로드</span>
                    </button>
                </div>
            </div>

            <!-- 필터 바 -->
            <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-xs font-bold text-slate-600">거점:</span>
                    <select id="inv-filter-location" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                        <option value="">전체 거점</option>
                        ${state.locations.map(loc => `<option value="${loc}">${loc}</option>`).join('')}
                    </select>

                    <label class="flex items-center gap-1.5 ml-2 cursor-pointer bg-white px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-700">
                        <input type="checkbox" id="inv-filter-danger" class="rounded text-rose-600 focus:ring-rose-500" />
                        <span class="text-rose-600">안전재고 부족만 보기</span>
                    </label>
                </div>

                <div class="relative">
                    <input type="text" id="inv-search-input" placeholder="품목코드 또는 품명 검색..." class="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none w-64" />
                    <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2"></i>
                </div>
            </div>

            <!-- 재고 테이블 -->
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 text-slate-600 border-b border-slate-200">
                        <tr>
                            <th class="p-3">보관 거점</th>
                            <th class="p-3">품목코드</th>
                            <th class="p-3">분류</th>
                            <th class="p-3">품목명</th>
                            <th class="p-3">규격 / 사양</th>
                            <th class="p-3 text-right">보관 수량</th>
                            <th class="p-3 text-right">기준 안전재고</th>
                            <th class="p-3 text-center">재고 상태</th>
                            <th class="p-3">최종 갱신 일시</th>
                        </tr>
                    </thead>
                    <tbody id="inventory-table-body" class="divide-y divide-slate-100"></tbody>
                </table>
            </div>
        </div>
    </section>
    `;

    const renderTable = () => {
        const locFilter = container.querySelector('#inv-filter-location').value;
        const dangerOnly = container.querySelector('#inv-filter-danger').checked;
        const search = container.querySelector('#inv-search-input').value.toLowerCase().trim();

        const filtered = state.inventory.filter(item => {
            const masterItem = state.master.find(m => m.code === item.code) || {};
            const matchesLoc = !locFilter || item.location === locFilter;
            const matchesSearch = !search || item.code.toLowerCase().includes(search) || item.name.toLowerCase().includes(search);
            const isLow = (Number(item.quantity) || 0) <= (Number(masterItem.safety) || 0);

            if (dangerOnly && !isLow) return false;
            return matchesLoc && matchesSearch;
        });

        const tbody = container.querySelector('#inventory-table-body');
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-slate-400 text-xs">일치하는 재고 내역이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(item => {
            const masterItem = state.master.find(m => m.code === item.code) || {};
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

            return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-bold text-slate-800 flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span>${item.location}</span>
                </td>
                <td class="p-3 font-mono font-bold text-blue-600">${item.code}</td>
                <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">${item.category}</span></td>
                <td class="p-3 font-bold text-slate-900">${item.name}</td>
                <td class="p-3 text-slate-500">${item.spec || '-'}</td>
                <td class="p-3 text-right font-black text-sm ${isDanger ? 'text-rose-600' : 'text-blue-600'}">${qty.toLocaleString()} ${item.unit}</td>
                <td class="p-3 text-right font-bold text-slate-400">${safety} ${item.unit}</td>
                <td class="p-3 text-center">${badge}</td>
                <td class="p-3 text-slate-400 font-mono text-[11px]">${item.lastUpdated || '-'}</td>
            </tr>
            `;
        }).join('');
    };

    container.querySelector('#inv-filter-location')?.addEventListener('change', renderTable);
    container.querySelector('#inv-filter-danger')?.addEventListener('change', renderTable);
    container.querySelector('#inv-search-input')?.addEventListener('input', renderTable);

    container.querySelector('#btn-export-inventory-excel')?.addEventListener('click', () => {
        const ws = XLSX.utils.json_to_sheet(state.inventory.map(i => ({
            "보관거점": i.location,
            "품목코드": i.code,
            "분류": i.category,
            "품목명": i.name,
            "규격": i.spec,
            "수량": i.quantity,
            "단위": i.unit,
            "상태": i.status,
            "최종갱신일시": i.lastUpdated
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "창고재고현황");
        XLSX.writeFile(wb, `WMS_창고재고현황_${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('📥 재고 엑셀 파일이 다운로드되었습니다.');
    });

    renderTable();
};
