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
export const matchesQuery = (item, query, fields = ['code', 'name', 'spec', 'supplier', 'category']) => {
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
