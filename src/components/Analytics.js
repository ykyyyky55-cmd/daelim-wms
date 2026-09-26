import { state, getGimpoSyncStatistics, syncAllUnsyncedGimpoLogs } from '../services/db.js';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';

let prodTrendChartInstance = null;
let topProdChartInstance = null;

export const renderAnalytics = (container) => {
    const logs = state.gimpoLogs || [];
    const syncStats = getGimpoSyncStatistics();

    // 1. 가용한 연월 목록 추출 (예: 2026-09, 2026-08)
    const availableMonths = Array.from(new Set(
        logs.map(l => l.date ? l.date.slice(0, 7) : '').filter(Boolean)
    )).sort().reverse();

    let selectedMonth = availableMonths[0] || '2026-09';
    let selectedCategoryFilter = 'ALL';

    const renderView = () => {
        // 선택된 월의 일지 필터링
        const filteredLogs = selectedMonth === 'ALL'
            ? logs
            : logs.filter(l => l.date && l.date.startsWith(selectedMonth));

        // 월간 통계 합산
        let totalPackagingQty = 0;
        let totalPackagingItems = 0;
        let totalOilQty = 0;
        let totalOilBatches = 0;
        let totalMovementCount = 0;
        let totalMovementQty = 0;
        let totalReceivingCount = 0;
        let totalShippingCount = 0;
        let monthSyncedDays = 0;

        const productQtyMap = {}; // 품목별 포장 실적 합계

        filteredLogs.forEach(log => {
            if (log.isSyncedToLedger) monthSyncedDays++;

            (log.packaging || []).forEach(p => {
                const q = Number(p.qty) || 0;
                totalPackagingQty += q;
                if (q > 0) totalPackagingItems++;
                if (p.item && q > 0) {
                    productQtyMap[p.item] = (productQtyMap[p.item] || 0) + q;
                }
            });

            (log.oilBlending || []).forEach(o => {
                const q = Number(o.qty) || 0;
                totalOilQty += q;
                if (q > 0) totalOilBatches++;
            });

            (log.movement || []).forEach(m => {
                totalMovementCount++;
                totalMovementQty += (Number(m.qty) || 0);
            });

            totalReceivingCount += (log.receiving || []).length;
            totalShippingCount += (log.shipping || []).length;
        });

        const syncPercent = filteredLogs.length > 0 
            ? Math.round((monthSyncedDays / filteredLogs.length) * 100) 
            : 0;

        container.innerHTML = `
        <section id="tab-content-analytics" class="space-y-6">
            <!-- 1. 헤더 및 월간 필터 컨트롤 바 -->
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 no-print">
                <div class="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
                                <i data-lucide="factory" class="w-3 h-3 text-blue-600"></i>
                                김포공장 생산공급망 업무일지 연동 실적
                            </span>
                            <span class="text-xs text-slate-500 font-medium">실시간 재고·수불부 통합 반영 현황</span>
                        </div>
                        <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2">
                            <i data-lucide="bar-chart-3" class="w-5 h-5 text-emerald-600"></i>
                            <span>월간 생산공급망 실적 현황판 & 분석</span>
                        </h2>
                    </div>

                    <!-- 우측 액션 버튼 및 필터 -->
                    <div class="flex flex-wrap items-center gap-2">
                        <!-- 월 선택 드롭다운 -->
                        <div class="flex items-center bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 shadow-xs text-xs">
                            <i data-lucide="calendar" class="w-3.5 h-3.5 text-blue-600 mr-2"></i>
                            <span class="text-slate-500 font-bold mr-1">분석 월:</span>
                            <select id="analytics-month-select" class="bg-transparent border-none text-xs font-black text-slate-800 focus:outline-none cursor-pointer">
                                <option value="ALL" ${selectedMonth === 'ALL' ? 'selected' : ''}>전체 누적 기간</option>
                                ${availableMonths.map(m => `
                                    <option value="${esc(m)}" ${selectedMonth === m ? 'selected' : ''}>
                                        ${esc(m.replace('-', '년 '))}월 (${logs.filter(l => l.date?.startsWith(m)).length}일치)
                                    </option>
                                `).join('')}
                            </select>
                        </div>

                        <!-- 엑셀 다운로드 버튼 -->
                        <button type="button" id="btn-export-analytics-excel" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                            <i data-lucide="file-spreadsheet" class="w-4 h-4 text-emerald-200"></i>
                            <span>월간 실적 엑셀 다운로드</span>
                        </button>

                        <!-- 수불부 동기화 바로가기 버튼 -->
                        <button type="button" id="btn-sync-all-unsynced" class="px-3.5 py-2 ${syncStats.unsyncedDays > 0 ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white animate-pulse' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                            <span>수불부 미반영 동기화 (${syncStats.unsyncedDays}일 남음)</span>
                        </button>
                    </div>
                </div>

                <!-- 수불부 반영 상태 알림 배너 -->
                <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full ${syncStats.unsyncedDays === 0 ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
                        <span class="font-bold text-slate-700">
                            수불부 반영 현황: 전체 ${syncStats.totalDays}일치 일지 중 <b class="text-emerald-600">${syncStats.syncedDays}일치</b> 반영완료, 
                            <b class="${syncStats.unsyncedDays > 0 ? 'text-amber-600' : 'text-slate-500'}">${syncStats.unsyncedDays}일치</b> 미반영
                        </span>
                    </div>
                    <div class="text-[11px] text-slate-500">
                        ※ 미반영 일지는 수불부(자재수불원장)에 입출고 트랜잭션이 아직 기록되지 않은 상태입니다.
                    </div>
                </div>
            </div>

            <!-- 2. 핵심 KPI 실적 지표 카드 4종 -->
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <!-- KPI 1: 완제품 포장 실적 -->
                <div class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-slate-500">완제품 포장생산 실적</span>
                        <div class="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                            <i data-lucide="package-check" class="w-4 h-4"></i>
                        </div>
                    </div>
                    <div class="flex items-baseline gap-1.5">
                        <span class="text-2xl sm:text-3xl font-black text-slate-900 font-mono">${totalPackagingQty.toLocaleString()}</span>
                        <span class="text-xs font-bold text-slate-500">EA</span>
                    </div>
                    <div class="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                        <span>생산 품목 수</span>
                        <span class="font-bold text-blue-700">${totalPackagingItems}건</span>
                    </div>
                </div>

                <!-- KPI 2: 원액 블렌딩 실적 -->
                <div class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-slate-500">원액 블렌딩 생산 실적</span>
                        <div class="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                            <i data-lucide="flask-conical" class="w-4 h-4"></i>
                        </div>
                    </div>
                    <div class="flex items-baseline gap-1.5">
                        <span class="text-2xl sm:text-3xl font-black text-slate-900 font-mono">${totalOilQty.toLocaleString()}</span>
                        <span class="text-xs font-bold text-slate-500">L</span>
                    </div>
                    <div class="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                        <span>블렌딩 배치(BT) 수</span>
                        <span class="font-bold text-amber-700">${totalOilBatches}회</span>
                    </div>
                </div>

                <!-- KPI 3: 본사 거점 이동(셔틀) -->
                <div class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-slate-500">본사·방산 거점이동 셔틀</span>
                        <div class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                            <i data-lucide="truck" class="w-4 h-4"></i>
                        </div>
                    </div>
                    <div class="flex items-baseline gap-1.5">
                        <span class="text-2xl sm:text-3xl font-black text-slate-900 font-mono">${totalMovementCount}</span>
                        <span class="text-xs font-bold text-slate-500">건 이송</span>
                    </div>
                    <div class="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                        <span>총 이송 제품 수량</span>
                        <span class="font-bold text-indigo-700">${totalMovementQty.toLocaleString()} EA</span>
                    </div>
                </div>

                <!-- KPI 4: 수불부 반영율 -->
                <div class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-slate-500">당월 수불부 반영률</span>
                        <div class="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <i data-lucide="book-check" class="w-4 h-4"></i>
                        </div>
                    </div>
                    <div class="flex items-baseline gap-1.5">
                        <span class="text-2xl sm:text-3xl font-black text-emerald-600 font-mono">${syncPercent}%</span>
                        <span class="text-xs font-bold text-slate-500">(${monthSyncedDays}/${filteredLogs.length}일)</span>
                    </div>
                    <div class="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                        <span>입고: ${totalReceivingCount}건 / 출고: ${totalShippingCount}건</span>
                        <span class="font-bold text-emerald-700">동기화 관리</span>
                    </div>
                </div>
            </div>

            <!-- 3. 실적 시각화 차트 그리드 -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <!-- 일자별 생산 실적 추이 차트 (8 cols) -->
                <div class="lg:col-span-8 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                    <div class="flex items-center justify-between border-b pb-2">
                        <h3 class="text-xs font-black text-slate-800 flex items-center gap-1.5">
                            <i data-lucide="trending-up" class="w-4 h-4 text-blue-600"></i>
                            <span>일자별 생산 실적 추이 (완제품 포장 EA vs 원액 생산 L)</span>
                        </h3>
                        <span class="text-[11px] font-bold text-slate-400 font-mono">${selectedMonth} 실적</span>
                    </div>
                    <div class="h-64 sm:h-72">
                        <canvas id="chart-prod-trend"></canvas>
                    </div>
                </div>

                <!-- 주요 완제품 포장 실적 TOP 5 도넛 차트 (4 cols) -->
                <div class="lg:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3 flex flex-col">
                    <div class="flex items-center justify-between border-b pb-2">
                        <h3 class="text-xs font-black text-slate-800 flex items-center gap-1.5">
                            <i data-lucide="pie-chart" class="w-4 h-4 text-emerald-600"></i>
                            <span>완제품 포장생산 TOP 5 품목 점유율</span>
                        </h3>
                    </div>
                    <div class="h-64 sm:h-72 flex-1 flex items-center justify-center">
                        <canvas id="chart-top-prod"></canvas>
                    </div>
                </div>
            </div>

            <!-- 4. 일자별 생산공급망 실적 종합 원장 테이블 -->
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                    <div>
                        <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                            <i data-lucide="table" class="w-4 h-4 text-blue-600"></i>
                            <span>일자별 생산공급망 상세 실적 원장 (${filteredLogs.length}일치)</span>
                        </h3>
                        <p class="text-xs text-slate-500 mt-0.5">각 일자를 클릭하면 해당 일자의 상세 업무일지 작성 및 편집 화면으로 즉시 이동합니다.</p>
                    </div>
                </div>

                <div class="overflow-auto rounded-xl border border-slate-200 max-h-[65vh]">
                    <table class="w-full text-xs text-left border-collapse">
                        <thead class="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 sticky top-0 z-10">
                            <tr>
                                <th class="p-3 text-center w-24">작업 일자</th>
                                <th class="p-3 text-center w-20">담당자</th>
                                <th class="p-3 text-center w-36">완제품 포장실적</th>
                                <th class="p-3 text-center w-36">원액 블렌딩실적</th>
                                <th class="p-3 text-center w-28">본사 거점이동</th>
                                <th class="p-3 text-center w-28">원부자재 입출고</th>
                                <th class="p-3 text-center w-28">수불부 반영</th>
                                <th class="p-3 text-center w-20">상세이동</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${filteredLogs.length === 0 ? `
                                <tr>
                                    <td colspan="8" class="p-8 text-center text-slate-400 font-bold">
                                        선택된 기간에 해당하는 생산공급망 업무일지가 없습니다.
                                    </td>
                                </tr>
                            ` : filteredLogs.map(log => {
                                const packQty = (log.packaging || []).reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
                                const packItems = (log.packaging || []).filter(i => (Number(i.qty) || 0) > 0);
                                const packTopItem = packItems[0]?.item || '-';
                                
                                const oilQty = (log.oilBlending || []).reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
                                const oilItems = (log.oilBlending || []).filter(i => (Number(i.qty) || 0) > 0);
                                const oilTopItem = oilItems[0]?.item || '-';

                                const moveCount = (log.movement || []).length;
                                const recCount = (log.receiving || []).length;
                                const shipCount = (log.shipping || []).length;

                                const isSynced = !!log.isSyncedToLedger;

                                return `
                                <tr class="hover:bg-blue-50/50 cursor-pointer transition group" data-log-date="${esc(log.date)}">
                                    <td class="p-3 text-center font-mono font-bold text-slate-900 group-hover:text-blue-600">
                                        ${esc(log.date)}
                                    </td>
                                    <td class="p-3 text-center font-bold text-slate-700">
                                        ${esc(log.manager || '최용화')}
                                    </td>
                                    <td class="p-3 text-right">
                                        <div class="font-mono font-black text-blue-700">${packQty.toLocaleString()} EA</div>
                                        <div class="text-[10px] text-slate-400 truncate max-w-[130px]" title="${esc(packTopItem)}">${packItems.length > 1 ? `${esc(packTopItem)} 외 ${packItems.length - 1}건` : esc(packTopItem)}</div>
                                    </td>
                                    <td class="p-3 text-right">
                                        <div class="font-mono font-black text-amber-700">${oilQty.toLocaleString()} L</div>
                                        <div class="text-[10px] text-slate-400 truncate max-w-[130px]" title="${esc(oilTopItem)}">${oilItems.length > 1 ? `${esc(oilTopItem)} 외 ${oilItems.length - 1}건` : esc(oilTopItem)}</div>
                                    </td>
                                    <td class="p-3 text-center">
                                        <span class="px-2 py-0.5 rounded-md font-bold ${moveCount > 0 ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-400'}">
                                            ${moveCount > 0 ? `${moveCount}건 이송` : '-'}
                                        </span>
                                    </td>
                                    <td class="p-3 text-center text-[11px] text-slate-600">
                                        입고 <b class="text-emerald-600">${recCount}</b> / 출고 <b class="text-rose-600">${shipCount}</b>
                                    </td>
                                    <td class="p-3 text-center">
                                        <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${isSynced ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'}">
                                            ${isSynced ? '✅ 반영완료' : '⚠️ 미반영'}
                                        </span>
                                    </td>
                                    <td class="p-3 text-center">
                                        <button type="button" class="btn-jump-log px-2.5 py-1 bg-slate-100 hover:bg-blue-600 hover:text-white rounded-lg text-slate-700 font-bold transition text-[11px]" data-date="${esc(log.date)}">
                                            일지보기 &rarr;
                                        </button>
                                    </td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
        `;

        createIcons({ icons });

        // 이벤트 바인딩: 월 변경
        container.querySelector('#analytics-month-select')?.addEventListener('change', (e) => {
            selectedMonth = e.target.value;
            renderView();
        });

        // 이벤트 바인딩: 수불부 미반영 전체 일괄 동기화
        container.querySelector('#btn-sync-all-unsynced')?.addEventListener('click', async () => {
            if (syncStats.unsyncedDays === 0) {
                alert('이미 모든 생산공급망 일지가 수불부에 반영되어 있습니다.');
                return;
            }
            if (confirm(`수불부에 미반영된 ${syncStats.unsyncedDays}일치 생산공급망 업무일지를 WMS 재고 및 수불부에 일괄 반영하시겠습니까?`)) {
                try {
                    const res = await syncAllUnsyncedGimpoLogs();
                    alert(res.message);
                    renderView();
                } catch (err) {
                    alert('동기화 중 오류가 발생했습니다: ' + err.message);
                }
            }
        });

        // 이벤트 바인딩: 엑셀 다운로드
        container.querySelector('#btn-export-analytics-excel')?.addEventListener('click', () => {
            const excelData = filteredLogs.map(log => {
                const packQty = (log.packaging || []).reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
                const oilQty = (log.oilBlending || []).reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
                const moveCount = (log.movement || []).length;
                const recCount = (log.receiving || []).length;
                const shipCount = (log.shipping || []).length;
                return {
                    '일자': log.date,
                    '담당자': log.manager || '최용화',
                    '완제품 포장실적(EA)': packQty,
                    '원액 블렌딩실적(L)': oilQty,
                    '본사 거점이동 건수': moveCount,
                    '원부자재 입고건수': recCount,
                    '고객사 출고건수': shipCount,
                    '수불부 반영여부': log.isSyncedToLedger ? '반영완료' : '미반영'
                };
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(excelData);
            XLSX.utils.book_append_sheet(wb, ws, "월간생산공급망실적");
            XLSX.writeFile(wb, `대림오일_월간생산공급망실적_${selectedMonth}.xlsx`);
        });

        // 이벤트 바인딩: 일지 행 클릭 -> 생산일지 탭으로 점프
        const jumpToLog = (date) => {
            if (!date) return;
            window.__gimpoInitialDate = date;
            if (window.__switchTab) {
                window.__switchTab('gimpoLog');
            }
        };

        container.querySelectorAll('.btn-jump-log').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                jumpToLog(btn.getAttribute('data-date'));
            });
        });

        container.querySelectorAll('tr[data-log-date]').forEach(row => {
            row.addEventListener('click', () => {
                jumpToLog(row.getAttribute('data-log-date'));
            });
        });

        // 차트 렌더링
        renderCharts(filteredLogs, productQtyMap);
    };

    const renderCharts = (filteredLogs, productQtyMap) => {
        // 기존 인스턴스 파괴
        if (prodTrendChartInstance) prodTrendChartInstance.destroy();
        if (topProdChartInstance) topProdChartInstance.destroy();

        // 1. 일자별 생산 실적 추이 바 차트 (오름차순 정렬)
        const sortedLogs = [...filteredLogs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        const labels = sortedLogs.map(l => l.date ? l.date.slice(5) : '');
        const packData = sortedLogs.map(l => (l.packaging || []).reduce((s, i) => s + (Number(i.qty) || 0), 0));
        const oilData = sortedLogs.map(l => (l.oilBlending || []).reduce((s, i) => s + (Number(i.qty) || 0), 0));

        const ctxTrend = container.querySelector('#chart-prod-trend');
        if (ctxTrend) {
            prodTrendChartInstance = new Chart(ctxTrend, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: '완제품 포장 (EA)',
                            data: packData,
                            backgroundColor: '#3b82f6',
                            borderRadius: 4
                        },
                        {
                            label: '원액 블렌딩 (L)',
                            data: oilData,
                            backgroundColor: '#f59e0b',
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'top', labels: { font: { family: 'Noto Sans KR', size: 11, weight: 'bold' } } }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                        y: { ticks: { font: { size: 10 } } }
                    }
                }
            });
        }

        // 2. 완제품 포장생산 TOP 5 도넛 차트
        const sortedProducts = Object.entries(productQtyMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const ctxTop = container.querySelector('#chart-top-prod');
        if (ctxTop) {
            topProdChartInstance = new Chart(ctxTop, {
                type: 'doughnut',
                data: {
                    labels: sortedProducts.map(p => p[0]),
                    datasets: [{
                        data: sortedProducts.map(p => p[1]),
                        backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { 
                            position: 'bottom', 
                            labels: { 
                                font: { family: 'Noto Sans KR', size: 10, weight: 'bold' },
                                boxWidth: 12
                            } 
                        }
                    }
                }
            });
        }
    };

    renderView();
};
