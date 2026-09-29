// 주문(생산요청서) 한 건의 필요 원부자재 창 — 주문관리 카드의 🧪 배지 · 생산요청서 [소요 원부자재] (services/orderMaterials.js)
import { esc } from '../services/html.js';
import { ORDER_MAT_STATUS } from '../services/orderMaterials.js';

const fmtN = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });

/**
 * @param head { docNo, partner, due }
 * @param m computeOrderMaterials(...).orders.get(id)
 * @param note 표 위 설명
 */
export const openOrderMatDialog = (head, m, note = '') => {
    if (!m) return;
    const st = ORDER_MAT_STATUS[m.status] || ORDER_MAT_STATUS.NO_BOM;
    const w = document.createElement('div');
    w.className = 'fixed inset-0 z-[80] bg-slate-900/50 flex items-center justify-center p-3';
    w.innerHTML = `<div class="bg-white w-full max-w-3xl rounded-2xl shadow-2xl max-h-[90vh] flex flex-col text-xs">
        <div class="px-4 py-3 border-b flex items-center justify-between gap-2"><h3 class="font-black text-sm">🧪 ${esc(head.docNo || '새 요청서')} ${esc(head.partner || '')} 필요 원부자재 <span class="px-1.5 py-0.5 rounded text-[10px] ${st.cls}">${st.label}</span></h3><button type="button" class="md-x text-lg text-slate-400">✕</button></div>
        <div class="p-4 overflow-auto space-y-2">
            <p class="text-slate-500">납기 ${esc(head.due || '-')} · ${esc(m.site || '')} 거점 · ${esc(note || '납기가 더 빠른 주문에 재고를 먼저 배정한 뒤의 결과입니다.')} 원액·원료는 원료수불부(L), 부자재는 자재수불부 재고 기준. 원액의 원료 배합은 보안이라 계산하지 않습니다.</p>
            ${m.missing ? `<div class="p-2 rounded bg-amber-50 text-amber-800 font-bold">⚠️ BOM(배합비·포장사용기준서)이 없는 품목 ${m.missing}개는 계산에서 빠졌습니다. 제품생산/입고의 배합비 저장이나 포장사용기준서로 등록하세요.</div>` : ''}
            <table class="w-full"><thead class="bg-slate-50 text-slate-600"><tr><th class="p-1.5 text-left">원부자재</th><th class="p-1.5 text-right">필요</th><th class="p-1.5 text-right">재고에서</th><th class="p-1.5 text-right">구매 계획</th><th class="p-1.5 text-right">원액 생산</th><th class="p-1.5 text-right">부족</th><th class="p-1.5 text-left">단위</th></tr></thead>
            <tbody class="divide-y divide-slate-100">${(m.lines || []).map(l => `<tr class="${l.short > 0 ? 'bg-rose-50' : ''}"><td class="p-1.5"><b>${esc(l.name)}</b> <span class="text-slate-400 font-mono">${esc(l.code)}</span><div class="text-[10px] text-slate-400">${esc(l.category)} · ${esc(l.from.join(', '))}</div></td>
                <td class="p-1.5 text-right font-black">${fmtN(l.need)}</td><td class="p-1.5 text-right text-emerald-700">${fmtN(l.fromStock)}</td><td class="p-1.5 text-right text-amber-700">${l.fromBuy ? fmtN(l.fromBuy) : ''}</td><td class="p-1.5 text-right text-cyan-700">${l.fromProd ? fmtN(l.fromProd) : ''}</td>
                <td class="p-1.5 text-right font-black ${l.short > 0 ? 'text-rose-600' : 'text-slate-300'}">${l.short > 0 ? fmtN(l.short) : '-'}</td><td class="p-1.5">${esc(l.unit)}</td></tr>`).join('') || '<tr><td colspan="7" class="p-6 text-center text-slate-400">BOM이 없어 계산할 원부자재가 없습니다.</td></tr>'}</tbody></table>
        </div></div>`;
    document.body.appendChild(w);
    w.addEventListener('mousedown', (e) => { if (e.target === w) w.remove(); });
    w.querySelector('.md-x').addEventListener('click', () => w.remove());
};
