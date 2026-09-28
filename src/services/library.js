// ==========================================
// 자료실 (지원 → 자료실, 탭 library, supabase/auth/44_library.sql)
// ==========================================
// - 클라우드: 표 wms_library + 비공개 버킷 wms-files의 library/<자료id>/… (볼 때는 서명 URL)
// - 로컬 모드: localStorage(daelim_library)에 dataURL로 (파일 2MB 이하)
// - 파일 항목: { path, name, mime, size }(저장소) · { url, name, mime, size }(앱과 함께 배포된 public/ 파일) · { id, data, … }(로컬)
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';
import { storageSafeName } from './storageKey.js';
import { fileUrls } from './fileStore.js';

const BUCKET = 'wms-files';
const TABLE = 'wms_library';
const LOCAL_KEY = 'daelim_library';
const MAX_CLOUD = 20 * 1024 * 1024;
const MAX_LOCAL = 2 * 1024 * 1024;

/** 기본 분류 (자료에 입력된 다른 분류도 목록에 더해진다) */
export const LIBRARY_CATEGORIES = ['로고·CI', '양식·서식', '규정·지침', '교육 자료', '인증·성적서', '카탈로그·홍보', '기타'];

// 로컬 모드에서도 보이는 기본 자료 (클라우드는 44_library.sql이 같은 내용을 넣는다)
const BUILTIN_LOGO = {
    id: 'builtin-logo', builtin: true, category: '로고·CI', title: '대림 로고 (DAELIM since 1994)', pinned: true, by: '시스템', uploadedBy: null, at: '2026-09-28T00:00:00Z', updatedAt: '2026-09-28T00:00:00Z',
    desc: '홈페이지(daelimoil.co.kr) 로고를 선명한 벡터로 다시 그린 공식 로고입니다. 기본색 #1E3C96.\n· 밝은 바탕: 기본색 로고(logo) · 어두운 바탕: 흰색 로고(logo-white) — 둘 다 바탕 투명\n· 아이콘: 기본색 바탕 + 흰 로고 (icon, 앱 아이콘용 maskable 포함)\n· 인쇄·확대는 SVG, 문서·메신저 붙여넣기는 PNG(가로 1600px)를 쓰세요.',
    files: [
        { url: 'logo.svg', name: '대림로고_기본색.svg', mime: 'image/svg+xml', size: 5766 },
        { url: 'logo.png', name: '대림로고_기본색.png', mime: 'image/png', size: 65048 },
        { url: 'logo-white.svg', name: '대림로고_흰색.svg', mime: 'image/svg+xml', size: 5766 },
        { url: 'logo-white.png', name: '대림로고_흰색.png', mime: 'image/png', size: 34459 },
        { url: 'icon.svg', name: '대림아이콘.svg', mime: 'image/svg+xml', size: 5889 },
        { url: 'icon-512.png', name: '대림아이콘_512.png', mime: 'image/png', size: 17600 },
        { url: 'icon-maskable-512.png', name: '대림아이콘_사각_512.png', mime: 'image/png', size: 11809 }
    ]
};

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const writeLocal = (v) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch { throw new Error('이 기기의 저장 공간이 부족합니다 (로컬 모드는 파일을 브라우저에 저장합니다).'); } };
const myName = () => state.currentUser?.name || state.currentGlobalWorker || '';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const readDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    r.readAsDataURL(blob);
});

const fromRow = (r) => ({
    id: r.id, category: r.category || '기타', title: r.title || '', desc: r.description || '', files: r.files || [], pinned: !!r.pinned,
    by: r.uploaded_by_name || '', uploadedBy: r.uploaded_by, at: r.created_at, updatedAt: r.updated_at
});
const sortItems = (list) => list.sort((a, b) => (b.pinned - a.pinned) || String(b.updatedAt || b.at).localeCompare(String(a.updatedAt || a.at)));

/** 자료 목록 (고정 → 최근 수정 순) */
export const listLibrary = async () => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from(TABLE).select('*').order('updated_at', { ascending: false }).limit(2000);
        if (error) throw new Error(`자료 목록을 불러오지 못했습니다: ${error.message}`);
        return sortItems((data || []).map(fromRow));
    }
    const list = readLocal();
    return sortItems(list.some(x => x.id === BUILTIN_LOGO.id) ? list : [BUILTIN_LOGO, ...list]);
};

/** 파일을 볼 수 있는 주소 (공개 파일 → 앱 주소, 로컬 → dataURL, 저장소 → 서명 URL) */
export const libraryFileUrl = async (f) => {
    if (f.url) return new URL(`${import.meta.env.BASE_URL}${f.url}`, window.location.href).href;
    if (f.data) return f.data;
    return (await fileUrls([f])).get(f.path) || '';
};

/** 파일을 원래 이름으로 내려받는다 (서명 URL은 다른 주소라 download 속성이 안 먹어 blob으로 받는다) */
export const downloadLibraryFile = async (f) => {
    const url = await libraryFileUrl(f);
    if (!url) throw new Error('파일 주소를 만들지 못했습니다.');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${f.name}: 내려받지 못했습니다 (${res.status}).`);
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: blobUrl, download: f.name || 'file' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
};

const uploadFiles = async (itemId, files) => {
    const sb = cloud();
    const out = [];
    for (const f of files) {
        if (sb) {
            if (f.size > MAX_CLOUD) throw new Error(`${f.name}: 20MB를 넘습니다.`);
            const path = `library/${itemId}/${Date.now()}_${storageSafeName(f.name)}`;
            const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
            if (error) {
                if (out.length) await sb.storage.from(BUCKET).remove(out.map(x => x.path));
                throw new Error(`${f.name}: 올리지 못했습니다 (${error.message})`);
            }
            out.push({ path, name: f.name, mime: f.type || '', size: f.size });
        } else {
            if (f.size > MAX_LOCAL) throw new Error(`${f.name}: 로컬 모드에서는 2MB 이하만 저장할 수 있습니다.`);
            out.push({ id: uid(), name: f.name, mime: f.type || '', size: f.size, data: await readDataUrl(f) });
        }
    }
    return out;
};

const fileKey = (f) => f.path || f.url || f.id;

/**
 * 자료 등록·수정
 * @param {object} item 자료 (새 자료는 id 없음)
 * @param {{ newFiles?: File[], removeFiles?: string[] }} opts 새로 붙일 파일 / 뺄 파일 키(path·url·id)
 */
export const saveLibraryItem = async (item, { newFiles = [], removeFiles = [] } = {}) => {
    const title = String(item.title || '').trim();
    if (!title) throw new Error('제목을 입력하세요.');
    const kept = (item.files || []).filter(f => !removeFiles.includes(fileKey(f)));
    if (!kept.length && !newFiles.length) throw new Error('파일을 하나 이상 올리세요.');
    if (item.builtin) throw new Error('기본 자료는 고칠 수 없습니다.');
    const isNew = !item.id;
    const id = isNew ? uid() : item.id;
    const added = await uploadFiles(id, newFiles);
    const row = {
        category: String(item.category || '').trim() || '기타', title, description: item.desc || '',
        files: [...kept, ...added], pinned: !!item.pinned, updated_at: new Date().toISOString()
    };
    const sb = cloud();
    if (sb) {
        const q = isNew
            ? sb.from(TABLE).insert({ id, ...row, uploaded_by_name: myName() }).select().single()
            : sb.from(TABLE).update(row).eq('id', id).select().single();
        const { data, error } = await q;
        if (error) {
            if (added.length) await sb.storage.from(BUCKET).remove(added.map(f => f.path));
            throw new Error(`자료를 저장하지 못했습니다: ${error.message}`);
        }
        const gone = (item.files || []).filter(f => f.path && removeFiles.includes(f.path)).map(f => f.path);
        if (gone.length) {
            const { error: rmErr } = await sb.storage.from(BUCKET).remove(gone);
            if (rmErr) console.warn('[자료실] 뺀 파일을 저장소에서 지우지 못했습니다:', rmErr.message);
        }
        return { item: fromRow(data), isNew };
    }
    const list = readLocal().filter(x => x.id !== id);
    const prev = isNew ? null : readLocal().find(x => x.id === id);
    const saved = {
        id, category: row.category, title, desc: row.description, files: row.files, pinned: row.pinned,
        by: prev?.by || myName(), uploadedBy: prev?.uploadedBy || state.currentUser?.id || null, at: prev?.at || row.updated_at, updatedAt: row.updated_at
    };
    writeLocal([saved, ...list]);
    return { item: saved, isNew };
};

/** 자료 삭제 (저장소 파일도 함께 지운다. 앱 공개 파일(url)은 그대로) */
export const deleteLibraryItem = async (item) => {
    if (item.builtin) throw new Error('기본 자료는 지울 수 없습니다.');
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from(TABLE).delete().eq('id', item.id);
        if (error) throw new Error(`자료를 지우지 못했습니다: ${error.message}`);
        const paths = (item.files || []).map(f => f.path).filter(Boolean);
        if (paths.length) {
            const { error: rmErr } = await sb.storage.from(BUCKET).remove(paths);
            if (rmErr) console.warn('[자료실] 저장소 파일을 지우지 못했습니다:', rmErr.message);
        }
        return;
    }
    writeLocal(readLocal().filter(x => x.id !== item.id));
};
