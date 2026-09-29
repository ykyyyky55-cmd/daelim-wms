// ==========================================
// 지원 → 사용 정착 현황 (탭 usageBoard) — 계산은 services/usageStats.js
// ==========================================
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { localDateStr } from '../services/searchUtils.js';
import { isPublicHoliday } from '../services/holidays.js';
import { canAccessTab } from '../services/auth.js';
import { computeUsage, loadUsageExtras, USAGE_SITES } from '../services/usageStats.js';

const PREF = 'daelim_usage_board';
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return localDateStr(x); };
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const HIST_TYPE = { IN: '입고', OUT: '출고', USE: '사용', MOVE: '이동', ADJUST: '조정', AUDIT: '실사', PROD: '생산' };
const SLIP_TYPE = { RELEASE: '출고요청서', TRANSFER: '원부자재 이동', WAREHOUSE: '창고간 이동' };

export const renderUsageBoard = (container, { showToast = () => {}, onSwitchTab = () => {} } = {}) => {
    let pref = {};
    try { pref = JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { /* 기본값 */ }
    const today = localDateStr();
    let range = pref.range || '14';
    let site = pref.site || '';
    let extras = null, u = null;
    const period = () => {
        if (range === '7') return { from: addDays(today, -6), to: today };
        if (range === '14') return { from: addDays(today, -13), to: today };
        if (range === 'm') return { from: `${today.slice(0, 7)}-01`, to: today };
        const d = new Date(`${today.slice(0, 7)}-01T00:00:00`); d.setDate(0);
        const last = localDateStr(d);
        return { from: `${last.slice(0, 7)}-01`, to: last };
    };
    const save = () => { try { localStorage.setItem(PREF, JSON.stringify({ range, site })); } catch { /* 무시 */ } };

    container.innerHTML = `
    <section class="space-y-4 text-xs">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-teal-600 flex items-center gap-1"><i data-lucide="life-buoy" class="w-3.5 h-3.5"></i>지원 › 사용 정착 현황</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="activity" class="w-5 h-5 text-teal-600"></i>WMS 사용 정착 현황</h2>
                    <p class="text-xs text-slate-500 mt-1">기본업무(업무일지 · 입출고 · 수불부 · 전표)를 WMS로 입력하고 있는지 거점·사람별로 봅니다. 빠진 업무일지·수불부 미반영·재고 차이를 바로 찾아 들어갑니다.</p>
                </div>
                <button type="button" id="ub-reload" class="px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold flex items-center gap-1.5"><i data-lucide="refresh-cw" class="w-4 h-4"></i>새로고침</button>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <div class="flex bg-slate-100 p-1 rounded-xl">${[['7', '최근 7일'], ['14', '최근 14일'], ['m', '이번 달'], ['pm', '지난달']].map(([k, l]) => `<button type="button" data-r="${k}" class="ub-range tap-compact px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
                <div class="flex bg-slate-100 p-1 rounded-xl">${[['', '본사+김포'], ['HQ', '본사'], ['GIMPO', '김포']].map(([k, l]) => `<button type="button" data-s="${k}" class="ub-site tap-compact px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
                <span id="ub-period" class="text-slate-400 font-mono"></span>
            </div>
        </div>
        <div id="ub-body"><div class="p-8 text-center text-slate-400">불러오는 중…</div></div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    const openLog = (siteKey, date) => { window.__worklogInitialDate = { site: siteKey, date }; onSwitchTab(siteKey === 'HQ' ? 'hqLog' : 'gimpoLog'); };

    const draw = () => {
        const { from, to } = period();
        container.querySelectorAll('.ub-range').forEach(b => { b.className = `ub-range tap-compact px-3 py-1.5 rounded-lg font-black ${b.dataset.r === range ? 'bg-white shadow-sm text-teal-700' : 'text-slate-600'}`; });
        container.querySelectorAll('.ub-site').forEach(b => { b.className = `ub-site tap-compact px-3 py-1.5 rounded-lg font-black ${b.dataset.s === site ? 'bg-white shadow-sm text-teal-700' : 'text-slate-600'}`; });
        $('#ub-period').textContent = `${from} ~ ${to}`;
        if (!extras) return;
        u = computeUsage({ from, to, site }, extras);
        const t = u.totals;
        const kpi = (l, v, cls, sub = '') => `<div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm"><div class="text-[11px] font-bold text-slate-500">${l}</div><div class="text-xl font-black ${cls}">${v}</div>${sub ? `<div class="text-[10px] text-slate-400">${sub}</div>` : ''}</div>`;
        const wl = (k) => { const w = u.worklog[k]; if (!w) return ''; const tone = w.rate === null ? 'text-slate-400' : w.rate >= 90 ? 'text-emerald-700' : w.rate >= 60 ? 'text-amber-600' : 'text-rose-600'; return kpi(`${w.label} 업무일지 작성률`, w.rate === null ? '-' : `${Math.round(w.rate)}%`, tone, `평일 ${w.workdays}일 중 ${w.written}일${w.writtenToday ? ' · 오늘 작성됨' : ''}`); };
        const maxDay = Math.max(1, ...u.days.map(d => u.daily[d].history + u.daily[d].ledger + u.daily[d].slips));
        const userCount = u.people.filter(p => p.isUser).length;
        const logDot = (d, k) => {
            if (site && site !== k) return '';
            const off = [0, 6].includes(new Date(`${d}T00:00:00`).getDay()) || isPublicHoliday(d);
            const on = u.daily[d].logs[k];
            return `<button type="button" class="ub-log block w-full h-3 rounded-sm ${on ? 'bg-emerald-500' : off ? 'bg-slate-100' : d < today ? 'bg-rose-400' : 'bg-slate-200'}" data-site="${k}" data-date="${d}" title="${USAGE_SITES[k]} ${d} 업무일지 ${on ? '작성됨' : off ? '(휴일)' : d < today ? '미작성' : '오늘'}"></button>`;
        };
        $('#ub-body').innerHTML = `
        <div class="space-y-4">
            <div class="grid grid-cols-2 md:grid-cols-6 gap-3">
                ${wl('HQ')}${wl('GIMPO')}
                ${kpi('입출고 처리', `${t.history}건`, 'text-blue-700', Object.entries(u.histByType).map(([k, n]) => `${HIST_TYPE[k] || k} ${n}`).join(' · ') + (t.systemHistory ? ` (자동 ${t.systemHistory} 제외)` : ''))}
                ${kpi('수불부 전표', `${t.ledger}건`, 'text-indigo-700', `원료 ${u.ledgerByKind.raw} · 제품 ${u.ledgerByKind.product} · 자재 ${u.ledgerByKind.material}`)}
                ${kpi('발행 전표', `${t.slips}건`, 'text-violet-700', Object.entries(u.slipByType).map(([k, n]) => `${SLIP_TYPE[k] || k} ${n}`).join(' · '))}
                ${kpi('활동 인원', `${t.activePeople}명`, 'text-teal-700', `${userCount ? `사용자 ${userCount}명 중 · ` : ''}기록 있는 날 ${t.activeDays}일`)}
            </div>
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <div class="font-black text-slate-800 mb-2 flex items-center gap-1.5"><i data-lucide="list-checks" class="w-4 h-4 text-rose-500"></i>확인할 일</div>
                ${u.alerts.length ? `<div class="space-y-1.5">${u.alerts.map((a, i) => `<button type="button" class="ub-alert w-full text-left p-2 rounded-lg border ${a.level === 'red' ? 'bg-rose-50 border-rose-200' : a.level === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'} ${a.tab && canAccessTab(a.tab) ? 'hover:brightness-95' : 'cursor-default'}" data-i="${i}">
                    <div class="font-black ${a.level === 'red' ? 'text-rose-700' : a.level === 'amber' ? 'text-amber-800' : 'text-slate-700'}">${esc(a.text)}${a.tab && canAccessTab(a.tab) ? ' <span class="font-bold text-slate-400">열기 →</span>' : ''}</div>
                    ${a.sub ? `<div class="text-[11px] text-slate-600 mt-0.5 break-words">${esc(a.sub)}</div>` : ''}</button>`).join('')}</div>`
                    : '<div class="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-black">✅ 빠진 업무일지·미반영·재고 차이가 없습니다.</div>'}
            </div>
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
                <div class="font-black text-slate-800 mb-2 flex flex-wrap items-center gap-2"><i data-lucide="bar-chart-3" class="w-4 h-4 text-teal-600"></i>일자별 입력
                    <span class="text-[10px] font-bold text-slate-500 flex items-center gap-2"><span class="inline-block w-3 h-2 bg-blue-500 rounded-sm"></span>입출고 <span class="inline-block w-3 h-2 bg-indigo-400 rounded-sm"></span>수불부 <span class="inline-block w-3 h-2 bg-violet-400 rounded-sm"></span>전표 <span class="text-slate-300">|</span> 업무일지: <span class="inline-block w-3 h-2 bg-emerald-500 rounded-sm"></span>작성 <span class="inline-block w-3 h-2 bg-rose-400 rounded-sm"></span>미작성 (누르면 그 날 일지)</span></div>
                <div class="grid gap-1" style="grid-template-columns: 44px repeat(${u.days.length}, minmax(22px, 1fr)); min-width:${44 + u.days.length * 24}px">
                    <div></div>${u.days.map(d => { const x = u.daily[d]; const n = x.history + x.ledger + x.slips; const h = (v) => `${Math.round((v / maxDay) * 100)}%`; return `<div class="h-24 flex flex-col justify-end items-stretch" title="${d} · 입출고 ${x.history} · 수불부 ${x.ledger} · 전표 ${x.slips}">
                        <div class="text-[9px] text-center text-slate-500 font-bold">${n || ''}</div>
                        <div class="bg-violet-400 rounded-t-sm" style="height:${h(x.slips)}"></div><div class="bg-indigo-400" style="height:${h(x.ledger)}"></div><div class="bg-blue-500" style="height:${h(x.history)}"></div></div>`; }).join('')}
                    <div class="text-[10px] font-bold text-slate-500 self-center">날짜</div>${u.days.map(d => { const w = new Date(`${d}T00:00:00`).getDay(); return `<div class="text-center text-[10px] leading-tight ${d === today ? 'text-rose-600 font-black' : w === 0 || isPublicHoliday(d) ? 'text-rose-500' : w === 6 ? 'text-blue-500' : 'text-slate-600'}">${Number(d.slice(8))}<div class="text-[9px]">${DOW[w]}</div></div>`; }).join('')}
                    ${!site || site === 'HQ' ? `<div class="text-[10px] font-bold text-slate-500 self-center">본사 일지</div>${u.days.map(d => `<div>${logDot(d, 'HQ')}</div>`).join('')}` : ''}
                    ${!site || site === 'GIMPO' ? `<div class="text-[10px] font-bold text-slate-500 self-center">김포 일지</div>${u.days.map(d => `<div>${logDot(d, 'GIMPO')}</div>`).join('')}` : ''}
                </div>
            </div>
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="p-3 font-black text-slate-800 flex items-center gap-1.5"><i data-lucide="users" class="w-4 h-4 text-teal-600"></i>사람별 입력 <span class="text-[11px] font-bold text-slate-400">업무일지 = 작성자(담당) 칸 · 입출고·수불부·전표 = 작업자 이름 · 자동 처리(시스템) 제외</span></div>
                <div class="overflow-auto max-h-[60vh]"><table class="w-full">
                    <thead class="bg-slate-50 text-slate-600 font-bold sticky top-0"><tr><th class="p-2 text-left">이름</th><th class="p-2 text-left">부서</th><th class="p-2 text-right">업무일지</th><th class="p-2 text-right">입출고</th><th class="p-2 text-right">수불부</th><th class="p-2 text-right">전표</th><th class="p-2 text-right">합계</th><th class="p-2 text-left">마지막 기록</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">${u.people.map(p => `<tr class="${p.total ? '' : 'bg-rose-50/40'}">
                        <td class="p-2 font-black text-slate-900 whitespace-nowrap">${esc(p.name)}${p.isUser ? '' : ' <span class="text-[10px] font-bold text-slate-400">(계정 없음)</span>'}</td><td class="p-2 text-slate-500">${esc(p.dept)}</td>
                        <td class="p-2 text-right">${p.logs || ''}</td><td class="p-2 text-right">${p.history || ''}</td><td class="p-2 text-right">${p.ledger || ''}</td><td class="p-2 text-right">${p.slips || ''}</td>
                        <td class="p-2 text-right font-black ${p.total ? 'text-teal-700' : 'text-rose-600'}">${p.total || '기록 없음'}</td><td class="p-2 font-mono text-slate-500">${esc(p.last)}</td></tr>`).join('') || '<tr><td colspan="8" class="p-6 text-center text-slate-400">기록이 없습니다.</td></tr>'}</tbody>
                </table></div>
            </div>
        </div>`;
        container.querySelectorAll('.ub-log').forEach(b => b.addEventListener('click', () => { if (canAccessTab(b.dataset.site === 'HQ' ? 'hqLog' : 'gimpoLog')) openLog(b.dataset.site, b.dataset.date); }));
        container.querySelectorAll('.ub-alert').forEach(b => b.addEventListener('click', () => {
            const a = u.alerts[Number(b.dataset.i)];
            if (!a?.tab || !canAccessTab(a.tab)) return;
            if (a.site && a.date) openLog(a.site, a.date); else onSwitchTab(a.tab);
        }));
        createIcons({ icons });
    };

    const load = async () => {
        $('#ub-body').innerHTML = '<div class="p-8 text-center text-slate-400">불러오는 중…</div>';
        try { extras = await loadUsageExtras(period()); } catch (e) { extras = { slips: [], users: [] }; showToast(`⚠️ 전표·사용자 목록을 받지 못했습니다: ${e.message}`); }
        draw();
    };
    container.querySelectorAll('.ub-range').forEach(b => b.addEventListener('click', () => { const prevFrom = period().from; range = b.dataset.r; save(); if (period().from < prevFrom) load(); else draw(); }));
    container.querySelectorAll('.ub-site').forEach(b => b.addEventListener('click', () => { site = b.dataset.s; save(); draw(); }));
    $('#ub-reload').addEventListener('click', load);
    createIcons({ icons });
    load();
};
