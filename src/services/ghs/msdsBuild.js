// ==========================================
// 혼합물 MSDS 본문 만들기 (고시 별표 4의 16개 항목)
// ==========================================
// 화면·저장소와 무관한 순수 함수: 문서(doc) + 물질 기록(lib) → 분류 결과·경고표지 항목·항목별 글
// · 자동으로 만든 글(auto)은 분류 결과와 성분 자료에서 나온 표준 문장이고, 사람이 고친 글(doc.texts[key])이 있으면 그것이 우선이다.
// · 자료가 없는 칸은 '자료 없음', 대상이 아닌 칸은 '해당 없음' (제11조제7항)
// · 3항 구성성분: 분류기준에 해당하고 한계농도(별표 6) 이상인 성분만 적고, 함유량은 ±5%P 범위로 적을 수 있다 (제11조제9항·제10항)
import { classifyMixture, buildLabel, classLines, isReportable, ACUTE_ROUTES } from './mixtureClassify.js';
import { GHS_NOTICE, INH_FORMS, MSDS_TEXT_KEYS, NO_DATA, NOT_APPLICABLE, SIGNALS, USE_CATEGORIES, cutoffOf, clsLabel, classOf, catOf } from './ghsTables.js';

export const STATE_LABELS = { LIQUID: '액체', SOLID: '고체', GAS: '기체' };
export const DEFAULT_MEDIA = '분말소화약제, 이산화탄소, 포 소화약제(알코올 내성 포), 물분무';
/** 문서 맨 끝에 붙는 안내 글 (16항 뒤, 인쇄물에서는 옅은 글씨) */
export const MSDS_DISCLAIMER = '이 물질안전보건자료는 작성 시점의 지식과 자료를 바탕으로 작성했으며, 제품을 안전하게 취급·사용·저장·운송·폐기하기 위한 정보를 제공합니다. 제품의 품질 규격을 보증하는 문서가 아닙니다.';
const INFO_MAX = 480; // 성분 자료 한 칸에 옮겨 적는 글자 수 (넘으면 줄임)
/** 성분 자료 줄('· 이름: 경구 … ; 경피 …')에서 값 앞에 붙는 이름 — 인쇄할 때 이름 | 값 두 칸으로 나눈다 (msdsPrint.js) */
export const INFO_PART_LABELS = ['국내규정', 'ACGIH', '생물학적 노출기준', '기타', '경구', '경피', '흡입', '산업안전보건법', '고용노동부고시', 'IARC', 'OSHA', 'NTP', 'EU CLP', '어류', '갑각류', '조류', '잔류성', '분해성', '농축성', '생분해성'];
const HIT = '해당됨';

/** 버전 글자: 개정 번호가 정수면 'n.0' (예: 3 → 3.0), 아니면 적은 그대로 */
export const versionText = (rev) => { const no = String(rev?.no ?? '').trim(); return /^\d+$/.test(no) ? `${no}.0` : no; };

const num = (v) => { const n = Number(v); return v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(n) ? n : null; };
const fmt = (n) => (Number.isFinite(n) ? String(Number(n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : n >= 1 ? 2 : 3))) : '');
const clip = (t) => { const s = String(t || '').trim(); return s.length > INFO_MAX ? `${s.slice(0, INFO_MAX)}…` : s; };
const lines = (list) => list.filter(Boolean).join('\n');

/** 새 문서의 처음 값 */
export const emptyDoc = () => ({
    id: '', status: 'DRAFT',
    product: { name: '', itemCode: '', useNo: '', useText: '', limit: '', msdsNo: '' },
    supplier: { company: '', address: '', phone: '', fax: '' },
    comps: [],
    props: { state: 'LIQUID', color: '', odor: '', odorThr: '', ph: '', mp: '', bp: '', fp: '', fpMethod: '', evap: '', flam: '', limits: '', vp: '', sol: '', vd: '', sg: '', kow: '', ait: '', decomp: '', kv40: '', visc: '', mw: '', waterSoluble: false },
    physManual: [], overrides: {}, organs: {}, media: '',
    transport: {}, texts: {},
    // no = 버전(개정 번호: 처음 만든 문서가 1), count = 개정 횟수, prevDate = 이전 개정일자(개정 +1 때 채움)
    rev: { no: '1', count: 0, firstDate: '', revDate: '', prevDate: '' }
});

/** 새 구성성분 줄 */
export const emptyComp = () => ({ cas: '', name: '', alias: '', pct: '', disp: '', show: 'AUTO', own: false, secret: null });

// ---------- 함유량 표시 ----------
/** 함유량 → ±5%P 안의 범위 글자 (5% 단위 칸, 1% 미만은 '0.1 – 1' · '< 0.1') */
export const autoRange = (pct) => {
    const p = Number(pct);
    if (!(p > 0)) return '';
    if (p >= 100) return '100';
    if (p < 0.1) return '< 0.1';
    if (p < 1) return '0.1 – 1';
    const lo = Math.floor(p / 5) * 5, hi = Math.min(100, lo + 5);
    return `${lo === 0 ? 1 : lo} – ${hi}`;
};

/**
 * 직접 적은 함유량 글자가 실제 함유량의 ±tol %P 범위 안인지 (제11조제10항 ±5, 대체함유량 ±10/±20)
 * @returns {'OK'|'OUT'|'TEXT'} TEXT = 숫자 범위로 읽을 수 없는 글
 */
export const checkRange = (text, pct, tol = 5) => {
    const nums = (String(text || '').match(/\d+(?:\.\d+)?/g) || []).map(Number);
    const p = Number(pct);
    if (!nums.length || !(p > 0)) return 'TEXT';
    const lo = Math.min(...nums), hi = Math.max(...nums);
    if (/미만|<|이하/.test(text) && nums.length === 1) return p <= hi + 1e-9 && hi - p <= tol ? 'OK' : 'OUT';
    return lo >= p - tol - 1e-9 && hi <= p + tol + 1e-9 && lo <= p + 1e-9 && hi >= p - 1e-9 ? 'OK' : 'OUT';
};

// ---------- 성분 풀기 ----------
/**
 * 문서의 성분 줄에 물질 기록을 붙인다. 성분 줄에 '이 문서에서만 쓰는 분류'(own)가 있으면 그것을 쓴다.
 * @param {Object} doc
 * @param {Map<string, Object>} lib CAS → 물질 기록
 */
export const resolveComps = (doc, lib) => (doc.comps || []).map(c => {
    const sub = (c.cas && lib?.get(c.cas)) || null;
    const src = c.own ? c : sub || {};
    return {
        cas: c.cas || '', name: c.name || sub?.nameKo || sub?.nameEn || c.cas || '', alias: c.alias ?? sub?.synonyms ?? '', keNo: sub?.keNo || '', pct: Math.max(0, Number(c.pct) || 0),
        cls: Array.isArray(src.cls) ? src.cls : [], ate: src.ate || {}, m: src.m || {}, unknown: c.own ? !!c.unknown : sub ? !!sub.unknown : true, nonAdditive: !!src.nonAdditive,
        info: sub?.info || {}, source: sub?.source || (c.own ? 'MANUAL' : ''), hasRecord: !!sub || !!c.own, line: c
    };
});

// ---------- 위험물안전관리법 (제4류 인화성 액체, 인화점 기준) ----------
/** 탄소 1~3개의 포화 1가 알코올: 메탄올·에탄올·1-프로판올·2-프로판올 (시행령 별표 1 비고의 '알코올류') */
const LOWER_ALCOHOLS = new Set(['67-56-1', '64-17-5', '71-23-8', '67-63-0']);
const WATER_CAS = '7732-18-5';
const ALCOHOL_MIN_PCT = 60; // 알코올 함유량이 60중량% 미만인 수용액은 알코올류에서 뺀다
const COMBUSTIBLE_MAX_PCT = 40; // 가연성 액체량이 40중량% 이하이면 제2~제4석유류에서 빠질 수 있다
const ALCOHOL_SOLUTION_MIN_PCT = 95; // 알코올 + 물이 이만큼이면 알코올(변성알코올 포함) 또는 그 수용액으로 본다

/**
 * @param {{ state?: string, fp?: unknown, bp?: unknown, ait?: unknown, waterSoluble?: boolean, alcoholPct?: number }} o alcoholPct = 탄소 1~3개 포화 1가 알코올의 함유량 합(%)
 * @returns {string} 예: '제4류 인화성 액체 제2석유류(비수용성 액체), 지정수량 1,000 L' / '' = 정할 수 없음
 */
export const dangerousGoodsOf = ({ state, fp, bp, ait, waterSoluble, alcoholPct = 0 }) => {
    if (state !== 'LIQUID') return '';
    const f = num(fp), b = num(bp), a = num(ait);
    const kind = waterSoluble ? '수용성 액체' : '비수용성 액체';
    if ((a !== null && a <= 100) || (f !== null && f <= -20 && b !== null && b <= 40)) return '제4류 인화성 액체 특수인화물, 지정수량 50 L';
    if (alcoholPct >= ALCOHOL_MIN_PCT) return '제4류 인화성 액체 알코올류, 지정수량 400 L';
    if (f === null) return '';
    if (f < 21) return `제4류 인화성 액체 제1석유류(${kind}), 지정수량 ${waterSoluble ? '400' : '200'} L`;
    if (f < 70) return `제4류 인화성 액체 제2석유류(${kind}), 지정수량 ${waterSoluble ? '2,000' : '1,000'} L`;
    if (f < 200) return `제4류 인화성 액체 제3석유류(${kind}), 지정수량 ${waterSoluble ? '4,000' : '2,000'} L`;
    if (f < 250) return '제4류 인화성 액체 제4석유류, 지정수량 6,000 L';
    return `${NOT_APPLICABLE} (인화점 250℃ 이상)`;
};

// ---------- 15항 점검 항목 (성분의 공단 규제 글에서 찾는 말) ----------
const DG_LAW = '위험물안전관리법';
/** 0.1% 이상이면 적는 규제 (그 밖은 1% 이상) */
const STRICT_REG_RE = /특별관리|허가|금지|제한/;
/** @type {Object<string, Array<{ label: string, re: RegExp, ke?: boolean }>>} 공단 항목 코드 → 점검 항목 (적는 순서). ke = 내용에 기존화학물질 번호를 붙인다 */
const REG_ITEMS = {
    // 산업안전보건법
    O02: [
        { label: '제조 등 금지물질', re: /금지/ }, { label: '허가대상물질', re: /허가/ }, { label: '노출기준설정물질', re: /노출기준/ }, { label: '허용기준설정물질', re: /허용기준/ },
        { label: '작업환경측정대상물질', re: /작업환경측정/ }, { label: '특수건강진단대상물질', re: /특수건강진단/ }, { label: '관리대상유해물질', re: /관리대상/ }, { label: '특별관리물질', re: /특별관리/ },
        { label: '공정안전보고서(PSM) 제출 대상물질', re: /공정안전|PSM/ }
    ],
    // 화학물질관리법
    O04: [
        { label: '인체급성유해성물질', re: /인체\s*급성/ }, { label: '인체만성유해성물질', re: /인체\s*만성/ }, { label: '생태유해성물질', re: /생태\s*유해/ },
        { label: '허가물질', re: /허가/ }, { label: '제한물질', re: /제한/ }, { label: '금지물질', re: /금지/ }, { label: '사고대비물질', re: /사고대비/ }
    ],
    // 화학물질의 등록 및 평가 등에 관한 법률
    O12: [
        { label: '기존화학물질', re: /^(?!.*등록대상).*기존화학물질/, ke: true }, { label: '등록대상기존화학물질', re: /등록대상/ }, { label: '중점관리물질', re: /중점관리/ }
    ]
};

// ---------- 운송 정보 추정 (분류에서) ----------
const transportOf = (classes, state) => {
    const find = (c, ks) => classes.find(x => x.c === c && (!ks || ks.includes(x.k)));
    const flam = find('FLAM_LIQ', ['1', '2', '3']);
    const corr = find('SKIN', ['1', '1A', '1B', '1C']);
    const tox = ['ACUTE_ORAL', 'ACUTE_DERMAL', 'ACUTE_INH'].map(c => find(c, ['1', '2', '3'])).filter(Boolean).sort((a, b) => Number(a.k) - Number(b.k))[0];
    const env = find('AQ_ACUTE', ['1']) || find('AQ_CHRONIC', ['1', '2']);
    const marine = env ? '해당' : '비해당';
    const liquid = state !== 'SOLID';
    if (flam) return { un: 'UN 1993', name: '인화성 액체, 달리 명시되지 않은 것 (FLAMMABLE LIQUID, N.O.S.)', cls: '3', pg: { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ' }[flam.k], marine, guessed: true };
    if (corr) return { un: liquid ? 'UN 1760' : 'UN 1759', name: `부식성 ${liquid ? '액체' : '고체'}, 달리 명시되지 않은 것 (CORROSIVE ${liquid ? 'LIQUID' : 'SOLID'}, N.O.S.)`, cls: '8', pg: { '1A': 'Ⅰ', '1B': 'Ⅱ', '1C': 'Ⅲ' }[corr.k] || 'Ⅱ', marine, guessed: true };
    if (tox) return { un: liquid ? 'UN 2810' : 'UN 2811', name: `독성 ${liquid ? '액체' : '고체'}, 유기물, 달리 명시되지 않은 것 (TOXIC ${liquid ? 'LIQUID' : 'SOLID'}, ORGANIC, N.O.S.)`, cls: '6.1', pg: { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ' }[tox.k], marine, guessed: true };
    if (env) return { un: liquid ? 'UN 3082' : 'UN 3077', name: `환경유해물질, ${liquid ? '액체' : '고체'}, 달리 명시되지 않은 것 (ENVIRONMENTALLY HAZARDOUS SUBSTANCE, ${liquid ? 'LIQUID' : 'SOLID'}, N.O.S.)`, cls: '9', pg: 'Ⅲ', marine, guessed: true };
    return { un: NOT_APPLICABLE, name: NOT_APPLICABLE, cls: NOT_APPLICABLE, pg: NOT_APPLICABLE, marine, guessed: false };
};

// ---------- 본문 ----------
/**
 * @param {Object} doc 문서 (emptyDoc 모양)
 * @param {Map<string, Object>} lib CAS → 물질 기록
 * @returns {{ result: ReturnType<typeof classifyMixture>, label: ReturnType<typeof buildLabel>, comps: Object[], s3: Array<{ name: string, alias: string, cas: string, keNo?: string, content: string, secret: boolean }>, s3Note: string,
 *            auto: Object<string, string>, text: Object<string, string>, edited: string[], warnings: string[] }}
 */
export const buildMsds = (doc, lib) => {
    const props = doc.props || {};
    const state = props.state || 'LIQUID';
    const comps = resolveComps(doc, lib);
    const result = classifyMixture(comps, {
        state, flashPoint: num(props.fp), boilingPoint: num(props.bp), kv40: num(props.kv40), ph: num(props.ph),
        physManual: doc.physManual || [], overrides: doc.overrides || {}, organs: doc.organs || {}
    });
    const media = String(doc.media || '').trim() || DEFAULT_MEDIA;
    const label = buildLabel(result.classes, { state, media });
    const warnings = result.notes.filter(n => n.level === 'warn').map(n => n.text);
    const has = (c, ks) => result.classes.some(x => x.c === c && (!ks || ks.includes(x.k)));
    const classOfMix = (c) => result.classes.filter(x => x.c === c);
    const isFlammable = has('FLAM_LIQ', ['1', '2', '3']) || has('FLAM_GAS') || has('AEROSOL', ['1', '2']) || has('FLAM_SOL');
    const isCorrosive = has('SKIN', ['1', '1A', '1B', '1C']);
    const isAquatic = has('AQ_ACUTE') || has('AQ_CHRONIC');
    const isLiquid = state === 'LIQUID';

    // ----- 3. 구성성분 -----
    comps.forEach(c => {
        c.reportable = isReportable(c, cutoffOf);
        // 3항 표시: AUTO 한계농도 이상이면 적음 / SHOW 항상 적음 / SECRET 대체자료(대체명칭·대체함유량)로 적음 / HIDE 적지 않음
        const show = c.line.show || 'AUTO';
        c.listed = c.pct > 0 && (show === 'SHOW' || show === 'SECRET' || (show === 'AUTO' && c.reportable));
        if (!c.hasRecord && c.pct > 0) warnings.push(`${c.name || '이름 없는 성분'}: 물질 정보가 없습니다 — CAS 번호로 조회하거나 분류를 직접 넣으세요.`);
    });
    const s3 = comps.filter(c => c.listed).sort((a, b) => b.pct - a.pct).map(c => {
        if (c.line.show === 'SECRET') {
            const sec = c.line.secret || {};
            const tol = c.pct < 25 ? 10 : 20; // 제17조제5항: 25% 미만 ±10%P, 25% 이상 ±20%P
            if (!String(sec.name || '').trim()) warnings.push(`${c.name}: 대체자료로 적을 대체명칭을 입력하세요.`);
            if (sec.pct && checkRange(sec.pct, c.pct, tol) === 'OUT') warnings.push(`${c.name}: 대체함유량 '${sec.pct}'이(가) 실제 함유량의 ±${tol}%P 범위를 벗어납니다(제17조제5항).`);
            return { name: String(sec.name || '').trim() || '(대체명칭)', alias: '', cas: '영업비밀', content: String(sec.pct || '').trim() || autoRange(c.pct), secret: true, approval: sec.approval || '', until: sec.until || '' };
        }
        const content = String(c.line.disp || '').trim() || autoRange(c.pct);
        if (c.line.disp && checkRange(c.line.disp, c.pct, 5) === 'OUT') warnings.push(`${c.name}: 표시 함유량 '${c.line.disp}'이(가) 실제 함유량(${fmt(c.pct)}%)의 ±5%P 범위를 벗어납니다(제11조제10항).`);
        return { name: c.name, alias: c.alias || '', cas: c.cas || '-', keNo: c.keNo || '', content, secret: false };
    });
    const hidden = comps.filter(c => c.pct > 0 && c.reportable && !c.listed);
    if (hidden.length) warnings.push(`분류기준에 해당하는데 3항에 적지 않기로 한 성분: ${hidden.map(c => c.name).join(', ')} — 영업비밀이면 대체자료 기재 승인을 받아 대체명칭·대체함유량으로 적어야 합니다('대체자료'를 고르세요).`);
    const secrets = s3.filter(r => r.secret);
    const s3Note = lines([
        s3.length ? '' : '유해성·위험성 분류기준에 해당하는 구성성분 없음',
        secrets.length ? `* 대체자료 기재 승인: ${secrets.map(r => `${r.name}${r.approval ? ` (승인번호 ${r.approval}${r.until ? `, 유효기간 ${r.until}` : ''})` : ' (승인번호·유효기간 기재 필요)'}`).join(' / ')}` : ''
    ]);

    // 성분 자료를 '· 이름: 글' 줄로
    const dataComps = comps.filter(c => c.listed || (c.pct >= 1 && c.reportable));
    const infoLines = (codes, labelsOn = false) => dataComps.map(c => {
        // 자료 한 줄에 줄바꿈이 있으면 ' / '로 이어 한 줄로 만든다 (인쇄할 때 이 줄 하나가 자료 상자 하나)
        const parts = [].concat(codes).map(code => (c.info[code] ? `${labelsOn ? `${labelsOn[code] || ''} ` : ''}${clip(c.info[code]).replace(/\s*\n\s*/g, ' / ')}` : '')).filter(Boolean);
        return parts.length ? `· ${c.name}: ${parts.join(' ; ')}` : '';
    }).filter(Boolean);
    const mixLine = (c, emptyText = '분류되지 않음') => { const list = classOfMix(c); return list.length ? `혼합물 분류: ${list.map(x => catOf(x.c, x.k)?.label).join(', ')}` : `혼합물 분류: ${emptyText}`; };
    const tox = (c, codes, labelsOn) => lines([mixLine(c), ...infoLines(codes, labelsOn)]);

    const auto = {};
    const p = doc.product || {}, sup = doc.supplier || {};
    // ----- 1 -----
    const use = USE_CATEGORIES.find(u => u.no === String(p.useNo || ''));
    auto['s1.name'] = p.name || '';
    // '○ '로 시작하는 줄은 인쇄할 때 작은 제목이 된다
    auto['s1.use'] = lines([
        '○ 제품의 권고 용도',
        use ? `고용노동부고시 용도분류체계: ${use.no} - ${use.name}` : '',
        `제품의 권고 용도: ${String(p.useText || '').trim() || (use ? use.name : NO_DATA)}`,
        '○ 제품의 사용상의 제한',
        String(p.limit || '').trim() || '권고 용도 외에는 사용하지 마시오.'
    ]);
    auto['s1.company'] = sup.company || '';
    auto['s1.address'] = sup.address || '';
    auto['s1.phone'] = sup.phone || '';

    // ----- 2 -----
    const none = !result.classes.length;
    auto['s2.cls'] = none ? '분류되지 않음 (「산업안전보건법 시행규칙」 별표 18의 분류기준에 해당하지 않음)' : lines(classLines(result.classes));
    auto['s2.signal'] = label.signal ? SIGNALS[label.signal] : NOT_APPLICABLE;
    auto['s2.h'] = label.h.length ? lines(label.h.map(x => `${x.code} - ${x.text}`)) : NOT_APPLICABLE;
    [['pPrev', 'prev'], ['pResp', 'resp'], ['pStor', 'stor'], ['pDisp', 'disp']].forEach(([key, g]) => {
        auto[`s2.${key}`] = label.p[g].length ? lines(label.p[g].map(x => `${x.code} - ${x.text}`)) : NOT_APPLICABLE;
    });
    auto['s2.other'] = result.unknownPct > 10 ? `급성 독성을 모르는 성분이 ${fmt(result.unknownPct)}% 포함되어 있음` : NO_DATA;

    // ----- 4. 응급조치 요령 -----
    const eyeSevere = has('EYE', ['1']) || isCorrosive;
    auto['s4.eye'] = lines([
        '즉시 다량의 흐르는 물로 15분 이상 눈꺼풀을 벌려 씻어내시오.', '콘택트렌즈를 끼고 있으면 가능하면 빼고 계속 씻으시오.',
        eyeSevere ? '즉시 의료기관(의사)의 진찰을 받으시오.' : '눈에 자극이 지속되면 의료기관(의사)의 진찰을 받으시오.'
    ]);
    const dermal = classOfMix('ACUTE_DERMAL')[0];
    auto['s4.skin'] = isCorrosive ? lines([
        '오염된 모든 의류를 즉시 벗고 피부를 다량의 물로 15분 이상 씻어내시오(또는 샤워하시오).', '즉시 의료기관(의사)의 진찰을 받으시오.', '오염된 의류는 다시 사용 전 세척하시오.'
    ]) : lines([
        '오염된 의류와 신발을 벗고 피부를 다량의 물과 비누로 씻으시오.',
        dermal ? (Number(dermal.k) <= 2 ? '즉시 의료기관(의사)의 진찰을 받으시오.' : '불편함을 느끼면 의료기관(의사)의 진찰을 받으시오.') : '',
        has('SKIN') || has('SKIN_SENS') ? '피부 자극 또는 홍반이 나타나면 의학적인 조치·조언을 받으시오.' : '자극이 지속되면 의료기관(의사)의 진찰을 받으시오.',
        '오염된 의류는 다시 사용 전 세척하시오.'
    ]);
    const inh = classOfMix('ACUTE_INH')[0];
    auto['s4.inh'] = lines([
        '신선한 공기가 있는 곳으로 옮기고 호흡하기 쉬운 자세로 안정을 취하시오.',
        '호흡이 불규칙하거나 멈추면 인공호흡을 하고, 호흡이 곤란하면 산소를 공급하시오.',
        (inh && Number(inh.k) <= 3) || isCorrosive ? '즉시 의료기관(의사)의 진찰을 받으시오.' : has('RESP_SENS') ? '호흡기 증상이 나타나면 의료기관(의사)의 진찰을 받으시오.' : '불편함을 느끼면 의료기관(의사)의 진찰을 받으시오.'
    ]);
    const oral = classOfMix('ACUTE_ORAL')[0];
    auto['s4.oral'] = lines([
        '입을 씻어내시오.',
        has('ASP') ? '토하게 하지 마시오. 삼켜서 기도로 유입되면 화학성 폐렴을 일으킬 수 있음.' : isCorrosive ? '토하게 하지 마시오.' : '의료인의 지시 없이 토하게 하지 마시오.',
        '의식이 없는 사람에게는 입으로 아무것도 주지 마시오.',
        has('ASP') || isCorrosive || (oral && Number(oral.k) <= 3) ? '즉시 의료기관(의사)의 진찰을 받으시오.' : '불편함을 느끼면 의료기관(의사)의 진찰을 받으시오.'
    ]);
    auto['s4.doctor'] = lines([
        '의료인력이 해당 물질에 대해 인지하고 보호조치를 취하도록 하시오.', '증상에 따라 치료하시오.',
        has('ASP') ? '삼킨 경우 폐로 흡인될 위험이 있으므로 위세척 등의 처치에 주의하시오.' : '',
        has('MUTA') || has('CARC') || has('REPRO') || has('STOT_SE', ['1', '2']) || has('STOT_RE') ? '노출되거나 노출이 우려되면 의학적인 조치·조언을 받으시오.' : ''
    ]);

    // ----- 5. 폭발·화재시 대처방법 -----
    auto['s5.media'] = lines([`적절한 소화제: ${media}`, '부적절한 소화제: 직사주수(봉상주수)는 화재를 확산시킬 수 있으므로 사용하지 마시오.']);
    auto['s5.hazard'] = lines([
        '연소 또는 열분해 시 일산화탄소, 이산화탄소 등 자극성·유독성 가스가 발생할 수 있음.',
        has('FLAM_LIQ', ['1', '2', '3']) ? '증기는 공기와 폭발성 혼합물을 만들 수 있고, 점화원까지 이동하여 역화할 수 있음.' : has('FLAM_LIQ', ['4']) ? '가열하면 가연성 증기가 발생할 수 있음.' : '',
        '가열된 용기는 내부 압력이 올라 파열될 수 있음.'
    ]);
    auto['s5.protect'] = lines([
        '화재 진압 시 자급식 공기호흡기(SCBA)와 방화복 등 적절한 보호구를 착용하시오.', '위험하지 않다면 화재 지역에서 용기를 옮기시오.',
        '화재에 노출된 용기는 물분무로 냉각하시오.', '소화수가 하수구나 수계로 흘러 들어가지 않도록 하시오.'
    ]);

    // ----- 6. 누출 사고 시 대처방법 -----
    auto['s6.person'] = lines([
        '관계자 외의 접근을 막고, 바람을 등지고 작업하시오.', '적절한 보호구(8항 참조)를 착용하고 누출물을 만지거나 밟지 마시오.',
        isFlammable ? '모든 점화원(흡연, 스파크, 화염)을 제거하고 충분히 환기하시오.' : '충분히 환기하시오.',
        isLiquid ? '누출된 곳은 미끄러울 수 있으므로 주의하시오.' : ''
    ]);
    auto['s6.env'] = lines([
        '누출물이 하수구, 수로, 지하수, 토양으로 흘러 들어가지 않도록 하시오.',
        isAquatic ? '수생생물에 유해하므로 환경으로 배출하지 마시오.' : '', '다량 누출 시 관계 기관에 알리시오.'
    ]);
    auto['s6.clean'] = isLiquid ? lines([
        '소량 누출: 모래, 규조토, 흡착포 등 불활성 흡수제로 흡수하여 밀폐할 수 있는 용기에 담으시오.',
        '다량 누출: 둑을 쌓아 확산을 막고 펌프 등으로 회수한 뒤 남은 것은 흡수제로 처리하시오.',
        isFlammable ? '스파크가 발생하지 않는 도구를 사용하시오.' : '', '수거한 누출물은 13항에 따라 폐기하시오.'
    ]) : lines(['분진이 날리지 않게 쓸어 담아 밀폐할 수 있는 용기에 넣으시오.', '수거한 누출물은 13항에 따라 폐기하시오.']);

    // ----- 7. 취급 및 저장방법 -----
    const strip = (x) => x.text;
    const uniq = (list) => [...new Set(list.filter(Boolean))];
    auto['s7.handle'] = lines(uniq([
        ...label.p.prev.map(strip),
        '취급 후에는 손 등 취급 부위를 철저히 씻으시오.', '이 제품을 사용할 때에는 먹거나, 마시거나 흡연하지 마시오.',
        '장기간 또는 반복적인 피부 접촉과 미스트·증기의 흡입을 피하시오.',
        '빈 용기에도 제품 잔여물이 남아 있을 수 있으므로 물질안전보건자료와 경고표지의 예방조치를 따르시오.'
    ]));
    auto['s7.store'] = lines(uniq([
        ...label.p.stor.map(strip),
        '직사광선과 열·점화원을 피해 서늘하고 환기가 잘 되는 곳에 보관하시오.', '용기를 단단히 밀폐하여 보관하시오.',
        '강산화제 등 피해야 할 물질(10항 참조)과 함께 보관하지 마시오.'
    ]));

    // ----- 8. 노출방지 및 개인보호구 -----
    const limitLines = infoLines(['H0202', 'H0204', 'H0206', 'H0208'], { H0202: '국내규정', H0204: 'ACGIH', H0206: '생물학적 노출기준', H0208: '기타' });
    auto['s8.limits'] = limitLines.length ? lines(limitLines) : NO_DATA;
    auto['s8.eng'] = lines(['공정 격리, 국소배기 등 공학적 관리로 공기 중 농도를 노출기준 이하로 유지하시오.', '이 제품을 저장하거나 취급하는 설비 가까이에 세안설비와 안전 샤워를 설치하시오.']);
    auto['s8.resp'] = '노출기준을 넘거나 미스트·증기가 발생하는 작업에서는 한국산업안전보건공단의 인증을 받은 호흡용 보호구(방독마스크 등)를 착용하시오.';
    auto['s8.eye'] = eyeSevere ? '고글과 보안면을 착용하시오.' : '보안경 또는 고글을 착용하시오.';
    auto['s8.hand'] = '제품의 물리·화학적 특성에 맞는 내화학성 보호장갑(니트릴 고무 등)을 착용하시오.';
    auto['s8.body'] = '내화학성 보호의 또는 작업복을 착용하고, 오염된 의류는 벗어 세척한 뒤 다시 사용하시오.';

    // ----- 9. 물리화학적 특성 -----
    const val = (v, unit = '') => { const s = String(v ?? '').trim(); return s ? `${s}${unit && /^[-+]?[\d.,]+$/.test(s) ? unit : ''}` : NO_DATA; };
    auto['s9.appearance'] = [STATE_LABELS[state] || '', String(props.color || '').trim()].filter(Boolean).join(', ') || NO_DATA;
    auto['s9.odor'] = val(props.odor);
    auto['s9.odorThr'] = val(props.odorThr);
    auto['s9.ph'] = val(props.ph);
    auto['s9.mp'] = val(props.mp, '℃');
    auto['s9.bp'] = val(props.bp, '℃');
    auto['s9.fp'] = String(props.fp ?? '').trim() ? `${val(props.fp, '℃')}${props.fpMethod ? ` (${props.fpMethod})` : ''}` : NO_DATA;
    auto['s9.evap'] = val(props.evap);
    auto['s9.flam'] = String(props.flam || '').trim() || (isLiquid ? `${NOT_APPLICABLE} (액체)` : NO_DATA);
    auto['s9.limits'] = val(props.limits);
    auto['s9.vp'] = val(props.vp);
    auto['s9.sol'] = val(props.sol);
    auto['s9.vd'] = val(props.vd);
    auto['s9.sg'] = val(props.sg);
    auto['s9.kow'] = val(props.kow);
    auto['s9.ait'] = val(props.ait, '℃');
    auto['s9.decomp'] = val(props.decomp, '℃');
    auto['s9.visc'] = [num(props.kv40) !== null ? `동점도 ${String(props.kv40).trim()} mm²/s (40℃)` : '', String(props.visc || '').trim()].filter(Boolean).join(', ') || NO_DATA;
    auto['s9.mw'] = String(props.mw || '').trim() || `${NOT_APPLICABLE} (혼합물)`;

    // ----- 10. 안정성 및 반응성 -----
    auto['s10.stable'] = '권장하는 저장·취급 조건에서 안정함. 유해한 중합 반응은 일어나지 않음.';
    auto['s10.avoid'] = lines([`열, 스파크, 화염 등 점화원${isFlammable ? ', 정전기 방전' : ''}`, '직사광선, 고온']);
    auto['s10.materials'] = '강산화제, 강산, 강염기';
    auto['s10.decomp'] = '연소 또는 열분해 시 일산화탄소, 이산화탄소 등 자극성·유독성 가스가 발생할 수 있음.';

    // ----- 11. 독성에 관한 정보 -----
    auto['s11.route'] = '흡입, 피부 접촉, 눈 접촉, 경구(삼킴)';
    // 경로별 혼합물 분류 (직접 지정한 구분 포함) + 계산한 급성독성 추정값은 제품 이름의 자료 줄로
    const acuteLine = (c, title) => {
        const list = classOfMix(c);
        return `${title}: ${list.length ? list.map(x => `${catOf(x.c, x.k)?.label || x.k}${x.form && INH_FORMS[x.form] ? ` (${INH_FORMS[x.form]})` : ''}`).join(', ') : '분류되지 않음'}`;
    };
    const ateParts = result.ate.filter(r => r.ateMix).map(r => `ATEmix ${ACUTE_ROUTES[r.route].label} ${fmt(r.ateMix)} ${ACUTE_ROUTES[r.route].unit}`);
    auto['s11.acute'] = lines([
        acuteLine('ACUTE_ORAL', '경구'), acuteLine('ACUTE_DERMAL', '경피'), acuteLine('ACUTE_INH', '흡입'),
        result.unknownPct > 10 ? `급성 독성을 모르는 성분 ${fmt(result.unknownPct)}% 포함` : '',
        ateParts.length ? `· ${String(p.name || '').trim() || '제품'}: ${ateParts.join(' ; ')}` : '',
        ...infoLines(['K040202', 'K040204', 'K040206'], { K040202: '경구', K040204: '경피', K040206: '흡입' })
    ]);
    auto['s11.skin'] = tox('SKIN', 'K0404');
    auto['s11.eye'] = tox('EYE', 'K0406');
    auto['s11.respSens'] = tox('RESP_SENS', 'K0408');
    auto['s11.skinSens'] = tox('SKIN_SENS', 'K0410');
    auto['s11.carc'] = tox('CARC', ['K041212', 'K041214', 'K041202', 'K041206', 'K041210', 'K041204', 'K041216'],
        { K041212: '산업안전보건법', K041214: '고용노동부고시', K041202: 'IARC', K041206: 'OSHA', K041210: 'ACGIH', K041204: 'NTP', K041216: 'EU CLP' });
    auto['s11.muta'] = tox('MUTA', 'K0414');
    auto['s11.repro'] = tox('REPRO', 'K0416');
    auto['s11.stotSe'] = tox('STOT_SE', 'K0418');
    auto['s11.stotRe'] = tox('STOT_RE', 'K0420');
    auto['s11.asp'] = tox('ASP', 'K0422');

    // ----- 12. 환경에 미치는 영향 -----
    const eco = [...classOfMix('AQ_ACUTE'), ...classOfMix('AQ_CHRONIC')];
    auto['s12.eco'] = lines([
        `혼합물 분류: ${eco.length ? eco.map(x => clsLabel(x)).join(', ') : '분류되지 않음'}`,
        ...infoLines(['L0202', 'L0204', 'L0206'], { L0202: '어류', L0204: '갑각류', L0206: '조류' })
    ]);
    const orNoData = (list) => (list.length ? lines(list) : NO_DATA);
    auto['s12.persist'] = orNoData(infoLines(['L0402', 'L0404'], { L0402: '잔류성', L0404: '분해성' }));
    auto['s12.bio'] = orNoData(infoLines(['L0602', 'L0604'], { L0602: '농축성', L0604: '생분해성' }));
    auto['s12.soil'] = orNoData(infoLines('L08'));
    auto['s12.other'] = orNoData([has('OZONE') ? '오존층 유해성: 구분 1' : '', ...infoLines('L10')].filter(Boolean));

    // ----- 13. 폐기시 주의사항 -----
    auto['s13.method'] = lines(['폐기물관리법 등 관련 법령에 따라 허가받은 폐기물 처리업자에게 위탁하여 처리하시오.', '폐유·폐유기용제 등 지정폐기물에 해당하면 지정폐기물 처리 기준에 따르시오.']);
    auto['s13.caution'] = lines(['빈 용기에는 제품 잔여물이 남아 있을 수 있으므로 관련 법령에 따라 처리하고, 용기를 절단·용접·가열하지 마시오.', '하수구, 하천, 토양에 버리지 마시오.']);

    // ----- 14. 운송에 필요한 정보 -----
    const t = { ...transportOf(result.classes, state), ...Object.fromEntries(Object.entries(doc.transport || {}).filter(([, v]) => String(v || '').trim())) };
    auto['s14.un'] = t.un;
    auto['s14.name'] = t.name;
    auto['s14.class'] = t.cls;
    auto['s14.pg'] = t.pg;
    auto['s14.marine'] = t.marine;
    auto['s14.special'] = t.special || (t.guessed ? lines(['운송 중 용기가 넘어지거나 손상되지 않게 고정하시오.', isFlammable ? '화기·점화원을 멀리하고 관련 법령(위험물안전관리법 등)의 운반 기준을 따르시오.' : '관련 법령의 운반 기준을 따르시오.']) : NOT_APPLICABLE);
    if (t.guessed && !Object.keys(doc.transport || {}).some(k => String(doc.transport[k] || '').trim())) warnings.push('14항(운송 정보)의 유엔 번호·등급은 분류에서 추정한 값입니다. 운송 규정에 맞는지 확인하세요.');

    // ----- 15. 법적 규제현황 (혼합물 전체로서 — 제11조제11항) -----
    // 줄 모양: '항목: 해당됨 — 성분' · '항목: 해당 없음' (인쇄할 때 항목 | 해당 여부 | 내용 세 칸). 성분이 여럿이면 두 칸 들여 쓴 줄로 잇는다
    const hasInfo = comps.some(c => c.pct > 0 && (c.source === 'KOSHA' || Object.keys(c.info).some(k => k.startsWith('O'))));
    const noHit = hasInfo ? NOT_APPLICABLE : NO_DATA;
    /** 15항에 적는 성분 이름: 3항에 적는 성분만 (대체자료는 대체명칭) — 3항에 적지 않는 성분의 이름이 15항으로 드러나지 않게 */
    const regName = (c) => (!c.listed ? '' : c.line.show === 'SECRET' ? String(c.line.secret?.name || '').trim() || '(대체명칭)' : `${c.cas ? `${c.cas}: ` : ''}${c.name}`);
    /**
     * 성분의 규제 글(공단 항목 code)을 점검 항목별로 모은 줄 목록. 점검 항목에 없는 규제는 그 이름으로 줄을 더한다
     * @param {string} code 공단 항목 코드 (O02 …)
     * @param {Array<{ label: string, re: RegExp, ke?: boolean }>} [items] 점검 항목 (없으면 해당하는 규제만 적는다)
     */
    const regLines = (code, items = []) => {
        const hits = new Map(); // 항목 이름 → 내용 글 목록
        comps.forEach(c => {
            const text = c.info[code];
            if (!text || !(c.pct > 0)) return;
            text.split(' / ').map(s => s.trim()).filter(Boolean).forEach(phrase => {
                // 산안법 등 혼합물 기준: 1% 이상 든 성분 (특별관리물질·허가·금지·제한물질은 0.1% 이상이면 적는다)
                if (c.pct < (STRICT_REG_RE.test(phrase) ? 0.1 : 1)) return;
                const item = items.find(it => it.re.test(phrase));
                const label = item ? item.label : phrase.replace(/\s*\(.*$/, '').trim() || phrase;
                const name = regName(c);
                // 공단 글의 괄호 설명(측정주기 등)은 그대로 옮기고, 기존화학물질은 고유번호(KE)를 이름 뒤에 붙인다
                const extra = item?.ke ? (name && c.keNo ? `(기존화학물질 번호: ${c.keNo})` : '') : (/\(.*\)\s*$/.exec(phrase) || [''])[0].trim();
                hits.set(label, [...(hits.get(label) || []), { name, text: [name, extra].filter(Boolean).join(' ') }]);
            });
        });
        const labels = [...items.map(it => it.label), ...[...hits.keys()].filter(l => !items.some(it => it.label === l))];
        return labels.map(label => {
            if (!hits.has(label)) return `${label}: ${noHit}`;
            // 이름을 적는 성분이 있으면 그 줄만 (이름 없는 성분의 괄호 설명만 따로 남지 않게)
            const list = hits.get(label), named = list.filter(d => d.name);
            const details = [...new Set((named.length ? named : list).map(d => d.text).filter(Boolean))];
            return lines([`${label}: ${HIT}${details.length ? ` — ${details[0]}` : ''}`, ...details.slice(1).map(d => `  ${d}`)]);
        });
    };
    auto['s15.osha'] = lines(regLines('O02', REG_ITEMS.O02));
    auto['s15.cca'] = lines(regLines('O04', REG_ITEMS.O04));
    auto['s15.kreach'] = lines(regLines('O12', REG_ITEMS.O12));
    // 공단 규제 정보가 없는 유해 성분이 있으면 '해당 없음'이 틀릴 수 있다 — 알려 준다
    const noRegInfo = comps.filter(c => c.pct >= 0.1 && (c.cls.length || c.unknown) && c.source !== 'KOSHA' && !Object.keys(c.info).some(k => k.startsWith('O')));
    if (hasInfo && noRegInfo.length) warnings.push(`15항(법적 규제현황): 공단 규제 정보가 없는 성분이 있습니다(${noRegInfo.map(c => c.name).join(', ')}) — 이 성분의 규제 해당 여부는 공급사 MSDS로 확인해 15항을 고치세요.`);
    const pctOf = (isHit) => comps.filter(c => c.pct > 0 && isHit(c.cas)).reduce((s, c) => s + c.pct, 0);
    const alcoholPct = pctOf(cas => LOWER_ALCOHOLS.has(cas)), waterPct = pctOf(cas => cas === WATER_CAS);
    // 알코올류: 알코올 자체(변성알코올 포함)나 그 수용액일 때만 자동으로 적는다. 다른 용제와 섞인 제품은 인화점 기준으로 적고 확인하게 한다
    const isAlcoholSolution = alcoholPct >= ALCOHOL_MIN_PCT && alcoholPct + waterPct >= ALCOHOL_SOLUTION_MIN_PCT;
    const dg = dangerousGoodsOf({ state, fp: props.fp, bp: props.bp, ait: props.ait, waterSoluble: !!props.waterSoluble, alcoholPct: isAlcoholSolution ? alcoholPct : 0 });
    if (isLiquid && alcoholPct >= ALCOHOL_MIN_PCT && !isAlcoholSolution) warnings.push(`탄소 1~3개의 포화 1가 알코올이 ${fmt(alcoholPct)}% 들어 있습니다. 위험물안전관리법의 알코올류(지정수량 400 L)에 해당하는지 확인하세요 — 15항은 인화점 기준으로 적었습니다.`);
    const solidDg = regLines('O06'); // 액체가 아니면 성분의 위험물 구분(공단 자료)을 옮긴다
    auto['s15.danger'] = isLiquid
        ? `${DG_LAW}: ${!dg ? NO_DATA : dg.startsWith(NOT_APPLICABLE) ? dg : `${HIT} — ${dg}`}`
        : solidDg.length ? lines(solidDg) : `${DG_LAW}: ${noHit}`;
    if (isLiquid && !dg) warnings.push('인화점이 없어 15항의 위험물안전관리법 규제(제4류 석유류 구분·지정수량)를 정하지 못했습니다.');
    // 시행령 별표 1 비고: 가연성 액체량이 40중량% 이하인 물품은 제2석유류(인화점 40℃ 이상·연소점 60℃ 이상일 때)·제3·제4석유류에서 뺀다 — 연소점은 알 수 없으므로 알려만 준다
    if (/제[234]석유류/.test(dg) && waterPct >= 100 - COMBUSTIBLE_MAX_PCT) warnings.push(`물이 ${fmt(waterPct)}% 들어 있어 가연성 액체량이 ${COMBUSTIBLE_MAX_PCT}중량% 이하입니다. 위험물안전관리법 시행령 별표 1의 제외 조건(제2석유류는 인화점 40℃ 이상이고 연소점 60℃ 이상일 때)에 해당하면 15항의 위험물안전관리법 칸을 '해당 없음'으로 고치세요.`);
    // 폐기물: 성분이 지정폐기물 관련 물질이면 적고, 제품을 버릴 때의 확인 사항은 늘 적는다 (폐유·폐유기용제는 성분과 무관하게 지정폐기물일 수 있다)
    auto['s15.waste'] = lines([...regLines('O08'), '폐기할 때 폐기물관리법에 따른 지정폐기물(폐유·폐유기용제 등)에 해당하는지 확인하여 처리하시오.']);
    const otherRegs = regLines('O100202');
    auto['s15.other'] = otherRegs.length ? lines(otherRegs) : noHit;

    // ----- 16. 그 밖의 참고사항 -----
    const sources = new Set(comps.map(c => c.source));
    auto['s16.source'] = lines([
        sources.has('KOSHA') ? '한국산업안전보건공단 화학물질정보(MSDS, msds.kosha.or.kr)' : '', sources.has('PUBCHEM') ? 'PubChem (미국 국립보건원, GHS Classification)' : '',
        '구성성분 공급자의 물질안전보건자료(MSDS)', `「화학물질의 분류·표시 및 물질안전보건자료에 관한 기준」 (${GHS_NOTICE})`
    ]);
    const rev = doc.rev || {};
    auto['s16.first'] = rev.firstDate || NO_DATA;
    auto['s16.rev'] = lines([`개정 횟수: ${Number(rev.count) || 0}회`, `최종 개정일자: ${rev.revDate || rev.firstDate || NO_DATA}`, versionText(rev) ? `버전: ${versionText(rev)}` : '']);
    auto['s16.etc'] = NO_DATA; // 문서 끝의 안내 글(MSDS_DISCLAIMER)은 인쇄할 때 따로 붙는다

    // 사람이 고친 글이 우선
    const texts = doc.texts || {};
    const text = {};
    const edited = [];
    MSDS_TEXT_KEYS.forEach(key => {
        const own = texts[key];
        if (typeof own === 'string' && own !== (auto[key] ?? '')) { text[key] = own; edited.push(key); } else text[key] = auto[key] ?? '';
    });
    if (!p.name) warnings.push('제품명을 입력하세요.');
    if (!sup.company || !sup.phone) warnings.push('공급자 정보(회사명·주소·긴급전화번호)를 입력하세요.');
    return { result, label, comps, s3, s3Note, auto, text, edited, warnings, transportGuessed: !!t.guessed };
};

/** 분류 결과에서 그 분류의 이름 (근거 표용) */
export const classTitle = (x) => `${classOf(x.c)?.label || x.c}`;
