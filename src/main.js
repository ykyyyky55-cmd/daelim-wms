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
import { renderModals, openModalByName } from './components/Modals.js';

let activeTab = 'home';
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
    renderHeaderSection();
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
        renderScanner(mainContent, { showToast, onSwitchTab: switchTab });
    } else if (activeTab === 'oilcalc') {
        renderOilCalculator(mainContent, { showToast });
    } else if (activeTab === 'label') {
        renderLabelPrinter(mainContent);
    } else if (activeTab === 'master') {
        renderMasterManager(mainContent, { showToast, onRefresh: renderActiveTab });
    } else if (activeTab === 'inventory') {
        renderInventoryManager(mainContent, { showToast });
    } else if (activeTab === 'audit') {
        renderAuditManager(mainContent, { showToast, onRefresh: renderActiveTab });
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

export const switchTab = (tabId) => {
    const userRole = state.currentUser?.role || 'VIEWER';
    if (!canAccessTab(tabId, userRole)) {
        showToast('⚠️ 해당 메뉴에 대한 접근 권한이 없습니다.');
        return;
    }
    activeTab = tabId;
    renderHeaderSection();
    renderActiveTab();
};

const renderHeaderSection = () => {
    const headerContainer = document.getElementById('header-container');
    if (headerContainer) {
        renderHeader(headerContainer, {
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

// 인증 통과 후 메인 WMS 앱 렌더링
const renderMainApp = () => {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div id="header-container"></div>
        <main id="main-content" class="max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full flex-1"></main>
        <div id="modals-container"></div>
    `;

    // 모달 초기화
    const modalsContainer = document.getElementById('modals-container');
    renderModals(modalsContainer, {
        showToast,
        onDataChanged: async () => {
            await loadAllData();
            renderHeaderSection();
            renderActiveTab();
        }
    });

    // Supabase Realtime 구독 설정
    initRealtimeSubscription((notificationMessage) => {
        showToast(notificationMessage);
        renderActiveTab();
    });

    // 최초 뷰 렌더링
    renderHeaderSection();
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
