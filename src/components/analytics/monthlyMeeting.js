import Chart from 'chart.js/auto';
import { state } from '../../services/db.js';
import { esc } from '../../services/html.js';
import { createIcons, icons } from '../../services/icons.js';
import { canPerformAction } from '../../services/auth.js';
import { saveReport, listReports } from '../../services/reports.js';
import { localDateStr } from '../../services/searchUtils.js';
import { loadMonthLines, getPlan, PURCH_LINE_STATUS } from '../../services/plans.js';
import { loadWorkPlan, summarizeTasks, effectiveStatus, WORK_STATUS, nextMonth, prevMonth } from '../../services/workPlans.js';
import { applyChartTheme } from '../../services/darkTheme.js';
import { approvalPrintHtml } from '../approval/ApprovalBox.js';
import { computeRawInbound, REGION_COLORS } from './rawInbound.js';

// 월간 실적 현황판 → 월례회의 자료 (PPT · PDF 보고서)
// 회의 월(M)을 고르면 실적은 전월(M-1), 계획은 이달(M): collectMeetingData의 D.ym = 실적 달(전월), D.nym = 회의 월(이달)
// 재료: 현황판의 생산실적(업무일지 집계, 전월) + 원료입고 실적(원료수불부, 전월) + 업무추진계획서(전월 현황·이달 중점)
//       + 월간 생산계획·구매계획(주간 계획 취합: 전월 계획 대비 실적·구매 이행, 이달 계획)
// PPT: pptxgenjs로 편집 가능한 차트·표 슬라이드(16:9, 맑은 고딕). PDF: A4 세로 보고서를 새 창에 그려 인쇄 → 'PDF로 저장'.
// 두 양식 모두 같은 자료(collectMeetingData)를 쓴다.
const OPTS_KEY = 'daelim_meeting_opts';
const SITE_LABEL = { HQ: '본사', GIMPO: '김포' };
const SITE_COLOR = { HQ: '#2563eb', GIMPO: '#059669' };
export const MEETING_SECTIONS = [
    ['prod', '전월 생산 실적 (포장·카테고리·TOP 10)'], ['oil', '전월 원액 생산 · 작업공수'], ['raw', '전월 원료입고 실적'],
    ['plan', '전월 생산계획 대비 실적'], ['purch', '전월 구매계획 이행'], ['work', '전월 업무추진 현황'],
    ['docs', '첨부 보고서 (추진계획 등)'], ['next', '이달 생산·구매계획 · 중점 추진'], ['issue', '이슈 · 건의사항']
];
const fmt = (n, d = 0) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: d });
const ymLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
const pctText = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');
const deltaText = (cur, before, perA = 1, perB = 1) => {
    if (!before || !perA || !perB) return '전월 자료 없음';
    const r = ((cur / perA - before / perB) / (before / perB)) * 100;
    return `${r >= 0 ? '▲' : '▼'} ${Math.abs(r).toFixed(1)}%`;
};

// ---------- 자료 모으기 ----------
const groupPlan = (lines) => {
    const m = new Map();
    lines.filter(l => l.code || l.name).forEach(l => {
        const k = `${l.site}|${l.type}|${l.code || l.name}`;
        const g = m.get(k) || { site: l.site || '', type: l.type || '완제품', code: l.code || '', name: l.name || '', unit: l.unit || 'EA', qty: 0, done: 0, entered: false, firstDate: l.date || '', partners: new Set() };
        g.qty += Number(l.qty) || 0;
        if (l.date && (!g.firstDate || l.date < g.firstDate)) g.firstDate = l.date;
        g.done += l.status === 'DONE' ? (Number(l.doneQty) || Number(l.qty) || 0) : (Number(l.doneQty) || 0);
        if (l.status === 'DONE' || Number(l.doneQty) > 0) g.entered = true;
        if (l.partner) g.partners.add(l.partner);
        m.set(k, g);
    });
    return [...m.values()].sort((a, b) => a.type.localeCompare(b.type) || b.qty - a.qty);
};
const groupPurch = (lines) => {
    const m = new Map();
    const status = Object.fromEntries(Object.keys(PURCH_LINE_STATUS).map(k => [k, 0]));
    let amount = 0;
    lines.filter(l => l.code || l.name).forEach(l => {
        status[l.status || 'PLAN'] = (status[l.status || 'PLAN'] || 0) + 1;
        const amt = (Number(l.qty) || 0) * (Number(l.price) || 0);
        amount += amt;
        const k = `${l.site}|${l.code || l.name}|${l.unit}`;
        const g = m.get(k) || { site: l.site || '', code: l.code || '', name: l.name || '', unit: l.unit || 'EA', qty: 0, amount: 0, suppliers: new Set(), statuses: new Set(), eta: '' };
        g.qty += Number(l.qty) || 0; g.amount += amt;
        if (l.supplier) g.suppliers.add(l.supplier);
        g.statuses.add(PURCH_LINE_STATUS[l.status] || '계획');
        if (l.eta && (!g.eta || l.eta < g.eta)) g.eta = l.eta;
        m.set(k, g);
    });
    const count = lines.filter(l => l.code || l.name).length;
    return { rows: [...m.values()].sort((a, b) => b.amount - a.amount || b.qty - a.qty), status, amount, count };
};

export const collectMeetingData = async (snap, form) => {
    const ym = snap.ym, nym = nextMonth(ym);
    const siteName = SITE_LABEL[snap.view] || '';
    const siteOk = (l) => !siteName || l.site === siteName;
    const [prodThis, prodNext, purchThis, purchNext, prodHead, prodHeadNext, work, workNext] = await Promise.all([
        loadMonthLines('PROD_WEEK', ym), loadMonthLines('PROD_WEEK', nym), loadMonthLines('PURCH_WEEK', ym), loadMonthLines('PURCH_WEEK', nym),
        getPlan('PROD_MONTH', ym), getPlan('PROD_MONTH', nym), loadWorkPlan('WORK_MONTH', ym), loadWorkPlan('WORK_MONTH', nym)
    ]);
    const plan = groupPlan(prodThis.lines.filter(siteOk));
    // 계획 화면에 실적을 적지 않은 품목은 업무일지의 포장(완제품)·원액 생산 실적으로 채운다
    // (같은 거점, 품목코드 또는 품목명, 그 품목의 첫 계획일부터 그 달 말까지 — 계획 전에 만든 양은 넣지 않음)
    const siteKey = { 본사: 'HQ', 김포: 'GIMPO' };
    const codeOf = (item) => String(item || '').split(' / ')[0].trim();
    const nameOf = (item) => String(item || '').split(' / ').slice(1).join(' / ').split(' | ')[0].trim();
    plan.forEach(r => {
        if (r.entered) { r.src = '계획 입력'; return; }
        const rows = snap.days.filter(d => d.site === siteKey[r.site] && (!r.firstDate || d.date >= r.firstDate)).flatMap(d => (r.type === '원액' ? d.log.oilBlending : d.log.packaging) || []);
        const qty = rows.filter(x => (r.code && codeOf(x.item) === r.code) || (!r.code && nameOf(x.item) === r.name) || String(x.item || '').trim() === r.name)
            .reduce((a, x) => a + (Number(x.qty) || 0), 0);
        if (qty > 0) { r.done = qty; r.src = '업무일지'; }
    });
    const planNext = groupPlan(prodNext.lines.filter(siteOk));
    const planTot = (rows, type, k) => rows.filter(r => r.type === type).reduce((s, r) => s + r[k], 0);
    const raw = computeRawInbound(ym, snap.view);
    const rawPrev = computeRawInbound(prevMonth(ym), snap.view);
    const tasks = (work.tasks || []).filter(t => t.title);
    // 첨부 보고서: 보고서 메뉴의 검토 보고서(DOC) 중 대화창에서 고른 것
    const docIds = form.sections.includes('docs') ? (form.docIds || []) : [];
    const docs = docIds.length ? (await listReports()).filter(r => r.kind === 'DOC' && docIds.includes(r.id)) : [];
    return {
        docs,
        ym, nym, view: snap.view, siteLabel: siteName || '전체 (본사·김포)', form, snap,
        plan, planNext, planKpi: { prodPlan: planTot(plan, '완제품', 'qty'), prodDone: planTot(plan, '완제품', 'done'), oilPlan: planTot(plan, '원액', 'qty'), oilDone: planTot(plan, '원액', 'done') },
        planNextKpi: { prod: planTot(planNext, '완제품', 'qty'), oil: planTot(planNext, '원액', 'qty') },
        prodHead, prodHeadNext,
        purch: groupPurch(purchThis.lines.filter(siteOk)), purchNext: groupPurch(purchNext.lines.filter(siteOk)),
        raw, rawPrev, work, workNext, tasks, taskSum: summarizeTasks(tasks)
    };
};

// ---------- 그래프 자료 (PPT 기본 차트 · PDF 이미지 공용) ----------
const chartSets = (D) => {
    const s = D.snap;
    const sites = s.view === 'ALL' ? ['HQ', 'GIMPO'] : [s.view];
    const dates = [...new Set(s.days.map(d => d.date))].sort();
    const val = (site, date, k) => s.days.filter(d => d.date === date && d.site === site).reduce((a, d) => a + (Number(d[k]) || 0), 0);
    const oilDates = dates.filter(d => sites.some(x => val(x, d, 'oil') > 0));
    const rawDates = [...new Set(D.raw.rows.map(r => r.date))].sort();
    const rawRegions = D.raw.regions.filter(g => D.raw.byRegion[g] > 0);
    const topPlan = D.plan.filter(r => r.type === '완제품').slice(0, 10);
    return {
        pack: { labels: dates.map(d => d.slice(5)), series: sites.map(x => ({ name: `${SITE_LABEL[x]} (EA)`, values: dates.map(d => val(x, d, 'pack')), color: SITE_COLOR[x] })) },
        // 작은 조각은 이름이 겹치므로 상위 5개 + 나머지는 '그 밖'으로 묶는다
        category: (() => { const top = s.categories.slice(0, 5), rest = s.categories.slice(5).reduce((a, c) => a + c[1], 0); return { labels: [...top.map(c => c[0]), ...(rest ? ['그 밖'] : [])], series: [{ name: '포장(EA)', values: [...top.map(c => c[1]), ...(rest ? [rest] : [])] }] }; })(),
        oil: { labels: oilDates.map(d => d.slice(5)), series: sites.map(x => ({ name: `${SITE_LABEL[x]} (L)`, values: oilDates.map(d => val(x, d, 'oil')), color: SITE_COLOR[x] })) },
        manhours: { labels: ['제품포장', '원액생산', '라벨부착', '기타업무'], series: [{ name: '공수', values: [s.t.mhPack, s.t.mhOil, s.t.mhLabel, s.t.mhOther].map(v => Math.round(v * 10) / 10) }] },
        raw: { labels: rawDates.map(d => d.slice(5)), series: (rawRegions.length ? rawRegions : D.raw.regions.slice(0, 1)).map(g => ({ name: `${g} (L)`, values: rawDates.map(d => D.raw.rows.filter(r => r.date === d && r.region === g).reduce((a, r) => a + r.qty, 0)), color: REGION_COLORS[g] || '#475569' })) },
        planVs: { labels: topPlan.map(r => r.name.slice(0, 14)), series: [{ name: '계획', values: topPlan.map(r => r.qty), color: '#94a3b8' }, { name: '실적', values: topPlan.map(r => r.done), color: '#2563eb' }] }
    };
};
const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316'];

// Chart.js로 그린 그래프를 PNG 이미지로 (PDF 보고서용, 밝은 색으로)
const chartImage = async (type, set, { stacked = false, w = 1000, h = 380, horizontal = false } = {}) => {
    if (!set.labels.length) return '';
    const holder = document.createElement('div');
    holder.style.cssText = `position:fixed;left:-20000px;top:0;width:${w}px;height:${h}px;`;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    holder.appendChild(canvas);
    document.body.appendChild(holder);
    const saved = { color: Chart.defaults.color, border: Chart.defaults.borderColor, arc: Chart.defaults.elements.arc.borderColor };
    Chart.defaults.color = '#334155'; Chart.defaults.borderColor = 'rgba(0,0,0,0.1)'; Chart.defaults.elements.arc.borderColor = '#fff';
    const font = { family: 'Noto Sans KR', size: 13, weight: 'bold' };
    const round = type === 'doughnut';
    const chart = new Chart(canvas, {
        type,
        data: { labels: set.labels, datasets: set.series.map((s, i) => ({ label: s.name, data: s.values, backgroundColor: round ? PALETTE : (s.color || PALETTE[i]), borderRadius: round ? 0 : 3, ...(stacked ? { stack: 'q' } : {}) })) },
        options: {
            responsive: false, animation: false, devicePixelRatio: 2, indexAxis: horizontal ? 'y' : 'x',
            plugins: { legend: { position: round ? 'right' : 'top', labels: { font, boxWidth: 14 } } },
            ...(round ? {} : { scales: { x: { stacked, grid: { display: false }, ticks: { font: { size: 12 } } }, y: { stacked, ticks: { font: { size: 12 } } } } })
        }
    });
    const url = chart.toBase64Image();
    chart.destroy();
    holder.remove();
    Object.assign(Chart.defaults, { color: saved.color, borderColor: saved.border });
    Chart.defaults.elements.arc.borderColor = saved.arc;
    applyChartTheme(Chart);
    return url;
};

// ---------- 공통 요약 ----------
const kpiList = (D) => {
    const s = D.snap, t = s.t, p = s.prev;
    return [
        ['완제품 포장', `${fmt(t.pack)} EA`, `전월 일평균 대비 ${deltaText(t.pack, p?.pack, s.workDays, s.prevDays)}`],
        ['원액 생산', `${fmt(t.oil)} L`, `${t.oilBatches}배치 · 전월 일평균 대비 ${deltaText(t.oil, p?.oil, s.workDays, s.prevDays)}`],
        ['라벨부착', `${fmt(t.label)} EA`, `공수 ${fmt(t.mhLabel, 1)}`],
        ['작업공수', `${fmt(t.manHours, 1)} 공수`, `작업일 ${s.workDays}일 · 일평균 ${fmt(s.workDays ? t.manHours / s.workDays : 0, 1)}`],
        ['포장 생산성', `${fmt(s.packProd)} EA/공수`, `전월 대비 ${deltaText(s.packProd, s.prevPackProd)}`],
        ['원료 입고', `${fmt(D.raw.total.qty)} L`, `${D.raw.total.count}건 · 전월 대비 ${deltaText(D.raw.total.qty, D.rawPrev.total.qty)}`],
        ['생산계획 달성률', D.planKpi.prodPlan ? pctText(D.planKpi.prodDone, D.planKpi.prodPlan) : '계획 없음', `완제품 실적 ${fmt(D.planKpi.prodDone)} / 계획 ${fmt(D.planKpi.prodPlan)}`],
        ['업무추진', D.taskSum.total ? `평균 ${D.taskSum.avg.toFixed(0)}%` : '계획서 없음', D.taskSum.total ? `과제 ${D.taskSum.total} · 완료 ${D.taskSum.count.DONE} · 지연 ${D.taskSum.count.DELAY}` : '생산관리 → 업무추진계획']
    ];
};
// 제목은 회의 월(이달), 실적 절은 전월 이름을 붙인다
const title = (D) => `${ymLabel(D.nym)} ${D.form.dept} 월례회의`;
const R = (D) => ymLabel(D.ym); // 실적 달 (전월)
const P = (D) => ymLabel(D.nym); // 계획 달 (이달 = 회의 월)

// ---------- PDF 보고서 (A4 세로, 인쇄 → PDF로 저장) ----------
export const exportMeetingPdf = async (D, w = window.open('', '_blank')) => {
    if (!w) { alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
    const on = (k) => D.form.sections.includes(k);
    const C = chartSets(D);
    const img = {
        pack: on('prod') ? await chartImage('bar', C.pack, { stacked: true }) : '',
        category: on('prod') ? await chartImage('doughnut', C.category, { w: 480, h: 300 }) : '',
        oil: on('oil') ? await chartImage('bar', C.oil, { stacked: true, h: 320 }) : '',
        raw: on('raw') ? await chartImage('bar', C.raw, { stacked: true, h: 320 }) : '',
        planVs: on('plan') ? await chartImage('bar', C.planVs, { h: 340 }) : ''
    };
    const s = D.snap;
    let no = 0;
    const h2 = (t) => `<h2>${++no}. ${esc(t)}</h2>`;
    const table = (head, rows, { widths = [], empty = '자료 없음', cls = [] } = {}) => `
        <table class="grid"><colgroup>${head.map((_, i) => `<col style="${widths[i] ? `width:${widths[i]}mm` : ''}">`).join('')}</colgroup>
        <thead><tr>${head.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead>
        <tbody>${rows.length ? rows.map(r => `<tr>${r.map((c, i) => `<td class="${cls[i] || ''}">${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}" class="c">${esc(empty)}</td></tr>`}</tbody></table>`;
    const note = (t) => (t ? `<div class="notes">${esc(t)}</div>` : '');
    const more = (n, shown) => (n > shown ? `<p class="small">외 ${n - shown}건은 월간 실적 현황판·계획 화면에서 확인</p>` : '');
    const sec = [];
    sec.push(`${h2(`핵심 요약 (${R(D)} 실적)`)}<div class="kpis">${kpiList(D).map(([k, v, sub]) => `<div class="kpi"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(sub)}</div></div>`).join('')}</div>`);
    if (on('prod')) {
        sec.push(`<div class="block">${h2(`${R(D)} 생산 실적`)}<p class="lead">완제품 포장 <b>${fmt(s.t.pack)} EA</b> (${fmt(s.t.packBox)}박스, 포장 공수 ${fmt(s.t.mhPack, 1)}) · 작업일 ${s.workDays}일${s.view === 'ALL' ? ` · 본사 ${fmt(s.bySite.HQ.pack)} / 김포 ${fmt(s.bySite.GIMPO.pack)} EA` : ''}</p>
            ${img.pack ? `<h3>일자별 완제품 포장 (EA)</h3><img class="chart" src="${img.pack}">` : '<p class="small">포장 실적 없음</p>'}</div>
            <div class="block two"><div>${img.category ? `<h3>카테고리별 포장</h3><img class="chart" src="${img.category}">` : ''}</div>
            <div><h3>포장 TOP 10 품목</h3>${table(['#', '품목', '포장(EA)', '박스'], s.products.slice(0, 10).map((p, i) => [i + 1, esc(p.item), fmt(p.qty), fmt(p.box)]), { widths: [7, 0, 20, 14], cls: ['c', '', 'r', 'r'] })}</div></div>`);
    }
    if (on('oil')) {
        sec.push(`<div class="block">${h2(`${R(D)} 원액 생산 · 작업공수`)}<p class="lead">원액 <b>${fmt(s.t.oil)} L</b> · ${s.t.oilBatches}배치 · 원액 공수 ${fmt(s.t.mhOil, 1)} (${fmt(s.oilProd)} L/공수)</p>
            ${img.oil ? `<img class="chart" src="${img.oil}">` : ''}
            <div class="two"><div><h3>원액 품목별</h3>${table(['원액', '생산(L)', '배치', '공수'], s.oils.slice(0, 10).map(o => [esc(o.item), fmt(o.qty), o.batches, fmt(o.manHours, 2)]), { widths: [0, 22, 12, 14], cls: ['', 'r', 'r', 'r'] })}${more(s.oils.length, 10)}</div>
            <div><h3>작업공수 유형별</h3>${table(['유형', '공수', '비율'], [['제품포장', s.t.mhPack], ['원액생산', s.t.mhOil], ['라벨부착', s.t.mhLabel], ['기타업무', s.t.mhOther]].map(([k, v]) => [k, fmt(v, 1), pctText(v, s.t.manHours)]).concat([[`<b>합계</b>`, `<b>${fmt(s.t.manHours, 1)}</b>`, '100%']]), { widths: [0, 22, 18], cls: ['', 'r', 'r'] })}
            ${s.taskGroups.length ? `<h3>기타업무 종류별 (공수 상위)</h3>${table(['종류', '건수', '공수'], s.taskGroups.slice(0, 6).map(g => [esc(g.type), g.count, fmt(g.manHours, 2)]), { widths: [0, 14, 18], cls: ['', 'r', 'r'] })}` : ''}</div></div></div>`);
    }
    if (on('raw')) {
        const r = D.raw;
        sec.push(`<div class="block">${h2(`${R(D)} 원료입고 실적`)}<p class="lead">원료 입고 <b>${fmt(r.total.qty)} L</b> (${fmt(r.total.kg)} kg) · ${r.total.count}건 · 원료 ${r.byItem.length}품목 · 같은 기간 사용 ${fmt(r.total.useQty)} L · 전월 대비 ${deltaText(r.total.qty, D.rawPrev.total.qty)}</p>
            ${img.raw ? `<img class="chart" src="${img.raw}">` : ''}
            ${table(['원료', '입고(L)', '중량(kg)', '건수', '공급처'], r.byItem.slice(0, 12).map(g => [esc(g.name), fmt(g.qty), g.kg ? fmt(g.kg) : '-', g.count, esc([...g.suppliers].join(', '))]), { widths: [0, 22, 22, 12, 50], cls: ['', 'r', 'r', 'r', ''] })}${more(r.byItem.length, 12)}
            <p class="small">원료수불부 매입 입고만 집계 (거점이동·재고조사·원액 생산 입고 제외)</p></div>`);
    }
    if (on('plan')) {
        const rows = D.plan;
        sec.push(`<div class="block">${h2(`${ymLabel(D.ym)} 생산계획 대비 실적`)}<p class="lead">완제품 계획 ${fmt(D.planKpi.prodPlan)} · 실적 ${fmt(D.planKpi.prodDone)} · 달성률 <b>${D.planKpi.prodPlan ? pctText(D.planKpi.prodDone, D.planKpi.prodPlan) : '-'}</b>${D.planKpi.oilPlan ? ` · 원액 계획 ${fmt(D.planKpi.oilPlan)} L / 실적 ${fmt(D.planKpi.oilDone)} L` : ''}</p>
            <p class="small">실적 = 생산계획에 적은 실적 수량, * 표시는 적지 않아 업무일지의 포장·원액 생산 실적(그 품목의 첫 계획일부터)으로 채운 값</p>
            ${img.planVs ? `<img class="chart" src="${img.planVs}">` : ''}
            ${table(['거점', '구분', '품목', '계획', '실적', '달성률', '단위'], rows.slice(0, 15).map(r => [esc(r.site), esc(r.type), esc(r.name), fmt(r.qty), `${fmt(r.done)}${r.src === '업무일지' ? '*' : ''}`, pctText(r.done, r.qty), esc(r.unit)]), { widths: [12, 14, 0, 20, 20, 16, 12], cls: ['c', 'c', '', 'r', 'r', 'r', 'c'], empty: `${R(D)} 생산계획 없음` })}${more(rows.length, 15)}
            ${note(D.prodHead?.notes || D.prodHead?.goals || '')}</div>`);
    }
    if (on('purch')) {
        const p = D.purch;
        sec.push(`<div class="block">${h2(`${ymLabel(D.ym)} 구매계획 이행`)}<p class="lead">구매 ${p.count}건 · 입고완료 ${p.status.RECEIVED || 0} · 발주 ${p.status.ORDER || 0} · 계획 ${p.status.PLAN || 0} · 보류 ${p.status.HOLD || 0} · 입고완료율 <b>${pctText(p.status.RECEIVED || 0, p.count)}</b>${p.amount ? ` · 예상 금액 ${fmt(p.amount)}원` : ''}</p>
            ${table(['거점', '품목', '수량', '단위', '공급처', '상태', '금액(원)'], p.rows.slice(0, 15).map(r => [esc(r.site), esc(r.name), fmt(r.qty), esc(r.unit), esc([...r.suppliers].join(', ')), esc([...r.statuses].join('·')), r.amount ? fmt(r.amount) : '-']), { widths: [12, 0, 18, 12, 30, 20, 22], cls: ['c', '', 'r', 'c', '', 'c', 'r'], empty: `${R(D)} 구매계획 없음` })}${more(p.rows.length, 15)}</div>`);
    }
    if (on('work')) {
        sec.push(`<div class="block">${h2(`${R(D)} 업무추진 현황`)}${D.tasks.length ? `<p class="lead">추진과제 ${D.taskSum.total}건 · 완료 ${D.taskSum.count.DONE} · 진행 ${D.taskSum.count.WORK} · 지연 ${D.taskSum.count.DELAY} · 평균 진행률 <b>${D.taskSum.avg.toFixed(0)}%</b></p>
            ${D.work.goal ? `<h3>${R(D)} 중점 목표</h3>${note(D.work.goal)}` : ''}
            ${table(['구분', '추진과제', '담당', '일정', '진행률', '상태', '추진실적'], D.tasks.map(t => [esc(t.category || ''), `<b>${esc(t.title)}</b>${t.detail ? `<br><span class="small">${esc(t.detail)}</span>` : ''}`, esc([t.dept, t.owner].filter(Boolean).join(' ')), `${esc((t.start || '').slice(5))}${t.end ? `~${esc(t.end.slice(5))}` : ''}`, `${Math.min(100, Math.max(0, Number(t.progress) || 0))}%`, WORK_STATUS[effectiveStatus(t)], esc(t.result || '')]), { widths: [16, 0, 24, 22, 14, 12, 40], cls: ['c', '', 'c', 'c', 'r', 'c', ''] })}
            ${D.work.review ? `<h3>실적 검토 · 이슈</h3>${note(D.work.review)}` : ''}` : `<p class="small">${R(D)} 업무추진계획서가 없습니다.</p>`}</div>`);
    }
    // 첨부 보고서: 검토 보고서 본문을 새 쪽에 그대로 (제목 h1은 절 제목으로 바꿔 씀)
    if (on('docs')) D.docs.forEach(doc => sec.push(`<div class="docatt">${h2(doc.title)}<div class="dbody">${String(doc.content?.html || '').replace(/<h1[\s\S]*?<\/h1>/, '')}</div></div>`));
    if (on('next')) {
        const pn = D.planNext, qn = D.purchNext;
        const wt = (D.workNext.tasks || []).filter(t => t.title);
        sec.push(`<div class="block">${h2(`${P(D)} 계획 (이달)`)}
            <h3>생산계획 · 완제품 ${fmt(D.planNextKpi.prod)}${D.planNextKpi.oil ? ` · 원액 ${fmt(D.planNextKpi.oil)} L` : ''}</h3>
            ${table(['거점', '구분', '품목', '계획', '단위', '거래처'], pn.slice(0, 15).map(r => [esc(r.site), esc(r.type), esc(r.name), fmt(r.qty), esc(r.unit), esc([...r.partners].join(', '))]), { widths: [12, 14, 0, 22, 12, 40], cls: ['c', 'c', '', 'r', 'c', ''], empty: `${P(D)} 생산계획 없음 (생산관리 → 생산계획에서 입력)` })}${more(pn.length, 15)}
            <h3>구매계획 · ${qn.count}건${qn.amount ? ` · 예상 ${fmt(qn.amount)}원` : ''}</h3>
            ${table(['거점', '품목', '수량', '단위', '공급처', '입고예정'], qn.rows.slice(0, 12).map(r => [esc(r.site), esc(r.name), fmt(r.qty), esc(r.unit), esc([...r.suppliers].join(', ')), esc(r.eta || '')]), { widths: [12, 0, 20, 12, 36, 22], cls: ['c', '', 'r', 'c', '', 'c'], empty: `${P(D)} 구매계획 없음` })}${more(qn.rows.length, 12)}
            ${wt.length ? `<h3>업무추진 계획 · ${wt.length}건</h3>${table(['구분', '추진과제', '담당', '일정', '목표·성과지표'], wt.map(t => [esc(t.category || ''), `<b>${esc(t.title)}</b>${t.detail ? `<br><span class="small">${esc(t.detail)}</span>` : ''}`, esc([t.dept, t.owner].filter(Boolean).join(' ')), `${esc((t.start || '').slice(5))}${t.end ? `~${esc(t.end.slice(5))}` : ''}`, esc(t.target || '')]), { widths: [16, 0, 26, 24, 40], cls: ['c', '', 'c', 'c', ''] })}` : ''}
            ${D.form.nextFocus ? `<h3>${P(D)} 중점 추진사항</h3>${note(D.form.nextFocus)}` : ''}</div>`);
    }
    if (on('issue') && D.form.issues) sec.push(`<div class="block">${h2('이슈 · 건의사항')}${note(D.form.issues)}</div>`);

    const base = new URL(import.meta.env.BASE_URL, window.location.href).href;
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><base href="${esc(base)}"><title>${esc(title(D))} 보고서</title>
    <style>
        @page { size: A4 portrait; margin: 12mm 12mm 14mm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif; color: #111; font-size: 9.5pt; line-height: 1.45; }
        .page { width: 186mm; margin: 0 auto; }
        .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #1e3a8a; padding-bottom: 3mm; margin-bottom: 4mm; }
        .head h1 { margin: 0; font-size: 16pt; color: #1e3a8a; letter-spacing: 0.5px; }
        .head .sub { font-size: 9pt; color: #444; margin-top: 1.5mm; }
        .logo { height: 9mm; margin-right: 3mm; vertical-align: middle; }
        h2 { font-size: 12.5pt; color: #1e3a8a; margin: 6mm 0 2mm; padding-left: 2.5mm; border-left: 1.4mm solid #1e3a8a; break-after: avoid; }
        h3 { font-size: 10pt; margin: 3mm 0 1.5mm; color: #1f2937; break-after: avoid; }
        .lead { margin: 0 0 2mm; } .small { font-size: 8pt; color: #666; margin: 1mm 0; }
        .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; }
        .kpi { border: 0.3mm solid #cbd5e1; border-radius: 2mm; padding: 2mm 2.5mm; background: #f8fafc; break-inside: avoid; }
        .kpi .k { font-size: 8pt; color: #475569; font-weight: 700; } .kpi .v { font-size: 13pt; font-weight: 800; margin-top: 0.5mm; } .kpi .s { font-size: 7.5pt; color: #64748b; }
        .block { break-inside: auto; } .two { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; align-items: start; }
        img.chart { width: 100%; border: 0.3mm solid #e2e8f0; border-radius: 2mm; break-inside: avoid; }
        table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 1mm; }
        table.grid th, table.grid td { border: 0.3mm solid #94a3b8; padding: 1mm 1.4mm; font-size: 8.2pt; word-break: break-all; vertical-align: middle; }
        table.grid th { background: #e8eef8; font-weight: 700; text-align: center; } table.grid tr { break-inside: avoid; }
        td.r { text-align: right; } td.c { text-align: center; }
        .notes { border: 0.3mm solid #94a3b8; border-radius: 1.5mm; padding: 2mm 2.5mm; white-space: pre-wrap; font-size: 9pt; background: #fbfdff; }
        .meta { display: flex; flex-wrap: wrap; gap: 1mm 6mm; font-size: 9pt; margin-bottom: 2mm; } .meta b { color: #333; }
        .foot { margin-top: 5mm; font-size: 7.5pt; color: #666; display: flex; justify-content: space-between; border-top: 0.3mm solid #cbd5e1; padding-top: 1.5mm; }
        /* 첨부 보고서 (보고서 메뉴의 검토 보고서 본문) */
        .docatt { break-before: page; }
        .dbody h2 { font-size: 11pt; color: #1e293b; margin: 5mm 0 1.5mm; padding-left: 2mm; border-left: 1mm solid #64748b; break-after: avoid; }
        .dbody h3 { font-size: 10pt; margin: 3mm 0 1mm; } .dbody p { margin: 1.2mm 0; } .dbody ul, .dbody ol { margin: 1.2mm 0; padding-left: 6mm; } .dbody li { margin: 0.6mm 0; }
        .dbody table { width: 100%; border-collapse: collapse; margin: 2mm 0; table-layout: fixed; }
        .dbody th, .dbody td { border: 0.3mm solid #94a3b8; padding: 1.2mm 1.8mm; font-size: 8.3pt; vertical-align: top; word-break: keep-all; overflow-wrap: anywhere; }
        .dbody th { background: #e8eef8; text-align: left; } .dbody tr { break-inside: avoid; }
        .dbody .byline { color: #64748b; font-size: 8.5pt; margin-bottom: 2mm; } .dbody .small { font-size: 8pt; color: #64748b; }
        .dbody .lead { font-size: 9.5pt; background: #eef2ff; border: 0.3mm solid #c7d2fe; border-radius: 2mm; padding: 2.5mm 3.5mm; margin: 0 0 2mm; }
        .dbody code { background: #f1f5f9; border-radius: 1mm; padding: 0 1mm; font-size: 8pt; }
        .dbody .flow { display: flex; gap: 3mm; align-items: stretch; margin: 3mm 0; } .dbody .flow .box { flex: 1; border: 0.35mm solid #94a3b8; border-radius: 2mm; padding: 2.5mm 3mm; font-size: 9pt; }
        .dbody .flow .box b { display: block; font-size: 10pt; margin-bottom: 1mm; } .dbody .flow .box.main { border: 0.6mm solid #2563eb; background: #eff6ff; } .dbody .flow .arrow { align-self: center; color: #64748b; font-weight: 700; }
        .dbody .phase { border: 0.35mm solid #94a3b8; border-radius: 2mm; padding: 2.5mm 3.5mm; margin: 2mm 0; break-inside: avoid; } .dbody .phase.main { border: 0.6mm solid #2563eb; background: #eff6ff; }
        .dbody .gate { color: #475569; font-size: 9pt; margin: 0 0 0 8mm; }
        @media screen { body { background: #cbd5e1; padding: 8mm 0; } .page { background: #fff; padding: 12mm; width: 210mm; box-shadow: 0 1px 6px rgba(0,0,0,.25); } }
    </style></head><body><div class="page">
        <div class="head">
            <div><h1><img class="logo" src="./logo.png" alt="" onerror="this.remove()" />${esc(P(D))} 월례회의 보고서</h1>
                <div class="sub">대림오일 ${esc(D.form.dept)} · MONTHLY MEETING REPORT · ${esc(D.siteLabel)}</div></div>
            ${approvalPrintHtml(['작성', '검토', '승인'], {})}
        </div>
        <div class="meta"><span><b>실적:</b> ${esc(R(D))} (전월)</span><span><b>계획:</b> ${esc(P(D))} (이달)</span><span><b>회의 일자:</b> ${esc(D.form.date)}</span><span><b>부서:</b> ${esc(D.form.dept)}</span><span><b>작성자:</b> ${esc(D.form.author)}</span></div>
        ${sec.join('')}
        <div class="foot"><span>대림오일 스마트 WMS · 월간 실적 현황판·생산계획·구매계획·업무추진계획 기준</span><span>출력 ${esc(new Date().toLocaleString('ko-KR'))}</span></div>
    </div><script>window.onload = function () { setTimeout(function () { window.print(); }, 500); };<\/script></body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
    return { blob: new Blob([html], { type: 'text/html' }), name: `${D.nym}_${D.form.dept}_월례회의_보고서.html`, type: 'html' };
};

// ---------- PPT (16:9, 편집 가능한 차트·표) ----------
const F = '맑은 고딕';
const NAVY = '1E3A8A';
const hex = (c) => String(c || '#475569').replace('#', '').toUpperCase();
export const exportMeetingPpt = async (D) => {
    const { default: PptxGenJS } = await import('pptxgenjs');
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in
    pptx.title = title(D);
    pptx.company = '대림오일';
    pptx.author = D.form.author || '';
    const footer = `대림오일 ${D.form.dept} · ${P(D)} 월례회의 (${R(D)} 실적 · ${P(D)} 계획)`;
    pptx.defineSlideMaster({
        title: 'BODY', background: { color: 'FFFFFF' },
        objects: [
            { rect: { x: 0, y: 0, w: 13.33, h: 0.95, fill: { color: NAVY } } },
            { rect: { x: 0, y: 0.95, w: 13.33, h: 0.05, fill: { color: 'F59E0B' } } },
            { text: { text: footer, options: { x: 0.45, y: 7.08, w: 8, h: 0.3, fontSize: 9, color: '64748B', fontFace: F } } }
        ],
        slideNumber: { x: 12.45, y: 7.08, w: 0.5, h: 0.3, fontSize: 9, color: '64748B', fontFace: F }
    });
    const on = (k) => D.form.sections.includes(k);
    const s = D.snap;
    const C = chartSets(D);
    const add = (heading, sub = '') => {
        const sl = pptx.addSlide({ masterName: 'BODY' });
        sl.addText(heading, { x: 0.45, y: 0.14, w: 9.8, h: 0.66, fontSize: 24, bold: true, color: 'FFFFFF', fontFace: F, valign: 'middle' });
        if (sub) sl.addText(sub, { x: 8.3, y: 0.14, w: 4.6, h: 0.66, fontSize: 11, color: 'DBEAFE', fontFace: F, align: 'right', valign: 'middle' });
        return sl;
    };
    const lead = (sl, text, y = 1.15) => sl.addText(text, { x: 0.45, y, w: 12.4, h: 0.45, fontSize: 13, color: '1F2937', fontFace: F, bold: true });
    const chartOpts = (x, y, w, h, extra = {}) => ({ x, y, w, h, showLegend: true, legendPos: 't', legendFontSize: 10, legendFontFace: F, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, catAxisLabelFontFace: F, valAxisLabelFontFace: F, valGridLine: { color: 'E2E8F0', size: 0.5 }, ...extra });
    const barChart = (sl, set, pos, { stacked = false } = {}) => {
        if (!set.labels.length) { sl.addText('자료 없음', { ...pos, fontSize: 12, color: '94A3B8', fontFace: F, align: 'center', valign: 'middle' }); return; }
        sl.addChart(pptx.ChartType.bar, set.series.map(x => ({ name: x.name, labels: set.labels, values: x.values })),
            chartOpts(pos.x, pos.y, pos.w, pos.h, { barDir: 'col', barGrouping: stacked ? 'stacked' : 'clustered', chartColors: set.series.map((x, i) => hex(x.color || PALETTE[i])), barGapWidthPct: 60 }));
    };
    const doughnut = (sl, set, pos) => {
        if (!set.labels.length) return;
        sl.addChart(pptx.ChartType.doughnut, [{ name: set.series[0].name, labels: set.labels, values: set.series[0].values }],
            { ...pos, holeSize: 55, showPercent: true, showLegend: true, legendPos: 'r', legendFontSize: 10, legendFontFace: F, dataLabelFontSize: 9, dataLabelColor: 'FFFFFF', chartColors: PALETTE.map(hex) });
    };
    const table = (sl, head, rows, pos, { colW, align = [], fontSize = 10.5, maxRows = 12 } = {}) => {
        const cut = rows.slice(0, maxRows);
        const body = [head.map(h => ({ text: h, options: { bold: true, fill: { color: 'E8EEF8' }, color: '1E293B', align: 'center' } })),
            ...(cut.length ? cut.map(r => r.map((c, i) => ({ text: String(c ?? ''), options: { align: align[i] || 'left' } }))) : [[{ text: '자료 없음', options: { colspan: head.length, align: 'center', color: '94A3B8' } }]])];
        sl.addTable(body, { ...pos, colW, fontSize, fontFace: F, color: '1F2937', border: { type: 'solid', pt: 0.5, color: 'CBD5E1' }, fill: { color: 'FFFFFF' }, valign: 'middle', rowH: 0.3, autoPage: false });
        if (rows.length > maxRows) sl.addText(`외 ${rows.length - maxRows}건`, { x: pos.x, y: 6.75, w: 4, h: 0.3, fontSize: 9, color: '64748B', fontFace: F });
    };

    // 1. 표지
    const cover = pptx.addSlide();
    cover.background = { color: NAVY };
    cover.addShape(pptx.ShapeType.rect, { x: 0, y: 5.2, w: 13.33, h: 0.08, fill: { color: 'F59E0B' }, line: { color: 'F59E0B' } });
    cover.addText('대림오일', { x: 0.8, y: 1.5, w: 11, h: 0.5, fontSize: 18, color: 'BFDBFE', fontFace: F, bold: true });
    cover.addText(`${P(D)} 월례회의`, { x: 0.8, y: 2.1, w: 11.5, h: 1.1, fontSize: 44, color: 'FFFFFF', fontFace: F, bold: true });
    cover.addText(`${D.form.dept} · ${R(D)} 실적 및 ${P(D)} 계획 보고`, { x: 0.8, y: 3.25, w: 11.5, h: 0.6, fontSize: 22, color: 'E0E7FF', fontFace: F });
    cover.addText(`회의 일자 ${D.form.date}   ·   보고 ${D.form.author || ''}   ·   ${D.siteLabel}`, { x: 0.8, y: 5.45, w: 11.5, h: 0.5, fontSize: 14, color: 'E0E7FF', fontFace: F });

    // 2. 목차
    const monthName = (l) => l.replace('전월', R(D)).replace('이달', P(D));
    const agenda = [`핵심 요약 (${R(D)} 실적)`, ...MEETING_SECTIONS.filter(([k]) => on(k) && (k !== 'issue' || D.form.issues) && (k !== 'docs' || D.docs.length))
        .flatMap(([k, l]) => k === 'docs' ? D.docs.map(d => `[첨부] ${d.title}`) : [monthName(l)])];
    const ag = add('목차');
    ag.addText(agenda.map((a, i) => ({ text: `${String(i + 1).padStart(2, '0')}   ${a}`, options: { breakLine: true } })), { x: 1.2, y: 1.4, w: 10.5, h: 5.4, fontSize: agenda.length > 8 ? 16 : 20, color: '1E293B', fontFace: F, paraSpaceAfter: agenda.length > 8 ? 6 : 10, valign: 'top' });

    // 3. 핵심 요약 (KPI 카드 8칸)
    const sm = add(`핵심 요약 · ${R(D)} 실적`, D.siteLabel);
    kpiList(D).forEach(([k, v, sub], i) => {
        const x = 0.45 + (i % 4) * 3.12, y = 1.35 + Math.floor(i / 4) * 2.7;
        sm.addShape(pptx.ShapeType.roundRect, { x, y, w: 2.95, h: 2.45, fill: { color: 'F8FAFC' }, line: { color: 'CBD5E1', width: 1 }, rectRadius: 0.12 });
        sm.addText(k, { x: x + 0.2, y: y + 0.15, w: 2.6, h: 0.4, fontSize: 13, color: '475569', bold: true, fontFace: F });
        sm.addText(v, { x: x + 0.2, y: y + 0.65, w: 2.6, h: 0.8, fontSize: 24, color: NAVY, bold: true, fontFace: F });
        sm.addText(sub, { x: x + 0.2, y: y + 1.5, w: 2.6, h: 0.8, fontSize: 10.5, color: '64748B', fontFace: F, valign: 'top' });
    });

    if (on('prod')) {
        const a = add(`${R(D)} 생산 실적 · 완제품 포장`, `${fmt(s.t.pack)} EA · 작업일 ${s.workDays}일`);
        lead(a, `완제품 포장 ${fmt(s.t.pack)} EA (${fmt(s.t.packBox)}박스) · 포장 공수 ${fmt(s.t.mhPack, 1)} · 생산성 ${fmt(s.packProd)} EA/공수${s.view === 'ALL' ? ` · 본사 ${fmt(s.bySite.HQ.pack)} / 김포 ${fmt(s.bySite.GIMPO.pack)}` : ''}`);
        barChart(a, C.pack, { x: 0.45, y: 1.7, w: 8.2, h: 5.2 }, { stacked: true });
        doughnut(a, C.category, { x: 8.8, y: 1.7, w: 4.1, h: 5.2 });
        const b = add(`${R(D)} 생산 실적 · 포장 TOP 10 품목`);
        table(b, ['#', '품목', '카테고리', ...(s.view === 'ALL' ? ['본사', '김포'] : []), '합계(EA)', '박스', '공수'],
            s.products.slice(0, 10).map((p, i) => [i + 1, p.item, p.category, ...(s.view === 'ALL' ? [p.HQ ? fmt(p.HQ) : '', p.GIMPO ? fmt(p.GIMPO) : ''] : []), fmt(p.qty), fmt(p.box), fmt(p.manHours, 1)]),
            { x: 0.45, y: 1.3, w: 12.4 }, { colW: s.view === 'ALL' ? [0.5, 4.9, 1.6, 1.2, 1.2, 1.3, 0.9, 0.8] : [0.5, 6.2, 2, 1.6, 1.1, 1.0], align: ['center', 'left', 'center', 'right', 'right', 'right', 'right', 'right'], maxRows: 10 });
    }
    if (on('oil')) {
        const a = add(`${R(D)} 원액 생산 · 작업공수`, `원액 ${fmt(s.t.oil)} L · 공수 ${fmt(s.t.manHours, 1)}`);
        lead(a, `원액 ${fmt(s.t.oil)} L · ${s.t.oilBatches}배치 · 원액 공수 ${fmt(s.t.mhOil, 1)} (${fmt(s.oilProd)} L/공수) · 전체 공수 ${fmt(s.t.manHours, 1)}`);
        barChart(a, C.oil, { x: 0.45, y: 1.7, w: 6.4, h: 2.7 }, { stacked: true });
        doughnut(a, C.manhours, { x: 7.1, y: 1.7, w: 5.8, h: 2.7 });
        table(a, ['원액', '생산(L)', '배치', '공수'], s.oils.map(o => [o.item, fmt(o.qty), o.batches, fmt(o.manHours, 2)]), { x: 0.45, y: 4.55, w: 6.4 }, { colW: [3.4, 1.2, 0.8, 1.0], align: ['left', 'right', 'right', 'right'], maxRows: 6, fontSize: 9.5 });
        table(a, ['기타업무 종류', '건수', '공수'], s.taskGroups.map(g => [g.type, g.count, fmt(g.manHours, 2)]), { x: 7.1, y: 4.55, w: 5.8 }, { colW: [3.6, 1.0, 1.2], align: ['left', 'right', 'right'], maxRows: 6, fontSize: 9.5 });
    }
    if (on('raw')) {
        const r = D.raw;
        const a = add(`${R(D)} 원료입고 실적`, `${fmt(r.total.qty)} L · ${r.total.count}건`);
        lead(a, `원료 입고 ${fmt(r.total.qty)} L (${fmt(r.total.kg)} kg) · 원료 ${r.byItem.length}품목 · 사용 ${fmt(r.total.useQty)} L · 전월 대비 ${deltaText(r.total.qty, D.rawPrev.total.qty)}`);
        barChart(a, C.raw, { x: 0.45, y: 1.7, w: 6.2, h: 5.1 }, { stacked: true });
        table(a, ['원료', '입고(L)', '건수', '공급처'], r.byItem.map(g => [g.name, fmt(g.qty), g.count, [...g.suppliers].join(', ')]), { x: 6.85, y: 1.7, w: 6.05 }, { colW: [2.3, 1.2, 0.65, 1.9], align: ['left', 'right', 'right', 'left'], maxRows: 14, fontSize: 9.5 });
    }
    if (on('plan')) {
        const a = add(`${ymLabel(D.ym)} 생산계획 대비 실적`, D.planKpi.prodPlan ? `달성률 ${pctText(D.planKpi.prodDone, D.planKpi.prodPlan)}` : '');
        lead(a, `완제품 계획 ${fmt(D.planKpi.prodPlan)} · 실적 ${fmt(D.planKpi.prodDone)} · 달성률 ${D.planKpi.prodPlan ? pctText(D.planKpi.prodDone, D.planKpi.prodPlan) : '-'}${D.planKpi.oilPlan ? ` · 원액 계획 ${fmt(D.planKpi.oilPlan)} L / 실적 ${fmt(D.planKpi.oilDone)} L` : ''}`);
        barChart(a, C.planVs, { x: 0.45, y: 1.7, w: 6.2, h: 5.0 });
        table(a, ['거점', '구분', '품목', '계획', '실적', '달성'], D.plan.map(r => [r.site, r.type, r.name, fmt(r.qty), `${fmt(r.done)}${r.src === '업무일지' ? '*' : ''}`, pctText(r.done, r.qty)]), { x: 6.85, y: 1.7, w: 6.05 }, { colW: [0.6, 0.7, 2.3, 0.85, 0.85, 0.75], align: ['center', 'center', 'left', 'right', 'right', 'right'], maxRows: 14, fontSize: 9.5 });
        a.addText('실적 = 생산계획에 적은 실적 수량, * 표시는 적지 않아 업무일지의 포장·원액 생산 실적(첫 계획일부터)으로 채운 값', { x: 0.45, y: 6.72, w: 12.4, h: 0.3, fontSize: 9, color: '64748B', fontFace: F });
    }
    if (on('purch')) {
        const p = D.purch;
        const a = add(`${ymLabel(D.ym)} 구매계획 이행`, `입고완료율 ${pctText(p.status.RECEIVED || 0, p.count)}`);
        lead(a, `구매 ${p.count}건 · 입고완료 ${p.status.RECEIVED || 0} · 발주 ${p.status.ORDER || 0} · 계획 ${p.status.PLAN || 0} · 보류 ${p.status.HOLD || 0}${p.amount ? ` · 예상 금액 ${fmt(p.amount)}원` : ''}`);
        table(a, ['거점', '품목', '수량', '단위', '공급처', '상태', '금액(원)'], p.rows.map(r => [r.site, r.name, fmt(r.qty), r.unit, [...r.suppliers].join(', '), [...r.statuses].join('·'), r.amount ? fmt(r.amount) : '-']),
            { x: 0.45, y: 1.7, w: 12.4 }, { colW: [0.9, 4.2, 1.2, 0.8, 2.4, 1.4, 1.5], align: ['center', 'left', 'right', 'center', 'left', 'center', 'right'], maxRows: 15 });
    }
    if (on('work')) {
        const a = add(`${R(D)} 업무추진 현황`, D.tasks.length ? `평균 진행률 ${D.taskSum.avg.toFixed(0)}%` : '');
        if (D.tasks.length) {
            lead(a, `추진과제 ${D.taskSum.total}건 · 완료 ${D.taskSum.count.DONE} · 진행 ${D.taskSum.count.WORK} · 지연 ${D.taskSum.count.DELAY}${D.work.goal ? ` · 중점 목표: ${D.work.goal.split('\n')[0]}` : ''}`);
            table(a, ['구분', '추진과제', '담당', '일정', '진행률', '상태', '추진실적'], D.tasks.map(t => [t.category || '', t.title, [t.dept, t.owner].filter(Boolean).join(' '), `${(t.start || '').slice(5)}${t.end ? `~${t.end.slice(5)}` : ''}`, `${Math.min(100, Math.max(0, Number(t.progress) || 0))}%`, WORK_STATUS[effectiveStatus(t)], t.result || '']),
                { x: 0.45, y: 1.7, w: 12.4 }, { colW: [1.1, 3.6, 1.8, 1.4, 0.9, 0.8, 2.8], align: ['center', 'left', 'center', 'center', 'right', 'center', 'left'], maxRows: 9 });
            if (D.work.review) a.addText([{ text: '실적 검토 · 이슈\n', options: { bold: true, color: '92400E' } }, { text: D.work.review }], { x: 0.45, y: 5.35, w: 12.4, h: 1.55, fontSize: 11, color: '1F2937', fontFace: F, fill: { color: 'FFFBEB' }, line: { color: 'FCD34D', width: 1 }, valign: 'top', margin: 8 });
        } else lead(a, `${R(D)} 업무추진계획서가 없습니다. (생산관리 → 업무추진계획)`);
    }
    if (on('docs')) D.docs.forEach(doc => addDocSlides(pptx, add, doc));
    if (on('next')) {
        const a = add(`${P(D)} 계획 (이달)`, `완제품 ${fmt(D.planNextKpi.prod)}${D.planNextKpi.oil ? ` · 원액 ${fmt(D.planNextKpi.oil)} L` : ''}`);
        a.addText('생산계획', { x: 0.45, y: 1.15, w: 6, h: 0.4, fontSize: 14, bold: true, color: NAVY, fontFace: F });
        table(a, ['거점', '구분', '품목', '계획', '단위'], D.planNext.map(r => [r.site, r.type, r.name, fmt(r.qty), r.unit]), { x: 0.45, y: 1.6, w: 6.2 }, { colW: [0.7, 0.8, 3.0, 1.1, 0.6], align: ['center', 'center', 'left', 'right', 'center'], maxRows: 10, fontSize: 9.5 });
        a.addText(`구매계획 · ${D.purchNext.count}건`, { x: 6.85, y: 1.15, w: 6, h: 0.4, fontSize: 14, bold: true, color: NAVY, fontFace: F });
        table(a, ['품목', '수량', '단위', '공급처'], D.purchNext.rows.map(r => [r.name, fmt(r.qty), r.unit, [...r.suppliers].join(', ')]), { x: 6.85, y: 1.6, w: 6.05 }, { colW: [2.8, 1.1, 0.65, 1.5], align: ['left', 'right', 'center', 'left'], maxRows: 10, fontSize: 9.5 });
        const wt = (D.workNext.tasks || []).filter(t => t.title);
        if (wt.length) {
            const w = add(`${P(D)} 업무추진 계획`, `${wt.length}건`);
            if (D.workNext.goal) lead(w, `중점 목표: ${D.workNext.goal.split('\n')[0]}`);
            table(w, ['구분', '추진과제', '세부 추진내용', '담당', '일정', '목표·성과지표'], wt.map(t => [t.category || '', t.title, t.detail || '', [t.dept, t.owner].filter(Boolean).join(' '), `${(t.start || '').slice(5)}${t.end ? `~${t.end.slice(5)}` : ''}`, t.target || '']),
                { x: 0.45, y: 1.7, w: 12.4 }, { colW: [1.1, 3.0, 3.2, 1.8, 1.3, 2.0], align: ['center', 'left', 'left', 'center', 'center', 'left'], maxRows: 12 });
        }
        if (D.form.nextFocus) {
            const f = add(`${P(D)} 중점 추진사항`);
            f.addText(D.form.nextFocus, { x: 0.8, y: 1.4, w: 11.7, h: 5.3, fontSize: 18, color: '1E293B', fontFace: F, valign: 'top', paraSpaceAfter: 8 });
        }
    }
    if (on('issue') && D.form.issues) {
        const a = add('이슈 · 건의사항');
        a.addText(D.form.issues, { x: 0.8, y: 1.4, w: 11.7, h: 5.3, fontSize: 18, color: '1E293B', fontFace: F, valign: 'top', paraSpaceAfter: 8 });
    }
    // 파일로 받아 내려받기 + 보고서 메뉴 저장에 같이 쓴다
    const blob = await pptx.write({ outputType: 'blob' });
    const name = `${D.nym}_${D.form.dept}_월례회의.pptx`;
    downloadBlob(blob, name);
    return { blob, name, type: 'pptx' };
};
// ---------- 첨부 보고서(DOC html) → PPT 슬라이드 ----------
// h2마다 한 장(넘치면 '(계속)' 장), 표·목록·문단·카드(.grid2)·흐름(.flow)·단계(.phase)·일정표(.gantt)를 PPT 개체로 옮긴다
const TOP = 1.2, BOTTOM = 6.95, LEFT = 0.45, WIDTH = 12.4;
const GANTT_COLOR = { done: '22C55E', work: '3B82F6', plan: '94A3B8' };
const MS_COLOR = { done: '16A34A', work: '2563EB', plan: '64748B' };
// 글자 줄 수 어림 (한글 1자 ≈ 글자 크기, 영문·숫자 ≈ 0.55)
const textLines = (text, widthIn, pt) => String(text || '').split('\n').reduce((n, line) => {
    let w = 0;
    for (const ch of line) w += /[ㄱ-힝]/.test(ch) ? 1 : 0.55;
    return n + Math.max(1, Math.ceil((w * pt) / (widthIn * 72 * 0.94)));
}, 0);
const lineH = (pt) => (pt * 1.32) / 72;
// 요소 안 글자를 PPT 글자 조각으로 (굵게·<br> 줄바꿈 유지)
const runsOf = (node, base = {}) => {
    const out = [];
    const brk = () => { if (out.length) out[out.length - 1].options.breakLine = true; };
    const walk = (n, bold, depth) => {
        if (n.nodeType === 3) {
            const t = n.textContent.replace(/\s+/g, ' ');
            const prev = out[out.length - 1];
            if (t.trim() || (t && prev && !prev.options.breakLine)) out.push({ text: !prev || prev.options.breakLine ? t.replace(/^\s+/, '') : t, options: { ...base, ...(bold ? { bold: true } : {}) } });
            return;
        }
        if (n.nodeType !== 1) return;
        if (n.tagName === 'BR') { if (out.length) brk(); else out.push({ text: '', options: { ...base, breakLine: true } }); return; }
        // 안쪽 블록(문단·목록 줄·제목)은 줄을 바꾸고, 목록 줄은 • 를 붙인다
        const block = depth > 0 && /^(P|DIV|LI|H3|H4|H5|UL|OL|TABLE|TR)$/.test(n.tagName);
        if (block) brk();
        if (depth > 0 && n.tagName === 'LI') out.push({ text: '• ', options: { ...base } });
        const b = bold || /^(B|STRONG|TH|H3|H4|H5)$/.test(n.tagName);
        n.childNodes.forEach(c => walk(c, b, depth + 1));
        if (block) brk();
    };
    walk(node, !!base.bold, 0);
    while (out.length && !out[out.length - 1].text.trim()) out.pop();
    if (out.length) { out[0].text = out[0].text.replace(/^\s+/, ''); out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, ''); delete out[out.length - 1].options.breakLine; }
    return out;
};
const plainOf = (node) => runsOf(node).map(r => r.text + (r.options.breakLine ? '\n' : '')).join('');
const BLOCK_TAGS = /^(TABLE|UL|OL|P|H2|H3|H4|DIV|SECTION|BLOCKQUOTE)$/;

const addDocSlides = (pptx, add, doc) => {
    const dom = new DOMParser().parseFromString(`<div id="doc-root">${doc.content?.html || ''}</div>`, 'text/html');
    let root = dom.getElementById('doc-root');
    root.querySelectorAll('style, script, h1, .byline, .legend').forEach(n => n.remove());
    // 본문이 감싼 div 하나에 들어 있으면 그 안을 본다
    while (root.children.length === 1 && root.firstElementChild.tagName === 'DIV' && root.firstElementChild.querySelector('h2')) root = root.firstElementChild;
    const secs = [];
    let cur = { title: '', nodes: [] };
    [...root.childNodes].forEach(n => {
        if (n.nodeType === 3) { if (n.textContent.trim()) { const p = dom.createElement('p'); p.textContent = n.textContent.trim(); cur.nodes.push(p); } return; }
        if (n.nodeType !== 1) return;
        if (n.tagName === 'H2') { if (cur.title || cur.nodes.length) secs.push(cur); cur = { title: n.textContent.trim(), nodes: [] }; } else cur.nodes.push(n);
    });
    if (cur.title || cur.nodes.length) secs.push(cur);

    // 보고서 표지 한 장: 제목·요약 + 첫 h2 앞의 머리글(요약 상자 등), 없으면 목차
    const pre = secs[0] && !secs[0].title ? secs.shift() : null;
    const cv = add(doc.title || '첨부 보고서', '첨부 보고서');
    cv.addText(doc.title || '', { x: LEFT, y: 1.45, w: WIDTH, h: 0.8, fontSize: 30, bold: true, color: NAVY, fontFace: F });
    if (doc.summary) cv.addText(doc.summary, { x: LEFT, y: 2.25, w: WIDTH, h: 0.5, fontSize: 15, color: '475569', fontFace: F, valign: 'top' });
    const toc = secs.map(s => s.title).filter(Boolean);
    if (!pre && toc.length) cv.addText(toc.map(t => ({ text: t, options: { bullet: true, breakLine: true } })), { x: LEFT, y: 3.1, w: WIDTH, h: 3.7, fontSize: 14, color: '334155', fontFace: F, valign: 'top', paraSpaceAfter: 4 });

    const short = (doc.title || '').length > 22 ? `${doc.title.slice(0, 21)}…` : (doc.title || '');
    const renderSec = (sec, sl0 = null, y0 = TOP) => {
        let sl = sl0, y = y0, page = sl0 ? 1 : 0;
        const heading = sec.title || doc.title || '첨부 보고서';
        const newSlide = () => { sl = add(page ? `${heading} (계속)` : heading, short); y = TOP; page++; };
        // h 높이가 남은 칸에 안 들어가면 새 장 (빈 장이면 그대로)
        const room = (h) => { if (!sl) newSlide(); else if (y + h > BOTTOM && y > TOP + 0.01) newSlide(); };

        const addText = (node, { fontSize = 12, box = null, color = '1F2937', keep = 0 } = {}) => {
            const txt = plainOf(node);
            if (!txt.trim()) return;
            const pad = box ? 0.2 : 0;
            const h = textLines(txt, WIDTH - pad * 2, fontSize) * lineH(fontSize) + 0.12 + pad;
            room(Math.min(h + keep, BOTTOM - TOP)); // keep: 소제목은 아래 내용 조금과 같은 장에
            sl.addText(runsOf(node), { x: LEFT, y, w: WIDTH, h: Math.min(h, BOTTOM - y), fontSize, color, fontFace: F, valign: 'top', margin: box ? 6 : 2, ...(box ? { fill: { color: box.fill }, line: { color: box.line, width: 1 } } : {}) });
            y += h + 0.1;
        };
        const addList = (node) => {
            const items = [...node.children].filter(li => li.tagName === 'LI');
            const fontSize = 12;
            items.forEach((li, i) => {
                const txt = plainOf(li);
                const h = textLines(txt, WIDTH - 0.4, fontSize) * lineH(fontSize) + 0.06;
                room(h);
                const runs = runsOf(li);
                if (!runs.length) return;
                // 글머리표는 첫 조각에만 (조각마다 달면 조각마다 새 문단이 된다)
                runs[0].options.bullet = node.tagName === 'OL' ? { type: 'number', startAt: i + 1 } : true;
                sl.addText(runs, { x: LEFT, y, w: WIDTH, h, fontSize, color: '1F2937', fontFace: F, valign: 'top', margin: 2 });
                y += h + 0.02;
            });
            y += 0.08;
        };
        const addTable = (node) => {
            const trs = [...node.querySelectorAll('tr')];
            if (!trs.length) return;
            // 열 너비: colgroup의 mm/% 너비 비율, 없으면 첫 줄 칸 수로 나눔
            const cols = [...node.querySelectorAll('colgroup col')].map(c => parseFloat(c.style.width) || 0);
            const nCol = Math.max(...trs.map(tr => [...tr.children].reduce((n, c) => n + (Number(c.getAttribute('colspan')) || 1), 0)));
            let colW;
            if (cols.length === nCol && cols.some(Boolean)) {
                const known = cols.filter(Boolean).reduce((a, b) => a + b, 0);
                const unknown = cols.filter(v => !v).length;
                // 너비 없는 열은 남은 폭을 나눠 가진다 (mm 기준 A4 본문 186mm)
                const rest = Math.max(20, 186 - known);
                const raw = cols.map(v => v || rest / Math.max(1, unknown));
                const sum = raw.reduce((a, b) => a + b, 0);
                colW = raw.map(v => (v / sum) * WIDTH);
            } else colW = Array(nCol).fill(WIDTH / nCol);
            const fontSize = 10.5;
            const cellOf = (c) => {
                const head = c.tagName === 'TH';
                const win = c.classList.contains('win');
                const st = c.querySelector('.st');
                const stColor = st && (st.classList.contains('done') ? '166534' : st.classList.contains('work') ? '1E40AF' : '475569');
                return { text: plainOf(c), options: { ...(stColor ? { color: stColor, bold: true, align: 'center' } : {}), ...(head ? { bold: true, fill: { color: 'E8EEF8' }, color: '1E293B' } : {}), ...(win ? { fill: { color: 'DCFCE7' }, bold: true } : {}), ...(c.getAttribute('colspan') ? { colspan: Number(c.getAttribute('colspan')) } : {}), ...(c.getAttribute('rowspan') ? { rowspan: Number(c.getAttribute('rowspan')) } : {}) } };
            };
            const rows = trs.map(tr => {
                const cells = [...tr.children].filter(c => /^T[HD]$/.test(c.tagName)).map(cellOf);
                let ci = 0;
                const h = Math.max(...cells.map(c => { const span = c.options.colspan || 1; const w = colW.slice(ci, ci + span).reduce((a, b) => a + b, 0) || WIDTH / nCol; ci += span; return textLines(c.text, w - 0.12, fontSize) * lineH(fontSize) + 0.1; }));
                return { cells, h: Math.max(0.3, h), head: tr.children.length && [...tr.children].every(c => c.tagName === 'TH') };
            });
            const hasSpan = rows.some(r => r.cells.some(c => c.options.rowspan));
            const headRow = rows[0]?.head ? rows[0] : null;
            let i = headRow ? 1 : 0;
            const draw = (part) => {
                const body = [...(headRow ? [headRow] : []), ...part];
                const h = body.reduce((a, r) => a + r.h, 0);
                sl.addTable(body.map(r => r.cells), { x: LEFT, y, w: WIDTH, colW, fontSize, fontFace: F, color: '1F2937', border: { type: 'solid', pt: 0.5, color: 'CBD5E1' }, fill: { color: 'FFFFFF' }, valign: 'middle', rowH: body.map(r => r.h), autoPage: false, margin: 0.05 });
                y += h + 0.15;
            };
            if (hasSpan) { room(rows.reduce((a, r) => a + r.h, 0)); draw(rows.slice(i)); return; } // 합친 칸이 있으면 나누지 않는다
            while (i < rows.length) {
                const hh = headRow ? headRow.h : 0;
                room(hh + rows[i].h);
                const part = [];
                let used = hh;
                while (i < rows.length && (y + used + rows[i].h <= BOTTOM || !part.length)) { part.push(rows[i]); used += rows[i].h; i++; }
                draw(part);
            }
        };
        // 2칸 카드 (.grid2 > .card / .reason ...)
        const addCards = (node) => {
            const cards = [...node.children];
            const gap = 0.2, w = (WIDTH - gap) / 2, fontSize = 11;
            for (let k = 0; k < cards.length; k += 2) {
                const pair = cards.slice(k, k + 2);
                const h = Math.max(...pair.map(c => textLines(plainOf(c), w - 0.3, fontSize) * lineH(fontSize) + 0.3));
                room(h);
                pair.forEach((c, j) => sl.addText(runsOf(c), { x: LEFT + j * (w + gap), y, w, h, fontSize, color: '1F2937', fontFace: F, valign: 'top', margin: 6, fill: { color: 'F8FAFC' }, line: { color: 'CBD5E1', width: 1 } }));
                y += h + 0.12;
            }
        };
        // 가로 흐름 상자 (.flow > .box, .arrow)
        const addFlow = (node) => {
            const boxes = [...node.children].filter(c => c.classList.contains('box'));
            if (!boxes.length) return;
            const arrow = 0.4, w = (WIDTH - arrow * (boxes.length - 1)) / boxes.length, fontSize = 11;
            const h = Math.max(...boxes.map(b => textLines(plainOf(b), w - 0.3, fontSize) * lineH(fontSize) + 0.3));
            room(h);
            boxes.forEach((b, j) => {
                const x = LEFT + j * (w + arrow);
                const main = b.classList.contains('main');
                sl.addText(runsOf(b), { x, y, w, h, fontSize, color: '1F2937', fontFace: F, valign: 'top', margin: 6, fill: { color: main ? 'EFF6FF' : 'FFFFFF' }, line: { color: main ? '2563EB' : '94A3B8', width: main ? 2 : 1 } });
                if (j < boxes.length - 1) sl.addText('▶', { x: x + w, y, w: arrow, h, fontSize: 14, color: '64748B', align: 'center', valign: 'middle', fontFace: F });
            });
            y += h + 0.15;
        };
        // 일정표 (.gantt): 왼쪽 과제 이름 + 오른쪽 막대(style left/width %)
        const addGantt = (node) => {
            const labelW = 3.6, trackX = LEFT + labelW, trackW = WIDTH - labelW;
            const pct = (el, prop) => (parseFloat(el.style[prop]) || 0) / 100;
            const head = node.querySelector('.g-head');
            const rows = [...node.querySelectorAll('.g-row')];
            const rowH = 0.36;
            const drawHead = () => {
                if (!head) return;
                let x = trackX;
                [...head.querySelectorAll('.g-track span')].forEach(s => {
                    const w = pct(s, 'width') * trackW;
                    sl.addText(s.textContent.trim(), { x, y, w, h: 0.3, fontSize: 10, bold: true, color: '475569', align: 'center', valign: 'middle', fontFace: F, fill: { color: 'F1F5F9' }, line: { color: 'CBD5E1', width: 0.5 } });
                    x += w;
                });
                y += 0.34;
            };
            room((head ? 0.34 : 0) + rowH * Math.min(rows.length, 3));
            drawHead();
            const top0 = y;
            rows.forEach(r => {
                if (y + rowH > BOTTOM) { newSlide(); drawHead(); }
                sl.addShape(pptx.ShapeType.line, { x: LEFT, y, w: WIDTH, h: 0, line: { color: 'E2E8F0', width: 0.5, dashType: 'dash' } });
                const label = r.querySelector('.g-label');
                sl.addText(label ? label.textContent.trim() : '', { x: LEFT, y, w: labelW - 0.1, h: rowH, fontSize: 9.5, color: '1F2937', fontFace: F, valign: 'middle', fit: 'shrink', margin: 1 });
                r.querySelectorAll('.g-bar').forEach(b => {
                    const k = ['done', 'work', 'plan'].find(c => b.classList.contains(c)) || 'plan';
                    sl.addShape(pptx.ShapeType.roundRect, { x: trackX + pct(b, 'left') * trackW, y: y + 0.09, w: Math.max(0.05, pct(b, 'width') * trackW), h: rowH - 0.18, fill: { color: GANTT_COLOR[k] }, line: { color: GANTT_COLOR[k] }, rectRadius: 0.04 });
                });
                r.querySelectorAll('.g-ms').forEach(m => {
                    const k = ['done', 'work', 'plan'].find(c => m.classList.contains(c)) || 'plan';
                    const s = 0.2;
                    sl.addShape(pptx.ShapeType.diamond, { x: trackX + pct(m, 'left') * trackW - s / 2, y: y + (rowH - s) / 2, w: s, h: s, fill: { color: MS_COLOR[k] }, line: { color: MS_COLOR[k] } });
                });
                y += rowH;
            });
            // 오늘 선: 첫 줄의 .g-today 위치로 한 번만
            const today = node.querySelector('.g-today');
            if (today && y > top0) sl.addShape(pptx.ShapeType.line, { x: trackX + pct(today, 'left') * trackW, y: top0, w: 0, h: y - top0, line: { color: 'DC2626', width: 1.5, dashType: 'dash' } });
            // 범례
            if (y + 0.3 <= BOTTOM) {
                sl.addText([
                    { text: '■ ', options: { color: GANTT_COLOR.done } }, { text: '완료   ' },
                    { text: '■ ', options: { color: GANTT_COLOR.work } }, { text: '진행 중   ' },
                    { text: '■ ', options: { color: GANTT_COLOR.plan } }, { text: '예정   ' },
                    { text: '◆ ', options: { color: '475569' } }, { text: '주요 시점   ' },
                    ...(today ? [{ text: '┆ ', options: { color: 'DC2626', bold: true } }, { text: '오늘' }] : [])
                ], { x: LEFT, y: y + 0.03, w: WIDTH, h: 0.27, fontSize: 9.5, color: '475569', fontFace: F });
                y += 0.3;
            }
            y += 0.12;
        };
        const addNode = (n) => {
            const t = n.tagName, cl = n.classList;
            if (t === 'TABLE') return addTable(n);
            if (t === 'UL' || t === 'OL') return addList(n);
            if (cl.contains('gantt')) return addGantt(n);
            if (cl.contains('grid2')) return addCards(n);
            if (cl.contains('flow')) return addFlow(n);
            if (t === 'H3' || t === 'H4') return addText(n, { fontSize: 14, color: NAVY, keep: 1.2 });
            if (cl.contains('lead')) return addText(n, { fontSize: 13, box: { fill: 'EEF2FF', line: 'C7D2FE' } });
            if (cl.contains('phase')) return addText(n, { fontSize: 11.5, box: cl.contains('main') ? { fill: 'EFF6FF', line: '2563EB' } : { fill: 'FFFFFF', line: '94A3B8' } });
            if (cl.contains('small')) return addText(n, { fontSize: 10, color: '64748B' });
            // 다른 블록을 품은 div는 안쪽을 차례로
            if (t === 'DIV' && [...n.children].some(c => BLOCK_TAGS.test(c.tagName))) return [...n.children].forEach(addNode);
            return addText(n);
        };
        sec.nodes.forEach(addNode);
        if (!sl) newSlide();
    };
    if (pre) renderSec({ title: doc.title, nodes: pre.nodes }, cv, 3.0);
    secs.forEach(sec => renderSec(sec));
};
export const downloadBlob = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

// ---------- 대화창 ----------
// ctx = { ym: 처음 고를 달, view, months: 고를 수 있는 달(최근 순), snapFor(ym) → 그 달 생산실적 스냅숏 }
export const openMeetingDialog = (ctx, { showToast = () => {} } = {}) => {
    // ym = 회의 월(이달, 계획). 실적은 그 전월. ctx.months = 업무일지·수불부 자료가 있는 달 → 그 다음 달을 회의 월로 고를 수 있게
    let ym = ctx.ym && ctx.ym !== 'ALL' ? ctx.ym : localDateStr().slice(0, 7);
    const months = [...new Set([...(ctx.months || []).map(nextMonth), ym])].sort().reverse();
    const siteText = SITE_LABEL[ctx.view] || '전체 (본사·김포)';
    const canSaveReport = canPerformAction('MRP_PLANNING'); // 보고서 저장은 매니저 이상 (RLS 같은 규칙)
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}'); } catch { }
    const sections = Array.isArray(saved.sections) ? saved.sections : MEETING_SECTIONS.map(([k]) => k);
    if (Array.isArray(saved.sections) && !Array.isArray(saved.docIds)) sections.push('docs'); // 첨부 보고서 항목이 생기기 전에 저장한 설정
    document.getElementById('meeting-modal')?.remove();
    const el = document.createElement('div');
    el.id = 'meeting-modal';
    el.className = 'fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-3';
    el.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                <div><h3 class="text-base font-black text-slate-900 flex items-center gap-2"><i data-lucide="presentation" class="w-5 h-5 text-indigo-600"></i>월례회의 자료 만들기</h3>
                    <p class="text-[11px] text-slate-500 mt-0.5">${esc(siteText)} — 월간 실적 현황판 · 월간 생산계획 · 월간 구매계획 · 업무추진계획서 기준</p></div>
                <button type="button" class="mt-close text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
            </div>
            <div class="p-5 space-y-4 text-xs">
                <div class="flex flex-wrap items-end gap-3 p-3 rounded-xl bg-indigo-50 border border-indigo-200">
                    <label class="block"><span class="font-black text-indigo-800">회의 월 <span class="font-bold text-indigo-600">(실적 = 전월 · 계획 = 이달)</span></span>
                        <select id="mt-month" class="mt-1 block border border-indigo-300 rounded-lg px-2 py-1.5 font-black text-slate-900 min-w-[150px]">${months.map(m => `<option value="${m}" ${m === ym ? 'selected' : ''}>${esc(ymLabel(m))}</option>`).join('')}</select></label>
                    <div class="flex gap-1">
                        <button type="button" id="mt-prev" class="px-2.5 py-1.5 rounded-lg bg-white border border-indigo-200 font-black" title="이전 달">‹</button>
                        <button type="button" id="mt-next-m" class="px-2.5 py-1.5 rounded-lg bg-white border border-indigo-200 font-black" title="다음 달">›</button>
                    </div>
                    <p id="mt-sub" class="text-[11px] text-indigo-900 flex-1 min-w-[220px]"></p>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label class="block"><span class="font-bold text-slate-600">부서</span><input id="mt-dept" value="${esc(saved.dept || '생산공급망팀')}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                    <label class="block"><span class="font-bold text-slate-600">회의 일자</span><input id="mt-date" type="date" value="${esc(localDateStr())}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                    <label class="block"><span class="font-bold text-slate-600">보고자</span><input id="mt-author" value="${esc(saved.author || state.currentGlobalWorker || state.currentUser?.name || '')}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                </div>
                <div><div class="font-bold text-slate-600 mb-1">넣을 항목 <span class="font-normal text-slate-400">(핵심 요약은 항상 들어갑니다)</span></div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">${MEETING_SECTIONS.map(([k, l]) => `<label class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"><input type="checkbox" class="mt-sec accent-indigo-600" value="${k}" ${sections.includes(k) ? 'checked' : ''} />${esc(l)}</label>`).join('')}</div></div>
                <div id="mt-docs-wrap"><div class="font-bold text-slate-600 mb-1">첨부 보고서 <span class="font-normal text-slate-400">(보고서 메뉴의 검토·추진계획 보고서를 PPT·PDF 뒤쪽에 넣습니다)</span></div>
                    <div id="mt-docs" class="space-y-1 text-slate-400">불러오는 중...</div></div>
                <label class="block"><span id="mt-next-label" class="font-bold text-slate-600">이달 중점 추진사항</span>
                    <textarea id="mt-next" rows="3" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" placeholder="불러오는 중..."></textarea></label>
                <label class="block"><span class="font-bold text-slate-600">이슈 · 건의사항</span>
                    <textarea id="mt-issues" rows="4" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" placeholder="불러오는 중..."></textarea></label>
                <p class="text-[11px] text-slate-400">처음에는 업무추진계획서(전월 실적 검토·비고, 이달 중점 목표)와 이달 월간 생산계획 비고에서 채워 둡니다. 고쳐서 쓰세요.</p>
                <label class="flex items-center gap-2 px-3 py-2 rounded-lg border ${canSaveReport ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50 text-slate-400'}"><input type="checkbox" id="mt-save" class="accent-emerald-600" ${canSaveReport ? 'checked' : 'disabled'} />
                    <span><b>보고서 메뉴에 저장</b> — 만든 PPT·PDF 보고서를 <b>월간 실적 현황판 → 보고서</b>에 보관합니다 (같은 회의 월·보기로 다시 만들면 새 파일로 바뀜)${canSaveReport ? '' : ' · 저장은 매니저 이상'}</span></label>
            </div>
            <div class="flex flex-wrap justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
                <span id="mt-busy" class="hidden mr-auto self-center text-xs font-bold text-indigo-600">자료를 만드는 중...</span>
                <button type="button" class="mt-close px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold">닫기</button>
                <button type="button" id="mt-pdf" class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black flex items-center gap-1.5"><i data-lucide="file-text" class="w-4 h-4"></i>PDF 보고서</button>
                <button type="button" id="mt-ppt" class="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-black flex items-center gap-1.5"><i data-lucide="presentation" class="w-4 h-4"></i>PPT 내려받기</button>
            </div>
        </div>`;
    document.body.appendChild(el);
    createIcons({ icons });
    const $ = (s) => el.querySelector(s);
    const close = () => el.remove();
    el.querySelectorAll('.mt-close').forEach(b => b.addEventListener('click', close));
    el.addEventListener('click', (e) => { if (e.target === el) close(); });

    // 달 바꾸기: 기본 글(업무추진계획서·생산계획 비고)을 그 달 것으로 다시 채운다 (직접 고친 칸은 그대로)
    const edited = { next: false, issues: false };
    $('#mt-next').addEventListener('input', () => { edited.next = true; });
    $('#mt-issues').addEventListener('input', () => { edited.issues = true; });
    let loadSeq = 0;
    const setMonth = (m) => {
        ym = m;
        if (!months.includes(m)) { months.push(m); months.sort().reverse(); $('#mt-month').innerHTML = months.map(x => `<option value="${x}">${esc(ymLabel(x))}</option>`).join(''); }
        $('#mt-month').value = m;
        const rm = prevMonth(m); // 실적 달
        const s = ctx.snapFor(rm);
        $('#mt-sub').innerHTML = `실적 <b>${esc(ymLabel(rm))}</b>: 업무일지 ${s.workDays}일 · 포장 ${fmt(s.t.pack)} EA · 원액 ${fmt(s.t.oil)} L${s.workDays ? '' : ' <span class="text-rose-600 font-bold">(업무일지 없음)</span>'}<br>계획 <b>${esc(ymLabel(m))}</b>: 생산·구매계획, 업무추진계획`;
        $('#mt-next-label').textContent = `이달(${ymLabel(m)}) 중점 추진사항`;
        const seq = ++loadSeq;
        Promise.all([loadWorkPlan('WORK_MONTH', rm), loadWorkPlan('WORK_MONTH', m), getPlan('PROD_MONTH', m)]).then(([w, wn, pn]) => {
            if (seq !== loadSeq || !$('#mt-next')) return;
            $('#mt-next').placeholder = '예) 성수기 출하 대응, 충진기 설치·시운전';
            $('#mt-issues').placeholder = '예) 원료 납기 지연 우려, 인력 충원 요청';
            if (!edited.next) $('#mt-next').value = [wn.goal, pn?.goals, pn?.notes].filter(Boolean).join('\n');
            if (!edited.issues) $('#mt-issues').value = [w.review, w.notes].filter(Boolean).join('\n');
        }).catch(() => { });
    };
    $('#mt-month').addEventListener('change', (e) => setMonth(e.target.value));
    $('#mt-prev').addEventListener('click', () => setMonth(prevMonth(ym)));
    $('#mt-next-m').addEventListener('click', () => setMonth(nextMonth(ym)));
    setMonth(ym);

    // 첨부할 검토 보고서(DOC): 처음에는 제목에 '추진계획'이 있는 보고서를 골라 둔다
    let docsLoaded = false;
    listReports().then(list => {
        const docs = list.filter(r => r.kind === 'DOC');
        const box = $('#mt-docs');
        if (!box) return;
        docsLoaded = true;
        if (!docs.length) { box.textContent = '보고서 메뉴에 검토 보고서가 없습니다.'; return; }
        const pick = Array.isArray(saved.docIds) ? saved.docIds : docs.filter(r => /추진계획/.test(r.title || '')).map(r => r.id);
        box.className = 'grid grid-cols-1 gap-1.5';
        box.innerHTML = docs.map(r => `<label class="flex items-start gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"><input type="checkbox" class="mt-doc accent-indigo-600 mt-0.5" value="${esc(r.id)}" ${pick.includes(r.id) ? 'checked' : ''} /><span><b class="text-slate-800">${esc(r.title)}</b>${r.summary ? `<span class="block text-[11px] text-slate-500">${esc(r.summary)}</span>` : ''}</span></label>`).join('');
    }).catch(e => { const box = $('#mt-docs'); if (box) box.textContent = `보고서 목록을 불러오지 못했습니다: ${e.message}`; });

    const form = () => {
        const f = {
            dept: $('#mt-dept').value.trim() || '생산공급망팀', date: $('#mt-date').value || localDateStr(), author: $('#mt-author').value.trim(),
            sections: [...el.querySelectorAll('.mt-sec:checked')].map(c => c.value), nextFocus: $('#mt-next').value.trim(), issues: $('#mt-issues').value.trim(),
            docIds: docsLoaded ? [...el.querySelectorAll('.mt-doc:checked')].map(c => c.value) : (saved.docIds || [])
        };
        try { localStorage.setItem(OPTS_KEY, JSON.stringify({ dept: f.dept, author: f.author, sections: f.sections, ...(docsLoaded ? { docIds: f.docIds } : {}) })); } catch { }
        return f;
    };
    const run = async (fn, label, win = null) => {
        const busy = $('#mt-busy');
        busy.classList.remove('hidden');
        el.querySelectorAll('#mt-pdf, #mt-ppt').forEach(b => { b.disabled = true; });
        try {
            const D = await collectMeetingData(ctx.snapFor(prevMonth(ym)), form()); // 실적 = 전월, 계획 = 회의 월(D.nym)
            const file = await fn(D, ...(win ? [win] : []));
            let saved = '';
            if (file && $('#mt-save')?.checked) {
                try {
                    await saveReport({
                        id: `MEETING-${D.nym}-${ctx.view}`, kind: 'MEETING', title: `${ymLabel(D.nym)} ${D.form.dept} 월례회의`, period: D.nym, scope: D.siteLabel,
                        summary: `${ymLabel(D.ym)} 실적 · ${ymLabel(D.nym)} 계획`,
                        content: { resultYm: D.ym, planYm: D.nym, dept: D.form.dept, author: D.form.author, date: D.form.date, sections: D.form.sections, docIds: D.docs.map(d => d.id), view: ctx.view }
                    }, [file]);
                    saved = ' · 보고서 메뉴에 저장했습니다';
                } catch (e) { alert(`자료는 만들었지만 보고서 메뉴에 저장하지 못했습니다: ${e.message}`); }
            }
            showToast(`📑 월례회의 ${label}를 만들었습니다${saved}.`);
        } catch (e) {
            win?.close();
            console.error('[월례회의 자료]', e);
            alert(`월례회의 자료를 만들지 못했습니다: ${e.message}`);
        } finally {
            busy.classList.add('hidden');
            el.querySelectorAll('#mt-pdf, #mt-ppt').forEach(b => { b.disabled = false; });
        }
    };
    // PDF는 팝업 차단을 피하려고 클릭 직후 창을 먼저 연다 (exportMeetingPdf 안에서 window.open)
    $('#mt-pdf').addEventListener('click', () => {
        const w = window.open('', '_blank');
        if (!w) { alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
        w.document.write('<p style="font-family:sans-serif;padding:20px">월례회의 보고서를 만드는 중입니다...</p>');
        run(exportMeetingPdf, 'PDF 보고서', w);
    });
    $('#mt-ppt').addEventListener('click', () => run(exportMeetingPpt, 'PPT'));
};
