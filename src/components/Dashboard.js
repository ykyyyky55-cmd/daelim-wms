import { state, processStockAction, toggleScheduleStatus } from '../services/db.js';
import { drawQrOnCanvas } from '../services/qrCode.js';
import { createIcons, icons } from '../services/icons.js';
import { searchMasterItems, localDateStr, toDateKey } from '../services/searchUtils.js';
import { GOOGLE_AUDIT_URL } from './AuditManager.js';
import { locationOptionsHtml } from '../services/locations.js';
import { esc } from '../services/html.js';
import { canAccessTab } from '../services/auth.js';
import { TAB_META } from './navMenu.js';

// 스마트폰 퀵 런처 전체 메뉴 바로가기 정의 (모든 메뉴를 아이콘으로 추가/제거할 수 있도록 전 메뉴 포함)
export const ALL_DASHBOARD_SHORTCUTS = [
    { id: 'gimpoLog', label: '김포 업무일지', icon: 'clipboard-list', gradient: 'from-emerald-500 to-teal-600', shadow: 'shadow-emerald-500/25', desc: '일일 포장/원액/이동 실적' },
    { id: 'scan', label: '현장 스캔', icon: 'scan-line', gradient: 'from-purple-500 to-indigo-600', shadow: 'shadow-purple-500/25', desc: 'QR/바코드 모바일 카메라 스캔' },
    { id: 'palletLabel', label: '파렛트식별표', icon: 'tag', gradient: 'from-amber-500 to-orange-600', shadow: 'shadow-amber-500/25', desc: '카밈 3130 규격 즉시 출력' },
    { id: 'productionHq', label: '본사 생산입고', icon: 'factory', gradient: 'from-indigo-600 to-blue-700', shadow: 'shadow-indigo-500/25', desc: '본사 제품·원액 생산 입고 등록' },
    { id: 'production', label: '김포 생산입고', icon: 'factory', gradient: 'from-blue-600 to-cyan-600', shadow: 'shadow-blue-500/25', desc: '김포 제품·원액 생산 입고 등록' },
    { id: 'secureWorkOrders', label: '원액작업지시서', icon: 'flask-round', gradient: 'from-amber-700 to-orange-800', shadow: 'shadow-amber-700/25', desc: '제조시방서·작업지시서(특별보안)' },
    { id: 'inventory', label: '창고 재고현황', icon: 'database', gradient: 'from-cyan-600 to-blue-700', shadow: 'shadow-cyan-500/25', desc: '거점별 실시간 품목 보관고' },
    { id: 'rawLedger', label: '원료 수불부', icon: 'cylinder', gradient: 'from-emerald-600 to-teal-800', shadow: 'shadow-emerald-500/25', desc: '원료·원액 수·불·재고 원장' },
    { id: 'ledger', label: '자재 수불부', icon: 'book-open-check', gradient: 'from-indigo-600 to-violet-700', shadow: 'shadow-indigo-500/25', desc: '부자재·소모품 수불 원장' },
    { id: 'productLedger', label: '제품 수불부', icon: 'package-check', gradient: 'from-sky-600 to-indigo-700', shadow: 'shadow-sky-500/25', desc: '완제품 수불 원장' },
    { id: 'ledgerViewer', label: '수불부 조회·인쇄', icon: 'library', gradient: 'from-indigo-800 to-slate-900', shadow: 'shadow-indigo-500/25', desc: '원료·제품·자재 조회·인쇄' },
    { id: 'analytics', label: '월간 실적현황', icon: 'bar-chart-3', gradient: 'from-rose-500 to-pink-600', shadow: 'shadow-rose-500/25', desc: '김포공장 업무일지 월별 집계' },
    { id: 'oilcalc', label: '비중·오일계산', icon: 'flask-conical', gradient: 'from-teal-500 to-emerald-600', shadow: 'shadow-teal-500/25', desc: '온도별 비중 환산 및 배합' },
    { id: 'lubCalc', label: '윤활유 보정계산', icon: 'droplets', gradient: 'from-sky-500 to-blue-700', shadow: 'shadow-sky-500/25', desc: '충진 용량/중량 환산 및 오차 보정' },
    { id: 'master', label: '품목마스터', icon: 'layout-grid', gradient: 'from-slate-700 to-slate-900', shadow: 'shadow-slate-500/25', desc: '대분류·중분류 2,884종 마스터' },
    { id: 'audit', label: '재고 실사조사', icon: 'clipboard-check', gradient: 'from-violet-500 to-purple-700', shadow: 'shadow-violet-500/25', desc: '전수/표본 실사 및 오차 보정' },
    { id: 'calendar', label: '입출고 캘린더', icon: 'calendar', gradient: 'from-amber-600 to-yellow-600', shadow: 'shadow-amber-500/25', desc: '월간 일정 및 일자별 입출고 달력' },
    { id: 'planning', label: '발주·생산검토', icon: 'calculator', gradient: 'from-blue-500 to-indigo-500', shadow: 'shadow-blue-500/25', desc: '적정재고 분석 및 소요량 예측' },
    { id: 'history', label: '작업/감사 이력', icon: 'history', gradient: 'from-slate-600 to-slate-800', shadow: 'shadow-slate-500/25', desc: '모든 입출고 및 수정 감사 로그' },
    { id: 'settings', label: '시스템 설정', icon: 'settings', gradient: 'from-gray-600 to-gray-800', shadow: 'shadow-gray-500/25', desc: '사용자 및 데이터베이스 설정' }
];

// 위 목록에 없는 메뉴(새로 생긴 메뉴 포함)도 모두 앱 아이콘으로 쓸 수 있게 메뉴 정의(navMenu.js)에서 만든다
const EXTRA_GRADIENTS = [
    ['from-blue-500 to-indigo-600', 'shadow-blue-500/25'], ['from-emerald-500 to-green-700', 'shadow-emerald-500/25'],
    ['from-orange-500 to-red-600', 'shadow-orange-500/25'], ['from-fuchsia-500 to-purple-700', 'shadow-fuchsia-500/25'],
    ['from-cyan-500 to-sky-700', 'shadow-cyan-500/25'], ['from-lime-500 to-emerald-700', 'shadow-lime-500/25'],
    ['from-rose-500 to-red-700', 'shadow-rose-500/25'], ['from-yellow-500 to-amber-700', 'shadow-yellow-500/25'],
    ['from-teal-500 to-cyan-700', 'shadow-teal-500/25'], ['from-violet-500 to-indigo-700', 'shadow-violet-500/25']
];
Object.entries(TAB_META).filter(([id]) => id !== 'home' && !ALL_DASHBOARD_SHORTCUTS.some(s => s.id === id)).forEach(([id, m], i) => {
    const [gradient, shadow] = EXTRA_GRADIENTS[i % EXTRA_GRADIENTS.length];
    ALL_DASHBOARD_SHORTCUTS.push({ id, label: m.label.replace(/\s*🔒/, ''), icon: m.icon, gradient, shadow, desc: m.desc });
});

// 바로가기를 보여줄지: 그 메뉴에 들어갈 권한이 있을 때만 (파렛트식별표는 라벨 메뉴 권한)
const canShowShortcut = (id) => canAccessTab(id === 'palletLabel' ? 'label' : id);

export const DEFAULT_DASHBOARD_SHORTCUTS = [
    'gimpoLog',
    'scan',
    'palletLabel',
    'inventory',
    'ledger',
    'analytics',
    'production',
    'oilcalc'
];

export const getDashboardShortcuts = () => {
    try {
        const saved = localStorage.getItem('daelim_dashboard_shortcuts');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch {}
    return [...DEFAULT_DASHBOARD_SHORTCUTS];
};

export const saveDashboardShortcuts = (shortcuts) => {
    try {
        localStorage.setItem('daelim_dashboard_shortcuts', JSON.stringify(shortcuts));
    } catch (e) {
        console.warn('대시보드 바로가기 저장 실패', e);
    }
};

// 홈 위젯 목록(모든 메뉴를 위젯으로도 추가/제거할 수 있도록 전 메뉴급 요약 위젯 포함).
// 순서(order)·크기(sizes: sm/md/lg)·숨김(hidden)을 사용자가 위젯 편집 모드에서 바꿀 수 있다.
// 기본 순서: 오늘 처리할 것(입출고·안전재고) → 실적·품질·일정·이력 → 수불부 요약 → 바로 가는 안내 카드(앱 설치·재고실사·식별표·계산기)
export const WIDGET_DEFS = [
    { id: 'quickAction', label: '빠른 입출고 등록', defaultSize: 'md' },
    { id: 'lowSafety', label: '안전재고 부족', defaultSize: 'md' },
    { id: 'gimpoProd', label: '김포공장 업무일지 실적', defaultSize: 'lg' },
    { id: 'qcBoard', label: '품질관리 현황판', defaultSize: 'lg' },
    { id: 'calendarWidget', label: '일정 캘린더', defaultSize: 'lg' },
    { id: 'history', label: '최근 작업 이력', defaultSize: 'lg' },
    { id: 'rawLedgerSummary', label: '원료 수불부 요약', defaultSize: 'sm' },
    { id: 'productLedgerSummary', label: '제품 수불부 요약', defaultSize: 'sm' },
    { id: 'materialLedgerSummary', label: '자재 수불부 요약', defaultSize: 'sm' },
    { id: 'qr', label: '스마트폰 앱 설치 QR', defaultSize: 'sm' },
    { id: 'googleAudit', label: '거점별 온라인 재고실사', defaultSize: 'sm' },
    { id: 'palletLabel', label: '파렛트 식별표 발행', defaultSize: 'sm' },
    { id: 'oilcalc', label: '비중·용량 환산 계산기', defaultSize: 'lg' }
];
const DEFAULT_WIDGET_ORDER = WIDGET_DEFS.map(w => w.id);
const WIDGET_COL_SPAN = { sm: 4, md: 6, lg: 12 };

export const getWidgetLayout = () => {
    let layout = { order: [...DEFAULT_WIDGET_ORDER], sizes: {}, hidden: [] };
    try {
        const saved = JSON.parse(localStorage.getItem('daelim_dashboard_widgets') || 'null');
        if (saved && typeof saved === 'object') {
            layout = {
                order: Array.isArray(saved.order) ? saved.order : layout.order,
                sizes: saved.sizes && typeof saved.sizes === 'object' ? saved.sizes : {},
                hidden: Array.isArray(saved.hidden) ? saved.hidden : []
            };
        }
    } catch {}
    // 새로 추가된 위젯이 저장된 순서 목록에 없으면 뒤에 이어붙인다
    DEFAULT_WIDGET_ORDER.forEach(id => { if (!layout.order.includes(id)) layout.order.push(id); });
    return layout;
};

export const saveWidgetLayout = (layout) => {
    try {
        localStorage.setItem('daelim_dashboard_widgets', JSON.stringify(layout));
    } catch (e) {
        console.warn('위젯 레이아웃 저장 실패', e);
    }
};

let autoRefreshTimer = null;
let widgetEditMode = false; // 위젯 편집 모드(드래그 순서 변경·크기·숨김 조절 컨트롤 표시)
let dragWidgetId = null; // 드래그로 옮기는 중인 위젯 id

export const renderDashboard = (container, { onSwitchTab, onOpenModal, showToast }) => {
    // 이전 자동 새로고침 타이머 정리
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }

    // 스마트폰(가로 768px 미만, Sidebar.js의 모바일 드로어 기준과 동일)에서는 위젯 없이
    // 아이콘 런처만 있는 깨끗한 홈 화면을 보여준다. 좌측 상단 세줄(☰) 버튼(Header.js)을
    // 누르면 사이드바 메뉴가 내려와 펼쳐지고, 다시 누르면 접힌다.
    const isMobileLauncher = window.innerWidth < 768;

    const shortcutIds = getDashboardShortcuts();
    // 권한 없는 메뉴(원액 작업지시서 등)는 바로가기에 저장돼 있어도 보이지 않게
    const activeShortcuts = shortcutIds.map(id => ALL_DASHBOARD_SHORTCUTS.find(s => s.id === id)).filter(s => s && canShowShortcut(s.id));
    const widgetLayout = getWidgetLayout();

    const settings = state.dashboardSettings || {
        showKpi: true,
        showQrWidget: true,
        showQuickAction: true,
        showLowSafety: true,
        showCalendarWidget: true,
        showHistory: true,
        showOilCalc: true,
        refreshInterval: 0,
        lowSafetyFilter: 'all',
        historyCount: 5
    };

    // 1. KPI 계산
    const masterCount = state.master.length;
    const totalStock = state.inventory.reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);
    
    // 안전재고 부족 계산 (품목별 창고 합산 재고 vs 안전재고)
    let lowStockItems = state.master.filter(m => {
        const itemStock = state.inventory
            .filter(inv => inv.code === m.code)
            .reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);
        return itemStock <= Number(m.safety);
    });

    if (settings.lowSafetyFilter === 'zero_only') {
        lowStockItems = lowStockItems.filter(m => {
            const itemStock = state.inventory
                .filter(inv => inv.code === m.code)
                .reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);
            return itemStock === 0;
        });
    }

    // 오늘 작업 건수 및 오늘 예정 일정 계산
    const todayPrefix = localDateStr();
    // 기록 일시를 날짜로 바꿔 오늘 것만 센다 (예전: 올해로 시작하는 기록을 모두 오늘로 집계)
    const todayLogs = state.history.filter(h => toDateKey(h.timestamp) === todayPrefix);
    const todaySchedules = state.schedules.filter(s => s.date === todayPrefix);

    const currentTime = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
    const liveAppUrl = window.location.href.includes('localhost') 
        ? 'https://ykyyyky55-cmd.github.io/daelim-wms/' 
        : window.location.href.split('#')[0];

    // 미니 캘린더 대시보드 위젯 데이터 계산
    const calNow = new Date();
    const calYear = calNow.getFullYear();
    const calMonth = calNow.getMonth(); // 0~11
    const calMonthTitle = `${calYear}년 ${calMonth + 1}월`;
    const calFirstDayOfWeek = new Date(calYear, calMonth, 1).getDay(); // 0(일) ~ 6(토)
    const calLastDay = new Date(calYear, calMonth + 1, 0).getDate();
    let selectedDate = todayPrefix;

    // 일자별 이벤트/스케줄 매핑
    const eventMap = {};
    (state.schedules || []).forEach(s => {
        if (!s.date) return;
        if (!eventMap[s.date]) eventMap[s.date] = { schedules: [], inCount: 0, outCount: 0, prodCount: 0 };
        eventMap[s.date].schedules.push(s);
    });
    (state.history || []).forEach(h => {
        const d = toDateKey(h.timestamp); // '2026. 9. 24. 오후 ...' 형식도 'YYYY-MM-DD'로
        if (!d) return;
        if (!eventMap[d]) eventMap[d] = { schedules: [], inCount: 0, outCount: 0, prodCount: 0 };
        if (h.type === 'IN') eventMap[d].inCount++;
        else if (h.type === 'OUT' || h.type === 'USE') eventMap[d].outCount++;
        else if (h.type === 'PROD') eventMap[d].prodCount++;
    });

    const buildCalendarCells = (activeDate) => {
        let cells = [];
        for (let i = 0; i < calFirstDayOfWeek; i++) {
            cells.push(`<div class="h-9 sm:h-10 rounded-xl bg-transparent"></div>`);
        }
        for (let day = 1; day <= calLastDay; day++) {
            const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dateStr === todayPrefix;
            const isSelected = dateStr === activeDate;
            const ev = eventMap[dateStr];
            const hasEvents = ev && (ev.schedules.length > 0 || ev.inCount > 0 || ev.outCount > 0);

            cells.push(`
                <button type="button" class="btn-dash-cal-date relative h-9 sm:h-10 rounded-xl flex flex-col items-center justify-center p-0.5 text-xs font-bold transition border ${
                    isSelected ? 'bg-indigo-600 text-white border-indigo-700 shadow-sm' :
                    isToday ? 'bg-blue-50 text-blue-700 border-blue-300 font-black' :
                    'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                }" data-date="${esc(dateStr)}">
                    <span>${day}</span>
                    ${hasEvents ? `
                        <div class="flex items-center gap-0.5 mt-0.5">
                            ${ev.schedules.length > 0 ? `<span class="w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-indigo-600'}"></span>` : ''}
                            ${ev.inCount > 0 ? `<span class="w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-blue-200' : 'bg-blue-500'}"></span>` : ''}
                            ${ev.outCount > 0 ? `<span class="w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-rose-200' : 'bg-rose-500'}"></span>` : ''}
                        </div>
                    ` : ''}
                </button>
            `);
        }
        return cells.join('');
    };

    const buildAgendaList = (targetDate) => {
        const ev = eventMap[targetDate];
        const schedules = ev?.schedules || [];
        const logs = state.history.filter(h => toDateKey(h.timestamp) === targetDate);

        if (schedules.length === 0 && logs.length === 0) {
            return `
                <div class="p-6 text-center text-slate-400 text-xs">
                    <i data-lucide="calendar-check" class="w-7 h-7 mx-auto text-slate-300 mb-1.5"></i>
                    <span>[${esc(targetDate)}] 등록된 작업 일정 및 수불 실적이 없습니다.</span>
                </div>
            `;
        }

        let html = '';
        if (schedules.length > 0) {
            html += `<div class="text-[11px] font-bold text-indigo-700 mb-1 flex items-center gap-1"><i data-lucide="clock" class="w-3.5 h-3.5"></i><span>예정 작업 일정 (${schedules.length}건)</span></div>`;
            html += schedules.map(s => `
                <div class="p-2.5 rounded-xl bg-white border border-slate-200 text-xs flex items-center justify-between gap-2 shadow-2xs">
                    <div class="flex items-center gap-2">
                        <input type="checkbox" class="chk-toggle-sched rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer" data-id="${esc(s.id)}" ${s.status === 'DONE' ? 'checked' : ''} />
                        <div>
                            <div class="font-bold text-slate-800 ${s.status === 'DONE' ? 'line-through text-slate-400' : ''}">${esc(s.title)}</div>
                            <div class="text-[10px] text-slate-500">${esc(s.itemName || s.itemCode || '-')} | 담당: ${esc(s.worker || '-')}</div>
                        </div>
                    </div>
                    <span class="px-2 py-0.5 rounded text-[10px] font-black ${
                        s.type === 'IN' ? 'bg-blue-100 text-blue-800' :
                        s.type === 'OUT' ? 'bg-rose-100 text-rose-800' :
                        s.type === 'PROD' ? 'bg-amber-100 text-amber-800' :
                        'bg-slate-100 text-slate-700'
                    }">${esc(s.type || '작업')}</span>
                </div>
            `).join('');
        }

        if (logs.length > 0) {
            html += `<div class="text-[11px] font-bold text-emerald-700 mt-2.5 mb-1 flex items-center gap-1"><i data-lucide="check-circle" class="w-3.5 h-3.5"></i><span>현장 수불 완료 실적 (${logs.length}건)</span></div>`;
            html += logs.slice(0, 4).map(l => `
                <div class="p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between">
                    <div>
                        <span class="font-bold text-slate-800">[${esc(l.code)}] ${esc(l.name)}</span>
                        <span class="text-[10px] text-slate-500 ml-1">(${esc(l.fromLoc)} → ${esc(l.toLoc)})</span>
                    </div>
                    <span class="font-black text-blue-600 text-xs">${l.type === 'IN' ? '+' : '-'}${esc(l.qty)} EA</span>
                </div>
            `).join('');
        }
        return html;
    };

    // 위젯 하나를 감싸는 래퍼: 편집 모드일 때 드래그 손잡이·크기 변경·숨기기 컨트롤을 얹는다.
    const widgetWrap = (id, innerHtml) => {
        const size = widgetLayout.sizes[id] || (WIDGET_DEFS.find(w => w.id === id)?.defaultSize || 'lg');
        const colSpan = WIDGET_COL_SPAN[size] || 12;
        const controls = widgetEditMode ? `
            <div class="widget-edit-bar absolute top-2 right-2 z-10 flex items-center gap-1 bg-white/95 backdrop-blur rounded-lg shadow-md border border-slate-300 px-1.5 py-1">
                <span class="widget-drag-handle cursor-move px-1 text-slate-400 hover:text-slate-700" title="드래그해서 순서 바꾸기"><i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i></span>
                <button type="button" class="btn-widget-size px-1.5 py-0.5 rounded text-[10px] font-black text-slate-600 hover:bg-slate-100" data-widget-id="${id}" title="크기 변경 (작게 → 중간 → 크게)">${{ sm: 'S', md: 'M', lg: 'L' }[size]}</button>
                <button type="button" class="btn-widget-hide px-1 text-rose-500 hover:text-rose-700 min-w-11 min-h-11 inline-flex items-center justify-center" data-widget-id="${id}" title="이 위젯 숨기기"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
            </div>
        ` : '';
        return `<div class="widget-wrap relative lg:col-span-${colSpan} ${widgetEditMode ? 'ring-2 ring-dashed ring-indigo-200 rounded-2xl' : ''}" data-widget-id="${id}" ${widgetEditMode ? 'draggable="true"' : ''}>${controls}${innerHtml}</div>`;
    };

    // 원료·제품·자재 수불부처럼 아직 전용 위젯이 없는 메뉴를 위한 간단한 실데이터 요약 카드
    const summaryCardHtml = ({ icon, iconBg, iconText, title, tabId, value, valueLabel, sub }) => `
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col justify-between cursor-pointer hover:border-blue-400 transition" data-goto="${tabId}">
            <div class="flex items-center gap-2 mb-2">
                <div class="w-8 h-8 rounded-lg ${iconBg} ${iconText} flex items-center justify-center flex-shrink-0"><i data-lucide="${icon}" class="w-4 h-4"></i></div>
                <h3 class="font-black text-slate-800 text-xs truncate">${esc(title)}</h3>
            </div>
            <div class="flex items-baseline gap-1.5">
                <span class="text-xl font-black text-slate-900">${Number(value).toLocaleString()}</span>
                <span class="text-[11px] text-slate-500 font-bold">${valueLabel}</span>
            </div>
            ${sub ? `<p class="text-[10px] text-slate-400 mt-1">${esc(sub)}</p>` : ''}
        </div>
    `;

    const rawLedgerMaterialCount = new Set(state.rawLedger.map(r => r.code || r.name)).size;

    // 위젯 머리줄 공통: 작은 아이콘 + 제목(+ 회색 배지), 오른쪽에 그 화면으로 가는 글자 단추
    const widgetHeadHtml = ({ icon, tone, title, badge = '', link = '', goto = '', extra = '' }) => `
        <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div class="flex items-center gap-2 min-w-0">
                <div class="w-7 h-7 rounded-lg ${tone} flex items-center justify-center flex-shrink-0"><i data-lucide="${icon}" class="w-4 h-4"></i></div>
                <h3 class="font-black text-slate-800 text-sm truncate">${title}</h3>
                ${badge ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 whitespace-nowrap">${badge}</span>` : ''}
            </div>
            <div class="flex items-center gap-2">
                ${extra}
                ${link ? `<button type="button" class="text-xs text-blue-600 font-bold hover:underline whitespace-nowrap" data-goto="${goto}">${link} &rarr;</button>` : ''}
            </div>
        </div>`;

    // 바로 가는 안내 카드 (앱 설치 QR · 재고실사 · 파렛트 식별표): 아이콘(또는 QR) + 제목 + 설명 + 단추
    const LINK_BTN = 'px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap';
    const LINK_BTN_MAIN = 'px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap';
    const linkCardHtml = ({ icon, tone, title, desc, actions, side = '' }) => `
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm h-full flex flex-col gap-3">
            <div class="flex items-start gap-3">
                ${side || `<div class="w-10 h-10 rounded-xl ${tone} flex items-center justify-center flex-shrink-0"><i data-lucide="${icon}" class="w-5 h-5"></i></div>`}
                <div class="min-w-0">
                    <h3 class="font-black text-slate-900 text-sm">${title}</h3>
                    <p class="text-xs text-slate-500 mt-1 leading-relaxed">${desc}</p>
                </div>
            </div>
            <div class="mt-auto flex flex-wrap gap-2">${actions}</div>
        </div>`;

    // 위젯 id → 실제 HTML (표시 순서는 아래에서 widgetLayout.order대로 다시 배열함)
    const widgetHtmlById = {
        qr: settings.showQrWidget !== false ? linkCardHtml({
            icon: 'smartphone', tone: 'bg-blue-50 text-blue-600',
            title: '스마트폰에서 바로 열기',
            desc: '휴대폰 카메라로 QR을 비추면 앱이 열립니다. 브라우저의 [홈 화면에 추가]를 누르면 앱처럼 설치됩니다.',
            side: '<div class="bg-white p-1.5 rounded-xl border border-slate-200 flex-shrink-0"><canvas id="dash-qr-canvas" class="block rounded"></canvas></div>',
            actions: `
                <button type="button" id="btn-dash-open-pwa-modal" class="${LINK_BTN_MAIN}"><i data-lucide="smartphone" class="w-3.5 h-3.5"></i><span>앱 설치 안내</span></button>
                <button type="button" id="btn-dash-download-qr" class="${LINK_BTN}"><i data-lucide="download" class="w-3.5 h-3.5"></i><span>QR 이미지 저장</span></button>`
        }) : '',

        googleAudit: linkCardHtml({
            icon: 'clipboard-check', tone: 'bg-teal-50 text-teal-600',
            title: '거점별 온라인 재고실사',
            desc: '현장에서 입력한 실사 수량(본사·김포공장)을 바로 확인하고 전산 재고와의 차이를 보정합니다.',
            actions: `
                <button type="button" id="btn-dash-open-google-audit" class="${LINK_BTN_MAIN}"><i data-lucide="external-link" class="w-3.5 h-3.5"></i><span>실사 웹앱 열기</span></button>
                <button type="button" class="${LINK_BTN}" data-goto="audit"><i data-lucide="table-properties" class="w-3.5 h-3.5"></i><span>재고실사 화면</span></button>`
        }),

        palletLabel: linkCardHtml({
            icon: 'package-check', tone: 'bg-emerald-50 text-emerald-600',
            title: '파렛트 식별표 발행',
            desc: '완제품 출하용 파렛트 식별표(폼텍 3130, A4 전면)를 연속 인쇄하거나 PDF로 저장합니다.',
            actions: `
                <button type="button" class="${LINK_BTN_MAIN}" data-goto="palletLabel"><i data-lucide="printer" class="w-3.5 h-3.5"></i><span>식별표 열기</span></button>
                <button type="button" class="${LINK_BTN}" data-goto="label"><span>드럼 2칸 라벨</span></button>`
        }),

        // 김포공장 업무일지 요약: 이번 달 기록이 없으면 일지가 있는 가장 최근 달을 보여 준다
        gimpoProd: (() => {
            const logs = state.gimpoLogs || [];
            const monthOf = (log) => String(log.date || '').slice(0, 7);
            const thisMonth = todayPrefix.slice(0, 7);
            const latestLog = logs.reduce((latest, log) => (String(log.date || '') > String(latest?.date || '') ? log : latest), null);
            const month = logs.some(log => monthOf(log) === thisMonth) ? thisMonth : (latestLog ? monthOf(latestLog) : thisMonth);
            const monthLogs = logs.filter(log => monthOf(log) === month);
            const sumQty = (rows) => (rows || []).reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
            const packQty = monthLogs.reduce((sum, log) => sum + sumQty(log.packaging), 0);
            const oilQty = monthLogs.reduce((sum, log) => sum + sumQty(log.oilBlending), 0);
            const moveCount = monthLogs.reduce((sum, log) => sum + (log.movement || []).length, 0);
            const monthLabel = `${Number(month.slice(5, 7))}월`;
            const tile = (label, value, unit, valueTone = 'text-slate-900') => `
                <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <span class="text-[11px] font-bold text-slate-500 block">${label}</span>
                    <div class="flex items-baseline gap-1 mt-1">
                        <span class="text-xl font-black ${valueTone}">${value}</span>
                        <span class="text-xs text-slate-500 font-bold">${unit}</span>
                    </div>
                </div>`;
            return `
                <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 h-full">
                    ${widgetHeadHtml({ icon: 'factory', tone: 'bg-blue-50 text-blue-600', title: '김포공장 업무일지 실적', badge: `${monthLabel} · 일지 ${monthLogs.length}일`, link: '업무일지 열기', goto: 'gimpoLog' })}
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        ${tile(`${monthLabel} 완제품 포장`, packQty.toLocaleString(), 'EA')}
                        ${tile(`${monthLabel} 원액 생산`, oilQty.toLocaleString(), 'L')}
                        ${tile(`${monthLabel} 이동`, moveCount.toLocaleString(), '건')}
                        ${tile('최근 일지', latestLog ? esc(String(latestLog.date).slice(5)) : '-', latestLog?.manager ? `담당 ${esc(latestLog.manager)}` : '', 'text-blue-700')}
                    </div>
                </div>
            `;
        })(),

        quickAction: settings.showQuickAction !== false ? `
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 h-full">
                ${widgetHeadHtml({ icon: 'scan-line', tone: 'bg-blue-50 text-blue-600', title: '빠른 입출고 등록', link: '현장 스캔 열기', goto: 'scan' })}

                <form id="quick-action-form" class="space-y-3">
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">품목 검색 (코드 또는 품목명 일부문자)</label>
                        <div class="relative">
                            <input type="text" id="quick-item-search" placeholder="코드 또는 품목명 일부 입력..." class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none" autocomplete="off" />
                            <div id="quick-item-suggestions" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-30 max-h-48 overflow-y-auto divide-y divide-slate-100"></div>
                        </div>
                        <input type="hidden" id="quick-item-code" value="${esc(state.master[0]?.code || '')}" />
                        <div id="quick-item-selected-badge" class="mt-1 text-[11px] font-bold text-blue-600 truncate">
                            선택됨: [${esc(state.master[0]?.code || '-')}] ${esc(state.master[0]?.name || '')}
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">작업 유형</label>
                            <select id="quick-action-type" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                <option value="IN">입고 (+)</option>
                                <option value="OUT">출고 (-)</option>
                                <option value="USE">생산투입 (-)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">수량</label>
                            <input type="number" id="quick-qty" min="1" value="10" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" required />
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">대상 창고/거점</label>
                        <select id="quick-location" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none">
                            ${locationOptionsHtml(state.locations)}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">작업 사유 / 비고</label>
                        <input type="text" id="quick-reason" placeholder="예: 정기 구매 입고, 현장 생산투입" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <button type="submit" class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5">
                        <i data-lucide="check" class="w-4 h-4"></i>
                        <span>등록</span>
                    </button>
                </form>
            </div>
        ` : '',

        lowSafety: settings.showLowSafety !== false ? `
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 h-full">
                ${widgetHeadHtml({
                    icon: 'alert-triangle', tone: lowStockItems.length ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500',
                    title: '안전재고 부족', badge: `${lowStockItems.length}건`, link: '창고 재고 열기', goto: 'inventory',
                    extra: canAccessTab('purchRequest') && lowStockItems.some(m => !['완제품', '원액'].includes(m.category) && Number(m.safety) > 0)
                        ? '<button type="button" id="btn-safety-draft" class="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-bold flex items-center gap-1" title="안전재고 미달 원료·부자재로 구매요청서 초안 만들기"><i data-lucide="shopping-cart" class="w-3.5 h-3.5"></i>구매요청 초안</button>' : ''
                })}

                ${lowStockItems.length === 0 ? `
                    <div class="p-8 text-center text-slate-400 text-xs">
                        <i data-lucide="shield-check" class="w-8 h-8 mx-auto text-emerald-500 mb-2"></i>
                        현재 모든 품목이 안전재고 이상 적정하게 보관 중입니다.
                    </div>
                ` : `
                    <div class="overflow-x-auto max-h-72">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0">
                                <tr>
                                    <th class="p-2">품목코드</th>
                                    <th class="p-2">품목명</th>
                                    <th class="p-2 text-right">현재고</th>
                                    <th class="p-2 text-right">안전재고</th>
                                    <th class="p-2 text-center">상태</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100">
                                ${lowStockItems.slice(0, 15).map(item => {
                                    const currStock = state.inventory
                                        .filter(inv => inv.code === item.code)
                                        .reduce((acc, cur) => acc + (Number(cur.quantity) || 0), 0);
                                    return `
                                    <tr class="hover:bg-slate-50 transition">
                                        <td class="p-2 font-mono font-bold text-slate-800">${esc(item.code)}</td>
                                        <td class="p-2 font-medium text-slate-700 truncate max-w-[140px]">${esc(item.name)}</td>
                                        <td class="p-2 text-right font-black text-rose-600">${currStock.toLocaleString()} ${esc(item.unit)}</td>
                                        <td class="p-2 text-right font-bold text-slate-400">${Number(item.safety).toLocaleString()} ${esc(item.unit)}</td>
                                        <td class="p-2 text-center">
                                            <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${currStock === 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}">
                                                ${currStock === 0 ? '품절' : '부족'}
                                            </span>
                                        </td>
                                    </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        ` : '',

        calendarWidget: settings.showCalendarWidget !== false ? `
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 h-full">
                ${widgetHeadHtml({ icon: 'calendar', tone: 'bg-indigo-50 text-indigo-600', title: '일정 캘린더', badge: calMonthTitle, link: '캘린더 열기', goto: 'calendar' })}

                <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    <!-- 왼쪽: 월간 미니 달력 그리드 (7칸) -->
                    <div class="lg:col-span-6 xl:col-span-7 bg-slate-50/70 p-4 rounded-xl border border-slate-200">
                        <div class="flex items-center justify-between mb-3 px-1">
                            <span class="font-extrabold text-xs text-slate-800">${calMonthTitle}</span>
                            <div class="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-indigo-600 inline-block"></span>일정</span>
                                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>입고</span>
                                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>출고</span>
                            </div>
                        </div>

                        <!-- 요일 헤더 -->
                        <div class="grid grid-cols-7 text-center text-[11px] font-extrabold text-slate-400 mb-1">
                            <div class="text-rose-500">일</div>
                            <div>월</div>
                            <div>화</div>
                            <div>수</div>
                            <div>목</div>
                            <div>금</div>
                            <div class="text-blue-500">토</div>
                        </div>

                        <!-- 달력 날짜 셀 그리드 -->
                        <div class="grid grid-cols-7 gap-1" id="dash-calendar-grid">
                            ${buildCalendarCells(selectedDate)}
                        </div>
                    </div>

                    <!-- 오른쪽: 선택된 일자의 일정 어젠다 (5칸) -->
                    <div class="lg:col-span-6 xl:col-span-5 flex flex-col justify-between space-y-3 bg-slate-50/40 p-4 rounded-xl border border-slate-200">
                        <div>
                            <div class="flex items-center justify-between pb-2 border-b border-slate-200 mb-2.5">
                                <div class="flex items-center gap-1.5">
                                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                                    <span class="font-bold text-xs text-slate-800" id="dash-selected-date-label">${esc(selectedDate)} (선택된 일자)</span>
                                </div>
                                <span class="text-[10px] text-slate-500 font-bold" id="dash-selected-count-badge">일정 ${todaySchedules.length}건 / 실적 ${todayLogs.length}건</span>
                            </div>

                            <!-- 일정 리스트 -->
                            <div class="space-y-2 max-h-56 overflow-y-auto pr-1" id="dash-schedule-agenda-list">
                                ${buildAgendaList(selectedDate)}
                            </div>
                        </div>

                        <div class="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
                            <span class="text-slate-500">날짜를 누르면 그날 일정이 보입니다.</span>
                            <button type="button" class="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition" data-goto="calendar">
                                + 일정 등록
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        ` : '',

        oilcalc: settings.showOilCalc !== false ? `
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 h-full">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center flex-shrink-0">
                        <i data-lucide="flask-conical" class="w-5 h-5"></i>
                    </div>
                    <div>
                        <h3 class="font-black text-slate-900 text-sm">비중·용량 환산 계산기</h3>
                        <p class="text-xs text-slate-500 mt-0.5">측정 온도의 비중을 15℃ 기준으로 보정하고(ASTM D1250), 중량(kg)과 용량(L)을 서로 환산합니다.</p>
                    </div>
                </div>
                <button type="button" class="${LINK_BTN}" data-goto="oilcalc">
                    <span>계산기 열기</span>
                    <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                </button>
            </div>
        ` : '',

        // 품질관리 현황판 요약: 자리만 두고 그린 뒤 components/quality/QcBoardWidget.js가 채운다 (품질 기록은 따로 받음)
        qcBoard: canAccessTab('qcBoard') ? '<div id="dash-qc-board" class="h-full"><div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-xs text-slate-400 h-full">품질관리 현황판 불러오는 중...</div></div>' : '',

        rawLedgerSummary: summaryCardHtml({
            icon: 'cylinder', iconBg: 'bg-emerald-50', iconText: 'text-emerald-600',
            title: '원료 수불부', tabId: 'rawLedger',
            value: state.rawLedger.length, valueLabel: '건 전표',
            sub: `원료·원액 ${rawLedgerMaterialCount}종 누적 관리 중`
        }),
        productLedgerSummary: summaryCardHtml({
            icon: 'package-check', iconBg: 'bg-sky-50', iconText: 'text-sky-600',
            title: '제품 수불부', tabId: 'productLedger',
            value: state.productLedger.length, valueLabel: '건 전표',
            sub: '완제품 입출고 누적 원장'
        }),
        materialLedgerSummary: summaryCardHtml({
            icon: 'book-open-check', iconBg: 'bg-indigo-50', iconText: 'text-indigo-600',
            title: '자재 수불부', tabId: 'ledger',
            value: state.materialLedger.length, valueLabel: '건 전표',
            sub: '부자재·소모품·기타 입출고 누적 원장'
        }),

        history: settings.showHistory !== false ? `
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 h-full">
                ${widgetHeadHtml({ icon: 'history', tone: 'bg-slate-100 text-slate-600', title: '최근 작업 이력', badge: `최근 ${settings.historyCount || 5}건`, link: '전체 이력 열기', goto: 'history' })}

                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-50 text-slate-500 border-b border-slate-200">
                            <tr>
                                <th class="p-2.5">일시</th>
                                <th class="p-2.5">구분</th>
                                <th class="p-2.5">품목코드 / 품명</th>
                                <th class="p-2.5 text-right">수량</th>
                                <th class="p-2.5">출발 &rarr; 도착 거점</th>
                                <th class="p-2.5">작업자</th>
                                <th class="p-2.5">사유</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${state.history.slice(0, settings.historyCount || 5).map(h => {
                                const typeBadge = {
                                    IN: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">입고</span>',
                                    OUT: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">출고</span>',
                                    USE: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800">투입</span>',
                                    MOVE: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">거점이동</span>',
                                    AUDIT: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800">재고실사</span>'
                                }[h.type] || h.type;

                                return `
                                <tr class="hover:bg-slate-50 transition">
                                    <td class="p-2.5 font-mono text-slate-500">${esc(h.timestamp)}</td>
                                    <td class="p-2.5">${typeBadge}</td>
                                    <td class="p-2.5 font-bold text-slate-800">[${esc(h.code)}] ${esc(h.name)}</td>
                                    <td class="p-2.5 text-right font-black text-blue-600">${Number(h.qty).toLocaleString()} 개</td>
                                    <td class="p-2.5 text-slate-600 font-medium">${esc(h.fromLoc)} &rarr; ${esc(h.toLoc)}</td>
                                    <td class="p-2.5 font-bold text-slate-700">${esc(h.worker)}</td>
                                    <td class="p-2.5 text-slate-500 truncate max-w-xs">${esc(h.reason || '-')}</td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        ` : ''
    };

    const visibleWidgetIds = widgetLayout.order.filter(id => widgetHtmlById[id] && !widgetLayout.hidden.includes(id));
    const hiddenWidgetIds = widgetLayout.order.filter(id => widgetHtmlById[id] && widgetLayout.hidden.includes(id));
    const widgetsHtml = visibleWidgetIds.map(id => widgetWrap(id, widgetHtmlById[id])).join('');

    container.innerHTML = `
    <section id="tab-content-home" class="space-y-3 sm:space-y-4">
        ${!isMobileLauncher ? `
        <!-- 인사말·날짜 + 홈 화면 도구 (PC) -->
        <div class="flex flex-wrap items-end justify-between gap-3 px-1">
            <div class="min-w-0">
                <h2 class="text-xl font-black tracking-tight text-slate-900 truncate">${esc(state.currentUser?.name || '')}님, 안녕하세요</h2>
                <p class="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-2">
                    <span>${currentTime}</span>
                    ${settings.refreshInterval > 0 ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">자동 갱신 ${settings.refreshInterval}초</span>` : ''}
                </p>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" id="btn-toggle-widget-edit" class="px-3 py-2 rounded-lg border text-xs font-bold transition flex items-center gap-1.5 ${widgetEditMode ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600' : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'}">
                    <i data-lucide="${widgetEditMode ? 'check' : 'layout-dashboard'}" class="w-4 h-4"></i>
                    <span>${widgetEditMode ? '위젯 편집 완료' : '위젯 편집'}</span>
                </button>
                <button type="button" id="btn-open-dash-settings" class="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5">
                    <i data-lucide="sliders" class="w-4 h-4"></i>
                    <span>대시보드 설정</span>
                </button>
                <button type="button" id="btn-quick-sync" class="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5">
                    <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                    <span>새로고침</span>
                </button>
            </div>
        </div>

        ${settings.showKpi !== false ? `
        <!-- 오늘 한눈에: 누르면 그 화면으로 -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            ${[
                { goto: 'master', icon: 'layout-grid', label: '등록 품목', value: masterCount.toLocaleString(), unit: '품목', tone: 'text-slate-900' },
                { goto: 'inventory', icon: 'database', label: '창고 보관 총수량', value: totalStock.toLocaleString(), unit: '개(EA)', tone: 'text-slate-900' },
                { goto: 'inventory', icon: 'triangle-alert', label: '안전재고 부족', value: lowStockItems.length.toLocaleString(), unit: '건', tone: lowStockItems.length ? 'text-rose-600' : 'text-slate-900', alert: lowStockItems.length > 0 },
                { goto: 'calendar', icon: 'calendar-check', label: '오늘 입출고 · 일정', value: todayLogs.length.toLocaleString(), unit: `건 · 일정 ${todaySchedules.length}건`, tone: 'text-slate-900' }
            ].map(k => `
            <div class="bg-white rounded-2xl border ${k.alert ? 'border-rose-200' : 'border-slate-200'} shadow-sm p-4 hover:border-blue-300 transition cursor-pointer" data-goto="${k.goto}">
                <span class="flex items-center gap-1.5 text-[11px] font-bold text-slate-500"><i data-lucide="${k.icon}" class="w-3.5 h-3.5 ${k.alert ? 'text-rose-500' : 'text-slate-400'}"></i>${k.label}</span>
                <div class="flex items-baseline gap-1.5 mt-1.5">
                    <span class="text-2xl font-black ${k.tone}">${k.value}</span>
                    <span class="text-xs text-slate-400 font-bold">${k.unit}</span>
                </div>
            </div>`).join('')}
        </div>
        ` : ''}
        ` : `
        <!-- 스마트폰·태블릿 전용 깨끗한 홈 화면: 위젯 없이 아이콘만. 좌측 상단 ☰ 버튼으로 사이드바 메뉴 -->
        <!-- 제목은 머리글에 있으므로 인사말·날짜 한 줄만 -->
        <div class="px-1 flex items-baseline justify-between gap-2">
            <p class="text-base font-black text-slate-800 truncate">${esc(state.currentUser?.name || '')}님, 안녕하세요</p>
            <p class="text-xs font-bold text-slate-400 whitespace-nowrap">${(() => { const d = new Date(); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`; })()}</p>
        </div>
        <!-- 오늘 한눈에: 누르면 그 화면으로 -->
        <div class="grid grid-cols-3 gap-2">
            <button type="button" data-goto="calendar" class="bg-white rounded-2xl border border-slate-200 p-3 text-left active:scale-95 transition shadow-xs">
                <span class="flex items-center gap-1 text-[11px] font-bold text-slate-500"><i data-lucide="calendar-check" class="w-3.5 h-3.5 text-indigo-500"></i>오늘 일정</span>
                <span class="block mt-1 text-xl font-black text-indigo-600">${todaySchedules.length}<span class="text-xs text-slate-400 font-bold ml-0.5">건</span></span>
            </button>
            <button type="button" data-goto="inventory" class="bg-white rounded-2xl border ${lowStockItems.length ? 'border-rose-200' : 'border-slate-200'} p-3 text-left active:scale-95 transition shadow-xs">
                <span class="flex items-center gap-1 text-[11px] font-bold text-slate-500"><i data-lucide="triangle-alert" class="w-3.5 h-3.5 text-rose-500"></i>재고 부족</span>
                <span class="block mt-1 text-xl font-black ${lowStockItems.length ? 'text-rose-600' : 'text-slate-700'}">${lowStockItems.length}<span class="text-xs text-slate-400 font-bold ml-0.5">건</span></span>
            </button>
            <button type="button" id="btn-home-todo" class="bg-white rounded-2xl border border-slate-200 p-3 text-left active:scale-95 transition shadow-xs">
                <span class="flex items-center gap-1 text-[11px] font-bold text-slate-500"><i data-lucide="notebook-pen" class="w-3.5 h-3.5 text-amber-500"></i>내 할일</span>
                <span class="block mt-1 text-xl font-black text-amber-600"><span id="home-todo-count">-</span><span class="text-xs text-slate-400 font-bold ml-0.5">건</span></span>
            </button>
        </div>
        `}

        <!-- 스마트폰 빠른 실행 메뉴 (앱 아이콘 바로가기) 섹션 -->
        <div class="bg-white rounded-2xl p-3.5 sm:p-4 shadow-sm border border-slate-200">
            <div class="flex items-center justify-between gap-3 mb-2 sm:mb-3 pb-2 sm:pb-2.5 border-b border-slate-100">
                <h3 class="text-sm font-black text-slate-800">바로가기</h3>
                <button type="button" id="btn-open-shortcut-modal" class="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0">
                    <i data-lucide="sliders-horizontal" class="w-3.5 h-3.5"></i>
                    <span>편집</span>
                </button>
            </div>

            <!-- 앱 아이콘 그리드 (스마트폰 4열, 태블릿 6열, PC 8~10열) -->
            <div class="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-10 gap-x-1 gap-y-2 sm:gap-2">
                ${activeShortcuts.map(item => `
                    <button type="button" class="btn-dash-shortcut flex flex-col items-center justify-start p-1.5 sm:p-2 rounded-xl hover:bg-slate-50 active:scale-95 transition group" data-shortcut-id="${esc(item.id)}" title="${esc(item.desc)}">
                        <div class="w-14 h-14 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br ${item.gradient} text-white flex items-center justify-center">
                            <i data-lucide="${item.icon}" class="w-6 h-6"></i>
                        </div>
                        <span class="mt-1.5 text-[11px] sm:text-xs font-bold text-slate-700 text-center tracking-tight leading-tight line-clamp-2 sm:line-clamp-1 min-h-[2.2em] sm:min-h-0 break-keep group-hover:text-blue-700">
                            ${esc(item.label)}
                        </span>
                    </button>
                `).join('')}

                <button type="button" id="btn-add-dash-shortcut-tile" class="flex flex-col items-center justify-start p-1.5 sm:p-2 rounded-xl text-slate-400 hover:bg-slate-50 hover:text-blue-600 transition group" title="바로가기 추가·빼기">
                    <div class="w-14 h-14 sm:w-12 sm:h-12 rounded-2xl border-2 border-dashed border-slate-200 group-hover:border-blue-300 flex items-center justify-center transition">
                        <i data-lucide="plus" class="w-5 h-5"></i>
                    </div>
                    <span class="mt-1.5 text-[11px] sm:text-xs font-bold">추가</span>
                </button>
            </div>
        </div>

        ${isMobileLauncher ? `
        <!-- 스마트폰: 오늘 일정 (최대 6건, 누르면 캘린더) -->
        <div class="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-200/80">
            <div class="flex items-center justify-between mb-1.5 pb-2 border-b border-slate-100">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-1.5"><i data-lucide="calendar-days" class="w-4 h-4 text-indigo-500"></i>오늘 일정</h3>
                <button type="button" data-goto="calendar" class="text-xs font-bold text-indigo-600">캘린더 &rarr;</button>
            </div>
            ${todaySchedules.length ? todaySchedules.slice(0, 6).map(s => {
                const T = { OUT_PLAN: ['출고예정', 'bg-blue-50 text-blue-700'], PROD_PLAN: ['생산예정', 'bg-emerald-50 text-emerald-700'], IN_PLAN: ['입고예정', 'bg-amber-50 text-amber-700'] }[s.type] || ['일정', 'bg-slate-100 text-slate-600'];
                return `<button type="button" data-goto="calendar" class="w-full flex items-center gap-2 py-2 border-b border-slate-100 last:border-0 text-left">
                    <span class="px-1.5 py-0.5 rounded-md text-[10px] font-black whitespace-nowrap ${T[1]}">${T[0]}</span>
                    <span class="flex-1 min-w-0 text-xs font-bold truncate ${s.status === 'DONE' ? 'line-through text-slate-400' : 'text-slate-800'}">${esc(s.title || '')}</span>
                    ${s.time ? `<span class="text-[11px] font-bold text-slate-400">${esc(s.time)}</span>` : ''}
                </button>`;
            }).join('') + (todaySchedules.length > 6 ? `<div class="pt-1.5 text-[11px] text-slate-400 text-center">외 ${todaySchedules.length - 6}건</div>` : '') : '<div class="py-5 text-center text-xs text-slate-400">오늘 등록된 일정이 없습니다.</div>'}
        </div>
        <div class="h-20"></div>
        ` : ''}

        ${!isMobileLauncher ? `
        <!-- 홈 위젯 그리드 (순서·크기는 "위젯 편집"에서 조절) -->
        <div id="dash-widget-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
            ${widgetsHtml}
        </div>
        ${widgetEditMode && hiddenWidgetIds.length > 0 ? `
        <div class="bg-white rounded-2xl border-2 border-dashed border-indigo-300 p-4">
            <div class="text-xs font-black text-slate-500 mb-2">숨긴 위젯 (눌러서 다시 추가)</div>
            <div class="flex flex-wrap gap-2">
                ${hiddenWidgetIds.map(id => `<button type="button" class="btn-widget-restore px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold border border-indigo-200" data-widget-id="${id}">+ ${WIDGET_DEFS.find(w => w.id === id)?.label || id}</button>`).join('')}
            </div>
        </div>
        ` : ''}
        ` : ''}

        <!-- 스마트폰 바로가기 메뉴 추가/제거 모달 -->
        <div id="modal-shortcut-config" class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 hidden">
            <div class="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200 flex flex-col max-h-[85vh]">
                <div class="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
                    <div>
                        <h3 class="font-black text-base text-slate-900">바로가기 편집</h3>
                        <p class="text-[11px] text-slate-500">홈 화면에 둘 메뉴를 체크하세요.</p>
                    </div>
                    <button type="button" id="btn-close-shortcut-modal" class="rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 transition min-w-11 min-h-11" aria-label="닫기">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>

                <div class="p-4 overflow-y-auto space-y-2 flex-1">
                    ${ALL_DASHBOARD_SHORTCUTS.filter(s => canShowShortcut(s.id)).map(s => {
                        const isChecked = shortcutIds.includes(s.id);
                        return `
                        <label class="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 cursor-pointer transition select-none">
                            <div class="flex items-center gap-3">
                                <div class="w-9 h-9 rounded-xl bg-gradient-to-br ${s.gradient} text-white flex items-center justify-center flex-shrink-0">
                                    <i data-lucide="${s.icon}" class="w-4 h-4"></i>
                                </div>
                                <div>
                                    <div class="font-bold text-xs text-slate-900">${esc(s.label)}</div>
                                    <div class="text-[10px] text-slate-400 line-clamp-1">${esc(s.desc)}</div>
                                </div>
                            </div>
                            <input type="checkbox" value="${esc(s.id)}" class="chk-dash-shortcut w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer" ${isChecked ? 'checked' : ''}>
                        </label>
                        `;
                    }).join('')}
                </div>

                <div class="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 flex-shrink-0">
                    <button type="button" id="btn-reset-shortcut-modal" class="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded-xl transition">
                        기본값 복원
                    </button>
                    <div class="flex items-center gap-2">
                        <button type="button" id="btn-cancel-shortcut-modal" class="px-3.5 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl transition">
                            취소
                        </button>
                        <button type="button" id="btn-save-shortcut-modal" class="px-4 py-1.5 text-xs font-black text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition">
                            저장
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </section>
    `;

    // 스마트폰 퀵 런처 바로가기 클릭 이벤트
    container.querySelectorAll('.btn-dash-shortcut').forEach(btn => {
        btn.addEventListener('click', () => {
            const sid = btn.getAttribute('data-shortcut-id');
            if (sid && onSwitchTab) {
                onSwitchTab(sid);
            }
        });
    });

    // 바로가기 추가/제거 모달 제어
    const shortcutModal = container.querySelector('#modal-shortcut-config');
    const openShortcutModal = () => {
        if (shortcutModal) {
            shortcutModal.classList.remove('hidden');
            createIcons({ icons });
        }
    };
    const closeShortcutModal = () => {
        if (shortcutModal) shortcutModal.classList.add('hidden');
    };

    container.querySelector('#btn-open-shortcut-modal')?.addEventListener('click', openShortcutModal);
    container.querySelector('#btn-add-dash-shortcut-tile')?.addEventListener('click', openShortcutModal);

    // 스마트폰 '내 할일' 칸: 할일 메모장 배지(FloatingTools #ft-todo-badge)의 수를 따라가고, 누르면 할일 메모장
    container.querySelector('#btn-home-todo')?.addEventListener('click', () => window.__openFloating?.('todo'));
    const homeTodo = container.querySelector('#home-todo-count');
    if (homeTodo) {
        const paintTodo = () => {
            const b = document.getElementById('ft-todo-badge');
            homeTodo.textContent = b && !b.classList.contains('hidden') ? b.textContent : '0';
        };
        paintTodo();
        const badge = document.getElementById('ft-todo-badge');
        if (badge) {
            const mo = new MutationObserver(() => { if (!homeTodo.isConnected) { mo.disconnect(); return; } paintTodo(); });
            mo.observe(badge, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        } else setTimeout(paintTodo, 2000);
    }
    container.querySelector('#btn-close-shortcut-modal')?.addEventListener('click', closeShortcutModal);
    container.querySelector('#btn-cancel-shortcut-modal')?.addEventListener('click', closeShortcutModal);

    // 기본 바로가기 복원
    container.querySelector('#btn-reset-shortcut-modal')?.addEventListener('click', () => {
        saveDashboardShortcuts([...DEFAULT_DASHBOARD_SHORTCUTS]);
        closeShortcutModal();
        renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
        showToast('🔄 바로가기를 기본값으로 되돌렸습니다.');
    });

    // 바로가기 저장
    container.querySelector('#btn-save-shortcut-modal')?.addEventListener('click', () => {
        const checked = [];
        container.querySelectorAll('.chk-dash-shortcut:checked').forEach(chk => {
            checked.push(chk.value);
        });
        if (checked.length === 0) {
            alert('최소 1개 이상의 바로가기 메뉴를 선택해주세요.');
            return;
        }
        saveDashboardShortcuts(checked);
        closeShortcutModal();
        renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
        showToast('✅ 바로가기를 저장했습니다.');
    });

    // 대시보드 내 QR 코드 렌더링
    const dashCanvas = container.querySelector('#dash-qr-canvas');
    if (dashCanvas) {
        drawQrOnCanvas(dashCanvas, liveAppUrl, { width: 84, dark: '#0f172a' }).catch(e => console.warn('QR 생성 실패:', e));
    }

    container.querySelector('#btn-dash-open-pwa-modal')?.addEventListener('click', () => onOpenModal('pwa-qr'));
    container.querySelector('#btn-dash-download-qr')?.addEventListener('click', () => {
        if (dashCanvas) {
            const link = document.createElement('a');
            link.download = '대림오일_WMS_현장접속QR.png';
            link.href = dashCanvas.toDataURL('image/png');
            link.click();
            showToast('📥 대시보드 QR 코드가 다운로드되었습니다.');
        }
    });

    container.querySelector('#btn-open-dash-settings')?.addEventListener('click', () => onOpenModal('dashboard-settings'));

    // 위젯 편집 모드 켜기/끄기
    container.querySelector('#btn-toggle-widget-edit')?.addEventListener('click', () => {
        widgetEditMode = !widgetEditMode;
        renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
    });

    // 위젯 크기 순환(작게 → 중간 → 크게 → 작게)
    container.querySelectorAll('.btn-widget-size').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-widget-id');
            const layout = getWidgetLayout();
            const cur = layout.sizes[id] || (WIDGET_DEFS.find(w => w.id === id)?.defaultSize || 'lg');
            const next = { sm: 'md', md: 'lg', lg: 'sm' }[cur] || 'lg';
            layout.sizes[id] = next;
            saveWidgetLayout(layout);
            renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
        });
    });

    // 위젯 숨기기
    container.querySelectorAll('.btn-widget-hide').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-widget-id');
            const layout = getWidgetLayout();
            if (!layout.hidden.includes(id)) layout.hidden.push(id);
            saveWidgetLayout(layout);
            renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
        });
    });

    // 숨긴 위젯 다시 추가
    container.querySelectorAll('.btn-widget-restore').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-widget-id');
            const layout = getWidgetLayout();
            layout.hidden = layout.hidden.filter(h => h !== id);
            saveWidgetLayout(layout);
            renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
        });
    });

    // 안전재고 미달 → 구매요청서 초안 (services/safetyDraft.js)
    container.querySelector('#btn-safety-draft')?.addEventListener('click', () => import('../services/safetyDraft.js').then(m => { const n = m.openSafetyPurchaseDraft(onSwitchTab); showToast?.(n ? `🛒 안전재고 미달 ${n}품목으로 구매요청서 초안을 열었습니다.` : 'ℹ️ 안전재고 미달 구매 품목이 없습니다.'); }));

    // 품질관리 현황판 위젯 채우기 (홈을 가볍게 하려고 따로 받음)
    const qcHost = container.querySelector('#dash-qc-board');
    if (qcHost) import('./quality/QcBoardWidget.js').then(m => m.mountQcBoardWidget(qcHost, { onSwitchTab })).catch(e => { qcHost.innerHTML = `<div class="p-4 text-xs text-rose-600">품질 현황을 불러오지 못했습니다: ${esc(e.message)}</div>`; });

    // 위젯 드래그로 순서 바꾸기 (편집 모드에서만 draggable="true")
    const widgetGrid = container.querySelector('#dash-widget-grid');
    if (widgetGrid) {
        widgetGrid.querySelectorAll('.widget-wrap[draggable="true"]').forEach(wrap => {
            wrap.addEventListener('dragstart', () => {
                dragWidgetId = wrap.getAttribute('data-widget-id');
                wrap.classList.add('opacity-40');
            });
            wrap.addEventListener('dragend', () => {
                wrap.classList.remove('opacity-40');
            });
            wrap.addEventListener('dragover', (e) => {
                e.preventDefault();
            });
            wrap.addEventListener('drop', (e) => {
                e.preventDefault();
                const targetId = wrap.getAttribute('data-widget-id');
                if (!dragWidgetId || dragWidgetId === targetId) return;
                const layout = getWidgetLayout();
                const order = layout.order.filter(id => id !== dragWidgetId);
                const targetIdx = order.indexOf(targetId);
                order.splice(targetIdx, 0, dragWidgetId);
                layout.order = order;
                saveWidgetLayout(layout);
                dragWidgetId = null;
                renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
            });
        });
    }

    // 대림기업 거점별 실시간 재고실사 새 창 열기
    container.querySelector('#btn-dash-open-google-audit')?.addEventListener('click', () => {
        const w = 1040;
        const h = 880;
        const left = Math.max(0, Math.round((window.screen.width - w) / 2));
        const top = Math.max(0, Math.round((window.screen.height - h) / 2));
        const popup = window.open(
            GOOGLE_AUDIT_URL, 
            'GoogleAuditAppPopup', 
            `width=${w},height=${h},top=${top},left=${left},status=yes,toolbar=no,menubar=no,location=yes,scrollbars=yes,resizable=yes`
        );
        if (popup) {
            popup.focus();
            localStorage.setItem('daelim_google_connected', 'true');
            showToast('🔐 구글 로그인 및 실시간 재고실사 웹앱 창이 열렸습니다.');
        } else {
            window.open(GOOGLE_AUDIT_URL, '_blank');
            showToast('🚀 새 탭에서 구글 실사 웹앱이 열렸습니다.');
        }
    });

    // 자동 새로고침 인터벌 등록
    if (settings.refreshInterval > 0) {
        autoRefreshTimer = setInterval(() => {
            renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
        }, settings.refreshInterval * 1000);
    }

    // 이벤트 리스너 바인딩
    container.querySelectorAll('[data-goto]').forEach(el => {
        el.addEventListener('click', () => {
            const target = el.getAttribute('data-goto');
            onSwitchTab(target);
        });
    });

    container.querySelector('#btn-quick-sync')?.addEventListener('click', () => {
        renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
        showToast('🔄 최신 데이터가 새로고침되었습니다.');
    });

    // 미니 캘린더 날짜 클릭 및 일정 체크박스 바인딩
    const bindCalendarEvents = () => {
        const calGrid = container.querySelector('#dash-calendar-grid');
        const agendaContainer = container.querySelector('#dash-schedule-agenda-list');
        const dateLabel = container.querySelector('#dash-selected-date-label');
        const countBadge = container.querySelector('#dash-selected-count-badge');

        calGrid?.querySelectorAll('.btn-dash-cal-date').forEach(btn => {
            btn.addEventListener('click', () => {
                const clickedDate = btn.getAttribute('data-date');
                selectedDate = clickedDate;

                // 달력 그리드 활성화 상태 갱신
                if (calGrid) {
                    calGrid.innerHTML = buildCalendarCells(selectedDate);
                    bindCalendarEvents(); // 재바인딩
                }

                if (dateLabel) {
                    dateLabel.textContent = `${selectedDate} (선택된 일자)`;
                }

                if (countBadge) {
                    const ev = eventMap[selectedDate];
                    const sCount = ev?.schedules?.length || 0;
                    const logsCount = state.history.filter(h => toDateKey(h.timestamp) === selectedDate).length;
                    countBadge.textContent = `일정 ${sCount}건 / 실적 ${logsCount}건`;
                }

                if (agendaContainer) {
                    agendaContainer.innerHTML = buildAgendaList(selectedDate);
                    bindScheduleCheckboxes();
                    createIcons({ icons });
                }
            });
        });

        bindScheduleCheckboxes();
    };

    const bindScheduleCheckboxes = () => {
        container.querySelectorAll('.chk-toggle-sched').forEach(chk => {
            chk.addEventListener('change', async (e) => {
                const id = chk.getAttribute('data-id');
                await toggleScheduleStatus(id);
                showToast('📋 일정 완료 상태가 업데이트되었습니다.');
                const agendaContainer = container.querySelector('#dash-schedule-agenda-list');
                if (agendaContainer) {
                    agendaContainer.innerHTML = buildAgendaList(selectedDate);
                    bindScheduleCheckboxes();
                    createIcons({ icons });
                }
            });
        });
    };

    bindCalendarEvents();

    const quickSearchInput = container.querySelector('#quick-item-search');
    const quickSuggestions = container.querySelector('#quick-item-suggestions');
    const quickHiddenCode = container.querySelector('#quick-item-code');
    const quickBadge = container.querySelector('#quick-item-selected-badge');

    quickSearchInput?.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        if (!q) {
            quickSuggestions?.classList.add('hidden');
            return;
        }

        const matches = searchMasterItems(q, 6);
        if (matches.length === 0) {
            quickSuggestions.innerHTML = '<div class="p-2.5 text-center text-xs text-slate-400 font-bold">일치하는 품목 없음</div>';
        } else {
            quickSuggestions.innerHTML = matches.map(m => `
                <div class="quick-suggest-pick p-2 hover:bg-blue-50 cursor-pointer transition flex items-center justify-between" data-code="${esc(m.code)}" data-name="${esc(m.name)}">
                    <div>
                        <div class="font-bold text-xs text-slate-900">[${esc(m.code)}] ${esc(m.name)}</div>
                        <div class="text-[10px] text-slate-400">${esc(m.spec || '-')} | ${esc(m.category)}</div>
                    </div>
                </div>
            `).join('');

            quickSuggestions.querySelectorAll('.quick-suggest-pick').forEach(item => {
                item.addEventListener('click', () => {
                    const c = item.getAttribute('data-code');
                    const n = item.getAttribute('data-name');
                    quickHiddenCode.value = c;
                    quickBadge.textContent = `선택됨: [${c}] ${n}`;
                    quickSearchInput.value = `[${c}] ${n}`;
                    quickSuggestions.classList.add('hidden');
                });
            });
        }
        quickSuggestions?.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!quickSearchInput?.contains(e.target) && !quickSuggestions?.contains(e.target)) {
            quickSuggestions?.classList.add('hidden');
        }
    });

    const quickForm = container.querySelector('#quick-action-form');
    quickForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = container.querySelector('#quick-item-code').value;
        const type = container.querySelector('#quick-action-type').value;
        const qty = container.querySelector('#quick-qty').value;
        const location = container.querySelector('#quick-location').value;
        const reason = container.querySelector('#quick-reason').value;

        try {
            await processStockAction({
                type,
                code,
                qty,
                location,
                fromLoc: type !== 'IN' ? location : '-',
                toLoc: type === 'IN' ? location : '-',
                reason: reason || '홈 빠른 작업 등록'
            });
            showToast(`✅ [${type}] ${code} ${qty}EA 처리 완료 (클라우드 동기화됨)`);
            renderDashboard(container, { onSwitchTab, onOpenModal, showToast });
        } catch (err) {
            alert(err.message || '작업 처리 중 오류가 발생했습니다.');
        }
    });

    createIcons({ icons });
};
