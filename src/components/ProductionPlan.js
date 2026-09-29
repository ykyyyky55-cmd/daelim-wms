import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { localDateStr } from '../services/searchUtils.js';
import {
    weekStart, weekDays, weekLabel, addDays, dowOf, md, monthOf, monthWeeks, loadWeek, savePlan, deletePlan, getPlan,
    loadMonthLines, listPlans, planId, newLineId, round3, monthDays, saveMonthLines, carryable, carryRemain, carryOverLines, shiftNextWeek, shiftNextMonth, PROD_LINE_STATUS, SOURCE_LABEL, REQ_STATUS, PLAN_SITES
} from '../services/plans.js';
import { listProdDates, listProdSchedule, PROD_STATUS } from '../services/prodSchedule.js';
import { renderLineTable, printA4, buildA4Html, printTableHtml, btn, fmtQty, siteOptions } from './plans/planCommon.js';
import { renderDayTasks, getDayEntry, cleanDayTasks, tasksPrintHtml, syncLineTasks } from './plans/dayTasks.js';
import { autoReflectOpen } from '../services/planAuto.js';
import { renderShortagePanel } from './plans/shortagePanel.js';
import { renderSafetyPanel } from './plans/safetyPanel.js';
import { mountApprovalBox } from './approval/ApprovalBox.js';

// 생산관리 → 생산계획: 월간(주간 취합) · 주간(일자별 줄) · 일일(주간 줄을 날짜로)
const VIEW_KEY = 'daelim_prodplan_view';
const TYPES = [['완제품', '완제품'], ['원액', '원액']];
const statusOpts = Object.entries(PROD_LINE_STATUS);
const sourceBadge = (l, schedMap) => {
    const s = l.source || 'MANUAL';
    const cls = { SCHED: 'bg-indigo-50 text-indigo-700 border-indigo-200', REQ: 'bg-amber-50 text-amber-800 border-amber-200', SHORT: 'bg-rose-50 text-rose-700 border-rose-200', CAL: 'bg-sky-50 text-sky-700 border-sky-200', SAFETY: 'bg-yellow-50 text-yellow-800 border-yellow-300' }[s] || 'bg-slate-50 text-slate-500 border-slate-200';
    const sched = s === 'SCHED' && schedMap?.get(l.ref);
    return `<span class="inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap ${cls}">${esc(SOURCE_LABEL[s] || s)}</span>${sched ? `<div class="text-[10px] text-slate-500 mt-0.5 whitespace-nowrap">${esc(PROD_STATUS[sched.status]?.label || sched.status)}</div>` : ''}${l.refNo ? `<div class="text-[10px] font-mono text-slate-500">${esc(l.refNo)}</div>` : ''}`;
};
const sortLines = (lines) => lines.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.site).localeCompare(String(b.site)) || String(a.type).localeCompare(String(b.type)));
const unitOf = (l) => l.unit || (l.type === '원액' ? 'L' : 'EA');

export const renderProductionPlan = (container, { showToast, onSwitchTab }) => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); } catch { }
    const pending = window.__pendingPlanOpen?.tab === 'prodPlan' ? window.__pendingPlanOpen : null;
    window.__pendingPlanOpen = null;
    let view = pending?.view || saved.view || 'week';
    let day = pending?.date || localDateStr();
    let monday = weekStart(day);
    let ym = monthOf(day);
    let site = pending?.site ?? saved.site ?? '';
    let dirty = false;
    let doc = null;
    const canEdit = canPerformAction('MRP_PLANNING');
    const persist = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view, site })); } catch { } };
    const guard = () => !dirty || confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?');

    container.innerHTML = `
    <section class="space-y-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-blue-600 flex items-center gap-1"><i data-lucide="factory" class="w-3.5 h-3.5"></i>생산관리 › 생산계획</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1">생산계획</h2>
                    <p class="text-xs text-slate-500 mt-1">주간 계획에 일자별로 넣으면 일일 계획과 월간 계획(주간 취합)에 자동으로 모입니다. 생산스케줄·생산요청서·캘린더에서 불러오고, 수불부 재고로 원액·원부자재 부족을 확인합니다.</p>
                </div>
                ${canEdit ? '' : '<span class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold">조회 전용 (계획 입력은 매니저 이상)</span>'}
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl" id="pp-views">
                    ${[['month', '월간 생산계획', 'calendar-days'], ['week', '주간 생산계획', 'calendar-range'], ['day', '일일 생산계획', 'calendar-check']].map(([k, l, ic]) => `
                    <button type="button" data-v="${k}" class="pp-view px-3.5 py-2 rounded-lg text-xs font-black flex items-center gap-1.5 transition ${k === view ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}"><i data-lucide="${ic}" class="w-4 h-4"></i>${l}</button>`).join('')}
                </div>
                <div class="flex items-center gap-2 text-xs">
                    <span class="font-bold text-slate-600">거점</span>
                    <select id="pp-site" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                        <option value="">전체</option>${PLAN_SITES.map(s => `<option value="${s}" ${s === site ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div id="pp-nav"></div>
        </div>
        <div id="pp-body" class="space-y-5"></div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    // ---------- 공통 ----------
    const navHtml = (label, extra = '') => `
        <div class="flex flex-wrap items-center gap-2">
            <button type="button" id="pp-prev" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-black">‹</button>
            <span class="text-sm font-black text-slate-900 min-w-[220px] text-center">${esc(label)}</span>
            <button type="button" id="pp-next" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-black">›</button>
            <button type="button" id="pp-today" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold">오늘</button>
            ${extra}
        </div>`;
    const setDirty = (v) => { dirty = v; const b = $('#pp-save'); if (b) { b.classList.toggle('ring-4', v); b.classList.toggle('ring-amber-300', v); } const m = $('#pp-dirty'); if (m) m.classList.toggle('hidden', !v); };
    const siteOk = (l) => !site || l.site === site;
    // 전자결재: 계획서(거점 필터별) 하나에 결재 칸 하나
    const APPR_ROLES = ['작성', '검토', '승인'];
    const apprKey = (base) => `PLAN:${base}:${site || '전체'}`;
    const mountAppr = (key, type, title, date) => mountApprovalBox($('#pp-appr'), { key, type, title, date, roles: APPR_ROLES }, { showToast });

    const render = async () => {
        persist();
        container.querySelectorAll('.pp-view').forEach(b => { const on = b.dataset.v === view; b.className = `pp-view px-3.5 py-2 rounded-lg text-xs font-black flex items-center gap-1.5 transition ${on ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`; });
        $('#pp-body').innerHTML = '<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">불러오는 중...</div>';
        // 접수된 생산요청서·출고/이동 전표 중 아직 계획에 없는 것 자동 반영 (services/planAuto.js, 5분에 한 번)
        try {
            const r = await autoReflectOpen('PROD');
            if (r.reqs || r.slips) showToast(`📋 자동 반영: ${[r.reqs ? `요청서 ${r.reqs}건 → 주간 계획` : '', r.slips ? `출고·이동 전표 ${r.slips}건 → 일일 업무` : ''].filter(Boolean).join(' · ')}`);
            if (r.errors?.length) console.warn('계획 자동 반영', r.errors);
        } catch { /* 무시 */ }
        try {
            if (view === 'week') await renderWeek();
            else if (view === 'day') await renderDay();
            else await renderMonth();
        } catch (err) {
            $('#pp-body').innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(err.message)}</div>`;
        }
        createIcons({ icons });
    };

    // 이월 창: 완료되지 않은 줄을 골라 다음 주·다음 달로 옮긴다
    const openCarryDialog = ({ title, lines, shift, label, onDone }) => {
        if (dirty) { alert('저장하지 않은 변경이 있습니다. 먼저 [저장]을 누른 뒤 이월하세요.'); return; }
        const list = carryable(lines);
        if (!list.length) { alert('넘길 줄이 없습니다. (완료되지 않았고 남은 수량이 있는 줄만 넘깁니다)'); return; }
        const box = document.createElement('div');
        box.className = 'fixed inset-0 z-[70] bg-slate-900/60 p-3 overflow-y-auto flex items-start justify-center';
        box.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-6 text-xs overflow-hidden">
            <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between"><h3 class="font-black text-sm">${esc(title)}</h3><button type="button" class="cd-close text-slate-300 hover:text-white text-xl px-1">&times;</button></div>
            <div class="p-4 space-y-3">
                <p class="text-slate-600">완료되지 않은 줄 ${list.length}개입니다. 넘길 줄을 고르세요. <b>실적이 없는 줄은 통째로 옮기고</b>, 일부 생산한 줄은 <b>남은 수량만</b> 넘기고 원래 줄은 실적 수량으로 완료 처리합니다.</p>
                <div class="overflow-x-auto border border-slate-200 rounded-xl max-h-[55vh]">
                    <table class="w-full"><thead class="bg-slate-100 text-slate-600 sticky top-0"><tr>
                        <th class="p-2 w-8"><input type="checkbox" id="cd-all" checked /></th><th class="p-2 text-left">날짜</th><th class="p-2 text-left">거점·구분</th><th class="p-2 text-left">품목</th>
                        <th class="p-2 text-right">계획</th><th class="p-2 text-right">실적</th><th class="p-2 text-right">넘길 수량</th><th class="p-2 text-left">상태</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">${list.map((l, i) => `<tr>
                        <td class="p-2 text-center"><input type="checkbox" class="cd-chk" data-i="${i}" checked /></td>
                        <td class="p-2 whitespace-nowrap">${esc(md(l.date))}(${dowOf(l.date)}) → <b class="text-blue-700">${esc(md(shift(l.date)))}(${dowOf(shift(l.date))})</b></td>
                        <td class="p-2">${esc(l.site)} · ${esc(l.type)}</td>
                        <td class="p-2"><div class="font-bold">${esc(l.name)}</div><div class="text-[10px] font-mono text-blue-600">${esc(l.code || '')}</div></td>
                        <td class="p-2 text-right">${fmtQty(l.qty)}</td><td class="p-2 text-right text-emerald-700">${l.doneQty ? fmtQty(l.doneQty) : ''}</td>
                        <td class="p-2 text-right font-black">${fmtQty(carryRemain(l))} ${esc(unitOf(l))}</td><td class="p-2">${esc(PROD_LINE_STATUS[l.status] || '')}</td></tr>`).join('')}</tbody></table>
                </div>
                <div class="flex justify-end gap-2"><button type="button" class="cd-close px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold">취소</button>
                    <button type="button" id="cd-ok" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-black">선택한 줄 ${esc(label)}</button></div>
            </div></div>`;
        document.body.appendChild(box);
        const close = () => box.remove();
        box.querySelectorAll('.cd-close').forEach(b => b.addEventListener('click', close));
        box.querySelector('#cd-all').addEventListener('change', (e) => box.querySelectorAll('.cd-chk').forEach(c => { c.checked = e.target.checked; }));
        box.querySelector('#cd-ok').addEventListener('click', async () => {
            const chosen = [...box.querySelectorAll('.cd-chk')].filter(c => c.checked).map(c => list[Number(c.dataset.i)]);
            if (!chosen.length) { alert('넘길 줄을 고르세요.'); return; }
            try {
                const res = await carryOverLines('PROD_WEEK', chosen, shift, label);
                close();
                showToast(`➡️ ${res.count}줄을 ${label}했습니다.`);
                onDone?.(res);
            } catch (e) { alert(e.message); }
        });
    };

    const saveDoc = async () => {
        doc.lines = sortLines((doc.lines || []).filter(l => l.code || l.name));
        cleanDayTasks(doc);
        doc.author = doc.author || state.currentGlobalWorker || '';
        doc = await savePlan(doc);
        setDirty(false);
        showToast('💾 생산계획을 저장했습니다.');
    };

    // 생산스케줄(최신 작성일자) 줄 → 이 주 포장계획/납품예정 줄
    const latestSchedule = async () => {
        const dates = await listProdDates();
        return dates.length ? listProdSchedule(dates[0].date) : [];
    };
    const importSchedule = async () => {
        const rows = await latestSchedule();
        const days = weekDays(monday);
        const have = new Set(doc.lines.filter(l => l.source === 'SCHED').map(l => l.ref));
        const cands = rows.filter(r => !['DONE', 'SHIPPED', 'HOLD'].includes(r.status) && !have.has(r.id))
            .map(r => ({ r, date: days.includes(r.planDate) ? r.planDate : days.includes(r.dueDate) ? r.dueDate : '' }))
            .filter(x => x.date && (!site || (x.r.site === '김포' ? '김포' : '본사') === site));
        if (cands.length === 0) { alert('이 주에 포장계획·납품예정인 생산스케줄 줄이 없습니다 (이미 불러온 줄 제외).\n\n생산스케줄은 최신 작성일자 기준입니다.'); return; }
        if (!confirm(`생산스케줄에서 ${cands.length}줄을 불러올까요?\n\n${cands.slice(0, 12).map(x => `· ${md(x.date)} ${x.r.partner ? `${x.r.partner} · ` : ''}${x.r.itemName} ${fmtQty(x.r.qty)}`).join('\n')}${cands.length > 12 ? '\n…' : ''}`)) return;
        cands.forEach(({ r, date }) => {
            const m = state.master.find(x => x.code === r.itemCode) || state.master.find(x => x.name === r.itemName);
            doc.lines.push({ id: newLineId(), date, site: r.site === '김포' ? '김포' : '본사', type: m?.category === '원액' ? '원액' : '완제품', code: m?.code || r.itemCode || '', name: m?.name || r.itemName, spec: r.spec || m?.spec || '',
                qty: Number(r.qty) || '', unit: m?.unit || 'EA', line: r.line || '', partner: r.partner || '', due: r.dueDate || '', source: 'SCHED', ref: r.id, status: 'PLAN', note: r.notes || '' });
        });
        sortLines(doc.lines);
        await saveDoc();
        await render();
    };

    // 생산요청서(요청·접수) → 이 주 줄. 요청서는 '계획반영'으로 바꾼다
    const importRequests = async () => {
        const days = weekDays(monday);
        const sunday = days[6];
        const open = (await listPlans('PROD_REQ')).filter(r => ['REQUESTED', 'ACCEPTED'].includes(r.status) && (!site || r.site === site));
        // 납기가 이 주 안이거나 이미 지난 요청서만 (이후 납기는 그 주 계획에서 불러온다)
        const reqs = open.filter(r => !r.dueDate || r.dueDate <= sunday);
        const later = open.length - reqs.length;
        if (reqs.length === 0) { alert(`이 주에 불러올 생산요청서(요청·접수 상태, 납기 ${md(sunday)} 이전)가 없습니다.${later ? `\n\n납기가 이후인 요청서 ${later}건은 그 주의 생산계획에서 불러오세요.` : ''}`); return; }
        const today = localDateStr();
        if (!confirm(`생산요청서 ${reqs.length}건을 이 주 계획에 넣을까요?\n\n${reqs.slice(0, 12).map(r => `· ${r.docNo} ${r.partner || ''} 납기 ${r.dueDate || '-'} (${(r.lines || []).length}품목)`).join('\n')}\n\n납기가 이 주 안이면 그 날짜, 이미 지났으면 ${days.includes(today) ? '오늘' : '이 주 월요일'}로 넣습니다.${later ? `\n(납기가 이후인 요청서 ${later}건은 그 주에서 불러오세요)` : ''}`)) return;
        for (const r of reqs) {
            const date = days.includes(r.dueDate) ? r.dueDate : (days.includes(today) ? today : monday);
            (r.lines || []).filter(l => l.code || l.name).forEach((l, i) => {
                const m = state.master.find(x => x.code === l.code);
                doc.lines.push({ id: newLineId(), date, site: r.site || '본사', type: m?.category === '원액' ? '원액' : '완제품', code: l.code || '', name: l.name, spec: l.spec || '', qty: Number(l.qty) || '', unit: l.unit || m?.unit || 'EA',
                    line: '', partner: r.partner || (r.moveTo ? `→ ${r.moveTo}` : ''), due: r.dueDate || '', source: 'REQ', ref: `REQ:${r.id}:${i}`, refNo: r.docNo, status: 'PLAN', note: [r.urgent ? '긴급' : '', l.note || ''].filter(Boolean).join(' · ') });
            });
        }
        sortLines(doc.lines);
        await saveDoc();
        for (const r of reqs) await savePlan({ ...r, status: 'PLANNED', planWeek: monday, autoPlan: true });
        showToast(`📥 생산요청서 ${reqs.length}건을 불러오고 '계획반영'으로 바꿨습니다.`);
        await render();
    };

    // 캘린더(다이어리)의 생산예정 일정 → 이 주 줄
    const importCalendar = async () => {
        const days = weekDays(monday);
        const have = new Set(doc.lines.filter(l => l.source === 'CAL').map(l => l.ref));
        const cands = (state.schedules || []).filter(s => s.type === 'PROD_PLAN' && days.includes(s.date) && !have.has(s.id) && s.status !== 'DONE'
            && (!site || (s.calendar === 'GIMPO' ? '김포' : '본사') === site));
        if (cands.length === 0) { alert('이 주 캘린더에 불러올 생산예정 일정이 없습니다.'); return; }
        if (!confirm(`캘린더의 생산예정 일정 ${cands.length}건을 불러올까요? (수량은 일정에 없으면 비워 둡니다)`)) return;
        cands.forEach(s => {
            const m = state.master.find(x => x.code === s.itemCode);
            doc.lines.push({ id: newLineId(), date: s.date, site: s.calendar === 'GIMPO' ? '김포' : '본사', type: m?.category === '원액' ? '원액' : '완제품', code: m?.code || '', name: m?.name || s.itemName || s.title, spec: m?.spec || '',
                qty: '', unit: m?.unit || 'EA', line: '', partner: s.partner || '', due: '', source: 'CAL', ref: s.id, status: 'PLAN', note: s.title });
        });
        sortLines(doc.lines);
        setDirty(true);
        renderWeekLines();
        showToast(`📅 캘린더 일정 ${cands.length}건을 넣었습니다. 수량을 확인하고 저장하세요.`);
    };

    // ---------- 주간 ----------
    let schedMap = new Map();
    const weekColumns = () => {
        const days = weekDays(monday);
        return [
            { key: 'date', label: '날짜', type: 'select', w: 'w-24', options: days.map(d => [d, `${md(d)}(${dowOf(d)})`]) },
            { key: 'site', label: '거점', type: 'select', w: 'w-20', options: siteOptions },
            { key: 'type', label: '구분', type: 'select', w: 'w-20', options: TYPES },
            { key: 'name', label: '품목', type: 'item', onPick: (l, m) => { l.type = m.category === '원액' ? '원액' : '완제품'; } },
            { key: 'qty', label: '수량', type: 'number', w: 'w-24', align: 'right' },
            { key: 'unit', label: '단위', type: 'text', w: 'w-16', minW: 64 },
            { key: 'line', label: '라인', type: 'text', w: 'w-24' },
            { key: 'partner', label: '거래처', type: 'text', w: 'w-28' },
            { key: 'due', label: '납기', type: 'date', w: 'w-32' },
            { key: 'source', label: '출처', type: 'badge', w: 'w-24', render: (l) => sourceBadge(l, schedMap) },
            { key: 'status', label: '상태', type: 'select', w: 'w-20', options: statusOpts },
            { key: 'note', label: '비고', type: 'text' }
        ];
    };
    const renderWeekLines = () => {
        const lines = doc.lines.filter(siteOk);
        const days = weekDays(monday);
        $('#pp-day-cards').innerHTML = days.map(d => {
            const ls = lines.filter(l => l.date === d);
            const ea = ls.filter(l => l.type !== '원액').reduce((s, l) => s + (Number(l.qty) || 0), 0);
            const lt = ls.filter(l => l.type === '원액').reduce((s, l) => s + (Number(l.qty) || 0), 0);
            return `<button type="button" data-d="${d}" class="pp-daycard text-left p-2.5 rounded-xl border ${d === localDateStr() ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'} hover:border-blue-500">
                <div class="text-[11px] font-black ${dowOf(d) === '일' ? 'text-rose-600' : dowOf(d) === '토' ? 'text-blue-600' : 'text-slate-700'}">${md(d)} (${dowOf(d)})</div>
                <div class="text-xs font-bold text-slate-900 mt-1">${ls.length}건</div>
                <div class="text-[10px] text-slate-500">${ea ? `완제품 ${fmtQty(ea)}` : ''}${ea && lt ? ' · ' : ''}${lt ? `원액 ${fmtQty(lt)}L` : ''}${!ea && !lt ? '-' : ''}</div>
            </button>`;
        }).join('');
        container.querySelectorAll('.pp-daycard').forEach(b => b.addEventListener('click', () => { if (!guard()) return; day = b.dataset.d; view = 'day'; setDirty(false); render(); }));
        // 거점 필터로 보이는 줄만 편집 (삭제도 원본에서 지움)
        const visible = lines;
        renderLineTable($('#pp-lines'), {
            lines: visible, columns: weekColumns(), readOnly: !canEdit, emptyText: '이 주 계획이 없습니다. [+ 줄 추가] 또는 불러오기를 쓰세요.',
            rowClass: (l) => (l.status === 'DONE' ? 'opacity-60' : l.source === 'SHORT' ? 'bg-rose-50/50' : ''),
            onChange: (l, k) => {
                if (k === 'delete') doc.lines = doc.lines.filter(x => !siteOk(x) || visible.includes(x));
                setDirty(true);
            },
            onRerender: renderWeekLines
        });
    };

    const renderWeek = async () => {
        $('#pp-nav').innerHTML = navHtml(weekLabel(monday), `<input type="date" id="pp-pick" value="${monday}" class="border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold" />`);
        bindNav(() => { monday = addDays(monday, -7); }, () => { monday = addDays(monday, 7); }, () => { monday = weekStart(localDateStr()); }, (v) => { monday = weekStart(v); });
        doc = await loadWeek('PROD_WEEK', monday);
        doc.lines = sortLines(doc.lines || []);
        try { schedMap = new Map((await latestSchedule()).map(r => [r.id, r])); } catch { schedMap = new Map(); }
        const exists = !!doc.createdAt;
        $('#pp-body').innerHTML = `
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="calendar-range" class="w-4 h-4 text-blue-600"></i>주간 생산계획 · ${esc(weekLabel(monday))}
                        <span id="pp-dirty" class="hidden px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">저장 안 됨</span></h3>
                    <div class="flex flex-wrap gap-2">
                        ${canEdit ? `
                        <button type="button" id="pp-imp-sched" class="${btn('bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100')}"><i data-lucide="calendar-range" class="w-4 h-4"></i>생산스케줄 불러오기</button>
                        <button type="button" id="pp-imp-req" class="${btn('bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100')}"><i data-lucide="file-input" class="w-4 h-4"></i>생산요청서 불러오기</button>
                        <button type="button" id="pp-imp-cal" class="${btn('bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100')}"><i data-lucide="calendar" class="w-4 h-4"></i>캘린더 일정 불러오기</button>
                        <button type="button" id="pp-add" class="${btn('bg-white text-slate-700 border border-slate-300 hover:bg-slate-50')}"><i data-lucide="plus" class="w-4 h-4"></i>줄 추가</button>
                        <button type="button" id="pp-save" class="${btn('bg-blue-600 hover:bg-blue-700 text-white')}"><i data-lucide="save" class="w-4 h-4"></i>저장</button>
                        <button type="button" id="pp-carry" class="${btn('bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50')}"><i data-lucide="calendar-arrow-down" class="w-4 h-4"></i>다음주로 이전</button>
                        ${exists ? `<button type="button" id="pp-del" class="${btn('bg-white text-rose-600 border border-rose-200 hover:bg-rose-50')}"><i data-lucide="trash-2" class="w-4 h-4"></i>주간 계획 삭제</button>` : ''}` : ''}
                        <button type="button" id="pp-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>A4 출력</button>
                    </div>
                </div>
                <div id="pp-appr" class="flex justify-end"></div>
                <div id="pp-day-cards" class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2"></div>
                <div id="pp-lines"></div>
                <label class="block text-xs"><span class="font-bold text-slate-600">비고 (주간)</span>
                    <textarea id="pp-notes" rows="2" ${canEdit ? '' : 'readonly'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs">${esc(doc.notes || '')}</textarea></label>
                <div class="text-[11px] text-slate-400">${exists ? `마지막 저장: ${esc(new Date(doc.updatedAt).toLocaleString('ko-KR'))} · ${esc(doc.updatedBy || '')}` : '아직 저장하지 않은 주간 계획입니다.'}</div>
            </div>
            <div id="pp-short" class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm"></div>
            <div id="pp-safety" class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm"></div>`;
        renderWeekLines();
        mountAppr(exists ? apprKey(doc.id) : '', 'PROD_WEEK', `주간 생산계획 ${weekLabel(monday)}${site ? ` (${site})` : ''}`, monday);
        const wdays = weekDays(monday);
        renderSafetyPanel($('#pp-safety'), {
            prodLines: doc.lines, site, showToast, onApplied: () => { setDirty(false); render(); },
            dates: wdays.map(d => [d, `${md(d)}(${dowOf(d)})`]), defaultDate: wdays.includes(localDateStr()) ? localDateStr() : monday,
            beforeApply: () => !dirty || (alert('저장하지 않은 변경이 있습니다. 먼저 [저장]을 누른 뒤 반영하세요.'), false)
        });
        $('#pp-notes').addEventListener('input', (e) => { doc.notes = e.target.value; setDirty(true); });
        $('#pp-add')?.addEventListener('click', () => {
            const d = weekDays(monday).includes(localDateStr()) ? localDateStr() : monday;
            doc.lines.push({ id: newLineId(), date: d, site: site || '본사', type: '완제품', code: '', name: '', spec: '', qty: '', unit: 'EA', line: '', partner: '', due: '', source: 'MANUAL', status: 'PLAN', note: '' });
            setDirty(true);
            renderWeekLines();
        });
        $('#pp-save')?.addEventListener('click', async () => { try { await saveDoc(); await render(); } catch (e) { alert(e.message); } });
        $('#pp-carry')?.addEventListener('click', () => openCarryDialog({
            title: `다음주로 이전 — ${weekLabel(monday)} → ${weekLabel(addDays(monday, 7))}`, lines: doc.lines.filter(siteOk),
            shift: shiftNextWeek, label: '다음주로 이전', onDone: () => { monday = addDays(monday, 7); render(); }
        }));
        $('#pp-del')?.addEventListener('click', async () => {
            if (!confirm(`${weekLabel(monday)} 주간 생산계획을 삭제할까요? (일일 계획·월간 취합에서도 빠집니다)`)) return;
            try { await deletePlan(doc.id); setDirty(false); showToast('🗑️ 주간 생산계획을 삭제했습니다.'); await render(); } catch (e) { alert(e.message); }
        });
        const wrapImport = (fn) => async () => { if (dirty && !confirm('저장하지 않은 변경이 함께 저장됩니다. 계속할까요?')) return; try { await fn(); } catch (e) { alert(e.message); } };
        $('#pp-imp-sched')?.addEventListener('click', wrapImport(importSchedule));
        $('#pp-imp-req')?.addEventListener('click', wrapImport(importRequests));
        $('#pp-imp-cal')?.addEventListener('click', () => importCalendar().catch(e => alert(e.message)));
        $('#pp-print').addEventListener('click', () => printWeek());
        const purch = await loadWeek('PURCH_WEEK', monday);
        renderShortagePanel($('#pp-short'), { prodLines: doc.lines, purchLines: purch.lines || [], site, showToast, onApplied: () => render() });
    };

    const printWeek = () => {
        const lines = doc.lines.filter(siteOk).filter(l => l.code || l.name);
        const days = weekDays(monday);
        const body = days.map(d => {
            const ls = lines.filter(l => l.date === d);
            if (!ls.length) return '';
            return `<tr class="day"><td colspan="12">${md(d)} (${dowOf(d)}) · ${ls.length}건</td></tr>` + ls.map(l => `<tr>
                <td class="c">${esc(l.site)}</td><td class="c">${esc(l.type)}</td><td>${esc(l.code)}</td><td>${esc(l.name)}</td><td>${esc(l.spec || '')}</td>
                <td class="r">${fmtQty(l.qty)}</td><td class="c">${esc(unitOf(l))}</td><td>${esc(l.line || '')}</td><td>${esc(l.partner || '')}</td><td class="c">${esc(l.due || '')}</td>
                <td class="c">${esc(PROD_LINE_STATUS[l.status] || '')}</td><td>${esc([SOURCE_LABEL[l.source] && l.source !== 'MANUAL' ? `[${SOURCE_LABEL[l.source]}${l.refNo ? ` ${l.refNo}` : ''}]` : '', l.note || ''].filter(Boolean).join(' '))}</td></tr>`).join('');
        }).join('');
        const widths = [12, 12, 22, 50, 22, 18, 10, 18, 26, 20, 12];
        printA4({
            title: '주간 생산계획서', subtitle: 'WEEKLY PRODUCTION PLAN', landscape: true, approvalKey: doc.createdAt ? apprKey(doc.id) : '',
            meta: [['기간', weekLabel(monday)], ['거점', site || '전체'], ['작성자', doc.author || state.currentGlobalWorker || ''], ['계획 건수', `${lines.length}건`]],
            bodyHtml: `<table class="grid"><colgroup>${widths.map(w => `<col style="width:${w}mm">`).join('')}<col></colgroup>
                <thead><tr><th>거점</th><th>구분</th><th>품목코드</th><th>품목명</th><th>규격</th><th>수량</th><th>단위</th><th>라인</th><th>거래처</th><th>납기</th><th>상태</th><th>비고 / 출처</th></tr></thead>
                <tbody>${body || '<tr><td colspan="12" class="c">계획 없음</td></tr>'}</tbody></table>
                <h2>비고</h2><div class="notes">${esc(doc.notes || '')}</div>`
        });
    };

    // ---------- 일일 ----------
    const renderDay = async () => {
        monday = weekStart(day);
        $('#pp-nav').innerHTML = navHtml(`${day} (${dowOf(day)}) 일일 생산계획`, `<input type="date" id="pp-pick" value="${day}" class="border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold" /><span class="text-[11px] text-slate-400">· ${esc(weekLabel(monday))} 주간 계획의 이 날짜 줄</span>`);
        bindNav(() => { day = addDays(day, -1); }, () => { day = addDays(day, 1); }, () => { day = localDateStr(); }, (v) => { day = v; });
        doc = await loadWeek('PROD_WEEK', monday);
        doc.lines = sortLines(doc.lines || []);
        // 주간 계획의 이 날짜 생산 줄 → 업무 계획 1·2번 자동 반영 (바뀌었으면 조용히 저장)
        if (syncLineTasks(doc, day, site, doc.lines.filter(l => l.date === day && siteOk(l))) && canEdit) {
            try { cleanDayTasks(doc); doc = await savePlan(doc); doc.lines = sortLines(doc.lines || []); } catch { /* 저장 실패 → 화면에만 */ }
        }
        $('#pp-body').innerHTML = `
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="calendar-check" class="w-4 h-4 text-blue-600"></i>일일 생산계획 · ${esc(day)} (${dowOf(day)})
                        <span id="pp-dirty" class="hidden px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">저장 안 됨</span></h3>
                    <div class="flex flex-wrap gap-2">
                        ${canEdit ? `<button type="button" id="pp-add" class="${btn('bg-white text-slate-700 border border-slate-300 hover:bg-slate-50')}"><i data-lucide="plus" class="w-4 h-4"></i>줄 추가</button>
                        <button type="button" id="pp-save" class="${btn('bg-blue-600 hover:bg-blue-700 text-white')}"><i data-lucide="save" class="w-4 h-4"></i>저장</button>` : ''}
                        <button type="button" id="pp-to-week" class="${btn('bg-white text-slate-700 border border-slate-300 hover:bg-slate-50')}"><i data-lucide="calendar-range" class="w-4 h-4"></i>주간 계획 보기</button>
                        <button type="button" id="pp-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>A4 출력</button>
                    </div>
                </div>
                <div id="pp-appr" class="flex justify-end"></div>
                <div id="pp-day-sum" class="grid grid-cols-2 sm:grid-cols-4 gap-2"></div>
                <div id="pp-lines"></div>
                <p class="text-[11px] text-slate-400">실적 수량을 넣고 상태를 '완료'로 바꾸면 주간·월간 계획의 달성률에 반영됩니다. (재고 입고는 제품생산/입고 화면에서 합니다)</p>
                <div id="pp-tasks"></div>
            </div>`;
        const renderDayLines = () => {
            const visible = doc.lines.filter(l => l.date === day && siteOk(l));
            const ea = visible.filter(l => l.type !== '원액').reduce((s, l) => s + (Number(l.qty) || 0), 0);
            const lt = visible.filter(l => l.type === '원액').reduce((s, l) => s + (Number(l.qty) || 0), 0);
            const doneN = visible.filter(l => l.status === 'DONE').length;
            $('#pp-day-sum').innerHTML = [['계획 건수', `${visible.length}건`], ['완제품 계획', `${fmtQty(ea)}`], ['원액 계획', `${fmtQty(lt)} L`], ['완료', `${doneN} / ${visible.length}`]]
                .map(([k, v]) => `<div class="p-3 rounded-xl bg-slate-50 border border-slate-200"><div class="text-[11px] font-bold text-slate-500">${k}</div><div class="text-lg font-black text-slate-900">${v}</div></div>`).join('');
            renderLineTable($('#pp-lines'), {
                lines: visible, readOnly: !canEdit, emptyText: '이 날짜의 계획이 없습니다.',
                rowClass: (l) => (l.status === 'DONE' ? 'bg-emerald-50/60' : ''),
                columns: [
                    { key: 'site', label: '거점', type: 'select', w: 'w-20', options: siteOptions },
                    { key: 'type', label: '구분', type: 'select', w: 'w-20', options: TYPES },
                    { key: 'name', label: '품목', type: 'item', onPick: (l, m) => { l.type = m.category === '원액' ? '원액' : '완제품'; } },
                    { key: 'qty', label: '계획 수량', type: 'number', w: 'w-24', align: 'right' },
                    { key: 'doneQty', label: '실적 수량', type: 'number', w: 'w-24', align: 'right' },
                    { key: 'unit', label: '단위', type: 'text', w: 'w-16', minW: 64 },
                    { key: 'line', label: '라인', type: 'text', w: 'w-24' },
                    { key: 'partner', label: '거래처', type: 'text', w: 'w-28' },
                    { key: 'status', label: '상태', type: 'select', w: 'w-20', options: statusOpts },
                    { key: 'note', label: '비고', type: 'text' }
                ],
                onChange: (l, k) => {
                    if (k === 'delete') doc.lines = doc.lines.filter(x => !(x.date === day && siteOk(x)) || visible.includes(x));
                    if (l && k === 'doneQty' && Number(l.doneQty) >= Number(l.qty) && Number(l.qty) > 0) l.status = 'DONE';
                    setDirty(true);
                },
                onRerender: renderDayLines
            });
        };
        renderDayLines();
        mountAppr(`PLANDAY:${day}:${site || '전체'}`, 'PROD_DAY', `일일 생산계획 ${day}${site ? ` (${site})` : ''}`, day);
        // 일일 계획서 (인쇄·배포 첨부 공용): 생산 줄 + 업무 계획
        const dayPrintOpts = () => {
            const ls = doc.lines.filter(l => l.date === day && siteOk(l) && (l.code || l.name));
            const entry = getDayEntry(doc, day, site);
            const nTask = entry.tasks.filter(t => String(t.text || '').trim()).length;
            return {
                title: '일일 생산계획서', subtitle: 'DAILY PRODUCTION PLAN', approvalKey: `PLANDAY:${day}:${site || '전체'}`,
                meta: [['생산일자', `${day} (${dowOf(day)})`], ['거점', site || '전체'], ['주간', weekLabel(monday)], ['계획 건수', `${ls.length}건`], ...(nTask ? [['업무', `${nTask}건`]] : [])],
                bodyHtml: printTableHtml([
                    { label: '거점', w: 12, get: l => l.site, cls: 'c' }, { label: '구분', w: 12, get: l => l.type, cls: 'c' },
                    { label: '품목', w: 52, html: l => `${esc(l.name)}<br><span style="color:#666">${esc(l.code)}${l.spec ? ` · ${esc(l.spec)}` : ''}</span>` },
                    { label: '계획', w: 16, get: l => fmtQty(l.qty), cls: 'r' }, { label: '단위', w: 10, get: l => unitOf(l), cls: 'c' },
                    { label: '실적', w: 16, get: l => (l.doneQty === '' || l.doneQty === undefined ? '' : fmtQty(l.doneQty)), cls: 'r' },
                    { label: '라인', w: 16, get: l => l.line || '' }, { label: 'LOT / 확인', w: 24, get: () => '' },
                    { label: '비고', get: l => [l.partner, l.note].filter(Boolean).join(' · ') }
                ], ls, { minRows: nTask ? Math.max(ls.length, 4) : 14 }) + tasksPrintHtml(entry) + '<h2>특이사항</h2><div class="notes" style="min-height:24mm"></div>'
            };
        };
        renderDayTasks($('#pp-tasks'), {
            get doc() { return doc; }, day, site, canEdit, showToast,
            getLines: () => doc.lines.filter(l => l.date === day && siteOk(l)),
            setDirty, isDirty: () => dirty, save: saveDoc, rerender: render,
            buildPlanFile: async () => {
                const html = await buildA4Html(dayPrintOpts(), { autoPrint: false });
                return new File([html], `일일생산계획_${day}_${site || '전체'}.html`, { type: 'text/html' });
            }
        });
        $('#pp-add')?.addEventListener('click', () => {
            doc.lines.push({ id: newLineId(), date: day, site: site || '본사', type: '완제품', code: '', name: '', spec: '', qty: '', unit: 'EA', line: '', partner: '', due: '', source: 'MANUAL', status: 'PLAN', note: '' });
            setDirty(true);
            renderDayLines();
        });
        $('#pp-save')?.addEventListener('click', async () => { try { await saveDoc(); await render(); } catch (e) { alert(e.message); } });
        $('#pp-to-week').addEventListener('click', () => { if (!guard()) return; view = 'week'; setDirty(false); render(); });
        $('#pp-print').addEventListener('click', () => printA4(dayPrintOpts()));
    };

    // ---------- 월간 (주간 취합 + 직접 수정 → 주간 계획에 반영) ----------
    const renderMonth = async () => {
        const [y, m] = ym.split('-').map(Number);
        $('#pp-nav').innerHTML = navHtml(`${y}년 ${m}월 월간 생산계획`, `<input type="month" id="pp-pick" value="${ym}" class="border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold" /><span class="text-[11px] text-slate-400">· 주간 계획을 취합하고, 여기서 고치면 주간 계획에 반영됩니다</span>`);
        bindNav(() => { ym = monthOf(addDays(`${ym}-01`, -1)); }, () => { ym = monthOf(addDays(`${ym}-28`, 7)); }, () => { ym = monthOf(localDateStr()); }, (v) => { ym = v; });
        const { weeks, lines: all } = await loadMonthLines('PROD_WEEK', ym);
        // 편집 대상: 이 달·보이는 거점의 줄 (복사본). 다른 거점 줄은 저장 때 그대로 둔다.
        const edit = all.filter(siteOk).map(l => ({ ...l }));
        const head = (await getPlan('PROD_MONTH', ym)) || { id: planId('PROD_MONTH', ym), kind: 'PROD_MONTH', period: ym, notes: '', goals: '' };
        const days = monthDays(ym);
        const wLabel = (w, i) => `${i + 1}주 (${md(w)}~)`;
        // 품목(거점·구분·코드)별 주 합계
        const summarize = () => {
            const groups = new Map();
            edit.filter(l => l.code || l.name).forEach(l => {
                const k = `${l.site}|${l.type}|${l.code || l.name}`;
                const w = weekStart(l.date);
                const g = groups.get(k) || { site: l.site, type: l.type, code: l.code, name: l.name, unit: unitOf(l), byWeek: {}, total: 0, done: 0 };
                g.byWeek[w] = round3((g.byWeek[w] || 0) + (Number(l.qty) || 0));
                g.total = round3(g.total + (Number(l.qty) || 0));
                g.done = round3(g.done + (l.status === 'DONE' ? (Number(l.doneQty) || Number(l.qty) || 0) : (Number(l.doneQty) || 0)));
                groups.set(k, g);
            });
            return [...groups.values()].sort((a, b) => a.site.localeCompare(b.site) || a.type.localeCompare(b.type) || String(a.name).localeCompare(String(b.name), 'ko'));
        };
        const renderSummary = () => {
            const rows = summarize();
            const tot = (type) => rows.filter(r => r.type === type).reduce((s, r) => s + r.total, 0);
            const doneTot = rows.filter(r => r.type === '완제품').reduce((s, r) => s + r.done, 0), planTot = tot('완제품');
            $('#pp-mkpi').innerHTML = [['계획 품목', `${rows.length}건`], ['완제품 계획', fmtQty(tot('완제품'))], ['원액 계획', `${fmtQty(tot('원액'))} L`], ['완제품 달성률 (실적/계획)', planTot ? `${Math.round(doneTot / planTot * 100)}%` : '-']]
                .map(([k, v]) => `<div class="p-3 rounded-xl bg-slate-50 border border-slate-200"><div class="text-[11px] font-bold text-slate-500">${k}</div><div class="text-lg font-black text-slate-900">${v}</div></div>`).join('');
            $('#pp-msum').innerHTML = `
                <table class="w-full text-xs">
                    <thead class="bg-slate-100 text-slate-600"><tr><th class="p-2 text-left">거점</th><th class="p-2 text-left">구분</th><th class="p-2 text-left">품목</th>
                        ${weeks.map((w, i) => `<th class="p-2 text-right"><button type="button" class="pp-go-week underline decoration-dotted" data-w="${w}">${wLabel(w, i)}</button></th>`).join('')}
                        <th class="p-2 text-right">월 계획</th><th class="p-2 text-right">실적</th><th class="p-2 text-left">단위</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length === 0 ? `<tr><td colspan="${weeks.length + 6}" class="p-6 text-center text-slate-400">이 달의 계획이 없습니다. 아래 [줄 추가] 또는 주간 생산계획에서 입력하세요.</td></tr>` : rows.map(r => `<tr>
                            <td class="p-2">${esc(r.site)}</td><td class="p-2">${esc(r.type)}</td>
                            <td class="p-2"><div class="font-bold">${esc(r.name)}</div><div class="text-[10px] font-mono text-blue-600">${esc(r.code || '')}</div></td>
                            ${weeks.map(w => `<td class="p-2 text-right">${r.byWeek[w] ? fmtQty(r.byWeek[w]) : ''}</td>`).join('')}
                            <td class="p-2 text-right font-black">${fmtQty(r.total)}</td><td class="p-2 text-right text-emerald-700">${r.done ? fmtQty(r.done) : ''}</td><td class="p-2">${esc(r.unit)}</td></tr>`).join('')}
                    </tbody>
                </table>`;
            container.querySelectorAll('.pp-go-week').forEach(b => b.addEventListener('click', () => { if (!guard()) return; monday = b.dataset.w; view = 'week'; setDirty(false); render(); }));
        };
        const columns = [
            { key: 'date', label: '날짜', type: 'select', options: days.map(d => [d, `${md(d)}(${dowOf(d)})`]) },
            { key: 'site', label: '거점', type: 'select', options: siteOptions },
            { key: 'type', label: '구분', type: 'select', options: TYPES },
            { key: 'name', label: '품목', type: 'item', onPick: (l, mm) => { l.type = mm.category === '원액' ? '원액' : '완제품'; } },
            { key: 'qty', label: '수량', type: 'number', align: 'right' },
            { key: 'unit', label: '단위', type: 'text', minW: 64 },
            { key: 'line', label: '라인', type: 'text' },
            { key: 'partner', label: '거래처', type: 'text' },
            { key: 'source', label: '출처', type: 'badge', render: (l) => sourceBadge(l, null) },
            { key: 'status', label: '상태', type: 'select', options: statusOpts },
            { key: 'doneQty', label: '실적', type: 'number', align: 'right' },
            { key: 'note', label: '비고', type: 'text' }
        ];
        const renderEdit = () => renderLineTable($('#pp-mlines'), {
            lines: edit, columns, readOnly: !canEdit, emptyText: '이 달의 계획 줄이 없습니다.',
            rowClass: (l) => (l.status === 'DONE' ? 'opacity-60' : l.source === 'SHORT' ? 'bg-rose-50/50' : l.source === 'SAFETY' ? 'bg-yellow-50/60' : ''),
            onChange: (l, k) => { setDirty(true); if (['qty', 'date', 'site', 'type', 'code', 'delete', 'status', 'doneQty'].includes(k)) renderSummary(); },
            onRerender: () => { renderEdit(); renderSummary(); }
        });
        $('#pp-body').innerHTML = `
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="calendar-days" class="w-4 h-4 text-blue-600"></i>월간 생산계획 · ${y}년 ${m}월
                        <span id="pp-dirty" class="hidden px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">저장 안 됨</span></h3>
                    <div class="flex flex-wrap gap-2">
                        ${canEdit ? `<button type="button" id="pp-add" class="${btn('bg-white text-slate-700 border border-slate-300 hover:bg-slate-50')}"><i data-lucide="plus" class="w-4 h-4"></i>줄 추가</button>
                        <button type="button" id="pp-save" class="${btn('bg-blue-600 hover:bg-blue-700 text-white')}"><i data-lucide="save" class="w-4 h-4"></i>저장 (주간 계획에 반영)</button>
                        <button type="button" id="pp-carry" class="${btn('bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50')}"><i data-lucide="calendar-arrow-down" class="w-4 h-4"></i>다음달로 이월</button>
                        ${head.createdAt ? `<button type="button" id="pp-del" class="${btn('bg-white text-rose-600 border border-rose-200 hover:bg-rose-50')}"><i data-lucide="trash-2" class="w-4 h-4"></i>목표·비고 삭제</button>` : ''}` : ''}
                        <button type="button" id="pp-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>A4 출력</button>
                    </div>
                </div>
                <div id="pp-appr" class="flex justify-end"></div>
                <div id="pp-mkpi" class="grid grid-cols-2 sm:grid-cols-4 gap-2"></div>
                <div id="pp-msum" class="overflow-x-auto border border-slate-200 rounded-xl"></div>
                <div class="space-y-2">
                    <div class="text-xs font-black text-slate-800 flex items-center gap-1.5"><i data-lucide="pencil" class="w-3.5 h-3.5 text-blue-600"></i>이 달의 계획 줄 <span class="font-normal text-slate-400">— 여기서 고치고 [저장]하면 날짜가 속한 주간 계획에 반영됩니다 (날짜를 바꾸면 다른 주로 옮겨짐)</span></div>
                    <div id="pp-mlines"></div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <label class="block"><span class="font-bold text-slate-600">월간 목표 / 중점 사항</span>
                        <textarea id="pp-goals" rows="3" ${canEdit ? '' : 'readonly'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5">${esc(head.goals || '')}</textarea></label>
                    <label class="block"><span class="font-bold text-slate-600">비고</span>
                        <textarea id="pp-notes" rows="3" ${canEdit ? '' : 'readonly'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5">${esc(head.notes || '')}</textarea></label>
                </div>
            </div>
            <div id="pp-short" class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm"></div>
            <div id="pp-safety" class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm"></div>`;
        renderSummary();
        renderEdit();
        mountAppr(apprKey(head.id), 'PROD_MONTH', `월간 생산계획 ${y}년 ${m}월${site ? ` (${site})` : ''}`, ym);
        let headDirty = false;
        $('#pp-goals').addEventListener('input', (e) => { head.goals = e.target.value; headDirty = true; setDirty(true); });
        $('#pp-notes').addEventListener('input', (e) => { head.notes = e.target.value; headDirty = true; setDirty(true); });
        $('#pp-add')?.addEventListener('click', () => {
            const d = days.includes(localDateStr()) ? localDateStr() : days[0];
            edit.push({ id: newLineId(), date: d, site: site || '본사', type: '완제품', code: '', name: '', spec: '', qty: '', unit: 'EA', line: '', partner: '', due: '', source: 'MANUAL', status: 'PLAN', note: '' });
            setDirty(true);
            renderEdit();
        });
        $('#pp-save')?.addEventListener('click', async () => {
            const lines = edit.filter(l => l.code || l.name);
            if (lines.some(l => monthOf(l.date) !== ym)) { alert('날짜가 이 달이 아닌 줄이 있습니다.'); return; }
            try {
                const changedWeeks = await saveMonthLines('PROD_WEEK', ym, lines, (l) => !siteOk(l));
                if (headDirty || !head.createdAt) await savePlan({ ...head, author: head.author || state.currentGlobalWorker });
                setDirty(false);
                showToast(`💾 월간 생산계획을 저장했습니다.${changedWeeks.length ? ` 주간 계획 ${changedWeeks.length}개 주에 반영 (${changedWeeks.map(w => md(w)).join(', ')} 주)` : ''}`);
                await render();
            } catch (e) { alert(e.message); }
        });
        $('#pp-carry')?.addEventListener('click', () => {
            const next = monthOf(shiftNextMonth(`${ym}-01`));
            openCarryDialog({
                title: `다음달로 이월 — ${y}년 ${m}월 → ${next.replace('-', '년 ')}월`, lines: all.filter(siteOk),
                shift: shiftNextMonth, label: '다음달로 이월', onDone: () => { ym = next; render(); }
            });
        });
        $('#pp-del')?.addEventListener('click', async () => { if (!confirm('월간 목표·비고를 삭제할까요? (계획 줄은 그대로 남습니다)')) return; try { await deletePlan(head.id); setDirty(false); await render(); } catch (e) { alert(e.message); } });
        $('#pp-print').addEventListener('click', () => {
            const rows = summarize();
            const tot = (type) => rows.filter(r => r.type === type).reduce((s, r) => s + r.total, 0);
            const wCols = weeks.map((w, i) => ({ label: wLabel(w, i), w: 20, get: r => (r.byWeek[w] ? fmtQty(r.byWeek[w]) : ''), cls: 'r' }));
            printA4({
                title: '월간 생산계획서', subtitle: 'MONTHLY PRODUCTION PLAN', landscape: true, approvalKey: apprKey(head.id),
                meta: [['계획월', `${y}년 ${m}월`], ['거점', site || '전체'], ['완제품', fmtQty(tot('완제품'))], ['원액', `${fmtQty(tot('원액'))} L`], ['작성자', head.author || state.currentGlobalWorker || '']],
                bodyHtml: printTableHtml([
                    { label: '거점', w: 12, get: r => r.site, cls: 'c' }, { label: '구분', w: 12, get: r => r.type, cls: 'c' },
                    { label: '품목', html: r => `${esc(r.name)} <span style="color:#666">${esc(r.code || '')}</span>` },
                    ...wCols, { label: '월 계획', w: 20, get: r => fmtQty(r.total), cls: 'r' }, { label: '실적', w: 18, get: r => (r.done ? fmtQty(r.done) : ''), cls: 'r' }, { label: '단위', w: 10, get: r => r.unit, cls: 'c' }
                ], rows, { emptyText: '계획 없음' }) + `<h2>월간 목표 / 중점 사항</h2><div class="notes">${esc(head.goals || '')}</div><h2>비고</h2><div class="notes">${esc(head.notes || '')}</div>`
            });
        });
        const purch = await loadMonthLines('PURCH_WEEK', ym);
        renderShortagePanel($('#pp-short'), { prodLines: all.filter(l => l.code), purchLines: purch.lines, site, title: '월간 원액·원부자재 재고 확인 (수불부 기준)', showToast, onApplied: () => { setDirty(false); render(); } });
        renderSafetyPanel($('#pp-safety'), {
            prodLines: all, site, showToast, onApplied: () => { setDirty(false); render(); },
            dates: days.map(d => [d, `${md(d)}(${dowOf(d)})`]), defaultDate: days.includes(localDateStr()) ? localDateStr() : days[0],
            beforeApply: () => !dirty || (alert('저장하지 않은 변경이 있습니다. 먼저 [저장]을 누른 뒤 반영하세요.'), false)
        });
        createIcons({ icons });
    };

    function bindNav(prev, next, today, pick) {
        const go = (fn) => () => { if (!guard()) return; fn(); setDirty(false); render(); };
        $('#pp-prev').addEventListener('click', go(prev));
        $('#pp-next').addEventListener('click', go(next));
        $('#pp-today').addEventListener('click', go(today));
        $('#pp-pick')?.addEventListener('change', (e) => { if (!e.target.value) return; if (!guard()) return; pick(e.target.value); setDirty(false); render(); });
    }

    container.querySelectorAll('.pp-view').forEach(b => b.addEventListener('click', () => { if (b.dataset.v === view || !guard()) return; view = b.dataset.v; if (view === 'day') day = weekDays(monday).includes(localDateStr()) ? localDateStr() : monday; if (view === 'month') ym = monthOf(addDays(monday, 3)); setDirty(false); render(); }));
    $('#pp-site').addEventListener('change', (e) => { if (!guard()) { e.target.value = site; return; } site = e.target.value; setDirty(false); render(); });
    render();
};
