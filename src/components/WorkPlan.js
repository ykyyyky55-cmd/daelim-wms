import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { localDateStr } from '../services/searchUtils.js';
import {
    WORK_STATUS, WORK_STATUS_COLOR, WORK_CATEGORIES, blankTask, loadWorkPlan, saveWorkPlan, deleteWorkPlan,
    prevMonth, nextMonth, effectiveStatus, summarizeTasks, loadYearMonths, yearTaskMonthly
} from '../services/workPlans.js';
import { renderLineTable, printA4, btn } from './plans/planCommon.js';
import { mountApprovalBox } from './approval/ApprovalBox.js';

// 생산관리 → 업무추진계획: 월간 업무추진계획서 · 연간 업무추진계획서
// - 월간: 중점 목표, 성과지표(KPI 목표·실적), 추진과제(구분·과제·세부내용·부서·담당·일정·지표·진행률·상태·실적), 실적 검토·이슈
//   연간 계획에서 그 달에 추진할 과제를 불러오거나(yearRef), 전월 미완료 과제를 이월한다.
// - 연간: 경영 목표·방침, 연간 성과지표, 추진과제(추진 월 1~12), 월간 계획에서 모은 월별 진행률(간트 표)
// - 결재 칸(작성·검토·승인)과 A4 가로 인쇄. 권한: 조회 VIEWER, 작성 MANAGER(MRP_PLANNING)
const VIEW_KEY = 'daelim_workplan_view';
const ROLES = ['작성', '검토', '승인'];
const clampPct = (v) => Math.min(100, Math.max(0, Number(v) || 0));
const statusBadge = (t) => {
    const s = effectiveStatus(t);
    const c = WORK_STATUS_COLOR[s];
    const p = clampPct(t.progress);
    return `<div class="min-w-[92px]"><span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-black bg-${c}-100 text-${c}-700">${WORK_STATUS[s]}${s === 'DELAY' && t.status !== 'DELAY' ? ' (기한 지남)' : ''}</span>
        <div class="mt-1 h-1.5 rounded-full bg-slate-200 overflow-hidden"><div class="h-full bg-${c}-500" style="width:${p}%"></div></div>
        <div class="text-[10px] text-slate-500 font-mono">${p}%</div></div>`;
};
const catOpts = WORK_CATEGORIES.map(c => [c, c]);
const statusOpts = Object.entries(WORK_STATUS);

export const renderWorkPlan = (container, { showToast }) => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); } catch { }
    const pending = window.__pendingPlanOpen?.tab === 'workPlan' ? window.__pendingPlanOpen : null;
    window.__pendingPlanOpen = null;
    const today = localDateStr();
    let view = pending?.view || saved.view || 'month';
    let ym = String(pending?.date || today).slice(0, 7);
    let year = String(pending?.date || today).slice(0, 4);
    let doc = null;
    let dirty = false;
    const canEdit = canPerformAction('MRP_PLANNING');
    const guard = () => !dirty || confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?');

    container.innerHTML = `
    <section class="space-y-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-indigo-600 flex items-center gap-1"><i data-lucide="target" class="w-3.5 h-3.5"></i>생산관리 › 업무추진계획</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1">업무추진계획서</h2>
                    <p class="text-xs text-slate-500 mt-1">연간 계획에 한 해의 목표와 추진과제(추진 월)를 세우고, 월간 계획에서 그 달 과제의 일정·진행률·실적을 관리합니다. 추진 현황은 <b>월간 실적 현황판</b>에도 나옵니다.</p>
                </div>
                ${canEdit ? '' : '<span class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold">조회 전용 (작성은 매니저 이상)</span>'}
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">
                    ${[['month', '월간 업무추진계획서', 'calendar-days'], ['year', '연간 업무추진계획서', 'calendar-range']].map(([k, l, ic]) => `
                    <button type="button" data-v="${k}" class="wp-view px-3.5 py-2 rounded-lg text-xs font-black flex items-center gap-1.5 transition"><i data-lucide="${ic}" class="w-4 h-4"></i>${l}</button>`).join('')}
                </div>
                <div id="wp-nav"></div>
            </div>
        </div>
        <div id="wp-body" class="space-y-5"></div>
    </section>`;
    const $ = (s) => container.querySelector(s);
    const setDirty = (v) => { dirty = v; $('#wp-dirty')?.classList.toggle('hidden', !v); };
    const kind = () => (view === 'year' ? 'WORK_YEAR' : 'WORK_MONTH');
    const periodLabel = () => (view === 'year' ? `${year}년` : `${ym.replace('-', '년 ')}월`);
    const apprKey = () => (doc?.createdAt ? `PLAN:${doc.id}:전체` : '');

    container.querySelectorAll('.wp-view').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.v === view || !guard()) return;
        view = b.dataset.v; setDirty(false); render();
    }));

    const renderNav = () => {
        const label = periodLabel();
        $('#wp-nav').innerHTML = `
            <div class="flex flex-wrap items-center gap-2">
                <button type="button" id="wp-prev" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-black">‹</button>
                <span class="text-sm font-black text-slate-900 min-w-[120px] text-center">${esc(label)}</span>
                <button type="button" id="wp-next" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-black">›</button>
                <button type="button" id="wp-today" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold">${view === 'year' ? '올해' : '이번 달'}</button>
            </div>`;
        const go = (fn) => () => { if (!guard()) return; fn(); setDirty(false); render(); };
        $('#wp-prev').addEventListener('click', go(() => { if (view === 'year') year = String(Number(year) - 1); else ym = prevMonth(ym); }));
        $('#wp-next').addEventListener('click', go(() => { if (view === 'year') year = String(Number(year) + 1); else ym = nextMonth(ym); }));
        $('#wp-today').addEventListener('click', go(() => { year = today.slice(0, 4); ym = today.slice(0, 7); }));
    };

    const render = async () => {
        try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view })); } catch { }
        container.querySelectorAll('.wp-view').forEach(b => { b.className = `wp-view px-3.5 py-2 rounded-lg text-xs font-black flex items-center gap-1.5 transition ${b.dataset.v === view ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`; });
        renderNav();
        $('#wp-body').innerHTML = '<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">불러오는 중...</div>';
        try {
            doc = await loadWorkPlan(kind(), view === 'year' ? year : ym);
            doc.tasks ||= []; doc.kpis ||= [];
            await renderDoc();
        } catch (err) {
            $('#wp-body').innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(err.message)}</div>`;
        }
        createIcons({ icons });
    };

    // ---------- 요약 ----------
    const renderSummary = () => {
        const s = summarizeTasks(doc.tasks);
        const box = (k, v, c = 'slate', sub = '') => `<div class="p-3 rounded-xl bg-${c}-50 border border-${c}-200"><div class="text-[11px] font-bold text-${c}-700">${k}</div><div class="text-lg font-black text-slate-900">${v}</div>${sub}</div>`;
        $('#wp-sum').innerHTML = [
            box('추진과제', `${s.total}건`),
            box('완료', `${s.count.DONE}건`, 'emerald', `<div class="text-[10px] text-slate-500">완료율 ${s.doneRate.toFixed(0)}%</div>`),
            box('진행 중', `${s.count.WORK}건`, 'blue', `<div class="text-[10px] text-slate-500">계획 ${s.count.PLAN} · 보류 ${s.count.HOLD}</div>`),
            box('지연', `${s.count.DELAY}건`, s.count.DELAY ? 'rose' : 'slate', '<div class="text-[10px] text-slate-500">기한 지난 미완료 포함</div>'),
            box('평균 진행률', `${s.avg.toFixed(0)}%`, 'indigo', `<div class="mt-1 h-1.5 rounded-full bg-slate-200 overflow-hidden"><div class="h-full bg-indigo-500" style="width:${s.avg}%"></div></div>`)
        ].join('');
    };

    // ---------- 성과지표 ----------
    const renderKpis = () => {
        renderLineTable($('#wp-kpis'), {
            lines: doc.kpis, readOnly: !canEdit, emptyText: '성과지표가 없습니다. [지표 추가]로 넣으세요.',
            columns: [
                { key: 'name', label: '지표', type: 'text', minW: 180 },
                { key: 'unit', label: '단위', type: 'text', minW: 64 },
                { key: 'target', label: view === 'year' ? '연간 목표' : '월 목표', type: 'number', align: 'right' },
                { key: 'actual', label: '실적', type: 'number', align: 'right' },
                { key: 'rate', label: '달성률', type: 'static', align: 'right', render: (k) => `<span class="kpi-rate font-black" data-id="${esc(k.id)}">${Number(k.target) ? `${((Number(k.actual) || 0) / Number(k.target) * 100).toFixed(1)}%` : '-'}</span>` },
                { key: 'note', label: '비고', type: 'text' }
            ],
            onChange: (k) => {
                setDirty(true);
                if (k) { const el = $(`.kpi-rate[data-id="${CSS.escape(k.id)}"]`); if (el) el.textContent = Number(k.target) ? `${((Number(k.actual) || 0) / Number(k.target) * 100).toFixed(1)}%` : '-'; }
            },
            onRerender: renderKpis
        });
    };

    // ---------- 추진과제 ----------
    const taskColumns = () => {
        const common = [
            { key: 'category', label: '구분', type: 'select', options: catOpts },
            { key: 'title', label: '추진과제', type: 'text', minW: 200 },
            { key: 'detail', label: '세부 추진내용', type: 'text', minW: 220 },
            { key: 'dept', label: '주관부서', type: 'text', minW: 90 },
            { key: 'owner', label: '담당자', type: 'text', minW: 80 }
        ];
        const tail = [
            { key: 'target', label: '목표·성과지표', type: 'text', minW: 140 },
            { key: 'progress', label: '진행률(%)', type: 'number', align: 'right', minW: 80 },
            { key: 'status', label: '상태', type: 'select', options: statusOpts },
            { key: '__st', label: '현황', type: 'badge', render: (t) => `<div class="wp-st" data-id="${esc(t.id)}">${statusBadge(t)}</div>` },
            { key: 'result', label: '추진실적', type: 'text', minW: 200 },
            { key: 'note', label: '비고', type: 'text', minW: 100 }
        ];
        if (view === 'year') return [...common, { key: '__months', label: '추진 월 (1~12월)', type: 'badge', render: monthsCell }, ...tail];
        return [...common,
            { key: 'start', label: '시작일', type: 'date' }, { key: 'end', label: '완료 예정일', type: 'date' },
            ...tail,
            { key: '__ref', label: '출처', type: 'badge', render: (t) => (t.yearRef ? '<span class="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold whitespace-nowrap">연간 과제</span>' : t.carriedFrom ? `<span class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold whitespace-nowrap">${esc(t.carriedFrom)} 이월</span>` : '<span class="text-[10px] text-slate-400">직접</span>') }
        ];
    };
    const monthsCell = (t) => `<div class="grid grid-cols-6 gap-0.5 min-w-[168px]">${Array.from({ length: 12 }, (_, i) => i + 1).map(m => `
        <label class="flex flex-col items-center text-[9px] font-bold text-slate-500 cursor-pointer"><input type="checkbox" class="wp-mon accent-indigo-600" data-id="${esc(t.id)}" data-m="${m}" ${(t.months || []).includes(m) ? 'checked' : ''} ${canEdit ? '' : 'disabled'} />${m}월</label>`).join('')}</div>`;
    const renderTasks = () => {
        renderLineTable($('#wp-tasks'), {
            lines: doc.tasks, columns: taskColumns(), readOnly: !canEdit, emptyText: view === 'year' ? '추진과제가 없습니다. [과제 추가]로 넣으세요.' : '추진과제가 없습니다. [과제 추가] 또는 [연간 계획에서 불러오기]를 쓰세요.',
            rowClass: (t) => (effectiveStatus(t) === 'DONE' ? 'opacity-70' : effectiveStatus(t) === 'DELAY' ? 'bg-rose-50/40' : ''),
            onChange: (t) => {
                setDirty(true);
                if (t) { const el = $(`.wp-st[data-id="${CSS.escape(t.id)}"]`); if (el) el.innerHTML = statusBadge(t); }
                renderSummary();
            },
            onRerender: renderTasks
        });
        $('#wp-tasks').querySelectorAll('.wp-mon').forEach(cb => cb.addEventListener('change', () => {
            const t = doc.tasks.find(x => x.id === cb.dataset.id);
            if (!t) return;
            const m = Number(cb.dataset.m);
            t.months = cb.checked ? [...new Set([...(t.months || []), m])].sort((a, b) => a - b) : (t.months || []).filter(x => x !== m);
            setDirty(true);
        }));
    };

    // ---------- 연간: 월간 연동 간트 ----------
    const renderYearGantt = async () => {
        const host = $('#wp-gantt');
        if (!host) return;
        const monthly = yearTaskMonthly(await loadYearMonths(year));
        const tasks = doc.tasks.filter(t => t.title);
        const cell = (t, m) => {
            const planned = (t.months || []).includes(m);
            const r = monthly[t.id]?.[m];
            if (r) {
                const c = WORK_STATUS_COLOR[r.status];
                return `<td class="p-1 text-center"><div class="rounded bg-${c}-100 text-${c}-800 text-[10px] font-black py-1" title="${WORK_STATUS[r.status]}">${r.progress}%</div></td>`;
            }
            return `<td class="p-1 text-center">${planned ? '<div class="rounded bg-indigo-50 border border-dashed border-indigo-300 text-[10px] text-indigo-500 py-1">계획</div>' : ''}</td>`;
        };
        host.innerHTML = `
            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs"><thead class="bg-slate-100 text-slate-600"><tr><th class="p-2 text-left min-w-[200px]">추진과제</th><th class="p-2 min-w-[70px]">담당</th>${Array.from({ length: 12 }, (_, i) => `<th class="p-1 w-14">${i + 1}월</th>`).join('')}<th class="p-2">진행률</th></tr></thead>
                <tbody class="divide-y divide-slate-100">${tasks.length ? tasks.map(t => `<tr><td class="p-2 font-bold">${esc(t.title)}<div class="text-[10px] text-slate-400">${esc(t.category || '')}${t.dept ? ` · ${esc(t.dept)}` : ''}</div></td><td class="p-2 text-center text-slate-600">${esc(t.owner || '')}</td>${Array.from({ length: 12 }, (_, i) => cell(t, i + 1)).join('')}<td class="p-2">${statusBadge(t)}</td></tr>`).join('') : '<tr><td colspan="15" class="p-6 text-center text-slate-400">저장된 연간 추진과제가 없습니다.</td></tr>'}</tbody></table>
            </div>
            <p class="text-[10px] text-slate-400">점선 칸 = 추진 계획 월, 색 칸 = 그 달 월간 업무추진계획서에 불러온 과제의 진행률(상태 색). 월간 계획에서 [연간 계획에서 불러오기]로 과제를 가져오면 연동됩니다.</p>`;
    };

    // ---------- 문서 ----------
    const renderDoc = async () => {
        const exists = !!doc.createdAt;
        const isYear = view === 'year';
        $('#wp-body').innerHTML = `
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="${isYear ? 'calendar-range' : 'calendar-days'}" class="w-4 h-4 text-indigo-600"></i>${isYear ? '연간' : '월간'} 업무추진계획서 · ${esc(periodLabel())}
                        <span id="wp-dirty" class="hidden px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">저장 안 됨</span></h3>
                    <div class="flex flex-wrap gap-2">
                        ${canEdit ? `
                        ${isYear ? '' : `<button type="button" id="wp-imp-year" class="${btn('bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100')}"><i data-lucide="file-input" class="w-4 h-4"></i>연간 계획에서 불러오기</button>
                        <button type="button" id="wp-carry" class="${btn('bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100')}"><i data-lucide="corner-down-right" class="w-4 h-4"></i>전월 미완료 이월</button>`}
                        <button type="button" id="wp-add" class="${btn('bg-white text-slate-700 border border-slate-300 hover:bg-slate-50')}"><i data-lucide="plus" class="w-4 h-4"></i>과제 추가</button>
                        <button type="button" id="wp-save" class="${btn('bg-indigo-600 hover:bg-indigo-700 text-white')}"><i data-lucide="save" class="w-4 h-4"></i>저장</button>
                        ${exists ? `<button type="button" id="wp-del" class="${btn('bg-white text-rose-600 border border-rose-200 hover:bg-rose-50')}"><i data-lucide="trash-2" class="w-4 h-4"></i>삭제</button>` : ''}` : ''}
                        <button type="button" id="wp-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>A4 출력</button>
                    </div>
                </div>
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                    <div class="lg:col-span-8 grid grid-cols-2 sm:grid-cols-5 gap-2" id="wp-sum"></div>
                    <div id="wp-appr" class="lg:col-span-4 flex justify-end"></div>
                </div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <label class="block text-xs"><span class="font-black text-slate-700">${isYear ? '경영 목표 · 추진 방침' : '이달의 중점 목표'}</span>
                        <textarea id="wp-goal" rows="4" ${canEdit ? '' : 'readonly'} placeholder="${isYear ? '예) 1. 생산성 10% 향상 2. 원가 절감 3. 무재해 달성' : '예) 추석 성수기 출하 대응, 원액 재고 적정화'}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs">${esc(doc.goal || '')}</textarea></label>
                    <div class="text-xs"><div class="flex items-center justify-between"><span class="font-black text-slate-700">성과지표 (KPI)</span>
                        ${canEdit ? '<button type="button" id="wp-kpi-add" class="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-[11px]">+ 지표 추가</button>' : ''}</div>
                        <div id="wp-kpis" class="mt-1"></div></div>
                </div>
                <div>
                    <div class="text-xs font-black text-slate-700 mb-1">추진과제</div>
                    <div id="wp-tasks"></div>
                </div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <label class="block text-xs"><span class="font-black text-slate-700">${isYear ? '연간 추진 실적 · 평가' : '실적 검토 · 이슈 및 대책'}</span>
                        <textarea id="wp-review" rows="3" ${canEdit ? '' : 'readonly'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs">${esc(doc.review || '')}</textarea></label>
                    <label class="block text-xs"><span class="font-black text-slate-700">비고 · 협조 요청</span>
                        <textarea id="wp-notes" rows="3" ${canEdit ? '' : 'readonly'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs">${esc(doc.notes || '')}</textarea></label>
                </div>
                <div class="text-[11px] text-slate-400">${exists ? `마지막 저장: ${esc(new Date(doc.updatedAt).toLocaleString('ko-KR'))} · ${esc(doc.updatedBy || '')}` : '아직 저장하지 않은 계획서입니다. 저장해야 결재할 수 있습니다.'} · ${isYear ? '추진 월을 체크하면 그 달 월간 계획의 [연간 계획에서 불러오기]로 가져갈 수 있습니다. 진행률이 100%이면 완료로 봅니다.' : '진행률이 100%이면 완료, 완료 예정일이 지났는데 미완료면 지연으로 봅니다.'}</div>
            </div>
            ${isYear ? `<div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="chart-gantt" class="w-4 h-4 text-indigo-600"></i>월별 추진 현황 (월간 계획 연동)</h3>
                <div id="wp-gantt"></div></div>` : ''}`;
        renderSummary();
        renderKpis();
        renderTasks();
        mountApprovalBox($('#wp-appr'), { key: apprKey(), type: kind(), title: `${isYear ? '연간' : '월간'} 업무추진계획서 ${periodLabel()}`, date: doc.period, roles: ROLES }, { showToast });
        if (isYear) renderYearGantt().then(() => createIcons({ icons })).catch(e => { $('#wp-gantt').innerHTML = `<div class="text-xs text-rose-600">${esc(e.message)}</div>`; });

        ['goal', 'review', 'notes'].forEach(k => $(`#wp-${k}`).addEventListener('input', (e) => { doc[k] = e.target.value; setDirty(true); }));
        $('#wp-kpi-add')?.addEventListener('click', () => { doc.kpis.push({ id: `K-${Date.now()}`, name: '', unit: '', target: '', actual: '', note: '' }); setDirty(true); renderKpis(); });
        $('#wp-add')?.addEventListener('click', () => {
            doc.tasks.push(blankTask(kind(), isYear ? { months: [] } : { start: `${ym}-01`, end: '' }));
            setDirty(true); renderTasks(); renderSummary();
        });
        $('#wp-save')?.addEventListener('click', async () => { try { await saveDoc(); await render(); } catch (e) { alert(e.message); } });
        $('#wp-del')?.addEventListener('click', async () => {
            if (!confirm(`${periodLabel()} ${isYear ? '연간' : '월간'} 업무추진계획서를 삭제할까요?`)) return;
            try { await deleteWorkPlan(doc.id); setDirty(false); showToast('🗑️ 업무추진계획서를 삭제했습니다.'); await render(); } catch (e) { alert(e.message); }
        });
        $('#wp-imp-year')?.addEventListener('click', importFromYear);
        $('#wp-carry')?.addEventListener('click', carryFromPrev);
        $('#wp-print').addEventListener('click', printDoc);
    };

    const saveDoc = async () => {
        doc.tasks = doc.tasks.filter(t => (t.title || '').trim() || (t.detail || '').trim());
        doc.kpis = doc.kpis.filter(k => (k.name || '').trim());
        doc.tasks.forEach(t => { t.progress = clampPct(t.progress); if (t.progress >= 100 && t.status !== 'HOLD') t.status = 'DONE'; });
        doc.author = doc.author || state.currentGlobalWorker || '';
        doc = await saveWorkPlan(doc);
        doc.tasks ||= []; doc.kpis ||= [];
        setDirty(false);
        showToast('💾 업무추진계획서를 저장했습니다.');
    };

    // 연간 계획에서 이 달에 추진할 과제 → 월간 과제 (이미 불러온 과제는 건너뜀)
    const importFromYear = async () => {
        try {
            const y = ym.slice(0, 4), m = Number(ym.slice(5, 7));
            const yd = await loadWorkPlan('WORK_YEAR', y);
            const cands = (yd.tasks || []).filter(t => t.title && (t.months || []).includes(m) && t.status !== 'DONE');
            const fresh = cands.filter(t => !doc.tasks.some(x => x.yearRef === t.id));
            if (!yd.createdAt) { alert(`${y}년 연간 업무추진계획서가 아직 없습니다. [연간 업무추진계획서]에서 먼저 작성하세요.`); return; }
            if (!fresh.length) { alert(cands.length ? '이 달에 추진할 연간 과제를 이미 모두 불러왔습니다.' : `${y}년 연간 계획에 ${m}월 추진 과제가 없습니다. (연간 계획의 '추진 월'에 ${m}월을 체크하세요)`); return; }
            if (!confirm(`연간 과제 ${fresh.length}건을 이 달 계획에 넣을까요?\n\n${fresh.map(t => `· ${t.title}${t.owner ? ` (${t.owner})` : ''}`).join('\n')}`)) return;
            const lastDay = new Date(Number(y), m, 0).getDate();
            fresh.forEach(t => doc.tasks.push({ ...blankTask('WORK_MONTH'), yearRef: t.id, category: t.category, title: t.title, detail: t.detail, dept: t.dept, owner: t.owner, target: t.target, start: `${ym}-01`, end: `${ym}-${String(lastDay).padStart(2, '0')}`, progress: Number(t.progress) || 0, status: 'WORK' }));
            setDirty(true); renderTasks(); renderSummary();
            showToast(`📥 연간 과제 ${fresh.length}건을 불러왔습니다. 저장하세요.`);
        } catch (e) { alert(e.message); }
    };

    // 전월 계획의 미완료 과제 → 이 달로 이월 (진행률·실적 유지)
    const carryFromPrev = async () => {
        try {
            const pm = prevMonth(ym);
            const pd = await loadWorkPlan('WORK_MONTH', pm);
            const open = (pd.tasks || []).filter(t => t.title && !['DONE', 'HOLD'].includes(effectiveStatus(t)));
            const fresh = open.filter(t => !doc.tasks.some(x => x.carriedId === t.id || (t.yearRef && x.yearRef === t.yearRef)));
            if (!fresh.length) { alert(open.length ? '전월 미완료 과제를 이미 모두 이월했습니다.' : `${pm.replace('-', '년 ')}월 계획에 이월할 미완료 과제가 없습니다.`); return; }
            if (!confirm(`${pm.replace('-', '년 ')}월 미완료 과제 ${fresh.length}건을 이월할까요?\n\n${fresh.map(t => `· ${t.title} (${clampPct(t.progress)}%)`).join('\n')}`)) return;
            fresh.forEach(t => doc.tasks.push({ ...t, id: blankTask('WORK_MONTH').id, carriedId: t.id, carriedFrom: `${Number(pm.slice(5))}월`, status: 'WORK', start: t.start && t.start >= `${ym}-01` ? t.start : `${ym}-01`, end: t.end && t.end >= `${ym}-01` ? t.end : '' }));
            setDirty(true); renderTasks(); renderSummary();
            showToast(`↪️ 미완료 과제 ${fresh.length}건을 이월했습니다. 완료 예정일을 확인하고 저장하세요.`);
        } catch (e) { alert(e.message); }
    };

    // ---------- A4 가로 인쇄 ----------
    const printDoc = async () => {
        const isYear = view === 'year';
        const tasks = doc.tasks.filter(t => t.title);
        const s = summarizeTasks(tasks);
        const pre = (v) => `<div class="notes">${esc(v || '')}</div>`;
        const kpiRows = (doc.kpis || []).filter(k => k.name);
        const kpiHtml = kpiRows.length ? `<table class="grid"><colgroup><col style="width:8mm"><col><col style="width:16mm"><col style="width:26mm"><col style="width:26mm"><col style="width:18mm"><col style="width:50mm"></colgroup>
            <thead><tr><th>No</th><th>성과지표</th><th>단위</th><th>목표</th><th>실적</th><th>달성률</th><th>비고</th></tr></thead>
            <tbody>${kpiRows.map((k, i) => `<tr><td class="c">${i + 1}</td><td>${esc(k.name)}</td><td class="c">${esc(k.unit || '')}</td><td class="r">${esc(k.target ?? '')}</td><td class="r">${esc(k.actual ?? '')}</td><td class="c">${Number(k.target) ? `${((Number(k.actual) || 0) / Number(k.target) * 100).toFixed(1)}%` : '-'}</td><td>${esc(k.note || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="notes">-</div>';
        const monthHead = Array.from({ length: 12 }, (_, i) => `<th style="width:6.5mm">${i + 1}</th>`).join('');
        const taskHtml = `<table class="grid"><thead><tr><th style="width:8mm">No</th><th style="width:15mm">구분</th><th>추진과제 / 세부 추진내용</th><th style="width:18mm">주관부서</th><th style="width:15mm">담당</th>
            ${isYear ? monthHead : '<th style="width:26mm">추진 일정</th>'}<th style="width:32mm">목표·성과지표</th><th style="width:13mm">진행률</th><th style="width:12mm">상태</th><th style="width:${isYear ? 38 : 50}mm">추진실적</th></tr></thead>
            <tbody>${tasks.length ? tasks.map((t, i) => `<tr><td class="c">${i + 1}</td><td class="c">${esc(t.category || '')}</td><td><b>${esc(t.title)}</b>${t.detail ? `<br><span style="color:#555">${esc(t.detail)}</span>` : ''}</td><td class="c">${esc(t.dept || '')}</td><td class="c">${esc(t.owner || '')}</td>
                ${isYear ? Array.from({ length: 12 }, (_, m) => `<td class="c">${(t.months || []).includes(m + 1) ? '●' : ''}</td>`).join('') : `<td class="c">${esc(t.start || '')}${t.end ? `<br>~ ${esc(t.end)}` : ''}</td>`}
                <td>${esc(t.target || '')}</td><td class="c">${clampPct(t.progress)}%</td><td class="c">${WORK_STATUS[effectiveStatus(t)]}</td><td>${esc(t.result || '')}${t.note ? `<br><span style="color:#666">${esc(t.note)}</span>` : ''}</td></tr>`).join('')
                : `<tr><td colspan="${isYear ? 21 : 10}" class="c">추진과제 없음</td></tr>`}</tbody></table>`;
        await printA4({
            title: `${isYear ? '연간' : '월간'} 업무추진계획서`, subtitle: isYear ? 'ANNUAL BUSINESS PLAN' : 'MONTHLY BUSINESS PLAN', landscape: true, approvalKey: apprKey(),
            meta: [['기간', periodLabel()], ['작성자', doc.author || state.currentGlobalWorker || ''], ['추진과제', `${s.total}건`], ['완료', `${s.count.DONE}건`], ['지연', `${s.count.DELAY}건`], ['평균 진행률', `${s.avg.toFixed(0)}%`]],
            bodyHtml: `<h2>1. ${isYear ? '경영 목표 · 추진 방침' : '이달의 중점 목표'}</h2>${pre(doc.goal)}
                <h2>2. 성과지표 (KPI)</h2>${kpiHtml}
                <h2>3. 추진과제</h2>${taskHtml}
                <h2>4. ${isYear ? '연간 추진 실적 · 평가' : '실적 검토 · 이슈 및 대책'}</h2>${pre(doc.review)}
                ${doc.notes ? `<h2>5. 비고 · 협조 요청</h2>${pre(doc.notes)}` : ''}`
        });
    };

    render();
};
