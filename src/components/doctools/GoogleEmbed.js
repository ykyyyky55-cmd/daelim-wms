import { createIcons, icons } from 'lucide';
import { esc } from '../../services/html.js';

/**
 * 구글 시트·구글 문서를 링크로 열기 (구글 계정 로그인 상태에서 편집)
 * - 편집 화면: 구글 편집기를 이 화면 안에 띄운다(docs.google.com …/edit?rm=minimal). 브라우저가 제3자 쿠키를 막으면
 *   로그인이 안 되므로 [구글에서 새 창으로 열기]를 쓴다.
 * - 가져오기: '링크가 있는 모든 사용자'에게 공개된 시트/문서는 엑셀(.xlsx)/Word(.docx)로 받아 이 앱의 편집기로 연다.
 * 최근 연 링크는 기기별로 기억한다(daelim_google_recent).
 */
const RECENT_KEY = 'daelim_google_recent';
const KINDS = {
    sheet: { path: 'spreadsheets', name: '구글 시트', icon: 'table-2', color: 'text-green-600', create: 'https://docs.google.com/spreadsheets/create', exportFmt: 'xlsx', importTab: 'excel', importLabel: '엑셀 편집기로 가져오기' },
    doc: { path: 'document', name: '구글 문서', icon: 'file-text', color: 'text-blue-600', create: 'https://docs.google.com/document/create', exportFmt: 'docx', importTab: 'docs', importLabel: '문서 편집기로 가져오기' }
};
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const saveRecent = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* 무시 */ } };

// 링크 → { kind, id, gid }
export const parseGoogleLink = (text) => {
    const s = String(text || '').trim();
    const m = s.match(/docs\.google\.com\/(spreadsheets|document)\/d\/([\w-]{20,})/);
    if (m) {
        const gid = (s.match(/[#&?]gid=(\d+)/) || [])[1] || '';
        return { kind: m[1] === 'spreadsheets' ? 'sheet' : 'doc', id: m[2], gid };
    }
    if (/^[\w-]{30,}$/.test(s)) return { kind: null, id: s, gid: '' };
    return null;
};

const renderGoogle = (kindKey, el, { showToast = () => {}, openTab } = {}) => {
    const K = KINDS[kindKey];
    let cur = null;          // { id, gid, title }
    let mode = 'edit';       // edit | preview
    let busy = false;

    const url = (m = mode) => cur ? `https://docs.google.com/${K.path}/d/${cur.id}/${m === 'edit' ? 'edit?rm=minimal' : 'preview'}${cur.gid ? `${m === 'edit' ? '&' : '?'}gid=${cur.gid}${m === 'edit' ? `#gid=${cur.gid}` : ''}` : ''}` : '';
    const fullUrl = () => cur ? `https://docs.google.com/${K.path}/d/${cur.id}/edit${cur.gid ? `#gid=${cur.gid}` : ''}` : '';

    const draw = () => {
        const recent = readRecent().filter(r => r.kind === kindKey);
        el.innerHTML = `
        <div class="space-y-3">
            <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm space-y-2.5 text-xs">
                <div class="flex flex-wrap items-center gap-2">
                    <i data-lucide="${K.icon}" class="w-5 h-5 ${K.color}"></i>
                    <input id="ge-link" type="text" placeholder="${K.name} 링크를 붙여넣으세요 (https://docs.google.com/${K.path}/d/…)" class="flex-1 min-w-[260px] border border-slate-300 rounded-xl px-3 py-2 font-bold" value="${cur ? esc(fullUrl()) : ''}" />
                    <button type="button" id="ge-open" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-black flex items-center gap-1.5"><i data-lucide="link" class="w-4 h-4"></i>열기</button>
                    <a href="${K.create}" target="_blank" rel="noopener" class="px-3 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 font-bold flex items-center gap-1.5"><i data-lucide="plus" class="w-4 h-4"></i>새 ${K.name} 만들기</a>
                </div>
                ${recent.length ? `<div class="flex flex-wrap items-center gap-1.5"><span class="text-slate-400 font-bold">최근:</span>
                    ${recent.map(r => `<span class="inline-flex items-center rounded-lg border ${cur?.id === r.id ? 'border-green-400 bg-green-50' : 'border-slate-200 bg-slate-50'}"><button type="button" class="ge-recent px-2 py-1 font-bold max-w-[220px] truncate" data-id="${esc(r.id)}" data-gid="${esc(r.gid || '')}" title="${esc(r.title || r.id)}">${esc(r.title || `${r.id.slice(0, 10)}…`)}</button><button type="button" class="ge-recent-del px-1.5 text-slate-400 hover:text-rose-600" data-id="${esc(r.id)}" title="목록에서 빼기">×</button></span>`).join('')}</div>` : ''}
            </div>
            ${cur ? `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="flex flex-wrap items-center gap-1.5 p-2 border-b border-slate-200 bg-slate-50 text-xs font-bold">
                    <div class="flex bg-white border border-slate-200 p-0.5 rounded-lg">
                        <button type="button" class="ge-mode px-2.5 py-1 rounded-md ${mode === 'edit' ? 'bg-green-600 text-white' : 'text-slate-500'}" data-m="edit">편집 화면</button>
                        <button type="button" class="ge-mode px-2.5 py-1 rounded-md ${mode === 'preview' ? 'bg-green-600 text-white' : 'text-slate-500'}" data-m="preview">보기 전용</button>
                    </div>
                    <button type="button" id="ge-title" class="px-2 py-1 rounded-lg hover:bg-white text-slate-600" title="최근 목록에 보일 이름"><i data-lucide="pencil" class="w-3.5 h-3.5 inline"></i> ${esc(cur.title || '이름 붙이기')}</button>
                    <div class="ml-auto flex flex-wrap gap-1.5">
                        <button type="button" id="ge-import" class="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 disabled:opacity-50" ${busy ? 'disabled' : ''}><i data-lucide="${busy ? 'loader' : 'download'}" class="w-4 h-4 ${busy ? 'animate-spin' : ''}"></i>${K.importLabel}</button>
                        <a href="${esc(fullUrl())}" target="_blank" rel="noopener" class="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 flex items-center gap-1.5"><i data-lucide="external-link" class="w-4 h-4"></i>구글에서 새 창으로 열기</a>
                    </div>
                </div>
                <iframe id="ge-frame" src="${esc(url())}" class="w-full bg-white" style="height:74vh;border:0" allow="clipboard-read; clipboard-write" referrerpolicy="no-referrer-when-downgrade"></iframe>
                <div class="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-100">
                    화면이 비어 있거나 로그인하라고 나오면 브라우저가 다른 사이트 안의 구글 로그인을 막은 것입니다. <b>[구글에서 새 창으로 열기]</b>로 편집하세요.
                    <b>[${K.importLabel}]</b>는 공유 설정이 '링크가 있는 모든 사용자'인 ${K.name}만 됩니다(회사 계정 전용 문서는 새 창에서 파일 → 다운로드로 받은 뒤 여세요).
                </div>
            </div>` : `
            <div class="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-400 text-sm font-bold space-y-2">
                <i data-lucide="${K.icon}" class="w-10 h-10 mx-auto ${K.color} opacity-60"></i>
                <div>${K.name} 링크를 붙여넣고 [열기]를 누르세요.</div>
                <div class="text-xs font-normal">구글 드라이브에서 문서를 연 뒤 주소창의 주소를 복사하거나, [공유] → [링크 복사]를 쓰면 됩니다.</div>
            </div>`}
        </div>`;
        createIcons({ icons });
        bind();
    };

    const open = (parsed, title = '') => {
        if (!parsed) { alert(`${K.name} 링크를 알아볼 수 없습니다.`); return; }
        if (parsed.kind && parsed.kind !== kindKey) {
            if (confirm(`이 링크는 ${KINDS[parsed.kind].name}입니다. ${KINDS[parsed.kind].name} 화면에서 열까요?`)) openTab?.(parsed.kind === 'sheet' ? 'gsheet' : 'docs', { googleLink: `https://docs.google.com/${KINDS[parsed.kind].path}/d/${parsed.id}/edit` });
            return;
        }
        const old = readRecent().find(r => r.id === parsed.id);
        cur = { id: parsed.id, gid: parsed.gid || old?.gid || '', title: title || old?.title || '' };
        saveRecent([{ kind: kindKey, id: cur.id, gid: cur.gid, title: cur.title, at: Date.now() }, ...readRecent().filter(r => r.id !== cur.id)]);
        draw();
    };

    const importFile = async () => {
        if (!cur || busy) return;
        busy = true; draw();
        try {
            const res = await fetch(`https://docs.google.com/${K.path}/d/${cur.id}/export?format=${K.exportFmt}`);
            const type = res.headers.get('content-type') || '';
            if (!res.ok || type.includes('text/html')) throw new Error('공개되지 않은 문서이거나 권한이 없습니다.');
            const buffer = await res.arrayBuffer();
            busy = false;
            openTab?.(K.importTab, { buffer, name: cur.title || `${K.name}_${cur.id.slice(0, 6)}` });
        } catch (e) {
            busy = false; draw();
            alert(`가져오지 못했습니다: ${e.message}\n\n공유 설정을 '링크가 있는 모든 사용자(보기)'로 바꾸거나, 새 창에서 파일 → 다운로드로 받은 뒤 [열기]로 여세요.`);
        }
    };

    const bind = () => {
        const $ = (s) => el.querySelector(s);
        const go = () => open(parseGoogleLink($('#ge-link').value));
        $('#ge-open').addEventListener('click', go);
        $('#ge-link').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
        el.querySelectorAll('.ge-recent').forEach(b => b.addEventListener('click', () => open({ kind: kindKey, id: b.dataset.id, gid: b.dataset.gid })));
        el.querySelectorAll('.ge-recent-del').forEach(b => b.addEventListener('click', () => { saveRecent(readRecent().filter(r => r.id !== b.dataset.id)); if (cur?.id === b.dataset.id) cur = null; draw(); }));
        el.querySelectorAll('.ge-mode').forEach(b => b.addEventListener('click', () => { mode = b.dataset.m; draw(); }));
        $('#ge-title')?.addEventListener('click', () => {
            const t = (prompt('최근 목록에 보일 이름', cur.title || '') || '').trim();
            if (!t) return;
            cur.title = t;
            saveRecent(readRecent().map(r => (r.id === cur.id ? { ...r, title: t } : r)));
            draw();
        });
        $('#ge-import')?.addEventListener('click', importFile);
    };

    return { draw, open };
};

export const renderGoogleSheet = (el, opts = {}) => {
    const g = renderGoogle('sheet', el, opts);
    if (opts.pending?.googleLink) g.open(parseGoogleLink(opts.pending.googleLink)); else g.draw();
    return { isDirty: () => false };
};

export const renderGoogleDoc = (el, opts = {}) => {
    const g = renderGoogle('doc', el, opts);
    if (opts.pending?.googleLink) g.open(parseGoogleLink(opts.pending.googleLink)); else g.draw();
    return { isDirty: () => false };
};
