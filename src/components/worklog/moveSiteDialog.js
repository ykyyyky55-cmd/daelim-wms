// ==========================================
// 업무일지 줄을 다른 거점 일지로 옮기는 창 (본사 ⇄ 김포) — 거점을 잘못 골라 적었을 때
// ==========================================
// 줄을 골라 [옮기기]를 누르면 같은 날짜의 상대 거점 일지로 옮기고, 이미 반영된 재고도 함께 맞춘다 (services/worklogMove.js).
import { state, WORKLOG_SITES } from '../../services/db.js';
import { previewWorklogMove, moveWorklogRows } from '../../services/worklogMove.js';
import { esc } from '../../services/html.js';

const MODE_TONE = { FIX: 'text-emerald-700', APPLY: 'text-blue-700', LATER: 'text-slate-500', NONE: 'text-slate-400' };

/**
 * @param {{ date: string, site: 'HQ'|'GIMPO' }} p 지금 보고 있는 일지
 * @returns {Promise<{ moved: number, toSite: string }|null>} 옮겼으면 결과, 닫았으면 null
 */
export const openMoveSiteDialog = ({ date, site }) => new Promise((resolve) => {
    const toSite = site === 'HQ' ? 'GIMPO' : 'HQ';
    const from = WORKLOG_SITES[site], to = WORKLOG_SITES[toSite];
    const view = previewWorklogMove({ date, fromSite: site, toSite });
    const box = document.createElement('div');
    box.className = 'fixed inset-0 z-[70] bg-slate-900/60 p-2 sm:p-4 flex items-start justify-center overflow-y-auto no-print';
    const total = view.sections.reduce((n, sec) => n + sec.rows.length, 0);
    box.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4 text-xs overflow-hidden">
        <div class="px-4 py-3 bg-slate-800 text-white flex items-center justify-between">
            <h3 class="font-black text-sm">${esc(date)} 업무일지 줄 옮기기 · ${esc(from.name)} → ${esc(to.name)}</h3>
            <button type="button" class="ms-x text-xl px-1" aria-label="닫기">&times;</button></div>
        <div class="p-4 space-y-3">
            <p class="text-slate-600 leading-relaxed">거점을 잘못 골라 적은 줄을 <b>${esc(to.name)} 업무일지의 같은 날짜(${esc(date)})</b>로 옮깁니다${view.hasTarget ? ` — ${esc(to.name)}에 이미 있는 일지 끝에 붙습니다` : ''}.
                이미 ${esc(from.name)} 재고에 반영된 줄은 <b>재고도 ${esc(to.name)}(으)로 옮겨</b> 입출고 이력·수불부에 '거점 정정'으로 남깁니다.</p>
            ${total ? `<div class="flex flex-wrap items-center gap-3">
                <label class="flex items-center gap-1.5 font-bold cursor-pointer"><input type="checkbox" id="ms-all" checked> 모두 고르기 (${total}줄)</label>
                <label class="flex items-center gap-1.5 font-bold cursor-pointer" title="끄면 일지 줄만 옮기고 재고는 그대로 둡니다"><input type="checkbox" id="ms-stock" checked> 재고도 함께 맞추기</label>
            </div>
            <div class="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[55vh] overflow-y-auto overflow-x-hidden">
                ${view.sections.map(sec => `<div>
                    <label class="flex items-center gap-2 px-3 py-2 bg-slate-50 font-black text-slate-700 cursor-pointer sticky top-0"><input type="checkbox" class="ms-sec" data-list="${esc(sec.listKey)}" checked> ${esc(sec.title)} <span class="font-normal text-slate-400">${sec.rows.length}줄</span></label>
                    ${sec.rows.map(r => `<label class="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-blue-50">
                        <input type="checkbox" class="ms-row mt-0.5" data-list="${esc(sec.listKey)}" data-i="${r.index}" checked>
                        <span class="flex-1 min-w-0"><span class="font-bold text-slate-800 break-words">${esc(r.label)}</span>${r.qty ? ` <span class="text-slate-500">· ${esc(r.qty)}</span>` : ''}
                            ${r.stock ? `<span class="block ${MODE_TONE[r.mode] || ''}">${esc(r.stock)}</span>` : ''}</span></label>`).join('')}
                </div>`).join('')}
            </div>` : `<p class="text-slate-500 border border-dashed rounded-xl p-4 text-center">이 날짜의 ${esc(from.name)} 일지에 옮길 줄이 없습니다.</p>`}
            <div id="ms-msg" class="font-bold whitespace-pre-line"></div>
            <div class="flex justify-end gap-2">
                <button type="button" class="ms-x px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold">닫기</button>
                ${total ? `<button type="button" id="ms-ok" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black">${esc(to.name)} 일지로 옮기기</button>` : ''}
            </div>
        </div></div>`;
    document.body.appendChild(box);
    const $ = (s) => box.querySelector(s);
    const rows = () => [...box.querySelectorAll('.ms-row')];
    const done = (value) => { box.remove(); resolve(value); };
    box.querySelectorAll('.ms-x').forEach(b => b.addEventListener('click', () => done(null)));
    $('#ms-all')?.addEventListener('change', (e) => { box.querySelectorAll('.ms-row, .ms-sec').forEach(c => { c.checked = e.target.checked; }); });
    box.querySelectorAll('.ms-sec').forEach(c => c.addEventListener('change', () => rows().filter(r => r.dataset.list === c.dataset.list).forEach(r => { r.checked = c.checked; })));
    $('#ms-ok')?.addEventListener('click', async () => {
        const picks = rows().filter(r => r.checked).map(r => ({ listKey: r.dataset.list, index: Number(r.dataset.i) }));
        const msg = $('#ms-msg');
        if (!picks.length) { msg.className = 'font-bold text-rose-600'; msg.textContent = '옮길 줄을 고르세요.'; return; }
        const withStock = $('#ms-stock').checked;
        if (!confirm(`${date} ${from.name} 일지의 ${picks.length}줄을 ${to.name} 일지로 옮길까요?${withStock ? '\n이미 반영된 재고도 함께 옮깁니다.' : '\n재고는 그대로 둡니다.'}`)) return;
        const btn = $('#ms-ok');
        btn.disabled = true;
        btn.textContent = '옮기는 중…';
        try {
            const res = await moveWorklogRows({ date, fromSite: site, toSite, picks, withStock, worker: state.currentGlobalWorker || state.currentUser?.name || '' });
            const lines = [`${res.moved}줄을 ${to.name} 일지로 옮겼습니다.`];
            if (res.stockFixed) lines.push(`· 재고를 ${to.name} 기준으로 맞춘 줄 ${res.stockFixed}건`);
            if (res.stockApplied) lines.push(`· ${to.name} 재고에 바로 반영한 줄 ${res.stockApplied}건`);
            if (res.notes.length) lines.push('', ...res.notes);
            if (res.errors.length) lines.push('', `옮기지 못한 줄 ${res.errors.length}건 (원래 일지에 그대로 있습니다):`, ...res.errors);
            alert(lines.join('\n'));
            done({ moved: res.moved, toSite });
        } catch (e) {
            msg.className = 'font-bold text-rose-600 whitespace-pre-line';
            msg.textContent = `옮기지 못했습니다: ${e.message}`;
            btn.disabled = false;
            btn.textContent = `${to.name} 일지로 옮기기`;
        }
    });
});
