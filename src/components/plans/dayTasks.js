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
import { issueSlip, updateSlip, getSlipByDocNo } from '../../services/db.js';
import { sitesOf } from '../../services/locations.js';
import { searchMasterItems } from '../../services/searchUtils.js';
import { parseItemLine } from '../../services/msgIntake.js';

// ---------- 출고·이동 업무 → 전표 (출고요청서 RQ · 원부자재 이동전표 TR) ----------
// 업무 t.slip = { from, to, partner, items: [{ code, name, spec, qty, unit }] }, 발행하면 t.slipNo · t.slipSig(내용 지문)
export const SLIP_SECS = { shipping: { type: 'RELEASE', label: '출고요청서' }, movement: { type: 'TRANSFER', label: '이동전표' } };
const EXTERNAL = '외부 거래처';
const slipItemsOf = (t) => {
    const items = (t.slip?.items || []).filter(it => (it.code || it.name) && Number(it.qty) > 0);
    if (items.length) return items;
    // 품목을 따로 안 넣었으면 업무 글에서 (예: 'GT 엔진오일 0W20 2PLT 지티 출고')
    const it = parseItemLine(String(t.text || '').replace(/^\[[^\]]*\]\s*/, ''));
    return it?.code && Number(it.qty) > 0 ? [{ code: it.code, name: it.name, spec: it.spec, qty: Number(it.qty), unit: it.unit || 'EA' }] : [];
};
const slipOf = (t, day, site) => {
    const def = SLIP_SECS[t.sec];
    const s = t.slip || {};
    const sites = sitesOf(state.locations);
    const from = s.from || (site && sites.find(x => x.includes(site))) || sites[0] || '';
    return {
        type: def.type, date: day, fromLoc: from,
        // 도착: 고른 거점 → 업무 글에 적힌 거점('김포 이동') → 출발지가 아닌 첫 거점
        toLoc: def.type === 'RELEASE' ? EXTERNAL : (s.to || sites.find(x => x !== from && String(t.text || '').includes(x.replace(/공장$/, ''))) || sites.find(x => x !== from) || ''),
        partner: s.partner || '', transport: '사내 차량',
        reason: `일일 생산계획 ${day} · ${String(t.text || '').slice(0, 80)}`,
        worker: state.currentGlobalWorker || state.currentUser?.name || '', shipTime: t.time || '',
        assigneeId: t.people?.[0]?.id || '', assigneeName: t.people?.[0]?.name || '',
        items: slipItemsOf(t).map(it => ({ code: it.code || '', name: it.name || '', spec: it.spec || '', qty: Number(it.qty) || 0, unit: it.unit || 'EA', note: '' }))
    };
};
const sigOf = (s) => JSON.stringify([s.fromLoc, s.toLoc, s.partner, s.shipTime, s.items.map(i => [i.code, i.name, i.qty, i.unit])]);

/**
 * 출고·이동 업무의 전표를 만들거나(처음) 고친다(내용이 바뀐 경우).
 * @returns { made: [번호], updated: [번호], skipped: [사유], failed: [사유] }
 */
export const syncTaskSlips = async (entry, day, site) => {
    const res = { made: [], updated: [], skipped: [], failed: [] };
    for (const t of entry.tasks) {
        if (!SLIP_SECS[t.sec] || !String(t.text || '').trim() && !(t.slip?.items || []).length) continue;
        const s = slipOf(t, day, site);
        const name = String(t.text || SLIP_SECS[t.sec].label).slice(0, 30);
        if (!s.items.length) { res.skipped.push(`${name}: 품목·수량 없음`); continue; }
        if (s.type === 'RELEASE' && !s.partner) { res.skipped.push(`${name}: 거래처(받는 곳) 없음`); continue; }
        if (s.type === 'TRANSFER' && (!s.toLoc || s.toLoc === s.fromLoc)) { res.skipped.push(`${name}: 도착 거점 확인 필요`); continue; }
        const sig = sigOf(s);
        try {
            if (t.slipNo) {
                // 발행된 전표에서 자동으로 들어온 업무(지문 없음)는 지금 내용을 기준으로 삼는다
                if (!t.slipSig) { t.slipSig = sig; continue; }
                if (t.slipSig === sig) continue;
                const exists = await getSlipByDocNo(t.slipNo).catch(() => null);
                if (exists) { await updateSlip(t.slipNo, s); res.updated.push(t.slipNo); t.slipSig = sig; continue; }
            }
            const saved = await issueSlip(s);
            t.slipNo = saved.docNo; t.slipSig = sig;
            res.made.push(saved.docNo);
        } catch (e) { res.failed.push(`${name}: ${e.message}`); }
    }
    return res;
};
export const slipResultText = (r) => [
    r.made.length ? `📄 전표 발행 ${r.made.length}건: ${r.made.join(', ')}` : '',
    r.updated.length ? `✏ 전표 수정 ${r.updated.length}건: ${r.updated.join(', ')}` : '',
    r.skipped.length ? `· 전표 건너뜀: ${r.skipped.join(' / ')}` : '',
    r.failed.length ? `⚠ 전표 실패: ${r.failed.join(' / ')}` : ''
].filter(Boolean).join('\n');

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
// 전표 업무는 '<날짜>|전체'에 하나만 두고, 거점 화면(본사·김포)에서는 출발 거점(이동은 도착 거점도)이 같은 것을 함께 보여 준다.
// 같은 객체를 보여 주므로 거점 화면에서 고쳐도 '전체' 쪽에 저장된다.
const siteOfLoc = (loc) => { const s = String(loc || ''); return /김포/.test(s) ? '김포' : /본사|방산|도창|신천/.test(s) ? '본사' : ''; };
export const sharedSlipTasks = (doc, day, site) => {
    if (!site) return [];
    const src = doc?.dayTasks?.[dayTaskKey(day, '')];
    return (src?.tasks || []).filter(t => t.slipNo && (siteOfLoc(t.slip?.from) === site || (t.sec === 'movement' && siteOfLoc(t.slip?.to) === site)));
};
/** 화면·인쇄·배포에 쓰는 그 날짜 업무 전체 (거점 업무 + 공유 전표 업무) */
export const dayTaskList = (doc, day, site) => [...(doc?.dayTasks?.[dayTaskKey(day, site)]?.tasks || []), ...sharedSlipTasks(doc, day, site)];

/**
 * 주간 계획의 그 날짜 생산 줄 → 1·2번 업무 자동 반영 (일일 계획을 열 때)
 * 줄이 새로 생기면 업무 추가, 바뀌면 글 고침, 줄이 없어지면 담당자 없는 업무만 뺀다.
 * @returns 바뀌었으면 true
 */
export const syncLineTasks = (doc, day, site, lines) => {
    const valid = (lines || []).filter(l => l.code || l.name);
    if (!valid.length && !doc.dayTasks?.[dayTaskKey(day, site)]) return false;
    const entry = getDayEntry(doc, day, site);
    let changed = false;
    valid.forEach(l => {
        const sec = l.type === '원액' ? 'oilBlending' : 'packaging';
        const text = lineTaskText(l, !site);
        const old = entry.tasks.find(t => t.src === `L:${l.id}`);
        if (old) { if (old.text !== text || old.sec !== sec) { old.text = text; old.sec = sec; changed = true; } } else {
            entry.tasks.push({ id: newTaskId(), sec, text, time: '', people: [], note: '', src: `L:${l.id}` });
            changed = true;
        }
    });
    const ids = new Set(valid.map(l => `L:${l.id}`));
    const before = entry.tasks.length;
    entry.tasks = entry.tasks.filter(t => !String(t.src || '').startsWith('L:') || ids.has(t.src) || (t.people || []).length);
    return changed || entry.tasks.length !== before;
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
            <td>${esc((t.people || []).map(p => p.name).join(', '))}</td><td>${esc([t.note, t.slipNo ? `전표 ${t.slipNo}` : ''].filter(Boolean).join(' · '))}</td><td></td></tr>`).join('');
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
    // 거점 화면이면 '전체'의 전표 업무도 함께 (sharedSlipTasks)
    const all = () => [...entry.tasks, ...sharedSlipTasks(doc, day, site)];
    let checked = new Set();

    const peopleOf = () => {
        const m = new Map();
        all().forEach(t => (t.people || []).forEach(p => { if (String(t.text || '').trim()) { if (!m.has(String(p.id))) m.set(String(p.id), { ...p, n: 0 }); m.get(String(p.id)).n += 1; } }));
        return [...m.values()];
    };
    const chipHtml = (p, t) => `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-800 font-bold text-[11px]">${esc(p.name)}${canEdit ? `<button type="button" class="dt-unp leading-none" data-t="${esc(t.id)}" data-p="${esc(p.id)}" title="빼기">×</button>` : ''}</span>`;

    // 출고·이동 업무 아래 줄: 전표 내용(출발·도착/거래처·품목)과 발행 상태
    const slipRowHtml = (t) => {
        const def = SLIP_SECS[t.sec];
        const s = t.slip || {};
        const sites = sitesOf(state.locations);
        const pv = slipOf(t, day, site);
        const changed = t.slipNo && t.slipSig && t.slipSig !== sigOf(pv);
        const siteSel = (k, val) => `<select class="dt-s border border-slate-300 rounded px-1 py-0.5 font-bold" data-k="${k}" ${canEdit ? '' : 'disabled'}>${sites.map(x => `<option ${x === val ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
        const items = s.items || [];
        return `<tr class="dt-slip" data-id="${esc(t.id)}"><td colspan="${canEdit ? 6 : 4}" class="px-1.5 pb-2 pt-0">
            <div class="ml-0 sm:ml-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                <b class="text-amber-900">📄 ${def.label}</b>
                <span>출발 ${siteSel('from', pv.fromLoc)}</span>
                ${def.type === 'RELEASE'
                    ? `<span>→ 거래처 <input type="text" class="dt-s w-32 border border-slate-300 rounded px-1 py-0.5 font-bold" data-k="partner" list="dt-partners" value="${esc(s.partner || '')}" placeholder="받는 곳" ${canEdit ? '' : 'disabled'} /></span>`
                    : `<span>→ 도착 ${siteSel('to', pv.toLoc)}</span>`}
                <span class="flex flex-wrap items-center gap-1">${items.map((it, i) => `<span class="px-1.5 py-0.5 rounded bg-white border border-amber-300 font-bold">${esc(it.name)} ${esc(fmtQty(it.qty))}${esc(it.unit || '')}${canEdit ? ` <button type="button" class="dt-si-del" data-i="${i}">×</button>` : ''}</span>`).join('')}
                    ${!items.length && pv.items.length ? `<span class="text-slate-500">업무 글에서: <b>${esc(pv.items[0].name)} ${esc(fmtQty(pv.items[0].qty))}${esc(pv.items[0].unit)}</b></span>` : ''}</span>
                ${canEdit ? `<span class="relative inline-flex items-center gap-1"><input type="text" class="dt-si-name w-36 border border-slate-300 rounded px-1 py-0.5" placeholder="+ 품목 검색" autocomplete="off" />
                    <input type="text" inputmode="decimal" class="dt-si-qty w-14 border border-slate-300 rounded px-1 py-0.5 text-right" placeholder="수량" />
                    <input type="text" class="dt-si-unit w-12 border border-slate-300 rounded px-1 py-0.5" placeholder="단위" />
                    <button type="button" class="dt-si-add px-1.5 py-0.5 rounded bg-amber-500 text-white font-bold">추가</button>
                    <div class="dt-si-sg hidden absolute left-0 top-full z-30 w-72 max-h-48 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl"></div></span>` : ''}
                <span class="ml-auto">${t.slipNo ? `<button type="button" class="dt-open-slip font-mono font-black text-blue-700 underline">${esc(t.slipNo)}</button> ${changed ? '<span class="text-rose-600 font-bold">내용 바뀜 · 배포 때 전표 수정</span>' : '<span class="text-emerald-700 font-bold">발행됨</span>'}` : '<span class="text-slate-500">배포하면 전표 자동 발행</span>'}</span>
            </div></td></tr>`;
    };

    const draw = () => {
        const ppl = peopleOf();
        const n = all().filter(t => String(t.text || '').trim()).length;
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
                        <button type="button" id="dt-slips" class="${btn('bg-white text-amber-800 border border-amber-300 hover:bg-amber-50')}" title="출고·이동 업무의 출고요청서·이동전표를 지금 발행 (배포할 때도 자동)"><i data-lucide="file-text" class="w-4 h-4"></i>출고·이동 전표 발행</button>
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
                            const ts = all().filter(t => t.sec === s.key);
                            return `<tr class="bg-slate-100/80 border-t border-slate-200"><td colspan="${canEdit ? 6 : 4}" class="px-2 py-1.5">
                                <div class="flex items-center gap-2"><i data-lucide="${s.icon}" class="w-3.5 h-3.5 text-slate-500"></i><b class="text-slate-800">${esc(s.label)}</b><span class="text-slate-400">${ts.length ? `${ts.length}건` : ''} · ${esc(s.hint)}</span>
                                ${canEdit ? `<button type="button" class="dt-add ml-auto px-2 py-0.5 rounded-md bg-white border border-slate-300 hover:bg-blue-50 font-bold text-[11px]" data-sec="${s.key}">+ 추가</button>` : ''}</div></td></tr>`
                                + ts.map(t => `<tr class="border-t border-slate-100 align-top" data-id="${esc(t.id)}">
                                    ${canEdit ? `<td class="p-1.5 text-center"><input type="checkbox" class="dt-chk mt-1.5" ${checked.has(t.id) ? 'checked' : ''} /></td>` : ''}
                                    <td class="p-1.5">${canEdit ? `<input type="text" class="dt-f w-full border border-slate-300 rounded-md px-2 py-1.5 font-bold" data-k="text" maxlength="300" value="${esc(t.text)}" placeholder="${esc(s.hint)}" />` : `<b>${esc(t.text)}</b>`}${site && !entry.tasks.includes(t) ? '<div class="text-[10px] text-sky-700 mt-0.5">📄 전표 업무 · 전체 계획과 함께 저장됩니다</div>' : ''}</td>
                                    <td class="p-1.5">${canEdit ? `<input type="time" class="dt-f w-full border border-slate-300 rounded-md px-1 py-1.5" data-k="time" value="${esc(t.time || '')}" />` : esc(t.time || '')}</td>
                                    <td class="p-1.5"><div class="flex flex-wrap items-center gap-1">${(t.people || []).map(p => chipHtml(p, t)).join('')}
                                        ${canEdit ? `<button type="button" class="dt-pick px-1.5 py-0.5 rounded-full border border-dashed border-blue-400 text-blue-700 font-bold text-[11px] hover:bg-blue-50">+ 담당</button>` : (t.people || []).length ? '' : '<span class="text-slate-400">-</span>'}</div></td>
                                    <td class="p-1.5">${canEdit ? `<input type="text" class="dt-f w-full border border-slate-300 rounded-md px-2 py-1.5" data-k="note" maxlength="200" value="${esc(t.note || '')}" />` : esc(t.note || '')}</td>
                                    ${canEdit ? '<td class="p-1.5 text-center"><button type="button" class="dt-del text-slate-400 hover:text-rose-600 font-black px-1.5 py-1" title="삭제">✕</button></td>' : ''}
                                </tr>${SLIP_SECS[t.sec] ? slipRowHtml(t) : ''}`).join('');
                        }).join('')}</tbody>
                    </table>
                    <datalist id="dt-partners">${(state.partners || []).map(p => `<option value="${esc(typeof p === 'string' ? p : p?.name || '')}"></option>`).join('')}</datalist>
                </div>
                <p class="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100">5. 출고 · 4. 이동제품 업무는 아래 노란 줄에 출발·도착(거래처)·품목을 넣으면 <b>배포할 때 출고요청서·이동전표가 자동으로 발행</b>됩니다 (품목을 안 넣으면 업무 글의 품목·수량을 씁니다). 발행 뒤 내용을 바꾸고 다시 배포하면 전표를 고칩니다.</p>
            </div>`;
        createIcons({ icons });
        bind();
    };

    const changed = () => ctx.setDirty(true);
    const addTask = (sec, text = '', extra = {}) => { const t = { id: newTaskId(), sec, text, time: '', people: [], note: '', ...extra }; entry.tasks.push(t); return t; };

    const bind = () => {
        const $ = (s) => host.querySelector(s);
        const taskOf = (el) => all().find(t => t.id === el.closest('tr[data-id]')?.dataset.id);
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
            const shared = doc.dayTasks?.[dayTaskKey(day, '')];
            if (site && shared) shared.tasks = (shared.tasks || []).filter(x => x !== t);
            checked.delete(t?.id);
            changed(); draw();
        }));
        host.querySelectorAll('.dt-unp').forEach(b => b.addEventListener('click', () => {
            const t = all().find(x => x.id === b.dataset.t);
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
        $('#dt-all')?.addEventListener('change', (e) => { checked = new Set(e.target.checked ? all().map(t => t.id) : []); host.querySelectorAll('.dt-chk').forEach(c => { c.checked = e.target.checked; }); });
        $('#dt-bulk')?.addEventListener('click', async () => {
            const ts = all().filter(t => checked.has(t.id));
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
        // 전표 줄
        host.querySelectorAll('tr.dt-slip').forEach(row => {
            const t = all().find(x => x.id === row.dataset.id);
            if (!t) return;
            const sl = () => { if (!t.slip) t.slip = { items: [] }; if (!Array.isArray(t.slip.items)) t.slip.items = []; return t.slip; };
            row.querySelectorAll('.dt-s').forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => { sl()[inp.dataset.k] = inp.value; changed(); }));
            row.querySelectorAll('.dt-si-del').forEach(b => b.addEventListener('click', () => { sl().items.splice(Number(b.dataset.i), 1); changed(); draw(); }));
            row.querySelector('.dt-open-slip')?.addEventListener('click', () => {
                if (ctx.isDirty() && !confirm('저장하지 않은 변경이 있습니다. 버리고 전표 화면으로 갈까요?')) return;
                ctx.setDirty(false);
                window.__slipOpenDocNo = t.slipNo; window.__switchTab?.('slipIssue');
            });
            const nameInp = row.querySelector('.dt-si-name');
            if (!nameInp) return;
            const sg = row.querySelector('.dt-si-sg');
            let picked = null; let found = [];
            nameInp.addEventListener('input', () => {
                picked = null;
                if (nameInp.value.trim().length < 2) { sg.classList.add('hidden'); return; }
                found = searchMasterItems(nameInp.value, 12);
                sg.innerHTML = found.map((m, i) => `<button type="button" data-j="${i}" class="w-full text-left px-2 py-1 border-b border-slate-100 hover:bg-amber-50"><span class="font-bold">${esc(m.name)}</span> <span class="font-mono text-[10px] text-blue-600">${esc(m.code)}</span></button>`).join('') || '<div class="p-2 text-slate-400">일치하는 품목이 없습니다.</div>';
                sg.classList.remove('hidden');
                sg.querySelectorAll('button').forEach(b => {
                    b.addEventListener('mousedown', (e) => e.preventDefault());
                    b.addEventListener('click', () => { picked = found[Number(b.dataset.j)]; nameInp.value = picked.name; row.querySelector('.dt-si-unit').value = picked.unit || 'EA'; sg.classList.add('hidden'); row.querySelector('.dt-si-qty').focus(); });
                });
            });
            nameInp.addEventListener('blur', () => setTimeout(() => sg.classList.add('hidden'), 150));
            const add = () => {
                const qty = Number(String(row.querySelector('.dt-si-qty').value).replace(/,/g, ''));
                if (!picked && !nameInp.value.trim()) { nameInp.focus(); return; }
                if (!(qty > 0)) { alert('수량을 넣으세요.'); row.querySelector('.dt-si-qty').focus(); return; }
                const m = picked || {};
                sl().items.push({ code: m.code || '', name: m.name || nameInp.value.trim(), spec: m.spec || '', qty, unit: row.querySelector('.dt-si-unit').value.trim() || m.unit || 'EA' });
                if (!String(t.text || '').trim()) t.text = `${sl().items[0].name} ${fmtQty(qty)}${sl().items[0].unit}`;
                changed(); draw();
                host.querySelector(`tr.dt-slip[data-id="${t.id}"] .dt-si-name`)?.focus();
            };
            row.querySelector('.dt-si-add').addEventListener('click', add);
            row.querySelector('.dt-si-qty').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
        });
        $('#dt-slips')?.addEventListener('click', async (e) => {
            if (!all().some(t => SLIP_SECS[t.sec])) { alert('5. 출고 · 4. 이동제품 업무가 없습니다.'); return; }
            e.currentTarget.disabled = true;
            try {
                if (ctx.isDirty()) await ctx.save();
                const cur = getDayEntry(ctx.doc, day, site);
                const r = await syncTaskSlips({ tasks: dayTaskList(ctx.doc, day, site) }, day, site);
                if (r.made.length || r.updated.length) await ctx.save();
                alert(slipResultText(r) || '새로 발행하거나 고칠 전표가 없습니다.');
            } catch (err) { alert(err.message); }
            ctx.rerender();
        });
    };

    const distribute = async () => {
        const tasks = all().filter(t => String(t.text || '').trim());
        const noOwner = tasks.filter(t => !(t.people || []).length);
        const ppl = peopleOf();
        if (!ppl.length) { alert('담당자가 지정된 업무가 없습니다. 업무마다 [+ 담당]으로 담당자를 고르세요.'); return; }
        const msg = `${day}${site ? ` (${site})` : ''} 일일 생산계획을 배포할까요?\n\n${ppl.map(p => `· ${p.name}: 업무 ${p.n}건`).join('\n')}${noOwner.length ? `\n\n※ 담당자 없는 업무 ${noOwner.length}건은 배포되지 않습니다.` : ''}\n\n담당자 할일에 등록하고, 계획서를 첨부한 메시지를 보냅니다.${ctx.isDirty() ? '\n(저장하지 않은 변경은 먼저 저장합니다)' : ''}`;
        if (!confirm(msg)) return;
        const b = host.querySelector('#dt-dist');
        if (b) { b.disabled = true; b.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i>배포 중…'; createIcons({ icons }); }
        try {
            if (ctx.isDirty()) await ctx.save();
            let cur = getDayEntry(ctx.doc, day, site); // 저장하면 doc가 새로 바뀐다
            // 출고·이동 업무 → 출고요청서·이동전표 자동 발행(처음)·수정(바뀐 경우)
            const sr = await syncTaskSlips({ tasks: dayTaskList(ctx.doc, day, site) }, day, site);
            if (sr.made.length || sr.updated.length) { await ctx.save(); cur = getDayEntry(ctx.doc, day, site); }
            const file = await ctx.buildPlanFile().catch(() => null);
            const ref = `PLANDAY:${day}:${site || '전체'}`;
            const people = ppl.map(p => ({
                id: p.id, name: p.name,
                tasks: dayTaskList(ctx.doc, day, site).filter(t => String(t.text || '').trim() && (t.people || []).some(x => String(x.id) === String(p.id)))
                    .map(t => ({ key: t.id, text: `[${md(day)} ${SEC[t.sec]?.short || ''}] ${t.text}${t.note ? ` (${t.note})` : ''}${t.slipNo ? ` · 전표 ${t.slipNo}` : ''}`, msgText: `${t.text}${t.note ? ` (${t.note})` : ''}${t.slipNo ? ` · 📄 ${t.slipNo}` : ''}`, label: SEC[t.sec]?.label || '', dueDate: day, dueTime: t.time || '' }))
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
            const st = slipResultText(sr);
            alert(`배포했습니다.\n· 할일 등록 ${Object.keys(res.map).length}명${mine ? ' (나 포함)' : ''}\n· 메시지 ${res.sent}명${file ? ' (계획서 첨부)' : ''}${st ? `\n${st}` : ''}${res.failed.length ? `\n\n실패:\n${res.failed.join('\n')}` : ''}`);
        } catch (e) {
            alert(`배포하지 못했습니다: ${e.message}`);
        }
        ctx.rerender();
    };

    draw();
};
