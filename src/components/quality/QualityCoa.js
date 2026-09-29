// 품질관리 → 원부자재관리 → 성적서(COA) 관리 (kind COA)
// 원료·부자재 입고 LOT마다 공급처 시험성적서를 받아 시험항목·규격·결과를 기록하고 파일을 첨부(COA:<id>).
import { esc } from '../../services/html.js';
import { state } from '../../services/db.js';
import { localDateStr } from '../../services/searchUtils.js';
import { listQc, saveQc, deleteQc, canDeleteQc, daysUntil } from '../../services/quality.js';
import { QC_SITES, COA_TEST_TEMPLATES, COA_JUDGE, siteOf } from '../../services/qcStandards.js';
import { attachItemPicker, printA4, printTableHtml, btn } from '../plans/planCommon.js';
import { mountAttachmentPanel } from '../AttachmentPanel.js';
import { countAttachments, removeAllAttachments } from '../../services/attachments.js';
import { INPUT_CLS, siteBadge, siteSelectHtml, inScope, scopeLabel, openModal, listCardHtml, emptyRow, inPeriod, matchesText, mountTestTable, overallJudge } from './qcCommon.js';

const JUDGE_CLS = { OK: 'bg-emerald-100 text-emerald-800', NG: 'bg-rose-600 text-white' };
const templateOfCategory = (cat) => (cat === '원료' || cat === '원액' ? '원료' : '부자재');

/** @param {HTMLElement} body @param {import('./QualityNcr.js').QcViewCtx} ctx */
export const renderCoa = async (body, ctx) => {
    const { flt, canWrite } = ctx;
    let list = [];
    try { list = await listQc('COA'); } catch (e) { body.innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(e.message)}</div>`; return; }
    const rows = list.filter(r => inScope(r, ctx) && inPeriod(r, flt) && matchesText(r, flt, ['itemName', 'itemCode', 'lot', 'supplier', 'coaNo']));
    const nAtt = await countAttachments(rows.map(r => `COA:${r.id}`)).catch(() => new Map());
    const ng = rows.filter(r => r.overall === 'NG').length;
    const noFile = rows.filter(r => !nAtt.get(`COA:${r.id}`)).length;
    body.innerHTML = listCardHtml({
        title: `원부자재 시험성적서(COA) · ${scopeLabel(ctx)}`, count: rows.length,
        extra: `<span class="text-slate-500">부적합 <b class="${ng ? 'text-rose-600' : 'text-emerald-700'}">${ng}</b>건</span><span class="text-slate-500">성적서 파일 없음 <b class="${noFile ? 'text-amber-700' : 'text-emerald-700'}">${noFile}</b>건</span>`,
        button: `<div class="flex gap-2"><button type="button" id="coa-print" class="${btn('bg-white border border-slate-300 hover:bg-slate-50 text-slate-700')}">🖨 성적서 대장</button>${canWrite ? `<button type="button" id="coa-new" class="${btn('bg-emerald-600 hover:bg-emerald-700 text-white')}">＋ 성적서 등록</button>` : ''}</div>`,
        bodyHtml: `<div class="overflow-x-auto"><table class="w-full text-xs min-w-[900px]">
            <thead class="bg-slate-50 text-slate-600"><tr>
                <th class="px-2 py-2 text-left">접수일</th><th class="px-2 py-2 text-left">사업장</th><th class="px-2 py-2 text-left">품목</th><th class="px-2 py-2 text-left">공급처</th><th class="px-2 py-2 text-left">LOT</th>
                <th class="px-2 py-2 text-left">성적서 번호</th><th class="px-2 py-2 text-left">제조 · 유효기간</th><th class="px-2 py-2 text-center">시험항목</th><th class="px-2 py-2 text-center">판정</th><th class="px-2 py-2 text-center">📎</th>
            </tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.length === 0 ? emptyRow(10, list.length ? '조건에 맞는 성적서가 없습니다.' : '아직 등록한 성적서가 없습니다. 원부자재 입고 때 공급처 성적서를 [성적서 등록]으로 남기세요.') : rows.map(r => {
                const left = daysUntil(r.expDate);
                return `<tr class="coa-row hover:bg-emerald-50/40 cursor-pointer" data-id="${esc(r.id)}">
                    <td class="px-2 py-1.5 whitespace-nowrap">${esc(r.date)}</td><td class="px-2 py-1.5">${siteBadge(r)}</td>
                    <td class="px-2 py-1.5"><div class="font-bold text-slate-800">${esc(r.itemName || '-')}</div><div class="text-[10px] text-slate-400 font-mono">${esc(r.itemCode || '')}</div></td>
                    <td class="px-2 py-1.5">${esc(r.supplier || '')}</td><td class="px-2 py-1.5 font-mono">${esc(r.lot || '')}</td><td class="px-2 py-1.5 font-mono">${esc(r.coaNo || '')}</td>
                    <td class="px-2 py-1.5">${esc(r.mfgDate || '-')} · <span class="${left !== null && left < 0 ? 'text-rose-600 font-bold' : left !== null && left <= 30 ? 'text-amber-700 font-bold' : ''}">${esc(r.expDate || '-')}${left !== null && left < 0 ? ' (경과)' : ''}</span></td>
                    <td class="px-2 py-1.5 text-center">${(r.tests || []).length}</td>
                    <td class="px-2 py-1.5 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${JUDGE_CLS[r.overall] || 'bg-slate-100 text-slate-500'}">${esc(COA_JUDGE[r.overall] || '미판정')}</span></td>
                    <td class="px-2 py-1.5 text-center font-bold ${nAtt.get(`COA:${r.id}`) ? 'text-blue-600' : 'text-amber-600'}">${nAtt.get(`COA:${r.id}`) || '없음'}</td>
                </tr>`;
            }).join('')}</tbody></table></div>`
    });
    const reload = () => renderCoa(body, ctx);
    body.querySelector('#coa-new')?.addEventListener('click', () => openCoaEditor(ctx, null, reload));
    body.querySelectorAll('.coa-row').forEach(tr => tr.addEventListener('click', () => openCoaEditor(ctx, list.find(r => r.id === tr.dataset.id), reload)));
    body.querySelector('#coa-print').addEventListener('click', () => printA4({
        title: '원부자재 시험성적서 대장', subtitle: `${scopeLabel(ctx)} · ${flt.from} ~ ${flt.to}`, meta: [['기간', `${flt.from} ~ ${flt.to}`], ['건수', `${rows.length}건`]],
        bodyHtml: printTableHtml([
            { label: '접수일', w: 20, get: (r) => r.date }, { label: '사업장', w: 12, get: (r) => QC_SITES[siteOf(r)] || '' }, { label: '품목', get: (r) => r.itemName },
            { label: '공급처', w: 26, get: (r) => r.supplier }, { label: 'LOT', w: 24, get: (r) => r.lot }, { label: '유효기간', w: 20, get: (r) => r.expDate },
            { label: '판정', w: 14, cls: 'c', get: (r) => COA_JUDGE[r.overall] || '' }, { label: '파일', w: 10, cls: 'c', get: (r) => (nAtt.get(`COA:${r.id}`) ? '있음' : '없음') }
        ], rows), approvals: []
    }));
};

export const openCoaEditor = (ctx, orig, onSaved = () => {}) => {
    const { showToast, canWrite, modal } = ctx;
    const r = orig ? JSON.parse(JSON.stringify(orig)) : { date: localDateStr(), site: ctx.site !== 'ALL' ? ctx.site : '', receiver: state.currentUser?.name || '', template: '원료', tests: COA_TEST_TEMPLATES.원료.map(t => ({ ...t })) };
    const readOnly = !canWrite;
    const m = openModal(modal, {
        title: '원부자재 시험성적서(COA)', sub: orig ? `${orig.id} · ${orig.by || ''}` : '새 성적서', maxW: 'max-w-4xl',
        bodyHtml: `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label><span class="font-bold text-slate-600">접수일 *</span><input type="date" id="c-date" value="${esc(r.date)}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">사업장 *</span>${siteSelectHtml('c-site', siteOf(r))}</label>
            <label class="col-span-2"><span class="font-bold text-slate-600">품목 * (원료·부자재 검색)</span><input id="c-item" value="${esc(r.itemName || '')}" class="${INPUT_CLS}" /><span id="c-code" class="text-[10px] text-slate-400 font-mono">${esc(r.itemCode || '')}</span></label>
            <label><span class="font-bold text-slate-600">공급처</span><input id="c-supplier" value="${esc(r.supplier || '')}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">LOT *</span><input id="c-lot" value="${esc(r.lot || '')}" class="${INPUT_CLS} font-mono" /></label>
            <label><span class="font-bold text-slate-600">성적서 번호</span><input id="c-no" value="${esc(r.coaNo || '')}" class="${INPUT_CLS} font-mono" /></label>
            <label><span class="font-bold text-slate-600">접수자</span><input id="c-receiver" value="${esc(r.receiver || '')}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">제조일</span><input type="date" id="c-mfg" value="${esc(r.mfgDate || '')}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">유효기간</span><input type="date" id="c-exp" value="${esc(r.expDate || '')}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">시험항목 서식</span><select id="c-tpl" class="${INPUT_CLS}">${Object.keys(COA_TEST_TEMPLATES).map(k => `<option value="${k}" ${r.template === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
            <label><span class="font-bold text-slate-600">종합 판정</span><select id="c-overall" class="${INPUT_CLS}"><option value="">미판정</option>${Object.entries(COA_JUDGE).map(([k, l]) => `<option value="${k}" ${r.overall === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <div class="border border-slate-200 rounded-xl p-3 space-y-1"><b class="text-slate-700">시험항목 · 규격 · 결과</b><span class="text-[11px] text-slate-400 ml-2">항목 판정을 고르면 종합 판정이 자동으로 정해집니다 (부적합 1개 이상 → 부적합).</span><div id="c-tests"></div></div>
        <label class="block"><span class="font-bold text-slate-600">비고</span><input id="c-notes" value="${esc(r.notes || '')}" class="${INPUT_CLS}" /></label>
        <div id="c-att" class="border-t border-slate-100 pt-3"></div>
        <div class="flex flex-wrap justify-between gap-2 pt-1">
            <div>${orig && canDeleteQc(orig) ? '<button type="button" id="c-del" class="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold">삭제</button>' : ''}</div>
            <div class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">닫기</button>
                ${readOnly ? '' : `<button type="button" id="c-save" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black">${orig ? '저장' : '저장하고 성적서 파일 첨부'}</button>`}</div>
        </div>`
    });
    if (readOnly) m.el.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
    const table = mountTestTable(m.$('#c-tests'), r.tests || [], { readOnly });
    m.$('#c-tests').addEventListener('change', () => { const o = overallJudge(table.getRows()); if (o) m.$('#c-overall').value = o; });
    m.$('#c-tpl').addEventListener('change', (e) => {
        if (table.getRows().some(x => x.result) && !confirm('입력한 결과가 지워집니다. 서식을 바꿀까요?')) { e.target.value = r.template || '원료'; return; }
        r.template = e.target.value;
        table.setRows(COA_TEST_TEMPLATES[r.template].map(t => ({ ...t })));
    });
    attachItemPicker(m.$('#c-item'), (it) => {
        m.$('#c-item').value = it.name; m.$('#c-code').textContent = it.code; r.itemCode = it.code; r.itemName = it.name;
        if (it.supplier && !m.$('#c-supplier').value) m.$('#c-supplier').value = it.supplier;
        const tpl = templateOfCategory(it.category);
        if (tpl !== m.$('#c-tpl').value && !table.getRows().some(x => x.result)) { m.$('#c-tpl').value = tpl; r.template = tpl; table.setRows(COA_TEST_TEMPLATES[tpl].map(t => ({ ...t }))); }
    }, (it) => ['원료', '원액', '부자재', '소모품'].includes(it.category) || !it.category);
    m.$('#c-item').addEventListener('input', () => { r.itemCode = ''; m.$('#c-code').textContent = '(목록에서 고르지 않은 품목)'; });
    mountAttachmentPanel(m.$('#c-att'), { key: orig ? `COA:${orig.id}` : '', title: '성적서 파일 (PDF·사진)' });

    m.$('#c-save')?.addEventListener('click', async (e) => {
        const tests = table.getRows();
        const rec = {
            ...r, date: m.$('#c-date').value, site: m.$('#c-site').value, itemName: m.$('#c-item').value.trim(), itemCode: r.itemCode || '', supplier: m.$('#c-supplier').value.trim(),
            lot: m.$('#c-lot').value.trim(), coaNo: m.$('#c-no').value.trim(), receiver: m.$('#c-receiver').value.trim(), mfgDate: m.$('#c-mfg').value, expDate: m.$('#c-exp').value,
            template: m.$('#c-tpl').value, tests, overall: m.$('#c-overall').value || overallJudge(tests), notes: m.$('#c-notes').value.trim()
        };
        if (!rec.date || !rec.itemName || !rec.lot) { alert('접수일·품목·LOT를 입력하세요.'); return; }
        if (!QC_SITES[rec.site]) { alert('사업장(본사·김포)을 고르세요.'); return; }
        e.target.disabled = true;
        try {
            const saved = await saveQc('COA', rec);
            showToast(orig ? '💾 성적서를 저장했습니다.' : '✅ 성적서를 등록했습니다. 성적서 파일을 첨부하세요.');
            onSaved();
            if (orig) m.close(); else openCoaEditor(ctx, saved, onSaved);
        } catch (err) { alert(err.message); e.target.disabled = false; }
    });
    m.$('#c-del')?.addEventListener('click', async () => {
        if (!confirm('이 성적서 기록을 삭제할까요? 첨부 파일도 함께 지워집니다.')) return;
        try { await removeAllAttachments(`COA:${orig.id}`); await deleteQc(orig.id); showToast('🗑️ 성적서를 삭제했습니다.'); m.close(); onSaved(); } catch (err) { alert(err.message); }
    });
};
