import { state, nextSlipNo, issueSlip, listSlips, getSlipByDocNo, SLIP_TYPES } from '../services/db.js';
import { fillAssigneeSelect, readAssignee, assignTasks } from '../services/assign.js';
import { sitesOf, siteOf, buildingOf, locationLabel, locationOptionsHtml, normalizeLocationList } from '../services/locations.js';
import { localDateStr, searchMasterItems } from '../services/searchUtils.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { appendNewItemButton } from './quickItemDialog.js';
import { qrSvg } from '../services/qrCode.js';
import { fieldQrUrl } from '../services/fieldQr.js';
import { getApproval } from '../services/approvals.js';
import { mountApprovalBox } from './approval/ApprovalBox.js';
import { reflectSlip } from '../services/planAuto.js';
import { SLIP_CSS, slipDocHtml, writeSlipPrintWindow, slipApprKey, SLIP_APPR_ROLES, SLIP_OUT_ROLES, SLIP_IN_ROLES } from './slipDoc.js';

// 거래 출하 전표 발행기 (원부자재 이동전표 / 출고 및 불출 요청서)
// 입력 → A4 미리보기 → 발행(저장, 전표번호 확정) 및 인쇄. 발행 이력에서 재인쇄·복사.
// 전표 발행은 서류만 남기며 재고는 바꾸지 않는다 (재고 이동은 입출고 화면에서 처리).
const EXTERNAL = '외부 거래처';
const TRANSPORTS = ['사내 차량', '용차', '택배', '화물', '직접 수령'];
const UNITS = ['EA', 'BOX', 'L', 'KG', 'G', 'PAIL', 'DRUM', 'TOTE', 'SET', 'ROLL', 'M', '대'];
const sameUnit = (a, b) => String(a || 'EA').toUpperCase() === String(b || 'EA').toUpperCase();
const unitOptions = (selected) => {
    const list = UNITS.some(u => sameUnit(u, selected)) || !selected ? UNITS : [selected, ...UNITS];
    return list.map(u => `<option value="${esc(u)}" ${sameUnit(u, selected) ? 'selected' : ''}>${esc(u)}</option>`).join('');
};

const fmtQty = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

// 머리줄 보조 버튼 (화면 = 흰 바탕 테두리 / 창 = 진한 제목줄 위)
const SLIP_HEAD_BTN_LIGHT = 'px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold flex items-center gap-1';
const SLIP_HEAD_BTN_DARK = 'px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold flex items-center gap-1';

// onIssued(slip): 발행 직후 (주문관리 → 출하요청서가 생산요청서에 전표를 잇는 데 씀)
// crumb: 화면(inline)으로 붙일 때 제목 위에 보일 메뉴 경로 (예: '전표·라벨 › 전표발행')
export const setupSlipIssuer = (modalEl, { showToast = () => {}, inline = false, onIssued = null, crumb = '' } = {}) => {
    // 메뉴 화면(전표발행)과 환경설정의 창이 함께 있을 때 datalist id가 겹치지 않게 (input list는 문서 전체에서 id로 찾음)
    const LS = inline ? '-page' : '';
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
        shipTime: '',
        assigneeId: '',
        assigneeName: '',
        items: []
    });
    let slip = blank();
    let issued = null; // 발행된(또는 이력에서 불러온) 전표를 보는 중이면 그 전표

    const sites = () => sitesOf(state.locations);
    const byBuilding = (type) => !!SLIP_TYPES[type]?.byBuilding;
    // 선택 가능한 위치: 창고간 이동은 '거점 / 건물'까지, 그 밖은 거점 + 외부 거래처
    const locChoices = (type) => byBuilding(type) ? normalizeLocationList(state.locations) : [...sites(), EXTERNAL];
    const locOptions = (type, selected) => byBuilding(type)
        ? locationOptionsHtml(state.locations, selected)
        : locChoices(type).map(s => `<option value="${esc(s)}" ${s === selected ? 'selected' : ''}>${esc(s)}</option>`).join('');
    const locText = (loc) => (loc && loc !== EXTERNAL ? locationLabel(loc) : loc);
    const masterOf = (code) => state.master.find(m => m.code === code);
    // 출발지 재고: 건물까지 지정하면 그 창고만, 거점만이면 거점 전체
    const stockAt = (code, loc) => state.inventory
        .filter(i => i.code === code && loc && (buildingOf(loc) ? i.location === loc : siteOf(i.location) === loc))
        .reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);

    modalEl.innerHTML = `
        <div class="bg-white w-full ${inline ? 'shadow-sm' : 'max-w-5xl my-6 shadow-2xl'} rounded-2xl border border-slate-200 overflow-hidden">
            <!-- 머리줄: 화면(inline)은 밝은 머리, 창(모달)은 다른 창과 같은 진한 제목줄 -->
            <div class="${inline ? 'p-4 sm:p-5 border-b border-slate-200' : 'px-5 py-4 bg-slate-900 text-white'} flex flex-wrap items-center justify-between gap-3 no-print">
                ${inline ? `<div class="min-w-0">
                    ${crumb ? `<div class="text-[11px] font-black text-blue-600 flex items-center gap-1 mb-1"><i data-lucide="clipboard-pen-line" class="w-3.5 h-3.5"></i>${esc(crumb)}</div>` : ''}
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2"><i data-lucide="file-signature" class="w-5 h-5 text-blue-600"></i>거래 출하 전표 발행</h2>
                    <p class="text-xs text-slate-500 mt-1">이동전표·출고요청서를 작성해 A4로 인쇄합니다. 발행해도 재고는 바뀌지 않습니다.</p>
                </div>` : `<div class="flex items-center gap-2">
                    <i data-lucide="file-signature" class="w-5 h-5 text-amber-300"></i>
                    <h4 class="font-bold text-sm">거래 출하 전표 발행기</h4>
                </div>`}
                <div class="flex items-center flex-wrap gap-2">
                    <button type="button" id="slip-btn-new" class="${inline ? SLIP_HEAD_BTN_LIGHT : SLIP_HEAD_BTN_DARK}">새 전표</button>
                    <button type="button" id="slip-btn-history" class="${inline ? SLIP_HEAD_BTN_LIGHT : SLIP_HEAD_BTN_DARK}"><i data-lucide="history" class="w-3.5 h-3.5"></i>발행 이력</button>
                    <button type="button" id="slip-btn-issue" class="px-3.5 ${inline ? 'py-2' : 'py-1.5'} bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-black flex items-center gap-1.5"><i data-lucide="printer" class="w-3.5 h-3.5"></i><span id="slip-btn-issue-text">발행 및 인쇄</span></button>
                    ${inline ? '' : '<button type="button" class="btn-close-modal text-white/80 hover:text-white text-lg leading-none px-1">&times;</button>'}
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
                <div id="slip-appr" class="hidden flex flex-wrap items-start gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200"></div>
                <fieldset id="slip-fields" class="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                    <label class="block"><span class="font-bold text-slate-600">전표 종류</span>
                        <select id="slip-type" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                            ${Object.entries(SLIP_TYPES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}
                        </select></label>
                    <label class="block"><span class="font-bold text-slate-600">발행일자</span>
                        <input type="date" id="slip-date" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                    <label class="block"><span class="font-bold text-slate-600">전표번호 <span class="font-normal text-slate-400">(발행 시 확정)</span></span>
                        <input type="text" id="slip-docno" readonly class="mt-1 w-full border border-slate-200 bg-slate-100 rounded-lg px-2 py-1.5 font-mono font-bold text-slate-600" /></label>
                    <label class="block"><span id="slip-from-label" class="font-bold text-slate-600">출발 거점</span>
                        <select id="slip-from" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select></label>
                    <label class="block"><span id="slip-to-label" class="font-bold text-slate-600">도착 거점</span>
                        <select id="slip-to" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select></label>
                    <label class="block"><span class="font-bold text-slate-600">거래처 (받는 곳)</span>
                        <input type="text" id="slip-partner" list="slip-partner-list${LS}" placeholder="외부로 보낼 때" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" />
                        <datalist id="slip-partner-list${LS}"></datalist></label>
                    <label class="block"><span class="font-bold text-slate-600">운송 방법</span>
                        <input type="text" id="slip-transport" list="slip-transport-list${LS}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" />
                        <datalist id="slip-transport-list${LS}">${TRANSPORTS.map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist></label>
                    <label class="block md:col-span-2"><span class="font-bold text-slate-600">사유 / 비고</span>
                        <input type="text" id="slip-reason" placeholder="예: 생산 투입용 원료 이동, 본사 출하" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
                    <label class="block"><span class="font-bold text-slate-600">출하 시간 <span class="font-normal text-slate-400">(30분 전 알림)</span></span>
                        <input type="time" id="slip-ship-time" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                    <label class="block"><span class="font-bold text-rose-600">담당자 (수신자)</span>
                        <select id="slip-assignee" class="mt-1 w-full border border-rose-300 rounded-lg px-2 py-1.5 font-bold"><option value="">(담당자 없음)</option></select></label>
                    <label class="block"><span class="font-bold text-slate-600">작업 담당자</span>
                        <input type="text" id="slip-worker" list="slip-worker-list${LS}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" />
                        <datalist id="slip-worker-list${LS}"></datalist></label>
                </fieldset>

                <div id="slip-item-adder" class="flex flex-wrap items-end gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <div class="block flex-1 min-w-[220px] relative"><span class="font-bold text-slate-700">품목 추가 (코드·품목명·규격 일부만 입력해도 검색)</span>
                        <input type="text" id="slip-item-search" placeholder="예: 40008, 5w30, 그래핀" autocomplete="off" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold bg-white" />
                        <div id="slip-item-suggest" class="hidden absolute left-0 right-0 top-full mt-1 z-20 max-h-72 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl"></div></div>
                    <label class="block w-28"><span class="font-bold text-slate-700">수량</span>
                        <input type="number" id="slip-item-qty" min="0" step="any" placeholder="0" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-black text-right bg-white" /></label>
                    <label class="block w-24"><span class="font-bold text-slate-700">단위</span>
                        <select id="slip-item-unit" class="mt-1 w-full border border-slate-300 rounded-lg px-1.5 py-1.5 font-bold bg-white">${unitOptions('EA')}</select></label>
                    <button type="button" id="slip-item-add" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-black">+ 추가</button>
                    <span id="slip-item-hint" class="w-full text-[11px] text-amber-700"></span>
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
            <div id="printable-transfer-slip" class="theme-paper p-4 sm:p-6 bg-white overflow-x-auto"></div>
        </div>`;

    const $ = (s) => modalEl.querySelector(s);

    // ---------- 미리보기 (인쇄 서식: 윗장 받는 곳 / 아랫장 보내는 곳) ----------
    let slots = {};          // 발행된 전표의 전자결재 서명
    let qrSvgText = '';      // 발행된 전표의 출하 검수 QR (SVG 글자)
    const docOpts = (s) => {
        const t = SLIP_TYPES[s.type] || SLIP_TYPES.TRANSFER;
        const toText = s.toLoc === EXTERNAL || !s.toLoc ? (s.partner || EXTERNAL) : (s.partner ? `${locText(s.toLoc)} (${s.partner})` : locText(s.toLoc));
        return { t, fromText: locText(s.fromLoc), toText, placeWord: t.byBuilding ? '창고' : '거점' };
    };
    const renderPreview = () => {
        const s = issued || slip;
        $('#printable-transfer-slip').innerHTML = `<style>${SLIP_CSS}</style>` + slipDocHtml(s, {
            ...docOpts(s), slots: issued ? slots : {},
            qrHtml: issued ? (qrSvgText || '<span style="font-size:6pt">QR 준비 중</span>') : ''
        });
    };
    // 발행된 전표: QR·결재 서명을 받아 다시 그린다
    const loadIssuedExtras = async () => {
        const s = issued;
        if (!s?.docNo) return;
        const [svg, sl] = await Promise.all([
            qrSvg(fieldQrUrl('SLIP', s.docNo), { ecc: 'M' }).catch(() => ''),
            getApproval(slipApprKey(s.docNo), { refresh: true }).catch(() => ({}))
        ]);
        if (issued !== s) return;
        qrSvgText = svg ? svg.replace('<svg ', '<svg width="100%" height="100%" ') : esc(s.docNo);
        slots = sl || {};
        renderPreview();
    };
    // 결재 칸 (발행된 전표만 서명)
    const renderApproval = () => {
        const host = $('#slip-appr');
        const s = issued;
        host.classList.toggle('hidden', !s);
        if (!s) return;
        host.innerHTML = '<div id="slip-appr-out"></div><div id="slip-appr-in"></div><p class="w-full text-[11px] text-slate-500">빈 칸을 누르면 로그인한 사람의 전자서명으로 서명합니다. 서명은 인쇄한 두 장(받는 곳·보내는 곳)에 모두 찍힙니다.</p>';
        const doc = { key: slipApprKey(s.docNo), type: 'SLIP', title: `${SLIP_TYPES[s.type]?.label || '전표'} ${s.docNo}`, date: s.date, roles: SLIP_APPR_ROLES, labelOf: (r) => r.split(' ')[1] };
        const onChange = (sl) => { slots = { ...slots, ...sl }; Object.keys(slots).forEach(k => { if (!sl[k]) delete slots[k]; }); renderPreview(); };
        mountApprovalBox($('#slip-appr-out'), { ...doc, show: SLIP_OUT_ROLES, label: '출고' }, { showToast, onChange });
        mountApprovalBox($('#slip-appr-in'), { ...doc, show: SLIP_IN_ROLES, label: '인수' }, { showToast, onChange, tools: false });
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
        slip.shipTime = $('#slip-ship-time').value || '';
        const a = readAssignee($('#slip-assignee'));
        slip.assigneeId = a?.id || '';
        slip.assigneeName = a?.name || '';
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
            const stockUnit = masterOf(it.code)?.unit || 'EA';
            // 재고는 품목 기본 단위 기준이라, 전표 단위가 다르면 부족 여부를 판정하지 않는다
            const short = stock !== null && sameUnit(it.unit, stockUnit) && Number(it.qty) > stock;
            return `<tr data-i="${i}">
                <td class="p-2 text-center text-slate-400">${i + 1}</td>
                <td class="p-2 font-mono font-bold">${esc(it.code || '-')}</td>
                <td class="p-2 font-bold">${esc(it.name)}</td>
                <td class="p-2 text-slate-600">${esc(it.spec || '-')}</td>
                <td class="p-2 text-center"><select class="slip-row-unit border border-slate-300 rounded px-1 py-1 font-bold" ${readOnly ? 'disabled' : ''}>${unitOptions(it.unit || 'EA')}</select></td>
                <td class="p-2"><input type="number" min="0" step="any" class="slip-row-qty w-full border border-slate-300 rounded px-1.5 py-1 text-right font-black" value="${esc(it.qty)}" ${readOnly ? 'disabled' : ''} /></td>
                <td class="p-2"><input type="text" class="slip-row-note w-full border border-slate-300 rounded px-1.5 py-1" value="${esc(it.note || '')}" placeholder="LOT·포장 등" ${readOnly ? 'disabled' : ''} /></td>
                <td class="p-2 text-right font-mono ${short ? 'text-rose-600 font-black' : 'text-slate-500'}" title="${short ? '출발지 재고보다 많습니다' : ''}">${stock === null ? '-' : `${fmtQty(stock)} ${esc(stockUnit)}`}</td>
                <td class="p-2 text-center">${readOnly ? '' : '<button type="button" class="slip-row-del text-slate-400 hover:text-rose-600 font-black px-1" title="삭제">✕</button>'}</td>
            </tr>`;
        }).join('');
        if (readOnly) return;
        tbody.querySelectorAll('tr[data-i]').forEach(tr => {
            const i = Number(tr.dataset.i);
            tr.querySelector('.slip-row-qty').addEventListener('input', (e) => { slip.items[i].qty = Number(e.target.value) || 0; renderPreview(); });
            tr.querySelector('.slip-row-qty').addEventListener('change', () => renderRows());
            tr.querySelector('.slip-row-unit').addEventListener('change', (e) => { slip.items[i].unit = e.target.value; renderAll(); });
            tr.querySelector('.slip-row-note').addEventListener('input', (e) => { slip.items[i].note = e.target.value; renderPreview(); });
            tr.querySelector('.slip-row-del').addEventListener('click', () => { slip.items.splice(i, 1); renderAll(); });
        });
    };

    const renderAll = () => {
        const s = issued || slip;
        $('#slip-type').value = s.type;
        $('#slip-date').value = s.date;
        $('#slip-docno').value = s.docNo || '';
        const placeWord = byBuilding(s.type) ? '창고' : '거점';
        $('#slip-from-label').textContent = `출발 ${placeWord}`;
        $('#slip-to-label').textContent = `도착 ${placeWord}`;
        $('#slip-from').innerHTML = locOptions(s.type, s.fromLoc);
        $('#slip-to').innerHTML = locOptions(s.type, s.toLoc);
        $('#slip-partner').value = s.partner || '';
        $('#slip-transport').value = s.transport || '';
        $('#slip-reason').value = s.reason || '';
        $('#slip-worker').value = s.worker || '';
        $('#slip-ship-time').value = s.shipTime || '';
        fillAssigneeSelect($('#slip-assignee'), s.assigneeId || '', s.assigneeName || '');
        $('#slip-fields').disabled = !!issued;
        $('#slip-item-adder').classList.toggle('hidden', !!issued);
        $('#slip-issued-banner').classList.toggle('hidden', !issued);
        if (issued) $('#slip-issued-text').textContent = `발행된 전표 ${issued.docNo} (${issued.date}) — 내용은 바꿀 수 없습니다. [재인쇄]로 다시 인쇄하세요.`;
        $('#slip-btn-issue-text').textContent = issued ? '재인쇄' : '발행 및 인쇄';
        renderRows();
        renderPreview();
        renderApproval();
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
        $(`#slip-partner-list${LS}`).innerHTML = (state.partners || []).map(p => `<option value="${esc(typeof p === 'string' ? p : p.name)}"></option>`).join('');
        $(`#slip-worker-list${LS}`).innerHTML = (state.workers || []).map(w => `<option value="${esc(w.name)}"></option>`).join('');
    };

    // ---------- 품목 검색 (코드·품목명·규격 일부 문자) ----------
    let picked = null;      // 검색 목록에서 고른 품목
    let suggestions = [];
    let activeIdx = -1;
    const specText = (m) => (m.spec && m.spec !== '-' ? m.spec : '');
    const itemLabel = (m) => `[${m.code}] ${m.name}${specText(m) ? ` / ${specText(m)}` : ''}`;

    const findItem = (text) => {
        const t = String(text || '').trim();
        if (!t) return null;
        const lower = t.toLowerCase();
        return state.master.find(m => m.code === t)
            || state.master.find(m => m.code.toLowerCase() === lower)
            || state.master.find(m => m.name === t)
            || state.master.find(m => itemLabel(m) === t)
            || null;
    };

    const hideSuggest = () => { $('#slip-item-suggest').classList.add('hidden'); activeIdx = -1; };
    const renderSuggest = () => {
        const box = $('#slip-item-suggest');
        const q = $('#slip-item-search').value.trim();
        if (!q) { suggestions = []; hideSuggest(); return; }
        suggestions = searchMasterItems(q, 30);
        activeIdx = suggestions.length > 0 ? 0 : -1;
        box.innerHTML = suggestions.length === 0
            ? '<div class="p-3 text-slate-400">일치하는 품목이 없습니다.</div>'
            : suggestions.map((m, i) => `<button type="button" data-i="${i}" class="slip-sg w-full text-left px-2.5 py-1.5 border-b border-slate-100 flex items-center gap-2 ${i === activeIdx ? 'bg-amber-100' : 'hover:bg-amber-50'}">
                    <span class="font-mono font-bold text-slate-800 shrink-0">${esc(m.code)}</span>
                    <span class="font-bold text-slate-700 truncate">${esc(m.name)}</span>
                    <span class="text-slate-400 truncate">${esc(specText(m))}</span>
                    <span class="ml-auto shrink-0 text-[10px] font-bold text-slate-500">${esc(m.unit || 'EA')}</span></button>`).join('');
        box.classList.remove('hidden');
        box.querySelectorAll('.slip-sg').forEach(b => {
            b.addEventListener('mousedown', (e) => e.preventDefault()); // 입력창 blur로 목록이 먼저 닫히지 않게
            b.addEventListener('click', () => pickItem(suggestions[Number(b.dataset.i)]));
        });
        appendNewItemButton(box, q, pickItem);
    };
    const moveActive = (d) => {
        if (suggestions.length === 0) return;
        activeIdx = (activeIdx + d + suggestions.length) % suggestions.length;
        $('#slip-item-suggest').querySelectorAll('.slip-sg').forEach((b, i) => {
            b.classList.toggle('bg-amber-100', i === activeIdx);
            if (i === activeIdx) b.scrollIntoView({ block: 'nearest' });
        });
    };
    const pickItem = (m) => {
        if (!m) return;
        picked = m;
        $('#slip-item-search').value = itemLabel(m);
        $('#slip-item-unit').innerHTML = unitOptions(m.unit || 'EA');
        hideSuggest();
        const fromSite = slip.fromLoc && slip.fromLoc !== EXTERNAL ? slip.fromLoc : '';
        $('#slip-item-hint').textContent = `${itemLabel(m)} · 기본 단위 ${m.unit || 'EA'}${fromSite ? ` · ${locText(fromSite)} 재고 ${fmtQty(stockAt(m.code, fromSite))} ${m.unit || 'EA'}` : ''}`;
        $('#slip-item-qty').focus();
    };

    const addItem = () => {
        const text = $('#slip-item-search').value;
        const qty = Number($('#slip-item-qty').value) || 0;
        const unit = $('#slip-item-unit').value || 'EA';
        const m = (picked && itemLabel(picked) === text.trim() ? picked : null) || findItem(text)
            || (suggestions.length === 1 ? suggestions[0] : null);
        const hint = $('#slip-item-hint');
        if (!m) { hint.textContent = '검색 목록에서 품목을 고르세요.'; $('#slip-item-search').focus(); renderSuggest(); return; }
        if (!(qty > 0)) { hint.textContent = '수량을 입력하세요.'; $('#slip-item-qty').focus(); return; }
        // 같은 품목·같은 단위면 수량을 더하고, 단위가 다르면 따로 줄을 만든다
        const existing = slip.items.find(it => it.code === m.code && sameUnit(it.unit, unit));
        if (existing) existing.qty = Number(existing.qty) + qty;
        else slip.items.push({ code: m.code, name: m.name, spec: specText(m), unit, qty, note: '' });
        hint.textContent = existing ? `[${m.code}] 이미 있는 품목(${unit})이라 수량을 더했습니다.` : '';
        picked = null;
        suggestions = [];
        $('#slip-item-search').value = '';
        $('#slip-item-qty').value = '';
        $('#slip-item-unit').innerHTML = unitOptions('EA');
        $('#slip-item-search').focus();
        renderAll();
    };

    // 전표 종류를 바꾸면 출발·도착 위치를 그 종류에서 고를 수 있는 값으로 맞춘다
    const fitLoc = (type, loc, fallback) => {
        const choices = locChoices(type);
        if (choices.includes(loc)) return loc;
        if (choices.includes(siteOf(loc))) return siteOf(loc);
        // 메시지 글('김포' → '김포공장', '본사(도창)' → '본사')
        const t = String(loc || '').replace(/\s+/g, '');
        const near = t.length >= 2 && choices.find(c => c !== EXTERNAL && (c.replace(/\s+/g, '').includes(t) || t.includes(c.replace(/\s+/g, ''))));
        return near || fallback;
    };

    // ---------- 인쇄: 새 창에 위아래 두 장 (윗장 받는 곳 / 아랫장 보내는 곳) ----------
    // 창은 버튼을 누른 순간 열어 두어야 팝업 차단을 피한다
    const openPrintWindow = () => {
        const w = window.open('', '_blank');
        if (!w) alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.');
        else w.document.write('<p style="font-family:sans-serif;padding:20px">전표를 준비하는 중...</p>');
        return w;
    };
    const printSlip = async (w) => {
        if (!w || !issued) return;
        await loadIssuedExtras();
        writeSlipPrintWindow(w, `${SLIP_TYPES[issued.type]?.label || '전표'} ${issued.docNo}`, slipDocHtml(issued, { ...docOpts(issued), slots, qrHtml: qrSvgText }));
    };
    const showIssued = (s) => {
        issued = s;
        slots = {};
        qrSvgText = '';
        renderAll();
        loadIssuedExtras();
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
                        ${s.shippedAt ? `<span class="ml-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold" title="${esc(new Date(s.shippedAt).toLocaleString('ko-KR'))} ${esc(s.shippedBy || '')}">QR 검수·출고 완료</span>` : ''}
                        <div class="text-slate-600 truncate">${esc(locText(s.fromLoc) || '-')} → ${esc(s.toLoc === EXTERNAL || !s.toLoc ? (s.partner || EXTERNAL) : locText(s.toLoc))}${s.partner && s.toLoc !== EXTERNAL ? ` (${esc(s.partner)})` : ''} · ${s.items.length}품목 · ${esc(s.worker || '')}${s.assigneeName ? ` · 담당 <b>${esc(s.assigneeName)}</b>` : ''}${s.shipTime ? ` · ⏰${esc(s.shipTime)}` : ''}</div>
                    </div>
                    <div class="flex gap-1">
                        <button type="button" class="slip-h-view px-2 py-1 bg-slate-800 text-white rounded font-bold" data-i="${i}">보기·재인쇄</button>
                        <button type="button" class="slip-h-copy px-2 py-1 bg-white border border-slate-300 rounded font-bold" data-i="${i}">복사해 새 전표</button>
                    </div>
                </div>`).join('');
            listEl.querySelectorAll('.slip-h-view').forEach(b => b.addEventListener('click', () => {
                $('#slip-history').classList.add('hidden');
                showIssued(list[Number(b.dataset.i)]);
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
        slip = { ...blank(), type: src.type, fromLoc: src.fromLoc, toLoc: src.toLoc, partner: src.partner, transport: src.transport, reason: src.reason, assigneeId: src.assigneeId || '', assigneeName: src.assigneeName || '', items: src.items.map(it => ({ ...it })) };
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
    $('#slip-type').addEventListener('change', () => {
        readFields();
        const choices = locChoices(slip.type);
        slip.fromLoc = fitLoc(slip.type, slip.fromLoc, choices[0] || '');
        const otherLoc = choices.find(c => c !== slip.fromLoc) || '';
        slip.toLoc = fitLoc(slip.type, slip.toLoc, otherLoc);
        if (slip.toLoc === slip.fromLoc) slip.toLoc = otherLoc; // 창고간 → 거점 전환 시 같은 거점이 되는 경우
        renderAll();
        refreshDocNo();
    });
    $('#slip-date').addEventListener('change', () => { readFields(); refreshDocNo(); });
    ['#slip-from', '#slip-to'].forEach(sel => $(sel).addEventListener('change', () => { readFields(); renderRows(); renderPreview(); }));
    ['#slip-partner', '#slip-transport', '#slip-reason', '#slip-worker'].forEach(sel => $(sel).addEventListener('input', () => { readFields(); renderPreview(); }));
    ['#slip-ship-time', '#slip-assignee'].forEach(sel => $(sel).addEventListener('change', () => readFields()));
    $('#slip-item-add').addEventListener('click', addItem);
    $('#slip-item-search').addEventListener('input', () => { picked = null; renderSuggest(); });
    $('#slip-item-search').addEventListener('focus', () => { if (!picked) renderSuggest(); });
    $('#slip-item-search').addEventListener('blur', () => setTimeout(hideSuggest, 150));
    $('#slip-item-search').addEventListener('keydown', (e) => {
        const open = !$('#slip-item-suggest').classList.contains('hidden');
        if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) renderSuggest(); else moveActive(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
        else if (e.key === 'Escape') hideSuggest();
        else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && suggestions[activeIdx]) pickItem(suggestions[activeIdx]);
            else if (picked) $('#slip-item-qty').focus();
        }
    });
    $('#slip-item-qty').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
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
        if (issued) { await printSlip(openPrintWindow()); return; }
        readFields();
        if (slip.fromLoc && slip.fromLoc === slip.toLoc && slip.fromLoc !== EXTERNAL) { alert('출발지와 도착지가 같습니다.'); return; }
        if (slip.toLoc === EXTERNAL && !slip.partner) { alert('외부로 보낼 때는 거래처(받는 곳)를 입력하세요.'); $('#slip-partner').focus(); return; }
        if (!slip.assigneeId && !confirm('담당자(수신자)를 지정하지 않았습니다. 알림 없이 발행할까요?')) { $('#slip-assignee').focus(); return; }
        const btn = $('#slip-btn-issue');
        btn.disabled = true;
        const w = openPrintWindow();
        try {
            showIssued(await issueSlip(slip));
            showToast(`📄 전표 ${issued.docNo}를 발행했습니다. 윗장은 받는 곳, 아랫장은 보내는 곳에서 보관하세요.`);
            notifyAssignee(issued);
            try { onIssued?.(issued); } catch (e) { console.warn('[전표] onIssued', e); }
            // 출고요청서는 발행과 함께 일정관리 출하예정 일정으로도 들어간다 (services/db.js syncSlipToCalendar)
            if (issued.type === 'RELEASE' && state.schedules.some(s => s.id === `SCHED-SLIP-${issued.docNo}`)) showToast(`🗓️ ${issued.date}${issued.shipTime ? ` ${issued.shipTime}` : ''} 일정관리에 출하예정으로 넣었습니다.`);
            // 출고요청서·이동전표 → 그 날짜 일일 생산계획 업무(5. 출고 / 4. 이동제품)에 자동 반영 (services/planAuto.js)
            reflectSlip(issued).then(r => { if (r === 'ADDED') showToast(`📋 ${issued.date} 일일 생산계획 업무에 전표 ${issued.docNo}를 넣었습니다.`); })
                .catch(e => showToast(`⚠️ ${e.message}`));
            await printSlip(w);
        } catch (err) {
            w?.close();
            alert(err.message);
        } finally {
            btn.disabled = false;
        }
    });

    // 발행한 전표 → 담당자(수신자) 할일 + 메시지 (출하 시간이 있으면 30분 전 알림)
    const notifyAssignee = async (s) => {
        if (!s.assigneeId) return;
        const label = SLIP_TYPES[s.type]?.label || '전표';
        const route = `${locText(s.fromLoc) || '-'} → ${s.toLoc === EXTERNAL || !s.toLoc ? (s.partner || EXTERNAL) : locText(s.toLoc)}`;
        const res = await assignTasks({
            ref: `SLIP:${s.docNo}`, assignee: { id: s.assigneeId, name: s.assigneeName },
            tasks: [{ part: '', label: '출하 예정', text: `[${label}] ${s.docNo} ${route} · ${s.items.length}품목 출하 확인`, dueDate: s.date, dueTime: s.shipTime, remindBefore: 30 }],
            title: `[전표 발행] ${label} ${s.docNo}`,
            lines: [route, s.items.slice(0, 5).map(it => `· ${it.name} ${it.qty}${it.unit}`).join('\n') + (s.items.length > 5 ? `\n· 외 ${s.items.length - 5}품목` : ''), s.reason ? `사유: ${s.reason}` : ''],
            link: { tab: 'slipIssue', set: { __slipOpenDocNo: s.docNo } }
        });
        showToast(res.ok ? `🔔 ${res.message}` : `⚠️ ${res.message}`);
    };

    // 할일·알림의 [열기]로 들어오면 그 전표를 보여 준다 (window.__slipOpenDocNo)
    // 전표관리의 [복사해 새 전표]는 window.__slipCopyDocNo로 그 전표 내용을 새 전표로 채운다
    const openPendingSlip = async () => {
        // 메시지 접수(services/msgIntake.js)·일일 생산계획의 초안: window.__slipDraft = { type, date, fromLoc, toLoc, partner, transport, reason, items }
        const draft = window.__slipDraft;
        if (draft) {
            window.__slipDraft = null;
            if (!issued && slip.items.length > 0 && !confirm(`작성 중인 전표를 지우고 ${draft.notice ? '주문(생산요청서)' : '받은 메시지'} 내용으로 채울까요?`)) return true;
            const type = SLIP_TYPES[draft.type] ? draft.type : 'TRANSFER';
            const choices = locChoices(type);
            const fromLoc = fitLoc(type, draft.fromLoc, choices[0] || '');
            let toLoc = fitLoc(type, draft.toLoc, choices.find(c => c !== fromLoc) || '');
            if (toLoc === fromLoc) toLoc = choices.find(c => c !== fromLoc) || '';
            copyToNew({ type, fromLoc, toLoc, partner: draft.partner || '', transport: TRANSPORTS.includes(draft.transport) ? draft.transport : '사내 차량', reason: draft.reason || '', items: draft.items || [] });
            slip.date = draft.date || slip.date;
            renderAll(); refreshDocNo();
            showToast(draft.notice || '📨 받은 메시지로 전표를 채웠습니다. 출발·도착지와 품목을 확인하고 발행하세요.');
            return true;
        }
        // 전표관리 분류 탭의 [○○전표 발행]: 그 종류로 새 전표 (작성 중인 내용이 있으면 그대로 둠)
        const newType = window.__slipNewType;
        if (newType) {
            window.__slipNewType = null;
            if (SLIP_TYPES[newType] && (issued || slip.items.length === 0)) {
                resetNew();
                $('#slip-type').value = newType;
                $('#slip-type').dispatchEvent(new Event('change'));
                return true;
            }
        }
        const copyNo = window.__slipCopyDocNo;
        if (copyNo) {
            window.__slipCopyDocNo = null;
            try { const s = await getSlipByDocNo(copyNo); if (s) { copyToNew(s); return true; } } catch (e) { showToast(`⚠️ ${e.message}`); }
        }
        const no = window.__slipOpenDocNo;
        if (!no) return false;
        window.__slipOpenDocNo = null;
        try { const s = await getSlipByDocNo(no); if (s) { showIssued(s); return true; } } catch (e) { showToast(`⚠️ ${e.message}`); }
        return false;
    };

    // 모달을 열 때마다 목록과 번호를 새로 맞춘다 (openModalByName이 'modal:open' 이벤트를 보냄)
    modalEl.addEventListener('modal:open', async () => {
        fillLists();
        if (await openPendingSlip()) return;
        if (!issued && slip.items.length === 0) resetNew();
        else { renderAll(); refreshDocNo(); }
    });

    resetNew();
    createIcons({ icons });
};
