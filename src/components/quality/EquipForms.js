// ==========================================
// 품질관리 → 설비관리 → 윤활관리카드 · 제조설비 점검기록부
// ==========================================
// 종이(엑셀) 양식을 그대로 옮긴 화면: 설비마다 양식(점검기준·윤활개소)이 있고, 기록은 기간마다 한 장이다.
//   제조설비 점검기록부(CHECK): 설비 × 달 한 장 — 점검기준 줄 × 1~31일 칸에 기호(○ 정상 · × 교환 · ▽ 수리 · ▼ 수리완료), 날마다 확인자
//   윤활관리카드(LUBE)        : 설비 × 해 한 장 — 윤활개소 줄 × 1~12월 칸에 일자·결과(○ 정상 · × 교환 · ▽ 보충 · □ 시험분석), 달마다 확인자
// 저장: wms_qc_records (supabase/auth/79_equip_forms.sql)
//   양식 kind EQ_TPL  id `EQT:<종류>:<열쇠>`               data = { formType, equipName, manageNo, rows }
//   기록 kind EQ_FORM id `EQF:<종류>:<열쇠>:<기간>`         data = { tplId, period, marks, confirm, actions, note }
//   열쇠 = 양식을 만들 때의 관리번호. 관리번호(manageNo)는 나중에 화면에서 고칠 수 있고, 고쳐도 열쇠(id)는 그대로라
//   이미 적은 기록·결재가 그 양식에 그대로 붙어 있다.
// 설비 이름·점검 항목은 업무 자료라 코드에 넣지 않는다 — DB(로컬 모드는 이 기기)에만 둔다.
import { createIcons, icons } from '../../services/icons.js';
import { esc } from '../../services/html.js';
import { state } from '../../services/db.js';
import { localDateStr } from '../../services/searchUtils.js';
import { listQc, upsertQc, deleteQc, canWriteQc, canConfigQc } from '../../services/quality.js';
import { mountApprovalBox, approvalPrintHtml } from '../approval/ApprovalBox.js';
import { getApproval } from '../../services/approvals.js';
import { btn } from '../plans/planCommon.js';

/** 양식 종류별 설정 */
const FORMS = {
    CHECK: {
        title: '제조설비 점검기록부', periodLabel: '달',
        symbols: ['○', '×', '▽', '▼'],
        legend: [['정상', '○'], ['교환', '×'], ['수리', '▽'], ['수리완료', '▼']],
        actionCols: ['월 일', '문제 발생 개소', '조치사항', '확인'],
        rowFields: [['standard', '점검기준'], ['method', '점검방법'], ['cycle', '주기']]
    },
    LUBE: {
        title: '윤활관리카드', periodLabel: '해',
        symbols: ['○', '×', '▽', '□'],
        legend: [['정상', '○'], ['교환', '×'], ['보충', '▽'], ['시험분석', '□']],
        actionCols: ['월 일', '발생내역', '조치사항', '확인'],
        rowFields: [['spot', '윤활개소'], ['lubricant', '윤활제명'], ['method', '급유방법'], ['refillCycle', '보충 급유주기'], ['refillQty', '보충 급유량'], ['changeCycle', '교환 급유주기'], ['changeQty', '교환 급유량'], ['checkCycle', '점검주기']]
    }
};
const APPR_ROLES = ['작성', '검토1', '검토2', '확인'];
const apprLabel = (role) => role.replace(/\d+$/, '');
const tplIdOf = (type, manageNo) => `EQT:${type}:${manageNo}`;
/** 양식의 열쇠 (id에서 종류 뒤 부분 — 만들 때의 관리번호). 기록 id는 관리번호가 아니라 이 열쇠로 만든다 */
const tplKeyOf = (type, tpl) => String(tpl.id).slice(`EQT:${type}:`.length);
const recIdOf = (type, tpl, period) => `EQF:${type}:${tplKeyOf(type, tpl)}:${period}`;
const daysIn = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
const shiftMonth = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const myName = () => String(state.currentGlobalWorker || state.currentUser?.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();

/**
 * @param {HTMLElement} host
 * @param {{ type: 'CHECK' | 'LUBE', showToast?: (message: string) => void }} opts
 */
export const mountEquipForms = async (host, { type, showToast = () => {} }) => {
    const F = FORMS[type];
    const canWrite = canWriteQc();
    const canConfig = canConfigQc();
    const prefKey = `daelim_equip_form_${type}`;
    let templates = [];
    let records = [];
    let tplId = '';
    let period = type === 'CHECK' ? localDateStr().slice(0, 7) : localDateStr().slice(0, 4);
    /** 지금 고치는 기록 */
    let rec = null;
    let isDirty = false;

    const tpl = () => templates.find(t => t.id === tplId) || null;
    const emptyRec = (t) => ({ id: recIdOf(type, t, period), tplId: t.id, formType: type, period, equipName: t.equipName, manageNo: t.manageNo, marks: {}, confirm: {}, actions: [], note: '' });
    const pickRec = () => {
        const t = tpl();
        if (!t) { rec = null; return; }
        const found = records.find(r => r.id === recIdOf(type, t, period));
        rec = found ? JSON.parse(JSON.stringify({ marks: {}, confirm: {}, actions: [], note: '', ...found })) : emptyRec(t);
        isDirty = false;
    };
    const periodText = () => (type === 'CHECK' ? `${period.slice(0, 4)}년 ${Number(period.slice(5, 7))}월` : `${period}년`);
    const cols = () => (type === 'CHECK' ? Array.from({ length: daysIn(period) }, (_, i) => i + 1) : Array.from({ length: 12 }, (_, i) => i + 1));

    // ---------- 표 ----------
    const cellBtn = (attrs, text, extra = '') => `<button type="button" ${attrs} class="ef-cell w-full h-7 min-w-[22px] text-sm font-black leading-none hover:bg-emerald-50 ${extra}" ${canWrite ? '' : 'disabled'}>${esc(text || '')}</button>`;
    const symClass = (sym) => (sym === '×' ? 'text-rose-600' : sym === '▽' || sym === '▼' || sym === '□' ? 'text-amber-600' : 'text-slate-800');
    const checkTableHtml = (t) => `
        <table class="ef-table w-full text-[11px] border-collapse">
            <thead><tr class="bg-slate-50 text-slate-600">
                <th class="ef-b px-2 py-1 text-left min-w-[170px]" rowspan="2">점검기준</th><th class="ef-b px-1 py-1 min-w-[70px]" rowspan="2">점검방법</th><th class="ef-b px-1 py-1 min-w-[52px]" rowspan="2">주기</th>
                <th class="ef-b px-1 py-1" colspan="${cols().length}">일 정</th></tr>
                <tr class="bg-slate-50 text-slate-600">${cols().map(d => `<th class="ef-b w-[26px] font-bold">${d}</th>`).join('')}</tr></thead>
            <tbody>${t.rows.map((row, i) => `<tr>
                <td class="ef-b px-2 py-0.5 font-bold text-slate-800">${esc(row.standard)}</td><td class="ef-b px-1 text-center">${esc(row.method)}</td><td class="ef-b px-1 text-center">${esc(row.cycle)}</td>
                ${cols().map(d => { const sym = rec.marks?.[i]?.[d] || ''; return `<td class="ef-b p-0 text-center">${cellBtn(`data-mark="${i}" data-col="${d}"`, sym, symClass(sym))}</td>`; }).join('')}</tr>`).join('')}
                <tr class="bg-slate-50/60"><td class="ef-b px-2 py-0.5 text-right font-bold text-slate-600" colspan="3">확인</td>
                ${cols().map(d => `<td class="ef-b p-0 text-center">${cellBtn(`data-confirm="${d}"`, rec.confirm?.[d] ? '✓' : '', 'text-emerald-700')}</td>`).join('')}</tr>
            </tbody></table>`;
    const lubeTableHtml = (t) => `
        <table class="ef-table w-full text-[11px] border-collapse">
            <thead><tr class="bg-slate-50 text-slate-600">
                <th class="ef-b px-2 py-1 min-w-[80px]">윤활개소</th><th class="ef-b px-1 py-1 min-w-[110px]">윤활제명<br>급유방법</th><th class="ef-b px-1 py-1">종류</th><th class="ef-b px-1 py-1 min-w-[70px]">급유주기</th><th class="ef-b px-1 py-1 min-w-[56px]">급유량</th><th class="ef-b px-1 py-1 min-w-[48px]">점검<br>주기</th><th class="ef-b px-1 py-1">일정</th>
                ${cols().map(m => `<th class="ef-b min-w-[52px] font-bold">${m}</th>`).join('')}</tr></thead>
            <tbody>${t.rows.map((row, i) => `
                <tr><td class="ef-b px-2 font-bold text-slate-800 text-center" rowspan="2">${esc(row.spot)}</td><td class="ef-b px-1 text-center">${esc(row.lubricant)}</td><td class="ef-b px-1 text-center">보충</td><td class="ef-b px-1 text-center">${esc(row.refillCycle)}</td><td class="ef-b px-1 text-center">${esc(row.refillQty)}</td>
                    <td class="ef-b px-1 text-center" rowspan="2">${esc(row.checkCycle)}</td><td class="ef-b px-1 text-center text-slate-500">일자</td>
                    ${cols().map(m => `<td class="ef-b p-0"><input data-lube-date="${i}" data-col="${m}" value="${esc(rec.marks?.[i]?.[m]?.date || '')}" placeholder="" maxlength="5" class="tap-compact w-full h-7 text-center text-[11px] bg-transparent focus:bg-emerald-50 outline-none" ${canWrite ? '' : 'disabled'} /></td>`).join('')}</tr>
                <tr><td class="ef-b px-1 text-center">${esc(row.method)}</td><td class="ef-b px-1 text-center">교환</td><td class="ef-b px-1 text-center">${esc(row.changeCycle)}</td><td class="ef-b px-1 text-center">${esc(row.changeQty)}</td><td class="ef-b px-1 text-center text-slate-500">결과</td>
                    ${cols().map(m => { const sym = rec.marks?.[i]?.[m]?.result || ''; return `<td class="ef-b p-0 text-center">${cellBtn(`data-lube-result="${i}" data-col="${m}"`, sym, symClass(sym))}</td>`; }).join('')}</tr>`).join('')}
                <tr class="bg-slate-50/60"><td class="ef-b px-2 py-0.5 text-right font-bold text-slate-600" colspan="7">확인</td>
                ${cols().map(m => `<td class="ef-b p-0 text-center">${cellBtn(`data-confirm="${m}"`, rec.confirm?.[m] ? '✓' : '', 'text-emerald-700')}</td>`).join('')}</tr>
            </tbody></table>`;

    const actionsHtml = () => `
        <table class="w-full text-[11px] border-collapse"><thead><tr class="bg-slate-50 text-slate-600">${F.actionCols.map(c => `<th class="ef-b px-1 py-1">${c}</th>`).join('')}${canWrite ? '<th class="ef-b w-8"></th>' : ''}</tr></thead>
            <tbody>${(rec.actions || []).map((a, i) => `<tr>
                ${['date', 'where', 'action', 'confirm'].map((k, j) => `<td class="ef-b p-0"><input data-act-i="${i}" data-act-k="${k}" value="${esc(a[k] || '')}" ${j === 0 ? 'placeholder="10/02" maxlength="5"' : ''} class="tap-compact w-full h-7 px-1.5 text-[11px] bg-transparent focus:bg-emerald-50 outline-none ${j === 0 || j === 3 ? 'text-center' : ''}" ${canWrite ? '' : 'disabled'} /></td>`).join('')}
                ${canWrite ? `<td class="ef-b text-center"><button type="button" data-act-del="${i}" class="text-slate-400 hover:text-rose-600 font-black" title="이 줄 지우기">−</button></td>` : ''}</tr>`).join('') || `<tr><td class="ef-b p-2 text-center text-slate-400" colspan="5">조치사항이 없습니다.</td></tr>`}
            </tbody></table>
        ${canWrite ? '<button type="button" id="ef-act-add" class="mt-1 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-bold text-slate-600">＋ 조치사항 줄 추가</button>' : ''}`;

    const render = () => {
        const t = tpl();
        host.innerHTML = `
        <style>.ef-b{border:1px solid #cbd5e1}.ef-cell:disabled{cursor:default}</style>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <label class="inline-flex items-center gap-1.5 font-bold text-slate-600">설비
                    <select id="ef-tpl" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold max-w-[280px]">${templates.map(x => `<option value="${esc(x.id)}" ${x.id === tplId ? 'selected' : ''}>${esc(x.manageNo)} · ${esc(x.equipName)}</option>`).join('') || '<option value="">(등록된 양식 없음)</option>'}</select></label>
                <span class="inline-flex items-center gap-1">
                    <button type="button" id="ef-prev" class="min-w-[36px] h-[34px] rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-black" title="이전 ${F.periodLabel}">‹</button>
                    <b class="px-2 text-sm text-slate-900 whitespace-nowrap">${periodText()}</b>
                    <button type="button" id="ef-next" class="min-w-[36px] h-[34px] rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-black" title="다음 ${F.periodLabel}">›</button>
                </span>
                <span class="ml-auto flex flex-wrap items-center gap-2">
                    <span id="ef-dirty" class="font-bold ${isDirty ? 'text-amber-700' : 'text-slate-400'}">${isDirty ? '저장하지 않은 변경 있음' : ''}</span>
                    ${canConfig ? `<button type="button" id="ef-tpl-new" class="${btn()}"><i data-lucide="plus" class="w-4 h-4"></i>설비 양식 추가</button>${t ? `<button type="button" id="ef-tpl-edit" class="${btn()}"><i data-lucide="pencil" class="w-4 h-4"></i>양식 고치기</button>` : ''}` : ''}
                    ${t ? `<button type="button" id="ef-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>인쇄</button>` : ''}
                    ${t && canWrite ? `<button type="button" id="ef-save" class="${btn('bg-blue-600 hover:bg-blue-700 text-white')}"><i data-lucide="save" class="w-4 h-4"></i>저장</button>` : ''}
                </span>
            </div>
            ${!t ? `<div class="p-10 text-center text-xs text-slate-400">등록된 ${F.title} 양식이 없습니다.${canConfig ? ' <b>설비 양식 추가</b>로 설비와 항목을 등록하세요.' : ''}</div>` : `
            <div class="flex flex-wrap items-end justify-between gap-3 border border-slate-200 rounded-xl p-3">
                <div class="text-xs space-y-1">
                    <div><span class="inline-block w-20 font-bold text-slate-500">설 비 명</span><b class="text-slate-900">${esc(t.equipName)}</b></div>
                    <div><span class="inline-block w-20 font-bold text-slate-500">관리번호</span><b class="font-mono text-slate-900">${esc(t.manageNo)}</b></div>
                </div>
                <h3 class="text-base font-black text-slate-900 tracking-widest">${type === 'CHECK' ? `( ${Number(period.slice(5, 7))} )월 제조설비 점검기록부` : '윤 활 관 리 카 드'}</h3>
                <div id="ef-appr"></div>
            </div>
            <div class="overflow-x-auto">${type === 'CHECK' ? checkTableHtml(t) : lubeTableHtml(t)}</div>
            <p class="text-[11px] text-slate-500">${type === 'CHECK' ? '칸을 누를 때마다 ○ → × → ▽ → ▼ → 빈칸 순으로 바뀝니다. <b>확인</b> 줄은 그날 확인한 사람(내 이름)을 남깁니다.' : '<b>일자</b> 칸에는 급유·점검한 날(예: 10/02)을 적고, <b>결과</b> 칸은 누를 때마다 ○ → × → ▽ → □ → 빈칸 순으로 바뀝니다.'}
                ${canWrite && type === 'CHECK' ? '<button type="button" id="ef-today" class="ml-1 px-2 py-0.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 font-bold">오늘 칸 모두 ○</button>' : ''}</p>
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div class="lg:col-span-2"><table class="w-full text-[11px] border-collapse"><thead><tr class="bg-slate-50 text-slate-600"><th class="ef-b px-1 py-1" colspan="2">범 례</th></tr><tr class="bg-slate-50 text-slate-600"><th class="ef-b px-1 py-1">내용</th><th class="ef-b px-1 py-1">기호</th></tr></thead>
                    <tbody>${F.legend.map(([l, sym]) => `<tr><td class="ef-b px-2 py-1 text-center">${l}</td><td class="ef-b px-2 py-1 text-center font-black ${symClass(sym)}">${sym}</td></tr>`).join('')}</tbody></table></div>
                <div class="lg:col-span-6"><div class="text-[11px] font-black text-slate-700 mb-1">조치사항</div>${actionsHtml()}</div>
                <div class="lg:col-span-4"><div class="text-[11px] font-black text-slate-700 mb-1">※ 특기사항</div>
                    <textarea id="ef-note" rows="5" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs" ${canWrite ? '' : 'disabled'}>${esc(rec.note || '')}</textarea></div>
            </div>`}
        </div>`;
        createIcons({ icons });
        if (t) {
            const saved = records.some(r => r.id === rec.id);
            mountApprovalBox(host.querySelector('#ef-appr'), { key: saved ? `EQFORM:${rec.id}` : '', type: 'EQUIP_FORM', title: `${F.title} ${t.equipName} ${periodText()}`, date: type === 'CHECK' ? `${period}-01` : `${period}-01-01`, roles: APPR_ROLES, labelOf: apprLabel }, { showToast });
        }
    };

    const touch = () => { isDirty = true; const el = host.querySelector('#ef-dirty'); if (el) { el.textContent = '저장하지 않은 변경 있음'; el.className = 'font-bold text-amber-700'; } };
    const confirmLeave = () => !isDirty || confirm('저장하지 않은 변경이 있습니다. 버리고 계속할까요?');
    const cycle = (cur) => { const list = ['', ...F.symbols]; return list[(list.indexOf(cur || '') + 1) % list.length]; };

    const save = async () => {
        const t = tpl();
        if (!t || !rec) return;
        try {
            const saved = await upsertQc('EQ_FORM', { ...rec, equipName: t.equipName, manageNo: t.manageNo, date: type === 'CHECK' ? `${period}-01` : `${period}-01-01` });
            records = [saved, ...records.filter(r => r.id !== saved.id)];
            pickRec();
            showToast(`💾 ${t.equipName} ${periodText()} ${F.title}를 저장했습니다.`);
            render();
        } catch (e) { alert(e.message); }
    };

    // ---------- 인쇄 (가로 A4 한 장을 꽉 채움, 종이 양식 그대로) ----------
    // 종이 한 장(여백 10mm 뺀 277 × 190mm)을 머리(설비명·제목·결재) / 본표 / 아래(범례·조치사항·특기사항) 세 단으로 나누고,
    // 본표가 남는 높이를 모두 차지해 줄 높이가 고르게 늘어난다. 항목이 적은 설비는 빈 줄을 더해 줄이 지나치게 높아지지 않게 하고,
    // 항목이 많아 한 장을 넘으면 전체를 줄여 한 장에 맞춘다(아래 fitScript).
    const PRINT_PAGE_H_MM = 189; // 190mm에서 1mm 여유 (반올림으로 둘째 장이 생기지 않게)
    const PRINT_MIN_ROWS = { CHECK: 10, LUBE: 5 }; // 본표의 최소 줄 수 (윤활관리카드는 윤활개소 수 — 개소마다 두 줄)
    const PRINT_MIN_ACTIONS = 4;
    const print = async () => {
        const t = tpl();
        const win = window.open('', '_blank');
        if (!win) { alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
        const slots = records.some(r => r.id === rec.id) ? await getApproval(`EQFORM:${rec.id}`).catch(() => ({})) : {};
        const b = 'border:0.25mm solid #333;';
        const th = (text, extra = '', attrs = '') => `<th ${attrs} style="${b}background:#eef1f5;padding:0.8mm;${extra}">${text}</th>`;
        const td = (text, extra = '', attrs = '') => `<td ${attrs} style="${b}padding:0.6mm 0.8mm;${extra}">${text}</td>`;
        const blankCount = Math.max(0, PRINT_MIN_ROWS[type] - t.rows.length);
        const mark = 'text-align:center;font-weight:700;font-size:10pt';
        const checkBlankRow = `<tr>${td('')}${td('')}${td('')}${cols().map(() => td('')).join('')}</tr>`;
        const lubeBlankRows = `<tr><td rowspan="2" style="${b}"></td>${td('')}${td('보충', 'text-align:center')}${td('')}${td('')}<td rowspan="2" style="${b}"></td>${td('일자', 'text-align:center')}${cols().map(() => td('')).join('')}</tr>
            <tr>${td('')}${td('교환', 'text-align:center')}${td('')}${td('')}${td('결과', 'text-align:center')}${cols().map(() => td('')).join('')}</tr>`;
        const body = type === 'CHECK'
            ? `<table class="main"><thead><tr>${th('점검기준', 'width:52mm')}${th('점검방법', 'width:20mm')}${th('주기', 'width:15mm')}${cols().map(d => th(d)).join('')}</tr></thead><tbody>
                ${t.rows.map((row, i) => `<tr>${td(esc(row.standard), 'font-weight:700')}${td(esc(row.method), 'text-align:center')}${td(esc(row.cycle), 'text-align:center')}${cols().map(d => td(esc(rec.marks?.[i]?.[d] || ''), mark)).join('')}</tr>`).join('')}
                ${checkBlankRow.repeat(blankCount)}
                <tr>${td('확인', 'text-align:right;font-weight:700', 'colspan="3"')}${cols().map(d => td(esc((rec.confirm?.[d] || '').slice(0, 1)), 'text-align:center;font-size:7pt')).join('')}</tr></tbody></table>`
            : `<table class="main"><thead><tr>${th('윤활개소', 'width:24mm')}${th('윤활제명<br>급유방법', 'width:32mm')}${th('종류', 'width:11mm')}${th('급유주기', 'width:20mm')}${th('급유량', 'width:15mm')}${th('점검<br>주기', 'width:13mm')}${th('일정', 'width:11mm')}${cols().map(m => th(m)).join('')}</tr></thead><tbody>
                ${t.rows.map((row, i) => `<tr><td rowspan="2" style="${b}text-align:center;font-weight:700">${esc(row.spot)}</td>${td(esc(row.lubricant), 'text-align:center')}${td('보충', 'text-align:center')}${td(esc(row.refillCycle), 'text-align:center')}${td(esc(row.refillQty), 'text-align:center')}<td rowspan="2" style="${b}text-align:center">${esc(row.checkCycle)}</td>${td('일자', 'text-align:center')}${cols().map(m => td(esc(rec.marks?.[i]?.[m]?.date || ''), 'text-align:center')).join('')}</tr>
                    <tr>${td(esc(row.method), 'text-align:center')}${td('교환', 'text-align:center')}${td(esc(row.changeCycle), 'text-align:center')}${td(esc(row.changeQty), 'text-align:center')}${td('결과', 'text-align:center')}${cols().map(m => td(esc(rec.marks?.[i]?.[m]?.result || ''), mark)).join('')}</tr>`).join('')}
                ${lubeBlankRows.repeat(blankCount)}
                <tr>${td('확인', 'text-align:right;font-weight:700', 'colspan="7"')}${cols().map(m => td(esc(rec.confirm?.[m] || ''), 'text-align:center;font-size:7.5pt')).join('')}</tr></tbody></table>`;
        const actions = [...(rec.actions || []), ...Array.from({ length: Math.max(0, PRINT_MIN_ACTIONS - (rec.actions || []).length) }, () => ({}))];
        // 내용이 한 장보다 길면(항목이 아주 많은 설비) 전체를 줄여 한 장에 맞춘 뒤 인쇄 창을 연다
        // (줄인 만큼 종이 폭이 남으므로 폭을 넓혀 다시 재고, 그래도 넘치면 조금씩 더 줄인다)
        const fitScript = `window.onload = () => setTimeout(() => {
            const sheet = document.querySelector('.sheet');
            const pageH = sheet.clientHeight;
            if (sheet.scrollHeight > pageH + 2) {
                sheet.style.height = 'auto';
                sheet.style.overflow = 'visible';
                let zoom = Math.max(0.4, pageH / sheet.offsetHeight);
                for (let i = 0; i < 8; i++) {
                    sheet.style.zoom = String(zoom);
                    sheet.style.width = (277 / zoom) + 'mm';
                    if (sheet.getBoundingClientRect().height <= pageH || zoom <= 0.4) break;
                    zoom = Math.max(0.4, zoom * 0.97);
                }
            }
            window.print();
        }, 300);`;
        // 본표의 줄 높이를 고르게: 머리 줄 + 항목 줄(빈 줄 포함) + 확인 줄이 본표 높이를 똑같이 나눠 갖는다
        const mainRowCount = 2 + (t.rows.length + blankCount) * (type === 'LUBE' ? 2 : 1);
        win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(F.title)} ${esc(t.equipName)} ${esc(periodText())}</title>
            <style>
                @page{size:A4 landscape;margin:10mm}
                *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
                html,body{margin:0;padding:0}
                body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:9pt;color:#111}
                table{border-collapse:collapse;width:100%}
                h1{font-size:16pt;letter-spacing:0.2em;margin:0;text-align:center;white-space:nowrap}
                .sheet{width:277mm;height:${PRINT_PAGE_H_MM}mm;display:flex;flex-direction:column;gap:3mm;overflow:hidden}
                .head{display:flex;align-items:flex-end;justify-content:space-between;gap:6mm;flex:none}
                .body{flex:1 1 auto;min-height:0}
                .main{height:100%;table-layout:fixed}
                .main tr{height:${(100 / mainRowCount).toFixed(3)}%}
                .main td,.main th{overflow:hidden;word-break:keep-all;overflow-wrap:anywhere}
                .foot{display:flex;gap:4mm;align-items:flex-start;flex:none}
                .foot th{height:6mm}
                .foot td{height:8mm}
            </style></head><body>
            <div class="sheet">
                <div class="head">
                    <table style="width:78mm"><tr>${th('설 비 명', 'width:22mm;height:8mm')}${td(esc(t.equipName), 'font-weight:700')}</tr><tr>${th('관 리 번 호', 'height:8mm')}${td(esc(t.manageNo), 'font-weight:700')}</tr></table>
                    <h1>${type === 'CHECK' ? `( ${Number(period.slice(5, 7))} )월 제조설비 점검기록부` : '윤 활 관 리 카 드'}<div style="font-size:9pt;letter-spacing:0;font-weight:400;margin-top:1mm">${esc(periodText())}</div></h1>
                    <div>${approvalPrintHtml(APPR_ROLES, slots, { title: '확인', labelOf: apprLabel, cellW: 17, cellH: 14 })}</div>
                </div>
                <div class="body">${body}</div>
                <div class="foot">
                    <table style="width:36mm"><tr>${th('범 례', '', 'colspan="2"')}</tr><tr>${th('내용')}${th('기호')}</tr>${F.legend.map(([l, sym]) => `<tr>${td(l, 'text-align:center')}${td(sym, 'text-align:center;font-weight:700;font-size:10pt')}</tr>`).join('')}</table>
                    <table style="flex:1"><tr>${th('조치사항', '', 'colspan="4"')}</tr><tr>${F.actionCols.map((c, i) => th(c, i === 0 || i === 3 ? 'width:20mm' : '')).join('')}</tr>
                        ${actions.map(a => `<tr>${td(esc(a.date || ''), 'text-align:center')}${td(esc(a.where || ''))}${td(esc(a.action || ''))}${td(esc(a.confirm || ''), 'text-align:center')}</tr>`).join('')}</table>
                    <table style="width:82mm"><tr>${th('※ 특기사항')}</tr><tr><td style="${b}padding:1mm;height:${6 + PRINT_MIN_ACTIONS * 8}mm;vertical-align:top;white-space:pre-wrap">${esc(rec.note || '')}</td></tr></table>
                </div>
            </div>
            <script>${fitScript}<\/script></body></html>`);
        win.document.close();
    };

    // ---------- 양식 고치기 (매니저 이상) ----------
    const openTplEditor = (orig) => {
        const box = document.createElement('div');
        box.className = 'fixed inset-0 z-[70] bg-slate-900/60 p-3 overflow-y-auto flex items-start justify-center';
        const lines = (orig?.rows || []).map(row => F.rowFields.map(([k]) => row[k] || '').join(' | ')).join('\n');
        box.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-6 text-xs overflow-hidden">
            <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between"><h3 class="font-black text-sm">${esc(F.title)} 양식 ${orig ? '고치기' : '추가'}</h3><button type="button" data-close class="text-slate-300 hover:text-white text-xl px-1">&times;</button></div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 gap-2">
                    <label class="block"><span class="font-bold text-slate-600">설비명</span><input id="et-name" value="${esc(orig?.equipName || '')}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                    <label class="block"><span class="font-bold text-slate-600">관리번호</span><input id="et-no" value="${esc(orig?.manageNo || '')}" placeholder="예: M-01-001" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-mono font-bold" /></label>
                </div>
                <label class="block"><span class="font-bold text-slate-600">항목 — 한 줄에 하나, 칸은 <b>|</b> 로 나눕니다</span>
                    <div class="text-[11px] text-slate-500 mt-0.5">${F.rowFields.map(([, l]) => l).join(' | ')}</div>
                    <textarea id="et-rows" rows="12" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-mono text-[11px] leading-relaxed">${esc(lines)}</textarea></label>
                <div class="flex justify-between gap-2">
                    ${orig ? '<button type="button" id="et-del" class="px-3 py-2 rounded-lg border border-rose-300 text-rose-700 font-bold">양식 지우기</button>' : '<span></span>'}
                    <span class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg border border-slate-300 bg-white font-bold">취소</button><button type="button" id="et-save" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black">저장</button></span>
                </div>
            </div></div>`;
        document.body.appendChild(box);
        const close = () => box.remove();
        box.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
        box.querySelector('#et-save').addEventListener('click', async () => {
            const equipName = box.querySelector('#et-name').value.trim();
            const manageNo = box.querySelector('#et-no').value.trim();
            if (!equipName || !manageNo) { alert('설비명과 관리번호를 적으세요.'); return; }
            // 관리번호는 고칠 수 있다 — 다른 양식이 쓰는 번호(지금 번호나 만들 때의 번호)와 겹치지만 않으면 된다
            const newId = orig?.id || tplIdOf(type, manageNo);
            if (templates.some(x => x.id !== newId && (x.manageNo === manageNo || x.id === tplIdOf(type, manageNo)))) { alert('같은 관리번호의 양식이 이미 있습니다.'); return; }
            const rows = box.querySelector('#et-rows').value.split('\n').map(line => line.split('|').map(v => v.trim())).filter(parts => parts[0])
                .map(parts => Object.fromEntries(F.rowFields.map(([k], i) => [k, parts[i] || ''])));
            if (!rows.length) { alert('항목을 한 줄 이상 적으세요.'); return; }
            try {
                const saved = await upsertQc('EQ_TPL', { ...(orig || {}), id: newId, formType: type, equipName, manageNo, rows });
                templates = [...templates.filter(x => x.id !== saved.id), saved].sort((a, b) => String(a.manageNo).localeCompare(String(b.manageNo)));
                tplId = saved.id;
                close(); pickRec(); render();
                showToast(`💾 ${equipName} 양식을 저장했습니다.`);
            } catch (e) { alert(e.message); }
        });
        box.querySelector('#et-del')?.addEventListener('click', async () => {
            if (!confirm(`${orig.equipName} 양식을 지울까요?\n이미 적은 기록은 남지만 이 화면에서 볼 수 없게 됩니다.`)) return;
            try { await deleteQc(orig.id); templates = templates.filter(x => x.id !== orig.id); tplId = templates[0]?.id || ''; close(); pickRec(); render(); } catch (e) { alert(e.message); }
        });
    };

    // ---------- 이벤트 (host에 한 번만) ----------
    host.addEventListener('click', (e) => {
        const el = e.target.closest('button');
        if (!el) return;
        if (el.id === 'ef-prev' || el.id === 'ef-next') {
            if (!confirmLeave()) return;
            const n = el.id === 'ef-prev' ? -1 : 1;
            period = type === 'CHECK' ? shiftMonth(period, n) : String(Number(period) + n);
            pickRec(); render(); return;
        }
        if (el.id === 'ef-save') { save(); return; }
        if (el.id === 'ef-print') { print(); return; }
        if (el.id === 'ef-tpl-new') { openTplEditor(null); return; }
        if (el.id === 'ef-tpl-edit') { openTplEditor(tpl()); return; }
        if (!canWrite || !rec) return;
        if (el.id === 'ef-act-add') { rec.actions = [...(rec.actions || []), { date: '', where: '', action: '', confirm: '' }]; touch(); render(); isDirty = true; return; }
        if (el.dataset.actDel) { rec.actions.splice(Number(el.dataset.actDel), 1); render(); touch(); return; }
        if (el.id === 'ef-today') {
            const day = localDateStr().slice(0, 7) === period ? Number(localDateStr().slice(8, 10)) : 0;
            if (!day) { alert('이번 달 기록부에서만 쓸 수 있습니다.'); return; }
            tpl().rows.forEach((_, i) => { rec.marks[i] = { ...(rec.marks[i] || {}), [day]: rec.marks[i]?.[day] || '○' }; });
            rec.confirm[day] = rec.confirm[day] || myName() || '확인';
            render(); touch(); return;
        }
        const col = el.dataset.col;
        if (el.dataset.mark !== undefined) {
            const i = el.dataset.mark;
            const next = cycle(rec.marks[i]?.[col]);
            rec.marks[i] = { ...(rec.marks[i] || {}) };
            if (next) rec.marks[i][col] = next; else delete rec.marks[i][col];
            el.textContent = next; el.className = el.className.replace(/text-(rose|amber|slate)-\d+/g, '') + ` ${symClass(next)}`;
            touch(); return;
        }
        if (el.dataset.lubeResult !== undefined) {
            const i = el.dataset.lubeResult;
            const cur = rec.marks[i]?.[col] || {};
            const next = cycle(cur.result);
            rec.marks[i] = { ...(rec.marks[i] || {}), [col]: { ...cur, result: next } };
            el.textContent = next; el.className = el.className.replace(/text-(rose|amber|slate)-\d+/g, '') + ` ${symClass(next)}`;
            touch(); return;
        }
        if (el.dataset.confirm !== undefined) {
            const key = el.dataset.confirm;
            if (rec.confirm[key]) delete rec.confirm[key]; else rec.confirm[key] = myName() || '확인';
            el.textContent = rec.confirm[key] ? '✓' : ''; el.title = rec.confirm[key] || '';
            touch();
        }
    });
    host.addEventListener('input', (e) => {
        const el = e.target;
        if (!rec) return;
        if (el.id === 'ef-note') { rec.note = el.value; touch(); return; }
        if (el.dataset.lubeDate !== undefined) { const i = el.dataset.lubeDate; const col = el.dataset.col; rec.marks[i] = { ...(rec.marks[i] || {}), [col]: { ...(rec.marks[i]?.[col] || {}), date: el.value.trim() } }; touch(); return; }
        if (el.dataset.actI !== undefined) { rec.actions[Number(el.dataset.actI)][el.dataset.actK] = el.value; touch(); }
    });
    host.addEventListener('change', (e) => {
        if (e.target.id !== 'ef-tpl') return;
        if (!confirmLeave()) { e.target.value = tplId; return; }
        tplId = e.target.value;
        try { localStorage.setItem(prefKey, tplId); } catch (err) { console.warn('[설비 양식] 고른 설비를 기억하지 못했습니다', err); }
        pickRec(); render();
    });

    host.innerHTML = '<div class="p-10 text-center text-xs text-slate-400">불러오는 중…</div>';
    try {
        const [tpls, recs] = await Promise.all([listQc('EQ_TPL'), listQc('EQ_FORM')]);
        templates = tpls.filter(t => t.formType === type).sort((a, b) => String(a.manageNo).localeCompare(String(b.manageNo)));
        records = recs.filter(r => r.formType === type);
    } catch (e) {
        host.innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-xs font-bold text-rose-700">${esc(e.message)}</div>`;
        return;
    }
    const remembered = localStorage.getItem(prefKey);
    tplId = templates.some(t => t.id === remembered) ? remembered : (templates[0]?.id || '');
    pickRec();
    render();
};
