// ==========================================
// 재고 옮기기 창 (창고 배치도) — 옮길 곳 · 놓을 칸 · 수량(전체량 / 일부량) · 파렛트 수 · 창고간 이동전표 자동 발행
// ==========================================
// 칸·품목을 끌어다 놓거나 [옮기기]·[구획 지정]을 누르면 열린다. 실제 처리는 services/zoneTransfer.js의 transferStock.
import { state } from '../../services/db.js';
import { locationLabel, locationOptionsHtml, siteOf, buildingOf } from '../../services/locations.js';
import { zoneCapacity, zoneDims, zonePallets, itemPallets, zoneIdOfLocation, zoneCellMap } from '../../services/warehouseZones.js';
import { transferStock, routeText } from '../../services/zoneTransfer.js';
import { esc } from '../../services/html.js';

const SLIP_PREF_KEY = 'daelim_w3_auto_slip'; // 전표 자동 발행 선택 (기기별, 기본 켬)
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const round3 = (n) => Math.round(n * 1000) / 1000;

const readSlipPref = () => { try { return localStorage.getItem(SLIP_PREF_KEY) !== '0'; } catch { return true; } };
const writeSlipPref = (on) => { try { localStorage.setItem(SLIP_PREF_KEY, on ? '1' : '0'); } catch (e) { console.warn('전표 자동 발행 선택 저장 실패', e); } };

/**
 * @typedef {{ code: string, name: string, qty: number, unit: string, pallets: number|null, fromLoc: string, toLoc: string,
 *   slip: { docNo: string }|null, offline: boolean, warnings: string[], placed: number[] }} MoveResult
 */

/**
 * @param {HTMLElement} modal 창을 띄울 덮개 (#w3-modal)
 * @param {{ codes: string[], fromLoc: string, toLoc?: string, fromCell?: number, toSlot?: number,
 *   zones: { id: string, slots: number, tiers: number, site: string }[],
 *   showToast: (message: string) => void, onDone: (result: MoveResult) => void }} opts
 *   codes가 여러 개면(칸이 없는 구획을 통째로 끌었을 때) 품목을 골라 하나씩 옮긴다.
 *   fromCell = 끌어 온 칸 번호(그 파렛트부터 뺀다), toSlot = 놓은 칸(채우는 쪽에서 센 칸, 0부터) — 없으면 -1
 */
export const openMoveDialog = (modal, { codes, fromLoc, toLoc = '', fromCell = -1, toSlot = -1, zones, showToast, onDone }) => {
    const stockRows = codes.map(code => state.inventory.find(i => i.code === code && i.location === fromLoc)).filter(i => i && Number(i.quantity) > 0);
    if (!stockRows.length) { showToast('옮길 재고가 없습니다.'); return; }
    const zoneOf = (loc) => { const id = zoneIdOfLocation(loc); return (id && zones.find(z => z.id === id)) || null; };
    const fromZone = zoneOf(fromLoc);
    const fromHasCells = !!(fromZone && zoneCapacity(fromZone));

    modal.innerHTML = `<div class="bg-white rounded-xl w-full max-w-md p-4 space-y-3 max-h-[92vh] overflow-y-auto">
        <div class="font-bold text-slate-800">재고 옮기기</div>
        ${stockRows.length > 1
            ? `<label class="block text-sm">옮길 품목<select id="w3-m-item" class="w-full border rounded-lg px-2 py-2 mt-1">${stockRows.map(i => `<option value="${esc(i.code)}">${esc(i.name)} (${esc(i.code)}) · ${fmt(i.quantity)} ${esc(i.unit || '')}</option>`).join('')}</select></label>`
            : `<div class="text-sm"><b>${esc(stockRows[0].name)}</b> <span class="text-slate-400">${esc(stockRows[0].code)}</span></div>`}
        <div class="text-xs text-slate-500">출발: <b class="text-slate-700">${esc(locationLabel(fromLoc))}</b></div>
        <label class="block text-sm">도착 (옮길 곳)<select id="w3-m-to" class="w-full border rounded-lg px-2 py-2 mt-1 font-bold"></select></label>
        <label id="w3-m-slot-row" class="block text-sm">놓을 칸 <span class="text-[11px] text-slate-500">그 칸의 가장 아래 빈 단에 놓이고, 칸 위치가 저장됩니다</span>
            <select id="w3-m-slot" class="w-full border rounded-lg px-2 py-2 mt-1"></select></label>
        <div class="space-y-1.5">
            <div class="text-sm">옮길 수량</div>
            <label class="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer">
                <input type="radio" name="w3-m-mode" value="ALL" checked> <span>전체량</span> <b id="w3-m-all" class="ml-auto"></b></label>
            <label class="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer">
                <input type="radio" name="w3-m-mode" value="PART"> <span class="shrink-0">일부량</span>
                <input id="w3-m-qty" type="number" step="any" min="0" inputmode="decimal" placeholder="옮길 수량" class="ml-auto w-32 border rounded-lg px-2 py-1 text-right font-bold">
                <span id="w3-m-unit" class="text-slate-500 shrink-0"></span></label>
        </div>
        <label id="w3-m-pal-row" class="block text-sm">옮기는 파렛트 수 <span class="text-[11px] text-slate-500">여러 파렛트면 놓을 칸부터 차례로 놓습니다</span>
            <input id="w3-m-pal" type="number" step="1" min="0" inputmode="decimal" class="w-full border rounded-lg px-2 py-2 mt-1"></label>
        <div id="w3-m-room" class="text-[11px] text-slate-500"></div>
        <label class="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" id="w3-m-slip" class="mt-0.5" ${readSlipPref() ? 'checked' : ''}>
            <span><b>창고간 이동전표 자동 발행</b><span class="block text-[11px] text-slate-500">옮기면서 전표(WT)를 만들고 출고 완료로 남깁니다. 전표관리에서 보고 인쇄할 수 있습니다.</span></span></label>
        <p id="w3-m-note" class="text-[11px] text-slate-500"></p>
        <div class="flex justify-end gap-2"><button id="w3-m-cancel" class="px-3 py-2 text-sm border rounded-lg">취소</button><button id="w3-m-ok" class="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-bold">옮기기</button></div></div>`;
    modal.classList.remove('hidden');

    const $ = (sel) => modal.querySelector(sel);
    const itemSel = $('#w3-m-item'), toSel = $('#w3-m-to'), slotSel = $('#w3-m-slot'), qtyInput = $('#w3-m-qty'), palInput = $('#w3-m-pal'), okBtn = $('#w3-m-ok');
    const close = () => { modal.classList.add('hidden'); modal.innerHTML = ''; };

    // 도착 위치 목록: 거점 → 캠프 → 창고(└ 구획). 출발지는 고를 수 없다
    toSel.innerHTML = locationOptionsHtml(state.locations, toLoc);
    [...toSel.options].forEach(o => { if (o.value === fromLoc) o.disabled = true; });
    if (!toLoc || toSel.value !== toLoc || toLoc === fromLoc) {
        toSel.insertAdjacentHTML('afterbegin', '<option value="" disabled>옮길 곳을 고르세요</option>');
        toSel.value = '';
    }

    const item = () => stockRows.find(i => i.code === (itemSel ? itemSel.value : stockRows[0].code));
    const total = () => Number(item().quantity) || 0;
    const mode = () => $('input[name="w3-m-mode"]:checked').value;
    const qty = () => (mode() === 'ALL' ? total() : Number(qtyInput.value));
    const toZone = () => zoneOf(toSel.value);
    const toHasCells = () => !!(toZone() && zoneCapacity(toZone()));
    const usesPallets = () => fromHasCells || toHasCells();
    const fromPallets = () => (fromHasCells ? itemPallets(fromZone, item().code) : 0);
    // 파렛트 수 제안: 전체량 = 그 품목 파렛트 모두, 일부량 = 수량 비율(최소 1), 출발지가 라인이 아니면 1
    const suggestPallets = () => {
        const have = fromPallets();
        if (!have) return 1;
        if (mode() === 'ALL') return have;
        const amount = qty();
        const share = total() > 0 && amount > 0 ? have * (amount / total()) : 1;
        return Math.min(have, Math.max(1, Math.round(share)));
    };
    // 일부량 처음 값: 여러 파렛트에 나뉜 품목이면 1파렛트 분량
    const onePalletQty = () => {
        const have = Math.ceil(fromPallets() - 1e-9);
        if (have <= 1) return '';
        const share = total() / have;
        return Number.isInteger(total()) ? Math.max(1, Math.floor(share)) : round3(share);
    };

    // 놓을 칸 목록: 받는 라인의 칸마다 빈 단 수 (가득 찬 칸은 고를 수 없다). 처음 고른 도착지일 때만 놓은 칸을 골라 둔다
    const fillSlots = () => {
        const tz = toZone();
        $('#w3-m-slot-row').classList.toggle('hidden', !toHasCells());
        if (!toHasCells()) { slotSel.innerHTML = ''; return; }
        const { slots, tiers } = zoneDims(tz);
        const { cells } = zoneCellMap(tz);
        const freeIn = (slot) => cells.slice(slot * tiers, slot * tiers + tiers).filter(c => !c).length;
        const wanted = toSel.value === toLoc && toSlot >= 0 && toSlot < slots && freeIn(toSlot) > 0 ? toSlot : -1;
        slotSel.innerHTML = `<option value="-1" ${wanted < 0 ? 'selected' : ''}>자동 — 빈 칸에 차례로</option>`
            + Array.from({ length: slots }, (_, slot) => {
                const free = freeIn(slot);
                return `<option value="${slot}" ${slot === wanted ? 'selected' : ''} ${free ? '' : 'disabled'}>${slot + 1}번 칸 · ${free ? `빈 단 ${free}/${tiers}` : '가득 참'}</option>`;
            }).join('');
    };

    let isPalletEdited = false;
    const refresh = () => {
        const it = item(), unit = it.unit || '', have = fromPallets();
        $('#w3-m-all').textContent = `${fmt(total())} ${unit}${have ? ` · ${fmt(have)}파렛트` : ''}`;
        $('#w3-m-unit').textContent = unit;
        qtyInput.max = String(total());
        $('#w3-m-pal-row').classList.toggle('hidden', !usesPallets());
        if (!isPalletEdited) palInput.value = String(suggestPallets());
        const tz = toZone(), cap = tz ? zoneCapacity(tz) : 0;
        if (cap) {
            const used = zonePallets(tz), free = Math.max(0, cap - used);
            const isOver = Number(palInput.value) > free;
            $('#w3-m-room').innerHTML = `${esc(tz.id)}: 지금 ${fmt(used)} / ${cap}칸 적재 · 빈 칸 ${fmt(free)}${isOver ? ' <b class="text-red-600">— 빈 칸보다 많아 칸 초과로 표시됩니다</b>' : ''}`;
        } else $('#w3-m-room').textContent = '';
        const to = toSel.value;
        $('#w3-m-note').textContent = !to ? ''
            : siteOf(to) === siteOf(fromLoc)
                ? `같은 거점(${siteOf(to)}) 안 이동이라 수불부·업무일지에는 기록되지 않고 입출고 이력에 남습니다.${buildingOf(to) ? '' : ' 창고를 정하지 않은 거점 위치로 옮깁니다.'}`
                : `거점이 바뀌는 이동(${siteOf(fromLoc)} → ${siteOf(to)})이라 수불부(이동출고·이동입고)와 업무일지 이동제품에도 기록됩니다.`;
    };

    const pickMode = (value) => { $(`input[name="w3-m-mode"][value="${value}"]`).checked = true; };
    modal.querySelectorAll('input[name="w3-m-mode"]').forEach(r => r.addEventListener('change', () => {
        if (mode() === 'PART' && !qtyInput.value) qtyInput.value = String(onePalletQty());
        refresh();
    }));
    qtyInput.addEventListener('focus', () => { pickMode('PART'); if (!qtyInput.value) qtyInput.value = String(onePalletQty()); refresh(); });
    qtyInput.addEventListener('input', () => { pickMode('PART'); refresh(); });
    palInput.addEventListener('input', () => { isPalletEdited = true; refresh(); });
    toSel.addEventListener('change', () => { fillSlots(); refresh(); });
    itemSel?.addEventListener('change', () => { qtyInput.value = ''; isPalletEdited = false; refresh(); });
    // 칸 하나를 끌어 왔고 그 품목이 여러 파렛트면, 끌어 온 파렛트 하나 분량을 먼저 권한다
    if (fromCell >= 0 && Math.ceil(fromPallets() - 1e-9) > 1) { pickMode('PART'); qtyInput.value = String(onePalletQty()); }
    fillSlots();
    refresh();

    $('#w3-m-cancel').onclick = close;
    okBtn.onclick = async () => {
        const it = item(), to = toSel.value, amount = qty();
        if (!to) { showToast('옮길 곳을 고르세요.'); toSel.focus(); return; }
        if (!(amount > 0) || amount > total() + 1e-9) { showToast(`수량을 확인하세요 (재고 ${fmt(total())} ${it.unit || ''}).`); qtyInput.focus(); return; }
        const pallets = usesPallets() ? Number(palInput.value) : null;
        if (pallets !== null && !(pallets >= 0)) { showToast('파렛트 수를 확인하세요.'); palInput.focus(); return; }
        const withSlip = $('#w3-m-slip').checked;
        writeSlipPref(withSlip);
        const job = { code: it.code, fromLoc, toLoc: to, qty: amount, pallets, fromCell, toSlot: toHasCells() ? Number(slotSel.value) : -1 };
        okBtn.disabled = true;
        okBtn.textContent = '옮기는 중…';
        try {
            let res;
            try { res = await transferStock({ ...job, withSlip }); } catch (e) {
                // 전표만 실패(오프라인 등)했으면 재고는 그대로다 — 전표 없이 옮길지 묻는다
                if (!e.slipFailed || !confirm(`${e.message}\n\n전표 없이 재고만 옮길까요?`)) throw e;
                res = await transferStock({ ...job, withSlip: false });
            }
            close();
            onDone({ ...res, code: it.code, name: it.name, qty: amount, unit: it.unit || '', pallets, fromLoc, toLoc: to });
        } catch (e) {
            showToast(`⚠️ ${e.message}`);
            okBtn.disabled = false;
            okBtn.textContent = '옮기기';
        }
    };
};

/** 옮긴 결과 한 줄 (알림·최근 이동 목록) */
export const moveResultText = (r) => `${r.name} ${fmt(r.qty)}${r.unit}${r.pallets ? ` (${fmt(r.pallets)}파렛트)` : ''} · ${routeText(r.fromLoc, r.toLoc)}`;
