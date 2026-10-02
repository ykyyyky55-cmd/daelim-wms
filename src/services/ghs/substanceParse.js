// ==========================================
// 물질 정보 해석: 안전보건공단 MSDS 조회 API · PubChem 응답 → 앱의 물질 기록
// ==========================================
// 화면·저장소와 무관한 순수 함수 (Node로도 점검할 수 있다).
// 물질 기록(substance): { cas, nameKo, nameEn, synonyms, keNo, enNo, unNo, source, sourceNote, fetchedAt, lastDate,
//   cls: [{c,k,form?}], ate: {oral,dermal,gas,vapor,dust}, m: {acute,chronic}, unknown, nonAdditive,
//   info: { 항목 key → 글 } — MSDS 8·9·11·12·14·15항에 옮겨 적는 물질별 자료 (INFO_KEYS) }
import { GHS_CLASSES, classOf, catOf } from './ghsTables.js';

/** CAS 번호 모양과 검증 숫자 확인 */
export const normCas = (v) => String(v || '').replace(/[^\d-]/g, '').trim();
export const isValidCas = (v) => {
    const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(normCas(v));
    if (!m) return false;
    const digits = (m[1] + m[2]).split('').reverse();
    return digits.reduce((s, d, i) => s + Number(d) * (i + 1), 0) % 10 === Number(m[3]);
};

/** 물질별 자료 칸 (공단 항목코드 → 이름). MSDS 본문을 만들 때 성분별 자료로 쓴다 */
export const INFO_KEYS = {
    // 8. 노출기준
    H0202: '국내규정', H0204: 'ACGIH 규정', H0206: '생물학적 노출기준', H0208: '기타 노출기준',
    // 9. 물리화학적 특성
    I0202: '성상', I0204: '색상', I04: '냄새', I06: '냄새역치', I08: 'pH', I10: '녹는점/어는점', I12: '초기 끓는점과 끓는점 범위', I14: '인화점', I16: '증발속도',
    I18: '인화성(고체, 기체)', I20: '인화 또는 폭발 범위의 상한/하한', I22: '증기압', I24: '용해도', I26: '증기밀도', I28: '비중', I30: 'n-옥탄올/물분배계수', I32: '자연발화온도',
    I34: '분해온도', I36: '점도', I38: '분자량',
    // 11. 독성
    K040202: '급성독성(경구)', K040204: '급성독성(경피)', K040206: '급성독성(흡입)', K0404: '피부부식성 또는 자극성', K0406: '심한 눈손상 또는 자극성', K0408: '호흡기과민성', K0410: '피부과민성',
    K041212: '발암성(산업안전보건법)', K041214: '발암성(고용노동부고시)', K041202: '발암성(IARC)', K041206: '발암성(OSHA)', K041210: '발암성(ACGIH)', K041204: '발암성(NTP)', K041216: '발암성(EU CLP)',
    K0414: '생식세포변이원성', K0416: '생식독성', K0418: '특정 표적장기 독성 (1회 노출)', K0420: '특정 표적장기 독성 (반복 노출)', K0422: '흡인유해성',
    // 12. 환경
    L0202: '어류', L0204: '갑각류', L0206: '조류', L0402: '잔류성', L0404: '분해성', L0602: '농축성', L0604: '생분해성', L08: '토양이동성', L10: '기타 유해 영향',
    // 14. 운송
    N02: '유엔번호', N04: '적정선적명', N06: '운송에서의 위험성 등급', N08: '용기등급', N10: '해양오염물질',
    // 15. 규제
    O02: '산업안전보건법', O04: '화학물질관리법', O12: '화학물질의 등록 및 평가 등에 관한 법률', O06: '위험물안전관리법', O08: '폐기물관리법', O100202: '기타 국내 규제'
};

const EMPTY_RE = /^(자료\s*없음|해당\s*없음|없음|-|)$/;
/** '자료없음'·빈 값이면 '' */
export const cleanInfo = (text) => {
    const t = String(text ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/\|?\s*※\s*출처\s*:\s*[^|]*/g, '') // 출처 표시는 떼어 낸다
        .split('|').map(s => s.trim()).filter(s => s && !EMPTY_RE.test(s)).join(' / ')
        .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    return EMPTY_RE.test(t) ? '' : t;
};

// ---------- 분류 글자 → 분류 기록 ----------
const CLASS_PATTERNS = [
    ['FLAM_LIQ', /인화성액체/], ['FLAM_GAS', /인화성가스/], ['AEROSOL', /에어로졸/], ['OX_GAS', /산화성가스/], ['PRESS_GAS', /고압가스/], ['FLAM_SOL', /인화성고체/],
    ['SELF_REACT', /자기반응성/], ['PYR_LIQ', /자연발화성액체/], ['PYR_SOL', /자연발화성고체/], ['SELF_HEAT', /자기발열성/], ['WATER_REACT', /물반응성/],
    ['OX_LIQ', /산화성액체/], ['OX_SOL', /산화성고체/], ['ORG_PEROX', /유기과산화물/], ['MET_CORR', /금속부식성/], ['EXPL', /폭발성물질/],
    ['ACUTE_ORAL', /급성독성\(?경구/], ['ACUTE_DERMAL', /급성독성\(?경피/], ['ACUTE_INH', /급성독성\(?흡입/],
    ['SKIN', /피부부식성|피부자극성/], ['EYE', /눈손상|눈자극/], ['RESP_SENS', /호흡기과민성/], ['SKIN_SENS', /피부과민성/],
    ['MUTA', /변이원성/], ['CARC', /발암성/], ['REPRO', /생식독성|수유독성/],
    ['STOT_SE', /표적장기독성\(?1회/], ['STOT_RE', /표적장기독성\(?반복/], ['ASP', /흡인유해성/],
    ['AQ_ACUTE', /급성수생환경|수생환경유해성\(?급성/], ['AQ_CHRONIC', /만성수생환경|수생환경유해성\(?만성/], ['OZONE', /오존층/]
];
const GAS_KINDS = [['REFR', /냉동액화/], ['LIQ', /액화/], ['COMP', /압축/], ['DISS', /용해/]];
const TYPE_KINDS = [['A', /형식\s*A/i], ['B', /형식\s*B/i], ['CD', /형식\s*[CD]/i], ['EF', /형식\s*[EF]/i], ['G', /형식\s*G/i]];

/**
 * '인화성 액체 : 구분2' 같은 한 줄 → 분류 기록 (모르는 글자면 null)
 * @param {string} line
 * @returns {{ c: string, k: string, form?: string } | null}
 */
export const parseClassLine = (line) => {
    const raw = String(line || '').trim();
    if (!raw) return null;
    const [namePart, ...rest] = raw.split(/\s*[:：]\s*(?=구분|형식|등급|압축|액화|냉동|용해|수유|자연발화|불안정|급성\s*\d|만성\s*\d)/);
    const name = namePart.replace(/\s+/g, '');
    const value = rest.join(':').trim() || raw;
    const hit = CLASS_PATTERNS.find(([, re]) => re.test(name));
    if (!hit) return null;
    const c = hit[0];
    const compact = value.replace(/\s+/g, '');
    let k = '';
    if (c === 'PRESS_GAS') k = (GAS_KINDS.find(([, re]) => re.test(compact)) || ['COMP'])[0];
    else if (c === 'SELF_REACT' || c === 'ORG_PEROX') k = (TYPE_KINDS.find(([, re]) => re.test(value)) || [''])[0];
    else if (c === 'EXPL') k = /불안정/.test(compact) ? 'UNST' : (/1\.[1-6]/.exec(compact) || [''])[0];
    else if (c === 'FLAM_GAS' && /자연발화/.test(compact)) k = 'PYR';
    else if (c === 'REPRO' && /수유/.test(compact + name)) k = 'L';
    else {
        const m = /구분(\d)([ABC])?/.exec(compact) || /(?:급성|만성)(\d)/.exec(compact);
        if (!m) return null;
        k = m[1] + (m[2] || '');
        // '구분1(1A/1B)'처럼 소구분을 정하지 않은 표기는 구분 1, '구분2(2A)'는 2A
        const paren = /\(([^)]*)\)/.exec(compact);
        if (paren && !m[2]) {
            const sub = /^(\d[ABC])$/.exec(paren[1]);
            if (sub && catOf(c, sub[1])) k = sub[1];
        }
        if (c === 'STOT_SE' && m[1] === '3') k = /마취/.test(compact) ? '3N' : '3R';
    }
    if (!catOf(c, k)) return null;
    const entry = { c, k };
    if (c === 'ACUTE_INH') {
        const form = /가스/.test(name) ? 'GAS' : /증기/.test(name) ? 'VAPOR' : /분진|미스트/.test(name) ? 'DUST' : '';
        if (form) entry.form = form;
    }
    return entry;
};

/** 분류 글자(여러 줄, '|'·줄바꿈 구분) → 분류 기록 목록 (겹치는 줄은 한 번만) */
export const parseClassText = (text) => {
    const out = [];
    String(text || '').split(/[|\n]/).forEach(line => {
        const e = parseClassLine(line);
        if (e && !out.some(x => x.c === e.c && x.k === e.k && (x.form || '') === (e.form || ''))) out.push(e);
    });
    return out;
};

// ---------- 급성독성 값 (LD50·LC50) ----------
/**
 * 공단 독성 글자에서 시험값을 읽는다. 부등호(>·<)가 붙은 한계값과 4시간이 아닌 흡입 시험값은 쓰지 않는다.
 * @param {string} text 예: 'LD50 5580 ㎎/㎏ 실험종 : Rat', '증기 LC50 >20 ㎎/ℓ', 'LC50 463 ppm 4 hr'
 * @param {'oral'|'dermal'|'inh'} route
 * @returns {{ route: string, value: number } | null} route = oral·dermal·gas·vapor·dust
 */
export const parseAteText = (text, route) => {
    const t = String(text || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const m = /(LD50|LC50)\s*([<>≤≥＞＜]?)\s*=?\s*([\d,]+(?:\.\d+)?)\s*(㎎\/㎏|mg\/kg|ppm|㎎\/ℓ|mg\/L|mg\/ℓ|㎎\/L|㎎\/㎥|mg\/m3|mg\/㎥)/i.exec(t);
    if (!m || m[2]) return null;
    const value = Number(m[3].replace(/,/g, ''));
    if (!(value > 0)) return null;
    const unit = m[4].toLowerCase();
    if (route !== 'inh') return /㎏|kg/.test(unit) ? { route, value } : null;
    const hours = /(\d+(?:\.\d+)?)\s*(?:hr|h\b|시간)/i.exec(t.slice(m.index));
    if (hours && Number(hours[1]) !== 4) return null;
    const head = t.slice(0, m.index);
    if (/ppm/.test(unit)) return { route: 'gas', value };
    const mgL = /㎥|m3/.test(unit) ? value / 1000 : value;
    return { route: /분진|미스트|dust|mist/i.test(head) ? 'dust' : /가스|gas/i.test(head) ? 'gas' : 'vapor', value: mgL };
};

// ---------- 안전보건공단 MSDS 조회 API ----------
// 항목은 항목코드(B02·K040202 …)로 찾는다. 코드 모양이 다르게 오면(서비스가 바뀌는 경우) 항목 이름으로 찾는다.
const KOSHA_NAMES = {
    '02': { '유해성·위험성 분류': 'B02' },
    '03': { 물질명: 'C02', '이명(관용명)': 'C04', 'CAS 번호': 'C06' },
    '08': { 국내규정: 'H0202', 'ACGIH 규정': 'H0204', '생물학적 노출기준': 'H0206', '기타 노출기준': 'H0208' },
    '09': {
        성상: 'I0202', 색상: 'I0204', 냄새: 'I04', 냄새역치: 'I06', pH: 'I08', '녹는점/어는점': 'I10', '초기 끓는점과 끓는점 범위': 'I12', 인화점: 'I14', 증발속도: 'I16', '인화성(고체, 기체)': 'I18',
        '인화 또는 폭발 범위의 상한/하한': 'I20', 증기압: 'I22', 용해도: 'I24', 증기밀도: 'I26', 비중: 'I28', 'n-옥탄올/물분배계수 (Kow)': 'I30', 자연발화온도: 'I32', 분해온도: 'I34', 점도: 'I36', 분자량: 'I38'
    },
    11: {
        경구: 'K040202', 경피: 'K040204', 흡입: 'K040206', '피부부식성 또는 자극성': 'K0404', '심한 눈손상 또는 자극성': 'K0406', 호흡기과민성: 'K0408', 피부과민성: 'K0410',
        산업안전보건법: 'K041212', 고용노동부고시: 'K041214', IARC: 'K041202', OSHA: 'K041206', ACGIH: 'K041210', NTP: 'K041204', 'EU CLP': 'K041216',
        생식세포변이원성: 'K0414', 생식독성: 'K0416', '특정 표적장기 독성 (1회 노출)': 'K0418', '특정 표적장기 독성 (반복 노출)': 'K0420', 흡인유해성: 'K0422'
    },
    12: { 어류: 'L0202', 갑각류: 'L0204', 조류: 'L0206', 잔류성: 'L0402', 분해성: 'L0404', 농축성: 'L0602', 생분해성: 'L0604', 토양이동성: 'L08', '기타 유해 영향': 'L10' },
    14: { '유엔번호(UN No.)': 'N02', 적정선적명: 'N04', '운송에서의 위험성 등급': 'N06', 용기등급: 'N08', 해양오염물질: 'N10' },
    15: {
        '산업안전보건법에 의한 규제': 'O02', '화학물질관리법에 의한 규제': 'O04', '화학물질의 등록 및 평가 등에 관한 법률 규제': 'O12', '위험물안전관리법에 의한 규제': 'O06',
        '폐기물관리법에 의한 규제': 'O08', '기타 국내 규제': 'O100202'
    }
};
const squash = (v) => String(v || '').replace(/[\s·.,()/-]/g, '');
const KOSHA_NAME_INDEX = Object.fromEntries(Object.entries(KOSHA_NAMES).map(([sec, names]) => [String(sec).padStart(2, '0'), new Map(Object.entries(names).map(([name, code]) => [squash(name), code]))]));
const KOSHA_CODE_RE = /^[A-P]\d{2,6}$/;

/**
 * @param {{ casNo?: string, chemNameKor?: string, chemId?: string, keNo?: string, enNo?: string, unNo?: string, lastDate?: string }} chem 목록 한 줄
 * @param {Object<string, Array<{ msdsItemCode: string, msdsItemNameKor?: string, itemDetail?: string }>>} detail 항목 번호('02'·'08'…) → 줄 목록
 */
export const parseKosha = (chem, detail) => {
    const byCode = new Map();
    Object.entries(detail || {}).forEach(([section, list]) => (list || []).forEach(it => {
        const raw = String(it.msdsItemCode ?? '');
        const code = KOSHA_CODE_RE.test(raw) ? raw : KOSHA_NAME_INDEX[String(section).padStart(2, '0')]?.get(squash(it.msdsItemNameKor)) || raw;
        if (!byCode.has(code) || !byCode.get(code)) byCode.set(code, String(it.itemDetail ?? ''));
    }));
    const info = {};
    Object.keys(INFO_KEYS).forEach(code => { const v = cleanInfo(byCode.get(code)); if (v) info[code] = v; });
    const ate = {};
    [['K040202', 'oral'], ['K040204', 'dermal'], ['K040206', 'inh']].forEach(([code, route]) => {
        const hit = parseAteText(byCode.get(code), route);
        if (hit) ate[hit.route] = hit.value;
    });
    const synonyms = cleanInfo(byCode.get('C04'));
    const cls = parseClassText(byCode.get('B02'));
    return {
        cas: normCas(chem.casNo), nameKo: String(chem.chemNameKor || '').trim() || cleanInfo(byCode.get('C02')), nameEn: '', synonyms,
        keNo: chem.keNo || '', enNo: chem.enNo || '', unNo: chem.unNo || '', chemId: String(chem.chemId || ''),
        source: 'KOSHA', sourceNote: '안전보건공단 화학물질정보(MSDS)', lastDate: chem.lastDate || '',
        // 분류도 없고 급성독성 시험 자료도 없으면 '유해성 자료 없음(미상)' 성분으로 본다
        cls, ate, m: {}, unknown: !cls.length && !info.K040202 && !info.K040204, nonAdditive: false, info
    };
};

// ---------- PubChem (GHS Classification) ----------
// H 코드 → 분류. 구분을 문구만으로 정할 수 없는 것(H300·H310·H330 = 구분 1 또는 2)은 구분 2로 넣고 확인 표시를 남긴다.
const H_CLASS = {
    H224: ['FLAM_LIQ', '1'], H225: ['FLAM_LIQ', '2'], H226: ['FLAM_LIQ', '3'], H227: ['FLAM_LIQ', '4'], H220: ['FLAM_GAS', '1'], H221: ['FLAM_GAS', '2'], H232: ['FLAM_GAS', 'PYR'],
    H222: ['AEROSOL', '1'], H223: ['AEROSOL', '2'], H251: ['SELF_HEAT', '1'], H252: ['SELF_HEAT', '2'], H260: ['WATER_REACT', '1'], H270: ['OX_GAS', '1'], H281: ['PRESS_GAS', 'REFR'],
    H280: ['PRESS_GAS', 'COMP'], H290: ['MET_CORR', '1'],
    H300: ['ACUTE_ORAL', '2'], H301: ['ACUTE_ORAL', '3'], H302: ['ACUTE_ORAL', '4'], H310: ['ACUTE_DERMAL', '2'], H311: ['ACUTE_DERMAL', '3'], H312: ['ACUTE_DERMAL', '4'],
    H330: ['ACUTE_INH', '2'], H331: ['ACUTE_INH', '3'], H332: ['ACUTE_INH', '4'], H314: ['SKIN', '1'], H315: ['SKIN', '2'], H318: ['EYE', '1'], H319: ['EYE', '2'], H320: ['EYE', '2B'],
    H334: ['RESP_SENS', '1'], H317: ['SKIN_SENS', '1'], H340: ['MUTA', '1'], H341: ['MUTA', '2'], H350: ['CARC', '1'], H351: ['CARC', '2'], H360: ['REPRO', '1'], H361: ['REPRO', '2'], H362: ['REPRO', 'L'],
    H370: ['STOT_SE', '1'], H371: ['STOT_SE', '2'], H335: ['STOT_SE', '3R'], H336: ['STOT_SE', '3N'], H372: ['STOT_RE', '1'], H373: ['STOT_RE', '2'], H304: ['ASP', '1'], H305: ['ASP', '2'],
    H400: ['AQ_ACUTE', '1'], H410: ['AQ_CHRONIC', '1'], H411: ['AQ_CHRONIC', '2'], H412: ['AQ_CHRONIC', '3'], H413: ['AQ_CHRONIC', '4'], H420: ['OZONE', '1']
};
const AMBIGUOUS_H = new Set(['H300', 'H310', 'H330']);

/** H 문구 한 줄(예: 'H225 (98.5%): Highly Flammable liquid and vapor [Danger Flammable liquids]') → { code, pct, entry, ambiguous } */
const parseHLine = (line) => {
    const m = /^(H\d{3})[A-Za-z]*\s*\**\s*(?:\((\d+(?:\.\d+)?)%\))?\s*:\s*(.*)$/.exec(String(line || '').trim());
    if (!m) return null;
    const code = m[1], rest = m[3];
    const isDanger = /\[Danger/i.test(rest);
    let hit = H_CLASS[code];
    if (code === 'H228') hit = ['FLAM_SOL', isDanger ? '1' : '2'];
    else if (code === 'H240') hit = [/peroxide/i.test(rest) && !/self-reactive/i.test(rest) ? 'ORG_PEROX' : 'SELF_REACT', 'A'];
    else if (code === 'H241') hit = [/peroxide/i.test(rest) && !/self-reactive/i.test(rest) ? 'ORG_PEROX' : 'SELF_REACT', 'B'];
    else if (code === 'H242') hit = [/peroxide/i.test(rest) && !/self-reactive/i.test(rest) ? 'ORG_PEROX' : 'SELF_REACT', isDanger ? 'CD' : 'EF'];
    else if (code === 'H250') hit = [/solid/i.test(rest) ? 'PYR_SOL' : 'PYR_LIQ', '1'];
    else if (code === 'H261') hit = ['WATER_REACT', isDanger ? '2' : '3'];
    else if (code === 'H271') hit = [/solid/i.test(rest) ? 'OX_SOL' : 'OX_LIQ', '1'];
    else if (code === 'H272') hit = [/solid/i.test(rest) ? 'OX_SOL' : 'OX_LIQ', isDanger ? '2' : '3'];
    if (!hit || !catOf(hit[0], hit[1])) return null;
    return { code, pct: m[2] ? Number(m[2]) : null, entry: { c: hit[0], k: hit[1] }, ambiguous: AMBIGUOUS_H.has(code) };
};

/** PubChem 출처 우선순위: EU 조화분류 → ECHA C&L 신고 요약(신고 회사 다수의 분류) → 일본 NITE → 그 밖 */
const SOURCE_RANK = [[/1272\/2008/, 'EU CLP 조화분류'], [/ECHA/i, 'ECHA C&L 신고 분류'], [/NITE/i, '일본 NITE 분류'], [/HCIS|Safe Work Australia/i, '호주 HCIS'], [/./, '']];
/** 'GHS 분류기준에 해당하지 않는다'고 신고한 비율(%)을 글에서 읽는다 (없으면 null) */
const notMeetingPct = (text) => {
    const m = /not meet(?:ing)? GHS hazard criteria (?:for|per) (?:<\s*)?(?:([\d.]+)% \()?([\d,]+)\s+of\s+([\d,]+)/i.exec(text);
    if (!m) return null;
    const part = Number(m[2].replace(/,/g, '')), whole = Number(m[3].replace(/,/g, ''));
    return whole > 0 ? (part / whole) * 100 : null;
};

/**
 * PubChem PUG-View(heading=GHS Classification) 응답 → 출처별 분류 목록
 * ECHA 신고 요약의 H 문구 비율은 '유해 문구를 낸 회사' 가운데의 비율이라, '분류기준에 해당하지 않는다'는 신고가 절반 이상이면 분류되지 않는 물질로 본다.
 * @param {Object} json
 * @returns {Array<{ source: string, label: string, cls: Array<{c:string,k:string}>, ambiguous: string[], reports: number, notMeet: number }>} 우선순위 순
 */
export const parsePubChemGhs = (json) => {
    const refs = new Map((json?.Record?.Reference || []).map(r => [r.ReferenceNumber, `${r.SourceName || ''}${r.Name ? ` — ${r.Name}` : ''}`]));
    const byRef = new Map(); // 출처 번호 → { lines, notMeet, reports }
    const walk = (section) => {
        (section.Information || []).forEach(inf => {
            const o = byRef.get(inf.ReferenceNumber) || { lines: [], notMeet: null, reports: 0 };
            const strings = (inf.Value?.StringWithMarkup || []).map(x => String(x.String || ''));
            if (inf.Name === 'GHS Hazard Statements') o.lines.push(...strings);
            strings.forEach(str => {
                const pct = notMeetingPct(str);
                if (pct !== null && (o.notMeet === null || pct > o.notMeet)) o.notMeet = pct;
                const n = /per ([\d,]+) reports/i.exec(str) || /provided by ([\d,]+) compan/i.exec(str);
                if (n) o.reports = Math.max(o.reports, Number(n[1].replace(/,/g, '')));
            });
            byRef.set(inf.ReferenceNumber, o);
        });
        (section.Section || []).forEach(walk);
    };
    (json?.Record?.Section || []).forEach(walk);
    const found = [];
    byRef.forEach((o, ref) => {
        const notMeet = o.notMeet || 0;
        const cls = [], ambiguous = [];
        if (notMeet < 50) {
            o.lines.map(parseHLine).filter(Boolean).forEach(h => {
                if (h.pct !== null && h.pct < 50) return; // 유해 문구를 낸 회사의 절반이 안 되는 분류는 넣지 않는다
                if (!cls.some(x => x.c === h.entry.c && x.k === h.entry.k)) cls.push(h.entry);
                if (h.ambiguous) ambiguous.push(h.code);
            });
        }
        if (!cls.length && notMeet < 50) return; // 분류도 없고 '해당하지 않음' 다수도 아닌 출처는 쓸 정보가 없다
        found.push({ source: refs.get(ref) || `출처 ${ref}`, cls: strictest(cls), ambiguous, reports: o.reports, notMeet });
    });
    const rankOf = (x) => SOURCE_RANK.findIndex(([re]) => re.test(x.source));
    found.forEach(x => { x.label = SOURCE_RANK[rankOf(x)][1] || x.source.split(' — ')[0]; });
    const fy = (x) => Number((/FY\s*(\d{4})/.exec(x.source) || [0, 0])[1]);
    // 같은 순위 안에서는 신고 회사가 많은 것 · 최신 연도(NITE) 먼저
    return found.sort((x, y) => rankOf(x) - rankOf(y) || y.reports - x.reports || fy(y) - fy(x));
};

/** 한 분류 안에서 여러 구분이 있으면 가장 엄한 구분만 남긴다 (STOT 1회 노출의 구분 3은 함께 둘 수 있다) */
export const strictest = (cls) => {
    const out = [];
    const byClass = new Map();
    cls.forEach(e => byClass.set(e.c, [...(byClass.get(e.c) || []), e]));
    byClass.forEach((list, c) => {
        const order = classOf(c).cats.map(ct => ct.k);
        const rank = (e) => order.indexOf(e.k);
        if (c === 'STOT_SE') {
            const main = list.filter(e => !/^3/.test(e.k)).sort((a, b) => rank(a) - rank(b))[0];
            if (main) out.push(main);
            list.filter(e => /^3/.test(e.k)).forEach(e => { if (!out.some(x => x.c === c && x.k === e.k)) out.push(e); });
        } else if (c === 'REPRO') {
            const main = list.filter(e => e.k !== 'L').sort((a, b) => rank(a) - rank(b))[0];
            if (main) out.push(main);
            if (list.some(e => e.k === 'L')) out.push({ c, k: 'L' });
        } else out.push(list.slice().sort((a, b) => rank(a) - rank(b))[0]);
    });
    const classOrder = new Map(GHS_CLASSES.map((cl, i) => [cl.key, i]));
    return out.sort((a, b) => classOrder.get(a.c) - classOrder.get(b.c));
};

/**
 * PubChem 자료로 물질 기록을 만든다 (분류는 우선순위가 가장 높은 출처 것, 나머지 출처는 alts에)
 * @param {string} cas
 * @param {{ Title?: string, IUPACName?: string, MolecularWeight?: string }} prop
 * @param {Object} ghsJson
 */
export const parsePubChem = (cas, prop, ghsJson) => {
    const sources = parsePubChemGhs(ghsJson);
    const top = sources[0];
    const info = {};
    if (prop?.MolecularWeight) info.I38 = String(prop.MolecularWeight);
    const note = !top ? 'PubChem (GHS 분류 정보 없음)'
        : !top.cls.length ? `PubChem (${top.label}: 신고의 ${Math.round(top.notMeet)}%가 GHS 분류기준에 해당하지 않는다고 보고)`
            : `PubChem (${top.label})${top.ambiguous.length ? ` — ${top.ambiguous.join('·')}는 구분 1 또는 2(구분 2로 넣음, 확인 필요)` : ''}`;
    return {
        cas: normCas(cas), nameKo: '', nameEn: String(prop?.Title || prop?.IUPACName || '').trim(), synonyms: prop?.IUPACName && prop.IUPACName !== prop.Title ? String(prop.IUPACName) : '',
        keNo: '', enNo: '', unNo: '', chemId: '', source: 'PUBCHEM', sourceNote: note, lastDate: '',
        // 출처가 하나도 없으면 유해성 자료 없음(미상), '분류기준에 해당하지 않음'이 다수면 분류되지 않는 물질
        cls: top ? top.cls : [], ate: {}, m: {}, unknown: !top, nonAdditive: false, info,
        alts: sources.slice(0, 6).map(x => ({ label: x.label, source: x.source, cls: x.cls }))
    };
};

/** 빈 물질 기록 (직접 입력용) */
export const emptySubstance = (cas = '') => ({
    cas: normCas(cas), nameKo: '', nameEn: '', synonyms: '', keNo: '', enNo: '', unNo: '', chemId: '', source: 'MANUAL', sourceNote: '직접 입력', lastDate: '',
    cls: [], ate: {}, m: {}, unknown: true, nonAdditive: false, info: {}
});
