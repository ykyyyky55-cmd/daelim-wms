// ==========================================
// 품목 및 재고관리 → ERP 코드 대응표 (탭 erpMap) — 계산·저장은 services/erpMap.js
// ==========================================
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { state } from '../services/db.js';
import { baseRole } from '../services/roles.js';
import {
    ERP_KINDS, MAP_STATUS, CONV_TYPES, loadErpData, saveErpMaps, replaceErpMaster, parseErpWorkbook,
    wmsItems, wmsPartners, wmsWarehouses, suggest, convText, mapStats, similarity, normText, isTempItem
} from '../services/erpMap.js';

const PAGE = 100;
const PREF = 'daelim_erp_map_view';
const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const STATUS_CLS = { MATCHED: 'bg-emerald-100 text-emerald-800', NO_SEND: 'bg-slate-200 text-slate-600', PENDING: 'bg-amber-100 text-amber-800' };

export const renderErpMap = (container, { showToast = () => {}, onSwitchTab = () => {} } = {}) => {
    const canEdit = ['MASTER', 'ADMIN', 'MANAGER'].includes(baseRole(state.currentUser?.role));
    let pref = {};
    try { pref = JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { /* 기본값 */ }
    const f = { tab: pref.tab || 'ITEM', status: pref.status || 'PENDING', activeOnly: pref.activeOnly !== false, category: '', q: '', page: 0 };
    const save = () => { try { localStorage.setItem(PREF, JSON.stringify({ tab: f.tab, status: f.status, activeOnly: f.activeOnly })); } catch { /* 무시 */ } };
    let masters = [], maps = new Map(), targets = { ITEM: [], PARTNER: [], WAREHOUSE: [] };
    const edits = new Map(); // id → 고친 행 (저장 전)
    let loading = true, error = '';

    const rowOf = (kind, t) => edits.get(`${kind}:${t.key}`) || maps.get(`${kind}:${t.key}`) || { kind, wmsKey: t.key, wmsName: t.name, erpCode: '', erpName: '', status: 'PENDING', erpUnit: '', conv: 'SAME', factor: '', note: '' };
    const merged = () => { const m = new Map(maps); edits.forEach((v, k) => m.set(k, v)); return m; };
    const mastersOf = (kind) => masters.filter(x => x.kind === kind);

    container.innerHTML = `
    <section class="space-y-4 text-xs">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-blue-600 flex items-center gap-1"><i data-lucide="boxes" class="w-3.5 h-3.5"></i>관리 › ERP 코드 대응표</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="link-2" class="w-5 h-5 text-blue-600"></i>ECOUNT ERP 코드 대응표</h2>
                    <p class="text-xs text-slate-500 mt-1">ERP 연동 1단계: WMS 품목·거래처·창고를 ECOUNT 코드와 1:1로 짝짓고 단위 환산을 정합니다. ECOUNT에서 내려받은 목록 엑셀을 올리면 자동으로 후보를 추천합니다. (원료코드·배합·단가는 다루지 않습니다)</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    ${canEdit ? '<label class="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer"><i data-lucide="file-up" class="w-4 h-4"></i>ECOUNT 목록 엑셀 올리기<input type="file" id="em-import" accept=".xlsx,.xls,.csv" class="hidden" /></label>' : ''}
                    <button type="button" id="em-xlsx" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center gap-1.5"><i data-lucide="file-spreadsheet" class="w-4 h-4"></i>엑셀 내보내기</button>
                    ${canEdit ? '<button type="button" id="em-save" class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black flex items-center gap-1.5 disabled:opacity-40" disabled><i data-lucide="save" class="w-4 h-4"></i>저장 <span id="em-dirty">0</span></button>' : ''}
                </div>
            </div>
            <div id="em-gate"></div>
        </div>
        <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm space-y-2">
            <div id="em-tabs" class="flex flex-wrap gap-1 border-b border-slate-200 pb-2"></div>
            <div id="em-filters" class="flex flex-wrap items-center gap-2"></div>
            <div id="em-body"></div>
        </div>
        <datalist id="em-dl-ITEM"></datalist><datalist id="em-dl-PARTNER"></datalist><datalist id="em-dl-WAREHOUSE"></datalist>
    </section>`;
    const $ = (s) => container.querySelector(s);

    const setDirty = () => {
        const b = $('#em-save');
        if (!b) return;
        b.disabled = !edits.size;
        $('#em-dirty').textContent = edits.size;
    };
    const fillDatalists = () => Object.keys(ERP_KINDS).forEach(k => {
        $(`#em-dl-${k}`).innerHTML = mastersOf(k).map(m => `<option value="${esc(m.code)}">${esc([m.name, m.spec, m.unit].filter(Boolean).join(' · '))}</option>`).join('');
    });

    // ---------- 관문·요약 ----------
    const drawGate = () => {
        const mm = merged();
        const s = Object.fromEntries(Object.keys(ERP_KINDS).map(k => [k, mapStats(targets[k], mm, k)]));
        const temp = targets.ITEM.filter(t => t.temp && t.active).length;
        const cnt = (k) => mastersOf(k).length;
        const last = masters.reduce((a, m) => (String(m.importedAt) > a ? String(m.importedAt) : a), '');
        const ok = s.ITEM.pending === 0 && s.WAREHOUSE.pending === 0;
        const bar = (k, label) => `<div class="p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div class="flex justify-between font-bold text-slate-600"><span>${label}</span><span>${Math.round(s[k].rate)}%</span></div>
            <div class="h-2 bg-slate-200 rounded-full mt-1 overflow-hidden"><div class="h-2 ${s[k].rate >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}" style="width:${Math.min(100, s[k].rate)}%"></div></div>
            <div class="text-[11px] text-slate-500 mt-1">대응 ${s[k].matched} · 보내지 않음 ${s[k].noSend} · <b class="${s[k].pending ? 'text-amber-700' : ''}">미정 ${s[k].pending}</b> / ${s[k].total}</div></div>`;
        $('#em-gate').innerHTML = `<div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            ${bar('ITEM', `품목 (${f.activeOnly ? '거래 품목' : '전체'})`)}${bar('PARTNER', '거래처 (최근 1년)')}${bar('WAREHOUSE', '창고 (13개 + 거점)')}
            <div class="p-3 rounded-xl border ${ok ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}">
                <div class="font-black ${ok ? 'text-emerald-800' : 'text-amber-800'}">${ok ? '✅ 1단계 관문 통과' : '⏳ 1단계 관문'}</div>
                <div class="text-[11px] text-slate-600 mt-0.5">거래 품목·창고가 모두 대응표에 있음 · 임시코드 품목 <b class="${temp ? 'text-rose-600' : ''}">${temp}개</b> 남음</div>
                <div class="text-[11px] text-slate-500 mt-1">ECOUNT 목록: 품목 ${cnt('ITEM')} · 거래처 ${cnt('PARTNER')} · 창고 ${cnt('WAREHOUSE')}${last ? ` (${new Date(last).toLocaleDateString('ko-KR')} 올림)` : ' — 아직 안 올림'}</div>
            </div></div>`;
    };

    // ---------- 목록 ----------
    const TABS = [['ITEM', '품목'], ['PARTNER', '거래처'], ['WAREHOUSE', '창고'], ['TEMP', '임시코드 정리']];
    const listOf = () => {
        const q = normText(f.q);
        if (f.tab === 'TEMP') return targets.ITEM.filter(t => t.temp && (!q || normText(`${t.code}${t.name}`).includes(q))).sort((a, b) => b.uses - a.uses || b.stock - a.stock);
        return targets[f.tab].filter(t => {
            const r = rowOf(f.tab, t);
            if (f.status !== 'ALL' && r.status !== f.status) return false;
            if (f.tab === 'ITEM' && f.activeOnly && !t.active) return false;
            if (f.tab === 'ITEM' && f.category && t.category !== f.category) return false;
            return !q || normText(`${t.code || ''}${t.name}${(t.names || []).join('')}${r.erpCode}${r.erpName}`).includes(q);
        }).sort((a, b) => b.uses - a.uses || String(a.name).localeCompare(String(b.name), 'ko'));
    };
    const drawFilters = () => {
        $('#em-tabs').innerHTML = TABS.map(([k, l]) => `<button type="button" class="em-tab px-3 py-1.5 rounded-lg font-black ${f.tab === k ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}" data-k="${k}">${l}</button>`).join('');
        const cats = [...new Set(targets.ITEM.map(t => t.category).filter(Boolean))].sort();
        $('#em-filters').innerHTML = f.tab === 'TEMP' ? `<input id="em-q" type="search" value="${esc(f.q)}" placeholder="코드·품명" class="flex-1 min-w-[180px] border border-slate-300 rounded-lg px-2 py-1.5" />
            <span class="text-slate-500">임시코드(0000-·HRAW-·미확정/임시) 품목은 ERP로 보내기 전에 <b>품목 마스터 → 합치기</b>로 정식 품목에 합치거나 정식 코드로 다시 등록하세요.</span>
            <button type="button" id="em-go-master" class="px-2.5 py-1.5 rounded-lg bg-slate-800 text-white font-bold">품목 마스터 열기</button>`
            : `<select id="em-status" class="border border-slate-300 rounded-lg px-2 py-1 font-bold"><option value="PENDING">미정</option><option value="MATCHED">대응</option><option value="NO_SEND">보내지 않음</option><option value="ALL">전체</option></select>
            ${f.tab === 'ITEM' ? `<label class="flex items-center gap-1 font-bold text-slate-700" title="재고가 있거나 최근 1년 수불부 전표가 있는 품목"><input type="checkbox" id="em-active" ${f.activeOnly ? 'checked' : ''} />거래 품목만</label>
            <select id="em-cat" class="border border-slate-300 rounded-lg px-2 py-1 font-bold"><option value="">모든 분류</option>${cats.map(c => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
            <input id="em-q" type="search" value="${esc(f.q)}" placeholder="코드·이름·ECOUNT 코드" class="flex-1 min-w-[180px] border border-slate-300 rounded-lg px-2 py-1.5" />
            ${canEdit ? '<button type="button" id="em-auto" class="px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-black" title="미정인 줄 중 추천 점수 90점 이상을 대응으로 채웁니다 (저장 전 확인 가능)">추천 적용 (90점 이상)</button>' : ''}`;
        if ($('#em-status')) $('#em-status').value = f.status;
        container.querySelectorAll('.em-tab').forEach(b => b.addEventListener('click', () => { f.tab = b.dataset.k; f.page = 0; f.q = ''; save(); drawFilters(); drawBody(); }));
        $('#em-status')?.addEventListener('change', (e) => { f.status = e.target.value; f.page = 0; save(); drawBody(); });
        $('#em-active')?.addEventListener('change', (e) => { f.activeOnly = e.target.checked; f.page = 0; save(); drawGate(); drawBody(); });
        $('#em-cat')?.addEventListener('change', (e) => { f.category = e.target.value; f.page = 0; drawBody(); });
        let qt = null;
        $('#em-q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { f.q = e.target.value; f.page = 0; drawBody(); }, 250); });
        $('#em-auto')?.addEventListener('click', autoApply);
        $('#em-go-master')?.addEventListener('click', () => onSwitchTab('master'));
    };

    const editRow = (kind, t, patch) => {
        const cur = rowOf(kind, t);
        const next = { ...cur, ...patch, kind, wmsKey: t.key, wmsName: t.name };
        edits.set(`${kind}:${t.key}`, next);
        setDirty();
        return next;
    };
    const applyCode = (kind, t, code) => {
        const m = mastersOf(kind).find(x => x.code === String(code).trim());
        const cur = rowOf(kind, t);
        const patch = { erpCode: String(code).trim(), erpName: m ? m.name : (code ? cur.erpName : ''), status: code ? 'MATCHED' : 'PENDING' };
        if (kind === 'ITEM' && m?.unit && !cur.erpUnit) {
            patch.erpUnit = m.unit;
            patch.conv = normText(m.unit) === normText(t.unit) ? 'SAME' : /kg/i.test(m.unit) && /^l$/i.test(t.unit) ? 'SG' : 'FACTOR';
        }
        return editRow(kind, t, patch);
    };

    const itemCells = (t, r, sugg) => `
        <td class="p-1.5 min-w-[220px]"><div class="font-mono text-[10px] text-blue-600 font-bold">${esc(t.code)}${t.temp ? ' <span class="px-1 rounded bg-rose-100 text-rose-700">임시</span>' : ''}</div><div class="font-bold text-slate-900">${esc(t.name)}</div><div class="text-[10px] text-slate-400">${esc([t.spec, t.category].filter(Boolean).join(' · '))}</div></td>
        <td class="p-1.5 text-center font-bold">${esc(t.unit)}</td>
        <td class="p-1.5 text-right text-[11px] whitespace-nowrap">${t.stock ? `재고 ${fmt(t.stock)}` : ''}<div class="text-slate-400">${t.uses ? `전표 ${t.uses}` : ''}</div></td>
        ${codeCell(r, sugg)}
        <td class="p-1.5"><input class="em-in w-16 border border-slate-300 rounded px-1 py-0.5" data-f="erpUnit" value="${esc(r.erpUnit || '')}" ${canEdit ? '' : 'disabled'} placeholder="단위" /></td>
        <td class="p-1.5 min-w-[160px]"><select class="em-in border border-slate-300 rounded px-1 py-0.5 max-w-[150px]" data-f="conv" ${canEdit ? '' : 'disabled'}>${Object.entries(CONV_TYPES).map(([k, v]) => `<option value="${k}" ${r.conv === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
            ${r.conv === 'FACTOR' ? `<input class="em-in w-16 border border-slate-300 rounded px-1 py-0.5 ml-1 text-right" data-f="factor" type="number" step="any" value="${esc(r.factor ?? '')}" ${canEdit ? '' : 'disabled'} />` : ''}
            <div class="em-conv text-[10px] ${/⚠/.test(convText(t.unit, r, t.sg)) ? 'text-rose-600 font-bold' : 'text-slate-500'}">${esc(convText(t.unit, r, t.sg))}</div></td>`;
    const codeCell = (r, sugg) => `
        <td class="p-1.5 min-w-[200px]"><input class="em-in em-code w-full border border-slate-300 rounded px-1.5 py-0.5 font-mono" data-f="erpCode" list="em-dl-${f.tab}" value="${esc(r.erpCode)}" ${canEdit ? '' : 'disabled'} placeholder="ECOUNT 코드" />
            <div class="em-erpname text-[10px] ${r.erpCode && !r.erpName ? 'text-rose-600' : 'text-slate-500'} truncate max-w-[220px]">${r.erpCode ? esc(r.erpName || 'ECOUNT 목록에 없는 코드') : ''}</div></td>
        <td class="p-1.5 min-w-[180px]">${sugg.length ? sugg.map(s => `<button type="button" class="em-sugg block w-full text-left px-1.5 py-0.5 mb-0.5 rounded border ${s.score >= 90 ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'} hover:bg-blue-50 text-[10px] truncate max-w-[220px]" data-code="${esc(s.code)}" ${canEdit ? '' : 'disabled'} title="${esc([s.code, s.name, s.spec, s.unit].filter(Boolean).join(' · '))}"><b class="font-mono">${esc(s.code)}</b> ${esc(s.name)} <span class="text-slate-400">${s.score}</span></button>`).join('') : '<span class="text-slate-300">-</span>'}</td>`;
    const tailCells = (r) => `
        <td class="p-1.5"><select class="em-in border rounded px-1 py-0.5 font-bold ${STATUS_CLS[r.status]}" data-f="status" ${canEdit ? '' : 'disabled'}>${Object.entries(MAP_STATUS).map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td class="p-1.5"><input class="em-in w-28 border border-slate-300 rounded px-1 py-0.5" data-f="note" value="${esc(r.note || '')}" ${canEdit ? '' : 'disabled'} placeholder="메모" /></td>`;

    const drawBody = () => {
        if (loading) { $('#em-body').innerHTML = '<div class="p-8 text-center text-slate-400">불러오는 중…</div>'; return; }
        if (error) { $('#em-body').innerHTML = `<div class="p-4 text-rose-600 font-bold">${esc(error)}</div>`; return; }
        const list = listOf();
        const pages = Math.max(1, Math.ceil(list.length / PAGE));
        f.page = Math.min(f.page, pages - 1);
        const view = list.slice(f.page * PAGE, (f.page + 1) * PAGE);
        const noMaster = f.tab !== 'TEMP' && !mastersOf(f.tab).length;
        let head, rows;
        if (f.tab === 'TEMP') {
            const official = state.master.filter(m => !isTempItem(m));
            head = '<th class="p-1.5 text-left">임시코드 품목</th><th class="p-1.5 text-right">재고·전표</th><th class="p-1.5 text-left">비슷한 정식 품목 (합치기 후보)</th><th class="p-1.5 text-left">ERP</th>';
            rows = view.map(t => {
                const cands = official.map(m => ({ m, s: similarity(normText(t.name), normText(m.name)) })).filter(x => x.s >= 0.5).sort((a, b) => b.s - a.s).slice(0, 3);
                const r = rowOf('ITEM', t);
                return `<tr class="align-top" data-key="${esc(t.key)}"><td class="p-1.5"><div class="font-mono text-[10px] text-rose-600 font-bold">${esc(t.code)}</div><div class="font-bold">${esc(t.name)}</div><div class="text-[10px] text-slate-400">${esc(t.category)}</div></td>
                    <td class="p-1.5 text-right text-[11px]">${t.stock ? `재고 ${fmt(t.stock)} ${esc(t.unit)}` : '<span class="text-slate-300">재고 없음</span>'}<div class="text-slate-400">${t.uses ? `전표 ${t.uses}` : ''}</div></td>
                    <td class="p-1.5">${cands.map(x => `<div class="text-[11px]"><b class="font-mono text-blue-600">${esc(x.m.code)}</b> ${esc(x.m.name)} <span class="text-slate-400">${Math.round(x.s * 100)}%</span></div>`).join('') || '<span class="text-slate-300">비슷한 품목 없음 → 정식 코드로 다시 등록</span>'}</td>
                    <td class="p-1.5"><span class="px-1.5 py-0.5 rounded font-bold ${STATUS_CLS[r.status]}">${MAP_STATUS[r.status]}</span></td></tr>`;
            }).join('');
        } else {
            head = (f.tab === 'ITEM' ? '<th class="p-1.5 text-left">WMS 품목</th><th class="p-1.5">단위</th><th class="p-1.5 text-right">사용</th>'
                : f.tab === 'PARTNER' ? '<th class="p-1.5 text-left">WMS 거래처</th><th class="p-1.5 text-right">판매·매입</th>'
                : '<th class="p-1.5 text-left">WMS 창고</th><th class="p-1.5 text-right">재고 품목</th>')
                + '<th class="p-1.5 text-left">ECOUNT 코드</th><th class="p-1.5 text-left">추천</th>' + (f.tab === 'ITEM' ? '<th class="p-1.5 text-left">ERP 단위</th><th class="p-1.5 text-left">환산</th>' : '') + '<th class="p-1.5 text-left">상태</th><th class="p-1.5 text-left">메모</th>';
            rows = view.map(t => {
                const r = rowOf(f.tab, t);
                const sugg = r.status === 'PENDING' ? suggest(f.tab, t, masters) : [];
                const first = f.tab === 'ITEM' ? itemCells(t, r, sugg)
                    : f.tab === 'PARTNER' ? `<td class="p-1.5 min-w-[200px]"><div class="font-bold text-slate-900">${esc(t.name)}</div>${t.names.length > 1 ? `<div class="text-[10px] text-slate-400">다른 표기: ${esc(t.names.filter(n => n !== t.name).join(', '))}</div>` : ''}</td>
                        <td class="p-1.5 text-right text-[11px] whitespace-nowrap">${t.sale ? `판매 ${t.sale}` : ''}${t.sale && t.buy ? ' · ' : ''}${t.buy ? `매입 ${t.buy}` : ''}</td>${codeCell(r, sugg)}`
                    : `<td class="p-1.5 min-w-[200px]"><div class="font-mono font-black text-blue-700">${esc(t.code)}</div><div class="text-slate-600">${esc(t.name)}</div></td><td class="p-1.5 text-right">${t.uses || ''}</td>${codeCell(r, sugg)}`;
                return `<tr class="align-top hover:bg-slate-50" data-key="${esc(t.key)}">${first}${tailCells(r)}</tr>`;
            }).join('');
        }
        $('#em-body').innerHTML = `${noMaster ? `<div class="p-2 mb-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 font-bold">ECOUNT ${ERP_KINDS[f.tab]} 목록을 아직 올리지 않아 추천이 없습니다. ECOUNT에서 ${ERP_KINDS[f.tab]}등록 목록을 엑셀로 내려받아 [ECOUNT 목록 엑셀 올리기]로 올리세요. 코드는 직접 입력해도 됩니다.</div>` : ''}
            <div class="overflow-auto border border-slate-200 rounded-xl max-h-[70vh]"><table class="w-full"><thead class="bg-slate-100 text-slate-600 font-bold sticky top-0 z-10"><tr>${head}</tr></thead>
            <tbody class="divide-y divide-slate-100">${rows || '<tr><td colspan="10" class="p-8 text-center text-slate-400 font-bold">조건에 맞는 줄이 없습니다.</td></tr>'}</tbody></table></div>
            <div class="flex items-center justify-between mt-2 text-slate-500"><span>${list.length}줄${pages > 1 ? ` · ${f.page + 1}/${pages}쪽` : ''}</span>
            ${pages > 1 ? `<div class="flex gap-1"><button type="button" class="em-pg px-2 py-1 border rounded" data-d="-1" ${f.page ? '' : 'disabled'}>◀</button><button type="button" class="em-pg px-2 py-1 border rounded" data-d="1" ${f.page < pages - 1 ? '' : 'disabled'}>▶</button></div>` : ''}</div>`;
        container.querySelectorAll('.em-pg').forEach(b => b.addEventListener('click', () => { f.page += Number(b.dataset.d); drawBody(); }));
        createIcons({ icons });
    };

    // 표 안 입력 (위임)
    const targetOfRow = (tr) => (f.tab === 'TEMP' ? null : targets[f.tab].find(t => t.key === tr.dataset.key));
    $('#em-body').addEventListener('change', (e) => {
        const el = e.target.closest('.em-in');
        const tr = e.target.closest('tr[data-key]');
        if (!el || !tr || !canEdit) return;
        const t = targetOfRow(tr);
        if (!t) return;
        const fld = el.dataset.f;
        if (fld === 'erpCode') applyCode(f.tab, t, el.value);
        else editRow(f.tab, t, { [fld]: fld === 'factor' ? el.value : el.value });
        drawGate();
        // 코드·환산이 바뀌면 그 줄만 다시 그림 (다른 입력칸 포커스 유지)
        if (['erpCode', 'conv', 'erpUnit', 'factor', 'status'].includes(fld)) drawBody();
    });
    $('#em-body').addEventListener('click', (e) => {
        const b = e.target.closest('.em-sugg');
        const tr = e.target.closest('tr[data-key]');
        if (!b || !tr || !canEdit) return;
        const t = targetOfRow(tr);
        if (!t) return;
        applyCode(f.tab, t, b.dataset.code);
        drawGate(); drawBody();
    });

    const autoApply = () => {
        if (f.tab === 'TEMP') return;
        let n = 0;
        targets[f.tab].filter(t => (f.tab !== 'ITEM' || !f.activeOnly || t.active) && rowOf(f.tab, t).status === 'PENDING').forEach(t => {
            const [best, second] = suggest(f.tab, t, masters, 2);
            if (best && best.score >= 90 && (!second || second.score < best.score)) { applyCode(f.tab, t, best.code); n += 1; }
        });
        drawGate(); drawBody();
        showToast(n ? `🔗 ${n}줄에 추천 코드를 채웠습니다. 확인 후 [저장]을 누르세요.` : '90점 이상이면서 후보가 하나뿐인 줄이 없습니다.');
    };

    const load = async () => {
        loading = true; error = ''; drawBody();
        try {
            const [data, partners] = await Promise.all([loadErpData(), wmsPartners()]);
            masters = data.masters;
            maps = new Map(data.maps.map(m => [`${m.kind}:${m.wmsKey}`, m]));
            targets = { ITEM: wmsItems(), PARTNER: partners, WAREHOUSE: wmsWarehouses() };
            fillDatalists();
        } catch (e) { error = e.message; }
        loading = false;
        drawGate(); drawFilters(); drawBody();
    };

    $('#em-save')?.addEventListener('click', async () => {
        const list = [...edits.values()];
        try {
            await saveErpMaps(list);
            list.forEach(r => maps.set(`${r.kind}:${r.wmsKey}`, r));
            edits.clear(); setDirty(); drawGate(); drawBody();
            showToast(`💾 대응표 ${list.length}줄을 저장했습니다.`);
        } catch (e) { alert(e.message); }
    });
    $('#em-import')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const XLSX = await import('xlsx');
            const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const res = parseErpWorkbook(XLSX, wb);
            if (!res.rows.length) throw new Error('읽은 코드가 없습니다.');
            const before = mastersOf(res.kind).length;
            if (!confirm(`ECOUNT ${ERP_KINDS[res.kind]} 목록 ${res.rows.length}건을 읽었습니다 (시트 '${res.sheetName}').\n예: ${res.rows.slice(0, 3).map(r => `${r.code} ${r.name}`).join(' / ')}\n\n${before ? `지금 올려 둔 ${ERP_KINDS[res.kind]} 목록 ${before}건을 이 목록으로 바꿉니다. ` : ''}코드·이름·규격·단위만 저장합니다. 올릴까요?`)) return;
            const n = await replaceErpMaster(res.kind, res.rows);
            showToast(`📥 ECOUNT ${ERP_KINDS[res.kind]} 목록 ${n}건을 올렸습니다. 추천이 새로 계산됩니다.`);
            f.tab = res.kind; save();
            await load();
        } catch (err) { alert(err.message); }
    });
    $('#em-xlsx').addEventListener('click', async () => {
        const XLSX = await import('xlsx');
        const mm = merged();
        const wb = XLSX.utils.book_new();
        const st = (k, t) => mm.get(`${k}:${t.key}`) || {};
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(targets.ITEM.filter(t => t.active || st('ITEM', t).erpCode).map(t => { const r = st('ITEM', t); return { WMS품목코드: t.code, 품명: t.name, 규격: t.spec, 분류: t.category, WMS단위: t.unit, 재고: t.stock, 최근1년전표: t.uses, 임시코드: t.temp ? 'Y' : '', ECOUNT코드: r.erpCode || '', ECOUNT품명: r.erpName || '', ERP단위: r.erpUnit || '', 환산: CONV_TYPES[r.conv || 'SAME'], 배수: r.factor ?? '', 비중: t.sg ?? '', 상태: MAP_STATUS[r.status || 'PENDING'], 메모: r.note || '' }; })), '품목 대응');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(targets.PARTNER.map(t => { const r = st('PARTNER', t); return { WMS거래처: t.name, 다른표기: t.names.join(', '), 판매: t.sale, 매입: t.buy, ECOUNT코드: r.erpCode || '', ECOUNT거래처명: r.erpName || '', 상태: MAP_STATUS[r.status || 'PENDING'], 메모: r.note || '' }; })), '거래처 대응');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(targets.WAREHOUSE.map(t => { const r = st('WAREHOUSE', t); return { WMS위치: t.key, 창고코드: t.code, 창고이름: t.name, ECOUNT창고코드: r.erpCode || '', ECOUNT창고명: r.erpName || '', 상태: MAP_STATUS[r.status || 'PENDING'], 메모: r.note || '' }; })), '창고 대응');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(targets.ITEM.filter(t => t.temp).map(t => ({ 코드: t.code, 품명: t.name, 분류: t.category, 재고: t.stock, 최근1년전표: t.uses }))), '임시코드');
        XLSX.writeFile(wb, `대림오일_ECOUNT_코드대응표_${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
    createIcons({ icons });
    load();
};
