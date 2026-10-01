// ==========================================
// 창고 배치도에서 재고 옮기기 + 창고간 이동전표(WT) 자동 발행 (components/Warehouse3D.js)
// ==========================================
// 순서: ① 전표 발행(번호 확정) → ② 재고 이동(processStockAction MOVE, 사유에 전표번호) → ③ 라인 파렛트 수 맞춤 → ④ 전표 출고 완료.
// · 전표는 서류이고 재고는 ②에서 바뀐다. ④로 '출고 완료'를 남겨야 그 전표가 출하 검수로 다시 처리(이중 이동)되거나
//   일일 생산계획 업무에 할 일로 올라가지 않는다 (planAuto.autoReflectOpen은 미출고 전표만 반영).
// · 같은 거점 안 이동은 수불부·업무일지에 기록되지 않고(입출고 이력만), 거점이 바뀌면 processStockAction이
//   수불부(이동출고·이동입고)와 업무일지 이동제품에 남긴다.
import { state, processStockAction, issueSlip, deleteSlip, markSlipShipped } from './db.js';
import { itemPallets, setZoneLoad, hasZoneLoad, savedZone, zoneCapacity, zoneIdOfLocation } from './warehouseZones.js';
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

const hasStockAt = (code, loc) => state.inventory.some(i => i.code === code && i.location === loc && Number(i.quantity) > 0);

// 파렛트 칸이 있는 라인인지 (칸이 없는 구획·창고에는 파렛트 수를 적지 않는다)
const hasCells = (zoneId) => { const zone = zoneId ? savedZone(zoneId) : null; return !!zone && zoneCapacity(zone) > 0; };

/**
 * 옮긴 뒤 라인 파렛트 수 맞추기: 받는 라인은 더하고, 보내는 라인은 뺀다.
 * 보내는 라인에 재고가 남으면 파렛트도 남는다(1파렛트에서 일부만 덜어 낸 경우) — 다 빠지면 0.
 * 보내는 라인에 기록이 없으면(재고가 있으면 1파렛트로 보는 기본 상태) 그대로 둔다.
 */
const adjustZoneLoads = async ({ code, fromLoc, toLoc, pallets, fromBefore, toHad }) => {
    const fromZone = zoneIdOfLocation(fromLoc);
    const toZone = zoneIdOfLocation(toLoc);
    if (hasCells(toZone)) await setZoneLoad(toZone, code, toHad + pallets);
    if (!hasCells(fromZone) || !hasZoneLoad(fromZone, code)) return;
    const remaining = hasStockAt(code, fromLoc) ? Math.max(fromBefore - pallets, Math.min(fromBefore, 1)) : 0;
    await setZoneLoad(fromZone, code, remaining);
};

/**
 * 재고 옮기기 (+ 창고간 이동전표 자동 발행)
 * @param {{ code: string, fromLoc: string, toLoc: string, qty: number, pallets?: number|null, withSlip?: boolean }} p
 *   pallets = 옮기는 파렛트 수 (null이면 라인 파렛트 기록을 건드리지 않음)
 * @returns {Promise<{ slip: { docNo: string }|null, offline: boolean, warnings: string[] }>}
 *   전표 발행에 실패하면 err.slipFailed = true인 Error를 던진다 (재고는 그대로 — 전표 없이 다시 부를 수 있음)
 */
export const transferStock = async ({ code, fromLoc, toLoc, qty, pallets = null, withSlip = true }) => {
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
    // 옮기기 전 파렛트 수 (받는 라인은 그 품목 재고가 이미 있을 때만 — 다 빠진 뒤 남은 옛 기록은 무시)
    const fromZone = zoneIdOfLocation(fromLoc);
    const toZone = zoneIdOfLocation(toLoc);
    const fromBefore = fromZone ? itemPallets({ id: fromZone }, code) : 0;
    const toHad = toZone && hasStockAt(code, toLoc) ? itemPallets({ id: toZone }, code) : 0;

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

    // ③ 라인 파렛트 수 · ④ 전표 출고 완료 — 재고는 이미 옮겼으므로 실패해도 알리기만 한다
    const warnings = [];
    if (palletCount !== null) {
        try { await adjustZoneLoads({ code, fromLoc, toLoc, pallets: palletCount, fromBefore, toHad }); }
        catch (e) { warnings.push(`재고는 옮겼지만 파렛트 수를 저장하지 못했습니다: ${e.message}`); }
    }
    if (slip) {
        try {
            await markSlipShipped(slip.docNo, [{ code, name, unit, qty: amount, scanned: amount, lots: [] }]);
            slip = { ...slip, shippedAt: slip.shippedAt || new Date().toISOString(), shippedBy: worker };
        } catch (e) {
            warnings.push(`전표 ${slip.docNo}에 출고 완료를 남기지 못했습니다 (${e.message}). 재고는 이미 옮겼으니 이 전표로 다시 출고 처리하지 마세요.`);
        }
    }
    return { slip, offline, warnings };
};
