// ==========================================
// 거점(공장·창고) 및 건물 위치 헬퍼
// ==========================================
// 재고 위치 문자열은 "거점" 또는 "거점 / 건물" 형식이다. (예: "김포공장", "김포공장 / 2동")
// 재고·이력·클라우드(wms_inventory.location)는 이 문자열을 그대로 키로 쓰므로,
// 건물을 나눠도 입출고·이동·CAS 재고 증감 로직은 바뀌지 않는다.
// 건물이 없는 "거점" 위치는 '건물 미지정' 재고로 취급한다.

export const LOCATION_SEP = ' / ';

// 기본 4대 거점
export const DEFAULT_SITES = ['본사', '김포공장', '방산공장', '김포2공장'];

// 예전 거점명 → 현재 거점명 (방산 창고는 방산공장으로 개칭, 대림오일 창고·본사 창고는 '본사'로 통일)
// 클라우드 자료는 supabase/auth/25_rename_hq_site.sql로 옮기고, 기기에 남은 캐시는 불러올 때 여기서 바꾼다.
export const LEGACY_SITE_MAP = {
    '방산 창고': '방산공장',
    '대림오일 창고': '본사',
    '본사 창고': '본사'
};

export const siteOf = (loc) => String(loc || '').split(LOCATION_SEP)[0].trim();

export const buildingOf = (loc) => {
    const parts = String(loc || '').split(LOCATION_SEP);
    return parts.length > 1 ? parts.slice(1).join(LOCATION_SEP).trim() : '';
};

export const makeLocation = (site, building = '') => {
    const s = String(site || '').trim();
    const b = String(building || '').trim();
    return b ? `${s}${LOCATION_SEP}${b}` : s;
};

// 예전 거점명을 현재 거점명으로 바꾼다 (건물 부분은 유지)
export const normalizeLegacyLocation = (loc) => {
    if (!loc || typeof loc !== 'string') return loc;
    const mapped = LEGACY_SITE_MAP[siteOf(loc)];
    return mapped ? makeLocation(mapped, buildingOf(loc)) : loc;
};

// 거점 목록 (등록 순서 유지, 기본 4대 거점은 항상 포함)
export const sitesOf = (locations = []) => {
    const out = [];
    for (const loc of [...DEFAULT_SITES, ...locations]) {
        const s = siteOf(loc);
        if (s && !out.includes(s)) out.push(s);
    }
    return out;
};

// 해당 거점에 등록된 건물 목록
export const buildingsOf = (locations = [], site) =>
    locations.filter(l => siteOf(l) === site && buildingOf(l)).map(buildingOf);

// 위치 목록 정리: 예전 거점명 변환 + 기본 거점 보장 + 중복 제거 + 거점별로 묶어서 정렬
export const normalizeLocationList = (locations = []) => {
    const normalized = (Array.isArray(locations) ? locations : [])
        .map(normalizeLegacyLocation)
        .filter(l => typeof l === 'string' && l.trim());
    const out = [];
    for (const site of sitesOf(normalized)) {
        out.push(site);
        for (const b of buildingsOf(normalized, site)) {
            const loc = makeLocation(site, b);
            if (!out.includes(loc)) out.push(loc);
        }
    }
    return out;
};

// 위치 표시명 ("김포공장 / 2동" → "김포공장 · 2동", 건물 없으면 거점명)
export const locationLabel = (loc) => {
    const b = buildingOf(loc);
    return b ? `${siteOf(loc)} · ${b}` : siteOf(loc);
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 위치 선택 <option> 목록 (거점별 optgroup, 거점 자체는 '건물 미지정'으로 표시)
// selected: 선택할 위치 값 / 함수(loc => boolean)
export const locationOptionsHtml = (locations = [], selected = null) => {
    const isSel = typeof selected === 'function' ? selected : (loc) => loc === selected;
    return sitesOf(locations).map(site => {
        const blds = buildingsOf(locations, site);
        const opt = (loc, label) => `<option value="${esc(loc)}" ${isSel(loc) ? 'selected' : ''}>${esc(label)}</option>`;
        if (blds.length === 0) return opt(site, site);
        return `<optgroup label="${esc(site)}">${opt(site, `${site} (건물 미지정)`)}${blds.map(b => opt(makeLocation(site, b), `${site} · ${b}`)).join('')}</optgroup>`;
    }).join('');
};

// 조회 필터용 <option> 목록: 거점 전체("@거점") + 건물이 있으면 건물 미지정/건물별 항목
export const locationFilterOptionsHtml = (locations = [], selected = '') => {
    const opt = (value, label) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
    return sitesOf(locations).map(site => {
        const blds = buildingsOf(locations, site);
        if (blds.length === 0) return opt(`@${site}`, site);
        return `<optgroup label="${esc(site)}">${opt(`@${site}`, `${site} 전체`)}${opt(site, `${site} (건물 미지정)`)}${blds.map(b => opt(makeLocation(site, b), `${site} · ${b}`)).join('')}</optgroup>`;
    }).join('');
};

// 조회 필터 일치 여부 ("" 전체, "@거점" 거점 전체, 그 밖에는 위치 정확히 일치)
export const matchesLocationFilter = (loc, filter) => {
    if (!filter) return true;
    if (filter.startsWith('@')) return siteOf(loc) === filter.slice(1);
    return loc === filter;
};

// 원료수불부 지역구분 (거점 → 김포 / 본사 / 방산 / 김포2)
export const RAW_LEDGER_REGIONS = [
    { value: '김포', label: '🏭 김포 (김포공장)', site: '김포공장' },
    { value: '본사', label: '🏢 본사', site: '본사' },
    { value: '방산', label: '🏗️ 방산 (방산공장)', site: '방산공장' },
    { value: '김포2', label: '🏭 김포2 (김포2공장)', site: '김포2공장' }
];

export const rawLedgerRegionOf = (loc) => {
    const site = siteOf(normalizeLegacyLocation(loc));
    const found = RAW_LEDGER_REGIONS.find(r => r.site === site);
    if (found) return found.value;
    if (site.includes('김포2')) return '김포2';
    if (site.includes('김포')) return '김포';
    if (site.includes('방산')) return '방산';
    if (site.includes('본사')) return '본사';
    return site || '김포';
};
