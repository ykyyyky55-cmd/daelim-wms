import { state, getGimpoSyncStatistics, syncAllUnsyncedGimpoLogs } from '../services/db.js';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { canPerformAction } from '../services/auth.js';

// 월간 생산공급망 실적 현황판: 업무일지(본사·김포)를 월별로 모아 본다
// - 보기: 전체(본사+김포) / 본사 / 김포 — 기기별 기억(daelim_analytics_view)
// - 핵심 지표: 완제품 포장(EA)·원액 생산(L)·라벨부착(EA)·투입공수(생산성)·이동·수불부 반영률, 전월 대비 증감
// - 차트: 일자별 포장(EA, 거점별 막대) + 원액(L, 오른쪽 축 선), 품목 TOP 10, 카테고리별 포장
// - 표: 일자·거점별 실적 원장 (누르면 그 날 업무일지로 이동), 엑셀(일자별·품목별·카테고리별 시트)
const SITES = { HQ: { label: '본사', color: '#2563eb', light: '#93c5fd', tab: 'hqLog', key: 'hqLogs' }, GIMPO: { label: '김포', color: '#059669', light: '#6ee7b7', tab: 'gimpoLog', key: 'gimpoLogs' } };
const VIEW_KEY = 'daelim_analytics_view';
const charts = {};
const BASE_ANIMATION = Chart.defaults.animation;
const sum = (rows, k) => (rows || []).reduce((s, r) => s + (Number(r[k]) || 0), 0);
const fmt = (n, d = 0) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: d });
const prevMonthOf = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const itemName = (t) => String(t || '').replace(/^[0-9A-Za-z-]{4,}\s*\/\s*/, '').trim() || String(t || '');

// 일지 하나의 요약
const summarize = (log, site) => {
    const pk = log.packaging || [], ob = log.oilBlending || [], lb = log.labeling || [], ot = log.otherTasks || [];
    return {
        site, date: log.date, log,
        pack: sum(pk, 'qty'), packBox: sum(pk, 'box'), packLines: pk.filter(r => Number(r.qty) > 0).length,
        oil: sum(ob, 'qty'), oilBatches: ob.filter(r => Number(r.qty) > 0).length,
        label: sum(lb, 'qty'),
        manHours: sum(pk, 'manHours') + sum(ob, 'manHours') + sum(lb, 'manHours') + sum(ot, 'manHours'),
        prodManHours: sum(pk, 'manHours'),
        moves: (log.movement || []).filter(r => Number(r.qty) > 0).length,
        recv: (log.receiving || []).length, ship: (log.shipping || []).length, po: (log.purchaseOrders || []).length,
        courier: sum(log.courier || [], 'count'),
        synced: !!log.isSyncedToLedger
    };
};
const total = (days) => {
    const t = { pack: 0, packBox: 0, packLines: 0, oil: 0, oilBatches: 0, label: 0, manHours: 0, prodManHours: 0, moves: 0, recv: 0, ship: 0, po: 0, courier: 0, synced: 0, days: days.length };
    days.forEach(d => { Object.keys(t).forEach(k => { if (k === 'days') return; t[k] += k === 'synced' ? (d.synced ? 1 : 0) : (Number(d[k]) || 0); }); });
    return t;
};

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
        const prev = selectedMonth !== 'ALL' ? total(every.filter(d => inView(d) && inMonth(d, prevMonthOf(selectedMonth)))) : null;
        const bySite = Object.fromEntries(Object.keys(SITES).map(k => [k, total(days.filter(d => d.site === k))]));
        const workDays = new Set(days.map(d => d.date)).size;
        // 전월 비교는 작업일 1일 평균 기준 (전월 일지가 일부만 있어도 왜곡되지 않게)
        const prevDays = prev ? new Set(every.filter(d => inView(d) && inMonth(d, prevMonthOf(selectedMonth))).map(d => d.date)).size : 0;
        const productivity = t.prodManHours ? t.pack / t.prodManHours : 0;
        const prevProductivity = prev && prev.prodManHours ? prev.pack / prev.prodManHours : 0;

        // 품목별·카테고리별 포장
        const productMap = new Map();
        const categoryMap = new Map();
        days.forEach(d => (d.log.packaging || []).forEach(p => {
            const q = Number(p.qty) || 0;
            if (!p.item || q <= 0) return;
            const k = p.item;
            const e = productMap.get(k) || { item: k, qty: 0, box: 0, HQ: 0, GIMPO: 0, category: p.category || '' };
            e.qty += q; e.box += Number(p.box) || 0; e[d.site] += q;
            productMap.set(k, e);
            const c = p.category || '미분류';
            categoryMap.set(c, (categoryMap.get(c) || 0) + q);
        }));
        const products = [...productMap.values()].sort((a, b) => b.qty - a.qty);
        const categories = [...categoryMap.entries()].sort((a, b) => b[1] - a[1]);

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
        const split = (k, unit = '', d = 0) => view !== 'ALL' ? '' : `<div class="flex gap-2 text-[10px] font-bold mt-1">${Object.entries(SITES).map(([sk, s]) => `<span style="color:${s.color}">${s.label} ${fmt(bySite[sk][k], d)}${unit}</span>`).join('<span class="text-slate-300">|</span>')}</div>`;
        const kpi = (title, icon, color, value, unit, sub, extra = '') => `
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <div class="flex items-center justify-between"><span class="text-xs font-bold text-slate-500">${title}</span>
                    <div class="w-8 h-8 rounded-xl bg-${color}-50 text-${color}-600 flex items-center justify-center"><i data-lucide="${icon}" class="w-4 h-4"></i></div></div>
                <div class="flex items-baseline gap-1.5 mt-1"><span class="text-2xl font-black text-slate-900 font-mono">${value}</span><span class="text-xs font-bold text-slate-500">${unit}</span></div>
                ${extra}
                <div class="text-[11px] mt-1.5 pt-1.5 border-t border-slate-100">${sub}</div>
            </div>`;
        const siteBadge = (site) => `<span class="px-1.5 py-0.5 rounded text-[10px] font-black text-white" style="background:${SITES[site].color}">${SITES[site].label}</span>`;
        const monthLabel = selectedMonth === 'ALL' ? '전체 기간' : `${selectedMonth.replace('-', '년 ')}월`;

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
                ${kpi('완제품 포장', 'package-check', 'blue', fmt(t.pack), 'EA', delta(t.pack, prev?.pack), split('pack', 'EA') + `<div class="text-[10px] text-slate-400 mt-0.5">${fmt(t.packBox)} 박스 · ${t.packLines}건</div>`)}
                ${kpi('원액 생산', 'flask-conical', 'amber', fmt(t.oil), 'L', delta(t.oil, prev?.oil), split('oil', 'L') + `<div class="text-[10px] text-slate-400 mt-0.5">${t.oilBatches}배치</div>`)}
                ${kpi('라벨부착', 'tag', 'indigo', fmt(t.label), 'EA', delta(t.label, prev?.label), split('label', 'EA'))}
                ${kpi('투입공수', 'users', 'violet', fmt(t.manHours, 1), '공수', delta(t.manHours, prev?.manHours), split('manHours', '', 1) + `<div class="text-[10px] text-slate-400 mt-0.5">작업일 ${workDays}일 · 일평균 ${fmt(workDays ? t.manHours / workDays : 0, 1)}</div>`)}
                ${kpi('포장 생산성', 'gauge', 'emerald', fmt(productivity), 'EA/공수', delta(productivity, prevProductivity, { perDay: false }), '<div class="text-[10px] text-slate-400 mt-1">포장 수량 ÷ 포장 투입공수</div>')}
                ${kpi('이동·입출고·발주', 'truck', 'slate', fmt(t.moves), '건 이동', `입고 ${t.recv} · 출고 ${t.ship} · 발주 ${t.po} · 택배 ${fmt(t.courier)}`, split('moves', '건'))}
            </div>

            <div class="grid grid-cols-1 xl:grid-cols-12 gap-5">
                <div class="xl:col-span-8 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                    <div class="flex items-center justify-between border-b pb-2"><h3 class="text-xs font-black text-slate-800 flex items-center gap-1.5"><i data-lucide="trending-up" class="w-4 h-4 text-blue-600"></i>일자별 실적 추이 · 포장(EA, 막대${view === 'ALL' ? ' 거점별' : ''}) / 원액(L, 선·오른쪽 축)</h3><span class="text-[11px] font-bold text-slate-400">${esc(monthLabel)}</span></div>
                    <div class="h-72"><canvas id="chart-prod-trend"></canvas></div>
                </div>
                <div class="xl:col-span-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                    <div class="border-b pb-2"><h3 class="text-xs font-black text-slate-800 flex items-center gap-1.5"><i data-lucide="pie-chart" class="w-4 h-4 text-emerald-600"></i>카테고리별 포장 수량</h3></div>
                    <div class="h-72"><canvas id="chart-category"></canvas></div>
                </div>
            </div>

            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                <div class="flex items-center justify-between border-b pb-2"><h3 class="text-xs font-black text-slate-800 flex items-center gap-1.5"><i data-lucide="award" class="w-4 h-4 text-amber-500"></i>완제품 포장 TOP 10 품목${view === 'ALL' ? ' (거점별)' : ''}</h3><span class="text-[11px] text-slate-400">전체 ${products.length}품목</span></div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    <div class="h-80"><canvas id="chart-top-prod"></canvas></div>
                    <div class="overflow-auto max-h-80 border border-slate-200 rounded-xl">
                        <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600 sticky top-0"><tr><th class="p-2 text-left">#</th><th class="p-2 text-left">품목</th><th class="p-2 text-left">카테고리</th>${view === 'ALL' ? '<th class="p-2 text-right">본사</th><th class="p-2 text-right">김포</th>' : ''}<th class="p-2 text-right">합계(EA)</th><th class="p-2 text-right">박스</th></tr></thead>
                        <tbody class="divide-y divide-slate-100">${products.length ? products.slice(0, 30).map((p, i) => `<tr><td class="p-2 text-slate-400">${i + 1}</td><td class="p-2 font-bold">${esc(p.item)}</td><td class="p-2 text-slate-500">${esc(p.category)}</td>${view === 'ALL' ? `<td class="p-2 text-right font-mono">${p.HQ ? fmt(p.HQ) : ''}</td><td class="p-2 text-right font-mono">${p.GIMPO ? fmt(p.GIMPO) : ''}</td>` : ''}<td class="p-2 text-right font-mono font-black">${fmt(p.qty)}</td><td class="p-2 text-right font-mono text-slate-500">${fmt(p.box)}</td></tr>`).join('') : '<tr><td colspan="7" class="p-6 text-center text-slate-400">포장 실적 없음</td></tr>'}</tbody></table>
                    </div>
                </div>
            </div>

            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="border-b pb-2"><h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="table" class="w-4 h-4 text-blue-600"></i>일자별 실적 원장 (${days.length}건)</h3>
                    <p class="text-xs text-slate-500 mt-0.5">줄을 누르면 그 날의 업무일지로 이동합니다.</p></div>
                <div class="overflow-auto rounded-xl border border-slate-200 max-h-[65vh]">
                    <table class="w-full text-xs border-collapse">
                        <thead class="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 sticky top-0 z-10"><tr>
                            <th class="p-2.5 text-center">일자</th><th class="p-2.5 text-center">거점</th><th class="p-2.5 text-center">담당</th>
                            <th class="p-2.5 text-right">포장(EA)</th><th class="p-2.5 text-right">원액(L)</th><th class="p-2.5 text-right">라벨(EA)</th><th class="p-2.5 text-right">공수</th>
                            <th class="p-2.5 text-center">이동</th><th class="p-2.5 text-center">입고/출고/발주</th><th class="p-2.5 text-center">수불부</th></tr></thead>
                        <tbody class="divide-y divide-slate-100">
                            ${days.length === 0 ? '<tr><td colspan="10" class="p-8 text-center text-slate-400 font-bold">선택한 기간의 업무일지가 없습니다.</td></tr>' : days.map(d => {
                                const top = (d.log.packaging || []).filter(r => Number(r.qty) > 0);
                                return `<tr class="hover:bg-blue-50/50 cursor-pointer" data-log-date="${esc(d.date)}" data-site="${d.site}">
                                    <td class="p-2.5 text-center font-mono font-bold">${esc(d.date)}</td>
                                    <td class="p-2.5 text-center">${siteBadge(d.site)}</td>
                                    <td class="p-2.5 text-center text-slate-600">${esc(d.log.manager || '-')}</td>
                                    <td class="p-2.5 text-right"><div class="font-mono font-black text-blue-700">${fmt(d.pack)}</div><div class="text-[10px] text-slate-400 truncate max-w-[160px] ml-auto" title="${esc(top.map(r => itemName(r.item)).join(', '))}">${top.length ? `${esc(itemName(top[0].item))}${top.length > 1 ? ` 외 ${top.length - 1}` : ''}` : ''}</div></td>
                                    <td class="p-2.5 text-right font-mono font-black text-amber-700">${d.oil ? fmt(d.oil) : '-'}</td>
                                    <td class="p-2.5 text-right font-mono text-indigo-700">${d.label ? fmt(d.label) : '-'}</td>
                                    <td class="p-2.5 text-right font-mono">${fmt(d.manHours, 2)}</td>
                                    <td class="p-2.5 text-center">${d.moves ? `<span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold">${d.moves}건</span>` : '-'}</td>
                                    <td class="p-2.5 text-center text-[11px] text-slate-600">${d.recv} / ${d.ship} / ${d.po}</td>
                                    <td class="p-2.5 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-black ${d.synced ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${d.synced ? '반영' : '미반영'}</span></td>
                                </tr>`;
                            }).join('')}
                            ${days.length ? `<tr class="bg-slate-50 font-black"><td class="p-2.5 text-center" colspan="3">합계 (작업일 ${workDays}일)</td><td class="p-2.5 text-right font-mono">${fmt(t.pack)}</td><td class="p-2.5 text-right font-mono">${fmt(t.oil)}</td><td class="p-2.5 text-right font-mono">${fmt(t.label)}</td><td class="p-2.5 text-right font-mono">${fmt(t.manHours, 1)}</td><td class="p-2.5 text-center">${t.moves}건</td><td class="p-2.5 text-center">${t.recv} / ${t.ship} / ${t.po}</td><td class="p-2.5 text-center">${t.synced}/${t.days}</td></tr>` : ''}
                        </tbody>
                    </table>
                </div>
            </div>
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
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(days.map(d => ({
                일자: d.date, 거점: SITES[d.site].label, 담당: d.log.manager || '', '포장(EA)': d.pack, 포장박스: d.packBox, '원액(L)': d.oil, 원액배치: d.oilBatches,
                '라벨(EA)': d.label, 투입공수: Math.round(d.manHours * 100) / 100, 이동건수: d.moves, 입고건수: d.recv, 출고건수: d.ship, 발주건수: d.po, 택배건수: d.courier, 수불부: d.synced ? '반영' : '미반영'
            }))), '일자별');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(products.map((p, i) => ({ 순위: i + 1, 품목: p.item, 카테고리: p.category, '본사(EA)': p.HQ, '김포(EA)': p.GIMPO, '합계(EA)': p.qty, 박스: p.box }))), '품목별 포장');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categories.map(([c, q]) => ({ 카테고리: c, '포장(EA)': q }))), '카테고리별');
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
        const dates = [...new Set(days.map(d => d.date))].sort();
        const val = (site, date, k) => days.filter(d => d.date === date && (!site || d.site === site)).reduce((s, d) => s + d[k], 0);
        const sitesShown = view === 'ALL' ? Object.keys(SITES) : [view];
        const font = { family: 'Noto Sans KR', size: 10, weight: 'bold' };
        const ctxTrend = container.querySelector('#chart-prod-trend');
        if (ctxTrend) {
            charts.trend = new Chart(ctxTrend, {
                data: {
                    labels: dates.map(d => d.slice(5)),
                    datasets: [
                        ...sitesShown.map(s => ({ type: 'bar', label: `${SITES[s].label} 포장(EA)`, data: dates.map(d => val(s, d, 'pack')), backgroundColor: SITES[s].color, borderRadius: 3, stack: 'pack', yAxisID: 'y' })),
                        { type: 'line', label: '원액(L)', data: dates.map(d => val(view === 'ALL' ? null : view, d, 'oil')), borderColor: '#f59e0b', backgroundColor: '#f59e0b', tension: 0.25, pointRadius: 3, yAxisID: 'y1' }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { position: 'top', labels: { font } } },
                    scales: {
                        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
                        y: { stacked: true, position: 'left', title: { display: true, text: 'EA', font }, ticks: { font: { size: 10 } } },
                        y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'L', font }, ticks: { font: { size: 10 } } }
                    }
                }
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
