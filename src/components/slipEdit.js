import { state, updateSlip, processStockAction, SLIP_TYPES } from '../services/db.js';
import { updateScanSlip, SCAN_SLIP_TYPES } from '../services/scanSlips.js';
import { assignTasks } from '../services/assign.js';
import { locationOptionsHtml, locationLabel } from '../services/locations.js';
import { searchMasterItems } from '../services/searchUtils.js';
import { esc } from '../services/html.js';

// ==========================================
// 전표관리 → 전표 수정 창
//   발행 전표: 일자·출발·도착·거래처·운송·사유·작업자·출하 시간·품목(수량·단위·비고·추가·빼기). 재고는 바뀌지 않는다.
//   스캔 등록: 거래처·원본 번호·작업자·품목 수량(빼기 = 0). 수량이 바뀐 만큼 재고를 조정(processStockAction)한 뒤 기록을 고친다.
// ==========================================

const EXTERNAL = '외부 거래처';
const r3 = (n) => Math.round(n * 1000) / 1000;
const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
// 전표 수량(단위) → 재고 단위 수량 (L↔KG는 비중)
const toBase = (qty, unit, baseUnit, sg) => {
    const q = Number(qty) || 0;
    const s = Number(sg) > 0 ? Number(sg) : 1;
    if (!baseUnit || !unit || unit === baseUnit) return q;
    if (baseUnit === 'L' && unit === 'KG') return r3(q / s);
    if (baseUnit === 'KG' && unit === 'L') return r3(q * s);
    return q;
};

const shell = (title, body) => {
    const ov = document.createElement('div');
    ov.className = 'fixed inset-0 z-[9000] bg-slate-900/60 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto text-xs';
    ov.innerHTML = `
        <div class="bg-white w-full max-w-4xl rounded-2xl shadow-2xl my-4">
            <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                <div class="font-black text-slate-800 text-sm">${title}</div>
                <button type="button" class="se-close text-slate-400 hover:text-slate-700 font-black text-lg px-2">✕</button>
            </div>
            <div class="p-4 space-y-3">${body}</div>
            <div class="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
                <button type="button" class="se-cancel px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold">취소</button>
                <button type="button" class="se-save px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black disabled:opacity-40">저장</button>
            </div>
        </div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector('.se-close').addEventListener('click', close);
    ov.querySelector('.se-cancel').addEventListener('click', close);
    return { ov, close, $: (s) => ov.querySelector(s) };
};
const field = (label, html, cls = '') => `<label class="block ${cls}"><span class="font-bold text-slate-500">${label}</span>${html}</label>`;
const inputCls = 'mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold';

// ---------- 발행 전표 ----------
const editIssued = (s, { onSaved, showToast }) => {
    const items = s.items.map(it => ({ ...it }));
    const locOpts = (sel) => `${locationOptionsHtml(state.locations, sel)}<option value="${EXTERNAL}" ${sel === EXTERNAL ? 'selected' : ''}>${EXTERNAL}</option>${sel && sel !== EXTERNAL && !String(locationOptionsHtml(state.locations, sel)).includes('selected') ? `<option value="${esc(sel)}" selected>${esc(locationLabel(sel))}</option>` : ''}`;
    const { close, $ } = shell(`발행 전표 수정 · ${esc(s.docNo)} <span class="font-normal text-slate-500">${esc(SLIP_TYPES[s.type]?.label || '')}</span>`, `
        ${s.shippedAt ? '<div class="p-2 rounded-lg bg-amber-50 text-amber-800 font-bold">⚠️ 이미 출고 완료(QR 검수)된 전표입니다. 내용을 고쳐도 출고로 바뀐 재고는 그대로입니다.</div>' : ''}
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
            ${field('발행일자', `<input type="date" id="se-date" class="${inputCls}" value="${esc(s.date)}" />`)}
            ${field('출발', `<select id="se-from" class="${inputCls}">${locOpts(s.fromLoc)}</select>`)}
            ${field('도착', `<select id="se-to" class="${inputCls}">${locOpts(s.toLoc)}</select>`)}
            ${field('거래처 (받는 곳)', `<input id="se-partner" class="${inputCls}" value="${esc(s.partner)}" />`)}
            ${field('운송 방법', `<input id="se-transport" class="${inputCls}" value="${esc(s.transport)}" />`)}
            ${field('작업 담당자', `<input id="se-worker" class="${inputCls}" value="${esc(s.worker)}" />`)}
            ${field('출하 시간', `<input type="time" id="se-ship" class="${inputCls}" value="${esc(s.shipTime)}" />`)}
            ${field('사유 / 비고', `<input id="se-reason" class="${inputCls}" value="${esc(s.reason)}" />`)}
        </div>
        <div class="relative">
            <input id="se-search" class="${inputCls}" placeholder="+ 품목 추가: 코드·품목명 일부" autocomplete="off" />
            <div id="se-sg" class="hidden absolute left-0 right-0 top-full z-10 max-h-56 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl"></div>
        </div>
        <div class="overflow-x-auto border border-slate-200 rounded-xl"><table class="w-full min-w-[640px]">
            <thead class="bg-slate-50 text-slate-600 font-bold"><tr><th class="p-2 text-left">품목</th><th class="p-2 text-right w-28">수량</th><th class="p-2 w-24">단위</th><th class="p-2 text-left">비고</th><th class="p-2 w-8"></th></tr></thead>
            <tbody id="se-items"></tbody>
        </table></div>
        <p class="text-[11px] text-slate-500">전표번호는 바뀌지 않습니다. 발행 전표는 서류만 고치며 재고는 바꾸지 않습니다.</p>`);
    const renderItems = () => {
        $('#se-items').innerHTML = items.map((it, i) => `<tr class="border-t border-slate-100" data-i="${i}">
            <td class="p-2"><span class="font-mono text-slate-500">${esc(it.code)}</span> <b>${esc(it.name)}</b>${it.spec ? ` <span class="text-slate-400">${esc(it.spec)}</span>` : ''}</td>
            <td class="p-2"><input type="number" min="0" step="any" class="se-qty w-full border border-slate-300 rounded px-1.5 py-1 text-right font-black" value="${esc(it.qty)}" /></td>
            <td class="p-2"><input class="se-unit w-full border border-slate-300 rounded px-1.5 py-1 text-center font-bold" value="${esc(it.unit)}" /></td>
            <td class="p-2"><input class="se-note w-full border border-slate-300 rounded px-1.5 py-1" value="${esc(it.note || '')}" /></td>
            <td class="p-2 text-center"><button type="button" class="se-del text-slate-400 hover:text-rose-600 font-black">✕</button></td>
        </tr>`).join('') || '<tr><td colspan="5" class="p-4 text-center text-slate-400">품목이 없습니다.</td></tr>';
        $('#se-items').querySelectorAll('tr[data-i]').forEach(tr => {
            const it = items[Number(tr.dataset.i)];
            tr.querySelector('.se-qty').addEventListener('input', (e) => { it.qty = e.target.value; });
            tr.querySelector('.se-unit').addEventListener('input', (e) => { it.unit = e.target.value.trim().toUpperCase(); });
            tr.querySelector('.se-note').addEventListener('input', (e) => { it.note = e.target.value; });
            tr.querySelector('.se-del').addEventListener('click', () => { items.splice(Number(tr.dataset.i), 1); renderItems(); });
        });
    };
    let found = [];
    $('#se-search').addEventListener('input', (e) => {
        const q = e.target.value.trim();
        found = q ? searchMasterItems(q, 20) : [];
        const sg = $('#se-sg');
        sg.innerHTML = found.map((m, i) => `<button type="button" data-i="${i}" class="w-full text-left px-2 py-1.5 border-b border-slate-100 hover:bg-indigo-50 flex gap-2"><span class="font-mono font-bold">${esc(m.code)}</span><span class="font-bold truncate">${esc(m.name)}</span><span class="text-slate-400 truncate">${esc(m.spec && m.spec !== '-' ? m.spec : '')}</span></button>`).join('') || '<div class="p-2 text-slate-400">일치하는 품목이 없습니다.</div>';
        sg.classList.toggle('hidden', !q);
        sg.querySelectorAll('button').forEach(b => {
            b.addEventListener('mousedown', (ev) => ev.preventDefault());
            b.addEventListener('click', () => {
                const m = found[Number(b.dataset.i)];
                items.push({ code: m.code, name: m.name, spec: m.spec && m.spec !== '-' ? m.spec : '', unit: String(m.unit || 'EA').toUpperCase(), qty: 1, note: '' });
                $('#se-search').value = '';
                sg.classList.add('hidden');
                renderItems();
            });
        });
    });
    $('#se-search').addEventListener('blur', () => setTimeout(() => $('#se-sg').classList.add('hidden'), 150));
    renderItems();

    $('.se-save').addEventListener('click', async () => {
        const patch = {
            date: $('#se-date').value || s.date, fromLoc: $('#se-from').value, toLoc: $('#se-to').value, partner: $('#se-partner').value.trim(),
            transport: $('#se-transport').value.trim(), reason: $('#se-reason').value.trim(), worker: $('#se-worker').value.trim(), shipTime: $('#se-ship').value, items
        };
        if (patch.fromLoc && patch.fromLoc === patch.toLoc && patch.fromLoc !== EXTERNAL) { alert('출발지와 도착지가 같습니다.'); return; }
        if (patch.toLoc === EXTERNAL && !patch.partner) { alert('외부로 보낼 때는 거래처(받는 곳)를 입력하세요.'); return; }
        const btn = $('.se-save');
        btn.disabled = true;
        try {
            const saved = await updateSlip(s.docNo, patch);
            // 담당자 할일의 날짜·시간·내용도 맞춘다 (메시지는 다시 보내지 않음)
            if (s.assigneeId) {
                const label = SLIP_TYPES[saved.type]?.label || '전표';
                const lt = (l) => (l && l !== EXTERNAL ? locationLabel(l) : l);
                const route = `${lt(saved.fromLoc) || '-'} → ${saved.toLoc === EXTERNAL || !saved.toLoc ? (saved.partner || EXTERNAL) : lt(saved.toLoc)}`;
                await assignTasks({
                    ref: `SLIP:${saved.docNo}`, assignee: { id: s.assigneeId, name: s.assigneeName }, notify: false,
                    tasks: [{ part: '', label: '출하 예정', text: `[${label}] ${saved.docNo} ${route} · ${saved.items.length}품목 출하 확인`, dueDate: saved.date, dueTime: saved.shipTime, remindBefore: 30 }],
                    link: { tab: 'slipIssue', set: { __slipOpenDocNo: saved.docNo } }
                });
            }
            showToast(`✏️ 전표 ${s.docNo}를 수정했습니다.`);
            close();
            onSaved({ ...s, ...saved });
        } catch (e) {
            alert(e.message);
            btn.disabled = false;
        }
    });
};

// ---------- 스캔 등록 ----------
const editScan = (rec, { onSaved, showToast }) => {
    const t = SCAN_SLIP_TYPES[rec.kind] || { word: rec.kind };
    const rows = rec.items.map(it => ({ ...it, newQty: it.qty, removed: false }));
    const baseOf = (it) => (it.baseUnit ? it.baseUnit : it.unit);
    const oldBase = (it) => (it.baseQty !== undefined && it.baseQty !== null ? Number(it.baseQty) : toBase(it.qty, it.unit, baseOf(it), it.sg));
    const route = rec.action === 'MOVE' ? `${locationLabel(rec.fromLoc)} → ${locationLabel(rec.toLoc)}` : locationLabel(rec.action === 'IN' ? rec.toLoc : rec.fromLoc);
    const { close, $ } = shell(`스캔 등록 수정 · ${esc(rec.regNo)} <span class="font-normal text-slate-500">${esc(t.word)} · ${esc(rec.date)} · ${esc(route)}</span>`, `
        <div class="p-2 rounded-lg bg-sky-50 text-sky-900">이 전표는 이미 재고에 반영됐습니다. <b>수량을 바꾸면 늘거나 준 만큼 재고·수불부를 다시 맞춥니다</b>(전표 일자로 기록). 일자·창고·종류는 바꿀 수 없습니다 — 바꿔야 하면 기록을 지우고 반대로 처리한 뒤 새로 등록하세요.</div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
            ${field('거래처', `<input id="se-partner" class="${inputCls}" value="${esc(rec.partner)}" />`)}
            ${field('원본 전표 번호', `<input id="se-docno" class="${inputCls}" value="${esc(rec.docNo)}" />`)}
            ${field('작업자', `<input id="se-worker" class="${inputCls}" value="${esc(rec.worker)}" />`)}
        </div>
        <div class="overflow-x-auto border border-slate-200 rounded-xl"><table class="w-full min-w-[640px]">
            <thead class="bg-slate-50 text-slate-600 font-bold"><tr><th class="p-2 text-left">품목</th><th class="p-2 text-right">등록 수량</th><th class="p-2 text-right w-28">고칠 수량</th><th class="p-2">단위</th><th class="p-2 text-left">재고 변화</th><th class="p-2 w-12"></th></tr></thead>
            <tbody id="se-items"></tbody>
        </table></div>`);
    const deltaOf = (it) => r3(toBase(it.removed ? 0 : it.newQty, it.unit, baseOf(it), it.sg) - oldBase(it));
    const renderItems = () => {
        $('#se-items').innerHTML = rows.map((it, i) => {
            const d = deltaOf(it);
            const dText = !d ? '<span class="text-slate-400">변화 없음</span>'
                : `<span class="font-black ${d > 0 === (rec.action === 'IN') ? 'text-emerald-700' : 'text-rose-600'}">${rec.action === 'MOVE' ? `이동 ${d > 0 ? '+' : ''}${fmt(d)}` : `재고 ${(rec.action === 'IN' ? d : -d) > 0 ? '+' : ''}${fmt(rec.action === 'IN' ? d : -d)}`} ${esc(baseOf(it))}</span>`;
            return `<tr class="border-t border-slate-100 ${it.removed ? 'opacity-50 line-through' : ''}" data-i="${i}">
                <td class="p-2"><span class="font-mono text-slate-500">${esc(it.code)}</span> <b>${esc(it.name)}</b></td>
                <td class="p-2 text-right">${fmt(it.qty)}</td>
                <td class="p-2"><input type="number" min="0" step="any" class="se-qty w-full border border-slate-300 rounded px-1.5 py-1 text-right font-black" value="${esc(it.removed ? 0 : it.newQty)}" ${it.removed ? 'disabled' : ''} /></td>
                <td class="p-2 text-center font-bold">${esc(it.unit)}${it.sg && it.unit !== baseOf(it) ? `<div class="text-[10px] font-normal text-slate-500">비중 ${esc(it.sg)}</div>` : ''}</td>
                <td class="p-2 se-delta">${dText}</td>
                <td class="p-2 text-center"><button type="button" class="se-del font-bold ${it.removed ? 'text-indigo-600' : 'text-slate-400 hover:text-rose-600'}">${it.removed ? '되살리기' : '빼기'}</button></td>
            </tr>`;
        }).join('');
        $('#se-items').querySelectorAll('tr[data-i]').forEach(tr => {
            const it = rows[Number(tr.dataset.i)];
            tr.querySelector('.se-qty').addEventListener('change', (e) => { it.newQty = e.target.value; renderItems(); });
            tr.querySelector('.se-del').addEventListener('click', () => { it.removed = !it.removed; renderItems(); });
        });
    };
    renderItems();

    // 재고 조정 한 줄: 늘리면 같은 방향, 줄이면 반대 방향
    const adjust = async (it, d) => {
        const qty = Math.abs(d);
        const more = d > 0;
        const reason = `전표 수정 ${rec.regNo} (${t.word}) · ${it.name || it.code} ${fmt(it.qty)}→${fmt(it.removed ? 0 : it.newQty)} ${it.unit}${rec.partner ? ` · ${rec.partner}` : ''}`;
        const common = { code: it.code, qty, worker: $('#se-worker').value.trim() || state.currentGlobalWorker, at: rec.date, reason, ledgerType: `${t.word} 수정` };
        if (rec.action === 'MOVE') {
            await processStockAction({ ...common, type: 'MOVE', fromLoc: more ? rec.fromLoc : rec.toLoc, toLoc: more ? rec.toLoc : rec.fromLoc, location: more ? rec.fromLoc : rec.toLoc, ledgerType: '' });
        } else if (rec.action === 'IN') {
            await processStockAction({ ...common, type: more ? 'IN' : 'OUT', location: rec.toLoc });
        } else {
            await processStockAction({ ...common, type: more ? rec.action : 'IN', location: rec.fromLoc });
        }
    };

    $('.se-save').addEventListener('click', async () => {
        const changes = rows.map(it => ({ it, d: deltaOf(it) })).filter(x => x.d);
        const left = rows.filter(it => !it.removed && Number(it.newQty) > 0);
        if (!left.length && !confirm('모든 품목을 뺍니다. 재고를 모두 되돌린 뒤 품목 없는 기록이 남습니다. 계속할까요?')) return;
        if (changes.length) {
            const list = changes.map(({ it, d }) => `- ${it.name || it.code}: ${fmt(it.qty)} → ${fmt(it.removed ? 0 : it.newQty)} ${it.unit} (재고 ${rec.action === 'MOVE' ? (d > 0 ? '더 이동' : '되돌려 이동') : (rec.action === 'IN' ? d : -d) > 0 ? '늘림' : '줄임'} ${fmt(Math.abs(d))} ${baseOf(it)})`).join('\n');
            if (!confirm(`재고를 다음과 같이 다시 맞춥니다 (전표 일자 ${rec.date}로 기록):\n\n${list}\n\n진행할까요?`)) return;
        }
        const btn = $('.se-save');
        btn.disabled = true;
        const failed = [];
        for (const { it, d } of changes) {
            try { await adjust(it, d); it.applied = true; } catch (e) { failed.push(`${it.name || it.code}: ${e.message}`); }
        }
        // 재고 조정에 성공한 줄만 새 수량으로 기록 (실패한 줄은 예전 수량 그대로)
        const items = rows.map(it => {
            const changed = changes.some(c => c.it === it) && it.applied;
            const q = changed ? (it.removed ? 0 : Number(it.newQty) || 0) : Number(it.qty) || 0;
            const { newQty, removed, applied, ...rest } = it;
            return { ...rest, qty: q, baseQty: changed ? toBase(q, it.unit, baseOf(it), it.sg) : oldBase(it) };
        }).filter(it => it.qty > 0);
        try {
            const saved = await updateScanSlip(rec, { partner: $('#se-partner').value.trim(), docNo: $('#se-docno').value.trim(), worker: $('#se-worker').value.trim(), items });
            showToast(`✏️ ${rec.regNo}를 수정했습니다.${changes.length ? ` 재고 ${changes.length - failed.length}건 다시 맞춤` : ''}`);
            if (failed.length) alert(`다음 품목은 재고를 맞추지 못해 예전 수량 그대로 두었습니다:\n\n${failed.join('\n')}`);
            close();
            onSaved({ ...rec, ...saved });
        } catch (e) {
            alert(`${changes.length - failed.length ? '재고는 다시 맞췄지만 ' : ''}${e.message}`);
            btn.disabled = false;
        }
    });
};

/** 전표관리 목록 한 줄(entry: { src: 'ISSUE'|'SCAN', raw })의 수정 창을 연다 */
export const openSlipEditor = (entry, opts) => (entry.src === 'SCAN' ? editScan(entry.raw, opts) : editIssued(entry.raw, opts));
