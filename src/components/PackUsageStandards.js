// ==========================================
// 원액 작업지시서 → [포장사용기준서] 탭
// ==========================================
// 완제품·라벨부착 포장 1단위(EA·BOX)당 원액(L)·부자재(개) 사용량 기준.
// 저장은 제품 BOM(wms_product_boms, services/plans.js saveBom)과 같아서 제품생산/입고의 자동 차감·생산계획 부족 계산에 그대로 쓰인다.
// meta = { kind: PRODUCT|LABEL, template(기본 양식·미확인), container: BOTTLE|PL|DM|IBC, volume(용기 1개 L), count(1단위 용기 수),
//          oilType(AA…), blendName, note, checkedBy, checkedAt }  — supabase/auth/58_pack_usage_standards.sql
import { state } from '../services/db.js';
import { esc } from '../services/html.js';
import { createIcons, icons } from '../services/icons.js';
import { loadBoms, getBoms, saveBom, deleteBoms } from '../services/plans.js';
import { canPerformAction } from '../services/auth.js';
import { OIL_TYPES } from '../services/ibcTotes.js';
import { attachItemPicker } from './plans/planCommon.js';

export const CONTAINERS = { BOTTLE: '0.1~4L 용기', PL: '20L (PL)', DM: '200L (DM)', IBC: '1000L (IBC)' };
const CONTAINER_VOL = { PL: 20, DM: 200, IBC: 1000 };
export const SLOTS = { container: '용기', cap: '캡', label: '라벨', inbox: '인박스', outbox: '아웃박스', etc: '기타' };
const OIL_LABEL = { ...Object.fromEntries(OIL_TYPES.map(t => [t.key, t.label])), AM: '기타', '': '미분류' };
const OIL_ORDER = [...OIL_TYPES.map(t => t.key), 'AM', ''];
const CONT_ORDER = ['BOTTLE', 'PL', 'DM', 'IBC', ''];
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

// ---------- 규격에서 용량·입수 읽기 (DB 기본 양식과 같은 규칙) ----------
export const parseVolume = (spec = '', name = '') => {
    // 숫자 앞이 글자·숫자가 아니어야 용량으로 본다 ('5W30 1L'을 붙여 읽어 301L이 되지 않게 품명은 띄어쓰기를 둔 채로)
    const s = String(spec).toLowerCase().replace(/\s+/g, '');
    const n = String(name).toLowerCase();
    const num = (re, t, div = 1) => { const m = t.match(re); return m ? Number(m[1]) / div : null; };
    const ML = /(?:^|[^0-9.a-z])([0-9]+(?:\.[0-9]+)?)\s*ml/;
    const L = /(?:^|[^0-9.a-z])([0-9]+(?:\.[0-9]+)?)\s*l(?![a-wyz])/;
    const volume = num(ML, s, 1000) ?? num(L, s) ?? num(ML, n, 1000) ?? num(L, n) ?? num(/(?:^|\()([0-9]+\.[0-9]+)x/, s);
    const per = num(/[x×*]([0-9]+)개/, s) ?? num(/([0-9]+)\s*개입/, n) ?? 1;
    const sets = num(/^([0-9]+)세트/, s) ?? 1;
    return { volume, count: per * sets };
};
export const containerOf = (vol) => (!vol ? '' : vol <= 4 ? 'BOTTLE' : vol <= 25 ? 'PL' : vol <= 300 ? 'DM' : 'IBC');
const oilOf = (code) => (String(code || '').match(/^\d(A[A-Z])/) || [])[1] || '';

/** 품목 하나의 기준서 (없으면 규격으로 채운 빈 기준) */
export const standardOf = (code, boms = getBoms()) => {
    const item = state.master.find(m => m.code === code) || { code, name: code };
    const b = boms[code];
    const p = parseVolume(item.spec, item.name);
    const meta = { kind: item.category === '완제품' ? 'PRODUCT' : 'LABEL', ...(b?.meta || {}) };
    if (meta.volume === undefined) meta.volume = p.volume;
    if (meta.count === undefined) meta.count = p.count;
    if (!meta.container) meta.container = containerOf(meta.volume);
    if (meta.oilType === undefined) meta.oilType = oilOf(code);
    return { code, item, exists: !!b, rawList: b?.rawList || [], subList: b?.subList || [], meta, updatedAt: b?.updatedAt || b?.savedAt || '', updatedBy: b?.updatedBy || '' };
};
const statusOf = (s) => (!s.exists || (!s.rawList.length && !s.subList.length) ? 'EMPTY' : s.meta.template ? 'TEMPLATE' : 'CHECKED');
const STATUS = { CHECKED: ['확인됨', 'bg-emerald-50 text-emerald-700 border-emerald-200'], TEMPLATE: ['기본 양식', 'bg-amber-50 text-amber-800 border-amber-200'], EMPTY: ['비어 있음', 'bg-slate-100 text-slate-500 border-slate-200'] };
const nameOf = (code) => state.master.find(m => m.code === code)?.name || code;

/** 기준서 한 줄 요약 (제품생산/입고 검색 목록에도 씀) */
export const standardSummary = (s) => {
    const raw = s.rawList.map(r => `${nameOf(r.code)} ${fmt(r.rate)}L`).join(', ');
    const subs = s.subList.map(x => SLOTS[x.slot] || nameOf(x.code)).join('·');
    return [raw || (s.meta.volume ? `원액 미지정 (${fmt(r4(s.meta.volume * (s.meta.count || 1)))}L)` : '원액 미지정'), subs ? `부자재 ${s.subList.length}종(${subs})` : '부자재 없음'].join(' / ');
};

export const renderPackUsage = async (host, { showToast = () => {} } = {}) => {
    const canEdit = canPerformAction('PRODUCTION');
    const canDelete = canPerformAction('MRP_PLANNING');
    const f = { q: '', oil: '', cont: '', status: '', kind: 'PRODUCT' };
    const open = new Set();
    host.innerHTML = '<div class="p-10 text-center text-slate-400 font-bold">포장사용기준서를 불러오는 중...</div>';
    await loadBoms(true).catch(() => {});

    const listAll = () => {
        const boms = getBoms();
        if (f.kind === 'PRODUCT') return state.master.filter(m => m.category === '완제품').map(m => standardOf(m.code, boms));
        return Object.keys(boms).map(code => standardOf(code, boms)).filter(s => s.item.category !== '완제품' && s.item.category !== '원액' && s.item.category !== '원료');
    };

    const draw = () => {
        const all = listAll();
        const q = f.q.trim();
        const rows = all.filter(s => (!q || `${s.code} ${s.item.name} ${s.item.spec || ''}`.toLowerCase().includes(q.toLowerCase()))
            && (!f.oil || (s.meta.oilType || '_') === f.oil) &&(!f.cont || (s.meta.container || '') === f.cont) && (!f.status || statusOf(s) === f.status));
        const cnt = (st) => all.filter(s => statusOf(s) === st).length;
        const groups = new Map();
        rows.forEach(s => {
            const k = `${s.meta.oilType || ''}|${s.meta.container || ''}`;
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(s);
        });
        const keys = [...groups.keys()].sort((a, b) => {
            const [oa, ca] = a.split('|'), [ob, cb] = b.split('|');
            return (OIL_ORDER.indexOf(oa) - OIL_ORDER.indexOf(ob)) || (CONT_ORDER.indexOf(ca) - CONT_ORDER.indexOf(cb));
        });
        const expandAll = !!q || rows.length <= 40;
        let lastOil = null;
        host.innerHTML = `
        <div class="space-y-4">
            <div class="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                <div class="flex flex-wrap items-start justify-between gap-2">
                    <div>
                        <h3 class="text-base font-black text-slate-900 flex items-center gap-2"><i data-lucide="package-check" class="w-5 h-5 text-amber-600"></i>포장사용기준서</h3>
                        <p class="text-xs text-slate-500 mt-0.5">포장 1단위(EA·BOX)에 드는 원액(L)·부자재(개) 기준입니다. <b>제품생산/입고</b>에서 제품을 고르면 이 기준으로 자동 차감하고, 생산계획의 원액·부자재 부족 계산에도 쓰입니다.</p>
                    </div>
                    <div class="flex gap-1.5">
                        <div class="flex bg-slate-100 p-1 rounded-xl text-xs font-bold">
                            ${[['PRODUCT', '완제품'], ['LABEL', '라벨부착']].map(([k, l]) => `<button type="button" class="pu-kind px-3 py-1.5 rounded-lg ${f.kind === k ? 'bg-white shadow-sm text-amber-700' : 'text-slate-600'}" data-k="${k}">${l}</button>`).join('')}
                        </div>
                        ${canEdit ? '<button type="button" id="pu-new" class="px-3 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1"><i data-lucide="plus" class="w-4 h-4"></i>새 기준</button>' : ''}
                    </div>
                </div>
                <div class="flex flex-wrap gap-2 text-xs">
                    <input id="pu-q" type="search" value="${esc(f.q)}" placeholder="코드·품명 일부 (예: 5W30, 2AA400)" class="flex-1 min-w-[180px] border border-slate-300 rounded-lg px-2.5 py-2 font-bold" />
                    <select id="pu-oil" class="border border-slate-300 rounded-lg px-2 py-2 font-bold"><option value="">전체 유종</option>${OIL_ORDER.map(k => `<option value="${k || '_'}" ${f.oil === (k || '_') ? 'selected' : ''}>${esc(OIL_LABEL[k])}</option>`).join('')}</select>
                    <select id="pu-cont" class="border border-slate-300 rounded-lg px-2 py-2 font-bold"><option value="">전체 용기</option>${Object.entries(CONTAINERS).map(([k, l]) => `<option value="${k}" ${f.cont === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
                    <select id="pu-status" class="border border-slate-300 rounded-lg px-2 py-2 font-bold"><option value="">전체 상태</option>${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l} (${cnt(k)})</option>`).join('')}</select>
                </div>
                <div class="text-[11px] text-slate-500">${rows.length.toLocaleString()}건 · 확인됨 <b class="text-emerald-700">${cnt('CHECKED')}</b> · 기본 양식 <b class="text-amber-700">${cnt('TEMPLATE')}</b> (자동으로 만든 것 — 찾아서 확인·수정 후 저장하면 '확인됨') · 비어 있음 ${cnt('EMPTY')}</div>
            </div>
            <div class="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                <table class="w-full text-xs min-w-[820px]">
                    <thead class="bg-slate-50 text-slate-600"><tr><th class="p-2 text-left w-28">코드</th><th class="p-2 text-left">품명 · 규격</th><th class="p-2 text-left w-28">용기</th><th class="p-2 text-left">1단위 원액</th><th class="p-2 text-left">부자재</th><th class="p-2 w-20">상태</th><th class="p-2 w-14"></th></tr></thead>
                    <tbody>${keys.map(k => {
                        const [oil, cont] = k.split('|');
                        const list = groups.get(k);
                        const isOpen = expandAll || open.has(k);
                        const oilHead = oil !== lastOil ? `<tr class="bg-slate-800 text-white"><td colspan="7" class="px-3 py-1.5 font-black">${esc(OIL_LABEL[oil] ?? oil)} <span class="font-bold text-slate-300">(${rows.filter(s => (s.meta.oilType || '') === oil).length})</span></td></tr>` : '';
                        lastOil = oil;
                        return `${oilHead}<tr class="pu-group bg-amber-50 hover:bg-amber-100 cursor-pointer" data-g="${esc(k)}"><td colspan="7" class="px-3 py-1.5 font-black text-amber-900">${isOpen ? '▾' : '▸'} ${esc(CONTAINERS[cont] || '용기 미정')} <span class="font-bold text-amber-700">(${list.length})</span></td></tr>`
                            + (isOpen ? list.sort((a, b) => (a.meta.volume || 0) - (b.meta.volume || 0) || a.item.name.localeCompare(b.item.name, 'ko')).map(s => {
                                const st = STATUS[statusOf(s)];
                                return `<tr class="border-t border-slate-100 hover:bg-slate-50" data-code="${esc(s.code)}">
                                    <td class="p-2 font-mono text-blue-700">${esc(s.code)}</td>
                                    <td class="p-2"><b>${esc(s.item.name)}</b> <span class="text-slate-400">${esc(s.item.spec || '')} · ${esc(s.item.unit || 'EA')}</span></td>
                                    <td class="p-2 whitespace-nowrap">${s.meta.volume ? `${fmt(s.meta.volume)}L` : '-'}${(s.meta.count || 1) > 1 ? ` × ${s.meta.count}` : ''}</td>
                                    <td class="p-2">${s.rawList.map(r => `${esc(nameOf(r.code))} <b>${fmt(r.rate)}L</b>`).join('<br>') || (s.meta.kind === 'LABEL' ? '<span class="text-slate-400">-</span>' : `<span class="text-rose-600">미지정</span>${s.meta.blendName ? ` <span class="text-slate-400">(표준서: ${esc(s.meta.blendName)})</span>` : ''}`)}</td>
                                    <td class="p-2 text-slate-600">${s.subList.map(x => `${esc(SLOTS[x.slot] || '')} ${fmt(x.rate)}`).join(' · ') || '<span class="text-slate-400">없음</span>'}</td>
                                    <td class="p-2 text-center"><span class="px-1.5 py-0.5 rounded border text-[10px] font-bold ${st[1]}">${st[0]}</span></td>
                                    <td class="p-2 text-center"><button type="button" class="pu-edit px-2 py-1 rounded-md bg-slate-800 text-white font-bold">${canEdit ? '수정' : '보기'}</button></td>
                                </tr>`;
                            }).join('') : '');
                    }).join('') || '<tr><td colspan="7" class="p-8 text-center text-slate-400">조건에 맞는 기준서가 없습니다.</td></tr>'}</tbody>
                </table>
            </div>
        </div>`;
        createIcons({ icons });
        const qInp = host.querySelector('#pu-q');
        qInp.addEventListener('input', () => { f.q = qInp.value; clearTimeout(qInp._t); qInp._t = setTimeout(() => { draw(); const i = host.querySelector('#pu-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
        host.querySelector('#pu-oil').addEventListener('change', (e) => { f.oil = e.target.value; draw(); });
        host.querySelector('#pu-cont').addEventListener('change', (e) => { f.cont = e.target.value; draw(); });
        host.querySelector('#pu-status').addEventListener('change', (e) => { f.status = e.target.value; draw(); });
        host.querySelectorAll('.pu-kind').forEach(b => b.addEventListener('click', () => { f.kind = b.dataset.k; open.clear(); draw(); }));
        host.querySelectorAll('.pu-group').forEach(tr => tr.addEventListener('click', () => { const k = tr.dataset.g; if (open.has(k)) open.delete(k); else open.add(k); draw(); }));
        host.querySelectorAll('.pu-edit').forEach(b => b.addEventListener('click', () => openEditor(standardOf(b.closest('tr').dataset.code))));
        host.querySelector('#pu-new')?.addEventListener('click', () => openEditor(null));
    };

    // ---------- 편집 창 ----------
    const openEditor = (std) => {
        const isNew = !std;
        const kind = std?.meta.kind || f.kind;
        let cur = std ? { code: std.code, raw: std.rawList.map(r => ({ ...r })), sub: std.subList.map(x => ({ ...x, slot: x.slot || 'etc' })), meta: { ...std.meta } } : { code: '', raw: [], sub: [], meta: { kind, container: 'BOTTLE', volume: 1, count: 1 } };
        const box = document.createElement('div');
        box.className = 'fixed inset-0 z-[70] bg-slate-900/60 p-2 sm:p-4 overflow-y-auto flex items-start justify-center';
        document.body.appendChild(box);
        const close = () => box.remove();
        const itemPool = (m) => (kind === 'PRODUCT' ? m.category === '완제품' : m.category !== '완제품' && m.category !== '원액' && m.category !== '원료');
        const unitQty = () => r4((Number(cur.meta.volume) || 0) * (Number(cur.meta.count) || 1));
        const render = () => {
            const item = state.master.find(m => m.code === cur.code);
            box.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4 text-xs overflow-hidden">
                <div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-2">
                    <h3 class="font-black text-sm truncate">📦 포장사용기준서 ${isNew ? '새로 등록' : `· ${esc(item?.name || cur.code)}`}</h3>
                    <button type="button" class="pe-x text-slate-300 hover:text-white text-xl px-1">&times;</button>
                </div>
                <div class="p-4 space-y-4">
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                        <label class="sm:col-span-2 block"><span class="font-bold text-slate-600">${kind === 'PRODUCT' ? '완제품' : '라벨부착 품목'} (코드·품명 일부 검색)</span>
                            <input id="pe-item" type="text" ${isNew ? '' : 'disabled'} value="${esc(item ? `${item.code} ${item.name}` : cur.code)}" autocomplete="off" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2.5 py-2 font-bold disabled:bg-slate-50" placeholder="예: 2AA400, 5W30 4L" /></label>
                        <div class="text-slate-500">${item ? `규격 <b>${esc(item.spec || '-')}</b> · 단위 <b>${esc(item.unit || 'EA')}</b>` : ''}</div>
                    </div>
                    ${kind === 'PRODUCT' ? `
                    <div class="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                        <div class="font-black text-amber-900">용기 · 1단위 원액량</div>
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                            <label class="block"><span class="font-bold text-slate-600">용기 종류</span><select id="pe-cont" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold bg-white">${Object.entries(CONTAINERS).map(([k, l]) => `<option value="${k}" ${cur.meta.container === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                            <label class="block"><span class="font-bold text-slate-600">용기 1개 용량 (L)</span><input id="pe-vol" type="number" step="any" min="0" value="${esc(cur.meta.volume ?? '')}" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-black text-right bg-white" /></label>
                            <label class="block"><span class="font-bold text-slate-600">1단위 용기 수 (입수)</span><input id="pe-cnt" type="number" step="1" min="1" value="${esc(cur.meta.count ?? 1)}" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-black text-right bg-white" /></label>
                            <div class="text-amber-900">1단위 원액 = <b id="pe-unitqty">${fmt(unitQty())}</b> L
                                <button type="button" id="pe-apply-qty" class="mt-1 block px-2 py-1 rounded-md bg-amber-600 text-white font-bold">원액량에 적용</button></div>
                        </div>
                        <p class="text-[11px] text-amber-800">0.1~4L 용기는 용량을 직접 넣고, 20L(PL)·200L(DM)·1000L(IBC)는 고르면 용량이 채워집니다. BOX 품목은 입수(예: 12)를 넣으세요.${cur.meta.blendName ? ` · 포장작업표준서 사용 원액: <b>${esc(cur.meta.blendName)}</b>` : ''}</p>
                    </div>
                    <div>
                        <div class="flex items-center justify-between mb-1"><b class="text-slate-800">원액 (1단위당 L)</b>${canEdit ? '<button type="button" id="pe-add-raw" class="px-2 py-1 rounded-md border border-slate-300 font-bold">+ 원액</button>' : ''}</div>
                        <div id="pe-raws" class="space-y-1.5">${cur.raw.map((r, i) => lineHtml('raw', r, i)).join('') || '<div class="text-slate-400">원액이 없습니다. [+ 원액]으로 넣으세요.</div>'}</div>
                    </div>` : ''}
                    <div>
                        <div class="flex items-center justify-between mb-1"><b class="text-slate-800">부자재 (1단위당 개수)</b>
                            <span class="flex gap-1">${canEdit && kind === 'PRODUCT' ? '<button type="button" id="pe-find-subs" class="px-2 py-1 rounded-md border border-amber-300 text-amber-800 font-bold" title="품명이 \'제품명 + 용량\'으로 시작하는 라벨·박스를 찾아 넣습니다">제품명으로 찾기</button>' : ''}${canEdit ? '<button type="button" id="pe-add-sub" class="px-2 py-1 rounded-md border border-slate-300 font-bold">+ 부자재</button>' : ''}</span></div>
                        <div id="pe-subs" class="space-y-1.5">${cur.sub.map((x, i) => lineHtml('sub', x, i)).join('') || '<div class="text-slate-400">부자재가 없습니다.</div>'}</div>
                        <p class="mt-1 text-[11px] text-slate-500">아웃박스처럼 여러 개를 한 번에 담는 것은 1단위당 수(예: 12개입 박스 → 1/12 = 0.083333)로 넣습니다.</p>
                    </div>
                    <label class="block"><span class="font-bold text-slate-600">비고</span><textarea id="pe-note" rows="2" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5">${esc(cur.meta.note || '')}</textarea></label>
                    <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                        <span class="text-[11px] text-slate-500">${std?.updatedAt ? `마지막 저장 ${esc(new Date(std.updatedAt).toLocaleString('ko-KR'))} · ${esc(std.updatedBy || '')}` : ''}${cur.meta.template ? ' · <b class="text-amber-700">기본 양식(미확인)</b>' : ''}</span>
                        <span class="flex gap-2">
                            ${canDelete && std?.exists ? '<button type="button" id="pe-del" class="px-3 py-2 rounded-lg border border-rose-200 text-rose-600 font-bold">삭제</button>' : ''}
                            <button type="button" class="pe-x px-3 py-2 rounded-lg border border-slate-300 font-bold">닫기</button>
                            ${canEdit ? '<button type="button" id="pe-save" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-black">확인·저장</button>' : ''}
                        </span>
                    </div>
                </div></div>`;
            bind();
        };
        const lineHtml = (kindL, r, i) => `<div class="pe-line flex flex-wrap items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg p-1.5" data-l="${kindL}" data-i="${i}">
            ${kindL === 'sub' ? `<select class="pe-slot border border-slate-300 rounded px-1 py-1 font-bold bg-white">${Object.entries(SLOTS).map(([k, l]) => `<option value="${k}" ${r.slot === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
            <input type="text" class="pe-code flex-1 min-w-[180px] border border-slate-300 rounded px-2 py-1 font-bold bg-white" value="${esc(r.code ? `${r.code} ${nameOf(r.code)}` : '')}" placeholder="코드·품명 일부 검색" autocomplete="off" />
            <input type="number" step="any" min="0" class="pe-rate w-24 border border-slate-300 rounded px-2 py-1 text-right font-black bg-white" value="${esc(r.rate ?? '')}" />
            <span class="text-slate-500 w-5">${kindL === 'raw' ? 'L' : '개'}</span>
            ${canEdit ? '<button type="button" class="pe-del-line text-slate-400 hover:text-rose-600 font-black px-1">✕</button>' : ''}
        </div>`;
        const readForm = () => {
            const v = (s) => box.querySelector(s);
            if (v('#pe-cont')) { cur.meta.container = v('#pe-cont').value; cur.meta.volume = v('#pe-vol').value === '' ? null : Number(v('#pe-vol').value); cur.meta.count = Math.max(1, Number(v('#pe-cnt').value) || 1); }
            cur.meta.note = v('#pe-note').value;
            box.querySelectorAll('.pe-line').forEach(el => {
                const arr = el.dataset.l === 'raw' ? cur.raw : cur.sub;
                const row = arr[Number(el.dataset.i)];
                row.rate = el.querySelector('.pe-rate').value === '' ? '' : Number(el.querySelector('.pe-rate').value);
                if (el.dataset.l === 'sub') row.slot = el.querySelector('.pe-slot').value;
            });
        };
        const bind = () => {
            const $ = (s) => box.querySelector(s);
            box.querySelectorAll('.pe-x').forEach(b => b.addEventListener('click', close));
            if (!canEdit) { box.querySelectorAll('input, select, textarea').forEach(x => { x.disabled = true; }); return; }
            if (isNew) attachItemPicker($('#pe-item'), (m) => {
                const ex = getBoms()[m.code];
                if (ex && !confirm(`${m.name}의 기준서가 이미 있습니다. 그 기준서를 열까요?`)) return;
                close();
                if (ex) { openEditor(standardOf(m.code)); return; }
                const s = standardOf(m.code);
                cur.code = m.code; cur.meta = { ...s.meta, kind };
                openEditorWith(cur);
            }, itemPool);
            $('#pe-cont')?.addEventListener('change', (e) => { readForm(); if (CONTAINER_VOL[e.target.value]) cur.meta.volume = CONTAINER_VOL[e.target.value]; render(); });
            ['#pe-vol', '#pe-cnt'].forEach(s => $(s)?.addEventListener('input', () => { readForm(); $('#pe-unitqty').textContent = fmt(unitQty()); }));
            $('#pe-apply-qty')?.addEventListener('click', () => {
                readForm();
                if (!cur.raw.length) cur.raw.push({ code: '', rate: unitQty(), slot: 'raw' }); else cur.raw[0].rate = unitQty();
                render();
            });
            $('#pe-add-raw')?.addEventListener('click', () => { readForm(); cur.raw.push({ code: '', rate: cur.raw.length ? '' : unitQty(), slot: 'raw' }); render(); });
            $('#pe-add-sub')?.addEventListener('click', () => { readForm(); cur.sub.push({ code: '', rate: Number(cur.meta.count) || 1, slot: 'label' }); render(); });
            $('#pe-find-subs')?.addEventListener('click', () => {
                readForm();
                const item = state.master.find(m => m.code === cur.code);
                if (!item || !cur.meta.volume) { alert('품목과 용기 용량을 먼저 넣으세요.'); return; }
                const nn = item.name.toLowerCase().replace(/\s+/g, '');
                const toks = [`${nn}${Number(cur.meta.volume)}l`, `${nn}${Math.round(cur.meta.volume * 1000)}ml`];
                const found = state.master.filter(m => m.category === '부자재' && toks.some(t => m.name.toLowerCase().replace(/\s+/g, '').startsWith(t)) && !cur.sub.some(x => x.code === m.code));
                if (!found.length) { alert('품명이 \'제품명 + 용량\'으로 시작하는 부자재를 찾지 못했습니다.'); return; }
                found.forEach(m => {
                    const n = m.name.replace(/\s+/g, '');
                    const slot = /라벨/.test(n) ? 'label' : /인박스/.test(n) ? 'inbox' : /박스/.test(n) ? 'outbox' : /(용기|병|캔|페일|말통|드럼|보틀)/.test(n) ? 'container' : /캡/.test(n) ? 'cap' : 'etc';
                    const per = Number((n.match(/([0-9]+)개입/) || [])[1]) || 0;
                    const c = Number(cur.meta.count) || 1;
                    cur.sub.push({ code: m.code, rate: r4(per ? c / per : c), slot });
                });
                showToast(`🔎 부자재 ${found.length}개를 찾아 넣었습니다. 확인하세요.`);
                render();
            });
            box.querySelectorAll('.pe-line').forEach(el => {
                const arr = el.dataset.l === 'raw' ? cur.raw : cur.sub;
                const i = Number(el.dataset.i);
                attachItemPicker(el.querySelector('.pe-code'), (m) => { readForm(); arr[i].code = m.code; render(); },
                    el.dataset.l === 'raw' ? (m) => m.category === '원액' || m.category === '원료' : (m) => m.category !== '완제품' && m.category !== '원액',
                    el.dataset.l === 'raw' ? (m) => (m.category === '원액' ? 0 : 1) : (m) => (m.category === '부자재' ? 0 : 1));
                el.querySelector('.pe-del-line')?.addEventListener('click', () => { readForm(); arr.splice(i, 1); render(); });
            });
            $('#pe-del')?.addEventListener('click', async () => {
                if (!confirm('이 포장사용기준서를 삭제할까요? (제품생산/입고에서 자동 차감되지 않습니다)')) return;
                try { await deleteBoms([cur.code]); showToast('🗑️ 기준서를 삭제했습니다.'); close(); draw(); } catch (e) { alert(e.message); }
            });
            $('#pe-save')?.addEventListener('click', async (ev) => {
                readForm();
                if (!cur.code) { alert('품목을 고르세요.'); return; }
                const raw = cur.raw.filter(r => r.code && Number(r.rate) > 0).map(r => ({ code: r.code, rate: Number(r.rate), slot: 'raw' }));
                const sub = cur.sub.filter(x => x.code && Number(x.rate) > 0).map(x => ({ code: x.code, rate: Number(x.rate), slot: x.slot || 'etc' }));
                if (cur.raw.some(r => r.code && !(Number(r.rate) > 0)) || cur.sub.some(x => x.code && !(Number(x.rate) > 0))) { alert('사용량이 0이거나 비어 있는 줄이 있습니다.'); return; }
                if (!raw.length && !sub.length) { alert('원액이나 부자재를 1개 이상 넣으세요.'); return; }
                const btn = ev.currentTarget; btn.disabled = true;
                try {
                    const meta = { ...cur.meta, kind, template: false, blendName: raw[0] ? nameOf(raw[0].code) : (cur.meta.blendName || ''), checkedBy: state.currentUser?.name || state.currentGlobalWorker || '', checkedAt: new Date().toISOString() };
                    await saveBom(cur.code, raw, sub, meta);
                    showToast(`💾 ${nameOf(cur.code)} 포장사용기준서를 저장했습니다 (확인됨).`);
                    close(); draw();
                } catch (e) { alert(e.message); btn.disabled = false; }
            });
        };
        const openEditorWith = (c) => { cur = c; document.body.appendChild(box); render(); };
        render();
    };

    draw();
};
