import { state, processStockAction } from '../services/db.js';
import QRCode from 'qrcode';
import { createIcons, icons } from 'lucide';

let autoRefreshTimer = null;

export const renderDashboard = (container, { onSwitchTab, onOpenModal, showToast }) => {
    // 이전 자동 새로고침 타이머 정리
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }

    const settings = state.dashboardSettings || {
        showKpi: true,
        showQrWidget: true,
        showQuickAction: true,
        showLowSafety: true,
        showHistory: true,
        showOilCalc: true,
        refreshInterval: 0,
        lowSafetyFilter: 'all',
        historyCount: 5
    };

    // 1. KPI 계산
    const masterCount = state.master.length;
    const totalStock = state.inventory.reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);
    
    // 안전재고 부족 계산 (품목별 창고 합산 재고 vs 안전재고)
    let lowStockItems = state.master.filter(m => {
        const itemStock = state.inventory
            .filter(inv => inv.code === m.code)
            .reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);
        return itemStock <= Number(m.safety);
    });

    if (settings.lowSafetyFilter === 'zero_only') {
        lowStockItems = lowStockItems.filter(m => {
            const itemStock = state.inventory
                .filter(inv => inv.code === m.code)
                .reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);
            return itemStock === 0;
        });
    }

    // 오늘 작업 건수 계산
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const todayLogs = state.history.filter(h => {
        return h.timestamp && (h.timestamp.includes(todayPrefix) || h.timestamp.startsWith(new Date().getFullYear().toString()));
    });

    const currentTime = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
    const liveAppUrl = window.location.href.includes('localhost') 
        ? 'https://ykyyyky55-cmd.github.io/daelim-wms/' 
        : window.location.href.split('#')[0];

    container.innerHTML = `
    <section id="tab-content-home" class="space-y-6">
        <!-- 상단 KPI 헤더 -->
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg border border-slate-800">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30">실시간 스마트 WMS 허브</span>
                        <span class="text-xs text-slate-400 font-mono">${currentTime}</span>
                        ${settings.refreshInterval > 0 ? `<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 animate-pulse">자동 갱신 (${settings.refreshInterval}s)</span>` : ''}
                    </div>
                    <h2 class="text-xl sm:text-2xl font-black tracking-tight">작업 현황 및 통합 관리 홈</h2>
                    <p class="text-xs text-slate-400">현장 모바일 QR 스캔, 실시간 클라우드 재고 및 윤활유 수불 엔진을 통합 제어합니다.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-open-dash-settings" class="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/10 shadow-xs">
                        <i data-lucide="sliders" class="w-4 h-4 text-indigo-300"></i>
                        <span>대시보드 설정</span>
                    </button>
                    <button type="button" id="btn-quick-sync" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md shadow-indigo-600/30">
                        <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                        <span>실시간 새로고침</span>
                    </button>
                </div>
            </div>

            ${settings.showKpi !== false ? `
            <!-- KPI 통계 카드 4개 -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition cursor-pointer" data-goto="master">
                    <span class="text-slate-400 text-[11px] font-bold block">등록 품목 마스터</span>
                    <div class="flex items-baseline gap-1.5 mt-1">
                        <span class="text-2xl font-black text-white">${masterCount.toLocaleString()}</span>
                        <span class="text-xs text-slate-400">품목</span>
                    </div>
                </div>
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition cursor-pointer" data-goto="inventory">
                    <span class="text-slate-400 text-[11px] font-bold block">창고 보관 총수량</span>
                    <div class="flex items-baseline gap-1.5 mt-1">
                        <span class="text-2xl font-black text-blue-400">${totalStock.toLocaleString()}</span>
                        <span class="text-xs text-slate-400">EA</span>
                    </div>
                </div>
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition cursor-pointer" data-goto="inventory">
                    <span class="text-slate-400 text-[11px] font-bold block">안전재고 부족 경보</span>
                    <div class="flex items-baseline gap-1.5 mt-1">
                        <span class="text-2xl font-black text-rose-400">${lowStockItems.length}</span>
                        <span class="text-xs text-rose-300 font-bold">건 결품 위험</span>
                    </div>
                </div>
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition cursor-pointer" data-goto="calendar">
                    <span class="text-slate-400 text-[11px] font-bold block">오늘 수불 & 예정 일정</span>
                    <div class="flex items-baseline gap-1.5 mt-1">
                        <span class="text-2xl font-black text-emerald-400">${todayLogs.length}</span>
                        <span class="text-xs text-slate-400">건 처리</span>
                    </div>
                </div>
            </div>
            ` : ''}
        </div>

        <!-- 홈 위젯 그리드 -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">
            ${settings.showQrWidget !== false ? `
            <!-- 위젯: 모바일 스마트폰 접속 & 앱 설치 QR코드 -->
            <div class="lg:col-span-12 bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-5 rounded-2xl border border-blue-800 shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
                <div class="flex items-center gap-5">
                    <div class="bg-white p-2.5 rounded-2xl shadow-lg border-2 border-blue-400/40 flex-shrink-0 flex items-center justify-center">
                        <canvas id="dash-qr-canvas" class="rounded-lg"></canvas>
                    </div>
                    <div class="space-y-1.5">
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-500 text-white">MOBILE PWA</span>
                            <span class="text-xs font-bold text-blue-200">현장 스마트폰 카메라로 QR 스캔</span>
                        </div>
                        <h3 class="text-base sm:text-lg font-black tracking-tight">스마트폰에서 대림오일 WMS 앱 바로 사용하기</h3>
                        <p class="text-xs text-slate-300 leading-relaxed max-w-xl">
                            현장 작업자의 휴대폰 카메라로 QR코드를 비추면 앱이 바로 열립니다. 브라우저의 <b>[홈 화면에 추가]</b>를 누르면 설치형 앱처럼 독립 실행됩니다.
                        </p>
                    </div>
                </div>
                <div class="flex flex-row md:flex-col gap-2 w-full md:w-auto">
                    <button type="button" id="btn-dash-open-pwa-modal" class="flex-1 md:flex-initial px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap">
                        <i data-lucide="smartphone" class="w-4 h-4"></i>
                        <span>앱 설치 안내창 열기</span>
                    </button>
                    <button type="button" id="btn-dash-download-qr" class="flex-1 md:flex-initial px-4 py-2 bg-white/10 hover:bg-white/20 text-slate-200 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 border border-white/10 whitespace-nowrap">
                        <i data-lucide="download" class="w-3.5 h-3.5"></i>
                        <span>QR 이미지 다운로드</span>
                    </button>
                </div>
            </div>
            ` : ''}

            ${settings.showQuickAction !== false ? `
            <!-- 위젯 1: 빠른 품목 스캔 & 처리 -->
            <div class="lg:col-span-6 xl:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                            <i data-lucide="scan-line" class="w-4 h-4"></i>
                        </div>
                        <h3 class="font-black text-slate-800 text-sm">빠른 입출고 등록</h3>
                    </div>
                    <button type="button" class="text-xs text-blue-600 font-bold hover:underline" data-goto="scan">전체 스캐너 열기 &rarr;</button>
                </div>

                <form id="quick-action-form" class="space-y-3">
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">품목 선택</label>
                        <select id="quick-item-code" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none">
                            ${state.master.slice(0, 30).map(m => `<option value="${m.code}">[${m.code}] ${m.name} (${m.category})</option>`).join('')}
                        </select>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">작업 유형</label>
                            <select id="quick-action-type" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                <option value="IN">입고 (+)</option>
                                <option value="OUT">출고 (-)</option>
                                <option value="USE">생산투입 (-)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">수량</label>
                            <input type="number" id="quick-qty" min="1" value="10" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" required />
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">대상 창고/거점</label>
                        <select id="quick-location" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none">
                            ${state.locations.map(loc => `<option value="${loc}">${loc}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">작업 사유 / 비고</label>
                        <input type="text" id="quick-reason" placeholder="예: 정기 구매 입고, 현장 생산투입" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <button type="submit" class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5">
                        <i data-lucide="check" class="w-4 h-4"></i>
                        <span>즉시 처리 및 클라우드 동기화</span>
                    </button>
                </form>
            </div>
            ` : ''}

            ${settings.showLowSafety !== false ? `
            <!-- 위젯 2: 안전재고 부족 경보 리스트 -->
            <div class="${settings.showQuickAction !== false ? 'lg:col-span-6 xl:col-span-7' : 'lg:col-span-12'} bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                            <i data-lucide="alert-triangle" class="w-4 h-4"></i>
                        </div>
                        <h3 class="font-black text-slate-800 text-sm">안전재고 부족 경보 (${lowStockItems.length}건)</h3>
                    </div>
                    <button type="button" class="text-xs text-rose-600 font-bold hover:underline" data-goto="inventory">재고 관리 &rarr;</button>
                </div>

                ${lowStockItems.length === 0 ? `
                    <div class="p-8 text-center text-slate-400 text-xs">
                        <i data-lucide="shield-check" class="w-8 h-8 mx-auto text-emerald-500 mb-2"></i>
                        현재 모든 품목이 안전재고 이상 적정하게 보관 중입니다.
                    </div>
                ` : `
                    <div class="overflow-x-auto max-h-72">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0">
                                <tr>
                                    <th class="p-2">품목코드</th>
                                    <th class="p-2">품목명</th>
                                    <th class="p-2 text-right">현재고</th>
                                    <th class="p-2 text-right">안전재고</th>
                                    <th class="p-2 text-center">상태</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100">
                                ${lowStockItems.slice(0, 15).map(item => {
                                    const currStock = state.inventory
                                        .filter(inv => inv.code === item.code)
                                        .reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);
                                    return `
                                    <tr class="hover:bg-slate-50 transition">
                                        <td class="p-2 font-mono font-bold text-slate-800">${item.code}</td>
                                        <td class="p-2 font-medium text-slate-700 truncate max-w-[140px]">${item.name}</td>
                                        <td class="p-2 text-right font-black text-rose-600">${currStock.toLocaleString()} ${item.unit}</td>
                                        <td class="p-2 text-right font-bold text-slate-400">${Number(item.safety).toLocaleString()} ${item.unit}</td>
                                        <td class="p-2 text-center">
                                            <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${currStock === 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}">
                                                ${currStock === 0 ? '품절' : '부족'}
                                            </span>
                                        </td>
                                    </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
            ` : ''}

            ${settings.showOilCalc !== false ? `
            <!-- 위젯: 윤활유 15℃ 비중 환산 퀵 위젯 -->
            <div class="lg:col-span-12 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center flex-shrink-0">
                        <i data-lucide="flask-conical" class="w-5 h-5"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] font-black bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full">ASTM D1250</span>
                            <h3 class="font-black text-slate-900 text-sm">윤활유 15℃ 비중(SG) 보정 & 중량(kg) ↔ 용량(L) 환산 엔진</h3>
                        </div>
                        <p class="text-xs text-slate-500 mt-0.5">현장 실측 온도 기준 15℃ 비중 보정 및 드럼(200L) / 페일(18L) 자동 환산을 전용 탭에서 이용하세요.</p>
                    </div>
                </div>
                <button type="button" class="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm whitespace-nowrap" data-goto="oilcalc">
                    <span>비중 계산기 열기</span>
                    <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                </button>
            </div>
            ` : ''}

            ${settings.showHistory !== false ? `
            <!-- 위젯 3: 최근 작업 이력 (Audit Log) -->
            <div class="lg:col-span-12 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <i data-lucide="history" class="w-4 h-4"></i>
                        </div>
                        <h3 class="font-black text-slate-800 text-sm">실시간 최근 현장 작업 이력 (최근 ${settings.historyCount || 5}건)</h3>
                    </div>
                    <button type="button" class="text-xs text-blue-600 font-bold hover:underline" data-goto="history">전체 이력 보기 &rarr;</button>
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-50 text-slate-500 border-b border-slate-200">
                            <tr>
                                <th class="p-2.5">일시</th>
                                <th class="p-2.5">구분</th>
                                <th class="p-2.5">품목코드 / 품명</th>
                                <th class="p-2.5 text-right">수량</th>
                                <th class="p-2.5">출발 &rarr; 도착 거점</th>
                                <th class="p-2.5">작업자</th>
                                <th class="p-2.5">사유</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${state.history.slice(0, settings.historyCount || 5).map(h => {
                                const typeBadge = {
                                    IN: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">입고</span>',
                                    OUT: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">출고</span>',
                                    USE: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800">투입</span>',
                                    MOVE: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">이동</span>',
                                    AUDIT: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800">실사</span>'
                                }[h.type] || h.type;

                                return `
                                <tr class="hover:bg-slate-50 transition">
                                    <td class="p-2.5 font-mono text-slate-500">${h.timestamp}</td>
                                    <td class="p-2.5">${typeBadge}</td>
                                    <td class="p-2.5 font-bold text-slate-800">[${h.code}] ${h.name}</td>
                                    <td class="p-2.5 text-right font-black text-blue-600">${Number(h.qty).toLocaleString()} EA</td>
                                    <td class="p-2.5 text-slate-600 font-medium">${h.fromLoc} &rarr; ${h.toLoc}</td>
                                    <td class="p-2.5 font-bold text-slate-700">${h.worker}</td>
                                    <td class="p-2.5 text-slate-500 truncate max-w-xs">${h.reason || '-'}</td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            ` : ''}
        </div>
    </section>
    `;

    // 대시보드 내 QR 코드 렌더링
    const dashCanvas = container.querySelector('#dash-qr-canvas');
    if (dashCanvas) {
        QRCode.toCanvas(dashCanvas, liveAppUrl, {
            width: 100,
            margin: 1,
            color: {
                dark: '#0f172a',
                light: '#ffffff'
            }
        });
    }

    container.querySelector('#btn-dash-open-pwa-modal')?.addEventListener('click', () => onOpenModal('pwa-qr'));
    container.querySelector('#btn-dash-download-qr')?.addEventListener('click', () => {
        if (dashCanvas) {
            const link = document.createElement('a');
            link.download = '대림오일_WMS_현장접속QR.png';
            link.href = dashCanvas.toDataURL('image/png');
            link.click();
            showToast('📥 대시보드 QR 코드가 다운로드되었습니다.');
        }
    });

    container.querySelector('#btn-open-dash-settings')?.addEventListener('click', () => onOpenModal('dashboard-settings'));

    // 자동 새로고침 인터벌 등록
    if (settings.refreshInterval > 0) {
        autoRefreshTimer = setInterval(() => {
            renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
        }, settings.refreshInterval * 1000);
    }

    // 이벤트 리스너 바인딩
    container.querySelectorAll('[data-goto]').forEach(el => {
        el.addEventListener('click', () => {
            const target = el.getAttribute('data-goto');
            onSwitchTab(target);
        });
    });

    container.querySelector('#btn-quick-sync')?.addEventListener('click', () => {
        renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
        showToast('🔄 최신 데이터가 새로고침되었습니다.');
    });

    const quickForm = container.querySelector('#quick-action-form');
    quickForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = container.querySelector('#quick-item-code').value;
        const type = container.querySelector('#quick-action-type').value;
        const qty = container.querySelector('#quick-qty').value;
        const location = container.querySelector('#quick-location').value;
        const reason = container.querySelector('#quick-reason').value;

        try {
            await processStockAction({
                type,
                code,
                qty,
                location,
                fromLoc: type !== 'IN' ? location : '-',
                toLoc: type === 'IN' ? location : '-',
                reason: reason || '홈 빠른 작업 등록'
            });
            showToast(`✅ [${type}] ${code} ${qty}EA 처리 완료 (클라우드 동기화됨)`);
            renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
        } catch (err) {
            alert(err.message || '작업 처리 중 오류가 발생했습니다.');
        }
    });

    createIcons({ icons });
};
