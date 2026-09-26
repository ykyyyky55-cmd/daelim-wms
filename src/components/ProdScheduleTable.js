import * as XLSX from 'xlsx';
import { state } from '../services/db.js';
import { searchMasterItems, localDateStr, matchesQuery } from '../services/searchUtils.js';
import { listProdSchedule, saveProdRows, deleteProdRow, newProdId, PROD_STATUS, MATERIAL_KEYS } from '../services/prodSchedule.js';
import { parseScheduleSheet } from '../services/prodScheduleParse.js';
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
    let rows = [];
    let loading = true;
    let error = '';
    const saved = (() => { try { return JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'); } catch { return {}; } })();
    const f = { site: saved.site || '', status: saved.status || 'ACTIVE', q: '' };
    const persist = () => { try { localStorage.setItem(FILTER_KEY, JSON.stringify({ site: f.site, status: f.status })); } catch { /* 저장 불가 */ } };
    const today = localDateStr();
    const soon = localDateStr(new Date(Date.now() + 7 * 86400000));

    const load = async () => {
        loading = true; error = ''; draw();
        try { rows = await listProdSchedule(); } catch (e) { error = e.message; rows = []; }
        loading = false; draw();
        onChanged(rows);
    };

    const filtered = () => rows.filter(r =>
        (!f.site || r.site === f.site)
        && (f.status === 'ALL' || (f.status === 'ACTIVE' ? r.status !== 'SHIPPED' : r.status === f.status))
        && (!f.q || matchesQuery(r, f.q, ['partner', 'manager', 'itemName', 'lotNo', 'notes', 'line', 'container'])));

    // 묶음: 진행 중인 줄은 라인별, 완료·출고대기 / 출고완료는 따로
    const groupsOf = (list) => {
        const order = [];
        const map = new Map();
        const keyOf = (r) => (r.status === 'SHIPPED' ? '출고완료' : r.status === 'DONE' ? '완료 · 출고대기' : `${r.site === '김포' ? '김포 · ' : ''}${r.line || '라인 미지정'}`);
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
        el.innerHTML = `
        <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm space-y-2.5 text-xs">
            <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-black text-sm text-slate-900 flex items-center gap-1.5"><i data-lucide="factory" class="w-4 h-4 text-indigo-600"></i>생산(포장) 스케줄표</h3>
                <span class="text-slate-500 font-bold">${loading ? '불러오는 중…' : `${list.length}줄 · 수량 ${fmt(total.qty)} ea · 박스 ${fmt(total.box)}`}</span>
                <div class="ml-auto flex flex-wrap items-center gap-1.5">
                    <button type="button" id="ps-add" class="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black flex items-center gap-1"><i data-lucide="plus" class="w-3.5 h-3.5"></i>줄 추가</button>
                    <label class="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg font-bold flex items-center gap-1 cursor-pointer"><i data-lucide="file-up" class="w-3.5 h-3.5"></i>엑셀 가져오기<input type="file" id="ps-import" accept=".xlsx,.xls,.xlsm" class="hidden" /></label>
                    <button type="button" id="ps-export" class="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg font-bold flex items-center gap-1"><i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i>엑셀 내보내기</button>
                    <button type="button" id="ps-print" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-black flex items-center gap-1"><i data-lucide="printer" class="w-3.5 h-3.5"></i>인쇄</button>
                </div>
            </div>
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
                try { await saveProdRows([next]); Object.assign(r, next); showToast(`🏭 '${r.itemName}' → ${PROD_STATUS[next.status].label}`); draw(); onChanged(rows); } catch (err) { alert(err.message); draw(); }
            });
            tr.querySelector('.ps-edit').addEventListener('click', () => openEditor(r));
            tr.querySelector('.ps-del').addEventListener('click', async () => {
                if (!confirm(`'${r.partner} · ${r.itemName}' 줄을 삭제할까요?`)) return;
                try { await deleteProdRow(r.id); rows = rows.filter(x => x !== r); draw(); onChanged(rows); } catch (err) { alert(err.message); }
            });
        });
    };

    // ---------- 입력·수정 창 ----------
    const openEditor = (orig) => {
        const r = orig ? { ...orig, materials: { ...(orig.materials || {}) } } : {
            id: newProdId(), site: f.site || '본사', line: '포장1부', status: 'PLANNED', orderDate: today, dueText: '', dueDate: '', planText: '', planDate: '',
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
                const i = rows.findIndex(x => x.id === savedRow.id);
                if (i >= 0) rows[i] = savedRow; else rows.push(savedRow);
                close();
                showToast(`🏭 생산 스케줄을 ${orig ? '저장' : '추가'}했습니다.`);
                draw();
                onChanged(rows);
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
        XLSX.utils.book_append_sheet(wb, ws, `생산스케줄_${today.replace(/-/g, '')}`);
        XLSX.writeFile(wb, `생산스케줄_${today}.xlsx`);
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
        w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>생산 스케줄 ${today}</title><style>
            @page { size: A4 landscape; margin: 8mm; } body { font-family: 'Malgun Gothic', sans-serif; font-size: 8pt; color: #000; }
            h1 { font-size: 14pt; margin: 0 0 4px; } .sub { font-size: 8pt; color: #444; margin-bottom: 6px; }
            table { width: 100%; border-collapse: collapse; table-layout: auto; } th, td { border: 0.5pt solid #555; padding: 2px 3px; vertical-align: top; }
            th { background: #e5e7eb; font-weight: 800; } .grp td { background: #eef2ff; font-weight: 800; } .num { text-align: right; white-space: nowrap; }
            .name { font-weight: 700; min-width: 160px; } .small { font-size: 7pt; } tr { page-break-inside: avoid; }
        </style></head><body><h1>대림오일 생산(포장) SCHEDULE</h1><div class="sub">출력일 ${today} · ${f.site || '본사·김포'} · ${f.status === 'ACTIVE' ? '진행 중' : f.status === 'ALL' ? '전체' : PROD_STATUS[f.status]?.label} · ${list.length}줄</div>
            <table><thead><tr><th>상태</th><th>수주</th><th>납품예정</th><th>포장계획</th><th>거래처/담당</th><th>품명</th><th>수량(ea)</th><th>박스</th><th>용기</th><th>원부자재</th><th>LOT</th><th>출고</th><th>비고</th></tr></thead><tbody>${body}</tbody></table>
            <script>window.onload = function () { setTimeout(function () { window.print(); }, 200); };<\/script></body></html>`);
        w.document.close();
    };

    // ---------- 엑셀 가져오기 (예전 날짜 시트) ----------
    const importXlsx = async (file) => {
        let wb;
        try { wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' }); } catch (e) { alert(`엑셀을 읽지 못했습니다: ${e.message}`); return; }
        const dated = wb.SheetNames.filter(n => /^\d{4}$/.test(n)).sort((a, b) => b.localeCompare(a));
        const def = dated[0] || wb.SheetNames[0];
        const name = prompt(`가져올 시트 이름을 입력하세요. (예: ${def})\n시트: ${wb.SheetNames.slice(0, 40).join(', ')}${wb.SheetNames.length > 40 ? ' …' : ''}`, def);
        if (!name) return;
        const ws = wb.Sheets[name.trim()];
        if (!ws) { alert(`'${name}' 시트가 없습니다.`); return; }
        const year = String(new Date().getFullYear());
        const sheetDate = /^\d{4}$/.test(name.trim()) ? `${year}-${name.trim().slice(0, 2)}-${name.trim().slice(2)}` : '';
        let parsed;
        try { parsed = parseScheduleSheet(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }), { sheetDate, site: f.site || '본사' }); } catch (e) { alert(e.message); return; }
        // 이미 있는 줄(거래처·품명·수량·수주일이 같음)은 건너뛴다
        const key = (r) => [r.partner, r.itemName, Number(r.qty) || 0, r.orderDate].join('|').replace(/\s/g, '');
        const have = new Set(rows.map(key));
        const fresh = parsed.filter(r => !have.has(key(r)));
        if (!fresh.length) { alert(`'${name}' 시트 ${parsed.length}줄이 모두 이미 표에 있습니다.`); return; }
        if (!confirm(`'${name}' 시트에서 ${parsed.length}줄을 읽었습니다. 이미 있는 ${parsed.length - fresh.length}줄을 빼고 새 줄 ${fresh.length}개를 추가할까요?`)) return;
        const base = Math.max(0, ...rows.map(x => Number(x.sort) || 0));
        try {
            const savedRows = await saveProdRows(fresh.map((r, i) => ({ ...r, id: newProdId(), sort: base + i + 1 })));
            rows.push(...savedRows);
            showToast(`🏭 생산 스케줄 ${savedRows.length}줄을 가져왔습니다.`);
            draw();
            onChanged(rows);
        } catch (e) { alert(e.message); }
    };

    window.__openProdScheduleRow = (id) => { const r = rows.find(x => x.id === id); if (r) openEditor(r); };
    load();
    return { reload: load };
};
