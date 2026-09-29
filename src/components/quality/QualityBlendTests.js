// 품질관리 원액 품질 (services/qcProductSpecs.js)
//   공정관리 → 원액생산 → 검사 기록·관리도 (kind BTEST): 제품 종류별 검사항목(유성 외관·비중·동점도 / 수용성 외관·비중·pH)
//     값 입력 → 규격으로 자동 판정, 제품·항목별 X-MR 관리도(관리한계·규격한계·Cp·Cpk)
//   제품관리 → 제품 규격 (kind QCSPEC): 작업지시서(제조시방서)의 구분·종류·검사항목을 가져와 KS·SAE·API·ACEA·DOT4를 합친 제품별 규격
//     제품시험성적서가 이 규격과 원액 검사 결과를 불러 쓴다.
// 작업지시서는 권한 있는 사람만 불러온다 (원료 실명·배합비는 쓰지 않음, 품목코드는 전체 권한일 때만).
import { esc } from '../../services/html.js';
import { state } from '../../services/db.js';
import { localDateStr } from '../../services/searchUtils.js';
import { hasWorklogAccess, hasWoUserAccess } from '../../services/auth.js';
import { secure, loadSecureData } from '../../services/secureWorkOrders.js';
import { canConfigQc, canDeleteQc, deleteQc } from '../../services/quality.js';
import { QC_SITES, siteOf } from '../../services/qcStandards.js';
import {
    PRODUCT_TYPES, QC_ITEM_DEFS, SAE_GRADES, AF_KINDS, API_GRADES, ACEA_GRADES, buildItems, processKeysOf, judgeValue, parseSpec,
    listSpecs, saveSpec, deleteSpec, listBlendTests, saveBlendTest, syncSpecsFromProducts, findSpecFor, guessSpecType, isWaterBased, xmrStats
} from '../../services/qcProductSpecs.js';
import { printA4, btn } from '../plans/planCommon.js';
import { INPUT_CLS, siteBadge, siteSelectHtml, inScope, scopeLabel, openModal, listCardHtml, emptyRow, inPeriod } from './qcCommon.js';
import { loadWorkOrders } from './QualityProcessCheck.js';

const JUDGE = { OK: '적합', NG: '부적합' };
const JCLS = { OK: 'text-emerald-700 font-bold', NG: 'text-rose-600 font-black' };
const canSync = () => hasWorklogAccess() || hasWoUserAccess();
const canEditSpec = () => canConfigQc() || canSync();
// 종합 판정: 결과를 넣은 항목만 본다 (부적합 하나라도 → 부적합, 모두 적합(글자 항목은 판정 없음도 허용) → 적합)
const overallOf = (items) => {
    const done = items.filter(i => String(i.result || '').trim());
    if (done.some(i => i.judge === 'NG')) return 'NG';
    return done.length && done.every(i => i.judge === 'OK' || (i.numeric === false && !i.judge)) ? 'OK' : '';
};
const typeLabel = (s) => `${PRODUCT_TYPES[s.type]?.label || '유성'}${s.waterBased && s.type !== 'WATER' ? ' · 수용성' : ''}`;
const optLabel = (s) => {
    const o = s.options || {};
    if (s.type === 'ENGINE') return [o.sae, ...(o.api || []).map(g => `API ${g}`), ...(o.acea || []).map(g => `ACEA ${g}`)].filter(Boolean).join(' · ');
    if (s.type === 'BRAKE') return [`KS ${o.brakeClass === '6' ? '6' : '4'}종`, o.dot4 ? 'DOT4' : ''].filter(Boolean).join(' · ');
    if (s.type === 'ANTIFREEZE') return AF_KINDS[o.afKind] || AF_KINDS.EG2;
    return '';
};
// 엔진오일 SAE 점도등급 항목 요약 (100℃ 동점도·저온 겉보기점도·저온 펌핑점도·HTHS·점도지수)
const VISC_SHORT = { kv100: '100℃ 동점도', ccs: '저온 겉보기점도', mrv: '저온 펌핑점도', hths: 'HTHS', vi: '점도지수' };
const viscSummaryHtml = (s, items) => {
    if (s.type !== 'ENGINE' || !s.options?.sae) return '';
    const parts = items.filter(i => VISC_SHORT[i.key] && i.spec).map(i => `<span class="${i.conflict ? 'text-rose-600 font-bold' : ''}">${VISC_SHORT[i.key]} ${esc(i.spec)}</span>`);
    return parts.length ? `<div class="text-[10px] text-indigo-700 leading-snug mt-0.5">${parts.join(' · ')}</div>` : '';
};
const numOf = (v) => { const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const errBox = (e) => `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(e.message)}</div>`;

// ---------- 작업지시서 → 제품 목록 ----------
/** 제품별로 최신 제조시방서(전체 권한) 또는 작업지시서(작업지시서 사용자)에서 구분·종류·검사항목을 모은다 */
export const loadWoProducts = async () => {
    if (hasWorklogAccess()) {
        await loadSecureData();
        const by = new Map();
        secure.recipes.filter(r => r.active !== false && !r.archived).forEach(r => {
            const k = String(r.productName || '').trim();
            const prev = by.get(k);
            if (!prev || String(r.updatedAt || '') > String(prev.updatedAt || '')) by.set(k, r);
        });
        return [...by.values()].map(r => ({ productName: r.productName, itemCode: r.productItemCode || '', category: r.category || '', subCategory: r.subCategory || '', qcItems: r.qcItems || [], revision: r.revision || '', recipeId: r.id }));
    }
    if (hasWoUserAccess()) {
        const { list } = await loadWorkOrders();
        const by = new Map();
        list.forEach(o => { const k = String(o.productName || '').trim(); if (k && !by.has(k) && o.qcItems.length) by.set(k, { productName: k, itemCode: '', category: o.category, subCategory: o.subCategory, qcItems: o.qcItems, revision: '', recipeId: o.recipeId }); });
        return [...by.values()];
    }
    return [];
};

const runSync = async (showToast) => {
    const products = await loadWoProducts();
    if (!products.length) throw new Error('불러올 작업지시서(제조시방서)가 없거나 볼 권한이 없습니다.');
    const res = await syncSpecsFromProducts(products, await listSpecs());
    showToast(`🔄 작업지시서 ${products.length}개 제품 확인: 새 규격 ${res.created}건 · 바뀐 규격 ${res.updated}건 · 그대로 ${res.same}건`);
    return res;
};

// ---------- 공용: 구분·종류 거르기 ----------
const catFilterHtml = (specs, f, extra = '') => {
    const cats = [...new Set(specs.map(s => s.category || '(구분 없음)'))].sort((a, b) => a.localeCompare(b, 'ko'));
    const subs = [...new Set(specs.filter(s => !f.cat || (s.category || '(구분 없음)') === f.cat).map(s => s.subCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    return `<div class="flex flex-wrap items-center gap-1.5 text-xs">
        <select data-f="cat" class="border border-slate-300 rounded-lg px-2 py-1"><option value="">구분 전체</option>${cats.map(c => `<option ${f.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select data-f="sub" class="border border-slate-300 rounded-lg px-2 py-1"><option value="">종류 전체</option>${subs.map(c => `<option ${f.sub === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select data-f="type" class="border border-slate-300 rounded-lg px-2 py-1"><option value="">유형 전체</option>${Object.entries(PRODUCT_TYPES).map(([k, t]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
        ${extra}</div>`;
};
const specMatchesFilter = (s, f) => (!f.cat || (s.category || '(구분 없음)') === f.cat) && (!f.sub || s.subCategory === f.sub) && (!f.type || s.type === f.type);
const bindFilter = (root, f, redraw) => root.querySelectorAll('[data-f]').forEach(el => el.addEventListener('change', () => { f[el.dataset.f] = el.value; if (el.dataset.f === 'cat') f.sub = ''; redraw(); }));

// ==========================================================
// 공정관리 → 원액생산 → 검사 기록·관리도
// ==========================================================
const bf = { cat: '', sub: '', type: '', product: '', item: '' };

/** @param {HTMLElement} body @param {import('./QualityNcr.js').QcViewCtx} ctx */
export const renderBlendTests = async (body, ctx) => {
    const { flt, canWrite, showToast } = ctx;
    body.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm">불러오는 중…</div>';
    let specs = []; let list = [];
    try { [specs, list] = await Promise.all([listSpecs(), listBlendTests()]); } catch (e) { body.innerHTML = errBox(e); return; }
    const specOf = (r) => specs.find(s => s.id === r.specId) || findSpecFor(specs, r) || { category: r.category, subCategory: r.subCategory, type: r.type };
    const q = String(flt.q || '').trim().toLowerCase();
    const scoped = list.filter(r => inScope(r, { ...ctx, area: 'PROCESS', stage: 'BLEND' }) && inPeriod(r, flt));
    const rows = scoped.filter(r => specMatchesFilter({ ...specOf(r), category: r.category || specOf(r).category, subCategory: r.subCategory || specOf(r).subCategory }, bf)
        && (!q || `${r.itemName} ${r.lot} ${r.refLabel} ${r.inspector} ${r.category} ${r.subCategory}`.toLowerCase().includes(q)));
    const ng = rows.filter(r => r.overall === 'NG').length;
    // 관리도: 고른 제품(없으면 기록이 가장 많은 제품)의 숫자 항목
    const byProduct = new Map();
    rows.forEach(r => { const k = r.itemName || '(제품 없음)'; byProduct.set(k, (byProduct.get(k) || 0) + 1); });
    const products = [...byProduct.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    if (!products.includes(bf.product)) bf.product = products[0] || '';
    const prodRecs = rows.filter(r => (r.itemName || '(제품 없음)') === bf.product).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const itemKeys = [...new Set(prodRecs.flatMap(r => (r.items || []).filter(i => i.numeric !== false && numOf(i.result) != null).map(i => i.key)))];
    if (!itemKeys.includes(bf.item)) bf.item = itemKeys.find(k => k !== 'appearance') || itemKeys[0] || '';
    const woNote = specs.length ? '' : `<div class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">아직 제품 규격이 없습니다. ${canSync() ? '[작업지시서에서 규격 가져오기]를 누르면 원액 작업지시서의 구분·종류·검사항목으로 제품별 규격을 만듭니다.' : '마스터·작업일지 관리자에게 [작업지시서에서 규격 가져오기]를 요청하세요. 규격 없이도 검사 기록은 남길 수 있습니다.'}</div>`;

    body.innerHTML = `
    <div class="space-y-3">
        <div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-xs text-emerald-900"><b>원액 검사 기록</b> — 작업지시서의 구분·종류별 검사항목으로 원액 LOT마다 검사값을 남기고 규격으로 자동 판정합니다. 기본 항목: <b>유성 = 외관·비중·동점도</b> / <b>수용성 = 외관·비중·pH</b>. 기록은 제품관리의 [제품 규격]·[제품시험성적서]에 반영됩니다.</div>
        ${woNote}
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex flex-wrap items-center justify-between gap-2">
            ${catFilterHtml(specs, bf)}
            <div class="flex flex-wrap gap-2">
                ${canSync() ? `<button type="button" id="bt-sync" class="${btn('bg-white border border-slate-300 hover:bg-slate-50 text-slate-700')}">🔄 작업지시서에서 규격 가져오기</button>` : ''}
                ${canWrite ? `<button type="button" id="bt-new" class="${btn('bg-emerald-600 hover:bg-emerald-700 text-white')}">＋ 원액 검사 기록</button>` : ''}
            </div>
        </div>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <b class="text-slate-800 text-sm">관리도 (X-MR)</b>
                <select id="bt-cc-product" class="border border-slate-300 rounded-lg px-2 py-1 max-w-[320px]">${products.length ? products.map(p => `<option ${p === bf.product ? 'selected' : ''}>${esc(p)}</option>`).join('') : '<option value="">기록 없음</option>'}</select>
                <select id="bt-cc-item" class="border border-slate-300 rounded-lg px-2 py-1">${itemKeys.length ? itemKeys.map(k => `<option value="${k}" ${k === bf.item ? 'selected' : ''}>${esc(QC_ITEM_DEFS[k]?.name || k)}</option>`).join('') : '<option value="">숫자 항목 없음</option>'}</select>
                <button type="button" id="bt-cc-print" class="px-2.5 py-1 rounded-lg bg-white border border-slate-300 font-bold ${prodRecs.length ? '' : 'hidden'}">🖨 관리도 인쇄</button>
            </div>
            <div id="bt-cc"></div>
        </div>
        ${listCardHtml({
        title: `원액 검사 기록 · ${scopeLabel({ ...ctx, area: 'PROCESS', stage: 'BLEND' })}`, count: rows.length,
        extra: `<span class="text-slate-500">부적합 <b class="${ng ? 'text-rose-600' : 'text-emerald-700'}">${ng}</b>건</span>`,
        bodyHtml: `<div class="overflow-x-auto"><table class="w-full text-xs min-w-[900px]">
            <thead class="bg-slate-50 text-slate-600"><tr>
                <th class="px-2 py-2 text-left">검사일</th><th class="px-2 py-2 text-left">사업장</th><th class="px-2 py-2 text-left">지시번호</th><th class="px-2 py-2 text-left">제품 · 구분/종류</th><th class="px-2 py-2 text-left">LOT</th>
                <th class="px-2 py-2 text-left">검사값 (규격)</th><th class="px-2 py-2 text-center">판정</th><th class="px-2 py-2 text-left">검사자</th>
            </tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.length === 0 ? emptyRow(8, scoped.length ? '조건에 맞는 기록이 없습니다.' : '아직 원액 검사 기록이 없습니다.') : rows.map(r => `
                <tr class="bt-row hover:bg-emerald-50/40 cursor-pointer" data-id="${esc(r.id)}">
                    <td class="px-2 py-1.5 whitespace-nowrap">${esc(r.date)}</td><td class="px-2 py-1.5">${siteBadge(r)}</td>
                    <td class="px-2 py-1.5 font-mono">${esc(r.refLabel || '-')}</td>
                    <td class="px-2 py-1.5"><div class="font-bold text-slate-800">${esc(r.itemName || '-')}</div><div class="text-[10px] text-slate-400">${esc([r.category, r.subCategory].filter(Boolean).join(' / '))}</div></td>
                    <td class="px-2 py-1.5 font-mono">${esc(r.lot || '')}</td>
                    <td class="px-2 py-1.5">${(r.items || []).filter(i => processKeysOf({ waterBased: r.waterBased, woItems: [], type: r.type }).includes(i.key) || i.result).slice(0, 5).map(i => `<span class="inline-block mr-2 ${JCLS[i.judge] || 'text-slate-600'}">${esc(QC_ITEM_DEFS[i.key]?.name.replace(/\s*\(.*$/, '').replace(/,.*$/, '') || i.name)} <b>${esc(i.result || '-')}</b></span>`).join('')}</td>
                    <td class="px-2 py-1.5 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${r.overall === 'NG' ? 'bg-rose-600 text-white' : r.overall === 'OK' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}">${esc(JUDGE[r.overall] || '미판정')}</span></td>
                    <td class="px-2 py-1.5">${esc(r.inspector || r.by || '')}</td>
                </tr>`).join('')}</tbody></table></div>`
    })}
    </div>`;
    const reload = () => renderBlendTests(body, ctx);
    bindFilter(body, bf, reload);
    body.querySelector('#bt-cc-product')?.addEventListener('change', (e) => { bf.product = e.target.value; bf.item = ''; reload(); });
    body.querySelector('#bt-cc-item')?.addEventListener('change', (e) => { bf.item = e.target.value; drawChart(); });
    const chartData = () => {
        const pts = prodRecs.map(r => ({ r, it: (r.items || []).find(i => i.key === bf.item) })).filter(x => x.it && numOf(x.it.result) != null);
        const specStr = pts.map(x => x.it.spec).filter(Boolean).pop() || '';
        return { pts, specStr, sr: parseSpec(specStr) };
    };
    const drawChart = () => {
        const { pts, specStr, sr } = chartData();
        body.querySelector('#bt-cc').innerHTML = controlChartHtml(pts.map(x => ({ x: numOf(x.it.result), label: x.r.date, lot: x.r.lot })), sr, { title: `${bf.product} · ${QC_ITEM_DEFS[bf.item]?.name || ''}`, specStr });
    };
    drawChart();
    body.querySelector('#bt-cc-print')?.addEventListener('click', () => {
        const { pts, specStr, sr } = chartData();
        const data = pts.map(x => ({ x: numOf(x.it.result), label: x.r.date, lot: x.r.lot }));
        printA4({
            title: '원액 품질 관리도 (X-MR)', subtitle: `${bf.product} · ${QC_ITEM_DEFS[bf.item]?.name || ''}`, meta: [['사업장', scopeLabel({ ...ctx, area: '' })], ['기간', `${flt.from || '처음'} ~ ${flt.to || '오늘'}`]],
            bodyHtml: `${controlChartHtml(data, sr, { title: '', specStr, print: true })}
                <table class="grid" style="margin-top:3mm"><thead><tr><th>No</th><th>검사일</th><th>LOT</th><th>측정값</th><th>이동범위</th></tr></thead>
                <tbody>${data.map((d, i) => `<tr><td class="c">${i + 1}</td><td class="c">${esc(d.label)}</td><td class="c">${esc(d.lot || '')}</td><td class="c">${d.x}</td><td class="c">${i ? Math.round(Math.abs(d.x - data[i - 1].x) * 10000) / 10000 : ''}</td></tr>`).join('')}</tbody></table>`,
            approvals: ['작성', '검토', '승인']
        });
    });
    body.querySelector('#bt-sync')?.addEventListener('click', async (e) => {
        e.target.disabled = true; e.target.textContent = '가져오는 중…';
        try { await runSync(showToast); reload(); } catch (err) { alert(err.message); e.target.disabled = false; e.target.textContent = '🔄 작업지시서에서 규격 가져오기'; }
    });
    body.querySelector('#bt-new')?.addEventListener('click', () => openBlendTestEditor(ctx, null, specs, reload, list));
    body.querySelectorAll('.bt-row').forEach(tr => tr.addEventListener('click', () => openBlendTestEditor(ctx, list.find(r => r.id === tr.dataset.id), specs, reload, list)));
};

// ---------- 관리도 SVG ----------
const r4 = (v) => (v == null || !Number.isFinite(v) ? '-' : String(Math.round(v * 10000) / 10000));
/**
 * X-MR 관리도 (개별값·이동범위) SVG + 통계
 * @param {{ x: number, label: string, lot?: string }[]} data 시간 순
 * @param {{ lo: number|null, hi: number|null } | null} sr 규격 한계
 */
export const controlChartHtml = (data, sr, { specStr = '', print = false } = {}) => {
    if (data.length < 2) return `<div class="p-6 text-center text-slate-400 text-xs border border-dashed border-slate-300 rounded-xl">관리도는 측정값이 2개 이상일 때 그립니다${data.length ? ' (지금 1개)' : ''}. 같은 제품의 원액 검사 기록을 더 남기세요.</div>`;
    const xs = data.map(d => d.x);
    const st = xmrStats(xs, sr);
    const W = 820; const H = 250; const H2 = 130; const L = 56; const R = 70; const T = 24; const B = 26; // T: 위쪽 차트 제목 자리
    const band = [st.ucl, st.lcl, ...xs, sr?.lo, sr?.hi].filter(v => v != null && Number.isFinite(v));
    let lo = Math.min(...band); let hi = Math.max(...band);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const px = (i) => L + (data.length === 1 ? 0 : (i * (W - L - R)) / (data.length - 1));
    const py = (v, a = lo, b = hi, h = H) => T + (h - T - B) * (1 - (v - a) / (b - a));
    const hline = (v, color, dash, label, a, b, h) => (v == null || !Number.isFinite(v) ? '' : `<line x1="${L}" x2="${W - R}" y1="${py(v, a, b, h)}" y2="${py(v, a, b, h)}" stroke="${color}" stroke-width="1.2" ${dash ? `stroke-dasharray="${dash}"` : ''}/><text x="${W - R + 4}" y="${py(v, a, b, h) + 3}" font-size="10" fill="${color}">${label} ${r4(v)}</text>`);
    const ticks = (a, b, h) => [0, 0.25, 0.5, 0.75, 1].map(t => { const v = a + (b - a) * t; return `<text x="${L - 6}" y="${py(v, a, b, h) + 3}" font-size="9" text-anchor="end" fill="#64748b">${r4(v)}</text><line x1="${L}" x2="${W - R}" y1="${py(v, a, b, h)}" y2="${py(v, a, b, h)}" stroke="#f1f5f9"/>`; }).join('');
    const out = new Set(st.out);
    const specOut = (x) => (sr && judgeValue(x, sr) === 'NG');
    const every = Math.max(1, Math.ceil(data.length / 12));
    const xChart = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:#fff" font-family="Malgun Gothic, sans-serif">
        ${ticks(lo, hi, H)}
        ${hline(sr?.hi, '#e11d48', '', 'USL', lo, hi, H)}${hline(sr?.lo, '#e11d48', '', 'LSL', lo, hi, H)}
        ${hline(st.ucl, '#f59e0b', '6 3', 'UCL', lo, hi, H)}${hline(st.lcl, '#f59e0b', '6 3', 'LCL', lo, hi, H)}${hline(st.mean, '#059669', '', 'CL', lo, hi, H)}
        <polyline fill="none" stroke="#2563eb" stroke-width="1.6" points="${xs.map((x, i) => `${px(i)},${py(x)}`).join(' ')}"/>
        ${xs.map((x, i) => `<circle cx="${px(i)}" cy="${py(x)}" r="${out.has(i) || specOut(x) ? 4.2 : 3}" fill="${specOut(x) ? '#e11d48' : out.has(i) ? '#f59e0b' : '#2563eb'}"><title>${esc(data[i].label)} ${esc(data[i].lot || '')}: ${x}</title></circle>`).join('')}
        ${data.map((d, i) => (i % every ? '' : `<text x="${px(i)}" y="${H - 8}" font-size="9" text-anchor="middle" fill="#64748b">${esc(String(d.label).slice(5))}</text>`)).join('')}
        <text x="4" y="12" font-size="10" font-weight="700" fill="#334155">X (개별값)</text>
    </svg>`;
    const mrs = st.mrs; const mHi = Math.max(st.mrUcl, ...mrs) * 1.1 || 1;
    const mrChart = `<svg viewBox="0 0 ${W} ${H2}" style="width:100%;height:auto;background:#fff" font-family="Malgun Gothic, sans-serif">
        ${ticks(0, mHi, H2)}
        ${hline(st.mrUcl, '#f59e0b', '6 3', 'UCL', 0, mHi, H2)}${hline(st.mrBar, '#059669', '', 'MR̄', 0, mHi, H2)}
        <polyline fill="none" stroke="#7c3aed" stroke-width="1.4" points="${mrs.map((m, i) => `${px(i + 1)},${py(m, 0, mHi, H2)}`).join(' ')}"/>
        ${mrs.map((m, i) => `<circle cx="${px(i + 1)}" cy="${py(m, 0, mHi, H2)}" r="2.6" fill="${m > st.mrUcl ? '#f59e0b' : '#7c3aed'}"/>`).join('')}
        <text x="4" y="12" font-size="10" font-weight="700" fill="#334155">MR (이동범위)</text>
    </svg>`;
    const cpkCls = st.cpk == null ? '' : st.cpk >= 1.33 ? 'color:#059669' : st.cpk >= 1 ? 'color:#d97706' : 'color:#e11d48';
    const specNg = xs.filter(specOut).length;
    const stats = [['측정 수', st.n], ['평균 (CL)', r4(st.mean)], ['UCL / LCL', `${r4(st.ucl)} / ${r4(st.lcl)}`], ['MR̄', r4(st.mrBar)], ['σ (MR̄/1.128)', r4(st.sigma)], ['규격', specStr || '-'],
        ['Cp', r4(st.cp)], ['Cpk', `<span style="${cpkCls};font-weight:800">${r4(st.cpk)}</span>`], ['관리한계 이탈', `${st.out.length}점`], ['규격 이탈', `${specNg}점`]];
    const statHtml = print
        ? `<table class="grid" style="margin-top:2mm"><tr>${stats.map(([k]) => `<th>${k}</th>`).join('')}</tr><tr>${stats.map(([, v]) => `<td class="c">${v}</td>`).join('')}</tr></table>`
        : `<div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs mt-2">${stats.map(([k, v]) => `<div class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5"><div class="text-[10px] text-slate-500 font-bold">${k}</div><div class="font-black text-slate-800">${v}</div></div>`).join('')}</div>
           <p class="text-[11px] text-slate-500 mt-1.5">UCL/LCL = 평균 ± 2.66 × MR̄ (관리한계, 공정의 흔들림) · USL/LSL = 규격한계. 노랑 점 = 관리한계 이탈, 빨강 점 = 규격 이탈. Cpk 1.33 이상 양호 · 1.0~1.33 주의 · 1.0 미만 개선 필요.</p>`;
    return `<div class="border border-slate-200 rounded-xl overflow-hidden">${xChart}<div style="border-top:1px solid #e2e8f0">${mrChart}</div></div>${statHtml}`;
};

// ---------- 원액 검사 기록 입력 창 ----------
/**
 * @param {Object[]} [tests] 원액 검사 기록 목록 (새 기록은 같은 제품의 최근 기록에서 뺀 항목을 이어받는다)
 */
export const openBlendTestEditor = async (ctx, orig, specs, onSaved = () => {}, tests = []) => {
    const { showToast, canWrite, modal } = ctx;
    const r = orig ? JSON.parse(JSON.stringify(orig)) : { date: localDateStr(), site: ctx.site !== 'ALL' ? ctx.site : '', stage: 'BLEND', inspector: state.currentUser?.name || '', items: [], showAll: false };
    // 이번 기록에서 뺀 검사항목 (항목 key). 저장할 때 빼고, 기록에 남겨 다음 기록에 이어준다
    let excluded = new Set(orig?.excluded || []);
    const keyOf = (it) => it.key || it.name;
    let orders = [];
    try { if (canSync()) orders = (await loadWorkOrders()).list; } catch (e) { console.warn('[원액 검사] 작업지시서를 불러오지 못했습니다:', e.message); }
    const readOnly = !canWrite;
    const specNames = [...new Set(specs.map(s => s.productName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    const m = openModal(modal, {
        title: '원액 검사 기록', sub: orig ? `${orig.id} · ${orig.by || ''}` : '작업지시서 LOT의 원액 검사값을 입력합니다', maxW: 'max-w-4xl',
        bodyHtml: `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label><span class="font-bold text-slate-600">검사일 *</span><input type="date" id="b-date" value="${esc(r.date)}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">사업장 *</span>${siteSelectHtml('b-site', siteOf(r))}</label>
            <label class="col-span-2"><span class="font-bold text-slate-600">작업지시서 ${orders.length ? '' : '(지시번호 직접 입력)'}</span>
                ${orders.length ? `<select id="b-ref" class="${INPUT_CLS}"><option value="">— 작업지시서 선택 —</option>${orders.map(o => `<option value="${esc(o.id)}" ${o.id === r.refId ? 'selected' : ''}>${esc(o.orderNo)} · ${esc(o.productName)}${o.lotNo ? ` · ${esc(o.lotNo)}` : ''}</option>`).join('')}</select>` : `<input id="b-ref-text" value="${esc(r.refLabel || '')}" class="${INPUT_CLS} font-mono" />`}</label>
            <label class="col-span-2"><span class="font-bold text-slate-600">제품 (원액) *</span><input id="b-item" list="b-specs" value="${esc(r.itemName || '')}" class="${INPUT_CLS}" /><datalist id="b-specs">${specNames.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
                <span id="b-spec-note" class="text-[10px] text-slate-500"></span></label>
            <label><span class="font-bold text-slate-600">LOT *</span><input id="b-lot" value="${esc(r.lot || '')}" class="${INPUT_CLS} font-mono" /></label>
            <label><span class="font-bold text-slate-600">검사자</span><input id="b-inspector" value="${esc(r.inspector || '')}" class="${INPUT_CLS}" /></label>
        </div>
        <div class="border border-slate-200 rounded-xl p-3 space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2"><b class="text-slate-700">검사 결과</b>
                <label class="flex items-center gap-1 text-[11px] font-bold text-slate-600"><input type="checkbox" id="b-all" ${r.showAll ? 'checked' : ''} />제품시험 항목까지 모두 (KS·API·ACEA·DOT)</label></div>
            <div id="b-items"></div>
        </div>
        <label class="block"><span class="font-bold text-slate-600">비고</span><input id="b-notes" value="${esc(r.notes || '')}" class="${INPUT_CLS}" /></label>
        <div class="flex flex-wrap justify-between gap-2 pt-1">
            <div>${orig && canDeleteQc(orig) ? '<button type="button" id="b-del" class="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold">삭제</button>' : ''}</div>
            <div class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">닫기</button>
                ${readOnly ? '' : `<button type="button" id="b-save" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black">${orig ? '저장' : '저장'}</button>`}</div>
        </div>`
    });
    if (readOnly) m.el.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
    let spec = orig ? (specs.find(s => s.id === r.specId) || null) : null;
    let tempSpec = null; // 규격이 없을 때 작업지시서 검사항목으로 만든 임시 규격
    const currentSpec = () => spec || tempSpec || { type: guessSpecType({ productName: m.$('#b-item').value }), woItems: [] };
    // 규격에서 항목을 만들고, 이미 입력한 결과는 같은 항목(key)에 그대로 남긴다
    const rebuild = () => {
        const s = currentSpec();
        const keep = new Map((r.items || []).map(i => [i.key || i.name, i]));
        const built = buildItems(s, { scope: r.showAll ? 'test' : 'process' });
        r.items = built.map(it => { const k = keep.get(it.key); return { ...it, result: k?.result || '', judge: k ? (k.manualJudge ? k.judge : judgeValue(k.result, it.spec) || k.judge || '') : '', manualJudge: !!k?.manualJudge }; });
        // 규격에서 빠졌지만 결과를 넣어 둔 항목(예전 기록)은 지우지 않고 뒤에 둔다
        const builtKeys = new Set(built.map(i => i.key));
        keep.forEach((k, key) => { if (!builtKeys.has(key) && String(k.result || '').trim()) r.items.push(k); });
        r.waterBased = !!s.waterBased; r.type = s.type || '';
        m.$('#b-spec-note').innerHTML = spec ? `제품 규격: <b>${esc(spec.productName)}</b> · ${esc(typeLabel(spec))}${optLabel(spec) ? ` · ${esc(optLabel(spec))}` : ''}`
            : tempSpec ? '제품 규격이 없어 작업지시서 검사항목으로 채웠습니다.' : '<span class="text-amber-700">제품 규격을 찾지 못했습니다. 제품명으로 짐작한 기본 항목입니다.</span>';
        paintItems();
    };
    const paintItems = () => {
        const nOut = r.items.filter(it => excluded.has(keyOf(it))).length;
        m.$('#b-items').innerHTML = `
            ${readOnly ? '' : `<div class="flex flex-wrap items-center gap-2 mb-1.5 text-[11px]">
                <span class="text-slate-500">검사할 항목만 체크하세요. 체크를 끈 항목은 이번 기록에 넣지 않습니다${nOut ? ` (<b class="text-amber-700">${nOut}개 뺌</b>)` : ''}.</span>
                <button type="button" id="b-x-all" class="px-2 py-0.5 rounded-md bg-white border border-slate-300 font-bold">모두 선택</button>
                <button type="button" id="b-x-empty" class="px-2 py-0.5 rounded-md bg-white border border-slate-300 font-bold">결과 없는 항목 빼기</button></div>`}
            <div class="overflow-x-auto"><table class="w-full text-xs min-w-[680px]">
            <thead class="bg-slate-50 text-slate-600"><tr><th class="px-1.5 py-1.5 text-center w-10 whitespace-nowrap" title="검사할 항목">검사</th><th class="px-1.5 py-1.5 text-left w-[25%]">검사항목</th><th class="px-1.5 py-1.5 text-left w-[15%]">시험방법</th><th class="px-1.5 py-1.5 text-left">규격 <span class="font-normal text-slate-400">(근거)</span></th><th class="px-1.5 py-1.5 text-left w-[16%]">결과</th><th class="px-1.5 py-1.5 text-center w-[12%]">판정</th></tr></thead>
            <tbody>${r.items.map((it, i) => { const out = excluded.has(keyOf(it)); return `<tr class="border-t border-slate-100 ${out ? 'bg-slate-50 opacity-50' : ''}">
                <td class="px-1.5 py-1 text-center"><input type="checkbox" data-use="${i}" ${out ? '' : 'checked'} ${readOnly ? 'disabled' : ''} title="${out ? '이 항목을 다시 넣기' : '이 항목 빼기'}" /></td>
                <td class="px-1.5 py-1 font-bold ${out ? 'text-slate-400 line-through' : 'text-slate-800'}">${esc(it.name)}</td><td class="px-1.5 py-1 text-slate-500">${esc(it.method || '')}</td>
                <td class="px-1.5 py-1">${esc(it.spec || '-')}${it.basis ? ` <span class="text-[10px] text-slate-400">(${esc(it.basis)})</span>` : ''}</td>
                <td class="px-1.5 py-1"><input data-res="${i}" value="${esc(it.result || '')}" ${readOnly || out ? 'disabled' : ''} placeholder="${out ? '뺀 항목' : it.numeric ? '측정값' : '예: 적합, 투명 적색'}" class="w-full border border-slate-300 rounded px-1.5 py-1 font-bold" /></td>
                <td class="px-1.5 py-1"><select data-j="${i}" ${readOnly || out ? 'disabled' : ''} class="w-full border border-slate-300 rounded px-1 py-1 ${JCLS[it.judge] || ''}"><option value=""></option><option value="OK" ${it.judge === 'OK' ? 'selected' : ''}>적합</option><option value="NG" ${it.judge === 'NG' ? 'selected' : ''}>부적합</option></select></td>
            </tr>`; }).join('')}</tbody></table></div>
            <div class="text-[11px] text-slate-500 mt-1">숫자 규격은 결과를 넣으면 자동 판정합니다. 외관처럼 글자 규격은 판정을 직접 고르세요. 뺀 항목은 같은 제품의 다음 기록에서도 빠진 채로 시작합니다.</div>`;
        m.el.querySelectorAll('[data-use]').forEach(el => el.addEventListener('change', () => {
            const k = keyOf(r.items[Number(el.dataset.use)]);
            if (el.checked) excluded.delete(k); else excluded.add(k);
            paintItems();
        }));
        m.$('#b-x-all')?.addEventListener('click', () => { excluded = new Set(); paintItems(); });
        m.$('#b-x-empty')?.addEventListener('click', () => { r.items.forEach(it => { if (!String(it.result || '').trim()) excluded.add(keyOf(it)); }); paintItems(); });
        m.el.querySelectorAll('[data-res]').forEach(el => el.addEventListener('input', () => {
            const it = r.items[Number(el.dataset.res)]; it.result = el.value;
            if (!it.manualJudge) { const j = judgeValue(el.value, it.spec); it.judge = j || (it.numeric ? '' : it.judge); const sel = m.el.querySelector(`[data-j="${el.dataset.res}"]`); sel.value = it.judge; sel.className = `w-full border border-slate-300 rounded px-1 py-1 ${JCLS[it.judge] || ''}`; }
        }));
        m.el.querySelectorAll('[data-j]').forEach(el => el.addEventListener('change', () => { const it = r.items[Number(el.dataset.j)]; it.judge = el.value; it.manualJudge = true; el.className = `w-full border border-slate-300 rounded px-1 py-1 ${JCLS[it.judge] || ''}`; }));
    };
    const pickProduct = (name, order = null) => {
        spec = findSpecFor(specs, { itemCode: order?.productItemCode || '', itemName: name });
        tempSpec = !spec && order?.qcItems?.length ? { type: guessSpecType({ ...order, woItems: order.qcItems }), woItems: order.qcItems, category: order.category, subCategory: order.subCategory } : null;
        if (tempSpec) tempSpec.waterBased = isWaterBased(tempSpec);
        // 새 기록: 같은 제품의 가장 최근 기록에서 뺀 항목을 이어받는다
        if (!orig) {
            const last = tests.filter(t => (spec && t.specId === spec.id) || String(t.itemName || '').trim() === String(name || '').trim())
                .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
            excluded = new Set(last?.excluded || []);
            if (last?.showAll !== undefined) { r.showAll = !!last.showAll; m.$('#b-all').checked = r.showAll; }
        }
        rebuild();
    };
    if (orig) {
        if (!spec) spec = findSpecFor(specs, r);
        rebuild(); // 뺀 항목도 다시 넣을 수 있게 규격에서 항목을 다시 만든다 (입력한 결과는 그대로)
    } else if (r.itemName) pickProduct(r.itemName); else rebuild();
    m.$('#b-all').addEventListener('change', (e) => { r.showAll = e.target.checked; rebuild(); });
    m.$('#b-item').addEventListener('change', () => pickProduct(m.$('#b-item').value.trim()));
    m.$('#b-ref')?.addEventListener('change', (e) => {
        const o = orders.find(x => x.id === e.target.value);
        r.refId = o?.id || ''; r.refLabel = o?.orderNo || '';
        if (o) { m.$('#b-item').value = o.productName; if (o.lotNo) m.$('#b-lot').value = o.lotNo; r.itemCode = o.productItemCode || ''; pickProduct(o.productName, o); }
    });
    const collect = () => {
        const s = spec || tempSpec || {};
        const items = r.items.filter(it => !excluded.has(keyOf(it)));
        return {
            ...r, items, excluded: [...excluded], stage: 'BLEND', date: m.$('#b-date').value, site: m.$('#b-site').value, itemName: m.$('#b-item').value.trim(), lot: m.$('#b-lot').value.trim(), inspector: m.$('#b-inspector').value.trim(), notes: m.$('#b-notes').value.trim(),
            refLabel: m.$('#b-ref-text') ? m.$('#b-ref-text').value.trim() : r.refLabel || '', specId: spec?.id || '', itemCode: r.itemCode || spec?.itemCode || '',
            category: s.category || r.category || '', subCategory: s.subCategory || r.subCategory || '', overall: overallOf(items)
        };
    };
    m.$('#b-save')?.addEventListener('click', async (e) => {
        const rec = collect();
        if (!rec.date || !rec.itemName || !rec.lot) { alert('검사일·제품·LOT를 입력하세요.'); return; }
        if (!QC_SITES[rec.site]) { alert('사업장(본사·김포)을 고르세요.'); return; }
        if (!rec.items.some(i => String(i.result || '').trim())) { alert('검사 결과를 하나 이상 입력하세요.'); return; }
        e.target.disabled = true;
        try {
            await saveBlendTest(rec);
            showToast(`💾 원액 검사 기록을 저장했습니다${rec.overall === 'NG' ? ' — 부적합 항목이 있습니다. [불량 조치보고서]로 조치를 남기세요.' : '.'}`);
            m.close(); onSaved();
        } catch (err) { alert(err.message); e.target.disabled = false; }
    });
    m.$('#b-del')?.addEventListener('click', async () => {
        if (!confirm('이 원액 검사 기록을 삭제할까요? 되돌릴 수 없습니다.')) return;
        try { await deleteQc(orig.id); showToast('🗑️ 원액 검사 기록을 삭제했습니다.'); m.close(); onSaved(); } catch (err) { alert(err.message); }
    });
};

// ==========================================================
// 제품관리 → 제품 규격
// ==========================================================
const sf = { cat: '', sub: '', type: '', q: '' };

export const renderProductSpecs = async (body, ctx) => {
    const { showToast } = ctx;
    body.innerHTML = '<div class="p-6 text-center text-slate-400 text-sm">불러오는 중…</div>';
    let specs = []; let tests = [];
    try { [specs, tests] = await Promise.all([listSpecs(), listBlendTests()]); } catch (e) { body.innerHTML = errBox(e); return; }
    const q = String(ctx.flt.q || '').trim().toLowerCase();
    const rows = specs.filter(s => specMatchesFilter(s, sf) && (!q || `${s.productName} ${s.itemCode} ${s.category} ${s.subCategory} ${optLabel(s)}`.toLowerCase().includes(q)))
        .sort((a, b) => String(a.category).localeCompare(String(b.category), 'ko') || String(a.subCategory).localeCompare(String(b.subCategory), 'ko') || String(a.productName).localeCompare(String(b.productName), 'ko'));
    const lastTest = (s) => tests.filter(t => t.specId === s.id || (!t.specId && findSpecFor([s], t))).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const editable = canEditSpec();
    body.innerHTML = `
    <div class="space-y-3">
        <div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-xs text-emerald-900"><b>제품 규격</b> — 원액 작업지시서의 구분·종류·검사항목을 가져와 제품별 규격을 만듭니다. 엔진오일은 <b>KS M 2121 + SAE J300 + API·ACEA</b>, 브레이크액은 <b>KS M 2141 4종·6종 + DOT4</b>, 부동액은 <b>KS M 2142</b>, 연료첨가제는 <b>KS 시험방법</b>으로 시험항목을 채웁니다. 원액 검사 기록과 제품시험성적서가 이 규격을 씁니다.
            <br><span class="text-emerald-700">※ 규격값은 앱 기본값입니다. 규격서 최신판과 다르면 제품별로 [규격] 칸을 고쳐 저장하세요.</span></div>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 flex flex-wrap items-center justify-between gap-2">
            ${catFilterHtml(specs, sf)}
            <div class="flex flex-wrap gap-2">
                ${canSync() ? `<button type="button" id="ps-sync" class="${btn('bg-white border border-slate-300 hover:bg-slate-50 text-slate-700')}">🔄 작업지시서에서 가져오기</button>` : ''}
                ${editable ? `<button type="button" id="ps-new" class="${btn('bg-emerald-600 hover:bg-emerald-700 text-white')}">＋ 규격 추가</button>` : ''}
            </div>
        </div>
        ${listCardHtml({
        title: '제품 규격', count: rows.length,
        extra: `<span class="text-slate-500">전체 ${specs.length}개 제품</span>`,
        bodyHtml: `<div class="overflow-x-auto"><table class="w-full text-xs min-w-[900px]">
            <thead class="bg-slate-50 text-slate-600"><tr>
                <th class="px-2 py-2 text-left">구분</th><th class="px-2 py-2 text-left">종류</th><th class="px-2 py-2 text-left">제품</th><th class="px-2 py-2 text-left">유형</th><th class="px-2 py-2 text-left">적용 규격</th>
                <th class="px-2 py-2 text-left">공정 기본항목</th><th class="px-2 py-2 text-center">시험항목</th><th class="px-2 py-2 text-left">최근 원액 검사</th><th class="px-2 py-2 text-left">출처</th>
            </tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.length === 0 ? emptyRow(9, specs.length ? '조건에 맞는 규격이 없습니다.' : '아직 제품 규격이 없습니다. [작업지시서에서 가져오기]로 만드세요.') : rows.map(s => {
                const t = lastTest(s); const items = buildItems(s);
                return `<tr class="ps-row hover:bg-emerald-50/40 cursor-pointer" data-id="${esc(s.id)}">
                    <td class="px-2 py-1.5 font-bold text-slate-700">${esc(s.category || '-')}</td><td class="px-2 py-1.5">${esc(s.subCategory || '-')}</td>
                    <td class="px-2 py-1.5"><div class="font-bold text-slate-800">${esc(s.productName)}</div><div class="text-[10px] text-slate-400 font-mono">${esc(s.itemCode || '')}</div></td>
                    <td class="px-2 py-1.5">${esc(typeLabel(s))}</td>
                    <td class="px-2 py-1.5 text-slate-600">${esc([PRODUCT_TYPES[s.type]?.basis, optLabel(s)].filter(Boolean).join(' · '))}${viscSummaryHtml(s, items)}${items.some(i => i.conflict) ? `<div class="text-[10px] font-black text-rose-600" title="${esc(items.filter(i => i.conflict).map(i => `${i.name}: ${i.basis}`).join('\n'))}">⚠ 작업지시서 기준과 맞지 않음 (${esc(items.filter(i => i.conflict).map(i => i.name.replace(/\s*\(.*$/, '').replace(/,.*$/, '')).join(', '))})</div>` : ''}</td>
                    <td class="px-2 py-1.5">${buildItems(s, { scope: 'process' }).map(i => `<span class="inline-block mr-1.5">${esc(i.name.replace(/\s*\(.*$/, '').replace(/,.*$/, ''))} <span class="text-slate-400">${esc(i.spec || '-')}</span></span>`).join('')}</td>
                    <td class="px-2 py-1.5 text-center">${items.length}</td>
                    <td class="px-2 py-1.5">${t ? `${esc(t.date)} <span class="${t.overall === 'NG' ? 'text-rose-600 font-black' : 'text-emerald-700 font-bold'}">${esc(JUDGE[t.overall] || '미판정')}</span>` : '<span class="text-slate-400">-</span>'}</td>
                    <td class="px-2 py-1.5 text-[10px] text-slate-500">${s.source === 'WO' ? `작업지시서${s.recipeRev ? ` ${esc(s.recipeRev)}` : ''}` : '직접 입력'}</td>
                </tr>`;
            }).join('')}</tbody></table></div>`
    })}
    </div>`;
    const reload = () => renderProductSpecs(body, ctx);
    bindFilter(body, sf, reload);
    body.querySelector('#ps-sync')?.addEventListener('click', async (e) => {
        e.target.disabled = true; e.target.textContent = '가져오는 중…';
        try { await runSync(showToast); reload(); } catch (err) { alert(err.message); e.target.disabled = false; e.target.textContent = '🔄 작업지시서에서 가져오기'; }
    });
    body.querySelector('#ps-new')?.addEventListener('click', () => openSpecEditor(ctx, null, tests, reload));
    body.querySelectorAll('.ps-row').forEach(tr => tr.addEventListener('click', () => openSpecEditor(ctx, specs.find(s => s.id === tr.dataset.id), tests, reload)));
};

export const openSpecEditor = (ctx, orig, tests = [], onSaved = () => {}) => {
    const { showToast, modal } = ctx;
    const editable = canEditSpec();
    const s = orig ? JSON.parse(JSON.stringify(orig)) : { productName: '', itemCode: '', category: '', subCategory: '', type: 'OIL', waterBased: false, options: {}, woItems: [], overrides: {}, source: 'MANUAL' };
    s.options = s.options || {}; s.overrides = s.overrides || {};
    const myTests = tests.filter(t => orig && (t.specId === orig.id || (!t.specId && findSpecFor([orig], t)))).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
    const m = openModal(modal, {
        title: '제품 규격', sub: orig ? `${orig.productName} · ${orig.source === 'WO' ? '작업지시서에서 가져옴' : '직접 입력'}` : '새 제품 규격', maxW: 'max-w-5xl',
        bodyHtml: `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label class="col-span-2"><span class="font-bold text-slate-600">제품 *</span><input id="s-name" value="${esc(s.productName)}" class="${INPUT_CLS} font-bold" /></label>
            <label><span class="font-bold text-slate-600">품목코드</span><input id="s-code" value="${esc(s.itemCode || '')}" class="${INPUT_CLS} font-mono" /></label>
            <label><span class="font-bold text-slate-600">유형</span><select id="s-type" class="${INPUT_CLS}">${Object.entries(PRODUCT_TYPES).map(([k, t]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
            <label><span class="font-bold text-slate-600">구분</span><input id="s-cat" value="${esc(s.category || '')}" class="${INPUT_CLS}" /></label>
            <label><span class="font-bold text-slate-600">종류</span><input id="s-sub" value="${esc(s.subCategory || '')}" class="${INPUT_CLS}" /></label>
            <label class="flex items-end gap-1.5 font-bold text-slate-700 pb-2"><input type="checkbox" id="s-water" ${s.waterBased ? 'checked' : ''} />수용성 (공정 기본항목: 외관·비중·pH)</label>
        </div>
        <div id="s-opts"></div>
        <div class="border border-slate-200 rounded-xl p-3 space-y-1"><div class="flex flex-wrap justify-between gap-2"><b class="text-slate-700">검사항목 · 규격</b><span class="text-[11px] text-slate-400">규격 칸을 고치면 그 값이 우선합니다 (비우면 자동 값). ● = 공정관리(원액생산) 기본항목</span></div><div id="s-items"></div></div>
        ${(s.woItems || []).length ? `<details class="border border-slate-200 rounded-xl p-3"><summary class="font-bold text-slate-700 cursor-pointer">작업지시서 검사항목 (${s.woItems.length}개${s.recipeRev ? ` · ${esc(s.recipeRev)}` : ''})</summary>
            <div class="grid md:grid-cols-2 gap-x-6 gap-y-0.5 mt-2">${s.woItems.map(q => `<div class="flex gap-2"><span class="font-bold">${esc(q.item)}</span><span class="text-slate-500 ml-auto">${esc(q.standard || '-')}</span></div>`).join('')}</div></details>` : ''}
        ${myTests.length ? `<div class="border border-slate-200 rounded-xl p-3"><b class="text-slate-700">최근 원액 검사</b>
            <table class="w-full mt-1"><tbody>${myTests.map(t => `<tr class="border-t border-slate-100"><td class="py-1 pr-2 whitespace-nowrap">${esc(t.date)}</td><td class="pr-2 font-mono">${esc(t.lot || '')}</td><td class="pr-2">${(t.items || []).filter(i => i.result).map(i => `<span class="mr-2 ${JCLS[i.judge] || ''}">${esc(i.name.replace(/\s*\(.*$/, '').replace(/,.*$/, ''))} ${esc(i.result)}</span>`).join('')}</td><td class="text-right ${t.overall === 'NG' ? 'text-rose-600 font-black' : 'text-emerald-700 font-bold'}">${esc(JUDGE[t.overall] || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="flex flex-wrap justify-between gap-2 pt-1">
            <div class="flex gap-2">${orig && editable && canConfigQc() ? '<button type="button" id="s-del" class="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold">삭제</button>' : ''}
                <button type="button" id="s-print" class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">🖨 규격서 인쇄</button></div>
            <div class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">닫기</button>
                ${editable ? '<button type="button" id="s-save" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black">저장</button>' : ''}</div>
        </div>`
    });
    if (!editable) m.el.querySelectorAll('input, select').forEach(el => { el.disabled = true; });
    const read = () => { s.productName = m.$('#s-name').value.trim(); s.itemCode = m.$('#s-code').value.trim(); s.type = m.$('#s-type').value; s.category = m.$('#s-cat').value.trim(); s.subCategory = m.$('#s-sub').value.trim(); s.waterBased = m.$('#s-water').checked; };
    const paintOpts = () => {
        const o = s.options;
        const chk = (name, list, cur) => list.map(g => `<label class="inline-flex items-center gap-1 mr-2 mb-1"><input type="checkbox" data-opt="${name}" value="${esc(g)}" ${(cur || []).includes(g) ? 'checked' : ''} ${editable ? '' : 'disabled'} />${esc(g)}</label>`).join('');
        m.$('#s-opts').innerHTML = s.type === 'ENGINE' ? `<div class="border border-slate-200 rounded-xl p-3 space-y-2">
                <div class="flex flex-wrap items-center gap-2"><b class="text-slate-700 w-20">SAE 점도</b><select id="s-sae" ${editable ? '' : 'disabled'} class="border border-slate-300 rounded-lg px-2 py-1"><option value="">선택 안 함</option>${SAE_GRADES.map(g => `<option ${o.sae === g ? 'selected' : ''}>${g}</option>`).join('')}</select><span class="text-[11px] text-slate-400">SAE J300: 100℃ 동점도·CCS·MRV·HTHS</span></div>
                <div class="flex flex-wrap items-start gap-2"><b class="text-slate-700 w-20">API</b><div>${chk('api', API_GRADES, o.api)}</div></div>
                <div class="flex flex-wrap items-start gap-2"><b class="text-slate-700 w-20">ACEA</b><div>${chk('acea', ACEA_GRADES, o.acea)}</div></div></div>`
            : s.type === 'BRAKE' ? `<div class="border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-4">
                <b class="text-slate-700">KS M 2141</b>${['4', '6'].map(c => `<label class="inline-flex items-center gap-1"><input type="radio" name="s-bc" value="${c}" ${(o.brakeClass || '4') === c ? 'checked' : ''} ${editable ? '' : 'disabled'} />${c}종</label>`).join('')}
                <label class="inline-flex items-center gap-1 font-bold"><input type="checkbox" id="s-dot4" ${o.dot4 ? 'checked' : ''} ${editable ? '' : 'disabled'} />DOT4 (FMVSS 116) 대응</label></div>`
            : s.type === 'ANTIFREEZE' ? `<div class="border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-4">
                <b class="text-slate-700">KS M 2142 종류</b>${Object.entries(AF_KINDS).map(([k, l]) => `<label class="inline-flex items-center gap-1"><input type="radio" name="s-af" value="${k}" ${(o.afKind || 'EG2') === k ? 'checked' : ''} ${editable ? '' : 'disabled'} />${esc(l)}</label>`).join('')}
                <span class="text-[11px] text-slate-400">EG = 에틸렌글라이콜 · PG = 프로필렌글라이콜 · AF = 겨울철용 · LLC = 연중용</span></div>` : '';
        m.$('#s-sae')?.addEventListener('change', (e) => { o.sae = e.target.value; paintItems(); });
        m.el.querySelectorAll('[data-opt]').forEach(el => el.addEventListener('change', () => { o[el.dataset.opt] = [...m.el.querySelectorAll(`[data-opt="${el.dataset.opt}"]:checked`)].map(x => x.value); paintItems(); }));
        m.el.querySelectorAll('input[name="s-bc"]').forEach(el => el.addEventListener('change', () => { o.brakeClass = el.value; paintItems(); }));
        m.$('#s-dot4')?.addEventListener('change', (e) => { o.dot4 = e.target.checked; paintItems(); });
        m.el.querySelectorAll('input[name="s-af"]').forEach(el => el.addEventListener('change', () => { o.afKind = el.value; paintItems(); }));
    };
    const paintItems = () => {
        const proc = processKeysOf(s);
        const auto = buildItems({ ...s, overrides: {} });
        m.$('#s-items').innerHTML = `<div class="overflow-x-auto"><table class="w-full text-xs min-w-[720px]">
            <thead class="bg-slate-50 text-slate-600"><tr><th class="px-1.5 py-1.5 text-left w-[28%]">검사항목</th><th class="px-1.5 py-1.5 text-left w-[16%]">시험방법</th><th class="px-1.5 py-1.5 text-left">규격</th><th class="px-1.5 py-1.5 text-left w-[24%]">근거</th></tr></thead>
            <tbody>${auto.map(it => `<tr class="border-t border-slate-100">
                <td class="px-1.5 py-1 font-bold text-slate-800">${proc.includes(it.key) ? '<span class="text-emerald-600">●</span> ' : ''}${esc(it.name)}</td><td class="px-1.5 py-1 text-slate-500">${esc(it.method)}</td>
                <td class="px-1.5 py-1"><input data-ov="${it.key}" value="${esc(s.overrides[it.key] || '')}" placeholder="${esc(it.spec || '(비어 있음)')}" ${editable ? '' : 'disabled'} class="w-full border border-slate-300 rounded px-1.5 py-1 ${s.overrides[it.key] ? 'font-bold text-blue-800' : ''}" /></td>
                <td class="px-1.5 py-1 text-[11px] ${it.conflict && !s.overrides[it.key] ? 'text-rose-600 font-black' : 'text-slate-500'}">${s.overrides[it.key] ? '직접 입력' : esc(it.basis || '')}</td></tr>`).join('')}</tbody></table></div>
            ${auto.some(it => it.conflict) ? '<div class="mt-1 p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold">⚠ 작업지시서 기준이 선택한 규격(SAE 등급 등) 범위와 겹치지 않습니다. 등급이 맞는지, 작업지시서 기준이 맞는지 확인한 뒤 등급을 고치거나 [규격] 칸에 직접 입력하세요.</div>' : ''}`;
        m.el.querySelectorAll('[data-ov]').forEach(el => el.addEventListener('change', () => { const v = el.value.trim(); if (v) s.overrides[el.dataset.ov] = v; else delete s.overrides[el.dataset.ov]; paintItems(); }));
    };
    m.$('#s-type').addEventListener('change', () => { read(); if (s.type === 'ANTIFREEZE' || s.type === 'WATER') { s.waterBased = true; m.$('#s-water').checked = true; } paintOpts(); paintItems(); });
    m.$('#s-water').addEventListener('change', () => { read(); paintItems(); });
    paintOpts(); paintItems();
    m.$('#s-save')?.addEventListener('click', async (e) => {
        read();
        if (!s.productName) { alert('제품 이름을 입력하세요.'); return; }
        e.target.disabled = true;
        try { await saveSpec(s); showToast('💾 제품 규격을 저장했습니다.'); m.close(); onSaved(); } catch (err) { alert(err.message); e.target.disabled = false; }
    });
    m.$('#s-del')?.addEventListener('click', async () => {
        if (!confirm(`'${orig.productName}' 규격을 삭제할까요? (작업지시서에서 다시 가져오면 기본값으로 다시 만들어집니다)`)) return;
        try { await deleteSpec(orig.id); showToast('🗑️ 제품 규격을 삭제했습니다.'); m.close(); onSaved(); } catch (err) { alert(err.message); }
    });
    m.$('#s-print').addEventListener('click', () => { read(); printSpec(s); });
};

/** 제품 규격서 A4 */
export const printSpec = (s) => {
    const items = buildItems(s); const proc = processKeysOf(s);
    printA4({
        title: '제품 규격서', subtitle: s.productName, meta: [['유형', typeLabel(s)], ['적용 규격', [PRODUCT_TYPES[s.type]?.basis, optLabel(s)].filter(Boolean).join(' · ') || '-']],
        bodyHtml: `<table class="grid" style="margin-bottom:3mm"><tr><th style="width:24mm">제품</th><td>${esc(s.productName)}</td><th style="width:24mm">품목코드</th><td>${esc(s.itemCode || '-')}</td></tr>
            <tr><th>구분</th><td>${esc(s.category || '-')}</td><th>종류</th><td>${esc(s.subCategory || '-')}</td></tr></table>
            <table class="grid"><colgroup><col style="width:8mm"><col><col style="width:30mm"><col style="width:40mm"><col style="width:36mm"></colgroup>
            <thead><tr><th>No</th><th>검사항목</th><th>시험방법</th><th>규격</th><th>근거</th></tr></thead>
            <tbody>${items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${proc.includes(it.key) ? '● ' : ''}${esc(it.name)}</td><td class="c">${esc(it.method)}</td><td class="c">${esc(it.spec || '')}</td><td style="font-size:8pt">${esc(it.basis || '')}</td></tr>`).join('')}</tbody></table>
            <p style="font-size:8.5pt;margin-top:2mm">● 공정관리(원액생산) 기본 검사항목</p>`,
        approvals: ['작성', '검토', '승인']
    });
};

// ---------- 제품시험성적서용: 규격 검색 창 (떠 있는 창, 성적서 입력 창 위) ----------
/** @returns {Promise<Object|null>} 고른 규격 */
export const pickSpec = async (initialQ = '') => {
    const specs = await listSpecs();
    return new Promise((resolve) => {
        const wrap = document.createElement('div');
        wrap.className = 'fixed inset-0 z-[80] bg-slate-900/60 flex items-center justify-center p-4';
        wrap.innerHTML = `<div class="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col p-4 gap-2 text-xs">
            <div class="flex items-center justify-between"><b class="text-sm text-slate-900">제품 규격 검색</b><button type="button" data-x class="text-lg px-2">×</button></div>
            <div class="flex flex-wrap gap-1.5"><input id="pk-q" value="${esc(initialQ)}" placeholder="제품·구분·종류·규격(예: 5W-30, DOT4) 검색" class="flex-1 min-w-[200px] border border-slate-300 rounded-lg px-2 py-1.5" /></div>
            <div id="pk-list" class="overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100"></div></div>`;
        document.body.appendChild(wrap);
        const close = (v) => { wrap.remove(); resolve(v); };
        const paint = () => {
            const q = wrap.querySelector('#pk-q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
            const rows = specs.filter(s => q.every(w => `${s.productName} ${s.category} ${s.subCategory} ${typeLabel(s)} ${optLabel(s)} ${s.itemCode}`.toLowerCase().includes(w))).slice(0, 200);
            wrap.querySelector('#pk-list').innerHTML = rows.length ? rows.map(s => `<button type="button" data-id="${esc(s.id)}" class="w-full text-left px-3 py-2 hover:bg-emerald-50"><div class="font-bold text-slate-800">${esc(s.productName)}</div><div class="text-[11px] text-slate-500">${esc([s.category, s.subCategory, typeLabel(s), optLabel(s)].filter(Boolean).join(' · '))}</div></button>`).join('')
                : `<div class="p-6 text-center text-slate-400">${specs.length ? '찾는 규격이 없습니다.' : '제품 규격이 없습니다. 제품관리 → [제품 규격]에서 작업지시서로 만드세요.'}</div>`;
            wrap.querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => close(specs.find(s => s.id === b.dataset.id))));
        };
        wrap.querySelector('#pk-q').addEventListener('input', paint);
        wrap.querySelector('[data-x]').addEventListener('click', () => close(null));
        wrap.addEventListener('click', (e) => { if (e.target === wrap) close(null); });
        paint();
        wrap.querySelector('#pk-q').focus();
    });
};
