// ==========================================
// 포장작업표준서 (wms_pack_standards, supabase/auth/37_pack_standards.sql)
// ==========================================
// 편집기(public/pack-standard/index.html)는 iframe 안에서 돌고, 저장·불러오기는 이 모듈을 창 사이 다리(__packStdBridge)로 부른다.
// 목록은 내용(content) 없이 가볍게, 문서를 열 때만 content를 받는다. 로컬 모드는 localStorage(daelim_packStandards).
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';

const LOCAL_KEY = 'daelim_packStandards';
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const writeLocal = (v) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch { throw new Error('이 기기의 저장 공간이 부족합니다 (로컬 모드는 표준서를 브라우저에 저장합니다).'); } };
const myName = () => state.currentUser?.name || state.currentGlobalWorker || '';

const meta = (r) => ({ id: r.id, title: r.title || '', product: r.product || '', buyer: r.buyer || '', category: r.category || '', updatedAt: r.updated_at || r.updatedAt || '', updatedBy: r.updated_by_name || r.updatedBy || '' });

export const listPackStandards = async () => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_pack_standards').select('id, title, product, buyer, category, updated_at, updated_by_name').order('updated_at', { ascending: false });
        if (error) throw new Error(`표준서 목록을 불러오지 못했습니다: ${error.message}`);
        return (data || []).map(meta);
    }
    return readLocal().map(meta).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
};

export const getPackStandard = async (id) => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_pack_standards').select('*').eq('id', id).maybeSingle();
        if (error) throw new Error(`표준서를 불러오지 못했습니다: ${error.message}`);
        return data ? { ...meta(data), content: data.content || {} } : null;
    }
    const r = readLocal().find(x => x.id === id);
    return r ? { ...meta(r), content: r.content || {} } : null;
};

export const savePackStandard = async (doc) => {
    const product = String(doc.product || doc.title || '').trim();
    if (!doc.id || !product) throw new Error('제품명이 있어야 저장할 수 있습니다.');
    const row = {
        id: String(doc.id), title: String(doc.title || product).slice(0, 300), product: product.slice(0, 300),
        buyer: String(doc.buyer || '').slice(0, 200), category: String(doc.category || '').slice(0, 100),
        content: { a4Html: doc.content?.a4Html || '', historyHtml: doc.content?.historyHtml || '' },
        updated_by_name: myName(), updated_at: new Date().toISOString()
    };
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_pack_standards').upsert(row, { onConflict: 'id' }).select('id, title, product, buyer, category, updated_at, updated_by_name').single();
        if (error) throw new Error(`표준서를 저장하지 못했습니다: ${error.message}`);
        return meta(data);
    }
    const list = readLocal().filter(x => x.id !== row.id);
    writeLocal([{ ...row, updatedAt: row.updated_at, updatedBy: row.updated_by_name }, ...list]);
    return meta(row);
};

export const deletePackStandard = async (id) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_pack_standards').delete().eq('id', id);
        if (error) throw new Error(`표준서를 삭제하지 못했습니다: ${error.message}`);
        return;
    }
    writeLocal(readLocal().filter(x => x.id !== id));
};

/** 앱에서 이 표준서를 바로 여는 주소 (QR·링크 복사용). 로그인한 사람만 열린다. */
export const packStandardLink = (id) => {
    const base = `${window.location.origin}${window.location.pathname}`;
    return id ? `${base}?std=${encodeURIComponent(id)}#packStandard` : `${base}#packStandard`;
};
