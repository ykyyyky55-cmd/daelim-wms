// ==========================================
// 품목 적재 규격 — 품목이 파렛트에 어떤 포장으로 몇 개 실리는지 (창고 배치도 3D의 짐 모양 · 파렛트 수 계산)
// ==========================================
// 규격 = { type, cols, rows, layers, packQty }: 파렛트 한 단에 가로 cols × 세로 rows 개, layers 단, 포장 하나에 packQty(품목 단위 기준).
//   파렛트당 수량 = cols × rows × layers × packQty  (packQty 0 = 모름 → 파렛트 수를 계산하지 않는다)
// 사람이 정한 규격은 wms_item_pack_specs(supabase/auth/82_item_pack_specs.sql, 로컬 모드 daelim_pack_specs)에 품목마다 한 줄,
// 정하지 않은 품목은 품명·규격·단위·분류로 짐작한다(guessPackSpec — source 'NAME' 품명에서 읽음 / 'DEFAULT' 분류 기본값).
// 재고·수불부와는 무관한 표시용 자료다.
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';

/**
 * @typedef {{ type: string, cols: number, rows: number, layers: number, packQty: number }} PackSpec
 * @typedef {PackSpec & { source: 'SAVED'|'NAME'|'DEFAULT' }} ResolvedPackSpec
 */

const TABLE = 'wms_item_pack_specs';
const CACHE_KEY = 'daelim_pack_specs';
export const PACK_GRID_MAX = 12;  // 한 단의 가로·세로 최대 개수
export const PACK_LAYER_MAX = 12; // 최대 단 수

/**
 * 포장 종류와 기본 적재(국내 표준 파렛트 1,100 × 1,100mm 기준의 흔한 값 — 품목마다 고쳐 쓴다).
 * unitSize = 포장 하나의 크기 [가로, 세로, 높이] m (3D에서 파렛트 칸 크기에 맞춰 줄여 그린다), round = 원통
 */
export const PACK_TYPES = {
    DRUM: { name: '드럼 (200L)', short: '드럼', cols: 2, rows: 2, layers: 1, packQty: 200, unitSize: [0.58, 0.58, 0.88], round: true },
    PAIL: { name: '페일·캔 (18~20L)', short: '페일', cols: 4, rows: 4, layers: 3, packQty: 20, unitSize: [0.29, 0.29, 0.37], round: true },
    IBC: { name: 'IBC 토트 (1,000L)', short: 'IBC', cols: 1, rows: 1, layers: 1, packQty: 1000, unitSize: [1.0, 1.2, 1.0], round: false },
    BOX: { name: '박스', short: '박스', cols: 3, rows: 4, layers: 4, packQty: 0, unitSize: [0.36, 0.27, 0.26], round: false },
    BAG: { name: '포대 (20~25kg)', short: '포대', cols: 2, rows: 3, layers: 6, packQty: 25, unitSize: [0.5, 0.36, 0.14], round: false },
    BULK: { name: '벌크 (큰 상자·톤백 하나)', short: '벌크', cols: 1, rows: 1, layers: 1, packQty: 0, unitSize: [1.05, 1.05, 1.0], round: false },
    ROLL: { name: '롤 (라벨·필름)', short: '롤', cols: 3, rows: 3, layers: 2, packQty: 0, unitSize: [0.34, 0.34, 0.4], round: true }
};
export const isPackType = (type) => Object.prototype.hasOwnProperty.call(PACK_TYPES, type);

const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const clampInt = (v, lo, hi, def) => Math.min(hi, Math.max(lo, Math.round(num(v, def))));
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const myName = () => state.currentUser?.name || state.currentGlobalWorker || '';

/** 규격 값 정리 (모르는 종류는 null) */
export const cleanPackSpec = (raw) => {
    if (!raw || !isPackType(raw.type)) return null;
    const base = PACK_TYPES[raw.type];
    return {
        type: raw.type,
        cols: clampInt(raw.cols, 1, PACK_GRID_MAX, base.cols),
        rows: clampInt(raw.rows, 1, PACK_GRID_MAX, base.rows),
        layers: clampInt(raw.layers, 1, PACK_LAYER_MAX, base.layers),
        packQty: Math.max(0, num(raw.packQty, base.packQty))
    };
};
const specOfType = (type, more = {}) => cleanPackSpec({ ...PACK_TYPES[type], type, ...more });
const isCountUnit = (unit) => !/^(l|ℓ|kg|g|ml|리터)$/i.test(String(unit || '').trim());
/**
 * 포장 종류의 기본 적재 (적재 규격 창에서 포장을 바꿨을 때).
 * 개수 단위(EA 등) 품목은 포장 하나가 곧 1개다 — 드럼·페일·IBC·포대는 1, 박스·벌크·롤은 입수를 모르므로 0
 * @param {string} type PACK_TYPES의 키
 * @param {string} unit 품목 단위
 * @returns {PackSpec}
 */
export const defaultPackSpec = (type, unit) => {
    const spec = specOfType(type);
    if (!isCountUnit(unit)) return spec;
    return { ...spec, packQty: ['DRUM', 'PAIL', 'IBC', 'BAG'].includes(type) ? 1 : 0 };
};

// ---------- 저장된 규격 ----------
const readCache = () => {
    try {
        const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        return new Map(Object.entries(raw && typeof raw === 'object' ? raw : {}).map(([code, spec]) => [code, cleanPackSpec(spec)]).filter(([, spec]) => spec));
    } catch (e) {
        console.warn('적재 규격 캐시를 읽지 못했습니다.', e);
        return new Map();
    }
};
/** @type {Map<string, PackSpec>} 품목코드 → 사람이 정한 규격 */
let saved = readCache();
const writeCache = () => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(saved))); } catch (e) { console.warn('적재 규격 캐시 저장 실패', e); }
};

/** 저장된 규격 불러오기 (클라우드 → 로컬 모드는 기기) */
export const loadPackSpecs = async () => {
    const sb = cloud();
    if (!sb) { saved = readCache(); return saved; }
    const { data, error } = await sb.from(TABLE).select('code, data');
    if (error) throw new Error(`적재 규격을 불러오지 못했습니다: ${error.message}`);
    saved = new Map((data || []).map(r => [r.code, cleanPackSpec(r.data)]).filter(([, spec]) => spec));
    writeCache();
    return saved;
};

const writeError = (error) => new Error(/row-level security|permission/i.test(error.message)
    ? '적재 규격은 현장 작업자 이상만 저장할 수 있습니다.' : `적재 규격 저장 실패: ${error.message}`);

/** 품목의 적재 규격 저장 (spec이 null이면 저장한 규격을 지워 자동 짐작으로 되돌린다) */
export const savePackSpec = async (code, spec) => {
    const clean = spec ? cleanPackSpec(spec) : null;
    if (spec && !clean) throw new Error('포장 종류를 고르세요.');
    const sb = cloud();
    if (sb) {
        const { error } = clean
            ? await sb.from(TABLE).upsert({ code, data: clean, updated_by_name: myName(), updated_at: new Date().toISOString() })
            : await sb.from(TABLE).delete().eq('code', code);
        if (error) throw writeError(error);
    }
    if (clean) saved.set(code, clean); else saved.delete(code);
    writeCache();
};

/**
 * 품목 합치기 뒤: 합쳐진 품목의 규격을 기준 품목으로 옮긴다 (기준 품목에 규격이 있으면 그것을 두고 합쳐진 쪽은 지운다).
 * 표시용 자료라 실패해도 합치기는 그대로 둔다 — 부르는 쪽에서 경고만 남긴다.
 */
export const retargetPackSpec = async (fromCode, toCode) => {
    const spec = saved.get(fromCode);
    if (!spec) return;
    if (!saved.has(toCode)) await savePackSpec(toCode, spec);
    await savePackSpec(fromCode, null);
};

// ---------- 품명·규격으로 짐작 ----------
const VOLUME_RE = /(\d+(?:\.\d+)?)\s*(ml|㎖|l|ℓ|리터|kg|㎏)(?![a-z])/gi;
/** 품명·규격에 적힌 용량들 → [{ value, unit: 'L'|'KG' }] (mL은 L로) */
const volumesOf = (text) => [...text.matchAll(VOLUME_RE)].map((m) => {
    const unit = m[2].toLowerCase();
    if (unit === 'ml' || unit === '㎖') return { value: Number(m[1]) / 1000, unit: 'L' };
    return { value: Number(m[1]), unit: unit === 'kg' || unit === '㎏' ? 'KG' : 'L' };
});
/** 입수: '1L x 12' · '12개입' · '12EA/BOX' · '12입' → 12 (없으면 0) */
const perBoxOf = (raw) => {
    // 치수(405*285*295)는 입수가 아니다 — 먼저 뺀다
    const text = raw.replace(/\d{2,4}\s*[*×xX]\s*\d{2,4}(?:\s*[*×xX]\s*\d{2,4})?/g, ' ');
    const m = text.match(/[x×*]\s*(\d{1,3})\s*(?:ea|개|입|병|캔)?(?![\d.]|\s*(?:ml|l|kg|mm|cm))/i)
        || text.match(/(\d{1,3})\s*(?:개\s*입|입(?![가-힣])|ea\s*\/\s*(?:box|박스|bx))/i);
    const n = m ? Number(m[1]) : 0;
    return n >= 2 && n <= 200 ? n : 0;
};

/**
 * 품명·규격·단위·분류로 적재 규격을 짐작한다.
 * @param {{ name?: string, spec?: string, unit?: string, category?: string }} item
 * @returns {ResolvedPackSpec}
 */
export const guessPackSpec = (item) => {
    const text = `${item?.name || ''} ${item?.spec || ''}`.normalize('NFKC');
    const unit = String(item?.unit || '').trim().toUpperCase();
    const isCount = isCountUnit(unit);
    const volumes = volumesOf(text);
    // 포장 하나에 든 수량: 개수 단위 품목은 1(드럼 1개 = 1 EA), 부피·무게 단위 품목은 그 포장의 용량
    const qtyOf = (fallback, isMatch) => {
        if (isCount) return 1;
        const hit = volumes.find(v => v.unit === (unit === 'KG' ? 'KG' : 'L') && isMatch(v.value));
        return hit ? hit.value : fallback;
    };
    const named = (type, more) => ({ ...specOfType(type, more), source: 'NAME' });

    if (/IBC|토트|TOTE/i.test(text) || volumes.some(v => v.value >= 900 && v.value <= 1250)) return named('IBC', { packQty: qtyOf(1000, v => v >= 900 && v <= 1250) });
    if (/드럼|DRUM|D\/M/i.test(text) || volumes.some(v => v.value >= 160 && v.value <= 220)) return named('DRUM', { packQty: qtyOf(200, v => v >= 160 && v <= 220) });
    if (/포대|\bBAG\b|지대/i.test(text)) return named('BAG', { packQty: qtyOf(25, v => v >= 10 && v <= 30) });
    if (/페일|PAIL|P\/L|말통/i.test(text) || volumes.some(v => v.value >= 15 && v.value <= 25)) return named('PAIL', { packQty: qtyOf(20, v => v >= 15 && v <= 25) });
    if (/롤|ROLL/i.test(text) && /라벨|필름|테이프|LABEL|FILM/i.test(text)) return named('ROLL', { packQty: 0 });
    const perBox = isCount ? perBoxOf(text) : 0;
    if (perBox) {
        // 큰 병(3L 이상) 상자는 한 단에 3 × 3, 작은 병 상자는 3 × 4
        const isBigBottle = volumes.some(v => v.unit === 'L' && v.value >= 3);
        return named('BOX', { cols: 3, rows: isBigBottle ? 3 : 4, layers: 4, packQty: perBox });
    }
    // 품명에서 읽지 못함 → 분류 기본값 (수량은 모름: 모양만 그리고 파렛트 수는 계산하지 않는다)
    const category = item?.category || '';
    if ((category === '원료' || category === '원액') && !isCount) return { ...specOfType(category === '원액' ? 'IBC' : 'DRUM', { packQty: 0 }), source: 'DEFAULT' };
    return { ...specOfType('BOX', { packQty: 0 }), source: 'DEFAULT' };
};

const masterOf = (code) => (state.master || []).find(m => m.code === code) || null;

/**
 * 품목의 적재 규격: 사람이 정한 것 → 없으면 짐작
 * @param {string} code 품목코드
 * @param {{ name?: string, spec?: string, unit?: string, category?: string }} [fallback] 품목마스터에 없을 때 쓸 품목 정보(재고 줄)
 * @returns {ResolvedPackSpec}
 */
export const packSpecOf = (code, fallback = null) => {
    const own = saved.get(code);
    if (own) return { ...own, source: 'SAVED' };
    return guessPackSpec(masterOf(code) || fallback || {});
};
/** 사람이 정한 규격이 있는 품목인지 */
export const hasSavedPackSpec = (code) => saved.has(code);

/** 파렛트 한 장에 실리는 포장 수 */
export const packsPerPallet = (spec) => spec.cols * spec.rows * spec.layers;
/** 파렛트당 수량 (품목 단위 기준, 모르면 0) */
export const qtyPerPallet = (spec) => packsPerPallet(spec) * spec.packQty;
/**
 * 그 수량이 차지하는 파렛트 수 (올림). 파렛트당 수량을 모르면 0
 * — 분류 기본값으로 짐작한 규격(source DEFAULT)은 수량을 모르므로 늘 0이다.
 */
export const palletsForQty = (spec, quantity) => {
    const per = qtyPerPallet(spec);
    return per > 0 && quantity > 0 ? Math.ceil(quantity / per - 1e-9) : 0;
};
/**
 * 그 품목의 k번째(0부터) 파렛트에 실린 포장 수: 앞 파렛트는 가득, 마지막 파렛트는 남은 만큼.
 * 파렛트당 수량을 모르거나 재고가 파렛트 수보다 많으면 가득 실린 것으로 본다.
 * @param {ResolvedPackSpec|PackSpec} spec
 * @param {number} quantity 그 자리(구획)의 품목 재고
 * @param {number} k 몇 번째 파렛트
 * @param {number} n 그 품목의 파렛트 수
 */
export const packsOnPallet = (spec, quantity, k, n) => {
    const full = packsPerPallet(spec);
    if (!(spec.packQty > 0) || !(quantity > 0)) return full;
    const totalPacks = Math.ceil(quantity / spec.packQty - 1e-9);
    if (k < n - 1) return Math.min(full, totalPacks);
    return Math.min(full, Math.max(1, totalPacks - full * (n - 1)));
};

/** 내용물의 양을 그려 보이는 포장 (통) — IBC·드럼·페일 */
export const LIQUID_PACK_TYPES = ['IBC', 'DRUM', 'PAIL'];
/**
 * 그 품목의 k번째 파렛트 가운데 마지막 포장(통)에 든 양의 비율 (0~1, 가득이면 1).
 * 앞 파렛트·앞 통은 가득, 마지막 파렛트의 마지막 통만 남은 양이다 — 2,350 L를 IBC(1,000 L)에 담으면 셋째 통이 0.35.
 * 포장 하나에 든 수량을 모르는 통(분류 기본값으로 짐작한 원액 IBC 등)은 부피·무게 단위 품목이면 그 포장의 기본 용량(IBC 1,000 · 드럼 200 · 페일 20)으로 잰다.
 * 파렛트 수가 재고와 맞지 않으면(적어 둔 파렛트 수가 모자라거나 남음) 가득으로 본다.
 * @param {PackSpec} spec
 * @param {number} quantity 그 자리(구획)의 품목 재고
 * @param {number} k 몇 번째 파렛트
 * @param {number} n 그 품목의 파렛트 수
 * @param {string} [unit] 품목 단위
 */
export const lastPackFill = (spec, quantity, k, n, unit = '') => {
    if (!LIQUID_PACK_TYPES.includes(spec.type) || k !== n - 1 || !(quantity > 0)) return 1;
    const packQty = spec.packQty > 0 ? spec.packQty : (isCountUnit(String(unit).trim().toUpperCase()) ? 0 : PACK_TYPES[spec.type].packQty);
    if (!(packQty > 0)) return 1;
    const perPallet = packsPerPallet(spec) * packQty;
    const onLast = quantity - perPallet * (n - 1); // 마지막 파렛트에 실린 양
    if (!(onLast > 0) || onLast > perPallet + 1e-9) return 1;
    const rest = onLast - packQty * (Math.ceil(onLast / packQty - 1e-9) - 1);
    return Math.min(1, Math.max(0, rest / packQty));
};
// 빈 통 품목: 공토트(990001 · 990001-n) · 이름에 '공토트'·'공드럼'·'빈 드럼'·'빈 통' 같은 말
const EMPTY_CONTAINER_RE = /(^|[^가-힣])(공|빈)\s*(토트|tote|ibc|드럼|drum|페일|말통)|(^|[^가-힣])빈\s*(통|용기)/i;
/** 빈 통(공토트·공드럼) 품목인지 — 3D에서 내용물 없이 뚜껑만 초록으로 그린다 */
export const isEmptyContainer = (item) => /^990001(-\d+)?$/.test(String(item?.code || '').trim())
    || EMPTY_CONTAINER_RE.test(String(item?.name || '').normalize('NFKC'));

/** 한 줄 설명: '드럼 2×2 × 1단 = 4개 · 파렛트당 800 L' */
export const packSpecText = (spec, unit = '') => {
    const type = PACK_TYPES[spec.type];
    const per = qtyPerPallet(spec);
    return `${type.short} ${spec.cols}×${spec.rows} × ${spec.layers}단 = ${packsPerPallet(spec)}개${per ? ` · 파렛트당 ${per.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${unit}` : ''}`;
};
