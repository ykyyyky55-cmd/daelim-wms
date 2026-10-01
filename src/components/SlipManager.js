import { state, listSlipsRange, deleteSlip, markSlipShipped, unmarkSlipShipped, processStockAction, SLIP_TYPES } from '../services/db.js';
import { allocateStock } from './FieldScanPanels.js';
import { ROLE_LEVEL, canAccessTab } from '../services/auth.js';
import { assignTasks } from '../services/assign.js';
import { SCAN_SLIP_TYPES, listScanSlipsRange, deleteScanSlip, scanPhotoUrl } from '../services/scanSlips.js';
import { openSlipEditor } from './slipEdit.js';
import { openPrintWindow, printSlipEntries, printSlipList } from './slipPrint.js';
import { mountCardMonthly } from './cardMonthly.js';
import { locationLabel, siteOf } from '../services/locations.js';
import { localDateStr, matchesQuery } from '../services/searchUtils.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

// ==========================================
// 생산관리 → 전표관리: 두 가지 전표를 한 목록으로 본다.
//   발행 전표(wms_slips): 전표발행에서 발행. 재고를 바꾸지 않음. 보기·재인쇄·복사·삭제(매니저)
//   스캔 등록(wms_scan_slips): 전표 스캔 등록에서 입고·출고·구매 등으로 재고에 반영한 기록. 사진 보기·삭제(등록한 사람·매니저)
// 기간·구분·종류·상태·거점·검색으로 거르고, 엑셀로 내보낸다.
// ==========================================

const EXTERNAL = '외부 거래처';
const PREF_KEY = 'daelim_slip_manage';
const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } };
const savePref = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* 저장 공간 없음: 무시 */ } };

const monthRange = (offset = 0) => {
    const n = new Date();
    return [localDateStr(new Date(n.getFullYear(), n.getMonth() + offset, 1)), localDateStr(new Date(n.getFullYear(), n.getMonth() + offset + 1, 0))];
};
const PERIODS = {
    thisMonth: { label: '이번 달', range: () => monthRange(0) },
    lastMonth: { label: '지난 달', range: () => monthRange(-1) },
    last3: { label: '최근 3개월', range: () => [monthRange(-2)[0], monthRange(0)[1]] },
    thisYear: { label: '올해', range: () => [`${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`] },
    all: { label: '전체', range: () => ['', ''] }
};
const SOURCES = { '': '전체', ISSUE: '발행 전표', SCAN: '스캔 등록' };
// 전표 분류 탭: 발행 전표 종류(TRANSFER·RELEASE·WAREHOUSE)와 스캔 등록 종류(SCAN:…)를 묶는다.
// new: 탭에서 [새 전표]를 누르면 여는 화면 (issue = 전표발행, scan = 전표 스캔 등록 + 그 종류로 미리 선택)
const CATS = {
    '': { label: '전체', icon: 'files', types: null },
    IN: { label: '입고전표', icon: 'package-plus', types: ['SCAN:IN'], new: { scan: 'IN' } },
    OUT: { label: '출고전표', icon: 'package-minus', types: ['RELEASE', 'SCAN:OUT'], new: { issue: 'RELEASE', scan: 'OUT' } },
    MOVE: { label: '이동전표', icon: 'truck', types: ['TRANSFER', 'WAREHOUSE', 'SCAN:MOVE'], new: { issue: 'TRANSFER', scan: 'MOVE' } },
    BUY: { label: '구매전표', icon: 'shopping-cart', types: ['SCAN:BUY'], new: { scan: 'BUY' } },
    CARD: { label: '카드전표', icon: 'credit-card', types: ['SCAN:CARD'], new: { scan: 'CARD' } },
    ETC: { label: '기타 (사용·폐기)', icon: 'ellipsis', types: ['SCAN:USE', 'SCAN:DISPOSE', 'SCAN:ETC'], new: { scan: 'USE' } }
};
const catOf = (typeKey) => Object.keys(CATS).find(k => k && CATS[k].types.includes(typeKey)) || 'ETC';
const ACTION_TEXT = { IN: '재고 늘림', OUT: '재고 줄임', USE: '재고 줄임 (사용)', MOVE: '창고 이동', NONE: '재고 없음 (카드 사용만)' };

const locText = (loc) => (loc && loc !== EXTERNAL ? locationLabel(loc) : loc || '');
const fmtQty = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });

// 두 가지 전표를 같은 모양으로
const fromIssued = (s) => ({
    src: 'ISSUE', key: `I:${s.docNo}`, no: s.docNo, date: s.date, typeKey: s.type, typeLabel: SLIP_TYPES[s.type]?.label || s.type,
    from: locText(s.fromLoc), to: s.toLoc === EXTERNAL || !s.toLoc ? (s.partner || EXTERNAL) : `${locText(s.toLoc)}${s.partner ? ` (${s.partner})` : ''}`,
    sites: [s.fromLoc, s.toLoc].map(l => (l === EXTERNAL || !l ? EXTERNAL : siteOf(l))),
    partner: s.partner, refNo: '', reason: s.reason, transport: s.transport, worker: s.worker, assignee: s.assigneeName, shipTime: s.shipTime,
    items: s.items.map(it => ({ code: it.code, name: it.name, spec: it.spec, qty: it.qty, unit: it.unit, note: it.note })),
    status: s.shippedAt ? 'DONE' : 'WAIT', statusTitle: s.shippedAt ? `${new Date(s.shippedAt).toLocaleString('ko-KR')} ${s.shippedBy || ''}` : '',
    raw: s
});
const fromScan = (r) => {
    const t = SCAN_SLIP_TYPES[r.kind];
    const party = r.partner || '';
    const from = r.action === 'IN' || r.action === 'NONE' ? (party || '(거래처)') : locText(r.fromLoc);
    const to = r.action === 'NONE' ? '(카드 사용)' : r.action === 'IN' ? locText(r.toLoc) : r.action === 'MOVE' ? locText(r.toLoc) : r.action === 'USE' ? '(사용)' : (party || '(밖으로)');
    return {
        src: 'SCAN', key: `S:${r.id}`, no: r.regNo, date: r.date, typeKey: `SCAN:${r.kind}`, typeLabel: t?.word || r.kind,
        from, to, sites: [r.fromLoc, r.toLoc].filter(Boolean).map(siteOf), partner: party, refNo: r.docNo,
        reason: r.kind === 'CARD' ? [r.amount ? `💳 ${Number(r.amount).toLocaleString('ko-KR')}원` : '', r.card, r.purpose].filter(Boolean).join(' · ') || ACTION_TEXT[r.action] || '' : ACTION_TEXT[r.action] || '',
        transport: '', worker: r.worker || r.by, assignee: '', shipTime: '',
        items: r.items.map(it => ({
            code: it.code, name: it.name, spec: it.spec, qty: it.qty, unit: it.unit,
            note: it.baseUnit && it.unit !== it.baseUnit ? `재고 ${fmtQty(it.baseQty)} ${it.baseUnit}${it.sg ? ` (비중 ${it.sg})` : ''}` : ''
        })),
        status: 'APPLIED', statusTitle: '', hasPhoto: !!(r.files || []).length, raw: r
    };
};

export const renderSlipManager = (container, { showToast = () => {}, onSwitchTab = () => {} } = {}) => {
    const role = state.currentUser?.role || 'VIEWER';
    const level = ROLE_LEVEL[role] || 0;
    const isManager = level >= ROLE_LEVEL.MANAGER;
    const canIssue = canAccessTab('slipIssue', role);
    const myId = state.currentUser?.id || '';
    const pref = loadPref();
    const f = {
        period: PERIODS[pref.period] ? pref.period : 'thisMonth', from: '', to: '',
        cat: CATS[pref.cat] ? pref.cat : '',
        src: SOURCES[pref.src] !== undefined ? pref.src : '', type: pref.type || '', status: pref.status || '', site: pref.site || '', q: ''
    };
    [f.from, f.to] = PERIODS[f.period].range();
    // 전자결재 문서함에서 카드사용내역을 열면 카드전표 탭으로 (window.__slipManageCat)
    if (window.__slipManageCat && CATS[window.__slipManageCat]) { f.cat = window.__slipManageCat; f.type = ''; }
    window.__slipManageCat = null;
    let entries = [];
    let loading = false;
    let error = '';
    let warn = '';
    const open = new Set();
    const picked = new Set(); // 인쇄하려고 고른 전표 (key)
    const $ = (s) => container.querySelector(s);

    container.innerHTML = `
    <div class="space-y-4 text-xs">
        <div class="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg">
            <h2 class="text-xl font-black flex items-center gap-2"><i data-lucide="files" class="w-5 h-5"></i>전표관리</h2>
            <p class="text-xs text-slate-300 mt-1"><b>발행 전표</b>(전표발행, 재고 안 바뀜)와 <b>스캔 등록</b>(전표 스캔 등록으로 재고에 반영한 전표)을 한곳에서 찾아보고, 품목 확인·재인쇄·사진 보기·엑셀 내보내기를 합니다.</p>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-center gap-1.5">
                ${Object.entries(PERIODS).map(([k, p]) => `<button type="button" data-period="${k}" class="sm-period px-2.5 py-1.5 rounded-lg font-bold border">${p.label}</button>`).join('')}
                <span class="flex items-center gap-1 ml-1">
                    <input type="date" id="sm-from" class="border border-slate-300 rounded-lg px-2 py-1 font-bold" />
                    <span class="text-slate-400">~</span>
                    <input type="date" id="sm-to" class="border border-slate-300 rounded-lg px-2 py-1 font-bold" />
                </span>
            </div>
            <div id="sm-cats" class="flex gap-1 overflow-x-auto pb-1 border-b border-slate-200"></div>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
                <label><span class="font-bold text-slate-500">구분</span>
                    <select id="sm-src" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
                <label><span class="font-bold text-slate-500">전표 종류</span>
                    <select id="sm-type" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select></label>
                <label><span class="font-bold text-slate-500">상태</span>
                    <select id="sm-status" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                        <option value="">전체</option><option value="WAIT">출고 대기 (발행 전표)</option><option value="DONE">출고 완료 (발행 전표)</option><option value="APPLIED">재고 반영됨 (스캔 등록)</option>
                    </select></label>
                <label><span class="font-bold text-slate-500">거점 (출발·도착)</span>
                    <select id="sm-site" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select></label>
                <label><span class="font-bold text-slate-500">검색</span>
                    <input id="sm-q" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" placeholder="번호·거래처·품목·담당자" /></label>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <div id="sm-kpi" class="flex flex-wrap gap-1.5"></div>
                <span class="ml-auto flex flex-wrap justify-end gap-1.5">
                    <button type="button" id="sm-reload" class="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold flex items-center gap-1"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>새로고침</button>
                    <button type="button" id="sm-print-sel" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-bold flex items-center gap-1 disabled:opacity-40" disabled><i data-lucide="printer" class="w-3.5 h-3.5"></i><span id="sm-print-sel-text">선택 인쇄</span></button>
                    ${level >= ROLE_LEVEL.OPERATOR ? '<button type="button" id="sm-ship-sel" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-1 disabled:opacity-40" disabled title="고른 전표 가운데 출고 대기인 발행 전표를 한 번에 출고 완료로"><i data-lucide="truck" class="w-3.5 h-3.5"></i><span id="sm-ship-sel-text">선택 출고 완료</span></button>' : ''}
                    ${isManager ? '<button type="button" id="sm-unship-sel" class="px-2.5 py-1.5 bg-white border border-amber-400 text-amber-700 hover:bg-amber-50 rounded-lg font-bold flex items-center gap-1 disabled:opacity-40" disabled title="고른 전표 가운데 출고 완료인 발행 전표를 출고 대기로 되돌린다 (매니저 이상)"><i data-lucide="undo-2" class="w-3.5 h-3.5"></i><span id="sm-unship-sel-text">선택 출고 대기로</span></button>' : ''}
                    <button type="button" id="sm-print-list" class="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold flex items-center gap-1 disabled:opacity-40"><i data-lucide="list" class="w-3.5 h-3.5"></i>목록 인쇄</button>
                    <button type="button" id="sm-excel" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-1 disabled:opacity-40"><i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i>엑셀</button>
                    <span id="sm-new-box" class="flex flex-wrap gap-1.5"></span>
                </span>
            </div>
            <div id="sm-card" class="hidden"></div>
            <div id="sm-list"></div>
        </div>
    </div>`;

    // 전표 종류 목록: 고른 분류 탭·구분에 속한 종류만
    const inCat = (typeKey) => !f.cat || CATS[f.cat].types.includes(typeKey);
    const fillTypes = () => {
        const issued = Object.entries(SLIP_TYPES).filter(([k]) => inCat(k)).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('');
        const scans = Object.entries(SCAN_SLIP_TYPES).filter(([k]) => inCat(`SCAN:${k}`)).map(([k, t]) => `<option value="SCAN:${k}">${esc(t.word)}</option>`).join('');
        $('#sm-type').innerHTML = `<option value="">전체</option>
            ${f.src !== 'SCAN' && issued ? `<optgroup label="발행 전표">${issued}</optgroup>` : ''}
            ${f.src !== 'ISSUE' && scans ? `<optgroup label="스캔 등록">${scans}</optgroup>` : ''}`;
        $('#sm-type').value = f.type;
        if ($('#sm-type').value !== f.type) f.type = '';
    };

    // 분류 탭 (건수는 다른 조건을 적용한 뒤의 수)
    const renderCats = () => {
        const base = filtered({ ignoreCat: true });
        $('#sm-cats').innerHTML = Object.entries(CATS).map(([k, c]) => {
            const n = k ? base.filter(e => catOf(e.typeKey) === k).length : base.length;
            const on = f.cat === k;
            return `<button type="button" data-cat="${k}" class="sm-cat shrink-0 px-3 py-2 rounded-t-lg font-black flex items-center gap-1 border-b-2 ${on ? 'border-indigo-600 text-indigo-700 bg-indigo-50' : 'border-transparent text-slate-600 hover:bg-slate-50'}">
                <i data-lucide="${c.icon}" class="w-3.5 h-3.5"></i>${c.label}<span class="ml-0.5 px-1.5 rounded-full text-[10px] ${on ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}">${n}</span></button>`;
        }).join('');
        container.querySelectorAll('.sm-cat').forEach(b => b.addEventListener('click', () => {
            f.cat = b.dataset.cat;
            fillTypes();
            persist();
            renderList();
        }));
        // 새 전표 버튼: 탭에 맞는 화면으로 (이동·출고는 발행, 입고·구매·카드 등은 스캔 등록)
        const nw = f.cat ? CATS[f.cat].new : { issue: 'TRANSFER', scan: 'IN' };
        const word = f.cat ? CATS[f.cat].label : '전표';
        $('#sm-new-box').innerHTML = `${nw.issue && canIssue ? `<button type="button" id="sm-new" class="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center gap-1"><i data-lucide="file-signature" class="w-3.5 h-3.5"></i>${esc(f.cat ? `${word} 발행` : '새 전표 발행')}</button>` : ''}
            ${nw.scan && canAccessTab('docScan', role) ? `<button type="button" id="sm-scan" class="px-2.5 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold flex items-center gap-1"><i data-lucide="scan-text" class="w-3.5 h-3.5"></i>${esc(f.cat ? `${word} 스캔 등록` : '전표 스캔 등록')}</button>` : ''}`;
        $('#sm-new')?.addEventListener('click', () => { window.__slipNewType = nw.issue; onSwitchTab('slipIssue'); });
        $('#sm-scan')?.addEventListener('click', () => { window.__docScanType = f.cat ? nw.scan : ''; onSwitchTab('docScan'); });
        createIcons({ icons });
    };
    const fillSites = () => {
        const set = new Set((state.locations || []).map(l => siteOf(typeof l === 'string' ? l : l?.name || '')).filter(Boolean));
        entries.forEach(e => e.sites.forEach(x => { if (x && x !== EXTERNAL) set.add(x); }));
        const sel = $('#sm-site');
        sel.innerHTML = `<option value="">전체</option>${[...set].sort().map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}<option value="${EXTERNAL}">${EXTERNAL}</option>`;
        sel.value = f.site;
        if (sel.value !== f.site) f.site = '';
    };

    const filtered = ({ ignoreCat = false } = {}) => entries.filter(e => {
        if (!ignoreCat && f.cat && catOf(e.typeKey) !== f.cat) return false;
        if (f.src && e.src !== f.src) return false;
        if (f.type && e.typeKey !== f.type) return false;
        if (f.status && e.status !== f.status) return false;
        if (f.site && !e.sites.includes(f.site)) return false;
        if (f.q.trim()) {
            const hay = { no: e.no, refNo: e.refNo, partner: e.partner, worker: e.worker, assignee: e.assignee, reason: e.reason, type: e.typeLabel, route: `${e.from} ${e.to}`, items: e.items.map(it => `${it.code} ${it.name} ${it.spec}`).join(' ') };
            if (!matchesQuery(hay, f.q, Object.keys(hay))) return false;
        }
        return true;
    });

    const renderKpi = (list) => {
        const chip = (label, v, cls) => `<span class="px-2 py-1 rounded-lg font-bold ${cls}">${label} <b>${v.toLocaleString()}</b></span>`;
        const issued = list.filter(e => e.src === 'ISSUE');
        $('#sm-kpi').innerHTML = chip('전체', list.length, 'bg-slate-100 text-slate-700')
            + chip('발행', issued.length, 'bg-indigo-100 text-indigo-800')
            + chip('출고 대기', issued.filter(e => e.status === 'WAIT').length, 'bg-amber-100 text-amber-800')
            + chip('스캔 등록', list.length - issued.length, 'bg-teal-100 text-teal-800')
            + chip('품목 줄', list.reduce((a, e) => a + e.items.length, 0), 'bg-slate-100 text-slate-700');
    };

    const statusBadge = (e) => (e.status === 'DONE' ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold" title="${esc(e.statusTitle)}">출고 완료</span>`
        : e.status === 'WAIT' ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">출고 대기</span>'
            : '<span class="px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 font-bold">재고 반영됨</span>');
    const canDeleteScan = (e) => isManager || (myId && e.raw.createdBy === myId) || !e.raw.createdBy;

    // 카드전표 탭: 월별 카드사용내역 (처음 열 때 붙이고, 다른 탭에서는 숨김)
    let cardPanel = null;
    const syncCardPanel = () => {
        const on = f.cat === 'CARD';
        $('#sm-card').classList.toggle('hidden', !on);
        if (on && !cardPanel) {
            cardPanel = mountCardMonthly($('#sm-card'), {
                showToast,
                onEdit: (rec) => openSlipEditor(fromScan(rec), {
                    showToast,
                    onSaved: (raw) => {
                        const next = fromScan(raw);
                        entries = entries.map(x => (x.key === next.key ? next : x));
                        cardPanel?.reload();
                        renderList();
                    }
                })
            });
        }
    };

    const renderList = () => {
        const box = $('#sm-list');
        renderCats();
        syncCardPanel();
        if (loading) { box.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold">불러오는 중…</div>'; return; }
        if (error) { box.innerHTML = `<div class="p-6 text-center text-rose-600 font-bold">${esc(error)}</div>`; return; }
        const list = filtered();
        renderKpi(list);
        $('#sm-excel').disabled = !list.length;
        $('#sm-print-list').disabled = !list.length;
        syncPicked();
        const warnHtml = warn ? `<div class="mb-2 p-2 rounded-lg bg-amber-50 text-amber-800 font-bold">${esc(warn)}</div>` : '';
        if (!list.length) { box.innerHTML = `${warnHtml}<div class="p-8 text-center text-slate-400 font-bold">조건에 맞는 전표가 없습니다.</div>`; return; }
        box.innerHTML = `${warnHtml}
        <div class="overflow-x-auto border border-slate-200 rounded-xl">
            <table class="w-full min-w-[900px]">
                <thead class="bg-slate-50 text-slate-600 font-bold"><tr>
                    <th class="p-2 w-8"><input type="checkbox" id="sm-all" class="w-4 h-4" title="보이는 전표 모두 선택" ${list.every(e => picked.has(e.key)) ? 'checked' : ''} /></th>
                    <th class="p-2 text-left">번호</th><th class="p-2 text-left">일자</th><th class="p-2 text-left">구분·종류</th>
                    <th class="p-2 text-left">출발 → 도착</th><th class="p-2 text-left">품목</th><th class="p-2 text-left">작성·담당</th>
                    <th class="p-2 text-left">상태</th><th class="p-2 text-right">관리</th>
                </tr></thead>
                <tbody class="divide-y divide-slate-100">
                ${list.map(e => {
                    const first = e.items[0];
                    const isOpen = open.has(e.key);
                    const isScan = e.src === 'SCAN';
                    return `<tr data-key="${esc(e.key)}" class="hover:bg-slate-50">
                        <td class="p-2 text-center"><input type="checkbox" class="sm-pick w-4 h-4" ${picked.has(e.key) ? 'checked' : ''} /></td>
                        <td class="p-2 font-mono font-black text-slate-800 whitespace-nowrap"><button type="button" class="sm-toggle hover:text-indigo-700" title="품목 펼치기">${isOpen ? '▾' : '▸'} ${esc(e.no)}</button>${e.refNo ? `<div class="text-[10px] font-normal text-slate-500">원본 No.${esc(e.refNo)}</div>` : ''}</td>
                        <td class="p-2 whitespace-nowrap">${esc(e.date)}${e.shipTime ? `<div class="text-[10px] text-slate-500">⏰ ${esc(e.shipTime)}</div>` : ''}</td>
                        <td class="p-2 whitespace-nowrap"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${isScan ? 'bg-teal-100 text-teal-800' : 'bg-indigo-100 text-indigo-800'}">${isScan ? '스캔' : '발행'}</span> ${esc(e.typeLabel)}</td>
                        <td class="p-2">${esc(e.from || '-')} → ${esc(e.to || '-')}${e.reason ? `<div class="text-[10px] text-slate-500 truncate max-w-[220px]" title="${esc(e.reason)}">${esc(e.reason)}</div>` : ''}</td>
                        <td class="p-2">${first ? `${esc(first.name || first.code)} ${fmtQty(first.qty)}${esc(first.unit)}` : '-'}${e.items.length > 1 ? ` <span class="text-slate-500">외 ${e.items.length - 1}</span>` : ''}</td>
                        <td class="p-2 whitespace-nowrap">${esc(e.worker || '-')}${e.assignee ? `<div class="text-[10px] text-slate-500">담당 ${esc(e.assignee)}</div>` : ''}</td>
                        <td class="p-2 whitespace-nowrap">${statusBadge(e)}</td>
                        <td class="p-2 text-right whitespace-nowrap">
                            <button type="button" class="sm-print px-2 py-1 bg-white border border-slate-300 rounded font-bold" title="이 전표 인쇄">인쇄</button>
                            ${!isScan && canIssue ? `<button type="button" class="sm-view px-2 py-1 bg-slate-800 text-white rounded font-bold">보기·재인쇄</button>
                            <button type="button" class="sm-copy px-2 py-1 bg-white border border-slate-300 rounded font-bold">복사</button>` : ''}
                            ${!isScan && e.status === 'WAIT' && level >= ROLE_LEVEL.OPERATOR ? '<button type="button" class="sm-done px-2 py-1 bg-white border border-emerald-300 text-emerald-700 rounded font-bold" title="출고 완료로 바꾼다 — 표시만 바꿀지, 재고도 함께 옮길지 고른다">출고 완료 처리</button>' : ''}
                            ${!isScan && e.status === 'DONE' && isManager ? '<button type="button" class="sm-undone px-2 py-1 bg-white border border-amber-300 text-amber-700 rounded font-bold" title="출고 완료를 출고 대기로 되돌린다 — 표시만 되돌릴지, 옮긴 재고도 제자리로 돌릴지 고른다">출고 대기로</button>' : ''}
                            ${isScan && e.hasPhoto ? '<button type="button" class="sm-photo px-2 py-1 bg-slate-800 text-white rounded font-bold">사진</button>' : ''}
                            ${(!isScan && isManager) || (isScan && canDeleteScan(e) && level >= ROLE_LEVEL.OPERATOR) ? '<button type="button" class="sm-edit px-2 py-1 bg-white border border-indigo-300 text-indigo-700 rounded font-bold">수정</button>' : ''}
                            ${(!isScan && isManager) || (isScan && canDeleteScan(e)) ? '<button type="button" class="sm-del px-2 py-1 bg-white border border-rose-300 text-rose-600 rounded font-bold">삭제</button>' : ''}
                        </td>
                    </tr>
                    ${isOpen ? `<tr class="bg-slate-50/70"><td></td><td colspan="8" class="p-2">
                        <table class="w-full bg-white border border-slate-200 rounded">
                            <thead class="text-slate-500"><tr><th class="p-1.5 text-left w-8">No</th><th class="p-1.5 text-left">품목코드</th><th class="p-1.5 text-left">품목명</th><th class="p-1.5 text-left">규격</th><th class="p-1.5 text-right">수량</th><th class="p-1.5 text-left">단위</th><th class="p-1.5 text-left">비고</th></tr></thead>
                            <tbody>${e.items.map((it, i) => `<tr class="border-t border-slate-100"><td class="p-1.5">${i + 1}</td><td class="p-1.5 font-mono">${esc(it.code)}</td><td class="p-1.5 font-bold">${esc(it.name)}</td><td class="p-1.5">${esc(it.spec)}</td><td class="p-1.5 text-right font-black">${fmtQty(it.qty)}</td><td class="p-1.5">${esc(it.unit)}</td><td class="p-1.5">${esc(it.note)}</td></tr>`).join('')}</tbody>
                        </table>
                        ${e.transport ? `<div class="mt-1 text-slate-500">운송: ${esc(e.transport)}</div>` : ''}
                        ${isScan ? `<div class="mt-1 text-slate-500">전표 스캔 등록 · 기록 ${esc(e.raw.by || '')} ${e.raw.createdAt ? esc(new Date(e.raw.createdAt).toLocaleString('ko-KR')) : ''}</div>` : ''}
                    </td></tr>` : ''}`;
                }).join('')}
                </tbody>
            </table>
        </div>`;
        const byKey = (el) => list.find(e => e.key === el.closest('tr[data-key]').dataset.key);
        box.querySelectorAll('.sm-toggle').forEach(b => b.addEventListener('click', () => {
            const e = byKey(b);
            if (open.has(e.key)) open.delete(e.key); else open.add(e.key);
            renderList();
        }));
        box.querySelectorAll('.sm-view').forEach(b => b.addEventListener('click', () => { window.__slipOpenDocNo = byKey(b).no; onSwitchTab('slipIssue'); }));
        box.querySelectorAll('.sm-copy').forEach(b => b.addEventListener('click', () => { window.__slipCopyDocNo = byKey(b).no; onSwitchTab('slipIssue'); }));
        box.querySelectorAll('.sm-pick').forEach(c => c.addEventListener('change', () => {
            const e = byKey(c);
            if (c.checked) picked.add(e.key); else picked.delete(e.key);
            syncPicked();
            const all = $('#sm-all');
            if (all) all.checked = list.every(x => picked.has(x.key));
        }));
        $('#sm-all')?.addEventListener('change', (ev) => {
            list.forEach(e => (ev.target.checked ? picked.add(e.key) : picked.delete(e.key)));
            renderList();
        });
        box.querySelectorAll('.sm-print').forEach(b => b.addEventListener('click', () => doPrint([byKey(b)])));
        box.querySelectorAll('.sm-photo').forEach(b => b.addEventListener('click', () => showPhoto(byKey(b))));
        box.querySelectorAll('.sm-edit').forEach(b => b.addEventListener('click', () => {
            const e = byKey(b);
            openSlipEditor(e, {
                showToast,
                onSaved: (raw) => {
                    const next = e.src === 'SCAN' ? fromScan(raw) : fromIssued(raw);
                    entries = entries.map(x => (x.key === e.key ? next : x));
                    open.add(next.key);
                    if (next.typeKey === 'SCAN:CARD') cardPanel?.reload();
                    renderList();
                }
            });
        }));
        box.querySelectorAll('.sm-del').forEach(b => b.addEventListener('click', () => remove(byKey(b), b)));
        box.querySelectorAll('.sm-undone').forEach(b => b.addEventListener('click', () => openUnshipDialog([byKey(b)])));
        box.querySelectorAll('.sm-done').forEach(b => b.addEventListener('click', () => openShipDialog([byKey(b)])));
    };

    // ---------- 출고 완료 처리 (하나 또는 고른 여럿): 표시만 바꾸거나, 재고도 함께 옮긴다 ----------
    const isWaiting = (e) => e.src === 'ISSUE' && e.status === 'WAIT';
    const sameUnit = (a, b) => String(a || 'EA').toUpperCase() === String(b || 'EA').toUpperCase();
    /** 전표의 재고를 옮길 수 없는 까닭 (없으면 '') — 하나라도 걸리면 그 전표는 통째로 건너뛴다 */
    const stockBlocker = (s) => {
        if (!s.fromLoc || s.fromLoc === EXTERNAL) return '출발 거점이 없음';
        for (const it of s.items || []) {
            const m = state.master.find(x => x.code === it.code);
            if (!m) return `${it.name || it.code}: 품목 마스터에 없음`;
            if (!sameUnit(it.unit, m.unit)) return `${it.name}: 전표 단위(${it.unit})가 재고 단위(${m.unit || 'EA'})와 다름`;
            const { short } = allocateStock(it.code, s.fromLoc, Number(it.qty) || 0);
            if (short > 0) return `${it.name}: ${locText(s.fromLoc)} 재고 ${fmtQty(short)}${it.unit} 부족`;
        }
        return '';
    };
    /** 전표 수량대로 재고를 옮긴다: 도착이 외부 거래처면 출고, 거점·창고면 이동 (현장 스캔 출하 검수와 같은 규칙) */
    const moveSlipStock = async (s) => {
        const isOut = !s.toLoc || s.toLoc === EXTERNAL;
        const reason = `[전표관리 출고 처리 ${s.docNo}] ${isOut ? (s.partner || EXTERNAL) : locText(s.toLoc)}`;
        const failed = [];
        for (const it of s.items || []) {
            try {
                const { parts } = allocateStock(it.code, s.fromLoc, Number(it.qty) || 0);
                for (const p of parts) {
                    await processStockAction(isOut
                        ? { type: 'OUT', code: it.code, qty: p.qty, location: p.location, fromLoc: p.location, toLoc: p.location, reason, partner: s.partner || '' }
                        : { type: 'MOVE', code: it.code, qty: p.qty, location: p.location, fromLoc: p.location, toLoc: s.toLoc, reason, partner: s.partner || '' });
                }
            } catch (err) { failed.push(`${it.name}: ${err.message}`); }
        }
        return failed;
    };
    const shipEntries = async (list, withStock) => {
        const notes = [];
        let done = 0;
        for (const e of list) {
            const s = e.raw;
            try {
                // 재고를 옮기는 처리는 옮길 수 있는지 먼저 보고(안 되면 전표를 그대로 둔다), 두 번 출고되지 않게 완료 표시를 먼저 잡는다
                const blocker = withStock ? stockBlocker(s) : '';
                if (blocker) { notes.push(`⏭️ ${e.no} 건너뜀 — ${blocker}`); continue; }
                const check = withStock ? (s.items || []).map(it => ({ code: it.code, name: it.name, unit: it.unit, qty: it.qty, scanned: it.qty, lots: [], parts: allocateStock(it.code, s.fromLoc, Number(it.qty) || 0).parts })) : { manual: true };
                if (await markSlipShipped(e.no, check)) {
                    done += 1;
                    const failed = withStock ? await moveSlipStock(s) : [];
                    if (failed.length) notes.push(`⚠️ ${e.no} 출고 완료로 기록했지만 재고 반영 실패 — ${failed.join(' / ')}`);
                } else notes.push(`⏭️ ${e.no} — 이미 출고 완료된 전표`);
                const next = fromIssued({ ...s, shippedAt: s.shippedAt || new Date().toISOString(), shippedBy: s.shippedBy || state.currentGlobalWorker || '' });
                entries = entries.map(x => (x.key === e.key ? next : x));
            } catch (err) { notes.push(`❌ ${e.no} — ${err.message}`); }
        }
        renderList();
        showToast(`✅ ${done}건을 출고 완료로 처리했습니다${withStock ? ' (재고 이동 포함)' : ' (재고는 그대로)'}.`);
        if (notes.length) alert(`처리하지 못했거나 확인할 전표:\n\n${notes.join('\n')}`);
    };
    const openShipDialog = (list) => {
        if (!list.length) return;
        const wrap = document.createElement('div');
        wrap.id = 'sm-ship-dialog';
        wrap.className = 'fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4';
        wrap.innerHTML = `<div class="bg-white rounded-xl shadow-xl max-w-md w-full p-4 space-y-3 text-sm">
            <div class="font-black text-base">출고 완료 처리 · ${list.length}건</div>
            <div class="max-h-32 overflow-y-auto text-xs text-slate-600 border border-slate-200 rounded-lg p-2">${list.map(e => `${esc(e.no)} · ${esc(e.from)} → ${esc(e.to)} · ${e.items.length}품목`).join('<br>')}</div>
            <button type="button" data-mode="stock" class="w-full text-left p-3 rounded-lg border-2 border-emerald-400 hover:bg-emerald-50"><b>재고도 함께 옮기기</b><span class="block text-xs text-slate-500 mt-0.5">전표 수량대로 출발지 재고를 빼서 도착지로 옮깁니다(외부 거래처면 출고). 수불부·이력에 기록됩니다. 재고가 모자라거나 단위가 다른 전표는 건너뜁니다.</span></button>
            <button type="button" data-mode="mark" class="w-full text-left p-3 rounded-lg border border-slate-300 hover:bg-slate-50"><b>표시만 바꾸기</b><span class="block text-xs text-slate-500 mt-0.5">이미 옮겼거나 내보낸 전표용 — 재고·수불부는 바뀌지 않습니다.</span></button>
            <p class="text-xs text-slate-500">잘못 처리했으면 매니저 이상이 <b>출고 대기로</b> 되돌릴 수 있습니다.</p>
            <div class="text-right"><button type="button" data-mode="cancel" class="px-3 py-1.5 border border-slate-300 rounded-lg font-bold">취소</button></div>
        </div>`;
        document.body.appendChild(wrap);
        wrap.addEventListener('click', async (ev) => {
            const mode = ev.target.closest('[data-mode]')?.dataset.mode;
            if (!mode && ev.target !== wrap) return;
            if (mode === 'stock' || mode === 'mark') {
                wrap.querySelectorAll('button').forEach(b => { b.disabled = true; });
                await shipEntries(list, mode === 'stock');
            }
            wrap.remove();
        });
    };

    // ---------- 출고 완료 → 출고 대기로 되돌리기 (매니저 이상): 표시만 되돌리거나, 옮긴 재고도 제자리로 ----------
    const isShipped = (e) => e.src === 'ISSUE' && e.status === 'DONE';
    /** 되돌릴 품목과 수량: 출고 때의 검수 기록(실제 처리 수량)이 있으면 그 수량, 없으면 전표 수량 */
    const shippedItems = (s) => (Array.isArray(s.shipCheck) && s.shipCheck.length
        ? s.shipCheck.map(c => ({ code: c.code, name: c.name, unit: c.unit, qty: Number(c.scanned) || 0, parts: Array.isArray(c.parts) ? c.parts : null })).filter(c => c.qty > 0)
        : (s.items || []).map(it => ({ code: it.code, name: it.name, unit: it.unit, qty: Number(it.qty) || 0, parts: null })));
    const isOutSlip = (s) => !s.toLoc || s.toLoc === EXTERNAL;
    /** 재고를 제자리로 되돌릴 수 없는 까닭 (없으면 '') */
    const restoreBlocker = (s) => {
        if (!s.fromLoc || s.fromLoc === EXTERNAL) return '출발 거점이 없음';
        for (const it of shippedItems(s)) {
            const m = state.master.find(x => x.code === it.code);
            if (!m) return `${it.name || it.code}: 품목 마스터에 없음`;
            if (!sameUnit(it.unit, m.unit)) return `${it.name}: 전표 단위(${it.unit})가 재고 단위(${m.unit || 'EA'})와 다름`;
            if (!isOutSlip(s) && allocateStock(it.code, s.toLoc, it.qty).short > 0) return `${it.name}: ${locText(s.toLoc)}에 되돌릴 재고가 모자람`;
        }
        return '';
    };
    /** 출고 때 움직인 재고를 반대로: 외부 출고였으면 출발지로 다시 입고, 이동이었으면 도착지에서 출발지로 */
    const restoreSlipStock = async (s) => {
        const reason = `[전표관리 출고 되돌리기 ${s.docNo}]`;
        const failed = [];
        for (const it of shippedItems(s)) {
            try {
                // 출고 때 꺼낸 창고를 적어 둔 전표(전표관리에서 처리)는 그 창고로, 아니면 전표의 출발지로 되돌린다
                for (const back of it.parts || [{ location: s.fromLoc, qty: it.qty }]) {
                    if (isOutSlip(s)) { await processStockAction({ type: 'IN', code: it.code, qty: back.qty, location: back.location, fromLoc: back.location, toLoc: back.location, reason, partner: s.partner || '' }); continue; }
                    for (const p of allocateStock(it.code, s.toLoc, back.qty).parts) {
                        await processStockAction({ type: 'MOVE', code: it.code, qty: p.qty, location: p.location, fromLoc: p.location, toLoc: back.location, reason, partner: s.partner || '' });
                    }
                }
            } catch (err) { failed.push(`${it.name}: ${err.message}`); }
        }
        return failed;
    };
    const unshipEntries = async (list, withStock) => {
        const notes = [];
        let done = 0;
        for (const e of list) {
            const s = e.raw;
            try {
                const blocker = withStock ? restoreBlocker(s) : '';
                if (blocker) { notes.push(`⏭️ ${e.no} 건너뜀 — ${blocker}`); continue; }
                if (await unmarkSlipShipped(e.no)) {
                    done += 1;
                    const failed = withStock ? await restoreSlipStock(s) : [];
                    if (failed.length) notes.push(`⚠️ ${e.no} 출고 대기로 되돌렸지만 재고 반영 실패 — ${failed.join(' / ')}`);
                } else notes.push(`⏭️ ${e.no} — 이미 출고 대기인 전표`);
                const next = fromIssued({ ...s, shippedAt: '', shippedBy: '', shipCheck: null });
                entries = entries.map(x => (x.key === e.key ? next : x));
            } catch (err) { notes.push(`❌ ${e.no} — ${err.message}`); }
        }
        renderList();
        showToast(`↩️ ${done}건을 출고 대기로 되돌렸습니다${withStock ? ' (재고도 제자리로)' : ' (재고는 그대로)'}.`);
        if (notes.length) alert(`되돌리지 못했거나 확인할 전표:\n\n${notes.join('\n')}`);
    };
    const openUnshipDialog = (list) => {
        if (!list.length) return;
        const wrap = document.createElement('div');
        wrap.id = 'sm-unship-dialog';
        wrap.className = 'fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4';
        wrap.innerHTML = `<div class="bg-white rounded-xl shadow-xl max-w-md w-full p-4 space-y-3 text-sm">
            <div class="font-black text-base">출고 대기로 되돌리기 · ${list.length}건</div>
            <div class="max-h-32 overflow-y-auto text-xs text-slate-600 border border-slate-200 rounded-lg p-2">${list.map(e => `${esc(e.no)} · ${esc(e.from)} → ${esc(e.to)} · ${e.items.length}품목`).join('<br>')}</div>
            <button type="button" data-mode="mark" class="w-full text-left p-3 rounded-lg border-2 border-amber-400 hover:bg-amber-50"><b>표시만 되돌리기</b><span class="block text-xs text-slate-500 mt-0.5">'표시만 바꾸기'로 완료했던 전표용 — 재고·수불부는 바뀌지 않습니다.</span></button>
            <button type="button" data-mode="stock" class="w-full text-left p-3 rounded-lg border border-slate-300 hover:bg-slate-50"><b>재고도 제자리로 되돌리기</b><span class="block text-xs text-slate-500 mt-0.5">출고 때 재고가 움직였던 전표용 — 이동이었으면 도착지에서 출발지로 다시 옮기고, 외부 출고였으면 출발지로 다시 입고합니다. 수불부·이력에 기록됩니다. 도착지 재고가 모자라면 건너뜁니다.</span></button>
            <p class="text-xs text-rose-600 font-bold">재고가 움직이지 않았던 전표에 '재고도 제자리로'를 고르면 재고가 틀어집니다.</p>
            <div class="text-right"><button type="button" data-mode="cancel" class="px-3 py-1.5 border border-slate-300 rounded-lg font-bold">취소</button></div>
        </div>`;
        document.body.appendChild(wrap);
        wrap.addEventListener('click', async (ev) => {
            const mode = ev.target.closest('[data-mode]')?.dataset.mode;
            if (!mode && ev.target !== wrap) return;
            if (mode === 'stock' || mode === 'mark') {
                wrap.querySelectorAll('button').forEach(b => { b.disabled = true; });
                await unshipEntries(list, mode === 'stock');
            }
            wrap.remove();
        });
    };

    // ---------- 인쇄 ----------
    const pickedEntries = () => filtered().filter(e => picked.has(e.key));
    function syncPicked() {
        // 지워졌거나 다시 불러와 없어진 전표는 선택에서 뺀다
        const keys = new Set(entries.map(e => e.key));
        [...picked].forEach(k => { if (!keys.has(k)) picked.delete(k); });
        const n = pickedEntries().length;
        $('#sm-print-sel').disabled = !n;
        $('#sm-print-sel-text').textContent = n ? `선택 인쇄 (${n})` : '선택 인쇄';
        const waiting = pickedEntries().filter(isWaiting).length;
        const shipBtn = $('#sm-ship-sel');
        const shipped = pickedEntries().filter(isShipped).length;
        const unshipBtn = $('#sm-unship-sel');
        if (unshipBtn) { unshipBtn.disabled = !shipped; $('#sm-unship-sel-text').textContent = shipped ? `선택 출고 대기로 (${shipped})` : '선택 출고 대기로'; }
        if (shipBtn) { shipBtn.disabled = !waiting; $('#sm-ship-sel-text').textContent = waiting ? `선택 출고 완료 (${waiting})` : '선택 출고 완료'; }
    }
    const doPrint = async (list) => {
        if (!list.length) return;
        if (list.length > 30 && !confirm(`전표 ${list.length}장을 한 번에 인쇄합니다. 계속할까요?`)) return;
        const w = openPrintWindow();
        if (!w) return;
        try {
            await printSlipEntries(w, list);
        } catch (err) {
            w.close();
            alert(`인쇄를 준비하지 못했습니다: ${err.message || err}`);
        }
    };
    $('#sm-print-sel').addEventListener('click', () => doPrint(pickedEntries()));
    $('#sm-unship-sel')?.addEventListener('click', () => openUnshipDialog(pickedEntries().filter(isShipped)));
    $('#sm-ship-sel')?.addEventListener('click', () => openShipDialog(pickedEntries().filter(isWaiting)));
    $('#sm-print-list').addEventListener('click', () => {
        const list = filtered();
        if (!list.length) return;
        const w = openPrintWindow();
        const cat = f.cat ? CATS[f.cat].label : '전표';
        printSlipList(w, list, { title: `${cat} 목록`, period: f.from || f.to ? `${f.from || '처음'} ~ ${f.to || '오늘'}` : '전체 기간' });
    });

    const showPhoto = async (e) => {
        const w = window.open('', '_blank'); // 누른 순간 열어 팝업 차단 피하기
        try {
            const url = await scanPhotoUrl(e.raw);
            if (!url) throw new Error('사진이 없습니다.');
            if (w) w.location.href = url; else window.location.href = url;
        } catch (err) {
            w?.close();
            alert(err.message);
        }
    };

    const remove = async (e, btn) => {
        const msg = e.src === 'ISSUE'
            ? `발행 전표 ${e.no}를 삭제할까요?\n${e.typeLabel} · ${e.date} · ${e.items.length}품목${e.status === 'DONE' ? '\n\n⚠️ 이미 출고 완료(QR 검수)된 전표입니다. 출고로 바뀐 재고는 되돌아가지 않습니다.' : ''}\n\n전표 기록만 지워지고 재고·수불부는 바뀌지 않습니다. 되돌릴 수 없습니다.`
            : `스캔 등록 기록 ${e.no}를 삭제할까요?\n${e.typeLabel} · ${e.date} · ${e.items.length}품목\n\n⚠️ 기록(과 사진)만 지워집니다. 이미 반영된 재고·수불부는 그대로입니다.\n재고를 되돌리려면 입출고 화면에서 반대로 처리하세요. 되돌릴 수 없습니다.`;
        if (!confirm(msg)) return;
        btn.disabled = true;
        try {
            if (e.src === 'ISSUE') {
                await deleteSlip(e.no);
                if (e.raw.assigneeId) await assignTasks({ ref: `SLIP:${e.no}`, assignee: null, prev: e.raw.assigneeId, parts: [''] });
            } else {
                await deleteScanSlip(e.raw);
            }
            entries = entries.filter(x => x.key !== e.key);
            if (e.typeKey === 'SCAN:CARD') cardPanel?.reload();
            showToast(`🗑️ ${e.no}를 삭제했습니다.`);
            renderList();
        } catch (err) {
            alert(err.message);
            btn.disabled = false;
        }
    };

    const load = async () => {
        loading = true;
        error = '';
        warn = '';
        renderList();
        const [a, b] = await Promise.allSettled([listSlipsRange({ from: f.from, to: f.to }), listScanSlipsRange({ from: f.from, to: f.to })]);
        const issued = a.status === 'fulfilled' ? a.value.map(fromIssued) : [];
        const scans = b.status === 'fulfilled' ? b.value.map(fromScan) : [];
        if (a.status === 'rejected' && b.status === 'rejected') error = a.reason?.message || String(a.reason);
        else if (a.status === 'rejected') warn = `발행 전표를 불러오지 못했습니다: ${a.reason?.message || a.reason}`;
        else if (b.status === 'rejected') warn = `스캔 등록 기록을 불러오지 못했습니다: ${b.reason?.message || b.reason}`;
        entries = [...issued, ...scans].sort((x, y) => String(y.date).localeCompare(String(x.date)) || String(y.no).localeCompare(String(x.no)));
        loading = false;
        fillSites();
        renderList();
    };

    const syncUi = () => {
        container.querySelectorAll('.sm-period').forEach(b => {
            const on = b.dataset.period === f.period;
            b.className = `sm-period px-2.5 py-1.5 rounded-lg font-bold border ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-slate-700'}`;
        });
        $('#sm-src').value = f.src;
        $('#sm-from').value = f.from;
        $('#sm-to').value = f.to;
    };
    const persist = () => savePref({ period: f.period, cat: f.cat, src: f.src, type: f.type, status: f.status, site: f.site });

    container.querySelectorAll('.sm-period').forEach(b => b.addEventListener('click', () => {
        f.period = b.dataset.period;
        [f.from, f.to] = PERIODS[f.period].range();
        syncUi();
        persist();
        load();
    }));
    $('#sm-src').addEventListener('change', (e) => {
        f.src = e.target.value;
        fillTypes();
        persist();
        renderList();
    });
    ['#sm-from', '#sm-to'].forEach(s => $(s).addEventListener('change', () => {
        f.from = $('#sm-from').value;
        f.to = $('#sm-to').value;
        f.period = 'custom';
        syncUi();
        load();
    }));
    $('#sm-status').value = f.status;
    $('#sm-type').addEventListener('change', (e) => { f.type = e.target.value; persist(); renderList(); });
    $('#sm-status').addEventListener('change', (e) => { f.status = e.target.value; persist(); renderList(); });
    $('#sm-site').addEventListener('change', (e) => { f.site = e.target.value; persist(); renderList(); });
    $('#sm-q').addEventListener('input', (e) => { f.q = e.target.value; renderList(); });
    $('#sm-reload').addEventListener('click', load);

    // 엑셀: 목록 + 품목 상세 (화면의 조건 그대로)
    $('#sm-excel').addEventListener('click', async () => {
        const list = filtered();
        if (!list.length) return;
        const XLSX = await import('xlsx');
        const statusText = (e) => (e.status === 'DONE' ? '출고 완료' : e.status === 'WAIT' ? '출고 대기' : '재고 반영됨');
        const head = list.map(e => ({
            분류: CATS[catOf(e.typeKey)].label, 구분: e.src === 'SCAN' ? '스캔 등록' : '발행 전표', 번호: e.no, 원본전표번호: e.refNo, 일자: e.date, 종류: e.typeLabel,
            출발: e.from, 도착: e.to, 거래처: e.partner, 비고: e.reason, 운송: e.transport, 품목수: e.items.length,
            작성자: e.worker, 담당자: e.assignee, 출하시간: e.shipTime, 상태: statusText(e)
        }));
        const lines = list.flatMap(e => e.items.map((it, i) => ({
            분류: CATS[catOf(e.typeKey)].label, 구분: e.src === 'SCAN' ? '스캔 등록' : '발행 전표', 번호: e.no, 일자: e.date, 종류: e.typeLabel, 출발: e.from, 도착: e.to,
            순번: i + 1, 품목코드: it.code, 품목명: it.name, 규격: it.spec, 수량: Number(it.qty) || 0, 단위: it.unit, 비고: it.note, 상태: statusText(e)
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(head), '전표목록');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lines), '품목상세');
        const catName = f.cat ? CATS[f.cat].label.replace(/[^가-힣A-Za-z0-9]/g, '') : '전표관리';
        XLSX.writeFile(wb, f.from || f.to ? `${catName}_${f.from}_${f.to}.xlsx` : `${catName}_전체.xlsx`);
        showToast(`📊 전표 ${list.length}건 (품목 ${lines.length}줄)을 엑셀로 내보냈습니다.`);
    });

    fillTypes();
    syncUi();
    createIcons({ icons });
    load();
};
