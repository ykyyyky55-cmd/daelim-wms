// ==========================================
// 품질관리 현황판 자료 (현황판 components/quality/QualityBoard.js · 홈 위젯 components/quality/QcBoardWidget.js 공용)
// ==========================================
import { listQc, getDefectConfig, summarize, nextCheckDate, daysUntil, msdsReviewDate } from './quality.js';
import { siteOf } from './qcStandards.js';
import { localDateStr } from './searchUtils.js';

export const QC_BOARD_AREAS = ['PRODUCT', 'PROCESS', 'MATERIAL'];
export const ymAdd = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** 품질 기록 전부 + 영역별 목표 불량률 */
export const loadQcBoardData = async () => {
    const [inspect, ncr, tr, coa, pcheck, equips, logs, msds, ...cfg] = await Promise.all([
        listQc('INSPECT'), listQc('NCR'), listQc('TEST_REPORT'), listQc('COA'), listQc('PCHECK'), listQc('EQUIP'), listQc('EQUIP_LOG'), listQc('MSDS'),
        ...QC_BOARD_AREAS.map(a => getDefectConfig(a))
    ]);
    const targets = Object.fromEntries(QC_BOARD_AREAS.map((a, i) => [a, cfg[i]?.target]));
    return { inspect, ncr, tr, coa, pcheck, equips, logs, msds, targets };
};

/** 한 달 요약 (site: '' 전체 | HQ | GIMPO) */
export const computeQcSummary = (data, { ym = localDateStr().slice(0, 7), site = '' } = {}) => {
    const today = localDateStr();
    const inSite = (r) => !site || siteOf(r) === site;
    const insp = data.inspect.filter(inSite);
    const ofMonth = (m, area) => insp.filter(r => String(r.date).startsWith(m) && (!area || r.area === area));
    const prevYm = ymAdd(ym, -1);
    const months = Array.from({ length: 6 }, (_, i) => ymAdd(ym, i - 5));
    const ncrOpen = data.ncr.filter(r => inSite(r) && r.status !== 'CLOSED');
    const equips = data.equips.filter(e => e.status !== 'DISPOSED' && inSite(e)).map(e => { const next = nextCheckDate(e, data.logs); return { ...e, next, left: daysUntil(next) }; });
    const msds = data.msds.map(m => { const rv = msdsReviewDate(m); return { ...m, rv, left: daysUntil(rv) }; });
    const inMonth = (r) => inSite(r) && String(r.date).startsWith(ym);
    return {
        ym, today,
        cur: summarize(ofMonth(ym)), prev: summarize(ofMonth(prevYm)),
        area: Object.fromEntries(QC_BOARD_AREAS.map(a => [a, summarize(ofMonth(ym, a))])),
        areaPrev: Object.fromEntries(QC_BOARD_AREAS.map(a => [a, summarize(ofMonth(prevYm, a))])),
        months, trend: months.map(m => ({ m, all: summarize(ofMonth(m)), ...Object.fromEntries(QC_BOARD_AREAS.map(a => [a, summarize(ofMonth(m, a))])) })),
        targets: data.targets,
        ncrOpen: ncrOpen.sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))),
        ncrLate: ncrOpen.filter(r => r.dueDate && r.dueDate < today),
        ncrMonth: data.ncr.filter(inMonth),
        docNg: [...data.tr.filter(r => inMonth(r) && r.overall === 'NG').map(r => ({ kind: '시험성적서', r, tab: 'qcProduct', area: 'PRODUCT', sub: 'testReport' })),
            ...data.coa.filter(r => String(r.date).startsWith(ym) && r.overall === 'NG').map(r => ({ kind: 'COA', r, tab: 'qcMaterial', area: 'MATERIAL', sub: 'coa' })),
            ...data.pcheck.filter(r => inMonth(r) && (r.items || []).some(it => it.result === 'NG')).map(r => ({ kind: '공정 점검표', r, tab: 'qcProcess', area: 'PROCESS', sub: 'pcheck' }))],
        docCount: { tr: data.tr.filter(inMonth).length, coa: data.coa.filter(r => String(r.date).startsWith(ym)).length, pcheck: data.pcheck.filter(inMonth).length },
        equips, eqLate: equips.filter(e => e.left !== null && e.left < 0).sort((a, b) => a.left - b.left),
        eqSoon: equips.filter(e => e.left !== null && e.left >= 0 && e.left <= 30).sort((a, b) => a.left - b.left),
        eqDown: equips.filter(e => e.status === 'STOP' || e.status === 'REPAIR'),
        msds, msLate: msds.filter(m => m.left !== null && m.left < 0), msSoon: msds.filter(m => m.left !== null && m.left >= 0 && m.left <= 90),
        fails: insp.filter(r => r.result === 'FAIL' || r.result === 'COND').slice(0, 6)
    };
};

/** 품질 화면의 하위 보기를 골라 연다 (QualityDefects의 daelim_qc_view) */
export const openQcView = (onSwitchTab, tab, area, sub) => {
    if (area && sub) { try { const v = JSON.parse(localStorage.getItem('daelim_qc_view') || '{}'); v[area] = sub; localStorage.setItem('daelim_qc_view', JSON.stringify(v)); } catch { /* 무시 */ } }
    onSwitchTab(tab);
};
