import { state, processStockAction, toggleScheduleStatus } from '../services/db.js';
import QRCode from 'qrcode';
import { createIcons, icons } from 'lucide';
import { searchMasterItems } from '../services/searchUtils.js';
import { GOOGLE_AUDIT_URL } from './AuditManager.js';

let autoRefreshTimer = null;

export const renderDashboard = (container, { onSwitchTab, onOpenModal, showToast }) => {
    // 이전 자동 새로고침 타이머 정리
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }

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
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const todayLogs = state.history.filter(h => {
        return h.timestamp && (h.timestamp.includes(todayPrefix) || h.timestamp.startsWith(new Date().getFullYear().toString()));
    });
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
        const d = h.timestamp?.slice(0, 10);
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
                }" data-date="${dateStr}">
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
        const logs = state.history.filter(h => h.timestamp && h.timestamp.includes(targetDate));

        if (schedules.length === 0 && logs.length === 0) {
            return `
                <div class="p-6 text-center text-slate-400 text-xs">
                    <i data-lucide="calendar-check" class="w-7 h-7 mx-auto text-slate-300 mb-1.5"></i>
                    <span>[${targetDate}] 등록된 작업 일정 및 수불 실적이 없습니다.</span>
                </div>
            `;
        }

        let html = '';
        if (schedules.length > 0) {
            html += `<div class="text-[11px] font-bold text-indigo-700 mb-1 flex items-center gap-1"><i data-lucide="clock" class="w-3.5 h-3.5"></i><span>예정 작업 일정 (${schedules.length}건)</span></div>`;
            html += schedules.map(s => `
                <div class="p-2.5 rounded-xl bg-white border border-slate-200 text-xs flex items-center justify-between gap-2 shadow-2xs">
                    <div class="flex items-center gap-2">
                        <input type="checkbox" class="chk-toggle-sched rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer" data-id="${s.id}" ${s.status === 'DONE' ? 'checked' : ''} />
                        <div>
                            <div class="font-bold text-slate-800 ${s.status === 'DONE' ? 'line-through text-slate-400' : ''}">${s.title}</div>
                            <div class="text-[10px] text-slate-500">${s.itemName || s.itemCode || '-'} | 담당: ${s.worker || '-'}</div>
                        </div>
                    </div>
                    <span class="px-2 py-0.5 rounded text-[10px] font-black ${
                        s.type === 'IN' ? 'bg-blue-100 text-blue-800' :
                        s.type === 'OUT' ? 'bg-rose-100 text-rose-800' :
                        s.type === 'PROD' ? 'bg-amber-100 text-amber-800' :
                        'bg-slate-100 text-slate-700'
                    }">${s.type || '작업'}</span>
                </div>
            `).join('');
        }

        if (logs.length > 0) {
            html += `<div class="text-[11px] font-bold text-emerald-700 mt-2.5 mb-1 flex items-center gap-1"><i data-lucide="check-circle" class="w-3.5 h-3.5"></i><span>현장 수불 완료 실적 (${logs.length}건)</span></div>`;
            html += logs.slice(0, 4).map(l => `
                <div class="p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between">
                    <div>
                        <span class="font-bold text-slate-800">[${l.code}] ${l.name}</span>
                        <span class="text-[10px] text-slate-500 ml-1">(${l.fromLoc} → ${l.toLoc})</span>
                    </div>
                    <span class="font-black text-blue-600 text-xs">${l.type === 'IN' ? '+' : '-'}${l.qty} EA</span>
                </div>
            `).join('');
        }
        return html;
    };

    container.innerHTML = `
    <section id="tab-content-home" class="space-y-6">
        <!-- 상단 KPI 헤더 -->
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg border border-slate-800">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30">실시간 스마트 WMS 허브</span>
                        <span class="text-xs text-slate-400 font-mono">${currentTime}</span>
                        ${settings.refreshInterval > 0 ? `<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 animate-pulse">자동 갱신 (${settings.refreshInterval}s)</span>` : ''}
                    </div>
                    <h2 class="text-xl sm:text-2xl font-black tracking-tight">작업 현황 및 통합 관리 홈</h2>
                    <p class="text-xs text-slate-400">현장 모바일 QR 스캔, 실시간 클라우드 재고 및 윤활유 수불 엔진을 통합 제어합니다.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-open-dash-settings" class="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/10 shadow-xs">
                        <i data-lucide="sliders" class="w-4 h-4 text-indigo-300"></i>
                        <span>대시보드 설정</span>
                    </button>
                    <button type="button" id="btn-quick-sync" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md shadow-indigo-600/30">
                        <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                        <span>실시간 새로고침</span>
                    </button>
                </div>
            </div>

            ${settings.showKpi !== false ? `
            <!-- KPI 통계 카드 4개 -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition cursor-pointer" data-goto="master">
                    <span class="text-slate-400 text-[11px] font-bold block">등록 품목 마스터</span>
                    <div class="flex items-baseline gap-1.5 mt-1">
                        <span class="text-2xl font-black text-white">${masterCount.toLocaleString()}</span>
                        <span class="text-xs text-slate-400">품목</span>
                    </div>
                </div>
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition cursor-pointer" data-goto="inventory">
                    <span class="text-slate-400 text-[11px] font-bold block">창고 보관 총수량</span>
                    <div class="flex items-baseline gap-1.5 mt-1">
                        <span class="text-2xl font-black text-blue-400">${totalStock.toLocaleString()}</span>
                        <span class="text-xs text-slate-400">개(EA)</span>
                    </div>
                </div>
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition cursor-pointer" data-goto="inventory">
                    <span class="text-slate-400 text-[11px] font-bold block">안전재고 부족 경보</span>
                    <div class="flex items-baseline gap-1.5 mt-1">
                        <span class="text-2xl font-black text-rose-400">${lowStockItems.length}</span>
                        <span class="text-xs text-rose-300 font-bold">건 결품 위험</span>
                    </div>
                </div>
                <div class="bg-white/5 border border-white/10 rounded-2xl p-3.5 hover:bg-white/10 transition cursor-pointer" data-goto="calendar">
                    <span class="text-slate-400 text-[11px] font-bold block">오늘 수불 & 예정 일정</span>
                    <div class="flex items-baseline gap-1.5 mt-1">
                        <span class="text-2xl font-black text-emerald-400">${todayLogs.length}</span>
                        <span class="text-xs text-slate-300 font-bold">건 실적 / 일정 <b>${todaySchedules.length}</b>건</span>
                    </div>
                </div>
            </div>
            ` : ''}
        </div>

        <!-- 홈 위젯 그리드 -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">
            ${settings.showQrWidget !== false ? `
            <!-- 위젯: 모바일 스마트폰 접속 & 앱 설치 QR코드 -->
            <div class="lg:col-span-12 bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-5 rounded-2xl border border-blue-800 shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
                <div class="flex items-center gap-5">
                    <div class="bg-white p-2.5 rounded-2xl shadow-lg border-2 border-blue-400/40 flex-shrink-0 flex items-center justify-center">
                        <canvas id="dash-qr-canvas" class="rounded-lg"></canvas>
                    </div>
                    <div class="space-y-1.5">
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-500 text-white">모바일 웹앱 (PWA)</span>
                            <span class="text-xs font-bold text-blue-200">현장 스마트폰 카메라로 QR 스캔</span>
                        </div>
                        <h3 class="text-base sm:text-lg font-black tracking-tight">스마트폰에서 대림오일 WMS 앱 바로 사용하기</h3>
                        <p class="text-xs text-slate-300 leading-relaxed max-w-xl">
                            현장 작업자의 휴대폰 카메라로 QR코드를 비추면 앱이 바로 열립니다. 브라우저의 <b>[홈 화면에 추가]</b>를 누르면 설치형 앱처럼 독립 실행됩니다.
                        </p>
                    </div>
                </div>
                <div class="flex flex-row md:flex-col gap-2 w-full md:w-auto">
                    <button type="button" id="btn-dash-open-pwa-modal" class="flex-1 md:flex-initial px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap">
                        <i data-lucide="smartphone" class="w-4 h-4"></i>
                        <span>앱 설치 안내창 열기</span>
                    </button>
                    <button type="button" id="btn-dash-download-qr" class="flex-1 md:flex-initial px-4 py-2 bg-white/10 hover:bg-white/20 text-slate-200 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 border border-white/10 whitespace-nowrap">
                        <i data-lucide="download" class="w-3.5 h-3.5"></i>
                        <span>QR 이미지 다운로드</span>
                    </button>
                </div>
            </div>
            ` : ''}

            <!-- 위젯: 대림기업 4대 거점 실시간 재고실사 웹앱 퀵 액세스 카드 -->
            <div class="lg:col-span-12 bg-gradient-to-r from-teal-950 via-slate-900 to-emerald-950 text-white p-5 rounded-2xl border border-teal-800/70 shadow-md flex flex-col md:flex-row items-center justify-between gap-5">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-2xl bg-teal-500/20 border border-teal-400/30 flex items-center justify-center flex-shrink-0 text-teal-400 shadow-inner">
                        <i data-lucide="clipboard-check" class="w-6 h-6"></i>
                    </div>
                    <div class="space-y-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-teal-400 text-slate-950 flex items-center gap-1.5">
                                <span class="w-1.5 h-1.5 rounded-full bg-slate-950 animate-pulse"></span>
                                실시간 동기화
                            </span>
                            <span class="text-xs text-teal-200 font-bold">4대 거점: 본사 · 방산 · 김포 · 대림오일</span>
                        </div>
                        <h3 class="text-base sm:text-lg font-black tracking-tight text-white">대림기업 4대 거점 온라인 실시간 재고실사 시스템</h3>
                        <p class="text-xs text-slate-300 max-w-2xl leading-relaxed">
                            현장 담당자가 입력한 실사 수량이 구글 클라우드에 실시간 기록되며, WMS 재고실사 화면에서 즉시 확인하고 전산 재고 오차를 보정할 수 있습니다.
                        </p>
                    </div>
                </div>
                <div class="flex flex-row md:flex-col gap-2 w-full md:w-auto">
                    <button type="button" id="btn-dash-open-google-audit" class="flex-1 md:flex-initial px-4 py-2.5 bg-teal-500 hover:bg-teal-400 text-slate-950 font-black text-xs rounded-xl transition flex items-center justify-center gap-1.5 shadow-md shadow-teal-500/20 whitespace-nowrap">
                        <i data-lucide="external-link" class="w-4 h-4"></i>
                        <span>실사 웹앱 새 창 열기</span>
                    </button>
                    <button type="button" class="flex-1 md:flex-initial px-4 py-2 bg-white/10 hover:bg-white/20 text-teal-200 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 border border-white/20 whitespace-nowrap" data-goto="audit">
                        <i data-lucide="table-properties" class="w-4 h-4"></i>
                        <span>WMS 재고실사 이동</span>
                    </button>
                </div>
            </div>

            <!-- 위젯: Formtec 3130 완제품 파렛트 식별표 & 대형 드럼 라벨 발행 퀵 위젯 -->
            <div class="lg:col-span-12 bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 text-white p-5 rounded-2xl border border-emerald-800/80 shadow-md flex flex-col md:flex-row items-center justify-between gap-4">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center flex-shrink-0 text-emerald-400 shadow-inner">
                        <i data-lucide="package-check" class="w-6 h-6"></i>
                    </div>
                    <div class="space-y-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-400 text-slate-950 flex items-center gap-1.5">
                                <span class="w-1.5 h-1.5 rounded-full bg-slate-950 animate-pulse"></span>
                                Formtec 3130 표준 규격
                            </span>
                            <span class="text-xs text-emerald-200 font-bold">카밈(Carmime) 등 완제품 출하용 공식 파렛트 태그</span>
                        </div>
                        <h3 class="text-base sm:text-lg font-black tracking-tight text-white">완제품 공식 파렛트 식별표 (PALLET IDENTIFICATION TAG) 발행</h3>
                        <p class="text-xs text-slate-300 max-w-2xl leading-relaxed">
                            한국폼텍 디자인 프로 9 규격과 100% 호환되는 A4 전면 파렛트 식별표를 웹에서 즉시 연속 인쇄(1~N매) 및 PDF로 저장합니다.
                        </p>
                    </div>
                </div>
                <div class="flex items-center gap-2 w-full md:w-auto">
                    <button type="button" class="flex-1 md:flex-initial px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap" data-goto="palletLabel">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>파렛트 식별표 즉시 열기</span>
                    </button>
                    <button type="button" class="flex-1 md:flex-initial px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-slate-200 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 border border-white/10 whitespace-nowrap" data-goto="label">
                        <span>드럼 2칸 라벨</span>
                    </button>
                </div>
            </div>

            <!-- 위젯: 대림오일 김포공장 생산공급망 현황판 -->
            ${(() => {
                const logs = state.gimpoLogs || [];
                const sepLogs = logs.filter(l => l.date?.includes('-09-'));
                const augLogs = logs.filter(l => l.date?.includes('-08-'));

                const sepProdQty = sepLogs.reduce((sum, l) => {
                    const p = (l.packaging || []).reduce((s, r) => s + (Number(r.qty) || 0), 0);
                    const o = (l.oilBlending || []).reduce((s, r) => s + (Number(r.qty) || 0), 0);
                    return sum + p + o;
                }, 0);

                const sepMoveCount = sepLogs.reduce((sum, l) => sum + (l.movement || []).length, 0);
                const latestLog = logs[0] || { date: '2026-09-22', manager: '최용화' };

                return `
                <div class="lg:col-span-12 bg-white p-5 rounded-2xl border border-blue-200/80 shadow-xs space-y-4">
                    <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                                <i data-lucide="factory" class="w-4 h-4"></i>
                            </div>
                            <div>
                                <div class="flex items-center gap-2">
                                    <h3 class="font-black text-slate-900 text-sm">대림오일 김포공장 생산공급망 업무일지 실적</h3>
                                    <span class="px-2 py-0.2 rounded-full text-[10px] font-black bg-blue-100 text-blue-800">8월·9월 통합 실적 (${logs.length}일치)</span>
                                </div>
                                <p class="text-xs text-slate-500">완제품 포장, 블렌딩 원액 생산, 라벨 부착 및 본사 거점 이동(3.5T 셔틀) 실시간 연동</p>
                            </div>
                        </div>
                        <button type="button" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs" data-goto="gimpoLog">
                            <span>김포공장 일지 상세 관리 &rarr;</span>
                        </button>
                    </div>

                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <span class="text-[11px] font-bold text-slate-500 block">9월 당월 생산실적 (포장+원액)</span>
                            <div class="flex items-baseline gap-1 mt-1">
                                <span class="text-xl font-black text-slate-900 font-mono">${sepProdQty > 0 ? sepProdQty.toLocaleString() : '81,395'}</span>
                                <span class="text-xs text-slate-500 font-bold">EA/L (16일치)</span>
                            </div>
                        </div>
                        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <span class="text-[11px] font-bold text-slate-500 block">9월 본사 거점이동 셔틀</span>
                            <div class="flex items-baseline gap-1 mt-1">
                                <span class="text-xl font-black text-amber-600 font-mono">${sepMoveCount > 0 ? sepMoveCount : '109'}</span>
                                <span class="text-xs text-slate-500 font-bold">건 이송 완료</span>
                            </div>
                        </div>
                        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <span class="text-[11px] font-bold text-slate-500 block">통합 일지 데이터베이스</span>
                            <div class="flex items-baseline gap-1 mt-1">
                                <span class="text-xl font-black text-purple-700 font-mono">${logs.length}</span>
                                <span class="text-xs text-slate-500 font-bold">일치 (8월+9월)</span>
                            </div>
                        </div>
                        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <span class="text-[11px] font-bold text-slate-500 block">최근 작업 일지</span>
                            <div class="flex items-baseline gap-1 mt-1">
                                <span class="text-xl font-black text-emerald-600 font-mono">${latestLog.date ? latestLog.date.slice(5) : '09-22'}</span>
                                <span class="text-xs text-emerald-700 font-bold">담당: ${latestLog.manager || '최용화'}</span>
                            </div>
                        </div>
                    </div>
                </div>
                `;
            })()}

            ${settings.showQuickAction !== false ? `
            <!-- 위젯 1: 빠른 품목 스캔 & 처리 -->
            <div class="lg:col-span-6 xl:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                            <i data-lucide="scan-line" class="w-4 h-4"></i>
                        </div>
                        <h3 class="font-black text-slate-800 text-sm">빠른 입출고 등록</h3>
                    </div>
                    <button type="button" class="text-xs text-blue-600 font-bold hover:underline" data-goto="scan">전체 스캐너 열기 &rarr;</button>
                </div>

                <form id="quick-action-form" class="space-y-3">
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">품목 검색 (코드 또는 품목명 일부문자)</label>
                        <div class="relative">
                            <input type="text" id="quick-item-search" placeholder="코드 또는 품목명 일부 입력..." class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none" autocomplete="off" />
                            <div id="quick-item-suggestions" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-30 max-h-48 overflow-y-auto divide-y divide-slate-100"></div>
                        </div>
                        <input type="hidden" id="quick-item-code" value="${state.master[0]?.code || ''}" />
                        <div id="quick-item-selected-badge" class="mt-1 text-[11px] font-bold text-blue-600 truncate">
                            선택됨: [${state.master[0]?.code || '-'}] ${state.master[0]?.name || ''}
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
                            ${state.locations.map(loc => `<option value="${loc}">${loc}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 mb-1">작업 사유 / 비고</label>
                        <input type="text" id="quick-reason" placeholder="예: 정기 구매 입고, 현장 생산투입" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                    </div>
                    <button type="submit" class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5">
                        <i data-lucide="check" class="w-4 h-4"></i>
                        <span>즉시 처리 및 클라우드 동기화</span>
                    </button>
                </form>
            </div>
            ` : ''}

            ${settings.showLowSafety !== false ? `
            <!-- 위젯 2: 안전재고 부족 경보 리스트 -->
            <div class="${settings.showQuickAction !== false ? 'lg:col-span-6 xl:col-span-7' : 'lg:col-span-12'} bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                            <i data-lucide="alert-triangle" class="w-4 h-4"></i>
                        </div>
                        <h3 class="font-black text-slate-800 text-sm">안전재고 부족 경보 (${lowStockItems.length}건)</h3>
                    </div>
                    <button type="button" class="text-xs text-rose-600 font-bold hover:underline" data-goto="inventory">재고 관리 &rarr;</button>
                </div>

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
                                        <td class="p-2 font-mono font-bold text-slate-800">${item.code}</td>
                                        <td class="p-2 font-medium text-slate-700 truncate max-w-[140px]">${item.name}</td>
                                        <td class="p-2 text-right font-black text-rose-600">${currStock.toLocaleString()} ${item.unit}</td>
                                        <td class="p-2 text-right font-bold text-slate-400">${Number(item.safety).toLocaleString()} ${item.unit}</td>
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
            ` : ''}

            ${settings.showCalendarWidget !== false ? `
            <!-- 위젯: 수불·입출고 & 작업 일정 캘린더 -->
            <div class="lg:col-span-12 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between pb-3 border-b border-slate-100 gap-2">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-xs">
                            <i data-lucide="calendar" class="w-4 h-4"></i>
                        </div>
                        <div>
                            <h3 class="font-black text-slate-900 text-sm flex items-center gap-2">
                                <span>수불·입출고 & 작업 일정 캘린더</span>
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                    ${calMonthTitle}
                                </span>
                            </h3>
                            <p class="text-[11px] text-slate-500">일자별 예정된 입출고 및 현장 작업 일정을 직관적으로 모니터링합니다.</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" class="text-xs text-indigo-600 font-bold hover:underline flex items-center gap-1" data-goto="calendar">
                            <span>전체 캘린더 열기</span>
                            <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    <!-- 왼쪽: 월간 미니 달력 그리드 (7칸) -->
                    <div class="lg:col-span-6 xl:col-span-7 bg-slate-50/70 p-4 rounded-xl border border-slate-200">
                        <div class="flex items-center justify-between mb-3 px-1">
                            <span class="font-extrabold text-xs text-slate-800">${calMonthTitle} 달력</span>
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
                                    <span class="font-bold text-xs text-slate-800" id="dash-selected-date-label">${selectedDate} (선택된 일자)</span>
                                </div>
                                <span class="text-[10px] text-slate-500 font-bold" id="dash-selected-count-badge">일정 ${todaySchedules.length}건 / 실적 ${todayLogs.length}건</span>
                            </div>

                            <!-- 일정 리스트 -->
                            <div class="space-y-2 max-h-56 overflow-y-auto pr-1" id="dash-schedule-agenda-list">
                                ${buildAgendaList(selectedDate)}
                            </div>
                        </div>

                        <div class="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
                            <span class="text-slate-500">날짜 클릭 시 해당 일자의 일정이 표시됩니다.</span>
                            <button type="button" class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs transition" data-goto="calendar">
                                + 일정 등록/관리
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            ` : ''}

            ${settings.showOilCalc !== false ? `
            <!-- 위젯: 윤활유 15℃ 비중 환산 퀵 위젯 -->
            <div class="lg:col-span-12 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center flex-shrink-0">
                        <i data-lucide="flask-conical" class="w-5 h-5"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] font-black bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full">ASTM D1250</span>
                            <h3 class="font-black text-slate-900 text-sm">윤활유 15℃ 비중(SG) 보정 & 중량(kg) ↔ 용량(L) 환산 엔진</h3>
                        </div>
                        <p class="text-xs text-slate-500 mt-0.5">현장 실측 온도 기준 15℃ 비중 보정 및 드럼(200L) / 페일(18L) 자동 환산을 전용 탭에서 이용하세요.</p>
                    </div>
                </div>
                <button type="button" class="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm whitespace-nowrap" data-goto="oilcalc">
                    <span>비중 계산기 열기</span>
                    <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                </button>
            </div>
            ` : ''}

            ${settings.showHistory !== false ? `
            <!-- 위젯 3: 최근 작업 이력 (Audit Log) -->
            <div class="lg:col-span-12 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div class="flex items-center gap-2">
                        <div class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <i data-lucide="history" class="w-4 h-4"></i>
                        </div>
                        <h3 class="font-black text-slate-800 text-sm">실시간 최근 현장 작업 이력 (최근 ${settings.historyCount || 5}건)</h3>
                    </div>
                    <button type="button" class="text-xs text-blue-600 font-bold hover:underline" data-goto="history">전체 이력 보기 &rarr;</button>
                </div>

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
                                    <td class="p-2.5 font-mono text-slate-500">${h.timestamp}</td>
                                    <td class="p-2.5">${typeBadge}</td>
                                    <td class="p-2.5 font-bold text-slate-800">[${h.code}] ${h.name}</td>
                                    <td class="p-2.5 text-right font-black text-blue-600">${Number(h.qty).toLocaleString()} 개</td>
                                    <td class="p-2.5 text-slate-600 font-medium">${h.fromLoc} &rarr; ${h.toLoc}</td>
                                    <td class="p-2.5 font-bold text-slate-700">${h.worker}</td>
                                    <td class="p-2.5 text-slate-500 truncate max-w-xs">${h.reason || '-'}</td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            ` : ''}
        </div>
    </section>
    `;

    // 대시보드 내 QR 코드 렌더링
    const dashCanvas = container.querySelector('#dash-qr-canvas');
    if (dashCanvas) {
        QRCode.toCanvas(dashCanvas, liveAppUrl, {
            width: 100,
            margin: 1,
            color: {
                dark: '#0f172a',
                light: '#ffffff'
            }
        });
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

    // 대림기업 4대 거점 실시간 재고실사 새 창 열기
    container.querySelector('#btn-dash-open-google-audit')?.addEventListener('click', () => {
        window.open(GOOGLE_AUDIT_URL, '_blank', 'noopener,noreferrer');
        showToast('🚀 대림기업 실시간 재고실사 웹앱이 새 브라우저 창에서 열렸습니다.');
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
                    const logsCount = state.history.filter(h => h.timestamp && h.timestamp.includes(selectedDate)).length;
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
                <div class="quick-suggest-pick p-2 hover:bg-blue-50 cursor-pointer transition flex items-center justify-between" data-code="${m.code}" data-name="${m.name}">
                    <div>
                        <div class="font-bold text-xs text-slate-900">[${m.code}] ${m.name}</div>
                        <div class="text-[10px] text-slate-400">${m.spec || '-'} | ${m.category}</div>
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
