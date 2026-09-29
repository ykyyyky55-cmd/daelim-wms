import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { localDateStr } from '../services/searchUtils.js';
import {
    weekStart, weekDays, weekLabel, addDays, dowOf, md, monthOf, loadWeek, savePlan, deletePlan, getPlan, loadMonthLines, planId,
    newLineId, round3, PURCH_LINE_STATUS, SOURCE_LABEL, PLAN_SITES, listPlans
} from '../services/plans.js';
import { renderLineTable, printA4, printTableHtml, btn, fmtQty, siteOptions } from './plans/planCommon.js';
import { renderShortagePanel } from './plans/shortagePanel.js';
import { mountApprovalBox } from './approval/ApprovalBox.js';
import { autoReflectOpen } from '../services/planAuto.js';

// 생산관리 → 구매계획: 월간(주간 취합) · 주간(필요일별 줄). 생산계획의 원부자재 부족분이 '부족 연동' 줄로 들어온다.
const VIEW_KEY = 'daelim_purchplan_view';
const statusOpts = Object.entries(PURCH_LINE_STATUS);
const sortLines = (lines) => lines.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.site).localeCompare(String(b.site)) || String(a.name).localeCompare(String(b.name), 'ko'));
const srcBadge = (l) => {
    const s = l.source || 'MANUAL';
    return `<span class="inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap ${s === 'SHORT' ? 'bg-rose-50 text-rose-700 border-rose-200' : s === 'PREQ' ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-slate-50 text-slate-500 border-slate-200'}">${esc(SOURCE_LABEL[s] || s)}</span>${l.refNo ? `<div class="text-[10px] font-mono text-slate-500">${esc(l.refNo)}</div>` : ''}`;
};

export const renderPurchasePlan = (container, { showToast }) => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); } catch { }
    const pending = window.__pendingPlanOpen?.tab === 'purchPlan' ? window.__pendingPlanOpen : null;
    window.__pendingPlanOpen = null;
    let view = pending?.view || saved.view || 'week';
    let monday = weekStart(pending?.date || localDateStr());
    let ym = monthOf(pending?.date || localDateStr());
    let site = pending?.site ?? saved.site ?? '';
    let dirty = false;
    let doc = null;
    const canEdit = canPerformAction('MRP_PLANNING');
    const persist = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view, site })); } catch { } };
    const guard = () => !dirty || confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?');
    const siteOk = (l) => !site || l.site === site;

    container.innerHTML = `
    <section class="space-y-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-emerald-600 flex items-center gap-1"><i data-lucide="shopping-cart" class="w-3.5 h-3.5"></i>생산관리 › 구매계획</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1">구매계획</h2>
                    <p class="text-xs text-slate-500 mt-1">원료·부자재 구매를 필요일별로 계획합니다. 생산계획에서 수불부 재고가 모자란 원부자재는 <b>부족 연동</b> 줄로 들어옵니다. 월간 계획은 주간 계획을 취합합니다.</p>
                </div>
                ${canEdit ? '' : '<span class="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold">조회 전용 (계획 입력은 매니저 이상)</span>'}
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">
                    ${[['month', '월간 구매계획', 'calendar-days'], ['week', '주간 구매계획', 'calendar-range']].map(([k, l, ic]) => `
                    <button type="button" data-v="${k}" class="bp-view px-3.5 py-2 rounded-lg text-xs font-black flex items-center gap-1.5 transition"><i data-lucide="${ic}" class="w-4 h-4"></i>${l}</button>`).join('')}
                </div>
                <div class="flex items-center gap-2 text-xs">
                    <span class="font-bold text-slate-600">거점</span>
                    <select id="bp-site" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                        <option value="">전체</option>${PLAN_SITES.map(s => `<option value="${s}" ${s === site ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div id="bp-nav"></div>
        </div>
        <div id="bp-body" class="space-y-5"></div>
    </section>`;
    const $ = (s) => container.querySelector(s);
    const setDirty = (v) => { dirty = v; $('#bp-dirty')?.classList.toggle('hidden', !v); };
    // 전자결재: 계획서(거점 필터별) 하나에 결재 칸 하나
    const APPR_ROLES = ['작성', '검토', '승인'];
    const apprKey = (base) => `PLAN:${base}:${site || '전체'}`;
    const mountAppr = (key, type, title, date) => mountApprovalBox($('#bp-appr'), { key, type, title, date, roles: APPR_ROLES }, { showToast });

    const navHtml = (label, extra = '') => `
        <div class="flex flex-wrap items-center gap-2">
            <button type="button" id="bp-prev" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-black">‹</button>
            <span class="text-sm font-black text-slate-900 min-w-[220px] text-center">${esc(label)}</span>
            <button type="button" id="bp-next" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-black">›</button>
            <button type="button" id="bp-today" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold">오늘</button>
            ${extra}
        </div>`;
    const bindNav = (prev, next, today, pick) => {
        const go = (fn) => () => { if (!guard()) return; fn(); setDirty(false); render(); };
        $('#bp-prev').addEventListener('click', go(prev));
        $('#bp-next').addEventListener('click', go(next));
        $('#bp-today').addEventListener('click', go(today));
        $('#bp-pick')?.addEventListener('change', (e) => { if (!e.target.value || !guard()) return; pick(e.target.value); setDirty(false); render(); });
    };

    const render = async () => {
        persist();
        container.querySelectorAll('.bp-view').forEach(b => { b.className = `bp-view px-3.5 py-2 rounded-lg text-xs font-black flex items-center gap-1.5 transition ${b.dataset.v === view ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`; });
        $('#bp-body').innerHTML = '<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">불러오는 중...</div>';
        // 접수된 구매요청서 중 아직 계획에 없는 것 자동 반영 (services/planAuto.js)
        try { const r = await autoReflectOpen('PURCH'); if (r.reqs) showToast(`📋 구매요청서 ${r.reqs}건을 주간 구매계획에 자동 반영했습니다.`); } catch { /* 무시 */ }
        try {
            if (view === 'week') await renderWeek(); else await renderMonth();
        } catch (err) {
            $('#bp-body').innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(err.message)}</div>`;
        }
        createIcons({ icons });
    };

    // ---------- 주간 ----------
    const columns = () => {
        const days = weekDays(monday);
        return [
            { key: 'date', label: '필요일', type: 'select', w: 'w-24', options: days.map(d => [d, `${md(d)}(${dowOf(d)})`]) },
            { key: 'site', label: '거점', type: 'select', w: 'w-20', options: siteOptions },
            { key: 'name', label: '품목 (원료·부자재)', type: 'item', filter: (m) => m.category !== '완제품', onPick: (l, m) => { l.supplier = l.supplier || m.supplier || ''; } },
            { key: 'qty', label: '수량', type: 'number', w: 'w-24', align: 'right' },
            { key: 'unit', label: '단위', type: 'text', w: 'w-16', minW: 64 },
            { key: 'supplier', label: '공급처', type: 'text', w: 'w-28' },
            { key: 'price', label: '단가', type: 'number', w: 'w-24', align: 'right' },
            { key: 'eta', label: '입고예정일', type: 'date', w: 'w-32' },
            { key: 'status', label: '상태', type: 'select', w: 'w-24', options: statusOpts },
            { key: 'source', label: '출처', type: 'badge', w: 'w-20', render: srcBadge },
            { key: 'note', label: '비고', type: 'text' }
        ];
    };
    const renderLines = () => {
        const visible = doc.lines.filter(siteOk);
        const amount = visible.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
        $('#bp-sum').innerHTML = [['구매 품목', `${visible.length}건`], ['부족 연동', `${visible.filter(l => l.source === 'SHORT').length}건`], ['발주 / 입고완료', `${visible.filter(l => l.status === 'ORDER').length} / ${visible.filter(l => l.status === 'RECEIVED').length}`], ['예상 금액 (단가 입력분)', amount ? `${Math.round(amount).toLocaleString()}원` : '-']]
            .map(([k, v]) => `<div class="p-3 rounded-xl bg-slate-50 border border-slate-200"><div class="text-[11px] font-bold text-slate-500">${k}</div><div class="text-lg font-black text-slate-900">${v}</div></div>`).join('');
        renderLineTable($('#bp-lines'), {
            lines: visible, columns: columns(), readOnly: !canEdit, emptyText: '이 주 구매계획이 없습니다.',
            rowClass: (l) => (l.status === 'RECEIVED' ? 'opacity-60' : l.source === 'SHORT' ? 'bg-rose-50/50' : ''),
            onChange: (l, k) => { if (k === 'delete') doc.lines = doc.lines.filter(x => !siteOk(x) || visible.includes(x)); setDirty(true); },
            onRerender: renderLines
        });
    };
    const saveDoc = async () => {
        doc.lines = sortLines((doc.lines || []).filter(l => l.code || l.name));
        doc.author = doc.author || state.currentGlobalWorker || '';
        doc = await savePlan(doc);
        setDirty(false);
        showToast('💾 구매계획을 저장했습니다.');
    };

    const renderWeek = async () => {
        $('#bp-nav').innerHTML = navHtml(weekLabel(monday), `<input type="date" id="bp-pick" value="${monday}" class="border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold" />`);
        bindNav(() => { monday = addDays(monday, -7); }, () => { monday = addDays(monday, 7); }, () => { monday = weekStart(localDateStr()); }, (v) => { monday = weekStart(v); });
        doc = await loadWeek('PURCH_WEEK', monday);
        doc.lines = sortLines(doc.lines || []);
        const exists = !!doc.createdAt;
        $('#bp-body').innerHTML = `
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="calendar-range" class="w-4 h-4 text-emerald-600"></i>주간 구매계획 · ${esc(weekLabel(monday))}
                        <span id="bp-dirty" class="hidden px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">저장 안 됨</span></h3>
                    <div class="flex flex-wrap gap-2">
                        ${canEdit ? `
                        <button type="button" id="bp-imp-req" class="${btn('bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100')}"><i data-lucide="file-input" class="w-4 h-4"></i>구매요청서 불러오기</button>
                        <button type="button" id="bp-add" class="${btn('bg-white text-slate-700 border border-slate-300 hover:bg-slate-50')}"><i data-lucide="plus" class="w-4 h-4"></i>줄 추가</button>
                        <button type="button" id="bp-save" class="${btn('bg-emerald-600 hover:bg-emerald-700 text-white')}"><i data-lucide="save" class="w-4 h-4"></i>저장</button>
                        ${exists ? `<button type="button" id="bp-del" class="${btn('bg-white text-rose-600 border border-rose-200 hover:bg-rose-50')}"><i data-lucide="trash-2" class="w-4 h-4"></i>주간 계획 삭제</button>` : ''}` : ''}
                        <button type="button" id="bp-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>A4 출력</button>
                    </div>
                </div>
                <div id="bp-appr" class="flex justify-end"></div>
                <div id="bp-sum" class="grid grid-cols-2 sm:grid-cols-4 gap-2"></div>
                <div id="bp-lines"></div>
                <label class="block text-xs"><span class="font-bold text-slate-600">비고 (주간)</span>
                    <textarea id="bp-notes" rows="2" ${canEdit ? '' : 'readonly'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs">${esc(doc.notes || '')}</textarea></label>
                <div class="text-[11px] text-slate-400">${exists ? `마지막 저장: ${esc(new Date(doc.updatedAt).toLocaleString('ko-KR'))} · ${esc(doc.updatedBy || '')}` : '아직 저장하지 않은 주간 구매계획입니다.'} · 입고되면 상태를 '입고완료'로 바꾸세요 (재고 입고는 현장 스캔·전표 스캔에서).</div>
            </div>
            <div id="bp-short" class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm"></div>`;
        renderLines();
        mountAppr(exists ? apprKey(doc.id) : '', 'PURCH_WEEK', `주간 구매계획 ${weekLabel(monday)}${site ? ` (${site})` : ''}`, monday);
        $('#bp-notes').addEventListener('input', (e) => { doc.notes = e.target.value; setDirty(true); });
        $('#bp-add')?.addEventListener('click', () => {
            const d = weekDays(monday).includes(localDateStr()) ? localDateStr() : monday;
            doc.lines.push({ id: newLineId(), date: d, site: site || '김포', code: '', name: '', spec: '', qty: '', unit: 'EA', supplier: '', price: '', eta: '', source: 'MANUAL', status: 'PLAN', note: '' });
            setDirty(true);
            renderLines();
        });
        $('#bp-save')?.addEventListener('click', async () => { try { await saveDoc(); await render(); } catch (e) { alert(e.message); } });
        // 구매요청서(요청·접수, 필요일이 이 주 이전) → 이 주 구매 줄. 요청서는 '계획반영'으로 바꾼다
        $('#bp-imp-req')?.addEventListener('click', async () => {
            if (dirty && !confirm('저장하지 않은 변경이 함께 저장됩니다. 계속할까요?')) return;
            try {
                const days = weekDays(monday);
                const sunday = days[6];
                const open = (await listPlans('PURCH_REQ')).filter(r => ['REQUESTED', 'ACCEPTED'].includes(r.status) && (!site || r.site === site));
                const reqs = open.filter(r => !r.dueDate || r.dueDate <= sunday);
                const later = open.length - reqs.length;
                if (!reqs.length) { alert(`이 주에 불러올 구매요청서(요청·접수 상태, 필요일 ${md(sunday)} 이전)가 없습니다.${later ? `\n\n필요일이 이후인 요청서 ${later}건은 그 주의 구매계획에서 불러오세요.` : ''}`); return; }
                if (!confirm(`구매요청서 ${reqs.length}건을 이 주 구매계획에 넣을까요?\n\n${reqs.slice(0, 12).map(r => `· ${r.docNo} ${r.requester || ''} 필요일 ${r.dueDate || '-'} (${(r.lines || []).length}품목)`).join('\n')}${later ? `\n\n(필요일이 이후인 요청서 ${later}건은 그 주에서 불러오세요)` : ''}`)) return;
                const today = localDateStr();
                for (const r of reqs) {
                    const date = days.includes(r.dueDate) ? r.dueDate : (days.includes(today) ? today : monday);
                    (r.lines || []).filter(l => l.code || l.name).forEach((l, i) => {
                        const ref = `PREQ:${r.id}:${i}`;
                        if (doc.lines.some(x => x.ref === ref)) return;
                        doc.lines.push({ id: newLineId(), date, site: r.site || '김포', code: l.code || '', name: l.name, spec: l.spec || '', qty: Number(l.qty) || '', unit: l.unit || 'EA',
                            supplier: l.supplier || '', price: l.price || '', eta: r.dueDate || '', source: 'PREQ', ref, refNo: r.docNo, status: 'PLAN', note: [r.urgent ? '긴급' : '', r.partner || '', l.note || ''].filter(Boolean).join(' · ') });
                    });
                }
                await saveDoc();
                for (const r of reqs) await savePlan({ ...r, status: 'PLANNED', planWeek: monday, autoPlan: true });
                showToast(`📥 구매요청서 ${reqs.length}건을 불러오고 '계획반영'으로 바꿨습니다.`);
                await render();
            } catch (e) { alert(e.message); }
        });
        $('#bp-del')?.addEventListener('click', async () => {
            if (!confirm(`${weekLabel(monday)} 주간 구매계획을 삭제할까요?`)) return;
            try { await deletePlan(doc.id); setDirty(false); showToast('🗑️ 주간 구매계획을 삭제했습니다.'); await render(); } catch (e) { alert(e.message); }
        });
        $('#bp-print').addEventListener('click', () => {
            const ls = doc.lines.filter(siteOk).filter(l => l.code || l.name);
            const amount = ls.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
            printA4({
                title: '주간 구매계획서', subtitle: 'WEEKLY PURCHASE PLAN', approvalKey: doc.createdAt ? apprKey(doc.id) : '',
                meta: [['기간', weekLabel(monday)], ['거점', site || '전체'], ['작성자', doc.author || state.currentGlobalWorker || ''], ['품목', `${ls.length}건`], ...(amount ? [['예상 금액', `${Math.round(amount).toLocaleString()}원`]] : [])],
                bodyHtml: printTableHtml([
                    { label: '필요일', w: 16, get: l => `${md(l.date)}(${dowOf(l.date)})`, cls: 'c' }, { label: '거점', w: 11, get: l => l.site, cls: 'c' },
                    { label: '품목', w: 48, html: l => `${esc(l.name)}<br><span style="color:#666">${esc(l.code)}${l.spec ? ` · ${esc(l.spec)}` : ''}</span>` },
                    { label: '수량', w: 16, get: l => fmtQty(l.qty), cls: 'r' }, { label: '단위', w: 10, get: l => l.unit || '', cls: 'c' },
                    { label: '공급처', w: 22, get: l => l.supplier || '' }, { label: '입고예정', w: 18, get: l => l.eta || '', cls: 'c' },
                    { label: '상태', w: 14, get: l => PURCH_LINE_STATUS[l.status] || '', cls: 'c' },
                    { label: '비고', get: l => [l.source === 'SHORT' ? '[부족 연동]' : '', l.note || ''].filter(Boolean).join(' ') }
                ], ls, { minRows: 12, emptyText: '구매계획 없음' }) + `<h2>비고</h2><div class="notes">${esc(doc.notes || '')}</div>`
            });
        });
        // 이 주 생산계획의 원부자재 부족분 (구매 반영만)
        const prod = await loadWeek('PROD_WEEK', monday);
        renderShortagePanel($('#bp-short'), { prodLines: prod.lines || [], purchLines: doc.lines, site, onlyPurchase: true, title: '이 주 생산계획의 원부자재 부족 확인', showToast, onApplied: () => render() });
    };

    // ---------- 월간 ----------
    const renderMonth = async () => {
        const [y, m] = ym.split('-').map(Number);
        $('#bp-nav').innerHTML = navHtml(`${y}년 ${m}월 월간 구매계획`, `<input type="month" id="bp-pick" value="${ym}" class="border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold" /><span class="text-[11px] text-slate-400">· 주간 계획을 취합합니다</span>`);
        bindNav(() => { ym = monthOf(addDays(`${ym}-01`, -1)); }, () => { ym = monthOf(addDays(`${ym}-28`, 7)); }, () => { ym = monthOf(localDateStr()); }, (v) => { ym = v; });
        const { weeks, lines: all } = await loadMonthLines('PURCH_WEEK', ym);
        const lines = all.filter(siteOk).filter(l => l.code || l.name);
        const head = (await getPlan('PURCH_MONTH', ym)) || { id: planId('PURCH_MONTH', ym), kind: 'PURCH_MONTH', period: ym, notes: '', budget: '' };
        const groups = new Map();
        lines.forEach(l => {
            const k = `${l.site}|${l.code || l.name}|${l.unit}`;
            const g = groups.get(k) || { site: l.site, code: l.code, name: l.name, unit: l.unit || '', supplier: l.supplier || '', byWeek: {}, total: 0, amount: 0, received: 0, short: 0 };
            g.byWeek[l.week] = round3((g.byWeek[l.week] || 0) + (Number(l.qty) || 0));
            g.total = round3(g.total + (Number(l.qty) || 0));
            g.amount += (Number(l.qty) || 0) * (Number(l.price) || 0);
            if (l.status === 'RECEIVED') g.received = round3(g.received + (Number(l.qty) || 0));
            if (l.source === 'SHORT') g.short++;
            if (!g.supplier && l.supplier) g.supplier = l.supplier;
            groups.set(k, g);
        });
        const rows = [...groups.values()].sort((a, b) => a.site.localeCompare(b.site) || String(a.name).localeCompare(String(b.name), 'ko'));
        const wLabel = (w, i) => `${i + 1}주 (${md(w)}~)`;
        const amount = rows.reduce((s, r) => s + r.amount, 0);
        $('#bp-body').innerHTML = `
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="calendar-days" class="w-4 h-4 text-emerald-600"></i>월간 구매계획 · ${y}년 ${m}월 <span class="text-[11px] font-normal text-slate-400">(주간 계획 취합)</span></h3>
                    <div class="flex flex-wrap gap-2">
                        ${canEdit ? `<button type="button" id="bp-save" class="${btn('bg-emerald-600 hover:bg-emerald-700 text-white')}"><i data-lucide="save" class="w-4 h-4"></i>예산·비고 저장</button>
                        ${head.createdAt ? `<button type="button" id="bp-del" class="${btn('bg-white text-rose-600 border border-rose-200 hover:bg-rose-50')}"><i data-lucide="trash-2" class="w-4 h-4"></i>예산·비고 삭제</button>` : ''}` : ''}
                        <button type="button" id="bp-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>A4 출력</button>
                    </div>
                </div>
                <div id="bp-appr" class="flex justify-end"></div>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    ${[['구매 품목', `${rows.length}건`], ['부족 연동 품목', `${rows.filter(r => r.short).length}건`], ['입고완료 품목', `${rows.filter(r => r.received >= r.total && r.total > 0).length}건`], ['예상 금액', amount ? `${Math.round(amount).toLocaleString()}원` : '-']]
                        .map(([k, v]) => `<div class="p-3 rounded-xl bg-slate-50 border border-slate-200"><div class="text-[11px] font-bold text-slate-500">${k}</div><div class="text-lg font-black text-slate-900">${v}</div></div>`).join('')}
                </div>
                <div class="overflow-x-auto border border-slate-200 rounded-xl">
                    <table class="w-full text-xs">
                        <thead class="bg-slate-100 text-slate-600"><tr><th class="p-2 text-left">거점</th><th class="p-2 text-left">품목</th><th class="p-2 text-left">공급처</th>
                            ${weeks.map((w, i) => `<th class="p-2 text-right"><button type="button" class="bp-go-week underline decoration-dotted" data-w="${w}">${wLabel(w, i)}</button></th>`).join('')}
                            <th class="p-2 text-right">월 합계</th><th class="p-2 text-right">입고완료</th><th class="p-2 text-left">단위</th></tr></thead>
                        <tbody class="divide-y divide-slate-100">
                            ${rows.length === 0 ? `<tr><td colspan="${weeks.length + 6}" class="p-6 text-center text-slate-400">이 달의 주간 구매계획이 없습니다.</td></tr>` : rows.map(r => `<tr class="${r.short ? 'bg-rose-50/40' : ''}">
                                <td class="p-2">${esc(r.site)}</td>
                                <td class="p-2"><div class="font-bold">${esc(r.name)}${r.short ? ' <span class="text-[10px] text-rose-600">부족 연동</span>' : ''}</div><div class="text-[10px] font-mono text-blue-600">${esc(r.code || '')}</div></td>
                                <td class="p-2">${esc(r.supplier)}</td>
                                ${weeks.map(w => `<td class="p-2 text-right">${r.byWeek[w] ? fmtQty(r.byWeek[w]) : ''}</td>`).join('')}
                                <td class="p-2 text-right font-black">${fmtQty(r.total)}</td><td class="p-2 text-right text-emerald-700">${r.received ? fmtQty(r.received) : ''}</td><td class="p-2">${esc(r.unit)}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <label class="block"><span class="font-bold text-slate-600">월 구매 예산 (원)</span>
                        <input type="number" id="bp-budget" value="${esc(head.budget || '')}" ${canEdit ? '' : 'readonly'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-right font-bold" /></label>
                    <label class="block md:col-span-2"><span class="font-bold text-slate-600">비고</span>
                        <textarea id="bp-notes" rows="2" ${canEdit ? '' : 'readonly'} class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5">${esc(head.notes || '')}</textarea></label>
                </div>
            </div>`;
        mountAppr(apprKey(head.id), 'PURCH_MONTH', `월간 구매계획 ${y}년 ${m}월${site ? ` (${site})` : ''}`, ym);
        container.querySelectorAll('.bp-go-week').forEach(b => b.addEventListener('click', () => { monday = b.dataset.w; view = 'week'; render(); }));
        $('#bp-budget').addEventListener('input', (e) => { head.budget = e.target.value; });
        $('#bp-notes').addEventListener('input', (e) => { head.notes = e.target.value; });
        $('#bp-save')?.addEventListener('click', async () => { try { await savePlan({ ...head, author: head.author || state.currentGlobalWorker }); showToast('💾 월간 예산·비고를 저장했습니다.'); await render(); } catch (e) { alert(e.message); } });
        $('#bp-del')?.addEventListener('click', async () => { if (!confirm('월간 예산·비고를 삭제할까요? (주간 구매계획은 그대로 남습니다)')) return; try { await deletePlan(head.id); await render(); } catch (e) { alert(e.message); } });
        $('#bp-print').addEventListener('click', () => {
            printA4({
                title: '월간 구매계획서', subtitle: 'MONTHLY PURCHASE PLAN', landscape: true, approvalKey: apprKey(head.id),
                meta: [['계획월', `${y}년 ${m}월`], ['거점', site || '전체'], ['품목', `${rows.length}건`], ...(amount ? [['예상 금액', `${Math.round(amount).toLocaleString()}원`]] : []), ...(head.budget ? [['예산', `${Number(head.budget).toLocaleString()}원`]] : [])],
                bodyHtml: printTableHtml([
                    { label: '거점', w: 12, get: r => r.site, cls: 'c' },
                    { label: '품목', html: r => `${esc(r.name)} <span style="color:#666">${esc(r.code || '')}</span>${r.short ? ' <span class="short">[부족]</span>' : ''}` },
                    { label: '공급처', w: 28, get: r => r.supplier },
                    ...weeks.map((w, i) => ({ label: wLabel(w, i), w: 20, get: r => (r.byWeek[w] ? fmtQty(r.byWeek[w]) : ''), cls: 'r' })),
                    { label: '월 합계', w: 20, get: r => fmtQty(r.total), cls: 'r' }, { label: '입고완료', w: 18, get: r => (r.received ? fmtQty(r.received) : ''), cls: 'r' }, { label: '단위', w: 10, get: r => r.unit, cls: 'c' }
                ], rows, { emptyText: '구매계획 없음' }) + `<h2>비고</h2><div class="notes">${esc(head.notes || '')}</div>`
            });
        });
    };

    container.querySelectorAll('.bp-view').forEach(b => b.addEventListener('click', () => { if (b.dataset.v === view || !guard()) return; view = b.dataset.v; if (view === 'month') ym = monthOf(addDays(monday, 3)); setDirty(false); render(); }));
    $('#bp-site').addEventListener('change', (e) => { if (!guard()) { e.target.value = site; return; } site = e.target.value; setDirty(false); render(); });
    render();
};
