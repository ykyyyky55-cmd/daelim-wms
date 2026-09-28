import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { state } from '../services/db.js';
import { localDateStr } from '../services/searchUtils.js';
import {
    FORM_KINDS, FORM_SITES, getForm, getPrevForm, listFormDates, saveForm, deleteForm, stdWeightOf, weightOk, parseDuration, fmtDuration, canWriteForms
} from '../services/workForms.js';
import { QC_AREAS, getDefectConfig, upsertQc, deleteQc } from '../services/quality.js';
import { attachItemPicker, printA4, fmtQty, btn } from './plans/planCommon.js';
import { mountApprovalBox } from './approval/ApprovalBox.js';

// 생산업무 → 초·중·종물 검사 및 작업일지 (탭 inspectLog) · 포장수율표 (탭 yieldLog)
// 종이 양식(김포공장 포장부)을 그대로 옮긴 것. 한 날짜·한 작업장에 한 장, 저장하면 결재 칸(FORM:<종류>:<작업장>:<날짜>)으로 서명.
// 초·중·종물: 기준중량 = 비중 × 용량(mL), 중량이 기준 ± 허용%를 벗어나면 빨간색. 불량 수량이 있는 줄은 저장할 때
//   품질관리 → 공정관리 불량 기록(QCW-…)으로 함께 남긴다(다시 저장하면 같은 기록을 고침).
// 포장수율표: 공정별 시간(1h, 2h20, 30m)·인원 → 합계 시간·인시(시간×인원)·생산성(수량 ÷ 인시).
const SITE_KEY = 'daelim_form_site';
const STAGES = [['init', '초물'], ['mid', '중물'], ['final', '종물']];
const STEPS = [['prep', '준비작업'], ['fill', '용기투입/충진'], ['cap', '캡핑/씰링'], ['labelManual', '수라벨'], ['labelAuto', '자동라벨'], ['inspect', '검사'], ['pack', '포장/적재'], ['clean', '정리작업']];
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const dayAdd = (d, n) => { const t = new Date(`${d}T00:00:00`); t.setDate(t.getDate() + n); return localDateStr(t); };
const inCls = 'w-full bg-white border border-slate-200 rounded px-1 py-0.5 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none';
const numVal = (v) => (v === '' || v === null || v === undefined ? '' : Number(v));
// data-k 경로('w.init.0')로 값 넣기
const setPath = (obj, path, val) => {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach((k, i) => { if (o[k] === undefined || o[k] === null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {}; o = o[k]; });
    o[keys[keys.length - 1]] = val;
};

const blankInspectRow = (prev = {}) => ({ id: uid(), line: prev.line || '', time: '', workers: prev.workers || '', product: '', itemCode: '', cap: prev.cap || '1L', rawName: '', rawLot: '', sg: '', std: '', w: { init: ['', '', ''], mid: ['', '', ''], final: ['', '', ''] }, st: { init: 'OK', mid: 'OK', final: 'OK' }, prodLot: '', good: '', box: '', defect: '', defectType: '', note: '' });
const blankPackRow = () => ({ id: uid(), line: '', product: '', itemCode: '', cap: '1L', qty: '', steps: {}, note: '' });
const blankLabelRow = () => ({ id: uid(), time: '', people: '', product: '', cap: '1L', qty: '', manual: '', auto: '', total: '', note: '' });
const blankOtherRow = () => ({ id: uid(), place: '', task: '', detail: '', qty: '', time: '', total: '', people: '' });

/**
 * 공통 틀: 작업장·날짜·작성 날짜·저장·불러오기·인쇄·결재
 * @param cfg { kind, icon, desc, blank(), body(host, doc, api), print(doc), onSave?(doc) }
 */
const renderFormShell = (container, { showToast = () => {} } = {}, cfg) => {
    const canWrite = canWriteForms();
    let site = FORM_SITES[0];
    try { site = localStorage.getItem(SITE_KEY) || site; } catch { /* 기본 작업장 */ }
    if (!FORM_SITES.includes(site)) site = FORM_SITES[0];
    let date = localDateStr();
    // 전자결재 문서함 [열기]: window.__workFormOpen = { site, date }
    const pending = window.__workFormOpen;
    window.__workFormOpen = null;
    if (pending?.site && FORM_SITES.includes(pending.site)) site = pending.site;
    if (/^\d{4}-\d{2}-\d{2}$/.test(pending?.date || '')) date = pending.date;
    let doc = null;
    let exists = false;
    let dirty = false;
    let dates = [];
    const title = FORM_KINDS[cfg.kind];

    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                    <div class="text-[11px] font-black text-blue-600 flex items-center gap-1"><i data-lucide="factory" class="w-3.5 h-3.5"></i>생산업무 › ${esc(title)}</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="${cfg.icon}" class="w-5 h-5 text-blue-600"></i><span id="wf-title"></span></h2>
                    <p class="text-xs text-slate-500 mt-1">${cfg.desc}</p>
                </div>
                <div id="wf-appr"></div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <select id="wf-site" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${FORM_SITES.map(s => `<option ${s === site ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
                <button type="button" id="wf-prev" class="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-black">◀</button>
                <input type="date" id="wf-date" value="${date}" class="border border-slate-300 rounded-lg px-2 py-1 font-bold" />
                <button type="button" id="wf-next" class="px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-black">▶</button>
                <span id="wf-state" class="font-bold"></span>
                <span class="flex-1"></span>
                ${canWrite ? `<button type="button" id="wf-copy" class="${btn('bg-white border border-slate-300 hover:bg-slate-50 text-slate-700')}"><i data-lucide="copy" class="w-4 h-4"></i>직전 작성일 불러오기</button>
                <button type="button" id="wf-save" class="${btn('bg-blue-600 hover:bg-blue-700 text-white')}"><i data-lucide="save" class="w-4 h-4"></i>저장</button>` : ''}
                <button type="button" id="wf-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>A4 인쇄</button>
                ${canWrite ? '<button type="button" id="wf-del" class="px-3 py-2 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700">삭제</button>' : ''}
            </div>
            <div id="wf-dates" class="flex flex-wrap gap-1"></div>
        </div>
        <div id="wf-body" class="space-y-4"></div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    const apprDoc = () => ({ key: exists ? `FORM:${cfg.kind}:${site}:${date}` : '', type: `FORM_${cfg.kind}`, title: `${title} ${site} ${date}`, date, roles: cfg.roles || ['작성', '검토', '승인'] });
    const paintHead = () => {
        $('#wf-title').textContent = `(${Number(date.slice(5, 7))}/${Number(date.slice(8))} ${site}) ${title}`;
        $('#wf-state').innerHTML = exists ? `<span class="text-emerald-700">✔ 저장된 양식</span>${doc?.updatedAt ? ` <span class="text-slate-400">${esc(new Date(doc.updatedAt).toLocaleString('ko-KR'))}</span>` : ''}` : '<span class="text-amber-700">새 양식 (저장 전)</span>';
        $('#wf-state').innerHTML += dirty ? ' <span class="text-rose-600">· 저장 안 한 변경 있음</span>' : '';
        const ym = date.slice(0, 7);
        const inMonth = dates.filter(d => d.startsWith(ym));
        $('#wf-dates').innerHTML = `<span class="text-[11px] text-slate-500 font-bold mr-1 self-center">${Number(ym.slice(5))}월 작성 ${inMonth.length}일</span>` + inMonth.slice().reverse().map(d => `<button type="button" data-d="${d}" class="px-2 py-0.5 rounded-full text-[11px] font-bold border ${d === date ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-slate-500'}">${Number(d.slice(8))}일</button>`).join('');
        container.querySelectorAll('#wf-dates [data-d]').forEach(b => b.addEventListener('click', () => go(b.dataset.d)));
    };
    const markDirty = () => { if (!dirty) { dirty = true; paintHead(); } };
    const api = { markDirty, get doc() { return doc; }, rerender: () => draw(), showToast, canWrite, get site() { return site; }, get date() { return date; } };
    const draw = () => {
        // 다시 그릴 때마다 새 요소에 그린다 (입력 이벤트가 겹쳐 붙지 않게)
        const holder = document.createElement('div');
        holder.className = 'space-y-4';
        $('#wf-body').replaceChildren(holder);
        cfg.body(holder, doc, api);
        if (!canWrite) holder.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
        paintHead();
        mountApprovalBox($('#wf-appr'), apprDoc(), { showToast });
        createIcons({ icons });
    };
    const load = async () => {
        $('#wf-body').innerHTML = '<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">불러오는 중...</div>';
        try {
            const [f, ds] = await Promise.all([getForm(cfg.kind, site, date), listFormDates(cfg.kind, site)]);
            dates = ds;
            exists = !!f;
            doc = f || cfg.blank();
            dirty = false;
            draw();
        } catch (e) { $('#wf-body').innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(e.message)}</div>`; }
    };
    const go = (d) => {
        if (dirty && !confirm('저장하지 않은 변경이 있습니다. 버리고 다른 날짜로 갈까요?')) { $('#wf-date').value = date; return; }
        date = d; $('#wf-date').value = d; load();
    };

    $('#wf-site').addEventListener('change', (e) => {
        if (dirty && !confirm('저장하지 않은 변경이 있습니다. 버리고 작업장을 바꿀까요?')) { e.target.value = site; return; }
        site = e.target.value;
        try { localStorage.setItem(SITE_KEY, site); } catch { /* 기억만 못 함 */ }
        dirty = false; load();
    });
    $('#wf-date').addEventListener('change', (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) go(e.target.value); });
    $('#wf-prev').addEventListener('click', () => go(dayAdd(date, -1)));
    $('#wf-next').addEventListener('click', () => go(dayAdd(date, 1)));
    $('#wf-copy')?.addEventListener('click', async () => {
        try {
            const prev = await getPrevForm(cfg.kind, site, date);
            if (!prev) { alert('이 날짜 전에 작성한 양식이 없습니다.'); return; }
            if (!confirm(`${prev.date} 양식의 줄(제품·라인·작업자 등)을 불러옵니다. 측정값·수량은 비웁니다. 지금 내용은 바뀝니다. 진행할까요?`)) return;
            doc = cfg.copyFrom(prev);
            dirty = true;
            draw();
        } catch (e) { alert(e.message); }
    });
    $('#wf-save')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
            if (cfg.beforeSave) await cfg.beforeSave(doc, api);
            doc = await saveForm(cfg.kind, site, date, doc);
            const firstSave = !exists;
            exists = true; dirty = false;
            if (!dates.includes(date)) dates = [date, ...dates].sort().reverse();
            draw();
            showToast(firstSave ? '💾 양식을 저장했습니다. 결재 칸에서 서명할 수 있습니다.' : '💾 저장했습니다.');
        } catch (err) { alert(err.message); }
        e.target.disabled = false;
    });
    $('#wf-print').addEventListener('click', () => cfg.print(doc, { site, date, title, approvals: apprDoc().roles, approvalKey: apprDoc().key }));
    $('#wf-del')?.addEventListener('click', async () => {
        if (!exists) { alert('저장된 양식이 없습니다.'); return; }
        if (!confirm(`${date} ${site} ${title}을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
        try {
            if (cfg.beforeDelete) await cfg.beforeDelete(doc);
            await deleteForm(cfg.kind, site, date);
            showToast('🗑️ 양식을 삭제했습니다.');
            dates = dates.filter(d => d !== date);
            load();
        } catch (err) { alert(err.message); }
    });
    load();
};

// 표 안의 입력: data-r(줄 번호) data-k(경로) → rows[r]에 넣고 onInput(r, key)
const bindRows = (host, rows, onInput) => {
    host.addEventListener('input', (e) => {
        const el = e.target.closest('[data-r][data-k]');
        if (!el || !host.contains(el)) return;
        const r = rows[Number(el.dataset.r)];
        if (!r) return;
        setPath(r, el.dataset.k, el.type === 'number' ? numVal(el.value) : el.value);
        onInput(Number(el.dataset.r), el.dataset.k, el);
    });
    host.addEventListener('change', (e) => {
        const el = e.target.closest('select[data-r][data-k]');
        if (!el || !host.contains(el)) return;
        const r = rows[Number(el.dataset.r)];
        if (!r) return;
        setPath(r, el.dataset.k, el.value);
        onInput(Number(el.dataset.r), el.dataset.k, el);
    });
};
const addRowBtn = (id, label) => `<button type="button" id="${id}" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold flex items-center gap-1"><i data-lucide="plus" class="w-3.5 h-3.5"></i>${label}</button>`;

// ======================================================================
// 초·중·종물 검사 및 작업일지
// ======================================================================
export const renderInspectLog = (container, opts = {}) => {
    let defectTypes = QC_AREAS.PROCESS.defaultTypes;
    getDefectConfig('PROCESS').then(c => { defectTypes = c.types; }).catch(e => console.warn('[초·중·종물] 불량 유형 설정을 못 불러옴:', e.message));
    const siteSafe = (s) => String(s).replace(/[^A-Za-z0-9가-힣]/g, '');

    renderFormShell(container, opts, {
        kind: 'INSPECT_LOG', icon: 'clipboard-check', roles: ['작성', '검토', '부서장'],
        desc: '포장 라인별 제품·원액 LOT·비중과 <b>초물·중물·종물 중량(3회씩)</b>, 상태(씰링·라벨·박스), 제품 LOT·양품·불량을 기록합니다. 기준중량 = 비중 × 용량(mL)이 자동 계산되고, 허용 범위(기준 ± %)를 벗어난 중량은 빨간색입니다. <b>불량 수량</b>이 있는 줄은 저장할 때 품질관리 → 공정관리 불량 기록으로 함께 남습니다.',
        blank: () => ({ tol: 2, rows: [blankInspectRow()], remarks: '' }),
        copyFrom: (p) => ({ tol: p.tol ?? 2, remarks: '', rows: (p.rows || []).map(r => ({ ...blankInspectRow(r), product: r.product, itemCode: r.itemCode, cap: r.cap, rawName: r.rawName, rawLot: r.rawLot, sg: r.sg, std: r.std })) }),
        body: (host, doc, api) => {
            const tol = Number(doc.tol) || 2;
            const cellCls = (r, st, i) => {
                const ok = weightOk(r.w?.[st]?.[i], r.std, tol);
                return ok === null ? '' : ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-100 text-rose-700 font-black';
            };
            const sums = () => {
                const good = doc.rows.reduce((s, r) => s + (Number(r.good) || 0), 0);
                const box = doc.rows.reduce((s, r) => s + (Number(r.box) || 0), 0);
                const def = doc.rows.reduce((s, r) => s + (Number(r.defect) || 0), 0);
                let out = 0, ng = 0;
                doc.rows.forEach(r => STAGES.forEach(([st]) => { (r.w?.[st] || []).forEach((_, i) => { if (weightOk(r.w[st][i], r.std, tol) === false) out += 1; }); if (r.st?.[st] === 'NG') ng += 1; }));
                return { good, box, def, out, ng };
            };
            const paintSums = () => {
                const s = sums();
                host.querySelector('#il-sum').innerHTML = `작업 ${doc.rows.length}건 · 양품 <b>${fmtQty(s.good)}</b>${s.box ? ` (${fmtQty(s.box)} BOX)` : ''} · 불량 <b class="${s.def ? 'text-rose-600' : ''}">${fmtQty(s.def)}</b> · 중량 이탈 <b class="${s.out ? 'text-rose-600' : 'text-emerald-700'}">${s.out}</b>회 · 상태 NG <b class="${s.ng ? 'text-rose-600' : 'text-emerald-700'}">${s.ng}</b>`;
            };
            host.innerHTML = `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-3 text-xs">
                    <span id="il-sum" class="text-slate-600"></span>
                    <label class="ml-auto flex items-center gap-1 font-bold text-slate-600">허용 범위 기준중량 ± <input type="number" min="0" step="0.1" id="il-tol" value="${tol}" class="w-14 border border-slate-300 rounded px-1 py-0.5 text-right" />%</label>
                    ${api.canWrite ? addRowBtn('il-add', '작업 줄 추가') : ''}
                </div>
                <div class="overflow-x-auto">
                <table class="w-full text-xs min-w-[1500px] border-collapse">
                    <thead class="bg-slate-100 text-slate-600 text-[11px]"><tr>
                        <th class="p-1.5 border border-slate-200 w-20" rowspan="2">작업일<br>(라인명)</th><th class="p-1.5 border border-slate-200 w-36" rowspan="2">작업시간 / 작업자</th>
                        <th class="p-1.5 border border-slate-200 w-40" rowspan="2">제품명 / 용량</th><th class="p-1.5 border border-slate-200" colspan="2">원료(원액)</th>
                        <th class="p-1.5 border border-slate-200 w-16" rowspan="2">비중</th><th class="p-1.5 border border-slate-200 w-20" rowspan="2">기준중량(g)</th>
                        <th class="p-1.5 border border-slate-200" colspan="4">중량 (기준 ± <span id="il-tol-h">${tol}</span>%)</th>
                        <th class="p-1.5 border border-slate-200 w-20" rowspan="2">상태 확인<br><span class="font-normal">(씰링·라벨·박스)</span></th>
                        <th class="p-1.5 border border-slate-200 w-28" rowspan="2">제품 Lot</th><th class="p-1.5 border border-slate-200" colspan="2">수량</th><th class="p-1.5 border border-slate-200 w-8" rowspan="2"></th>
                    </tr><tr>
                        <th class="p-1 border border-slate-200 w-28">원료명</th><th class="p-1 border border-slate-200 w-28">Lot</th>
                        <th class="p-1 border border-slate-200 w-12">구분</th><th class="p-1 border border-slate-200 w-16">1회</th><th class="p-1 border border-slate-200 w-16">2회</th><th class="p-1 border border-slate-200 w-16">3회</th>
                        <th class="p-1 border border-slate-200 w-24">양품 / BOX</th><th class="p-1 border border-slate-200 w-28">불량 / 유형</th>
                    </tr></thead>
                    <tbody>${doc.rows.map((r, ri) => STAGES.map(([st, stLabel], si) => `<tr class="${si === 2 ? 'border-b-2 border-slate-300' : ''}">
                        ${si === 0 ? `
                        <td class="p-1 border border-slate-200 align-middle" rowspan="3"><input data-r="${ri}" data-k="line" value="${esc(r.line)}" placeholder="자동라인" class="${inCls} font-bold" /></td>
                        <td class="p-1 border border-slate-200 align-top space-y-1" rowspan="3"><input data-r="${ri}" data-k="time" value="${esc(r.time)}" placeholder="9:00~10:00" class="${inCls}" /><textarea data-r="${ri}" data-k="workers" rows="2" placeholder="작업자" class="${inCls}">${esc(r.workers)}</textarea></td>
                        <td class="p-1 border border-slate-200 align-top space-y-1" rowspan="3"><input data-r="${ri}" data-k="product" value="${esc(r.product)}" placeholder="제품 검색" class="il-prod ${inCls} font-bold" /><div class="flex items-center gap-1"><input data-r="${ri}" data-k="cap" value="${esc(r.cap)}" class="${inCls} w-16" title="용량 (예: 1L, 4L, 500ml)" /><span class="text-[10px] text-slate-400 font-mono truncate">${esc(r.itemCode || '')}</span></div></td>
                        <td class="p-1 border border-slate-200 align-middle" rowspan="3"><input data-r="${ri}" data-k="rawName" value="${esc(r.rawName)}" class="${inCls}" /></td>
                        <td class="p-1 border border-slate-200 align-middle" rowspan="3"><textarea data-r="${ri}" data-k="rawLot" rows="2" class="${inCls} font-mono">${esc(r.rawLot)}</textarea></td>
                        <td class="p-1 border border-slate-200 align-middle" rowspan="3"><input type="number" step="0.001" data-r="${ri}" data-k="sg" value="${esc(r.sg)}" class="${inCls} text-right" /></td>
                        <td class="p-1 border border-slate-200 align-middle" rowspan="3"><input type="number" step="0.1" data-r="${ri}" data-k="std" value="${esc(r.std)}" class="${inCls} text-right font-black" title="비중·용량을 넣으면 자동 계산 (직접 고칠 수 있음)" /></td>` : ''}
                        <td class="p-1 border border-slate-200 text-center font-bold bg-slate-50">${stLabel}</td>
                        ${[0, 1, 2].map(i => `<td class="p-0.5 border border-slate-200 ${cellCls(r, st, i)}" data-wcell="${ri}-${st}-${i}"><input type="number" step="0.1" data-r="${ri}" data-k="w.${st}.${i}" value="${esc(r.w?.[st]?.[i] ?? '')}" class="w-full bg-transparent px-1 py-0.5 text-right text-xs focus:outline-none" /></td>`).join('')}
                        <td class="p-0.5 border border-slate-200"><select data-r="${ri}" data-k="st.${st}" class="${inCls} font-bold ${r.st?.[st] === 'NG' ? 'text-rose-600' : 'text-emerald-700'}"><option ${r.st?.[st] !== 'NG' ? 'selected' : ''}>OK</option><option ${r.st?.[st] === 'NG' ? 'selected' : ''}>NG</option></select></td>
                        ${si === 0 ? `
                        <td class="p-1 border border-slate-200 align-middle" rowspan="3"><input data-r="${ri}" data-k="prodLot" value="${esc(r.prodLot)}" class="${inCls} font-mono" /></td>
                        <td class="p-1 border border-slate-200 align-middle space-y-1" rowspan="3"><input type="number" min="0" data-r="${ri}" data-k="good" value="${esc(r.good)}" placeholder="양품" class="${inCls} text-right font-black" /><div class="flex items-center gap-1"><input type="number" min="0" data-r="${ri}" data-k="box" value="${esc(r.box)}" placeholder="BOX" class="${inCls} text-right" /><span class="text-[10px] text-slate-400">BOX</span></div></td>
                        <td class="p-1 border border-slate-200 align-middle space-y-1" rowspan="3"><input type="number" min="0" data-r="${ri}" data-k="defect" value="${esc(r.defect)}" placeholder="불량" class="${inCls} text-right font-black text-rose-600" /><input data-r="${ri}" data-k="defectType" list="il-types" value="${esc(r.defectType)}" placeholder="불량 유형" class="${inCls}" />${r.qcId ? '<div class="text-[10px] text-rose-600 font-bold">공정 불량 기록 ✔</div>' : ''}</td>
                        <td class="p-1 border border-slate-200 text-center align-middle" rowspan="3">${api.canWrite ? `<button type="button" data-del="${ri}" class="text-slate-300 hover:text-rose-600" title="줄 삭제"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}</td>` : ''}
                    </tr>`).join('')).join('')}</tbody>
                </table></div>
                <datalist id="il-types">${defectTypes.map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>
            </div>
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <label class="block text-xs font-bold text-slate-700 mb-1">특이사항 및 비고 (불량내용, 설비 수리 등 기록)</label>
                <textarea id="il-remarks" rows="3" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs">${esc(doc.remarks || '')}</textarea>
            </div>`;
            paintSums();
            bindRows(host, doc.rows, (ri, key, el) => {
                const r = doc.rows[ri];
                if (key === 'sg' || key === 'cap') {
                    const std = stdWeightOf(r.sg, r.cap);
                    if (std !== '') { r.std = std; const stdEl = host.querySelector(`[data-r="${ri}"][data-k="std"]`); if (stdEl) stdEl.value = std; }
                }
                if (key.startsWith('w.') || key === 'sg' || key === 'cap' || key === 'std') {
                    STAGES.forEach(([st]) => [0, 1, 2].forEach(i => { const c = host.querySelector(`[data-wcell="${ri}-${st}-${i}"]`); if (c) c.className = `p-0.5 border border-slate-200 ${cellCls(r, st, i)}`; }));
                }
                if (key.startsWith('st.')) el.className = `${inCls} font-bold ${el.value === 'NG' ? 'text-rose-600' : 'text-emerald-700'}`;
                paintSums();
                api.markDirty();
            });
            host.querySelectorAll('.il-prod').forEach(inp => attachItemPicker(inp, (it) => {
                const r = doc.rows[Number(inp.dataset.r)];
                r.product = it.name; r.itemCode = it.code;
                if (it.spec && /\d\s*(l|ml)/i.test(it.spec)) r.cap = it.spec.replace(/\s/g, '');
                const std = stdWeightOf(r.sg, r.cap);
                if (std !== '') r.std = std;
                api.markDirty(); api.rerender();
            }, (it) => it.category === '완제품' || !it.category));
            host.querySelector('#il-tol').addEventListener('input', (e) => { doc.tol = Number(e.target.value) || 0; host.querySelector('#il-tol-h').textContent = doc.tol; api.markDirty(); api.rerender(); });
            host.querySelector('#il-remarks').addEventListener('input', (e) => { doc.remarks = e.target.value; api.markDirty(); });
            host.querySelector('#il-add')?.addEventListener('click', () => { doc.rows.push(blankInspectRow(doc.rows[doc.rows.length - 1])); api.markDirty(); api.rerender(); });
            host.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
                const r = doc.rows[Number(b.dataset.del)];
                if (!confirm(`이 작업 줄(${r.product || '제품 없음'})을 지울까요?${r.qcId ? '\n저장하면 연결된 공정 불량 기록도 지워집니다.' : ''}`)) return;
                if (r.qcId) (doc.removedQc = doc.removedQc || []).push(r.qcId);
                doc.rows.splice(Number(b.dataset.del), 1);
                if (!doc.rows.length) doc.rows.push(blankInspectRow());
                api.markDirty(); api.rerender();
            }));
        },
        // 저장 전: 불량 수량이 있는 줄 → 공정관리 불량 기록 (한 줄 = 한 기록, 다시 저장하면 같은 기록 고침)
        beforeSave: async (doc, api) => {
            const fails = [];
            for (const r of doc.rows) {
                const def = Number(r.defect) || 0;
                const qcId = `QCW-${api.date}-${siteSafe(api.site)}-${r.id}`;
                if (def > 0 && (r.product || r.itemCode)) {
                    try {
                        await upsertQc('INSPECT', {
                            id: qcId, area: 'PROCESS', date: api.date, itemCode: r.itemCode || '', itemName: r.product || r.itemCode, lot: r.prodLot || '',
                            process: r.line || '포장', inspectedQty: (Number(r.good) || 0) + def, unit: 'EA', defects: [{ type: r.defectType || '기타', qty: def }], defectQty: def,
                            result: STAGES.some(([st]) => r.st?.[st] === 'NG') ? 'COND' : 'PASS', inspector: state.currentUser?.name || '',
                            cause: '', action: '', notes: `초·중·종물 검사 및 작업일지(${api.site})에서 등록`, source: 'inspect-log'
                        });
                        r.qcId = qcId;
                    } catch (e) { fails.push(`${r.product}: ${e.message}`); }
                } else if (r.qcId) {
                    try { await deleteQc(r.qcId); delete r.qcId; } catch (e) { fails.push(`${r.product}: ${e.message}`); }
                }
            }
            for (const id of doc.removedQc || []) { try { await deleteQc(id); } catch (e) { fails.push(e.message); } }
            delete doc.removedQc;
            if (fails.length) alert(`양식은 저장하지만 일부 공정 불량 기록을 맞추지 못했습니다.\n${fails.join('\n')}`);
        },
        beforeDelete: async (doc) => { for (const r of doc.rows || []) if (r.qcId) await deleteQc(r.qcId).catch(e => console.warn('[초·중·종물] 불량 기록 삭제 실패:', e.message)); },
        print: (doc, { site, date, title, approvals, approvalKey }) => {
            const tol = Number(doc.tol) || 2;
            const w = (r, st, i) => { const v = r.w?.[st]?.[i]; const ok = weightOk(v, r.std, tol); return `<td class="c" style="${ok === false ? 'color:#c00;font-weight:700' : ''}">${esc(v ?? '')}</td>`; };
            const rowsHtml = (doc.rows || []).map(r => STAGES.map(([st, lb], si) => `<tr>
                ${si === 0 ? `<td class="c" rowspan="3">${esc(r.line)}</td><td rowspan="3">${esc(r.time)}<br>${esc(r.workers).replace(/\n/g, '<br>')}</td><td class="c" rowspan="3">${esc(r.product)}<br>${esc(r.cap)}</td><td class="c" rowspan="3">${esc(r.rawName)}</td><td class="c" rowspan="3">${esc(r.rawLot).replace(/\n/g, '<br>')}</td><td class="c" rowspan="3">${esc(r.sg)}</td><td class="c" rowspan="3">${esc(r.std)}${r.std ? 'g' : ''}</td>` : ''}
                <td class="c">${lb}</td>${[0, 1, 2].map(i => w(r, st, i)).join('')}<td class="c" style="${r.st?.[st] === 'NG' ? 'color:#c00;font-weight:700' : ''}">${esc(r.st?.[st] || '')}</td>
                ${si === 0 ? `<td class="c" rowspan="3">${esc(r.prodLot)}</td><td class="c" rowspan="3">${fmtQty(r.good)}${r.box ? `<br>${fmtQty(r.box)}BOX` : ''}</td><td class="c" rowspan="3">${Number(r.defect) ? `${fmtQty(r.defect)}<br>${esc(r.defectType || '')}` : '-'}</td>` : ''}</tr>`).join('')).join('');
            printA4({
                title: `(${Number(date.slice(5, 7))}/${Number(date.slice(8))} ${site}) 초·중·종물 검사 및 작업일지`, subtitle: 'FIRST · MIDDLE · LAST PRODUCT INSPECTION', landscape: true, approvals, approvalKey,
                meta: [['작업일', date], ['작업장', site], ['중량 허용', `기준중량 ± ${tol}%`]],
                bodyHtml: `<table class="grid"><colgroup><col style="width:17mm"><col style="width:30mm"><col style="width:26mm"><col style="width:22mm"><col style="width:22mm"><col style="width:12mm"><col style="width:15mm"><col style="width:10mm"><col style="width:13mm"><col style="width:13mm"><col style="width:13mm"><col style="width:14mm"><col style="width:22mm"><col style="width:17mm"><col style="width:17mm"></colgroup>
                    <thead><tr><th rowspan="2">작업일<br>(라인명)</th><th rowspan="2">작업시간 / 작업자</th><th rowspan="2">제품명 / 용량</th><th colspan="2">원료(원액)</th><th rowspan="2">비중</th><th rowspan="2">기준중량</th><th colspan="4">중량 (기준중량 ± ${tol}%)</th><th rowspan="2">상태 확인</th><th rowspan="2">제품 Lot.</th><th colspan="2">수량</th></tr>
                    <tr><th>원료명</th><th>Lot.</th><th>구분</th><th>1회</th><th>2회</th><th>3회</th><th>양품</th><th>불량</th></tr></thead><tbody>${rowsHtml}</tbody></table>
                    <h2>특이사항 및 비고 (불량내용, 설비 수리 등 기록)</h2><div class="notes">${esc(doc.remarks || '')}</div>`
            });
        }
    });
};

// ======================================================================
// 포장수율표
// ======================================================================
export const renderYieldLog = (container, opts = {}) => {
    const stepMin = (r) => STEPS.reduce((s, [k]) => s + parseDuration(r.steps?.[k]?.t), 0);
    const stepPeople = (r) => STEPS.reduce((s, [k]) => s + (Number(r.steps?.[k]?.p) || 0), 0);
    const stepManMin = (r) => STEPS.reduce((s, [k]) => s + parseDuration(r.steps?.[k]?.t) * (Number(r.steps?.[k]?.p) || 0), 0);
    const productivity = (r) => { const mh = stepManMin(r) / 60; return mh > 0 && Number(r.qty) ? Math.round((Number(r.qty) / mh) * 10) / 10 : ''; };

    renderFormShell(container, opts, {
        kind: 'YIELD', icon: 'timer',
        desc: '포장 라인별 공정 시간·인원(준비 · 용기투입/충진 · 캡핑/씰링 · 라벨부착 · 검사 · 포장/적재 · 정리)과 라벨작업·기타작업을 기록합니다. 시간은 <b>1h, 2h20, 30m</b>처럼 적으면 합계 시간·<b>인시</b>(시간 × 인원)·<b>생산성</b>(수량 ÷ 인시)을 자동 계산합니다.',
        blank: () => ({ cond: { amT: '', amH: '', pmT: '', pmH: '' }, pack: [blankPackRow()], label: [blankLabelRow()], other: [blankOtherRow()], remarks: '' }),
        copyFrom: (p) => ({
            cond: { amT: '', amH: '', pmT: '', pmH: '' }, remarks: '',
            pack: (p.pack || []).map(r => ({ ...blankPackRow(), line: r.line, product: r.product, itemCode: r.itemCode, cap: r.cap, steps: Object.fromEntries(STEPS.map(([k]) => [k, { t: '', p: r.steps?.[k]?.p ?? '' }])) })),
            label: (p.label || []).map(r => ({ ...blankLabelRow(), product: r.product, cap: r.cap, people: r.people })),
            other: [blankOtherRow()]
        }),
        body: (host, doc, api) => {
            doc.pack = doc.pack?.length ? doc.pack : [blankPackRow()];
            doc.label = doc.label || [];
            doc.other = doc.other || [];
            doc.cond = doc.cond || {};
            const totals = () => {
                const qty = doc.pack.reduce((s, r) => s + (Number(r.qty) || 0), 0);
                const min = doc.pack.reduce((s, r) => s + stepMin(r), 0);
                const manMin = doc.pack.reduce((s, r) => s + stepManMin(r), 0);
                return { qty, min, manMin, prod: manMin > 0 ? Math.round((qty / (manMin / 60)) * 10) / 10 : 0, label: doc.label.reduce((s, r) => s + (Number(r.qty) || 0), 0) };
            };
            const paintTotals = () => {
                const t = totals();
                host.querySelector('#yl-sum').innerHTML = `포장 <b>${fmtQty(t.qty)}</b> EA · 작업시간 <b>${fmtDuration(t.min) || '0'}</b> · 인시 <b>${(Math.round((t.manMin / 60) * 100) / 100).toLocaleString()}</b> · 생산성 <b class="text-blue-700">${t.prod ? `${t.prod.toLocaleString()} EA/인시` : '-'}</b> · 라벨작업 <b>${fmtQty(t.label)}</b> EA`;
                doc.pack.forEach((r, ri) => {
                    const c = host.querySelector(`[data-tot="${ri}"]`);
                    if (c) c.innerHTML = `<div class="font-black">${fmtDuration(stepMin(r)) || '-'}</div><div class="text-[10px] text-slate-500">인원 ${stepPeople(r) || '-'} · ${(Math.round((stepManMin(r) / 60) * 100) / 100) || 0}인시</div><div class="text-[10px] text-blue-700 font-bold">${productivity(r) ? `${productivity(r)} EA/인시` : ''}</div>`;
                });
            };
            const inp = (k, ri, v, extra = '', cls = '') => `<input data-r="${ri}" data-k="${k}" value="${esc(v ?? '')}" ${extra} class="${inCls} ${cls}" />`;
            host.innerHTML = `
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-3 text-xs">
                <b class="text-slate-700">작업조건</b>
                <label class="flex items-center gap-1">오전 온도 <input id="yl-amT" value="${esc(doc.cond.amT ?? '')}" class="w-14 border border-slate-300 rounded px-1 py-0.5 text-right" />℃ / 습도 <input id="yl-amH" value="${esc(doc.cond.amH ?? '')}" class="w-14 border border-slate-300 rounded px-1 py-0.5 text-right" />%</label>
                <label class="flex items-center gap-1">오후 온도 <input id="yl-pmT" value="${esc(doc.cond.pmT ?? '')}" class="w-14 border border-slate-300 rounded px-1 py-0.5 text-right" />℃ / 습도 <input id="yl-pmH" value="${esc(doc.cond.pmH ?? '')}" class="w-14 border border-slate-300 rounded px-1 py-0.5 text-right" />%</label>
                <span id="yl-sum" class="ml-auto text-slate-600"></span>
            </div>
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between text-xs"><b class="text-slate-800">포장 작업 (칸마다 위 = 시간, 아래 = 인원)</b>${api.canWrite ? addRowBtn('yl-add-pack', '포장 줄 추가') : ''}</div>
                <div class="overflow-x-auto"><table class="w-full text-xs min-w-[1400px] border-collapse">
                    <thead class="bg-slate-100 text-slate-600 text-[11px]"><tr><th class="p-1.5 border border-slate-200 w-24">작업라인</th><th class="p-1.5 border border-slate-200 w-44">제품명</th><th class="p-1.5 border border-slate-200 w-14">용량</th><th class="p-1.5 border border-slate-200 w-20">수량</th>
                        ${STEPS.map(([, l]) => `<th class="p-1.5 border border-slate-200 w-20">${l}</th>`).join('')}<th class="p-1.5 border border-slate-200 w-28">합계 · 생산성</th><th class="p-1.5 border border-slate-200 w-40">비고</th><th class="p-1.5 border border-slate-200 w-8"></th></tr></thead>
                    <tbody>${doc.pack.map((r, ri) => `<tr>
                        <td class="p-1 border border-slate-200">${inp('line', ri, r.line, 'placeholder="자동라인"', 'font-bold')}</td>
                        <td class="p-1 border border-slate-200">${inp('product', ri, r.product, 'placeholder="제품 검색"', 'yl-prod font-bold')}<div class="text-[10px] text-slate-400 font-mono">${esc(r.itemCode || '')}</div></td>
                        <td class="p-1 border border-slate-200">${inp('cap', ri, r.cap)}</td>
                        <td class="p-1 border border-slate-200">${inp('qty', ri, r.qty, 'type="number" min="0"', 'text-right font-black')}</td>
                        ${STEPS.map(([k]) => `<td class="p-1 border border-slate-200 space-y-0.5">${inp(`steps.${k}.t`, ri, r.steps?.[k]?.t, 'placeholder="시간"', 'text-center')}${inp(`steps.${k}.p`, ri, r.steps?.[k]?.p, 'type="number" min="0" placeholder="인원"', 'text-center text-slate-500')}</td>`).join('')}
                        <td class="p-1 border border-slate-200 text-center" data-tot="${ri}"></td>
                        <td class="p-1 border border-slate-200"><textarea data-r="${ri}" data-k="note" rows="2" class="${inCls}" placeholder="예: 라벨 인쇄 불량 10EA">${esc(r.note || '')}</textarea></td>
                        <td class="p-1 border border-slate-200 text-center">${api.canWrite ? `<button type="button" data-del="pack:${ri}" class="text-slate-300 hover:text-rose-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}</td></tr>`).join('')}</tbody></table></div>
            </div>
            <div class="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div class="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between text-xs"><b class="text-slate-800">라벨작업</b>${api.canWrite ? addRowBtn('yl-add-label', '라벨 줄 추가') : ''}</div>
                    <div class="overflow-x-auto"><table class="w-full text-xs min-w-[760px] border-collapse"><thead class="bg-slate-100 text-slate-600 text-[11px]"><tr><th class="p-1.5 border border-slate-200 w-28">시간</th><th class="p-1.5 border border-slate-200 w-14">인원</th><th class="p-1.5 border border-slate-200">제품명</th><th class="p-1.5 border border-slate-200 w-14">용량</th><th class="p-1.5 border border-slate-200 w-16">수량</th><th class="p-1.5 border border-slate-200 w-16">수라벨</th><th class="p-1.5 border border-slate-200 w-16">자동</th><th class="p-1.5 border border-slate-200 w-20">합계 시간</th><th class="p-1.5 border border-slate-200 w-8"></th></tr></thead>
                    <tbody>${doc.label.map((r, ri) => `<tr><td class="p-1 border border-slate-200">${inp('time', ri, r.time, 'placeholder="10:00~10:30"')}</td><td class="p-1 border border-slate-200">${inp('people', ri, r.people, 'type="number" min="0"', 'text-right')}</td>
                        <td class="p-1 border border-slate-200">${inp('product', ri, r.product, 'placeholder="제품 검색"', 'yl-lprod font-bold')}</td><td class="p-1 border border-slate-200">${inp('cap', ri, r.cap)}</td><td class="p-1 border border-slate-200">${inp('qty', ri, r.qty, 'type="number" min="0"', 'text-right font-black')}</td>
                        <td class="p-1 border border-slate-200">${inp('manual', ri, r.manual, 'type="number" min="0"', 'text-right')}</td><td class="p-1 border border-slate-200">${inp('auto', ri, r.auto, 'type="number" min="0"', 'text-right')}</td><td class="p-1 border border-slate-200">${inp('total', ri, r.total, 'placeholder="120m"', 'text-center')}</td>
                        <td class="p-1 border border-slate-200 text-center">${api.canWrite ? `<button type="button" data-del="label:${ri}" class="text-slate-300 hover:text-rose-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="p-4 text-center text-slate-400">라벨작업 없음</td></tr>'}</tbody></table></div>
                </div>
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div class="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between text-xs"><b class="text-slate-800">기타작업</b>${api.canWrite ? addRowBtn('yl-add-other', '기타 줄 추가') : ''}</div>
                    <div class="overflow-x-auto"><table class="w-full text-xs min-w-[760px] border-collapse"><thead class="bg-slate-100 text-slate-600 text-[11px]"><tr><th class="p-1.5 border border-slate-200 w-24">장소·라인</th><th class="p-1.5 border border-slate-200">업무명</th><th class="p-1.5 border border-slate-200">업무내역</th><th class="p-1.5 border border-slate-200 w-16">수량</th><th class="p-1.5 border border-slate-200 w-16">작업시간</th><th class="p-1.5 border border-slate-200 w-16">합계 시간</th><th class="p-1.5 border border-slate-200 w-14">인원</th><th class="p-1.5 border border-slate-200 w-8"></th></tr></thead>
                    <tbody>${doc.other.map((r, ri) => `<tr><td class="p-1 border border-slate-200">${inp('place', ri, r.place)}</td><td class="p-1 border border-slate-200">${inp('task', ri, r.task, '', 'font-bold')}</td><td class="p-1 border border-slate-200">${inp('detail', ri, r.detail)}</td>
                        <td class="p-1 border border-slate-200">${inp('qty', ri, r.qty, 'type="number" min="0"', 'text-right')}</td><td class="p-1 border border-slate-200">${inp('time', ri, r.time, 'placeholder="30m"', 'text-center')}</td><td class="p-1 border border-slate-200">${inp('total', ri, r.total, 'placeholder="2h"', 'text-center')}</td><td class="p-1 border border-slate-200">${inp('people', ri, r.people, 'type="number" min="0"', 'text-right')}</td>
                        <td class="p-1 border border-slate-200 text-center">${api.canWrite ? `<button type="button" data-del="other:${ri}" class="text-slate-300 hover:text-rose-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="p-4 text-center text-slate-400">기타작업 없음</td></tr>'}</tbody></table></div>
                </div>
            </div>
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <label class="block text-xs font-bold text-slate-700 mb-1">특기사항</label>
                <textarea id="yl-remarks" rows="3" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs">${esc(doc.remarks || '')}</textarea>
            </div>`;
            paintTotals();
            // 표마다 따로 묶는다 (data-r은 표 안의 줄 번호)
            const tables = host.querySelectorAll('table');
            bindRows(tables[0], doc.pack, () => { paintTotals(); api.markDirty(); });
            bindRows(tables[1], doc.label, () => { paintTotals(); api.markDirty(); });
            bindRows(tables[2], doc.other, () => api.markDirty());
            const pick = (sel, list) => host.querySelectorAll(sel).forEach(el => attachItemPicker(el, (it) => {
                const r = list[Number(el.dataset.r)];
                r.product = it.name; r.itemCode = it.code;
                if (it.spec && /\d\s*(l|ml)/i.test(it.spec)) r.cap = it.spec.replace(/\s/g, '');
                api.markDirty(); api.rerender();
            }, (it) => it.category === '완제품' || !it.category));
            pick('.yl-prod', doc.pack);
            pick('.yl-lprod', doc.label);
            ['amT', 'amH', 'pmT', 'pmH'].forEach(k => host.querySelector(`#yl-${k}`).addEventListener('input', (e) => { doc.cond[k] = e.target.value; api.markDirty(); }));
            host.querySelector('#yl-remarks').addEventListener('input', (e) => { doc.remarks = e.target.value; api.markDirty(); });
            host.querySelector('#yl-add-pack')?.addEventListener('click', () => { const last = doc.pack[doc.pack.length - 1] || {}; doc.pack.push({ ...blankPackRow(), line: last.line || '' }); api.markDirty(); api.rerender(); });
            host.querySelector('#yl-add-label')?.addEventListener('click', () => { doc.label.push(blankLabelRow()); api.markDirty(); api.rerender(); });
            host.querySelector('#yl-add-other')?.addEventListener('click', () => { doc.other.push(blankOtherRow()); api.markDirty(); api.rerender(); });
            host.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
                const [sec, i] = b.dataset.del.split(':');
                if (!confirm('이 줄을 지울까요?')) return;
                doc[sec].splice(Number(i), 1);
                api.markDirty(); api.rerender();
            }));
        },
        print: (doc, { site, date, approvals, approvalKey }) => {
            const c = doc.cond || {};
            const packRows = (doc.pack || []).map(r => `<tr><td class="c" rowspan="2">${esc(r.line)}</td><td class="c" rowspan="2">${esc(r.product)}</td><td class="c" rowspan="2">${esc(r.cap)}</td><td class="r" rowspan="2">${fmtQty(r.qty)}</td>
                ${STEPS.map(([k]) => `<td class="c">${esc(r.steps?.[k]?.t || '')}</td>`).join('')}<td class="c"><b>${fmtDuration(stepMin(r))}</b></td><td rowspan="2">${esc(r.note || '').replace(/\n/g, '<br>')}${productivity(r) ? `<br><span style="color:#1d4ed8">${productivity(r)} EA/인시</span>` : ''}</td></tr>
                <tr>${STEPS.map(([k]) => `<td class="c" style="color:#555">${esc(r.steps?.[k]?.p ?? '')}</td>`).join('')}<td class="c">${stepPeople(r) || ''}</td></tr>`).join('');
            const labelRows = (doc.label || []).map(r => `<tr><td class="c">${esc(r.time)}</td><td class="c">${esc(r.people)}</td><td>${esc(r.product)}</td><td class="c">${esc(r.cap)}</td><td class="r">${fmtQty(r.qty)}</td><td class="r">${fmtQty(r.manual)}</td><td class="r">${fmtQty(r.auto)}</td><td class="c">${esc(r.total)}</td></tr>`).join('');
            const otherRows = (doc.other || []).map(r => `<tr><td class="c">${esc(r.place)}</td><td>${esc(r.task)}</td><td>${esc(r.detail)}</td><td class="r">${fmtQty(r.qty)}</td><td class="c">${esc(r.time)}</td><td class="c">${esc(r.total)}</td><td class="c">${esc(r.people)}</td></tr>`).join('');
            printA4({
                title: `포장수율표 (${date.slice(0, 4)}년 ${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일)`, subtitle: `PACKING YIELD SHEET · ${site}`, landscape: true, approvals, approvalKey,
                meta: [['작업장', site], ['작업조건 오전', `${c.amT || '-'}℃ / ${c.amH || '-'}%`], ['오후', `${c.pmT || '-'}℃ / ${c.pmH || '-'}%`]],
                bodyHtml: `<table class="grid"><colgroup><col style="width:17mm"><col style="width:38mm"><col style="width:11mm"><col style="width:14mm">${STEPS.map(() => '<col style="width:16mm">').join('')}<col style="width:16mm"><col></colgroup>
                    <thead><tr><th>작업라인</th><th>제품명</th><th>용량</th><th>수량</th>${STEPS.map(([, l]) => `<th>${l}</th>`).join('')}<th>합계 시간</th><th>비고</th></tr></thead><tbody>${packRows}</tbody></table>
                    <p style="font-size:7.5pt;color:#555;margin:1mm 0 0">칸마다 위 = 시간, 아래 = 인원</p>
                    <h2>라벨작업</h2><table class="grid"><thead><tr><th style="width:28mm">시간</th><th style="width:12mm">인원</th><th>제품명</th><th style="width:14mm">용량</th><th style="width:16mm">수량</th><th style="width:16mm">수라벨</th><th style="width:16mm">자동</th><th style="width:18mm">합계 시간</th></tr></thead><tbody>${labelRows || '<tr><td colspan="8" class="c">없음</td></tr>'}</tbody></table>
                    <h2>기타작업</h2><table class="grid"><thead><tr><th style="width:24mm">장소·라인</th><th style="width:45mm">업무명</th><th>업무내역</th><th style="width:16mm">수량</th><th style="width:16mm">작업시간</th><th style="width:16mm">합계 시간</th><th style="width:12mm">인원</th></tr></thead><tbody>${otherRows || '<tr><td colspan="7" class="c">없음</td></tr>'}</tbody></table>
                    <h2>특기사항</h2><div class="notes">${esc(doc.remarks || '')}</div>`
            });
        }
    });
};
