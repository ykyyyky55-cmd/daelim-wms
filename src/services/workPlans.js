// ==========================================
// 생산관리 → 업무추진계획서 (월간 WORK_MONTH · 연간 WORK_YEAR)
// ==========================================
// 문서는 wms_plans(supabase/auth/38_work_plans.sql)에 한 달(period YYYY-MM)·한 해(period YYYY)마다 하나.
//   { goal: 중점 목표·방침, kpis: [{ name, unit, target, actual }], tasks: [...], review: 실적 검토·이슈, notes, author }
//   월간 과제: { id, yearRef, category, title, detail, dept, owner, start, end, target, progress(0~100), status, result, note }
//   연간 과제: { id, category, title, detail, dept, owner, target, months: [1..12], progress, status, result, note }
// 월간 과제는 연간 과제(yearRef)에서 불러오거나 전월 미완료 과제를 이월한다. 연간 화면은 월간 진행률을 모아 보여 준다.
import { state } from './db.js';
import { listPlans, getPlan, savePlan, deletePlan, planId } from './plans.js';
import { localDateStr } from './searchUtils.js';

export const WORK_STATUS = { PLAN: '계획', WORK: '진행', DONE: '완료', DELAY: '지연', HOLD: '보류' };
export const WORK_STATUS_COLOR = { PLAN: 'slate', WORK: 'blue', DONE: 'emerald', DELAY: 'rose', HOLD: 'amber' };
export const WORK_CATEGORIES = ['생산', '품질', '구매·자재', '물류·출하', '설비·보전', '안전·환경', '원가·개선', '영업지원', '인사·교육', '전산·시스템', '기타'];

export const newTaskId = () => `WT-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
export const blankTask = (kind, extra = {}) => ({
    id: newTaskId(), category: '생산', title: '', detail: '', dept: '', owner: '', target: '', progress: 0, status: 'PLAN', result: '', note: '',
    ...(kind === 'WORK_YEAR' ? { months: [] } : { start: '', end: '', yearRef: '' }), ...extra
});
export const blankWorkPlan = (kind, period) => ({ id: planId(kind, period), kind, period, goal: '', kpis: [], tasks: [], review: '', notes: '', author: state.currentGlobalWorker || '' });
export const loadWorkPlan = async (kind, period) => (await getPlan(kind, period)) || blankWorkPlan(kind, period);
export { savePlan as saveWorkPlan, deletePlan as deleteWorkPlan };

export const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const nextMonth = (ym) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

// 기한이 지났는데 완료·보류가 아니면 '지연'으로 본다 (저장 값은 그대로, 화면·집계에서만)
export const effectiveStatus = (t, today = localDateStr()) => {
    if (t.status === 'DONE' || t.status === 'HOLD') return t.status;
    if (Number(t.progress) >= 100) return 'DONE';
    if (t.end && t.end < today) return 'DELAY';
    return t.status || 'PLAN';
};

// 과제 목록 요약
export const summarizeTasks = (tasks) => {
    const list = (tasks || []).filter(t => t.title);
    const count = Object.fromEntries(Object.keys(WORK_STATUS).map(k => [k, 0]));
    list.forEach(t => { count[effectiveStatus(t)]++; });
    const avg = list.length ? list.reduce((s, t) => s + Math.min(100, Math.max(0, Number(t.progress) || 0)), 0) / list.length : 0;
    return { total: list.length, count, avg, doneRate: list.length ? (count.DONE / list.length) * 100 : 0 };
};

// 그 해의 월간 계획 모두 (연간 화면: 과제별 월 진행률)
export const loadYearMonths = async (year) => listPlans('WORK_MONTH', `${year}-01`, `${year}-12`);

// 연간 과제별 월간 연동 현황: { [yearTaskId]: { [month]: { progress, status } } }
export const yearTaskMonthly = (monthDocs) => {
    const out = {};
    for (const d of monthDocs) {
        const m = Number(String(d.period).slice(5, 7));
        for (const t of d.tasks || []) {
            if (!t.yearRef) continue;
            (out[t.yearRef] ||= {})[m] = { progress: Number(t.progress) || 0, status: effectiveStatus(t) };
        }
    }
    return out;
};
