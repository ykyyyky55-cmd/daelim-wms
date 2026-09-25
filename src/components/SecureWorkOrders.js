import { state, latestRawUnitPrice } from '../services/db.js';
import { localDateStr, matchesQuery } from '../services/searchUtils.js';
import { locationOptionsHtml } from '../services/locations.js';
import { hasWorklogAccess } from '../services/auth.js';
import {
    secure, loadSecureData, saveRecipe, deleteRecipe, saveSecureOrder, deleteSecureOrder,
    nextOrderNo, scaleMaterials, completeSecureOrder, listRecipeRevisions, restoreRecipeRevision
} from '../services/secureWorkOrders.js';
import { parseSpecWorkbook } from '../services/specImport.js';
import worklogTemplate from '../data/worklogTemplate.json';
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
    const activeSearchBoxes = [];
    const openModal = (html) => { const m = modal(); m.innerHTML = html; m.classList.remove('hidden'); m.classList.add('flex'); createIcons({ icons }); };
    const closeModal = () => {
        const m = modal(); m.classList.add('hidden'); m.classList.remove('flex'); m.innerHTML = '';
        activeSearchBoxes.forEach(b => b.remove());
        activeSearchBoxes.length = 0;
    };

    // 재고 품목(원료/원액)을 코드·품명 일부 문자로 검색해 고르는 자동완성 드롭다운
    // (모달의 표 안에 있어도 잘리지 않도록 body에 fixed로 띄운다)
    const attachItemSearch = (input, pool, onPick) => {
        const box = document.createElement('div');
        box.className = 'fixed z-[9999] bg-white border border-slate-300 rounded-lg shadow-xl max-h-48 overflow-y-auto text-[11px] hidden';
        document.body.appendChild(box);
        activeSearchBoxes.push(box);
        const position = () => {
            const rc = input.getBoundingClientRect();
            box.style.left = `${rc.left}px`;
            box.style.top = `${rc.bottom + 2}px`;
            box.style.width = `${Math.max(rc.width, 240)}px`;
        };
        const close = () => { box.classList.add('hidden'); box.innerHTML = ''; };
        input.addEventListener('input', () => {
            const q = input.value.trim();
            if (!q) { close(); return; }
            const hits = pool.filter(m => matchesQuery(m, q, ['code', 'name'])).slice(0, 8);
            if (!hits.length) { close(); return; }
            position();
            box.innerHTML = hits.map(m => `<div class="sr-hit px-2 py-1 hover:bg-amber-50 cursor-pointer" data-code="${esc(m.code)}"><span class="font-mono font-bold">${esc(m.code)}</span> <span class="text-slate-600">${esc(m.name)}</span></div>`).join('');
            box.classList.remove('hidden');
            box.querySelectorAll('.sr-hit').forEach(h => h.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = h.dataset.code;
                close();
                onPick(h.dataset.code);
            }));
        });
        input.addEventListener('blur', () => setTimeout(close, 150));
        input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')); });
    };

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
    // 여러 줄 입력 (인쇄 시 줄바꿈 유지)
    const MULTILINE_FIELDS = ['workStatus', 'adjustNotes'];

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
                    <span class="font-black text-slate-800">가. 작업표준 (원료 소요량 · 단계별 작업표준 · 인쇄 시 원료코드로만 표기)</span>
                    <span id="swo-total" class="font-mono font-bold text-slate-500"></span>
                </div>
                <div class="overflow-x-auto border border-slate-200 rounded-xl"><table class="w-full"><thead class="bg-slate-50 font-bold text-slate-600"><tr>
                    <th class="p-2 text-left">순</th><th class="p-2 text-left">단계</th><th class="p-2 text-left">원료코드</th><th class="p-2 text-left text-amber-700">원료명 (대외비)</th>
                    <th class="p-2 text-right">L</th><th class="p-2 text-right">KG</th><th class="p-2 text-right">SG</th><th class="p-2 text-left">재고 품목 연결</th><th class="p-2 text-left">작업표준 (이 단계)</th>
                </tr></thead><tbody id="swo-mats" class="divide-y divide-slate-100"></tbody></table></div>
            </div>
            <details ${isNew ? '' : 'open'} class="border border-slate-200 rounded-xl p-3">
                <summary class="font-black text-slate-800 cursor-pointer">작업 결과 · 공정/제품 검사 (생산 후 입력)</summary>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-3">${RESULT_FIELDS.map(([k, l]) => (MULTILINE_FIELDS.includes(k)
                    ? `<label class="block col-span-2"><span class="font-bold text-slate-600">${l}</span><textarea id="swo-${k}" rows="4" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5">${esc(o[k] ?? '')}</textarea></label>`
                    : input(k, l, o[k]))).join('')}</div>
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
        // 단계·단계별 작업표준은 사용자가 직접 수정할 수 있다. 원료명/수량이 다시 계산되어 표가 새로
        // 그려져도(생산량·시방서 변경) 입력한 내용이 사라지지 않도록 다시 그리기 전에 현재 값을 저장해둔다.
        const stageOverrides = {};
        const stdOverrides = {};
        (o.materials || []).forEach(m => { if (m.stage) stageOverrides[m.seq] = m.stage; });
        (o.workStandard || []).forEach((s, i) => { if (s) stdOverrides[i] = s; });
        const captureRowEdits = () => {
            modal().querySelectorAll('.swo-stage').forEach(el => { stageOverrides[el.dataset.seq] = el.value; });
            modal().querySelectorAll('.swo-std-row').forEach(el => { stdOverrides[el.dataset.i] = el.value; });
        };
        // 단계가 바뀌는 지점의 행 위에 굵은 선을 그어 단계별로 구분한다 (입력 중에도 실시간 반영).
        // divide-y의 옅은 구분선보다 우선하도록 인라인 스타일로 지정한다.
        const updateStageBorders = () => {
            let prevStage = null;
            modal().querySelectorAll('#swo-mats tr').forEach((tr, i) => {
                const stageVal = tr.querySelector('.swo-stage')?.value.trim() ?? '';
                tr.style.borderTop = (i > 0 && stageVal !== prevStage) ? '2px solid #64748b' : '';
                prevStage = stageVal;
            });
        };
        const drawMats = () => {
            captureRowEdits();
            const r = currentRecipe();
            const mats = currentMats();
            modal().querySelector('#swo-mats').innerHTML = mats.map((m, i) => {
                const item = m.itemCode ? state.master.find(x => x.code === m.itemCode) : null;
                const stageVal = stageOverrides[m.seq] ?? (m.stage || '');
                const stdVal = stdOverrides[i] ?? (r?.workStandard?.[i] || '');
                return `<tr>
                    <td class="p-2 font-mono">${esc(m.seq)}</td>
                    <td class="p-2"><input class="swo-stage w-16 bg-slate-50 border border-slate-300 rounded px-1.5 py-1" data-seq="${esc(m.seq)}" value="${esc(stageVal)}" /></td>
                    <td class="p-2 font-mono font-black ${m.rawCode ? 'text-slate-900' : 'text-rose-600'}">${esc(m.rawCode || '원료코드 없음')}</td>
                    <td class="p-2 text-amber-800">${esc(m.name)}</td>
                    <td class="p-2 text-right font-mono font-bold">${fmt(m.liters)}</td>
                    <td class="p-2 text-right font-mono">${fmt(m.kg)}</td>
                    <td class="p-2 text-right font-mono">${fmt(m.sg, 4)}</td>
                    <td class="p-2 text-[10px] ${item ? 'text-emerald-700' : 'text-slate-400'}">${item ? `${esc(item.code)} ${esc(item.name)}` : '미연결 (재고 차감 안 함)'}</td>
                    <td class="p-2"><input class="swo-std-row w-40 bg-slate-50 border border-slate-300 rounded px-1.5 py-1" data-i="${i}" value="${esc(stdVal)}" placeholder="이 단계의 작업표준" /></td>
                </tr>`;
            }).join('');
            modal().querySelectorAll('.swo-stage').forEach(el => el.addEventListener('input', updateStageBorders));
            updateStageBorders();
            const tl = mats.reduce((s, m) => s + (Number(m.liters) || 0), 0);
            const tk = mats.reduce((s, m) => s + (Number(m.kg) || 0), 0);
            modal().querySelector('#swo-total').textContent = `S-TOTAL ${fmt(tl)} L · ${fmt(tk)} KG`;
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
            // 단계·단계별 작업표준은 이 지시서에서 직접 수정한 값을 그대로 저장한다 (시방서 원본은 바뀌지 않음)
            const materials = currentMats().map((m, i) => ({
                ...m,
                stage: modal().querySelector(`.swo-stage[data-seq="${m.seq}"]`)?.value.trim() || m.stage || ''
            }));
            const workStandard = [...modal().querySelectorAll('.swo-std-row')].map(inp => inp.value.trim());
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
                materials,
                workStandard,
                qcItems: o.status === 'COMPLETED' && o.qcItems ? o.qcItems : (r.qcItems || []),
                brands: o.status === 'COMPLETED' && o.brands ? o.brands : (r.brands || []),
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
        w.document.write(buildWorkLogHtml(o));
        w.document.close();
    };

    // 엑셀 작업일지 시트(A1:AI55)를 옮긴 템플릿(data/worklogTemplate.json)에 작업지시서 값을 채워 A4 한 장으로 출력
    // - 열 너비·행 높이·병합·글꼴·정렬·테두리는 엑셀과 같고, 엑셀의 '한 페이지에 맞춤'처럼 전체를 같은 비율로 줄인다
    // - 칸보다 긴 글자는 그 칸만 글씨를 줄여 칸 안에 넣는다
    const buildWorkLogHtml = (o) => {
        const recipe = secure.recipes.find(r => r.id === o.recipeId);
        const mats = o.materials || [];
        const std = o.workStandard || [];
        const brands = o.brands || recipe?.brands || [];
        const qcBySlot = {};
        (o.qcItems || []).forEach(q => { const k = CIRCLED.indexOf(q.no); if (k >= 0) qcBySlot[k] = q; });
        const res = o.qcResults || {};
        const numbered = (list, from) => list.map((b, i) => `${from + i}. ${b}`).join('\n');
        // 엑셀 표시 형식과 같게: L·KG '#,##0.00', SG '0.0000', 날짜 'yyyy년 m월 d일 (요일)'
        const fix = (n, d) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n)) ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
        const longDate = (dt) => `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${'일월화수목금토'[dt.getDay()]}요일)`;
        const val = (key) => {
            if (!key) return '';
            const [grp, field, idx] = key.split('.');
            if (grp === 'mat') {
                const m = mats[Number(idx)];
                if (field === 'std') return std[Number(idx)] || '';
                if (!m) return '';
                return { stage: m.stage || '', code: m.rawCode || '', l: fix(m.liters, 2), kg: fix(m.kg, 2), sg: fix(m.sg, 4) }[field] ?? '';
            }
            if (grp === 'qc') {
                const q = qcBySlot[Number(idx)];
                if (!q) return field === 'no' ? CIRCLED[Number(idx)] : '';
                return { no: q.no, item: q.item, std: q.standard || '', val: res[q.no] || '' }[field] ?? '';
            }
            const map = {
                printDate: longDate(new Date()),
                orderNo: o.orderNo,
                productName: o.productName,
                revision: o.revision,
                mfgDate: o.mfgDate,
                workInstruction: o.workInstruction,
                prodQty: o.prodQty ? `${fmt(o.prodQty)} ${o.prodUnit || ''}`.trim() : '',
                actualQty: o.actualQty ? `${fmt(o.actualQty)} ${o.prodUnit || ''}`.trim() : '',
                lotNo: o.lotNo, customer: o.customer, marking: o.marking, qualityMark: o.qualityMark, grade: o.grade, packaging: o.packaging,
                totalL: fix(mats.reduce((s, m) => s + (Number(m.liters) || 0), 0), 2),
                totalKg: fix(mats.reduce((s, m) => s + (Number(m.kg) || 0), 0), 2),
                brandLabel: brands.length ? 'ODM' : '',
                brands1: numbered(brands.slice(0, 10), 1),
                brands2: numbered(brands.slice(10), 11),
                processViscosity: o.processViscosity, stickerName: o.stickerName, volumeSg: o.volumeSg, volumeWt: o.volumeWt,
                packContainer: o.packContainer, packLeak: o.packLeak,
                verdict: o.verdict, author: o.author, confirmer: o.confirmer, worker: o.worker,
                docNo: o.docNo || 'DLS-QP-113-1(1) 작업일지',
                workStatus: o.workStatus, adjustNotes: o.adjustNotes
            };
            return map[key] ?? '';
        };

        const T = worklogTemplate;
        // 엑셀 단위 → 화면 px (열: 문자폭 × 7px, 행: pt × 4/3)
        const colPx = T.cols.map(cw => Math.round(cw * 7));
        const rowPx = T.rows.map(h => Math.round(h * 4 / 3 * 100) / 100);
        const tableW = colPx.reduce((a, b) => a + b, 0);
        const tableH = rowPx.reduce((a, b) => a + b, 0);
        // 인쇄 영역: A4 210×297mm − 여백(위 10, 좌우 7, 아래 7mm)
        const pxPerMm = 96 / 25.4;
        const availW = (210 - 7 - 7) * pxPerMm;
        const availH = (297 - 10 - 7) * pxPerMm;
        const zoom = Math.min(availW / tableW, availH / tableH);

        const FONT = {
            '굴림': "'Gulim', '굴림'", '굴림체': "'GulimChe', '굴림체', 'Gulim'", '돋움': "'Dotum', '돋움'", '바탕': "'Batang', '바탕'",
            '새굴림': "'New Gulim', '새굴림', 'Gulim'", 'HY견고딕': "'HYGothic-Extra', 'HY견고딕', 'Malgun Gothic'", '휴먼모음T': "'HumanMoeumT', '휴먼모음T', 'Malgun Gothic'"
        };
        const H = { left: 'left', center: 'center', right: 'right', centerContinuous: 'center', justify: 'left', distributed: 'center', fill: 'left' };
        const V = { top: 'top', middle: 'middle', bottom: 'bottom', justify: 'middle', distributed: 'middle' };
        const NUMERIC = /^(mat\.(l|kg|sg)|total)/;

        // 단계가 바뀌는 원료 행 위에 구분선을 긋는다 (원료가 모두 1단계뿐이면 선 없음).
        // mat.<field>.<idx> 칸이 있는 엑셀 행 번호를 원료 순서(idx)별로 찾아둔다 (원료 1개 = 행 1개).
        const matRowOf = {};
        T.cells.forEach(c => { const mm = /^mat\.\w+\.(\d+)$/.exec(c.k || ''); if (mm) matRowOf[Number(mm[1])] = c.r; });
        const stageBreakRows = new Set();
        mats.forEach((m, i) => {
            if (i === 0) return;
            if ((m.stage || '') !== (mats[i - 1].stage || '') && matRowOf[i] !== undefined) stageBreakRows.add(matRowOf[i]);
        });

        const body = [];
        const byRow = new Map();
        T.cells.forEach(c => { if (!byRow.has(c.r)) byRow.set(c.r, []); byRow.get(c.r).push(c); });
        for (let r = 1; r <= T.rows.length; r++) {
            const stageBreak = stageBreakRows.has(r);
            const tds = (byRow.get(r) || []).map(c => {
                const s = c.s || {};
                const value = c.k ? val(c.k) : '';
                const text = [c.label || c.t || '', value].filter(x => x !== '' && x !== undefined && x !== null).join(c.label || (c.t && value) ? ' ' : '');
                const multiline = s.w || c.k === 'workStatus' || c.k === 'adjustNotes' || /^brands/.test(c.k || '');
                // 자유 기록 칸(작업현황·Adjust)은 왼쪽 위부터 쓴다
                const memo = c.k === 'workStatus' || c.k === 'adjustNotes';
                const hAlign = memo ? 'left' : (H[s.h] || (NUMERIC.test(c.k || '') ? 'right' : 'left'));
                const vAlign = memo ? 'top' : (V[s.v] || (multiline ? 'top' : 'bottom'));
                const style = [
                    s.fs ? `font-size:${s.fs}pt` : 'font-size:11pt',
                    s.b && !memo ? 'font-weight:bold' : '',
                    `font-family:${FONT[s.ff] || "'Gulim'"}, 'Malgun Gothic', sans-serif`,
                    `text-align:${hAlign}`,
                    `vertical-align:${vAlign}`,
                    stageBreak ? 'border-top:1.5pt solid #000' : (s.bt ? `border-top:${s.bt} #000` : ''), s.br ? `border-right:${s.br} #000` : '',
                    s.bb ? `border-bottom:${s.bb} #000` : '', s.bl ? `border-left:${s.bl} #000` : '',
                    s.bg ? `background:${s.bg}` : ''
                ].filter(Boolean).join(';');
                const span = `${c.cs ? ` colspan="${c.cs}"` : ''}${c.rs ? ` rowspan="${c.rs}"` : ''}`;
                // 칸 크기를 엑셀 행 높이로 고정 (글이 길어도 행이 늘어나지 않고 글씨가 줄어든다)
                const boxH = rowPx.slice(r - 1, r - 1 + (c.rs || 1)).reduce((a, b) => a + b, 0) - 1;
                const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[vAlign];
                return `<td${span} style="${style}"><div class="in" style="height:${Math.max(boxH, 1)}px;justify-content:${justify}"><span class="tx${multiline ? ' ml' : ''}">${esc(text)}</span></div></td>`;
            }).join('');
            body.push(`<tr style="height:${rowPx[r - 1]}px">${tds}</tr>`);
        }

        return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>작업일지 ${esc(o.orderNo)}</title>
        <style>
            @page { size: A4 portrait; margin: 10mm 7mm 7mm 7mm; }
            * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            html, body { margin: 0; padding: 0; background: #e5e7eb; }
            .sheet { width: ${Math.floor(availW)}px; margin: 8mm auto; background: #fff; box-shadow: 0 0 4mm rgba(0,0,0,.2); }
            .scale { zoom: ${zoom.toFixed(4)}; margin: 0 auto; width: ${tableW}px; }
            @media print { html, body { background: #fff; } .sheet { margin: 0 auto; box-shadow: none; } }
            table { border-collapse: collapse; table-layout: fixed; width: ${tableW}px; color: #000; }
            td { padding: 0; overflow: hidden; }
            .in { display: flex; flex-direction: column; overflow: hidden; padding: 0 2px; }
            .tx { white-space: pre; line-height: 1.15; }
            .tx.ml { white-space: pre-wrap; word-break: keep-all; overflow-wrap: anywhere; }
        </style></head><body><div class="sheet"><div class="scale">
        <table><colgroup>${colPx.map(px => `<col style="width:${px}px">`).join('')}</colgroup>${body.join('')}</table>
        </div></div>
        <script>
            // 칸보다 긴 글자는 그 칸의 글씨만 줄여서 칸 안에 넣는다
            const fit = () => {
                document.querySelectorAll('td .tx').forEach(tx => {
                    if (!tx.textContent) return;
                    const box = tx.parentElement;
                    const td = box.parentElement;
                    const cs = getComputedStyle(box);
                    const maxW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
                    const maxH = box.clientHeight;
                    let size = parseFloat(getComputedStyle(td).fontSize);
                    const tooBig = () => tx.scrollWidth > maxW + 0.5 || tx.offsetHeight > maxH + 0.5;
                    // 좁고 높은 칸(예: 세로 결재란 '품 질')은 글씨를 줄이기 전에 줄바꿈부터 한다
                    if (tooBig() && !tx.classList.contains('ml') && /\\s/.test(tx.textContent.trim()) && maxH >= size * 2.4 && maxW < size * 3) {
                        tx.classList.add('ml');
                    }
                    let guard = 50;
                    while (tooBig() && size > 4 && guard--) { size *= 0.93; td.style.fontSize = size + 'px'; }
                });
            };
            const W = ${availW.toFixed(2)}, Hh = ${availH.toFixed(2)};
            const scale = document.querySelector('.scale');
            const table = scale.querySelector('table');
            // 1) 높이를 인쇄 영역에 맞추고 2) 남는 가로 폭만큼 열 너비를 같은 비율로 넓혀 좌우 여백을 없앤다
            const fitPage = () => {
                scale.style.zoom = 1;
                const z = Hh / table.offsetHeight * 0.995;
                scale.style.zoom = z.toFixed(4);
                const k = (W * 0.995) / table.getBoundingClientRect().width;
                if (k > 1) {
                    let sum = 0;
                    table.querySelectorAll('col').forEach(col => {
                        const w = Math.floor(parseFloat(col.style.width) * k * 100) / 100;
                        col.style.width = w + 'px';
                        sum += w;
                    });
                    // 표 너비 = 열 너비 합계 (더 크게 주면 브라우저가 남는 폭을 열에 나눠 표가 넘친다)
                    table.style.width = sum + 'px';
                    scale.style.width = sum + 'px';
                }
            };
            // 픽셀 반올림 등으로 인쇄 영역을 넘으면 배율을 조금씩 줄인다
            const clampPage = () => {
                let z = parseFloat(scale.style.zoom) || 1;
                for (let i = 0; i < 6; i++) {
                    const r = table.getBoundingClientRect();
                    const over = Math.max(r.width / W, r.height / Hh);
                    if (over <= 0.998) break;
                    z = z / over * 0.995;
                    scale.style.zoom = z.toFixed(4);
                }
            };
            window.onload = () => { fitPage(); fit(); clampPage(); if (!window.__noPrint) { window.focus(); window.print(); } };
        <\/script>
        </body></html>`;
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
                                <button type="button" class="sr-history p-1 text-slate-500 hover:text-indigo-600" data-id="${esc(r.id)}" title="개정이력·되돌리기"><i data-lucide="history" class="w-4 h-4"></i></button>
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
        container.querySelectorAll('.sr-history').forEach(b => b.addEventListener('click', () => openRecipeHistory(byId(b.dataset.id))));
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

    // 원료 하나의 배치 원료비 = 최근 단가(원/L, 원료수불부 기준) × 배합 L. 재고 연결(itemCode)이 있으면 그 코드로,
    // 없으면 원료 실명으로 원료수불부 최근 전표를 찾는다. 화면 표시용 산출이며 시방서에 저장하지 않는다.
    const openRecipeEditor = (r) => {
        if (!r) return;
        const qcRow = (q, i) => `<tr class="sr-qc-row" data-i="${i}">
            <td class="p-1.5"><input class="sr-qc-no w-14 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 font-mono text-center" value="${esc(q.no ?? '')}" /></td>
            <td class="p-1.5"><input class="sr-qc-item w-full bg-slate-50 border border-slate-300 rounded px-1.5 py-1" value="${esc(q.item ?? '')}" placeholder="시험 항목" /></td>
            <td class="p-1.5"><input class="sr-qc-std w-full bg-slate-50 border border-slate-300 rounded px-1.5 py-1" value="${esc(q.standard ?? '')}" placeholder="검사 기준" /></td>
            <td class="p-1.5 text-center"><button type="button" class="sr-qc-del text-slate-400 hover:text-rose-600"><i data-lucide="x" class="w-4 h-4"></i></button></td>
        </tr>`;
        openModal(`
        <form id="sr-form" class="bg-white rounded-2xl shadow-xl w-full max-w-4xl my-6 p-5 space-y-4 text-xs">
            <div class="flex items-center justify-between">
                <h3 class="font-black text-sm text-slate-900">🔒 제조시방서 · ${esc(r.productName)} <span class="font-mono text-slate-500">${esc(r.revision)}</span></h3>
                <div class="flex items-center gap-2">
                    <button type="button" class="sr-open-history px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-black flex items-center gap-1"><i data-lucide="history" class="w-4 h-4"></i>버전 이력</button>
                    <button type="button" class="sr-close text-slate-400 hover:text-slate-700"><i data-lucide="x" class="w-5 h-5"></i></button>
                </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <label class="block"><span class="font-bold text-slate-600">제품명</span><input id="sr-name" value="${esc(r.productName)}" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                <label class="block"><span class="font-bold text-slate-600">관련근거 (Rev)</span><input id="sr-rev" value="${esc(r.revision)}" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                <label class="block col-span-2 relative"><span class="font-bold text-slate-600">생산 원액 품목 (재고 입고 연결)</span>
                    <input id="sr-product" value="${esc(r.productItemCode)}" placeholder="원액 코드·이름 일부 검색" autocomplete="off" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-mono font-bold" />
                    <div id="sr-product-name" class="text-[10px] mt-0.5 ${r.productItemCode && state.master.find(x => x.code === r.productItemCode) ? 'text-emerald-700' : 'text-slate-400'}">${esc((state.master.find(x => x.code === r.productItemCode) || {}).name || '')}</div>
                </label>
            </div>
            <div class="overflow-x-auto border border-slate-200 rounded-xl"><table class="w-full"><thead class="bg-slate-50 font-bold text-slate-600"><tr>
                <th class="p-2 text-left">순</th><th class="p-2 text-left text-amber-700">원료명 (대외비)</th><th class="p-2 text-left">원료코드 (인쇄)</th>
                <th class="p-2 text-right">L</th><th class="p-2 text-right">wt%</th><th class="p-2 text-right">KG</th><th class="p-2 text-right">SG</th>
                <th class="p-2 text-left">재고 품목 검색·연결</th><th class="p-2 text-right whitespace-nowrap">단가</th><th class="p-2 text-center whitespace-nowrap">기준</th><th class="p-2 text-right whitespace-nowrap">원료비(원)</th>
            </tr></thead><tbody class="divide-y divide-slate-100">
                ${r.materials.map((m, i) => {
                    const item = m.itemCode ? state.master.find(x => x.code === m.itemCode) : null;
                    const priceUnit = m.priceUnit === 'KG' ? 'KG' : 'L';
                    const unitPrice = m.unitPrice > 0 ? m.unitPrice : (latestRawUnitPrice(m.itemCode, m.name) || '');
                    return `<tr>
                    <td class="p-2 font-mono">${esc(m.seq)}</td>
                    <td class="p-2 font-bold text-amber-800">${esc(m.name)}</td>
                    <td class="p-2"><input class="sr-rawcode w-32 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 font-mono font-bold" data-i="${i}" value="${esc(m.rawCode)}" /></td>
                    <td class="p-2 text-right font-mono">${fmt(m.liters)}</td><td class="p-2 text-right font-mono">${fmt(m.wtPct)}</td>
                    <td class="p-2 text-right font-mono">${fmt(m.kg)}</td><td class="p-2 text-right font-mono">${fmt(m.sg, 4)}</td>
                    <td class="p-2 relative"><input class="sr-item w-36 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 font-mono" data-i="${i}" value="${esc(m.itemCode)}" placeholder="코드·이름 일부 검색" autocomplete="off" />
                        <div class="sr-item-name text-[10px] mt-0.5 ${item ? 'text-emerald-700' : (m.itemCode ? 'text-rose-500' : 'text-slate-400')}" data-i="${i}">${esc(item?.name || '')}</div></td>
                    <td class="p-2"><input class="sr-price-input w-24 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 text-right font-mono" type="number" min="0" step="any" data-i="${i}" value="${esc(unitPrice)}" placeholder="원" /></td>
                    <td class="p-2 text-center"><select class="sr-price-unit bg-slate-50 border border-slate-300 rounded px-1 py-1 font-bold" data-i="${i}">
                        <option value="L" ${priceUnit === 'L' ? 'selected' : ''}>원/L</option>
                        <option value="KG" ${priceUnit === 'KG' ? 'selected' : ''}>원/KG</option>
                    </select></td>
                    <td class="p-2 text-right font-mono sr-amount" data-i="${i}">-</td>
                </tr>`;
                }).join('')}
                <tr class="bg-slate-50 font-bold"><td colspan="3" class="p-2 text-center">S-TOTAL (${fmt(r.baseQty)} ${esc(r.baseUnit)})</td>
                    <td class="p-2 text-right font-mono">${fmt(r.materials.reduce((s, m) => s + (m.liters || 0), 0))}</td>
                    <td class="p-2 text-right font-mono">${fmt(r.materials.reduce((s, m) => s + (m.wtPct || 0), 0))}</td>
                    <td class="p-2 text-right font-mono">${fmt(r.materials.reduce((s, m) => s + (m.kg || 0), 0))}</td><td></td><td></td><td></td>
                    <td id="sr-cost-total" class="p-2 text-right font-mono text-slate-700">-</td></tr>
            </tbody></table></div>
            <p class="text-[11px] text-slate-500">단가를 입력하면 기준(원/L 또는 원/KG)에 따라 원료비가 자동 계산되어 시방서에 저장됩니다. 처음에는 원료수불부 최근 입고 단가를 참고용으로 채워 둡니다.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label class="block"><span class="font-black text-slate-800">작업표준 <span class="font-normal text-slate-400">(한 줄에 하나씩)</span></span>
                    <textarea id="sr-workstd" rows="6" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-mono">${esc(r.workStandard.join('\n'))}</textarea></label>
                <label class="block"><span class="font-black text-slate-800">개정 이력 <span class="font-normal text-slate-400">(한 줄에 하나씩)</span></span>
                    <textarea id="sr-history" rows="6" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-mono">${esc(r.history.join('\n'))}</textarea></label>
                <label class="block"><span class="font-black text-slate-800">적용 ODM 제품 <span class="font-normal text-slate-400">(한 줄에 하나씩)</span></span>
                    <textarea id="sr-brands" rows="5" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-mono">${esc(r.brands.join('\n'))}</textarea></label>
                <div>
                    <div class="flex items-center justify-between mb-1">
                        <span class="font-black text-slate-800">검사 항목</span>
                        <button type="button" id="sr-qc-add" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold flex items-center gap-1"><i data-lucide="plus" class="w-3.5 h-3.5"></i>행 추가</button>
                    </div>
                    <table class="w-full border border-slate-200 rounded-lg overflow-hidden"><thead class="bg-slate-50 text-slate-500"><tr>
                        <th class="p-1.5 text-center w-14">No</th><th class="p-1.5 text-left">시험 항목</th><th class="p-1.5 text-left">검사 기준</th><th class="p-1.5 w-8"></th>
                    </tr></thead><tbody id="sr-qc-body" class="divide-y divide-slate-100">${r.qcItems.map(qcRow).join('')}</tbody></table>
                </div>
            </div>
            <p class="text-[11px] text-slate-500">재고 품목코드를 연결한 원료만 생산 완료 시 재고·원료수불부에서 차감됩니다. 출처: ${esc(r.sourceFile || '-')} · 문서 ${esc(r.docNo || '-')} · 작성 ${esc(r.author || '-')}</p>
            <div class="flex justify-end gap-2">
                <button type="button" class="sr-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button>
                <button type="submit" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black">저장</button>
            </div>
        </form>`);

        // 원료비 = 입력한 단가 × 기준 수량(원/L이면 배합 L, 원/KG이면 배합 KG). 기준·단가는 시방서에 저장된다.
        const renderCost = () => {
            let total = 0;
            r.materials.forEach((m, i) => {
                const priceInp = modal().querySelector(`.sr-price-input[data-i="${i}"]`);
                const unitSel = modal().querySelector(`.sr-price-unit[data-i="${i}"]`);
                const amountCell = modal().querySelector(`.sr-amount[data-i="${i}"]`);
                const price = Number(priceInp?.value) || 0;
                const basisQty = unitSel?.value === 'KG' ? (Number(m.kg) || 0) : (Number(m.liters) || 0);
                if (price > 0) {
                    const amount = price * basisQty;
                    total += amount;
                    if (amountCell) amountCell.textContent = fmt(amount, 0);
                } else if (amountCell) {
                    amountCell.textContent = '-';
                }
            });
            const totalCell = modal().querySelector('#sr-cost-total');
            if (totalCell) totalCell.textContent = total > 0 ? `${fmt(total, 0)}` : '-';
        };
        const updateItemName = (inp) => {
            const nameEl = modal().querySelector(`.sr-item-name[data-i="${inp.dataset.i}"]`);
            if (!nameEl) return;
            const item = state.master.find(x => x.code === inp.value.trim());
            nameEl.textContent = item?.name || '';
            nameEl.className = `sr-item-name text-[10px] mt-0.5 ${item ? 'text-emerald-700' : (inp.value.trim() ? 'text-rose-500' : 'text-slate-400')}`;
        };
        modal().querySelectorAll('.sr-item').forEach(inp => {
            attachItemSearch(inp, rawItems, () => { updateItemName(inp); renderCost(); });
            inp.addEventListener('input', () => { updateItemName(inp); renderCost(); });
        });
        modal().querySelectorAll('.sr-price-input, .sr-price-unit').forEach(el => el.addEventListener('input', renderCost));
        const productInput = modal().querySelector('#sr-product');
        const updateProductName = () => {
            const nameEl = modal().querySelector('#sr-product-name');
            const item = state.master.find(x => x.code === productInput.value.trim());
            nameEl.textContent = item?.name || '';
            nameEl.className = `text-[10px] mt-0.5 ${item ? 'text-emerald-700' : (productInput.value.trim() ? 'text-rose-500' : 'text-slate-400')}`;
        };
        attachItemSearch(productInput, wonaekItems, updateProductName);
        productInput.addEventListener('input', updateProductName);
        renderCost();

        const qcBody = modal().querySelector('#sr-qc-body');
        const bindQcDelete = () => qcBody.querySelectorAll('.sr-qc-del').forEach(b => b.addEventListener('click', () => { b.closest('.sr-qc-row').remove(); }));
        bindQcDelete();
        modal().querySelector('#sr-qc-add').addEventListener('click', () => {
            qcBody.insertAdjacentHTML('beforeend', qcRow({}, qcBody.children.length));
            bindQcDelete();
        });

        modal().querySelectorAll('.sr-close').forEach(b => b.addEventListener('click', closeModal));
        modal().querySelector('.sr-open-history').addEventListener('click', () => openRecipeHistory(r));
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
            modal().querySelectorAll('.sr-price-input').forEach(inp => { materials[inp.dataset.i].unitPrice = Number(inp.value) || 0; });
            modal().querySelectorAll('.sr-price-unit').forEach(sel => { materials[sel.dataset.i].priceUnit = sel.value === 'KG' ? 'KG' : 'L'; });
            const productItemCode = productInput.value.trim();
            if (productItemCode && !state.master.some(m => m.code === productItemCode)) bad.push(productItemCode);
            if (bad.length) { alert(`품목 마스터에 없는 품목코드입니다: ${bad.join(', ')}`); return; }
            const codes = materials.map(m => m.rawCode).filter(Boolean);
            if (new Set(codes).size !== codes.length) { alert('한 시방서 안에서 원료코드가 중복되었습니다.'); return; }
            const splitLines = (id) => modal().querySelector(id).value.split('\n').map(s => s.trim()).filter(Boolean);
            const qcItems = [...modal().querySelectorAll('.sr-qc-row')].map(row => ({
                no: row.querySelector('.sr-qc-no').value.trim(),
                item: row.querySelector('.sr-qc-item').value.trim(),
                standard: row.querySelector('.sr-qc-std').value.trim()
            })).filter(q => q.item || q.standard);
            await run(() => saveRecipe({
                ...r, materials, productItemCode,
                productName: modal().querySelector('#sr-name').value.trim() || r.productName,
                revision: modal().querySelector('#sr-rev').value.trim(),
                workStandard: splitLines('#sr-workstd'),
                history: splitLines('#sr-history'),
                brands: splitLines('#sr-brands'),
                qcItems
            }), '제조시방서를 저장했습니다.');
        });
    };

    // ==========================================
    // 제조시방서 개정이력(자동 스냅샷) 열람·되돌리기
    // ==========================================
    const openRecipeHistory = async (r) => {
        let revisions;
        try { revisions = await listRecipeRevisions(r.id); } catch (err) { alert(err.message); return; }
        openModal(`
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-10 p-5 space-y-3 text-xs">
            <div class="flex items-center justify-between">
                <h3 class="font-black text-sm text-slate-900">🕘 개정이력 · ${esc(r.productName)} <span class="font-mono text-slate-500">${esc(r.revision)}</span></h3>
                <button type="button" class="srh-close text-slate-400 hover:text-slate-700"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <p class="text-slate-500">저장할 때마다 바뀌기 직전 내용이 자동으로 남습니다. 되돌리면 되돌리기 전 현재 내용도 새 이력으로 남습니다.</p>
            <div class="overflow-y-auto max-h-96 divide-y divide-slate-100 border border-slate-200 rounded-xl">
            ${revisions.length === 0 ? '<div class="p-6 text-center text-slate-400 font-bold">저장 이력이 없습니다.</div>' : revisions.map(v => `
                <div class="p-3 flex items-center justify-between gap-3">
                    <div>
                        <div class="font-bold text-slate-800">${esc((v.createdAt || '').slice(0, 16).replace('T', ' '))}${v.author ? ` · ${esc(v.author)}` : ''}</div>
                        <div class="text-slate-500">${esc(v.note || '자동 저장')}</div>
                        <div class="text-[10px] text-slate-400">원료 ${v.snapshot?.materials?.length ?? 0}종 · 관련근거 ${esc(v.snapshot?.revision || '-')}</div>
                    </div>
                    <button type="button" class="srh-restore px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-black whitespace-nowrap" data-id="${esc(v.id)}">이 시점으로 복원</button>
                </div>`).join('')}
            </div>
            <div class="flex justify-end"><button type="button" class="srh-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button></div>
        </div>`);
        modal().querySelectorAll('.srh-close').forEach(b => b.addEventListener('click', () => openRecipeEditor(secure.recipes.find(x => x.id === r.id))));
        modal().querySelectorAll('.srh-restore').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('이 시점의 내용으로 되돌리시겠습니까? 되돌리기 전 현재 내용은 새 이력으로 남습니다.')) return;
            try {
                const restored = await restoreRecipeRevision(r.id, b.dataset.id);
                showToast(`🔒 ${restored.productName} 시방서를 이전 시점으로 되돌렸습니다.`);
                render();
                openRecipeEditor(restored);
            } catch (err) { alert(err.message); }
        }));
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
