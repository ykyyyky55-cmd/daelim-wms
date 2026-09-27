import * as XLSX from 'xlsx';
import { state } from '../services/db.js';
import { searchMasterItems, localDateStr, matchesQuery } from '../services/searchUtils.js';
import { fillAssigneeSelect, readAssignee, assignTasks } from '../services/assign.js';
import { listProdSchedule, listProdDates, copyProdDate, deleteProdDate, saveProdRows, deleteProdRow, newProdId, PROD_STATUS, MATERIAL_KEYS, MAX_MAT_ITEMS } from '../services/prodSchedule.js';
import { parseScheduleSheet, sheetToRows } from '../services/prodScheduleParse.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { siteOf } from '../services/locations.js';
import { ledgerStock, getBoms, loadBoms, saveBom, applyShortages, listPlans, weekStart } from '../services/plans.js';
import { canPerformAction } from '../services/auth.js';
import { attachItemPicker } from './plans/planCommon.js';

/**
 * 생산(포장) 스케줄표 — 캘린더 아래.
 * 예전 엑셀(날짜별 시트 복사)을 한 주문 = 한 줄 표로: 라인별 묶음·합계, 원부자재 상태, 납기 임박 강조,
 * 입력·수정(창), 상태 바로 바꾸기, 엑셀 가져오기(날짜 시트)·내보내기, A4 가로 인쇄.
 */
const FILTER_KEY = 'daelim_prod_sched_filter';
const fmt = (n) => (n === '' || n === null || n === undefined ? '' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }));
const boxesOf = (r) => (Number(r.qty) > 0 && Number(r.perBox) > 0 ? Number(r.qty) / Number(r.perBox) : '');
const md = (s) => (s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : '');
const dateOrText = (date, text) => (text && text !== date ? text : md(date));
// 원부자재 상태 글자 → 색: 준비됨(완·O·재고·사급·입고) / 해당없음(X) / 진행중(발주 …)
const matTone = (v) => {
    const s = String(v || '').trim();
    if (!s) return '';
    const last = s.split('→').pop().trim();
    if (/^x$/i.test(last)) return 'text-slate-300';
    if (/^(완|o|재고|사급|입고|\d+)$/i.test(last)) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    return 'text-amber-800 bg-amber-50 border-amber-200';
};

// ---------- 보기 탭 ----------
// OEM·ODM은 라인 글자로 구분한다 (예전 'OEM·ODM' 라인은 두 탭에 모두 보임 → 라인을 OEM / ODM으로 나눠 쓰기)
const VIEW_TABS = [['', '전체'], ['본사', '본사'], ['김포', '김포'], ['OEM', 'OEM'], ['ODM', 'ODM'], ['DONE', '완료·출고대기']];
const inView = (r, v) => {
    if (!v) return true;
    if (v === 'DONE') return r.status === 'DONE';
    if (v === 'OEM' || v === 'ODM') return String(r.line || '').toUpperCase().includes(v);
    return r.site === v;
};
const isMixedOemOdm = (r) => { const l = String(r.line || '').toUpperCase(); return l.includes('OEM') && l.includes('ODM'); };

// ---------- 소요 원액·원부자재 재고 (수불부 연동) ----------
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const schedSite = (r) => (r.site === '김포' ? '김포' : '본사');
const invSiteOf = (site) => (site === '김포' ? '김포공장' : '본사');
// 창고 재고 현황 (그 거점의 모든 창고 합계)
const invStock = (code, site) => r3(state.inventory.filter(i => i.code === code && siteOf(i.location) === invSiteOf(site)).reduce((s, i) => s + (Number(i.quantity) || 0), 0));
// 스케줄 줄들의 소요 품목에 재고를 배분한다: 출고완료·완료 줄은 이미 생산했으므로 빼고,
// 남은 줄은 포장계획(없으면 납품예정)이 빠른 순서로 수불부 재고를 차감 (미정·보류 줄은 맨 뒤).
// 결과: 줄 id → [{ ...품목, stock(수불부), inv(창고), avail(앞선 줄 사용 후 남은 재고), short(부족량), done }]
export const allocateMats = (list) => {
    const out = new Map();
    const remain = new Map();
    const whenOf = (r) => r.planDate || r.dueDate || '9999-99-99';
    const order = [...list].filter(r => (r.matItems || []).length)
        .sort((a, b) => (a.status === 'HOLD') - (b.status === 'HOLD') || whenOf(a).localeCompare(whenOf(b)) || (Number(a.sort) || 0) - (Number(b.sort) || 0));
    for (const r of order) {
        const site = schedSite(r);
        const done = r.status === 'DONE' || r.status === 'SHIPPED';
        out.set(r.id, (r.matItems || []).map(it => {
            const need = Number(it.qty) || 0;
            const stock = it.code ? ledgerStock(it.code, site).qty : 0;
            const inv = it.code ? invStock(it.code, site) : 0;
            if (done || !it.code) return { ...it, stock, inv, avail: stock, short: 0, done };
            const key = `${it.code}|${site}`;
            if (!remain.has(key)) remain.set(key, stock);
            const avail = r3(remain.get(key));
            remain.set(key, r3(avail - need));
            return { ...it, stock, inv, avail, short: need > Math.max(0, avail) ? r3(need - Math.max(0, avail)) : 0, done };
        }));
    }
    return out;
};
const matLine = (it) => `${it.code ? `${it.code} ` : ''}${it.name} ${fmt(it.qty)}${it.unit || ''}${it.done ? '' : it.short > 0 ? ` (부족 ${fmt(it.short)})` : it.code ? ' (재고 OK)' : ''}`;

// ---------- 원부자재 분류 칸 (원액·용기·라벨·인박스·아웃박스·안전캡·종이캡) ----------
// 소요 품목의 분류(slot)를 품목 분류·이름으로 자동 판정한다 (입력 창에서 드롭다운으로 바꿀 수 있음)
export const guessSlot = (it) => {
    const m = state.master.find(x => x.code === it.code) || {};
    const cat = it.category || m.category || '';
    const n = `${it.name || m.name || ''} ${m.subCategory || ''}`;
    if (cat === '원액' || cat === '원료') return 'raw';
    if (/안전\s*캡/.test(n)) return 'safetyCap';
    if (/종이\s*캡/.test(n)) return 'paperCap';
    if (/인\s*박스|inner\s*box/i.test(n)) return 'inbox';
    if (/아웃\s*박스|박스|카톤|box|carton/i.test(n)) return 'outbox';
    if (/라벨|스티커|label/i.test(n)) return 'label';
    if (/용기|페일|말통|드럼|캔|병|IBC|bottle|pail|drum|can/i.test(n)) return 'container';
    if (/캡|cap/i.test(n)) return 'safetyCap';
    return '';
};
const slotOf = (it) => (it.slot !== undefined && it.slot !== null && it.slot !== 'AUTO' ? it.slot : guessSlot(it));
// 소요 품목이 있는 줄은 7칸을 자동 판정: 그 칸 품목 없음 → X, 재고 있음 → 재고완, 모자람 → 부족
export const autoSlotStatus = (items) => {
    const out = {};
    MATERIAL_KEYS.forEach(([k]) => {
        const its = items.filter(it => slotOf(it) === k);
        const short = r3(its.reduce((s, it) => s + (it.done ? 0 : Number(it.short) || 0), 0));
        out[k] = !its.length ? { text: 'X', short: 0, items: [] } : { text: short > 0 ? '부족' : '재고완', short, items: its, unit: its[0].unit || '' };
    });
    return out;
};
const isAutoRow = (r) => (r.matItems || []).some(it => it.code || it.name);
const MAT_TEXT_OPTIONS = ['', 'X', '재고완', '부족', '발주', '사급', '입고'];

// 스케줄 줄·품목의 부족분을 생산관리 계획 줄로 (ref로 같은 줄을 찾아 수량만 갱신 → 여러 번 눌러도 쌓이지 않음)
const schedRef = (r, code) => `SCHED:${r.id}:${code}`;
const shortagesOf = (r, items, today) => {
    const when = r.planDate || r.dueDate || today;
    return items.filter(it => !it.done && it.code && it.short > 0).map(it => {
        const mm = state.master.find(x => x.code === it.code) || {};
        return {
            code: it.code, name: it.name || mm.name || it.code, spec: mm.spec && mm.spec !== '-' ? mm.spec : '', unit: it.unit || mm.unit || '', supplier: mm.supplier || '',
            category: it.category || mm.category || '', site: schedSite(r), firstDate: when >= today ? when : today, short: it.short, ref: schedRef(r, it.code),
            note: `생산스케줄 부족분 (${[r.partner, r.itemName].filter(Boolean).join(' · ')}${r.planDate ? ` 포장 ${md(r.planDate)}` : ''})`
        };
    });
};

export const renderProdSchedule = (el, { showToast = () => {}, onChanged = () => {} } = {}) => {
    let allocMap = new Map(); // 줄 id → 소요 품목 재고 배분 (draw 때 계산)
    let planRefs = new Map(); // 'SCHED:줄id:품목코드' → { kind: 'PURCH'|'PROD', qty, status } (이미 계획에 넣은 부족분)
    const canPlan = canPerformAction('MRP_PLANNING');
    loadBoms().catch(() => {});
    // 이미 계획에 넣은 스케줄 부족분 (지난 5주 이후의 주간 생산·구매계획에서 ref로 찾음)
    const loadPlanRefs = async () => {
        try {
            const from = weekStart(localDateStr(new Date(Date.now() - 35 * 86400000)));
            const [purch, prod] = await Promise.all([listPlans('PURCH_WEEK', from), listPlans('PROD_WEEK', from)]);
            const m = new Map();
            purch.forEach(d => (d.lines || []).forEach(l => { if (String(l.ref || '').startsWith('SCHED:')) m.set(l.ref, { kind: 'PURCH', qty: l.qty, status: l.status }); }));
            prod.forEach(d => (d.lines || []).forEach(l => { if (String(l.ref || '').startsWith('SCHED:')) m.set(l.ref, { kind: 'PROD', qty: l.qty, status: l.status }); }));
            planRefs = m;
        } catch { /* 생산관리 DB가 없으면 표시만 생략 */ }
    };
    // 부족분 반영: 원료·부자재 → 구매계획, 원액 → 원액 생산계획
    const applyToPlans = async (targetRows, label) => {
        if (!canPlan) { alert('계획 반영은 매니저 이상만 할 수 있습니다.'); return; }
        const all = targetRows.flatMap(r => shortagesOf(r, allocMap.get(r.id) || [], today));
        const buy = all.filter(x => x.category !== '원액');
        const raw = all.filter(x => x.category === '원액');
        if (!all.length) { alert('반영할 부족분이 없습니다.'); return; }
        const line = (x) => `· ${x.name} (${x.site}) ${fmt(x.short)} ${x.unit}${planRefs.has(x.ref) ? ' — 이미 반영됨, 수량 갱신' : ''}`;
        if (!confirm(`${label}\n\n${buy.length ? `🛒 구매계획 (원료·부자재) ${buy.length}건\n${buy.slice(0, 12).map(line).join('\n')}${buy.length > 12 ? '\n…' : ''}\n\n` : ''}${raw.length ? `🧪 원액 생산계획 ${raw.length}건\n${raw.slice(0, 8).map(line).join('\n')}\n\n` : ''}포장계획일(없으면 납품예정일)이 속한 주의 계획에 들어갑니다. 이미 넣은 품목은 수량만 지금 부족량으로 바꿉니다.`)) return;
        try {
            const res = [];
            if (buy.length) { const x = await applyShortages('PURCH_WEEK', buy); res.push(`구매계획 ${x.count}건`); }
            if (raw.length) { const x = await applyShortages('PROD_WEEK', raw); res.push(`원액 생산계획 ${x.count}건`); }
            await loadPlanRefs();
            draw();
            showToast(`✅ 부족분을 ${res.join(' · ')}에 반영했습니다. (생산관리 메뉴에서 확인)`);
        } catch (e) { alert(e.message); }
    };
    let rows = [];            // 보고 있는 작성일자의 줄
    let dates = [];           // [{ date, count }] 최신순
    let cur = '';             // 보고 있는 작성일자
    let monthF = '';          // 날짜 칩 월 필터 ('ALL' 또는 'MM')
    let latestRows = null;    // 최신 작성일자의 줄 (캘린더 표시용)
    let loading = true;
    let error = '';
    let notice = '';          // 긴 작업 진행 표시
    const saved = (() => { try { return JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'); } catch { return {}; } })();
    // 보기 탭: '' 전체 · 본사 · 김포 · OEM · ODM (라인에 글자가 있으면) · DONE 완료·출고대기
    const f = { site: VIEW_TABS.some(([v]) => v === saved.site) ? saved.site : '', status: saved.status || 'ACTIVE', q: '' };
    const persist = () => { try { localStorage.setItem(FILTER_KEY, JSON.stringify({ site: f.site, status: f.status })); } catch { /* 저장 불가 */ } };
    const statusOk = (r) => f.status === 'ALL' || (f.status === 'ACTIVE' ? r.status !== 'SHIPPED' && r.status !== 'DONE' : r.status === f.status);
    const today = localDateStr();
    const soon = localDateStr(new Date(Date.now() + 7 * 86400000));
    const latestDate = () => dates[0]?.date || '';

    // 캘린더에는 최신 작성일자의 스케줄을 보낸다
    const notifyLatest = async () => {
        const latest = latestDate();
        if (!latest) { latestRows = []; onChanged([]); return; }
        if (latest === cur) { latestRows = rows; onChanged(rows); return; }
        try { latestRows = await listProdSchedule(latest); onChanged(latestRows); } catch { /* 캘린더 표시는 건너뜀 */ }
    };

    const loadDates = async () => {
        try { dates = await listProdDates(); } catch (e) { error = e.message; dates = []; }
    };

    const openDate = async (date, { notify = false } = {}) => {
        cur = date;
        if (monthF !== 'ALL') monthF = cur.slice(5, 7);
        loading = true; error = ''; draw();
        try { rows = await listProdSchedule(cur); } catch (e) { error = e.message; rows = []; }
        await loadPlanRefs();
        loading = false; draw();
        if (notify || cur === latestDate()) notifyLatest();
    };

    const load = async () => {
        loading = true; error = ''; draw();
        await loadDates();
        await openDate(cur && dates.some(x => x.date === cur) ? cur : (latestDate() || today), { notify: true });
    };

    // 줄 수가 바뀐 뒤 날짜 목록만 다시 받는다
    const refreshDates = async () => { await loadDates(); draw(); notifyLatest(); };

    const filtered = () => rows.filter(r =>
        inView(r, f.site)
        // '완료·출고대기' 탭은 그 상태만. 다른 탭의 '진행 중'은 완료·출고대기와 출고완료를 뺀다 (완료는 따로 탭)
        && (f.site === 'DONE' || statusOk(r))
        && (!f.q || matchesQuery(r, f.q, ['partner', 'manager', 'itemName', 'lotNo', 'notes', 'line', 'container'])));

    // 묶음: 진행 중인 줄은 라인별, 완료·출고대기 / 출고완료는 따로
    const groupsOf = (list) => {
        const order = [];
        const map = new Map();
        const keyOf = (r) => (r.status === 'SHIPPED' ? '출고완료' : r.status === 'DONE' ? '완료 · 출고대기'
            : r.site === '김포' ? `김포${r.line ? ` · ${r.line}` : ''}` : (r.line || '라인 미지정'));
        list.forEach(r => { const k = keyOf(r); if (!map.has(k)) { map.set(k, []); order.push(k); } map.get(k).push(r); });
        const rank = (k) => (k === '출고완료' ? 3 : k === '완료 · 출고대기' ? 2 : k.startsWith('김포') ? 1 : 0);
        return order.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ko')).map(k => ({ key: k, rows: map.get(k) }));
    };

    const dueCls = (r) => {
        if (!r.dueDate || r.status === 'SHIPPED') return '';
        if (r.dueDate < today) return 'text-rose-700 font-black';
        if (r.dueDate <= soon) return 'text-amber-700 font-black';
        return '';
    };

    // 원부자재 칸: 소요 품목이 있는 줄은 부족한 칸만 '부족', 모두 있으면 '원부자재 완비'만.
    // 소요 품목명·수량은 [소요 n품목 ▾]를 눌러야 펼쳐진다. 소요 품목이 없는 예전 줄은 상태 글자를 그대로 보여준다.
    const expanded = new Set();
    // 원액 칸 (원부자재 칸 앞): 원액 품목·수량과 재고완/부족. 소요 품목이 없는 예전 줄은 '원액' 상태 글자.
    const rawCellHtml = (r) => {
        if (!isAutoRow(r)) {
            const v = r.materials?.raw;
            return v ? `<span class="px-1 py-0.5 rounded border text-[10px] font-bold ${matTone(v)}" title="원액: ${esc(v)}">${esc(v.split('→').pop().trim().slice(0, 10))}</span>` : '<span class="text-slate-300">-</span>';
        }
        const raws = (allocMap.get(r.id) || []).filter(it => slotOf(it) === 'raw');
        if (!raws.length) return '<span class="text-slate-300" title="원액 소요 없음">X</span>';
        return `<div class="min-w-[120px] space-y-0.5">${raws.map(it => `<div class="text-[10px] leading-tight" title="수불부 재고 ${fmt(it.stock)} · 앞선 줄 사용 후 ${fmt(Math.max(0, it.avail))}">
            <div class="font-bold text-slate-800 truncate max-w-[160px]">${esc(it.name)}</div>
            <div><b>${fmt(it.qty)}${esc(it.unit || 'L')}</b> ${it.done ? '' : it.short > 0 ? `<span class="px-1 rounded bg-rose-100 text-rose-700 font-black">부족 ${fmt(it.short)}</span>` : it.code ? '<span class="px-1 rounded bg-emerald-50 text-emerald-700 font-bold">재고완</span>' : ''}
            ${planRefs.has(schedRef(r, it.code)) ? '<span class="px-1 rounded bg-violet-100 text-violet-700 font-bold">🧪 원액계획</span>' : ''}</div></div>`).join('')}</div>`;
    };
    // 원부자재 칸: 원액을 뺀 나머지 (원액은 앞 칸)
    const matCellHtml = (r) => {
        if (!isAutoRow(r)) {
            return `<div class="flex flex-wrap gap-0.5 min-w-[150px]">${MATERIAL_KEYS.filter(([k]) => k !== 'raw' && r.materials?.[k]).map(([k, label]) => `<span class="px-1 py-0.5 rounded border text-[10px] font-bold ${matTone(r.materials[k])}" title="${esc(label)}: ${esc(r.materials[k])}">${esc(label)} ${esc(r.materials[k].split('→').pop().trim().slice(0, 8))}</span>`).join('')}${r.matsDone ? '<span class="px-1 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-black">원부자재 완비</span>' : ''}</div>`;
        }
        const allItems = allocMap.get(r.id) || [];
        const items = allItems.filter(it => slotOf(it) !== 'raw');
        const st = autoSlotStatus(items);
        const shortKeys = MATERIAL_KEYS.filter(([k]) => k !== 'raw' && st[k].short > 0);
        const otherShort = items.filter(it => !slotOf(it) && !it.done && it.short > 0);
        const anyShort = shortKeys.length || otherShort.length;
        const open = expanded.has(r.id);
        const planBtn = canPlan && allItems.some(it => it.short > 0 && !it.done && it.code);
        if (!items.length) return planBtn ? '<button type="button" class="ps-row-plan px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px] font-black hover:bg-emerald-100">🛒 부족분 계획 반영</button>' : '<span class="text-slate-300">-</span>';
        return `<div class="min-w-[170px] space-y-1">
            <div class="flex flex-wrap gap-0.5">
                ${anyShort ? [
                    ...shortKeys.map(([k, label]) => `<span class="px-1 py-0.5 rounded border text-[10px] font-black bg-rose-50 text-rose-700 border-rose-200" title="${esc(st[k].items.map(matLine).join(' / '))}">${esc(label)} 부족 ${fmt(st[k].short)}${esc(st[k].unit || '')}</span>`),
                    ...otherShort.map(it => `<span class="px-1 py-0.5 rounded border text-[10px] font-black bg-rose-50 text-rose-700 border-rose-200">${esc(it.name)} 부족 ${fmt(it.short)}${esc(it.unit || '')}</span>`)
                ].join('') : '<span class="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-black">원부자재 완비</span>'}
            </div>
            <div class="flex flex-wrap items-center gap-1">
                <button type="button" class="ps-mat-toggle text-[10px] font-bold text-slate-500 hover:text-slate-800 underline decoration-dotted">소요 ${items.length}품목 ${open ? '▴' : '▾'}</button>
                ${planBtn ? '<button type="button" class="ps-row-plan px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px] font-black hover:bg-emerald-100">🛒 부족분 계획 반영</button>' : ''}
            </div>
            ${open ? `<div class="p-1.5 rounded-lg bg-slate-50 border border-slate-200 space-y-0.5">${items.map(it => `<div class="text-[10px] leading-tight ${!it.done && it.short > 0 ? 'text-rose-700 font-black' : 'text-slate-600'}" title="수불부 재고 ${fmt(it.stock)} · 창고 재고 ${fmt(it.inv)} · 앞선 줄 사용 후 ${fmt(Math.max(0, it.avail))}">
                <span class="px-1 rounded bg-white border border-slate-200 text-slate-500 font-bold">${esc(MATERIAL_KEYS.find(([k]) => k === slotOf(it))?.[1] || '기타')}</span>
                <span class="font-mono">${esc(it.code)}</span> ${esc(it.name)} <b>${fmt(it.qty)}${esc(it.unit || '')}</b>${it.done ? '' : it.short > 0 ? ` 부족 ${fmt(it.short)}` : it.code ? ' ✅' : ''}${planRefs.has(schedRef(r, it.code)) ? ` <span class="px-1 rounded bg-emerald-100 text-emerald-700 font-bold" title="생산관리 계획에 반영됨 (${fmt(planRefs.get(schedRef(r, it.code)).qty)})">${planRefs.get(schedRef(r, it.code)).kind === 'PROD' ? '🧪 원액계획' : '🛒 구매계획'}</span>` : ''}</div>`).join('')}</div>` : ''}
        </div>`;
    };
    // 엑셀·인쇄용 7칸 글자 (소요 품목이 있으면 자동 판정)
    const slotTexts = (r) => {
        if (!isAutoRow(r)) return MATERIAL_KEYS.map(([k]) => r.materials?.[k] || '');
        const st = autoSlotStatus(allocMap.get(r.id) || []);
        return MATERIAL_KEYS.map(([k]) => (st[k].short > 0 ? `부족 ${fmt(st[k].short)}` : st[k].text));
    };
    const matsDoneOf = (r) => (isAutoRow(r) ? !(allocMap.get(r.id) || []).some(it => !it.done && it.short > 0) : !!r.matsDone);

    const rowHtml = (r) => `
        <tr class="align-top hover:bg-slate-50 ${r.status === 'SHIPPED' ? 'opacity-60' : ''}" data-id="${esc(r.id)}">
            <td class="p-1.5"><select class="ps-status border rounded px-1 py-0.5 text-[11px] font-bold ${PROD_STATUS[r.status]?.cls || ''}">${Object.entries(PROD_STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v.label}</option>`).join('')}</select></td>
            <td class="p-1.5 font-mono whitespace-nowrap">${esc(md(r.orderDate))}</td>
            <td class="p-1.5 whitespace-nowrap ${dueCls(r)}" title="${esc(r.dueText || r.dueDate)}">${esc(dateOrText(r.dueDate, r.dueText))}</td>
            <td class="p-1.5 whitespace-nowrap" title="${esc(r.planText || r.planDate)}">${esc(dateOrText(r.planDate, r.planText))}</td>
            <td class="p-1.5 min-w-[96px]"><div class="font-bold text-slate-800">${esc(r.partner)}</div><div class="text-[10px] text-slate-400">${esc(r.manager)}</div></td>
            <td class="p-1.5 min-w-[200px]">${r.itemCode ? `<div class="text-[10px] font-mono font-bold text-blue-600">${esc(r.itemCode)}</div>` : '<div class="text-[10px] text-slate-300">코드 없음</div>'}<div class="font-bold text-slate-900">${esc(r.itemName)}</div>
                ${(allocMap.get(r.id) || []).some(it => it.short > 0) ? '<span class="inline-block mt-0.5 px-1 rounded bg-rose-100 text-rose-700 text-[10px] font-black">⚠️ 원부자재 부족</span>' : ''}</td>
            <td class="p-1.5 text-right font-mono font-black">${fmt(r.qty)}</td>
            <td class="p-1.5 text-right font-mono whitespace-nowrap">${fmt(boxesOf(r))}${r.perBox ? `<div class="text-[10px] text-slate-400">×${fmt(r.perBox)}</div>` : ''}</td>
            <td class="p-1.5 text-[11px] text-slate-600 min-w-[90px]">${esc(r.container)}</td>
            <td class="p-1.5">${rawCellHtml(r)}</td>
            <td class="p-1.5">${matCellHtml(r)}</td>
            <td class="p-1.5 font-mono whitespace-nowrap text-[11px]">${r.prodStart || r.prodEnd ? `${esc(md(r.prodStart))}~${esc(md(r.prodEnd))}` : ''}</td>
            <td class="p-1.5 font-mono text-[11px]">${esc(r.lotNo)}</td>
            <td class="p-1.5 font-mono whitespace-nowrap">${esc(md(r.shipDate))}</td>
            <td class="p-1.5 text-[11px] text-slate-600 min-w-[160px] max-w-[260px]"><div class="line-clamp-3" title="${esc(r.notes)}">${esc(r.notes)}</div></td>
            <td class="p-1.5 whitespace-nowrap text-center">
                <button type="button" class="ps-edit px-1.5 py-0.5 bg-white border border-slate-300 rounded font-bold">수정</button>
                <button type="button" class="ps-del px-1.5 py-0.5 text-rose-500 font-black">✕</button>
            </td>
        </tr>`;

    const draw = () => {
        allocMap = allocateMats(rows); // 필터와 무관하게 이 작성일자 전체로 재고 배분
        const hasShort = (r) => (allocMap.get(r.id) || []).some(it => it.short > 0 && !it.done);
        const shortRows = rows.filter(hasShort).length;
        const list = filtered();
        const listShort = list.filter(hasShort).length;
        const groups = groupsOf(list);
        const sum = (arr) => ({ qty: arr.reduce((s, r) => s + (Number(r.qty) || 0), 0), box: arr.reduce((s, r) => s + (Number(boxesOf(r)) || 0), 0) });
        const total = sum(list);
        // KPI: 이 작성일자 전체(필터와 무관)
        const all = sum(rows);
        const active = rows.filter(r => r.status !== 'SHIPPED');
        const overdue = active.filter(r => r.dueDate && r.dueDate < today).length;
        const dueSoon = active.filter(r => r.dueDate && r.dueDate >= today && r.dueDate <= soon).length;
        const cnt = (st) => rows.filter(r => r.status === st).length;
        // 날짜 칩: 월 필터
        const months = [...new Set(dates.map(x => x.date.slice(0, 7)))].sort((a, b) => b.localeCompare(a));
        const monthKey = monthF || cur.slice(5, 7);
        const chips = monthKey === 'ALL' ? dates : dates.filter(x => x.date.slice(5, 7) === monthKey && x.date.slice(0, 4) === (cur.slice(0, 4) || x.date.slice(0, 4)));
        const has = dates.some(x => x.date === cur);
        const prev = dates.find(x => x.date < cur) || dates.find(x => x.date !== cur);
        const kpi = (title, icon, color, value, unit, sub) => `
            <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition">
                <div class="flex items-center justify-between text-slate-500 text-xs font-bold"><span>${title}</span><i data-lucide="${icon}" class="w-4 h-4 ${color}"></i></div>
                <div class="flex items-baseline gap-1 mt-2"><span class="text-2xl font-black text-slate-900 font-mono">${value}</span><span class="text-xs text-slate-500 font-bold">${unit}</span></div>
                <div class="text-[11px] font-bold mt-1 ${color}">${sub}</div>
            </div>`;
        el.innerHTML = `
        <section class="space-y-4 text-xs">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-800 border border-indigo-200">대림오일 본사 · 김포</span>
                        <span class="text-xs text-slate-500 font-mono">포장 SCHEDULE</span>
                        ${cur ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black ${cur === latestDate() ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'}">${cur === latestDate() ? '✅ 최신 스케줄' : has ? '📁 지난 작성일자' : '🆕 새 작성일자'}</span>` : ''}
                    </div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2"><i data-lucide="factory" class="w-5 h-5 text-indigo-600"></i><span>생산(포장) 스케줄 — 작성일자별</span></h2>
                    <p class="text-xs text-slate-500">예전 엑셀의 날짜별 시트처럼 작성일자마다 한 장씩 관리합니다. 캘린더에는 최신 작성일자의 스케줄이 표시됩니다.</p>
                </div>
                <div class="flex items-center flex-wrap gap-2">
                    <button type="button" id="ps-print" class="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-sm"><i data-lucide="printer" class="w-4 h-4"></i><span>A4 스케줄 인쇄</span></button>
                    <button type="button" id="ps-export" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-sm"><i data-lucide="file-spreadsheet" class="w-4 h-4"></i><span>엑셀 다운로드</span></button>
                    <label class="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer"><i data-lucide="file-up" class="w-4 h-4"></i><span>엑셀 가져오기</span><input type="file" id="ps-import" accept=".xlsx,.xls,.xlsm" class="hidden" /></label>
                    <button type="button" id="ps-add" class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-sm"><i data-lucide="plus" class="w-4 h-4"></i><span>줄 추가</span></button>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 pt-1">
                <div class="flex items-center gap-2">
                    <label class="font-bold text-slate-700" for="ps-date">작성 일자:</label>
                    <input type="date" id="ps-date" value="${esc(cur)}" class="border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold bg-white focus:ring-2 focus:ring-blue-500" />
                    <button type="button" id="ps-new-date" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold flex items-center gap-1 border border-slate-200" title="최근 작성일자의 스케줄을 복사해 새 작성일자를 만듭니다"><i data-lucide="copy-plus" class="w-3.5 h-3.5"></i><span>새 작성일자</span></button>
                    ${has ? '<button type="button" id="ps-del-date" class="px-2 py-1.5 text-rose-600 hover:bg-rose-50 rounded-xl font-bold flex items-center gap-1" title="이 작성일자의 스케줄 전체 삭제"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i><span>작성일자 삭제</span></button>' : ''}
                </div>
                <div class="flex flex-wrap items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-[11px] font-bold">
                    ${months.map(m => { const mm = m.slice(5, 7); const on = monthKey === mm && cur.slice(0, 4) === m.slice(0, 4); return `<button type="button" class="ps-month px-2.5 py-1 rounded-lg transition whitespace-nowrap ${on ? 'bg-white text-blue-600 shadow-sm font-black' : 'text-slate-600 hover:text-slate-900'}" data-month="${m}">${Number(mm)}월 (${dates.filter(x => x.date.startsWith(m)).length}일)</button>`; }).join('')}
                    <button type="button" class="ps-month px-2.5 py-1 rounded-lg transition whitespace-nowrap ${monthKey === 'ALL' ? 'bg-white text-blue-600 shadow-sm font-black' : 'text-slate-600 hover:text-slate-900'}" data-month="ALL">전체 (${dates.length}일)</button>
                </div>
                <div class="flex-1 min-w-[200px] flex items-center gap-1.5 overflow-x-auto py-1">
                    ${chips.map(x => `<button type="button" class="ps-chip px-2.5 py-1 rounded-lg text-[11px] font-bold transition whitespace-nowrap flex items-center gap-1.5 ${x.date === cur ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'}" data-date="${esc(x.date)}" title="${esc(x.date)} · ${x.count}줄"><span>${esc(x.date.slice(5).replace('-', '/'))}</span><span class="text-[9px] ${x.date === cur ? 'text-blue-100' : 'text-slate-400'}">${x.count}</span></button>`).join('')
                        || `<span class="text-slate-400 font-bold">${dates.length ? '이 달에는 작성일자가 없습니다. 월 버튼이나 날짜 칩으로 다른 작성일자를 여세요.' : '작성일자가 없습니다. [엑셀 가져오기]로 예전 날짜 시트를 올리거나 [줄 추가]로 시작하세요.'}</span>`}
                </div>
            </div>
        </div>
        ${!loading && !has && !rows.length ? `
        <div class="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex flex-wrap items-center gap-3">
            <i data-lucide="calendar-plus" class="w-6 h-6 text-amber-600"></i>
            <div class="flex-1 min-w-[220px]"><div class="font-black text-amber-900 text-sm">${esc(cur)} 작성일자에 스케줄이 없습니다.</div>
                <div class="text-amber-800 mt-0.5">엑셀에서 시트를 복사하던 것처럼, 이전 스케줄을 복사해 이어 쓰거나 빈 스케줄에 줄을 추가하세요.</div></div>
            ${prev ? `<button type="button" id="ps-copy-prev" class="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black flex items-center gap-1.5"><i data-lucide="copy" class="w-4 h-4"></i>${esc(prev.date.slice(5).replace('-', '/'))} 스케줄 복사해서 시작 (${prev.count}줄)</button>` : ''}
        </div>` : ''}
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
            ${kpi('■ 스케줄 줄 수', 'list-checks', 'text-indigo-600', fmt(rows.length), '줄', `본사 ${rows.filter(r => r.site !== '김포').length} · 김포 ${rows.filter(r => r.site === '김포').length}`)}
            ${kpi('■ 총 생산 수량', 'package-check', 'text-blue-600', fmt(all.qty), 'EA', `박스 ${fmt(Math.round(all.box))} BOX`)}
            ${kpi('■ 납기 관리', 'alarm-clock', overdue ? 'text-rose-600' : 'text-amber-600', fmt(overdue), '건 지남', `7일 안 납기 ${dueSoon}건 (출고완료 제외)`)}
            ${kpi('■ 진행 현황', 'loader', 'text-emerald-600', fmt(cnt('PRODUCING')), '생산중', `부자재 준비 ${cnt('PREP')} · 예정 ${cnt('PLANNED')} · 출고대기 ${cnt('DONE')}`)}
        </div>
        <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm space-y-2.5">
            <div class="flex items-center gap-2 font-black text-sm text-slate-900"><i data-lucide="table" class="w-4 h-4 text-indigo-600"></i>${esc(cur)} 스케줄표
                <span class="text-slate-500 font-bold text-xs">${loading ? '불러오는 중…' : `${list.length}줄 · 수량 ${fmt(total.qty)} ea · 박스 ${fmt(total.box)}`}</span>
                ${shortRows ? `<span class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[11px] font-black">⚠️ 원부자재 부족 ${shortRows}줄 (수불부 재고 기준)</span>` : ''}
                ${listShort ? `<button type="button" id="ps-apply-plan" ${canPlan ? '' : 'disabled title="계획 반영은 매니저 이상"'} class="ml-auto px-2.5 py-1 rounded-lg text-[11px] font-black flex items-center gap-1 ${canPlan ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm' : 'bg-slate-100 text-slate-400'}"><i data-lucide="shopping-cart" class="w-3.5 h-3.5"></i>보이는 줄 부족분 → 구매계획 반영 (${listShort}줄)</button>` : ''}</div>
            <div class="flex flex-wrap items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                <div class="flex flex-wrap bg-white border border-slate-200 p-0.5 rounded-lg font-bold">${VIEW_TABS.map(([v, t]) => {
                    const n = rows.filter(r => inView(r, v) && (v === 'DONE' || statusOk(r))).length;
                    const on = f.site === v;
                    return `<button type="button" class="ps-site px-2.5 py-1 rounded-md whitespace-nowrap ${v === 'DONE' ? 'ml-1 border-l border-slate-200' : ''} ${on ? (v === 'DONE' ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white') : 'text-slate-500 hover:text-slate-800'}" data-v="${v}">${t} <span class="text-[10px] ${on ? 'text-white/80' : 'text-slate-400'}">${n}</span></button>`;
                }).join('')}</div>
                <select id="ps-status-f" ${f.site === 'DONE' ? 'disabled title="완료·출고대기 탭은 그 상태만 봅니다"' : ''} class="border border-slate-300 rounded-lg px-2 py-1 font-bold disabled:opacity-50">
                    <option value="ACTIVE" ${f.status === 'ACTIVE' ? 'selected' : ''}>진행 중 (완료·출고 제외)</option>
                    <option value="ALL" ${f.status === 'ALL' ? 'selected' : ''}>전체</option>
                    ${Object.entries(PROD_STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
                </select>
                <div class="relative flex-1 min-w-[200px]"><i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"></i>
                    <input type="search" id="ps-q" value="${esc(f.q)}" placeholder="거래처·담당·품명·LOT·비고 일부" class="w-full border border-slate-300 rounded-lg pl-8 pr-2 py-1 font-bold" /></div>
                <span class="text-[11px] text-slate-500"><span class="text-rose-700 font-black">빨강</span> 납기 지남 · <span class="text-amber-700 font-black">주황</span> 7일 안</span>
            </div>
            ${(f.site === 'OEM' || f.site === 'ODM') && list.some(isMixedOemOdm) ? `<div class="p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 font-bold">라인이 예전 값 <b>'OEM·ODM'</b>인 줄 ${list.filter(isMixedOemOdm).length}개는 OEM·ODM 탭 모두에 보입니다. [수정]에서 라인을 <b>OEM</b> 또는 <b>ODM</b>으로 바꾸면 한 탭에만 보입니다.</div>` : ''}
            ${error ? `<div class="p-2 text-rose-600 font-bold">${esc(error)}</div>` : ''}
            ${notice ? `<div class="p-2 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-800 font-black">${esc(notice)}</div>` : ''}
            <div class="overflow-auto border border-slate-200 rounded-xl max-h-[75vh]">
                <table class="w-full">
                    <thead class="bg-slate-100 text-slate-600 font-bold sticky top-0 z-10"><tr>
                        <th class="p-1.5 text-left">상태</th><th class="p-1.5 text-left">수주</th><th class="p-1.5 text-left">납품예정</th><th class="p-1.5 text-left">포장계획</th>
                        <th class="p-1.5 text-left">거래처/담당</th><th class="p-1.5 text-left">품명</th><th class="p-1.5 text-right">수량(ea)</th><th class="p-1.5 text-right">박스</th>
                        <th class="p-1.5 text-left">용기</th><th class="p-1.5 text-left">원액</th><th class="p-1.5 text-left">원부자재</th><th class="p-1.5 text-left">생산</th><th class="p-1.5 text-left">LOT</th><th class="p-1.5 text-left">출고</th><th class="p-1.5 text-left">비고</th><th class="p-1.5"></th>
                    </tr></thead>
                    <tbody class="divide-y divide-slate-100">
                        ${groups.map(g => { const s = sum(g.rows); return `<tr class="bg-indigo-50/70"><td colspan="16" class="px-2 py-1.5 font-black text-indigo-900">${esc(g.key)} <span class="font-bold text-indigo-600">(${g.rows.length}줄 · ${fmt(s.qty)} ea · ${fmt(s.box)} 박스)</span></td></tr>${g.rows.map(rowHtml).join('')}`; }).join('')
                            || `<tr><td colspan="16" class="p-8 text-center text-slate-400 font-bold">${loading ? '불러오는 중…' : '조건에 맞는 줄이 없습니다.'}</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>
        </section>
        <div id="ps-modal" class="hidden fixed inset-0 z-50 bg-slate-900/60 p-3 overflow-y-auto items-start justify-center"></div>`;
        createIcons({ icons });
        bind(list);
    };

    const bind = (list) => {
        const $ = (s) => el.querySelector(s);
        el.querySelectorAll('.ps-site').forEach(b => b.addEventListener('click', () => { f.site = b.dataset.v; persist(); draw(); }));
        $('#ps-status-f').addEventListener('change', (e) => { f.status = e.target.value; persist(); draw(); });
        let qt = null;
        $('#ps-q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { f.q = e.target.value; draw(); const q = $('#ps-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); });
        $('#ps-add').addEventListener('click', () => openEditor(null));
        $('#ps-date').addEventListener('change', (e) => { if (e.target.value) openDate(e.target.value); });
        el.querySelectorAll('.ps-chip').forEach(b => b.addEventListener('click', () => openDate(b.dataset.date)));
        el.querySelectorAll('.ps-month').forEach(b => b.addEventListener('click', () => {
            const m = b.dataset.month;
            if (m === 'ALL') { monthF = 'ALL'; draw(); return; }
            monthF = m.slice(5, 7);
            // 그 달의 가장 최근 작성일자를 연다
            const d = dates.find(x => x.date.startsWith(m));
            if (d && !cur.startsWith(m)) openDate(d.date); else draw();
        }));
        $('#ps-new-date').addEventListener('click', newDate);
        $('#ps-del-date')?.addEventListener('click', delDate);
        $('#ps-copy-prev')?.addEventListener('click', () => {
            const prev = dates.find(x => x.date < cur) || dates.find(x => x.date !== cur);
            if (prev) copyInto(prev.date, cur);
        });
        $('#ps-apply-plan')?.addEventListener('click', () => applyToPlans(list, `지금 보이는 스케줄 줄의 원부자재 부족분을 계획에 반영할까요?`));
        $('#ps-export').addEventListener('click', () => exportXlsx(list));
        $('#ps-print').addEventListener('click', () => printList(list));
        $('#ps-import').addEventListener('change', (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) importXlsx(file); });
        el.querySelectorAll('tr[data-id]').forEach(tr => {
            const r = rows.find(x => x.id === tr.dataset.id);
            tr.querySelector('.ps-status').addEventListener('change', async (e) => {
                const next = { ...r, status: e.target.value };
                if (next.status === 'PRODUCING' && !next.prodStart) next.prodStart = today;
                if (next.status === 'DONE' && !next.prodEnd) next.prodEnd = today;
                if (next.status === 'SHIPPED' && !next.shipDate) next.shipDate = today;
                try { await saveProdRows([next]); Object.assign(r, next); showToast(`🏭 '${r.itemName}' → ${PROD_STATUS[next.status].label}`); draw(); if (cur === latestDate()) notifyLatest(); } catch (err) { alert(err.message); draw(); }
            });
            tr.querySelector('.ps-edit').addEventListener('click', () => openEditor(r));
            tr.querySelector('.ps-row-plan')?.addEventListener('click', () => applyToPlans([r], `'${[r.partner, r.itemName].filter(Boolean).join(' · ')}' 줄의 부족분을 계획에 반영할까요?`));
            tr.querySelector('.ps-mat-toggle')?.addEventListener('click', () => { if (expanded.has(r.id)) expanded.delete(r.id); else expanded.add(r.id); draw(); });
            tr.querySelector('.ps-del').addEventListener('click', async () => {
                if (!confirm(`'${r.partner} · ${r.itemName}' 줄을 삭제할까요?`)) return;
                try { await deleteProdRow(r.id); rows = rows.filter(x => x !== r); refreshDates(); } catch (err) { alert(err.message); }
            });
        });
    };

    // ---------- 작성일자 ----------
    const copyInto = async (from, to) => {
        try {
            const copied = await copyProdDate(from, to);
            showToast(`🏭 ${from} 스케줄 ${copied.length}줄을 ${to} 작성일자로 복사했습니다.`);
            await loadDates();
            await openDate(to, { notify: true });
        } catch (e) { alert(e.message); }
    };

    // 새 작성일자: 날짜를 받아 그 전의 가장 최근 스케줄을 복사한다 (엑셀에서 시트를 복사하던 것)
    const newDate = async () => {
        const def = !dates.some(x => x.date === today) ? today : (() => {
            const d = new Date(`${latestDate()}T00:00:00`);
            do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
            return localDateStr(d);
        })();
        const to = (prompt('새 작성일자를 입력하세요 (YYYY-MM-DD).\n그 전의 가장 최근 스케줄을 복사해 시작합니다.', def) || '').trim();
        if (!to) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || Number.isNaN(new Date(to).getTime())) { alert('날짜 형식이 올바르지 않습니다. 예: 2026-09-29'); return; }
        if (dates.some(x => x.date === to)) { alert(`${to} 작성일자가 이미 있습니다. 그 날짜를 엽니다.`); openDate(to); return; }
        const from = dates.find(x => x.date < to) || dates[0];
        if (!from) { await openDate(to); return; }
        if (!confirm(`${from.date} 스케줄 ${from.count}줄을 복사해 ${to} 작성일자를 만들까요?`)) return;
        copyInto(from.date, to);
    };

    const delDate = async () => {
        if (!confirm(`${cur} 작성일자의 스케줄 ${rows.length}줄을 모두 삭제할까요? 되돌릴 수 없습니다.`)) return;
        try {
            await deleteProdDate(cur);
            showToast(`🗑️ ${cur} 작성일자를 삭제했습니다.`);
            await loadDates();
            await openDate(dates.find(x => x.date < cur)?.date || latestDate() || today, { notify: true });
        } catch (e) { alert(e.message); }
    };

    // ---------- 입력·수정 창 ----------
    // 담당자(수신자) → 할일: 생산 예정(포장계획일) · 출하 예정(납품예정일, 출하 시간이 있으면 30분 전 알림) + 메시지
    // 작성일자마다 줄이 복사되므로 할일 키는 줄 id가 아니라 수주일·거래처·품목으로 만든다 (같은 주문 = 같은 할일)
    const notifyRowAssignee = async (row, orig) => {
        const prev = orig?.assigneeId || '';
        if (!row.assigneeId && !prev) return;
        const key = `PS:${row.orderDate || ''}|${row.partner || ''}|${row.itemCode || row.itemName}`;
        const name = `${row.partner ? `${row.partner} · ` : ''}${row.itemName} ${fmt(row.qty)}ea`;
        const done = ['DONE', 'SHIPPED'].includes(row.status);
        const changed = !orig || prev !== row.assigneeId || orig.planDate !== row.planDate || orig.dueDate !== row.dueDate || (orig.shipTime || '') !== (row.shipTime || '');
        const res = await assignTasks({
            ref: key, assignee: row.assigneeId ? { id: row.assigneeId, name: row.assigneeName } : null, prev, parts: ['PROD', 'SHIP'],
            tasks: [
                !done && row.planDate ? { part: 'PROD', label: '생산 예정', text: `[생산 예정] ${name}`, dueDate: row.planDate } : null,
                row.status !== 'SHIPPED' && row.dueDate ? { part: 'SHIP', label: '출하 예정', text: `[출하 예정] ${name}`, dueDate: row.dueDate, dueTime: row.shipTime, remindBefore: 30 } : null
            ].filter(Boolean),
            title: `[생산 스케줄] ${name}`,
            lines: [row.line ? `라인: ${row.line}` : '', row.notes || ''],
            link: { tab: 'prodSchedule' },
            notify: changed
        });
        if (res.message) showToast(res.ok ? `🔔 ${res.message}` : `⚠️ ${res.message}`);
    };

    const openEditor = (orig) => {
        const r = orig ? { ...orig, materials: { ...(orig.materials || {}) }, matItems: (orig.matItems || []).map(x => ({ ...x })) } : {
            id: newProdId(), sheetDate: cur || today, site: f.site === '김포' ? '김포' : '본사', line: f.site === 'OEM' || f.site === 'ODM' ? f.site : '포장1부', status: 'PLANNED', orderDate: today, dueText: '', dueDate: '', planText: '', planDate: '',
            partner: '', manager: '', itemCode: '', itemName: '', spec: '', qty: '', perBox: '', container: '', materials: {}, matsDone: false, matItems: [],
            prodStart: '', prodEnd: '', lotNo: '', shipDate: '', notes: '', sort: (Math.max(0, ...rows.map(x => Number(x.sort) || 0)) + 1)
        };
        const m = el.querySelector('#ps-modal');
        const inp = (k, label, type = 'text', extra = '') => `<label class="block"><span class="font-bold text-slate-500">${label}</span><input type="${type}" data-k="${k}" value="${esc(r[k] ?? '')}" ${extra} class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 ${type === 'number' ? 'text-right font-mono font-black' : 'font-bold'}" /></label>`;
        const lines = [...new Set(['포장1부', '포장2부', 'OEM', 'ODM', ...rows.map(x => x.line).filter(Boolean)])];
        m.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-4 text-xs overflow-hidden">
            <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between"><h3 class="font-black text-sm">${orig ? '생산 스케줄 수정' : '생산 스케줄 추가'}</h3><button type="button" class="ps-close text-slate-300 hover:text-white text-xl px-1">&times;</button></div>
            <div class="p-4 space-y-3">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <label class="block"><span class="font-bold text-slate-500">구분</span><select data-k="site" class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${['본사', '김포'].map(v => `<option ${v === r.site ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                    <label class="block"><span class="font-bold text-slate-500">라인</span><input data-k="line" list="ps-line-list" value="${esc(r.line)}" class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /><datalist id="ps-line-list">${lines.map(l => `<option value="${esc(l)}"></option>`).join('')}</datalist></label>
                    <label class="block"><span class="font-bold text-slate-500">상태</span><select data-k="status" class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${Object.entries(PROD_STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
                    ${inp('orderDate', '수주일', 'date')}
                    ${inp('dueDate', '납품예정일 (날짜)', 'date')}${inp('dueText', '납품예정 (글자: 미정·10월 초)')}
                    ${inp('planDate', '포장계획 (날짜)', 'date')}${inp('planText', '포장계획 (글자)')}
                    <label class="block md:col-span-2"><span class="font-bold text-slate-500">거래처</span><input data-k="partner" list="ps-partner-list" value="${esc(r.partner)}" class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /><datalist id="ps-partner-list">${[...new Set([...rows.map(x => x.partner), ...(state.partners || []).map(p => (typeof p === 'string' ? p : p.name))].filter(Boolean))].map(p => `<option value="${esc(p)}"></option>`).join('')}</datalist></label>
                    <label class="block"><span class="font-bold text-slate-500">영업 담당</span><input data-k="manager" list="ps-manager-list" value="${esc(r.manager)}" class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /><datalist id="ps-manager-list">${[...new Set(rows.map(x => x.manager).filter(Boolean))].map(p => `<option value="${esc(p)}"></option>`).join('')}</datalist></label>
                    ${inp('lotNo', 'LOT.NO')}
                    <label class="block"><span class="font-bold text-rose-600">담당자 (수신자)</span><select id="ps-assignee" class="mt-0.5 w-full border border-rose-300 rounded-lg px-2 py-1.5 font-bold"><option value="">(담당자 없음)</option></select></label>
                    ${inp('shipTime', '출하 시간 (30분 전 알림)', 'time')}
                    <label class="block"><span class="font-bold text-slate-500">품목코드 <span class="font-normal text-slate-400">(입력하면 품명 자동)</span></span><input data-k="itemCode" id="ps-code" value="${esc(r.itemCode)}" autocomplete="off" placeholder="예: P-1001" class="ps-f mt-0.5 w-full border border-blue-300 rounded-lg px-2 py-1.5 font-mono font-black text-blue-700" />
                        <span id="ps-code-hint" class="block text-[10px] mt-0.5"></span></label>
                    <label class="block md:col-span-2 relative"><span class="font-bold text-slate-500">품명 * <span class="font-normal text-slate-400">(코드·품명 일부로 검색해 고르면 코드 연결)</span></span><input data-k="itemName" value="${esc(r.itemName)}" autocomplete="off" class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" id="ps-item" />
                        <div id="ps-item-sg" class="hidden absolute left-0 right-0 top-full z-10 max-h-48 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl"></div></label>
                    ${inp('spec', '규격(L)')}
                    ${inp('qty', '수량(ea)', 'number', 'min="0" step="any"')}${inp('perBox', '박스 입수', 'number', 'min="0" step="any"')}
                    <label class="block md:col-span-2"><span class="font-bold text-slate-500">용기</span><input data-k="container" value="${esc(r.container)}" placeholder="예: 대성 검정 300" class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                </div>
                <div class="p-2.5 bg-amber-50 border border-amber-200 rounded-xl space-y-1.5">
                    <div class="flex items-center justify-between"><span class="font-black text-amber-900">원부자재 분류 <span id="ps-mat-mode" class="font-bold text-[10px] text-amber-700"></span></span>
                        <label class="flex items-center gap-1 font-bold"><input type="checkbox" data-k="matsDone" id="ps-mats-done" class="ps-f" ${r.matsDone ? 'checked' : ''} />원부자재 완비</label></div>
                    <div class="grid grid-cols-2 md:grid-cols-7 gap-1.5">${MATERIAL_KEYS.map(([k, label]) => {
                        const v = r.materials[k] || '';
                        const opts = MAT_TEXT_OPTIONS.includes(v) ? MAT_TEXT_OPTIONS : [...MAT_TEXT_OPTIONS, v];
                        return `<label class="block"><span class="font-bold text-amber-800">${label}</span><select data-mat="${k}" class="ps-m mt-0.5 w-full border border-amber-300 rounded-lg px-1 py-1 font-bold bg-white disabled:bg-amber-50/60 disabled:text-slate-700">${opts.map(o => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${o ? esc(o) : '-'}</option>`).join('')}</select></label>`;
                    }).join('')}</div>
                </div>
                <div class="p-2.5 bg-sky-50 border border-sky-200 rounded-xl space-y-2">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="font-black text-sky-900">소요 원액·원부자재 (최대 ${MAX_MAT_ITEMS}개) · 수불부 재고 연동</span>
                        <div class="flex gap-1.5">
                            <button type="button" id="ps-mat-bom" class="px-2 py-1 bg-white border border-sky-300 rounded-lg font-bold text-sky-800" title="품목코드의 BOM(배합비) × 수량으로 채웁니다">BOM으로 채우기</button>
                            <button type="button" id="ps-mat-add" class="px-2 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-bold">+ 품목 추가</button>
                        </div>
                    </div>
                    <div id="ps-mat-rows" class="space-y-1.5"></div>
                    <label class="flex items-center gap-1.5 text-[11px] font-bold text-sky-900"><input type="checkbox" id="ps-mat-bom-save" checked /> 저장할 때 이 제품의 BOM(배합비)에도 등록 (단위당 사용량 = 필요수량 ÷ 생산수량)</label>
                    <p class="text-[10px] text-sky-800">소요 품목을 넣으면 위 <b>원부자재 분류 7칸이 자동</b>으로 정해집니다: 그 칸 품목 없음 = X, 재고 있음 = 재고완, 모자람 = 부족 → 모두 있으면 <b>원부자재 완비</b>. 재고는 <b>원료·원액 = 원료수불부</b>, <b>부자재 = 자재수불부</b>의 이 거점 재고이며, 같은 자재를 쓰는 다른 줄 중 <b>포장계획이 빠른 줄이 먼저</b> 씁니다.</p>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2">${inp('prodStart', '생산 시작일', 'date')}${inp('prodEnd', '생산 완료일', 'date')}${inp('shipDate', '출고일', 'date')}</div>
                <label class="block"><span class="font-bold text-slate-500">비고</span><textarea data-k="notes" rows="2" class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5">${esc(r.notes)}</textarea></label>
                <div class="flex justify-end gap-2"><button type="button" class="ps-close px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold">취소</button><button type="button" id="ps-save" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black">${orig ? '저장' : '추가'}</button></div>
            </div></div>`;
        m.classList.remove('hidden'); m.classList.add('flex');
        const close = () => { m.classList.add('hidden'); m.classList.remove('flex'); m.innerHTML = ''; };
        m.querySelectorAll('.ps-close').forEach(b => b.addEventListener('click', close));
        fillAssigneeSelect(m.querySelector('#ps-assignee'), r.assigneeId || '', r.assigneeName || '');
        const itemInp = m.querySelector('#ps-item');
        const codeInp = m.querySelector('#ps-code');
        const codeHint = m.querySelector('#ps-code-hint');
        const specInp = m.querySelector('.ps-f[data-k="spec"]');
        const sg = m.querySelector('#ps-item-sg');
        let found = [];
        const showCodeHint = () => {
            const code = codeInp.value.trim();
            const mm = code && state.master.find(x => x.code.toLowerCase() === code.toLowerCase());
            codeHint.className = `block text-[10px] mt-0.5 ${!code ? 'text-slate-400' : mm ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}`;
            codeHint.textContent = !code ? '품목코드가 있어야 생산계획·재고와 정확히 연동됩니다' : mm ? `✅ ${mm.name}` : '품목 마스터에 없는 코드입니다';
        };
        // 품목 선택 → 코드·품명·규격을 함께 채운다
        const pickItem = (it) => {
            r.itemCode = it.code;
            codeInp.value = it.code;
            itemInp.value = it.name;
            if (specInp && !specInp.value.trim() && it.spec && it.spec !== '-') specInp.value = it.spec;
            showCodeHint();
        };
        itemInp.addEventListener('input', () => {
            found = itemInp.value.trim() ? searchMasterItems(itemInp.value, 12) : [];
            sg.innerHTML = found.map((it, i) => `<button type="button" data-i="${i}" class="w-full text-left px-2 py-1.5 border-b border-slate-100 hover:bg-indigo-50"><span class="font-mono font-bold text-blue-600">${esc(it.code)}</span> ${esc(it.name)} <span class="text-slate-400">${esc(it.spec && it.spec !== '-' ? it.spec : '')}</span></button>`).join('');
            sg.classList.toggle('hidden', !found.length);
            sg.querySelectorAll('button').forEach(b => {
                b.addEventListener('mousedown', (e) => e.preventDefault());
                b.addEventListener('click', () => { pickItem(found[Number(b.dataset.i)]); sg.classList.add('hidden'); });
            });
        });
        itemInp.addEventListener('blur', () => setTimeout(() => sg.classList.add('hidden'), 150));
        codeInp.addEventListener('change', () => {
            const code = codeInp.value.trim();
            const mm = code && state.master.find(x => x.code.toLowerCase() === code.toLowerCase());
            if (mm) pickItem(mm); else showCodeHint();
        });
        codeInp.addEventListener('input', showCodeHint);
        showCodeHint();

        // ---------- 소요 원액·원부자재 (최대 5개) ----------
        const matHost = m.querySelector('#ps-mat-rows');
        // 폼의 지금 값(거점·상태·포장계획)으로 다른 줄과 함께 재고를 배분해 이 줄의 재고·부족량을 구한다
        const formRow = () => {
            const x = { ...r, matItems: r.matItems };
            m.querySelectorAll('.ps-f').forEach(el2 => { if (['site', 'status', 'planDate', 'dueDate'].includes(el2.dataset.k)) x[el2.dataset.k] = el2.value; });
            return x;
        };
        const matInfo = () => {
            const me = formRow();
            const list = [...(cur === r.sheetDate ? rows : (latestRows || [])).filter(x => x.id !== r.id), me];
            return allocateMats(list).get(r.id) || [];
        };
        const infoHtml = (it) => {
            if (!it || !it.code) return '<span class="text-slate-400">품목을 고르면 재고가 보입니다</span>';
            const st = it.done ? '<span class="text-slate-500">완료된 줄 (재고 차감 안 함)</span>'
                : it.short > 0 ? `<span class="text-rose-700 font-black">⚠️ 부족 ${fmt(it.short)} ${esc(it.unit || '')}</span>` : '<span class="text-emerald-700 font-black">✅ 재고 충분</span>';
            const after = r3(it.avail) === r3(it.stock) ? '' : it.avail >= 0 ? ` · 앞선 줄 사용 후 <b>${fmt(it.avail)}</b>` : ` · 앞선 줄이 다 쓰고 <b>${fmt(-it.avail)}</b> 부족`;
            return `수불부 <b>${fmt(it.stock)}</b> · 창고 ${fmt(it.inv)}${after} → ${st}`;
        };
        // 소요 품목이 있으면 분류 7칸·원부자재 완비를 자동 판정해 보여주고 잠근다 (없으면 직접 고름)
        const syncAuto = (info) => {
            const auto = r.matItems.some(x => x.code || x.name);
            const st = auto ? autoSlotStatus(info.map((it, i) => ({ ...it, slot: r.matItems[i]?.slot }))) : null;
            m.querySelectorAll('.ps-m').forEach(sel => {
                if (auto) {
                    const v = st[sel.dataset.mat].text;
                    if (![...sel.options].some(o => o.value === v)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(v)}">${esc(v)}</option>`);
                    sel.value = v;
                }
                sel.disabled = auto;
                sel.classList.toggle('text-rose-700', auto && sel.value === '부족');
            });
            const done = m.querySelector('#ps-mats-done');
            if (auto) done.checked = !MATERIAL_KEYS.some(([k]) => st[k].short > 0) && !info.some((it, i) => !slotOf({ ...it, slot: r.matItems[i]?.slot }) && it.short > 0);
            done.disabled = auto;
            m.querySelector('#ps-mat-mode').textContent = auto ? '(소요 품목으로 자동 판정)' : '(소요 품목이 없으면 직접 고릅니다: X = 해당없음)';
        };
        const updateInfo = () => { const info = matInfo(); matHost.querySelectorAll('.ps-mat-info').forEach(elx => { elx.innerHTML = infoHtml(info[Number(elx.dataset.i)]); }); syncAuto(info); };
        const renderMats = () => {
            m.querySelector('#ps-mat-add').disabled = r.matItems.length >= MAX_MAT_ITEMS;
            m.querySelector('#ps-mat-add').classList.toggle('opacity-40', r.matItems.length >= MAX_MAT_ITEMS);
            matHost.innerHTML = r.matItems.length === 0 ? '<div class="text-[11px] text-sky-700/70 py-1">등록된 소요 품목이 없습니다. [+ 품목 추가]로 원액·원부자재를 검색해 넣거나 [BOM으로 채우기]를 누르세요.</div>'
                : r.matItems.map((it, i) => `
                <div class="grid grid-cols-12 gap-1.5 items-start bg-white border border-sky-200 rounded-lg p-1.5">
                    <div class="col-span-12 md:col-span-5"><input type="text" data-i="${i}" value="${esc(it.name)}" placeholder="품목코드·품명 일부 (원액·원료·부자재)" class="ps-mat-item w-full border border-slate-300 rounded-md px-1.5 py-1 font-bold" autocomplete="off" />
                        <div class="text-[10px] font-mono text-blue-600 mt-0.5">${esc(it.code || '')}${it.category ? ` · ${esc(it.category)}` : ''}</div></div>
                    <div class="col-span-4 md:col-span-2"><select data-i="${i}" class="ps-mat-slot w-full border border-amber-300 rounded-md px-1 py-1 font-bold bg-amber-50" title="원부자재 분류 칸">
                        ${[...MATERIAL_KEYS, ['', '기타']].map(([k, label]) => `<option value="${k}" ${slotOf(it) === k ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
                    <div class="col-span-4 md:col-span-2"><input type="number" min="0" step="any" data-i="${i}" value="${esc(it.qty ?? '')}" placeholder="필요수량" class="ps-mat-qty w-full border border-slate-300 rounded-md px-1.5 py-1 text-right font-black" /></div>
                    <div class="col-span-3 md:col-span-2"><input type="text" data-i="${i}" value="${esc(it.unit || '')}" placeholder="단위" class="ps-mat-unit w-full border border-slate-300 rounded-md px-1.5 py-1" /></div>
                    <div class="col-span-1 text-right"><button type="button" data-i="${i}" class="ps-mat-del text-rose-500 font-black px-1.5 py-1" title="빼기">&times;</button></div>
                    <div class="col-span-12 text-[10px] leading-snug ps-mat-info" data-i="${i}"></div>
                </div>`).join('');
            matHost.querySelectorAll('.ps-mat-item').forEach(inpx => attachItemPicker(inpx, (it) => {
                const i = Number(inpx.dataset.i);
                if (r.matItems.some((x, j) => j !== i && x.code === it.code)) { alert(`[${it.code}] ${it.name}은(는) 이미 넣은 품목입니다. 그 줄의 수량을 고치세요.`); inpx.value = r.matItems[i].name || ''; return; }
                r.matItems[i] = { ...r.matItems[i], code: it.code, name: it.name, category: it.category || '', unit: it.unit || r.matItems[i].unit || '' };
                r.matItems[i].slot = guessSlot(r.matItems[i]); // 분류 칸 자동 판정 (드롭다운으로 바꿀 수 있음)
                renderMats();
            }, (it) => it.category !== '완제품'));
            matHost.querySelectorAll('.ps-mat-qty').forEach(inpx => inpx.addEventListener('input', () => { r.matItems[Number(inpx.dataset.i)].qty = inpx.value === '' ? '' : Number(inpx.value); updateInfo(); }));
            matHost.querySelectorAll('.ps-mat-unit').forEach(inpx => inpx.addEventListener('input', () => { r.matItems[Number(inpx.dataset.i)].unit = inpx.value.trim(); }));
            matHost.querySelectorAll('.ps-mat-slot').forEach(sel => sel.addEventListener('change', () => { r.matItems[Number(sel.dataset.i)].slot = sel.value; updateInfo(); }));
            matHost.querySelectorAll('.ps-mat-del').forEach(b => b.addEventListener('click', () => { r.matItems.splice(Number(b.dataset.i), 1); renderMats(); }));
            updateInfo();
        };
        m.querySelector('#ps-mat-add').addEventListener('click', () => {
            if (r.matItems.length >= MAX_MAT_ITEMS) { alert(`소요 품목은 최대 ${MAX_MAT_ITEMS}개까지입니다.`); return; }
            r.matItems.push({ code: '', name: '', category: '', unit: '', qty: '' });
            renderMats();
            matHost.querySelectorAll('.ps-mat-item')[r.matItems.length - 1]?.focus();
        });
        m.querySelector('#ps-mat-bom').addEventListener('click', () => {
            const code = codeInp.value.trim();
            const qty = Number(m.querySelector('.ps-f[data-k="qty"]').value) || 0;
            if (!code) { alert('먼저 품목코드를 넣거나 품명을 검색해 고르세요.'); return; }
            if (!(qty > 0)) { alert('먼저 수량(ea)을 넣으세요.'); return; }
            const bom = getBoms()[code];
            const list = [...(bom?.rawList || []), ...(bom?.subList || [])].filter(x => x.code && Number(x.rate) > 0);
            if (!list.length) { alert(`[${code}]의 BOM(배합비)이 없습니다.\n제품생산 / 입고 화면에서 이 제품의 원액·부자재 사용량을 넣고 [배합비 저장]을 누르세요.`); return; }
            if (r.matItems.some(x => x.code || x.name) && !confirm('지금 소요 품목을 BOM 기준으로 바꿀까요?')) return;
            r.matItems = list.slice(0, MAX_MAT_ITEMS).map(x => {
                const mm = state.master.find(y => y.code === x.code) || {};
                const it = { code: x.code, name: mm.name || x.code, category: mm.category || '', unit: mm.unit || '', qty: r3(Number(x.rate) * qty) };
                return { ...it, slot: x.slot !== undefined ? x.slot : guessSlot(it) };
            });
            if (list.length > MAX_MAT_ITEMS) showToast(`BOM 품목이 ${list.length}개라 앞의 ${MAX_MAT_ITEMS}개만 넣었습니다.`);
            renderMats();
        });
        // 거점·상태·포장계획이 바뀌면 재고 배분이 달라진다
        m.querySelectorAll('.ps-f[data-k="site"], .ps-f[data-k="status"], .ps-f[data-k="planDate"], .ps-f[data-k="dueDate"]').forEach(x => x.addEventListener('change', updateInfo));
        renderMats();

        m.querySelector('#ps-save').addEventListener('click', async () => {
            m.querySelectorAll('.ps-f').forEach(x => { r[x.dataset.k] = x.type === 'checkbox' ? x.checked : x.value.trim(); });
            m.querySelectorAll('.ps-m').forEach(x => { const v = x.value.trim(); if (v) r.materials[x.dataset.mat] = v; else delete r.materials[x.dataset.mat]; });
            const asg = readAssignee(m.querySelector('#ps-assignee'));
            r.assigneeId = asg?.id || '';
            r.assigneeName = asg?.name || '';
            if (!r.itemName) { alert('품명을 입력하세요.'); return; }
            if (!r.itemCode && !confirm('품목코드 없이 저장할까요?\n(품목코드가 있어야 생산계획·BOM·재고와 정확히 연동됩니다)')) return;
            if (r.matItems.some(x => (x.code || x.name) && !(Number(x.qty) > 0))) { alert('소요 원부자재의 필요수량을 넣으세요.'); return; }
            r.matItems = r.matItems.filter(x => x.code || x.name);
            // BOM 등록 준비: 단위당 사용량 = 필요수량 ÷ 생산수량 (코드가 있는 소요 품목만)
            const wantBom = m.querySelector('#ps-mat-bom-save')?.checked && r.itemCode && Number(r.qty) > 0 && r.matItems.some(x => x.code);
            let bomPlan = null;
            if (wantBom) {
                const rate = (x) => Math.round(Number(x.qty) / Number(r.qty) * 1e6) / 1e6;
                const entry = (x) => ({ code: x.code, rate: rate(x), slot: slotOf(x) });
                const withCode = r.matItems.filter(x => x.code && Number(x.qty) > 0);
                const isRaw = (x) => { const c = x.category || state.master.find(y => y.code === x.code)?.category; return c === '원액' || c === '원료'; };
                const next = { rawList: withCode.filter(isRaw).map(entry), subList: withCode.filter(x => !isRaw(x)).map(entry) };
                const prev = getBoms()[r.itemCode];
                const key = (b) => [...(b?.rawList || []), ...(b?.subList || [])].map(x => `${x.code}:${Math.round(Number(x.rate) * 1e6) / 1e6}`).sort().join('|');
                if (!prev || key(prev) !== key(next)) {
                    const lines = [...next.rawList, ...next.subList].map(x => `· ${state.master.find(y => y.code === x.code)?.name || x.code}: 1개당 ${x.rate}`).join('\n');
                    if (!prev || confirm(`[${r.itemCode}] ${r.itemName}의 BOM(배합비)을 이 스케줄 값으로 바꿀까요?\n\n${lines}\n\n(취소하면 스케줄만 저장합니다)`)) bomPlan = next;
                }
            }
            try {
                const [savedRow] = await saveProdRows([r]);
                if (bomPlan) {
                    try {
                        const res = await saveBom(r.itemCode, bomPlan.rawList, bomPlan.subList);
                        showToast(`🧾 [${r.itemCode}] BOM을 ${res.cloud ? '등록했습니다 (모든 기기·생산계획에 사용)' : '이 기기에 저장했습니다'}.`);
                    } catch (e) { alert(`스케줄은 저장했지만 BOM 등록에 실패했습니다: ${e.message}`); }
                }
                // 캘린더에서 연 줄은 지금 보는 작성일자가 아닐 수 있다
                const target = savedRow.sheetDate === cur ? rows : (latestRows || []);
                const i = target.findIndex(x => x.id === savedRow.id);
                if (i >= 0) target[i] = savedRow; else target.push(savedRow);
                close();
                showToast(`🏭 생산 스케줄을 ${orig ? '저장' : '추가'}했습니다.`);
                notifyRowAssignee(savedRow, orig);
                if (orig) { draw(); if (savedRow.sheetDate === latestDate()) { if (target === rows) notifyLatest(); else onChanged(target); } } else refreshDates();
            } catch (err) { alert(err.message); }
        });
    };

    // ---------- 엑셀 내보내기 ----------
    const exportXlsx = (list) => {
        const head = ['구분', '라인', '상태', '수주일', '납품예정', '포장계획', '거래처', '담당', '품목코드', '품명', '규격(L)', '수량(ea)', '박스입수', '박스량', '용기', ...MATERIAL_KEYS.map(([, l]) => l), '원부자재완비', '생산시작', '생산완료', 'LOT.NO', '출고일', '비고', '소요 원부자재 (필요수량·부족)'];
        const data = groupsOf(list).flatMap(g => g.rows).map(r => [r.site, r.line, PROD_STATUS[r.status]?.label || r.status, r.orderDate, r.dueText || r.dueDate, r.planText || r.planDate, r.partner, r.manager, r.itemCode, r.itemName, r.spec,
            r.qty === '' ? '' : Number(r.qty), r.perBox === '' ? '' : Number(r.perBox), boxesOf(r) === '' ? '' : Math.round(boxesOf(r) * 10) / 10, r.container, ...slotTexts(r), matsDoneOf(r) ? 'O' : '', r.prodStart, r.prodEnd, r.lotNo, r.shipDate, r.notes,
            (allocMap.get(r.id) || []).map(matLine).join(' / ')]);
        const ws = XLSX.utils.aoa_to_sheet([head, ...data]);
        ws['!cols'] = head.map((h, i) => ({ wch: [6, 8, 10, 11, 11, 11, 18, 8, 11, 36, 7, 9, 8, 8, 18, 9, 9, 9, 9, 9, 8, 8, 8, 11, 11, 11, 11, 40, 70][i] || 10 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, (cur || today).slice(5).replace('-', ''));
        XLSX.writeFile(wb, `생산스케줄_작성${cur || today}.xlsx`);
    };

    // ---------- 인쇄 (A4 가로) ----------
    const printList = (list) => {
        const w = window.open('', '_blank');
        if (!w) { alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
        const cell = (v, cls = '') => `<td class="${cls}">${esc(v ?? '')}</td>`;
        const body = groupsOf(list).map(g => {
            const q = g.rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
            const b = g.rows.reduce((s, r) => s + (Number(boxesOf(r)) || 0), 0);
            return `<tr class="grp"><td colspan="14">${esc(g.key)} — ${g.rows.length}줄 · ${fmt(q)} ea · ${fmt(b)} 박스</td></tr>`
                + g.rows.map(r => `<tr>${cell(PROD_STATUS[r.status]?.label)}${cell(md(r.orderDate))}${cell(dateOrText(r.dueDate, r.dueText))}${cell(dateOrText(r.planDate, r.planText))}${cell(`${r.partner}${r.manager ? ` / ${r.manager}` : ''}`)}${cell(`${r.itemCode ? `[${r.itemCode}] ` : ''}${r.itemName}`, 'name')}${cell(fmt(r.qty), 'num')}${cell(`${fmt(boxesOf(r))}${r.perBox ? ` (×${fmt(r.perBox)})` : ''}`, 'num')}${cell(r.container)}<td class="small">${isAutoRow(r)
                    ? ((allocMap.get(r.id) || []).filter(it => slotOf(it) === 'raw').map(it => `<div class="${!it.done && it.short > 0 ? 'short' : ''}">${esc(it.name)} ${fmt(it.qty)}${esc(it.unit || 'L')}${!it.done && it.short > 0 ? ` 부족 ${fmt(it.short)}` : it.done ? '' : ' 재고완'}</div>`).join('') || 'X')
                    : esc(r.materials?.raw || '')}</td><td class="small">${isAutoRow(r)
                    ? (() => { const tx = slotTexts(r); const shorts = MATERIAL_KEYS.map(([k, l], i) => (k !== 'raw' && tx[i].startsWith('부족') ? `${l} ${tx[i]}` : '')).filter(Boolean); return shorts.length ? `<span class="short">${esc(shorts.join(' · '))}</span>` : '원부자재 완비'; })()
                    : `${esc(MATERIAL_KEYS.filter(([k]) => k !== 'raw' && r.materials?.[k]).map(([k, l]) => `${l}:${r.materials[k]}`).join(' · '))}${r.matsDone ? ' (완비)' : ''}`}</td>${cell(r.lotNo)}${cell(md(r.shipDate))}${cell(r.notes, 'small')}</tr>`).join('');
        }).join('');
        w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>생산 스케줄 ${cur}</title><style>
            @page { size: A4 landscape; margin: 8mm; } body { font-family: 'Malgun Gothic', sans-serif; font-size: 8pt; color: #000; }
            h1 { font-size: 14pt; margin: 0 0 4px; } .sub { font-size: 8pt; color: #444; margin-bottom: 6px; }
            table { width: 100%; border-collapse: collapse; table-layout: auto; } th, td { border: 0.5pt solid #555; padding: 2px 3px; vertical-align: top; }
            th { background: #e5e7eb; font-weight: 800; } .grp td { background: #eef2ff; font-weight: 800; } .num { text-align: right; white-space: nowrap; }
            .name { font-weight: 700; min-width: 160px; } .small { font-size: 7pt; } tr { page-break-inside: avoid; } .short { color: #c00; font-weight: 800; }
        </style></head><body><h1>대림오일 생산(포장) SCHEDULE</h1><div class="sub">작성일자 ${cur} · 출력일 ${today} · ${f.site === 'DONE' ? '완료·출고대기' : `${VIEW_TABS.find(([v]) => v === f.site)?.[1] === '전체' ? '본사·김포' : VIEW_TABS.find(([v]) => v === f.site)?.[1] || '본사·김포'} · ${f.status === 'ACTIVE' ? '진행 중' : f.status === 'ALL' ? '전체' : PROD_STATUS[f.status]?.label}`} · ${list.length}줄</div>
            <table><thead><tr><th>상태</th><th>수주</th><th>납품예정</th><th>포장계획</th><th>거래처/담당</th><th>품명</th><th>수량(ea)</th><th>박스</th><th>용기</th><th>원액</th><th>원부자재</th><th>LOT</th><th>출고</th><th>비고</th></tr></thead><tbody>${body}</tbody></table>
            <script>window.onload = function () { setTimeout(function () { window.print(); }, 200); };<\/script></body></html>`);
        w.document.close();
    };

    // ---------- 엑셀 가져오기 (예전 날짜 시트 → 시트 이름 MMDD가 작성일자) ----------
    const importXlsx = async (file) => {
        let wb;
        try { wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' }); } catch (e) { alert(`엑셀을 읽지 못했습니다: ${e.message}`); return; }
        const year = (file.name.match(/20\d{2}/) || [String(new Date().getFullYear())])[0];
        const dateOf = (name) => {
            const m = String(name).trim().match(/^(\d{2})(\d{2})$/);
            if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > 31) return '';
            return `${year}-${m[1]}-${m[2]}`;
        };
        const dated = wb.SheetNames.map(n => ({ name: n, date: dateOf(n) })).filter(x => x.date).sort((a, b) => b.date.localeCompare(a.date));
        const have = new Set(dates.map(x => x.date));
        const missing = dated.filter(x => !have.has(x.date));
        const parse = (name, sheetDate) => parseScheduleSheet(sheetToRows(XLSX, wb.Sheets[name]), { sheetDate, site: '본사' });
        const stamp = Date.now();
        const withIds = (list, sheetDate, tag) => list.map((r, i) => ({ ...r, id: `PS-${stamp}-${tag}-${String(i + 1).padStart(3, '0')}`, sheetDate, sort: i + 1 }));

        // 1) 앱에 없는 날짜 시트 모두 (작성일자별로)
        if (missing.length && confirm(`날짜 시트 ${dated.length}장(${year}년으로 봄) 중 앱에 없는 ${missing.length}장을 작성일자별로 모두 가져올까요?\n이미 있는 작성일자 ${dated.length - missing.length}장은 건너뜁니다.\n\n[취소]를 누르면 시트 하나만 골라 가져옵니다.`)) {
            let done = 0; let lines = 0; const failed = [];
            for (const s of missing) {
                notice = `엑셀 가져오는 중… ${done + 1}/${missing.length} (${s.name})`; draw();
                try {
                    const list = parse(s.name, s.date);
                    if (list.length) { await saveProdRows(withIds(list, s.date, s.name)); lines += list.length; }
                } catch (e) { failed.push(`${s.name}: ${e.message}`); }
                done++;
            }
            notice = '';
            showToast(`🏭 작성일자 ${done - failed.length}장 · ${lines.toLocaleString()}줄을 가져왔습니다.`);
            if (failed.length) alert(`가져오지 못한 시트 ${failed.length}장:\n${failed.slice(0, 20).join('\n')}`);
            await loadDates();
            await openDate(latestDate() || today, { notify: true });
            return;
        }

        // 2) 시트 하나
        const def = (dated.find(x => x.date === cur) || dated[0] || { name: wb.SheetNames[0] }).name;
        const name = (prompt(`가져올 시트 이름을 입력하세요. (예: ${def})\n시트 이름이 MMDD이면 그 날짜가 작성일자가 됩니다.\n시트: ${wb.SheetNames.slice(0, 40).join(', ')}${wb.SheetNames.length > 40 ? ' …' : ''}`, def) || '').trim();
        if (!name) return;
        if (!wb.Sheets[name]) { alert(`'${name}' 시트가 없습니다.`); return; }
        const sheetDate = dateOf(name) || cur || today;
        let parsed;
        try { parsed = parse(name, sheetDate); } catch (e) { alert(e.message); return; }
        // 그 작성일자에 이미 있는 줄(거래처·품명·수량·수주일이 같음)은 건너뛴다
        let existing = [];
        try { existing = sheetDate === cur ? rows : await listProdSchedule(sheetDate); } catch (e) { alert(e.message); return; }
        const key = (r) => [r.partner, r.itemName, Number(r.qty) || 0, r.orderDate].join('|').replace(/\s/g, '');
        const haveKeys = new Set(existing.map(key));
        const fresh = parsed.filter(r => !haveKeys.has(key(r)));
        if (!fresh.length) { alert(`'${name}' 시트 ${parsed.length}줄이 모두 ${sheetDate} 작성일자에 이미 있습니다.`); return; }
        if (!confirm(`'${name}' 시트에서 ${parsed.length}줄을 읽었습니다.\n${sheetDate} 작성일자에 이미 있는 ${parsed.length - fresh.length}줄을 빼고 새 줄 ${fresh.length}개를 추가할까요?`)) return;
        const base = Math.max(0, ...existing.map(x => Number(x.sort) || 0));
        try {
            const savedRows = await saveProdRows(withIds(fresh, sheetDate, name).map((r, i) => ({ ...r, sort: base + i + 1 })));
            showToast(`🏭 ${sheetDate} 작성일자에 ${savedRows.length}줄을 가져왔습니다.`);
            await loadDates();
            await openDate(sheetDate, { notify: true });
        } catch (e) { alert(e.message); }
    };
    window.__openProdScheduleRow = (id) => { const r = rows.find(x => x.id === id) || (latestRows || []).find(x => x.id === id); if (r) openEditor(r); };
    load();
    return { reload: load };
};

// 메뉴 '생산(포장) 스케줄' (탭 prodSchedule): 캘린더 아래와 같은 화면을 단독으로
export const renderProdScheduleTab = (container, { showToast } = {}) => {
    container.innerHTML = '<div id="prod-schedule-tab"></div>';
    return renderProdSchedule(container.querySelector('#prod-schedule-tab'), { showToast });
};
