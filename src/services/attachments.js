// ==========================================
// 문서 첨부파일 (supabase/auth/45_attach_approval_ext.sql)
// ==========================================
// 보고서·결재 문서마다 첨부파일 여러 개. 문서 키는 전자결재와 같은 doc_key
// (PLAN:…, REQ:…, SLIP:…, LOG:…, LEDGER:…, CARD:…, REPORT:<보고서id>, MSDS:<id>, EQUIP:<id> …).
// - 클라우드: 표 wms_attachments + 비공개 버킷 wms-files의 attach/<문서키>/<시각>_<파일명> (볼 때 서명 URL)
// - 로컬 모드: localStorage(daelim_attachments)에 dataURL로 (파일 2MB 이하)
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';
import { storageSafeName, storageSafeSegment } from './storageKey.js';
import { fileUrls } from './fileStore.js';

const BUCKET = 'wms-files';
const TABLE = 'wms_attachments';
const LOCAL_KEY = 'daelim_attachments';
const MAX_CLOUD = 20 * 1024 * 1024;
const MAX_LOCAL = 2 * 1024 * 1024;

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; } };
const writeLocal = (v) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch { throw new Error('이 기기의 저장 공간이 부족합니다 (로컬 모드는 파일을 브라우저에 저장합니다).'); } };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const me = () => state.currentUser || {};
const readDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    r.readAsDataURL(blob);
});

const fromRow = (r) => ({ id: r.id, key: r.doc_key, path: r.path, name: r.file_name, mime: r.mime || '', size: Number(r.size) || 0, by: r.uploaded_by_name || '', uploadedBy: r.uploaded_by, at: r.created_at });

// 화면마다 건수를 보여 주려고 문서 키별로 잠깐 보관 (올리기·지우기 때 갱신)
const countCache = new Map();
export const cachedAttachmentCount = (key) => countCache.get(key);

/** 문서 하나의 첨부 목록 (오래된 순) */
export const listAttachments = async (key) => {
    if (!key) return [];
    const sb = cloud();
    let list;
    if (sb) {
        const { data, error } = await sb.from(TABLE).select('*').eq('doc_key', key).order('created_at');
        if (error) throw new Error(`첨부파일을 불러오지 못했습니다: ${error.message}`);
        list = (data || []).map(fromRow);
    } else {
        list = (readLocal()[key] || []).slice();
    }
    countCache.set(key, list.length);
    return list;
};

/** 여러 문서의 첨부 건수 → Map(key → n) */
export const countAttachments = async (keys) => {
    const uniq = [...new Set(keys.filter(Boolean))];
    const out = new Map();
    if (!uniq.length) return out;
    const sb = cloud();
    if (sb) {
        for (let i = 0; i < uniq.length; i += 200) {
            const { data, error } = await sb.from(TABLE).select('doc_key').in('doc_key', uniq.slice(i, i + 200));
            if (error) { console.warn('[첨부] 건수 조회 실패:', error.message); break; }
            (data || []).forEach(r => out.set(r.doc_key, (out.get(r.doc_key) || 0) + 1));
        }
    } else {
        const all = readLocal();
        uniq.forEach(k => { if (all[k]?.length) out.set(k, all[k].length); });
    }
    uniq.forEach(k => countCache.set(k, out.get(k) || 0));
    return out;
};

/** 첨부 올리기 (여러 개) → 올린 항목 목록 */
export const addAttachments = async (key, files) => {
    if (!key) throw new Error('문서를 먼저 저장해야 파일을 첨부할 수 있습니다.');
    const sb = cloud();
    const added = [];
    if (sb) {
        for (const f of files) {
            if (f.size > MAX_CLOUD) throw new Error(`${f.name}: 20MB를 넘습니다.`);
            const path = `attach/${storageSafeSegment(key)}/${Date.now()}_${storageSafeName(f.name)}`;
            const { error: upErr } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
            if (upErr) throw new Error(`${f.name}: 올리지 못했습니다 (${upErr.message})`);
            const { data, error } = await sb.from(TABLE).insert({ doc_key: key, path, file_name: f.name, mime: f.type || '', size: f.size, uploaded_by_name: me().name || '' }).select().single();
            if (error) {
                await sb.storage.from(BUCKET).remove([path]);
                throw new Error(`${f.name}: 첨부 기록을 저장하지 못했습니다 (${error.message})`);
            }
            added.push(fromRow(data));
        }
    } else {
        const all = readLocal();
        for (const f of files) {
            if (f.size > MAX_LOCAL) throw new Error(`${f.name}: 로컬 모드에서는 2MB 이하만 저장할 수 있습니다.`);
            added.push({ id: uid(), key, path: '', name: f.name, mime: f.type || '', size: f.size, data: await readDataUrl(f), by: me().name || '', uploadedBy: me().username || '', at: new Date().toISOString() });
        }
        all[key] = [...(all[key] || []), ...added];
        writeLocal(all);
    }
    countCache.set(key, (countCache.get(key) || 0) + added.length);
    return added;
};

/** 첨부 하나 지우기 */
export const removeAttachment = async (att) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from(TABLE).delete().eq('id', att.id);
        if (error) throw new Error(`첨부를 지우지 못했습니다: ${error.message}`);
        const { error: rmErr } = await sb.storage.from(BUCKET).remove([att.path]);
        if (rmErr) console.warn('[첨부] 저장소 파일을 지우지 못했습니다:', rmErr.message);
    } else {
        const all = readLocal();
        all[att.key] = (all[att.key] || []).filter(x => x.id !== att.id);
        if (!all[att.key].length) delete all[att.key];
        writeLocal(all);
    }
    countCache.set(att.key, Math.max(0, (countCache.get(att.key) || 1) - 1));
};

/** 문서를 지울 때 그 첨부도 모두 지운다 */
export const removeAllAttachments = async (key) => {
    const list = await listAttachments(key);
    for (const a of list) await removeAttachment(a);
};

/** 첨부를 볼 주소 (클라우드는 서명 URL) */
export const attachmentUrl = async (att) => (att.data ? att.data : (await fileUrls([att])).get(att.path) || '');

/** 원래 이름으로 내려받기 */
export const downloadAttachment = async (att) => {
    const url = await attachmentUrl(att);
    if (!url) throw new Error('파일 주소를 만들지 못했습니다.');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${att.name}: 내려받지 못했습니다 (${res.status}).`);
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: blobUrl, download: att.name || 'file' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
};

/** 올린 사람 또는 매니저 이상이면 지울 수 있다 */
export const canRemoveAttachment = (att) => {
    const u = me();
    const lv = { MASTER: 5, ADMIN: 4, MANAGER: 3 }[u.isMaster ? 'MASTER' : u.role] || 0;
    return lv >= 3 || (att.uploadedBy && (String(att.uploadedBy) === String(u.id) || String(att.uploadedBy) === String(u.username)));
};

/** 첨부를 올릴 수 있는 역할 (현장 작업자 이상 또는 경영자) */
export const canAttach = () => {
    const u = me();
    return !!u.isMaster || ['ADMIN', 'MANAGER', 'OPERATOR', 'EXECUTIVE'].includes(u.role);
};
