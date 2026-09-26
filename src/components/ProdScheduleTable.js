import * as XLSX from 'xlsx';
import { state } from '../services/db.js';
import { searchMasterItems, localDateStr, matchesQuery } from '../services/searchUtils.js';
import { listProdSchedule, listProdDates, copyProdDate, deleteProdDate, saveProdRows, deleteProdRow, newProdId, PROD_STATUS, MATERIAL_KEYS } from '../services/prodSchedule.js';
import { parseScheduleSheet, sheetToRows } from '../services/prodScheduleParse.js';
import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';

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

export const renderProdSchedule = (el, { showToast = () => {}, onChanged = () => {} } = {}) => {
    let rows = [];            // 보고 있는 작성일자의 줄
    let dates = [];           // [{ date, count }] 최신순
    let cur = '';             // 보고 있는 작성일자
    let monthF = '';          // 날짜 칩 월 필터 ('ALL' 또는 'MM')
    let latestRows = null;    // 최신 작성일자의 줄 (캘린더 표시용)
    let loading = true;
    let error = '';
    let notice = '';          // 긴 작업 진행 표시
    const saved = (() => { try { return JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'); } catch { return {}; } })();
    const f = { site: saved.site || '', status: saved.status || 'ACTIVE', q: '' };
    const persist = () => { try { localStorage.setItem(FILTER_KEY, JSON.stringify({ site: f.site, status: f.status })); } catch { /* 저장 불가 */ } };
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
        (!f.site || r.site === f.site)
        && (f.status === 'ALL' || (f.status === 'ACTIVE' ? r.status !== 'SHIPPED' : r.status === f.status))
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

    const rowHtml = (r) => `
        <tr class="align-top hover:bg-slate-50 ${r.status === 'SHIPPED' ? 'opacity-60' : ''}" data-id="${esc(r.id)}">
            <td class="p-1.5"><select class="ps-status border rounded px-1 py-0.5 text-[11px] font-bold ${PROD_STATUS[r.status]?.cls || ''}">${Object.entries(PROD_STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v.label}</option>`).join('')}</select></td>
            <td class="p-1.5 font-mono whitespace-nowrap">${esc(md(r.orderDate))}</td>
            <td class="p-1.5 whitespace-nowrap ${dueCls(r)}" title="${esc(r.dueText || r.dueDate)}">${esc(dateOrText(r.dueDate, r.dueText))}</td>
            <td class="p-1.5 whitespace-nowrap" title="${esc(r.planText || r.planDate)}">${esc(dateOrText(r.planDate, r.planText))}</td>
            <td class="p-1.5"><div class="font-bold text-slate-800">${esc(r.partner)}</div><div class="text-[10px] text-slate-400">${esc(r.manager)}</div></td>
            <td class="p-1.5 min-w-[200px]"><div class="font-bold text-slate-900">${esc(r.itemName)}</div>${r.itemCode ? `<div class="text-[10px] font-mono text-slate-400">${esc(r.itemCode)}</div>` : ''}</td>
            <td class="p-1.5 text-right font-mono font-black">${fmt(r.qty)}</td>
            <td class="p-1.5 text-right font-mono whitespace-nowrap">${fmt(boxesOf(r))}${r.perBox ? `<div class="text-[10px] text-slate-400">×${fmt(r.perBox)}</div>` : ''}</td>
            <td class="p-1.5 text-[11px] text-slate-600 min-w-[90px]">${esc(r.container)}</td>
            <td class="p-1.5"><div class="flex flex-wrap gap-0.5 min-w-[150px]">${MATERIAL_KEYS.filter(([k]) => r.materials?.[k]).map(([k, label]) => `<span class="px-1 py-0.5 rounded border text-[10px] font-bold ${matTone(r.materials[k])}" title="${esc(label)}: ${esc(r.materials[k])}">${esc(label)} ${esc(r.materials[k].split('→').pop().trim().slice(0, 8))}</span>`).join('')}${r.matsDone ? '<span class="px-1 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-black">완비</span>' : ''}</div></td>
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
        const list = filtered();
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
                <span class="text-slate-500 font-bold text-xs">${loading ? '불러오는 중…' : `${list.length}줄 · 수량 ${fmt(total.qty)} ea · 박스 ${fmt(total.box)}`}</span></div>
            <div class="flex flex-wrap items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                <div class="flex bg-white border border-slate-200 p-0.5 rounded-lg font-bold">${[['', '전체'], ['본사', '본사'], ['김포', '김포']].map(([v, t]) => `<button type="button" class="ps-site px-2.5 py-1 rounded-md ${f.site === v ? 'bg-indigo-600 text-white' : 'text-slate-500'}" data-v="${v}">${t}</button>`).join('')}</div>
                <select id="ps-status-f" class="border border-slate-300 rounded-lg px-2 py-1 font-bold">
                    <option value="ACTIVE" ${f.status === 'ACTIVE' ? 'selected' : ''}>진행 중 (출고완료 제외)</option>
                    <option value="ALL" ${f.status === 'ALL' ? 'selected' : ''}>전체</option>
                    ${Object.entries(PROD_STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
                </select>
                <div class="relative flex-1 min-w-[200px]"><i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"></i>
                    <input type="search" id="ps-q" value="${esc(f.q)}" placeholder="거래처·담당·품명·LOT·비고 일부" class="w-full border border-slate-300 rounded-lg pl-8 pr-2 py-1 font-bold" /></div>
                <span class="text-[11px] text-slate-500"><span class="text-rose-700 font-black">빨강</span> 납기 지남 · <span class="text-amber-700 font-black">주황</span> 7일 안</span>
            </div>
            ${error ? `<div class="p-2 text-rose-600 font-bold">${esc(error)}</div>` : ''}
            ${notice ? `<div class="p-2 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-800 font-black">${esc(notice)}</div>` : ''}
            <div class="overflow-auto border border-slate-200 rounded-xl max-h-[75vh]">
                <table class="w-full">
                    <thead class="bg-slate-100 text-slate-600 font-bold sticky top-0 z-10"><tr>
                        <th class="p-1.5 text-left">상태</th><th class="p-1.5 text-left">수주</th><th class="p-1.5 text-left">납품예정</th><th class="p-1.5 text-left">포장계획</th>
                        <th class="p-1.5 text-left">거래처/담당</th><th class="p-1.5 text-left">품명</th><th class="p-1.5 text-right">수량(ea)</th><th class="p-1.5 text-right">박스</th>
                        <th class="p-1.5 text-left">용기</th><th class="p-1.5 text-left">원부자재</th><th class="p-1.5 text-left">생산</th><th class="p-1.5 text-left">LOT</th><th class="p-1.5 text-left">출고</th><th class="p-1.5 text-left">비고</th><th class="p-1.5"></th>
                    </tr></thead>
                    <tbody class="divide-y divide-slate-100">
                        ${groups.map(g => { const s = sum(g.rows); return `<tr class="bg-indigo-50/70"><td colspan="15" class="px-2 py-1.5 font-black text-indigo-900">${esc(g.key)} <span class="font-bold text-indigo-600">(${g.rows.length}줄 · ${fmt(s.qty)} ea · ${fmt(s.box)} 박스)</span></td></tr>${g.rows.map(rowHtml).join('')}`; }).join('')
                            || `<tr><td colspan="15" class="p-8 text-center text-slate-400 font-bold">${loading ? '불러오는 중…' : '조건에 맞는 줄이 없습니다.'}</td></tr>`}
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
    const openEditor = (orig) => {
        const r = orig ? { ...orig, materials: { ...(orig.materials || {}) } } : {
            id: newProdId(), sheetDate: cur || today, site: f.site || '본사', line: '포장1부', status: 'PLANNED', orderDate: today, dueText: '', dueDate: '', planText: '', planDate: '',
            partner: '', manager: '', itemCode: '', itemName: '', spec: '', qty: '', perBox: '', container: '', materials: {}, matsDone: false,
            prodStart: '', prodEnd: '', lotNo: '', shipDate: '', notes: '', sort: (Math.max(0, ...rows.map(x => Number(x.sort) || 0)) + 1)
        };
        const m = el.querySelector('#ps-modal');
        const inp = (k, label, type = 'text', extra = '') => `<label class="block"><span class="font-bold text-slate-500">${label}</span><input type="${type}" data-k="${k}" value="${esc(r[k] ?? '')}" ${extra} class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 ${type === 'number' ? 'text-right font-mono font-black' : 'font-bold'}" /></label>`;
        const lines = [...new Set(['포장1부', '포장2부', 'OEM·ODM', ...rows.map(x => x.line).filter(Boolean)])];
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
                    <label class="block md:col-span-3 relative"><span class="font-bold text-slate-500">품명 * <span class="font-normal text-slate-400">(품목마스터에서 고르면 코드 연결)</span></span><input data-k="itemName" value="${esc(r.itemName)}" autocomplete="off" class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" id="ps-item" />
                        <div id="ps-item-sg" class="hidden absolute left-0 right-0 top-full z-10 max-h-48 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl"></div></label>
                    ${inp('spec', '규격(L)')}
                    ${inp('qty', '수량(ea)', 'number', 'min="0" step="any"')}${inp('perBox', '박스 입수', 'number', 'min="0" step="any"')}
                    <label class="block md:col-span-2"><span class="font-bold text-slate-500">용기</span><input data-k="container" value="${esc(r.container)}" placeholder="예: 대성 검정 300" class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                </div>
                <div class="p-2.5 bg-amber-50 border border-amber-200 rounded-xl space-y-1.5">
                    <div class="flex items-center justify-between"><span class="font-black text-amber-900">원부자재 (발주 9/17 · 재고 · 완 · 사급 · X=해당없음)</span>
                        <label class="flex items-center gap-1 font-bold"><input type="checkbox" data-k="matsDone" class="ps-f" ${r.matsDone ? 'checked' : ''} />원부자재 완비</label></div>
                    <div class="grid grid-cols-2 md:grid-cols-7 gap-1.5">${MATERIAL_KEYS.map(([k, label]) => `<label class="block"><span class="font-bold text-amber-800">${label}</span><input data-mat="${k}" value="${esc(r.materials[k] || '')}" class="ps-m mt-0.5 w-full border border-amber-300 rounded-lg px-1.5 py-1 font-bold bg-white" /></label>`).join('')}</div>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2">${inp('prodStart', '생산 시작일', 'date')}${inp('prodEnd', '생산 완료일', 'date')}${inp('shipDate', '출고일', 'date')}</div>
                <label class="block"><span class="font-bold text-slate-500">비고</span><textarea data-k="notes" rows="2" class="ps-f mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5">${esc(r.notes)}</textarea></label>
                <div class="flex justify-end gap-2"><button type="button" class="ps-close px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold">취소</button><button type="button" id="ps-save" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black">${orig ? '저장' : '추가'}</button></div>
            </div></div>`;
        m.classList.remove('hidden'); m.classList.add('flex');
        const close = () => { m.classList.add('hidden'); m.classList.remove('flex'); m.innerHTML = ''; };
        m.querySelectorAll('.ps-close').forEach(b => b.addEventListener('click', close));
        const itemInp = m.querySelector('#ps-item');
        const sg = m.querySelector('#ps-item-sg');
        let found = [];
        itemInp.addEventListener('input', () => {
            r.itemCode = '';
            found = itemInp.value.trim() ? searchMasterItems(itemInp.value, 12) : [];
            sg.innerHTML = found.map((it, i) => `<button type="button" data-i="${i}" class="w-full text-left px-2 py-1.5 border-b border-slate-100 hover:bg-indigo-50"><span class="font-mono font-bold">${esc(it.code)}</span> ${esc(it.name)} <span class="text-slate-400">${esc(it.spec && it.spec !== '-' ? it.spec : '')}</span></button>`).join('');
            sg.classList.toggle('hidden', !found.length);
            sg.querySelectorAll('button').forEach(b => {
                b.addEventListener('mousedown', (e) => e.preventDefault());
                b.addEventListener('click', () => { const it = found[Number(b.dataset.i)]; r.itemCode = it.code; itemInp.value = it.name; sg.classList.add('hidden'); });
            });
        });
        itemInp.addEventListener('blur', () => setTimeout(() => sg.classList.add('hidden'), 150));
        m.querySelector('#ps-save').addEventListener('click', async () => {
            m.querySelectorAll('.ps-f').forEach(x => { r[x.dataset.k] = x.type === 'checkbox' ? x.checked : x.value.trim(); });
            m.querySelectorAll('.ps-m').forEach(x => { const v = x.value.trim(); if (v) r.materials[x.dataset.mat] = v; else delete r.materials[x.dataset.mat]; });
            if (!r.itemName) { alert('품명을 입력하세요.'); return; }
            try {
                const [savedRow] = await saveProdRows([r]);
                // 캘린더에서 연 줄은 지금 보는 작성일자가 아닐 수 있다
                const target = savedRow.sheetDate === cur ? rows : (latestRows || []);
                const i = target.findIndex(x => x.id === savedRow.id);
                if (i >= 0) target[i] = savedRow; else target.push(savedRow);
                close();
                showToast(`🏭 생산 스케줄을 ${orig ? '저장' : '추가'}했습니다.`);
                if (orig) { draw(); if (savedRow.sheetDate === latestDate()) { if (target === rows) notifyLatest(); else onChanged(target); } } else refreshDates();
            } catch (err) { alert(err.message); }
        });
    };

    // ---------- 엑셀 내보내기 ----------
    const exportXlsx = (list) => {
        const head = ['구분', '라인', '상태', '수주일', '납품예정', '포장계획', '거래처', '담당', '품목코드', '품명', '규격(L)', '수량(ea)', '박스입수', '박스량', '용기', ...MATERIAL_KEYS.map(([, l]) => l), '원부자재완비', '생산시작', '생산완료', 'LOT.NO', '출고일', '비고'];
        const data = groupsOf(list).flatMap(g => g.rows).map(r => [r.site, r.line, PROD_STATUS[r.status]?.label || r.status, r.orderDate, r.dueText || r.dueDate, r.planText || r.planDate, r.partner, r.manager, r.itemCode, r.itemName, r.spec,
            r.qty === '' ? '' : Number(r.qty), r.perBox === '' ? '' : Number(r.perBox), boxesOf(r) === '' ? '' : Math.round(boxesOf(r) * 10) / 10, r.container, ...MATERIAL_KEYS.map(([k]) => r.materials?.[k] || ''), r.matsDone ? 'O' : '', r.prodStart, r.prodEnd, r.lotNo, r.shipDate, r.notes]);
        const ws = XLSX.utils.aoa_to_sheet([head, ...data]);
        ws['!cols'] = head.map((h, i) => ({ wch: [6, 8, 10, 11, 11, 11, 18, 8, 11, 36, 7, 9, 8, 8, 18, 9, 9, 9, 9, 9, 8, 8, 8, 11, 11, 11, 11, 40][i] || 10 }));
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
            return `<tr class="grp"><td colspan="13">${esc(g.key)} — ${g.rows.length}줄 · ${fmt(q)} ea · ${fmt(b)} 박스</td></tr>`
                + g.rows.map(r => `<tr>${cell(PROD_STATUS[r.status]?.label)}${cell(md(r.orderDate))}${cell(dateOrText(r.dueDate, r.dueText))}${cell(dateOrText(r.planDate, r.planText))}${cell(`${r.partner}${r.manager ? ` / ${r.manager}` : ''}`)}${cell(r.itemName, 'name')}${cell(fmt(r.qty), 'num')}${cell(`${fmt(boxesOf(r))}${r.perBox ? ` (×${fmt(r.perBox)})` : ''}`, 'num')}${cell(r.container)}${cell(MATERIAL_KEYS.filter(([k]) => r.materials?.[k]).map(([k, l]) => `${l}:${r.materials[k]}`).join(' · '), 'small')}${cell(r.lotNo)}${cell(md(r.shipDate))}${cell(r.notes, 'small')}</tr>`).join('');
        }).join('');
        w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>생산 스케줄 ${cur}</title><style>
            @page { size: A4 landscape; margin: 8mm; } body { font-family: 'Malgun Gothic', sans-serif; font-size: 8pt; color: #000; }
            h1 { font-size: 14pt; margin: 0 0 4px; } .sub { font-size: 8pt; color: #444; margin-bottom: 6px; }
            table { width: 100%; border-collapse: collapse; table-layout: auto; } th, td { border: 0.5pt solid #555; padding: 2px 3px; vertical-align: top; }
            th { background: #e5e7eb; font-weight: 800; } .grp td { background: #eef2ff; font-weight: 800; } .num { text-align: right; white-space: nowrap; }
            .name { font-weight: 700; min-width: 160px; } .small { font-size: 7pt; } tr { page-break-inside: avoid; }
        </style></head><body><h1>대림오일 생산(포장) SCHEDULE</h1><div class="sub">작성일자 ${cur} · 출력일 ${today} · ${f.site || '본사·김포'} · ${f.status === 'ACTIVE' ? '진행 중' : f.status === 'ALL' ? '전체' : PROD_STATUS[f.status]?.label} · ${list.length}줄</div>
            <table><thead><tr><th>상태</th><th>수주</th><th>납품예정</th><th>포장계획</th><th>거래처/담당</th><th>품명</th><th>수량(ea)</th><th>박스</th><th>용기</th><th>원부자재</th><th>LOT</th><th>출고</th><th>비고</th></tr></thead><tbody>${body}</tbody></table>
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
