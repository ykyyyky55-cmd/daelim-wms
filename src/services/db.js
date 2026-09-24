import { getSupabase, isSupabaseConfigured } from './supabase.js';
import enterpriseData from '../data/enterpriseData.json';
import rawLedgerFullData from '../data/rawLedgerFull.json';
import { resolveMasterItem, determineSubCategory, determineCategoryAndSubCategory, MASTER_CATEGORIES } from './searchUtils.js';

// 기본 초기 데모 데이터 (enterpriseData가 기본 실물 데이터로 사용됩니다)
const DEFAULT_CATEGORIES = enterpriseData.categories || MASTER_CATEGORIES;
const DEFAULT_LOCATIONS = enterpriseData.locations || ["본사 창고", "김포공장", "방산 창고", "대림오일 창고"];
const DEFAULT_WORKERS = (enterpriseData.workers || [
    { id: "EMP-002", name: "김생산", dept: "생산조립2팀", role: "생산기사" },
    { id: "EMP-003", name: "이물류", dept: "자재운영팀", role: "반장" },
    { id: "EMP-004", name: "박품질", dept: "품질보증팀", role: "주임" }
]).filter(w => w.name !== '홍길동');
const DEFAULT_USERS = enterpriseData.users || [
    { id: "admin", name: "관리자", username: "admin", password: "admin123", role: "ADMIN", dept: "물류관리팀", title: "총괄 관리자" },
    { id: "manager", name: "김물류", username: "manager", password: "manager123", role: "MANAGER", dept: "자재운영팀", title: "물류 반장" },
    { id: "worker", name: "이작업", username: "worker", password: "worker123", role: "OPERATOR", dept: "생산조립팀", title: "현장 기사" },
    { id: "viewer", name: "박조회", username: "viewer", password: "viewer123", role: "VIEWER", dept: "경영기획팀", title: "조회 전용" }
];
const DEFAULT_MASTER = enterpriseData.master;
const DEFAULT_INVENTORY = enterpriseData.inventory;
const DEFAULT_HISTORY = enterpriseData.history;
const DEFAULT_GIMPO_LOGS = enterpriseData.gimpoProductionLogs || [];
const DEFAULT_GIMPO_DATA = enterpriseData.gimpoDataSummary || [];

// 김포공장 원료수불부 기본 전체 데이터 (구글 시트 99개 원료 실물 데이터 연동)
export const DEFAULT_RAW_LEDGER = rawLedgerFullData.entries || [];

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
    return d.toISOString().slice(0, 10);
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
        prodDate: new Date().toISOString().slice(0, 10),
        itemCode: "ITEM-1002",
        itemName: "대림 울트라 5W-30 합성엔진오일",
        packaging: "200L 드럼",
        qty: 20,
        unit: "DRUM",
        lotNo: "LOT-20260922-A1",
        mfgDate: new Date().toISOString().slice(0, 10),
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
        orderDate: new Date().toISOString().slice(0, 10),
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
    master: loadStorage('master', DEFAULT_MASTER),
    inventory: loadStorage('inventory', DEFAULT_INVENTORY),
    history: loadStorage('history', DEFAULT_HISTORY),
    productions: loadStorage('productions', DEFAULT_PRODUCTIONS),
    workOrders: loadStorage('workOrders', DEFAULT_WORK_ORDERS),
    rawLedger: loadStorage('rawLedger', DEFAULT_RAW_LEDGER),
    beginningStock: loadStorage('beginningStock', {}),
    schedules: loadStorage('schedules', DEFAULT_SCHEDULES),
    gimpoLogs: loadStorage('gimpoLogs', DEFAULT_GIMPO_LOGS),
    gimpoDataSummary: loadStorage('gimpoDataSummary', DEFAULT_GIMPO_DATA),
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

// 번들 기본 품목 동기화 (enterpriseData / data01.xlsx 기준)
// 직전에 적용한 번들 품목코드 목록(masterSeedCodes)과 비교해 번들에서 빠진 품목만 제거하고,
// 번들에 새로 추가된 품목만 보충한다. 사용자가 직접 등록한 품목(번들에 없던 코드)과
// 사용자가 삭제한 기본 품목은 건드리지 않는다.
const defaultCodes = new Set(DEFAULT_MASTER.map(m => m.code));
const prevSeedCodes = loadStorage('masterSeedCodes', null);
const prevSeed = Array.isArray(prevSeedCodes) ? new Set(prevSeedCodes) : null;
if (Array.isArray(state.master)) {
    // 1. 직전 번들에는 있었지만 현재 번들에서 삭제된 품목 제거
    if (prevSeed) {
        const removedFromBundle = new Set([...prevSeed].filter(c => !defaultCodes.has(c)));
        if (removedFromBundle.size > 0) {
            state.master = state.master.filter(m => !removedFromBundle.has(m.code));
        }
    }
    // 2. 번들에 새로 추가된 품목 보충 (직전 기준이 없으면 누락된 기본 품목 전체) 및 해당 품목의 기본 재고 보충
    const currentCodes = new Set(state.master.map(m => m.code));
    const toAdd = DEFAULT_MASTER.filter(m => !currentCodes.has(m.code) && !(prevSeed && prevSeed.has(m.code)));
    if (toAdd.length > 0) {
        state.master.push(...toAdd);
        if (Array.isArray(state.inventory)) {
            const addedCodes = new Set(toAdd.map(m => m.code));
            const existingKeys = new Set(state.inventory.map(i => invKey(i.code, i.location)));
            state.inventory.push(...DEFAULT_INVENTORY.filter(i => addedCodes.has(i.code) && !existingKeys.has(invKey(i.code, i.location))));
        }
    }
    saveStorage('master', state.master);
    saveStorage('masterSeedCodes', [...defaultCodes]);
}
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
// 반환: Map(invKey -> 반영 후 클라우드 수량). Supabase 미설정 또는 통신 오류 시 null (로컬 전용으로 진행).
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
        reportSyncError('재고 수량 (로컬에만 반영됨)', err);
        return null;
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
        return state;
    }

    try {
        console.log('[DB] Supabase 클라우드에서 데이터 동기화 시작...');
        const [catRes, locRes, workRes, userRes, histRes] = await Promise.all([
            supabase.from('wms_categories').select('name').order('created_at'),
            supabase.from('wms_locations').select('name').order('created_at'),
            supabase.from('wms_workers').select('*').order('id'),
            supabase.from('wms_users').select('*').order('id'),
            supabase.from('wms_history_logs').select('*').order('id', { ascending: false }).limit(200)
        ]);

        // 대분류 카테고리 동기화 (표준 6대 카테고리: 완제품, 원액, 원료, 부자재, 소모품, 기타 항시 보장)
        if (catRes.data && catRes.data.length > 0) {
            const remoteCats = catRes.data.map(c => c.name);
            state.categories = Array.from(new Set([...MASTER_CATEGORIES, ...remoteCats]));
        } else {
            state.categories = [...MASTER_CATEGORIES];
        }
        saveStorage('categories', state.categories);

        if (locRes.data && locRes.data.length > 0) state.locations = locRes.data.map(l => l.name);
        if (workRes.data && workRes.data.length > 0) state.workers = workRes.data;
        if (userRes.data && userRes.data.length > 0) state.users = userRes.data;

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
        }

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
            if (schedRes.data && schedRes.data.length > 0) {
                state.schedules = schedRes.data.map(s => ({
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
        prodDate: mfgDate || new Date().toISOString().slice(0, 10),
        itemCode: prodItemCode,
        itemName,
        packaging,
        qty: prodQty,
        unit,
        lotNo,
        mfgDate: mfgDate || new Date().toISOString().slice(0, 10),
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

    return { success: true, production: newProduction, log: prodInLog };
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

export const addLocation = async (name) => {
    if (!name || state.locations.includes(name)) return;
    state.locations.push(name);
    saveStorage('locations', state.locations);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_locations').insert([{ name }]), '거점 추가');
    }
};

export const deleteLocation = async (name) => {
    state.locations = state.locations.filter(l => l !== name);
    saveStorage('locations', state.locations);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_locations').delete().eq('name', name), '거점 삭제');
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

export const saveUserAccount = async (user) => {
    const idx = state.users.findIndex(u => u.username === user.username);
    if (idx >= 0) state.users[idx] = { ...state.users[idx], ...user };
    else state.users.push(user);
    saveStorage('users', state.users);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_users').upsert(user), '사용자 계정 저장');
    }
};

export const deleteUserAccount = async (username) => {
    state.users = state.users.filter(u => u.username !== username);
    saveStorage('users', state.users);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await checkWrite(supabase.from('wms_users').delete().eq('username', username), '사용자 계정 삭제');
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
        state.locations = data.locations;
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
        state.inventory = data.inventory;
        saveStorage('inventory', state.inventory);
    }
    if (data.history && Array.isArray(data.history)) {
        state.history = data.history;
        saveStorage('history', state.history);
    }
    if (data.schedules && Array.isArray(data.schedules)) {
        state.schedules = data.schedules;
        saveStorage('schedules', state.schedules);
    }
};

export const resetToEnterpriseData = async () => {
    await restoreAllData(enterpriseData);
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
            status: schedule.status || 'TODO'
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

        if (onProgress) onProgress({ step: '작업자 및 사용자 계정 동기화 중...', percent: 30 });
        if (state.workers.length > 0) {
            await upload(supabase.from('wms_workers').upsert(state.workers, { onConflict: 'id' }), '작업자');
        }
        if (state.users.length > 0) {
            await upload(supabase.from('wms_users').upsert(state.users, { onConflict: 'username' }), '사용자 계정');
        }

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

export const getGimpoLogByDate = (dateStr) => {
    if (!dateStr) return null;
    const cleanDate = dateStr.trim();
    // 1. 전체 날짜 YYYY-MM-DD 매칭
    let found = state.gimpoLogs.find(l => l.date === cleanDate);
    if (!found) {
        // 2. MMDD 형태 (예: 0831) 매칭
        const mmdd = cleanDate.replace(/-/g, '').slice(-4);
        found = state.gimpoLogs.find(l => l.sheetName === mmdd || l.date.endsWith(cleanDate));
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

export const saveGimpoLog = (logData) => {
    if (!logData || !logData.date) return;
    const idx = state.gimpoLogs.findIndex(l => l.date === logData.date || l.sheetName === logData.sheetName);
    if (idx >= 0) {
        state.gimpoLogs[idx] = logData;
    } else {
        state.gimpoLogs.unshift(logData);
    }
    // 날짜 역순 정렬
    state.gimpoLogs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    saveStorage('gimpoLogs', state.gimpoLogs);
};

export const deleteGimpoLog = (dateStr) => {
    state.gimpoLogs = state.gimpoLogs.filter(l => l.date !== dateStr && l.sheetName !== dateStr);
    saveStorage('gimpoLogs', state.gimpoLogs);
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
    if (Array.isArray(state.gimpoLogs)) {
        for (const log of state.gimpoLogs) {
            ['packaging', 'oilBlending', 'movement', 'receiving', 'shipping'].forEach(sec => {
                (log[sec] || []).forEach(row => {
                    if (row.item && (row.item.includes(oldCode) || (oldMasterIdx >= 0 && row.item.includes(state.master[oldMasterIdx].name)))) {
                        if (row.item.includes(oldCode)) {
                            row.item = row.item.replace(oldCode, newCode);
                        } else {
                            row.item = `${newCode} / ${finalName} | ${finalSpec}`;
                        }
                    }
                });
            });
        }
        saveStorage('gimpoLogs', state.gimpoLogs);
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
 * 김포 생산공급망 일지의 포장/원액생산/이동/입출고 실적을 WMS 재고 및 수불부에 일괄 반영
 * (품목코드 없는 품목은 기존 마스터 지능형 대조 합산 반영, 검색불가 품목은 0000 임시코드로 자동 등록)
 */
export const applyGimpoLogToInventory = async (dateStr, workerName = '최용화') => {
    const log = getGimpoLogByDate(dateStr);
    if (!log) throw new Error('해당 날짜의 생산일지를 찾을 수 없습니다.');
    // 이미 반영된 일지를 다시 반영하면 입고/출고/이동이 중복 기록되어 재고가 틀어지므로 차단
    if (checkGimpoLogSyncStatus(log).isSynced) {
        throw new Error(`${log.date} 일지는 이미 WMS 재고와 수불부에 반영되었습니다. 중복 반영을 막기 위해 다시 반영할 수 없습니다.`);
    }

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

    // 1. 제품 포장 실적 -> 완제품 김포공장 입고(+)
    for (const item of (log.packaging || [])) {
        if (!item.qty || item.qty <= 0) continue;
        try {
            const res = await getOrCreateMasterItem(item.item, item.spec, item.category || '완제품', 'EA');
            if (!res || !res.item) continue;

            if (res.matched) appliedSummary.matchedMasterCount++;
            if (res.isNewTemp) {
                appliedSummary.tempCreatedCount++;
                appliedSummary.tempItems.push({ code: res.item.code, name: res.item.name });
            }

            await processStockAction({
                type: 'IN',
                code: res.item.code,
                qty: item.qty,
                location: '김포공장',
                worker: workerName,
                reason: `[${log.date} 김포 생산일지] 포장생산 완료 (${item.line || '라인'} / LOT:${item.lotNo || '-'})`
            });
            appliedSummary.packagingCount++;
        } catch (err) {
            appliedSummary.errors.push(`[포장] ${item.item}: ${err.message}`);
        }
    }

    // 2. 원액생산 실적 -> 원액 김포공장 입고(+)
    for (const item of (log.oilBlending || [])) {
        if (!item.qty || item.qty <= 0) continue;
        try {
            const res = await getOrCreateMasterItem(item.item, item.spec || 'L', '원액', 'L');
            if (!res || !res.item) continue;

            if (res.matched) appliedSummary.matchedMasterCount++;
            if (res.isNewTemp) {
                appliedSummary.tempCreatedCount++;
                appliedSummary.tempItems.push({ code: res.item.code, name: res.item.name });
            }

            await processStockAction({
                type: 'IN',
                code: res.item.code,
                qty: item.qty,
                location: '김포공장',
                worker: workerName,
                reason: `[${log.date} 김포 생산일지] 원액 블렌딩 생산 완료 (${item.line || 'BT'} / LOT:${item.lotNo || '-'})`
            });
            appliedSummary.oilCount++;
        } catch (err) {
            appliedSummary.errors.push(`[원액] ${item.item}: ${err.message}`);
        }
    }

    // 3. 이동 제품 실적 -> 김포공장 차감(-), 본사/방산 창고 입고(+)
    for (const item of (log.movement || [])) {
        if (!item.qty || item.qty <= 0) continue;
        try {
            const res = await getOrCreateMasterItem(item.item, item.spec, '', item.unit || 'EA');
            if (!res || !res.item) continue;

            if (res.matched) appliedSummary.matchedMasterCount++;
            if (res.isNewTemp) {
                appliedSummary.tempCreatedCount++;
                appliedSummary.tempItems.push({ code: res.item.code, name: res.item.name });
            }

            const toLoc = item.route && item.route.includes('방산') ? '방산 창고' : '본사 창고';
            await processStockAction({
                type: 'MOVE',
                code: res.item.code,
                qty: item.qty,
                fromLoc: '김포공장',
                toLoc: toLoc,
                worker: item.driver || workerName,
                reason: `[${log.date} 김포 생산일지] 거점간 제품이동 (${item.vehicle || '3.5T'} / 운반자:${item.driver || '-'})`
            });
            appliedSummary.moveCount++;
        } catch (err) {
            appliedSummary.errors.push(`[이동] ${item.item}: ${err.message}`);
        }
    }

    // 4. 원부자재 입고 실적 -> 김포공장 입고(+)
    for (const item of (log.receiving || [])) {
        if (!item.qty || item.qty <= 0) continue;
        try {
            const res = await getOrCreateMasterItem(item.item, item.spec, '부자재', 'EA');
            if (!res || !res.item) continue;

            if (res.matched) appliedSummary.matchedMasterCount++;
            if (res.isNewTemp) {
                appliedSummary.tempCreatedCount++;
                appliedSummary.tempItems.push({ code: res.item.code, name: res.item.name });
            }

            await processStockAction({
                type: 'IN',
                code: res.item.code,
                qty: item.qty,
                location: '김포공장',
                worker: item.inspector || workerName,
                reason: `[${log.date} 김포 생산일지] 원부자재 입고 (${item.partner || '협력사'})`
            });
            appliedSummary.receivingCount++;
        } catch (err) {
            appliedSummary.errors.push(`[입고] ${item.item}: ${err.message}`);
        }
    }

    // 5. 고객사 출고 실적 -> 김포공장 출고(-)
    for (const item of (log.shipping || [])) {
        if (!item.qty || item.qty <= 0) continue;
        try {
            const res = await getOrCreateMasterItem(item.item, item.spec, '완제품', 'EA');
            if (!res || !res.item) continue;

            if (res.matched) appliedSummary.matchedMasterCount++;
            if (res.isNewTemp) {
                appliedSummary.tempCreatedCount++;
                appliedSummary.tempItems.push({ code: res.item.code, name: res.item.name });
            }

            // 출고 시 재고가 없으면 경고 방지 및 실재고 관리를 위해 처리
            try {
                await processStockAction({
                    type: 'OUT',
                    code: res.item.code,
                    qty: item.qty,
                    location: '김포공장',
                    worker: item.inspector || workerName,
                    reason: `[${log.date} 김포 생산일지] 고객사 출고 (${item.partner || '거래처'})`
                });
                appliedSummary.shippingCount++;
            } catch (outErr) {
                // 출고 시 재고가 부족하면 부족분만큼 가상 입고(이력·클라우드에 함께 기록) 후 출고 처리
                // (로컬 수량만 몰래 올리면 클라우드 재고·이력과 어긋난다)
                const inv = state.inventory.find(i => i.code === res.item.code && i.location === '김포공장');
                const shortfall = (Number(item.qty) || 0) - (inv ? Number(inv.quantity) || 0 : 0);
                if (shortfall > 0) {
                    await processStockAction({
                        type: 'IN',
                        code: res.item.code,
                        qty: shortfall,
                        location: '김포공장',
                        worker: item.inspector || workerName,
                        reason: `[${log.date} 김포 생산일지] 출고 재고 부족분 가상 입고 (${item.partner || '거래처'})`
                    });
                }
                await processStockAction({
                    type: 'OUT',
                    code: res.item.code,
                    qty: item.qty,
                    location: '김포공장',
                    worker: item.inspector || workerName,
                    reason: `[${log.date} 김포 생산일지] 고객사 출고 (${item.partner || '거래처'})`
                });
                appliedSummary.shippingCount++;
            }
        } catch (err) {
            appliedSummary.errors.push(`[출고] ${item.item}: ${err.message}`);
        }
    }

    // 6. 일지 객체에 수불부 반영 상태 및 일시 기록 저장
    log.isSyncedToLedger = true;
    log.syncedAt = new Date().toISOString();
    saveGimpoLog(log);

    return appliedSummary;
};

/**
 * 특정 김포 일지의 수불부(WMS 재고 및 이력) 반영 여부 확인
 */
export const checkGimpoLogSyncStatus = (logOrDateStr) => {
    const log = typeof logOrDateStr === 'string' ? getGimpoLogByDate(logOrDateStr) : logOrDateStr;
    if (!log) return { isSynced: false, reasonCount: 0 };

    if (log.isSyncedToLedger) {
        return { isSynced: true, syncedAt: log.syncedAt || null };
    }

    // state.history 내에 해당 일자 일지 관련 트랜잭션이 이미 존재하는지 확인
    const datePrefix = log.date || '';
    const matchCount = state.history.filter(h => h.reason && h.reason.includes(`[${datePrefix} 김포 생산일지]`)).length;
    
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
        saveGimpoLog(log);
    }

    return {
        isSynced: !!isSynced,
        matchCount,
        actionableCount,
        syncedAt: log.syncedAt || null
    };
};

/**
 * 전체 김포 일지 중 수불부 동기화 통계 조회
 */
export const getGimpoSyncStatistics = () => {
    const logs = state.gimpoLogs || [];
    let syncedDays = 0;
    let unsyncedDays = 0;
    const unsyncedLogs = [];

    logs.forEach(log => {
        const status = checkGimpoLogSyncStatus(log);
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
 * 미반영된 모든 김포 업무일지를 수불부 및 WMS 재고로 일괄 동기화
 */
export const syncAllUnsyncedGimpoLogs = async (workerName = '최용화') => {
    const stats = getGimpoSyncStatistics();
    const unsynced = stats.unsyncedLogs;

    if (unsynced.length === 0) {
        return {
            syncedDaysCount: 0,
            totalItemsApplied: 0,
            message: '이미 모든 생산공급망 일지가 수불부에 반영되어 있습니다.'
        };
    }

    let syncedDaysCount = 0;
    let totalItemsApplied = 0;
    const errors = [];

    for (const log of unsynced) {
        try {
            const res = await applyGimpoLogToInventory(log.date, workerName);
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

// 원료수불부 전체 저장 (LocalStorage 및 Supabase 동기화)
export const saveRawLedger = async (ledger) => {
    state.rawLedger = ledger;
    saveStorage('rawLedger', state.rawLedger);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        // 주의: wms_raw_ledger 테이블은 supabase_schema.sql에 정의되어 있지 않아 이 upsert는 현재 실패한다.
        // 테이블을 만들기 전까지는 경고 알림(checkWrite)을 붙이지 않고 콘솔에만 남긴다 (저장할 때마다 경고가 뜨는 것 방지).
        try {
            const { error } = await supabase.from('wms_raw_ledger').upsert(ledger);
            if (error) console.warn('[DB] Supabase rawLedger 동기화 실패(로컬 정상 저장)', error);
        } catch (e) {
            console.warn('[DB] Supabase rawLedger 동기화 실패(로컬 정상 저장)', e);
        }
    }
};

// 원료수불부 신규 수불 전표 등록 (입력 순서대로 누적)
export const addRawLedgerEntry = async (entry) => {
    const id = entry.id || `RAW-${Date.now()}`;
    const newEntry = {
        id,
        date: entry.date || new Date().toISOString().slice(0, 10),
        code: (entry.code || entry.itemCode || '').trim(),
        name: (entry.name || entry.itemName || '').trim(),
        location: (entry.location || '김포').trim(), // 지역구분 (김포 / 본사)
        type: entry.type || '입고',
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
        createdAt: new Date().toISOString()
    };

    // 직전 재고를 기준으로 재고량 자동 산출 (사용자가 직접 기재하지 않은 경우)
    if (entry.stockQty === undefined || entry.stockQty === null || entry.stockQty === '') {
        const itemEntries = state.rawLedger.filter(r => r.name === newEntry.name);
        const lastStock = itemEntries.length > 0 ? (parseFloat(itemEntries[itemEntries.length - 1].stockQty) || 0) : 0;
        newEntry.stockQty = parseFloat((lastStock + newEntry.inQty - newEntry.outQty).toFixed(2));
    }

    // 비중(SG)과 재고(L)를 기반으로 중량(KG/G) 자동 계산
    if (!newEntry.weight && newEntry.stockQty) {
        newEntry.weight = parseFloat((newEntry.stockQty * newEntry.sg).toFixed(2));
    }

    const updated = [...state.rawLedger, newEntry];
    await saveRawLedger(updated);
    return newEntry;
};

// 원료수불부 전표 수정
export const updateRawLedgerEntry = async (id, updatedFields) => {
    const index = state.rawLedger.findIndex(r => r.id === id);
    if (index === -1) throw new Error('해당 원료수불 내역을 찾을 수 없습니다.');

    state.rawLedger[index] = {
        ...state.rawLedger[index],
        ...updatedFields,
        updatedAt: new Date().toISOString()
    };

    await saveRawLedger(state.rawLedger);
    return state.rawLedger[index];
};

// 원료수불부 전표 삭제
export const deleteRawLedgerEntry = async (id) => {
    const updated = state.rawLedger.filter(r => r.id !== id);
    await saveRawLedger(updated);
    return true;
};
