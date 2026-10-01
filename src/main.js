import { clearApprovalCache } from './services/approvals.js';
import { loadAllData, state, applyRealtimeInventoryChange, onCloudSyncError, clearCloudDataCache, syncOfflineWork, pendingWorklogCount } from './services/db.js';
import { checkCloudReachable, isKnownOffline, pendingOfflineCount } from './services/offlineQueue.js';
import { initRealtimeSubscription, registerRealtimeListener } from './services/realtime.js';
import { initAuth, logout, canAccessTab, onAuthChange, updatePassword, confirmOfflineSession, TAB_PERMISSIONS } from './services/auth.js';
import { createIcons, icons } from './services/icons.js';

import { renderLoginView, renderPendingView } from './components/LoginView.js';
import { renderHeader } from './components/Header.js';
import { renderSidebar } from './components/Sidebar.js';
import { clearSecureData } from './services/secureWorkOrders.js';
import { renderModals, openModalByName, closeAllModals } from './components/Modals.js';
import { closeColumnFilterPopover } from './components/ColumnFilter.js';
import { mountFloatingTools, unmountFloatingTools } from './components/FloatingTools.js';
import { injectDarkThemeCss } from './services/darkTheme.js';
import { handleInstallClick } from './services/pwaInstall.js';
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
const tabHistory = [];
window.__activeTab = activeTab;

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
        container.className = 'fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm pointer-events-none no-print';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'bg-slate-900/95 text-white border border-slate-700/80 px-4 py-3 rounded-2xl shadow-xl text-xs font-bold transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto backdrop-blur-xs flex items-center gap-2';
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
    production: () => import('./components/ProductionManager.js'),
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

const loadTabModule = (tab) => {
    const loader = TAB_MODULES[tab];
    if (!loader) return Promise.resolve(null);
    return loader().then(mod => (loadedTabModules[tab] = mod));
};

// 첫 화면을 그린 뒤 자주 쓰는 화면 코드를 미리 받아 둔다 (메뉴를 눌렀을 때 기다림 없애기)
const prefetchTabModules = () => {
    // 현장 작업 화면(스캔·실사·QR·라인 집계·작업 양식)도 받아 두어 인터넷이 없는 곳에서 처음 열어도 열리게 한다
    const run = () => ['inventory', 'production', 'scan', 'rawLedger', 'hqLog', 'gimpoLog', 'calendar', 'master',
        'audit', 'qrStore', 'lineCount', 'inspectLog', 'history', 'ledger']
        .forEach(t => { if (!loadedTabModules[t]) loadTabModule(t).catch(() => {}); });
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 5000 });
    else setTimeout(run, 2000);
};

// 메인 탭 렌더링
const renderActiveTab = () => {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;
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

    if (activeTab === 'home') {
        renderDashboard(mainContent, { onSwitchTab: switchTab, onOpenModal: openModalByName, showToast });
    } else if (activeTab === 'production') {
        renderProductionManager(mainContent, { showToast, onSwitchTab: switchTab });
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
        home: '홈 (대시보드)',
        hqLog: '업무일지(본사)',
        gimpoLog: '업무일지(김포)',
        prodSchedule: '생산(포장) 스케줄',
        production: '제품생산 / 입고',
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
    return map[id] || id;
};

// 뒤로가기 실행 (열린 모달 창 닫기 우선 -> 탭 히스토리 복귀 -> 홈 화면 복귀)
export const goBack = () => {
    // 1. 현재 화면에 열려있는 모달이 있는 경우 -> 모달 창 닫기
    if (closeAllModals()) {
        if (window.history.state?.modal) {
            try {
                window.history.back();
                return true;
            } catch (e) {}
        }
        showToast('창을 닫았습니다.');
        return true;
    }

    // 2. 방문 탭 히스토리가 남아있는 경우 -> 이전 탭으로 이동
    if (tabHistory.length > 0) {
        const prevTab = tabHistory.pop();
        const userRole = state.currentUser?.role || 'VIEWER';
        if (canAccessTab(prevTab, userRole)) {
            activeTab = prevTab;
            window.__activeTab = activeTab;
            try {
                window.history.replaceState({ tab: prevTab }, '', `#${prevTab}`);
            } catch (e) {}
            renderNavigationSections();
            renderActiveTab();
            showToast(`↩️ 이전 화면(${getTabLabel(prevTab)})(으)로 이동`);
            return true;
        }
    }

    // 3. 히스토리는 없지만 현재 홈 화면이 아닌 경우 -> 홈(대시보드)으로 이동
    if (activeTab !== 'home') {
        activeTab = 'home';
        window.__activeTab = activeTab;
        try {
            window.history.replaceState({ tab: 'home' }, '', '#home');
        } catch (e) {}
        renderNavigationSections();
        renderActiveTab();
        showToast('↩️ 홈 화면으로 이동');
        return true;
    }

    // 4. 이미 첫 번째 홈 화면인 경우
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
    // 뷰어 및 편집기에서 저장 안 한 내용이 있으면 확인
    if (activeTab === 'docTools' && loadedTabModules.docTools && !loadedTabModules.docTools.confirmLeaveDocTools()) return;
    // 창고 배치도의 평면도 편집기가 열려 있으면 닫는다 (저장 안 한 내용이 있으면 확인)
    if (activeTab === 'warehouse3d' && loadedTabModules.warehouse3d && !loadedTabModules.warehouse3d.confirmLeaveWarehouse3D()) return;

    if (pushHistory) {
        tabHistory.push(activeTab);
        try {
            window.history.pushState({ tab: tabId }, '', `#${tabId}`);
        } catch (e) {}
    }

    activeTab = tabId;
    window.__activeTab = activeTab;
    renderNavigationSections();
    renderActiveTab();
};
window.__switchTab = switchTab; window.__showToast = showToast;

const renderHeaderSection = () => {
    const headerContainer = document.getElementById('header-container');
    if (headerContainer) {
        renderHeader(headerContainer, {
            currentTab: activeTab,
            canGoBack: tabHistory.length > 0 || activeTab !== 'home',
            onBack: () => {
                goBack();
            },
            onTabChange: (tab) => {
                switchTab(tab);
            },
            onWorkerChange: (workerName) => {
                state.currentGlobalWorker = workerName;
                showToast(`작업자가 '${workerName}'(으)로 변경되었습니다.`);
            },
            onLogout: async () => {
                await logout();
                showToast('안전하게 로그아웃되었습니다.');
                initApp();
            }
        });
        createIcons({ icons });
    }
};

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

    // 1. 브라우저 및 안드로이드 하드웨어/제스처 뒤로가기 (popstate)
    window.addEventListener('popstate', (e) => {
        // 모달이 열려있다면 닫기
        if (closeAllModals()) {
            showToast('창을 닫았습니다.');
            return;
        }

        const targetTab = e.state?.tab || (window.location.hash ? window.location.hash.replace('#', '') : 'home');
        const userRole = state.currentUser?.role || 'VIEWER';
        if (targetTab && targetTab !== activeTab && canAccessTab(targetTab, userRole)) {
            if (tabHistory.length > 0 && tabHistory[tabHistory.length - 1] === targetTab) {
                tabHistory.pop();
            }
            activeTab = targetTab;
            window.__activeTab = activeTab;
            renderNavigationSections();
            renderActiveTab();
            showToast(`↩️ 이전 화면(${getTabLabel(targetTab)})(으)로 이동`);
        }
    });

    // 2. 키보드 뒤로가기 단축키 이벤트
    window.addEventListener('keydown', (e) => {
        // A) Alt + LeftArrow (OS/브라우저 표준 뒤로가기 단축키)
        if (e.altKey && e.key === 'ArrowLeft') {
            e.preventDefault();
            goBack();
            return;
        }

        // B) Escape 키 (열려있는 모달 닫기)
        if (e.key === 'Escape') {
            if (closeAllModals()) {
                e.preventDefault();
                if (window.history.state?.modal) {
                    try { window.history.back(); } catch (err) {}
                }
                showToast('창을 닫았습니다.');
            }
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
    } else if (hashTab && TAB_PERMISSIONS[hashTab] && canAccessTab(hashTab, userRole)) {
        // 알려진 탭 이름만 허용 (인증 링크 오류 시 남는 #error=... 등은 무시)
        activeTab = hashTab;
    } else {
        activeTab = 'home';
    }
    window.__activeTab = activeTab;
    try {
        // 표준서 링크(?std=)는 한 번 열고 주소에서 뺀다 (새로 고침·탭 이동 때 다시 열리지 않게)
        window.history.replaceState({ tab: activeTab }, '', stdId ? `${window.location.pathname}#${activeTab}` : `#${activeTab}`);
    } catch (e) {}

    // 네비게이션 & 단축키 리스너 초기화
    setupNavigationListeners();

    const app = document.getElementById('app');
    app.innerHTML = `
        <div id="header-container" class="sticky top-0 z-40 w-full bg-white shadow-xs no-print"></div>
        <div class="flex flex-1 w-full relative min-h-0">
            <div id="sidebar-container"></div>
            <!-- PC 16:9(1920×1080) 기준: 사이드바(240px)를 뺀 1680px까지 넓게 쓴다 -->
            <main id="main-content" class="max-w-[1680px] mx-auto px-4 sm:px-6 py-6 w-full flex-1 min-w-0"></main>
        </div>
        <div id="modals-container"></div>

        <!-- 스크롤 시 화면 우측 하단에 나타나는 맨 위로 복귀 버튼 -->
        <button type="button" id="btn-scroll-top" class="fixed bottom-6 right-6 z-40 p-3.5 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 active:scale-95 text-white shadow-xl hover:shadow-2xl border border-white/20 transition-all duration-300 opacity-0 pointer-events-none translate-y-4 flex items-center justify-center group no-print cursor-pointer" title="화면 맨 위로 복귀">
            <i data-lucide="arrow-up" class="w-5 h-5 transition-transform duration-200 group-hover:-translate-y-1"></i>
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
    await loadAllData();
    renderMainApp();
    if (state.offlineSession) showToast('📴 인터넷 연결 없이 시작했습니다. 이 기기에 저장된 자료로 작업하고, 연결되면 자동으로 반영합니다.');
    else runOfflineSync(); // 지난번에 못 올린 작업(수불부·업무일지 등)이 남아 있으면 바로 올린다
};

// 인증 상태 변화 처리 (한 번만 등록)
onAuthChange((event) => {
    if (event === 'SIGNED_OUT') {
        clearSecureData(); // 보안 자료(배합 정보)는 로그아웃 즉시 메모리에서 지움
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
