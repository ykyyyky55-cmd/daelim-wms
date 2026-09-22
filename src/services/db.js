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
    beginningStock: loadStorage('beginningStock', {}),
    schedules: loadStorage('schedules', enterpriseData.schedules || []),
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
// 재고 실사 보정 (Audit Commit)
// ==========================================
export const commitStockAudit = async (auditMap, workerName) => {
    const keys = Object.keys(auditMap);
    if (keys.length === 0) return;

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
            invItem.lastUpdated = new Date().toLocaleString('ko-KR');
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
                lastUpdated: new Date().toLocaleString('ko-KR')
            };
            state.inventory.push(invItem);
        }

        // 실사 이력 추가
        const newLog = {
            id: Date.now() + Math.random(),
            timestamp: new Date().toLocaleString('ko-KR'),
            type: 'AUDIT',
            code,
            name: itemName,
            qty: actualQty,
            worker: workerName || state.currentGlobalWorker,
            fromLoc: location,
            toLoc: location,
            reason: `[실사 오차 ${diff > 0 ? '+' : ''}${diff}EA 반영] ${reason || '정기 실사 전산조정'}`
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
            const currentPct = 70 + Math.round(((i + chunk.length) / totalInv) * 25);
            if (onProgress) onProgress({ step: `창고 재고 업로드 중 (${Math.min(i + chunkSize, totalInv)} / ${totalInv})...`, percent: currentPct });
            const { error } = await supabase.from('wms_inventory').upsert(chunk, { onConflict: 'code,location' });
            if (error) console.warn('[Supabase Inv Chunk Error]:', error);
        }

        if (onProgress) onProgress({ step: 'Supabase 클라우드 전체 업로드 완료!', percent: 100 });
        return { success: true, countItems: totalItems, countInv: totalInv };
    } catch (err) {
        console.error('[Supabase Sync Failed]:', err);
        throw err;
    }
};

