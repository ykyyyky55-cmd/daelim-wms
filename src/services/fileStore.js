// ==========================================
// 파일 저장소: 품목 사진 · 접수/발행 문서 (supabase/auth/36_file_store.sql)
// ==========================================
// - 클라우드: 비공개 Storage 버킷 wms-files + 표 wms_item_images / wms_documents. 볼 때는 서명 URL(1시간).
// - 로컬 모드: localStorage(daelim_itemImages / daelim_documents)에 dataURL로 (파일 2MB 이하)
// - 품목 사진은 올리기 전에 긴 변 1600px JPEG로 줄인다. 품목당 대표 사진(is_primary) 하나가 품목마스터에 보인다.
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';
import { storageSafeName, storageSafeSegment } from './storageKey.js';

const BUCKET = 'wms-files';
const MAX_CLOUD = 20 * 1024 * 1024;
const MAX_LOCAL = 2 * 1024 * 1024;
const IMG_KEY = 'daelim_itemImages';
const DOC_KEY = 'daelim_documents';

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readLocal = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { throw new Error('이 기기의 저장 공간이 부족합니다 (로컬 모드는 파일을 브라우저에 저장합니다).'); } };
const myName = () => state.currentUser?.name || state.currentGlobalWorker || '';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const safeName = storageSafeName; // 저장소 경로는 영문·숫자만 (한글이면 400), 원래 이름은 name에

export const isCloudFiles = () => !!cloud();
export const DOC_DIRECTIONS ={ RECEIVED: '접수', ISSUED: '발행' };
export const DOC_TYPES = ['거래명세서', '세금계산서', '발주서', '견적서', '계약서', '공문', '성적서(COA)', 'MSDS', '인증·시험성적서', '기타'];

const readDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    r.readAsDataURL(blob);
});

/** 사진을 긴 변 maxSide px JPEG로 줄인다 (GIF·SVG는 그대로) */
export const shrinkImage = (file, maxSide = 1600, quality = 0.85) => new Promise((resolve) => {
    if (!/^image\/(jpeg|png|webp|bmp)/.test(file.type)) { resolve(file); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => resolve(b && b.size < file.size ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
});

export const dataUrlToFile = async (dataUrl, name) => {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name, { type: blob.type || 'image/jpeg' });
};

// ---------- 서명 URL (1시간, 50분 캐시) ----------
const urlCache = new Map(); // path → { url, at }
export const fileUrls = async (items) => {
    const out = new Map();
    const need = [];
    for (const it of items) {
        if (!it) continue;
        if (it.data) { out.set(it.path || it.id, it.data); continue; }
        const c = urlCache.get(it.path);
        if (c && Date.now() - c.at < 50 * 60 * 1000) out.set(it.path, c.url); else if (it.path) need.push(it.path);
    }
    const sb = cloud();
    if (sb && need.length) {
        for (let i = 0; i < need.length; i += 100) {
            const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), 3600);
            if (error) throw new Error(`파일 주소를 만들지 못했습니다: ${error.message}`);
            (data || []).forEach(d => { if (d.signedUrl) { urlCache.set(d.path, { url: d.signedUrl, at: Date.now() }); out.set(d.path, d.signedUrl); } });
        }
    }
    return out;
};
export const fileUrl = async (it) => (await fileUrls([it])).get(it.path || it.id) || '';

const uploadBlob = async (sb, path, file) => {
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) throw new Error(`${file.name}: 올리지 못했습니다 (${error.message})`);
};

// ---------- 품목 사진 ----------
const imgFromRow = (r) => ({ id: r.id, code: r.item_code, path: r.path, name: r.file_name, mime: r.mime, size: Number(r.size) || 0, primary: !!r.is_primary, memo: r.memo || '', by: r.uploaded_by_name || '', uploadedBy: r.uploaded_by, at: r.created_at });

export const listItemImages = async ({ code } = {}) => {
    const sb = cloud();
    if (sb) {
        const all = [];
        for (let from = 0; ; from += 1000) {
            let q = sb.from('wms_item_images').select('*').order('created_at', { ascending: false }).range(from, from + 999);
            if (code) q = q.eq('item_code', code);
            const { data, error } = await q;
            if (error) throw new Error(`품목 사진 목록을 불러오지 못했습니다: ${error.message}`);
            all.push(...(data || []).map(imgFromRow));
            if (!data || data.length < 1000) break;
        }
        return all;
    }
    const list = readLocal(IMG_KEY);
    return (code ? list.filter(x => x.code === code) : list).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
};

/** 품목 사진 올리기. primary: 대표 사진으로 (품목에 사진이 없으면 자동 대표) */
export const uploadItemImage = async (code, file, { primary = false, memo = '' } = {}) => {
    if (!code) throw new Error('품목을 고르세요.');
    if (!/^image\//.test(file.type)) throw new Error(`${file.name}: 이미지 파일만 올릴 수 있습니다.`);
    primaryCache = null;
    const small = await shrinkImage(file);
    const sb = cloud();
    const existing = await listItemImages({ code });
    const makePrimary = primary || !existing.some(x => x.primary);
    if (sb) {
        if (small.size > MAX_CLOUD) throw new Error(`${file.name}: 20MB를 넘습니다.`);
        const path = `images/${storageSafeSegment(code)}/${Date.now()}_${safeName(small.name)}`;
        await uploadBlob(sb, path, small);
        const { data, error } = await sb.from('wms_item_images').insert({ item_code: code, path, file_name: small.name, mime: small.type, size: small.size, memo, uploaded_by_name: myName() }).select().single();
        if (error) { await sb.storage.from(BUCKET).remove([path]); throw new Error(`사진 정보를 저장하지 못했습니다: ${error.message}`); }
        const row = imgFromRow(data);
        if (makePrimary) await setPrimaryImage(row);
        return { ...row, primary: makePrimary };
    }
    if (small.size > MAX_LOCAL) throw new Error(`${file.name}: 로컬 모드에서는 2MB 이하만 저장할 수 있습니다.`);
    const row = { id: uid(), code, path: '', name: small.name, mime: small.type, size: small.size, primary: makePrimary, memo, by: myName(), at: new Date().toISOString(), data: await readDataUrl(small) };
    const list = readLocal(IMG_KEY).map(x => (makePrimary && x.code === code ? { ...x, primary: false } : x));
    writeLocal(IMG_KEY, [row, ...list]);
    return row;
};
/** 품목마스터 편집 창에서 고른 사진(dataURL)을 대표 사진으로 올린다 */
export const uploadItemImageDataUrl = async (code, dataUrl) => uploadItemImage(code, await dataUrlToFile(dataUrl, `${code}.jpg`), { primary: true });

export const setPrimaryImage = async (img) => {
    primaryCache = null;
    const sb = cloud();
    if (sb) {
        const { error } = await sb.rpc('wms_set_primary_image', { p_id: img.id });
        if (error) throw new Error(`대표 사진으로 바꾸지 못했습니다: ${error.message}`);
        return;
    }
    writeLocal(IMG_KEY, readLocal(IMG_KEY).map(x => (x.code === img.code ? { ...x, primary: x.id === img.id } : x)));
};

export const deleteItemImage = async (img) => {
    primaryCache = null;
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_item_images').delete().eq('id', img.id);
        if (error) throw new Error(`사진을 지우지 못했습니다: ${error.message}`);
        await sb.storage.from(BUCKET).remove([img.path]);
    } else {
        writeLocal(IMG_KEY, readLocal(IMG_KEY).filter(x => x.id !== img.id));
    }
    // 대표 사진을 지웠으면 남은 가장 최근 사진을 대표로
    if (img.primary) {
        const rest = await listItemImages({ code: img.code });
        if (rest.length && !rest.some(x => x.primary)) await setPrimaryImage(rest[0]);
    }
};

// 품목마스터 표용: 품목코드 → 대표 사진 URL (클라우드만, 5분 캐시)
let primaryCache = null;
export const primaryImageUrls = async ({ refresh = false } = {}) => {
    if (!refresh && primaryCache && Date.now() - primaryCache.at < 5 * 60 * 1000) return primaryCache.map;
    const map = new Map();
    const sb = cloud();
    let rows = [];
    if (sb) {
        const { data, error } = await sb.from('wms_item_images').select('*').eq('is_primary', true);
        if (error) return map;
        rows = (data || []).map(imgFromRow);
    } else {
        rows = readLocal(IMG_KEY).filter(x => x.primary);
    }
    const urls = await fileUrls(rows).catch(() => new Map());
    rows.forEach(r => { const u = urls.get(r.path || r.id); if (u) map.set(r.code, u); });
    primaryCache = { at: Date.now(), map };
    return map;
};

// ---------- 접수·발행 문서 ----------
const docFromRow = (r) => ({
    id: r.id, regNo: r.reg_no || '', direction: r.direction, date: r.doc_date, type: r.doc_type || '', docNo: r.doc_no || '',
    party: r.party || '', title: r.title || '', assignee: r.assignee_name || '', memo: r.memo || '', files: r.files || [],
    by: r.uploaded_by_name || '', uploadedBy: r.uploaded_by, at: r.created_at, updatedAt: r.updated_at
});

export const listDocuments = async () => {
    const sb = cloud();
    if (sb) {
        const all = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await sb.from('wms_documents').select('*').order('doc_date', { ascending: false }).order('created_at', { ascending: false }).range(from, from + 999);
            if (error) throw new Error(`문서 목록을 불러오지 못했습니다: ${error.message}`);
            all.push(...(data || []).map(docFromRow));
            if (!data || data.length < 1000) break;
        }
        return all;
    }
    return readLocal(DOC_KEY).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.at).localeCompare(String(a.at)));
};

const uploadDocFiles = async (docId, files) => {
    const sb = cloud();
    const out = [];
    for (const f of files) {
        if (sb) {
            if (f.size > MAX_CLOUD) throw new Error(`${f.name}: 20MB를 넘습니다.`);
            const path = `docs/${docId}/${Date.now()}_${safeName(f.name)}`;
            await uploadBlob(sb, path, f);
            out.push({ path, name: f.name, mime: f.type || '', size: f.size });
        } else {
            if (f.size > MAX_LOCAL) throw new Error(`${f.name}: 로컬 모드에서는 2MB 이하만 저장할 수 있습니다.`);
            out.push({ id: uid(), path: '', name: f.name, mime: f.type || '', size: f.size, data: await readDataUrl(f) });
        }
    }
    return out;
};

/** 문서 등록·수정. newFiles: 새로 붙일 File 목록, removeFiles: 뺄 첨부(path 또는 id) */
export const saveDocument = async (doc, { newFiles = [], removeFiles = [] } = {}) => {
    const title = String(doc.title || '').trim();
    if (!title) throw new Error('제목을 입력하세요.');
    if (!DOC_DIRECTIONS[doc.direction]) throw new Error('접수 / 발행을 고르세요.');
    const isNew = !doc.id;
    const id = doc.id || uid();
    const kept = (doc.files || []).filter(f => !removeFiles.includes(f.path || f.id));
    const added = await uploadDocFiles(id, newFiles);
    const files = [...kept, ...added];
    const row = {
        direction: doc.direction, doc_date: doc.date || new Date().toISOString().slice(0, 10), doc_type: doc.type || '', doc_no: doc.docNo || '',
        party: doc.party || '', title, assignee_name: doc.assignee || '', memo: doc.memo || '', files, updated_at: new Date().toISOString()
    };
    const sb = cloud();
    let saved;
    if (sb) {
        const q = isNew
            ? sb.from('wms_documents').insert({ id, ...row, uploaded_by_name: myName() }).select().single()
            : sb.from('wms_documents').update(row).eq('id', id).select().single();
        const { data, error } = await q;
        if (error) {
            if (added.length) await sb.storage.from(BUCKET).remove(added.map(f => f.path));
            throw new Error(`문서를 저장하지 못했습니다: ${error.message}`);
        }
        const gone = (doc.files || []).filter(f => removeFiles.includes(f.path) && f.path).map(f => f.path);
        if (gone.length) await sb.storage.from(BUCKET).remove(gone);
        saved = docFromRow(data);
    } else {
        const list = readLocal(DOC_KEY);
        const year = String(row.doc_date).slice(0, 4);
        const prefix = `${DOC_DIRECTIONS[row.direction]}-${year}-`;
        const next = list.filter(x => String(x.regNo).startsWith(prefix)).reduce((m, x) => Math.max(m, Number(String(x.regNo).slice(prefix.length)) || 0), 0) + 1;
        const prev = list.find(x => x.id === id);
        saved = {
            ...(prev || {}), id, regNo: prev?.regNo || `${prefix}${String(next).padStart(4, '0')}`, direction: row.direction, date: row.doc_date, type: row.doc_type, docNo: row.doc_no,
            party: row.party, title, assignee: row.assignee_name, memo: row.memo, files, by: prev?.by || myName(), at: prev?.at || new Date().toISOString(), updatedAt: row.updated_at
        };
        writeLocal(DOC_KEY, [saved, ...list.filter(x => x.id !== id)]);
    }
    return { doc: saved, isNew };
};

export const deleteDocument = async (doc) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_documents').delete().eq('id', doc.id);
        if (error) throw new Error(`문서를 지우지 못했습니다: ${error.message}`);
        const paths = (doc.files || []).map(f => f.path).filter(Boolean);
        if (paths.length) await sb.storage.from(BUCKET).remove(paths);
        return;
    }
    writeLocal(DOC_KEY, readLocal(DOC_KEY).filter(x => x.id !== doc.id));
};

export const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round((n || 0) / 1024))}KB`);
