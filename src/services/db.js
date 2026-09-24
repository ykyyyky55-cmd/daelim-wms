import { getSupabase, isSupabaseConfigured } from './supabase.js';
import enterpriseData from '../data/enterpriseData.json';
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

// 로컬 스토리지 헬퍼
const loadStorage = (key, defaultVal) => {
    try {
        const item = localStorage.getItem(`daelim_${key}`);
        if (!item) return defaultVal;
        const parsed = JSON.parse(item);
        // 만약 기존 로컬스토리지에 예전 4개 샘플 데이터만 있다면 최신 실제 기업 데이터(2497건)로 업그레이드
        if (key === 'master' && Array.isArray(parsed) && parsed.length < DEFAULT_MASTER.length) {
            return defaultVal;
        }
        if (key === 'inventory' && Array.isArray(parsed) && parsed.length < DEFAULT_INVENTORY.length) {
            return defaultVal;
        }
        return parsed;
    } catch {
        return defaultVal;
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
    currentUser: loadStorage('currentUser', DEFAULT_USERS[0]),
    currentGlobalWorker: (() => {
        const cw = loadStorage('currentWorker', "김물류 (반장)");
        return (cw && !cw.includes('홍길동')) ? cw : "김물류 (반장)";
    })(),
    master: loadStorage('master', DEFAULT_MASTER),
    inventory: loadStorage('inventory', DEFAULT_INVENTORY),
    history: loadStorage('history', DEFAULT_HISTORY),
    productions: loadStorage('productions', DEFAULT_PRODUCTIONS),
    workOrders: loadStorage('workOrders', DEFAULT_WORK_ORDERS),
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

// enterpriseData 최신 마스터 품목 및 재고 항목 자동 동기화 (누락분 보충)
if (Array.isArray(state.master) && DEFAULT_MASTER.length > state.master.length) {
    const existingCodes = new Set(state.master.map(m => m.code));
    const toAdd = DEFAULT_MASTER.filter(m => !existingCodes.has(m.code));
    if (toAdd.length > 0) {
        state.master.push(...toAdd);
        saveStorage('master', state.master);
    }
}
if (Array.isArray(state.inventory) && DEFAULT_INVENTORY.length > state.inventory.length) {
    const existingKeys = new Set(state.inventory.map(i => `${i.code}___${i.location}`));
    const toAddInv = DEFAULT_INVENTORY.filter(i => !existingKeys.has(`${i.code}___${i.location}`));
    if (toAddInv.length > 0) {
        state.inventory.push(...toAddInv);
        saveStorage('inventory', state.inventory);
    }
}
if (Array.isArray(state.categories)) {
    const validCategories = MASTER_CATEGORIES;
    const existingCats = new Set(state.categories);
    for (const vc of validCategories) {
        if (!existingCats.has(vc)) {
            state.categories.push(vc);
        }
    }
    // 6대 공식 대분류만 유지
    state.categories = state.categories.filter(c => validCategories.includes(c));
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
        const [catRes, locRes, workRes, userRes, itemRes, invRes, histRes] = await Promise.all([
            supabase.from('wms_categories').select('name').order('created_at'),
            supabase.from('wms_locations').select('name').order('created_at'),
            supabase.from('wms_workers').select('*').order('id'),
            supabase.from('wms_users').select('*').order('id'),
            supabase.from('wms_master_items').select('*').order('code'),
            supabase.from('wms_inventory').select('*').order('code'),
            supabase.from('wms_history_logs').select('*').order('id', { ascending: false }).limit(200)
        ]);

        if (catRes.data && catRes.data.length > 0) state.categories = catRes.data.map(c => c.name);
        if (locRes.data && locRes.data.length > 0) state.locations = locRes.data.map(l => l.name);
        if (workRes.data && workRes.data.length > 0) state.workers = workRes.data;
        if (userRes.data && userRes.data.length > 0) state.users = userRes.data;
        if (itemRes.data && itemRes.data.length > 0) state.master = itemRes.data;

        if (invRes.data && invRes.data.length > 0) {
            // 마스터 정보를 조합하여 inventory 포맷 보정
            state.inventory = invRes.data.map(inv => {
                const m = state.master.find(item => item.code === inv.code) || {};
                return {
                    category: m.category || '기타',
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
        await supabase.from('wms_master_items').upsert({
            code: itemToSave.code,
            name: itemToSave.name,
            category: itemToSave.category,
            supplier: itemToSave.supplier,
            spec: itemToSave.spec,
            unit: itemToSave.unit || 'EA',
            safety: Number(itemToSave.safety) || 0
        });
    }
};

export const deleteMasterItem = async (code) => {
    state.master = state.master.filter(m => m.code !== code);
    state.inventory = state.inventory.filter(i => i.code !== code);
    saveStorage('master', state.master);
    saveStorage('inventory', state.inventory);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await supabase.from('wms_master_items').delete().eq('code', code);
    }
};

export const bulkUpsertMasterItems = async (items) => {
    for (const it of items) {
        await saveMasterItem(it);
    }
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

    // 1. 재고 변동 로직
    if (type === 'IN') {
        const targetLoc = location || toLoc;
        let invItem = state.inventory.find(i => i.code === code && i.location === targetLoc);
        if (invItem) {
            invItem.quantity += qty;
            invItem.lastUpdated = nowStr;
        } else {
            invItem = {
                category: masterItem?.category || '기타',
                code,
                name: itemName,
                supplier: masterItem?.supplier || '-',
                spec: masterItem?.spec || '-',
                location: targetLoc,
                quantity: qty,
                unit: masterItem?.unit || 'EA',
                status: '정상 보관',
                lastUpdated: nowStr
            };
            state.inventory.push(invItem);
        }
    } else if (type === 'OUT' || type === 'USE') {
        const targetLoc = location || fromLoc;
        const invItem = state.inventory.find(i => i.code === code && i.location === targetLoc);
        if (!invItem || invItem.quantity < qty) {
            throw new Error(`[출고 불가] ${targetLoc}의 현재 재고(${invItem ? invItem.quantity : 0}EA)가 요청 수량(${qty}EA)보다 부족합니다.`);
        }
        invItem.quantity -= qty;
        invItem.lastUpdated = nowStr;
    } else if (type === 'MOVE') {
        if (!fromLoc || !toLoc || fromLoc === toLoc) {
            throw new Error('출발 거점과 도착 거점이 서로 달라야 합니다.');
        }
        const sourceItem = state.inventory.find(i => i.code === code && i.location === fromLoc);
        if (!sourceItem || sourceItem.quantity < qty) {
            throw new Error(`[이동 불가] ${fromLoc}의 현재 재고(${sourceItem ? sourceItem.quantity : 0}EA)가 부족합니다.`);
        }
        sourceItem.quantity -= qty;
        sourceItem.lastUpdated = nowStr;

        let targetItem = state.inventory.find(i => i.code === code && i.location === toLoc);
        if (targetItem) {
            targetItem.quantity += qty;
            targetItem.lastUpdated = nowStr;
        } else {
            targetItem = {
                category: masterItem?.category || '기타',
                code,
                name: itemName,
                supplier: masterItem?.supplier || '-',
                spec: masterItem?.spec || '-',
                location: toLoc,
                quantity: qty,
                unit: masterItem?.unit || 'EA',
                status: '정상 보관',
                lastUpdated: nowStr
            };
            state.inventory.push(targetItem);
        }
    }

    // 2. 이력 로그 생성
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

    // 3. Supabase 동기화 (설정 시)
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        try {
            // 이력 로그 DB 삽입
            await supabase.from('wms_history_logs').insert([{
                type: newLog.type,
                code: newLog.code,
                name: newLog.name,
                qty: newLog.qty,
                worker: newLog.worker,
                from_loc: newLog.fromLoc,
                to_loc: newLog.toLoc,
                reason: newLog.reason
            }]);

            // 재고 DB Upsert
            if (type === 'IN' || type === 'OUT' || type === 'USE') {
                const loc = location || (type === 'IN' ? toLoc : fromLoc);
                const invItem = state.inventory.find(i => i.code === code && i.location === loc);
                await supabase.from('wms_inventory').upsert({
                    code,
                    location: loc,
                    quantity: invItem ? invItem.quantity : 0,
                    status: '정상 보관',
                    last_updated: new Date().toISOString()
                }, { onConflict: 'code,location' });
            } else if (type === 'MOVE') {
                const sourceItem = state.inventory.find(i => i.code === code && i.location === fromLoc);
                const targetItem = state.inventory.find(i => i.code === code && i.location === toLoc);
                await Promise.all([
                    supabase.from('wms_inventory').upsert({
                        code,
                        location: fromLoc,
                        quantity: sourceItem ? sourceItem.quantity : 0,
                        last_updated: new Date().toISOString()
                    }, { onConflict: 'code,location' }),
                    supabase.from('wms_inventory').upsert({
                        code,
                        location: toLoc,
                        quantity: targetItem ? targetItem.quantity : 0,
                        last_updated: new Date().toISOString()
                    }, { onConflict: 'code,location' })
                ]);
            }
        } catch (err) {
            console.error('[DB] Supabase 저장 중 오류:', err);
        }
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

    // 7. Supabase 동기화 (설정된 경우)
    if (isSupabaseConfigured()) {
        try {
            const supabase = getSupabase();
            if (supabase) {
                await Promise.all([
                    supabase.from('wms_inventory').upsert({
                        code: prodItemCode,
                        location: location,
                        quantity: prodInv.quantity,
                        last_updated: new Date().toISOString()
                    }, { onConflict: 'code,location' }),
                    supabase.from('wms_history_logs').insert([{
                        timestamp: nowStr,
                        type: 'IN',
                        code: prodItemCode,
                        name: itemName,
                        qty: prodQty,
                        worker: operator,
                        from_loc: `생산라인 (${prodType} 제조)`,
                        to_loc: location,
                        reason: prodInLog.reason,
                        notes: prodInLog.notes
                    }])
                ]);
            }
        } catch (err) {
            console.warn('[DB] 생산입고 Supabase 동기화 중 경고:', err);
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
            await supabase.from('wms_inventory').upsert({
                code,
                location,
                quantity: actualQty,
                last_updated: new Date().toISOString()
            }, { onConflict: 'code,location' });

            await supabase.from('wms_history_logs').insert([{
                type: 'AUDIT',
                code,
                name: itemName,
                qty: actualQty,
                worker: newLog.worker,
                from_loc: location,
                to_loc: location,
                reason: newLog.reason
            }]);
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
        await supabase.from('wms_categories').insert([{ name }]);
    }
};

export const deleteCategory = async (name) => {
    state.categories = state.categories.filter(c => c !== name);
    saveStorage('categories', state.categories);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await supabase.from('wms_categories').delete().eq('name', name);
    }
};

export const addLocation = async (name) => {
    if (!name || state.locations.includes(name)) return;
    state.locations.push(name);
    saveStorage('locations', state.locations);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await supabase.from('wms_locations').insert([{ name }]);
    }
};

export const deleteLocation = async (name) => {
    state.locations = state.locations.filter(l => l !== name);
    saveStorage('locations', state.locations);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await supabase.from('wms_locations').delete().eq('name', name);
    }
};

export const saveWorker = async (worker) => {
    const idx = state.workers.findIndex(w => w.id === worker.id);
    if (idx >= 0) state.workers[idx] = worker;
    else state.workers.push(worker);
    saveStorage('workers', state.workers);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await supabase.from('wms_workers').upsert(worker);
    }
};

export const deleteWorker = async (id) => {
    state.workers = state.workers.filter(w => w.id !== id);
    saveStorage('workers', state.workers);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await supabase.from('wms_workers').delete().eq('id', id);
    }
};

export const saveUserAccount = async (user) => {
    const idx = state.users.findIndex(u => u.username === user.username);
    if (idx >= 0) state.users[idx] = { ...state.users[idx], ...user };
    else state.users.push(user);
    saveStorage('users', state.users);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await supabase.from('wms_users').upsert(user);
    }
};

export const deleteUserAccount = async (username) => {
    state.users = state.users.filter(u => u.username !== username);
    saveStorage('users', state.users);
    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await supabase.from('wms_users').delete().eq('username', username);
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
        try {
            await supabase.from('wms_schedules').upsert({
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
            });
        } catch (e) {
            console.warn('[DB] Supabase wms_schedules upsert 실패:', e);
        }
    }
    return schedule;
};

export const deleteSchedule = async (id) => {
    state.schedules = state.schedules.filter(s => s.id !== id);
    saveStorage('schedules', state.schedules);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        try {
            await supabase.from('wms_schedules').delete().eq('id', id);
        } catch (e) {
            console.warn('[DB] Supabase wms_schedules delete 실패:', e);
        }
    }
};

export const toggleScheduleStatus = async (id) => {
    const s = state.schedules.find(item => item.id === id);
    if (!s) return;
    s.status = s.status === 'DONE' ? 'TODO' : 'DONE';
    saveStorage('schedules', state.schedules);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        try {
            await supabase.from('wms_schedules').update({ status: s.status }).eq('id', id);
        } catch (e) {
            console.warn('[DB] Supabase wms_schedules status 토글 실패:', e);
        }
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
            try {
                await supabase.from('wms_inventory').update({
                    last_updated: new Date(dateStr).toISOString()
                }).match({ code, location });
            } catch (e) {
                console.warn('[DB] Supabase 재고 일자 갱신 실패:', e);
            }
        }
    }
};

export const syncAllLocalDataToSupabase = async (onProgress) => {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured()) {
        throw new Error('Supabase 클라우드 설정(URL 및 Anon Key)이 먼저 필요합니다.');
    }

    try {
        if (onProgress) onProgress({ step: '카테고리 동기화 중...', percent: 10 });
        if (state.categories.length > 0) {
            await supabase.from('wms_categories').upsert(
                state.categories.map(name => ({ name })),
                { onConflict: 'name' }
            );
        }

        if (onProgress) onProgress({ step: '거점 창고 동기화 중...', percent: 20 });
        if (state.locations.length > 0) {
            await supabase.from('wms_locations').upsert(
                state.locations.map(name => ({ name })),
                { onConflict: 'name' }
            );
        }

        if (onProgress) onProgress({ step: '작업자 및 사용자 계정 동기화 중...', percent: 30 });
        if (state.workers.length > 0) {
            await supabase.from('wms_workers').upsert(state.workers, { onConflict: 'id' });
        }
        if (state.users.length > 0) {
            await supabase.from('wms_users').upsert(state.users, { onConflict: 'username' });
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
            const { error } = await supabase.from('wms_master_items').upsert(chunk, { onConflict: 'code' });
            if (error) console.warn('[Supabase Sync Chunk Error]:', error);
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
            const { error } = await supabase.from('wms_inventory').upsert(chunk, { onConflict: 'code,location' });
            if (error) console.warn('[Supabase Inv Chunk Error]:', error);
        }

        // 일정 데이터 동기화
        if (state.schedules.length > 0) {
            try {
                if (onProgress) onProgress({ step: '일정 관리 데이터 동기화 중...', percent: 95 });
                await supabase.from('wms_schedules').upsert(state.schedules.map(s => ({
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
                })), { onConflict: 'id' });
            } catch (schedErr) {
                console.warn('[Supabase Sync Schedules Error]:', schedErr);
            }
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
            try {
                await supabase.from('wms_master_items').upsert({
                    code: newOfficialItem.code,
                    name: newOfficialItem.name,
                    category: newOfficialItem.category,
                    supplier: newOfficialItem.supplier,
                    spec: newOfficialItem.spec,
                    unit: newOfficialItem.unit,
                    safety: newOfficialItem.safety
                });
            } catch (e) {
                console.warn('[DB] 신규 품목 마스터 Supabase 동기화 생략:', e);
            }
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
        try {
            await supabase.from('wms_master_items').upsert({
                code: newTempItem.code,
                name: newTempItem.name,
                category: newTempItem.category,
                supplier: newTempItem.supplier,
                spec: newTempItem.spec,
                unit: newTempItem.unit,
                safety: 0
            });
        } catch (e) {
            console.warn('[DB] 임시코드 마스터 Supabase 동기화 생략:', e);
        }
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
        try {
            // 마스터 테이블 동기화
            if (isMerged) {
                await supabase.from('wms_master_items').delete().eq('code', oldCode);
            } else {
                const m = state.master.find(item => item.code === newCode);
                if (m) {
                    await supabase.from('wms_master_items').delete().eq('code', oldCode);
                    await supabase.from('wms_master_items').upsert({
                        code: m.code,
                        name: m.name,
                        category: m.category,
                        supplier: m.supplier,
                        spec: m.spec,
                        unit: m.unit,
                        safety: m.safety
                    });
                }
            }

            // 재고(wms_inventory) 동기화 및 수량 합산 처리
            const { data: oldInvs } = await supabase.from('wms_inventory').select('*').eq('code', oldCode);
            if (oldInvs && oldInvs.length > 0) {
                for (const oldInv of oldInvs) {
                    const { data: targetInvs } = await supabase.from('wms_inventory').select('*').eq('code', newCode).eq('location', oldInv.location);
                    if (targetInvs && targetInvs.length > 0) {
                        const targetInv = targetInvs[0];
                        const newQty = (Number(targetInv.quantity) || 0) + (Number(oldInv.quantity) || 0);
                        await supabase.from('wms_inventory').update({ quantity: newQty, last_updated: new Date().toISOString() }).eq('id', targetInv.id);
                        await supabase.from('wms_inventory').delete().eq('id', oldInv.id);
                    } else {
                        await supabase.from('wms_inventory').update({ code: newCode, last_updated: new Date().toISOString() }).eq('id', oldInv.id);
                    }
                }
            }

            // 수불 이력(wms_history_logs) 동기화
            await supabase.from('wms_history_logs').update({ code: newCode, name: finalName }).eq('code', oldCode);
        } catch (e) {
            console.warn('[DB] 품목코드 전환 Supabase 동기화 경고:', e);
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
                // 출고 시 재고 부족 오류 발생할 경우 가상 입고 후 정상 출고 처리
                let inv = state.inventory.find(i => i.code === res.item.code && i.location === '김포공장');
                if (!inv) {
                    state.inventory.push({
                        category: res.item.category || '완제품',
                        code: res.item.code,
                        name: res.item.name,
                        supplier: res.item.supplier || '-',
                        spec: res.item.spec || '-',
                        location: '김포공장',
                        quantity: item.qty,
                        unit: res.item.unit || 'EA',
                        status: '정상 보관',
                        lastUpdated: new Date().toLocaleString('ko-KR')
                    });
                } else if (inv.quantity < item.qty) {
                    inv.quantity = item.qty;
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
