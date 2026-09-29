import Chart from 'chart.js/auto';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { applyChartTheme } from '../services/darkTheme.js';
import { printA4 } from './plans/planCommon.js';
import { saeHotGradesFor } from '../services/qcProductSpecs.js';
import {
    BLEND_METHODS, blendViscosity, blendRatioFor, viscosityIndex, kv100For, kv40For, viGrade, waltherFit,
    D1250_GROUPS, density15, SIMPLE_COEF, sg15Simple
} from '../services/viscosity.js';

/**
 * TOOL → 점도·비중 계산기 (탭 viscCalc)
 * 윤활유 및 석유제품 계산기 웹앱(viscosity-sg-calculator)을 WMS에 맞게 옮기고 보완했다. 계산식은 services/viscosity.js
 *  1. 2종 혼합 · 2. 목표 점도 비율 · 3. 다성분 혼합 (ÖleZol / Refutas 선택)
 *  4. 점도지수(ASTM D2270) 산출·역산 + SAE 점도등급 · 5. 온도별 동점도(ASTM D341) · 6. 15℃ 비중(ASTM D1250 / 간이 계수)
 * 입력값은 이 기기에 기억한다 (daelim_visc_calc).
 */
const PREF_KEY = 'daelim_visc_calc';
const TABS = [
    ['blend2', '2종 혼합', 'git-merge'], ['ratio', '목표 점도 비율', 'target'], ['multi', '다성분 혼합', 'layers'],
    ['vi', '점도지수 (VI)', 'trending-up'], ['temp', '온도별 동점도', 'thermometer'], ['sg', '15℃ 비중 환산', 'flask-conical']
];
const DEF = {
    tab: 'blend2', method: 'OLEZOL',
    b2: { v1: 30, v2: 90, r1: 59.07 }, ratio: { v1: 30, v2: 90, vt: 46 },
    multi: [{ n: 'Base Oil #1', v: 32, w: 40 }, { n: 'Base Oil #2', v: 68, w: 45 }, { n: 'Base Oil #3', v: 150, w: 15 }],
    vi: { mode: 1, kv40: 66.67, kv100: 11.35, target: 165 },
    temp: { t1: 40, v1: 66.67, t2: 100, v2: 11.35, list: '-30, -20, 0, 20, 25, 40, 50, 80, 100, 120, 150' },
    sg: { t: 40, val: 0.845, group: 'LUBE', simple: '윤활유' }
};
const loadPref = () => { try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); return p ? { ...structuredClone(DEF), ...p } : structuredClone(DEF); } catch (e) { console.warn('[점도 계산기] 저장한 입력을 읽지 못했습니다', e); return structuredClone(DEF); } };
const savePref = (s) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(s)); } catch (e) { console.warn('[점도 계산기] 입력을 기억하지 못했습니다', e); } };
const n = (v) => { const x = Number(String(v).replace(/,/g, '')); return Number.isFinite(x) ? x : NaN; };
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const INP = 'w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none';
const card = (title, body, cls = '') => `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 ${cls}"><h3 class="text-sm font-black text-slate-800 border-b border-slate-100 pb-2 mb-3">${title}</h3>${body}</div>`;
const field = (label, id, value, attrs = '') => `<label class="block"><span class="block text-xs font-bold text-slate-600 mb-1">${label}</span><input type="number" step="any" id="${id}" value="${esc(value)}" class="${INP}" ${attrs} /></label>`;
const big = (label, id, color = 'blue') => `<div class="bg-${color}-50 border border-${color}-200 rounded-xl p-4"><div class="text-[11px] font-black text-${color}-600">${label}</div><div id="${id}" class="text-3xl font-black text-${color}-900 mt-1">-</div></div>`;

export const renderViscosityCalculator = (container) => {
    const s = loadPref();
    applyChartTheme(Chart); // 어두운 테마면 글자·선 색
    let chart = null;
    const destroyChart = () => { chart?.destroy(); chart = null; };

    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 class="text-lg font-black text-slate-900 flex items-center gap-2"><i data-lucide="beaker" class="w-5 h-5 text-blue-600"></i>점도·비중 계산기</h2>
                <p class="text-xs text-slate-500 mt-0.5">혼합 점도(ÖleZol·Refutas) · 점도지수(ASTM D2270) · 온도별 동점도(ASTM D341) · 15℃ 비중(ASTM D1250). 입력은 이 기기에 기억합니다.</p>
            </div>
            <button type="button" id="vc-print" class="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white flex items-center gap-1.5"><i data-lucide="printer" class="w-4 h-4"></i>계산 결과 인쇄</button>
        </div>
        <div class="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold" id="vc-tabs"></div>
        <div id="vc-body"></div>
    </section>`;
    const $ = (q) => container.querySelector(q);
    const paintTabs = () => {
        $('#vc-tabs').innerHTML = TABS.map(([k, l, ic]) => `<button type="button" data-t="${k}" class="px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${s.tab === k ? 'bg-white shadow-sm text-blue-700 font-black' : 'text-slate-600 hover:text-slate-900'}"><i data-lucide="${ic}" class="w-3.5 h-3.5"></i>${l}</button>`).join('');
        container.querySelectorAll('#vc-tabs [data-t]').forEach(b => b.addEventListener('click', () => { s.tab = b.dataset.t; savePref(s); draw(); }));
    };
    const methodSel = () => `<label class="block"><span class="block text-xs font-bold text-slate-600 mb-1">혼합 계산 방식</span><select id="vc-method" class="${INP}">${Object.entries(BLEND_METHODS).map(([k, m]) => `<option value="${k}" ${s.method === k ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>`;
    const bindMethod = (redo) => $('#vc-method')?.addEventListener('change', (e) => { s.method = e.target.value; savePref(s); redo(); });
    const lineChart = (canvas, labels, data, label) => {
        destroyChart();
        chart = new Chart(canvas.getContext('2d'), { type: 'line', data: { labels, datasets: [{ label, data, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.1)', fill: true, tension: 0.3, pointRadius: 2 }] }, options: { responsive: true, maintainAspectRatio: false, animation: false } });
    };
    const saeHtml = (kv100) => {
        const gs = Number.isFinite(kv100) ? saeHotGradesFor(kv100) : [];
        return gs.length ? `SAE 고온 등급: ${gs.map(g => `<b>${g.grade}</b> <span class="text-slate-400">(${g.lo}~${g.hi} 미만, HTHS ${g.hths} 이상)</span>`).join(' · ')}` : 'SAE 고온 등급 범위 밖 (4.0 ~ 26.1 ㎟/s)';
    };

    // ---------- 1. 2종 혼합 ----------
    const drawBlend2 = (body) => {
        body.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            ${card('기본유 입력', `<div class="space-y-3">${methodSel()}${field('성분 #1 동점도 (cSt)', 'b2-v1', s.b2.v1)}${field('성분 #2 동점도 (cSt)', 'b2-v2', s.b2.v2)}
                <div><div class="flex items-center justify-between text-xs font-bold text-slate-600 mb-1"><span>성분 #1 비율 (%)</span><span class="flex items-center gap-1"><input type="number" step="0.01" min="0" max="100" id="b2-r1n" value="${s.b2.r1}" class="w-24 border border-slate-300 rounded px-1.5 py-1 text-right text-blue-700 font-black" />%</span></div>
                <input type="range" id="b2-r1" min="0" max="100" step="0.01" value="${s.b2.r1}" class="w-full accent-blue-600" /><div class="text-[11px] text-slate-500 mt-1">성분 #2 비율: <b id="b2-r2">-</b></div></div></div>`)}
            ${card('혼합 점도 예측', `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">${big('최종 혼합 동점도', 'b2-res')}<div class="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-1"><div class="flex justify-between"><span class="text-slate-500">혼합지수</span><b id="b2-idx">-</b></div><div class="flex justify-between"><span class="text-slate-500">다른 방식 결과</span><b id="b2-alt">-</b></div></div></div>
                <div class="h-60"><canvas id="b2-chart"></canvas></div><p class="text-[11px] text-slate-400 mt-1">가로축 = 성분 #1 비율. 비율은 중량% 기준(Refutas), 부피비와 비중 차이가 크면 결과가 달라집니다.</p>`, 'lg:col-span-2')}
        </div>`;
        const calc = () => {
            const v1 = n($('#b2-v1').value), v2 = n($('#b2-v2').value), r1 = Math.min(100, Math.max(0, n($('#b2-r1').value) || 0));
            s.b2 = { v1, v2, r1 }; savePref(s);
            const parts = [{ v: v1, w: r1 }, { v: v2, w: 100 - r1 }];
            const res = blendViscosity(parts, s.method);
            const alt = blendViscosity(parts, s.method === 'OLEZOL' ? 'REFUTAS' : 'OLEZOL');
            $('#b2-r2').textContent = `${f(100 - r1)}%`;
            $('#b2-res').textContent = `${f(res.v)} cSt`;
            $('#b2-idx').textContent = f(res.index, 4);
            $('#b2-alt').textContent = `${f(alt.v)} cSt`;
            const labels = []; const data = [];
            for (let i = 0; i <= 100; i += 10) { labels.push(`${i}%`); data.push(+f(blendViscosity([{ v: v1, w: i }, { v: v2, w: 100 - i }], s.method).v)); }
            lineChart($('#b2-chart'), labels, data, '성분 #1 비율별 혼합 동점도 (cSt)');
        };
        ['#b2-v1', '#b2-v2'].forEach(q => $(q).addEventListener('input', calc));
        $('#b2-r1').addEventListener('input', () => { $('#b2-r1n').value = $('#b2-r1').value; calc(); });
        $('#b2-r1n').addEventListener('input', () => { $('#b2-r1').value = Math.min(100, Math.max(0, n($('#b2-r1n').value) || 0)); calc(); });
        bindMethod(calc);
        calc();
    };

    // ---------- 2. 목표 점도 비율 ----------
    const drawRatio = (body) => {
        body.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            ${card('목표 점도 조건', `<div class="space-y-3">${methodSel()}${field('성분 #1 동점도 (cSt)', 'ra-v1', s.ratio.v1)}${field('성분 #2 동점도 (cSt)', 'ra-v2', s.ratio.v2)}${field('목표 혼합 동점도 (cSt)', 'ra-vt', s.ratio.vt)}
                ${field('만들 양 (선택, kg 또는 L)', 'ra-qty', s.ratio.qty ?? '', 'placeholder="예: 200"')}</div>`)}
            ${card('필요 혼합 비율', `<div id="ra-err" class="hidden p-3 mb-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">목표 점도는 성분 #1과 #2 점도 사이여야 합니다.</div>
                <div class="grid grid-cols-2 gap-3">${big('성분 #1 비율', 'ra-r1')}${big('성분 #2 비율', 'ra-r2', 'indigo')}</div>
                <div id="ra-qtyres" class="mt-3 text-sm text-slate-700"></div>`, 'lg:col-span-2')}
        </div>`;
        const calc = () => {
            const v1 = n($('#ra-v1').value), v2 = n($('#ra-v2').value), vt = n($('#ra-vt').value), qty = n($('#ra-qty').value);
            s.ratio = { v1, v2, vt, qty: Number.isFinite(qty) ? qty : '' }; savePref(s);
            const r1 = blendRatioFor(v1, v2, vt, s.method);
            $('#ra-err').classList.toggle('hidden', r1 != null);
            $('#ra-r1').textContent = r1 == null ? '-' : `${f(r1)} %`;
            $('#ra-r2').textContent = r1 == null ? '-' : `${f(100 - r1)} %`;
            $('#ra-qtyres').innerHTML = r1 != null && qty > 0 ? `${f(qty, 1)} 만들 때: 성분 #1 <b class="text-blue-700">${f(qty * r1 / 100, 2)}</b> · 성분 #2 <b class="text-indigo-700">${f(qty * (100 - r1) / 100, 2)}</b> (같은 단위)` : '';
        };
        ['#ra-v1', '#ra-v2', '#ra-vt', '#ra-qty'].forEach(q => $(q).addEventListener('input', calc));
        bindMethod(calc);
        calc();
    };

    // ---------- 3. 다성분 혼합 ----------
    const drawMulti = (body) => {
        const rowsHtml = () => s.multi.map((p, i) => `<tr class="border-t border-slate-100">
            <td class="p-1.5"><input data-i="${i}" data-k="n" value="${esc(p.n)}" class="w-full border border-slate-300 rounded px-2 py-1.5 text-xs font-bold" /></td>
            <td class="p-1.5"><input type="number" step="any" data-i="${i}" data-k="v" value="${esc(p.v)}" class="w-full border border-slate-300 rounded px-2 py-1.5 text-xs" /></td>
            <td class="p-1.5"><input type="number" step="any" data-i="${i}" data-k="w" value="${esc(p.w)}" class="w-full border border-slate-300 rounded px-2 py-1.5 text-xs" /></td>
            <td class="p-1.5 text-center"><button type="button" data-del="${i}" class="text-rose-500 font-black px-1" title="빼기">×</button></td></tr>`).join('');
        body.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            ${card('성분별 동점도·비율', `<div class="mb-3">${methodSel()}</div><div class="overflow-x-auto"><table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600"><tr><th class="p-2 text-left">성분명</th><th class="p-2 text-left w-32">동점도 (cSt)</th><th class="p-2 text-left w-32">비율 (Wt%)</th><th class="w-8"></th></tr></thead><tbody id="mu-rows">${rowsHtml()}</tbody></table></div>
                <div class="flex flex-wrap items-center justify-between gap-2 mt-2"><button type="button" id="mu-add" class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold">＋ 성분 추가 (최대 10)</button><span id="mu-sum" class="text-xs"></span></div>`, 'lg:col-span-2')}
            ${card('다성분 혼합 결과', `${big('최종 혼합 동점도', 'mu-res', 'indigo')}<div class="text-[11px] text-slate-500 mt-2" id="mu-note"></div><div class="h-48 mt-3"><canvas id="mu-chart"></canvas></div>`)}
        </div>`;
        const calc = () => {
            savePref(s);
            const res = blendViscosity(s.multi.map(p => ({ v: n(p.v), w: n(p.w) })), s.method);
            const off = Math.abs(res.total - 100) > 0.05;
            $('#mu-sum').innerHTML = `비율 합계 <b class="${off ? 'text-amber-600' : 'text-emerald-700'}">${f(res.total, 2)}%</b>${off ? ' · 100%가 아니면 비율대로 나눠 계산합니다' : ''}`;
            $('#mu-res').textContent = `${f(res.v)} cSt`;
            $('#mu-note').textContent = `${BLEND_METHODS[s.method].label} · 혼합지수 ${f(res.index, 4)}`;
            destroyChart();
            const ok = s.multi.filter(p => n(p.w) > 0);
            chart = new Chart($('#mu-chart').getContext('2d'), { type: 'doughnut', data: { labels: ok.map(p => p.n), datasets: [{ data: ok.map(p => n(p.w)), backgroundColor: ['#2563eb', '#4f46e5', '#06b6d4', '#64748b', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#a3a3a3'] }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } } });
        };
        const bindRows = () => {
            container.querySelectorAll('#mu-rows [data-k]').forEach(el => el.addEventListener('input', () => { s.multi[Number(el.dataset.i)][el.dataset.k] = el.dataset.k === 'n' ? el.value : n(el.value); calc(); }));
            container.querySelectorAll('#mu-rows [data-del]').forEach(b => b.addEventListener('click', () => { if (s.multi.length <= 2) return; s.multi.splice(Number(b.dataset.del), 1); $('#mu-rows').innerHTML = rowsHtml(); bindRows(); calc(); }));
        };
        $('#mu-add').addEventListener('click', () => { if (s.multi.length >= 10) return; s.multi.push({ n: `성분 #${s.multi.length + 1}`, v: 0, w: 0 }); $('#mu-rows').innerHTML = rowsHtml(); bindRows(); calc(); });
        bindRows(); bindMethod(calc); calc();
    };

    // ---------- 4. 점도지수 ----------
    const drawVi = (body) => {
        const m = s.vi.mode;
        const modes = [[1, '점도지수(VI) 산출'], [2, '100℃ 동점도 역산'], [3, '40℃ 동점도 역산']];
        body.innerHTML = `<div class="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold w-fit mb-3">${modes.map(([k, l]) => `<button type="button" data-m="${k}" class="px-3 py-1.5 rounded-lg ${m === k ? 'bg-white shadow-sm text-blue-700 font-black' : 'text-slate-600'}">${l}</button>`).join('')}</div>
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            ${card('입력 (ASTM D2270)', `<div class="space-y-3">${m !== 3 ? field('40℃ 동점도 KV40 (cSt)', 'vi-kv40', s.vi.kv40) : ''}${m !== 2 ? field('100℃ 동점도 KV100 (cSt)', 'vi-kv100', s.vi.kv100) : ''}${m !== 1 ? field('목표 점도지수 (VI)', 'vi-target', s.vi.target) : ''}</div>`)}
            ${card('결과', `<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div class="bg-slate-900 text-white rounded-xl p-4 text-center flex flex-col items-center justify-center"><div class="text-[11px] text-slate-400 font-bold">${m === 1 ? '점도지수 (VI)' : m === 2 ? '100℃ 동점도 (KV100)' : '40℃ 동점도 (KV40)'}</div><div id="vi-res" class="text-4xl font-black text-blue-300 my-1">-</div><div id="vi-grade" class="text-[11px] font-bold px-2 py-0.5 rounded-full"></div></div>
                <div class="md:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1.5" id="vi-detail"></div></div>
                <div id="vi-sae" class="text-xs text-slate-600 mt-3 p-2.5 rounded-lg bg-indigo-50 border border-indigo-100"></div>
                <p class="text-[11px] text-slate-400 mt-2">L·H는 ASTM D2270 표값, 표에 없는 KV100은 로그 보간, 70 ㎟/s 초과는 규격 식. 공식 성적서 값은 시험기관 표를 따르세요.</p>`, 'lg:col-span-2')}
        </div>`;
        const calc = () => {
            const kv40 = n($('#vi-kv40')?.value ?? s.vi.kv40), kv100 = n($('#vi-kv100')?.value ?? s.vi.kv100), target = n($('#vi-target')?.value ?? s.vi.target);
            s.vi = { ...s.vi, kv40, kv100, target }; savePref(s);
            const grade = $('#vi-grade');
            let used100 = NaN;
            if (m === 1) {
                const r = viscosityIndex(kv40, kv100);
                if (!r) { $('#vi-res').textContent = '-'; $('#vi-detail').innerHTML = '<span class="text-rose-600 font-bold">KV40 > 0, KV100 ≥ 2.0 ㎟/s 이어야 합니다.</span>'; grade.textContent = ''; }
                else {
                    const [gl, gc] = viGrade(r.vi);
                    $('#vi-res').textContent = Math.round(r.vi);
                    grade.textContent = gl; grade.className = `text-[11px] font-bold px-2 py-0.5 rounded-full text-white ${gc}`;
                    $('#vi-detail').innerHTML = `<div class="flex justify-between border-b pb-1"><span class="text-slate-500">L (VI 0 기준 KV40)</span><b>${f(r.l)} cSt</b></div><div class="flex justify-between border-b pb-1"><span class="text-slate-500">H (VI 100 기준 KV40)</span><b>${f(r.h)} cSt</b></div><div class="flex justify-between"><span class="text-slate-500">적용 식</span><b class="text-blue-700">ASTM D2270 Procedure ${r.proc} (${r.proc === 'A' ? 'VI ≤ 100' : 'VI > 100'})</b></div><div class="flex justify-between"><span class="text-slate-500">소수점 값</span><b>${f(r.vi, 1)}</b></div>`;
                }
                used100 = kv100;
            } else if (m === 2) {
                const y = kv100For(kv40, target);
                $('#vi-res').textContent = y == null ? '-' : `${f(y)}`;
                grade.textContent = y == null ? '' : 'cSt'; grade.className = 'text-[11px] font-bold text-slate-300';
                $('#vi-detail').innerHTML = y == null ? '<span class="text-rose-600 font-bold">이 KV40·VI로는 KV100을 구할 수 없습니다 (2 ㎟/s 이상 범위).</span>' : `<div>KV40 <b>${f(kv40)}</b> cSt, 목표 VI <b>${f(target, 0)}</b>가 되는 KV100 = <b class="text-blue-700">${f(y, 3)} cSt</b></div><div class="text-slate-500">이분법으로 VI 식을 거꾸로 풀었습니다 (검산 VI ${f(viscosityIndex(kv40, y)?.vi, 1)}).</div>`;
                used100 = y ?? NaN;
            } else {
                const u = kv40For(kv100, target);
                $('#vi-res').textContent = u == null ? '-' : `${f(u)}`;
                grade.textContent = u == null ? '' : 'cSt'; grade.className = 'text-[11px] font-bold text-slate-300';
                $('#vi-detail').innerHTML = u == null ? '<span class="text-rose-600 font-bold">KV100 ≥ 2.0 ㎟/s 이어야 합니다.</span>' : `<div>KV100 <b>${f(kv100)}</b> cSt, 목표 VI <b>${f(target, 0)}</b>가 되는 KV40 = <b class="text-blue-700">${f(u, 2)} cSt</b></div><div class="text-slate-500">${target <= 100 ? 'U = L − VI/100 × (L − H)' : 'log U = log H − N × log KV100'} (검산 VI ${f(viscosityIndex(u, kv100)?.vi, 1)})</div>`;
                used100 = kv100;
            }
            $('#vi-sae').innerHTML = saeHtml(used100);
        };
        container.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { s.vi.mode = Number(b.dataset.m); savePref(s); drawVi(body); createIcons({ icons }); }));
        ['#vi-kv40', '#vi-kv100', '#vi-target'].forEach(q => $(q)?.addEventListener('input', calc));
        calc();
    };

    // ---------- 5. 온도별 동점도 ----------
    const drawTemp = (body) => {
        body.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            ${card('측정 동점도 2점 (ASTM D341)', `<div class="grid grid-cols-2 gap-2">${field('온도 1 (℃)', 'tp-t1', s.temp.t1)}${field('동점도 1 (cSt)', 'tp-v1', s.temp.v1)}${field('온도 2 (℃)', 'tp-t2', s.temp.t2)}${field('동점도 2 (cSt)', 'tp-v2', s.temp.v2)}</div>
                <label class="block mt-3"><span class="block text-xs font-bold text-slate-600 mb-1">알고 싶은 온도 (쉼표로)</span><input id="tp-list" value="${esc(s.temp.list)}" class="${INP}" /></label>
                <p class="text-[11px] text-slate-400 mt-2">보통 40℃·100℃ 동점도를 넣습니다. 측정 범위 밖(특히 저온)은 추정값이며, 첨가제(VII)가 든 제품은 오차가 커집니다.</p>`)}
            ${card('온도별 동점도 예측', `<div class="overflow-x-auto"><table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600"><tr><th class="p-2 text-left">온도 (℃)</th><th class="p-2 text-right">동점도 (cSt)</th><th class="p-2 text-left">비고</th></tr></thead><tbody id="tp-rows"></tbody></table></div><div class="h-56 mt-3"><canvas id="tp-chart"></canvas></div>`, 'lg:col-span-2')}
        </div>`;
        const calc = () => {
            const t1 = n($('#tp-t1').value), v1 = n($('#tp-v1').value), t2 = n($('#tp-t2').value), v2 = n($('#tp-v2').value), list = $('#tp-list').value;
            s.temp = { t1, v1, t2, v2, list }; savePref(s);
            const fit = waltherFit(t1, v1, t2, v2);
            if (!fit) { $('#tp-rows').innerHTML = '<tr><td colspan="3" class="p-4 text-center text-rose-600 font-bold">두 온도가 달라야 하고 동점도는 0보다 커야 합니다.</td></tr>'; destroyChart(); return; }
            const temps = [...new Set(list.split(/[,\s]+/).map(n).filter(Number.isFinite))].sort((a, b) => a - b);
            const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
            $('#tp-rows').innerHTML = temps.map(t => { const v = fit(t); return `<tr class="border-t border-slate-100"><td class="p-2 font-bold">${t}</td><td class="p-2 text-right font-mono font-bold ${t < lo || t > hi ? 'text-amber-700' : 'text-slate-800'}">${v >= 1000 ? Math.round(v).toLocaleString() : f(v, v < 10 ? 3 : 2)}</td><td class="p-2 text-slate-400">${t === t1 || t === t2 ? '입력값' : t < lo || t > hi ? '측정 범위 밖 (추정)' : ''}</td></tr>`; }).join('');
            const xs = []; for (let t = Math.min(-20, lo); t <= Math.max(150, hi); t += 10) xs.push(t);
            destroyChart();
            chart = new Chart($('#tp-chart').getContext('2d'), { type: 'line', data: { labels: xs.map(t => `${t}℃`), datasets: [{ label: '동점도 (cSt, 로그 눈금)', data: xs.map(t => +fit(t).toFixed(3)), borderColor: '#2563eb', tension: 0.3, pointRadius: 2 }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { type: 'logarithmic' } } } });
        };
        ['#tp-t1', '#tp-v1', '#tp-t2', '#tp-v2', '#tp-list'].forEach(q => $(q).addEventListener('input', calc));
        calc();
    };

    // ---------- 6. 15℃ 비중 ----------
    const drawSg = (body) => {
        body.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            ${card('측정 데이터', `<div class="space-y-3">${field('측정 온도 (℃)', 'sg-t', s.sg.t)}${field('측정 밀도 또는 비중 (t/4℃, g/㎤ 또는 kg/㎥)', 'sg-val', s.sg.val)}
                <label class="block"><span class="block text-xs font-bold text-slate-600 mb-1">유종 (ASTM D1250 표)</span><select id="sg-group" class="${INP}">${Object.entries(D1250_GROUPS).map(([k, g]) => `<option value="${k}" ${s.sg.group === k ? 'selected' : ''}>${esc(g.label)} · ${esc(g.range)}</option>`).join('')}</select></label>
                <label class="block"><span class="block text-xs font-bold text-slate-600 mb-1">간이 계수법 유종 (비교용)</span><select id="sg-simple" class="${INP}">${Object.entries(SIMPLE_COEF).map(([k, c]) => `<option value="${k}" ${s.sg.simple === k ? 'selected' : ''}>${k} (${c.toFixed(5)}/℃)</option>`).join('')}</select></label></div>`)}
            ${card('15℃ 환산 결과', `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${big('15℃ 비중 (15/4℃, ASTM D1250)', 'sg-res', 'emerald')}${big('15℃ 밀도 (kg/㎥)', 'sg-rho', 'teal')}</div>
                <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 mt-3 text-xs space-y-1.5" id="sg-detail"></div>
                <p class="text-[11px] text-slate-400 mt-2">ASTM D1250(API MPMS 11.1, 1980) 부피보정계수 VCF = exp(−α15·Δt·(1+0.8·α15·Δt))로 거꾸로 풀었습니다. 유리 비중계의 팽창 보정은 넣지 않았습니다. 앱의 원료·제품 비중(15/4℃)과 같은 기준입니다.</p>`, 'lg:col-span-2')}
        </div>`;
        const calc = () => {
            const t = n($('#sg-t').value), val = n($('#sg-val').value), group = $('#sg-group').value, simple = $('#sg-simple').value;
            s.sg = { t, val, group, simple }; savePref(s);
            const r = density15(val, t, group);
            if (!r) { $('#sg-res').textContent = '-'; $('#sg-rho').textContent = '-'; $('#sg-detail').innerHTML = '<span class="text-rose-600 font-bold">온도와 밀도(비중)를 넣으세요.</span>'; return; }
            const sgT = val < 2 ? val : val / 1000;
            const simpleSg = sg15Simple(sgT, t, simple);
            $('#sg-res').textContent = f(r.sg154, 4);
            $('#sg-rho').textContent = f(r.rho15, 1);
            $('#sg-detail').innerHTML = `<div class="flex justify-between border-b pb-1"><span class="text-slate-500">부피보정계수 VCF (${f(t, 1)}℃ → 15℃)</span><b>${f(r.vcf, 5)}</b></div>
                <div class="flex justify-between border-b pb-1"><span class="text-slate-500">비중 15/15℃ (≈ 60/60℉)</span><b>${f(r.sg1515, 4)}</b></div>
                <div class="flex justify-between border-b pb-1"><span class="text-slate-500">간이 계수법 (${esc(simple)})</span><b>${f(simpleSg, 4)}</b> <span class="text-slate-400">차이 ${f(simpleSg - r.sg154, 4)}</span></div>
                <div class="flex justify-between"><span class="text-slate-500">1,000 L (15℃) 무게</span><b>${f(r.rho15, 1)} kg</b></div>`;
        };
        ['#sg-t', '#sg-val'].forEach(q => $(q).addEventListener('input', calc));
        ['#sg-group', '#sg-simple'].forEach(q => $(q).addEventListener('change', calc));
        calc();
    };

    const DRAW = { blend2: drawBlend2, ratio: drawRatio, multi: drawMulti, vi: drawVi, temp: drawTemp, sg: drawSg };
    const draw = () => {
        destroyChart();
        paintTabs();
        (DRAW[s.tab] || drawBlend2)($('#vc-body'));
        createIcons({ icons });
    };

    // 지금 보이는 계산 입력·결과를 A4로 (입력칸 값과 결과 글자를 표로 모은다)
    $('#vc-print').addEventListener('click', () => {
        const body = $('#vc-body');
        const rows = [];
        body.querySelectorAll('label').forEach(l => { const inp = l.querySelector('input, select'); const t = l.querySelector('span')?.textContent?.trim(); if (inp && t) rows.push([t, inp.tagName === 'SELECT' ? inp.selectedOptions[0]?.textContent : inp.value]); });
        const results = [...body.querySelectorAll('[id$="-res"], [id$="-r1"]:not(input), [id$="-r2"]:not(input), [id$="-rho"]')].filter(e => e.textContent.trim() && e.tagName !== 'INPUT').map(e => [e.previousElementSibling?.textContent?.trim() || '결과', e.textContent.trim()]);
        const table = body.querySelector('table');
        const extra = [body.querySelector('#vi-detail, #b2-idx')?.closest('div')?.innerText, body.querySelector('#vi-sae')?.innerText, body.querySelector('#sg-detail')?.innerText, body.querySelector('#mu-note')?.innerText].filter(Boolean).join('\n');
        const tabLabel = TABS.find(t => t[0] === s.tab)?.[1] || '';
        printA4({
            title: '점도·비중 계산 결과', subtitle: tabLabel, meta: [['계산일', new Date().toLocaleDateString('ko-KR')]],
            bodyHtml: `<table class="grid"><thead><tr><th style="width:55%">입력</th><th>값</th></tr></thead><tbody>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="c">${esc(b)}</td></tr>`).join('')}</tbody></table>
                <table class="grid" style="margin-top:3mm"><thead><tr><th style="width:55%">결과</th><th>값</th></tr></thead><tbody>${results.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="c"><b>${esc(b)}</b></td></tr>`).join('')}</tbody></table>
                ${table && s.tab === 'temp' ? `<div style="margin-top:3mm">${table.outerHTML.replace(/class="[^"]*"/g, '').replace('<table', '<table class="grid"')}</div>` : ''}
                ${extra ? `<p style="margin-top:3mm;font-size:9pt;white-space:pre-line">${esc(extra)}</p>` : ''}`,
            approvals: []
        });
    });

    draw();
};
