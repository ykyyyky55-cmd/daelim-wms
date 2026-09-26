import { state } from '../services/db.js';
import { canAccessTab } from '../services/auth.js';
import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';

// 전체 15개 메뉴 마스터 정의
export const ALL_MENU_ITEMS = [
    { id: 'home', icon: 'home', label: '홈 (대시보드)', category: '메인', desc: '실시간 재고 현황 및 위젯 대시보드' },
    { id: 'hqLog', icon: 'clipboard-list', label: '업무일지(본사)', category: '생산·공급', desc: '본사 일일 포장/원액/이동/입출고 실적 원장' },
    { id: 'gimpoLog', icon: 'clipboard-list', label: '업무일지(김포)', category: '생산·공급', desc: '김포 일일 포장/원액/이동/입출고 실적 원장' },
    { id: 'prodSchedule', icon: 'calendar-range', label: '생산(포장) 스케줄', category: '생산·공급', desc: '작성일자별 본사·김포 포장 SCHEDULE (예전 날짜별 엑셀 시트)' },
    { id: 'production', icon: 'factory', label: '제품생산 / 입고', category: '생산·공급', desc: 'BOM 배합비 자동 연동 생산 및 입고' },
    { id: 'secureWorkOrders', icon: 'flask-round', label: '원액생산 작업지시서 🔒', category: '생산·공급', desc: '특별보안: 제조시방서·작업지시서 (마스터·작업일지 관리자 전용)' },
    { id: 'scan', icon: 'scan-line', label: '현장 스캔 / 작업', category: '물류·작업', desc: 'QR 및 바코드 모바일 카메라 스캔' },
    { id: 'oilcalc', icon: 'flask-conical', label: '비중·오일 계산기', category: 'TOOL', desc: '온도별 비중 환산 및 블렌딩 계산' },
    { id: 'lubCalc', icon: 'droplets', label: '윤활유 충진 보정계산기', category: 'TOOL', desc: '충진 용량/중량 환산 및 노즐별 오차 보정 (AI 스캔)' },
    { id: 'calc', icon: 'calculator', label: '전자계산기', category: 'TOOL', desc: '사칙연산·괄호·%·메모리·계산 기록' },
    { id: 'unitConv', icon: 'ruler', label: '단위환산계산기', category: 'TOOL', desc: '길이·무게·부피·넓이·온도·압력·속도·비중 환산' },
    { id: 'fxCalc', icon: 'coins', label: '환율계산기', category: 'TOOL', desc: '무료 공개 환율로 통화 환산 (수수료 보정)' },
    { id: 'label', icon: 'tag', label: '라벨·파렛트식별표', category: '출하·인쇄', desc: 'Formtec 3120/3130 규격 바코드 인쇄' },
    { id: 'labelDesigner', icon: 'pen-tool', label: '라벨 만들기', category: '출하·인쇄', desc: '폼텍 라벨 용지 선택·양식 디자인·저장·인쇄' },
    { id: 'master', icon: 'layout-grid', label: '품목 마스터 관리', category: '기준정보', desc: '대분류·중분류 분리 2,884종 품목 마스터' },
    { id: 'inventory', icon: 'database', label: '창고 재고 현황', category: '재고·물류', desc: '거점별 실시간 품목 보관 수량' },
    { id: 'docScan', icon: 'scan-text', label: '전표 스캔 등록', category: '재고·물류', desc: '인쇄된 전표를 찍어 글자 인식 → 확인 후 입고/출고 등록' },
    { id: 'rawLedger', icon: 'cylinder', label: '원료 수불부', category: '원장·정산', desc: '원료·원액 수·불·재고(L/KG/비중) 누적 원장' },
    { id: 'productLedger', icon: 'package-check', label: '제품 수불부', category: '원장·정산', desc: '완제품 수·불·재고 누적 원장' },
    { id: 'ledgerViewer', icon: 'library', label: '수불부 조회·인쇄', category: '원장·정산', desc: '원료·제품·자재 수불부 기간 조회·A4 인쇄·엑셀' },
    { id: 'audit', icon: 'clipboard-check', label: '재고실사 / 조사', category: '재고·물류', desc: '전수/표본 실사 및 오차 보정' },
    { id: 'ledger', icon: 'book-open-check', label: '자재 수불부', category: '원장·정산', desc: '부자재·소모품·기타 수·불·재고 누적 원장' },
    { id: 'calendar', icon: 'calendar', label: '수불·입출고 캘린더', category: '원장·정산', desc: '월간 일정 및 일자별 입출고 달력' },
    { id: 'analytics', icon: 'bar-chart-3', label: '월간 실적 현황판', category: '통계·분석', desc: '김포공장 업무일지 월별 종합 실적' },
    { id: 'planning', icon: 'calculator', label: '발주·생산 검토', category: '경영·기획', desc: '적정 재고 분석 및 원료 소요량 예측' },
    { id: 'history', icon: 'history', label: '전체 작업·감사 이력', category: '감사·보안', desc: '모든 입출고 및 수정 감사 로그' },
    { id: 'settings', icon: 'settings', label: '환경설정', category: '시스템', desc: '사용자 권한, 클라우드 연동, 백업' }
];

// 상단 내비게이션(Header.js)에서 드롭다운으로 묶은 메뉴와 같은 그룹.
// 사이드바에서도 같은 구성으로 하나의 펼침 메뉴로 묶어서 보여준다.
const NAV_DROPDOWN_GROUPS = [
    { id: 'worklogGroup', label: '업무일지(생산)', icon: 'clipboard-list', memberIds: ['hqLog', 'gimpoLog'] },
    { id: 'stock', label: '품목 및 재고관리', icon: 'boxes', memberIds: ['master', 'inventory', 'docScan', 'rawLedger', 'productLedger', 'ledger', 'ledgerViewer', 'calendar'] },
    { id: 'tool', label: 'TOOL', icon: 'wrench', memberIds: ['oilcalc', 'lubCalc', 'calc', 'unitConv', 'fxCalc'] },
    { id: 'labelGroup', label: '라벨', icon: 'tag', memberIds: ['label', 'labelDesigner'] }
];
const groupOfMenuId = (id) => NAV_DROPDOWN_GROUPS.find(g => g.memberIds.includes(id));

// 기본 사이드바 핀(고정) 메뉴 ID 목록
export const DEFAULT_PINNED_MENUS = [
    'home',
    'hqLog',
    'gimpoLog',
    'prodSchedule',
    'label',
    'labelDesigner',
    'master',
    'inventory',
    'docScan',
    'ledger',
    'analytics'
];

export const getPinnedMenus = () => {
    try {
        const saved = localStorage.getItem('daelim_sidebar_menu_pins');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                // 새로 생긴 메뉴는 핀 목록이 저장된 뒤라도 관련 메뉴 옆에 한 번만 끼워 넣는다 (그 뒤 사용자가 빼면 그대로 둠)
                for (const [id, after] of [['labelDesigner', 'label'], ['docScan', 'inventory'], ['prodSchedule', 'gimpoLog'], ['hqLog', '^gimpoLog']]) {
                    // '^이름'은 그 메뉴 바로 앞에 끼워 넣는다
                    const before = after.startsWith('^');
                    const ref = before ? after.slice(1) : after;
                    const flag = `daelim_sidebar_pin_${id}`;
                    if (!localStorage.getItem(flag) && parsed.includes(ref) && !parsed.includes(id)) {
                        parsed.splice(parsed.indexOf(ref) + (before ? 0 : 1), 0, id);
                        localStorage.setItem('daelim_sidebar_menu_pins', JSON.stringify(parsed));
                    }
                    localStorage.setItem(flag, '1');
                }
                return parsed;
            }
        }
    } catch {}
    return [...DEFAULT_PINNED_MENUS];
};

export const savePinnedMenus = (menus) => {
    try {
        localStorage.setItem('daelim_sidebar_menu_pins', JSON.stringify(menus));
    } catch (e) {
        console.warn('사이드바 핀 저장 실패', e);
    }
};

export const renderSidebar = (container, { currentTab = 'home', onTabChange }) => {
    // PC: 사이드바는 '고정(펼친 채 화면 차지)' 또는 '숨김'. 숨김일 때 상단 ☰ 버튼에 커서를 올리면 잠깐 펼쳐지고(peek),
    // 커서를 치우면 위로 접혀 사라진다. ☰ 버튼 클릭 = 고정 ↔ 숨김 (daelim_sidebar_pinned)
    const isCollapsed = false; // 예전 72px 접힘 모드는 쓰지 않음 (메뉴 이름 항상 표시)
    let isPinned = localStorage.getItem('daelim_sidebar_pinned') !== 'false';
    let isPeek = false;
    let peekTimer = null;
    let isMobileOpen = false;
    let pinnedMenuIds = getPinnedMenus();
    // 펼쳐진 드롭다운 그룹(현재 탭이 속한 그룹은 항상 펼쳐서 보여준다)
    let expandedGroupIds = new Set(NAV_DROPDOWN_GROUPS.filter(g => g.memberIds.includes(currentTab)).map(g => g.id));

    const currentUser = state.currentUser || { role: 'VIEWER' };

    const render = () => {
        // 상단 메뉴 줄의 ☰ 버튼 칸이 사이드바 폭과 같도록 CSS 변수로 알려준다 (Header.js)
        document.documentElement.style.setProperty('--sidebar-w', '240px');
        document.documentElement.dataset.sidebarPinned = isPinned ? '1' : '0';
        window.dispatchEvent(new CustomEvent('sidebar:state', { detail: { pinned: isPinned } }));
        // 권한 있는 메뉴만 필터링
        const accessibleMenus = ALL_MENU_ITEMS.filter(m => canAccessTab(m.id, currentUser.role));
        const activePinnedMenus = accessibleMenus.filter(m => pinnedMenuIds.includes(m.id));
        NAV_DROPDOWN_GROUPS.forEach(g => { if (g.memberIds.includes(currentTab)) expandedGroupIds.add(g.id); });

        // 고정 메뉴를 그룹(품목 및 재고관리 / TOOL)과 일반 메뉴로 나눠서, 그룹에 속한
        // 메뉴는 상단 내비게이션과 같은 구성의 펼침 메뉴 하나로 묶어 보여준다.
        const renderedGroupIds = new Set();
        const pinnedRenderItems = [];
        activePinnedMenus.forEach(m => {
            const group = groupOfMenuId(m.id);
            if (!group) { pinnedRenderItems.push({ type: 'item', menu: m }); return; }
            if (renderedGroupIds.has(group.id)) return;
            renderedGroupIds.add(group.id);
            const members = accessibleMenus.filter(x => group.memberIds.includes(x.id) && pinnedMenuIds.includes(x.id));
            pinnedRenderItems.push({ type: 'group', group, members });
        });

        // 일반 메뉴 버튼 (nested: 그룹 펼침 목록 안에 들어갈 때 들여쓰기)
        const menuButtonHtml = (m, nested = false) => {
            const isActive = m.id === currentTab;
            return `
            <button type="button" data-sidebar-tab="${esc(m.id)}" class="sidebar-item w-full flex items-center gap-3 ${nested ? 'pl-8 pr-3' : 'px-3'} py-2.5 rounded-xl text-xs font-bold transition group ${
                isActive
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }" title="${esc(m.label)} - ${esc(m.desc)}">
                <i data-lucide="${m.icon}" class="w-4 h-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-blue-400'}"></i>
                ${!isCollapsed ? `
                    <span class="truncate text-left flex-1">${esc(m.label)}</span>
                    ${m.id === 'gimpoLog' ? `<span class="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" title="실시간 연동중"></span>` : ''}
                ` : ''}
            </button>
            `;
        };

        // 드롭다운 그룹 (상단 내비게이션의 '품목 및 재고관리'/'TOOL' 드롭다운과 같은 구성).
        // 펼쳐지면 그 그룹에 고정된 하위 메뉴만 들여써서 보여준다.
        const groupHtml = (group, members) => {
            const isExpanded = expandedGroupIds.has(group.id);
            const isGroupActive = group.memberIds.includes(currentTab);
            const header = `
            <button type="button" data-sidebar-group-toggle="${esc(group.id)}" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition group ${
                isGroupActive
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }" title="${esc(group.label)}">
                <i data-lucide="${group.icon}" class="w-4 h-4 flex-shrink-0 ${isGroupActive ? 'text-white' : 'text-slate-400 group-hover:text-blue-400'}"></i>
                ${!isCollapsed ? `
                    <span class="truncate text-left flex-1">${esc(group.label)}</span>
                    <i data-lucide="${isExpanded ? 'chevron-up' : 'chevron-down'}" class="w-3.5 h-3.5 flex-shrink-0"></i>
                ` : ''}
            </button>
            `;
            const body = (!isCollapsed && isExpanded) ? members.map(m => menuButtonHtml(m, true)).join('') : '';
            return header + body;
        };

        container.innerHTML = `
        <!-- 모바일 백드롭 오버레이 -->
        <div id="sidebar-backdrop" class="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 transition-opacity duration-300 md:hidden ${isMobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}"></div>

        <!-- 사이드바 본체 -->
        <!-- PC: 고정이면 머리글 아래에 붙어 화면을 차지(sticky), 숨김이면 화면 위에 떠서(fixed) 위에서 펼쳐지고 위로 접힌다 -->
        <aside id="sidebar-aside" style="--hh: var(--header-h, 0px)" class="fixed top-0 left-0 h-screen bg-slate-900 text-slate-300 z-50 flex flex-col justify-between border-r border-slate-800 transition-all duration-200 shadow-2xl w-72 md:w-60 md:top-[var(--hh)] md:h-[calc(100vh-var(--hh))] md:origin-top ${
            isPinned ? 'md:sticky md:z-20 md:shadow-none md:translate-x-0' : `md:fixed md:z-30 md:translate-x-0 ${isPeek ? 'md:scale-y-100 md:opacity-100' : 'md:scale-y-0 md:opacity-0 md:pointer-events-none'}`
        } ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}">
            
            <!-- 상단: 로고 및 토글 바 -->
            <div class="p-3.5 border-b border-slate-800 flex items-center justify-between">
                <div class="flex items-center gap-3 overflow-hidden cursor-pointer" id="btn-sidebar-logo">
                    <div class="h-9 px-1.5 flex items-center justify-center flex-shrink-0">
                        <img src="./logo-white.png" alt="대림" class="h-7 w-auto object-contain" />
                    </div>
                    ${!isCollapsed ? `
                        <div class="truncate">
                            <h2 class="text-xs font-black text-white tracking-tight leading-tight">대림오일 스마트 WMS</h2>
                            <span class="text-[10px] font-bold text-blue-400">사이드바 퀵 메뉴</span>
                        </div>
                    ` : ''}
                </div>

                <!-- 모바일 닫기 버튼 -->
                <button type="button" id="btn-sidebar-mobile-close" class="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition min-w-11 min-h-11 inline-flex items-center justify-center">
                    <i data-lucide="x" class="w-5 h-5"></i>
                </button>
            </div>

            <!-- 중앙: 고정(Pinned) 메뉴 목록 -->
            <div class="flex-1 overflow-y-auto py-3 px-2 space-y-1 scrollbar-thin">
                <div class="px-2 py-1 text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center justify-between">
                    ${!isCollapsed ? `<span>즐겨찾는 메뉴 (${activePinnedMenus.length})</span>` : `<span>메뉴</span>`}
                    <button type="button" id="btn-open-menu-config" class="text-blue-400 hover:text-blue-300 font-bold hover:underline flex items-center gap-0.5" title="사이드바 메뉴 편집">
                        <i data-lucide="settings-2" class="w-3.5 h-3.5"></i>
                        ${!isCollapsed ? `<span>편집</span>` : ''}
                    </button>
                </div>

                ${pinnedRenderItems.map(entry => entry.type === 'group' ? groupHtml(entry.group, entry.members) : menuButtonHtml(entry.menu, false)).join('')}

                ${activePinnedMenus.length === 0 ? `
                    <div class="p-3 text-center text-xs text-slate-500">
                        설정된 메뉴가 없습니다.<br>
                        <button type="button" id="btn-add-first-menu" class="mt-2 text-blue-400 font-bold underline">메뉴 추가하기</button>
                    </div>
                ` : ''}
            </div>

            <!-- 하단: 사이드바 접기/펼기 & 메뉴 추가 설정 버튼 -->
            <div class="p-2.5 border-t border-slate-800 space-y-1">
                <!-- 메뉴 편집/삽입 버튼 -->
                <button type="button" id="btn-bottom-menu-config" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition">
                    <i data-lucide="plus-circle" class="w-4 h-4 text-emerald-400 flex-shrink-0"></i>
                    ${!isCollapsed ? `<span class="truncate">원하는 메뉴 삽입 / 관리</span>` : ''}
                </button>

                <!-- 데스크톱 전용 접기/펼기 토글 버튼 -->
                <button type="button" id="btn-toggle-sidebar-collapse" class="hidden md:flex w-full items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition" title="${isPinned ? '사이드바 고정 풀기 (숨기기)' : '사이드바 고정'}">
                    <i data-lucide="${isPinned ? 'pin-off' : 'pin'}" class="w-4 h-4 flex-shrink-0"></i>
                    <span>${isPinned ? '사이드바 고정 풀기 (숨기기)' : '사이드바 고정하기'}</span>
                </button>
            </div>
        </aside>

        <!-- 사이드바 메뉴 편집 모달 -->
        <div id="modal-sidebar-menu-config" class="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 hidden flex items-center justify-center p-4 no-print">
            <div class="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 border border-slate-200 text-slate-800 space-y-4">
                <div class="flex items-center justify-between border-b pb-3">
                    <div>
                        <h3 class="text-base font-black text-slate-900 flex items-center gap-2">
                            <i data-lucide="layout-list" class="w-5 h-5 text-blue-600"></i>
                            <span>사이드바 원하는 메뉴 삽입 및 관리</span>
                        </h3>
                        <p class="text-xs text-slate-500 mt-0.5">사이드바에 항상 고정(Pin)해 둘 메뉴를 체크하세요.</p>
                    </div>
                    <button type="button" id="btn-close-menu-config" class="text-slate-400 hover:text-slate-600 text-xl font-bold">&times;</button>
                </div>

                <div class="max-h-80 overflow-y-auto space-y-2 pr-1 divide-y divide-slate-100 scrollbar-thin">
                    ${accessibleMenus.map(m => {
                        const isPinned = pinnedMenuIds.includes(m.id);
                        return `
                        <label class="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 cursor-pointer transition">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                                    <i data-lucide="${m.icon}" class="w-4 h-4"></i>
                                </div>
                                <div>
                                    <div class="text-xs font-bold text-slate-900">${esc(m.label)}</div>
                                    <div class="text-[10px] text-slate-400">${esc(m.desc)}</div>
                                </div>
                            </div>
                            <input type="checkbox" class="chk-menu-pin w-4 h-4 accent-blue-600 rounded cursor-pointer" data-id="${esc(m.id)}" ${isPinned ? 'checked' : ''} />
                        </label>
                        `;
                    }).join('')}
                </div>

                <div class="flex items-center justify-between pt-3 border-t">
                    <button type="button" id="btn-reset-default-pins" class="text-xs text-slate-500 hover:text-slate-800 font-bold underline">
                        기본 추천 메뉴로 복원
                    </button>
                    <div class="flex items-center gap-2">
                        <button type="button" id="btn-cancel-menu-config" class="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold">
                            취소
                        </button>
                        <button type="button" id="btn-save-menu-config" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black shadow-sm">
                            저장 적용
                        </button>
                    </div>
                </div>
            </div>
        </div>
        `;

        createIcons({ icons });

        // 이벤트 리스너 바인딩
        // 메뉴 클릭 시 탭 이동
        container.querySelectorAll('.sidebar-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.getAttribute('data-sidebar-tab');
                if (onTabChange) onTabChange(tabId);
                // 모바일이면 닫기
                if (isMobileOpen) {
                    isMobileOpen = false;
                    render();
                }
            });
        });

        // 드롭다운 그룹 펼치기/접기 (사이드바가 접혀있으면 펼침 목록을 보여줄 수 없으므로 펼치기 대신 펼치기)
        container.querySelectorAll('[data-sidebar-group-toggle]').forEach(btn => {
            btn.addEventListener('click', () => {
                const groupId = btn.getAttribute('data-sidebar-group-toggle');
                if (expandedGroupIds.has(groupId)) expandedGroupIds.delete(groupId);
                else expandedGroupIds.add(groupId);
                render();
            });
        });

        // 로고 클릭 -> 홈 이동
        container.querySelector('#btn-sidebar-logo')?.addEventListener('click', () => {
            if (onTabChange) onTabChange('home');
            if (isMobileOpen) {
                isMobileOpen = false;
                render();
            }
        });

        // PC: 고정 ↔ 숨김 (하단 버튼)
        container.querySelector('#btn-toggle-sidebar-collapse')?.addEventListener('click', () => setPinned(!isPinned));

        // 숨김 상태에서 펼쳐진 사이드바에 커서가 있으면 계속 보이고, 벗어나면 위로 접는다
        const aside = container.querySelector('#sidebar-aside');
        aside?.addEventListener('mouseenter', () => { if (!isPinned) setPeek(true); });
        aside?.addEventListener('mouseleave', () => { if (!isPinned) setPeek(false, 250); });

        // 모바일 백드롭 및 닫기 버튼
        container.querySelector('#sidebar-backdrop')?.addEventListener('click', () => {
            isMobileOpen = false;
            render();
        });
        container.querySelector('#btn-sidebar-mobile-close')?.addEventListener('click', () => {
            isMobileOpen = false;
            render();
        });

        // 모달 열기/닫기
        const modal = container.querySelector('#modal-sidebar-menu-config');
        const openConfigModal = () => {
            if (modal) modal.classList.remove('hidden');
        };
        const closeConfigModal = () => {
            if (modal) modal.classList.add('hidden');
        };

        container.querySelector('#btn-open-menu-config')?.addEventListener('click', openConfigModal);
        container.querySelector('#btn-bottom-menu-config')?.addEventListener('click', openConfigModal);
        container.querySelector('#btn-add-first-menu')?.addEventListener('click', openConfigModal);
        container.querySelector('#btn-close-menu-config')?.addEventListener('click', closeConfigModal);
        container.querySelector('#btn-cancel-menu-config')?.addEventListener('click', closeConfigModal);

        // 기본 추천 메뉴 복원
        container.querySelector('#btn-reset-default-pins')?.addEventListener('click', () => {
            pinnedMenuIds = [...DEFAULT_PINNED_MENUS];
            savePinnedMenus(pinnedMenuIds);
            closeConfigModal();
            render();
        });

        // 핀 메뉴 저장
        container.querySelector('#btn-save-menu-config')?.addEventListener('click', () => {
            const checkedIds = [];
            container.querySelectorAll('.chk-menu-pin:checked').forEach(chk => {
                checkedIds.push(chk.getAttribute('data-id'));
            });
            if (checkedIds.length === 0) {
                alert('최소 1개 이상의 메뉴를 선택해주세요.');
                return;
            }
            pinnedMenuIds = checkedIds;
            savePinnedMenus(pinnedMenuIds);
            closeConfigModal();
            render();
        });
    };

    // 외부에서 모바일 드로어를 열 수 있는 글로벌 메서드
    window.__openMobileSidebar = () => {
        isMobileOpen = true;
        render();
    };

    // PC 숨김 상태의 잠깐 펼치기 (다시 그리지 않고 클래스만 바꿔 스크롤 위치 유지). delay: 접기 전 대기(ms)
    function setPeek(open, delay = 0) {
        clearTimeout(peekTimer);
        const apply = () => {
            isPeek = open;
            const a = container.querySelector('#sidebar-aside');
            if (!a || isPinned) return;
            // 클래스 대신 인라인 스타일 (Tailwind CDN이 처음 쓰는 클래스를 늦게 만들어 첫 펼침이 안 되던 문제)
            a.style.transform = open ? 'scaleY(1)' : '';
            a.style.opacity = open ? '1' : '';
            a.style.pointerEvents = open ? 'auto' : '';
        };
        if (delay) peekTimer = setTimeout(apply, delay); else apply();
    }
    function setPinned(v) {
        isPinned = v;
        isPeek = false;
        localStorage.setItem('daelim_sidebar_pinned', String(v));
        render();
    }
    window.__sidebarPeek = (open, delay = 0) => { if (!isPinned && window.innerWidth >= 768) setPeek(open, delay); };
    window.__sidebarTogglePin = () => setPinned(!isPinned);
    window.__sidebarIsPinned = () => isPinned;

    // 외부에서 사이드바를 토글할 수 있는 글로벌 메서드 (스마트폰: 서랍 열기/닫기, PC: 고정 ↔ 숨김)
    window.__toggleSidebar = () => {
        if (window.innerWidth < 768) {
            isMobileOpen = !isMobileOpen;
            render();
        } else {
            setPinned(!isPinned);
        }
    };

    render();
};
