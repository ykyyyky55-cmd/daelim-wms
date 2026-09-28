import { state, pendingWorklogCount } from '../services/db.js';
import { isKnownOffline, pendingOfflineCount, pendingOfflineOps, discardOfflineOp, onOfflineQueueChange } from '../services/offlineQueue.js';
import { isSupabaseConfigured } from '../services/supabase.js';
import { ROLE_INFO, canAccessTab } from '../services/auth.js';
import { esc } from '../services/html.js';
import { createIcons, icons } from '../services/icons.js';
import { getPinnedMenus } from './Sidebar.js';
import { installMode, onInstallChange } from '../services/pwaInstall.js';
import { TAB_META, orderedNav, loadNavOrder, saveNavOrder, resetNavOrder, navCollapsed, toggleNavCollapsed } from './navMenu.js';

// 상단 메뉴 순서 바꾸기 모드 (다시 그려도 유지)
let navEditMode = false;

// ---------- 오프라인 · 반영 대기 표시 ----------
const OFFLINE_BADGE_REFRESH_MS = 10000; // 연결 확인 결과는 조용히 바뀌므로 주기적으로 다시 그림

const pendingWorkCount = () => pendingOfflineCount() + pendingWorklogCount();

const paintOfflineStatus = (button) => {
    const count = pendingWorkCount();
    const isOffline = isKnownOffline();
    button.classList.toggle('hidden', !isOffline && count === 0);
    if (!isOffline && count === 0) return;
    button.classList.remove('bg-slate-800', 'text-white', 'border-slate-700', 'bg-amber-50', 'text-amber-800', 'border-amber-300');
    button.classList.add(...(isOffline ? ['bg-slate-800', 'text-white', 'border-slate-700'] : ['bg-amber-50', 'text-amber-800', 'border-amber-300']));
    button.innerHTML = isOffline
        ? `<i data-lucide="wifi-off" class="w-3.5 h-3.5"></i><span>오프라인${count > 0 ? ` · 대기 ${count}건` : ''}</span>`
        : `<i data-lucide="cloud-upload" class="w-3.5 h-3.5"></i><span>반영 대기 ${count}건</span>`;
    createIcons({ icons });
};

const mountOfflineStatus = (button) => {
    if (!button) return;
    const repaint = () => {
        if (!document.body.contains(button)) { cleanup(); return; }
        paintOfflineStatus(button);
    };
    const offQueue = onOfflineQueueChange(repaint);
    const timer = setInterval(repaint, OFFLINE_BADGE_REFRESH_MS);
    window.addEventListener('online', repaint);
    window.addEventListener('offline', repaint);
    function cleanup() {
        offQueue();
        clearInterval(timer);
        window.removeEventListener('online', repaint);
        window.removeEventListener('offline', repaint);
    }
    button.addEventListener('click', openOfflinePanel);
    paintOfflineStatus(button);
};

// 반영 대기 목록 창: 작업별 내용·반영 실패 사유, [지금 반영], 계속 실패하는 작업 버리기
const openOfflinePanel = () => {
    document.getElementById('offline-panel')?.remove();
    const panel = document.createElement('div');
    panel.id = 'offline-panel';
    panel.className = 'fixed inset-0 z-[300] bg-black/40 flex items-center justify-center p-4';
    document.body.appendChild(panel);

    const render = () => {
        const ops = pendingOfflineOps();
        const worklogCount = pendingWorklogCount();
        const isOffline = isKnownOffline();
        panel.innerHTML = `
            <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
                <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <h3 class="font-black text-slate-800 flex items-center gap-2"><i data-lucide="cloud-upload" class="w-5 h-5 text-amber-600"></i>반영 대기 작업</h3>
                    <button type="button" data-action="close" class="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
                </div>
                <div class="px-5 py-3 text-xs ${isOffline ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-800'}">
                    ${isOffline ? '📴 인터넷에 연결되어 있지 않습니다. 연결되면 자동으로 반영합니다.' : '🌐 인터넷에 연결되어 있습니다. 1분마다 자동으로 반영하며, 바로 올리려면 [지금 반영]을 누르세요.'}
                </div>
                <div class="flex-1 overflow-y-auto px-5 py-3 space-y-2 text-sm">
                    ${ops.length === 0 && worklogCount === 0 ? '<p class="text-slate-500 text-center py-6">반영을 기다리는 작업이 없습니다.</p>' : ''}
                    ${ops.map(op => `
                        <div class="border ${op.lastError ? 'border-rose-300 bg-rose-50' : 'border-slate-200'} rounded-xl px-3 py-2">
                            <div class="flex items-start justify-between gap-2">
                                <div>
                                    <div class="font-bold text-slate-800">${esc(op.label)}</div>
                                    <div class="text-[11px] text-slate-500">${esc(new Date(op.createdAt).toLocaleString('ko-KR'))}</div>
                                </div>
                                ${op.lastError ? `<button type="button" data-discard="${esc(op.id)}" class="shrink-0 px-2 py-1 text-[11px] font-bold text-rose-700 border border-rose-300 rounded-lg hover:bg-rose-100">버리기</button>` : ''}
                            </div>
                            ${op.lastError ? `<div class="mt-1 text-[11px] text-rose-700">반영 실패: ${esc(op.lastError)}</div>` : ''}
                        </div>`).join('')}
                    ${worklogCount > 0 ? `<div class="border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-800">업무일지 ${worklogCount}일치</div>` : ''}
                    <p class="text-[11px] text-slate-500 pt-1">수불부 전표는 위 작업과 함께 자동으로 올라갑니다.</p>
                </div>
                <div class="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
                    <button type="button" data-action="close" class="px-4 py-2 text-sm font-bold text-slate-600 border border-slate-300 rounded-xl hover:bg-slate-50">닫기</button>
                    <button type="button" data-action="sync" class="px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700">지금 반영</button>
                </div>
            </div>`;
        createIcons({ icons });
    };

    const offQueue = onOfflineQueueChange(render);
    const close = () => { offQueue(); panel.remove(); };
    panel.addEventListener('click', async (e) => {
        if (e.target === panel || e.target.closest('[data-action="close"]')) { close(); return; }
        const discardButton = e.target.closest('[data-discard]');
        if (discardButton) {
            if (confirm('이 작업을 클라우드에 반영하지 않고 버릴까요?\n이 기기 화면의 재고는 다음에 클라우드 자료를 받을 때 클라우드 값으로 돌아갑니다.')) {
                discardOfflineOp(discardButton.dataset.discard);
            }
            return;
        }
        const syncButton = e.target.closest('[data-action="sync"]');
        if (syncButton) {
            syncButton.disabled = true;
            syncButton.textContent = '반영 중…';
            await window.__syncOfflineWork?.();
            if (document.body.contains(panel)) render();
        }
    });
    render();
};

export const renderHeader = (container, args) => {
    const { currentTab = 'home', canGoBack = false, onTabChange, onWorkerChange, onLogout, onBack } = args;
    const isConnected = isSupabaseConfigured();
    const currentUser = state.currentUser || { name: '-', role: 'VIEWER' };
    const roleMeta = ROLE_INFO[currentUser.role] || { label: currentUser.role, color: 'bg-blue-100 text-blue-800' };

    // ---------- 상단 메뉴 (navMenu.js의 NAV_TREE, 순서는 사용자가 좌우로 바꿀 수 있음) ----------
    const canSee = (id) => canAccessTab(id, currentUser.role);
    const canAccessSettings = canSee('settings');
    const nodes = orderedNav().map(n => {
        if (n.tab) return canSee(n.tab) ? n : null;
        // 권한 있는 하위 메뉴만, 뒤에 메뉴가 없는 작은 제목은 뺀다
        const items = n.items.filter((x, i, arr) => {
            if (typeof x === 'string') return canSee(x);
            // 작은 제목: 다음 제목 전까지 보이는 메뉴가 있을 때만
            for (const y of arr.slice(i + 1)) { if (typeof y !== 'string') return false; if (canSee(y)) return true; }
            return false;
        });
        return items.some(x => typeof x === 'string') ? { ...n, items } : null;
    }).filter(Boolean);
    const groupActive = (n) => n.items?.includes(currentTab);
    const collapsedIds = navCollapsed();
    const topHtml = (n) => {
        const meta = n.tab ? TAB_META[n.tab] : n;
        const active = n.tab ? n.tab === currentTab : groupActive(n);
        // 접을 수 있는 메뉴(원액 작업지시서 🔒): 접으면 자물쇠 아이콘만, 누르면 펼침 / 펼치면 이름 옆 ‹ 로 접기
        if (n.collapsible && !navEditMode) {
            const folded = collapsedIds.includes(n.id);
            const cls = `${active ? 'active border-blue-600 text-blue-600 font-bold bg-blue-50/40' : 'border-transparent text-slate-600'} py-3 border-b-2 hover:text-blue-600 flex items-center gap-1.5 whitespace-nowrap transition`;
            return `<div class="nav-top relative shrink-0 flex items-stretch" data-node="${esc(n.id)}">
                ${folded
                    ? `<button type="button" class="nav-collapse ${cls} px-2" data-collapse="${esc(n.id)}" title="${esc(meta.label)} — 눌러서 펼치기"><i data-lucide="lock" class="w-4 h-4 text-amber-600"></i><i data-lucide="chevron-right" class="w-3 h-3 text-slate-400"></i></button>`
                    : `<button type="button" data-tab="${esc(n.tab)}" class="tab-btn ${cls} pl-2 pr-0.5"><i data-lucide="${meta.icon}" class="w-4 h-4 ${active ? 'text-blue-600' : 'text-amber-600'}"></i><span>${esc(meta.label)}</span></button>
                       <button type="button" class="nav-collapse self-center ml-0.5 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100" data-collapse="${esc(n.id)}" title="메뉴 줄에서 접기 (자물쇠만 보이게)"><i data-lucide="chevron-left" class="w-3.5 h-3.5"></i></button>`}
            </div>`;
        }
        return `
            <div class="nav-top relative shrink-0 flex items-stretch" data-node="${esc(n.id)}" ${navEditMode ? 'draggable="true"' : ''}>
                ${navEditMode ? `<button type="button" class="nav-move self-center px-1 text-slate-400 hover:text-blue-600 font-black" data-dir="-1" title="왼쪽으로">◀</button>` : ''}
                <button type="button" ${n.tab && !navEditMode ? `data-tab="${esc(n.tab)}"` : ''} class="${n.tab && !navEditMode ? 'tab-btn' : 'nav-group-btn'} ${active ? 'active border-blue-600 text-blue-600 font-bold bg-blue-50/40' : 'border-transparent text-slate-600'} ${navEditMode ? 'cursor-move border-dashed border-2 !border-slate-300 rounded-lg my-1 px-2' : 'py-3 px-2 border-b-2'} hover:text-blue-600 flex items-center gap-1.5 whitespace-nowrap transition w-full justify-center">
                    <i data-lucide="${meta.icon}" class="w-4 h-4 ${active ? 'text-blue-600' : 'text-slate-500'}"></i>
                    <span>${esc(meta.label)}</span>
                    ${n.items && !navEditMode ? '<i data-lucide="chevron-down" class="nav-chev w-3.5 h-3.5 transition-transform duration-200"></i>' : ''}
                </button>
                ${navEditMode ? `<button type="button" class="nav-move self-center px-1 text-slate-400 hover:text-blue-600 font-black" data-dir="1" title="오른쪽으로">▶</button>` : ''}
            </div>`;
    };
    // 커서를 올리면 한꺼번에 펼쳐지는 전체 메뉴: 묶음마다 한 칸(열), 칸은 메뉴 줄의 그 메뉴 바로 아래에 맞춘다
    const colHtml = (n) => `
        <div class="nav-col absolute top-0 py-3 px-1.5 space-y-0.5" data-node="${esc(n.id)}">
            ${n.items.map(x => {
                if (typeof x !== 'string') return `<div class="px-2 pt-1.5 pb-0.5 text-[10px] font-black text-slate-400 whitespace-nowrap">${esc(x.heading)}</div>`;
                const m = TAB_META[x] || { icon: 'circle', label: x, desc: '' };
                const on = x === currentTab;
                const fav = window.__isFavorite ? window.__isFavorite(x) : getPinnedMenus().includes(x);
                return `<div class="flex items-center gap-0.5"><button type="button" data-tab="${esc(x)}" title="${esc(m.desc)}" class="tab-btn flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap text-left transition ${on ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700'}">
                    <i data-lucide="${m.icon}" class="w-3.5 h-3.5 ${on ? 'text-white' : 'text-slate-400'}"></i><span>${esc(m.label)}</span></button>
                    <button type="button" class="nav-fav shrink-0 w-6 h-6 rounded text-sm leading-none ${fav ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}" data-fav="${esc(x)}" title="${fav ? '사이드바 즐겨찾기에서 빼기' : '사이드바 즐겨찾기에 등록'}">${fav ? '★' : '☆'}</button></div>`;
            }).join('')}
        </div>`;
    const navTabsHtml = nodes.map(topHtml);
    container.innerHTML = `
    <header class="bg-white border-b border-slate-200 w-full shadow-sm no-print">
        <div class="w-full px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2.5">
                <!-- 사이드바 열기/닫기 토글 버튼 (모바일 햄버거 & 데스크톱 퀵 토글) -->
                <button type="button" id="btn-toggle-sidebar" class="md:hidden p-2 rounded-xl text-slate-700 hover:text-blue-600 hover:bg-slate-100 transition border border-slate-200 shadow-2xs active:scale-95 min-w-11 min-h-11 inline-flex items-center justify-center" title="좌측 사이드바 숨기기/펼치기">
                    <i data-lucide="menu" class="w-5 h-5"></i>
                </button>

                <!-- 대림 로고 = 홈 버튼 (별도 홈 버튼 없음) -->
                <div class="flex items-center gap-3 cursor-pointer select-none group" id="btn-header-home-logo" title="홈(대시보드)으로 이동" role="button" tabindex="0" aria-label="홈으로 이동">
                    <div class="h-12 sm:h-14 px-1 flex items-center justify-center group-hover:scale-105 transition transform">
                        <!-- 밝은 화면 = 기본색 로고, 다크 모드 = 흰 로고 (index.html .logo-on-light/.logo-on-dark) -->
                        <img src="./logo.svg" alt="대림 로고 (홈)" class="logo-on-light h-9 sm:h-11 w-auto object-contain" />
                        <img src="./logo-white.svg" alt="대림 로고 (홈)" class="logo-on-dark h-9 sm:h-11 w-auto object-contain" />
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
            </div>

            <!-- 상단 툴바 액션 버튼 그룹 -->
            <div class="flex items-center flex-wrap gap-2">
                <!-- 뒤로가기 버튼 -->
                <button type="button" id="btn-quick-back" class="px-2.5 sm:px-3 py-1.5 ${canGoBack ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300' : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100'} border rounded-xl text-xs font-black flex items-center gap-1 transition shadow-2xs hover:shadow-xs active:scale-95 group" title="이전 화면으로 뒤로가기 (단축키: Alt+← 또는 Backspace)">
                    <i data-lucide="arrow-left" class="w-4 h-4 ${canGoBack ? 'text-slate-700 group-hover:-translate-x-0.5' : 'text-slate-400'} transition-transform"></i>
                    <span>뒤로</span>
                </button>

                <!-- 오프라인 · 반영 대기 (인터넷이 없거나 아직 못 올린 작업이 있을 때만 보임) -->
                <button type="button" id="btn-offline-status" title="이 기기에 저장해 두고 아직 클라우드에 반영하지 못한 작업" class="hidden px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-xs border"></button>

                <!-- 현재 작업자 선택 -->
                <div class="flex items-center bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1 shadow-xs text-xs">
                    <i data-lucide="user-check" class="w-3.5 h-3.5 text-blue-600 mr-1.5"></i>
                    <span class="text-[11px] font-bold text-slate-500 hidden sm:inline mr-1">현재 작업자:</span>
                    <select id="global-worker-select" class="bg-transparent border-none text-xs font-bold text-slate-800 focus:outline-none cursor-pointer">
                        ${state.workers.map(w => `<option value="${esc(w.name)}" ${state.currentGlobalWorker.includes(w.name) ? 'selected' : ''}>${esc(w.name)} (${esc(w.role || w.dept)})</option>`).join('')}
                    </select>
                </div>

                <!-- 사용자 프로필 & 권한 뱃지 -->
                <div id="auth-profile-badge" class="flex items-center gap-1.5 bg-slate-900 text-white rounded-xl px-2.5 py-1 text-xs shadow-xs">
                    <i data-lucide="shield-check" class="w-3.5 h-3.5 text-emerald-400"></i>
                    <span id="auth-user-name" class="font-bold">${esc(currentUser.name)}</span>
                    <span id="auth-user-role-badge" class="px-1.5 py-0.2 rounded text-[10px] font-black ${esc(roleMeta.color)}">${esc(roleMeta.label)}</span>
                </div>

                <!-- 환경설정 버튼 (권한 보유자에게만 노출) -->
                ${canAccessSettings ? `
                    <button type="button" id="btn-open-settings" class="px-3 py-1.5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 hover:from-black hover:to-indigo-900 text-white border border-slate-700 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition shadow-sm">
                        <i data-lucide="settings" class="w-4 h-4 text-blue-400"></i>
                        <span>환경설정</span>
                    </button>
                ` : ''}

                <!-- 앱 설치 (설치형 웹앱, 이미 설치된 앱으로 열면 숨김) -->
                <button type="button" id="btn-pwa-install" title="이 기기에 앱으로 설치 (윈도우·안드로이드·아이폰)" class="${installMode() ? '' : 'hidden'} px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-xs">
                    <i data-lucide="download" class="w-3.5 h-3.5"></i>
                    <span class="hidden sm:inline">앱 설치</span>
                </button>

                <!-- 로그아웃 버튼 -->
                <button type="button" id="btn-logout" title="로그아웃" class="px-2.5 py-1.5 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 border border-slate-300 hover:border-rose-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-xs">
                    <i data-lucide="log-out" class="w-3.5 h-3.5 text-rose-500"></i>
                    <span class="hidden sm:inline">로그아웃</span>
                </button>
            </div>
        </div>

        <!-- 탭 메뉴 네비게이션 (역할별 허용 탭 및 품목·재고관리 드롭다운 렌더링). 스마트폰 화면에서는
             숨기고 좌측 상단 ☰ 버튼으로 여는 사이드바 메뉴만 쓴다(md 이상에서만 표시). -->
        <!-- 메뉴는 한 줄, 사이드바 오른쪽 끝(--sidebar-w)에서 시작. 넘치면 양쪽 화살표·마우스 휠로 좌우 이동 -->
        <div id="nav-row" class="hidden md:flex items-stretch border-t border-slate-100 text-xs sm:text-sm">
            <!-- 사이드바 폭 칸: ☰ 버튼을 사이드바 오른쪽 끝 바로 위에 둔다. 커서 올림 = 잠깐 펼침, 클릭 = 고정 ↔ 숨김 -->
            <div class="shrink-0 flex items-center justify-end pr-1.5" style="width: var(--sidebar-w, 240px)">
                <button type="button" id="btn-sidebar-hover" class="p-2 rounded-lg border transition ${document.documentElement.dataset.sidebarPinned === '0' ? 'border-slate-200 text-slate-600 hover:text-blue-600 hover:bg-slate-100' : 'border-blue-200 bg-blue-50 text-blue-700'}" title="사이드바: 커서를 올리면 펼침 · 누르면 고정/해제">
                    <i data-lucide="menu" class="w-4 h-4"></i>
                </button>
            </div>
            <button type="button" id="nav-scroll-left" class="invisible shrink-0 w-8 flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-slate-100 border-r border-slate-100" title="왼쪽 메뉴 보기"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
            <div id="nav-tabs-scroll" class="flex flex-nowrap flex-1 min-w-0 overflow-x-auto overflow-y-hidden scrollbar-none gap-x-1 lg:gap-x-2 px-2 scroll-smooth ${navEditMode ? 'bg-amber-50' : ''}" style="scrollbar-width: none">
                <style>#nav-tabs-scroll::-webkit-scrollbar { display: none; }</style>
                ${navTabsHtml.join('')}
            </div>
            <button type="button" id="nav-scroll-right" class="invisible shrink-0 w-8 flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-slate-100 border-l border-slate-100" title="오른쪽 메뉴 보기"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
            <!-- 메뉴 순서 바꾸기: 좌우 화살표 또는 끌어다 놓아 서로 자리 바꾸기 (기기별 저장) -->
            <div class="shrink-0 flex items-center gap-1 px-1.5 border-l border-slate-100">
                ${navEditMode ? '<button type="button" id="nav-order-reset" class="px-2 py-1 rounded-lg text-[11px] font-bold text-slate-500 hover:bg-slate-100">기본 순서</button>' : ''}
                <button type="button" id="nav-edit-order" class="px-2 py-1 rounded-lg text-[11px] font-black flex items-center gap-1 transition ${navEditMode ? 'bg-amber-500 text-white hover:bg-amber-600' : 'text-slate-500 hover:text-blue-600 hover:bg-slate-100'}" title="메뉴 순서 바꾸기 (좌우 이동)">
                    <i data-lucide="arrow-left-right" class="w-3.5 h-3.5"></i><span class="hidden xl:inline">${navEditMode ? '순서 바꾸기 끝' : '메뉴 순서'}</span></button>
            </div>
        </div>
        ${navEditMode ? '<div class="hidden md:block px-4 py-1.5 bg-amber-50 border-t border-amber-200 text-[11px] font-bold text-amber-800">메뉴 순서 바꾸기: 메뉴의 ◀ ▶ 를 누르거나, 메뉴를 끌어다 다른 메뉴 위에 놓으면 두 메뉴의 자리가 바뀝니다. 다 되면 [순서 바꾸기 끝]을 누르세요. (이 기기에 저장)</div>' : ''}
        <!-- 커서를 올리면 한꺼번에 펼쳐지는 전체 메뉴 (칸은 메뉴 줄의 각 묶음 메뉴 바로 아래) -->
        <div id="nav-mega" class="hidden fixed left-0 right-0 z-40 bg-white border-y border-slate-200 shadow-2xl">
            <div id="nav-mega-cols" class="relative">${nodes.filter(n => n.items).map(colHtml).join('')}</div>
        </div>
    </header>
    `;

    // ---------- 전체 펼침 메뉴 · 좌우 화살표 · 휠 · 순서 바꾸기 ----------
    const navRow = container.querySelector('#nav-row');
    const navScroll = container.querySelector('#nav-tabs-scroll');
    const navLeft = container.querySelector('#nav-scroll-left');
    const navRight = container.querySelector('#nav-scroll-right');
    const mega = container.querySelector('#nav-mega');
    const megaCols = container.querySelector('#nav-mega-cols');
    if (navScroll) {
        // 가려진 쪽에만 화살표를 보인다
        const updateArrows = () => {
            if (!navScroll.isConnected) return;
            const max = navScroll.scrollWidth - navScroll.clientWidth;
            navLeft.classList.toggle('invisible', navScroll.scrollLeft <= 1);
            navRight.classList.toggle('invisible', navScroll.scrollLeft >= max - 1);
        };
        navLeft.addEventListener('click', () => navScroll.scrollBy({ left: -navScroll.clientWidth * 0.7, behavior: 'smooth' }));
        navRight.addEventListener('click', () => navScroll.scrollBy({ left: navScroll.clientWidth * 0.7, behavior: 'smooth' }));
        navScroll.addEventListener('scroll', updateArrows, { passive: true });
        // 세로 휠을 가로 이동으로 (메뉴가 넘칠 때만)
        navScroll.addEventListener('wheel', (e) => {
            if (navScroll.scrollWidth <= navScroll.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            e.preventDefault();
            navScroll.scrollBy({ left: e.deltaY, behavior: 'auto' });
        }, { passive: false });
        if (window.ResizeObserver) new ResizeObserver(updateArrows).observe(navScroll);

        // 각 묶음 메뉴 폭을 그 칸(하위 메뉴)의 폭 이상으로 맞춰, 펼쳤을 때 칸이 서로 겹치지 않게 한다
        const fitWidths = () => {
            if (!mega || !navScroll.isConnected) return;
            mega.style.visibility = 'hidden';
            mega.classList.remove('hidden');
            megaCols.querySelectorAll('.nav-col').forEach(col => {
                const top = navScroll.querySelector(`.nav-top[data-node="${col.dataset.node}"]`);
                if (!top) return;
                top.style.minWidth = '';
                const w = Math.ceil(col.getBoundingClientRect().width);
                if (w > top.getBoundingClientRect().width) top.style.minWidth = `${w}px`;
            });
            mega.classList.add('hidden');
            mega.style.visibility = '';
            updateArrows();
        };
        // 펼친 칸을 메뉴 줄의 그 메뉴 바로 아래로
        const placeCols = () => {
            const rowBox = navRow.getBoundingClientRect();
            mega.style.top = `${rowBox.bottom}px`;
            const box = navScroll.getBoundingClientRect();
            let h = 0;
            megaCols.querySelectorAll('.nav-col').forEach(col => {
                const top = navScroll.querySelector(`.nav-top[data-node="${col.dataset.node}"]`);
                const r = top?.getBoundingClientRect();
                const visible = r && r.right > box.left + 10 && r.left < box.right - 10;
                col.style.display = visible ? '' : 'none';
                if (!visible) return;
                col.style.left = `${r.left}px`;
                col.style.width = `${r.width}px`;
                h = Math.max(h, col.scrollHeight);
            });
            megaCols.style.height = `${h}px`;
        };
        let closeTimer = null;
        const openMega = () => {
            if (navEditMode || !mega || !megaCols.children.length) return;
            clearTimeout(closeTimer);
            mega.classList.remove('hidden');
            placeCols(); // 보이는 상태에서 재야 칸 높이가 나온다
            navScroll.querySelectorAll('.nav-chev').forEach(c => c.classList.add('rotate-180'));
        };
        const closeMega = (delay = 160) => {
            clearTimeout(closeTimer);
            closeTimer = setTimeout(() => {
                mega?.classList.add('hidden');
                navScroll.querySelectorAll('.nav-chev').forEach(c => c.classList.remove('rotate-180'));
                megaCols?.querySelectorAll('.nav-col').forEach(c => c.classList.remove('bg-blue-50/60'));
            }, delay);
        };
        navScroll.addEventListener('mouseenter', openMega);
        navScroll.addEventListener('mouseleave', () => closeMega());
        mega?.addEventListener('mouseenter', () => clearTimeout(closeTimer));
        mega?.addEventListener('mouseleave', () => closeMega());
        navScroll.addEventListener('scroll', () => { if (!mega?.classList.contains('hidden')) placeCols(); }, { passive: true });
        window.addEventListener('resize', () => { if (navScroll.isConnected) { fitWidths(); if (!mega.classList.contains('hidden')) placeCols(); } });
        // 터치·클릭: 묶음 메뉴 이름을 누르면 펼침/닫힘
        navScroll.querySelectorAll('.nav-group-btn').forEach(b => b.addEventListener('click', (e) => {
            if (navEditMode) return;
            e.stopPropagation();
            if (mega.classList.contains('hidden')) openMega(); else closeMega(0);
        }));
        document.addEventListener('click', (e) => { if (navRow?.isConnected && !navRow.contains(e.target) && !mega?.contains(e.target)) closeMega(0); });
        // ☆ = 사이드바 즐겨찾기 등록/해제 (Sidebar.js의 window.__toggleFavorite)
        megaCols?.querySelectorAll('.nav-fav').forEach(b => b.addEventListener('click', (e) => {
            e.stopPropagation();
            const on = window.__toggleFavorite?.(b.dataset.fav);
            b.textContent = on ? '★' : '☆';
            b.className = `nav-fav shrink-0 w-6 h-6 rounded text-sm leading-none ${on ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}`;
            b.title = on ? '사이드바 즐겨찾기에서 빼기' : '사이드바 즐겨찾기에 등록';
        }));
        // 펼친 칸에 커서를 올리면 그 묶음 메뉴 이름도 강조
        megaCols?.querySelectorAll('.nav-col').forEach(col => {
            const top = () => navScroll.querySelector(`.nav-top[data-node="${col.dataset.node}"] button:not(.nav-move)`);
            col.addEventListener('mouseenter', () => { col.classList.add('bg-blue-50/60'); top()?.classList.add('text-blue-600'); });
            col.addEventListener('mouseleave', () => { col.classList.remove('bg-blue-50/60'); top()?.classList.remove('text-blue-600'); });
        });
        navScroll.querySelectorAll('.nav-top').forEach(t => {
            t.addEventListener('mouseenter', () => megaCols?.querySelector(`.nav-col[data-node="${t.dataset.node}"]`)?.classList.add('bg-blue-50/60'));
            t.addEventListener('mouseleave', () => megaCols?.querySelector(`.nav-col[data-node="${t.dataset.node}"]`)?.classList.remove('bg-blue-50/60'));
        });

        // 지금 탭(또는 그 탭이 든 묶음 메뉴)이 보이도록 이동
        const scrollToActive = () => {
            const active = navScroll.querySelector('.nav-top .active');
            if (!active) return;
            const r = active.getBoundingClientRect();
            const box = navScroll.getBoundingClientRect();
            if (r.left < box.left || r.right > box.right) navScroll.scrollLeft += r.left - box.left - (box.width - r.width) / 2;
        };
        fitWidths();
        scrollToActive();
        requestAnimationFrame(() => { fitWidths(); updateArrows(); });
        setTimeout(() => { fitWidths(); scrollToActive(); }, 300); // 아이콘·글꼴이 늦게 그려져 폭이 바뀌는 경우

        // ---------- 메뉴 순서 바꾸기 (좌우 화살표 · 끌어다 놓아 서로 바꾸기) ----------
        const rerender = () => { renderHeader(container, args); createIcons({ icons }); };
        container.querySelector('#nav-edit-order')?.addEventListener('click', () => { navEditMode = !navEditMode; rerender(); });
        // 원액 작업지시서 메뉴 접기·펼치기 (기기별 기억)
        navScroll.querySelectorAll('.nav-collapse').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); toggleNavCollapsed(b.dataset.collapse); rerender(); }));
        container.querySelector('#nav-order-reset')?.addEventListener('click', () => { if (!confirm('메뉴 순서를 처음 상태로 되돌릴까요?')) return; resetNavOrder(); rerender(); });
        if (navEditMode) {
            const ids = () => loadNavOrder();
            const swap = (a, b) => {
                const order = ids();
                const i = order.indexOf(a), j = order.indexOf(b);
                if (i < 0 || j < 0 || i === j) return;
                [order[i], order[j]] = [order[j], order[i]];
                saveNavOrder(order);
                rerender();
            };
            // 화살표: 보이는 옆 메뉴와 자리 바꾸기 (권한 없어 안 보이는 메뉴는 건너뜀)
            const shown = nodes.map(n => n.id);
            navScroll.querySelectorAll('.nav-move').forEach(b => b.addEventListener('click', () => {
                const id = b.closest('.nav-top').dataset.node;
                const k = shown.indexOf(id) + Number(b.dataset.dir);
                if (k >= 0 && k < shown.length) swap(id, shown[k]);
            }));
            let dragId = '';
            navScroll.querySelectorAll('.nav-top').forEach(t => {
                t.addEventListener('dragstart', (e) => { dragId = t.dataset.node; e.dataTransfer.effectAllowed = 'move'; t.classList.add('opacity-50'); });
                t.addEventListener('dragend', () => t.classList.remove('opacity-50'));
                t.addEventListener('dragover', (e) => { e.preventDefault(); t.classList.add('ring-2', 'ring-blue-400', 'rounded-lg'); });
                t.addEventListener('dragleave', () => t.classList.remove('ring-2', 'ring-blue-400', 'rounded-lg'));
                t.addEventListener('drop', (e) => { e.preventDefault(); if (dragId && dragId !== t.dataset.node) swap(dragId, t.dataset.node); });
            });
        }
    }
    // 사이드바 토글 버튼 이벤트 바인딩 (스마트폰 ☰)
    container.querySelector('#btn-toggle-sidebar')?.addEventListener('click', () => {
        if (window.__toggleSidebar) window.__toggleSidebar();
    });

    // PC ☰ (메뉴 줄 왼쪽, 사이드바 오른쪽 끝 위): 커서 올림 = 잠깐 펼침, 벗어나면 위로 접힘, 클릭 = 고정 ↔ 숨김
    const hoverBtn = container.querySelector('#btn-sidebar-hover');
    if (hoverBtn) {
        const paint = (pinned) => {
            hoverBtn.className = `p-2 rounded-lg border transition ${pinned ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:text-blue-600 hover:bg-slate-100'}`;
            hoverBtn.title = pinned ? '사이드바 고정됨 · 누르면 숨김' : '커서를 올리면 사이드바 펼침 · 누르면 고정';
        };
        hoverBtn.addEventListener('mouseenter', () => window.__sidebarPeek?.(true));
        hoverBtn.addEventListener('mouseleave', () => window.__sidebarPeek?.(false, 250));
        hoverBtn.addEventListener('click', () => window.__sidebarTogglePin?.());
        const onState = (e) => { if (!hoverBtn.isConnected) { window.removeEventListener('sidebar:state', onState); return; } paint(e.detail.pinned); };
        window.addEventListener('sidebar:state', onState);
        paint(window.__sidebarIsPinned ? window.__sidebarIsPinned() : true);
    }

    // 사이드바가 머리글 바로 아래에서 시작하도록 머리글 높이를 CSS 변수로 알려준다
    const headerEl = container.querySelector('header');
    const setHeaderH = () => document.documentElement.style.setProperty('--header-h', `${container.getBoundingClientRect().height || headerEl?.offsetHeight || 0}px`);
    setHeaderH();
    setTimeout(setHeaderH, 300); // 스타일이 늦게 입혀져 처음 잰 높이가 틀린 경우
    if (window.ResizeObserver && headerEl) new ResizeObserver(setHeaderH).observe(headerEl);

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

    const logoHome = container.querySelector('#btn-header-home-logo');
    logoHome?.addEventListener('click', navigateToHome);
    logoHome?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToHome(); } });

    container.querySelector('#global-worker-select')?.addEventListener('change', (e) => {
        onWorkerChange(e.target.value);
    });

    // 헤더 상단 환경설정 버튼 클릭 -> 환경설정 탭으로 이동
    container.querySelector('#btn-open-settings')?.addEventListener('click', () => {
        onTabChange('settings');
    });

    // 로그아웃 클릭 이벤트
    const installBtn = container.querySelector('#btn-pwa-install');
    installBtn?.addEventListener('click', () => window.__triggerPwaInstall?.());
    // 설치 가능 여부가 바뀌면(설치 창 준비·설치 완료) 버튼을 보이거나 숨긴다
    const offInstall = onInstallChange(() => {
        if (!document.body.contains(installBtn)) { offInstall(); return; }
        installBtn.classList.toggle('hidden', !installMode());
    });

    mountOfflineStatus(container.querySelector('#btn-offline-status'));

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
