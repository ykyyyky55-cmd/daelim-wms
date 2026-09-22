import { state, commitStockAudit } from '../services/db.js';
import { createIcons, icons } from 'lucide';
import { matchesQuery } from '../services/searchUtils.js';

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
                    <p class="text-xs text-slate-500 mt-1">실사 일자를 등록하고, 현장 실사 수량을 입력하여 전산 재고와의 오차를 산출하고 일괄 반영합니다.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-open-audit-hist-modal" class="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="history" class="w-4 h-4 text-teal-400"></i>
                        <span>일자별 실사 이력 달력 조회</span>
                    </button>
                    <button type="button" id="btn-commit-audit" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-black rounded-xl transition flex items-center gap-1.5 shadow-md">
                        <i data-lucide="save" class="w-4 h-4"></i>
                        <span>실사 오차 전산 일괄 반영</span>
                    </button>
                </div>
            </div>

            <!-- 실사 설정 & 필터 바 (실사 일자 등록 + 부분문자 검색) -->
            <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div class="flex flex-wrap items-center gap-3">
                    <div class="flex items-center gap-1.5 bg-white px-2.5 py-1.5 border border-slate-300 rounded-lg shadow-2xs">
                        <i data-lucide="calendar" class="w-4 h-4 text-teal-600"></i>
                        <span class="text-xs font-bold text-slate-700">실사 등록 일자:</span>
                        <input type="date" id="audit-reg-date" value="${new Date().toISOString().slice(0, 10)}" class="text-xs font-bold text-slate-900 bg-transparent focus:outline-none" />
                    </div>

                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-bold text-slate-600">실사 거점:</span>
                        <select id="audit-filter-loc" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                            <option value="">전체 거점</option>
                            ${state.locations.map(l => `<option value="${l}">${l}</option>`).join('')}
                        </select>
                    </div>

                    <label class="flex items-center gap-1.5 cursor-pointer bg-white px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 shadow-2xs">
                        <input type="checkbox" id="audit-filter-diff-only" class="rounded text-teal-600 focus:ring-teal-500" />
                        <span class="text-teal-700">오차/수정 품목만 보기</span>
                    </label>
                </div>

                <div class="relative">
                    <input type="text" id="audit-search-input" placeholder="품목코드, 품명, 규격 검색 (일부문자 인식)..." class="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-teal-500 focus:outline-none w-72" />
                    <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2"></i>
                </div>
            </div>

            <!-- 실사 테이블 -->
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 text-slate-600 border-b border-slate-200 font-bold">
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

        <!-- 일자별 실사 이력 조회 달력 모달 -->
        <div id="modal-audit-history" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
            <div class="bg-white max-w-3xl w-full rounded-2xl shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[85vh]">
                <div class="px-5 py-4 bg-slate-900 text-white flex justify-between items-center flex-shrink-0">
                    <div class="flex items-center gap-2">
                        <i data-lucide="history" class="w-5 h-5 text-teal-400"></i>
                        <h3 class="font-bold text-sm">일자별 실사 이력 & 전산 오차 감사 로그</h3>
                    </div>
                    <button type="button" id="btn-close-audit-hist" class="text-slate-400 hover:text-white text-xl">&times;</button>
                </div>

                <div class="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs flex-shrink-0">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-slate-700">조회 일자 선택:</span>
                        <input type="date" id="audit-hist-date-picker" value="${new Date().toISOString().slice(0, 10)}" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-900" />
                        <button type="button" id="btn-audit-hist-search" class="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold">조회</button>
                    </div>
                    <span id="audit-hist-count-badge" class="font-bold text-slate-500">총 0건의 실사 기록</span>
                </div>

                <div class="p-4 overflow-y-auto flex-1">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-100 text-slate-700 font-bold sticky top-0">
                            <tr>
                                <th class="p-2.5">일시</th>
                                <th class="p-2.5">거점</th>
                                <th class="p-2.5">품목코드</th>
                                <th class="p-2.5">품목명</th>
                                <th class="p-2.5 text-right">실사반영수량</th>
                                <th class="p-2.5">작업자</th>
                                <th class="p-2.5">오차 및 사유</th>
                            </tr>
                        </thead>
                        <tbody id="audit-hist-table-body" class="divide-y divide-slate-100"></tbody>
                    </table>
                </div>
            </div>
        </div>
    </section>
    `;

    const renderTable = () => {
        const locFilter = container.querySelector('#audit-filter-loc').value;
        const diffOnly = container.querySelector('#audit-filter-diff-only').checked;
        const search = container.querySelector('#audit-search-input').value.trim();

        const items = state.inventory.filter(inv => {
            const masterItem = state.master.find(m => m.code === inv.code) || {};
            const matchesLoc = !locFilter || inv.location === locFilter;
            
            // 부분 문자 인식 검색
            const matchesSearch = !search || matchesQuery({
                ...inv,
                supplier: masterItem.supplier || '',
                spec: inv.spec || masterItem.spec || '',
                category: inv.category || masterItem.category || ''
            }, search, ['code', 'name', 'spec', 'supplier', 'location']);

            if (!matchesLoc || !matchesSearch) return false;

            const key = `${inv.code}___${inv.location}`;
            const actual = workingMap[key] !== undefined ? workingMap[key].actualQty : inv.quantity;
            const diff = actual - inv.quantity;

            if (diffOnly && diff === 0) return false;
            return true;
        });

        const tbody = container.querySelector('#audit-table-body');
        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 text-xs">실사 대상 품목이 없습니다. (검색 조건 또는 거점 필터를 확인하세요)</td></tr>`;
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

    // 일자별 실사 이력 렌더링
    const renderAuditHistory = () => {
        const dateVal = container.querySelector('#audit-hist-date-picker').value;
        const tbody = container.querySelector('#audit-hist-table-body');
        const badge = container.querySelector('#audit-hist-count-badge');

        const logs = state.history.filter(h => h.type === 'AUDIT' && (!dateVal || (h.timestamp && h.timestamp.includes(dateVal))));
        badge.textContent = `${dateVal || '전체'} 기준: 총 ${logs.length}건`;

        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 text-xs">${dateVal} 에 기록된 실사 이력이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map(l => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-2.5 font-mono text-[11px] text-slate-500">${l.timestamp}</td>
                <td class="p-2.5 font-bold text-slate-700">${l.fromLoc || '-'}</td>
                <td class="p-2.5 font-mono font-bold text-blue-600">${l.code}</td>
                <td class="p-2.5 font-bold text-slate-900">${l.name}</td>
                <td class="p-2.5 text-right font-black text-teal-700">${Number(l.qty).toLocaleString()} EA</td>
                <td class="p-2.5 font-bold text-slate-700">${l.worker || '-'}</td>
                <td class="p-2.5 text-slate-600">${l.reason || '-'}</td>
            </tr>
        `).join('');
    };

    const modalHist = container.querySelector('#modal-audit-history');
    container.querySelector('#btn-open-audit-hist-modal')?.addEventListener('click', () => {
        renderAuditHistory();
        modalHist.classList.remove('hidden');
    });
    container.querySelector('#btn-close-audit-hist')?.addEventListener('click', () => {
        modalHist.classList.add('hidden');
    });
    container.querySelector('#btn-audit-hist-search')?.addEventListener('click', renderAuditHistory);
    container.querySelector('#audit-hist-date-picker')?.addEventListener('change', renderAuditHistory);

    container.querySelector('#audit-filter-loc')?.addEventListener('change', renderTable);
    container.querySelector('#audit-filter-diff-only')?.addEventListener('change', renderTable);
    container.querySelector('#audit-search-input')?.addEventListener('input', renderTable);

    container.querySelector('#btn-commit-audit')?.addEventListener('click', async () => {
        const keys = Object.keys(workingMap);
        if (keys.length === 0) {
            alert('변경된 실사 수량이 없습니다.');
            return;
        }

        const auditDate = container.querySelector('#audit-reg-date').value;
        if (confirm(`실사 일자 [${auditDate}] 기준으로 수정된 ${keys.length}개 품목의 실사 수량을 전산 재고에 즉시 반영하시겠습니까?`)) {
            await commitStockAudit(workingMap, state.currentGlobalWorker, auditDate);
            showToast(`✅ [${auditDate}] ${keys.length}개 품목의 재고 실사가 클라우드에 성공적으로 반영되었습니다.`);
            renderTable();
            if (onRefresh) onRefresh();
        }
    });

    renderTable();
    createIcons({ icons });
};
