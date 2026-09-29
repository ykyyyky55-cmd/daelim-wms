import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { canPerformAction } from '../services/auth.js';
import { state } from '../services/db.js';
import { fmtSize } from '../services/fileStore.js';
import {
    LIBRARY_CATEGORIES, listLibrary, saveLibraryItem, deleteLibraryItem, libraryFileUrl, downloadLibraryFile
} from '../services/library.js';
import { viewerTabOf, canUseViewer, openFileInViewer } from '../services/viewerOpen.js';

// 지원 → 자료실 (탭 library): 회사 공용 자료를 분류별로 올리고 내려받는다
// 조회 VIEWER 이상 · 올리기 OPERATOR 이상 · 고치기·지우기 올린 사람 또는 MANAGER 이상 (RLS 같은 규칙, 44_library.sql)
const CAT_KEY = 'daelim_library_cat';
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '');
const isImage = (f) => /^image\//.test(f.mime || '') || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name || '');
const fileIcon = (f) => (isImage(f) ? 'image' : /pdf/i.test(f.mime || f.name) ? 'file-text'
    : /sheet|excel|\.xlsx?$|\.csv$/i.test(`${f.mime} ${f.name}`) ? 'file-spreadsheet'
        : /zip|compressed/i.test(f.mime || '') ? 'file-archive' : 'file');
const fileKey = (f) => f.path || f.url || f.id;
// 흰 로고처럼 밝은 그림도 보이게 체크무늬 바탕
const checker = (a, b) => `background-color:${a};background-image:linear-gradient(45deg,${b} 25%,transparent 25%,transparent 75%,${b} 75%),linear-gradient(45deg,${b} 25%,transparent 25%,transparent 75%,${b} 75%);background-size:14px 14px;background-position:0 0,7px 7px;`;
const CHECKER_LIGHT = checker('#ffffff', '#e2e8f0');
const CHECKER_DARK = checker('#1e293b', '#334155'); // 흰색 로고처럼 밝은 그림용
const isWhiteArt = (f) => /white|흰/i.test(`${f.name} ${f.url || ''}`);

export const renderLibrary = (container, { showToast = () => {} } = {}) => {
    const canWrite = canPerformAction('WRITE_STOCK');
    const isManager = canPerformAction('EDIT_MASTER');
    const me = state.currentUser || {};
    const canEdit = (it) => !it.builtin && (isManager || (it.uploadedBy && String(it.uploadedBy) === String(me.id)));
    let list = [];
    let q = '';
    let cat = '';
    try { cat = localStorage.getItem(CAT_KEY) || ''; } catch { /* 기기 저장소를 못 쓰면 전체 */ }

    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-start justify-between gap-3">
            <div>
                <div class="text-[11px] font-black text-sky-600 flex items-center gap-1"><i data-lucide="library" class="w-3.5 h-3.5"></i>지원 › 자료실</div>
                <h2 class="text-lg font-black text-slate-900 mt-1">자료실</h2>
                <p class="text-xs text-slate-500 mt-1">로고·양식·규정·교육 자료처럼 회사에서 함께 쓰는 파일을 분류별로 모아 둡니다. 파일은 회사 전용 비공개 저장소에 보관되며 로그인한 사람만 받을 수 있습니다.</p>
            </div>
            ${canWrite ? '<button type="button" id="lb-new" class="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white shadow-sm"><i data-lucide="upload" class="w-4 h-4"></i>자료 올리기</button>' : ''}
        </div>
        <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm space-y-2">
            <div class="flex items-center gap-2 text-xs">
                <input type="search" id="lb-q" placeholder="제목·설명·파일 이름 검색" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5" />
                <span id="lb-count" class="text-slate-500 font-bold whitespace-nowrap"></span>
            </div>
            <div id="lb-cats" class="flex flex-wrap gap-1.5"></div>
        </div>
        <div id="lb-list" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start"></div>
    </section>
    <div id="lb-modal" class="hidden fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"></div>`;
    const $ = (s) => container.querySelector(s);

    const categories = () => {
        const out = [...LIBRARY_CATEGORIES];
        list.forEach(it => { if (it.category && !out.includes(it.category)) out.splice(out.length - 1, 0, it.category); });
        return out;
    };

    const renderCats = () => {
        const counts = {};
        list.forEach(it => { counts[it.category] = (counts[it.category] || 0) + 1; });
        const chip = (value, label, n) => `<button type="button" data-cat="${esc(value)}" class="lb-cat px-2.5 py-1 rounded-full text-xs font-bold border transition ${cat === value ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-slate-500'}">${esc(label)} <span class="opacity-70">${n}</span></button>`;
        $('#lb-cats').innerHTML = chip('', '전체', list.length) + categories().filter(c => counts[c]).map(c => chip(c, c, counts[c])).join('');
        container.querySelectorAll('.lb-cat').forEach(b => b.addEventListener('click', () => {
            cat = b.dataset.cat;
            try { localStorage.setItem(CAT_KEY, cat); } catch { /* 기억만 못 함 */ }
            renderCats(); renderList();
        }));
    };

    const fileTile = (it, f) => `
        <div class="border border-slate-200 rounded-xl overflow-hidden bg-white flex flex-col">
            ${isImage(f)
        ? `<button type="button" data-view="${esc(it.id)}|${esc(fileKey(f))}" class="h-24 flex items-center justify-center p-2" style="${isWhiteArt(f) ? CHECKER_DARK : CHECKER_LIGHT}" title="크게 보기"><img data-thumb="${esc(it.id)}|${esc(fileKey(f))}" alt="" class="max-h-full max-w-full object-contain" /></button>`
        : `<button type="button" data-view="${esc(it.id)}|${esc(fileKey(f))}" class="h-24 flex flex-col items-center justify-center gap-1 bg-slate-50 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600" title="${viewerTabOf(f.name, f.mime) && canUseViewer() ? '뷰어 및 편집기에서 열기' : '열기'}"><i data-lucide="${fileIcon(f)}" class="w-9 h-9"></i>${viewerTabOf(f.name, f.mime) && canUseViewer() ? '<span class="text-[10px] font-black">뷰어로 열기</span>' : ''}</button>`}
            <div class="p-1.5 border-t border-slate-100 flex items-center gap-1">
                <div class="min-w-0 flex-1">
                    <div class="text-[11px] font-bold text-slate-800 truncate" title="${esc(f.name)}">${esc(f.name)}</div>
                    <div class="text-[10px] text-slate-400">${fmtSize(f.size)}</div>
                </div>
                <button type="button" data-dl="${esc(it.id)}|${esc(fileKey(f))}" class="min-w-[36px] min-h-[36px] inline-flex items-center justify-center p-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700" title="받기"><i data-lucide="download" class="w-3.5 h-3.5"></i></button>
            </div>
        </div>`;

    const findFile = (ref) => {
        const [id, key] = ref.split('|');
        const it = list.find(x => x.id === id);
        return { it, f: it?.files.find(x => fileKey(x) === key) };
    };

    const renderList = () => {
        const needle = q.trim().toLowerCase();
        const rows = list.filter(it => (!cat || it.category === cat)
            && (!needle || `${it.title} ${it.desc} ${it.category} ${it.by} ${it.files.map(f => f.name).join(' ')}`.toLowerCase().includes(needle)));
        $('#lb-count').textContent = `${rows.length}건`;
        $('#lb-list').innerHTML = rows.length === 0
            ? `<div class="md:col-span-2 xl:col-span-3 bg-white p-10 rounded-2xl border border-slate-200 text-center text-sm text-slate-400">${list.length ? '조건에 맞는 자료가 없습니다.' : '올린 자료가 없습니다.'}</div>`
            : rows.map(it => `
            <article class="bg-white p-4 rounded-2xl border ${it.pinned ? 'border-sky-300' : 'border-slate-200'} shadow-sm space-y-3">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            ${it.pinned ? '<span class="px-1.5 py-0.5 rounded bg-slate-800 text-white text-[10px] font-black">📌 고정</span>' : ''}
                            <span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 text-[10px] font-black">${esc(it.category)}</span>
                        </div>
                        <h3 class="text-sm font-black text-slate-900 mt-1 break-words">${esc(it.title)}</h3>
                    </div>
                    <div class="flex gap-1 shrink-0">
                        ${it.files.length > 1 ? `<button type="button" data-dlall="${esc(it.id)}" class="px-2 py-1 rounded-lg bg-white border border-slate-300 text-[11px] font-bold flex items-center gap-1" title="파일을 모두 받기"><i data-lucide="download" class="w-3.5 h-3.5"></i>모두</button>` : ''}
                        ${canEdit(it) ? `<button type="button" data-edit="${esc(it.id)}" class="p-1.5 rounded-lg bg-white border border-slate-300" title="수정"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
                        <button type="button" data-del="${esc(it.id)}" class="p-1.5 rounded-lg bg-white border border-rose-200 text-rose-600" title="삭제"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>` : ''}
                    </div>
                </div>
                ${it.desc ? `<p class="text-xs text-slate-600 leading-relaxed whitespace-pre-line break-words">${esc(it.desc)}</p>` : ''}
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${it.files.map(f => fileTile(it, f)).join('')}</div>
                <div class="text-[11px] text-slate-400">${esc(it.by || '')} · ${esc(fmtDate(it.updatedAt || it.at))} · 파일 ${it.files.length}개</div>
            </article>`).join('');
        createIcons({ icons });
        // 그림 미리보기 주소는 나중에 채운다 (저장소 파일은 서명 URL)
        container.querySelectorAll('img[data-thumb]').forEach(async (img) => {
            const { f } = findFile(img.dataset.thumb);
            if (!f) return;
            try { img.src = await libraryFileUrl(f); } catch (e) { console.warn('[자료실] 미리보기를 불러오지 못했습니다:', e.message); }
        });
    };

    const openFile = async (ref) => {
        const { f } = findFile(ref);
        if (!f) return;
        // 엑셀·PDF·Word·HTML·TXT는 TOOL → 뷰어 및 편집기에서 연다
        if (viewerTabOf(f.name, f.mime) && canUseViewer()) {
            try { await openFileInViewer({ name: f.name, mime: f.mime, url: await libraryFileUrl(f) }); } catch (e) { alert(e.message); }
            return;
        }
        const w = window.open('', '_blank'); // 팝업 차단을 피하려고 누른 즉시 연다
        try {
            const url = await libraryFileUrl(f);
            if (w) w.location.href = url; else window.location.href = url;
        } catch (e) { w?.close(); alert(e.message); }
    };

    const download = async (files) => {
        for (const f of files) {
            try { await downloadLibraryFile(f); } catch (e) { alert(e.message); return; }
        }
        showToast(`⬇️ ${files.length}개 파일을 받았습니다.`);
    };

    // ---------- 올리기·수정 창 ----------
    const openEditor = (orig) => {
        const it = orig ? { ...orig, files: [...orig.files] } : { category: cat || '기타', title: '', desc: '', files: [], pinned: false };
        const removed = new Set();
        let picked = [];
        const modal = $('#lb-modal');
        const paint = () => {
            modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3 text-xs">
                <div class="flex items-center justify-between">
                    <h3 class="text-base font-black text-slate-900">${orig ? '자료 수정' : '자료 올리기'}</h3>
                    <button type="button" data-close class="p-1 rounded-lg hover:bg-slate-100"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>
                <label class="block"><span class="font-bold text-slate-600">분류</span>
                    <input id="lbm-cat" list="lbm-cats" value="${esc(it.category)}" maxlength="40" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2" />
                    <datalist id="lbm-cats">${categories().map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist></label>
                <label class="block"><span class="font-bold text-slate-600">제목 *</span>
                    <input id="lbm-title" value="${esc(it.title)}" maxlength="200" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 font-bold text-sm" /></label>
                <label class="block"><span class="font-bold text-slate-600">설명</span>
                    <textarea id="lbm-desc" rows="4" maxlength="4000" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 leading-relaxed">${esc(it.desc)}</textarea></label>
                ${isManager ? `<label class="flex items-center gap-1.5 font-bold"><input type="checkbox" id="lbm-pin" ${it.pinned ? 'checked' : ''} />📌 목록 맨 위에 고정</label>` : ''}
                ${it.files.length ? `<div><div class="font-bold text-slate-600 mb-1">올린 파일 (뺄 파일은 체크 해제)</div>
                    <div class="space-y-1">${it.files.map(f => `<label class="flex items-center gap-2 border border-slate-200 rounded-lg px-2 py-1.5"><input type="checkbox" data-keep="${esc(fileKey(f))}" ${removed.has(fileKey(f)) ? '' : 'checked'} /><span class="flex-1 truncate">${esc(f.name)}</span><span class="text-slate-400">${fmtSize(f.size)}</span></label>`).join('')}</div></div>` : ''}
                <div id="lbm-drop" class="border-2 border-dashed border-sky-300 bg-sky-50/60 rounded-xl p-4 text-center cursor-pointer hover:bg-sky-50">
                    <i data-lucide="upload" class="w-6 h-6 mx-auto text-sky-500"></i>
                    <div class="font-bold text-sky-800 mt-1">파일을 끌어 놓거나 눌러서 고르세요</div>
                    <div class="text-[11px] text-slate-500">여러 개 가능 · 파일 1개 20MB까지</div>
                    <input type="file" id="lbm-file" multiple class="hidden" />
                </div>
                ${picked.length ? `<div class="space-y-1">${picked.map((f, i) => `<div class="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5"><span class="text-emerald-700 font-black">새</span><span class="flex-1 truncate">${esc(f.name)}</span><span class="text-slate-400">${fmtSize(f.size)}</span><button type="button" data-unpick="${i}" class="text-rose-600 font-bold">빼기</button></div>`).join('')}</div>` : ''}
                <div class="flex justify-end gap-2 pt-1">
                    <button type="button" data-close class="px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold">취소</button>
                    <button type="button" id="lbm-save" class="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-black">${orig ? '저장' : '올리기'}</button>
                </div>
            </div>`;
            createIcons({ icons });
            const keepForm = () => {
                it.category = modal.querySelector('#lbm-cat').value;
                it.title = modal.querySelector('#lbm-title').value;
                it.desc = modal.querySelector('#lbm-desc').value;
                it.pinned = modal.querySelector('#lbm-pin')?.checked ?? it.pinned;
            };
            const addFiles = (files) => { keepForm(); picked = [...picked, ...files]; paint(); };
            modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { modal.classList.add('hidden'); modal.innerHTML = ''; }));
            modal.querySelectorAll('[data-keep]').forEach(c => c.addEventListener('change', () => { if (c.checked) removed.delete(c.dataset.keep); else removed.add(c.dataset.keep); }));
            modal.querySelectorAll('[data-unpick]').forEach(b => b.addEventListener('click', () => { keepForm(); picked.splice(Number(b.dataset.unpick), 1); paint(); }));
            const drop = modal.querySelector('#lbm-drop');
            const input = modal.querySelector('#lbm-file');
            drop.addEventListener('click', () => input.click());
            input.addEventListener('change', () => addFiles([...input.files]));
            drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('ring-2', 'ring-sky-400'); });
            drop.addEventListener('dragleave', () => drop.classList.remove('ring-2', 'ring-sky-400'));
            drop.addEventListener('drop', (e) => { e.preventDefault(); addFiles([...(e.dataTransfer?.files || [])]); });
            modal.querySelector('#lbm-save').addEventListener('click', async (e) => {
                keepForm();
                e.target.disabled = true;
                e.target.textContent = '올리는 중...';
                try {
                    const res = await saveLibraryItem(it, { newFiles: picked, removeFiles: [...removed] });
                    modal.classList.add('hidden'); modal.innerHTML = '';
                    showToast(res.isNew ? `📁 '${res.item.title}' 자료를 올렸습니다.` : '💾 자료를 저장했습니다.');
                    await load();
                } catch (err) {
                    alert(err.message);
                    e.target.disabled = false;
                    e.target.textContent = orig ? '저장' : '올리기';
                }
            });
        };
        modal.classList.remove('hidden');
        paint();
        modal.querySelector('#lbm-title').focus();
    };

    const load = async () => {
        $('#lb-list').innerHTML = '<div class="md:col-span-2 xl:col-span-3 p-8 text-center text-xs text-slate-400">불러오는 중...</div>';
        try { list = await listLibrary(); } catch (e) { $('#lb-list').innerHTML = `<div class="md:col-span-2 xl:col-span-3 p-3 text-xs text-rose-600 font-bold">${esc(e.message)}</div>`; return; }
        if (cat && !list.some(it => it.category === cat)) cat = '';
        renderCats();
        renderList();
    };

    $('#lb-new')?.addEventListener('click', () => openEditor(null));
    $('#lb-q').addEventListener('input', (e) => { q = e.target.value; renderList(); });
    $('#lb-list').addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.view) openFile(b.dataset.view);
        else if (b.dataset.dl) { const { f } = findFile(b.dataset.dl); if (f) download([f]); }
        else if (b.dataset.dlall) { const it = list.find(x => x.id === b.dataset.dlall); if (it) download(it.files); }
        else if (b.dataset.edit) { const it = list.find(x => x.id === b.dataset.edit); if (it) openEditor(it); }
        else if (b.dataset.del) {
            const it = list.find(x => x.id === b.dataset.del);
            if (!it || !confirm(`'${it.title}' 자료와 파일 ${it.files.length}개를 삭제할까요? 되돌릴 수 없습니다.`)) return;
            try { await deleteLibraryItem(it); showToast('🗑️ 자료를 삭제했습니다.'); await load(); } catch (err) { alert(err.message); }
        }
    });
    load();
    createIcons({ icons });
};
