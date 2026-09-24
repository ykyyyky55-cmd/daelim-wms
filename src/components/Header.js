import { state } from '../services/db.js';
import { isSupabaseConfigured } from '../services/supabase.js';
import { ROLE_INFO, canAccessTab } from '../services/auth.js';

export const renderHeader = (container, { currentTab = 'home', canGoBack = false, onTabChange, onWorkerChange, onLogout, onBack }) => {
    const isConnected = isSupabaseConfigured();
    const currentUser = state.currentUser || { name: '관리자', role: 'ADMIN' };
    const roleMeta = ROLE_INFO[currentUser.role] || { label: currentUser.role, color: 'bg-blue-100 text-blue-800' };

    // 전체 탭 정의
    const ALL_TABS = [
        { id: 'home', icon: 'home', label: '홈 (대시보드)' },
        { id: 'gimpoLog', icon: 'clipboard-list', label: '생산공급망 일지(김포)', highlight: 'text-blue-700' },
        { id: 'production', icon: 'factory', label: '제품생산 / 입고', highlight: 'text-indigo-600' },
        { id: 'scan', icon: 'scan-line', label: '현장 스캔 / 작업' },
        { id: 'oilcalc', icon: 'flask-conical', label: '비중·오일 계산기', highlight: 'text-sky-600' },
        { id: 'label', icon: 'tag', label: '라벨·파렛트식별표 발행' },
        { id: 'master', icon: 'layout-grid', label: '품목 마스터 관리' },
        { id: 'inventory', icon: 'database', label: '창고 재고 현황' },
        { id: 'audit', icon: 'clipboard-check', label: '재고실사 / 조사', highlight: 'text-teal-600' },
        { id: 'ledger', icon: 'book-open-check', label: '자재 수불부' },
        { id: 'calendar', icon: 'calendar', label: '수불·입출고 캘린더' },
        { id: 'analytics', icon: 'bar-chart-3', label: '월간 실적 현황판', highlight: 'text-emerald-600' },
        { id: 'planning', icon: 'calculator', label: '발주·생산 검토', highlight: 'text-violet-600' },
        { id: 'history', icon: 'history', label: '전체 작업·감사 이력' },
        { id: 'settings', icon: 'settings', label: '환경설정', highlight: 'text-blue-600' }
    ];

    // 현재 사용자 권한으로 접근 가능한 탭만 필터링 (RBAC)
    const visibleTabs = ALL_TABS.filter(t => canAccessTab(t.id, currentUser.role));
    const canAccessSettings = canAccessTab('settings', currentUser.role);

    // 품목 및 재고관리 드롭다운으로 묶일 하위 4대 메뉴 정의
    const STOCK_DROPDOWN_IDS = ['master', 'inventory', 'ledger', 'calendar'];
    const stockTabs = [
        { id: 'master', icon: 'layout-grid', label: '품목 마스터 관리', desc: '품목코드·분류·규격 기준정보' },
        { id: 'inventory', icon: 'database', label: '창고 재고 현황', desc: '거점별 실시간 재고 및 안전재고' },
        { id: 'ledger', icon: 'book-open-check', label: '자재 수불부', desc: '기초·입출고·기말 수불원장' },
        { id: 'calendar', icon: 'calendar', label: '수불·입출고 캘린더', desc: '월간 일정 및 입출고 캘린더' }
    ].filter(t => canAccessTab(t.id, currentUser.role));

    // 현재 탭이 품목 및 재고관리 하위 메뉴 중 하나인지 확인
    const isStockGroupActive = STOCK_DROPDOWN_IDS.includes(currentTab);

    // 내비게이션 바에 렌더링할 탭 HTML 목록 구성
    const navTabsHtml = [];
    let stockDropdownInserted = false;

    visibleTabs.forEach(t => {
        // 드롭다운 하위 메뉴인 경우: 최초 1회만 '품목 및 재고관리' 드롭다운으로 묶어서 렌더링
        if (STOCK_DROPDOWN_IDS.includes(t.id)) {
            if (!stockDropdownInserted && stockTabs.length > 0) {
                stockDropdownInserted = true;
                navTabsHtml.push(`
                <!-- 품목 및 재고관리 드롭다운 메뉴 (커서를 대면 4대 메뉴 노출) -->
                <div class="relative group/stock" id="nav-dropdown-stock-wrapper">
                    <button type="button" id="btn-nav-stock-dropdown" class="tab-btn-dropdown ${
                        isStockGroupActive 
                            ? 'active border-blue-600 text-blue-600 font-bold bg-blue-50/50' 
                            : 'border-transparent text-slate-600 hover:text-blue-600'
                    } py-3 px-2 border-b-2 flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer select-none">
                        <i data-lucide="boxes" class="w-4 h-4 ${isStockGroupActive ? 'text-blue-600' : 'text-slate-500'}"></i>
                        <span>품목 및 재고관리</span>
                        <i data-lucide="chevron-down" class="w-3.5 h-3.5 transition-transform duration-200 group-hover/stock:rotate-180"></i>
                    </button>

                    <!-- 커서를 대거나 클릭 시 노출되는 드롭다운 패널 -->
                    <div class="dropdown-menu-stock absolute left-0 top-full pt-1 hidden group-hover/stock:block z-50 min-w-[230px]">
                        <div class="bg-white rounded-2xl shadow-xl border border-slate-200 py-1.5 px-1.5 space-y-1">
                            <div class="px-2.5 py-1 text-[10px] font-black text-slate-400 border-b border-slate-100 flex items-center justify-between">
                                <span>품목 & 재고 원장</span>
                                <span class="text-blue-500 font-bold">대림 PRO</span>
                            </div>
                            ${stockTabs.map(sub => {
                                const isSubActive = sub.id === currentTab;
                                return `
                                <button type="button" data-tab="${sub.id}" class="tab-btn w-full flex items-center justify-between px-3 py-2 text-xs rounded-xl font-bold transition text-left ${
                                    isSubActive 
                                        ? 'bg-blue-600 text-white shadow-xs' 
                                        : 'text-slate-700 hover:bg-slate-100 hover:text-blue-600'
                                }">
                                    <div class="flex items-center gap-2.5">
                                        <i data-lucide="${sub.icon}" class="w-4 h-4 ${isSubActive ? 'text-white' : 'text-slate-400'}"></i>
                                        <div>
                                            <span class="block">${sub.label}</span>
                                            <span class="block text-[10px] ${isSubActive ? 'text-blue-100' : 'text-slate-400'} font-normal">${sub.desc}</span>
                                        </div>
                                    </div>
                                    ${isSubActive ? `<i data-lucide="check" class="w-3.5 h-3.5 text-white"></i>` : ''}
                                </button>
                                `;
                            }).join('')}
                        </div>
                    </div>
                </div>
                `);
            }
        } else {
            // 일반 단독 탭 버튼
            const isActive = t.id === currentTab;
            navTabsHtml.push(`
            <button type="button" data-tab="${t.id}" class="tab-btn ${isActive ? 'active border-blue-600 text-blue-600 font-bold' : 'border-transparent text-slate-600'} py-3 px-2 border-b-2 hover:text-blue-600 flex items-center gap-2 whitespace-nowrap transition">
                <i data-lucide="${t.icon}" class="w-4 h-4 ${t.highlight || ''}"></i>
                <span class="${t.highlight ? t.highlight + ' font-bold' : ''}">${t.label}</span>
            </button>
            `);
        }
    });

    container.innerHTML = `
    <header class="bg-white border-b border-slate-200 w-full shadow-sm no-print">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2.5">
                <!-- 사이드바 열기/닫기 토글 버튼 (모바일 햄버거 & 데스크톱 퀵 토글) -->
                <button type="button" id="btn-toggle-sidebar" class="p-2 rounded-xl text-slate-700 hover:text-blue-600 hover:bg-slate-100 transition border border-slate-200 shadow-2xs active:scale-95" title="좌측 사이드바 숨기기/펼치기">
                    <i data-lucide="menu" class="w-5 h-5"></i>
                </button>

                <div class="flex items-center gap-3 cursor-pointer select-none group" id="btn-header-home-logo" title="대시보드 홈으로 이동">
                    <div class="w-10 h-10 rounded-xl shadow-md border border-slate-200 overflow-hidden bg-gradient-to-tr from-blue-600 to-indigo-700 flex items-center justify-center text-white font-black text-lg group-hover:scale-105 transition transform">
                        DO
                    </div>
                <div>
                    <div class="flex items-center gap-2">
                        <h1 class="text-base font-extrabold tracking-tight text-slate-900 group-hover:text-blue-600 transition">대림오일 스마트 WMS</h1>
                        <span class="px-2 py-0.5 text-[10px] font-black bg-orange-100 text-orange-800 rounded-full border border-orange-200">정품 PRO</span>
                        <span id="supabase-status-badge" class="cursor-pointer px-2 py-0.5 text-[10px] font-bold rounded-full border transition flex items-center gap-1 ${
                            isConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-amber-50 text-amber-700 border-amber-300'
                        }">
                            <span class="w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}"></span>
                            <span>${isConnected ? 'Supabase 실시간 연결됨' : '오프라인/로컬 모드'}</span>
                        </span>
                    </div>
                    <p class="text-xs text-slate-500 hidden sm:block">대림오일 스마트 자재·재고·수불 관리 시스템 (클라우드 실시간 연동)</p>
                </div>
            </div>

            <!-- 상단 툴바 액션 버튼 그룹 -->
            <div class="flex items-center flex-wrap gap-2">
                <!-- 뒤로가기 버튼 -->
                <button type="button" id="btn-quick-back" class="px-2.5 sm:px-3 py-1.5 ${canGoBack ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300' : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100'} border rounded-xl text-xs font-black flex items-center gap-1 transition shadow-2xs hover:shadow-xs active:scale-95 group" title="이전 화면으로 뒤로가기 (단축키: Alt+← 또는 Backspace)">
                    <i data-lucide="arrow-left" class="w-4 h-4 ${canGoBack ? 'text-slate-700 group-hover:-translate-x-0.5' : 'text-slate-400'} transition-transform"></i>
                    <span>뒤로</span>
                </button>

                <!-- 별도 홈(대시보드) 복귀 버튼 -->
                <button type="button" id="btn-quick-home" class="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition shadow-sm hover:shadow active:scale-95">
                    <i data-lucide="home" class="w-4 h-4"></i>
                    <span>홈</span>
                </button>
                <!-- 현재 작업자 선택 -->
                <div class="flex items-center bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1 shadow-xs text-xs">
                    <i data-lucide="user-check" class="w-3.5 h-3.5 text-blue-600 mr-1.5"></i>
                    <span class="text-[11px] font-bold text-slate-500 hidden sm:inline mr-1">현재 작업자:</span>
                    <select id="global-worker-select" class="bg-transparent border-none text-xs font-bold text-slate-800 focus:outline-none cursor-pointer">
                        ${state.workers.map(w => `<option value="${w.name}" ${state.currentGlobalWorker.includes(w.name) ? 'selected' : ''}>${w.name} (${w.role || w.dept})</option>`).join('')}
                    </select>
                </div>

                <!-- 사용자 프로필 & 권한 뱃지 -->
                <div id="auth-profile-badge" class="flex items-center gap-1.5 bg-slate-900 text-white rounded-xl px-2.5 py-1 text-xs shadow-xs">
                    <i data-lucide="shield-check" class="w-3.5 h-3.5 text-emerald-400"></i>
                    <span id="auth-user-name" class="font-bold">${currentUser.name}</span>
                    <span id="auth-user-role-badge" class="px-1.5 py-0.2 rounded text-[10px] font-black ${roleMeta.color}">${roleMeta.label}</span>
                </div>

                <!-- 환경설정 버튼 (권한 보유자에게만 노출) -->
                ${canAccessSettings ? `
                    <button type="button" id="btn-open-settings" class="px-3 py-1.5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 hover:from-black hover:to-indigo-900 text-white border border-slate-700 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition shadow-sm">
                        <i data-lucide="settings" class="w-4 h-4 text-blue-400"></i>
                        <span>환경설정</span>
                    </button>
                ` : ''}

                <!-- 로그아웃 버튼 -->
                <button type="button" id="btn-logout" title="로그아웃" class="px-2.5 py-1.5 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 border border-slate-300 hover:border-rose-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-xs">
                    <i data-lucide="log-out" class="w-3.5 h-3.5 text-rose-500"></i>
                    <span class="hidden sm:inline">로그아웃</span>
                </button>
            </div>
        </div>

        <!-- 탭 메뉴 네비게이션 (역할별 허용 탭 및 품목·재고관리 드롭다운 렌더링) -->
        <div class="max-w-7xl mx-auto px-4 sm:px-6 flex overflow-x-auto md:overflow-visible gap-2 sm:gap-6 border-t border-slate-100 scrollbar-none text-xs sm:text-sm">
            ${navTabsHtml.join('')}
        </div>
    </header>
    `;

    // 드롭다운 토글 및 바깥 클릭 시 닫기 이벤트 바인딩
    const stockWrapper = container.querySelector('#nav-dropdown-stock-wrapper');
    const stockDropdownMenu = container.querySelector('.dropdown-menu-stock');
    const stockDropdownBtn = container.querySelector('#btn-nav-stock-dropdown');

    stockDropdownBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        stockDropdownMenu?.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!stockWrapper?.contains(e.target)) {
            stockDropdownMenu?.classList.add('hidden');
        }
    });

    // 사이드바 토글 버튼 이벤트 바인딩
    container.querySelector('#btn-toggle-sidebar')?.addEventListener('click', () => {
        if (window.__toggleSidebar) window.__toggleSidebar();
    });

    // 뒤로가기 버튼 이벤트 바인딩
    container.querySelector('#btn-quick-back')?.addEventListener('click', () => {
        if (onBack) onBack();
    });

    // 탭 전환 이벤트 바인딩
    container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            onTabChange(tabId);
        });
    });

    // 홈 복귀 헬퍼 함수
    const navigateToHome = () => {
        onTabChange('home');
    };

    container.querySelector('#btn-quick-home')?.addEventListener('click', navigateToHome);
    container.querySelector('#btn-header-home-logo')?.addEventListener('click', navigateToHome);

    container.querySelector('#global-worker-select')?.addEventListener('change', (e) => {
        onWorkerChange(e.target.value);
    });

    // 헤더 상단 환경설정 버튼 클릭 -> 환경설정 탭으로 이동
    container.querySelector('#btn-open-settings')?.addEventListener('click', () => {
        onTabChange('settings');
    });

    // 로그아웃 클릭 이벤트
    container.querySelector('#btn-logout')?.addEventListener('click', () => {
        if (confirm('현재 계정에서 로그아웃하시겠습니까?')) {
            onLogout();
        }
    });

    container.querySelector('#supabase-status-badge')?.addEventListener('click', () => {
        if (canAccessSettings) {
            onTabChange('settings');
        }
    });
};
