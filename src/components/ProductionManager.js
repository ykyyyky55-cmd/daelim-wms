import { state, processProductionInbound, deleteProductionRecord } from '../services/db.js';
import { searchMasterItems, localDateStr } from '../services/searchUtils.js';
import { locationOptionsHtml } from '../services/locations.js';
import { hasWorklogAccess } from '../services/auth.js';
import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';

export const renderProductionManager = (container, { showToast, onSwitchTab }) => {
    const todayStr = localDateStr();
    const expDateStr = (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 3);
        return localDateStr(d);
    })();

    // 원액생산 작업지시서는 특별보안 메뉴(SecureWorkOrders.js)로 옮겼다
    let selectedProdType = '완제품'; // '완제품' | '원액' | '반제품'
    let historyFilterType = 'ALL';
    // 등록 창 / 실적 대장 위아래 순서 ('form-first' | 'list-first'), 기기별 저장
    const PANEL_ORDER_KEY = 'daelim_prod_panel_order';
    let panelOrder = 'form-first';
    try { panelOrder = localStorage.getItem(PANEL_ORDER_KEY) === 'list-first' ? 'list-first' : 'form-first'; } catch { /* 기본값 */ }

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
    const monthWonaekProds = monthProds.filter(p => p.prodType === '원액');

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
                <span class="px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 bg-blue-600 text-white shadow-md">
                    <i data-lucide="package-plus" class="w-4 h-4"></i>
                    <span>생산 입고 등록 & 실적 대장</span>
                </span>
                ${hasWorklogAccess() ? `
                <button type="button" id="btn-goto-secure-wo" class="px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 bg-white/10 text-amber-200 hover:bg-white/20" title="마스터·작업일지 관리자 전용 메뉴로 이동">
                    <i data-lucide="flask-round" class="w-4 h-4 text-amber-300"></i>
                    <span>원액생산 작업지시서 🔒</span>
                </button>` : ''}
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
                        <span>당월 원액 생산</span>
                        <i data-lucide="flask-round" class="w-4 h-4 text-amber-400"></i>
                    </div>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span class="text-2xl font-black text-amber-400 font-mono">${monthWonaekProds.length}</span>
                        <span class="text-xs text-slate-300">건</span>
                    </div>
                    <span class="text-[11px] text-amber-300/80 mt-1 block">당월 원액 생산량: ${monthWonaekProds.reduce((s, p) => s + (Number(p.qty) || 0), 0).toLocaleString()} L</span>
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
        <div id="subtab-view-production" class="space-y-6">
            <!-- 등록 창과 실적 대장을 가로로 길게 위/아래 배치 (순서는 [위치 바꾸기]로 변경, 이 기기에 저장) -->
            <div id="prod-panels" class="flex flex-col gap-6">
                <!-- 생산 입고 등록 폼 -->
                <div id="prod-panel-form" class="space-y-4" style="order:${panelOrder === 'list-first' ? 2 : 1}">
                    <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                            <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                                <i data-lucide="plus-circle" class="w-4 h-4 text-blue-600"></i>
                                <span>신규 제품/원액 생산 입고 등록</span>
                            </h3>
                            <div class="flex items-center gap-2">
                                <span class="text-[11px] font-bold text-slate-400">창고 재고 자동 입고</span>
                                <button type="button" class="btn-swap-prod-panels px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold flex items-center gap-1" title="등록 창과 실적 대장의 위/아래 위치 바꾸기">
                                    <i data-lucide="arrow-up-down" class="w-3.5 h-3.5"></i><span>위치 바꾸기</span>
                                </button>
                            </div>
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
                          <!-- 가로로 긴 창: 입력 칸을 3열로 배치 -->
                          <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
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
                                        ${locationOptionsHtml(state.locations, '김포공장')}
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-700 mb-1">생산 담당자</label>
                                    <select id="prod-worker" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                        ${state.workers.map(w => `<option value="${esc(w.name)} (${esc(w.role || w.dept)})" ${w.name.includes('생산') ? 'selected' : ''}>${esc(w.name)} (${esc(w.role || w.dept)})</option>`).join('')}
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
                                <input type="text" id="prod-lot-no" required value="LOT-${esc(todayStr.replace(/-/g, ''))}-01" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>

                            <!-- 제조일자 및 품질유효기간 -->
                            <div class="grid grid-cols-2 gap-2">
                                <div>
                                    <label class="block text-xs font-bold text-slate-700 mb-1">제조일자</label>
                                    <input type="date" id="prod-mfg-date" value="${esc(todayStr)}" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-700 mb-1">품질 유효기한</label>
                                    <input type="date" id="prod-exp-date" value="${expDateStr}" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                                </div>
                            </div>

                            <!-- 비고 / 점도 / 성적서 메모 -->
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">생산 비고 / 배합 결과 메모</label>
                                <input type="text" id="prod-notes" placeholder="예: 비중 0.852, 40℃ 동점도 68.2cSt 합격, 밀봉 완료" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>
                          </div>

                            <!-- 원부자재(BOM) 자동 소모 및 투입 등록 섹션 -->
                            <div class="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-3">
                                <div class="flex items-center justify-between">
                                    <label class="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" id="chk-bom-deduct" checked class="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                                        <span class="text-xs font-black text-slate-900">사용 원료 및 부자재 자동 차감 (USE -)</span>
                                    </label>
                                    <div class="flex items-center gap-1.5">
                                        <button type="button" id="btn-save-current-recipe" class="text-[10px] font-bold text-indigo-700 hover:text-indigo-900 bg-indigo-100 hover:bg-indigo-200 border border-indigo-200 px-2 py-0.5 rounded-md flex items-center gap-1 transition" title="현재 등록된 원료사용량을 해당 제품의 표준 배합비로 저장">
                                            <i data-lucide="bookmark-plus" class="w-3 h-3 text-indigo-600"></i>
                                            <span>배합비 저장</span>
                                        </button>
                                        <button type="button" id="btn-quick-fill-recipe" class="text-[10px] font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md flex items-center gap-1 transition">
                                            <i data-lucide="sparkles" class="w-3 h-3 text-amber-500"></i>
                                            <span>추천 배합비 자동입력</span>
                                        </button>
                                    </div>
                                </div>

                                <div id="materials-wrapper" class="space-y-3 pt-2 border-t border-slate-200">
                                    <!-- 실시간 원료사용량 및 생산수량 연동 자동 산출 모니터 요약 바 -->
                                    <div id="recipe-calc-summary-bar" class="p-3 bg-gradient-to-r from-blue-50 via-indigo-50 to-slate-50 border border-blue-200 rounded-xl space-y-2">
                                        <div class="flex flex-wrap items-center justify-between gap-2">
                                            <div class="flex items-center gap-1.5">
                                                <i data-lucide="calculator" class="w-4 h-4 text-blue-600"></i>
                                                <span class="text-xs font-black text-slate-800">원료사용량 자동 산출 모니터</span>
                                                <span id="summary-calc-prod-qty" class="text-[10px] font-mono font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full shadow-2xs">생산 20 EA 기준</span>
                                            </div>
                                            <span class="text-[11px] font-bold text-slate-500">생산수량 변경 시 실시간 자동 계산</span>
                                        </div>
                                        <div class="grid grid-cols-2 gap-2 pt-1 border-t border-blue-100 text-xs">
                                            <div class="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-blue-100 shadow-2xs">
                                                <span class="text-[11px] font-bold text-slate-600">원료 총 투입 소요:</span>
                                                <span id="summary-total-raw-qty" class="font-mono font-black text-blue-700 text-xs">0 L</span>
                                            </div>
                                            <div class="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-emerald-100 shadow-2xs">
                                                <span class="text-[11px] font-bold text-slate-600">부자재 총 투입 소요:</span>
                                                <span id="summary-total-sub-qty" class="font-mono font-black text-emerald-700 text-xs">0 EA</span>
                                            </div>
                                        </div>
                                    </div>

                                  <!-- 넓은 화면에서는 원료·부자재 투입을 좌우로 나란히 -->
                                  <div class="grid grid-cols-1 2xl:grid-cols-2 gap-3 2xl:gap-5">
                                    <!-- 1. 투입 원료 섹션 -->
                                    <div class="space-y-1.5">
                                        <div class="flex items-center justify-between text-[11px] font-black text-slate-700">
                                            <span class="flex items-center gap-1 text-blue-700">
                                                <i data-lucide="droplet" class="w-3.5 h-3.5"></i>
                                                <span>1. 사용 원료 투입 등록 (단위당 사용량 입력 시 생산수량 자동 연동)</span>
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
                                    <div class="space-y-1.5 pt-2 border-t border-slate-200/80 2xl:pt-0 2xl:border-t-0 2xl:pl-5 2xl:border-l">
                                        <div class="flex items-center justify-between text-[11px] font-black text-slate-700">
                                            <span class="flex items-center gap-1 text-emerald-700">
                                                <i data-lucide="box" class="w-3.5 h-3.5"></i>
                                                <span>2. 사용 부자재 투입 등록 (용기, 드럼, 캡, 라벨, 박스 등)</span>
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
                            </div>

                            <div class="pt-2 flex justify-end">
                                <button type="submit" id="btn-submit-production" class="w-full lg:w-auto lg:px-12 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl text-xs transition shadow-md flex items-center justify-center gap-2">
                                    <i data-lucide="check-circle" class="w-4 h-4"></i>
                                    <span id="btn-submit-text">생산 입고 및 원부자재 자동 차감 처리</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                <!-- 생산 실적 이력 테이블 & 빠른 라벨 인쇄 안내 -->
                <div id="prod-panel-list" class="space-y-4" style="order:${panelOrder === 'list-first' ? 1 : 2}">
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
                                <button type="button" class="btn-swap-prod-panels px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold flex items-center gap-1" title="등록 창과 실적 대장의 위/아래 위치 바꾸기">
                                    <i data-lucide="arrow-up-down" class="w-3.5 h-3.5"></i><span>위치 바꾸기</span>
                                </button>
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

    </section>
    `;

    // 아이콘 생성
    createIcons({ icons });

    // 등록 창 ↔ 실적 대장 위/아래 위치 바꾸기 (다시 그리지 않고 순서만 바꿔 입력 중인 내용 유지)
    container.querySelectorAll('.btn-swap-prod-panels').forEach(btn => btn.addEventListener('click', () => {
        panelOrder = panelOrder === 'list-first' ? 'form-first' : 'list-first';
        try { localStorage.setItem(PANEL_ORDER_KEY, panelOrder); } catch { /* 저장 불가 */ }
        container.querySelector('#prod-panel-form').style.order = panelOrder === 'list-first' ? 2 : 1;
        container.querySelector('#prod-panel-list').style.order = panelOrder === 'list-first' ? 1 : 2;
        container.querySelector('#prod-panels').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));

    // 원액생산 작업지시서(특별보안) 메뉴로 이동
    container.querySelector('#btn-goto-secure-wo')?.addEventListener('click', () => onSwitchTab?.('secureWorkOrders'));

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
                <option value="${esc(m.code)}">[${esc(m.code)}] ${esc(m.name)} (${esc(m.spec || '-')})</option>
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
                <option value="${esc(m.code)}">[${esc(m.code)}] ${esc(m.name)} (${esc(m.category)})</option>
            `).join('');
        }
    });

    // 자동 LOT 번호 채번
    container.querySelector('#btn-auto-lot')?.addEventListener('click', () => {
        const d = new Date();
        const ymd = localDateStr(d).replace(/-/g, '');
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

    // ==========================================
    // 원료 & 부자재 동적 행 및 실시간 자동 산출
    // ==========================================
    const RECIPES_STORAGE_KEY = 'daelim_product_recipes';
    const getStoredRecipes = () => {
        try {
            return JSON.parse(localStorage.getItem(RECIPES_STORAGE_KEY) || '{}');
        } catch (e) {
            return {};
        }
    };

    // 원료 행 입력 단위 (기본 L, 마스터 단위가 KG/G이면 그 단위)
    const rawRowUnit = (code) => {
        const u = String(state.master.find(m => m.code === code)?.unit || '').trim().toUpperCase();
        return u === 'KG' || u === 'G' ? u : 'L';
    };

    // 재고량 가져오기 헬퍼
    const getStockQty = (code, location) => {
        const inv = state.inventory.find(i => i.code === code && i.location === location);
        return inv ? Number(inv.quantity) : 0;
    };

    // 재고 및 차감 후 잔여량 표시 헬퍼
    const updateRowStockIndicator = (row, defaultUnit = 'L') => {
        const code = row.querySelector('.item-select')?.value;
        // 원료 행은 L로 입력받되, 품목 마스터 단위가 KG/G인 원료는 그 단위로 입력받는다 (원료수불부에는 비중으로 L 환산)
        const unit = row.classList.contains('raw-row') ? rawRowUnit(code) : defaultUnit;
        row.querySelectorAll('.unit-label').forEach(el => { el.textContent = unit; });
        const loc = row.querySelector('.item-loc')?.value;
        const qty = Number(row.querySelector('.item-qty')?.value) || 0;
        const st = getStockQty(code, loc);
        const remain = Math.round((st - qty) * 100) / 100;
        const badge = row.querySelector('.stock-badge');
        if (!badge) return;

        if (st >= qty) {
            badge.textContent = `재고: ${st.toLocaleString()}${unit} (차감후: ${remain.toLocaleString()}${unit})`;
            badge.className = 'stock-badge text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap bg-emerald-50 text-emerald-700 border border-emerald-200';
        } else {
            badge.textContent = `재고: ${st.toLocaleString()}${unit} (부족: ${Math.abs(remain).toLocaleString()}${unit})`;
            badge.className = 'stock-badge text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap bg-rose-50 text-rose-600 border border-rose-200 animate-pulse';
        }
    };

    // 실시간 전 행 원부자재 소요량 자동 계산 및 모니터 지표 갱신
    const recalculateAllMaterials = () => {
        const prodQty = Math.max(0, Number(container.querySelector('#prod-qty').value) || 0);
        const prodUnit = prodUnitBadge.textContent || 'EA';

        const summaryQtyEl = container.querySelector('#summary-calc-prod-qty');
        if (summaryQtyEl) {
            summaryQtyEl.textContent = `생산 ${prodQty.toLocaleString()} ${prodUnit} 기준`;
        }

        let totalRaw = 0;
        let totalSub = 0;

        // 1. 원료 행 자동 산출
        rawRowsList.querySelectorAll('.raw-row').forEach(row => {
            const rateInput = row.querySelector('.item-rate');
            const qtyInput = row.querySelector('.item-qty');
            const rate = Number(rateInput?.value) || 0;
            const calcQty = Math.round(prodQty * rate * 1000) / 1000;
            if (qtyInput && document.activeElement !== qtyInput) {
                qtyInput.value = calcQty;
            }
            const activeQty = Number(qtyInput?.value) || calcQty;
            totalRaw += activeQty;
            updateRowStockIndicator(row, 'L');
        });

        // 2. 부자재 행 자동 산출
        subRowsList.querySelectorAll('.sub-row').forEach(row => {
            const rateInput = row.querySelector('.item-rate');
            const qtyInput = row.querySelector('.item-qty');
            const rate = Number(rateInput?.value) || 0;
            const calcQty = Math.round(prodQty * rate * 1000) / 1000;
            if (qtyInput && document.activeElement !== qtyInput) {
                qtyInput.value = calcQty;
            }
            const activeQty = Number(qtyInput?.value) || calcQty;
            totalSub += activeQty;
            updateRowStockIndicator(row, 'EA');
        });

        const sumRawEl = container.querySelector('#summary-total-raw-qty');
        if (sumRawEl) sumRawEl.textContent = `${(Math.round(totalRaw * 100) / 100).toLocaleString()} L`;
        const sumSubEl = container.querySelector('#summary-total-sub-qty');
        if (sumSubEl) sumSubEl.textContent = `${(Math.round(totalSub * 100) / 100).toLocaleString()} EA`;
    };

    // 원료 행 추가 함수 (단위당 사용량 등록 & 생산수량 연동 자동산출)
    const addRawRow = (defaultCode = '', defaultRate = 1, defaultLoc = '김포공장') => {
        const rawItems = state.master.filter(m => m.category === '원료' || m.category === '원액');
        const candidateItems = rawItems.length > 0 ? rawItems : state.master;

        const row = document.createElement('div');
        row.className = 'raw-row flex flex-wrap items-center gap-1.5 bg-white p-2.5 rounded-xl border border-blue-200 text-xs shadow-xs';
        
        const initialCode = defaultCode || (candidateItems[0] ? candidateItems[0].code : '');
        const prodQty = Math.max(0, Number(container.querySelector('#prod-qty').value) || 0);
        const initialQty = Math.round(prodQty * defaultRate * 1000) / 1000;

        row.innerHTML = `
            <div class="flex-1 min-w-[150px]">
                <select class="item-select w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 focus:ring-1 focus:ring-blue-500">
                    ${candidateItems.map(m => `<option value="${esc(m.code)}" ${m.code === initialCode ? 'selected' : ''}>[${esc(m.code)}] ${esc(m.name)}</option>`).join('')}
                </select>
            </div>
            <!-- 1. 단위당 사용량 (원료사용량 등록 필드) -->
            <div class="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1" title="제품 1단위 생산 시 투입되는 원료의 단위당 사용량 (배합율)">
                <span class="text-[10px] text-slate-500 font-bold whitespace-nowrap">단위당:</span>
                <input type="number" min="0" step="any" value="${defaultRate}" class="item-rate w-14 text-right font-black text-xs text-blue-900 bg-transparent focus:outline-none" placeholder="비율" />
                <span class="unit-label text-[10px] text-slate-500 font-bold">L</span>
            </div>
            <!-- 2. 자동 산출 총 소요량 (생산수량 × 단위사용량) -->
            <div class="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1" title="생산수량에 따라 자동 산출된 총 소요량 (직접 수정 시 단위당 사용량이 역산됩니다)">
                <span class="text-[10px] text-blue-700 font-black whitespace-nowrap">= 총소요:</span>
                <input type="number" min="0" step="any" value="${initialQty}" class="item-qty w-20 text-right font-black text-xs text-blue-700 bg-transparent focus:outline-none" />
                <span class="unit-label text-[10px] text-blue-600 font-bold">L</span>
            </div>
            <div class="w-32">
                <select class="item-loc w-full bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 text-[11px] font-bold">
                    ${locationOptionsHtml(state.locations, defaultLoc)}
                </select>
            </div>
            <div class="stock-badge text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">
                재고 확인중
            </div>
            <button type="button" class="btn-remove-row shrink-0 ml-auto px-2.5 min-h-9 inline-flex items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 text-[11px] font-black transition" title="원료 행 삭제">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i><span class="pointer-events-none">삭제</span>
            </button>
        `;

        const rateInput = row.querySelector('.item-rate');
        const qtyInput = row.querySelector('.item-qty');

        // 단위당 사용량 수정 시 -> 총 소요량 즉시 재계산
        rateInput?.addEventListener('input', () => {
            const pQty = Math.max(0, Number(container.querySelector('#prod-qty').value) || 0);
            const rate = Number(rateInput.value) || 0;
            qtyInput.value = Math.round(pQty * rate * 1000) / 1000;
            recalculateAllMaterials();
        });

        // 총 소요량 직접 수정 시 -> 단위당 사용량 역산
        qtyInput?.addEventListener('input', () => {
            const pQty = Math.max(0, Number(container.querySelector('#prod-qty').value) || 0);
            const qty = Number(qtyInput.value) || 0;
            if (pQty > 0) {
                rateInput.value = Math.round((qty / pQty) * 10000) / 10000;
            }
            recalculateAllMaterials();
        });

        row.querySelector('.item-select')?.addEventListener('change', () => updateRowStockIndicator(row, 'L'));
        row.querySelector('.item-loc')?.addEventListener('change', () => updateRowStockIndicator(row, 'L'));
        // 삭제 버튼은 목록 컨테이너에서 한 번에 처리 (아래 removeRowOnClick)

        rawRowsList.appendChild(row);
        updateRowStockIndicator(row, 'L');
        createIcons({ icons });
        recalculateAllMaterials();
    };

    // 부자재 행 추가 함수 (단위당 사용량 등록 & 생산수량 연동 자동산출)
    const addSubRow = (defaultCode = '', defaultRate = 1, defaultLoc = '김포공장') => {
        const subItems = state.master.filter(m => m.category === '부자재');
        const candidateItems = subItems.length > 0 ? subItems : state.master;

        const row = document.createElement('div');
        row.className = 'sub-row flex flex-wrap items-center gap-1.5 bg-white p-2.5 rounded-xl border border-emerald-200 text-xs shadow-xs';
        
        const initialCode = defaultCode || (candidateItems[0] ? candidateItems[0].code : '');
        const prodQty = Math.max(0, Number(container.querySelector('#prod-qty').value) || 0);
        const initialQty = Math.round(prodQty * defaultRate * 1000) / 1000;

        row.innerHTML = `
            <div class="flex-1 min-w-[150px]">
                <select class="item-select w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 focus:ring-1 focus:ring-emerald-500">
                    ${candidateItems.map(m => `<option value="${esc(m.code)}" ${m.code === initialCode ? 'selected' : ''}>[${esc(m.code)}] ${esc(m.name)}</option>`).join('')}
                </select>
            </div>
            <!-- 단위당 사용량 -->
            <div class="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1" title="제품 1단위 생산 시 투입 부자재 단위소요량">
                <span class="text-[10px] text-slate-500 font-bold whitespace-nowrap">단위당:</span>
                <input type="number" min="0" step="any" value="${defaultRate}" class="item-rate w-14 text-right font-black text-xs text-emerald-900 bg-transparent focus:outline-none" placeholder="수량" />
                <span class="text-[10px] text-slate-500 font-bold">EA</span>
            </div>
            <!-- 자동 산출 총 소요량 -->
            <div class="flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1" title="생산수량에 따라 자동 산출된 총 부자재 소요량">
                <span class="text-[10px] text-emerald-700 font-black whitespace-nowrap">= 총소요:</span>
                <input type="number" min="0" step="any" value="${initialQty}" class="item-qty w-16 text-right font-black text-xs text-emerald-700 bg-transparent focus:outline-none" />
                <span class="text-[10px] text-emerald-600 font-bold">EA</span>
            </div>
            <div class="w-32">
                <select class="item-loc w-full bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 text-[11px] font-bold">
                    ${locationOptionsHtml(state.locations, defaultLoc)}
                </select>
            </div>
            <div class="stock-badge text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">
                재고 확인중
            </div>
            <button type="button" class="btn-remove-row shrink-0 ml-auto px-2.5 min-h-9 inline-flex items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 text-[11px] font-black transition" title="부자재 행 삭제">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i><span class="pointer-events-none">삭제</span>
            </button>
        `;

        const rateInput = row.querySelector('.item-rate');
        const qtyInput = row.querySelector('.item-qty');

        rateInput?.addEventListener('input', () => {
            const pQty = Math.max(0, Number(container.querySelector('#prod-qty').value) || 0);
            const rate = Number(rateInput.value) || 0;
            qtyInput.value = Math.round(pQty * rate * 1000) / 1000;
            recalculateAllMaterials();
        });

        qtyInput?.addEventListener('input', () => {
            const pQty = Math.max(0, Number(container.querySelector('#prod-qty').value) || 0);
            const qty = Number(qtyInput.value) || 0;
            if (pQty > 0) {
                rateInput.value = Math.round((qty / pQty) * 10000) / 10000;
            }
            recalculateAllMaterials();
        });

        row.querySelector('.item-select')?.addEventListener('change', () => updateRowStockIndicator(row, 'EA'));
        row.querySelector('.item-loc')?.addEventListener('change', () => updateRowStockIndicator(row, 'EA'));

        subRowsList.appendChild(row);
        updateRowStockIndicator(row, 'EA');
        createIcons({ icons });
        recalculateAllMaterials();
    };

    // 생산 수량 변경 시 전체 원부자재 실시간 자동 산출
    const prodQtyInput = container.querySelector('#prod-qty');
    prodQtyInput?.addEventListener('input', recalculateAllMaterials);
    prodQtyInput?.addEventListener('change', recalculateAllMaterials);

    // 원료·부자재 행 삭제: 목록에서 클릭을 받아 처리 (어떤 경로로 추가된 행이든, 아이콘·글자를 눌러도 동작)
    const removeRowOnClick = (e) => {
        const btn = e.target.closest('.btn-remove-row');
        if (!btn) return;
        e.preventDefault();
        btn.closest('.raw-row, .sub-row')?.remove();
        recalculateAllMaterials();
    };
    rawRowsList?.addEventListener('click', removeRowOnClick);
    subRowsList?.addEventListener('click', removeRowOnClick);

    container.querySelector('#btn-add-raw-row')?.addEventListener('click', () => addRawRow());
    container.querySelector('#btn-add-sub-row')?.addEventListener('click', () => addSubRow());

    // 배합비(원료사용량) 영구 저장 기능
    container.querySelector('#btn-save-current-recipe')?.addEventListener('click', () => {
        const itemCode = selectItemDropdown.value;
        if (!itemCode) {
            alert('생산 품목을 먼저 선택해주세요.');
            return;
        }

        const rawList = [];
        const subList = [];

        rawRowsList.querySelectorAll('.raw-row').forEach(row => {
            const code = row.querySelector('.item-select').value;
            const rate = Number(row.querySelector('.item-rate').value) || 0;
            const loc = row.querySelector('.item-loc').value;
            if (code && rate > 0) rawList.push({ code, rate, loc });
        });

        subRowsList.querySelectorAll('.sub-row').forEach(row => {
            const code = row.querySelector('.item-select').value;
            const rate = Number(row.querySelector('.item-rate').value) || 0;
            const loc = row.querySelector('.item-loc').value;
            if (code && rate > 0) subList.push({ code, rate, loc });
        });

        if (rawList.length === 0 && subList.length === 0) {
            alert('등록된 원료 또는 부자재가 없습니다.');
            return;
        }

        const recipes = getStoredRecipes();
        recipes[itemCode] = { rawList, subList, savedAt: new Date().toISOString() };
        localStorage.setItem(RECIPES_STORAGE_KEY, JSON.stringify(recipes));

        const targetItem = state.master.find(m => m.code === itemCode);
        showToast(`💾 [${itemCode}] ${targetItem ? targetItem.name : ''}의 배합비(원료사용량)가 공식 레시피로 저장되었습니다!`);
    });

    // 저장된 배합비 자동 로드 또는 스마트 기본 추천 배합비 생성
    const smartApplyRecipeForProduct = (itemCode) => {
        if (!itemCode) return;
        const curLoc = container.querySelector('#prod-location').value;
        const curQty = Number(container.querySelector('#prod-qty').value) || 20;

        // 1. 저장된 사용자 정의 배합비가 있는지 확인
        const recipes = getStoredRecipes();
        const saved = recipes[itemCode];
        if (saved && (saved.rawList?.length > 0 || saved.subList?.length > 0)) {
            rawRowsList.innerHTML = '';
            subRowsList.innerHTML = '';
            (saved.rawList || []).forEach(r => addRawRow(r.code, r.rate, r.loc || curLoc));
            (saved.subList || []).forEach(s => addSubRow(s.code, s.rate, s.loc || curLoc));
            recalculateAllMaterials();
            showToast(`📋 [${itemCode}] 등록된 원료사용량 레시피가 자동 로드되어 산출되었습니다.`);
            return;
        }

        // 2. 스마트 표준 추천 배합비 자동 생성
        rawRowsList.innerHTML = '';
        subRowsList.innerHTML = '';

        const targetItem = state.master.find(m => m.code === itemCode) || {};
        const specStr = String(targetItem.spec || '').toLowerCase();

        if (selectedProdType === '원액') {
            // 원액 블렌딩: 기유 85% + 첨가제 15%
            const boItem = state.master.find(m => m.subCategory === 'BO' || m.name.includes('기유') || m.code.startsWith('6BO')) || state.master.find(m => m.category === '원료');
            const adItem = state.master.find(m => m.subCategory === 'AD' || m.name.includes('첨가제') || m.code.startsWith('6AD')) || state.master.find(m => m.category === '원료');

            addRawRow(boItem ? boItem.code : '', 0.85, curLoc);
            addRawRow(adItem ? adItem.code : '', 0.15, curLoc);
            showToast(`✨ 원액 블렌딩 표준 배합비(기유 85% + 첨가제 15%)가 자동 적용되었습니다.`);
        } else {
            // 완제품 충진 포장: 규격에 따른 원액 및 용기 자동 매칭
            let unitUsageL = 1;
            if (specStr.includes('200l') || specStr.includes('드럼')) unitUsageL = 200;
            else if (specStr.includes('20l') || specStr.includes('말통')) unitUsageL = 20;
            else if (specStr.includes('4l')) unitUsageL = 4;
            else if (specStr.includes('0.5l')) unitUsageL = 0.5;

            // 원액 품목 찾기
            const wonItem = state.master.find(m => m.category === '원액' && (m.name.includes('0W') || m.name.includes('5W') || m.name.includes('엔진오일'))) || state.master.find(m => m.category === '원액') || state.master.find(m => m.category === '원료');
            addRawRow(wonItem ? wonItem.code : '', unitUsageL, curLoc);

            // 용기 부자재 찾기
            const drumItem = state.master.find(m => m.category === '부자재' && (m.name.includes('드럼') || m.name.includes('용기') || m.name.includes('캔') || m.name.includes('페일')));
            if (drumItem) {
                addSubRow(drumItem.code, 1, curLoc);
            }
            showToast(`✨ 완제품(${unitUsageL}L 규격)에 맞춘 원액 및 용기 단위소요량이 자동 산출되었습니다.`);
        }

        recalculateAllMaterials();
    };

    container.querySelector('#btn-quick-fill-recipe')?.addEventListener('click', () => {
        smartApplyRecipeForProduct(selectItemDropdown.value);
    });

    // 품목 드롭다운 변경 시 배합비 자동 연동
    selectItemDropdown?.addEventListener('change', () => {
        smartApplyRecipeForProduct(selectItemDropdown.value);
    });

    // 초기 배합비 행 자동 구성
    smartApplyRecipeForProduct(selectItemDropdown.value);

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
                ? `<span class="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded" title="${(item.bomDetails || []).map(b => `${esc(b.name || b.code)}: ${esc(b.qty)}${esc(b.unit || '')}`).join(', ')}">자동차감 (${matCount}종)</span>`
                : `<span class="px-1.5 py-0.5 text-[10px] text-slate-400">단순입고</span>`;

            return `
            <tr class="hover:bg-slate-50/80 transition">
                <td class="p-2.5 whitespace-nowrap font-mono text-slate-600 text-[11px]">${esc(item.prodDate || '-')}</td>
                <td class="p-2.5 whitespace-nowrap">${prodTypeBadge}</td>
                <td class="p-2.5 whitespace-nowrap font-mono font-black text-blue-600 text-[11px]">
                    <span class="px-2 py-0.5 bg-blue-50 border border-blue-200 rounded-md">${esc(item.lotNo)}</span>
                    ${item.workOrderNo ? `<span class="block text-[9px] text-slate-400 font-mono mt-0.5">${esc(item.workOrderNo)}</span>` : ''}
                </td>
                <td class="p-2.5">
                    <div class="font-extrabold text-slate-900 text-xs">${esc(item.itemName)}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${esc(item.itemCode)}</div>
                </td>
                <td class="p-2.5 whitespace-nowrap font-bold text-slate-900">
                    ${Number(item.qty).toLocaleString()} <span class="text-[10px] text-slate-500 font-normal">(${esc(item.packaging || item.unit || '단위')})</span>
                </td>
                <td class="p-2.5 whitespace-nowrap text-xs font-semibold text-slate-700">${esc(item.location || '-')}</td>
                <td class="p-2.5 whitespace-nowrap">${matSummary}</td>
                <td class="p-2.5 whitespace-nowrap text-center">
                    <div class="flex items-center justify-center gap-1">
                        <button type="button" class="btn-jump-label px-2.5 py-1 bg-slate-900 hover:bg-black text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition shadow-xs" data-code="${esc(item.itemCode)}" data-lot="${esc(item.lotNo)}" data-mfg="${esc(item.mfgDate || '')}" data-exp="${esc(item.expDate || '')}">
                            <i data-lucide="qr-code" class="w-3 h-3 text-blue-400"></i>
                            <span>라벨</span>
                        </button>
                        <button type="button" class="btn-del-prod text-slate-400 hover:text-rose-600 p-1 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(item.id)}" title="실적 삭제">
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
                        unit: rawRowUnit(bCode),
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

            const result = await processProductionInbound({
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

            const rawCount = result?.rawLedgerEntries?.length || 0;
            showToast(`🎉 [${lotNo}] ${selectedProdType} ${prodQty}개 생산입고 및 원부자재 ${rawMaterials.length}종 자동 차감이 완료되었습니다!${rawCount ? ` (원료수불부 ${rawCount}건 자동 기입)` : ''}`);
            renderProductionManager(container, { showToast, onSwitchTab });
        } catch (err) {
            alert(`생산 입고 실패:\n${err.message}`);
            const btnSubmit = container.querySelector('#btn-submit-production');
            const btnText = container.querySelector('#btn-submit-text');
            btnSubmit.disabled = false;
            btnText.innerHTML = `<span>생산 입고 및 원부자재 자동 차감 처리</span>`;
        }
    });

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
};
