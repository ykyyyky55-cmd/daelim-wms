// 품질관리 → 공정관리 → 관리기준 점검 (kind PCHECK) · 작업지시서/포장작업표준서 반영 · 관리기준 설정
//   원액생산(BLEND): 윤활유 및 화학제품 관리기준 점검표, 근거 = 원액 작업지시서
//   완제품포장(PACK): 충진·포장·용기·박스·적재 관리기준 점검표, 근거 = 포장작업표준서
// 작업지시서는 권한 있는 사람만 불러오며(마스터·작업일지 관리자 = 전체, 작업지시서 사용자 = DB 함수 사본),
// 지시번호·제품명·LOT·생산량·제조일·상태만 쓴다 (원료 실명·배합비는 쓰지 않음).
import { esc } from '../../services/html.js';
import { state } from '../../services/db.js';
import { localDateStr } from '../../services/searchUtils.js';
import { getSupabase } from '../../services/supabase.js';
import { hasWorklogAccess, hasWoUserAccess } from '../../services/auth.js';
import { secure, loadSecureData } from '../../services/secureWorkOrders.js';
import { listPackStandards } from '../../services/packStandards.js';
import { listQc, saveQc, deleteQc, canDeleteQc, canConfigQc, getProcessStandard, saveProcessStandard } from '../../services/quality.js';
import { QC_SITES, PROCESS_STAGES, PCHECK_RESULTS, DEFAULT_PROCESS_STANDARDS, siteOf, stageOf } from '../../services/qcStandards.js';
import { attachItemPicker, printA4, btn, fmtQty } from '../plans/planCommon.js';
import { mountApprovalBox } from '../approval/ApprovalBox.js';
import { mountAttachmentPanel } from '../AttachmentPanel.js';
import { removeAllAttachments } from '../../services/attachments.js';
import { INPUT_CLS, siteBadge, siteSelectHtml, inScope, scopeLabel, openModal, listCardHtml, emptyRow, inPeriod, matchesText } from './qcCommon.js';
import { openNcrEditor } from './QualityNcr.js';

const PC_ROLES = ['점검', '확인'];
const RESULT_CLS = { OK: 'text-emerald-700', NG: 'text-rose-700 font-black', NA: 'text-slate-400' };
const WO_STATUS = { DRAFT: '작성 중', ISSUED: '발행', IN_PROGRESS: '생산 중', COMPLETED: '생산 완료', CANCELLED: '취소' };
const apprDoc = (r) => ({ key: `PC:${r.id}`, type: 'QC_PCHECK', title: `${PROCESS_STAGES[stageOf(r)].label} 관리기준 점검표 ${r.date} ${r.itemName || ''}`, date: r.date, roles: PC_ROLES });

// 점검 결과 집계 (적합·부적합·해당없음·미점검)
const countResults = (items = []) => items.reduce((c, it) => { c[it.result || 'NONE'] = (c[it.result || 'NONE'] || 0) + 1; return c; }, {});
const overallOf = (items = []) => (items.some(it => it.result === 'NG') ? 'NG' : items.length && items.every(it => it.result) ? 'OK' : '');

/** 작업지시서 (권한에 따라). 대외비가 아닌 칸만 돌려준다 (검사항목·분류는 원액 검사 기록·제품 규격에 쓴다) */
export const loadWorkOrders = async () => {
    const pick = (o) => ({
        id: o.id, orderNo: o.orderNo || '', productName: o.productName || '', lotNo: o.lotNo || '', prodQty: o.prodQty, prodUnit: o.prodUnit || 'D/M', mfgDate: o.mfgDate || '', status: o.status || '', productItemCode: o.productItemCode || '',
        recipeId: o.recipeId || '', category: o.category || '', subCategory: o.subCategory || '', qcItems: (o.qcItems || []).map(q => ({ no: q.no, item: q.item, standard: q.standard }))
    });
    if (hasWorklogAccess()) {
        if (!secure.loaded) await loadSecureData();
        return { list: secure.orders.map(pick), source: 'full' };
    }
    if (hasWoUserAccess()) {
        const { data, error } = await getSupabase().rpc('wms_wo_orders');
        if (error) throw new Error(`작업지시서를 불러오지 못했습니다: ${error.message}`);
        return { list: (data || []).map(row => pick({ ...(row.data || {}), id: row.id, orderNo: row.orderNo, status: row.status })), source: 'wo' };
    }
    return { list: [], source: 'none' };
};
const refSources = async (stage) => {
    if (stage === 'BLEND') {
        const { list, source } = await loadWorkOrders();
        return { source, refs: list.map(o => ({ type: 'WO', id: o.id, label: o.orderNo, itemName: o.productName, itemCode: o.productItemCode, lot: o.lotNo, sub: `${o.mfgDate || ''} · ${fmtQty(o.prodQty)} ${o.prodUnit} · ${WO_STATUS[o.status] || o.status}`, raw: o })) };
    }
    const list = await listPackStandards();
    return { source: 'full', refs: list.map(s => ({ type: 'PACKSTD', id: s.id, label: s.title || s.product || '(제목 없음)', itemName: s.product || s.title || '', itemCode: '', lot: '', sub: [s.buyer, s.category].filter(Boolean).join(' · '), raw: s })) };
};

// ---------- 관리기준 점검 목록 ----------
/** @param {HTMLElement} body @param {import('./QualityNcr.js').QcViewCtx} ctx */
export const renderProcessCheck = async (body, ctx) => {
    const { flt, canWrite, stage } = ctx;
    const S = PROCESS_STAGES[stage];
    let list = [];
    try { list = (await listQc('PCHECK')); } catch (e) { body.innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(e.message)}</div>`; return; }
    const rows = list.filter(r => inScope(r, { ...ctx, area: 'PROCESS' }) && inPeriod(r, flt) && matchesText(r, flt, ['itemName', 'lot', 'refLabel', 'process', 'inspector']));
    const ng = rows.filter(r => overallOf(r.items) === 'NG').length;
    body.innerHTML = `
    <div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-xs text-emerald-900 mb-3"><b>${esc(S.label)} 관리기준</b> — ${esc(S.desc)} 점검 근거: <b>${esc(S.ref)}</b>. 기준 항목은 [불량 유형·목표] 보기의 관리기준 설정에서 바꿀 수 있습니다(매니저).</div>
    ${listCardHtml({
        title: `${S.label} 관리기준 점검표 · ${scopeLabel(ctx)}`, count: rows.length,
        extra: `<span class="text-slate-500">부적합 <b class="${ng ? 'text-rose-600' : 'text-emerald-700'}">${ng}</b>건</span>`,
        button: canWrite ? `<button type="button" id="pc-new" class="${btn('bg-emerald-600 hover:bg-emerald-700 text-white')}">＋ 점검표 작성</button>` : '',
        bodyHtml: `<div class="overflow-x-auto"><table class="w-full text-xs min-w-[880px]">
            <thead class="bg-slate-50 text-slate-600"><tr>
                <th class="px-2 py-2 text-left">점검일</th><th class="px-2 py-2 text-left">사업장</th><th class="px-2 py-2 text-left">${esc(S.ref)}</th><th class="px-2 py-2 text-left">제품 · LOT</th><th class="px-2 py-2 text-left">공정</th>
                <th class="px-2 py-2 text-center">적합</th><th class="px-2 py-2 text-center">부적합</th><th class="px-2 py-2 text-center">미점검</th><th class="px-2 py-2 text-center">판정</th><th class="px-2 py-2 text-left">점검자</th>
            </tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.length === 0 ? emptyRow(10, list.length ? '조건에 맞는 점검표가 없습니다.' : `아직 ${S.label} 점검표가 없습니다.`) : rows.map(r => {
                const c = countResults(r.items); const o = overallOf(r.items);
                return `<tr class="pc-row hover:bg-emerald-50/40 cursor-pointer" data-id="${esc(r.id)}">
                    <td class="px-2 py-1.5 whitespace-nowrap">${esc(r.date)}</td><td class="px-2 py-1.5">${siteBadge(r)}</td>
                    <td class="px-2 py-1.5 font-bold text-slate-700">${esc(r.refLabel || '-')}</td>
                    <td class="px-2 py-1.5"><div class="font-bold text-slate-800">${esc(r.itemName || '-')}</div><div class="text-[10px] text-slate-400 font-mono">${esc(r.lot || '')}</div></td>
                    <td class="px-2 py-1.5">${esc(r.process || '')}</td>
                    <td class="px-2 py-1.5 text-center text-emerald-700 font-bold">${c.OK || 0}</td><td class="px-2 py-1.5 text-center ${c.NG ? 'text-rose-600 font-black' : 'text-slate-400'}">${c.NG || 0}</td><td class="px-2 py-1.5 text-center text-slate-500">${c.NONE || 0}</td>
                    <td class="px-2 py-1.5 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${o === 'NG' ? 'bg-rose-600 text-white' : o === 'OK' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}">${o === 'NG' ? '부적합' : o === 'OK' ? '적합' : '점검 중'}</span></td>
                    <td class="px-2 py-1.5">${esc(r.inspector || r.by || '')}</td>
                </tr>`;
            }).join('')}</tbody></table></div>`
    })}`;
    const reload = () => renderProcessCheck(body, ctx);
    body.querySelector('#pc-new')?.addEventListener('click', () => openPcheckEditor(ctx, null, {}, reload));
    body.querySelectorAll('.pc-row').forEach(tr => tr.addEventListener('click', () => openPcheckEditor(ctx, list.find(r => r.id === tr.dataset.id), {}, reload)));
};

// ---------- 작업지시서 / 포장작업표준서 반영 ----------
export const renderProcessRef = async (body, ctx) => {
    const { stage, canWrite } = ctx;
    const S = PROCESS_STAGES[stage];
    body.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm">불러오는 중…</div>';
    let refs = []; let source = 'full'; let checks = [];
    try { [{ refs, source }, checks] = await Promise.all([refSources(stage), listQc('PCHECK')]); } catch (e) { body.innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(e.message)}</div>`; return; }
    const byRef = new Map();
    checks.filter(r => stageOf(r) === stage && inScope(r, { ...ctx, area: 'PROCESS' })).forEach(r => { if (!r.refId) return; const a = byRef.get(r.refId) || []; a.push(r); byRef.set(r.refId, a); });
    const q = String(ctx.flt.q || '').trim().toLowerCase();
    const shown = refs.filter(x => !q || `${x.label} ${x.itemName} ${x.lot} ${x.sub}`.toLowerCase().includes(q)).slice(0, 300);
    const note = stage === 'BLEND' && source === 'none'
        ? '<div class="p-3 mb-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">작업지시서는 마스터·작업일지 관리자·작업지시서 사용자만 볼 수 있습니다. 점검표를 쓸 때 지시번호를 직접 입력하세요.</div>'
        : '';
    body.innerHTML = `${note}${listCardHtml({
        title: `${S.ref} 반영 · ${S.label}`, count: shown.length,
        extra: `<span class="text-slate-500">${stage === 'BLEND' ? '작업지시서마다 관리기준 점검표를 남겨 원액 품질을 확인합니다.' : '포장작업표준서마다 충진·포장·적재 기준 점검표를 남깁니다.'}</span>`,
        bodyHtml: `<div class="overflow-x-auto"><table class="w-full text-xs min-w-[820px]">
            <thead class="bg-slate-50 text-slate-600"><tr>
                <th class="px-2 py-2 text-left">${stage === 'BLEND' ? '지시번호' : '표준서'}</th><th class="px-2 py-2 text-left">제품</th><th class="px-2 py-2 text-left">${stage === 'BLEND' ? 'LOT · 제조일 · 생산량 · 상태' : '납품처 · 분류'}</th>
                <th class="px-2 py-2 text-center">점검표</th><th class="px-2 py-2 text-left">최근 점검</th><th class="px-2 py-2 text-right"></th>
            </tr></thead>
            <tbody class="divide-y divide-slate-100">${shown.length === 0 ? emptyRow(6, stage === 'BLEND' ? '불러올 작업지시서가 없습니다.' : '등록된 포장작업표준서가 없습니다.') : shown.map(x => {
                const cs = (byRef.get(x.id) || []).sort((a, b) => String(b.date).localeCompare(String(a.date)));
                const last = cs[0]; const o = last ? overallOf(last.items) : '';
                return `<tr>
                    <td class="px-2 py-1.5 font-bold text-slate-800">${esc(x.label)}</td><td class="px-2 py-1.5">${esc(x.itemName)}</td>
                    <td class="px-2 py-1.5 text-slate-600">${stage === 'BLEND' ? `<span class="font-mono">${esc(x.lot || '-')}</span> · ` : ''}${esc(x.sub)}</td>
                    <td class="px-2 py-1.5 text-center font-bold ${cs.length ? 'text-emerald-700' : 'text-amber-600'}">${cs.length || '없음'}</td>
                    <td class="px-2 py-1.5">${last ? `${esc(last.date)} <span class="${o === 'NG' ? 'text-rose-600 font-black' : 'text-emerald-700 font-bold'}">${o === 'NG' ? '부적합' : o === 'OK' ? '적합' : '점검 중'}</span>` : '-'}</td>
                    <td class="px-2 py-1.5 text-right whitespace-nowrap">
                        ${stage === 'PACK' ? `<button type="button" data-open-std="${esc(x.id)}" class="px-2 py-1 rounded-lg bg-white border border-slate-300 font-bold">표준서 열기</button>` : ''}
                        ${canWrite ? `<button type="button" data-ref="${esc(x.id)}" class="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold">점검표 작성</button>` : ''}
                    </td>
                </tr>`;
            }).join('')}</tbody></table></div>`
    })}`;
    body.querySelectorAll('[data-ref]').forEach(b => b.addEventListener('click', () => {
        const x = refs.find(r => r.id === b.dataset.ref);
        openPcheckEditor(ctx, null, { refType: x.type, refId: x.id, refLabel: x.label, itemName: x.itemName, itemCode: x.itemCode, lot: x.lot }, () => renderProcessRef(body, ctx));
    }));
    body.querySelectorAll('[data-open-std]').forEach(b => b.addEventListener('click', () => { window.__packStdOpenId = b.dataset.openStd; window.__switchTab?.('packStandard'); }));
};

// ---------- 점검표 입력 창 ----------
export const openPcheckEditor = async (ctx, orig, prefill = {}, onSaved = () => {}) => {
    const { showToast, canWrite, modal } = ctx;
    const stage = orig ? stageOf(orig) : (ctx.stage || 'PACK');
    const S = PROCESS_STAGES[stage];
    const standard = orig ? orig.items : (await getProcessStandard(stage)).map(x => ({ ...x, result: '', value: '', note: '' }));
    const r = orig ? JSON.parse(JSON.stringify(orig)) : { date: localDateStr(), site: ctx.site !== 'ALL' ? ctx.site : '', stage, inspector: state.currentUser?.name || '', items: standard, ...prefill };
    let refs = []; let refSource = 'full';
    try { ({ refs, source: refSource } = await refSources(stage)); } catch (e) { console.warn('[공정 점검] 근거 목록을 불러오지 못했습니다:', e.message); }
    const readOnly = !canWrite;
    const secs = [...new Set(r.items.map(it => it.sec))];
    const m = openModal(modal, {
        title: `${S.label} 관리기준 점검표`, sub: orig ? `${orig.id} · ${orig.by || ''}` : `근거: ${S.ref}`, maxW: 'max-w-5xl',
        bodyHtml: `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label><span class="font-bold text-slate-600">점검일 *</span><input type="date" id="p-date" value="${esc(r.date)}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">사업장 *</span>${siteSelectHtml('p-site', siteOf(r))}</label>
            <label class="col-span-2"><span class="font-bold text-slate-600">${esc(S.ref)} ${stage === 'BLEND' && refSource === 'none' ? '(지시번호 직접 입력)' : ''}</span>
                ${refs.length ? `<select id="p-ref" class="${INPUT_CLS}"><option value="">— ${esc(S.ref)} 선택 —</option>${refs.map(x => `<option value="${esc(x.id)}" ${x.id === r.refId ? 'selected' : ''}>${esc(x.label)} · ${esc(x.itemName)}${x.lot ? ` · ${esc(x.lot)}` : ''}</option>`).join('')}</select>` : `<input id="p-ref-text" value="${esc(r.refLabel || '')}" class="${INPUT_CLS}" />`}</label>
            <label class="col-span-2"><span class="font-bold text-slate-600">제품 *</span><input id="p-item" value="${esc(r.itemName || '')}" class="${INPUT_CLS}" /><span id="p-code" class="text-[10px] text-slate-400 font-mono">${esc(r.itemCode || '')}</span></label>
            <label><span class="font-bold text-slate-600">LOT</span><input id="p-lot" value="${esc(r.lot || '')}" class="${INPUT_CLS} font-mono" /></label>
            <label><span class="font-bold text-slate-600">공정·라인</span><input id="p-process" list="p-processes" value="${esc(r.process || '')}" class="${INPUT_CLS}" /><datalist id="p-processes">${S.processes.map(p => `<option value="${esc(p)}"></option>`).join('')}</datalist></label>
            <label><span class="font-bold text-slate-600">점검자</span><input id="p-inspector" value="${esc(r.inspector || '')}" class="${INPUT_CLS}" /></label>
            <div class="md:col-span-3 flex items-end gap-2 text-[11px]">${readOnly ? '' : '<button type="button" id="p-all-ok" class="px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">빈 칸 모두 적합</button>'}<span id="p-count" class="text-slate-500"></span></div>
        </div>
        <div class="border border-slate-200 rounded-xl overflow-x-auto">
            <table class="w-full text-xs min-w-[820px]">
                <thead class="bg-slate-50 text-slate-600"><tr><th class="px-2 py-1.5 text-left w-[22%]">점검 항목</th><th class="px-2 py-1.5 text-left">관리 기준</th><th class="px-2 py-1.5 text-center w-[16%]">결과</th><th class="px-2 py-1.5 text-left w-[14%]">측정값</th><th class="px-2 py-1.5 text-left w-[16%]">비고</th></tr></thead>
                <tbody>${secs.map(sec => `<tr class="bg-emerald-50/70"><td colspan="5" class="px-2 py-1 font-black text-emerald-900">${esc(sec)}</td></tr>${r.items.map((it, i) => it.sec !== sec ? '' : `
                    <tr class="border-t border-slate-100">
                        <td class="px-2 py-1.5 font-bold text-slate-800">${esc(it.text)}</td><td class="px-2 py-1.5 text-slate-600">${esc(it.std)}</td>
                        <td class="px-2 py-1.5 text-center whitespace-nowrap">${Object.entries(PCHECK_RESULTS).map(([k, l]) => `<label class="inline-flex items-center gap-0.5 mr-1 ${RESULT_CLS[k]}"><input type="radio" name="p-r-${i}" value="${k}" data-i="${i}" class="p-res" ${it.result === k ? 'checked' : ''} />${l}</label>`).join('')}</td>
                        <td class="px-2 py-1.5"><input data-v="${i}" value="${esc(it.value || '')}" class="w-full border border-slate-300 rounded px-1.5 py-1" /></td>
                        <td class="px-2 py-1.5"><input data-n="${i}" value="${esc(it.note || '')}" class="w-full border border-slate-300 rounded px-1.5 py-1" /></td>
                    </tr>`).join('')}`).join('')}</tbody>
            </table>
        </div>
        <label class="block"><span class="font-bold text-slate-600">종합 의견</span><textarea id="p-notes" rows="2" class="${INPUT_CLS}">${esc(r.notes || '')}</textarea></label>
        <div id="p-att" class="border-t border-slate-100 pt-3"></div>
        <div class="flex flex-wrap justify-between gap-2 pt-1">
            <div class="flex gap-2">${orig && canDeleteQc(orig) ? '<button type="button" id="p-del" class="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold">삭제</button>' : ''}
                ${orig ? '<button type="button" id="p-print" class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">🖨 점검표 인쇄</button>' : ''}
                ${orig && canWrite ? '<button type="button" id="p-ncr" class="px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold">부적합 → 조치보고서</button>' : ''}</div>
            <div class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">닫기</button>
                ${readOnly ? '' : `<button type="button" id="p-save" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black">${orig ? '저장' : '저장하고 결재 열기'}</button>`}</div>
        </div>`
    });
    if (readOnly) m.el.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
    const paintCount = () => { const c = countResults(r.items); m.$('#p-count').innerHTML = `적합 <b class="text-emerald-700">${c.OK || 0}</b> · 부적합 <b class="text-rose-600">${c.NG || 0}</b> · 해당없음 ${c.NA || 0} · 미점검 <b>${c.NONE || 0}</b> / ${r.items.length}항목`; };
    paintCount();
    m.el.querySelectorAll('.p-res').forEach(el => el.addEventListener('change', () => { r.items[Number(el.dataset.i)].result = el.value; paintCount(); }));
    m.el.querySelectorAll('[data-v]').forEach(el => el.addEventListener('input', () => { r.items[Number(el.dataset.v)].value = el.value; }));
    m.el.querySelectorAll('[data-n]').forEach(el => el.addEventListener('input', () => { r.items[Number(el.dataset.n)].note = el.value; }));
    m.$('#p-all-ok')?.addEventListener('click', () => {
        r.items.forEach((it, i) => { if (!it.result) { it.result = 'OK'; const el = m.el.querySelector(`input[name="p-r-${i}"][value="OK"]`); if (el) el.checked = true; } });
        paintCount();
    });
    m.$('#p-ref')?.addEventListener('change', (e) => {
        const x = refs.find(y => y.id === e.target.value);
        r.refType = x?.type || ''; r.refId = x?.id || ''; r.refLabel = x?.label || '';
        if (x) { m.$('#p-item').value = x.itemName; r.itemName = x.itemName; r.itemCode = x.itemCode; m.$('#p-code').textContent = x.itemCode || ''; if (x.lot) m.$('#p-lot').value = x.lot; }
    });
    attachItemPicker(m.$('#p-item'), (it) => { m.$('#p-item').value = it.name; m.$('#p-code').textContent = it.code; r.itemCode = it.code; r.itemName = it.name; }, (it) => ['완제품', '원액'].includes(it.category) || !it.category);
    const mountExtras = (rec) => {
        mountAttachmentPanel(m.$('#p-att'), { key: `PC:${rec.id}`, title: '첨부 (측정 기록·사진)' });
        mountApprovalBox(m.$('[data-appr]'), apprDoc(rec), { showToast });
    };
    if (orig) mountExtras(orig); else mountAttachmentPanel(m.$('#p-att'), { key: '', title: '첨부 (측정 기록·사진)' });

    const collect = () => ({
        ...r, stage, date: m.$('#p-date').value, site: m.$('#p-site').value, itemName: m.$('#p-item').value.trim(), lot: m.$('#p-lot').value.trim(),
        process: m.$('#p-process').value.trim(), inspector: m.$('#p-inspector').value.trim(), notes: m.$('#p-notes').value.trim(),
        refLabel: m.$('#p-ref-text') ? m.$('#p-ref-text').value.trim() : r.refLabel || '', refType: m.$('#p-ref-text') ? (stage === 'BLEND' ? 'WO' : 'PACKSTD') : r.refType || '',
        overall: overallOf(r.items)
    });
    m.$('#p-save')?.addEventListener('click', async (e) => {
        const rec = collect();
        if (!rec.date || !rec.itemName) { alert('점검일과 제품을 입력하세요.'); return; }
        if (!QC_SITES[rec.site]) { alert('사업장(본사·김포)을 고르세요.'); return; }
        e.target.disabled = true;
        try {
            const saved = await saveQc('PCHECK', rec);
            showToast(orig ? '💾 점검표를 저장했습니다.' : `✅ ${S.label} 점검표를 등록했습니다.${rec.overall === 'NG' ? ' 부적합 항목은 [부적합 → 조치보고서]로 조치를 남기세요.' : ''}`);
            onSaved();
            if (orig) m.close(); else openPcheckEditor(ctx, saved, {}, onSaved);
        } catch (err) { alert(err.message); e.target.disabled = false; }
    });
    m.$('#p-del')?.addEventListener('click', async () => {
        if (!confirm('이 점검표를 삭제할까요? 되돌릴 수 없습니다.')) return;
        try { await removeAllAttachments(`PC:${orig.id}`); await deleteQc(orig.id); showToast('🗑️ 점검표를 삭제했습니다.'); m.close(); onSaved(); } catch (err) { alert(err.message); }
    });
    m.$('#p-print')?.addEventListener('click', () => printPcheck({ ...orig, ...(readOnly ? {} : collect()) }));
    m.$('#p-ncr')?.addEventListener('click', () => {
        const rec = collect();
        const ng = rec.items.filter(it => it.result === 'NG');
        if (!ng.length && !confirm('부적합 항목이 없습니다. 그래도 조치보고서를 쓸까요?')) return;
        openNcrEditor({ ...ctx, area: 'PROCESS', A: ctx.A, stage }, null, {
            site: rec.site, stage, itemName: rec.itemName, itemCode: rec.itemCode, lot: rec.lot, place: rec.process,
            description: `[${S.label} 관리기준 점검 ${rec.date}${rec.refLabel ? ` · ${rec.refLabel}` : ''}] 부적합 항목\n${ng.map(it => `- ${it.sec} · ${it.text}: ${it.value || ''} ${it.note || ''}`.trim()).join('\n')}`,
            pcheckId: orig.id
        }, onSaved);
    });
};

/** 점검표 A4 인쇄 */
export const printPcheck = (r) => {
    const S = PROCESS_STAGES[stageOf(r)];
    const doc = apprDoc(r);
    const secs = [...new Set((r.items || []).map(it => it.sec))];
    const c = countResults(r.items);
    const bodyHtml = `
        <table class="grid" style="margin-bottom:3mm"><tr><th style="width:24mm">점검일</th><td>${esc(r.date)}</td><th style="width:24mm">사업장</th><td>${esc(QC_SITES[siteOf(r)] || '미지정')}</td></tr>
            <tr><th>${esc(S.ref)}</th><td>${esc(r.refLabel || '-')}</td><th>공정·라인</th><td>${esc(r.process || '-')}</td></tr>
            <tr><th>제품</th><td>${esc(r.itemName || '')}</td><th>LOT</th><td>${esc(r.lot || '-')}</td></tr></table>
        <table class="grid"><colgroup><col style="width:44mm"><col><col style="width:16mm"><col style="width:24mm"><col style="width:26mm"></colgroup>
            <thead><tr><th>점검 항목</th><th>관리 기준</th><th>결과</th><th>측정값</th><th>비고</th></tr></thead>
            <tbody>${secs.map(sec => `<tr class="day"><td colspan="5">${esc(sec)}</td></tr>${(r.items || []).filter(it => it.sec === sec).map(it => `<tr><td>${esc(it.text)}</td><td>${esc(it.std)}</td><td class="c" style="${it.result === 'NG' ? 'color:#c00;font-weight:700' : ''}">${esc(PCHECK_RESULTS[it.result] || '')}</td><td>${esc(it.value || '')}</td><td>${esc(it.note || '')}</td></tr>`).join('')}`).join('')}</tbody></table>
        <table class="grid" style="margin-top:3mm"><tr><th style="width:24mm">집계</th><td>적합 ${c.OK || 0} · 부적합 ${c.NG || 0} · 해당없음 ${c.NA || 0} · 미점검 ${c.NONE || 0}</td><th style="width:24mm">종합 판정</th><td><b>${overallOf(r.items) === 'NG' ? '부적합' : overallOf(r.items) === 'OK' ? '적합' : '점검 중'}</b></td></tr>
            <tr><th>종합 의견</th><td colspan="3">${esc(r.notes || '')}&nbsp;</td></tr></table>`;
    printA4({ title: `${S.label} 관리기준 점검표`, subtitle: `${S.label === '원액생산' ? '윤활유 및 화학제품 관리기준' : '충진·포장·용기·박스·적재 관리기준'}`, meta: [['점검자', r.inspector || ''], ['번호', r.id || '(저장 전)']], bodyHtml, approvals: doc.roles, approvalKey: r.id ? doc.key : '' });
};

// ---------- 관리기준 설정 (매니저) ----------
export const renderStandardConfig = async (host, ctx) => {
    const { stage, showToast } = ctx;
    const S = PROCESS_STAGES[stage];
    const can = canConfigQc();
    let items = await getProcessStandard(stage);
    const paint = () => {
        host.innerHTML = `
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3 text-xs">
            <h3 class="text-sm font-black text-slate-800">${esc(S.label)} 관리기준 점검 항목</h3>
            <p class="text-slate-500">점검표를 새로 쓸 때 이 항목이 채워집니다. 앱 기본값이므로 회사 기준(작업표준·규격)에 맞게 고쳐 쓰세요. ${can ? '' : '<b class="text-amber-700">바꾸기는 매니저 이상만 할 수 있습니다.</b>'}</p>
            <div class="overflow-x-auto"><table class="w-full min-w-[720px]"><thead class="bg-slate-50 text-slate-600"><tr><th class="px-1.5 py-1.5 text-left w-[18%]">구분</th><th class="px-1.5 py-1.5 text-left w-[32%]">점검 항목</th><th class="px-1.5 py-1.5 text-left">관리 기준</th><th class="w-8"></th></tr></thead>
            <tbody>${items.map((it, i) => `<tr>
                <td class="p-1"><input data-i="${i}" data-k="sec" value="${esc(it.sec)}" ${can ? '' : 'disabled'} class="w-full border border-slate-300 rounded px-1.5 py-1 font-bold" /></td>
                <td class="p-1"><input data-i="${i}" data-k="text" value="${esc(it.text)}" ${can ? '' : 'disabled'} class="w-full border border-slate-300 rounded px-1.5 py-1" /></td>
                <td class="p-1"><input data-i="${i}" data-k="std" value="${esc(it.std)}" ${can ? '' : 'disabled'} class="w-full border border-slate-300 rounded px-1.5 py-1" /></td>
                <td class="p-1 text-center">${can ? `<button type="button" data-del="${i}" class="text-rose-500 font-bold">×</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
            ${can ? `<div class="flex flex-wrap justify-between gap-2"><div class="flex gap-2"><button type="button" id="sc-add" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">＋ 항목 추가</button><button type="button" id="sc-reset" class="px-3 py-1.5 rounded-lg bg-white border border-slate-300 font-bold">기본 기준으로</button></div>
                <button type="button" id="sc-save" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black">관리기준 저장</button></div>` : ''}
        </div>`;
        host.querySelectorAll('[data-k]').forEach(el => el.addEventListener('input', () => { items[Number(el.dataset.i)][el.dataset.k] = el.value; }));
        host.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { items.splice(Number(b.dataset.del), 1); paint(); }));
        host.querySelector('#sc-add')?.addEventListener('click', () => { items.push({ sec: items.at(-1)?.sec || '기타', text: '', std: '' }); paint(); });
        host.querySelector('#sc-reset')?.addEventListener('click', () => { if (confirm('앱 기본 관리기준으로 되돌릴까요? (저장해야 반영)')) { items = DEFAULT_PROCESS_STANDARDS[stage].map(x => ({ ...x })); paint(); } });
        host.querySelector('#sc-save')?.addEventListener('click', async (e) => {
            e.target.disabled = true;
            try { await saveProcessStandard(stage, items); items = await getProcessStandard(stage); showToast(`💾 ${S.label} 관리기준을 저장했습니다.`); paint(); } catch (err) { alert(err.message); e.target.disabled = false; }
        });
    };
    paint();
};
