// ==========================================
// 원액생산 작업지시서 (특별보안) 데이터
// ==========================================
// - 제조시방서(wms_recipes): 원료 실명·배합비·원료코드. 작업지시서(wms_secure_work_orders): 작업일지 내용.
// - 접근은 마스터와 작업일지 관리자만 (DB RLS: wms_has_worklog_access). 화면 권한 검사는 표시용이다.
// - 클라우드 모드에서는 배합 자료를 브라우저 저장소(localStorage)에 남기지 않고 메모리에만 둔다.
//   (같은 PC를 다른 사용자가 써도 개발자 도구로 배합 정보를 볼 수 없게)
// - Supabase가 없는 로컬 모드에서만 localStorage(daelim_secure_*)에 저장한다.
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state, processProductionInbound } from './db.js';
import { localDateStr } from './searchUtils.js';

const cloud = () => {
    const sb = getSupabase();
    return sb && isSupabaseConfigured() ? sb : null;
};

export const secure = {
    recipes: [],
    orders: [],
    loaded: false
};

const LOCAL_KEYS = { recipes: 'daelim_secure_recipes', orders: 'daelim_secure_orders', recipeRevisions: 'daelim_secure_recipe_revisions' };
const loadLocal = (key) => { try { return JSON.parse(localStorage.getItem(LOCAL_KEYS[key]) || '[]'); } catch { return []; } };
const saveLocal = (key) => { try { localStorage.setItem(LOCAL_KEYS[key], JSON.stringify(secure[key])); } catch (e) { console.warn('[보안] 로컬 저장 실패', e); } };
let localRevisions = null; // 로컬 모드에서만 씀 (메모리 캐시, 클라우드 모드는 secure.recipes처럼 화면 진입마다 조회)
const loadLocalRevisions = () => { if (!localRevisions) localRevisions = loadLocal('recipeRevisions'); return localRevisions; };
const saveLocalRevisions = () => { try { localStorage.setItem(LOCAL_KEYS.recipeRevisions, JSON.stringify(localRevisions || [])); } catch (e) { console.warn('[보안] 로컬 저장 실패', e); } };

const recipeFromRow = (r) => ({
    id: r.id,
    productName: r.product_name,
    category: r.category || '',        // 분류 (예: 엔진오일, 엔진코팅제, 첨가제)
    subCategory: r.sub_category || '', // 종류 (분류 아래 세부 분류)
    revision: r.revision || '',
    baseQty: Number(r.base_qty) || 1,
    baseUnit: r.base_unit || 'D/M',
    baseLiters: Number(r.base_liters) || 0,
    productItemCode: r.product_item_code || '',
    materials: r.materials || [],
    workStandard: r.work_standard || [],
    history: r.history || [],
    brands: r.brands || [],
    qcItems: r.qc_items || [],
    docNo: r.doc_no || '',
    author: r.author || '',
    sourceFile: r.source_file || '',
    active: r.active !== false,
    createdAt: r.created_at,
    updatedAt: r.updated_at
});

const recipeToRow = (x) => ({
    id: x.id,
    product_name: x.productName,
    category: String(x.category || '').trim() || null,
    sub_category: String(x.subCategory || '').trim() || null,
    revision: x.revision || null,
    base_qty: Number(x.baseQty) || 1,
    base_unit: x.baseUnit || 'D/M',
    base_liters: Number(x.baseLiters) || null,
    product_item_code: x.productItemCode || null,
    materials: x.materials || [],
    work_standard: x.workStandard || [],
    history: x.history || [],
    brands: x.brands || [],
    qc_items: x.qcItems || [],
    doc_no: x.docNo || null,
    author: x.author || null,
    source_file: x.sourceFile || null,
    active: x.active !== false,
    updated_at: new Date().toISOString()
});

const orderFromRow = (r) => ({ ...(r.data || {}), id: r.id, orderNo: r.order_no, recipeId: r.recipe_id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });
const orderToRow = (o) => {
    const { id, orderNo, recipeId, status, createdAt, updatedAt, ...data } = o;
    return { id, order_no: orderNo, recipe_id: recipeId || null, status: status || 'ISSUED', data, updated_at: new Date().toISOString() };
};

const fail = (error, what) => {
    const msg = error?.message || String(error);
    if (/row-level security|permission denied/i.test(msg)) throw new Error(`${what} 권한이 없습니다. 마스터 관리자에게 '작업일지 관리자' 권한을 요청하세요.`);
    throw new Error(`${what} 실패: ${msg}`);
};

// 전체 불러오기 (메뉴를 열 때마다 최신으로)
export const loadSecureData = async () => {
    const sb = cloud();
    if (!sb) {
        secure.recipes = loadLocal('recipes');
        secure.orders = loadLocal('orders');
        secure.loaded = true;
        return secure;
    }
    const [rRes, oRes] = await Promise.all([
        sb.from('wms_recipes').select('*').order('product_name').order('created_at', { ascending: false }),
        sb.from('wms_secure_work_orders').select('*').order('created_at', { ascending: false })
    ]);
    if (rRes.error) fail(rRes.error, '제조시방서 조회');
    if (oRes.error) fail(oRes.error, '작업지시서 조회');
    secure.recipes = (rRes.data || []).map(recipeFromRow);
    secure.orders = (oRes.data || []).map(orderFromRow);
    secure.loaded = true;
    return secure;
};

// 로그아웃 등으로 메뉴를 떠날 때 메모리에서 지움
export const clearSecureData = () => {
    secure.recipes = [];
    secure.orders = [];
    secure.loaded = false;
};

const newId = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// 시방서를 덮어쓰기 전, 바뀌기 직전 내용을 스냅샷으로 남긴다 (개정이력·되돌리기용).
// 신규 등록(이전 내용 없음)일 때는 남길 것이 없으므로 건너뛴다.
const snapshotRecipe = async (prevRecipe, note) => {
    if (!prevRecipe) return;
    const snap = {
        id: newId('RCPREV'),
        recipeId: prevRecipe.id,
        note: note || '',
        author: state.currentUser?.name || '',
        snapshot: { ...prevRecipe },
        createdAt: new Date().toISOString()
    };
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_recipe_revisions').insert({
            id: snap.id, recipe_id: snap.recipeId, note: snap.note || null,
            snapshot: snap.snapshot, created_at: snap.createdAt
        });
        if (error) console.warn('[보안] 개정이력 저장 실패', error.message);
    } else {
        const list = loadLocalRevisions();
        list.unshift(snap);
        saveLocalRevisions();
    }
};

// 제조시방서의 개정이력(자동 스냅샷) 조회. 최신순.
export const listRecipeRevisions = async (recipeId) => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_recipe_revisions').select('*').eq('recipe_id', recipeId).order('created_at', { ascending: false });
        if (error) fail(error, '개정이력 조회');
        return (data || []).map(r => ({ id: r.id, recipeId: r.recipe_id, note: r.note || '', snapshot: r.snapshot, createdAt: r.created_at }));
    }
    return loadLocalRevisions().filter(r => r.recipeId === recipeId);
};

// 개정이력의 특정 시점으로 되돌린다. 되돌리기 직전 상태도 새 스냅샷으로 남는다.
export const restoreRecipeRevision = async (recipeId, revisionId) => {
    const revisions = await listRecipeRevisions(recipeId);
    const rev = revisions.find(r => r.id === revisionId);
    if (!rev) throw new Error('되돌릴 개정이력을 찾을 수 없습니다.');
    const current = secure.recipes.find(r => r.id === recipeId);
    if (!current) throw new Error('시방서를 찾을 수 없습니다.');
    return saveRecipe({ ...rev.snapshot, id: recipeId }, `되돌리기 (${rev.createdAt?.slice(0, 16).replace('T', ' ')} 이전으로)`);
};

export const saveRecipe = async (recipe, revisionNote) => {
    const x = { ...recipe, id: recipe.id || newId('RCP') };
    const prev = secure.recipes.find(r => r.id === x.id);
    if (prev) await snapshotRecipe(prev, revisionNote);
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_recipes').upsert(recipeToRow(x), { onConflict: 'id' }).select('*').single();
        if (error) fail(error, '제조시방서 저장');
        Object.assign(x, recipeFromRow(data));
    } else {
        x.updatedAt = new Date().toISOString();
    }
    const i = secure.recipes.findIndex(r => r.id === x.id);
    if (i >= 0) secure.recipes[i] = x; else secure.recipes.unshift(x);
    if (!sb) saveLocal('recipes');
    return x;
};

export const deleteRecipe = async (id) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_recipes').delete().eq('id', id);
        if (error) fail(error, '제조시방서 삭제');
    }
    secure.recipes = secure.recipes.filter(r => r.id !== id);
    if (!sb) saveLocal('recipes');
};

// 작업지시서 번호: WO-YYYYMMDD-NN (같은 날 순번)
export const nextOrderNo = (date = localDateStr()) => {
    const prefix = `WO-${date.replace(/-/g, '')}-`;
    const used = secure.orders.map(o => o.orderNo).filter(n => n?.startsWith(prefix)).map(n => Number(n.slice(prefix.length)) || 0);
    return `${prefix}${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
};

export const saveSecureOrder = async (order) => {
    const o = { ...order, id: order.id || newId('SWO'), status: order.status || 'ISSUED' };
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_secure_work_orders').upsert(orderToRow(o), { onConflict: 'id' }).select('*').single();
        if (error) fail(error, '작업지시서 저장');
        Object.assign(o, orderFromRow(data));
    } else {
        o.createdAt = o.createdAt || new Date().toISOString();
        o.updatedAt = new Date().toISOString();
    }
    const i = secure.orders.findIndex(x => x.id === o.id);
    if (i >= 0) secure.orders[i] = o; else secure.orders.unshift(o);
    if (!sb) saveLocal('orders');
    return o;
};

export const deleteSecureOrder = async (id) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_secure_work_orders').delete().eq('id', id);
        if (error) fail(error, '작업지시서 삭제');
    }
    secure.orders = secure.orders.filter(o => o.id !== id);
    if (!sb) saveLocal('orders');
};

// 시방서 기준 → 생산량 만큼 원료 소요량 산출
export const scaleMaterials = (recipe, prodQty) => {
    const factor = (Number(prodQty) || 0) / (Number(recipe.baseQty) || 1);
    const r3 = (n) => (n === null || n === undefined ? null : Math.round(n * factor * 1000) / 1000);
    return (recipe.materials || []).map(m => ({
        seq: m.seq,
        stage: m.stage || '',
        rawCode: m.rawCode || '',
        name: m.name,
        itemCode: m.itemCode || '',
        sg: m.sg,
        wtPct: m.wtPct,
        liters: r3(m.liters),
        kg: r3(m.kg)
    }));
};

/**
 * 생산 완료: 품목코드가 연결된 원료만 재고·원료수불부에서 차감하고, 원액 품목이 연결되어 있으면 원액을 입고한다.
 * 기록(입출고 이력·수불부)에는 원료 실명 대신 원료코드를 남긴다.
 */
export const completeSecureOrder = async (order, { actualQty, location, worker }) => {
    const recipe = secure.recipes.find(r => r.id === order.recipeId);
    const qty = Number(actualQty) || Number(order.prodQty) || 0;
    if (!(qty > 0)) throw new Error('실생산량을 입력하세요.');
    const mats = scaleMaterials({ ...(recipe || {}), materials: order.materials || recipe?.materials || [], baseQty: order.prodQty || 1 }, qty)
        .map((m, i) => ({ ...m, itemCode: (recipe?.materials || []).find(x => x.seq === m.seq)?.itemCode || order.materials?.[i]?.itemCode || '' }));
    const linked = mats.filter(m => m.itemCode && m.liters > 0);
    const productItemCode = recipe?.productItemCode || order.productItemCode || '';
    const liters = Math.round((Number(order.baseLitersPerUnit) || (recipe ? recipe.baseLiters / (recipe.baseQty || 1) : 0)) * qty * 1000) / 1000;

    let inventoryApplied = false;
    if (productItemCode && liters > 0) {
        await processProductionInbound({
            prodType: '원액',
            prodItemCode: productItemCode,
            prodQty: liters,
            packaging: `${qty} ${order.prodUnit || 'D/M'}`,
            unit: 'L',
            lotNo: order.lotNo || order.orderNo,
            mfgDate: order.mfgDate || localDateStr(),
            location: location || '김포공장',
            worker: worker || state.currentGlobalWorker,
            bomDeducted: linked.length > 0,
            bomDetails: linked.map(m => ({
                code: m.itemCode,
                name: m.rawCode || m.itemCode, // 이력·수불부에 원료 실명을 남기지 않음
                qty: m.liters,
                unit: 'L',
                location: location || '김포공장',
                matType: '원료'
            })),
            workOrderNo: order.orderNo,
            notes: `원액생산 작업지시서 ${order.orderNo}`
        });
        inventoryApplied = true;
    }

    const done = await saveSecureOrder({
        ...order,
        status: 'COMPLETED',
        actualQty: qty,
        completedAt: new Date().toISOString(),
        completion: {
            inventoryApplied,
            location: location || '김포공장',
            liters,
            deductedCount: inventoryApplied ? linked.length : 0,
            unlinkedCount: mats.length - linked.length
        }
    });
    return { order: done, inventoryApplied, linkedCount: linked.length, unlinkedCount: mats.length - linked.length, liters };
};
