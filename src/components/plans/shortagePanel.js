import { computeShortage, applyShortages, PLAN_SITES } from '../../services/plans.js';
import { hasWorklogAccess, canPerformAction } from '../../services/auth.js';
import { loadSecureData, secure } from '../../services/secureWorkOrders.js';
import { createIcons, icons } from '../../services/icons.js';
import { esc } from '../../services/html.js';
import { fmtQty, btn } from './planCommon.js';

// 원액 생산에 드는 원료는 보안 시방서로만 계산한다 (마스터·작업일지 관리자만)
export const loadRecipesIfAllowed = async () => {
    if (!hasWorklogAccess()) return null;
    try { await loadSecureData(); return secure.recipes; } catch (e) { console.warn('[계획] 시방서를 불러오지 못했습니다:', e.message); return null; }
};

// 부족량 패널. prodLines·purchLines: 같은 기간의 줄, onApplied: 반영 뒤 다시 불러오기
export const renderShortagePanel = async (host, { prodLines, purchLines, site = '', title = '원액·원부자재 재고 확인 (수불부 기준)', showToast, onApplied, onlyPurchase = false }) => {
    host.innerHTML = '<div class="p-6 text-center text-xs text-slate-400">재고를 확인하는 중...</div>';
    const recipes = await loadRecipesIfAllowed();
    const { rows, missingBom, noRecipe } = computeShortage({ prodLines, purchLines, recipes, site });
    const shortRaw = rows.filter(r => r.short > 0 && r.target === 'PROD');
    const shortBuy = rows.filter(r => r.short > 0 && r.target === 'PURCH');
    const canEdit = canPerformAction('MRP_PLANNING');
    const catCls = (c) => (c === '원액' ? 'bg-purple-100 text-purple-800' : c === '원료' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800');

    host.innerHTML = `
        <div class="space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="scale" class="w-4 h-4 text-rose-600"></i>${esc(title)}${site ? ` · ${esc(site)}` : ''}</h3>
                <div class="flex flex-wrap gap-2">
                    ${onlyPurchase ? '' : `<button type="button" id="sp-apply-prod" ${canEdit && shortRaw.length ? '' : 'disabled'} class="${btn(canEdit && shortRaw.length ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed')}">
                        <i data-lucide="flask-conical" class="w-4 h-4"></i>부족 원액 → 원액 생산계획 반영 (${shortRaw.length})</button>`}
                    <button type="button" id="sp-apply-buy" ${canEdit && shortBuy.length ? '' : 'disabled'} class="${btn(canEdit && shortBuy.length ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed')}">
                        <i data-lucide="shopping-cart" class="w-4 h-4"></i>부족 원부자재 → 구매계획 반영 (${shortBuy.length})</button>
                </div>
            </div>
            <p class="text-[11px] text-slate-500">필요량 = 계획 수량 × BOM(원액·부자재) / 원액 생산의 원료는 보안 제조시방서. 공급 = 수불부 재고 + 이 기간에 이미 계획된 원액 생산·구매. 모자라면 <b class="text-rose-600">부족</b>으로 표시합니다.</p>
            ${missingBom.length ? `<div class="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900"><b>BOM이 없어 소요량을 계산하지 못한 제품 ${missingBom.length}건:</b> ${esc([...new Set(missingBom.map(l => `${l.name || l.code}`))].slice(0, 12).join(', '))}${missingBom.length > 12 ? ' …' : ''}
                <div class="mt-0.5">→ 제품생산 / 입고 화면에서 그 제품의 원액·부자재를 넣고 <b>배합비 저장</b>을 누르면 계산됩니다.</div></div>` : ''}
            ${noRecipe.length ? `<div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600">원액 생산 ${noRecipe.length}건의 원료 소요는 ${hasWorklogAccess() ? '연결된 제조시방서(원액 품목코드)가 없어' : '보안 제조시방서 권한(마스터·작업일지 관리자)이 있어야'} 계산됩니다.</div>` : ''}
            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs">
                    <thead class="bg-slate-100 text-slate-600"><tr>
                        <th class="p-2 text-left">구분</th><th class="p-2 text-left">품목</th><th class="p-2 text-left">거점</th>
                        <th class="p-2 text-right">필요량</th><th class="p-2 text-right">재고 (수불부)</th><th class="p-2 text-right">계획 공급</th>
                        <th class="p-2 text-right">부족량</th><th class="p-2 text-left">반영 대상 / 참고</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length === 0 ? '<tr><td colspan="8" class="p-6 text-center text-slate-400">계산할 계획 줄이 없거나 BOM이 없습니다.</td></tr>' : rows.map(r => `
                        <tr class="${r.short > 0 ? 'bg-rose-50/60' : ''}">
                            <td class="p-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${catCls(r.category)}">${esc(r.category || '-')}</span></td>
                            <td class="p-2"><div class="font-mono text-blue-600">${esc(r.code)}</div><div class="font-bold">${esc(r.name)}</div></td>
                            <td class="p-2">${esc(r.site)}</td>
                            <td class="p-2 text-right font-bold">${fmtQty(r.need)} <span class="text-[10px] text-slate-400">${esc(r.unit)}</span></td>
                            <td class="p-2 text-right" title="${esc(r.stockFrom)}">${fmtQty(r.stock)}</td>
                            <td class="p-2 text-right text-slate-600">${r.plannedProd ? `생산 ${fmtQty(r.plannedProd)}` : ''}${r.plannedProd && r.plannedBuy ? '<br>' : ''}${r.plannedBuy ? `구매 ${fmtQty(r.plannedBuy)}` : ''}${!r.plannedProd && !r.plannedBuy ? '-' : ''}</td>
                            <td class="p-2 text-right font-black ${r.short > 0 ? 'text-rose-600' : 'text-emerald-600'}">${r.short > 0 ? fmtQty(r.short) : '충분'}</td>
                            <td class="p-2 text-[11px] text-slate-500">${r.short > 0 ? (r.target === 'PROD' ? '🧪 원액 생산계획' : '🛒 구매계획') : ''}${r.others.length ? `<div>다른 거점 재고: ${esc(r.others.map(o => `${o.site} ${fmtQty(o.qty)}`).join(', '))} (거점이동 검토)</div>` : ''}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    createIcons({ icons });

    const apply = async (kind, list, label) => {
        if (!confirm(`${label} ${list.length}건을 계획에 반영할까요?\n\n${list.slice(0, 15).map(r => `· ${r.name} (${r.site}) ${fmtQty(r.short)} ${r.unit}`).join('\n')}${list.length > 15 ? '\n…' : ''}\n\n같은 품목의 '부족 연동' 줄이 이미 있으면 수량을 더합니다.`)) return;
        try {
            const res = await applyShortages(kind, list);
            showToast(`✅ ${label} ${res.count}건을 ${kind === 'PROD_WEEK' ? '원액 생산계획' : '구매계획'}에 반영했습니다. (${res.weeks.length}개 주)`);
            onApplied?.();
        } catch (err) {
            alert(err.message);
        }
    };
    host.querySelector('#sp-apply-prod')?.addEventListener('click', () => apply('PROD_WEEK', shortRaw, '부족 원액'));
    host.querySelector('#sp-apply-buy')?.addEventListener('click', () => apply('PURCH_WEEK', shortBuy, '부족 원부자재'));
    return { rows, shortRaw, shortBuy };
};

export const shortagePrintRows = (rows) => rows.filter(r => r.short > 0);
export { PLAN_SITES };
