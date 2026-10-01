import { getSupabase } from '../services/supabase.js';
import { matchesQuery } from '../services/searchUtils.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

// ==========================================
// 원액생산 작업지시서 — '작업지시서 사용자' 화면 (supabase/auth/42_work_order_user.sql)
// ==========================================
// 역할에 더하는 권한. 제조시방서는 메뉴·자료 모두 없고, 작업지시서는 DB 함수 wms_wo_orders()가 돌려주는
// 사본(원료 실명·배합비·재고 품목코드 제외, 원료코드·L·KG·SG만)으로만 본다.
// 수정은 생산량·생산량 단위뿐이며 DB 함수 wms_wo_set_qty()가 원료 소요량을 비율대로 다시 계산한다(생산 완료·취소 지시서는 불가).

const fmt = (n, d = 3) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const STATUS = {
    DRAFT: ['작성 중', 'bg-slate-100 text-slate-700 border-slate-300'],
    ISSUED: ['발행', 'bg-blue-50 text-blue-700 border-blue-200'],
    COMPLETED: ['생산 완료', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
    CANCELLED: ['취소', 'bg-rose-50 text-rose-700 border-rose-200']
};
const badge = (s) => `<span class="inline-block whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-extrabold border ${STATUS[s]?.[1] || ''}">${STATUS[s]?.[0] || esc(s)}</span>`;
const UNITS = ['D/M', 'L', 'KG', '통', 'EA'];
const editable = (o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED';
const toOrder = (row) => ({ ...(row.data || {}), id: row.id, orderNo: row.orderNo, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt });

/**
 * @param opts.printWorkLog (order) => 작업일지 인쇄 (원료코드로만 표기, 대외비 마크)
 */
export const mountWoUserView = (container, { showToast = () => {}, printWorkLog = null } = {}) => {
    let orders = [];
    let loading = true;
    let error = '';
    let status = '';
    let q = '';
    const $ = (s) => container.querySelector(s);

    const load = async () => {
        loading = true;
        error = '';
        draw();
        try {
            const { data, error: e } = await getSupabase().rpc('wms_wo_orders');
            if (e) throw new Error(e.message);
            orders = (data || []).map(toOrder);
        } catch (e) {
            error = `작업지시서를 불러오지 못했습니다: ${e.message}`;
            orders = [];
        }
        loading = false;
        draw();
    };

    const list = () => orders.filter(o => (!status || o.status === status)
        && matchesQuery({ orderNo: o.orderNo, productName: o.productName, lotNo: o.lotNo, revision: o.revision }, q, ['orderNo', 'productName', 'lotNo', 'revision']));

    const draw = () => {
        const rows = list();
        container.innerHTML = `
        <div class="space-y-4 text-xs">
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
                <h2 class="text-lg font-black text-slate-900 flex flex-wrap items-center gap-2"><i data-lucide="clipboard-list" class="w-5 h-5 text-amber-600"></i>원액생산 작업지시서 <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">작업지시서 사용자</span></h2>
                <p class="text-xs text-slate-500 mt-1">작업지시서를 열람하고 <b>생산량·생산량 단위만</b> 고칠 수 있습니다. 원료는 원료코드로만 보이며, 제조시방서와 원료명·배합비는 볼 수 없습니다.</p>
            </div>
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <label><span class="font-bold text-slate-500">상태</span>
                        <select id="wu-status" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"><option value="">전체</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
                    <label class="md:col-span-2"><span class="font-bold text-slate-500">검색</span>
                        <input id="wu-q" value="${esc(q)}" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" placeholder="지시번호·제품명·LOT" /></label>
                    <div class="flex items-end"><button type="button" id="wu-reload" class="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold flex items-center justify-center gap-1"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>새로고침</button></div>
                </div>
                ${loading ? '<div class="p-8 text-center text-slate-400 font-bold">불러오는 중…</div>'
                    : error ? `<div class="p-6 text-center text-rose-600 font-bold">${esc(error)}</div>`
                    : !rows.length ? '<div class="p-8 text-center text-slate-400 font-bold">조건에 맞는 작업지시서가 없습니다.</div>'
                    : `<div class="overflow-x-auto border border-slate-200 rounded-xl"><table class="w-full min-w-[760px]">
                        <thead class="bg-slate-50 text-slate-600 font-bold"><tr><th class="p-2 text-left">지시번호</th><th class="p-2 text-left">제조일자</th><th class="p-2 text-left">제품명</th><th class="p-2 text-right">생산량</th><th class="p-2 text-left">상태</th><th class="p-2 text-left">생산량 변경</th><th class="p-2 text-right">관리</th></tr></thead>
                        <tbody class="divide-y divide-slate-100">${rows.map(o => `<tr data-id="${esc(o.id)}" class="hover:bg-slate-50">
                            <td class="p-2 font-mono font-black">${esc(o.orderNo)}</td>
                            <td class="p-2 whitespace-nowrap">${esc(o.mfgDate || '')}</td>
                            <td class="p-2 font-bold">${esc(o.productName || '')} <span class="font-normal text-slate-400">${esc(o.revision || '')}</span>${o.lotNo ? `<div class="text-[10px] text-slate-500">LOT ${esc(o.lotNo)}</div>` : ''}</td>
                            <td class="p-2 text-right font-mono font-black whitespace-nowrap">${fmt(o.prodQty)} ${esc(o.prodUnit || '')}</td>
                            <td class="p-2">${badge(o.status)}</td>
                            <td class="p-2 text-[10px] text-slate-500">${o.qtyChangedAt ? `${esc(o.qtyChangedBy || '')}<br>${esc(new Date(o.qtyChangedAt).toLocaleString('ko-KR'))}` : '-'}</td>
                            <td class="p-2 text-right whitespace-nowrap">
                                <button type="button" class="wu-view px-2 py-1 bg-slate-800 text-white rounded font-bold">보기</button>
                                ${editable(o) ? '<button type="button" class="wu-qty px-2 py-1 bg-white border border-indigo-300 text-indigo-700 rounded font-bold">생산량 수정</button>' : ''}
                                ${printWorkLog ? '<button type="button" class="wu-print px-2 py-1 bg-white border border-slate-300 rounded font-bold">작업일지 인쇄</button>' : ''}
                            </td></tr>`).join('')}</tbody></table></div>`}
            </div>
        </div>`;
        const byId = (el) => orders.find(o => o.id === el.closest('tr[data-id]').dataset.id);
        $('#wu-status').addEventListener('change', (e) => { status = e.target.value; draw(); });
        $('#wu-q').addEventListener('input', (e) => { q = e.target.value; const pos = e.target.selectionStart; draw(); const inp = $('#wu-q'); inp.focus(); inp.setSelectionRange(pos, pos); });
        $('#wu-reload').addEventListener('click', load);
        container.querySelectorAll('.wu-view').forEach(b => b.addEventListener('click', () => openView(byId(b))));
        container.querySelectorAll('.wu-qty').forEach(b => b.addEventListener('click', () => openQty(byId(b))));
        container.querySelectorAll('.wu-print').forEach(b => b.addEventListener('click', () => printWorkLog(byId(b))));
        createIcons({ icons });
    };

    const modal = (title, body, foot) => {
        const ov = document.createElement('div');
        ov.className = 'fixed inset-0 z-[9000] bg-slate-900/60 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto text-xs';
        ov.innerHTML = `<div class="bg-white w-full max-w-3xl rounded-2xl shadow-2xl my-4">
            <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200"><div class="font-black text-sm text-slate-800">${title}</div>
                <button type="button" class="wu-close text-slate-400 hover:text-slate-700 font-black text-lg px-2">✕</button></div>
            <div class="p-4 space-y-3">${body}</div>
            <div class="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-2xl">${foot}</div></div>`;
        document.body.appendChild(ov);
        const close = () => ov.remove();
        ov.querySelectorAll('.wu-close').forEach(b => b.addEventListener('click', close));
        return { ov, close, q: (s) => ov.querySelector(s) };
    };

    const matsTable = (o, factor = 1) => {
        const mats = o.materials || [];
        const tl = mats.reduce((a, m) => a + (Number(m.liters) || 0), 0) * factor;
        const tk = mats.reduce((a, m) => a + (Number(m.kg) || 0), 0) * factor;
        return `<div class="overflow-x-auto border border-slate-200 rounded-xl"><table class="w-full">
            <thead class="bg-slate-50 text-slate-600 font-bold"><tr><th class="p-2 text-left">순</th><th class="p-2 text-left">단계</th><th class="p-2 text-left">원료코드</th><th class="p-2 text-right">L</th><th class="p-2 text-right">KG</th><th class="p-2 text-right">SG</th><th class="p-2 text-left">작업표준</th></tr></thead>
            <tbody class="divide-y divide-slate-100">${mats.map((m, i) => `<tr>
                <td class="p-2 font-mono">${esc(m.seq ?? i + 1)}</td><td class="p-2">${esc(m.stage || '')}</td>
                <td class="p-2 font-mono font-black ${m.rawCode ? '' : 'text-rose-600'}">${esc(m.rawCode || '원료코드 없음')}</td>
                <td class="p-2 text-right font-mono font-bold">${fmt((Number(m.liters) || 0) * factor)}</td><td class="p-2 text-right font-mono">${fmt((Number(m.kg) || 0) * factor)}</td>
                <td class="p-2 text-right font-mono">${fmt(m.sg, 4)}</td><td class="p-2 text-slate-600">${esc((o.workStandard || [])[i] || '')}</td></tr>`).join('')}</tbody>
            <tfoot class="bg-slate-50 font-black"><tr><td colspan="3" class="p-2 text-right">S-TOTAL</td><td class="p-2 text-right font-mono">${fmt(tl)} L</td><td class="p-2 text-right font-mono">${fmt(tk)} KG</td><td colspan="2"></td></tr></tfoot>
        </table></div>`;
    };

    const openView = (o) => {
        const field = (k, v) => `<div><div class="text-[10px] font-bold text-slate-500">${k}</div><div class="font-bold text-slate-800">${esc(v ?? '') || '-'}</div></div>`;
        const { close, q: qq } = modal(`작업지시서 · ${esc(o.orderNo)} ${badge(o.status)}`, `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                ${field('제품명', o.productName)}${field('관련근거', o.revision)}${field('제조일자', o.mfgDate)}${field('생산량', `${fmt(o.prodQty)} ${o.prodUnit || ''}`)}
                ${field('실생산량', o.actualQty ? `${fmt(o.actualQty)} ${o.prodUnit || ''}` : '')}${field('LOT', o.lotNo)}${field('작업지시', o.workInstruction)}${field('작성자', o.author)}
            </div>
            <div class="font-black text-slate-800">가. 작업표준 (원료코드로만 표기)</div>
            ${matsTable(o)}
            ${(o.qcItems || []).length ? `<div class="font-black text-slate-800">검사 항목</div><div class="grid grid-cols-1 md:grid-cols-2 gap-1">${o.qcItems.map(x => `<div class="flex gap-2"><span class="w-5 text-slate-500">${esc(x.no)}</span><span class="font-bold">${esc(x.item)}</span><span class="text-slate-400">${esc(x.standard || '')}</span><span class="ml-auto font-mono">${esc((o.qcResults || {})[x.no] || '')}</span></div>`).join('')}</div>` : ''}
            ${o.notes ? `<div class="text-slate-600"><b>비고</b> ${esc(o.notes)}</div>` : ''}`,
            `${editable(o) ? '<button type="button" class="wu-to-qty px-3 py-2 bg-indigo-600 text-white rounded-lg font-black">생산량 수정</button>' : ''}
             <button type="button" class="wu-close px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold">닫기</button>`);
        qq('.wu-to-qty')?.addEventListener('click', () => { close(); openQty(o); });
    };

    const openQty = (o) => {
        const { close, q: qq } = modal(`생산량 수정 · ${esc(o.orderNo)} <span class="font-normal text-slate-500">${esc(o.productName || '')}</span>`, `
            <div class="p-2 rounded-lg bg-indigo-50 text-indigo-900">생산량을 바꾸면 원료 소요량(L·KG)이 같은 비율로 다시 계산됩니다. 생산량과 단위 외에는 바꿀 수 없습니다.</div>
            <div class="grid grid-cols-2 gap-2.5">
                <label><span class="font-bold text-slate-500">생산량</span>
                    <input id="wu-qty-in" type="number" min="0" step="any" value="${esc(o.prodQty ?? '')}" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-black text-right" /></label>
                <label><span class="font-bold text-slate-500">생산량 단위</span>
                    <input id="wu-unit-in" list="wu-units" maxlength="20" value="${esc(o.prodUnit || 'D/M')}" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-black" />
                    <datalist id="wu-units">${UNITS.map(u => `<option value="${u}"></option>`).join('')}</datalist></label>
            </div>
            <div id="wu-preview"></div>`,
            `<button type="button" class="wu-close px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold">취소</button>
             <button type="button" class="wu-save px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black disabled:opacity-40">저장</button>`);
        const preview = () => {
            const nq = Number(qq('#wu-qty-in').value);
            const f = Number(o.prodQty) > 0 && nq > 0 ? nq / Number(o.prodQty) : 1;
            qq('#wu-preview').innerHTML = `<div class="font-bold text-slate-600 mb-1">바꾼 뒤 원료 소요량 (미리보기)</div>${matsTable(o, f)}`;
        };
        qq('#wu-qty-in').addEventListener('input', preview);
        preview();
        qq('.wu-save').addEventListener('click', async () => {
            const nq = Number(qq('#wu-qty-in').value);
            const unit = qq('#wu-unit-in').value.trim();
            if (!(nq > 0)) { alert('생산량을 0보다 크게 입력하세요.'); return; }
            if (!unit) { alert('생산량 단위를 입력하세요.'); return; }
            if (nq === Number(o.prodQty) && unit === (o.prodUnit || '')) { close(); return; }
            if (!confirm(`${o.orderNo} 생산량을 ${fmt(o.prodQty)} ${o.prodUnit || ''} → ${fmt(nq)} ${unit}(으)로 바꿉니다.\n원료 소요량도 같은 비율로 바뀝니다. 진행할까요?`)) return;
            const btn = qq('.wu-save');
            btn.disabled = true;
            try {
                const { data, error: e } = await getSupabase().rpc('wms_wo_set_qty', { p_id: o.id, p_qty: nq, p_unit: unit });
                if (e) throw new Error(e.message);
                const next = toOrder(data);
                orders = orders.map(x => (x.id === next.id ? next : x));
                close();
                draw();
                showToast(`📋 ${o.orderNo} 생산량을 ${fmt(nq)} ${unit}(으)로 바꿨습니다.`);
            } catch (err) {
                alert(`생산량을 바꾸지 못했습니다: ${err.message}`);
                btn.disabled = false;
            }
        });
    };

    load();
};
