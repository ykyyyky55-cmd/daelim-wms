// ==========================================
// 혼합물의 유해성·위험성 분류 (고용노동부고시 별표 1 — 구성성분의 유해성 자료로 분류하는 방법)
// ==========================================
// 화면·저장소와 무관한 순수 계산이다 (Node로도 점검할 수 있다).
// · 건강·환경 유해성: 별표 1 제3장·제4장의 '혼합물의 분류 3) 구성성분의 유해성 평가자료가 있는 경우' — 가산식(급성 독성),
//   가산 방식(피부·눈), 한계농도(과민성·변이원성·발암성·생식독성·표적장기 독성), 합산(흡인·수생환경)
// · 물리적 위험성: 혼합물 전체의 시험값으로 정한다(제12조) — 인화성 액체는 인화점·초기 끓는점으로 자동 판정, 그 밖은 직접 지정
// · 경고표지 항목(그림문자·신호어·문구): 별표 2 + 제6조의2(그림문자·신호어 우선순위, 중복 문구 생략)
// 혼합물 전체로 시험한 자료나 가교 원리로 정한 분류가 있으면 overrides로 그 분류를 직접 지정한다(시험 자료가 우선 — 별표 1 1.2).
import { GHS_CLASSES, classOf, catOf, clsLabel, hText, pText, INH_FORMS } from './ghsTables.js';

/**
 * @typedef {Object} ClsEntry 분류 한 줄
 * @property {string} c 분류 key (GHS_CLASSES)
 * @property {string} k 구분 key
 * @property {'GAS'|'VAPOR'|'DUST'} [form] 급성 독성(흡입)의 형태
 */
/**
 * @typedef {Object} MixComponent 구성성분
 * @property {string} [cas]
 * @property {string} name
 * @property {number} pct 함유량 (중량 %)
 * @property {ClsEntry[]} cls 그 성분의 분류
 * @property {{ oral?: number, dermal?: number, gas?: number, vapor?: number, dust?: number }} [ate] 급성독성 추정값 (LD50 mg/kg, LC50 ppmV·mg/L)
 * @property {{ acute?: number, chronic?: number }} [m] 수생환경 곱셈계수 M (없으면 1)
 * @property {boolean} [unknown] 유해성 자료가 없는(급성 독성을 모르는) 성분
 * @property {boolean} [nonAdditive] 가산 방식을 적용할 수 없는 성분 (강산·강염기·무기염류·알데히드류·페놀류·계면활성제 등)
 */
/**
 * @typedef {Object} MixProps 혼합물(제품)의 성질·지정값
 * @property {'LIQUID'|'SOLID'|'GAS'} [state]
 * @property {number|null} [flashPoint] 인화점 ℃
 * @property {number|null} [boilingPoint] 초기 끓는점 ℃
 * @property {number|null} [kv40] 40℃ 동점도 mm²/s
 * @property {number|null} [ph]
 * @property {ClsEntry[]} [physManual] 직접 지정한 물리적 위험성
 * @property {Object<string, { k: string, reason?: string }>} [overrides] 분류 직접 지정 (k = 구분, 여러 개는 쉼표, 'NONE' = 분류 안 함)
 * @property {Object<string, string>} [organs] 표적장기 (STOT_SE·STOT_RE)
 */
/**
 * @typedef {Object} MixClass 혼합물의 분류 결과 한 줄
 * @property {string} c
 * @property {string} k
 * @property {string} [form]
 * @property {string} basis 판정 근거
 * @property {'CALC'|'PROP'|'MANUAL'|'OVERRIDE'} source 계산 / 제품 성질(인화점 등) / 직접 지정(물리적) / 직접 지정(시험 자료 등)
 */

const num = (v) => { const n = Number(v); return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null; };
const fmt = (n) => {
    if (!Number.isFinite(n)) return '-';
    const a = Math.abs(n);
    const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 3 : 5;
    return String(Number(n.toFixed(d)));
};
const pctText = (n) => `${fmt(n)}%`;
const sum = (list) => list.reduce((s, x) => s + x, 0);

/** 성분이 그 분류에서 가진 구분들 */
const catsOf = (comp, c) => (comp.cls || []).filter(e => e.c === c).map(e => String(e.k));
const hasCat = (comp, c, ks) => catsOf(comp, c).some(k => ks.includes(k));
const named = (comps) => comps.map(x => `${x.name || x.cas || '성분'} ${pctText(x.pct)}`).join(', ');

// ---------- 급성 독성 (별표 1 3.1) ----------
/** 경로별 구분 기준(상한)과 구분 → 변환된 급성독성 추정치 */
export const ACUTE_ROUTES = {
    oral: { c: 'ACUTE_ORAL', label: '경구', unit: 'mg/kg', limits: [5, 50, 300, 2000], conv: [0.5, 5, 100, 500] },
    dermal: { c: 'ACUTE_DERMAL', label: '경피', unit: 'mg/kg', limits: [50, 200, 1000, 2000], conv: [5, 50, 300, 1100] },
    gas: { c: 'ACUTE_INH', form: 'GAS', label: '흡입(가스)', unit: 'ppmV', limits: [100, 500, 2500, 20000], conv: [10, 100, 700, 4500] },
    vapor: { c: 'ACUTE_INH', form: 'VAPOR', label: '흡입(증기)', unit: 'mg/L', limits: [0.5, 2, 10, 20], conv: [0.05, 0.5, 3, 11] },
    dust: { c: 'ACUTE_INH', form: 'DUST', label: '흡입(분진/미스트)', unit: 'mg/L', limits: [0.05, 0.5, 1, 5], conv: [0.005, 0.05, 0.5, 1.5] }
};

/** 급성독성 추정값(ATE) → 구분 ('' = 분류 안 됨) */
export const acuteCategory = (route, ate) => {
    const cfg = ACUTE_ROUTES[route];
    if (!cfg || !(ate > 0)) return '';
    const i = cfg.limits.findIndex(limit => ate <= limit);
    return i < 0 ? '' : String(i + 1);
};

/** 흡입 분류에 형태가 없을 때: 제품 상태로 짐작 (액체 → 증기, 고체 → 분진/미스트, 기체 → 가스) */
const defaultForm = (state) => (state === 'GAS' ? 'GAS' : state === 'SOLID' ? 'DUST' : 'VAPOR');

/**
 * 한 경로의 혼합물 급성독성 추정값 — [공식 1] 100/ATEmix = Σ Ci/ATEi, 급성 독성을 모르는 성분이 10%를 넘으면 [공식 2] (100 − C미상)/ATEmix
 * @returns {{ route: string, ateMix: number|null, cat: string, unknownPct: number, terms: Array<{ name: string, pct: number, ate: number, from: string }> }}
 */
const acuteForRoute = (route, comps, state) => {
    const cfg = ACUTE_ROUTES[route];
    const terms = [];
    comps.forEach(comp => {
        if (!(comp.pct > 0) || comp.unknown) return;
        const value = num(comp.ate?.[route]);
        // 성분의 구분: 분류에 적힌 구분, 없으면 실측값으로 정한 구분
        const listed = (comp.cls || []).filter(e => e.c === cfg.c && (!cfg.form || (e.form || defaultForm(state)) === cfg.form)).map(e => Number(e.k)).filter(k => k >= 1 && k <= 4);
        const k = listed.length ? Math.min(...listed) : Number(acuteCategory(route, value) || 0);
        if (!k) return; // 이 경로로 분류되지 않는 성분(급성 독성이 없다고 보는 성분)은 식에서 뺀다
        const lower = k > 1 ? cfg.limits[k - 2] : 0, upper = cfg.limits[k - 1];
        const isMeasured = value !== null && value > lower && value <= upper;
        terms.push({ name: comp.name || comp.cas || '성분', pct: comp.pct, ate: isMeasured ? value : cfg.conv[k - 1], from: isMeasured ? '시험값' : `구분 ${k} 변환값` });
    });
    const unknownPct = sum(comps.filter(c => c.unknown && c.pct > 0).map(c => c.pct));
    const total = sum(terms.map(t => t.pct / t.ate));
    if (!(total > 0)) return { route, ateMix: null, cat: '', unknownPct, terms };
    const ateMix = (unknownPct > 10 ? 100 - unknownPct : 100) / total;
    return { route, ateMix, cat: acuteCategory(route, ateMix), unknownPct, terms };
};

// ---------- 본 계산 ----------
/**
 * 구성성분으로 혼합물의 분류를 정한다.
 * @param {MixComponent[]} components
 * @param {MixProps} [props]
 * @returns {{ classes: MixClass[], notes: Array<{ level: 'warn'|'info', text: string }>, ate: ReturnType<typeof acuteForRoute>[], totalPct: number, unknownPct: number }}
 */
export const classifyMixture = (components, props = {}) => {
    const comps = (components || []).map(c => ({ ...c, pct: Math.max(0, Number(c.pct) || 0), cls: Array.isArray(c.cls) ? c.cls : [] })).filter(c => c.pct > 0 || c.name || c.cas);
    const state = props.state || 'LIQUID';
    /** @type {MixClass[]} */
    const classes = [];
    const notes = [];
    const add = (c, k, basis, extra = {}) => classes.push({ c, k: String(k), basis, source: 'CALC', ...extra });
    const warn = (text) => notes.push({ level: 'warn', text });
    const info = (text) => notes.push({ level: 'info', text });
    const withCat = (c, ks) => comps.filter(x => x.pct > 0 && hasCat(x, c, ks));
    const sumOf = (list) => sum(list.map(x => x.pct));

    const totalPct = sumOf(comps);
    const unknownPct = sumOf(comps.filter(c => c.unknown));
    if (comps.length && Math.abs(totalPct - 100) > 0.5) warn(`구성성분 함유량의 합이 ${pctText(totalPct)}입니다 (100%가 되어야 합니다).`);
    if (unknownPct > 0) info(`유해성 자료가 없는 성분이 ${pctText(unknownPct)} 들어 있습니다${unknownPct > 10 ? ' — 급성 독성은 [공식 2]로 계산했고, 급성 독성을 모르는 성분의 함량을 MSDS에 따로 적어야 합니다' : ''}.`);

    // ----- 물리적 위험성 -----
    const fp = num(props.flashPoint), bp = num(props.boilingPoint);
    if (state === 'LIQUID' && fp !== null) {
        if (fp < 23) {
            const k = bp !== null && bp <= 35 ? '1' : '2';
            add('FLAM_LIQ', k, `인화점 ${fmt(fp)}℃ (23℃ 미만), 초기 끓는점 ${bp === null ? '입력 없음 → 35℃ 초과로 봄' : `${fmt(bp)}℃`}`, { source: 'PROP' });
            if (bp === null) warn('초기 끓는점이 없어 인화성 액체 구분 2로 정했습니다. 초기 끓는점이 35℃ 이하이면 구분 1입니다.');
        } else if (fp <= 60) add('FLAM_LIQ', '3', `인화점 ${fmt(fp)}℃ (23℃ 이상 60℃ 이하)`, { source: 'PROP' });
        else if (fp <= 93) add('FLAM_LIQ', '4', `인화점 ${fmt(fp)}℃ (60℃ 초과 93℃ 이하)`, { source: 'PROP' });
    } else if (state === 'LIQUID' && comps.some(x => x.pct >= 1 && catsOf(x, 'FLAM_LIQ').length)) {
        warn(`인화성 액체 성분(${named(comps.filter(x => x.pct >= 1 && catsOf(x, 'FLAM_LIQ').length))})이 들어 있습니다. 제품의 인화점을 입력해야 인화성 액체 구분을 정할 수 있습니다.`);
    }
    (props.physManual || []).forEach(e => {
        if (!catOf(e.c, e.k) || classOf(e.c)?.group !== 'PHYS') return;
        if (classes.some(x => x.c === e.c)) return; // 인화점으로 정한 인화성 액체가 먼저
        add(e.c, e.k, '직접 지정 (제품 시험·자료 기준)', { source: 'MANUAL' });
    });

    // ----- 급성 독성 -----
    const ate = ['oral', 'dermal', 'gas', 'vapor', 'dust'].map(route => acuteForRoute(route, comps, state));
    ate.forEach(r => {
        const cfg = ACUTE_ROUTES[r.route];
        if (!r.cat) return;
        const formula = r.unknownPct > 10 ? `[공식 2] (100 − ${fmt(r.unknownPct)}) ÷ Σ(Ci/ATEi)` : '[공식 1] 100 ÷ Σ(Ci/ATEi)';
        add(cfg.c, r.cat, `ATEmix(${cfg.label}) = ${fmt(r.ateMix)} ${cfg.unit} — ${formula}, ${r.terms.map(t => `${t.name} ${pctText(t.pct)}/${fmt(t.ate)}(${t.from})`).join(' + ')}`, cfg.form ? { form: cfg.form } : {});
    });
    // 흡입은 형태(가스·증기·분진/미스트)마다 따로 계산하되 가장 엄한 구분 하나만 남긴다
    const inh = classes.filter(x => x.c === 'ACUTE_INH');
    if (inh.length > 1) {
        const worst = inh.reduce((a, b) => (Number(b.k) < Number(a.k) ? b : a));
        inh.filter(x => x !== worst).forEach(x => classes.splice(classes.indexOf(x), 1));
    }

    // ----- 피부 부식성/자극성 (3.2) -----
    const ph = num(props.ph);
    const isExtremePh = ph !== null && (ph <= 2 || ph >= 11.5);
    const skin1 = withCat('SKIN', ['1', '1A', '1B', '1C']);
    const skin2 = withCat('SKIN', ['2']).filter(x => !skin1.includes(x));
    const s1 = sumOf(skin1), s2 = sumOf(skin2);
    const na1 = skin1.filter(x => x.nonAdditive && x.pct >= 1), na2 = skin2.filter(x => x.nonAdditive && x.pct >= 3);
    const skinSub = () => { // 주: 소구분 1A·1B·1C는 각 합이 5% 이상일 때
        if (skin1.some(x => hasCat(x, 'SKIN', ['1']))) return '1';
        const a = sumOf(skin1.filter(x => hasCat(x, 'SKIN', ['1A'])));
        const b = sumOf(skin1.filter(x => hasCat(x, 'SKIN', ['1A', '1B'])));
        return a >= 5 ? '1A' : b >= 5 ? '1B' : '1C';
    };
    if (isExtremePh) add('SKIN', '1', `제품의 pH ${fmt(ph)} (pH 2 이하의 강산 또는 pH 11.5 이상의 강염기)`, { source: 'PROP' });
    else if (na1.length) add('SKIN', '1', `가산 방식을 적용할 수 없는 구분 1 성분이 1% 이상 (${named(na1)})`);
    else if (s1 >= 5) add('SKIN', skinSub(), `구분 1 성분의 합 ${pctText(s1)} ≥ 5% (${named(skin1)})`);
    else if (na2.length) add('SKIN', '2', `가산 방식을 적용할 수 없는 구분 2 성분이 3% 이상 (${named(na2)})`);
    else if (s1 >= 1) add('SKIN', '2', `구분 1 성분의 합 ${pctText(s1)} (1% 이상 5% 미만)`);
    else if (s2 >= 10) add('SKIN', '2', `구분 2 성분의 합 ${pctText(s2)} ≥ 10% (${named(skin2)})`);
    else if (10 * s1 + s2 >= 10) add('SKIN', '2', `10 × 구분 1(${pctText(s1)}) + 구분 2(${pctText(s2)}) = ${pctText(10 * s1 + s2)} ≥ 10%`);
    const isSkinCorrosive = classes.some(x => x.c === 'SKIN' && x.k !== '2');

    // ----- 심한 눈 손상성/눈 자극성 (3.3) — 피부 부식성(구분 1) 성분도 심한 눈 손상(구분 1)으로 센다(한 번만) -----
    const eye1 = comps.filter(x => x.pct > 0 && (hasCat(x, 'EYE', ['1']) || hasCat(x, 'SKIN', ['1', '1A', '1B', '1C'])));
    const eye2 = withCat('EYE', ['2', '2A', '2B']).filter(x => !eye1.includes(x));
    const e1 = sumOf(eye1), e2 = sumOf(eye2);
    const ena1 = eye1.filter(x => x.nonAdditive && x.pct >= 1), ena2 = eye2.filter(x => x.nonAdditive && x.pct >= 3);
    const eye2Cat = () => (eye2.length && !e1 && eye2.every(x => catsOf(x, 'EYE').every(k => k === '2B')) ? '2B' : '2'); // 주2: 모든 성분이 2B면 2B
    if (isExtremePh) add('EYE', '1', `제품의 pH ${fmt(ph)} (pH 2 이하의 강산 또는 pH 11.5 이상의 강염기)`, { source: 'PROP' });
    else if (isSkinCorrosive) add('EYE', '1', '피부 부식성(구분 1)인 혼합물 — 심한 눈 손상성 구분 1');
    else if (ena1.length) add('EYE', '1', `가산 방식을 적용할 수 없는 구분 1 성분이 1% 이상 (${named(ena1)})`);
    else if (e1 >= 3) add('EYE', '1', `심한 눈 손상(구분 1)·피부 부식성(구분 1) 성분의 합 ${pctText(e1)} ≥ 3% (${named(eye1)})`);
    else if (ena2.length) add('EYE', '2', `가산 방식을 적용할 수 없는 구분 2 성분이 3% 이상 (${named(ena2)})`);
    else if (e1 >= 1) add('EYE', '2', `심한 눈 손상(구분 1)·피부 부식성(구분 1) 성분의 합 ${pctText(e1)} (1% 이상 3% 미만)`);
    else if (e2 >= 10) add('EYE', eye2Cat(), `눈 자극성(구분 2) 성분의 합 ${pctText(e2)} ≥ 10% (${named(eye2)})`);
    else if (10 * e1 + e2 >= 10) add('EYE', '2', `10 × 구분 1(${pctText(e1)}) + 구분 2(${pctText(e2)}) = ${pctText(10 * e1 + e2)} ≥ 10%`);

    // ----- 호흡기·피부 과민성 (3.4) — 성분 하나하나의 함량으로 본다 -----
    const sensitizer = (c, generalLimit) => {
        const hits = comps.filter(x => x.pct > 0 && ((hasCat(x, c, ['1A']) && x.pct >= 0.1) || (hasCat(x, c, ['1', '1B']) && x.pct >= generalLimit)));
        if (!hits.length) return;
        const kinds = new Set(hits.flatMap(x => catsOf(x, c)));
        const k = kinds.size === 1 ? [...kinds][0] : '1';
        add(c, k, `과민성 성분의 함량이 한계 이상 (구분 1·1B ${generalLimit}%, 구분 1A 0.1%): ${named(hits)}`);
    };
    sensitizer('RESP_SENS', state === 'GAS' ? 0.2 : 1.0);
    sensitizer('SKIN_SENS', 1.0);

    // ----- 생식세포 변이원성 · 발암성 · 생식독성 (3.5~3.7) — 한계농도 -----
    const cmr = (c, limit1, limit2) => {
        const hits1 = comps.filter(x => x.pct >= limit1 && hasCat(x, c, ['1A', '1B', '1']));
        const hits2 = comps.filter(x => x.pct >= limit2 && hasCat(x, c, ['2']));
        if (hits1.length) {
            const k = hits1.some(x => hasCat(x, c, ['1A'])) ? '1A' : hits1.every(x => hasCat(x, c, ['1B'])) ? '1B' : '1';
            add(c, k, `구분 1 성분의 함량 ≥ ${limit1}% (${named(hits1)})`);
        } else if (hits2.length) add(c, '2', `구분 2 성분의 함량 ≥ ${limit2}% (${named(hits2)})`);
    };
    cmr('MUTA', 0.1, 1.0);
    cmr('CARC', 0.1, 1.0);
    cmr('REPRO', 0.3, 3.0);
    const lact = comps.filter(x => x.pct >= 0.3 && hasCat(x, 'REPRO', ['L']));
    if (lact.length) add('REPRO', 'L', `수유독성 성분의 함량 ≥ 0.3% (${named(lact)})`);

    // ----- 특정표적장기 독성 (3.8·3.9) -----
    const stot = (c) => {
        const c1 = withCat(c, ['1']), c2 = withCat(c, ['2']);
        const max1 = Math.max(0, ...c1.map(x => x.pct)), max2 = Math.max(0, ...c2.map(x => x.pct));
        if (max1 >= 10) add(c, '1', `구분 1 성분의 함량 ≥ 10% (${named(c1.filter(x => x.pct >= 10))})`);
        else if (max1 >= 1) add(c, '2', `구분 1 성분의 함량이 1% 이상 10% 미만 (${named(c1.filter(x => x.pct >= 1))})`);
        else if (max2 >= 10) add(c, '2', `구분 2 성분의 함량 ≥ 10% (${named(c2.filter(x => x.pct >= 10))})`);
        if (max1 < 10 && sumOf(c1) >= 10 && c1.length > 1) warn(`${classOf(c).label}: 구분 1 성분이 하나씩은 10% 미만이지만 합은 ${pctText(sumOf(c1))}입니다. 표적장기가 같으면 구분 1로 올리는 것을 검토하세요(직접 지정).`);
        else if (max1 < 1 && max2 < 10 && sumOf(c2) >= 10 && c2.length > 1) warn(`${classOf(c).label}: 구분 2 성분이 하나씩은 10% 미만이지만 합은 ${pctText(sumOf(c2))}입니다. 표적장기가 같으면 구분 2를 검토하세요(직접 지정).`);
    };
    stot('STOT_SE');
    [['3R', '호흡기계 자극성'], ['3N', '마취작용']].forEach(([k, label]) => {
        const list = withCat('STOT_SE', [k]);
        if (sumOf(list) >= 20) add('STOT_SE', k, `${label}을 나타내는 성분의 합 ${pctText(sumOf(list))} ≥ 20% (${named(list)})`);
    });
    stot('STOT_RE');

    // ----- 흡인 유해성 (3.10) — 성분 합 10% 이상이고 40℃ 동점도가 기준 이하 -----
    const kv = num(props.kv40);
    const asp1 = withCat('ASP', ['1']), asp2 = withCat('ASP', ['2']);
    const a1 = sumOf(asp1), a2 = sumOf(asp2);
    if (state !== 'GAS' && a1 >= 10) {
        if (kv === null) {
            add('ASP', '1', `구분 1 성분의 합 ${pctText(a1)} ≥ 10% (${named(asp1)}) — 40℃ 동점도 입력 없음(20.5 mm²/s 이하로 봄)`);
            warn('40℃ 동점도가 없어 흡인 유해성 구분 1로 정했습니다. 동점도가 20.5 mm²/s를 넘으면 흡인 유해성으로 분류하지 않습니다.');
        } else if (kv <= 20.5) add('ASP', '1', `구분 1 성분의 합 ${pctText(a1)} ≥ 10% (${named(asp1)}), 40℃ 동점도 ${fmt(kv)} mm²/s ≤ 20.5`);
        else info(`흡인 유해성 구분 1 성분이 ${pctText(a1)} 들어 있지만 40℃ 동점도가 ${fmt(kv)} mm²/s(20.5 초과)라 분류하지 않습니다.`);
    }
    if (state !== 'GAS' && !classes.some(x => x.c === 'ASP') && a2 >= 10) {
        if (kv === null) {
            add('ASP', '2', `구분 2 성분의 합 ${pctText(a2)} ≥ 10% (${named(asp2)}) — 40℃ 동점도 입력 없음(14 mm²/s 이하로 봄)`);
            warn('40℃ 동점도가 없어 흡인 유해성 구분 2로 정했습니다. 동점도가 14 mm²/s를 넘으면 분류하지 않습니다.');
        } else if (kv <= 14) add('ASP', '2', `구분 2 성분의 합 ${pctText(a2)} ≥ 10% (${named(asp2)}), 40℃ 동점도 ${fmt(kv)} mm²/s ≤ 14`);
    }

    // ----- 수생환경 유해성 (4.1) — 곱셈계수 M -----
    const mOf = (x, kind) => { const m = num(x.m?.[kind]); return m && m > 0 ? m : 1; };
    const acute1 = withCat('AQ_ACUTE', ['1']);
    const sumA = sum(acute1.map(x => x.pct * mOf(x, 'acute')));
    if (sumA >= 25) add('AQ_ACUTE', '1', `Σ(급성 1 성분 × M) = ${pctText(sumA)} ≥ 25% (${named(acute1)})`);
    const ch1 = withCat('AQ_CHRONIC', ['1']), ch2 = withCat('AQ_CHRONIC', ['2']), ch3 = withCat('AQ_CHRONIC', ['3']), ch4 = withCat('AQ_CHRONIC', ['4']);
    const c1m = sum(ch1.map(x => x.pct * mOf(x, 'chronic'))), c2 = sumOf(ch2), c3 = sumOf(ch3), c4 = sumOf(ch4);
    if (c1m >= 25) add('AQ_CHRONIC', '1', `Σ(만성 1 성분 × M) = ${pctText(c1m)} ≥ 25% (${named(ch1)})`);
    else if (10 * c1m + c2 >= 25) add('AQ_CHRONIC', '2', `10 × Σ(만성 1 × M)(${pctText(c1m)}) + 만성 2(${pctText(c2)}) = ${pctText(10 * c1m + c2)} ≥ 25%`);
    else if (100 * c1m + 10 * c2 + c3 >= 25) add('AQ_CHRONIC', '3', `100 × Σ(만성 1 × M)(${pctText(c1m)}) + 10 × 만성 2(${pctText(c2)}) + 만성 3(${pctText(c3)}) = ${pctText(100 * c1m + 10 * c2 + c3)} ≥ 25%`);
    else if (sumOf(ch1) + c2 + c3 + c4 >= 25) add('AQ_CHRONIC', '4', `만성 1~4 성분의 합 ${pctText(sumOf(ch1) + c2 + c3 + c4)} ≥ 25%`);

    // ----- 오존층 유해성 (4.2) -----
    const ozone = comps.filter(x => x.pct >= 0.1 && hasCat(x, 'OZONE', ['1']));
    if (ozone.length) add('OZONE', '1', `오존층 유해성 성분의 함량 ≥ 0.1% (${named(ozone)})`);

    // ----- 직접 지정 (혼합물 전체 시험 자료·가교 원리 등) -----
    Object.entries(props.overrides || {}).forEach(([c, o]) => {
        if (!classOf(c) || !o || !String(o.k || '').trim()) return;
        for (let i = classes.length - 1; i >= 0; i--) if (classes[i].c === c) classes.splice(i, 1);
        String(o.k).split(',').map(s => s.trim()).filter(k => k && k !== 'NONE' && catOf(c, k)).forEach(k => {
            add(c, k, `직접 지정${o.reason ? ` — ${o.reason}` : ' (혼합물 시험 자료 등)'}`, { source: 'OVERRIDE', ...(c === 'ACUTE_INH' ? { form: o.form || defaultForm(state) } : {}) });
        });
    });

    // 별표 1의 순서대로
    const order = new Map(GHS_CLASSES.map((cl, i) => [cl.key, i]));
    const catOrder = (x) => classOf(x.c).cats.findIndex(ct => ct.k === x.k);
    classes.sort((a, b) => order.get(a.c) - order.get(b.c) || catOrder(a) - catOrder(b));
    const organs = props.organs || {};
    classes.forEach(x => { if (organs[x.c] && (x.c === 'STOT_SE' || x.c === 'STOT_RE') && !/^3/.test(x.k)) x.organs = String(organs[x.c]).trim(); });
    return { classes, notes, ate, totalPct, unknownPct };
};

// ---------- 경고표지 항목 (별표 2 + 제6조의2) ----------
const PIC_ORDER = ['GHS01', 'GHS02', 'GHS03', 'GHS04', 'GHS05', 'GHS06', 'GHS07', 'GHS08', 'GHS09'];
const P_GROUPS = ['prev', 'resp', 'stor', 'disp'];
/** 뒤 문구가 있으면 앞 문구는 겹치므로 뺀다 (제6조의2 제5항 제1호: 중복·유사 문구 생략) */
const P_COVERED = [
    ['P261', ['P260']], ['P301+P312', ['P301+P310']], ['P311', ['P310']], ['P312', ['P310', 'P311']], ['P308+P313', ['P308+P311']],
    ['P362+P364', ['P361+P364']], ['P363', ['P361+P364', 'P362+P364']], ['P330', ['P301+P330+P331']], ['P331', ['P301+P330+P331']],
    ['P403', ['P403+P233', 'P403+P235', 'P410+P403']], ['P410', ['P410+P403', 'P410+P412']], ['P370+P380+P375', ['P370+P380+P375+P378']]
];

/**
 * 분류 결과로 경고표지 항목(MSDS 2항 나.)을 만든다.
 * @param {MixClass[]} classes
 * @param {{ state?: string, media?: string }} [ctx] 문구 채우기에 쓰는 제품 상태·소화제
 * @returns {{ pictograms: string[], signal: ''|'DANGER'|'WARNING', h: Array<{ code: string, text: string }>, p: { prev: Array<{code:string,text:string}>, resp: Array<{code:string,text:string}>, stor: Array<{code:string,text:string}>, disp: Array<{code:string,text:string}> }, omitted: string[] }}
 */
export const buildLabel = (classes, ctx = {}) => {
    const omitted = [];
    const cats = classes.map(x => ({ x, ct: catOf(x.c, x.k) })).filter(o => o.ct);
    // 그림문자: 제6조의2 제2항
    const hasSkull = cats.some(o => o.ct.pic.includes('GHS06'));
    const hasCorrosion = cats.some(o => o.ct.pic.includes('GHS05'));
    const hasRespSens = cats.some(o => o.x.c === 'RESP_SENS');
    const pics = new Set();
    cats.forEach(({ x, ct }) => ct.pic.forEach(pic => {
        if (pic === 'GHS07') {
            if (hasSkull) return; // 해골과 X자형 뼈가 있으면 감탄부호는 표시하지 않는다
            if (hasCorrosion && (x.c === 'SKIN' || x.c === 'EYE')) return; // 부식성이 있으면 피부·눈 자극성의 감탄부호는 뺀다
            if (hasRespSens && (x.c === 'SKIN_SENS' || x.c === 'SKIN' || x.c === 'EYE')) return; // 호흡기 과민성이 있으면 피부 과민성·자극성의 감탄부호는 뺀다
        }
        pics.add(pic);
    }));
    const pictograms = PIC_ORDER.filter(p => pics.has(p));
    if (pictograms.length >= 5) omitted.push('그림문자가 5개 이상이면 경고표지에는 4개만 표시할 수 있습니다(제6조의2 제2항 제4호).');
    // 신호어: 위험과 경고에 모두 해당하면 위험만
    const signal = cats.some(o => o.ct.signal === 'DANGER') ? 'DANGER' : cats.some(o => o.ct.signal === 'WARNING') ? 'WARNING' : '';
    // 유해·위험 문구: 모두 표시하되 겹치는 문구는 생략
    const hMap = new Map();
    cats.forEach(({ x, ct }) => ct.h.forEach(code => { if (!hMap.has(code)) hMap.set(code, hText(code, x.organs)); }));
    if (hMap.has('H314') && hMap.has('H318')) { hMap.delete('H318'); omitted.push('H318(눈에 심한 손상)은 H314에 포함되어 생략했습니다.'); }
    if (hMap.has('H410') && hMap.has('H400')) { hMap.delete('H400'); omitted.push('H400(수생생물에 매우 유독함)은 H410에 포함되어 생략했습니다.'); }
    const h = [...hMap.keys()].sort().map(code => ({ code, text: hMap.get(code) }));
    // 예방조치 문구
    const p = { prev: [], resp: [], stor: [], disp: [] };
    const all = new Set(cats.flatMap(({ ct }) => P_GROUPS.flatMap(g => ct.p[g])));
    P_GROUPS.forEach(g => {
        const codes = [...new Set(cats.flatMap(({ ct }) => ct.p[g]))].filter(code => !P_COVERED.some(([weak, strong]) => weak === code && strong.some(s => all.has(s))));
        codes.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
        p[g] = codes.map(code => ({ code, text: pText(code, ctx) }));
    });
    return { pictograms, signal, h, p, omitted };
};

/** 분류 목록 글 (MSDS 2항 가.) */
export const classLines = (classes) => classes.map(x => clsLabel(x));

/**
 * 성분이 MSDS 3항(구성성분)에 적어야 하는 성분인지: 분류기준에 해당하고 함유량이 한계농도 이상 (제11조제9항·별표 6)
 * @param {MixComponent} comp
 * @param {(entry: ClsEntry) => number} cutoffOf
 */
export const isReportable = (comp, cutoffOf) => (comp.cls || []).some(e => catOf(e.c, e.k) && comp.pct >= cutoffOf(e));

export { INH_FORMS };
