import { loadAllData, state, applyRealtimeInventoryChange, onCloudSyncError, clearCloudDataCache } from './services/db.js';
import { initRealtimeSubscription, registerRealtimeListener } from './services/realtime.js';
import { initAuth, logout, canAccessTab, onAuthChange, updatePassword, TAB_PERMISSIONS } from './services/auth.js';
import { createIcons, icons } from 'lucide';

import { renderLoginView, renderPendingView } from './components/LoginView.js';
import { renderHeader } from './components/Header.js';
import { renderDashboard } from './components/Dashboard.js';
import { renderProductionManager } from './components/ProductionManager.js';
import { renderScanner } from './components/Scanner.js';
import { renderLabelPrinter } from './components/LabelPrinter.js';
import { renderLabelDesigner } from './components/LabelDesigner.js';
import { renderDocScanner } from './components/DocScanner.js';
import { renderCalendar } from './components/CalendarView.js';
import { renderMasterManager } from './components/MasterManager.js';
import { renderInventoryManager } from './components/InventoryManager.js';
import { renderAuditManager } from './components/AuditManager.js';
import { renderAnalytics } from './components/Analytics.js';
import { renderPlanning } from './components/Planning.js';
import { renderHistoryManager } from './components/HistoryManager.js';
import { renderOilCalculator } from './components/OilCalculator.js';
import { renderLubricantCalculator } from './components/LubricantCalculator.js';
import { renderSettingsManager } from './components/SettingsManager.js';
import { renderProductionLog } from './components/ProductionLog.js';
import { renderSidebar } from './components/Sidebar.js';
import { renderRawMaterialLedger } from './components/RawMaterialLedger.js';
import { renderItemLedger } from './components/ItemLedger.js';
import { renderLedgerViewer } from './components/LedgerViewer.js';
import { renderSecureWorkOrders } from './components/SecureWorkOrders.js';
import { clearSecureData } from './services/secureWorkOrders.js';
import { renderModals, openModalByName, closeAllModals } from './components/Modals.js';
import { closeColumnFilterPopover } from './components/ColumnFilter.js';

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
    showToast(`⚠️ 클라우드 저장 실패: ${context} — 이 기기에만 저장되었습니다. 네트워크를 확인한 뒤 다시 시도하세요.`);
});

let activeTab = 'home';
const tabHistory = [];
window.__activeTab = activeTab;
let deferredPrompt = null;

// 배경화면 / 테마 모드 관리
const THEMES = ['light', 'dark', 'warm'];
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

// PWA 설치 프롬프트 이벤트 감지
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

window.__triggerPwaInstall = async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            showToast('🎉 대림오일 WMS 앱이 스마트폰/PC에 설치되었습니다!');
        }
        deferredPrompt = null;
    } else {
        alert('📱 [앱 설치 안내]\n1. 모바일 크롬: 브라우저 메뉴(⋮) -> [홈 화면에 추가] 또는 [앱 설치]\n2. 아이폰 사파리: 하단 공유 아이콘(↑) -> [홈 화면에 추가]를 누르시면 앱으로 설치됩니다.');
    }
};

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
    } else if (activeTab === 'gimpoLog') {
        renderProductionLog(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'oilcalc') {
        renderOilCalculator(mainContent, { showToast });
    } else if (activeTab === 'lubCalc') {
        renderLubricantCalculator(mainContent, { showToast });
    } else if (activeTab === 'label') {
        const initialSubtab = window.__labelInitialSubtab || null;
        window.__labelInitialSubtab = null;
        renderLabelPrinter(mainContent, { initialSubtab });
    } else if (activeTab === 'docScan') {
        renderDocScanner(mainContent, { showToast });
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
        renderAnalytics(mainContent);
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
        gimpoLog: '생산공급망 일지(김포)',
        production: '제품생산 / 입고',
        scan: '현장 스캔 / 작업',
        oilcalc: '비중·오일 계산기',
        lubCalc: '윤활유 충진 보정계산기',
        label: '라벨·파렛트식별표 발행',
        labelDesigner: '라벨 만들기',
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
window.__switchTab = switchTab;

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
window.__switchTab = switchTab;

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

    const scanCode = urlParams.get('scan') || urlParams.get('code') || hashParams.get('scan') || hashParams.get('code');
    const scanLot = urlParams.get('lot') || hashParams.get('lot');

    const userRole = state.currentUser?.role || 'VIEWER';
    if (scanCode && canAccessTab('scan', userRole)) {
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
        window.history.replaceState({ tab: activeTab }, '', `#${activeTab}`);
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

    // 최초 뷰 렌더링
    renderNavigationSections();
    renderActiveTab();
};

// 앱 부트스트랩 (인증 상태 검사)
// DB 정책(RLS)상 로그인·승인 전에는 데이터를 읽을 수 없으므로, 인증을 먼저 확인한 뒤 데이터를 불러온다.
const initApp = async () => {
    // 0. 저장된 테마 모드 적용
    applyTheme(localStorage.getItem('daelim_theme') || 'light');

    const app = document.getElementById('app');

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
};

// 인증 상태 변화 처리 (한 번만 등록)
onAuthChange((event) => {
    if (event === 'SIGNED_OUT') {
        clearSecureData(); // 보안 자료(배합 정보)는 로그아웃 즉시 메모리에서 지움
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
