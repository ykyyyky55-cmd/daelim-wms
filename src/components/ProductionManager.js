import { state, processProductionInbound, deleteProductionRecord, saveWorkOrder, deleteWorkOrder, completeWorkOrder } from '../services/db.js';
import { searchMasterItems } from '../services/searchUtils.js';
import { createIcons, icons } from 'lucide';
import QRCode from 'qrcode';

export const renderProductionManager = (container, { showToast, onSwitchTab }) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const expDateStr = (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 3);
        return d.toISOString().slice(0, 10);
    })();

    // 내부 서브 탭 상태: 'production' (생산실적 관리) | 'workorders' (작업지시서 & QR 관리)
    let currentSubTab = 'production';
    let selectedProdType = '완제품'; // '완제품' | '원액' | '반제품'
    let historyFilterType = 'ALL';

    // 품목 마스터 필터 헬퍼
    const getItemsForType = (type) => {
        if (type === '완제품') {
            const list = state.master.filter(m => m.category === '완제품' || m.category?.includes('완제'));
            return list.length > 0 ? list : state.master;
        } else if (type === '원액') {
            const list = state.master.filter(m => m.category === '원액' || m.category === '원료' || m.name?.includes('원액') || m.name?.includes('기유'));
            return list.length > 0 ? list : state.master;
        } else if (type === '반제품') {
            const list = state.master.filter(m => m.category === '반제품' || m.name?.includes('반제품'));
            return list.length > 0 ? list : state.master;
        }
        return state.master;
    };

    // KPI 통계 계산
    const productions = state.productions || [];
    const todayProds = productions.filter(p => p.prodDate === todayStr);
    const todayTotalQty = todayProds.reduce((acc, cur) => acc + Number(cur.qty || 0), 0);
    const monthProds = productions.filter(p => p.prodDate && p.prodDate.slice(0, 7) === todayStr.slice(0, 7));
    const monthTotalQty = monthProds.reduce((acc, cur) => acc + Number(cur.qty || 0), 0);
    const totalLotsCount = new Set(productions.map(p => p.lotNo)).size;
    const workOrders = state.workOrders || [];
    const activeWoCount = workOrders.filter(w => w.status !== 'COMPLETED').length;

    container.innerHTML = `
    <section id="tab-content-production" class="space-y-6">
        <!-- 상단 헤더 & 브리핑 -->
        <div class="bg-gradient-to-r from-blue-900 via-indigo-950 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg border border-blue-900/50 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            생산·블렌딩·충진 실적 & 작업지시서
                        </span>
                        <span class="text-xs text-blue-200 font-mono">대림오일 스마트 제조 연동</span>
                    </div>
                    <h2 class="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2.5">
                        <i data-lucide="factory" class="w-6 h-6 text-blue-400"></i>
                        <span>생산 입고 & 원액 배합 작업지시서 QR 관리</span>
                    </h2>
                    <p class="text-xs text-slate-300">완제품 충진/포장뿐만 아니라 원액(Bulk Oil) 블렌딩, 반제품 제조 시 투입 원료 및 부자재를 등록하여 자동 차감(USE)하고, QR코드가 포함된 작업지시서를 발행/인쇄합니다.</p>
                </div>
                <div class="flex items-center flex-wrap gap-2">
                    <button type="button" id="btn-export-prod-csv" class="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/20">
                        <i data-lucide="file-spreadsheet" class="w-4 h-4 text-emerald-400"></i>
                        <span>생산 실적 CSV</span>
                    </button>
                    <button type="button" onclick="window.print()" class="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>생산 일지 인쇄</span>
                    </button>
                </div>
            </div>

            <!-- 서브 내비게이션 탭 -->
            <div class="flex items-center gap-2 pt-1 border-b border-white/10 pb-2">
                <button type="button" id="subtab-btn-production" class="px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 ${currentSubTab === 'production' ? 'bg-blue-600 text-white shadow-md' : 'bg-white/10 text-slate-300 hover:bg-white/20'}">
                    <i data-lucide="package-plus" class="w-4 h-4"></i>
                    <span>생산 입고 등록 & 실적 대장</span>
                </button>
                <button type="button" id="subtab-btn-workorders" class="px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 ${currentSubTab === 'workorders' ? 'bg-blue-600 text-white shadow-md' : 'bg-white/10 text-slate-300 hover:bg-white/20'}">
                    <i data-lucide="qr-code" class="w-4 h-4 text-amber-300"></i>
                    <span>원액생산 작업지시서 발행 & QR 관리</span>
                    <span class="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400/30 text-amber-200 font-mono">${activeWoCount}건 대기</span>
                </button>
            </div>

            <!-- 핵심 생산 지표 KPI 카드 -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition">
                    <div class="flex items-center justify-between text-slate-300 text-[11px] font-bold">
                        <span>금일 생산 입고량</span>
                        <i data-lucide="package-check" class="w-4 h-4 text-emerald-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span class="text-2xl font-black text-emerald-400 font-mono">${todayTotalQty.toLocaleString()}</span>
                        <span class="text-xs text-slate-300">개/L</span>
                    </div>
                    <span class="text-[11px] text-slate-400 mt-1 block">오늘 완료: ${todayProds.length}건</span>
                </div>

                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition">
                    <div class="flex items-center justify-between text-slate-300 text-[11px] font-bold">
                        <span>당월 누적 생산 실적</span>
                        <i data-lucide="calendar-check-2" class="w-4 h-4 text-sky-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span class="text-2xl font-black text-sky-400 font-mono">${monthTotalQty.toLocaleString()}</span>
                        <span class="text-xs text-slate-300">개/L</span>
                    </div>
                    <span class="text-[11px] text-slate-400 mt-1 block">당월 누적: ${monthProds.length}건</span>
                </div>

                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition">
                    <div class="flex items-center justify-between text-slate-300 text-[11px] font-bold">
                        <span>원액 작업지시서</span>
                        <i data-lucide="clipboard-list" class="w-4 h-4 text-amber-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span class="text-2xl font-black text-amber-400 font-mono">${workOrders.length}</span>
                        <span class="text-xs text-slate-300">건</span>
                    </div>
                    <span class="text-[11px] text-amber-300/80 mt-1 block">스캔 수불 대기: ${activeWoCount}건</span>
                </div>

                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition">
                    <div class="flex items-center justify-between text-slate-300 text-[11px] font-bold">
                        <span>관리 중인 생산 LOT</span>
                        <i data-lucide="layers" class="w-4 h-4 text-purple-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span class="text-2xl font-black text-purple-400 font-mono">${totalLotsCount}</span>
                        <span class="text-xs text-slate-300">개 로트</span>
                    </div>
                    <span class="text-[11px] text-slate-400 mt-1 block">전 공정 이력 추적</span>
                </div>
            </div>
        </div>

        <!-- ============================================================= -->
        <!-- 서브 탭 1: 생산 입고 등록 & 최근 생산 실적 (production) -->
        <!-- ============================================================= -->
        <div id="subtab-view-production" class="${currentSubTab === 'production' ? 'block' : 'hidden'} space-y-6">
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <!-- 좌측: 생산 입고 등록 폼 -->
                <div class="lg:col-span-5 space-y-4">
                    <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                                <i data-lucide="plus-circle" class="w-4 h-4 text-blue-600"></i>
                                <span>신규 제품/원액 생산 입고 등록</span>
                            </h3>
                            <span class="text-[11px] font-bold text-slate-400">창고 재고 자동 입고</span>
                        </div>

                        <!-- 생산 대상 구분 선택 (완제품 / 원액 / 반제품) -->
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1.5">생산 대상 구분 <span class="text-rose-500">*</span></label>
                            <div class="grid grid-cols-3 gap-1.5 bg-slate-100 p-1 rounded-xl">
                                <button type="button" class="btn-prod-type-select py-1.5 text-xs font-black rounded-lg transition ${selectedProdType === '완제품' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}" data-type="완제품">
                                    📦 완제품 (포장)
                                </button>
                                <button type="button" class="btn-prod-type-select py-1.5 text-xs font-black rounded-lg transition ${selectedProdType === '원액' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}" data-type="원액">
                                    🛢️ 원액 (블렌딩)
                                </button>
                                <button type="button" class="btn-prod-type-select py-1.5 text-xs font-black rounded-lg transition ${selectedProdType === '반제품' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}" data-type="반제품">
                                    ⚙️ 반제품 (가공)
                                </button>
                            </div>
                        </div>

                        <form id="form-production-inbound" class="space-y-3">
                            <!-- 생산 품목 선택 & 검색 -->
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">
                                    <span id="label-prod-target">생산 품목</span> 선택 <span class="text-rose-500">*</span>
                                </label>
                                <input type="text" id="prod-item-search" placeholder="품목명 또는 코드 검색..." class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-medium mb-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                                <select id="prod-item-code" required class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                    <!-- 동적으로 채워짐 -->
                                </select>
                            </div>

                            <!-- 생산 수량 및 포장 단위 -->
                            <div class="grid grid-cols-2 gap-2">
                                <div>
                                    <label class="block text-xs font-bold text-slate-700 mb-1">생산 수량 <span class="text-rose-500">*</span></label>
                                    <div class="relative flex items-center">
                                        <input type="number" id="prod-qty" min="0.1" step="any" value="20" required class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-black text-blue-600 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                                        <span id="badge-prod-unit" class="absolute right-3 text-xs font-bold text-slate-400">EA</span>
                                    </div>
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-700 mb-1">보관/포장 용기 규격</label>
                                    <select id="prod-packaging" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                        <option value="200L 드럼" selected>200L 드럼 (DRUM)</option>
                                        <option value="1,000L IBC">1,000L IBC 탱크</option>
                                        <option value="벌크/탱크로리">벌크/탱크로리</option>
                                        <option value="20L 페일">20L 페일 (PAIL)</option>
                                        <option value="4L 캔">4L 캔 (CAN)</option>
                                        <option value="1L 용기">1L 용기 (BOTTLE)</option>
                                        <option value="개별 박스">개별 박스 (BOX)</option>
                                    </select>
                                </div>
                            </div>

                            <!-- 입고 창고 및 작업자 -->
                            <div class="grid grid-cols-2 gap-2">
                                <div>
                                    <label class="block text-xs font-bold text-slate-700 mb-1">입고 대상 거점/창고</label>
                                    <select id="prod-location" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                        ${state.locations.map(loc => `<option value="${loc}" ${loc.includes('김포') || loc.includes('공장') ? 'selected' : ''}>${loc}</option>`).join('')}
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-700 mb-1">생산 담당자</label>
                                    <select id="prod-worker" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                        ${state.workers.map(w => `<option value="${w.name} (${w.role || w.dept})" ${w.name.includes('생산') ? 'selected' : ''}>${w.name} (${w.role || w.dept})</option>`).join('')}
                                    </select>
                                </div>
                            </div>

                            <!-- LOT 번호 및 자동 채번 버튼 -->
                            <div>
                                <div class="flex items-center justify-between mb-1">
                                    <label class="text-xs font-bold text-slate-700">생산 LOT 번호 <span class="text-rose-500">*</span></label>
                                    <button type="button" id="btn-auto-lot" class="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1">
                                        <i data-lucide="refresh-cw" class="w-3 h-3"></i>
                                        <span>자동 채번</span>
                                    </button>
                                </div>
                                <input type="text" id="prod-lot-no" required value="LOT-${todayStr.replace(/-/g, '')}-01" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>

                            <!-- 제조일자 및 품질유효기간 -->
                            <div class="grid grid-cols-2 gap-2">
                                <div>
                                    <label class="block text-xs font-bold text-slate-700 mb-1">제조일자</label>
                                    <input type="date" id="prod-mfg-date" value="${todayStr}" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-700 mb-1">품질 유효기한</label>
                                    <input type="date" id="prod-exp-date" value="${expDateStr}" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                                </div>
                            </div>

                            <!-- 원부자재(BOM) 자동 소모 및 투입 등록 섹션 -->
                            <div class="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-3">
                                <div class="flex items-center justify-between">
                                    <label class="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" id="chk-bom-deduct" checked class="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                                        <span class="text-xs font-black text-slate-900">사용 원료 및 부자재 자동 차감 (USE -)</span>
                                    </label>
                                    <button type="button" id="btn-quick-fill-recipe" class="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                                        <i data-lucide="sparkles" class="w-3 h-3"></i>
                                        <span>추천 배합비 자동입력</span>
                                    </button>
                                </div>

                                <div id="materials-wrapper" class="space-y-3 pt-2 border-t border-slate-200">
                                    <!-- 1. 투입 원료 섹션 -->
                                    <div class="space-y-1.5">
                                        <div class="flex items-center justify-between text-[11px] font-black text-slate-700">
                                            <span class="flex items-center gap-1 text-blue-700">
                                                <i data-lucide="droplet" class="w-3.5 h-3.5"></i>
                                                <span>1. 사용 원료 투입 등록 (기유, 첨가제 등)</span>
                                            </span>
                                            <button type="button" id="btn-add-raw-row" class="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-0.5">
                                                <i data-lucide="plus" class="w-3 h-3"></i> 원료 추가
                                            </button>
                                        </div>
                                        <div id="raw-rows-list" class="space-y-1.5">
                                            <!-- 동적 원료 행 -->
                                        </div>
                                    </div>

                                    <!-- 2. 투입 부자재 섹션 -->
                                    <div class="space-y-1.5 pt-2 border-t border-slate-200/80">
                                        <div class="flex items-center justify-between text-[11px] font-black text-slate-700">
                                            <span class="flex items-center gap-1 text-emerald-700">
                                                <i data-lucide="box" class="w-3.5 h-3.5"></i>
                                                <span>2. 사용 부자재 투입 등록 (드럼, 페일, 캡, 라벨 등)</span>
                                            </span>
                                            <button type="button" id="btn-add-sub-row" class="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-0.5">
                                                <i data-lucide="plus" class="w-3 h-3"></i> 부자재 추가
                                            </button>
                                        </div>
                                        <div id="sub-rows-list" class="space-y-1.5">
                                            <!-- 동적 부자재 행 -->
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- 비고 / 점도 / 성적서 메모 -->
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">생산 비고 / 배합 결과 메모</label>
                                <input type="text" id="prod-notes" placeholder="예: 비중 0.852, 40℃ 동점도 68.2cSt 합격, 밀봉 완료" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>

                            <div class="pt-2">
                                <button type="submit" id="btn-submit-production" class="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl text-xs transition shadow-md flex items-center justify-center gap-2">
                                    <i data-lucide="check-circle" class="w-4 h-4"></i>
                                    <span id="btn-submit-text">생산 입고 및 원부자재 자동 차감 처리</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                <!-- 우측: 생산 실적 이력 테이블 & 빠른 라벨 인쇄 안내 -->
                <div class="lg:col-span-7 space-y-4">
                    <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                            <div>
                                <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                                    <i data-lucide="list" class="w-4 h-4 text-blue-600"></i>
                                    <span>최근 생산 입고 실적 대장</span>
                                </h3>
                                <p class="text-xs text-slate-500 mt-0.5">완제품, 원액, 반제품 입고 실적 및 투입 원부자재 차감 이력</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <select id="prod-history-filter-type" class="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold focus:outline-none">
                                    <option value="ALL">전체 품목 구분</option>
                                    <option value="완제품">완제품</option>
                                    <option value="원액">원액</option>
                                    <option value="반제품">반제품</option>
                                </select>
                                <input type="text" id="prod-history-search" placeholder="품목명, LOT 검색..." class="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                        </div>

                        <!-- 생산 실적 테이블 -->
                        <div class="overflow-x-auto rounded-xl border border-slate-200">
                            <table class="w-full text-left text-xs text-slate-700">
                                <thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                                    <tr>
                                        <th class="p-2.5 whitespace-nowrap">생산일자</th>
                                        <th class="p-2.5 whitespace-nowrap">구분</th>
                                        <th class="p-2.5 whitespace-nowrap">LOT 번호</th>
                                        <th class="p-2.5">생산품명</th>
                                        <th class="p-2.5 whitespace-nowrap">생산량</th>
                                        <th class="p-2.5 whitespace-nowrap">입고창고</th>
                                        <th class="p-2.5 whitespace-nowrap">원부자재차감</th>
                                        <th class="p-2.5 whitespace-nowrap text-center">관리/라벨</th>
                                    </tr>
                                </thead>
                                <tbody id="prod-history-tbody" class="divide-y divide-slate-100">
                                    <!-- 렌더링 함수에서 채워짐 -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ============================================================= -->
        <!-- 서브 탭 2: 원액생산 작업지시서 발행 & QR 관리 (workorders) -->
        <!-- ============================================================= -->
        <div id="subtab-view-workorders" class="${currentSubTab === 'workorders' ? 'block' : 'hidden'} space-y-6">
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                        <h3 class="font-extrabold text-base text-slate-900 flex items-center gap-2">
                            <i data-lucide="clipboard-list" class="w-5 h-5 text-blue-600"></i>
                            <span>원액생산 작업지시서(Work Order) 발행 및 QR코드 발급</span>
                        </h3>
                        <p class="text-xs text-slate-500 mt-0.5">배합 레시피와 투입 원부자재가 명시된 작업지시서를 생성하고 현장 부착용 QR코드를 인쇄합니다. 현장에서 스캔 즉시 생산입고 및 원부자재가 자동 수불 처리됩니다.</p>
                    </div>
                    <button type="button" id="btn-open-new-wo-modal" class="px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl text-xs transition shadow-md flex items-center gap-1.5">
                        <i data-lucide="plus" class="w-4 h-4"></i>
                        <span>새 작업지시서 발행 (레시피 배합)</span>
                    </button>
                </div>

                <!-- 작업지시서 목록 테이블 -->
                <div class="overflow-x-auto rounded-xl border border-slate-200">
                    <table class="w-full text-left text-xs text-slate-700">
                        <thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                            <tr>
                                <th class="p-2.5 whitespace-nowrap">지시서 번호</th>
                                <th class="p-2.5 whitespace-nowrap">유형</th>
                                <th class="p-2.5">생산 대상 품목</th>
                                <th class="p-2.5 whitespace-nowrap">계획 수량</th>
                                <th class="p-2.5 whitespace-nowrap">부여 LOT</th>
                                <th class="p-2.5 whitespace-nowrap">투입 원부자재</th>
                                <th class="p-2.5 whitespace-nowrap text-center">진행 상태</th>
                                <th class="p-2.5 whitespace-nowrap text-center">현장 QR / 수불 실행</th>
                            </tr>
                        </thead>
                        <tbody id="work-orders-tbody" class="divide-y divide-slate-100">
                            <!-- 동적 렌더링 -->
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- 모달 컨테이너 (작업지시서 신규 생성 & 인쇄 서식) -->
        <div id="wo-modal-backdrop" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div id="wo-modal-card" class="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
                <!-- 모달 콘텐츠 동적 주입 -->
            </div>
        </div>
    </section>
    `;

    // 아이콘 생성
    createIcons({ icons });

    // 서브 탭 전환 로직
    const subtabBtnProd = container.querySelector('#subtab-btn-production');
    const subtabBtnWo = container.querySelector('#subtab-btn-workorders');
    const subtabViewProd = container.querySelector('#subtab-view-production');
    const subtabViewWo = container.querySelector('#subtab-view-workorders');

    const switchSubTab = (tabName) => {
        currentSubTab = tabName;
        if (tabName === 'production') {
            subtabViewProd.classList.remove('hidden');
            subtabViewWo.classList.add('hidden');
            subtabBtnProd.className = 'px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 bg-blue-600 text-white shadow-md';
            subtabBtnWo.className = 'px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 bg-white/10 text-slate-300 hover:bg-white/20';
        } else {
            subtabViewProd.classList.add('hidden');
            subtabViewWo.classList.remove('hidden');
            subtabBtnProd.className = 'px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 bg-white/10 text-slate-300 hover:bg-white/20';
            subtabBtnWo.className = 'px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 bg-blue-600 text-white shadow-md';
            renderWorkOrdersTable();
        }
        createIcons({ icons });
    };

    subtabBtnProd?.addEventListener('click', () => switchSubTab('production'));
    subtabBtnWo?.addEventListener('click', () => switchSubTab('workorders'));

    // 생산 대상 구분(완제품 / 원액 / 반제품) 변경 시 폼 갱신
    const selectItemDropdown = container.querySelector('#prod-item-code');
    const prodUnitBadge = container.querySelector('#badge-prod-unit');
    const labelProdTarget = container.querySelector('#label-prod-target');

    const updateProductDropdown = () => {
        const items = getItemsForType(selectedProdType);
        labelProdTarget.textContent = `${selectedProdType} 품목`;
        if (selectedProdType === '원액') {
            prodUnitBadge.textContent = 'L';
            container.querySelector('#prod-packaging').value = '1,000L IBC';
        } else if (selectedProdType === '반제품') {
            prodUnitBadge.textContent = 'KG';
            container.querySelector('#prod-packaging').value = '200L 드럼';
        } else {
            prodUnitBadge.textContent = 'EA';
            container.querySelector('#prod-packaging').value = '200L 드럼';
        }

        if (items.length === 0) {
            selectItemDropdown.innerHTML = '<option value="">해당 분류의 품목이 없습니다</option>';
        } else {
            selectItemDropdown.innerHTML = items.slice(0, 60).map(m => `
                <option value="${m.code}">[${m.code}] ${m.name} (${m.spec || '-'})</option>
            `).join('');
        }
    };

    container.querySelectorAll('.btn-prod-type-select').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedProdType = btn.getAttribute('data-type');
            container.querySelectorAll('.btn-prod-type-select').forEach(b => {
                b.className = 'btn-prod-type-select py-1.5 text-xs font-black rounded-lg transition text-slate-600 hover:text-slate-900';
            });
            btn.className = 'btn-prod-type-select py-1.5 text-xs font-black rounded-lg transition bg-white text-blue-700 shadow-xs';
            updateProductDropdown();
        });
    });

    updateProductDropdown();

    // 품목 검색 필터링
    const prodSearchInput = container.querySelector('#prod-item-search');
    prodSearchInput?.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        const matches = searchMasterItems(q, 40);
        if (matches.length === 0) {
            selectItemDropdown.innerHTML = '<option value="">일치하는 품목 없음</option>';
        } else {
            selectItemDropdown.innerHTML = matches.map(m => `
                <option value="${m.code}">[${m.code}] ${m.name} (${m.category})</option>
            `).join('');
        }
    });

    // 자동 LOT 번호 채번
    container.querySelector('#btn-auto-lot')?.addEventListener('click', () => {
        const d = new Date();
        const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
        const prefix = selectedProdType === '원액' ? 'B' : selectedProdType === '반제품' ? 'S' : 'A';
        const rnd = String(Math.floor(Math.random() * 90) + 10);
        const lotInput = container.querySelector('#prod-lot-no');
        if (lotInput) {
            lotInput.value = `LOT-${ymd}-${prefix}${rnd}`;
            showToast(`새로운 ${selectedProdType} LOT 번호 '${lotInput.value}'가 채번되었습니다.`);
        }
    });

    // ==========================================
    // 원료 & 부자재 동적 행 관리
    // ==========================================
    const rawRowsList = container.querySelector('#raw-rows-list');
    const subRowsList = container.querySelector('#sub-rows-list');
    const materialsWrapper = container.querySelector('#materials-wrapper');
    const chkBom = container.querySelector('#chk-bom-deduct');

    chkBom?.addEventListener('change', (e) => {
        if (e.target.checked) {
            materialsWrapper.classList.remove('hidden');
        } else {
            materialsWrapper.classList.add('hidden');
        }
    });

    // 재고량 가져오기 헬퍼
    const getStockQty = (code, location) => {
        const inv = state.inventory.find(i => i.code === code && i.location === location);
        return inv ? Number(inv.quantity) : 0;
    };

    // 원료 행 추가 함수
    const addRawRow = (defaultCode = '', defaultQty = 100, defaultLoc = '김포공장') => {
        const rawItems = state.master.filter(m => m.category === '원료' || m.category === '원액' || m.name?.includes('기유') || m.name?.includes('첨가제') || m.code?.includes('1001') || m.code?.includes('1003'));
        const candidateItems = rawItems.length > 0 ? rawItems : state.master;

        const row = document.createElement('div');
        row.className = 'raw-row flex flex-wrap sm:flex-nowrap items-center gap-1.5 bg-white p-2 rounded-xl border border-blue-200 text-xs shadow-xs';
        
        const initialCode = defaultCode || (candidateItems[0] ? candidateItems[0].code : '');
        const currentStock = getStockQty(initialCode, defaultLoc);

        row.innerHTML = `
            <div class="flex-1 min-w-[140px]">
                <select class="item-select w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-800">
                    ${candidateItems.map(m => `<option value="${m.code}" ${m.code === initialCode ? 'selected' : ''}>[${m.code}] ${m.name}</option>`).join('')}
                </select>
            </div>
            <div class="w-20">
                <input type="number" min="0.1" step="any" value="${defaultQty}" placeholder="수량" class="item-qty w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-black text-right text-blue-700" />
            </div>
            <span class="text-[11px] font-bold text-slate-400">L</span>
            <div class="w-28">
                <select class="item-loc w-full bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 text-[11px] font-bold">
                    ${state.locations.map(l => `<option value="${l}" ${l === defaultLoc ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
            </div>
            <div class="stock-badge text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${currentStock >= defaultQty ? 'bg-blue-50 text-blue-700' : 'bg-rose-50 text-rose-600'}">
                재고: ${currentStock.toLocaleString()}L
            </div>
            <button type="button" class="btn-remove-row text-slate-400 hover:text-rose-600 p-1">
                <i data-lucide="x" class="w-3.5 h-3.5"></i>
            </button>
        `;

        const updateStockIndicator = () => {
            const code = row.querySelector('.item-select').value;
            const loc = row.querySelector('.item-loc').value;
            const qty = Number(row.querySelector('.item-qty').value) || 0;
            const st = getStockQty(code, loc);
            const badge = row.querySelector('.stock-badge');
            badge.textContent = `재고: ${st.toLocaleString()}L`;
            if (st >= qty) {
                badge.className = 'stock-badge text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap bg-blue-50 text-blue-700';
            } else {
                badge.className = 'stock-badge text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap bg-rose-50 text-rose-600';
            }
        };

        row.querySelector('.item-select')?.addEventListener('change', updateStockIndicator);
        row.querySelector('.item-loc')?.addEventListener('change', updateStockIndicator);
        row.querySelector('.item-qty')?.addEventListener('input', updateStockIndicator);
        row.querySelector('.btn-remove-row')?.addEventListener('click', () => row.remove());

        rawRowsList.appendChild(row);
        createIcons({ icons });
    };

    // 부자재 행 추가 함수
    const addSubRow = (defaultCode = '', defaultQty = 10, defaultLoc = '김포공장') => {
        const subItems = state.master.filter(m => m.category === '부자재' || m.category === '소모품' || m.name?.includes('드럼') || m.name?.includes('페일') || m.name?.includes('용기') || m.name?.includes('캡') || m.code?.includes('1007'));
        const candidateItems = subItems.length > 0 ? subItems : state.master;

        const row = document.createElement('div');
        row.className = 'sub-row flex flex-wrap sm:flex-nowrap items-center gap-1.5 bg-white p-2 rounded-xl border border-emerald-200 text-xs shadow-xs';
        
        const initialCode = defaultCode || (candidateItems[0] ? candidateItems[0].code : '');
        const currentStock = getStockQty(initialCode, defaultLoc);

        row.innerHTML = `
            <div class="flex-1 min-w-[140px]">
                <select class="item-select w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-800">
                    ${candidateItems.map(m => `<option value="${m.code}" ${m.code === initialCode ? 'selected' : ''}>[${m.code}] ${m.name}</option>`).join('')}
                </select>
            </div>
            <div class="w-20">
                <input type="number" min="1" step="1" value="${defaultQty}" placeholder="수량" class="item-qty w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-black text-right text-emerald-700" />
            </div>
            <span class="text-[11px] font-bold text-slate-400">EA</span>
            <div class="w-28">
                <select class="item-loc w-full bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 text-[11px] font-bold">
                    ${state.locations.map(l => `<option value="${l}" ${l === defaultLoc ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
            </div>
            <div class="stock-badge text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${currentStock >= defaultQty ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}">
                재고: ${currentStock.toLocaleString()}EA
            </div>
            <button type="button" class="btn-remove-row text-slate-400 hover:text-rose-600 p-1">
                <i data-lucide="x" class="w-3.5 h-3.5"></i>
            </button>
        `;

        const updateStockIndicator = () => {
            const code = row.querySelector('.item-select').value;
            const loc = row.querySelector('.item-loc').value;
            const qty = Number(row.querySelector('.item-qty').value) || 0;
            const st = getStockQty(code, loc);
            const badge = row.querySelector('.stock-badge');
            badge.textContent = `재고: ${st.toLocaleString()}EA`;
            if (st >= qty) {
                badge.className = 'stock-badge text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap bg-emerald-50 text-emerald-700';
            } else {
                badge.className = 'stock-badge text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap bg-rose-50 text-rose-600';
            }
        };

        row.querySelector('.item-select')?.addEventListener('change', updateStockIndicator);
        row.querySelector('.item-loc')?.addEventListener('change', updateStockIndicator);
        row.querySelector('.item-qty')?.addEventListener('input', updateStockIndicator);
        row.querySelector('.btn-remove-row')?.addEventListener('click', () => row.remove());

        subRowsList.appendChild(row);
        createIcons({ icons });
    };

    container.querySelector('#btn-add-raw-row')?.addEventListener('click', () => addRawRow());
    container.querySelector('#btn-add-sub-row')?.addEventListener('click', () => addSubRow());

    // 추천 배합비 자동 채우기
    const quickFillRecipe = () => {
        rawRowsList.innerHTML = '';
        subRowsList.innerHTML = '';
        const curLoc = container.querySelector('#prod-location').value;
        const curQty = Number(container.querySelector('#prod-qty').value) || 20;

        if (selectedProdType === '원액') {
            // 원액 블렌딩: 기유 85% + 첨가제 15%
            const baseOilQty = Math.round(curQty * 0.85);
            const addQty = Math.round(curQty * 0.15);
            addRawRow('ITEM-1001', baseOilQty, curLoc);
            addRawRow('ITEM-1003', addQty, curLoc);
            showToast(`✨ 원액 블렌딩 표준 배합비(기유 85% + 첨가기어유 15%)가 적용되었습니다.`);
        } else {
            // 완제품 충진: 원액/기유 소모 + 드럼/용기 소모
            addRawRow('ITEM-1001', curQty * 200, curLoc);
            addSubRow('ITEM-1007', curQty, curLoc);
            showToast(`✨ 완제품 충진 포장 소요 자재(기유 및 200L 드럼 ${curQty}EA)가 자동 입력되었습니다.`);
        }
    };

    container.querySelector('#btn-quick-fill-recipe')?.addEventListener('click', quickFillRecipe);

    // 초기 행 기본 추가
    addRawRow('ITEM-1001', 3800, '김포공장');
    addSubRow('ITEM-1007', 20, '김포공장');

    // ==========================================
    // 생산 실적 테이블 렌더링
    // ==========================================
    const renderTable = (query = '', filterType = historyFilterType) => {
        const tbody = container.querySelector('#prod-history-tbody');
        if (!tbody) return;

        let list = state.productions || [];
        if (filterType && filterType !== 'ALL') {
            list = list.filter(p => (p.prodType || '완제품') === filterType);
        }

        if (query) {
            const lower = query.toLowerCase();
            list = list.filter(p => 
                (p.itemName && p.itemName.toLowerCase().includes(lower)) ||
                (p.itemCode && p.itemCode.toLowerCase().includes(lower)) ||
                (p.lotNo && p.lotNo.toLowerCase().includes(lower)) ||
                (p.workOrderNo && p.workOrderNo.toLowerCase().includes(lower))
            );
        }

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400 font-bold">생산 입고 실적 내역이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(item => {
            const prodTypeBadge = item.prodType === '원액'
                ? '<span class="px-1.5 py-0.5 text-[10px] font-black bg-blue-100 text-blue-800 rounded">원액</span>'
                : item.prodType === '반제품'
                ? '<span class="px-1.5 py-0.5 text-[10px] font-black bg-amber-100 text-amber-800 rounded">반제품</span>'
                : '<span class="px-1.5 py-0.5 text-[10px] font-black bg-emerald-100 text-emerald-800 rounded">완제품</span>';

            const matCount = (item.bomDetails || []).length;
            const matSummary = matCount > 0 
                ? `<span class="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded" title="${(item.bomDetails || []).map(b => `${b.name || b.code}: ${b.qty}${b.unit || ''}`).join(', ')}">자동차감 (${matCount}종)</span>`
                : `<span class="px-1.5 py-0.5 text-[10px] text-slate-400">단순입고</span>`;

            return `
            <tr class="hover:bg-slate-50/80 transition">
                <td class="p-2.5 whitespace-nowrap font-mono text-slate-600 text-[11px]">${item.prodDate || '-'}</td>
                <td class="p-2.5 whitespace-nowrap">${prodTypeBadge}</td>
                <td class="p-2.5 whitespace-nowrap font-mono font-black text-blue-600 text-[11px]">
                    <span class="px-2 py-0.5 bg-blue-50 border border-blue-200 rounded-md">${item.lotNo}</span>
                    ${item.workOrderNo ? `<span class="block text-[9px] text-slate-400 font-mono mt-0.5">${item.workOrderNo}</span>` : ''}
                </td>
                <td class="p-2.5">
                    <div class="font-extrabold text-slate-900 text-xs">${item.itemName}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${item.itemCode}</div>
                </td>
                <td class="p-2.5 whitespace-nowrap font-bold text-slate-900">
                    ${Number(item.qty).toLocaleString()} <span class="text-[10px] text-slate-500 font-normal">(${item.packaging || item.unit || '단위'})</span>
                </td>
                <td class="p-2.5 whitespace-nowrap text-xs font-semibold text-slate-700">${item.location || '-'}</td>
                <td class="p-2.5 whitespace-nowrap">${matSummary}</td>
                <td class="p-2.5 whitespace-nowrap text-center">
                    <div class="flex items-center justify-center gap-1">
                        <button type="button" class="btn-jump-label px-2.5 py-1 bg-slate-900 hover:bg-black text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition shadow-xs" data-code="${item.itemCode}" data-lot="${item.lotNo}" data-mfg="${item.mfgDate || ''}" data-exp="${item.expDate || ''}">
                            <i data-lucide="qr-code" class="w-3 h-3 text-blue-400"></i>
                            <span>라벨</span>
                        </button>
                        <button type="button" class="btn-del-prod text-slate-400 hover:text-rose-600 p-1" data-id="${item.id}" title="실적 삭제">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        // 이벤트 바인딩
        tbody.querySelectorAll('.btn-jump-label').forEach(btn => {
            btn.addEventListener('click', () => {
                const code = btn.getAttribute('data-code');
                const lot = btn.getAttribute('data-lot');
                const mfg = btn.getAttribute('data-mfg');
                const exp = btn.getAttribute('data-exp');

                window.__labelPrefill = { code, lot, mfg, exp };
                showToast(`[${lot}] 라벨 인쇄 탭으로 이동합니다.`);
                onSwitchTab('label');
            });
        });

        tbody.querySelectorAll('.btn-del-prod').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                if (confirm('해당 생산 실적 기록을 삭제하시겠습니까? (창고 재고는 자동 롤백되지 않습니다)')) {
                    await deleteProductionRecord(id);
                    showToast('생산 실적 기록이 삭제되었습니다.');
                    renderTable();
                }
            });
        });

        createIcons({ icons });
    };

    container.querySelector('#prod-history-search')?.addEventListener('input', (e) => {
        renderTable(e.target.value.trim(), historyFilterType);
    });

    container.querySelector('#prod-history-filter-type')?.addEventListener('change', (e) => {
        historyFilterType = e.target.value;
        renderTable(container.querySelector('#prod-history-search')?.value.trim() || '', historyFilterType);
    });

    // ==========================================
    // 생산 입고 폼 제출 처리
    // ==========================================
    const form = container.querySelector('#form-production-inbound');
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const prodItemCode = container.querySelector('#prod-item-code').value;
        const prodQty = Number(container.querySelector('#prod-qty').value);
        const packaging = container.querySelector('#prod-packaging').value;
        const location = container.querySelector('#prod-location').value;
        const worker = container.querySelector('#prod-worker').value;
        const lotNo = container.querySelector('#prod-lot-no').value.trim();
        const mfgDate = container.querySelector('#prod-mfg-date').value;
        const expDate = container.querySelector('#prod-exp-date').value;
        const notes = container.querySelector('#prod-notes').value.trim();
        const bomDeducted = container.querySelector('#chk-bom-deduct').checked;

        // 원료 목록 수집
        const rawMaterials = [];
        if (bomDeducted) {
            container.querySelectorAll('.raw-row').forEach(row => {
                const bCode = row.querySelector('.item-select').value;
                const bQty = Number(row.querySelector('.item-qty').value);
                const bLoc = row.querySelector('.item-loc').value;
                const mItem = state.master.find(m => m.code === bCode);
                if (bCode && bQty > 0) {
                    rawMaterials.push({
                        code: bCode,
                        name: mItem ? mItem.name : bCode,
                        qty: bQty,
                        unit: 'L',
                        location: bLoc,
                        matType: '원료'
                    });
                }
            });

            // 부자재 목록 수집
            container.querySelectorAll('.sub-row').forEach(row => {
                const bCode = row.querySelector('.item-select').value;
                const bQty = Number(row.querySelector('.item-qty').value);
                const bLoc = row.querySelector('.item-loc').value;
                const mItem = state.master.find(m => m.code === bCode);
                if (bCode && bQty > 0) {
                    rawMaterials.push({
                        code: bCode,
                        name: mItem ? mItem.name : bCode,
                        qty: bQty,
                        unit: 'EA',
                        location: bLoc,
                        matType: '부자재'
                    });
                }
            });
        }

        try {
            const btnSubmit = container.querySelector('#btn-submit-production');
            const btnText = container.querySelector('#btn-submit-text');
            btnSubmit.disabled = true;
            btnText.innerHTML = `<span class="animate-spin mr-1">⏳</span> 생산 및 원부자재 차감 처리 중...`;

            await processProductionInbound({
                prodType: selectedProdType,
                prodItemCode,
                prodQty,
                packaging,
                unit: selectedProdType === '원액' ? 'L' : selectedProdType === '반제품' ? 'KG' : 'EA',
                lotNo,
                mfgDate,
                expDate,
                location,
                worker,
                bomDeducted,
                bomDetails: rawMaterials,
                notes
            });

            showToast(`🎉 [${lotNo}] ${selectedProdType} ${prodQty}개 생산입고 및 원부자재 ${rawMaterials.length}종 자동 차감이 완료되었습니다!`);
            renderProductionManager(container, { showToast, onSwitchTab });
        } catch (err) {
            alert(`생산 입고 실패:\n${err.message}`);
            const btnSubmit = container.querySelector('#btn-submit-production');
            const btnText = container.querySelector('#btn-submit-text');
            btnSubmit.disabled = false;
            btnText.innerHTML = `<span>생산 입고 및 원부자재 자동 차감 처리</span>`;
        }
    });

    // ==========================================
    // 작업지시서(Work Orders) 관리 & QR 렌더링
    // ==========================================
    const renderWorkOrdersTable = () => {
        const tbody = container.querySelector('#work-orders-tbody');
        if (!tbody) return;

        const wos = state.workOrders || [];
        if (wos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400 font-bold">등록된 작업지시서가 없습니다. 상단 '새 작업지시서 발행'을 클릭하세요.</td></tr>`;
            return;
        }

        tbody.innerHTML = wos.map(wo => {
            const isCompleted = wo.status === 'COMPLETED';
            const statusBadge = isCompleted
                ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 flex items-center justify-center gap-1"><i data-lucide="check" class="w-3 h-3"></i>생산완료</span>`
                : `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300 flex items-center justify-center gap-1 animate-pulse"><i data-lucide="clock" class="w-3 h-3 text-amber-600"></i>대기중</span>`;

            const allMats = [...(wo.rawMaterials || []), ...(wo.subMaterials || [])];

            return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-2.5 font-mono font-black text-blue-700 whitespace-nowrap">
                    <span>${wo.orderNo}</span>
                    <span class="block text-[10px] text-slate-400 font-normal">${wo.orderDate || ''}</span>
                </td>
                <td class="p-2.5 whitespace-nowrap">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${wo.prodType === '원액' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-800'}">${wo.prodType || '원액'}</span>
                </td>
                <td class="p-2.5">
                    <div class="font-extrabold text-slate-900 text-xs">${wo.targetItemName}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${wo.targetItemCode}</div>
                </td>
                <td class="p-2.5 whitespace-nowrap font-black text-slate-900">
                    ${Number(wo.targetQty).toLocaleString()} <span class="text-slate-400 font-normal text-[10px]">${wo.unit || 'L'}</span>
                </td>
                <td class="p-2.5 whitespace-nowrap font-mono text-[11px] font-bold text-slate-700">${wo.lotNo}</td>
                <td class="p-2.5 text-[11px] text-slate-600 max-w-[200px] truncate" title="${allMats.map(m => `${m.name}: ${m.qty}${m.unit || ''}`).join(', ')}">
                    ${allMats.length > 0 ? `${allMats[0].name} 외 ${allMats.length - 1}종` : '-'}
                </td>
                <td class="p-2.5 text-center whitespace-nowrap">${statusBadge}</td>
                <td class="p-2.5 text-center whitespace-nowrap">
                    <div class="flex items-center justify-center gap-1.5">
                        <button type="button" class="btn-view-wo-qr px-2.5 py-1 bg-slate-900 hover:bg-black text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition shadow-xs" data-no="${wo.orderNo}">
                            <i data-lucide="printer" class="w-3.5 h-3.5 text-amber-400"></i>
                            <span>지시서 & QR 서식</span>
                        </button>
                        ${!isCompleted ? `
                        <button type="button" class="btn-execute-wo px-2.5 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition shadow-xs" data-no="${wo.orderNo}">
                            <i data-lucide="zap" class="w-3.5 h-3.5"></i>
                            <span>수불 즉시실행</span>
                        </button>
                        ` : ''}
                        <button type="button" class="btn-del-wo text-slate-400 hover:text-rose-600 p-1" data-no="${wo.orderNo}" title="지시서 삭제">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        // 이벤트 바인딩
        tbody.querySelectorAll('.btn-view-wo-qr').forEach(btn => {
            btn.addEventListener('click', () => {
                const orderNo = btn.getAttribute('data-no');
                openWorkOrderPrintModal(orderNo);
            });
        });

        tbody.querySelectorAll('.btn-execute-wo').forEach(btn => {
            btn.addEventListener('click', async () => {
                const orderNo = btn.getAttribute('data-no');
                await executeWorkOrderInbound(orderNo);
            });
        });

        tbody.querySelectorAll('.btn-del-wo').forEach(btn => {
            btn.addEventListener('click', async () => {
                const orderNo = btn.getAttribute('data-no');
                if (confirm(`작업지시서 [${orderNo}]를 삭제하시겠습니까?`)) {
                    await deleteWorkOrder(orderNo);
                    showToast(`작업지시서 [${orderNo}]가 삭제되었습니다.`);
                    renderWorkOrdersTable();
                }
            });
        });

        createIcons({ icons });
    };

    // 작업지시서 즉시 실행 헬퍼
    const executeWorkOrderInbound = async (orderNo) => {
        const wo = (state.workOrders || []).find(w => w.orderNo === orderNo);
        if (!wo) return;

        if (!confirm(`[작업지시서 ${orderNo}]\n생산품: ${wo.targetItemName} ${wo.targetQty}${wo.unit}\n투입 원부자재를 자동 차감하고 생산 입고를 즉시 실행하시겠습니까?`)) {
            return;
        }

        try {
            const allMats = [...(wo.rawMaterials || []), ...(wo.subMaterials || [])];
            await processProductionInbound({
                prodType: wo.prodType || '원액',
                prodItemCode: wo.targetItemCode,
                prodQty: wo.targetQty,
                packaging: wo.packaging || '1,000L IBC',
                unit: wo.unit || 'L',
                lotNo: wo.lotNo,
                location: wo.location || '김포공장',
                worker: wo.worker || state.currentGlobalWorker,
                bomDeducted: true,
                bomDetails: allMats,
                workOrderNo: wo.orderNo,
                notes: `작업지시서 [${wo.orderNo}] 현장 실행 - ${wo.notes || ''}`
            });

            showToast(`🎉 [${wo.orderNo}] 생산 입고 및 원부자재 자동 차감 완료!`);
            renderWorkOrdersTable();
            renderTable();
        } catch (err) {
            alert(`수불 실행 오류:\n${err.message}`);
        }
    };

    // ==========================================
    // 작업지시서 인쇄 & QR 뷰 모달
    // ==========================================
    const modalBackdrop = container.querySelector('#wo-modal-backdrop');
    const modalCard = container.querySelector('#wo-modal-card');

    const openWorkOrderPrintModal = async (orderNo) => {
        const wo = (state.workOrders || []).find(w => w.orderNo === orderNo);
        if (!wo) return;

        const allMats = [...(wo.rawMaterials || []), ...(wo.subMaterials || [])];
        
        // 작업지시서 QR코드 페이로드 생성
        const qrPayload = JSON.stringify({
            type: "WORK_ORDER",
            orderNo: wo.orderNo,
            prodType: wo.prodType || "원액",
            itemCode: wo.targetItemCode,
            itemName: wo.targetItemName,
            qty: wo.targetQty,
            unit: wo.unit || "L",
            packaging: wo.packaging || "1,000L IBC",
            lotNo: wo.lotNo,
            location: wo.location || "김포공장",
            materials: allMats.map(m => ({
                code: m.code,
                name: m.name,
                qty: m.qty,
                unit: m.unit || "L",
                location: m.location || wo.location || "김포공장",
                matType: m.matType || "원료"
            })),
            notes: wo.notes || ""
        });

        let qrDataUrl = '';
        try {
            qrDataUrl = await QRCode.toDataURL(qrPayload, {
                width: 240,
                margin: 1,
                color: { dark: '#000000', light: '#ffffff' }
            });
        } catch (e) {
            console.error('QR 생성 오류:', e);
        }

        modalCard.innerHTML = `
            <div class="p-4 bg-slate-900 text-white flex items-center justify-between no-print">
                <div class="flex items-center gap-2">
                    <i data-lucide="clipboard-check" class="w-5 h-5 text-blue-400"></i>
                    <span class="font-extrabold text-sm">작업지시서 & 현장 연동 QR코드 인쇄 서식</span>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-print-wo" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>서식 인쇄</span>
                    </button>
                    <button type="button" id="btn-jump-scanner-wo" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1">
                        <i data-lucide="scan" class="w-4 h-4"></i>
                        <span>현장 스캐너로 이동</span>
                    </button>
                    <button type="button" id="btn-close-wo-modal" class="text-slate-400 hover:text-white p-1">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>
            </div>

            <!-- 인쇄 영역 -->
            <div id="wo-printable-sheet" class="p-6 overflow-y-auto space-y-4 bg-white text-slate-800 text-xs">
                <!-- 서식 헤더 -->
                <div class="border-b-2 border-slate-900 pb-3 flex items-start justify-between">
                    <div>
                        <span class="px-2 py-0.5 rounded text-[11px] font-black bg-blue-100 text-blue-900 font-mono">DAELIM OIL SMART FACTORY</span>
                        <h1 class="text-xl font-black text-slate-900 mt-1">원액 배합 및 생산 작업지시서 (Work Order)</h1>
                        <p class="text-[11px] text-slate-500 mt-0.5">대림오일 스마트 제조 연동 · 현장 부착 및 바코드 리더기 자동 수불용</p>
                    </div>
                    <div class="text-right">
                        <div class="text-xs font-mono font-black text-blue-700 bg-blue-50 px-2.5 py-1 rounded border border-blue-200">
                            지시번호: ${wo.orderNo}
                        </div>
                        <div class="text-[10px] text-slate-400 mt-1 font-mono">발행일: ${wo.orderDate}</div>
                    </div>
                </div>

                <!-- 지시서 핵심 정보 & QR 코드 -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200 items-center">
                    <div class="md:col-span-2 space-y-2">
                        <div class="grid grid-cols-2 gap-2 text-xs">
                            <div>
                                <span class="text-slate-500 text-[11px] font-bold block">생산 품목 분류</span>
                                <span class="font-extrabold text-blue-700">${wo.prodType || '원액'} 블렌딩 제조</span>
                            </div>
                            <div>
                                <span class="text-slate-500 text-[11px] font-bold block">생산 목표 수량</span>
                                <span class="font-black text-slate-900 text-base font-mono">${Number(wo.targetQty).toLocaleString()} ${wo.unit || 'L'}</span>
                                <span class="text-[10px] text-slate-400">(${wo.packaging || '-'})</span>
                            </div>
                            <div>
                                <span class="text-slate-500 text-[11px] font-bold block">생산 대상 품명</span>
                                <span class="font-black text-slate-900">${wo.targetItemName}</span>
                                <span class="text-[10px] text-slate-400 block font-mono">${wo.targetItemCode}</span>
                            </div>
                            <div>
                                <span class="text-slate-500 text-[11px] font-bold block">부여 LOT 번호</span>
                                <span class="font-black text-indigo-700 font-mono text-sm">${wo.lotNo}</span>
                            </div>
                            <div>
                                <span class="text-slate-500 text-[11px] font-bold block">입고 대상 거점</span>
                                <span class="font-bold text-slate-800">${wo.location || '김포공장'}</span>
                            </div>
                            <div>
                                <span class="text-slate-500 text-[11px] font-bold block">현장 작업 담당자</span>
                                <span class="font-bold text-slate-800">${wo.worker || '-'}</span>
                            </div>
                        </div>

                        ${wo.notes ? `
                        <div class="pt-2 border-t border-slate-200">
                            <span class="text-[10px] font-bold text-slate-500 block">배합 조건 / 작업 특이사항:</span>
                            <p class="text-xs text-slate-700 font-medium">${wo.notes}</p>
                        </div>
                        ` : ''}
                    </div>

                    <!-- 현장 스캔용 QR 코드 -->
                    <div class="text-center flex flex-col items-center justify-center p-3 bg-white rounded-xl border border-slate-200 shadow-xs">
                        <img src="${qrDataUrl}" alt="Work Order QR" class="w-36 h-36 border border-slate-200 rounded-lg p-1 bg-white" />
                        <span class="text-[10px] font-black text-blue-700 mt-1">현장 스캔 자동수불 QR</span>
                        <span class="text-[9px] text-slate-400 font-mono">스캔 시 재고 자동 증감</span>
                    </div>
                </div>

                <!-- 투입 원료 및 부자재 소요 명세서 -->
                <div>
                    <h4 class="font-black text-xs text-slate-900 mb-2 flex items-center gap-1.5">
                        <i data-lucide="layers" class="w-3.5 h-3.5 text-blue-600"></i>
                        <span>배합 투입 원부자재 소요 명세서 (스캔 시 자동 차감)</span>
                    </h4>
                    <table class="w-full text-left text-xs border border-slate-200 rounded-xl overflow-hidden">
                        <thead class="bg-slate-100 font-bold text-slate-600">
                            <tr>
                                <th class="p-2 border-b">구분</th>
                                <th class="p-2 border-b">품목코드</th>
                                <th class="p-2 border-b">자재품명</th>
                                <th class="p-2 border-b text-right">투입 소요량</th>
                                <th class="p-2 border-b">출고 거점</th>
                                <th class="p-2 border-b text-center">차감 상태</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${allMats.map(m => `
                                <tr>
                                    <td class="p-2">
                                        <span class="px-1.5 py-0.2 rounded text-[10px] font-bold ${m.matType === '원료' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}">${m.matType || '자재'}</span>
                                    </td>
                                    <td class="p-2 font-mono text-[11px] text-slate-500">${m.code}</td>
                                    <td class="p-2 font-bold text-slate-900">${m.name}</td>
                                    <td class="p-2 text-right font-black text-blue-700 font-mono">${Number(m.qty).toLocaleString()} ${m.unit || 'L'}</td>
                                    <td class="p-2 text-slate-600">${m.location || wo.location || '김포공장'}</td>
                                    <td class="p-2 text-center">
                                        <span class="text-[10px] font-bold text-slate-400">QR 스캔 시 자동 USE 차감</span>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <!-- 작업 서명란 -->
                <div class="pt-4 border-t border-slate-200 grid grid-cols-3 gap-2 text-center text-[11px]">
                    <div class="border border-slate-200 p-2 rounded-xl">
                        <span class="text-slate-400 block text-[10px]">작업 지시자</span>
                        <span class="font-bold text-slate-800">관리자 (물류총괄) (인)</span>
                    </div>
                    <div class="border border-slate-200 p-2 rounded-xl">
                        <span class="text-slate-400 block text-[10px]">블렌딩/투입 기사</span>
                        <span class="font-bold text-slate-800">${wo.worker || '현장기사'} (인)</span>
                    </div>
                    <div class="border border-slate-200 p-2 rounded-xl">
                        <span class="text-slate-400 block text-[10px]">품질검사 합격 확인</span>
                        <span class="font-bold text-emerald-700">적합 (QC PASS)</span>
                    </div>
                </div>
            </div>
        `;

        modalBackdrop.classList.remove('hidden');
        createIcons({ icons });

        // 이벤트 바인딩
        modalCard.querySelector('#btn-close-wo-modal')?.addEventListener('click', () => {
            modalBackdrop.classList.add('hidden');
        });

        modalCard.querySelector('#btn-print-wo')?.addEventListener('click', () => {
            window.print();
        });

        modalCard.querySelector('#btn-jump-scanner-wo')?.addEventListener('click', () => {
            modalBackdrop.classList.add('hidden');
            // 스캐너에 해당 작업지시서 QR코드 문자열을 프리필 전달
            window.__scannedWorkOrderPrefill = qrPayload;
            showToast(`[${wo.orderNo}] 스캐너 탭으로 이동하여 자동 수불을 처리합니다.`);
            onSwitchTab('scan');
        });
    };

    modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) {
            modalBackdrop.classList.add('hidden');
        }
    });

    // ==========================================
    // 새 작업지시서 생성 모달
    // ==========================================
    const openNewWorkOrderModal = () => {
        const orderNoStr = `WO-${todayStr.replace(/-/g, '')}-${String(Math.floor(Math.random() * 900) + 100)}`;
        const lotNoStr = `LOT-${todayStr.replace(/-/g, '')}-B01`;

        const oilItems = state.master.filter(m => m.category === '원액' || m.category === '완제품' || m.name?.includes('원액') || m.name?.includes('5W-30'));
        const defaultOilList = oilItems.length > 0 ? oilItems : state.master;

        modalCard.innerHTML = `
            <div class="p-4 bg-slate-900 text-white flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <i data-lucide="file-plus" class="w-5 h-5 text-blue-400"></i>
                    <span class="font-extrabold text-sm">새 원액생산 작업지시서 작성 (배합 레시피 & QR 발행)</span>
                </div>
                <button type="button" id="btn-close-wo-modal" class="text-slate-400 hover:text-white p-1">
                    <i data-lucide="x" class="w-5 h-5"></i>
                </button>
            </div>

            <form id="form-create-workorder" class="p-6 overflow-y-auto space-y-4 text-xs">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">작업지시서 번호 <span class="text-rose-500">*</span></label>
                        <input type="text" id="new-wo-no" value="${orderNoStr}" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono font-bold text-blue-700" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">생산 구분</label>
                        <select id="new-wo-type" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold">
                            <option value="원액" selected>🛢️ 원액 (블렌딩 제조)</option>
                            <option value="완제품">📦 완제품 (충진/포장)</option>
                            <option value="반제품">⚙️ 반제품 (가공)</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label class="block font-bold text-slate-700 mb-1">생산 대상 품목 선택 <span class="text-rose-500">*</span></label>
                    <select id="new-wo-item" required class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold text-xs">
                        ${defaultOilList.map(m => `<option value="${m.code}">[${m.code}] ${m.name} (${m.spec || '-'})</option>`).join('')}
                    </select>
                </div>

                <div class="grid grid-cols-3 gap-2">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">생산 계획 수량 <span class="text-rose-500">*</span></label>
                        <input type="number" id="new-wo-qty" min="1" value="1000" required class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-black text-blue-700" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">단위</label>
                        <select id="new-wo-unit" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold">
                            <option value="L" selected>리터 (L)</option>
                            <option value="KG">킬로그램 (KG)</option>
                            <option value="DRUM">드럼 (DRUM)</option>
                            <option value="EA">개 (EA)</option>
                        </select>
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">포장 용기 규격</label>
                        <select id="new-wo-pkg" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold">
                            <option value="1,000L IBC" selected>1,000L IBC</option>
                            <option value="벌크/탱크로리">벌크/탱크로리</option>
                            <option value="200L 드럼">200L 드럼</option>
                            <option value="20L 페일">20L 페일</option>
                        </select>
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-2">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">부여 LOT 번호 <span class="text-rose-500">*</span></label>
                        <input type="text" id="new-wo-lot" value="${lotNoStr}" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono font-bold" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">입고 창고</label>
                        <select id="new-wo-loc" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold">
                            ${state.locations.map(l => `<option value="${l}" ${l.includes('김포') ? 'selected' : ''}>${l}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">작업 담당자</label>
                        <select id="new-wo-worker" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 font-bold">
                            ${state.workers.map(w => `<option value="${w.name} (${w.role || w.dept})">${w.name} (${w.role || w.dept})</option>`).join('')}
                        </select>
                    </div>
                </div>

                <!-- 투입 원부자재 레시피 설정 -->
                <div class="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-3">
                    <div class="flex items-center justify-between font-bold text-slate-800">
                        <span>투입 원료 & 부자재 레시피 (스캔 시 자동 차감)</span>
                        <div class="flex gap-2">
                            <button type="button" id="btn-modal-add-raw" class="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-0.5">
                                + 원료 추가
                            </button>
                            <button type="button" id="btn-modal-add-sub" class="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-0.5">
                                + 부자재 추가
                            </button>
                        </div>
                    </div>
                    <div id="modal-mats-list" class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        <!-- 동적 행 -->
                    </div>
                </div>

                <div>
                    <label class="block font-bold text-slate-700 mb-1">작업 지시 메모 / 배합 특이사항</label>
                    <input type="text" id="new-wo-notes" placeholder="예: 기유 85% + 첨가기어유 15%, 60℃ 교반 유지" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2" />
                </div>

                <div class="pt-2 flex justify-end gap-2">
                    <button type="button" id="btn-cancel-wo" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition">취소</button>
                    <button type="submit" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl text-xs transition shadow-md flex items-center gap-1.5">
                        <i data-lucide="check" class="w-4 h-4"></i>
                        <span>작업지시서 발행 및 QR코드 생성</span>
                    </button>
                </div>
            </form>
        `;

        modalBackdrop.classList.remove('hidden');
        createIcons({ icons });

        const matsList = modalCard.querySelector('#modal-mats-list');

        const addModalMatRow = (type = '원료', defaultCode = '', defaultQty = 100) => {
            const row = document.createElement('div');
            row.className = 'modal-mat-row flex items-center gap-1.5 bg-white p-2 rounded-xl border border-slate-200 text-xs';
            row.innerHTML = `
                <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${type === '원료' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}">${type}</span>
                <select class="mat-select flex-1 bg-transparent border-none text-xs font-bold text-slate-800 focus:outline-none">
                    ${state.master.map(m => `<option value="${m.code}" ${m.code === defaultCode ? 'selected' : ''}>[${m.code}] ${m.name}</option>`).join('')}
                </select>
                <input type="number" min="0.1" step="any" value="${defaultQty}" placeholder="수량" class="mat-qty w-20 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-black text-right" />
                <span class="text-slate-400 text-[10px]">${type === '원료' ? 'L' : 'EA'}</span>
                <button type="button" class="btn-remove-mat text-slate-400 hover:text-rose-600 p-1">
                    <i data-lucide="x" class="w-3.5 h-3.5"></i>
                </button>
            `;

            row.querySelector('.btn-remove-mat')?.addEventListener('click', () => row.remove());
            matsList.appendChild(row);
            createIcons({ icons });
        };

        modalCard.querySelector('#btn-modal-add-raw')?.addEventListener('click', () => addModalMatRow('원료', 'ITEM-1001', 850));
        modalCard.querySelector('#btn-modal-add-sub')?.addEventListener('click', () => addModalMatRow('부자재', 'ITEM-1007', 5));

        // 기본 추천 원료 행 세팅
        addModalMatRow('원료', 'ITEM-1001', 850);
        addModalMatRow('원료', 'ITEM-1003', 150);
        addModalMatRow('부자재', 'ITEM-1007', 5);

        modalCard.querySelector('#btn-close-wo-modal')?.addEventListener('click', () => modalBackdrop.classList.add('hidden'));
        modalCard.querySelector('#btn-cancel-wo')?.addEventListener('click', () => modalBackdrop.classList.add('hidden'));

        modalCard.querySelector('#form-create-workorder')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const orderNo = modalCard.querySelector('#new-wo-no').value.trim();
            const prodType = modalCard.querySelector('#new-wo-type').value;
            const targetItemCode = modalCard.querySelector('#new-wo-item').value;
            const targetQty = Number(modalCard.querySelector('#new-wo-qty').value);
            const unit = modalCard.querySelector('#new-wo-unit').value;
            const packaging = modalCard.querySelector('#new-wo-pkg').value;
            const lotNo = modalCard.querySelector('#new-wo-lot').value.trim();
            const location = modalCard.querySelector('#new-wo-loc').value;
            const worker = modalCard.querySelector('#new-wo-worker').value;
            const notes = modalCard.querySelector('#new-wo-notes').value.trim();

            const targetMaster = state.master.find(m => m.code === targetItemCode);
            const targetItemName = targetMaster ? targetMaster.name : targetItemCode;

            const rawMaterials = [];
            const subMaterials = [];

            modalCard.querySelectorAll('.modal-mat-row').forEach(r => {
                const isRaw = r.querySelector('span').textContent.includes('원료');
                const code = r.querySelector('.mat-select').value;
                const qty = Number(r.querySelector('.mat-qty').value);
                const mItem = state.master.find(m => m.code === code);
                if (code && qty > 0) {
                    const obj = {
                        code,
                        name: mItem ? mItem.name : code,
                        qty,
                        unit: isRaw ? 'L' : 'EA',
                        location,
                        matType: isRaw ? '원료' : '부자재'
                    };
                    if (isRaw) rawMaterials.push(obj);
                    else subMaterials.push(obj);
                }
            });

            const newWo = {
                id: orderNo,
                orderNo,
                orderDate: todayStr,
                prodType,
                targetItemCode,
                targetItemName,
                targetQty,
                unit,
                packaging,
                lotNo,
                location,
                worker,
                status: 'READY',
                rawMaterials,
                subMaterials,
                notes,
                createdAt: new Date().toISOString()
            };

            await saveWorkOrder(newWo);
            showToast(`🎉 작업지시서 [${orderNo}]가 발행되었습니다!`);
            modalBackdrop.classList.add('hidden');
            renderWorkOrdersTable();
            openWorkOrderPrintModal(orderNo);
        });
    };

    container.querySelector('#btn-open-new-wo-modal')?.addEventListener('click', openNewWorkOrderModal);

    // CSV 내보내기 이벤트
    container.querySelector('#btn-export-prod-csv')?.addEventListener('click', () => {
        const list = state.productions || [];
        if (list.length === 0) {
            alert('내보낼 생산 실적 데이터가 없습니다.');
            return;
        }

        const headers = ["생산일자", "생산구분", "지시서번호", "LOT번호", "품목코드", "품목명", "생산수량", "포장단위", "입고창고", "작업자", "제조일자", "유효기간", "원부자재차감", "비고"];
        const rows = list.map(p => [
            `"${p.prodDate || ''}"`,
            `"${p.prodType || '완제품'}"`,
            `"${p.workOrderNo || ''}"`,
            `"${p.lotNo || ''}"`,
            `"${p.itemCode || ''}"`,
            `"${(p.itemName || '').replace(/"/g, '""')}"`,
            p.qty || 0,
            `"${p.packaging || p.unit || ''}"`,
            `"${p.location || ''}"`,
            `"${p.worker || ''}"`,
            `"${p.mfgDate || ''}"`,
            `"${p.expDate || ''}"`,
            `"${(p.bomDetails || []).map(b => `${b.name}(${b.qty}${b.unit || ''})`).join('; ')}"`,
            `"${(p.notes || '').replace(/"/g, '""')}"`
        ]);

        const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `대림오일_생산실적대장_${todayStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('📁 생산 실적 CSV 파일이 다운로드되었습니다.');
    });

    // 초기 테이블 렌더링
    renderTable();
    renderWorkOrdersTable();
};
