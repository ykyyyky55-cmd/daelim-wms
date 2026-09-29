// ==========================================
// 제품 규격 (품질관리: 공정관리 원액 검사 · 제품관리 제품 규격 · 제품시험성적서)
// ==========================================
// 제품 하나 = wms_qc_records 한 줄 (kind QCSPEC, supabase/auth/53_qc_blend_tests.sql)
//   { productName, itemCode, category(구분), subCategory(종류), type(제품 유형), waterBased(수용성),
//     options: { sae, api[], acea[], brakeClass('4'|'6'), dot4 }, woItems(작업지시서 검사항목 [{item, standard}]),
//     overrides: { [항목 key]: 규격 글자 }, source('WO'|'MANUAL'), recipeRev, syncedAt }
// 검사항목은 저장하지 않고 그때그때 만든다: 유형별 KS 서식 + (엔진오일) SAE J300·API·ACEA / (브레이크액) KS 4종·6종·DOT4
//   + 작업지시서 기준(같은 항목이면 작업지시서 값) + 직접 고친 값(overrides)
// 원액 검사 기록은 kind BTEST (공정관리 → 원액생산 → 검사 기록·관리도)
// ※ 규격값은 앱 기본값입니다. 규격서 최신판(KS·API·ACEA·FMVSS 116)과 다르면 [제품 규격]에서 고쳐 쓰세요.
import { listQc, saveQc, upsertQc, deleteQc } from './quality.js';

// ---------- 시험방법 (KS) ----------
export const KS_METHOD = {
    appearance: '육안', sg: 'KS M ISO 12185', kv40: 'KS M ISO 3104', kv100: 'KS M ISO 3104', kvm40: 'KS M ISO 3104', vi: 'KS M ISO 2909',
    flash: 'KS M ISO 2592', pour: 'KS M ISO 3016', water: 'KS M ISO 12937', tan: 'KS M ISO 6619', tbn: 'KS M ISO 3771', sash: 'KS M ISO 3987',
    cu: 'KS M ISO 2160', foam: 'KS M ISO 6247', sulfur: 'KS M ISO 20846', phos: 'ASTM D4951', ph: 'pH 미터', brix: '굴절계',
    ccs: 'ASTM D5293', mrv: 'ASTM D4684', hths: 'ASTM D4683', noack: 'ASTM D5800', erbp: 'KS M 2141', werbp: 'KS M 2141',
    ash: 'KS M 2142', metal: '석유관리원 시험'
};

// ---------- 항목 정의 (key → 이름·단위) ----------
export const QC_ITEM_DEFS = {
    appearance: { name: '외관', numeric: false },
    sg: { name: '비중 (15/4℃)' },
    kv40: { name: '동점도 (40℃), ㎟/s' },
    kv100: { name: '동점도 (100℃), ㎟/s' },
    kvm40: { name: '동점도 (-40℃), ㎟/s' },
    vi: { name: '점도지수' },
    flash: { name: '인화점 (COC), ℃' },
    pour: { name: '유동점, ℃' },
    water: { name: '수분, %' },
    tan: { name: '전산가 (TAN), mgKOH/g' },
    tbn: { name: '전염기가 (TBN), mgKOH/g' },
    sash: { name: '황산회분, %' },
    cu: { name: '동판부식 (100℃, 3h)', numeric: false },
    foam: { name: '기포성 (Seq. I), ㎖', numeric: false },
    sulfur: { name: '황분, %' },
    phos: { name: '인(P), %' },
    ph: { name: 'pH' },
    brix: { name: 'Brix, %' },
    ccs: { name: '저온 겉보기점도 (CCS), mPa·s' },
    mrv: { name: '저온 펌핑점도 (MRV), mPa·s' },
    hths: { name: '고온 고전단 점도 (HTHS, 150℃), mPa·s' },
    noack: { name: '증발손실 (NOACK), %' },
    erbp: { name: '평형환류비점 (ERBP), ℃' },
    werbp: { name: '습윤 평형환류비점 (Wet ERBP), ℃' },
    // 부동액 (KS M 2142:2015 표 2)
    sg2020: { name: '비중 (원액, 20/20℃)' },
    sg155: { name: '비중 (원액, 15.5/15.5℃)' },
    freeze: { name: '어는점 (50 vol% 수용액), ℃' },
    freeze30: { name: '어는점 (30 vol% 수용액), ℃' },
    ph30: { name: 'pH (30 vol% 수용액)' },
    ph50: { name: 'pH (50 vol% 수용액)' },
    alk: { name: '예비 알칼리도 (원액), ㎖' },
    boil: { name: '끓는점 (원액), ℃' },
    foam30: { name: '거품성 (30 vol% 수용액), ㎖' },
    ash: { name: '회분, %' },
    metal: { name: '금속분 (Mn·Fe 등)', numeric: false }
};
// 부동액 금속부식성(30 vol% 조합 수용액, 88℃, 336h) · 순환부식성(30 vol%, 88℃, 1,000h) 항목
const AF_METALS = [['al', '알루미늄 주물'], ['fe', '주철'], ['st', '강'], ['br', '황동'], ['sd', '땜납'], ['cu', '구리']];
[['mc', '금속부식성(336h)'], ['cc', '순환부식성(1,000h)']].forEach(([p, label]) => {
    AF_METALS.forEach(([m, name]) => { QC_ITEM_DEFS[`${p}_${m}`] = { name: `${label} · ${name} 무게 변화, mg/㎠` }; });
    Object.assign(QC_ITEM_DEFS, {
        [`${p}_look`]: { name: `${label} · 시험편 겉모양`, numeric: false },
        [`${p}_ph`]: { name: `${label} · 시험 후 pH` },
        [`${p}_dph`]: { name: `${label} · 시험 후 pH 변화` },
        [`${p}_alk`]: { name: `${label} · 예비 알칼리도 변화, %` },
        [`${p}_liq`]: { name: `${label} · 시험 후 액상`, numeric: false }
    });
});
Object.assign(QC_ITEM_DEFS, {
    mc_foam: { name: '금속부식성(336h) · 시험 중 기포', numeric: false },
    mc_ppt: { name: '금속부식성(336h) · 침전량, vol%' },
    cc_pump: { name: '순환부식성(1,000h) · 펌프 실부', numeric: false },
    cc_casing: { name: '순환부식성(1,000h) · 펌프 케이싱 내면·날개', numeric: false },
    al_heat: { name: '알루미늄 주물 전열면 부식성 (25 vol%, 135℃, 168h)', numeric: false }
});
Object.keys(QC_ITEM_DEFS).filter(k => /^(sg2020|sg155|freeze|freeze30|ph30|ph50|alk|boil|foam30|mc_|cc_|al_heat)/.test(k)).forEach(k => { KS_METHOD[k] = 'KS M 2142'; });

// ---------- 규격 글자 해석 · 판정 ----------
const num = (s) => Number(String(s).replace(/,/g, ''));
/**
 * 규격 글자를 범위로 바꾼다. 숫자 범위가 아니면(예: '투명 적색') null
 * '0.85 ± 0.03' · '7.0~11.5' · '230 이상' · '750 이하' · '9.3 이상 12.5 미만' · '≥ 1.5' · '-24 이하'
 * @returns {{ lo: number|null, hi: number|null, loOpen: boolean, hiOpen: boolean, target: number|null } | null}
 */
export const parseSpec = (spec) => {
    // 괄호 안 조건(예: '(30 vol%)')과 단위는 떼고 숫자 범위만 본다
    const s = String(spec || '').replace(/\([^)]*\)/g, ' ').replace(/㎟\/s|mm²\/s|mgKOH\/g|mPa·s|cSt|℃|%/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s || s === '-') return null;
    const N = '(-?\\d[\\d,]*(?:\\.\\d+)?)';
    let m = s.match(new RegExp(`^${N}\\s*(?:±|\\+/-)\\s*${N}$`));
    if (m) { const c = num(m[1]); const d = Math.abs(num(m[2])); return { lo: c - d, hi: c + d, loOpen: false, hiOpen: false, target: c }; }
    m = s.match(new RegExp(`^(?:±|\\+/-)\\s*${N}$`)); // '±0.30' (무게 변화·pH 변화처럼 0 기준)
    if (m) { const d = Math.abs(num(m[1])); return { lo: -d, hi: d, loOpen: false, hiOpen: false, target: 0 }; }
    m = s.match(new RegExp(`^${N}\\s*(?:~|〜|–|-(?=\\s*\\d))\\s*${N}$`));
    if (m) { const a = num(m[1]); const b = num(m[2]); return { lo: Math.min(a, b), hi: Math.max(a, b), loOpen: false, hiOpen: false, target: (a + b) / 2 }; }
    m = s.match(new RegExp(`^${N}\\s*(이상|초과)\\s*${N}\\s*(이하|미만)$`));
    if (m) return { lo: num(m[1]), hi: num(m[3]), loOpen: m[2] === '초과', hiOpen: m[4] === '미만', target: (num(m[1]) + num(m[3])) / 2 };
    m = s.match(new RegExp(`^(?:≥|>=|>)\\s*${N}$`)) || s.match(new RegExp(`^${N}\\s*(이상|초과)$`));
    if (m) return { lo: num(m[1]), hi: null, loOpen: /초과|^>(?!=)/.test(s), hiOpen: false, target: null };
    m = s.match(new RegExp(`^(?:≤|<=|<)\\s*${N}$`)) || s.match(new RegExp(`^${N}\\s*(이하|미만)$`));
    if (m) return { lo: null, hi: num(m[1]), loOpen: false, hiOpen: /미만|^<(?!=)/.test(s), target: null };
    return null;
};

/** 결과 값이 규격에 맞는지: 'OK' | 'NG' | '' (숫자 규격이 아니거나 값이 숫자가 아니면 '') */
export const judgeValue = (value, spec) => {
    const r = typeof spec === 'object' && spec !== null ? spec : parseSpec(spec);
    const v = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!r || !v) return '';
    const x = Number(v[0]);
    if (r.lo != null && (r.loOpen ? x <= r.lo : x < r.lo)) return 'NG';
    if (r.hi != null && (r.hiOpen ? x >= r.hi : x > r.hi)) return 'NG';
    return 'OK';
};

/** 범위 → 규격 글자 */
const fmt = (n) => String(Math.round(n * 1e6) / 1e6);
export const specText = ({ lo = null, hi = null, loOpen = false, hiOpen = false }) => {
    if (lo != null && hi != null && lo < 0 && lo === -hi && !loOpen && !hiOpen) return `±${fmt(hi)}`;
    if (lo != null && hi != null) return loOpen || hiOpen ? `${fmt(lo)} ${loOpen ? '초과' : '이상'} ${fmt(hi)} ${hiOpen ? '미만' : '이하'}` : `${fmt(lo)} ~ ${fmt(hi)}`;
    if (lo != null) return `${fmt(lo)} ${loOpen ? '초과' : '이상'}`;
    if (hi != null) return `${fmt(hi)} ${hiOpen ? '미만' : '이하'}`;
    return '';
};

// ---------- 작업지시서 검사항목 이름 → key ----------
export const itemKeyOf = (name) => {
    const n = String(name || '').replace(/\s+/g, '');
    if (/외관|성상|색상/.test(n)) return 'appearance';
    if (/비중|밀도/.test(n)) return 'sg';
    if (/동점도.*-40/.test(n)) return 'kvm40';
    if (/동점도.*100/.test(n)) return 'kv100';
    if (/동점도.*40/.test(n)) return 'kv40';
    if (/점도지수/.test(n)) return 'vi';
    if (/인화점/.test(n)) return 'flash';
    if (/유동점/.test(n)) return 'pour';
    if (/수분/.test(n)) return 'water';
    if (/전산가|TAN/i.test(n)) return 'tan';
    if (/전염기가|TBN/i.test(n)) return 'tbn';
    if (/황산회분/.test(n)) return 'sash';
    if (/동판|금속부식\(Cu\)/i.test(n)) return 'cu';
    if (/^pH.*\(?30\s?(%|vol)/i.test(n)) return 'ph30'; // 부동액 30 vol% 수용액 pH (원액 pH와 따로)
    if (/^pH.*\(?50\s?(%|vol)/i.test(n)) return 'ph50';
    if (/^pH/i.test(n)) return 'ph';
    if (/brix/i.test(n)) return 'brix';
    if (/습윤.*(비점|끓는점)|wet/i.test(n)) return 'werbp';
    if (/환류|ERBP/i.test(n)) return 'erbp';
    if (/(빙점|어는점).*30/.test(n)) return 'freeze30';
    if (/빙점|어는점/.test(n)) return 'freeze';
    if (/황분|유황/.test(n)) return 'sulfur';
    return '';
};

// ---------- 제품 유형 ----------
const I = (key, spec = '', basis = '') => ({ key, spec, basis });
export const PRODUCT_TYPES = {
    ENGINE: {
        label: '엔진오일', basis: 'KS M 2121', desc: 'KS M 2121 내연기관용 윤활유 + SAE J300 점도등급 + API·ACEA',
        // 점도 항목(동점도·점도지수·저온 겉보기점도·저온 펌핑점도·HTHS)을 앞에 모은다. 값은 SAE 등급·작업지시서에서 채운다
        items: [I('appearance', '맑고 투명, 이물 없음'), I('sg'), I('kv40'), I('kv100'), I('vi'), I('ccs'), I('mrv'), I('hths'), I('flash'), I('pour'), I('tbn'), I('sash'), I('noack'), I('water', '0.05 이하'), I('cu', '1b 이하'), I('foam', '10/0 이하')]
    },
    BRAKE: {
        label: '브레이크액', basis: 'KS M 2141', desc: 'KS M 2141 자동차용 비광유계 브레이크액 4종·6종, DOT4(FMVSS 116)',
        items: [I('appearance', '맑고 투명, 이물·침전 없음'), I('sg'), I('erbp'), I('werbp'), I('kvm40'), I('kv100', '1.5 이상'), I('ph', '7.0 ~ 11.5'), I('water')]
    },
    ANTIFREEZE: {
        // 부동액 원액(25~60 vol% 수용액으로 쓰는 것)에만 적용. 첨가제·색소·소포제·희석(프리믹스) 제품은 '수용성 제품'
        // 항목·값은 종류(EG 1종 AF / EG 2종 LLC / PG 2종 LLC)마다 다르므로 antifreezeItems(kind)가 만든다
        label: '부동액 (원액)', basis: 'KS M 2142', desc: 'KS M 2142:2015 부동액 (원액을 25~60 vol% 수용액으로 사용). 종류: 에틸렌글라이콜 1종 AF·2종 LLC, 프로필렌글라이콜 2종 LLC',
        items: []
    },
    FUEL: {
        label: '연료첨가제', basis: 'KS 시험방법', desc: '연료첨가제 (KS 시험방법 + 대기환경보전법 첨가제 제조기준 항목, 기준값은 제품별로 입력)',
        items: [I('appearance', '맑고 투명, 이물 없음'), I('sg'), I('kv40'), I('flash'), I('water'), I('sulfur'), I('metal', '불검출')]
    },
    WATER: {
        label: '수용성 제품', basis: '작업지시서', desc: '수용성 제품 (요소수·세정제·냉각수 첨가제 등)',
        items: [I('appearance'), I('sg'), I('ph'), I('brix')]
    },
    OIL: {
        label: '윤활유·첨가제 (유성)', basis: 'KS 시험방법', desc: '유성 제품 (윤활유·코팅제·첨가제·세척제 등)',
        items: [I('appearance'), I('sg'), I('kv40'), I('kv100'), I('vi'), I('flash'), I('pour'), I('water')]
    }
};

/** 공정관리(원액생산) 기본 검사항목: 유성 = 외관·비중·동점도 / 수용성 = 외관·비중·pH */
export const processKeysOf = (spec) => {
    if (spec?.waterBased) {
        // pH는 작업지시서에 있는 조건을 쓴다 (부동액 원액은 30 vol%·50 vol% 수용액 pH)
        const has = (k) => (spec?.woItems || []).some(q => itemKeyOf(q.item) === k);
        const ph = ['ph', 'ph30', 'ph50'].find(has) || (spec?.type === 'ANTIFREEZE' ? (afKindOf(spec.options) === 'PG2' ? 'ph50' : 'ph30') : 'ph');
        return ['appearance', 'sg', ph];
    }
    const kv = kvKeyOf(spec);
    return ['appearance', 'sg', kv];
};
// 동점도는 작업지시서에 숫자 기준이 있는 온도를 쓴다 (없으면 엔진오일 100℃, 그 밖 40℃)
const kvKeyOf = (spec) => {
    const has = (k) => (spec?.woItems || []).some(q => itemKeyOf(q.item) === k && parseSpec(q.standard));
    if (has('kv40')) return 'kv40';
    if (has('kv100')) return 'kv100';
    if (has('kvm40')) return 'kvm40';
    return spec?.type === 'ENGINE' ? 'kv100' : 'kv40';
};

// ---------- SAE J300 점도등급 ----------
const SAE_HOT = { 8: [4.0, 6.1, 1.7], 12: [5.0, 7.1, 2.0], 16: [6.1, 8.2, 2.3], 20: [6.9, 9.3, 2.6], 30: [9.3, 12.5, 2.9], 40: [12.5, 16.3, 3.5], 50: [16.3, 21.9, 3.7], 60: [21.9, 26.1, 3.7] };
const SAE_COLD = { 0: [6200, -35, -40, 3.8], 5: [6600, -30, -35, 3.8], 10: [7000, -25, -30, 4.1], 15: [7000, -20, -25, 5.6], 20: [9500, -15, -20, 5.6], 25: [13000, -10, -15, 9.3] };
export const SAE_GRADES = ['0W-8', '0W-12', '0W-16', '0W-20', '0W-30', '0W-40', '5W-20', '5W-30', '5W-40', '5W-50', '10W-30', '10W-40', '10W-50', '15W-40', '15W-50', '20W-50', '20W-60', '25W-60',
    'SAE 20', 'SAE 30', 'SAE 40', 'SAE 50', 'SAE 60']; // 단급(monograde): 100℃ 동점도·HTHS만
/** 100℃ 동점도가 들어가는 SAE 고온 등급 (범위가 겹쳐 여럿일 수 있음, 예: 7.5 → ['16', '20']) */
export const saeHotGradesFor = (kv100) => Object.entries(SAE_HOT).filter(([, [lo, hi]]) => kv100 >= lo && kv100 < hi).map(([g, [lo, hi, hths]]) => ({ grade: `SAE ${g}`, lo, hi, hths }));
/** 글자에서 SAE 점도등급 찾기 (예: '0W20' → '0W-20', 'MOTOR 2T SAE20' → 'SAE 20') */
export const parseSae = (text) => {
    const t = String(text || '').toUpperCase();
    const m = t.match(/(\d{1,2})\s*W\s*-?\s*(\d{1,2})/);
    if (m) return SAE_COLD[Number(m[1])] !== undefined && SAE_HOT[Number(m[2])] ? `${Number(m[1])}W-${Number(m[2])}` : '';
    const mono = t.match(/SAE\s*-?\s*(\d{2})(?!\s*W|\d)/);
    return mono && Number(mono[1]) >= 20 && SAE_HOT[Number(mono[1])] ? `SAE ${Number(mono[1])}` : '';
};
const saeRules = (sae) => {
    const mono = String(sae || '').match(/^SAE (\d+)$/);
    if (mono) {
        const hot = SAE_HOT[Number(mono[1])];
        if (!hot) return [];
        const b = `SAE J300 ${sae}`;
        return [{ key: 'kv100', lo: hot[0], hi: hot[1], hiOpen: true, basis: b }, { key: 'hths', lo: Number(mono[1]) >= 40 ? 3.7 : hot[2], basis: b }];
    }
    const m = String(sae || '').match(/^(\d+)W-(\d+)$/);
    if (!m) return [];
    const w = Number(m[1]); const h = Number(m[2]);
    const hot = SAE_HOT[h]; const cold = SAE_COLD[w];
    if (!hot || !cold) return [];
    const hths = h === 40 && w >= 15 ? 3.7 : hot[2];
    const b = `SAE J300 ${sae}`;
    return [
        { key: 'kv100', lo: Math.max(hot[0], cold[3]), hi: hot[1], hiOpen: true, basis: b },
        { key: 'ccs', hi: cold[0], basis: b, note: `${cold[1]}℃` },
        { key: 'mrv', hi: 60000, basis: b, note: `${cold[2]}℃, 항복응력 없음` },
        { key: 'hths', lo: hths, basis: b }
    ];
};

// ---------- API (엔진오일 규격) ----------
// 저점도(xW-20·xW-30) 가솔린 규격의 인·황 한계는 해당 점도등급에만 적용
const lowVis = (sae) => /W-(8|12|16|20|30)$/.test(sae || '');
export const API_GRADES = ['SP', 'SN PLUS', 'SN', 'SM', 'SL', 'CK-4', 'FA-4', 'CJ-4', 'CI-4'];
const apiRules = (g, sae) => {
    const b = `API ${g}`;
    const gas = { SP: 1, 'SN PLUS': 1, SN: 1, SM: 1, SL: 1 }[g];
    if (gas) {
        const out = [{ key: 'noack', hi: 15, basis: b }];
        if (lowVis(sae)) {
            if (g === 'SL') out.push({ key: 'phos', hi: 0.10, basis: `${b} (xW-20/30)` }); // SL은 인 상한만, 황 한계 없음
            else {
                out.push({ key: 'phos', lo: g === 'SM' ? null : 0.06, hi: 0.08, basis: `${b} (xW-20/30)` });
                out.push({ key: 'sulfur', hi: /^10W/.test(sae) ? (g === 'SM' ? 0.7 : 0.6) : 0.5, basis: `${b} (xW-20/30)` });
            }
        }
        return out;
    }
    if (g === 'CI-4') return [{ key: 'noack', hi: 15, basis: b }, { key: 'hths', lo: 3.5, basis: b }];
    if (g === 'FA-4') return [{ key: 'hths', lo: 2.9, hi: 3.2, basis: b }, { key: 'sash', hi: 1.0, basis: b }, { key: 'phos', hi: 0.12, basis: b }, { key: 'sulfur', hi: 0.4, basis: b }, { key: 'noack', hi: 13, basis: b }];
    return [{ key: 'hths', lo: 3.5, basis: b }, { key: 'sash', hi: 1.0, basis: b }, { key: 'phos', hi: 0.12, basis: b }, { key: 'sulfur', hi: 0.4, basis: b }, { key: 'noack', hi: 13, basis: b }];
};

// ---------- ACEA (유럽 엔진오일 규격, 2021 기준 기본값) ----------
// [HTHS 하한, HTHS 상한, 황산회분 하한, 황산회분 상한, 인 하한, 인 상한, 황 상한, TBN 하한, NOACK 상한]
const ACEA = {
    'A3/B4': [3.5, null, 0.9, 1.6, null, null, null, 10, 13], 'A5/B5': [2.9, 3.5, null, 1.6, null, null, null, 8, 13], 'A7/B7': [2.9, 3.5, null, 1.6, null, null, null, 6, 13],
    C2: [2.9, null, null, 0.8, 0.07, 0.09, 0.3, 6, 13], C3: [3.5, null, null, 0.8, 0.07, 0.09, 0.3, 6, 13], C4: [3.5, null, null, 0.5, null, 0.09, 0.2, 6, 11],
    C5: [2.6, 2.9, null, 0.8, 0.07, 0.09, 0.3, 6, 13], C6: [2.6, 2.9, null, 0.8, 0.07, 0.09, 0.3, 6, 13],
    E4: [3.5, null, null, 2.0, null, null, null, 12, 13], E6: [3.5, null, null, 1.0, null, 0.08, 0.3, 7, 13], E7: [3.5, null, null, 2.0, null, null, null, 9, 13],
    E8: [3.5, null, null, 1.0, null, 0.12, 0.4, 7, 13], E11: [3.2, 3.5, null, 1.0, null, 0.12, 0.4, 7, 13]
};
export const ACEA_GRADES = Object.keys(ACEA);
const aceaRules = (g) => {
    const v = ACEA[g];
    if (!v) return [];
    const b = `ACEA ${g}`;
    const [hl, hh, sl, sh, pl, ph, s, tbn, noack] = v;
    return [
        { key: 'hths', lo: hl, hi: hh, basis: b }, { key: 'sash', lo: sl, hi: sh, basis: b },
        ...(pl != null || ph != null ? [{ key: 'phos', lo: pl, hi: ph, basis: b }] : []),
        ...(s != null ? [{ key: 'sulfur', hi: s, basis: b }] : []),
        { key: 'tbn', lo: tbn, basis: b }, { key: 'noack', hi: noack, basis: b }
    ];
};

// ---------- 부동액 (KS M 2142:2015 표 1·표 2) ----------
export const AF_KINDS = { EG1: 'EG 1종 (AF)', EG2: 'EG 2종 (LLC)', PG2: 'PG 2종 (LLC)' };
// 금속별 무게 변화 한계 ±mg/㎠ [알루미늄 주물, 주철, 강, 황동, 땜납, 구리]
const AF_MC = { EG1: [0.60, 0.30, 0.30, 0.30, 0.60, 0.30], EG2: [0.30, 0.15, 0.15, 0.15, 0.30, 0.15], PG2: [0.30, 0.15, 0.10, 0.10, 0.30, 0.10] };
const AF_CC = { EG1: [0.60, 0.30, 0.30, 0.30, 0.60, 0.30], EG2: [0.60, 0.30, 0.30, 0.30, 0.60, 0.30], PG2: [0.60, 0.20, 0.20, 0.20, 0.60, 0.20] };
const afKindOf = (o) => (AF_KINDS[o?.afKind] ? o.afKind : 'EG2');
/** 숫자 한계 (작업지시서 기준이 있으면 그 안으로 좁힌다) */
const antifreezeRules = (o) => {
    const k = afKindOf(o); const pg = k === 'PG2';
    const b = `KS M 2142 ${AF_KINDS[k]}`;
    return [
        pg ? { key: 'sg155', lo: 1.030, hi: 1.065 } : { key: 'sg2020', lo: 1.114 },
        { key: 'freeze', hi: pg ? -32.0 : -34.0 }, ...(pg ? [] : [{ key: 'freeze30', hi: -14.5 }]),
        pg ? { key: 'ph50', lo: 7.5, hi: 11.0 } : { key: 'ph30', lo: 7.0, hi: 11.0 },
        { key: 'boil', lo: pg ? 152 : 155 }, { key: 'foam30', hi: 4 }, { key: 'water', hi: 5.0 },
        ...AF_METALS.map(([m], i) => ({ key: `mc_${m}`, lo: -AF_MC[k][i], hi: AF_MC[k][i] })),
        { key: 'mc_ph', lo: 6.5, hi: 11.0 }, { key: 'mc_dph', lo: -1.0, hi: 1.0 }, { key: 'mc_ppt', hi: 0.5 },
        ...AF_METALS.map(([m], i) => ({ key: `cc_${m}`, lo: -AF_CC[k][i], hi: AF_CC[k][i] })),
        { key: 'cc_ph', lo: 6.5, hi: 11.0 }, { key: 'cc_dph', lo: -1.0, hi: 1.0 }
    ].map(r => ({ ...r, basis: b }));
};
/** 항목 순서와 글자 규격 (표 2 순서) */
const antifreezeItems = (o) => {
    const pg = afKindOf(o) === 'PG2';
    const look = '시험편과 스페이서 접촉부 이외에 육안 부식 없음 (변색은 지장 없음)';
    const liq = '색의 심한 변화, 분리·겔 발생 등 심한 변화 없음';
    const metals = (p) => AF_METALS.map(([m]) => I(`${p}_${m}`));
    return [
        I('appearance', '침전물이 없는 균질한 액체, 적당히 착색'), I(pg ? 'sg155' : 'sg2020'), I('freeze'), ...(pg ? [] : [I('freeze30')]), I(pg ? 'ph50' : 'ph30'),
        I('alk', '보고'), I('boil'), I('foam30'), I('water'),
        ...metals('mc'), I('mc_look', look), I('mc_foam', '냉각기에서 거품이 넘치지 않을 것'), I('mc_ph'), I('mc_dph'), I('mc_alk', '보고'), I('mc_liq', liq), I('mc_ppt'),
        ...metals('cc'), I('cc_look', look), I('cc_ph'), I('cc_dph'), I('cc_alk', '보고'), I('cc_liq', liq), I('cc_pump', '운전 중 작동 불량 없음, 액 누출·이상음 없음'), I('cc_casing', '심한 부식 없음'),
        I('al_heat', '참고')
    ];
};
/** 부동액 원액인지 (첨가제·색소·소포제·희석(프리믹스) 제품은 아님) */
export const isAntifreezeConcentrate = ({ productName = '', woItems = [] }) => {
    const n = String(productName);
    if (/원액|100\s?%|concentrate/i.test(n)) return true;
    if (/첨가|색소|소포|프리믹스|premix|희석|\d{1,2}\s?%/i.test(n)) return false;
    const sg = woItems.find(q => itemKeyOf(q.item) === 'sg');
    const r = sg && parseSpec(sg.standard);
    return !!(r && (r.target ?? r.lo) >= 1.10); // 원액 비중(약 1.11 이상)이면 원액으로 본다
};

// ---------- 브레이크액 (KS M 2141 4종·6종, DOT4) ----------
const BRAKE = { 4: { erbp: 230, werbp: 155, kvm40: 1800 }, 6: { erbp: 250, werbp: 165, kvm40: 750 } };
const brakeRules = ({ brakeClass = '4', dot4 = false }) => {
    const c = BRAKE[brakeClass] || BRAKE[4];
    const b = `KS M 2141 ${brakeClass === '6' ? '6' : '4'}종`;
    const out = [{ key: 'erbp', lo: c.erbp, basis: b }, { key: 'werbp', lo: c.werbp, basis: b }, { key: 'kvm40', hi: c.kvm40, basis: b }, { key: 'kv100', lo: 1.5, basis: b }, { key: 'ph', lo: 7.0, hi: 11.5, basis: b }];
    if (dot4) out.push({ key: 'erbp', lo: 230, basis: 'DOT4' }, { key: 'werbp', lo: 155, basis: 'DOT4' }, { key: 'kvm40', hi: 1800, basis: 'DOT4' }, { key: 'kv100', lo: 1.5, basis: 'DOT4' }, { key: 'ph', lo: 7.0, hi: 11.5, basis: 'DOT4' });
    return out;
};

/** 같은 항목의 한계를 가장 엄격한 쪽으로 합친다 */
const mergeRules = (rules) => {
    const by = new Map();
    rules.forEach(r => {
        const o = by.get(r.key) || { key: r.key, lo: null, hi: null, loOpen: false, hiOpen: false, basis: [], note: '' };
        if (r.lo != null && (o.lo == null || r.lo > o.lo)) { o.lo = r.lo; o.loOpen = !!r.loOpen; }
        if (r.hi != null && (o.hi == null || r.hi < o.hi)) { o.hi = r.hi; o.hiOpen = !!r.hiOpen; }
        if (r.basis && !o.basis.includes(r.basis)) o.basis.push(r.basis);
        if (r.note) o.note = r.note;
        by.set(r.key, o);
    });
    return by;
};

/**
 * 제품 규격 → 검사항목 목록
 * @param {Object} spec QCSPEC 기록
 * @param {{ scope?: 'test'|'process' }} [opt] test = 제품시험성적서 전체 / process = 원액생산 기본 항목만
 * @returns {{ key: string, name: string, method: string, spec: string, basis: string, numeric: boolean }[]}
 */
export const buildItems = (spec, { scope = 'test' } = {}) => {
    const T = PRODUCT_TYPES[spec?.type] || PRODUCT_TYPES.OIL;
    const o = spec?.options || {};
    const rules = [];
    if (spec?.type === 'ENGINE') {
        rules.push(...saeRules(o.sae));
        (o.api || []).forEach(g => rules.push(...apiRules(g, o.sae)));
        (o.acea || []).forEach(g => rules.push(...aceaRules(g)));
    }
    if (spec?.type === 'BRAKE') rules.push(...brakeRules(o));
    if (spec?.type === 'ANTIFREEZE') rules.push(...antifreezeRules(o));
    const tItems = spec?.type === 'ANTIFREEZE' ? antifreezeItems(o) : T.items;
    const merged = mergeRules(rules);
    // 작업지시서 기준 (같은 항목 여러 줄이면 숫자 기준이 있는 첫 줄)
    const wo = new Map();
    (spec?.woItems || []).forEach(q => {
        const k = itemKeyOf(q.item); const std = String(q.standard || '').trim();
        if (!k || !std || std === '-') return;
        if (!wo.has(k) || (!parseSpec(wo.get(k).standard) && parseSpec(std))) wo.set(k, { item: q.item, standard: std });
    });
    // 제품시험은 유형 서식 순서(엔진오일 = 점도 항목을 앞에)를 따르고, 서식에 없는 항목은 뒤에 붙인다
    const keys = scope === 'process' ? processKeysOf(spec)
        : [...new Set([...tItems.map(x => x.key), ...processKeysOf(spec), ...merged.keys(), ...wo.keys()])];
    const base = new Map(tItems.map(x => [x.key, x]));
    return keys.filter(k => QC_ITEM_DEFS[k]).map(k => {
        const def = QC_ITEM_DEFS[k];
        const m = merged.get(k);
        const override = String(spec?.overrides?.[k] ?? '').trim();
        let text = ''; let basis = ''; let conflict = false;
        if (override) { text = override; basis = '직접 입력'; }
        else if (wo.has(k) && (!m || parseSpec(wo.get(k).standard))) {
            // 작업지시서 기준이 있으면 우선하되, 규격(KS·SAE·API·ACEA) 범위 안으로 좁힌다
            text = wo.get(k).standard; basis = '작업지시서';
            if (m) {
                const w = parseSpec(text);
                const lo = [w?.lo, m.lo].filter(v => v != null); const hi = [w?.hi, m.hi].filter(v => v != null);
                const nar = { lo: lo.length ? Math.max(...lo) : null, hi: hi.length ? Math.min(...hi) : null, loOpen: m.lo != null && (w?.lo == null || m.lo >= w.lo) ? m.loOpen : false, hiOpen: m.hi != null && (w?.hi == null || m.hi <= w.hi) ? m.hiOpen : false };
                const empty = nar.lo != null && nar.hi != null && (nar.lo > nar.hi || (nar.lo === nar.hi && (nar.loOpen || nar.hiOpen)));
                // 두 범위가 겹치지 않으면(예: 5W-30인데 작업지시서 동점도가 SAE 40 범위) 작업지시서 값을 두고 경고
                if (empty) { basis = `작업지시서 ⚠ ${m.basis.join('·')} 범위(${specText(m)})와 맞지 않음`; conflict = true; }
                else if (specText(nar) !== specText(w || {})) { text = specText(nar); basis = `작업지시서 + ${m.basis.join('·')}`; } else basis = `작업지시서 (${m.basis.join('·')} 이내)`;
            }
        } else if (m) { text = specText(m) + (m.note ? ` (${m.note})` : ''); basis = m.basis.join('·'); }
        else if (base.has(k)) { text = base.get(k).spec; basis = text ? T.basis : ''; }
        // SAE J300에 기준이 없는 점도 항목은 실측값을 기록한다 (회사 기준이 있으면 [규격]에 입력)
        if (!text && spec?.type === 'ENGINE' && spec?.options?.sae && ['kv40', 'vi'].includes(k)) basis = '실측 기록 (SAE J300 기준 없음)';
        return { key: k, name: def.name, method: KS_METHOD[k] || '', spec: text, basis, numeric: def.numeric !== false, conflict };
    });
};

/** 규격과 작업지시서 기준이 맞지 않는 항목 (예: SAE 등급과 동점도 기준 불일치) */
export const specConflicts = (spec) => buildItems(spec).filter(i => i.conflict);

// ---------- 유형 짐작 (작업지시서 분류·종류·제품명·검사항목) ----------
export const guessSpecType = ({ category = '', subCategory = '', productName = '', woItems = [] }) => {
    const t = `${category} ${subCategory} ${productName}`;
    if (/브레이크|DOT\s?[345]/i.test(t)) return 'BRAKE';
    if (/엔진오일/.test(category) && !/첨가|코팅/.test(category)) return 'ENGINE';
    if (/부동액|냉각수|LLC/i.test(category)) return isAntifreezeConcentrate({ productName, woItems }) ? 'ANTIFREEZE' : 'WATER';
    if (/연료첨가|연료\s?첨가|fuel/i.test(`${category} ${subCategory}`)) return 'FUEL';
    if (isWaterBased({ woItems })) return 'WATER';
    return 'OIL';
};
/** 수용성: 작업지시서에 숫자 pH 기준이 있고 숫자 동점도 기준이 없으면 */
export const isWaterBased = ({ type = '', woItems = [] }) => {
    if (type === 'ANTIFREEZE' || type === 'WATER') return true;
    const hasNum = (re) => woItems.some(q => re.test(itemKeyOf(q.item)) && parseSpec(q.standard));
    return hasNum(/^ph$/) && !hasNum(/^kv/);
};
const guessBrakeClass = (woItems, name) => {
    if (/6\s?종|class\s?6|LV/i.test(name)) return '6';
    const kv = woItems.find(q => itemKeyOf(q.item) === 'kvm40');
    const e = woItems.find(q => itemKeyOf(q.item) === 'erbp');
    if ((kv && parseSpec(kv.standard)?.hi <= 750) || (e && parseSpec(e.standard)?.lo >= 250)) return '6';
    return '4';
};
const guessApi = (t) => API_GRADES.filter(g => new RegExp(`(^|[^A-Z])${g.replace(/[ -]/g, '[ -]?')}([^A-Z0-9]|$)`, 'i').test(t)).slice(0, 2);
// 등급이 적혀 있으면 그대로, 없고 'LS'(Low SAPS, 저회분)만 있으면 점도로 추정: xW-40 이상 → C3, xW-30 이하 → C2
const guessAcea = (t) => {
    const named = ACEA_GRADES.filter(g => new RegExp(`(^|[^A-Z0-9])${g.replace('/', '\\s?/\\s?')}([^0-9]|$)`, 'i').test(t));
    if (named.length || !/(^|[^A-Z])LS([^A-Z]|$)/i.test(t)) return named;
    const hot = Number((parseSae(t).match(/W-(\d+)$/) || [])[1]);
    return hot ? [hot >= 40 ? 'C3' : 'C2'] : [];
};

/** 적용 규격 한 줄 (예: 'KS M 2121 · SAE J300 5W-30 · API SP · ACEA C3') */
export const specStandards = (s) => {
    const o = s?.options || {};
    const parts = [PRODUCT_TYPES[s?.type]?.basis];
    if (s?.type === 'ENGINE') parts.push(o.sae ? `SAE J300 ${o.sae}` : '', ...(o.api || []).map(g => `API ${g}`), ...(o.acea || []).map(g => `ACEA ${g}`));
    if (s?.type === 'BRAKE') parts.push(`${o.brakeClass === '6' ? '6' : '4'}종`, o.dot4 ? 'DOT4 (FMVSS 116)' : '');
    if (s?.type === 'ANTIFREEZE') parts.push(AF_KINDS[afKindOf(o)]);
    return parts.filter(Boolean).join(' · ');
};

/**
 * 제품 키 = 제품명 (품목코드는 키로 쓰지 않는다: 브랜드만 다른 제품이 같은 원액 품목코드를 함께 쓰는 경우가 있어
 * 예) 'ODM 5W30'·'보크 아키라 5W30' = 5AA40008 — 코드로 묶으면 한쪽 규격이 다른 쪽을 덮어쓴다)
 */
export const specKeyOf = ({ productName = '' }) => `NAME:${String(productName).replace(/\s+/g, ' ').trim().toLowerCase()}`;
const specIdOf = (key) => `QS-${[...key].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7).toString(36).toUpperCase()}-${key.length}`;

// ---------- 저장 · 불러오기 ----------
export const listSpecs = () => listQc('QCSPEC');
export const saveSpec = (spec) => {
    const key = spec.key || specKeyOf(spec);
    return upsertQc('QCSPEC', { ...spec, key, id: spec.id || specIdOf(key), date: spec.date || new Date().toISOString().slice(0, 10) });
};
export const deleteSpec = (id) => deleteQc(id);
export const listBlendTests = () => listQc('BTEST');
export const saveBlendTest = (rec) => saveQc('BTEST', rec);

/**
 * 작업지시서(제조시방서)에서 제품 규격을 만들거나 새로 고친다
 * 사람이 고친 값(유형·수용성·옵션·직접 입력 규격)은 그대로 두고, 분류·종류·작업지시서 검사항목만 바꾼다.
 * @param {{ productName, itemCode, category, subCategory, qcItems, revision, recipeId }[]} products
 * @param {Object[]} existing 지금 저장된 규격
 * @returns {Promise<{ created: number, updated: number, same: number }>}
 */
export const syncSpecsFromProducts = async (products, existing) => {
    const byKey = new Map(existing.map(s => [s.key, s]));
    const byName = new Map(existing.map(s => [String(s.productName || '').trim(), s]));
    let created = 0; let updated = 0; let same = 0;
    for (const p of products) {
        const woItems = (p.qcItems || []).map(q => ({ item: String(q.item || '').trim(), standard: String(q.standard || '').trim() })).filter(q => q.item);
        const key = specKeyOf(p);
        const prev = byKey.get(key) || byName.get(String(p.productName || '').trim());
        if (prev) {
            // 예전 기록(품목코드 키)은 제품명 키로 바꿔 둔다 (번호 id는 그대로)
            const next = { ...prev, key, category: p.category || prev.category || '', subCategory: p.subCategory || prev.subCategory || '', woItems, recipeRev: p.revision || '', recipeId: p.recipeId || prev.recipeId || '', itemCode: p.itemCode || prev.itemCode || '' };
            const changed = ['key', 'category', 'subCategory', 'recipeRev', 'itemCode'].some(k => (next[k] || '') !== (prev[k] || '')) || JSON.stringify(next.woItems) !== JSON.stringify(prev.woItems || []);
            if (!changed) { same++; continue; }
            const saved = await saveSpec({ ...next, syncedAt: new Date().toISOString() });
            byKey.set(key, saved); byName.set(String(saved.productName || '').trim(), saved);
            updated++;
            continue;
        }
        const type = guessSpecType({ ...p, woItems });
        const t = `${p.subCategory || ''} ${p.productName || ''}`;
        const options = type === 'ENGINE' ? { sae: parseSae(t), api: guessApi(t), acea: guessAcea(t) }
            : type === 'BRAKE' ? { brakeClass: guessBrakeClass(woItems, t), dot4: /DOT\s?4/i.test(t) }
                : type === 'ANTIFREEZE' ? { afKind: /PG|프로필렌/i.test(t) ? 'PG2' : /\bAF\b|1종|겨울/i.test(t) ? 'EG1' : 'EG2' } : {};
        const saved = await saveSpec({
            key, productName: p.productName, itemCode: p.itemCode || '', category: p.category || '', subCategory: p.subCategory || '',
            type, waterBased: isWaterBased({ type, woItems }), options, woItems, overrides: {}, source: 'WO', recipeRev: p.revision || '', recipeId: p.recipeId || '', syncedAt: new Date().toISOString()
        });
        byKey.set(key, saved); byName.set(String(saved.productName || '').trim(), saved); // 같은 실행 안에서 다시 만들지 않게
        created++;
    }
    return { created, updated, same };
};

/**
 * 품목(이름·코드)에 맞는 제품 규격 찾기: 품목코드 → 같은 이름 → 이름이 서로 들어 있는 것(가장 긴 이름)
 * @returns {Object | null}
 */
export const findSpecFor = (specs, { itemCode = '', itemName = '' }) => {
    const n = String(itemName || '').replace(/\s+/g, '').toLowerCase();
    const sameName = (x) => String(x.productName || '').replace(/\s+/g, '').toLowerCase() === n;
    if (itemCode) {
        // 한 품목코드를 여러 제품(브랜드)이 함께 쓸 수 있으므로 이름까지 같은 것을 먼저
        const byCode = specs.filter(x => x.itemCode && x.itemCode === itemCode);
        const s = byCode.find(sameName) || (byCode.length === 1 ? byCode[0] : null);
        if (s) return s;
    }
    if (!n) return null;
    const exact = specs.find(x => String(x.productName || '').replace(/\s+/g, '').toLowerCase() === n);
    if (exact) return exact;
    const part = specs.filter(x => { const p = String(x.productName || '').replace(/\s+/g, '').replace(/\(원액\)/, '').toLowerCase(); return p.length >= 3 && (n.includes(p) || p.includes(n)); });
    return part.sort((a, b) => String(b.productName).length - String(a.productName).length)[0] || null;
};

// ---------- 관리도 (X-MR, 개별값) ----------
/**
 * 개별값·이동범위 관리도 계산
 * @param {number[]} xs 시간 순 측정값
 * @param {{ lo: number|null, hi: number|null } | null} specRange 규격 한계 (공정능력용)
 * @returns {{ n, mean, mrBar, ucl, lcl, mrUcl, sigma, cp, cpk, out: number[] }}
 */
export const xmrStats = (xs, specRange = null) => {
    const n = xs.length;
    if (!n) return { n: 0 };
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const mrs = xs.slice(1).map((x, i) => Math.abs(x - xs[i]));
    const mrBar = mrs.length ? mrs.reduce((a, b) => a + b, 0) / mrs.length : 0;
    const sigma = mrBar / 1.128; // d2 (n=2)
    const ucl = mean + 2.66 * mrBar; const lcl = mean - 2.66 * mrBar;
    const out = xs.map((x, i) => (mrBar > 0 && (x > ucl || x < lcl) ? i : -1)).filter(i => i >= 0);
    let cp = null; let cpk = null;
    if (sigma > 0 && specRange) {
        const { lo, hi } = specRange;
        if (lo != null && hi != null) cp = (hi - lo) / (6 * sigma);
        const ks = [hi != null ? (hi - mean) / (3 * sigma) : null, lo != null ? (mean - lo) / (3 * sigma) : null].filter(v => v != null);
        cpk = ks.length ? Math.min(...ks) : null;
    }
    return { n, mean, mrBar, ucl, lcl, mrUcl: 3.267 * mrBar, sigma, cp, cpk, out, mrs };
};
