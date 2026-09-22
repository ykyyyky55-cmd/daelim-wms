import { state } from '../services/db.js';
import { isSupabaseConfigured } from '../services/supabase.js';
import { ROLE_INFO, canAccessTab } from '../services/auth.js';

export const renderHeader = (container, { onTabChange, onWorkerChange, onLogout }) => {
    const isConnected = isSupabaseConfigured();
    const currentUser = state.currentUser || { name: '관리자', role: 'ADMIN' };
    const roleMeta = ROLE_INFO[currentUser.role] || { label: currentUser.role, color: 'bg-blue-100 text-blue-800' };

    // 전체 탭 정의
    const ALL_TABS = [
        { id: 'home', icon: 'home', label: '홈 (대시보드)' },
        { id: 'production', icon: 'factory', label: '제품생산 / 입고', highlight: 'text-indigo-600' },
        { id: 'scan', icon: 'scan-line', label: '현장 스캔 / 작업' },
        { id: 'oilcalc', icon: 'flask-conical', label: '비중·오일 계산기', highlight: 'text-sky-600' },
        { id: 'label', icon: 'qr-code', label: 'QR 생성 / 라벨발행' },
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

    container.innerHTML = `
    <header class="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm no-print">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl shadow-md border border-slate-200 overflow-hidden bg-gradient-to-tr from-blue-600 to-indigo-700 flex items-center justify-center text-white font-black text-lg">
                    DO
                </div>
                <div>
                    <div class="flex items-center gap-2">
                        <h1 class="text-base font-extrabold tracking-tight text-slate-900">대림오일 스마트 WMS</h1>
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

        <!-- 탭 메뉴 네비게이션 (역할별 허용 탭만 렌더링) -->
        <div class="max-w-7xl mx-auto px-4 sm:px-6 flex overflow-x-auto gap-2 sm:gap-6 border-t border-slate-100 scrollbar-none text-xs sm:text-sm">
            ${visibleTabs.map((t, idx) => `
                <button type="button" data-tab="${t.id}" class="tab-btn ${idx === 0 ? 'active border-blue-600 text-blue-600 font-bold' : 'border-transparent text-slate-600'} py-3 px-2 border-b-2 hover:text-blue-600 flex items-center gap-2 whitespace-nowrap transition">
                    <i data-lucide="${t.icon}" class="w-4 h-4 ${t.highlight || ''}"></i>
                    <span class="${t.highlight ? t.highlight + ' font-bold' : ''}">${t.label}</span>
                </button>
            `).join('')}
        </div>
    </header>
    `;

    // 탭 전환 이벤트 바인딩
    container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            container.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.remove('active', 'border-blue-600', 'text-blue-600', 'font-bold');
                b.classList.add('border-transparent', 'text-slate-600');
            });
            btn.classList.add('active', 'border-blue-600', 'text-blue-600', 'font-bold');
            btn.classList.remove('border-transparent', 'text-slate-600');
            onTabChange(tabId);
        });
    });

    container.querySelector('#global-worker-select')?.addEventListener('change', (e) => {
        onWorkerChange(e.target.value);
    });

    // 헤더 상단 환경설정 버튼 클릭 -> 환경설정 탭으로 이동
    container.querySelector('#btn-open-settings')?.addEventListener('click', () => {
        container.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.remove('active', 'border-blue-600', 'text-blue-600', 'font-bold');
            b.classList.add('border-transparent', 'text-slate-600');
            if (b.getAttribute('data-tab') === 'settings') {
                b.classList.add('active', 'border-blue-600', 'text-blue-600', 'font-bold');
                b.classList.remove('border-transparent', 'text-slate-600');
            }
        });
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
