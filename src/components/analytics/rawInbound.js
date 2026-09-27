import { state } from '../../services/db.js';
import { esc } from '../../services/html.js';

// 월간 실적 현황판 → 원료입고 실적: 원료수불부(state.rawLedger)에서 '원료 매입 입고'만 모아 본다.
// 원료수불부 입고(수) 전표에는 거점이동·재고조사/조정·원액 생산 입고가 섞여 있으므로 걸러낸다.
//  - 이동: 구분에 '이동'·'인수'·'->'·'캠프' 등이 든 전표 (거점 사이 이동은 매입이 아님)
//  - 조정: 재고조사·재고확인·재고조정·재입고·반납 등
//  - 원액: 품목 분류가 원액인 전표 (원액 생산 입고)
// 구분 칸에 거래처 이름이 적힌 예전 전표(동남유화·성풍화학 등)가 많아, 일반 글자가 아닌 구분은 공급처로 본다.
export const REGION_COLORS = { 김포: '#059669', 본사: '#2563eb', 방산: '#d97706', 김포2: '#7c3aed' };
const REGION_ORDER = ['김포', '본사', '방산', '김포2'];
const MOVE_RE = /이동|인수|->|→|캠프|켐프|재고관리|회수/;
const ADJUST_RE = /재고|조사|확인|조정|재입고|반납|수불|대여/;
const GENERIC_TYPES = new Set(['입고', '재입고', '매입', '구매']);
// 업무일지 보기(전체/본사/김포) → 원료수불부 지역
export const regionsOfView = (view) => (view === 'HQ' ? ['본사'] : view === 'GIMPO' ? ['김포'] : REGION_ORDER);

const masterOf = (e) => (e.code && state.master.find(m => m.code === e.code)) || state.master.find(m => m.name === e.name) || null;

export const classifyRawEntry = (e) => {
    const type = String(e.type || '').trim();
    if ((Number(e.inQty) || 0) <= 0) return (Number(e.outQty) || 0) > 0 && !MOVE_RE.test(type) && !ADJUST_RE.test(type) ? 'USE' : 'OTHER';
    if (MOVE_RE.test(type) || /^김포/.test(type)) return 'MOVE';
    if (ADJUST_RE.test(type)) return 'ADJUST';
    if (masterOf(e)?.category === '원액') return 'OIL';
    return 'BUY';
};
export const supplierOf = (e) => {
    const type = String(e.type || '').replace(/^입고\s*[,·/]\s*/, '').trim();
    if (type && !GENERIC_TYPES.has(type)) return type;
    return String(e.manufacturer || '').trim() || '미기재';
};

// ym: 'YYYY-MM' 또는 'ALL'
export const computeRawInbound = (ym, view) => {
    const regions = regionsOfView(view);
    const inMonth = (d) => ym === 'ALL' || String(d || '').startsWith(ym);
    const rows = [];
    let useQty = 0, moveCount = 0, oilQty = 0;
    for (const e of state.rawLedger || []) {
        if (!inMonth(e.date)) continue;
        const region = e.location || '김포';
        if (!regions.includes(region)) continue;
        const kind = classifyRawEntry(e);
        if (kind === 'USE') useQty += Number(e.outQty) || 0;
        else if (kind === 'MOVE') moveCount++;
        else if (kind === 'OIL') oilQty += Number(e.inQty) || 0;
        if (kind !== 'BUY') continue;
        const qty = Number(e.inQty) || 0;
        const sg = Number(e.sg) || 0;
        const price = Number(e.unitPrice) || 0;
        rows.push({ date: e.date, region, name: e.name || e.itemName || '', code: e.code || '', rawCode: e.rawCode || '', supplier: supplierOf(e), qty, kg: sg > 0 ? qty * sg : 0, amount: price * qty, notes: e.notes || e.remark || '' });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ko'));
    const group = (keyFn, init) => {
        const m = new Map();
        rows.forEach(r => { const k = keyFn(r); const g = m.get(k) || init(r); g.qty += r.qty; g.kg += r.kg; g.amount += r.amount; g.count++; g[r.region] = (g[r.region] || 0) + r.qty; g.suppliers?.add(r.supplier); g.dates?.add(r.date); m.set(k, g); });
        return [...m.values()].sort((a, b) => b.qty - a.qty);
    };
    const byItem = group(r => r.name, r => ({ name: r.name, code: r.code, qty: 0, kg: 0, amount: 0, count: 0, suppliers: new Set() }));
    const bySupplier = group(r => r.supplier, r => ({ supplier: r.supplier, qty: 0, kg: 0, amount: 0, count: 0, items: new Set(), dates: new Set() }));
    bySupplier.forEach(g => rows.filter(r => r.supplier === g.supplier).forEach(r => g.items.add(r.name)));
    const byDate = group(r => r.date, r => ({ date: r.date, qty: 0, kg: 0, amount: 0, count: 0 }));
    const total = { qty: rows.reduce((s, r) => s + r.qty, 0), kg: rows.reduce((s, r) => s + r.kg, 0), amount: rows.reduce((s, r) => s + r.amount, 0), count: rows.length, days: new Set(rows.map(r => r.date)).size, useQty, moveCount, oilQty };
    const byRegion = Object.fromEntries(regions.map(g => [g, rows.filter(r => r.region === g).reduce((s, r) => s + r.qty, 0)]));
    return { rows, byItem, bySupplier, byDate, total, byRegion, regions };
};

// 원료수불부에 입고 전표가 있는 달 목록 (월 선택 목록에 합친다)
export const rawInboundMonths = () => [...new Set((state.rawLedger || []).filter(e => (Number(e.inQty) || 0) > 0 && e.date).map(e => String(e.date).slice(0, 7)))];

const fmt = (n, d = 0) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: d });

// 원료입고 실적 화면 (KPI + 일자별 그래프 + 공급처 + 원료별 표 + 입고 전표 목록)
export const rawBoardHtml = ({ r, prev, monthLabel, kpi, card, delta }) => {
    const regionCols = r.regions.length > 1;
    const usedRegions = r.regions.filter(g => r.byRegion[g] > 0);
    const regionSplit = regionCols ? `<div class="flex flex-wrap gap-x-2 text-[10px] font-bold mt-1">${usedRegions.map(g => `<span style="color:${REGION_COLORS[g] || '#475569'}">${g} ${fmt(r.byRegion[g])}L</span>`).join('<span class="text-slate-300">|</span>') || '<span class="text-slate-400">-</span>'}</div>` : '';
    const t = r.total;
    return `
        <div class="flex items-center gap-2 pt-1"><span class="w-1.5 h-6 rounded bg-teal-500"></span><h3 class="text-base font-black text-slate-900">원료입고 실적</h3>
            <span class="text-[11px] font-bold text-slate-400">원료수불부 기준 · 매입 입고만 (거점이동·재고조사·원액 생산 입고 제외)</span></div>
        <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            ${kpi('원료 입고량', 'package-plus', 'teal', fmt(t.qty), 'L', delta(t.qty, prev?.total.qty, { perDay: false }), regionSplit)}
            ${kpi('입고 중량', 'weight', 'cyan', fmt(t.kg), 'kg', delta(t.kg, prev?.total.kg, { perDay: false }), '<div class="text-[10px] text-slate-400 mt-1">입고량 × 전표 비중</div>')}
            ${kpi('입고 건수', 'receipt', 'blue', fmt(t.count), '건', delta(t.count, prev?.total.count, { perDay: false }), `<div class="text-[10px] text-slate-400 mt-1">입고일 ${t.days}일</div>`)}
            ${kpi('입고 원료', 'flask-round', 'violet', fmt(r.byItem.length), '품목', `공급처 ${r.bySupplier.filter(s => s.supplier !== '미기재').length}곳`)}
            ${kpi('입고 금액', 'banknote', 'emerald', t.amount ? fmt(t.amount) : '-', t.amount ? '원' : '', '단가가 입력된 전표만', '')}
            ${kpi('같은 기간 원료 사용', 'arrow-down-up', 'slate', fmt(t.useQty), 'L', `입고 − 사용 = <b class="${t.qty - t.useQty >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${t.qty - t.useQty >= 0 ? '+' : ''}${fmt(t.qty - t.useQty)} L</b>`, `<div class="text-[10px] text-slate-400 mt-1">이동 ${t.moveCount}건 · 원액 생산 입고 ${fmt(t.oilQty)}L 제외</div>`)}
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-12 gap-5">
            <div class="xl:col-span-8">${card('trending-up', 'teal', `원료 입고 · 일자별 (L${regionCols ? ', 지역별' : ''})`, esc(monthLabel), '<div class="h-72"><canvas id="chart-raw-trend"></canvas></div>', 'an-raw')}</div>
            <div class="xl:col-span-4">${card('pie-chart', 'teal', '공급처별 입고량', `${r.bySupplier.filter(s => s.supplier !== '미기재').length}곳${r.bySupplier.some(s => s.supplier === '미기재') ? ' + 미기재' : ''}`, '<div class="h-72"><canvas id="chart-raw-supplier"></canvas></div>')}</div>
        </div>
        ${card('flask-round', 'teal', '원료별 입고 실적', `${r.byItem.length}품목 · ${fmt(t.qty)} L`, `
            <div class="overflow-auto max-h-96 border border-slate-200 rounded-xl">
                <table class="w-full text-xs"><thead class="bg-teal-50 text-teal-900 sticky top-0"><tr><th class="p-2 text-left">#</th><th class="p-2 text-left">원료</th>${regionCols ? usedRegions.map(g => `<th class="p-2 text-right">${g}(L)</th>`).join('') : ''}<th class="p-2 text-right">합계(L)</th><th class="p-2 text-right">중량(kg)</th><th class="p-2 text-right">건수</th><th class="p-2 text-right">금액</th><th class="p-2 text-left">공급처</th></tr></thead>
                <tbody class="divide-y divide-slate-100">${r.byItem.length ? r.byItem.map((g, i) => `<tr><td class="p-2 text-slate-400">${i + 1}</td><td class="p-2 font-bold">${esc(g.name)}${g.code ? `<span class="ml-1 font-mono text-[10px] text-slate-400">${esc(g.code)}</span>` : ''}</td>${regionCols ? usedRegions.map(rg => `<td class="p-2 text-right font-mono">${g[rg] ? fmt(g[rg]) : ''}</td>`).join('') : ''}<td class="p-2 text-right font-mono font-black">${fmt(g.qty)}</td><td class="p-2 text-right font-mono text-slate-500">${g.kg ? fmt(g.kg) : '-'}</td><td class="p-2 text-right">${g.count}</td><td class="p-2 text-right font-mono text-slate-500">${g.amount ? fmt(g.amount) : '-'}</td><td class="p-2 text-slate-600">${esc([...g.suppliers].join(', '))}</td></tr>`).join('') : `<tr><td colspan="10" class="p-6 text-center text-slate-400">원료 입고 실적 없음</td></tr>`}</tbody></table>
            </div>`)}
        ${card('list', 'teal', `원료 입고 전표 (${r.rows.length}건)`, '원료수불부 입고 전표', `
            <details class="text-xs"><summary class="cursor-pointer font-bold text-slate-600">펼쳐 보기</summary>
            <div class="overflow-auto max-h-96 border border-slate-200 rounded-xl mt-2">
                <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600 sticky top-0"><tr><th class="p-2 text-center">일자</th><th class="p-2 text-center">지역</th><th class="p-2 text-left">원료</th><th class="p-2 text-left">공급처</th><th class="p-2 text-right">입고(L)</th><th class="p-2 text-right">중량(kg)</th><th class="p-2 text-left">비고</th></tr></thead>
                <tbody class="divide-y divide-slate-100">${r.rows.map(x => `<tr><td class="p-2 text-center font-mono">${esc(x.date)}</td><td class="p-2 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-black text-white" style="background:${REGION_COLORS[x.region] || '#475569'}">${esc(x.region)}</span></td><td class="p-2 font-bold">${esc(x.name)}</td><td class="p-2 text-slate-600">${esc(x.supplier)}</td><td class="p-2 text-right font-mono font-black">${fmt(x.qty)}</td><td class="p-2 text-right font-mono text-slate-500">${x.kg ? fmt(x.kg) : '-'}</td><td class="p-2 text-slate-500">${esc(x.notes)}</td></tr>`).join('') || '<tr><td colspan="7" class="p-6 text-center text-slate-400">전표 없음</td></tr>'}</tbody></table>
            </div></details>`)}`;
};

// 그래프 (Chart는 부르는 쪽에서 받음: 번들 분할 유지)
export const renderRawCharts = (Chart, charts, r, { font, days: allDates }) => {
    const trend = document.querySelector('#chart-raw-trend');
    if (trend) {
        const dates = allDates?.length ? allDates : r.byDate.map(d => d.date).sort();
        const used = r.regions.filter(g => r.byRegion[g] > 0);
        const val = (g, d) => r.rows.filter(x => x.date === d && x.region === g).reduce((s, x) => s + x.qty, 0);
        charts.rawTrend = new Chart(trend, {
            type: 'bar',
            data: { labels: dates.map(d => d.slice(5)), datasets: (used.length ? used : r.regions.slice(0, 1)).map(g => ({ label: `${g} (L)`, data: dates.map(d => val(g, d)), backgroundColor: REGION_COLORS[g] || '#475569', borderRadius: 3, stack: 'q' })) },
            options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', labels: { font } } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } }, y: { stacked: true, title: { display: true, text: 'L', font }, ticks: { font: { size: 10 } } } } }
        });
    }
    const sup = document.querySelector('#chart-raw-supplier');
    if (sup && r.bySupplier.length) {
        const top = r.bySupplier.slice(0, 8);
        const rest = r.bySupplier.slice(8).reduce((s, g) => s + g.qty, 0);
        const palette = ['#0d9488', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#059669', '#0891b2', '#65a30d', '#94a3b8'];
        charts.rawSupplier = new Chart(sup, {
            type: 'doughnut',
            data: { labels: [...top.map(g => g.supplier), ...(rest ? ['기타'] : [])], datasets: [{ data: [...top.map(g => Math.round(g.qty)), ...(rest ? [Math.round(rest)] : [])], backgroundColor: palette }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font, boxWidth: 10 } } } }
        });
    }
};

// 엑셀 시트
export const rawExcelSheets = (r) => [
    [r.byItem.map((g, i) => ({ 순위: i + 1, 원료: g.name, 품목코드: g.code, ...Object.fromEntries(r.regions.map(rg => [`${rg}(L)`, g[rg] || 0])), '합계(L)': g.qty, '중량(kg)': Math.round(g.kg), 건수: g.count, 금액: g.amount || '', 공급처: [...g.suppliers].join(', ') })), '원료입고 원료별'],
    [r.bySupplier.map(g => ({ 공급처: g.supplier, '입고(L)': g.qty, '중량(kg)': Math.round(g.kg), 건수: g.count, 입고일수: g.dates.size, 원료: [...g.items].join(', ') })), '원료입고 공급처별'],
    [r.rows.map(x => ({ 일자: x.date, 지역: x.region, 원료: x.name, 품목코드: x.code, 공급처: x.supplier, '입고(L)': x.qty, '중량(kg)': Math.round(x.kg), 금액: x.amount || '', 비고: x.notes })), '원료입고 전표']
];
