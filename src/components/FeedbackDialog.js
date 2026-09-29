// ==========================================
// 의견 보내기 창 — 떠 있는 [💡 의견] 버튼(FloatingTools)·의견 접수함의 [새 의견]이 연다
// ==========================================
// 열기 전에 지금 화면을 캡처(services/feedback.js captureScreen)해 첨부 후보로 보여 주고,
// 종류·제목·내용·파일(선택·붙여넣기·끌어놓기)을 받아 saveFeedback으로 접수한다.
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { TAB_META } from './navMenu.js';
import { FEEDBACK_KINDS, captureScreen, saveFeedback } from '../services/feedback.js';

const MAX_FILES = 6;
const HINT = {
    BUG: '어떤 작업을 하다가 · 무엇이 잘못됐는지 · 원래 어떻게 되어야 하는지 적어 주세요.\n예) 원료 입고 처리 → [저장]을 누르면 "저장 실패"가 뜹니다. 품목은 ○○, 수량 200L였습니다.',
    IMPROVE: '지금 불편한 점과 바라는 모습을 적어 주세요.\n예) 재고 목록에서 창고별로 합계를 바로 보고 싶습니다.',
    NEW: '필요한 기능과 쓰는 상황을 적어 주세요.\n예) 출하 전표를 거래처에 메일로 바로 보내는 기능',
    QUESTION: '궁금한 점을 적어 주세요. 답변은 1:1 메시지로도 알려 드립니다.'
};
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

/**
 * @param {{ showToast?: (msg: string) => void, onSaved?: (item: object) => void, capture?: boolean }} opts
 */
export const openFeedbackDialog = async ({ showToast = window.__showToast || (() => {}), onSaved = () => {}, capture = true } = {}) => {
    if (document.getElementById('fb-modal')) return;
    const tab = window.__activeTab || (location.hash || '').slice(1) || 'home';
    const tabLabel = TAB_META[tab]?.label || (tab === 'home' ? '홈 (대시보드)' : tab);
    showToast('📸 지금 화면을 캡처하는 중…');
    const shot = capture ? await captureScreen() : null;
    let kind = 'IMPROVE';
    let useShot = !!shot;
    const files = [];
    const shotUrl = shot ? URL.createObjectURL(shot) : '';

    const m = document.createElement('div');
    m.id = 'fb-modal';
    m.className = 'fixed inset-0 z-[80] bg-slate-900/60 p-3 overflow-y-auto flex items-start justify-center';
    m.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4 text-xs overflow-hidden">
        <div class="px-5 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white flex items-center justify-between">
            <div class="font-black text-sm flex items-center gap-2"><i data-lucide="lightbulb" class="w-5 h-5"></i>의견 · 개선 요청 보내기</div>
            <button type="button" class="fb-close text-white/90 hover:text-white text-xl leading-none px-2" aria-label="닫기">×</button>
        </div>
        <div class="p-5 space-y-3">
            <div class="flex flex-wrap gap-1.5">${Object.entries(FEEDBACK_KINDS).map(([k, v]) => `<button type="button" class="fb-kind px-3 py-1.5 rounded-xl border font-black flex items-center gap-1" data-k="${k}"><i data-lucide="${v.icon}" class="w-3.5 h-3.5"></i>${v.label}</button>`).join('')}</div>
            <div class="text-slate-500">화면: <b class="text-slate-800">${esc(tabLabel)}</b> <span class="text-slate-400">(보낸 화면이 함께 기록됩니다)</span></div>
            <label class="block"><span class="font-bold text-slate-600">제목</span>
                <input id="fb-title" maxlength="120" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold" placeholder="한 줄로 요약" /></label>
            <label class="block"><span class="font-bold text-slate-600">내용</span>
                <textarea id="fb-body" rows="6" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea></label>
            ${shot ? `<div class="p-2 bg-slate-50 border border-slate-200 rounded-xl">
                <label class="flex items-center gap-2 font-bold text-slate-700 mb-1.5"><input type="checkbox" id="fb-use-shot" checked />지금 화면 캡처 첨부</label>
                <img src="${shotUrl}" alt="화면 캡처" class="w-full max-h-56 object-contain rounded-lg border border-slate-200 bg-white" /></div>`
                : '<div class="text-slate-400">화면 캡처를 만들지 못했습니다. 필요하면 아래에서 사진·캡처 파일을 붙여 주세요.</div>'}
            <div class="p-2 border-2 border-dashed border-slate-300 rounded-xl" id="fb-drop">
                <div class="flex flex-wrap items-center gap-2">
                    <label class="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-bold cursor-pointer flex items-center gap-1"><i data-lucide="paperclip" class="w-3.5 h-3.5"></i>파일·사진 추가<input type="file" id="fb-files" multiple class="hidden" /></label>
                    <span class="text-slate-400">여기로 끌어놓거나 Ctrl+V로 캡처를 붙여 넣어도 됩니다 (최대 ${MAX_FILES}개)</span>
                </div>
                <div id="fb-file-list" class="mt-1.5 flex flex-wrap gap-1.5"></div>
            </div>
            <div id="fb-err" class="hidden p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-bold"></div>
        </div>
        <div class="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
            <button type="button" class="fb-close px-4 py-2 rounded-xl border border-slate-300 bg-white font-bold">취소</button>
            <button type="button" id="fb-send" class="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black flex items-center gap-1.5"><i data-lucide="send" class="w-4 h-4"></i>보내기</button>
        </div>
    </div>`;
    document.body.appendChild(m);
    const $ = (s) => m.querySelector(s);

    const paintKind = () => {
        m.querySelectorAll('.fb-kind').forEach(b => { b.className = `fb-kind px-3 py-1.5 rounded-xl border font-black flex items-center gap-1 ${b.dataset.k === kind ? FEEDBACK_KINDS[kind].cls + ' ring-2 ring-offset-1 ring-orange-400' : 'bg-white text-slate-600 border-slate-200'}`; });
        $('#fb-body').placeholder = HINT[kind];
    };
    const paintFiles = () => {
        $('#fb-file-list').innerHTML = files.map((f, i) => `<span class="px-2 py-1 bg-white border border-slate-200 rounded-lg flex items-center gap-1">${esc(f.name)} <span class="text-slate-400">${fmtSize(f.size)}</span><button type="button" class="fb-rm text-rose-500 font-black px-1" data-i="${i}">×</button></span>`).join('');
        m.querySelectorAll('.fb-rm').forEach(b => b.addEventListener('click', () => { files.splice(Number(b.dataset.i), 1); paintFiles(); }));
    };
    const addFiles = (list) => {
        for (const f of list) {
            if (files.length >= MAX_FILES) { showToast(`첨부는 ${MAX_FILES}개까지입니다.`); break; }
            files.push(f.name ? f : new File([f], `붙여넣은_그림_${files.length + 1}.png`, { type: f.type || 'image/png' }));
        }
        paintFiles();
    };
    const close = () => {
        m.remove();
        document.removeEventListener('paste', onPaste);
        document.removeEventListener('keydown', onKey);
        if (shotUrl) URL.revokeObjectURL(shotUrl);
    };
    const onPaste = (e) => {
        const imgs = [...(e.clipboardData?.items || [])].filter(it => it.kind === 'file').map(it => it.getAsFile()).filter(Boolean);
        if (imgs.length) { e.preventDefault(); addFiles(imgs); }
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKey);

    m.querySelectorAll('.fb-kind').forEach(b => b.addEventListener('click', () => { kind = b.dataset.k; paintKind(); }));
    m.querySelectorAll('.fb-close').forEach(b => b.addEventListener('click', close));
    $('#fb-use-shot')?.addEventListener('change', (e) => { useShot = e.target.checked; });
    $('#fb-files').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
    const drop = $('#fb-drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('bg-orange-50'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('bg-orange-50'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('bg-orange-50'); addFiles([...(e.dataTransfer?.files || [])]); });
    $('#fb-send').addEventListener('click', async () => {
        const btn = $('#fb-send');
        const err = $('#fb-err');
        err.classList.add('hidden');
        const title = $('#fb-title').value.trim();
        if (!title) { err.textContent = '제목을 입력하세요.'; err.classList.remove('hidden'); $('#fb-title').focus(); return; }
        btn.disabled = true; btn.textContent = '보내는 중…';
        try {
            const saved = await saveFeedback({ kind, title, body: $('#fb-body').value, tab, tabLabel }, { newFiles: [...(useShot && shot ? [shot] : []), ...files] });
            close();
            showToast(`💡 의견이 접수되었습니다 (${saved.regNo}). 처리되면 1:1 메시지로 알려 드립니다.`);
            onSaved(saved);
        } catch (e) {
            err.textContent = e.message; err.classList.remove('hidden');
            btn.disabled = false; btn.innerHTML = '<i data-lucide="send" class="w-4 h-4"></i>보내기';
            createIcons({ icons });
        }
    });
    paintKind();
    createIcons({ icons });
    $('#fb-title').focus();
};
