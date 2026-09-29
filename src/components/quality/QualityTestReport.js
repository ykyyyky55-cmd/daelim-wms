// 품질관리 → 제품관리 → 제품시험성적서 (kind TEST_REPORT)
// 제품 LOT마다 시험항목·시험방법·규격·결과를 기록하고 결재(TR:<id>: 시험·검토·승인) 후 A4 시험성적서로 발행.
import { esc } from '../../services/html.js';
import { state } from '../../services/db.js';
import { localDateStr } from '../../services/searchUtils.js';
import { listQc, saveQc, deleteQc, canDeleteQc } from '../../services/quality.js';
import { QC_SITES, PRODUCT_TEST_TEMPLATES, COA_JUDGE, guessProductTemplate, siteOf } from '../../services/qcStandards.js';
import { listSpecs, listBlendTests, findSpecFor, buildItems, judgeValue, specStandards } from '../../services/qcProductSpecs.js';
import { pickSpec } from './QualityBlendTests.js';
import { attachItemPicker, printA4, btn } from '../plans/planCommon.js';
import { mountAttachmentPanel } from '../AttachmentPanel.js';
import { mountApprovalBox } from '../approval/ApprovalBox.js';
import { removeAllAttachments } from '../../services/attachments.js';
import { INPUT_CLS, siteBadge, siteSelectHtml, inScope, scopeLabel, openModal, listCardHtml, emptyRow, inPeriod, matchesText, mountTestTable, overallJudge } from './qcCommon.js';

const TR_ROLES = ['시험', '검토', '승인'];
const JUDGE_CLS = { OK: 'bg-emerald-100 text-emerald-800', NG: 'bg-rose-600 text-white' };
const apprDoc = (r) => ({ key: `TR:${r.id}`, type: 'QC_TEST_REPORT', title: `제품시험성적서 ${r.reportNo || ''} ${r.itemName || ''}`, date: r.testDate || r.date, roles: TR_ROLES });

// 성적서 번호: TR-YYMMDD-NN (같은 시험일 안에서 다음 번호)
const nextReportNo = (list, date) => {
    const prefix = `TR-${String(date || localDateStr()).replace(/-/g, '').slice(2)}-`;
    const max = list.map(r => String(r.reportNo || '')).filter(n => n.startsWith(prefix)).map(n => Number(n.slice(prefix.length)) || 0).reduce((a, b) => Math.max(a, b), 0);
    return `${prefix}${String(max + 1).padStart(2, '0')}`;
};

/** @param {HTMLElement} body @param {import('./QualityNcr.js').QcViewCtx} ctx */
export const renderTestReports = async (body, ctx) => {
    const { flt, canWrite } = ctx;
    let list = [];
    try { list = await listQc('TEST_REPORT'); } catch (e) { body.innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(e.message)}</div>`; return; }
    const rows = list.filter(r => inScope(r, ctx) && inPeriod(r, flt) && matchesText(r, flt, ['itemName', 'itemCode', 'lot', 'reportNo', 'customer', 'category', 'subCategory', 'standards']));
    const ng = rows.filter(r => r.overall === 'NG').length;
    body.innerHTML = listCardHtml({
        title: `제품시험성적서 · ${scopeLabel(ctx)}`, count: rows.length,
        extra: `<span class="text-slate-500">부적합 <b class="${ng ? 'text-rose-600' : 'text-emerald-700'}">${ng}</b>건</span>`,
        button: canWrite ? `<button type="button" id="tr-new" class="${btn('bg-emerald-600 hover:bg-emerald-700 text-white')}">＋ 시험성적서 작성</button>` : '',
        bodyHtml: `<div class="overflow-x-auto"><table class="w-full text-xs min-w-[860px]">
            <thead class="bg-slate-50 text-slate-600"><tr>
                <th class="px-2 py-2 text-left">시험일</th><th class="px-2 py-2 text-left">사업장</th><th class="px-2 py-2 text-left">성적서 번호</th><th class="px-2 py-2 text-left">제품</th><th class="px-2 py-2 text-left">LOT</th>
                <th class="px-2 py-2 text-left">제조일</th><th class="px-2 py-2 text-left">납품처</th><th class="px-2 py-2 text-center">시험항목</th><th class="px-2 py-2 text-center">종합 판정</th><th class="px-2 py-2 text-left">시험자</th>
            </tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.length === 0 ? emptyRow(10, list.length ? '조건에 맞는 시험성적서가 없습니다.' : '아직 시험성적서가 없습니다. [시험성적서 작성]으로 제품 LOT의 시험 결과를 남기세요.') : rows.map(r => `
                <tr class="tr-row hover:bg-emerald-50/40 cursor-pointer" data-id="${esc(r.id)}">
                    <td class="px-2 py-1.5 whitespace-nowrap">${esc(r.testDate || r.date)}</td><td class="px-2 py-1.5">${siteBadge(r)}</td>
                    <td class="px-2 py-1.5 font-mono font-bold text-emerald-800">${esc(r.reportNo || '')}</td>
                    <td class="px-2 py-1.5"><div class="font-bold text-slate-800">${esc(r.itemName || '-')}</div><div class="text-[10px] text-slate-400 font-mono">${esc(r.itemCode || '')}</div></td>
                    <td class="px-2 py-1.5 font-mono">${esc(r.lot || '')}</td><td class="px-2 py-1.5">${esc(r.mfgDate || '')}</td><td class="px-2 py-1.5">${esc(r.customer || '')}</td>
                    <td class="px-2 py-1.5 text-center">${(r.tests || []).length}</td>
                    <td class="px-2 py-1.5 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${JUDGE_CLS[r.overall] || 'bg-slate-100 text-slate-500'}">${esc(COA_JUDGE[r.overall] || '미판정')}</span></td>
                    <td class="px-2 py-1.5">${esc(r.tester || '')}</td>
                </tr>`).join('')}</tbody></table></div>`
    });
    const reload = () => renderTestReports(body, ctx);
    body.querySelector('#tr-new')?.addEventListener('click', () => openTestReportEditor(ctx, null, list, reload));
    body.querySelectorAll('.tr-row').forEach(tr => tr.addEventListener('click', () => openTestReportEditor(ctx, list.find(r => r.id === tr.dataset.id), list, reload)));
};

export const openTestReportEditor = (ctx, orig, list, onSaved = () => {}) => {
    const { showToast, canWrite, modal } = ctx;
    const today = localDateStr();
    const r = orig ? JSON.parse(JSON.stringify(orig)) : {
        date: today, testDate: today, site: ctx.site !== 'ALL' ? ctx.site : '', tester: state.currentUser?.name || '', template: '엔진오일',
        tests: PRODUCT_TEST_TEMPLATES.엔진오일.map(t => ({ ...t })), reportNo: nextReportNo(list, today)
    };
    const readOnly = !canWrite;
    const m = openModal(modal, {
        title: '제품시험성적서', sub: orig ? `${orig.id} · ${orig.by || ''}` : '새 성적서', maxW: 'max-w-4xl',
        bodyHtml: `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label><span class="font-bold text-slate-600">성적서 번호</span><input id="t-no" value="${esc(r.reportNo || '')}" class="${INPUT_CLS} font-mono" /></label>
            <label><span class="font-bold text-slate-600">시험일 *</span><input type="date" id="t-test" value="${esc(r.testDate || r.date)}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">사업장 *</span>${siteSelectHtml('t-site', siteOf(r))}</label>
            <label><span class="font-bold text-slate-600">시험자</span><input id="t-tester" value="${esc(r.tester || '')}" class="${INPUT_CLS}" /></label>
            <label class="col-span-2"><span class="font-bold text-slate-600">제품 * (완제품·원액 검색)</span><input id="t-item" value="${esc(r.itemName || '')}" class="${INPUT_CLS}" /><span id="t-code" class="text-[10px] text-slate-400 font-mono">${esc(r.itemCode || '')}</span></label>
            <label><span class="font-bold text-slate-600">LOT *</span><input id="t-lot" value="${esc(r.lot || '')}" class="${INPUT_CLS} font-mono" /></label>
            <label><span class="font-bold text-slate-600">제조일</span><input type="date" id="t-mfg" value="${esc(r.mfgDate || '')}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">납품처 (선택)</span><input id="t-customer" value="${esc(r.customer || '')}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">수량 (선택)</span><input id="t-qty" value="${esc(r.qty || '')}" placeholder="예: 1,000 L" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">시험항목 서식</span><select id="t-tpl" class="${INPUT_CLS}">${Object.keys(PRODUCT_TEST_TEMPLATES).map(k => `<option value="${k}" ${r.template === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
            <label><span class="font-bold text-slate-600">종합 판정</span><select id="t-overall" class="${INPUT_CLS}"><option value="">미판정</option>${Object.entries(COA_JUDGE).map(([k, l]) => `<option value="${k}" ${r.overall === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <div class="border border-slate-200 rounded-xl p-3 space-y-1">
            <div class="flex flex-wrap items-center justify-between gap-2"><div><b class="text-slate-700">시험 결과</b> <span id="t-spec-note" class="text-[11px] text-slate-500 ml-1"></span></div>
                ${readOnly ? '' : `<div class="flex flex-wrap gap-1.5"><button type="button" id="t-spec-pick" class="px-2.5 py-1 rounded-lg bg-white border border-slate-300 font-bold">🔎 제품 규격 검색</button>
                    <button type="button" id="t-btest" class="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">⤵ 원액 검사 결과 불러오기</button></div>`}</div>
            <div class="text-[11px] text-slate-400">제품을 고르면 제품 규격(KS·SAE·API·ACEA·DOT4 + 작업지시서)이 자동으로 채워지고, 숫자 규격은 결과를 넣으면 자동 판정합니다.</div>
            <div id="t-tests"></div></div>
        <label class="block"><span class="font-bold text-slate-600">비고</span><input id="t-notes" value="${esc(r.notes || '')}" class="${INPUT_CLS}" /></label>
        <div id="t-att" class="border-t border-slate-100 pt-3"></div>
        <div class="flex flex-wrap justify-between gap-2 pt-1">
            <div class="flex gap-2">${orig && canDeleteQc(orig) ? '<button type="button" id="t-del" class="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold">삭제</button>' : ''}
                ${orig ? '<button type="button" id="t-print" class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">🖨 시험성적서 발행</button>' : ''}</div>
            <div class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">닫기</button>
                ${readOnly ? '' : `<button type="button" id="t-save" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black">${orig ? '저장' : '저장하고 결재 열기'}</button>`}</div>
        </div>`
    });
    if (readOnly) m.el.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
    const table = mountTestTable(m.$('#t-tests'), r.tests || [], { readOnly });
    m.$('#t-tests').addEventListener('change', () => { const o = overallJudge(table.getRows()); if (o) m.$('#t-overall').value = o; });
    const applyTemplate = (tpl) => { r.template = tpl; m.$('#t-tpl').value = tpl; table.setRows(PRODUCT_TEST_TEMPLATES[tpl].map(t => ({ ...t }))); };
    m.$('#t-tpl').addEventListener('change', (e) => {
        if (table.getRows().some(x => x.result) && !confirm('입력한 결과가 지워집니다. 서식을 바꿀까요?')) { e.target.value = r.template; return; }
        applyTemplate(e.target.value);
    });
    // ---- 제품 규격 반영 (qcProductSpecs) ----
    let specs = [];
    const specsReady = listSpecs().then(x => { specs = x; }).catch(e => console.warn('[시험성적서] 제품 규격을 불러오지 못했습니다:', e.message));
    const paintSpecNote = () => {
        m.$('#t-spec-note').innerHTML = r.specName ? `제품 규격: <b>${esc(r.specName)}</b>${r.standards ? ` · ${esc(r.standards)}` : ''}` : '';
    };
    const applySpec = (spec, { ask = true } = {}) => {
        if (!spec) return false;
        const cur = table.getRows();
        if (ask && cur.some(x => x.result) && !confirm(`'${spec.productName}' 규격으로 시험항목을 바꿀까요? 같은 항목의 결과는 남깁니다.`)) return false;
        const keep = new Map(cur.map(x => [x.key || x.name, x]));
        table.setRows(buildItems(spec).map(it => {
            const k = keep.get(it.key) || keep.get(it.name);
            const result = k?.result || '';
            return { key: it.key, name: it.name, method: it.method, spec: it.spec, basis: it.basis, result, judge: k?.manualJudge ? k.judge : (judgeValue(result, it.spec) || k?.judge || ''), manualJudge: !!k?.manualJudge };
        }));
        r.specId = spec.id; r.specName = spec.productName; r.category = spec.category || ''; r.subCategory = spec.subCategory || '';
        r.standards = specStandards(spec);
        paintSpecNote();
        const o = overallJudge(table.getRows()); if (o) m.$('#t-overall').value = o;
        return true;
    };
    paintSpecNote();
    attachItemPicker(m.$('#t-item'), async (it) => {
        m.$('#t-item').value = it.name; m.$('#t-code').textContent = it.code; r.itemCode = it.code; r.itemName = it.name;
        await specsReady;
        const spec = findSpecFor(specs, { itemCode: it.code, itemName: it.name });
        if (spec) { applySpec(spec, { ask: table.getRows().some(x => x.result) }); showToast(`📐 '${spec.productName}' 제품 규격을 채웠습니다.`); return; }
        const tpl = guessProductTemplate(it.name);
        if (tpl !== r.template && !table.getRows().some(x => x.result)) applyTemplate(tpl); // 규격이 없으면 제품명으로 서식 짐작 (결과 입력 전만)
    }, (it) => ['완제품', '원액'].includes(it.category) || !it.category);
    m.$('#t-spec-pick')?.addEventListener('click', async () => {
        const spec = await pickSpec(m.$('#t-item').value.trim().split(/\s+/)[0] || '');
        if (spec && applySpec(spec)) {
            if (!m.$('#t-item').value.trim()) { m.$('#t-item').value = spec.productName; r.itemName = spec.productName; }
            showToast(`📐 '${spec.productName}' 제품 규격을 채웠습니다.`);
        }
    });
    // 원액 검사 기록(공정관리 → 원액생산)의 결과를 같은 항목에 채운다: 같은 LOT → 같은 제품의 최근 기록
    m.$('#t-btest')?.addEventListener('click', async () => {
        let tests = [];
        try { tests = await listBlendTests(); } catch (err) { alert(err.message); return; }
        const lot = m.$('#t-lot').value.trim(); const name = m.$('#t-item').value.trim();
        const sameProduct = (t) => (r.specId && t.specId === r.specId) || (name && findSpecFor([{ productName: t.itemName, itemCode: t.itemCode }], { itemCode: r.itemCode, itemName: name }));
        const cand = tests.filter(t => (lot && t.lot === lot) || sameProduct(t)).sort((a, b) => Number(!!(lot && b.lot === lot)) - Number(!!(lot && a.lot === lot)) || String(b.date).localeCompare(String(a.date)));
        if (!cand.length) { alert('불러올 원액 검사 기록이 없습니다. 공정관리 → 원액생산 → [원액 검사·관리도]에서 기록을 먼저 남기세요.'); return; }
        const t = cand[0];
        if (!confirm(`${t.date} · ${t.itemName} · LOT ${t.lot || '-'} 원액 검사 결과를 채울까요?${lot && t.lot !== lot ? '\n(같은 LOT 기록이 없어 같은 제품의 최근 기록입니다)' : ''}`)) return;
        const rows = table.getRows();
        let n = 0;
        (t.items || []).filter(i => String(i.result || '').trim()).forEach(i => {
            let row = rows.find(x => (x.key && x.key === i.key) || x.name === i.name);
            if (!row) { row = { key: i.key, name: i.name, method: i.method || '', spec: i.spec || '', basis: i.basis || '' }; rows.push(row); }
            row.result = i.result; row.judge = judgeValue(i.result, row.spec) || i.judge || ''; row.manualJudge = false; n++;
        });
        table.setRows(rows);
        if (!m.$('#t-lot').value.trim() && t.lot) m.$('#t-lot').value = t.lot;
        r.blendTestId = t.id;
        const o = overallJudge(table.getRows()); if (o) m.$('#t-overall').value = o;
        showToast(`⤵ 원액 검사 결과 ${n}개 항목을 채웠습니다.`);
    });
    m.$('#t-item').addEventListener('input', () => { r.itemCode = ''; m.$('#t-code').textContent = '(목록에서 고르지 않은 품목)'; });
    const mountExtras = (rec) => {
        mountAttachmentPanel(m.$('#t-att'), { key: `TR:${rec.id}`, title: '첨부 (시험 원자료·크로마토그램 등)' });
        mountApprovalBox(m.$('[data-appr]'), apprDoc(rec), { showToast });
    };
    if (orig) mountExtras(orig); else mountAttachmentPanel(m.$('#t-att'), { key: '', title: '첨부 (시험 원자료)' });

    const collect = () => {
        const tests = table.getRows();
        return {
            ...r, reportNo: m.$('#t-no').value.trim(), testDate: m.$('#t-test').value, date: m.$('#t-test').value, site: m.$('#t-site').value, tester: m.$('#t-tester').value.trim(),
            itemName: m.$('#t-item').value.trim(), itemCode: r.itemCode || '', lot: m.$('#t-lot').value.trim(), mfgDate: m.$('#t-mfg').value, customer: m.$('#t-customer').value.trim(),
            qty: m.$('#t-qty').value.trim(), template: m.$('#t-tpl').value, tests, overall: m.$('#t-overall').value || overallJudge(tests), notes: m.$('#t-notes').value.trim()
        };
    };
    m.$('#t-save')?.addEventListener('click', async (e) => {
        const rec = collect();
        if (!rec.testDate || !rec.itemName || !rec.lot) { alert('시험일·제품·LOT를 입력하세요.'); return; }
        if (!QC_SITES[rec.site]) { alert('사업장(본사·김포)을 고르세요.'); return; }
        if (!rec.reportNo) rec.reportNo = nextReportNo(list, rec.testDate);
        e.target.disabled = true;
        try {
            const saved = await saveQc('TEST_REPORT', rec);
            showToast(orig ? '💾 시험성적서를 저장했습니다.' : '✅ 시험성적서를 등록했습니다. 결재 요청 후 [시험성적서 발행]으로 인쇄하세요.');
            onSaved();
            if (orig) m.close(); else openTestReportEditor(ctx, saved, list, onSaved);
        } catch (err) { alert(err.message); e.target.disabled = false; }
    });
    m.$('#t-del')?.addEventListener('click', async () => {
        if (!confirm('이 시험성적서를 삭제할까요? 되돌릴 수 없습니다.')) return;
        try { await removeAllAttachments(`TR:${orig.id}`); await deleteQc(orig.id); showToast('🗑️ 시험성적서를 삭제했습니다.'); m.close(); onSaved(); } catch (err) { alert(err.message); }
    });
    m.$('#t-print')?.addEventListener('click', () => printTestReport({ ...orig, ...(readOnly ? {} : collect()) }));
};

/** 제품시험성적서 A4 발행 */
export const printTestReport = (r) => {
    const doc = apprDoc(r);
    const tests = r.tests || [];
    const bodyHtml = `
        <table class="grid" style="margin-bottom:3mm">
            <tr><th style="width:28mm">제품명</th><td colspan="3"><b>${esc(r.itemName || '')}</b>${r.itemCode ? ` (${esc(r.itemCode)})` : ''}</td></tr>
            <tr><th>LOT No.</th><td>${esc(r.lot || '')}</td><th style="width:28mm">제조일</th><td>${esc(r.mfgDate || '-')}</td></tr>
            <tr><th>시험일</th><td>${esc(r.testDate || r.date || '')}</td><th>성적서 번호</th><td>${esc(r.reportNo || '')}</td></tr>
            <tr><th>납품처</th><td>${esc(r.customer || '-')}</td><th>수량</th><td>${esc(r.qty || '-')}</td></tr>
        </table>
        <table class="grid">
            <colgroup><col style="width:8mm"><col><col style="width:30mm"><col style="width:34mm"><col style="width:30mm"><col style="width:16mm"></colgroup>
            <thead><tr><th>No</th><th>시험항목</th><th>시험방법</th><th>규격</th><th>결과</th><th>판정</th></tr></thead>
            <tbody>${tests.length ? tests.map((t, i) => `<tr><td class="c">${i + 1}</td><td>${esc(t.name)}</td><td class="c">${esc(t.method || '')}</td><td class="c">${esc(t.spec || '')}</td><td class="c"><b>${esc(t.result || '')}</b></td><td class="c">${esc(COA_JUDGE[t.judge] || '')}</td></tr>`).join('') : '<tr><td colspan="6" class="c">시험항목 없음</td></tr>'}</tbody>
        </table>
        ${r.standards ? `<p style="font-size:8.5pt;margin-top:1.5mm">적용 규격: ${esc(r.standards)}</p>` : ''}
        <table class="grid" style="margin-top:3mm"><tr><th style="width:28mm">종합 판정</th><td style="font-size:11pt"><b>${esc(COA_JUDGE[r.overall] || '미판정')}</b></td></tr>
            <tr><th>비고</th><td>${esc(r.notes || '')}&nbsp;</td></tr></table>
        <p style="margin-top:6mm;text-align:center;font-size:10pt">${r.overall === 'OK' ? '상기 제품은 시험 결과 규격에 적합함을 증명합니다.' : '상기 제품의 시험 결과는 위와 같습니다.'}</p>
        <p style="margin-top:4mm;text-align:center;font-size:12pt;font-weight:700;letter-spacing:2px">(주)대림오일 · 시험자 ${esc(r.tester || '')}</p>`;
    printA4({ title: '제품 시험성적서', subtitle: 'Certificate of Analysis', meta: [['사업장', QC_SITES[siteOf(r)] || '미지정']], bodyHtml, approvals: doc.roles, approvalKey: r.id ? doc.key : '' });
};
