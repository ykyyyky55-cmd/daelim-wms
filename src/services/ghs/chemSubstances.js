// ==========================================
// 물질 정보 저장소 (CAS 번호별) + 조회 (supabase/auth/77_msds_authoring.sql)
// ==========================================
// CAS 번호를 넣으면 ① 저장해 둔 물질 기록 → ② 안전보건공단 MSDS 조회 API(Edge Function kosha-msds, 인증키가 있을 때)
// → ③ PubChem(미국 국립보건원, 키 없이 브라우저에서 바로) 순서로 찾아 물질 기록을 만든다. 받은 기록은 저장해 두고 다음부터 다시 받지 않는다.
// - 클라우드: 표 wms_chem_substances (마스터·작업일지 관리자만 — 어떤 물질을 쓰는지도 배합 자료이므로). 브라우저 저장소에는 남기지 않고 메모리에만 둔다.
// - 로컬 모드: localStorage(daelim_chem_substances)
// 공단·PubChem의 분류는 참고 자료다. 공급사 MSDS와 다르면 물질 기록을 고쳐 쓴다(제조자가 작성 책임을 진다).
import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { state } from '../db.js';
import { parseKosha, parsePubChem, emptySubstance, normCas, isValidCas } from './substanceParse.js';

const TABLE = 'wms_chem_substances';
const LOCAL_KEY = 'daelim_chem_substances';
const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest';
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch (e) { console.warn('[물질 정보] 로컬 자료를 읽지 못했습니다', e); return []; } };
const writeLocal = (list) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { throw new Error('이 기기의 저장 공간이 부족합니다.'); } };
const me = () => state.currentUser || {};
const fail = (error, what) => {
    const msg = error?.message || String(error);
    if (/row-level security|permission denied/i.test(msg)) throw new Error(`${what} 권한이 없습니다 (마스터·작업일지 관리자만).`);
    throw new Error(`${what} 실패: ${msg}`);
};

/** 메모리 보관 (CAS → 물질 기록). 로그아웃하면 지운다 */
const cache = new Map();
let isAllLoaded = false;
export const clearChemCache = () => { cache.clear(); isAllLoaded = false; };

const fromRow = (r) => ({ ...(r.data || {}), cas: r.cas, updatedAt: r.updated_at, updatedBy: r.updated_by_name || '' });

/** 저장된 물질 기록 전체 (CAS 순) */
export const listSubstances = async ({ refresh = false } = {}) => {
    if (!isAllLoaded || refresh) {
        const sb = cloud();
        let rows;
        if (sb) {
            const { data, error } = await sb.from(TABLE).select('*').order('cas');
            if (error) fail(error, '물질 정보 조회');
            rows = (data || []).map(fromRow);
        } else rows = readLocal();
        cache.clear();
        rows.forEach(s => cache.set(s.cas, s));
        isAllLoaded = true;
    }
    return [...cache.values()].sort((a, b) => String(a.nameKo || a.nameEn || a.cas).localeCompare(String(b.nameKo || b.nameEn || b.cas), 'ko'));
};

/** 지금 메모리에 있는 물질 기록 (새로 받지 않음 — CAS 입력 칸의 제안 목록용) */
export const knownSubstances = () => [...cache.values()].sort((a, b) => String(a.cas).localeCompare(String(b.cas), 'en', { numeric: true }));

/** CAS 목록 → Map(CAS → 물질 기록). 저장된 것만 (없는 CAS는 빠진다) */
export const getSubstanceMap = async (casList = []) => {
    await listSubstances();
    const out = new Map();
    casList.map(normCas).filter(Boolean).forEach(cas => { if (cache.has(cas)) out.set(cas, cache.get(cas)); });
    return out;
};

/** 물질 기록 저장 (CAS가 같으면 덮어씀) */
export const saveSubstance = async (sub) => {
    const cas = normCas(sub.cas);
    if (!cas) throw new Error('CAS 번호가 없습니다.');
    const { updatedAt: _u, updatedBy: _b, ...data } = { ...sub, cas };
    const sb = cloud();
    let saved;
    if (sb) {
        const { data: row, error } = await sb.from(TABLE).upsert({ cas, data, updated_at: new Date().toISOString(), updated_by_name: me().name || '' }, { onConflict: 'cas' }).select().single();
        if (error) fail(error, '물질 정보 저장');
        saved = fromRow(row);
    } else {
        saved = { ...data, updatedAt: new Date().toISOString(), updatedBy: me().name || '' };
        writeLocal([saved, ...readLocal().filter(x => x.cas !== cas)]);
    }
    cache.set(cas, saved);
    return saved;
};

export const deleteSubstance = async (casNo) => {
    const cas = normCas(casNo);
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from(TABLE).delete().eq('cas', cas);
        if (error) fail(error, '물질 정보 삭제');
    } else writeLocal(readLocal().filter(x => x.cas !== cas));
    cache.delete(cas);
};

// ---------- 안전보건공단 MSDS 조회 API 인증키 ----------
/** 인증키가 설정돼 있는지 (로컬 모드는 항상 false — 공단 조회는 클라우드에서만) */
export const koshaKeySet = async () => {
    const sb = cloud();
    if (!sb) return false;
    const { data, error } = await sb.rpc('wms_kosha_key_set');
    if (error) { console.warn('[물질 정보] 공단 인증키 설정 여부를 확인하지 못했습니다:', error.message); return false; }
    return !!data;
};

/** 인증키 저장 (빈 값이면 지움) → 설정 여부 */
export const setKoshaKey = async (key) => {
    const sb = cloud();
    if (!sb) throw new Error('안전보건공단 조회는 클라우드 모드에서만 쓸 수 있습니다.');
    const { data, error } = await sb.rpc('wms_set_kosha_key', { p_key: String(key || '').trim() });
    if (error) throw new Error(error.message);
    return !!data;
};

const callKosha = async (body) => {
    const sb = cloud();
    if (!sb) return { ok: false, code: 'LOCAL', error: '로컬 모드' };
    const { data, error } = await sb.functions.invoke('kosha-msds', { body });
    if (error) {
        let message = error.message || '안전보건공단 조회 함수를 부르지 못했습니다.';
        let code = 'CALL';
        try { const detail = await error.context?.json?.(); if (detail?.error) { message = detail.error; code = detail.code || code; } } catch (e) { console.warn('[물질 정보] 오류 내용을 읽지 못했습니다:', e); }
        return { ok: false, code, error: message };
    }
    return data || { ok: false, code: 'CALL', error: '빈 응답' };
};

/** 인증키로 실제 조회가 되는지 확인 → { keySet, keyOk, message } */
export const testKosha = async () => {
    const res = await callKosha({ action: 'status' });
    if (!res.ok) return { keySet: false, keyOk: false, message: res.error || '' };
    return { keySet: !!res.keySet, keyOk: !!res.keyOk, message: res.message || '' };
};

// ---------- 조회 ----------
const fetchJson = async (url) => {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`PubChem 응답 ${res.status}`);
    return res.json();
};

/** PubChem에서 물질 기록을 만든다 (없으면 null) */
const fromPubChem = async (cas) => {
    const ids = await fetchJson(`${PUBCHEM}/pug/compound/name/${encodeURIComponent(cas)}/cids/JSON`);
    const cid = ids?.IdentifierList?.CID?.[0];
    if (!cid) return null;
    const [prop, ghs] = await Promise.all([
        fetchJson(`${PUBCHEM}/pug/compound/cid/${cid}/property/Title,IUPACName,MolecularWeight/JSON`),
        fetchJson(`${PUBCHEM}/pug_view/data/compound/${cid}/JSON?heading=GHS+Classification`)
    ]);
    return { ...parsePubChem(cas, prop?.PropertyTable?.Properties?.[0] || {}, ghs), pubchemCid: cid };
};

/**
 * CAS 번호로 물질 정보를 찾는다.
 * @param {string} casNo
 * @param {{ force?: boolean, save?: boolean }} [opt] force = 저장된 기록이 있어도 다시 받는다, save = 받은 기록을 저장한다(기본 true)
 * @returns {Promise<{ sub: Object, from: 'LIBRARY'|'KOSHA'|'PUBCHEM'|'NONE', notes: string[] }>} NONE이면 sub는 빈 기록(직접 입력용, 저장 안 함)
 */
export const lookupSubstance = async (casNo, { force = false, save = true } = {}) => {
    const cas = normCas(casNo);
    if (!cas) throw new Error('CAS 번호를 입력하세요.');
    if (!isValidCas(cas)) throw new Error(`${cas}: CAS 번호가 올바르지 않습니다 (검증 숫자가 맞지 않음).`);
    await listSubstances();
    const existing = cache.get(cas);
    if (existing && !force) return { sub: existing, from: 'LIBRARY', notes: [] };
    const notes = [];
    const keep = async (sub) => {
        // 사람이 고친 값(M 계수·가산 불가 표시·메모)은 다시 받아도 남긴다
        const merged = existing ? { ...sub, m: { ...sub.m, ...existing.m }, nonAdditive: !!existing.nonAdditive, memo: existing.memo || '' } : sub;
        merged.fetchedAt = new Date().toISOString();
        return save ? saveSubstance(merged) : merged;
    };
    // ② 안전보건공단
    const res = await callKosha({ action: 'lookup', cas });
    if (res.ok && res.found) return { sub: await keep(parseKosha(res.chem, res.detail)), from: 'KOSHA', notes };
    if (res.ok && !res.found) notes.push('안전보건공단 화학물질정보에 없는 CAS 번호입니다.');
    else if (res.code === 'NO_KEY') notes.push('안전보건공단 조회 인증키가 없어 PubChem에서 찾았습니다.');
    else if (res.code !== 'LOCAL') notes.push(`안전보건공단 조회 실패: ${res.error}`);
    // ③ PubChem
    try {
        const sub = await fromPubChem(cas);
        if (sub) return { sub: await keep(sub), from: 'PUBCHEM', notes };
        notes.push('PubChem에도 없는 CAS 번호입니다 (석유계 혼합물·고분자 등은 PubChem에 없습니다).');
    } catch (e) {
        notes.push(`PubChem 조회 실패: ${e.message}`);
    }
    return { sub: existing || emptySubstance(cas), from: existing ? 'LIBRARY' : 'NONE', notes };
};
