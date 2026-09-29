import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { isDarkTheme } from '../services/darkTheme.js';
import { vcfOf } from '../services/viscosity.js';
import { printA4 } from './plans/planCommon.js';

/**
 * TOOL → 윤활유 충진 보정계산기 (탭 lubCalc)
 * 예전에는 독립 웹페이지(public/tools/lubricant-calculator.html)를 iframe으로 띄웠으나, 앱 화면 모드(라이트·다크·눈 편한 모드)와
 * 스마트폰에 맞게 앱 화면으로 옮겼다. 계산식은 그대로(순중량 = 부피 × 비중, 보정량 = 오차 중량 ÷ 비중, 권장 기계값 = 기계값 − 오차).
 *  1. 용량/중량 환산 + 포장 허용범위 · 2. 일반 라인(노즐 2개) 보정 · 3. 자동화 라인(노즐 6개) 보정 + AI 사진 인식(Gemini, 기기별 API 키)
 * 온도 보정: 15℃ 비중 × ASTM D1250 윤활유(표 54D) 부피보정계수 = 충진 온도 비중 (예전 간이식: −0.00064/℃)
 * 입력값은 이 기기에 기억한다 (daelim_lub_calc).
 */
const PREF_KEY = 'daelim_lub_calc';
const API_KEY_KEY = 'gemini_user_api_key'; // 예전 계산기(같은 사이트)에서 저장한 키를 그대로 쓴다
const GEMINI_MODEL = 'gemini-3-flash-preview';
const TABS = [['conv', '용량/중량', 'scale'], ['gen', '일반 라인', 'split'], ['auto', '자동화 라인', 'cpu']];
const SG_PRESETS = [['저점도·ATF', 0.830], ['엔진오일', 0.850], ['유압유', 0.870], ['기어유', 0.890], ['중공업유', 0.910]];
const VOL_PRESETS = [[100, 'ml'], [350, 'ml'], [500, 'ml'], [700, 'ml'], [750, 'ml'], [1000, 'ml'], [2000, 'ml'], [3000, 'ml'], [4000, 'ml'], [6000, 'ml'], [10, 'L'], [20, 'L'], [100, 'L'], [200, 'L'], [1000, 'L']];
const TOL_PRESETS = [[-0.25, 0.25], [-0.5, 0.5], [-1.0, 0.5], [-1.5, 1.0], [0, 1.0]];
const DEF = {
    tab: 'conv', sg15: 0.850, temp: 15, vol: 1000, volUnit: 'ml', tolMin: -1.0, tolMax: 0.5,
    gen: { target: '', unit: 'g', sg: '', tare: 0, useTare: false, lines: [{ v: 840, u: 'g' }, { v: 855, u: 'g' }] },
    auto: { target: '', unit: 'g', sg: '', tare: 0, useTare: false, lines: [1000, 990, 1010, 995, 1005, 1000].map(m => ({ m, v: '' })) }
};
const loadPref = () => {
    try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); return p ? { ...structuredClone(DEF), ...p, gen: { ...DEF.gen, ...p.gen }, auto: { ...DEF.auto, ...p.auto } } : structuredClone(DEF); } catch (e) { console.warn('[충진 계산기] 저장한 입력을 읽지 못했습니다', e); return structuredClone(DEF); }
};
const savePref = (s) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(s)); } catch (e) { console.warn('[충진 계산기] 입력을 기억하지 못했습니다', e); } };
const num = (v) => { const x = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(x) ? x : NaN; };
const g = (x) => (Number.isFinite(x) ? `${(Math.round(x * 10) / 10).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} g` : '-');
const kg = (x) => (Number.isFinite(x) ? `${(x / 1000).toLocaleString('ko-KR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg` : '-');
const ml = (x, sign = false) => (Number.isFinite(x) ? `${sign && x > 0 ? '+' : ''}${x.toFixed(2)} mL` : '-');
// 스마트폰: 숫자 키패드(inputmode) · 16px 글자(자동 확대 방지) · 큰 입력칸
const INP = 'w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base sm:text-sm font-bold text-slate-800 bg-white focus:ring-2 focus:ring-blue-500 outline-none';
const numInput = (id, value, attrs = '') => `<input type="text" inputmode="decimal" autocomplete="off" id="${id}" value="${esc(value ?? '')}" class="${INP}" ${attrs} />`;
const unitSel = (id, value) => `<select id="${id}" class="border border-slate-300 rounded-xl px-2 text-sm font-bold bg-slate-50 text-slate-700">${['g', 'kg'].map(u => `<option ${value === u ? 'selected' : ''}>${u}</option>`).join('')}</select>`;
const card = (title, body, dot = 'bg-blue-600') => `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5"><h3 class="text-sm sm:text-base font-black text-slate-800 mb-3 flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full ${dot}"></span>${title}</h3>${body}</div>`;
const chip = (attrs, label, on = false) => `<button type="button" ${attrs} class="px-3 py-2 sm:py-1.5 rounded-lg text-xs font-bold border transition ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-blue-400'}">${label}</button>`;
const STATE = {
    ok: ['정상', 'bg-emerald-50 border-emerald-200', 'bg-emerald-100 text-emerald-800', 'text-emerald-700'],
    under: ['미달', 'bg-amber-50 border-amber-200', 'bg-amber-100 text-amber-800', 'text-amber-700'],
    over: ['초과', 'bg-rose-50 border-rose-200', 'bg-rose-100 text-rose-800', 'text-rose-700'],
    wait: ['대기', 'bg-slate-50 border-slate-200', 'bg-slate-100 text-slate-500', 'text-slate-400']
};
const stateOf = (diff) => (!Number.isFinite(diff) ? 'wait' : Math.abs(diff) < 0.1 ? 'ok' : diff < 0 ? 'under' : 'over');

export const renderLubricantCalculator = (container, { showToast = () => {} } = {}) => {
    const s = loadPref();
    const base = import.meta.env.BASE_URL;
    // 15℃ 비중 → 충진 온도 비중 (ASTM D1250 윤활유 표 54D)
    const sgAtTemp = () => { const t = num(s.temp); const sg = num(s.sg15); return Number.isFinite(t) && sg > 0 ? sg * vcfOf('LUBE', sg * 1000, t) : sg; };
    const volMl = () => (num(s.vol) || 0) * (s.volUnit === 'L' ? 1000 : 1);
    const stdGram = () => volMl() * sgAtTemp();

    container.innerHTML = `
    <section class="space-y-4 max-w-5xl mx-auto">
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div class="flex flex-wrap items-center gap-3">
                <img src="${base}${isDarkTheme() ? 'logo-white.svg' : 'logo.svg'}" alt="DAELIM" class="h-9 sm:h-10 w-auto shrink-0" />
                <div class="min-w-0 flex-1">
                    <h2 class="text-base sm:text-lg font-black text-slate-900 leading-tight">윤활유 충진 보정계산기</h2>
                    <p class="text-[11px] sm:text-xs text-slate-500">비중·온도·노즐별 편차로 충진 중량과 권장 설정값을 구합니다. 입력은 이 기기에 기억합니다.</p>
                </div>
                <button type="button" id="lc-print" class="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white flex items-center gap-1.5"><i data-lucide="printer" class="w-4 h-4"></i><span class="hidden sm:inline">결과 인쇄</span></button>
            </div>
        </div>
        <div class="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl text-xs sm:text-sm font-bold" id="lc-tabs"></div>
        <div id="lc-body" class="space-y-4"></div>
        <details class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 text-xs text-slate-600">
            <summary class="font-black text-slate-700 cursor-pointer">💡 충진 무게가 맞지 않을 때 현장 점검</summary>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200"><b class="block text-slate-800 mb-0.5">1. 오일 온도</b>온도가 오르면 부피가 늘어 같은 부피라도 가벼워집니다(윤활유 약 0.07%/℃). 비중 칸 아래 충진 온도를 넣으세요.</div>
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200"><b class="block text-slate-800 mb-0.5">2. 용기 무게(공병)</b>PET·캔·드럼 용기의 무게 편차를 확인하고, 필요하면 '용기 무게 차감'을 켜서 순중량으로 봅니다.</div>
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200"><b class="block text-slate-800 mb-0.5">3. 노즐 드립·밸브</b>충진 뒤 노즐 끝에서 떨어지는 드립, 차단 밸브 속도가 일정한지 점검합니다.</div>
            </div>
        </details>
    </section>`;
    const $ = (q) => container.querySelector(q);
    const bind = (id, key, obj = s, redo) => $(id)?.addEventListener('input', (e) => { obj[key] = e.target.value; savePref(s); redo(); });

    const paintTabs = () => {
        $('#lc-tabs').innerHTML = TABS.map(([k, l, ic], i) => `<button type="button" data-t="${k}" class="py-2.5 rounded-lg flex items-center justify-center gap-1.5 ${s.tab === k ? 'bg-blue-700 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}"><i data-lucide="${ic}" class="w-4 h-4 shrink-0"></i><span class="truncate">${i + 1}. ${l}</span></button>`).join('');
        container.querySelectorAll('#lc-tabs [data-t]').forEach(b => b.addEventListener('click', () => { s.tab = b.dataset.t; savePref(s); draw(); }));
    };

    // ---------- 1. 용량/중량 환산 ----------
    const drawConv = (body) => {
        body.innerHTML = `
        ${card('윤활유 비중 (15℃, g/㎤)', `
            <div class="flex items-center gap-2 mb-2">${numInput('lc-sg', s.sg15, 'style="max-width:9rem"')}<span class="text-sm text-slate-500 font-bold">g/㎤</span>
                <button type="button" id="lc-sg-spec" class="ml-auto px-3 py-2 rounded-xl text-xs font-bold bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center gap-1"><i data-lucide="ruler" class="w-3.5 h-3.5"></i>제품 규격에서</button></div>
            <input type="range" id="lc-sg-range" min="0.750" max="1.000" step="0.001" value="${num(s.sg15) || 0.85}" class="w-full accent-blue-700 my-2" />
            <div class="grid grid-cols-3 sm:grid-cols-5 gap-1.5">${SG_PRESETS.map(([l, v]) => chip(`data-sg="${v}"`, `${l}<br class="sm:hidden"> ${v.toFixed(3)}`, Math.abs(num(s.sg15) - v) < 1e-6)).join('')}</div>
            <div class="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
                <span class="font-bold text-slate-700">충진 오일 온도</span>${numInput('lc-temp', s.temp, 'style="max-width:6rem"')}<span class="text-slate-500">℃</span>
                <span class="text-slate-500 sm:ml-auto">충진 온도 비중 <b id="lc-sgt" class="text-blue-700"></b> <span class="text-slate-400">(ASTM D1250 윤활유)</span></span>
            </div>`)}
        ${card('용량 → 순중량 환산', `
            <div class="flex flex-wrap gap-1.5 mb-3">${VOL_PRESETS.map(([v, u]) => chip(`data-vol="${v}" data-unit="${u}"`, `${v.toLocaleString()}${u === 'ml' ? 'mL' : 'L'}`, num(s.vol) === v && s.volUnit === u)).join('')}</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="bg-slate-50 p-3 rounded-xl border border-slate-200"><div class="text-[11px] font-black text-slate-500 mb-1">충진 용량 (부피)</div>
                    <div class="flex gap-1.5">${numInput('lc-vol', s.vol)}<select id="lc-vol-unit" class="border border-slate-300 rounded-xl px-2 text-sm font-bold bg-white">${['ml', 'L'].map(u => `<option value="${u}" ${s.volUnit === u ? 'selected' : ''}>${u === 'ml' ? 'mL' : 'L'}</option>`).join('')}</select></div></div>
                <div class="bg-blue-50 p-3 rounded-xl border border-blue-200"><div class="text-[11px] font-black text-blue-700 mb-1">환산 순중량 (Net Weight)</div>
                    <div class="flex items-baseline gap-2 flex-wrap"><span id="lc-w" class="text-2xl font-black text-blue-900"></span><span id="lc-wkg" class="text-sm font-bold text-blue-600"></span></div></div>
            </div>`)}
        ${card('포장 중량 허용범위', `
            <div class="flex flex-wrap gap-1.5 mb-3">${TOL_PRESETS.map(([a, b]) => chip(`data-tol="${a},${b}"`, `${a}% ~ +${b}%`, num(s.tolMin) === a && num(s.tolMax) === b)).join('')}</div>
            <div class="grid grid-cols-2 gap-3 mb-3 text-xs"><label><span class="block font-bold text-slate-600 mb-1">최저 허용 오차 (%)</span>${numInput('lc-tmin', s.tolMin)}</label><label><span class="block font-bold text-slate-600 mb-1">최고 허용 오차 (%)</span>${numInput('lc-tmax', s.tolMax)}</label></div>
            <div class="grid grid-cols-3 gap-2 text-center" id="lc-tol"></div>`)}`;
        const calc = () => {
            const sgT = sgAtTemp();
            $('#lc-sgt').textContent = Number.isFinite(sgT) ? sgT.toFixed(4) : '-';
            const w = stdGram();
            $('#lc-w').textContent = g(w); $('#lc-wkg').textContent = `(${kg(w)})`;
            const lo = w * (1 + (num(s.tolMin) || 0) / 100), hi = w * (1 + (num(s.tolMax) || 0) / 100);
            const cell = (label, rate, val, cls) => `<div class="rounded-xl border p-2.5 ${cls}"><div class="text-[11px] font-bold text-slate-500">${label}</div><div class="text-[11px] font-bold">${rate}</div><div class="text-base sm:text-lg font-black text-slate-800">${g(val)}</div><div class="text-[11px] text-slate-500">${kg(val)}</div></div>`;
            $('#lc-tol').innerHTML = cell('최저 (Min)', `${num(s.tolMin) > 0 ? '+' : ''}${num(s.tolMin) || 0}%`, lo, 'bg-amber-50 border-amber-200 text-amber-700')
                + cell('기준 (Standard)', '100%', w, 'bg-blue-50 border-blue-200 text-blue-700')
                + cell('최고 (Max)', `+${num(s.tolMax) || 0}%`, hi, 'bg-emerald-50 border-emerald-200 text-emerald-700');
        };
        const setSg = (v) => { s.sg15 = v; savePref(s); $('#lc-sg').value = v; $('#lc-sg-range').value = v; container.querySelectorAll('[data-sg]').forEach(b => { const on = Math.abs(num(b.dataset.sg) - num(v)) < 1e-6; b.className = b.className.replace(/bg-blue-600 border-blue-600 text-white|bg-slate-50 border-slate-200 text-slate-700 hover:border-blue-400/, on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-blue-400'); }); calc(); };
        $('#lc-sg').addEventListener('input', (e) => { s.sg15 = e.target.value; savePref(s); if (num(e.target.value) > 0) $('#lc-sg-range').value = e.target.value; calc(); });
        $('#lc-sg-range').addEventListener('input', (e) => setSg(Number(e.target.value).toFixed(3)));
        container.querySelectorAll('[data-sg]').forEach(b => b.addEventListener('click', () => setSg(Number(b.dataset.sg).toFixed(3))));
        container.querySelectorAll('[data-vol]').forEach(b => b.addEventListener('click', () => { s.vol = Number(b.dataset.vol); s.volUnit = b.dataset.unit; savePref(s); drawConv(body); createIcons({ icons }); }));
        container.querySelectorAll('[data-tol]').forEach(b => b.addEventListener('click', () => { const [a, c] = b.dataset.tol.split(',').map(Number); s.tolMin = a; s.tolMax = c; savePref(s); drawConv(body); createIcons({ icons }); }));
        bind('#lc-temp', 'temp', s, calc); bind('#lc-vol', 'vol', s, calc); bind('#lc-tmin', 'tolMin', s, calc); bind('#lc-tmax', 'tolMax', s, calc);
        $('#lc-vol-unit').addEventListener('change', (e) => { s.volUnit = e.target.value; savePref(s); calc(); });
        // 제품 규격(품질관리 → 제품관리)의 비중 기준 중앙값을 가져온다
        $('#lc-sg-spec').addEventListener('click', async () => {
            try {
                const [{ pickSpec }, { buildItems, parseSpec }] = await Promise.all([import('./quality/QualityBlendTests.js'), import('../services/qcProductSpecs.js')]);
                const spec = await pickSpec('');
                if (!spec) return;
                const it = buildItems(spec).find(i => i.key === 'sg' && parseSpec(i.spec));
                const r = it && parseSpec(it.spec);
                const v = r ? (r.target ?? r.lo ?? r.hi) : null;
                if (!(v > 0.5 && v < 1.5)) { alert(`'${spec.productName}' 규격에 비중 기준이 없습니다.`); return; }
                setSg(v.toFixed(3));
                showToast(`📐 '${spec.productName}' 비중 ${v.toFixed(3)} (규격 ${it.spec})을 넣었습니다.`);
            } catch (e) { alert(`제품 규격을 불러오지 못했습니다: ${e.message}`); }
        });
        calc();
    };

    // ---------- 공용: 목표·비중·용기 ----------
    const baseInputs = (p, o) => `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-xs">
        <label><span class="block font-bold text-slate-600 mb-1">목표 중량 (Target)</span><div class="flex gap-1.5">${numInput(`${p}-target`, o.target || Math.round(stdGram()))}${unitSel(`${p}-unit`, o.unit)}</div></label>
        <label><span class="block font-bold text-slate-600 mb-1">적용 비중 (충진 온도)</span>${numInput(`${p}-sg`, o.sg || sgAtTemp().toFixed(4))}</label>
        <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200"><label class="flex items-center gap-2 font-bold text-slate-700 mb-1.5"><input type="checkbox" id="${p}-usetare" ${o.useTare ? 'checked' : ''} class="w-5 h-5 rounded" />용기 무게(공병) 차감</label>
            <div class="flex items-center gap-1.5">${numInput(`${p}-tare`, o.tare)}<span class="text-slate-500 font-bold">g</span></div></div></div>
        <p class="text-[11px] text-slate-400 -mt-2 mb-3">목표 중량·비중을 비우면 1번 탭(용량 ${volMl().toLocaleString()} mL × 비중 ${sgAtTemp().toFixed(4)})으로 채웁니다.</p>`;
    const baseOf = (o) => {
        const target = (num(o.target) || Math.round(stdGram())) * (o.unit === 'kg' ? 1000 : 1);
        const sg = num(o.sg) || sgAtTemp();
        const tare = o.useTare ? (num(o.tare) || 0) : 0;
        return { target, sg, tare };
    };
    const bindBase = (p, o, calc) => {
        bind(`#${p}-target`, 'target', o, calc); bind(`#${p}-sg`, 'sg', o, calc); bind(`#${p}-tare`, 'tare', o, calc);
        $(`#${p}-unit`).addEventListener('change', (e) => { o.unit = e.target.value; savePref(s); calc(); });
        $(`#${p}-usetare`).addEventListener('change', (e) => { o.useTare = e.target.checked; savePref(s); calc(); });
    };

    // ---------- 2. 일반 라인 (노즐 2개) ----------
    const drawGen = (body) => {
        const o = s.gen;
        body.innerHTML = card('일반 라인 (노즐 2개) 실측 중량 → 즉시 보정', `${baseInputs('gn', o)}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${o.lines.map((ln, i) => `
                <div class="border border-slate-200 rounded-2xl p-3.5 bg-slate-50">
                    <div class="flex items-center justify-between mb-2"><b class="text-sm text-slate-800">Line ${i + 1} <span class="text-slate-400 font-bold">(${i + 1}번 노즐)</span></b><span id="gn-b${i}" class="px-2 py-0.5 rounded-full text-[11px] font-black"></span></div>
                    <label class="block text-[11px] font-bold text-slate-500 mb-1">저울 실측 중량</label>
                    <div class="flex gap-1.5 mb-3">${numInput(`gn-v${i}`, ln.v, 'placeholder="실측 중량"')}${unitSel(`gn-u${i}`, ln.u)}</div>
                    <div id="gn-r${i}" class="p-3 rounded-xl border"></div>
                </div>`).join('')}</div>`);
        const calc = () => {
            const { target, sg, tare } = baseOf(o);
            o.lines.forEach((ln, i) => {
                const raw = num(ln.v);
                const net = Number.isFinite(raw) ? Math.max(0, raw * (ln.u === 'kg' ? 1000 : 1) - tare) : NaN;
                const diff = net - target; const st = stateOf(diff); const [label, box, badge, strong] = STATE[st];
                const dml = sg > 0 ? diff / sg : NaN;
                $(`#gn-b${i}`).className = `px-2 py-0.5 rounded-full text-[11px] font-black ${badge}`; $(`#gn-b${i}`).textContent = label;
                $(`#gn-r${i}`).className = `p-3 rounded-xl border ${box}`;
                $(`#gn-r${i}`).innerHTML = st === 'wait' ? '<div class="text-sm text-slate-400 font-bold">실측 중량을 넣으세요</div>' : `
                    <div class="flex items-end justify-between gap-2">
                        <div class="min-w-0"><div class="text-sm font-black text-slate-800">${st === 'ok' ? '충진량이 정확합니다' : `${ml(-dml, true)} ${st === 'under' ? '증량' : '감량'} 필요`}</div>
                            <div class="text-xs font-bold text-blue-800 mt-0.5">실제 충진량 ${sg > 0 ? ml(net / sg) : '-'}</div>
                            <div class="text-[11px] text-slate-500">${diff > 0 ? '+' : ''}${diff.toFixed(1)} g (${target > 0 ? `${diff > 0 ? '+' : ''}${(diff / target * 100).toFixed(2)}%` : '-'})</div></div>
                        <div class="text-right shrink-0"><div class="text-[10px] text-slate-400">권장 조정량</div><div class="text-2xl font-black ${strong}">${st === 'ok' ? '0 mL' : ml(-dml, true)}</div></div>
                    </div>`;
            });
        };
        bindBase('gn', o, calc);
        o.lines.forEach((ln, i) => { bind(`#gn-v${i}`, 'v', ln, calc); $(`#gn-u${i}`).addEventListener('change', (e) => { ln.u = e.target.value; savePref(s); calc(); }); });
        calc();
    };

    // ---------- 3. 자동화 라인 (노즐 6개) ----------
    const drawAuto = (body) => {
        const o = s.auto;
        body.innerHTML = card('자동화 라인 (노즐 6개) 기계 기록값 · 실측 편차 보정', `
            <p class="text-xs text-slate-500 -mt-1 mb-3">저울 실측값이 <b>부족하면 부족한 만큼 기계값에 더하고, 초과하면 초과한 만큼 빼서</b> 권장 기계 설정값을 구합니다.</p>
            <div class="flex flex-wrap gap-1.5 mb-3">
                <label class="px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 cursor-pointer"><i data-lucide="camera" class="w-4 h-4"></i>기계 화면 사진으로 읽기 (AI)<input type="file" id="au-photo" accept="image/*" capture="environment" class="hidden" /></label>
                <button type="button" id="au-key" class="px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 border border-slate-200 text-slate-700 flex items-center gap-1"><i data-lucide="key-round" class="w-4 h-4"></i>AI 키</button>
                <button type="button" id="au-sample" class="px-3 py-2 rounded-xl text-xs font-bold bg-indigo-50 border border-indigo-200 text-indigo-700">예시 값</button>
                <button type="button" id="au-reset" class="px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 border border-slate-200 text-slate-700">실측값 지우기</button>
            </div>
            ${baseInputs('au', o)}
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3" id="au-sum"></div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">${o.lines.map((ln, i) => `
                <div class="border border-slate-200 rounded-2xl p-3 bg-slate-50" id="au-c${i}">
                    <div class="flex items-center justify-between mb-2"><b class="text-sm text-slate-800">Line ${i + 1}</b><span id="au-b${i}" class="px-2 py-0.5 rounded-full text-[11px] font-black"></span></div>
                    <div class="grid grid-cols-2 gap-2 mb-2">
                        <label><span class="block text-[11px] font-bold text-slate-500 mb-0.5">기계 기록값 (g)</span>${numInput(`au-m${i}`, ln.m)}</label>
                        <label><span class="block text-[11px] font-bold text-amber-700 mb-0.5">저울 실측값 (g)</span>${numInput(`au-v${i}`, ln.v, 'placeholder="실측값"')}</label>
                    </div>
                    <div id="au-r${i}" class="text-xs"></div>
                </div>`).join('')}</div>`, 'bg-indigo-600');
        const calc = () => {
            const { target, sg, tare } = baseOf(o);
            const done = [];
            o.lines.forEach((ln, i) => {
                const raw = num(ln.v); const mach = num(ln.m) || 0;
                const net = Number.isFinite(raw) ? Math.max(0, raw - tare) : NaN;
                const diff = net - target; const st = stateOf(diff); const [label, box, badge, strong] = STATE[st];
                $(`#au-b${i}`).className = `px-2 py-0.5 rounded-full text-[11px] font-black ${badge}`; $(`#au-b${i}`).textContent = label;
                $(`#au-c${i}`).className = `border rounded-2xl p-3 ${st === 'wait' ? 'border-slate-200 bg-slate-50' : box}`;
                if (st === 'wait') { $(`#au-r${i}`).innerHTML = '<span class="text-slate-400 font-bold">실측값을 넣으면 권장 설정값이 나옵니다</span>'; return; }
                done.push({ net, diff, dml: sg > 0 ? diff / sg : 0, st });
                const rec = mach - diff;
                $(`#au-r${i}`).innerHTML = `<div class="flex items-end justify-between gap-2">
                    <div class="text-slate-600"><div>실충진량 <b class="text-blue-800">${sg > 0 ? ml(net / sg) : '-'}</b></div><div>중량 오차 <b class="${strong}">${diff > 0 ? '+' : ''}${diff.toFixed(1)} g</b></div></div>
                    <div class="text-right"><div class="text-[10px] text-slate-400">권장 기계 설정값</div><div class="text-xl font-black ${strong}">${rec.toFixed(1)} g</div><div class="text-[10px] font-bold ${strong}">${st === 'ok' ? '유지' : `${diff < 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} g`}</div></div></div>`;
            });
            const n = done.length;
            const avg = n ? done.reduce((a, d) => a + d.net, 0) / n : NaN;
            const dev = n ? Math.max(...done.map(d => d.net)) - Math.min(...done.map(d => d.net)) : NaN;
            const adj = n ? -done.reduce((a, d) => a + d.dml, 0) / n : NaN;
            const under = done.filter(d => d.st === 'under').length, over = done.filter(d => d.st === 'over').length;
            const box = (l, v, cls = 'text-slate-800') => `<div class="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-center"><div class="text-[11px] font-bold text-slate-500">${l}</div><div class="text-base sm:text-lg font-black ${cls}">${v}</div></div>`;
            $('#au-sum').innerHTML = box('평균 순중량', g(avg)) + box('라인 간 최대 편차', g(dev), 'text-indigo-800') + box('평균 부피 보정치', n ? ml(adj, true) : '-', 'text-blue-700')
                + box('전체 상태', !n ? '입력 대기' : under + over === 0 ? `${n}개 모두 정상` : `미달 ${under} · 초과 ${over}`, !n ? 'text-slate-400' : under + over ? 'text-amber-700' : 'text-emerald-700');
        };
        bindBase('au', o, calc);
        o.lines.forEach((ln, i) => { bind(`#au-m${i}`, 'm', ln, calc); bind(`#au-v${i}`, 'v', ln, calc); });
        $('#au-sample').addEventListener('click', () => { [850, 840, 855, 848, 852, 850].forEach((v, i) => { o.lines[i] = { m: [1000, 990, 1010, 995, 1005, 1000][i], v }; }); o.target = 850; savePref(s); drawAuto(body); createIcons({ icons }); });
        $('#au-reset').addEventListener('click', () => { o.lines.forEach(ln => { ln.v = ''; }); savePref(s); drawAuto(body); createIcons({ icons }); });
        $('#au-key').addEventListener('click', () => askApiKey());
        $('#au-photo').addEventListener('change', async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await readMachinePhoto(f, o, () => { drawAuto(body); createIcons({ icons }); }); });
        calc();
    };

    // ---------- AI 사진 인식 (Google Gemini, 키는 이 기기에만 저장) ----------
    const getKey = () => { try { return localStorage.getItem(API_KEY_KEY) || ''; } catch { return ''; } };
    const askApiKey = (notice = '') => {
        const v = prompt(`${notice ? `${notice}\n\n` : ''}Google Gemini API 키 (무료, Google AI Studio에서 발급)\n이 기기에만 저장됩니다. 비우면 지웁니다.`, getKey());
        if (v === null) return false;
        try { if (v.trim()) localStorage.setItem(API_KEY_KEY, v.trim()); else localStorage.removeItem(API_KEY_KEY); } catch (e) { alert(`키를 저장하지 못했습니다: ${e.message}`); return false; }
        showToast(v.trim() ? '🔑 AI 키를 저장했습니다.' : 'AI 키를 지웠습니다.');
        return !!v.trim();
    };
    const shrink = (file, max = 1280) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { const sc = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]); };
        img.onerror = () => reject(new Error('사진을 열지 못했습니다.'));
        img.src = URL.createObjectURL(file);
    });
    const readMachinePhoto = async (file, o, redraw) => {
        let key = getKey();
        if (!key && !(askApiKey('AI 사진 인식에는 Gemini API 키가 필요합니다.') && (key = getKey()))) return;
        showToast('🤖 사진에서 6개 라인 수치를 읽는 중…');
        try {
            const data = await shrink(file);
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: 'You are an industrial OCR expert. From the photo (PLC screen, digital monitor, paper log, scale display or machine panel) extract the numeric values for 6 filling lines/nozzles in order Line 1..Line 6. Return only JSON matching the schema.' }] },
                    contents: [{ role: 'user', parts: [{ text: 'Extract the 6 machine recorded weight numbers for Line 1 through Line 6.' }, { inlineData: { mimeType: 'image/jpeg', data } }] }],
                    generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { lineValues: { type: 'ARRAY', items: { type: 'NUMBER' } } }, required: ['lineValues'] } }
                })
            });
            if (res.status === 400 || res.status === 403) { askApiKey('AI 키가 올바르지 않습니다. 새 키를 넣어 주세요.'); return; }
            if (!res.ok) throw new Error(`AI 응답 오류 ${res.status}`);
            const text = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const vals = JSON.parse(text.replace(/```json|```/gi, '').trim() || '{}').lineValues || [];
            let n = 0;
            vals.slice(0, 6).forEach((v, i) => { if (Number.isFinite(Number(v))) { o.lines[i].m = Number(v); n++; } });
            savePref(s); redraw();
            if (n) showToast(`✨ 기계 기록값 ${n}개를 읽었습니다. 값을 확인하고 저울 실측값을 넣으세요.`); else alert('사진에서 수치를 찾지 못했습니다. 기계 화면 숫자가 정면에서 선명하게 보이도록 다시 찍어 주세요.');
        } catch (e) { console.error('[충진 계산기] AI 사진 인식 실패', e); alert(`사진 인식 중 문제가 생겼습니다: ${e.message}`); }
    };

    const DRAW = { conv: drawConv, gen: drawGen, auto: drawAuto };
    const draw = () => { paintTabs(); (DRAW[s.tab] || drawConv)($('#lc-body')); createIcons({ icons }); };

    // 결과 인쇄 (지금 탭)
    $('#lc-print').addEventListener('click', () => {
        const sgT = sgAtTemp();
        const head = `<table class="grid"><tr><th style="width:30mm">비중 (15℃)</th><td>${esc(String(s.sg15))}</td><th style="width:30mm">충진 온도</th><td>${esc(String(s.temp))}℃ → 비중 ${Number.isFinite(sgT) ? sgT.toFixed(4) : '-'}</td></tr></table>`;
        let bodyHtml = head;
        if (s.tab === 'conv') {
            const w = stdGram();
            bodyHtml += `<table class="grid" style="margin-top:3mm"><thead><tr><th>구분</th><th>비율</th><th>중량 (g)</th><th>중량 (kg)</th></tr></thead><tbody>
                <tr><td>최저</td><td class="c">${s.tolMin}%</td><td class="c">${g(w * (1 + num(s.tolMin) / 100))}</td><td class="c">${kg(w * (1 + num(s.tolMin) / 100))}</td></tr>
                <tr><td><b>기준 (${volMl().toLocaleString()} mL)</b></td><td class="c">100%</td><td class="c"><b>${g(w)}</b></td><td class="c">${kg(w)}</td></tr>
                <tr><td>최고</td><td class="c">+${s.tolMax}%</td><td class="c">${g(w * (1 + num(s.tolMax) / 100))}</td><td class="c">${kg(w * (1 + num(s.tolMax) / 100))}</td></tr></tbody></table>`;
        } else {
            const o = s[s.tab]; const { target, sg, tare } = baseOf(o);
            const rows = o.lines.map((ln, i) => {
                const raw = num(ln.v); const net = Number.isFinite(raw) ? Math.max(0, raw * (ln.u === 'kg' ? 1000 : 1) - tare) : NaN; const diff = net - target;
                return `<tr><td class="c">Line ${i + 1}</td>${s.tab === 'auto' ? `<td class="c">${esc(String(ln.m ?? ''))}</td>` : ''}<td class="c">${Number.isFinite(raw) ? g(net) : '-'}</td><td class="c">${Number.isFinite(diff) ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)} g` : '-'}</td><td class="c">${Number.isFinite(diff) && sg > 0 ? ml(-diff / sg, true) : '-'}</td>${s.tab === 'auto' ? `<td class="c"><b>${Number.isFinite(diff) ? `${((num(ln.m) || 0) - diff).toFixed(1)} g` : '-'}</b></td>` : ''}<td class="c">${STATE[stateOf(diff)][0]}</td></tr>`;
            }).join('');
            bodyHtml += `<p style="margin:2mm 0">목표 ${g(target)} · 적용 비중 ${sg.toFixed(4)}${tare ? ` · 용기 ${g(tare)} 차감` : ''}</p>
                <table class="grid"><thead><tr><th>라인</th>${s.tab === 'auto' ? '<th>기계 기록값</th>' : ''}<th>순중량</th><th>중량 오차</th><th>부피 조정</th>${s.tab === 'auto' ? '<th>권장 기계값</th>' : ''}<th>판정</th></tr></thead><tbody>${rows}</tbody></table>`;
        }
        printA4({ title: '윤활유 충진 보정 결과', subtitle: TABS.find(t => t[0] === s.tab)?.[1] || '', meta: [['계산일', new Date().toLocaleString('ko-KR')]], bodyHtml, approvals: ['작성', '확인'] });
    });

    draw();
};
