import { state, processProductionInbound, deleteProductionRecord, getGimpoLogByDate, saveGimpoLog, WORKLOG_SITES } from '../services/db.js';
import { searchMasterItems, localDateStr, matchesQuery } from '../services/searchUtils.js';
import { locationOptionsHtml } from '../services/locations.js';
import { hasWorklogAccess } from '../services/auth.js';
import { secure, loadSecureData, saveSecureOrder } from '../services/secureWorkOrders.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { getBoms, loadBoms, saveBom, listBoms, deleteBoms } from '../services/plans.js';
import { QC_AREAS, getDefectConfig, saveQc, rateOf, fmtRate } from '../services/quality.js';

export const renderProductionManager = (container, { showToast, onSwitchTab }) => {
    const todayStr = localDateStr();
    const expDateStr = (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 3);
        return localDateStr(d);
    })();

    // 원액생산 작업지시서는 특별보안 메뉴(SecureWorkOrders.js)로 옮겼다
    let selectedProdType = '완제품'; // '완제품' | '원액' | '반제품' | '라벨부착'
    let historyFilterType = 'ALL';
    // 등록 창 / 실적 대장 위아래 순서 ('form-first' | 'list-first'), 기기별 저장
    const PANEL_ORDER_KEY = 'daelim_prod_panel_order';
    let panelOrder = 'form-first';
    try { panelOrder = localStorage.getItem(PANEL_ORDER_KEY) === 'list-first' ? 'list-first' : 'form-first'; } catch { /* 기본값 */ }

    // 라벨부착 작업: 무라벨 용기 + 라벨 → 라벨부착 용기 (부자재끼리의 가공, 업무일지 '라벨부착작업'에도 기록)
    const isContainer = (m) => /용기|병|통|캔|페일|말통|보틀|bottle|can/i.test(m.name || '');
    const isBare = (m) => /무라벨|무지|라벨\s*없|라벨\s*미부착/.test(m.name || '');
    const isLabel = (m) => /라벨|스티커|label/i.test(m.name || '') && !isContainer(m);

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
        } else if (type === '라벨부착') {
            // 라벨을 붙여 만드는 '라벨부착 용기' (부자재 중 용기류, 없으면 부자재 전체)
            const subs = state.master.filter(m => m.category === '부자재');
            const list = subs.filter(m => isContainer(m) && !isBare(m));
            return list.length > 0 ? list : (subs.length > 0 ? subs : state.master);
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
                            <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-slate-100 p-1 rounded-xl">
                                <button type="button" class="btn-prod-type-select py-1.5 text-xs font-black rounded-lg transition ${selectedProdType === '완제품' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}" data-type="완제품">
                                    📦 완제품 (포장)
                                </button>
                                <button type="button" class="btn-prod-type-select py-1.5 text-xs font-black rounded-lg transition ${selectedProdType === '원액' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}" data-type="원액">
                                    🛢️ 원액 (블렌딩)
                                </button>
                                <button type="button" class="btn-prod-type-select py-1.5 text-xs font-black rounded-lg transition ${selectedProdType === '반제품' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}" data-type="반제품">
                                    ⚙️ 반제품 (가공)
                                </button>
                                <button type="button" class="btn-prod-type-select py-1.5 text-xs font-black rounded-lg transition ${selectedProdType === '라벨부착' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}" data-type="라벨부착">
                                    🏷️ 라벨부착 (용기)
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

                            <!-- 불량 발생: 생산 수량 = 양품(입고), 불량은 품질관리 → 공정관리 불량 기록으로 (재고에는 안 들어감) -->
                            <div id="defect-panel" class="p-3 bg-rose-50/60 border border-rose-200 rounded-2xl space-y-2 text-xs">
                                <label class="flex items-start gap-2 cursor-pointer">
                                    <input type="checkbox" id="defect-on" class="mt-0.5 w-4 h-4 accent-rose-600" />
                                    <span><b class="text-rose-800">불량 발생 반영</b> <span class="text-slate-600">— 위 생산 수량은 <b>양품(입고) 수량</b>입니다. 불량은 여기 적으면 재고에는 들어가지 않고 <b>품질관리 → 공정관리</b>의 불량 기록(불량률)으로 남습니다.</span></span>
                                </label>
                                <div id="defect-body" class="hidden space-y-2 pt-2 border-t border-rose-200">
                                    <div class="flex flex-wrap items-center justify-between gap-2">
                                        <b class="text-rose-800">불량 유형별 수량</b>
                                        <span id="defect-summary" class="font-bold text-slate-700"></span>
                                    </div>
                                    <div id="defect-types" class="grid grid-cols-2 lg:grid-cols-3 gap-1.5"></div>
                                    <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
                                        <label class="block"><span class="font-bold text-slate-600">공정·라인</span><input id="defect-process" list="defect-process-list" placeholder="예: 충진" class="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5" /><datalist id="defect-process-list"></datalist></label>
                                        <label class="block"><span class="font-bold text-slate-600">불량품 처리</span><select id="defect-handling" class="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5"><option>폐기</option><option>재작업</option><option>보류(격리)</option><option>기타</option></select></label>
                                        <label class="block"><span class="font-bold text-slate-600">판정</span><select id="defect-result" class="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5"><option value="PASS">합격 (불량 선별)</option><option value="COND">조건부 합격</option><option value="FAIL">불합격</option></select></label>
                                        <label class="block"><span class="font-bold text-slate-600">검사자</span><input id="defect-inspector" class="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                                        <label class="block col-span-2"><span class="font-bold text-slate-600">불량 원인</span><input id="defect-cause" class="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                                        <label class="block col-span-2"><span class="font-bold text-slate-600">조치</span><input id="defect-action" class="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                                    </div>
                                    <label class="flex items-center gap-2 font-bold text-slate-700"><input type="checkbox" id="defect-consume" checked class="accent-rose-600" />불량품에 들어간 원료·부자재도 차감 (원료사용량을 <b>양품 + 불량</b> 수량 기준으로 계산)</label>
                                </div>
                            </div>
                          </div>

                            <!-- 라벨부착: 무라벨 용기 + 라벨 → 라벨부착 용기, 업무일지 '라벨부착작업' 기록 -->
                            <div id="label-attach-panel" class="hidden p-3.5 bg-violet-50 border border-violet-200 rounded-2xl space-y-3 text-xs">
                                <div class="font-black text-violet-900 flex items-center gap-1.5"><i data-lucide="tag" class="w-4 h-4"></i>라벨 부착 구성 <span class="font-normal text-violet-700">— 위에서 고른 품목이 만들어질 '라벨부착 용기'입니다</span></div>
                                <div class="grid grid-cols-1 lg:grid-cols-3 gap-2 items-end">
                                    <label class="block"><span class="font-bold text-slate-700">무라벨 용기 (차감)</span>
                                        <select id="la-bare" class="mt-1 w-full bg-white border border-slate-300 rounded-xl px-2 py-1.5 font-bold"></select></label>
                                    <label class="block"><span class="font-bold text-slate-700">라벨 (차감)</span>
                                        <select id="la-label" class="mt-1 w-full bg-white border border-slate-300 rounded-xl px-2 py-1.5 font-bold"></select></label>
                                    <button type="button" id="la-fill" class="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-black">↓ 투입 부자재로 채우기 (개당 1개씩)</button>
                                </div>
                                <div class="pt-2 border-t border-violet-200 space-y-2">
                                    <label class="flex items-center gap-2 font-bold text-slate-800"><input type="checkbox" id="la-log" checked class="accent-violet-600" />업무일지 '라벨부착작업'에도 기록 (제조일자 날짜의 일지)</label>
                                    <div class="grid grid-cols-2 lg:grid-cols-5 gap-2">
                                        <label class="block"><span class="font-bold text-slate-600">업무일지</span>
                                            <select id="la-site" class="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5">${Object.values(WORKLOG_SITES).map(s => `<option value="${s.key}">${esc(s.name)}</option>`).join('')}</select></label>
                                        <label class="block"><span class="font-bold text-slate-600">작업시간(h)</span><input id="la-hours" type="number" min="0" step="0.1" value="1" class="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                                        <label class="block"><span class="font-bold text-slate-600">인원</span><input id="la-wc" type="number" min="1" step="1" value="1" class="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                                        <label class="block"><span class="font-bold text-slate-600">LINE</span><input id="la-line" value="라벨" class="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                                        <label class="block"><span class="font-bold text-slate-600">박스</span><input id="la-box" type="number" min="0" step="1" value="0" class="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                                    </div>
                                    <p class="text-[11px] text-violet-800">업무일지의 라벨부착 줄은 기록·실적용이라 재고를 다시 바꾸지 않습니다 (재고는 여기서 한 번만 처리). 월간 실적 현황판의 라벨(EA)에 잡힙니다.</p>
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
                                        <button type="button" id="btn-bom-manage" class="text-[10px] font-bold text-rose-700 hover:text-rose-900 bg-white hover:bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md flex items-center gap-1 transition" title="저장된 배합비 목록 보기·일괄 삭제">
                                            <i data-lucide="list-x" class="w-3 h-3 text-rose-600"></i>
                                            <span>배합비 목록·삭제</span>
                                        </button>
                                        <button type="button" id="btn-quick-fill-recipe" class="text-[10px] font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md flex items-center gap-1 transition">
                                            <i data-lucide="sparkles" class="w-3 h-3 text-amber-500"></i>
                                            <span>추천 배합비 자동입력</span>
                                        </button>
                                    </div>
                                </div>

                                <!-- 원액 생산: 선택한 원액의 작업지시서(특별보안)를 찾아 원료 투입을 불러온다 -->
                                <div id="wo-link-panel" class="hidden p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-xs"></div>

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
                                    <option value="라벨부착">라벨부착</option>
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
        } else if (selectedProdType === '라벨부착') {
            prodUnitBadge.textContent = 'EA';
            container.querySelector('#prod-packaging').value = '개별 박스';
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
        updateLabelPanel();
    };

    // 라벨부착 구성 칸: 무라벨 용기·라벨 후보를 채우고, 만들 용기와 이름이 비슷한 것을 먼저 고른다
    const updateLabelPanel = () => {
        const panel = container.querySelector('#label-attach-panel');
        if (!panel) return;
        panel.classList.toggle('hidden', selectedProdType !== '라벨부착');
        if (selectedProdType !== '라벨부착') return;
        const subs = state.master.filter(m => m.category === '부자재');
        const pool = subs.length ? subs : state.master;
        const target = state.master.find(m => m.code === selectItemDropdown.value);
        const words = String(target?.name || '').replace(/라벨\s*부착|라벨|부착/g, ' ').split(/[\s()\[\]/,_-]+/).filter(w => w.length >= 2);
        const score = (m) => words.filter(w => (m.name || '').includes(w)).length;
        const rank = (list) => [...list].sort((a, b) => score(b) - score(a));
        const bare = rank(pool.filter(m => isContainer(m) && m.code !== target?.code).sort((a, b) => Number(isBare(b)) - Number(isBare(a))));
        const labels = rank(pool.filter(isLabel));
        const opt = (m) => `<option value="${esc(m.code)}">[${esc(m.code)}] ${esc(m.name)}</option>`;
        container.querySelector('#la-bare').innerHTML = `<option value="">(선택 안 함)</option>${(bare.length ? bare : pool).slice(0, 80).map(opt).join('')}`;
        container.querySelector('#la-label').innerHTML = `<option value="">(선택 안 함)</option>${(labels.length ? labels : pool).slice(0, 80).map(opt).join('')}`;
        if (bare[0] && (isBare(bare[0]) || score(bare[0]) > 0)) container.querySelector('#la-bare').value = bare[0].code;
        if (labels[0] && score(labels[0]) > 0) container.querySelector('#la-label').value = labels[0].code;
        const loc = container.querySelector('#prod-location').value || '';
        container.querySelector('#la-site').value = loc.startsWith('본사') ? 'HQ' : 'GIMPO';
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
        if (selectedProdType === '라벨부착') updateLabelPanel();
    });

    // 자동 LOT 번호 채번
    container.querySelector('#btn-auto-lot')?.addEventListener('click', () => {
        const d = new Date();
        const ymd = localDateStr(d).replace(/-/g, '');
        const prefix = selectedProdType === '원액' ? 'B' : selectedProdType === '반제품' ? 'S' : selectedProdType === '라벨부착' ? 'L' : 'A';
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
    // 배합비(BOM): 이 기기 저장분 위에 클라우드 BOM(wms_product_boms)을 덮어 쓴다 (services/plans.js).
    // 생산계획의 원액·부자재 소요량 계산도 같은 BOM을 쓴다. 원액의 원료 배합은 클라우드에 올리지 않는다(보안).
    const getStoredRecipes = () => getBoms();
    loadBoms().catch(() => {});

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

    // ---------- 불량 발생 (생산 수량 = 양품, 불량은 품질관리 공정 불량 기록으로) ----------
    const defectInputs = () => [...container.querySelectorAll('#defect-types [data-type]')];
    const defectOn = () => !!container.querySelector('#defect-on')?.checked;
    const defectQtyNow = () => (defectOn() ? defectInputs().reduce((s, el) => s + (Number(el.value) || 0), 0) : 0);
    // 불량품에 들어간 원부자재도 차감하면 사용량 계산 기준에 불량 수량을 더한다
    const defectConsumeQty = () => (container.querySelector('#defect-consume')?.checked ? defectQtyNow() : 0);
    const consumeBaseQty = () => Math.max(0, Number(container.querySelector('#prod-qty').value) || 0) + defectConsumeQty();
    const updateDefectSummary = () => {
        const el = container.querySelector('#defect-summary');
        if (!el) return;
        const good = Math.max(0, Number(container.querySelector('#prod-qty').value) || 0);
        const def = defectQtyNow();
        const unit = prodUnitBadge.textContent || 'EA';
        el.innerHTML = def > 0
            ? `불량 <span class="text-rose-600">${def.toLocaleString()}</span> · 양품 ${good.toLocaleString()} ${esc(unit)} · 불량률 <span class="text-rose-600">${fmtRate(rateOf(def, good + def))}</span>`
            : '불량 수량을 입력하세요';
    };

    // 실시간 전 행 원부자재 소요량 자동 계산 및 모니터 지표 갱신
    const recalculateAllMaterials = () => {
        const good = Math.max(0, Number(container.querySelector('#prod-qty').value) || 0);
        const defectAdd = defectConsumeQty();
        const prodQty = good + defectAdd; // 불량분도 차감하면 양품 + 불량 기준
        const prodUnit = prodUnitBadge.textContent || 'EA';

        const summaryQtyEl = container.querySelector('#summary-calc-prod-qty');
        if (summaryQtyEl) {
            summaryQtyEl.textContent = defectAdd ? `양품 ${good.toLocaleString()} + 불량 ${defectAdd.toLocaleString()} ${prodUnit} 기준` : `생산 ${prodQty.toLocaleString()} ${prodUnit} 기준`;
        }
        updateDefectSummary();

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

    // 불량 발생 칸: 유형 목록 = 품질관리 공정관리의 불량 유형(설정), 공정 = 공정 목록 + 예전 기록
    (async () => {
        const typesHost = container.querySelector('#defect-types');
        if (!typesHost) return;
        let types = QC_AREAS.PROCESS.defaultTypes;
        try { types = (await getDefectConfig('PROCESS')).types; } catch (e) { console.warn('[제품생산] 불량 유형 설정을 못 불러와 기본 목록을 씁니다:', e.message); }
        if (!container.contains(typesHost)) return;
        typesHost.innerHTML = types.map(t => `<label class="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1"><span class="flex-1 truncate" title="${esc(t)}">${esc(t)}</span><input type="number" min="0" step="any" data-type="${esc(t)}" class="w-16 border border-slate-300 rounded px-1.5 py-0.5 text-right" /></label>`).join('');
        const dl = container.querySelector('#defect-process-list');
        if (dl) dl.innerHTML = QC_AREAS.PROCESS.processes.map(p => `<option value="${esc(p)}"></option>`).join('');
    })();
    const inspectorEl = container.querySelector('#defect-inspector');
    if (inspectorEl) inspectorEl.value = state.currentUser?.name || '';
    container.querySelector('#defect-on')?.addEventListener('change', (e) => {
        container.querySelector('#defect-body').classList.toggle('hidden', !e.target.checked);
        recalculateAllMaterials();
    });
    container.querySelector('#defect-body')?.addEventListener('input', () => recalculateAllMaterials());
    container.querySelector('#defect-consume')?.addEventListener('change', () => recalculateAllMaterials());

    // 원료 행 추가 함수 (단위당 사용량 등록 & 생산수량 연동 자동산출)
    // rawCode: 작업지시서에서 불러온 행이면 원료코드 (기록에는 원료 실명 대신 이 코드를 남긴다)
    const addRawRow = (defaultCode = '', defaultRate = 1, defaultLoc = '김포공장', { rawCode = '' } = {}) => {
        const rawItems = state.master.filter(m => m.category === '원료' || m.category === '원액');
        const candidateItems = rawItems.length > 0 ? rawItems : state.master;

        const row = document.createElement('div');
        row.className = 'raw-row flex flex-wrap items-center gap-1.5 bg-white p-2.5 rounded-xl border border-blue-200 text-xs shadow-xs';
        
        const initialCode = defaultCode || (candidateItems[0] ? candidateItems[0].code : '');
        const prodQty = consumeBaseQty();
        const initialQty = Math.round(prodQty * defaultRate * 1000) / 1000;

        if (rawCode) row.dataset.rawCode = rawCode;
        row.innerHTML = `
            ${rawCode ? `<span class="shrink-0 px-1.5 py-1 rounded-lg bg-amber-100 text-amber-800 font-mono font-black text-[11px]" title="작업지시서 원료코드">${esc(rawCode)}</span>` : ''}
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
            const pQty = consumeBaseQty();
            const rate = Number(rateInput.value) || 0;
            qtyInput.value = Math.round(pQty * rate * 1000) / 1000;
            recalculateAllMaterials();
        });

        // 총 소요량 직접 수정 시 -> 단위당 사용량 역산
        qtyInput?.addEventListener('input', () => {
            const pQty = consumeBaseQty();
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
        const prodQty = consumeBaseQty();
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
            const pQty = consumeBaseQty();
            const rate = Number(rateInput.value) || 0;
            qtyInput.value = Math.round(pQty * rate * 1000) / 1000;
            recalculateAllMaterials();
        });

        qtyInput?.addEventListener('input', () => {
            const pQty = consumeBaseQty();
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

    // 라벨부착: 무라벨 용기·라벨을 개당 1개씩 투입 부자재 행으로 (원료 행은 비움)
    const fillLabelRows = () => {
        const bare = container.querySelector('#la-bare').value;
        const label = container.querySelector('#la-label').value;
        if (!bare && !label) { alert('무라벨 용기나 라벨을 고르세요.'); return; }
        const loc = container.querySelector('#prod-location').value || '김포공장';
        rawRowsList.innerHTML = '';
        subRowsList.innerHTML = '';
        if (chkBom && !chkBom.checked) { chkBom.checked = true; materialsWrapper.classList.remove('hidden'); }
        if (bare) addSubRow(bare, 1, loc);
        if (label) addSubRow(label, 1, loc);
        showToast('🏷️ 무라벨 용기·라벨을 투입 부자재로 채웠습니다 (라벨부착 용기 1개당 1개씩).');
    };
    container.querySelector('#la-fill')?.addEventListener('click', fillLabelRows);
    selectItemDropdown.addEventListener('change', () => { if (selectedProdType === '라벨부착') updateLabelPanel(); });
    container.querySelector('#prod-location')?.addEventListener('change', (e) => {
        const s = container.querySelector('#la-site');
        if (s) s.value = String(e.target.value).startsWith('본사') ? 'HQ' : 'GIMPO';
    });

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

        const targetItem = state.master.find(m => m.code === itemCode);
        saveBom(itemCode, rawList, subList).then(res => {
            showToast(res.cloud
                ? `💾 [${itemCode}] ${targetItem ? targetItem.name : ''}의 배합비(BOM)를 저장했습니다. 모든 기기와 생산계획 부족 계산에 쓰입니다.`
                : `💾 [${itemCode}] ${targetItem ? targetItem.name : ''}의 배합비를 이 기기에 저장했습니다.${targetItem?.category === '원액' ? ' (원액의 원료 배합은 보안상 클라우드에 올리지 않습니다)' : ''}`);
        }).catch(err => alert(err.message));
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

    // 배합비 목록·일괄 삭제: 배합비(BOM)만 지운다. 제조시방서·작업지시서는 건드리지 않는다.
    // 원액·원료 배합비는 보안상 이 기기에만 있으므로 다른 기기의 배합비는 그 기기에서 지운다.
    container.querySelector('#btn-bom-manage')?.addEventListener('click', async () => {
        let rows;
        try { rows = await listBoms(); } catch (err) { alert(`배합비 목록을 불러오지 못했습니다: ${err.message}`); return; }
        const nameOf = (code) => state.master.find(m => m.code === code);
        rows.sort((a, b) => a.code.localeCompare(b.code));
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-slate-900/60 z-50 flex items-start justify-center p-4 overflow-y-auto';
        const close = () => overlay.remove();
        const where = (r) => [r.cloud ? '클라우드' : '', r.local ? '이 기기' : ''].filter(Boolean).join(' · ');
        overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-8 p-5 space-y-3 text-xs">
            <div class="flex items-center justify-between">
                <h3 class="font-black text-sm text-slate-900">생산입고 배합비 목록 (${rows.length}건)</h3>
                <button type="button" class="bm-close text-slate-400 hover:text-slate-700 min-w-11 min-h-11 inline-flex items-center justify-center"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <p class="text-slate-500">배합비만 지웁니다. <b>제조시방서·원액생산 작업지시서는 그대로</b> 남습니다. 원액·원료 배합비는 이 기기에만 저장되므로 다른 PC의 배합비는 그 PC에서 지우세요. 클라우드 배합비 삭제는 관리자 이상만 됩니다.</p>
            <input id="bm-search" placeholder="품목코드·품목명 일부 검색" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold" />
            <div class="overflow-auto max-h-[55vh] border border-slate-200 rounded-xl"><table class="w-full"><thead class="bg-slate-50 font-bold text-slate-600 sticky top-0"><tr>
                <th class="p-2 w-8 text-center"><input type="checkbox" id="bm-all" class="w-4 h-4" title="보이는 배합비 전체 선택" /></th>
                <th class="p-2 text-left">품목</th><th class="p-2 text-left">분류</th><th class="p-2 text-center">원료</th><th class="p-2 text-center">부자재</th><th class="p-2 text-left">저장 위치</th>
            </tr></thead><tbody id="bm-rows" class="divide-y divide-slate-100">
            ${rows.map(r => { const m = nameOf(r.code); return `<tr class="bm-row" data-q="${esc(`${r.code} ${m?.name || ''}`.toLowerCase())}">
                <td class="p-2 text-center"><input type="checkbox" class="bm-check w-4 h-4" value="${esc(r.code)}" /></td>
                <td class="p-2"><span class="font-mono font-bold">${esc(r.code)}</span> <span class="text-slate-700">${esc(m?.name || '(품목마스터에 없음)')}</span></td>
                <td class="p-2 text-slate-500">${esc(m?.category || '-')}</td>
                <td class="p-2 text-center">${r.rawList.length}종</td><td class="p-2 text-center">${r.subList.length}종</td>
                <td class="p-2 text-slate-600">${where(r)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="p-4 text-center text-slate-400 font-bold">저장된 배합비가 없습니다.</td></tr>'}
            </tbody></table></div>
            <div class="flex items-center justify-end gap-2">
                <span id="bm-count" class="mr-auto font-bold text-slate-500">선택 0건</span>
                <button type="button" class="bm-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button>
                <button type="button" id="bm-del" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-black">선택 배합비 삭제</button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        createIcons({ icons });
        const $o = (s) => overlay.querySelector(s);
        const visibleChecks = () => [...overlay.querySelectorAll('.bm-row')].filter(tr => !tr.classList.contains('hidden')).map(tr => tr.querySelector('.bm-check'));
        const updateCount = () => { $o('#bm-count').textContent = `선택 ${overlay.querySelectorAll('.bm-check:checked').length}건`; };
        overlay.querySelectorAll('.bm-close').forEach(b => b.addEventListener('click', close));
        overlay.querySelectorAll('.bm-check').forEach(c => c.addEventListener('change', updateCount));
        $o('#bm-search').addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            overlay.querySelectorAll('.bm-row').forEach(tr => tr.classList.toggle('hidden', !!q && !tr.dataset.q.includes(q)));
        });
        $o('#bm-all').addEventListener('change', (e) => { visibleChecks().forEach(c => { c.checked = e.target.checked; }); updateCount(); });
        $o('#bm-del').addEventListener('click', async () => {
            const codes = [...overlay.querySelectorAll('.bm-check:checked')].map(c => c.value);
            if (!codes.length) { alert('지울 배합비를 고르세요.'); return; }
            if (!confirm(`선택한 배합비 ${codes.length}건을 삭제하시겠습니까? 되돌릴 수 없습니다.\n\n• 제조시방서·원액생산 작업지시서는 그대로 둡니다.\n• 클라우드 배합비는 모든 기기에서, 이 기기 배합비는 이 기기에서만 지워집니다.`)) return;
            try {
                const res = await deleteBoms(codes);
                close();
                showToast(`🗑️ 배합비 삭제 완료: 클라우드 ${res.cloud}건 · 이 기기 ${res.local}건`);
            } catch (err) {
                alert(err.message);
            }
        });
    });

    container.querySelector('#btn-quick-fill-recipe')?.addEventListener('click', () => {
        smartApplyRecipeForProduct(selectItemDropdown.value);
    });

    // ==========================================
    // 원액 생산 ↔ 원액생산 작업지시서 연동 (특별보안: 마스터·작업일지 관리자만)
    // 선택한 원액으로 발행된 미완료 작업지시서를 찾아 원료 투입 행으로 불러오고,
    // 생산 입고를 처리하면 그 작업지시서를 '생산 완료'로 바꿔 두 번 처리되지 않게 한다.
    // ==========================================
    let linkedOrder = null;
    let linkedUnlinkedCodes = [];
    let woLoaded = false;
    const woPanel = container.querySelector('#wo-link-panel');
    const OPEN_STATUS = ['ISSUED', 'DRAFT'];
    const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
    const orderRecipe = (o) => secure.recipes.find(r => r.id === o.recipeId);
    const orderProductCode = (o) => orderRecipe(o)?.productItemCode || o.productItemCode || '';
    const orderLitersPerUnit = (o) => {
        const r = orderRecipe(o);
        return Number(o.baseLitersPerUnit) || (r ? (Number(r.baseLiters) || 0) / (Number(r.baseQty) || 1) : 0);
    };
    const orderLiters = (o) => r3(orderLitersPerUnit(o) * (Number(o.prodQty) || 0)) || r3((o.materials || []).reduce((s, m) => s + (Number(m.liters) || 0), 0));

    const woRowHtml = (o) => `
        <div class="flex flex-wrap items-center justify-between gap-2 p-2 bg-white border border-amber-200 rounded-lg">
            <div class="min-w-0">
                <span class="font-mono font-black text-amber-800">${esc(o.orderNo)}</span>
                <span class="ml-1 text-slate-500">${esc(o.mfgDate || '')}</span>
                <span class="ml-1 font-bold text-slate-900">${esc(o.productName || '')}</span>
                <span class="text-slate-400">${esc(o.revision || '')}</span>
                <div class="text-[11px] text-slate-600">생산량 ${esc(o.prodQty)} ${esc(o.prodUnit || 'D/M')} ≈ ${orderLiters(o).toLocaleString()} L · 원료 ${(o.materials || []).length}종${o.lotNo ? ` · LOT ${esc(o.lotNo)}` : ''}</div>
            </div>
            <button type="button" class="btn-wo-apply px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-black" data-id="${esc(o.id)}">불러오기</button>
        </div>`;

    const renderWoList = () => {
        const listEl = woPanel.querySelector('#wo-list');
        const otherEl = woPanel.querySelector('#wo-other-list');
        if (!listEl) return;
        const code = selectItemDropdown.value;
        const open = secure.orders.filter(o => OPEN_STATUS.includes(o.status));
        const forItem = open.filter(o => code && orderProductCode(o) === code);
        listEl.innerHTML = forItem.length
            ? forItem.map(woRowHtml).join('')
            : `<div class="p-2 text-slate-500">선택한 원액${code ? `(${esc(code)})` : ''}으로 발행된 미완료 작업지시서가 없습니다. 아래에서 다른 작업지시서를 검색할 수 있습니다.</div>`;
        const q = woPanel.querySelector('#wo-search')?.value.trim() || '';
        const others = q ? open.filter(o => !forItem.includes(o) && matchesQuery(o, q, ['orderNo', 'productName', 'lotNo', 'revision'])) : [];
        otherEl.innerHTML = q ? (others.map(woRowHtml).join('') || '<div class="p-2 text-slate-400">검색 결과가 없습니다.</div>') : '';
        woPanel.querySelectorAll('.btn-wo-apply').forEach(b => b.addEventListener('click', () => applyWorkOrder(secure.orders.find(o => o.id === b.dataset.id))));
    };

    const renderWoPanel = async () => {
        if (!woPanel) return;
        if (selectedProdType !== '원액') { woPanel.classList.add('hidden'); return; }
        woPanel.classList.remove('hidden');
        if (!hasWorklogAccess()) {
            woPanel.innerHTML = '<div class="text-slate-600">📋 작업지시서 불러오기는 마스터·작업일지 관리자만 사용할 수 있습니다. 원료를 직접 추가해 처리하세요.</div>';
            return;
        }
        if (!woLoaded) {
            woPanel.innerHTML = '<div class="text-slate-500 font-bold">🔒 작업지시서를 불러오는 중...</div>';
            try { await loadSecureData(); woLoaded = true; } catch (e) { woPanel.innerHTML = `<div class="text-rose-600 font-bold">작업지시서를 불러오지 못했습니다: ${esc(e.message)}</div>`; return; }
        }
        if (linkedOrder) {
            woPanel.innerHTML = `
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="font-black text-amber-900">📋 작업지시서 <span class="font-mono">${esc(linkedOrder.orderNo)}</span> 연결됨 · ${esc(linkedOrder.productName || '')} ${esc(linkedOrder.revision || '')} · ${esc(linkedOrder.prodQty)} ${esc(linkedOrder.prodUnit || 'D/M')}</div>
                    <button type="button" id="btn-wo-unlink" class="px-2.5 py-1 bg-white border border-amber-300 rounded-lg font-bold">연결 해제</button>
                </div>
                <div class="text-[11px] text-amber-800">아래 원료 투입 내용을 확인·수정한 뒤 [생산 입고] 처리하면 이 작업지시서가 '생산 완료'로 바뀝니다. 기록에는 원료 실명 대신 원료코드가 남습니다.</div>
                ${linkedUnlinkedCodes.length ? `<div class="text-[11px] font-bold text-rose-600">⚠ 재고 품목이 연결되지 않은 원료 ${linkedUnlinkedCodes.length}종은 차감되지 않습니다: ${esc(linkedUnlinkedCodes.join(', '))} (제조시방서에서 재고 연결)</div>` : ''}`;
            woPanel.querySelector('#btn-wo-unlink').addEventListener('click', () => {
                linkedOrder = null;
                linkedUnlinkedCodes = [];
                renderWoPanel();
                showToast('작업지시서 연결을 해제했습니다. (원료 행은 그대로 둡니다)');
            });
            return;
        }
        woPanel.innerHTML = `
            <div class="font-black text-amber-900">📋 작업지시서에서 사용 원료 불러오기</div>
            <div id="wo-list" class="space-y-1.5"></div>
            <input type="text" id="wo-search" placeholder="다른 작업지시서 검색 (지시번호·제품명·LOT 일부)" autocomplete="off" class="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 font-bold" />
            <div id="wo-other-list" class="space-y-1.5"></div>`;
        woPanel.querySelector('#wo-search').addEventListener('input', renderWoList);
        renderWoList();
    };

    const applyWorkOrder = (o) => {
        if (!o) return;
        if (!OPEN_STATUS.includes(o.status)) { alert('이미 생산 완료되었거나 취소된 작업지시서입니다.'); return; }
        const pcode = orderProductCode(o);
        if (pcode) {
            if (![...selectItemDropdown.options].some(op => op.value === pcode)) {
                const m = state.master.find(x => x.code === pcode);
                selectItemDropdown.insertAdjacentHTML('afterbegin', `<option value="${esc(pcode)}">[${esc(pcode)}] ${esc(m?.name || pcode)} (${esc(m?.spec || '-')})</option>`);
            }
            selectItemDropdown.value = pcode;
        }
        const liters = orderLiters(o);
        container.querySelector('#prod-qty').value = liters;
        const loc = container.querySelector('#prod-location').value;
        rawRowsList.innerHTML = '';
        subRowsList.innerHTML = '';
        // 재고 연결은 제조시방서의 현재 값을 우선한다 (발행 뒤에 시방서에서 연결한 원료도 차감되게, 생산 완료 처리와 같은 규칙)
        const recipeMats = orderRecipe(o)?.materials || [];
        const mats = (o.materials || []).map(m => ({ ...m, itemCode: recipeMats.find(x => x.seq === m.seq)?.itemCode || m.itemCode || '' }));
        const isLinked = (m) => m.itemCode && state.master.some(x => x.code === m.itemCode) && (Number(m.liters) > 0 || Number(m.kg) > 0);
        mats.filter(isLinked).forEach(m => {
            const q = rawRowUnit(m.itemCode) === 'KG' ? Number(m.kg) || 0 : Number(m.liters) || 0;
            addRawRow(m.itemCode, liters > 0 ? Math.round((q / liters) * 1e6) / 1e6 : 0, loc, { rawCode: m.rawCode || '' });
        });
        linkedUnlinkedCodes = mats.filter(m => !isLinked(m)).map(m => m.rawCode || `#${m.seq}`);
        container.querySelector('#prod-lot-no').value = o.lotNo || o.orderNo;
        if (o.mfgDate) container.querySelector('#prod-mfg-date').value = o.mfgDate;
        container.querySelector('#prod-notes').value = `원액생산 작업지시서 ${o.orderNo}`;
        chkBom.checked = true;
        materialsWrapper.classList.remove('hidden');
        linkedOrder = o;
        recalculateAllMaterials();
        renderWoPanel();
        showToast(`📋 작업지시서 ${o.orderNo}의 원료 ${mats.length - linkedUnlinkedCodes.length}종을 불러왔습니다. 확인 후 처리하세요.`);
    };

    // 품목 드롭다운 변경 시 배합비 자동 연동
    selectItemDropdown?.addEventListener('change', () => {
        if (linkedOrder && orderProductCode(linkedOrder) !== selectItemDropdown.value) { linkedOrder = null; linkedUnlinkedCodes = []; }
        smartApplyRecipeForProduct(selectItemDropdown.value);
        renderWoPanel();
    });
    prodSearchInput?.addEventListener('input', () => { if (!linkedOrder) renderWoPanel(); });
    container.querySelectorAll('.btn-prod-type-select').forEach(btn => btn.addEventListener('click', () => {
        if (selectedProdType !== '원액') { linkedOrder = null; linkedUnlinkedCodes = []; }
        renderWoPanel();
    }));

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
                : item.prodType === '라벨부착'
                ? '<span class="px-1.5 py-0.5 text-[10px] font-black bg-violet-100 text-violet-800 rounded">라벨부착</span>'
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
        const bomDeducted = container.querySelector('#chk-bom-deduct').checked;
        // 불량 발생: 재고에는 양품만, 불량은 생산 기록 비고 + 품질관리 공정 불량 기록
        const defects = defectOn() ? defectInputs().filter(el => Number(el.value) > 0).map(el => ({ type: el.dataset.type, qty: Number(el.value) })) : [];
        const defectQty = defects.reduce((s, d) => s + d.qty, 0);
        if (defectOn() && !defectQty && !confirm('불량 발생 반영을 켰지만 불량 수량이 없습니다. 불량 없이 처리할까요?')) return;
        const prodUnitNow = selectedProdType === '원액' ? 'L' : selectedProdType === '반제품' ? 'KG' : 'EA';
        const defectHandling = container.querySelector('#defect-handling')?.value || '';
        const defectNote = defectQty ? `[불량 ${defectQty.toLocaleString()} ${prodUnitNow} · ${defects.map(d => `${d.type} ${d.qty}`).join(', ')} · ${defectHandling}]` : '';
        const notes = [container.querySelector('#prod-notes').value.trim(), defectNote].filter(Boolean).join(' ');

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
                        name: row.dataset.rawCode || (mItem ? mItem.name : bCode), // 작업지시서 원료는 원료코드로 기록
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

        // 연결된 작업지시서가 그사이 다른 곳에서 완료·취소되었으면 중복 처리를 막는다
        const order = linkedOrder && selectedProdType === '원액' ? (secure.orders.find(o => o.id === linkedOrder.id) || linkedOrder) : null;
        if (order && !OPEN_STATUS.includes(order.status)) {
            alert(`작업지시서 ${order.orderNo}는 이미 생산 완료되었거나 취소되었습니다. [연결 해제] 후 처리하세요.`);
            return;
        }
        if (selectedProdType === '라벨부착' && !rawMaterials.some(m => m.matType === '부자재')
            && !confirm('투입 부자재(무라벨 용기·라벨)가 없어 차감 없이 라벨부착 용기만 입고됩니다.\n[↓ 투입 부자재로 채우기]를 누르지 않았다면 취소하세요. 그대로 진행할까요?')) return;
        if (order && !confirm(`작업지시서 ${order.orderNo} (${order.productName || ''})로 원액 ${prodQty.toLocaleString()} L를 생산 입고하고, 원료 ${rawMaterials.filter(m => m.matType === '원료').length}종을 차감합니다.\n처리 후 작업지시서는 '생산 완료'로 바뀝니다. 진행할까요?`)) return;

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
                notes,
                ...(order ? { workOrderNo: order.orderNo } : {})
            });

            if (order) {
                const perUnit = orderLitersPerUnit(order);
                try {
                    await saveSecureOrder({
                        ...order,
                        status: 'COMPLETED',
                        actualQty: perUnit > 0 ? r3(prodQty / perUnit) : order.prodQty,
                        completedAt: new Date().toISOString(),
                        completion: {
                            inventoryApplied: true,
                            via: '제품생산/입고',
                            location,
                            liters: prodQty,
                            deductedCount: rawMaterials.filter(m => m.matType === '원료').length,
                            unlinkedCount: linkedUnlinkedCodes.length
                        }
                    });
                } catch (e) {
                    alert(`생산 입고는 처리되었지만 작업지시서 ${order.orderNo}를 '생산 완료'로 바꾸지 못했습니다.\n원액생산 작업지시서 화면에서 상태를 확인하세요. (${e.message})`);
                }
            }

            // 라벨부착: 업무일지 '라벨부착작업'에 줄 추가 (기록·실적용, 재고는 위에서 이미 처리)
            let logMsg = '';
            if (selectedProdType === '라벨부착' && container.querySelector('#la-log')?.checked) {
                try {
                    const site = container.querySelector('#la-site').value || 'GIMPO';
                    const date = mfgDate || localDateStr();
                    const m = state.master.find(x => x.code === prodItemCode) || { code: prodItemCode, name: prodItemCode };
                    const h = Math.max(0, Number(container.querySelector('#la-hours').value) || 0);
                    const wc = Math.max(1, Number(container.querySelector('#la-wc').value) || 1);
                    const tot = Math.round(h * wc * 100) / 100;
                    const log = getGimpoLogByDate(date, site);
                    log.labeling = log.labeling || [];
                    log.labeling.push({
                        item: `${m.code} / ${m.name}`, spec: m.spec || '', qty: prodQty, box: Math.max(0, Number(container.querySelector('#la-box').value) || 0),
                        workHours: h, workersCount: wc, totalWorkHours: tot, line: container.querySelector('#la-line').value.trim(), lotNo,
                        category: m.subCategory || '라벨부착', manHours: Math.round((tot / 7.5) * 100) / 100,
                        workers: String(worker || '').replace(/\s*\(.*\)\s*$/, ''), source: 'prod-label', prodId: result?.production?.id || ''
                    });
                    saveGimpoLog(log, site);
                    logMsg = ` · ${WORKLOG_SITES[site]?.name || ''} 업무일지(${date}) 라벨부착작업에 기록`;
                } catch (e) {
                    alert(`라벨부착 입고는 처리되었지만 업무일지에 기록하지 못했습니다: ${e.message}`);
                }
            }

            // 불량 발생 → 품질관리 공정관리 불량 기록 (검사수량 = 양품 + 불량)
            if (defectQty > 0) {
                try {
                    const m = state.master.find(x => x.code === prodItemCode) || { code: prodItemCode, name: prodItemCode };
                    const cause = container.querySelector('#defect-cause').value.trim();
                    const action = container.querySelector('#defect-action').value.trim();
                    await saveQc('INSPECT', {
                        area: 'PROCESS', date: mfgDate || localDateStr(), itemCode: m.code, itemName: m.name, lot: lotNo,
                        process: container.querySelector('#defect-process').value.trim() || selectedProdType,
                        inspectedQty: prodQty + defectQty, unit: prodUnitNow, defects, defectQty,
                        result: container.querySelector('#defect-result').value || 'PASS',
                        cause, action: [action, defectHandling ? `불량품 ${defectHandling}` : ''].filter(Boolean).join(' · '), actionDone: !!action,
                        inspector: container.querySelector('#defect-inspector').value.trim() || String(worker || '').replace(/\s*\(.*\)\s*$/, ''),
                        notes: `제품생산/입고에서 등록 (${selectedProdType} 양품 ${prodQty.toLocaleString()} ${prodUnitNow} 입고)`, source: 'production', prodId: result?.production?.id || ''
                    });
                    showToast(`⚠️ 불량 ${defectQty.toLocaleString()} ${prodUnitNow}을(를) 품질관리 → 공정관리 불량 기록으로 남겼습니다 (불량률 ${fmtRate(rateOf(defectQty, prodQty + defectQty))}).`);
                } catch (e) {
                    alert(`생산 입고는 처리되었지만 불량 기록을 남기지 못했습니다. 품질관리 → 공정관리에서 직접 입력하세요.\n(${e.message})`);
                }
            }

            const rawCount = result?.rawLedgerEntries?.length || 0;
            if (logMsg) showToast(`🏷️ 라벨부착 ${prodQty.toLocaleString()} EA 처리${logMsg}`);
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
