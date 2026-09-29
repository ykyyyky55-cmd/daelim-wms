// ==========================================
// 안전재고 미달 → 구매요청서 자동 초안
// ==========================================
// 품목마스터 안전재고(safety)보다 창고 재고 합계(모든 위치)가 적은 **구매 대상** 품목(원료·부자재·소모품·기타)을 모아
// 구매요청서 초안을 연다. 완제품·원액은 사서 채우는 것이 아니라 생산하므로 뺀다 (생산요청서로).
// 수량 = 안전재고 − 현재고 (EA 등 개수 단위는 올림). 희망 공급처 = 품목마스터 거래처, 예상 단가 = 원료수불부 최근 입고 단가(원료만).
// 초안은 구매요청서 화면(ProductionRequest.js openDraft)이 받는다: window.__reqDraft. 같은 날 같은 초안으로 이미 등록했으면 그 요청서를 연다(sourceKey).
import { state, latestRawUnitPrice } from './db.js';
import { localDateStr } from './searchUtils.js';

const NOT_BOUGHT = ['완제품', '원액'];
const COUNT_UNITS = ['EA', 'BOX', 'SET', 'ROLL', 'PAIL', 'DRUM', 'TOTE', '개', '대'];

/** 안전재고 미달 구매 품목 [{ code, name, spec, unit, category, supplier, current, safety, need, price }] (부족량 큰 순) */
export const safetyShortages = () => {
    const stock = new Map();
    (state.inventory || []).forEach(i => stock.set(i.code, (stock.get(i.code) || 0) + (Number(i.quantity) || 0)));
    return state.master
        .filter(m => Number(m.safety) > 0 && !NOT_BOUGHT.includes(m.category))
        .map(m => {
            const current = Math.round((stock.get(m.code) || 0) * 1000) / 1000;
            const safety = Number(m.safety);
            let need = safety - current;
            const unit = m.unit || 'EA';
            if (COUNT_UNITS.includes(String(unit).toUpperCase()) || COUNT_UNITS.includes(unit)) need = Math.ceil(need);
            else need = Math.round(need * 1000) / 1000;
            const price = ['원료'].includes(m.category) ? (latestRawUnitPrice(m.code, m.name) || '') : '';
            return { code: m.code, name: m.name, spec: m.spec || '', unit, category: m.category, supplier: m.supplier && m.supplier !== '-' ? m.supplier : '', current, safety, need, price };
        })
        .filter(x => x.need > 0)
        .sort((a, b) => (b.need / b.safety) - (a.need / a.safety));
};

/**
 * 구매요청서 초안을 열고 구매요청서 화면으로 간다.
 * @param onSwitchTab 화면 전환 함수
 * @param codes 고른 품목코드만 (비우면 미달 전부)
 * @returns 초안에 넣은 품목 수 (0이면 열지 않음)
 */
export const openSafetyPurchaseDraft = (onSwitchTab, { codes = null, site = '김포' } = {}) => {
    const list = safetyShortages().filter(x => !codes || codes.includes(x.code));
    if (!list.length) return 0;
    const today = localDateStr();
    const due = new Date(); due.setDate(due.getDate() + 7);
    window.__reqDraft = {
        type: 'PURCH',
        source: { kind: 'safety' },
        draft: {
            reqDate: today, dueDate: localDateStr(due), site, urgent: list.some(x => x.current <= 0),
            partner: '안전재고 보충',
            reason: `안전재고 미달 자동 초안 (${list.length}품목, ${today} 창고 재고 기준). 수량 = 안전재고 − 현재고. 공급처·단가·수량을 확인하고 등록하세요.`,
            sourceKey: `SAFETY:${today}:${list.map(x => x.code).sort().join(',').slice(0, 200)}`,
            sourceText: list.map(x => `${x.name} (${x.code}) 현재고 ${x.current} / 안전재고 ${x.safety} ${x.unit} → ${x.need}`).join('\n'),
            lines: list.map(x => ({ code: x.code, name: x.name, spec: x.spec, qty: x.need, unit: x.unit, supplier: x.supplier, price: x.price, note: `현재고 ${x.current} / 안전 ${x.safety}` }))
        }
    };
    onSwitchTab('purchRequest');
    return list.length;
};
