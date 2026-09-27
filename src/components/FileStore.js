import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { matchesQuery, localDateStr } from '../services/searchUtils.js';
import { listPeople } from '../services/assign.js';
import {
    listItemImages, uploadItemImage, setPrimaryImage, deleteItemImage, fileUrls, fileUrl,
    listDocuments, saveDocument, deleteDocument, DOC_DIRECTIONS, DOC_TYPES, fmtSize
} from '../services/fileStore.js';

// 파일 저장소 (탭 fileStore)
// - 품목 사진: 품목마다 사진 여러 장, ★ 대표 사진이 품목마스터에 보인다 (끌어놓기·붙여넣기·여러 장)
// - 접수·발행 문서: 받은 문서(접수)·보낸 문서(발행) 대장 + 첨부. 접수번호는 자동(접수-2026-0001)
const TAB_KEY = 'daelim_filestore_tab';

export const renderFileStore = (container, { showToast = () => {} } = {}) => {
    let tab = 'images';
    try { tab = localStorage.getItem(TAB_KEY) === 'docs' ? 'docs' : 'images'; } catch { /* 무시 */ }
    const canWrite = canPerformAction('WRITE_STOCK');
    const isManager = canPerformAction('EDIT_MASTER');
    const me = state.currentUser || {};
    const canRemove = (row) => isManager || (row.uploadedBy && String(row.uploadedBy) === String(me.id)) || (!row.uploadedBy && row.by && row.by === (me.name || ''));

    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div>
                <h2 class="text-lg font-black text-slate-900 flex items-center gap-2"><i data-lucide="folder-open" class="w-5 h-5 text-blue-600"></i>파일 저장소</h2>
                <p class="text-xs text-slate-500 mt-1">품목 사진(품목마스터 대표 사진)과 접수·발행 문서를 한곳에 보관합니다. 파일은 회사 전용 비공개 저장소에 저장됩니다.</p>
            </div>
            <div class="flex gap-1 bg-slate-100 p-1 rounded-xl text-sm">
                <button type="button" data-tab="images" class="fs-tab px-4 py-2 rounded-lg font-black flex items-center gap-1.5"><i data-lucide="image" class="w-4 h-4"></i>품목 사진</button>
                <button type="button" data-tab="docs" class="fs-tab px-4 py-2 rounded-lg font-black flex items-center gap-1.5"><i data-lucide="file-text" class="w-4 h-4"></i>접수·발행 문서</button>
            </div>
        </div>
        <div id="fs-body"></div>
    </section>
    <div id="fs-viewer" class="hidden fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4"></div>`;
    const body = container.querySelector('#fs-body');
    const viewer = container.querySelector('#fs-viewer');

    const paintTabs = () => container.querySelectorAll('.fs-tab').forEach(b => {
        b.className = `fs-tab px-4 py-2 rounded-lg font-black flex items-center gap-1.5 ${b.dataset.tab === tab ? 'bg-white shadow-sm text-blue-700' : 'text-slate-600 hover:text-slate-900'}`;
    });
    container.querySelectorAll('.fs-tab').forEach(b => b.addEventListener('click', () => {
        tab = b.dataset.tab;
        try { localStorage.setItem(TAB_KEY, tab); } catch { /* 무시 */ }
        paintTabs(); show();
    }));

    // 크게 보기 (이미지) / 새 창 (PDF 등)
    const openViewer = async (item, title = '') => {
        try {
            const url = await fileUrl(item);
            if (!url) throw new Error('파일 주소가 없습니다.');
            if (!/^image\//.test(item.mime || '') && !/\.(jpe?g|png|gif|webp|bmp)$/i.test(item.name || '')) { window.open(url, '_blank', 'noopener'); return; }
            viewer.innerHTML = `<div class="max-w-5xl w-full space-y-2">
                <div class="flex items-center justify-between text-white text-sm font-bold"><span>${esc(title || item.name)}</span>
                    <span class="flex gap-2"><a href="${esc(url)}" download="${esc(item.name)}" target="_blank" rel="noopener" class="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg">받기</a><button type="button" data-close class="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg">닫기 ✕</button></span></div>
                <img src="${esc(url)}" class="max-h-[80vh] mx-auto rounded-xl bg-white" alt=""></div>`;
            viewer.classList.remove('hidden');
        } catch (e) { showToast(e.message, 'error'); }
    };
    viewer.addEventListener('click', (e) => { if (e.target === viewer || e.target.closest('[data-close]')) viewer.classList.add('hidden'); });

    // 파일 받기 칸 공용: 버튼·끌어놓기·붙여넣기
    const bindDrop = (zone, input, onFiles) => {
        zone.addEventListener('click', () => input.click());
        input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('ring-2', 'ring-blue-400'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('ring-2', 'ring-blue-400'));
        zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('ring-2', 'ring-blue-400'); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
    };

    // ==================== 품목 사진 ====================
    const img = { rows: [], loaded: false, q: '', cat: '', has: 'ALL', code: '', thumbs: new Map() };
    const showImages = async () => {
        if (!img.loaded) {
            body.innerHTML = '<div class="p-10 text-center text-slate-400 text-sm">사진 목록을 불러오는 중…</div>';
            try { img.rows = await listItemImages(); img.loaded = true; } catch (e) { body.innerHTML = `<div class="p-6 text-rose-600 text-sm">${esc(e.message)}</div>`; return; }
            const prim = img.rows.filter(r => r.primary);
            img.thumbs = await fileUrls(prim).catch(() => new Map());
        }
        const byCode = new Map();
        img.rows.forEach(r => { if (!byCode.has(r.code)) byCode.set(r.code, []); byCode.get(r.code).push(r); });
        const cats = [...new Set(state.master.map(m => m.category).filter(Boolean))];
        const items = state.master.filter(m => (!img.cat || m.category === img.cat)
            && (img.has === 'ALL' || (img.has === 'YES' ? byCode.has(m.code) : !byCode.has(m.code)))
            && (!img.q || matchesQuery(`${m.code} ${m.name} ${m.spec || ''}`, img.q)));
        const withPhoto = state.master.filter(m => byCode.has(m.code)).length;
        const shown = items.slice(0, 300);
        const sel = state.master.find(m => m.code === img.code);
        const selImgs = sel ? (byCode.get(sel.code) || []) : [];
        const thumbOf = (code) => { const p = (byCode.get(code) || []).find(r => r.primary); return p ? img.thumbs.get(p.path || p.id) : ''; };

        body.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div class="lg:col-span-5 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="flex flex-wrap gap-2 text-xs">
                    <input id="fi-q" value="${esc(img.q)}" placeholder="품목코드·품목명 검색" class="flex-1 min-w-[140px] border border-slate-300 rounded-lg px-2.5 py-2">
                    <select id="fi-cat" class="border border-slate-300 rounded-lg px-2 py-2"><option value="">전체 분류</option>${cats.map(c => `<option ${img.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
                    <select id="fi-has" class="border border-slate-300 rounded-lg px-2 py-2">
                        <option value="ALL" ${img.has === 'ALL' ? 'selected' : ''}>전체</option><option value="YES" ${img.has === 'YES' ? 'selected' : ''}>사진 있음</option><option value="NO" ${img.has === 'NO' ? 'selected' : ''}>사진 없음</option></select>
                </div>
                <div class="text-[11px] text-slate-500 font-bold">품목 ${state.master.length}개 중 사진 있는 품목 <b class="text-blue-700">${withPhoto}</b>개 · 사진 ${img.rows.length}장 · 목록 ${items.length}개${items.length > shown.length ? ` (앞 ${shown.length}개 표시, 검색으로 좁히세요)` : ''}</div>
                <div class="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
                    ${shown.length ? shown.map(m => { const t = thumbOf(m.code); const n = (byCode.get(m.code) || []).length; return `
                    <button type="button" data-code="${esc(m.code)}" class="fi-item w-full flex items-center gap-3 p-2 text-left hover:bg-blue-50 ${m.code === img.code ? 'bg-blue-50' : ''}">
                        <span class="w-11 h-11 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">${t ? `<img src="${esc(t)}" class="w-full h-full object-cover" alt="">` : '<i data-lucide="image-off" class="w-4 h-4 text-slate-300"></i>'}</span>
                        <span class="min-w-0 flex-1"><span class="block text-xs font-black text-slate-800 truncate">${esc(m.name)}</span><span class="block text-[11px] text-slate-500 font-mono truncate">${esc(m.code)} · ${esc(m.category || '')}${m.spec ? ` · ${esc(m.spec)}` : ''}</span></span>
                        ${n ? `<span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">${n}장</span>` : ''}
                    </button>`; }).join('') : '<div class="p-6 text-center text-slate-400 text-xs">찾는 품목이 없습니다.</div>'}
                </div>
            </div>
            <div class="lg:col-span-7 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                ${sel ? `
                <div class="flex flex-wrap items-start justify-between gap-2 border-b pb-2">
                    <div><div class="text-sm font-black text-slate-900">${esc(sel.name)}</div><div class="text-xs text-slate-500 font-mono">${esc(sel.code)} · ${esc(sel.category || '')}${sel.spec ? ` · ${esc(sel.spec)}` : ''}</div></div>
                    <div class="text-[11px] text-slate-500">★ 대표 사진이 품목마스터·검색 화면에 보입니다.</div>
                </div>
                ${canWrite ? `<div id="fi-drop" class="border-2 border-dashed border-blue-300 bg-blue-50/50 rounded-xl p-5 text-center cursor-pointer hover:bg-blue-50">
                    <i data-lucide="image-plus" class="w-6 h-6 text-blue-500 mx-auto"></i>
                    <div class="text-xs font-black text-blue-700 mt-1">사진 올리기 — 눌러서 고르거나, 끌어다 놓거나, 복사한 사진을 붙여넣기(Ctrl+V)</div>
                    <div class="text-[11px] text-slate-500">여러 장 가능 · 긴 변 1600px로 줄여 저장 · 첫 사진은 자동으로 대표</div>
                    <input type="file" id="fi-file" accept="image/*" multiple class="hidden"></div>` : '<div class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">사진 올리기는 현장 작업자 이상만 할 수 있습니다.</div>'}
                <div id="fi-grid" class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                    ${selImgs.length ? selImgs.map(r => `
                    <div class="border ${r.primary ? 'border-amber-400 ring-2 ring-amber-200' : 'border-slate-200'} rounded-xl overflow-hidden bg-slate-50">
                        <button type="button" data-view="${esc(r.id)}" class="block w-full aspect-square bg-white"><img data-img="${esc(r.id)}" class="w-full h-full object-contain" alt=""></button>
                        <div class="p-2 space-y-1">
                            <div class="flex items-center justify-between gap-1 text-[10px] text-slate-500"><span class="truncate" title="${esc(r.name)}">${esc(r.by || '')} · ${esc(String(r.at || '').slice(0, 10))}</span>${r.primary ? '<span class="font-black text-amber-600">★ 대표</span>' : ''}</div>
                            <div class="flex gap-1">
                                ${canWrite && !r.primary ? `<button type="button" data-primary="${esc(r.id)}" class="flex-1 px-1.5 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-bold">★ 대표로</button>` : ''}
                                ${canRemove(r) ? `<button type="button" data-del="${esc(r.id)}" class="px-1.5 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold">삭제</button>` : ''}
                            </div>
                        </div>
                    </div>`).join('') : '<div class="col-span-full p-8 text-center text-slate-400 text-xs">아직 사진이 없습니다.</div>'}
                </div>` : '<div class="p-12 text-center text-slate-400 text-sm"><i data-lucide="mouse-pointer-click" class="w-6 h-6 mx-auto mb-2"></i>왼쪽에서 품목을 고르세요.</div>'}
            </div>
        </div>`;
        createIcons({ icons });

        // 선택 품목 사진 채우기
        if (selImgs.length) fileUrls(selImgs).then(urls => selImgs.forEach(r => { const el = body.querySelector(`[data-img="${CSS.escape(r.id)}"]`); if (el) el.src = urls.get(r.path || r.id) || ''; })).catch(e => showToast(e.message, 'error'));

        const redraw = () => showImages();
        body.querySelector('#fi-q').addEventListener('input', (e) => { img.q = e.target.value; clearTimeout(img.t); img.t = setTimeout(() => { redraw().then(() => { const q = body.querySelector('#fi-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 250); });
        body.querySelector('#fi-cat').addEventListener('change', (e) => { img.cat = e.target.value; redraw(); });
        body.querySelector('#fi-has').addEventListener('change', (e) => { img.has = e.target.value; redraw(); });
        body.querySelectorAll('.fi-item').forEach(b => b.addEventListener('click', () => { img.code = b.dataset.code; redraw(); }));

        const upload = async (files) => {
            const list = files.filter(f => /^image\//.test(f.type));
            if (!list.length) { showToast('이미지 파일만 올릴 수 있습니다.', 'error'); return; }
            let ok = 0;
            for (const f of list) {
                try { const row = await uploadItemImage(sel.code, f); img.rows = img.rows.map(r => (row.primary && r.code === sel.code ? { ...r, primary: false } : r)); img.rows.unshift(row); ok++; } catch (e) { showToast(e.message, 'error'); }
            }
            if (ok) {
                showToast(`${sel.name}: 사진 ${ok}장을 올렸습니다.`, 'success');
                img.thumbs = await fileUrls(img.rows.filter(r => r.primary)).catch(() => img.thumbs);
            }
            redraw();
        };
        const drop = body.querySelector('#fi-drop');
        if (drop) bindDrop(drop, body.querySelector('#fi-file'), upload);
        body.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { const r = selImgs.find(x => x.id === b.dataset.view); if (r) openViewer(r, `${sel.name} (${sel.code})`); }));
        body.querySelectorAll('[data-primary]').forEach(b => b.addEventListener('click', async () => {
            const r = selImgs.find(x => x.id === b.dataset.primary);
            try { await setPrimaryImage(r); img.rows = img.rows.map(x => (x.code === r.code ? { ...x, primary: x.id === r.id } : x)); img.thumbs = await fileUrls(img.rows.filter(x => x.primary)).catch(() => img.thumbs); showToast('대표 사진을 바꿨습니다.', 'success'); redraw(); } catch (e) { showToast(e.message, 'error'); }
        }));
        body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
            const r = selImgs.find(x => x.id === b.dataset.del);
            if (!r || !confirm('이 사진을 삭제할까요?')) return;
            try { await deleteItemImage(r); img.loaded = false; showToast('사진을 삭제했습니다.', 'success'); redraw(); } catch (e) { showToast(e.message, 'error'); }
        }));
    };
    // 품목 사진 화면에서 붙여넣기(Ctrl+V)
    const onPaste = (e) => {
        if (tab !== 'images' || !img.code || !canWrite || !container.isConnected) return;
        if (e.target.closest?.('input, textarea')) return;
        const files = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
        if (!files.length) return;
        e.preventDefault();
        const drop = body.querySelector('#fi-file');
        if (drop) { const dt = new DataTransfer(); files.forEach(f => dt.items.add(f)); drop.files = dt.files; drop.dispatchEvent(new Event('change')); }
    };
    document.addEventListener('paste', onPaste);
    const obs = new MutationObserver(() => { if (!container.contains(body)) { document.removeEventListener('paste', onPaste); obs.disconnect(); } });
    obs.observe(container, { childList: true });

    // ==================== 접수·발행 문서 ====================
    const doc = { rows: [], loaded: false, dir: '', type: '', q: '', month: '' };
    const showDocs = async () => {
        if (!doc.loaded) {
            body.innerHTML = '<div class="p-10 text-center text-slate-400 text-sm">문서 목록을 불러오는 중…</div>';
            try { doc.rows = await listDocuments(); doc.loaded = true; } catch (e) { body.innerHTML = `<div class="p-6 text-rose-600 text-sm">${esc(e.message)}</div>`; return; }
        }
        const months = [...new Set(doc.rows.map(d => String(d.date).slice(0, 7)))].sort().reverse();
        const rows = doc.rows.filter(d => (!doc.dir || d.direction === doc.dir) && (!doc.type || d.type === doc.type) && (!doc.month || String(d.date).startsWith(doc.month))
            && (!doc.q || matchesQuery(`${d.regNo} ${d.title} ${d.party} ${d.docNo} ${d.memo} ${d.assignee} ${d.files.map(f => f.name).join(' ')}`, doc.q)));
        const cnt = (dir) => doc.rows.filter(d => d.direction === dir).length;
        body.innerHTML = `
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <div class="flex gap-1 bg-slate-100 p-1 rounded-lg">${[['', `전체 ${doc.rows.length}`], ['RECEIVED', `접수 ${cnt('RECEIVED')}`], ['ISSUED', `발행 ${cnt('ISSUED')}`]].map(([k, l]) => `<button type="button" data-dir="${k}" class="fd-dir px-3 py-1.5 rounded-md font-black ${doc.dir === k ? 'bg-white shadow-sm text-blue-700' : 'text-slate-600'}">${l}</button>`).join('')}</div>
                <select id="fd-month" class="border border-slate-300 rounded-lg px-2 py-1.5"><option value="">전체 기간</option>${months.map(m => `<option value="${m}" ${doc.month === m ? 'selected' : ''}>${m.replace('-', '년 ')}월</option>`).join('')}</select>
                <select id="fd-type" class="border border-slate-300 rounded-lg px-2 py-1.5"><option value="">전체 종류</option>${DOC_TYPES.map(t => `<option ${doc.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
                <input id="fd-q" value="${esc(doc.q)}" placeholder="접수번호·제목·상대처·문서번호·파일명 검색" class="flex-1 min-w-[180px] border border-slate-300 rounded-lg px-2.5 py-1.5">
                <button type="button" id="fd-excel" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-1"><i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i>엑셀</button>
                ${canWrite ? `<button type="button" id="fd-new-in" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-1"><i data-lucide="inbox" class="w-3.5 h-3.5"></i>문서 접수</button>
                <button type="button" id="fd-new-out" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center gap-1"><i data-lucide="send" class="w-3.5 h-3.5"></i>문서 발행</button>` : ''}
            </div>
            <div class="overflow-auto border border-slate-200 rounded-xl max-h-[65vh]">
                <table class="w-full text-xs">
                    <thead class="bg-slate-50 text-slate-600 sticky top-0"><tr>
                        <th class="p-2 text-left">접수번호</th><th class="p-2">구분</th><th class="p-2">일자</th><th class="p-2 text-left">종류</th><th class="p-2 text-left">상대처</th><th class="p-2 text-left">제목</th><th class="p-2 text-left">문서번호</th><th class="p-2 text-left">담당자</th><th class="p-2">첨부</th><th class="p-2 text-left">등록</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length ? rows.map(d => `<tr data-doc="${esc(d.id)}" class="hover:bg-blue-50/60 cursor-pointer">
                            <td class="p-2 font-mono font-bold">${esc(d.regNo)}</td>
                            <td class="p-2 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${d.direction === 'RECEIVED' ? 'bg-blue-100 text-blue-800' : 'bg-indigo-100 text-indigo-800'}">${DOC_DIRECTIONS[d.direction]}</span></td>
                            <td class="p-2 text-center font-mono">${esc(d.date)}</td><td class="p-2">${esc(d.type)}</td><td class="p-2">${esc(d.party)}</td>
                            <td class="p-2 font-bold text-slate-800">${esc(d.title)}</td><td class="p-2 font-mono text-slate-500">${esc(d.docNo)}</td><td class="p-2">${esc(d.assignee)}</td>
                            <td class="p-2 text-center">${d.files.length ? `<span class="inline-flex items-center gap-0.5 font-bold text-slate-600"><i data-lucide="paperclip" class="w-3 h-3"></i>${d.files.length}</span>` : '-'}</td>
                            <td class="p-2 text-slate-500">${esc(d.by)}</td></tr>`).join('') : `<tr><td colspan="10" class="p-8 text-center text-slate-400">${doc.rows.length ? '조건에 맞는 문서가 없습니다.' : '등록된 문서가 없습니다.'}</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>
        <div id="fd-modal" class="hidden fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"></div>`;
        createIcons({ icons });

        body.querySelectorAll('.fd-dir').forEach(b => b.addEventListener('click', () => { doc.dir = b.dataset.dir; showDocs(); }));
        body.querySelector('#fd-month').addEventListener('change', (e) => { doc.month = e.target.value; showDocs(); });
        body.querySelector('#fd-type').addEventListener('change', (e) => { doc.type = e.target.value; showDocs(); });
        body.querySelector('#fd-q').addEventListener('input', (e) => { doc.q = e.target.value; clearTimeout(doc.t); doc.t = setTimeout(() => showDocs().then(() => { const q = body.querySelector('#fd-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }), 250); });
        body.querySelector('#fd-new-in')?.addEventListener('click', () => openDocModal({ direction: 'RECEIVED', date: localDateStr(), files: [] }));
        body.querySelector('#fd-new-out')?.addEventListener('click', () => openDocModal({ direction: 'ISSUED', date: localDateStr(), files: [] }));
        body.querySelectorAll('tr[data-doc]').forEach(tr => tr.addEventListener('click', () => openDocModal(doc.rows.find(d => d.id === tr.dataset.doc))));
        body.querySelector('#fd-excel').addEventListener('click', async () => {
            const XLSX = await import('xlsx');
            const ws = XLSX.utils.json_to_sheet(rows.map(d => ({ 접수번호: d.regNo, 구분: DOC_DIRECTIONS[d.direction], 일자: d.date, 종류: d.type, 상대처: d.party, 제목: d.title, 문서번호: d.docNo, 담당자: d.assignee, 첨부: d.files.map(f => f.name).join(', '), 메모: d.memo, 등록자: d.by })));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '문서대장');
            XLSX.writeFile(wb, `문서대장_${doc.dir ? DOC_DIRECTIONS[doc.dir] : '전체'}_${localDateStr()}.xlsx`);
        });
    };

    const openDocModal = async (d) => {
        const modal = body.querySelector('#fd-modal');
        const isNew = !d.id;
        const editable = isNew ? canWrite : canRemove(d);
        const newFiles = [];
        const removed = new Set();
        const people = await listPeople().catch(() => []);
        const partyList = [...new Set(doc.rows.map(x => x.party).filter(Boolean))].slice(0, 300);
        const dirLabel = DOC_DIRECTIONS[d.direction];
        const draw = () => {
            const existing = (d.files || []).filter(f => !removed.has(f.path || f.id));
            modal.innerHTML = `
            <div class="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div class="px-5 py-3 ${d.direction === 'RECEIVED' ? 'bg-blue-700' : 'bg-indigo-700'} text-white flex items-center justify-between">
                    <h3 class="font-black text-sm flex items-center gap-2"><i data-lucide="${d.direction === 'RECEIVED' ? 'inbox' : 'send'}" class="w-4 h-4"></i>${isNew ? `새 문서 ${dirLabel}` : `${esc(d.regNo)} · ${dirLabel} 문서`}</h3>
                    <button type="button" data-close class="text-lg">&times;</button>
                </div>
                <div class="p-5 space-y-3 overflow-y-auto text-xs">
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <label class="space-y-1"><span class="font-bold text-slate-600">구분</span>
                            <select id="fdm-dir" class="w-full border border-slate-300 rounded-lg px-2 py-2" ${editable && isNew ? '' : 'disabled'}>${Object.entries(DOC_DIRECTIONS).map(([k, l]) => `<option value="${k}" ${d.direction === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                        <label class="space-y-1"><span class="font-bold text-slate-600">${d.direction === 'RECEIVED' ? '받은 날' : '보낸 날'}</span><input type="date" id="fdm-date" value="${esc(d.date || '')}" class="w-full border border-slate-300 rounded-lg px-2 py-2" ${editable ? '' : 'disabled'}></label>
                        <label class="space-y-1"><span class="font-bold text-slate-600">종류</span><select id="fdm-type" class="w-full border border-slate-300 rounded-lg px-2 py-2" ${editable ? '' : 'disabled'}><option value="">(선택)</option>${DOC_TYPES.map(t => `<option ${d.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
                        <label class="space-y-1"><span class="font-bold text-slate-600">문서번호(원본)</span><input id="fdm-docno" value="${esc(d.docNo || '')}" placeholder="예: 세금계산서 번호" class="w-full border border-slate-300 rounded-lg px-2 py-2" ${editable ? '' : 'disabled'}></label>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label class="space-y-1"><span class="font-bold text-slate-600">${d.direction === 'RECEIVED' ? '보낸 곳 (발신처)' : '받는 곳 (수신처)'}</span><input id="fdm-party" list="fdm-party-list" value="${esc(d.party || '')}" class="w-full border border-slate-300 rounded-lg px-2 py-2" ${editable ? '' : 'disabled'}>
                            <datalist id="fdm-party-list">${partyList.map(p => `<option value="${esc(p)}">`).join('')}</datalist></label>
                        <label class="space-y-1"><span class="font-bold text-slate-600">담당자</span><input id="fdm-assignee" list="fdm-people" value="${esc(d.assignee || '')}" class="w-full border border-slate-300 rounded-lg px-2 py-2" ${editable ? '' : 'disabled'}>
                            <datalist id="fdm-people">${people.map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></label>
                    </div>
                    <label class="block space-y-1"><span class="font-bold text-slate-600">제목 *</span><input id="fdm-title" value="${esc(d.title || '')}" class="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm font-bold" ${editable ? '' : 'disabled'}></label>
                    <label class="block space-y-1"><span class="font-bold text-slate-600">메모</span><textarea id="fdm-memo" rows="2" class="w-full border border-slate-300 rounded-lg px-2 py-2" ${editable ? '' : 'disabled'}>${esc(d.memo || '')}</textarea></label>
                    <div class="space-y-1.5">
                        <div class="font-bold text-slate-600">첨부 파일 (${existing.length + newFiles.length})</div>
                        ${existing.map(f => `<div class="flex items-center gap-2 p-2 border border-slate-200 rounded-lg"><i data-lucide="file" class="w-4 h-4 text-slate-400"></i><span class="flex-1 truncate font-bold">${esc(f.name)}</span><span class="text-slate-400">${fmtSize(f.size)}</span>
                            <button type="button" data-open="${esc(f.path || f.id)}" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 font-bold">보기</button>
                            ${editable ? `<button type="button" data-remove="${esc(f.path || f.id)}" class="px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold">빼기</button>` : ''}</div>`).join('')}
                        ${newFiles.map((f, i) => `<div class="flex items-center gap-2 p-2 border border-blue-200 bg-blue-50/50 rounded-lg"><i data-lucide="file-plus" class="w-4 h-4 text-blue-500"></i><span class="flex-1 truncate font-bold">${esc(f.name)}</span><span class="text-slate-400">${fmtSize(f.size)} · 새 파일</span><button type="button" data-unnew="${i}" class="px-2 py-1 rounded bg-slate-100 font-bold">취소</button></div>`).join('')}
                        ${editable ? `<div id="fdm-drop" class="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center cursor-pointer hover:bg-slate-50"><i data-lucide="upload" class="w-5 h-5 text-slate-400 mx-auto"></i><div class="font-bold text-slate-600 mt-1">파일 붙이기 — 눌러서 고르거나 끌어다 놓기 (PDF·사진·엑셀·한글 등, 파일당 20MB)</div><input type="file" id="fdm-file" multiple class="hidden"></div>` : ''}
                    </div>
                    ${!isNew ? `<div class="text-[11px] text-slate-400">등록: ${esc(d.by || '-')} · ${esc(String(d.at || '').slice(0, 16).replace('T', ' '))}${d.updatedAt && d.updatedAt !== d.at ? ` · 수정 ${esc(String(d.updatedAt).slice(0, 16).replace('T', ' '))}` : ''}</div>` : ''}
                </div>
                <div class="px-5 py-3 border-t flex items-center justify-between gap-2">
                    <div>${!isNew && canRemove(d) ? '<button type="button" id="fdm-del" class="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold">문서 삭제</button>' : ''}</div>
                    <div class="flex gap-2"><button type="button" data-close class="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold">닫기</button>
                        ${editable ? `<button type="button" id="fdm-save" class="px-4 py-2 rounded-lg ${d.direction === 'RECEIVED' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white text-xs font-black">${isNew ? `${dirLabel} 등록` : '저장'}</button>` : ''}</div>
                </div>
            </div>`;
            createIcons({ icons });
            const keep = () => {
                d.direction = modal.querySelector('#fdm-dir').value; d.date = modal.querySelector('#fdm-date').value; d.type = modal.querySelector('#fdm-type').value;
                d.docNo = modal.querySelector('#fdm-docno').value; d.party = modal.querySelector('#fdm-party').value; d.assignee = modal.querySelector('#fdm-assignee').value;
                d.title = modal.querySelector('#fdm-title').value; d.memo = modal.querySelector('#fdm-memo').value;
            };
            modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => modal.classList.add('hidden')));
            modal.querySelector('#fdm-dir')?.addEventListener('change', () => { keep(); draw(); });
            const drop = modal.querySelector('#fdm-drop');
            if (drop) bindDrop(drop, modal.querySelector('#fdm-file'), (files) => { keep(); newFiles.push(...files); draw(); });
            modal.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { const f = (d.files || []).find(x => (x.path || x.id) === b.dataset.open); if (f) openViewer(f, `${d.regNo || ''} ${f.name}`); }));
            modal.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => { keep(); removed.add(b.dataset.remove); draw(); }));
            modal.querySelectorAll('[data-unnew]').forEach(b => b.addEventListener('click', () => { keep(); newFiles.splice(Number(b.dataset.unnew), 1); draw(); }));
            modal.querySelector('#fdm-save')?.addEventListener('click', async (e) => {
                keep();
                const btn = e.currentTarget; btn.disabled = true; btn.textContent = '저장 중…';
                try {
                    const res = await saveDocument(d, { newFiles, removeFiles: [...removed] });
                    doc.rows = [res.doc, ...doc.rows.filter(x => x.id !== res.doc.id)];
                    showToast(res.isNew ? `${res.doc.regNo} ${DOC_DIRECTIONS[res.doc.direction]} 등록했습니다.` : '문서를 저장했습니다.', 'success');
                    modal.classList.add('hidden');
                    showDocs();
                } catch (err) { showToast(err.message, 'error'); btn.disabled = false; btn.textContent = isNew ? `${dirLabel} 등록` : '저장'; }
            });
            modal.querySelector('#fdm-del')?.addEventListener('click', async () => {
                if (!confirm(`${d.regNo} 문서와 첨부 파일을 모두 삭제할까요? 되돌릴 수 없습니다.`)) return;
                try { await deleteDocument(d); doc.rows = doc.rows.filter(x => x.id !== d.id); showToast('문서를 삭제했습니다.', 'success'); modal.classList.add('hidden'); showDocs(); } catch (err) { showToast(err.message, 'error'); }
            });
        };
        d = { ...d, files: [...(d.files || [])] };
        draw();
        modal.classList.remove('hidden');
    };

    const show = () => (tab === 'docs' ? showDocs() : showImages());
    paintTabs();
    show();
};
