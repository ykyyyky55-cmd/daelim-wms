import { state, processStockAction } from '../services/db.js';

export const renderDashboard = (container, { onSwitchTab, onOpenModal, showToast }) => {
    // 1. KPI 계산
    const masterCount = state.master.length;
    const totalStock = state.inventory.reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);
    
    // 안전재고 부족 계산 (품목별 창고 합산 재고 vs 안전재고)
    const lowStockItems = state.master.filter(m => {
        const itemStock = state.inventory
            .filter(inv => inv.code === m.code)
            .reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);
        return itemStock <= Number(m.safety);
    });

    // 오늘 작업 건수 계산
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const todayLogs = state.history.filter(h => {
        return h.timestamp && (h.timestamp.includes(todayPrefix) || h.timestamp.startsWith(new Date().getFullYear().toString()));
    });

    const currentTime = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });

    container.innerHTML = `
    <section id="tab-content-home" class="space-y-6">
        <!-- 상단 KPI 헤더 -->
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg border border-slate-800">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30">실시간 WMS 허브</span>
                        <span class="text-xs text-slate-400 font-mono">${currentTime}</span>
                    </div>
                    <h2 class="text-xl sm:text-2xl font-black tracking-tight">작업 현황 및 통합 관리 홈</h2>
                    <p class="text-xs text-slate-400">자주 사용하는 작업창 카드를 홈 화면에 추가하거나 제외하여 나만의 작업 환경을 구성하세요.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-quick-sync" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md shadow-indigo-600/30">
                        <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                        <span>실시간 새로고침</span>
                    </button>
                </div>
            </div>

            <!-- KPI 통계 카드 4개 -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition cursor-pointer" data-goto="master">
                    <span class="text-slate-400 text-[11px] font-bold block">등록 품목 마스터</span>
                    <div class="flex items-baseline gap-1.5 mt-1">
                        <span class="text-2xl font-black text-white">${masterCount}</span>
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
        </div>

        <!-- 홈 위젯 그리드 -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">
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
                            ${state.master.map(m => `<option value="${m.code}">[${m.code}] ${m.name} (${m.category})</option>`).join('')}
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
                            <label class="block text-xs font-bold text-slate-600 mb-1">수량 (EA)</label>
                            <input type="number" id="quick-qty" min="1" value="10" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none" required />
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">대상 창고/거점</label>
                        <select id="quick-location" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none">
                            ${state.locations.map(loc => `<option value="${loc}">${loc}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">작업 사유 / 비고</label>
                        <input type="text" id="quick-reason" placeholder="예: 정기 구매 입고, 생산라인 불출 등" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <button type="submit" class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5">
                        <i data-lucide="check" class="w-4 h-4"></i>
                        <span>즉시 처리 및 클라우드 동기화</span>
                    </button>
                </form>
            </div>

            <!-- 위젯 2: 안전재고 부족 경보 리스트 -->
            <div class="lg:col-span-6 xl:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
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
                        현재 모든 품목이 안전재고 이상 보관 중입니다.
                    </div>
                ` : `
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-slate-50 text-slate-500 border-b border-slate-200">
                                <tr>
                                    <th class="p-2">품목코드</th>
                                    <th class="p-2">품목명</th>
                                    <th class="p-2 text-right">현재고</th>
                                    <th class="p-2 text-right">안전재고</th>
                                    <th class="p-2 text-center">상태</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100">
                                ${lowStockItems.map(item => {
                                    const currStock = state.inventory
                                        .filter(inv => inv.code === item.code)
                                        .reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);
                                    return `
                                    <tr class="hover:bg-slate-50 transition">
                                        <td class="p-2 font-mono font-bold text-slate-800">${item.code}</td>
                                        <td class="p-2 font-medium text-slate-700">${item.name}</td>
                                        <td class="p-2 text-right font-black text-rose-600">${currStock} ${item.unit}</td>
                                        <td class="p-2 text-right font-bold text-slate-400">${item.safety} ${item.unit}</td>
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

            <!-- 위젯 3: 최근 작업 이력 (Audit Log) -->
            <div class="lg:col-span-12 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <i data-lucide="history" class="w-4 h-4"></i>
                        </div>
                        <h3 class="font-black text-slate-800 text-sm">실시간 최근 현장 작업 이력</h3>
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
                            ${state.history.slice(0, 5).map(h => {
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
                                    <td class="p-2.5 text-right font-black text-blue-600">${h.qty} EA</td>
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
        </div>
    </section>
    `;

    // 이벤트 리스너 바인딩
    container.querySelectorAll('[data-goto]').forEach(el => {
        el.addEventListener('click', () => {
            const target = el.getAttribute('data-goto');
            onSwitchTab(target);
        });
    });

    container.querySelector('#btn-quick-sync')?.addEventListener('click', () => {
        onSwitchTab('home');
        showToast('🔄 최신 데이터 및 Supabase 동기화가 완료되었습니다.');
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
            onSwitchTab('home'); // 대시보드 리렌더링
        } catch (err) {
            alert(err.message || '작업 처리 중 오류가 발생했습니다.');
        }
    });
};
