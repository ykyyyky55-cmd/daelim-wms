import Chart from 'chart.js/auto';
import { createIcons, icons } from '../../services/icons.js';
import { esc } from '../../services/html.js';
import { state } from '../../services/db.js';
import { localDateStr } from '../../services/searchUtils.js';
import { applyChartTheme } from '../../services/darkTheme.js';
import { QC_AREAS, QC_RESULTS, listQc, getDefectConfig, summarize, defectQtyOf, rateOf, fmtRate, fmtPpm } from '../../services/quality.js';
import { printA4, printTableHtml, fmtQty, btn } from '../plans/planCommon.js';
import { mountApprovalBox } from '../approval/ApprovalBox.js';
import { setBoardFullscreen, isBoardFullscreen, fullscreenButtonHtml } from '../../services/fullscreen.js';

// 월간 실적 현황판 → 월간 불량률 현황 (탭 qcMonthly)
// 품질관리의 제품·공정·원부자재 검사 기록(wms_qc_records INSPECT)을 월별로 모아 한눈에 본다.
// 보기: 전체(세 영역 합) / 제품 / 공정 / 원부자재. 월 선택, 전월 대비, 최근 12개월 추이, 파레토, TOP 품목, 불합격·조치 현황.
// 월 보고서 결재: QC:MONTH:<YYYY-MM>:<보기> (type QC_MONTH) — 화면 결재 칸 + A4 인쇄
const AREAS = ['PRODUCT', 'PROCESS', 'MATERIAL'];
const AREA_COLOR = { PRODUCT: '#2563eb', PROCESS: '#7c3aed', MATERIAL: '#ea580c', ALL: '#059669' };
const VIEW_LABEL = { ALL: '전체', PRODUCT: '제품', PROCESS: '공정', MATERIAL: '원부자재' };
const KEY = 'daelim_qc_monthly';
const ymAdd = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const ymLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
const diffText = (cur, prev) => {
    if (prev === null) return '<span class="text-slate-400">전월 자료 없음</span>';
    const d = cur - prev;
    if (Math.abs(d) < 0.005) return '<span class="text-slate-500">전월과 같음</span>';
    return `<span class="${d > 0 ? 'text-rose-600' : 'text-emerald-600'} font-bold">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(2)}%p</span> <span class="text-slate-400">전월 대비</span>`;
};

export const renderQualityMonthly = (container, { showToast = () => {}, onSwitchTab = () => {} } = {}) => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* 기본값 */ }
    let ym = window.__qcMonthlyYm || localDateStr().slice(0, 7);
    window.__qcMonthlyYm = null;
    let view = VIEW_LABEL[saved.view] ? saved.view : 'ALL';
    let records = [];
    let targets = {};
    let charts = [];

    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-indigo-600 flex items-center gap-1"><i data-lucide="bar-chart-3" class="w-3.5 h-3.5"></i>월간 실적 현황판 › 월간 불량률 현황</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="shield-alert" class="w-5 h-5 text-rose-600"></i>월간 불량률 현황</h2>
                    <p class="text-xs text-slate-500 mt-1">품질관리의 <b>제품 출하검사 · 공정검사 · 원부자재 수입검사</b> 기록을 월별로 모아 봅니다. 불량률 = 불량수량 ÷ 검사수량 × 100 (전체는 세 영역 합계).</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button type="button" id="qm-xlsx" class="${btn('bg-white border border-slate-300 hover:bg-slate-50 text-slate-700')}"><i data-lucide="file-spreadsheet" class="w-4 h-4"></i>엑셀</button>
                    <button type="button" id="qm-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>월간 보고서</button>
                    ${fullscreenButtonHtml('qm-full')}
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <button type="button" id="qm-prev" class="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-black">◀</button>
                <input type="month" id="qm-ym" value="${ym}" class="border border-slate-300 rounded-lg px-2 py-1 font-bold" />
                <button type="button" id="qm-next" class="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-black">▶</button>
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl ml-1">${Object.entries(VIEW_LABEL).map(([k, l]) => `<button type="button" data-v="${k}" class="qm-v px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
            </div>
        </div>
        <div id="qm-body"></div>
    </section>`;
    const $ = (s) => container.querySelector(s);
    const destroyCharts = () => { charts.forEach(c => c.destroy()); charts = []; };
    const inView = (r) => view === 'ALL' || r.area === view;
    const ofMonth = (m) => records.filter(r => String(r.date).startsWith(m) && inView(r));
    const target = () => (view === 'ALL' ? null : targets[view]);
    const apprDoc = () => ({ key: `QC:MONTH:${ym}:${view}`, type: 'QC_MONTH', title: `${ymLabel(ym)} 월간 불량률 현황 (${VIEW_LABEL[view]})`, date: ym, roles: ['작성', '검토', '승인'] });
    const openRec = (id) => {
        const r = records.find(x => x.id === id);
        if (!r) return;
        window.__qcOpenId = id;
        onSwitchTab(QC_AREAS[r.area]?.tab || 'qcProduct');
    };

    const render = () => {
        container.querySelectorAll('.qm-v').forEach(b => { b.className = `qm-v px-3 py-1.5 rounded-lg font-black ${b.dataset.v === view ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`; });
        const cur = summarize(ofMonth(ym), { groupKey: null });
        const prevRecs = ofMonth(ymAdd(ym, -1));
        const prev = prevRecs.length ? summarize(prevRecs) : null;
        const months = Array.from({ length: 12 }, (_, i) => ymAdd(ym, i - 11));
        const t = target();
        const openActions = records.filter(r => inView(r) && r.date <= `${ym}-31` && r.result !== 'PASS' && !r.actionDone);
        const monthRecs = ofMonth(ym);
        const fails = monthRecs.filter(r => r.result !== 'PASS').sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const itemRank = cur.byItem.slice(0, 10);
        const areaCard = (a) => {
            const recs = records.filter(r => r.area === a && String(r.date).startsWith(ym));
            const s = summarize(recs);
            const p = records.filter(r => r.area === a && String(r.date).startsWith(ymAdd(ym, -1)));
            const ps = p.length ? summarize(p) : null;
            const over = targets[a] > 0 && s.rate > targets[a];
            return `<button type="button" data-area="${a}" class="qm-area text-left bg-white p-4 rounded-2xl border ${view === a ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'} shadow-sm hover:border-indigo-300">
                <div class="flex items-center justify-between"><span class="text-xs font-black" style="color:${AREA_COLOR[a]}">${esc(QC_AREAS[a].label)}</span><span class="text-[10px] text-slate-400">${esc(QC_AREAS[a].inspect)}</span></div>
                <div class="mt-1 text-2xl font-black ${recs.length ? (over ? 'text-rose-600' : 'text-emerald-700') : 'text-slate-300'}">${recs.length ? fmtRate(s.rate) : '-'}</div>
                <div class="text-[11px] text-slate-500">목표 ${fmtRate(targets[a] || 0)} 이하 · 검사 ${s.count}건 · 불량 ${fmtQty(s.defect)} / ${fmtQty(s.inspected)}</div>
                <div class="text-[11px] mt-0.5">${recs.length ? diffText(s.rate, ps ? ps.rate : null) : '<span class="text-slate-400">이달 기록 없음</span>'}${s.fail ? ` · <span class="text-rose-600 font-bold">불합격 ${s.fail}</span>` : ''}</div>
            </button>`;
        };
        const card = (label, value, sub = '', cls = 'text-slate-900') => `<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><div class="text-[11px] font-bold text-slate-500">${label}</div><div class="text-xl font-black mt-1 ${cls}">${value}</div>${sub ? `<div class="text-[11px] mt-0.5">${sub}</div>` : ''}</div>`;
        const monthRows = months.map(m => {
            const row = { m };
            AREAS.forEach(a => { const s = summarize(records.filter(r => r.area === a && String(r.date).startsWith(m))); row[a] = s; });
            row.ALL = summarize(records.filter(r => String(r.date).startsWith(m)));
            return row;
        });
        const cell = (s, a) => (s.count ? `<div class="font-black ${targets[a] && s.rate > targets[a] ? 'text-rose-600' : ''}">${fmtRate(s.rate)}</div><div class="text-[10px] text-slate-400">${fmtQty(s.defect)}/${fmtQty(s.inspected)}</div>` : '<span class="text-slate-300">-</span>');

        $('#qm-body').innerHTML = `
        <div class="space-y-4">
            <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                ${card(`${VIEW_LABEL[view]} 불량률`, cur.count ? fmtRate(cur.rate) : '-', cur.count ? diffText(cur.rate, prev ? prev.rate : null) : '<span class="text-slate-400">이달 기록 없음</span>', t && cur.rate > t ? 'text-rose-600' : 'text-emerald-700')}
                ${card('PPM', fmtPpm(cur.defect, cur.inspected), '<span class="text-slate-400">백만 개당 불량 수</span>')}
                ${card('검사수량', fmtQty(cur.inspected), `<span class="text-slate-400">검사 ${cur.count}건</span>`)}
                ${card('불량수량', fmtQty(cur.defect), '', 'text-rose-600')}
                ${card('불합격', `${cur.fail}건`, `<span class="text-slate-400">조건부 합격 ${cur.cond}건</span>`, cur.fail ? 'text-rose-600' : 'text-slate-900')}
                ${card('미완료 조치', `${openActions.length}건`, '<span class="text-slate-400">이달까지 불합격·조건부 중</span>', openActions.length ? 'text-amber-600' : 'text-slate-900')}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">${AREAS.map(areaCard).join('')}</div>
            <div class="bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
                <div class="text-xs text-slate-600"><b class="text-slate-800">${esc(ymLabel(ym))} 월간 불량률 현황 (${VIEW_LABEL[view]})</b><br><span class="text-[11px] text-slate-400">이 달·보기의 보고서 결재·첨언·첨부입니다. [월간 보고서]로 인쇄하면 결재 칸이 함께 나옵니다.</span></div>
                <div id="qm-appr"></div>
            </div>
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><h3 class="text-sm font-black text-slate-800 mb-2">최근 12개월 불량률 추이</h3><div class="h-64"><canvas id="qm-ch-trend"></canvas></div></div>
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><h3 class="text-sm font-black text-slate-800 mb-2">월별 불량수량 (영역별)</h3><div class="h-64"><canvas id="qm-ch-qty"></canvas></div></div>
            </div>
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><h3 class="text-sm font-black text-slate-800 mb-2">${esc(ymLabel(ym))} 불량 유형 파레토</h3><div class="h-64"><canvas id="qm-ch-pareto"></canvas></div></div>
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <h3 class="text-sm font-black text-slate-800 mb-2">${esc(ymLabel(ym))} 불량 많은 품목 TOP 10</h3>
                    <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600"><tr><th class="px-2 py-1.5 text-left">품목</th><th class="px-2 py-1.5 text-right">건수</th><th class="px-2 py-1.5 text-right">검사</th><th class="px-2 py-1.5 text-right">불량</th><th class="px-2 py-1.5 text-right">불량률</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">${itemRank.length ? itemRank.map(o => `<tr><td class="px-2 py-1.5 font-bold">${esc(o.name)}</td><td class="px-2 py-1.5 text-right">${o.count}</td><td class="px-2 py-1.5 text-right">${fmtQty(o.inspected)}</td><td class="px-2 py-1.5 text-right text-rose-600 font-bold">${fmtQty(o.defect)}</td><td class="px-2 py-1.5 text-right font-black">${fmtRate(o.rate)}</td></tr>`).join('') : '<tr><td colspan="5" class="p-6 text-center text-slate-400">이달 기록 없음</td></tr>'}</tbody></table>
                </div>
            </div>
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <h3 class="text-sm font-black text-slate-800 mb-2">월별 집계표 (최근 12개월)</h3>
                <div class="overflow-x-auto"><table class="w-full text-xs min-w-[720px]"><thead class="bg-slate-50 text-slate-600"><tr><th class="px-2 py-1.5 text-left">월</th>${AREAS.map(a => `<th class="px-2 py-1.5 text-right" style="color:${AREA_COLOR[a]}">${esc(QC_AREAS[a].label)}</th>`).join('')}<th class="px-2 py-1.5 text-right">전체</th><th class="px-2 py-1.5 text-right">불합격</th></tr></thead>
                <tbody class="divide-y divide-slate-100">${monthRows.slice().reverse().map(r => `<tr class="qm-month cursor-pointer hover:bg-indigo-50/40 ${r.m === ym ? 'bg-indigo-50' : ''}" data-ym="${r.m}"><td class="px-2 py-1.5 font-bold whitespace-nowrap">${esc(ymLabel(r.m))}</td>${AREAS.map(a => `<td class="px-2 py-1.5 text-right">${cell(r[a], a)}</td>`).join('')}<td class="px-2 py-1.5 text-right">${cell(r.ALL, null)}</td><td class="px-2 py-1.5 text-right ${r.ALL.fail ? 'text-rose-600 font-bold' : 'text-slate-400'}">${r.ALL.fail}</td></tr>`).join('')}</tbody></table></div>
            </div>
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                ${[['이달 불합격·조건부 합격', fails], ['미완료 조치 (이달까지)', openActions.sort((a, b) => String(a.date).localeCompare(String(b.date)))]].map(([title, list]) => `
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <h3 class="text-sm font-black text-slate-800 mb-2">${title} (${list.length})</h3>
                    <div class="space-y-1.5 max-h-80 overflow-y-auto">${list.length ? list.slice(0, 50).map(r => `
                        <button type="button" data-rec="${esc(r.id)}" class="qm-rec w-full text-left p-2 rounded-lg border border-slate-200 hover:border-indigo-300 text-xs">
                            <div class="flex items-center justify-between gap-2"><span><span class="px-1.5 py-0.5 rounded text-[10px] font-black text-white" style="background:${AREA_COLOR[r.area]}">${esc(QC_AREAS[r.area]?.label || '')}</span> <b>${esc(r.itemName || '')}</b> <span class="text-slate-400">${esc(r.date)} ${esc(r.lot || '')}</span></span>
                            <span class="font-black ${r.result === 'FAIL' ? 'text-rose-600' : 'text-amber-600'}">${esc(QC_RESULTS[r.result] || '')} · ${fmtRate(rateOf(defectQtyOf(r), Number(r.inspectedQty) || 0))}</span></div>
                            ${r.cause || r.action ? `<div class="text-[11px] text-slate-500 mt-0.5 truncate">원인: ${esc(r.cause || '-')} · 조치: ${r.actionDone ? '✔ ' : ''}${esc(r.action || '미기재')}</div>` : ''}
                        </button>`).join('') : '<div class="p-6 text-center text-xs text-slate-400">없음</div>'}</div>
                </div>`).join('')}
            </div>
        </div>`;
        createIcons({ icons });
        mountApprovalBox($('#qm-appr'), apprDoc(), { showToast });
        container.querySelectorAll('.qm-area').forEach(b => b.addEventListener('click', () => setView(view === b.dataset.area ? 'ALL' : b.dataset.area)));
        container.querySelectorAll('.qm-month').forEach(tr => tr.addEventListener('click', () => setYm(tr.dataset.ym)));
        container.querySelectorAll('.qm-rec').forEach(b => b.addEventListener('click', () => openRec(b.dataset.rec)));

        // ---------- 그래프 ----------
        destroyCharts();
        applyChartTheme(Chart);
        const still = document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const animation = still ? false : undefined;
        const series = view === 'ALL' ? [...AREAS, 'ALL'] : [view];
        charts.push(new Chart($('#qm-ch-trend'), {
            type: 'line',
            data: {
                labels: months.map(m => `${Number(m.slice(5))}월`),
                datasets: [
                    ...series.map(a => ({ label: a === 'ALL' ? '전체' : QC_AREAS[a].label, data: monthRows.map(r => (r[a].count ? Number(r[a].rate.toFixed(3)) : null)), borderColor: AREA_COLOR[a], backgroundColor: AREA_COLOR[a], borderWidth: a === 'ALL' ? 3 : 2, tension: 0.25, spanGaps: true })),
                    ...(view !== 'ALL' && targets[view] ? [{ label: `목표 ${targets[view]}%`, data: months.map(() => targets[view]), borderColor: '#f59e0b', borderDash: [6, 4], pointRadius: 0 }] : [])
                ]
            },
            options: { animation, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true, title: { display: true, text: '불량률 %' } } } }
        }));
        charts.push(new Chart($('#qm-ch-qty'), {
            type: 'bar',
            data: { labels: months.map(m => `${Number(m.slice(5))}월`), datasets: (view === 'ALL' ? AREAS : [view]).map(a => ({ label: QC_AREAS[a].label, data: monthRows.map(r => r[a].defect), backgroundColor: `${AREA_COLOR[a]}b3` })) },
            options: { animation, responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
        }));
        const pt = cur.byType.slice(0, 10);
        charts.push(new Chart($('#qm-ch-pareto'), {
            data: {
                labels: pt.map(x => x.type),
                datasets: [
                    { type: 'bar', label: '불량수량', data: pt.map(x => x.qty), backgroundColor: 'rgba(244,63,94,0.6)', yAxisID: 'y' },
                    { type: 'line', label: '누적 비율(%)', data: pt.map(x => Number(x.cum.toFixed(1))), borderColor: '#4f46e5', backgroundColor: '#4f46e5', yAxisID: 'y1' }
                ]
            },
            options: { animation, responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true }, y1: { min: 0, max: 100, position: 'right', grid: { drawOnChartArea: false } } } }
        }));
    };

    const remember = () => { try { localStorage.setItem(KEY, JSON.stringify({ view })); } catch { /* 기억만 못 함 */ } };
    const setView = (v) => { view = v; remember(); render(); };
    const setYm = (m) => { if (!/^\d{4}-\d{2}$/.test(m)) return; ym = m; $('#qm-ym').value = ym; render(); };

    const exportExcel = async () => {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        const months = Array.from({ length: 12 }, (_, i) => ymAdd(ym, i - 11));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(months.map(m => {
            const row = { 월: m };
            [...AREAS, 'ALL'].forEach(a => {
                const s = summarize(records.filter(r => String(r.date).startsWith(m) && (a === 'ALL' || r.area === a)));
                const n = a === 'ALL' ? '전체' : QC_AREAS[a].label;
                row[`${n} 검사`] = s.inspected; row[`${n} 불량`] = s.defect; row[`${n} 불량률(%)`] = Number(s.rate.toFixed(3));
            });
            return row;
        })), '월별 영역별');
        const cur = summarize(ofMonth(ym));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cur.byItem.map(o => ({ 품목: o.name, 코드: o.key, 건수: o.count, 검사수량: o.inspected, 불량수량: o.defect, '불량률(%)': Number(o.rate.toFixed(3)) }))), '품목별');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cur.byType.map(o => ({ 불량유형: o.type, 수량: o.qty, '비율(%)': Number(o.share.toFixed(2)), '누적(%)': Number(o.cum.toFixed(2)) }))), '불량유형');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ofMonth(ym).map(r => ({
            영역: QC_AREAS[r.area]?.label || '', 검사일: r.date, 품목: r.itemName || '', LOT: r.lot || '', 검사수량: Number(r.inspectedQty) || 0, 불량수량: defectQtyOf(r),
            '불량률(%)': Number(rateOf(defectQtyOf(r), Number(r.inspectedQty) || 0).toFixed(3)), 판정: QC_RESULTS[r.result] || '', 원인: r.cause || '', 조치: r.action || '', 조치완료: r.actionDone ? 'Y' : ''
        }))), '이달 검사기록');
        XLSX.writeFile(wb, `월간불량률_${ym}_${VIEW_LABEL[view]}.xlsx`);
    };

    const printReport = () => {
        const cur = summarize(ofMonth(ym));
        const prevRecs = ofMonth(ymAdd(ym, -1));
        const prev = prevRecs.length ? summarize(prevRecs) : null;
        const months = Array.from({ length: 12 }, (_, i) => ymAdd(ym, i - 11));
        const areaRows = AREAS.map(a => {
            const s = summarize(records.filter(r => r.area === a && String(r.date).startsWith(ym)));
            return { name: QC_AREAS[a].label, target: targets[a] || 0, ...s };
        });
        const trendRows = months.map(m => ({ m, ...Object.fromEntries(AREAS.map(a => [a, summarize(records.filter(r => r.area === a && String(r.date).startsWith(m)))])), ALL: summarize(records.filter(r => String(r.date).startsWith(m))) }));
        const rt = (s) => (s.count ? fmtRate(s.rate) : '-');
        const bodyHtml = `
            <h2>1. ${esc(ymLabel(ym))} 요약 (${esc(VIEW_LABEL[view])})</h2>
            <table class="grid"><tr><th>검사 건수</th><th>검사수량</th><th>불량수량</th><th>불량률</th><th>전월 불량률</th><th>PPM</th><th>불합격</th></tr>
            <tr><td class="c">${cur.count}</td><td class="r">${fmtQty(cur.inspected)}</td><td class="r">${fmtQty(cur.defect)}</td><td class="c"><b>${rt(cur)}</b></td><td class="c">${prev ? fmtRate(prev.rate) : '-'}</td><td class="r">${fmtPpm(cur.defect, cur.inspected)}</td><td class="c">${cur.fail}건</td></tr></table>
            <h2>2. 영역별 불량률</h2>${printTableHtml([{ label: '영역', w: 30, get: (o) => o.name }, { label: '검사 건수', w: 20, cls: 'r', get: (o) => o.count }, { label: '검사수량', w: 28, cls: 'r', get: (o) => fmtQty(o.inspected) }, { label: '불량', w: 22, cls: 'r', get: (o) => fmtQty(o.defect) }, { label: '불량률', w: 22, cls: 'r', get: (o) => rt(o) }, { label: '목표', w: 22, cls: 'r', get: (o) => `${fmtRate(o.target)} 이하` }, { label: '판정', get: (o) => (!o.count ? '-' : o.target && o.rate > o.target ? '목표 초과' : '목표 달성') }], areaRows)}
            <h2>3. 최근 12개월 추이</h2>${printTableHtml([{ label: '월', w: 22, get: (o) => o.m }, ...AREAS.map(a => ({ label: QC_AREAS[a].label, w: 30, cls: 'r', get: (o) => rt(o[a]) })), { label: '전체', w: 30, cls: 'r', get: (o) => rt(o.ALL) }, { label: '불합격', cls: 'r', get: (o) => o.ALL.fail }], trendRows)}
            <h2>4. 불량 유형 (파레토)</h2>${printTableHtml([{ label: '불량 유형', w: 70, get: (o) => o.type }, { label: '수량', w: 30, cls: 'r', get: (o) => fmtQty(o.qty) }, { label: '비율', w: 30, cls: 'r', get: (o) => `${o.share.toFixed(1)}%` }, { label: '누적', w: 30, cls: 'r', get: (o) => `${o.cum.toFixed(1)}%` }], cur.byType, { emptyText: '불량 없음' })}
            <h2>5. 불량 많은 품목 TOP 10</h2>${printTableHtml([{ label: '품목', w: 70, get: (o) => o.name }, { label: '건수', w: 18, cls: 'r', get: (o) => o.count }, { label: '검사', w: 28, cls: 'r', get: (o) => fmtQty(o.inspected) }, { label: '불량', w: 22, cls: 'r', get: (o) => fmtQty(o.defect) }, { label: '불량률', cls: 'r', get: (o) => fmtRate(o.rate) }], cur.byItem.slice(0, 10), { emptyText: '기록 없음' })}
            <h2>6. 불합격·조치 내역</h2>${printTableHtml([{ label: '영역', w: 18, get: (r) => QC_AREAS[r.area]?.label || '' }, { label: '검사일', w: 20, get: (r) => r.date }, { label: '품목', w: 45, get: (r) => r.itemName }, { label: '판정', w: 18, get: (r) => QC_RESULTS[r.result] || '' }, { label: '원인', get: (r) => r.cause }, { label: '조치', get: (r) => `${r.actionDone ? '[완료] ' : ''}${r.action || ''}` }], ofMonth(ym).filter(r => r.result !== 'PASS'), { emptyText: '불합격·조건부 합격 없음' })}`;
        printA4({
            title: '월간 불량률 현황', subtitle: `${ymLabel(ym)} · ${VIEW_LABEL[view]}`, meta: [['대상 월', ymLabel(ym)], ['보기', VIEW_LABEL[view]], ['작성', state.currentUser?.name || '']],
            bodyHtml, approvals: apprDoc().roles, approvalKey: apprDoc().key
        });
    };

    const load = async () => {
        $('#qm-body').innerHTML = '<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">불러오는 중...</div>';
        try {
            const [recs, ...cfgs] = await Promise.all([listQc('INSPECT'), ...AREAS.map(a => getDefectConfig(a))]);
            records = recs.filter(r => QC_AREAS[r.area]);
            AREAS.forEach((a, i) => { targets[a] = cfgs[i].target; });
        } catch (e) { $('#qm-body').innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(e.message)}</div>`; return; }
        render();
    };

    container.querySelectorAll('.qm-v').forEach(b => b.addEventListener('click', () => setView(b.dataset.v)));
    $('#qm-ym').addEventListener('change', (e) => setYm(e.target.value));
    $('#qm-prev').addEventListener('click', () => setYm(ymAdd(ym, -1)));
    $('#qm-next').addEventListener('click', () => setYm(ymAdd(ym, 1)));
    $('#qm-xlsx').addEventListener('click', () => exportExcel().catch(e => alert(`엑셀을 만들지 못했습니다: ${e.message}`)));
    $('#qm-print').addEventListener('click', printReport);
    $('#qm-full').addEventListener('click', () => setBoardFullscreen(!isBoardFullscreen(), '#qcMonthly'));
    const obs = new MutationObserver(() => { if (!container.contains($('#qm-body'))) { destroyCharts(); obs.disconnect(); } });
    obs.observe(container, { childList: true });
    load();
    createIcons({ icons });
};
