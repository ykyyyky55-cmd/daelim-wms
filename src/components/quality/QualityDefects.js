import Chart from 'chart.js/auto';
import { createIcons, icons } from '../../services/icons.js';
import { esc } from '../../services/html.js';
import { state } from '../../services/db.js';
import { localDateStr } from '../../services/searchUtils.js';
import { applyChartTheme } from '../../services/darkTheme.js';
import {
    QC_AREAS, QC_RESULTS, listQc, saveQc, deleteQc, getDefectConfig, saveDefectConfig, summarize, defectQtyOf,
    rateOf, fmtRate, fmtPpm, canWriteQc, canConfigQc, canDeleteQc
} from '../../services/quality.js';
import { attachItemPicker, printA4, printTableHtml, fmtQty, btn } from '../plans/planCommon.js';
import { mountAttachmentPanel } from '../AttachmentPanel.js';
import { mountApprovalBox } from '../approval/ApprovalBox.js';
import { countAttachments, removeAllAttachments } from '../../services/attachments.js';

// 품질관리 → 제품관리 / 공정관리 / 원부자재관리: 검사·불량 기록 + 불량률 현황(추이·파레토·품목/라인/공급처별) + 불량 유형·목표 설정
// 영역 설정은 services/quality.js QC_AREAS. 기록 하나 = 결재 문서(QC:<id>, 검사·검토·승인) + 첨부(불량 사진·성적서)
const QC_APPR_ROLES = ['검사', '검토', '승인'];
const RESULT_CLS = { PASS: 'bg-emerald-100 text-emerald-800', COND: 'bg-amber-100 text-amber-800', FAIL: 'bg-rose-600 text-white' };
const VIEW_KEY = 'daelim_qc_view';
const addMonths = (ymd, n) => { const d = new Date(`${ymd}T00:00:00`); d.setMonth(d.getMonth() + n); return localDateStr(d); };
const recApprDoc = (area, r) => ({ key: `QC:${r.id}`, type: `QC_${area}`, title: `${QC_AREAS[area].inspect} ${r.date} ${r.itemName || ''}${r.lot ? ` (${r.lot})` : ''}`, date: r.date, roles: QC_APPR_ROLES });

export const renderQualityArea = (container, { showToast = () => {}, area = 'PRODUCT' } = {}) => {
    const A = QC_AREAS[area];
    const canWrite = canWriteQc();
    let view = 'records';
    try { view = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}')[area] || 'records'; } catch { /* 기본 보기 */ }
    const today = localDateStr();
    const flt = { from: addMonths(`${today.slice(0, 7)}-01`, -5), to: today, q: '', result: '' }; // 기본 = 최근 6개월
    let records = [];
    let cfg = { types: [...A.defaultTypes], target: 0 };
    let shown = 100;
    let charts = [];
    const openId = window.__qcOpenId || '';
    window.__qcOpenId = null;

    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-emerald-700 flex items-center gap-1"><i data-lucide="shield-check" class="w-3.5 h-3.5"></i>품질관리 › ${esc(A.label)}</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="${A.icon}" class="w-5 h-5 text-emerald-600"></i>${esc(A.label)} · 불량률 관리</h2>
                    <p class="text-xs text-slate-500 mt-1">${esc(A.desc)} 불량률 = 불량수량 ÷ ${esc(A.unitLabel)} × 100.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    ${canWrite ? `<button type="button" id="qc-new" class="${btn('bg-emerald-600 hover:bg-emerald-700 text-white')}"><i data-lucide="plus" class="w-4 h-4"></i>${esc(A.inspect)} 기록</button>` : ''}
                    <button type="button" id="qc-xlsx" class="${btn('bg-white border border-slate-300 hover:bg-slate-50 text-slate-700')}"><i data-lucide="file-spreadsheet" class="w-4 h-4"></i>엑셀</button>
                    <button type="button" id="qc-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>불량률 보고서</button>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">
                    ${[['records', '검사·불량 기록', 'list'], ['stats', '불량률 현황', 'bar-chart-3'], ['config', '불량 유형·목표', 'settings-2']].map(([k, l, ic]) => `<button type="button" data-v="${k}" class="qc-v px-3 py-1.5 rounded-lg font-black flex items-center gap-1"><i data-lucide="${ic}" class="w-3.5 h-3.5"></i>${l}</button>`).join('')}
                </div>
                <span id="qc-flt" class="flex flex-wrap items-center gap-1.5">
                    <input type="date" id="qc-from" value="${flt.from}" class="border border-slate-300 rounded-lg px-2 py-1" /> ~
                    <input type="date" id="qc-to" value="${flt.to}" class="border border-slate-300 rounded-lg px-2 py-1" />
                    <select id="qc-range" class="border border-slate-300 rounded-lg px-1.5 py-1"><option value="">기간 빠른 선택</option><option value="m0">이번 달</option><option value="m1">지난달</option><option value="m3">최근 3개월</option><option value="m6">최근 6개월</option><option value="y0">올해</option><option value="y1">작년</option></select>
                    <input type="search" id="qc-q" placeholder="품목·LOT·${esc(A.groupLabel)} 검색" class="border border-slate-300 rounded-lg px-2 py-1 w-44" />
                    <select id="qc-result" class="border border-slate-300 rounded-lg px-1.5 py-1"><option value="">판정 전체</option>${Object.entries(QC_RESULTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
                </span>
            </div>
        </div>
        <div id="qc-body"></div>
    </section>
    <div id="qc-modal" class="hidden fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-3"></div>`;
    const $ = (s) => container.querySelector(s);

    const filtered = () => {
        const needle = flt.q.trim().toLowerCase();
        return records.filter(r => (!flt.from || r.date >= flt.from) && (!flt.to || r.date <= flt.to)
            && (!flt.result || r.result === flt.result)
            && (!needle || `${r.itemCode} ${r.itemName} ${r.lot} ${r[A.groupKey] || ''} ${r.inspector || ''}`.toLowerCase().includes(needle)));
    };
    const paintTabs = () => {
        container.querySelectorAll('.qc-v').forEach(b => { b.className = `qc-v px-3 py-1.5 rounded-lg font-black flex items-center gap-1 ${b.dataset.v === view ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`; });
        $('#qc-flt').classList.toggle('hidden', view === 'config');
    };
    const destroyCharts = () => { charts.forEach(c => c.destroy()); charts = []; };
    const reportApprDoc = () => ({ key: `QC:RPT-${area}:${flt.from}~${flt.to}`, type: 'QC_REPORT', title: `${A.label} 불량률 보고서 ${flt.from} ~ ${flt.to}`, date: flt.to, roles: ['작성', '검토', '승인'] });

    // ---------- 검사·불량 기록 ----------
    const renderRecords = async () => {
        const rows = filtered();
        const s = summarize(rows);
        const page = rows.slice(0, shown);
        const nAtt = await countAttachments(page.map(r => `QC:${r.id}`)).catch(() => new Map());
        $('#qc-body').innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-3 text-xs">
                <b class="text-slate-800">${rows.length.toLocaleString()}건</b>
                <span class="text-slate-500">${esc(A.unitLabel)} <b class="text-slate-800">${fmtQty(s.inspected)}</b></span>
                <span class="text-slate-500">불량 <b class="text-rose-600">${fmtQty(s.defect)}</b></span>
                <span class="text-slate-500">불량률 <b class="${s.rate > cfg.target && cfg.target > 0 ? 'text-rose-600' : 'text-emerald-700'}">${fmtRate(s.rate)}</b>${cfg.target ? ` <span class="text-slate-400">(목표 ${fmtRate(cfg.target)} 이하)</span>` : ''}</span>
                <span class="text-slate-500">불합격 <b class="text-rose-600">${s.fail}</b>건</span>
            </div>
            <div class="overflow-x-auto">
            <table class="w-full text-xs min-w-[980px]">
                <thead class="bg-slate-50 text-slate-600"><tr>
                    <th class="px-2 py-2 text-left">일자</th><th class="px-2 py-2 text-left">품목</th><th class="px-2 py-2 text-left">LOT</th><th class="px-2 py-2 text-left">${esc(A.groupLabel)}</th>
                    <th class="px-2 py-2 text-right">${esc(A.unitLabel)}</th><th class="px-2 py-2 text-right">불량</th><th class="px-2 py-2 text-right">불량률</th>
                    <th class="px-2 py-2 text-left">주요 불량</th><th class="px-2 py-2 text-center">판정</th><th class="px-2 py-2 text-left">조치</th><th class="px-2 py-2 text-left">검사자</th><th class="px-2 py-2 text-center">📎</th>
                </tr></thead>
                <tbody class="divide-y divide-slate-100">${page.length === 0 ? `<tr><td colspan="12" class="p-10 text-center text-slate-400">${records.length ? '조건에 맞는 기록이 없습니다.' : `아직 ${esc(A.inspect)} 기록이 없습니다.`}</td></tr>` : page.map(r => {
                    const def = defectQtyOf(r);
                    const rate = rateOf(def, Number(r.inspectedQty) || 0);
                    const top = (r.defects || []).filter(d => Number(d.qty) > 0).sort((a, b) => b.qty - a.qty).map(d => `${d.type} ${fmtQty(d.qty)}`).slice(0, 2).join(', ');
                    return `<tr class="qc-row hover:bg-emerald-50/40 cursor-pointer ${r.id === openId ? 'bg-emerald-50' : ''}" data-id="${esc(r.id)}">
                        <td class="px-2 py-1.5 whitespace-nowrap">${esc(r.date)}</td>
                        <td class="px-2 py-1.5"><div class="font-bold text-slate-800">${esc(r.itemName || '-')}</div><div class="text-[10px] text-slate-400 font-mono">${esc(r.itemCode || '')}</div></td>
                        <td class="px-2 py-1.5 font-mono">${esc(r.lot || '')}</td>
                        <td class="px-2 py-1.5">${esc(r[A.groupKey] || '')}</td>
                        <td class="px-2 py-1.5 text-right">${fmtQty(r.inspectedQty)} <span class="text-slate-400">${esc(r.unit || '')}</span></td>
                        <td class="px-2 py-1.5 text-right font-bold ${def > 0 ? 'text-rose-600' : 'text-slate-400'}">${fmtQty(def)}</td>
                        <td class="px-2 py-1.5 text-right font-bold ${cfg.target && rate > cfg.target ? 'text-rose-600' : ''}">${fmtRate(rate)}</td>
                        <td class="px-2 py-1.5 text-slate-600">${esc(top)}</td>
                        <td class="px-2 py-1.5 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${RESULT_CLS[r.result] || 'bg-slate-100 text-slate-600'}">${esc(QC_RESULTS[r.result] || '-')}</span></td>
                        <td class="px-2 py-1.5">${r.action ? `<span class="${r.actionDone ? 'text-emerald-700' : 'text-amber-700'} font-bold">${r.actionDone ? '✔ 완료' : '진행'}</span> <span class="text-slate-500">${esc(String(r.action).slice(0, 18))}</span>` : ''}</td>
                        <td class="px-2 py-1.5">${esc(r.inspector || r.by || '')}</td>
                        <td class="px-2 py-1.5 text-center text-blue-600 font-bold">${nAtt.get(`QC:${r.id}`) || ''}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table></div>
            ${rows.length > shown ? `<div class="p-3 text-center"><button type="button" id="qc-more" class="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold">더 보기 (${(rows.length - shown).toLocaleString()}건 남음)</button></div>` : ''}
        </div>`;
        $('#qc-more')?.addEventListener('click', () => { shown += 200; renderRecords(); });
        container.querySelectorAll('.qc-row').forEach(tr => tr.addEventListener('click', () => openEditor(records.find(r => r.id === tr.dataset.id))));
    };

    // ---------- 불량률 현황 ----------
    const renderStats = () => {
        const rows = filtered();
        const s = summarize(rows, { groupKey: A.groupKey });
        const over = cfg.target > 0 && s.rate > cfg.target;
        const card = (label, value, sub = '', cls = 'text-slate-900') => `<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><div class="text-[11px] font-bold text-slate-500">${label}</div><div class="text-xl font-black mt-1 ${cls}">${value}</div>${sub ? `<div class="text-[11px] text-slate-400 mt-0.5">${sub}</div>` : ''}</div>`;
        const rankTable = (title, list, label) => `
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <h3 class="text-sm font-black text-slate-800 mb-2">${title}</h3>
                <div class="overflow-x-auto"><table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600"><tr><th class="px-2 py-1.5 text-left">${label}</th><th class="px-2 py-1.5 text-right">건수</th><th class="px-2 py-1.5 text-right">${esc(A.unitLabel)}</th><th class="px-2 py-1.5 text-right">불량</th><th class="px-2 py-1.5 text-right">불량률</th><th class="px-2 py-1.5 w-28"></th></tr></thead>
                <tbody class="divide-y divide-slate-100">${list.length === 0 ? '<tr><td colspan="6" class="p-6 text-center text-slate-400">자료 없음</td></tr>' : list.slice(0, 15).map(o => `<tr>
                    <td class="px-2 py-1.5 font-bold text-slate-800">${esc(o.name)}</td><td class="px-2 py-1.5 text-right">${o.count}</td><td class="px-2 py-1.5 text-right">${fmtQty(o.inspected)}</td>
                    <td class="px-2 py-1.5 text-right text-rose-600 font-bold">${fmtQty(o.defect)}</td><td class="px-2 py-1.5 text-right font-black ${cfg.target && o.rate > cfg.target ? 'text-rose-600' : 'text-emerald-700'}">${fmtRate(o.rate)}</td>
                    <td class="px-2 py-1.5"><div class="h-2 bg-slate-100 rounded"><div class="h-2 rounded ${cfg.target && o.rate > cfg.target ? 'bg-rose-500' : 'bg-emerald-500'}" style="width:${Math.min(100, (o.rate / Math.max(...list.map(x => x.rate), cfg.target || 0.01)) * 100)}%"></div></div></td></tr>`).join('')}</tbody></table></div>
            </div>`;
        $('#qc-body').innerHTML = `
        <div class="space-y-4">
            <div class="bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
                <div class="text-xs text-slate-600"><b class="text-slate-800">${esc(A.label)} 불량률 보고서</b> · ${esc(flt.from)} ~ ${esc(flt.to)}<br><span class="text-[11px] text-slate-400">이 기간의 보고서 결재·수신참조·첨부입니다. [불량률 보고서]로 인쇄하면 결재 칸이 함께 나옵니다.</span></div>
                <div id="qc-rpt-appr"></div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                ${card('불량률', fmtRate(s.rate), cfg.target ? `목표 ${fmtRate(cfg.target)} 이하 · ${over ? '목표 초과' : '목표 달성'}` : '목표 미설정', over ? 'text-rose-600' : 'text-emerald-700')}
                ${card('PPM', fmtPpm(s.defect, s.inspected), '백만 개당 불량 수')}
                ${card(esc(A.unitLabel), fmtQty(s.inspected), `검사 ${s.count}건`)}
                ${card('불량수량', fmtQty(s.defect), '', 'text-rose-600')}
                ${card('불합격', `${s.fail}건`, `조건부 합격 ${s.cond}건`, s.fail ? 'text-rose-600' : 'text-slate-900')}
                ${card('합격률(건수)', s.count ? fmtRate(((s.count - s.fail) / s.count) * 100) : '-', '불합격 제외')}
            </div>
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><h3 class="text-sm font-black text-slate-800 mb-2">월별 불량률 추이</h3><div class="h-64"><canvas id="qc-ch-month"></canvas></div></div>
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><h3 class="text-sm font-black text-slate-800 mb-2">불량 유형 파레토</h3><div class="h-64"><canvas id="qc-ch-pareto"></canvas></div></div>
            </div>
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
                ${rankTable('품목별 불량률 (불량수량 많은 순)', s.byItem, '품목')}
                ${rankTable(`${esc(A.groupLabel)}별 불량률`, s.byGroup, esc(A.groupLabel))}
            </div>
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <h3 class="text-sm font-black text-slate-800 mb-2">불량 유형별 수량</h3>
                <div class="flex flex-wrap gap-2 text-xs">${s.byType.length === 0 ? '<span class="text-slate-400">불량 기록이 없습니다.</span>' : s.byType.map(t => `<span class="px-2 py-1 rounded-lg bg-rose-50 border border-rose-100"><b class="text-rose-700">${esc(t.type)}</b> ${fmtQty(t.qty)} <span class="text-slate-400">(${t.share.toFixed(1)}%)</span></span>`).join('')}</div>
            </div>
        </div>`;
        mountApprovalBox($('#qc-rpt-appr'), reportApprDoc(), { showToast });
        destroyCharts();
        applyChartTheme(Chart);
        // 백그라운드 탭이거나 '동작 줄이기'면 애니메이션 없이 바로 그린다 (requestAnimationFrame이 멈추면 빈 그래프로 남음)
        const still = document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const animation = still ? false : undefined;
        const m = s.byMonth;
        charts.push(new Chart($('#qc-ch-month'), {
            data: {
                labels: m.map(x => `${Number(x.key.slice(5))}월`),
                datasets: [
                    { type: 'bar', label: '불량수량', data: m.map(x => x.defect), backgroundColor: 'rgba(244,63,94,0.55)', yAxisID: 'y' },
                    { type: 'line', label: '불량률(%)', data: m.map(x => Number(x.rate.toFixed(3))), borderColor: '#059669', backgroundColor: '#059669', tension: 0.25, yAxisID: 'y1' },
                    ...(cfg.target ? [{ type: 'line', label: `목표 ${cfg.target}%`, data: m.map(() => cfg.target), borderColor: '#f59e0b', borderDash: [6, 4], pointRadius: 0, yAxisID: 'y1' }] : [])
                ]
            },
            options: { animation, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true, title: { display: true, text: '불량수량' } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '%' } } } }
        }));
        const t = s.byType.slice(0, 10);
        charts.push(new Chart($('#qc-ch-pareto'), {
            data: {
                labels: t.map(x => x.type),
                datasets: [
                    { type: 'bar', label: '불량수량', data: t.map(x => x.qty), backgroundColor: 'rgba(59,130,246,0.6)', yAxisID: 'y' },
                    { type: 'line', label: '누적 비율(%)', data: t.map(x => Number(x.cum.toFixed(1))), borderColor: '#e11d48', backgroundColor: '#e11d48', yAxisID: 'y1' }
                ]
            },
            options: { animation, responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true }, y1: { min: 0, max: 100, position: 'right', grid: { drawOnChartArea: false } } } }
        }));
    };

    // ---------- 불량 유형·목표 설정 ----------
    const renderConfig = () => {
        const can = canConfigQc();
        $('#qc-body').innerHTML = `
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 max-w-2xl text-xs">
            <h3 class="text-sm font-black text-slate-800">불량 유형 · 목표 불량률 (${esc(A.label)})</h3>
            <p class="text-slate-500">검사 기록 창에 나오는 불량 유형 목록과 목표 불량률입니다. 현황판의 목표선·색(초과 빨강)에 쓰입니다. ${can ? '' : '<b class="text-amber-700">바꾸기는 매니저 이상만 할 수 있습니다.</b>'}</p>
            <label class="block"><span class="font-bold text-slate-600">목표 불량률 (% 이하)</span>
                <input type="number" id="qc-target" step="0.01" min="0" value="${cfg.target}" ${can ? '' : 'disabled'} class="mt-1 w-40 border border-slate-300 rounded-lg px-2 py-1.5" /></label>
            <label class="block"><span class="font-bold text-slate-600">불량 유형 (한 줄에 하나, 위에서부터 입력 창 순서)</span>
                <textarea id="qc-types" rows="12" ${can ? '' : 'disabled'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 leading-relaxed">${esc(cfg.types.join('\n'))}</textarea></label>
            ${can ? `<div class="flex justify-between gap-2"><button type="button" id="qc-cfg-reset" class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">기본 목록으로</button>
                <button type="button" id="qc-cfg-save" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black">저장</button></div>` : ''}
        </div>`;
        $('#qc-cfg-reset')?.addEventListener('click', () => { $('#qc-types').value = A.defaultTypes.join('\n'); });
        $('#qc-cfg-save')?.addEventListener('click', async (e) => {
            e.target.disabled = true;
            try {
                await saveDefectConfig(area, { types: $('#qc-types').value.split('\n'), target: $('#qc-target').value });
                cfg = await getDefectConfig(area);
                showToast('💾 불량 유형·목표를 저장했습니다.');
            } catch (err) { alert(err.message); }
            e.target.disabled = false;
        });
    };

    const render = () => {
        paintTabs();
        destroyCharts();
        if (view === 'stats') renderStats(); else if (view === 'config') renderConfig(); else renderRecords();
        createIcons({ icons });
    };

    // ---------- 검사 기록 입력 창 ----------
    const openEditor = (orig) => {
        const r = orig ? JSON.parse(JSON.stringify(orig)) : { date: today, result: 'PASS', unit: 'EA', inspector: state.currentUser?.name || '', defects: [] };
        const modal = $('#qc-modal');
        const readOnly = !canWrite;
        const typeList = [...new Set([...cfg.types, ...(r.defects || []).map(d => d.type)])];
        const qtyOfType = (t) => (r.defects || []).find(d => d.type === t)?.qty ?? '';
        const groups = [...new Set([...(A.processes || []), ...records.map(x => x[A.groupKey]).filter(Boolean)])];
        const inp = 'mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5';
        modal.innerHTML = `
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-5 space-y-4 text-xs">
            <div class="flex items-start justify-between gap-3">
                <div><h3 class="text-base font-black text-slate-900">${esc(A.inspect)} ${orig ? '기록' : '새 기록'}</h3>${orig ? `<div class="text-[11px] text-slate-400">${esc(orig.id)} · ${esc(orig.by || '')}</div>` : ''}</div>
                <div class="flex items-start gap-2"><div id="qcm-appr"></div><button type="button" data-close class="p-1 rounded-lg hover:bg-slate-100"><i data-lucide="x" class="w-4 h-4"></i></button></div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <label><span class="font-bold text-slate-600">검사일 *</span><input type="date" id="qcm-date" value="${esc(r.date)}" class="${inp}" /></label>
                <label class="col-span-2"><span class="font-bold text-slate-600">품목 * (코드·이름 검색)</span><input id="qcm-item" value="${esc(r.itemName || '')}" placeholder="품목 검색" class="${inp}" /><span id="qcm-code" class="text-[10px] text-slate-400 font-mono">${esc(r.itemCode || '')}</span></label>
                <label><span class="font-bold text-slate-600">LOT</span><input id="qcm-lot" value="${esc(r.lot || '')}" class="${inp} font-mono" /></label>
                <label><span class="font-bold text-slate-600">${esc(A.groupLabel)}</span><input id="qcm-group" list="qcm-groups" value="${esc(r[A.groupKey] || '')}" class="${inp}" /><datalist id="qcm-groups">${groups.map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist></label>
                <label><span class="font-bold text-slate-600">${esc(A.unitLabel)} *</span><input type="number" min="0" step="any" id="qcm-ins" value="${esc(r.inspectedQty ?? '')}" class="${inp} text-right" /></label>
                <label><span class="font-bold text-slate-600">단위</span><input id="qcm-unit" value="${esc(r.unit || 'EA')}" class="${inp}" /></label>
                <label><span class="font-bold text-slate-600">검사자</span><input id="qcm-inspector" value="${esc(r.inspector || '')}" class="${inp}" /></label>
            </div>
            <div class="border border-rose-100 bg-rose-50/40 rounded-xl p-3 space-y-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <b class="text-rose-800">불량 유형별 수량</b>
                    <span>불량 합계 <b id="qcm-def-sum" class="text-rose-700 text-sm"></b> · 불량률 <b id="qcm-rate" class="text-sm"></b></span>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-2">${typeList.map(t => `<label class="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-1"><span class="flex-1 truncate" title="${esc(t)}">${esc(t)}</span><input type="number" min="0" step="any" data-type="${esc(t)}" value="${esc(qtyOfType(t))}" class="w-20 border border-slate-300 rounded px-1.5 py-1 text-right" /></label>`).join('')}</div>
                <label class="flex items-center gap-2"><span class="text-slate-600">유형 없이 불량수량만 입력</span><input type="number" min="0" step="any" id="qcm-def" value="${esc((r.defects || []).some(d => Number(d.qty) > 0) ? '' : (r.defectQty ?? ''))}" class="w-24 border border-slate-300 rounded px-1.5 py-1 text-right" /><span class="text-[10px] text-slate-400">(유형별 수량이 있으면 그 합계를 씁니다)</span></label>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label><span class="font-bold text-slate-600">판정 *</span><select id="qcm-result" class="${inp}">${Object.entries(QC_RESULTS).map(([k, l]) => `<option value="${k}" ${r.result === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label><span class="font-bold text-slate-600">조치 완료</span><span class="mt-1 flex items-center gap-2"><input type="checkbox" id="qcm-done" ${r.actionDone ? 'checked' : ''} /> <input type="date" id="qcm-done-date" value="${esc(r.actionDate || '')}" class="border border-slate-300 rounded-lg px-2 py-1" /></span></label>
                <label><span class="font-bold text-slate-600">불량 원인</span><textarea id="qcm-cause" rows="3" class="${inp}">${esc(r.cause || '')}</textarea></label>
                <label><span class="font-bold text-slate-600">시정·예방 조치</span><textarea id="qcm-action" rows="3" class="${inp}">${esc(r.action || '')}</textarea></label>
                <label class="md:col-span-2"><span class="font-bold text-slate-600">비고</span><input id="qcm-notes" value="${esc(r.notes || '')}" class="${inp}" /></label>
            </div>
            <div id="qcm-att" class="border-t border-slate-100 pt-3"></div>
            <div class="flex flex-wrap justify-between gap-2 pt-1">
                <div>${orig && canDeleteQc(orig) ? '<button type="button" id="qcm-del" class="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold">삭제</button>' : ''}</div>
                <div class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">닫기</button>
                ${readOnly ? '' : `<button type="button" id="qcm-save" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black">${orig ? '저장' : '저장하고 첨부·결재 열기'}</button>`}</div>
            </div>
        </div>`;
        modal.classList.remove('hidden');
        createIcons({ icons });
        const m = (s) => modal.querySelector(s);
        const close = () => { modal.classList.add('hidden'); modal.innerHTML = ''; };
        modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
        if (readOnly) modal.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
        attachItemPicker(m('#qcm-item'), (it) => {
            m('#qcm-item').value = it.name; m('#qcm-code').textContent = it.code;
            r.itemCode = it.code; r.itemName = it.name;
            if (it.unit) m('#qcm-unit').value = it.unit;
        }, (it) => !A.categories || A.categories.includes(it.category) || !it.category);
        m('#qcm-item').addEventListener('input', () => { r.itemCode = ''; m('#qcm-code').textContent = '(목록에서 고르지 않은 품목)'; });
        const recalc = () => {
            const typed = [...modal.querySelectorAll('[data-type]')].reduce((s, el) => s + (Number(el.value) || 0), 0);
            const def = typed > 0 ? typed : Number(m('#qcm-def').value) || 0;
            const ins = Number(m('#qcm-ins').value) || 0;
            const rate = rateOf(def, ins);
            m('#qcm-def-sum').textContent = fmtQty(def);
            m('#qcm-rate').textContent = fmtRate(rate);
            m('#qcm-rate').className = `text-sm ${cfg.target && rate > cfg.target ? 'text-rose-600' : 'text-emerald-700'}`;
            m('#qcm-def').disabled = readOnly || typed > 0;
        };
        modal.addEventListener('input', recalc);
        recalc();
        const mountExtras = (rec) => {
            mountAttachmentPanel(m('#qcm-att'), { key: `QC:${rec.id}`, title: '첨부 (불량 사진·성적서 등)' });
            mountApprovalBox(m('#qcm-appr'), recApprDoc(area, rec), { showToast });
        };
        if (orig) mountExtras(orig);
        else mountAttachmentPanel(m('#qcm-att'), { key: '', title: '첨부 (불량 사진·성적서 등)' });
        m('#qcm-del')?.addEventListener('click', async () => {
            if (!confirm('이 검사 기록을 삭제할까요? 되돌릴 수 없습니다.')) return;
            try { await removeAllAttachments(`QC:${orig.id}`); await deleteQc(orig.id); showToast('🗑️ 검사 기록을 삭제했습니다.'); close(); await load(); } catch (err) { alert(err.message); }
        });
        m('#qcm-save')?.addEventListener('click', async (e) => {
            const date = m('#qcm-date').value;
            const itemName = m('#qcm-item').value.trim();
            const ins = Number(m('#qcm-ins').value);
            if (!date || !itemName) { alert('검사일과 품목을 입력하세요.'); return; }
            if (!(ins > 0)) { alert(`${A.unitLabel}을 0보다 크게 입력하세요.`); return; }
            const defects = [...modal.querySelectorAll('[data-type]')].filter(el => Number(el.value) > 0).map(el => ({ type: el.dataset.type, qty: Number(el.value) }));
            const defectQty = defects.length ? defects.reduce((s, d) => s + d.qty, 0) : Number(m('#qcm-def').value) || 0;
            if (defectQty > ins && !confirm(`불량수량(${defectQty})이 ${A.unitLabel}(${ins})보다 많습니다. 그대로 저장할까요?`)) return;
            const rec = {
                ...r, area, date, itemName, itemCode: r.itemCode || '', lot: m('#qcm-lot').value.trim(), [A.groupKey]: m('#qcm-group').value.trim(),
                inspectedQty: ins, unit: m('#qcm-unit').value.trim() || 'EA', inspector: m('#qcm-inspector').value.trim(), defects, defectQty,
                result: m('#qcm-result').value, cause: m('#qcm-cause').value.trim(), action: m('#qcm-action').value.trim(),
                actionDone: m('#qcm-done').checked, actionDate: m('#qcm-done-date').value, notes: m('#qcm-notes').value.trim()
            };
            e.target.disabled = true;
            try {
                const saved = await saveQc('INSPECT', rec);
                showToast(orig ? '💾 검사 기록을 저장했습니다.' : '✅ 검사 기록을 등록했습니다. 불량 사진·성적서를 첨부할 수 있습니다.');
                await load(false);
                if (orig) close(); else openEditor(saved);
            } catch (err) { alert(err.message); e.target.disabled = false; }
        });
    };

    // ---------- 엑셀 · 인쇄 ----------
    const exportExcel = async () => {
        const XLSX = await import('xlsx');
        const rows = filtered();
        const s = summarize(rows, { groupKey: A.groupKey });
        const wb = XLSX.utils.book_new();
        const recSheet = rows.map(r => ({
            검사일: r.date, 품목코드: r.itemCode || '', 품목명: r.itemName || '', LOT: r.lot || '', [A.groupLabel]: r[A.groupKey] || '',
            [A.unitLabel]: Number(r.inspectedQty) || 0, 단위: r.unit || '', 불량수량: defectQtyOf(r), '불량률(%)': Number(rateOf(defectQtyOf(r), Number(r.inspectedQty) || 0).toFixed(3)),
            불량유형: (r.defects || []).map(d => `${d.type} ${d.qty}`).join(', '), 판정: QC_RESULTS[r.result] || '', 원인: r.cause || '', 조치: r.action || '', 조치완료: r.actionDone ? 'Y' : '', 검사자: r.inspector || '', 비고: r.notes || ''
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recSheet.length ? recSheet : [{ 검사일: '' }]), '검사기록');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.byMonth.map(o => ({ 월: o.key, 건수: o.count, [A.unitLabel]: o.inspected, 불량수량: o.defect, '불량률(%)': Number(o.rate.toFixed(3)) }))), '월별');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.byItem.map(o => ({ 품목: o.name, 코드: o.key, 건수: o.count, [A.unitLabel]: o.inspected, 불량수량: o.defect, '불량률(%)': Number(o.rate.toFixed(3)) }))), '품목별');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.byGroup.map(o => ({ [A.groupLabel]: o.name, 건수: o.count, [A.unitLabel]: o.inspected, 불량수량: o.defect, '불량률(%)': Number(o.rate.toFixed(3)) }))), `${A.groupLabel.replace(/[·/]/g, '')}별`);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.byType.map(o => ({ 불량유형: o.type, 수량: o.qty, '비율(%)': Number(o.share.toFixed(2)), '누적(%)': Number(o.cum.toFixed(2)) }))), '불량유형');
        XLSX.writeFile(wb, `${A.label}_불량률_${flt.from}_${flt.to}.xlsx`);
    };

    const printReport = () => {
        const rows = filtered();
        const s = summarize(rows, { groupKey: A.groupKey });
        const rankCols = (label) => [
            { label, w: 60, get: (o) => o.name }, { label: '건수', w: 14, cls: 'r', get: (o) => o.count }, { label: A.unitLabel, w: 26, cls: 'r', get: (o) => fmtQty(o.inspected) },
            { label: '불량', w: 22, cls: 'r', get: (o) => fmtQty(o.defect) }, { label: '불량률', w: 20, cls: 'r', get: (o) => fmtRate(o.rate) }
        ];
        const bodyHtml = `
            <h2>1. 요약</h2>
            <table class="grid"><tr><th>검사 건수</th><th>${esc(A.unitLabel)}</th><th>불량수량</th><th>불량률</th><th>목표</th><th>PPM</th><th>불합격</th></tr>
            <tr><td class="c">${s.count}</td><td class="r">${fmtQty(s.inspected)}</td><td class="r">${fmtQty(s.defect)}</td><td class="c"><b>${fmtRate(s.rate)}</b></td><td class="c">${cfg.target ? `${fmtRate(cfg.target)} 이하` : '-'}</td><td class="r">${fmtPpm(s.defect, s.inspected)}</td><td class="c">${s.fail}건</td></tr></table>
            <h2>2. 월별 추이</h2>${printTableHtml([{ label: '월', w: 30, get: (o) => o.key }, { label: '건수', w: 20, cls: 'r', get: (o) => o.count }, { label: A.unitLabel, w: 40, cls: 'r', get: (o) => fmtQty(o.inspected) }, { label: '불량', w: 30, cls: 'r', get: (o) => fmtQty(o.defect) }, { label: '불량률', w: 30, cls: 'r', get: (o) => fmtRate(o.rate) }], s.byMonth)}
            <h2>3. 불량 유형 (파레토)</h2>${printTableHtml([{ label: '불량 유형', w: 70, get: (o) => o.type }, { label: '수량', w: 30, cls: 'r', get: (o) => fmtQty(o.qty) }, { label: '비율', w: 30, cls: 'r', get: (o) => `${o.share.toFixed(1)}%` }, { label: '누적', w: 30, cls: 'r', get: (o) => `${o.cum.toFixed(1)}%` }], s.byType)}
            <h2>4. 품목별 불량률 (상위 15)</h2>${printTableHtml(rankCols('품목'), s.byItem.slice(0, 15))}
            <h2>5. ${esc(A.groupLabel)}별 불량률</h2>${printTableHtml(rankCols(A.groupLabel), s.byGroup.slice(0, 15))}
            <h2>6. 불합격·조치 내역</h2>${printTableHtml([{ label: '검사일', w: 22, get: (r) => r.date }, { label: '품목', w: 50, get: (r) => r.itemName }, { label: 'LOT', w: 24, get: (r) => r.lot }, { label: '불량', w: 16, cls: 'r', get: (r) => fmtQty(defectQtyOf(r)) }, { label: '원인', get: (r) => r.cause }, { label: '조치', get: (r) => `${r.actionDone ? '[완료] ' : ''}${r.action || ''}` }], rows.filter(r => r.result !== 'PASS'), { emptyText: '불합격·조건부 합격 없음' })}`;
        printA4({
            title: `${A.label} 불량률 보고서`, subtitle: `${A.inspect} · ${flt.from} ~ ${flt.to}`, meta: [['기간', `${flt.from} ~ ${flt.to}`], ['작성', state.currentUser?.name || '']],
            bodyHtml, approvals: reportApprDoc().roles, approvalKey: reportApprDoc().key
        });
    };

    const load = async (withCfg = true) => {
        if (withCfg) cfg = await getDefectConfig(area);
        try { records = (await listQc('INSPECT')).filter(r => r.area === area); } catch (e) { $('#qc-body').innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(e.message)}</div>`; return; }
        render();
    };

    container.querySelectorAll('.qc-v').forEach(b => b.addEventListener('click', () => {
        view = b.dataset.v;
        try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); v[area] = view; localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* 보기 기억만 못 함 */ }
        render();
    }));
    const onFilter = () => { shown = 100; render(); };
    $('#qc-from').addEventListener('change', (e) => { flt.from = e.target.value; onFilter(); });
    $('#qc-to').addEventListener('change', (e) => { flt.to = e.target.value; onFilter(); });
    $('#qc-q').addEventListener('input', (e) => { flt.q = e.target.value; onFilter(); });
    $('#qc-result').addEventListener('change', (e) => { flt.result = e.target.value; onFilter(); });
    $('#qc-range').addEventListener('change', (e) => {
        const v = e.target.value; e.target.value = '';
        const y = Number(today.slice(0, 4)), mo = today.slice(0, 7);
        if (v === 'm0') { flt.from = `${mo}-01`; flt.to = today; }
        else if (v === 'm1') { flt.from = addMonths(`${mo}-01`, -1); flt.to = localDateStr(new Date(new Date(`${mo}-01T00:00:00`) - 86400000)); }
        else if (v === 'm3') { flt.from = addMonths(`${mo}-01`, -2); flt.to = today; }
        else if (v === 'm6') { flt.from = addMonths(`${mo}-01`, -5); flt.to = today; }
        else if (v === 'y0') { flt.from = `${y}-01-01`; flt.to = today; }
        else if (v === 'y1') { flt.from = `${y - 1}-01-01`; flt.to = `${y - 1}-12-31`; }
        else return;
        $('#qc-from').value = flt.from; $('#qc-to').value = flt.to;
        onFilter();
    });
    $('#qc-new')?.addEventListener('click', () => openEditor(null));
    $('#qc-xlsx').addEventListener('click', () => exportExcel().catch(e => alert(`엑셀을 만들지 못했습니다: ${e.message}`)));
    $('#qc-print').addEventListener('click', printReport);
    // 다른 탭으로 가면 그래프 정리
    const obs = new MutationObserver(() => { if (!container.contains($('#qc-body'))) { destroyCharts(); obs.disconnect(); } });
    obs.observe(container, { childList: true });
    load().then(() => { if (openId) { const r = records.find(x => x.id === openId); if (r) openEditor(r); } });
    createIcons({ icons });
};
