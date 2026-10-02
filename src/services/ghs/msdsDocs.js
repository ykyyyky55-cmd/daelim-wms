// ==========================================
// 혼합물 MSDS 작성 문서 저장소 (supabase/auth/77_msds_authoring.sql)
// ==========================================
// 문서에는 구성성분의 정확한 함유량(배합 자료)이 들어 있다 → 마스터·작업일지 관리자만 (DB RLS: wms_has_worklog_access).
// - 클라우드: 표 wms_msds_docs. 브라우저 저장소에는 남기지 않는다 (같은 PC를 다른 사람이 써도 볼 수 없게).
// - 로컬 모드: localStorage(daelim_msds_docs)
// 발행한 MSDS(함유량은 범위로 적은 문서)는 MSDS 대장(wms_qc_records)에 첨부 파일로 올린다 — components/quality/MsdsAuthoring.js
import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { state } from '../db.js';

const TABLE = 'wms_msds_docs';
const LOCAL_KEY = 'daelim_msds_docs';
const SUPPLIER_ID = 'CFG:SUPPLIER';
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch (e) { console.warn('[MSDS 작성] 로컬 자료를 읽지 못했습니다', e); return []; } };
const writeLocal = (list) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { throw new Error('이 기기의 저장 공간이 부족합니다.'); } };
const me = () => state.currentUser || {};
const newId = () => `MSDS-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const fail = (error, what) => {
    const msg = error?.message || String(error);
    if (/row-level security|permission denied/i.test(msg)) throw new Error(`${what} 권한이 없습니다. 혼합물 MSDS 작성은 마스터·작업일지 관리자만 할 수 있습니다.`);
    throw new Error(`${what} 실패: ${msg}`);
};

const fromRow = (r) => ({ ...(r.data || {}), id: r.id, status: r.status, by: r.created_by_name || '', updatedBy: r.updated_by_name || '', createdAt: r.created_at, updatedAt: r.updated_at });

/** 작성 문서 목록 (최근 고친 순, 설정 줄 제외) */
export const listMsdsDocs = async () => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from(TABLE).select('*').neq('status', 'CFG').order('updated_at', { ascending: false });
        if (error) fail(error, 'MSDS 작성 문서 조회');
        return (data || []).map(fromRow);
    }
    return readLocal().filter(d => d.status !== 'CFG').sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
};

/** 문서 저장 (id가 없으면 새로) */
export const saveMsdsDoc = async (doc) => {
    const id = doc.id || newId();
    const { id: _i, status: _s, by: _b, updatedBy: _ub, createdAt: _c, updatedAt: _u, ...data } = doc;
    const status = doc.status === 'FINAL' ? 'FINAL' : 'DRAFT';
    const sb = cloud();
    if (sb) {
        const row = { id, product_name: String(doc.product?.name || ''), status, data, updated_at: new Date().toISOString(), updated_by_name: me().name || '' };
        const { data: saved, error } = doc.id
            ? await sb.from(TABLE).update(row).eq('id', id).select().single()
            : await sb.from(TABLE).insert({ ...row, created_by_name: me().name || '' }).select().single();
        if (error) fail(error, 'MSDS 작성 문서 저장');
        return fromRow(saved);
    }
    const list = readLocal();
    const prev = list.find(x => x.id === id);
    const saved = { ...data, id, status, by: prev?.by || me().name || '', updatedBy: me().name || '', createdAt: prev?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    writeLocal([saved, ...list.filter(x => x.id !== id)]);
    return saved;
};

export const deleteMsdsDoc = async (id) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from(TABLE).delete().eq('id', id);
        if (error) fail(error, 'MSDS 작성 문서 삭제');
        return;
    }
    writeLocal(readLocal().filter(x => x.id !== id));
};

/** 공급자 정보 기본값 (회사명·주소·긴급전화번호·팩스) — 새 문서에 미리 채운다 */
export const getSupplierDefault = async () => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from(TABLE).select('data').eq('id', SUPPLIER_ID).maybeSingle();
        if (error) { console.warn('[MSDS 작성] 공급자 기본값을 읽지 못했습니다:', error.message); return null; }
        return data?.data || null;
    }
    return readLocal().find(x => x.id === SUPPLIER_ID)?.supplier || null;
};

export const saveSupplierDefault = async (supplier) => {
    const clean = { company: String(supplier.company || '').trim(), address: String(supplier.address || '').trim(), phone: String(supplier.phone || '').trim(), fax: String(supplier.fax || '').trim() };
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from(TABLE).upsert({ id: SUPPLIER_ID, product_name: '', status: 'CFG', data: clean, updated_at: new Date().toISOString(), updated_by_name: me().name || '' }, { onConflict: 'id' });
        if (error) fail(error, '공급자 기본값 저장');
        return;
    }
    writeLocal([{ id: SUPPLIER_ID, status: 'CFG', supplier: clean }, ...readLocal().filter(x => x.id !== SUPPLIER_ID)]);
};
