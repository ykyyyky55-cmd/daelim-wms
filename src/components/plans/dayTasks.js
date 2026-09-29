// ==========================================
// 일일 생산계획 · 업무 계획 (업무일지 양식 1~7 항목) + 담당자 여러 명 + 배포
// ==========================================
// 저장: 주간 생산계획 문서(PROD_WEEK)의 dayTasks['<날짜>|<거점 또는 전체>'] = { tasks, dist }
//   tasks: [{ id, sec, text, time, people: [{ id, name }], note, src }]   (src = 'L:<생산줄 id>' — 생산 줄에서 만든 업무)
//   dist:  { at, by, count, map: { 담당자id: [업무 id] } }                (마지막 배포 — 다시 배포할 때 빠진 업무의 할일을 지움)
// 배포: 사람별로 자기 업무를 할일(wms_todos)에 등록하고, 계획서(HTML)를 첨부한 1:1 메시지를 보낸다 (services/assign.js distributePlan).
import { state } from '../../services/db.js';
import { esc } from '../../services/html.js';
import { createIcons, icons } from '../../services/icons.js';
import { listPeople, distributePlan } from '../../services/assign.js';
import { groupPeopleByOrg } from '../../services/org.js';
import { myChatId } from '../../services/chat.js';
import { fmtQty, btn } from './planCommon.js';

// 업무일지(ProductionLog.js SECTION_DEFS) 항목 순서 그대로. 5·6번은 업무일지처럼 입고/출고/구매발주, 택배/특이사항으로 나눈다.
export const TASK_SECTIONS = [
    { key: 'packaging', label: '1. 제품포장작업', short: '포장', icon: 'package-check', hint: '완제품 충진·박스 포장 (품목·수량·라인)' },
    { key: 'oilBlending', label: '2. 원액생산작업', short: '원액', icon: 'flask-conical', hint: '블렌딩 탱크 조유·원액 제조' },
    { key: 'labeling', label: '3. 라벨부착작업', short: '라벨', icon: 'tag', hint: '공용기 라벨 부착' },
    { key: 'movement', label: '4. 이동제품', short: '이동', icon: 'truck', hint: '거점 이동 (본사↔김포·방산)' },
    { key: 'receiving', label: '5. 입고', short: '입고', icon: 'arrow-down-to-line', hint: '원부자재·포장재 입고 확인' },
    { key: 'shipping', label: '5. 출고', short: '출고', icon: 'arrow-up-from-line', hint: '외부 납품·출하' },
    { key: 'purchaseOrders', label: '5. 구매발주', short: '발주', icon: 'shopping-cart', hint: '구매발주·입고 예정' },
    { key: 'courier', label: '6. 택배출고', short: '택배', icon: 'box', hint: '택배 출고' },
    { key: 'notes', label: '6. 특이사항', short: '특이', icon: 'message-square', hint: '공장 일일 특이사항·전달사항' },
    { key: 'otherTasks', label: '7. 기타업무·공수', short: '기타', icon: 'clipboard-list', hint: '설비 점검·청소·전산 입력 등' }
];
const SEC = Object.fromEntries(TASK_SECTIONS.map(s => [s.key, s]));

export const dayTaskKey = (day, site) => `${day}|${site || '전체'}`;
export const getDayEntry = (doc, day, site) => {
    if (!doc.dayTasks || typeof doc.dayTasks !== 'object') doc.dayTasks = {};
    const k = dayTaskKey(day, site);
    if (!doc.dayTasks[k]) doc.dayTasks[k] = { tasks: [], dist: null };
    if (!Array.isArray(doc.dayTasks[k].tasks)) doc.dayTasks[k].tasks = [];
    return doc.dayTasks[k];
};
// 빈 항목은 저장하지 않는다
export const cleanDayTasks = (doc) => {
    Object.entries(doc.dayTasks || {}).forEach(([k, e]) => {
        e.tasks = (e.tasks || []).filter(t => String(t.text || '').trim() || (t.people || []).length);
        if (!e.tasks.length && !e.dist) delete doc.dayTasks[k];
    });
};

const newTaskId = () => `T${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const unitOf = (l) => l.unit || (l.type === '원액' ? 'L' : 'EA');
const onlineIds = () => new Set((window.__presence || []).map(p => String(p.id)));

// 생산 줄 → 업무 글
const lineTaskText = (l, allSites) => `${allSites ? `[${l.site}] ` : ''}${l.name || l.code}${l.spec ? ` ${l.spec}` : ''} ${fmtQty(l.qty)}${unitOf(l)}${l.line ? ` · ${l.line}` : ''}${l.partner ? ` · ${l.partner}` : ''}`.trim();

// 지난 업무일지(이 날짜 전 가장 최근)에서 반복 업무: 기타업무 업무명, 택배 구분, 이동 경로
const WL = { 본사: 'hqLogs', 김포: 'gimpoLogs' };
const repeatedFromWorklog = (day, site) => {
    const out = [];
    const sites = site ? [site] : Object.keys(WL);
    sites.forEach(s => {
        const logs = (state[WL[s]] || []).filter(l => l.date && l.date < day).sort((a, b) => b.date.localeCompare(a.date));
        const log = logs[0];
        if (!log) return;
        const pre = site ? '' : `[${s}] `;
        (log.otherTasks || []).forEach(r => r.task && out.push({ sec: 'otherTasks', text: `${pre}${r.task}`, from: log.date }));
        (log.courier || []).forEach(r => r.type && out.push({ sec: 'courier', text: `${pre}택배 ${r.type}`, from: log.date }));
        [...new Set((log.movement || []).map(r => r.route).filter(Boolean))].forEach(r => out.push({ sec: 'movement', text: `${pre}${r} 이동`, from: log.date }));
        if ((log.labeling || []).length) out.push({ sec: 'labeling', text: `${pre}라벨 부착`, from: log.date });
    });
    return out;
};

// ---------- 담당자 여러 명 고르기 ----------
export const pickPeople = (selected = [], { title = '담당자 선택' } = {}) => new Promise(async (resolve) => {
    const people = await listPeople();
    const groups = groupPeopleByOrg(people).map(g => ({ ...g, users: g.members.flatMap(m => m.users.map(u => ({ ...u, position: g.key === 'ETC' ? '' : m.position }))) })).filter(g => g.users.length);
    const picked = new Map(selected.map(p => [String(p.id), p]));
    const online = onlineIds();
    const box = document.createElement('div');
    box.className = 'fixed inset-0 z-[80] bg-slate-900/60 p-3 flex items-start justify-center overflow-y-auto';
    box.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-6 text-xs overflow-hidden flex flex-col max-h-[88vh]">
        <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between"><h3 class="font-black text-sm">${esc(title)}</h3><button type="button" class="pp-x text-slate-300 hover:text-white text-xl px-1">&times;</button></div>
        <div class="p-3 border-b border-slate-200 space-y-2">
            <input type="search" class="pp-q w-full border border-slate-300 rounded-lg px-2.5 py-2 font-bold" placeholder="이름·부서 검색" />
            <div class="pp-picked flex flex-wrap gap-1 min-h-[24px]"></div>
        </div>
        <div class="pp-list flex-1 min-h-0 overflow-y-auto p-2 space-y-2"></div>
        <div class="p-3 border-t border-slate-200 flex justify-between items-center gap-2">
            <span class="text-[11px] text-slate-500"><span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span> 지금 접속 중</span>
            <div class="flex gap-2"><button type="button" class="pp-x px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold">취소</button>
            <button type="button" class="pp-ok px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-black">선택 완료</button></div>
        </div></div>`;
    document.body.appendChild(box);
    const $ = (s) => box.querySelector(s);
    const drawPicked = () => {
        $('.pp-picked').innerHTML = picked.size ? [...picked.values()].map(p => `<span class="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold flex items-center gap-1">${esc(p.name)}<button type="button" class="pp-un" data-id="${esc(p.id)}">×</button></span>`).join('')
            : '<span class="text-slate-400">선택한 사람이 없습니다.</span>';
        box.querySelectorAll('.pp-un').forEach(b => b.addEventListener('click', () => { picked.delete(b.dataset.id); drawPicked(); drawList(); }));
    };
    const drawList = () => {
        const q = $('.pp-q').value.trim();
        $('.pp-list').innerHTML = groups.map(g => {
            const us = g.users.filter(u => !q || `${u.name} ${g.label} ${u.position}`.includes(q));
            if (!us.length) return '';
            const all = us.every(u => picked.has(String(u.id)));
            return `<div class="border border-slate-200 rounded-xl overflow-hidden">
                <label class="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 font-black text-slate-700 cursor-pointer"><input type="checkbox" class="pp-g" data-g="${esc(g.key)}" ${all ? 'checked' : ''} />${esc(g.label)} <span class="text-slate-400 font-bold">${us.length}명</span></label>
                <div class="grid grid-cols-2 gap-x-2 p-1.5">${us.map(u => `<label class="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-blue-50 cursor-pointer">
                    <input type="checkbox" class="pp-u" data-id="${esc(u.id)}" ${picked.has(String(u.id)) ? 'checked' : ''} />
                    <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 ${online.has(String(u.id)) ? 'bg-emerald-500' : 'bg-slate-300'}"></span>
                    <span class="font-bold truncate">${esc(u.name)}</span><span class="text-slate-400 truncate">${esc(u.position || '')}</span></label>`).join('')}</div></div>`;
        }).join('') || '<div class="p-6 text-center text-slate-400 font-bold">검색 결과가 없습니다.</div>';
        const byId = new Map(groups.flatMap(g => g.users).map(u => [String(u.id), u]));
        box.querySelectorAll('.pp-u').forEach(c => c.addEventListener('change', () => {
            const u = byId.get(c.dataset.id);
            if (c.checked) picked.set(c.dataset.id, { id: u.id, name: u.name }); else picked.delete(c.dataset.id);
            drawPicked(); drawList();
        }));
        box.querySelectorAll('.pp-g').forEach(c => c.addEventListener('change', () => {
            const g = groups.find(x => x.key === c.dataset.g);
            g.users.filter(u => !q || `${u.name} ${g.label} ${u.position}`.includes(q)).forEach(u => { if (c.checked) picked.set(String(u.id), { id: u.id, name: u.name }); else picked.delete(String(u.id)); });
            drawPicked(); drawList();
        }));
    };
    const close = (v) => { box.remove(); resolve(v); };
    box.querySelectorAll('.pp-x').forEach(b => b.addEventListener('click', () => close(null)));
    $('.pp-ok').addEventListener('click', () => close([...picked.values()]));
    $('.pp-q').addEventListener('input', drawList);
    drawPicked(); drawList();
    setTimeout(() => $('.pp-q').focus(), 50);
});

// ---------- 인쇄·첨부용 표 ----------
export const tasksPrintHtml = (entry) => {
    const tasks = (entry?.tasks || []).filter(t => String(t.text || '').trim());
    if (!tasks.length) return '';
    const rows = TASK_SECTIONS.map(s => {
        const ts = tasks.filter(t => t.sec === s.key);
        if (!ts.length) return '';
        return `<tr class="day"><td colspan="6">${esc(s.label)} · ${ts.length}건</td></tr>` + ts.map((t, i) => `<tr>
            <td class="c">${i + 1}</td><td>${esc(t.text)}</td><td class="c">${esc(t.time || '')}</td>
            <td>${esc((t.people || []).map(p => p.name).join(', '))}</td><td>${esc(t.note || '')}</td><td></td></tr>`).join('');
    }).join('');
    return `<h2>업무 계획 (업무일지 양식)</h2>
        <table class="grid"><colgroup><col style="width:8mm"><col><col style="width:14mm"><col style="width:34mm"><col style="width:34mm"><col style="width:14mm"></colgroup>
        <thead><tr><th>No</th><th>업무 내용</th><th>시간</th><th>담당자</th><th>비고</th><th>확인</th></tr></thead><tbody>${rows}</tbody></table>`;
};

// ---------- 화면 ----------
/**
 * @param host 그릴 곳
 * @param ctx { doc, day, site, canEdit, getLines() → 이 날짜 생산 줄, setDirty(bool), isDirty(), save() → Promise, buildPlanFile() → Promise<File>, showToast }
 */
export const renderDayTasks = (host, ctx) => {
    const { doc, day, site, canEdit, showToast = () => {} } = ctx;
    const entry = getDayEntry(doc, day, site);
    let checked = new Set();

    const peopleOf = () => {
        const m = new Map();
        entry.tasks.forEach(t => (t.people || []).forEach(p => { if (String(t.text || '').trim()) { if (!m.has(String(p.id))) m.set(String(p.id), { ...p, n: 0 }); m.get(String(p.id)).n += 1; } }));
        return [...m.values()];
    };
    const chipHtml = (p, t) => `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-800 font-bold text-[11px]">${esc(p.name)}${canEdit ? `<button type="button" class="dt-unp leading-none" data-t="${esc(t.id)}" data-p="${esc(p.id)}" title="빼기">×</button>` : ''}</span>`;

    const draw = () => {
        const ppl = peopleOf();
        const n = entry.tasks.filter(t => String(t.text || '').trim()).length;
        const d = entry.dist;
        host.innerHTML = `
            <div class="border border-indigo-200 rounded-2xl overflow-hidden">
                <div class="px-4 py-3 bg-indigo-50 flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h4 class="text-sm font-black text-indigo-950 flex items-center gap-1.5"><i data-lucide="clipboard-list" class="w-4 h-4"></i>업무 계획 · 담당자 배포 <span class="text-[11px] font-bold text-indigo-600">(업무일지 양식 1~7)</span></h4>
                        <p class="text-[11px] text-indigo-800/80 mt-0.5">업무마다 담당자를 여러 명 지정하고 [배포]하면, 담당자마다 자기 업무가 할일에 등록되고 계획서가 첨부된 메시지·알림이 갑니다.</p>
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                        ${canEdit ? `<button type="button" id="dt-from-lines" class="${btn('bg-white text-slate-700 border border-slate-300 hover:bg-slate-50')}" title="이 날짜 생산 줄(완제품·원액)을 1·2번 업무로"><i data-lucide="factory" class="w-4 h-4"></i>생산 줄 → 업무</button>
                        <button type="button" id="dt-from-log" class="${btn('bg-white text-slate-700 border border-slate-300 hover:bg-slate-50')}" title="지난 업무일지의 기타업무·택배·이동을 가져오기"><i data-lucide="history" class="w-4 h-4"></i>지난 업무일지 반복업무</button>
                        <button type="button" id="dt-bulk" class="${btn('bg-white text-blue-700 border border-blue-300 hover:bg-blue-50')}"><i data-lucide="user-plus" class="w-4 h-4"></i>선택 업무 담당자 지정</button>
                        <button type="button" id="dt-dist" class="${btn('bg-indigo-600 hover:bg-indigo-700 text-white')}"><i data-lucide="send" class="w-4 h-4"></i>배포</button>` : ''}
                    </div>
                </div>
                <div class="px-4 py-2 border-b border-indigo-100 bg-white flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                    <span class="font-black text-slate-700">업무 ${n}건 · 담당자 ${ppl.length}명</span>
                    ${ppl.map(p => `<span class="text-slate-600">${esc(p.name)} <b class="text-blue-700">${p.n}</b></span>`).join('<span class="text-slate-300">|</span>')}
                    <span class="ml-auto ${d ? 'text-emerald-700 font-bold' : 'text-slate-400'}">${d ? `✔ 배포 ${esc(new Date(d.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))} ·${esc(d.by || '')} · ${esc(d.count ?? '')}명` : '아직 배포하지 않음'}</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-xs min-w-[760px]">
                        <thead class="bg-slate-50 text-slate-600"><tr>
                            ${canEdit ? '<th class="p-2 w-8"><input type="checkbox" id="dt-all" /></th>' : ''}
                            <th class="p-2 text-left">업무 내용</th><th class="p-2 w-24">시간</th><th class="p-2 text-left w-[240px]">담당자</th><th class="p-2 text-left w-40">비고</th>${canEdit ? '<th class="p-2 w-10"></th>' : ''}
                        </tr></thead>
                        <tbody>${TASK_SECTIONS.map(s => {
                            const ts = entry.tasks.filter(t => t.sec === s.key);
                            return `<tr class="bg-slate-100/80 border-t border-slate-200"><td colspan="${canEdit ? 6 : 4}" class="px-2 py-1.5">
                                <div class="flex items-center gap-2"><i data-lucide="${s.icon}" class="w-3.5 h-3.5 text-slate-500"></i><b class="text-slate-800">${esc(s.label)}</b><span class="text-slate-400">${ts.length ? `${ts.length}건` : ''} · ${esc(s.hint)}</span>
                                ${canEdit ? `<button type="button" class="dt-add ml-auto px-2 py-0.5 rounded-md bg-white border border-slate-300 hover:bg-blue-50 font-bold text-[11px]" data-sec="${s.key}">+ 추가</button>` : ''}</div></td></tr>`
                                + ts.map(t => `<tr class="border-t border-slate-100 align-top" data-id="${esc(t.id)}">
                                    ${canEdit ? `<td class="p-1.5 text-center"><input type="checkbox" class="dt-chk mt-1.5" ${checked.has(t.id) ? 'checked' : ''} /></td>` : ''}
                                    <td class="p-1.5">${canEdit ? `<input type="text" class="dt-f w-full border border-slate-300 rounded-md px-2 py-1.5 font-bold" data-k="text" maxlength="300" value="${esc(t.text)}" placeholder="${esc(s.hint)}" />` : `<b>${esc(t.text)}</b>`}</td>
                                    <td class="p-1.5">${canEdit ? `<input type="time" class="dt-f w-full border border-slate-300 rounded-md px-1 py-1.5" data-k="time" value="${esc(t.time || '')}" />` : esc(t.time || '')}</td>
                                    <td class="p-1.5"><div class="flex flex-wrap items-center gap-1">${(t.people || []).map(p => chipHtml(p, t)).join('')}
                                        ${canEdit ? `<button type="button" class="dt-pick px-1.5 py-0.5 rounded-full border border-dashed border-blue-400 text-blue-700 font-bold text-[11px] hover:bg-blue-50">+ 담당</button>` : (t.people || []).length ? '' : '<span class="text-slate-400">-</span>'}</div></td>
                                    <td class="p-1.5">${canEdit ? `<input type="text" class="dt-f w-full border border-slate-300 rounded-md px-2 py-1.5" data-k="note" maxlength="200" value="${esc(t.note || '')}" />` : esc(t.note || '')}</td>
                                    ${canEdit ? '<td class="p-1.5 text-center"><button type="button" class="dt-del text-slate-400 hover:text-rose-600 font-black px-1.5 py-1" title="삭제">✕</button></td>' : ''}
                                </tr>`).join('');
                        }).join('')}</tbody>
                    </table>
                </div>
            </div>`;
        createIcons({ icons });
        bind();
    };

    const changed = () => ctx.setDirty(true);
    const addTask = (sec, text = '', extra = {}) => { const t = { id: newTaskId(), sec, text, time: '', people: [], note: '', ...extra }; entry.tasks.push(t); return t; };

    const bind = () => {
        const $ = (s) => host.querySelector(s);
        const taskOf = (el) => entry.tasks.find(t => t.id === el.closest('tr[data-id]')?.dataset.id);
        host.querySelectorAll('.dt-f').forEach(inp => inp.addEventListener('input', () => { const t = taskOf(inp); if (t) { t[inp.dataset.k] = inp.value; changed(); } }));
        host.querySelectorAll('.dt-add').forEach(b => b.addEventListener('click', () => {
            const t = addTask(b.dataset.sec);
            changed(); draw();
            host.querySelector(`tr[data-id="${t.id}"] input[data-k="text"]`)?.focus();
        }));
        host.querySelectorAll('.dt-del').forEach(b => b.addEventListener('click', () => {
            const t = taskOf(b);
            if (t && (t.text || (t.people || []).length) && !confirm(`'${(t.text || '').slice(0, 30)}' 업무를 지울까요?`)) return;
            entry.tasks = entry.tasks.filter(x => x !== t);
            checked.delete(t?.id);
            changed(); draw();
        }));
        host.querySelectorAll('.dt-unp').forEach(b => b.addEventListener('click', () => {
            const t = entry.tasks.find(x => x.id === b.dataset.t);
            if (!t) return;
            t.people = (t.people || []).filter(p => String(p.id) !== b.dataset.p);
            changed(); draw();
        }));
        host.querySelectorAll('.dt-pick').forEach(b => b.addEventListener('click', async () => {
            const t = taskOf(b);
            const res = await pickPeople(t.people || [], { title: `담당자 선택 — ${SEC[t.sec]?.short || ''} ${t.text || ''}`.slice(0, 60) });
            if (!res) return;
            t.people = res;
            changed(); draw();
        }));
        host.querySelectorAll('.dt-chk').forEach(c => c.addEventListener('change', () => { const t = taskOf(c); if (c.checked) checked.add(t.id); else checked.delete(t.id); }));
        $('#dt-all')?.addEventListener('change', (e) => { checked = new Set(e.target.checked ? entry.tasks.map(t => t.id) : []); host.querySelectorAll('.dt-chk').forEach(c => { c.checked = e.target.checked; }); });
        $('#dt-bulk')?.addEventListener('click', async () => {
            const ts = entry.tasks.filter(t => checked.has(t.id));
            if (!ts.length) { alert('담당자를 지정할 업무를 왼쪽 칸에서 고르세요.'); return; }
            const res = await pickPeople([], { title: `선택한 업무 ${ts.length}건에 담당자 추가` });
            if (!res?.length) return;
            ts.forEach(t => { const have = new Set((t.people || []).map(p => String(p.id))); t.people = [...(t.people || []), ...res.filter(p => !have.has(String(p.id)))]; });
            checked = new Set();
            changed(); draw();
            showToast(`👥 업무 ${ts.length}건에 ${res.map(p => p.name).join(', ')} 지정`);
        });
        $('#dt-from-lines')?.addEventListener('click', () => {
            const lines = ctx.getLines().filter(l => l.code || l.name);
            if (!lines.length) { alert('이 날짜의 생산 줄이 없습니다. 위 표에 먼저 넣으세요.'); return; }
            let add = 0, upd = 0;
            lines.forEach(l => {
                const sec = l.type === '원액' ? 'oilBlending' : 'packaging';
                const text = lineTaskText(l, !site);
                const old = entry.tasks.find(t => t.src === `L:${l.id}`);
                if (old) { if (old.text !== text || old.sec !== sec) { old.text = text; old.sec = sec; upd += 1; } } else { addTask(sec, text, { src: `L:${l.id}` }); add += 1; }
            });
            changed(); draw();
            showToast(`🏭 생산 줄 → 업무: 추가 ${add}건${upd ? ` · 고침 ${upd}건` : ''}`);
        });
        $('#dt-from-log')?.addEventListener('click', () => {
            const rep = repeatedFromWorklog(day, site);
            if (!rep.length) { alert('이 날짜 전의 업무일지를 찾지 못했습니다. (업무일지 화면을 한 번 열면 불러옵니다)'); return; }
            let add = 0;
            rep.forEach(r => { if (!entry.tasks.some(t => t.sec === r.sec && t.text === r.text)) { addTask(r.sec, r.text); add += 1; } });
            changed(); draw();
            showToast(add ? `📒 ${[...new Set(rep.map(r => r.from))].join(', ')} 업무일지에서 ${add}건 가져옴` : '이미 모두 들어 있습니다.');
        });
        $('#dt-dist')?.addEventListener('click', distribute);
    };

    const distribute = async () => {
        const tasks = entry.tasks.filter(t => String(t.text || '').trim());
        const noOwner = tasks.filter(t => !(t.people || []).length);
        const ppl = peopleOf();
        if (!ppl.length) { alert('담당자가 지정된 업무가 없습니다. 업무마다 [+ 담당]으로 담당자를 고르세요.'); return; }
        const msg = `${day}${site ? ` (${site})` : ''} 일일 생산계획을 배포할까요?\n\n${ppl.map(p => `· ${p.name}: 업무 ${p.n}건`).join('\n')}${noOwner.length ? `\n\n※ 담당자 없는 업무 ${noOwner.length}건은 배포되지 않습니다.` : ''}\n\n담당자 할일에 등록하고, 계획서를 첨부한 메시지를 보냅니다.${ctx.isDirty() ? '\n(저장하지 않은 변경은 먼저 저장합니다)' : ''}`;
        if (!confirm(msg)) return;
        const b = host.querySelector('#dt-dist');
        if (b) { b.disabled = true; b.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i>배포 중…'; createIcons({ icons }); }
        try {
            if (ctx.isDirty()) await ctx.save();
            const cur = getDayEntry(ctx.doc, day, site); // 저장하면 doc가 새로 바뀐다
            const file = await ctx.buildPlanFile().catch(() => null);
            const ref = `PLANDAY:${day}:${site || '전체'}`;
            const people = ppl.map(p => ({
                id: p.id, name: p.name,
                tasks: cur.tasks.filter(t => String(t.text || '').trim() && (t.people || []).some(x => String(x.id) === String(p.id)))
                    .map(t => ({ key: t.id, text: `[${md(day)} ${SEC[t.sec]?.short || ''}] ${t.text}${t.note ? ` (${t.note})` : ''}`, msgText: `${t.text}${t.note ? ` (${t.note})` : ''}`, label: SEC[t.sec]?.label || '', dueDate: day, dueTime: t.time || '' }))
            }));
            const res = await distributePlan({
                ref, people, prev: cur.dist?.map || {},
                title: `[일일 생산계획 배포] ${day}${site ? ` ${site}` : ''}`,
                lines: [`생산 ${ctx.getLines().filter(l => l.code || l.name).length}건 · 업무 ${tasks.length}건`],
                link: { tab: 'prodPlan', set: { __pendingPlanOpen: { tab: 'prodPlan', view: 'day', date: day, site } } },
                file
            });
            cur.dist = { at: new Date().toISOString(), by: state.currentUser?.name || '', count: Object.keys(res.map).length, map: res.map };
            await ctx.save();
            const mine = people.some(p => String(p.id) === String(myChatId()));
            alert(`배포했습니다.\n· 할일 등록 ${Object.keys(res.map).length}명${mine ? ' (나 포함)' : ''}\n· 메시지 ${res.sent}명${file ? ' (계획서 첨부)' : ''}${res.failed.length ? `\n\n실패:\n${res.failed.join('\n')}` : ''}`);
        } catch (e) {
            alert(`배포하지 못했습니다: ${e.message}`);
        }
        ctx.rerender();
    };

    draw();
};
