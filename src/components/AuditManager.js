import { state, commitStockAudit } from '../services/db.js';

export const renderAuditManager = (container, { showToast, onRefresh }) => {
    // 임시 실사 입력 맵: `${code}___${location}` -> { actualQty, reason }
    const workingMap = {};

    container.innerHTML = `
    <section id="tab-content-audit" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="clipboard-check" class="w-5 h-5 text-teal-600"></i>
                        <span>정기 재고 실사 & 전산 오차 보정</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">현장에서 실사 조사한 실물 수량을 입력하여 전산 재고와의 오차를 산출하고 일괄 반영합니다.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-commit-audit" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-black rounded-xl transition flex items-center gap-1.5 shadow-md">
                        <i data-lucide="save" class="w-4 h-4"></i>
                        <span>실사 오차 전산 일괄 반영</span>
                    </button>
                </div>
            </div>

            <!-- 거점 선택 필터 -->
            <div class="flex items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span class="text-xs font-bold text-slate-600">실사 대상 거점:</span>
                <select id="audit-filter-loc" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                    <option value="">전체 거점</option>
                    ${state.locations.map(l => `<option value="${l}">${l}</option>`).join('')}
                </select>
            </div>

            <!-- 실사 테이블 -->
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 text-slate-600 border-b border-slate-200">
                        <tr>
                            <th class="p-3">거점</th>
                            <th class="p-3">품목코드</th>
                            <th class="p-3">품목명</th>
                            <th class="p-3 text-right">전산 장부 수량</th>
                            <th class="p-3 text-right">현장 실사 수량</th>
                            <th class="p-3 text-center">오차 수량</th>
                            <th class="p-3">오차 사유 / 비고</th>
                        </tr>
                    </thead>
                    <tbody id="audit-table-body" class="divide-y divide-slate-100"></tbody>
                </table>
            </div>
        </div>
    </section>
    `;

    const renderTable = () => {
        const locFilter = container.querySelector('#audit-filter-loc').value;
        const items = state.inventory.filter(i => !locFilter || i.location === locFilter);
        const tbody = container.querySelector('#audit-table-body');

        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 text-xs">실사 대상 품목이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = items.map(inv => {
            const key = `${inv.code}___${inv.location}`;
            const actual = workingMap[key] !== undefined ? workingMap[key].actualQty : inv.quantity;
            const diff = actual - inv.quantity;

            let diffBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">일치</span>`;
            if (diff > 0) {
                diffBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700">+${diff} EA (초과)</span>`;
            } else if (diff < 0) {
                diffBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-700">${diff} EA (손실)</span>`;
            }

            return `
            <tr class="hover:bg-slate-50 transition" data-key="${key}">
                <td class="p-3 font-bold text-slate-800">${inv.location}</td>
                <td class="p-3 font-mono font-bold text-blue-600">${inv.code}</td>
                <td class="p-3 font-bold text-slate-900">${inv.name}</td>
                <td class="p-3 text-right font-mono font-bold text-slate-500">${inv.quantity} ${inv.unit}</td>
                <td class="p-3 text-right">
                    <input type="number" min="0" value="${actual}" class="input-actual-qty w-24 text-right bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-black text-slate-900 focus:ring-2 focus:ring-teal-500" data-key="${key}" data-book="${inv.quantity}" />
                </td>
                <td class="p-3 text-center diff-cell">${diffBadge}</td>
                <td class="p-3">
                    <input type="text" placeholder="오차 사유 (선택)" value="${workingMap[key]?.reason || ''}" class="input-reason w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-700 focus:ring-2 focus:ring-teal-500" data-key="${key}" />
                </td>
            </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.input-actual-qty').forEach(input => {
            input.addEventListener('input', (e) => {
                const key = input.getAttribute('data-key');
                const book = Number(input.getAttribute('data-book')) || 0;
                const val = Number(e.target.value) || 0;
                if (!workingMap[key]) workingMap[key] = { actualQty: val, reason: '' };
                workingMap[key].actualQty = val;

                const diff = val - book;
                const row = input.closest('tr');
                const diffCell = row.querySelector('.diff-cell');
                if (diff === 0) {
                    diffCell.innerHTML = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">일치</span>`;
                } else if (diff > 0) {
                    diffCell.innerHTML = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700">+${diff} EA (초과)</span>`;
                } else {
                    diffCell.innerHTML = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-700">${diff} EA (손실)</span>`;
                }
            });
        });

        tbody.querySelectorAll('.input-reason').forEach(input => {
            input.addEventListener('input', (e) => {
                const key = input.getAttribute('data-key');
                if (!workingMap[key]) {
                    const row = input.closest('tr');
                    const qty = Number(row.querySelector('.input-actual-qty').value) || 0;
                    workingMap[key] = { actualQty: qty, reason: '' };
                }
                workingMap[key].reason = e.target.value;
            });
        });
    };

    container.querySelector('#audit-filter-loc')?.addEventListener('change', renderTable);

    container.querySelector('#btn-commit-audit')?.addEventListener('click', async () => {
        const keys = Object.keys(workingMap);
        if (keys.length === 0) {
            alert('변경된 실사 수량이 없습니다.');
            return;
        }

        if (confirm(`수정된 ${keys.length}개 품목의 실사 수량을 전산 재고에 즉시 반영하고 이력을 기록하시겠습니까?`)) {
            await commitStockAudit(workingMap, state.currentGlobalWorker);
            showToast(`✅ ${keys.length}개 품목의 재고 실사가 클라우드에 성공적으로 반영되었습니다.`);
            renderTable();
        }
    });

    renderTable();
};
