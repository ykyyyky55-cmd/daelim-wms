import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { localDateStr } from '../services/searchUtils.js';
import { listPlans, saveRequest, savePlan, deletePlan, newLineId, REQ_STATUS, REQ_TYPES, reqTypeOf, PLAN_SITES, weekLabel, monthOf, addDays } from '../services/plans.js';
import { renderLineTable, printA4, printTableHtml, btn, fmtQty } from './plans/planCommon.js';
import { ensureDeptDatalist } from '../services/org.js';
import { mountApprovalBox } from './approval/ApprovalBox.js';
import { getApprovals, approvalStatus } from '../services/approvals.js';
import { fillAssigneeSelect, readAssignee, assignTasks } from '../services/assign.js';
import { locationOptionsHtml, locationLabel } from '../services/locations.js';
import { markChatInbox } from '../services/chatSchedule.js';

// 생산관리 → 생산요청서(제품생산요청서·원액생산요청서) / 구매요청서
// - 생산요청서: 영업·본사가 생산팀에 품목·수량·납기를 요청 → 주간 생산계획 [생산요청서 불러오기]가 계획 줄로 넣고 '계획반영'
// - 구매요청서: 필요한 원료·부자재 구매를 요청 → 주간 구매계획 [구매요청서 불러오기]가 구매 줄로 넣고 '계획반영'
const STATUS_CLS = {
    REQUESTED: 'bg-blue-50 text-blue-700 border-blue-200', ACCEPTED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    PLANNED: 'bg-amber-50 text-amber-800 border-amber-200', DONE: 'bg-emerald-50 text-emerald-700 border-emerald-200', REJECTED: 'bg-slate-100 text-slate-500 border-slate-300'
};
const statusText = (type, s) => (type === 'PURCH' && s === 'DONE' ? '입고완료' : REQ_STATUS[s] || s || '요청');
const statusBadge = (type, s) => `<span class="px-1.5 py-0.5 rounded border text-[10px] font-bold ${STATUS_CLS[s] || STATUS_CLS.REQUESTED}">${esc(statusText(type, s))}</span>`;
const isPurch = (t) => t === 'PURCH';
// 전자결재 칸 (요청서 id별)
const apprRoles = (type) => (isPurch(type) ? ['요청', '검토', '승인'] : ['요청', '접수', '승인']);
const apprKey = (r) => `REQ:${r.id}`;
const blank = (type) => ({
    kind: REQ_TYPES[type].kind, reqType: type, reqDate: localDateStr(), dueDate: addDays(localDateStr(), 7), site: isPurch(type) ? '김포' : '본사', dept: '',
    requester: state.currentUser?.name || state.currentGlobalWorker || '', partner: '', moveTo: '', planDate: '', assigneeId: '', assigneeName: '', urgent: false, reason: '', status: 'REQUESTED', reviewNote: '',
    lines: [{ id: newLineId(), code: '', name: '', spec: '', qty: '', unit: REQ_TYPES[type].unit, pack: '', supplier: '', price: '', note: '' }]
});

const renderRequests = (container, { types, title, crumb, desc, accent, showToast, onSwitchTab }) => {
    const canWrite = canPerformAction('PRODUCTION');   // 작성·수정: 현장 작업자 이상
    const canManage = canPerformAction('MRP_PLANNING'); // 접수·반려·완료·삭제: 매니저 이상
    const VIEW_KEY = `daelim_req_type_${types.join('_')}`;
    let type = (() => { try { const v = localStorage.getItem(VIEW_KEY); return types.includes(v) ? v : types[0]; } catch { return types[0]; } })();
    let month = monthOf(localDateStr());
    // 할일·알림의 [열기]로 들어온 요청서 (window.__reqOpen = { id, type, month })
    const pendingOpen = window.__reqOpen && types.includes(window.__reqOpen.type) ? window.__reqOpen : null;
    window.__reqOpen = null;
    if (pendingOpen) { type = pendingOpen.type; month = pendingOpen.month || month; }
    // 메시지 접수(services/msgIntake.js)로 들어온 초안: window.__reqDraft = { type, draft, source }
    const pendingDraft = window.__reqDraft && types.includes(window.__reqDraft.type) ? window.__reqDraft : null;
    window.__reqDraft = null;
    if (pendingDraft) type = pendingDraft.type;
    let statusFilter = '';
    let list = [];
    let apprMap = new Map();
    let cur = null;
    let dirty = false;
    const T = () => REQ_TYPES[type];

    container.innerHTML = `
    <section class="space-y-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black ${accent.text} flex items-center gap-1"><i data-lucide="${isPurch(types[0]) ? 'shopping-bag' : 'file-input'}" class="w-3.5 h-3.5"></i>${esc(crumb)}</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1">${esc(title)}</h2>
                    <p class="text-xs text-slate-500 mt-1">${desc}</p>
                </div>
                ${canWrite ? `<button type="button" id="rq-new" class="${btn(accent.btn)}"><i data-lucide="plus" class="w-4 h-4"></i><span id="rq-new-label">새 ${esc(T().label)}</span></button>` : ''}
            </div>
            ${types.length > 1 ? `<div class="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">${types.map(t => `<button type="button" data-t="${t}" class="rq-type px-3.5 py-2 rounded-lg text-xs font-black flex items-center gap-1.5 transition"><i data-lucide="${t === 'RAW' ? 'flask-conical' : 'package'}" class="w-4 h-4"></i>${esc(REQ_TYPES[t].label)}</button>`).join('')}</div>` : ''}
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <aside class="lg:col-span-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="flex gap-2 text-xs">
                    <input type="month" id="rq-month" value="${month}" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 font-bold" />
                    <select id="rq-status" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                        <option value="">전체 상태</option>${Object.keys(REQ_STATUS).map(k => `<option value="${k}">${statusText(types[0], k)}</option>`).join('')}
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
    const paintTypes = () => {
        container.querySelectorAll('.rq-type').forEach(b => { b.className = `rq-type px-3.5 py-2 rounded-lg text-xs font-black flex items-center gap-1.5 transition ${b.dataset.t === type ? 'bg-white shadow-sm ' + accent.text : 'text-slate-600 hover:text-slate-900'}`; });
        const l = $('#rq-new-label'); if (l) l.textContent = `새 ${T().label}`;
    };

    const loadList = async () => {
        $('#rq-list').innerHTML = '<div class="p-4 text-center text-xs text-slate-400">불러오는 중...</div>';
        try {
            list = (await listPlans(T().kind, `${month}-01`, `${month}-31`)).filter(r => reqTypeOf(r) === type);
            apprMap = await getApprovals(list.map(apprKey));
        } catch (e) {
            $('#rq-list').innerHTML = `<div class="p-3 text-xs text-rose-600 font-bold">${esc(e.message)}</div>`;
            return;
        }
        renderList();
    };
    const apprBadge = (r) => {
        const roles = apprRoles(type), slots = apprMap.get(apprKey(r)) || {};
        const st = approvalStatus(roles, slots);
        if (st === 'NONE') return '';
        const n = roles.filter(x => slots[x]).length;
        return `<span class="px-1.5 py-0.5 rounded border text-[10px] font-bold ${st === 'DONE' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-white text-slate-500 border-slate-200'}">결재 ${st === 'DONE' ? '완료' : `${n}/${roles.length}`}</span>`;
    };
    const renderList = () => {
        const rows = list.filter(r => !statusFilter || r.status === statusFilter);
        $('#rq-list').innerHTML = rows.length === 0 ? `<div class="p-6 text-center text-xs text-slate-400">이 달의 ${esc(T().label)}가 없습니다.</div>` : rows.map(r => `
            <button type="button" data-id="${esc(r.id)}" class="rq-item w-full text-left p-2.5 rounded-xl border text-xs transition ${cur?.id === r.id ? `${accent.border} ${accent.bgSoft}` : 'border-slate-200 hover:border-slate-400'}">
                <div class="flex items-center justify-between gap-2"><span class="font-mono font-black text-slate-800">${esc(r.docNo)}</span><span class="flex items-center gap-1">${apprBadge(r)}${statusBadge(type, r.status)}</span></div>
                <div class="mt-1 font-bold text-slate-700 truncate">${r.urgent ? '<span class="text-rose-600">[긴급]</span> ' : ''}${isPurch(type) ? '' : type === 'RAW' ? `→ ${esc(r.moveTo ? locationLabel(r.moveTo) : '(이동처 없음)')} · ` : `${esc(r.partner || '(거래처 없음)')} · `}${esc((r.lines || [])[0]?.name || '')}${(r.lines || []).length > 1 ? ` 외 ${r.lines.length - 1}` : ''}</div>
                <div class="text-[11px] text-slate-500">요청 ${esc(r.reqDate || r.period)} · ${isPurch(type) ? '필요일' : '납기'} ${esc(r.dueDate || '-')} · ${esc(r.site || '')} · ${esc(r.requester || '')}${r.assigneeName ? ` · 담당 <b>${esc(r.assigneeName)}</b>` : ''}</div>
            </button>`).join('');
        container.querySelectorAll('.rq-item').forEach(b => b.addEventListener('click', () => { if (!guard()) return; cur = JSON.parse(JSON.stringify(list.find(x => x.id === b.dataset.id))); setDirty(false); renderList(); renderEditor(); }));
    };

    // 담당자(수신자) → 할일(생산 예정일·납기/필요일) + 메시지. 담당자·날짜가 그대로면 메시지는 다시 보내지 않는다.
    const notifyAssignee = async (r, before) => {
        const prev = before?.assigneeId || '';
        if (!r.assigneeId && !prev) return;
        const P = isPurch(type);
        const what = `${(r.lines || [])[0]?.name || ''}${(r.lines || []).length > 1 ? ` 외 ${r.lines.length - 1}` : ''}`;
        const changed = !before || prev !== r.assigneeId || before.dueDate !== r.dueDate || (before.planDate || '') !== (r.planDate || '');
        const tasks = P
            ? [{ part: 'DUE', label: '입고 필요일', text: `[구매요청] ${r.docNo} ${what} 입고 필요`, dueDate: r.dueDate }]
            : [
                { part: 'PROD', label: '생산 예정', text: `[${T().label}] ${r.docNo} ${what} 생산 예정`, dueDate: r.planDate },
                { part: 'DUE', label: type === 'RAW' ? '이동(납기)' : '납기', text: `[${T().label}] ${r.docNo} ${what} 납기${type === 'RAW' && r.moveTo ? ` → ${locationLabel(r.moveTo)}` : r.partner ? ` (${r.partner})` : ''}`, dueDate: r.dueDate }
            ].filter(t => t.part === 'DUE' || t.dueDate);
        const res = await assignTasks({
            ref: `REQ:${r.id}`, assignee: r.assigneeId ? { id: r.assigneeId, name: r.assigneeName } : null, prev,
            tasks, parts: P ? ['DUE'] : ['PROD', 'DUE'],
            title: `[${T().label}] ${r.docNo}${r.urgent ? ' (긴급)' : ''}`,
            lines: [what, r.reason ? `사유: ${r.reason}` : '', `요청: ${r.requester || ''}`],
            link: { tab: P ? 'purchRequest' : 'prodRequest', set: { __reqOpen: { id: r.id, type, month: monthOf(r.reqDate || r.period) } } },
            notify: changed
        });
        if (res.message) showToast(res.ok ? `🔔 ${res.message}` : `⚠️ ${res.message}`);
    };

    const field = (label, html, cls = '') => `<label class="block ${cls}"><span class="font-bold text-slate-600">${label}</span>${html}</label>`;
    const amountOf = (r) => (r.lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
    const renderEditor = () => {
        const host = $('#rq-editor');
        if (!cur) {
            host.innerHTML = `<div class="p-10 text-center text-sm text-slate-400">왼쪽에서 ${esc(T().label)}를 고르거나 ${canWrite ? `<b>새 ${esc(T().label)}</b>를 누르세요.` : '조회하세요.'}</div>`;
            return;
        }
        const P = isPurch(type);
        const editable = canWrite && (!cur.docNo || ['REQUESTED', 'ACCEPTED'].includes(cur.status) || canManage);
        const inp = (k, t = 'text', extra = '') => `<input type="${t}" data-k="${k}" value="${esc(cur[k] ?? '')}" ${editable ? '' : 'disabled'} class="rq-f mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold disabled:bg-slate-50" ${extra} />`;
        host.innerHTML = `
            <div class="space-y-4 text-xs">
                <div class="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                        <div class="text-[11px] font-black ${accent.text}">${esc(T().label)}</div>
                        <h3 class="text-base font-black text-slate-900 flex items-center gap-2">${cur.docNo ? `<span class="font-mono">${esc(cur.docNo)}</span>` : `새 ${esc(T().label)}`} ${cur.docNo ? statusBadge(type, cur.status) : ''}
                            <span id="rq-dirty" class="hidden px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">저장 안 됨</span></h3>
                        ${cur.planWeek ? `<button type="button" id="rq-go-plan" class="mt-1 text-[11px] text-blue-600 underline">📋 ${esc(weekLabel(cur.planWeek))} ${P ? '구매계획' : '생산계획'}에 반영됨 → 보기</button>` : ''}
                    </div>
                    <div class="flex flex-wrap gap-2">
                        ${editable ? `<button type="button" id="rq-add" class="${btn('bg-white text-slate-700 border border-slate-300 hover:bg-slate-50')}"><i data-lucide="plus" class="w-4 h-4"></i>품목 추가</button>
                        <button type="button" id="rq-save" class="${btn(accent.btn)}"><i data-lucide="save" class="w-4 h-4"></i>${cur.docNo ? '저장' : '요청서 등록'}</button>` : ''}
                        ${cur.docNo && canManage ? `<button type="button" id="rq-del" class="${btn('bg-white text-rose-600 border border-rose-200 hover:bg-rose-50')}"><i data-lucide="trash-2" class="w-4 h-4"></i>삭제</button>` : ''}
                        ${cur.docNo ? `<button type="button" id="rq-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>A4 출력</button>` : ''}
                    </div>
                </div>
                ${cur.docNo ? '<div id="rq-appr" class="flex justify-end"></div>' : ''}
                ${cur.sourceText ? `<details class="rounded-xl border ${cur.docNo ? 'border-slate-200 bg-slate-50' : 'border-indigo-300 bg-indigo-50'} px-3 py-2" ${cur.docNo ? '' : 'open'}>
                    <summary class="cursor-pointer font-black ${cur.docNo ? 'text-slate-600' : 'text-indigo-900'}">📨 ${cur.docNo ? '접수 메시지 원문' : '메시지에서 불러온 내용입니다 — 품목·납기를 확인하고 [요청서 등록]을 누르세요.'}</summary>
                    ${!cur.docNo && cur.dueGuessed ? '<div class="mt-1 font-bold text-rose-700">⚠ 메시지의 납기가 날짜가 아니어서 납기일을 임시로(오늘+7일) 넣었습니다. 고쳐 주세요.</div>' : ''}
                    ${!cur.docNo && (cur.lines || []).some(l => (l.name || l.code) && !l.code) ? '<div class="mt-1 font-bold text-amber-700">⚠ 품목마스터에서 찾지 못한 품목이 있습니다. 품목 칸에서 다시 골라 주세요.</div>' : ''}
                    <pre class="mt-1.5 whitespace-pre-wrap font-sans text-[11px] text-slate-700 bg-white/70 rounded-lg p-2 max-h-48 overflow-y-auto">${esc(cur.sourceText)}</pre>
                </details>` : ''}
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    ${field('요청일', inp('reqDate', 'date'))}
                    ${P ? '' : field('생산 예정일', inp('planDate', 'date'))}
                    ${field(P ? '필요일 (입고 희망) *' : '납기일 *', inp('dueDate', 'date'))}
                    ${field(P ? '입고 거점' : '생산 거점', `<select data-k="site" ${editable ? '' : 'disabled'} class="rq-f mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${PLAN_SITES.map(s => `<option ${s === cur.site ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
                    ${field('긴급', `<label class="mt-1 flex items-center gap-2 border border-slate-300 rounded-lg px-2 py-1.5"><input type="checkbox" data-k="urgent" class="rq-f" ${cur.urgent ? 'checked' : ''} ${editable ? '' : 'disabled'} /><span class="font-bold text-rose-600">긴급 요청</span></label>`)}
                    ${field('요청 부서', inp('dept', 'text', `list="${ensureDeptDatalist()}" placeholder="${P ? '예: 생산공급망팀' : '예: 영업전략팀'}"`))}
                    ${field('요청자', inp('requester'))}
                    ${field('<span class="text-rose-600">담당자 (수신자)</span>', `<select id="rq-assignee" ${editable ? '' : 'disabled'} class="mt-1 w-full border border-rose-300 rounded-lg px-2 py-1.5 font-bold"><option value="">(담당자 없음)</option></select>`)}
                    ${P ? field('용도 (관련 제품·작업)', inp('partner', 'text', 'placeholder="예: 5W-30 4L 포장용"'), 'col-span-2')
                        : type === 'RAW' ? field('이동처 (거점·창고)', `<select data-k="moveTo" ${editable ? '' : 'disabled'} class="rq-f mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"><option value="">(선택)</option>${locationOptionsHtml(state.locations, cur.moveTo || '')}</select>`, 'col-span-2')
                        : field('거래처 (납품처)', inp('partner'), 'col-span-2')}
                    ${field(P ? '구매 사유 / 전달 사항' : '요청 사유 / 전달 사항', `<textarea data-k="reason" rows="2" ${editable ? '' : 'disabled'} class="rq-f mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 disabled:bg-slate-50">${esc(cur.reason || '')}</textarea>`, 'col-span-2 md:col-span-4')}
                </div>
                <div id="rq-lines"></div>
                ${P ? `<div class="text-right text-xs font-bold text-slate-600">예상 금액 (단가 입력분): <span id="rq-amount" class="text-slate-900 font-black">${amountOf(cur) ? `${Math.round(amountOf(cur)).toLocaleString()}원` : '-'}</span></div>` : ''}
                ${cur.docNo ? `
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-2.5 items-end">
                    ${field('처리 상태', `<select id="rq-status-set" ${canManage ? '' : 'disabled'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${Object.keys(REQ_STATUS).map(k => `<option value="${k}" ${k === cur.status ? 'selected' : ''}>${statusText(type, k)}</option>`).join('')}</select>`)}
                    ${field('검토 의견 (접수·반려 사유)', `<input id="rq-review" value="${esc(cur.reviewNote || '')}" ${canManage ? '' : 'disabled'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" />`, 'md:col-span-2')}
                    <p class="md:col-span-3 text-[11px] text-slate-500">${canManage ? `상태를 바꾸고 [저장]을 누르세요. ${P ? '주간 구매계획' : '주간 생산계획'}에서 불러오면 자동으로 '계획반영'이 됩니다.` : '상태 변경은 매니저 이상이 합니다.'}</p>
                </div>` : ''}
            </div>`;
        const columns = P ? [
            { key: 'name', label: '품목 (원료·부자재)', type: 'item', filter: T().itemFilter, onPick: (l, m) => { l.supplier = l.supplier || m.supplier || ''; } },
            { key: 'qty', label: '수량', type: 'number', align: 'right' },
            { key: 'unit', label: '단위', type: 'text', minW: 64 },
            { key: 'supplier', label: '희망 공급처', type: 'text' },
            { key: 'price', label: '예상 단가', type: 'number', align: 'right' },
            { key: 'note', label: '비고', type: 'text' }
        ] : [
            { key: 'name', label: type === 'RAW' ? '원액' : '제품', type: 'item', filter: T().itemFilter },
            { key: 'qty', label: '수량', type: 'number', align: 'right' },
            { key: 'unit', label: '단위', type: 'text', minW: 64 },
            { key: 'pack', label: type === 'RAW' ? '용기·보관 (IBC·탱크 등)' : '포장·용기', type: 'text' },
            { key: 'note', label: '비고', type: 'text' }
        ];
        const renderLines = () => renderLineTable($('#rq-lines'), {
            lines: cur.lines, readOnly: !editable, emptyText: '요청 품목이 없습니다.', columns,
            onChange: () => { setDirty(true); const a = $('#rq-amount'); if (a) a.textContent = amountOf(cur) ? `${Math.round(amountOf(cur)).toLocaleString()}원` : '-'; },
            onRerender: renderLines
        });
        renderLines();
        if (cur.docNo) {
            mountApprovalBox($('#rq-appr'), { key: apprKey(cur), type: T().kind, title: `${T().label} ${cur.docNo}`, date: cur.reqDate || cur.period, roles: apprRoles(type) }, {
                showToast, onChange: (slots) => { apprMap.set(apprKey(cur), slots); renderList(); }
            });
        }
        fillAssigneeSelect($('#rq-assignee'), cur.assigneeId || '', cur.assigneeName || '');
        $('#rq-assignee').addEventListener('change', (e) => { const a = readAssignee(e.target); cur.assigneeId = a?.id || ''; cur.assigneeName = a?.name || ''; setDirty(true); });
        host.querySelectorAll('.rq-f').forEach(el => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => { cur[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; setDirty(true); }));
        $('#rq-status-set')?.addEventListener('change', (e) => { cur.status = e.target.value; setDirty(true); });
        $('#rq-review')?.addEventListener('input', (e) => { cur.reviewNote = e.target.value; setDirty(true); });
        $('#rq-add')?.addEventListener('click', () => { cur.lines.push({ id: newLineId(), code: '', name: '', spec: '', qty: '', unit: T().unit, pack: '', supplier: '', price: '', note: '' }); setDirty(true); renderLines(); });
        $('#rq-go-plan')?.addEventListener('click', () => {
            if (!guard()) return;
            const tab = P ? 'purchPlan' : 'prodPlan';
            window.__pendingPlanOpen = { tab, view: 'week', date: cur.planWeek };
            onSwitchTab(tab);
        });
        $('#rq-save')?.addEventListener('click', async () => {
            if (!cur.dueDate) { alert(`${P ? '필요일' : '납기일'}을 넣으세요.`); return; }
            cur.lines = cur.lines.filter(l => l.code || l.name);
            try {
                const isNew = !cur.docNo;
                const before = isNew ? null : list.find(x => x.id === cur.id);
                const intake = cur.intake;
                delete cur.intake; delete cur.dueGuessed;
                cur = await (isNew ? saveRequest(cur, T()) : savePlan({ ...cur, period: cur.reqDate || cur.period }));
                // 구글 챗 받은함에서 온 메시지면 받은함을 '처리됨'으로
                if (isNew && intake?.kind === 'gchat' && intake.id) markChatInbox(intake.id, 'DONE', [cur.id]).catch(() => {});
                setDirty(false);
                showToast(isNew ? `📨 ${T().label} ${cur.docNo}를 등록했습니다.` : `💾 ${cur.docNo}를 저장했습니다.`);
                notifyAssignee(cur, before);
                month = monthOf(cur.reqDate || cur.period);
                $('#rq-month').value = month;
                await loadList();
                renderEditor();
                createIcons({ icons });
            } catch (e) { alert(e.message); }
        });
        $('#rq-del')?.addEventListener('click', async () => {
            if (!confirm(`${T().label} ${cur.docNo}를 삭제할까요?${cur.status === 'PLANNED' ? '\n(이미 계획에 불러온 줄은 계획에 그대로 남습니다)' : ''}`)) return;
            try { await deletePlan(cur.id); cur = null; setDirty(false); showToast('🗑️ 요청서를 삭제했습니다.'); await loadList(); renderEditor(); } catch (e) { alert(e.message); }
        });
        $('#rq-print')?.addEventListener('click', () => {
            const ls = cur.lines.filter(l => l.code || l.name);
            const amount = amountOf(cur);
            const itemCols = P ? [
                { label: '품목코드', w: 24, get: l => l.code }, { label: '품목명', get: l => l.name }, { label: '규격', w: 20, get: l => l.spec || '' },
                { label: '수량', w: 16, get: l => fmtQty(l.qty), cls: 'r' }, { label: '단위', w: 10, get: l => l.unit || '', cls: 'c' },
                { label: '희망 공급처', w: 24, get: l => l.supplier || '' }, { label: '예상 단가', w: 18, get: l => (l.price ? Number(l.price).toLocaleString() : ''), cls: 'r' },
                { label: '금액', w: 20, get: l => (l.price && l.qty ? Math.round(Number(l.price) * Number(l.qty)).toLocaleString() : ''), cls: 'r' }
            ] : [
                { label: '품목코드', w: 26, get: l => l.code }, { label: type === 'RAW' ? '원액명' : '품목명', get: l => l.name }, { label: '규격', w: 22, get: l => l.spec || '' },
                { label: '수량', w: 18, get: l => fmtQty(l.qty), cls: 'r' }, { label: '단위', w: 10, get: l => l.unit || '', cls: 'c' },
                { label: type === 'RAW' ? '용기·보관' : '포장·용기', w: 24, get: l => l.pack || '' }, { label: '비고', w: 30, get: l => l.note || '' }
            ];
            printA4({
                title: T().printTitle, subtitle: T().sub, approvals: apprRoles(type), approvalKey: apprKey(cur),
                meta: [['요청번호', cur.docNo], ['요청일', cur.reqDate || cur.period], [P ? '필요일' : '납기일', cur.dueDate || ''], [P ? '입고 거점' : '생산 거점', cur.site || ''], ['상태', statusText(type, cur.status)], ...(P && amount ? [['예상 금액', `${Math.round(amount).toLocaleString()}원`]] : [])],
                bodyHtml: `<table class="grid" style="margin-bottom:3mm"><colgroup><col style="width:24mm"><col><col style="width:24mm"><col></colgroup><tbody>
                        <tr><th>요청 부서</th><td>${esc(cur.dept || '')}</td><th>요청자</th><td>${esc(cur.requester || '')}</td></tr>
                        <tr><th>담당자 (수신자)</th><td>${esc(cur.assigneeName || '')}</td><th>${P ? '' : '생산 예정일'}</th><td>${P ? '' : esc(cur.planDate || '')}</td></tr>
                        <tr><th>${P ? '용도' : type === 'RAW' ? '이동처' : '거래처'}</th><td>${esc(type === 'RAW' ? (cur.moveTo ? locationLabel(cur.moveTo) : '') : (cur.partner || ''))}</td><th>긴급</th><td>${cur.urgent ? '<span class="short">긴급</span>' : '일반'}</td></tr>
                        <tr><th>${P ? '구매 사유' : '요청 사유'}</th><td colspan="3" style="height:12mm">${esc(cur.reason || '')}</td></tr></tbody></table>
                    ${printTableHtml(itemCols, ls, { minRows: 10 })}
                    <h2>${P ? '구매 담당 검토 의견' : '생산팀 검토 의견'}</h2><div class="notes">${esc(cur.reviewNote || '')}${cur.planWeek ? `\n계획 반영: ${esc(weekLabel(cur.planWeek))}` : ''}</div>`
            });
        });
        createIcons({ icons });
    };

    container.querySelectorAll('.rq-type').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.t === type || !guard()) return;
        type = b.dataset.t;
        try { localStorage.setItem(VIEW_KEY, type); } catch { }
        cur = null; setDirty(false); paintTypes(); loadList().then(() => { renderEditor(); createIcons({ icons }); });
    }));
    $('#rq-new')?.addEventListener('click', () => { if (!guard()) return; cur = blank(type); setDirty(true); renderList(); renderEditor(); });
    $('#rq-month').addEventListener('change', (e) => { if (!e.target.value) return; month = e.target.value; loadList(); });
    $('#rq-status').addEventListener('change', (e) => { statusFilter = e.target.value; renderList(); });
    paintTypes();
    if (pendingOpen) $('#rq-month').value = month;
    // 메시지 초안 열기: 같은 메시지로 이미 등록한 요청서가 있으면(최근 6개월) 그것을 연다
    const openDraft = async () => {
        const d = pendingDraft.draft;
        try {
            const from = addDays(localDateStr(), -183);
            const dup = d.sourceKey ? (await listPlans(T().kind, from, '9999')).find(r => r.sourceKey === d.sourceKey) : null;
            if (dup) {
                month = monthOf(dup.reqDate || dup.period); $('#rq-month').value = month;
                await loadList();
                cur = JSON.parse(JSON.stringify(dup));
                showToast(`📨 이 메시지로 이미 등록한 ${T().label} ${dup.docNo}를 엽니다.`);
                return;
            }
        } catch { /* 중복 확인 실패 → 새로 작성 */ }
        const b = blank(type);
        cur = { ...b, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '' && v !== undefined && v !== null)), lines: d.lines?.length ? d.lines.map(l => ({ ...l, id: newLineId() })) : b.lines, intake: pendingDraft.source || {} };
        if (!PLAN_SITES.includes(cur.site)) cur.site = b.site;
        cur.dueGuessed = !d.dueDate;
        setDirty(true);
    };
    loadList().then(async () => {
        if (pendingOpen) { const r = list.find(x => x.id === pendingOpen.id); if (r) { cur = JSON.parse(JSON.stringify(r)); renderList(); } }
        if (pendingDraft && canWrite) await openDraft();
        renderList(); renderEditor(); setDirty(dirty); createIcons({ icons });
        if (pendingDraft && !canWrite) showToast('⚠️ 요청서를 작성할 권한이 없습니다 (현장 작업자 이상).');
    });
};

// 생산관리 → 생산요청서 (제품생산요청서 / 원액생산요청서)
export const renderProductionRequest = (container, { showToast, onSwitchTab }) => renderRequests(container, {
    types: ['PRODUCT', 'RAW'], title: '생산요청서', crumb: '생산관리 › 생산요청서', showToast, onSwitchTab,
    desc: '생산할 품목·수량·납기를 생산팀에 요청합니다. <b>제품생산요청서</b>(완제품)와 <b>원액생산요청서</b>(원액)를 따로 씁니다. 생산팀은 주간 생산계획에서 <b>생산요청서 불러오기</b>로 계획에 넣습니다.',
    accent: { text: 'text-amber-600', btn: 'bg-amber-500 hover:bg-amber-600 text-white', border: 'border-amber-400', bgSoft: 'bg-amber-50' }
});

// 생산관리 → 구매요청서
export const renderPurchaseRequest = (container, { showToast, onSwitchTab }) => renderRequests(container, {
    types: ['PURCH'], title: '구매요청서', crumb: '생산관리 › 구매요청서', showToast, onSwitchTab,
    desc: '필요한 원료·부자재의 구매를 요청합니다. 구매 담당은 주간 구매계획에서 <b>구매요청서 불러오기</b>로 구매계획에 넣습니다.',
    accent: { text: 'text-teal-600', btn: 'bg-teal-600 hover:bg-teal-700 text-white', border: 'border-teal-400', bgSoft: 'bg-teal-50' }
});
