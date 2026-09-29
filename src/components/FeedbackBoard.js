// ==========================================
// 지원 → 의견·개선 요청 (탭 feedback) — 접수 목록·처리(매니저 이상)·요청자 알림
// ==========================================
// 등록은 떠 있는 [💡 의견] 또는 여기 [새 의견] (components/FeedbackDialog.js). 데이터는 services/feedback.js.
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { state } from '../services/db.js';
import { myChatId } from '../services/chat.js';
import {
    FEEDBACK_KINDS, FEEDBACK_STATUS, FEEDBACK_PRIORITY, isOpenFeedback, listFeedback, feedbackFileUrls, feedbackFileKey,
    handleFeedback, deleteFeedback, currentVersion
} from '../services/feedback.js';
import { openFeedbackDialog } from './FeedbackDialog.js';

const PREF = 'daelim_feedback_view';
const fmtAt = (s) => { if (!s) return ''; const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const badge = (map, k) => `<span class="px-1.5 py-0.5 rounded-md border text-[10px] font-black whitespace-nowrap ${map[k]?.cls || ''}">${esc(map[k]?.label || k)}</span>`;
const isImage = (f) => /^image\//.test(f.mime || '') || /\.(png|jpe?g|webp|gif)$/i.test(f.name || '');

export const renderFeedbackBoard = (container, { showToast = () => {} } = {}) => {
    const role = state.currentUser?.role || 'VIEWER';
    const canManage = ['MASTER', 'ADMIN', 'MANAGER'].includes(role);
    const isAdmin = ['MASTER', 'ADMIN'].includes(role);
    const me = myChatId();
    let pref = {};
    try { pref = JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { /* 기본값 */ }
    const f = { status: pref.status || 'OPEN', kind: pref.kind || '', mine: !!pref.mine, q: '' };
    const save = () => { try { localStorage.setItem(PREF, JSON.stringify({ status: f.status, kind: f.kind, mine: f.mine })); } catch { /* 무시 */ } };
    let items = [];
    let loading = true, error = '';

    container.innerHTML = `
    <section class="space-y-4 text-xs">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-start justify-between gap-3">
            <div>
                <div class="text-[11px] font-black text-orange-600 flex items-center gap-1"><i data-lucide="life-buoy" class="w-3.5 h-3.5"></i>지원 › 의견·개선 요청</div>
                <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="lightbulb" class="w-5 h-5 text-orange-500"></i>의견 · 개선 요청 접수함</h2>
                <p class="text-xs text-slate-500 mt-1">화면 오른쪽 아래 <b class="text-orange-600">💡</b> 버튼으로 어느 화면에서든 캡처와 함께 보냅니다. 접수 → 검토 → 개발 중 → 반영 완료 → 배포 완료로 처리하며, 상태가 바뀌면 요청자에게 1:1 메시지로 알려 드립니다.</p>
            </div>
            <div class="flex gap-2">
                <button type="button" id="fb-xlsx" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center gap-1.5"><i data-lucide="file-spreadsheet" class="w-4 h-4"></i>엑셀</button>
                <button type="button" id="fb-new" class="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-black flex items-center gap-1.5"><i data-lucide="plus" class="w-4 h-4"></i>새 의견</button>
            </div>
        </div>
        <div id="fb-kpi" class="grid grid-cols-2 md:grid-cols-6 gap-3"></div>
        <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm space-y-2">
            <div class="flex flex-wrap items-center gap-2">
                <div id="fb-status-f" class="flex flex-wrap bg-slate-100 p-0.5 rounded-lg border border-slate-200 font-bold"></div>
                <select id="fb-kind-f" class="border border-slate-300 rounded-lg px-2 py-1 font-bold"><option value="">모든 종류</option>${Object.entries(FEEDBACK_KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
                <label class="flex items-center gap-1 font-bold text-slate-700"><input type="checkbox" id="fb-mine" />내 의견만</label>
                <input id="fb-q" type="search" placeholder="번호·제목·내용·화면·요청자" class="flex-1 min-w-[180px] border border-slate-300 rounded-lg px-2 py-1.5" />
            </div>
            <div id="fb-list"></div>
        </div>
    </section>`;
    const $ = (s) => container.querySelector(s);
    $('#fb-kind-f').value = f.kind;
    $('#fb-mine').checked = f.mine;

    const STATUS_TABS = [['OPEN', '처리 중'], ['ALL', '전체'], ...Object.entries(FEEDBACK_STATUS).map(([k, v]) => [k, v.label])];
    const matches = (x) => (f.status === 'ALL' || (f.status === 'OPEN' ? isOpenFeedback(x) : x.status === f.status))
        && (!f.kind || x.kind === f.kind) && (!f.mine || x.createdBy === me)
        && (!f.q || `${x.regNo} ${x.title} ${x.body} ${x.tabLabel} ${x.by} ${x.reply}`.toLowerCase().includes(f.q.toLowerCase()));

    const draw = () => {
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const cnt = (fn) => items.filter(fn).length;
        const kpi = (l, v, cls, sub = '') => `<div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm"><div class="text-[11px] font-bold text-slate-500">${l}</div><div class="text-xl font-black ${cls}">${v}</div>${sub ? `<div class="text-[10px] text-slate-400">${sub}</div>` : ''}</div>`;
        $('#fb-kpi').innerHTML = [
            kpi('전체', `${items.length}건`, 'text-slate-900', `이번 주 ${cnt(x => x.at >= weekAgo)}건 접수`),
            kpi('접수 대기', `${cnt(x => x.status === 'NEW')}건`, cnt(x => x.status === 'NEW') ? 'text-amber-600' : 'text-slate-900', '아직 검토 전'),
            kpi('검토 · 개발 중', `${cnt(x => ['ACCEPTED', 'WORK'].includes(x.status))}건`, 'text-blue-700'),
            kpi('반영 완료', `${cnt(x => x.status === 'DONE')}건`, 'text-emerald-700', '배포 대기'),
            kpi('배포 완료', `${cnt(x => x.status === 'DEPLOYED')}건`, 'text-emerald-700'),
            kpi('오류 신고 (처리 중)', `${cnt(x => x.kind === 'BUG' && isOpenFeedback(x))}건`, cnt(x => x.kind === 'BUG' && isOpenFeedback(x)) ? 'text-rose-600' : 'text-slate-900')
        ].join('');
        $('#fb-status-f').innerHTML = STATUS_TABS.map(([k, l]) => {
            const n = k === 'ALL' ? items.length : k === 'OPEN' ? cnt(isOpenFeedback) : cnt(x => x.status === k);
            return `<button type="button" class="fb-st tap-compact px-2.5 py-1 rounded-md whitespace-nowrap ${f.status === k ? 'bg-white text-orange-700 shadow-sm font-black' : 'text-slate-500'}" data-k="${k}">${l} <span class="text-[10px] text-slate-400">${n}</span></button>`;
        }).join('');
        container.querySelectorAll('.fb-st').forEach(b => b.addEventListener('click', () => { f.status = b.dataset.k; save(); draw(); }));
        const list = items.filter(matches);
        $('#fb-list').innerHTML = loading ? '<div class="p-8 text-center text-slate-400">불러오는 중…</div>'
            : error ? `<div class="p-4 text-rose-600 font-bold">${esc(error)}</div>`
            : list.length ? `<div class="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">${list.map(x => `
                <button type="button" class="fb-row w-full text-left p-2.5 hover:bg-orange-50/60 flex flex-wrap items-center gap-2" data-id="${esc(x.id)}">
                    <span class="font-mono text-[11px] text-slate-500 w-[92px]">${esc(x.regNo)}</span>
                    ${badge(FEEDBACK_KINDS, x.kind)}
                    <span class="flex-1 min-w-[180px] font-black text-slate-900">${esc(x.title)}${x.files.length ? ` <span class="text-slate-400 font-bold">📎${x.files.length}</span>` : ''}${x.priority === 'HIGH' ? ' <span class="text-rose-600">● 높음</span>' : ''}</span>
                    <span class="text-slate-500 max-w-[140px] truncate">${esc(x.tabLabel)}</span>
                    <span class="text-slate-600 font-bold">${esc(x.by)}</span>
                    <span class="text-slate-400 font-mono">${fmtAt(x.at)}</span>
                    ${badge(FEEDBACK_STATUS, x.status)}
                </button>`).join('')}</div>`
            : '<div class="p-8 text-center text-slate-400 font-bold">조건에 맞는 의견이 없습니다.</div>';
        container.querySelectorAll('.fb-row').forEach(b => b.addEventListener('click', () => { const x = items.find(i => i.id === b.dataset.id); if (x) openDetail(x); }));
        createIcons({ icons });
    };

    const load = async () => {
        loading = true; error = ''; draw();
        try { items = await listFeedback(); } catch (e) { error = e.message; items = []; }
        loading = false; draw();
    };

    // ---------- 상세·처리 창 ----------
    const openDetail = async (x) => {
        const mine = x.createdBy === me;
        const m = document.createElement('div');
        m.className = 'fixed inset-0 z-[70] bg-slate-900/60 p-3 overflow-y-auto flex items-start justify-center';
        m.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4 text-xs overflow-hidden">
            <div class="px-5 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
                <div><div class="flex flex-wrap items-center gap-1.5"><span class="font-mono text-slate-500">${esc(x.regNo)}</span>${badge(FEEDBACK_KINDS, x.kind)}${badge(FEEDBACK_STATUS, x.status)}</div>
                    <div class="text-base font-black text-slate-900 mt-1">${esc(x.title)}</div>
                    <div class="text-slate-500 mt-0.5">${esc(x.by)} · ${fmtAt(x.at)} · 화면 <b>${esc(x.tabLabel || '-')}</b> · 버전 ${esc(x.appVersion || '-')} · ${esc(x.device || '')}</div></div>
                <button type="button" class="fd-close text-slate-400 hover:text-slate-700 text-xl px-2">×</button>
            </div>
            <div class="p-5 space-y-3">
                <div class="whitespace-pre-wrap text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-xl p-3 min-h-[48px]">${esc(x.body) || '<span class="text-slate-400">내용 없음</span>'}</div>
                <div id="fd-files" class="grid grid-cols-2 sm:grid-cols-3 gap-2">${x.files.length ? '<div class="text-slate-400">첨부 불러오는 중…</div>' : ''}</div>
                ${x.reply ? `<div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200"><div class="font-black text-emerald-800 mb-1">답변 (${esc(x.handler || '처리자')})</div><div class="whitespace-pre-wrap text-slate-800">${esc(x.reply)}</div>${x.deployedVersion ? `<div class="mt-1 text-emerald-700">배포 버전 ${esc(x.deployedVersion)}</div>` : ''}</div>` : ''}
                ${x.history.length ? `<div><div class="font-black text-slate-700 mb-1">처리 이력</div>${x.history.map(h => `<div class="flex gap-2 py-0.5"><span class="text-slate-400 font-mono">${fmtAt(h.at)}</span>${badge(FEEDBACK_STATUS, h.status)}<span class="font-bold">${esc(h.by)}</span><span class="text-slate-600 truncate">${esc(h.note || '')}</span></div>`).join('')}</div>` : ''}
                ${canManage ? `<div class="p-3 rounded-xl border-2 border-orange-200 bg-orange-50/40 space-y-2">
                    <div class="font-black text-orange-800">처리 (매니저 이상)</div>
                    <div class="flex flex-wrap gap-1">${Object.entries(FEEDBACK_STATUS).map(([k, v]) => `<button type="button" class="fd-st px-2.5 py-1 rounded-lg border font-black" data-k="${k}">${v.label}</button>`).join('')}</div>
                    <div class="flex flex-wrap items-center gap-2">
                        <label class="font-bold text-slate-600">우선순위 <select id="fd-pri" class="border border-slate-300 rounded-lg px-2 py-1 font-bold">${Object.entries(FEEDBACK_PRIORITY).map(([k, v]) => `<option value="${k}" ${x.priority === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                        <label class="font-bold text-slate-600">배포 버전 <input id="fd-ver" value="${esc(x.deployedVersion)}" placeholder="${esc(currentVersion())}" class="w-24 border border-slate-300 rounded-lg px-2 py-1 font-mono" /></label>
                        <label class="flex items-center gap-1 font-bold text-slate-700"><input type="checkbox" id="fd-notify" checked />요청자에게 1:1 메시지</label>
                    </div>
                    <textarea id="fd-reply" rows="3" class="w-full border border-slate-300 rounded-lg px-2 py-1.5" placeholder="답변 (요청자에게 함께 보냅니다)">${esc(x.reply)}</textarea>
                    <div class="flex justify-end"><button type="button" id="fd-save" class="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black">처리 저장</button></div>
                </div>` : ''}
            </div>
            <div class="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-between">
                <div>${(mine && x.status === 'NEW') || isAdmin ? '<button type="button" id="fd-del" class="px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-bold">삭제</button>' : ''}</div>
                <button type="button" class="fd-close px-4 py-2 rounded-xl border border-slate-300 bg-white font-bold">닫기</button>
            </div></div>`;
        document.body.appendChild(m);
        const q = (s) => m.querySelector(s);
        const close = () => m.remove();
        m.querySelectorAll('.fd-close').forEach(b => b.addEventListener('click', close));
        m.addEventListener('click', (e) => { if (e.target === m) close(); });
        let st = x.status;
        const paintSt = () => m.querySelectorAll('.fd-st').forEach(b => { b.className = `fd-st px-2.5 py-1 rounded-lg border font-black ${b.dataset.k === st ? FEEDBACK_STATUS[st].cls + ' ring-2 ring-orange-400' : 'bg-white text-slate-600 border-slate-200'}`; });
        m.querySelectorAll('.fd-st').forEach(b => b.addEventListener('click', () => { st = b.dataset.k; if (st === 'DEPLOYED' && !q('#fd-ver').value) q('#fd-ver').value = currentVersion(); paintSt(); }));
        paintSt();
        q('#fd-save')?.addEventListener('click', async () => {
            const btn = q('#fd-save');
            btn.disabled = true; btn.textContent = '저장 중…';
            try {
                const res = await handleFeedback(x, { status: st, priority: q('#fd-pri').value, reply: q('#fd-reply').value, deployedVersion: q('#fd-ver').value, notify: q('#fd-notify').checked });
                items = items.map(i => (i.id === x.id ? res.item : i));
                close(); draw();
                showToast(`💡 ${res.item.regNo} → ${FEEDBACK_STATUS[res.item.status].label}${res.notified ? ' · 요청자에게 알렸습니다' : res.notifyError ? ` · 알림 실패: ${res.notifyError}` : ''}`);
            } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = '처리 저장'; }
        });
        q('#fd-del')?.addEventListener('click', async () => {
            if (!confirm(`${x.regNo} "${x.title}" 의견을 지울까요?`)) return;
            try { await deleteFeedback(x); items = items.filter(i => i.id !== x.id); close(); draw(); showToast('의견을 지웠습니다.'); } catch (e) { alert(e.message); }
        });
        createIcons({ icons });
        if (x.files.length) {
            try {
                const urls = await feedbackFileUrls(x.files);
                q('#fd-files').innerHTML = x.files.map(file => {
                    const url = urls.get(feedbackFileKey(file)) || '';
                    return isImage(file) && url
                        ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="block border border-slate-200 rounded-lg overflow-hidden bg-slate-50" title="${esc(file.name)}"><img src="${esc(url)}" alt="${esc(file.name)}" class="w-full h-32 object-contain" /><div class="px-1.5 py-1 truncate text-[10px] text-slate-500">${esc(file.name)}</div></a>`
                        : `<a href="${esc(url)}" target="_blank" rel="noopener" class="p-2 border border-slate-200 rounded-lg flex items-center gap-1 font-bold text-blue-700 truncate">📎 ${esc(file.name)}</a>`;
                }).join('');
            } catch (e) { q('#fd-files').innerHTML = `<div class="text-rose-600">첨부를 불러오지 못했습니다: ${esc(e.message)}</div>`; }
        }
    };

    $('#fb-new').addEventListener('click', () => openFeedbackDialog({ showToast, onSaved: load, capture: false }));
    $('#fb-kind-f').addEventListener('change', (e) => { f.kind = e.target.value; save(); draw(); });
    $('#fb-mine').addEventListener('change', (e) => { f.mine = e.target.checked; save(); draw(); });
    let qt = null;
    $('#fb-q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { f.q = e.target.value.trim(); draw(); }, 200); });
    $('#fb-xlsx').addEventListener('click', async () => {
        const XLSX = await import('xlsx');
        const rows = items.filter(matches).map(x => ({ 등록번호: x.regNo, 종류: FEEDBACK_KINDS[x.kind]?.label, 제목: x.title, 내용: x.body, 화면: x.tabLabel, 요청자: x.by, 접수일시: x.at ? new Date(x.at).toLocaleString('ko-KR') : '',
            상태: FEEDBACK_STATUS[x.status]?.label, 우선순위: FEEDBACK_PRIORITY[x.priority], 답변: x.reply, 처리자: x.handler, 배포버전: x.deployedVersion, 첨부: x.files.length, 기기: x.device, 앱버전: x.appVersion }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '의견·개선 요청');
        XLSX.writeFile(wb, `대림오일_의견개선요청_${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
    // 떠 있는 💡로 접수하면 이 화면이 열려 있을 때 목록을 새로
    window.__onFeedbackSaved = () => { if (container.isConnected) load(); };
    load();
};
