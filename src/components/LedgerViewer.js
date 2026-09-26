import { state, LEDGER_KINDS } from '../services/db.js';
import { matchesQuery, localDateStr } from '../services/searchUtils.js';
import { sitesOf, RAW_LEDGER_REGIONS } from '../services/locations.js';
import { typeBadge } from './ItemLedger.js';
import * as XLSX from 'xlsx';

import { esc } from '../services/html.js';
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const PAGE_SIZE = 200;
const roundTo = (n) => Math.round(n * 1e6) / 1e6;

// 수불부별 재고 누적 키: 원료수불부는 원료명+지역, 제품·자재수불부는 품목코드+거점
const keyOf = (kind, e) => (kind === 'raw' ? `${e.name}___${e.location || '김포'}` : `${e.code}___${e.location}`);
const unitOf = (kind, e) => (kind === 'raw' ? 'L' : (e.unit || 'EA'));
const locOf = (kind, e) => (kind === 'raw' ? (e.location || '김포') : e.location);

/**
 * 수불부 조회·열람·인쇄 화면 (원료 / 제품 / 자재)
 * - 품목별 집계: 기간의 기초(기간 전 마지막 재고) · 입고 · 출고 · 기말(기간 안 마지막 재고)
 * - 전표 원장: 기간 안의 전표를 입력 순서대로 (재고량은 누적값)
 */
export const renderLedgerViewer = (container, { showToast }) => {
    const firstOfMonth = `${localDateStr().slice(0, 7)}-01`;
    const view = {
        kind: window.__ledgerViewerKind && LEDGER_KINDS[window.__ledgerViewerKind] ? window.__ledgerViewerKind : 'product',
        mode: 'summary', // 'summary' | 'entries'
        from: firstOfMonth,
        to: localDateStr(),
        loc: '',
        type: '',
        q: '',
        page: 1,
        activeOnly: true
    };
    window.__ledgerViewerKind = null;

    const locOptions = () => (view.kind === 'raw'
        ? RAW_LEDGER_REGIONS.map(r => [r.value, r.label])
        : sitesOf(state.locations).map(s => [s, s]));

    container.innerHTML = `
    <div class="space-y-5">
        <div class="bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-800 text-white p-5 sm:p-6 rounded-3xl shadow-lg">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 class="text-xl font-black flex items-center gap-2"><i data-lucide="library" class="w-5 h-5"></i><span>수불부 조회 · 열람 · 인쇄</span></h2>
                    <p class="text-xs text-slate-300 mt-1">원료·제품·자재 수불부 전표를 기간·거점·품목별로 조회하고 A4로 인쇄하거나 엑셀로 내려받습니다.</p>
                </div>
                <div class="flex gap-2">
                    <button type="button" id="lv-print" class="px-4 py-2 bg-white text-slate-900 hover:bg-indigo-50 rounded-xl text-xs font-black flex items-center gap-1.5"><i data-lucide="printer" class="w-4 h-4"></i>A4 인쇄</button>
                    <button type="button" id="lv-excel" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black flex items-center gap-1.5"><i data-lucide="file-spreadsheet" class="w-4 h-4"></i>엑셀</button>
                </div>
            </div>
        </div>

        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 text-xs">
            <div class="flex flex-wrap items-center gap-2">
                <div class="flex bg-slate-100 p-1 rounded-xl font-bold" id="lv-kind-tabs">
                    ${Object.values(LEDGER_KINDS).map(k => `<button type="button" class="lv-kind px-3 py-1.5 rounded-lg" data-kind="${k.key}">${esc(k.label)}</button>`).join('')}
                </div>
                <div class="flex bg-slate-100 p-1 rounded-xl font-bold" id="lv-mode-tabs">
                    <button type="button" class="lv-mode px-3 py-1.5 rounded-lg" data-mode="summary">품목별 집계</button>
                    <button type="button" class="lv-mode px-3 py-1.5 rounded-lg" data-mode="entries">전표 원장</button>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <span class="font-bold text-slate-600">기간</span>
                <input type="date" id="lv-from" value="${view.from}" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold" />
                <span class="text-slate-400">~</span>
                <input type="date" id="lv-to" value="${view.to}" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold" />
                <div class="flex gap-1">
                    <button type="button" class="lv-range px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold" data-range="month">이번 달</button>
                    <button type="button" class="lv-range px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold" data-range="prev">지난 달</button>
                    <button type="button" class="lv-range px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold" data-range="year">올해</button>
                    <button type="button" class="lv-range px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold" data-range="all">전체</button>
                </div>
                <select id="lv-loc" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select>
                <select id="lv-type" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select>
                <input type="text" id="lv-q" placeholder="코드·품명·적요 검색" class="flex-1 min-w-[160px] bg-white border border-slate-300 rounded-lg px-2.5 py-1.5" />
                <label id="lv-active-wrap" class="flex items-center gap-1 font-bold text-slate-600 cursor-pointer"><input type="checkbox" id="lv-active" checked /> 기간 중 변동·재고 있는 품목만</label>
            </div>
        </div>

        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div id="lv-summary-line" class="text-xs font-bold text-slate-600"></div>
            <div class="overflow-auto border border-slate-200 rounded-xl hidden md:block max-h-[65vh]">
                <table class="w-full text-xs" id="lv-table"></table>
            </div>
            <div id="lv-card-list" class="md:hidden space-y-2.5"></div>
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span id="lv-page-info" class="text-slate-500 font-bold"></span>
                <div id="lv-page-buttons" class="flex flex-wrap gap-1"></div>
            </div>
        </div>
    </div>`;

    const $ = (s) => container.querySelector(s);

    const ledger = () => state[LEDGER_KINDS[view.kind].stateKey] || [];

    const matchesBase = (e) => {
        if (view.loc && locOf(view.kind, e) !== view.loc) return false;
        if (view.q && !matchesQuery(e, view.q, ['code', 'rawCode', 'name', 'notes', 'remark'])) return false;
        return true;
    };

    // 품목별 집계 (전표 입력 순서대로 재고가 누적되므로 기초·기말은 해당 시점의 마지막 전표 재고)
    const buildSummary = () => {
        const map = new Map();
        for (const e of ledger()) {
            if (!matchesBase(e)) continue;
            if (view.to && e.date > view.to) continue;
            const k = keyOf(view.kind, e);
            let r = map.get(k);
            if (!r) {
                r = { key: k, code: e.code, name: e.name, location: locOf(view.kind, e), unit: unitOf(view.kind, e), opening: 0, inQty: 0, outQty: 0, closing: 0, count: 0 };
                map.set(k, r);
            }
            if (!r.code && e.code) r.code = e.code; // 코드가 비어 있던 예전 전표 대비
            if (e.rawCode) r.rawCode = e.rawCode; // 원료코드(보안 코드)는 최근 전표 값
            const stock = Number(e.stockQty) || 0;
            if (view.from && e.date < view.from) {
                r.opening = stock;
                r.closing = stock;
            } else if (e.type === '이월') {
                // 전환 시점 기초재고: 입고가 아니라 기초재고로 본다
                r.opening = roundTo(r.opening + (Number(e.inQty) || 0) - (Number(e.outQty) || 0));
                r.closing = stock;
            } else if (!view.type || e.type === view.type) {
                r.inQty += Number(e.inQty) || 0;
                r.outQty += Number(e.outQty) || 0;
                r.closing = stock;
                r.count++;
            } else {
                r.closing = stock;
            }
        }
        let rows = [...map.values()];
        if (view.activeOnly) rows = rows.filter(r => r.count > 0 || r.opening !== 0 || r.closing !== 0);
        return rows.sort((a, b) => (a.location === b.location ? String(a.name).localeCompare(String(b.name), 'ko') : String(a.location).localeCompare(String(b.location), 'ko')));
    };

    const buildEntries = () => ledger().filter(e => matchesBase(e)
        && (!view.from || e.date >= view.from) && (!view.to || e.date <= view.to)
        && (!view.type || e.type === view.type));

    const codeLabel = () => '품목코드';
    const nameLabel = () => (view.kind === 'raw' ? '원료명' : '품목명');
    // 표 열 정의: label, text(행 → 표시 문자열), cls(화면 셀 클래스), num(숫자 열: 오른쪽 정렬·엑셀 숫자), badge(구분 배지)
    // 원료수불부는 원료명 앞에 원료코드(보안 코드) 열을 둔다
    const rawCodeCol = { label: '원료코드', text: r => r.rawCode || '', cls: () => 'font-mono font-bold text-amber-800 whitespace-nowrap' };
    const columnsOf = (isSummary) => {
        if (isSummary) {
            return [
                { label: '거점/지역', text: r => r.location, cls: () => 'font-bold text-slate-700 whitespace-nowrap' },
                { label: codeLabel(), text: r => r.code, cls: () => 'font-mono text-blue-700 whitespace-nowrap' },
                ...(view.kind === 'raw' ? [rawCodeCol] : []),
                { label: nameLabel(), text: r => r.name, cls: () => 'font-bold text-slate-900' },
                { label: '단위', text: r => r.unit, cls: () => 'text-slate-500' },
                { label: '기초재고', text: r => fmt(r.opening), cls: () => 'font-mono', num: true },
                { label: '입고', text: r => (r.inQty ? fmt(r.inQty) : ''), cls: () => 'font-mono text-blue-700', num: true },
                { label: '출고', text: r => (r.outQty ? fmt(r.outQty) : ''), cls: () => 'font-mono text-rose-700', num: true },
                { label: '기말재고', text: r => fmt(r.closing), cls: r => `font-mono font-black ${r.closing < 0 ? 'text-rose-600' : 'text-slate-900'}`, num: true },
                { label: '전표', text: r => String(r.count), cls: () => 'text-slate-500', num: true }
            ];
        }
        return [
            { label: '일자', text: e => e.date, cls: () => 'font-mono whitespace-nowrap' },
            { label: '거점/지역', text: e => locOf(view.kind, e), cls: () => 'font-bold text-slate-700 whitespace-nowrap' },
            { label: codeLabel(), text: e => e.code, cls: () => 'font-mono text-blue-700 whitespace-nowrap' },
            ...(view.kind === 'raw' ? [rawCodeCol] : []),
            { label: nameLabel(), text: e => e.name, cls: () => 'font-bold text-slate-900' },
            { label: '구분', text: e => e.type, cls: () => 'text-center', badge: true },
            { label: '적요', text: e => e.notes, cls: () => 'text-slate-600 max-w-[240px] truncate' },
            { label: '입고', text: e => (e.inQty ? fmt(e.inQty) : ''), cls: () => 'font-mono text-blue-700', num: true },
            { label: '출고', text: e => (e.outQty ? fmt(e.outQty) : ''), cls: () => 'font-mono text-rose-700', num: true },
            { label: '재고', text: e => fmt(e.stockQty), cls: e => `font-mono font-black ${Number(e.stockQty) < 0 ? 'text-rose-600' : 'text-slate-900'}`, num: true },
            { label: '단위', text: e => unitOf(view.kind, e), cls: () => 'text-slate-500' },
            { label: '비고', text: e => e.remark, cls: () => 'text-slate-500 max-w-[160px] truncate' },
            { label: '작업자', text: e => e.worker, cls: () => 'text-slate-500 whitespace-nowrap' }
        ];
    };

    const render = () => {
        container.querySelectorAll('.lv-kind').forEach(b => { b.className = `lv-kind px-3 py-1.5 rounded-lg ${b.dataset.kind === view.kind ? 'bg-white text-indigo-700 shadow-2xs font-black' : 'text-slate-600 hover:text-slate-900'}`; });
        container.querySelectorAll('.lv-mode').forEach(b => { b.className = `lv-mode px-3 py-1.5 rounded-lg ${b.dataset.mode === view.mode ? 'bg-white text-indigo-700 shadow-2xs font-black' : 'text-slate-600 hover:text-slate-900'}`; });
        $('#lv-active-wrap').style.display = view.mode === 'summary' ? '' : 'none';

        const isSummary = view.mode === 'summary';
        const rows = isSummary ? buildSummary() : buildEntries();
        const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        if (view.page > totalPages) view.page = totalPages;
        const start = (view.page - 1) * PAGE_SIZE;
        const pageRows = rows.slice(start, start + PAGE_SIZE);

        const cols = columnsOf(isSummary);
        const cellHtml = (c, r) => {
            const v = c.text(r) ?? '';
            const inner = c.badge ? typeBadge(v) : esc(v);
            return `<td class="p-2.5 ${c.num ? 'text-right' : ''} ${c.cls(r)}" title="${esc(v)}">${inner}</td>`;
        };
        const body = pageRows.map(r => (isSummary
            ? `<tr class="hover:bg-indigo-50/50 cursor-pointer lv-sum-row" data-code="${esc(view.kind === 'raw' ? r.name : r.code)}" data-loc="${esc(r.location)}" title="클릭하면 이 품목의 전표 원장을 봅니다">${cols.map(c => cellHtml(c, r)).join('')}</tr>`
            : `<tr class="hover:bg-slate-50">${cols.map(c => cellHtml(c, r)).join('')}</tr>`)).join('');

        $('#lv-table').innerHTML = `
            <thead class="bg-slate-50 text-slate-600 font-bold sticky top-0 z-10"><tr>${cols.map(c => `<th class="p-2.5 whitespace-nowrap ${c.num ? 'text-right' : c.badge ? 'text-center' : 'text-left'} ${c === rawCodeCol ? 'text-amber-700' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
            <tbody class="divide-y divide-slate-100">${body || `<tr><td colspan="${cols.length}" class="p-8 text-center text-slate-400 font-bold">조건에 맞는 ${isSummary ? '품목' : '전표'}이 없습니다.</td></tr>`}</tbody>`;

        // 모바일 카드: 열 정의를 그대로 재사용해 이름/배지 열은 헤더로, 숫자 열은 요약 그리드로, 나머지는 라벨:값 목록으로 표시
        const nameColIdx = cols.findIndex(c => c.label === nameLabel());
        const badgeColIdx = cols.findIndex(c => c.badge);
        const numColIdxs = cols.map((c, i) => (c.num ? i : -1)).filter(i => i >= 0);
        const restColIdxs = cols.map((_, i) => i).filter(i => i !== nameColIdx && i !== badgeColIdx && !numColIdxs.includes(i));
        const cardHtml = (r) => {
            const nameVal = nameColIdx >= 0 ? esc(cols[nameColIdx].text(r) ?? '') : '';
            const badgeVal = badgeColIdx >= 0 ? typeBadge(cols[badgeColIdx].text(r) ?? '') : '';
            const numHtml = numColIdxs.map(i => `<div><div class="text-slate-400">${esc(cols[i].label)}</div><div class="font-bold ${cols[i].cls(r)}">${esc(cols[i].text(r) ?? '') || '-'}</div></div>`).join('');
            const restHtml = restColIdxs.map(i => {
                const v = cols[i].text(r) ?? '';
                if (!v) return '';
                return `<div class="text-[11px] text-slate-500 truncate" title="${esc(v)}">${esc(cols[i].label)}: ${esc(v)}</div>`;
            }).filter(Boolean).join('');
            const attrs = isSummary ? `data-code="${esc(view.kind === 'raw' ? r.name : r.code)}" data-loc="${esc(r.location)}"` : '';
            return `
                <div class="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm ${isSummary ? 'lv-sum-card cursor-pointer active:bg-indigo-50/50' : ''}" ${attrs}>
                    <div class="flex items-start justify-between gap-2">
                        <div class="font-bold text-slate-900 truncate">${esc(nameVal)}</div>
                        ${badgeVal}
                    </div>
                    ${numColIdxs.length ? `<div class="mt-2 pt-2 border-t border-slate-100 grid grid-cols-${Math.min(numColIdxs.length, 4)} gap-1.5 text-center text-[11px]">${numHtml}</div>` : ''}
                    ${restHtml ? `<div class="mt-1.5 space-y-0.5">${restHtml}</div>` : ''}
                </div>`;
        };
        $('#lv-card-list').innerHTML = pageRows.length
            ? pageRows.map(cardHtml).join('')
            : `<div class="p-8 text-center text-slate-400 font-bold text-xs">조건에 맞는 ${isSummary ? '품목' : '전표'}이 없습니다.</div>`;

        const moving = isSummary ? rows : rows.filter(r => r.type !== '이월'); // 이월은 입고 합계에서 제외
        const tIn = moving.reduce((s, r) => s + (Number(r.inQty) || 0), 0);
        const tOut = moving.reduce((s, r) => s + (Number(r.outQty) || 0), 0);
        $('#lv-summary-line').innerHTML = `${esc(LEDGER_KINDS[view.kind].label)} · ${view.from || '처음'} ~ ${view.to || '현재'} · ${isSummary ? `품목 ${rows.length.toLocaleString()}건` : `전표 ${rows.length.toLocaleString()}건`}
            · <span class="text-blue-700">입고 합계 ${fmt(tIn)}</span> · <span class="text-rose-700">출고 합계 ${fmt(tOut)}</span>
            ${view.kind === 'raw' ? '<span class="text-slate-400"> (원료 단위 L)</span>' : '<span class="text-slate-400"> (단위가 다른 품목의 합계는 참고용)</span>'}`;
        $('#lv-page-info').textContent = rows.length > PAGE_SIZE ? `${(start + 1).toLocaleString()}~${Math.min(start + PAGE_SIZE, rows.length).toLocaleString()} / ${rows.length.toLocaleString()}건 (인쇄·엑셀은 전체)` : '';

        const btns = [];
        if (totalPages > 1) {
            const pages = new Set([1, totalPages, view.page - 2, view.page - 1, view.page, view.page + 1, view.page + 2].filter(p => p >= 1 && p <= totalPages));
            let prev = 0;
            for (const p of [...pages].sort((a, b) => a - b)) {
                if (p - prev > 1) btns.push('<span class="px-1 text-slate-400">…</span>');
                btns.push(`<button type="button" class="lv-page px-2.5 py-1 rounded-lg font-bold ${p === view.page ? 'bg-indigo-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}" data-page="${esc(p)}">${esc(p)}</button>`);
                prev = p;
            }
        }
        $('#lv-page-buttons').innerHTML = btns.join('');
        container.querySelectorAll('.lv-page').forEach(b => b.addEventListener('click', () => { view.page = Number(b.dataset.page); render(); }));
        container.querySelectorAll('.lv-sum-row, .lv-sum-card').forEach(el => el.addEventListener('click', () => {
            view.mode = 'entries';
            view.q = el.dataset.code;
            view.loc = el.dataset.loc;
            $('#lv-q').value = view.q;
            $('#lv-loc').value = view.loc;
            view.page = 1;
            render();
        }));
    };

    const fillFilterOptions = () => {
        $('#lv-loc').innerHTML = `<option value="">${view.kind === 'raw' ? '전체 지역' : '전체 거점'}</option>` + locOptions().map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
        view.loc = '';
        const types = [...new Set(ledger().map(e => e.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
        $('#lv-type').innerHTML = '<option value="">전체 구분</option>' + types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
        view.type = '';
    };

    container.querySelectorAll('.lv-kind').forEach(b => b.addEventListener('click', () => {
        view.kind = b.dataset.kind;
        view.page = 1;
        fillFilterOptions();
        render();
    }));
    container.querySelectorAll('.lv-mode').forEach(b => b.addEventListener('click', () => { view.mode = b.dataset.mode; view.page = 1; render(); }));
    container.querySelectorAll('.lv-range').forEach(b => b.addEventListener('click', () => {
        const today = localDateStr();
        const y = Number(today.slice(0, 4));
        const mo = Number(today.slice(5, 7));
        if (b.dataset.range === 'month') { view.from = `${today.slice(0, 7)}-01`; view.to = today; }
        else if (b.dataset.range === 'prev') {
            const py = mo === 1 ? y - 1 : y;
            const pm = mo === 1 ? 12 : mo - 1;
            view.from = `${py}-${String(pm).padStart(2, '0')}-01`;
            view.to = localDateStr(new Date(py, pm, 0));
        } else if (b.dataset.range === 'year') { view.from = `${y}-01-01`; view.to = today; }
        else { view.from = ''; view.to = ''; }
        $('#lv-from').value = view.from;
        $('#lv-to').value = view.to;
        view.page = 1;
        render();
    }));
    $('#lv-from').addEventListener('change', (e) => { view.from = e.target.value; view.page = 1; render(); });
    $('#lv-to').addEventListener('change', (e) => { view.to = e.target.value; view.page = 1; render(); });
    $('#lv-loc').addEventListener('change', (e) => { view.loc = e.target.value; view.page = 1; render(); });
    $('#lv-type').addEventListener('change', (e) => { view.type = e.target.value; view.page = 1; render(); });
    $('#lv-active').addEventListener('change', (e) => { view.activeOnly = e.target.checked; view.page = 1; render(); });
    let qTimer = null;
    $('#lv-q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { view.q = e.target.value.trim(); view.page = 1; render(); }, 200); });

    const currentTable = () => {
        const isSummary = view.mode === 'summary';
        const rows = isSummary ? buildSummary() : buildEntries();
        const cols = columnsOf(isSummary);
        return {
            isSummary, rows,
            head: cols.map(c => c.label),
            cells: rows.map(r => cols.map(c => c.text(r) ?? '')),
            numCols: cols.map((c, i) => (c.num ? i : -1)).filter(i => i >= 0)
        };
    };
    const titleText = () => `${LEDGER_KINDS[view.kind].label} ${view.mode === 'summary' ? '(품목별 수불 집계)' : '(수불 원장)'}`;
    const periodText = () => `${view.from || '처음'} ~ ${view.to || localDateStr()}`;

    $('#lv-print').addEventListener('click', () => {
        const { head, cells, numCols } = currentTable();
        if (cells.length === 0) { alert('인쇄할 내용이 없습니다.'); return; }
        const w = window.open('', '_blank', 'width=1100,height=800');
        if (!w) { alert('팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.'); return; }
        const filters = [view.loc && `위치: ${view.loc}`, view.type && `구분: ${view.type}`, view.q && `검색: ${view.q}`].filter(Boolean).join(' · ');
        w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(titleText())}</title>
            <style>
                @page { size: A4 landscape; margin: 10mm; }
                body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; color: #0f172a; margin: 0; }
                .head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 6px; }
                h1 { font-size: 18px; margin: 0; }
                .meta { font-size: 10px; color: #475569; }
                table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
                th, td { border: 1px solid #94a3b8; padding: 3px 4px; }
                th { background: #e2e8f0; }
                thead { display: table-header-group; }
                tr { page-break-inside: avoid; }
                .num { text-align: right; font-family: Consolas, monospace; }
                .sign { margin-top: 10px; display: flex; justify-content: flex-end; }
                .sign table { width: auto; }
                .sign td { width: 70px; height: 42px; }
                .sign th { width: 70px; }
            </style></head><body>
            <div class="head">
                <div><h1>${esc(titleText())}</h1><div class="meta">기간: ${esc(periodText())}${filters ? ` · ${esc(filters)}` : ''}</div></div>
                <div class="meta">대림오일 · 출력일 ${esc(localDateStr())} · ${cells.length.toLocaleString()}건</div>
            </div>
            <table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${cells.map(c => `<tr>${c.map((v, i) => `<td class="${numCols.includes(i) ? 'num' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
            <div class="sign"><table><tr><th>담당</th><th>검토</th><th>승인</th></tr><tr><td></td><td></td><td></td></tr></table></div>
            <script>window.onload = () => { window.focus(); window.print(); };<\/script>
            </body></html>`);
        w.document.close();
    });

    $('#lv-excel').addEventListener('click', () => {
        const { head, cells, numCols } = currentTable();
        if (cells.length === 0) { alert('내보낼 내용이 없습니다.'); return; }
        // 수량 열만 숫자로 (품목코드 등은 앞자리 0이 사라지지 않게 문자 유지)
        const ws = XLSX.utils.aoa_to_sheet([head, ...cells.map(c => c.map((v, i) => {
            if (!numCols.includes(i) || v === '') return v ?? '';
            const n = Number(String(v).replace(/,/g, ''));
            return Number.isNaN(n) ? v : n;
        }))]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, LEDGER_KINDS[view.kind].label);
        XLSX.writeFile(wb, `대림오일_${titleText().replace(/[\s()]/g, '')}_${periodText().replace(/\s/g, '')}.xlsx`);
        showToast?.('📥 엑셀 파일을 내려받았습니다.');
    });

    fillFilterOptions();
    render();
};
