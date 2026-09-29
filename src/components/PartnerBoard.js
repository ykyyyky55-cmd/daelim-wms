// ==========================================
// 월간 실적 현황판 › 거래처별 실적 (partnerBoard)
// ==========================================
// 계산은 services/partnerStats.js. 거래처를 누르면 월별 추이·주문·출하·품질 기록을 펼친다.
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { localDateStr } from '../services/searchUtils.js';
import { fmtRate } from '../services/quality.js';
import { reqTypeOf, monthOf } from '../services/plans.js';
import { loadPartnerData, computePartnerStats } from '../services/partnerStats.js';

const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
const PREF = 'daelim_partner_board';
const monthStart = (d) => `${d.slice(0, 7)}-01`;
const addMonths = (d, n) => { const x = new Date(`${d.slice(0, 7)}-01T00:00:00`); x.setMonth(x.getMonth() + n); return localDateStr(x); };
const monthEnd = (d) => { const x = new Date(`${d.slice(0, 7)}-01T00:00:00`); x.setMonth(x.getMonth() + 1); x.setDate(0); return localDateStr(x); };
const COLS = [
    ['name', '거래처', 'text-left'], ['orders', '주문', 'text-right'], ['orderQty', '주문 수량', 'text-right'], ['done', '완료', 'text-right'], ['onTimeRate', '납기 준수', 'text-right'],
    ['open', '진행 중', 'text-right'], ['overdue', '납기 지남', 'text-right'], ['slips', '출하요청서', 'text-right'], ['shipQty', '출하 수량', 'text-right'],
    ['schedRows', '스케줄 진행', 'text-right'], ['rate', '불량률', 'text-right'], ['ncr', '부적합', 'text-right'], ['lastOrder', '최근 주문', 'text-left']
];

export const renderPartnerBoard = (container, { onSwitchTab = () => {}, showToast = () => {} } = {}) => {
    let pref = {};
    try { pref = JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { /* 기본값 */ }
    const today = localDateStr();
    let range = pref.range || '6m';
    let from = '', to = today;
    let merge = pref.merge !== false;
    let sortKey = pref.sortKey || 'orders', desc = pref.desc !== false;
    let q = '';
    let data = null, stats = null, openKey = '';
    const save = () => { try { localStorage.setItem(PREF, JSON.stringify({ range, merge, sortKey, desc })); } catch { /* 무시 */ } };
    const setRange = (r) => {
        range = r;
        if (r === 'm') { from = monthStart(today); to = today; } else if (r === '3m') { from = addMonths(today, -2); to = today; } else if (r === '6m') { from = addMonths(today, -5); to = today; }
        else if (r === 'y') { from = `${today.slice(0, 4)}-01-01`; to = today; } else if (r === 'ly') { const y = Number(today.slice(0, 4)) - 1; from = `${y}-01-01`; to = `${y}-12-31`; }
    };
    setRange(range === 'custom' ? '6m' : range);

    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-indigo-600 flex items-center gap-1"><i data-lucide="bar-chart-3" class="w-3.5 h-3.5"></i>월간 실적 현황판 › 거래처별 실적</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="building-2" class="w-5 h-5 text-indigo-600"></i>거래처별 실적 현황</h2>
                    <p class="text-xs text-slate-500 mt-1">생산요청서(주문)·출하요청서·생산 스케줄·제품 출하검사·부적합을 거래처별로 모읍니다. 영업·품질 협의 자료로 쓰세요.</p>
                </div>
                <button type="button" id="pb-xlsx" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"><i data-lucide="file-spreadsheet" class="w-4 h-4"></i>엑셀</button>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">${[['m', '이번 달'], ['3m', '3개월'], ['6m', '6개월'], ['y', '올해'], ['ly', '작년'], ['custom', '직접']].map(([k, l]) => `<button type="button" data-r="${k}" class="pb-range tap-compact px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
                <span id="pb-custom" class="hidden items-center gap-1"><input type="month" id="pb-from" class="border border-slate-300 rounded-lg px-2 py-1 font-bold" /> ~ <input type="month" id="pb-to" class="border border-slate-300 rounded-lg px-2 py-1 font-bold" /></span>
                <label class="flex items-center gap-1.5 font-bold text-slate-700" title="'SM벡셀 [국군복지단]'·'영남(세양상사)'처럼 괄호 안 이름을 떼고 본 거래처로 합칩니다"><input type="checkbox" id="pb-merge" ${merge ? 'checked' : ''} />괄호 안 이름 묶어 보기</label>
                <input id="pb-q" type="search" placeholder="거래처·품목 검색" class="flex-1 min-w-[160px] border border-slate-300 rounded-lg px-2 py-1.5" />
                <span id="pb-period" class="text-[11px] text-slate-400"></span>
            </div>
        </div>
        <div id="pb-kpi" class="grid grid-cols-2 md:grid-cols-6 gap-3"></div>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div class="overflow-auto max-h-[70vh]"><table class="w-full text-xs" id="pb-table"></table></div></div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    const paint = () => {
        container.querySelectorAll('.pb-range').forEach(b => { b.className = `pb-range tap-compact px-3 py-1.5 rounded-lg font-black ${b.dataset.r === range ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-600'}`; });
        $('#pb-custom').classList.toggle('hidden', range !== 'custom'); $('#pb-custom').classList.toggle('flex', range === 'custom');
        $('#pb-period').textContent = `${from} ~ ${to}`;
    };
    const detail = (p) => {
        const months = Object.keys(p.months).sort();
        const max = Math.max(1, ...months.map(m => Math.max(p.months[m].orders, p.months[m].ship)));
        const bar = (v, cls) => `<div class="h-2 rounded ${cls}" style="width:${Math.max(2, (v / max) * 100)}%"></div>`;
        const orderRows = [...p.list.orders].sort((a, b) => String(b.r.reqDate).localeCompare(String(a.r.reqDate))).slice(0, 30);
        return `<tr><td colspan="${COLS.length}" class="p-3 bg-slate-50">
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div class="bg-white p-3 rounded-xl border border-slate-200"><div class="font-black text-slate-700 mb-2">월별 주문 · 출하 <span class="text-[10px] font-normal text-slate-400"><span class="inline-block w-2 h-2 bg-indigo-400 rounded"></span> 주문 <span class="inline-block w-2 h-2 bg-rose-400 rounded"></span> 출하</span></div>
                    ${months.map(m => `<div class="grid grid-cols-[52px_1fr_60px] items-center gap-2 py-0.5"><span class="text-[10px] text-slate-500">${esc(m.slice(2).replace('-', '.'))}</span><div class="space-y-0.5">${bar(p.months[m].orders, 'bg-indigo-400')}${bar(p.months[m].ship, 'bg-rose-400')}</div><span class="text-[10px] text-slate-500 text-right">${p.months[m].orders} · ${p.months[m].ship}</span></div>`).join('') || '<div class="text-slate-400">기간 안 기록 없음</div>'}
                    <div class="mt-2 font-black text-slate-700">주요 품목</div>${p.items.slice(0, 6).map(it => `<div class="flex justify-between text-[11px]"><span class="truncate">${esc(it.name)}</span><b>${fmt(it.qty)}</b></div>`).join('') || '<div class="text-slate-400 text-[11px]">없음</div>'}
                    ${p.aliases.length > 1 ? `<div class="mt-2 text-[10px] text-slate-400">묶인 이름: ${esc(p.aliases.join(', '))}</div>` : ''}
                </div>
                <div class="bg-white p-3 rounded-xl border border-slate-200 overflow-auto max-h-80"><div class="font-black text-slate-700 mb-1">주문 (생산요청서)</div>
                    ${orderRows.map(o => `<button type="button" class="pb-order w-full text-left py-1 border-b border-slate-50 text-[11px] hover:bg-indigo-50" data-id="${esc(o.id)}"><b class="font-mono">${esc(o.docNo)}</b> ${esc(o.lines[0]?.name || '')}${o.lines.length > 1 ? ` 외 ${o.lines.length - 1}` : ''} <span class="text-slate-400">납기 ${esc(o.due || '-')}</span> <span class="${o.state === 'DONE' ? (o.onTime === false ? 'text-amber-600' : 'text-emerald-600') : o.overdue ? 'text-rose-600' : 'text-violet-600'} font-bold">${esc(o.stage)}</span></button>`).join('') || '<div class="text-slate-400 text-[11px]">없음</div>'}</div>
                <div class="bg-white p-3 rounded-xl border border-slate-200 overflow-auto max-h-80"><div class="font-black text-slate-700 mb-1">출하 · 품질</div>
                    ${p.list.slips.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 20).map(s => `<div class="py-1 border-b border-slate-50 text-[11px]"><span class="font-mono">${esc(s.docNo)}</span> ${esc(s.date)} · ${esc((s.items || [])[0]?.name || '')}${(s.items || []).length > 1 ? ` 외 ${(s.items || []).length - 1}` : ''} <span class="${s.shippedAt ? 'text-emerald-600' : 'text-blue-600'} font-bold">${s.shippedAt ? '출하완료' : '대기'}</span></div>`).join('') || '<div class="text-slate-400 text-[11px]">출하요청서 없음</div>'}
                    <div class="mt-2 font-black text-slate-700">품질 기록</div>
                    ${p.list.quality.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 20).map(x => `<div class="py-0.5 text-[11px]"><span class="text-slate-400">${esc(x.date)}</span> ${esc(x.kind)} · ${esc(x.name || '')} <b class="${/불합격|발생|조치/.test(x.result) ? 'text-rose-600' : 'text-emerald-600'}">${esc(x.result)}</b>${x.defect ? ` 불량 ${fmt(x.defect)}` : ''}</div>`).join('') || '<div class="text-slate-400 text-[11px]">없음</div>'}
                </div>
            </div></td></tr>`;
    };
    const val = (p, k) => (k === 'name' ? p.name : k === 'rate' ? (p.inspected ? p.rate : -1) : k === 'onTimeRate' ? (p.onTimeRate ?? -1) : p[k] ?? '');
    const draw = () => {
        paint();
        if (!stats) return;
        const t = stats.totals;
        const kpi = (l, v, cls = 'text-slate-900', sub = '') => `<div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm"><div class="text-[11px] font-bold text-slate-500">${l}</div><div class="text-xl font-black ${cls}">${v}</div>${sub ? `<div class="text-[10px] text-slate-400">${sub}</div>` : ''}</div>`;
        $('#pb-kpi').innerHTML = [kpi('거래처', `${t.partners}곳`), kpi('주문', `${t.orders}건`, 'text-indigo-700', `완료 ${t.done}건`), kpi('납기 준수', t.onTimeRate === null ? '-' : `${fmt(t.onTimeRate)}%`, 'text-emerald-700', `지남 ${t.late}건`),
            kpi('진행 중 납기 지남', `${t.overdue}건`, t.overdue ? 'text-rose-600' : 'text-slate-900'), kpi('출하 완료', `${t.shipped}건`, 'text-rose-700', `수량 ${fmt(t.shipQty)}`), kpi('출하검사 불량률', t.inspected ? fmtRate(t.rate) : '-', 'text-amber-700', `검사 ${fmt(t.inspected)}`)].join('');
        const qq = q.trim().toLowerCase();
        const rows = stats.rows.filter(p => !qq || `${p.aliases.join(' ')} ${p.items.map(i => i.name).join(' ')}`.toLowerCase().includes(qq))
            .sort((a, b) => { const x = val(a, sortKey), y = val(b, sortKey); const c = typeof x === 'string' ? String(x).localeCompare(String(y), 'ko') : x - y; return desc ? -c : c; });
        $('#pb-table').innerHTML = `<thead class="bg-slate-50 text-slate-600 font-bold sticky top-0 z-10"><tr>${COLS.map(([k, l, a]) => `<th class="p-2 whitespace-nowrap ${a} cursor-pointer hover:text-indigo-700 pb-sort" data-k="${k}">${l}${sortKey === k ? (desc ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.map(p => `<tr class="pb-row cursor-pointer hover:bg-indigo-50/50 ${openKey === p.key ? 'bg-indigo-50' : ''}" data-k="${esc(p.key)}">
                <td class="p-2 font-black text-slate-900 whitespace-nowrap">${openKey === p.key ? '▾' : '▸'} ${esc(p.name)}${p.aliases.length > 1 ? ` <span class="text-[10px] text-slate-400">(${p.aliases.length}개 이름)</span>` : ''}</td>
                <td class="p-2 text-right font-black">${p.orders || ''}</td><td class="p-2 text-right">${p.orderQty ? fmt(p.orderQty) : ''}</td><td class="p-2 text-right">${p.done || ''}</td>
                <td class="p-2 text-right font-bold ${p.onTimeRate === null ? 'text-slate-300' : p.onTimeRate < 80 ? 'text-rose-600' : 'text-emerald-700'}">${p.onTimeRate === null ? '-' : `${fmt(p.onTimeRate)}%`}</td>
                <td class="p-2 text-right">${p.open || ''}</td><td class="p-2 text-right font-black ${p.overdue ? 'text-rose-600' : ''}">${p.overdue || ''}</td>
                <td class="p-2 text-right">${p.slips || ''}</td><td class="p-2 text-right">${p.shipQty ? fmt(p.shipQty) : ''}</td><td class="p-2 text-right">${p.schedRows ? `${p.schedRows}줄 · ${fmt(p.schedQty)}` : ''}</td>
                <td class="p-2 text-right ${p.fail ? 'text-rose-600 font-black' : ''}">${p.inspected ? fmtRate(p.rate) : '-'}${p.fail ? ` <span class="text-[10px]">불합격 ${p.fail}</span>` : ''}</td><td class="p-2 text-right ${p.ncr ? 'text-rose-600 font-bold' : ''}">${p.ncr || ''}</td>
                <td class="p-2 font-mono text-slate-500">${esc(p.lastOrder || '')}</td></tr>${openKey === p.key ? detail(p) : ''}`).join('') || `<tr><td colspan="${COLS.length}" class="p-8 text-center text-slate-400 font-bold">이 기간에 거래처가 적힌 기록이 없습니다.</td></tr>`}</tbody>`;
        container.querySelectorAll('.pb-sort').forEach(th => th.addEventListener('click', () => { if (sortKey === th.dataset.k) desc = !desc; else { sortKey = th.dataset.k; desc = th.dataset.k !== 'name'; } save(); draw(); }));
        container.querySelectorAll('.pb-row').forEach(tr => tr.addEventListener('click', () => { openKey = openKey === tr.dataset.k ? '' : tr.dataset.k; draw(); }));
        container.querySelectorAll('.pb-order').forEach(b => b.addEventListener('click', (e) => {
            e.stopPropagation();
            const o = data.orders.find(x => x.id === b.dataset.id);
            if (o) { window.__reqOpen = { id: o.id, type: reqTypeOf(o.r), month: monthOf(o.r.reqDate || o.r.period) }; onSwitchTab('prodRequest'); }
        }));
        createIcons({ icons });
    };
    const recompute = () => { stats = data ? computePartnerStats(data, { from, to, merge }) : null; draw(); };
    const load = async () => {
        paint();
        $('#pb-table').innerHTML = '<tbody><tr><td class="p-8 text-center text-slate-400">불러오는 중...</td></tr></tbody>';
        try { data = await loadPartnerData({ from, to }); } catch (e) { $('#pb-table').innerHTML = `<tbody><tr><td class="p-4 text-rose-600 font-bold">${esc(e.message)}</td></tr></tbody>`; return; }
        recompute();
    };

    container.querySelectorAll('.pb-range').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.r === 'custom') { range = 'custom'; $('#pb-from').value = from.slice(0, 7); $('#pb-to').value = to.slice(0, 7); paint(); return; }
        setRange(b.dataset.r); save(); load();
    }));
    const applyCustom = () => { const f = $('#pb-from').value, t = $('#pb-to').value; if (!f || !t) return; from = `${f}-01`; to = monthEnd(`${t}-01`); if (from > to) [from, to] = [`${t}-01`, monthEnd(`${f}-01`)]; load(); };
    $('#pb-from').addEventListener('change', applyCustom);
    $('#pb-to').addEventListener('change', applyCustom);
    $('#pb-merge').addEventListener('change', (e) => { merge = e.target.checked; openKey = ''; save(); recompute(); });
    let qt = null;
    $('#pb-q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { q = e.target.value; draw(); }, 150); });
    $('#pb-xlsx').addEventListener('click', async () => {
        if (!stats) return;
        const XLSX = await import('xlsx');
        const rows = stats.rows.map(p => ({ 거래처: p.name, '묶인 이름': p.aliases.join(', '), 주문: p.orders, '주문 수량': p.orderQty, 완료: p.done, '납기 준수(%)': p.onTimeRate === null ? '' : Math.round(p.onTimeRate * 10) / 10, '납기 지남(완료)': p.late,
            '진행 중': p.open, '진행 중 납기 지남': p.overdue, 출하요청서: p.slips, 출하완료: p.shipped, '출하 수량': p.shipQty, '스케줄 진행 줄': p.schedRows, '스케줄 수량': p.schedQty,
            '검사 수량': p.inspected, '불량 수량': p.defect, '불량률(%)': p.inspected ? Math.round(p.rate * 100) / 100 : '', 불합격: p.fail, 부적합: p.ncr, '최근 주문': p.lastOrder, '주요 품목': p.items.slice(0, 3).map(i => i.name).join(', ') }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '거래처별 실적');
        const file = `대림오일_거래처별실적_${from}_${to}.xlsx`;
        XLSX.writeFile(wb, file);
        showToast(`📊 ${file}을 저장했습니다.`);
    });
    createIcons({ icons });
    load();
};
