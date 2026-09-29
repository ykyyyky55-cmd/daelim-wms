// 품질관리 → 불량 발생 및 조치보고서 (제품·공정·원부자재 공통, kind NCR)
// 발생 내용 → 긴급 조치·대응(영역별 선택지) → 원인 분석(4M) → 시정·예방 조치 → 효과 확인. 사진을 넣어 A4 보고서로 인쇄.
// 결재 NCR:<id> (작성·검토·승인), 사진 말고 다른 파일은 같은 키로 첨부.
import { esc } from '../../services/html.js';
import { state } from '../../services/db.js';
import { localDateStr } from '../../services/searchUtils.js';
import { listQc, saveQc, deleteQc, canDeleteQc } from '../../services/quality.js';
import { QC_SITES, PROCESS_STAGES, NCR_STATUS, NCR_STATUS_CLS, NCR_ACTIONS, NCR_4M, NCR_MAX_IMAGES, siteOf, stageOf } from '../../services/qcStandards.js';
import { attachItemPicker, printA4, fmtQty, btn } from '../plans/planCommon.js';
import { mountAttachmentPanel } from '../AttachmentPanel.js';
import { mountApprovalBox } from '../approval/ApprovalBox.js';
import { removeAllAttachments } from '../../services/attachments.js';
import { INPUT_CLS, siteBadge, siteSelectHtml, inScope, scopeLabel, shrinkImageFile, openModal, listCardHtml, emptyRow, inPeriod, matchesText } from './qcCommon.js';

const NCR_ROLES = ['작성', '검토', '승인'];
const apprDoc = (A, r) => ({ key: `NCR:${r.id}`, type: 'QC_NCR', title: `${A.label} 불량 조치보고서 ${r.date} ${r.itemName || ''}`, date: r.date, roles: NCR_ROLES });

/**
 * @typedef {Object} QcViewCtx 품질 화면이 하위 보기에 넘기는 값
 * @property {'PRODUCT'|'PROCESS'|'MATERIAL'} area
 * @property {Object} A QC_AREAS[area]
 * @property {'ALL'|'HQ'|'GIMPO'} site
 * @property {'BLEND'|'PACK'|''} stage 공정관리 단계
 * @property {{ from: string, to: string, q: string }} flt
 * @property {(msg: string) => void} showToast
 * @property {boolean} canWrite
 * @property {HTMLElement} modal
 */

/** @param {HTMLElement} body @param {QcViewCtx} ctx */
export const renderNcr = async (body, ctx) => {
    const { area, A, flt, canWrite } = ctx;
    let list = [];
    try { list = (await listQc('NCR')).filter(r => r.area === area); } catch (e) { body.innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(e.message)}</div>`; return; }
    const rows = list.filter(r => inScope(r, ctx) && inPeriod(r, flt) && matchesText(r, flt, ['itemName', 'itemCode', 'lot', 'description', 'place', 'no']));
    const open = rows.filter(r => r.status !== 'CLOSED').length;
    body.innerHTML = listCardHtml({
        title: `불량 발생 및 조치보고서 · ${scopeLabel(ctx)}`, count: rows.length,
        extra: `<span class="text-slate-500">미완료 <b class="${open ? 'text-rose-600' : 'text-emerald-700'}">${open}</b>건</span>`,
        button: canWrite ? `<button type="button" id="ncr-new" class="${btn('bg-rose-600 hover:bg-rose-700 text-white')}">＋ 조치보고서 작성</button>` : '',
        bodyHtml: `<div class="overflow-x-auto"><table class="w-full text-xs min-w-[900px]">
            <thead class="bg-slate-50 text-slate-600"><tr>
                <th class="px-2 py-2 text-left">발생일</th><th class="px-2 py-2 text-left">사업장</th><th class="px-2 py-2 text-left">품목 / LOT</th><th class="px-2 py-2 text-left">${esc(A.groupLabel)}</th>
                <th class="px-2 py-2 text-right">불량수량</th><th class="px-2 py-2 text-left">발생 내용</th><th class="px-2 py-2 text-left">긴급 조치</th><th class="px-2 py-2 text-center">사진</th><th class="px-2 py-2 text-center">상태</th><th class="px-2 py-2 text-left">담당 · 기한</th>
            </tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.length === 0 ? emptyRow(10, list.length ? '조건에 맞는 조치보고서가 없습니다.' : '아직 조치보고서가 없습니다. 불량이 생기면 [조치보고서 작성]으로 기록하세요.') : rows.map(r => `
                <tr class="ncr-row hover:bg-rose-50/40 cursor-pointer" data-id="${esc(r.id)}">
                    <td class="px-2 py-1.5 whitespace-nowrap">${esc(r.date)}</td>
                    <td class="px-2 py-1.5">${siteBadge(r)}${area === 'PROCESS' ? ` <span class="text-[10px] text-slate-500">${esc(PROCESS_STAGES[stageOf(r)].label)}</span>` : ''}</td>
                    <td class="px-2 py-1.5"><div class="font-bold text-slate-800">${esc(r.itemName || '-')}</div><div class="text-[10px] text-slate-400 font-mono">${esc(r.lot || '')}</div></td>
                    <td class="px-2 py-1.5">${esc(r.place || '')}</td>
                    <td class="px-2 py-1.5 text-right font-bold text-rose-600">${fmtQty(r.qty)} <span class="text-slate-400 font-normal">${esc(r.unit || '')}</span></td>
                    <td class="px-2 py-1.5 text-slate-700">${esc(String(r.description || '').slice(0, 40))}</td>
                    <td class="px-2 py-1.5 text-slate-600">${esc((r.actions || []).join(', ').slice(0, 30))}</td>
                    <td class="px-2 py-1.5 text-center text-blue-600 font-bold">${(r.images || []).length || ''}</td>
                    <td class="px-2 py-1.5 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${NCR_STATUS_CLS[r.status] || 'bg-slate-100'}">${esc(NCR_STATUS[r.status] || '-')}</span></td>
                    <td class="px-2 py-1.5">${esc(r.owner || '')}${r.dueDate ? ` <span class="${r.status !== 'CLOSED' && r.dueDate < localDateStr() ? 'text-rose-600 font-bold' : 'text-slate-400'}">~${esc(r.dueDate)}</span>` : ''}</td>
                </tr>`).join('')}</tbody></table></div>`
    });
    body.querySelector('#ncr-new')?.addEventListener('click', () => openNcrEditor(ctx, null, {}, () => renderNcr(body, ctx)));
    body.querySelectorAll('.ncr-row').forEach(tr => tr.addEventListener('click', () => openNcrEditor(ctx, list.find(r => r.id === tr.dataset.id), {}, () => renderNcr(body, ctx))));
};

/**
 * 조치보고서 입력 창
 * @param {QcViewCtx} ctx
 * @param {Object|null} orig 고칠 보고서 (없으면 새로)
 * @param {Object} prefill 새 보고서에 미리 채울 값 (예: 검사 기록에서 넘어온 품목·LOT·불량)
 * @param {() => void} onSaved
 */
export const openNcrEditor = (ctx, orig, prefill = {}, onSaved = () => {}) => {
    const { area, A, showToast, canWrite, modal } = ctx;
    const r = orig ? JSON.parse(JSON.stringify(orig)) : {
        date: localDateStr(), status: 'OPEN', unit: 'EA', reporter: state.currentUser?.name || '', actions: [], images: [], m4: {},
        site: ctx.site !== 'ALL' ? ctx.site : '', stage: area === 'PROCESS' ? (ctx.stage || 'PACK') : '', ...prefill
    };
    const groups = [...new Set([...(area === 'PROCESS' ? PROCESS_STAGES[r.stage || ctx.stage || 'PACK'].processes : (A.processes || []))])];
    const readOnly = !canWrite;
    const m = openModal(modal, {
        title: `${A.label} · 불량 발생 및 조치보고서`, sub: orig ? `${orig.id} · ${orig.by || ''}` : '새 보고서', maxW: 'max-w-4xl',
        bodyHtml: `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label><span class="font-bold text-slate-600">발생일 *</span><input type="date" id="n-date" value="${esc(r.date)}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">사업장 *</span>${siteSelectHtml('n-site', siteOf(r))}</label>
            ${area === 'PROCESS' ? `<label><span class="font-bold text-slate-600">공정 단계 *</span><select id="n-stage" class="${INPUT_CLS}">${Object.entries(PROCESS_STAGES).map(([k, s]) => `<option value="${k}" ${stageOf(r) === k ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>` : ''}
            <label><span class="font-bold text-slate-600">상태</span><select id="n-status" class="${INPUT_CLS}">${Object.entries(NCR_STATUS).map(([k, l]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="col-span-2"><span class="font-bold text-slate-600">품목 * (코드·이름 검색)</span><input id="n-item" value="${esc(r.itemName || '')}" class="${INPUT_CLS}" /><span id="n-code" class="text-[10px] text-slate-400 font-mono">${esc(r.itemCode || '')}</span></label>
            <label><span class="font-bold text-slate-600">LOT</span><input id="n-lot" value="${esc(r.lot || '')}" class="${INPUT_CLS} font-mono" /></label>
            <label><span class="font-bold text-slate-600">${esc(A.groupLabel)}</span><input id="n-place" list="n-places" value="${esc(r.place || '')}" class="${INPUT_CLS}" /><datalist id="n-places">${groups.map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist></label>
            <label><span class="font-bold text-slate-600">불량수량</span><input type="number" min="0" step="any" id="n-qty" value="${esc(r.qty ?? '')}" class="${INPUT_CLS} text-right" /></label>
            <label><span class="font-bold text-slate-600">단위</span><input id="n-unit" value="${esc(r.unit || 'EA')}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">발견자</span><input id="n-finder" value="${esc(r.finder || '')}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">작성자</span><input id="n-reporter" value="${esc(r.reporter || '')}" class="${INPUT_CLS}" /></label>
        </div>
        <label class="block"><span class="font-bold text-slate-600">1. 불량 발생 내용 * (현상·발견 경위·범위)</span><textarea id="n-desc" rows="3" class="${INPUT_CLS}">${esc(r.description || '')}</textarea></label>
        <div class="border border-slate-200 rounded-xl p-3 space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2"><b class="text-slate-700">2. 발생 사진 (최대 ${NCR_MAX_IMAGES}장 · 보고서에 함께 인쇄)</b>
                ${readOnly ? '' : `<label class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-bold cursor-pointer">＋ 사진 넣기<input type="file" id="n-img" accept="image/*" multiple class="hidden" /></label>`}</div>
            <div id="n-imgs" class="grid grid-cols-2 md:grid-cols-3 gap-2"></div>
        </div>
        <div class="border border-rose-100 bg-rose-50/40 rounded-xl p-3 space-y-2">
            <b class="text-rose-800">3. 긴급 조치 · 대응</b>
            <div class="flex flex-wrap gap-2">${NCR_ACTIONS[area].map(a => `<label class="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1"><input type="checkbox" class="n-act" value="${esc(a)}" ${(r.actions || []).includes(a) ? 'checked' : ''} />${esc(a)}</label>`).join('')}</div>
            <textarea id="n-immediate" rows="2" placeholder="긴급 조치 내용 (격리 수량·위치, 통보 대상 등)" class="${INPUT_CLS}">${esc(r.immediate || '')}</textarea>
        </div>
        <div class="border border-slate-200 rounded-xl p-3 space-y-2">
            <b class="text-slate-700">4. 원인 분석 (4M)</b>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">${NCR_4M.map(([k, l]) => `<label><span class="font-bold text-slate-500">${esc(l)}</span><textarea data-m4="${k}" rows="2" class="${INPUT_CLS}">${esc(r.m4?.[k] || '')}</textarea></label>`).join('')}</div>
            <label class="block"><span class="font-bold text-slate-500">근본 원인 (요약)</span><input id="n-root" value="${esc(r.rootCause || '')}" class="${INPUT_CLS}" /></label>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label><span class="font-bold text-slate-600">5. 시정 조치 (재발 방지 대책)</span><textarea id="n-corrective" rows="3" class="${INPUT_CLS}">${esc(r.corrective || '')}</textarea></label>
            <label><span class="font-bold text-slate-600">6. 예방 조치 (유사 공정·품목 확대 적용)</span><textarea id="n-preventive" rows="3" class="${INPUT_CLS}">${esc(r.preventive || '')}</textarea></label>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label><span class="font-bold text-slate-600">조치 담당</span><input id="n-owner" value="${esc(r.owner || '')}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">조치 기한</span><input type="date" id="n-due" value="${esc(r.dueDate || '')}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">완료일</span><input type="date" id="n-closed" value="${esc(r.closedDate || '')}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">효과 확인일</span><input type="date" id="n-effect-date" value="${esc(r.effectDate || '')}" class="${INPUT_CLS}" /></label>
        </div>
        <label class="block"><span class="font-bold text-slate-600">7. 효과 확인 (조치 후 재발 여부·검사 결과)</span><textarea id="n-effect" rows="2" class="${INPUT_CLS}">${esc(r.effect || '')}</textarea></label>
        <div id="n-att" class="border-t border-slate-100 pt-3"></div>
        <div class="flex flex-wrap justify-between gap-2 pt-1">
            <div class="flex gap-2">${orig && canDeleteQc(orig) ? '<button type="button" id="n-del" class="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold">삭제</button>' : ''}
                ${orig ? '<button type="button" id="n-print" class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">🖨 보고서 인쇄</button>' : ''}</div>
            <div class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">닫기</button>
                ${readOnly ? '' : `<button type="button" id="n-save" class="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-black">${orig ? '저장' : '저장하고 결재·첨부 열기'}</button>`}</div>
        </div>`
    });
    if (readOnly) m.el.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });

    // 사진: 줄여서 기록 안에 저장 (보고서 인쇄에 바로 쓰임)
    const paintImages = () => {
        m.$('#n-imgs').innerHTML = (r.images || []).length === 0 ? '<div class="col-span-full text-slate-400 py-3 text-center">사진이 없습니다.</div>' : r.images.map((img, i) => `
            <div class="border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                <img src="${img.src}" alt="" class="w-full h-32 object-contain bg-white" />
                <div class="p-1.5 flex gap-1"><input data-cap="${i}" value="${esc(img.caption || '')}" placeholder="설명" class="flex-1 border border-slate-300 rounded px-1.5 py-1" ${readOnly ? 'disabled' : ''} />
                ${readOnly ? '' : `<button type="button" data-rm="${i}" class="px-2 rounded bg-rose-50 text-rose-700 font-bold">삭제</button>`}</div>
            </div>`).join('');
        m.el.querySelectorAll('[data-cap]').forEach(inp => inp.addEventListener('input', () => { r.images[Number(inp.dataset.cap)].caption = inp.value; }));
        m.el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { r.images.splice(Number(b.dataset.rm), 1); paintImages(); }));
    };
    paintImages();
    m.$('#n-img')?.addEventListener('change', async (e) => {
        const files = [...e.target.files].slice(0, Math.max(0, NCR_MAX_IMAGES - (r.images || []).length));
        if (e.target.files.length > files.length) alert(`사진은 최대 ${NCR_MAX_IMAGES}장까지 넣을 수 있습니다.`);
        for (const f of files) {
            try { r.images.push({ src: await shrinkImageFile(f), caption: '' }); } catch (err) { alert(err.message); }
        }
        e.target.value = '';
        paintImages();
    });
    attachItemPicker(m.$('#n-item'), (it) => { m.$('#n-item').value = it.name; m.$('#n-code').textContent = it.code; r.itemCode = it.code; r.itemName = it.name; if (it.unit) m.$('#n-unit').value = it.unit; }, (it) => !A.categories || A.categories.includes(it.category) || !it.category);
    m.$('#n-item').addEventListener('input', () => { r.itemCode = ''; m.$('#n-code').textContent = '(목록에서 고르지 않은 품목)'; });
    const mountExtras = (rec) => {
        mountAttachmentPanel(m.$('#n-att'), { key: `NCR:${rec.id}`, title: '첨부 (사진 외 문서: 성적서·고객 클레임 등)' });
        mountApprovalBox(m.$('[data-appr]'), apprDoc(A, rec), { showToast });
    };
    if (orig) mountExtras(orig); else mountAttachmentPanel(m.$('#n-att'), { key: '', title: '첨부 (사진 외 문서)' });

    const collect = () => ({
        ...r, area, date: m.$('#n-date').value, site: m.$('#n-site').value, stage: area === 'PROCESS' ? m.$('#n-stage').value : '',
        status: m.$('#n-status').value, itemName: m.$('#n-item').value.trim(), itemCode: r.itemCode || '', lot: m.$('#n-lot').value.trim(), place: m.$('#n-place').value.trim(),
        qty: m.$('#n-qty').value === '' ? '' : Number(m.$('#n-qty').value), unit: m.$('#n-unit').value.trim() || 'EA', finder: m.$('#n-finder').value.trim(), reporter: m.$('#n-reporter').value.trim(),
        description: m.$('#n-desc').value.trim(), actions: [...m.el.querySelectorAll('.n-act:checked')].map(c => c.value), immediate: m.$('#n-immediate').value.trim(),
        m4: Object.fromEntries([...m.el.querySelectorAll('[data-m4]')].map(t => [t.dataset.m4, t.value.trim()])), rootCause: m.$('#n-root').value.trim(),
        corrective: m.$('#n-corrective').value.trim(), preventive: m.$('#n-preventive').value.trim(), owner: m.$('#n-owner').value.trim(), dueDate: m.$('#n-due').value,
        closedDate: m.$('#n-closed').value, effectDate: m.$('#n-effect-date').value, effect: m.$('#n-effect').value.trim()
    });
    m.$('#n-save')?.addEventListener('click', async (e) => {
        const rec = collect();
        if (!rec.date || !rec.itemName || !rec.description) { alert('발생일·품목·불량 발생 내용을 입력하세요.'); return; }
        if (!QC_SITES[rec.site]) { alert('사업장(본사·김포)을 고르세요.'); return; }
        if (rec.status === 'CLOSED' && !rec.closedDate) rec.closedDate = localDateStr();
        e.target.disabled = true;
        try {
            const saved = await saveQc('NCR', rec);
            showToast(orig ? '💾 조치보고서를 저장했습니다.' : '✅ 조치보고서를 등록했습니다. 결재 요청·첨부를 할 수 있습니다.');
            onSaved();
            if (orig) m.close(); else openNcrEditor(ctx, saved, {}, onSaved);
        } catch (err) { alert(err.message); e.target.disabled = false; }
    });
    m.$('#n-del')?.addEventListener('click', async () => {
        if (!confirm('이 조치보고서를 삭제할까요? 되돌릴 수 없습니다.')) return;
        try { await removeAllAttachments(`NCR:${orig.id}`); await deleteQc(orig.id); showToast('🗑️ 조치보고서를 삭제했습니다.'); m.close(); onSaved(); } catch (err) { alert(err.message); }
    });
    m.$('#n-print')?.addEventListener('click', () => printNcr(ctx, { ...orig, ...(readOnly ? {} : collect()) }));
};

/** 조치보고서 A4 인쇄 (사진 포함) */
export const printNcr = (ctx, r) => {
    const { A, area } = ctx;
    const doc = apprDoc(A, r);
    const row = (k, v) => `<tr><th style="width:30mm">${esc(k)}</th><td>${v}</td></tr>`;
    const text = (v) => (v ? esc(v).replace(/\n/g, '<br>') : '&nbsp;');
    const images = (r.images || []).length ? `<h2>2. 발생 사진</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:3mm">${r.images.map((img, i) => `
        <div style="border:0.3mm solid #444;padding:1.5mm;break-inside:avoid"><img src="${img.src}" style="width:100%;height:48mm;object-fit:contain;display:block" />
        <div style="font-size:8pt;margin-top:1mm">사진 ${i + 1}. ${esc(img.caption || '')}</div></div>`).join('')}</div>` : '';
    const bodyHtml = `
        <h2>1. 발생 정보</h2>
        <table class="grid">
            ${row('발생일 / 사업장', `${esc(r.date)} · ${esc(QC_SITES[siteOf(r)] || '미지정')}${area === 'PROCESS' ? ` · ${esc(PROCESS_STAGES[stageOf(r)].label)}` : ''}`)}
            ${row('품목 / LOT', `${esc(r.itemName || '')} ${r.itemCode ? `(${esc(r.itemCode)})` : ''} / ${esc(r.lot || '-')}`)}
            ${row(A.groupLabel, esc(r.place || '-'))}
            ${row('불량수량', `${fmtQty(r.qty)} ${esc(r.unit || '')}`)}
            ${row('발견자 / 작성자', `${esc(r.finder || '-')} / ${esc(r.reporter || '-')}`)}
            ${row('발생 내용', text(r.description))}
        </table>
        ${images}
        <h2>3. 긴급 조치 · 대응</h2>
        <table class="grid">${row('조치 항목', esc((r.actions || []).join(', ') || '-'))}${row('조치 내용', text(r.immediate))}</table>
        <h2>4. 원인 분석 (4M)</h2>
        <table class="grid">${NCR_4M.map(([k, l]) => row(l, text(r.m4?.[k]))).join('')}${row('근본 원인', text(r.rootCause))}</table>
        <h2>5. 시정 · 예방 조치</h2>
        <table class="grid">${row('시정 조치', text(r.corrective))}${row('예방 조치', text(r.preventive))}${row('담당 / 기한', `${esc(r.owner || '-')} / ${esc(r.dueDate || '-')}`)}</table>
        <h2>6. 효과 확인</h2>
        <table class="grid">${row('효과 확인', text(r.effect))}${row('확인일 / 완료일', `${esc(r.effectDate || '-')} / ${esc(r.closedDate || '-')}`)}${row('상태', esc(NCR_STATUS[r.status] || '-'))}</table>`;
    printA4({ title: '불량 발생 및 조치보고서', subtitle: `${A.label} · ${r.date}`, meta: [['보고서 번호', r.id || '(저장 전)'], ['사업장', QC_SITES[siteOf(r)] || '미지정']], bodyHtml, approvals: doc.roles, approvalKey: r.id ? doc.key : '' });
};
