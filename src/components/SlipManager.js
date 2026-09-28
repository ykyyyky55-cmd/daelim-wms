import { state, listSlipsRange, deleteSlip, SLIP_TYPES } from '../services/db.js';
import { ROLE_LEVEL, canAccessTab } from '../services/auth.js';
import { assignTasks } from '../services/assign.js';
import { locationLabel, siteOf } from '../services/locations.js';
import { localDateStr, matchesQuery } from '../services/searchUtils.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

// ==========================================
// 생산관리 → 전표관리: 전표발행에서 발행한 전표(wms_slips)를 기간·종류·출고 상태·거점으로 찾아보고
// 품목 보기, 재인쇄(전표발행 화면으로 열기), 복사해 새 전표, 엑셀, 삭제(매니저 이상)를 한다.
// 전표는 재고를 바꾸지 않으므로 삭제해도 재고·수불부는 그대로다.
// ==========================================

const EXTERNAL = '외부 거래처';
const PREF_KEY = 'daelim_slip_manage';
const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } };
const savePref = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* 저장 공간 없음: 무시 */ } };

const ymd = (d) => localDateStr(d);
const monthRange = (offset = 0) => {
    const n = new Date();
    const a = new Date(n.getFullYear(), n.getMonth() + offset, 1);
    const b = new Date(n.getFullYear(), n.getMonth() + offset + 1, 0);
    return [ymd(a), ymd(b)];
};
const PERIODS = {
    thisMonth: { label: '이번 달', range: () => monthRange(0) },
    lastMonth: { label: '지난 달', range: () => monthRange(-1) },
    last3: { label: '최근 3개월', range: () => [monthRange(-2)[0], monthRange(0)[1]] },
    thisYear: { label: '올해', range: () => [`${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`] },
    all: { label: '전체', range: () => ['', ''] }
};

const locText = (loc) => (loc && loc !== EXTERNAL ? locationLabel(loc) : loc || '');
const toText = (s) => (s.toLoc === EXTERNAL || !s.toLoc ? (s.partner || EXTERNAL) : `${locText(s.toLoc)}${s.partner ? ` (${s.partner})` : ''}`);
const fmtQty = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });

export const renderSlipManager = (container, { showToast = () => {}, onSwitchTab = () => {} } = {}) => {
    const role = state.currentUser?.role || 'VIEWER';
    const canDelete = (ROLE_LEVEL[role] || 0) >= ROLE_LEVEL.MANAGER;
    const canIssue = canAccessTab('slipIssue', role);
    const pref = loadPref();
    const f = {
        period: PERIODS[pref.period] ? pref.period : 'thisMonth',
        from: '', to: '',
        type: pref.type || '', status: pref.status || '', site: pref.site || '', q: ''
    };
    if (f.period === 'custom' || !PERIODS[f.period]) f.period = 'thisMonth';
    [f.from, f.to] = PERIODS[f.period].range();
    let slips = [];
    let loading = false;
    let error = '';
    const open = new Set(); // 품목을 펼친 전표번호
    const $ = (s) => container.querySelector(s);

    container.innerHTML = `
    <div class="space-y-4 text-xs">
        <div class="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg">
            <h2 class="text-xl font-black flex items-center gap-2"><i data-lucide="files" class="w-5 h-5"></i>전표관리</h2>
            <p class="text-xs text-slate-300 mt-1">전표발행에서 발행한 전표를 기간·종류·출고 상태로 찾아보고, 품목 확인·재인쇄·복사·엑셀 내보내기를 합니다. 전표는 재고를 바꾸지 않습니다.</p>
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
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                <label><span class="font-bold text-slate-500">전표 종류</span>
                    <select id="sm-type" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"><option value="">전체</option>${Object.entries(SLIP_TYPES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select></label>
                <label><span class="font-bold text-slate-500">출고 상태</span>
                    <select id="sm-status" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"><option value="">전체</option><option value="WAIT">출고 대기</option><option value="DONE">출고 완료 (QR 검수)</option></select></label>
                <label><span class="font-bold text-slate-500">거점 (출발·도착)</span>
                    <select id="sm-site" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select></label>
                <label><span class="font-bold text-slate-500">검색</span>
                    <input id="sm-q" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" placeholder="전표번호·거래처·품목·담당자" /></label>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <div id="sm-kpi" class="flex flex-wrap gap-1.5"></div>
                <span class="ml-auto flex gap-1.5">
                    <button type="button" id="sm-reload" class="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold flex items-center gap-1"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>새로고침</button>
                    <button type="button" id="sm-excel" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-1 disabled:opacity-40"><i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i>엑셀</button>
                    ${canIssue ? '<button type="button" id="sm-new" class="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center gap-1"><i data-lucide="file-signature" class="w-3.5 h-3.5"></i>새 전표 발행</button>' : ''}
                </span>
            </div>
            <div id="sm-list"></div>
        </div>
    </div>`;

    // 거점 목록: 전표에 나온 거점 + 등록 위치
    const fillSites = () => {
        const set = new Set((state.locations || []).map(l => siteOf(typeof l === 'string' ? l : l?.name || '')).filter(Boolean));
        slips.forEach(s => [s.fromLoc, s.toLoc].forEach(l => { if (l && l !== EXTERNAL) set.add(siteOf(l)); }));
        const sel = $('#sm-site');
        sel.innerHTML = `<option value="">전체</option>${[...set].sort().map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}<option value="${EXTERNAL}">${EXTERNAL}</option>`;
        sel.value = f.site;
        if (sel.value !== f.site) f.site = '';
    };

    const filtered = () => slips.filter(s => {
        if (f.type && s.type !== f.type) return false;
        if (f.status === 'DONE' && !s.shippedAt) return false;
        if (f.status === 'WAIT' && s.shippedAt) return false;
        if (f.site) {
            const sites = [s.fromLoc, s.toLoc].map(l => (l === EXTERNAL || !l ? EXTERNAL : siteOf(l)));
            if (!sites.includes(f.site)) return false;
        }
        if (f.q.trim()) {
            const hay = { docNo: s.docNo, partner: s.partner, worker: s.worker, assigneeName: s.assigneeName, reason: s.reason, route: `${locText(s.fromLoc)} ${toText(s)}`, items: s.items.map(it => `${it.code} ${it.name} ${it.spec}`).join(' ') };
            if (!matchesQuery(hay, f.q, Object.keys(hay))) return false;
        }
        return true;
    });

    const renderKpi = (list) => {
        const done = list.filter(s => s.shippedAt).length;
        const lines = list.reduce((a, s) => a + s.items.length, 0);
        const chip = (label, v, cls) => `<span class="px-2 py-1 rounded-lg font-bold ${cls}">${label} <b>${v.toLocaleString()}</b></span>`;
        $('#sm-kpi').innerHTML = chip('전표', list.length, 'bg-slate-100 text-slate-700') + chip('출고 완료', done, 'bg-emerald-100 text-emerald-800')
            + chip('출고 대기', list.length - done, 'bg-amber-100 text-amber-800') + chip('품목 줄', lines, 'bg-indigo-100 text-indigo-800');
    };

    const renderList = () => {
        const box = $('#sm-list');
        if (loading) { box.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold">불러오는 중…</div>'; return; }
        if (error) { box.innerHTML = `<div class="p-6 text-center text-rose-600 font-bold">${esc(error)}</div>`; return; }
        const list = filtered();
        renderKpi(list);
        $('#sm-excel').disabled = !list.length;
        if (!list.length) { box.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold">조건에 맞는 전표가 없습니다.</div>'; return; }
        box.innerHTML = `
        <div class="overflow-x-auto border border-slate-200 rounded-xl">
            <table class="w-full min-w-[860px]">
                <thead class="bg-slate-50 text-slate-600 font-bold"><tr>
                    <th class="p-2 text-left">전표번호</th><th class="p-2 text-left">일자</th><th class="p-2 text-left">종류</th>
                    <th class="p-2 text-left">출발 → 도착</th><th class="p-2 text-left">품목</th><th class="p-2 text-left">작성·담당</th>
                    <th class="p-2 text-left">상태</th><th class="p-2 text-right">관리</th>
                </tr></thead>
                <tbody class="divide-y divide-slate-100">
                ${list.map(s => {
                    const first = s.items[0];
                    const isOpen = open.has(s.docNo);
                    return `<tr data-no="${esc(s.docNo)}" class="hover:bg-slate-50">
                        <td class="p-2 font-mono font-black text-slate-800 whitespace-nowrap"><button type="button" class="sm-toggle hover:text-indigo-700" title="품목 펼치기">${isOpen ? '▾' : '▸'} ${esc(s.docNo)}</button></td>
                        <td class="p-2 whitespace-nowrap">${esc(s.date)}${s.shipTime ? `<div class="text-[10px] text-slate-500">⏰ ${esc(s.shipTime)}</div>` : ''}</td>
                        <td class="p-2 whitespace-nowrap">${esc(SLIP_TYPES[s.type]?.label || s.type)}</td>
                        <td class="p-2">${esc(locText(s.fromLoc) || '-')} → ${esc(toText(s))}${s.reason ? `<div class="text-[10px] text-slate-500 truncate max-w-[220px]" title="${esc(s.reason)}">${esc(s.reason)}</div>` : ''}</td>
                        <td class="p-2">${first ? `${esc(first.name)} ${fmtQty(first.qty)}${esc(first.unit)}` : '-'}${s.items.length > 1 ? ` <span class="text-slate-500">외 ${s.items.length - 1}</span>` : ''}</td>
                        <td class="p-2 whitespace-nowrap">${esc(s.worker || '-')}${s.assigneeName ? `<div class="text-[10px] text-slate-500">담당 ${esc(s.assigneeName)}</div>` : ''}</td>
                        <td class="p-2 whitespace-nowrap">${s.shippedAt
                            ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold" title="${esc(new Date(s.shippedAt).toLocaleString('ko-KR'))} ${esc(s.shippedBy || '')}">출고 완료</span>`
                            : '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">출고 대기</span>'}</td>
                        <td class="p-2 text-right whitespace-nowrap">
                            ${canIssue ? `<button type="button" class="sm-view px-2 py-1 bg-slate-800 text-white rounded font-bold">보기·재인쇄</button>
                            <button type="button" class="sm-copy px-2 py-1 bg-white border border-slate-300 rounded font-bold">복사</button>` : ''}
                            ${canDelete ? '<button type="button" class="sm-del px-2 py-1 bg-white border border-rose-300 text-rose-600 rounded font-bold">삭제</button>' : ''}
                        </td>
                    </tr>
                    ${isOpen ? `<tr class="bg-slate-50/70"><td colspan="8" class="p-2">
                        <table class="w-full bg-white border border-slate-200 rounded">
                            <thead class="text-slate-500"><tr><th class="p-1.5 text-left w-8">No</th><th class="p-1.5 text-left">품목코드</th><th class="p-1.5 text-left">품목명</th><th class="p-1.5 text-left">규격</th><th class="p-1.5 text-right">수량</th><th class="p-1.5 text-left">단위</th><th class="p-1.5 text-left">비고</th></tr></thead>
                            <tbody>${s.items.map((it, i) => `<tr class="border-t border-slate-100"><td class="p-1.5">${i + 1}</td><td class="p-1.5 font-mono">${esc(it.code)}</td><td class="p-1.5 font-bold">${esc(it.name)}</td><td class="p-1.5">${esc(it.spec)}</td><td class="p-1.5 text-right font-black">${fmtQty(it.qty)}</td><td class="p-1.5">${esc(it.unit)}</td><td class="p-1.5">${esc(it.note)}</td></tr>`).join('')}</tbody>
                        </table>
                        ${s.transport ? `<div class="mt-1 text-slate-500">운송: ${esc(s.transport)}</div>` : ''}
                    </td></tr>` : ''}`;
                }).join('')}
                </tbody>
            </table>
        </div>`;
        const byNo = (el) => list.find(s => s.docNo === el.closest('tr[data-no]').dataset.no);
        box.querySelectorAll('.sm-toggle').forEach(b => b.addEventListener('click', () => {
            const s = byNo(b);
            if (open.has(s.docNo)) open.delete(s.docNo); else open.add(s.docNo);
            renderList();
        }));
        box.querySelectorAll('.sm-view').forEach(b => b.addEventListener('click', () => { window.__slipOpenDocNo = byNo(b).docNo; onSwitchTab('slipIssue'); }));
        box.querySelectorAll('.sm-copy').forEach(b => b.addEventListener('click', () => { window.__slipCopyDocNo = byNo(b).docNo; onSwitchTab('slipIssue'); }));
        box.querySelectorAll('.sm-del').forEach(b => b.addEventListener('click', () => removeSlip(byNo(b), b)));
    };

    const removeSlip = async (s, btn) => {
        if (!confirm(`전표 ${s.docNo}를 삭제할까요?\n${SLIP_TYPES[s.type]?.label || ''} · ${s.date} · ${s.items.length}품목${s.shippedAt ? '\n\n⚠️ 이미 출고 완료(QR 검수)된 전표입니다. 출고로 바뀐 재고는 되돌아가지 않습니다.' : ''}\n\n전표 기록만 지워지고 재고·수불부는 바뀌지 않습니다. 되돌릴 수 없습니다.`)) return;
        btn.disabled = true;
        try {
            await deleteSlip(s.docNo);
            // 담당자 할일도 정리
            if (s.assigneeId) await assignTasks({ ref: `SLIP:${s.docNo}`, assignee: null, prev: s.assigneeId, parts: [''] });
            slips = slips.filter(x => x.docNo !== s.docNo);
            showToast(`🗑️ 전표 ${s.docNo}를 삭제했습니다.`);
            renderList();
        } catch (e) {
            alert(e.message);
            btn.disabled = false;
        }
    };

    const load = async () => {
        loading = true;
        error = '';
        renderList();
        try {
            slips = await listSlipsRange({ from: f.from, to: f.to });
        } catch (e) {
            error = e.message;
            slips = [];
        }
        loading = false;
        fillSites();
        renderList();
    };

    const syncPeriodUi = () => {
        container.querySelectorAll('.sm-period').forEach(b => {
            const on = b.dataset.period === f.period;
            b.className = `sm-period px-2.5 py-1.5 rounded-lg font-bold border ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-slate-700'}`;
        });
        $('#sm-from').value = f.from;
        $('#sm-to').value = f.to;
    };
    const persist = () => savePref({ period: f.period, type: f.type, status: f.status, site: f.site });

    container.querySelectorAll('.sm-period').forEach(b => b.addEventListener('click', () => {
        f.period = b.dataset.period;
        [f.from, f.to] = PERIODS[f.period].range();
        syncPeriodUi();
        persist();
        load();
    }));
    ['#sm-from', '#sm-to'].forEach(s => $(s).addEventListener('change', () => {
        f.from = $('#sm-from').value;
        f.to = $('#sm-to').value;
        f.period = 'custom';
        syncPeriodUi();
        load();
    }));
    $('#sm-type').value = f.type;
    $('#sm-status').value = f.status;
    $('#sm-type').addEventListener('change', (e) => { f.type = e.target.value; persist(); renderList(); });
    $('#sm-status').addEventListener('change', (e) => { f.status = e.target.value; persist(); renderList(); });
    $('#sm-site').addEventListener('change', (e) => { f.site = e.target.value; persist(); renderList(); });
    $('#sm-q').addEventListener('input', (e) => { f.q = e.target.value; renderList(); });
    $('#sm-reload').addEventListener('click', load);
    $('#sm-new')?.addEventListener('click', () => onSwitchTab('slipIssue'));

    // 엑셀: 전표 목록 + 품목 상세 (화면의 조건 그대로)
    $('#sm-excel').addEventListener('click', async () => {
        const list = filtered();
        if (!list.length) return;
        const XLSX = await import('xlsx');
        const head = list.map(s => ({
            전표번호: s.docNo, 일자: s.date, 종류: SLIP_TYPES[s.type]?.label || s.type, 출발: locText(s.fromLoc), 도착: toText(s),
            거래처: s.partner, 운송: s.transport, 사유: s.reason, 품목수: s.items.length, 작성자: s.worker, 담당자: s.assigneeName,
            출하시간: s.shipTime, 출고상태: s.shippedAt ? '출고 완료' : '출고 대기',
            출고일시: s.shippedAt ? new Date(s.shippedAt).toLocaleString('ko-KR') : '', 출고처리: s.shippedBy
        }));
        const lines = list.flatMap(s => s.items.map((it, i) => ({
            전표번호: s.docNo, 일자: s.date, 종류: SLIP_TYPES[s.type]?.label || s.type, 출발: locText(s.fromLoc), 도착: toText(s),
            순번: i + 1, 품목코드: it.code, 품목명: it.name, 규격: it.spec, 수량: Number(it.qty) || 0, 단위: it.unit, 비고: it.note,
            출고상태: s.shippedAt ? '출고 완료' : '출고 대기'
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(head), '전표목록');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lines), '품목상세');
        XLSX.writeFile(wb, `전표관리_${f.from || '전체'}_${f.to || ''}.xlsx`.replace(/_\.xlsx$/, '.xlsx'));
        showToast(`📊 전표 ${list.length}건 (품목 ${lines.length}줄)을 엑셀로 내보냈습니다.`);
    });

    syncPeriodUi();
    createIcons({ icons });
    load();
};
