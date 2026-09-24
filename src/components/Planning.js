import { state, saveMasterItem } from '../services/db.js';
import { localDateStr, toDateKey } from '../services/searchUtils.js';
import Chart from 'chart.js/auto';

let chartInstance1 = null;
let chartInstance2 = null;
let currentViewMode = 'ALL';
let calculatedRows = [];

export const renderPlanning = (container, { showToast }) => {
    container.innerHTML = `
    <section id="tab-content-planning" class="space-y-6">
        <!-- 최상단 헤더 & 기간/기준 설정 바 -->
        <div class="bg-gradient-to-r from-slate-900 via-violet-950 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg border border-slate-800 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-violet-500/30 text-violet-300 border border-violet-400/30">지능형 자재소요량(MRP) 분석 엔진</span>
                        <span id="planning-analysis-period" class="text-xs text-slate-400 font-mono">물동 분석 기준</span>
                    </div>
                    <h2 class="text-xl sm:text-2xl font-black tracking-tight">자재 사용량·출고량 분석 & 발주·생산·안전재고 의사결정</h2>
                    <p class="text-xs text-slate-300">최근 실적(사용/출고/재고)을 기반으로 소진 예상 일수를 예측하고, 부족 품목에 대한 권장 발주량·생산량·안전재고 적정치를 산출합니다.</p>
                </div>
                <div class="flex items-center flex-wrap gap-2">
                    <button type="button" id="btn-export-mrp-csv" class="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/20">
                        <i data-lucide="file-spreadsheet" class="w-4 h-4 text-emerald-400"></i>
                        <span>검토 보고서 CSV 다운로드</span>
                    </button>
                    <button type="button" onclick="window.print()" class="px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-violet-600/30">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>A4 검토서 인쇄</span>
                    </button>
                </div>
            </div>

            <!-- 핵심 의사결정 지표 요약 (KPI) -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition">
                    <div class="flex items-center justify-between text-slate-400 text-[11px] font-bold">
                        <span>긴급 발주 필요 (원부자재)</span>
                        <i data-lucide="shopping-cart" class="w-4 h-4 text-amber-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span id="mrp-kpi-order-count" class="text-2xl font-black text-amber-400">0</span>
                        <span class="text-xs text-slate-400">개 품목</span>
                    </div>
                    <span id="mrp-kpi-order-qty" class="text-[11px] text-amber-200 mt-1 block font-mono">총 0개 발주 권장</span>
                </div>

                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition">
                    <div class="flex items-center justify-between text-slate-400 text-[11px] font-bold">
                        <span>생산 검토 대상 (완제품)</span>
                        <i data-lucide="hammer" class="w-4 h-4 text-blue-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span id="mrp-kpi-prod-count" class="text-2xl font-black text-blue-400">0</span>
                        <span class="text-xs text-slate-400">개 품목</span>
                    </div>
                    <span id="mrp-kpi-prod-qty" class="text-[11px] text-blue-200 mt-1 block font-mono">총 0세트 생산 권장</span>
                </div>

                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition">
                    <div class="flex items-center justify-between text-slate-400 text-[11px] font-bold">
                        <span>7일 이내 결품 위험</span>
                        <i data-lucide="alert-octagon" class="w-4 h-4 text-rose-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span id="mrp-kpi-critical-count" class="text-2xl font-black text-rose-400">0</span>
                        <span class="text-xs text-rose-300 font-bold">건 임계상태</span>
                    </div>
                    <span class="text-[11px] text-rose-300/80 mt-1 block">현재고 / 일평균 사용량 기준</span>
                </div>

                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition">
                    <div class="flex items-center justify-between text-slate-400 text-[11px] font-bold">
                        <span>안전재고 기준 조정 권고</span>
                        <i data-lucide="shield-alert" class="w-4 h-4 text-emerald-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span id="mrp-kpi-safety-adjust-count" class="text-2xl font-black text-emerald-400">0</span>
                        <span class="text-xs text-slate-400">개 품목</span>
                    </div>
                    <span class="text-[11px] text-emerald-300/80 mt-1 block">실제 물동량 대비 과소/과대</span>
                </div>
            </div>

            <!-- 분석 파라미터 제어 바 -->
            <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 pt-2 text-xs">
                <div>
                    <label class="block text-[10px] text-slate-400 mb-1 font-bold">분석 대상 연도</label>
                    <select id="mrp-select-year" class="w-full px-2.5 py-1.5 bg-white/10 border border-white/20 rounded-xl text-white font-bold focus:bg-slate-900">
                        <option value="2026" class="text-slate-900" selected>2026년</option>
                        <option value="2025" class="text-slate-900">2025년</option>
                    </select>
                </div>
                <div>
                    <label class="block text-[10px] text-slate-400 mb-1 font-bold">분석 대상 월</label>
                    <select id="mrp-select-month" class="w-full px-2.5 py-1.5 bg-white/10 border border-white/20 rounded-xl text-white font-bold focus:bg-slate-900">
                        ${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" class="text-slate-900" ${i + 1 === (new Date().getMonth() + 1) ? 'selected' : ''}>${i + 1}월</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="block text-[10px] text-slate-400 mb-1 font-bold">발주 조달 리드타임</label>
                    <select id="mrp-lead-time" class="w-full px-2.5 py-1.5 bg-white/10 border border-white/20 rounded-xl text-white font-bold focus:bg-slate-900">
                        <option value="7" class="text-slate-900">7일 (단기 조달)</option>
                        <option value="14" class="text-slate-900" selected>14일 (표준 조달)</option>
                        <option value="21" class="text-slate-900">21일 (3주 조달)</option>
                        <option value="30" class="text-slate-900">30일 (해외/장기)</option>
                    </select>
                </div>
                <div>
                    <label class="block text-[10px] text-slate-400 mb-1 font-bold">목표 재고 일수</label>
                    <select id="mrp-target-days" class="w-full px-2.5 py-1.5 bg-white/10 border border-white/20 rounded-xl text-white font-bold focus:bg-slate-900">
                        <option value="15" class="text-slate-900">15일분 재고 유지</option>
                        <option value="30" class="text-slate-900" selected>30일분 (한 달분 권장)</option>
                        <option value="45" class="text-slate-900">45일분 재고 유지</option>
                        <option value="60" class="text-slate-900">60일분 (여유 재고)</option>
                    </select>
                </div>
                <div>
                    <label class="block text-[10px] text-slate-400 mb-1 font-bold">보관 거점 필터</label>
                    <select id="mrp-filter-location" class="w-full px-2.5 py-1.5 bg-white/10 border border-white/20 rounded-xl text-white font-bold focus:bg-slate-900">
                        <option value="" class="text-slate-900">전체 거점 기준</option>
                        ${state.locations.map(l => `<option value="${l}" class="text-slate-900">${l}</option>`).join('')}
                    </select>
                </div>
                <div class="flex items-end">
                    <button type="button" id="btn-recalculate-mrp" class="w-full py-1.5 px-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-bold transition flex items-center justify-center gap-1 shadow-xs">
                        <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
                        <span>재계산</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- 검토 모드 탭 버튼 그룹 -->
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex rounded-xl border border-slate-300 p-1 bg-white shadow-xs text-xs">
                <button type="button" id="mrp-mode-ALL" class="mrp-tab-btn px-3 py-1.5 rounded-lg font-bold bg-violet-600 text-white shadow-xs transition">
                    🔍 전체 종합 분석
                </button>
                <button type="button" id="mrp-mode-ORDER" class="mrp-tab-btn px-3 py-1.5 rounded-lg font-bold text-slate-600 hover:text-amber-700 hover:bg-amber-50 transition flex items-center gap-1">
                    <span class="w-2 h-2 rounded-full bg-amber-500"></span>
                    <span>🛒 원부자재 발주 검토</span>
                    <span id="badge-mrp-order-need" class="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 text-[10px] font-black">0</span>
                </button>
                <button type="button" id="mrp-mode-PRODUCTION" class="mrp-tab-btn px-3 py-1.5 rounded-lg font-bold text-slate-600 hover:text-blue-700 hover:bg-blue-50 transition flex items-center gap-1">
                    <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span>🏭 완제품 생산 검토</span>
                    <span id="badge-mrp-prod-need" class="px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 text-[10px] font-black">0</span>
                </button>
                <button type="button" id="mrp-mode-SAFETY" class="mrp-tab-btn px-3 py-1.5 rounded-lg font-bold text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 transition flex items-center gap-1">
                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>🛡️ 안전재고 적정성 진단</span>
                    <span id="badge-mrp-safety-need" class="px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black">0</span>
                </button>
            </div>

            <div class="flex items-center gap-2">
                <input type="text" id="mrp-search-input" placeholder="품목명, 코드 빠른 검색..." 
                    class="px-3 py-1.5 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 w-56 sm:w-64 bg-white">
                <button type="button" id="btn-apply-all-safety" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-xs" title="산출된 권장 안전재고치를 마스터 기준정보에 일괄 반영">
                    <i data-lucide="check-check" class="w-3.5 h-3.5"></i>
                    <span>권장 안전재고 일괄적용</span>
                </button>
            </div>
        </div>

        <!-- 시각화 차트 2종 -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div class="lg:col-span-6 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="flex items-center justify-between pb-2 border-b border-slate-100">
                    <div class="flex items-center gap-2">
                        <i data-lucide="bar-chart-2" class="w-4 h-4 text-violet-600"></i>
                        <h4 class="text-sm font-bold text-slate-900">당월 품목별 사용량 & 출고량 실적 비교 (TOP 7)</h4>
                    </div>
                    <span class="text-[10px] text-slate-400">단위: EA / 상위 품목</span>
                </div>
                <div class="h-60 relative">
                    <canvas id="mrp-chart-consumption-shipment"></canvas>
                </div>
            </div>

            <div class="lg:col-span-6 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="flex items-center justify-between pb-2 border-b border-slate-100">
                    <div class="flex items-center gap-2">
                        <i data-lucide="hourglass" class="w-4 h-4 text-rose-500"></i>
                        <h4 class="text-sm font-bold text-slate-900">현재고 소진 예상 일수 (Runout Days)</h4>
                    </div>
                    <span class="text-[10px] text-slate-400">7일 미만: 위험 / 14일 미만: 경고</span>
                </div>
                <div class="h-60 relative">
                    <canvas id="mrp-chart-runout-days"></canvas>
                </div>
            </div>
        </div>

        <!-- 메인 MRP 검토 명세서 테이블 -->
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                    <div class="flex items-center gap-2">
                        <h4 class="font-bold text-sm text-slate-900">종합 발주·생산·안전재고 검토 명세서</h4>
                        <span id="mrp-table-row-count-badge" class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">총 0개 품목</span>
                    </div>
                    <p class="text-[11px] text-slate-500 mt-0.5">일평균 소진속도(사용+출고)를 기반으로 발주 시점과 생산 필요 시점을 조기 감지합니다.</p>
                </div>

                <div class="flex items-center gap-2 text-xs">
                    <span class="text-[11px] text-slate-500 font-semibold">범례:</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">🚨 결품 위험</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">🛒 발주 권장</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">🏭 생산 권장</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">✅ 적정 재고</span>
                </div>
            </div>

            <div class="overflow-x-auto rounded-xl border border-slate-200">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-50 text-slate-700 border-b border-slate-200">
                        <tr>
                            <th class="py-2.5 px-3 font-semibold">분류</th>
                            <th class="py-2.5 px-3 font-semibold">품목코드</th>
                            <th class="py-2.5 px-3 font-semibold">품목명 / 규격</th>
                            <th class="py-2.5 px-3 font-semibold text-right bg-blue-50/50">현재고</th>
                            <th class="py-2.5 px-3 font-semibold text-right text-blue-700">월간 사용량(-)</th>
                            <th class="py-2.5 px-3 font-semibold text-right text-purple-700">월간 출고량(-)</th>
                            <th class="py-2.5 px-3 font-semibold text-right font-mono">일평균 소진량</th>
                            <th class="py-2.5 px-3 font-semibold text-center">소진 예상일</th>
                            <th class="py-2.5 px-3 font-semibold text-right">현재 안전재고</th>
                            <th class="py-2.5 px-3 font-semibold text-right text-emerald-700 bg-emerald-50/40">권장 안전재고</th>
                            <th class="py-2.5 px-3 font-semibold text-center font-black bg-violet-50 text-violet-950">검토 판정</th>
                            <th class="py-2.5 px-3 font-semibold text-right font-black bg-amber-50 text-amber-950">권장 조치수량</th>
                            <th class="py-2.5 px-3 font-semibold text-center no-print">반영</th>
                        </tr>
                    </thead>
                    <tbody id="mrp-table-tbody" class="divide-y divide-slate-100 text-slate-700"></tbody>
                    <tfoot id="mrp-table-tfoot" class="bg-slate-50 font-bold text-slate-900 border-t-2 border-slate-300"></tfoot>
                </table>
            </div>
        </div>
    </section>
    `;

    const calculateMRP = () => {
        const y = parseInt(container.querySelector('#mrp-select-year')?.value || '2026', 10);
        const m = parseInt(container.querySelector('#mrp-select-month')?.value || '9', 10);
        const leadTime = parseInt(container.querySelector('#mrp-lead-time')?.value || '14', 10);
        const targetDays = parseInt(container.querySelector('#mrp-target-days')?.value || '30', 10);
        const locFilter = container.querySelector('#mrp-filter-location')?.value || '';

        const periodEl = container.querySelector('#planning-analysis-period');
        if (periodEl) periodEl.innerText = `${y}년 ${m}월 기준 (리드타임: ${leadTime}일 / 목표: ${targetDays}일)`;

        const mPrefix = `${y}-${String(m).padStart(2, '0')}`;
        const daysInMonth = new Date(y, m, 0).getDate();

        let orderCount = 0;
        let totalOrderQty = 0;
        let prodCount = 0;
        let totalProdQty = 0;
        let criticalCount = 0;
        let safetyAdjustCount = 0;

        calculatedRows = state.master.map(item => {
            let monthlyUsage = 0;
            let monthlyShipment = 0;

            state.history.filter(h => h.code === item.code && toDateKey(h.timestamp).startsWith(mPrefix)).forEach(h => {
                if (locFilter) {
                    if (h.type === 'IN' && h.toLoc !== locFilter) return;
                    if (h.type === 'MOVE' && h.fromLoc !== locFilter && h.toLoc !== locFilter) return;
                    if ((h.type === 'USE' || h.type === 'OUT') && h.fromLoc !== locFilter) return;
                }
                if (h.type === 'USE') monthlyUsage += (Number(h.qty) || 0);
                if (h.type === 'OUT') monthlyShipment += (Number(h.qty) || 0);
            });

            const totalOutflow = monthlyUsage + monthlyShipment;
            const dailyBurnRate = totalOutflow > 0 ? (totalOutflow / daysInMonth) : 0;

            const currentStock = state.inventory
                .filter(i => i.code === item.code && (!locFilter || i.location === locFilter))
                .reduce((s, i) => s + (Number(i.quantity) || 0), 0);

            let runoutDays = 999;
            if (dailyBurnRate > 0) {
                runoutDays = Math.round(currentStock / dailyBurnRate);
            } else if (currentStock === 0) {
                runoutDays = 0;
            }

            const currentSafety = Number(item.safety) || 20;
            const calculatedSafety = dailyBurnRate > 0 ? Math.max(10, Math.ceil(dailyBurnRate * leadTime * 1.3)) : currentSafety;

            let decisionStatus = 'NORMAL';
            let decisionLabel = '적정 재고';
            let recommendedActionQty = 0;

            const targetStockLevel = dailyBurnRate > 0 ? Math.ceil(dailyBurnRate * targetDays) + calculatedSafety : (currentSafety * 2);

            if (currentStock < currentSafety || runoutDays <= 7) {
                if (item.category === '완제품') {
                    decisionStatus = 'PROD_NEED';
                    decisionLabel = runoutDays <= 7 ? '🚨 긴급생산' : '🏭 생산필요';
                    recommendedActionQty = Math.max(0, targetStockLevel - currentStock);
                    prodCount++;
                    totalProdQty += recommendedActionQty;
                } else {
                    decisionStatus = 'ORDER_NEED';
                    decisionLabel = runoutDays <= 7 ? '🚨 긴급발주' : '🛒 발주필요';
                    recommendedActionQty = Math.max(0, targetStockLevel - currentStock);
                    orderCount++;
                    totalOrderQty += recommendedActionQty;
                }
                if (runoutDays <= 7) criticalCount++;
            } else if (currentStock < targetStockLevel * 0.7) {
                if (item.category === '완제품') {
                    decisionStatus = 'PROD_NEED';
                    decisionLabel = '생산 권장';
                    recommendedActionQty = Math.max(0, targetStockLevel - currentStock);
                    prodCount++;
                    totalProdQty += recommendedActionQty;
                } else {
                    decisionStatus = 'ORDER_NEED';
                    decisionLabel = '발주 권장';
                    recommendedActionQty = Math.max(0, targetStockLevel - currentStock);
                    orderCount++;
                    totalOrderQty += recommendedActionQty;
                }
            } else if (currentStock > targetStockLevel * 2.2 && currentStock > 100) {
                decisionStatus = 'OVERSTOCK';
                decisionLabel = '과다 재고';
                recommendedActionQty = 0;
            }

            const safetyDiff = Math.abs(calculatedSafety - currentSafety);
            const isSafetyAdjustmentRecommended = safetyDiff >= 10 || (currentSafety === 0 && calculatedSafety > 0);
            if (isSafetyAdjustmentRecommended) safetyAdjustCount++;

            return {
                category: item.category,
                code: item.code,
                name: item.name,
                spec: item.spec || '-',
                unit: item.unit || 'EA',
                supplier: item.supplier || '-',
                currentStock,
                monthlyUsage,
                monthlyShipment,
                totalOutflow,
                dailyBurnRate: parseFloat(dailyBurnRate.toFixed(1)),
                runoutDays,
                currentSafety,
                calculatedSafety,
                decisionStatus,
                decisionLabel,
                recommendedActionQty,
                isSafetyAdjustmentRecommended
            };
        });

        // KPI UI 갱신
        container.querySelector('#mrp-kpi-order-count').innerText = orderCount;
        container.querySelector('#mrp-kpi-order-qty').innerText = `총 ${totalOrderQty.toLocaleString()}개 발주 권장`;
        container.querySelector('#mrp-kpi-prod-count').innerText = prodCount;
        container.querySelector('#mrp-kpi-prod-qty').innerText = `총 ${totalProdQty.toLocaleString()}세트 생산 권장`;
        container.querySelector('#mrp-kpi-critical-count').innerText = criticalCount;
        container.querySelector('#mrp-kpi-safety-adjust-count').innerText = safetyAdjustCount;

        const bOrder = container.querySelector('#badge-mrp-order-need');
        const bProd = container.querySelector('#badge-mrp-prod-need');
        const bSafety = container.querySelector('#badge-mrp-safety-need');
        if (bOrder) bOrder.innerText = orderCount;
        if (bProd) bProd.innerText = prodCount;
        if (bSafety) bSafety.innerText = safetyAdjustCount;

        renderCharts();
        renderTable();
    };

    const renderCharts = () => {
        // 차트 1: 사용량 vs 출고량 TOP 7
        const sortedByOutflow = [...calculatedRows].sort((a, b) => b.totalOutflow - a.totalOutflow).slice(0, 7);
        const cLabels = sortedByOutflow.map(r => r.name.length > 10 ? r.name.slice(0, 10) + '...' : r.name);
        const usageData = sortedByOutflow.map(r => r.monthlyUsage);
        const shipmentData = sortedByOutflow.map(r => r.monthlyShipment);

        const canvas1 = container.querySelector('#mrp-chart-consumption-shipment');
        if (canvas1) {
            if (chartInstance1) chartInstance1.destroy();
            chartInstance1 = new Chart(canvas1, {
                type: 'bar',
                data: {
                    labels: cLabels.length > 0 ? cLabels : ['데이터 없음'],
                    datasets: [
                        {
                            label: '월간 사용량 (공정 투입)',
                            data: usageData.length > 0 ? usageData : [0],
                            backgroundColor: 'rgba(59, 130, 246, 0.8)',
                            borderRadius: 6
                        },
                        {
                            label: '월간 출고량 (고객사 불출)',
                            data: shipmentData.length > 0 ? shipmentData : [0],
                            backgroundColor: 'rgba(168, 85, 247, 0.8)',
                            borderRadius: 6
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                        y: { grid: { color: '#f1f5f9' }, beginAtZero: true, ticks: { font: { size: 10 } } }
                    }
                }
            });
        }

        // 차트 2: 소진 예상 일수 TOP 7
        const sortedByRisk = [...calculatedRows].filter(r => r.dailyBurnRate > 0).sort((a, b) => a.runoutDays - b.runoutDays).slice(0, 7);
        const rLabels = sortedByRisk.map(r => r.name.length > 10 ? r.name.slice(0, 10) + '...' : r.name);
        const rDays = sortedByRisk.map(r => r.runoutDays);
        const barColors = sortedByRisk.map(r => r.runoutDays <= 7 ? '#f43f5e' : (r.runoutDays <= 14 ? '#f59e0b' : '#10b981'));

        const canvas2 = container.querySelector('#mrp-chart-runout-days');
        if (canvas2) {
            if (chartInstance2) chartInstance2.destroy();
            chartInstance2 = new Chart(canvas2, {
                type: 'bar',
                data: {
                    labels: rLabels.length > 0 ? rLabels : ['소진 속도 산출 대상 없음'],
                    datasets: [{
                        label: '소진 예상 일수 (일)',
                        data: rDays.length > 0 ? rDays : [0],
                        backgroundColor: barColors.length > 0 ? barColors : ['#cbd5e1'],
                        borderRadius: 6
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: ctx => ` 소진까지 약 ${ctx.raw}일치 재고 보유` } }
                    },
                    scales: {
                        x: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 } } },
                        y: { grid: { display: false }, ticks: { font: { size: 10 } } }
                    }
                }
            });
        }
    };

    const renderTable = () => {
        const tbody = container.querySelector('#mrp-table-tbody');
        const tfoot = container.querySelector('#mrp-table-tfoot');
        const countBadge = container.querySelector('#mrp-table-row-count-badge');
        const search = (container.querySelector('#mrp-search-input')?.value || '').trim().toLowerCase();

        let filtered = calculatedRows.filter(r => {
            if (currentViewMode === 'ORDER') {
                if (r.category === '완제품') return false;
                if (r.decisionStatus !== 'ORDER_NEED' && r.runoutDays > 14) return false;
            } else if (currentViewMode === 'PRODUCTION') {
                if (r.category !== '완제품') return false;
            } else if (currentViewMode === 'SAFETY') {
                if (!r.isSafetyAdjustmentRecommended) return false;
            }

            if (!search) return true;
            return r.name.toLowerCase().includes(search) || 
                   r.code.toLowerCase().includes(search) || 
                   r.spec.toLowerCase().includes(search) || 
                   r.supplier.toLowerCase().includes(search);
        });

        if (countBadge) countBadge.innerText = `총 ${filtered.length}개 품목 표시`;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="13" class="py-8 text-center text-slate-400">조건에 일치하는 검토 대상 품목이 없습니다.</td></tr>`;
            tfoot.innerHTML = '';
            return;
        }

        let sumStock = 0, sumUsage = 0, sumShip = 0, sumAction = 0;

        tbody.innerHTML = filtered.map(r => {
            sumStock += r.currentStock;
            sumUsage += r.monthlyUsage;
            sumShip += r.monthlyShipment;
            sumAction += r.recommendedActionQty;

            let badgeClass = 'bg-slate-100 text-slate-700';
            if (r.decisionStatus === 'ORDER_NEED') badgeClass = 'bg-amber-100 text-amber-900 border border-amber-300';
            else if (r.decisionStatus === 'PROD_NEED') badgeClass = 'bg-blue-100 text-blue-900 border border-blue-300';
            else if (r.decisionStatus === 'CRITICAL' || r.runoutDays <= 7) badgeClass = 'bg-rose-100 text-rose-800 border border-rose-300';
            else if (r.decisionStatus === 'NORMAL') badgeClass = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
            else if (r.decisionStatus === 'OVERSTOCK') badgeClass = 'bg-purple-100 text-purple-800 border border-purple-200';

            let runoutHtml = `<span class="font-mono font-bold text-slate-700">${r.runoutDays}일</span>`;
            if (r.runoutDays <= 7) {
                runoutHtml = `<span class="px-2 py-0.5 bg-rose-100 text-rose-800 rounded font-black font-mono text-[11px]">🚨 ${r.runoutDays}일 (위험)</span>`;
            } else if (r.runoutDays <= 14) {
                runoutHtml = `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold font-mono text-[11px]">⚠️ ${r.runoutDays}일 (주의)</span>`;
            } else if (r.runoutDays >= 999) {
                runoutHtml = `<span class="text-slate-400 text-[10px]">소진 無</span>`;
            }

            let safetyDiffHtml = `<span class="font-mono text-emerald-700 font-bold">${r.calculatedSafety} ${r.unit}</span>`;
            if (r.calculatedSafety > r.currentSafety) {
                safetyDiffHtml += `<span class="block text-[9px] text-rose-600 font-bold font-mono">+${r.calculatedSafety - r.currentSafety} 상향필요</span>`;
            } else if (r.calculatedSafety < r.currentSafety) {
                safetyDiffHtml += `<span class="block text-[9px] text-blue-600 font-medium font-mono">-${r.currentSafety - r.calculatedSafety} 하향권장</span>`;
            }

            return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="py-2.5 px-3">
                        <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${r.category === '완제품' ? 'bg-blue-100 text-blue-800' : (r.category === '원료' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-800')}">${r.category}</span>
                    </td>
                    <td class="py-2.5 px-3 font-mono font-bold text-slate-800">${r.code}</td>
                    <td class="py-2.5 px-3">
                        <span class="font-bold text-slate-900 block">${r.name}</span>
                        <span class="text-[11px] text-slate-400">${r.spec} | ${r.supplier}</span>
                    </td>
                    <td class="py-2.5 px-3 text-right font-mono font-black ${r.currentStock <= r.currentSafety ? 'text-rose-600' : 'text-slate-900'} bg-blue-50/30">${r.currentStock.toLocaleString()}</td>
                    <td class="py-2.5 px-3 text-right font-mono font-bold text-blue-700">${r.monthlyUsage > 0 ? r.monthlyUsage.toLocaleString() : '-'}</td>
                    <td class="py-2.5 px-3 text-right font-mono font-bold text-purple-700">${r.monthlyShipment > 0 ? r.monthlyShipment.toLocaleString() : '-'}</td>
                    <td class="py-2.5 px-3 text-right font-mono text-slate-700">${r.dailyBurnRate > 0 ? r.dailyBurnRate + ' /일' : '-'}</td>
                    <td class="py-2.5 px-3 text-center">${runoutHtml}</td>
                    <td class="py-2.5 px-3 text-right font-mono text-slate-600">${r.currentSafety} ${r.unit}</td>
                    <td class="py-2.5 px-3 text-right bg-emerald-50/20">${safetyDiffHtml}</td>
                    <td class="py-2.5 px-3 text-center bg-violet-50/30">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}">${r.decisionLabel}</span>
                    </td>
                    <td class="py-2.5 px-3 text-right font-mono font-black text-amber-700 bg-amber-50/30">
                        ${r.recommendedActionQty > 0 ? r.recommendedActionQty.toLocaleString() + ' ' + r.unit : '-'}
                    </td>
                    <td class="py-2.5 px-3 text-center no-print">
                        <button type="button" class="btn-apply-single-safety p-1 text-emerald-600 hover:bg-emerald-50 rounded" data-code="${r.code}" data-safety="${r.calculatedSafety}" title="권장 안전재고(${r.calculatedSafety}) 즉시 반영">
                            <i data-lucide="shield-check" class="w-4 h-4"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        tfoot.innerHTML = `
            <tr>
                <td colspan="3" class="py-2.5 px-3 text-center">집계 합계 (표시된 ${filtered.length}건)</td>
                <td class="py-2.5 px-3 text-right font-mono text-slate-900">${sumStock.toLocaleString()}</td>
                <td class="py-2.5 px-3 text-right font-mono text-blue-700">${sumUsage.toLocaleString()}</td>
                <td class="py-2.5 px-3 text-right font-mono text-purple-700">${sumShip.toLocaleString()}</td>
                <td colspan="4" class="py-2.5 px-3 text-slate-500 font-normal text-[11px]">일평균 소진 속도 및 리드타임 기반 계산</td>
                <td class="py-2.5 px-3 text-center text-violet-800 text-[11px]">총 조치권장량</td>
                <td class="py-2.5 px-3 text-right font-mono font-black text-amber-700">${sumAction.toLocaleString()} EA</td>
                <td class="py-2.5 px-3 no-print"></td>
            </tr>
        `;

        // 단일 품목 안전재고 반영
        tbody.querySelectorAll('.btn-apply-single-safety').forEach(btn => {
            btn.addEventListener('click', async () => {
                const code = btn.getAttribute('data-code');
                const safety = Number(btn.getAttribute('data-safety'));
                const item = state.master.find(m => m.code === code);
                if (item) {
                    await saveMasterItem({ ...item, safety });
                    showToast(`✅ [${code}] ${item.name} 안전재고를 ${safety}개로 업데이트했습니다.`);
                    calculateMRP();
                }
            });
        });
    };

    // 모드 변경 버튼 이벤트
    const setMode = (mode) => {
        currentViewMode = mode;
        ['ALL', 'ORDER', 'PRODUCTION', 'SAFETY'].forEach(m => {
            const btn = container.querySelector(`#mrp-mode-${m}`);
            if (btn) {
                if (m === mode) {
                    btn.className = 'mrp-tab-btn px-3 py-1.5 rounded-lg font-bold bg-violet-600 text-white shadow-xs transition';
                } else {
                    btn.className = 'mrp-tab-btn px-3 py-1.5 rounded-lg font-bold text-slate-600 hover:text-violet-700 hover:bg-violet-50 transition flex items-center gap-1';
                }
            }
        });
        renderTable();
    };

    container.querySelector('#mrp-mode-ALL')?.addEventListener('click', () => setMode('ALL'));
    container.querySelector('#mrp-mode-ORDER')?.addEventListener('click', () => setMode('ORDER'));
    container.querySelector('#mrp-mode-PRODUCTION')?.addEventListener('click', () => setMode('PRODUCTION'));
    container.querySelector('#mrp-mode-SAFETY')?.addEventListener('click', () => setMode('SAFETY'));

    // 필터 변경 이벤트
    ['#mrp-select-year', '#mrp-select-month', '#mrp-lead-time', '#mrp-target-days', '#mrp-filter-location'].forEach(sel => {
        container.querySelector(sel)?.addEventListener('change', calculateMRP);
    });

    container.querySelector('#btn-recalculate-mrp')?.addEventListener('click', calculateMRP);
    container.querySelector('#mrp-search-input')?.addEventListener('input', renderTable);

    // 전체 안전재고 일괄 적용
    container.querySelector('#btn-apply-all-safety')?.addEventListener('click', async () => {
        const adjustables = calculatedRows.filter(r => r.isSafetyAdjustmentRecommended && r.calculatedSafety > 0);
        if (adjustables.length === 0) {
            alert('조정 권고 대상 품목이 없습니다.');
            return;
        }

        if (confirm(`현재 소진율 기반으로 산출된 ${adjustables.length}개 품목의 권장 안전재고를 마스터 기준정보에 일괄 반영하시겠습니까?`)) {
            for (const r of adjustables) {
                const item = state.master.find(m => m.code === r.code);
                if (item) {
                    await saveMasterItem({ ...item, safety: r.calculatedSafety });
                }
            }
            showToast(`✅ ${adjustables.length}개 품목의 안전재고가 일괄 업데이트되었습니다.`);
            calculateMRP();
        }
    });

    // CSV 다운로드
    container.querySelector('#btn-export-mrp-csv')?.addEventListener('click', () => {
        const headers = ["분류", "품목코드", "품목명", "규격", "거래처", "현재고", "월간사용량", "월간출고량", "일평균소진량", "소진예상일", "현재안전재고", "권장안전재고", "판정", "권장조치량", "단위"];
        const rows = calculatedRows.map(r => [
            r.category,
            r.code,
            `"${r.name.replace(/"/g, '""')}"`,
            `"${r.spec.replace(/"/g, '""')}"`,
            `"${r.supplier.replace(/"/g, '""')}"`,
            r.currentStock,
            r.monthlyUsage,
            r.monthlyShipment,
            r.dailyBurnRate,
            r.runoutDays,
            r.currentSafety,
            r.calculatedSafety,
            r.decisionLabel,
            r.recommendedActionQty,
            r.unit
        ]);

        const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `대림WMS_MRP발주생산검토_${localDateStr()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });

    calculateMRP();
};
