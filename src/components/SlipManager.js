import { state, listSlipsRange, deleteSlip, SLIP_TYPES } from '../services/db.js';
import { ROLE_LEVEL, canAccessTab } from '../services/auth.js';
import { assignTasks } from '../services/assign.js';
import { SCAN_SLIP_TYPES, listScanSlipsRange, deleteScanSlip, scanPhotoUrl } from '../services/scanSlips.js';
import { openSlipEditor } from './slipEdit.js';
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
const ACTION_TEXT = { IN: '재고 늘림', OUT: '재고 줄임', USE: '재고 줄임 (사용)', MOVE: '창고 이동' };

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
    const from = r.action === 'IN' ? (party || '(거래처)') : locText(r.fromLoc);
    const to = r.action === 'IN' ? locText(r.toLoc) : r.action === 'MOVE' ? locText(r.toLoc) : r.action === 'USE' ? '(사용)' : (party || '(밖으로)');
    return {
        src: 'SCAN', key: `S:${r.id}`, no: r.regNo, date: r.date, typeKey: `SCAN:${r.kind}`, typeLabel: t?.word || r.kind,
        from, to, sites: [r.fromLoc, r.toLoc].filter(Boolean).map(siteOf), partner: party, refNo: r.docNo, reason: ACTION_TEXT[r.action] || '',
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
    let entries = [];
    let loading = false;
    let error = '';
    let warn = '';
    const open = new Set();
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
                <span class="ml-auto flex gap-1.5">
                    <button type="button" id="sm-reload" class="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold flex items-center gap-1"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>새로고침</button>
                    <button type="button" id="sm-excel" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-1 disabled:opacity-40"><i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i>엑셀</button>
                    <span id="sm-new-box" class="flex gap-1.5"></span>
                </span>
            </div>
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

    const renderList = () => {
        const box = $('#sm-list');
        renderCats();
        if (loading) { box.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold">불러오는 중…</div>'; return; }
        if (error) { box.innerHTML = `<div class="p-6 text-center text-rose-600 font-bold">${esc(error)}</div>`; return; }
        const list = filtered();
        renderKpi(list);
        $('#sm-excel').disabled = !list.length;
        const warnHtml = warn ? `<div class="mb-2 p-2 rounded-lg bg-amber-50 text-amber-800 font-bold">${esc(warn)}</div>` : '';
        if (!list.length) { box.innerHTML = `${warnHtml}<div class="p-8 text-center text-slate-400 font-bold">조건에 맞는 전표가 없습니다.</div>`; return; }
        box.innerHTML = `${warnHtml}
        <div class="overflow-x-auto border border-slate-200 rounded-xl">
            <table class="w-full min-w-[900px]">
                <thead class="bg-slate-50 text-slate-600 font-bold"><tr>
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
                        <td class="p-2 font-mono font-black text-slate-800 whitespace-nowrap"><button type="button" class="sm-toggle hover:text-indigo-700" title="품목 펼치기">${isOpen ? '▾' : '▸'} ${esc(e.no)}</button>${e.refNo ? `<div class="text-[10px] font-normal text-slate-500">원본 No.${esc(e.refNo)}</div>` : ''}</td>
                        <td class="p-2 whitespace-nowrap">${esc(e.date)}${e.shipTime ? `<div class="text-[10px] text-slate-500">⏰ ${esc(e.shipTime)}</div>` : ''}</td>
                        <td class="p-2 whitespace-nowrap"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${isScan ? 'bg-teal-100 text-teal-800' : 'bg-indigo-100 text-indigo-800'}">${isScan ? '스캔' : '발행'}</span> ${esc(e.typeLabel)}</td>
                        <td class="p-2">${esc(e.from || '-')} → ${esc(e.to || '-')}${e.reason ? `<div class="text-[10px] text-slate-500 truncate max-w-[220px]" title="${esc(e.reason)}">${esc(e.reason)}</div>` : ''}</td>
                        <td class="p-2">${first ? `${esc(first.name || first.code)} ${fmtQty(first.qty)}${esc(first.unit)}` : '-'}${e.items.length > 1 ? ` <span class="text-slate-500">외 ${e.items.length - 1}</span>` : ''}</td>
                        <td class="p-2 whitespace-nowrap">${esc(e.worker || '-')}${e.assignee ? `<div class="text-[10px] text-slate-500">담당 ${esc(e.assignee)}</div>` : ''}</td>
                        <td class="p-2 whitespace-nowrap">${statusBadge(e)}</td>
                        <td class="p-2 text-right whitespace-nowrap">
                            ${!isScan && canIssue ? `<button type="button" class="sm-view px-2 py-1 bg-slate-800 text-white rounded font-bold">보기·재인쇄</button>
                            <button type="button" class="sm-copy px-2 py-1 bg-white border border-slate-300 rounded font-bold">복사</button>` : ''}
                            ${isScan && e.hasPhoto ? '<button type="button" class="sm-photo px-2 py-1 bg-slate-800 text-white rounded font-bold">사진</button>' : ''}
                            ${(!isScan && isManager) || (isScan && canDeleteScan(e) && level >= ROLE_LEVEL.OPERATOR) ? '<button type="button" class="sm-edit px-2 py-1 bg-white border border-indigo-300 text-indigo-700 rounded font-bold">수정</button>' : ''}
                            ${(!isScan && isManager) || (isScan && canDeleteScan(e)) ? '<button type="button" class="sm-del px-2 py-1 bg-white border border-rose-300 text-rose-600 rounded font-bold">삭제</button>' : ''}
                        </td>
                    </tr>
                    ${isOpen ? `<tr class="bg-slate-50/70"><td colspan="8" class="p-2">
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
        box.querySelectorAll('.sm-photo').forEach(b => b.addEventListener('click', () => showPhoto(byKey(b))));
        box.querySelectorAll('.sm-edit').forEach(b => b.addEventListener('click', () => {
            const e = byKey(b);
            openSlipEditor(e, {
                showToast,
                onSaved: (raw) => {
                    const next = e.src === 'SCAN' ? fromScan(raw) : fromIssued(raw);
                    entries = entries.map(x => (x.key === e.key ? next : x));
                    open.add(next.key);
                    renderList();
                }
            });
        }));
        box.querySelectorAll('.sm-del').forEach(b => b.addEventListener('click', () => remove(byKey(b), b)));
    };

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
