import { state, LEDGER_KINDS, ledgerKindOfCategory, addItemLedgerEntry, updateItemLedgerEntry, deleteItemLedgerEntry } from '../services/db.js';
import { matchesQuery, localDateStr } from '../services/searchUtils.js';
import { sitesOf } from '../services/locations.js';
import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from 'lucide';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const ITEM_LEDGER_TYPES = ['입고', '생산입고', '출고', '사용', '이동입고', '이동출고', '재고조사', '이월'];
const TYPE_TONES = {
    '입고': 'bg-blue-50 text-blue-700 border-blue-200',
    '생산입고': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    '출고': 'bg-rose-50 text-rose-700 border-rose-200',
    '사용': 'bg-amber-50 text-amber-700 border-amber-200',
    '이동입고': 'bg-indigo-50 text-indigo-700 border-indigo-200',
    '이동출고': 'bg-violet-50 text-violet-700 border-violet-200',
    '재고조사': 'bg-teal-50 text-teal-700 border-teal-200',
    '이월': 'bg-slate-100 text-slate-700 border-slate-300'
};
export const typeBadge = (t) => `<span class="inline-block whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-extrabold border ${TYPE_TONES[t] || 'bg-slate-50 text-slate-600 border-slate-200'}">${esc(t)}</span>`;

const PAGE_SIZE = 100;

/**
 * 제품(완제품)·자재 수불부 입력·관리 화면
 * 전표 누적 방식은 원료수불부와 같다. 조회·열람·인쇄는 '수불부 조회·인쇄' 화면에서 한다.
 * @param {'product'|'material'} kind
 */
export const renderItemLedger = (container, { kind = 'material', showToast, onSwitchTab }) => {
    const info = LEDGER_KINDS[kind];
    const canWrite = canPerformAction('WRITE_STOCK');
    const sites = sitesOf(state.locations);
    const items = state.master.filter(m => ledgerKindOfCategory(m.category) === kind);
    let page = 1;

    const ledger = () => state[info.stateKey] || [];
    const monthPrefix = localDateStr().slice(0, 7);

    container.innerHTML = `
    <div class="space-y-5">
        <div class="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white p-5 sm:p-6 rounded-3xl shadow-lg">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-500/20 text-indigo-200 border border-indigo-400/30">${kind === 'product' ? '완제품' : '부자재 · 소모품 · 기타'}</span>
                    <h2 class="text-xl font-black mt-2 flex items-center gap-2">
                        <i data-lucide="${kind === 'product' ? 'package-check' : 'boxes'}" class="w-5 h-5"></i>
                        <span>${info.label}</span>
                    </h2>
                    <p class="text-xs text-slate-300 mt-1">품목·거점별 수·불 전표를 입력 순서대로 누적합니다. 입고·출고·이동·생산·실사는 자동으로 기입됩니다.</p>
                </div>
                <button type="button" id="btn-open-viewer" class="px-4 py-2 bg-white text-slate-900 hover:bg-indigo-50 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm">
                    <i data-lucide="printer" class="w-4 h-4"></i>
                    <span>수불부 조회·인쇄</span>
                </button>
            </div>
        </div>

        <div id="item-ledger-kpi" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>

        ${canWrite ? `
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2"><i data-lucide="edit-3" class="w-4 h-4 text-blue-600"></i>수불 전표 직접 입력</h3>
                <span class="text-[11px] text-slate-500">직접 입력한 전표는 창고 재고를 바꾸지 않습니다. 재고를 바꾸려면 입출고 화면을 쓰세요.</span>
            </div>
            <form id="form-item-ledger" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5 text-xs">
                <div>
                    <label class="block font-bold text-slate-700 mb-1">일자 *</label>
                    <input type="date" id="il-date" required value="${localDateStr()}" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold" />
                </div>
                <div>
                    <label class="block font-bold text-slate-700 mb-1">거점 *</label>
                    <select id="il-location" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold">
                        ${sites.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
                    </select>
                </div>
                <div class="col-span-2">
                    <label class="block font-bold text-slate-700 mb-1">품목 * <span class="text-slate-400 font-normal">(코드·품명 검색)</span></label>
                    <input type="text" id="il-item" list="il-item-list" required placeholder="예: 2AA40001 또는 품명" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold" autocomplete="off" />
                    <datalist id="il-item-list">
                        ${items.map(m => `<option value="${esc(m.code)}">${esc(m.name)}${m.spec ? ` / ${esc(m.spec)}` : ''}</option>`).join('')}
                    </datalist>
                </div>
                <div>
                    <label class="block font-bold text-slate-700 mb-1">구분 *</label>
                    <select id="il-type" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold">
                        ${ITEM_LEDGER_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="block font-bold text-blue-700 mb-1">입고(수)</label>
                    <input type="number" id="il-in" min="0" step="any" placeholder="0" class="w-full bg-blue-50/50 border border-blue-200 rounded-xl px-2 py-1.5 font-bold text-right" />
                </div>
                <div>
                    <label class="block font-bold text-rose-700 mb-1">출고(불)</label>
                    <input type="number" id="il-out" min="0" step="any" placeholder="0" class="w-full bg-rose-50/50 border border-rose-200 rounded-xl px-2 py-1.5 font-bold text-right" />
                </div>
                <div>
                    <label class="block font-bold text-slate-700 mb-1">적요</label>
                    <input type="text" id="il-notes" placeholder="거래처·사유" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5" />
                </div>
                <div class="col-span-2 md:col-span-3 lg:col-span-7">
                    <input type="text" id="il-remark" placeholder="비고 (선택)" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5" />
                </div>
                <button type="submit" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black flex items-center justify-center gap-1">
                    <i data-lucide="plus" class="w-3.5 h-3.5"></i>전표 등록
                </button>
            </form>
        </div>` : ''}

        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <h3 class="font-extrabold text-sm text-slate-900 mr-2">최근 수불 전표</h3>
                <select id="il-f-location" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                    <option value="">전체 거점</option>
                    ${sites.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
                </select>
                <select id="il-f-type" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                    <option value="">전체 구분</option>
                    ${ITEM_LEDGER_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
                <input type="date" id="il-f-from" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold" />
                <span class="text-slate-400">~</span>
                <input type="date" id="il-f-to" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold" />
                <input type="text" id="il-f-search" placeholder="품목코드·품명·적요 검색" class="flex-1 min-w-[160px] bg-white border border-slate-300 rounded-lg px-2.5 py-1.5" />
            </div>
            <div class="overflow-x-auto border border-slate-200 rounded-xl hidden md:block">
                <table class="w-full text-xs">
                    <thead class="bg-slate-50 text-slate-600 font-bold">
                        <tr>
                            <th class="p-2.5 text-left whitespace-nowrap">일자</th>
                            <th class="p-2.5 text-left whitespace-nowrap">거점</th>
                            <th class="p-2.5 text-left whitespace-nowrap">품목코드</th>
                            <th class="p-2.5 text-left">품목명</th>
                            <th class="p-2.5 text-center whitespace-nowrap">구분</th>
                            <th class="p-2.5 text-left">적요</th>
                            <th class="p-2.5 text-right whitespace-nowrap">입고</th>
                            <th class="p-2.5 text-right whitespace-nowrap">출고</th>
                            <th class="p-2.5 text-right whitespace-nowrap">재고</th>
                            <th class="p-2.5 text-left">비고</th>
                            <th class="p-2.5 text-left whitespace-nowrap">작업자</th>
                            ${canWrite ? '<th class="p-2.5 text-center whitespace-nowrap">관리</th>' : ''}
                        </tr>
                    </thead>
                    <tbody id="il-tbody" class="divide-y divide-slate-100"></tbody>
                </table>
            </div>
            <div id="il-card-list" class="md:hidden space-y-2.5"></div>
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span id="il-page-info" class="text-slate-500 font-bold"></span>
                <div id="il-page-buttons" class="flex flex-wrap gap-1"></div>
            </div>
        </div>
    </div>

    <div id="il-edit-modal" class="fixed inset-0 bg-slate-900/60 z-50 hidden items-center justify-center p-4">
        <form id="il-edit-form" class="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3 text-xs">
            <h3 class="font-black text-sm text-slate-900">수불 전표 수정</h3>
            <p id="il-edit-item" class="font-bold text-slate-600"></p>
            <div class="grid grid-cols-2 gap-2.5">
                <label class="block"><span class="font-bold text-slate-700">일자</span><input type="date" id="il-e-date" required class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold" /></label>
                <label class="block"><span class="font-bold text-slate-700">거점</span><select id="il-e-location" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold">${sites.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></label>
                <label class="block"><span class="font-bold text-slate-700">구분</span><select id="il-e-type" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold">${ITEM_LEDGER_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select></label>
                <label class="block"><span class="font-bold text-slate-700">적요</span><input type="text" id="il-e-notes" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5" /></label>
                <label class="block"><span class="font-bold text-blue-700">입고</span><input type="number" id="il-e-in" min="0" step="any" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold text-right" /></label>
                <label class="block"><span class="font-bold text-rose-700">출고</span><input type="number" id="il-e-out" min="0" step="any" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 font-bold text-right" /></label>
                <label class="block col-span-2"><span class="font-bold text-slate-700">비고</span><input type="text" id="il-e-remark" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5" /></label>
            </div>
            <p class="text-[11px] text-slate-500">수정·삭제하면 같은 품목·거점의 이후 재고가 다시 계산됩니다. 창고 재고는 바뀌지 않습니다.</p>
            <div class="flex justify-end gap-2">
                <button type="button" id="il-e-cancel" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">취소</button>
                <button type="submit" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black">저장</button>
            </div>
        </form>
    </div>`;

    const $ = (sel) => container.querySelector(sel);

    const renderKpi = () => {
        const list = ledger();
        // '이월'(전환 시점 기초재고)은 입고가 아니므로 월 합계에서 뺀다
        const month = list.filter(e => String(e.date).startsWith(monthPrefix) && e.type !== '이월');
        const itemKeys = new Set(list.map(e => e.code));
        const kpi = [
            ['전표 수', `${list.length.toLocaleString()}건`, 'text-slate-900'],
            ['관리 품목', `${itemKeys.size.toLocaleString()}종`, 'text-indigo-700'],
            [`${monthPrefix.slice(5)}월 입고 합계`, fmt(month.reduce((s, e) => s + (Number(e.inQty) || 0), 0)), 'text-blue-700'],
            [`${monthPrefix.slice(5)}월 출고 합계`, fmt(month.reduce((s, e) => s + (Number(e.outQty) || 0), 0)), 'text-rose-700']
        ];
        $('#item-ledger-kpi').innerHTML = kpi.map(([label, value, tone]) => `
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                <span class="text-[11px] font-bold text-slate-500">${label}</span>
                <div class="text-xl font-black font-mono ${tone} mt-1">${value}</div>
            </div>`).join('');
    };

    const filtered = () => {
        const loc = $('#il-f-location').value;
        const type = $('#il-f-type').value;
        const from = $('#il-f-from').value;
        const to = $('#il-f-to').value;
        const q = $('#il-f-search').value.trim();
        const list = ledger();
        const out = [];
        for (let i = list.length - 1; i >= 0; i--) { // 최근 입력 전표가 위로
            const e = list[i];
            if (loc && e.location !== loc) continue;
            if (type && e.type !== type) continue;
            if (from && e.date < from) continue;
            if (to && e.date > to) continue;
            if (q && !matchesQuery(e, q, ['code', 'name', 'notes', 'remark', 'worker'])) continue;
            out.push(e);
        }
        return out;
    };

    const renderRows = () => {
        const rows = filtered();
        const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        if (page > totalPages) page = totalPages;
        const start = (page - 1) * PAGE_SIZE;
        const pageRows = rows.slice(start, start + PAGE_SIZE);
        if (pageRows.length === 0) {
            $('#il-tbody').innerHTML = `<tr><td colspan="12" class="p-8 text-center text-slate-400 font-bold">조건에 맞는 전표가 없습니다.</td></tr>`;
            $('#il-card-list').innerHTML = `<div class="p-8 text-center text-slate-400 font-bold text-xs">조건에 맞는 전표가 없습니다.</div>`;
        } else {
            const builtRows = pageRows.map(e => {
                const inHtml = e.inQty ? fmt(e.inQty) : '';
                const outHtml = e.outQty ? fmt(e.outQty) : '';
                const stockTone = Number(e.stockQty) < 0 ? 'text-rose-600' : 'text-slate-900';
                const stockHtml = `${fmt(e.stockQty)} <span class="text-[10px] text-slate-400 font-normal">${esc(e.unit || '')}</span>`;
                const actionsHtml = canWrite ? `
                        <button type="button" class="il-edit p-1 text-slate-400 hover:text-blue-600 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(e.id)}" title="수정"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
                        <button type="button" class="il-del p-1 text-slate-400 hover:text-rose-600 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(e.id)}" title="삭제"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>` : '';

                const tr = `
                <tr class="hover:bg-slate-50">
                    <td class="p-2.5 font-mono whitespace-nowrap">${esc(e.date)}</td>
                    <td class="p-2.5 whitespace-nowrap font-bold text-slate-700">${esc(e.location)}</td>
                    <td class="p-2.5 font-mono text-blue-700 whitespace-nowrap">${esc(e.code)}</td>
                    <td class="p-2.5 font-bold text-slate-900 min-w-[160px]">${esc(e.name)}</td>
                    <td class="p-2.5 text-center">${typeBadge(e.type)}</td>
                    <td class="p-2.5 text-slate-600 max-w-[220px] truncate" title="${esc(e.notes)}">${esc(e.notes)}</td>
                    <td class="p-2.5 text-right font-mono text-blue-700">${inHtml}</td>
                    <td class="p-2.5 text-right font-mono text-rose-700">${outHtml}</td>
                    <td class="p-2.5 text-right font-mono font-black ${stockTone}">${stockHtml}</td>
                    <td class="p-2.5 text-slate-500 max-w-[160px] truncate" title="${esc(e.remark)}">${esc(e.remark)}</td>
                    <td class="p-2.5 text-slate-500 whitespace-nowrap">${esc(e.worker)}</td>
                    ${canWrite ? `<td class="p-2.5 text-center whitespace-nowrap">${actionsHtml}</td>` : ''}
                </tr>`;

                const card = `
                <div class="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="flex items-center gap-1.5 flex-wrap mb-1">
                                <span class="font-mono text-[11px] text-slate-500">${esc(e.date)}</span>
                                <span class="font-bold text-slate-700 text-[11px]">${esc(e.location)}</span>
                                ${typeBadge(e.type)}
                            </div>
                            <div class="font-bold text-slate-900 truncate">${esc(e.name)}</div>
                            <div class="font-mono text-blue-700 text-[11px]">${esc(e.code)}</div>
                        </div>
                        ${actionsHtml ? `<div class="flex items-center gap-1 flex-shrink-0">${actionsHtml}</div>` : ''}
                    </div>
                    <div class="mt-2 pt-2 border-t border-slate-100 grid grid-cols-3 gap-1.5 text-center text-[11px]">
                        <div><div class="text-slate-400">입고</div><div class="font-bold text-blue-700">${inHtml || '-'}</div></div>
                        <div><div class="text-slate-400">출고</div><div class="font-bold text-rose-700">${outHtml || '-'}</div></div>
                        <div><div class="text-slate-400">재고</div><div class="font-black ${stockTone}">${stockHtml}</div></div>
                    </div>
                    ${e.notes ? `<div class="mt-1.5 text-[11px] text-slate-600 truncate" title="${esc(e.notes)}">${esc(e.notes)}</div>` : ''}
                    ${e.remark ? `<div class="mt-0.5 text-[11px] text-slate-400 truncate" title="${esc(e.remark)}">비고: ${esc(e.remark)}</div>` : ''}
                    <div class="mt-1 text-[10px] text-slate-400">작업자: ${esc(e.worker)}</div>
                </div>`;

                return { tr, card };
            });
            $('#il-tbody').innerHTML = builtRows.map(r => r.tr).join('');
            $('#il-card-list').innerHTML = builtRows.map(r => r.card).join('');
        }
        $('#il-page-info').textContent = `총 ${rows.length.toLocaleString()}건${rows.length ? ` 중 ${(start + 1).toLocaleString()}~${Math.min(start + PAGE_SIZE, rows.length).toLocaleString()}건` : ''} (최근 입력순)`;
        const btns = [];
        if (totalPages > 1) {
            const pages = new Set([1, totalPages, page - 2, page - 1, page, page + 1, page + 2].filter(p => p >= 1 && p <= totalPages));
            let prev = 0;
            for (const p of [...pages].sort((a, b) => a - b)) {
                if (p - prev > 1) btns.push('<span class="px-1 text-slate-400">…</span>');
                btns.push(`<button type="button" class="il-page px-2.5 py-1 rounded-lg font-bold ${p === page ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}" data-page="${p}">${p}</button>`);
                prev = p;
            }
        }
        $('#il-page-buttons').innerHTML = btns.join('');
        container.querySelectorAll('.il-page').forEach(b => b.addEventListener('click', () => { page = Number(b.dataset.page); renderRows(); }));
        container.querySelectorAll('.il-edit').forEach(b => b.addEventListener('click', () => openEdit(b.dataset.id)));
        container.querySelectorAll('.il-del').forEach(b => b.addEventListener('click', () => removeEntry(b.dataset.id)));
        createIcons({ icons });
    };

    const refresh = () => { renderKpi(); renderRows(); };

    // 품목 입력값 → 마스터 품목 (코드 정확히 일치 → 품명 정확히 일치 → 부분 일치 1건)
    const resolveItem = (text) => {
        const t = text.trim();
        if (!t) return null;
        const code = t.split(/\s/)[0];
        return items.find(m => m.code === code) || items.find(m => m.name === t)
            || (() => { const c = items.filter(m => matchesQuery(m, t, ['code', 'name'])); return c.length === 1 ? c[0] : null; })();
    };

    $('#form-item-ledger')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const item = resolveItem($('#il-item').value);
        if (!item) { alert(`${info.short} 품목을 찾을 수 없습니다. 목록에서 품목코드를 골라 주세요.`); return; }
        const inQty = Number($('#il-in').value) || 0;
        const outQty = Number($('#il-out').value) || 0;
        if (!inQty && !outQty) { alert('입고 또는 출고 수량을 입력하세요.'); return; }
        try {
            await addItemLedgerEntry(kind, {
                date: $('#il-date').value, location: $('#il-location').value, code: item.code, name: item.name, unit: item.unit,
                type: $('#il-type').value, inQty, outQty, notes: $('#il-notes').value, remark: $('#il-remark').value
            });
            showToast(`✅ [${item.code}] ${item.name} 수불 전표가 등록되었습니다.`);
            ['#il-item', '#il-in', '#il-out', '#il-notes', '#il-remark'].forEach(s => { $(s).value = ''; });
            page = 1;
            refresh();
        } catch (err) {
            alert(`전표 등록 실패: ${err.message}`);
        }
    });

    let editingId = null;
    const modal = $('#il-edit-modal');
    const openEdit = (id) => {
        const e = ledger().find(x => x.id === id);
        if (!e) return;
        editingId = id;
        $('#il-edit-item').textContent = `[${e.code}] ${e.name}`;
        $('#il-e-date').value = e.date;
        $('#il-e-location').value = e.location;
        $('#il-e-type').value = ITEM_LEDGER_TYPES.includes(e.type) ? e.type : '입고';
        $('#il-e-notes').value = e.notes || '';
        $('#il-e-in').value = e.inQty || 0;
        $('#il-e-out').value = e.outQty || 0;
        $('#il-e-remark').value = e.remark || '';
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    };
    const closeEdit = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); editingId = null; };
    $('#il-e-cancel').addEventListener('click', closeEdit);
    $('#il-edit-form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
            await updateItemLedgerEntry(kind, editingId, {
                date: $('#il-e-date').value, location: $('#il-e-location').value, type: $('#il-e-type').value,
                notes: $('#il-e-notes').value.trim(), inQty: Number($('#il-e-in').value) || 0, outQty: Number($('#il-e-out').value) || 0,
                remark: $('#il-e-remark').value.trim()
            });
            closeEdit();
            showToast('✏️ 전표를 수정하고 이후 재고를 다시 계산했습니다.');
            refresh();
        } catch (err) {
            alert(`전표 수정 실패: ${err.message}`);
        }
    });

    const removeEntry = async (id) => {
        const e = ledger().find(x => x.id === id);
        if (!e || !confirm(`[${e.date}] ${e.name} ${e.type} 전표를 삭제하시겠습니까?\n같은 품목·거점의 이후 재고가 다시 계산됩니다.`)) return;
        await deleteItemLedgerEntry(kind, id);
        showToast('🗑️ 전표를 삭제했습니다.');
        refresh();
    };

    let searchTimer = null;
    ['#il-f-location', '#il-f-type', '#il-f-from', '#il-f-to'].forEach(s => $(s).addEventListener('change', () => { page = 1; renderRows(); }));
    $('#il-f-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 1; renderRows(); }, 180); });

    $('#btn-open-viewer').addEventListener('click', () => {
        window.__ledgerViewerKind = kind;
        onSwitchTab?.('ledgerViewer');
    });

    refresh();
};
