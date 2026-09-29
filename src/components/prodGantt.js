// ==========================================
// 생산(포장) 스케줄 — 간트(달력) 보기 (ProdScheduleTable의 '간트' 보기)
// ==========================================
// 줄 하나 = 가로 한 줄. 막대 = 생산 기간(생산 시작~완료, 없으면 포장계획일 하루, 생산중이면 오늘까지),
// ◆ = 납품예정일(지남 빨강·7일 안 주황), 🚚 = 출고일, 옅은 선 = 수주일~납품예정일.
// 막대를 좌우로 끌면 포장계획일(과 생산 시작·완료일)을 그 일수만큼 옮긴다 (완료·출고완료 줄은 고정).
import { esc } from '../services/html.js';
import { localDateStr } from '../services/searchUtils.js';
import { holidayOf } from '../services/holidays.js';

const PREF_KEY = 'daelim_prod_gantt';
export const GANTT_RANGES = [[14, '2주'], [28, '4주'], [56, '8주']];
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const BAR_CLS = {
    HOLD: 'bg-slate-400', PLANNED: 'bg-indigo-400', PREP: 'bg-amber-400', PRODUCING: 'bg-blue-600', DONE: 'bg-emerald-500', SHIPPED: 'bg-slate-300'
};
const DAY_MS = 86400000;
const parse = (s) => new Date(`${s}T00:00:00`);
export const shiftDate = (s, n) => { if (!s) return s; const d = parse(s); d.setDate(d.getDate() + n); return localDateStr(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY_MS);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const md = (s) => (s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : '');
const fmt = (n) => (n === '' || n == null ? '' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }));

/** 막대 기간 {start, end} (날짜가 하나도 없으면 null) */
export const ganttSpanOf = (r, today = localDateStr()) => {
    const s = [r.prodStart, r.planDate].find(isDate);
    if (!s) return null;
    let e = [r.prodEnd].find(isDate) || (r.status === 'PRODUCING' ? (today > s ? today : s) : (isDate(r.planDate) && r.planDate > s ? r.planDate : s));
    return e < s ? { start: e, end: s } : { start: s, end: e };
};

/** 끌어 옮길 때 바뀌는 날짜 칸 (있는 것만) */
export const movedRow = (r, days) => {
    const next = { ...r };
    ['planDate', 'prodStart', 'prodEnd'].forEach(k => { if (isDate(r[k])) next[k] = shiftDate(r[k], days); });
    if (next.planDate !== r.planDate && r.planText) next.planText = '';
    return next;
};

const readPref = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } };
const savePref = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* 기기 저장 불가: 기본값으로 */ } };
const mondayOf = (s) => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDateStr(d); };

/** 간트 보기 상태 (ProdScheduleTable이 draw 사이에 들고 있음) */
export const createGanttState = () => {
    const pref = readPref();
    const today = localDateStr();
    return { days: GANTT_RANGES.some(([d]) => d === pref.days) ? pref.days : 28, start: shiftDate(mondayOf(today), -7) };
};

/**
 * @param {HTMLElement} host
 * @param {{ groups: {key: string, rows: Object[]}[], gs: {days: number, start: string}, today: string,
 *   canMove: (r: Object) => boolean, onOpen: (r: Object) => void, onMove: (r: Object, days: number) => void }} opts
 */
export const renderGantt = (host, { groups, gs, today = localDateStr(), canMove = () => false, onOpen = () => {}, onMove = () => {} }) => {
    const narrow = window.matchMedia('(max-width: 639px)').matches;
    const LEFT = narrow ? 140 : 250;
    const dayW = gs.days <= 14 ? 46 : gs.days <= 28 ? 30 : 17;
    const W = gs.days * dayW;
    const days = Array.from({ length: gs.days }, (_, i) => shiftDate(gs.start, i));
    const end = days[days.length - 1];
    const xOf = (d) => diffDays(gs.start, d) * dayW;
    const inRange = (d) => d >= gs.start && d <= end;
    const dated = groups.map(g => ({ ...g, rows: g.rows.filter(r => ganttSpanOf(r, today) || isDate(r.dueDate) || isDate(r.shipDate)) })).filter(g => g.rows.length);
    const undated = groups.flatMap(g => g.rows).filter(r => !ganttSpanOf(r, today) && !isDate(r.dueDate) && !isDate(r.shipDate));
    const count = dated.reduce((n, g) => n + g.rows.length, 0);

    // 머리: 월 / 일·요일
    const months = [];
    days.forEach((d, i) => { const m = d.slice(0, 7); if (!months.length || months[months.length - 1].m !== m) months.push({ m, i, n: 1 }); else months[months.length - 1].n += 1; });
    const dayTone = (d) => { const h = holidayOf(d); const w = parse(d).getDay(); return h && h.kind !== 'company' ? 'hol' : w === 0 ? 'sun' : w === 6 ? 'sat' : h ? 'co' : ''; };
    const head = `
        <div class="flex sticky top-0 z-20 bg-slate-100 border-b border-slate-200" style="width:${LEFT + W}px">
            <div class="sticky left-0 z-30 bg-slate-100 border-r border-slate-200 p-1.5 font-black text-slate-600 flex items-end" style="width:${LEFT}px;min-width:${LEFT}px">거래처 · 품명 · 수량</div>
            <div style="width:${W}px">
                <div class="flex border-b border-slate-200">${months.map(x => `<div class="px-1 py-0.5 text-[10px] font-black text-slate-700 border-r border-slate-200 truncate" style="width:${x.n * dayW}px">${Number(x.m.slice(5))}월</div>`).join('')}</div>
                <div class="flex">${days.map(d => { const t = dayTone(d); const h = holidayOf(d); return `<div class="text-center border-r border-slate-200 leading-tight py-0.5 ${d === today ? 'bg-rose-500 text-white' : t === 'sun' || t === 'hol' ? 'text-rose-600' : t === 'sat' ? 'text-blue-600' : t === 'co' ? 'text-orange-600' : 'text-slate-600'}" style="width:${dayW}px" title="${esc(d)}${h ? ` ${esc(h.name)}` : ''}"><div class="text-[10px] font-black">${Number(d.slice(8))}</div>${dayW >= 26 ? `<div class="text-[9px]">${DOW[parse(d).getDay()]}</div>` : ''}</div>`; }).join('')}</div>
            </div>
        </div>`;

    const statusLabel = { HOLD: '보류', PLANNED: '예정', PREP: '부자재 준비', PRODUCING: '생산중', DONE: '완료·출고대기', SHIPPED: '출고완료' };
    const edgeMark = (side) => `<span class="absolute top-1/2 -translate-y-1/2 ${side === 'l' ? 'left-0' : 'right-0'} text-[10px] font-black text-slate-500">${side === 'l' ? '‹' : '›'}</span>`;
    const rowHtml = (r) => {
        const span = ganttSpanOf(r, today);
        const parts = [];
        // 수주일 ~ 납품예정일 (옅은 선)
        if (isDate(r.orderDate) && isDate(r.dueDate) && r.orderDate <= r.dueDate && r.dueDate >= gs.start && r.orderDate <= end) {
            const a = Math.max(0, xOf(r.orderDate)), b = Math.min(W, xOf(r.dueDate) + dayW);
            parts.push(`<div class="absolute h-0.5 bg-slate-300 rounded" style="left:${a}px;width:${Math.max(2, b - a)}px;bottom:5px" title="수주 ${md(r.orderDate)} ~ 납품예정 ${md(r.dueDate)}"></div>`);
        }
        if (span && span.end >= gs.start && span.start <= end) {
            const a = xOf(span.start), b = xOf(span.end) + dayW;
            const left = Math.max(0, a), right = Math.min(W, b);
            const late = isDate(r.dueDate) && span.end > r.dueDate && r.status !== 'SHIPPED';
            const movable = canMove(r);
            parts.push(`<div class="gt-bar absolute top-1.5 h-5 rounded-md shadow-sm ${BAR_CLS[r.status] || 'bg-indigo-400'} ${late ? 'ring-2 ring-rose-500' : ''} ${movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} text-white text-[10px] font-black px-1 overflow-hidden whitespace-nowrap flex items-center select-none touch-none"
                data-id="${esc(r.id)}" data-move="${movable ? 1 : ''}" style="left:${left + 1}px;width:${Math.max(6, right - left - 2)}px"
                title="${esc([r.partner, r.itemName].filter(Boolean).join(' · '))}\n${statusLabel[r.status] || r.status} · ${md(span.start)}${span.end !== span.start ? `~${md(span.end)}` : ''}${late ? ' (납기 넘김)' : ''}${movable ? '\n좌우로 끌면 포장계획일을 옮깁니다' : ''}">${a < 0 ? '‹ ' : ''}${right - left >= 40 ? `${fmt(r.qty)}` : ''}${b > W ? ' ›' : ''}</div>`);
        } else if (span) parts.push(edgeMark(span.end < gs.start ? 'l' : 'r'));
        if (isDate(r.dueDate) && inRange(r.dueDate)) {
            const over = r.dueDate < today && r.status !== 'SHIPPED';
            const soon = !over && r.status !== 'SHIPPED' && diffDays(today, r.dueDate) <= 7;
            parts.push(`<div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[13px] leading-none ${over ? 'text-rose-600' : soon ? 'text-amber-500' : 'text-slate-700'}" style="left:${xOf(r.dueDate) + dayW / 2}px" title="납품예정 ${md(r.dueDate)}${r.dueText && r.dueText !== r.dueDate ? ` (${esc(r.dueText)})` : ''}${over ? ' — 지남' : ''}">◆</div>`);
        }
        if (isDate(r.shipDate) && inRange(r.shipDate)) parts.push(`<div class="absolute top-0 -translate-x-1/2 text-[11px]" style="left:${xOf(r.shipDate) + dayW / 2}px" title="출고 ${md(r.shipDate)}">🚚</div>`);
        return `<div class="flex border-b border-slate-100 hover:bg-indigo-50/40" style="width:${LEFT + W}px">
            <button type="button" class="gt-open sticky left-0 z-10 bg-white border-r border-slate-200 px-1.5 py-1 text-left leading-tight hover:bg-indigo-50" style="width:${LEFT}px;min-width:${LEFT}px" data-id="${esc(r.id)}">
                <div class="flex items-center gap-1 truncate"><span class="inline-block w-2 h-2 rounded-full ${BAR_CLS[r.status] || 'bg-slate-300'} shrink-0"></span><span class="font-bold text-slate-500 truncate">${esc(r.partner || '')}</span></div>
                <div class="font-black text-slate-900 truncate">${esc(r.itemName)} <span class="text-slate-500 font-mono">${fmt(r.qty)}</span></div>
            </button>
            <div class="relative h-8" style="width:${W}px">${parts.join('')}</div>
        </div>`;
    };
    const overlay = days.map((d, i) => { const t = dayTone(d); return t || d === today ? `<div class="absolute top-0 bottom-0 ${d === today ? 'border-l-2 border-rose-400 bg-rose-50/40' : t === 'co' ? 'bg-orange-50' : 'bg-slate-100/70'}" style="left:${LEFT + i * dayW}px;width:${dayW}px"></div>` : ''; }).join('');

    host.innerHTML = `
        <div class="flex flex-wrap items-center gap-2 mb-2">
            <div class="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 font-bold">${GANTT_RANGES.map(([d, l]) => `<button type="button" class="gt-range tap-compact px-2.5 py-1 rounded-md ${gs.days === d ? 'bg-white text-indigo-700 shadow-sm font-black' : 'text-slate-600'}" data-d="${d}">${l}</button>`).join('')}</div>
            <div class="flex items-center gap-1 font-bold">
                <button type="button" class="gt-shift min-w-[36px] px-2 py-1 rounded-lg border border-slate-300 bg-white" data-n="-7" title="1주 앞으로">◀</button>
                <button type="button" class="gt-today px-2.5 py-1 rounded-lg border border-slate-300 bg-white">오늘</button>
                <button type="button" class="gt-shift min-w-[36px] px-2 py-1 rounded-lg border border-slate-300 bg-white" data-n="7" title="1주 뒤로">▶</button>
                <span class="ml-1 font-mono text-slate-600">${md(gs.start)} ~ ${md(end)}</span>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-[10px] text-slate-600 ml-auto">
                ${Object.entries(statusLabel).map(([k, l]) => `<span class="flex items-center gap-1"><span class="inline-block w-3 h-2 rounded-sm ${BAR_CLS[k]}"></span>${l}</span>`).join('')}
                <span><b class="text-slate-700">◆</b> 납품예정 (<b class="text-rose-600">지남</b>·<b class="text-amber-500">7일 안</b>)</span><span>🚚 출고</span><span class="flex items-center gap-1"><span class="inline-block w-4 h-0.5 bg-slate-300"></span>수주~납기</span><span class="px-1 rounded ring-2 ring-rose-500">납기 넘김</span>
            </div>
        </div>
        <div class="overflow-auto border border-slate-200 rounded-xl max-h-[75vh] text-[11px]">
            <div class="relative" style="width:${LEFT + W}px">
                ${head}
                <div class="relative">
                    <div class="pointer-events-none absolute inset-0">${overlay}</div>
                    <div class="relative">
                        ${dated.map(g => `<div class="flex bg-indigo-50/90 border-b border-indigo-100" style="width:${LEFT + W}px"><div class="sticky left-0 px-2 py-1 font-black text-indigo-900 whitespace-nowrap">${esc(g.key)} <span class="font-bold text-indigo-500">(${g.rows.length}줄)</span></div></div>${g.rows.map(rowHtml).join('')}`).join('')
                            || '<div class="p-8 text-center text-slate-400 font-bold sticky left-0">날짜(포장계획·생산·납품예정·출고)가 있는 줄이 없습니다.</div>'}
                    </div>
                </div>
            </div>
        </div>
        ${undated.length ? `<div class="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-xl"><div class="font-black text-amber-900 mb-1">날짜 미정 ${undated.length}줄 <span class="font-bold text-amber-700">— 누르면 수정 창에서 포장계획·납품예정일을 넣습니다</span></div>
            <div class="flex flex-wrap gap-1">${undated.map(r => `<button type="button" class="gt-open px-2 py-1 rounded-lg bg-white border border-amber-200 hover:bg-amber-100 text-left" data-id="${esc(r.id)}"><b>${esc(r.itemName)}</b> ${fmt(r.qty)} <span class="text-slate-500">${esc(r.partner || '')}${r.planText || r.dueText ? ` · ${esc([r.planText, r.dueText].filter(Boolean).join(' / '))}` : ''}</span></button>`).join('')}</div></div>` : ''}
        <div class="mt-1 text-[10px] text-slate-400">${count}줄 표시 · 막대 = 생산 시작~완료(없으면 포장계획일, 생산중은 오늘까지) · 막대를 누르면 수정 창, 좌우로 끌면 포장계획일 이동</div>`;

    const redraw = () => renderGantt(host, { groups, gs, today, canMove, onOpen, onMove });
    const rowOf = (id) => groups.flatMap(g => g.rows).find(r => r.id === id);
    host.querySelectorAll('.gt-range').forEach(b => b.addEventListener('click', () => { gs.days = Number(b.dataset.d); savePref({ days: gs.days }); redraw(); }));
    host.querySelectorAll('.gt-shift').forEach(b => b.addEventListener('click', () => { gs.start = shiftDate(gs.start, Number(b.dataset.n)); redraw(); }));
    host.querySelector('.gt-today').addEventListener('click', () => { gs.start = shiftDate(mondayOf(today), -7); redraw(); });
    host.querySelectorAll('.gt-open').forEach(b => b.addEventListener('click', () => { const r = rowOf(b.dataset.id); if (r) onOpen(r); }));
    // 막대: 누르면 열기, 끌면 날짜 이동 (일 단위로 맞춤)
    host.querySelectorAll('.gt-bar').forEach(bar => {
        let x0 = null, moved = 0;
        bar.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            x0 = e.clientX; moved = 0;
            bar.setPointerCapture(e.pointerId);
        });
        bar.addEventListener('pointermove', (e) => {
            if (x0 === null || !bar.dataset.move) return;
            moved = Math.round((e.clientX - x0) / dayW);
            bar.style.transform = `translateX(${moved * dayW}px)`;
            bar.style.opacity = moved ? '0.75' : '';
        });
        const finish = () => {
            if (x0 === null) return;
            x0 = null;
            bar.style.transform = ''; bar.style.opacity = '';
            const r = rowOf(bar.dataset.id);
            if (!r) return;
            if (moved) onMove(r, moved); else onOpen(r);
        };
        bar.addEventListener('pointerup', finish);
        bar.addEventListener('pointercancel', () => { x0 = null; bar.style.transform = ''; bar.style.opacity = ''; });
    });
};
