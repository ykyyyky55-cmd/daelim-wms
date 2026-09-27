import { state, getGimpoSyncStatistics, syncAllUnsyncedGimpoLogs } from '../services/db.js';
import Chart from 'chart.js/auto';
import { applyChartTheme, isDarkTheme } from '../services/darkTheme.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { canPerformAction } from '../services/auth.js';

// 월간 생산공급망 실적 현황판: 업무일지(본사·김포)를 월별로 모아 본다
// - 보기: 전체(본사+김포) / 본사 / 김포 — 기기별 기억(daelim_analytics_view)
// - 핵심 지표: 완제품 포장(EA)·원액 생산(L)·라벨부착(EA)·투입공수(유형별)·포장 생산성·이동/입출고/발주, 전월 일평균 대비 증감
// - 완제품 포장: 일자별(거점별 막대 + 포장 공수 선) · 카테고리별 · TOP 10 품목
// - 원액 생산(따로): 일자별(거점별 막대 + 원액 공수 선) · 원액 품목별(L·배치·공수·L/공수)
// - 작업공수 분석: 일자별 유형별(포장·원액·라벨·기타업무) 누적 막대 · 유형별 합계·비율·일평균
// - 기타업무 종류별 취합: 업무명을 낱말로 종류에 묶어 건수·일수·총작업시간·공수, 업무명별 상세
// - 표: 일자·거점별 실적 원장 (누르면 그 날 업무일지로 이동), 엑셀(일자별·품목별·원액·공수 유형·기타업무 시트)
const SITES = { HQ: { label: '본사', color: '#2563eb', tab: 'hqLog', key: 'hqLogs' }, GIMPO: { label: '김포', color: '#059669', tab: 'gimpoLog', key: 'gimpoLogs' } };
const WORK_TYPES = [
    ['pack', '제품포장', '#3b82f6'], ['oil', '원액생산', '#f59e0b'], ['label', '라벨부착', '#8b5cf6'], ['other', '기타업무', '#64748b']
];
// 기타업무 종류: 업무명에 든 낱말로 묶는다 (위에서부터 먼저 맞는 종류)
const TASK_TYPES = [
    ['택배·출고 지원', /택배|출고|상차|납품|출하/],
    ['포장·재포장 지원', /포장|재포장|박스교체|덧방|전수검사|세트/],
    ['라벨·씰링 작업', /라벨|씰링|스티커|마킹|인쇄/],
    ['물류·하역·이동', /하역|물류|이동|파렛트|운반|적재/],
    ['설비 점검·정비', /점검|정비|고장|수리|교체|교정|충진기|기계|설비/],
    ['정리·청소·환경', /정리|청소|정돈|제초|잡초|환기|야외|방역/],
    ['전산·서류·회의', /전산|입력|서류|일지|이카운트|GWS|미팅|회의|소통|교육/],
    ['자재·업무 지원', /자재|지원|식별/]
];
const taskTypeOf = (name) => (TASK_TYPES.find(([, re]) => re.test(String(name || ''))) || ['기타'])[0];
const VIEW_KEY = 'daelim_analytics_view';
const charts = {};
const BASE_ANIMATION = Chart.defaults.animation;
const sum = (rows, k) => (rows || []).reduce((s, r) => s + (Number(r[k]) || 0), 0);
const fmt = (n, d = 0) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: d });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const prevMonthOf = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const itemName = (t) => String(t || '').replace(/^[0-9A-Za-z-]{4,}\s*\/\s*/, '').trim() || String(t || '');

// 일지 하나의 요약
const summarize = (log, site) => {
    const pk = log.packaging || [], ob = log.oilBlending || [], lb = log.labeling || [], ot = log.otherTasks || [];
    const mh = { pack: sum(pk, 'manHours'), oil: sum(ob, 'manHours'), label: sum(lb, 'manHours'), other: sum(ot, 'manHours') };
    return {
        site, date: log.date, log,
        pack: sum(pk, 'qty'), packBox: sum(pk, 'box'), packLines: pk.filter(r => Number(r.qty) > 0).length,
        oil: sum(ob, 'qty'), oilBatches: ob.filter(r => Number(r.qty) > 0).length,
        label: sum(lb, 'qty'),
        mhPack: mh.pack, mhOil: mh.oil, mhLabel: mh.label, mhOther: mh.other,
        manHours: mh.pack + mh.oil + mh.label + mh.other,
        otherCount: ot.length,
        moves: (log.movement || []).filter(r => Number(r.qty) > 0).length,
        recv: (log.receiving || []).length, ship: (log.shipping || []).length, po: (log.purchaseOrders || []).length,
        courier: sum(log.courier || [], 'count'),
        synced: !!log.isSyncedToLedger
    };
};
const TOTAL_KEYS = ['pack', 'packBox', 'packLines', 'oil', 'oilBatches', 'label', 'mhPack', 'mhOil', 'mhLabel', 'mhOther', 'manHours', 'otherCount', 'moves', 'recv', 'ship', 'po', 'courier'];
const total = (days) => {
    const t = Object.fromEntries(TOTAL_KEYS.map(k => [k, 0]));
    t.synced = 0; t.days = days.length;
    days.forEach(d => { TOTAL_KEYS.forEach(k => { t[k] += Number(d[k]) || 0; }); if (d.synced) t.synced++; });
    return t;
};
const mhKey = { pack: 'mhPack', oil: 'mhOil', label: 'mhLabel', other: 'mhOther' };

export const renderAnalytics = (container) => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); } catch { saved = {}; }
    let view = ['ALL', 'HQ', 'GIMPO'].includes(saved.view) ? saved.view : 'ALL';
    let selectedMonth = '';

    const allDays = () => Object.entries(SITES).flatMap(([site, s]) => (state[s.key] || []).filter(l => l.date).map(l => summarize(l, site)));

    const renderView = () => {
        try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view })); } catch { /* 무시 */ }
        const every = allDays();
        const inView = (d) => view === 'ALL' || d.site === view;
        const months = [...new Set(every.map(d => d.date.slice(0, 7)))].sort().reverse();
        if (!selectedMonth || (selectedMonth !== 'ALL' && !months.includes(selectedMonth))) selectedMonth = months[0] || 'ALL';
        const inMonth = (d, ym) => ym === 'ALL' || d.date.startsWith(ym);
        const days = every.filter(d => inView(d) && inMonth(d, selectedMonth)).sort((a, b) => a.date.localeCompare(b.date) || a.site.localeCompare(b.site));
        const t = total(days);
        const prevList = selectedMonth !== 'ALL' ? every.filter(d => inView(d) && inMonth(d, prevMonthOf(selectedMonth))) : [];
        const prev = selectedMonth !== 'ALL' ? total(prevList) : null;
        const bySite = Object.fromEntries(Object.keys(SITES).map(k => [k, total(days.filter(d => d.site === k))]));
        const workDays = new Set(days.map(d => d.date)).size;
        // 전월 비교는 작업일 1일 평균 기준 (전월 일지가 일부만 있어도 왜곡되지 않게)
        const prevDays = new Set(prevList.map(d => d.date)).size;
        const packProd = t.mhPack ? t.pack / t.mhPack : 0;
        const prevPackProd = prev && prev.mhPack ? prev.pack / prev.mhPack : 0;
        const oilProd = t.mhOil ? t.oil / t.mhOil : 0;

        // 품목별·카테고리별 포장
        const productMap = new Map();
        const categoryMap = new Map();
        days.forEach(d => (d.log.packaging || []).forEach(p => {
            const q = Number(p.qty) || 0;
            if (!p.item || q <= 0) return;
            const e = productMap.get(p.item) || { item: p.item, qty: 0, box: 0, manHours: 0, HQ: 0, GIMPO: 0, category: p.category || '' };
            e.qty += q; e.box += Number(p.box) || 0; e.manHours += Number(p.manHours) || 0; e[d.site] += q;
            productMap.set(p.item, e);
            const c = p.category || '미분류';
            categoryMap.set(c, (categoryMap.get(c) || 0) + q);
        }));
        const products = [...productMap.values()].sort((a, b) => b.qty - a.qty);
        const categories = [...categoryMap.entries()].sort((a, b) => b[1] - a[1]);

        // 원액 품목별
        const oilMap = new Map();
        days.forEach(d => (d.log.oilBlending || []).forEach(o => {
            const q = Number(o.qty) || 0;
            if (!o.item || q <= 0) return;
            const e = oilMap.get(o.item) || { item: o.item, qty: 0, batches: 0, manHours: 0, HQ: 0, GIMPO: 0, lots: [] };
            e.qty += q; e.batches++; e.manHours += Number(o.manHours) || 0; e[d.site] += q;
            if (o.lotNo) e.lots.push(o.lotNo);
            oilMap.set(o.item, e);
        }));
        const oils = [...oilMap.values()].sort((a, b) => b.qty - a.qty);

        // 기타업무 종류별 (업무명 → 종류)
        const taskMap = new Map();
        days.forEach(d => (d.log.otherTasks || []).forEach(x => {
            const name = String(x.task || '').trim();
            if (!name) return;
            const type = taskTypeOf(name);
            const g = taskMap.get(type) || { type, count: 0, dates: new Set(), hours: 0, manHours: 0, HQ: 0, GIMPO: 0, names: new Map() };
            const mh = Number(x.manHours) || 0;
            g.count++; g.dates.add(d.date); g.hours += Number(x.totalWorkHours) || 0; g.manHours += mh; g[d.site] += mh;
            const n = g.names.get(name) || { name, count: 0, manHours: 0, hours: 0 };
            n.count++; n.manHours += mh; n.hours += Number(x.totalWorkHours) || 0;
            g.names.set(name, n);
            taskMap.set(type, g);
        }));
        const taskGroups = [...taskMap.values()].sort((a, b) => b.manHours - a.manHours || b.count - a.count);
        const taskTotal = { count: sum(taskGroups, 'count'), hours: sum(taskGroups, 'hours'), manHours: sum(taskGroups, 'manHours') };

        // 수불부 반영 현황 (보고 있는 거점)
        const syncSites = view === 'ALL' ? Object.keys(SITES) : [view];
        const syncStats = syncSites.map(s => ({ site: s, ...getGimpoSyncStatistics(s) }));
        const unsynced = syncStats.reduce((n, s) => n + s.unsyncedDays, 0);
        const canSync = canPerformAction('WRITE_STOCK');

        const delta = (cur, before, { perDay = true } = {}) => {
            if (!prev || !before || !prevDays || !workDays) return '<span class="text-slate-300">전월 자료 없음</span>';
            const a = perDay ? cur / workDays : cur, b = perDay ? before / prevDays : before;
            if (!b) return '<span class="text-slate-300">전월 자료 없음</span>';
            const r = ((a - b) / b) * 100;
            const up = r >= 0;
            return `<span class="${up ? 'text-emerald-600' : 'text-rose-600'} font-black">${up ? '▲' : '▼'} ${Math.abs(r).toFixed(1)}%</span> <span class="text-slate-400">${perDay ? `전월 일평균 대비 (전월 ${prevDays}일)` : '전월 대비'}</span>`;
        };
        const split = (k, unit = '', d = 0) => view !== 'ALL' ? '' : `<div class="flex flex-wrap gap-x-2 text-[10px] font-bold mt-1">${Object.entries(SITES).map(([sk, s]) => `<span style="color:${s.color}">${s.label} ${fmt(bySite[sk][k], d)}${unit}</span>`).join('<span class="text-slate-300">|</span>')}</div>`;
        const kpi = (title, icon, color, value, unit, sub, extra = '') => `
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <div class="flex items-center justify-between"><span class="text-xs font-bold text-slate-500">${title}</span>
                    <div class="w-8 h-8 rounded-xl bg-${color}-50 text-${color}-600 flex items-center justify-center"><i data-lucide="${icon}" class="w-4 h-4"></i></div></div>
                <div class="flex items-baseline gap-1.5 mt-1"><span class="text-2xl font-black text-slate-900 font-mono">${value}</span><span class="text-xs font-bold text-slate-500">${unit}</span></div>
                ${extra}
                <div class="text-[11px] mt-1.5 pt-1.5 border-t border-slate-100">${sub}</div>
            </div>`;
        const card = (icon, color, title, right, body, id = '') => `
            <div ${id ? `id="${id}"` : ''} class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b pb-2"><h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="${icon}" class="w-4 h-4 text-${color}-600"></i>${title}</h3><span class="text-[11px] font-bold text-slate-400">${right}</span></div>
                ${body}
            </div>`;
        const siteBadge = (site) => `<span class="px-1.5 py-0.5 rounded text-[10px] font-black text-white" style="background:${SITES[site].color}">${SITES[site].label}</span>`;
        const monthLabel = selectedMonth === 'ALL' ? '전체 기간' : `${selectedMonth.replace('-', '년 ')}월`;
        const siteCols = view === 'ALL';
        const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');

        container.innerHTML = `
        <section id="tab-content-analytics" class="space-y-5">
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 no-print">
                <div class="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <div class="text-[11px] font-black text-emerald-600 flex items-center gap-1"><i data-lucide="factory" class="w-3.5 h-3.5"></i>업무일지(본사·김포) 연동 실적</div>
                        <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="bar-chart-3" class="w-5 h-5 text-emerald-600"></i>월간 생산공급망 실적 현황판</h2>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 text-xs">
                        <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">${[['ALL', '전체 실적'], ['HQ', '본사'], ['GIMPO', '김포']].map(([k, l]) => `<button type="button" data-v="${k}" class="an-view px-3.5 py-1.5 rounded-lg font-black ${view === k ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-600 hover:text-slate-900'}">${l}</button>`).join('')}</div>
                        <div class="flex items-center bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5">
                            <i data-lucide="calendar" class="w-3.5 h-3.5 text-blue-600 mr-2"></i>
                            <select id="analytics-month-select" class="bg-transparent border-none font-black text-slate-800 focus:outline-none cursor-pointer">
                                <option value="ALL" ${selectedMonth === 'ALL' ? 'selected' : ''}>전체 누적 기간</option>
                                ${months.map(m => `<option value="${esc(m)}" ${selectedMonth === m ? 'selected' : ''}>${esc(m.replace('-', '년 '))}월 (일지 ${every.filter(d => inView(d) && d.date.startsWith(m)).length}건)</option>`).join('')}
                            </select>
                        </div>
                        <button type="button" id="btn-export-analytics-excel" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-sm"><i data-lucide="file-spreadsheet" class="w-4 h-4"></i>엑셀 다운로드</button>
                        ${canSync && unsynced ? `<button type="button" id="btn-sync-all-unsynced" class="px-3.5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-sm"><i data-lucide="refresh-cw" class="w-4 h-4"></i>수불부 미반영 동기화 (${unsynced}일)</button>` : ''}
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                    <span class="font-black text-slate-700">수불부 반영</span>
                    ${syncStats.map(s => `<span>${siteBadge(s.site)} 전체 ${s.totalDays}일 중 <b class="text-emerald-600">${s.syncedDays}일</b> 반영 · <b class="${s.unsyncedDays ? 'text-amber-600' : 'text-slate-400'}">${s.unsyncedDays}일</b> 미반영</span>`).join('')}
                    <span class="text-[11px] text-slate-400">· 실적 집계는 반영 여부와 관계없이 업무일지 기준입니다.</span>
                </div>
            </div>

            <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                ${kpi('완제품 포장', 'package-check', 'blue', fmt(t.pack), 'EA', delta(t.pack, prev?.pack), split('pack', 'EA') + `<div class="text-[10px] text-slate-400 mt-0.5">${fmt(t.packBox)} 박스 · ${t.packLines}건 · 공수 ${fmt(t.mhPack, 1)}</div>`)}
                ${kpi('원액 생산', 'flask-conical', 'amber', fmt(t.oil), 'L', delta(t.oil, prev?.oil), split('oil', 'L') + `<div class="text-[10px] text-slate-400 mt-0.5">${t.oilBatches}배치 · 공수 ${fmt(t.mhOil, 1)} · ${fmt(oilProd)} L/공수</div>`)}
                ${kpi('라벨부착', 'tag', 'violet', fmt(t.label), 'EA', delta(t.label, prev?.label), split('label', 'EA') + `<div class="text-[10px] text-slate-400 mt-0.5">공수 ${fmt(t.mhLabel, 1)}</div>`)}
                ${kpi('작업공수 합계', 'users', 'indigo', fmt(t.manHours, 1), '공수', delta(t.manHours, prev?.manHours), split('manHours', '', 1) + `<div class="text-[10px] text-slate-400 mt-0.5">포장 ${fmt(t.mhPack, 1)} · 원액 ${fmt(t.mhOil, 1)} · 라벨 ${fmt(t.mhLabel, 1)} · 기타 ${fmt(t.mhOther, 1)}</div><div class="text-[10px] text-slate-400">작업일 ${workDays}일 · 일평균 ${fmt(workDays ? t.manHours / workDays : 0, 1)}</div>`)}
                ${kpi('포장 생산성', 'gauge', 'emerald', fmt(packProd), 'EA/공수', delta(packProd, prevPackProd, { perDay: false }), '<div class="text-[10px] text-slate-400 mt-1">포장 수량 ÷ 포장 공수</div>')}
                ${kpi('이동·입출고·발주', 'truck', 'slate', fmt(t.moves), '건 이동', `입고 ${t.recv} · 출고 ${t.ship} · 발주 ${t.po} · 택배 ${fmt(t.courier)}`, split('moves', '건'))}
            </div>

            <div class="grid grid-cols-1 xl:grid-cols-12 gap-5">
                <div class="xl:col-span-8">${card('trending-up', 'blue', `완제품 포장 · 일자별 (EA${view === 'ALL' ? ', 거점별' : ''}) / 포장 공수(선)`, esc(monthLabel), '<div class="h-72"><canvas id="chart-prod-trend"></canvas></div>')}</div>
                <div class="xl:col-span-4">${card('pie-chart', 'emerald', '카테고리별 포장 수량', '', '<div class="h-72"><canvas id="chart-category"></canvas></div>')}</div>
            </div>

            ${card('award', 'amber', `완제품 포장 TOP 10 품목${siteCols ? ' (거점별)' : ''}`, `전체 ${products.length}품목`, `
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    <div class="h-80"><canvas id="chart-top-prod"></canvas></div>
                    <div class="overflow-auto max-h-80 border border-slate-200 rounded-xl">
                        <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600 sticky top-0"><tr><th class="p-2 text-left">#</th><th class="p-2 text-left">품목</th><th class="p-2 text-left">카테고리</th>${siteCols ? '<th class="p-2 text-right">본사</th><th class="p-2 text-right">김포</th>' : ''}<th class="p-2 text-right">합계(EA)</th><th class="p-2 text-right">박스</th><th class="p-2 text-right">공수</th></tr></thead>
                        <tbody class="divide-y divide-slate-100">${products.length ? products.slice(0, 30).map((p, i) => `<tr><td class="p-2 text-slate-400">${i + 1}</td><td class="p-2 font-bold">${esc(p.item)}</td><td class="p-2 text-slate-500">${esc(p.category)}</td>${siteCols ? `<td class="p-2 text-right font-mono">${p.HQ ? fmt(p.HQ) : ''}</td><td class="p-2 text-right font-mono">${p.GIMPO ? fmt(p.GIMPO) : ''}</td>` : ''}<td class="p-2 text-right font-mono font-black">${fmt(p.qty)}</td><td class="p-2 text-right font-mono text-slate-500">${fmt(p.box)}</td><td class="p-2 text-right font-mono text-slate-500">${fmt(p.manHours, 2)}</td></tr>`).join('') : '<tr><td colspan="8" class="p-6 text-center text-slate-400">포장 실적 없음</td></tr>'}</tbody></table>
                    </div>
                </div>`)}

            ${card('flask-conical', 'amber', `원액 생산 (따로 보기)`, `${oils.length}품목 · ${t.oilBatches}배치 · ${fmt(t.oil)} L · 공수 ${fmt(t.mhOil, 1)}`, `
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    <div class="h-72"><canvas id="chart-oil"></canvas></div>
                    <div class="overflow-auto max-h-72 border border-slate-200 rounded-xl">
                        <table class="w-full text-xs"><thead class="bg-amber-50 text-amber-900 sticky top-0"><tr><th class="p-2 text-left">원액</th>${siteCols ? '<th class="p-2 text-right">본사(L)</th><th class="p-2 text-right">김포(L)</th>' : ''}<th class="p-2 text-right">합계(L)</th><th class="p-2 text-right">배치</th><th class="p-2 text-right">공수</th><th class="p-2 text-right">L/공수</th></tr></thead>
                        <tbody class="divide-y divide-slate-100">${oils.length ? oils.map(o => `<tr><td class="p-2 font-bold" title="${esc(o.lots.join(', '))}">${esc(o.item)}</td>${siteCols ? `<td class="p-2 text-right font-mono">${o.HQ ? fmt(o.HQ) : ''}</td><td class="p-2 text-right font-mono">${o.GIMPO ? fmt(o.GIMPO) : ''}</td>` : ''}<td class="p-2 text-right font-mono font-black">${fmt(o.qty)}</td><td class="p-2 text-right">${o.batches}</td><td class="p-2 text-right font-mono">${fmt(o.manHours, 2)}</td><td class="p-2 text-right font-mono text-slate-500">${o.manHours ? fmt(o.qty / o.manHours) : '-'}</td></tr>`).join('') : '<tr><td colspan="7" class="p-6 text-center text-slate-400">원액 생산 실적 없음</td></tr>'}</tbody></table>
                    </div>
                </div>`, 'an-oil')}

            ${card('users', 'indigo', '작업공수 분석 (유형별)', `합계 ${fmt(t.manHours, 1)} 공수 · 작업일 ${workDays}일`, `
                <div class="grid grid-cols-1 xl:grid-cols-12 gap-5">
                    <div class="xl:col-span-8 h-72"><canvas id="chart-manhours"></canvas></div>
                    <div class="xl:col-span-4 overflow-auto border border-slate-200 rounded-xl">
                        <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600"><tr><th class="p-2 text-left">유형</th>${siteCols ? '<th class="p-2 text-right">본사</th><th class="p-2 text-right">김포</th>' : ''}<th class="p-2 text-right">공수</th><th class="p-2 text-right">비율</th><th class="p-2 text-right">일평균</th></tr></thead>
                        <tbody class="divide-y divide-slate-100">
                            ${WORK_TYPES.map(([k, l, c]) => `<tr><td class="p-2 font-bold"><span class="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style="background:${c}"></span>${l}</td>${siteCols ? `<td class="p-2 text-right font-mono">${fmt(bySite.HQ[mhKey[k]], 1)}</td><td class="p-2 text-right font-mono">${fmt(bySite.GIMPO[mhKey[k]], 1)}</td>` : ''}<td class="p-2 text-right font-mono font-black">${fmt(t[mhKey[k]], 1)}</td><td class="p-2 text-right">${pct(t[mhKey[k]], t.manHours)}</td><td class="p-2 text-right font-mono">${fmt(workDays ? t[mhKey[k]] / workDays : 0, 2)}</td></tr>`).join('')}
                            <tr class="bg-slate-50 font-black"><td class="p-2">합계</td>${siteCols ? `<td class="p-2 text-right font-mono">${fmt(bySite.HQ.manHours, 1)}</td><td class="p-2 text-right font-mono">${fmt(bySite.GIMPO.manHours, 1)}</td>` : ''}<td class="p-2 text-right font-mono">${fmt(t.manHours, 1)}</td><td class="p-2 text-right">100%</td><td class="p-2 text-right font-mono">${fmt(workDays ? t.manHours / workDays : 0, 2)}</td></tr>
                        </tbody></table>
                        <p class="p-2 text-[10px] text-slate-400">공수 = 업무일지의 '작업공수' 칸 합계</p>
                    </div>
                </div>`, 'an-manhours')}

            ${card('list-checks', 'slate', '기타업무 종류별 취합', `${taskTotal.count}건 · 총작업시간 ${fmt(taskTotal.hours, 1)}시간 · 공수 ${fmt(taskTotal.manHours, 1)}`, `
                <div class="overflow-auto border border-slate-200 rounded-xl">
                    <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600"><tr><th class="p-2 text-left">종류</th><th class="p-2 text-right">건수</th><th class="p-2 text-right">일수</th><th class="p-2 text-right">총작업시간</th>${siteCols ? '<th class="p-2 text-right">본사 공수</th><th class="p-2 text-right">김포 공수</th>' : ''}<th class="p-2 text-right">공수</th><th class="p-2 text-right">비율</th><th class="p-2 text-left">업무명 (건수·공수)</th></tr></thead>
                    <tbody class="divide-y divide-slate-100 align-top">${taskGroups.length ? taskGroups.map(g => {
                        const names = [...g.names.values()].sort((a, b) => b.manHours - a.manHours || b.count - a.count);
                        return `<tr><td class="p-2 font-black whitespace-nowrap">${esc(g.type)}</td><td class="p-2 text-right">${g.count}</td><td class="p-2 text-right">${g.dates.size}</td><td class="p-2 text-right font-mono">${fmt(g.hours, 1)}</td>${siteCols ? `<td class="p-2 text-right font-mono">${g.HQ ? fmt(g.HQ, 2) : ''}</td><td class="p-2 text-right font-mono">${g.GIMPO ? fmt(g.GIMPO, 2) : ''}</td>` : ''}<td class="p-2 text-right font-mono font-black">${fmt(g.manHours, 2)}</td><td class="p-2 text-right">${pct(g.manHours, taskTotal.manHours)}</td>
                            <td class="p-2"><details><summary class="cursor-pointer text-slate-600">${esc(names[0].name)}${names.length > 1 ? ` 외 ${names.length - 1}종` : ''}</summary>
                                <ul class="mt-1 space-y-0.5 text-[11px] text-slate-600">${names.map(n => `<li>· ${esc(n.name)} <span class="text-slate-400">(${n.count}건 · ${fmt(n.manHours, 2)}공수)</span></li>`).join('')}</ul></details></td></tr>`;
                    }).join('') : `<tr><td colspan="9" class="p-6 text-center text-slate-400">기타업무 기록 없음</td></tr>`}</tbody></table>
                </div>
                <p class="text-[10px] text-slate-400">종류는 업무명에 든 낱말로 자동 분류합니다 (예: '택배'가 들어가면 택배·출고 지원). 어느 종류에도 맞지 않으면 '기타'.</p>`, 'an-tasks')}

            ${card('table', 'blue', `일자별 실적 원장 (${days.length}건)`, '줄을 누르면 그 날의 업무일지로 이동', `
                <div class="overflow-auto rounded-xl border border-slate-200 max-h-[65vh]">
                    <table class="w-full text-xs border-collapse">
                        <thead class="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 sticky top-0 z-10"><tr>
                            <th class="p-2.5 text-center">일자</th><th class="p-2.5 text-center">거점</th><th class="p-2.5 text-center">담당</th>
                            <th class="p-2.5 text-right">포장(EA)</th><th class="p-2.5 text-right">원액(L)</th><th class="p-2.5 text-right">라벨(EA)</th>
                            <th class="p-2.5 text-right">공수 포장/원액/라벨/기타</th><th class="p-2.5 text-right">공수 합계</th>
                            <th class="p-2.5 text-center">이동</th><th class="p-2.5 text-center">입고/출고/발주</th><th class="p-2.5 text-center">수불부</th></tr></thead>
                        <tbody class="divide-y divide-slate-100">
                            ${days.length === 0 ? '<tr><td colspan="11" class="p-8 text-center text-slate-400 font-bold">선택한 기간의 업무일지가 없습니다.</td></tr>' : days.map(d => {
                                const top = (d.log.packaging || []).filter(r => Number(r.qty) > 0);
                                return `<tr class="hover:bg-blue-50/50 cursor-pointer" data-log-date="${esc(d.date)}" data-site="${d.site}">
                                    <td class="p-2.5 text-center font-mono font-bold">${esc(d.date)}</td>
                                    <td class="p-2.5 text-center">${siteBadge(d.site)}</td>
                                    <td class="p-2.5 text-center text-slate-600">${esc(d.log.manager || '-')}</td>
                                    <td class="p-2.5 text-right"><div class="font-mono font-black text-blue-700">${fmt(d.pack)}</div><div class="text-[10px] text-slate-400 truncate max-w-[160px] ml-auto" title="${esc(top.map(r => itemName(r.item)).join(', '))}">${top.length ? `${esc(itemName(top[0].item))}${top.length > 1 ? ` 외 ${top.length - 1}` : ''}` : ''}</div></td>
                                    <td class="p-2.5 text-right font-mono font-black text-amber-700">${d.oil ? fmt(d.oil) : '-'}</td>
                                    <td class="p-2.5 text-right font-mono text-violet-700">${d.label ? fmt(d.label) : '-'}</td>
                                    <td class="p-2.5 text-right font-mono text-slate-500 whitespace-nowrap">${[d.mhPack, d.mhOil, d.mhLabel, d.mhOther].map(v => (v ? fmt(v, 2) : '-')).join(' / ')}</td>
                                    <td class="p-2.5 text-right font-mono font-black">${fmt(d.manHours, 2)}</td>
                                    <td class="p-2.5 text-center">${d.moves ? `<span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold">${d.moves}건</span>` : '-'}</td>
                                    <td class="p-2.5 text-center text-[11px] text-slate-600">${d.recv} / ${d.ship} / ${d.po}</td>
                                    <td class="p-2.5 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-black ${d.synced ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${d.synced ? '반영' : '미반영'}</span></td>
                                </tr>`;
                            }).join('')}
                            ${days.length ? `<tr class="bg-slate-50 font-black"><td class="p-2.5 text-center" colspan="3">합계 (작업일 ${workDays}일)</td><td class="p-2.5 text-right font-mono">${fmt(t.pack)}</td><td class="p-2.5 text-right font-mono">${fmt(t.oil)}</td><td class="p-2.5 text-right font-mono">${fmt(t.label)}</td><td class="p-2.5 text-right font-mono whitespace-nowrap">${[t.mhPack, t.mhOil, t.mhLabel, t.mhOther].map(v => fmt(v, 1)).join(' / ')}</td><td class="p-2.5 text-right font-mono">${fmt(t.manHours, 1)}</td><td class="p-2.5 text-center">${t.moves}건</td><td class="p-2.5 text-center">${t.recv} / ${t.ship} / ${t.po}</td><td class="p-2.5 text-center">${t.synced}/${t.days}</td></tr>` : ''}
                        </tbody>
                    </table>
                </div>`)}
        </section>`;
        createIcons({ icons });

        container.querySelectorAll('.an-view').forEach(b => b.addEventListener('click', () => { view = b.dataset.v; renderView(); }));
        container.querySelector('#analytics-month-select')?.addEventListener('change', (e) => { selectedMonth = e.target.value; renderView(); });
        container.querySelector('#btn-sync-all-unsynced')?.addEventListener('click', async () => {
            if (!confirm(`수불부에 미반영된 ${unsynced}일치 업무일지(${syncSites.map(s => SITES[s].label).join('·')})를 WMS 재고와 수불부에 반영할까요?\n실제 재고가 바뀝니다.`)) return;
            const worker = state.currentGlobalWorker || state.currentUser?.name || '';
            const msgs = [];
            for (const s of syncSites) {
                try { const r = await syncAllUnsyncedGimpoLogs(worker, s); msgs.push(`[${SITES[s].label}] ${r.message}`); } catch (err) { msgs.push(`[${SITES[s].label}] 오류: ${err.message}`); }
            }
            alert(msgs.join('\n\n'));
            renderView();
        });
        container.querySelector('#btn-export-analytics-excel')?.addEventListener('click', () => {
            const wb = XLSX.utils.book_new();
            const add = (rows, name) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ 내용: '자료 없음' }]), name);
            add(days.map(d => ({
                일자: d.date, 거점: SITES[d.site].label, 담당: d.log.manager || '', '포장(EA)': d.pack, 포장박스: d.packBox, '원액(L)': d.oil, 원액배치: d.oilBatches, '라벨(EA)': d.label,
                포장공수: r2(d.mhPack), 원액공수: r2(d.mhOil), 라벨공수: r2(d.mhLabel), 기타공수: r2(d.mhOther), 공수합계: r2(d.manHours),
                이동건수: d.moves, 입고건수: d.recv, 출고건수: d.ship, 발주건수: d.po, 택배건수: d.courier, 수불부: d.synced ? '반영' : '미반영'
            })), '일자별');
            add(products.map((p, i) => ({ 순위: i + 1, 품목: p.item, 카테고리: p.category, '본사(EA)': p.HQ, '김포(EA)': p.GIMPO, '합계(EA)': p.qty, 박스: p.box, 공수: r2(p.manHours) })), '포장 품목별');
            add(categories.map(([c, q]) => ({ 카테고리: c, '포장(EA)': q })), '포장 카테고리별');
            add(oils.map(o => ({ 원액: o.item, '본사(L)': o.HQ, '김포(L)': o.GIMPO, '합계(L)': o.qty, 배치: o.batches, 공수: r2(o.manHours), 'L/공수': o.manHours ? r2(o.qty / o.manHours) : '', LOT: o.lots.join(', ') })), '원액 품목별');
            add(WORK_TYPES.map(([k, l]) => ({ 유형: l, '본사 공수': r2(bySite.HQ[mhKey[k]]), '김포 공수': r2(bySite.GIMPO[mhKey[k]]), 공수: r2(t[mhKey[k]]), 비율: t.manHours ? r2(t[mhKey[k]] / t.manHours * 100) : 0 })), '공수 유형별');
            add(taskGroups.flatMap(g => [...g.names.values()].map(n => ({ 종류: g.type, 업무명: n.name, 건수: n.count, 총작업시간: r2(n.hours), 공수: r2(n.manHours) }))), '기타업무 종류별');
            XLSX.writeFile(wb, `대림오일_생산실적_${view === 'ALL' ? '전체' : SITES[view].label}_${selectedMonth}.xlsx`);
        });
        const jump = (date, site) => {
            if (!date || !SITES[site]) return;
            window.__worklogInitialDate = { site, date };
            if (site === 'GIMPO') window.__gimpoInitialDate = date;
            window.__switchTab?.(SITES[site].tab);
        };
        container.querySelectorAll('tr[data-log-date]').forEach(row => row.addEventListener('click', () => jump(row.dataset.logDate, row.dataset.site)));

        renderCharts(days, products, categories);
    };

    const renderCharts = (days, products, categories) => {
        Object.values(charts).forEach(c => c?.destroy());
        // 백그라운드 탭이거나 '동작 줄이기'(prefers-reduced-motion)면 애니메이션 없이 바로 그린다 (requestAnimationFrame이 멈추면 첫 장면에 머무름)
        const still = document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        Chart.defaults.animation = still ? false : BASE_ANIMATION;
        applyChartTheme(Chart);
        const dates = [...new Set(days.map(d => d.date))].sort();
        const labels = dates.map(d => d.slice(5));
        const val = (site, date, k) => days.filter(d => d.date === date && (!site || d.site === site)).reduce((s, d) => s + (d[k] || 0), 0);
        const sitesShown = view === 'ALL' ? Object.keys(SITES) : [view];
        const scope = view === 'ALL' ? null : view;
        const font = { family: 'Noto Sans KR', size: 10, weight: 'bold' };
        // ds: 보여줄 날짜 (원액은 원액을 만든 날만)
        const barLine = (el, qtyKey, unit, mhKeyName, lineColor, ds = dates) => new Chart(el, {
            data: {
                labels: ds.map(d => d.slice(5)),
                datasets: [
                    ...sitesShown.map(s => ({ type: 'bar', label: `${SITES[s].label} (${unit})`, data: ds.map(d => val(s, d, qtyKey)), backgroundColor: SITES[s].color, borderRadius: 3, stack: 'q', yAxisID: 'y' })),
                    { type: 'line', label: '공수', data: ds.map(d => Math.round(val(scope, d, mhKeyName) * 100) / 100), borderColor: lineColor, backgroundColor: lineColor, tension: 0, pointRadius: 3, yAxisID: 'y1' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top', labels: { font } } },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
                    y: { stacked: true, position: 'left', title: { display: true, text: unit, font }, ticks: { font: { size: 10 } } },
                    y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: '공수', font }, ticks: { font: { size: 10 } } }
                }
            }
        });
        const ctxTrend = container.querySelector('#chart-prod-trend');
        if (ctxTrend) charts.trend = barLine(ctxTrend, 'pack', 'EA', 'mhPack', isDarkTheme() ? '#e2e8f0' : '#0f172a');
        const ctxOil = container.querySelector('#chart-oil');
        if (ctxOil) charts.oil = barLine(ctxOil, 'oil', 'L', 'mhOil', '#b45309', dates.filter(d => val(scope, d, 'oil') > 0 || val(scope, d, 'mhOil') > 0));
        const ctxMh = container.querySelector('#chart-manhours');
        if (ctxMh) {
            charts.mh = new Chart(ctxMh, {
                type: 'bar',
                data: { labels, datasets: WORK_TYPES.map(([k, l, c]) => ({ label: l, data: dates.map(d => Math.round(val(scope, d, mhKey[k]) * 100) / 100), backgroundColor: c, borderRadius: 2 })) },
                options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', labels: { font } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } }, y: { stacked: true, title: { display: true, text: '공수', font }, ticks: { font: { size: 10 } } } } }
            });
        }
        const ctxCat = container.querySelector('#chart-category');
        if (ctxCat && categories.length) {
            charts.cat = new Chart(ctxCat, {
                type: 'doughnut',
                data: { labels: categories.map(c => c[0]), datasets: [{ data: categories.map(c => c[1]), backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#64748b', '#a855f7'] }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font, boxWidth: 10 } } } }
            });
        }
        const ctxTop = container.querySelector('#chart-top-prod');
        if (ctxTop && products.length) {
            const top = products.slice(0, 10);
            charts.top = new Chart(ctxTop, {
                type: 'bar',
                data: { labels: top.map(p => itemName(p.item).slice(0, 22)), datasets: sitesShown.map(s => ({ label: SITES[s].label, data: top.map(p => p[s]), backgroundColor: SITES[s].color, borderRadius: 3 })) },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: sitesShown.length > 1, labels: { font } } }, scales: { x: { stacked: true, ticks: { font: { size: 10 } } }, y: { stacked: true, ticks: { font: { size: 10 } } } } }
            });
        }
    };

    renderView();
};
