// ==========================================
// 홈 대시보드 위젯: 품질관리 현황판 요약 (위젯 id 'qcBoard', components/Dashboard.js가 그린 뒤 채운다)
// ==========================================
// 계산은 현황판과 같은 services/qcBoardData.js. 차트 라이브러리 없이(홈을 가볍게) 6개월 추이는 작은 SVG 선으로 그린다.
// 홈은 자동 갱신으로 자주 다시 그려지므로 자료는 2분 동안 다시 받지 않는다.
import { createIcons, icons } from '../../services/icons.js';
import { esc } from '../../services/html.js';
import { QC_AREAS, fmtRate, fmtPpm } from '../../services/quality.js';
import { QC_SITES } from '../../services/qcStandards.js';
import { loadQcBoardData, computeQcSummary, openQcView, QC_BOARD_AREAS } from '../../services/qcBoardData.js';

const COLOR = { PRODUCT: '#2563eb', PROCESS: '#7c3aed', MATERIAL: '#ea580c' };
const SITE_KEY = 'daelim_qc_widget_site';
let cache = { at: 0, data: null, promise: null };
const getData = async (force = false) => {
    if (!force && cache.data && Date.now() - cache.at < 120000) return cache.data;
    if (cache.promise) return cache.promise;
    cache.promise = loadQcBoardData().then(d => { cache = { at: Date.now(), data: d, promise: null }; return d; }).catch(e => { cache.promise = null; throw e; });
    return cache.promise;
};

// 6개월 불량률 작은 선 그래프
const spark = (vals, color) => {
    const pts = vals.map((v, i) => ({ i, v })).filter(p => p.v !== null);
    if (pts.length < 2) return '<div class="h-8 flex items-center text-[10px] text-slate-300">추이 없음</div>';
    const max = Math.max(...pts.map(p => p.v), 0.01);
    const x = (i) => (i / (vals.length - 1)) * 116 + 2;
    const y = (v) => 30 - (v / max) * 26;
    const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 120 32" class="w-full h-8" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${x(last.i)}" cy="${y(last.v)}" r="2.5" fill="${color}"/></svg>`;
};

/** 위젯 자리(host)에 요약을 채운다 */
export const mountQcBoardWidget = async (host, { onSwitchTab = () => {}, force = false } = {}) => {
    if (!host) return;
    let site = '';
    try { site = QC_SITES[localStorage.getItem(SITE_KEY)] ? localStorage.getItem(SITE_KEY) : ''; } catch { /* 무시 */ }
    let data;
    try { data = await getData(force); } catch (e) {
        host.innerHTML = `<div class="p-4 text-xs font-bold text-rose-600">품질 기록을 불러오지 못했습니다: ${esc(e.message)}</div>`;
        return;
    }
    if (!host.isConnected) return;
    const draw = () => {
        const S = computeQcSummary(data, { site });
        const { cur, prev, area, targets, ncrOpen, ncrLate, docNg, eqLate, eqSoon, msLate, msSoon, fails, trend } = S;
        const d = cur.count && prev.count ? cur.rate - prev.rate : null;
        const kpi = (label, value, sub, cls, go) => `<button type="button" data-go="${go}" class="qw-go text-left p-2.5 rounded-xl bg-slate-50 hover:bg-emerald-50 border border-slate-100"><div class="text-[10px] font-bold text-slate-500">${label}</div><div class="text-lg font-black leading-tight ${cls}">${value}</div><div class="text-[10px] text-slate-500 truncate">${sub}</div></button>`;
        // 확인이 필요한 일 (급한 순)
        const alerts = [
            ...ncrLate.map(r => ({ t: `부적합 조치기한 지남 · ${r.itemName || ''} (~${String(r.dueDate).slice(5)})`, go: `ncr:${r.area || 'PRODUCT'}`, red: true })),
            ...docNg.map(x => ({ t: `${x.kind} 부적합(NG) · ${x.r.productName || x.r.itemName || x.r.title || x.r.line || x.r.place || (x.sub === 'pcheck' ? (x.r.stage === 'BLEND' ? '원액생산' : '완제품포장') : '')}`, go: `sub:${x.tab}:${x.area}:${x.sub}`, red: true })),
            ...eqLate.map(e => ({ t: `설비 점검 ${-e.left}일 지남 · ${e.name}`, go: 'qcEquipment', red: true })),
            ...msLate.map(m => ({ t: `MSDS 검토일 지남 · ${m.productName || m.itemName || m.name || ''}`, go: 'qcMsds', red: true })),
            ...fails.filter(r => r.result === 'FAIL' && String(r.date).startsWith(S.ym)).map(r => ({ t: `${QC_AREAS[r.area]?.label || ''} 불합격 · ${r.itemName || r.itemCode || ''} (${String(r.date).slice(5)})`, go: QC_AREAS[r.area]?.tab || 'qcProduct', red: false })),
            ...eqSoon.slice(0, 3).map(e => ({ t: `설비 점검 ${e.left === 0 ? '오늘' : `${e.left}일 남음`} · ${e.name}`, go: 'qcEquipment', red: false }))
        ];
        host.innerHTML = `
        <div class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3 h-full">
            <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                <div class="flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><i data-lucide="shield-check" class="w-4 h-4"></i></div>
                    <h3 class="font-black text-slate-800 text-sm">품질관리 현황판 <span class="text-xs font-bold text-slate-400">${Number(S.ym.slice(5))}월</span></h3></div>
                <div class="flex items-center gap-1.5">
                    <select class="qw-site border border-slate-200 rounded-lg px-1.5 py-1 text-[11px] font-bold">${[['', '전체'], ...Object.entries(QC_SITES)].map(([k, l]) => `<option value="${k}" ${k === site ? 'selected' : ''}>${l}</option>`).join('')}</select>
                    <button type="button" data-go="qcBoard" class="qw-go text-xs text-emerald-700 font-bold hover:underline whitespace-nowrap">현황판 &rarr;</button>
                </div>
            </div>
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
                ${kpi('이달 불량률', cur.count ? fmtRate(cur.rate) : '-', d === null ? `검사 ${cur.count}건` : `<span class="${d > 0 ? 'text-rose-600' : 'text-emerald-600'} font-bold">전월 ${d > 0 ? '▲' : d < 0 ? '▼' : '='}${Math.abs(d).toFixed(2)}%p</span> · ${fmtPpm(cur.defect, cur.inspected)} PPM`, 'text-emerald-700', 'qcBoard')}
                ${kpi('부적합 미결', `${ncrOpen.length}건`, ncrLate.length ? `<span class="text-rose-600 font-bold">기한 지남 ${ncrLate.length}</span>` : '기한 지남 없음', ncrLate.length ? 'text-rose-600' : 'text-amber-600', 'ncr:PRODUCT')}
                ${kpi('설비 점검', `${eqLate.length}건 지남`, `30일 안 ${eqSoon.length}건`, eqLate.length ? 'text-rose-600' : 'text-slate-800', 'qcEquipment')}
                ${kpi('MSDS 검토', `${msLate.length}건 지남`, `90일 안 ${msSoon.length}건`, msLate.length ? 'text-rose-600' : 'text-slate-800', 'qcMsds')}
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                ${QC_BOARD_AREAS.map(a => {
                    const s = area[a], t = targets[a];
                    const over = s.count && t !== undefined && s.rate > t;
                    return `<button type="button" data-go="${QC_AREAS[a].tab}" class="qw-go text-left p-2.5 rounded-xl border ${over ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200'} hover:border-emerald-300">
                        <div class="flex items-center justify-between"><span class="text-[11px] font-black" style="color:${COLOR[a]}">${QC_AREAS[a].label}</span>${s.count ? `<span class="text-[9px] font-black px-1 rounded ${over ? 'bg-rose-600 text-white' : 'bg-emerald-100 text-emerald-700'}">${over ? '목표 초과' : '목표 이내'}</span>` : ''}</div>
                        <div class="flex items-end justify-between gap-2"><span class="text-base font-black text-slate-900">${s.count ? fmtRate(s.rate) : '-'}</span><span class="text-[10px] text-slate-400">목표 ${t ?? '-'}%</span></div>
                        ${spark(trend.map(m => (m[a].count ? m[a].rate : null)), COLOR[a])}
                        <div class="text-[10px] text-slate-500">검사 ${s.count}건 · 불량 ${s.defect.toLocaleString('ko-KR')} · 불합격 ${s.fail}</div>
                    </button>`;
                }).join('')}
            </div>
            <div>
                <div class="text-[11px] font-black text-slate-600 mb-1">확인할 일 ${alerts.length ? `<span class="text-rose-600">${alerts.length}</span>` : ''}</div>
                ${alerts.length ? `<div class="space-y-1">${alerts.slice(0, 6).map(x => `<button type="button" data-go="${x.go}" class="qw-go w-full text-left text-[11px] px-2 py-1.5 rounded-lg truncate ${x.red ? 'bg-rose-50 text-rose-800 font-bold' : 'bg-slate-50 text-slate-700'}">${x.red ? '⚠️' : '•'} ${esc(x.t)}</button>`).join('')}${alerts.length > 6 ? `<div class="text-[10px] text-slate-400 px-2">외 ${alerts.length - 6}건 — 현황판에서 확인</div>` : ''}</div>`
                    : '<div class="text-[11px] text-emerald-700 font-bold px-2 py-1.5 bg-emerald-50 rounded-lg">✅ 급하게 확인할 품질 항목이 없습니다.</div>'}
            </div>
        </div>`;
        host.querySelector('.qw-site').addEventListener('change', (e) => { site = e.target.value; try { localStorage.setItem(SITE_KEY, site); } catch { /* 무시 */ } draw(); });
        host.querySelectorAll('.qw-go').forEach(b => b.addEventListener('click', () => {
            const g = b.dataset.go;
            if (g.startsWith('ncr:')) { const a = g.slice(4); return openQcView(onSwitchTab, QC_AREAS[a]?.tab || 'qcProduct', a, 'ncr'); }
            if (g.startsWith('sub:')) { const [, tab, a, sub] = g.split(':'); return openQcView(onSwitchTab, tab, a, sub); }
            onSwitchTab(g);
        }));
        createIcons({ icons });
    };
    draw();
};
