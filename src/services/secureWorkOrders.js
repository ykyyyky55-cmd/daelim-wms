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
import { siteOf } from './locations.js';
import { cmpRev } from './specFolderImport.js';
import { reflectBlendProduction } from './prodReflect.js';

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
    archived: r.archived === true,      // 구버전 보관함으로 직접 옮김
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
    archived: x.archived === true,
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

// Postgres 외래키 위반 코드: 개정이력의 recipe_id가 가리키는 시방서가 DB에 없음
const FOREIGN_KEY_VIOLATION = '23503';

/** @type {((productName: string, message: string) => void) | null} */
let snapshotFailureListener = null;

/**
 * 개정이력 스냅샷 저장이 실패했을 때 화면에 알릴 함수를 등록한다. (시방서 저장 자체는 계속 진행)
 * @param {((productName: string, message: string) => void) | null} listener
 */
export const onSnapshotFailure = (listener) => { snapshotFailureListener = listener; };

// 시방서를 덮어쓰기 전, 바뀌기 직전 내용을 스냅샷으로 남긴다 (개정이력·되돌리기용).
// 신규 등록(이전 내용 없음)일 때는 남길 것이 없으므로 건너뛴다.
// 시방서가 다른 기기에서 이미 삭제됐으면(외래키 위반) 저장을 멈춘다 — 이어서 upsert하면 지운 시방서가 되살아나기 때문.
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
        if (error?.code === FOREIGN_KEY_VIOLATION) {
            throw new Error(`'${prevRecipe.productName}' 시방서는 다른 곳에서 이미 삭제되었습니다. 화면을 새로고침한 뒤 다시 확인하세요.`);
        }
        if (error) {
            console.warn('[보안] 개정이력 저장 실패', error.message);
            snapshotFailureListener?.(prevRecipe.productName || '', error.message);
        }
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

// opts.snapshot=false: 재고 연결 같은 연결 정보만 바꿀 때 개정이력 스냅샷을 남기지 않는다 (배합 내용은 그대로)
export const saveRecipe = async (recipe, revisionNote, { snapshot = true } = {}) => {
    const x = { ...recipe, id: recipe.id || newId('RCP') };
    const prev = secure.recipes.find(r => r.id === x.id);
    if (prev && snapshot) await snapshotRecipe(prev, revisionNote);
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

// 백업 복원: 같은 id는 백업 내용으로 덮어쓰고, 없는 것은 추가한다 (백업에 없는 기존 자료는 그대로 둔다).
// 복원 직전 상태는 화면에서 먼저 백업 파일로 받아 두므로 개정이력 스냅샷은 남기지 않는다.
export const restoreSecureData = async ({ recipes = [], orders = [] } = {}, onProgress = () => {}) => {
    const sb = cloud();
    const total = recipes.length + orders.length;
    let done = 0;
    if (sb) {
        for (let i = 0; i < recipes.length; i += 100) {
            const { error } = await sb.from('wms_recipes').upsert(recipes.slice(i, i + 100).map(recipeToRow), { onConflict: 'id' });
            if (error) fail(error, '제조시방서 복원');
            done += Math.min(100, recipes.length - i);
            onProgress(done, total);
        }
        for (let i = 0; i < orders.length; i += 100) {
            const { error } = await sb.from('wms_secure_work_orders').upsert(orders.slice(i, i + 100).map(orderToRow), { onConflict: 'id' });
            if (error) fail(error, '작업지시서 복원 (지시번호가 다른 지시서와 겹치면 복원되지 않습니다)');
            done += Math.min(100, orders.length - i);
            onProgress(done, total);
        }
        await loadSecureData();
    } else {
        const merge = (cur, add) => { const m = new Map(cur.map(x => [x.id, x])); add.forEach(x => m.set(x.id, x)); return [...m.values()]; };
        secure.recipes = merge(loadLocal('recipes'), recipes);
        secure.orders = merge(loadLocal('orders'), orders);
        saveLocal('recipes');
        saveLocal('orders');
        secure.loaded = true;
        onProgress(total, total);
    }
    return { recipes: recipes.length, orders: orders.length };
};

// 제조시방서 삭제 (작업지시서·배합비는 지우지 않음).
// 지시서가 시방서의 현재 연결을 쓰므로, 지우기 전에 시방서의 원액 품목·원료 재고 연결·분류를 지시서 안에 복사하고
// 지시서의 시방서 연결(recipeId)을 끊는다. 생산 완료·취소된 지시서의 원료 기록은 그대로 둔다.
export const deleteRecipesKeepOrders = async (ids, onProgress = () => {}) => {
    const idSet = new Set(ids);
    const byId = new Map(secure.recipes.map(r => [r.id, r]));
    const detached = secure.orders.filter(o => idSet.has(o.recipeId)).map(o => {
        const r = byId.get(o.recipeId);
        const open = o.status !== 'COMPLETED' && o.status !== 'CANCELLED';
        return {
            ...o,
            recipeId: null,
            productItemCode: r?.productItemCode || o.productItemCode || '',
            category: r?.category || o.category || '',
            subCategory: r?.subCategory || o.subCategory || '',
            recipeDeleted: { productName: r?.productName || o.productName || '', revision: r?.revision || o.revision || '', at: new Date().toISOString() },
            materials: open
                ? (o.materials || []).map(m => ({ ...m, itemCode: (r?.materials || []).find(x => x.seq === m.seq)?.itemCode || m.itemCode || '' }))
                : o.materials
        };
    });
    const total = detached.length + ids.length;
    const sb = cloud();
    if (sb) {
        for (let i = 0; i < detached.length; i += 100) {
            const { error } = await sb.from('wms_secure_work_orders').upsert(detached.slice(i, i + 100).map(orderToRow), { onConflict: 'id' });
            if (error) fail(error, '작업지시서 연결 정보 보존');
            onProgress(Math.min(i + 100, detached.length), total);
        }
        for (let i = 0; i < ids.length; i += 100) {
            const { error } = await sb.from('wms_recipes').delete().in('id', ids.slice(i, i + 100));
            if (error) fail(error, '제조시방서 삭제');
            onProgress(detached.length + Math.min(i + 100, ids.length), total);
        }
    }
    const det = new Map(detached.map(o => [o.id, o]));
    secure.orders = secure.orders.map(o => det.get(o.id) || o);
    const removedProducts = new Set(secure.recipes.filter(r => idSet.has(r.id)).map(r => String(r.productName || '').trim()));
    secure.recipes = secure.recipes.filter(r => !idSet.has(r.id));
    if (!sb) { saveLocal('orders'); saveLocal('recipes'); }
    // 사용 중인 리비전을 지워 그 제품에 사용 중인 시방서가 없어지면, 남은 리비전 중 최신(보관함 제외)을 사용으로 ('구버전으로 옮기기'와 같은 규칙)
    const activated = [];
    for (const name of removedProducts) {
        const left = secure.recipes.filter(r => String(r.productName || '').trim() === name && !r.archived);
        if (!left.length || left.some(r => r.active)) continue;
        const latest = left.reduce((a, b) => (cmpRev(b, a) > 0 ? b : a));
        await saveRecipe({ ...latest, active: true }, '최신 리비전 사용 (사용 중이던 리비전 삭제)', { snapshot: false });
        activated.push(`${latest.productName} ${latest.revision || ''}`.trim());
    }
    return { recipes: ids.length, ordersKept: detached.length, activated };
};

// 작업지시서 일괄 삭제 (제조시방서·배합비·재고·수불부 기록은 그대로)
export const deleteSecureOrders = async (ids, onProgress = () => {}) => {
    const sb = cloud();
    if (sb) {
        for (let i = 0; i < ids.length; i += 100) {
            const { error } = await sb.from('wms_secure_work_orders').delete().in('id', ids.slice(i, i + 100));
            if (error) fail(error, '작업지시서 삭제');
            onProgress(Math.min(i + 100, ids.length), ids.length);
        }
    }
    const idSet = new Set(ids);
    secure.orders = secure.orders.filter(o => !idSet.has(o.id));
    if (!sb) saveLocal('orders');
    return ids.length;
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
                // 원료는 원액을 입고하는 창고가 아니라 그 거점의 재고에서 꺼낸다 (창고 미지정 = 거점 전체, db.js allocateMaterialStock)
                location: siteOf(location || '김포공장') || '김포공장',
                matType: '원료'
            })),
            workOrderNo: order.orderNo,
            notes: `원액생산 작업지시서 ${order.orderNo}`
        });
        inventoryApplied = true;
        // 입고 거점 업무일지 '원액생산작업'에도 한 줄 (재고는 이미 반영 — stockDone)
        await reflectBlendProduction({ itemCode: productItemCode, qty: liters, packaging: `${qty} ${order.prodUnit || 'D/M'}`, lot: order.lotNo || order.orderNo, date: order.mfgDate || localDateStr(), location: location || '김포공장', worker: worker || state.currentGlobalWorker })
            .catch(e => console.warn('[작업지시서] 업무일지 반영 실패:', e.message));
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
