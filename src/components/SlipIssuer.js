import { state, nextSlipNo, issueSlip, listSlips, SLIP_TYPES } from '../services/db.js';
import { sitesOf, siteOf } from '../services/locations.js';
import { localDateStr } from '../services/searchUtils.js';
import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';

// 거래 출하 전표 발행기 (원부자재 이동전표 / 출고 및 불출 요청서)
// 입력 → A4 미리보기 → 발행(저장, 전표번호 확정) 및 인쇄. 발행 이력에서 재인쇄·복사.
// 전표 발행은 서류만 남기며 재고는 바꾸지 않는다 (재고 이동은 입출고 화면에서 처리).
const EXTERNAL = '외부 거래처';
const TRANSPORTS = ['사내 차량', '용차', '택배', '화물', '직접 수령'];

const fmtQty = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const setupSlipIssuer = (modalEl, { showToast = () => {} } = {}) => {
    const blank = () => ({
        type: 'TRANSFER',
        date: localDateStr(),
        docNo: '',
        fromLoc: '',
        toLoc: '',
        partner: '',
        transport: '사내 차량',
        reason: '',
        worker: state.currentGlobalWorker || '',
        items: []
    });
    let slip = blank();
    let issued = null; // 발행된(또는 이력에서 불러온) 전표를 보는 중이면 그 전표

    const sites = () => sitesOf(state.locations);
    const locOptions = (selected) => [...sites(), EXTERNAL]
        .map(s => `<option value="${esc(s)}" ${s === selected ? 'selected' : ''}>${esc(s)}</option>`).join('');
    const stockAt = (code, site) => state.inventory
        .filter(i => i.code === code && site && siteOf(i.location) === site)
        .reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

    modalEl.innerHTML = `
        <div class="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6">
            <div class="p-4 bg-amber-500 text-white flex flex-wrap items-center justify-between gap-2 no-print">
                <div class="flex items-center gap-2">
                    <i data-lucide="file-signature" class="w-5 h-5"></i>
                    <h4 class="font-bold text-sm">거래 출하 전표 발행기</h4>
                </div>
                <div class="flex items-center flex-wrap gap-2">
                    <button type="button" id="slip-btn-new" class="px-2.5 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-bold">새 전표</button>
                    <button type="button" id="slip-btn-history" class="px-2.5 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-bold flex items-center gap-1"><i data-lucide="history" class="w-3.5 h-3.5"></i>발행 이력</button>
                    <button type="button" id="slip-btn-issue" class="px-3 py-1 bg-white text-amber-700 hover:bg-amber-50 rounded-lg text-xs font-black flex items-center gap-1"><i data-lucide="printer" class="w-3.5 h-3.5"></i><span id="slip-btn-issue-text">발행 및 인쇄</span></button>
                    <button type="button" class="btn-close-modal text-white/80 hover:text-white text-lg leading-none px-1">&times;</button>
                </div>
            </div>

            <!-- 발행 이력 -->
            <div id="slip-history" class="hidden p-4 border-b border-slate-200 bg-slate-50 no-print text-xs space-y-2">
                <div class="flex items-center justify-between">
                    <span class="font-black text-slate-800">최근 발행 전표</span>
                    <button type="button" id="slip-history-close" class="text-slate-500 hover:text-slate-800 font-bold">닫기</button>
                </div>
                <div id="slip-history-list" class="max-h-64 overflow-y-auto space-y-1.5"></div>
            </div>

            <!-- 입력 -->
            <div id="slip-editor" class="p-4 border-b border-slate-200 space-y-3 no-print text-xs">
                <div id="slip-issued-banner" class="hidden p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold flex flex-wrap items-center justify-between gap-2">
                    <span id="slip-issued-text"></span>
                    <button type="button" id="slip-btn-copy" class="px-2.5 py-1 bg-white border border-emerald-300 rounded-lg">이 내용으로 새 전표 만들기</button>
                </div>
                <fieldset id="slip-fields" class="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                    <label class="block"><span class="font-bold text-slate-600">전표 종류</span>
                        <select id="slip-type" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                            ${Object.entries(SLIP_TYPES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}
                        </select></label>
                    <label class="block"><span class="font-bold text-slate-600">발행일자</span>
                        <input type="date" id="slip-date" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                    <label class="block"><span class="font-bold text-slate-600">전표번호 <span class="font-normal text-slate-400">(발행 시 확정)</span></span>
                        <input type="text" id="slip-docno" readonly class="mt-1 w-full border border-slate-200 bg-slate-100 rounded-lg px-2 py-1.5 font-mono font-bold text-slate-600" /></label>
                    <label class="block"><span class="font-bold text-slate-600">출발 거점</span>
                        <select id="slip-from" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select></label>
                    <label class="block"><span class="font-bold text-slate-600">도착 거점</span>
                        <select id="slip-to" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select></label>
                    <label class="block"><span class="font-bold text-slate-600">거래처 (받는 곳)</span>
                        <input type="text" id="slip-partner" list="slip-partner-list" placeholder="외부로 보낼 때" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" />
                        <datalist id="slip-partner-list"></datalist></label>
                    <label class="block"><span class="font-bold text-slate-600">운송 방법</span>
                        <input type="text" id="slip-transport" list="slip-transport-list" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" />
                        <datalist id="slip-transport-list">${TRANSPORTS.map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist></label>
                    <label class="block md:col-span-2"><span class="font-bold text-slate-600">사유 / 비고</span>
                        <input type="text" id="slip-reason" placeholder="예: 생산 투입용 원료 이동, 본사 출하" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                    <label class="block"><span class="font-bold text-slate-600">작업 담당자</span>
                        <input type="text" id="slip-worker" list="slip-worker-list" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" />
                        <datalist id="slip-worker-list"></datalist></label>
                </fieldset>

                <div id="slip-item-adder" class="flex flex-wrap items-end gap-2 p-2.5 bg-amber-50/60 border border-amber-200 rounded-xl">
                    <label class="block flex-1 min-w-[220px]"><span class="font-bold text-amber-900">품목 추가 (코드·품목명 검색)</span>
                        <input type="text" id="slip-item-search" list="slip-item-list" placeholder="예: 5AA40008 또는 ODM 5W30" autocomplete="off" class="mt-1 w-full border border-amber-300 rounded-lg px-2 py-1.5 font-bold bg-white" />
                        <datalist id="slip-item-list"></datalist></label>
                    <label class="block w-28"><span class="font-bold text-amber-900">수량</span>
                        <input type="number" id="slip-item-qty" min="0" step="any" placeholder="0" class="mt-1 w-full border border-amber-300 rounded-lg px-2 py-1.5 font-black text-right bg-white" /></label>
                    <button type="button" id="slip-item-add" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-black">+ 추가</button>
                    <span id="slip-item-hint" class="w-full text-[11px] text-amber-800"></span>
                </div>

                <div class="overflow-x-auto border border-slate-200 rounded-xl">
                    <table class="w-full text-xs">
                        <thead class="bg-slate-100 text-slate-600 font-bold">
                            <tr><th class="p-2 w-8">No</th><th class="p-2 text-left">품목코드</th><th class="p-2 text-left">품목명</th><th class="p-2 text-left">규격</th><th class="p-2">단위</th>
                                <th class="p-2 text-right w-28">수량</th><th class="p-2 text-left">비고</th><th class="p-2 text-right" title="출발 거점의 현재 재고">출발지 재고</th><th class="p-2 w-10"></th></tr>
                        </thead>
                        <tbody id="slip-edit-rows" class="divide-y divide-slate-100"></tbody>
                    </table>
                </div>
            </div>

            <!-- A4 미리보기 (인쇄 영역) -->
            <div id="printable-transfer-slip" class="printable-area p-6 sm:p-8 bg-white text-slate-900 space-y-6 text-xs"></div>
        </div>`;

    const $ = (s) => modalEl.querySelector(s);

    // ---------- 미리보기 (인쇄 서식) ----------
    const renderPreview = () => {
        const s = issued || slip;
        const t = SLIP_TYPES[s.type] || SLIP_TYPES.TRANSFER;
        const items = s.items.filter(it => it.code || it.name);
        const byUnit = new Map();
        items.forEach(it => byUnit.set(it.unit || 'EA', (byUnit.get(it.unit || 'EA') || 0) + (Number(it.qty) || 0)));
        const totalText = [...byUnit].map(([u, q]) => `${fmtQty(q)} ${u}`).join(' · ') || '0';
        const toText = s.toLoc === EXTERNAL || !s.toLoc ? (s.partner || EXTERNAL) : (s.partner ? `${s.toLoc} (${s.partner})` : s.toLoc);
        const minRows = Math.max(0, 8 - items.length); // 빈 줄을 채워 서식 모양 유지

        $('#printable-transfer-slip').innerHTML = `
            <div class="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-900 pb-4">
                <div>
                    <h2 class="text-2xl font-black tracking-tight text-slate-900">${esc(t.title)}</h2>
                    <span class="text-xs font-semibold text-slate-500">${esc(t.subtitle)}</span>
                    <div class="mt-2 text-[11px] space-y-0.5">
                        <div><strong>전표번호:</strong> <span class="font-mono font-bold">${esc(s.docNo || '(발행 시 확정)')}</span></div>
                        <div><strong>발행일자:</strong> ${esc(s.date)}</div>
                    </div>
                </div>
                <div class="flex border border-slate-900 text-center text-[10px]">
                    <div class="w-6 bg-slate-100 flex items-center justify-center font-bold border-r border-slate-900">출고</div>
                    <div class="w-16 border-r border-slate-900"><div class="py-0.5 border-b border-slate-900 font-bold">담당</div><div class="h-10"></div></div>
                    <div class="w-16 border-r border-slate-900"><div class="py-0.5 border-b border-slate-900 font-bold">승인</div><div class="h-10"></div></div>
                    <div class="w-6 bg-slate-100 flex items-center justify-center font-bold border-r border-slate-900">인수</div>
                    <div class="w-16 border-r border-slate-900"><div class="py-0.5 border-b border-slate-900 font-bold">담당</div><div class="h-10"></div></div>
                    <div class="w-16"><div class="py-0.5 border-b border-slate-900 font-bold">확인</div><div class="h-10"></div></div>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <div><span class="text-slate-500 font-bold">출발 거점:</span> <span class="font-bold text-slate-900 ml-1">${esc(s.fromLoc || '-')}</span></div>
                <div><span class="text-slate-500 font-bold">도착 / 받는 곳:</span> <span class="font-bold text-blue-700 ml-1">${esc(toText || '-')}</span></div>
                <div><span class="text-slate-500 font-bold">운송 방법:</span> <span class="font-medium text-slate-800 ml-1">${esc(s.transport || '-')}</span></div>
                <div><span class="text-slate-500 font-bold">작업 담당자:</span> <span class="font-medium text-slate-800 ml-1">${esc(s.worker || '-')}</span></div>
                <div class="col-span-2"><span class="text-slate-500 font-bold">사유 / 비고:</span> <span class="font-medium text-slate-800 ml-1">${esc(s.reason || '-')}</span></div>
            </div>

            <div class="border border-slate-900 rounded-lg overflow-hidden">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 border-b border-slate-900 font-bold text-slate-800">
                        <tr><th class="py-2 px-3 w-10">No</th><th class="py-2 px-3">품목코드</th><th class="py-2 px-3">품목명</th><th class="py-2 px-3">규격 / 사양</th>
                            <th class="py-2 px-3 text-center">단위</th><th class="py-2 px-3 text-right">수량</th><th class="py-2 px-3">비고</th></tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200">
                        ${items.map((it, i) => `<tr>
                            <td class="py-2 px-3">${i + 1}</td>
                            <td class="py-2 px-3 font-mono font-bold">${esc(it.code || '-')}</td>
                            <td class="py-2 px-3 font-bold">${esc(it.name)}</td>
                            <td class="py-2 px-3">${esc(it.spec || '-')}</td>
                            <td class="py-2 px-3 text-center">${esc(it.unit || 'EA')}</td>
                            <td class="py-2 px-3 text-right font-black text-blue-700">${fmtQty(it.qty)}</td>
                            <td class="py-2 px-3">${esc(it.note || '')}</td></tr>`).join('')}
                        ${Array.from({ length: minRows }, () => '<tr><td class="py-2 px-3">&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('')}
                    </tbody>
                    <tfoot class="bg-slate-50 border-t border-slate-900 font-bold">
                        <tr><td colspan="5" class="py-2 px-3 text-right">합계 수량 (${items.length}품목):</td>
                            <td colspan="2" class="py-2 px-3 text-right font-black text-blue-700">${esc(totalText)}</td></tr>
                    </tfoot>
                </table>
            </div>

            <div class="pt-4 border-t border-slate-200 text-slate-600 text-center space-y-3">
                <p class="text-xs">상기 원부자재를 이상 없이 정히 영수(인수)하였음을 확인합니다.</p>
                <div class="flex justify-around items-center pt-2 text-xs font-bold text-slate-900">
                    <span>출고자: _________________ (인)</span>
                    <span>인수자: _________________ (인)</span>
                </div>
            </div>`;
    };

    // ---------- 입력 화면 ----------
    const readFields = () => {
        slip.type = $('#slip-type').value;
        slip.date = $('#slip-date').value || localDateStr();
        slip.fromLoc = $('#slip-from').value;
        slip.toLoc = $('#slip-to').value;
        slip.partner = $('#slip-partner').value.trim();
        slip.transport = $('#slip-transport').value.trim();
        slip.reason = $('#slip-reason').value.trim();
        slip.worker = $('#slip-worker').value.trim();
    };

    const renderRows = () => {
        const readOnly = !!issued;
        const s = issued || slip;
        const tbody = $('#slip-edit-rows');
        if (s.items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-slate-400">위에서 품목을 검색해 추가하세요.</td></tr>';
            return;
        }
        const fromSite = s.fromLoc && s.fromLoc !== EXTERNAL ? s.fromLoc : '';
        tbody.innerHTML = s.items.map((it, i) => {
            const stock = fromSite && it.code ? stockAt(it.code, fromSite) : null;
            const short = stock !== null && Number(it.qty) > stock;
            return `<tr data-i="${i}">
                <td class="p-2 text-center text-slate-400">${i + 1}</td>
                <td class="p-2 font-mono font-bold">${esc(it.code || '-')}</td>
                <td class="p-2 font-bold">${esc(it.name)}</td>
                <td class="p-2 text-slate-600">${esc(it.spec || '-')}</td>
                <td class="p-2 text-center">${esc(it.unit || 'EA')}</td>
                <td class="p-2"><input type="number" min="0" step="any" class="slip-row-qty w-full border border-slate-300 rounded px-1.5 py-1 text-right font-black" value="${esc(it.qty)}" ${readOnly ? 'disabled' : ''} /></td>
                <td class="p-2"><input type="text" class="slip-row-note w-full border border-slate-300 rounded px-1.5 py-1" value="${esc(it.note || '')}" placeholder="LOT·포장 등" ${readOnly ? 'disabled' : ''} /></td>
                <td class="p-2 text-right font-mono ${short ? 'text-rose-600 font-black' : 'text-slate-500'}" title="${short ? '출발 거점 재고보다 많습니다' : ''}">${stock === null ? '-' : fmtQty(stock)}</td>
                <td class="p-2 text-center">${readOnly ? '' : '<button type="button" class="slip-row-del text-slate-400 hover:text-rose-600 font-black px-1" title="삭제">✕</button>'}</td>
            </tr>`;
        }).join('');
        if (readOnly) return;
        tbody.querySelectorAll('tr[data-i]').forEach(tr => {
            const i = Number(tr.dataset.i);
            tr.querySelector('.slip-row-qty').addEventListener('input', (e) => { slip.items[i].qty = Number(e.target.value) || 0; renderPreview(); });
            tr.querySelector('.slip-row-qty').addEventListener('change', () => renderRows());
            tr.querySelector('.slip-row-note').addEventListener('input', (e) => { slip.items[i].note = e.target.value; renderPreview(); });
            tr.querySelector('.slip-row-del').addEventListener('click', () => { slip.items.splice(i, 1); renderAll(); });
        });
    };

    const renderAll = () => {
        const s = issued || slip;
        $('#slip-type').value = s.type;
        $('#slip-date').value = s.date;
        $('#slip-docno').value = s.docNo || '';
        $('#slip-from').innerHTML = locOptions(s.fromLoc);
        $('#slip-to').innerHTML = locOptions(s.toLoc);
        $('#slip-partner').value = s.partner || '';
        $('#slip-transport').value = s.transport || '';
        $('#slip-reason').value = s.reason || '';
        $('#slip-worker').value = s.worker || '';
        $('#slip-fields').disabled = !!issued;
        $('#slip-item-adder').classList.toggle('hidden', !!issued);
        $('#slip-issued-banner').classList.toggle('hidden', !issued);
        if (issued) $('#slip-issued-text').textContent = `발행된 전표 ${issued.docNo} (${issued.date}) — 내용은 바꿀 수 없습니다. [재인쇄]로 다시 인쇄하세요.`;
        $('#slip-btn-issue-text').textContent = issued ? '재인쇄' : '발행 및 인쇄';
        renderRows();
        renderPreview();
    };

    const refreshDocNo = async () => {
        if (issued) return;
        try {
            slip.docNo = await nextSlipNo(slip.type, slip.date);
        } catch (err) {
            slip.docNo = '';
            console.warn('[전표] 번호 미리보기 실패:', err);
        }
        $('#slip-docno').value = slip.docNo;
        renderPreview();
    };

    // 선택 목록 (품목·거래처·작업자) — 데이터가 나중에 로드될 수 있어 열 때마다 채운다
    const fillLists = () => {
        $('#slip-item-list').innerHTML = state.master
            .map(m => `<option value="${esc(m.code)}">${esc(m.name)}${m.spec && m.spec !== '-' ? ` · ${esc(m.spec)}` : ''}</option>`).join('');
        $('#slip-partner-list').innerHTML = (state.partners || []).map(p => `<option value="${esc(typeof p === 'string' ? p : p.name)}"></option>`).join('');
        $('#slip-worker-list').innerHTML = (state.workers || []).map(w => `<option value="${esc(w.name)}"></option>`).join('');
    };

    const findItem = (text) => {
        const t = String(text || '').trim();
        if (!t) return null;
        return state.master.find(m => m.code === t)
            || state.master.find(m => m.code.toLowerCase() === t.toLowerCase())
            || state.master.find(m => m.name === t)
            || null;
    };

    const addItem = () => {
        const text = $('#slip-item-search').value;
        const qty = Number($('#slip-item-qty').value) || 0;
        const m = findItem(text);
        const hint = $('#slip-item-hint');
        if (!m) { hint.textContent = '목록에서 품목을 고르세요. (품목코드 또는 품목명이 정확히 일치해야 합니다)'; return; }
        if (!(qty > 0)) { hint.textContent = '수량을 입력하세요.'; $('#slip-item-qty').focus(); return; }
        const existing = slip.items.find(it => it.code === m.code);
        if (existing) existing.qty = Number(existing.qty) + qty;
        else slip.items.push({ code: m.code, name: m.name, spec: m.spec && m.spec !== '-' ? m.spec : '', unit: m.unit || 'EA', qty, note: '' });
        hint.textContent = existing ? `[${m.code}] 이미 있는 품목이라 수량을 더했습니다.` : '';
        $('#slip-item-search').value = '';
        $('#slip-item-qty').value = '';
        $('#slip-item-search').focus();
        renderAll();
    };

    // ---------- 인쇄 (다른 인쇄 영역은 잠시 숨김) ----------
    const printSlip = () => {
        const area = $('#printable-transfer-slip');
        const others = [...document.querySelectorAll('.printable-area')].filter(el => el !== area && el.style.display !== 'none');
        others.forEach(el => { el.dataset.slipHidden = '1'; el.style.display = 'none'; });
        const restore = () => {
            others.forEach(el => { el.style.display = ''; delete el.dataset.slipHidden; });
            window.removeEventListener('afterprint', restore);
        };
        window.addEventListener('afterprint', restore);
        window.print();
        setTimeout(restore, 1000); // afterprint를 지원하지 않는 브라우저 대비
    };

    // ---------- 발행 이력 ----------
    const renderHistory = async () => {
        const listEl = $('#slip-history-list');
        listEl.innerHTML = '<div class="p-3 text-slate-400">불러오는 중...</div>';
        try {
            const list = await listSlips(50);
            if (list.length === 0) { listEl.innerHTML = '<div class="p-3 text-slate-400">발행한 전표가 없습니다.</div>'; return; }
            listEl.innerHTML = list.map((s, i) => `
                <div class="flex flex-wrap items-center justify-between gap-2 p-2 bg-white border border-slate-200 rounded-lg">
                    <div class="min-w-0">
                        <span class="font-mono font-black text-slate-800">${esc(s.docNo)}</span>
                        <span class="ml-1 text-slate-500">${esc(s.date)} · ${esc(SLIP_TYPES[s.type]?.label || s.type)}</span>
                        <div class="text-slate-600 truncate">${esc(s.fromLoc || '-')} → ${esc(s.toLoc === EXTERNAL || !s.toLoc ? (s.partner || EXTERNAL) : s.toLoc)}${s.partner && s.toLoc !== EXTERNAL ? ` (${esc(s.partner)})` : ''} · ${s.items.length}품목 · ${esc(s.worker || '')}</div>
                    </div>
                    <div class="flex gap-1">
                        <button type="button" class="slip-h-view px-2 py-1 bg-slate-800 text-white rounded font-bold" data-i="${i}">보기·재인쇄</button>
                        <button type="button" class="slip-h-copy px-2 py-1 bg-white border border-slate-300 rounded font-bold" data-i="${i}">복사해 새 전표</button>
                    </div>
                </div>`).join('');
            listEl.querySelectorAll('.slip-h-view').forEach(b => b.addEventListener('click', () => {
                issued = list[Number(b.dataset.i)];
                $('#slip-history').classList.add('hidden');
                renderAll();
            }));
            listEl.querySelectorAll('.slip-h-copy').forEach(b => b.addEventListener('click', () => {
                copyToNew(list[Number(b.dataset.i)]);
                $('#slip-history').classList.add('hidden');
            }));
        } catch (err) {
            listEl.innerHTML = `<div class="p-3 text-rose-600 font-bold">${esc(err.message)}</div>`;
        }
    };

    const copyToNew = (src) => {
        issued = null;
        slip = { ...blank(), type: src.type, fromLoc: src.fromLoc, toLoc: src.toLoc, partner: src.partner, transport: src.transport, reason: src.reason, items: src.items.map(it => ({ ...it })) };
        renderAll();
        refreshDocNo();
    };

    const resetNew = () => {
        issued = null;
        slip = blank();
        const ss = sites();
        slip.fromLoc = ss[0] || '';
        slip.toLoc = ss[1] || EXTERNAL;
        fillLists();
        renderAll();
        refreshDocNo();
    };

    // ---------- 이벤트 ----------
    ['#slip-type', '#slip-date'].forEach(sel => $(sel).addEventListener('change', () => { readFields(); refreshDocNo(); }));
    ['#slip-from', '#slip-to'].forEach(sel => $(sel).addEventListener('change', () => { readFields(); renderRows(); renderPreview(); }));
    ['#slip-partner', '#slip-transport', '#slip-reason', '#slip-worker'].forEach(sel => $(sel).addEventListener('input', () => { readFields(); renderPreview(); }));
    $('#slip-item-add').addEventListener('click', addItem);
    $('#slip-item-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#slip-item-qty').focus(); } });
    $('#slip-item-qty').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
    $('#slip-item-search').addEventListener('change', () => {
        const m = findItem($('#slip-item-search').value);
        const fromSite = slip.fromLoc && slip.fromLoc !== EXTERNAL ? slip.fromLoc : '';
        $('#slip-item-hint').textContent = m ? `[${m.code}] ${m.name}${m.spec && m.spec !== '-' ? ` / ${m.spec}` : ''} · 단위 ${m.unit || 'EA'}${fromSite ? ` · ${fromSite} 재고 ${fmtQty(stockAt(m.code, fromSite))}` : ''}` : '';
    });
    $('#slip-btn-new').addEventListener('click', () => {
        if (!issued && slip.items.length > 0 && !confirm('작성 중인 전표를 지우고 새로 시작할까요?')) return;
        resetNew();
    });
    $('#slip-btn-copy').addEventListener('click', () => copyToNew(issued));
    $('#slip-btn-history').addEventListener('click', () => {
        const panel = $('#slip-history');
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) renderHistory();
    });
    $('#slip-history-close').addEventListener('click', () => $('#slip-history').classList.add('hidden'));
    $('#slip-btn-issue').addEventListener('click', async () => {
        if (issued) { printSlip(); return; }
        readFields();
        if (slip.fromLoc && slip.fromLoc === slip.toLoc && slip.fromLoc !== EXTERNAL) { alert('출발 거점과 도착 거점이 같습니다.'); return; }
        if (slip.toLoc === EXTERNAL && !slip.partner) { alert('외부로 보낼 때는 거래처(받는 곳)를 입력하세요.'); $('#slip-partner').focus(); return; }
        const btn = $('#slip-btn-issue');
        btn.disabled = true;
        try {
            issued = await issueSlip(slip);
            showToast(`📄 전표 ${issued.docNo}를 발행했습니다.`);
            renderAll();
            printSlip();
        } catch (err) {
            alert(err.message);
        } finally {
            btn.disabled = false;
        }
    });

    // 모달을 열 때마다 목록과 번호를 새로 맞춘다 (openModalByName이 'modal:open' 이벤트를 보냄)
    modalEl.addEventListener('modal:open', () => {
        fillLists();
        if (!issued && slip.items.length === 0) resetNew();
        else { renderAll(); refreshDocNo(); }
    });

    resetNew();
    createIcons({ icons });
};
