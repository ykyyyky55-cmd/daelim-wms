import { loadAllData, state } from './services/db.js';
import { initRealtimeSubscription } from './services/realtime.js';
import { isAuthenticated, getCurrentUser, logout, canAccessTab } from './services/auth.js';
import { createIcons, icons } from 'lucide';

import { renderLoginView } from './components/LoginView.js';
import { renderHeader } from './components/Header.js';
import { renderDashboard } from './components/Dashboard.js';
import { renderProductionManager } from './components/ProductionManager.js';
import { renderScanner } from './components/Scanner.js';
import { renderLabelPrinter } from './components/LabelPrinter.js';
import { renderMasterManager } from './components/MasterManager.js';
import { renderInventoryManager } from './components/InventoryManager.js';
import { renderAuditManager } from './components/AuditManager.js';
import { renderLedgerCalendar } from './components/LedgerCalendar.js';
import { renderAnalytics } from './components/Analytics.js';
import { renderPlanning } from './components/Planning.js';
import { renderHistoryManager } from './components/HistoryManager.js';
import { renderOilCalculator } from './components/OilCalculator.js';
import { renderSettingsManager } from './components/SettingsManager.js';
import { renderProductionLog } from './components/ProductionLog.js';
import { renderSidebar } from './components/Sidebar.js';
import { renderModals, openModalByName, closeAllModals } from './components/Modals.js';

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
    toast.innerHTML = `<span>${message}</span>`;
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
    } else if (activeTab === 'label') {
        const initialSubtab = window.__labelInitialSubtab || null;
        window.__labelInitialSubtab = null;
        renderLabelPrinter(mainContent, { initialSubtab });
    } else if (activeTab === 'master') {
        renderMasterManager(mainContent, { showToast, onRefresh: renderActiveTab });
    } else if (activeTab === 'inventory') {
        renderInventoryManager(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'audit') {
        renderAuditManager(mainContent, { showToast, onRefresh: renderActiveTab, onSwitchTab: switchTab });
    } else if (activeTab === 'ledger') {
        renderLedgerCalendar(mainContent, { mode: 'ledger', showToast });
    } else if (activeTab === 'calendar') {
        renderLedgerCalendar(mainContent, { mode: 'calendar', showToast });
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
        label: '라벨·파렛트식별표 발행',
        master: '품목 마스터 관리',
        inventory: '창고 재고 현황',
        audit: '재고실사 / 조사',
        ledger: '자재 수불부',
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
            onLogout: () => {
                logout();
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
    } else if (hashTab && canAccessTab(hashTab, userRole)) {
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
        <div id="header-container"></div>
        <div class="flex flex-1 w-full relative min-h-0">
            <div id="sidebar-container"></div>
            <main id="main-content" class="max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full flex-1 min-w-0"></main>
        </div>
        <div id="modals-container"></div>
    `;

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
const initApp = async () => {
    // 0. 저장된 테마 모드 적용
    applyTheme(localStorage.getItem('daelim_theme') || 'light');

    // 1. 데이터 로드 (Supabase 또는 LocalStorage)
    await loadAllData();

    const app = document.getElementById('app');

    // 2. 인증 여부 검증 (미인증 시 로그인 화면 렌더링)
    if (!isAuthenticated()) {
        renderLoginView(app, {
            onLoginSuccess: (user) => {
                renderMainApp();
            },
            showToast
        });
        createIcons({ icons });
        return;
    }

    // 3. 인증 완료 시 사용자 객체 로드 및 메인 앱 렌더링
    getCurrentUser();
    renderMainApp();
};

window.addEventListener('DOMContentLoaded', initApp);
