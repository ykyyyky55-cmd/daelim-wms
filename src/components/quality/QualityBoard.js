// ==========================================
// 현황·보고 › 품질관리 현황판 (qcBoard)
// ==========================================
// 품질관리의 모든 기록을 한 화면에 모은다 (새로 입력하는 것은 없음, services/quality.js 읽기만):
//   · 제품·공정·원부자재 검사(INSPECT) — 이달 불량률·목표 대비·전월 대비·PPM, 최근 6개월 추이, 이달 불량 유형 파레토
//   · 부적합(NCR) 미결·조치기한 지남 · 시험성적서(TEST_REPORT)·COA·공정 점검표(PCHECK) 이달 부적합
//   · 설비(EQUIP·EQUIP_LOG) 점검 지남·30일 안 예정 · MSDS 검토일 지남·90일 안
// 사업장(본사·김포)은 qcStandards.siteOf로 나눈다. 카드·목록을 누르면 그 품질관리 화면(해당 하위 보기)으로 간다.
import Chart from 'chart.js/auto';
import { createIcons, icons } from '../../services/icons.js';
import { esc } from '../../services/html.js';
import { localDateStr } from '../../services/searchUtils.js';
import { applyChartTheme } from '../../services/darkTheme.js';
import { QC_AREAS, QC_RESULTS, defectQtyOf, fmtRate, fmtPpm, EQUIP_STATUS } from '../../services/quality.js';
import { loadQcBoardData, computeQcSummary, openQcView, ymAdd } from '../../services/qcBoardData.js';
import { QC_SITES, NCR_STATUS, NCR_STATUS_CLS } from '../../services/qcStandards.js';
import { setBoardFullscreen, isBoardFullscreen, fullscreenButtonHtml } from '../../services/fullscreen.js';

const AREAS = ['PRODUCT', 'PROCESS', 'MATERIAL'];
const AREA_COLOR = { PRODUCT: '#2563eb', PROCESS: '#7c3aed', MATERIAL: '#ea580c', ALL: '#059669' };
const KEY = 'daelim_qc_board';
const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const ymLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;

export const renderQualityBoard = (container, { onSwitchTab = () => {} } = {}) => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* 기본값 */ }
    let ym = localDateStr().slice(0, 7);
    let site = QC_SITES[saved.site] ? saved.site : '';
    let data = null;
    let targets = {};
    let charts = [];

    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-emerald-600 flex items-center gap-1"><i data-lucide="bar-chart-3" class="w-3.5 h-3.5"></i>현황·보고 › 품질관리 현황판</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="shield-check" class="w-5 h-5 text-emerald-600"></i>품질관리 현황판</h2>
                    <p class="text-xs text-slate-500 mt-1">제품·공정·원부자재 불량률, 부적합 조치, 시험성적서·COA·공정 점검, 설비 점검, MSDS 검토를 한 화면에서 봅니다. 카드나 줄을 누르면 해당 품질관리 화면으로 갑니다.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button type="button" id="qb-refresh" class="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl text-xs font-bold flex items-center gap-1.5"><i data-lucide="refresh-cw" class="w-4 h-4"></i>새로고침</button>
                    ${fullscreenButtonHtml('qb-full')}
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <button type="button" id="qb-prev" class="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-black">◀</button>
                <input type="month" id="qb-ym" value="${ym}" class="border border-slate-300 rounded-lg px-2 py-1 font-bold" />
                <button type="button" id="qb-next" class="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-black">▶</button>
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl ml-1">${[['', '전체 사업장'], ...Object.entries(QC_SITES)].map(([k, l]) => `<button type="button" data-s="${k}" class="qb-site tap-compact px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
            </div>
        </div>
        <div id="qb-body"><div class="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">불러오는 중...</div></div>
    </section>`;
    const $ = (s) => container.querySelector(s);
    const destroyCharts = () => { charts.forEach(c => c.destroy()); charts = []; };
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ site })); } catch { /* 무시 */ } };
    const goQc = (tab, area, sub) => openQcView(onSwitchTab, tab, area, sub);

    const load = async () => {
        $('#qb-body').innerHTML = '<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">불러오는 중...</div>';
        try {
            data = await loadQcBoardData();
            targets = data.targets;
        } catch (e) {
            $('#qb-body').innerHTML = `<div class="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs font-bold text-rose-700">${esc(e.message)}</div>`;
            return;
        }
        draw();
    };

    const draw = () => {
        // 계산은 홈 위젯과 같이 services/qcBoardData.js
        const S = computeQcSummary(data, { ym, site });
        const { today, cur, prev, months, trend, ncrOpen, ncrLate, ncrMonth, docNg, eqLate, eqSoon, eqDown, msds, msLate, msSoon, fails } = S;
        const areaCur = S.area, areaPrev = S.areaPrev;

        const diff = (c, p) => {
            if (!p.count || !c.count) return '<span class="text-slate-400">전월 비교 없음</span>';
            const d = c.rate - p.rate;
            return `<span class="${d > 0 ? 'text-rose-600' : d < 0 ? 'text-emerald-600' : 'text-slate-500'} font-bold">전월 ${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d).toFixed(2)}%p</span>`;
        };
        const kpi = (label, value, sub, cls, go) => `<button type="button" ${go ? `data-go="${go}"` : ''} class="qb-go text-left bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-300 transition"><div class="text-[11px] font-bold text-slate-500">${label}</div><div class="text-2xl font-black ${cls}">${value}</div><div class="text-[11px] text-slate-500 mt-0.5">${sub}</div></button>`;
        const areaCard = (a) => {
            const s = areaCur[a], t = targets[a];
            const over = s.count && t !== undefined && s.rate > t;
            return `<button type="button" data-go="${QC_AREAS[a].tab}" class="qb-go text-left bg-white p-4 rounded-2xl border-2 ${over ? 'border-rose-300' : 'border-slate-200'} shadow-sm hover:border-emerald-300 transition space-y-1">
                <div class="flex items-center justify-between"><span class="text-xs font-black flex items-center gap-1.5" style="color:${AREA_COLOR[a]}"><i data-lucide="${QC_AREAS[a].icon}" class="w-4 h-4"></i>${QC_AREAS[a].label}</span>
                    ${s.count ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-black ${over ? 'bg-rose-600 text-white' : 'bg-emerald-100 text-emerald-700'}">${over ? '목표 초과' : '목표 이내'}</span>` : '<span class="text-[10px] text-slate-400">기록 없음</span>'}</div>
                <div class="text-2xl font-black text-slate-900">${s.count ? fmtRate(s.rate) : '-'}</div>
                <div class="text-[11px] text-slate-500">목표 ${t ?? '-'}% · ${diff(s, areaPrev[a])}</div>
                <div class="text-[11px] text-slate-600">${QC_AREAS[a].inspect} ${s.count}건 · 검사 ${fmt(s.inspected)} · 불량 <b class="text-rose-600">${fmt(s.defect)}</b> · ${fmtPpm(s.defect, s.inspected)} PPM</div>
                <div class="text-[11px] text-slate-500">불합격 ${s.fail} · 조건부 ${s.cond}</div>
            </button>`;
        };
        const panel = (title, icon, cls, rows, empty, go) => `<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2">
            <div class="flex items-center justify-between"><h3 class="text-xs font-black text-slate-800 flex items-center gap-1.5"><i data-lucide="${icon}" class="w-4 h-4 ${cls}"></i>${title}</h3>${go ? `<button type="button" data-go="${go}" class="qb-go text-[11px] font-bold text-emerald-700 hover:underline">열기 →</button>` : ''}</div>
            <div class="space-y-1 max-h-64 overflow-y-auto">${rows.length ? rows.join('') : `<div class="text-[11px] text-slate-400 py-3 text-center">${empty}</div>`}</div></div>`;
        const line = (left, mid, right, go = '', warn = false) => `<div ${go ? `data-go="${go}"` : ''} class="${go ? 'qb-go cursor-pointer hover:bg-slate-50' : ''} flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-lg ${warn ? 'bg-rose-50' : ''}"><span class="shrink-0 text-slate-400">${left}</span><span class="flex-1 min-w-0 truncate text-slate-700">${mid}</span><span class="shrink-0">${right}</span></div>`;
        const pt = cur.byType.slice(0, 8);

        $('#qb-body').innerHTML = `
        <div class="space-y-4">
            <div class="grid grid-cols-2 lg:grid-cols-6 gap-3">
                ${kpi(`${ymLabel(ym)} 전체 불량률`, cur.count ? fmtRate(cur.rate) : '-', `${diff(cur, prev)} · ${fmtPpm(cur.defect, cur.inspected)} PPM`, 'text-emerald-700', 'qcMonthly')}
                ${kpi('검사 건수', `${cur.count}건`, `검사 ${fmt(cur.inspected)} · 불량 ${fmt(cur.defect)}`, 'text-slate-900', 'qcMonthly')}
                ${kpi('불합격·조건부', `${cur.fail + cur.cond}건`, `불합격 ${cur.fail} · 조건부 ${cur.cond}`, cur.fail ? 'text-rose-600' : 'text-slate-900', 'qcProduct')}
                ${kpi('부적합 미결', `${ncrOpen.length}건`, ncrLate.length ? `<span class="text-rose-600 font-bold">조치기한 지남 ${ncrLate.length}건</span>` : `이달 발생 ${ncrMonth.length}건`, ncrLate.length ? 'text-rose-600' : 'text-amber-600', 'ncr')}
                ${kpi('설비 점검', `${eqLate.length}건 지남`, `30일 안 ${eqSoon.length} · 정지·수리 ${eqDown.length}`, eqLate.length ? 'text-rose-600' : 'text-slate-900', 'qcEquipment')}
                ${kpi('MSDS 검토', `${msLate.length}건 지남`, `90일 안 ${msSoon.length} · 전체 ${msds.length}`, msLate.length ? 'text-rose-600' : 'text-slate-900', 'qcMsds')}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">${AREAS.map(areaCard).join('')}</div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><h3 class="text-xs font-black text-slate-800 mb-2">최근 6개월 불량률 추이</h3><div class="h-60"><canvas id="qb-ch-trend"></canvas></div></div>
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><h3 class="text-xs font-black text-slate-800 mb-2">${ymLabel(ym)} 불량 유형 (파레토)</h3>${pt.length ? '<div class="h-60"><canvas id="qb-ch-pareto"></canvas></div>' : '<div class="h-60 flex items-center justify-center text-xs text-slate-400">이달 불량 기록이 없습니다.</div>'}</div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                ${panel(`부적합(NCR) 미결 ${ncrOpen.length}건`, 'triangle-alert', 'text-rose-600', ncrOpen.slice(0, 12).map(r => line(esc(String(r.date).slice(5)), `${esc(QC_AREAS[r.area]?.label || '')} · ${esc(r.itemName || '-')} ${esc(String(r.description || '').slice(0, 30))}`,
                    `<span class="px-1.5 py-0.5 rounded text-[10px] font-black ${NCR_STATUS_CLS[r.status] || ''}">${esc(NCR_STATUS[r.status] || '')}</span>${r.dueDate ? ` <span class="${r.dueDate < today ? 'text-rose-600 font-black' : 'text-slate-400'}">~${esc(r.dueDate.slice(5))}</span>` : ''}`, `ncr:${r.area || 'PRODUCT'}`, r.dueDate && r.dueDate < today)), '미결 부적합이 없습니다.')}
                ${panel(`이달 판정 부적합 ${docNg.length}건`, 'file-x', 'text-rose-600', docNg.map(x => line(esc(String(x.r.date).slice(5)), `${x.kind} · ${esc(x.r.productName || x.r.itemName || x.r.title || x.r.line || x.r.place || x.r.lot || (x.sub === 'pcheck' ? (x.r.stage === 'BLEND' ? '원액생산' : '완제품포장') : ''))}`, '<span class="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black">NG</span>', `sub:${x.tab}:${x.area}:${x.sub}`, true)),
                    `시험성적서 ${S.docCount.tr} · COA ${S.docCount.coa} · 공정 점검표 ${S.docCount.pcheck}건 모두 적합`)}
                ${panel(`최근 불합격·조건부 검사`, 'x-circle', 'text-amber-600', fails.map(r => line(esc(String(r.date).slice(5)), `${esc(QC_AREAS[r.area]?.label || '')} · ${esc(r.itemName || r.itemCode || '')}`, `<span class="${r.result === 'FAIL' ? 'text-rose-600' : 'text-amber-600'} font-black">${esc(QC_RESULTS[r.result] || '')}</span> <span class="text-slate-400">${fmt(defectQtyOf(r))}</span>`, QC_AREAS[r.area]?.tab || 'qcProduct', r.result === 'FAIL')), '불합격 검사가 없습니다.')}
                ${panel(`설비 점검 지남·30일 안 예정`, 'cog', 'text-slate-600', [...eqLate, ...eqSoon].slice(0, 12).map(e => line(esc(String(e.next).slice(5)), `${esc(e.name)} <span class="text-slate-400">${esc(e.code || '')}</span>`, `<span class="${e.left < 0 ? 'text-rose-600 font-black' : 'text-amber-700 font-bold'}">${e.left < 0 ? `${-e.left}일 지남` : e.left === 0 ? '오늘' : `${e.left}일 남음`}</span>`, 'qcEquipment', e.left < 0))
                    .concat(eqDown.map(e => line('상태', esc(e.name), `<span class="text-rose-600 font-bold">${esc(EQUIP_STATUS[e.status])}</span>`, 'qcEquipment', true))), '다가오는 점검이 없습니다.', 'qcEquipment')}
                ${panel(`MSDS 검토일 지남·90일 안`, 'flask-conical', 'text-slate-600', [...msLate, ...msSoon].sort((a, b) => a.left - b.left).slice(0, 12).map(m => line(esc(String(m.rv).slice(2)), esc(m.productName || m.itemName || m.name || ''), `<span class="${m.left < 0 ? 'text-rose-600 font-black' : 'text-amber-700 font-bold'}">${m.left < 0 ? `${-m.left}일 지남` : `${m.left}일`}</span>`, 'qcMsds', m.left < 0)), '검토가 필요한 MSDS가 없습니다.', 'qcMsds')}
                ${panel(`불량 많은 품목 (${ymLabel(ym)})`, 'list-ordered', 'text-slate-600', cur.byItem.filter(x => x.defect > 0).slice(0, 10).map(x => line(`${fmt(x.defect)}`, esc(x.name), `<span class="text-slate-500">${fmtRate(x.rate)}</span>`)), '이달 불량 품목이 없습니다.', 'qcMonthly')}
            </div>
        </div>`;
        container.querySelectorAll('.qb-go').forEach(el => el.addEventListener('click', () => {
            const g = el.dataset.go; if (!g) return;
            if (g === 'ncr') return goQc('qcProduct', 'PRODUCT', 'ncr');
            if (g.startsWith('ncr:')) { const a = g.slice(4); return goQc(QC_AREAS[a]?.tab || 'qcProduct', a, 'ncr'); }
            if (g.startsWith('sub:')) { const [, tab, area, sub] = g.split(':'); return goQc(tab, area, sub); }
            if (g === 'qcMonthly') window.__qcMonthlyYm = ym;
            onSwitchTab(g);
        }));
        createIcons({ icons });

        destroyCharts();
        applyChartTheme(Chart);
        const animation = document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? false : undefined;
        charts.push(new Chart($('#qb-ch-trend'), {
            type: 'line',
            data: {
                labels: months.map(m => `${Number(m.slice(5))}월`),
                datasets: [...AREAS.map(a => ({ label: QC_AREAS[a].label, data: trend.map(t => (t[a].count ? Number(t[a].rate.toFixed(3)) : null)), borderColor: AREA_COLOR[a], backgroundColor: AREA_COLOR[a], borderWidth: 2, tension: 0.25, spanGaps: true })),
                    { label: '전체', data: trend.map(t => (t.all.count ? Number(t.all.rate.toFixed(3)) : null)), borderColor: AREA_COLOR.ALL, backgroundColor: AREA_COLOR.ALL, borderWidth: 3, tension: 0.25, spanGaps: true }]
            },
            options: { animation, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true, title: { display: true, text: '불량률 %' } } } }
        }));
        if (pt.length) charts.push(new Chart($('#qb-ch-pareto'), {
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

    const paintSite = () => container.querySelectorAll('.qb-site').forEach(b => { b.className = `qb-site tap-compact px-3 py-1.5 rounded-lg font-black ${b.dataset.s === site ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-600'}`; });
    const setYm = (m) => { if (!m) return; ym = m; $('#qb-ym').value = ym; if (data) draw(); };
    $('#qb-prev').addEventListener('click', () => setYm(ymAdd(ym, -1)));
    $('#qb-next').addEventListener('click', () => setYm(ymAdd(ym, 1)));
    $('#qb-ym').addEventListener('change', (e) => setYm(e.target.value));
    container.querySelectorAll('.qb-site').forEach(b => b.addEventListener('click', () => { site = b.dataset.s; persist(); paintSite(); if (data) draw(); }));
    $('#qb-refresh').addEventListener('click', load);
    $('#qb-full').addEventListener('click', () => setBoardFullscreen(!isBoardFullscreen(), '#qcBoard'));
    paintSite();
    createIcons({ icons });
    load();
};
