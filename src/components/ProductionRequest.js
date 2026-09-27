import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { localDateStr } from '../services/searchUtils.js';
import { listPlans, saveRequest, savePlan, deletePlan, newLineId, REQ_STATUS, PLAN_SITES, weekLabel, weekStart, monthOf, addDays } from '../services/plans.js';
import { renderLineTable, printA4, printTableHtml, btn, fmtQty } from './plans/planCommon.js';

// 생산관리 → 생산요청서: 영업·본사가 생산팀에 품목·수량·납기를 요청한다.
// 생산계획(주간)의 [생산요청서 불러오기]가 '요청·접수' 요청서를 계획 줄로 넣고 '계획반영'으로 바꾼다.
const STATUS_CLS = {
    REQUESTED: 'bg-blue-50 text-blue-700 border-blue-200', ACCEPTED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    PLANNED: 'bg-amber-50 text-amber-800 border-amber-200', DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200', REJECTED: 'bg-slate-100 text-slate-500 border-slate-300'
};
const statusBadge = (s) => `<span class="px-1.5 py-0.5 rounded border text-[10px] font-bold ${STATUS_CLS[s] || STATUS_CLS.REQUESTED}">${esc(REQ_STATUS[s] || s || '요청')}</span>`;
const blank = () => ({
    kind: 'PROD_REQ', reqDate: localDateStr(), dueDate: addDays(localDateStr(), 7), site: '본사', dept: '', requester: state.currentUser?.name || state.currentGlobalWorker || '',
    partner: '', urgent: false, reason: '', status: 'REQUESTED', reviewNote: '',
    lines: [{ id: newLineId(), code: '', name: '', spec: '', qty: '', unit: 'EA', pack: '', note: '' }]
});

export const renderProductionRequest = (container, { showToast, onSwitchTab }) => {
    const canWrite = canPerformAction('PRODUCTION');   // 작성·수정: 현장 작업자 이상
    const canManage = canPerformAction('MRP_PLANNING'); // 접수·반려·완료·삭제: 매니저 이상
    let month = monthOf(localDateStr());
    let statusFilter = '';
    let list = [];
    let cur = null;
    let dirty = false;

    container.innerHTML = `
    <section class="space-y-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-start justify-between gap-3">
            <div>
                <div class="text-[11px] font-black text-amber-600 flex items-center gap-1"><i data-lucide="file-input" class="w-3.5 h-3.5"></i>생산관리 › 생산요청서</div>
                <h2 class="text-lg font-black text-slate-900 mt-1">생산요청서</h2>
                <p class="text-xs text-slate-500 mt-1">생산할 품목·수량·납기를 생산팀에 요청합니다. 생산팀은 주간 생산계획에서 <b>생산요청서 불러오기</b>로 계획에 넣습니다.</p>
            </div>
            ${canWrite ? `<button type="button" id="rq-new" class="${btn('bg-amber-500 hover:bg-amber-600 text-white')}"><i data-lucide="plus" class="w-4 h-4"></i>새 요청서</button>` : ''}
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <aside class="lg:col-span-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="flex gap-2 text-xs">
                    <input type="month" id="rq-month" value="${month}" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 font-bold" />
                    <select id="rq-status" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                        <option value="">전체 상태</option>${Object.entries(REQ_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
                    </select>
                </div>
                <div id="rq-list" class="space-y-1.5 max-h-[65vh] overflow-y-auto"></div>
            </aside>
            <article id="rq-editor" class="lg:col-span-8 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm"></article>
        </div>
    </section>`;
    const $ = (s) => container.querySelector(s);
    const guard = () => !dirty || confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?');
    const setDirty = (v) => { dirty = v; $('#rq-dirty')?.classList.toggle('hidden', !v); };

    const loadList = async () => {
        $('#rq-list').innerHTML = '<div class="p-4 text-center text-xs text-slate-400">불러오는 중...</div>';
        try {
            list = await listPlans('PROD_REQ', `${month}-01`, `${month}-31`);
        } catch (e) {
            $('#rq-list').innerHTML = `<div class="p-3 text-xs text-rose-600 font-bold">${esc(e.message)}</div>`;
            return;
        }
        renderList();
    };
    const renderList = () => {
        const rows = list.filter(r => !statusFilter || r.status === statusFilter);
        $('#rq-list').innerHTML = rows.length === 0 ? '<div class="p-6 text-center text-xs text-slate-400">이 달의 요청서가 없습니다.</div>' : rows.map(r => `
            <button type="button" data-id="${esc(r.id)}" class="rq-item w-full text-left p-2.5 rounded-xl border text-xs transition ${cur?.id === r.id ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:border-amber-300'}">
                <div class="flex items-center justify-between gap-2"><span class="font-mono font-black text-slate-800">${esc(r.docNo)}</span>${statusBadge(r.status)}</div>
                <div class="mt-1 font-bold text-slate-700 truncate">${r.urgent ? '<span class="text-rose-600">[긴급]</span> ' : ''}${esc(r.partner || '(거래처 없음)')} · ${esc((r.lines || [])[0]?.name || '')}${(r.lines || []).length > 1 ? ` 외 ${r.lines.length - 1}` : ''}</div>
                <div class="text-[11px] text-slate-500">요청 ${esc(r.reqDate || r.period)} · 납기 ${esc(r.dueDate || '-')} · ${esc(r.site || '')} · ${esc(r.requester || '')}</div>
            </button>`).join('');
        container.querySelectorAll('.rq-item').forEach(b => b.addEventListener('click', () => { if (!guard()) return; cur = JSON.parse(JSON.stringify(list.find(x => x.id === b.dataset.id))); setDirty(false); renderList(); renderEditor(); }));
    };

    const field = (label, html, cls = '') => `<label class="block ${cls}"><span class="font-bold text-slate-600">${label}</span>${html}</label>`;
    const renderEditor = () => {
        const host = $('#rq-editor');
        if (!cur) {
            host.innerHTML = `<div class="p-10 text-center text-sm text-slate-400">왼쪽에서 요청서를 고르거나 ${canWrite ? '<b>새 요청서</b>를 누르세요.' : '조회하세요.'}</div>`;
            return;
        }
        const editable = canWrite && (!cur.docNo || ['REQUESTED', 'ACCEPTED'].includes(cur.status) || canManage);
        const inp = (k, type = 'text', extra = '') => `<input type="${type}" data-k="${k}" value="${esc(cur[k] ?? '')}" ${editable ? '' : 'disabled'} class="rq-f mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold disabled:bg-slate-50" ${extra} />`;
        host.innerHTML = `
            <div class="space-y-4 text-xs">
                <div class="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                        <h3 class="text-base font-black text-slate-900 flex items-center gap-2">${cur.docNo ? `<span class="font-mono">${esc(cur.docNo)}</span>` : '새 생산요청서'} ${cur.docNo ? statusBadge(cur.status) : ''}
                            <span id="rq-dirty" class="hidden px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">저장 안 됨</span></h3>
                        ${cur.planWeek ? `<button type="button" id="rq-go-plan" class="mt-1 text-[11px] text-blue-600 underline">📋 ${esc(weekLabel(cur.planWeek))} 생산계획에 반영됨 → 보기</button>` : ''}
                    </div>
                    <div class="flex flex-wrap gap-2">
                        ${editable ? `<button type="button" id="rq-add" class="${btn('bg-white text-slate-700 border border-slate-300 hover:bg-slate-50')}"><i data-lucide="plus" class="w-4 h-4"></i>품목 추가</button>
                        <button type="button" id="rq-save" class="${btn('bg-amber-500 hover:bg-amber-600 text-white')}"><i data-lucide="save" class="w-4 h-4"></i>${cur.docNo ? '저장' : '요청서 등록'}</button>` : ''}
                        ${cur.docNo && canManage ? `<button type="button" id="rq-del" class="${btn('bg-white text-rose-600 border border-rose-200 hover:bg-rose-50')}"><i data-lucide="trash-2" class="w-4 h-4"></i>삭제</button>` : ''}
                        ${cur.docNo ? `<button type="button" id="rq-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>A4 출력</button>` : ''}
                    </div>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    ${field('요청일', inp('reqDate', 'date'))}
                    ${field('납기일 *', inp('dueDate', 'date'))}
                    ${field('생산 거점', `<select data-k="site" ${editable ? '' : 'disabled'} class="rq-f mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${PLAN_SITES.map(s => `<option ${s === cur.site ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
                    ${field('긴급', `<label class="mt-1 flex items-center gap-2 border border-slate-300 rounded-lg px-2 py-1.5"><input type="checkbox" data-k="urgent" class="rq-f" ${cur.urgent ? 'checked' : ''} ${editable ? '' : 'disabled'} /><span class="font-bold text-rose-600">긴급 요청</span></label>`)}
                    ${field('요청 부서', inp('dept', 'text', 'placeholder="예: 영업팀"'))}
                    ${field('요청자', inp('requester'))}
                    ${field('거래처 (납품처)', inp('partner'), 'col-span-2')}
                    ${field('요청 사유 / 전달 사항', `<textarea data-k="reason" rows="2" ${editable ? '' : 'disabled'} class="rq-f mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 disabled:bg-slate-50">${esc(cur.reason || '')}</textarea>`, 'col-span-2 md:col-span-4')}
                </div>
                <div id="rq-lines"></div>
                ${cur.docNo ? `
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-2.5 items-end">
                    ${field('처리 상태', `<select id="rq-status-set" ${canManage ? '' : 'disabled'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${Object.entries(REQ_STATUS).map(([k, v]) => `<option value="${k}" ${k === cur.status ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
                    ${field('검토 의견 (접수·반려 사유)', `<input id="rq-review" value="${esc(cur.reviewNote || '')}" ${canManage ? '' : 'disabled'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" />`, 'md:col-span-2')}
                    <p class="md:col-span-3 text-[11px] text-slate-500">${canManage ? '상태를 바꾸고 [저장]을 누르세요. 생산계획에 불러오면 자동으로 \'계획반영\'이 됩니다.' : '상태 변경은 매니저 이상이 합니다.'}</p>
                </div>` : ''}
            </div>`;
        const renderLines = () => renderLineTable($('#rq-lines'), {
            lines: cur.lines, readOnly: !editable, emptyText: '요청 품목이 없습니다.',
            columns: [
                { key: 'name', label: '품목', type: 'item' },
                { key: 'qty', label: '수량', type: 'number', w: 'w-24', align: 'right' },
                { key: 'unit', label: '단위', type: 'text', w: 'w-16', minW: 64 },
                { key: 'pack', label: '포장·용기', type: 'text', w: 'w-32' },
                { key: 'note', label: '비고', type: 'text' }
            ],
            onChange: () => setDirty(true), onRerender: renderLines
        });
        renderLines();
        host.querySelectorAll('.rq-f').forEach(el => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => { cur[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; setDirty(true); }));
        $('#rq-status-set')?.addEventListener('change', (e) => { cur.status = e.target.value; setDirty(true); });
        $('#rq-review')?.addEventListener('input', (e) => { cur.reviewNote = e.target.value; setDirty(true); });
        $('#rq-add')?.addEventListener('click', () => { cur.lines.push({ id: newLineId(), code: '', name: '', spec: '', qty: '', unit: 'EA', pack: '', note: '' }); setDirty(true); renderLines(); });
        $('#rq-go-plan')?.addEventListener('click', () => { if (!guard()) return; window.__pendingPlanOpen = { tab: 'prodPlan', view: 'week', date: cur.planWeek }; onSwitchTab('prodPlan'); });
        $('#rq-save')?.addEventListener('click', async () => {
            if (!cur.dueDate) { alert('납기일을 넣으세요.'); return; }
            cur.lines = cur.lines.filter(l => l.code || l.name);
            try {
                const isNew = !cur.docNo;
                cur = await (isNew ? saveRequest(cur) : savePlan({ ...cur, period: cur.reqDate || cur.period }));
                setDirty(false);
                showToast(isNew ? `📨 생산요청서 ${cur.docNo}를 등록했습니다.` : `💾 ${cur.docNo}를 저장했습니다.`);
                month = monthOf(cur.reqDate || cur.period);
                $('#rq-month').value = month;
                await loadList();
                renderEditor();
                createIcons({ icons });
            } catch (e) { alert(e.message); }
        });
        $('#rq-del')?.addEventListener('click', async () => {
            if (!confirm(`생산요청서 ${cur.docNo}를 삭제할까요?${cur.status === 'PLANNED' ? '\n(이미 생산계획에 불러온 줄은 계획에 그대로 남습니다)' : ''}`)) return;
            try { await deletePlan(cur.id); cur = null; setDirty(false); showToast('🗑️ 요청서를 삭제했습니다.'); await loadList(); renderEditor(); } catch (e) { alert(e.message); }
        });
        $('#rq-print')?.addEventListener('click', () => {
            const ls = cur.lines.filter(l => l.code || l.name);
            printA4({
                title: '생 산 요 청 서', subtitle: 'PRODUCTION REQUEST', approvals: ['요청', '접수', '승인'],
                meta: [['요청번호', cur.docNo], ['요청일', cur.reqDate || cur.period], ['납기일', cur.dueDate || ''], ['생산 거점', cur.site || ''], ['상태', REQ_STATUS[cur.status] || '']],
                bodyHtml: `<table class="grid" style="margin-bottom:3mm"><colgroup><col style="width:24mm"><col><col style="width:24mm"><col></colgroup><tbody>
                        <tr><th>요청 부서</th><td>${esc(cur.dept || '')}</td><th>요청자</th><td>${esc(cur.requester || '')}</td></tr>
                        <tr><th>거래처</th><td>${esc(cur.partner || '')}</td><th>긴급</th><td>${cur.urgent ? '<span class="short">긴급</span>' : '일반'}</td></tr>
                        <tr><th>요청 사유</th><td colspan="3" style="height:12mm">${esc(cur.reason || '')}</td></tr></tbody></table>
                    ${printTableHtml([
                        { label: '품목코드', w: 26, get: l => l.code }, { label: '품목명', get: l => l.name }, { label: '규격', w: 22, get: l => l.spec || '' },
                        { label: '수량', w: 18, get: l => fmtQty(l.qty), cls: 'r' }, { label: '단위', w: 10, get: l => l.unit || '', cls: 'c' },
                        { label: '포장·용기', w: 24, get: l => l.pack || '' }, { label: '비고', w: 30, get: l => l.note || '' }
                    ], ls, { minRows: 10 })}
                    <h2>생산팀 검토 의견</h2><div class="notes">${esc(cur.reviewNote || '')}${cur.planWeek ? `\n계획 반영: ${esc(weekLabel(cur.planWeek))}` : ''}</div>`
            });
        });
        createIcons({ icons });
    };

    $('#rq-new')?.addEventListener('click', () => { if (!guard()) return; cur = blank(); setDirty(true); renderList(); renderEditor(); });
    $('#rq-month').addEventListener('change', (e) => { if (!e.target.value) return; month = e.target.value; loadList(); });
    $('#rq-status').addEventListener('change', (e) => { statusFilter = e.target.value; renderList(); });
    loadList().then(() => { renderEditor(); createIcons({ icons }); });
};

export { weekStart };
