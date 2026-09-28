// ==========================================
// 결재 문서 도구: 결재란 추가(결재선) · 수신/참조 · 공유
// ==========================================
// 결재 칸(mountApprovalBox) 아래 버튼에서 연다. 저장은 services/approvals.js saveApprovalMeta (DB 함수 wms_approval_meta).
// 수신(결재 요청)으로 지정한 사람: 할일(결재 요청) + 1:1 메시지. 참조·공유: 1:1 메시지.
// 받은 사람은 전자결재 → [수신·참조 문서함]에서 문서를 열어 봅니다.
import { createIcons, icons } from '../../services/icons.js';
import { esc } from '../../services/html.js';
import { state } from '../../services/db.js';
import {
    saveApprovalMeta, effectiveRoles, listComments, addComment, deleteComment, isMyComment, setRejected, COMMENT_KINDS, signDateText
} from '../../services/approvals.js';
import { listPeople, assignTasks } from '../../services/assign.js';
import { sendMessage, dmRoom, myChatId } from '../../services/chat.js';

const overlay = (inner) => {
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4';
    wrap.innerHTML = `<div class="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[88vh] overflow-y-auto p-5 space-y-3 text-xs">${inner}</div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => wrap.remove()));
    createIcons({ icons });
    return wrap;
};
const head = (title, sub) => `<div class="flex items-start justify-between gap-2">
    <div class="min-w-0"><div class="text-base font-black text-slate-900">${esc(title)}</div>${sub ? `<div class="text-[11px] text-slate-500 truncate">${esc(sub)}</div>` : ''}</div>
    <button type="button" data-close class="p-1 rounded-lg hover:bg-slate-100"><i data-lucide="x" class="w-4 h-4"></i></button></div>`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * 결재란 추가·순서 바꾸기 (양식의 기본 칸은 뺄 수 없고, 서명된 칸도 뺄 수 없음)
 * @param doc   { key, type, title, date, roles: 기본 칸 }
 * @param slots 지금 서명 (+ __meta)
 * @param onSaved(slots)
 */
export const openApprovalLineEditor = (doc, slots, onSaved) => {
    let line = [...effectiveRoles(doc.roles, slots)];
    const base = new Set(doc.roles);
    const wrap = overlay(`${head('결재란 추가·순서', doc.title)}
        <p class="text-slate-500">양식의 기본 칸(<b>${esc(doc.roles.join(' · '))}</b>)은 그대로 두고 칸을 더하거나 순서를 바꿉니다. 서명이 있는 칸은 뺄 수 없습니다. 인쇄물에도 같은 결재선이 나옵니다.</p>
        <div data-line class="space-y-1"></div>
        <div class="flex gap-2">
            <input data-name maxlength="8" placeholder="칸 이름 (예: 팀장, 품질, 대표)" class="flex-1 border border-slate-300 rounded-lg px-2 py-2" />
            <button type="button" data-add class="px-3 py-2 rounded-lg bg-slate-800 text-white font-bold">칸 추가</button>
        </div>
        <div class="flex flex-wrap gap-1 text-[11px]">${['팀장', '과장', '부장', '품질', '공장장', '이사', '대표'].map(n => `<button type="button" data-quick="${n}" class="px-2 py-1 rounded-full border border-slate-300 hover:border-slate-500">+ ${n}</button>`).join('')}</div>
        <div class="flex justify-between gap-2 pt-1">
            <button type="button" data-reset class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">기본 결재선으로</button>
            <div class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">취소</button>
            <button type="button" data-save class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black">저장</button></div>
        </div>`);
    const $ = (s) => wrap.querySelector(s);
    const draw = () => {
        $('[data-line]').innerHTML = line.map((r, i) => `
            <div class="flex items-center gap-2 border border-slate-200 rounded-lg px-2 py-1.5 ${base.has(r) ? 'bg-slate-50' : 'bg-blue-50/50'}">
                <span class="w-5 text-center text-slate-400 font-bold">${i + 1}</span>
                <span class="flex-1 font-black text-slate-800">${esc(r)} ${base.has(r) ? '<span class="text-[10px] text-slate-400 font-bold">기본</span>' : '<span class="text-[10px] text-blue-600 font-bold">추가</span>'}${slots?.[r] ? ` <span class="text-[10px] text-rose-600 font-bold">서명: ${esc(slots[r].name)}</span>` : ''}</span>
                <button type="button" data-up="${i}" class="px-1.5 py-0.5 rounded border border-slate-300 ${i === 0 ? 'opacity-30 pointer-events-none' : ''}">▲</button>
                <button type="button" data-down="${i}" class="px-1.5 py-0.5 rounded border border-slate-300 ${i === line.length - 1 ? 'opacity-30 pointer-events-none' : ''}">▼</button>
                ${!base.has(r) && !slots?.[r] ? `<button type="button" data-rm="${i}" class="px-1.5 py-0.5 rounded border border-rose-200 text-rose-600">빼기</button>` : '<span class="w-9"></span>'}
            </div>`).join('');
    };
    const add = (name) => {
        const n = String(name || '').trim();
        if (!n) return;
        if (line.includes(n)) { alert(`'${n}' 칸이 이미 있습니다.`); return; }
        if (line.length >= 10) { alert('결재 칸은 10개까지입니다.'); return; }
        // 새 칸은 마지막(최종 승인) 칸 앞에 넣는다
        line.splice(Math.max(0, line.length - 1), 0, n);
        draw();
    };
    wrap.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.add !== undefined) { add($('[data-name]').value); $('[data-name]').value = ''; }
        else if (b.dataset.quick) add(b.dataset.quick);
        else if (b.dataset.up) { const i = +b.dataset.up; [line[i - 1], line[i]] = [line[i], line[i - 1]]; draw(); }
        else if (b.dataset.down) { const i = +b.dataset.down; [line[i + 1], line[i]] = [line[i], line[i + 1]]; draw(); }
        else if (b.dataset.rm) { line.splice(+b.dataset.rm, 1); draw(); }
        else if (b.dataset.reset !== undefined) { line = [...doc.roles, ...line.filter(r => !base.has(r) && slots?.[r])]; draw(); }
        else if (b.dataset.save !== undefined) {
            b.disabled = true;
            try {
                const same = line.length === doc.roles.length && line.every((r, i) => r === doc.roles[i]);
                const saved = await saveApprovalMeta(doc, { custom: same ? [] : line });
                wrap.remove();
                onSaved?.(saved);
            } catch (err) { alert(err.message); b.disabled = false; }
        }
    });
    $('[data-name]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { add(e.target.value); e.target.value = ''; } });
    draw();
};

/**
 * 수신·참조 지정 (mode 'route') 또는 공유 (mode 'share')
 * @param doc   { key, type, title, date, roles, link?: { tab, set } }
 * @param slots 지금 서명 (+ __meta)
 * @param onSaved(slots)
 */
export const openRecipientsEditor = async (doc, slots, mode, onSaved) => {
    const meta = slots?.__meta || {};
    const isShare = mode === 'share';
    const people = await listPeople();
    const meId = String(myChatId());
    const pick = { TO: new Set((meta.recipients || []).map(p => String(p.uid))), CC: new Set((meta.cc || []).map(p => String(p.uid))), SH: new Set((meta.shares || []).map(p => String(p.uid))) };
    const before = { TO: new Set(pick.TO), CC: new Set(pick.CC), SH: new Set(pick.SH) };
    const nameOf = (id) => people.find(p => String(p.id) === id)?.name || [...(meta.recipients || []), ...(meta.cc || []), ...(meta.shares || [])].find(p => String(p.uid) === id)?.name || '';
    const cols = isShare ? [['SH', '공유']] : [['TO', '수신 (결재 요청)'], ['CC', '참조']];
    const wrap = overlay(`${head(isShare ? '문서 공유' : '수신·참조 지정', doc.title)}
        <p class="text-slate-500">${isShare
        ? '고른 사람에게 이 문서를 알리는 메시지가 가고, 받은 사람의 <b>전자결재 → 수신·참조 문서함</b>에 문서가 보입니다. 공유받은 사람은 <b>검토·첨언만</b> 하고 결재 서명·반려는 할 수 없습니다.'
        : '<b>수신</b>은 결재(서명)를 요청받는 사람으로 할일(결재 요청)과 메시지를 받습니다. <b>참조</b>는 내용을 알아야 하는 사람으로 메시지를 받고 <b>검토·첨언만</b> 합니다(결재 서명·반려 불가). 둘 다 <b>전자결재 → 수신·참조 문서함</b>에 문서가 보입니다.'}</p>
        <input data-q type="search" placeholder="이름·부서 검색" class="w-full border border-slate-300 rounded-lg px-2 py-1.5" />
        <div class="border border-slate-200 rounded-xl overflow-hidden">
            <div class="grid ${isShare ? 'grid-cols-[1fr_70px]' : 'grid-cols-[1fr_70px_70px]'} bg-slate-100 font-black text-slate-600 px-2 py-1.5"><span>사람</span>${cols.map(([, l]) => `<span class="text-center">${esc(l.replace(/ \(.*\)/, ''))}</span>`).join('')}</div>
            <div data-people class="max-h-[42vh] overflow-y-auto divide-y divide-slate-100"></div>
        </div>
        <label class="block"><span class="font-bold text-slate-600">메시지에 덧붙일 말 (선택)</span>
            <input data-note maxlength="200" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" placeholder="${isShare ? '예: 참고 부탁드립니다' : '예: 금주 중 결재 부탁드립니다'}" /></label>
        <div class="flex justify-end gap-2 pt-1">
            <button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">취소</button>
            <button type="button" data-save class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black">${isShare ? '공유하고 알리기' : '저장하고 알리기'}</button>
        </div>`);
    const $ = (s) => wrap.querySelector(s);
    let q = '';
    const draw = () => {
        const needle = q.trim().toLowerCase();
        const rows = people.filter(p => !needle || `${p.name} ${p.dept || ''}`.toLowerCase().includes(needle));
        $('[data-people]').innerHTML = rows.length === 0 ? '<div class="p-4 text-center text-slate-400">사람이 없습니다.</div>' : rows.map(p => `
            <div class="grid ${isShare ? 'grid-cols-[1fr_70px]' : 'grid-cols-[1fr_70px_70px]'} items-center px-2 py-1.5">
                <span class="truncate"><b class="text-slate-800">${esc(p.name)}</b>${p.dept ? ` <span class="text-slate-400">${esc(p.dept)}</span>` : ''}${String(p.id) === meId ? ' <span class="text-slate-400">(나)</span>' : ''}</span>
                ${cols.map(([k]) => `<label class="flex justify-center"><input type="checkbox" data-k="${k}" data-id="${esc(p.id)}" ${pick[k].has(String(p.id)) ? 'checked' : ''} /></label>`).join('')}
            </div>`).join('');
    };
    wrap.addEventListener('change', (e) => {
        const c = e.target.closest('input[data-k]');
        if (!c) return;
        const id = c.dataset.id;
        if (c.checked) {
            pick[c.dataset.k].add(id);
            // 한 사람은 수신·참조 중 하나만
            if (c.dataset.k === 'TO') { pick.CC.delete(id); } else if (c.dataset.k === 'CC') { pick.TO.delete(id); }
            draw();
        } else pick[c.dataset.k].delete(id);
    });
    $('[data-q]').addEventListener('input', (e) => { q = e.target.value; draw(); });
    $('[data-save]').addEventListener('click', async (e) => {
        const b = e.target;
        b.disabled = true;
        const by = state.currentUser?.name || '';
        const at = new Date().toISOString();
        const list = (k, old) => [...pick[k]].map(id => (old || []).find(p => String(p.uid) === id) || { uid: id, name: nameOf(id), at, by });
        try {
            const saved = await saveApprovalMeta(doc, isShare
                ? { shares: list('SH', meta.shares) }
                : { recipients: list('TO', meta.recipients), cc: list('CC', meta.cc) });
            // 알림: 새로 넣은 사람에게만 (본인 제외)
            const note = $('[data-note]').value.trim();
            const docLine = `문서: ${doc.title || doc.key}${doc.date ? ` (${doc.date})` : ''}`;
            const link = { tab: 'eApproval', set: { __eApprovalFilter: 'INBOX' } };
            const fails = [];
            const added = (k) => [...pick[k]].filter(id => !before[k].has(id) && id !== meId);
            for (const id of added(isShare ? 'SH' : 'CC')) {
                const text = [isShare ? `🔗 [문서 공유] ${by}님이 문서를 공유했습니다.` : `📄 [참조] ${by}님이 문서 참조자로 지정했습니다.`, docLine, note, '→ 전자결재 → 수신·참조 문서함에서 볼 수 있습니다.'].filter(Boolean).join('\n');
                try { await sendMessage(dmRoom(meId, id), text); } catch (err) { fails.push(`${nameOf(id)}: ${err.message}`); }
            }
            if (!isShare) {
                for (const id of added('TO')) {
                    const r = await assignTasks({
                        ref: `APPR:${doc.key}`, assignee: { id, name: nameOf(id) }, tasks: [{ part: '', text: `[결재 요청] ${doc.title || doc.key}`, dueDate: today(), label: '요청일' }],
                        title: `[결재 요청] ${doc.title || doc.key}`, lines: [docLine, note, '→ 전자결재 → 수신·참조 문서함에서 문서를 열어 결재 칸에 서명하세요.'], link
                    });
                    if (!r.ok) fails.push(r.message);
                }
                // 수신에서 뺀 사람의 결재 요청 할일은 지운다
                for (const id of [...before.TO].filter(x => !pick.TO.has(x))) {
                    await assignTasks({ ref: `APPR:${doc.key}`, assignee: null, prev: id, tasks: [], parts: [''] });
                }
            }
            wrap.remove();
            if (fails.length) alert(`저장했지만 일부 알림을 보내지 못했습니다.\n${fails.join('\n')}`);
            onSaved?.(saved);
        } catch (err) { alert(err.message); b.disabled = false; }
    });
    draw();
};

// 문서 관련자(서명한 사람·수신·참조·공유·반려자) 중 나를 뺀 사람에게 1:1 메시지
const notifyPeople = async (slots, text) => {
    const meta = slots?.__meta || {};
    const meId = String(myChatId());
    const ids = new Map();
    Object.values(slots || {}).forEach(s => { if (s?.uid) ids.set(String(s.uid), s.name || ''); });
    [...(meta.recipients || []), ...(meta.cc || []), ...(meta.shares || [])].forEach(p => ids.set(String(p.uid), p.name || ''));
    if (meta.rejected?.uid) ids.set(String(meta.rejected.uid), meta.rejected.name || '');
    ids.delete(meId);
    const fails = [];
    for (const [id, name] of ids) {
        try { await sendMessage(dmRoom(meId, id), text); } catch (e) { fails.push(`${name || id}: ${e.message}`); }
    }
    return { sent: ids.size - fails.length, fails };
};
const CMT_CLS = { COMMENT: 'bg-slate-100 text-slate-700', REJECT: 'bg-rose-600 text-white', RESUBMIT: 'bg-emerald-600 text-white' };
const fmtAt = (at) => (at ? new Date(at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * 첨언(검토 의견) 창: 목록 + 새 첨언. 승인된 사용자 모두(참조·공유받은 사람 포함) 쓸 수 있다.
 * @param doc { key, title, ... }  @param slots 지금 서명(+__meta)  @param onChange()
 */
export const openCommentsEditor = async (doc, slots, onChange) => {
    let list = [];
    const wrap = overlay(`${head('첨언 · 검토 의견', doc.title)}
        <div data-list class="space-y-2 max-h-[45vh] overflow-y-auto"></div>
        <textarea data-body rows="3" maxlength="2000" placeholder="검토 의견·보완 요청·참고 사항을 적으세요" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 leading-relaxed"></textarea>
        <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="flex items-center gap-1.5 text-slate-600"><input type="checkbox" data-notify checked />결재·수신·참조·공유 관련자에게 메시지로 알리기</label>
            <div class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">닫기</button>
            <button type="button" data-add class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black">첨언 남기기</button></div>
        </div>`);
    const $ = (s) => wrap.querySelector(s);
    const draw = () => {
        $('[data-list]').innerHTML = list.length === 0 ? '<div class="p-6 text-center text-slate-400">아직 첨언이 없습니다.</div>' : list.map(c => `
            <div class="p-2.5 rounded-xl border ${c.kind === 'REJECT' ? 'border-rose-200 bg-rose-50/50' : c.kind === 'RESUBMIT' ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'}">
                <div class="flex items-center justify-between gap-2">
                    <span><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${CMT_CLS[c.kind] || ''}">${esc(COMMENT_KINDS[c.kind] || c.kind)}</span> <b class="text-slate-800">${esc(c.name)}</b> <span class="text-slate-400">${esc(fmtAt(c.at))}</span></span>
                    ${c.kind === 'COMMENT' && isMyComment(c) ? `<button type="button" data-del="${esc(c.id)}" class="text-[11px] text-rose-600 font-bold">지우기</button>` : ''}
                </div>
                ${c.body ? `<div class="mt-1 text-slate-700 whitespace-pre-wrap break-words">${esc(c.body)}</div>` : ''}
            </div>`).join('');
        const box = $('[data-list]'); box.scrollTop = box.scrollHeight;
    };
    const load = async () => {
        try { list = await listComments(doc.key); } catch (e) { $('[data-list]').innerHTML = `<div class="p-3 text-rose-600 font-bold">${esc(e.message)}</div>`; return; }
        draw();
    };
    wrap.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.del) {
            const c = list.find(x => x.id === b.dataset.del);
            if (!c || !confirm('이 첨언을 지울까요?')) return;
            try { await deleteComment(c); await load(); onChange?.(); } catch (err) { alert(err.message); }
        } else if (b.dataset.add !== undefined) {
            const body = $('[data-body]').value;
            b.disabled = true;
            try {
                await addComment(doc.key, body);
                $('[data-body]').value = '';
                if ($('[data-notify]').checked) {
                    const r = await notifyPeople(slots, [`💬 [첨언] ${state.currentUser?.name || ''}님이 문서에 첨언을 남겼습니다.`, `문서: ${doc.title || doc.key}`, String(body).trim().slice(0, 600), '→ 전자결재 문서함 또는 문서 화면의 💬첨언에서 볼 수 있습니다.'].join('\n'));
                    if (r.fails.length) alert(`첨언은 남겼지만 일부 알림을 보내지 못했습니다.\n${r.fails.join('\n')}`);
                }
                await load();
                onChange?.();
            } catch (err) { alert(err.message); }
            b.disabled = false;
        }
    });
    await load();
};

/**
 * 반려(mode 'reject', 사유 필수) · 재상신(mode 'resubmit', 메모 선택)
 * 반려하면 반려자·사유가 결재 칸에 빨갛게 보이고, 재상신 전까지 아무도 서명할 수 없다. 관련자에게 메시지가 간다.
 */
export const openRejectEditor = (doc, slots, mode, onSaved) => {
    const reject = mode === 'reject';
    const rj = slots?.__meta?.rejected;
    const wrap = overlay(`${head(reject ? '반려' : '재상신', doc.title)}
        ${reject
        ? '<p class="text-slate-500">반려하면 결재 칸에 <b class="text-rose-600">반려</b> 표시와 사유가 보이고, <b>재상신</b>하기 전까지는 아무도 서명할 수 없습니다. 이미 받은 서명은 그대로 남습니다(필요하면 서명한 사람이 취소).</p>'
        : `<div class="p-2.5 rounded-lg bg-rose-50 border border-rose-200"><b class="text-rose-700">반려</b> ${esc(rj?.name || '')} · ${esc(signDateText(rj?.at))}<div class="mt-1 whitespace-pre-wrap">${esc(rj?.reason || '')}</div></div>
           <p class="text-slate-500">보완한 내용을 적고 재상신하면 반려가 풀리고 다시 결재할 수 있습니다.</p>`}
        <textarea data-body rows="4" maxlength="1000" placeholder="${reject ? '반려 사유 (필수) — 예: 수량 근거 자료 첨부 후 다시 올려 주세요' : '재상신 메모 (선택) — 예: 근거 자료 첨부했습니다'}" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 leading-relaxed"></textarea>
        <div class="flex justify-end gap-2">
            <button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">취소</button>
            <button type="button" data-save class="px-4 py-2 rounded-lg ${reject ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'} text-white font-black">${reject ? '반려하고 알리기' : '재상신하고 알리기'}</button>
        </div>`);
    wrap.querySelector('[data-body]').focus();
    wrap.querySelector('[data-save]').addEventListener('click', async (e) => {
        const text = wrap.querySelector('[data-body]').value.trim();
        if (reject && !text) { alert('반려 사유를 입력하세요.'); return; }
        e.target.disabled = true;
        try {
            const saved = await setRejected(doc, reject ? text : null, reject ? '' : text);
            const by = state.currentUser?.name || '';
            const r = await notifyPeople(saved, reject
                ? [`⛔ [반려] ${by}님이 문서를 반려했습니다.`, `문서: ${doc.title || doc.key}`, `사유: ${text}`, '→ 보완 후 결재 칸 아래 ↩재상신을 눌러 주세요.'].join('\n')
                : [`↩ [재상신] ${by}님이 반려된 문서를 다시 올렸습니다.`, `문서: ${doc.title || doc.key}`, text, '→ 다시 결재할 수 있습니다.'].filter(Boolean).join('\n'));
            wrap.remove();
            if (r.fails.length) alert(`처리했지만 일부 알림을 보내지 못했습니다.\n${r.fails.join('\n')}`);
            onSaved?.(saved);
        } catch (err) { alert(err.message); e.target.disabled = false; }
    });
};

/** 받는 사람 요약 글자 (결재 칸 아래 표시) */
export const recipientsSummary = (meta) => {
    if (!meta) return '';
    const names = (a) => (a || []).map(p => p.name).filter(Boolean).join(', ');
    return [meta.recipients?.length ? `수신 ${names(meta.recipients)}` : '', meta.cc?.length ? `참조 ${names(meta.cc)}` : '', meta.shares?.length ? `공유 ${names(meta.shares)}` : ''].filter(Boolean).join(' · ');
};
