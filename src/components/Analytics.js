import { state } from '../services/db.js';
import Chart from 'chart.js/auto';

let trendChartInstance = null;
let categoryChartInstance = null;

export const renderAnalytics = (container) => {
    container.innerHTML = `
    <section id="tab-content-analytics" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="bar-chart-3" class="w-5 h-5 text-emerald-600"></i>
                        <span>월간 실적 현황판 & 통계 분석</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">자재 입고·출고 물동량 추이 및 분류별 보관 점유율을 시각적으로 분석합니다.</p>
                </div>
            </div>

            <!-- 차트 그리드 -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <!-- 입출고 추이 차트 -->
                <div class="lg:col-span-8 bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <h3 class="text-xs font-black text-slate-700 mb-3 flex items-center gap-1.5">
                        <i data-lucide="trending-up" class="w-4 h-4 text-blue-600"></i>
                        <span>최근 6개월 자재 입고 vs 출고 물동량 (EA)</span>
                    </h3>
                    <div class="h-64">
                        <canvas id="chart-trend"></canvas>
                    </div>
                </div>

                <!-- 분류별 점유율 도넛 차트 -->
                <div class="lg:col-span-4 bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col">
                    <h3 class="text-xs font-black text-slate-700 mb-3 flex items-center gap-1.5">
                        <i data-lucide="pie-chart" class="w-4 h-4 text-emerald-600"></i>
                        <span>분류별 재고 점유 비율</span>
                    </h3>
                    <div class="h-64 flex-1 flex items-center justify-center">
                        <canvas id="chart-category"></canvas>
                    </div>
                </div>
            </div>
        </div>
    </section>
    `;

    // 기존 차트 인스턴스 정리
    if (trendChartInstance) trendChartInstance.destroy();
    if (categoryChartInstance) categoryChartInstance.destroy();

    // 1. 추이 차트
    const ctxTrend = container.querySelector('#chart-trend');
    if (ctxTrend) {
        trendChartInstance = new Chart(ctxTrend, {
            type: 'bar',
            data: {
                labels: ['4월', '5월', '6월', '7월', '8월', '9월'],
                datasets: [
                    {
                        label: '입고 (IN)',
                        data: [420, 580, 710, 630, 890, 650],
                        backgroundColor: '#3b82f6',
                        borderRadius: 6
                    },
                    {
                        label: '출고/투입 (OUT)',
                        data: [380, 510, 640, 690, 780, 590],
                        backgroundColor: '#f43f5e',
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { font: { family: 'Noto Sans KR', size: 11, weight: 'bold' } } }
                }
            }
        });
    }

    // 2. 카테고리 도넛 차트
    const ctxCat = container.querySelector('#chart-category');
    if (ctxCat) {
        const catCounts = state.categories.map(cat => {
            return state.inventory
                .filter(i => i.category === cat)
                .reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);
        });

        categoryChartInstance = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
                labels: state.categories,
                datasets: [{
                    data: catCounts,
                    backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { font: { family: 'Noto Sans KR', size: 11, weight: 'bold' } } }
                }
            }
        });
    }
};
