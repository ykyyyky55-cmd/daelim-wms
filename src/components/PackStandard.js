import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { listPackStandards, getPackStandard, savePackStandard, deletePackStandard, packStandardLink } from '../services/packStandards.js';
import { listItemImages, fileUrls } from '../services/fileStore.js';

const PHOTO_LIMIT = 40; // 한 번에 보여 주는 사진 수 (더 많으면 검색으로 좁힌다)
const PHOTO_CACHE_MS = 60 * 1000;
const PHOTO_MAX_SIDE = 1400; // 표준서에 넣는 사진의 긴 변 (표준서 한 건이 DB에 통째로 저장되므로)
let photoCache = null; // { at, rows }
const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, '');

/**
 * 웹 저장소(파일 저장소 → 품목 사진)에서 사진을 찾는다. 낱말을 모두 포함한 사진만(품목코드·품명·규격·파일 이름·메모), 대표 사진 먼저.
 * @param {{ query?: string }} p
 * @returns {Promise<{ total: number, list: Array<{ id: string, code: string, itemName: string, spec: string, memo: string, primary: boolean, url: string }> }>}
 */
const searchStorePhotos = async ({ query = '' } = {}) => {
    if (!photoCache || Date.now() - photoCache.at > PHOTO_CACHE_MS) photoCache = { at: Date.now(), rows: await listItemImages() };
    const masterOf = new Map(state.master.map(m => [m.code, m]));
    const words = String(query).toLowerCase().split(/\s+/).filter(Boolean).map(norm);
    const rows = photoCache.rows.map(r => {
        const m = masterOf.get(r.code);
        return { ...r, itemName: m?.name || '', spec: m?.spec || '' };
    }).filter(r => {
        const text = norm(`${r.code} ${r.itemName} ${r.spec} ${r.name} ${r.memo}`);
        return words.every(w => text.includes(w));
    }).sort((a, b) => Number(b.primary) - Number(a.primary) || String(b.at).localeCompare(String(a.at)));
    const shown = rows.slice(0, PHOTO_LIMIT);
    const urls = await fileUrls(shown);
    return {
        total: photoCache.rows.length,
        list: shown.map(r => ({ id: r.id, code: r.code, itemName: r.itemName, spec: r.spec, memo: r.memo, primary: r.primary, url: urls.get(r.path || r.id) || '' })).filter(r => r.url)
    };
};

/** 고른 사진을 표준서에 넣을 dataURL로 (저장소 주소는 1시간 뒤 끊기므로 내용을 받아 긴 변 1400px JPEG로 줄인다) */
const storePhotoDataUrl = async (photo) => {
    if (!photo?.url) throw new Error('사진 주소가 없습니다.');
    const res = await fetch(photo.url);
    if (!res.ok) throw new Error('사진을 받지 못했습니다. 잠시 뒤 다시 찾아보세요.');
    const bitmap = await createImageBitmap(await res.blob());
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
};

// 생산업무 → 포장작업표준서 (탭 packStandard)
// 편집기는 public/pack-standard/index.html (원래 단독 HTML 편집기에 WMS 연동 스크립트를 붙인 것)을 iframe으로 띄운다.
// 같은 출처라 편집기가 window.parent.__packStdBridge 로 저장·불러오기·권한을 받는다. 편집(저장·삭제)은 매니저 이상(RLS 같은 규칙).
// QR·링크: ?std=<문서id>#packStandard → main.js가 window.__packStdOpenId 로 넘겨 그 문서를 연다.
export const renderPackStandard = (container, { showToast = () => {} } = {}) => {
    const canEdit = canPerformAction('EDIT_MASTER');
    window.__packStdBridge = {
        canEdit,
        userName: state.currentUser?.name || '',
        list: listPackStandards,
        get: getPackStandard,
        save: async (doc) => { if (!canEdit) throw new Error('표준서 저장은 자재 관리자 이상만 할 수 있습니다.'); return savePackStandard(doc); },
        remove: async (id) => { if (!canEdit) throw new Error('표준서 삭제는 자재 관리자 이상만 할 수 있습니다.'); return deletePackStandard(id); },
        link: packStandardLink,
        photos: searchStorePhotos,
        photoData: storePhotoDataUrl,
        toast: (msg) => showToast(msg)
    };
    const openId = window.__packStdOpenId || '';
    window.__packStdOpenId = null;
    const src = `pack-standard/index.html${openId ? `?cloudId=${encodeURIComponent(openId)}` : ''}`;
    container.innerHTML = `
    <section class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-base font-black text-slate-900 flex items-center gap-2">📘 포장작업표준서
                <span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${canEdit ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}">${canEdit ? '편집 가능 (자재 관리자 이상)' : '열람 전용'}</span></h2>
            <span class="text-[11px] text-slate-500">표준서는 회사 DB에 저장되어 모든 PC·휴대폰에서 같은 내용을 봅니다. QR은 로그인한 사람만 열립니다.</span>
        </div>
        <iframe id="pack-std-frame" src="${src}" title="포장작업표준서" class="w-full bg-white rounded-2xl border border-slate-200 shadow-sm" style="height: calc(100vh - var(--header-h, 110px) - 90px); min-height: 640px;"></iframe>
    </section>`;
};
