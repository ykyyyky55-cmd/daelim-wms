import { loadAllData, state } from './services/db.js';
import { initRealtimeSubscription } from './services/realtime.js';
import { createIcons, icons } from 'lucide';

import { renderHeader } from './components/Header.js';
import { renderDashboard } from './components/Dashboard.js';
import { renderScanner } from './components/Scanner.js';
import { renderLabelPrinter } from './components/LabelPrinter.js';
import { renderMasterManager } from './components/MasterManager.js';
import { renderInventoryManager } from './components/InventoryManager.js';
import { renderAuditManager } from './components/AuditManager.js';
import { renderLedgerCalendar } from './components/LedgerCalendar.js';
import { renderAnalytics } from './components/Analytics.js';
import { renderPlanning } from './components/Planning.js';
import { renderHistoryManager } from './components/HistoryManager.js';
import { renderModals, openModalByName } from './components/Modals.js';

let activeTab = 'home';

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

    if (activeTab === 'home') {
        renderDashboard(mainContent, { onSwitchTab: switchTab, onOpenModal: openModalByName, showToast });
    } else if (activeTab === 'scan') {
        renderScanner(mainContent, { showToast, onSwitchTab: switchTab });
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
    }

    // Lucide 아이콘 활성화
    createIcons({ icons });
};

export const switchTab = (tabId) => {
    activeTab = tabId;
    renderHeaderSection();
    renderActiveTab();
};

const renderHeaderSection = () => {
    const headerContainer = document.getElementById('header-container');
    if (headerContainer) {
        renderHeader(headerContainer, {
            onTabChange: (tab) => {
                activeTab = tab;
                renderActiveTab();
            },
            onOpenModal: (modalName) => openModalByName(modalName),
            onWorkerChange: (workerName) => {
                state.currentGlobalWorker = workerName;
                showToast(`작업자가 '${workerName}'(으)로 변경되었습니다.`);
            }
        });
        createIcons({ icons });
    }
};

// 앱 부트스트랩
const initApp = async () => {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div id="header-container"></div>
        <main id="main-content" class="max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full flex-1"></main>
        <div id="modals-container"></div>
    `;

    // 1. 데이터 로드 (Supabase 또는 LocalStorage)
    await loadAllData();

    // 2. 모달 초기화
    const modalsContainer = document.getElementById('modals-container');
    renderModals(modalsContainer, {
        showToast,
        onDataChanged: async () => {
            await loadAllData();
            renderHeaderSection();
            renderActiveTab();
        }
    });

    // 3. Supabase Realtime 구독 설정
    initRealtimeSubscription((notificationMessage) => {
        showToast(notificationMessage);
        // 실시간 변경 발생 시 현재 보고 있는 탭 새로고침
        renderActiveTab();
    });

    // 4. 최초 뷰 렌더링
    renderHeaderSection();
    renderActiveTab();
};

window.addEventListener('DOMContentLoaded', initApp);
