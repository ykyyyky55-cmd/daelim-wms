import { state, saveSchedule } from '../services/db.js';
import { searchMasterItems } from '../services/searchUtils.js';
import { listChatInbox, markChatInbox, parseScheduleMessage, SCHEDULE_TYPE_LABELS } from '../services/chatSchedule.js';
import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';

/**
 * 수불·입출고 캘린더 위의 '구글 챗 일정' 받은함.
 * 구글 챗에서 WMS 앱을 @멘션한 메시지를 일정 후보로 보여주고, 확인·수정한 줄만 일정으로 등록한다.
 */
export const renderChatInboxPanel = (el, { showToast = () => {}, onScheduled = () => {} } = {}) => {
    let items = [];          // [{ msg, cands }]
    let open = true;
    let loading = false;
    let error = '';

    const fmtTime = (s) => { try { return new Date(s).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
    const typeOptions = (sel) => Object.entries(SCHEDULE_TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

    const load = async () => {
        loading = true;
        error = '';
        render();
        try {
            const list = await listChatInbox('PENDING');
            items = list.map(msg => ({ msg, cands: parseScheduleMessage(msg.text, new Date(msg.sentAt || Date.now())) }));
        } catch (e) {
            error = e.message;
            items = [];
        }
        loading = false;
        render();
    };

    const candRow = (c, mi, ci) => `
        <tr data-m="${mi}" data-c="${ci}">
            <td class="p-1.5 text-center"><input type="checkbox" class="ci-inc w-4 h-4" ${c.include ? 'checked' : ''} /></td>
            <td class="p-1.5"><input type="date" class="ci-f w-full border border-slate-300 rounded px-1 py-1 font-bold" data-k="date" value="${esc(c.date)}" /></td>
            <td class="p-1.5"><select class="ci-f w-full border border-slate-300 rounded px-1 py-1 font-bold" data-k="type">${typeOptions(c.type)}</select></td>
            <td class="p-1.5 relative min-w-[180px]">
                <input type="text" class="ci-item w-full border border-slate-300 rounded px-1.5 py-1 font-bold" value="${esc(c.itemCode ? `[${c.itemCode}] ${c.itemName}` : '')}" placeholder="품목 검색 (선택)" autocomplete="off" />
                <div class="ci-sg hidden absolute left-1 right-1 top-full z-30 max-h-52 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl"></div>
                ${c.itemHow === '유사' ? '<div class="text-[10px] text-amber-700">비슷한 품목 · 확인</div>' : ''}
            </td>
            <td class="p-1.5"><input type="text" class="ci-f w-20 border border-slate-300 rounded px-1.5 py-1 text-right font-black" data-k="qtyText" value="${esc(c.qty ? `${c.qty}${c.unit}` : '')}" placeholder="수량" /></td>
            <td class="p-1.5"><input type="text" class="ci-f w-full border border-slate-300 rounded px-1.5 py-1" data-k="partner" value="${esc(c.partner)}" list="ci-partner-list" placeholder="거래처" /></td>
            <td class="p-1.5"><input type="text" class="ci-f w-full min-w-[160px] border border-slate-300 rounded px-1.5 py-1" data-k="title" value="${esc(c.title)}" /></td>
        </tr>`;

    const render = () => {
        const n = items.length;
        el.innerHTML = `
        <div class="rounded-xl border ${n ? 'border-amber-300 bg-amber-50/70' : 'border-slate-200 bg-slate-50'} text-xs">
            <div class="flex flex-wrap items-center gap-2 px-3 py-2">
                <button type="button" id="ci-toggle" class="font-black ${n ? 'text-amber-900' : 'text-slate-600'} flex items-center gap-1.5">
                    <i data-lucide="message-square-text" class="w-4 h-4"></i>구글 챗 일정 · 확인 대기 ${loading ? '…' : `${n}건`}
                    ${n ? `<i data-lucide="${open ? 'chevron-up' : 'chevron-down'}" class="w-3.5 h-3.5"></i>` : ''}
                </button>
                <button type="button" id="ci-refresh" class="px-2 py-0.5 bg-white border border-slate-300 rounded-lg font-bold flex items-center gap-1"><i data-lucide="refresh-cw" class="w-3 h-3"></i>새로고침</button>
                <span class="text-[11px] text-slate-500">구글 챗 스페이스에서 <b>@WMS 앱</b>을 멘션해 보낸 일정이 여기에 모입니다.</span>
            </div>
            ${error ? `<div class="px-3 pb-2 text-rose-600 font-bold">${esc(error)}</div>` : ''}
            ${n && open ? `<div class="px-3 pb-3 space-y-3">
                <datalist id="ci-partner-list">${(state.partners || []).map(p => `<option value="${esc(typeof p === 'string' ? p : p.name)}"></option>`).join('')}</datalist>
                ${items.map(({ msg, cands }, mi) => `
                <div class="bg-white border border-amber-200 rounded-xl p-2.5 space-y-2" data-msg="${mi}">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="text-[11px] text-slate-500"><b class="text-slate-800">${esc(msg.sender)}</b> · ${esc(fmtTime(msg.sentAt))}${msg.space ? ` · ${esc(msg.space)}` : ''}</div>
                            <div class="mt-0.5 whitespace-pre-wrap font-medium text-slate-900 bg-slate-50 rounded-lg px-2 py-1">${esc(msg.text)}</div>
                        </div>
                        <div class="flex gap-1 shrink-0">
                            <button type="button" class="ci-save px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black" data-m="${mi}">체크한 일정 등록</button>
                            <button type="button" class="ci-ignore px-2.5 py-1 bg-white border border-slate-300 rounded-lg font-bold" data-m="${mi}">무시</button>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead class="text-slate-500 font-bold"><tr><th class="p-1 w-7"></th><th class="p-1 text-left">일자</th><th class="p-1 text-left">구분</th><th class="p-1 text-left">품목</th><th class="p-1 text-right">수량</th><th class="p-1 text-left">거래처</th><th class="p-1 text-left">일정 제목</th></tr></thead>
                            <tbody>${cands.map((c, ci) => candRow(c, mi, ci)).join('')}</tbody>
                        </table>
                    </div>
                </div>`).join('')}
            </div>` : ''}
        </div>`;
        createIcons({ icons });
        bind();
    };

    const bind = () => {
        el.querySelector('#ci-toggle')?.addEventListener('click', () => { open = !open; render(); });
        el.querySelector('#ci-refresh')?.addEventListener('click', load);
        el.querySelectorAll('tr[data-m]').forEach(tr => {
            const c = items[Number(tr.dataset.m)].cands[Number(tr.dataset.c)];
            tr.querySelector('.ci-inc').addEventListener('change', (e) => { c.include = e.target.checked; });
            tr.querySelectorAll('.ci-f').forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
                if (inp.dataset.k === 'qtyText') {
                    const m = inp.value.trim().match(/^([\d.,]+)\s*(.*)$/);
                    c.qty = m ? m[1].replace(/,/g, '') : inp.value.trim();
                    c.unit = m ? m[2] : '';
                } else c[inp.dataset.k] = inp.value;
            }));
            const inp = tr.querySelector('.ci-item');
            const sg = tr.querySelector('.ci-sg');
            let found = [];
            inp.addEventListener('input', () => {
                if (!inp.value.trim()) { c.itemCode = ''; c.itemName = ''; sg.classList.add('hidden'); return; }
                found = searchMasterItems(inp.value, 20);
                sg.innerHTML = found.map((m, i) => `<button type="button" data-i="${i}" class="w-full text-left px-2 py-1.5 border-b border-slate-100 hover:bg-indigo-50 flex gap-2"><span class="font-mono font-bold shrink-0">${esc(m.code)}</span><span class="font-bold truncate">${esc(m.name)}</span></button>`).join('') || '<div class="p-2 text-slate-400">일치하는 품목이 없습니다.</div>';
                sg.classList.remove('hidden');
                sg.querySelectorAll('button').forEach(b => {
                    b.addEventListener('mousedown', (e) => e.preventDefault());
                    b.addEventListener('click', () => {
                        const m = found[Number(b.dataset.i)];
                        c.itemCode = m.code; c.itemName = m.name; c.itemHow = '';
                        inp.value = `[${m.code}] ${m.name}`;
                        sg.classList.add('hidden');
                    });
                });
            });
            inp.addEventListener('blur', () => setTimeout(() => sg.classList.add('hidden'), 150));
        });
        el.querySelectorAll('.ci-save').forEach(b => b.addEventListener('click', async () => {
            const it = items[Number(b.dataset.m)];
            const picked = it.cands.filter(c => c.include);
            if (!picked.length) { alert('등록할 일정을 체크하세요.'); return; }
            const bad = picked.find(c => !c.date || !String(c.title || '').trim());
            if (bad) { alert('체크한 일정의 일자와 제목을 입력하세요.'); return; }
            b.disabled = true;
            try {
                const ids = [];
                for (const c of picked) {
                    const id = `SCHED-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
                    await saveSchedule({
                        id, date: c.date, type: c.type, title: c.title.trim(),
                        itemCode: c.itemCode || '', itemName: c.itemName || '', partner: c.partner || '', worker: it.msg.sender,
                        notes: `구글 챗 · ${it.msg.sender}${c.qty ? ` · 수량 ${c.qty}${c.unit || ''}` : ''}\n원문: ${c.line}`.slice(0, 1000),
                        status: 'TODO'
                    });
                    ids.push(id);
                }
                await markChatInbox(it.msg.id, 'DONE', ids);
                showToast(`📅 구글 챗 일정 ${ids.length}건을 등록했습니다.`);
                items = items.filter(x => x !== it);
                render();
                onScheduled();
            } catch (e) {
                alert(e.message);
                b.disabled = false;
            }
        }));
        el.querySelectorAll('.ci-ignore').forEach(b => b.addEventListener('click', async () => {
            const it = items[Number(b.dataset.m)];
            if (!confirm('이 메시지를 일정으로 등록하지 않고 받은함에서 뺄까요?')) return;
            try {
                await markChatInbox(it.msg.id, 'IGNORED');
                items = items.filter(x => x !== it);
                render();
            } catch (e) { alert(e.message); }
        }));
    };

    load();
};
