// ==========================================
// 문서 첨부파일 목록 (화면 안에 붙이기 · 팝업 창)
// ==========================================
// mountAttachmentPanel(host, { key, title, readOnly, onChange }) : 문서 화면 안에 첨부 목록 + 올리기
// openAttachmentsModal(key, { title, onChange })                : 떠 있는 창으로 같은 목록
// 파일은 services/attachments.js (클라우드 비공개 저장소 / 로컬 모드 브라우저)
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { fmtSize } from '../services/fileStore.js';
import {
    listAttachments, addAttachments, removeAttachment, attachmentUrl, downloadAttachment, canRemoveAttachment, canAttach
} from '../services/attachments.js';

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const isImage = (a) => /^image\//.test(a.mime || '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || '');
const fileIcon = (a) => (isImage(a) ? 'image' : /pdf/i.test(`${a.mime} ${a.name}`) ? 'file-text'
    : /sheet|excel|\.xlsx?$|\.csv$/i.test(`${a.mime} ${a.name}`) ? 'file-spreadsheet' : 'file');

/**
 * 첨부 목록 붙이기
 * @param host  넣을 요소
 * @param opts  { key: 문서 키(없으면 '저장 후 첨부' 안내), title, readOnly, onChange(n), compact }
 * @returns { refresh() }
 */
export const mountAttachmentPanel = (host, { key, title = '첨부파일', readOnly = false, onChange = () => {}, compact = false } = {}) => {
    if (!host) return { refresh: async () => {} };
    let list = [];
    let busy = false;
    const writable = !readOnly && canAttach() && !!key;

    const draw = () => {
        host.innerHTML = `
        <div class="att-panel space-y-2 text-xs">
            <div class="flex items-center justify-between gap-2">
                <div class="font-black text-slate-700 flex items-center gap-1.5"><i data-lucide="paperclip" class="w-4 h-4 text-slate-500"></i>${esc(title)} <span class="text-slate-400">${list.length}개</span></div>
                ${writable ? `<button type="button" data-add class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-bold flex items-center gap-1 ${busy ? 'opacity-50 pointer-events-none' : ''}"><i data-lucide="upload" class="w-3.5 h-3.5"></i>${busy ? '올리는 중...' : '파일 첨부'}</button>` : ''}
                <input type="file" multiple class="hidden" data-file />
            </div>
            ${!key ? '<div class="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-bold">문서를 먼저 저장하면 파일을 첨부할 수 있습니다.</div>' : ''}
            ${key && list.length === 0 ? `<div data-drop class="p-4 rounded-xl border-2 border-dashed ${writable ? 'border-slate-300 hover:bg-slate-50 cursor-pointer' : 'border-slate-200'} text-center text-slate-400">${writable ? '파일을 끌어 놓거나 눌러서 첨부하세요 (여러 개 · 1개 20MB까지)' : '첨부파일이 없습니다.'}</div>` : ''}
            ${list.length ? `<ul data-drop class="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">${list.map(a => `
                <li class="flex items-center gap-2 px-2.5 py-1.5">
                    ${isImage(a) && !compact ? `<img data-thumb="${esc(a.id)}" alt="" class="w-9 h-9 object-cover rounded border border-slate-200 bg-slate-50" />` : `<i data-lucide="${fileIcon(a)}" class="w-4 h-4 text-slate-400 shrink-0"></i>`}
                    <button type="button" data-open="${esc(a.id)}" class="min-w-0 flex-1 text-left">
                        <div class="font-bold text-slate-800 truncate hover:text-blue-700" title="${esc(a.name)}">${esc(a.name)}</div>
                        <div class="text-[10px] text-slate-400">${fmtSize(a.size)} · ${esc(a.by || '')} · ${esc(fmtTime(a.at))}</div>
                    </button>
                    <button type="button" data-dl="${esc(a.id)}" class="p-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700" title="받기"><i data-lucide="download" class="w-3.5 h-3.5"></i></button>
                    ${!readOnly && canRemoveAttachment(a) ? `<button type="button" data-del="${esc(a.id)}" class="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600" title="삭제"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>` : ''}
                </li>`).join('')}</ul>` : ''}
        </div>`;
        createIcons({ icons });
        host.querySelectorAll('img[data-thumb]').forEach(async (img) => {
            const a = list.find(x => x.id === img.dataset.thumb);
            try { img.src = await attachmentUrl(a); } catch (e) { console.warn('[첨부] 미리보기 실패:', e.message); }
        });
        const input = host.querySelector('[data-file]');
        host.querySelector('[data-add]')?.addEventListener('click', () => input.click());
        input.addEventListener('change', () => { upload([...input.files]); input.value = ''; });
        const drop = host.querySelector('[data-drop]');
        if (drop && writable) {
            if (!list.length) drop.addEventListener('click', () => input.click());
            drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('ring-2', 'ring-sky-400'); });
            drop.addEventListener('dragleave', () => drop.classList.remove('ring-2', 'ring-sky-400'));
            drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('ring-2', 'ring-sky-400'); upload([...(e.dataTransfer?.files || [])]); });
        }
    };

    const upload = async (files) => {
        if (!files.length || busy) return;
        busy = true; draw();
        try {
            await addAttachments(key, files);
        } catch (e) { alert(e.message); }
        busy = false;
        await refresh();
    };

    const refresh = async () => {
        if (key) {
            try { list = await listAttachments(key); } catch (e) { host.innerHTML = `<div class="p-2 text-xs text-rose-600 font-bold">${esc(e.message)}</div>`; return; }
        } else list = [];
        draw();
        onChange(list.length);
    };

    host.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b || !host.contains(b)) return;
        const a = list.find(x => x.id === (b.dataset.open || b.dataset.dl || b.dataset.del));
        if (!a) return;
        if (b.dataset.open) {
            const w = window.open('', '_blank'); // 팝업 차단을 피하려고 누른 즉시 연다
            try { const url = await attachmentUrl(a); if (w) w.location.href = url; } catch (err) { w?.close(); alert(err.message); }
        } else if (b.dataset.dl) {
            try { await downloadAttachment(a); } catch (err) { alert(err.message); }
        } else if (b.dataset.del) {
            if (!confirm(`첨부파일 '${a.name}'을 삭제할까요? 되돌릴 수 없습니다.`)) return;
            try { await removeAttachment(a); await refresh(); } catch (err) { alert(err.message); }
        }
    });

    draw();
    refresh();
    return { refresh };
};

/** 떠 있는 창으로 첨부 목록 열기 */
export const openAttachmentsModal = (key, { title = '첨부파일', docTitle = '', onChange = () => {}, readOnly = false } = {}) => {
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4';
    wrap.innerHTML = `
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-3">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0"><div class="text-base font-black text-slate-900">${esc(title)}</div>${docTitle ? `<div class="text-[11px] text-slate-500 truncate">${esc(docTitle)}</div>` : ''}</div>
                <button type="button" data-close class="p-1 rounded-lg hover:bg-slate-100"><i data-lucide="x" class="w-4 h-4"></i></button>
            </div>
            <div data-panel></div>
        </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('[data-close]').addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    mountAttachmentPanel(wrap.querySelector('[data-panel]'), { key, title: '첨부파일', onChange, readOnly });
    createIcons({ icons });
};
