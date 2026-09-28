import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { state } from '../services/db.js';
import { localDateStr } from '../services/searchUtils.js';
import {
    FORM_KINDS, FORM_SITES, getForm, getPrevForm, listFormDates, saveForm, deleteForm, stdWeightOf, weightOk, parseDuration, fmtDuration, canWriteForms, productionsOn
} from '../services/workForms.js';
import { QC_AREAS, getDefectConfig, upsertQc, deleteQc } from '../services/quality.js';
import { attachItemPicker, printA4, fmtQty, btn } from './plans/planCommon.js';
import { mountApprovalBox } from './approval/ApprovalBox.js';
import { syncYieldToWorklog, applyYieldNewRows } from '../services/prodReflect.js';
import { WORKLOG_SITES } from '../services/db.js';

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
// 스마트폰·태블릿(폭 1024px 미만): 손가락으로 누르기 쉬운 큰 입력 칸 + 카드 배치
const MOBILE_MQ = '(max-width: 1023px)';
const mCls = 'w-full h-10 bg-white border border-slate-300 rounded-lg px-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none';
const MW = 'flex items-center'; // 중량 칸 틀
const mField = (label, inner, cls = '') => `<label class="block ${cls}"><span class="block text-[11px] font-bold text-slate-500 mb-0.5">${label}</span>${inner}</label>`;

// ---------- 선택 입력 도구 (표·카드 공용) ----------
// 라인명: 기본 목록 + 이 기기에서 쓴 라인 + 지금 값, 맨 아래 '직접 입력'
const LINE_OPTIONS = ['자동라인', '반자동라인', '수동라인', '드럼라인', '페일라인', '라벨라인'];
const LINES_KEY = 'daelim_form_lines';
const usedLines = () => { try { return JSON.parse(localStorage.getItem(LINES_KEY) || '[]'); } catch { return []; } };
const rememberLines = (vals) => {
    const add = vals.map(v => String(v || '').trim()).filter(v => v && !LINE_OPTIONS.includes(v));
    if (!add.length) return;
    try { localStorage.setItem(LINES_KEY, JSON.stringify([...new Set([...add, ...usedLines()])].slice(0, 20))); } catch { /* 기억만 못 함 */ }
};
const lineOptions = (cur) => [...new Set([...LINE_OPTIONS, ...usedLines(), ...(cur ? [cur] : [])])];
const CUSTOM = '__custom';
/** 드롭다운 + '✏️ 직접 입력' (고르면 글자 칸으로 바뀜). 목록에 없는 지금 값도 선택지로 보임 */
const comboHtml = (ri, k, value, options, cls, { empty = '선택' } = {}) => {
    const v = String(value ?? '');
    const opts = [...new Set([...options, ...(v ? [v] : [])])];
    return `<select data-r="${ri}" data-k="${esc(k)}" data-input-cls="${esc(cls)}" class="${cls}"><option value="">${esc(empty)}</option>${opts.map(o => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}<option value="${CUSTOM}">✏️ 직접 입력…</option></select>`;
};
// 작업시간 범위: 시작~종료 (05:00 ~ 23:50, 10분 단위)
const TIMES = Array.from({ length: 19 * 6 }, (_, i) => { const m = 5 * 60 + i * 10; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; });
const normTime = (t) => { const m = String(t || '').trim().match(/^(\d{1,2})[:시.]?(\d{2})?/); return m ? `${Number(m[1])}:${m[2] || '00'}` : ''; };
const timeRangeHtml = (ri, k, value, cls) => {
    const [s, e] = String(value || '').split(/~|-/).map(normTime);
    const sel = (part, v) => `<select data-tpart="${part}" class="${cls} text-center"><option value="">${part === 's' ? '시작' : '종료'}</option>${[...new Set([...TIMES, ...(v ? [v] : [])])].map(t => `<option ${t === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    return `<span data-trange data-r="${ri}" data-k="${esc(k)}" class="flex items-center gap-0.5">${sel('s', s)}<span class="text-slate-400">~</span>${sel('e', e)}</span>`;
};
// 소요 시간: 시간(0~12) + 분(5분 단위) → '2h20'
const durHtml = (ri, k, value, cls) => {
    const min = parseDuration(value);
    const h = Math.floor(min / 60);
    const m = min % 60;
    const mins = [...new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, m])].sort((a, b) => a - b);
    return `<span data-dur data-r="${ri}" data-k="${esc(k)}" class="flex items-center gap-0.5">
        <select data-dpart="h" class="${cls} text-center" title="시간">${Array.from({ length: 13 }, (_, i) => `<option value="${i}" ${i === h && min ? 'selected' : ''}>${i}시간</option>`).join('')}<option value="" ${min ? '' : 'selected'}>-</option></select>
        <select data-dpart="m" class="${cls} text-center" title="분">${mins.map(x => `<option value="${x}" ${x === m && min ? 'selected' : ''}>${x}분</option>`).join('')}</select></span>`;
};
// 작업자: 등록된 작업자(환경설정 → 작업자 명단) 체크 → '이름, 이름'
const workerNames = () => [...new Set((state.workers || []).map(w => w.name).filter(Boolean))];
const workersBtnHtml = (ri, k, value, cls) => `<button type="button" data-workers data-r="${ri}" data-k="${esc(k)}" class="${cls} text-left truncate ${value ? 'text-slate-800 font-bold' : 'text-slate-400'}">${esc(value || '👥 작업자 선택')}</button>`;
const openWorkerPicker = (btn, current, onDone) => {
    document.getElementById('wf-worker-pop')?.remove();
    const picked = new Set(String(current || '').split(/[,，、\n]/).map(s => s.trim()).filter(Boolean));
    const names = [...new Set([...workerNames(), ...picked])];
    const pop = document.createElement('div');
    pop.id = 'wf-worker-pop';
    pop.className = 'fixed inset-0 z-[80] bg-slate-900/40 flex items-end sm:items-center justify-center p-3';
    pop.innerHTML = `<div class="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[80vh] overflow-y-auto p-4 space-y-3 text-sm">
        <div class="flex items-center justify-between"><b class="text-slate-900">작업자 선택</b><span class="text-xs text-slate-400">등록된 작업자 ${workerNames().length}명</span></div>
        <div class="grid grid-cols-2 gap-1.5">${names.length ? names.map(n => `<label class="flex items-center gap-2 px-2.5 py-2 rounded-xl border ${picked.has(n) ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}"><input type="checkbox" value="${esc(n)}" ${picked.has(n) ? 'checked' : ''} class="w-4 h-4 accent-blue-600" /><span class="truncate">${esc(n)}</span></label>`).join('') : '<div class="col-span-2 text-xs text-slate-400">등록된 작업자가 없습니다. 환경설정 → 작업자 명단에서 등록하거나 아래에 입력하세요.</div>'}</div>
        <div class="flex gap-1.5"><input data-extra placeholder="명단에 없는 사람 이름" class="flex-1 h-10 border border-slate-300 rounded-lg px-2" /><button type="button" data-add class="px-3 rounded-lg bg-slate-800 text-white text-xs font-bold">추가</button></div>
        <div class="flex justify-end gap-2"><button type="button" data-cancel class="px-3 py-2 rounded-lg border border-slate-300 font-bold">취소</button><button type="button" data-ok class="px-4 py-2 rounded-lg bg-blue-600 text-white font-black">확인</button></div>
    </div>`;
    document.body.appendChild(pop);
    const close = () => pop.remove();
    pop.addEventListener('click', (e) => { if (e.target === pop) close(); });
    pop.querySelector('[data-cancel]').addEventListener('click', close);
    pop.addEventListener('change', (e) => { const l = e.target.closest('label'); if (l) l.className = `flex items-center gap-2 px-2.5 py-2 rounded-xl border ${e.target.checked ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`; });
    pop.querySelector('[data-add]').addEventListener('click', () => {
        const inp = pop.querySelector('[data-extra]');
        const n = inp.value.trim();
        if (!n) return;
        const grid = pop.querySelector('.grid');
        grid.insertAdjacentHTML('beforeend', `<label class="flex items-center gap-2 px-2.5 py-2 rounded-xl border border-blue-400 bg-blue-50"><input type="checkbox" value="${esc(n)}" checked class="w-4 h-4 accent-blue-600" /><span class="truncate">${esc(n)}</span></label>`);
        inp.value = '';
    });
    pop.querySelector('[data-ok]').addEventListener('click', () => {
        const v = [...pop.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value).join(', ');
        close();
        onDone(v);
    });
};
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
                    <p class="hidden md:block text-xs text-slate-500 mt-1">${cfg.desc}</p>
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
                ${canWrite && cfg.fromProductions ? `<button type="button" id="wf-prod" class="${btn('bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-800')}" title="이 날짜에 제품생산/입고로 등록한 제품을 줄로 불러옵니다"><i data-lucide="factory" class="w-4 h-4"></i>생산입고 반영</button>` : ''}
                ${canWrite ? `<button type="button" id="wf-copy" class="${btn('bg-white border border-slate-300 hover:bg-slate-50 text-slate-700')}"><i data-lucide="copy" class="w-4 h-4"></i>직전 작성일 불러오기</button>
                <button type="button" id="wf-save" class="${btn('bg-blue-600 hover:bg-blue-700 text-white')}"><i data-lucide="save" class="w-4 h-4"></i>저장</button>` : ''}
                <button type="button" id="wf-print" class="${btn()}"><i data-lucide="printer" class="w-4 h-4"></i>A4 인쇄</button>
                ${canWrite ? '<button type="button" id="wf-del" class="px-3 py-2 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700">삭제</button>' : ''}
            </div>
            <div id="wf-dates" class="flex flex-wrap gap-1"></div>
        </div>
        <div id="wf-body" class="space-y-4 pb-20 lg:pb-0"></div>
        ${canWrite ? `<div id="wf-mbar" class="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 px-3 py-2 pr-24 flex items-center gap-2 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
            <span data-bar-state class="text-xs font-bold whitespace-nowrap"></span>
            <button type="button" data-bar-save class="flex-1 h-11 rounded-xl text-sm font-black text-white bg-blue-600">💾 저장</button>
        </div>` : ''}
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
    const markDirty = () => { if (!dirty) { dirty = true; paintHead(); } paintBar(); };
    // 스마트폰·태블릿 아래쪽 고정 저장 줄 (저장 안 한 변경이 있으면 강조)
    const paintBar = () => {
        const bar = $('#wf-mbar');
        if (!bar) return;
        bar.querySelector('[data-bar-state]').innerHTML = dirty ? '<span class="text-rose-600">● 저장 안 한 변경</span>' : exists ? '<span class="text-emerald-700">✔ 저장됨</span>' : '<span class="text-amber-700">새 양식</span>';
        bar.querySelector('[data-bar-save]').className = `flex-1 h-11 rounded-xl text-sm font-black text-white ${dirty ? 'bg-blue-600 animate-pulse' : 'bg-blue-600/80'}`;
    };
    const api = { markDirty, get doc() { return doc; }, rerender: () => draw(), showToast, canWrite, get site() { return site; }, get date() { return date; }, get mobile() { return window.matchMedia(MOBILE_MQ).matches; } };
    const draw = () => {
        // 다시 그릴 때마다 새 요소에 그린다 (입력 이벤트가 겹쳐 붙지 않게)
        const holder = document.createElement('div');
        holder.className = 'space-y-4';
        $('#wf-body').replaceChildren(holder);
        cfg.body(holder, doc, api);
        if (!canWrite) holder.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
        paintHead();
        paintBar();
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
            // 새 양식이면 그 날 제품생산/입고로 등록한 제품을 바로 채운다
            if (!f && cfg.fromProductions) {
                const list = productionsOn(date);
                if (list.length) {
                    doc = cfg.fromProductions(doc, list);
                    dirty = true;
                    showToast(`🏭 ${date} 제품생산/입고 ${list.length}건을 불러왔습니다. 확인 후 저장하세요.`);
                }
            }
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
            rememberLines(cfg.linesOf ? cfg.linesOf(doc) : []);
            doc = await saveForm(cfg.kind, site, date, doc);
            const firstSave = !exists;
            exists = true; dirty = false;
            if (!dates.includes(date)) dates = [date, ...dates].sort().reverse();
            draw();
            showToast(firstSave ? '💾 양식을 저장했습니다. 결재 칸에서 서명할 수 있습니다.' : '💾 저장했습니다.');
            if (cfg.afterSave) {
                try { const msg = await cfg.afterSave(doc, api); if (msg) showToast(msg); } catch (err) { alert(`양식은 저장했지만 연동하지 못했습니다: ${err.message}`); }
            }
        } catch (err) { alert(err.message); }
        e.target.disabled = false;
    });
    $('#wf-mbar [data-bar-save]')?.addEventListener('click', () => $('#wf-save')?.click());
    // 제품생산/입고 반영: 그 날 생산입고 중 양식에 아직 없는 LOT·제품을 줄로 더한다
    $('#wf-prod')?.addEventListener('click', () => {
        const list = productionsOn(date);
        if (!list.length) { alert(`${date}에 제품생산/입고로 등록한 완제품이 없습니다.`); return; }
        const before = JSON.stringify(doc);
        doc = cfg.fromProductions(doc, list);
        if (JSON.stringify(doc) === before) { showToast('이미 모두 반영되어 있습니다.'); return; }
        markDirty();
        draw();
        showToast('🏭 제품생산/입고 내용을 반영했습니다. 확인 후 저장하세요.');
    });
    // 화면 폭이 스마트폰·태블릿 ↔ PC로 바뀌면(가로·세로 돌리기 포함) 배치를 다시 그린다 (입력한 내용은 doc에 있어 그대로)
    const mq = window.matchMedia(MOBILE_MQ);
    const onMq = () => { if (!container.contains($('#wf-body'))) { mq.removeEventListener('change', onMq); return; } if (doc) draw(); };
    mq.addEventListener('change', onMq);
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
        if (e.target.tagName === 'SELECT') return; // 선택 칸은 change에서만 처리
        const el = e.target.closest('[data-r][data-k]');
        if (!el || !host.contains(el)) return;
        const r = rows[Number(el.dataset.r)];
        if (!r) return;
        setPath(r, el.dataset.k, el.type === 'number' ? numVal(el.value) : el.value);
        onInput(Number(el.dataset.r), el.dataset.k, el);
    });
    host.addEventListener('change', (e) => {
        const t = e.target;
        // 작업시간 범위 (시작~종료)
        if (t.dataset.tpart) {
            const w = t.closest('[data-trange]');
            const r = rows[Number(w?.dataset.r)];
            if (!r) return;
            const s = w.querySelector('[data-tpart="s"]').value;
            const en = w.querySelector('[data-tpart="e"]').value;
            setPath(r, w.dataset.k, s || en ? `${s}~${en}` : '');
            onInput(Number(w.dataset.r), w.dataset.k, t);
            return;
        }
        // 소요 시간 (시간 + 분)
        if (t.dataset.dpart) {
            const w = t.closest('[data-dur]');
            const r = rows[Number(w?.dataset.r)];
            if (!r) return;
            const hSel = w.querySelector('[data-dpart="h"]');
            if (t.dataset.dpart === 'm' && hSel.value === '') hSel.value = '0';
            const min = hSel.value === '' ? 0 : Number(hSel.value) * 60 + Number(w.querySelector('[data-dpart="m"]').value || 0);
            setPath(r, w.dataset.k, fmtDuration(min));
            onInput(Number(w.dataset.r), w.dataset.k, t);
            return;
        }
        const el = t.closest('select[data-r][data-k]');
        if (!el || !host.contains(el)) return;
        const r = rows[Number(el.dataset.r)];
        if (!r) return;
        // '직접 입력' → 글자 칸으로 바꾼다
        if (el.value === CUSTOM) {
            const inp = document.createElement('input');
            inp.dataset.r = el.dataset.r;
            inp.dataset.k = el.dataset.k;
            inp.className = el.dataset.inputCls || el.className;
            inp.placeholder = '직접 입력';
            el.replaceWith(inp);
            inp.focus();
            setPath(r, inp.dataset.k, '');
            onInput(Number(inp.dataset.r), inp.dataset.k, inp);
            return;
        }
        setPath(r, el.dataset.k, el.value);
        onInput(Number(el.dataset.r), el.dataset.k, el);
    });
    // 작업자 체크 (등록된 작업자)
    host.addEventListener('click', (e) => {
        const b = e.target.closest('[data-workers]');
        if (!b || !host.contains(b)) return;
        const r = rows[Number(b.dataset.r)];
        if (!r) return;
        openWorkerPicker(b, r[b.dataset.k], (v) => {
            setPath(r, b.dataset.k, v);
            b.textContent = v || '👥 작업자 선택';
            b.classList.toggle('text-slate-400', !v);
            b.classList.toggle('font-bold', !!v);
            onInput(Number(b.dataset.r), b.dataset.k, b);
        });
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
        linesOf: (doc) => (doc.rows || []).map(r => r.line),
        // 제품생산/입고 → 작업 줄 (제품·용량·원액·제품 LOT·양품·작업자). 이미 있는 LOT은 건너뛰고, 비어 있는 첫 줄은 채운다
        fromProductions: (doc, list) => {
            const rows = (doc.rows || []).filter(r => r.product || r.itemCode || r.prodLot || r.good);
            list.forEach(p => {
                if (rows.some(r => (p.lot && r.prodLot === p.lot) || (!p.lot && r.itemCode === p.itemCode))) return;
                const last = rows[rows.length - 1];
                rows.push({ ...blankInspectRow(last), product: p.itemName, itemCode: p.itemCode, cap: p.cap || last?.cap || '1L', rawName: p.rawName, prodLot: p.lot, good: p.qty || '', workers: p.workers || last?.workers || '' });
            });
            return { ...doc, rows: rows.length ? rows : [blankInspectRow()] };
        },
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
            // 스마트폰·태블릿: 작업 한 건 = 카드 한 장 (입력 칸 data-r/data-k는 표와 같아 입력 처리 공용)
            const mobileRows = () => `<div class="p-3 space-y-3 bg-slate-50">${doc.rows.map((r, ri) => `
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 space-y-3">
                    <div class="flex items-center justify-between"><b class="text-sm text-slate-900">작업 ${ri + 1}${r.product ? ` · ${esc(r.product)}` : ''}</b>${api.canWrite ? `<button type="button" data-del="${ri}" class="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-600 text-xs font-bold">삭제</button>` : ''}</div>
                    <div class="grid grid-cols-2 gap-2">
                        ${mField('라인명', comboHtml(ri, 'line', r.line, lineOptions(r.line), `${mCls} font-bold`), 'col-span-2')}
                        ${mField('작업시간 (시작 ~ 종료)', timeRangeHtml(ri, 'time', r.time, `${mCls} px-1`), 'col-span-2')}
                        ${mField('작업자 (등록된 작업자 체크)', workersBtnHtml(ri, 'workers', r.workers, mCls), 'col-span-2')}
                        ${mField('제품명 (검색)', `<input data-r="${ri}" data-k="product" value="${esc(r.product)}" placeholder="제품 검색" class="il-prod ${mCls} font-bold" /><span class="text-[10px] text-slate-400 font-mono">${esc(r.itemCode || '')}</span>`, 'col-span-2')}
                        ${mField('용량', `<input data-r="${ri}" data-k="cap" value="${esc(r.cap)}" placeholder="1L" class="${mCls}" />`)}
                        ${mField('비중', `<input type="number" inputmode="decimal" step="0.001" data-r="${ri}" data-k="sg" value="${esc(r.sg)}" class="${mCls} text-right" />`)}
                        ${mField('원료(원액)명 (검색)', `<input data-r="${ri}" data-k="rawName" value="${esc(r.rawName)}" placeholder="품명 일부 입력" class="il-raw ${mCls}" />`)}
                        ${mField('원료 Lot', `<input data-r="${ri}" data-k="rawLot" value="${esc(r.rawLot)}" class="${mCls} font-mono" />`)}
                        ${mField('기준중량(g) · 자동', `<input type="number" inputmode="decimal" step="0.1" data-r="${ri}" data-k="std" value="${esc(r.std)}" class="${mCls} text-right font-black" />`, 'col-span-2')}
                    </div>
                    <div class="rounded-xl border border-slate-200 overflow-hidden">
                        <div class="grid grid-cols-[52px_1fr_1fr_1fr_70px] bg-slate-100 text-[11px] font-bold text-slate-600 text-center"><span class="py-1.5">구분</span><span class="py-1.5">1회</span><span class="py-1.5">2회</span><span class="py-1.5">3회</span><span class="py-1.5">상태</span></div>
                        ${STAGES.map(([st, lb]) => `<div class="grid grid-cols-[52px_1fr_1fr_1fr_70px] border-t border-slate-100 items-stretch">
                            <span class="flex items-center justify-center text-xs font-black bg-slate-50">${lb}</span>
                            ${[0, 1, 2].map(i => `<span data-wcell="${ri}-${st}-${i}" data-base="border-l border-slate-100 ${MW}" class="border-l border-slate-100 ${MW} ${cellCls(r, st, i)}"><input type="number" inputmode="decimal" step="0.1" data-r="${ri}" data-k="w.${st}.${i}" value="${esc(r.w?.[st]?.[i] ?? '')}" placeholder="g" class="w-full h-11 m-0.5 rounded-md bg-slate-50/70 border border-slate-200 px-1 text-center text-base font-bold placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500" /></span>`).join('')}
                            <span class="border-l border-slate-100 p-1"><select data-r="${ri}" data-k="st.${st}" data-base="w-full h-9 rounded-lg border border-slate-300 bg-white text-sm" class="w-full h-9 rounded-lg border border-slate-300 bg-white text-sm font-bold ${r.st?.[st] === 'NG' ? 'text-rose-600' : 'text-emerald-700'}"><option ${r.st?.[st] !== 'NG' ? 'selected' : ''}>OK</option><option ${r.st?.[st] === 'NG' ? 'selected' : ''}>NG</option></select></span>
                        </div>`).join('')}
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        ${mField('제품 Lot', `<input data-r="${ri}" data-k="prodLot" value="${esc(r.prodLot)}" class="${mCls} font-mono" />`, 'col-span-2')}
                        ${mField('양품', `<input type="number" inputmode="numeric" min="0" data-r="${ri}" data-k="good" value="${esc(r.good)}" class="${mCls} text-right font-black" />`)}
                        ${mField('BOX', `<input type="number" inputmode="numeric" min="0" data-r="${ri}" data-k="box" value="${esc(r.box)}" class="${mCls} text-right" />`)}
                        ${mField('불량', `<input type="number" inputmode="numeric" min="0" data-r="${ri}" data-k="defect" value="${esc(r.defect)}" class="${mCls} text-right font-black text-rose-600" />`)}
                        ${mField('불량 유형', `<input data-r="${ri}" data-k="defectType" list="il-types" value="${esc(r.defectType)}" class="${mCls}" />`)}
                    </div>
                    ${r.qcId ? '<div class="text-[11px] text-rose-600 font-bold">공정 불량 기록 ✔</div>' : ''}
                </div>`).join('')}
                ${api.canWrite ? '<button type="button" data-add-bottom class="w-full py-3 rounded-2xl border-2 border-dashed border-slate-300 text-slate-600 font-black text-sm">＋ 작업 추가</button>' : ''}
            </div>`;
            host.innerHTML = `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center gap-3 text-xs">
                    <span id="il-sum" class="text-slate-600"></span>
                    <label class="ml-auto flex items-center gap-1 font-bold text-slate-600">허용 범위 기준중량 ± <input type="number" inputmode="decimal" min="0" step="0.1" id="il-tol" value="${tol}" inputmode="decimal" class="w-16 h-8 border border-slate-300 rounded px-1 text-right" />%</label>
                    ${api.canWrite ? addRowBtn('il-add', '작업 줄 추가') : ''}
                </div>
                ${api.mobile ? `${mobileRows()}<span id="il-tol-h" class="hidden">${tol}</span>` : `
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
                        <td class="p-1 border border-slate-200 align-middle" rowspan="3">${comboHtml(ri, 'line', r.line, lineOptions(r.line), `${inCls} font-bold`)}</td>
                        <td class="p-1 border border-slate-200 align-top space-y-1" rowspan="3">${timeRangeHtml(ri, 'time', r.time, `${inCls} px-0`)}${workersBtnHtml(ri, 'workers', r.workers, `${inCls} min-h-[40px] whitespace-normal`)}</td>
                        <td class="p-1 border border-slate-200 align-top space-y-1" rowspan="3"><input data-r="${ri}" data-k="product" value="${esc(r.product)}" placeholder="제품 검색" class="il-prod ${inCls} font-bold" /><div class="flex items-center gap-1"><input data-r="${ri}" data-k="cap" value="${esc(r.cap)}" class="${inCls} w-16" title="용량 (예: 1L, 4L, 500ml)" /><span class="text-[10px] text-slate-400 font-mono truncate">${esc(r.itemCode || '')}</span></div></td>
                        <td class="p-1 border border-slate-200 align-middle" rowspan="3"><input data-r="${ri}" data-k="rawName" value="${esc(r.rawName)}" placeholder="품명 검색" class="il-raw ${inCls}" /></td>
                        <td class="p-1 border border-slate-200 align-middle" rowspan="3"><textarea data-r="${ri}" data-k="rawLot" rows="2" class="${inCls} font-mono">${esc(r.rawLot)}</textarea></td>
                        <td class="p-1 border border-slate-200 align-middle" rowspan="3"><input type="number" step="0.001" data-r="${ri}" data-k="sg" value="${esc(r.sg)}" class="${inCls} text-right" /></td>
                        <td class="p-1 border border-slate-200 align-middle" rowspan="3"><input type="number" step="0.1" data-r="${ri}" data-k="std" value="${esc(r.std)}" class="${inCls} text-right font-black" title="비중·용량을 넣으면 자동 계산 (직접 고칠 수 있음)" /></td>` : ''}
                        <td class="p-1 border border-slate-200 text-center font-bold bg-slate-50">${stLabel}</td>
                        ${[0, 1, 2].map(i => `<td class="p-0.5 border border-slate-200 ${cellCls(r, st, i)}" data-base="p-0.5 border border-slate-200" data-wcell="${ri}-${st}-${i}"><input type="number" step="0.1" data-r="${ri}" data-k="w.${st}.${i}" value="${esc(r.w?.[st]?.[i] ?? '')}" class="w-full bg-transparent px-1 py-0.5 text-right text-xs focus:outline-none" /></td>`).join('')}
                        <td class="p-0.5 border border-slate-200"><select data-r="${ri}" data-k="st.${st}" data-base="${inCls}" class="${inCls} font-bold ${r.st?.[st] === 'NG' ? 'text-rose-600' : 'text-emerald-700'}"><option ${r.st?.[st] !== 'NG' ? 'selected' : ''}>OK</option><option ${r.st?.[st] === 'NG' ? 'selected' : ''}>NG</option></select></td>
                        ${si === 0 ? `
                        <td class="p-1 border border-slate-200 align-middle" rowspan="3"><input data-r="${ri}" data-k="prodLot" value="${esc(r.prodLot)}" class="${inCls} font-mono" /></td>
                        <td class="p-1 border border-slate-200 align-middle space-y-1" rowspan="3"><input type="number" min="0" data-r="${ri}" data-k="good" value="${esc(r.good)}" placeholder="양품" class="${inCls} text-right font-black" /><div class="flex items-center gap-1"><input type="number" min="0" data-r="${ri}" data-k="box" value="${esc(r.box)}" placeholder="BOX" class="${inCls} text-right" /><span class="text-[10px] text-slate-400">BOX</span></div></td>
                        <td class="p-1 border border-slate-200 align-middle space-y-1" rowspan="3"><input type="number" min="0" data-r="${ri}" data-k="defect" value="${esc(r.defect)}" placeholder="불량" class="${inCls} text-right font-black text-rose-600" /><input data-r="${ri}" data-k="defectType" list="il-types" value="${esc(r.defectType)}" placeholder="불량 유형" class="${inCls}" />${r.qcId ? '<div class="text-[10px] text-rose-600 font-bold">공정 불량 기록 ✔</div>' : ''}</td>
                        <td class="p-1 border border-slate-200 text-center align-middle" rowspan="3">${api.canWrite ? `<button type="button" data-del="${ri}" class="text-slate-300 hover:text-rose-600" title="줄 삭제"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}</td>` : ''}
                    </tr>`).join('')).join('')}</tbody>
                </table></div>`}
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
                    STAGES.forEach(([st]) => [0, 1, 2].forEach(i => { const c = host.querySelector(`[data-wcell="${ri}-${st}-${i}"]`); if (c) c.className = `${c.dataset.base} ${cellCls(r, st, i)}`; }));
                }
                if (key.startsWith('st.')) el.className = `${el.dataset.base} font-bold ${el.value === 'NG' ? 'text-rose-600' : 'text-emerald-700'}`;
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
            // 원료(원액)명: 품명 일부로 원료·원액 품목 검색 (목록에 없으면 적은 글자 그대로)
            host.querySelectorAll('.il-raw').forEach(inp => attachItemPicker(inp, (it) => {
                const r = doc.rows[Number(inp.dataset.r)];
                r.rawName = it.name;
                inp.value = it.name;
                api.markDirty();
            }, (it) => ['원료', '원액'].includes(it.category)));
            host.querySelector('#il-tol').addEventListener('input', (e) => { doc.tol = Number(e.target.value) || 0; host.querySelector('#il-tol-h').textContent = doc.tol; api.markDirty(); api.rerender(); });
            host.querySelector('#il-remarks').addEventListener('input', (e) => { doc.remarks = e.target.value; api.markDirty(); });
            const addRow = () => { doc.rows.push(blankInspectRow(doc.rows[doc.rows.length - 1])); api.markDirty(); api.rerender(); };
            host.querySelector('#il-add')?.addEventListener('click', addRow);
            host.querySelector('[data-add-bottom]')?.addEventListener('click', () => {
                addRow();
                // 새 카드로 스크롤
                const cards = document.querySelectorAll('#wf-body [data-k="line"]');
                cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
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
    // 비고: 불량 종류(공정관리 불량 유형 + 직접 입력)·개수 여러 개 + 메모
    let defectTypes = QC_AREAS.PROCESS.defaultTypes;
    getDefectConfig('PROCESS').then(c => { defectTypes = c.types; }).catch(e => console.warn('[포장수율표] 불량 유형 설정을 못 불러옴:', e.message));
    const noteText = (r) => [...(r.defects || []).filter(d => d.type || d.qty).map(d => `${d.type || '불량'} ${d.qty || 0}EA`), r.note || ''].filter(Boolean).join(', ');
    const noteHtml = (r, ri, cls) => `<div class="space-y-1">
        ${(r.defects || []).map((d, di) => `<div class="flex items-center gap-1">
            <span class="flex-1 min-w-0">${comboHtml(ri, `defects.${di}.type`, d.type, defectTypes, cls, { empty: '불량 종류' })}</span>
            <input type="number" inputmode="numeric" min="0" data-r="${ri}" data-k="defects.${di}.qty" value="${esc(d.qty ?? '')}" placeholder="개수" class="${cls} text-right" style="width:64px" />
            <button type="button" data-del-def="${ri}:${di}" class="px-1.5 text-slate-400 hover:text-rose-600" title="빼기">✕</button></div>`).join('')}
        ${api0.canWrite ? `<button type="button" data-add-def="${ri}" class="text-[11px] font-bold text-rose-700 hover:underline">＋ 불량 종류 추가</button>` : ''}
        <input data-r="${ri}" data-k="note" value="${esc(r.note || '')}" placeholder="메모 (선택)" class="${cls}" />
    </div>`;
    const api0 = { canWrite: canWriteForms() };

    renderFormShell(container, opts, {
        kind: 'YIELD', icon: 'timer',
        desc: '포장 라인별 공정 시간·인원(준비 · 용기투입/충진 · 캡핑/씰링 · 라벨부착 · 검사 · 포장/적재 · 정리)과 라벨작업·기타작업을 기록합니다. 시간은 <b>시간·분을 골라</b> 넣으면 합계 시간·<b>인시</b>(시간 × 인원)·<b>생산성</b>(수량 ÷ 인시)을 자동 계산합니다. 비고에는 불량 종류와 개수를 고릅니다.',
        linesOf: (doc) => (doc.pack || []).map(r => r.line),
        // 저장 후: 공정 시간·인원 → 같은 날짜 업무일지 제품포장작업·라벨부착작업의 작업시간·인원·총시간·공수
        afterSave: (doc, api) => {
            const res = syncYieldToWorklog(doc, api.site, api.date);
            if (!res.site) return '';
            const siteName = WORKLOG_SITES[res.site]?.name || '';
            let added = 0;
            const n = res.newPack.length + res.newLabel.length;
            if (n && confirm(`${siteName} 업무일지(${api.date})에 없는 ${res.newPack.length ? `포장 ${res.newPack.length}줄` : ''}${res.newPack.length && res.newLabel.length ? ', ' : ''}${res.newLabel.length ? `라벨부착 ${res.newLabel.length}줄` : ''}이 있습니다.\n${[...res.newPack, ...res.newLabel].map(r => `· ${r.item} ${r.qty}`).join('\n')}\n\n업무일지에 새로 넣을까요?${res.newPack.length ? '\n(포장 줄은 업무일지를 수불부에 반영할 때 재고에 입고됩니다. 이미 생산입고했다면 취소하세요.)' : ''}`)) {
                applyYieldNewRows(res.site, api.date, res.newPack, res.newLabel);
                added = n;
            }
            return res.updated || added ? `⏱ ${siteName} 업무일지 시간·인원 반영: ${res.updated}줄 갱신${added ? `, ${added}줄 추가` : ''}` : '';
        },
        // 제품생산/입고 → 포장 줄 (제품·용량·수량). 이미 있는 제품은 건너뛰고, 비어 있는 첫 줄은 채운다
        fromProductions: (doc, list) => {
            const pack = (doc.pack || []).filter(r => r.product || r.itemCode || r.qty);
            list.forEach(p => {
                if (pack.some(r => r.itemCode && r.itemCode === p.itemCode && (!p.lot || !r.lot || r.lot === p.lot))) return;
                const last = pack[pack.length - 1];
                pack.push({ ...blankPackRow(), line: last?.line || '', product: p.itemName, itemCode: p.itemCode, cap: p.cap || '1L', qty: p.qty || '', lot: p.lot });
            });
            return { ...doc, pack: pack.length ? pack : [blankPackRow()] };
        },
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
            // 스마트폰·태블릿용 큰 입력 칸 (data-r/data-k는 표와 같음)
            const mi = (k, ri, v, extra = '', cls = '') => `<input data-r="${ri}" data-k="${k}" value="${esc(v ?? '')}" ${extra} class="${mCls} ${cls}" />`;
            const delBtn = (sec, ri) => (api.canWrite ? `<button type="button" data-del="${sec}:${ri}" class="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-600 text-xs font-bold">삭제</button>` : '');
            const addBottom = (sec, label) => (api.canWrite ? `<button type="button" data-add-sec="${sec}" class="w-full py-3 rounded-2xl border-2 border-dashed border-slate-300 text-slate-600 font-black text-sm">＋ ${label}</button>` : '');
            const packCards = () => `<div class="p-3 space-y-3 bg-slate-50">${doc.pack.map((r, ri) => `
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 space-y-3">
                    <div class="flex items-center justify-between"><b class="text-sm text-slate-900">포장 ${ri + 1}${r.product ? ` · ${esc(r.product)}` : ''}</b>${delBtn('pack', ri)}</div>
                    <div class="grid grid-cols-2 gap-2">
                        ${mField('작업라인', comboHtml(ri, 'line', r.line, lineOptions(r.line), `${mCls} font-bold`))}
                        ${mField('수량', mi('qty', ri, r.qty, 'type="number" inputmode="numeric" min="0"', 'text-right font-black'))}
                        ${mField('제품명 (검색)', `${mi('product', ri, r.product, 'placeholder="제품 검색"', 'yl-prod font-bold')}<span class="text-[10px] text-slate-400 font-mono">${esc(r.itemCode || '')}</span>`, 'col-span-2')}
                        ${mField('용량', mi('cap', ri, r.cap))}
                    </div>
                    <div class="rounded-xl border border-slate-200 overflow-hidden">
                        <div class="grid grid-cols-[1fr_156px_56px] bg-slate-100 text-[11px] font-bold text-slate-600"><span class="px-2 py-1.5">공정</span><span class="py-1.5 text-center">시간</span><span class="py-1.5 text-center">인원</span></div>
                        ${STEPS.map(([k, l]) => `<div class="grid grid-cols-[1fr_156px_56px] border-t border-slate-100 items-center">
                            <span class="px-2 text-xs font-bold text-slate-700">${l}</span>
                            <span class="p-1">${durHtml(ri, `steps.${k}.t`, r.steps?.[k]?.t, 'w-full h-10 border border-slate-300 rounded-lg px-0 text-center text-sm bg-white')}</span>
                            <span class="p-1"><input type="number" inputmode="numeric" min="0" data-r="${ri}" data-k="steps.${k}.p" value="${esc(r.steps?.[k]?.p ?? '')}" class="w-full h-10 border border-slate-300 rounded-lg px-1 text-center text-sm" /></span>
                        </div>`).join('')}
                    </div>
                    <div class="p-2 rounded-xl bg-blue-50 text-center text-sm" data-tot="${ri}"></div>
                    ${mField('비고 (불량 종류·개수)', noteHtml(r, ri, mCls))}
                </div>`).join('')}${addBottom('pack', '포장 작업 추가')}</div>`;
            const labelCards = () => `<div class="p-3 space-y-3 bg-slate-50">${doc.label.map((r, ri) => `
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 space-y-2">
                    <div class="flex items-center justify-between"><b class="text-sm text-slate-900">라벨 ${ri + 1}</b>${delBtn('label', ri)}</div>
                    <div class="grid grid-cols-2 gap-2">
                        ${mField('시간 (시작 ~ 종료)', timeRangeHtml(ri, 'time', r.time, `${mCls} px-1`), 'col-span-2')}${mField('인원', mi('people', ri, r.people, 'type="number" inputmode="numeric" min="0"', 'text-right'))}
                        ${mField('제품명 (검색)', mi('product', ri, r.product, 'placeholder="제품 검색"', 'yl-lprod font-bold'), 'col-span-2')}
                        ${mField('용량', mi('cap', ri, r.cap))}${mField('수량', mi('qty', ri, r.qty, 'type="number" inputmode="numeric" min="0"', 'text-right font-black'))}
                        ${mField('수라벨', mi('manual', ri, r.manual, 'type="number" inputmode="numeric" min="0"', 'text-right'))}${mField('자동', mi('auto', ri, r.auto, 'type="number" inputmode="numeric" min="0"', 'text-right'))}
                        ${mField('합계 시간', durHtml(ri, 'total', r.total, `${mCls} px-1`), 'col-span-2')}
                    </div>
                </div>`).join('')}${addBottom('label', '라벨작업 추가')}</div>`;
            const otherCards = () => `<div class="p-3 space-y-3 bg-slate-50">${doc.other.map((r, ri) => `
                <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 space-y-2">
                    <div class="flex items-center justify-between"><b class="text-sm text-slate-900">기타 ${ri + 1}</b>${delBtn('other', ri)}</div>
                    <div class="grid grid-cols-2 gap-2">
                        ${mField('장소·라인', mi('place', ri, r.place))}${mField('업무명', mi('task', ri, r.task, '', 'font-bold'))}
                        ${mField('업무내역', mi('detail', ri, r.detail), 'col-span-2')}
                        ${mField('수량', mi('qty', ri, r.qty, 'type="number" inputmode="numeric" min="0"', 'text-right'))}${mField('인원', mi('people', ri, r.people, 'type="number" inputmode="numeric" min="0"', 'text-right'))}
                        ${mField('작업시간', durHtml(ri, 'time', r.time, `${mCls} px-1`), 'col-span-2')}${mField('합계 시간', durHtml(ri, 'total', r.total, `${mCls} px-1`), 'col-span-2')}
                    </div>
                </div>`).join('')}${addBottom('other', '기타작업 추가')}</div>`;
            host.innerHTML = `
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-3 text-xs">
                <b class="text-slate-700">작업조건</b>
                <label class="flex items-center gap-1">오전 온도 <input id="yl-amT" value="${esc(doc.cond.amT ?? '')}" inputmode="decimal" class="w-16 h-8 border border-slate-300 rounded px-1 text-right" />℃ / 습도 <input id="yl-amH" value="${esc(doc.cond.amH ?? '')}" inputmode="decimal" class="w-16 h-8 border border-slate-300 rounded px-1 text-right" />%</label>
                <label class="flex items-center gap-1">오후 온도 <input id="yl-pmT" value="${esc(doc.cond.pmT ?? '')}" inputmode="decimal" class="w-16 h-8 border border-slate-300 rounded px-1 text-right" />℃ / 습도 <input id="yl-pmH" value="${esc(doc.cond.pmH ?? '')}" inputmode="decimal" class="w-16 h-8 border border-slate-300 rounded px-1 text-right" />%</label>
                <span id="yl-sum" class="ml-auto text-slate-600"></span>
            </div>
            <div data-sec="pack" class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between text-xs"><b class="text-slate-800">${api.mobile ? '포장 작업' : '포장 작업 (칸마다 위 = 시간, 아래 = 인원)'}</b>${api.canWrite ? addRowBtn('yl-add-pack', '포장 줄 추가') : ''}</div>
                ${api.mobile ? packCards() : `<div class="overflow-x-auto"><table class="w-full text-xs min-w-[1900px] border-collapse">
                    <thead class="bg-slate-100 text-slate-600 text-[11px]"><tr><th class="p-1.5 border border-slate-200 w-28">작업라인</th><th class="p-1.5 border border-slate-200 w-44">제품명</th><th class="p-1.5 border border-slate-200 w-14">용량</th><th class="p-1.5 border border-slate-200 w-20">수량</th>
                        ${STEPS.map(([, l]) => `<th class="p-1.5 border border-slate-200 w-32">${l}</th>`).join('')}<th class="p-1.5 border border-slate-200 w-28">합계 · 생산성</th><th class="p-1.5 border border-slate-200 w-56">비고 (불량 종류·개수)</th><th class="p-1.5 border border-slate-200 w-8"></th></tr></thead>
                    <tbody>${doc.pack.map((r, ri) => `<tr>
                        <td class="p-1 border border-slate-200">${comboHtml(ri, 'line', r.line, lineOptions(r.line), `${inCls} font-bold`)}</td>
                        <td class="p-1 border border-slate-200">${inp('product', ri, r.product, 'placeholder="제품 검색"', 'yl-prod font-bold')}<div class="text-[10px] text-slate-400 font-mono">${esc(r.itemCode || '')}</div></td>
                        <td class="p-1 border border-slate-200">${inp('cap', ri, r.cap)}</td>
                        <td class="p-1 border border-slate-200">${inp('qty', ri, r.qty, 'type="number" min="0"', 'text-right font-black')}</td>
                        ${STEPS.map(([k]) => `<td class="p-1 border border-slate-200 space-y-0.5">${durHtml(ri, `steps.${k}.t`, r.steps?.[k]?.t, `${inCls} px-0`)}${inp(`steps.${k}.p`, ri, r.steps?.[k]?.p, 'type="number" min="0" placeholder="인원"', 'text-center text-slate-500')}</td>`).join('')}
                        <td class="p-1 border border-slate-200 text-center" data-tot="${ri}"></td>
                        <td class="p-1 border border-slate-200">${noteHtml(r, ri, inCls)}</td>
                        <td class="p-1 border border-slate-200 text-center">${api.canWrite ? `<button type="button" data-del="pack:${ri}" class="text-slate-300 hover:text-rose-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}</td></tr>`).join('')}</tbody></table></div>`}
            </div>
            <div class="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                <div data-sec="label" class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div class="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between text-xs"><b class="text-slate-800">라벨작업</b>${api.canWrite ? addRowBtn('yl-add-label', '라벨 줄 추가') : ''}</div>
                    ${api.mobile ? labelCards() : `<div class="overflow-x-auto"><table class="w-full text-xs min-w-[960px] border-collapse"><thead class="bg-slate-100 text-slate-600 text-[11px]"><tr><th class="p-1.5 border border-slate-200 w-44">시간</th><th class="p-1.5 border border-slate-200 w-14">인원</th><th class="p-1.5 border border-slate-200">제품명</th><th class="p-1.5 border border-slate-200 w-14">용량</th><th class="p-1.5 border border-slate-200 w-16">수량</th><th class="p-1.5 border border-slate-200 w-16">수라벨</th><th class="p-1.5 border border-slate-200 w-16">자동</th><th class="p-1.5 border border-slate-200 w-32">합계 시간</th><th class="p-1.5 border border-slate-200 w-8"></th></tr></thead>
                    <tbody>${doc.label.map((r, ri) => `<tr><td class="p-1 border border-slate-200">${timeRangeHtml(ri, 'time', r.time, `${inCls} px-0`)}</td><td class="p-1 border border-slate-200">${inp('people', ri, r.people, 'type="number" min="0"', 'text-right')}</td>
                        <td class="p-1 border border-slate-200">${inp('product', ri, r.product, 'placeholder="제품 검색"', 'yl-lprod font-bold')}</td><td class="p-1 border border-slate-200">${inp('cap', ri, r.cap)}</td><td class="p-1 border border-slate-200">${inp('qty', ri, r.qty, 'type="number" min="0"', 'text-right font-black')}</td>
                        <td class="p-1 border border-slate-200">${inp('manual', ri, r.manual, 'type="number" min="0"', 'text-right')}</td><td class="p-1 border border-slate-200">${inp('auto', ri, r.auto, 'type="number" min="0"', 'text-right')}</td><td class="p-1 border border-slate-200">${durHtml(ri, 'total', r.total, `${inCls} px-0`)}</td>
                        <td class="p-1 border border-slate-200 text-center">${api.canWrite ? `<button type="button" data-del="label:${ri}" class="text-slate-300 hover:text-rose-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="p-4 text-center text-slate-400">라벨작업 없음</td></tr>'}</tbody></table></div>`}
                </div>
                <div data-sec="other" class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div class="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between text-xs"><b class="text-slate-800">기타작업</b>${api.canWrite ? addRowBtn('yl-add-other', '기타 줄 추가') : ''}</div>
                    ${api.mobile ? otherCards() : `<div class="overflow-x-auto"><table class="w-full text-xs min-w-[960px] border-collapse"><thead class="bg-slate-100 text-slate-600 text-[11px]"><tr><th class="p-1.5 border border-slate-200 w-24">장소·라인</th><th class="p-1.5 border border-slate-200">업무명</th><th class="p-1.5 border border-slate-200">업무내역</th><th class="p-1.5 border border-slate-200 w-16">수량</th><th class="p-1.5 border border-slate-200 w-32">작업시간</th><th class="p-1.5 border border-slate-200 w-32">합계 시간</th><th class="p-1.5 border border-slate-200 w-14">인원</th><th class="p-1.5 border border-slate-200 w-8"></th></tr></thead>
                    <tbody>${doc.other.map((r, ri) => `<tr><td class="p-1 border border-slate-200">${inp('place', ri, r.place)}</td><td class="p-1 border border-slate-200">${inp('task', ri, r.task, '', 'font-bold')}</td><td class="p-1 border border-slate-200">${inp('detail', ri, r.detail)}</td>
                        <td class="p-1 border border-slate-200">${inp('qty', ri, r.qty, 'type="number" min="0"', 'text-right')}</td><td class="p-1 border border-slate-200">${durHtml(ri, 'time', r.time, `${inCls} px-0`)}</td><td class="p-1 border border-slate-200">${durHtml(ri, 'total', r.total, `${inCls} px-0`)}</td><td class="p-1 border border-slate-200">${inp('people', ri, r.people, 'type="number" min="0"', 'text-right')}</td>
                        <td class="p-1 border border-slate-200 text-center">${api.canWrite ? `<button type="button" data-del="other:${ri}" class="text-slate-300 hover:text-rose-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="p-4 text-center text-slate-400">기타작업 없음</td></tr>'}</tbody></table></div>`}
                </div>
            </div>
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <label class="block text-xs font-bold text-slate-700 mb-1">특기사항</label>
                <textarea id="yl-remarks" rows="3" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs">${esc(doc.remarks || '')}</textarea>
            </div>`;
            paintTotals();
            // 구역마다 따로 묶는다 (data-r은 구역 안의 줄 번호, 표·카드 공용)
            bindRows(host.querySelector('[data-sec="pack"]'), doc.pack, () => { paintTotals(); api.markDirty(); });
            bindRows(host.querySelector('[data-sec="label"]'), doc.label, () => { paintTotals(); api.markDirty(); });
            bindRows(host.querySelector('[data-sec="other"]'), doc.other, () => api.markDirty());
            host.querySelectorAll('[data-add-sec]').forEach(b => b.addEventListener('click', () => host.querySelector(`#yl-add-${b.dataset.addSec}`)?.click()));
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
            // 비고의 불량 종류 줄 추가·빼기
            host.querySelectorAll('[data-add-def]').forEach(b => b.addEventListener('click', () => {
                const r = doc.pack[Number(b.dataset.addDef)];
                (r.defects = r.defects || []).push({ type: '', qty: '' });
                api.markDirty(); api.rerender();
            }));
            host.querySelectorAll('[data-del-def]').forEach(b => b.addEventListener('click', () => {
                const [ri, di] = b.dataset.delDef.split(':').map(Number);
                doc.pack[ri].defects.splice(di, 1);
                api.markDirty(); api.rerender();
            }));
        },
        print: (doc, { site, date, approvals, approvalKey }) => {
            const c = doc.cond || {};
            const packRows = (doc.pack || []).map(r => `<tr><td class="c" rowspan="2">${esc(r.line)}</td><td class="c" rowspan="2">${esc(r.product)}</td><td class="c" rowspan="2">${esc(r.cap)}</td><td class="r" rowspan="2">${fmtQty(r.qty)}</td>
                ${STEPS.map(([k]) => `<td class="c">${esc(r.steps?.[k]?.t || '')}</td>`).join('')}<td class="c"><b>${fmtDuration(stepMin(r))}</b></td><td rowspan="2">${esc(noteText(r))}${productivity(r) ? `<br><span style="color:#1d4ed8">${productivity(r)} EA/인시</span>` : ''}</td></tr>
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
