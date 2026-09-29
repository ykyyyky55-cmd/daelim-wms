// ==========================================
// 드럼 라벨(폼텍 3120) 목록·출력 이력 클라우드 공유 (supabase/auth/52_drum_labels.sql)
// ==========================================
// - 라벨 한 줄 = wms_drum_labels 한 행. 화면(LabelPrinter)은 예전처럼 배열을 고치고 saveData()를 부르면,
//   여기서 마지막으로 맞춘 내용과 비교해 바뀐 라벨만 모아(0.8초 뒤) 올리고 없어진 라벨은 지운다.
// - 이미 있는 라벨을 다시 올릴 때는 내용(data)만 고치고 순서(sort_order)는 건드리지 않는다
//   (새 라벨을 추가하며 다른 PC가 고친 라벨을 옛 내용으로 덮어쓰지 않도록).
// - 체크박스 선택(checked)은 PC마다 따로 둔다 (daelim_drum_label_checked). 한 사람이 고른 라벨이 다른 PC에서 선택되면 안 된다.
// - 로컬 모드(클라우드 미설정)는 아무것도 하지 않는다 (화면이 localStorage에 저장).
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';

const TABLE = 'wms_drum_labels';
const PRINT_TABLE = 'wms_drum_label_prints';
const SYNCED_KEY = 'daelim_drum_labels_synced';   // { id: 마지막으로 클라우드와 맞춘 내용 JSON }
const CHECKED_KEY = 'daelim_drum_label_checked';  // { id: true } 이 PC에서 고른 라벨
const SYNC_DELAY_MS = 800;
const BATCH = 200;

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
export const isDrumLabelCloud = () => !!cloud();
const me = () => state.currentUser?.name || '';

const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch (e) { console.warn(`[드럼 라벨] ${key} 읽기 실패`, e); return fallback; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn(`[드럼 라벨] ${key} 저장 실패`, e); } };

/** 공유하는 내용 (선택 여부는 빼고) */
const contentOf = (item) => { const { checked: _c, ...rest } = item; return rest; };
const keyOf = (item) => String(item.id);
const jsonOf = (item) => JSON.stringify(contentOf(item));

/** 이 PC의 선택 상태를 라벨에 입힌다 */
export const applyLocalSelection = (list) => {
    const checked = readJson(CHECKED_KEY, {});
    return list.map(item => ({ ...item, checked: !!checked[keyOf(item)] }));
};
const saveLocalSelection = (list) => writeJson(CHECKED_KEY, Object.fromEntries(list.filter(x => x.checked).map(x => [keyOf(x), true])));

let synced = null;        // Map(id → JSON). null이면 이번 세션에 클라우드와 맞춘 적 없음 → 올리지 않는다
let timer = null;
let latestList = null;
let flushing = null;
let onErrorListener = null;
/** 올리기 실패를 화면에 알릴 함수 */
export const onDrumLabelSyncError = (fn) => { onErrorListener = fn; };

const fetchAll = async (sb) => {
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from(TABLE).select('id, sort_order, data').order('sort_order').order('id').range(from, from + 999);
        if (error) throw new Error(`라벨 목록을 불러오지 못했습니다: ${error.message}`);
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    return rows;
};

const insertRows = async (sb, items, startSort) => {
    for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH).map((it, j) => ({ id: keyOf(it), sort_order: startSort + i + j, data: contentOf(it), updated_at: new Date().toISOString(), updated_by_name: me() }));
        const { error } = await sb.from(TABLE).upsert(batch, { onConflict: 'id' });
        if (error) throw new Error(`라벨을 올리지 못했습니다: ${error.message}`);
    }
};

/**
 * 화면을 열 때: 클라우드 목록을 받아 이 PC에만 있던 라벨을 더해 돌려준다.
 * @param {Object[]} localList 이 PC의 목록 (localStorage)
 * @param {(id: *) => boolean} isDefaultId 앱 기본 라벨 id인지 (클라우드에서 지운 기본 라벨을 되살리지 않도록)
 * @returns {Promise<{ list: Object[], uploaded: number } | null>} 로컬 모드면 null
 */
export const loadDrumLabels = async (localList, isDefaultId = () => false) => {
    const sb = cloud();
    if (!sb) return null;
    const rows = await fetchAll(sb);
    const remote = rows.map(r => ({ ...(r.data || {}), id: r.data?.id ?? r.id }));
    const remoteIds = new Set(rows.map(r => r.id));
    const syncedBefore = readJson(SYNCED_KEY, {});
    let toUpload;
    if (rows.length === 0) {
        toUpload = localList; // 처음 쓰는 회사 목록: 이 PC 목록을 그대로 올린다
    } else {
        // 이 PC에서 만들고 아직 못 올린 라벨만 (다른 PC에서 지운 라벨·기본 라벨은 되살리지 않음)
        toUpload = localList.filter(x => !remoteIds.has(keyOf(x)) && !(keyOf(x) in syncedBefore) && !isDefaultId(x.id));
    }
    if (toUpload.length) {
        const minSort = rows.length ? Math.min(...rows.map(r => r.sort_order)) : 0;
        await insertRows(sb, toUpload, rows.length ? minSort - toUpload.length : 0); // 새 라벨은 위쪽에
    }
    const list = applyLocalSelection(rows.length ? [...toUpload, ...remote] : toUpload);
    synced = new Map(list.map(x => [keyOf(x), jsonOf(x)]));
    writeJson(SYNCED_KEY, Object.fromEntries(synced));
    return { list, uploaded: rows.length ? toUpload.length : 0 };
};

const flush = async () => {
    const sb = cloud();
    const list = latestList;
    if (!sb || !synced || !list) return;
    const ids = new Set(list.map(keyOf));
    const changed = list.filter(x => synced.get(keyOf(x)) !== jsonOf(x));
    const created = changed.filter(x => !synced.has(keyOf(x)));
    const updated = changed.filter(x => synced.has(keyOf(x)));
    const removed = [...synced.keys()].filter(id => !ids.has(id));
    // 새 라벨: 목록 맨 위에 오도록 현재 가장 작은 순서보다 작게
    if (created.length) {
        const { data } = await sb.from(TABLE).select('sort_order').order('sort_order').limit(1);
        const minSort = data?.[0]?.sort_order ?? 0;
        await insertRows(sb, created, minSort - created.length);
    }
    // 고친 라벨: 내용만 (순서는 그대로)
    for (let i = 0; i < updated.length; i += BATCH) {
        const batch = updated.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(it => sb.from(TABLE).update({ data: contentOf(it), updated_at: new Date().toISOString(), updated_by_name: me() }).eq('id', keyOf(it))));
        const failed = results.find(r => r.error);
        if (failed) throw new Error(`라벨을 고치지 못했습니다: ${failed.error.message}`);
    }
    for (let i = 0; i < removed.length; i += BATCH) {
        const { error } = await sb.from(TABLE).delete().in('id', removed.slice(i, i + BATCH));
        if (error) throw new Error(`라벨을 지우지 못했습니다: ${error.message}`);
    }
    changed.forEach(x => synced.set(keyOf(x), jsonOf(x)));
    removed.forEach(id => synced.delete(id));
    writeJson(SYNCED_KEY, Object.fromEntries(synced));
};

/**
 * 목록이 바뀔 때마다 부른다 (화면의 saveData). 선택 상태는 바로 이 PC에 저장하고, 내용은 잠깐 모았다가 클라우드에 올린다.
 * @param {Object[]} list
 */
export const scheduleDrumLabelSync = (list) => {
    saveLocalSelection(list);
    if (!cloud() || !synced) return;
    latestList = list.map(x => ({ ...x }));
    clearTimeout(timer);
    timer = setTimeout(() => {
        flushing = flush().catch(e => { console.error('[드럼 라벨] 클라우드 저장 실패:', e); onErrorListener?.(e.message); }).finally(() => { flushing = null; });
    }, SYNC_DELAY_MS);
};

/** 기다리는 저장을 바로 올린다 (인쇄 직전 등) */
export const flushDrumLabelSync = async () => {
    if (timer) { clearTimeout(timer); timer = null; flushing = flush(); }
    if (flushing) await flushing.catch(e => onErrorListener?.(e.message));
};

// ---------- 출력(발행) 이력 ----------
/** @returns {Promise<{ id: string, timestamp: string, by: string, items: Object[] }[] | null>} 로컬 모드면 null */
export const listDrumPrints = async (limit = 30) => {
    const sb = cloud();
    if (!sb) return null;
    const { data, error } = await sb.from(PRINT_TABLE).select('*').order('printed_at', { ascending: false }).limit(limit);
    if (error) throw new Error(`출력 이력을 불러오지 못했습니다: ${error.message}`);
    return (data || []).map(r => ({ id: r.id, timestamp: new Date(r.printed_at).toLocaleString('ko-KR'), by: r.printed_by_name || '', items: r.items || [] }));
};

/**
 * 출력 이력 찾기 (인쇄 이력 창): 기간(from~to, YYYY-MM-DD)의 발행을 최근 순으로 최대 limit건. 로컬 모드면 null
 * 글자 검색(제품명·LOT·인쇄자)은 화면에서 한다 (items가 JSON이라)
 */
export const searchDrumPrints = async ({ from = '', to = '', limit = 500 } = {}) => {
    const sb = cloud();
    if (!sb) return null;
    let q = sb.from(PRINT_TABLE).select('*').order('printed_at', { ascending: false }).limit(limit);
    if (from) q = q.gte('printed_at', new Date(`${from}T00:00:00`).toISOString());
    if (to) q = q.lt('printed_at', new Date(new Date(`${to}T00:00:00`).getTime() + 86400000).toISOString());
    const { data, error } = await q;
    if (error) throw new Error(`출력 이력을 불러오지 못했습니다: ${error.message}`);
    return (data || []).map(r => ({ id: r.id, at: r.printed_at, timestamp: new Date(r.printed_at).toLocaleString('ko-KR'), by: r.printed_by_name || '', items: r.items || [] }));
};

export const addDrumPrint = async (items) => {
    const sb = cloud();
    if (!sb) return;
    const id = `DP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const { error } = await sb.from(PRINT_TABLE).insert({ id, printed_by_name: me(), items: items.map(contentOf) });
    if (error) throw new Error(`출력 이력을 남기지 못했습니다: ${error.message}`);
};

/** 출력 이력 모두 지우기 (자재 관리자 이상, RLS) */
export const clearDrumPrints = async () => {
    const sb = cloud();
    if (!sb) return;
    const { error } = await sb.from(PRINT_TABLE).delete().neq('id', '');
    if (error) throw new Error(/row-level security|permission/i.test(error.message) ? '출력 이력 지우기는 자재 관리자 이상만 할 수 있습니다.' : `출력 이력을 지우지 못했습니다: ${error.message}`);
};
