import Chart from 'chart.js/auto';
import { state } from '../../services/db.js';
import { esc } from '../../services/html.js';
import { createIcons, icons } from '../../services/icons.js';
import { localDateStr } from '../../services/searchUtils.js';
import { loadMonthLines, getPlan, PURCH_LINE_STATUS } from '../../services/plans.js';
import { loadWorkPlan, summarizeTasks, effectiveStatus, WORK_STATUS, nextMonth, prevMonth } from '../../services/workPlans.js';
import { applyChartTheme } from '../../services/darkTheme.js';
import { approvalPrintHtml } from '../approval/ApprovalBox.js';
import { computeRawInbound, REGION_COLORS } from './rawInbound.js';

// 월간 실적 현황판 → 월례회의 자료 (PPT · PDF 보고서)
// 재료: 현황판의 생산실적(업무일지 집계 스냅숏) + 원료입고 실적(원료수불부) + 업무추진계획서(이달·다음 달)
//       + 월간 생산계획·구매계획(주간 계획 취합: 이달 계획 대비 실적, 다음 달 계획)
// PPT: pptxgenjs로 편집 가능한 차트·표 슬라이드(16:9, 맑은 고딕). PDF: A4 세로 보고서를 새 창에 그려 인쇄 → 'PDF로 저장'.
// 두 양식 모두 같은 자료(collectMeetingData)를 쓴다.
const OPTS_KEY = 'daelim_meeting_opts';
const SITE_LABEL = { HQ: '본사', GIMPO: '김포' };
const SITE_COLOR = { HQ: '#2563eb', GIMPO: '#059669' };
export const MEETING_SECTIONS = [
    ['prod', '생산 실적 (포장·카테고리·TOP 10)'], ['oil', '원액 생산 · 작업공수'], ['raw', '원료입고 실적'],
    ['plan', '이달 생산계획 대비 실적'], ['purch', '이달 구매계획 이행'], ['work', '업무추진 현황'],
    ['next', '다음 달 생산·구매계획 · 중점 추진'], ['issue', '이슈 · 건의사항']
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
    return {
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
const title = (D) => `${ymLabel(D.ym)} ${D.form.dept} 월례회의`;

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
    sec.push(`${h2('핵심 요약')}<div class="kpis">${kpiList(D).map(([k, v, sub]) => `<div class="kpi"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(sub)}</div></div>`).join('')}</div>`);
    if (on('prod')) {
        sec.push(`<div class="block">${h2('생산 실적')}<p class="lead">완제품 포장 <b>${fmt(s.t.pack)} EA</b> (${fmt(s.t.packBox)}박스, 포장 공수 ${fmt(s.t.mhPack, 1)}) · 작업일 ${s.workDays}일${s.view === 'ALL' ? ` · 본사 ${fmt(s.bySite.HQ.pack)} / 김포 ${fmt(s.bySite.GIMPO.pack)} EA` : ''}</p>
            ${img.pack ? `<h3>일자별 완제품 포장 (EA)</h3><img class="chart" src="${img.pack}">` : '<p class="small">포장 실적 없음</p>'}</div>
            <div class="block two"><div>${img.category ? `<h3>카테고리별 포장</h3><img class="chart" src="${img.category}">` : ''}</div>
            <div><h3>포장 TOP 10 품목</h3>${table(['#', '품목', '포장(EA)', '박스'], s.products.slice(0, 10).map((p, i) => [i + 1, esc(p.item), fmt(p.qty), fmt(p.box)]), { widths: [7, 0, 20, 14], cls: ['c', '', 'r', 'r'] })}</div></div>`);
    }
    if (on('oil')) {
        sec.push(`<div class="block">${h2('원액 생산 · 작업공수')}<p class="lead">원액 <b>${fmt(s.t.oil)} L</b> · ${s.t.oilBatches}배치 · 원액 공수 ${fmt(s.t.mhOil, 1)} (${fmt(s.oilProd)} L/공수)</p>
            ${img.oil ? `<img class="chart" src="${img.oil}">` : ''}
            <div class="two"><div><h3>원액 품목별</h3>${table(['원액', '생산(L)', '배치', '공수'], s.oils.slice(0, 10).map(o => [esc(o.item), fmt(o.qty), o.batches, fmt(o.manHours, 2)]), { widths: [0, 22, 12, 14], cls: ['', 'r', 'r', 'r'] })}${more(s.oils.length, 10)}</div>
            <div><h3>작업공수 유형별</h3>${table(['유형', '공수', '비율'], [['제품포장', s.t.mhPack], ['원액생산', s.t.mhOil], ['라벨부착', s.t.mhLabel], ['기타업무', s.t.mhOther]].map(([k, v]) => [k, fmt(v, 1), pctText(v, s.t.manHours)]).concat([[`<b>합계</b>`, `<b>${fmt(s.t.manHours, 1)}</b>`, '100%']]), { widths: [0, 22, 18], cls: ['', 'r', 'r'] })}
            ${s.taskGroups.length ? `<h3>기타업무 종류별 (공수 상위)</h3>${table(['종류', '건수', '공수'], s.taskGroups.slice(0, 6).map(g => [esc(g.type), g.count, fmt(g.manHours, 2)]), { widths: [0, 14, 18], cls: ['', 'r', 'r'] })}` : ''}</div></div></div>`);
    }
    if (on('raw')) {
        const r = D.raw;
        sec.push(`<div class="block">${h2('원료입고 실적')}<p class="lead">원료 입고 <b>${fmt(r.total.qty)} L</b> (${fmt(r.total.kg)} kg) · ${r.total.count}건 · 원료 ${r.byItem.length}품목 · 같은 기간 사용 ${fmt(r.total.useQty)} L · 전월 대비 ${deltaText(r.total.qty, D.rawPrev.total.qty)}</p>
            ${img.raw ? `<img class="chart" src="${img.raw}">` : ''}
            ${table(['원료', '입고(L)', '중량(kg)', '건수', '공급처'], r.byItem.slice(0, 12).map(g => [esc(g.name), fmt(g.qty), g.kg ? fmt(g.kg) : '-', g.count, esc([...g.suppliers].join(', '))]), { widths: [0, 22, 22, 12, 50], cls: ['', 'r', 'r', 'r', ''] })}${more(r.byItem.length, 12)}
            <p class="small">원료수불부 매입 입고만 집계 (거점이동·재고조사·원액 생산 입고 제외)</p></div>`);
    }
    if (on('plan')) {
        const rows = D.plan;
        sec.push(`<div class="block">${h2(`${ymLabel(D.ym)} 생산계획 대비 실적`)}<p class="lead">완제품 계획 ${fmt(D.planKpi.prodPlan)} · 실적 ${fmt(D.planKpi.prodDone)} · 달성률 <b>${D.planKpi.prodPlan ? pctText(D.planKpi.prodDone, D.planKpi.prodPlan) : '-'}</b>${D.planKpi.oilPlan ? ` · 원액 계획 ${fmt(D.planKpi.oilPlan)} L / 실적 ${fmt(D.planKpi.oilDone)} L` : ''}</p>
            <p class="small">실적 = 생산계획에 적은 실적 수량, * 표시는 적지 않아 업무일지의 포장·원액 생산 실적(그 품목의 첫 계획일부터)으로 채운 값</p>
            ${img.planVs ? `<img class="chart" src="${img.planVs}">` : ''}
            ${table(['거점', '구분', '품목', '계획', '실적', '달성률', '단위'], rows.slice(0, 15).map(r => [esc(r.site), esc(r.type), esc(r.name), fmt(r.qty), `${fmt(r.done)}${r.src === '업무일지' ? '*' : ''}`, pctText(r.done, r.qty), esc(r.unit)]), { widths: [12, 14, 0, 20, 20, 16, 12], cls: ['c', 'c', '', 'r', 'r', 'r', 'c'], empty: '이 달 생산계획 없음' })}${more(rows.length, 15)}
            ${note(D.prodHead?.notes || D.prodHead?.goals || '')}</div>`);
    }
    if (on('purch')) {
        const p = D.purch;
        sec.push(`<div class="block">${h2(`${ymLabel(D.ym)} 구매계획 이행`)}<p class="lead">구매 ${p.count}건 · 입고완료 ${p.status.RECEIVED || 0} · 발주 ${p.status.ORDER || 0} · 계획 ${p.status.PLAN || 0} · 보류 ${p.status.HOLD || 0} · 입고완료율 <b>${pctText(p.status.RECEIVED || 0, p.count)}</b>${p.amount ? ` · 예상 금액 ${fmt(p.amount)}원` : ''}</p>
            ${table(['거점', '품목', '수량', '단위', '공급처', '상태', '금액(원)'], p.rows.slice(0, 15).map(r => [esc(r.site), esc(r.name), fmt(r.qty), esc(r.unit), esc([...r.suppliers].join(', ')), esc([...r.statuses].join('·')), r.amount ? fmt(r.amount) : '-']), { widths: [12, 0, 18, 12, 30, 20, 22], cls: ['c', '', 'r', 'c', '', 'c', 'r'], empty: '이 달 구매계획 없음' })}${more(p.rows.length, 15)}</div>`);
    }
    if (on('work')) {
        sec.push(`<div class="block">${h2('업무추진 현황')}${D.tasks.length ? `<p class="lead">추진과제 ${D.taskSum.total}건 · 완료 ${D.taskSum.count.DONE} · 진행 ${D.taskSum.count.WORK} · 지연 ${D.taskSum.count.DELAY} · 평균 진행률 <b>${D.taskSum.avg.toFixed(0)}%</b></p>
            ${D.work.goal ? `<h3>이달의 중점 목표</h3>${note(D.work.goal)}` : ''}
            ${table(['구분', '추진과제', '담당', '일정', '진행률', '상태', '추진실적'], D.tasks.map(t => [esc(t.category || ''), `<b>${esc(t.title)}</b>${t.detail ? `<br><span class="small">${esc(t.detail)}</span>` : ''}`, esc([t.dept, t.owner].filter(Boolean).join(' ')), `${esc((t.start || '').slice(5))}${t.end ? `~${esc(t.end.slice(5))}` : ''}`, `${Math.min(100, Math.max(0, Number(t.progress) || 0))}%`, WORK_STATUS[effectiveStatus(t)], esc(t.result || '')]), { widths: [16, 0, 24, 22, 14, 12, 40], cls: ['c', '', 'c', 'c', 'r', 'c', ''] })}
            ${D.work.review ? `<h3>실적 검토 · 이슈</h3>${note(D.work.review)}` : ''}` : '<p class="small">이 달 업무추진계획서가 없습니다.</p>'}</div>`);
    }
    if (on('next')) {
        const pn = D.planNext, qn = D.purchNext;
        sec.push(`<div class="block">${h2(`다음 달(${ymLabel(D.nym)}) 계획`)}
            <h3>생산계획 · 완제품 ${fmt(D.planNextKpi.prod)}${D.planNextKpi.oil ? ` · 원액 ${fmt(D.planNextKpi.oil)} L` : ''}</h3>
            ${table(['거점', '구분', '품목', '계획', '단위', '거래처'], pn.slice(0, 15).map(r => [esc(r.site), esc(r.type), esc(r.name), fmt(r.qty), esc(r.unit), esc([...r.partners].join(', '))]), { widths: [12, 14, 0, 22, 12, 40], cls: ['c', 'c', '', 'r', 'c', ''], empty: '다음 달 생산계획 없음 (생산관리 → 생산계획에서 입력)' })}${more(pn.length, 15)}
            <h3>구매계획 · ${qn.count}건${qn.amount ? ` · 예상 ${fmt(qn.amount)}원` : ''}</h3>
            ${table(['거점', '품목', '수량', '단위', '공급처', '입고예정'], qn.rows.slice(0, 12).map(r => [esc(r.site), esc(r.name), fmt(r.qty), esc(r.unit), esc([...r.suppliers].join(', ')), esc(r.eta || '')]), { widths: [12, 0, 20, 12, 36, 22], cls: ['c', '', 'r', 'c', '', 'c'], empty: '다음 달 구매계획 없음' })}${more(qn.rows.length, 12)}
            ${D.form.nextFocus ? `<h3>다음 달 중점 추진사항</h3>${note(D.form.nextFocus)}` : ''}</div>`);
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
        @media screen { body { background: #cbd5e1; padding: 8mm 0; } .page { background: #fff; padding: 12mm; width: 210mm; box-shadow: 0 1px 6px rgba(0,0,0,.25); } }
    </style></head><body><div class="page">
        <div class="head">
            <div><h1><img class="logo" src="./logo.png" alt="" onerror="this.remove()" />${esc(ymLabel(D.ym))} 월례회의 보고서</h1>
                <div class="sub">대림오일 ${esc(D.form.dept)} · MONTHLY MEETING REPORT · ${esc(D.siteLabel)}</div></div>
            ${approvalPrintHtml(['작성', '검토', '승인'], {})}
        </div>
        <div class="meta"><span><b>대상 기간:</b> ${esc(ymLabel(D.ym))}</span><span><b>회의 일자:</b> ${esc(D.form.date)}</span><span><b>부서:</b> ${esc(D.form.dept)}</span><span><b>작성자:</b> ${esc(D.form.author)}</span></div>
        ${sec.join('')}
        <div class="foot"><span>대림오일 스마트 WMS · 월간 실적 현황판·생산계획·구매계획·업무추진계획 기준</span><span>출력 ${esc(new Date().toLocaleString('ko-KR'))}</span></div>
    </div><script>window.onload = function () { setTimeout(function () { window.print(); }, 500); };<\/script></body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
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
    const footer = `대림오일 ${D.form.dept} · ${ymLabel(D.ym)} 월례회의`;
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
    cover.addText(`${ymLabel(D.ym)} 월례회의`, { x: 0.8, y: 2.1, w: 11.5, h: 1.1, fontSize: 44, color: 'FFFFFF', fontFace: F, bold: true });
    cover.addText(`${D.form.dept} 월간 실적 및 계획 보고`, { x: 0.8, y: 3.25, w: 11.5, h: 0.6, fontSize: 22, color: 'E0E7FF', fontFace: F });
    cover.addText(`회의 일자 ${D.form.date}   ·   보고 ${D.form.author || ''}   ·   ${D.siteLabel}`, { x: 0.8, y: 5.45, w: 11.5, h: 0.5, fontSize: 14, color: 'E0E7FF', fontFace: F });

    // 2. 목차
    const agenda = ['핵심 요약', ...MEETING_SECTIONS.filter(([k]) => on(k) && (k !== 'issue' || D.form.issues)).map(([, l]) => l)];
    const ag = add('목차');
    ag.addText(agenda.map((a, i) => ({ text: `${String(i + 1).padStart(2, '0')}   ${a}`, options: { breakLine: true } })), { x: 1.2, y: 1.5, w: 10.5, h: 5.2, fontSize: 20, color: '1E293B', fontFace: F, paraSpaceAfter: 10, valign: 'top' });

    // 3. 핵심 요약 (KPI 카드 8칸)
    const sm = add('핵심 요약', `${ymLabel(D.ym)} · ${D.siteLabel}`);
    kpiList(D).forEach(([k, v, sub], i) => {
        const x = 0.45 + (i % 4) * 3.12, y = 1.35 + Math.floor(i / 4) * 2.7;
        sm.addShape(pptx.ShapeType.roundRect, { x, y, w: 2.95, h: 2.45, fill: { color: 'F8FAFC' }, line: { color: 'CBD5E1', width: 1 }, rectRadius: 0.12 });
        sm.addText(k, { x: x + 0.2, y: y + 0.15, w: 2.6, h: 0.4, fontSize: 13, color: '475569', bold: true, fontFace: F });
        sm.addText(v, { x: x + 0.2, y: y + 0.65, w: 2.6, h: 0.8, fontSize: 24, color: NAVY, bold: true, fontFace: F });
        sm.addText(sub, { x: x + 0.2, y: y + 1.5, w: 2.6, h: 0.8, fontSize: 10.5, color: '64748B', fontFace: F, valign: 'top' });
    });

    if (on('prod')) {
        const a = add('생산 실적 · 완제품 포장', `${fmt(s.t.pack)} EA · 작업일 ${s.workDays}일`);
        lead(a, `완제품 포장 ${fmt(s.t.pack)} EA (${fmt(s.t.packBox)}박스) · 포장 공수 ${fmt(s.t.mhPack, 1)} · 생산성 ${fmt(s.packProd)} EA/공수${s.view === 'ALL' ? ` · 본사 ${fmt(s.bySite.HQ.pack)} / 김포 ${fmt(s.bySite.GIMPO.pack)}` : ''}`);
        barChart(a, C.pack, { x: 0.45, y: 1.7, w: 8.2, h: 5.2 }, { stacked: true });
        doughnut(a, C.category, { x: 8.8, y: 1.7, w: 4.1, h: 5.2 });
        const b = add('생산 실적 · 포장 TOP 10 품목');
        table(b, ['#', '품목', '카테고리', ...(s.view === 'ALL' ? ['본사', '김포'] : []), '합계(EA)', '박스', '공수'],
            s.products.slice(0, 10).map((p, i) => [i + 1, p.item, p.category, ...(s.view === 'ALL' ? [p.HQ ? fmt(p.HQ) : '', p.GIMPO ? fmt(p.GIMPO) : ''] : []), fmt(p.qty), fmt(p.box), fmt(p.manHours, 1)]),
            { x: 0.45, y: 1.3, w: 12.4 }, { colW: s.view === 'ALL' ? [0.5, 4.9, 1.6, 1.2, 1.2, 1.3, 0.9, 0.8] : [0.5, 6.2, 2, 1.6, 1.1, 1.0], align: ['center', 'left', 'center', 'right', 'right', 'right', 'right', 'right'], maxRows: 10 });
    }
    if (on('oil')) {
        const a = add('원액 생산 · 작업공수', `원액 ${fmt(s.t.oil)} L · 공수 ${fmt(s.t.manHours, 1)}`);
        lead(a, `원액 ${fmt(s.t.oil)} L · ${s.t.oilBatches}배치 · 원액 공수 ${fmt(s.t.mhOil, 1)} (${fmt(s.oilProd)} L/공수) · 전체 공수 ${fmt(s.t.manHours, 1)}`);
        barChart(a, C.oil, { x: 0.45, y: 1.7, w: 6.4, h: 2.7 }, { stacked: true });
        doughnut(a, C.manhours, { x: 7.1, y: 1.7, w: 5.8, h: 2.7 });
        table(a, ['원액', '생산(L)', '배치', '공수'], s.oils.map(o => [o.item, fmt(o.qty), o.batches, fmt(o.manHours, 2)]), { x: 0.45, y: 4.55, w: 6.4 }, { colW: [3.4, 1.2, 0.8, 1.0], align: ['left', 'right', 'right', 'right'], maxRows: 6, fontSize: 9.5 });
        table(a, ['기타업무 종류', '건수', '공수'], s.taskGroups.map(g => [g.type, g.count, fmt(g.manHours, 2)]), { x: 7.1, y: 4.55, w: 5.8 }, { colW: [3.6, 1.0, 1.2], align: ['left', 'right', 'right'], maxRows: 6, fontSize: 9.5 });
    }
    if (on('raw')) {
        const r = D.raw;
        const a = add('원료입고 실적', `${fmt(r.total.qty)} L · ${r.total.count}건`);
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
        const a = add('업무추진 현황', D.tasks.length ? `평균 진행률 ${D.taskSum.avg.toFixed(0)}%` : '');
        if (D.tasks.length) {
            lead(a, `추진과제 ${D.taskSum.total}건 · 완료 ${D.taskSum.count.DONE} · 진행 ${D.taskSum.count.WORK} · 지연 ${D.taskSum.count.DELAY}${D.work.goal ? ` · 중점 목표: ${D.work.goal.split('\n')[0]}` : ''}`);
            table(a, ['구분', '추진과제', '담당', '일정', '진행률', '상태', '추진실적'], D.tasks.map(t => [t.category || '', t.title, [t.dept, t.owner].filter(Boolean).join(' '), `${(t.start || '').slice(5)}${t.end ? `~${t.end.slice(5)}` : ''}`, `${Math.min(100, Math.max(0, Number(t.progress) || 0))}%`, WORK_STATUS[effectiveStatus(t)], t.result || '']),
                { x: 0.45, y: 1.7, w: 12.4 }, { colW: [1.1, 3.6, 1.8, 1.4, 0.9, 0.8, 2.8], align: ['center', 'left', 'center', 'center', 'right', 'center', 'left'], maxRows: 9 });
            if (D.work.review) a.addText([{ text: '실적 검토 · 이슈\n', options: { bold: true, color: '92400E' } }, { text: D.work.review }], { x: 0.45, y: 5.35, w: 12.4, h: 1.55, fontSize: 11, color: '1F2937', fontFace: F, fill: { color: 'FFFBEB' }, line: { color: 'FCD34D', width: 1 }, valign: 'top', margin: 8 });
        } else lead(a, '이 달 업무추진계획서가 없습니다. (생산관리 → 업무추진계획)');
    }
    if (on('next')) {
        const a = add(`다음 달(${ymLabel(D.nym)}) 계획`, `완제품 ${fmt(D.planNextKpi.prod)}${D.planNextKpi.oil ? ` · 원액 ${fmt(D.planNextKpi.oil)} L` : ''}`);
        a.addText('생산계획', { x: 0.45, y: 1.15, w: 6, h: 0.4, fontSize: 14, bold: true, color: NAVY, fontFace: F });
        table(a, ['거점', '구분', '품목', '계획', '단위'], D.planNext.map(r => [r.site, r.type, r.name, fmt(r.qty), r.unit]), { x: 0.45, y: 1.6, w: 6.2 }, { colW: [0.7, 0.8, 3.0, 1.1, 0.6], align: ['center', 'center', 'left', 'right', 'center'], maxRows: 10, fontSize: 9.5 });
        a.addText(`구매계획 · ${D.purchNext.count}건`, { x: 6.85, y: 1.15, w: 6, h: 0.4, fontSize: 14, bold: true, color: NAVY, fontFace: F });
        table(a, ['품목', '수량', '단위', '공급처'], D.purchNext.rows.map(r => [r.name, fmt(r.qty), r.unit, [...r.suppliers].join(', ')]), { x: 6.85, y: 1.6, w: 6.05 }, { colW: [2.8, 1.1, 0.65, 1.5], align: ['left', 'right', 'center', 'left'], maxRows: 10, fontSize: 9.5 });
        if (D.form.nextFocus) {
            const f = add('다음 달 중점 추진사항');
            f.addText(D.form.nextFocus, { x: 0.8, y: 1.4, w: 11.7, h: 5.3, fontSize: 18, color: '1E293B', fontFace: F, valign: 'top', paraSpaceAfter: 8 });
        }
    }
    if (on('issue') && D.form.issues) {
        const a = add('이슈 · 건의사항');
        a.addText(D.form.issues, { x: 0.8, y: 1.4, w: 11.7, h: 5.3, fontSize: 18, color: '1E293B', fontFace: F, valign: 'top', paraSpaceAfter: 8 });
    }
    await pptx.writeFile({ fileName: `${D.ym}_${D.form.dept}_월례회의.pptx` });
};

// ---------- 대화창 ----------
export const openMeetingDialog = (snap, { showToast = () => {} } = {}) => {
    if (!snap || !snap.ym || snap.ym === 'ALL') { alert('월례회의 자료는 한 달 단위로 만듭니다. 위쪽 분석 월에서 달을 고르세요.'); return; }
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}'); } catch { }
    const sections = Array.isArray(saved.sections) ? saved.sections : MEETING_SECTIONS.map(([k]) => k);
    document.getElementById('meeting-modal')?.remove();
    const el = document.createElement('div');
    el.id = 'meeting-modal';
    el.className = 'fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-3';
    el.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                <div><h3 class="text-base font-black text-slate-900 flex items-center gap-2"><i data-lucide="presentation" class="w-5 h-5 text-indigo-600"></i>월례회의 자료 만들기</h3>
                    <p class="text-[11px] text-slate-500 mt-0.5">${esc(ymLabel(snap.ym))} · ${esc(SITE_LABEL[snap.view] || '전체 (본사·김포)')} — 월간 실적 현황판 · 월간 생산계획 · 월간 구매계획 · 업무추진계획서 기준</p></div>
                <button type="button" class="mt-close text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
            </div>
            <div class="p-5 space-y-4 text-xs">
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label class="block"><span class="font-bold text-slate-600">부서</span><input id="mt-dept" value="${esc(saved.dept || '생산공급망팀')}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                    <label class="block"><span class="font-bold text-slate-600">회의 일자</span><input id="mt-date" type="date" value="${esc(localDateStr())}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                    <label class="block"><span class="font-bold text-slate-600">보고자</span><input id="mt-author" value="${esc(saved.author || state.currentGlobalWorker || state.currentUser?.name || '')}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                </div>
                <div><div class="font-bold text-slate-600 mb-1">넣을 항목 <span class="font-normal text-slate-400">(핵심 요약은 항상 들어갑니다)</span></div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">${MEETING_SECTIONS.map(([k, l]) => `<label class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"><input type="checkbox" class="mt-sec accent-indigo-600" value="${k}" ${sections.includes(k) ? 'checked' : ''} />${esc(l)}</label>`).join('')}</div></div>
                <label class="block"><span class="font-bold text-slate-600">다음 달 중점 추진사항</span>
                    <textarea id="mt-next" rows="3" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" placeholder="불러오는 중..."></textarea></label>
                <label class="block"><span class="font-bold text-slate-600">이슈 · 건의사항</span>
                    <textarea id="mt-issues" rows="4" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" placeholder="불러오는 중..."></textarea></label>
                <p class="text-[11px] text-slate-400">처음에는 업무추진계획서(이달 실적 검토·비고, 다음 달 중점 목표)와 월간 생산계획 비고에서 채워 둡니다. 고쳐서 쓰세요.</p>
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

    // 기본 글: 업무추진계획서·생산계획 비고
    Promise.all([loadWorkPlan('WORK_MONTH', snap.ym), loadWorkPlan('WORK_MONTH', nextMonth(snap.ym)), getPlan('PROD_MONTH', nextMonth(snap.ym))]).then(([w, wn, pn]) => {
        if (!$('#mt-next')) return;
        $('#mt-next').placeholder = '예) 10월 성수기 출하 대응, 충진기 설치·시운전';
        $('#mt-issues').placeholder = '예) 원료 납기 지연 우려, 인력 충원 요청';
        if (!$('#mt-next').value) $('#mt-next').value = [wn.goal, pn?.goals, pn?.notes].filter(Boolean).join('\n');
        if (!$('#mt-issues').value) $('#mt-issues').value = [w.review, w.notes].filter(Boolean).join('\n');
    }).catch(() => { });

    const form = () => {
        const f = {
            dept: $('#mt-dept').value.trim() || '생산공급망팀', date: $('#mt-date').value || localDateStr(), author: $('#mt-author').value.trim(),
            sections: [...el.querySelectorAll('.mt-sec:checked')].map(c => c.value), nextFocus: $('#mt-next').value.trim(), issues: $('#mt-issues').value.trim()
        };
        try { localStorage.setItem(OPTS_KEY, JSON.stringify({ dept: f.dept, author: f.author, sections: f.sections })); } catch { }
        return f;
    };
    const run = async (fn, label, win = null) => {
        const busy = $('#mt-busy');
        busy.classList.remove('hidden');
        el.querySelectorAll('#mt-pdf, #mt-ppt').forEach(b => { b.disabled = true; });
        try {
            const D = await collectMeetingData(snap, form());
            await fn(D, ...(win ? [win] : []));
            showToast(`📑 월례회의 ${label}를 만들었습니다.`);
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
