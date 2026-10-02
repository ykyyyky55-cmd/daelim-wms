// 물질 정보 편집 창 (CAS 번호 하나의 분류·급성독성값·곱셈계수·성분별 자료)
// 공단·PubChem에서 받은 분류는 참고 자료라, 공급사 MSDS와 다르면 여기서 고친다.
// 저장 범위: 물질 정보에 저장(모든 문서에 적용) 또는 이 문서에서만 적용(문서의 성분 줄에 분류를 따로 둔다 — 예: 정제도가 높아 발암성 분류에서 빠지는 기유)
import { esc } from '../../../services/html.js';
import { GHS_CLASSES, GHS_GROUPS, classOf, catOf, clsLabel, INH_FORMS } from '../../../services/ghs/ghsTables.js';
import { parseClassText, INFO_KEYS, normCas, isValidCas } from '../../../services/ghs/substanceParse.js';
import { ACUTE_ROUTES } from '../../../services/ghs/mixtureClassify.js';
import { lookupSubstance } from '../../../services/ghs/chemSubstances.js';
import { openDialog, INPUT, BTN_PRIMARY, BTN_SUB, BTN_MINI, clsChips, sourceBadge } from './msdsUi.js';

const INFO_GROUPS = [
    ['8. 노출기준', ['H0202', 'H0204', 'H0206', 'H0208']],
    ['11. 독성 자료', ['K040202', 'K040204', 'K040206', 'K0404', 'K0406', 'K0408', 'K0410', 'K041212', 'K041214', 'K041202', 'K041210', 'K041204', 'K041216', 'K0414', 'K0416', 'K0418', 'K0420', 'K0422']],
    ['12. 환경 자료', ['L0202', 'L0204', 'L0206', 'L0402', 'L0404', 'L0602', 'L0604', 'L08', 'L10']],
    ['15. 법적 규제 (여러 개는 " / "로 구분)', ['O02', 'O04', 'O12', 'O06', 'O08', 'O100202']],
    ['9. 물리화학적 특성 (물질 자체의 값 — 참고)', ['I0202', 'I0204', 'I04', 'I08', 'I10', 'I12', 'I14', 'I22', 'I24', 'I28', 'I30', 'I32', 'I36', 'I38']]
];

/** 같은 자리(겹치면 안 되는 분류)인지: 한 분류에 구분 하나. 단 STOT 1회 노출의 구분 3(호흡기 자극·마취)·수유독성·흡입 형태는 따로 */
const slotOf = (e) => (e.c === 'STOT_SE' && /^3/.test(e.k) ? `${e.c}:${e.k}` : e.c === 'REPRO' && e.k === 'L' ? 'REPRO:L' : e.c === 'ACUTE_INH' ? `${e.c}:${e.form || ''}` : e.c);

/**
 * @param {{ sub: Object, comp?: Object|null, isNew?: boolean, showToast?: (m: string) => void,
 *           onSave: (r: { scope: 'LIB'|'DOC', sub: Object }) => Promise<void>|void }} opt
 *   comp = 문서의 성분 줄(있으면 '이 문서에서만 적용'을 고를 수 있다), isNew = CAS 번호를 직접 넣는 새 물질
 */
export const openSubstanceDialog = ({ sub, comp = null, isNew = false, onSave, showToast = () => {} }) => {
    const usesDoc = !!comp?.own;
    const w = JSON.parse(JSON.stringify(sub));
    if (usesDoc) Object.assign(w, { cls: comp.cls || [], ate: comp.ate || {}, m: comp.m || {}, unknown: !!comp.unknown, nonAdditive: !!comp.nonAdditive });
    w.cls = Array.isArray(w.cls) ? w.cls : [];
    w.ate = w.ate || {};
    w.m = w.m || {};
    w.info = w.info || {};
    let scope = usesDoc ? 'DOC' : 'LIB';

    const classOptions = Object.entries(GHS_GROUPS).map(([g, label]) => `<optgroup label="${label}">${GHS_CLASSES.filter(c => c.group === g).map(c => `<option value="${c.key}">${esc(c.label)}</option>`).join('')}</optgroup>`).join('');
    const catOptions = (c, picked = '') => (classOf(c)?.cats || []).map(ct => `<option value="${ct.k}" ${ct.k === picked ? 'selected' : ''}>${esc(ct.label)}</option>`).join('');
    const formOptions = (picked = '') => `<option value="">형태 (제품 상태로 정함)</option>${Object.entries(INH_FORMS).map(([k, l]) => `<option value="${k}" ${k === picked ? 'selected' : ''}>${l}</option>`).join('')}`;

    const dlg = openDialog({
        title: `물질 정보 — ${w.nameKo || w.nameEn || w.cas || '새 물질'}`, sub: w.cas ? `CAS ${w.cas}` : 'CAS 번호별 분류·독성값 (공급사 MSDS 기준으로 고칠 수 있습니다)', maxW: 'max-w-4xl', icon: 'flask-round',
        bodyHtml: `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
            <label class="block"><span class="font-bold text-slate-600">CAS 번호</span><input id="sd-cas" value="${esc(w.cas || '')}" ${isNew ? '' : 'readonly'} class="${INPUT} font-mono ${isNew ? '' : 'bg-slate-100'}" placeholder="예: 107-21-1"></label>
            <label class="block md:col-span-2"><span class="font-bold text-slate-600">물질명 (국문)</span><input id="sd-ko" value="${esc(w.nameKo || '')}" class="${INPUT}"></label>
            <label class="block"><span class="font-bold text-slate-600">물질명 (영문)</span><input id="sd-en" value="${esc(w.nameEn || '')}" class="${INPUT}"></label>
            <label class="block col-span-2 md:col-span-3"><span class="font-bold text-slate-600">관용명 및 이명</span><input id="sd-syn" value="${esc(w.synonyms || '')}" class="${INPUT}"></label>
            <div class="flex items-end"><button type="button" id="sd-refetch" class="${BTN_SUB} w-full justify-center" title="안전보건공단(인증키가 있을 때) → PubChem 순서로 다시 받습니다"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>다시 받기</button></div>
        </div>
        <div id="sd-source" class="text-[11px] text-slate-500"></div>

        <div class="border border-slate-200 rounded-xl p-3 space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2"><b class="text-slate-800">유해성·위험성 분류</b>
                <span class="text-[11px] text-slate-500">공급사 MSDS 2항의 분류와 같게 맞추세요.</span></div>
            <div id="sd-cls" class="space-y-1"></div>
            <div class="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
                <select id="sd-add-c" class="${INPUT} !w-auto max-w-[220px]">${classOptions}</select>
                <select id="sd-add-k" class="${INPUT} !w-auto"></select>
                <select id="sd-add-form" class="${INPUT} !w-auto hidden">${formOptions()}</select>
                <button type="button" id="sd-add" class="${BTN_MINI}">＋ 분류 추가</button>
            </div>
            <details class="text-[11px]"><summary class="cursor-pointer font-bold text-blue-700">분류 글 붙여넣기 (공급사 MSDS의 분류를 그대로)</summary>
                <textarea id="sd-paste" rows="3" class="${INPUT} mt-1" placeholder="예)&#10;인화성 액체 : 구분3&#10;피부 부식성/피부 자극성 : 구분2&#10;흡인 유해성 : 구분1"></textarea>
                <div class="flex gap-1.5 mt-1"><button type="button" id="sd-paste-add" class="${BTN_MINI}">읽어서 넣기</button><button type="button" id="sd-paste-set" class="${BTN_MINI}">읽은 것으로 바꾸기</button></div>
            </details>
            <div id="sd-alts"></div>
            <div class="flex flex-wrap gap-x-5 gap-y-1 pt-1 border-t border-slate-100">
                <label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" id="sd-unknown" ${w.unknown ? 'checked' : ''}> <span>유해성 자료 없음 <span class="text-slate-400">(급성 독성을 모르는 성분으로 계산)</span></span></label>
                <label class="flex items-center gap-1.5 cursor-pointer" title="강산·강염기·무기염류·알데히드류·페놀류·계면활성제 등 — 1% 이상이면 구분 1"><input type="checkbox" id="sd-nonadd" ${w.nonAdditive ? 'checked' : ''}> <span>가산 방식을 적용할 수 없는 성분 <span class="text-slate-400">(강산·강염기 등)</span></span></label>
            </div>
        </div>

        <div class="grid md:grid-cols-2 gap-3">
            <div class="border border-slate-200 rounded-xl p-3">
                <b class="text-slate-800">급성독성 추정값 (LD50·LC50)</b>
                <p class="text-[11px] text-slate-500 mb-1.5">시험값을 알면 넣으세요. 비워 두면 구분의 변환값으로 계산합니다.</p>
                <div class="grid grid-cols-2 gap-1.5">${Object.entries(ACUTE_ROUTES).map(([route, cfg]) => `
                    <label class="block"><span class="text-slate-600">${cfg.label} <span class="text-slate-400">${cfg.unit}</span></span><input type="number" step="any" min="0" data-ate="${route}" value="${esc(w.ate[route] ?? '')}" class="${INPUT}"></label>`).join('')}</div>
            </div>
            <div class="border border-slate-200 rounded-xl p-3">
                <b class="text-slate-800">수생환경 곱셈계수 M</b>
                <p class="text-[11px] text-slate-500 mb-1.5">고독성 성분(L(E)C50 0.1 mg/L 이하 등)만 넣습니다. 비워 두면 1.</p>
                <div class="grid grid-cols-2 gap-1.5">
                    <label class="block"><span class="text-slate-600">급성 M</span><input type="number" step="any" min="1" data-m="acute" value="${esc(w.m.acute ?? '')}" class="${INPUT}"></label>
                    <label class="block"><span class="text-slate-600">만성 M</span><input type="number" step="any" min="1" data-m="chronic" value="${esc(w.m.chronic ?? '')}" class="${INPUT}"></label>
                </div>
                <label class="block mt-2"><span class="text-slate-600">메모</span><input id="sd-memo" value="${esc(w.memo || '')}" class="${INPUT}" placeholder="예: 공급사 MSDS Rev.3 기준"></label>
            </div>
        </div>

        <details class="border border-slate-200 rounded-xl p-3"><summary class="cursor-pointer font-bold text-slate-800">성분별 자료 (MSDS 8·11·12·15항에 옮겨 적는 글) <span class="font-normal text-slate-400" id="sd-info-n"></span></summary>
            <div class="space-y-3 mt-2">${INFO_GROUPS.map(([title, codes]) => `
                <div><div class="font-bold text-slate-600 mb-1">${title}</div><div class="grid md:grid-cols-2 gap-1.5">${codes.map(code => `
                    <label class="block"><span class="text-slate-500">${esc(INFO_KEYS[code])}</span><textarea rows="1" data-info="${code}" class="${INPUT} resize-y">${esc(w.info[code] || '')}</textarea></label>`).join('')}</div></div>`).join('')}
            </div>
        </details>`,
        footHtml: `
        ${comp ? `<div class="mr-auto flex flex-wrap items-center gap-x-4 gap-y-1">
            <label class="flex items-center gap-1.5 cursor-pointer font-bold"><input type="radio" name="sd-scope" value="LIB" ${scope === 'LIB' ? 'checked' : ''}> 물질 정보에 저장 <span class="font-normal text-slate-500">(모든 문서)</span></label>
            <label class="flex items-center gap-1.5 cursor-pointer font-bold"><input type="radio" name="sd-scope" value="DOC" ${scope === 'DOC' ? 'checked' : ''}> 이 문서에서만 적용</label></div>` : ''}
        <button type="button" data-dlg-close class="${BTN_SUB}">닫기</button>
        <button type="button" id="sd-save" class="${BTN_PRIMARY}">저장</button>`
    });
    const $ = dlg.$;

    const paintSource = () => {
        const key = scope === 'DOC' ? 'DOC' : (w.source || 'MANUAL');
        $('#sd-source').innerHTML = `${sourceBadge(key)} ${esc(w.sourceNote || '')}${w.lastDate ? ` · 공단 갱신 ${esc(w.lastDate)}` : ''}${w.fetchedAt ? ` · 받은 날 ${esc(String(w.fetchedAt).slice(0, 10))}` : ''}`;
        $('#sd-info-n').textContent = `— ${Object.values(w.info).filter(v => String(v || '').trim()).length}칸 채워짐`;
    };
    const paintCls = () => {
        $('#sd-cls').innerHTML = w.cls.length ? w.cls.map((e, i) => `
            <div class="flex flex-wrap items-center gap-1.5">
                <span class="font-bold text-slate-700 min-w-[150px]">${esc(classOf(e.c)?.label || e.c)}</span>
                <select data-cls-k="${i}" class="${INPUT} !w-auto">${catOptions(e.c, e.k)}</select>
                ${e.c === 'ACUTE_INH' ? `<select data-cls-form="${i}" class="${INPUT} !w-auto">${formOptions(e.form || '')}</select>` : ''}
                <button type="button" data-cls-del="${i}" class="text-rose-500 font-black px-1.5" title="이 분류 빼기">×</button>
            </div>`).join('') : `<p class="text-slate-400 py-1">분류 없음 — ${w.unknown ? '유해성 자료가 없는(미상) 성분으로 계산합니다.' : '분류기준에 해당하지 않는 물질로 계산합니다.'}</p>`;
    };
    const paintAlts = () => {
        const alts = (w.alts || []).filter(a => a.cls);
        $('#sd-alts').innerHTML = alts.length > 1 ? `<details class="text-[11px]"><summary class="cursor-pointer font-bold text-blue-700">PubChem의 다른 출처 분류 ${alts.length}개</summary>
            <div class="space-y-1 mt-1">${alts.map((a, i) => `<div class="flex items-start gap-2 border border-slate-100 rounded-lg p-1.5">
                <button type="button" data-alt="${i}" class="${BTN_MINI} shrink-0">이 분류로</button>
                <div class="min-w-0"><div class="font-bold text-slate-700 truncate" title="${esc(a.source)}">${esc(a.label || a.source)}</div><div>${clsChips(a.cls) || '<span class="text-slate-400">분류되지 않음</span>'}</div></div></div>`).join('')}</div></details>` : '';
    };
    const syncAddCats = () => {
        const c = $('#sd-add-c').value;
        $('#sd-add-k').innerHTML = catOptions(c);
        $('#sd-add-form').classList.toggle('hidden', c !== 'ACUTE_INH');
    };
    /** 분류 넣기: 같은 자리의 분류는 바꾼다 */
    const putEntries = (entries) => {
        entries.forEach(e => {
            if (!catOf(e.c, e.k)) return;
            w.cls = w.cls.filter(x => slotOf(x) !== slotOf(e));
            w.cls.push(e);
        });
        const order = new Map(GHS_CLASSES.map((cl, i) => [cl.key, i]));
        w.cls.sort((a, b) => order.get(a.c) - order.get(b.c));
        if (w.cls.length) { w.unknown = false; $('#sd-unknown').checked = false; }
        paintCls();
    };
    const readPaste = () => {
        const list = parseClassText($('#sd-paste').value);
        if (!list.length) showToast('읽을 수 있는 분류가 없습니다. "인화성 액체 : 구분3"처럼 한 줄에 하나씩 넣으세요.');
        return list;
    };

    paintSource(); paintCls(); paintAlts(); syncAddCats();
    $('#sd-add-c').addEventListener('change', syncAddCats);
    $('#sd-add').addEventListener('click', () => {
        const e = { c: $('#sd-add-c').value, k: $('#sd-add-k').value };
        if (e.c === 'ACUTE_INH' && $('#sd-add-form').value) e.form = $('#sd-add-form').value;
        putEntries([e]);
    });
    $('#sd-paste-add').addEventListener('click', () => { const list = readPaste(); if (list.length) { putEntries(list); showToast(`분류 ${list.length}개를 넣었습니다: ${list.map(clsLabel).join(', ')}`); } });
    $('#sd-paste-set').addEventListener('click', () => { const list = readPaste(); if (list.length) { w.cls = []; putEntries(list); showToast(`분류를 ${list.length}개로 바꿨습니다.`); } });
    dlg.el.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.clsK !== undefined) { w.cls[Number(t.dataset.clsK)].k = t.value; return; }
        if (t.dataset.clsForm !== undefined) { const entry = w.cls[Number(t.dataset.clsForm)]; if (t.value) entry.form = t.value; else delete entry.form; return; }
        if (t.id === 'sd-unknown') { w.unknown = t.checked; paintCls(); return; }
        if (t.id === 'sd-nonadd') { w.nonAdditive = t.checked; return; }
        if (t.name === 'sd-scope') { scope = t.value; paintSource(); }
    });
    dlg.el.addEventListener('click', (e) => {
        const del = e.target.closest('[data-cls-del]'), alt = e.target.closest('[data-alt]');
        if (del) { w.cls.splice(Number(del.dataset.clsDel), 1); paintCls(); }
        if (alt) { const a = (w.alts || []).filter(x => x.cls)[Number(alt.dataset.alt)]; w.cls = JSON.parse(JSON.stringify(a.cls)); w.unknown = false; $('#sd-unknown').checked = false; w.sourceNote = `PubChem (${a.label || a.source})`; paintCls(); paintSource(); }
    });
    $('#sd-refetch').addEventListener('click', async (ev) => {
        const cas = normCas($('#sd-cas').value);
        if (!isValidCas(cas)) { showToast('CAS 번호를 정확히 넣으세요 (예: 107-21-1).'); return; }
        const btn = ev.currentTarget;
        btn.disabled = true;
        try {
            const res = await lookupSubstance(cas, { force: true, save: false });
            if (res.from === 'NONE' || res.from === 'LIBRARY') { showToast(`새로 받은 자료가 없습니다. ${res.notes.join(' ')}`); return; }
            if (w.cls.length && !confirm(`${res.from === 'KOSHA' ? '안전보건공단' : 'PubChem'}에서 받은 분류로 바꿀까요?\n지금 분류: ${w.cls.map(clsLabel).join(', ')}\n받은 분류: ${res.sub.cls.map(clsLabel).join(', ') || '없음'}`)) return;
            Object.assign(w, res.sub, { m: { ...res.sub.m, ...w.m }, memo: w.memo });
            dlg.close();
            openSubstanceDialog({ sub: w, comp: comp ? { ...comp, own: false } : null, isNew, onSave, showToast });
            showToast(`${res.from === 'KOSHA' ? '안전보건공단' : 'PubChem'}에서 다시 받았습니다. 확인하고 [저장]하세요. ${res.notes.join(' ')}`);
        } catch (err) { showToast(err.message); } finally { btn.disabled = false; }
    });
    $('#sd-save').addEventListener('click', async (ev) => {
        const cas = normCas($('#sd-cas').value);
        if (scope === 'LIB' && !isValidCas(cas)) { showToast(cas ? `${cas}: CAS 번호가 올바르지 않습니다.` : 'CAS 번호가 없는 성분은 [이 문서에서만 적용]으로 저장하세요.'); return; }
        w.cas = cas;
        w.nameKo = $('#sd-ko').value.trim();
        w.nameEn = $('#sd-en').value.trim();
        w.synonyms = $('#sd-syn').value.trim();
        w.memo = $('#sd-memo').value.trim();
        w.ate = {};
        dlg.$$('[data-ate]').forEach(el => { const v = Number(el.value); if (el.value !== '' && v > 0) w.ate[el.dataset.ate] = v; });
        w.m = {};
        dlg.$$('[data-m]').forEach(el => { const v = Number(el.value); if (el.value !== '' && v >= 1) w.m[el.dataset.m] = v; });
        w.info = {};
        dlg.$$('[data-info]').forEach(el => { const v = el.value.trim(); if (v) w.info[el.dataset.info] = v; });
        if (scope === 'LIB' && w.source !== 'KOSHA' && w.source !== 'PUBCHEM') { w.source = 'MANUAL'; w.sourceNote = w.sourceNote || '직접 입력'; }
        const btn = ev.currentTarget;
        btn.disabled = true;
        try { await onSave({ scope, sub: w }); dlg.close(); } catch (err) { showToast(err.message); btn.disabled = false; }
    });
    return dlg;
};
