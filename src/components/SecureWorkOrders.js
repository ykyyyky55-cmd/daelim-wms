import { state, latestRawUnitPrice } from '../services/db.js';
import { localDateStr, matchesQuery, resolveMasterItem } from '../services/searchUtils.js';
import { locationOptionsHtml } from '../services/locations.js';
import { renderPackUsage } from './PackUsageStandards.js';
import { hasWorklogAccess, hasWoUserAccess } from '../services/auth.js';
import { mountWoUserView } from './WorkOrderUserView.js';
import {
    secure, loadSecureData, saveRecipe, saveSecureOrder, deleteSecureOrder,
    nextOrderNo, scaleMaterials, completeSecureOrder, listRecipeRevisions, restoreRecipeRevision, restoreSecureData,
    deleteRecipesKeepOrders, deleteSecureOrders, onSnapshotFailure
} from '../services/secureWorkOrders.js';
import { buildBackup, encryptBackup, decryptBackup, downloadBlob, backupFileName } from '../services/secureBackup.js';
import { restoreBoms } from '../services/plans.js';
import { parseSpecWorkbook } from '../services/specImport.js';
import { cmpRev, planFolderImport, settleProducts } from '../services/specFolderImport.js';
import worklogTemplate from '../data/worklogTemplate.json';
import * as XLSX from 'xlsx';
import { qrDataUrl } from '../services/qrCode.js';
import { Html5Qrcode } from 'html5-qrcode';
import { createIcons, icons } from '../services/icons.js';

import { esc } from '../services/html.js';
import { CONFIDENTIAL_CSS, confidentialHtml, logoImgHtml } from '../services/docMarks.js';
import { createGroupCollapse } from './listCollapse.js';
const fmt = (n, d = 3) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const STATUS = {
    DRAFT: { label: '작성 중', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
    ISSUED: { label: '발행', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    COMPLETED: { label: '생산 완료', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    CANCELLED: { label: '취소', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
};
const statusBadge = (s) => `<span class="inline-block whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-extrabold border ${STATUS[s]?.cls || ''}">${STATUS[s]?.label || esc(s)}</span>`;
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯';
// 제조시방서 분류 기본값 (시방서에 입력한 새 분류는 자동으로 목록에 추가됨)
const DEFAULT_RECIPE_CATEGORIES = ['엔진오일', '엔진코팅제', '첨가제'];
const UNCATEGORIZED = '미분류';

const productKey = (r) => String(r?.productName || '').trim();

/**
 * 원액생산 작업지시서 (특별보안) — 마스터·작업일지 관리자 전용
 * - 작업지시서: 제조시방서를 골라 생산량만큼 원료 소요량을 산출해 발행·보관·인쇄(원료코드로만 표기)·생산 완료 처리
 * - 제조시방서: 엑셀(제조시방서+작업일지 양식) 가져오기, 원료코드·품목코드 연결 관리
 */
// 개정이력 저장 실패를 모아 한 번에 알린다 (일괄 작업은 시방서 수백 건을 연달아 저장하므로 건마다 알리지 않음)
const watchSnapshotFailures = (showToast) => {
    const failedNames = new Set();
    let lastMessage = '';
    let timer = null;
    onSnapshotFailure((productName, message) => {
        failedNames.add(productName || '(이름 없음)');
        lastMessage = message;
        clearTimeout(timer);
        timer = setTimeout(() => {
            const names = [...failedNames];
            const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` 외 ${names.length - 3}건` : '');
            showToast(`⚠️ 개정이력 저장 실패 (${shown}): 시방서는 저장됐지만 이전 내용이 이력에 남지 않았습니다. [${lastMessage}]`);
            failedNames.clear();
        }, 800);
    });
};

export const renderSecureWorkOrders = async (container, { showToast }) => {
    // 작업지시서 사용자(작업일지 관리자가 아닌 경우): 제조시방서·원료 실명 없이 작업지시서 열람 + 생산량·단위 수정만
    const limited = !hasWorklogAccess();
    if (limited && !hasWoUserAccess()) {
        container.innerHTML = `<div class="p-8 text-center text-rose-600 font-black">🔒 접근 권한이 없습니다. 마스터 관리자에게 '작업일지 관리자' 또는 '작업지시서 사용자' 권한을 요청하세요.</div>`;
        return;
    }
    watchSnapshotFailures(showToast);
    let tab = 'orders';
    let statusFilter = '';
    let query = '';
    const recipeFilter = { q: '', cat: '', sub: '', view: 'latest' }; // 제조시방서 목록 검색·분류 필터, view: latest(최신)/archive(구버전 보관함)
    const recipeSelected = new Set();                  // 분류 일괄 지정·일괄 삭제용 선택
    const orderFilter = { cat: '', sub: '' };          // 작업지시서 목록 분류 필터 (분류는 연결된 시방서 기준)
    // 분류 묶음은 처음에 모두 접혀 머리줄(건수)만 보인다. 머리줄·[펼치기]·분류/종류 선택·검색으로 펼친다 (components/listCollapse.js)
    const orderGroups = createGroupCollapse({ label: '작업지시서 분류', onToggle: () => renderOrderRows() });
    const recipeGroups = createGroupCollapse({ label: '제조시방서 분류', onToggle: () => renderRecipeRows() });
    // 분류 묶음 머리줄 (누르면 그 분류만 펼치거나 접는다)
    const groupHeadRow = (key, count, isOpen, colspan) => `
        <tr class="sw-group-head bg-amber-50 hover:bg-amber-100 cursor-pointer select-none" data-group="${esc(key)}" title="눌러서 ${isOpen ? '접기' : '펼치기'}">
            <td colspan="${colspan}" class="px-2.5 py-1.5 font-black text-amber-900">${isOpen ? '▾' : '▸'} 📁 ${esc(key)} <span class="font-bold text-amber-700">(${count})</span></td>
        </tr>`;
    const orderSelected = new Set();                   // 작업지시서 일괄 삭제용 선택

    container.innerHTML = `<div class="p-10 text-center text-slate-400 font-bold">🔒 보안 자료를 불러오는 중...</div>`;
    try {
        if (!limited) await loadSecureData(); // 작업지시서 사용자는 보안 자료(제조시방서·원본 작업지시서)를 받지 않는다
    } catch (e) {
        container.innerHTML = `<div class="p-8 text-center text-rose-600 font-black">${esc(e.message)}</div>`;
        return;
    }

    const rawItems = state.master.filter(m => m.category === '원료' || m.category === '원액');
    const wonaekItems = state.master.filter(m => m.category === '원액');

    const render = () => {
        container.innerHTML = `
        <div class="space-y-5">
            <div class="bg-gradient-to-br from-amber-950 via-slate-900 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-400/20 text-amber-200 border border-amber-300/40">🔒 특별보안 · 마스터 / 작업일지 관리자 전용</span>
                        <h2 class="text-xl font-black mt-2 flex items-center gap-2"><i data-lucide="flask-round" class="w-5 h-5"></i><span>원액생산 작업지시서</span></h2>
                        <p class="text-xs text-slate-300 mt-1">제조시방서(배합)를 기준으로 작업지시서를 발행·보관합니다. 인쇄물에는 원료 실명 대신 원료코드만 표기됩니다.</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                    <div class="flex bg-white/10 p-1 rounded-xl text-xs font-bold">
                        <button type="button" id="sw-backup" class="px-3 py-2 rounded-lg text-slate-200 hover:bg-white/10 flex items-center gap-1" title="제조시방서·작업지시서·배합비를 암호화 파일로 백업"><i data-lucide="download" class="w-4 h-4"></i>백업</button>
                        <button type="button" id="sw-restore" class="px-3 py-2 rounded-lg text-slate-200 hover:bg-white/10 flex items-center gap-1" title="백업 파일로 복원"><i data-lucide="upload" class="w-4 h-4"></i>복원</button>
                    </div>
                    <div class="flex bg-white/10 p-1 rounded-xl text-xs font-bold">
                        <button type="button" class="sw-tab px-4 py-2 rounded-lg ${tab === 'orders' ? 'bg-white text-slate-900' : 'text-slate-200 hover:bg-white/10'}" data-tab="orders">작업지시서 (${secure.orders.length})</button>
                        <button type="button" class="sw-tab px-4 py-2 rounded-lg ${tab === 'recipes' ? 'bg-white text-slate-900' : 'text-slate-200 hover:bg-white/10'}" data-tab="recipes">제조시방서 (${latestByProduct().size})</button>
                        ${limited ? '' : `<button type="button" class="sw-tab px-4 py-2 rounded-lg ${tab === 'pack' ? 'bg-white text-slate-900' : 'text-slate-200 hover:bg-white/10'}" data-tab="pack" title="완제품·라벨부착 포장 1단위당 원액·부자재 사용량 (제품생산/입고 자동 차감)">포장사용기준서</button>`}
                    </div>
                    </div>
                </div>
            </div>
            <div id="sw-body"></div>
        </div>
        <div id="sw-modal" class="fixed inset-0 bg-slate-900/60 z-50 hidden items-start justify-center p-4 overflow-y-auto"></div>`;
        container.querySelectorAll('.sw-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
        $('#sw-backup').addEventListener('click', openBackupModal);
        $('#sw-restore').addEventListener('click', openRestoreModal);
        // 포장사용기준서: 완제품·라벨부착 포장 사용량 (components/PackUsageStandards.js, 제품 BOM과 같은 자료)
        if (tab === 'orders') renderOrders(); else if (tab === 'pack' && !limited) renderPackUsage($('#sw-body'), { showToast }); else renderRecipes();
        createIcons({ icons });
    };

    const $ = (s) => container.querySelector(s);
    const modal = () => $('#sw-modal');
    const activeSearchBoxes = [];
    const openModal = (html) => { const m = modal(); m.innerHTML = html; m.classList.remove('hidden'); m.classList.add('flex'); createIcons({ icons }); };
    const closeModal = () => {
        const m = modal(); m.classList.add('hidden'); m.classList.remove('flex'); m.innerHTML = '';
        activeSearchBoxes.forEach(b => b.remove());
        activeSearchBoxes.length = 0;
        if (scanCamera) {
            const cam = scanCamera;
            scanCamera = null;
            cam.stop().catch(() => {}).finally(() => { try { cam.clear(); } catch { /* noop */ } });
        }
    };

    // 재고 품목(원료/원액)을 코드·품명 일부 문자로 검색해 고르는 자동완성 드롭다운
    // (모달의 표 안에 있어도 잘리지 않도록 body에 fixed로 띄운다)
    const attachItemSearch = (input, pool, onPick) => {
        const box = document.createElement('div');
        box.className = 'fixed z-[9999] bg-white border border-slate-300 rounded-lg shadow-xl max-h-48 overflow-y-auto text-[11px] hidden';
        document.body.appendChild(box);
        activeSearchBoxes.push(box);
        const position = () => {
            const rc = input.getBoundingClientRect();
            box.style.left = `${rc.left}px`;
            box.style.top = `${rc.bottom + 2}px`;
            box.style.width = `${Math.max(rc.width, 240)}px`;
        };
        const close = () => { box.classList.add('hidden'); box.innerHTML = ''; };
        input.addEventListener('input', () => {
            const q = input.value.trim();
            if (!q) { close(); return; }
            const hits = pool.filter(m => matchesQuery(m, q, ['code', 'name'])).slice(0, 8);
            if (!hits.length) { close(); return; }
            position();
            box.innerHTML = hits.map(m => `<div class="sr-hit px-2 py-1 hover:bg-amber-50 cursor-pointer" data-code="${esc(m.code)}"><span class="font-mono font-bold">${esc(m.code)}</span> <span class="text-slate-600">${esc(m.name)}</span></div>`).join('');
            box.classList.remove('hidden');
            box.querySelectorAll('.sr-hit').forEach(h => h.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = h.dataset.code;
                close();
                onPick(h.dataset.code);
            }));
        });
        input.addEventListener('blur', () => setTimeout(close, 150));
        input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')); });
    };

    // ==========================================
    // 작업지시서 목록
    // ==========================================
    // 작업지시서의 분류·종류는 연결된 제조시방서를 따른다 (시방서 분류를 바꾸면 함께 바뀜)
    const orderViews = () => secure.orders.map(o => {
        const r = secure.recipes.find(x => x.id === o.recipeId);
        // 시방서를 지운 지시서는 지울 때 옮겨 둔 분류를 쓴다
        return { o, category: r?.category || o.category || '', subCategory: r?.subCategory || o.subCategory || '' };
    });
    const filteredOrders = () => {
        const cats = recipeCategories();
        const catOrder = (c) => (c === UNCATEGORIZED ? 9999 : cats.indexOf(c));
        return orderViews()
            .filter(v => !statusFilter || v.o.status === statusFilter)
            .filter(v => !orderFilter.cat || catKey(v) === orderFilter.cat)
            .filter(v => !orderFilter.sub || subKey(v) === orderFilter.sub)
            .filter(v => !query || matchesQuery(v.o, query, ['orderNo', 'productName', 'lotNo', 'customer', 'author', 'worker']))
            .map((v, i) => ({ ...v, i }))
            // 분류 → 종류 순으로 묶고, 묶음 안에서는 원래 순서(최신순) 유지
            .sort((a, b) => catOrder(catKey(a)) - catOrder(catKey(b)) || subKey(a).localeCompare(subKey(b), 'ko') || a.i - b.i);
    };

    const updateOrderBulkBar = () => {
        const n = [...orderSelected].filter(id => secure.orders.some(o => o.id === id)).length;
        $('#sw-bulk').classList.toggle('hidden', n === 0);
        $('#sw-bulk-count').textContent = `${n}건 선택`;
    };

    // openMatches: 분류·종류·상태를 고르거나 검색했을 때 결과 묶음을 펼친다
    const renderOrderRows = ({ openMatches = false } = {}) => {
        const list = filteredOrders();
        const groupKeys = [...new Set(list.map(catKey))];
        if (openMatches) orderGroups.openKeys(groupKeys);
        orderGroups.setKeys(groupKeys);
        const visibleList = list.filter(v => orderGroups.isOpen(catKey(v))); // 펼친 묶음의 지시서만 (전체 선택 대상)
        $('#sw-count').textContent = `${list.length} / ${secure.orders.length}건`;
        let lastCat = null;
        let lastSub = null;
        const html = list.map(v => {
            const o = v.o;
            const isGroupOpen = orderGroups.isOpen(catKey(v));
            let head = '';
            if (catKey(v) !== lastCat) {
                const n = list.filter(x => catKey(x) === catKey(v)).length;
                head += groupHeadRow(catKey(v), n, isGroupOpen, 10);
                lastCat = catKey(v);
                lastSub = null;
            }
            if (!isGroupOpen) return head; // 접힌 묶음은 머리줄만
            if (subKey(v) !== lastSub && v.subCategory) {
                const n = list.filter(x => catKey(x) === catKey(v) && subKey(x) === subKey(v)).length;
                head += `<tr class="bg-slate-50"><td colspan="10" class="pl-7 pr-2.5 py-1 font-bold text-slate-600">└ ${esc(v.subCategory)} <span class="text-slate-400">(${n})</span></td></tr>`;
            }
            lastSub = subKey(v);
            return `${head}
                <tr class="hover:bg-slate-50">
                    <td class="p-2.5 text-center"><input type="checkbox" class="sw-check w-4 h-4" data-id="${esc(o.id)}" ${orderSelected.has(o.id) ? 'checked' : ''} /></td>
                    <td class="p-2.5 whitespace-nowrap">${v.category ? `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">${esc(v.category)}</span>` : '<span class="text-slate-300">미분류</span>'}${v.subCategory ? ` <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">${esc(v.subCategory)}</span>` : ''}</td>
                    <td class="p-2.5 font-mono font-black text-amber-800 whitespace-nowrap">${esc(o.orderNo)}</td>
                    <td class="p-2.5 font-mono whitespace-nowrap">${esc(o.mfgDate || '-')}</td>
                    <td class="p-2.5"><div class="font-bold text-slate-900">${esc(o.productName)}</div><div class="text-[10px] text-slate-400">${esc(o.revision || '')}</div></td>
                    <td class="p-2.5 text-right font-mono font-bold whitespace-nowrap">${fmt(o.prodQty)} ${esc(o.prodUnit || 'D/M')}${o.actualQty ? `<div class="text-[10px] text-emerald-700">실 ${fmt(o.actualQty)}</div>` : ''}</td>
                    <td class="p-2.5 font-mono whitespace-nowrap">${esc(o.lotNo || '-')}</td>
                    <td class="p-2.5">${esc(o.customer || '-')}</td>
                    <td class="p-2.5 text-center">${statusBadge(o.status)}</td>
                    <td class="p-2.5 text-center whitespace-nowrap">
                        <button type="button" class="sw-print p-1 text-slate-500 hover:text-slate-900 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(o.id)}" title="작업일지 인쇄"><i data-lucide="printer" class="w-4 h-4"></i></button>
                        <button type="button" class="sw-edit p-1 text-slate-500 hover:text-blue-600 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(o.id)}" title="수정·검사 결과 입력"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                        ${o.status === 'ISSUED' || o.status === 'DRAFT' ? `<button type="button" class="sw-complete p-1 text-slate-500 hover:text-emerald-600 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(o.id)}" title="생산 완료 처리"><i data-lucide="check-circle-2" class="w-4 h-4"></i></button>
                        <button type="button" class="sw-cancel p-1 text-slate-500 hover:text-rose-600 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(o.id)}" title="취소"><i data-lucide="ban" class="w-4 h-4"></i></button>` : ''}
                        ${o.status !== 'COMPLETED' ? `<button type="button" class="sw-del p-1 text-slate-400 hover:text-rose-600 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(o.id)}" title="삭제"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
                    </td>
                </tr>`;
        }).join('');
        const tbody = $('#sw-rows');
        tbody.innerHTML = html || '<tr><td colspan="10" class="p-8 text-center text-slate-400 font-bold">작업지시서가 없습니다.</td></tr>';
        $('#sw-check-all').checked = visibleList.length > 0 && visibleList.every(v => orderSelected.has(v.o.id));
        updateOrderBulkBar();

        const byId = (id) => secure.orders.find(o => o.id === id);
        tbody.querySelectorAll('.sw-group-head').forEach(row => row.addEventListener('click', () => {
            orderGroups.toggle(row.dataset.group);
            renderOrderRows();
        }));
        tbody.querySelectorAll('.sw-check').forEach(c => c.addEventListener('change', () => {
            if (c.checked) orderSelected.add(c.dataset.id); else orderSelected.delete(c.dataset.id);
            $('#sw-check-all').checked = visibleList.length > 0 && visibleList.every(v => orderSelected.has(v.o.id));
            updateOrderBulkBar();
        }));
        tbody.querySelectorAll('.sw-print').forEach(b => b.addEventListener('click', () => printWorkLog(byId(b.dataset.id))));
        tbody.querySelectorAll('.sw-edit').forEach(b => b.addEventListener('click', () => openOrderEditor(byId(b.dataset.id))));
        tbody.querySelectorAll('.sw-complete').forEach(b => b.addEventListener('click', () => openCompleteModal(byId(b.dataset.id))));
        tbody.querySelectorAll('.sw-cancel').forEach(b => b.addEventListener('click', async () => {
            const o = byId(b.dataset.id);
            if (!confirm(`[${o.orderNo}] 작업지시서를 취소하시겠습니까?`)) return;
            await run(() => saveSecureOrder({ ...o, status: 'CANCELLED' }), '작업지시서를 취소했습니다.');
        }));
        tbody.querySelectorAll('.sw-del').forEach(b => b.addEventListener('click', async () => {
            const o = byId(b.dataset.id);
            if (!confirm(`[${o.orderNo}] 작업지시서를 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
            orderSelected.delete(o.id);
            await run(() => deleteSecureOrder(o.id), '작업지시서를 삭제했습니다.');
        }));
        createIcons({ icons });
    };

    const renderOrders = () => {
        $('#sw-body').innerHTML = `
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 text-xs">
            <div class="flex flex-wrap items-center gap-2">
                <button type="button" id="sw-new-order" class="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black flex items-center gap-1"><i data-lucide="plus" class="w-4 h-4"></i>새 작업지시서</button>
                <button type="button" id="sw-bulk-issue" class="px-3 py-2 bg-white border border-amber-400 hover:bg-amber-50 text-amber-800 rounded-xl font-black flex items-center gap-1"><i data-lucide="files" class="w-4 h-4"></i>최신 시방서 일괄 발행</button>
                <button type="button" id="sw-scan-complete" class="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl font-black flex items-center gap-1"><i data-lucide="qr-code" class="w-4 h-4"></i>QR 스캔으로 생산 완료</button>
                <select id="sw-status" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                    <option value="">전체 상태</option>
                    ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${statusFilter === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
                </select>
            </div>
            <div class="flex flex-wrap items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                <div class="relative flex-1 min-w-[200px]">
                    <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"></i>
                    <input type="search" id="sw-q" value="${esc(query)}" placeholder="제품명·지시번호·Lot·납품처 일부 입력" autocomplete="off" class="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-2 py-1.5 font-bold" />
                </div>
                <select id="sw-filter-cat" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${catOptionsFor(orderViews(), orderFilter)}</select>
                <select id="sw-filter-sub" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${subOptionsFor(orderViews(), orderFilter)}</select>
                <span id="sw-count" class="text-slate-500 font-bold"></span>
                <div id="sw-group-collapse" class="ml-auto"></div>
            </div>
            <div id="sw-bulk" class="hidden flex flex-wrap items-center gap-2 p-2.5 bg-rose-50 border border-rose-200 rounded-xl">
                <span id="sw-bulk-count" class="font-black text-rose-900"></span>
                <span class="text-rose-700">분류는 제조시방서를 따릅니다. 생산 완료된 작업지시서는 삭제되지 않습니다.</span>
                <button type="button" id="sw-bulk-clear" class="ml-auto px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-bold">선택 해제</button>
                <button type="button" id="sw-bulk-del" class="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-black flex items-center gap-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>선택 삭제</button>
            </div>
            ${secure.recipes.length === 0 ? '<div class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 font-bold">등록된 제조시방서가 없습니다. [제조시방서] 탭에서 엑셀을 가져온 뒤 작업지시서를 발행하세요.</div>' : ''}
            <div class="overflow-auto border border-slate-200 rounded-xl max-h-[65vh]">
                <table class="w-full">
                    <thead class="bg-slate-50 text-slate-600 font-bold sticky top-0 z-10"><tr>
                        <th class="p-2.5 w-8 text-center"><input type="checkbox" id="sw-check-all" class="w-4 h-4" title="보이는 작업지시서 전체 선택" /></th>
                        <th class="p-2.5 text-left whitespace-nowrap">분류 / 종류</th>
                        <th class="p-2.5 text-left whitespace-nowrap">지시번호</th><th class="p-2.5 text-left whitespace-nowrap">제조일자</th>
                        <th class="p-2.5 text-left">제품명 / 관련근거</th><th class="p-2.5 text-right whitespace-nowrap">생산량</th>
                        <th class="p-2.5 text-left whitespace-nowrap">Lot No.</th><th class="p-2.5 text-left">납품처</th>
                        <th class="p-2.5 text-center whitespace-nowrap">상태</th><th class="p-2.5 text-center whitespace-nowrap">관리</th>
                    </tr></thead>
                    <tbody id="sw-rows" class="divide-y divide-slate-100"></tbody>
                </table>
            </div>
        </div>`;
        $('#sw-new-order').addEventListener('click', () => {
            if (secure.recipes.filter(r => r.active).length === 0) { alert('사용 중인 제조시방서가 없습니다. 먼저 [제조시방서] 탭에서 엑셀을 가져오세요.'); return; }
            openOrderEditor(null);
        });
        $('#sw-bulk-issue').addEventListener('click', bulkIssueLatest);
        $('#sw-scan-complete').addEventListener('click', openScanCompleteModal);
        const groupHost = $('#sw-group-collapse');
        groupHost.innerHTML = orderGroups.controlsHtml();
        orderGroups.mount(groupHost);
        // 상태·분류·종류를 고르거나 검색하면 결과 묶음을 펼친다
        $('#sw-status').addEventListener('change', (e) => { statusFilter = e.target.value; renderOrderRows({ openMatches: true }); });
        $('#sw-q').addEventListener('input', (e) => { query = e.target.value.trim(); renderOrderRows({ openMatches: !!query }); });
        $('#sw-filter-cat').addEventListener('change', (e) => {
            orderFilter.cat = e.target.value;
            $('#sw-filter-sub').innerHTML = subOptionsFor(orderViews(), orderFilter);
            renderOrderRows({ openMatches: true });
        });
        $('#sw-filter-sub').addEventListener('change', (e) => { orderFilter.sub = e.target.value; renderOrderRows({ openMatches: true }); });
        $('#sw-check-all').addEventListener('change', (e) => {
            // 펼친 묶음의 지시서만 고른다 (접혀 안 보이는 지시서를 모르고 지우지 않게)
            filteredOrders().filter(v => orderGroups.isOpen(catKey(v)))
                .forEach(v => { if (e.target.checked) orderSelected.add(v.o.id); else orderSelected.delete(v.o.id); });
            renderOrderRows();
        });
        $('#sw-bulk-clear').addEventListener('click', () => { orderSelected.clear(); renderOrderRows(); });
        $('#sw-bulk-del').addEventListener('click', async () => {
            const targets = secure.orders.filter(o => orderSelected.has(o.id));
            if (targets.length === 0) return;
            // 작업지시서만 지운다: 제조시방서·생산입고 배합비와 이미 반영된 재고·수불부 기록은 그대로
            const done = targets.filter(o => o.status === 'COMPLETED');
            const listText = targets.slice(0, 20).map(o => `- ${o.orderNo} ${o.productName}`).join('\n') + (targets.length > 20 ? `\n… 외 ${targets.length - 20}건` : '');
            if (!confirm(`선택한 작업지시서 ${targets.length}건을 삭제하시겠습니까? 되돌릴 수 없습니다(필요하면 먼저 [백업]).\n\n${listText}\n\n• 제조시방서·생산입고 배합비는 그대로 둡니다.`)) return;
            let deletable = targets;
            if (done.length && !confirm(`이 중 생산 완료된 작업지시서가 ${done.length}건 있습니다.\n지워도 이미 반영된 재고·원료수불부 기록은 그대로 남지만, 작업일지(지시서)는 다시 볼 수 없습니다.\n\n[확인] 생산 완료 건도 함께 삭제\n[취소] 생산 완료 건은 남기고 나머지만 삭제`)) {
                deletable = targets.filter(o => o.status !== 'COMPLETED');
            }
            if (!deletable.length) return;
            const progress = (msg) => openModal(`<div class="bg-white rounded-2xl shadow-xl p-6 text-sm font-bold text-slate-700 flex items-center gap-3"><i data-lucide="loader-circle" class="w-5 h-5 animate-spin text-rose-600"></i>${esc(msg)}</div>`);
            const kept = targets.length - deletable.length;
            await run(async () => {
                progress(`작업지시서 삭제 중… 0 / ${deletable.length}`);
                await deleteSecureOrders(deletable.map(o => o.id), (d, t) => progress(`작업지시서 삭제 중… ${d} / ${t}`));
                deletable.forEach(o => orderSelected.delete(o.id));
            }, `작업지시서 ${deletable.length}건을 삭제했습니다.${kept ? ` (생산 완료 ${kept}건은 남김)` : ''}`);
        });
        // 이미 고른 조건(검색·분류·종류·상태)이 있으면 그 결과 묶음은 펼쳐 보여 준다
        renderOrderRows({ openMatches: !!(query || orderFilter.cat || orderFilter.sub || statusFilter) });
    };

    const run = async (fn, okMsg) => {
        try {
            await fn();
            if (okMsg) showToast(`🔒 ${okMsg}`);
            closeModal();
            render();
        } catch (e) {
            alert(e.message);
        }
    };

    // ==========================================
    // 작업지시서 작성·수정
    // ==========================================
    const HEADER_FIELDS = [
        ['marking', '5. MARKING'], ['qualityMark', '6. 품질표시'], ['grade', '7. 종호'], ['packaging', '8. 포장단위'],
        ['workInstruction', '10. 작업지시'], ['lotNo', '11. Lot No.'], ['customer', '12. 납품처']
    ];
    const RESULT_FIELDS = [
        ['adjustNotes', 'Adjust 내역'], ['processViscosity', '공정검사 ① 동점도'], ['stickerName', 'Sticker ① 품명'],
        ['volumeSg', '부피환산 ① SG'], ['volumeWt', '부피환산 ② WT'], ['packContainer', '포장검사 ① 포장용기'], ['packLeak', '포장검사 ② 누유'],
        ['verdict', '합부 판정'], ['worker', '작업자'], ['confirmer', '확인자'], ['workStatus', '나. 작업현황 및 내역']
    ];
    // 여러 줄 입력 (인쇄 시 줄바꿈 유지)
    const MULTILINE_FIELDS = ['workStatus', 'adjustNotes'];

    // 최신 시방서(사용 중, 보관함 제외)마다 생산량 1 D/M 작업지시서를 한꺼번에 발행한다.
    // 저장 내용은 [새 작업지시서]에서 시방서를 고르고 바로 발행한 것과 같다. 오늘 이미 발행한(진행 중) 시방서는 건너뜀.
    const bulkIssueLatest = async () => {
        const mfgDate = localDateStr();
        const latest = secure.recipes.filter(r => r.active && !r.archived)
            .sort((a, b) => catKey(a).localeCompare(catKey(b), 'ko') || subKey(a).localeCompare(subKey(b), 'ko') || a.productName.localeCompare(b.productName, 'ko'));
        if (!latest.length) { alert('사용 중인 제조시방서가 없습니다.'); return; }
        const isDrum = (r) => /^D/i.test(String(r.baseUnit || 'D/M').trim()); // D/M, D/M (기준), D(기준)
        const issuedToday = new Set(secure.orders.filter(o => o.mfgDate === mfgDate && o.status !== 'CANCELLED').map(o => o.recipeId));
        const notDrum = latest.filter(r => !isDrum(r));
        const already = latest.filter(r => isDrum(r) && issuedToday.has(r.id));
        const targets = latest.filter(r => isDrum(r) && !issuedToday.has(r.id));
        if (!targets.length) {
            alert(`발행할 시방서가 없습니다.${already.length ? `\n오늘 이미 발행한 시방서 ${already.length}건은 건너뜁니다.` : ''}${notDrum.length ? `\n기준 단위가 D/M이 아닌 시방서 ${notDrum.length}건은 직접 발행하세요.` : ''}`);
            return;
        }
        const noCode = targets.filter(r => r.materials.some(m => !m.rawCode));
        const firstNo = nextOrderNo(mfgDate);
        if (!confirm(`최신 제조시방서 ${targets.length}건의 작업지시서를 발행합니다.\n\n`
            + `• 생산량: 1 D/M (시방서 기준량 그대로)\n• 제조일자: ${mfgDate}\n• 지시번호: ${firstNo}부터 차례로\n• 작성자: ${state.currentUser?.name || '-'}\n`
            + (already.length ? `• 오늘 이미 발행한 ${already.length}건은 건너뜀\n` : '')
            + (notDrum.length ? `• 기준 단위가 D/M이 아닌 ${notDrum.length}건 제외: ${notDrum.map(r => `${r.productName} (${fmt(r.baseQty)} ${r.baseUnit})`).join(', ')}\n` : '')
            + (noCode.length ? `\n⚠ 원료코드가 빈 시방서 ${noCode.length}건은 인쇄물에 '원료코드 없음'으로 나옵니다:\n- ${noCode.map(r => r.productName).join('\n- ')}\n` : '')
            + '\n발행하시겠습니까?')) return;

        const progress = (msg) => openModal(`<div class="bg-white rounded-2xl shadow-xl p-6 text-sm font-bold text-slate-700 flex items-center gap-3"><i data-lucide="loader-circle" class="w-5 h-5 animate-spin text-amber-600"></i>${esc(msg)}</div>`);
        let done = 0;
        try {
            for (const r of targets) {
                if (done % 10 === 0) progress(`작업지시서 발행 중… ${done} / ${targets.length}`);
                const materials = scaleMaterials(r, 1);
                await saveSecureOrder({
                    orderNo: nextOrderNo(mfgDate),
                    recipeId: r.id,
                    productName: r.productName,
                    revision: r.revision,
                    productItemCode: r.productItemCode || '',
                    baseLitersPerUnit: (Number(r.baseLiters) || 0) / (Number(r.baseQty) || 1),
                    mfgDate,
                    prodQty: 1,
                    prodUnit: 'D/M',
                    actualQty: null,
                    author: state.currentUser?.name || '',
                    materials,
                    workStandard: materials.map((_, i) => r.workStandard?.[i] || ''),
                    qcItems: r.qcItems || [],
                    brands: r.brands || [],
                    docNo: r.docNo || 'DLS-QP-113-1(1) 작업일지',
                    qcResults: {},
                    notes: '',
                    ...Object.fromEntries([...HEADER_FIELDS, ...RESULT_FIELDS].map(([k]) => [k, ''])),
                    status: 'ISSUED'
                });
                done++;
            }
        } catch (err) {
            closeModal();
            alert(`${done}건 발행 후 오류로 멈췄습니다: ${err.message}\n다시 누르면 오늘 발행한 시방서는 건너뛰고 이어서 발행합니다.`);
            render();
            return;
        }
        closeModal();
        render();
        showToast(`🔒 작업지시서 ${done}건을 발행했습니다.`);
    };

    const openOrderEditor = (order) => {
        const isNew = !order;
        const activeRecipes = secure.recipes.filter(r => r.active || r.id === order?.recipeId);
        const o = order || {
            orderNo: nextOrderNo(), mfgDate: localDateStr(), prodQty: 1, prodUnit: activeRecipes[0]?.baseUnit || 'D/M',
            recipeId: activeRecipes[0]?.id, author: state.currentUser?.name || '', status: 'ISSUED'
        };
        const input = (id, label, value, extra = '') => `<label class="block"><span class="font-bold text-slate-600">${esc(label)}</span><input id="swo-${id}" value="${esc(value ?? '')}" ${extra} class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>`;
        // 제조시방서가 삭제된 지시서: 다른 시방서가 잘못 골라지지 않게 고정하고, 지시서에 저장된 내용으로만 수정한다
        const orphan = !isNew && !secure.recipes.some(r => r.id === o.recipeId);
        openModal(`
        <form id="swo-form" class="bg-white rounded-2xl shadow-xl w-full max-w-4xl my-6 p-5 space-y-4 text-xs">
            <div class="flex items-center justify-between">
                <h3 class="font-black text-sm text-slate-900">🔒 ${isNew ? '새 원액생산 작업지시서' : `작업지시서 수정 · ${esc(o.orderNo)}`}</h3>
                <button type="button" class="swo-close text-slate-400 hover:text-slate-700 min-w-11 min-h-11 inline-flex items-center justify-center"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                ${input('orderNo', 'NO. (지시번호)', o.orderNo, 'required')}
                <label class="block col-span-2"><span class="font-bold text-slate-600">1. 제품명 (제조시방서)</span>
                    <select id="swo-recipe" ${o.status === 'COMPLETED' || orphan ? 'disabled' : ''} class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                        ${orphan ? `<option value="" selected>(시방서 삭제됨) ${esc(o.productName || '')} · ${esc(o.revision || '-')}</option>` : [...recipeCategories(), UNCATEGORIZED].map(cat => {
                            const group = activeRecipes.filter(r => catKey(r) === cat)
                                .sort((a, b) => subKey(a).localeCompare(subKey(b), 'ko') || a.productName.localeCompare(b.productName, 'ko'));
                            if (group.length === 0) return '';
                            return `<optgroup label="${esc(cat)}">${group.map(r => `<option value="${esc(r.id)}" ${r.id === o.recipeId ? 'selected' : ''}>${r.subCategory ? `[${esc(r.subCategory)}] ` : ''}${esc(r.productName)} · ${esc(r.revision || '-')}</option>`).join('')}</optgroup>`;
                        }).join('')}
                    </select></label>
                ${input('mfgDate', '2. 제조일자', o.mfgDate, 'type="date"')}
                ${input('prodQty', '3. 생산량', o.prodQty, `type="number" min="0" step="any" required ${o.status === 'COMPLETED' ? 'disabled' : ''}`)}
                ${input('prodUnit', '생산량 단위', o.prodUnit || 'D/M')}
                ${input('actualQty', '4. 실생산량', o.actualQty ?? '', 'type="number" min="0" step="any"')}
                ${input('author', '작성자', o.author)}
                ${HEADER_FIELDS.map(([k, l]) => input(k, l, o[k])).join('')}
            </div>
            <div>
                <div class="flex items-center justify-between mb-1">
                    <span class="font-black text-slate-800">가. 작업표준 (원료 소요량 · 단계별 작업표준 · 인쇄 시 원료코드로만 표기)</span>
                    <span id="swo-total" class="font-mono font-bold text-slate-500"></span>
                </div>
                <div class="overflow-x-auto border border-slate-200 rounded-xl"><table class="w-full"><thead class="bg-slate-50 font-bold text-slate-600"><tr>
                    <th class="p-2 text-left">순</th><th class="p-2 text-left">단계</th><th class="p-2 text-left">원료코드</th><th class="p-2 text-left text-amber-700">원료명 (대외비)</th>
                    <th class="p-2 text-right">L</th><th class="p-2 text-right">KG</th><th class="p-2 text-right">SG</th><th class="p-2 text-left">재고 품목 연결</th><th class="p-2 text-left">작업표준 (이 단계)</th>
                </tr></thead><tbody id="swo-mats" class="divide-y divide-slate-100"></tbody></table></div>
            </div>
            <details ${isNew ? '' : 'open'} class="border border-slate-200 rounded-xl p-3">
                <summary class="font-black text-slate-800 cursor-pointer">작업 결과 · 공정/제품 검사 (생산 후 입력)</summary>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-3">${RESULT_FIELDS.map(([k, l]) => (MULTILINE_FIELDS.includes(k)
                    ? `<label class="block col-span-2"><span class="font-bold text-slate-600">${esc(l)}</span><textarea id="swo-${k}" rows="4" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5">${esc(o[k] ?? '')}</textarea></label>`
                    : input(k, l, o[k]))).join('')}</div>
                <div id="swo-qc" class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5 mt-3"></div>
            </details>
            <label class="block"><span class="font-bold text-slate-600">비고</span><textarea id="swo-notes" rows="2" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5">${esc(o.notes || '')}</textarea></label>
            <div class="flex justify-end gap-2">
                <button type="button" class="swo-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button>
                <button type="submit" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black">${isNew ? '발행·저장' : '저장'}</button>
            </div>
        </form>`);

        const recipeSel = modal().querySelector('#swo-recipe');
        const qtyInput = modal().querySelector('#swo-prodQty');
        const currentRecipe = () => secure.recipes.find(r => r.id === recipeSel.value);
        const currentMats = () => {
            // 생산 완료된 지시서는 저장된 소요량 그대로, 그 밖에는 시방서 기준으로 다시 산출
            if (o.status === 'COMPLETED' && o.materials) return o.materials;
            // 시방서가 삭제된 지시서: 저장된 원료를 발행 당시 생산량 기준으로 환산
            if (orphan) return scaleMaterials({ materials: o.materials || [], baseQty: Number(o.prodQty) || 1 }, qtyInput.value);
            const r = currentRecipe();
            return r ? scaleMaterials(r, qtyInput.value) : [];
        };
        // 단계·단계별 작업표준은 사용자가 직접 수정할 수 있다. 원료명/수량이 다시 계산되어 표가 새로
        // 그려져도(생산량·시방서 변경) 입력한 내용이 사라지지 않도록 다시 그리기 전에 현재 값을 저장해둔다.
        const stageOverrides = {};
        const stdOverrides = {};
        (o.materials || []).forEach(m => { if (m.stage) stageOverrides[m.seq] = m.stage; });
        (o.workStandard || []).forEach((s, i) => { if (s) stdOverrides[i] = s; });
        const captureRowEdits = () => {
            modal().querySelectorAll('.swo-stage').forEach(el => { stageOverrides[el.dataset.seq] = el.value; });
            modal().querySelectorAll('.swo-std-row').forEach(el => { stdOverrides[el.dataset.i] = el.value; });
        };
        const drawMats = () => {
            captureRowEdits();
            const r = currentRecipe();
            const mats = currentMats();
            modal().querySelector('#swo-mats').innerHTML = mats.map((m, i) => {
                const item = m.itemCode ? state.master.find(x => x.code === m.itemCode) : null;
                const stageVal = stageOverrides[m.seq] ?? (m.stage || '');
                const stdVal = stdOverrides[i] ?? (r?.workStandard?.[i] || '');
                return `<tr>
                    <td class="p-2 font-mono">${esc(m.seq)}</td>
                    <td class="p-2"><input class="swo-stage w-16 bg-slate-50 border border-slate-300 rounded px-1.5 py-1" data-seq="${esc(m.seq)}" value="${esc(stageVal)}" /></td>
                    <td class="p-2 font-mono font-black ${m.rawCode ? 'text-slate-900' : 'text-rose-600'}">${esc(m.rawCode || '원료코드 없음')}</td>
                    <td class="p-2 text-amber-800">${esc(m.name)}</td>
                    <td class="p-2 text-right font-mono font-bold">${fmt(m.liters)}</td>
                    <td class="p-2 text-right font-mono">${fmt(m.kg)}</td>
                    <td class="p-2 text-right font-mono">${fmt(m.sg, 4)}</td>
                    <td class="p-2 text-[10px] ${item ? 'text-emerald-700' : 'text-slate-400'}">${item ? `${esc(item.code)} ${esc(item.name)}` : '미연결 (재고 차감 안 함)'}</td>
                    <td class="p-2"><input class="swo-std-row w-40 bg-slate-50 border border-slate-300 rounded px-1.5 py-1" data-i="${i}" value="${esc(stdVal)}" placeholder="이 단계의 작업표준" /></td>
                </tr>`;
            }).join('');
            const tl = mats.reduce((s, m) => s + (Number(m.liters) || 0), 0);
            const tk = mats.reduce((s, m) => s + (Number(m.kg) || 0), 0);
            modal().querySelector('#swo-total').textContent = `S-TOTAL ${fmt(tl)} L · ${fmt(tk)} KG`;
            const qc = (o.qcItems && (o.status === 'COMPLETED' || orphan) ? o.qcItems : r?.qcItems) || [];
            const results = o.qcResults || {};
            modal().querySelector('#swo-qc').innerHTML = qc.map(q => `
                <label class="flex items-center gap-2"><span class="w-6 text-slate-500">${esc(q.no)}</span>
                    <span class="flex-1 font-bold text-slate-700">${esc(q.item)} <span class="text-[10px] text-slate-400 font-normal">${esc(q.standard || '')}</span></span>
                    <input class="swo-qc-val w-28 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 font-mono" data-no="${esc(q.no)}" value="${esc(results[q.no] || '')}" placeholder="시험치" /></label>`).join('');
        };
        recipeSel.addEventListener('change', drawMats);
        qtyInput.addEventListener('input', drawMats);
        drawMats();

        modal().querySelectorAll('.swo-close').forEach(b => b.addEventListener('click', closeModal));
        modal().querySelector('#swo-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            // 시방서가 삭제된 지시서는 지시서에 저장된 값을 시방서 대신 쓴다 (recipeId는 비운 채로)
            const r = currentRecipe() || (orphan ? {
                id: null, productName: o.productName, revision: o.revision, productItemCode: o.productItemCode,
                baseLiters: Number(o.baseLitersPerUnit) || 0, baseQty: 1, baseUnit: o.prodUnit,
                qcItems: o.qcItems, brands: o.brands, docNo: o.docNo
            } : null);
            if (!r) { alert('제조시방서를 선택하세요.'); return; }
            const val = (id) => modal().querySelector(`#swo-${id}`)?.value.trim() ?? '';
            const orderNo = val('orderNo');
            if (secure.orders.some(x => x.orderNo === orderNo && x.id !== o.id)) { alert(`지시번호 ${orderNo}가 이미 있습니다.`); return; }
            const prodQty = Number(val('prodQty')) || 0;
            if (!(prodQty > 0)) { alert('생산량을 입력하세요.'); return; }
            const qcResults = {};
            modal().querySelectorAll('.swo-qc-val').forEach(inp => { if (inp.value.trim()) qcResults[inp.dataset.no] = inp.value.trim(); });
            // 단계·단계별 작업표준은 이 지시서에서 직접 수정한 값을 그대로 저장한다 (시방서 원본은 바뀌지 않음)
            const materials = currentMats().map((m, i) => ({
                ...m,
                stage: modal().querySelector(`.swo-stage[data-seq="${m.seq}"]`)?.value.trim() || m.stage || ''
            }));
            const workStandard = [...modal().querySelectorAll('.swo-std-row')].map(inp => inp.value.trim());
            const data = {
                ...o,
                orderNo,
                recipeId: r.id,
                productName: r.productName,
                revision: r.revision,
                productItemCode: r.productItemCode || '',
                baseLitersPerUnit: (Number(r.baseLiters) || 0) / (Number(r.baseQty) || 1),
                mfgDate: val('mfgDate'),
                prodQty,
                prodUnit: val('prodUnit') || r.baseUnit || 'D/M',
                actualQty: val('actualQty') === '' ? null : Number(val('actualQty')),
                author: val('author'),
                materials,
                workStandard,
                qcItems: o.status === 'COMPLETED' && o.qcItems ? o.qcItems : (r.qcItems || []),
                brands: o.status === 'COMPLETED' && o.brands ? o.brands : (r.brands || []),
                docNo: r.docNo || 'DLS-QP-113-1(1) 작업일지',
                qcResults,
                notes: modal().querySelector('#swo-notes').value.trim()
            };
            HEADER_FIELDS.forEach(([k]) => { data[k] = val(k); });
            RESULT_FIELDS.forEach(([k]) => { data[k] = val(k); });
            await run(() => saveSecureOrder(data), `${orderNo} 작업지시서를 ${isNew ? '발행' : '저장'}했습니다.`);
        });
    };

    // ==========================================
    // 생산 완료 처리
    // ==========================================
    const openCompleteModal = (o) => {
        const recipe = secure.recipes.find(r => r.id === o.recipeId);
        // completeSecureOrder와 같은 규칙: 시방서의 현재 연결 우선, 시방서가 없으면 지시서에 옮겨 둔 연결
        const linked = (o.materials || []).filter(m => (recipe?.materials || []).find(x => x.seq === m.seq)?.itemCode || m.itemCode).length;
        const total = (o.materials || []).length;
        const productCode = recipe?.productItemCode || o.productItemCode || '';
        const productItem = productCode ? state.master.find(m => m.code === productCode) : null;
        openModal(`
        <form id="swc-form" class="bg-white rounded-2xl shadow-xl w-full max-w-lg my-10 p-5 space-y-3 text-xs">
            <h3 class="font-black text-sm text-slate-900">생산 완료 처리 · ${esc(o.orderNo)}</h3>
            <div class="grid grid-cols-2 gap-2.5">
                <label class="block"><span class="font-bold text-slate-600">실생산량 (${esc(o.prodUnit || 'D/M')})</span>
                    <input id="swc-qty" type="number" min="0" step="any" value="${esc(o.actualQty ?? o.prodQty)}" required class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold text-right" /></label>
                <label class="block"><span class="font-bold text-slate-600">생산·입고 위치</span>
                    <select id="swc-loc" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${locationOptionsHtml(state.locations, '김포공장')}</select></label>
            </div>
            <ul class="space-y-1 text-[11px] font-bold">
                <li class="${productItem ? 'text-emerald-700' : 'text-rose-600'}">원액 품목: ${productItem ? `${esc(productItem.code)} ${esc(productItem.name)} 입고` : '미연결 — 재고·수불부에 반영하지 않고 상태만 완료로 바꿉니다'}</li>
                <li class="${linked === total ? 'text-emerald-700' : 'text-amber-700'}">원료 재고 차감: ${linked}/${total}종 연결됨${linked < total ? ' (미연결 원료는 차감하지 않음)' : ''}</li>
                <li class="text-slate-500">입출고 이력·원료수불부에는 원료 실명 대신 원료코드로 기록됩니다.</li>
            </ul>
            <div class="flex justify-end gap-2">
                <button type="button" class="swc-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button>
                <button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black">생산 완료</button>
            </div>
        </form>`);
        modal().querySelector('.swc-close').addEventListener('click', closeModal);
        modal().querySelector('#swc-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const actualQty = Number(modal().querySelector('#swc-qty').value);
            const location = modal().querySelector('#swc-loc').value;
            try {
                const r = await completeSecureOrder(o, { actualQty, location });
                showToast(r.inventoryApplied
                    ? `✅ ${o.orderNo} 생산 완료: 원액 ${fmt(r.liters)}L 입고, 원료 ${r.linkedCount}종 차감`
                    : `✅ ${o.orderNo} 생산 완료 (원액 품목 미연결로 재고 반영 없음)`);
                closeModal();
                render();
            } catch (err) {
                alert(`생산 완료 처리 실패:\n${err.message}`);
            }
        });
    };

    // ==========================================
    // QR 스캔으로 생산 완료 (작업일지 인쇄물 좌측 상단 QR)
    // ==========================================
    let scanCamera = null;
    const openScanCompleteModal = () => {
        openModal(`
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg my-10 p-5 space-y-3 text-xs">
            <div class="flex items-center justify-between">
                <h3 class="font-black text-sm text-slate-900">🔳 QR 스캔으로 생산 완료</h3>
                <button type="button" class="wsc-close text-slate-400 hover:text-slate-700 min-w-11 min-h-11 inline-flex items-center justify-center"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <p class="text-slate-500">작업일지 인쇄물 좌측 상단의 QR을 스캐너나 카메라로 읽으면 해당 작업지시서의 생산 완료 처리 화면으로 바로 연결됩니다.</p>
            <button type="button" id="wsc-camera-toggle" class="w-full px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-black flex items-center justify-center gap-1"><i data-lucide="camera" class="w-4 h-4"></i><span id="wsc-camera-btn-text">카메라로 스캔</span></button>
            <div id="wsc-camera-container" class="hidden"><div id="wsc-qr-reader"></div></div>
            <label class="block"><span class="font-bold text-slate-600">또는 QR 내용을 여기에 스캔·붙여넣기</span>
                <textarea id="wsc-manual" rows="3" autofocus placeholder="핸디 스캐너로 이 칸에 커서를 두고 QR을 읽거나, 내용을 직접 붙여넣으세요" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-mono"></textarea></label>
            <div id="wsc-result" class="text-[11px] font-bold"></div>
        </div>`);

        const resultBox = () => modal().querySelector('#wsc-result');
        const showError = (msg) => { const el = resultBox(); if (el) { el.textContent = msg; el.className = 'text-[11px] font-bold text-rose-600'; } };

        const handlePayload = (raw) => {
            const text = String(raw || '').trim();
            if (!text) return;
            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch {
                showError('QR 내용을 읽지 못했습니다. 원액생산 작업지시서 QR이 맞는지 확인하세요.');
                return;
            }
            if (parsed.type !== 'DAELIM_SECURE_WO' || !parsed.orderNo) {
                showError('원액생산 작업지시서 QR이 아닙니다.');
                return;
            }
            const order = secure.orders.find(o => o.orderNo === parsed.orderNo);
            if (!order) {
                showError(`지시번호 ${parsed.orderNo}를 찾을 수 없습니다. (목록을 새로고침해 보세요)`);
                return;
            }
            if (order.status === 'COMPLETED') { showError(`${order.orderNo}는 이미 생산 완료 처리되었습니다.`); return; }
            if (order.status === 'CANCELLED') { showError(`${order.orderNo}는 취소된 지시서입니다.`); return; }
            closeModal();
            openCompleteModal(order);
        };

        modal().querySelectorAll('.wsc-close').forEach(b => b.addEventListener('click', closeModal));
        let t = null;
        modal().querySelector('#wsc-manual').addEventListener('input', (e) => {
            clearTimeout(t);
            t = setTimeout(() => handlePayload(e.target.value), 200);
        });

        const camBtn = modal().querySelector('#wsc-camera-toggle');
        const camContainer = modal().querySelector('#wsc-camera-container');
        // Html5QrcodeScanner(고수준 위젯)는 "카메라 권한 요청"·카메라 선택·"스캔 시작" 버튼을
        // 한 번씩 더 눌러야 화면이 뜨므로, 버튼 한 번으로 바로 카메라가 켜지도록 저수준
        // Html5Qrcode API로 직접 start()한다.
        camBtn.addEventListener('click', async () => {
            if (scanCamera) {
                try { await scanCamera.stop(); } catch { /* 이미 멈춘 경우 무시 */ }
                try { scanCamera.clear(); } catch { /* noop */ }
                scanCamera = null;
                camContainer.classList.add('hidden');
                modal().querySelector('#wsc-camera-btn-text').textContent = '카메라로 스캔';
                return;
            }
            camContainer.classList.remove('hidden');
            modal().querySelector('#wsc-camera-btn-text').textContent = '카메라 스캐너 끄기';
            scanCamera = new Html5Qrcode('wsc-qr-reader');
            const onDecoded = (decodedText) => {
                const manual = modal().querySelector('#wsc-manual');
                if (manual) manual.value = decodedText;
                handlePayload(decodedText);
            };
            const startConfig = { fps: 10, qrbox: { width: 240, height: 240 } };
            try {
                await scanCamera.start({ facingMode: 'environment' }, startConfig, onDecoded, () => {});
            } catch (err) {
                try {
                    await scanCamera.start({ facingMode: 'user' }, startConfig, onDecoded, () => {});
                } catch (err2) {
                    showError(`카메라를 시작하지 못했습니다: ${err2.message || err2}`);
                    camContainer.classList.add('hidden');
                    scanCamera = null;
                    modal().querySelector('#wsc-camera-btn-text').textContent = '카메라로 스캔';
                }
            }
        });
    };

    // ==========================================
    // 작업일지 인쇄 (원료코드로만 표기, 엑셀 'DLS-QP-113-1(1) 작업일지' 양식)
    // ==========================================
    const printWorkLog = async (o) => {
        const w = window.open('', '_blank', 'width=900,height=1000');
        if (!w) { alert('팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.'); return; }
        w.document.write(await buildWorkLogHtml(o));
        w.document.close();
    };

    // QR코드에 담을 내용: 생산 제품·수량 정보와 원료 사용 정보(원료명 대신 원료코드·품목코드만).
    // 이 QR을 [작업지시서] 탭의 "QR 스캔으로 생산 완료"로 스캔하면 해당 지시서의 생산 완료 처리 화면으로 바로 연결된다.
    // 스캔 시 실제로 쓰는 값은 orderNo뿐이다(생산 완료 처리는 그 번호로 현재 저장된 지시서를
    // 다시 찾아 쓴다 — 인쇄 이후 수정됐을 수 있는 QR 속 값을 그대로 믿지 않기 위해서다).
    // 나머지 생산·원료 정보는 QR만 봐도 내용을 알 수 있도록 참고용으로 짧게 담는다.
    // QR이 너무 촘촘하면(글자 수가 많으면) 카메라 인식이 어려워지므로 키를 줄이고
    // 원료는 [품목코드, 배합량]만 담아 크기를 최대한 줄인다.
    const buildWorkOrderQrPayload = (o, recipe) => JSON.stringify({
        type: 'DAELIM_SECURE_WO',
        orderNo: o.orderNo,
        productItemCode: o.productItemCode || recipe?.productItemCode || '',
        prodQty: o.prodQty,
        prodUnit: o.prodUnit,
        mfgDate: o.mfgDate,
        lotNo: o.lotNo || '',
        materials: (o.materials || []).filter(m => m.itemCode).map(m => [m.itemCode, m.liters])
    });

    // 엑셀 작업일지 시트(A1:AI55)를 옮긴 템플릿(data/worklogTemplate.json)에 작업지시서 값을 채워 A4 한 장으로 출력
    // - 열 너비·행 높이·병합·글꼴·정렬·테두리는 엑셀과 같고, 엑셀의 '한 페이지에 맞춤'처럼 전체를 같은 비율로 줄인다
    // - 칸보다 긴 글자는 그 칸만 글씨를 줄여 칸 안에 넣는다
    // - 좌측 상단에는 생산 제품·원료 사용 정보를 담은 QR코드를 겹쳐 그린다 (제목 칸의 빈 여백 위에 얹는 방식)
    const buildWorkLogHtml = async (o) => {
        const recipe = secure.recipes.find(r => r.id === o.recipeId);
        const mats = o.materials || [];
        const std = o.workStandard || [];
        const brands = o.brands || recipe?.brands || [];
        const qcBySlot = {};
        (o.qcItems || []).forEach(q => { const k = CIRCLED.indexOf(q.no); if (k >= 0) qcBySlot[k] = q; });
        const res = o.qcResults || {};
        const numbered = (list, from) => list.map((b, i) => `${from + i}. ${b}`).join('\n');
        // 엑셀 표시 형식과 같게: L·KG '#,##0.00', SG '0.0000', 날짜 'yyyy년 m월 d일 (요일)'
        const fix = (n, d) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n)) ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
        const longDate = (dt) => `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${'일월화수목금토'[dt.getDay()]}요일)`;
        const val = (key) => {
            if (!key) return '';
            const [grp, field, idx] = key.split('.');
            if (grp === 'mat') {
                const m = mats[Number(idx)];
                if (field === 'std') return std[Number(idx)] || '';
                if (!m) return '';
                return { stage: m.stage || '', code: m.rawCode || '', l: fix(m.liters, 2), kg: fix(m.kg, 2), sg: fix(m.sg, 4) }[field] ?? '';
            }
            if (grp === 'qc') {
                const q = qcBySlot[Number(idx)];
                if (!q) return field === 'no' ? CIRCLED[Number(idx)] : '';
                return { no: q.no, item: q.item, std: q.standard || '', val: res[q.no] || '' }[field] ?? '';
            }
            const map = {
                printDate: longDate(new Date()),
                orderNo: o.orderNo,
                productName: o.productName,
                revision: o.revision,
                mfgDate: o.mfgDate,
                workInstruction: o.workInstruction,
                prodQty: o.prodQty ? `${fmt(o.prodQty)} ${o.prodUnit || ''}`.trim() : '',
                actualQty: o.actualQty ? `${fmt(o.actualQty)} ${o.prodUnit || ''}`.trim() : '',
                lotNo: o.lotNo, customer: o.customer, marking: o.marking, qualityMark: o.qualityMark, grade: o.grade, packaging: o.packaging,
                totalL: fix(mats.reduce((s, m) => s + (Number(m.liters) || 0), 0), 2),
                totalKg: fix(mats.reduce((s, m) => s + (Number(m.kg) || 0), 0), 2),
                brandLabel: brands.length ? 'ODM' : '',
                brands1: numbered(brands.slice(0, 10), 1),
                brands2: numbered(brands.slice(10), 11),
                processViscosity: o.processViscosity, stickerName: o.stickerName, volumeSg: o.volumeSg, volumeWt: o.volumeWt,
                packContainer: o.packContainer, packLeak: o.packLeak,
                verdict: o.verdict, author: o.author, confirmer: o.confirmer, worker: o.worker,
                docNo: o.docNo || 'DLS-QP-113-1(1) 작업일지',
                workStatus: o.workStatus, adjustNotes: o.adjustNotes
            };
            return map[key] ?? '';
        };

        const T = worklogTemplate;
        // 엑셀 단위 → 화면 px (열: 문자폭 × 7px, 행: pt × 4/3)
        const colPx = T.cols.map(cw => Math.round(cw * 7));
        const rowPx = T.rows.map(h => Math.round(h * 4 / 3 * 100) / 100);
        const tableW = colPx.reduce((a, b) => a + b, 0);
        const tableH = rowPx.reduce((a, b) => a + b, 0);
        // 인쇄 영역: A4 210×297mm − 여백(위 10, 좌우 7, 아래 7mm)
        const pxPerMm = 96 / 25.4;
        const availW = (210 - 7 - 7) * pxPerMm;
        const availH = (297 - 10 - 7 - 6) * pxPerMm; // 위 6mm는 대외비 띠
        const zoom = Math.min(availW / tableW, availH / tableH);

        const FONT = {
            '굴림': "'Gulim', '굴림'", '굴림체': "'GulimChe', '굴림체', 'Gulim'", '돋움': "'Dotum', '돋움'", '바탕': "'Batang', '바탕'",
            '새굴림': "'New Gulim', '새굴림', 'Gulim'", 'HY견고딕': "'HYGothic-Extra', 'HY견고딕', 'Malgun Gothic'", '휴먼모음T': "'HumanMoeumT', '휴먼모음T', 'Malgun Gothic'"
        };
        const H = { left: 'left', center: 'center', right: 'right', centerContinuous: 'center', justify: 'left', distributed: 'center', fill: 'left' };
        const V = { top: 'top', middle: 'middle', bottom: 'bottom', justify: 'middle', distributed: 'middle' };
        const NUMERIC = /^(mat\.(l|kg|sg)|total)/;

        // 단계가 바뀌는 원료 행 위에만 구분선을 긋는다 (원래 격자선은 그대로 두고 추가만 한다).
        // 실제 입력 방식: 새 단계가 시작되는 첫 원료에만 "#1"·"#2" 같은 단계 값을 적고,
        // 같은 단계의 나머지 원료는 빈 칸으로 둔다. 그래서 빈 칸은 "직전 단계가 이어짐"으로 보고,
        // 값이 적힌 원료를 만날 때만 그 값이 바로 앞의 실제 단계 값과 다를 때 경계로 본다
        // (원료가 모두 1단계뿐이거나 단계를 하나도 안 적었으면 선이 전혀 없음).
        // mat.<field>.<idx> 칸이 있는 엑셀 행 번호를 원료 순서(idx)별로 찾아둔다 (원료 1개 = 행 1개).
        const matRowOf = {};
        T.cells.forEach(c => { const mm = /^mat\.\w+\.(\d+)$/.exec(c.k || ''); if (mm) matRowOf[Number(mm[1])] = c.r; });
        const stageBreakRows = new Set();
        let currentStage = String(mats[0]?.stage || '').trim();
        mats.forEach((m, i) => {
            if (i === 0) return;
            const stageVal = String(m.stage || '').trim();
            if (!stageVal) return; // 빈 칸: 직전 단계가 계속됨, 선 없음
            if (stageVal !== currentStage) {
                const row = matRowOf[i];
                if (row !== undefined) stageBreakRows.add(row);
            }
            currentStage = stageVal;
        });

        const body = [];
        const byRow = new Map();
        T.cells.forEach(c => { if (!byRow.has(c.r)) byRow.set(c.r, []); byRow.get(c.r).push(c); });
        for (let r = 1; r <= T.rows.length; r++) {
            const stageBreak = stageBreakRows.has(r);
            const tds = (byRow.get(r) || []).map(c => {
                const s = c.s || {};
                const value = c.k ? val(c.k) : '';
                const text = [c.label || c.t || '', value].filter(x => x !== '' && x !== undefined && x !== null).join(c.label || (c.t && value) ? ' ' : '');
                const multiline = s.w || c.k === 'workStatus' || c.k === 'adjustNotes' || /^brands/.test(c.k || '');
                // 자유 기록 칸(작업현황·Adjust)은 왼쪽 위부터 쓴다
                const memo = c.k === 'workStatus' || c.k === 'adjustNotes';
                const hAlign = memo ? 'left' : (H[s.h] || (NUMERIC.test(c.k || '') ? 'right' : 'left'));
                const vAlign = memo ? 'top' : (V[s.v] || (multiline ? 'top' : 'bottom'));
                const style = [
                    s.fs ? `font-size:${s.fs}pt` : 'font-size:11pt',
                    s.b && !memo ? 'font-weight:bold' : '',
                    `font-family:${FONT[s.ff] || "'Gulim'"}, 'Malgun Gothic', sans-serif`,
                    `text-align:${hAlign}`,
                    `vertical-align:${vAlign}`,
                    stageBreak ? 'border-top:1.5pt solid #000' : (s.bt ? `border-top:${s.bt} #000` : ''), s.br ? `border-right:${s.br} #000` : '',
                    s.bb ? `border-bottom:${s.bb} #000` : '', s.bl ? `border-left:${s.bl} #000` : '',
                    s.bg ? `background:${s.bg}` : ''
                ].filter(Boolean).join(';');
                const span = `${c.cs ? ` colspan="${c.cs}"` : ''}${c.rs ? ` rowspan="${c.rs}"` : ''}`;
                // 칸 크기를 엑셀 행 높이로 고정 (글이 길어도 행이 늘어나지 않고 글씨가 줄어든다)
                const boxH = rowPx.slice(r - 1, r - 1 + (c.rs || 1)).reduce((a, b) => a + b, 0) - 1;
                const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[vAlign];
                return `<td${span} style="${style}"><div class="in" style="height:${Math.max(boxH, 1)}px;justify-content:${justify}"><span class="tx${multiline ? ' ml' : ''}">${esc(text)}</span></div></td>`;
            }).join('');
            body.push(`<tr style="height:${rowPx[r - 1]}px">${tds}</tr>`);
        }

        // 좌측 상단 QR: 생산 제품 정보·원료 사용 정보(원료명 제외, 원료코드만)를 담아
        // [작업지시서] 탭의 "QR 스캔으로 생산 완료"에서 스캔하면 이 지시서의 생산 완료 처리로 바로 연결된다.
        // margin(여백)을 0으로 두면 QR 둘레의 흰 여백(quiet zone)이 사라져 카메라 인식 라이브러리가
        // 코드를 아예 못 찾는 경우가 많다(폰 기본 카메라 앱은 더 관대해서 여백이 없어도 읽히곤 한다).
        // 표준대로 여백을 넉넉히 주고, 오류정정 수준을 낮춰(L) 같은 내용도 칸 수를 줄여 더 크고
        // 성기게 찍히게 한다.
        const qrUrl = await qrDataUrl(buildWorkOrderQrPayload(o, recipe), { width: 200, ecc: 'L' }); // 흰 여백 4칸 + 테두리선 (앱 공통)

        return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>작업일지 ${esc(o.orderNo)}</title>
        <style>
            @page { size: A4 portrait; margin: 10mm 7mm 7mm 7mm; }
            * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            html, body { margin: 0; padding: 0; background: #e5e7eb; }
            .sheet { width: ${Math.floor(availW)}px; margin: 8mm auto; background: #fff; box-shadow: 0 0 4mm rgba(0,0,0,.2); }
            .scale { zoom: ${zoom.toFixed(4)}; margin: 0 auto; width: ${tableW}px; position: relative; }
            .wo-qr { position: absolute; top: 2px; left: 2px; width: 72px; height: 72px; z-index: 5; }
            @media print { html, body { background: #fff; } .sheet { margin: 0 auto; box-shadow: none; } }
            table { border-collapse: collapse; table-layout: fixed; width: ${tableW}px; color: #000; }
            td { padding: 0; overflow: hidden; }
            .in { display: flex; flex-direction: column; overflow: hidden; padding: 0 2px; }
            .tx { white-space: pre; line-height: 1.15; }
            .tx.ml { white-space: pre-wrap; word-break: keep-all; overflow-wrap: anywhere; }
            ${CONFIDENTIAL_CSS}
            .conf-bar { height: 6mm; display: flex; align-items: center; justify-content: space-between; color: #c81e1e; font: 900 9pt 'Malgun Gothic', sans-serif; padding: 0 1mm; }
            .conf-bar b { border: 0.5mm solid #c81e1e; padding: 0 2.5mm; letter-spacing: 3px; }
        </style></head><body><div class="conf-wm">대 외 비<small>CONFIDENTIAL</small></div><div class="sheet">
        <div class="conf-bar"><b>대 외 비</b><span>원액생산 작업지시서 · 무단 복제·반출 금지</span></div><div class="scale">
        <img class="wo-qr" src="${qrUrl}" alt="QR" />
        <table><colgroup>${colPx.map(px => `<col style="width:${px}px">`).join('')}</colgroup>${body.join('')}</table>
        </div></div>
        <script>
            // 칸보다 긴 글자는 그 칸의 글씨만 줄여서 칸 안에 넣는다
            const fit = () => {
                document.querySelectorAll('td .tx').forEach(tx => {
                    if (!tx.textContent) return;
                    const box = tx.parentElement;
                    const td = box.parentElement;
                    const cs = getComputedStyle(box);
                    const maxW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
                    const maxH = box.clientHeight;
                    let size = parseFloat(getComputedStyle(td).fontSize);
                    const tooBig = () => tx.scrollWidth > maxW + 0.5 || tx.offsetHeight > maxH + 0.5;
                    // 좁고 높은 칸(예: 세로 결재란 '품 질')은 글씨를 줄이기 전에 줄바꿈부터 한다
                    if (tooBig() && !tx.classList.contains('ml') && /\\s/.test(tx.textContent.trim()) && maxH >= size * 2.4 && maxW < size * 3) {
                        tx.classList.add('ml');
                    }
                    let guard = 50;
                    while (tooBig() && size > 4 && guard--) { size *= 0.93; td.style.fontSize = size + 'px'; }
                });
            };
            const W = ${availW.toFixed(2)}, Hh = ${availH.toFixed(2)};
            const scale = document.querySelector('.scale');
            const table = scale.querySelector('table');
            // 1) 높이를 인쇄 영역에 맞추고 2) 남는 가로 폭만큼 열 너비를 같은 비율로 넓혀 좌우 여백을 없앤다
            const fitPage = () => {
                scale.style.zoom = 1;
                const z = Hh / table.offsetHeight * 0.995;
                scale.style.zoom = z.toFixed(4);
                const k = (W * 0.995) / table.getBoundingClientRect().width;
                if (k > 1) {
                    let sum = 0;
                    table.querySelectorAll('col').forEach(col => {
                        const w = Math.floor(parseFloat(col.style.width) * k * 100) / 100;
                        col.style.width = w + 'px';
                        sum += w;
                    });
                    // 표 너비 = 열 너비 합계 (더 크게 주면 브라우저가 남는 폭을 열에 나눠 표가 넘친다)
                    table.style.width = sum + 'px';
                    scale.style.width = sum + 'px';
                }
            };
            // 픽셀 반올림 등으로 인쇄 영역을 넘으면 배율을 조금씩 줄인다
            const clampPage = () => {
                let z = parseFloat(scale.style.zoom) || 1;
                for (let i = 0; i < 6; i++) {
                    const r = table.getBoundingClientRect();
                    const over = Math.max(r.width / W, r.height / Hh);
                    if (over <= 0.998) break;
                    z = z / over * 0.995;
                    scale.style.zoom = z.toFixed(4);
                }
            };
            window.onload = () => { fitPage(); fit(); clampPage(); if (!window.__noPrint) { window.focus(); window.print(); } };
        <\/script>
        </body></html>`;
    };

    // ==========================================
    // 제조시방서 목록·가져오기·편집
    // ==========================================
    // 분류·종류 목록: 기본 분류 + 시방서에 입력된 값
    const recipeCategories = () => {
        const out = [...DEFAULT_RECIPE_CATEGORIES];
        secure.recipes.forEach(r => { if (r.category && !out.includes(r.category)) out.push(r.category); });
        return out;
    };
    const recipeSubCategories = (cat) => [...new Set(secure.recipes
        .filter(r => r.subCategory && (!cat || r.category === cat)).map(r => r.subCategory))].sort((a, b) => a.localeCompare(b, 'ko'));
    const catKey = (r) => r.category || UNCATEGORIZED;
    const subKey = (r) => r.subCategory || '';

    // 제품(제품명)별 최신 리비전. 목록 기본 화면은 최신만, 나머지는 구버전 보관함에서 본다.
    // 구버전 보관함으로 직접 옮긴 리비전(archived)은 최신 후보에서 뺀다
    const latestByProduct = () => {
        const m = new Map();
        secure.recipes.forEach(r => {
            if (r.archived) return;
            const cur = m.get(productKey(r));
            if (!cur || cmpRev(r, cur) > 0) m.set(productKey(r), r);
        });
        return m;
    };
    const isLatestRecipe = (r, latest = latestByProduct()) => latest.get(productKey(r))?.id === r.id;
    const olderVersionsOf = (r) => secure.recipes.filter(x => productKey(x) === productKey(r) && x.id !== r.id);
    const viewRecipes = () => {
        const latest = latestByProduct();
        return secure.recipes.filter(r => (recipeFilter.view === 'archive') !== isLatestRecipe(r, latest));
    };

    const filteredRecipes = () => {
        const cats = recipeCategories();
        const catOrder = (c) => (c === UNCATEGORIZED ? 9999 : cats.indexOf(c));
        return viewRecipes()
            .filter(r => !recipeFilter.cat || catKey(r) === recipeFilter.cat)
            .filter(r => !recipeFilter.sub || subKey(r) === recipeFilter.sub)
            .filter(r => !recipeFilter.q || matchesQuery(r, recipeFilter.q, ['productName']))
            .sort((a, b) => catOrder(catKey(a)) - catOrder(catKey(b))
                || subKey(a).localeCompare(subKey(b), 'ko')
                || a.productName.localeCompare(b.productName, 'ko')
                || cmpRev(b, a));
    };

    // 리비전 칸: 최신 화면은 구버전 개수(누르면 보관함)와 '구버전이 사용 중' 경고, 보관함은 최신 리비전 안내
    const revCell = (r) => {
        const olds = olderVersionsOf(r);
        const rev = `<span class="font-mono">${esc(r.revision || '-')}</span>`;
        if (recipeFilter.view === 'archive') {
            const latest = latestByProduct().get(productKey(r));
            return `${rev}${r.archived ? ' <span class="ml-1 px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-bold" title="목록에서 직접 구버전으로 옮긴 리비전">옮김</span>' : ''}<div class="text-[10px] text-slate-400">최신: ${esc(latest?.revision || '(없음)')}</div>`;
        }
        const activeOld = olds.filter(x => x.active);
        const warn = !r.active && activeOld.length
            ? `<div class="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-bold text-rose-700">⚠ 구버전 ${activeOld.map(x => esc(x.revision || '(Rev 없음)')).join(', ')} 사용 중
                <button type="button" class="sr-promote px-1.5 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded" data-id="${esc(r.id)}">최신으로 전환</button></div>`
            : '';
        const oldBtn = olds.length
            ? ` <button type="button" class="sr-olds ml-1 px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold" data-name="${esc(productKey(r))}" title="구버전 보관함에서 보기">구버전 ${olds.length}</button>`
            : '';
        return `${rev}${oldBtn}${warn}`;
    };

    // 시방서 표 본문 (검색 입력 중에도 입력창을 다시 그리지 않도록 표만 갱신)
    // openMatches: 분류·종류를 고르거나 검색했을 때 결과 묶음을 펼친다
    const renderRecipeRows = ({ openMatches = false } = {}) => {
        const list = filteredRecipes();
        const groupKeys = [...new Set(list.map(catKey))];
        if (openMatches) recipeGroups.openKeys(groupKeys);
        recipeGroups.setKeys(groupKeys);
        const visibleList = list.filter(r => recipeGroups.isOpen(catKey(r))); // 펼친 묶음의 시방서만 (전체 선택 대상)
        $('#sr-count').textContent = `${list.length} / ${viewRecipes().length}건`;
        let lastCat = null;
        let lastSub = null;
        const rows = list.map(r => {
            const isGroupOpen = recipeGroups.isOpen(catKey(r));
            let head = '';
            if (catKey(r) !== lastCat) {
                const n = list.filter(x => catKey(x) === catKey(r)).length;
                head += groupHeadRow(catKey(r), n, isGroupOpen, 9);
                lastCat = catKey(r);
                lastSub = null;
            }
            if (!isGroupOpen) return head; // 접힌 묶음은 머리줄만
            if (subKey(r) !== lastSub && r.subCategory) {
                const n = list.filter(x => catKey(x) === catKey(r) && subKey(x) === subKey(r)).length;
                head += `<tr class="bg-slate-50"><td colspan="9" class="pl-7 pr-2.5 py-1 font-bold text-slate-600">└ ${esc(r.subCategory)} <span class="text-slate-400">(${n})</span></td></tr>`;
            }
            lastSub = subKey(r);
            const linked = r.materials.filter(m => m.itemCode).length;
            return `${head}<tr class="hover:bg-slate-50 ${r.active ? '' : 'opacity-50'}">
                <td class="p-2.5 text-center"><input type="checkbox" class="sr-check w-4 h-4" data-id="${esc(r.id)}" ${recipeSelected.has(r.id) ? 'checked' : ''} /></td>
                <td class="p-2.5 whitespace-nowrap">${r.category ? `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">${esc(r.category)}</span>` : '<span class="text-slate-300">미분류</span>'}${r.subCategory ? ` <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">${esc(r.subCategory)}</span>` : ''}</td>
                <td class="p-2.5 font-black text-slate-900">${esc(r.productName)}</td>
                <td class="p-2.5">${revCell(r)}</td>
                <td class="p-2.5 text-right font-mono whitespace-nowrap">${fmt(r.baseQty)} ${esc(r.baseUnit)} = ${fmt(r.baseLiters)} L</td>
                <td class="p-2.5 text-center">${r.materials.length}종</td>
                <td class="p-2.5 text-center text-[11px] font-bold ${linked === r.materials.length && r.productItemCode ? 'text-emerald-700' : 'text-amber-700'}">원료 ${linked}/${r.materials.length}${r.productItemCode ? ' · 원액 ✔' : ' · 원액 ✖'}</td>
                <td class="p-2.5 text-center">${r.active ? '<span class="text-emerald-700 font-bold">사용</span>' : '<span class="text-slate-400 font-bold">중지</span>'}</td>
                <td class="p-2.5 text-center whitespace-nowrap">
                    <button type="button" class="sr-edit p-1 text-slate-500 hover:text-blue-600 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(r.id)}" title="보기·분류·원료코드·재고 연결"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                    <button type="button" class="sr-history p-1 text-slate-500 hover:text-indigo-600 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(r.id)}" title="개정이력·되돌리기"><i data-lucide="history" class="w-4 h-4"></i></button>
                    <button type="button" class="sr-print p-1 text-slate-500 hover:text-slate-900 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(r.id)}" title="제조시방서 인쇄 (대외비)"><i data-lucide="printer" class="w-4 h-4"></i></button>
                    <button type="button" class="sr-toggle p-1 text-slate-500 hover:text-amber-600 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(r.id)}" title="${r.active ? '사용 중지' : '다시 사용'}"><i data-lucide="${r.active ? 'pause-circle' : 'play-circle'}" class="w-4 h-4"></i></button>
                    <button type="button" class="sr-del p-1 text-slate-400 hover:text-rose-600 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(r.id)}" title="삭제"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </td>
            </tr>`;
        }).join('');
        const tbody = $('#sr-rows');
        tbody.innerHTML = secure.recipes.length === 0
            ? '<tr><td colspan="9" class="p-8 text-center text-slate-400 font-bold">등록된 제조시방서가 없습니다.</td></tr>'
            : (rows || `<tr><td colspan="9" class="p-8 text-center text-slate-400 font-bold">${recipeFilter.view === 'archive' && viewRecipes().length === 0 ? '보관된 구버전이 없습니다.' : '조건에 맞는 제조시방서가 없습니다.'}</td></tr>`);
        $('#sr-check-all').checked = visibleList.length > 0 && visibleList.every(r => recipeSelected.has(r.id));
        updateBulkBar();

        const byId = (id) => secure.recipes.find(r => r.id === id);
        tbody.querySelectorAll('.sw-group-head').forEach(row => row.addEventListener('click', () => {
            recipeGroups.toggle(row.dataset.group);
            renderRecipeRows();
        }));
        tbody.querySelectorAll('.sr-check').forEach(c => c.addEventListener('change', () => {
            if (c.checked) recipeSelected.add(c.dataset.id); else recipeSelected.delete(c.dataset.id);
            $('#sr-check-all').checked = visibleList.length > 0 && visibleList.every(r => recipeSelected.has(r.id));
            updateBulkBar();
        }));
        tbody.querySelectorAll('.sr-olds').forEach(b => b.addEventListener('click', () => {
            recipeFilter.view = 'archive';
            recipeFilter.q = b.dataset.name;
            recipeFilter.cat = '';
            recipeFilter.sub = '';
            renderRecipes();
            createIcons({ icons });
        }));
        tbody.querySelectorAll('.sr-promote').forEach(b => b.addEventListener('click', async () => {
            const r = byId(b.dataset.id);
            const olds = olderVersionsOf(r).filter(x => x.active);
            if (!confirm(`${r.productName}의 최신 리비전 ${r.revision || ''}을(를) 사용하고, 구버전 ${olds.map(x => x.revision || '(Rev 없음)').join(', ')}은(는) 사용 중지할까요?`)) return;
            await run(async () => {
                await saveRecipe({ ...r, active: true }, '최신 리비전으로 전환');
                for (const x of olds) await saveRecipe({ ...x, active: false }, '최신 리비전으로 전환 (구버전 사용 중지)');
            }, `${r.productName}을(를) 최신 리비전 ${r.revision || ''}으로 전환했습니다.`);
        }));
        tbody.querySelectorAll('.sr-edit').forEach(b => b.addEventListener('click', () => openRecipeEditor(byId(b.dataset.id))));
        tbody.querySelectorAll('.sr-history').forEach(b => b.addEventListener('click', () => openRecipeHistory(byId(b.dataset.id))));
        tbody.querySelectorAll('.sr-print').forEach(b => b.addEventListener('click', () => printRecipe(byId(b.dataset.id))));
        tbody.querySelectorAll('.sr-toggle').forEach(b => b.addEventListener('click', async () => {
            const r = byId(b.dataset.id);
            await run(() => saveRecipe({ ...r, active: !r.active }), `${r.productName} 시방서를 ${r.active ? '사용 중지' : '다시 사용'}했습니다.`);
        }));
        tbody.querySelectorAll('.sr-del').forEach(b => b.addEventListener('click', async () => {
            const r = byId(b.dataset.id);
            const nOrders = secure.orders.filter(o => o.recipeId === r.id).length;
            if (!confirm(`${r.productName} ${r.revision || ''} 시방서를 삭제하시겠습니까? 되돌릴 수 없습니다.${nOrders ? `\n\n이 시방서로 발행한 작업지시서 ${nOrders}건은 지우지 않고, 시방서의 원액 품목·원료 재고 연결을 지시서에 옮겨 둡니다.` : ''}\n생산입고 배합비는 그대로 둡니다.`)) return;
            recipeSelected.delete(r.id);
            let res = null;
            await run(async () => { res = await deleteRecipesKeepOrders([r.id]); }, `시방서를 삭제했습니다.${nOrders ? ` (작업지시서 ${nOrders}건은 유지)` : ''}`);
            if (res?.activated?.length) alert(`사용 중이던 리비전을 지워, 남은 리비전 중 최신을 사용으로 바꿨습니다:\n- ${res.activated.join('\n- ')}`);
        }));
        createIcons({ icons });
    };

    const updateBulkBar = () => {
        const n = [...recipeSelected].filter(id => secure.recipes.some(r => r.id === id)).length;
        $('#sr-bulk').classList.toggle('hidden', n === 0);
        $('#sr-bulk-count').textContent = `${n}건 선택`;
    };

    // 분류·종류 필터 <option> (items: category/subCategory를 가진 시방서 또는 작업지시서 보기 객체)
    const catOptionsFor = (items, filter) => {
        const used = new Set(items.map(catKey));
        const cats = [...recipeCategories().filter(c => used.has(c)), ...(used.has(UNCATEGORIZED) ? [UNCATEGORIZED] : [])];
        return `<option value="">전체 분류</option>${cats.map(c => `<option value="${esc(c)}" ${c === filter.cat ? 'selected' : ''}>${esc(c)} (${items.filter(r => catKey(r) === c).length})</option>`).join('')}`;
    };
    const subOptionsFor = (items, filter) => {
        const subs = [...new Set(items.filter(r => r.subCategory && (!filter.cat || catKey(r) === filter.cat)).map(subKey))]
            .sort((a, b) => a.localeCompare(b, 'ko'));
        if (filter.sub && !subs.includes(filter.sub)) filter.sub = '';
        return `<option value="">전체 종류</option>${subs.map(s => `<option value="${esc(s)}" ${s === filter.sub ? 'selected' : ''}>${esc(s)}</option>`).join('')}`;
    };
    const catFilterOptions = () => catOptionsFor(viewRecipes(), recipeFilter);
    const subFilterOptions = () => subOptionsFor(viewRecipes(), recipeFilter);
    const catDatalist = () => recipeCategories().map(c => `<option value="${esc(c)}"></option>`).join('');
    const subDatalist = (cat) => recipeSubCategories(cat).map(s => `<option value="${esc(s)}"></option>`).join('');

    const renderRecipes = () => {
        $('#sw-body').innerHTML = `
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 text-xs">
            <div class="flex flex-wrap items-center gap-2">
                <label class="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black flex items-center gap-1 cursor-pointer">
                    <i data-lucide="file-up" class="w-4 h-4"></i>제조시방서 엑셀 가져오기
                    <input type="file" id="sw-import" accept=".xlsx,.xls,.xlsm" class="hidden" />
                </label>
                <label class="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl font-black flex items-center gap-1 cursor-pointer">
                    <i data-lucide="folder-up" class="w-4 h-4"></i>폴더 전체 가져오기
                    <input type="file" id="sw-import-folder" webkitdirectory directory multiple class="hidden" />
                </label>
                <button type="button" id="sw-link-manager" class="px-3 py-2 bg-white border border-emerald-400 hover:bg-emerald-50 text-emerald-800 rounded-xl font-black flex items-center gap-1"><i data-lucide="link" class="w-4 h-4"></i>재고 연결 일괄 정리</button>
                <span class="text-slate-500">'제조시방서' + '작업일지' 시트가 있는 엑셀(DLS-QP-113-1 양식)을 고르면 원료·원료코드·검사항목을 읽어 등록합니다. 폴더를 고르면 하위 폴더까지 모두 읽어 한 번에 등록합니다(분류 = 폴더 이름, 종류 = 하위 폴더 이름, 내용이 같은 파일·이미 등록된 시방서는 건너뜀).</span>
            </div>
            <div class="flex flex-wrap items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                <div class="flex bg-slate-200/70 p-0.5 rounded-lg font-bold">
                    <button type="button" class="sr-view px-3 py-1.5 rounded-md ${recipeFilter.view !== 'archive' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}" data-view="latest">최신 버전 (${latestByProduct().size})</button>
                    <button type="button" class="sr-view px-3 py-1.5 rounded-md flex items-center gap-1 ${recipeFilter.view === 'archive' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}" data-view="archive"><i data-lucide="archive" class="w-3.5 h-3.5"></i>구버전 보관함 (${secure.recipes.length - latestByProduct().size})</button>
                </div>
                <div class="relative flex-1 min-w-[200px]">
                    <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"></i>
                    <input type="search" id="sr-search" value="${esc(recipeFilter.q)}" placeholder="제품명 일부 입력 (예: 5w30, 코팅)" autocomplete="off" class="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-2 py-1.5 font-bold" />
                </div>
                <select id="sr-filter-cat" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${catFilterOptions()}</select>
                <select id="sr-filter-sub" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${subFilterOptions()}</select>
                <span id="sr-count" class="text-slate-500 font-bold"></span>
                <div id="sr-group-collapse" class="ml-auto"></div>
            </div>
            ${recipeFilter.view === 'archive' ? `<div class="p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 font-bold flex items-center gap-1.5"><i data-lucide="archive" class="w-4 h-4"></i>제품마다 최신 리비전을 뺀 이전 리비전을 보관합니다. 보기·인쇄·개정이력 확인·삭제를 할 수 있으며, 분류는 최신 버전에서 지정하면 함께 바뀝니다.</div>` : ''}
            <div id="sr-bulk" class="hidden flex flex-wrap items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                <span id="sr-bulk-count" class="font-black text-amber-900"></span>
                <input id="sr-bulk-cat" list="sr-bulk-cat-list" placeholder="분류 (예: 엔진오일)" class="w-40 bg-white border border-amber-300 rounded-lg px-2 py-1.5 font-bold" />
                <datalist id="sr-bulk-cat-list">${catDatalist()}</datalist>
                <input id="sr-bulk-sub" list="sr-bulk-sub-list" placeholder="종류 (선택)" class="w-40 bg-white border border-amber-300 rounded-lg px-2 py-1.5 font-bold" />
                <datalist id="sr-bulk-sub-list">${subDatalist('')}</datalist>
                <button type="button" id="sr-bulk-apply" class="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-black">선택한 시방서에 분류 지정</button>
                <button type="button" id="sr-bulk-clear" class="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-bold">선택 해제</button>
                ${recipeFilter.view === 'archive'
                    ? '<button type="button" id="sr-bulk-restore" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-black flex items-center gap-1"><i data-lucide="undo-2" class="w-3.5 h-3.5"></i>최신으로 되돌리기</button>'
                    : '<button type="button" id="sr-bulk-archive" class="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg font-black flex items-center gap-1"><i data-lucide="archive" class="w-3.5 h-3.5"></i>구버전으로 옮기기</button>'}
                <button type="button" id="sr-bulk-del" class="ml-auto px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-black flex items-center gap-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>선택 삭제</button>
            </div>
            <div class="overflow-auto border border-slate-200 rounded-xl max-h-[65vh]">
                <table class="w-full">
                    <thead class="bg-slate-50 text-slate-600 font-bold sticky top-0 z-10"><tr>
                        <th class="p-2.5 w-8 text-center"><input type="checkbox" id="sr-check-all" class="w-4 h-4" title="보이는 시방서 전체 선택" /></th>
                        <th class="p-2.5 text-left whitespace-nowrap">분류 / 종류</th><th class="p-2.5 text-left">제품명</th><th class="p-2.5 text-left">관련근거 (Rev)</th><th class="p-2.5 text-right whitespace-nowrap">기준 생산량</th>
                        <th class="p-2.5 text-center">원료</th><th class="p-2.5 text-center whitespace-nowrap">재고 연결</th><th class="p-2.5 text-center">상태</th><th class="p-2.5 text-center">관리</th>
                    </tr></thead>
                    <tbody id="sr-rows" class="divide-y divide-slate-100"></tbody>
                </table>
            </div>
        </div>`;
        $('#sw-import').addEventListener('change', onImportFile);
        $('#sw-import-folder').addEventListener('change', onImportFolder);
        $('#sw-link-manager').addEventListener('click', () => openLinkManager());
        container.querySelectorAll('.sr-view').forEach(b => b.addEventListener('click', () => {
            if (recipeFilter.view === b.dataset.view) return;
            recipeFilter.view = b.dataset.view;
            recipeFilter.cat = '';
            recipeFilter.sub = '';
            recipeSelected.clear();
            renderRecipes();
            createIcons({ icons });
        }));
        const recipeGroupHost = $('#sr-group-collapse');
        recipeGroupHost.innerHTML = recipeGroups.controlsHtml();
        recipeGroups.mount(recipeGroupHost);
        // 분류·종류를 고르거나 검색하면 결과 묶음을 펼친다
        $('#sr-search').addEventListener('input', (e) => { recipeFilter.q = e.target.value; renderRecipeRows({ openMatches: !!recipeFilter.q.trim() }); });
        $('#sr-filter-cat').addEventListener('change', (e) => {
            recipeFilter.cat = e.target.value;
            $('#sr-filter-sub').innerHTML = subFilterOptions();
            renderRecipeRows({ openMatches: true });
        });
        $('#sr-filter-sub').addEventListener('change', (e) => { recipeFilter.sub = e.target.value; renderRecipeRows({ openMatches: true }); });
        $('#sr-check-all').addEventListener('change', (e) => {
            // 펼친 묶음의 시방서만 고른다 (접혀 안 보이는 시방서를 모르고 지우거나 옮기지 않게)
            filteredRecipes().filter(r => recipeGroups.isOpen(catKey(r)))
                .forEach(r => { if (e.target.checked) recipeSelected.add(r.id); else recipeSelected.delete(r.id); });
            renderRecipeRows();
        });
        $('#sr-bulk-cat').addEventListener('input', (e) => { $('#sr-bulk-sub-list').innerHTML = subDatalist(e.target.value.trim()); });
        $('#sr-bulk-clear').addEventListener('click', () => { recipeSelected.clear(); renderRecipeRows(); });
        $('#sr-bulk-apply').addEventListener('click', async () => {
            const targets = secure.recipes.filter(r => recipeSelected.has(r.id));
            const category = $('#sr-bulk-cat').value.trim();
            const subCategory = $('#sr-bulk-sub').value.trim();
            if (targets.length === 0) return;
            if (!category && subCategory) { alert('종류를 지정하려면 분류도 입력하세요.'); return; }
            const what = category ? `분류 '${category}'${subCategory ? ` / 종류 '${subCategory}'` : ''}` : '분류 없음(미분류)';
            if (!confirm(`선택한 시방서 ${targets.length}건을 ${what}(으)로 지정할까요?`)) return;
            // 같은 제품의 다른 리비전(구버전 포함)도 같은 분류로 맞춘다
            const names = new Set(targets.map(productKey));
            const all = secure.recipes.filter(r => names.has(productKey(r)) && (r.category !== category || r.subCategory !== subCategory));
            await run(async () => {
                for (const r of all) await saveRecipe({ ...r, category, subCategory }, `분류 변경: ${what}`);
                recipeSelected.clear();
            }, `시방서 ${targets.length}건을 ${what}(으)로 지정했습니다.`);
        });
        // 선택한 최신 리비전을 구버전 보관함으로 옮긴다. 그 제품에 사용 중인 리비전이 없어지면 다음 최신 리비전을 사용으로 바꾼다.
        $('#sr-bulk-archive')?.addEventListener('click', async () => {
            const targets = secure.recipes.filter(r => recipeSelected.has(r.id));
            if (targets.length === 0) return;
            const ids = new Set(targets.map(r => r.id));
            const plan = targets.map(r => {
                const next = secure.recipes.filter(x => productKey(x) === productKey(r) && !x.archived && !ids.has(x.id)).sort((a, b) => cmpRev(b, a))[0] || null;
                return { r, next };
            });
            const lines = plan.map(({ r, next }) => `- ${r.productName} ${r.revision || ''} → 보관함${next ? ` (목록에는 ${next.revision || '(Rev 없음)'}이 최신으로 표시)` : ' (남는 리비전 없음: 목록에서 사라짐)'}`);
            if (!confirm(`선택한 제조시방서 ${targets.length}건을 구버전 보관함으로 옮길까요? 옮긴 시방서는 사용 중지됩니다.\n[최신으로 되돌리기]로 다시 꺼낼 수 있습니다.\n\n${lines.join('\n')}`)) return;
            await run(async () => {
                for (const { r } of plan) await saveRecipe({ ...r, archived: true, active: false }, '구버전 보관함으로 옮김');
                const done = new Set();
                for (const { r, next } of plan) {
                    if (!next || done.has(productKey(r))) continue;
                    done.add(productKey(r));
                    const cur = secure.recipes.find(x => x.id === next.id);
                    const anyActive = secure.recipes.some(x => productKey(x) === productKey(r) && !x.archived && x.active);
                    if (cur && !anyActive) await saveRecipe({ ...cur, active: true }, '최신 리비전 사용 (위 리비전을 보관함으로 옮김)');
                }
                recipeSelected.clear();
            }, `제조시방서 ${targets.length}건을 구버전 보관함으로 옮겼습니다.`);
        });
        // 보관함에서 고른 리비전을 최신으로 되돌린다: 그 리비전을 사용하고, 더 새 리비전은 보관함으로, 다른 리비전은 사용 중지
        $('#sr-bulk-restore')?.addEventListener('click', async () => {
            const selected = secure.recipes.filter(r => recipeSelected.has(r.id));
            if (selected.length === 0) return;
            const byProduct = new Map();
            selected.forEach(r => { const cur = byProduct.get(productKey(r)); if (!cur || cmpRev(r, cur) > 0) byProduct.set(productKey(r), r); });
            const picks = [...byProduct.values()];
            const plan = picks.map(r => {
                const others = secure.recipes.filter(x => productKey(x) === productKey(r) && x.id !== r.id);
                return { r, newer: others.filter(x => !x.archived && cmpRev(x, r) > 0), stop: others.filter(x => x.active) };
            });
            const skipped = selected.length - picks.length;
            const lines = plan.map(({ r, newer }) => `- ${r.productName} ${r.revision || ''} → 최신 (사용)${newer.length ? ` / 더 새 리비전 ${newer.map(x => x.revision || '(Rev 없음)').join(', ')}은 보관함으로` : ''}`);
            if (!confirm(`선택한 리비전을 최신 목록으로 되돌릴까요?\n\n${lines.join('\n')}${skipped ? `\n\n※ 같은 제품을 여러 개 고른 경우 가장 새 리비전 하나만 되돌립니다 (${skipped}건 제외).` : ''}`)) return;
            await run(async () => {
                for (const { r, newer, stop } of plan) {
                    for (const x of newer) await saveRecipe({ ...x, archived: true, active: false }, `구버전 보관함으로 옮김 (${r.revision || ''}으로 되돌리기)`);
                    for (const x of stop.filter(s => !newer.includes(s))) await saveRecipe({ ...x, active: false }, `사용 중지 (${r.revision || ''}으로 되돌리기)`);
                    await saveRecipe({ ...r, archived: false, active: true }, '최신 목록으로 되돌리기');
                }
                recipeSelected.clear();
            }, `제조시방서 ${picks.length}건을 최신 목록으로 되돌렸습니다.`);
        });
        $('#sr-bulk-del').addEventListener('click', async () => {
            const targets = secure.recipes.filter(r => recipeSelected.has(r.id));
            if (targets.length === 0) return;
            // 시방서만 지운다: 작업지시서는 남기고(연결 정보를 지시서로 옮김), 생산입고 배합비는 건드리지 않는다
            const ids = new Set(targets.map(r => r.id));
            const nOrders = secure.orders.filter(o => ids.has(o.recipeId)).length;
            const listText = targets.slice(0, 20).map(r => `- ${r.productName} ${r.revision || ''}`).join('\n') + (targets.length > 20 ? `\n… 외 ${targets.length - 20}건` : '');
            if (!confirm(`선택한 제조시방서 ${targets.length}건을 삭제하시겠습니까? 되돌릴 수 없습니다(필요하면 먼저 [백업]).\n\n${listText}\n\n`
                + `• 작업지시서: ${nOrders ? `${nOrders}건은 지우지 않고, 시방서의 원액 품목·원료 재고 연결을 지시서에 옮겨 둡니다.` : '연결된 지시서 없음'}\n• 생산입고 배합비: 그대로 둡니다.`)) return;
            const progress = (msg) => openModal(`<div class="bg-white rounded-2xl shadow-xl p-6 text-sm font-bold text-slate-700 flex items-center gap-3"><i data-lucide="loader-circle" class="w-5 h-5 animate-spin text-rose-600"></i>${esc(msg)}</div>`);
            let res = null;
            await run(async () => {
                progress(`제조시방서 삭제 중… 0 / ${targets.length}`);
                res = await deleteRecipesKeepOrders([...ids], (d, t) => progress(`제조시방서 삭제 중… ${d} / ${t}`));
                recipeSelected.clear();
            }, `제조시방서 ${targets.length}건을 삭제했습니다.${nOrders ? ` (작업지시서 ${nOrders}건은 유지)` : ''}`);
            if (res?.activated?.length) alert(`사용 중이던 리비전을 지워, 남은 리비전 중 최신을 사용으로 바꿨습니다:\n- ${res.activated.join('\n- ')}`);
        });
        // 이미 고른 조건(검색·분류·종류, 구버전 N 버튼의 제품명)이 있으면 그 결과 묶음은 펼쳐 보여 준다
        renderRecipeRows({ openMatches: !!(recipeFilter.q.trim() || recipeFilter.cat || recipeFilter.sub) });
    };

    // 엑셀 하나를 읽어 시방서 후보를 만든다 (저장은 하지 않음). 재고 품목코드는
    // ① 같은 제품의 이전 시방서에서 이어받고 ② 못 찾으면 원료명으로 품목마스터를 검색해 자동 연결한다.
    const parseRecipeFile = async (file) => {
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
        return buildRecipe(parseSpecWorkbook(XLSX, wb), file.name);
    };
    const buildRecipe = (spec, fileName) => {
        const prev = secure.recipes.filter(r => r.productName === spec.productName);
        const same = prev.find(r => r.revision === spec.revision);
        const carry = (m) => {
            for (const r of prev) {
                const hit = r.materials.find(x => (m.rawCode && x.rawCode === m.rawCode) || x.name === m.name);
                if (hit?.itemCode) return hit.itemCode;
            }
            // 이전 시방서에 연결이 없으면 원료명으로 품목마스터(원료/원액)를 검색해 자동 연결
            const found = resolveMasterItem(m.name, '', '원료', rawItems);
            return found?.code || '';
        };
        const recipe = {
            ...(same || {}),
            productName: spec.productName,
            // 분류·종류는 엑셀에 없으므로 같은 제품의 이전 시방서에서 이어받는다
            category: same?.category || prev.find(r => r.category)?.category || '',
            subCategory: same?.subCategory || prev.find(r => r.category)?.subCategory || '',
            revision: spec.revision,
            baseQty: spec.baseQty,
            baseUnit: spec.baseUnit,
            baseLiters: spec.baseLiters,
            productItemCode: same?.productItemCode || prev.find(r => r.productItemCode)?.productItemCode || '',
            materials: spec.materials.map(m => ({ ...m, itemCode: carry(m) })),
            workStandard: spec.workStandard,
            history: spec.history,
            brands: spec.brands,
            qcItems: spec.qcItems,
            docNo: spec.docNo,
            author: spec.author,
            sourceFile: fileName,
            active: true
        };
        // 가져온 파일이 이미 있는 리비전보다 오래되었으면 구버전 보관함에 사용 중지로 넣고,
        // 최신이면 같은 제품의 다른 리비전을 사용 중지한다 (파일을 가져오는 순서와 무관)
        const isOlder = prev.some(r => r.id !== same?.id && !r.archived && cmpRev(r, recipe) > 0);
        if (isOlder) recipe.active = false;
        const olderActive = isOlder ? [] : prev.filter(r => r.id !== same?.id && r.active);
        return { spec, recipe, same, olderActive, isOlder };
    };

    const onImportFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        let parsed;
        try {
            parsed = await parseRecipeFile(file);
        } catch (err) {
            alert(`엑셀을 읽지 못했습니다:\n${err.message}`);
            return;
        }
        const { spec, recipe, same, olderActive, isOlder } = parsed;
        const linked = recipe.materials.filter(m => m.itemCode).length;
        const summary = `${spec.productName} · ${spec.revision || 'Rev 없음'}\n기준 ${spec.baseQty} ${spec.baseUnit} = ${fmt(spec.baseLiters)} L\n원료 ${spec.materials.length}종 (재고 연결 ${linked}종): ${spec.materials.map(m => m.rawCode || '(코드 없음)').join(', ')}\n검사항목 ${spec.qcItems.length}개 · 개정이력 ${spec.history.length}건`;
        const warn = spec.warnings.length ? `\n\n⚠️ ${spec.warnings.join('\n⚠️ ')}` : '';
        const olderNote = isOlder ? '이미 더 최신 리비전이 있어 이 파일은 구버전 보관함에 (사용 중지로) 등록됩니다.\n\n' : '';
        if (!confirm(`${same ? '같은 제품·리비전의 시방서가 있어 내용을 새로 덮어씁니다.\n\n' : ''}${olderNote}다음 제조시방서를 등록하시겠습니까?\n\n${summary}${warn}`)) return;
        // 새 리비전을 등록하면 같은 제품의 이전 리비전은 사용 중지
        await run(async () => {
            const saved = await saveRecipe(recipe);
            for (const r of olderActive) await saveRecipe({ ...r, active: false });
            tab = 'recipes';
            setTimeout(() => openRecipeEditor(saved), 0);
        }, `${spec.productName} ${spec.revision} 제조시방서를 등록했습니다.${isOlder ? ' (구버전 보관함)' : olderActive.length ? ' (이전 리비전은 사용 중지)' : ''}`);
    };

    // 폴더를 고르면 그 안의 엑셀 파일(하위 폴더 포함)을 모두 읽어 확인 한 번으로 일괄 등록한다.
    // 분류·종류는 폴더 이름, 내용이 같은 파일·이미 등록된 시방서는 건너뜀 (규칙: services/specFolderImport.js)
    const onImportFolder = async (e) => {
        const files = [...(e.target.files || [])].filter(f => /\.(xlsx|xlsm|xls)$/i.test(f.name) && !f.name.startsWith('~$'));
        e.target.value = '';
        if (!files.length) { alert('폴더 안에서 엑셀 파일을 찾지 못했습니다.'); return; }
        const progress = (msg) => openModal(`<div class="bg-white rounded-2xl shadow-xl p-6 text-sm font-bold text-slate-700 flex items-center gap-3"><i data-lucide="loader-circle" class="w-5 h-5 animate-spin text-amber-600"></i>${esc(msg)}</div>`);
        const entries = [];
        const fail = [];
        for (const [i, file] of files.entries()) {
            if (i % 20 === 0) progress(`엑셀 읽는 중… ${i} / ${files.length}`);
            // webkitRelativePath = '고른폴더/분류/종류/파일.xlsx' → 고른 폴더 이름은 뺀다
            const rel = (file.webkitRelativePath || file.name).split('/').slice(1).join('/') || file.name;
            try {
                const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
                entries.push({ rel, file: file.name, mtime: file.lastModified || 0, spec: parseSpecWorkbook(XLSX, wb) });
            } catch (err) {
                fail.push(`${rel}: ${err.message}`);
            }
        }
        closeModal();

        const plan = planFolderImport(entries, secure.recipes);
        const fresh = plan.items.filter(x => !x.existing);
        const catFix = plan.items.filter(x => x.existing && ((x.existing.category || '') !== x.category || (x.existing.subCategory || '') !== x.subCategory));
        if (!fresh.length && !catFix.length) {
            alert(`새로 등록할 제조시방서가 없습니다.\n\n이미 등록됨 ${plan.items.length}건 · 내용 중복 ${plan.dupFiles.length}건 · 시방서가 아닌 파일 ${fail.length + plan.skippedForms.length}건`);
            return;
        }
        const t0 = Date.now();
        const newRecipes = fresh.map((x, i) => ({
            ...buildRecipe({ ...x.spec, productName: x.productName, revision: x.revision }, x.file).recipe,
            id: undefined,
            category: x.category,
            subCategory: x.subCategory,
            createdAt: new Date(t0 + i).toISOString() // 리비전이 같으면 나중 파일이 최신 (저장 순서와 같음)
        }));
        // 제품별 최신 리비전만 사용, 분류·종류는 최신 리비전(=폴더) 것으로 통일. 새 시방서는 저장 전에 반영한다.
        // 기존 시방서는 복사본으로 판정한다 (saveRecipe가 원본을 바뀌기 전 내용으로 개정이력에 남기므로 원본은 그대로 둠)
        const merged = [
            ...secure.recipes.map(r => { const fix = catFix.find(x => x.existing === r); return fix ? { ...r, category: fix.category, subCategory: fix.subCategory, _fix: true } : { ...r }; }),
            ...newRecipes
        ];
        const settle = settleProducts(merged, new Set(plan.items.map(x => x.productName)));
        for (const s of settle) Object.assign(s.recipe, { active: s.active, category: s.category, subCategory: s.subCategory, _fix: true });
        const updates = merged.filter(r => r.id && r._fix);
        const products = new Set(newRecipes.map(r => r.productName)).size;

        const shown = plan.changes.slice(0, 15);
        if (!confirm(`폴더에서 엑셀 ${files.length}개를 읽었습니다.\n\n`
            + `• 새로 등록: 제조시방서 ${newRecipes.length}건 (제품 ${products}개, 제품마다 최신 리비전만 사용)\n`
            + `• 이미 등록된 시방서: ${plan.items.length - fresh.length}건 (다시 등록 안 함)\n`
            + `• 분류·종류·사용 여부만 고칠 기존 시방서: ${updates.length}건\n`
            + `• 내용이 같은 중복 파일 제외: ${plan.dupFiles.length}건\n`
            + `• 시방서가 아닌 파일 제외: ${fail.length + plan.skippedForms.length}건\n\n`
            + `분류 = 폴더 이름, 종류 = 하위 폴더 이름('기존' 폴더 제외)으로 넣습니다.`
            + (shown.length ? `\n\n제품명·리비전이 겹쳐 파일 이름으로 구분한 것 ${plan.changes.length}건:\n- ${shown.join('\n- ')}${plan.changes.length > shown.length ? `\n… 외 ${plan.changes.length - shown.length}건` : ''}` : '')
            + '\n\n등록하시겠습니까?')) return;

        let done = 0;
        try {
            for (const r of newRecipes) {
                if (done % 10 === 0) progress(`제조시방서 등록 중… ${done} / ${newRecipes.length}`);
                const { createdAt, id, _fix, ...rest } = r;
                await saveRecipe(rest);
                done++;
            }
            for (const [i, r] of updates.entries()) {
                if (i % 10 === 0) progress(`기존 시방서 분류·사용 여부 맞추는 중… ${i} / ${updates.length}`);
                const { _fix, ...rest } = r;
                await saveRecipe(rest, '폴더 가져오기: 분류·종류·사용 여부 정리');
            }
        } catch (err) {
            closeModal();
            alert(`${done}건 등록 후 오류로 멈췄습니다: ${err.message}\n다시 같은 폴더를 가져오면 등록된 것은 건너뛰고 이어서 등록합니다.`);
            await loadSecureData();
            render();
            return;
        }
        closeModal();
        tab = 'recipes';
        render();
        showToast(`🔒 제조시방서 ${done}건 등록, 기존 ${updates.length}건 정리 완료`);
    };

    // ==========================================
    // 백업·복원 (제조시방서 · 작업지시서 · 생산입고 배합비). 파일은 비밀번호로 암호화 (services/secureBackup.js)
    // ==========================================
    const PARTS = [['recipes', '제조시방서'], ['orders', '원액생산 작업지시서'], ['boms', '생산입고 배합비(BOM)']];
    const progressModal = (msg) => openModal(`<div class="bg-white rounded-2xl shadow-xl p-6 text-sm font-bold text-slate-700 flex items-center gap-3"><i data-lucide="loader-circle" class="w-5 h-5 animate-spin text-amber-600"></i>${esc(msg)}</div>`);
    const partChecks = (counts) => PARTS.map(([k, l]) => `<label class="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg"><input type="checkbox" class="bk-part w-4 h-4" value="${k}" checked /><span class="font-bold">${l}</span>${counts ? `<span class="ml-auto text-slate-500">${esc(counts[k])}</span>` : ''}</label>`).join('');
    const pickedParts = () => Object.fromEntries(PARTS.map(([k]) => [k, !!modal().querySelector(`.bk-part[value="${k}"]`)?.checked]));
    const bomCount = (b) => `클라우드 ${Object.keys(b?.cloud || {}).length}건 · 이 기기 ${Object.keys(b?.local || {}).length}건`;

    const openBackupModal = () => {
        openModal(`
        <form id="bk-form" class="bg-white rounded-2xl shadow-xl w-full max-w-lg my-10 p-5 space-y-4 text-xs">
            <div class="flex items-center justify-between">
                <h3 class="font-black text-sm text-slate-900">🔒 보안 자료 백업</h3>
                <button type="button" class="bk-close text-slate-400 hover:text-slate-700 min-w-11 min-h-11 inline-flex items-center justify-center"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div class="space-y-1.5">${partChecks()}</div>
            <p class="text-slate-500">배합비(BOM)는 클라우드 BOM과 <b>이 기기에만 저장된 원액·원료 배합비</b>를 함께 담습니다. 다른 기기의 배합비는 그 기기에서 따로 백업하세요.</p>
            <label class="block"><span class="font-bold text-slate-600">파일 비밀번호 (8자 이상)</span><input id="bk-pw" type="password" autocomplete="new-password" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5" /></label>
            <label class="block"><span class="font-bold text-slate-600">비밀번호 확인</span><input id="bk-pw2" type="password" autocomplete="new-password" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5" /></label>
            <p class="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 font-bold">백업 파일에는 원료 실명·배합비가 들어 있습니다(대외비). 비밀번호는 저장되지 않으며, 잊으면 복원할 수 없습니다. 파일은 외부에 공유하지 마세요.</p>
            <div class="flex justify-end gap-2">
                <button type="button" class="bk-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button>
                <button type="submit" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black">암호화 백업 파일 받기</button>
            </div>
        </form>`);
        modal().querySelectorAll('.bk-close').forEach(b => b.addEventListener('click', closeModal));
        modal().querySelector('#bk-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const parts = pickedParts();
            const pw = modal().querySelector('#bk-pw').value;
            if (!Object.values(parts).some(Boolean)) { alert('백업할 자료를 하나 이상 고르세요.'); return; }
            if (pw.length < 8) { alert('비밀번호는 8자 이상이어야 합니다.'); return; }
            if (pw !== modal().querySelector('#bk-pw2').value) { alert('비밀번호 확인이 맞지 않습니다.'); return; }
            try {
                progressModal('백업 파일을 만드는 중…');
                const backup = await buildBackup(parts);
                downloadBlob(await encryptBackup(backup, pw), backupFileName());
                closeModal();
                render();
                showToast(`🔒 백업 완료: 제조시방서 ${backup.recipes.length}건 · 작업지시서 ${backup.orders.length}건 · 배합비 ${bomCount(backup.boms)}`);
            } catch (err) {
                closeModal();
                alert(`백업하지 못했습니다: ${err.message}`);
            }
        });
    };

    const openRestoreModal = () => {
        openModal(`
        <form id="rs-form" class="bg-white rounded-2xl shadow-xl w-full max-w-lg my-10 p-5 space-y-4 text-xs">
            <div class="flex items-center justify-between">
                <h3 class="font-black text-sm text-slate-900">🔒 보안 자료 복원</h3>
                <button type="button" class="rs-close text-slate-400 hover:text-slate-700 min-w-11 min-h-11 inline-flex items-center justify-center"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <label class="block"><span class="font-bold text-slate-600">백업 파일 (.dlbak)</span><input id="rs-file" type="file" accept=".dlbak,.json" class="mt-1 w-full" /></label>
            <label class="block"><span class="font-bold text-slate-600">파일 비밀번호</span><input id="rs-pw" type="password" autocomplete="current-password" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5" /></label>
            <div class="flex justify-end gap-2">
                <button type="button" class="rs-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button>
                <button type="submit" class="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-black">파일 열기</button>
            </div>
        </form>`);
        modal().querySelectorAll('.rs-close').forEach(b => b.addEventListener('click', closeModal));
        modal().querySelector('#rs-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const file = modal().querySelector('#rs-file').files?.[0];
            const pw = modal().querySelector('#rs-pw').value;
            if (!file) { alert('백업 파일을 고르세요.'); return; }
            let backup;
            try {
                progressModal('백업 파일을 여는 중…');
                backup = await decryptBackup(await file.text(), pw);
            } catch (err) {
                closeModal();
                alert(err.message);
                openRestoreModal();
                return;
            }
            showRestorePlan(backup, pw);
        });
    };

    // 복원할 내용 확인 → 현재 상태를 먼저 백업 파일로 받은 뒤 복원
    const showRestorePlan = (backup, pw) => {
        const recipeIds = new Set(secure.recipes.map(r => r.id));
        const orderIds = new Set(secure.orders.map(o => o.id));
        const split = (list, ids) => { const over = list.filter(x => ids.has(x.id)).length; return `${list.length}건 (덮어쓰기 ${over} · 추가 ${list.length - over})`; };
        const counts = { recipes: split(backup.recipes, recipeIds), orders: split(backup.orders, orderIds), boms: bomCount(backup.boms) };
        openModal(`
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg my-10 p-5 space-y-4 text-xs">
            <h3 class="font-black text-sm text-slate-900">🔒 복원할 내용 확인</h3>
            <div class="text-slate-600">백업 일시 <b>${esc((backup.createdAt || '').slice(0, 16).replace('T', ' '))}</b>${backup.createdBy ? ` · 만든 사람 <b>${esc(backup.createdBy)}</b>` : ''}</div>
            <div class="space-y-1.5">${partChecks(counts)}</div>
            <p class="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 font-bold">같은 항목은 백업 내용으로 덮어쓰고, 없는 항목은 추가합니다. 백업에 없는 지금 자료는 지우지 않습니다. 복원하기 전에 <u>지금 상태를 같은 비밀번호로 먼저 백업 파일로 내려받습니다</u>(되돌리기용).</p>
            <div class="flex justify-end gap-2">
                <button type="button" class="rs-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">취소</button>
                <button type="button" id="rs-run" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-black">복원하기</button>
            </div>
        </div>`);
        modal().querySelectorAll('.rs-close').forEach(b => b.addEventListener('click', closeModal));
        modal().querySelector('#rs-run').addEventListener('click', async () => {
            const parts = pickedParts();
            if (!Object.values(parts).some(Boolean)) { alert('복원할 자료를 하나 이상 고르세요.'); return; }
            if (!confirm('선택한 자료를 복원하시겠습니까? 먼저 지금 상태의 백업 파일이 내려받아집니다.')) return;
            try {
                progressModal('복원 전 현재 상태를 백업하는 중…');
                const before = await buildBackup({ recipes: true, orders: true, boms: true });
                downloadBlob(await encryptBackup(before, pw), backupFileName('복원전'));
                const result = { recipes: 0, orders: 0, boms: null };
                if (parts.recipes || parts.orders) {
                    const r = await restoreSecureData(
                        { recipes: parts.recipes ? backup.recipes : [], orders: parts.orders ? backup.orders : [] },
                        (d, t) => progressModal(`시방서·작업지시서 복원 중… ${d} / ${t}`)
                    );
                    result.recipes = r.recipes;
                    result.orders = r.orders;
                }
                if (parts.boms) {
                    progressModal('배합비 복원 중…');
                    result.boms = await restoreBoms(backup.boms);
                }
                closeModal();
                render();
                showToast(`🔒 복원 완료: 제조시방서 ${result.recipes}건 · 작업지시서 ${result.orders}건${result.boms ? ` · 배합비 클라우드 ${result.boms.cloud}건·이 기기 ${result.boms.local}건` : ''}`);
            } catch (err) {
                closeModal();
                alert(`복원 중 오류로 멈췄습니다: ${err.message}\n방금 내려받은 '복원전' 백업 파일로 되돌릴 수 있습니다.`);
                await loadSecureData().catch(() => {});
                render();
            }
        });
    };

    // ==========================================
    // 재고 연결 일괄 정리: 원료 이름별 재고 품목, 제품별 생산 원액 품목을 한 화면에서 연결한다.
    // 목록은 최신 시방서(사용 중·보관함 제외)에 쓰인 것만, 저장은 같은 원료 이름·같은 제품명의 모든 시방서(구버전 포함)에 적용.
    // 연결 정보만 바꾸므로 개정이력 스냅샷은 남기지 않는다.
    // ==========================================
    const linkKey = (s) => String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
    const openLinkManager = (showAll = false) => {
        const latest = secure.recipes.filter(r => r.active && !r.archived);
        const latestIds = new Set(latest.map(r => r.id));
        const groups = new Map();
        for (const r of secure.recipes) {
            for (const m of r.materials || []) {
                const k = linkKey(m.name);
                if (!k) continue;
                const g = groups.get(k) || { key: k, name: m.name, rawCodes: new Set(), latest: new Set(), all: new Set(), latestUnlinked: false, code: '' };
                if (m.rawCode) g.rawCodes.add(m.rawCode);
                g.all.add(r.id);
                if (latestIds.has(r.id)) {
                    g.latest.add(r.id);
                    if (!m.itemCode) g.latestUnlinked = true;
                }
                if (!g.code && m.itemCode) g.code = m.itemCode;
                groups.set(k, g);
            }
        }
        const rawRows = [...groups.values()].filter(g => g.latest.size && (showAll || g.latestUnlinked))
            .sort((a, b) => b.latest.size - a.latest.size || a.name.localeCompare(b.name, 'ko'));
        const prodRows = latest.filter(r => showAll || !r.productItemCode)
            .sort((a, b) => catKey(a).localeCompare(catKey(b), 'ko') || a.productName.localeCompare(b.productName, 'ko'));
        const unlinkedRaw = [...groups.values()].filter(g => g.latest.size && g.latestUnlinked).length;
        const unlinkedProd = latest.filter(r => !r.productItemCode).length;
        const nameOf = (code) => state.master.find(x => x.code === code)?.name || '';
        const codeCell = (cls, key, code) => `<td class="p-1.5"><input class="${cls} w-full bg-slate-50 border border-slate-300 rounded px-1.5 py-1 font-mono" data-k="${esc(key)}" data-init="${esc(code)}" value="${esc(code)}" placeholder="코드·이름 일부 검색" autocomplete="off" />
            <div class="lm-name text-[10px] mt-0.5 ${code ? 'text-emerald-700' : 'text-slate-400'}">${esc(nameOf(code))}</div></td>`;

        openModal(`
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-5xl my-6 p-5 space-y-4 text-xs">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="font-black text-sm text-slate-900">🔒 재고 연결 일괄 정리</h3>
                <div class="flex items-center gap-2">
                    <button type="button" id="lm-toggle" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold">${showAll ? '연결 안 된 것만 보기' : '연결된 것도 보기'}</button>
                    <button type="button" class="lm-close text-slate-400 hover:text-slate-700 min-w-11 min-h-11 inline-flex items-center justify-center"><i data-lucide="x" class="w-5 h-5"></i></button>
                </div>
            </div>
            <p class="text-slate-500">재고 품목을 한 번 고르면 같은 원료(또는 같은 제품)를 쓰는 <b>모든 시방서</b>에 적용됩니다. 연결된 원료만 생산 완료·제품생산/입고 때 재고와 원료수불부에서 차감됩니다. 목록은 최신 시방서 기준입니다.</p>
            <div>
                <div class="font-black text-slate-800 mb-1">① 원료 재고 연결 <span class="font-normal text-slate-500">(연결 안 된 원료 ${unlinkedRaw}종)</span></div>
                <div class="overflow-auto max-h-[40vh] border border-slate-200 rounded-xl"><table class="w-full"><thead class="bg-slate-50 font-bold text-slate-600 sticky top-0"><tr>
                    <th class="p-2 text-left text-amber-700">원료명 (대외비)</th><th class="p-2 text-left">원료코드</th><th class="p-2 text-center whitespace-nowrap">최신 시방서</th><th class="p-2 text-left w-72">재고 품목 (원료·원액)</th>
                </tr></thead><tbody class="divide-y divide-slate-100">
                ${rawRows.map(g => `<tr>
                    <td class="p-2 font-bold text-amber-800">${esc(g.name)}</td>
                    <td class="p-2 font-mono">${esc([...g.rawCodes].join(', ') || '-')}</td>
                    <td class="p-2 text-center">${g.latest.size}건<span class="text-slate-400"> / 전체 ${g.all.size}</span></td>
                    ${codeCell('lm-raw', g.key, g.code)}
                </tr>`).join('') || '<tr><td colspan="4" class="p-4 text-center text-emerald-700 font-bold">모든 원료가 연결되어 있습니다.</td></tr>'}
                </tbody></table></div>
            </div>
            <div>
                <div class="font-black text-slate-800 mb-1">② 생산 원액 품목 연결 <span class="font-normal text-slate-500">(연결 안 된 최신 시방서 ${unlinkedProd}건)</span></div>
                <div class="overflow-auto max-h-[35vh] border border-slate-200 rounded-xl"><table class="w-full"><thead class="bg-slate-50 font-bold text-slate-600 sticky top-0"><tr>
                    <th class="p-2 text-left">분류 / 종류</th><th class="p-2 text-left">제품명</th><th class="p-2 text-left">Rev</th><th class="p-2 text-left w-72">생산 원액 품목</th>
                </tr></thead><tbody class="divide-y divide-slate-100">
                ${prodRows.map(r => `<tr>
                    <td class="p-2 text-slate-500">${esc(catKey(r))}${r.subCategory ? ` / ${esc(r.subCategory)}` : ''}</td>
                    <td class="p-2 font-bold text-slate-900">${esc(r.productName)}</td>
                    <td class="p-2 font-mono text-slate-500">${esc(r.revision || '-')}</td>
                    ${codeCell('lm-prod', r.productName, r.productItemCode || '')}
                </tr>`).join('') || '<tr><td colspan="4" class="p-4 text-center text-emerald-700 font-bold">모든 최신 시방서에 원액 품목이 연결되어 있습니다.</td></tr>'}
                </tbody></table></div>
            </div>
            <div class="flex justify-end gap-2">
                <button type="button" class="lm-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button>
                <button type="button" id="lm-save" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black">바뀐 연결 저장</button>
            </div>
        </div>`);

        const updateName = (inp) => {
            const el = inp.parentElement.querySelector('.lm-name');
            const code = inp.value.trim();
            el.textContent = nameOf(code);
            el.className = `lm-name text-[10px] mt-0.5 ${nameOf(code) ? 'text-emerald-700' : (code ? 'text-rose-500' : 'text-slate-400')}`;
        };
        modal().querySelectorAll('.lm-raw').forEach(inp => { attachItemSearch(inp, rawItems, () => updateName(inp)); inp.addEventListener('input', () => updateName(inp)); });
        modal().querySelectorAll('.lm-prod').forEach(inp => { attachItemSearch(inp, wonaekItems, () => updateName(inp)); inp.addEventListener('input', () => updateName(inp)); });
        modal().querySelectorAll('.lm-close').forEach(b => b.addEventListener('click', closeModal));
        const changedOf = (cls) => [...modal().querySelectorAll(cls)].filter(inp => inp.value.trim() !== inp.dataset.init).map(inp => ({ key: inp.dataset.k, code: inp.value.trim() }));
        modal().querySelector('#lm-toggle').addEventListener('click', () => {
            if ((changedOf('.lm-raw').length || changedOf('.lm-prod').length) && !confirm('저장하지 않은 연결이 있습니다. 버리고 목록을 바꿀까요?')) return;
            closeModal();
            openLinkManager(!showAll);
        });
        modal().querySelector('#lm-save').addEventListener('click', async () => {
            const rawCh = changedOf('.lm-raw');
            const prodCh = changedOf('.lm-prod');
            if (!rawCh.length && !prodCh.length) { alert('바뀐 연결이 없습니다.'); return; }
            const bad = [
                ...rawCh.filter(c => c.code && !rawItems.some(m => m.code === c.code)).map(c => c.code),
                ...prodCh.filter(c => c.code && !wonaekItems.some(m => m.code === c.code)).map(c => c.code)
            ];
            if (bad.length) { alert(`품목마스터에 없는 코드가 있습니다 (원료는 원료·원액, 제품은 원액 품목만): ${[...new Set(bad)].join(', ')}`); return; }
            const rawMap = new Map(rawCh.map(c => [c.key, c.code]));
            const prodMap = new Map(prodCh.map(c => [c.key, c.code]));
            const updates = [];
            for (const r of secure.recipes) {
                let changed = false;
                const materials = (r.materials || []).map(m => {
                    const k = linkKey(m.name);
                    if (!rawMap.has(k) || (m.itemCode || '') === rawMap.get(k)) return m;
                    changed = true;
                    return { ...m, itemCode: rawMap.get(k) };
                });
                let productItemCode = r.productItemCode || '';
                if (prodMap.has(r.productName) && productItemCode !== prodMap.get(r.productName)) { productItemCode = prodMap.get(r.productName); changed = true; }
                if (changed) updates.push({ ...r, materials, productItemCode });
            }
            if (!confirm(`원료 ${rawCh.length}종 · 제품 ${prodCh.length}개의 연결을 저장합니다.\n적용되는 시방서: ${updates.length}건 (구버전 포함)\n\n저장하시겠습니까?`)) return;
            const progress = (msg) => openModal(`<div class="bg-white rounded-2xl shadow-xl p-6 text-sm font-bold text-slate-700 flex items-center gap-3"><i data-lucide="loader-circle" class="w-5 h-5 animate-spin text-emerald-600"></i>${esc(msg)}</div>`);
            let done = 0;
            try {
                for (const r of updates) {
                    if (done % 10 === 0) progress(`연결 저장 중… ${done} / ${updates.length}`);
                    await saveRecipe(r, '재고 연결 일괄 정리', { snapshot: false });
                    done++;
                }
            } catch (err) {
                closeModal();
                alert(`${done}건 저장 후 오류로 멈췄습니다: ${err.message}`);
                render();
                return;
            }
            closeModal();
            render();
            showToast(`🔒 재고 연결을 저장했습니다. (시방서 ${done}건)`);
            openLinkManager(showAll);
        });
    };

    // 원료 하나의 배치 원료비 = 최근 단가(원/L, 원료수불부 기준) × 배합 L. 재고 연결(itemCode)이 있으면 그 코드로,
    // 없으면 원료 실명으로 원료수불부 최근 전표를 찾는다. 화면 표시용 산출이며 시방서에 저장하지 않는다.
    const openRecipeEditor = (r) => {
        if (!r) return;
        const isMobile = window.innerWidth < 768;
        // 검사 항목 한 줄 (PC에서는 왼쪽·오른쪽 두 단으로 흘러감: 화면 순서 = 저장 순서)
        const qcRow = (q, i) => `<div class="sr-qc-row flex items-center gap-1.5 py-1 break-inside-avoid" data-i="${i}">
            <input class="sr-qc-no w-12 shrink-0 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 font-mono text-center" value="${esc(q.no ?? '')}" />
            <input class="sr-qc-item flex-1 min-w-0 bg-slate-50 border border-slate-300 rounded px-1.5 py-1" value="${esc(q.item ?? '')}" placeholder="시험 항목" />
            <input class="sr-qc-std flex-1 min-w-0 bg-slate-50 border border-slate-300 rounded px-1.5 py-1" value="${esc(q.standard ?? '')}" placeholder="검사 기준" />
            <button type="button" class="sr-qc-del shrink-0 text-slate-400 hover:text-rose-600 min-w-11 min-h-11 inline-flex items-center justify-center"><i data-lucide="x" class="w-4 h-4"></i></button>
        </div>`;
        const qcHead = '<div class="flex items-center gap-1.5 text-slate-500 font-bold pb-1 border-b border-slate-200"><span class="w-12 shrink-0 text-center">No</span><span class="flex-1">시험 항목</span><span class="flex-1">검사 기준</span><span class="min-w-11"></span></div>';
        openModal(`
        <form id="sr-form" class="bg-white rounded-2xl shadow-xl w-full max-w-4xl my-6 p-5 space-y-4 text-xs">
            <div class="flex items-center justify-between">
                <h3 class="font-black text-sm text-slate-900">🔒 제조시방서 · ${esc(r.productName)} <span class="font-mono text-slate-500">${esc(r.revision)}</span></h3>
                <div class="flex items-center gap-2">
                    <button type="button" class="sr-open-history px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-black flex items-center gap-1"><i data-lucide="history" class="w-4 h-4"></i>버전 이력</button>
                    <button type="button" class="sr-close text-slate-400 hover:text-slate-700 min-w-11 min-h-11 inline-flex items-center justify-center"><i data-lucide="x" class="w-5 h-5"></i></button>
                </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <label class="block"><span class="font-bold text-slate-600">분류</span><input id="sr-cat" list="sr-cat-list" value="${esc(r.category || '')}" placeholder="예: 엔진오일" autocomplete="off" class="mt-1 w-full bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5 font-bold" />
                    <datalist id="sr-cat-list">${catDatalist()}</datalist></label>
                <label class="block"><span class="font-bold text-slate-600">종류 (세부 분류)</span><input id="sr-sub" list="sr-sub-list" value="${esc(r.subCategory || '')}" placeholder="예: 가솔린, 디젤" autocomplete="off" class="mt-1 w-full bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5 font-bold" />
                    <datalist id="sr-sub-list">${subDatalist(r.category || '')}</datalist></label>
                <div class="hidden md:block md:col-span-2"></div>
                <label class="block"><span class="font-bold text-slate-600">제품명</span><input id="sr-name" value="${esc(r.productName)}" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                <label class="block"><span class="font-bold text-slate-600">관련근거 (Rev)</span><input id="sr-rev" value="${esc(r.revision)}" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                <label class="block col-span-2 relative"><span class="font-bold text-slate-600">생산 원액 품목 (재고 입고 연결)</span>
                    <input id="sr-product" value="${esc(r.productItemCode)}" placeholder="원액 코드·이름 일부 검색" autocomplete="off" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-mono font-bold" />
                    <div id="sr-product-name" class="text-[10px] mt-0.5 ${r.productItemCode && state.master.find(x => x.code === r.productItemCode) ? 'text-emerald-700' : 'text-slate-400'}">${esc((state.master.find(x => x.code === r.productItemCode) || {}).name || '')}</div>
                </label>
            </div>
            ${isMobile ? `
            <div class="space-y-2.5">
                ${r.materials.map((m, i) => {
                    const item = m.itemCode ? state.master.find(x => x.code === m.itemCode) : null;
                    const priceUnit = m.priceUnit === 'KG' ? 'KG' : 'L';
                    const unitPrice = m.unitPrice > 0 ? m.unitPrice : (latestRawUnitPrice(m.itemCode, m.name) || '');
                    return `
                    <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="font-mono text-slate-400">#${esc(m.seq)}</span>
                            <span class="font-bold text-amber-800">${esc(m.name)}</span>
                        </div>
                        <div class="grid grid-cols-4 gap-1.5 text-center text-[11px] bg-white rounded-lg p-1.5 border border-slate-200">
                            <div><div class="text-slate-400">L</div><div class="font-mono font-bold">${fmt(m.liters)}</div></div>
                            <div><div class="text-slate-400">wt%</div><div class="font-mono font-bold">${fmt(m.wtPct)}</div></div>
                            <div><div class="text-slate-400">KG</div><div class="font-mono font-bold">${fmt(m.kg)}</div></div>
                            <div><div class="text-slate-400">SG</div><div class="font-mono font-bold">${fmt(m.sg, 4)}</div></div>
                        </div>
                        <label class="block"><span class="text-slate-500 font-bold">원료코드 (인쇄)</span>
                            <input class="sr-rawcode mt-0.5 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-mono font-bold" data-i="${i}" value="${esc(m.rawCode)}" /></label>
                        <label class="block relative"><span class="text-slate-500 font-bold">재고 품목 검색·연결</span>
                            <input class="sr-item mt-0.5 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-mono" data-i="${i}" value="${esc(m.itemCode)}" placeholder="코드·이름 일부 검색" autocomplete="off" />
                            <div class="sr-item-name text-[10px] mt-0.5 ${item ? 'text-emerald-700' : (m.itemCode ? 'text-rose-500' : 'text-slate-400')}" data-i="${i}">${esc(item?.name || '')}</div></label>
                        <div class="grid grid-cols-2 gap-2">
                            <label class="block"><span class="text-slate-500 font-bold">단가</span>
                                <input class="sr-price-input mt-0.5 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-right font-mono" type="number" min="0" step="any" data-i="${i}" value="${esc(unitPrice)}" placeholder="원" /></label>
                            <label class="block"><span class="text-slate-500 font-bold">기준</span>
                                <select class="sr-price-unit mt-0.5 w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 font-bold" data-i="${i}">
                                    <option value="L" ${priceUnit === 'L' ? 'selected' : ''}>원/L</option>
                                    <option value="KG" ${priceUnit === 'KG' ? 'selected' : ''}>원/KG</option>
                                </select></label>
                        </div>
                        <div class="flex items-center justify-between text-[11px] pt-1 border-t border-slate-200">
                            <span class="text-slate-500 font-bold">원료비(원)</span>
                            <span class="sr-amount font-mono font-black text-slate-800" data-i="${i}">-</span>
                        </div>
                    </div>`;
                }).join('')}
                <div class="bg-slate-100 border border-slate-300 rounded-xl p-3 space-y-1 text-[11px] font-bold">
                    <div class="text-center text-slate-700">S-TOTAL (${fmt(r.baseQty)} ${esc(r.baseUnit)})</div>
                    <div class="grid grid-cols-3 gap-1.5 text-center">
                        <div><div class="text-slate-400">L</div><div class="font-mono">${fmt(r.materials.reduce((s, m) => s + (m.liters || 0), 0))}</div></div>
                        <div><div class="text-slate-400">wt%</div><div class="font-mono">${fmt(r.materials.reduce((s, m) => s + (m.wtPct || 0), 0))}</div></div>
                        <div><div class="text-slate-400">KG</div><div class="font-mono">${fmt(r.materials.reduce((s, m) => s + (m.kg || 0), 0))}</div></div>
                    </div>
                    <div class="flex items-center justify-between pt-1 border-t border-slate-300">
                        <span class="text-slate-500">원료비 합계</span>
                        <span id="sr-cost-total" class="font-mono text-slate-700">-</span>
                    </div>
                </div>
            </div>
            ` : `
            <div class="overflow-x-auto border border-slate-200 rounded-xl"><table class="w-full"><thead class="bg-slate-50 font-bold text-slate-600"><tr>
                <th class="p-2 text-left">순</th><th class="p-2 text-left text-amber-700">원료명 (대외비)</th><th class="p-2 text-left">원료코드 (인쇄)</th>
                <th class="p-2 text-right">L</th><th class="p-2 text-right">wt%</th><th class="p-2 text-right">KG</th><th class="p-2 text-right">SG</th>
                <th class="p-2 text-left">재고 품목 검색·연결</th><th class="p-2 text-right whitespace-nowrap">단가</th><th class="p-2 text-center whitespace-nowrap">기준</th><th class="p-2 text-right whitespace-nowrap">원료비(원)</th>
            </tr></thead><tbody class="divide-y divide-slate-100">
                ${r.materials.map((m, i) => {
                    const item = m.itemCode ? state.master.find(x => x.code === m.itemCode) : null;
                    const priceUnit = m.priceUnit === 'KG' ? 'KG' : 'L';
                    const unitPrice = m.unitPrice > 0 ? m.unitPrice : (latestRawUnitPrice(m.itemCode, m.name) || '');
                    return `<tr>
                    <td class="p-2 font-mono">${esc(m.seq)}</td>
                    <td class="p-2 font-bold text-amber-800">${esc(m.name)}</td>
                    <td class="p-2"><input class="sr-rawcode w-32 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 font-mono font-bold" data-i="${i}" value="${esc(m.rawCode)}" /></td>
                    <td class="p-2 text-right font-mono">${fmt(m.liters)}</td><td class="p-2 text-right font-mono">${fmt(m.wtPct)}</td>
                    <td class="p-2 text-right font-mono">${fmt(m.kg)}</td><td class="p-2 text-right font-mono">${fmt(m.sg, 4)}</td>
                    <td class="p-2 relative"><input class="sr-item w-36 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 font-mono" data-i="${i}" value="${esc(m.itemCode)}" placeholder="코드·이름 일부 검색" autocomplete="off" />
                        <div class="sr-item-name text-[10px] mt-0.5 ${item ? 'text-emerald-700' : (m.itemCode ? 'text-rose-500' : 'text-slate-400')}" data-i="${i}">${esc(item?.name || '')}</div></td>
                    <td class="p-2"><input class="sr-price-input w-24 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 text-right font-mono" type="number" min="0" step="any" data-i="${i}" value="${esc(unitPrice)}" placeholder="원" /></td>
                    <td class="p-2 text-center"><select class="sr-price-unit bg-slate-50 border border-slate-300 rounded px-1 py-1 font-bold" data-i="${i}">
                        <option value="L" ${priceUnit === 'L' ? 'selected' : ''}>원/L</option>
                        <option value="KG" ${priceUnit === 'KG' ? 'selected' : ''}>원/KG</option>
                    </select></td>
                    <td class="p-2 text-right font-mono sr-amount" data-i="${i}">-</td>
                </tr>`;
                }).join('')}
                <tr class="bg-slate-50 font-bold"><td colspan="3" class="p-2 text-center">S-TOTAL (${fmt(r.baseQty)} ${esc(r.baseUnit)})</td>
                    <td class="p-2 text-right font-mono">${fmt(r.materials.reduce((s, m) => s + (m.liters || 0), 0))}</td>
                    <td class="p-2 text-right font-mono">${fmt(r.materials.reduce((s, m) => s + (m.wtPct || 0), 0))}</td>
                    <td class="p-2 text-right font-mono">${fmt(r.materials.reduce((s, m) => s + (m.kg || 0), 0))}</td><td></td><td></td><td></td>
                    <td id="sr-cost-total" class="p-2 text-right font-mono text-slate-700">-</td></tr>
            </tbody></table></div>
            `}
            <p class="text-[11px] text-slate-500">단가를 입력하면 기준(원/L 또는 원/KG)에 따라 원료비가 자동 계산되어 시방서에 저장됩니다. 처음에는 원료수불부 최근 입고 단가를 참고용으로 채워 둡니다.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label class="block"><span class="font-black text-slate-800">작업표준 <span class="font-normal text-slate-400">(한 줄에 하나씩)</span></span>
                    <textarea id="sr-workstd" rows="6" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-mono">${esc(r.workStandard.join('\n'))}</textarea></label>
                <label class="block"><span class="font-black text-slate-800">개정 이력 <span class="font-normal text-slate-400">(한 줄에 하나씩)</span></span>
                    <textarea id="sr-history" rows="6" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-mono">${esc(r.history.join('\n'))}</textarea></label>
                <label class="block"><span class="font-black text-slate-800">적용 ODM 제품 <span class="font-normal text-slate-400">(한 줄에 하나씩)</span></span>
                    <textarea id="sr-brands" rows="5" class="mt-1 w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 font-mono">${esc(r.brands.join('\n'))}</textarea></label>
                <div class="md:col-span-2">
                    <div class="flex items-center justify-between mb-1">
                        <span class="font-black text-slate-800">검사 항목 <span class="font-normal text-slate-400">(${r.qcItems.length}개)</span></span>
                        <button type="button" id="sr-qc-add" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold flex items-center gap-1"><i data-lucide="plus" class="w-3.5 h-3.5"></i>행 추가</button>
                    </div>
                    <div class="border border-slate-200 rounded-lg p-2">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">${qcHead}<div class="hidden md:block">${qcHead}</div></div>
                        <div id="sr-qc-body" class="md:columns-2 md:gap-x-6">${r.qcItems.map(qcRow).join('')}</div>
                    </div>
                </div>
            </div>
            <p class="text-[11px] text-slate-500">재고 품목코드를 연결한 원료만 생산 완료 시 재고·원료수불부에서 차감됩니다. 출처: ${esc(r.sourceFile || '-')} · 문서 ${esc(r.docNo || '-')} · 작성 ${esc(r.author || '-')}</p>
            <div class="flex justify-end gap-2">
                <button type="button" class="sr-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button>
                <button type="submit" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black">저장</button>
            </div>
        </form>`);

        // 원료비 = 입력한 단가 × 기준 수량(원/L이면 배합 L, 원/KG이면 배합 KG). 기준·단가는 시방서에 저장된다.
        const renderCost = () => {
            let total = 0;
            r.materials.forEach((m, i) => {
                const priceInp = modal().querySelector(`.sr-price-input[data-i="${i}"]`);
                const unitSel = modal().querySelector(`.sr-price-unit[data-i="${i}"]`);
                const amountCell = modal().querySelector(`.sr-amount[data-i="${i}"]`);
                const price = Number(priceInp?.value) || 0;
                const basisQty = unitSel?.value === 'KG' ? (Number(m.kg) || 0) : (Number(m.liters) || 0);
                if (price > 0) {
                    const amount = price * basisQty;
                    total += amount;
                    if (amountCell) amountCell.textContent = fmt(amount, 0);
                } else if (amountCell) {
                    amountCell.textContent = '-';
                }
            });
            const totalCell = modal().querySelector('#sr-cost-total');
            if (totalCell) totalCell.textContent = total > 0 ? `${fmt(total, 0)}` : '-';
        };
        const updateItemName = (inp) => {
            const nameEl = modal().querySelector(`.sr-item-name[data-i="${inp.dataset.i}"]`);
            if (!nameEl) return;
            const item = state.master.find(x => x.code === inp.value.trim());
            nameEl.textContent = item?.name || '';
            nameEl.className = `sr-item-name text-[10px] mt-0.5 ${item ? 'text-emerald-700' : (inp.value.trim() ? 'text-rose-500' : 'text-slate-400')}`;
        };
        modal().querySelectorAll('.sr-item').forEach(inp => {
            attachItemSearch(inp, rawItems, () => { updateItemName(inp); renderCost(); });
            inp.addEventListener('input', () => { updateItemName(inp); renderCost(); });
        });
        modal().querySelectorAll('.sr-price-input, .sr-price-unit').forEach(el => el.addEventListener('input', renderCost));
        const productInput = modal().querySelector('#sr-product');
        const updateProductName = () => {
            const nameEl = modal().querySelector('#sr-product-name');
            const item = state.master.find(x => x.code === productInput.value.trim());
            nameEl.textContent = item?.name || '';
            nameEl.className = `text-[10px] mt-0.5 ${item ? 'text-emerald-700' : (productInput.value.trim() ? 'text-rose-500' : 'text-slate-400')}`;
        };
        attachItemSearch(productInput, wonaekItems, updateProductName);
        productInput.addEventListener('input', updateProductName);
        renderCost();

        const qcBody = modal().querySelector('#sr-qc-body');
        const bindQcDelete = () => qcBody.querySelectorAll('.sr-qc-del').forEach(b => b.addEventListener('click', () => { b.closest('.sr-qc-row').remove(); }));
        bindQcDelete();
        modal().querySelector('#sr-qc-add').addEventListener('click', () => {
            qcBody.insertAdjacentHTML('beforeend', qcRow({}, qcBody.children.length));
            bindQcDelete();
        });

        modal().querySelectorAll('.sr-close').forEach(b => b.addEventListener('click', closeModal));
        modal().querySelector('.sr-open-history').addEventListener('click', () => openRecipeHistory(r));
        modal().querySelector('#sr-cat').addEventListener('input', (e) => { modal().querySelector('#sr-sub-list').innerHTML = subDatalist(e.target.value.trim()); });
        modal().querySelector('#sr-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const materials = r.materials.map(m => ({ ...m }));
            modal().querySelectorAll('.sr-rawcode').forEach(inp => { materials[inp.dataset.i].rawCode = inp.value.trim(); });
            let bad = [];
            modal().querySelectorAll('.sr-item').forEach(inp => {
                const code = inp.value.trim();
                if (code && !state.master.some(m => m.code === code)) bad.push(code);
                materials[inp.dataset.i].itemCode = code;
            });
            modal().querySelectorAll('.sr-price-input').forEach(inp => { materials[inp.dataset.i].unitPrice = Number(inp.value) || 0; });
            modal().querySelectorAll('.sr-price-unit').forEach(sel => { materials[sel.dataset.i].priceUnit = sel.value === 'KG' ? 'KG' : 'L'; });
            const productItemCode = productInput.value.trim();
            if (productItemCode && !state.master.some(m => m.code === productItemCode)) bad.push(productItemCode);
            if (bad.length) { alert(`품목 마스터에 없는 품목코드입니다: ${bad.join(', ')}`); return; }
            const codes = materials.map(m => m.rawCode).filter(Boolean);
            if (new Set(codes).size !== codes.length) { alert('한 시방서 안에서 원료코드가 중복되었습니다.'); return; }
            const splitLines = (id) => modal().querySelector(id).value.split('\n').map(s => s.trim()).filter(Boolean);
            const qcItems = [...modal().querySelectorAll('.sr-qc-row')].map(row => ({
                no: row.querySelector('.sr-qc-no').value.trim(),
                item: row.querySelector('.sr-qc-item').value.trim(),
                standard: row.querySelector('.sr-qc-std').value.trim()
            })).filter(q => q.item || q.standard);
            const category = modal().querySelector('#sr-cat').value.trim();
            const subCategory = modal().querySelector('#sr-sub').value.trim();
            if (!category && subCategory) { alert('종류를 지정하려면 분류도 입력하세요.'); return; }
            // 분류를 바꾸면 같은 제품의 다른 리비전도 함께 맞춘다
            const siblings = category !== (r.category || '') || subCategory !== (r.subCategory || '')
                ? olderVersionsOf(r).filter(x => x.category !== category || x.subCategory !== subCategory) : [];
            const updated = {
                ...r, materials, productItemCode, category, subCategory,
                productName: modal().querySelector('#sr-name').value.trim() || r.productName,
                revision: modal().querySelector('#sr-rev').value.trim(),
                workStandard: splitLines('#sr-workstd'),
                history: splitLines('#sr-history'),
                brands: splitLines('#sr-brands'),
                qcItems
            };
            await run(async () => {
                for (const x of siblings) await saveRecipe({ ...x, category, subCategory }, '분류 변경 (같은 제품)');
                await saveRecipe(updated);
            }, '제조시방서를 저장했습니다.');
        });
    };

    // ==========================================
    // 제조시방서 개정이력(자동 스냅샷) 열람·되돌리기
    // ==========================================
    const openRecipeHistory = async (r) => {
        let revisions;
        try { revisions = await listRecipeRevisions(r.id); } catch (err) { alert(err.message); return; }
        openModal(`
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-10 p-5 space-y-3 text-xs">
            <div class="flex items-center justify-between">
                <h3 class="font-black text-sm text-slate-900">🕘 개정이력 · ${esc(r.productName)} <span class="font-mono text-slate-500">${esc(r.revision)}</span></h3>
                <button type="button" class="srh-close text-slate-400 hover:text-slate-700 min-w-11 min-h-11 inline-flex items-center justify-center"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <p class="text-slate-500">저장할 때마다 바뀌기 직전 내용이 자동으로 남습니다. 되돌리면 되돌리기 전 현재 내용도 새 이력으로 남습니다.</p>
            <div class="overflow-y-auto max-h-96 divide-y divide-slate-100 border border-slate-200 rounded-xl">
            ${revisions.length === 0 ? '<div class="p-6 text-center text-slate-400 font-bold">저장 이력이 없습니다.</div>' : revisions.map(v => `
                <div class="p-3 flex items-center justify-between gap-3">
                    <div>
                        <div class="font-bold text-slate-800">${esc((v.createdAt || '').slice(0, 16).replace('T', ' '))}${v.author ? ` · ${esc(v.author)}` : ''}</div>
                        <div class="text-slate-500">${esc(v.note || '자동 저장')}</div>
                        <div class="text-[10px] text-slate-400">원료 ${v.snapshot?.materials?.length ?? 0}종 · 관련근거 ${esc(v.snapshot?.revision || '-')}</div>
                    </div>
                    <button type="button" class="srh-restore px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-black whitespace-nowrap" data-id="${esc(v.id)}">이 시점으로 복원</button>
                </div>`).join('')}
            </div>
            <div class="flex justify-end"><button type="button" class="srh-close px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-bold">닫기</button></div>
        </div>`);
        modal().querySelectorAll('.srh-close').forEach(b => b.addEventListener('click', () => openRecipeEditor(secure.recipes.find(x => x.id === r.id))));
        modal().querySelectorAll('.srh-restore').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('이 시점의 내용으로 되돌리시겠습니까? 되돌리기 전 현재 내용은 새 이력으로 남습니다.')) return;
            try {
                const restored = await restoreRecipeRevision(r.id, b.dataset.id);
                showToast(`🔒 ${restored.productName} 시방서를 이전 시점으로 되돌렸습니다.`);
                render();
                openRecipeEditor(restored);
            } catch (err) { alert(err.message); }
        }));
    };

    // 검사항목 표: 원본 엑셀처럼 왼쪽·오른쪽 두 묶음으로 (앞 절반은 왼쪽, 나머지는 오른쪽)
    const qcTwoColumnHtml = (items, c) => {
        if (!items.length) return '';
        const half = Math.ceil(items.length / 2);
        const cells = (q) => (q ? `<td class="qc-no">${c(q.no)}</td><td>${c(q.item)}</td><td>${c(q.standard)}</td>` : '<td class="qc-no"></td><td></td><td></td>');
        const rows = Array.from({ length: half }, (_, i) => `<tr>${cells(items[i])}${cells(items[i + half])}</tr>`).join('');
        return `<table class="qc" style="margin-top:6px"><colgroup><col style="width:5%"><col style="width:20%"><col style="width:25%"><col style="width:5%"><col style="width:20%"><col style="width:25%"></colgroup>
            <tr><th colspan="6">검사 항목</th></tr>
            <tr><th>No</th><th>시험 항목</th><th>검사 기준</th><th>No</th><th>시험 항목</th><th>검사 기준</th></tr>${rows}</table>`;
    };

    // 제조시방서 인쇄 (원료 실명 포함 · 대외비)
    const printRecipe = (r) => {
        if (!confirm('제조시방서에는 원료 실명과 배합비가 포함됩니다(대외비). 인쇄하시겠습니까?')) return;
        const w = window.open('', '_blank', 'width=900,height=1000');
        if (!w) { alert('팝업이 차단되었습니다.'); return; }
        const c = (v) => esc(v ?? '');
        w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>제조시방서 ${c(r.productName)}</title>
        <style>@page{size:A4 portrait;margin:10mm}body{font-family:'Malgun Gothic',sans-serif;font-size:10.5px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #000;padding:3px 5px}th{background:#f1f5f9}.num{text-align:right;font-family:Consolas,monospace}h1{text-align:center;letter-spacing:8px;margin:2mm 0 4mm}.logo-row{display:flex;align-items:center;gap:2mm;font-size:9px;color:#475569;min-height:10mm}.qc{table-layout:fixed}.qc td{word-break:keep-all;overflow-wrap:anywhere}.qc .qc-no{text-align:center}.qc tr>td:nth-child(3){border-right:2px solid #000}${CONFIDENTIAL_CSS}</style></head><body>
        ${confidentialHtml('원료 실명·배합비 포함 · 무단 복제·반출 금지')}
        <div class="logo-row">${logoImgHtml(9)}<span>대림오일 · 제조시방서</span></div>
        <h1>제 조 시 방 서</h1>
        <table><tr><th>제품명</th><td>${c(r.productName)}</td><th>관련근거</th><td>${c(r.revision)}</td><th>기준 생산량</th><td>${c(fmt(r.baseQty))} ${c(r.baseUnit)} (${c(fmt(r.baseLiters))} L)</td></tr></table>
        <table style="margin-top:6px"><tr><th>순</th><th>원료명</th><th>원료코드</th><th>L</th><th>wt%</th><th>KG</th><th>SG</th></tr>
        ${r.materials.map(m => `<tr><td>${c(m.seq)}</td><td>${c(m.name)}</td><td>${c(m.rawCode)}</td><td class="num">${c(fmt(m.liters))}</td><td class="num">${c(fmt(m.wtPct))}</td><td class="num">${c(fmt(m.kg))}</td><td class="num">${c(fmt(m.sg, 4))}</td></tr>`).join('')}
        </table>
        <p><b>작업표준</b>: ${c(r.workStandard.join(' / '))}</p>
        <p><b>개정 이력</b></p><ol style="margin:0">${r.history.map(h => `<li>${c(h.replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol>
        <p><b>적용 ODM 제품</b>: ${c(r.brands.join(', '))}</p>
        ${qcTwoColumnHtml(r.qcItems, c)}
        <p style="font-size:9px">${c(r.docNo)} · 대림기업 · 출력일 ${c(localDateStr())}</p>
        <script>window.onload=()=>{window.focus();window.print();};<\/script></body></html>`);
        w.document.close();
    };

    if (limited) mountWoUserView(container, { showToast, printWorkLog });
    else render();

    // [현장 스캔] 탭 등 다른 화면에서 원액생산 작업지시서 QR을 읽고 넘어온 경우,
    // 목록을 불러온 지금 바로 그 지시서의 생산 완료 처리 창을 띄운다.
    if (!limited && window.__pendingSecureWorkOrderScan) {
        const scannedOrderNo = window.__pendingSecureWorkOrderScan;
        window.__pendingSecureWorkOrderScan = null;
        const order = secure.orders.find(o => o.orderNo === scannedOrderNo);
        if (!order) {
            alert(`지시번호 ${scannedOrderNo}를 찾을 수 없습니다.`);
        } else if (order.status === 'COMPLETED') {
            alert(`${order.orderNo}는 이미 생산 완료 처리되었습니다.`);
        } else if (order.status === 'CANCELLED') {
            alert(`${order.orderNo}는 취소된 지시서입니다.`);
        } else {
            openCompleteModal(order);
        }
    }
};
