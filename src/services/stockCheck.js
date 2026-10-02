// ==========================================
// 수불부 ↔ 창고 재고 차이 점검 (재고·수불 › 재고 차이 점검, components/StockCheck.js)
// ==========================================
// 같은 품목·거점에서 수불부의 최종 재고(수불일자순 마지막 전표의 재고)와 창고 재고(모든 위치 합, 거점 단위)를 비교한다.
//   · 제품·자재: 품목코드 + 거점(본사·김포공장) — 제품수불부·자재수불부 stockQty
//   · 원료·원액: 품목코드(없으면 원료명) + 원료수불부 지역(김포·본사) — 창고 재고는 비중으로 L 환산(toRawLedgerLiters)
// 차이 = 창고 재고 − 수불부 재고. [수불부를 창고 재고에 맞추기]는 오늘 날짜 조정 전표(제품·자재 '재고조사', 원료 '조정')를 넣는다.
// 창고 재고는 바꾸지 않는다 (창고가 틀렸으면 재고실사로 맞춘다).
import { state, ledgerKindOfCategory, addItemLedgerEntries, addRawLedgerEntries, latestRawSg, toRawLedgerLiters } from './db.js';
import { siteOf, rawLedgerRegionOf } from './locations.js';
import { localDateStr } from './searchUtils.js';

const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const KIND_LABEL = { raw: '원료', product: '제품', material: '자재' };
export const STOCK_KINDS = KIND_LABEL;

// 일자순 마지막 전표 (같은 날짜는 뒤에 입력한 것)
const lastByKey = (ledger, keyOf) => {
    const m = new Map();
    ledger.map((e, i) => [e, i]).sort((a, b) => (a[0].date || '').localeCompare(b[0].date || '') || a[1] - b[1]).forEach(([e]) => m.set(keyOf(e), e));
    return m;
};

/** 비교 결과 [{ key, kind, code, name, loc, unit, ledger, inv, diff, lastDate, onlyLedger, onlyInv, sg }] */
export const computeStockDiff = () => {
    const masterBy = new Map(state.master.map(m => [m.code, m]));
    const out = new Map();
    const row = (key, base) => { if (!out.has(key)) out.set(key, { key, ledger: 0, inv: 0, lastDate: '', hasLedger: false, hasInv: false, ...base }); return out.get(key); };

    // 제품·자재 수불부
    for (const kind of ['product', 'material']) {
        lastByKey(state[kind === 'product' ? 'productLedger' : 'materialLedger'] || [], e => `${e.code}___${e.location}`).forEach(e => {
            const m = masterBy.get(e.code);
            const r = row(`${kind}:${e.code}@${e.location}`, { kind, code: e.code, name: m?.name || e.name, loc: e.location, unit: e.unit || m?.unit || 'EA' });
            r.ledger = r3(e.stockQty); r.lastDate = e.date; r.hasLedger = true;
        });
    }
    // 원료수불부 (지역별 마지막 전표)
    const rawKeyOf = (code, name) => code || `NAME:${name}`;
    lastByKey(state.rawLedger || [], e => `${rawKeyOf(e.code, e.name)}___${e.location || '김포'}`).forEach(e => {
        const k = rawKeyOf(e.code, e.name);
        const m = e.code ? masterBy.get(e.code) : state.master.find(x => x.name === e.name);
        const r = row(`raw:${k}@${e.location || '김포'}`, { kind: 'raw', code: e.code || m?.code || '', name: e.name, loc: e.location || '김포', unit: 'L', rawName: e.name });
        r.ledger = r3(r.ledger + Number(e.stockQty)); // 같은 코드에 원료명이 둘이면 합친다
        if ((e.date || '') > r.lastDate) r.lastDate = e.date;
        r.hasLedger = true;
    });

    // 창고 재고
    (state.inventory || []).forEach(i => {
        const q = Number(i.quantity) || 0;
        if (!q) return;
        const m = masterBy.get(i.code);
        const kind = ledgerKindOfCategory(m?.category || i.category);
        if (kind === 'raw') {
            const region = rawLedgerRegionOf(i.location);
            let key = `raw:${i.code}@${region}`;
            if (!out.has(key) && m) { const byName = `raw:NAME:${m.name}@${region}`; if (out.has(byName)) key = byName; }
            const sg = latestRawSg(i.code, m?.name);
            const L = toRawLedgerLiters(q, m?.unit || i.unit, sg).qty;
            const r = row(key, { kind, code: i.code, name: m?.name || i.name, loc: region, unit: 'L' });
            r.inv = r3(r.inv + L); r.hasInv = true; r.sg = sg;
        } else {
            const loc = siteOf(i.location);
            const r = row(`${kind}:${i.code}@${loc}`, { kind, code: i.code, name: m?.name || i.name, loc, unit: m?.unit || i.unit || 'EA' });
            r.inv = r3(r.inv + q); r.hasInv = true;
        }
    });
    return [...out.values()].map(r => ({ ...r, diff: r3(r.inv - r.ledger), onlyLedger: r.hasLedger && !r.hasInv, onlyInv: r.hasInv && !r.hasLedger }))
        .filter(r => r.ledger !== 0 || r.inv !== 0);
};

/**
 * 고른 줄의 수불부를 창고 재고에 맞춘다 (오늘 날짜 조정 전표)
 * @returns {{ raw: number, product: number, material: number }}
 */
export const alignLedgerToInventory = async (rows) => {
    const today = localDateStr();
    const by = { raw: [], product: [], material: [] };
    rows.filter(r => Math.abs(r.diff) > 0).forEach(r => {
        const inQty = r.diff > 0 ? r.diff : 0, outQty = r.diff < 0 ? -r.diff : 0;
        const common = { date: today, inQty, outQty, notes: '창고 재고와 맞춤 (재고 차이 점검)', remark: `수불부 ${r.ledger} → 창고 ${r.inv} ${r.unit}`, worker: state.currentGlobalWorker || state.currentUser?.name || '' };
        if (r.kind === 'raw') by.raw.push({ ...common, code: r.code, name: r.rawName || r.name, location: r.loc, type: '조정', sg: r.sg || latestRawSg(r.code, r.rawName || r.name) });
        else by[r.kind].push({ ...common, code: r.code, name: r.name, location: r.loc, unit: r.unit, type: '재고조사' });
    });
    if (by.raw.length) await addRawLedgerEntries(by.raw);
    if (by.product.length) await addItemLedgerEntries('product', by.product);
    if (by.material.length) await addItemLedgerEntries('material', by.material);
    return { raw: by.raw.length, product: by.product.length, material: by.material.length };
};
