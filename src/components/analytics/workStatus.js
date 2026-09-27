import { esc } from '../../services/html.js';
import { loadWorkPlan, summarizeTasks, effectiveStatus, WORK_STATUS, WORK_STATUS_COLOR } from '../../services/workPlans.js';

// 월간 실적 현황판 → 업무추진 계획 및 추진 현황 (생산관리 → 업무추진계획의 월간·연간 계획서를 읽어 보여 줌)
export const renderWorkStatus = async (host, ym) => {
    if (!host) return;
    host.innerHTML = '<div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-xs text-slate-400">업무추진 현황을 불러오는 중...</div>';
    try {
        const [monthDoc, yearDoc] = await Promise.all([loadWorkPlan('WORK_MONTH', ym), loadWorkPlan('WORK_YEAR', ym.slice(0, 4))]);
        if (!host.isConnected) return;
        host.innerHTML = workStatusHtml(ym, monthDoc, yearDoc);
        host.querySelector('#an-work-open')?.addEventListener('click', () => {
            window.__pendingPlanOpen = { tab: 'workPlan', view: 'month', date: `${ym}-01` };
            window.__switchTab?.('workPlan');
        });
    } catch (e) {
        host.innerHTML = `<div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-xs text-rose-600 font-bold">업무추진 현황을 불러오지 못했습니다: ${esc(e.message)}</div>`;
    }
};

const bar = (p, c = 'indigo') => `<div class="h-1.5 rounded-full bg-slate-200 overflow-hidden"><div class="h-full bg-${c}-500" style="width:${Math.min(100, Math.max(0, Number(p) || 0))}%"></div></div>`;
const badge = (s) => `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-black bg-${WORK_STATUS_COLOR[s]}-100 text-${WORK_STATUS_COLOR[s]}-700 whitespace-nowrap">${WORK_STATUS[s]}</span>`;

const workStatusHtml = (ym, monthDoc, yearDoc) => {
    const m = Number(ym.slice(5, 7));
    const tasks = (monthDoc.tasks || []).filter(t => t.title);
    const s = summarizeTasks(tasks);
    // 연간 과제 중 이 달 추진 예정인데 월간 계획에 없는 과제
    const yearTasks = (yearDoc.tasks || []).filter(t => t.title && (t.months || []).includes(m));
    const missing = yearTasks.filter(t => !tasks.some(x => x.yearRef === t.id) && t.status !== 'DONE');
    const kpis = (monthDoc.kpis || []).filter(k => k.name);
    const label = `${ym.replace('-', '년 ')}월`;
    const empty = !monthDoc.createdAt;
    return `
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="target" class="w-4 h-4 text-indigo-600"></i>업무추진 계획 및 추진 현황 · ${esc(label)}</h3>
                <button type="button" id="an-work-open" class="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 text-xs font-bold">업무추진계획서 열기 ›</button>
            </div>
            ${empty ? `<div class="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500">${esc(label)} 월간 업무추진계획서가 없습니다. <b>생산관리 → 업무추진계획</b>에서 작성하면 여기에 추진 현황이 나옵니다.${missing.length ? ` (연간 계획에 이 달 추진 과제 ${missing.length}건)` : ''}</div>` : `
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                ${[['추진과제', `${s.total}건`, 'slate'], ['완료', `${s.count.DONE}건 (${s.doneRate.toFixed(0)}%)`, 'emerald'], ['진행 중', `${s.count.WORK}건`, 'blue'], ['지연', `${s.count.DELAY}건`, s.count.DELAY ? 'rose' : 'slate'], ['평균 진행률', `${s.avg.toFixed(0)}%`, 'indigo']]
                    .map(([k, v, c]) => `<div class="p-3 rounded-xl bg-${c}-50 border border-${c}-200"><div class="text-[11px] font-bold text-${c}-700">${k}</div><div class="text-base font-black text-slate-900">${v}</div></div>`).join('')}
            </div>
            ${monthDoc.goal ? `<div class="p-3 rounded-xl bg-indigo-50/60 border border-indigo-100 text-xs"><b class="text-indigo-800">중점 목표</b><div class="mt-1 whitespace-pre-wrap text-slate-700">${esc(monthDoc.goal)}</div></div>` : ''}
            ${kpis.length ? `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">${kpis.map(k => {
                const rate = Number(k.target) ? (Number(k.actual) || 0) / Number(k.target) * 100 : null;
                return `<div class="p-3 rounded-xl border border-slate-200 text-xs"><div class="font-bold text-slate-600">${esc(k.name)}</div><div class="font-black text-slate-900 mt-0.5">${esc(k.actual ?? '-')} / ${esc(k.target ?? '-')} ${esc(k.unit || '')}</div>${rate === null ? '' : `<div class="mt-1">${bar(rate, rate >= 100 ? 'emerald' : 'indigo')}</div><div class="text-[10px] text-slate-500">달성률 ${rate.toFixed(1)}%</div>`}</div>`;
            }).join('')}</div>` : ''}
            <div class="overflow-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600"><tr><th class="p-2 text-left">구분</th><th class="p-2 text-left">추진과제</th><th class="p-2 text-left">담당</th><th class="p-2 text-center">일정</th><th class="p-2 text-left min-w-[120px]">진행률</th><th class="p-2 text-center">상태</th><th class="p-2 text-left">추진실적</th></tr></thead>
                <tbody class="divide-y divide-slate-100">${tasks.length ? tasks.map(t => {
                    const st = effectiveStatus(t);
                    return `<tr class="${st === 'DELAY' ? 'bg-rose-50/40' : ''}"><td class="p-2 text-slate-500 whitespace-nowrap">${esc(t.category || '')}</td><td class="p-2 font-bold">${esc(t.title)}${t.detail ? `<div class="text-[10px] font-normal text-slate-500">${esc(t.detail)}</div>` : ''}</td><td class="p-2 whitespace-nowrap">${esc([t.dept, t.owner].filter(Boolean).join(' · '))}</td><td class="p-2 text-center font-mono text-[11px] whitespace-nowrap">${esc((t.start || '').slice(5))}${t.end ? ` ~ ${esc(t.end.slice(5))}` : ''}</td><td class="p-2">${bar(t.progress, WORK_STATUS_COLOR[st])}<div class="text-[10px] font-mono text-slate-500">${Math.min(100, Math.max(0, Number(t.progress) || 0))}%</div></td><td class="p-2 text-center">${badge(st)}</td><td class="p-2 text-slate-600">${esc(t.result || '')}</td></tr>`;
                }).join('') : '<tr><td colspan="7" class="p-6 text-center text-slate-400">추진과제 없음</td></tr>'}</tbody></table>
            </div>
            ${monthDoc.review ? `<div class="p-3 rounded-xl bg-amber-50/60 border border-amber-200 text-xs"><b class="text-amber-800">실적 검토 · 이슈</b><div class="mt-1 whitespace-pre-wrap text-slate-700">${esc(monthDoc.review)}</div></div>` : ''}`}
            ${missing.length ? `<div class="text-[11px] text-amber-700 font-bold">⚠ 연간 계획상 ${m}월 추진 과제 중 월간 계획에 없는 과제: ${missing.map(t => esc(t.title)).join(', ')}</div>` : ''}
        </div>`;
};
