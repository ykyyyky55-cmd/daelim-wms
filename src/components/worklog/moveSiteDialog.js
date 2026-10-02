// ==========================================
// 업무일지 줄을 다른 거점·다른 날짜 일지로 옮기는 창 (본사 ⇄ 김포, 날짜) — 거점이나 날짜를 잘못 골라 적었을 때
// ==========================================
// 받는 거점과 날짜를 정하고 줄을 골라 [옮기기]를 누르면 그 일지로 옮기고, 이미 반영된 재고도 함께 맞춘다 (services/worklogMove.js).
import { state, WORKLOG_SITES } from '../../services/db.js';
import { previewWorklogMove, moveWorklogRows } from '../../services/worklogMove.js';
import { esc } from '../../services/html.js';

const MODE_TONE = { FIX: 'text-emerald-700', APPLY: 'text-blue-700', LATER: 'text-slate-500', NONE: 'text-slate-400' };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));

/**
 * @param {{ date: string, site: 'HQ'|'GIMPO' }} p 지금 보고 있는 일지
 * @returns {Promise<{ moved: number, toSite: string, toDate: string }|null>} 옮겼으면 결과, 닫았으면 null
 */
export const openMoveSiteDialog = ({ date, site }) => new Promise((resolve) => {
    const from = WORKLOG_SITES[site];
    // 받는 일지: 처음에는 상대 거점의 같은 날짜
    const target = { site: site === 'HQ' ? 'GIMPO' : 'HQ', date };
    const unchecked = new Set(); // 고르지 않은 줄 ('항목|번호') — 받는 일지를 바꿔 목록을 다시 그려도 그대로
    const box = document.createElement('div');
    box.className = 'fixed inset-0 z-[70] bg-slate-900/60 p-2 sm:p-4 flex items-start justify-center overflow-y-auto no-print';
    box.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4 text-xs overflow-hidden">
        <div class="px-4 py-3 bg-slate-800 text-white flex items-center justify-between">
            <h3 class="font-black text-sm">${esc(from.name)} ${esc(date)} 업무일지 줄 옮기기</h3>
            <button type="button" class="ms-x text-xl px-1" aria-label="닫기">&times;</button></div>
        <div class="p-4 space-y-3">
            <div class="flex flex-wrap items-end gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <label class="block font-bold text-slate-700">받는 거점
                    <select id="ms-site" class="mt-1 block border border-slate-300 rounded-lg px-2.5 py-2 font-bold bg-white">
                        ${Object.values(WORKLOG_SITES).map(s => `<option value="${esc(s.key)}" ${s.key === target.site ? 'selected' : ''}>${esc(s.name)}${s.key === site ? ' (같은 거점 — 날짜만 옮기기)' : ''}</option>`).join('')}
                    </select></label>
                <label class="block font-bold text-slate-700">받는 날짜
                    <input type="date" id="ms-date" value="${esc(date)}" class="mt-1 block border border-slate-300 rounded-lg px-2.5 py-2 font-bold bg-white"></label>
                <p id="ms-target" class="flex-1 min-w-[200px] text-slate-600 leading-relaxed"></p>
            </div>
            <div id="ms-body"></div>
            <div id="ms-msg" class="font-bold whitespace-pre-line"></div>
            <div class="flex justify-end gap-2">
                <button type="button" class="ms-x px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold">닫기</button>
                <button type="button" id="ms-ok" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black disabled:opacity-40">옮기기</button>
            </div>
        </div></div>`;
    document.body.appendChild(box);
    const $ = (s) => box.querySelector(s);
    const rows = () => [...box.querySelectorAll('.ms-row')];
    const keyOf = (el) => `${el.dataset.list}|${el.dataset.i}`;
    const isSameLog = () => target.site === site && target.date === date;
    const targetName = () => `${WORKLOG_SITES[target.site].name} ${target.date}`;
    const done = (value) => { box.remove(); resolve(value); };
    const say = (text, isError = true) => { const m = $('#ms-msg'); m.className = `font-bold whitespace-pre-line ${isError ? 'text-rose-600' : 'text-emerald-700'}`; m.textContent = text; };

    /** 받는 일지에 맞춰 줄 목록(재고 처리 미리보기)을 다시 그린다 */
    const renderBody = () => {
        const ok = $('#ms-ok');
        say('');
        if (!isDate(target.date) || isSameLog()) {
            $('#ms-target').textContent = '';
            $('#ms-body').innerHTML = `<p class="text-amber-700 font-bold border border-dashed border-amber-300 rounded-xl p-4 text-center">${isSameLog() ? '지금 보고 있는 일지입니다 — 받는 거점이나 날짜를 바꾸세요.' : '받는 날짜를 고르세요.'}</p>`;
            ok.disabled = true;
            return;
        }
        const view = previewWorklogMove({ date, fromSite: site, toSite: target.site, toDate: target.date });
        const total = view.sections.reduce((n, sec) => n + sec.rows.length, 0);
        $('#ms-target').innerHTML = `<b>${esc(targetName())}</b> 업무일지${view.hasTarget ? '(이미 있음)의 끝에 붙습니다' : '를 새로 만들어 옮깁니다'}${view.dstSynced ? ' — 이미 수불부에 반영된 일지입니다' : ''}.
            ${target.site === site ? '같은 거점이라 재고는 바뀌지 않습니다.' : `이미 ${esc(from.name)} 재고에 반영된 줄은 <b>재고도 ${esc(WORKLOG_SITES[target.site].name)}(으)로 옮깁니다</b>.`}`;
        ok.disabled = !total;
        ok.textContent = `${targetName()} 일지로 옮기기`;
        $('#ms-body').innerHTML = !total ? `<p class="text-slate-500 border border-dashed rounded-xl p-4 text-center">이 날짜의 ${esc(from.name)} 일지에 옮길 줄이 없습니다.</p>` : `
            <div class="flex flex-wrap items-center gap-3 mb-2">
                <label class="flex items-center gap-1.5 font-bold cursor-pointer"><input type="checkbox" id="ms-all" ${unchecked.size ? '' : 'checked'}> 모두 고르기 (${total}줄)</label>
                <label class="flex items-center gap-1.5 font-bold cursor-pointer" title="끄면 일지 줄만 옮기고 재고는 그대로 둡니다"><input type="checkbox" id="ms-stock" checked> 재고도 함께 맞추기</label>
            </div>
            <div class="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[50vh] overflow-y-auto overflow-x-hidden">
                ${view.sections.map(sec => `<div>
                    <label class="flex items-center gap-2 px-3 py-2 bg-slate-50 font-black text-slate-700 cursor-pointer sticky top-0"><input type="checkbox" class="ms-sec" data-list="${esc(sec.listKey)}" ${sec.rows.some(r => !unchecked.has(`${sec.listKey}|${r.index}`)) ? 'checked' : ''}> ${esc(sec.title)} <span class="font-normal text-slate-400">${sec.rows.length}줄</span></label>
                    ${sec.rows.map(r => `<label class="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-blue-50">
                        <input type="checkbox" class="ms-row mt-0.5" data-list="${esc(sec.listKey)}" data-i="${r.index}" ${unchecked.has(`${sec.listKey}|${r.index}`) ? '' : 'checked'}>
                        <span class="flex-1 min-w-0"><span class="font-bold text-slate-800 break-words">${esc(r.label)}</span>${r.qty ? ` <span class="text-slate-500">· ${esc(r.qty)}</span>` : ''}
                            ${r.stock ? `<span class="block ${MODE_TONE[r.mode] || ''}">${esc(r.stock)}</span>` : ''}</span></label>`).join('')}
                </div>`).join('')}
            </div>`;
    };

    box.querySelectorAll('.ms-x').forEach(b => b.addEventListener('click', () => done(null)));
    $('#ms-site').addEventListener('change', (e) => { target.site = e.target.value; renderBody(); });
    $('#ms-date').addEventListener('change', (e) => { target.date = e.target.value; renderBody(); });
    // 줄 고르기 (목록을 다시 그려도 듣도록 창에 붙인다)
    box.addEventListener('change', (e) => {
        const el = e.target;
        const setRow = (r, isOn) => { r.checked = isOn; if (isOn) unchecked.delete(keyOf(r)); else unchecked.add(keyOf(r)); };
        if (el.id === 'ms-all') { rows().forEach(r => setRow(r, el.checked)); box.querySelectorAll('.ms-sec').forEach(c => { c.checked = el.checked; }); }
        else if (el.classList.contains('ms-sec')) rows().filter(r => r.dataset.list === el.dataset.list).forEach(r => setRow(r, el.checked));
        else if (el.classList.contains('ms-row')) setRow(el, el.checked);
    });
    $('#ms-ok').addEventListener('click', async () => {
        const picks = rows().filter(r => r.checked).map(r => ({ listKey: r.dataset.list, index: Number(r.dataset.i) }));
        if (!picks.length) { say('옮길 줄을 고르세요.'); return; }
        const withStock = $('#ms-stock').checked;
        if (!confirm(`${from.name} ${date} 일지의 ${picks.length}줄을 ${targetName()} 일지로 옮길까요?${target.site === site ? '' : withStock ? '\n이미 반영된 재고도 함께 옮깁니다.' : '\n재고는 그대로 둡니다.'}`)) return;
        const btn = $('#ms-ok');
        btn.disabled = true;
        btn.textContent = '옮기는 중…';
        try {
            const res = await moveWorklogRows({ date, fromSite: site, toSite: target.site, toDate: target.date, picks, withStock, worker: state.currentGlobalWorker || state.currentUser?.name || '' });
            const lines = [`${res.moved}줄을 ${targetName()} 일지로 옮겼습니다.`];
            if (res.stockFixed && target.site !== site) lines.push(`· 재고를 ${WORKLOG_SITES[target.site].name} 기준으로 맞춘 줄 ${res.stockFixed}건`);
            if (res.stockApplied) lines.push(`· ${WORKLOG_SITES[target.site].name} 재고에 바로 반영한 줄 ${res.stockApplied}건`);
            if (res.notes.length && target.site !== site) lines.push('', ...res.notes);
            if (res.errors.length) lines.push('', `옮기지 못한 줄 ${res.errors.length}건 (원래 일지에 그대로 있습니다):`, ...res.errors);
            alert(lines.join('\n'));
            done({ moved: res.moved, toSite: target.site, toDate: target.date });
        } catch (e) {
            say(`옮기지 못했습니다: ${e.message}`);
            renderBody();
        }
    });
    renderBody();
});
