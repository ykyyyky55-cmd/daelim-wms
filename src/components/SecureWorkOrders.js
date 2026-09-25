import { state } from '../services/db.js';
import { localDateStr, matchesQuery } from '../services/searchUtils.js';
import { locationOptionsHtml } from '../services/locations.js';
import { hasWorklogAccess } from '../services/auth.js';
import {
    secure, loadSecureData, saveRecipe, deleteRecipe, saveSecureOrder, deleteSecureOrder,
    nextOrderNo, scaleMaterials, completeSecureOrder
} from '../services/secureWorkOrders.js';
import { parseSpecWorkbook } from '../services/specImport.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 3) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const STATUS = {
    DRAFT: { label: '작성 중', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
    ISSUED: { label: '발행', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    COMPLETED: { label: '생산 완료', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    CANCELLED: { label: '취소', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
};
const statusBadge = (s) => `<span class="inline-block whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-extrabold border ${STATUS[s]?.cls || ''}">${STATUS[s]?.label || esc(s)}</span>`;
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯';

/**
 * 원액생산 작업지시서 (특별보안) — 마스터·작업일지 관리자 전용
 * - 작업지시서: 제조시방서를 골라 생산량만큼 원료 소요량을 산출해 발행·보관·인쇄(원료코드로만 표기)·생산 완료 처리
 * - 제조시방서: 엑셀(제조시방서+작업일지 양식) 가져오기, 원료코드·품목코드 연결 관리
 */
export const renderSecureWorkOrders = async (container, { showToast }) => {
    if (!hasWorklogAccess()) {
        container.innerHTML = `<div class="p-8 text-center text-rose-600 font-black">🔒 접근 권한이 없습니다. 마스터 관리자에게 '작업일지 관리자' 권한을 요청하세요.</div>`;
        return;
    }
    let tab = 'orders';
    let statusFilter = '';
    let query = '';

    container.innerHTML = `<div class="p-10 text-center text-slate-400 font-bold">🔒 보안 자료를 불러오는 중...</div>`;
    try {
        await loadSecureData();
    } catch (e) {
        container.innerHTML = `<div class="p-8 text-center text-rose-600 font-black">${esc(e.message)}</div>`;
        return;
    }

    const rawItems = state.master.filter(m => m.category === '원료' || m.category === '원액');
    const wonaekItems = state.master.filter(m => m.category === '원액');

    const render = () => {
        container.innerHTML = `
        <div class="space-y-5">
            <div class="bg-gradient-to-br from-amber-950 via-slate-900 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-400/20 text-amber-200 border border-amber-300/40">🔒 특별보안 · 마스터 / 작업일지 관리자 전용</span>
                        <h2 class="text-xl font-black mt-2 flex items-center gap-2"><i data-lucide="flask-round" class="w-5 h-5"></i><span>원액생산 작업지시서</span></h2>
                        <p class="text-xs text-slate-300 mt-1">제조시방서(배합)를 기준으로 작업지시서를 발행·보관합니다. 인쇄물에는 원료 실명 대신 원료코드만 표기됩니다.</p>
                    </div>
                    <div class="flex bg-white/10 p-1 rounded-xl text-xs font-bold">
                        <button type="button" class="sw-tab px-4 py-2 rounded-lg ${tab === 'orders' ? 'bg-white text-slate-900' : 'text-slate-200 hover:bg-white/10'}" data-tab="orders">작업지시서 (${secure.orders.length})</button>
                        <button type="button" class="sw-tab px-4 py-2 rounded-lg ${tab === 'recipes' ? 'bg-white text-slate-900' : 'text-slate-200 hover:bg-white/10'}" data-tab="recipes">제조시방서 (${secure.recipes.length})</button>
                    </div>
                </div>
            </div>
            <div id="sw-body"></div>
        </div>
        <div id="sw-modal" class="fixed inset-0 bg-slate-900/60 z-50 hidden items-start justify-center p-4 overflow-y-auto"></div>`;
        container.querySelectorAll('.sw-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
        if (tab === 'orders') renderOrders(); else renderRecipes();
        createIcons({ icons });
    };

    const $ = (s) => container.querySelector(s);
    const modal = () => $('#sw-modal');
    const openModal = (html) => { const m = modal(); m.innerHTML = html; m.classList.remove('hidden'); m.classList.add('flex'); createIcons({ icons }); };
    const closeModal = () => { const m = modal(); m.classList.add('hidden'); m.classList.remove('flex'); m.innerHTML = ''; };

    // ==========================================
    // 작업지시서 목록
    // ==========================================
    const renderOrders = () => {
        const rows = secure.orders.filter(o => (!statusFilter || o.status === statusFilter)
            && (!query || matchesQuery(o, query, ['orderNo', 'productName', 'lotNo', 'customer', 'author', 'worker'])));
        $('#sw-body').innerHTML = `
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 text-xs">
            <div class="flex flex-wrap items-center gap-2">
                <button type="button" id="sw-new-order" class="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black flex items-center gap-1"><i data-lucide="plus" class="w-4 h-4"></i>새 작업지시서</button>
                <select id="sw-status" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                    <option value="">전체 상태</option>
                    ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${statusFilter === k ? 'selected' : ''}>${v.label}</option>`).join('')}
                </select>
                <input type="text" id="sw-q" value="${esc(query)}" placeholder="지시번호·제품명·Lot·납품처 검색" class="flex-1 min-w-[180px] bg-white border border-slate-300 rounded-lg px-2.5 py-1.5" />
            </div>
            ${secure.recipes.length === 0 ? '<div class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 font-bold">등록된 제조시방서가 없습니다. [제조시방서] 탭에서 엑셀을 가져온 뒤 작업지시서를 발행하세요.</div>' : ''}
            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full">
                    <thead class="bg-slate-50 text-slate-600 font-bold"><tr>
                        <th class="p-2.5 text-left whitespace-nowrap">지시번호</th><th class="p-2.5 text-left whitespace-nowrap">제조일자</th>
                        <th class="p-2.5 text-left">제품명 / 관련근거</th><th class="p-2.5 text-right whitespace-nowrap">생산량</th>
                        <th class="p-2.5 text-left whitespace-nowrap">Lot No.</th><th class="p-2.5 text-left">납품처</th>
                        <th class="p-2.5 text-center whitespace-nowrap">상태</th><th class="p-2.5 text-center whitespace-nowrap">관리</th>
                    </tr></thead>
                    <tbody class="divide-y divide-slate-100">
                    ${rows.length === 0 ? '<tr><td colspan="8" class="p-8 text-center text-slate-400 font-bold">작업지시서가 없습니다.</td></tr>' : rows.map(o => `
                        <tr class="hover:bg-slate-50">
                            <td class="p-2.5 font-mono font-black text-amber-800 whitespace-nowrap">${esc(o.orderNo)}</td>
                            <td class="p-2.5 font-mono whitespace-nowrap">${esc(o.mfgDate || '-')}</td>
                            <td class="p-2.5"><div class="font-bold text-slate-900">${esc(o.productName)}</div><div class="text-[10px] text-slate-400">${esc(o.revision || '')}</div></td>
                            <td class="p-2.5 text-right font-mono font-bold whitespace-nowrap">${fmt(o.prodQty)} ${esc(o.prodUnit || 'D/M')}${o.actualQty ? `<div class="text-[10px] text-emerald-700">실 ${fmt(o.actualQty)}</div>` : ''}</td>
                            <td class="p-2.5 font-mono whitespace-nowrap">${esc(o.lotNo || '-')}</td>
                            <td class="p-2.5">${esc(o.customer || '-')}</td>
                            <td class="p-2.5 text-center">${statusBadge(o.status)}</td>
                            <td class="p-2.5 text-center whitespace-nowrap">
                                <button type="button" class="sw-print p-1 text-slate-500 hover:text-slate-900" data-id="${esc(o.id)}" title="작업일지 인쇄"><i data-lucide="printer" class="w-4 h-4"></i></button>
                                <button type="button" class="sw-edit p-1 text-slate-500 hover:text-blue-600" data-id="${esc(o.id)}" title="수정·검사 결과 입력"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                                ${o.status === 'ISSUED' || o.status === 'DRAFT' ? `<button type="button" class="sw-complete p-1 text-slate-500 hover:text-emerald-600" data-id="${esc(o.id)}" title="생산 완료 처리"><i data-lucide="check-circle-2" class="w-4 h-4"></i></button>
                                <button type="button" class="sw-cancel p-1 text-slate-500 hover:text-rose-600" data-id="${esc(o.id)}" title="취소"><i data-lucide="ban" class="w-4 h-4"></i></button>` : ''}
                                ${o.status !== 'COMPLETED' ? `<button type="button" class="sw-del p-1 text-slate-400 hover:text-rose-600" data-id="${esc(o.id)}" title="삭제"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
                            </td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
        $('#sw-new-order').addEventListener('click', () => {
            if (secure.recipes.filter(r => r.active).length === 0) { alert('사용 중인 제조시방서가 없습니다. 먼저 [제조시방서] 탭에서 엑셀을 가져오세요.'); return; }
            openOrderEditor(null);
        });
        $('#sw-status').addEventListener('change', (e) => { statusFilter = e.target.value; renderOrders(); createIcons({ icons }); });
        let t = null;
        $('#sw-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { query = e.target.value.trim(); renderOrders(); createIcons({ icons }); const q = $('#sw-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); });
        const byId = (id) => secure.orders.find(o => o.id === id);
        container.querySelectorAll('.sw-print').forEach(b => b.addEventListener('click', () => printWorkLog(byId(b.dataset.id))));
        container.querySelectorAll('.sw-edit').forEach(b => b.addEventListener('click', () => openOrderEditor(byId(b.dataset.id))));
        container.querySelectorAll('.sw-complete').forEach(b => b.addEventListener('click', () => openCompleteModal(byId(b.dataset.id))));
        container.querySelectorAll('.sw-cancel').forEach(b => b.addEventListener('click', async () => {
            const o = byId(b.dataset.id);
            if (!confirm(`[${o.orderNo}] 작업지시서를 취소하시겠습니까?`)) return;
            await run(() => saveSecureOrder({ ...o, status: 'CANCELLED' }), '작업지시서를 취소했습니다.');
        }));
        container.querySelectorAll('.sw-del').forEach(b => b.addEventListener('click', async () => {
            const o = byId(b.dataset.id);
            if (!confirm(`[${o.orderNo}] 작업지시서를 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
            await run(() => deleteSecureOrder(o.id), '작업지시서를 삭제했습니다.');
        }));
    };

    const run = async (fn, okMsg) => {
        try {
            await fn();
            if (okMsg) showToast(`🔒 ${okMsg}`);
            closeModal();
            render();
        } catch (e) {
            alert(e.message);
        }
    };

    // ==========================================
    // 작업지시서 작성·수정
    // ==========================================
    const HEADER_FIELDS = [
        ['marking', '5. MARKING'], ['qualityMark', '6. 품질표시'], ['grade', '7. 종호'], ['packaging', '8. 포장단위'],
        ['workInstruction', '10. 작업지시'], ['lotNo', '11. Lot No.'], ['customer', '12. 납품처']
    ];
    const RESULT_FIELDS = [
        ['adjustNotes', 'Adjust 내역'], ['processViscosity', '공정검사 ① 동점도'], ['stickerName', 'Sticker ① 품명'],
        ['volumeSg', '부피환산 ① SG'], ['volumeWt', '부피환산 ② WT'], ['packContainer', '포장검사 ① 포장용기'], ['packLeak', '포장검사 ② 누유'],
        ['verdict', '합부 판정'], ['worker', '작업자'], ['confirmer', '확인자'], ['workStatus', '나. 작업현황 및 내역']
    ];

    const openOrderEditor = (order) => {
        const isNew = !order;
        const activeRecipes = secure.recipes.filter(r => r.active || r.id === order?.recipeId);
        const o = order || {
            orderNo: nextOrderNo(), mfgDate: localDateStr(), prodQty: 1, prodUnit: activeRecipes[0]?.baseUnit || 'D/M',
            recipeId: activeRecipes[0]?.id, author: state.currentUser?.name || '', status: 'ISSUED'
        };
        const input = (id, label, value, extra = '') => `<label class="block"><span class="font-bold text-slate-600">${label}</span><input id="swo-${id}" value="${esc(value ?? '')}" ${extra} class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>`;
        openModal(`
        <form id="swo-form" class="bg-white rounded-2xl shadow-xl w-full max-w-4xl my-6 p-5 space-y-4 text-xs">
            <div class="flex items-center justify-between">
                <h3 class="font-black text-sm text-slate-900">🔒 ${isNew ? '새 원액생산 작업지시서' : `작업지시서 수정 · ${esc(o.orderNo)}`}</h3>
                <button type="button" class="swo-close text-slate-400 hover:text-slate-700"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                ${input('orderNo', 'NO. (지시번호)', o.orderNo, 'required')}
                <label class="block col-span-2"><span class="font-bold text-slate-600">1. 제품명 (제조시방서)</span>
                    <select id="swo-recipe" ${o.status === 'COMPLETED' ? 'disabled' : ''} class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                        ${activeRecipes.map(r => `<option value="${esc(r.id)}" ${r.id === o.recipeId ? 'selected' : ''}>${esc(r.productName)} · ${esc(r.revision || '-')}</option>`).join('')}
                    </select></label>
                ${input('mfgDate', '2. 제조일자', o.mfgDate, 'type="date"')}
                ${input('prodQty', '3. 생산량', o.prodQty, `type="number" min="0" step="any" required ${o.status === 'COMPLETED' ? 'disabled' : ''}`)}
                ${input('prodUnit', '생산량 단위', o.prodUnit || 'D/M')}
                ${input('actualQty', '4. 실생산량', o.actualQty ?? '', 'type="number" min="0" step="any"')}
                ${input('author', '작성자', o.author)}
                ${HEADER_FIELDS.map(([k, l]) => input(k, l, o[k])).join('')}
            </div>
            <div>
                <div class="flex items-center justify-between mb-1">
                    <span class="font-black text-slate-800">가. 작업표준 (원료 소요량 · 인쇄 시 원료코드로만 표기)</span>
                    <span id="swo-total" class="font-mono font-bold text-slate-500"></span>
                </div>
                <div class="overflow-x-auto border border-slate-200 rounded-xl"><table class="w-full"><thead class="bg-slate-50 font-bold text-slate-600"><tr>
                    <th class="p-2 text-left">순</th><th class="p-2 text-left">원료코드</th><th class="p-2 text-left text-amber-700">원료명 (대외비)</th>
                    <th class="p-2 text-right">L</th><th class="p-2 text-right">KG</th><th class="p-2 text-right">SG</th><th class="p-2 text-left">재고 품목 연결</th>
                </tr></thead><tbody id="swo-mats" class="divide-y divide-slate-100"></tbody></table></div>
                <div id="swo-std" class="mt-1 text-slate-500 font-bold"></div>
            </div>
            <details ${isNew ? '' : 'open'} class="border border-slate-200 rounded-xl p-3">
                <summary class="font-black text-slate-800 cursor-pointer">작업 결과 · 공정/제품 검사 (생산 후 입력)</summary>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-3">${RESULT_FIELDS.map(([k, l]) => input(k, l, o[k])).join('')}</div>
                <div id="swo-qc" class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5 mt-3"></div>
            </details>
            <label class="block"><span class="font-bold text-slate-600">비고</span><textarea id="swo-notes" rows="2" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5">${esc(o.notes || '')}</textarea></label>
            <div class="flex justify-end gap-2">
                <button type="button" class="swo-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button>
                <button type="submit" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black">${isNew ? '발행·저장' : '저장'}</button>
            </div>
        </form>`);

        const recipeSel = modal().querySelector('#swo-recipe');
        const qtyInput = modal().querySelector('#swo-prodQty');
        const currentRecipe = () => secure.recipes.find(r => r.id === recipeSel.value);
        const currentMats = () => {
            // 생산 완료된 지시서는 저장된 소요량 그대로, 그 밖에는 시방서 기준으로 다시 산출
            if (o.status === 'COMPLETED' && o.materials) return o.materials;
            const r = currentRecipe();
            return r ? scaleMaterials(r, qtyInput.value) : [];
        };
        const drawMats = () => {
            const r = currentRecipe();
            const mats = currentMats();
            modal().querySelector('#swo-mats').innerHTML = mats.map(m => {
                const item = m.itemCode ? state.master.find(x => x.code === m.itemCode) : null;
                return `<tr>
                    <td class="p-2 font-mono">${esc(m.seq)}</td>
                    <td class="p-2 font-mono font-black ${m.rawCode ? 'text-slate-900' : 'text-rose-600'}">${esc(m.rawCode || '원료코드 없음')}</td>
                    <td class="p-2 text-amber-800">${esc(m.name)}</td>
                    <td class="p-2 text-right font-mono font-bold">${fmt(m.liters)}</td>
                    <td class="p-2 text-right font-mono">${fmt(m.kg)}</td>
                    <td class="p-2 text-right font-mono">${fmt(m.sg, 4)}</td>
                    <td class="p-2 text-[10px] ${item ? 'text-emerald-700' : 'text-slate-400'}">${item ? `${esc(item.code)} ${esc(item.name)}` : '미연결 (재고 차감 안 함)'}</td>
                </tr>`;
            }).join('');
            const tl = mats.reduce((s, m) => s + (Number(m.liters) || 0), 0);
            const tk = mats.reduce((s, m) => s + (Number(m.kg) || 0), 0);
            modal().querySelector('#swo-total').textContent = `S-TOTAL ${fmt(tl)} L · ${fmt(tk)} KG`;
            modal().querySelector('#swo-std').textContent = r?.workStandard?.length ? `작업표준: ${r.workStandard.join(' / ')}` : '';
            const qc = (o.qcItems && o.status === 'COMPLETED' ? o.qcItems : r?.qcItems) || [];
            const results = o.qcResults || {};
            modal().querySelector('#swo-qc').innerHTML = qc.map(q => `
                <label class="flex items-center gap-2"><span class="w-6 text-slate-500">${esc(q.no)}</span>
                    <span class="flex-1 font-bold text-slate-700">${esc(q.item)} <span class="text-[10px] text-slate-400 font-normal">${esc(q.standard || '')}</span></span>
                    <input class="swo-qc-val w-28 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 font-mono" data-no="${esc(q.no)}" value="${esc(results[q.no] || '')}" placeholder="시험치" /></label>`).join('');
        };
        recipeSel.addEventListener('change', drawMats);
        qtyInput.addEventListener('input', drawMats);
        drawMats();

        modal().querySelectorAll('.swo-close').forEach(b => b.addEventListener('click', closeModal));
        modal().querySelector('#swo-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const r = currentRecipe();
            if (!r) { alert('제조시방서를 선택하세요.'); return; }
            const val = (id) => modal().querySelector(`#swo-${id}`)?.value.trim() ?? '';
            const orderNo = val('orderNo');
            if (secure.orders.some(x => x.orderNo === orderNo && x.id !== o.id)) { alert(`지시번호 ${orderNo}가 이미 있습니다.`); return; }
            const prodQty = Number(val('prodQty')) || 0;
            if (!(prodQty > 0)) { alert('생산량을 입력하세요.'); return; }
            const qcResults = {};
            modal().querySelectorAll('.swo-qc-val').forEach(inp => { if (inp.value.trim()) qcResults[inp.dataset.no] = inp.value.trim(); });
            const data = {
                ...o,
                orderNo,
                recipeId: r.id,
                productName: r.productName,
                revision: r.revision,
                productItemCode: r.productItemCode || '',
                baseLitersPerUnit: (Number(r.baseLiters) || 0) / (Number(r.baseQty) || 1),
                mfgDate: val('mfgDate'),
                prodQty,
                prodUnit: val('prodUnit') || r.baseUnit || 'D/M',
                actualQty: val('actualQty') === '' ? null : Number(val('actualQty')),
                author: val('author'),
                materials: currentMats(),
                workStandard: o.status === 'COMPLETED' && o.workStandard ? o.workStandard : (r.workStandard || []),
                qcItems: o.status === 'COMPLETED' && o.qcItems ? o.qcItems : (r.qcItems || []),
                docNo: r.docNo || 'DLS-QP-113-1(1) 작업일지',
                qcResults,
                notes: modal().querySelector('#swo-notes').value.trim()
            };
            HEADER_FIELDS.forEach(([k]) => { data[k] = val(k); });
            RESULT_FIELDS.forEach(([k]) => { data[k] = val(k); });
            await run(() => saveSecureOrder(data), `${orderNo} 작업지시서를 ${isNew ? '발행' : '저장'}했습니다.`);
        });
    };

    // ==========================================
    // 생산 완료 처리
    // ==========================================
    const openCompleteModal = (o) => {
        const recipe = secure.recipes.find(r => r.id === o.recipeId);
        const linked = (recipe?.materials || []).filter(m => m.itemCode).length;
        const total = (o.materials || []).length;
        const productItem = recipe?.productItemCode ? state.master.find(m => m.code === recipe.productItemCode) : null;
        openModal(`
        <form id="swc-form" class="bg-white rounded-2xl shadow-xl w-full max-w-lg my-10 p-5 space-y-3 text-xs">
            <h3 class="font-black text-sm text-slate-900">생산 완료 처리 · ${esc(o.orderNo)}</h3>
            <div class="grid grid-cols-2 gap-2.5">
                <label class="block"><span class="font-bold text-slate-600">실생산량 (${esc(o.prodUnit || 'D/M')})</span>
                    <input id="swc-qty" type="number" min="0" step="any" value="${esc(o.actualQty ?? o.prodQty)}" required class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold text-right" /></label>
                <label class="block"><span class="font-bold text-slate-600">생산·입고 위치</span>
                    <select id="swc-loc" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${locationOptionsHtml(state.locations, '김포공장')}</select></label>
            </div>
            <ul class="space-y-1 text-[11px] font-bold">
                <li class="${productItem ? 'text-emerald-700' : 'text-rose-600'}">원액 품목: ${productItem ? `${esc(productItem.code)} ${esc(productItem.name)} 입고` : '미연결 — 재고·수불부에 반영하지 않고 상태만 완료로 바꿉니다'}</li>
                <li class="${linked === total ? 'text-emerald-700' : 'text-amber-700'}">원료 재고 차감: ${linked}/${total}종 연결됨${linked < total ? ' (미연결 원료는 차감하지 않음)' : ''}</li>
                <li class="text-slate-500">입출고 이력·원료수불부에는 원료 실명 대신 원료코드로 기록됩니다.</li>
            </ul>
            <div class="flex justify-end gap-2">
                <button type="button" class="swc-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button>
                <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black">생산 완료</button>
            </div>
        </form>`);
        modal().querySelector('.swc-close').addEventListener('click', closeModal);
        modal().querySelector('#swc-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const actualQty = Number(modal().querySelector('#swc-qty').value);
            const location = modal().querySelector('#swc-loc').value;
            try {
                const r = await completeSecureOrder(o, { actualQty, location });
                showToast(r.inventoryApplied
                    ? `✅ ${o.orderNo} 생산 완료: 원액 ${fmt(r.liters)}L 입고, 원료 ${r.linkedCount}종 차감`
                    : `✅ ${o.orderNo} 생산 완료 (원액 품목 미연결로 재고 반영 없음)`);
                closeModal();
                render();
            } catch (err) {
                alert(`생산 완료 처리 실패:\n${err.message}`);
            }
        });
    };

    // ==========================================
    // 작업일지 인쇄 (원료코드로만 표기, 엑셀 'DLS-QP-113-1(1) 작업일지' 양식)
    // ==========================================
    const printWorkLog = (o) => {
        const w = window.open('', '_blank', 'width=900,height=1000');
        if (!w) { alert('팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.'); return; }
        const mats = o.materials || [];
        const rowsCount = Math.max(12, mats.length);
        const std = o.workStandard || [];
        const tl = mats.reduce((s, m) => s + (Number(m.liters) || 0), 0);
        const tk = mats.reduce((s, m) => s + (Number(m.kg) || 0), 0);
        const qc = o.qcItems || [];
        const res = o.qcResults || {};
        const left = qc.filter(q => CIRCLED.indexOf(q.no) < 8);
        const right = qc.filter(q => CIRCLED.indexOf(q.no) >= 8);
        const qcRows = Array.from({ length: Math.max(left.length, right.length, 8) }, (_, i) => [left[i], right[i]]);
        const cell = (v) => esc(v ?? '');
        // A4 세로 1장 기준 (용지 210×297mm, 여백 8mm → 인쇄 영역 194×281mm). 모든 크기를 mm로 고정한다.
        const sign = (label, heads) => `
            <table class="sign"><colgroup><col style="width:6mm">${heads.map(() => '<col style="width:17mm">').join('')}</colgroup>
                <tr><td rowspan="2" class="c b">${label.split('').join('<br>')}</td>${heads.map(h => `<td class="sh">${h}</td>`).join('')}</tr>
                <tr>${heads.map(() => '<td class="sb"></td>').join('')}</tr></table>`;
        w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>작업일지 ${cell(o.orderNo)}</title>
        <style>
            @page { size: A4 portrait; margin: 8mm; }
            * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            html, body { margin: 0; padding: 0; }
            body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; color: #000; font-size: 8.5pt; background: #e5e7eb; }
            .page { width: 194mm; margin: 6mm auto; background: #fff; box-shadow: 0 0 4mm rgba(0,0,0,.2); transform-origin: top left; }
            @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; } }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            td, th { border: 0.3mm solid #000; padding: 0 1.2mm; height: 6.4mm; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; vertical-align: middle; }
            th { background: #f1f5f9; font-weight: bold; text-align: center; }
            .gap { height: 2mm; }
            .top { display: flex; justify-content: space-between; align-items: stretch; }
            .title { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 18pt; font-weight: 900; letter-spacing: 3mm; }
            .sign { width: auto; }
            .sign td { text-align: center; padding: 0; }
            .sign .sh { height: 5mm; font-weight: bold; background: #f1f5f9; }
            .sign .sb { height: 13mm; }
            .num { text-align: right; font-family: Consolas, 'Malgun Gothic', monospace; }
            .c { text-align: center; }
            .b { font-weight: bold; }
            .lbl { background: #f8fafc; font-weight: bold; }
            .sec { font-weight: 900; background: #e2e8f0; }
            .memo { white-space: pre-wrap; vertical-align: top; padding-top: 1mm; }
            .tall td { height: 13mm; vertical-align: top; padding-top: 1mm; white-space: normal; }
            .no { margin: 1.5mm 0; font-weight: bold; font-size: 9pt; }
            .foot { display: flex; justify-content: space-between; margin-top: 1.5mm; font-size: 7.5pt; }
        </style></head><body><div class="page" id="page">
        <div class="top">
            <div class="title">작 업 일 지 (생산)</div>
            ${sign('생산', ['담당', '대리', '공장장', '사장'])}
        </div>
        <div class="no">NO. ${cell(o.orderNo)}</div>
        <table>
            <colgroup><col style="width:21mm"><col style="width:44mm"><col style="width:21mm"><col style="width:33mm"><col style="width:22mm"><col style="width:53mm"></colgroup>
            <tr><td class="lbl">1. 제 품 명</td><td class="b">${cell(o.productName)}</td><td class="lbl">5. MARKING</td><td>${cell(o.marking)}</td><td class="lbl">9. 관련근거</td><td>${cell(o.revision)}</td></tr>
            <tr><td class="lbl">2. 제조일자</td><td>${cell(o.mfgDate)}</td><td class="lbl">6. 품질표시</td><td>${cell(o.qualityMark)}</td><td class="lbl">10. 작업지시</td><td>${cell(o.workInstruction)}</td></tr>
            <tr><td class="lbl">3. 생 산 량</td><td class="b">${cell(fmt(o.prodQty))} ${cell(o.prodUnit)}</td><td class="lbl">7. 종 호</td><td>${cell(o.grade)}</td><td class="lbl">11. Lot No.</td><td class="b">${cell(o.lotNo)}</td></tr>
            <tr><td class="lbl">4. 실생산량</td><td>${o.actualQty ? `${cell(fmt(o.actualQty))} ${cell(o.prodUnit)}` : ''}</td><td class="lbl">8. 포장단위</td><td>${cell(o.packaging)}</td><td class="lbl">12. 납 품 처</td><td>${cell(o.customer)}</td></tr>
        </table>
        <div class="gap"></div>
        <table>
            <colgroup><col style="width:11mm"><col style="width:7mm"><col style="width:40mm"><col style="width:21mm"><col style="width:21mm"><col style="width:13mm"><col style="width:27mm"><col style="width:54mm"></colgroup>
            <tr><td class="sec" colspan="7">가. 작 업 표 준 ( 제 조 시 방 서 )</td><td class="sec">나. 작업현황 및 내역</td></tr>
            <tr><th>단계</th><th>순</th><th>원 료 명</th><th>L</th><th>KG</th><th>SG</th><th>작업표준</th>
                <td rowspan="${rowsCount + 2}" class="memo">${cell(o.workStatus)}</td></tr>
            ${Array.from({ length: rowsCount }, (_, i) => {
                const m = mats[i];
                return `<tr><td class="c">${cell(m?.stage)}</td><td class="c">${i + 1}</td><td class="b">${cell(m?.rawCode)}</td>
                    <td class="num">${m ? cell(fmt(m.liters)) : ''}</td><td class="num">${m ? cell(fmt(m.kg)) : ''}</td><td class="num">${m ? cell(fmt(m.sg, 4)) : ''}</td><td>${cell(std[i])}</td></tr>`;
            }).join('')}
            <tr><td colspan="3" class="c b">S-TOTAL</td><td class="num b">${cell(fmt(tl))}</td><td class="num b">${cell(fmt(tk))}</td><td></td><td></td></tr>
        </table>
        <div class="gap"></div>
        <table>
            <colgroup><col><col><col><col><col></colgroup>
            <tr><th>Adjust 내역</th><th>공정검사내역</th><th>Sticker 표기</th><th>부피환산계수</th><th>포장검사</th></tr>
            <tr class="tall"><td>${cell(o.adjustNotes)}</td><td>① 동점도 : ${cell(o.processViscosity)}</td><td>① 품 명 : ${cell(o.stickerName)}</td>
                <td>① SG : ${cell(o.volumeSg)}<br>② WT : ${cell(o.volumeWt)}</td><td>① 포장용기 : ${cell(o.packContainer)}<br>② 누 유 : ${cell(o.packLeak)}</td></tr>
        </table>
        <div class="gap"></div>
        <div class="top">
            <div class="sec" style="flex:1; display:flex; align-items:center; padding:0 1.2mm; border:0.3mm solid #000; margin-right:2mm;">다. In - Process Test (공정검사) 및 Final Test (제품검사)</div>
            ${sign('품질', ['담당', '대리', '팀장'])}
        </div>
        <table style="margin-top:1.5mm;">
            <colgroup><col style="width:6mm"><col style="width:39mm"><col style="width:30mm"><col style="width:22mm"><col style="width:6mm"><col style="width:39mm"><col style="width:30mm"><col style="width:22mm"></colgroup>
            <tr><th colspan="2">시 험 항 목</th><th>검 사 기 준</th><th>시 험 치</th><th colspan="2">시 험 항 목</th><th>검 사 기 준</th><th>시 험 치</th></tr>
            ${qcRows.map(([a, b]) => `<tr>
                <td class="c">${cell(a?.no)}</td><td>${cell(a?.item)}</td><td class="c">${cell(a?.standard)}</td><td class="c">${cell(a ? res[a.no] : '')}</td>
                <td class="c">${cell(b?.no)}</td><td>${cell(b?.item)}</td><td class="c">${cell(b?.standard)}</td><td class="c">${cell(b ? res[b.no] : '')}</td></tr>`).join('')}
            <tr><td colspan="6" class="c b">합 부 판 정</td><td colspan="2" class="c b">${cell(o.verdict)}</td></tr>
        </table>
        <div class="gap"></div>
        <table>
            <colgroup><col style="width:18mm"><col><col style="width:18mm"><col><col style="width:18mm"><col></colgroup>
            <tr><td class="lbl c">작 성 자</td><td>${cell(o.author)} <span style="float:right">(인)</span></td><td class="lbl c">확 인 자</td><td>${cell(o.confirmer)} <span style="float:right">(인)</span></td><td class="lbl c">작 업 자</td><td>${cell(o.worker)} <span style="float:right">(인)</span></td></tr>
        </table>
        ${o.notes ? `<div style="margin-top:1.5mm; font-size:8pt; white-space:pre-wrap;">비고: ${cell(o.notes)}</div>` : ''}
        <div class="foot"><span>${cell(o.docNo || 'DLS-QP-113-1(1) 작업일지')}</span><span>대림기업</span><span>출력일 ${cell(localDateStr())}</span></div>
        </div>
        <script>
            // 원료가 많거나 비고가 길어 한 장(281mm)을 넘으면 한 장에 들어가도록 비율을 줄인다
            window.onload = () => {
                const page = document.getElementById('page');
                const mm = page.offsetWidth / 194;
                const limit = 281 * mm;
                if (page.scrollHeight > limit) page.style.zoom = (limit / page.scrollHeight).toFixed(3);
                window.focus();
                window.print();
            };
        <\/script>
        </body></html>`);
        w.document.close();
    };

    // ==========================================
    // 제조시방서 목록·가져오기·편집
    // ==========================================
    const renderRecipes = () => {
        $('#sw-body').innerHTML = `
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 text-xs">
            <div class="flex flex-wrap items-center gap-2">
                <label class="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black flex items-center gap-1 cursor-pointer">
                    <i data-lucide="file-up" class="w-4 h-4"></i>제조시방서 엑셀 가져오기
                    <input type="file" id="sw-import" accept=".xlsx,.xls,.xlsm" class="hidden" />
                </label>
                <span class="text-slate-500">'제조시방서' + '작업일지' 시트가 있는 엑셀(DLS-QP-113-1 양식)을 고르면 원료·원료코드·검사항목을 읽어 등록합니다.</span>
            </div>
            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full">
                    <thead class="bg-slate-50 text-slate-600 font-bold"><tr>
                        <th class="p-2.5 text-left">제품명</th><th class="p-2.5 text-left">관련근거 (Rev)</th><th class="p-2.5 text-right whitespace-nowrap">기준 생산량</th>
                        <th class="p-2.5 text-center">원료</th><th class="p-2.5 text-center whitespace-nowrap">재고 연결</th><th class="p-2.5 text-center">상태</th><th class="p-2.5 text-center">관리</th>
                    </tr></thead>
                    <tbody class="divide-y divide-slate-100">
                    ${secure.recipes.length === 0 ? '<tr><td colspan="7" class="p-8 text-center text-slate-400 font-bold">등록된 제조시방서가 없습니다.</td></tr>' : secure.recipes.map(r => {
                        const linked = r.materials.filter(m => m.itemCode).length;
                        return `<tr class="hover:bg-slate-50 ${r.active ? '' : 'opacity-50'}">
                            <td class="p-2.5 font-black text-slate-900">${esc(r.productName)}</td>
                            <td class="p-2.5 font-mono">${esc(r.revision || '-')}</td>
                            <td class="p-2.5 text-right font-mono whitespace-nowrap">${fmt(r.baseQty)} ${esc(r.baseUnit)} = ${fmt(r.baseLiters)} L</td>
                            <td class="p-2.5 text-center">${r.materials.length}종</td>
                            <td class="p-2.5 text-center text-[11px] font-bold ${linked === r.materials.length && r.productItemCode ? 'text-emerald-700' : 'text-amber-700'}">원료 ${linked}/${r.materials.length}${r.productItemCode ? ' · 원액 ✔' : ' · 원액 ✖'}</td>
                            <td class="p-2.5 text-center">${r.active ? '<span class="text-emerald-700 font-bold">사용</span>' : '<span class="text-slate-400 font-bold">중지</span>'}</td>
                            <td class="p-2.5 text-center whitespace-nowrap">
                                <button type="button" class="sr-edit p-1 text-slate-500 hover:text-blue-600" data-id="${esc(r.id)}" title="보기·원료코드·재고 연결"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                                <button type="button" class="sr-print p-1 text-slate-500 hover:text-slate-900" data-id="${esc(r.id)}" title="제조시방서 인쇄 (대외비)"><i data-lucide="printer" class="w-4 h-4"></i></button>
                                <button type="button" class="sr-toggle p-1 text-slate-500 hover:text-amber-600" data-id="${esc(r.id)}" title="${r.active ? '사용 중지' : '다시 사용'}"><i data-lucide="${r.active ? 'pause-circle' : 'play-circle'}" class="w-4 h-4"></i></button>
                                <button type="button" class="sr-del p-1 text-slate-400 hover:text-rose-600" data-id="${esc(r.id)}" title="삭제"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                            </td>
                        </tr>`;
                    }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
        $('#sw-import').addEventListener('change', onImportFile);
        const byId = (id) => secure.recipes.find(r => r.id === id);
        container.querySelectorAll('.sr-edit').forEach(b => b.addEventListener('click', () => openRecipeEditor(byId(b.dataset.id))));
        container.querySelectorAll('.sr-print').forEach(b => b.addEventListener('click', () => printRecipe(byId(b.dataset.id))));
        container.querySelectorAll('.sr-toggle').forEach(b => b.addEventListener('click', async () => {
            const r = byId(b.dataset.id);
            await run(() => saveRecipe({ ...r, active: !r.active }), `${r.productName} 시방서를 ${r.active ? '사용 중지' : '다시 사용'}했습니다.`);
        }));
        container.querySelectorAll('.sr-del').forEach(b => b.addEventListener('click', async () => {
            const r = byId(b.dataset.id);
            if (secure.orders.some(o => o.recipeId === r.id)) { alert('이 시방서로 발행한 작업지시서가 있어 삭제할 수 없습니다. 사용 중지를 이용하세요.'); return; }
            if (!confirm(`${r.productName} ${r.revision} 시방서를 삭제하시겠습니까?`)) return;
            await run(() => deleteRecipe(r.id), '시방서를 삭제했습니다.');
        }));
    };

    const onImportFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        let spec;
        try {
            const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
            spec = parseSpecWorkbook(XLSX, wb);
        } catch (err) {
            alert(`엑셀을 읽지 못했습니다:\n${err.message}`);
            return;
        }
        // 같은 제품의 이전 시방서에서 재고 품목 연결을 이어받음 (원료코드 → 원료명 순으로 대조)
        const prev = secure.recipes.filter(r => r.productName === spec.productName);
        const same = prev.find(r => r.revision === spec.revision);
        const carry = (m) => {
            for (const r of prev) {
                const hit = r.materials.find(x => (m.rawCode && x.rawCode === m.rawCode) || x.name === m.name);
                if (hit?.itemCode) return hit.itemCode;
            }
            return '';
        };
        const recipe = {
            ...(same || {}),
            productName: spec.productName,
            revision: spec.revision,
            baseQty: spec.baseQty,
            baseUnit: spec.baseUnit,
            baseLiters: spec.baseLiters,
            productItemCode: same?.productItemCode || prev.find(r => r.productItemCode)?.productItemCode || '',
            materials: spec.materials.map(m => ({ ...m, itemCode: carry(m) })),
            workStandard: spec.workStandard,
            history: spec.history,
            brands: spec.brands,
            qcItems: spec.qcItems,
            docNo: spec.docNo,
            author: spec.author,
            sourceFile: file.name,
            active: true
        };
        const summary = `${spec.productName} · ${spec.revision || 'Rev 없음'}\n기준 ${spec.baseQty} ${spec.baseUnit} = ${fmt(spec.baseLiters)} L\n원료 ${spec.materials.length}종: ${spec.materials.map(m => m.rawCode || '(코드 없음)').join(', ')}\n검사항목 ${spec.qcItems.length}개 · 개정이력 ${spec.history.length}건`;
        const warn = spec.warnings.length ? `\n\n⚠️ ${spec.warnings.join('\n⚠️ ')}` : '';
        if (!confirm(`${same ? '같은 제품·리비전의 시방서가 있어 내용을 새로 덮어씁니다.\n\n' : ''}다음 제조시방서를 등록하시겠습니까?\n\n${summary}${warn}`)) return;
        // 새 리비전을 등록하면 같은 제품의 이전 리비전은 사용 중지
        const olderActive = prev.filter(r => r.id !== same?.id && r.active);
        await run(async () => {
            const saved = await saveRecipe(recipe);
            for (const r of olderActive) await saveRecipe({ ...r, active: false });
            tab = 'recipes';
            setTimeout(() => openRecipeEditor(saved), 0);
        }, `${spec.productName} ${spec.revision} 제조시방서를 등록했습니다.${olderActive.length ? ' (이전 리비전은 사용 중지)' : ''}`);
    };

    const openRecipeEditor = (r) => {
        if (!r) return;
        openModal(`
        <form id="sr-form" class="bg-white rounded-2xl shadow-xl w-full max-w-4xl my-6 p-5 space-y-4 text-xs">
            <div class="flex items-center justify-between">
                <h3 class="font-black text-sm text-slate-900">🔒 제조시방서 · ${esc(r.productName)} <span class="font-mono text-slate-500">${esc(r.revision)}</span></h3>
                <button type="button" class="sr-close text-slate-400 hover:text-slate-700"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <label class="block"><span class="font-bold text-slate-600">제품명</span><input id="sr-name" value="${esc(r.productName)}" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                <label class="block"><span class="font-bold text-slate-600">관련근거 (Rev)</span><input id="sr-rev" value="${esc(r.revision)}" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                <label class="block col-span-2"><span class="font-bold text-slate-600">생산 원액 품목 (재고 입고 연결)</span>
                    <input id="sr-product" list="sr-wonaek-list" value="${esc(r.productItemCode)}" placeholder="원액 품목코드 (선택)" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-mono font-bold" /></label>
            </div>
            <datalist id="sr-wonaek-list">${wonaekItems.map(m => `<option value="${esc(m.code)}">${esc(m.name)}</option>`).join('')}</datalist>
            <datalist id="sr-raw-list">${rawItems.map(m => `<option value="${esc(m.code)}">${esc(m.name)}</option>`).join('')}</datalist>
            <div class="overflow-x-auto border border-slate-200 rounded-xl"><table class="w-full"><thead class="bg-slate-50 font-bold text-slate-600"><tr>
                <th class="p-2 text-left">순</th><th class="p-2 text-left text-amber-700">원료명 (대외비)</th><th class="p-2 text-left">원료코드 (인쇄)</th>
                <th class="p-2 text-right">L</th><th class="p-2 text-right">wt%</th><th class="p-2 text-right">KG</th><th class="p-2 text-right">SG</th><th class="p-2 text-left">재고 품목코드 연결</th>
            </tr></thead><tbody class="divide-y divide-slate-100">
                ${r.materials.map((m, i) => `<tr>
                    <td class="p-2 font-mono">${esc(m.seq)}</td>
                    <td class="p-2 font-bold text-amber-800">${esc(m.name)}</td>
                    <td class="p-2"><input class="sr-rawcode w-32 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 font-mono font-bold" data-i="${i}" value="${esc(m.rawCode)}" /></td>
                    <td class="p-2 text-right font-mono">${fmt(m.liters)}</td><td class="p-2 text-right font-mono">${fmt(m.wtPct)}</td>
                    <td class="p-2 text-right font-mono">${fmt(m.kg)}</td><td class="p-2 text-right font-mono">${fmt(m.sg, 4)}</td>
                    <td class="p-2"><input class="sr-item w-36 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 font-mono" list="sr-raw-list" data-i="${i}" value="${esc(m.itemCode)}" placeholder="품목코드 (선택)" /></td>
                </tr>`).join('')}
                <tr class="bg-slate-50 font-bold"><td colspan="3" class="p-2 text-center">S-TOTAL (${fmt(r.baseQty)} ${esc(r.baseUnit)})</td>
                    <td class="p-2 text-right font-mono">${fmt(r.materials.reduce((s, m) => s + (m.liters || 0), 0))}</td>
                    <td class="p-2 text-right font-mono">${fmt(r.materials.reduce((s, m) => s + (m.wtPct || 0), 0))}</td>
                    <td class="p-2 text-right font-mono">${fmt(r.materials.reduce((s, m) => s + (m.kg || 0), 0))}</td><td colspan="2"></td></tr>
            </tbody></table></div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div><div class="font-black text-slate-800 mb-1">작업표준</div><ul class="list-disc pl-4 text-slate-600">${r.workStandard.map(s => `<li>${esc(s)}</li>`).join('') || '<li>-</li>'}</ul>
                    <div class="font-black text-slate-800 mt-3 mb-1">검사 항목 (${r.qcItems.length})</div>
                    <ul class="text-slate-600 space-y-0.5">${r.qcItems.map(q => `<li>${esc(q.no)} ${esc(q.item)} <span class="text-slate-400">${esc(q.standard)}</span></li>`).join('')}</ul></div>
                <div><div class="font-black text-slate-800 mb-1">개정 이력 (${r.history.length})</div><ul class="text-slate-600 space-y-0.5">${r.history.map(h => `<li>${esc(h)}</li>`).join('') || '<li>-</li>'}</ul></div>
                <div><div class="font-black text-slate-800 mb-1">적용 ODM 제품 (${r.brands.length})</div><ul class="text-slate-600 space-y-0.5">${r.brands.map((b, i) => `<li>${i + 1}. ${esc(b)}</li>`).join('') || '<li>-</li>'}</ul></div>
            </div>
            <p class="text-[11px] text-slate-500">재고 품목코드를 연결한 원료만 생산 완료 시 재고·원료수불부에서 차감됩니다. 출처: ${esc(r.sourceFile || '-')} · 문서 ${esc(r.docNo || '-')} · 작성 ${esc(r.author || '-')}</p>
            <div class="flex justify-end gap-2">
                <button type="button" class="sr-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button>
                <button type="submit" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black">저장</button>
            </div>
        </form>`);
        modal().querySelectorAll('.sr-close').forEach(b => b.addEventListener('click', closeModal));
        modal().querySelector('#sr-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const materials = r.materials.map(m => ({ ...m }));
            modal().querySelectorAll('.sr-rawcode').forEach(inp => { materials[inp.dataset.i].rawCode = inp.value.trim(); });
            let bad = [];
            modal().querySelectorAll('.sr-item').forEach(inp => {
                const code = inp.value.trim();
                if (code && !state.master.some(m => m.code === code)) bad.push(code);
                materials[inp.dataset.i].itemCode = code;
            });
            const productItemCode = modal().querySelector('#sr-product').value.trim();
            if (productItemCode && !state.master.some(m => m.code === productItemCode)) bad.push(productItemCode);
            if (bad.length) { alert(`품목 마스터에 없는 품목코드입니다: ${bad.join(', ')}`); return; }
            const codes = materials.map(m => m.rawCode).filter(Boolean);
            if (new Set(codes).size !== codes.length) { alert('한 시방서 안에서 원료코드가 중복되었습니다.'); return; }
            await run(() => saveRecipe({
                ...r, materials, productItemCode,
                productName: modal().querySelector('#sr-name').value.trim() || r.productName,
                revision: modal().querySelector('#sr-rev').value.trim()
            }), '제조시방서를 저장했습니다.');
        });
    };

    // 제조시방서 인쇄 (원료 실명 포함 · 대외비)
    const printRecipe = (r) => {
        if (!confirm('제조시방서에는 원료 실명과 배합비가 포함됩니다(대외비). 인쇄하시겠습니까?')) return;
        const w = window.open('', '_blank', 'width=900,height=1000');
        if (!w) { alert('팝업이 차단되었습니다.'); return; }
        const c = (v) => esc(v ?? '');
        w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>제조시방서 ${c(r.productName)}</title>
        <style>@page{size:A4 portrait;margin:10mm}body{font-family:'Malgun Gothic',sans-serif;font-size:10.5px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #000;padding:3px 5px}th{background:#f1f5f9}.num{text-align:right;font-family:Consolas,monospace}h1{text-align:center;letter-spacing:8px}.conf{color:#b91c1c;font-weight:900;text-align:right}</style></head><body>
        <div class="conf">대외비 · 무단 복제·반출 금지</div>
        <h1>제 조 시 방 서</h1>
        <table><tr><th>제품명</th><td>${c(r.productName)}</td><th>관련근거</th><td>${c(r.revision)}</td><th>기준 생산량</th><td>${c(fmt(r.baseQty))} ${c(r.baseUnit)} (${c(fmt(r.baseLiters))} L)</td></tr></table>
        <table style="margin-top:6px"><tr><th>순</th><th>원료명</th><th>원료코드</th><th>L</th><th>wt%</th><th>KG</th><th>SG</th></tr>
        ${r.materials.map(m => `<tr><td>${c(m.seq)}</td><td>${c(m.name)}</td><td>${c(m.rawCode)}</td><td class="num">${c(fmt(m.liters))}</td><td class="num">${c(fmt(m.wtPct))}</td><td class="num">${c(fmt(m.kg))}</td><td class="num">${c(fmt(m.sg, 4))}</td></tr>`).join('')}
        </table>
        <p><b>작업표준</b>: ${c(r.workStandard.join(' / '))}</p>
        <p><b>개정 이력</b></p><ol style="margin:0">${r.history.map(h => `<li>${c(h.replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol>
        <p><b>적용 ODM 제품</b>: ${c(r.brands.join(', '))}</p>
        <table style="margin-top:6px"><tr><th>No</th><th>시험 항목</th><th>검사 기준</th></tr>${r.qcItems.map(q => `<tr><td>${c(q.no)}</td><td>${c(q.item)}</td><td>${c(q.standard)}</td></tr>`).join('')}</table>
        <p style="font-size:9px">${c(r.docNo)} · 대림기업 · 출력일 ${c(localDateStr())}</p>
        <script>window.onload=()=>{window.focus();window.print();};<\/script></body></html>`);
        w.document.close();
    };

    render();
};
