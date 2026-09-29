import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { searchMasterItems } from '../services/searchUtils.js';
import { sitesOf, locationOptionsHtml, locationLabel } from '../services/locations.js';
import {
    OIL_TYPES, TOTE_BASE, TOTE_NAME, IBC_LITERS, listTanks, registerFill, emptyTank, setRemaining, deleteTank,
    toteStock, planToteUse, oilTypeOf, ibcCountOf
} from '../services/ibcTotes.js';
import { processStockAction } from '../services/db.js';

// 품목 및 재고관리 → IBC(공토트) 관리 (services/ibcTotes.js)
// 공토트 재고(용도 없음 990001 · 유종별 990001-n), 원액이 담긴 IBC 대장(남은 양·비움), 기존 IBC 등록
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
const dt = (iso) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' }) : '');
const TYPE_LABEL = Object.fromEntries(OIL_TYPES.map(t => [t.key, t.label]));

export const renderIbcTotes = (container, { showToast = () => {} } = {}) => {
    const canAct = canPerformAction('PRODUCTION');
    const canDel = canPerformAction('MRP_PLANNING');
    let tanks = [];
    let f = { status: 'FILLED', type: '', site: '', q: '' };
    let loadErr = '';

    container.innerHTML = `
    <section class="space-y-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div class="text-[11px] font-black text-sky-600 flex items-center gap-1"><i data-lucide="cylinder" class="w-3.5 h-3.5"></i>품목 및 재고관리 › IBC(공토트) 관리</div>
            <h2 class="text-lg font-black text-slate-900 mt-1">IBC(공토트) 관리</h2>
            <div class="mt-2 text-xs text-slate-600 space-y-1 leading-relaxed">
                <p>• <b>${TOTE_BASE} ${TOTE_NAME}</b> = 용도 없는 공토트, <b>${TOTE_BASE}-1 ~ -${OIL_TYPES.length}</b> = 유종 전용 공토트 (${OIL_TYPES.map(t => `-${t.code.split('-')[1]} ${t.label}`).join(' · ')}).</p>
                <p>• 원액을 IBC에 담아 <b>제품생산/입고</b>(또는 업무일지 원액생산 반영)하면 그 유종 공토트를 먼저, 없으면 ${TOTE_BASE}을 IBC 개수만큼 차감하고 아래 대장에 등록합니다.</p>
                <p>• 완제품 생산에 원액을 투입하면 <b>먼저 채운 IBC부터</b> 남은 양을 빼고, 0이 되면 비움 처리하고 <b>그 유종 공토트(${TOTE_BASE}-n)가 1개 다시 입고</b>됩니다. 한 번 담은 유종의 IBC는 계속 같은 유종에만 씁니다.</p>
            </div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="boxes" class="w-4 h-4 text-sky-600"></i>공토트 재고 · 사용 중 IBC</h3>
            <div id="ibc-stock" class="overflow-x-auto"></div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="list" class="w-4 h-4 text-sky-600"></i>IBC 대장</h3>
                ${canAct ? '<button type="button" id="ibc-add-btn" class="px-3 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-1.5"><i data-lucide="plus" class="w-4 h-4"></i>기존 IBC 등록</button>' : ''}
            </div>
            <div id="ibc-add" class="hidden"></div>
            <div class="flex flex-wrap gap-2 text-xs">
                <select id="ibc-f-status" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold"><option value="FILLED">사용 중 (원액 있음)</option><option value="EMPTY">비움</option><option value="">전체</option></select>
                <select id="ibc-f-type" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold"><option value="">전체 유종</option>${OIL_TYPES.map(t => `<option value="${t.key}">${esc(t.label)}</option>`).join('')}</select>
                <select id="ibc-f-site" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold"><option value="">전체 거점</option>${sitesOf(state.locations).map(s => `<option>${esc(s)}</option>`).join('')}</select>
                <input id="ibc-f-q" type="search" placeholder="원액·LOT 검색" class="flex-1 min-w-[140px] border border-slate-300 rounded-lg px-2 py-1.5" />
            </div>
            <div id="ibc-list" class="overflow-x-auto"></div>
        </div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    const drawStock = () => {
        const sites = sitesOf(state.locations);
        const rows = toteStock();
        const open = tanks.filter(t => t.status === 'FILLED');
        const inUse = (key) => open.filter(t => t.oilType === key).length;
        $('#ibc-stock').innerHTML = `<table class="w-full text-xs min-w-[640px]">
            <thead class="bg-slate-50 text-slate-600"><tr><th class="p-2 text-left">코드</th><th class="p-2 text-left">품명</th>${sites.map(s => `<th class="p-2 text-right">${esc(s)}</th>`).join('')}<th class="p-2 text-right">공토트 합계</th><th class="p-2 text-right">사용 중 IBC</th></tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.map(r => {
                const t = OIL_TYPES.find(x => x.code === r.code);
                return `<tr class="${r.code === TOTE_BASE ? 'bg-sky-50/60 font-bold' : ''}"><td class="p-2 font-mono">${esc(r.code)}</td><td class="p-2">${esc(r.name)}</td>
                    ${sites.map(s => `<td class="p-2 text-right">${r.bySite[s] ? fmt(r.bySite[s]) : '<span class="text-slate-300">0</span>'}</td>`).join('')}
                    <td class="p-2 text-right font-black">${fmt(r.total)}</td><td class="p-2 text-right font-black text-sky-700">${t ? (inUse(t.key) || '<span class="text-slate-300 font-normal">0</span>') : ''}</td></tr>`;
            }).join('')}</tbody></table>
            ${loadErr ? `<div class="mt-2 text-rose-600 font-bold text-xs">${esc(loadErr)}</div>` : ''}`;
    };

    const drawList = () => {
        const q = f.q.trim().toLowerCase();
        const rows = tanks.filter(t => (!f.status || t.status === f.status) && (!f.type || t.oilType === f.type) && (!f.site || String(t.location).split(' / ')[0] === f.site)
            && (!q || `${t.blendCode} ${t.blendName} ${t.lot}`.toLowerCase().includes(q)))
            .sort((a, b) => (a.status === b.status ? 0 : a.status === 'FILLED' ? -1 : 1) || String(a.filledAt).localeCompare(String(b.filledAt)));
        const sumRemain = rows.filter(t => t.status === 'FILLED').reduce((s, t) => s + t.remaining, 0);
        $('#ibc-list').innerHTML = `<div class="text-[11px] text-slate-500 mb-1">${rows.length}개${sumRemain ? ` · 남은 원액 합계 ${fmt(sumRemain)} L` : ''}</div>
            <table class="w-full text-xs min-w-[860px]">
            <thead class="bg-slate-50 text-slate-600"><tr><th class="p-2 text-left">유종</th><th class="p-2 text-left">원액</th><th class="p-2 text-left">LOT</th><th class="p-2 text-left">거점·창고</th><th class="p-2 text-right">담은 양</th><th class="p-2 text-left w-44">남은 양</th><th class="p-2 text-left">채운 날</th><th class="p-2 text-left">출처</th><th class="p-2"></th></tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.map(t => {
                const pct = t.filledQty ? Math.round((t.remaining / t.filledQty) * 100) : 0;
                return `<tr data-id="${esc(t.id)}" class="${t.status === 'EMPTY' ? 'text-slate-400' : ''}">
                    <td class="p-2"><span class="px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-800 font-bold">${esc(TYPE_LABEL[t.oilType] || t.oilType)}</span><div class="font-mono text-[10px] text-slate-400">${esc(t.toteCode)}</div></td>
                    <td class="p-2"><b>${esc(t.blendName)}</b><div class="font-mono text-[10px] text-blue-600">${esc(t.blendCode)}</div></td>
                    <td class="p-2 font-mono">${esc(t.lot || '-')}</td>
                    <td class="p-2">${esc(locationLabel(t.location) || t.location)}</td>
                    <td class="p-2 text-right">${fmt(t.filledQty)} L</td>
                    <td class="p-2">${t.status === 'EMPTY' ? `비움 ${esc(dt(t.emptiedAt))}` : `<div class="flex items-center gap-1.5"><div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div class="h-full ${pct < 20 ? 'bg-rose-500' : 'bg-sky-500'}" style="width:${Math.min(100, pct)}%"></div></div><b>${fmt(t.remaining)} L</b></div>`}</td>
                    <td class="p-2">${esc(dt(t.filledAt))}</td>
                    <td class="p-2 text-[11px]">${esc(t.source || '')}${t.notes ? `<div class="text-slate-400">${esc(t.notes)}</div>` : ''}</td>
                    <td class="p-2 whitespace-nowrap text-right">${t.status === 'FILLED' && canAct ? `<button type="button" class="ibc-remain px-2 py-1 rounded-md border border-slate-300 font-bold">남은 양</button> <button type="button" class="ibc-empty px-2 py-1 rounded-md bg-sky-600 text-white font-bold">비움</button>` : ''}
                        ${canDel ? ' <button type="button" class="ibc-del px-1.5 py-1 text-slate-400 hover:text-rose-600 font-black" title="대장에서 삭제 (재고는 그대로)">✕</button>' : ''}</td>
                </tr>`;
            }).join('') || '<tr><td colspan="9" class="p-6 text-center text-slate-400">해당하는 IBC가 없습니다.</td></tr>'}</tbody></table>`;
        container.querySelectorAll('#ibc-list tr[data-id]').forEach(tr => {
            const t = tanks.find(x => x.id === tr.dataset.id);
            tr.querySelector('.ibc-empty')?.addEventListener('click', async () => {
                if (!confirm(`${t.blendName} ${t.lot ? `(LOT ${t.lot}) ` : ''}IBC를 비움 처리할까요?\n남은 ${fmt(t.remaining)} L는 대장에서 0이 되고, ${OIL_TYPES.find(x => x.code === t.toteCode)?.name || t.toteCode} 1개가 ${t.location}에 입고됩니다.`)) return;
                try { await emptyTank(t); showToast(`♻️ IBC 비움 → ${OIL_TYPES.find(x => x.code === t.toteCode)?.name || t.toteCode} 1개 회수`); await load(); } catch (e) { alert(e.message); }
            });
            tr.querySelector('.ibc-remain')?.addEventListener('click', async () => {
                const v = prompt(`${t.blendName} IBC의 남은 양(L)을 넣으세요 (실측).`, String(t.remaining));
                if (v === null) return;
                const n = Number(String(v).replace(/,/g, ''));
                if (!(n >= 0)) { alert('숫자로 넣으세요.'); return; }
                try {
                    if (n <= 0.5 && confirm('남은 양이 0입니다. 비움 처리하고 공토트를 회수할까요?')) await emptyTank(t, '실측 0 L');
                    else await setRemaining(t, n);
                    await load();
                } catch (e) { alert(e.message); }
            });
            tr.querySelector('.ibc-del')?.addEventListener('click', async () => {
                if (!confirm('이 IBC를 대장에서 삭제할까요? (재고·공토트는 바뀌지 않습니다. 잘못 등록한 경우에만)')) return;
                try { await deleteTank(t.id); await load(); } catch (e) { alert(e.message); }
            });
        });
    };

    // ---------- 기존 IBC 등록 ----------
    const drawAdd = () => {
        const box = $('#ibc-add');
        box.innerHTML = `<div class="p-3 rounded-xl border border-sky-200 bg-sky-50 text-xs space-y-2">
            <div class="font-black text-sky-900">기존 IBC 등록 — 이미 원액이 담겨 있는 IBC를 대장에 올립니다 (원액 재고는 바뀌지 않음)</div>
            <div class="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
                <label class="md:col-span-2 relative"><span class="font-bold text-slate-600">원액 *</span><input id="ia-blend" type="text" autocomplete="off" placeholder="원액 이름·코드 검색" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold bg-white" />
                    <div id="ia-sg" class="hidden absolute left-0 right-0 top-full z-30 max-h-56 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl"></div></label>
                <label><span class="font-bold text-slate-600">LOT</span><input id="ia-lot" type="text" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-white" /></label>
                <label><span class="font-bold text-slate-600">거점·창고</span><select id="ia-loc" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold bg-white">${locationOptionsHtml(state.locations, '김포공장')}</select></label>
                <label><span class="font-bold text-slate-600">담긴 양 (L) *</span><input id="ia-qty" type="number" min="0" step="any" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-black text-right bg-white" /></label>
                <label><span class="font-bold text-slate-600">IBC 개수</span><input id="ia-cnt" type="number" min="1" step="1" value="1" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-black text-right bg-white" /></label>
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <label class="flex items-center gap-1 font-bold"><input type="checkbox" id="ia-deduct" /> 공토트 차감 (지금 막 채운 경우만)</label>
                <span id="ia-info" class="text-sky-800"></span>
                <span class="ml-auto flex gap-1.5"><button type="button" id="ia-cancel" class="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-bold">닫기</button><button type="button" id="ia-save" class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-black">등록</button></span>
            </div></div>`;
        let picked = null;
        const info = () => {
            if (!picked) { $('#ia-info').textContent = ''; return; }
            const t = oilTypeOf(picked.code, picked.name);
            const stock = state.inventory.filter(i => i.code === picked.code).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
            $('#ia-info').innerHTML = `유종 <b>${esc(t.label)}</b> → 비면 <b>${esc(t.name)}</b> 회수 · 원액 재고 ${fmt(stock)} L`;
        };
        const inp = $('#ia-blend'); const sg = $('#ia-sg');
        inp.addEventListener('input', () => {
            picked = null; info();
            const found = searchMasterItems(inp.value, 40).filter(m => m.category === '원액').slice(0, 15);
            sg.innerHTML = found.map((m, i) => `<button type="button" data-i="${i}" class="w-full text-left px-2 py-1.5 border-b border-slate-100 hover:bg-sky-50"><b>${esc(m.name)}</b> <span class="font-mono text-[10px] text-blue-600">${esc(m.code)}</span></button>`).join('') || '<div class="p-2 text-slate-400">원액 품목이 없습니다.</div>';
            sg.classList.toggle('hidden', !inp.value.trim());
            sg.querySelectorAll('button').forEach(b => {
                b.addEventListener('mousedown', (e) => e.preventDefault());
                b.addEventListener('click', () => { picked = found[Number(b.dataset.i)]; inp.value = `${picked.name} (${picked.code})`; sg.classList.add('hidden'); info(); });
            });
        });
        inp.addEventListener('blur', () => setTimeout(() => sg.classList.add('hidden'), 150));
        $('#ia-qty').addEventListener('input', (e) => { $('#ia-cnt').value = ibcCountOf(e.target.value); });
        $('#ia-cancel').addEventListener('click', () => box.classList.add('hidden'));
        $('#ia-save').addEventListener('click', async (ev) => {
            const e = { currentTarget: ev.currentTarget };
            const qty = Number($('#ia-qty').value);
            const cnt = Math.max(1, Math.round(Number($('#ia-cnt').value) || 1));
            const loc = $('#ia-loc').value;
            if (!picked) { alert('원액을 목록에서 고르세요.'); return; }
            if (!(qty > 0)) { alert('담긴 양을 넣으세요.'); return; }
            if (qty > cnt * IBC_LITERS * 1.05 && !confirm(`IBC ${cnt}개에 ${fmt(qty)} L는 1,000L를 넘습니다. 그대로 등록할까요?`)) return;
            e.currentTarget.disabled = true;
            try {
                let deducted = '';
                if ($('#ia-deduct').checked) {
                    const plan = planToteUse(picked.code, picked.name, loc, cnt);
                    if (plan.short && !confirm(`${loc} 공토트가 ${plan.short}개 모자랍니다. 있는 만큼만 차감할까요?`)) { e.currentTarget.disabled = false; return; }
                    for (const r of plan.rows) await processStockAction({ type: 'USE', code: r.code, qty: r.qty, location: loc, reason: `IBC 충진 · ${picked.name}${$('#ia-lot').value ? ` LOT ${$('#ia-lot').value}` : ''} (공토트 사용)` });
                    deducted = plan.rows.map(r => `${r.name} ${r.qty}`).join(', ');
                }
                const made = await registerFill({ blendCode: picked.code, blendName: picked.name, lot: $('#ia-lot').value.trim(), location: loc, liters: qty, count: cnt, source: '수동 등록' });
                showToast(`🛢️ IBC ${made.length}개를 대장에 등록했습니다${deducted ? ` · 공토트 차감: ${deducted}` : ''}.`);
                box.classList.add('hidden');
                await load();
            } catch (err) { alert(err.message); e.currentTarget.disabled = false; }
        });
    };

    const load = async () => {
        try { tanks = await listTanks(); loadErr = ''; } catch (e) { tanks = []; loadErr = e.message; }
        drawStock(); drawList(); createIcons({ icons });
    };

    $('#ibc-add-btn')?.addEventListener('click', () => { const box = $('#ibc-add'); const open = box.classList.contains('hidden'); box.classList.toggle('hidden', !open); if (open) drawAdd(); });
    $('#ibc-f-status').addEventListener('change', (e) => { f.status = e.target.value; drawList(); });
    $('#ibc-f-type').addEventListener('change', (e) => { f.type = e.target.value; drawList(); });
    $('#ibc-f-site').addEventListener('change', (e) => { f.site = e.target.value; drawList(); });
    $('#ibc-f-q').addEventListener('input', (e) => { f.q = e.target.value; drawList(); });
    createIcons({ icons });
    load();
};
