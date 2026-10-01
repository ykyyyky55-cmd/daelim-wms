// ==========================================
// '확인할 일' 공용 계산 (종합현황판 components/OverviewBoard.js · 아침 알림 services/morningDigest.js)
// ==========================================
// loadDigestData: 클라우드 자료(주문·품질·최신 스케줄·생산/구매요청서)를 한 번에 받는다 (하나가 실패해도 나머지는 씀).
// buildAlerts: 급한 것(red)·주의(amber)·참고(info) 목록. 권한이 없는 화면의 항목은 넣지 않는다.
import { state } from './db.js';
import { canAccessTab, baseRole } from './auth.js';
import { localDateStr } from './searchUtils.js';
import { listPlans, addDays } from './plans.js';
import { listProdDates, listProdSchedule } from './prodSchedule.js';
import { loadOrderData } from './orders.js';
import { loadQcBoardData, computeQcSummary } from './qcBoardData.js';
import { computeStockDiff } from './stockCheck.js';
import { listFeedback } from './feedback.js';

const isManagerRole = () => ['MASTER', 'ADMIN', 'MANAGER'].includes(baseRole(state.currentUser?.role));

export const loadDigestData = async () => {
    const today = localDateStr();
    const [orders, qc, sched, reqs, preqs, feedback] = await Promise.allSettled([
        canAccessTab('orderBoard') ? loadOrderData({ from: addDays(today, -365) }) : Promise.resolve(null),
        canAccessTab('qcBoard') ? loadQcBoardData() : Promise.resolve(null),
        canAccessTab('prodSchedule') ? listProdDates().then(async d => (d[0] ? { date: d[0].date, rows: await listProdSchedule(d[0].date) } : null)) : Promise.resolve(null),
        canAccessTab('prodRequest') ? listPlans('PROD_REQ', addDays(today, -365), '9999') : Promise.resolve([]),
        canAccessTab('purchRequest') ? listPlans('PURCH_REQ', addDays(today, -365), '9999') : Promise.resolve([]),
        // 의견·개선 요청은 처리하는 매니저 이상에게만 (services/feedback.js)
        isManagerRole() ? listFeedback() : Promise.resolve([])
    ]);
    const val = (r) => (r.status === 'fulfilled' ? r.value : null);
    return {
        orders: val(orders), qc: val(qc), sched: val(sched), reqs: val(reqs) || [], preqs: val(preqs) || [], feedback: val(feedback) || [],
        errors: [orders, qc, sched, reqs, preqs, feedback].filter(r => r.status === 'rejected').map(r => r.reason?.message || String(r.reason))
    };
};

const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });

/** @returns {{ level: 'red'|'amber'|'info', group: string, text: string, go: string }[]} */
export const buildAlerts = (data, { ym = localDateStr().slice(0, 7) } = {}) => {
    const today = localDateStr();
    const out = [];
    const add = (level, group, text, go) => out.push({ level, group, text, go });
    // 주문
    (data?.orders?.orders || []).filter(o => !o.raw && o.overdue).sort((a, b) => a.daysLeft - b.daysLeft)
        .forEach(o => add('red', '주문', `주문 납기 지남 D+${-o.daysLeft} · ${o.docNo} ${o.r.partner || ''} (${o.stage})`, 'orderBoard'));
    (data?.orders?.orders || []).filter(o => !o.raw && o.state === 'OPEN' && o.daysLeft !== null && o.daysLeft >= 0 && o.daysLeft <= 2)
        .forEach(o => add('amber', '주문', `주문 납기 ${o.daysLeft === 0 ? '오늘' : `D-${o.daysLeft}`} · ${o.docNo} ${o.r.partner || ''} (${o.stage})`, 'orderBoard'));
    // 스케줄
    (data?.sched?.rows || []).filter(r => !['DONE', 'SHIPPED'].includes(r.status) && r.dueDate && r.dueDate < today)
        .forEach(r => add('red', '스케줄', `스케줄 납기 지남 · ${r.partner || ''} ${r.itemName} (${r.dueDate.slice(5)})`, 'prodSchedule'));
    // 품질
    if (data?.qc) {
        const Q = computeQcSummary(data.qc, { ym });
        Q.ncrLate.forEach(r => add('red', '품질', `부적합 조치기한 지남 · ${r.itemName || ''} (~${String(r.dueDate).slice(5)})`, 'qcBoard'));
        Q.docNg.forEach(x => add('red', '품질', `${x.kind} 부적합(NG) · ${x.r.productName || x.r.itemName || x.r.title || ''}`, 'qcBoard'));
        Q.eqLate.forEach(e => add('red', '설비', `설비 점검 ${-e.left}일 지남 · ${e.name}`, 'qcEquipment'));
        Q.msLate.forEach(m => add('amber', '품질', `MSDS 검토일 지남 · ${m.productName || m.itemName || m.name || ''}`, 'qcMsds'));
    }
    // 재고
    if (canAccessTab('inventory')) {
        const byCode = new Map();
        (state.inventory || []).forEach(i => byCode.set(i.code, (byCode.get(i.code) || 0) + (Number(i.quantity) || 0)));
        state.master.filter(m => Number(m.safety) > 0 && (byCode.get(m.code) || 0) < Number(m.safety))
            .forEach(m => add('amber', '재고', `안전재고 미달 · ${m.name} (${fmt(byCode.get(m.code) || 0)} / ${fmt(m.safety)} ${m.unit || ''})`, 'inventory'));
    }
    if (canAccessTab('stockCheck')) {
        try {
            const n = computeStockDiff().filter(r => Math.abs(r.diff) > 0.01).length;
            if (n) add('amber', '재고', `수불부·창고 재고 차이 ${n}건`, 'stockCheck');
        } catch { /* 계산 실패는 건너뜀 */ }
    }
    // 요청서
    (data?.preqs || []).filter(r => r.docNo && !['DONE', 'REJECTED'].includes(r.status) && r.dueDate && r.dueDate < today)
        .forEach(r => add('amber', '요청서', `구매요청 필요일 지남 · ${r.docNo} ${(r.lines || [])[0]?.name || ''}`, 'purchRequest'));
    const newReq = (data?.reqs || []).filter(r => r.docNo && r.status === 'REQUESTED').length;
    if (newReq) add('info', '요청서', `접수 안 된 생산요청서 ${newReq}건`, 'prodRequest');
    // 의견·개선 요청 (매니저 이상만 data.feedback이 있음)
    const openBugs = (data?.feedback || []).filter(f => f.kind === 'BUG' && ['NEW', 'ACCEPTED', 'WORK'].includes(f.status)).length;
    if (openBugs) add('amber', '의견', `처리 중인 오류 신고 ${openBugs}건`, 'feedback');
    const newFb = (data?.feedback || []).filter(f => f.status === 'NEW').length;
    if (newFb) add('info', '의견', `검토 전 의견·개선 요청 ${newFb}건`, 'feedback');
    // 일정
    if (canAccessTab('calendar')) {
        const todayList = (state.schedules || []).filter(s => s.date === today);
        if (todayList.length) add('info', '일정', `오늘 일정 ${todayList.length}건: ${todayList.slice(0, 3).map(s => s.title).join(' / ')}${todayList.length > 3 ? ' …' : ''}`, 'calendar');
    }
    return out;
};
