// ==========================================
// 창고 배치도에서 재고 옮기기 + 창고간 이동전표(WT) 자동 발행 (components/Warehouse3D.js)
// ==========================================
// 순서: ① 전표 발행(번호 확정) → ② 재고 이동(processStockAction MOVE, 사유에 전표번호) → ③ 라인 칸 배치 저장 → ④ 전표 출고 완료.
// · 전표는 서류이고 재고는 ②에서 바뀐다. ④로 '출고 완료'를 남겨야 그 전표가 출하 검수로 다시 처리(이중 이동)되거나
//   일일 생산계획 업무에 할 일로 올라가지 않는다 (planAuto.autoReflectOpen은 미출고 전표만 반영).
// · 같은 거점 안 이동은 수불부·업무일지에 기록되지 않고(입출고 이력만), 거점이 바뀌면 processStockAction이
//   수불부(이동출고·이동입고)와 업무일지 이동제품에 남긴다.
// · ③ 칸 배치: 받는 라인은 놓은 칸(toSlot)부터 파렛트를 놓고, 보내는 라인은 끌어 온 칸(fromCell)의 파렛트부터 뺀다.
//   두 라인 모두 배치를 통째로 저장해(saveZoneCells) 다른 파렛트 자리가 밀리지 않는다. 같은 라인 안 자리 옮기기는 movePalletWithinZone.
// · 혼적(mixIndex): 받는 라인의 이미 파렛트가 놓인 칸에 함께 싣는다 — 첫 파렛트가 그 칸에 실리고 나머지는 빈 칸에 놓인다.
import { state, processStockAction, issueSlip, deleteSlip, markSlipShipped } from './db.js';
import { settleCells, itemPallets, savedZone, zoneCapacity, zoneDims, zoneIdOfLocation, loadZoneLoads, zoneCellMap, takePallets, putPallets, mixIntoCell, cellHas, saveZoneCells, slotLabel } from './warehouseZones.js';
import { siteOf, buildingOf, zoneInfo } from './locations.js';
import { localDateStr } from './searchUtils.js';

/** 위치 짧은 이름: "김포2A-03 3라인" · "본사1B" · "김포공장 (창고 미지정)" */
export const shortLocation = (loc) => {
    const building = buildingOf(loc);
    if (!building) return `${siteOf(loc)} (창고 미지정)`;
    const zoneName = zoneInfo(building)?.name;
    return zoneName ? `${building} ${zoneName}` : building;
};

/** 이동 경로 글자 (거점이 바뀌면 거점 이름도) */
export const routeText = (fromLoc, toLoc) => {
    const isSameSite = siteOf(fromLoc) === siteOf(toLoc);
    const place = (loc) => (isSameSite || !buildingOf(loc) ? shortLocation(loc) : `${siteOf(loc)} ${shortLocation(loc)}`);
    return `${place(fromLoc)} → ${place(toLoc)}`;
};

/** 칸 이름: "3번 칸 2단" (한 단짜리 라인은 "3번 칸", 줄이 여럿이면 "2줄 3번 칸 2단") */
export const cellLabel = (zone, index) => {
    const { tiers } = zoneDims(zone);
    return `${slotLabel(zone, Math.floor(index / tiers))}${tiers > 1 ? ` ${(index % tiers) + 1}단` : ''}`;
};

const hasStockAt = (code, loc) => state.inventory.some(i => i.code === code && i.location === loc && Number(i.quantity) > 0);
const cellCount = (pallets) => Math.ceil(Number(pallets) - 1e-9);
// 파렛트 칸이 있는 라인 (칸이 없는 구획·창고에는 파렛트 수·칸을 적지 않는다)
const zoneWithCells = (loc) => { const zone = savedZone(zoneIdOfLocation(loc)); return zone && zoneCapacity(zone) > 0 ? zone : null; };
// 라인 배치는 통째로 저장하므로, 다른 기기에서 바꾼 칸을 덮어쓰지 않게 옮기기 직전에 적재 기록을 다시 받는다 (오프라인이면 이 기기 기록으로)
const refreshLoads = async () => {
    try { await loadZoneLoads(); } catch (e) { console.warn('[창고 배치도] 적재 기록을 새로 받지 못했습니다:', e.message); }
};

/**
 * 옮긴 뒤 두 라인의 칸 배치 저장 (before = 옮기기 전에 떠 둔 배치·파렛트 수).
 * 받는 라인: 놓은 칸부터 늘어난 파렛트만큼 놓는다. 보내는 라인: 끌어 온 칸의 파렛트부터 뺀다 —
 * 재고가 남으면 파렛트도 하나는 남고(1파렛트에서 일부만 덜어 낸 경우), 다 빠지면 기록을 지운다.
 * @returns {Promise<number[]>} 받는 라인에서 파렛트가 놓인 칸 번호
 */
const saveCellLayouts = async ({ pallet, pallets, fromLoc, fromCell, toSlot, mixIndex, before }) => {
    const { code } = pallet;
    let placed = [];
    if (before.toZone) {
        const total = before.toHad + pallets;
        let added = Math.max(0, cellCount(total) - cellCount(before.toHad));
        // 혼적: 첫 파렛트를 고른 칸의 파렛트에 함께 싣는다 (그 칸이 비었거나 같은 품목이 이미 실려 있으면 빈 칸에 따로 놓는다)
        const mixed = added > 0 && mixIndex >= 0 ? mixIntoCell(before.toCells, pallet, mixIndex) : null;
        if (mixed) added -= 1;
        const put = putPallets(before.toZone, mixed || before.toCells, pallet, added, toSlot);
        placed = [...(mixed ? [mixIndex] : []), ...put.placed];
        await saveZoneCells(before.toZone, put.cells, { [code]: total });
    }
    if (before.fromZone) {
        const remaining = hasStockAt(code, fromLoc) ? Math.max(before.fromHad - pallets, Math.min(before.fromHad, 1)) : null;
        const onCells = before.fromCells.filter(c => cellHas(c, code)).length;
        const taken = Math.max(0, onCells - (remaining === null ? 0 : cellCount(remaining)));
        await saveZoneCells(before.fromZone, takePallets(before.fromZone, before.fromCells, code, taken, fromCell), { [code]: remaining });
    }
    return placed;
};

/**
 * 재고 옮기기 (+ 창고간 이동전표 자동 발행)
 * @param {{ code: string, fromLoc: string, toLoc: string, qty: number, pallets?: number|null, withSlip?: boolean, fromCell?: number, toSlot?: number, mixIndex?: number }} p
 *   mixIndex = 혼적할 칸 번호 — 받는 라인의 그 칸 파렛트에 함께 싣는다 (-1이면 따로 놓음)
 *   pallets = 옮기는 파렛트 수 (null이면 라인 칸 배치를 건드리지 않음)
 *   fromCell = 끌어 온 칸 번호 (그 칸의 파렛트부터 뺀다, 없으면 -1)
 *   toSlot = 놓을 칸 — 채우는 쪽에서 센 칸(0부터), -1이면 빈 칸에 차례로
 * @returns {Promise<{ slip: { docNo: string }|null, offline: boolean, warnings: string[], placed: number[] }>}
 *   placed = 받는 라인에서 파렛트가 놓인 칸 번호.
 *   전표 발행에 실패하면 err.slipFailed = true인 Error를 던진다 (재고는 그대로 — 전표 없이 다시 부를 수 있음)
 */
export const transferStock = async ({ code, fromLoc, toLoc, qty, pallets = null, withSlip = true, fromCell = -1, toSlot = -1, mixIndex = -1 }) => {
    const amount = Number(qty);
    if (!code) throw new Error('옮길 품목을 고르세요.');
    if (!fromLoc || !toLoc) throw new Error('옮길 곳을 고르세요.');
    if (fromLoc === toLoc) throw new Error('출발지와 도착지가 같습니다.');
    const inv = state.inventory.find(i => i.code === code && i.location === fromLoc);
    if (!inv || !(amount > 0) || amount > Number(inv.quantity) + 1e-9) throw new Error('옮길 수량을 확인하세요 (출발지 재고보다 많거나 0입니다).');

    const master = state.master.find(m => m.code === code);
    const name = inv.name || master?.name || code;
    const unit = inv.unit || master?.unit || 'EA';
    const worker = state.currentGlobalWorker || state.currentUser?.name || '';
    const palletCount = pallets === null || pallets === '' || !Number.isFinite(Number(pallets)) ? null : Math.max(0, Number(pallets));
    const route = routeText(fromLoc, toLoc);
    // 옮기기 전 칸 배치·파렛트 수 (받는 라인은 그 품목 재고가 이미 있을 때만 — 다 빠진 뒤 남은 옛 기록은 무시)
    const fromZone = zoneWithCells(fromLoc);
    const toZone = zoneWithCells(toLoc);
    if (palletCount !== null && (fromZone || toZone)) await refreshLoads();
    const before = {
        fromZone, toZone,
        fromCells: fromZone ? zoneCellMap(fromZone).cells : null,
        toCells: toZone ? zoneCellMap(toZone).cells : null,
        fromHad: fromZone ? itemPallets(fromZone, code) : 0,
        toHad: toZone && hasStockAt(code, toLoc) ? itemPallets(toZone, code) : 0
    };

    // ① 전표 발행
    let slip = null;
    if (withSlip) {
        const spec = master?.spec && master.spec !== '-' ? master.spec : '';
        try {
            slip = await issueSlip({
                type: 'WAREHOUSE', date: localDateStr(), fromLoc, toLoc, partner: '',
                transport: siteOf(fromLoc) === siteOf(toLoc) ? '지게차' : '사내 차량',
                reason: '창고 배치도에서 옮김 (재고 이동 완료)', worker,
                items: [{ code, name, spec, unit, qty: amount, note: palletCount ? `${palletCount}파렛트` : '' }]
            });
        } catch (e) {
            const err = new Error(`창고간 이동전표를 발행하지 못했습니다: ${e.message}`);
            err.slipFailed = true;
            throw err;
        }
    }

    // ② 재고 이동
    let offline = false;
    try {
        const res = await processStockAction({
            type: 'MOVE', code, qty: amount, fromLoc, toLoc, worker,
            reason: `창고 배치도 이동 ${route}${slip ? ` [전표 ${slip.docNo}]` : ''}`
        });
        offline = !!res.offline;
    } catch (e) {
        let kept = '';
        if (slip) {
            // 전표 삭제는 매니저 이상만 된다 — 못 지우면 미출고 전표로 남는다
            try { await deleteSlip(slip.docNo); } catch (delErr) {
                console.warn('[창고 배치도] 전표 삭제 실패:', delErr.message);
                kept = ` 발행된 전표 ${slip.docNo}는 지우지 못해 미출고 상태로 남았습니다 — 전표관리에서 확인하세요.`;
            }
        }
        throw new Error(`재고를 옮기지 못했습니다: ${e.message}${kept}`);
    }

    // ③ 라인 칸 배치 · ④ 전표 출고 완료 — 재고는 이미 옮겼으므로 실패해도 알리기만 한다
    const warnings = [];
    let placed = [];
    if (palletCount !== null) {
        const pallet = { code, name, category: inv.category || master?.category || '', k: 0, n: 1 };
        try { placed = await saveCellLayouts({ pallet, pallets: palletCount, fromLoc, fromCell, toSlot, mixIndex, before }); }
        catch (e) { warnings.push(`재고는 옮겼지만 칸 위치를 저장하지 못했습니다: ${e.message}`); }
    }
    if (slip) {
        try {
            await markSlipShipped(slip.docNo, [{ code, name, unit, qty: amount, scanned: amount, lots: [] }]);
            slip = { ...slip, shippedAt: slip.shippedAt || new Date().toISOString(), shippedBy: worker };
        } catch (e) {
            warnings.push(`전표 ${slip.docNo}에 출고 완료를 남기지 못했습니다 (${e.message}). 재고는 이미 옮겼으니 이 전표로 다시 출고 처리하지 마세요.`);
        }
    }
    return { slip, offline, warnings, placed };
};

/** 그 칸의 파렛트를 통째로 들어낸 뒤의 배치 (바닥 적재는 위 파렛트가 내려온다) */
const settleCellsAfterLift = (zone, cells, index) => {
    const next = cells.slice();
    next[index] = null;
    return settleCells(zone, next);
};

/**
 * 같은 라인 안에서 한 품목을 다른 칸의 파렛트에 함께 싣는다(혼적) 또는 혼적 파렛트에서 따로 떼어 빈 칸에 놓는다.
 * 같은 위치라 재고·전표·이력은 바뀌지 않는다.
 * @param {object} zone 구획 줄 (칸이 있는 라인)
 * @param {number} fromIndex 그 품목이 실린 칸 번호
 * @param {string} code 옮길 품목코드
 * @param {number} toIndex 함께 실을 칸 번호 (-1이면 혼적을 풀어 빈 칸에 따로 놓는다)
 * @returns {Promise<number>} 그 품목이 놓인 칸 번호
 */
export const remixWithinZone = async (zone, fromIndex, code, toIndex = -1) => {
    await refreshLoads();
    const { cells } = zoneCellMap(zone);
    const pallet = [cells[fromIndex], ...(cells[fromIndex]?.mix || [])].find(p => p?.code === code);
    if (!pallet) throw new Error('그 칸의 파렛트가 바뀌었습니다 (다른 기기에서 옮겼을 수 있습니다). 화면을 다시 확인하세요.');
    if (fromIndex === toIndex) throw new Error('같은 칸입니다.');
    const lifted = takePallets(zone, cells, code, 1, fromIndex);
    if (toIndex < 0) {
        const put = putPallets(zone, lifted, pallet, 1, -1);
        if (!put.placed.length) throw new Error('빈 칸이 없어 따로 놓을 수 없습니다.');
        await saveZoneCells(zone, put.cells);
        return put.placed[0];
    }
    // 들어낸 뒤 바닥 적재의 파렛트가 내려와 칸 번호가 바뀔 수 있다 — 실을 파렛트를 품목으로 다시 찾는다
    const host = cells[toIndex];
    const at = host ? lifted.findIndex(c => c && c.code === host.code && c.k === host.k) : -1;
    const mixed = at >= 0 ? mixIntoCell(lifted, pallet, at) : null;
    if (!mixed) throw new Error('그 칸에는 함께 실을 수 없습니다 (빈 칸이거나 같은 품목이 이미 실려 있습니다).');
    await saveZoneCells(zone, mixed);
    return at;
};

/**
 * 같은 라인 안에서 파렛트 하나의 칸만 옮긴다 (같은 위치라 재고·전표·이력은 바뀌지 않는다).
 * 바닥 적재 라인은 빼낸 자리 위의 파렛트가 내려오고, 옮긴 파렛트는 그 칸의 가장 아래 빈 단에 놓인다.
 * @param {object} zone 구획 줄 (칸이 있는 라인)
 * @param {number} fromIndex 옮길 파렛트의 칸 번호
 * @param {number} toSlot 놓을 칸 — 채우는 쪽에서 센 칸(0부터)
 * @param {string} code 화면에서 끌어 온 파렛트의 품목코드 (그 사이 다른 기기에서 배치가 바뀌었는지 확인)
 * @returns {Promise<number>} 옮겨 놓인 칸 번호
 */
export const movePalletWithinZone = async (zone, fromIndex, toSlot, code) => {
    const { tiers } = zoneDims(zone);
    await refreshLoads();
    const { cells } = zoneCellMap(zone);
    const pallet = cells[fromIndex];
    if (!pallet || pallet.code !== code) throw new Error('그 칸의 파렛트가 바뀌었습니다 (다른 기기에서 옮겼을 수 있습니다). 화면을 다시 확인하세요.');
    if (Math.floor(fromIndex / tiers) === toSlot) throw new Error('같은 칸입니다.');
    // 혼적 파렛트는 함께 실린 품목까지 통째로 옮긴다 (칸을 비우고 그 파렛트를 그대로 놓는다)
    const lifted = settleCellsAfterLift(zone, cells, fromIndex);
    const put = putPallets(zone, lifted, pallet, 1, toSlot);
    // putPallets는 그 칸이 차 있으면 다음 칸에 놓는다 — 고른 칸에 못 놓았으면 옮기지 않는다
    if (!put.placed.length || Math.floor(put.placed[0] / tiers) !== toSlot) throw new Error('그 칸은 가득 찼습니다.');
    await saveZoneCells(zone, put.cells);
    return put.placed[0];
};
