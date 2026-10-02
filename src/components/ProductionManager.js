import { state, processProductionInbound, allocateMaterialStock, deleteProductionRecord, getGimpoLogByDate, saveGimpoLog, WORKLOG_SITES } from '../services/db.js';
import { localDateStr, matchesQuery } from '../services/searchUtils.js';
import { locationOptionsHtml, siteOf, buildingOf } from '../services/locations.js';
import { hasWorklogAccess } from '../services/auth.js';
import { secure, loadSecureData, saveSecureOrder } from '../services/secureWorkOrders.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { attachSelectSearch } from '../services/selectSearch.js';
import { getBoms, loadBoms, saveBom, listBoms, deleteBoms } from '../services/plans.js';
import { QC_AREAS, getDefectConfig, saveQc, rateOf, fmtRate } from '../services/quality.js';
import { siteFromText } from '../services/qcStandards.js';
import { reflectProduction, worklogSiteOfLocation, blendPackOf } from '../services/prodReflect.js';
import { PROD_TABS, rememberProdSite } from '../services/prodSites.js';
import { isIbcPack, planToteUse, registerFill, consumeBlend, oilTypeOf, oilTypeByTote, ibcCountOf, TOTE_NAME } from '../services/ibcTotes.js';
import { standardOf, standardSummary } from './PackUsageStandards.js';
import { mountSearchRegister } from './production/SearchRegister.js';

// 총소요량을 직접 넣었을 때 역산하는 '단위당 사용량'의 자릿수 (소수 8자리).
// 4자리로 자르면 생산 수량을 다시 곱할 때 총량이 달라져(예: 800.2 → 800.288) 재고가 딱 맞는 줄이 '부족'으로 바뀐다.
const RATE_PRECISION = 1e8;

/**
 * 제품생산/입고 화면. 거점마다 메뉴가 따로다 (탭 productionHq = 본사, production = 김포 — services/prodSites.js).
 * 그 거점의 창고에만 입고하고 그 거점의 재고에서만 원부자재를 차감하며, 지표·실적 대장도 그 거점 것만 보여 준다.
 * @param {HTMLElement} container
 * @param {{ showToast: Function, onSwitchTab: Function, site?: 'HQ'|'GIMPO' }} opts
 */
export const renderProductionManager = (container, { showToast, onSwitchTab, site = 'GIMPO' }) => {
    const siteCfg = WORKLOG_SITES[site] || WORKLOG_SITES.GIMPO; // { key, name: '본사'|'김포', location: 재고 거점 '본사'|'김포공장' }
    const otherSite = Object.values(WORKLOG_SITES).find(s => s.key !== siteCfg.key);
    const SITE_LOC = siteCfg.location;
    /** 그 위치(또는 거점 이름)가 이 메뉴의 거점인지 — 본사가 아닌 위치는 모두 김포 메뉴가 맡는다 */
    const inSite = (loc) => worklogSiteOfLocation(loc) === siteCfg.key;
    /** 이 거점의 위치만 넣은 선택 목록 */
    const locOptions = (selected) => locationOptionsHtml(state.locations, selected, { siteFilter: inSite });
    /** 다른 거점의 위치(예전 기준서에 적힌 창고 등)는 이 거점(창고 미지정)으로 바꾼다 */
    const locInSite = (loc) => (loc && inSite(loc) ? loc : SITE_LOC);
    rememberProdSite(siteCfg.key);
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
    // 등록 방식: direct(직접 등록 폼) / search(검색 등록: QR·검색 단계별, components/production/SearchRegister.js), 기기별 저장
    const REG_MODE_KEY = 'daelim_prod_reg_mode';
    let regMode = 'direct';
    try { regMode = localStorage.getItem(REG_MODE_KEY) === 'search' ? 'search' : 'direct'; } catch { /* 기본값 */ }
    // 등록 방식 탭 모양: 고른 탭 / 나머지
    const REG_TAB_ON = ['bg-white', 'text-blue-700', 'shadow-sm'];
    const REG_TAB_OFF = ['text-slate-600', 'hover:text-slate-900'];

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

    // 이 거점의 생산 실적 (입고 위치로 가름 — 지표·실적 대장·CSV가 같이 쓴다)
    const siteProductions = () => (state.productions || []).filter(p => inSite(p.location));

    // KPI 통계 계산
    const productions = siteProductions();
    const todayProds = productions.filter(p => p.prodDate === todayStr);
    const todayTotalQty = todayProds.reduce((acc, cur) => acc + Number(cur.qty || 0), 0);
    const monthProds = productions.filter(p => p.prodDate && p.prodDate.slice(0, 7) === todayStr.slice(0, 7));
    const monthTotalQty = monthProds.reduce((acc, cur) => acc + Number(cur.qty || 0), 0);
    const totalLotsCount = new Set(productions.map(p => p.lotNo)).size;
    const monthWonaekProds = monthProds.filter(p => p.prodType === '원액');

    container.innerHTML = `
    <section id="tab-content-production" class="space-y-6">
        <!-- 화면 머리: 제목 · 도구 · 등록 방식 탭 -->
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-[11px] font-black text-blue-600 flex items-center gap-1"><i data-lucide="factory" class="w-3.5 h-3.5"></i>생산·현장 › 제품생산/입고(${esc(siteCfg.name)})</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex flex-wrap items-center gap-2">제품생산 / 입고 <span class="px-2 py-0.5 rounded-lg bg-blue-600 text-white text-xs font-black">${esc(siteCfg.name)}</span></h2>
                    <p class="text-xs text-slate-500 mt-1"><b>${esc(siteCfg.name)}</b>에서 만든 완제품 충진·포장, 원액 블렌딩, 반제품 제조를 ${esc(SITE_LOC)} 창고에 입고로 등록하고 투입한 원료·부자재를 ${esc(SITE_LOC)} 재고에서 자동으로 차감합니다.</p>
                </div>
                <div class="flex items-center flex-wrap gap-2">
                    <button type="button" id="btn-goto-other-site" class="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5" title="${esc(otherSite.name)}에서 만든 것은 ${esc(otherSite.name)} 메뉴에서 등록합니다">
                        <i data-lucide="arrow-left-right" class="w-4 h-4 text-blue-600"></i>
                        <span>${esc(otherSite.name)} 화면으로</span>
                    </button>
                    <button type="button" id="btn-export-prod-csv" class="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5">
                        <i data-lucide="file-spreadsheet" class="w-4 h-4 text-emerald-600"></i>
                        <span>생산 실적 CSV</span>
                    </button>
                    <button type="button" onclick="window.print()" class="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>생산 일지 인쇄</span>
                    </button>
                </div>
            </div>

            <!-- 등록 방식 탭 -->
            <div class="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit max-w-full">
                ${[['direct', 'package-plus', '직접 등록 & 실적 대장'], ['search', 'scan-search', '검색 등록 (QR·검색)']].map(([k, ic, l]) => `
                <button type="button" class="btn-reg-mode px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition ${(regMode === k ? REG_TAB_ON : REG_TAB_OFF).join(' ')}" data-mode="${k}">
                    <i data-lucide="${ic}" class="w-4 h-4"></i><span>${l}</span>
                </button>`).join('')}
                ${hasWorklogAccess() ? `
                <button type="button" id="btn-goto-secure-wo" class="px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 text-amber-700 hover:bg-white" title="마스터·작업일지 관리자 전용 메뉴로 이동">
                    <i data-lucide="flask-round" class="w-4 h-4"></i>
                    <span>원액생산 작업지시서 🔒</span>
                </button>` : ''}
            </div>
        </div>

        <!-- 생산 지표 -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            ${[
                { label: '금일 생산 입고량', icon: 'package-check', iconTone: 'text-emerald-500', value: todayTotalQty.toLocaleString(), unit: '개/L', sub: `오늘 완료: ${todayProds.length}건` },
                { label: '당월 누적 생산 실적', icon: 'calendar-check-2', iconTone: 'text-sky-500', value: monthTotalQty.toLocaleString(), unit: '개/L', sub: `당월 누적: ${monthProds.length}건` },
                { label: '당월 원액 생산', icon: 'flask-round', iconTone: 'text-amber-500', value: monthWonaekProds.length.toLocaleString(), unit: '건', sub: `당월 원액 생산량: ${monthWonaekProds.reduce((s, p) => s + (Number(p.qty) || 0), 0).toLocaleString()} L` },
                { label: '관리 중인 생산 LOT', icon: 'layers', iconTone: 'text-purple-500', value: totalLotsCount.toLocaleString(), unit: '개 로트', sub: '전 공정 이력 추적' }
            ].map(k => `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-4">
                <div class="flex items-center justify-between text-slate-500 text-[11px] font-bold">
                    <span>${k.label}</span>
                    <i data-lucide="${k.icon}" class="w-4 h-4 ${k.iconTone}"></i>
                </div>
                <div class="flex items-baseline gap-1 mt-1">
                    <span class="text-xl sm:text-2xl font-black text-slate-900">${k.value}</span>
                    <span class="text-xs text-slate-400 font-bold">${k.unit}</span>
                </div>
                <span class="text-[11px] text-slate-400 mt-1 block max-sm:hidden">${k.sub}</span>
            </div>`).join('')}
        </div>

        <!-- ============================================================= -->
        <!-- 서브 탭 1: 생산 입고 등록 & 최근 생산 실적 (production) -->
        <!-- ============================================================= -->
        <div id="subtab-view-production" class="space-y-6">
            <!-- 등록 창과 실적 대장을 가로로 길게 위/아래 배치 (순서는 [위치 바꾸기]로 변경, 이 기기에 저장) -->
            <div id="prod-panels" class="flex flex-col gap-6">
                <!-- 검색 등록 (QR·검색 단계별 → 아래 직접 등록 폼으로 옮겨 같은 처리) -->
                <div id="prod-panel-search" class="${regMode === 'search' ? '' : 'hidden'}" style="order:${panelOrder === 'list-first' ? 2 : 1}"></div>
                <!-- 생산 입고 등록 폼 -->
                <div id="prod-panel-form" class="space-y-4 ${regMode === 'search' ? 'hidden' : ''}" style="order:${panelOrder === 'list-first' ? 2 : 1}">
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
                            <!-- 원액을 IBC에 담을 때: IBC 개수 → 유종 공토트(없으면 990001) 차감 + IBC 대장 등록 (services/ibcTotes.js) -->
                            <div id="ibc-box" class="hidden p-2.5 rounded-xl border border-sky-200 bg-sky-50 text-xs space-y-1.5">
                                <div class="flex items-center gap-2">
                                    <label class="font-bold text-sky-900">IBC 개수</label>
                                    <input type="number" id="prod-ibc-count" min="0" step="1" value="1" class="w-20 bg-white border border-sky-300 rounded-lg px-2 py-1 font-black text-right" />
                                    <label class="flex items-center gap-1 font-bold text-sky-900 ml-auto"><input type="checkbox" id="prod-ibc-deduct" checked /> 공토트 차감</label>
                                </div>
                                <div id="ibc-plan" class="text-[11px] text-sky-800"></div>
                            </div>

                            <!-- 입고 창고 및 작업자 -->
                            <div class="grid grid-cols-2 gap-2">
                                <div>
                                    <label class="block text-xs font-bold text-slate-700 mb-1">입고 창고 <span class="font-normal text-slate-400">(${esc(siteCfg.name)})</span></label>
                                    <select id="prod-location" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                        ${locOptions(SITE_LOC)}
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
                                            <select id="la-site" class="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5" title="이 메뉴의 거점 업무일지에 기록합니다"><option value="${esc(siteCfg.key)}">${esc(siteCfg.name)}</option></select></label>
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
                                    <div class="flex flex-wrap items-center justify-end gap-1.5">
                                        <button type="button" id="btn-pack-std-search" class="text-[10px] font-bold text-amber-800 hover:text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 rounded-md flex items-center gap-1 transition" title="포장사용기준서(완제품·라벨부착 1단위 원액·부자재 사용량)를 코드·품명으로 찾아 넣기">
                                            <i data-lucide="search" class="w-3 h-3 text-amber-700"></i>
                                            <span>포장사용기준서 검색</span>
                                        </button>
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
                                    <div id="recipe-calc-summary-bar" class="p-3 bg-blue-50/60 border border-blue-200 rounded-xl space-y-2">
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

                            <label id="reflect-wrap" class="flex items-start gap-2 p-3 bg-blue-50/60 border border-blue-200 rounded-2xl text-xs cursor-pointer">
                                <input type="checkbox" id="prod-reflect" checked class="mt-0.5 w-4 h-4 accent-blue-600" />
                                <span><b class="text-blue-900">업무일지·초·중·종물 검사·포장수율표에도 같이 반영</b> <span class="text-slate-600">— 완제품은 제조일자 업무일지 <b>제품포장작업</b>(재고 반영됨 표시, 수불부 반영 때 다시 넣지 않음)·초·중·종물 작업 줄·수율표 포장 줄에, 원액은 업무일지 <b>원액생산작업</b>(재고 반영됨)에, 라벨부착은 수율표 <b>라벨작업</b> 줄에 넣습니다 (입고 거점의 업무일지·작업장).</span></span>
                            </label>
                            <div class="pt-2 flex justify-end">
                                <button type="submit" id="btn-submit-production" class="w-full lg:w-auto lg:px-12 py-3 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl text-xs transition shadow-md flex items-center justify-center gap-2">
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
                            <div class="flex flex-wrap items-center gap-2">
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
        container.querySelector('#prod-panel-search').style.order = panelOrder === 'list-first' ? 2 : 1;
        container.querySelector('#prod-panel-list').style.order = panelOrder === 'list-first' ? 1 : 2;
        container.querySelector('#prod-panels').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));

    // 원액생산 작업지시서(특별보안) 메뉴로 이동
    container.querySelector('#btn-goto-secure-wo')?.addEventListener('click', () => onSwitchTab?.('secureWorkOrders'));
    // 다른 거점의 제품생산/입고 메뉴로 — 고른 품목은 그대로 가져간다 (품목 QR로 왔는데 거점이 달랐을 때 다시 찍지 않게)
    container.querySelector('#btn-goto-other-site')?.addEventListener('click', () => {
        const code = container.querySelector('#prod-item-code')?.value;
        if (code && selectedProdType !== '라벨부착') window.__prodPrefill = { code };
        onSwitchTab?.(PROD_TABS[otherSite.key]);
    });

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

        // 구분을 바꾸면 검색어를 비우고 그 구분의 품목 전체를 넣는다 (앞 60개만 넣으면 뒤쪽 품목은 고를 수 없었음)
        const search = container.querySelector('#prod-item-search');
        if (search) search.value = '';
        fillProductOptions(items, '해당 분류의 품목이 없습니다');
        updateLabelPanel();
    };

    const productOptionHtml = (m) => `<option value="${esc(m.code)}">[${esc(m.code)}] ${esc(m.name)} (${esc(m.spec || '-')})</option>`;
    // 드롭다운 채우기: 지금 고른 품목이 목록에 있으면 그대로 두고, 없으면 첫 품목을 고른 뒤 change를 보내 배합비·작업지시서를 다시 맞춘다
    const fillProductOptions = (items, emptyText) => {
        const prev = selectItemDropdown.value;
        selectItemDropdown.innerHTML = items.length === 0 ? `<option value="">${esc(emptyText)}</option>` : items.map(productOptionHtml).join('');
        if (items.some(m => m.code === prev)) selectItemDropdown.value = prev;
        if (selectItemDropdown.value !== prev) selectItemDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // 품목 검색: 지금 구분(완제품·원액·반제품·라벨부착)의 품목 안에서 코드·품명·규격 일부로 찾는다.
    // 공백·기호 무시(5w30 → 5W-30), 여러 단어는 모두 포함. 코드 일치 → 품명 시작 → 나머지 순.
    const searchProductItems = (q) => {
        const items = getItemsForType(selectedProdType);
        if (!q) return items;
        const lq = q.toLowerCase().replace(/\s+/g, '');
        const rank = (m) => {
            const code = String(m.code || '').toLowerCase();
            const name = String(m.name || '').toLowerCase().replace(/\s+/g, '');
            if (code === lq) return 0;
            if (code.startsWith(lq) || name.startsWith(lq)) return 1;
            return 2;
        };
        return items.filter(m => matchesQuery(m, q, ['code', 'name', 'spec'])).sort((a, b) => rank(a) - rank(b));
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
        fillProductOptions(searchProductItems(q), `'${q}'와 일치하는 ${selectedProdType} 품목 없음`);
        if (selectedProdType === '라벨부착') updateLabelPanel();
    });
    // 검색칸에서 Enter: 생산 등록 폼이 제출되지 않게 막고, 첫 결과가 골라진 상태로 생산 수량으로 넘어간다
    prodSearchInput?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (selectItemDropdown.value) container.querySelector('#prod-qty')?.focus();
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

    // 원료 행은 L로 입력받되, 품목 마스터 단위가 KG/G인 원료는 그 단위로 입력받는다 (원료수불부에는 비중으로 L 환산)
    const rowUnitOf = (row, defaultUnit) => (row.classList.contains('raw-row') ? rawRowUnit(row.querySelector('.item-select')?.value) : defaultUnit);

    // 재고 표시: 생산입고 처리(processProductionInbound)와 같은 배분 규칙(allocateMaterialStock)으로 모든 줄을 위에서부터 계산한다.
    //  · 거점만 고른 줄(창고 미지정)은 그 거점의 창고·구획 재고까지 쓴다 → 재고는 거점 전체, 나눠 꺼낼 창고는 풍선 도움말에
    //  · 같은 품목을 여러 줄에 넣으면 앞 줄이 잡은 만큼 빼고 보여 준다
    const STOCK_BADGE = 'stock-badge max-w-full text-[10px] font-bold px-1.5 py-0.5 rounded border';
    const shortLocName = (loc) => buildingOf(loc) || `${siteOf(loc)}(창고 미지정)`;
    const refreshStockBadges = () => {
        const used = new Map();
        const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString();
        [...rawRowsList.querySelectorAll('.raw-row'), ...subRowsList.querySelectorAll('.sub-row')].forEach(row => {
            const badge = row.querySelector('.stock-badge');
            if (!badge) return;
            const code = row.querySelector('.item-select')?.value;
            const loc = row.querySelector('.item-loc')?.value || '';
            const qty = Number(row.querySelector('.item-qty')?.value) || 0;
            const unit = rowUnitOf(row, 'EA');
            const plan = allocateMaterialStock(code, loc, qty, used);
            const partsText = plan.parts.map(p => `${shortLocName(p.location)} ${fmt(p.qty)}${unit}`).join(' + ');
            const elseText = plan.elsewhere.map(e => `${shortLocName(e.location)} ${fmt(e.qty)}${unit}`).join(', ');
            const isSplit = plan.parts.length > 1 || (plan.parts[0] && plan.parts[0].location !== loc);
            if (plan.short > 0) {
                // 다른 곳의 재고: 이 거점의 다른 창고면 줄을 더해 쓰고, 다른 거점이면 먼저 옮겨 와야 한다 (이 메뉴는 이 거점 재고만 차감)
                const here = plan.elsewhere.filter(e => inSite(e.location)), away = plan.elsewhere.filter(e => !inSite(e.location));
                const hint = [
                    here.length ? `${siteCfg.name}의 다른 창고(${here.map(e => shortLocName(e.location)).join(', ')})에 재고가 있습니다 — 그 창고를 고른 줄을 따로 추가하세요.` : '',
                    away.length ? `${otherSite.name}(${away.map(e => shortLocName(e.location)).join(', ')})에 있는 재고는 거점이동으로 ${siteCfg.name}에 옮긴 뒤 쓰세요.` : ''
                ].filter(Boolean).join(' ');
                badge.textContent = `재고: ${fmt(plan.available)}${unit} (부족: ${fmt(plan.short)}${unit})${elseText ? ` · 다른 곳: ${elseText}` : ''}`;
                badge.title = hint ? `이 창고(거점)의 재고가 모자랍니다. ${hint}` : '어느 창고에도 남은 재고가 없습니다.';
                badge.className = `${STOCK_BADGE} bg-rose-50 text-rose-600 border-rose-200`;
            } else {
                badge.textContent = `재고: ${fmt(plan.available)}${unit} (차감후: ${fmt(plan.available - qty)}${unit})${isSplit ? ` · 차감: ${partsText}` : ''}`;
                badge.title = isSplit ? '창고를 정하지 않아(창고 미지정) 이 거점의 창고 재고에서 나눠 꺼냅니다.' : '';
                badge.className = `${STOCK_BADGE} ${isSplit ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`;
            }
        });
    };

    // 한 줄의 단위 글자를 맞추고 재고 표시를 다시 계산한다 (품목·창고를 바꿨을 때)
    const updateRowUnit = (row, defaultUnit = 'L') => {
        const unit = rowUnitOf(row, defaultUnit);
        row.querySelectorAll('.unit-label').forEach(el => { el.textContent = unit; });
    };
    const updateRowStockIndicator = (row, defaultUnit = 'L') => {
        updateRowUnit(row, defaultUnit);
        refreshStockBadges();
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
            updateRowUnit(row, 'L');
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
            updateRowUnit(row, 'EA');
        });
        refreshStockBadges(); // 모든 줄의 수량이 정해진 뒤 한 번에 (같은 품목을 여러 줄에 넣은 경우까지 맞게)

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
    const addRawRow = (defaultCode = '', defaultRate = 1, defaultLoc = SITE_LOC, { rawCode = '' } = {}) => {
        const rowLoc = locInSite(defaultLoc); // 다른 거점의 창고가 넘어오면 이 거점(창고 미지정)으로
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
                    ${locOptions(rowLoc)}
                </select>
            </div>
            <div class="stock-badge text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">
                재고 확인중
            </div>
            <button type="button" class="btn-remove-row shrink-0 ml-auto px-2.5 min-h-9 inline-flex items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 text-[11px] font-black transition" title="원료 행 삭제">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i><span class="pointer-events-none">삭제</span>
            </button>
        `;

        attachSelectSearch(row.querySelector('.item-select'), candidateItems, { placeholder: '원료명 일부 검색', ring: 'focus:ring-blue-500' });
        const rateInput = row.querySelector('.item-rate');
        const qtyInput = row.querySelector('.item-qty');

        // 단위당 사용량 수정 시 -> 총 소요량 즉시 재계산
        rateInput?.addEventListener('input', () => {
            const pQty = consumeBaseQty();
            const rate = Number(rateInput.value) || 0;
            qtyInput.value = Math.round(pQty * rate * 1000) / 1000;
            recalculateAllMaterials();
        });

        // 총 소요량 직접 수정 시 -> 단위당 사용량 역산 (자릿수를 넉넉히 남겨야 다시 곱했을 때 입력한 총량이 그대로 나온다)
        qtyInput?.addEventListener('input', () => {
            const pQty = consumeBaseQty();
            const qty = Number(qtyInput.value) || 0;
            if (pQty > 0) {
                rateInput.value = Math.round((qty / pQty) * RATE_PRECISION) / RATE_PRECISION;
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
    const addSubRow = (defaultCode = '', defaultRate = 1, defaultLoc = SITE_LOC) => {
        const rowLoc = locInSite(defaultLoc); // 다른 거점의 창고가 넘어오면 이 거점(창고 미지정)으로
        const subItems = state.master.filter(m => m.category === '부자재');
        // 포장사용기준서에 부자재가 아닌 품목(기타·임시 등)이 있어도 목록에 넣어 값이 빠지지 않게
        const extra = defaultCode && !subItems.some(m => m.code === defaultCode) ? state.master.filter(m => m.code === defaultCode) : [];
        const candidateItems = subItems.length > 0 ? [...extra, ...subItems] : state.master;

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
                    ${locOptions(rowLoc)}
                </select>
            </div>
            <div class="stock-badge text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">
                재고 확인중
            </div>
            <button type="button" class="btn-remove-row shrink-0 ml-auto px-2.5 min-h-9 inline-flex items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 text-[11px] font-black transition" title="부자재 행 삭제">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i><span class="pointer-events-none">삭제</span>
            </button>
        `;

        attachSelectSearch(row.querySelector('.item-select'), candidateItems, { placeholder: '부자재명 일부 검색 (예: 드럼, 캡, 라벨)', ring: 'focus:ring-emerald-500' });
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
                rateInput.value = Math.round((qty / pQty) * RATE_PRECISION) / RATE_PRECISION;
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

    // 새 줄의 창고는 입고 창고가 있는 거점(창고 미지정 = 그 거점 전체 재고에서 차감)
    const materialSite = () => siteOf(container.querySelector('#prod-location')?.value) || SITE_LOC;
    container.querySelector('#btn-add-raw-row')?.addEventListener('click', () => addRawRow('', 1, materialSite()));
    container.querySelector('#btn-add-sub-row')?.addEventListener('click', () => addSubRow('', 1, materialSite()));

    // 라벨부착: 무라벨 용기·라벨을 개당 1개씩 투입 부자재 행으로 (원료 행은 비움)
    const fillLabelRows = () => {
        const bare = container.querySelector('#la-bare').value;
        const label = container.querySelector('#la-label').value;
        if (!bare && !label) { alert('무라벨 용기나 라벨을 고르세요.'); return; }
        const loc = materialSite();
        rawRowsList.innerHTML = '';
        subRowsList.innerHTML = '';
        if (chkBom && !chkBom.checked) { chkBom.checked = true; materialsWrapper.classList.remove('hidden'); }
        if (bare) addSubRow(bare, 1, loc);
        if (label) addSubRow(label, 1, loc);
        showToast('🏷️ 무라벨 용기·라벨을 투입 부자재로 채웠습니다 (라벨부착 용기 1개당 1개씩).');
    };
    container.querySelector('#la-fill')?.addEventListener('click', fillLabelRows);
    selectItemDropdown.addEventListener('change', () => { if (selectedProdType === '라벨부착') updateLabelPanel(); });

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

    // 검색 등록이 폼을 채울 때는 품목 선택으로 생기는 배합비 안내를 띄우지 않는다
    let quietFill = false;
    const noteUnlessQuiet = (msg) => { if (!quietFill) showToast(msg); };

    // 저장된 배합비 자동 로드 또는 스마트 기본 추천 배합비 생성
    const smartApplyRecipeForProduct = (itemCode) => {
        if (!itemCode) return;
        // 투입 줄의 창고 기본값: 이 거점 (창고 미지정 = 이 거점의 재고 전체에서 차감). 기준서에 이 거점의 창고가 적혀 있으면 그 창고
        // (기준서에 다른 거점의 창고가 적혀 있으면 addRawRow·addSubRow가 이 거점으로 바꾼다)
        const curLoc = materialSite();
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
            // 포장사용기준서(원액 작업지시서 → 포장사용기준서)의 자동 기본 양식이면 확인하라고 알린다
            noteUnlessQuiet(saved.meta?.template
                ? `⚠️ [${itemCode}] 포장사용기준서가 아직 '기본 양식(미확인)'입니다. 원액·부자재를 확인하고 처리하세요.`
                : `📋 [${itemCode}] 포장사용기준서(원액·부자재 사용량)를 불러왔습니다.`);
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
            noteUnlessQuiet(`✨ 원액 블렌딩 표준 배합비(기유 85% + 첨가제 15%)가 자동 적용되었습니다.`);
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
            noteUnlessQuiet(`✨ 완제품(${unitUsageL}L 규격)에 맞춘 원액 및 용기 단위소요량이 자동 산출되었습니다.`);
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

    // 포장사용기준서 검색 (코드·품명 일부) → 고른 기준서의 원액·부자재 사용량을 넣는다.
    // 생산 품목이 비어 있거나 다르면 그 품목을 고른다 (고르면 위 change에서 자동으로 불러옴).
    container.querySelector('#btn-pack-std-search')?.addEventListener('click', async () => {
        await loadBoms(true).catch(() => {});
        const boms = getBoms();
        const label = selectedProdType === '라벨부착';
        const pool = Object.keys(boms).map(code => standardOf(code, boms))
            .filter(s => (label ? s.item.category !== '완제품' && s.item.category !== '원액' && s.item.category !== '원료' : s.item.category === '완제품'));
        const box = document.createElement('div');
        box.className = 'fixed inset-0 z-[70] bg-slate-900/60 p-2 sm:p-4 flex items-start justify-center overflow-y-auto';
        box.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4 text-xs overflow-hidden">
            <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between"><h3 class="font-black text-sm">📦 포장사용기준서 검색 (${label ? '라벨부착' : '완제품'} ${pool.length.toLocaleString()}건)</h3><button type="button" class="ps-x text-slate-300 hover:text-white text-xl px-1">&times;</button></div>
            <div class="p-3 space-y-2">
                <input id="ps-q" type="search" placeholder="코드·품명 일부 (예: 5W30 4L, 2AA400)" class="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm font-bold" />
                <div id="ps-list" class="max-h-[60vh] overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl"></div>
                <p class="text-[11px] text-slate-500">기준서 수정은 <b>원액 작업지시서 → 포장사용기준서</b>에서 합니다 (마스터·작업일지 관리자).</p>
            </div></div>`;
        document.body.appendChild(box);
        const close = () => box.remove();
        box.querySelectorAll('.ps-x').forEach(b => b.addEventListener('click', close));
        const drawList = () => {
            const q = box.querySelector('#ps-q').value.trim().toLowerCase();
            const hits = (q ? pool.filter(s => `${s.code} ${s.item.name} ${s.item.spec || ''}`.toLowerCase().includes(q)) : pool).slice(0, 40);
            box.querySelector('#ps-list').innerHTML = hits.map(s => `<button type="button" class="ps-hit w-full text-left px-3 py-2 hover:bg-amber-50" data-code="${esc(s.code)}">
                <div class="flex items-center gap-2"><span class="font-mono font-bold text-blue-700">${esc(s.code)}</span><b class="truncate">${esc(s.item.name)}</b><span class="text-slate-400">${esc(s.item.spec || '')}</span>
                    ${s.meta.template ? '<span class="ml-auto px-1.5 py-0.5 rounded border text-[10px] font-bold bg-amber-50 text-amber-800 border-amber-200">기본 양식</span>' : '<span class="ml-auto px-1.5 py-0.5 rounded border text-[10px] font-bold bg-emerald-50 text-emerald-700 border-emerald-200">확인됨</span>'}</div>
                <div class="text-[11px] text-slate-500 truncate">${esc(standardSummary(s))}</div></button>`).join('') || '<div class="p-6 text-center text-slate-400">찾는 기준서가 없습니다.</div>';
            box.querySelectorAll('.ps-hit').forEach(b => b.addEventListener('click', () => {
                const s = standardOf(b.dataset.code);
                close();
                if (![...selectItemDropdown.options].some(o => o.value === s.code)) {
                    selectItemDropdown.insertAdjacentHTML('afterbegin', productOptionHtml(s.item));
                }
                if (selectItemDropdown.value !== s.code) { selectItemDropdown.value = s.code; selectItemDropdown.dispatchEvent(new Event('change')); }
                else smartApplyRecipeForProduct(s.code);
            }));
        };
        box.querySelector('#ps-q').addEventListener('input', drawList);
        drawList();
        setTimeout(() => box.querySelector('#ps-q').focus(), 50);
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

    // 작업지시서 → 생산 원액 코드·생산량(L)·재고 연결된 원료 투입량(총량)·연결 안 된 원료코드 (직접 등록·검색 등록 공용)
    // 재고 연결은 제조시방서의 현재 값을 우선한다 (발행 뒤에 시방서에서 연결한 원료도 차감되게, 생산 완료 처리와 같은 규칙)
    const workOrderPlan = (o) => {
        const recipeMats = orderRecipe(o)?.materials || [];
        const mats = (o.materials || []).map(m => ({ ...m, itemCode: recipeMats.find(x => x.seq === m.seq)?.itemCode || m.itemCode || '' }));
        const isLinked = (m) => m.itemCode && state.master.some(x => x.code === m.itemCode) && (Number(m.liters) > 0 || Number(m.kg) > 0);
        return {
            productCode: orderProductCode(o),
            liters: orderLiters(o),
            rows: mats.filter(isLinked).map(m => ({ code: m.itemCode, total: rawRowUnit(m.itemCode) === 'KG' ? Number(m.kg) || 0 : Number(m.liters) || 0, rawCode: m.rawCode || '' })),
            unlinked: mats.filter(m => !isLinked(m)).map(m => m.rawCode || `#${m.seq}`)
        };
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
        const plan = workOrderPlan(o);
        const liters = plan.liters;
        container.querySelector('#prod-qty').value = liters;
        const loc = materialSite(); // 원료는 입고 창고가 있는 거점의 재고에서 (창고 미지정 = 거점 전체)
        rawRowsList.innerHTML = '';
        subRowsList.innerHTML = '';
        plan.rows.forEach(r => addRawRow(r.code, liters > 0 ? Math.round((r.total / liters) * 1e6) / 1e6 : 0, loc, { rawCode: r.rawCode }));
        linkedUnlinkedCodes = plan.unlinked;
        container.querySelector('#prod-lot-no').value = o.lotNo || o.orderNo;
        if (o.mfgDate) container.querySelector('#prod-mfg-date').value = o.mfgDate;
        container.querySelector('#prod-notes').value = `원액생산 작업지시서 ${o.orderNo}`;
        chkBom.checked = true;
        materialsWrapper.classList.remove('hidden');
        linkedOrder = o;
        recalculateAllMaterials();
        renderWoPanel();
        showToast(`📋 작업지시서 ${o.orderNo}의 원료 ${plan.rows.length}종을 불러왔습니다. 확인 후 처리하세요.`);
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

        let list = siteProductions();
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
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400 font-bold">${esc(siteCfg.name)} 생산 입고 실적 내역이 없습니다.</td></tr>`;
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
                        <button type="button" class="btn-jump-label px-2.5 py-1 bg-slate-900 hover:bg-black text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition shadow-xs" data-id="${esc(item.id)}">
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
                const item = list.find(p => String(p.id) === btn.getAttribute('data-id'));
                if (!item) return;
                // 라벨 화면: 이 실적의 품목·LOT·제조일·수량(용기 용량)으로 드럼 라벨(3120) 한 장만 골라 연다
                window.__labelPrefill = {
                    code: item.itemCode, name: item.itemName, lot: item.lotNo, mfg: item.mfgDate || item.prodDate || '', exp: item.expDate || '',
                    qty: item.qty, unit: item.unit || '', packaging: item.packaging || ''
                };
                window.__labelInitialSubtab = '3120';
                showToast(`[${item.lotNo}] 라벨 인쇄 탭으로 이동합니다.`);
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
    // 원액 + IBC: IBC 개수(기본 = 생산량 ÷ 1,000L 올림)와 차감할 공토트 미리보기
    let ibcCountTouched = false;
    const refreshIbcBox = () => {
        const box = container.querySelector('#ibc-box');
        if (!box) return;
        const on = selectedProdType === '원액' && isIbcPack(container.querySelector('#prod-packaging')?.value);
        box.classList.toggle('hidden', !on);
        if (!on) return;
        const qty = Number(container.querySelector('#prod-qty')?.value) || 0;
        const cnt = container.querySelector('#prod-ibc-count');
        if (!ibcCountTouched) cnt.value = ibcCountOf(qty);
        const code = container.querySelector('#prod-item-code')?.value || '';
        const loc = container.querySelector('#prod-location')?.value || '';
        const name = state.master.find(m => m.code === code)?.name || '';
        if (!code) { container.querySelector('#ibc-plan').textContent = '원액을 고르면 차감할 공토트가 보입니다.'; return; }
        const plan = planToteUse(code, name, loc, Number(cnt.value) || 0);
        container.querySelector('#ibc-plan').innerHTML = `유종 <b>${esc(plan.type.label)}</b> · 차감: ${plan.rows.map(r => `<b>${esc(r.name)} ${r.qty}개</b>`).join(' + ') || '없음'}${plan.short ? ` · <span class="text-rose-600 font-bold">${plan.short}개 재고 부족</span>` : ''} · IBC가 비면 <b>${esc(plan.type.name)}</b>로 회수`;
    };
    container.querySelector('#prod-ibc-count')?.addEventListener('input', () => { ibcCountTouched = true; });
    ['input', 'change', 'click', 'focusout'].forEach(ev => form?.addEventListener(ev, () => setTimeout(refreshIbcBox, 0)));
    setTimeout(refreshIbcBox, 0);
    // 검색 등록이 폼을 제출할 때: 성공하면 submitHook(포장사용기준서 저장)을 부르고, 결과(성공 여부)를 submitDone으로 돌려준다
    let submitHook = null;
    let submitDone = null;
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const hook = submitHook;
        const done = submitDone;
        submitHook = null;
        submitDone = null;
        let ok = false;
        try { ok = await runSubmit(hook); } finally { done?.(!!ok); }
    });
    const runSubmit = async (afterSuccess) => {
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
        // 원액을 IBC에 담음: 유종 공토트(없으면 990001) 차감 줄을 투입 부자재에 더한다
        const ibcFill = selectedProdType === '원액' && isIbcPack(packaging) ? Math.max(0, Math.round(Number(container.querySelector('#prod-ibc-count')?.value) || 0)) : 0;
        if (ibcFill && container.querySelector('#prod-ibc-deduct')?.checked) {
            const itemNm = state.master.find(m => m.code === prodItemCode)?.name || '';
            const plan = planToteUse(prodItemCode, itemNm, location, ibcFill);
            if (plan.short && !confirm(`[${location}] 공토트 재고가 ${plan.short}개 모자랍니다 (${plan.type.name} · ${TOTE_NAME}).\n있는 만큼만 차감하고 진행할까요?`)) return;
            plan.rows.forEach(r => rawMaterials.push({ code: r.code, name: r.name, qty: r.qty, unit: 'EA', location, matType: '부자재', tote: true }));
        }
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
                    const logSite = siteCfg.key; // 이 메뉴의 거점 업무일지
                    const date = mfgDate || localDateStr();
                    const m = state.master.find(x => x.code === prodItemCode) || { code: prodItemCode, name: prodItemCode };
                    const h = Math.max(0, Number(container.querySelector('#la-hours').value) || 0);
                    const wc = Math.max(1, Number(container.querySelector('#la-wc').value) || 1);
                    const tot = Math.round(h * wc * 100) / 100;
                    const log = getGimpoLogByDate(date, logSite);
                    log.labeling = log.labeling || [];
                    log.labeling.push({
                        item: `${m.code} / ${m.name}`, spec: m.spec || '', qty: prodQty, box: Math.max(0, Number(container.querySelector('#la-box').value) || 0),
                        workHours: h, workersCount: wc, totalWorkHours: tot, line: container.querySelector('#la-line').value.trim(), lotNo,
                        category: m.subCategory || '라벨부착', manHours: Math.round((tot / 7.5) * 100) / 100,
                        workers: String(worker || '').replace(/\s*\(.*\)\s*$/, ''), source: 'prod-label', prodId: result?.production?.id || ''
                    });
                    saveGimpoLog(log, logSite);
                    logMsg = ` · ${siteCfg.name} 업무일지(${date}) 라벨부착작업에 기록`;
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
                        // 사업장 = 생산 위치, 공정 단계 = 원액 생산이면 원액생산, 그 밖(완제품·라벨부착 등)은 완제품포장
                        area: 'PROCESS', site: siteFromText(location), stage: selectedProdType === '원액' ? 'BLEND' : 'PACK',
                        date: mfgDate || localDateStr(), itemCode: m.code, itemName: m.name, lot: lotNo,
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

            // 업무일지 제품포장작업 · 초·중·종물 · 포장수율표(라벨부착은 라벨작업)에 같이
            if (container.querySelector('#prod-reflect')?.checked && ['완제품', '라벨부착', '원액'].includes(selectedProdType)) {
                const m = state.master.find(x => x.code === prodItemCode) || { code: prodItemCode, name: prodItemCode };
                const label = selectedProdType === '라벨부착';
                const blend = selectedProdType === '원액';
                const raw = rawMaterials.find(x => x.matType === '원료');
                const pack = blendPackOf(packaging); // 원액 포장용기 → 업무일지 원액생산작업 포장용기 칸
                const r = await reflectProduction({
                    kind: label ? 'LABEL' : blend ? 'BLEND' : 'PACK', site: siteCfg.key,
                    date: mfgDate || localDateStr(), itemCode: m.code, itemName: m.name, spec: m.spec || '', qty: prodQty, lot: lotNo, pack,
                    workers: worker, rawName: raw?.name || '', category: m.subCategory || m.category || (blend ? '원액' : '완제품'), prodId: result?.production?.id || ''
                }, { worklog: !label }).catch(e => [`연동 실패: ${e.message}`]);
                if (r.length) showToast(`🔗 ${r.join(' · ')}에 반영했습니다.`);
            }

            // IBC 대장: 원액을 IBC에 담았으면 등록, 투입한 원액은 먼저 채운 IBC부터 차감 → 비면 유종 공토트 회수
            try {
                const itemNm = state.master.find(x => x.code === prodItemCode)?.name || prodItemCode;
                const msgs = [];
                if (ibcFill) {
                    const tanks = await registerFill({ blendCode: prodItemCode, blendName: itemNm, lot: lotNo, location, liters: prodQty, count: ibcFill, source: '제품생산/입고', at: mfgDate });
                    const used = rawMaterials.filter(m => m.tote).map(m => `${m.name} ${m.qty}`).join(', ');
                    msgs.push(`🛢️ IBC ${tanks.length}개 대장 등록 (${oilTypeOf(prodItemCode, itemNm).label})${used ? ` · 공토트 차감: ${used}` : ''}`);
                }
                for (const b of rawMaterials.filter(m => !m.tote && state.master.find(x => x.code === m.code)?.category === '원액')) {
                    const r = await consumeBlend({ blendCode: b.code, location: b.location || location, qty: b.qty, reason: `${itemNm} 생산 LOT ${lotNo}` });
                    if (r.emptied.length) msgs.push(`♻️ ${b.name} IBC ${r.emptied.length}개 비움 → ${[...new Set(r.emptied.map(t => oilTypeByTote(t.toteCode)?.name || t.toteCode))].join(', ')} 회수`);
                    if (r.errors.length) alert(r.errors.join('\n'));
                }
                msgs.forEach(m => showToast(m));
            } catch (e) {
                alert(`생산 입고는 처리되었지만 IBC(공토트) 대장에 반영하지 못했습니다. 품목 및 재고관리 → IBC(공토트) 관리에서 확인하세요.\n(${e.message})`);
            }

            const rawCount = result?.rawLedgerEntries?.length || 0;
            if (logMsg) showToast(`🏷️ 라벨부착 ${prodQty.toLocaleString()} EA 처리${logMsg}`);
            showToast(`🎉 [${lotNo}] ${selectedProdType} ${prodQty}개 생산입고 및 원부자재 ${rawMaterials.length}종 자동 차감이 완료되었습니다!${rawCount ? ` (원료수불부 ${rawCount}건 자동 기입)` : ''}`);
            if (afterSuccess) await afterSuccess();
            renderProductionManager(container, { showToast, onSwitchTab, site: siteCfg.key });
            return true;
        } catch (err) {
            alert(`생산 입고 실패:\n${err.message}`);
            const btnSubmit = container.querySelector('#btn-submit-production');
            const btnText = container.querySelector('#btn-submit-text');
            btnSubmit.disabled = false;
            btnText.innerHTML = `<span>생산 입고 및 원부자재 자동 차감 처리</span>`;
            return false;
        }
    };

    // ==========================================
    // 검색 등록 탭: 단계별로 고른 제품·원액·부자재를 위 직접 등록 폼에 옮겨 같은 처리를 탄다
    // ==========================================
    // 불량 발생 칸 채우기 (null이면 끔) — 원부자재 행보다 먼저 채워야 사용량 기준(양품 + 불량)이 맞는다
    const fillDefect = (d) => {
        const on = container.querySelector('#defect-on');
        on.checked = !!d;
        container.querySelector('#defect-body').classList.toggle('hidden', !d);
        defectInputs().forEach(el => { el.value = d?.qty?.[el.dataset.type] ?? ''; });
        if (!d) return;
        container.querySelector('#defect-process').value = d.process || '';
        container.querySelector('#defect-handling').value = d.handling || '폐기';
        container.querySelector('#defect-result').value = d.result || 'PASS';
        container.querySelector('#defect-inspector').value = d.inspector || '';
        container.querySelector('#defect-cause').value = d.cause || '';
        container.querySelector('#defect-action').value = d.action || '';
        container.querySelector('#defect-consume').checked = d.consume !== false;
    };
    const fillFormFromSearch = ({ item, prodType, qty, lot, location, mfgDate, raws, subs, workOrder = null, unlinked = [], defect = null }) => {
        quietFill = true;
        try {
            if (selectedProdType !== prodType) container.querySelector(`.btn-prod-type-select[data-type="${prodType}"]`)?.click();
            linkedOrder = null;
            linkedUnlinkedCodes = [];
            container.querySelector('#prod-location').value = location;
            if (![...selectItemDropdown.options].some(o => o.value === item.code)) selectItemDropdown.insertAdjacentHTML('afterbegin', productOptionHtml(item));
            selectItemDropdown.value = item.code;
            container.querySelector('#prod-qty').value = qty;
            container.querySelector('#prod-lot-no').value = lot;
            container.querySelector('#prod-mfg-date').value = mfgDate;
            fillDefect(defect);
            chkBom.checked = true;
            materialsWrapper.classList.remove('hidden');
            rawRowsList.innerHTML = '';
            subRowsList.innerHTML = '';
            // 사용량은 입력한 총량 그대로 (단위당은 총량 ÷ 생산 수량)
            const setTotal = (list, total) => { const q = list.lastElementChild?.querySelector('.item-qty'); if (q) q.value = total; };
            raws.forEach(r => { addRawRow(r.code, r.rate, r.loc, { rawCode: r.rawCode || '' }); setTotal(rawRowsList, r.total); });
            subs.forEach(s => { addSubRow(s.code, s.rate, s.loc); setTotal(subRowsList, s.total); });
            // 작업지시서를 불러왔으면 연결해 두어 처리 뒤 '생산 완료'로 바뀌게 (기록에는 원료 실명 대신 원료코드)
            if (workOrder && prodType === '원액') {
                linkedOrder = workOrder;
                linkedUnlinkedCodes = unlinked;
                container.querySelector('#prod-notes').value = `원액생산 작업지시서 ${workOrder.orderNo}`;
            }
            refreshIbcBox();
        } finally {
            quietFill = false;
        }
    };
    let searchReg = null;
    const mountSearch = () => {
        if (searchReg) return;
        searchReg = mountSearchRegister(container.querySelector('#prod-panel-search'), {
            showToast,
            defaultLocation: container.querySelector('#prod-location').value || SITE_LOC,
            locationOptions: locOptions, // 이 거점의 창고만
            siteName: siteCfg.name,
            fillForm: fillFormFromSearch,
            // 불량 유형 = 품질관리 공정관리 설정 (직접 등록 불량 칸이 불러온 목록), 공정 목록
            defectTypes: () => defectInputs().map(el => el.dataset.type),
            defectProcesses: () => QC_AREAS.PROCESS.processes,
            // 원액생산 작업지시서 (특별보안: 마스터·작업일지 관리자만)
            workOrders: hasWorklogAccess() ? {
                load: async () => { if (!woLoaded) { await loadSecureData(); woLoaded = true; } },
                open: () => secure.orders.filter(o => OPEN_STATUS.includes(o.status)),
                productCode: orderProductCode,
                liters: orderLiters,
                plan: workOrderPlan,
                isOpen: (o) => OPEN_STATUS.includes((secure.orders.find(x => x.id === o.id) || o).status)
            } : null,
            submitForm: (afterSuccess) => new Promise(resolve => {
                submitHook = afterSuccess;
                submitDone = resolve;
                // 폼이 숨어 있어 브라우저 입력 검사 말풍선이 안 보이므로 검사는 검색 등록 쪽에서 하고 바로 제출 이벤트를 보낸다
                form.dispatchEvent(new Event('submit', { cancelable: true }));
            })
        });
    };
    container.querySelectorAll('.btn-reg-mode').forEach(btn => btn.addEventListener('click', () => {
        regMode = btn.dataset.mode;
        try { localStorage.setItem(REG_MODE_KEY, regMode); } catch { /* 저장 불가 */ }
        container.querySelectorAll('.btn-reg-mode').forEach(b => {
            const on = b.dataset.mode === regMode;
            REG_TAB_ON.forEach(c => b.classList.toggle(c, on));
            REG_TAB_OFF.forEach(c => b.classList.toggle(c, !on));
        });
        container.querySelector('#prod-panel-search').classList.toggle('hidden', regMode !== 'search');
        container.querySelector('#prod-panel-form').classList.toggle('hidden', regMode === 'search');
        if (regMode === 'search') mountSearch(); else searchReg?.stop();
    }));
    if (regMode === 'search') mountSearch();

    // CSV 내보내기 이벤트
    container.querySelector('#btn-export-prod-csv')?.addEventListener('click', () => {
        const list = siteProductions();
        if (list.length === 0) {
            alert(`내보낼 ${siteCfg.name} 생산 실적 데이터가 없습니다.`);
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
        link.setAttribute('download', `대림오일_생산실적대장_${siteCfg.name}_${todayStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('📁 생산 실적 CSV 파일이 다운로드되었습니다.');
    });

    // 초기 테이블 렌더링
    renderTable();

    // QR코드 저장소의 '생산입고' QR·선택으로 왔으면 그 품목을 골라 둔다 (window.__prodPrefill = { code })
    const pre = window.__prodPrefill;
    window.__prodPrefill = null;
    if (pre?.code) {
        const m = state.master.find(x => x.code === pre.code);
        if (!m) { showToast(`품목코드 ${pre.code}를 품목마스터에서 찾지 못했습니다.`, 'warning'); return; }
        const type = m.category === '원액' ? '원액' : m.category === '반제품' ? '반제품' : '완제품';
        container.querySelector(`.btn-prod-type-select[data-type="${type}"]`)?.click();
        const sel = container.querySelector('#prod-item-code');
        if (sel && ![...sel.options].some(o => o.value === m.code)) sel.insertAdjacentHTML('afterbegin', `<option value="${esc(m.code)}">[${esc(m.code)}] ${esc(m.name)} (${esc(m.spec || '-')})</option>`);
        if (sel) { sel.value = m.code; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        container.querySelector('#prod-qty')?.focus();
        showToast(`🏭 [${m.code}] ${m.name} 생산입고를 준비했습니다. 수량·LOT을 확인하고 등록하세요.`);
    }
};
