// ==========================================
// 품목 및 재고관리 › 재고 차이 점검 (stockCheck) — 수불부 최종 재고 ↔ 창고 재고
// ==========================================
// 계산·맞추기는 services/stockCheck.js. 안전재고 미달 구매요청 초안은 services/safetyDraft.js.
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { canPerformAction, canAccessTab } from '../services/auth.js';
import { matchesQuery, localDateStr } from '../services/searchUtils.js';
import * as XLSX from 'xlsx';
import { computeStockDiff, alignLedgerToInventory, STOCK_KINDS } from '../services/stockCheck.js';
import { safetyShortages, openSafetyPurchaseDraft } from '../services/safetyDraft.js';

const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const PREF = 'daelim_stock_check';

export const renderStockCheck = (container, { showToast = () => {}, onSwitchTab = () => {} } = {}) => {
    const canFix = canPerformAction('WRITE_STOCK');
    let pref = {};
    try { pref = JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { /* 기본값 */ }
    let kind = pref.kind || 'ALL';
    let only = pref.only !== false; // 차이 있는 것만
    let tol = Number(pref.tol) >= 0 ? Number(pref.tol) : 0.01;
    let loc = 'ALL';
    let q = '';
    let rows = [];
    const picked = new Set();
    const save = () => { try { localStorage.setItem(PREF, JSON.stringify({ kind, only, tol })); } catch { /* 무시 */ } };

    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
                <div class="text-[11px] font-black text-blue-600 flex items-center gap-1"><i data-lucide="boxes" class="w-3.5 h-3.5"></i>품목 및 재고관리 › 재고 차이 점검</div>
                <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="scale" class="w-5 h-5 text-blue-600"></i>수불부 ↔ 창고 재고 차이 점검</h2>
                <p class="text-xs text-slate-500 mt-1">같은 품목·거점의 <b>수불부 최종 재고</b>(수불일자순 마지막 전표)와 <b>창고 재고</b>(모든 위치 합)를 비교합니다. 원료는 비중으로 L 환산해 원료수불부 지역(김포·본사) 기준으로 봅니다.</p>
            </div>
            <div class="flex flex-wrap gap-2">
                <button type="button" id="sc-refresh" class="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5"><i data-lucide="refresh-cw" class="w-4 h-4"></i>다시 계산</button>
                <button type="button" id="sc-xlsx" class="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1.5"><i data-lucide="file-spreadsheet" class="w-4 h-4 text-emerald-600"></i>엑셀</button>
            </div>
        </div>
        <div id="sc-kpi" class="grid grid-cols-2 md:grid-cols-5 gap-3"></div>
        <div id="sc-safety"></div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">${[['ALL', '전체'], ...Object.entries(STOCK_KINDS)].map(([k, l]) => `<button type="button" data-k="${k}" class="sc-kind tap-compact px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
                <select id="sc-loc" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select>
                <label class="flex items-center gap-1.5 font-bold text-slate-700"><input type="checkbox" id="sc-only" ${only ? 'checked' : ''} />차이 있는 것만</label>
                <label class="flex items-center gap-1 text-slate-500">허용 오차 <input type="number" id="sc-tol" min="0" step="any" value="${tol}" class="w-20 border border-slate-300 rounded-lg px-2 py-1 text-right font-bold" /></label>
                <input id="sc-q" type="search" placeholder="품목코드·품명 검색" class="flex-1 min-w-[160px] border border-slate-300 rounded-lg px-2 py-1.5" />
            </div>
            ${canFix ? `<div class="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-amber-50 border border-amber-200 text-xs">
                <span class="font-bold text-amber-900">고른 <b id="sc-picked">0</b>줄</span>
                <button type="button" id="sc-align" class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-black disabled:opacity-40" disabled>수불부를 창고 재고에 맞추기</button>
                ${canAccessTab('audit') ? '<button type="button" id="sc-audit" class="px-3 py-1.5 rounded-lg bg-white border border-amber-300 font-bold">창고가 틀렸으면 → 재고실사</button>' : ''}
                <span class="text-[11px] text-amber-800">오늘 날짜로 조정 전표(제품·자재 '재고조사', 원료 '조정')를 넣어 수불부 재고를 창고 재고와 같게 합니다. 창고 재고는 바뀌지 않습니다.</span>
            </div>` : ''}
            <div class="overflow-auto max-h-[65vh] border border-slate-200 rounded-xl"><table class="w-full text-xs" id="sc-table"></table></div>
        </div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    const view = () => rows.filter(r => (kind === 'ALL' || r.kind === kind) && (loc === 'ALL' || r.loc === loc)
        && (!only || Math.abs(r.diff) > tol) && (!q || matchesQuery(r, q, ['code', 'name', 'loc'])))
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    const drawSafety = () => {
        const s = safetyShortages();
        $('#sc-safety').innerHTML = s.length ? `<div class="flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-teal-50 border border-teal-200 text-xs">
            <span class="font-black text-teal-900">🛒 안전재고 미달 구매 품목 ${s.length}개</span>
            <span class="text-teal-800 truncate max-w-[50vw]">${esc(s.slice(0, 4).map(x => `${x.name} ${fmt(x.current)}/${fmt(x.safety)}`).join(' · '))}${s.length > 4 ? ` 외 ${s.length - 4}` : ''}</span>
            ${canAccessTab('purchRequest') ? '<button type="button" id="sc-safety-draft" class="ml-auto px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-black">구매요청서 초안 만들기</button>' : ''}</div>` : '';
        $('#sc-safety-draft')?.addEventListener('click', () => { const n = openSafetyPurchaseDraft(onSwitchTab); showToast(`🛒 안전재고 미달 ${n}품목으로 구매요청서 초안을 열었습니다.`); });
    };

    const draw = () => {
        container.querySelectorAll('.sc-kind').forEach(b => { b.className = `sc-kind tap-compact px-3 py-1.5 rounded-lg font-black ${b.dataset.k === kind ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-600'}`; });
        const locs = [...new Set(rows.filter(r => kind === 'ALL' || r.kind === kind).map(r => r.loc))].sort();
        if (loc !== 'ALL' && !locs.includes(loc)) loc = 'ALL';
        $('#sc-loc').innerHTML = `<option value="ALL">전체 거점</option>${locs.map(l => `<option ${l === loc ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
        const scope = rows.filter(r => kind === 'ALL' || r.kind === kind);
        const diffRows = scope.filter(r => Math.abs(r.diff) > tol);
        const card = (l, v, cls = 'text-slate-900', sub = '') => `<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><div class="text-[11px] font-bold text-slate-500">${l}</div><div class="text-xl font-black ${cls}">${v}</div>${sub ? `<div class="text-[10px] text-slate-400">${sub}</div>` : ''}</div>`;
        $('#sc-kpi').innerHTML = [card('점검 품목·거점', `${scope.length}건`), card('일치', `${scope.length - diffRows.length}건`, 'text-emerald-700', `허용 오차 ${tol}`),
            card('차이 있음', `${diffRows.length}건`, diffRows.length ? 'text-rose-600' : 'text-slate-900', `창고 > 수불부 ${diffRows.filter(r => r.diff > 0).length} · 창고 < 수불부 ${diffRows.filter(r => r.diff < 0).length}`),
            card('수불부에만 있음', `${scope.filter(r => r.onlyLedger && Math.abs(r.diff) > tol).length}건`, 'text-amber-600', '창고 재고 0'),
            card('창고에만 있음', `${scope.filter(r => r.onlyInv && Math.abs(r.diff) > tol).length}건`, 'text-amber-600', '수불부 전표 없음')].join('');
        const list = view();
        const shown = list.slice(0, 1000);
        [...picked].forEach(k => { if (!list.some(r => r.key === k)) picked.delete(k); });
        $('#sc-table').innerHTML = `<thead class="bg-slate-50 text-slate-600 font-bold sticky top-0 z-10"><tr>
            ${canFix ? `<th class="p-2 w-8"><input type="checkbox" id="sc-all" ${shown.length && shown.every(r => picked.has(r.key) || Math.abs(r.diff) <= 0) ? 'checked' : ''} /></th>` : ''}
            <th class="p-2 text-left">분류</th><th class="p-2 text-left">품목코드</th><th class="p-2 text-left">품목명</th><th class="p-2 text-left">거점·지역</th>
            <th class="p-2 text-right">수불부 재고</th><th class="p-2 text-right">창고 재고</th><th class="p-2 text-right">차이 (창고−수불부)</th><th class="p-2 text-left">단위</th><th class="p-2 text-left">수불부 최종일자</th></tr></thead>
            <tbody class="divide-y divide-slate-100">${shown.map(r => {
                const bad = Math.abs(r.diff) > tol;
                return `<tr class="${bad ? 'bg-rose-50/40' : ''}">
                ${canFix ? `<td class="p-2"><input type="checkbox" class="sc-pick" data-k="${esc(r.key)}" ${picked.has(r.key) ? 'checked' : ''} ${bad ? '' : 'disabled'} /></td>` : ''}
                <td class="p-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${r.kind === 'raw' ? 'bg-emerald-50 text-emerald-700' : r.kind === 'product' ? 'bg-sky-50 text-sky-700' : 'bg-indigo-50 text-indigo-700'}">${STOCK_KINDS[r.kind]}</span></td>
                <td class="p-2 font-mono text-blue-700 whitespace-nowrap">${esc(r.code || '-')}</td><td class="p-2 font-bold text-slate-900">${esc(r.name)}${r.onlyLedger ? ' <span class="text-[10px] text-amber-600 font-bold">창고 없음</span>' : r.onlyInv ? ' <span class="text-[10px] text-amber-600 font-bold">수불부 없음</span>' : ''}</td>
                <td class="p-2 whitespace-nowrap">${esc(r.loc)}</td>
                <td class="p-2 text-right font-mono">${fmt(r.ledger)}</td><td class="p-2 text-right font-mono">${fmt(r.inv)}</td>
                <td class="p-2 text-right font-mono font-black ${!bad ? 'text-slate-400' : r.diff > 0 ? 'text-blue-700' : 'text-rose-600'}">${r.diff > 0 ? '+' : ''}${fmt(r.diff)}</td>
                <td class="p-2">${esc(r.unit)}</td><td class="p-2 font-mono text-slate-500">${esc(r.lastDate || '-')}</td></tr>`;
            }).join('') || `<tr><td colspan="10" class="p-8 text-center text-slate-400 font-bold">${only ? '✅ 차이 나는 품목이 없습니다.' : '비교할 품목이 없습니다.'}</td></tr>`}</tbody>
            ${list.length > 1000 ? `<tfoot><tr><td colspan="10" class="p-2 text-center text-slate-400">앞 1,000줄만 보입니다 (전체 ${list.length}줄, 엑셀로 모두 받기)</td></tr></tfoot>` : ''}`;
        const paintPicked = () => { const el = $('#sc-picked'); if (el) el.textContent = picked.size; const b = $('#sc-align'); if (b) b.disabled = !picked.size; };
        container.querySelectorAll('.sc-pick').forEach(c => c.addEventListener('change', () => { if (c.checked) picked.add(c.dataset.k); else picked.delete(c.dataset.k); paintPicked(); }));
        $('#sc-all')?.addEventListener('change', (e) => { shown.filter(r => Math.abs(r.diff) > tol).forEach(r => { if (e.target.checked) picked.add(r.key); else picked.delete(r.key); }); draw(); });
        paintPicked();
        createIcons({ icons });
    };

    const load = () => { rows = computeStockDiff(); picked.clear(); drawSafety(); draw(); };

    container.querySelectorAll('.sc-kind').forEach(b => b.addEventListener('click', () => { kind = b.dataset.k; save(); draw(); }));
    $('#sc-loc').addEventListener('change', (e) => { loc = e.target.value; draw(); });
    $('#sc-only').addEventListener('change', (e) => { only = e.target.checked; save(); draw(); });
    $('#sc-tol').addEventListener('change', (e) => { tol = Math.max(0, Number(e.target.value) || 0); save(); draw(); });
    let qt = null;
    $('#sc-q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { q = e.target.value.trim(); draw(); }, 200); });
    $('#sc-refresh').addEventListener('click', () => { load(); showToast('🔄 다시 계산했습니다.'); });
    $('#sc-audit')?.addEventListener('click', () => onSwitchTab('audit'));
    $('#sc-align')?.addEventListener('click', async () => {
        const sel = rows.filter(r => picked.has(r.key) && Math.abs(r.diff) > 0);
        if (!sel.length) return;
        const text = sel.slice(0, 12).map(r => `· [${STOCK_KINDS[r.kind]}] ${r.name} ${r.loc}: 수불부 ${fmt(r.ledger)} → ${fmt(r.inv)} ${r.unit} (${r.diff > 0 ? '+' : ''}${fmt(r.diff)})`).join('\n');
        if (!confirm(`수불부 ${sel.length}줄을 창고 재고에 맞춥니다 (오늘 날짜 조정 전표 추가, 창고 재고는 그대로).\n\n${text}${sel.length > 12 ? `\n· 외 ${sel.length - 12}줄` : ''}\n\n진행할까요?`)) return;
        const btn = $('#sc-align'); btn.disabled = true;
        try {
            const r = await alignLedgerToInventory(sel);
            showToast(`✅ 조정 전표를 넣었습니다: 원료 ${r.raw} · 제품 ${r.product} · 자재 ${r.material}줄`);
            load();
        } catch (e) { alert(`맞추지 못했습니다: ${e.message}`); btn.disabled = false; }
    });
    $('#sc-xlsx').addEventListener('click', () => {
        const data = view().map((r, i) => ({ 순번: i + 1, 분류: STOCK_KINDS[r.kind], 품목코드: r.code, 품목명: r.name, '거점·지역': r.loc, 수불부재고: r.ledger, 창고재고: r.inv, '차이(창고-수불부)': r.diff, 단위: r.unit, 수불부최종일자: r.lastDate, 비고: r.onlyLedger ? '창고 없음' : r.onlyInv ? '수불부 없음' : '' }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), '재고차이점검');
        const file = `대림오일_재고차이점검_${localDateStr()}.xlsx`;
        XLSX.writeFile(wb, file);
        showToast(`📊 '${file}'를 저장했습니다.`);
    });
    createIcons({ icons });
    load();
};
