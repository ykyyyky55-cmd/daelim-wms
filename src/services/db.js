import { getSupabase, isSupabaseConfigured } from './supabase.js';
import enterpriseData from '../data/enterpriseData.json';

// 기본 초기 데모 데이터 (enterpriseData가 기본 실물 데이터로 사용됩니다)
const DEFAULT_CATEGORIES = enterpriseData.categories || ["완제품", "원료", "부자재", "소모품"];
const DEFAULT_LOCATIONS = enterpriseData.locations || ["본사 창고", "김포공장", "방산 창고", "대림오일 창고"];
const DEFAULT_WORKERS = enterpriseData.workers || [
    { id: "EMP-001", name: "홍길동", dept: "물류관리팀", role: "관리자" },
    { id: "EMP-002", name: "김생산", dept: "생산조립2팀", role: "생산기사" },
    { id: "EMP-003", name: "이물류", dept: "자재운영팀", role: "반장" },
    { id: "EMP-004", name: "박품질", dept: "품질보증팀", role: "주임" }
];
const DEFAULT_USERS = enterpriseData.users || [
    { id: "admin", name: "관리자", username: "admin", password: "admin123", role: "ADMIN", dept: "물류관리팀", title: "총괄 관리자" },
    { id: "manager", name: "김물류", username: "manager", password: "manager123", role: "MANAGER", dept: "자재운영팀", title: "물류 반장" },
    { id: "worker", name: "이작업", username: "worker", password: "worker123", role: "OPERATOR", dept: "생산조립팀", title: "현장 기사" }
];
const DEFAULT_MASTER = enterpriseData.master;
const DEFAULT_INVENTORY = enterpriseData.inventory;
const DEFAULT_HISTORY = enterpriseData.history;

// 로컬 스토리지 헬퍼
const loadStorage = (key, defaultVal) => {
    try {
        const item = localStorage.getItem(`daelim_${key}`);
        if (!item) return defaultVal;
        const parsed = JSON.parse(item);
        // 만약 기존 로컬스토리지에 예전 4개 샘플 데이터만 있다면 최신 실제 기업 데이터(2497건)로 업그레이드
        if (key === 'master' && Array.isArray(parsed) && parsed.length <= 4) {
            return defaultVal;
        }
        if (key === 'inventory' && Array.isArray(parsed) && parsed.length <= 4) {
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
    "HD현대오일뱅크"
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
        worker: "홍길동 (관리자)",
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

// 메모리 인-메모리 캐시
export const state = {
    categories: loadStorage('categories', DEFAULT_CATEGORIES),
    locations: loadStorage('locations', DEFAULT_LOCATIONS),
    partners: loadStorage('partners', DEFAULT_PARTNERS),
    workers: loadStorage('workers', DEFAULT_WORKERS),
    users: loadStorage('users', DEFAULT_USERS),
    currentUser: loadStorage('currentUser', DEFAULT_USERS[0]),
    currentGlobalWorker: loadStorage('currentWorker', "홍길동 (관리자)"),
    master: loadStorage('master', DEFAULT_MASTER),
    inventory: loadStorage('inventory', DEFAULT_INVENTORY),
    history: loadStorage('history', DEFAULT_HISTORY),
    productions: loadStorage('productions', DEFAULT_PRODUCTIONS),
    beginningStock: loadStorage('beginningStock', {}),
    schedules: loadStorage('schedules', DEFAULT_SCHEDULES),
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
    const existingIdx = state.master.findIndex(m => m.code === item.code);
    if (existingIdx >= 0) {
        state.master[existingIdx] = { ...state.master[existingIdx], ...item };
    } else {
        state.master.push(item);
    }
    saveStorage('master', state.master);

    const supabase = getSupabase();
    if (supabase && isSupabaseConfigured()) {
        await supabase.from('wms_master_items').upsert({
            code: item.code,
            name: item.name,
            category: item.category,
            supplier: item.supplier,
            spec: item.spec,
            unit: item.unit || 'EA',
            safety: Number(item.safety) || 0
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
// 제품 생산 입고 처리 (Production Inbound)
// ==========================================
export const processProductionInbound = async ({
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
    notes = ''
}) => {
    prodQty = Number(prodQty);
    if (!prodQty || prodQty <= 0) throw new Error('유효한 생산 수량을 입력하세요.');
    if (!prodItemCode) throw new Error('생산 완제품 품목을 선택하세요.');
    if (!lotNo) throw new Error('생산 LOT 번호를 입력하세요.');

    const masterItem = state.master.find(m => m.code === prodItemCode);
    const itemName = masterItem ? masterItem.name : prodItemCode;
    const nowStr = new Date().toLocaleString('ko-KR');
    const operator = worker || state.currentGlobalWorker;

    // 1. 원부자재 소모(BOM) 차감 검증 및 실행
    if (bomDeducted && Array.isArray(bomDetails) && bomDetails.length > 0) {
        for (const bom of bomDetails) {
            const bQty = Number(bom.qty);
            if (bQty > 0) {
                const targetLoc = bom.location || location;
                const inv = state.inventory.find(i => i.code === bom.code && i.location === targetLoc);
                if (!inv || inv.quantity < bQty) {
                    throw new Error(`[원부자재 부족] '${bom.name || bom.code}'의 ${targetLoc} 현재 재고(${inv ? inv.quantity : 0})가 소모량(${bQty})보다 부족합니다.`);
                }
            }
        }

        // 실제 차감 및 이력 기록
        for (const bom of bomDetails) {
            const bQty = Number(bom.qty);
            if (bQty > 0) {
                const targetLoc = bom.location || location;
                const inv = state.inventory.find(i => i.code === bom.code && i.location === targetLoc);
                inv.quantity -= bQty;
                inv.lastUpdated = nowStr;

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
                    reason: `생산 투입 소모 [${lotNo}] - ${itemName} 생산`,
                    notes: `완제품 ${itemName} ${prodQty}개 생산을 위한 원료/부자재 투입 차감`
                };
                state.history.unshift(bomLog);
            }
        }
    }

    // 2. 완제품 재고 증가
    let prodInv = state.inventory.find(i => i.code === prodItemCode && i.location === location);
    if (prodInv) {
        prodInv.quantity += prodQty;
        prodInv.lastUpdated = nowStr;
    } else {
        prodInv = {
            category: masterItem?.category || '완제품',
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

    // 3. 완제품 입고 이력 로그 생성
    const prodInLog = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        timestamp: nowStr,
        type: 'IN',
        code: prodItemCode,
        name: itemName,
        qty: prodQty,
        worker: operator,
        fromLoc: '생산라인 (대림오일 공장)',
        toLoc: location,
        reason: `제품 생산 입고 [${lotNo}] (${packaging})`,
        notes: `제조: ${mfgDate || '-'}, 유효: ${expDate || '-'} | ${notes || '품질검사 합격'}`
    };
    state.history.unshift(prodInLog);

    // 4. 생산 실적 마스터 레코드 등록
    const newProduction = {
        id: `PROD-${Date.now()}`,
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
        bomDeducted,
        bomDetails,
        notes
    };

    if (!state.productions) state.productions = [];
    state.productions.unshift(newProduction);

    // 5. 로컬스토리지 저장
    saveStorage('inventory', state.inventory);
    saveStorage('history', state.history);
    saveStorage('productions', state.productions);

    // 6. Supabase 동기화 (설정된 경우)
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
                        from_loc: '생산라인 (대림오일 공장)',
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

