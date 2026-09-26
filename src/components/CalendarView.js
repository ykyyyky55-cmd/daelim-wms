import { state, saveSchedule, deleteSchedule, toggleScheduleStatus, listSlips, SLIP_TYPES } from '../services/db.js';
import { searchMasterItems, localDateStr, toDateKey } from '../services/searchUtils.js';
import { siteOf } from '../services/locations.js';
import { uploadCalendarFile, calendarFileUrl, deleteCalendarFile } from '../services/calendarFiles.js';
import { renderChatInboxPanel } from './ChatInboxPanel.js';
import { renderProdSchedule } from './ProdScheduleTable.js';
import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';

/**
 * 캘린더 (통합 / 본사 / 김포 / 개인)
 * - 보기: 일간 · 주간 · 월간, 스마트폰(좁은 화면)은 날짜별 카드
 * - 화면: 같이보기(여러 캘린더를 한 달력에 색으로 구분) / 따로보기(2~3개 달력을 나란히)
 * - 일정: 시간·품목·거래처·첨부 파일(전표 사진·PDF)·WMS 전표 연결. 발행 전표와 입출고 전표도 날짜에 표시
 */
const SETTINGS_KEY = 'daelim_cal_settings';
const CALS = {
    ALL: { label: '통합', icon: 'layers', dot: 'bg-slate-700' },
    HQ: { label: '본사', icon: 'building-2', dot: 'bg-blue-600', chip: 'bg-blue-50 text-blue-800 border-blue-200' },
    GIMPO: { label: '김포', icon: 'factory', dot: 'bg-emerald-600', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    PERSONAL: { label: '개인', icon: 'user', dot: 'bg-violet-600', chip: 'bg-violet-50 text-violet-800 border-violet-200' }
};
const SHARED_CALS = ['HQ', 'GIMPO', 'PERSONAL'];
const TYPES = {
    IN_PLAN: '입고예정', OUT_PLAN: '출고예정', PROD_PLAN: '생산예정', AUDIT: '재고실사', MAINTENANCE: '설비점검',
    ORDER_DEADLINE: '발주마감', TRAINING: '교육', MEETING: '회의', OTHER: '일반'
};
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

// 거점 → 캘린더 (전표·입출고 표시용). 방산공장 등 그 밖은 통합에만 보인다.
const calOfLocation = (loc) => {
    const s = siteOf(loc || '');
    if (s === '본사 창고') return 'HQ';
    if (s === '김포공장' || s === '김포2공장') return 'GIMPO';
    return '';
};

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const ds = (d) => localDateStr(d);
const startOfWeek = (d) => addDays(d, -d.getDay());
const sameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

export const renderCalendar = (container, { showToast = () => {} } = {}) => {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; } })();
    const cfg = {
        view: saved.view || 'month',                   // day | week | month
        layout: saved.layout || 'merged',              // merged(같이보기) | split(따로보기)
        paneCount: saved.paneCount || 2,               // 따로보기 2 | 3
        panes: saved.panes || ['HQ', 'GIMPO', 'PERSONAL'],
        merged: saved.merged || ['HQ', 'GIMPO', 'PERSONAL'],
        showSlips: saved.showSlips !== false,          // 발행 전표 (TR/RQ/WT)
        showMoves: saved.showMoves !== false,          // 입출고 전표 (입출고 이력)
        showDone: saved.showDone !== false,
        showProd: saved.showProd !== false             // 생산 스케줄표의 포장계획·납품예정일
    };
    let prodRows = [];
    const persist = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg)); } catch { /* 저장 불가 */ } };
    let cursor = new Date();
    let slips = [];
    const me = () => state.currentUser?.id || state.currentUser?.username || '';
    const isMobile = () => window.innerWidth < 640;

    // ---------- 데이터 ----------
    const schedCalOk = (s, calKeys) => {
        const cal = s.calendar || 'HQ';
        if (cal === 'PERSONAL' && s.owner && s.owner !== me()) return false; // 남의 개인 일정 (클라우드는 RLS가 이미 막음)
        return calKeys.includes(cal);
    };
    const keysOf = (paneKey) => (paneKey === 'ALL' ? SHARED_CALS : [paneKey]);

    // 날짜 범위의 표시 항목: 일정 / 발행 전표 / 입출고(날짜·캘린더별 묶음)
    const eventsIn = (calKeys, from, to) => {
        const out = [];
        state.schedules.forEach(s => {
            if (!s.date || s.date < from || s.date > to || !schedCalOk(s, calKeys)) return;
            if (!cfg.showDone && s.status === 'DONE') return;
            out.push({ kind: 'sched', date: s.date, time: s.startTime || '', cal: s.calendar || 'HQ', s });
        });
        if (cfg.showSlips) {
            slips.forEach(sl => {
                if (!sl.date || sl.date < from || sl.date > to) return;
                const cal = calOfLocation(sl.fromLoc) || calOfLocation(sl.toLoc);
                // 거점이 본사·김포면 그 캘린더, 그 밖(방산·외부)은 통합에만
                if (!(cal ? calKeys.includes(cal) : calKeys.length === SHARED_CALS.length)) return;
                out.push({ kind: 'slip', date: sl.date, time: '', cal: cal || 'HQ', sl });
            });
        }
        if (cfg.showMoves) {
            const groups = new Map();
            (state.history || []).forEach(h => {
                const d = toDateKey(h.timestamp);
                if (!d || d < from || d > to) return;
                const cal = calOfLocation(h.toLoc !== '-' ? h.toLoc : h.fromLoc) || calOfLocation(h.fromLoc);
                const inAll = calKeys.length === SHARED_CALS.length;
                if (!(cal ? calKeys.includes(cal) : inAll)) return;
                const key = `${d}|${cal}`;
                if (!groups.has(key)) groups.set(key, { kind: 'moves', date: d, time: '', cal: cal || 'HQ', logs: [] });
                groups.get(key).logs.push(h);
            });
            out.push(...groups.values());
        }
        if (cfg.showProd) {
            prodRows.forEach(r => {
                if (r.status === 'SHIPPED') return;
                const cal = r.site === '김포' ? 'GIMPO' : 'HQ';
                if (!calKeys.includes(cal)) return;
                if (r.planDate && r.planDate >= from && r.planDate <= to && r.status !== 'DONE') out.push({ kind: 'prod', date: r.planDate, time: '', cal, r, what: 'plan' });
                if (r.dueDate && r.dueDate >= from && r.dueDate <= to) out.push({ kind: 'prod', date: r.dueDate, time: '', cal, r, what: 'due' });
            });
        }
        const rank = { sched: 0, prod: 1, slip: 2, moves: 3 };
        return out.sort((a, b) => a.date.localeCompare(b.date) || rank[a.kind] - rank[b.kind] || (a.time || '99').localeCompare(b.time || '99'));
    };

    const chipLabel = (e) => {
        if (e.kind === 'sched') return `${e.s.startTime ? `${e.s.startTime} ` : ''}${e.s.status === 'DONE' ? '✓ ' : ''}${e.s.title}${e.s.attachments?.length ? ' 📎' : ''}${e.s.slipNos?.length ? ' 📄' : ''}`;
        if (e.kind === 'slip') return `📄 ${e.sl.docNo} ${SLIP_TYPES[e.sl.type]?.label || ''}`;
        if (e.kind === 'prod') return `${e.what === 'due' ? '🚚 납품' : '🏭 포장'} ${e.r.partner ? `${e.r.partner} · ` : ''}${e.r.itemName}`;
        return `⇄ 입출고 ${e.logs.length}건`;
    };
    const chipHtml = (e, i, compact = true) => {
        const cls = e.kind === 'sched' ? CALS[e.cal]?.chip || CALS.HQ.chip : e.kind === 'slip' ? 'bg-amber-50 text-amber-800 border-amber-200'
            : e.kind === 'prod' ? (e.what === 'due' ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-indigo-50 text-indigo-800 border-indigo-200') : 'bg-slate-100 text-slate-600 border-slate-200';
        return `<button type="button" class="cal-ev w-full text-left px-1.5 py-0.5 rounded border ${cls} ${e.kind === 'sched' && e.s.status === 'DONE' ? 'opacity-50 line-through' : ''} ${compact ? 'truncate text-[10px]' : 'text-xs'} font-bold" data-ev="${i}" title="${esc(chipLabel(e))}">
            <span class="inline-block w-1.5 h-1.5 rounded-full ${CALS[e.cal]?.dot || 'bg-slate-400'} mr-1 align-middle"></span>${esc(chipLabel(e))}</button>`;
    };

    // ---------- 기간 ----------
    const range = () => {
        if (cfg.view === 'day') return { from: cursor, to: cursor };
        if (cfg.view === 'week') { const s = startOfWeek(cursor); return { from: s, to: addDays(s, 6) }; }
        const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        const s = startOfWeek(first);
        const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        return { from: s, to: addDays(startOfWeek(last), 6) };
    };
    const titleText = () => {
        if (cfg.view === 'day') return `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월 ${cursor.getDate()}일 (${WEEK[cursor.getDay()]})`;
        if (cfg.view === 'week') { const { from, to } = range(); return `${from.getMonth() + 1}월 ${from.getDate()}일 ~ ${to.getMonth() + 1}월 ${to.getDate()}일`; }
        return `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;
    };
    const move = (n) => {
        if (cfg.view === 'day') cursor = addDays(cursor, n);
        else if (cfg.view === 'week') cursor = addDays(cursor, 7 * n);
        else cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
        renderPanes();
    };

    // ---------- 레이아웃 ----------
    container.innerHTML = `
    <div class="space-y-4 text-xs">
        <div id="chat-inbox-panel"></div>
        <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm space-y-2.5">
            <div class="flex flex-wrap items-center gap-2">
                <div class="flex items-center gap-1">
                    <button type="button" id="cal-prev" class="p-1.5 bg-white border border-slate-300 rounded-lg" title="이전"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
                    <button type="button" id="cal-today" class="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold">오늘</button>
                    <button type="button" id="cal-next" class="p-1.5 bg-white border border-slate-300 rounded-lg" title="다음"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
                </div>
                <h2 id="cal-title" class="text-base font-black text-slate-900 min-w-[150px]"></h2>
                <div class="flex bg-slate-100 p-0.5 rounded-lg font-bold" id="cal-views">
                    ${[['day', '일간'], ['week', '주간'], ['month', '월간']].map(([k, t]) => `<button type="button" class="cal-view px-3 py-1 rounded-md" data-v="${k}">${t}</button>`).join('')}
                </div>
                <button type="button" id="cal-add" class="ml-auto px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black flex items-center gap-1"><i data-lucide="plus" class="w-4 h-4"></i>일정 등록</button>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <div class="flex bg-slate-100 p-0.5 rounded-lg font-bold" id="cal-layouts">
                    <button type="button" class="cal-layout px-3 py-1 rounded-md" data-l="merged">같이보기</button>
                    <button type="button" class="cal-layout px-3 py-1 rounded-md" data-l="split2">따로보기 2개</button>
                    <button type="button" class="cal-layout px-3 py-1 rounded-md" data-l="split3">따로보기 3개</button>
                </div>
                <div id="cal-merged-picks" class="flex flex-wrap items-center gap-1"></div>
                <span class="w-px h-5 bg-slate-200"></span>
                <label class="flex items-center gap-1 font-bold"><input type="checkbox" id="cal-slips" />발행 전표</label>
                <label class="flex items-center gap-1 font-bold"><input type="checkbox" id="cal-moves" />입출고</label>
                <label class="flex items-center gap-1 font-bold"><input type="checkbox" id="cal-prod" />생산스케줄</label>
                <label class="flex items-center gap-1 font-bold"><input type="checkbox" id="cal-done" />완료 일정</label>
            </div>
        </div>
        <div id="cal-panes" class="grid gap-3"></div>
        <!-- 캘린더 아래: 생산(포장) 스케줄표 -->
        <div id="prod-schedule"></div>
        <div id="cal-modal" class="hidden fixed inset-0 z-50 bg-slate-900/60 p-3 sm:p-6 overflow-y-auto items-start justify-center"></div>
    </div>`;
    const $ = (s) => container.querySelector(s);

    const syncToolbar = () => {
        $('#cal-title').textContent = titleText();
        container.querySelectorAll('.cal-view').forEach(b => b.className = `cal-view px-3 py-1 rounded-md ${b.dataset.v === cfg.view ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`);
        const lk = cfg.layout === 'merged' ? 'merged' : `split${cfg.paneCount}`;
        container.querySelectorAll('.cal-layout').forEach(b => b.className = `cal-layout px-3 py-1 rounded-md ${b.dataset.l === lk ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`);
        $('#cal-merged-picks').innerHTML = cfg.layout === 'merged'
            ? SHARED_CALS.map(k => `<button type="button" class="cal-mpick px-2 py-1 rounded-full border font-bold flex items-center gap-1 ${cfg.merged.includes(k) ? `${CALS[k].chip}` : 'bg-white text-slate-400 border-slate-200'}" data-k="${k}"><span class="w-2 h-2 rounded-full ${cfg.merged.includes(k) ? CALS[k].dot : 'bg-slate-300'}"></span>${CALS[k].label}</button>`).join('')
            : '<span class="text-slate-400">각 달력 위에서 캘린더를 고르세요</span>';
        container.querySelectorAll('.cal-mpick').forEach(b => b.addEventListener('click', () => {
            const k = b.dataset.k;
            cfg.merged = cfg.merged.includes(k) ? cfg.merged.filter(x => x !== k) : [...cfg.merged, k];
            if (!cfg.merged.length) cfg.merged = [k];
            persist();
            renderPanes();
        }));
        $('#cal-slips').checked = cfg.showSlips;
        $('#cal-moves').checked = cfg.showMoves;
        $('#cal-done').checked = cfg.showDone;
        $('#cal-prod').checked = cfg.showProd;
        createIcons({ icons });
    };

    // ---------- 달력 한 개 그리기 ----------
    let paneEvents = [];   // 이벤트 클릭용 (pane마다 목록)
    const paneHtml = (pi, calKeys, head) => {
        const { from, to } = range();
        const evs = eventsIn(calKeys, ds(from), ds(to));
        paneEvents[pi] = evs;
        const byDate = new Map();
        evs.forEach((e, i) => { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push({ e, i }); });
        const today = ds(new Date());
        let body = '';
        if (isMobile()) {
            // 스마트폰: 날짜별 카드 (일정이 있는 날만, 일간은 그날)
            const days = [];
            for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
                if (cfg.view === 'month' && !sameMonth(d, cursor)) continue;
                const k = ds(d);
                if (cfg.view !== 'day' && !byDate.has(k)) continue;
                days.push(d);
            }
            body = days.length ? days.map(d => {
                const k = ds(d);
                const list = byDate.get(k) || [];
                return `<div class="bg-white border ${k === today ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-slate-200'} rounded-2xl p-3 space-y-1.5 shadow-sm">
                    <button type="button" class="cal-day w-full flex items-center justify-between" data-d="${k}">
                        <span class="font-black ${d.getDay() === 0 ? 'text-rose-600' : d.getDay() === 6 ? 'text-blue-600' : 'text-slate-900'}">${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})${k === today ? ' · 오늘' : ''}</span>
                        <span class="text-slate-400">${list.length}건 ›</span>
                    </button>
                    ${list.map(({ e, i }) => chipHtml(e, i, false)).join('') || '<div class="text-slate-400">일정 없음</div>'}
                </div>`;
            }).join('') : '<div class="p-6 text-center text-slate-400 font-bold bg-white rounded-2xl border border-slate-200">이 기간에 일정이 없습니다.</div>';
            return `<div class="space-y-2" data-pane="${pi}">${head}${body}</div>`;
        }
        if (cfg.view === 'month') {
            const cells = [];
            for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
                const k = ds(d);
                const list = byDate.get(k) || [];
                const max = cfg.layout === 'merged' ? 4 : 3;
                cells.push(`<div class="cal-day min-h-[92px] p-1 border border-slate-100 ${sameMonth(d, cursor) ? 'bg-white' : 'bg-slate-50/70 text-slate-400'} ${k === today ? 'ring-2 ring-indigo-400 ring-inset' : ''} cursor-pointer hover:bg-indigo-50/40 space-y-0.5 overflow-hidden" data-d="${k}">
                    <div class="text-[11px] font-black ${d.getDay() === 0 ? 'text-rose-500' : d.getDay() === 6 ? 'text-blue-500' : ''}">${d.getDate()}</div>
                    ${list.slice(0, max).map(({ e, i }) => chipHtml(e, i)).join('')}
                    ${list.length > max ? `<div class="text-[10px] font-bold text-slate-500">+${list.length - max}개 더</div>` : ''}
                </div>`);
            }
            body = `<div class="grid grid-cols-7 text-center text-[11px] font-bold text-slate-500">${WEEK.map((w, i) => `<div class="py-1 ${i === 0 ? 'text-rose-500' : i === 6 ? 'text-blue-500' : ''}">${w}</div>`).join('')}</div>
                <div class="grid grid-cols-7 border border-slate-200 rounded-lg overflow-hidden">${cells.join('')}</div>`;
        } else if (cfg.view === 'week') {
            const cols = [];
            for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
                const k = ds(d);
                const list = byDate.get(k) || [];
                cols.push(`<div class="border border-slate-100 rounded-lg ${k === today ? 'ring-2 ring-indigo-400' : ''} bg-white flex flex-col min-h-[260px]">
                    <button type="button" class="cal-day px-1.5 py-1 border-b border-slate-100 text-left font-black ${d.getDay() === 0 ? 'text-rose-500' : d.getDay() === 6 ? 'text-blue-500' : 'text-slate-700'}" data-d="${k}">${WEEK[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}</button>
                    <div class="p-1 space-y-0.5 flex-1">${list.map(({ e, i }) => chipHtml(e, i)).join('')}</div>
                </div>`);
            }
            body = `<div class="grid grid-cols-7 gap-1">${cols.join('')}</div>`;
        } else {
            const k = ds(cursor);
            const list = byDate.get(k) || [];
            body = `<div class="space-y-1.5">${list.map(({ e, i }) => chipHtml(e, i, false)).join('') || '<div class="p-6 text-center text-slate-400 font-bold">이 날 일정이 없습니다.</div>'}
                <button type="button" class="cal-day w-full mt-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-slate-500 font-bold hover:bg-slate-50" data-d="${k}">이 날 자세히 보기 · 일정 추가</button></div>`;
        }
        return `<div class="bg-white p-2.5 rounded-2xl border border-slate-200 shadow-sm space-y-2 min-w-0" data-pane="${pi}">${head}${body}</div>`;
    };

    const renderPanes = () => {
        syncToolbar();
        const panesEl = $('#cal-panes');
        paneEvents = [];
        if (cfg.layout === 'merged') {
            panesEl.className = 'grid gap-3 grid-cols-1';
            panesEl.innerHTML = paneHtml(0, cfg.merged, `<div class="flex flex-wrap items-center gap-1.5 font-black text-slate-700">${cfg.merged.length === SHARED_CALS.length ? '<span>통합 캘린더</span>' : cfg.merged.map(k => `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full ${CALS[k].dot}"></span>${CALS[k].label}</span>`).join(' + ')}</div>`);
        } else {
            const n = cfg.paneCount;
            panesEl.className = `grid gap-3 grid-cols-1 ${n === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-2 2xl:grid-cols-3'}`;
            panesEl.innerHTML = Array.from({ length: n }, (_, pi) => {
                const key = cfg.panes[pi] || 'ALL';
                const head = `<div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full ${CALS[key].dot}"></span>
                    <select class="cal-pane-sel border border-slate-300 rounded-lg px-2 py-1 font-black" data-p="${pi}">${Object.entries(CALS).map(([k, v]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${v.label} 캘린더</option>`).join('')}</select></div>`;
                return paneHtml(pi, keysOf(key), head);
            }).join('');
            panesEl.querySelectorAll('.cal-pane-sel').forEach(s => s.addEventListener('change', () => { cfg.panes[Number(s.dataset.p)] = s.value; persist(); renderPanes(); }));
        }
        panesEl.querySelectorAll('[data-pane]').forEach(p => {
            const pi = Number(p.dataset.pane);
            const calKeys = cfg.layout === 'merged' ? cfg.merged : keysOf(cfg.panes[pi] || 'ALL');
            p.querySelectorAll('.cal-ev').forEach(b => b.addEventListener('click', (ev) => { ev.stopPropagation(); openEvent(paneEvents[pi][Number(b.dataset.ev)]); }));
            p.querySelectorAll('.cal-day').forEach(c => c.addEventListener('click', () => openDay(c.dataset.d, calKeys)));
        });
        createIcons({ icons });
    };

    // ---------- 모달 ----------
    const modal = () => $('#cal-modal');
    const openModal = (html) => { const m = modal(); m.innerHTML = html; m.classList.remove('hidden'); m.classList.add('flex'); createIcons({ icons }); };
    const closeModal = () => { const m = modal(); m.classList.add('hidden'); m.classList.remove('flex'); m.innerHTML = ''; };
    const box = (title, inner, wide = false) => `<div class="bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} my-4 text-xs overflow-hidden">
        <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between"><h3 class="font-black text-sm">${title}</h3>
            <button type="button" class="cal-close text-slate-300 hover:text-white text-xl leading-none px-1">&times;</button></div>
        <div class="p-4 space-y-3">${inner}</div></div>`;
    const bindClose = () => modal().querySelectorAll('.cal-close').forEach(b => b.addEventListener('click', closeModal));
    modal().addEventListener('click', (e) => { if (e.target === modal()) closeModal(); });

    const slipByNo = (no) => slips.find(s => s.docNo === no);
    const locText = (l) => String(l || '-');

    const openSlip = (sl) => {
        if (!sl) { alert('전표를 찾지 못했습니다. (최근 발행 전표만 볼 수 있습니다)'); return; }
        const t = SLIP_TYPES[sl.type] || {};
        openModal(box(`📄 ${esc(sl.docNo)} · ${esc(t.label || '')}`, `
            <div class="grid grid-cols-2 gap-2">
                <div><span class="text-slate-500 font-bold">발행일</span> <b>${esc(sl.date)}</b></div>
                <div><span class="text-slate-500 font-bold">담당</span> ${esc(sl.worker || '-')}</div>
                <div><span class="text-slate-500 font-bold">출발</span> <b>${esc(locText(sl.fromLoc))}</b></div>
                <div><span class="text-slate-500 font-bold">도착</span> <b>${esc(sl.partner ? `${sl.toLoc || ''} ${sl.partner}` : locText(sl.toLoc))}</b></div>
                <div class="col-span-2"><span class="text-slate-500 font-bold">사유</span> ${esc(sl.reason || '-')}</div>
            </div>
            <table class="w-full border border-slate-200 rounded-lg overflow-hidden"><thead class="bg-slate-50 font-bold text-slate-600"><tr><th class="p-1.5 text-left">품목코드</th><th class="p-1.5 text-left">품목명</th><th class="p-1.5 text-right">수량</th><th class="p-1.5">단위</th></tr></thead>
                <tbody class="divide-y divide-slate-100">${(sl.items || []).map(it => `<tr><td class="p-1.5 font-mono">${esc(it.code)}</td><td class="p-1.5 font-bold">${esc(it.name)}</td><td class="p-1.5 text-right font-black">${esc(it.qty)}</td><td class="p-1.5 text-center">${esc(it.unit || '')}</td></tr>`).join('')}</tbody></table>`, true));
        bindClose();
    };

    const openMoves = (date, logs) => {
        openModal(box(`⇄ ${esc(date)} 입출고 ${logs.length}건`, `
            <div class="max-h-[60vh] overflow-y-auto border border-slate-200 rounded-lg"><table class="w-full"><thead class="bg-slate-50 font-bold text-slate-600 sticky top-0"><tr><th class="p-1.5 text-left">구분</th><th class="p-1.5 text-left">품목</th><th class="p-1.5 text-right">수량</th><th class="p-1.5 text-left">위치</th><th class="p-1.5 text-left">사유</th></tr></thead>
            <tbody class="divide-y divide-slate-100">${logs.map(h => `<tr><td class="p-1.5 font-bold ${h.type === 'IN' ? 'text-blue-700' : h.type === 'MOVE' ? 'text-violet-700' : 'text-rose-700'}">${esc({ IN: '입고', OUT: '출고', USE: '사용', MOVE: '이동' }[h.type] || h.type)}</td>
                <td class="p-1.5"><div class="font-bold">${esc(h.name)}</div><div class="font-mono text-slate-400">${esc(h.code)}</div></td><td class="p-1.5 text-right font-black">${esc(h.qty)}</td>
                <td class="p-1.5">${esc(h.type === 'IN' ? h.toLoc : h.type === 'MOVE' ? `${h.fromLoc} → ${h.toLoc}` : h.fromLoc)}</td><td class="p-1.5 text-slate-500">${esc(h.reason || '')}</td></tr>`).join('')}</tbody></table></div>`, true));
        bindClose();
    };

    const attachmentsHtml = (list) => (list || []).map((a, i) => `<div class="flex items-center gap-2 p-1.5 border border-slate-200 rounded-lg" data-att="${i}">
        <div class="cal-att-thumb w-14 h-14 bg-slate-100 rounded flex items-center justify-center overflow-hidden shrink-0">${/^image\//.test(a.type) ? '<span class="text-slate-400">…</span>' : '<i data-lucide="file-text" class="w-6 h-6 text-slate-400"></i>'}</div>
        <div class="min-w-0 flex-1"><div class="font-bold truncate">${esc(a.name)}</div><div class="text-slate-400">${Math.round((a.size || 0) / 1024)} KB</div></div>
        <button type="button" class="cal-att-open px-2 py-1 bg-white border border-slate-300 rounded-lg font-bold">열기</button></div>`).join('');
    const bindAttachments = (root, list) => {
        root.querySelectorAll('[data-att]').forEach(async (row) => {
            const a = list[Number(row.dataset.att)];
            row.querySelector('.cal-att-open').addEventListener('click', async () => {
                try { const url = await calendarFileUrl(a); if (url.startsWith('data:')) { const w = window.open(); w?.document.write(/^image\//.test(a.type) ? `<img src="${url}" style="max-width:100%">` : `<iframe src="${url}" style="border:0;width:100%;height:100vh"></iframe>`); } else window.open(url, '_blank'); } catch (e) { alert(e.message); }
            });
            if (/^image\//.test(a.type)) {
                try { const url = await calendarFileUrl(a); row.querySelector('.cal-att-thumb').innerHTML = `<img src="${esc(url)}" class="w-full h-full object-cover" alt="" />`; } catch { /* 미리보기 생략 */ }
            }
        });
    };

    const openEvent = (e) => {
        if (!e) return;
        if (e.kind === 'slip') { openSlip(e.sl); return; }
        if (e.kind === 'moves') { openMoves(e.date, e.logs); return; }
        if (e.kind === 'prod') { closeModal(); window.__openProdScheduleRow?.(e.r.id); return; }
        const s = e.s;
        openModal(box(`<span class="inline-block w-2.5 h-2.5 rounded-full ${CALS[s.calendar || 'HQ'].dot} mr-1"></span>${esc(s.title)}`, `
            <div class="grid grid-cols-2 gap-2">
                <div><span class="text-slate-500 font-bold">캘린더</span> <b>${esc(CALS[s.calendar || 'HQ'].label)}</b>${s.calendar === 'PERSONAL' ? ` <span class="text-slate-400">(${esc(s.ownerName || '나')})</span>` : ''}</div>
                <div><span class="text-slate-500 font-bold">구분</span> <b>${esc(TYPES[s.type] || s.type || '-')}</b></div>
                <div><span class="text-slate-500 font-bold">일시</span> <b>${esc(s.date)}${s.startTime ? ` ${esc(s.startTime)}${s.endTime ? `~${esc(s.endTime)}` : ''}` : ' (종일)'}</b></div>
                <div><span class="text-slate-500 font-bold">상태</span> <b class="${s.status === 'DONE' ? 'text-emerald-700' : 'text-amber-700'}">${s.status === 'DONE' ? '완료' : '예정'}</b></div>
                ${s.itemName || s.itemCode ? `<div class="col-span-2"><span class="text-slate-500 font-bold">품목</span> <b>${esc(s.itemName)}</b> <span class="font-mono text-slate-400">${esc(s.itemCode || '')}</span></div>` : ''}
                ${s.partner ? `<div><span class="text-slate-500 font-bold">거래처</span> <b>${esc(s.partner)}</b></div>` : ''}
                ${s.worker ? `<div><span class="text-slate-500 font-bold">담당</span> <b>${esc(s.worker)}</b></div>` : ''}
            </div>
            ${s.notes ? `<div class="whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg p-2">${esc(s.notes)}</div>` : ''}
            ${s.slipNos?.length ? `<div><div class="font-bold text-slate-500 mb-1">연결한 전표</div><div class="flex flex-wrap gap-1">${s.slipNos.map(no => `<button type="button" class="cal-slip-link px-2 py-1 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg font-mono font-bold" data-no="${esc(no)}">📄 ${esc(no)}</button>`).join('')}</div></div>` : ''}
            ${s.attachments?.length ? `<div><div class="font-bold text-slate-500 mb-1">첨부 파일 ${s.attachments.length}개</div><div id="cal-atts" class="space-y-1.5">${attachmentsHtml(s.attachments)}</div></div>` : ''}
            <div class="flex flex-wrap gap-2 pt-1">
                <button type="button" id="cal-ev-toggle" class="px-3 py-1.5 ${s.status === 'DONE' ? 'bg-white border border-slate-300' : 'bg-emerald-600 text-white'} rounded-lg font-black">${s.status === 'DONE' ? '예정으로 되돌리기' : '✓ 완료 처리'}</button>
                <button type="button" id="cal-ev-edit" class="px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-black">수정</button>
                <button type="button" id="cal-ev-del" class="ml-auto px-3 py-1.5 bg-white border border-rose-300 text-rose-600 rounded-lg font-bold">삭제</button>
            </div>`, true));
        bindClose();
        const m = modal();
        m.querySelectorAll('.cal-slip-link').forEach(b => b.addEventListener('click', () => openSlip(slipByNo(b.dataset.no))));
        if (s.attachments?.length) bindAttachments(m.querySelector('#cal-atts'), s.attachments);
        m.querySelector('#cal-ev-toggle').addEventListener('click', async () => { try { await toggleScheduleStatus(s.id); closeModal(); renderPanes(); } catch (err) { alert(err.message); } });
        m.querySelector('#cal-ev-edit').addEventListener('click', () => openEditor(s));
        m.querySelector('#cal-ev-del').addEventListener('click', async () => {
            if (!confirm(`'${s.title}' 일정을 삭제할까요?${s.attachments?.length ? ' 첨부 파일도 함께 지웁니다.' : ''}`)) return;
            try {
                for (const a of s.attachments || []) await deleteCalendarFile(a).catch(() => {});
                await deleteSchedule(s.id);
                showToast('🗑️ 일정을 삭제했습니다.');
                closeModal();
                renderPanes();
            } catch (err) { alert(err.message); }
        });
    };

    const openDay = (date, calKeys) => {
        const evs = eventsIn(calKeys, date, date);
        const d = new Date(`${date}T00:00:00`);
        openModal(box(`${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`, `
            <div class="space-y-1.5">${evs.map((e, i) => chipHtml(e, i, false)).join('') || '<div class="p-4 text-center text-slate-400 font-bold">일정이 없습니다.</div>'}</div>
            <button type="button" id="cal-day-add" class="w-full px-3 py-2 bg-indigo-600 text-white rounded-lg font-black">+ 이 날 일정 등록</button>`));
        bindClose();
        modal().querySelectorAll('.cal-ev').forEach(b => b.addEventListener('click', () => openEvent(evs[Number(b.dataset.ev)])));
        modal().querySelector('#cal-day-add').addEventListener('click', () => openEditor(null, date, calKeys.length === 1 ? calKeys[0] : 'HQ'));
    };

    // ---------- 일정 등록·수정 ----------
    const openEditor = (orig, date = ds(cursor), defaultCal = 'HQ') => {
        const s = orig ? { ...orig, attachments: [...(orig.attachments || [])], slipNos: [...(orig.slipNos || [])] }
            : { id: `SCHED-${Date.now()}`, date, calendar: defaultCal, type: 'OTHER', title: '', startTime: '', endTime: '', itemCode: '', itemName: '', partner: '', worker: state.currentGlobalWorker || state.currentUser?.name || '', notes: '', status: 'TODO', attachments: [], slipNos: [] };
        const pending = [];      // 새로 고른 파일
        const removed = [];      // 지울 기존 첨부
        const draw = () => {
            openModal(box(orig ? '일정 수정' : '새 일정 등록', `
                <div class="grid grid-cols-2 gap-2">
                    <label class="block col-span-2"><span class="font-bold text-slate-600">캘린더</span>
                        <div class="mt-1 flex gap-1">${SHARED_CALS.map(k => `<button type="button" class="ce-cal flex-1 px-2 py-1.5 rounded-lg border font-bold flex items-center justify-center gap-1 ${s.calendar === k ? CALS[k].chip : 'bg-white text-slate-500 border-slate-200'}" data-k="${k}"><span class="w-2 h-2 rounded-full ${CALS[k].dot}"></span>${CALS[k].label}</button>`).join('')}</div>
                        ${s.calendar === 'PERSONAL' ? '<div class="text-[11px] text-violet-700 mt-0.5">개인 일정은 나만 봅니다.</div>' : ''}</label>
                    <label class="block"><span class="font-bold text-slate-600">일자 *</span><input type="date" id="ce-date" value="${esc(s.date)}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                    <label class="block"><span class="font-bold text-slate-600">구분</span><select id="ce-type" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                    <label class="block"><span class="font-bold text-slate-600">시작 시간 (선택)</span><input type="time" id="ce-start" value="${esc(s.startTime)}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                    <label class="block"><span class="font-bold text-slate-600">끝 시간 (선택)</span><input type="time" id="ce-end" value="${esc(s.endTime)}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                    <label class="block col-span-2"><span class="font-bold text-slate-600">제목 *</span><input type="text" id="ce-title" value="${esc(s.title)}" placeholder="예: 카밈 5W30 200박스 출하" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                    <label class="block col-span-2 relative"><span class="font-bold text-slate-600">품목 (선택)</span><input type="text" id="ce-item" value="${esc(s.itemCode ? `[${s.itemCode}] ${s.itemName}` : s.itemName)}" placeholder="코드·품목명 일부" autocomplete="off" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" />
                        <div id="ce-item-sg" class="hidden absolute left-0 right-0 top-full z-10 max-h-48 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl"></div></label>
                    <label class="block"><span class="font-bold text-slate-600">거래처</span><input type="text" id="ce-partner" list="ce-partner-list" value="${esc(s.partner)}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" />
                        <datalist id="ce-partner-list">${(state.partners || []).map(p => `<option value="${esc(typeof p === 'string' ? p : p.name)}"></option>`).join('')}</datalist></label>
                    <label class="block"><span class="font-bold text-slate-600">담당</span><input type="text" id="ce-worker" list="ce-worker-list" value="${esc(s.worker)}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" />
                        <datalist id="ce-worker-list">${(state.workers || []).map(w => `<option value="${esc(w.name)}"></option>`).join('')}</datalist></label>
                    <label class="block col-span-2"><span class="font-bold text-slate-600">메모</span><textarea id="ce-notes" rows="2" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5">${esc(s.notes)}</textarea></label>
                </div>
                <div class="p-2.5 bg-amber-50 border border-amber-200 rounded-xl space-y-1.5">
                    <div class="font-black text-amber-900">📄 WMS 전표 연결</div>
                    <div class="flex gap-1"><input type="text" id="ce-slip" list="ce-slip-list" placeholder="전표번호 (TR-…, RQ-…, WT-…)" class="flex-1 border border-amber-300 rounded-lg px-2 py-1 font-mono" />
                        <datalist id="ce-slip-list">${slips.slice(0, 200).map(sl => `<option value="${esc(sl.docNo)}">${esc(sl.date)} ${esc(SLIP_TYPES[sl.type]?.label || '')}</option>`).join('')}</datalist>
                        <button type="button" id="ce-slip-add" class="px-2.5 py-1 bg-amber-600 text-white rounded-lg font-black">연결</button></div>
                    <div class="flex flex-wrap gap-1">${s.slipNos.map((no, i) => `<span class="px-2 py-0.5 bg-white border border-amber-300 rounded-full font-mono font-bold">${esc(no)} <button type="button" class="ce-slip-del text-rose-500 font-black" data-i="${i}">×</button></span>`).join('')}</div>
                </div>
                <div class="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                    <div class="font-black text-slate-700">📎 첨부 파일 (전표 사진·PDF, 파일당 10MB)</div>
                    <label class="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold cursor-pointer"><i data-lucide="paperclip" class="w-3.5 h-3.5"></i>파일 선택 / 사진 찍기<input type="file" id="ce-files" multiple accept="image/*,application/pdf" class="hidden" /></label>
                    <div class="space-y-1">
                        ${s.attachments.map((a, i) => `<div class="flex items-center gap-2"><span class="truncate flex-1">📎 ${esc(a.name)}</span><button type="button" class="ce-att-del text-rose-500 font-bold" data-i="${i}">삭제</button></div>`).join('')}
                        ${pending.map((f, i) => `<div class="flex items-center gap-2 text-indigo-700"><span class="truncate flex-1">➕ ${esc(f.name)} (${Math.round(f.size / 1024)} KB)</span><button type="button" class="ce-pend-del text-rose-500 font-bold" data-i="${i}">빼기</button></div>`).join('')}
                    </div>
                </div>
                <div class="flex justify-end gap-2"><button type="button" class="cal-close px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold">취소</button>
                    <button type="button" id="ce-save" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black">${orig ? '저장' : '등록'}</button></div>`, true));
            bindClose();
            const m = modal();
            const capture = () => {
                s.date = m.querySelector('#ce-date').value;
                s.type = m.querySelector('#ce-type').value;
                s.startTime = m.querySelector('#ce-start').value;
                s.endTime = m.querySelector('#ce-end').value;
                s.title = m.querySelector('#ce-title').value.trim();
                s.partner = m.querySelector('#ce-partner').value.trim();
                s.worker = m.querySelector('#ce-worker').value.trim();
                s.notes = m.querySelector('#ce-notes').value;
                const itemText = m.querySelector('#ce-item').value.trim();
                if (!itemText) { s.itemCode = ''; s.itemName = ''; } else if (!s.itemCode || itemText !== `[${s.itemCode}] ${s.itemName}`) { s.itemCode = ''; s.itemName = itemText; }
            };
            m.querySelectorAll('.ce-cal').forEach(b => b.addEventListener('click', () => { capture(); s.calendar = b.dataset.k; draw(); }));
            const itemInp = m.querySelector('#ce-item');
            const sg = m.querySelector('#ce-item-sg');
            let found = [];
            itemInp.addEventListener('input', () => {
                found = itemInp.value.trim() ? searchMasterItems(itemInp.value, 15) : [];
                sg.innerHTML = found.map((it, i) => `<button type="button" data-i="${i}" class="w-full text-left px-2 py-1.5 border-b border-slate-100 hover:bg-indigo-50"><span class="font-mono font-bold">${esc(it.code)}</span> ${esc(it.name)}</button>`).join('');
                sg.classList.toggle('hidden', !found.length);
                sg.querySelectorAll('button').forEach(b => {
                    b.addEventListener('mousedown', (e) => e.preventDefault());
                    b.addEventListener('click', () => { const it = found[Number(b.dataset.i)]; s.itemCode = it.code; s.itemName = it.name; itemInp.value = `[${it.code}] ${it.name}`; sg.classList.add('hidden'); });
                });
            });
            itemInp.addEventListener('blur', () => setTimeout(() => sg.classList.add('hidden'), 150));
            m.querySelector('#ce-slip-add').addEventListener('click', () => {
                const no = m.querySelector('#ce-slip').value.trim().toUpperCase();
                if (!no) return;
                capture();
                if (!s.slipNos.includes(no)) s.slipNos.push(no);
                draw();
            });
            m.querySelectorAll('.ce-slip-del').forEach(b => b.addEventListener('click', () => { capture(); s.slipNos.splice(Number(b.dataset.i), 1); draw(); }));
            m.querySelector('#ce-files').addEventListener('change', (e) => { capture(); pending.push(...e.target.files); draw(); });
            m.querySelectorAll('.ce-pend-del').forEach(b => b.addEventListener('click', () => { capture(); pending.splice(Number(b.dataset.i), 1); draw(); }));
            m.querySelectorAll('.ce-att-del').forEach(b => b.addEventListener('click', () => { capture(); removed.push(...s.attachments.splice(Number(b.dataset.i), 1)); draw(); }));
            m.querySelector('#ce-save').addEventListener('click', async () => {
                capture();
                if (!s.date || !s.title) { alert('일자와 제목을 입력하세요.'); return; }
                const btn = m.querySelector('#ce-save');
                btn.disabled = true;
                btn.textContent = pending.length ? '파일 올리는 중…' : '저장 중…';
                try {
                    for (const f of pending) s.attachments.push(await uploadCalendarFile(s.id, f));
                    await saveSchedule(s);
                    for (const a of removed) await deleteCalendarFile(a).catch(() => {});
                    showToast(`📅 [${s.date}] '${s.title}' 일정을 ${orig ? '저장' : '등록'}했습니다.`);
                    closeModal();
                    renderPanes();
                } catch (err) {
                    alert(err.message);
                    btn.disabled = false;
                    btn.textContent = orig ? '저장' : '등록';
                }
            });
        };
        draw();
    };

    // ---------- 도구 모음 ----------
    $('#cal-prev').addEventListener('click', () => move(-1));
    $('#cal-next').addEventListener('click', () => move(1));
    $('#cal-today').addEventListener('click', () => { cursor = new Date(); renderPanes(); });
    container.querySelectorAll('.cal-view').forEach(b => b.addEventListener('click', () => { cfg.view = b.dataset.v; persist(); renderPanes(); }));
    container.querySelectorAll('.cal-layout').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.l === 'merged') cfg.layout = 'merged';
        else { cfg.layout = 'split'; cfg.paneCount = Number(b.dataset.l.slice(-1)); }
        persist();
        renderPanes();
    }));
    [['#cal-slips', 'showSlips'], ['#cal-moves', 'showMoves'], ['#cal-done', 'showDone'], ['#cal-prod', 'showProd']].forEach(([sel, k]) => $(sel).addEventListener('change', (e) => { cfg[k] = e.target.checked; persist(); renderPanes(); }));
    $('#cal-add').addEventListener('click', () => openEditor(null, ds(cursor), cfg.layout === 'merged' && cfg.merged.length === 1 ? cfg.merged[0] : 'HQ'));

    // 화면 폭이 바뀌면 (스마트폰 카드 ↔ 달력) 다시 그림
    let lastMobile = isMobile();
    const onResize = () => { if (!container.isConnected) { window.removeEventListener('resize', onResize); return; } if (isMobile() !== lastMobile) { lastMobile = isMobile(); renderPanes(); } };
    window.addEventListener('resize', onResize);

    renderPanes();
    renderChatInboxPanel($('#chat-inbox-panel'), { showToast, onScheduled: renderPanes });
    renderProdSchedule($('#prod-schedule'), { showToast, onChanged: (list) => { prodRows = list; renderPanes(); } });
    listSlips(300).then(list => { slips = list || []; renderPanes(); }).catch(() => { /* 전표 표시 생략 */ });
};
