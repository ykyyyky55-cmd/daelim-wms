import { clearApprovalCache } from './services/approvals.js';
import { loadAllData, state, applyRealtimeInventoryChange, onCloudSyncError, clearCloudDataCache, syncOfflineWork, pendingWorklogCount } from './services/db.js';
import { checkCloudReachable, isKnownOffline, pendingOfflineCount } from './services/offlineQueue.js';
import { initRealtimeSubscription, registerRealtimeListener } from './services/realtime.js';
import { initAuth, logout, canAccessTab, isViewOnlyTab, tabWriteRole, onAuthChange, updatePassword, confirmOfflineSession, TAB_PERMISSIONS, setCurrentWorker, needsWorkerChoice, isSharedAccount } from './services/auth.js';
import { openWorkerPicker, closeWorkerPicker } from './components/WorkerPicker.js';
import { createIcons, icons } from './services/icons.js';

import { renderLoginView, renderPendingView } from './components/LoginView.js';
import { renderHeader } from './components/Header.js';
import { renderSidebar } from './components/Sidebar.js';
import { hubGroupOf } from './components/navMenu.js';
import { clearSecureData } from './services/secureWorkOrders.js';
import { renderModals, openModalByName } from './components/Modals.js';
import { closeOverlay, closeTopOverlay, hasSelfManagedOverlay, isOverlayOpen, topOverlay } from './services/overlays.js';
import { isBoardFullscreen, setBoardFullscreen } from './services/fullscreen.js';
import { closeColumnFilterPopover } from './components/ColumnFilter.js';
import { mountFloatingTools, unmountFloatingTools } from './components/FloatingTools.js';
import { injectDarkThemeCss } from './services/darkTheme.js';
import { handleInstallClick, isStandalone } from './services/pwaInstall.js';
import { loadMyMenuPermissions } from './services/menuPermissions.js';
import { startUpdateCheck } from './services/appVersion.js';

// 다른 기기의 재고 변경을 로컬 상태에 반영 (알림 토스트 및 화면 재렌더링보다 먼저 호출됨)
registerRealtimeListener((event) => {
    if (event.table === 'wms_inventory') applyRealtimeInventoryChange(event);
});

// 클라우드 저장 실패 경고 (로컬에는 저장되었지만 다른 기기·클라우드에는 반영되지 않음)
// 한 작업에서 여러 건이 연달아 실패할 수 있으므로 5초에 한 번만 표시
let lastSyncErrorToastAt = 0;
onCloudSyncError((context) => {
    const now = Date.now();
    if (now - lastSyncErrorToastAt < 5000) return;
    lastSyncErrorToastAt = now;
    if (isKnownOffline()) {
        // 입출고·생산입고·실사·수불부·업무일지는 자동으로 다시 올라가지만, 그 밖의 저장은 연결 후 다시 해야 한다
        showToast(`📴 인터넷 연결 없음: '${context}'은(는) 이 기기에만 저장되었습니다. 이 항목은 자동으로 올라가지 않으니 연결된 뒤 다시 저장하세요.`);
        return;
    }
    showToast(`⚠️ 클라우드 저장 실패: ${context} — 이 기기에만 저장되었습니다. 네트워크를 확인한 뒤 다시 시도하세요.`);
});

// ==========================================
// 오프라인 작업 반영: 인터넷이 다시 연결되면 이 기기에 저장한 작업을 클라우드에 올린다
// ==========================================
// 입력 중인 화면이 지워지지 않도록 반영 뒤에 화면을 다시 그리지 않는다 (다른 기기의 재고 변경은 실시간 구독이 반영).
const OFFLINE_RETRY_MS = 60000;
let isSyncingOffline = false;
const pendingOfflineWork = () => pendingOfflineCount() + pendingWorklogCount();

/** @param {{ isManual?: boolean }} [options] isManual: 사용자가 [지금 반영]을 누른 경우 (결과를 항상 알림) */
const runOfflineSync = async ({ isManual = false } = {}) => {
    if (isSyncingOffline || !state.currentUser) return;
    if (!isManual && pendingOfflineWork() === 0 && !state.offlineSession) return;
    isSyncingOffline = true;
    try {
        if (!(await checkCloudReachable())) {
            if (isManual) showToast('📴 아직 인터넷에 연결되지 않았습니다. 연결되면 자동으로 반영합니다.');
            return;
        }
        if (!(await confirmOfflineSession())) {
            showToast('🔒 로그인이 만료되었습니다. 다시 로그인하면 이 기기에 저장된 작업을 반영합니다.');
            await logout();
            initApp();
            return;
        }
        const result = await syncOfflineWork();
        if (result.offline) return;
        if (result.applied > 0) showToast(`✅ 인터넷 연결됨: 오프라인 작업 ${result.applied}건을 클라우드에 반영했습니다.`);
        if (result.failed > 0) showToast(`⚠️ 오프라인 작업 ${result.failed}건을 반영하지 못했습니다. 머리글의 [반영 대기]를 눌러 확인하세요.`);
        else if (isManual && result.applied === 0) showToast(pendingOfflineWork() === 0 ? '✅ 반영할 작업이 없습니다. 모두 클라우드에 올라가 있습니다.' : '⏳ 일부 작업이 아직 올라가지 않았습니다. 잠시 뒤 다시 시도합니다.');
    } catch (e) {
        console.error('[오프라인] 반영 중 오류:', e);
        if (isManual) showToast(`⚠️ 오프라인 작업 반영 중 오류: ${e.message || e}`);
    } finally {
        isSyncingOffline = false;
    }
};
window.__syncOfflineWork = () => runOfflineSync({ isManual: true });
window.addEventListener('online', () => setTimeout(() => runOfflineSync(), 1500)); // 연결 직후 잠시 기다렸다가
window.addEventListener('offline', () => showToast('📴 인터넷 연결이 끊겼습니다. 입출고·생산입고·실사·업무일지는 이 기기에 저장했다가 연결되면 자동으로 반영합니다.'));
setInterval(() => runOfflineSync(), OFFLINE_RETRY_MS); // 와이파이는 잡혀 있는데 인터넷만 안 되던 경우 대비

let activeTab = 'home';
window.__activeTab = activeTab;

// ==========================================
// 방문 기록 (뒤로가기)
// ==========================================
// 화면을 옮길 때마다 브라우저 방문 기록 칸에 { tab, idx } 표시를 남기고, 뒤로가기는 모두 그 방문 기록을 따라간다.
// 그래서 머리글 ← · 브라우저 뒤로 · 안드로이드 뒤로 제스처 · Alt+← · Backspace · 마우스 뒤로 단추가 같은 화면으로 가고,
// 새로 고친 뒤에도 지나온 화면이 남는다 (예전에는 머리글 ←가 메모리의 목록을 따로 써서 둘이 어긋났다).
// idx = 이 창에서 몇 번째 칸인지: 0 = 앱의 첫 화면보다 앞에 비워 둔 칸(문지기 — initNavHistory), 1 = 앱의 첫 화면.
// 창(모달·대화창)은 방문 기록에 표시를 넣지 않는다: 뒤로가기 때 맨 위 창을 닫고(services/overlays.js) 방문 기록을 제자리로 되돌린다.
// 예외는 자기 표시({ ...칸 표시, modal })를 넣고 스스로 닫는 편집기 창 둘(혼합물 MSDS 작성 · 창고 평면도) — 그 표시는 그 화면의 칸과 idx가 같다.
let navIdx = 1;             // 지금 서 있는 칸
let isNavRestoring = false; // 창만 닫고 제자리로 돌아가는 이동 중 — 그때 오는 popstate는 화면을 바꾸지 않는다
const EXIT_WINDOW_MS = 2500; // 첫 화면에서 뒤로가기를 누른 뒤, 한 번 더 누르면 앱이 닫히는 시간
const setNavState = (tab, idx, { push = false, url = `#${tab}` } = {}) => {
    const mark = idx === 0 ? { tab, idx, guard: true } : { tab, idx };
    try {
        if (push) window.history.pushState(mark, '', url);
        else window.history.replaceState(mark, '', url);
    } catch (e) { console.warn('[방문 기록] 표시하지 못했습니다', e); }
    navIdx = idx;
};
/**
 * 앱 화면을 처음 그릴 때(새로 고침 · 다시 로그인 포함) 지금 방문 기록 칸에 표시를 남긴다.
 * 이 창에서 처음 열었으면(표시가 없으면) 첫 화면 앞에 칸을 하나 둔다(문지기): 첫 화면에서 창·메뉴 서랍을 연 채 뒤로가기를 눌러도
 * 앱을 벗어나지 않고 그 창만 닫을 수 있다. 열린 것이 없으면 popstate가 그 칸을 지나 앱 밖으로 나간다.
 * @param {string} url 주소에 남길 #탭
 */
const initNavHistory = (url) => {
    const mark = window.history.state;
    if (!Number.isInteger(mark?.idx)) {
        setNavState(activeTab, 0, { url });
        setNavState(activeTab, 1, { url, push: true });
        return;
    }
    setNavState(activeTab, mark.idx, { url });
    // 편집기 창을 연 채 새로 고쳤으면 그 창의 표시 칸 위에 서 있다 → 그 아래(같은 화면의 칸)로 내려선다
    if (mark.modal) {
        isNavRestoring = true;
        window.history.back();
    } else if (mark.guard) {
        // 문지기 칸에서 열렸다(앱 밖으로 나갔다가 앞으로 가기로 돌아옴) → 그 위의 첫 화면 칸으로 올라선다
        window.history.forward();
    }
};

/**
 * 방문 기록을 지금 화면의 칸(navIdx)으로 되돌린다 (뒤로가기가 창만 닫았거나, 저장 확인을 취소해 화면에 머물 때).
 * 칸을 새로 쌓지(pushState) 않고 되돌아간다 — 사용자 동작 없이 쌓은 칸은 브라우저 뒤로 단추가 건너뛰어(Chrome) 화면을 두 칸 넘는다.
 */
const restoreNavPosition = (arrivedIdx) => {
    const delta = navIdx - arrivedIdx;
    if (!delta) return;
    isNavRestoring = true;
    try { window.history.go(delta); } catch (e) { isNavRestoring = false; console.warn('[방문 기록] 제자리로 되돌리지 못했습니다', e); }
};

// 배경화면 / 테마 모드 관리
const THEMES = ['light', 'dark', 'warm'];
injectDarkThemeCss();
export const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('daelim_theme', theme);
};

export const toggleTheme = () => {
    const current = localStorage.getItem('daelim_theme') || 'light';
    const nextIndex = (THEMES.indexOf(current) + 1) % THEMES.length;
    const nextTheme = THEMES[nextIndex];
    applyTheme(nextTheme);
    renderNavigationSections();
    const themeLabels = { light: '라이트 모드', dark: '다크 모드 (야간/고대비)', warm: '눈 편한 모드 (아이케어 웜톤)' };
    showToast(`🎨 화면 모드가 '${themeLabels[nextTheme]}'(으)로 변경되었습니다.`);
};

// 앱 설치(PWA): 설치 창 이벤트는 services/pwaInstall.js가 첫 화면 전에 잡아 둔다.
// 머리글 [앱 설치]·대시보드·환경설정의 설치 버튼이 모두 이 함수를 부른다.
window.__triggerPwaInstall = () => handleInstallClick(showToast);

// 새 버전이 배포되면 아래쪽에 [새로고침] 안내 (services/appVersion.js)
startUpdateCheck();

// 토스트 알림 헬퍼
export const showToast = (message) => {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        // 오른쪽 아래의 떠 있는 단추(#ft-dock) 왼쪽에 띄운다. 스마트폰은 그 단추 위에 화면 폭으로
        container.className = 'fixed bottom-5 right-[76px] max-sm:right-4 max-sm:left-4 max-sm:bottom-[76px] z-50 flex flex-col items-end gap-2 max-w-sm max-sm:max-w-none pointer-events-none no-print';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg text-xs font-bold transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto flex items-center gap-2';
    const text = document.createElement('span');
    text.textContent = message; // 품목명 등 사용자 입력이 섞이므로 HTML로 해석하지 않는다
    toast.appendChild(text);
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-2', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};

// 화면(탭) 코드는 처음 열 때 받는다 (첫 화면에 모든 화면·엑셀 라이브러리를 받지 않도록 번들 분할)
const TAB_MODULES = {
    home: () => import('./components/Dashboard.js'),
    productionHq: () => import('./components/ProductionManager.js'), // 제품생산/입고(본사)
    production: () => import('./components/ProductionManager.js'), // 제품생산/입고(김포) — 예전 탭 이름 그대로 (services/prodSites.js)
    scan: () => import('./components/Scanner.js'),
    hqLog: () => import('./components/ProductionLog.js'),
    gimpoLog: () => import('./components/ProductionLog.js'),
    prodSchedule: () => import('./components/ProdScheduleTable.js'),
    oilcalc: () => import('./components/OilCalculator.js'),
    calc: () => import('./components/ToolCalculators.js'),
    unitConv: () => import('./components/ToolCalculators.js'),
    fxCalc: () => import('./components/ToolCalculators.js'),
    docTools: () => import('./components/DocTools.js'),
    viscCalc: () => import('./components/ViscosityCalculator.js'),
    lubCalc: () => import('./components/LubricantCalculator.js'),
    label: () => import('./components/LabelPrinter.js'),
    docScan: () => import('./components/DocScanner.js'),
    labelDesigner: () => import('./components/LabelDesigner.js'),
    fieldQr: () => import('./components/FieldQrLabels.js'),
    qrStore: () => import('./components/QrStore.js'),
    master: () => import('./components/MasterManager.js'),
    inventory: () => import('./components/InventoryManager.js'),
    rawLedger: () => import('./components/RawMaterialLedger.js'),
    audit: () => import('./components/AuditManager.js'),
    ledger: () => import('./components/ItemLedger.js'),
    productLedger: () => import('./components/ItemLedger.js'),
    ledgerViewer: () => import('./components/LedgerViewer.js'),
    secureWorkOrders: () => import('./components/SecureWorkOrders.js'),
    calendar: () => import('./components/CalendarView.js'),
    analytics: () => import('./components/Analytics.js'),
    reports: () => import('./components/Reports.js'),
    qualityMeeting: () => import('./components/QualityMeeting.js'),
    planning: () => import('./components/Planning.js'),
    history: () => import('./components/HistoryManager.js'),
    settings: () => import('./components/SettingsManager.js'),
    manual: () => import('./components/UserManual.js'),
    notice: () => import('./components/NoticeBoard.js'),
    library: () => import('./components/Library.js'),
    qcProduct: () => import('./components/QualityPages.js'),
    qcProcess: () => import('./components/QualityPages.js'),
    qcMaterial: () => import('./components/QualityPages.js'),
    qcEquipment: () => import('./components/QualityPages.js'),
    qcMsds: () => import('./components/QualityPages.js'),
    qcBoard: () => import('./components/QualityPages.js'),
    overview: () => import('./components/OverviewBoard.js'),
    stockCheck: () => import('./components/StockCheck.js'),
    lotTrace: () => import('./components/LotTrace.js'),
    partnerBoard: () => import('./components/PartnerBoard.js'),
    feedback: () => import('./components/FeedbackBoard.js'),
    erpMap: () => import('./components/ErpMap.js'),
    warehouse3d: () => import('./components/Warehouse3D.js'),
    usageBoard: () => import('./components/UsageBoard.js'),
    qcMonthly: () => import('./components/QualityPages.js'),
    inspectLog: () => import('./components/WorkForms.js'),
    yieldLog: () => import('./components/WorkForms.js'),
    eApproval: () => import('./components/EApproval.js'),
    fileStore: () => import('./components/FileStore.js'),
    packStandard: () => import('./components/PackStandard.js'),
    lineCount: () => import('./components/LineCounter.js'),
    prodPlan: () => import('./components/ProductionPlan.js'),
    purchPlan: () => import('./components/PurchasePlan.js'),
    prodRequest: () => import('./components/OrderCenter.js'),
    orderBoard: () => import('./components/OrderCenter.js'),
    shipRequest: () => import('./components/OrderCenter.js'),
    purchRequest: () => import('./components/ProductionRequest.js'),
    workPlan: () => import('./components/WorkPlan.js'),
    slipIssue: () => import('./components/SlipIssuePage.js'),
    slipManage: () => import('./components/SlipManager.js'),
    ibcTotes: () => import('./components/IbcTotes.js')
};
const loadedTabModules = {}; // 탭 id → 받은 모듈 (다시 열 때는 기다리지 않고 바로 그림)
let renderSeq = 0;
// 묶음 화면('hub-<묶음 id>': 주메뉴마다 안의 메뉴를 모아 보여 주는 화면)은 묶음 수만큼 있어 TAB_MODULES에 하나씩 적지 않는다
const loadMenuHub = () => import('./components/MenuHub.js');

const loadTabModule = (tab) => {
    const loader = TAB_MODULES[tab] || (hubGroupOf(tab) ? loadMenuHub : null);
    if (!loader) return Promise.resolve(null);
    return loader().then(mod => (loadedTabModules[tab] = mod));
};

// 첫 화면을 그린 뒤 자주 쓰는 화면 코드를 미리 받아 둔다 (메뉴를 눌렀을 때 기다림 없애기)
const prefetchTabModules = () => {
    // 현장 작업 화면(스캔·실사·QR·라인 집계·작업 양식)도 받아 두어 인터넷이 없는 곳에서 처음 열어도 열리게 한다
    const run = () => ['inventory', 'production', 'productionHq', 'scan', 'rawLedger', 'hqLog', 'gimpoLog', 'calendar', 'master',
        'audit', 'qrStore', 'lineCount', 'inspectLog', 'history', 'ledger']
        .forEach(t => { if (!loadedTabModules[t]) loadTabModule(t).catch(() => {}); });
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 5000 });
    else setTimeout(run, 2000);
};

// 조회만 할 수 있는 화면의 안내 띠: 그 화면에서 저장하려면 더 높은 역할이 필요한데 열 수는 있는 경우
// (경영자, 또는 환경설정의 메뉴 권한 설정으로 열어 준 역할). 저장은 DB(RLS)가 막으므로 미리 알려 준다.
// 화면이 본문을 통째로 다시 그려도 남도록, 본문의 자식이 바뀔 때마다 맨 앞에 다시 둔다.
const VIEW_ONLY_ID = 'view-only-banner';
const watchedMains = new WeakSet();
const ensureViewOnlyBanner = () => {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;
    const existing = mainContent.querySelector(`:scope > #${VIEW_ONLY_ID}`);
    if (!isViewOnlyTab(activeTab, state.currentUser?.role)) { existing?.remove(); return; }
    const need = tabWriteRole(activeTab) === 'MANAGER' ? '관리자(자재·품질·구매·생산)' : '현장 작업자';
    const text = `이 화면은 조회만 할 수 있습니다. 입력·저장은 ${need} 이상의 역할이 있어야 반영됩니다.`;
    if (existing && existing === mainContent.firstElementChild && existing.dataset.text === text) return;
    existing?.remove();
    const bar = document.createElement('div');
    bar.id = VIEW_ONLY_ID;
    bar.dataset.text = text;
    bar.className = 'mb-3 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs font-bold no-print';
    bar.textContent = `🔒 ${text}`;
    mainContent.prepend(bar);
};
const watchViewOnlyBanner = (mainContent) => {
    if (watchedMains.has(mainContent)) return;
    watchedMains.add(mainContent);
    new MutationObserver(ensureViewOnlyBanner).observe(mainContent, { childList: true });
};

// 메인 탭 렌더링
const renderActiveTab = () => {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;
    watchViewOnlyBanner(mainContent);
    closeColumnFilterPopover(); // 탭 전환 시 열린 열 필터 창 닫기

    // 권한 검사 (현재 탭 접근 불가 시 홈으로 자동 리다이렉트)
    const userRole = state.currentUser?.role || 'VIEWER';
    if (!canAccessTab(activeTab, userRole)) {
        activeTab = 'home';
    }

    const tab = activeTab;
    const seq = ++renderSeq;
    const mod = loadedTabModules[tab];
    if (mod) {
        renderTabContent(mainContent, tab, mod);
        return;
    }
    mainContent.innerHTML = `
        <div class="flex items-center justify-center py-24 text-slate-400 text-sm font-bold gap-2">
            <span class="inline-block w-5 h-5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin"></span>
            화면을 불러오는 중...
        </div>`;
    loadTabModule(tab).then(m => {
        // 받는 동안 다른 탭으로 옮겼으면 그리지 않는다
        if (seq !== renderSeq || tab !== activeTab || !m) return;
        renderTabContent(mainContent, tab, m);
    }).catch(err => {
        console.error('[화면 로드 실패]', tab, err);
        if (seq !== renderSeq) return;
        mainContent.innerHTML = `
            <div class="py-24 text-center text-sm font-bold text-slate-500">
                화면을 불러오지 못했습니다. 네트워크를 확인한 뒤
                <button type="button" class="text-blue-600 underline" onclick="location.reload()">새로고침</button> 해 주세요.
            </div>`;
    });
};

const renderTabContent = (mainContent, activeTab, m) => {
    const { renderDashboard, renderProductionManager, renderScanner, renderProductionLog, renderProdScheduleTab,
        renderOilCalculator, renderCalculator, renderUnitConverter, renderFxCalculator, renderDocTools,
        renderLubricantCalculator, renderLabelPrinter, renderDocScanner, renderLabelDesigner, renderMasterManager,
        renderInventoryManager, renderRawMaterialLedger, renderAuditManager, renderItemLedger, renderLedgerViewer,
        renderSecureWorkOrders, renderCalendar, renderAnalytics, renderPlanning, renderHistoryManager,
        renderSettingsManager } = m;

    const hubGroup = hubGroupOf(activeTab);
    if (hubGroup) {
        // 묶음 화면: 주메뉴 안의 메뉴를 카드로 (components/MenuHub.js)
        m.renderMenuHub(mainContent, { group: hubGroup, onSwitchTab: switchTab, showToast });
    } else if (activeTab === 'home') {
        renderDashboard(mainContent, { onSwitchTab: switchTab, onOpenModal: openModalByName, showToast });
    } else if (activeTab === 'productionHq') {
        renderProductionManager(mainContent, { showToast, onSwitchTab: switchTab, site: 'HQ' });
    } else if (activeTab === 'production') {
        renderProductionManager(mainContent, { showToast, onSwitchTab: switchTab, site: 'GIMPO' });
    } else if (activeTab === 'scan') {
        const initialScanCode = window.__pendingScanCode || null;
        const initialScanLot = window.__pendingScanLot || null;
        window.__pendingScanCode = null;
        window.__pendingScanLot = null;
        renderScanner(mainContent, { showToast, onSwitchTab: switchTab, initialCode: initialScanCode, initialLot: initialScanLot });
    } else if (activeTab === 'hqLog') {
        renderProductionLog(mainContent, { showToast, onSwitchTab: switchTab, site: 'HQ' });
    } else if (activeTab === 'gimpoLog') {
        renderProductionLog(mainContent, { showToast, onSwitchTab: switchTab, site: 'GIMPO' });
    } else if (activeTab === 'prodSchedule') {
        renderProdScheduleTab(mainContent, { showToast });
    } else if (activeTab === 'oilcalc') {
        renderOilCalculator(mainContent, { showToast });
    } else if (activeTab === 'calc') {
        renderCalculator(mainContent, { showToast });
    } else if (activeTab === 'unitConv') {
        renderUnitConverter(mainContent, { showToast });
    } else if (activeTab === 'fxCalc') {
        renderFxCalculator(mainContent, { showToast });
    } else if (activeTab === 'docTools') {
        renderDocTools(mainContent, { showToast });
    } else if (activeTab === 'viscCalc') {
        m.renderViscosityCalculator(mainContent, { showToast });
    } else if (activeTab === 'lubCalc') {
        renderLubricantCalculator(mainContent, { showToast });
    } else if (activeTab === 'label') {
        const initialSubtab = window.__labelInitialSubtab || null;
        window.__labelInitialSubtab = null;
        renderLabelPrinter(mainContent, { initialSubtab });
    } else if (activeTab === 'docScan') {
        renderDocScanner(mainContent, { showToast });
    } else if (activeTab === 'prodPlan') {
        m.renderProductionPlan(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'purchPlan') {
        m.renderPurchasePlan(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'prodRequest') {
        m.renderOrderProdRequest(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'orderBoard') {
        m.renderOrderBoard(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'shipRequest') {
        m.renderShipRequest(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'purchRequest') {
        m.renderPurchaseRequest(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'workPlan') {
        m.renderWorkPlan(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'slipIssue') {
        m.renderSlipIssuePage(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'ibcTotes') {
        m.renderIbcTotes(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'slipManage') {
        m.renderSlipManager(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'eApproval') {
        m.renderEApproval(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'packStandard') {
        m.renderPackStandard(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'lineCount') {
        m.renderLineCounter(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'fileStore') {
        m.renderFileStore(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'notice') {
        m.renderNoticeBoard(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'library') {
        m.renderLibrary(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'qcProduct') {
        m.renderQcProduct(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'qcProcess') {
        m.renderQcProcess(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'qcMaterial') {
        m.renderQcMaterial(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'qcEquipment') {
        m.renderQcEquipment(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'qcMsds') {
        m.renderQcMsds(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'lotTrace') {
        m.renderLotTrace(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'stockCheck') {
        m.renderStockCheck(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'overview') {
        m.renderOverviewBoard(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'warehouse3d') {
        m.renderWarehouse3D(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'erpMap') {
        m.renderErpMap(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'feedback') {
        m.renderFeedbackBoard(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'usageBoard') {
        m.renderUsageBoard(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'partnerBoard') {
        m.renderPartnerBoard(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'qcBoard') {
        m.renderQcBoard(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'qcMonthly') {
        m.renderQcMonthly(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'inspectLog') {
        m.renderInspectLog(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'yieldLog') {
        m.renderYieldLog(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'manual') {
        m.renderUserManual(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'fieldQr') {
        m.renderFieldQrLabels(mainContent, { showToast });
    } else if (activeTab === 'qrStore') {
        m.renderQrStore(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'labelDesigner') {
        renderLabelDesigner(mainContent, { showToast });
    } else if (activeTab === 'master') {
        renderMasterManager(mainContent, { showToast, onRefresh: renderActiveTab });
    } else if (activeTab === 'inventory') {
        renderInventoryManager(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'rawLedger') {
        renderRawMaterialLedger(mainContent, { showToast });
    } else if (activeTab === 'audit') {
        renderAuditManager(mainContent, { showToast, onRefresh: renderActiveTab, onSwitchTab: switchTab });
    } else if (activeTab === 'ledger') {
        renderItemLedger(mainContent, { kind: 'material', showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'productLedger') {
        renderItemLedger(mainContent, { kind: 'product', showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'ledgerViewer') {
        renderLedgerViewer(mainContent, { showToast });
    } else if (activeTab === 'secureWorkOrders') {
        renderSecureWorkOrders(mainContent, { showToast });
    } else if (activeTab === 'calendar') {
        renderCalendar(mainContent, { showToast });
    } else if (activeTab === 'analytics') {
        renderAnalytics(mainContent, { showToast });
    } else if (activeTab === 'qualityMeeting') {
        m.renderQualityMeeting(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'reports') {
        m.renderReports(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'planning') {
        renderPlanning(mainContent, { showToast });
    } else if (activeTab === 'history') {
        renderHistoryManager(mainContent, { showToast });
    } else if (activeTab === 'settings') {
        renderSettingsManager(mainContent, { showToast, onRefresh: renderActiveTab, onOpenModal: openModalByName });
    }

    // Lucide 아이콘 활성화
    createIcons({ icons });
};

export const getTabLabel = (id) => {
    const map = {
        home: '홈',
        hqLog: '업무일지(본사)',
        gimpoLog: '업무일지(김포)',
        prodSchedule: '생산(포장) 스케줄',
        productionHq: '제품생산/입고(본사)',
        production: '제품생산/입고(김포)',
        scan: '현장 스캔 / 작업',
        oilcalc: '비중·오일 계산기',
        lubCalc: '윤활유 충진 보정계산기',
        calc: '전자계산기',
        unitConv: '단위환산계산기',
        fxCalc: '환율계산기',
        viscCalc: '점도·비중 계산기',
        docTools: '뷰어 및 편집기',
        label: '라벨·파렛트식별표 발행',
        labelDesigner: '라벨 만들기',
        fieldQr: '현장 QR 라벨',
        qrStore: 'QR코드 저장소',
        manual: '매뉴얼',
        notice: '공지사항',
        library: '자료실',
        qcProduct: '제품관리', qcProcess: '공정관리', qcMaterial: '원부자재관리', qcEquipment: '설비관리', qcMsds: 'MSDS관리', overview: '종합현황판', partnerBoard: '거래처별 실적', feedback: '의견·개선 요청', erpMap: 'ERP 코드 대응표', warehouse3d: '창고 배치도(3D)', usageBoard: '사용 정착 현황', stockCheck: '재고 차이 점검', lotTrace: 'LOT 추적', qcBoard: '품질관리 현황판', qcMonthly: '월간 불량률 현황', inspectLog: '초·중·종물 검사 및 작업일지', yieldLog: '포장수율표',
        eApproval: '전자결재',
        fileStore: '파일 저장소',
        packStandard: '포장작업표준서',
        lineCount: '라인 스캔 집계',
        prodPlan: '생산계획',
        purchPlan: '구매계획',
        prodRequest: '생산요청서',
        orderBoard: '주문관리',
        shipRequest: '출하요청서',
        purchRequest: '구매요청서',
        workPlan: '업무추진계획',
        slipIssue: '전표발행',
        slipManage: '전표관리',
        ibcTotes: 'IBC(공토트) 관리',
        docScan: '전표 스캔 등록',
        master: '품목 마스터 관리',
        inventory: '창고 재고 현황',
        rawLedger: '원료 수불부',
        audit: '재고실사 / 조사',
        ledger: '자재 수불부',
        productLedger: '제품 수불부',
        ledgerViewer: '수불부 조회·인쇄',
        secureWorkOrders: '원액생산 작업지시서',
        calendar: '수불·입출고 캘린더',
        analytics: '월간 실적 현황판',
        reports: '보고서',
        qualityMeeting: '품질회의',
        planning: '발주·생산 검토',
        history: '전체 작업·감사 이력',
        settings: '환경설정'
    };
    return map[id] || hubGroupOf(id)?.label || id; // 묶음 화면은 묶음 이름
};

/** 화면을 바꿔 그린다 (방문 기록은 부르는 쪽이 맞춘다) */
const showTab = (tabId) => {
    activeTab = tabId;
    window.__activeTab = activeTab;
    renderNavigationSections();
    renderActiveTab();
};

/** 지금 화면을 떠나도 되는지 — 저장하지 않은 내용이 있는 화면은 묻는다. 사용자가 취소하면 false */
const confirmLeaveActiveTab = () => {
    // 뷰어 및 편집기에서 저장 안 한 내용이 있으면 확인
    if (activeTab === 'docTools' && loadedTabModules.docTools && !loadedTabModules.docTools.confirmLeaveDocTools()) return false;
    // 혼합물 MSDS 작성 편집기(화면을 덮는 창)가 열려 있으면 닫는다 (저장 안 한 내용이 있으면 확인) — components/quality/msds/msdsEditor.js
    if (typeof window.__leaveMsdsEditor === 'function' && !window.__leaveMsdsEditor()) return false;
    // 창고 배치도의 평면도 편집기가 열려 있으면 닫는다 (저장 안 한 내용이 있으면 확인)
    if (activeTab === 'warehouse3d' && loadedTabModules.warehouse3d && !loadedTabModules.warehouse3d.confirmLeaveWarehouse3D()) return false;
    return true;
};

/**
 * 화면 위에 열려 있는 것 하나(맨 위 창 · 스마트폰 메뉴 서랍 · 현황판 전체화면)를 닫는다.
 * @returns {'none' | 'closed' | 'kept' | 'locked'} 열린 것이 없음 · 닫음 · 닫지 못함(저장 확인 취소 등) · 닫으면 안 되는 창
 */
const dismissTopLayer = () => {
    const result = closeTopOverlay();
    if (result !== 'none') return result;
    if (isBoardFullscreen()) { setBoardFullscreen(false); return 'closed'; }
    return 'none';
};

// 뒤로가기 실행 (머리글 ← · Alt+← · Backspace · 마우스 뒤로 단추): 열린 창 닫기 → 이전 화면 → 홈
export const goBack = () => {
    if (!document.getElementById('main-content')) return false; // 로그인·승인 대기 화면

    // 1. 편집기 창(자기 방문 기록 표시를 가진 창)이 열려 있으면 그 표시를 뺀다 → 편집기가 스스로 닫는다 (저장 확인 포함)
    if (hasSelfManagedOverlay()) {
        window.history.back();
        return true;
    }

    // 2. 열려 있는 창이 있으면 맨 위 하나만 닫는다 (화면은 그대로)
    const dismissed = dismissTopLayer();
    if (dismissed === 'locked') {
        showToast('ℹ️ 열려 있는 창에서 먼저 골라 주세요.');
        return false;
    }
    if (dismissed !== 'none') return true;

    // 3. 이 창에서 지나온 화면이 있으면 방문 기록을 한 칸 되돌린다 → popstate에서 이전 화면을 그린다
    if (navIdx > 1) {
        window.history.back();
        return true;
    }

    // 4. 지나온 화면이 없는데(새 창 · 주소로 바로 들어옴) 홈이 아니면 홈(대시보드)으로
    if (activeTab !== 'home') {
        if (!confirmLeaveActiveTab()) return false;
        // 첫 화면의 칸을 홈으로 바꾼다 (문지기 칸에 잠깐 서 있는 중이면 그 위에 새로 쌓는다 — 문지기 칸은 비워 둔다)
        setNavState('home', Math.max(navIdx, 1), { push: navIdx === 0 });
        showTab('home');
        showToast('↩️ 홈 화면으로 이동');
        return true;
    }

    // 5. 이미 첫 번째 홈 화면인 경우
    showToast('ℹ️ 첫 번째 화면(홈)입니다.');
    return false;
};

export const switchTab = (tabId, pushHistory = true) => {
    if (tabId === 'palletLabel') {
        window.__labelInitialSubtab = '3130';
        tabId = 'label';
        if (activeTab === 'label') {
            const btn = document.querySelector('#btn-subtab-formtec3130');
            if (btn) btn.click();
            return;
        }
    }

    const userRole = state.currentUser?.role || 'VIEWER';
    if (!canAccessTab(tabId, userRole)) {
        showToast('⚠️ 해당 메뉴에 대한 접근 권한이 없습니다.');
        return;
    }

    if (tabId === activeTab) return;
    if (!confirmLeaveActiveTab()) return;

    if (pushHistory) {
        // 방금 닫힌 편집기 창의 표시({ modal })가 맨 위에 남아 있으면 그 칸을 새 화면으로 바꾼다
        // (그 위에 쌓으면 뒤로가기 한 번이 아무 일도 하지 않는 칸이 된다)
        setNavState(tabId, navIdx + 1, { push: !window.history.state?.modal });
    }

    showTab(tabId);
};
window.__switchTab = switchTab; window.__showToast = showToast;

const renderHeaderSection = () => {
    const headerContainer = document.getElementById('header-container');
    if (headerContainer) {
        renderHeader(headerContainer, {
            currentTab: activeTab,
            canGoBack: navIdx > 1 || activeTab !== 'home',
            onBack: () => {
                goBack();
            },
            onTabChange: (tab) => {
                switchTab(tab);
            },
            onWorkerChange: (workerName) => {
                setCurrentWorker(workerName);
                showToast(`작업자가 '${workerName}'(으)로 변경되었습니다.`);
            },
            onLogout: logoutAndRestart
        });
        createIcons({ icons });
    }
};

const logoutAndRestart = async () => {
    closeWorkerPicker();
    await logout();
    showToast('안전하게 로그아웃되었습니다.');
    initApp();
};

// 현장 공용계정: 작업자 고르기 창. 아직 고르지 않았으면 닫을 수 없다 (components/WorkerPicker.js)
const showWorkerPicker = () => {
    if (!isSharedAccount()) return;
    openWorkerPicker({
        required: needsWorkerChoice(),
        onLogout: logoutAndRestart,
        onPicked: (label) => {
            renderNavigationSections();
            showToast(`👤 작업자: ${label} — 이후 작업 기록에 이 이름이 남습니다.`);
        }
    });
};
window.__openWorkerPicker = showWorkerPicker;

const renderSidebarSection = () => {
    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer) {
        renderSidebar(sidebarContainer, {
            currentTab: activeTab,
            onTabChange: (tab) => {
                switchTab(tab);
            }
        });
        createIcons({ icons });
    }
};

export const renderNavigationSections = () => {
    renderHeaderSection();
    renderSidebarSection();
};

let isNavListenersInit = false;
const setupNavigationListeners = () => {
    if (isNavListenersInit) return;
    isNavListenersInit = true;

    // 1. 방문 기록 이동 (popstate): 브라우저 뒤로·앞으로, 안드로이드 뒤로 제스처, 그리고 goBack()이 부른 history.back()
    window.addEventListener('popstate', (e) => {
        const mark = e.state;
        // 주소창에 #탭을 직접 넣어 생긴 새 칸에는 표시가 없다 → 아래 hashchange에서 처리한다
        if (!mark || (!mark.tab && !mark.modal)) return;
        if (!document.getElementById('main-content')) return; // 로그인·승인 대기 화면 (앱 화면이 없다)
        // 편집기 창(혼합물 MSDS 작성 · 창고 평면도)은 자기 표시가 빠지면 스스로 닫는다 (저장 확인 포함)
        if (hasSelfManagedOverlay()) return;

        const arrivedIdx = Number.isInteger(mark.idx) ? mark.idx : navIdx;
        if (isNavRestoring) {
            isNavRestoring = false;
            if (arrivedIdx === navIdx) return; // 창만 닫고 제자리로 돌아온 이동
        }

        // 닫힌 편집기 창이 남긴 표시 칸 — 그 칸에 머물지 않는다 (머물면 다음 뒤로가기가 아무 일도 하지 않는다)
        //   표시 바로 아래 칸이 그 화면의 칸이므로 한 칸 내려선다. 그 화면에서 앞으로 가다 올라선 경우에는 화면을 바꿀 것이 없다
        if (mark.modal) {
            if (arrivedIdx === navIdx) isNavRestoring = true;
            window.history.back();
            return;
        }

        const targetTab = mark.tab || 'home';
        const isBack = arrivedIdx < navIdx;
        // 같은 칸으로 돌아왔다 (편집기 창이 [닫기]로 자기 표시를 빼면서 닫힌 경우 등) — 바꿀 것이 없다
        if (arrivedIdx === navIdx && targetTab === activeTab) return;

        // 창 · 서랍 · 전체화면이 열려 있으면 뒤로가기 = 맨 위 하나 닫기. 화면은 그대로여야 하므로 방문 기록을 제자리로 돌려놓는다
        if (dismissTopLayer() !== 'none') {
            restoreNavPosition(arrivedIdx);
            return;
        }

        // 앱의 첫 화면에서 뒤로가기를 눌러 그 앞 칸(문지기)까지 내려왔다 → 앱 밖(이전 사이트)으로 나간다.
        // 더 갈 곳이 없으면(설치한 앱 · 새 탭) 잠깐 이 칸에 머문다 — 그동안 한 번 더 누르면 설치한 앱은 닫힌다.
        // 그대로면 첫 화면의 칸으로 되돌아가 문지기 칸을 다시 비워 둔다
        if (mark.guard && isBack) {
            navIdx = 0;
            window.history.back();
            setTimeout(() => { if (navIdx === 0) showToast(isStandalone() ? 'ℹ️ 첫 화면입니다. 뒤로가기를 한 번 더 누르면 앱을 닫습니다.' : 'ℹ️ 첫 번째 화면입니다.'); }, 300);
            setTimeout(() => { if (navIdx === 0) window.history.forward(); }, EXIT_WINDOW_MS);
            return;
        }

        if (targetTab === activeTab) {
            navIdx = arrivedIdx;
            renderHeaderSection();
            return;
        }
        const userRole = state.currentUser?.role || 'VIEWER';
        const isKnownTab = !!(TAB_PERMISSIONS[targetTab] || hubGroupOf(targetTab));
        if (!isKnownTab || !canAccessTab(targetTab, userRole)) {
            // 볼 수 없는 화면의 칸(권한이 바뀌었거나 다른 계정으로 다시 로그인 · 없어진 화면): 지금 화면으로 바꿔 두고, 뒤로 가던 중이면 한 칸 더 간다
            setNavState(activeTab, arrivedIdx);
            if (isBack && arrivedIdx > 1) window.history.back();
            else renderHeaderSection();
            return;
        }
        // 저장하지 않은 내용이 있어 사용자가 머물기로 했으면 방문 기록도 제자리로
        if (!confirmLeaveActiveTab()) {
            restoreNavPosition(arrivedIdx);
            return;
        }
        navIdx = arrivedIdx;
        showTab(targetTab);
        showToast(`${isBack ? '↩️ 이전' : '↪️ 다음'} 화면(${getTabLabel(targetTab)})(으)로 이동`);
    });

    // 1-2. 주소의 #탭 이름만 바뀐 경우 (주소창에 직접 입력 · 이미 열려 있는 주메뉴 창을 다시 부름 — window.open이 같은 창의 주소만 바꾼다)
    //      브라우저가 표시 없는 새 칸을 만든다. 앱 안의 이동(switchTab)은 pushState라 이 이벤트가 나지 않고, 뒤로·앞으로는 위 popstate가 처리한다
    window.addEventListener('hashchange', () => {
        if (window.history.state?.tab || window.history.state?.modal) return; // 앱이 표시해 둔 칸 사이의 이동
        if (!document.getElementById('main-content')) return; // 로그인·승인 대기 화면
        const tab = (window.location.hash || '').replace('#', '').split('?')[0];
        if (!tab || !(TAB_PERMISSIONS[tab] || hubGroupOf(tab))) return;
        // 편집기 창이 열려 있는 동안에는 주소로 화면을 바꾸지 않는다 (그 창의 표시 칸이 방문 기록 중간에 남지 않게)
        const isEditorOpen = hasSelfManagedOverlay();
        if (!isEditorOpen && tab !== activeTab) switchTab(tab, false);
        if (!isEditorOpen && activeTab === tab) {
            // 새 칸에 표시를 남긴다 (뒤로가기로 방금 화면에 돌아갈 수 있다)
            setNavState(tab, navIdx + 1);
            renderHeaderSection();
            return;
        }
        // 옮기지 않았으면(편집기 창이 열려 있음 · 권한 없음 · 저장 확인 취소) 방금 생긴 칸에서 물러난다 — 주소도 지금 화면으로 돌아온다
        isNavRestoring = true;
        window.history.back();
    });

    // 2. 키보드 뒤로가기 단축키 이벤트
    // Esc는 맨 위에 열린 창 하나를 닫는다. 창이 스스로 Esc를 처리하면(이미 닫힘) 그 아래 창까지 닫지 않도록,
    // 다른 처리보다 먼저(capture) 그때의 맨 위 창을 기억해 두고 나중에 아직 열려 있을 때만 닫는다
    let escTarget = null;
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') escTarget = topOverlay(); }, true);
    window.addEventListener('keydown', (e) => {
        // A) Alt + LeftArrow (OS/브라우저 표준 뒤로가기 단축키)
        if (e.altKey && e.key === 'ArrowLeft') {
            e.preventDefault();
            goBack();
            return;
        }

        // B) Escape 키 (맨 위에 열린 창 닫기)
        if (e.key === 'Escape') {
            const target = escTarget;
            escTarget = null;
            if (target && isOverlayOpen(target) && !hasSelfManagedOverlay() && closeOverlay(target) === 'closed') e.preventDefault();
            return;
        }

        // C) Backspace 키 (입력 폼이 아닐 때만 뒤로가기 실행)
        if (e.key === 'Backspace') {
            const activeEl = document.activeElement;
            const isEditing = activeEl && (
                activeEl.tagName === 'INPUT' ||
                activeEl.tagName === 'TEXTAREA' ||
                activeEl.tagName === 'SELECT' ||
                activeEl.isContentEditable
            );
            if (!isEditing) {
                e.preventDefault();
                goBack();
                return;
            }
        }
    });

    // 3. 마우스 보조 뒤로가기 버튼 (Button 3 / 4번 버튼)
    window.addEventListener('mouseup', (e) => {
        if (e.button === 3) {
            e.preventDefault();
            goBack();
        }
    });
};

window.__goBack = goBack;
window.__switchTab = switchTab; window.__showToast = showToast;
// 지금 탭을 다시 그리기 (메시지 접수로 같은 화면에 초안을 넣을 때, services/msgIntake.js)
window.__rerenderActiveTab = () => renderActiveTab();
window.__refreshNavigation = () => renderNavigationSections();
// 뷰어 및 편집기가 열린 채로 다른 파일을 넘겼을 때 다시 그리기 (services/viewerOpen.js)
window.__rerenderDocTools = () => {
    if (activeTab !== 'docTools') return;
    if (loadedTabModules.docTools && !loadedTabModules.docTools.confirmLeaveDocTools()) { window.__docToolsPending = null; return; }
    renderActiveTab();
};

// 인증 통과 후 메인 WMS 앱 렌더링
const renderMainApp = () => {
    // 스마트폰 카메라 QR 스캔 및 딥링크 파라미터 감지 (?scan=... 또는 ?code=... 또는 #scan?code=...)
    const urlParams = new URLSearchParams(window.location.search);
    const hashStr = window.location.hash || '';
    let hashTab = '';
    let hashQuery = '';
    if (hashStr.includes('?')) {
        const parts = hashStr.replace('#', '').split('?');
        hashTab = parts[0];
        hashQuery = parts[1];
    } else {
        hashTab = hashStr.replace('#', '');
    }
    const hashParams = new URLSearchParams(hashQuery);

    // q: 현장 QR(위치·전표·원료 탱크·사원증·LOT, services/fieldQr.js) → 스캔 화면이 그대로 처리
    const scanCode = urlParams.get('scan') || urlParams.get('code') || hashParams.get('scan') || hashParams.get('code')
        || urlParams.get('q') || hashParams.get('q');
    const scanLot = urlParams.get('lot') || hashParams.get('lot');

    const userRole = state.currentUser?.role || 'VIEWER';
    // std: 포장작업표준서 QR·링크 (?std=<문서id>#packStandard) → 그 표준서를 연다
    const stdId = urlParams.get('std') || hashParams.get('std');
    if (stdId && canAccessTab('packStandard', userRole)) {
        window.__packStdOpenId = stdId;
        activeTab = 'packStandard';
    } else if (scanCode && canAccessTab('scan', userRole)) {
        window.__pendingScanCode = scanCode;
        window.__pendingScanLot = scanLot;
        activeTab = 'scan';
    } else if (hashTab && (TAB_PERMISSIONS[hashTab] || hubGroupOf(hashTab)) && canAccessTab(hashTab, userRole)) {
        // 알려진 탭 이름(과 묶음 화면)만 허용 (인증 링크 오류 시 남는 #error=... 등은 무시)
        activeTab = hashTab;
    } else {
        activeTab = 'home';
    }
    window.__activeTab = activeTab;
    // 표준서 링크(?std=)는 한 번 열고 주소에서 뺀다 (새로 고침·탭 이동 때 다시 열리지 않게)
    initNavHistory(stdId ? `${window.location.pathname}#${activeTab}` : `#${activeTab}`);

    // 네비게이션 & 단축키 리스너 초기화
    setupNavigationListeners();

    const app = document.getElementById('app');
    app.innerHTML = `
        <div id="header-container" class="sticky top-0 z-40 w-full bg-white no-print"></div>
        <div class="flex flex-1 w-full relative min-h-0">
            <div id="sidebar-container"></div>
            <!-- PC 16:9(1920×1080) 기준: 사이드바(240px)를 뺀 1680px까지 넓게 쓴다.
                 1536px 이상은 오른쪽에 떠 있는 단추(FloatingTools.js #ft-dock) 자리를 비워 본문 버튼이 가려지지 않게 한다 -->
            <main id="main-content" class="max-w-[1680px] mx-auto px-4 sm:px-6 2xl:pr-[72px] py-5 w-full flex-1 min-w-0"></main>
        </div>
        <div id="modals-container"></div>

        <!-- 아래로 내리면 나타나는 맨 위로 단추 (떠 있는 단추 묶음 바로 아래, 같은 흰 동그라미) -->
        <button type="button" id="btn-scroll-top" class="fixed bottom-5 max-sm:bottom-[76px] right-[19px] z-40 w-[38px] h-[38px] rounded-full bg-white hover:bg-slate-50 text-slate-500 hover:text-blue-600 border border-slate-200 shadow-lg active:scale-95 transition-all duration-300 opacity-0 pointer-events-none translate-y-4 flex items-center justify-center no-print cursor-pointer" title="화면 맨 위로" aria-label="화면 맨 위로">
            <i data-lucide="arrow-up" class="w-[18px] h-[18px]"></i>
        </button>
    `;

    // 맨 위로 복귀 버튼 이벤트 및 윈도우 스크롤 감지 등록
    const setupScrollTopButton = () => {
        const scrollTopBtn = document.getElementById('btn-scroll-top');
        if (!scrollTopBtn) return;

        window.addEventListener('scroll', () => {
            // 스크롤이 200px 이상 내려가면 서서히 페이드인
            if (window.scrollY > 200) {
                scrollTopBtn.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-4');
                scrollTopBtn.classList.add('opacity-100', 'pointer-events-auto', 'translate-y-0');
            } else {
                scrollTopBtn.classList.add('opacity-0', 'pointer-events-none', 'translate-y-4');
                scrollTopBtn.classList.remove('opacity-100', 'pointer-events-auto', 'translate-y-0');
            }
        }, { passive: true });

        // 클릭 시 부드럽게 최상단으로 스크롤 이동
        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    };
    setupScrollTopButton();

    // 모달 초기화
    const modalsContainer = document.getElementById('modals-container');
    renderModals(modalsContainer, {
        showToast,
        onDataChanged: async () => {
            await loadAllData();
            renderNavigationSections();
            renderActiveTab();
        }
    });

    // Supabase Realtime 구독 설정
    initRealtimeSubscription((notificationMessage) => {
        showToast(notificationMessage);
        renderActiveTab();
    });

    // 팝업 할일 메모장·채팅 (오른쪽 아래 버튼)
    mountFloatingTools(app, { showToast, onSwitchTab: switchTab });

    // 최초 뷰 렌더링
    renderNavigationSections();
    renderActiveTab();
    if (needsWorkerChoice()) showWorkerPicker();
    else closeWorkerPicker();
    prefetchTabModules();
    // 생산(포장) 스케줄: 어제까지 끝나지 않은 줄을 오늘 작성일자로 자동 넘김 (services/prodCarry.js, 하루 한 번)
    setTimeout(() => import('./services/prodCarry.js').then(m => m.carryOverSchedule()).then(r => {
        if (r?.count) { showToast(`🏭 ${r.from} 미완료 생산 스케줄 ${r.count}줄을 ${r.to} 작성일자로 넘겼습니다.`); if (activeTab === 'prodSchedule') renderActiveTab(); }
    }).catch(e => console.warn('[스케줄 넘김]', e.message)), 3000);
    // 아침 알림 요약 (services/morningDigest.js): 설정 시각 이후 처음 연 기기가 하루 한 번 보낸다. 켜 둔 동안은 10분마다 확인
    const digestTick = () => import('./services/morningDigest.js').then(m => m.runMorningDigest()).then(r => {
        if (r) showToast(`🔔 오늘 아침 알림 요약을 보냈습니다 (급함 ${r.counts.red} · 주의 ${r.counts.amber})${r.sent.errors.length ? ` · 일부 실패: ${r.sent.errors[0]}` : ''}`);
    }).catch(e => console.warn('[아침 알림]', e.message));
    setTimeout(digestTick, 8000);
    // 종합현황 월간 보고서 자동 보관 (services/monthlyReport.js): 매니저 이상, 새 달이 되면 지난달 보고서를 한 번 만든다
    // 창고 구획(3D 배치도) 위치를 위치 목록에 반영 (처음 쓰는 기기도 구획이 위치 선택에 보이게)
    setTimeout(() => import('./services/warehouseZones.js').then(m => m.loadZones()).catch(e => console.warn('[창고 구획]', e.message)), 4000);
    setTimeout(() => import('./services/monthlyReport.js').then(m => m.runMonthlyReportAuto()).then(ym => { if (ym) showToast(`📄 ${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월 종합현황 월간 보고서를 보고서 메뉴에 보관했습니다.`); }).catch(e => console.warn('[월간 보고서]', e.message)), 15000);
    if (!window.__digestTimer) window.__digestTimer = setInterval(digestTick, 10 * 60 * 1000);
};

// 앱 부트스트랩 (인증 상태 검사)
// DB 정책(RLS)상 로그인·승인 전에는 데이터를 읽을 수 없으므로, 인증을 먼저 확인한 뒤 데이터를 불러온다.
const initApp = async () => {
    // 0. 저장된 테마 모드 적용
    applyTheme(localStorage.getItem('daelim_theme') || 'light');

    const app = document.getElementById('app');
    unmountFloatingTools(); // 채팅 구독은 로그인 사용자 기준이므로 다시 붙인다
    closeWorkerPicker(); // 공용계정 작업자 창은 로그인 확인 뒤 다시 띄운다

    // 1. 인증 상태 확인 (Supabase Auth 세션 → 내 프로필·역할)
    const auth = await initAuth();

    if (auth.status === 'PENDING') {
        renderPendingView(app, {
            user: auth.user,
            onRecheck: initApp,
            onLogout: async () => {
                await logout();
                initApp();
            }
        });
        createIcons({ icons });
        return;
    }

    if (auth.status !== 'ACTIVE') {
        renderLoginView(app, {
            onLoginSuccess: () => initApp(),
            showToast,
            initialError: auth.error
        });
        createIcons({ icons });
        return;
    }

    // 2. 데이터 로드 (Supabase 또는 LocalStorage) 후 메인 앱 렌더링
    //    메뉴 권한 설정(환경설정에서 역할별·사용자별로 바꾼 메뉴)도 메뉴를 그리기 전에 받아 둔다
    await Promise.all([loadAllData(), loadMyMenuPermissions(state.currentUser)]);
    lastMenuPermissionCheck = Date.now();
    renderMainApp();
    if (state.offlineSession) showToast('📴 인터넷 연결 없이 시작했습니다. 이 기기에 저장된 자료로 작업하고, 연결되면 자동으로 반영합니다.');
    else runOfflineSync(); // 지난번에 못 올린 작업(수불부·업무일지 등)이 남아 있으면 바로 올린다
};

// 메뉴 권한 설정이 바뀌었는지 다시 확인한다: 창으로 돌아왔을 때(5분에 한 번) · 설정 화면에서 저장한 직후.
// 입력 중인 화면이 지워지지 않도록 본문은 다시 그리지 않고 메뉴만 다시 그린다. 보고 있던 메뉴가 막혔을 때만 홈으로 보낸다.
const MENU_PERMISSION_RECHECK_MS = 5 * 60 * 1000;
let lastMenuPermissionCheck = 0;
const refreshMenuPermissions = async () => {
    if (!state.currentUser || !document.getElementById('main-content')) return;
    lastMenuPermissionCheck = Date.now();
    const changed = await loadMyMenuPermissions(state.currentUser);
    if (!changed) return;
    renderNavigationSections();
    if (canAccessTab(activeTab, state.currentUser?.role)) return;
    showToast('⚠️ 보고 있던 메뉴의 권한이 바뀌어 홈 화면으로 이동합니다.');
    setNavState('home', navIdx);
    showTab('home');
};
window.__refreshMenuPermissions = refreshMenuPermissions;
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastMenuPermissionCheck > MENU_PERMISSION_RECHECK_MS) refreshMenuPermissions();
});

// 인증 상태 변화 처리 (한 번만 등록)
onAuthChange((event) => {
    if (event === 'SIGNED_OUT') {
        clearSecureData(); // 보안 자료(배합 정보)는 로그아웃 즉시 메모리에서 지움
        window.__msdsCleanup?.(); // 혼합물 MSDS 작성 창·받아 둔 물질 정보도 지움 (components/quality/MsdsAuthoring.js가 등록)
        unmountFloatingTools(); // 채팅 구독·팝업 창 닫기
        clearApprovalCache(); // 전자결재 서명 캐시
        clearCloudDataCache(); // 공용 PC에 재고·수불부 캐시가 남지 않도록 지움 (다음 로그인 때 클라우드에서 다시 받음)
    }
    if (event === 'SIGNED_OUT' && state.currentUser) {
        // 다른 탭에서 로그아웃했거나 세션이 만료됨
        state.currentUser = null;
        showToast('🔒 로그인이 만료되었습니다. 다시 로그인해 주세요.');
        initApp();
    } else if (event === 'PASSWORD_RECOVERY') {
        // 비밀번호 재설정 메일의 링크로 돌아온 경우
        setTimeout(async () => {
            const pw = prompt('새 비밀번호를 입력하세요 (8자 이상):');
            if (!pw) return;
            const res = await updatePassword(pw);
            alert(res.success ? '비밀번호가 변경되었습니다.' : `비밀번호 변경 실패: ${res.message}`);
            initApp();
        }, 300);
    }
});

window.addEventListener('DOMContentLoaded', initApp);
