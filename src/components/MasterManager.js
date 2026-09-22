import { state, saveMasterItem, deleteMasterItem } from '../services/db.js';
import * as XLSX from 'xlsx';

export const renderMasterManager = (container, { showToast, onRefresh }) => {
    container.innerHTML = `
    <section id="tab-content-master" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="layout-grid" class="w-5 h-5 text-blue-600"></i>
                        <span>품목 마스터 관리</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">자재·원료·완제품의 표준 사양 및 안전재고 기준치를 관리하고 클라우드에 동기화합니다.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-export-master-excel" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="download" class="w-4 h-4"></i>
                        <span>엑셀 다운로드</span>
                    </button>
                    <button type="button" id="btn-open-add-master" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="plus" class="w-4 h-4"></i>
                        <span>신규 품목 등록</span>
                    </button>
                </div>
            </div>

            <!-- 필터 & 검색 바 -->
            <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-bold text-slate-600">분류 필터:</span>
                    <select id="master-filter-category" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                        <option value="">전체 분류 (${state.master.length})</option>
                        ${state.categories.map(c => `<option value="${c}">${c}</option>`).join('')}
                    </select>
                </div>
                <div class="relative">
                    <input type="text" id="master-search-input" placeholder="품목코드 또는 품명 검색..." class="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none w-64" />
                    <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2"></i>
                </div>
            </div>

            <!-- 마스터 테이블 -->
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 text-slate-600 border-b border-slate-200">
                        <tr>
                            <th class="p-3">품목코드</th>
                            <th class="p-3">분류</th>
                            <th class="p-3">품목명</th>
                            <th class="p-3">규격 / 사양</th>
                            <th class="p-3">주요 거래처</th>
                            <th class="p-3 text-center">단위</th>
                            <th class="p-3 text-right">안전재고</th>
                            <th class="p-3 text-center">관리</th>
                        </tr>
                    </thead>
                    <tbody id="master-table-body" class="divide-y divide-slate-100"></tbody>
                </table>
            </div>
        </div>

        <!-- 품목 등록/수정 모달 -->
        <div id="master-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
            <div class="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
                <div class="px-5 py-4 bg-slate-900 text-white flex justify-between items-center">
                    <h3 id="master-modal-title" class="font-bold text-sm">신규 품목 마스터 등록</h3>
                    <button type="button" id="btn-close-master-modal" class="text-slate-400 hover:text-white">&times;</button>
                </div>
                <form id="master-item-form" class="p-5 space-y-4">
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">품목코드 *</label>
                            <input type="text" id="m-code" required placeholder="예: ITEM-1005" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">자재 분류 *</label>
                            <select id="m-category" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold">
                                ${state.categories.map(c => `<option value="${c}">${c}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">품목명 *</label>
                        <input type="text" id="m-name" required placeholder="예: 고장력 육각 너트" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold" />
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">규격 / 사양</label>
                            <input type="text" id="m-spec" placeholder="예: M10 x 30mm" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">주요 거래처</label>
                            <input type="text" id="m-supplier" placeholder="예: (주)한국정밀" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs" />
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">수량 단위</label>
                            <input type="text" id="m-unit" value="EA" placeholder="EA, SET, KG 등" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">안전재고 기준치</label>
                            <input type="number" id="m-safety" min="0" value="50" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-black" />
                        </div>
                    </div>
                    <div class="pt-2 flex justify-end gap-2">
                        <button type="button" id="btn-cancel-master" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50">취소</button>
                        <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm">저장 및 클라우드 반영</button>
                    </div>
                </form>
            </div>
        </div>
    </section>
    `;

    const renderTable = () => {
        const catFilter = container.querySelector('#master-filter-category').value;
        const search = container.querySelector('#master-search-input').value.toLowerCase().trim();

        const filtered = state.master.filter(m => {
            const matchesCat = !catFilter || m.category === catFilter;
            const matchesSearch = !search || m.code.toLowerCase().includes(search) || m.name.toLowerCase().includes(search);
            return matchesCat && matchesSearch;
        });

        const tbody = container.querySelector('#master-table-body');
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-400 text-xs">일치하는 품목이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(item => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-mono font-bold text-blue-600">${item.code}</td>
                <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">${item.category}</span></td>
                <td class="p-3 font-bold text-slate-900">${item.name}</td>
                <td class="p-3 text-slate-500">${item.spec || '-'}</td>
                <td class="p-3 text-slate-600">${item.supplier || '-'}</td>
                <td class="p-3 text-center font-bold text-slate-700">${item.unit}</td>
                <td class="p-3 text-right font-black text-rose-600">${item.safety} ${item.unit}</td>
                <td class="p-3 text-center">
                    <button type="button" class="btn-edit-master p-1 text-blue-600 hover:text-blue-800" data-code="${item.code}"><i data-lucide="edit-3" class="w-3.5 h-3.5"></i></button>
                    <button type="button" class="btn-del-master p-1 text-rose-600 hover:text-rose-800 ml-1" data-code="${item.code}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.btn-edit-master').forEach(b => {
            b.addEventListener('click', () => {
                const code = b.getAttribute('data-code');
                const item = state.master.find(m => m.code === code);
                if (item) openModal(item);
            });
        });

        tbody.querySelectorAll('.btn-del-master').forEach(b => {
            b.addEventListener('click', async () => {
                const code = b.getAttribute('data-code');
                if (confirm(`[${code}] 품목을 마스터에서 삭제하시겠습니까? 연결된 재고 데이터도 함께 제거됩니다.`)) {
                    await deleteMasterItem(code);
                    showToast(`🗑️ [${code}] 품목이 삭제되었습니다.`);
                    renderTable();
                }
            });
        });
    };

    const modal = container.querySelector('#master-modal');
    const openModal = (item = null) => {
        container.querySelector('#master-modal-title').textContent = item ? `품목 수정 - [${item.code}]` : '신규 품목 마스터 등록';
        container.querySelector('#m-code').value = item ? item.code : '';
        container.querySelector('#m-code').readOnly = !!item;
        container.querySelector('#m-category').value = item ? item.category : state.categories[0];
        container.querySelector('#m-name').value = item ? item.name : '';
        container.querySelector('#m-spec').value = item ? item.spec || '' : '';
        container.querySelector('#m-supplier').value = item ? item.supplier || '' : '';
        container.querySelector('#m-unit').value = item ? item.unit || 'EA' : 'EA';
        container.querySelector('#m-safety').value = item ? item.safety : 50;
        modal.classList.remove('hidden');
    };

    const closeModal = () => modal.classList.add('hidden');

    container.querySelector('#btn-open-add-master')?.addEventListener('click', () => openModal());
    container.querySelector('#btn-close-master-modal')?.addEventListener('click', closeModal);
    container.querySelector('#btn-cancel-master')?.addEventListener('click', closeModal);

    container.querySelector('#master-item-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = container.querySelector('#m-code').value.trim();
        const category = container.querySelector('#m-category').value;
        const name = container.querySelector('#m-name').value.trim();
        const spec = container.querySelector('#m-spec').value.trim();
        const supplier = container.querySelector('#m-supplier').value.trim();
        const unit = container.querySelector('#m-unit').value.trim() || 'EA';
        const safety = Number(container.querySelector('#m-safety').value) || 0;

        await saveMasterItem({ code, category, name, spec, supplier, unit, safety });
        showToast(`✅ [${code}] ${name} 마스터 품목 저장 완료!`);
        closeModal();
        renderTable();
    });

    container.querySelector('#master-filter-category')?.addEventListener('change', renderTable);
    container.querySelector('#master-search-input')?.addEventListener('input', renderTable);

    // 엑셀 다운로드
    container.querySelector('#btn-export-master-excel')?.addEventListener('click', () => {
        const ws = XLSX.utils.json_to_sheet(state.master.map(m => ({
            "품목코드": m.code,
            "분류": m.category,
            "품목명": m.name,
            "규격": m.spec,
            "거래처": m.supplier,
            "단위": m.unit,
            "안전재고": m.safety
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "품목마스터");
        XLSX.writeFile(wb, `WMS_품목마스터_${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('📥 엑셀 파일이 다운로드되었습니다.');
    });

    renderTable();
};
