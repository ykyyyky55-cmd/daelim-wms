/**
 * 대림오일 스마트 WMS PRO - 다중 키워드 및 부분 문자 인식 검색 유틸리티
 */
import { state } from './db.js';

/**
 * 쿼리 문자열을 공백 기준 다중 토큰으로 분할하여
 * 대상 객체의 지정 필드들에 모든 토큰이 부분 포함(Substring)되는지 검사
 * @param {Object} item 대상 객체
 * @param {string} query 검색어
 * @param {string[]} fields 대상 필드 목록
 * @returns {boolean}
 */
/**
 * 자재 마스터 상세 종류별 분류 메타데이터 정의
 */
export const ITEM_SUB_CATEGORIES = [
    { id: 'ALL', name: '전체', icon: '📋', color: 'bg-slate-100 text-slate-700' },
    { id: 'ODM', name: 'ODM (완제품)', icon: '🏢', color: 'bg-blue-100 text-blue-800 border-blue-300' },
    { id: '자사', name: '자사 (완제품)', icon: '⭐', color: 'bg-amber-100 text-amber-800 border-amber-300' },
    { id: '기타제품', name: '기타제품', icon: '📦', color: 'bg-slate-100 text-slate-800 border-slate-300' },
    { id: '라벨', name: '라벨', icon: '🏷️', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    { id: '아웃박스', name: '아웃박스', icon: '📦', color: 'bg-amber-100 text-amber-800 border-amber-300' },
    { id: '인박스', name: '인박스', icon: '📥', color: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
    { id: '캡', name: '캡', icon: '🔘', color: 'bg-cyan-100 text-cyan-800 border-cyan-300' },
    { id: '용기', name: '용기', icon: '🫙', color: 'bg-purple-100 text-purple-800 border-purple-300' },
    { id: '드럼', name: '드럼', icon: '🛢️', color: 'bg-slate-100 text-slate-800 border-slate-300' },
    { id: '원료', name: '원료', icon: '🧪', color: 'bg-rose-100 text-rose-800 border-rose-300' }
];

/**
 * 품목의 이름과 사양을 정밀 분석하여 종류(라벨, 아웃박스, 인박스, 캡 등)를 자동 판별
 * @param {Object} item 
 * @returns {string}
 */
export function determineSubCategory(item) {
    if (!item) return 'ODM';
    if (item.subCategory && ['ODM', '자사', '기타제품', '라벨', '아웃박스', '인박스', '용기', '캡', '드럼', '원료'].includes(item.subCategory)) {
        return item.subCategory;
    }
    if (item.category === '완제품') {
        return item.subCategory || 'ODM';
    }
    if (item.category === '원료') {
        return '원료';
    }

    const name = item.name || '';
    const text = (name + ' ' + (item.spec || '')).toLowerCase();

    // 0. 무라벨 (완제품 또는 용기)
    if (name.includes('무라벨')) {
        if (name.includes('용기')) return '용기';
        return 'ODM';
    }

    // 1. 인박스 (Inbox / 단상자) - 일반 '박스'보다 먼저 검사
    if (name.includes('인박스') || name.includes('단상자') || text.includes('in box') || text.includes('inbox') || text.includes('i/b')) {
        return '인박스';
    }

    // 2. 아웃박스 (Outbox / Carton / 칼라박스 / RRP박스)
    if (name.includes('아웃박스') || name.includes('카톤') || text.includes('out box') || text.includes('outbox') || text.includes('o/b') ||
        name.includes('칼라박스') || name.includes('rrp박스') || 
        (name.includes('박스') && !name.includes('용기') && !name.includes('인박스') && !name.includes('스티커') && !name.includes('라벨') && !name.match(/\d+박스/))) {
        return '아웃박스';
    }

    // 3. 라벨 (Label / 스티커)
    if (name.includes('라벨') || name.includes('스티커') || text.includes('label')) {
        return '라벨';
    }

    // 4. 용기 (Container / Bottle / 말통 / 공병) - 캡x, 검정캡 등이 품목명에 포함된 용기 우선 처리
    if (name.includes('용기') || name.includes('보틀') || name.includes('말통') || name.includes('공병') ||
        (text.includes('bottle') && !text.includes('cap')) ||
        (text.includes('pet') && (name.includes('원형') || name.includes('사각')))) {
        return '용기';
    }

    // 5. 캡 (Cap / 뚜껑 / 마개) - 단, 용기나 에어캡 제외
    if ((name.includes('캡') || name.includes('뚜껑') || name.includes('마개') || name.includes('노즐') || text.includes('cap')) && 
        !name.includes('용기') && !name.includes('에어캡')) {
        return '캡';
    }

    // 6. 드럼 (공드럼 / 신품드럼 / 중고드럼)
    if (name.includes('공드럼') || name.includes('신품드럼') || name.includes('중고드럼') || (name.includes('드럼') && item.category === '부자재')) {
        return '드럼';
    }

    if (item.category === '원료' || name.startsWith('원료-') || text.includes('기유') || text.includes('base oil')) return '원료';
    return item.subCategory || 'ODM';
}

/**
 * 쿼리 문자열을 공백 기준 다중 토큰으로 분할하여
 * 대상 객체의 지정 필드들에 모든 토큰이 부분 포함(Substring)되는지 검사
 * @param {Object} item 대상 객체
 * @param {string} query 검색어
 * @param {string[]} fields 대상 필드 목록
 * @returns {boolean}
 */
export const matchesQuery = (item, query, fields = ['code', 'name', 'spec', 'supplier', 'category', 'subCategory']) => {
    if (!query || !query.trim()) return true;
    if (!item) return false;

    const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;

    // 대상 필드들의 문자열을 결합하여 검색 대상 텍스트 생성
    const combinedText = fields
        .map(f => (item[f] !== undefined && item[f] !== null) ? String(item[f]).toLowerCase() : '')
        .join(' ');

    // 모든 토큰이 포함되어야 일치 (AND 조건 다중 키워드)
    return tokens.every(token => combinedText.includes(token));
};

/**
 * 품목 마스터에서 검색어와 일치하는 품목 목록 반환 (부분 문자 인식 및 점수 정렬)
 * @param {string} query 
 * @param {number} limit 
 * @returns {Array}
 */
export const searchMasterItems = (query, limit = 15) => {
    if (!query || !query.trim()) {
        return state.master.slice(0, limit);
    }

    const q = query.toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);

    const results = [];

    for (const item of state.master) {
        if (!matchesQuery(item, query, ['code', 'name', 'spec', 'supplier', 'category'])) {
            continue;
        }

        // 일치 가중치 점수 산출
        let score = 0;
        const codeLow = (item.code || '').toLowerCase();
        const nameLow = (item.name || '').toLowerCase();

        // 1. 코드 완전 일치
        if (codeLow === q) score += 100;
        // 2. 코드 접두사 일치
        else if (codeLow.startsWith(q)) score += 80;
        // 3. 품명 완전 일치
        else if (nameLow === q) score += 70;
        // 4. 품명 접두사 일치
        else if (nameLow.startsWith(q)) score += 60;
        // 5. 코드 부분 포함
        else if (codeLow.includes(q)) score += 50;
        // 6. 품명 부분 포함
        else if (nameLow.includes(q)) score += 40;
        // 7. 다중 토큰 일치
        else score += 20;

        results.push({ item, score });
    }

    // 가중치 내림차순 정렬 후 limit개 반환
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(r => r.item);
};

/**
 * 날짜 범위(시작일자 ~ 종료일자) 내에 특정 일시 문자열이 포함되는지 검사
 * @param {string} timestampStr '2026-09-22 17:00:00' 또는 '2026. 9. 22.' 등 다양한 형식 지원
 * @param {string} startDate 'YYYY-MM-DD'
 * @param {string} endDate 'YYYY-MM-DD'
 * @returns {boolean}
 */
export const isDateInRange = (timestampStr, startDate, endDate) => {
    if (!startDate && !endDate) return true;
    if (!timestampStr) return false;

    // 타임스탬프에서 YYYY-MM-DD 추출
    let datePart = '';
    const match = timestampStr.match(/(\d{4})[-\.\/](\d{1,2})[-\.\/](\d{1,2})/);
    if (match) {
        const y = match[1];
        const m = String(match[2]).padStart(2, '0');
        const d = String(match[3]).padStart(2, '0');
        datePart = `${y}-${m}-${d}`;
    } else {
        try {
            const parsed = new Date(timestampStr);
            if (!isNaN(parsed.getTime())) {
                datePart = parsed.toISOString().slice(0, 10);
            }
        } catch {}
    }

    if (!datePart) return true;

    if (startDate && datePart < startDate) return false;
    if (endDate && datePart > endDate) return false;
    return true;
};

/**
 * 텍스트 정규화: 알파벳 소문자, 한글, 숫자만 남기고 공백/특수문자 제거
 */
export const normalizeText = (str) => {
    if (!str) return '';
    return String(str).toLowerCase().replace(/[\s\-_/\\|()\[\]{}'"`.,:;+~*]/g, '');
};

/**
 * 현장 빈출 축약어 및 동의어 매핑 테이블
 */
const SYNONYM_MAP = [
    { pattern: /구연산/i, codeOrName: 'Citric Acid(구연산)' },
    { pattern: /공토트/i, codeOrName: '공토트' },
    { pattern: /버진캡|안전캡/i, codeOrName: '안전캡' },
    { pattern: /미라텍\s*플러스.*5W30/i, codeOrName: '1CM29351' },
    { pattern: /OF3.*5W30/i, codeOrName: 'OO020582' },
    { pattern: /OF3.*5W40/i, codeOrName: 'OO020583' },
    { pattern: /DR.*PAO.*5W30/i, codeOrName: '5AA40017' },
    { pattern: /DR.*PAO.*5W40/i, codeOrName: '5AA40018' }
];

/**
 * 품목 텍스트로부터 기존 마스터 품목을 지능형 대조(Matching)
 * 1차: 코드 직접 추출 (품목코드 패턴 또는 마스터 코드 일치)
 * 2차: 품명 완전 일치 (공백/특수문자 무시 정규화)
 * 3차: 현장 동의어 및 축약어 매핑
 * 4차: 점도/규격/품목명 키워드 가중치 스코어링 (임계치 85점 이상)
 * 
 * @param {string} itemText 품목 텍스트 (예: '1AA40001 / ...', '썸오일 펄블루 무라벨 1L 용기', '루키 5W30')
 * @param {string} [spec=''] 규격/사양
 * @param {string} [category=''] 분류
 * @param {Array} [masterList=null] 대상 마스터 목록 (기본값: state.master)
 * @returns {Object|null} 일치하는 마스터 품목 객체, 없으면 null (검색불가)
 */
export const resolveMasterItem = (itemText, spec = '', category = '', masterList = null) => {
    if (!itemText || !itemText.trim()) return null;
    const masters = masterList || (state && state.master) || [];
    if (!Array.isArray(masters) || masters.length === 0) return null;

    const trimmed = itemText.trim();

    // 1단계: 코드 직접 추출 ('1AA40001 / ...' 또는 '1AA40001' 단독 또는 첫 단어)
    const firstToken = trimmed.split(/[\/\s|]+/)[0].trim();
    if (firstToken && firstToken.length >= 3) {
        const directCodeMatch = masters.find(m => m.code.toLowerCase() === firstToken.toLowerCase());
        if (directCodeMatch) return directCodeMatch;
    }

    // 슬래시('/') 뒤에 실제 품명이 오는 경우 분리
    let namePart = trimmed;
    if (trimmed.includes('/')) {
        const parts = trimmed.split('/');
        namePart = parts.slice(1).join('/').split('|')[0].trim();
    } else if (trimmed.includes('|')) {
        namePart = trimmed.split('|')[0].trim();
    }

    const normTarget = normalizeText(namePart);
    if (!normTarget) return null;

    // 2단계: 품목명 완전 일치 (정규화 기준)
    for (const m of masters) {
        if (!m.name) continue;
        const normMasterName = normalizeText(m.name);
        if (normMasterName === normTarget) {
            return m;
        }
    }

    // 3단계: 동의어/약어 규칙 검사
    for (const syn of SYNONYM_MAP) {
        if (syn.pattern.test(trimmed) || syn.pattern.test(namePart)) {
            const found = masters.find(m => 
                m.code.toLowerCase() === syn.codeOrName.toLowerCase() || 
                normalizeText(m.name).includes(normalizeText(syn.codeOrName))
            );
            if (found) return found;
        }
    }

    // 4단계: 점도(Viscosity) 및 핵심 속성 추출 기반 지능형 가중치 매칭
    // 점도 패턴: 0W20, 5W30, 5W40, 10W40, 75W90, 80W90, 2T, 4T 등
    const viscMatch = trimmed.match(/\b(\d{1,2}W\d{2}|[0-9]T)\b/i);
    const targetVisc = viscMatch ? viscMatch[1].toUpperCase() : null;

    // 용량/단위 패턴: 1L, 4L, 200L, 18L, 3L, 0.5L, 550ML, 300ML, TOTE, IBC 등
    const volMatch = `${trimmed} ${spec}`.match(/\b(\d+(?:\.\d+)?(?:L|ML)|TOTE|IBC)\b/i);
    const targetVol = volMatch ? volMatch[1].toUpperCase() : null;

    // 자재 유형 패턴: 용기, 라벨, 캡, 박스, 원액, 완제품 등
    const typeKeywords = ['용기', '라벨', '캡', '박스', '원액', '스티커', '패드', '오일', '브레이크'];
    const targetTypes = typeKeywords.filter(k => trimmed.includes(k));

    // 의미 있는 명사 토큰 추출 (2글자 이상)
    const tokens = namePart
        .replace(/[^가-힣a-zA-Z0-9]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 2 && !['엔진오일', '합성엔진오일', '용기', '라벨', '대림'].includes(t));

    let bestMatch = null;
    let highestScore = 0;

    for (const m of masters) {
        const mName = m.name || '';
        const mNorm = normalizeText(mName);
        const mSpec = m.spec || '';
        const mCombined = `${mName} ${mSpec} ${m.notes || ''}`.toLowerCase();

        let score = 0;

        // 점도가 일치하는지 검사
        if (targetVisc) {
            const mViscMatch = mCombined.match(/\b(\d{1,2}w\d{2}|[0-9]t)\b/i);
            const mVisc = mViscMatch ? mViscMatch[1].toUpperCase() : null;
            if (mVisc === targetVisc) {
                score += 35;
            } else if (mVisc && mVisc !== targetVisc) {
                // 점도가 서로 다르면 다른 오일이므로 즉시 탈락
                continue;
            }
        }

        // 용량 일치 검사
        if (targetVol) {
            const mVolMatch = mCombined.match(/\b(\d+(?:\.\d+)?(?:l|ml)|tote|ibc)\b/i);
            const mVol = mVolMatch ? mVolMatch[1].toUpperCase() : null;
            if (mVol === targetVol) {
                score += 25;
            }
        }

        // 자재 유형 일치 검사 (용기인데 라벨이면 탈락)
        if (targetTypes.length > 0) {
            const hasSameType = targetTypes.some(t => mName.includes(t));
            if (hasSameType) score += 20;
            else if (targetTypes.includes('용기') && mName.includes('라벨')) continue;
            else if (targetTypes.includes('라벨') && mName.includes('용기')) continue;
        }

        // 토큰 포함 개수 검사
        let tokenHits = 0;
        for (const token of tokens) {
            if (mName.toLowerCase().includes(token.toLowerCase())) {
                tokenHits++;
                score += 15;
            }
        }

        // 마스터 품목명과 대상 문자열 간의 포함 관계
        if (normTarget.length >= 4 && (mNorm.includes(normTarget) || normTarget.includes(mNorm))) {
            score += 30;
        }

        if (score > highestScore) {
            highestScore = score;
            bestMatch = m;
        }
    }

    // 충분한 신뢰도(85점 이상)가 있는 경우에만 동일 품목으로 인정
    if (highestScore >= 85 && bestMatch) {
        return bestMatch;
    }

    return null;
};

