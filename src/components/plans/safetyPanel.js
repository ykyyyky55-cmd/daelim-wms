import { safetyShortages, addLinesToWeeks, PLAN_SITES } from '../../services/plans.js';
import { canPerformAction } from '../../services/auth.js';
import { createIcons, icons } from '../../services/icons.js';
import { esc } from '../../services/html.js';
import { fmtQty, btn } from './planCommon.js';

// 생산계획 아래: 제품 안전재고 부족 목록 → 골라서 생산계획 줄로 반영
// prodLines: 보고 있는 기간의 생산계획 줄 (이미 계획된 수량을 빼고 제안), dates: 넣을 수 있는 날짜 [[값, 표시]], defaultDate
export const renderSafetyPanel = (host, { prodLines, dates, defaultDate, site = '', showToast, onApplied, beforeApply = () => true }) => {
    const rows = safetyShortages(prodLines);
    const canEdit = canPerformAction('MRP_PLANNING');
    const pick = new Map(rows.filter(r => r.suggest > 0).map(r => [r.code, { qty: r.suggest, site: site || '본사', date: defaultDate }]));
    host.innerHTML = `
        <div class="space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="shield-alert" class="w-4 h-4 text-amber-600"></i>제품 안전재고 부족 <span class="text-[11px] font-bold text-slate-400">(${rows.length}품목 · 모든 창고 합계 재고 ≤ 안전재고)</span></h3>
                <button type="button" id="sf-apply" ${canEdit && rows.length ? '' : 'disabled'} class="${btn(canEdit && rows.length ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed')}">
                    <i data-lucide="list-plus" class="w-4 h-4"></i>선택 품목 생산계획에 반영</button>
            </div>
            <p class="text-[11px] text-slate-500">제안 수량 = 안전재고 − 현재고 − 이 기간 생산계획 수량. 체크한 품목을 고른 날짜·거점의 생산계획 줄(출처 <b>안전재고</b>)로 넣습니다. 제안 수량이 0인 품목은 이미 계획에 충분히 들어 있습니다.</p>
            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs">
                    <thead class="bg-slate-100 text-slate-600"><tr>
                        <th class="p-2 w-8"><input type="checkbox" id="sf-all" ${canEdit ? '' : 'disabled'} /></th>
                        <th class="p-2 text-left">제품</th><th class="p-2 text-right">안전재고</th><th class="p-2 text-right">현재고 (합계)</th><th class="p-2 text-left">거점별 (수불부)</th>
                        <th class="p-2 text-right">이미 계획</th><th class="p-2 text-right" style="min-width:90px">반영 수량</th><th class="p-2 text-left" style="min-width:110px">날짜</th><th class="p-2 text-left" style="min-width:80px">거점</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length === 0 ? '<tr><td colspan="9" class="p-6 text-center text-slate-400">안전재고가 부족한 제품이 없습니다. (품목 마스터에 안전재고를 넣은 완제품만 봅니다)</td></tr>' : rows.map(r => {
                            const p = pick.get(r.code) || { qty: 0, site: site || '본사', date: defaultDate };
                            return `<tr class="${r.suggest > 0 ? 'bg-amber-50/50' : 'opacity-60'}" data-code="${esc(r.code)}">
                                <td class="p-2 text-center"><input type="checkbox" class="sf-chk" ${pick.has(r.code) ? 'checked' : ''} ${canEdit ? '' : 'disabled'} /></td>
                                <td class="p-2"><div class="font-mono text-blue-600">${esc(r.code)}</div><div class="font-bold">${esc(r.name)}</div>${r.spec ? `<div class="text-[10px] text-slate-400">${esc(r.spec)}</div>` : ''}</td>
                                <td class="p-2 text-right">${fmtQty(r.safety)}</td>
                                <td class="p-2 text-right font-black ${r.stock <= 0 ? 'text-rose-600' : 'text-amber-700'}">${fmtQty(r.stock)}</td>
                                <td class="p-2 text-[11px] text-slate-500">${r.bySite.map(b => `${esc(b.site)} ${fmtQty(b.qty)}`).join(' · ')}</td>
                                <td class="p-2 text-right text-slate-600">${r.planned ? fmtQty(r.planned) : '-'}</td>
                                <td class="p-2"><input type="number" min="0" step="any" class="sf-qty w-full border border-slate-300 rounded-md px-1.5 py-1 text-right font-black" value="${p.qty || r.suggest}" ${canEdit ? '' : 'disabled'} /></td>
                                <td class="p-2"><select class="sf-date w-full border border-slate-300 rounded-md px-1 py-1 font-bold" ${canEdit ? '' : 'disabled'}>${dates.map(([v, t]) => `<option value="${v}" ${v === p.date ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
                                <td class="p-2"><select class="sf-site w-full border border-slate-300 rounded-md px-1 py-1 font-bold" ${canEdit ? '' : 'disabled'}>${PLAN_SITES.map(s => `<option ${s === p.site ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    createIcons({ icons });
    host.querySelector('#sf-all')?.addEventListener('change', (e) => host.querySelectorAll('.sf-chk').forEach(c => { c.checked = e.target.checked; }));
    host.querySelector('#sf-apply')?.addEventListener('click', async () => {
        const chosen = [...host.querySelectorAll('tbody tr[data-code]')].filter(tr => tr.querySelector('.sf-chk').checked).map(tr => {
            const r = rows.find(x => x.code === tr.dataset.code);
            return { r, qty: Number(tr.querySelector('.sf-qty').value) || 0, date: tr.querySelector('.sf-date').value, site: tr.querySelector('.sf-site').value };
        }).filter(x => x.qty > 0);
        if (!chosen.length) { alert('반영할 품목을 체크하고 수량을 넣으세요.'); return; }
        if (!beforeApply()) return;
        if (!confirm(`안전재고 부족 제품 ${chosen.length}건을 생산계획에 넣을까요?\n\n${chosen.map(x => `· ${x.date} ${x.site} ${x.r.name} ${fmtQty(x.qty)} ${x.r.unit}`).join('\n')}`)) return;
        try {
            const weeks = await addLinesToWeeks('PROD_WEEK', chosen.map(x => ({
                date: x.date, site: x.site, type: '완제품', code: x.r.code, name: x.r.name, spec: x.r.spec, qty: x.qty, unit: x.r.unit,
                line: '', partner: '', due: '', source: 'SAFETY', status: 'PLAN', note: `안전재고 보충 (안전재고 ${fmtQty(x.r.safety)} / 재고 ${fmtQty(x.r.stock)})`
            })));
            showToast(`✅ 안전재고 부족 제품 ${chosen.length}건을 생산계획에 넣었습니다. (${weeks.length}개 주)`);
            onApplied?.();
        } catch (e) { alert(e.message); }
    });
};
