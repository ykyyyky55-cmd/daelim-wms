// ==========================================
// 주문관리 메뉴: [주문관리] [생산요청서] [출하요청서] 탭 (생산관리 오른쪽)
// ==========================================
// · 주문관리(orderBoard): 생산요청서 한 건을 요청 → 접수 → 계획반영 → 스케줄 → 생산 → 출하요청 → 출하완료까지 납기 순으로 보여 주고
//   (services/orders.js), 아직 반영 안 된 요청서를 생산(포장) 스케줄·주간 생산계획·일정관리에 한 번에 넣는다(services/planAuto.js reflectRequest).
//   아래에 주간·월간·분기·반기·년간 집계(요청·생산완료·출하·납기 준수, 누계).
// · 생산요청서(prodRequest): components/ProductionRequest.js 화면을 탭 줄 아래에 그대로 연다.
// · 출하요청서(shipRequest): 출고요청서(RQ 전표) 목록·출하 상태·주문 연결·공유 + 발행기(SlipIssuer, 출고요청서 종류)를 함께 둔다.
import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { localDateStr } from '../services/searchUtils.js';
import { addDays, monthOf, reqTypeOf } from '../services/plans.js';
import { listSlipsRange } from '../services/db.js';
import { locationLabel } from '../services/locations.js';
import { reflectRequest } from '../services/planAuto.js';
import { loadOrderData, buildOrder, linkSlipToOrder, slipLinked, isShipSlip, aggregateOrders, PERIOD_UNITS, qtyMapText } from '../services/orders.js';
import { requestShare, slipShare, openShareDialog } from '../services/orderShare.js';
import { renderProductionRequest } from './ProductionRequest.js';
import { setupSlipIssuer } from './SlipIssuer.js';
import { listPlans } from '../services/plans.js';
import { loadBoms, loadSupplyPlans, computeOrderMaterials, draftForShortages, ORDER_MAT_STATUS } from '../services/orderMaterials.js';
import { openOrderMatDialog } from './orderMatDialog.js';

const TABS = [['orderBoard', 'list-ordered', '주문관리'], ['prodRequest', 'file-input', '생산요청서'], ['shipRequest', 'truck', '출하요청서']];
const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const EXTERNAL = '외부 거래처';
const PREF_KEY = 'daelim_order_board';
const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } };
const savePref = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* 무시 */ } };

const tabsHtml = (active) => `
    <nav class="bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm flex gap-1 overflow-x-auto">
        ${TABS.map(([id, icon, label]) => `<button type="button" data-tab="${id}" class="oc-tab tap-compact flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 whitespace-nowrap transition ${id === active ? 'bg-violet-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}"><i data-lucide="${icon}" class="w-4 h-4"></i>${label}</button>`).join('')}
    </nav>`;
const bindTabs = (container, active, onSwitchTab) => container.querySelectorAll('.oc-tab').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab !== active) onSwitchTab(b.dataset.tab); }));
const shell = (container, active, onSwitchTab) => {
    container.innerHTML = `<div class="space-y-4">${tabsHtml(active)}<div id="oc-body"></div></div>`;
    bindTabs(container, active, onSwitchTab);
    return container.querySelector('#oc-body');
};
const kpi = (label, value, cls = 'text-slate-900', sub = '') => `<div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm"><div class="text-[11px] font-bold text-slate-500">${label}</div><div class="text-xl font-black ${cls}">${value}</div>${sub ? `<div class="text-[10px] text-slate-400">${sub}</div>` : ''}</div>`;
const btnCls = (c = 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50') => `px-3 py-2 rounded-lg text-xs font-black flex items-center gap-1.5 transition ${c}`;
const openRequest = (r, onSwitchTab) => { window.__reqOpen = { id: r.id, type: reqTypeOf(r), month: monthOf(r.reqDate || r.period) }; onSwitchTab('prodRequest'); };

// ---------- 생산요청서 탭 ----------
export const renderOrderProdRequest = (container, opts) => {
    const body = shell(container, 'prodRequest', opts.onSwitchTab);
    renderProductionRequest(body, opts);
    createIcons({ icons });
};

// ---------- 주문관리 탭 ----------
const dBadge = (o) => {
    if (o.state === 'REJECTED') return '<span class="px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 text-[10px] font-black">반려</span>';
    if (o.state === 'DONE') return `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-black">완료${o.onTime === false ? ' (납기 지남)' : ''}</span>`;
    if (o.daysLeft === null) return '';
    if (o.daysLeft < 0) return `<span class="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black">납기 D+${-o.daysLeft}</span>`;
    return `<span class="px-1.5 py-0.5 rounded ${o.daysLeft <= 3 ? 'bg-rose-100 text-rose-700' : o.daysLeft <= 7 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'} text-[10px] font-black">${o.daysLeft === 0 ? '오늘 납기' : `D-${o.daysLeft}`}</span>`;
};
const stepper = (o) => {
    const cur = o.state === 'OPEN' ? o.steps.findIndex(s => !s.na && !s.done) : -1;
    return `<ol class="flex items-start gap-0 overflow-x-auto pb-1">${o.steps.map((s, i) => {
        const cls = s.na ? 'bg-white border-dashed border-slate-300 text-slate-300' : s.done ? 'bg-emerald-500 border-emerald-500 text-white' : s.partial ? 'bg-amber-400 border-amber-400 text-white' : i === cur ? 'bg-white border-violet-500 text-violet-600 ring-2 ring-violet-200' : 'bg-white border-slate-300 text-slate-400';
        const line = i < o.steps.length - 1 ? `<span class="absolute top-2.5 left-1/2 w-full h-0.5 ${s.done && !s.na ? 'bg-emerald-300' : 'bg-slate-200'}"></span>` : '';
        return `<li class="relative flex-1 min-w-[52px] flex flex-col items-center text-center">${line}
            <span class="relative z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-black ${cls}">${s.na ? '–' : s.done ? '✓' : s.partial ? '…' : i + 1}</span>
            <span class="mt-0.5 text-[10px] font-bold ${s.na ? 'text-slate-300' : i === cur ? 'text-violet-700' : 'text-slate-600'} whitespace-nowrap">${s.label}</span>
            <span class="text-[9px] text-slate-400 whitespace-nowrap">${s.na ? '해당 없음' : esc(String(s.date || '').replace(/^\d{4}-/, '').replace('-', '/'))}</span></li>`;
    }).join('')}</ol>`;
};

export const renderOrderBoard = (container, { showToast, onSwitchTab }) => {
    const body = shell(container, 'orderBoard', onSwitchTab);
    const canWrite = canPerformAction('PRODUCTION');
    const today = localDateStr();
    const pref = { kind: 'PRODUCT', status: 'OPEN', unit: 'month', ...loadPref() };
    let q = '';
    let data = { orders: [], slips: [], sheetDate: '' };
    let aggYear = Number(today.slice(0, 4));
    body.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-start justify-between gap-3">
            <div>
                <div class="text-[11px] font-black text-violet-600 flex items-center gap-1"><i data-lucide="list-ordered" class="w-3.5 h-3.5"></i>주문·계획 › 주문관리</div>
                <h2 class="text-lg font-black text-slate-900 mt-1">주문관리 (생산요청 → 출하)</h2>
                <p class="text-xs text-slate-500 mt-1">생산요청서로 들어온 주문을 <b>납기 순</b>으로 정리해 출하될 때까지 따라갑니다. 아직 반영 안 된 요청서는 <b>한 번에 반영</b>으로 생산(포장) 스케줄·주간 생산계획·일정관리에 넣습니다.</p>
            </div>
            <div class="flex flex-wrap gap-2">
                ${canWrite ? `<button type="button" id="ob-reflect" class="${btnCls('bg-violet-600 text-white hover:bg-violet-700')}"><i data-lucide="refresh-cw" class="w-4 h-4"></i>미반영 요청서 한 번에 반영</button>
                <button type="button" id="ob-new" class="${btnCls('bg-amber-500 text-white hover:bg-amber-600')}"><i data-lucide="plus" class="w-4 h-4"></i>새 생산요청서</button>` : ''}
            </div>
        </div>
        <div id="ob-kpi" class="grid grid-cols-2 md:grid-cols-5 gap-3"></div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap gap-2 items-center text-xs">
                <select id="ob-kind" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                    <option value="PRODUCT">제품생산요청</option><option value="RAW">원액생산요청</option><option value="ALL">전체</option>
                </select>
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">${[['OPEN', '진행 중'], ['DONE', '완료'], ['REJECTED', '반려'], ['ALL', '전체']].map(([k, l]) => `<button type="button" data-s="${k}" class="ob-status tap-compact px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
                <input id="ob-q" type="search" placeholder="요청번호·거래처·품목·주문번호 검색" class="flex-1 min-w-[160px] border border-slate-300 rounded-lg px-2 py-1.5" />
                <span id="ob-sheet" class="text-[11px] text-slate-400"></span>
            </div>
            <div id="ob-list" class="space-y-4"><div class="p-8 text-center text-xs text-slate-400">불러오는 중...</div></div>
        </div>
        <div id="ob-mat" class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3"><div class="text-xs text-slate-400">원부자재 소요 계산 중...</div></div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-black text-slate-900 text-sm flex items-center gap-1.5"><i data-lucide="bar-chart-3" class="w-4 h-4 text-violet-600"></i>기간별 집계 (누계)</h3>
                <div class="flex flex-wrap gap-2 items-center text-xs">
                    <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">${Object.entries(PERIOD_UNITS).map(([k, l]) => `<button type="button" data-u="${k}" class="ob-unit tap-compact px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
                    <select id="ob-year" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select>
                    <button type="button" id="ob-csv" class="${btnCls()}"><i data-lucide="download" class="w-4 h-4"></i>CSV</button>
                </div>
            </div>
            <div id="ob-agg" class="overflow-x-auto"></div>
            <p class="text-[11px] text-slate-400">요청 = 요청일 기준 · 생산완료 = 스케줄 생산 완료일 · 완료 = 출하 완료일(원액은 생산 완료일), 납기 준수 = 완료일 ≤ 납기 · 출하요청·출하완료 = 출하요청서(RQ) 발행일·출고 완료일 (연결 안 된 출하요청서 포함).</p>
        </div>
    </section>`;
    const $ = (s) => body.querySelector(s);
    $('#ob-kind').value = pref.kind;
    const paintChips = () => {
        body.querySelectorAll('.ob-status').forEach(b => { b.className = `ob-status tap-compact px-3 py-1.5 rounded-lg font-black ${b.dataset.s === pref.status ? 'bg-white shadow-sm text-violet-700' : 'text-slate-600'}`; });
        body.querySelectorAll('.ob-unit').forEach(b => { b.className = `ob-unit tap-compact px-3 py-1.5 rounded-lg font-black ${b.dataset.u === pref.unit ? 'bg-white shadow-sm text-violet-700' : 'text-slate-600'}`; });
        $('#ob-year').classList.toggle('hidden', pref.unit === 'year');
    };
    const years = Array.from({ length: 5 }, (_, i) => aggYear - i);
    $('#ob-year').innerHTML = years.map(y => `<option value="${y}">${y}년</option>`).join('');

    const kindOk = (o) => pref.kind === 'ALL' || (pref.kind === 'RAW') === o.raw;
    const matches = (o) => {
        if (!q) return true;
        const r = o.r;
        return [r.docNo, r.partner, r.orderNo, r.requester, r.assigneeName, ...o.lines.map(l => `${l.code} ${l.name}`), ...o.slips.map(s => s.docNo)].join(' ').toLowerCase().includes(q);
    };
    const renderKpi = () => {
        const os = data.orders.filter(kindOk);
        const open = os.filter(o => o.state === 'OPEN');
        const month = today.slice(0, 7);
        $('#ob-kpi').innerHTML = [
            kpi('진행 중 주문', `${open.length}건`, 'text-violet-700'),
            kpi('납기 7일 이내', `${open.filter(o => o.daysLeft !== null && o.daysLeft >= 0 && o.daysLeft <= 7).length}건`, 'text-amber-600'),
            kpi('납기 지남', `${open.filter(o => o.overdue).length}건`, 'text-rose-600'),
            kpi('생산완료·출하 대기', `${open.filter(o => o.produced && !o.shipped).length}건`, 'text-blue-600'),
            kpi('이번 달 완료', `${os.filter(o => o.complete && String(o.completedAt).startsWith(month)).length}건`, 'text-emerald-600', `출하요청서 ${data.slips.filter(s => String(s.date).startsWith(month)).length}건 발행`)
        ].join('');
    };
    // ---------- 원부자재 소요 ----------
    let mat = null;
    const matBadge = (o) => {
        const m = mat?.orders.get(o.id);
        if (!m || o.state !== 'OPEN' || m.status === 'DONE') return '';
        const s = ORDER_MAT_STATUS[m.status];
        return `<button type="button" class="ob-mat-one tap-compact px-1.5 py-0.5 rounded text-[10px] font-black ${s.cls}" data-id="${esc(o.id)}" title="필요 원부자재 보기">🧪 ${s.label}${m.shortCount ? ` ${m.shortCount}` : ''}</button>`;
    };
    const fmtN = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
    const openMatDetail = (o) => openOrderMatDialog({ docNo: o.docNo, partner: o.r.partner, due: o.due }, mat?.orders.get(o.id));
    const renderMat = () => {
        const host = $('#ob-mat');
        if (!mat) { host.innerHTML = '<div class="text-xs text-slate-400">원부자재 소요를 계산하지 못했습니다.</div>'; return; }
        const open = data.orders.filter(o => o.state === 'OPEN' && !o.raw);
        const cnt = (s) => open.filter(o => mat.orders.get(o.id)?.status === s).length;
        const shortRows = mat.materials.filter(x => x.short > 0);
        const list = matAll ? mat.materials : shortRows;
        host.innerHTML = `
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-black text-slate-900 text-sm flex items-center gap-1.5"><i data-lucide="flask-conical" class="w-4 h-4 text-violet-600"></i>원부자재 소요 · 부족 <span class="text-[11px] font-bold text-slate-400">진행 중 제품 주문, 납기 순 재고 배정</span></h3>
                <div class="flex flex-wrap gap-1.5 text-xs">
                    ${canWrite && shortRows.some(x => x.target === 'PURCH') ? `<button type="button" id="ob-mat-purch" class="${btnCls('bg-teal-600 text-white hover:bg-teal-700')}">🛒 부족 원료·부자재 → 구매요청서 초안</button>` : ''}
                    ${canWrite && shortRows.some(x => x.target === 'RAW') ? `<button type="button" id="ob-mat-raw" class="${btnCls('bg-cyan-600 text-white hover:bg-cyan-700')}">🛢️ 부족 원액 → 원액생산요청서 초안</button>` : ''}
                    <button type="button" id="ob-mat-all" class="${btnCls()}">${matAll ? '부족한 것만' : '전체 보기'}</button>
                </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
                ${[['READY', '재고로 바로 생산 가능'], ['WAIT', '구매·원액 생산 계획 입고 후'], ['SHORT', '계획을 쳐도 모자람'], ['NO_BOM', 'BOM 등록 필요']].map(([k, sub]) => `<div class="p-2.5 rounded-xl bg-slate-50"><div class="text-[10px] font-bold text-slate-500">${ORDER_MAT_STATUS[k].label}</div><div class="text-lg font-black ${k === 'SHORT' ? 'text-rose-600' : k === 'READY' ? 'text-emerald-700' : k === 'WAIT' ? 'text-amber-600' : 'text-slate-600'}">${cnt(k)}건</div><div class="text-[10px] text-slate-400">${sub}</div></div>`).join('')}
                <div class="p-2.5 rounded-xl bg-slate-50"><div class="text-[10px] font-bold text-slate-500">부족 원부자재</div><div class="text-lg font-black ${shortRows.length ? 'text-rose-600' : 'text-slate-800'}">${shortRows.length}종</div><div class="text-[10px] text-slate-400">전체 소요 ${mat.materials.length}종</div></div>
            </div>
            ${mat.missingBom.length ? `<div class="p-2 rounded-lg bg-amber-50 text-[11px] text-amber-800 font-bold">⚠️ BOM이 없는 주문 품목 ${mat.missingBom.length}개: ${esc([...new Set(mat.missingBom.map(x => x.line.name || x.line.code))].slice(0, 6).join(', '))}${mat.missingBom.length > 6 ? ' …' : ''} — 제품생산/입고의 배합비 저장이나 포장사용기준서로 등록하면 계산됩니다.</div>` : ''}
            <div class="overflow-auto max-h-[50vh] border border-slate-200 rounded-xl"><table class="w-full text-xs">
                <thead class="bg-slate-50 text-slate-600 font-bold sticky top-0"><tr><th class="p-2 text-left">원부자재</th><th class="p-2 text-left">분류</th><th class="p-2 text-left">거점</th><th class="p-2 text-right">필요 합계</th><th class="p-2 text-right">재고</th><th class="p-2 text-right">구매 계획</th><th class="p-2 text-right">원액 생산</th><th class="p-2 text-right">부족</th><th class="p-2 text-left">가장 빠른 납기</th><th class="p-2 text-left">관련 주문</th></tr></thead>
                <tbody class="divide-y divide-slate-100">${list.map(x => `<tr class="${x.short > 0 ? 'bg-rose-50/50' : ''}"><td class="p-2"><b>${esc(x.name)}</b> <span class="font-mono text-slate-400">${esc(x.code)}</span></td><td class="p-2">${esc(x.category)}</td><td class="p-2">${esc(x.site)}</td>
                    <td class="p-2 text-right font-mono">${fmtN(x.need)}</td><td class="p-2 text-right font-mono">${fmtN(x.stock)}</td><td class="p-2 text-right font-mono text-amber-700">${x.buy ? fmtN(x.buy) : ''}</td><td class="p-2 text-right font-mono text-cyan-700">${x.prod ? fmtN(x.prod) : ''}</td>
                    <td class="p-2 text-right font-mono font-black ${x.short > 0 ? 'text-rose-600' : 'text-slate-300'}">${x.short > 0 ? fmtN(x.short) : '-'} <span class="font-normal text-slate-400">${esc(x.unit)}</span></td><td class="p-2 font-mono">${esc(x.firstDue || '-')}</td><td class="p-2 text-slate-500">${esc([...new Set(x.orders)].join(', '))}</td></tr>`).join('') || `<tr><td colspan="10" class="p-6 text-center text-slate-400 font-bold">${matAll ? '진행 중 주문에 BOM이 등록된 품목이 없습니다.' : '✅ 부족한 원부자재가 없습니다.'}</td></tr>`}</tbody></table></div>`;
        const draft = (target) => { const tab = draftForShortages(mat.materials, target); if (tab) { showToast(target === 'RAW' ? '🛢️ 부족 원액으로 원액생산요청서 초안을 열었습니다.' : '🛒 부족 원료·부자재로 구매요청서 초안을 열었습니다.'); onSwitchTab(tab); } };
        $('#ob-mat-purch')?.addEventListener('click', () => draft('PURCH'));
        $('#ob-mat-raw')?.addEventListener('click', () => draft('RAW'));
        $('#ob-mat-all').addEventListener('click', () => { matAll = !matAll; renderMat(); });
        createIcons({ icons });
    };
    let matAll = false;

    const card = (o) => {
        const r = o.r;
        const first = o.lines[0];
        return `<div class="p-3 rounded-xl border ${o.overdue ? 'border-rose-300 bg-rose-50/40' : o.state === 'DONE' ? 'border-emerald-200' : 'border-slate-200'} space-y-2">
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
                <button type="button" class="ob-open font-mono font-black text-slate-900 underline decoration-dotted" data-id="${esc(o.id)}">${esc(o.docNo)}</button>
                <span class="px-1.5 py-0.5 rounded text-[10px] font-black ${o.raw ? 'bg-cyan-50 text-cyan-700' : 'bg-amber-50 text-amber-700'}">${o.raw ? '원액' : '제품'}</span>
                ${r.urgent ? '<span class="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-black">긴급</span>' : ''}
                ${dBadge(o)}
                <span class="font-bold text-slate-700 truncate max-w-[40vw]">${esc(o.raw ? (r.moveTo ? `→ ${locationLabel(r.moveTo)}` : '') : (r.partner || '(거래처 없음)'))}</span>
                ${r.orderNo ? `<span class="text-[11px] text-slate-500">주문 ${esc(r.orderNo)}</span>` : ''}
                ${matBadge(o)}
                <span class="ml-auto text-[11px] font-black text-violet-700">${esc(o.stage)}</span>
            </div>
            <div class="text-[11px] text-slate-600">${esc(first ? `${first.name || first.code} ${fmt(first.qty)}${o.unitOf(first)}` : '')}${o.lines.length > 1 ? ` 외 ${o.lines.length - 1}품목` : ''} · 합계 <b>${esc(qtyMapText(o.reqQtyMap))}</b> · 요청 ${esc(r.reqDate || '')} · 납기 <b>${esc(r.dueDate || '-')}</b> · ${esc(r.site || '')}${r.assigneeName ? ` · 담당 ${esc(r.assigneeName)}` : ''}
                ${o.slips.length ? ` · 출하 ${fmt(o.shippedQty)} / ${fmt(o.reqQty)}` : ''}</div>
            ${stepper(o)}
            <div class="flex flex-wrap gap-1.5 items-center">
                ${o.slips.map(s => `<button type="button" class="ob-slip tap-compact px-2 py-1 rounded-lg border text-[11px] font-bold ${s.shippedAt ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-blue-200 bg-blue-50 text-blue-700'}" data-no="${esc(s.docNo)}">🚚 ${esc(s.docNo)} ${esc(s.date.slice(5))}${s.shippedAt ? ' ✓' : ''}</button>`).join('')}
                <span class="flex-1"></span>
                ${canWrite && o.needsReflect ? `<button type="button" class="ob-reflect-one ${btnCls('bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100')}" data-id="${esc(o.id)}"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>스케줄·계획 반영</button>` : ''}
                ${canWrite && !o.raw && o.state === 'OPEN' && !o.shipped ? `<button type="button" class="ob-ship ${btnCls('bg-blue-600 text-white hover:bg-blue-700')}" data-id="${esc(o.id)}"><i data-lucide="truck" class="w-3.5 h-3.5"></i>출하요청서 작성</button>` : ''}
                <button type="button" class="ob-share ${btnCls()}" data-id="${esc(o.id)}"><i data-lucide="share-2" class="w-3.5 h-3.5"></i>공유</button>
            </div>
        </div>`;
    };
    const renderList = () => {
        const os = data.orders.filter(o => kindOk(o) && (pref.status === 'ALL' || o.state === pref.status) && matches(o));
        if (!os.length) { $('#ob-list').innerHTML = '<div class="p-8 text-center text-xs text-slate-400">해당하는 주문이 없습니다.</div>'; return; }
        // 진행 중: 납기 순 (지남 → 이번 주 → 다음 주 → 이후 → 납기 없음), 완료·반려: 최근 순
        const groups = [];
        const push = (label, cls, list) => { if (list.length) groups.push({ label, cls, list }); };
        const open = os.filter(o => o.state === 'OPEN').sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.r.reqDate).localeCompare(String(b.r.reqDate)));
        push('납기 지남', 'text-rose-600', open.filter(o => o.overdue));
        push('7일 이내', 'text-amber-600', open.filter(o => !o.overdue && o.daysLeft !== null && o.daysLeft <= 7));
        push('8~30일', 'text-slate-700', open.filter(o => o.daysLeft !== null && o.daysLeft > 7 && o.daysLeft <= 30));
        push('30일 이후', 'text-slate-500', open.filter(o => o.daysLeft !== null && o.daysLeft > 30));
        push('납기 미정', 'text-slate-400', open.filter(o => o.daysLeft === null));
        push('완료', 'text-emerald-600', os.filter(o => o.state === 'DONE').sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))));
        push('반려', 'text-slate-400', os.filter(o => o.state === 'REJECTED').sort((a, b) => String(b.r.reqDate).localeCompare(String(a.r.reqDate))));
        $('#ob-list').innerHTML = groups.map(g => `<div class="space-y-2"><div class="text-xs font-black ${g.cls}">${g.label} <span class="text-slate-400">${g.list.length}건</span></div>${g.list.map(card).join('')}</div>`).join('');
        const byId = (id) => data.orders.find(o => o.id === id);
        body.querySelectorAll('.ob-open').forEach(b => b.addEventListener('click', () => openRequest(byId(b.dataset.id).r, onSwitchTab)));
        body.querySelectorAll('.ob-mat-one').forEach(b => b.addEventListener('click', () => openMatDetail(byId(b.dataset.id))));
        body.querySelectorAll('.ob-share').forEach(b => b.addEventListener('click', () => openShareDialog(requestShare(byId(b.dataset.id).r), { showToast })));
        body.querySelectorAll('.ob-slip').forEach(b => b.addEventListener('click', () => { window.__shipOpenDocNo = b.dataset.no; onSwitchTab('shipRequest'); }));
        body.querySelectorAll('.ob-reflect-one').forEach(b => b.addEventListener('click', async () => {
            b.disabled = true;
            try {
                const pr = await reflectRequest(byId(b.dataset.id).r);
                showToast(pr ? `📋 ${byId(b.dataset.id).docNo} 반영: 주간 생산계획 ${pr.count}줄${pr.sync?.schedule ? ` · 생산 스케줄 추가 ${pr.sync.schedule.added}·수정 ${pr.sync.schedule.updated}` : ''}${pr.sync?.calendar?.date ? ` · 일정관리 ${pr.sync.calendar.date}` : ''}` : 'ℹ️ 반영할 내용이 없습니다 (계획에서 직접 불러온 요청서).');
                if (pr?.sync?.errors?.length) showToast(`⚠️ ${pr.sync.errors.join(' / ')}`);
            } catch (e) { showToast(`⚠️ ${e.message}`); }
            load();
        }));
        body.querySelectorAll('.ob-ship').forEach(b => b.addEventListener('click', () => {
            const o = byId(b.dataset.id); const r = o.r;
            // 남은 수량(연결 전표 수량을 뺀)으로 출하요청서 초안
            const sent = {};
            o.slips.forEach(s => (s.items || []).forEach(it => { sent[it.code] = (sent[it.code] || 0) + (Number(it.qty) || 0); }));
            const items = o.lines.map(l => {
                const left = Math.max(0, (Number(l.qty) || 0) - (sent[l.code] || 0)); if (l.code) sent[l.code] = Math.max(0, (sent[l.code] || 0) - (Number(l.qty) || 0));
                return { code: l.code || '', name: l.name || '', spec: l.spec || state.master.find(m => m.code === l.code)?.spec || '', qty: left, unit: o.unitOf(l), note: '' };
            }).filter(it => it.qty > 0);
            window.__slipDraft = { type: 'RELEASE', date: r.dueDate && r.dueDate >= today ? r.dueDate : today, fromLoc: r.site || '본사', toLoc: EXTERNAL, partner: r.partner || '', transport: '사내 차량',
                reason: `생산요청서 ${r.docNo} 출하${r.orderNo ? ` · 주문 ${r.orderNo}` : ''}`, notice: `🔗 생산요청서 ${r.docNo}의 남은 품목으로 출하요청서를 채웠습니다. 출발지·날짜·수량을 확인하고 발행하세요.`, items: items.length ? items : o.lines.map(l => ({ code: l.code || '', name: l.name || '', spec: l.spec || '', qty: Number(l.qty) || 0, unit: o.unitOf(l), note: '' })) };
            window.__shipOrderId = r.id;
            onSwitchTab('shipRequest');
        }));
        createIcons({ icons });
    };

    // 기간별 집계 (선택 연도, 년간은 최근 5년). 앞 해 요청서도 불러와 그 해에 생산·출하된 것을 센다
    let aggRows = [];
    const renderAgg = async () => {
        const host = $('#ob-agg');
        host.innerHTML = '<div class="p-6 text-center text-xs text-slate-400">집계 중...</div>';
        const from = pref.unit === 'year' ? `${aggYear - 4}-01-01` : `${aggYear}-01-01`;
        // 아직 오지 않은 기간은 빼되, 미리 발행한 출하요청서 날짜까지는 보여 준다 (아래에서 d.slips로 다시 맞춤)
        let to = `${aggYear}-12-31`;
        try {
            const d = await loadOrderData({ from: `${Number(from.slice(0, 4)) - 1}-01-01`, to });
            const orders = d.orders.filter(kindOk);
            const last = [today, ...d.slips.map(s => s.date)].filter(x => x <= to).sort().pop();
            if (last < to) to = last;
            aggRows = aggregateOrders(orders, pref.kind === 'RAW' ? [] : d.slips.filter(s => s.date <= to), pref.unit, from, to)
;
        } catch (e) { host.innerHTML = `<div class="p-3 text-xs text-rose-600 font-bold">${esc(e.message)}</div>`; return; }
        const th = (t, cls = '') => `<th class="px-2 py-1.5 border-b border-slate-200 text-[11px] font-black text-slate-600 whitespace-nowrap ${cls}">${t}</th>`;
        const td = (v, cls = '') => `<td class="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap ${cls}">${v}</td>`;
        const sum = aggRows.reduce((s, b) => ({ req: s.req + b.req, rejected: s.rejected + b.rejected, produced: s.produced + b.produced, done: s.done + b.done, onTime: s.onTime + b.onTime, late: s.late + b.late, shipReq: s.shipReq + b.shipReq, shipped: s.shipped + b.shipped }), { req: 0, rejected: 0, produced: 0, done: 0, onTime: 0, late: 0, shipReq: 0, shipped: 0 });
        const rate = (b) => (b.onTime + b.late ? `${Math.round(b.onTime / (b.onTime + b.late) * 100)}%` : '-');
        const rows = [...aggRows].reverse(); // 최근 기간이 위
        host.innerHTML = `<table class="min-w-full text-xs">
            <thead class="bg-slate-50"><tr>${th('기간', 'text-left')}${th('생산요청', 'text-right')}${th('요청 수량', 'text-right')}${th('반려', 'text-right')}${th('생산완료', 'text-right')}${th('완료(출하)', 'text-right')}${th('납기 준수', 'text-right')}${th('출하요청서', 'text-right')}${th('출하완료', 'text-right')}${th('출하 수량', 'text-right')}${th('누계 요청', 'text-right')}${th('누계 완료', 'text-right')}${th('누계 출하', 'text-right')}</tr></thead>
            <tbody>${rows.map(b => `<tr class="${b.req || b.done || b.shipped || b.shipReq ? '' : 'text-slate-300'}">${td(esc(b.label), 'font-bold')}${td(b.req, 'text-right font-black')}${td(esc(qtyMapText(b.reqQty)), 'text-right')}${td(b.rejected || '', 'text-right')}${td(b.produced, 'text-right')}${td(b.done, 'text-right font-black text-emerald-700')}${td(rate(b), 'text-right')}${td(b.shipReq, 'text-right')}${td(b.shipped, 'text-right')}${td(esc(qtyMapText(b.shippedQty)), 'text-right')}${td(b.cumReq, 'text-right text-slate-500')}${td(b.cumDone, 'text-right text-slate-500')}${td(b.cumShipped, 'text-right text-slate-500')}</tr>`).join('')}</tbody>
            <tfoot class="bg-violet-50 font-black"><tr>${td('합계')}${td(sum.req, 'text-right')}${td('')}${td(sum.rejected || '', 'text-right')}${td(sum.produced, 'text-right')}${td(sum.done, 'text-right text-emerald-700')}${td(rate(sum), 'text-right')}${td(sum.shipReq, 'text-right')}${td(sum.shipped, 'text-right')}${td('')}${td('')}${td('')}${td('')}</tr></tfoot>
        </table>`;
    };

    const load = async () => {
        try {
            // 진행 중 주문은 오래됐을 수 있어 1년 전 요청서부터
            data = await loadOrderData({ from: addDays(today, -365) });
        } catch (e) { $('#ob-list').innerHTML = `<div class="p-3 text-xs text-rose-600 font-bold">${esc(e.message)}</div>`; return; }
        $('#ob-sheet').textContent = data.sheetDate ? `생산 스케줄 기준 작성일자 ${data.sheetDate}` : '';
        // 원부자재 소요 (services/orderMaterials.js): BOM·계획을 받아 납기 순으로 재고 배정
        try { await loadBoms(); mat = computeOrderMaterials(data.orders, await loadSupplyPlans()); } catch (e) { mat = null; console.warn('[소요 계산]', e); }
        renderKpi(); renderList(); renderMat();
    };

    body.querySelectorAll('.ob-status').forEach(b => b.addEventListener('click', () => { pref.status = b.dataset.s; savePref(pref); paintChips(); renderList(); }));
    body.querySelectorAll('.ob-unit').forEach(b => b.addEventListener('click', () => { pref.unit = b.dataset.u; savePref(pref); paintChips(); renderAgg(); }));
    $('#ob-kind').addEventListener('change', (e) => { pref.kind = e.target.value; savePref(pref); renderKpi(); renderList(); renderAgg(); });
    $('#ob-year').addEventListener('change', (e) => { aggYear = Number(e.target.value); renderAgg(); });
    $('#ob-q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); renderList(); });
    $('#ob-new')?.addEventListener('click', () => onSwitchTab('prodRequest'));
    $('#ob-csv').addEventListener('click', () => {
        const head = ['기간', '생산요청', '요청수량', '반려', '생산완료', '완료(출하)', '납기준수', '납기지남', '출하요청서', '출하완료', '출하수량', '누계요청', '누계완료', '누계출하'];
        const csv = [head, ...aggRows.map(b => [b.label, b.req, qtyMapText(b.reqQty), b.rejected, b.produced, b.done, b.onTime, b.late, b.shipReq, b.shipped, qtyMapText(b.shippedQty), b.cumReq, b.cumDone, b.cumShipped])]
            .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `주문집계_${PERIOD_UNITS[pref.unit]}_${pref.unit === 'year' ? `${aggYear - 4}-${aggYear}` : aggYear}.csv`;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    $('#ob-reflect')?.addEventListener('click', async () => {
        const list = data.orders.filter(o => o.needsReflect);
        if (!list.length) { showToast('ℹ️ 반영할 요청서가 없습니다. 모두 생산 스케줄·계획에 들어가 있습니다.'); return; }
        if (!confirm(`아직 반영 안 된 생산요청서 ${list.length}건을 생산(포장) 스케줄·주간 생산계획·일정관리에 넣을까요?\n${list.slice(0, 10).map(o => `· ${o.docNo} ${o.r.partner || ''}`).join('\n')}${list.length > 10 ? `\n· 외 ${list.length - 10}건` : ''}`)) return;
        const btn = $('#ob-reflect'); btn.disabled = true;
        let ok = 0; const errs = [];
        for (const o of list) {
            try { const pr = await reflectRequest(o.r); if (pr) ok += 1; if (pr?.sync?.errors?.length) errs.push(`${o.docNo}: ${pr.sync.errors.join(', ')}`); } catch (e) { errs.push(`${o.docNo}: ${e.message}`); }
        }
        btn.disabled = false;
        showToast(`📋 ${ok}건을 생산 스케줄·생산계획·일정관리에 반영했습니다.`);
        if (errs.length) showToast(`⚠️ ${errs.slice(0, 3).join(' / ')}`);
        load();
    });
    paintChips();
    createIcons({ icons });
    load(); renderAgg();
};

// ---------- 출하요청서 탭 ----------
export const renderShipRequest = (container, { showToast, onSwitchTab }) => {
    const body = shell(container, 'shipRequest', onSwitchTab);
    const canWrite = canPerformAction('PRODUCTION');
    const today = localDateStr();
    let month = today.slice(0, 7);
    let status = 'ALL';
    let q = '';
    let slips = [];
    let reqs = [];
    // 주문관리 [출하요청서 작성]으로 온 주문 (발행하면 그 요청서에 전표를 잇는다)
    let pendingOrderId = window.__shipOrderId || null;
    window.__shipOrderId = null;
    const openNo = window.__shipOpenDocNo || null;
    window.__shipOpenDocNo = null;
    body.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-start justify-between gap-3">
            <div>
                <div class="text-[11px] font-black text-blue-600 flex items-center gap-1"><i data-lucide="truck" class="w-3.5 h-3.5"></i>주문·계획 › 출하요청서</div>
                <h2 class="text-lg font-black text-slate-900 mt-1">출하요청서</h2>
                <p class="text-xs text-slate-500 mt-1">출하(출고)요청서(RQ)를 발행하고 출하 상태를 한곳에서 관리합니다. 발행하면 일정관리 출하예정·일일 생산계획 업무에 들어가고, 생산요청서(주문)와 이어 주문관리에서 출하까지 따라갑니다.</p>
            </div>
            ${canWrite ? `<button type="button" id="sr-new" class="${btnCls('bg-blue-600 text-white hover:bg-blue-700')}"><i data-lucide="plus" class="w-4 h-4"></i>새 출하요청서</button>` : ''}
        </div>
        <div id="sr-issuer-wrap" class="hidden bg-white p-3 rounded-2xl border-2 border-blue-200 shadow-sm space-y-2">
            <div class="flex items-center justify-between"><div id="sr-issuer-title" class="text-xs font-black text-blue-700">출하요청서 발행</div><button type="button" id="sr-issuer-close" class="${btnCls()}">닫기</button></div>
            <section id="sr-issuer" class="max-w-6xl"></section>
        </div>
        <div id="sr-kpi" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap gap-2 items-center text-xs">
                <input type="month" id="sr-month" value="${month}" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold" />
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">${[['ALL', '전체'], ['WAIT', '출하 대기'], ['DONE', '출하 완료']].map(([k, l]) => `<button type="button" data-s="${k}" class="sr-status tap-compact px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
                <input id="sr-q" type="search" placeholder="전표번호·거래처·품목·요청서 검색" class="flex-1 min-w-[160px] border border-slate-300 rounded-lg px-2 py-1.5" />
            </div>
            <div id="sr-list" class="overflow-x-auto"><div class="p-8 text-center text-xs text-slate-400">불러오는 중...</div></div>
        </div>
    </section>`;
    const $ = (s) => body.querySelector(s);
    const orderOf = (s) => reqs.find(r => slipLinked(r, s));

    // 발행기 (처음 열 때 한 번 만든다)
    let issuerReady = false;
    const openIssuer = (title = '출하요청서 발행') => {
        $('#sr-issuer-wrap').classList.remove('hidden');
        $('#sr-issuer-title').textContent = title;
        const host = $('#sr-issuer');
        if (!issuerReady) {
            setupSlipIssuer(host, {
                showToast, inline: true,
                onIssued: async (s) => {
                    if (s.type === 'RELEASE' && pendingOrderId) {
                        const r = reqs.find(x => x.id === pendingOrderId);
                        pendingOrderId = null;
                        if (r) { try { await linkSlipToOrder(r, s.docNo, true); showToast(`🔗 ${s.docNo}를 생산요청서 ${r.docNo}에 연결했습니다.`); } catch (e) { showToast(`⚠️ 주문 연결: ${e.message}`); } }
                    }
                    load();
                }
            });
            issuerReady = true;
        }
        if (!window.__slipDraft && !window.__slipOpenDocNo) window.__slipNewType = 'RELEASE';
        host.dispatchEvent(new Event('modal:open'));
        createIcons({ icons });
        $('#sr-issuer-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    $('#sr-new')?.addEventListener('click', () => { pendingOrderId = null; openIssuer(); });
    $('#sr-issuer-close').addEventListener('click', () => $('#sr-issuer-wrap').classList.add('hidden'));

    const paintChips = () => body.querySelectorAll('.sr-status').forEach(b => { b.className = `sr-status tap-compact px-3 py-1.5 rounded-lg font-black ${b.dataset.s === status ? 'bg-white shadow-sm text-blue-700' : 'text-slate-600'}`; });
    const renderKpi = () => {
        const wait = slips.filter(s => !s.shippedAt);
        $('#sr-kpi').innerHTML = [
            kpi(`${Number(month.slice(5))}월 발행`, `${slips.length}건`),
            kpi('출하 대기', `${wait.length}건`, 'text-blue-600'),
            kpi('오늘 출하 예정', `${wait.filter(s => s.date === today).length}건`, 'text-amber-600', wait.filter(s => s.date < today).length ? `지난 날짜 미출하 ${wait.filter(s => s.date < today).length}건` : ''),
            kpi('출하 완료', `${slips.length - wait.length}건`, 'text-emerald-600')
        ].join('');
    };
    const renderList = () => {
        const list = slips.filter(s => (status === 'ALL' || (status === 'DONE') === !!s.shippedAt)
            && (!q || [s.docNo, s.partner, s.reason, orderOf(s)?.docNo, orderOf(s)?.orderNo, ...(s.items || []).map(i => `${i.code} ${i.name}`)].join(' ').toLowerCase().includes(q)));
        if (!list.length) { $('#sr-list').innerHTML = '<div class="p-8 text-center text-xs text-slate-400">이 달의 출하요청서가 없습니다.</div>'; return; }
        const th = (t, cls = '') => `<th class="px-2 py-1.5 text-[11px] font-black text-slate-600 whitespace-nowrap text-left ${cls}">${t}</th>`;
        $('#sr-list').innerHTML = `<table class="min-w-full text-xs"><thead class="bg-slate-50 border-b border-slate-200"><tr>${th('전표번호')}${th('출하일')}${th('받는 곳')}${th('품목')}${th('주문 (생산요청서)')}${th('상태')}${th('')}</tr></thead><tbody>
            ${list.map(s => {
                const r = orderOf(s);
                const it = s.items || [];
                const to = s.toLoc === EXTERNAL || !s.toLoc ? (s.partner || EXTERNAL) : locationLabel(s.toLoc);
                return `<tr class="border-b border-slate-100 ${!s.shippedAt && s.date < today ? 'bg-rose-50/50' : ''}">
                    <td class="px-2 py-1.5 font-mono font-black whitespace-nowrap">${esc(s.docNo)}</td>
                    <td class="px-2 py-1.5 whitespace-nowrap">${esc(s.date)}${s.shipTime ? ` ${esc(s.shipTime)}` : ''}</td>
                    <td class="px-2 py-1.5 font-bold">${esc(to)}</td>
                    <td class="px-2 py-1.5">${esc(it[0] ? `${it[0].name} ${fmt(it[0].qty)}${it[0].unit || ''}` : '')}${it.length > 1 ? ` 외 ${it.length - 1}` : ''}</td>
                    <td class="px-2 py-1.5 whitespace-nowrap">${r ? `<button type="button" class="sr-order text-violet-700 font-bold underline decoration-dotted" data-id="${esc(r.id)}">${esc(r.docNo)}</button>${r.orderNo ? ` <span class="text-slate-400">${esc(r.orderNo)}</span>` : ''}` : '<span class="text-slate-300">-</span>'}</td>
                    <td class="px-2 py-1.5 whitespace-nowrap">${s.shippedAt ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-black">출하완료 ${esc(String(s.shippedAt).slice(5, 10).replace('-', '/'))}</span>` : `<span class="px-1.5 py-0.5 rounded ${s.date < today ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'} text-[10px] font-black">출하 대기</span>`}</td>
                    <td class="px-2 py-1.5"><div class="flex gap-1 justify-end">
                        <button type="button" class="sr-view tap-compact px-2 py-1 rounded bg-slate-800 text-white font-bold whitespace-nowrap" data-no="${esc(s.docNo)}">보기</button>
                        <button type="button" class="sr-share tap-compact px-2 py-1 rounded border border-emerald-300 text-emerald-700 font-bold whitespace-nowrap" data-no="${esc(s.docNo)}">공유</button>
                        ${canWrite ? `<button type="button" class="sr-link tap-compact px-2 py-1 rounded border border-slate-300 font-bold whitespace-nowrap" data-no="${esc(s.docNo)}">${r ? '연결 변경' : '주문 연결'}</button>` : ''}
                    </div></td></tr>`;
            }).join('')}</tbody></table>`;
        const byNo = (no) => slips.find(s => s.docNo === no);
        body.querySelectorAll('.sr-view').forEach(b => b.addEventListener('click', () => { window.__slipOpenDocNo = b.dataset.no; openIssuer(`출하요청서 ${b.dataset.no}`); }));
        body.querySelectorAll('.sr-share').forEach(b => b.addEventListener('click', () => { const s = byNo(b.dataset.no); openShareDialog(slipShare(s, { orderNo: orderOf(s)?.orderNo || orderOf(s)?.docNo || '' }), { showToast }); }));
        body.querySelectorAll('.sr-order').forEach(b => b.addEventListener('click', () => openRequest(reqs.find(r => r.id === b.dataset.id), onSwitchTab)));
        body.querySelectorAll('.sr-link').forEach(b => b.addEventListener('click', () => linkDialog(byNo(b.dataset.no))));
    };
    // 주문 연결: 진행 중 제품생산요청서 중에서 고른다 (요청서 data.shipNos)
    const linkDialog = async (s) => {
        const cur = orderOf(s);
        const open = reqs.filter(r => reqTypeOf(r) !== 'RAW' && !['REJECTED'].includes(r.status))
            .map(r => buildOrder(r, [], slips)).filter(o => o.state === 'OPEN' || o.id === cur?.id)
            .sort((a, b) => ((b.r.partner || '') === (s.partner || '')) - ((a.r.partner || '') === (s.partner || '')) || String(a.due).localeCompare(String(b.due)));
        const pick = prompt(`${s.docNo}를 연결할 생산요청서 번호를 입력하세요 (비우면 연결 해제)\n\n${open.slice(0, 15).map(o => `${o.docNo}  ${o.r.partner || ''}  납기 ${o.due || '-'}  ${o.lines[0]?.name || ''}${o.lines.length > 1 ? ` 외 ${o.lines.length - 1}` : ''}`).join('\n')}`, cur?.docNo || open[0]?.docNo || '');
        if (pick === null) return;
        const no = pick.trim().toUpperCase();
        try {
            if (cur && cur.docNo !== no) {
                if (!(cur.shipNos || []).includes(s.docNo) && !no) { alert(`전표 사유에 ${cur.docNo}가 적혀 있어 자동으로 연결된 것입니다. 전표관리에서 사유를 고치면 끊어집니다.`); return; }
                await linkSlipToOrder(cur, s.docNo, false);
            }
            if (no) {
                const r = reqs.find(x => x.docNo === no);
                if (!r) { alert(`생산요청서 ${no}를 찾지 못했습니다 (최근 1년).`); return; }
                if (r.id !== cur?.id) await linkSlipToOrder(r, s.docNo, true);
            }
            showToast(no ? `🔗 ${s.docNo} ↔ ${no} 연결했습니다.` : `🔗 ${s.docNo} 연결을 해제했습니다.`);
            load();
        } catch (e) { alert(e.message); }
    };
    const load = async () => {
        try {
            const [ss, rr] = await Promise.all([listSlipsRange({ from: `${month}-01`, to: `${month}-31` }), listPlans('PROD_REQ', addDays(today, -365), '9999')]);
            slips = ss.filter(isShipSlip); reqs = rr.filter(r => r.docNo);
        } catch (e) { $('#sr-list').innerHTML = `<div class="p-3 text-xs text-rose-600 font-bold">${esc(e.message)}</div>`; return; }
        renderKpi(); renderList();
    };
    body.querySelectorAll('.sr-status').forEach(b => b.addEventListener('click', () => { status = b.dataset.s; paintChips(); renderList(); }));
    $('#sr-month').addEventListener('change', (e) => { if (e.target.value) { month = e.target.value; load(); } });
    $('#sr-q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); renderList(); });
    paintChips();
    createIcons({ icons });
    load().then(() => {
        // 주문관리·메시지 접수에서 넘어온 초안 / 전표 열기
        if (window.__slipDraft && canWrite) openIssuer(pendingOrderId ? `출하요청서 발행 · 주문 ${reqs.find(r => r.id === pendingOrderId)?.docNo || ''}` : '출하요청서 발행 (받은 메시지)');
        else if (openNo) { window.__slipOpenDocNo = openNo; openIssuer(`출하요청서 ${openNo}`); }
    });
};
