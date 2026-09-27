import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import {
    listNotices, saveNotice, deleteNotice, canPostNotice, canDeleteNotice, canEditNotice,
    noticeSeenAt, markNoticesSeen, isUnreadNotice
} from '../services/notices.js';

// 지원 → 공지사항: 목록(상단 고정·중요·새 공지) + 내용 보기 + 등록·수정(매니저 이상) + 삭제(관리자)
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="text-blue-600 underline break-all">$1</a>').replace(/\n/g, '<br>');

export const renderNoticeBoard = (container, { showToast }) => {
    const pendingId = window.__noticeOpenId || '';
    window.__noticeOpenId = null;
    let list = [];
    let curId = pendingId;
    let editing = null; // 등록·수정 중인 공지 (새 공지는 id 없음)
    let q = '';
    const seenBefore = noticeSeenAt(); // 이 화면을 열기 전 기준으로 '새 공지' 표시

    container.innerHTML = `
    <section class="space-y-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-start justify-between gap-3">
            <div>
                <div class="text-[11px] font-black text-sky-600 flex items-center gap-1"><i data-lucide="megaphone" class="w-3.5 h-3.5"></i>지원 › 공지사항</div>
                <h2 class="text-lg font-black text-slate-900 mt-1">공지사항</h2>
                <p class="text-xs text-slate-500 mt-1">회사 공지를 모아 둡니다. 새 공지가 올라오면 모든 사람의 화면에 <b>알림</b>이 뜨고 <b>전체 대화</b>에 메시지가 갑니다. 등록은 매니저 이상, 삭제는 관리자만 할 수 있습니다.</p>
            </div>
            ${canPostNotice() ? '<button type="button" id="nt-new" class="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white shadow-sm"><i data-lucide="plus" class="w-4 h-4"></i>공지 등록</button>' : ''}
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <aside class="lg:col-span-5 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="flex items-center gap-2 text-xs">
                    <input type="search" id="nt-q" placeholder="제목·내용·작성자 검색" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5" />
                    <span id="nt-count" class="text-slate-500 font-bold whitespace-nowrap"></span>
                </div>
                <div id="nt-list" class="space-y-1.5 max-h-[70vh] overflow-y-auto"></div>
            </aside>
            <article id="nt-view" class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm"></article>
        </div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    const renderList = () => {
        const needle = q.trim().toLowerCase();
        const rows = list.filter(n => !needle || `${n.title} ${n.body} ${n.authorName}`.toLowerCase().includes(needle));
        $('#nt-count').textContent = `${rows.length}건`;
        $('#nt-list').innerHTML = rows.length === 0 ? '<div class="p-8 text-center text-xs text-slate-400">공지사항이 없습니다.</div>' : rows.map(n => `
            <button type="button" data-id="${esc(n.id)}" class="nt-item w-full text-left p-2.5 rounded-xl border text-xs transition ${n.id === curId ? 'border-sky-400 bg-sky-50' : 'border-slate-200 hover:border-slate-400'}">
                <div class="flex items-center gap-1.5 flex-wrap">
                    ${n.pinned ? '<span class="px-1.5 py-0.5 rounded bg-slate-800 text-white text-[10px] font-black">📌 고정</span>' : ''}
                    ${n.important ? '<span class="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black">중요</span>' : ''}
                    ${isUnreadNotice(n, seenBefore) ? '<span class="px-1.5 py-0.5 rounded bg-amber-400 text-white text-[10px] font-black">NEW</span>' : ''}
                    <span class="font-black text-slate-900 truncate">${esc(n.title)}</span>
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">${esc(n.authorName || '')} · ${esc(fmtTime(n.createdAt))}</div>
            </button>`).join('');
        container.querySelectorAll('.nt-item').forEach(b => b.addEventListener('click', () => { if (editing && !confirm('작성 중인 공지를 버릴까요?')) return; editing = null; curId = b.dataset.id; renderList(); renderView(); }));
    };

    const renderView = () => {
        const host = $('#nt-view');
        if (editing) {
            host.innerHTML = `
                <div class="space-y-3 text-xs">
                    <h3 class="text-base font-black text-slate-900">${editing.id ? '공지 수정' : '새 공지 등록'}</h3>
                    <label class="block"><span class="font-bold text-slate-600">제목 *</span>
                        <input id="nt-title" maxlength="200" value="${esc(editing.title || '')}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 font-bold text-sm" /></label>
                    <label class="block"><span class="font-bold text-slate-600">내용</span>
                        <textarea id="nt-body" rows="12" maxlength="10000" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 leading-relaxed">${esc(editing.body || '')}</textarea></label>
                    <div class="flex flex-wrap gap-4 font-bold">
                        <label class="flex items-center gap-1.5 text-rose-600"><input type="checkbox" id="nt-important" ${editing.important ? 'checked' : ''} />중요 공지</label>
                        <label class="flex items-center gap-1.5"><input type="checkbox" id="nt-pinned" ${editing.pinned ? 'checked' : ''} />📌 목록 맨 위에 고정</label>
                    </div>
                    ${editing.id ? '' : '<p class="text-[11px] text-slate-500">등록하면 모든 사람의 화면에 알림이 뜨고, 전체 대화(채팅)에 공지 메시지가 갑니다.</p>'}
                    <div class="flex justify-end gap-2">
                        <button type="button" id="nt-cancel" class="px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold">취소</button>
                        <button type="button" id="nt-save" class="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-black">${editing.id ? '저장' : '등록하고 알리기'}</button>
                    </div>
                </div>`;
            $('#nt-title').focus();
            $('#nt-cancel').addEventListener('click', () => { editing = null; renderView(); });
            $('#nt-save').addEventListener('click', async (e) => {
                const draft = { ...editing, title: $('#nt-title').value, body: $('#nt-body').value, important: $('#nt-important').checked, pinned: $('#nt-pinned').checked };
                e.target.disabled = true;
                try {
                    const res = await saveNotice(draft);
                    editing = null;
                    curId = res.notice.id;
                    markNoticesSeen(res.notice.createdAt);
                    showToast(res.isNew ? `📢 공지를 등록했습니다.${res.messaged ? ' 전체 대화에 알렸습니다.' : ''}` : '💾 공지를 저장했습니다.');
                    await load();
                } catch (err) { alert(err.message); e.target.disabled = false; }
            });
            return;
        }
        const n = list.find(x => x.id === curId);
        if (!n) { host.innerHTML = `<div class="p-10 text-center text-sm text-slate-400">${list.length ? '왼쪽에서 공지를 고르세요.' : '등록된 공지사항이 없습니다.'}</div>`; return; }
        host.innerHTML = `
            <div class="space-y-3">
                <div class="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            ${n.pinned ? '<span class="px-1.5 py-0.5 rounded bg-slate-800 text-white text-[10px] font-black">📌 고정</span>' : ''}
                            ${n.important ? '<span class="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black">중요</span>' : ''}
                        </div>
                        <h3 class="text-lg font-black text-slate-900 mt-1 break-words">${esc(n.title)}</h3>
                        <div class="text-[11px] text-slate-500">${esc(n.authorName || '')} · 등록 ${esc(fmtTime(n.createdAt))}${n.updatedAt && n.updatedAt.slice(0, 16) !== String(n.createdAt).slice(0, 16) ? ` · 수정 ${esc(fmtTime(n.updatedAt))}` : ''}</div>
                    </div>
                    <div class="flex gap-2 text-xs">
                        ${canEditNotice(n) ? '<button type="button" id="nt-edit" class="px-3 py-1.5 rounded-lg bg-white border border-slate-300 font-bold flex items-center gap-1"><i data-lucide="pencil" class="w-3.5 h-3.5"></i>수정</button>' : ''}
                        ${canDeleteNotice() ? '<button type="button" id="nt-del" class="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-600 font-bold flex items-center gap-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i>삭제</button>' : ''}
                    </div>
                </div>
                <div class="text-sm text-slate-800 leading-relaxed break-words min-h-[120px]">${linkify(n.body) || '<span class="text-slate-400">(내용 없음)</span>'}</div>
            </div>`;
        createIcons({ icons });
        $('#nt-edit')?.addEventListener('click', () => { editing = { ...n }; renderView(); });
        $('#nt-del')?.addEventListener('click', async () => {
            if (!confirm(`'${n.title}' 공지를 삭제할까요? 되돌릴 수 없습니다.`)) return;
            try { await deleteNotice(n.id); showToast('🗑️ 공지를 삭제했습니다.'); curId = ''; await load(); } catch (err) { alert(err.message); }
        });
    };

    const load = async () => {
        $('#nt-list').innerHTML = '<div class="p-6 text-center text-xs text-slate-400">불러오는 중...</div>';
        try { list = await listNotices(); } catch (e) { $('#nt-list').innerHTML = `<div class="p-3 text-xs text-rose-600 font-bold">${esc(e.message)}</div>`; return; }
        if (!curId || !list.some(n => n.id === curId)) curId = list[0]?.id || '';
        // 이 화면을 열면 지금까지의 공지는 읽은 것으로
        if (list.length) markNoticesSeen(list.reduce((m, n) => (String(n.createdAt) > m ? String(n.createdAt) : m), ''));
        window.__refreshNoticeBadge?.();
        renderList();
        renderView();
        createIcons({ icons });
    };

    $('#nt-new')?.addEventListener('click', () => { editing = { title: '', body: '', important: false, pinned: false }; renderView(); });
    $('#nt-q').addEventListener('input', (e) => { q = e.target.value; renderList(); });
    // 다른 사람이 새 공지를 올리면 목록을 다시 받는다 (FloatingTools가 보냄)
    const onNew = () => { if (container.isConnected && !editing) load(); };
    window.addEventListener('wms:notice', onNew);
    const obs = new MutationObserver(() => { if (!container.contains($('#nt-list'))) { window.removeEventListener('wms:notice', onNew); obs.disconnect(); } });
    obs.observe(container, { childList: true });
    load();
    createIcons({ icons });
};
