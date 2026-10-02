// ==========================================
// 거점(공장·창고) 및 건물 위치 헬퍼
// ==========================================
// 재고 위치 문자열은 "거점" 또는 "거점 / 건물" 형식이다. (예: "김포공장", "김포공장 / 2동")
// 재고·이력·클라우드(wms_inventory.location)는 이 문자열을 그대로 키로 쓰므로,
// 건물을 나눠도 입출고·이동·CAS 재고 증감 로직은 바뀌지 않는다.
// 건물이 없는 "거점" 위치는 '건물 미지정' 재고로 취급한다.

export const LOCATION_SEP = ' / ';

/**
 * 대림오일 거점·캠프·창고 구성 (2026-09 개편)
 * 거점 2개 아래 캠프(도창동 본사·방산캠프 / 김포1공장·김포2공장), 캠프 아래 창고(코드 + 설명).
 * 위치 문자열은 그대로 "거점" 또는 "거점 / 창고코드"(예: "본사 / 본사2A")이고, 캠프는 창고코드로 찾는다.
 * @typedef {{ code: string, desc: string }} Warehouse
 * @typedef {{ name: string, warehouses: Warehouse[] }} Camp
 * @type {Record<string, Camp[]>}
 */
export const SITE_LAYOUT = {
    '본사': [
        { name: '도창동 본사', warehouses: [
            { code: '본사1A', desc: '본사 1층 제조 포장실' }, { code: '본사1B', desc: '본사 2층 창고' },
            { code: '본사1C', desc: '본사 4층 창고' }, { code: '본사1D', desc: '본사 옥외저장소' }
        ] },
        { name: '방산캠프', warehouses: [
            { code: '본사2A', desc: '방산공장 제조소' }, { code: '본사2B', desc: '방산공장 창고동' }, { code: '본사2C', desc: '방산공장 옥외저장소' }
        ] }
    ],
    '김포공장': [
        { name: '김포1공장', warehouses: [
            { code: '김포1A', desc: '김포1공장 생산동' }, { code: '김포1B', desc: '김포1공장 포장동' },
            { code: '김포1C', desc: '김포1공장 창고동' }, { code: '김포1D', desc: '김포1공장 옥외저장소' }
        ] },
        { name: '김포2공장', warehouses: [
            { code: '김포2A', desc: '김포2공장 A동' }, { code: '김포2B', desc: '김포2공장 B동' }, { code: '김포2C', desc: '김포2공장 C동(사무동)' }
        ] }
    ]
};

// 기본 거점 (2개)
export const DEFAULT_SITES = Object.keys(SITE_LAYOUT);

// 창고코드 → { site, camp, code, desc }
const WAREHOUSE_INFO = Object.fromEntries(Object.entries(SITE_LAYOUT).flatMap(([site, camps]) =>
    camps.flatMap(camp => camp.warehouses.map(w => [w.code, { site, camp: camp.name, ...w }]))));

// 창고 구획(존): 구획코드 = 창고코드 + '-' + 번호 (예: 김포2A-01), 위치 = "거점 / 구획코드".
// 구획 목록은 services/warehouseZones.js가 불러와 registerZones로 넣고, 기기 캐시(daelim_wh_zones)로 시작 때부터 쓴다.
/** @type {Record<string, { site: string, warehouse: string, name: string }>} */
let ZONE_INFO = {};
/** 구획 목록 등록 (kind ZONE 줄만) */
export const registerZones = (zones = []) => {
    ZONE_INFO = Object.fromEntries((zones || []).filter(z => z && z.kind === 'ZONE' && z.id)
        .map(z => [z.id, { site: z.site || WAREHOUSE_INFO[z.warehouse]?.site || '', warehouse: z.warehouse, name: z.name || '' }]));
};
try {
    const cached = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('daelim_wh_zones') || 'null') : null;
    if (Array.isArray(cached)) registerZones(cached);
} catch (e) {
    console.warn('구획 캐시를 읽지 못했습니다.', e);
}
/** 등록된 구획 위치 ("거점 / 구획코드") */
export const zoneLocations = () => Object.entries(ZONE_INFO).filter(([, z]) => z.site).map(([code, z]) => `${z.site}${LOCATION_SEP}${code}`);
/** 구획 정보 (구획이 아니면 null) */
export const zoneInfo = (code) => ZONE_INFO[code] || null;
/** 창고코드 (구획코드면 앞 창고코드, 그 밖에는 그대로) */
export const warehouseCodeOf = (building) => {
    const b = String(building || '');
    if (ZONE_INFO[b]) return ZONE_INFO[b].warehouse;
    const m = /^(.+)-\d{1,3}$/.exec(b);
    return m && WAREHOUSE_INFO[m[1]] ? m[1] : b;
};

/** 구성에 있는 모든 창고 위치 ("거점 / 창고코드") */
export const LAYOUT_LOCATIONS = Object.values(WAREHOUSE_INFO).map(w => `${w.site}${LOCATION_SEP}${w.code}`);

// 예전 이름 → 현재 위치 (거점만 적힌 위치 전체를 바꾼다)
// 방산공장(방산 창고)은 본사 거점의 방산캠프 '본사2A 방산공장 제조소'로, 김포2공장은 김포공장 거점으로 합쳤다(2026-09).
// 클라우드 자료는 supabase/auth/43_site_layout.sql로 옮기고, 기기에 남은 캐시는 불러올 때 여기서 바꾼다.
export const LEGACY_LOCATION_MAP = {
    '방산 창고': `본사${LOCATION_SEP}본사2A`,
    '방산공장': `본사${LOCATION_SEP}본사2A`,
    '김포2공장': '김포공장'
};
// 예전 거점명 → 현재 거점명 (건물이 붙은 예전 위치, 수불부처럼 거점 단위인 곳)
export const LEGACY_SITE_MAP = {
    '방산 창고': '본사',
    '방산공장': '본사',
    '김포2공장': '김포공장',
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

// 예전 거점·건물 이름을 현재 이름으로 바꾼다
//  - 거점만 적힌 예전 위치: LEGACY_LOCATION_MAP (예: '방산공장' → '본사 / 본사2A')
//  - 건물이 붙은 예전 위치: 거점만 바꾸고 건물은 유지
//  - 예전 김포 건물명 '김포1A동' → 창고코드 '김포1A'
export const normalizeLegacyLocation = (loc) => {
    if (!loc || typeof loc !== 'string') return loc;
    const whole = LEGACY_LOCATION_MAP[loc.trim()];
    if (whole) return whole;
    const oldGimpo = /^김포([12])공장\s+([A-D])동$/.exec(loc.trim()); // 예전 표기 '김포2공장 B동'
    if (oldGimpo) return makeLocation('김포공장', `김포${oldGimpo[1]}${oldGimpo[2]}`);
    const site = LEGACY_SITE_MAP[siteOf(loc)] || siteOf(loc);
    let building = buildingOf(loc);
    const oldCode = /^(김포[12][A-D])동$/.exec(building);
    if (oldCode) building = oldCode[1];
    return makeLocation(site, building);
};

/** 위치의 캠프 이름 (구성에 있는 창고만, 없으면 '') */
export const campOf = (loc) => WAREHOUSE_INFO[warehouseCodeOf(buildingOf(loc))]?.camp || '';
/** 창고 설명 (예: '본사2A' → '방산공장 제조소', 없으면 '') */
export const warehouseDesc = (code) => {
    if (WAREHOUSE_INFO[code]) return WAREHOUSE_INFO[code].desc;
    const base = warehouseCodeOf(code);
    if (base === code || !WAREHOUSE_INFO[base]) return '';
    return `${WAREHOUSE_INFO[base].desc} ${ZONE_INFO[code]?.name || '구획'}`.trim();
};
/** 구획 위치인지 ("김포공장 / 김포2A-01") */
export const isZoneLocation = (loc) => { const b = buildingOf(loc); return !!b && warehouseCodeOf(b) !== b; };

// 거점 목록 (등록 순서 유지, 기본 거점은 항상 포함)
export const sitesOf = (locations = []) => {
    const out = [];
    for (const loc of [...DEFAULT_SITES, ...locations]) {
        const s = siteOf(loc);
        if (s && !out.includes(s)) out.push(s);
    }
    return out;
};

// 해당 거점에 등록된 건물(창고) 목록
export const buildingsOf = (locations = [], site) =>
    locations.filter(l => siteOf(l) === site && buildingOf(l)).map(buildingOf);

// 위치 목록 정리: 예전 이름 변환 + 기본 거점·구성 창고 보장 + 중복 제거 + 거점별로 묶어서 정렬(구성 순서 → 그 밖에 등록한 건물)
export const normalizeLocationList = (locations = []) => {
    const normalized = [...LAYOUT_LOCATIONS, ...zoneLocations(), ...(Array.isArray(locations) ? locations : [])]
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

// 위치 표시명 ("본사 / 본사2A" → "본사 · 본사2A 방산공장 제조소", 구성에 없는 건물은 "거점 · 건물", 건물 없으면 거점명)
export const locationLabel = (loc) => {
    const b = buildingOf(loc);
    if (!b) return siteOf(loc);
    const desc = warehouseDesc(b);
    return desc ? `${siteOf(loc)} · ${b} ${desc}` : `${siteOf(loc)} · ${b}`;
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 거점의 창고를 캠프별로 묶는다: [{ camp: '도창동 본사', buildings: ['본사1A', …] }, …, { camp: '', buildings: 구성에 없는 건물 }]
const campGroups = (locations, site) => {
    const blds = buildingsOf(locations, site);
    const zonesOf = (code) => blds.filter(b => b !== code && warehouseCodeOf(b) === code).sort();
    const groups = (SITE_LAYOUT[site] || []).map(c => ({ camp: c.name, buildings: c.warehouses.flatMap(w => [w.code, ...zonesOf(w.code)]).filter(code => blds.includes(code)) }))
        .filter(g => g.buildings.length);
    const known = new Set(groups.flatMap(g => g.buildings));
    const extra = blds.filter(b => !known.has(b));
    if (extra.length) groups.push({ camp: '', buildings: extra });
    return groups;
};
const buildingLabel = (b) => (ZONE_INFO[b] || warehouseCodeOf(b) !== b ? `　└ ${b} ${ZONE_INFO[b]?.name || ''}`.trimEnd() : warehouseDesc(b) ? `${b} ${warehouseDesc(b)}` : b);

// 위치 선택 <option> 목록 (거점 → 캠프별 optgroup, 거점 자체는 '창고 미지정')
// selected: 선택할 위치 값 / 함수(loc => boolean)
// siteFilter: 넣을 거점만 고르는 함수(거점 이름 => boolean). 거점별 화면(제품생산/입고 본사·김포)이 자기 거점의 창고만 보여 줄 때 쓴다
export const locationOptionsHtml = (locations = [], selected = null, { siteFilter = null } = {}) => {
    const isSel = typeof selected === 'function' ? selected : (loc) => loc === selected;
    const opt = (loc, label) => `<option value="${esc(loc)}" ${isSel(loc) ? 'selected' : ''}>${esc(label)}</option>`;
    return sitesOf(locations).filter(site => !siteFilter || siteFilter(site)).map(site => {
        const groups = campGroups(locations, site);
        if (groups.length === 0) return opt(site, site);
        return `<optgroup label="${esc(site)}">${opt(site, `${site} (창고 미지정)`)}</optgroup>`
            + groups.map(g => `<optgroup label="${esc(`${site} › ${g.camp || '기타 창고'}`)}">${g.buildings.map(b => opt(makeLocation(site, b), `${buildingLabel(b)}`)).join('')}</optgroup>`).join('');
    }).join('');
};

// 조회 필터용 <option> 목록: 거점 전체("@거점") · 캠프 전체("%거점|캠프") · 창고 미지정 · 창고별
export const locationFilterOptionsHtml = (locations = [], selected = '') => {
    const opt = (value, label) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
    return sitesOf(locations).map(site => {
        const groups = campGroups(locations, site);
        if (groups.length === 0) return opt(`@${site}`, site);
        return `<optgroup label="${esc(site)}">${opt(`@${site}`, `${site} 전체`)}${opt(site, `${site} (창고 미지정)`)}</optgroup>`
            + groups.map(g => `<optgroup label="${esc(`${site} › ${g.camp || '기타 창고'}`)}">${g.camp ? opt(`%${site}|${g.camp}`, `${g.camp} 전체`) : ''}${g.buildings.map(b => opt(makeLocation(site, b), buildingLabel(b))).join('')}</optgroup>`).join('');
    }).join('');
};

// 조회 필터 일치 여부 ("" 전체, "@거점" 거점 전체, "%거점|캠프" 캠프 전체, 그 밖에는 위치 정확히 일치)
export const matchesLocationFilter = (loc, filter) => {
    if (!filter) return true;
    if (filter.startsWith('@')) return siteOf(loc) === filter.slice(1);
    if (filter.startsWith('%')) {
        const [site, camp] = filter.slice(1).split('|');
        return siteOf(loc) === site && campOf(loc) === camp;
    }
    // 창고를 고르면 그 창고의 구획도 함께
    return loc === filter || String(loc || '').startsWith(`${filter}-`);
};

// 원료수불부 지역구분 (거점 단위: 본사 / 김포). 방산캠프는 본사, 김포2공장은 김포에 합쳐 누적한다(2026-09).
export const RAW_LEDGER_REGIONS = [
    { value: '김포', label: '🏭 김포 (김포공장)', site: '김포공장' },
    { value: '본사', label: '🏢 본사', site: '본사' }
];

/** 원료수불부 전표의 예전 지역 값 → 현재 지역 ('방산' → '본사', '김포2' → '김포') */
export const normalizeRawRegion = (region) => ({ '방산': '본사', '김포2': '김포' }[region] || region);

export const rawLedgerRegionOf = (loc) => {
    const site = siteOf(normalizeLegacyLocation(loc));
    const found = RAW_LEDGER_REGIONS.find(r => r.site === site);
    if (found) return found.value;
    if (site.includes('김포')) return '김포';
    if (site.includes('방산') || site.includes('본사')) return '본사';
    if (site === '김포2') return '김포';
    return site || '김포';
};
