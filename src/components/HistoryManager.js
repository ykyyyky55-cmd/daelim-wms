import { state } from '../services/db.js';
import * as XLSX from 'xlsx';
import { matchesQuery, isDateInRange, localDateStr, toDateKey } from '../services/searchUtils.js';
import { createIcons, icons } from 'lucide';
import { createColumnFilter } from './ColumnFilter.js';
import { esc } from '../services/html.js';

const TYPE_KOREAN = { IN: '입고', OUT: '출고', USE: '생산투입', MOVE: '거점이동', AUDIT: '재고실사' };

// 일시("2026. 9. 24. 오후 6:12:46" 등)를 날짜(YYYY-MM-DD)로 묶어 필터 값으로 사용
const dateOf = (ts) => toDateKey(ts) || String(ts || '');

// 작업 이력 엑셀식 열 필터
const histColFilter = createColumnFilter('history', [
    { id: 'date', label: '일시(날짜)', value: h => dateOf(h.timestamp) },
    { id: 'type', label: '구분', value: h => TYPE_KOREAN[h.type] || h.type },
    { id: 'code', label: '품목코드', value: h => h.code },
    { id: 'name', label: '품목명', value: h => h.name },
    { id: 'qty', label: '수량', value: h => h.qty },
    { id: 'route', label: '출발 → 도착 거점', value: h => `${h.fromLoc} → ${h.toLoc}` },
    { id: 'worker', label: '작업자', value: h => h.worker },
    { id: 'reason', label: '사유 및 비고', value: h => h.reason }
]);

export const renderHistoryManager = (container, { showToast }) => {
    container.innerHTML = `
    <section id="tab-content-history" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="history" class="w-5 h-5 text-blue-600"></i>
                        <span>현장 작업 이력 & 전산 감사 로그</span>
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

            <!-- 필터 및 검색 바 (기간 달력 + 부분문자 인식 검색) -->
            <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                <div class="flex flex-wrap items-center gap-3">
                    <div class="flex items-center gap-1.5 bg-white px-2.5 py-1.5 border border-slate-300 rounded-lg shadow-2xs">
                        <span class="text-[11px] font-bold text-slate-500">기간:</span>
                        <input type="date" id="hist-date-from" class="text-xs font-bold text-slate-800 bg-transparent focus:outline-none" />
                        <span class="text-slate-400">~</span>
                        <input type="date" id="hist-date-to" class="text-xs font-bold text-slate-800 bg-transparent focus:outline-none" />
                    </div>

                    <div class="flex items-center gap-1.5">
                        <span class="font-bold text-slate-600">작업 구분:</span>
                        <select id="hist-filter-type" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                            <option value="">전체 작업 (${state.history.length})</option>
                            <option value="IN">입고 (+)</option>
                            <option value="OUT">출고 (-)</option>
                            <option value="USE">생산투입 (-)</option>
                            <option value="MOVE">거점 간 이동 (->)</option>
                            <option value="AUDIT">재고실사 보정</option>
                        </select>
                    </div>

                    <!-- 0000 임시코드 이력 모아보기 버튼 -->
                    <button type="button" id="btn-hist-filter-temp" class="px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-white text-slate-700 border-slate-300 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300">
                        <i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-amber-500"></i>
                        <span>임시코드(0000) 이력</span>
                        <span id="badge-hist-temp-count" class="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-amber-800 font-black">0</span>
                    </button>
                </div>

                <div class="relative">
                    <input type="text" id="hist-search-input" placeholder="작업자, 품목코드, 품명, 사유 검색 (일부문자 인식)..." class="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none w-72" />
                    <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2"></i>
                </div>
            </div>

            <!-- 이력 테이블 -->
            <div id="hist-colfilter-clear" class="flex justify-end"></div>
            <div class="overflow-auto max-h-[65vh]" id="hist-table-wrap">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 text-slate-600 border-b border-slate-200 font-bold sticky top-0 z-10">
                        <tr>
                            <th class="p-3" data-filter-col="date">일시</th>
                            <th class="p-3" data-filter-col="type">구분</th>
                            <th class="p-3" data-filter-col="code">품목코드</th>
                            <th class="p-3" data-filter-col="name">품목명</th>
                            <th class="p-3 text-right" data-filter-col="qty">수량</th>
                            <th class="p-3" data-filter-col="route">출발 &rarr; 도착 거점</th>
                            <th class="p-3" data-filter-col="worker">작업자</th>
                            <th class="p-3" data-filter-col="reason">사유 및 비고</th>
                        </tr>
                    </thead>
                    <tbody id="history-table-body" class="divide-y divide-slate-100"></tbody>
                </table>
            </div>
        </div>
    </section>
    `;

    let filterTempOnly = false;

    const updateHistTempBadge = () => {
        const tempCount = state.history.filter(h => h.code && h.code.startsWith('0000')).length;
        const badge = container.querySelector('#badge-hist-temp-count');
        if (badge) {
            badge.textContent = tempCount;
            if (tempCount > 0) {
                badge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-black animate-pulse';
            } else {
                badge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-600 font-bold';
            }
        }
    };

    const renderTable = () => {
        const typeFilter = container.querySelector('#hist-filter-type').value;
        const search = container.querySelector('#hist-search-input').value.trim();
        const dateFrom = container.querySelector('#hist-date-from').value;
        const dateTo = container.querySelector('#hist-date-to').value;

        const baseFiltered = state.history.filter(h => {
            const isTemp = h.code && h.code.startsWith('0000');
            if (filterTempOnly && !isTemp) return false;
            const matchesType = !typeFilter || h.type === typeFilter;
            const matchesDate = isDateInRange(h.timestamp, dateFrom, dateTo);
            const matchesSearch = !search || matchesQuery(h, search, ['worker', 'code', 'name', 'fromLoc', 'toLoc', 'reason']);
            return matchesType && matchesDate && matchesSearch;
        });
        // 엑셀식 열 필터
        const filtered = histColFilter.apply(baseFiltered);
        histColFilter.attach(container.querySelector('#hist-table-wrap'), () => baseFiltered, () => {
            renderTable();
            createIcons({ icons });
        }, { clearHost: container.querySelector('#hist-colfilter-clear') });

        updateHistTempBadge();

        const tbody = container.querySelector('#history-table-body');
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-400 text-xs">일치하는 작업 이력이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(h => {
            const isTemp = h.code && h.code.startsWith('0000');
            const typeBadge = {
                IN: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">입고</span>',
                OUT: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">출고</span>',
                USE: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800">생산투입</span>',
                MOVE: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">거점이동</span>',
                AUDIT: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800">재고실사</span>'
            }[h.type] || h.type;

            return `
            <tr class="hover:bg-slate-50 transition ${isTemp ? 'bg-amber-50/30' : ''}">
                <td class="p-3 font-mono text-slate-500">${esc(h.timestamp)}</td>
                <td class="p-3">${typeBadge}</td>
                <td class="p-3">
                    ${isTemp ? `
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-black bg-amber-100 text-amber-800 border border-amber-300">
                            <i data-lucide="alert-triangle" class="w-3 h-3 text-amber-600"></i>
                            ${esc(h.code)} <span class="text-[9px] bg-amber-500 text-white px-1 rounded">임시</span>
                        </span>
                    ` : `
                        <span class="font-mono font-bold text-blue-600">${esc(h.code)}</span>
                    `}
                </td>
                <td class="p-3 font-bold text-slate-900">${esc(h.name)}</td>
                <td class="p-3 text-right font-black text-blue-600">${esc(h.qty)} 개</td>
                <td class="p-3 text-slate-600">${esc(h.fromLoc)} &rarr; ${esc(h.toLoc)}</td>
                <td class="p-3 font-bold text-slate-700">${esc(h.worker)}</td>
                <td class="p-3 text-slate-500">${esc(h.reason || '-')}</td>
            </tr>
            `;
        }).join('');
    };

    const btnFilterTemp = container.querySelector('#btn-hist-filter-temp');
    btnFilterTemp?.addEventListener('click', () => {
        filterTempOnly = !filterTempOnly;
        if (filterTempOnly) {
            btnFilterTemp.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-amber-500 text-white border-amber-600 shadow-xs';
        } else {
            btnFilterTemp.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-white text-slate-700 border-slate-300 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300';
        }
        renderTable();
    });

    container.querySelector('#hist-filter-type')?.addEventListener('change', renderTable);
    container.querySelector('#hist-search-input')?.addEventListener('input', renderTable);
    container.querySelector('#hist-date-from')?.addEventListener('change', renderTable);
    container.querySelector('#hist-date-to')?.addEventListener('change', renderTable);

    container.querySelector('#btn-export-history-excel')?.addEventListener('click', () => {
        const dateFrom = container.querySelector('#hist-date-from').value;
        const dateTo = container.querySelector('#hist-date-to').value;
        const typeFilter = container.querySelector('#hist-filter-type').value;
        const search = container.querySelector('#hist-search-input').value.trim();

        const filtered = state.history.filter(h => {
            const matchesType = !typeFilter || h.type === typeFilter;
            const matchesDate = isDateInRange(h.timestamp, dateFrom, dateTo);
            const matchesSearch = !search || matchesQuery(h, search, ['worker', 'code', 'name', 'fromLoc', 'toLoc', 'reason']);
            return matchesType && matchesDate && matchesSearch;
        });

        const typeKoreanMap = { IN: '입고', OUT: '출고', USE: '생산투입', MOVE: '거점이동', AUDIT: '재고실사보정' };

        const ws = XLSX.utils.json_to_sheet(histColFilter.apply(filtered).map(h => ({ // 화면과 같게 열 필터 적용
            "일시": h.timestamp,
            "구분": typeKoreanMap[h.type] || h.type,
            "품목코드": h.code,
            "품목명": h.name,
            "수량(개)": h.qty,
            "출발거점": h.fromLoc,
            "도착거점": h.toLoc,
            "작업자": h.worker,
            "사유": h.reason
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "작업이력");
        const suffix = dateFrom || dateTo ? `_${dateFrom || '시작'}~${dateTo || '현재'}` : `_${localDateStr()}`;
        XLSX.writeFile(wb, `대림오일_작업이력${suffix}.xlsx`);
        showToast('📥 작업 이력 엑셀 파일이 다운로드되었습니다.');
    });

    renderTable();
};
