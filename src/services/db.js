import { getSupabase, isSupabaseConfigured } from './supabase.js';
import rawSeedIdHashes from '../data/rawSeedIdHashes.json';
import { resolveMasterItem, determineSubCategory, determineCategoryAndSubCategory, MASTER_CATEGORIES, localDateStr, toDateKey } from './searchUtils.js';
import { DEFAULT_SITES, normalizeLocationList, normalizeLegacyLocation, siteOf, makeLocation, rawLedgerRegionOf, LEGACY_SITE_MAP } from './locations.js';

// ==========================================
// 예전 거점명 마이그레이션 (방산 창고 → 방산공장, 대림오일 창고 → 본사 창고)
// ==========================================
// 재고: 거점명을 바꾸고, 바꾼 결과 같은 품목·위치 행이 둘이 되면 수량을 합친다.
function migrateInventoryLocations(list) {
    if (!Array.isArray(list)) return { list, changed: false };
    let changed = false;
    const byKey = new Map();
    const out = [];
    for (const inv of list) {
        const loc = normalizeLegacyLocation(inv.location);
        if (loc !== inv.location) changed = true;
        const key = `${inv.code}___${loc}`;
        const existing = byKey.get(key);
        if (existing) {
            existing.quantity = (Number(existing.quantity) || 0) + (Number(inv.quantity) || 0);
            changed = true;
            continue;
        }
        const row = loc !== inv.location ? { ...inv, location: loc } : inv;
        byKey.set(key, row);
        out.push(row);
    }
    return { list: out, changed };
}

// 이력: 출발/도착 위치의 예전 거점명 변환 (사유 문구 등 자유 텍스트는 원문 유지)
function migrateHistoryLocations(list) {
    if (!Array.isArray(list)) return { list, changed: false };
    let changed = false;
    const out = list.map(h => {
        const fromLoc = normalizeLegacyLocation(h.fromLoc);
        const toLoc = normalizeLegacyLocation(h.toLoc);
        if (fromLoc === h.fromLoc && toLoc === h.toLoc) return h;
        changed = true;
        return { ...h, fromLoc, toLoc };
    });
    return { list: out, changed };
}

// 생산실적/작업지시서: 입고 위치와 투입 자재 위치 변환
function migrateDocLocations(list) {
    if (!Array.isArray(list)) return { list, changed: false };
    let changed = false;
    const fixMats = (mats) => Array.isArray(mats) ? mats.map(m => {
        const loc = normalizeLegacyLocation(m.location);
        if (loc === m.location) return m;
        changed = true;
        return { ...m, location: loc };
    }) : mats;
    const out = list.map(d => {
        const loc = normalizeLegacyLocation(d.location);
        if (loc !== d.location) changed = true;
        return {
            ...d,
            location: loc,
            bomDetails: fixMats(d.bomDetails),
            rawMaterials: fixMats(d.rawMaterials),
            subMaterials: fixMats(d.subMaterials)
        };
    });
    return { list: changed ? out : list, changed };
}

// 기본값
// 앱은 GitHub Pages로 공개 배포되므로 품목·재고·수불부 같은 업무 데이터는 번들에 넣지 않는다.
// 실제 데이터는 로그인 후 Supabase에서 불러오며, 로컬(오프라인/데모) 모드는 빈 상태에서 시작한다.
const DEFAULT_CATEGORIES = MASTER_CATEGORIES;
const DEFAULT_LOCATIONS = normalizeLocationList(DEFAULT_SITES);
const DEFAULT_WORKERS = [];
const DEFAULT_USERS = [
    { id: "admin", name: "관리자", username: "admin", password: "admin123", role: "ADMIN", dept: "물류관리팀", title: "총괄 관리자" },
    { id: "manager", name: "김물류", username: "manager", password: "manager123", role: "MANAGER", dept: "자재운영팀", title: "물류 반장" },
    { id: "worker", name: "이작업", username: "worker", password: "worker123", role: "OPERATOR", dept: "생산조립팀", title: "현장 기사" },
    { id: "viewer", name: "박조회", username: "viewer", password: "viewer123", role: "VIEWER", dept: "경영기획팀", title: "조회 전용" }
];

// 클라우드에 원본이 있는 업무 데이터의 로컬 캐시 키 (localStorage `daelim_<key>`).
// 로그아웃하면 지워서 공용 PC에 재고·수불부가 남지 않게 한다 (다음 로그인 때 클라우드에서 다시 받는다).
// 생산실적·거래처·기초재고·병합 이력처럼 이 기기에만 있는 데이터는 지우지 않는다.
const CLOUD_CACHE_KEYS = [
    'categories', 'locations', 'workers', 'master', 'inventory', 'history', 'schedules', 'gimpoLogs', 'hqLogs',
    'rawLedger', 'productLedger', 'materialLedger',
    'rawLedgerSyncedIds', 'productLedgerSyncedIds', 'materialLedgerSyncedIds',
    // 예전 번들 데이터용 키 (더 이상 쓰지 않음)
    'gimpoDataSummary', 'masterSeedCodes'
];

// 로컬 스토리지 헬퍼
const loadStorage = (key, defaultVal) => {
    try {
        const item = localStorage.getItem(`daelim_${key}`);
        if (!item) return defaultVal;
        const parsed = JSON.parse(item);
        // master/inventory/rawLedger는 건수로 구버전 여부를 판단하지 않는다.
        // (품목·전표를 하나만 삭제해도 건수가 줄어 로컬 수정분 전체가 기본값으로 초기화되던 문제)
        // 번들 기본 품목의 추가/삭제 반영은 아래 "번들 기본 품목 동기화"에서 처리한다.
        if (key === 'rawLedger' && Array.isArray(parsed)) {
            // 구버전 데이터(location 필드 부재)인 경우 김포 지역구분이 적용된 최신 전체 데이터로 자동 마이그레이션
            if (parsed.length > 0 && !parsed[0].location) {
                return defaultVal;
            }
        }
        return parsed;
    } catch {
        return defaultVal;
    }
};

// 재고 행 식별 키 (품목코드 + 거점)
const invKey = (code, location) => `${code}___${location}`;

// 클라우드 동기화 실패 알림
// supabase-js는 실패 시 예외 대신 { error }를 반환하므로, 반환값을 확인하지 않으면
// 로컬에만 저장된 채 사용자는 성공으로 알게 된다. 모든 클라우드 쓰기는 checkWrite로 결과를 확인한다.
const syncErrorListeners = new Set();
export const onCloudSyncError = (callback) => {
    syncErrorListeners.add(callback);
    return () => syncErrorListeners.delete(callback);
};
const reportSyncError = (context, error) => {
    console.error(`[DB] 클라우드 동기화 실패 (${context}):`, error);
    syncErrorListeners.forEach(cb => {
        try { cb(context, error); } catch (e) { console.error('[DB] 동기화 실패 리스너 오류:', e); }
    });
};
// Supabase 쓰기 결과 확인: 실패하면 알림 후 false 반환 (로컬 저장은 유지)
const checkWrite = async (request, context) => {
    try {
        const res = await request;
        if (res && res.error) {
            reportSyncError(context, res.error);
            return false;
        }
        return true;
    } catch (e) {
        reportSyncError(context, e);
        return false;
    }
};

const saveStorage = (key, data) => {
    try {
        localStorage.setItem(`daelim_${key}`, JSON.stringify(data));
    } catch (e) {
        console.warn('LocalStorage 저장 한도 초과 또는 오류', e);
    }
};

const DEFAULT_PARTNERS = [
    "(주)한국정밀", 
    "대한화학(주)", 
    "(주)모션테크", 
    "태양실링(주)", 
    "안국루브텍", 
    "서진화학",
    "SK엔무브",
    "GS칼텍스",
    "S-OIL(에쓰오일)",
    "HD현대오일뱅크",
    "에이치엘비글로벌(주)"
];

const getOffsetDateStr = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return localDateStr(d);
};

const DEFAULT_SCHEDULES = [
    {
        id: "SCHED-1001",
        date: getOffsetDateStr(0),
        type: "IN_PLAN",
        title: "SK엔무브 원료(VHVI-4) 200L 드럼 40EA 입고 검수",
        itemCode: "ITEM-1002",
        itemName: "대림 울트라 5W-30 합성엔진오일",
        partner: "SK엔무브",
        worker: "김물류 (반장)",
        notes: "탱크로리 및 드럼 밀봉 상태 확인 요망",
        status: "TODO"
    },
    {
        id: "SCHED-1002",
        date: getOffsetDateStr(1),
        type: "OUT_PLAN",
        title: "(주)한국정밀 공정유 및 기어유 정기 납품 출고",
        itemCode: "ITEM-1004",
        itemName: "대림 산업용 유압작동유 ISO VG 46",
        partner: "(주)한국정밀",
        worker: "이물류 (반장)",
        notes: "납품 전표 및 비중 성적서 동봉 필수",
        status: "TODO"
    },
    {
        id: "SCHED-1003",
        date: getOffsetDateStr(3),
        type: "AUDIT",
        title: "김포공장 윤활유 드럼 2분기 정기 실사 전수조사",
        itemCode: "",
        itemName: "",
        partner: "",
        worker: "박품질 (주임)",
        notes: "위치별 바코드 라벨 훼손 여부 확인",
        status: "TODO"
    },
    {
        id: "SCHED-1004",
        date: getOffsetDateStr(5),
        type: "MAINTENANCE",
        title: "본사 창고 오버헤드 크레인 및 호이스트 정기 안전점검",
        itemCode: "",
        itemName: "",
        partner: "",
        worker: "김생산 (생산기사)",
        notes: "안전보건관리공단 정기 점검표 작성",
        status: "TODO"
    }
];

const DEFAULT_PRODUCTIONS = [
    {
        id: "PROD-20260922-001",
        prodDate: localDateStr(),
        itemCode: "ITEM-1002",
        itemName: "대림 울트라 5W-30 합성엔진오일",
        packaging: "200L 드럼",
        qty: 20,
        unit: "DRUM",
        lotNo: "LOT-20260922-A1",
        mfgDate: localDateStr(),
        expDate: "2029-09-21",
        location: "김포공장",
        worker: "김생산 (생산기사)",
        bomDeducted: true,
        bomDetails: [
            { code: "ITEM-1001", name: "대림 프리미엄 기유 VHVI-4", qty: 3800, unit: "L" },
            { code: "ITEM-1007", name: "200L 스틸 오일 드럼 용기(파랑)", qty: 20, unit: "EA" }
        ],
        notes: "표준 배합비 블렌딩 및 충진 완료, 점도/비중 검사 적합"
    }
];

const DEFAULT_WORK_ORDERS = [
    {
        id: "WO-20260922-001",
        orderNo: "WO-20260922-001",
        orderDate: localDateStr(),
        prodType: "원액",
        targetItemCode: "ITEM-1002",
        targetItemName: "대림 울트라 5W-30 합성엔진오일 원액",
        targetQty: 1000,
        unit: "L",
        packaging: "1,000L IBC",
        location: "김포공장",
        lotNo: "LOT-20260922-B01",
        worker: "김생산 (생산기사)",
        status: "READY",
        rawMaterials: [
            { code: "ITEM-1001", name: "대림 프리미엄 기유 VHVI-4", qty: 850, unit: "L", location: "김포공장", matType: "원료" },
            { code: "ITEM-1003", name: "대림 기어유 EP 90", qty: 150, unit: "L", location: "김포공장", matType: "원료" }
        ],
        subMaterials: [
            { code: "ITEM-1007", name: "200L 스틸 오일 드럼 용기(파랑)", qty: 5, unit: "EA", location: "김포공장", matType: "부자재" }
        ],
        notes: "배합비: 기유 85% + 첨가기어유 15%, 블렌딩 온도 60℃ 교반 유지",
        createdAt: new Date().toISOString()
    }
];



// 메모리 인-메모리 캐시
export const state = {
    categories: loadStorage('categories', DEFAULT_CATEGORIES),
    locations: loadStorage('locations', DEFAULT_LOCATIONS),
    partners: loadStorage('partners', DEFAULT_PARTNERS),
    workers: loadStorage('workers', DEFAULT_WORKERS).filter(w => w.name !== '홍길동'),
    users: loadStorage('users', DEFAULT_USERS).filter(u => u.name !== '홍길동'),
    // 로그인 전에는 사용자 없음. 로그인/세션 확인(auth.js) 시에만 설정된다.
    // (기본값을 관리자 계정으로 두면 세션 사용자를 찾지 못했을 때 관리자 권한이 그대로 남는다)
    currentUser: null,
    currentGlobalWorker: (() => {
        const cw = loadStorage('currentWorker', "김물류 (반장)");
        return (cw && !cw.includes('홍길동')) ? cw : "김물류 (반장)";
    })(),
    master: loadStorage('master', []),
    inventory: loadStorage('inventory', []),
    history: loadStorage('history', []),
    productions: loadStorage('productions', DEFAULT_PRODUCTIONS),
    workOrders: loadStorage('workOrders', DEFAULT_WORK_ORDERS),
    rawLedger: loadStorage('rawLedger', []),
    productLedger: loadStorage('productLedger', []),   // 제품(완제품) 수불부
    materialLedger: loadStorage('materialLedger', []), // 자재(부자재·소모품·기타) 수불부
    mergeLog: loadStorage('mergeLog', []), // 품목 마스터 합치기 이력 (로컬 모드 되돌리기용)
    slips: loadStorage('slips', []), // 발행한 이동전표·출고요청서 (로컬 모드. 클라우드 모드는 wms_slips)
    beginningStock: loadStorage('beginningStock', {}),
    schedules: loadStorage('schedules', DEFAULT_SCHEDULES),
    gimpoLogs: loadStorage('gimpoLogs', []),
    hqLogs: loadStorage('hqLogs', []),
    dashboardSettings: loadStorage('dashboardSettings', {
        showKpi: true,
        showQrWidget: true,
        showQuickAction: true,
        showLowSafety: true,
        showHistory: true,
        showOilCalc: true,
        refreshInterval: 0,
        lowSafetyFilter: 'all',
        historyCount: 5
    }),
    homeWidgets: loadStorage('homeWidgets', {
        "widget-scan-action": true,
        "widget-low-safety": true,
        "widget-today-calendar": true,
        "widget-recent-history": true,
        "widget-quick-transfer": true,
        "widget-quick-label": true,
        "widget-monthly-summary": true
    })
};

// 로컬 스토리지에 남아있을 수 있는 홍길동 데이터 영구 정제
saveStorage('workers', state.workers);
saveStorage('currentWorker', state.currentGlobalWorker);

// 로컬 캐시의 예전 거점명 마이그레이션 (거점 목록 · 재고 · 이력 · 생산실적 · 작업지시서)
{
    const locs = normalizeLocationList(state.locations);
    if (JSON.stringify(locs) !== JSON.stringify(state.locations)) {
        state.locations = locs;
        saveStorage('locations', state.locations);
    }
    const inv = migrateInventoryLocations(state.inventory);
    if (inv.changed) { state.inventory = inv.list; saveStorage('inventory', state.inventory); }
    const hist = migrateHistoryLocations(state.history);
    if (hist.changed) { state.history = hist.list; saveStorage('history', state.history); }
    const prods = migrateDocLocations(state.productions);
    if (prods.changed) { state.productions = prods.list; saveStorage('productions', state.productions); }
    const wos = migrateDocLocations(state.workOrders);
    if (wos.changed) { state.workOrders = wos.list; saveStorage('workOrders', state.workOrders); }
}

// 예전 번들 데이터 전용 키 정리 (번들 기본 품목 동기화 기준 목록, 김포 데이터 요약)
try {
    localStorage.removeItem('daelim_masterSeedCodes');
    localStorage.removeItem('daelim_gimpoDataSummary');
} catch { /* 저장소 사용 불가 */ }

if (Array.isArray(state.inventory) && Array.isArray(state.master)) {
    // 마스터에 존재하지 않는 불일치 재고 제거
    const masterCodes = new Set(state.master.map(m => m.code));
    state.inventory = state.inventory.filter(i => masterCodes.has(i.code));
    saveStorage('inventory', state.inventory);
}
if (Array.isArray(state.categories)) {
    const validCategories = MASTER_CATEGORIES; // ['완제품', '원액', '원료', '부자재', '소모품', '기타']
    state.categories = [...validCategories];
    saveStorage('categories', state.categories);
}
if (Array.isArray(state.partners)) {
    if (!state.partners.some(p => typeof p === 'string' ? p.includes('에이치엘비') : (p.name && p.name.includes('에이치엘비')))) {
        state.partners.push("에이치엘비글로벌(주)");
        saveStorage('partners', state.partners);
    }
}

// 마스터 품목의 대분류(6종) 및 중분류(14종) 공식 체계 정밀 동기화
if (Array.isArray(state.master)) {
    let masterChanged = false;
    for (const m of state.master) {
        const determined = determineCategoryAndSubCategory(m);
        if (m.category !== determined.category || m.subCategory !== determined.subCategory) {
            m.category = determined.category;
            m.subCategory = determined.subCategory;
            masterChanged = true;
        }
    }
    if (masterChanged) {
        saveStorage('master', state.master);
    }
}

// 재고 목록의 분류(category) 및 중분류(subCategory)를 마스터 품목과 정밀 동기화
if (Array.isArray(state.inventory) && Array.isArray(state.master)) {
    const masterMap = new Map();
    for (const m of state.master) masterMap.set(m.code, m);
    let invChanged = false;
    for (const inv of state.inventory) {
        const m = masterMap.get(inv.code);
        if (m) {
            if (inv.category !== m.category || inv.subCategory !== m.subCategory) {
                inv.category = m.category;
                inv.subCategory = m.subCategory;
                invChanged = true;
            }
        }
    }
    if (invChanged) {
        saveStorage('inventory', state.inventory);
    }
}


// Supabase 1,000건 제한을 우회하여 전체 데이터를 페이징 조회하는 헬퍼 함수
const fetchAllFromTable = async (supabase, tableName, selectColumns = '*', orderBy = 'code') => {
    let allData = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
        let query = supabase.from(tableName).select(selectColumns);
        if (orderBy) {
            query = query.order(orderBy);
        }
        const { data, error } = await query.range(from, from + batchSize - 1);
        if (error) {
            console.error(`[DB] ${tableName} 데이터 페이징 로드 실패:`, error);
            break;
        }
        if (!data || data.length === 0) break;
        allData.push(...data);
        if (data.length < batchSize) break;
        from += batchSize;
    }
    return allData;
};

// 입출고 이력을 최신순으로 페이징 조회 (예전에는 최근 200건만 받아 이력 화면·집계에서 오래된 기록이 빠졌다)
const HISTORY_LOAD_LIMIT = 20000;
const fetchRecentHistory = async (supabase) => {
    const data = [];
    for (let from = 0; from < HISTORY_LOAD_LIMIT; from += 1000) {
        const res = await supabase.from('wms_history_logs').select('*').order('id', { ascending: false }).range(from, from + 999);
        if (res.error) return from === 0 ? res : { data };
        if (!res.data || res.data.length === 0) break;
        data.push(...res.data);
        if (res.data.length < 1000) break;
    }
    return { data };
};

// ==========================================
// 클라우드 재고 증감 (여러 기기 동시 작업 안전)
// ==========================================
// 재고를 로컬 값 기준 절댓값으로 덮어쓰면 여러 기기가 동시에 작업할 때 한쪽 변경이 사라지므로,
// "현재 값이 방금 읽은 값일 때만 교체"하는 비교 후 교체(compare-and-swap) 방식으로 증감만 반영한다.
class RemoteStockShortageError extends Error {}

const roundQty = (n) => Math.round(n * 1e6) / 1e6;

const adjustRemoteInventory = async (supabase, code, location, delta, { allowNegative = true } = {}) => {
    for (let attempt = 0; attempt < 5; attempt++) {
        const { data: rows, error } = await supabase.from('wms_inventory')
            .select('quantity').eq('code', code).eq('location', location).limit(1);
        if (error) throw error;

        if (!rows || rows.length === 0) {
            if (!allowNegative && delta < 0) {
                throw new RemoteStockShortageError(`[재고 부족] ${location}의 클라우드 재고(0)가 요청 수량(${-delta})보다 부족합니다.`);
            }
            const { error: insErr } = await supabase.from('wms_inventory').insert({
                code, location, quantity: delta, status: '정상 보관', last_updated: new Date().toISOString()
            });
            if (!insErr) return delta;
            if (insErr.code === '23505') continue; // 다른 기기가 같은 재고 행을 먼저 생성함 → 재시도
            throw insErr;
        }

        const current = Number(rows[0].quantity) || 0;
        const next = roundQty(current + delta);
        if (!allowNegative && next < 0) {
            throw new RemoteStockShortageError(`[재고 부족] ${location}의 클라우드 재고(${current})가 요청 수량(${-delta})보다 부족합니다. 다른 기기에서 먼저 출고되었을 수 있습니다.`);
        }
        const { data: updated, error: updErr } = await supabase.from('wms_inventory')
            .update({ quantity: next, last_updated: new Date().toISOString() })
            .eq('code', code).eq('location', location).eq('quantity', rows[0].quantity)
            .select('quantity');
        if (updErr) throw updErr;
        if (updated && updated.length > 0) return next;
        // 읽은 뒤 다른 기기가 수량을 바꿈 → 최신 값으로 재시도
    }
    throw new Error(`[${code} / ${location}] 동시 수정 충돌이 반복되어 클라우드 재고를 반영하지 못했습니다.`);
};

// 여러 재고 증감을 클라우드에 반영한다. 차감을 먼저 처리하며, 클라우드 재고가 부족하면
// 이미 반영한 증감을 되돌리고 RemoteStockShortageError를 던진다 (호출자는 로컬 반영 전에 중단).
// 반환: Map(invKey -> 반영 후 클라우드 수량). Supabase 미설정 시 null (로컬 전용으로 진행).
// 통신 오류면 반영한 증감을 되돌리고 예외를 던진다 (호출자는 로컬 반영 전에 중단).
const applyRemoteInventoryDeltas = async (deltas) => {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured() || deltas.length === 0) return null;

    const ordered = [...deltas].sort((a, b) => a.delta - b.delta);
    const applied = [];
    const result = new Map();
    try {
        for (const d of ordered) {
            const qty = await adjustRemoteInventory(supabase, d.code, d.location, d.delta, { allowNegative: d.delta >= 0 });
            applied.push(d);
            result.set(invKey(d.code, d.location), qty);
        }
        return result;
    } catch (err) {
        for (const d of applied.reverse()) {
            try {
                await adjustRemoteInventory(supabase, d.code, d.location, -d.delta);
            } catch (rollbackErr) {
                console.error('[DB] 클라우드 재고 롤백 실패:', d, rollbackErr);
            }
        }
        if (err instanceof RemoteStockShortageError) throw err;
        // 로컬에만 반영하고 넘어가면 이력·수불부 전표는 클라우드에 남고 재고는 다음 로드 때 클라우드 값으로
        // 덮여 서로 어긋난다. 클라우드를 쓰는 중에는 재고를 반영하지 못하면 처리 전체를 취소한다.
        reportSyncError('재고 수량', err);
        throw new Error(`[클라우드 연결 오류] 재고를 클라우드에 반영하지 못해 처리를 취소했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요. (${err?.message || err})`);
    }
};

// 로컬 재고 증감 (해당 거점 재고가 없으면 마스터 정보로 새로 생성)
const adjustLocalInventory = (code, location, delta, masterItem, itemName, nowStr) => {
    let inv = state.inventory.find(i => i.code === code && i.location === location);
    if (inv) {
        inv.quantity = (Number(inv.quantity) || 0) + delta;
        inv.lastUpdated = nowStr;
    } else {
        inv = {
            category: masterItem?.category || '기타',
            code,
            name: itemName,
            supplier: masterItem?.supplier || '-',
            spec: masterItem?.spec || '-',
            location,
            quantity: delta,
            unit: masterItem?.unit || 'EA',
            status: '정상 보관',
            lastUpdated: nowStr
        };
        state.inventory.push(inv);
    }
    return inv;
};

// 클라우드에 반영된 최종 수량으로 로컬 재고를 맞춤 (다른 기기의 변경분까지 반영)
const syncLocalQuantities = (remoteQtyMap) => {
    if (!remoteQtyMap) return;
    for (const [key, qty] of remoteQtyMap) {
        const [code, location] = key.split('___');
        const inv = state.inventory.find(i => i.code === code && i.location === location);
        if (inv) inv.quantity = qty;
    }
};

// Supabase Realtime으로 받은 다른 기기의 재고 변경을 로컬 상태에 반영
export const applyRealtimeInventoryChange = ({ eventType, new: row, old }) => {
    if (eventType === 'DELETE') {
        if (old && old.code && old.location) {
            state.inventory = state.inventory.filter(i => !(i.code === old.code && i.location === old.location));
            saveStorage('inventory', state.inventory);
        }
        return;
    }
    if (!row || !row.code || !row.location) return;

    const qty = Number(row.quantity) || 0;
    const lastUpdated = row.last_updated ? new Date(row.last_updated).toLocaleString('ko-KR') : '-';
    const inv = state.inventory.find(i => i.code === row.code && i.location === row.location);
    if (inv) {
        inv.quantity = qty;
        inv.status = row.status || inv.status;
        inv.lastUpdated = lastUpdated;
    } else {
        const m = state.master.find(item => item.code === row.code) || {};
        state.inventory.push({
            category: m.category || '기타',
            subCategory: m.subCategory || '-',
            code: row.code,
            name: m.name || row.code,
            supplier: m.supplier || '-',
            spec: m.spec || '-',
            location: row.location,
            quantity: qty,
            unit: m.unit || 'EA',
            status: row.status || '정상 보관',
            lastUpdated
        });
    }
    saveStorage('inventory', state.inventory);
};

// ==========================================
// 데이터 초기 로딩 (Supabase 또는 LocalStorage)
// ==========================================
export const loadAllData = async () => {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured()) {
        console.log('[DB] Supabase 미설정 -> LocalStorage 모드로 동작합니다.');
        await loadLedgers(null);
        return state;
    }

    try {
        console.log('[DB] Supabase 클라우드에서 데이터 동기화 시작...');
        // 로그인 계정은 Supabase Auth(wms_profiles)가 관리하므로 예전 wms_users(평문 비밀번호)는 읽지 않는다
        const [catRes, locRes, workRes, histRes] = await Promise.all([
            supabase.from('wms_categories').select('name').order('created_at'),
            supabase.from('wms_locations').select('name').order('created_at'),
            supabase.from('wms_workers').select('*').order('id'),
            fetchRecentHistory(supabase)
        ]);

        // 대분류 카테고리 동기화 (표준 6대 카테고리: 완제품, 원액, 원료, 부자재, 소모품, 기타 항시 보장)
        if (catRes.data && catRes.data.length > 0) {
            const remoteCats = catRes.data.map(c => c.name);
            state.categories = Array.from(new Set([...MASTER_CATEGORIES, ...remoteCats]));
        } else {
            state.categories = [...MASTER_CATEGORIES];
        }
        saveStorage('categories', state.categories);

        if (locRes.data && locRes.data.length > 0) state.locations = normalizeLocationList(locRes.data.map(l => l.name));
        if (workRes.data && workRes.data.length > 0) state.workers = workRes.data;

        // 마스터 품목 및 재고 전량 페이징 로드 (1,000건 초과 데이터 완전 조회)
        const [fetchedMaster, fetchedInv] = await Promise.all([
            fetchAllFromTable(supabase, 'wms_master_items', '*', 'code'),
            fetchAllFromTable(supabase, 'wms_inventory', '*', 'code')
        ]);

        if (fetchedMaster && fetchedMaster.length > 0) {
            for (const m of fetchedMaster) {
                const determined = determineCategoryAndSubCategory(m);
                m.category = determined.category;
                m.subCategory = determined.subCategory;
            }
            state.master = fetchedMaster;
            saveStorage('master', state.master);
        }

        if (fetchedInv && fetchedInv.length > 0) {
            // 마스터 정보를 조합하여 inventory 포맷 보정
            state.inventory = fetchedInv.map(inv => {
                const m = state.master.find(item => item.code === inv.code) || {};
                return {
                    category: m.category || '기타',
                    subCategory: m.subCategory || '-',
                    code: inv.code,
                    name: m.name || inv.code,
                    supplier: m.supplier || '-',
                    spec: m.spec || '-',
                    location: inv.location,
                    quantity: Number(inv.quantity) || 0,
                    unit: m.unit || 'EA',
                    status: inv.status || '정상 보관',
                    lastUpdated: inv.last_updated ? new Date(inv.last_updated).toLocaleString('ko-KR') : '-'
                };
            });
            saveStorage('inventory', state.inventory);

            // 클라우드 재고에 아직 예전 거점명(방산 창고 등)이 남아 있으면 선택 목록에서 사라지지 않도록 유지한다.
            // (클라우드 재고 행은 supabase/auth/05_sites_buildings.sql 실행 시 새 거점명으로 옮겨진다)
            const legacyLocs = [...new Set(state.inventory.map(i => i.location).filter(l => LEGACY_SITE_MAP[siteOf(l)]))];
            if (legacyLocs.length > 0) {
                console.warn('[DB] 클라우드 재고에 예전 거점명이 남아 있습니다. 05_sites_buildings.sql을 실행하세요:', legacyLocs);
                state.locations = [...state.locations, ...legacyLocs.filter(l => !state.locations.includes(l))];
            }
        }
        saveStorage('locations', state.locations);

        if (histRes.data && histRes.data.length > 0) {
            state.history = histRes.data.map(h => ({
                id: h.id,
                timestamp: h.timestamp ? new Date(h.timestamp).toLocaleString('ko-KR') : '-',
                type: h.type,
                code: h.code,
                name: h.name,
                qty: Number(h.qty) || 0,
                worker: h.worker,
                fromLoc: h.from_loc || '-',
                toLoc: h.to_loc || '-',
                reason: h.reason || '-'
            }));
        }

        try {
            const schedRes = await supabase.from('wms_schedules').select('*').order('schedule_date');
            // 클라우드 모드는 비어 있어도 클라우드 기준 (로컬 예시 일정을 보여주지 않음)
            if (schedRes.data && !schedRes.error) {
                state.schedules = schedRes.data.map(s => ({
                    calendar: s.calendar || 'HQ',
                    owner: s.owner || '',
                    ownerName: s.owner_name || '',
                    startTime: s.start_time || '',
                    endTime: s.end_time || '',
                    attachments: Array.isArray(s.attachments) ? s.attachments : [],
                    slipNos: s.slip_nos || [],
                    id: s.id,
                    date: s.schedule_date,
                    type: s.type,
                    title: s.title,
                    itemCode: s.item_code || '',
                    itemName: s.item_name || '',
                    partner: s.partner || '',
                    worker: s.worker || '',
                    notes: s.notes || '',
                    status: s.status || 'TODO'
                }));
            }
        } catch (schedErr) {
            console.warn('[DB] Supabase wms_schedules 로드 생략:', schedErr);
        }

        await loadLedgers(supabase);

        try {
            await loadGimpoLogs(supabase);
        } catch (gimpoErr) {
            console.warn('[DB] Supabase wms_gimpo_logs 로드 생략 (이 기기 데이터 사용):', gimpoErr);
        }
        try {
            await loadGimpoLogs(supabase, 'HQ');
        } catch (hqErr) {
            console.warn('[DB] Supabase wms_hq_logs 로드 생략 (이 기기 데이터 사용):', hqErr);
        }

        console.log('[DB] Supabase 데이터 동기화 완료!');
    } catch (e) {
        console.warn('[DB] Supabase 데이터 로드 중 오류 발생, 로컬 캐시를 사용합니다:', e);
    }
    return state;
};

// ==========================================
// 마스터 품목 관리 (Master Items)
// ==========================================
export const saveMasterItem = async (item) => {
    const subCategory = item.subCategory || determineSubCategory(item);
    const itemToSave = { ...item, subCategory };

    const existingIdx = state.master.findIndex(m => m.code === item.code);
    if (existingIdx >= 0) {
        state.master[existingIdx] = { ...state.master[existingIdx], ...itemToSave };
    } else {
        state.master.push(itemToSave);
    }
    saveStorage('master', state.master);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_master_items').upsert({
            code: itemToSave.code,
            name: itemToSave.name,
            category: itemToSave.category,
            supplier: itemToSave.supplier,
            manufacturer: itemToSave.manufacturer || null,
            spec: itemToSave.spec,
            unit: itemToSave.unit || 'EA',
            safety: Number(itemToSave.safety) || 0
        }), '품목 마스터 저장');
    }
};

export const deleteMasterItem = async (code) => {
    state.master = state.master.filter(m => m.code !== code);
    state.inventory = state.inventory.filter(i => i.code !== code);
    saveStorage('master', state.master);
    saveStorage('inventory', state.inventory);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_master_items').delete().eq('code', code), '품목 마스터 삭제');
    }
};

// 품목 마스터 일괄 추가/수정 (엑셀 / 구글 시트 연동)
export const bulkUpsertMasterItems = async (items) => {
    if (!items || !Array.isArray(items) || items.length === 0) {
        return { success: false, message: '등록할 품목 데이터가 없습니다.', total: 0, newCount: 0, updatedCount: 0 };
    }

    let newCount = 0;
    let updatedCount = 0;
    const upsertList = [];

    for (const raw of items) {
        if (!raw.code && !raw.name) continue;

        // 품목명 안에 품목코드가 있거나 복합 문자열인 경우 자동 정제
        let code = String(raw.code || '').trim();
        let name = String(raw.name || '').trim();

        if (!code && name) {
            const parsed = parseEmbeddedCode(name);
            code = parsed.code;
            name = parsed.name;
        } else if (code.includes(' / ') || code.includes('  ')) {
            const parsed = parseEmbeddedCode(code);
            code = parsed.code;
            if (!name) name = parsed.name;
        }

        if (!code) continue;

        const catRes = determineCategoryAndSubCategory({
            code,
            name,
            category: raw.category,
            subCategory: raw.subCategory
        });

        const itemToSave = {
            code,
            name: name || code,
            category: catRes.category || raw.category || '완제품',
            subCategory: catRes.subCategory || raw.subCategory || '자사제품',
            spec: raw.spec !== undefined ? String(raw.spec).trim() : '',
            supplier: raw.supplier !== undefined ? String(raw.supplier).trim() : '',
            unit: raw.unit || 'EA',
            safety: Number(raw.safety) || 0
        };

        const existingIdx = state.master.findIndex(m => m.code === code);
        if (existingIdx >= 0) {
            state.master[existingIdx] = {
                ...state.master[existingIdx],
                ...itemToSave,
                spec: itemToSave.spec || state.master[existingIdx].spec || '',
                supplier: itemToSave.supplier || state.master[existingIdx].supplier || '',
                safety: itemToSave.safety || state.master[existingIdx].safety || 0
            };
            updatedCount++;
        } else {
            state.master.push(itemToSave);
            newCount++;
        }

        upsertList.push({
            code: itemToSave.code,
            name: itemToSave.name,
            category: itemToSave.category,
            supplier: itemToSave.supplier,
            spec: itemToSave.spec,
            unit: itemToSave.unit,
            safety: itemToSave.safety
        });
    }

    saveStorage('master', state.master);

    // Supabase 일괄 Upsert (100개 단위 청크)
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured() && upsertList.length > 0) {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < upsertList.length; i += CHUNK_SIZE) {
            const chunk = upsertList.slice(i, i + CHUNK_SIZE);
            await checkWrite(supabase.from('wms_master_items').upsert(chunk), `품목 마스터 일괄 등록 (${i + 1}~${i + chunk.length}번째)`);
        }
    }

    return {
        success: true,
        total: upsertList.length,
        newCount,
        updatedCount,
        message: `총 ${upsertList.length}건 처리 완료 (신규 등록: ${newCount}건, 기존 품목 수정: ${updatedCount}건)`
    };
};

// ==========================================
// 재고 입출고 및 이동 처리 (Transactions)
// ==========================================
export const processStockAction = async ({ type, code, qty, location, fromLoc, toLoc, worker, reason }) => {
    qty = Number(qty);
    if (!qty || qty <= 0) throw new Error('유효한 수량을 입력하세요.');

    const masterItem = state.master.find(m => m.code === code);
    const itemName = masterItem ? masterItem.name : code;
    const nowStr = new Date().toLocaleString('ko-KR');

    // 1. 로컬 재고 기준 사전 검증 및 증감 목록 구성
    let deltas = [];
    if (type === 'IN') {
        deltas = [{ code, location: location || toLoc, delta: qty }];
    } else if (type === 'OUT' || type === 'USE') {
        const targetLoc = location || fromLoc;
        const invItem = state.inventory.find(i => i.code === code && i.location === targetLoc);
        if (!invItem || invItem.quantity < qty) {
            throw new Error(`[출고 불가] ${targetLoc}의 현재 재고(${invItem ? invItem.quantity : 0}EA)가 요청 수량(${qty}EA)보다 부족합니다.`);
        }
        deltas = [{ code, location: targetLoc, delta: -qty }];
    } else if (type === 'MOVE') {
        if (!fromLoc || !toLoc || fromLoc === toLoc) {
            throw new Error('출발 거점과 도착 거점이 서로 달라야 합니다.');
        }
        const sourceItem = state.inventory.find(i => i.code === code && i.location === fromLoc);
        if (!sourceItem || sourceItem.quantity < qty) {
            throw new Error(`[이동 불가] ${fromLoc}의 현재 재고(${sourceItem ? sourceItem.quantity : 0}EA)가 부족합니다.`);
        }
        deltas = [
            { code, location: fromLoc, delta: -qty },
            { code, location: toLoc, delta: qty }
        ];
    }

    // 2. 클라우드 재고 증감 (설정 시). 클라우드 재고가 부족하면 로컬 반영 전에 예외로 중단된다.
    const remoteQty = await applyRemoteInventoryDeltas(deltas);

    // 3. 로컬 재고 반영 후 클라우드 최종 수량으로 보정
    for (const d of deltas) {
        adjustLocalInventory(d.code, d.location, d.delta, masterItem, itemName, nowStr);
    }
    syncLocalQuantities(remoteQty);

    // 4. 이력 로그 생성
    const newLog = {
        id: Date.now(),
        timestamp: nowStr,
        type,
        code,
        name: itemName,
        qty,
        worker: worker || state.currentGlobalWorker,
        fromLoc: type === 'IN' ? '-' : (fromLoc || location || '-'),
        toLoc: (type === 'OUT' || type === 'USE') ? '-' : (toLoc || location || '-'),
        reason: reason || '-'
    };
    state.history.unshift(newLog);

    saveStorage('inventory', state.inventory);
    saveStorage('history', state.history);

    // 5. Supabase 이력 로그 삽입 (재고 증감은 2단계에서 이미 반영됨)
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_history_logs').insert([{
            type: newLog.type,
            code: newLog.code,
            name: newLog.name,
            qty: newLog.qty,
            worker: newLog.worker,
            from_loc: newLog.fromLoc,
            to_loc: newLog.toLoc,
            reason: newLog.reason
        }]), '입출고 이력');
    }

    // 6. 수불부 자동 기입 (원료 → 원료수불부, 완제품 → 제품수불부, 그 밖 → 자재수불부)
    await recordLedgerMovements([logToMovement(newLog, 'H')]);

    return { success: true, log: newLog };
};

// ==========================================
// 제품/원액/반제품 생산 입고 처리 (Production Inbound)
// ==========================================
export const processProductionInbound = async ({
    prodType = '완제품',
    prodItemCode,
    prodQty,
    packaging = '200L 드럼',
    unit = 'DRUM',
    lotNo,
    mfgDate,
    expDate,
    location = '김포공장',
    worker,
    bomDeducted = false,
    bomDetails = [],
    rawMaterials = [],
    subMaterials = [],
    workOrderNo = '',
    notes = ''
}) => {
    prodQty = Number(prodQty);
    if (!prodQty || prodQty <= 0) throw new Error('유효한 생산 수량을 입력하세요.');
    if (!prodItemCode) throw new Error('생산 대상 품목을 선택하세요.');
    if (!lotNo) throw new Error('생산 LOT 번호를 입력하세요.');

    const masterItem = state.master.find(m => m.code === prodItemCode);
    const itemName = masterItem ? masterItem.name : prodItemCode;
    const nowStr = new Date().toLocaleString('ko-KR');
    const operator = worker || state.currentGlobalWorker;

    // 원료 및 부자재 통합 목록 구성
    let allMaterials = [...(bomDetails || [])];
    if (Array.isArray(rawMaterials) && rawMaterials.length > 0) {
        allMaterials.push(...rawMaterials.map(m => ({ ...m, matType: m.matType || '원료' })));
    }
    if (Array.isArray(subMaterials) && subMaterials.length > 0) {
        allMaterials.push(...subMaterials.map(m => ({ ...m, matType: m.matType || '부자재' })));
    }

    const hasMaterials = allMaterials.length > 0;
    const shouldDeduct = bomDeducted || hasMaterials;

    // 1. 원부자재 소모(BOM) 차감 사전 재고 검증
    if (shouldDeduct && allMaterials.length > 0) {
        for (const bom of allMaterials) {
            const bQty = Number(bom.qty);
            if (bQty > 0) {
                const targetLoc = bom.location || location;
                const inv = state.inventory.find(i => i.code === bom.code && i.location === targetLoc);
                const currentQty = inv ? Number(inv.quantity) : 0;
                if (!inv || currentQty < bQty) {
                    throw new Error(`[원부자재 부족] '${bom.name || bom.code}' (${bom.matType || '자재'})의 [${targetLoc}] 현재고(${currentQty})가 소요량(${bQty})보다 부족하여 생산 입고를 진행할 수 없습니다.`);
                }
            }
        }
    }

    // 클라우드 재고 증감 (원부자재 차감 + 생산품 증가). 클라우드 재고가 부족하면 로컬 반영 전에 예외로 중단된다.
    const remoteDeltas = [];
    if (shouldDeduct) {
        for (const bom of allMaterials) {
            const bQty = Number(bom.qty);
            if (bQty > 0) remoteDeltas.push({ code: bom.code, location: bom.location || location, delta: -bQty });
        }
    }
    remoteDeltas.push({ code: prodItemCode, location, delta: prodQty });
    const remoteQty = await applyRemoteInventoryDeltas(remoteDeltas);

    const bomLogs = [];
    if (shouldDeduct && allMaterials.length > 0) {
        // 실제 재고 차감 및 출고(USE) 이력 기록
        for (const bom of allMaterials) {
            const bQty = Number(bom.qty);
            if (bQty > 0) {
                const targetLoc = bom.location || location;
                const inv = state.inventory.find(i => i.code === bom.code && i.location === targetLoc);
                inv.quantity -= bQty;
                inv.lastUpdated = nowStr;

                const matTypeStr = bom.matType ? `[${bom.matType}] ` : '';
                const bomLog = {
                    id: Date.now() + Math.floor(Math.random() * 1000),
                    timestamp: nowStr,
                    type: 'USE',
                    code: bom.code,
                    name: bom.name || bom.code,
                    qty: bQty,
                    worker: operator,
                    fromLoc: targetLoc,
                    toLoc: '-',
                    reason: `[${prodType} 생산 투입] ${matTypeStr}${bom.name || bom.code} 소모 (LOT: ${lotNo})`,
                    notes: `${prodType} '${itemName}' ${prodQty}${unit || ''} 제조/포장 ${workOrderNo ? '(지시서 ' + workOrderNo + ')' : ''} 투입에 따른 자동 차감`
                };
                state.history.unshift(bomLog);
                bomLogs.push(bomLog);
            }
        }
    }

    // 2. 생산품(완제품/원액/반제품) 재고 증가
    let prodInv = state.inventory.find(i => i.code === prodItemCode && i.location === location);
    if (prodInv) {
        prodInv.quantity += prodQty;
        prodInv.lastUpdated = nowStr;
    } else {
        prodInv = {
            category: prodType || masterItem?.category || '완제품',
            code: prodItemCode,
            name: itemName,
            supplier: masterItem?.supplier || '대림오일(자체생산)',
            spec: masterItem?.spec || '-',
            location: location,
            quantity: prodQty,
            unit: masterItem?.unit || unit,
            status: '정상 보관',
            lastUpdated: nowStr
        };
        state.inventory.push(prodInv);
    }
    syncLocalQuantities(remoteQty);

    // 3. 생산품 입고(IN) 이력 로그 생성
    const prodInLog = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        timestamp: nowStr,
        type: 'IN',
        code: prodItemCode,
        name: itemName,
        qty: prodQty,
        worker: operator,
        fromLoc: `생산라인 (${prodType} 제조)`,
        toLoc: location,
        reason: `${prodType} 생산 입고 [${lotNo}] (${packaging})`,
        notes: `제조: ${mfgDate || '-'}, 유효: ${expDate || '-'} | ${workOrderNo ? '작업지시서: ' + workOrderNo + ' | ' : ''}${notes || '품질검사 적합'}`
    };
    state.history.unshift(prodInLog);

    // 4. 생산 실적 마스터 레코드 등록
    const newProduction = {
        id: `PROD-${Date.now()}`,
        prodType: prodType || '완제품',
        prodDate: mfgDate || localDateStr(),
        itemCode: prodItemCode,
        itemName,
        packaging,
        qty: prodQty,
        unit,
        lotNo,
        mfgDate: mfgDate || localDateStr(),
        expDate: expDate || '',
        location,
        worker: operator,
        bomDeducted: shouldDeduct,
        bomDetails: allMaterials,
        rawMaterials: rawMaterials || [],
        subMaterials: subMaterials || [],
        workOrderNo: workOrderNo || '',
        notes
    };

    if (!state.productions) state.productions = [];
    state.productions.unshift(newProduction);

    // 5. 작업지시서 연동 시 상태 완료 업데이트
    if (workOrderNo && state.workOrders) {
        const targetWo = state.workOrders.find(w => w.orderNo === workOrderNo || w.id === workOrderNo);
        if (targetWo) {
            targetWo.status = 'COMPLETED';
            targetWo.completedAt = nowStr;
            targetWo.completedQty = prodQty;
            targetWo.completedLot = lotNo;
            saveStorage('workOrders', state.workOrders);
        }
    }

    // 6. 로컬스토리지 저장
    saveStorage('inventory', state.inventory);
    saveStorage('history', state.history);
    saveStorage('productions', state.productions);
    if (state.workOrders) {
        saveStorage('workOrders', state.workOrders);
    }

    // 6-1. 원료수불부 자동 기입 (투입 원료 '사용', 생산 원액 '입고'. 수량은 비중으로 L 환산)
    // 재고·이력은 이미 반영되었으므로 여기서 실패해도 생산 입고는 유지하고 경고만 남긴다.
    let rawLedgerEntries = [];
    try {
        rawLedgerEntries = await addRawLedgerEntries(buildProductionRawLedgerEntries({
            materials: shouldDeduct ? allMaterials : [],
            prodItemCode,
            itemName,
            prodQty,
            prodUnit: unit,
            prodType,
            location,
            lotNo,
            date: mfgDate || localDateStr(),
            worker: operator,
            workOrderNo
        }));
        newProduction.rawLedgerIds = rawLedgerEntries.map(e => e.id);
        saveStorage('productions', state.productions);
    } catch (e) {
        reportSyncError('원료수불부 자동 기입', e);
    }
    // 6-2. 제품·자재 수불부 자동 기입 (투입 부자재 '사용', 생산 완제품 '생산입고'). 원료·원액은 위에서 기입함.
    await recordLedgerMovements([...bomLogs, prodInLog].map(l => logToMovement(l, 'H')), { skipRaw: true });

    // 7. Supabase 이력 로그 삽입 (원부자재 투입 USE + 생산품 IN). 재고 증감은 위에서 이미 반영됨.
    // wms_history_logs에는 notes 컬럼이 없고 timestamp는 DB 기본값(NOW())을 쓴다 (processStockAction과 동일).
    if (isSupabaseConfigured()) {
        const supabase = getSupabase();
        if (supabase) {
            await checkWrite(supabase.from('wms_history_logs').insert([...bomLogs, prodInLog].map(l => ({
                type: l.type,
                code: l.code,
                name: l.name,
                qty: l.qty,
                worker: l.worker,
                from_loc: l.fromLoc,
                to_loc: l.toLoc,
                reason: l.reason
            }))), '생산 입고 이력');
        }
    }

    return { success: true, production: newProduction, log: prodInLog, rawLedgerEntries };
};

export const deleteProductionRecord = async (id) => {
    state.productions = (state.productions || []).filter(p => p.id !== id);
    saveStorage('productions', state.productions);
    return { success: true };
};

// ==========================================
// 원액/제품 작업지시서 관리 (Work Orders)
// ==========================================
export const saveWorkOrder = async (order) => {
    if (!state.workOrders) state.workOrders = [];
    const index = state.workOrders.findIndex(w => w.id === order.id || (w.orderNo && w.orderNo === order.orderNo));
    if (index >= 0) {
        state.workOrders[index] = { ...state.workOrders[index], ...order, updatedAt: new Date().toISOString() };
    } else {
        state.workOrders.unshift({
            ...order,
            createdAt: order.createdAt || new Date().toISOString()
        });
    }
    saveStorage('workOrders', state.workOrders);
    return { success: true, workOrders: state.workOrders };
};

export const deleteWorkOrder = async (orderNoOrId) => {
    if (!state.workOrders) return { success: true };
    state.workOrders = state.workOrders.filter(w => w.id !== orderNoOrId && w.orderNo !== orderNoOrId);
    saveStorage('workOrders', state.workOrders);
    return { success: true, workOrders: state.workOrders };
};

export const completeWorkOrder = async (orderNoOrId) => {
    if (!state.workOrders) return { success: false };
    const order = state.workOrders.find(w => w.id === orderNoOrId || w.orderNo === orderNoOrId);
    if (!order) return { success: false, message: '작업지시서를 찾을 수 없습니다.' };
    order.status = 'COMPLETED';
    order.completedAt = new Date().toLocaleString('ko-KR');
    saveStorage('workOrders', state.workOrders);
    return { success: true, order };
};

// ==========================================
// 재고 실사 보정 (Audit Commit)
// ==========================================
export const commitStockAudit = async (auditMap, workerName, auditDate) => {
    const keys = Object.keys(auditMap);
    if (keys.length === 0) return;

    const recordTime = auditDate ? `${auditDate} ${new Date().toLocaleTimeString('ko-KR')}` : new Date().toLocaleString('ko-KR');
    const movements = [];

    for (const key of keys) {
        const [code, location] = key.split('___');
        const { actualQty, reason } = auditMap[key];
        const masterItem = state.master.find(m => m.code === code);
        const itemName = masterItem ? masterItem.name : code;
        let invItem = state.inventory.find(i => i.code === code && i.location === location);
        const prevQty = invItem ? invItem.quantity : 0;
        const diff = actualQty - prevQty;

        if (invItem) {
            invItem.quantity = actualQty;
            invItem.lastUpdated = recordTime;
        } else {
            invItem = {
                category: masterItem?.category || '기타',
                code,
                name: itemName,
                supplier: masterItem?.supplier || '-',
                spec: masterItem?.spec || '-',
                location,
                quantity: actualQty,
                unit: masterItem?.unit || 'EA',
                status: '정상 보관',
                lastUpdated: recordTime
            };
            state.inventory.push(invItem);
        }

        // 실사 이력 추가
        const newLog = {
            id: Date.now() + Math.random(),
            timestamp: recordTime,
            type: 'AUDIT',
            code,
            name: itemName,
            qty: actualQty,
            worker: workerName || state.currentGlobalWorker,
            fromLoc: location,
            toLoc: location,
            reason: `[실사 일자: ${auditDate || recordTime.slice(0, 10)}] [오차 ${diff > 0 ? '+' : ''}${diff}EA 반영] ${reason || '정기 실사 전산조정'}`
        };
        state.history.unshift(newLog);
        if (diff !== 0) {
            movements.push({
                action: 'AUDIT', code, qty: diff, fromLoc: location, toLoc: location,
                date: auditDate || toDateKey(recordTime) || localDateStr(), reason: newLog.reason, worker: newLog.worker, sourceId: newLog.id, idPrefix: 'H'
            });
        }

        const supabase = getSupabase();
        if (supabase && isSupabaseConfigured()) {
            await checkWrite(supabase.from('wms_inventory').upsert({
                code,
                location,
                quantity: actualQty,
                last_updated: new Date().toISOString()
            }, { onConflict: 'code,location' }), `재고 실사 수량 (${code} / ${location})`);

            await checkWrite(supabase.from('wms_history_logs').insert([{
                type: 'AUDIT',
                code,
                name: itemName,
                qty: actualQty,
                worker: newLog.worker,
                from_loc: location,
                to_loc: location,
                reason: newLog.reason
            }]), '재고 실사 이력');
        }
    }

    saveStorage('inventory', state.inventory);
    saveStorage('history', state.history);

    // 실사 오차를 수불부에 '재고조사' 전표로 기입
    await recordLedgerMovements(movements);
};

// ==========================================
// 기초 정보 관리 (Locations, Categories, Workers)
// ==========================================
export const addCategory = async (name) => {
    if (!name || state.categories.includes(name)) return;
    state.categories.push(name);
    saveStorage('categories', state.categories);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_categories').insert([{ name }]), '분류 추가');
    }
};

export const deleteCategory = async (name) => {
    state.categories = state.categories.filter(c => c !== name);
    saveStorage('categories', state.categories);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_categories').delete().eq('name', name), '분류 삭제');
    }
};

// 위치 등록 (거점 "김포공장" 또는 건물 "김포공장 / 2동")
export const addLocation = async (name) => {
    name = String(name || '').trim();
    if (!name || state.locations.includes(name)) return;
    state.locations = normalizeLocationList([...state.locations, name]);
    saveStorage('locations', state.locations);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_locations').insert([{ name }]), '위치 추가');
    }
};

// 새 거점(공장·창고) 등록
export const addSite = async (site) => {
    site = String(site || '').trim();
    if (!site) throw new Error('거점명을 입력하세요.');
    if (site.includes('/')) throw new Error("거점명에는 '/'를 쓸 수 없습니다.");
    if (state.locations.includes(site)) throw new Error(`'${site}' 거점이 이미 있습니다.`);
    await addLocation(site);
};

// 거점에 건물 등록
export const addBuilding = async (site, building) => {
    building = String(building || '').trim();
    if (!site || !state.locations.includes(site)) throw new Error('건물을 등록할 거점을 선택하세요.');
    if (!building) throw new Error('건물명을 입력하세요.');
    if (building.includes('/')) throw new Error("건물명에는 '/'를 쓸 수 없습니다.");
    const loc = makeLocation(site, building);
    if (state.locations.includes(loc)) throw new Error(`'${site}'에 '${building}' 건물이 이미 있습니다.`);
    await addLocation(loc);
};

// 위치 삭제. 거점을 지우면 그 거점의 건물도 함께 지운다. 재고가 남은 위치와 기본 4대 거점은 지울 수 없다.
export const deleteLocation = async (name) => {
    const isSite = siteOf(name) === name;
    if (isSite && DEFAULT_SITES.includes(name)) {
        throw new Error(`'${name}'은(는) 기본 거점이라 삭제할 수 없습니다.`);
    }
    const targets = isSite ? state.locations.filter(l => siteOf(l) === name) : [name];
    const inUse = targets.filter(l => state.inventory.some(i => i.location === l && Number(i.quantity) !== 0));
    if (inUse.length > 0) {
        throw new Error(`재고가 남아 있어 삭제할 수 없습니다: ${inUse.join(', ')}\n재고를 다른 위치로 이동한 뒤 삭제하세요.`);
    }
    state.locations = state.locations.filter(l => !targets.includes(l));
    saveStorage('locations', state.locations);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_locations').delete().in('name', targets), '위치 삭제');
    }
};

export const saveWorker = async (worker) => {
    const idx = state.workers.findIndex(w => w.id === worker.id);
    if (idx >= 0) state.workers[idx] = worker;
    else state.workers.push(worker);
    saveStorage('workers', state.workers);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_workers').upsert(worker), '작업자 저장');
    }
};

export const deleteWorker = async (id) => {
    state.workers = state.workers.filter(w => w.id !== id);
    saveStorage('workers', state.workers);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_workers').delete().eq('id', id), '작업자 삭제');
    }
};

export const addPartner = async (name) => {
    if (!name || state.partners.includes(name)) return;
    state.partners.push(name);
    saveStorage('partners', state.partners);
};

export const deletePartner = async (name) => {
    state.partners = state.partners.filter(p => p !== name);
    saveStorage('partners', state.partners);
};

export const saveBeginningStock = async (code, qty) => {
    qty = Number(qty) || 0;
    if (!state.beginningStock) state.beginningStock = {};
    state.beginningStock[code] = qty;
    const m = state.master.find(item => item.code === code);
    if (m) m.beginningStock = qty;
    saveStorage('beginningStock', state.beginningStock);
    saveStorage('master', state.master);
};

export const restoreAllData = async (data) => {
    if (data.categories && Array.isArray(data.categories)) {
        state.categories = data.categories;
        saveStorage('categories', state.categories);
    }
    if (data.locations && Array.isArray(data.locations)) {
        state.locations = normalizeLocationList(data.locations);
        saveStorage('locations', state.locations);
    }
    if (data.partners && Array.isArray(data.partners)) {
        state.partners = data.partners;
        saveStorage('partners', state.partners);
    }
    if (data.beginningStock && typeof data.beginningStock === 'object') {
        state.beginningStock = data.beginningStock;
        saveStorage('beginningStock', state.beginningStock);
    }
    if (data.workers && Array.isArray(data.workers)) {
        state.workers = data.workers;
        saveStorage('workers', state.workers);
    }
    if (data.users && Array.isArray(data.users)) {
        state.users = data.users;
        saveStorage('users', state.users);
    }
    if (data.master && Array.isArray(data.master)) {
        state.master = data.master;
        saveStorage('master', state.master);
    }
    if (data.inventory && Array.isArray(data.inventory)) {
        state.inventory = migrateInventoryLocations(data.inventory).list;
        saveStorage('inventory', state.inventory);
    }
    if (data.history && Array.isArray(data.history)) {
        state.history = migrateHistoryLocations(data.history).list;
        saveStorage('history', state.history);
    }
    if (data.schedules && Array.isArray(data.schedules)) {
        state.schedules = data.schedules;
        saveStorage('schedules', state.schedules);
    }
};

// 클라우드 원본이 있는 업무 데이터의 로컬 캐시를 지운다 (로그아웃, 로컬 데이터 초기화).
// 이 기기에서 아직 클라우드에 올리지 못한 수불부 전표가 있으면 잃지 않도록 수불부 캐시는 남긴다.
// 반환: 남겨 둔 수불부 이름 목록
export const clearCloudDataCache = () => {
    if (!getSupabase() || !isSupabaseConfigured()) return []; // 로컬 모드: 이 기기가 원본이므로 지우지 않는다
    const kept = [];
    const ledgerKeys = { rawLedger: rawLedgerSync, productLedger: itemLedgerSyncs.product, materialLedger: itemLedgerSyncs.material };
    const skip = new Set();
    for (const [key, sync] of Object.entries(ledgerKeys)) {
        if (sync.hasUnsyncedChanges()) {
            skip.add(key);
            skip.add(`${key}SyncedIds`);
            kept.push(key);
        }
    }
    for (const key of CLOUD_CACHE_KEYS) {
        if (skip.has(key)) continue;
        try { localStorage.removeItem(`daelim_${key}`); } catch { /* 저장소 사용 불가 */ }
    }
    for (const sync of Object.values(ledgerKeys)) sync.disconnect();
    state.master = [];
    state.inventory = [];
    state.history = [];
    state.schedules = [];
    state.gimpoLogs = [];
    state.hqLogs = [];
    state.workers = [];
    if (!skip.has('rawLedger')) state.rawLedger = [];
    if (!skip.has('productLedger')) state.productLedger = [];
    if (!skip.has('materialLedger')) state.materialLedger = [];
    return kept;
};

export const saveDashboardSettings = (settings) => {
    state.dashboardSettings = { ...state.dashboardSettings, ...settings };
    saveStorage('dashboardSettings', state.dashboardSettings);
};

// ==========================================
// 일정 관리 (Schedules)
// ==========================================
export const saveSchedule = async (schedule) => {
    if (!schedule.id) {
        schedule.id = `SCHED-${Date.now()}`;
    }
    // 캘린더: HQ(본사)·GIMPO(김포)·PERSONAL(개인, 주인만 봄). 개인 일정은 지금 사용자를 주인으로 둔다.
    if (!schedule.calendar) schedule.calendar = 'HQ';
    if (schedule.calendar === 'PERSONAL' && !schedule.owner) {
        schedule.owner = state.currentUser?.id || state.currentUser?.username || '';
        schedule.ownerName = state.currentUser?.name || '';
    }
    const idx = state.schedules.findIndex(s => s.id === schedule.id);
    if (idx >= 0) {
        state.schedules[idx] = { ...state.schedules[idx], ...schedule };
    } else {
        state.schedules.push(schedule);
    }
    state.schedules.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    saveStorage('schedules', state.schedules);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_schedules').upsert({
            id: schedule.id,
            schedule_date: schedule.date,
            type: schedule.type,
            title: schedule.title,
            item_code: schedule.itemCode || null,
            item_name: schedule.itemName || null,
            partner: schedule.partner || null,
            worker: schedule.worker || null,
            notes: schedule.notes || null,
            status: schedule.status || 'TODO',
            calendar: schedule.calendar || 'HQ',
            ...(schedule.owner ? { owner: schedule.owner } : {}),
            owner_name: schedule.ownerName || null,
            start_time: schedule.startTime || null,
            end_time: schedule.endTime || null,
            attachments: schedule.attachments || [],
            slip_nos: schedule.slipNos?.length ? schedule.slipNos : null
        }), '일정 저장');
    }
    return schedule;
};

export const deleteSchedule = async (id) => {
    state.schedules = state.schedules.filter(s => s.id !== id);
    saveStorage('schedules', state.schedules);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_schedules').delete().eq('id', id), '일정 삭제');
    }
};

export const toggleScheduleStatus = async (id) => {
    const s = state.schedules.find(item => item.id === id);
    if (!s) return;
    s.status = s.status === 'DONE' ? 'TODO' : 'DONE';
    saveStorage('schedules', state.schedules);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_schedules').update({ status: s.status }).eq('id', id), '일정 상태 변경');
    }
    return s;
};

// ==========================================
// 이동전표 / 출고요청서 발행 (환경설정 → 거래 출하 전표 발행기)
// ==========================================
// 전표번호: 종류별 접두어(TR 이동전표, RQ 출고요청서, WT 창고간 이동전표) + 날짜 + 당일 일련번호 (TR-20260926-001).
// 클라우드 모드는 wms_slips(supabase/auth/14_create_slips.sql)의 doc_no 중복 금지로 여러 기기가 동시에 발행해도
// 번호가 겹치지 않는다(겹치면 다음 번호로 다시 저장). 로컬 모드는 state.slips에 저장한다.
// 전표 발행은 서류만 남기며 재고는 바꾸지 않는다.
export const SLIP_TYPES = {
    TRANSFER: { prefix: 'TR', title: '원 부 자 재 이 동 전 표', subtitle: 'MATERIAL TRANSFER SLIP', label: '원부자재 이동전표' },
    RELEASE: { prefix: 'RQ', title: '자 재 출 고 및 불 출 요 청 서', subtitle: 'MATERIAL RELEASE REQUEST', label: '출고 및 불출 요청서' },
    // 창고간 이동: 거점뿐 아니라 건물(창고) 단위로 출발·도착을 고른다 (같은 거점 안의 창고 이동 포함)
    WAREHOUSE: { prefix: 'WT', title: '창 고 간 이 동 전 표', subtitle: 'WAREHOUSE TRANSFER SLIP', label: '창고간 이동전표', byBuilding: true }
};
const slipPrefixOf = (type, date) => `${SLIP_TYPES[type]?.prefix || 'TR'}-${String(date || localDateStr()).replace(/-/g, '')}-`;

const slipFromRow = (r) => ({
    id: r.id, docNo: r.doc_no, type: r.slip_type, date: r.issue_date, fromLoc: r.from_loc || '', toLoc: r.to_loc || '',
    partner: r.partner || '', transport: r.transport || '', reason: r.reason || '', worker: r.worker || '',
    items: Array.isArray(r.items) ? r.items : [], createdAt: r.created_at
});

// 다음 전표번호 (발행 전 미리보기용. 실제 번호는 발행 시 확정)
export const nextSlipNo = async (type, date) => {
    const prefix = slipPrefixOf(type, date);
    let max = 0;
    const bump = (docNo) => {
        if (!String(docNo || '').startsWith(prefix)) return;
        const n = parseInt(String(docNo).slice(prefix.length), 10);
        if (n > max) max = n;
    };
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        const { data, error } = await supabase.from('wms_slips').select('doc_no').like('doc_no', `${prefix}%`);
        if (error) throw new Error(`전표번호를 확인하지 못했습니다: ${error.message}`);
        (data || []).forEach(r => bump(r.doc_no));
    } else {
        (state.slips || []).forEach(s => bump(s.docNo));
    }
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
};

// 전표 발행 (저장). 번호가 이미 쓰였으면 다음 번호로 다시 시도한다.
export const issueSlip = async (slip) => {
    const items = (slip.items || []).filter(it => it.code || it.name).map(it => ({
        code: it.code || '', name: it.name || '', spec: it.spec || '', unit: it.unit || 'EA',
        qty: Number(it.qty) || 0, note: it.note || ''
    }));
    if (items.length === 0) throw new Error('전표에 품목을 1개 이상 추가하세요.');
    if (items.some(it => !(it.qty > 0))) throw new Error('수량이 0인 품목이 있습니다.');
    const base = {
        type: SLIP_TYPES[slip.type] ? slip.type : 'TRANSFER',
        date: slip.date || localDateStr(),
        fromLoc: slip.fromLoc || '', toLoc: slip.toLoc || '', partner: slip.partner || '',
        transport: slip.transport || '', reason: slip.reason || '', worker: slip.worker || state.currentGlobalWorker || '',
        items
    };

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        for (let attempt = 0; attempt < 5; attempt++) {
            const docNo = attempt === 0 && slip.docNo && String(slip.docNo).startsWith(slipPrefixOf(base.type, base.date))
                ? slip.docNo
                : await nextSlipNo(base.type, base.date);
            const id = `SLP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
            const { data, error } = await supabase.from('wms_slips').insert({
                id, doc_no: docNo, slip_type: base.type, issue_date: base.date, from_loc: base.fromLoc, to_loc: base.toLoc,
                partner: base.partner, transport: base.transport, reason: base.reason, worker: base.worker, items: base.items
            }).select().single();
            if (!error) return slipFromRow(data);
            if (error.code !== '23505') throw new Error(`전표를 저장하지 못했습니다: ${error.message}`);
            // 다른 기기가 같은 번호를 먼저 발행함 → 다음 번호로 재시도
        }
        throw new Error('전표번호가 계속 겹쳐 발행하지 못했습니다. 잠시 후 다시 시도하세요.');
    }

    let docNo = slip.docNo && String(slip.docNo).startsWith(slipPrefixOf(base.type, base.date)) ? slip.docNo : await nextSlipNo(base.type, base.date);
    if ((state.slips || []).some(s => s.docNo === docNo)) docNo = await nextSlipNo(base.type, base.date);
    const saved = { id: `SLP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, docNo, ...base, createdAt: new Date().toISOString() };
    state.slips = [saved, ...(state.slips || [])].slice(0, 500);
    saveStorage('slips', state.slips);
    return saved;
};

// 최근 발행 전표 목록
export const listSlips = async (limit = 50) => {
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        const { data, error } = await supabase.from('wms_slips').select('*')
            .order('issue_date', { ascending: false }).order('doc_no', { ascending: false }).limit(limit);
        if (error) throw new Error(`발행 이력을 불러오지 못했습니다: ${error.message}`);
        return (data || []).map(slipFromRow);
    }
    return (state.slips || []).slice(0, limit);
};

// ==========================================
// 재고 일자 등록 및 변경 (Inventory Date)
// ==========================================
export const updateInventoryDate = async (code, location, dateStr) => {
    const inv = state.inventory.find(i => i.code === code && i.location === location);
    if (inv) {
        inv.lastUpdated = dateStr;
        saveStorage('inventory', state.inventory);

        const supabase = getSupabase();
        if (supabase && isSupabaseConfigured()) {
            await checkWrite(supabase.from('wms_inventory').update({
                last_updated: new Date(dateStr).toISOString()
            }).match({ code, location }), '재고 일자 변경');
        }
    }
};

export const syncAllLocalDataToSupabase = async (onProgress) => {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured()) {
        throw new Error('Supabase 클라우드 설정(URL 및 Anon Key)이 먼저 필요합니다.');
    }

    // 실패한 단계를 모아 두었다가 끝에 알린다 (일부 실패를 "업로드 완료"로 보고하지 않음)
    const failures = [];
    const upload = async (request, context) => {
        if (!(await checkWrite(request, context))) failures.push(context);
    };

    try {
        if (onProgress) onProgress({ step: '카테고리 동기화 중...', percent: 10 });
        if (state.categories.length > 0) {
            await upload(supabase.from('wms_categories').upsert(
                state.categories.map(name => ({ name })),
                { onConflict: 'name' }
            ), '분류');
        }

        if (onProgress) onProgress({ step: '거점 창고 동기화 중...', percent: 20 });
        if (state.locations.length > 0) {
            await upload(supabase.from('wms_locations').upsert(
                state.locations.map(name => ({ name })),
                { onConflict: 'name' }
            ), '거점');
        }

        if (onProgress) onProgress({ step: '작업자 명단 동기화 중...', percent: 30 });
        if (state.workers.length > 0) {
            await upload(supabase.from('wms_workers').upsert(state.workers, { onConflict: 'id' }), '작업자');
        }
        // 사용자 계정은 업로드하지 않는다 (로그인 계정은 Supabase Auth가 관리, 비밀번호를 테이블에 올리지 않음)

        // 마스터 품목 100건씩 분할 업로드 (총 2,497건)
        const masterItems = state.master;
        const totalItems = masterItems.length;
        const chunkSize = 100;
        for (let i = 0; i < totalItems; i += chunkSize) {
            const chunk = masterItems.slice(i, i + chunkSize).map(m => ({
                code: m.code,
                name: m.name,
                category: m.category,
                supplier: m.supplier || '-',
                spec: m.spec || '-',
                unit: m.unit || 'EA',
                safety: Number(m.safety) || 0
            }));
            const currentPct = 30 + Math.round(((i + chunk.length) / totalItems) * 40);
            if (onProgress) onProgress({ step: `마스터 품목 업로드 중 (${Math.min(i + chunkSize, totalItems)} / ${totalItems})...`, percent: currentPct });
            await upload(supabase.from('wms_master_items').upsert(chunk, { onConflict: 'code' }), `품목 마스터 ${i + 1}~${i + chunk.length}번째`);
        }

        // 재고 데이터 100건씩 분할 업로드 (총 1,439건)
        const invList = state.inventory;
        const totalInv = invList.length;
        for (let i = 0; i < totalInv; i += chunkSize) {
            const chunk = invList.slice(i, i + chunkSize).map(inv => ({
                code: inv.code,
                location: inv.location,
                quantity: Number(inv.quantity) || 0,
                status: inv.status || '정상 보관',
                last_updated: new Date().toISOString()
            }));
            const currentPct = 70 + Math.round(((i + chunk.length) / totalInv) * 20);
            if (onProgress) onProgress({ step: `창고 재고 업로드 중 (${Math.min(i + chunkSize, totalInv)} / ${totalInv})...`, percent: currentPct });
            await upload(supabase.from('wms_inventory').upsert(chunk, { onConflict: 'code,location' }), `창고 재고 ${i + 1}~${i + chunk.length}번째`);
        }

        // 일정 데이터 동기화
        if (state.schedules.length > 0) {
            if (onProgress) onProgress({ step: '일정 관리 데이터 동기화 중...', percent: 95 });
            await upload(supabase.from('wms_schedules').upsert(state.schedules.map(s => ({
                id: s.id,
                schedule_date: s.date,
                type: s.type,
                title: s.title,
                item_code: s.itemCode || null,
                item_name: s.itemName || null,
                partner: s.partner || null,
                worker: s.worker || null,
                notes: s.notes || null,
                status: s.status || 'TODO'
            })), { onConflict: 'id' }), '일정');
        }

        if (failures.length > 0) {
            throw new Error(`클라우드 업로드 중 ${failures.length}개 단계가 실패했습니다: ${failures.slice(0, 5).join(', ')}${failures.length > 5 ? ' 외' : ''}`);
        }
        if (onProgress) onProgress({ step: 'Supabase 클라우드 전체 업로드 완료!', percent: 100 });
        return { success: true, countItems: totalItems, countInv: totalInv };
    } catch (err) {
        console.error('[Supabase Sync Failed]:', err);
        throw err;
    }
};

// ==========================================
// 김포공장 생산공급망 업무일지 (Gimpo Production Logs)
// ==========================================

// 업무일지(생산) 거점: 본사·김포가 같은 양식을 쓰고 저장 위치·재고 반영 거점만 다르다.
// 함수마다 site 인자(기본 'GIMPO')를 받는다. 본사 일지는 wms_hq_logs (supabase/auth/24_create_hq_logs.sql).
export const WORKLOG_SITES = {
    HQ: { key: 'HQ', stateKey: 'hqLogs', table: 'wms_hq_logs', name: '본사', location: '본사 창고', tag: '본사 생산일지',
        moveTo: (route = '') => (route.includes('방산') ? '방산공장' : '김포공장'), defaultRoute: '본사 -> 김포' },
    GIMPO: { key: 'GIMPO', stateKey: 'gimpoLogs', table: 'wms_gimpo_logs', name: '김포', location: '김포공장', tag: '김포 생산일지',
        moveTo: (route = '') => (route.includes('방산') ? '방산공장' : '본사 창고'), defaultRoute: '김포 -> 본사' }
};
const worklogSiteOf = (site) => WORKLOG_SITES[site] || WORKLOG_SITES.GIMPO;
const logsOf = (site) => {
    const s = worklogSiteOf(site);
    if (!Array.isArray(state[s.stateKey])) state[s.stateKey] = [];
    return state[s.stateKey];
};

export const getGimpoLogByDate = (dateStr, site = 'GIMPO') => {
    if (!dateStr) return null;
    const cleanDate = dateStr.trim();
    const logs = logsOf(site);
    // 1. 전체 날짜 YYYY-MM-DD 매칭
    let found = logs.find(l => l.date === cleanDate);
    if (!found) {
        // 2. MMDD 형태 (예: 0831) 매칭
        const mmdd = cleanDate.replace(/-/g, '').slice(-4);
        found = logs.find(l => l.sheetName === mmdd || l.date.endsWith(cleanDate));
    }
    if (found) return JSON.parse(JSON.stringify(found));

    // 없으면 빈 기본 템플릿 반환
    const mm = cleanDate.includes('-') ? cleanDate.slice(5, 7) + cleanDate.slice(8, 10) : cleanDate;
    return {
        sheetName: mm,
        date: cleanDate.includes('-') ? cleanDate : `2026-${cleanDate.slice(0, 2)}-${cleanDate.slice(2, 4)}`,
        manager: state.currentGlobalWorker || '최용화',
        reviewer: '윤경용',
        approver: '',
        packaging: [],
        labeling: [],
        oilBlending: [],
        shipping: [],
        receiving: [],
        movement: [],
        courier: [],
        otherNotes: [],
        otherTasks: []
    };
};

// 업무일지 클라우드 반영 (wms_gimpo_logs, supabase/auth/10_create_gimpo_logs.sql)
// 업무일지 함수는 화면에서 동기 함수로 쓰므로 클라우드 쓰기는 기다리지 않고, 실패하면 동기화 실패 알림만 띄운다.
const gimpoLogToRow = (log) => ({
    log_date: log.date,
    sheet_name: log.sheetName || null,
    data: log,
    updated_at: new Date().toISOString()
});
const pushGimpoLogs = (logs, site = 'GIMPO') => {
    const supabase = getSupabase();
    const valid = logs.filter(l => l && l.date);
    if (!supabase || !isSupabaseConfigured() || valid.length === 0) return;
    const s = worklogSiteOf(site);
    checkWrite(supabase.from(s.table).upsert(valid.map(gimpoLogToRow), { onConflict: 'log_date' }), `${s.name} 업무일지 저장`);
};

// 클라우드 업무일지 로드 (loadAllData에서 호출). 같은 날짜는 클라우드 기준이며,
// 이 기기에만 있는 날짜의 일지는 목록에 남기고 클라우드에 올린다.
const loadGimpoLogs = async (supabase, site = 'GIMPO') => {
    const s = worklogSiteOf(site);
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from(s.table).select('log_date, data').order('log_date').range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < 1000) break;
    }
    const remote = rows.map(r => ({ ...r.data, date: r.log_date }));
    const remoteDates = new Set(remote.map(l => l.date));
    const localOnly = logsOf(site).filter(l => l && l.date && !remoteDates.has(l.date));
    state[s.stateKey] = [...remote, ...localOnly].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    saveStorage(s.stateKey, state[s.stateKey]);
    if (localOnly.length > 0 && canWriteLedger()) {
        console.log(`[DB] 이 기기에만 있는 ${s.name} 업무일지 ${localOnly.length}건을 클라우드에 올립니다.`);
        pushGimpoLogs(localOnly, site);
    }
};

export const saveGimpoLog = (logData, site = 'GIMPO') => {
    if (!logData || !logData.date) return;
    const s = worklogSiteOf(site);
    const logs = logsOf(site);
    const idx = logs.findIndex(l => l.date === logData.date || l.sheetName === logData.sheetName);
    if (idx >= 0) {
        logs[idx] = logData;
    } else {
        logs.unshift(logData);
    }
    // 날짜 역순 정렬
    logs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    saveStorage(s.stateKey, logs);
    pushGimpoLogs([logData], site);
};

export const deleteGimpoLog = (dateStr, site = 'GIMPO') => {
    const s = worklogSiteOf(site);
    const removed = logsOf(site).filter(l => l.date === dateStr || l.sheetName === dateStr);
    state[s.stateKey] = logsOf(site).filter(l => l.date !== dateStr && l.sheetName !== dateStr);
    saveStorage(s.stateKey, state[s.stateKey]);

    const supabase = getSupabase();
    const dates = removed.map(l => l.date).filter(Boolean);
    if (supabase && isSupabaseConfigured() && dates.length > 0) {
        checkWrite(supabase.from(s.table).delete().in('log_date', dates), `${s.name} 업무일지 삭제`);
    }
};

/**
 * 품목 텍스트에서 품목코드와 품목명, 규격을 분리 추출
 * 예: "5AA40028 / SUMOIL 5W40", "2AH40003 / 디알텍 브레이크액 DOT-4 플러스 | 1L", "[DE030124] 썸오일 용기"
 * @param {string} rawText 원본 품목 텍스트
 * @returns {{ code: string, name: string, spec: string } | null}
 */
export const parseEmbeddedCode = (rawText) => {
    if (!rawText || typeof rawText !== 'string') return null;
    const trimmed = rawText.trim();

    // 1. "CODE / NAME | SPEC" 또는 "CODE / NAME" 형식
    const slashMatch = trimmed.match(/^([0-9A-Za-z]{2,}[0-9A-Za-z\-]*)\s*[\/\|]\s*(.*)$/);
    if (slashMatch) {
        const code = slashMatch[1].trim();
        // 0000 임시코드가 아니며 최소 4글자 이상의 영숫자 품목코드 패턴 검증
        if (!code.startsWith('0000') && /^[0-9A-Za-z]{4,15}(\-[0-9A-Za-z]+)?$/.test(code) && (/[A-Za-z]/.test(code) || code.length >= 6)) {
            let rest = slashMatch[2].trim();
            let name = rest;
            let spec = '';
            if (rest.includes('|')) {
                const parts = rest.split('|');
                name = parts[0].trim();
                spec = parts.slice(1).join('|').trim();
            }
            return { code, name, spec };
        }
    }

    // 2. "[CODE] NAME" 형식
    const bracketMatch = trimmed.match(/^\[([0-9A-Za-z]{4,15})\]\s*(.*)$/);
    if (bracketMatch) {
        const code = bracketMatch[1].trim();
        if (!code.startsWith('0000')) {
            return { code, name: bracketMatch[2].trim(), spec: '' };
        }
    }

    return null;
};

/**
 * 품목 텍스트로부터 기존 마스터 품목을 조회하거나,
 * 대조 불가 시 '0000' 임시코드로 신규 마스터 품목 자동 등록 (단, 품목명 안에 품목코드가 있으면 정식 코드로 자동 채번)
 * 
 * @param {string} itemText 품목 텍스트
 * @param {string} [spec=''] 규격
 * @param {string} [category='기타'] 분류
 * @param {string} [unit='EA'] 단위
 * @returns {Promise<{ item: Object, isNewTemp: boolean, matched: boolean }>}
 */
export const getOrCreateMasterItem = async (itemText, spec = '', category = '기타', unit = 'EA') => {
    if (!itemText || !itemText.trim()) return null;
    const cleanText = itemText.trim();

    // 1. 기존 마스터 품목과 지능형 대조
    const matchedMaster = resolveMasterItem(cleanText, spec, category, state.master);
    if (matchedMaster) {
        return { item: matchedMaster, isNewTemp: false, matched: true };
    }

    // 2. 품목명 내에 실제 품목코드가 명기되어 있는 경우 (예: "5AA40028 / SUMOIL 5W40")
    const embedded = parseEmbeddedCode(cleanText);
    if (embedded && embedded.code) {
        // 이미 해당 품목코드가 마스터에 존재하는지 재확인
        const existingByCode = state.master.find(m => m.code.toLowerCase() === embedded.code.toLowerCase());
        if (existingByCode) {
            return { item: existingByCode, isNewTemp: false, matched: true };
        }

        // 마스터에 없더라도 품목코드가 있으므로 임시코드가 아닌 정식 코드로 신규 등록
        const autoCat = determineCategoryAndSubCategory({
            code: embedded.code,
            name: embedded.name,
            spec: embedded.spec || spec,
            category: category || '완제품'
        });

        const newOfficialItem = {
            code: embedded.code,
            name: embedded.name,
            spec: embedded.spec || spec || '-',
            category: autoCat.category,
            subCategory: autoCat.subCategory,
            supplier: '대림오일(김포)',
            unit: (embedded.spec || spec || '').toUpperCase() === 'L' ? 'L' : (unit || 'EA'),
            safety: 20,
            isTemporary: false,
            notes: `[생산공급망 일지 자동등록] 정식 품목코드 채번`
        };

        state.master.push(newOfficialItem);
        saveStorage('master', state.master);

        const supabase = getSupabase();
        if (supabase && isSupabaseConfigured()) {
            await checkWrite(supabase.from('wms_master_items').upsert({
                code: newOfficialItem.code,
                name: newOfficialItem.name,
                category: newOfficialItem.category,
                supplier: newOfficialItem.supplier,
                spec: newOfficialItem.spec,
                unit: newOfficialItem.unit,
                safety: newOfficialItem.safety
            }), `신규 품목 자동 등록 (${newOfficialItem.code})`);
        }

        return { item: newOfficialItem, isNewTemp: false, matched: true };
    }

    // 3. 검색 불가 품목: 이미 동일한 품명으로 등록된 0000 계열 임시 품목이 있는지 확인
    const normTarget = cleanText.toLowerCase().replace(/[\s\-_/\\|()\[\]{}'"`.,:;+~*]/g, '');
    const existingTemp = state.master.find(m => {
        if (!m.code.startsWith('0000')) return false;
        const normName = (m.name || '').toLowerCase().replace(/[\s\-_/\\|()\[\]{}'"`.,:;+~*]/g, '');
        return normName === normTarget;
    });

    if (existingTemp) {
        return { item: existingTemp, isNewTemp: false, matched: false };
    }

    // 4. 신규 0000 임시 품목코드 채번
    // '0000' 코드가 없으면 '0000', 있으면 '0000-001', '0000-002'...
    let assignedCode = '0000';
    const hasBase0000 = state.master.some(m => m.code === '0000');
    if (hasBase0000) {
        const tempCodes = state.master
            .map(m => m.code)
            .filter(c => /^0000(-\d+)?$/.test(c));
        let maxSeq = 0;
        for (const c of tempCodes) {
            if (c.includes('-')) {
                const seq = parseInt(c.split('-')[1], 10);
                if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
            }
        }
        assignedCode = `0000-${String(maxSeq + 1).padStart(3, '0')}`;
    }

    const newTempItem = {
        code: assignedCode,
        name: cleanText,
        spec: spec || '-',
        category: category || '미확정/임시',
        supplier: '임시등록(미확정)',
        unit: unit || 'EA',
        safety: 0,
        isTemporary: true,
        notes: `[생산공급망 일지 자동등록] 정식 품목코드 확인 및 지정 필요`
    };

    state.master.push(newTempItem);
    saveStorage('master', state.master);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_master_items').upsert({
            code: newTempItem.code,
            name: newTempItem.name,
            category: newTempItem.category,
            supplier: newTempItem.supplier,
            spec: newTempItem.spec,
            unit: newTempItem.unit,
            safety: 0
        }), `임시코드 품목 등록 (${newTempItem.code})`);
    }

    return { item: newTempItem, isNewTemp: true, matched: false };
};

/**
 * 0000 임시 품목코드를 정식 코드로 일괄 전환 및 병합
 * 
 * @param {string} oldCode 기존 임시 품목코드 (예: '0000' 또는 '0000-001')
 * @param {string} newCode 변경할 정식 품목코드 (기존 마스터 코드이거나 신규 코드)
 * @param {Object} updatedInfo 품목 상세 정보 보정치 (name, category, spec, supplier, unit, safety 등)
 * @returns {Promise<{ success: boolean, isMerged: boolean, message: string }>}
 */
export const updateMasterItemCode = async (oldCode, newCode, updatedInfo = {}) => {
    if (!oldCode || !newCode) throw new Error('이전 품목코드와 변경할 품목코드를 모두 입력하세요.');
    oldCode = oldCode.trim();
    newCode = newCode.trim();
    if (oldCode === newCode) throw new Error('이전 품목코드와 변경할 코드가 동일합니다.');

    const oldMasterIdx = state.master.findIndex(m => m.code === oldCode);
    const existingTargetMaster = state.master.find(m => m.code === newCode);
    const isMerged = !!existingTargetMaster;

    let finalName = updatedInfo.name || (existingTargetMaster ? existingTargetMaster.name : (oldMasterIdx >= 0 ? state.master[oldMasterIdx].name : oldCode));
    let finalSpec = updatedInfo.spec || (existingTargetMaster ? existingTargetMaster.spec : (oldMasterIdx >= 0 ? state.master[oldMasterIdx].spec : '-'));

    // 1. 재고(Inventory) 갱신 및 병합
    const oldInvItems = state.inventory.filter(i => i.code === oldCode);
    for (const oldInv of oldInvItems) {
        const loc = oldInv.location;
        const targetInv = state.inventory.find(i => i.code === newCode && i.location === loc);
        if (targetInv) {
            // 동일 거점에 이미 해당 코드가 있으면 수량 합산!
            targetInv.quantity = (Number(targetInv.quantity) || 0) + (Number(oldInv.quantity) || 0);
            targetInv.lastUpdated = new Date().toLocaleString('ko-KR');
        } else {
            // 거점에 해당 코드가 없으면 코드를 newCode로 치환
            oldInv.code = newCode;
            oldInv.name = finalName;
            oldInv.spec = finalSpec;
            oldInv.lastUpdated = new Date().toLocaleString('ko-KR');
        }
    }
    // oldCode로 남아있는 재고 레코드 제거
    state.inventory = state.inventory.filter(i => i.code !== oldCode);

    // 2. 수불 이력(History) 일괄 치환
    for (const h of state.history) {
        if (h.code === oldCode) {
            h.code = newCode;
            h.name = finalName;
            h.reason = `${h.reason || ''} [코드전환:${oldCode}->${newCode}]`.trim();
        }
    }

    // 3. 김포 생산공급망 일지(GimpoLogs) 내 표기 일괄 치환
    for (const site of Object.keys(WORKLOG_SITES)) {
        const changedLogs = new Set();
        for (const log of logsOf(site)) {
            ['packaging', 'oilBlending', 'movement', 'receiving', 'shipping'].forEach(sec => {
                (log[sec] || []).forEach(row => {
                    if (row.item && (row.item.includes(oldCode) || (oldMasterIdx >= 0 && row.item.includes(state.master[oldMasterIdx].name)))) {
                        changedLogs.add(log);
                        if (row.item.includes(oldCode)) {
                            row.item = row.item.replace(oldCode, newCode);
                        } else {
                            row.item = `${newCode} / ${finalName} | ${finalSpec}`;
                        }
                    }
                });
            });
        }
        if (!changedLogs.size) continue;
        saveStorage(worklogSiteOf(site).stateKey, logsOf(site));
        pushGimpoLogs([...changedLogs], site);
    }

    // 4. 품목 마스터(Master) 갱신
    if (isMerged) {
        // 기존 품목으로 병합 흡수된 경우 -> oldCode 임시 마스터 삭제
        state.master = state.master.filter(m => m.code !== oldCode);
    } else {
        // 신규 정식 코드로 변경된 경우 -> 마스터의 code, name 등 갱신 및 임시 플래그 해제
        const finalCategory = updatedInfo.category || (oldMasterIdx >= 0 ? state.master[oldMasterIdx].category : '완제품');
        const finalSubCategory = updatedInfo.subCategory || (finalCategory === '완제품' ? 'ODM' : (finalCategory === '원료' ? '원료' : determineSubCategory({ name: finalName, spec: finalSpec, category: finalCategory })));

        if (oldMasterIdx >= 0) {
            state.master[oldMasterIdx] = {
                ...state.master[oldMasterIdx],
                code: newCode,
                name: finalName,
                spec: finalSpec,
                category: finalCategory,
                subCategory: finalSubCategory,
                supplier: updatedInfo.supplier || state.master[oldMasterIdx].supplier || '-',
                manufacturer: updatedInfo.manufacturer || state.master[oldMasterIdx].manufacturer || '',
                unit: updatedInfo.unit || state.master[oldMasterIdx].unit || 'EA',
                safety: Number(updatedInfo.safety) || state.master[oldMasterIdx].safety || 50,
                isTemporary: false,
                notes: `[정식코드 확정] 이전 임시코드: ${oldCode}`
            };
        } else {
            state.master.push({
                code: newCode,
                name: finalName,
                spec: finalSpec,
                category: finalCategory,
                subCategory: finalSubCategory,
                supplier: updatedInfo.supplier || '-',
                manufacturer: updatedInfo.manufacturer || '',
                unit: updatedInfo.unit || 'EA',
                safety: Number(updatedInfo.safety) || 50,
                isTemporary: false
            });
        }
    }

    // 5. 로컬스토리지 저장
    saveStorage('master', state.master);
    saveStorage('inventory', state.inventory);
    saveStorage('history', state.history);

    // 6. Supabase 동기화 (설정 시)
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        // 순서가 중요하다: wms_inventory.code는 ON DELETE CASCADE이므로 예전 마스터를 먼저 지우면
        // 이전할 재고가 함께 삭제된다. 새 마스터 준비 → 재고 이전/합산 → 이력 → 예전 마스터 삭제 순으로 처리하고,
        // 중간에 실패하면 예전 마스터를 지우지 않는다.
        const check = ({ error }) => { if (error) throw error; };
        try {
            // 1. 새 코드 마스터 준비 (재고 FK 대상)
            if (!isMerged) {
                const m = state.master.find(item => item.code === newCode);
                if (m) {
                    check(await supabase.from('wms_master_items').upsert({
                        code: m.code,
                        name: m.name,
                        category: m.category,
                        supplier: m.supplier,
                        manufacturer: m.manufacturer || null,
                        spec: m.spec,
                        unit: m.unit,
                        safety: m.safety
                    }));
                }
            }

            // 2. 재고(wms_inventory) 이전 및 수량 합산 (합산은 동시 작업에 안전한 증감 방식)
            const oldInvRes = await supabase.from('wms_inventory').select('*').eq('code', oldCode);
            check(oldInvRes);
            for (const oldInv of oldInvRes.data || []) {
                const targetRes = await supabase.from('wms_inventory').select('id').eq('code', newCode).eq('location', oldInv.location);
                check(targetRes);
                if (targetRes.data && targetRes.data.length > 0) {
                    await adjustRemoteInventory(supabase, newCode, oldInv.location, Number(oldInv.quantity) || 0);
                    check(await supabase.from('wms_inventory').delete().eq('id', oldInv.id));
                } else {
                    check(await supabase.from('wms_inventory').update({ code: newCode, last_updated: new Date().toISOString() }).eq('id', oldInv.id));
                }
            }

            // 3. 수불 이력(wms_history_logs) 동기화
            check(await supabase.from('wms_history_logs').update({ code: newCode, name: finalName }).eq('code', oldCode));

            // 4. 재고 이전이 끝난 뒤 예전 마스터 삭제
            check(await supabase.from('wms_master_items').delete().eq('code', oldCode));
        } catch (e) {
            reportSyncError(`품목코드 전환 ${oldCode}→${newCode} (재고 보호를 위해 예전 코드는 클라우드에 남겨 둠)`, e);
        }
    }

    return {
        success: true,
        isMerged,
        oldCode,
        newCode,
        message: isMerged 
            ? `임시코드 [${oldCode}] 품목이 기존 마스터 [${newCode}] (${finalName}) 품목으로 재고 및 수불부가 통합 병합되었습니다.`
            : `임시코드 [${oldCode}] 품목이 정식 품목코드 [${newCode}] (${finalName})(으)로 일괄 변경되었습니다.`
    };
};

/**
 * 품목명 안에 품목코드가 있거나 기존 마스터와 일치하는 임시(0000) 품목들을
 * 일괄 정식 코드로 전환 및 재고 병합
 * @returns {Promise<{ totalResolved: number, items: Array, errors: Array, message: string }>}
 */
export const autoResolveTempMasterItems = async () => {
    const tempItems = state.master.filter(m => m.code.startsWith('0000') || m.isTemporary);
    if (tempItems.length === 0) {
        return { totalResolved: 0, items: [], errors: [], message: '정리할 임시코드 품목이 없습니다.' };
    }

    const resolved = [];
    const errors = [];

    // 정규화 헬퍼 (공백 및 특수문자 제거 후 소문자화)
    const norm = (s) => (s || '').toLowerCase().replace(/[\s\-_/\\|()\[\]{}'"`.,:;+~*]/g, '');

    for (const item of tempItems) {
        let targetCode = null;
        let targetName = null;
        let targetSpec = null;

        // 1. 품목명 내 임시코드 추출 (예: "5AA40028 / SUMOIL 5W40")
        const embedded = parseEmbeddedCode(item.name);
        if (embedded && embedded.code) {
            targetCode = embedded.code;
            targetName = embedded.name;
            targetSpec = embedded.spec || item.spec;
        } else {
            // 2. 정규화 이름이 기존 정식 마스터 품목과 일치하는지 확인
            const normName = norm(item.name);
            if (normName.length >= 3) {
                const matched = state.master.find(m => !m.code.startsWith('0000') && norm(m.name) === normName);
                if (matched) {
                    targetCode = matched.code;
                    targetName = matched.name;
                    targetSpec = matched.spec || item.spec;
                }
            }
        }

        if (targetCode && targetCode !== item.code) {
            try {
                const res = await updateMasterItemCode(item.code, targetCode, {
                    name: targetName,
                    spec: targetSpec
                });
                resolved.push({ oldCode: item.code, newCode: targetCode, name: targetName, isMerged: res.isMerged });
            } catch (err) {
                errors.push(`[${item.code}] ${err.message}`);
            }
        }
    }

    return {
        totalResolved: resolved.length,
        items: resolved,
        errors,
        message: resolved.length > 0 
            ? `총 ${resolved.length}건의 임시코드가 정식 품목코드로 정상 전환 및 재고 병합되었습니다.`
            : '자동 변환 가능한 임시코드 품목이 없습니다.'
    };
};

/**
 * 업무일지(본사·김포)의 포장/원액생산/이동/입출고 실적을 WMS 재고 및 수불부에 일괄 반영
 * (품목코드 없는 품목은 기존 마스터 지능형 대조 합산 반영, 검색불가 품목은 0000 임시코드로 자동 등록)
 * site: 'GIMPO'(김포공장) | 'HQ'(본사 창고) — 입고·출고 거점과 이력 사유 머리말([날짜 김포 생산일지])이 달라진다.
 */
export const applyGimpoLogToInventory = async (dateStr, workerName = '최용화', site = 'GIMPO') => {
    const s = worklogSiteOf(site);
    const LOC = s.location;
    const log = getGimpoLogByDate(dateStr, site);
    if (!log) throw new Error('해당 날짜의 생산일지를 찾을 수 없습니다.');
    // 이미 반영된 일지를 다시 반영하면 입고/출고/이동이 중복 기록되어 재고가 틀어지므로 차단
    if (checkGimpoLogSyncStatus(log, site).isSynced) {
        throw new Error(`${log.date} 일지는 이미 WMS 재고와 수불부에 반영되었습니다. 중복 반영을 막기 위해 다시 반영할 수 없습니다.`);
    }
    const tag = `[${log.date} ${s.tag}]`;

    const appliedSummary = {
        packagingCount: 0,
        oilCount: 0,
        moveCount: 0,
        receivingCount: 0,
        shippingCount: 0,
        matchedMasterCount: 0,
        tempCreatedCount: 0,
        tempItems: [],
        errors: []
    };
    const note = (res) => {
        if (res.matched) appliedSummary.matchedMasterCount++;
        if (res.isNewTemp) {
            appliedSummary.tempCreatedCount++;
            appliedSummary.tempItems.push({ code: res.item.code, name: res.item.name });
        }
    };

    // 1. 제품 포장 실적 -> 완제품 거점 입고(+)
    for (const item of (log.packaging || [])) {
        if (!item.qty || item.qty <= 0) continue;
        try {
            const res = await getOrCreateMasterItem(item.item, item.spec, item.category || '완제품', 'EA');
            if (!res || !res.item) continue;
            note(res);
            await processStockAction({
                type: 'IN',
                code: res.item.code,
                qty: item.qty,
                location: LOC,
                worker: workerName,
                reason: `${tag} 포장생산 완료 (${item.line || '라인'} / LOT:${item.lotNo || '-'})`
            });
            appliedSummary.packagingCount++;
        } catch (err) {
            appliedSummary.errors.push(`[포장] ${item.item}: ${err.message}`);
        }
    }

    // 2. 원액생산 실적 -> 원액 거점 입고(+)
    for (const item of (log.oilBlending || [])) {
        if (!item.qty || item.qty <= 0) continue;
        try {
            const res = await getOrCreateMasterItem(item.item, item.spec || 'L', '원액', 'L');
            if (!res || !res.item) continue;
            note(res);
            await processStockAction({
                type: 'IN',
                code: res.item.code,
                qty: item.qty,
                location: LOC,
                worker: workerName,
                reason: `${tag} 원액 블렌딩 생산 완료 (${item.line || 'BT'} / LOT:${item.lotNo || '-'})`
            });
            appliedSummary.oilCount++;
        } catch (err) {
            appliedSummary.errors.push(`[원액] ${item.item}: ${err.message}`);
        }
    }

    // 3. 이동 제품 실적 -> 이 거점 차감(-), 상대 거점(김포↔본사, 방산) 입고(+)
    for (const item of (log.movement || [])) {
        if (!item.qty || item.qty <= 0) continue;
        try {
            const res = await getOrCreateMasterItem(item.item, item.spec, '', item.unit || 'EA');
            if (!res || !res.item) continue;
            note(res);
            await processStockAction({
                type: 'MOVE',
                code: res.item.code,
                qty: item.qty,
                fromLoc: LOC,
                toLoc: s.moveTo(item.route || ''),
                worker: item.driver || workerName,
                reason: `${tag} 거점간 제품이동 (${item.vehicle || '3.5T'} / 운반자:${item.driver || '-'})`
            });
            appliedSummary.moveCount++;
        } catch (err) {
            appliedSummary.errors.push(`[이동] ${item.item}: ${err.message}`);
        }
    }

    // 4. 원부자재 입고 실적 -> 거점 입고(+)
    for (const item of (log.receiving || [])) {
        if (!item.qty || item.qty <= 0) continue;
        try {
            const res = await getOrCreateMasterItem(item.item, item.spec, '부자재', 'EA');
            if (!res || !res.item) continue;
            note(res);
            await processStockAction({
                type: 'IN',
                code: res.item.code,
                qty: item.qty,
                location: LOC,
                worker: item.inspector || workerName,
                reason: `${tag} 원부자재 입고 (${item.partner || '협력사'})`
            });
            appliedSummary.receivingCount++;
        } catch (err) {
            appliedSummary.errors.push(`[입고] ${item.item}: ${err.message}`);
        }
    }

    // 5. 고객사 출고 실적 -> 거점 출고(-)
    for (const item of (log.shipping || [])) {
        if (!item.qty || item.qty <= 0) continue;
        try {
            const res = await getOrCreateMasterItem(item.item, item.spec, '완제품', 'EA');
            if (!res || !res.item) continue;
            note(res);
            const out = () => processStockAction({
                type: 'OUT',
                code: res.item.code,
                qty: item.qty,
                location: LOC,
                worker: item.inspector || workerName,
                reason: `${tag} 고객사 출고 (${item.partner || '거래처'})`
            });
            try {
                await out();
                appliedSummary.shippingCount++;
            } catch (outErr) {
                // 출고 시 재고가 부족하면 부족분만큼 가상 입고(이력·클라우드에 함께 기록) 후 출고 처리
                // (로컬 수량만 몰래 올리면 클라우드 재고·이력과 어긋난다)
                const inv = state.inventory.find(i => i.code === res.item.code && i.location === LOC);
                const shortfall = (Number(item.qty) || 0) - (inv ? Number(inv.quantity) || 0 : 0);
                if (shortfall > 0) {
                    await processStockAction({
                        type: 'IN',
                        code: res.item.code,
                        qty: shortfall,
                        location: LOC,
                        worker: item.inspector || workerName,
                        reason: `${tag} 출고 재고 부족분 가상 입고 (${item.partner || '거래처'})`
                    });
                }
                await out();
                appliedSummary.shippingCount++;
            }
        } catch (err) {
            appliedSummary.errors.push(`[출고] ${item.item}: ${err.message}`);
        }
    }

    // 6. 일지 객체에 수불부 반영 상태 및 일시 기록 저장
    log.isSyncedToLedger = true;
    log.syncedAt = new Date().toISOString();
    saveGimpoLog(log, site);

    return appliedSummary;
};

/**
 * 특정 업무일지의 수불부(WMS 재고 및 이력) 반영 여부 확인
 */
export const checkGimpoLogSyncStatus = (logOrDateStr, site = 'GIMPO') => {
    const log = typeof logOrDateStr === 'string' ? getGimpoLogByDate(logOrDateStr, site) : logOrDateStr;
    if (!log) return { isSynced: false, reasonCount: 0 };

    if (log.isSyncedToLedger) {
        return { isSynced: true, syncedAt: log.syncedAt || null };
    }

    // state.history 내에 해당 일자 일지 관련 트랜잭션이 이미 존재하는지 확인
    const datePrefix = log.date || '';
    const matchCount = state.history.filter(h => h.reason && h.reason.includes(`[${datePrefix} ${worklogSiteOf(site).tag}]`)).length;

    // 포장, 원액, 이동, 입고, 출고 항목 중 수량이 있는 항목 수 계산
    const actionableCount =
        (log.packaging || []).filter(i => (Number(i.qty) || 0) > 0).length +
        (log.oilBlending || []).filter(i => (Number(i.qty) || 0) > 0).length +
        (log.movement || []).filter(i => (Number(i.qty) || 0) > 0).length +
        (log.receiving || []).filter(i => (Number(i.qty) || 0) > 0).length +
        (log.shipping || []).filter(i => (Number(i.qty) || 0) > 0).length;

    const isSynced = actionableCount > 0 ? (matchCount >= Math.min(actionableCount, 3)) : (matchCount > 0);
    if (isSynced && !log.isSyncedToLedger) {
        log.isSyncedToLedger = true;
        saveGimpoLog(log, site);
    }

    return {
        isSynced: !!isSynced,
        matchCount,
        actionableCount,
        syncedAt: log.syncedAt || null
    };
};

/**
 * 전체 업무일지 중 수불부 동기화 통계 조회
 */
export const getGimpoSyncStatistics = (site = 'GIMPO') => {
    const logs = logsOf(site);
    let syncedDays = 0;
    let unsyncedDays = 0;
    const unsyncedLogs = [];

    logs.forEach(log => {
        const status = checkGimpoLogSyncStatus(log, site);
        if (status.isSynced) {
            syncedDays++;
        } else {
            unsyncedDays++;
            unsyncedLogs.push(log);
        }
    });

    return {
        totalDays: logs.length,
        syncedDays,
        unsyncedDays,
        unsyncedLogs: unsyncedLogs.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    };
};

/**
 * 미반영된 모든 업무일지를 수불부 및 WMS 재고로 일괄 동기화
 */
export const syncAllUnsyncedGimpoLogs = async (workerName = '최용화', site = 'GIMPO') => {
    const stats = getGimpoSyncStatistics(site);
    const unsynced = stats.unsyncedLogs;

    if (unsynced.length === 0) {
        return {
            syncedDaysCount: 0,
            totalItemsApplied: 0,
            message: '이미 모든 업무일지가 수불부에 반영되어 있습니다.'
        };
    }

    let syncedDaysCount = 0;
    let totalItemsApplied = 0;
    const errors = [];

    for (const log of unsynced) {
        try {
            const res = await applyGimpoLogToInventory(log.date, workerName, site);
            syncedDaysCount++;
            const dayItems = (res.packagingCount || 0) + (res.oilCount || 0) + (res.moveCount || 0) + (res.receivingCount || 0) + (res.shippingCount || 0);
            totalItemsApplied += dayItems;
        } catch (err) {
            errors.push(`[${log.date}] ${err.message}`);
        }
    }

    return {
        syncedDaysCount,
        totalItemsApplied,
        errors,
        message: `총 ${syncedDaysCount}일치 업무일지(${totalItemsApplied}건 실적)가 수불부 및 WMS 재고에 성공적으로 일괄 반영되었습니다.`
    };
};

// ==========================================
// 원료수불부(Raw Material Ledger) CRUD 관리
// ==========================================

// ------------------------------------------
// 원료수불부 클라우드 동기화 (wms_raw_ledger, supabase/auth/06_create_raw_ledger.sql)
// ------------------------------------------
// 전표 7천여 건을 매번 통째로 올리지 않도록, 마지막으로 클라우드와 맞춘 전표 내용(rawLedgerSynced)과
// 비교해 바뀐 전표만 upsert하고 사라진 전표만 delete한다. 실패한 전표는 다음 저장 때 다시 올라간다.
// 전표 순서가 재고 누적 순서이므로 클라우드는 seq(입력 순번)로 정렬하며, 새 전표는 입력 순서대로 insert된다.
const LEDGER_BATCH = 500;
const canWriteLedger = () => ['MASTER', 'ADMIN', 'MANAGER', 'OPERATOR'].includes(state.currentUser?.role);

// 수불부 클라우드 동기화 공용 로직 (원료수불부 wms_raw_ledger, 제품·자재수불부 wms_item_ledger)
// - stateKey: state의 전표 배열 키 (localStorage 키도 같음)
// - kind: 한 테이블을 여러 수불부가 나눠 쓸 때의 구분값 (wms_item_ledger.kind)
// - isSeedId: 이 기기에서만 만든 초기 데이터(번들 기본 전표, 최초 이관 전표) 여부.
//   클라우드에 전표가 이미 있으면 이런 전표는 올리지 않고 클라우드 전표로 교체한다.
// - onEmptyCloud: 클라우드가 비어 있을 때 올리기 전에 로컬 전표를 준비하는 함수 (최초 이관 등)
// - normalize: 저장·로드 때마다 전표 배열에 적용하는 재계산 함수 (원료수불부의 일자순 재고 누적)
const createLedgerSync = ({ stateKey, table, kind = null, label, toRow, fromRow, isSeedId = () => false, onEmptyCloud = null, normalize = null }) => {
    const syncedIdsKey = `${stateKey}SyncedIds`; // 앱에서 만든 전표 중 클라우드에 올라간 id
    let synced = null; // Map(id -> 마지막으로 클라우드와 맞춘 전표 JSON). null이면 클라우드 미연결
    const rowOf = (e) => (kind ? { ...toRow(e), kind } : toRow(e));
    const rowKey = (e) => JSON.stringify(rowOf(e));
    const scoped = (q) => (kind ? q.eq('kind', kind) : q);

    const persistSyncedIds = () => {
        if (synced) saveStorage(syncedIdsKey, [...synced.keys()].filter(id => !isSeedId(id)));
    };

    const upsertRows = async (supabase, entries, context) => {
        for (let i = 0; i < entries.length; i += LEDGER_BATCH) {
            const batch = entries.slice(i, i + LEDGER_BATCH);
            const ok = await checkWrite(supabase.from(table).upsert(batch.map(rowOf), { onConflict: 'id' }), context);
            if (!ok) return false;
            batch.forEach(e => synced.set(e.id, rowKey(e)));
        }
        return true;
    };

    // 클라우드 전표 로드 (loadAllData에서 호출)
    // - 클라우드에 전표가 있으면 클라우드 기준으로 교체하고, 이 기기에서 만들었지만 아직 못 올린 전표는 뒤에 붙여 올린다.
    // - 클라우드가 비어 있으면(최초 1회) 이 기기의 전표 전체를 입력 순서대로 올린다.
    const load = async (supabase) => {
        const { count, error: countErr } = await scoped(supabase.from(table).select('id', { count: 'exact', head: true }));
        if (countErr) throw countErr; // 테이블 없음·권한 없음 등: 로컬 전표 유지

        if (!count) {
            synced = new Map();
            if (onEmptyCloud) onEmptyCloud();
            if (canWriteLedger() && state[stateKey].length > 0) {
                console.log(`[DB] 클라우드 ${label}가 비어 있어 이 기기의 전표 ${state[stateKey].length}건을 올립니다.`);
                await upsertRows(supabase, state[stateKey], `${label} 최초 업로드`);
                persistSyncedIds();
            }
            return;
        }

        const rows = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await scoped(supabase.from(table).select('*')).order('seq').range(from, from + 999);
            if (error) throw error; // 일부만 받은 채 교체하지 않는다
            if (!data || data.length === 0) break;
            rows.push(...data);
            if (data.length < 1000) break;
        }

        const remote = rows.map(fromRow);
        const remoteIds = new Set(remote.map(e => e.id));
        const syncedBefore = new Set(loadStorage(syncedIdsKey, []));
        const pending = state[stateKey].filter(e => !remoteIds.has(e.id) && !isSeedId(e.id) && !syncedBefore.has(e.id));

        synced = new Map(remote.map(e => [e.id, rowKey(e)]));
        state[stateKey] = [...remote, ...pending];
        saveStorage(stateKey, state[stateKey]);
        if (pending.length > 0 && canWriteLedger()) {
            console.log(`[DB] 이 기기에서만 저장된 ${label} 전표 ${pending.length}건을 클라우드에 올립니다.`);
            await upsertRows(supabase, pending, `${label} 미전송 전표`);
        }
        persistSyncedIds();

        // 재고 재계산 규칙이 있으면 받은 전표에도 적용하고, 값이 달라진 전표만 클라우드에 올린다
        // (예전 버전 앱이 입력 순서로 계산해 저장한 재고를 일자순 재고로 바로잡는다)
        if (normalize) {
            const normalized = normalize(state[stateKey]);
            if (canWriteLedger()) await save(normalized);
            else { state[stateKey] = normalized; saveStorage(stateKey, normalized); }
        }
    };

    // 전체 저장 (LocalStorage 저장 후 바뀐 전표만 Supabase에 반영)
    const save = async (input) => {
        const ledger = normalize ? normalize(input) : input;
        state[stateKey] = ledger;
        saveStorage(stateKey, ledger);
        const supabase = getSupabase();
        if (!supabase || !isSupabaseConfigured() || !synced) return;

        const changed = ledger.filter(e => synced.get(e.id) !== rowKey(e));
        const ids = new Set(ledger.map(e => e.id));
        const removed = [...synced.keys()].filter(id => !ids.has(id));

        if (changed.length > 0) await upsertRows(supabase, changed, `${label} 저장`);
        for (let i = 0; i < removed.length; i += LEDGER_BATCH) {
            const batch = removed.slice(i, i + LEDGER_BATCH);
            if (await checkWrite(supabase.from(table).delete().in('id', batch), `${label} 삭제`)) {
                batch.forEach(id => synced.delete(id));
            }
        }
        persistSyncedIds();
    };

    // 클라우드에 아직 반영되지 않은 전표가 있는지 (클라우드와 맞추지 못한 세션이면 전표가 있는 한 true)
    const hasUnsyncedChanges = () => {
        const ledger = state[stateKey] || [];
        if (!synced) return ledger.length > 0;
        const ids = new Set(ledger.map(e => e.id));
        return ledger.some(e => synced.get(e.id) !== rowKey(e)) || [...synced.keys()].some(id => !ids.has(id));
    };

    return { load, save, hasUnsyncedChanges, disconnect: () => { synced = null; } };
};

// 예전 번들(rawLedgerFull.json)에 있던 원료수불부 전표 id의 해시 (scripts/gen_raw_seed_hashes.cjs로 생성).
// 번들에서 데이터를 뺀 뒤에도, 그 번들로 채워졌던 브라우저의 전표를 "이 기기에서만 만든 전표"로 오인해
// 클라우드에서 지운 전표를 다시 올리지 않도록 쓴다. id에 원료명이 들어 있어 원문 대신 해시를 둔다.
const RAW_SEED_ID_HASHES = new Set(rawSeedIdHashes);
const fnv1a = (s) => {
    let h = 0x811c9dc5;
    for (const ch of new TextEncoder().encode(String(s))) {
        h ^= ch;
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
};
const isBundledRawId = (id) => RAW_SEED_ID_HASHES.has(fnv1a(id));

const rawEntryToRow = (e) => ({
    id: e.id,
    entry_date: e.date || localDateStr(),
    location: e.location || '김포',
    code: e.code || e.itemCode || null,
    raw_code: e.rawCode || null,
    manufacturer: e.manufacturer || null,
    name: e.name || e.itemName || '',
    type: e.type || '입고',
    notes: e.notes || '',
    in_qty: Number(e.inQty) || 0,
    out_qty: Number(e.outQty) || 0,
    stock_qty: Number(e.stockQty) || 0,
    weight: Number(e.weight) || 0,
    sg: Number(e.sg) || 1,
    dm: Number(e.dm) || 0,
    unit_price: Number(e.unitPrice) || 0,
    remark: e.remark || '',
    worker: e.worker || '',
    pair_id: e.pairId || null,
    created_at: e.createdAt || new Date().toISOString(),
    updated_at: e.updatedAt || null
});

const rawRowToEntry = (r) => ({
    id: r.id,
    date: r.entry_date,
    type: r.type,
    location: r.location || '김포',
    code: r.code || '',
    itemCode: r.code || '',
    ...(r.raw_code ? { rawCode: r.raw_code } : {}),
    manufacturer: r.manufacturer || '',
    name: r.name,
    itemName: r.name,
    notes: r.notes || '',
    inQty: Number(r.in_qty) || 0,
    outQty: Number(r.out_qty) || 0,
    stockQty: Number(r.stock_qty) || 0,
    weight: Number(r.weight) || 0,
    sg: Number(r.sg) || 1,
    dm: Number(r.dm) || 0,
    unitPrice: Number(r.unit_price) || 0,
    remark: r.remark || '',
    worker: r.worker || '',
    ...(r.pair_id ? { pairId: r.pair_id } : {}),
    createdAt: r.created_at,
    ...(r.updated_at ? { updatedAt: r.updated_at } : {})
});

// ------------------------------------------
// 원료수불부 재고 계산 (일자순)
// ------------------------------------------
// 전표의 재고량은 입력 순서가 아니라 수불일자 순서로 누적한다 (같은 날짜는 입력 순서).
// 날짜를 거슬러 나중에 입력한 전표도 그 날짜 자리에서 계산된다.
// - 지역별 재고: 원료명 + 지역(김포/본사/방산/김포2)별 누적. 전표의 stockQty·weight에 저장한다.
// - 통합 재고: 원료명별로 모든 지역을 합쳐 누적. 저장하지 않고 화면에서 rawLedgerTotalBalances로 계산한다.
const rawRegionOf = (e) => e.location || '김포';
const rawDateOrder = (ledger) => ledger.map((_, i) => i)
    .sort((a, b) => (ledger[a].date || '').localeCompare(ledger[b].date || '') || a - b);

// 지역별 재고(stockQty)를 일자순으로 처음부터 다시 누적한다. 값이 바뀐 전표만 새 객체로 바꾼다.
// 중량(weight)은 재고가 바뀌었거나 비어 있을 때만 재고 × 비중으로 다시 계산한다
// (예전 엑셀에서 옮긴 전표의 중량은 당시 비중으로 적은 값이라 그대로 둔다).
export const recalcRawLedgerByDate = (ledger) => {
    const out = ledger.slice();
    const stockByKey = new Map();
    for (const i of rawDateOrder(ledger)) {
        const e = ledger[i];
        const key = `${e.name}___${rawRegionOf(e)}`;
        const stock = roundQty((stockByKey.get(key) || 0) + (Number(e.inQty) || 0) - (Number(e.outQty) || 0));
        stockByKey.set(key, stock);
        const stockChanged = Number(e.stockQty) !== stock;
        if (!stockChanged && Number(e.weight)) continue;
        const weight = parseFloat((stock * (Number(e.sg) || 1)).toFixed(2));
        if (e.stockQty !== stock || e.weight !== weight) out[i] = { ...e, stockQty: stock, weight };
    }
    return out;
};

// 통합 재고: 전표 id → 그 전표까지 원료명별(모든 지역 합산) 일자순 누적 재고
export const rawLedgerTotalBalances = (ledger = state.rawLedger) => {
    const result = new Map();
    const stockByName = new Map();
    for (const i of rawDateOrder(ledger)) {
        const e = ledger[i];
        const stock = roundQty((stockByName.get(e.name) || 0) + (Number(e.inQty) || 0) - (Number(e.outQty) || 0));
        stockByName.set(e.name, stock);
        result.set(e.id, { stockQty: stock, weight: parseFloat((stock * (Number(e.sg) || 1)).toFixed(2)) });
    }
    return result;
};

// 원료 현재고 요약 (각 원료의 가장 늦은 일자 전표 기준)
// - mode 'region': 원료명 + 지역별 한 줄 (region을 주면 그 지역만)
// - mode 'total' : 원료명별 한 줄 (모든 지역 합산, regions에 지역별 재고)
export const rawLedgerStockSummary = (mode = 'region', region = 'ALL', ledger = state.rawLedger) => {
    const lastByRegion = new Map(); // name___region → 일자순 마지막 전표
    for (const i of rawDateOrder(ledger)) {
        const e = ledger[i];
        const name = (e.name || '').trim();
        if (!name) continue;
        lastByRegion.set(`${name}___${rawRegionOf(e)}`, e);
    }
    const rows = [...lastByRegion.values()].map(e => ({
        name: e.name, location: rawRegionOf(e), last: e,
        stockQty: Number(e.stockQty) || 0,
        weight: Number(e.weight) || ((Number(e.stockQty) || 0) * (Number(e.sg) || 1))
    }));
    if (mode !== 'total') return region === 'ALL' ? rows : rows.filter(r => r.location === region);

    const byName = new Map();
    for (const r of rows) {
        const cur = byName.get(r.name) || { name: r.name, location: '통합', last: r.last, stockQty: 0, weight: 0, regions: {} };
        cur.stockQty = roundQty(cur.stockQty + r.stockQty);
        cur.weight = parseFloat((cur.weight + r.weight).toFixed(2));
        cur.regions[r.location] = r.stockQty;
        const a = cur.last, b = r.last;
        if ((b.date || '') > (a.date || '') || ((b.date || '') === (a.date || '') && ledger.indexOf(b) > ledger.indexOf(a))) cur.last = b;
        byName.set(r.name, cur);
    }
    return [...byName.values()];
};

const rawLedgerSync = createLedgerSync({
    stateKey: 'rawLedger',
    table: 'wms_raw_ledger',
    label: '원료수불부',
    toRow: rawEntryToRow,
    fromRow: rawRowToEntry,
    isSeedId: isBundledRawId,
    normalize: recalcRawLedgerByDate
});

// 원료수불부 전체 저장 (LocalStorage 저장 후 바뀐 전표만 Supabase에 반영)
export const saveRawLedger = (ledger) => rawLedgerSync.save(ledger);

// ------------------------------------------
// 원료코드 (보안 코드)
// ------------------------------------------
// 원료코드는 품목코드(자재관리 코드)와 다른 보안용 코드다. 작업지시서를 출력할 때 원료 품명·품목코드 대신
// 인쇄해 배합 정보가 외부로 새지 않게 한다. 원료수불부 전표마다 저장하며(raw_code), 원료 하나에 코드 하나를 쓴다.
// 조회 순서: 같은 품목코드의 최근 전표 → 같은 원료명의 최근 전표
export const rawSecurityCodeOf = (code, name, ledger = state.rawLedger) => {
    let byName = '';
    for (let i = ledger.length - 1; i >= 0; i--) {
        const r = ledger[i];
        if (!r.rawCode) continue;
        if (code && r.code === code) return r.rawCode;
        if (!byName && name && r.name === name) byName = r.rawCode;
    }
    return byName;
};

// 원료 하나(같은 품목코드, 코드가 없으면 같은 원료명)의 모든 전표에 원료코드를 지정한다. 빈 값이면 해제.
export const setRawSecurityCode = async ({ code, name }, rawCode) => {
    const value = String(rawCode || '').trim();
    if (value) {
        const owner = state.rawLedger.find(r => r.rawCode === value && !(code ? r.code === code : r.name === name));
        if (owner) throw new Error(`원료코드 '${value}'는 이미 '${owner.name}'(${owner.code || '코드 없음'})에 쓰이고 있습니다.`);
    }
    let changed = 0;
    const next = state.rawLedger.map(r => {
        const same = code ? r.code === code : r.name === name;
        if (!same || (r.rawCode || '') === value) return r;
        changed++;
        const { rawCode: _omit, ...rest } = r;
        return value ? { ...rest, rawCode: value } : rest;
    });
    if (changed > 0) await saveRawLedger(next);
    return changed;
};

// 원료수불부 전표 객체 생성.
const buildRawLedgerEntry = (entry, ledger) => {
    const id = entry.id || `RAW-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const code = (entry.code || entry.itemCode || '').trim();
    const name = (entry.name || entry.itemName || '').trim();
    const rawCode = String(entry.rawCode || '').trim() || rawSecurityCodeOf(code, name, ledger);
    const newEntry = {
        id,
        date: entry.date || localDateStr(),
        code,
        ...(rawCode ? { rawCode } : {}),
        name,
        location: (entry.location || '김포').trim(), // 지역구분 (김포 / 본사)
        type: entry.type || '입고',
        manufacturer: (entry.manufacturer || '').trim(),
        notes: (entry.notes || '').trim(),
        inQty: parseFloat(entry.inQty) || 0,
        outQty: parseFloat(entry.outQty) || 0,
        stockQty: parseFloat(entry.stockQty) || 0,
        weight: parseFloat(entry.weight) || 0,
        sg: parseFloat(entry.sg) || 1.0,
        dm: parseFloat(entry.dm) || 0,
        unitPrice: parseFloat(entry.unitPrice) || 0,
        remark: (entry.remark || '').trim(),
        worker: entry.worker || state.currentGlobalWorker || '관리자',
        ...(entry.pairId ? { pairId: entry.pairId } : {}),
        createdAt: new Date().toISOString()
    };

    // 재고량·중량은 저장할 때 saveRawLedger가 일자순으로 다시 누적해 채운다 (recalcRawLedgerByDate)
    return newEntry;
};

// 저장 후(일자순 재계산 반영) 전표를 id로 다시 찾는다
const savedRawEntries = (entries) => {
    const byId = new Map(state.rawLedger.map(e => [e.id, e]));
    return entries.map(e => byId.get(e.id) || e);
};

// 원료수불부 신규 수불 전표 등록 (재고는 일자순 누적)
export const addRawLedgerEntry = async (entry) => {
    const newEntry = buildRawLedgerEntry(entry, state.rawLedger);
    await saveRawLedger([...state.rawLedger, newEntry]);
    return savedRawEntries([newEntry])[0];
};

// 여러 전표를 한 번에 등록
export const addRawLedgerEntries = async (entries) => {
    const updated = [...state.rawLedger];
    const added = [];
    for (const entry of entries) {
        const newEntry = buildRawLedgerEntry(entry, updated);
        updated.push(newEntry);
        added.push(newEntry);
    }
    if (added.length > 0) await saveRawLedger(updated);
    return savedRawEntries(added);
};

// ==========================================
// 생산 입고 → 원료수불부 자동 기입
// ==========================================
// 원료수불부 대상 품목: 원료·원액 분류이거나 이미 원료수불부에 있는 품목코드
const isRawLedgerItem = (code) => {
    const m = state.master.find(x => x.code === code);
    if (m && (m.category === '원료' || m.category === '원액')) return true;
    return state.rawLedger.some(r => r.code === code);
};

// 해당 원료의 최신 비중(SG): 원료수불부 최근 전표(코드→이름) → 품목 마스터 → 1.0
export const latestRawSg = (code, name) => {
    for (let i = state.rawLedger.length - 1; i >= 0; i--) {
        const r = state.rawLedger[i];
        if (r.code === code && Number(r.sg) > 0) return Number(r.sg);
    }
    if (name) {
        for (let i = state.rawLedger.length - 1; i >= 0; i--) {
            const r = state.rawLedger[i];
            if (r.name === name && Number(r.sg) > 0) return Number(r.sg);
        }
    }
    const m = state.master.find(x => x.code === code);
    return Number(m?.sg) > 0 ? Number(m.sg) : 1;
};

// 해당 원료의 최신 단가(원/L): 같은 품목코드의 최근 전표 → 같은 원료명의 최근 전표 → 0
// 원료수불부의 재고량이 L 기준이므로 단가도 원/L로 다룬다.
export const latestRawUnitPrice = (code, name) => {
    let byName = 0;
    for (let i = state.rawLedger.length - 1; i >= 0; i--) {
        const r = state.rawLedger[i];
        if (!(Number(r.unitPrice) > 0)) continue;
        if (code && r.code === code) return Number(r.unitPrice);
        if (!byName && name && r.name === name) byName = Number(r.unitPrice);
    }
    return byName;
};

// 원료수불부에서 쓰는 원료명 (같은 코드의 기존 전표 이름 우선. 재고가 원료명 기준으로 누적되기 때문)
const rawLedgerNameOf = (code, region, fallback) => {
    let anyName = '';
    for (let i = state.rawLedger.length - 1; i >= 0; i--) {
        const r = state.rawLedger[i];
        if (r.code !== code) continue;
        if ((r.location || '김포') === region) return r.name;
        if (!anyName) anyName = r.name;
    }
    return anyName || fallback;
};

// 재고 단위 수량 → 원료수불부 L 수량 (L 그대로, KG ÷ 비중, G ÷ 1000 ÷ 비중, 그 밖의 단위는 환산하지 않음)
export const toRawLedgerLiters = (qty, unit, sg) => {
    const u = String(unit || '').trim().toUpperCase();
    const n = Number(qty) || 0;
    const s = Number(sg) > 0 ? Number(sg) : 1;
    if (u === 'L' || u === 'ℓ' || u === '리터' || u === '') return { qty: n, note: '' };
    if (u === 'KG') return { qty: parseFloat((n / s).toFixed(3)), note: `${n}KG ÷ 비중 ${s}` };
    if (u === 'G') return { qty: parseFloat((n / 1000 / s).toFixed(3)), note: `${n}G ÷ 1000 ÷ 비중 ${s}` };
    if (u === 'ML') return { qty: parseFloat((n / 1000).toFixed(3)), note: `${n}mL ÷ 1000` };
    return { qty: n, note: `재고단위 ${unit}: L 환산 불가, 수량 그대로 기록` };
};

const buildProductionRawLedgerEntries = ({ materials, prodItemCode, itemName, prodQty, prodUnit, prodType, location, lotNo, date, worker, workOrderNo }) => {
    const entries = [];
    const woText = workOrderNo ? ` / 지시서 ${workOrderNo}` : '';

    // 1. 투입 원료·원액 → '사용'
    for (const mat of materials) {
        const qty = Number(mat.qty);
        if (!(qty > 0) || mat.matType === '부자재' || !isRawLedgerItem(mat.code)) continue;
        const m = state.master.find(x => x.code === mat.code);
        const region = rawLedgerRegionOf(mat.location || location);
        const sg = latestRawSg(mat.code);
        // 투입 수량은 입력한 단위(생산 화면 원료 행은 L, KG/G 원료는 KG/G) 기준
        const conv = toRawLedgerLiters(qty, mat.unit || m?.unit, sg);
        entries.push({
            date,
            code: mat.code,
            name: rawLedgerNameOf(mat.code, region, mat.name || m?.name || mat.code),
            location: region,
            type: '사용',
            notes: `${itemName} 생산 투입`,
            inQty: 0,
            outQty: conv.qty,
            sg,
            remark: `[생산 자동] LOT ${lotNo}${woText}${conv.note ? ` / ${conv.note}` : ''}`,
            worker
        });
    }

    // 2. 생산한 원액(또는 원료수불부 관리 품목) → '입고'
    if (prodType === '원액' || isRawLedgerItem(prodItemCode)) {
        const m = state.master.find(x => x.code === prodItemCode);
        const region = rawLedgerRegionOf(location);
        const sg = latestRawSg(prodItemCode);
        const conv = toRawLedgerLiters(prodQty, prodUnit || m?.unit, sg);
        entries.push({
            date,
            code: prodItemCode,
            name: rawLedgerNameOf(prodItemCode, region, itemName),
            location: region,
            type: '입고',
            notes: `${prodType} 생산 입고`,
            inQty: conv.qty,
            outQty: 0,
            sg,
            remark: `[생산 자동] LOT ${lotNo}${woText}${conv.note ? ` / ${conv.note}` : ''}`,
            worker
        });
    }
    return entries;
};

// ------------------------------------------
// 원료수불부 거점이동 (짝 전표)
// ------------------------------------------
// 거점이동은 같은 날짜에 두 전표로 기록한다: 보낸 지역 '이동출고'(불) + 받은 지역 '이동입고'(수).
// 두 전표는 같은 pairId를 가지며, 한쪽을 수정·삭제하면 다른 쪽도 함께 바뀐다 (supabase/auth/13_raw_ledger_transfer_pair.sql).
// 예전 방식의 한 줄짜리 '이동' 전표는 pairId가 없다. 수정 창에서 받는 곳을 지정하면 짝(이동입고)이 생긴다.
export const RAW_TRANSFER_OUT = '이동출고';
export const RAW_TRANSFER_IN = '이동입고';
export const isRawTransferType = (type) => String(type || '').includes('이동');
const newPairId = () => `MV-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
// 짝 전표 사이에서 함께 맞추는 값 (수량은 보낸 쪽 불 = 받은 쪽 수)
const TRANSFER_SHARED_FIELDS = ['date', 'name', 'code', 'rawCode', 'sg', 'dm', 'unitPrice', 'manufacturer'];

export const rawTransferPartnerOf = (entry, ledger = state.rawLedger) =>
    (entry?.pairId ? ledger.find(e => e.pairId === entry.pairId && e.id !== entry.id) : null) || null;

// 받는 곳이 지정되지 않은 예전 이동 전표 (불만 있고 짝이 없음)
export const isUnpairedRawTransfer = (e) => !e.pairId && isRawTransferType(e.type) && (Number(e.outQty) || 0) > 0 && !(Number(e.inQty) > 0);

const transferNotes = (to, from, extra) => ({
    out: `${to}(으)로 이동${extra ? ` / ${extra}` : ''}`,
    in: `${from}에서 이동${extra ? ` / ${extra}` : ''}`
});

// 새 거점이동 등록 (보낸 곳 이동출고 + 받는 곳 이동입고)
export const addRawLedgerTransfer = async ({ from, to, qty, notes = '', ...fields }) => {
    const q = Number(qty) || 0;
    if (!(q > 0)) throw new Error('이동 수량을 입력하세요.');
    if (!from || !to || from === to) throw new Error('보내는 지역과 받는 지역이 서로 달라야 합니다.');
    const pairId = newPairId();
    const n = transferNotes(to, from, String(notes || '').trim());
    return addRawLedgerEntries([
        { ...fields, pairId, location: from, type: RAW_TRANSFER_OUT, inQty: 0, outQty: q, notes: n.out },
        { ...fields, pairId, location: to, type: RAW_TRANSFER_IN, inQty: q, outQty: 0, notes: n.in }
    ]);
};

// 원료수불부 전표 수정
// - 짝이 있는 이동 전표는 일자·품명·코드·비중 등과 수량을 짝 전표에도 맞춘다.
// - transferTo: 보낸 쪽(또는 예전 한 줄 이동) 전표의 받는 지역. 지정하면 짝을 만들거나 옮기고, ''이면 짝을 지운다.
export const updateRawLedgerEntry = async (id, updatedFields) => {
    const index = state.rawLedger.findIndex(r => r.id === id);
    if (index === -1) throw new Error('해당 원료수불 내역을 찾을 수 없습니다.');

    const { transferTo, ...fields } = updatedFields;
    const now = new Date().toISOString();
    const before = state.rawLedger[index];
    let ledger = state.rawLedger.slice();
    const current = { ...before, ...fields, updatedAt: now };
    // 비중을 바꾸면 중량을 비워 저장 시 재고 × 새 비중으로 다시 계산되게 한다
    if (fields.sg !== undefined && Number(fields.sg) !== Number(before.sg)) current.weight = 0;
    ledger[index] = current;

    let partner = rawTransferPartnerOf(before, ledger);
    const isInSide = partner && (Number(before.inQty) || 0) > 0 && before.type === RAW_TRANSFER_IN;

    // 받는 곳 지정·변경·해제 (보낸 쪽 전표에서만)
    if (transferTo !== undefined && !isInSide) {
        const to = String(transferTo || '').trim();
        if (to && to === current.location) throw new Error('받는 지역이 보내는 지역과 같습니다.');
        if (!to && partner) {
            ledger = ledger.filter(e => e.id !== partner.id);
            const { pairId: _omit, ...rest } = current;
            ledger[ledger.findIndex(e => e.id === id)] = { ...rest, type: '이동' };
            partner = null;
        } else if (to && !partner) {
            if (!((Number(current.outQty) || 0) > 0)) throw new Error('보낸 수량(불)이 있는 전표만 받는 곳을 지정할 수 있습니다.');
            const pairId = newPairId();
            const n = transferNotes(to, current.location, '');
            current.pairId = pairId;
            current.type = RAW_TRANSFER_OUT;
            if (!current.notes || current.notes === before.notes) current.notes = [before.notes, n.out].filter(Boolean).join(' / ');
            const inEntry = buildRawLedgerEntry({
                ...current, id: undefined, pairId, location: to, type: RAW_TRANSFER_IN,
                inQty: current.outQty, outQty: 0, notes: n.in, stockQty: undefined, weight: undefined
            }, ledger);
            const at = ledger.findIndex(e => e.id === id);
            ledger.splice(at + 1, 0, inEntry);
            partner = null; // 방금 맞춰서 만들었으므로 아래 동기화 불필요
        } else if (to && partner && partner.location !== to) {
            const pi = ledger.findIndex(e => e.id === partner.id);
            ledger[pi] = { ...partner, location: to, notes: transferNotes(to, current.location, '').in, updatedAt: now };
            partner = ledger[pi];
        }
    }

    // 짝 전표 맞추기
    if (partner) {
        const pi = ledger.findIndex(e => e.id === partner.id);
        const synced = { ...ledger[pi], updatedAt: now };
        for (const f of TRANSFER_SHARED_FIELDS) if (current[f] !== undefined) synced[f] = current[f];
        if (isInSide) { synced.outQty = current.inQty; synced.inQty = 0; }
        else { synced.inQty = current.outQty; synced.outQty = 0; }
        if (Number(synced.sg) !== Number(ledger[pi].sg)) synced.weight = 0;
        ledger[pi] = synced;
    }

    await saveRawLedger(ledger);
    return state.rawLedger.find(r => r.id === id);
};

// 원료수불부 전표 삭제 (거점이동 짝 전표는 함께 삭제)
export const deleteRawLedgerEntry = async (id) => {
    const target = state.rawLedger.find(r => r.id === id);
    const partner = rawTransferPartnerOf(target);
    const updated = state.rawLedger.filter(r => r.id !== id && (!partner || r.id !== partner.id));
    await saveRawLedger(updated);
    return true;
};

// ==========================================
// 제품(완제품)·자재 수불부 (원료수불부와 같은 전표 누적 방식)
// ==========================================
// 품목 분류로 수불부를 나눈다: 원료·원액 → 원료수불부, 완제품 → 제품수불부, 그 밖(부자재·소모품·기타) → 자재수불부
// 전표 위치는 거점 단위(본사 창고/김포공장/방산공장/김포2공장)이며, 재고량은 품목코드 + 거점별로 누적한다.
// 같은 거점 안의 건물 간 이동은 거점 재고가 바뀌지 않으므로 기입하지 않는다.
export const LEDGER_KINDS = {
    raw: { key: 'raw', stateKey: 'rawLedger', label: '원료수불부', short: '원료' },
    product: { key: 'product', stateKey: 'productLedger', label: '제품수불부', short: '제품' },
    material: { key: 'material', stateKey: 'materialLedger', label: '자재수불부', short: '자재' }
};

export const ledgerKindOfCategory = (category) => {
    if (category === '원료' || category === '원액') return 'raw';
    if (category === '완제품') return 'product';
    return 'material';
};

export const ledgerKindOfCode = (code) => {
    const m = state.master.find(x => x.code === code);
    if (m) return ledgerKindOfCategory(m.category);
    return state.rawLedger.some(r => r.code === code) ? 'raw' : 'material';
};

const itemEntryToRow = (e) => ({
    id: e.id,
    entry_date: e.date || localDateStr(),
    location: e.location || '',
    code: e.code || null,
    name: e.name || '',
    type: e.type || '입고',
    notes: e.notes || '',
    in_qty: Number(e.inQty) || 0,
    out_qty: Number(e.outQty) || 0,
    stock_qty: Number(e.stockQty) || 0,
    unit: e.unit || 'EA',
    remark: e.remark || '',
    worker: e.worker || '',
    created_at: e.createdAt || new Date().toISOString(),
    updated_at: e.updatedAt || null
});

const itemRowToEntry = (r) => ({
    id: r.id,
    date: r.entry_date,
    type: r.type,
    location: r.location || '',
    code: r.code || '',
    name: r.name,
    notes: r.notes || '',
    inQty: Number(r.in_qty) || 0,
    outQty: Number(r.out_qty) || 0,
    stockQty: Number(r.stock_qty) || 0,
    unit: r.unit || 'EA',
    remark: r.remark || '',
    worker: r.worker || '',
    createdAt: r.created_at,
    ...(r.updated_at ? { updatedAt: r.updated_at } : {})
});

// 최초 이관 전표 (기존 입출고 이력·현재고로 만든 전표). 클라우드에 이미 전표가 있으면 이 전표 대신 클라우드 전표를 쓴다.
const isInitLedgerId = (id) => String(id).startsWith('INIT-');

const itemLedgerSyncs = {
    product: createLedgerSync({
        stateKey: 'productLedger', table: 'wms_item_ledger', kind: 'product', label: '제품수불부',
        toRow: itemEntryToRow, fromRow: itemRowToEntry, isSeedId: isInitLedgerId,
        onEmptyCloud: () => initItemLedger('product')
    }),
    material: createLedgerSync({
        stateKey: 'materialLedger', table: 'wms_item_ledger', kind: 'material', label: '자재수불부',
        toRow: itemEntryToRow, fromRow: itemRowToEntry, isSeedId: isInitLedgerId,
        onEmptyCloud: () => initItemLedger('material')
    })
};

export const saveItemLedger = (kind, ledger) => itemLedgerSyncs[kind].save(ledger);

// 제품·자재 전표 객체 생성. 재고량을 비워 두면 같은 품목코드·거점의 직전 재고에서 자동 산출한다.
const buildItemLedgerEntry = (entry, ledger) => {
    const m = state.master.find(x => x.code === entry.code);
    const newEntry = {
        id: entry.id || `LED-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        date: entry.date || localDateStr(),
        code: String(entry.code || '').trim(),
        name: String(entry.name || m?.name || entry.code || '').trim(),
        location: siteOf(entry.location || ''),
        type: entry.type || '입고',
        notes: String(entry.notes || '').trim(),
        inQty: parseFloat(entry.inQty) || 0,
        outQty: parseFloat(entry.outQty) || 0,
        stockQty: parseFloat(entry.stockQty) || 0,
        unit: entry.unit || m?.unit || 'EA',
        remark: String(entry.remark || '').trim(),
        worker: entry.worker || state.currentGlobalWorker || '관리자',
        createdAt: new Date().toISOString()
    };
    if (entry.stockQty === undefined || entry.stockQty === null || entry.stockQty === '') {
        let lastStock = 0;
        for (let i = ledger.length - 1; i >= 0; i--) {
            const r = ledger[i];
            if (r.code === newEntry.code && r.location === newEntry.location) {
                lastStock = parseFloat(r.stockQty) || 0;
                break;
            }
        }
        newEntry.stockQty = roundQty(lastStock + newEntry.inQty - newEntry.outQty);
    }
    return newEntry;
};

// 제품·자재 전표 등록 (여러 건을 순서대로)
export const addItemLedgerEntries = async (kind, entries) => {
    const key = LEDGER_KINDS[kind].stateKey;
    const updated = [...state[key]];
    const added = [];
    for (const entry of entries) {
        const e = buildItemLedgerEntry(entry, updated);
        updated.push(e);
        added.push(e);
    }
    if (added.length > 0) await saveItemLedger(kind, updated);
    return added;
};

export const addItemLedgerEntry = async (kind, entry) => (await addItemLedgerEntries(kind, [entry]))[0];

// 같은 품목·거점 전표의 재고량을 처음부터 다시 누적 (전표 수정·삭제 후)
// 제품·자재 수불부는 모든 전표가 '직전 재고 + 입고 − 출고'로 쌓이므로 다시 계산해도 값이 어긋나지 않는다.
const recalcItemLedgerStock = (ledger, code, location) => {
    let stock = 0;
    return ledger.map(e => {
        if (e.code !== code || e.location !== location) return e;
        stock = roundQty(stock + (Number(e.inQty) || 0) - (Number(e.outQty) || 0));
        return e.stockQty === stock ? e : { ...e, stockQty: stock };
    });
};

export const updateItemLedgerEntry = async (kind, id, fields) => {
    const key = LEDGER_KINDS[kind].stateKey;
    const idx = state[key].findIndex(e => e.id === id);
    if (idx === -1) throw new Error('해당 수불 전표를 찾을 수 없습니다.');
    const before = state[key][idx];
    const updated = [...state[key]];
    updated[idx] = { ...before, ...fields, location: siteOf(fields.location || before.location), updatedAt: new Date().toISOString() };
    let next = recalcItemLedgerStock(updated, updated[idx].code, updated[idx].location);
    if (before.code !== updated[idx].code || before.location !== updated[idx].location) {
        next = recalcItemLedgerStock(next, before.code, before.location);
    }
    await saveItemLedger(kind, next);
    return next[idx];
};

export const deleteItemLedgerEntry = async (kind, id) => {
    const key = LEDGER_KINDS[kind].stateKey;
    const target = state[key].find(e => e.id === id);
    if (!target) return false;
    const next = recalcItemLedgerStock(state[key].filter(e => e.id !== id), target.code, target.location);
    await saveItemLedger(kind, next);
    return true;
};

// ------------------------------------------
// 재고 변동 → 수불부 전표 변환
// ------------------------------------------
// 재고 변동(movement): { action: 'IN'|'OUT'|'USE'|'MOVE'|'AUDIT', code, qty(실사는 증감량), fromLoc, toLoc, date, reason, worker, sourceId }
// 원료 수량은 원료수불부 기준(L)으로 적는다. 재고 단위가 KG/G인 원료만 비중으로 환산한다.
const rawUnitOf = (code) => {
    const u = String(state.master.find(m => m.code === code)?.unit || '').trim().toUpperCase();
    return u === 'KG' || u === 'G' ? u : 'L';
};

const movementToLedgerEntries = (mv) => {
    const kind = ledgerKindOfCode(mv.code);
    const m = state.master.find(x => x.code === mv.code);
    const qty = Number(mv.qty) || 0;
    if (!qty) return { kind, entries: [] };
    const reason = mv.reason && mv.reason !== '-' ? mv.reason : '';
    const idBase = mv.sourceId ? `${mv.idPrefix || 'H'}-${mv.sourceId}` : `LED-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const entries = [];

    if (kind === 'raw') {
        const sg = latestRawSg(mv.code);
        const conv = toRawLedgerLiters(Math.abs(qty), rawUnitOf(mv.code), sg);
        const common = (region, extra) => ({
            date: mv.date, code: mv.code, name: rawLedgerNameOf(mv.code, region, m?.name || mv.code), location: region,
            sg, worker: mv.worker, remark: `[입출고 자동]${conv.note ? ` ${conv.note}` : ''}`, ...extra
        });
        const fromR = rawLedgerRegionOf(mv.fromLoc);
        const toR = rawLedgerRegionOf(mv.toLoc);
        if (mv.action === 'IN') entries.push(common(toR, { type: '입고', inQty: conv.qty, outQty: 0, notes: reason || '입고' }));
        else if (mv.action === 'OUT') entries.push(common(fromR, { type: '출고', inQty: 0, outQty: conv.qty, notes: reason || '출고' }));
        else if (mv.action === 'USE') entries.push(common(fromR, { type: '사용', inQty: 0, outQty: conv.qty, notes: reason || '사용' }));
        else if (mv.action === 'MOVE' && fromR !== toR) {
            // 거점이동: 같은 날짜의 짝 전표 (보낸 지역 이동출고 + 받은 지역 이동입고)
            const pairId = `MV-${idBase}`;
            entries.push(common(fromR, { type: RAW_TRANSFER_OUT, pairId, inQty: 0, outQty: conv.qty, notes: `${siteOf(mv.toLoc)}(으)로 이동` }));
            entries.push(common(toR, { type: RAW_TRANSFER_IN, pairId, inQty: conv.qty, outQty: 0, notes: `${siteOf(mv.fromLoc)}에서 이동` }));
        } else if (mv.action === 'AUDIT') {
            entries.push(common(fromR, { type: '재고조사', inQty: qty > 0 ? conv.qty : 0, outQty: qty < 0 ? conv.qty : 0, notes: reason || '재고 실사 조정' }));
        }
    } else {
        const common = (loc, extra) => ({ date: mv.date, code: mv.code, name: m?.name || mv.code, location: siteOf(loc), unit: m?.unit || 'EA', worker: mv.worker, ...extra });
        const fromS = siteOf(mv.fromLoc);
        const toS = siteOf(mv.toLoc);
        const isProduction = String(mv.fromLoc || '').startsWith('생산라인');
        if (mv.action === 'IN') entries.push(common(mv.toLoc, { type: isProduction ? '생산입고' : '입고', inQty: qty, outQty: 0, notes: reason || '입고' }));
        else if (mv.action === 'OUT') entries.push(common(mv.fromLoc, { type: '출고', inQty: 0, outQty: qty, notes: reason || '출고' }));
        else if (mv.action === 'USE') entries.push(common(mv.fromLoc, { type: '사용', inQty: 0, outQty: qty, notes: reason || '생산 투입' }));
        else if (mv.action === 'MOVE' && fromS !== toS) {
            entries.push(common(mv.fromLoc, { type: '이동출고', inQty: 0, outQty: qty, notes: `${toS}(으)로 이동${reason ? ` / ${reason}` : ''}` }));
            entries.push(common(mv.toLoc, { type: '이동입고', inQty: qty, outQty: 0, notes: `${fromS}에서 이동${reason ? ` / ${reason}` : ''}` }));
        } else if (mv.action === 'AUDIT') {
            entries.push(common(mv.fromLoc, { type: '재고조사', inQty: qty > 0 ? qty : 0, outQty: qty < 0 ? -qty : 0, notes: reason || '재고 실사 조정' }));
        }
    }
    return { kind, entries: entries.map((e, i) => ({ ...e, id: entries.length > 1 || mv.sourceId ? `${idBase}-${i}` : undefined })) };
};

// 재고 변동을 해당 수불부에 기입 (입출고·이동·실사·생산 처리 함수에서 호출). 실패해도 재고 처리는 유지한다.
const recordLedgerMovements = async (movements, { skipRaw = false } = {}) => {
    const byKind = { raw: [], product: [], material: [] };
    for (const mv of movements) {
        const { kind, entries } = movementToLedgerEntries(mv);
        if (kind === 'raw' && skipRaw) continue;
        byKind[kind].push(...entries);
    }
    try {
        if (byKind.raw.length > 0) await addRawLedgerEntries(byKind.raw);
        if (byKind.product.length > 0) await addItemLedgerEntries('product', byKind.product);
        if (byKind.material.length > 0) await addItemLedgerEntries('material', byKind.material);
    } catch (e) {
        reportSyncError('수불부 자동 기입', e);
    }
};

// 입출고 이력(history log) → 재고 변동
const AUDIT_DIFF_RE = /오차\s*([+-]?[\d.,]+)/;
const logToMovement = (h, idPrefix) => {
    let qty = Number(h.qty) || 0;
    if (h.type === 'AUDIT') {
        const m = String(h.reason || '').match(AUDIT_DIFF_RE);
        if (!m) return null;
        qty = Number(m[1].replace(/,/g, '')) || 0;
    }
    return {
        action: h.type, code: h.code, qty, fromLoc: h.fromLoc, toLoc: h.toLoc,
        date: toDateKey(h.timestamp) || localDateStr(), reason: h.reason, worker: h.worker, sourceId: h.id, idPrefix
    };
};

// 이력을 오래된 순서로 (history는 최신이 앞. 같은 날짜 안에서는 기록 순서 유지)
// 품목 마스터에 없는 코드(예전 데모 이력 등)는 수불부로 옮기지 않는다.
const historyOldestFirst = () => {
    const masterCodes = new Set(state.master.map(m => m.code));
    return [...state.history].reverse()
    .filter(h => masterCodes.has(h.code))
    .map((h, i) => ({ h, i, d: toDateKey(h.timestamp) }))
    .filter(x => x.d)
    .sort((a, b) => (a.d === b.d ? a.i - b.i : a.d < b.d ? -1 : 1))
    .map(x => x.h);
};

// ------------------------------------------
// 최초 이관: 기존 입출고 이력 + 현재고 → 제품·자재 수불부
// ------------------------------------------
// 거점별 기초(이월) 재고 = 현재고 − 이력상 순증감. 이월 전표 뒤에 이력을 날짜순으로 기입하면 마지막 재고가 현재고와 같아진다.
const initItemLedger = (kind) => {
    const key = LEDGER_KINDS[kind].stateKey;
    if (state[key].length > 0) return false;

    const logs = historyOldestFirst().filter(h => ledgerKindOfCode(h.code) === kind);
    const net = new Map(); // code___site -> 순증감
    const add = (code, loc, d) => {
        if (!loc || loc === '-' || String(loc).startsWith('생산라인')) return;
        const k = `${code}___${siteOf(loc)}`;
        net.set(k, (net.get(k) || 0) + d);
    };
    for (const h of logs) {
        const mv = logToMovement(h);
        if (!mv) continue;
        if (mv.action === 'IN') add(mv.code, mv.toLoc, mv.qty);
        else if (mv.action === 'OUT' || mv.action === 'USE') add(mv.code, mv.fromLoc, -mv.qty);
        else if (mv.action === 'MOVE' && siteOf(mv.fromLoc) !== siteOf(mv.toLoc)) { add(mv.code, mv.fromLoc, -mv.qty); add(mv.code, mv.toLoc, mv.qty); }
        else if (mv.action === 'AUDIT') add(mv.code, mv.fromLoc, mv.qty);
    }

    const current = new Map();
    for (const inv of state.inventory) {
        if (ledgerKindOfCode(inv.code) !== kind) continue;
        const k = `${inv.code}___${siteOf(inv.location)}`;
        current.set(k, (current.get(k) || 0) + (Number(inv.quantity) || 0));
    }

    const openDate = logs.length > 0 ? toDateKey(logs[0].timestamp) : localDateStr();
    const keys = new Set([...current.keys(), ...net.keys()]);
    const ledger = [];
    for (const k of keys) {
        const [code, site] = k.split('___');
        const opening = roundQty((current.get(k) || 0) - (net.get(k) || 0));
        if (opening === 0 && !net.has(k)) continue;
        ledger.push(buildItemLedgerEntry({
            id: `INIT-OPEN-${code}-${site}`, date: openDate, code, location: site, type: '이월',
            inQty: opening, outQty: 0, stockQty: opening, notes: '수불부 전환 시점 기초재고 (현재고 − 이력 순증감)', worker: '시스템'
        }, ledger));
    }
    for (const h of logs) {
        const mv = logToMovement(h, 'INIT-H');
        if (!mv) continue;
        const { entries } = movementToLedgerEntries(mv);
        for (const e of entries) ledger.push(buildItemLedgerEntry(e, ledger));
    }
    state[key] = ledger;
    saveStorage(key, ledger);
    console.log(`[DB] ${LEDGER_KINDS[kind].label} 최초 이관: 이월 ${keys.size}건 기준, 전표 ${ledger.length}건 생성`);
    return true;
};

// ------------------------------------------
// 원료 입출고 이력 → 원료수불부 이관 (원료수불부 마지막 일자 이후 이력만, 기기별 1회)
// ------------------------------------------
const RAW_HISTORY_MIGRATED_KEY = 'rawHistoryMigrated';
const migrateRawHistoryToRawLedger = async () => {
    if (loadStorage(RAW_HISTORY_MIGRATED_KEY, false)) return 0;
    // 클라우드 사용 중에는 쓰기 권한이 있는 사용자만 이관한다 (조회 전용 사용자는 클라우드에 올릴 수 없음)
    if (isSupabaseConfigured() && !canWriteLedger()) return 0;
    const lastDate = new Map(); // 원료명___지역 -> 마지막 전표 일자
    for (const r of state.rawLedger) {
        const k = `${r.name}___${r.location || '김포'}`;
        if (!lastDate.has(k) || r.date > lastDate.get(k)) lastDate.set(k, r.date);
    }
    const existingIds = new Set(state.rawLedger.map(r => r.id));
    const entries = [];
    for (const h of historyOldestFirst()) {
        if (ledgerKindOfCode(h.code) !== 'raw') continue;
        const mv = logToMovement(h, 'HR');
        if (!mv) continue;
        for (const e of movementToLedgerEntries(mv).entries) {
            const last = lastDate.get(`${e.name}___${e.location}`);
            if (last && e.date <= last) continue; // 원료수불부(시트 데이터)에 이미 반영된 기간
            if (existingIds.has(e.id)) continue;
            entries.push({ ...e, remark: `[입출고 이력 이관]${e.remark.replace('[입출고 자동]', '')}` });
        }
    }
    if (entries.length > 0) await addRawLedgerEntries(entries);
    saveStorage(RAW_HISTORY_MIGRATED_KEY, true);
    if (entries.length > 0) console.log(`[DB] 원료 입출고 이력 ${entries.length}건을 원료수불부로 이관했습니다.`);
    return entries.length;
};

// 수불부 로드·초기화 (loadAllData 끝에서 호출). supabase가 null이면 로컬 모드.
const loadLedgers = async (supabase) => {
    // 로컬 모드: 이 기기 원료수불부의 재고를 일자순으로 맞춘다 (클라우드 모드는 load에서 처리)
    if (!supabase) {
        state.rawLedger = recalcRawLedgerByDate(state.rawLedger);
        saveStorage('rawLedger', state.rawLedger);
    }
    const jobs = [['원료수불부', rawLedgerSync], ['제품수불부', itemLedgerSyncs.product], ['자재수불부', itemLedgerSyncs.material]];
    for (const [label, sync] of jobs) {
        if (!supabase) continue;
        try {
            await sync.load(supabase);
        } catch (e) {
            sync.disconnect(); // 클라우드와 맞추지 못했으면 이번 세션은 로컬에만 저장
            console.warn(`[DB] 클라우드 ${label} 로드 생략 (이 기기 데이터 사용):`, e);
        }
    }
    // 클라우드가 없거나 연결에 실패해도 제품·자재 수불부는 이 기기 데이터로 만들어 둔다
    initItemLedger('product');
    initItemLedger('material');
    try {
        await migrateRawHistoryToRawLedger();
    } catch (e) {
        console.warn('[DB] 원료 입출고 이력 이관 실패:', e);
    }
};

// ==========================================
// 품목 마스터 합치기 / 되돌리기 (품목 마스터 관리 화면 전용)
// 같은 실제 품목이 다른 코드·이름으로 중복 등록된 경우, 여러 품목을 하나(기준 품목)로 합쳐
// 재고·이력·수불부 전표·제조시방서·작업지시서를 모두 기준 품목으로 옮기고 나머지 품목은 삭제한다.
// - 클라우드 모드: DB 함수 wms_merge_items / wms_unmerge_items(supabase/auth/12_merge_items.sql)가
//   클라우드의 실제 값으로 한 트랜잭션에 처리하고(실패하면 전부 취소), 되돌리기 정보는 wms_merge_logs에 남아
//   어느 기기에서든 되돌릴 수 있다. 처리 후 전체 데이터를 다시 불러온다 (원료수불부 재고는 로드 때 일자순 재계산).
// - 로컬 모드: 같은 규칙으로 이 기기 데이터만 바꾸고, 되돌리기 정보는 state.mergeLog에 남긴다.
// 원료수불부 대상 전표: 같은 품목코드 전표 + (코드가 비었거나 같은) 같은 원료명 전표.
// 원료코드(보안 코드)는 하나로 통일한다 (기준 품목 것, 없으면 합쳐지는 품목 것).
// ==========================================
const MERGE_LOG_LIMIT = 30;

const cloudReady = () => {
    const supabase = getSupabase();
    return supabase && isSupabaseConfigured() ? supabase : null;
};

// 원료수불부에서 이 품목에 속하는 전표인지 (같은 코드, 또는 코드가 비었거나 같은 같은 원료명)
const rawEntryOfItem = (e, code, name) => e.code === code || (e.name === name && (!e.code || e.code === code));

// 제품·자재수불부에서 code 품목의 재고를 거점별로 다시 누적
const recalcItemLedgerFor = async (kind, codes) => {
    if (kind === 'raw') return;
    const key = LEDGER_KINDS[kind].stateKey;
    let next = state[key];
    for (const code of codes) {
        const locs = new Set(next.filter(e => e.code === code).map(e => e.location));
        for (const loc of locs) next = recalcItemLedgerStock(next, code, loc);
    }
    if (next !== state[key]) await saveItemLedger(kind, next);
};

// 합치기 이력 목록 (최근 순). 클라우드 모드면 wms_merge_logs, 로컬 모드면 이 기기 기록.
export const listMergeLogs = async () => {
    const supabase = cloudReady();
    if (!supabase) return state.mergeLog || [];
    const { data, error } = await supabase.from('wms_merge_logs')
        .select('id, created_at, source_code, source_name, target_code, target_name, undone')
        .order('created_at', { ascending: false }).limit(MERGE_LOG_LIMIT);
    if (error) throw new Error(`합치기 이력을 불러오지 못했습니다: ${error.message}`);
    return (data || []).map(r => ({
        id: r.id, createdAt: r.created_at, sourceCode: r.source_code, sourceName: r.source_name,
        targetCode: r.target_code, targetName: r.target_name, undone: r.undone
    }));
};

export const mergeMasterItems = async (sourceCode, targetCode) => {
    if (!sourceCode || !targetCode || sourceCode === targetCode) {
        throw new Error('합칠 품목과 기준 품목이 서로 달라야 합니다.');
    }
    const source = state.master.find(m => m.code === sourceCode);
    const target = state.master.find(m => m.code === targetCode);
    if (!source || !target) throw new Error('합칠 품목을 찾을 수 없습니다.');
    const kind = ledgerKindOfCategory(source.category);
    if (ledgerKindOfCategory(target.category) !== kind) {
        throw new Error(`분류가 다른 품목은 합칠 수 없습니다. (${source.category} → ${target.category})`);
    }
    const doneMessage = `[${sourceCode}] ${source.name} 품목이 [${targetCode}] ${target.name} 품목으로 합쳐졌습니다.`;

    // 클라우드 모드: DB 함수가 한 번에 처리 (실패하면 아무것도 바뀌지 않음)
    const supabase = cloudReady();
    if (supabase) {
        const { data, error } = await supabase.rpc('wms_merge_items', { p_source: sourceCode, p_target: targetCode });
        if (error) throw new Error(error.message);
        await loadAllData();
        await recalcItemLedgerFor(kind, [targetCode]);
        return { success: true, message: doneMessage, logId: data?.logId, summary: data };
    }

    // 로컬 모드
    const rawCode = kind === 'raw'
        ? (rawSecurityCodeOf(targetCode, target.name) || rawSecurityCodeOf(sourceCode, source.name) || '')
        : '';
    const changes = { inventory: [], history: [], rawLedger: [], itemLedger: [], rawCode };
    const nowStr = new Date().toLocaleString('ko-KR');

    // 1) 재고 (같은 거점이면 합산, 없으면 코드만 변경)
    for (const inv of state.inventory.filter(i => i.code === sourceCode)) {
        const targetInv = state.inventory.find(i => i.code === targetCode && i.location === inv.location);
        changes.inventory.push({ ...inv, merged: !!targetInv });
        if (targetInv) {
            targetInv.quantity = roundQty((Number(targetInv.quantity) || 0) + (Number(inv.quantity) || 0));
            targetInv.lastUpdated = nowStr;
        } else {
            state.inventory.push({ ...inv, code: targetCode, name: target.name, spec: target.spec, category: target.category, subCategory: target.subCategory, unit: target.unit, lastUpdated: nowStr });
        }
    }
    state.inventory = state.inventory.filter(i => i.code !== sourceCode);

    // 2) 이력
    for (const h of state.history) {
        if (h.code === sourceCode) { changes.history.push(h.id); h.code = targetCode; h.name = target.name; }
    }

    // 3) 수불부
    if (kind === 'raw') {
        const next = state.rawLedger.map(e => {
            const isSource = rawEntryOfItem(e, sourceCode, source.name);
            const isTarget = !isSource && rawEntryOfItem(e, targetCode, target.name);
            const needsCode = rawCode && (e.rawCode || '') !== rawCode;
            if (!isSource && !(isTarget && needsCode)) return e;
            changes.rawLedger.push({ id: e.id, code: e.code, name: e.name, rawCode: e.rawCode || null });
            const moved = isSource ? { ...e, code: targetCode, name: target.name } : { ...e };
            if (rawCode) moved.rawCode = rawCode;
            return moved;
        });
        await saveRawLedger(next); // 저장 시 일자순으로 재고 재계산
    } else {
        const key = LEDGER_KINDS[kind].stateKey;
        const next = state[key].map(e => {
            if (e.code !== sourceCode) return e;
            changes.itemLedger.push({ id: e.id, code: e.code, name: e.name });
            return { ...e, code: targetCode, name: target.name };
        });
        await saveItemLedger(kind, next);
        await recalcItemLedgerFor(kind, [targetCode]);
    }

    // 4) 품목 마스터에서 삭제
    state.master = state.master.filter(m => m.code !== sourceCode);
    saveStorage('master', state.master);
    saveStorage('inventory', state.inventory);
    saveStorage('history', state.history);

    const logEntry = {
        id: `MRG-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        createdAt: new Date().toISOString(),
        kind, sourceCode, targetCode, sourceName: source.name, targetName: target.name,
        sourceItem: { ...source }, changes, undone: false
    };
    state.mergeLog = [logEntry, ...(state.mergeLog || [])].slice(0, MERGE_LOG_LIMIT);
    saveStorage('mergeLog', state.mergeLog);
    return { success: true, message: doneMessage, logId: logEntry.id };
};

// 합치기 되돌리기 (재고·이력·수불부·제조시방서·작업지시서를 합치기 전 상태로 되돌리고 품목을 다시 등록)
export const undoMergeMasterItem = async (logId) => {
    const supabase = cloudReady();
    if (supabase) {
        const { data, error } = await supabase.rpc('wms_unmerge_items', { p_log_id: logId });
        if (error) throw new Error(error.message);
        await loadAllData();
        const restored = state.master.find(m => m.code === data?.sourceCode);
        if (restored) await recalcItemLedgerFor(ledgerKindOfCategory(restored.category), [data.sourceCode, data.targetCode]);
        return { success: true, message: `[${data?.targetCode}] 품목에서 [${data?.sourceCode}] 품목을 다시 분리했습니다.` };
    }

    const log = (state.mergeLog || []).find(l => l.id === logId);
    if (!log) throw new Error('되돌릴 병합 이력을 찾을 수 없습니다.');
    if (log.undone) throw new Error('이미 되돌린 병합입니다.');
    if (!log.changes) throw new Error('예전 방식으로 기록된 합치기라 되돌릴 수 없습니다.');
    if (state.master.some(m => m.code === log.sourceCode)) {
        throw new Error(`품목코드 [${log.sourceCode}]가 이미 다시 등록되어 있어 되돌릴 수 없습니다.`);
    }
    const c = log.changes;

    state.master.push({ ...log.sourceItem });

    // 재고: 옮겨 온 수량을 빼고 원래 품목에 되돌림. 코드만 바꿔 생긴 행이 0이 되면 지운다.
    const nowStr = new Date().toLocaleString('ko-KR');
    for (const inv of c.inventory) {
        const targetInv = state.inventory.find(i => i.code === log.targetCode && i.location === inv.location);
        if (targetInv) {
            targetInv.quantity = roundQty((Number(targetInv.quantity) || 0) - (Number(inv.quantity) || 0));
            targetInv.lastUpdated = nowStr;
            if (!inv.merged && targetInv.quantity === 0) state.inventory = state.inventory.filter(i => i !== targetInv);
        }
        const { merged: _omit, ...row } = inv;
        state.inventory.push({ ...row, lastUpdated: nowStr });
    }

    const histIds = new Set(c.history);
    for (const h of state.history) {
        if (histIds.has(h.id)) { h.code = log.sourceCode; h.name = log.sourceName; }
    }

    if (log.kind === 'raw') {
        const before = new Map(c.rawLedger.map(e => [e.id, e]));
        const next = state.rawLedger.map(e => {
            const b = before.get(e.id);
            if (!b) return e;
            const { rawCode: _omit, ...rest } = e;
            return { ...rest, code: b.code, name: b.name, ...(b.rawCode ? { rawCode: b.rawCode } : {}) };
        });
        await saveRawLedger(next);
    } else {
        const key = LEDGER_KINDS[log.kind].stateKey;
        const before = new Map(c.itemLedger.map(e => [e.id, e]));
        await saveItemLedger(log.kind, state[key].map(e => (before.has(e.id) ? { ...e, code: before.get(e.id).code, name: before.get(e.id).name } : e)));
        await recalcItemLedgerFor(log.kind, [log.sourceCode, log.targetCode]);
    }

    saveStorage('master', state.master);
    saveStorage('inventory', state.inventory);
    saveStorage('history', state.history);
    log.undone = true;
    saveStorage('mergeLog', state.mergeLog);
    return { success: true, message: `[${log.targetCode}] 품목에서 [${log.sourceCode}] ${log.sourceName} 품목을 다시 분리했습니다.` };
};
