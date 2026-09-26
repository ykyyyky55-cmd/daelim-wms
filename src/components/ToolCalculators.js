import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';

/**
 * TOOL 메뉴의 범용 계산기 3종 (업무 데이터와 무관, 기기에만 기억)
 *  - 전자계산기(탭 calc): 사칙연산·괄호·%·±·메모리(M+/M−/MR/MC)·계산 기록, 키보드 입력
 *  - 단위환산계산기(탭 unitConv): 길이·무게·부피·넓이·온도·압력·속도·부피↔무게(비중)
 *  - 환율계산기(탭 fxCalc): 무료 공개 환율(open.er-api.com, 안 되면 frankfurter.app ECB), 6시간 캐시·수수료(%)
 */
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 */ } };
// 부동소수 오차 정리 (0.1+0.2 → 0.3)
const tidy = (n) => (Number.isFinite(n) ? Number(n.toPrecision(12)) : n);
const fmt = (n, max = 10) => {
    if (!Number.isFinite(n)) return n === Infinity || n === -Infinity ? '∞' : '오류';
    const a = Math.abs(n);
    if (a !== 0 && (a >= 1e15 || a < 1e-9)) return n.toExponential(6);
    return tidy(n).toLocaleString('ko-KR', { maximumFractionDigits: max });
};
const card = (title, icon, color, desc, body) => `
    <section class="space-y-4 max-w-5xl mx-auto">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <h2 class="text-lg font-black text-slate-900 flex items-center gap-2"><i data-lucide="${icon}" class="w-5 h-5 ${color}"></i>${title}</h2>
            <p class="text-xs text-slate-500 mt-1">${desc}</p>
        </div>
        ${body}
    </section>`;

// =====================================================================
// 전자계산기
// =====================================================================
const CALC_HIST_KEY = 'daelim_calc_history';
const CALC_MEM_KEY = 'daelim_calc_memory';

// 식 계산 (eval 쓰지 않음): 숫자, + − × ÷, 괄호, 단항 −
export const evaluateExpr = (expr) => {
    const s = String(expr).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '').replace(/\s+/g, '');
    if (!s) return 0;
    let i = 0;
    const peek = () => s[i];
    const num = () => {
        const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
        if (!m) throw new Error('식 오류');
        i += m[0].length;
        return parseFloat(m[0]);
    };
    const factor = () => {
        if (peek() === '-') { i++; return -factor(); }
        if (peek() === '+') { i++; return factor(); }
        if (peek() === '(') {
            i++;
            const v = expr2();
            if (peek() === ')') i++; // 닫는 괄호가 빠져 있어도 계산
            return v;
        }
        return num();
    };
    const term = () => {
        let v = factor();
        while (peek() === '*' || peek() === '/') {
            const op = s[i++];
            const r = factor();
            v = op === '*' ? v * r : v / r;
        }
        return v;
    };
    const expr2 = () => {
        let v = term();
        while (peek() === '+' || peek() === '-') {
            const op = s[i++];
            const r = term();
            v = op === '+' ? v + r : v - r;
        }
        return v;
    };
    const v = expr2();
    if (i < s.length) throw new Error('식 오류');
    return tidy(v);
};

export const renderCalculator = (container, { showToast = () => {} } = {}) => {
    let expr = '';
    let lastResult = null;   // '=' 직후 결과 (다음 숫자 입력 시 새 식)
    let memory = Number(readJson(CALC_MEM_KEY, 0)) || 0;
    let history = readJson(CALC_HIST_KEY, []);
    const OPS = ['+', '−', '×', '÷'];
    const lastChar = () => expr.slice(-1);
    const lastNumberMatch = () => expr.match(/(\d+\.?\d*|\.\d+)$/);
    const preview = () => {
        if (!expr) return '';
        try {
            const trimmed = OPS.includes(lastChar()) || lastChar() === '(' ? expr.slice(0, -1) : expr;
            const v = evaluateExpr(trimmed);
            return Number.isFinite(v) ? fmt(v) : '0으로 나눌 수 없음';
        } catch { return ''; }
    };
    const pretty = (e) => e.replace(/(\d+\.?\d*)/g, (m) => {
        const [a, b] = m.split('.');
        return Number(a).toLocaleString('ko-KR') + (m.includes('.') ? `.${b}` : '');
    });

    const press = (k) => {
        if (/^\d$/.test(k)) {
            if (lastResult !== null) { expr = ''; lastResult = null; }
            if (lastChar() === ')') expr += '×';
            // 앞자리 0 정리 (0 다음 숫자)
            const m = lastNumberMatch();
            if (m && m[0] === '0') expr = expr.slice(0, -1);
            expr += k;
        } else if (k === '.') {
            if (lastResult !== null) { expr = ''; lastResult = null; }
            const m = lastNumberMatch();
            if (m && m[0].includes('.')) return;
            expr += m ? '.' : (lastChar() === ')' ? '×0.' : '0.');
        } else if (OPS.includes(k)) {
            lastResult = null;
            if (!expr) { if (k === '−') expr = '−'; return; }
            if (OPS.includes(lastChar())) expr = expr.slice(0, -1);
            if (lastChar() === '(' && k !== '−') return;
            expr += k;
        } else if (k === '(') {
            if (lastResult !== null) { expr = ''; lastResult = null; }
            if (/[\d)]$/.test(expr)) expr += '×';
            expr += '(';
        } else if (k === ')') {
            const open = (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
            if (open > 0 && /[\d)]$/.test(expr)) expr += ')';
        } else if (k === 'C') {
            expr = ''; lastResult = null;
        } else if (k === 'CE') {
            const m = lastNumberMatch();
            if (m) expr = expr.slice(0, -m[0].length);
            lastResult = null;
        } else if (k === '⌫') {
            if (lastResult !== null) { lastResult = null; }
            expr = expr.slice(0, -1);
        } else if (k === '±') {
            const m = lastNumberMatch();
            if (!m) return;
            const start = expr.length - m[0].length;
            if (expr.slice(start - 2, start) === '(−') expr = expr.slice(0, start - 2) + m[0];
            else expr = `${expr.slice(0, start)}(−${m[0]}`;
            lastResult = null;
        } else if (k === '%') {
            // 200+10% → 200+20 (앞 값의 %), 50×10% → 50×0.1
            const m = lastNumberMatch();
            if (!m) return;
            const start = expr.length - m[0].length;
            const before = expr.slice(0, start);
            const op = before.slice(-1);
            let val = Number(m[0]) / 100;
            if ((op === '+' || op === '−') && before.length > 1) {
                try { val = evaluateExpr(before.slice(0, -1)) * Number(m[0]) / 100; } catch { /* 기본값 */ }
            }
            expr = before + String(tidy(val));
            lastResult = null;
        } else if (k === '=') {
            if (!expr) return;
            let e = expr;
            while (OPS.includes(e.slice(-1)) || e.slice(-1) === '(') e = e.slice(0, -1);
            const open = (e.match(/\(/g) || []).length - (e.match(/\)/g) || []).length;
            e += ')'.repeat(Math.max(0, open));
            try {
                const r = evaluateExpr(e);
                if (!Number.isFinite(r)) { showToast('⚠️ 0으로 나눌 수 없습니다.'); return; }
                history = [{ e, r }, ...history].slice(0, 30);
                writeJson(CALC_HIST_KEY, history);
                // 음수 결과는 '(−5'로 두어 이어서 계산할 수 있게 (닫는 괄호는 '='에서 자동으로)
                expr = r < 0 ? `(−${-r}` : String(r);
                lastResult = r;
            } catch { showToast('⚠️ 식이 올바르지 않습니다.'); return; }
        } else if (['MC', 'MR', 'M+', 'M−'].includes(k)) {
            const cur = (() => { try { return evaluateExpr(expr.replace(/[+−×÷(]$/, '')); } catch { return 0; } })();
            if (k === 'MC') memory = 0;
            if (k === 'M+') memory = tidy(memory + cur);
            if (k === 'M−') memory = tidy(memory - cur);
            if (k === 'MR') {
                if (lastResult !== null || !expr) expr = '';
                if (/[\d)]$/.test(expr)) expr += '×';
                expr += memory < 0 ? `(−${-memory})` : String(memory);
                lastResult = null;
            }
            writeJson(CALC_MEM_KEY, memory);
        }
        draw();
    };

    const keyBtn = (k, cls = 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-200') =>
        `<button type="button" data-k="${esc(k)}" class="calc-key h-14 rounded-xl text-lg font-black shadow-sm active:scale-95 transition ${cls}">${esc(k)}</button>`;
    const OP_CLS = 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200';
    const FN_CLS = 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-base';

    const draw = () => {
        const shown = lastResult !== null ? fmt(lastResult) : preview();
        container.innerHTML = card('전자계산기', 'calculator', 'text-indigo-600', '사칙연산·괄호·%·메모리. 키보드로도 입력할 수 있습니다 (숫자, + - * /, Enter, Backspace, Esc, %).', `
        <div class="grid lg:grid-cols-[minmax(0,420px)_1fr] gap-4">
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="rounded-xl bg-slate-900 text-white p-4 text-right space-y-1 min-h-[104px] select-all">
                    <div class="text-xs text-slate-400 font-mono break-all min-h-[16px]">${memory ? `<span class="float-left text-amber-300 font-bold">M ${esc(fmt(memory))}</span>` : ''}${esc(lastResult !== null ? `${pretty(history[0]?.e || '')} =` : pretty(expr))}</div>
                    <div id="calc-display" class="text-4xl font-black font-mono break-all leading-tight">${esc(shown || (expr ? pretty(expr) : '0'))}</div>
                </div>
                <div class="grid grid-cols-4 gap-2">
                    ${['MC', 'MR', 'M+', 'M−'].map(k => keyBtn(k, 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-sm h-10')).join('')}
                    ${keyBtn('C', 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200')}${keyBtn('CE', FN_CLS)}${keyBtn('⌫', FN_CLS)}${keyBtn('÷', OP_CLS)}
                    ${keyBtn('7')}${keyBtn('8')}${keyBtn('9')}${keyBtn('×', OP_CLS)}
                    ${keyBtn('4')}${keyBtn('5')}${keyBtn('6')}${keyBtn('−', OP_CLS)}
                    ${keyBtn('1')}${keyBtn('2')}${keyBtn('3')}${keyBtn('+', OP_CLS)}
                    ${keyBtn('(', FN_CLS)}${keyBtn(')', FN_CLS)}${keyBtn('%', FN_CLS)}${keyBtn('±', FN_CLS)}
                    <div class="col-span-2">${keyBtn('0').replace('h-14 rounded-xl', 'h-14 w-full rounded-xl')}</div>${keyBtn('.')}${keyBtn('=', 'bg-indigo-600 hover:bg-indigo-700 text-white')}
                </div>
                <button type="button" id="calc-copy" class="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5"><i data-lucide="copy" class="w-3.5 h-3.5"></i>결과 복사</button>
            </div>
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-[300px]">
                <div class="flex items-center justify-between mb-2"><h3 class="font-black text-sm text-slate-800">계산 기록</h3>
                    ${history.length ? '<button type="button" id="calc-hist-clear" class="text-xs font-bold text-rose-600 hover:underline">기록 지우기</button>' : ''}</div>
                <div class="flex-1 overflow-y-auto divide-y divide-slate-100 text-sm">
                    ${history.map((h, i) => `<button type="button" class="calc-hist w-full text-right px-2 py-2 hover:bg-slate-50 rounded-lg" data-i="${i}" title="눌러서 결과 불러오기">
                        <div class="text-xs text-slate-400 font-mono break-all">${esc(pretty(h.e))} =</div>
                        <div class="font-black font-mono text-slate-900">${esc(fmt(h.r))}</div></button>`).join('') || '<div class="text-center text-slate-400 font-bold py-10 text-xs">계산 기록이 없습니다.</div>'}
                </div>
            </div>
        </div>`);
        createIcons({ icons });
        container.querySelectorAll('.calc-key').forEach(b => b.addEventListener('click', () => press(b.dataset.k)));
        container.querySelector('#calc-copy').addEventListener('click', async () => {
            const v = lastResult !== null ? String(lastResult) : (() => { try { return String(evaluateExpr(expr || '0')); } catch { return ''; } })();
            try { await navigator.clipboard.writeText(v); showToast(`📋 ${v} 복사했습니다.`); } catch { showToast('⚠️ 복사하지 못했습니다.'); }
        });
        container.querySelector('#calc-hist-clear')?.addEventListener('click', () => { history = []; writeJson(CALC_HIST_KEY, history); draw(); });
        container.querySelectorAll('.calc-hist').forEach(b => b.addEventListener('click', () => {
            const r = history[Number(b.dataset.i)].r;
            expr = r < 0 ? `(−${-r}` : String(r);
            lastResult = null;
            draw();
        }));
    };

    // 키보드 입력 (이 화면이 떠 있는 동안만)
    const onKey = (e) => {
        if (!container.isConnected || !container.querySelector('#calc-display')) { document.removeEventListener('keydown', onKey); return; }
        if (e.target?.closest?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
        // 화면을 덮은 모달이 실제로 보이면 무시 (투명한 사이드바 배경막 등은 제외)
        const overlay = [...document.querySelectorAll('.fixed.inset-0')].some(el => {
            const cs = getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && cs.pointerEvents !== 'none';
        });
        if (overlay) return;
        const map = { '*': '×', x: '×', '/': '÷', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'C', Delete: 'CE', '%': '%', '(': '(', ')': ')', '.': '.', ',': '.' };
        const k = /^\d$/.test(e.key) ? e.key : map[e.key];
        if (!k) return;
        e.preventDefault();
        press(k);
    };
    if (renderCalculator._onKey) document.removeEventListener('keydown', renderCalculator._onKey);
    renderCalculator._onKey = onKey;
    document.addEventListener('keydown', onKey);
    draw();
};

// =====================================================================
// 단위환산계산기
// =====================================================================
// 각 단위의 기준 단위 배수 (온도는 따로)
const UNIT_GROUPS = [
    { key: 'length', name: '길이', base: 'm', units: [
        ['mm', '밀리미터', 0.001], ['cm', '센티미터', 0.01], ['m', '미터', 1], ['km', '킬로미터', 1000],
        ['in', '인치', 0.0254], ['ft', '피트', 0.3048], ['yd', '야드', 0.9144], ['mi', '마일', 1609.344], ['자', '자(尺)', 10 / 33], ['리', '리(里)', 392.7]] },
    { key: 'mass', name: '무게', base: 'kg', units: [
        ['mg', '밀리그램', 1e-6], ['g', '그램', 0.001], ['kg', '킬로그램', 1], ['t', '톤', 1000],
        ['oz', '온스', 0.028349523125], ['lb', '파운드', 0.45359237], ['근', '근(600g)', 0.6], ['관', '관(3.75kg)', 3.75], ['돈', '돈(3.75g)', 0.00375]] },
    { key: 'volume', name: '부피', base: 'L', units: [
        ['mL', '밀리리터(cc)', 0.001], ['L', '리터', 1], ['m³', '세제곱미터', 1000],
        ['gal', '미국 갤런', 3.785411784], ['imp gal', '영국 갤런', 4.54609], ['qt', '미국 쿼트', 0.946352946], ['pt', '미국 파인트', 0.473176473],
        ['fl oz', '미국 액량온스', 0.0295735295625], ['bbl', '석유 배럴', 158.987294928], ['드럼', '드럼(200L)', 200], ['말', '말(18L)', 18], ['되', '되(1.8L)', 1.8]] },
    { key: 'area', name: '넓이', base: 'm²', units: [
        ['cm²', '제곱센티미터', 1e-4], ['m²', '제곱미터', 1], ['km²', '제곱킬로미터', 1e6], ['ha', '헥타르', 1e4], ['a', '아르', 100],
        ['평', '평', 400 / 121], ['ft²', '제곱피트', 0.09290304], ['yd²', '제곱야드', 0.83612736], ['ac', '에이커', 4046.8564224]] },
    { key: 'temp', name: '온도', base: '°C', units: [['°C', '섭씨'], ['°F', '화씨'], ['K', '켈빈']] },
    { key: 'pressure', name: '압력', base: 'kPa', units: [
        ['Pa', '파스칼', 0.001], ['kPa', '킬로파스칼', 1], ['MPa', '메가파스칼', 1000], ['bar', '바', 100], ['mbar', '밀리바', 0.1],
        ['atm', '기압', 101.325], ['psi', 'psi', 6.894757293168], ['kgf/cm²', 'kgf/cm²', 98.0665], ['mmHg', 'mmHg', 0.133322387415], ['mmH₂O', 'mmAq', 0.00980665]] },
    { key: 'speed', name: '속도', base: 'm/s', units: [
        ['m/s', '미터/초', 1], ['km/h', '킬로미터/시', 1 / 3.6], ['mph', '마일/시', 0.44704], ['kn', '노트', 1852 / 3600], ['ft/s', '피트/초', 0.3048]] },
    { key: 'sg', name: '부피↔무게 (비중)', base: 'kg', units: [
        ['L', '리터', 'vol', 1], ['mL', '밀리리터', 'vol', 0.001], ['m³', '세제곱미터', 'vol', 1000], ['gal', '미국 갤런', 'vol', 3.785411784], ['드럼', '드럼(200L)', 'vol', 200],
        ['kg', '킬로그램', 'mass', 1], ['g', '그램', 'mass', 0.001], ['t', '톤', 'mass', 1000], ['lb', '파운드', 'mass', 0.45359237]] }
];
const UNIT_KEY = 'daelim_unitconv';
// 처음 고를 때의 기본 단위 (변환할 단위 → 결과 단위)
const UNIT_DEFAULTS = { length: ['m', 'ft'], mass: ['kg', 'lb'], volume: ['L', 'gal'], area: ['m²', '평'], temp: ['°C', '°F'], pressure: ['bar', 'psi'], speed: ['km/h', 'mph'], sg: ['L', 'kg'] };

const tempToC = (v, u) => (u === '°C' ? v : u === '°F' ? (v - 32) * 5 / 9 : v - 273.15);
const cToTemp = (c, u) => (u === '°C' ? c : u === '°F' ? c * 9 / 5 + 32 : c + 273.15);

export const renderUnitConverter = (container) => {
    const saved = readJson(UNIT_KEY, {});
    const st = { group: saved.group || 'volume', value: saved.value ?? '1', from: saved.from || {}, to: saved.to || {}, sg: saved.sg || '0.87' };
    const G = () => UNIT_GROUPS.find(g => g.key === st.group) || UNIT_GROUPS[0];
    const fromUnit = () => st.from[st.group] || UNIT_DEFAULTS[st.group]?.[0] || G().units[0][0];
    const toUnit = () => st.to[st.group] || UNIT_DEFAULTS[st.group]?.[1] || G().units.find(u => u[0] !== fromUnit())?.[0];
    const persist = () => writeJson(UNIT_KEY, st);

    const convert = (v, fu, tu) => {
        const g = G();
        if (g.key === 'temp') return cToTemp(tempToC(v, fu), tu);
        if (g.key === 'sg') {
            const sg = Number(st.sg) || 0;
            const f = g.units.find(u => u[0] === fu); const t = g.units.find(u => u[0] === tu);
            // 기준: kg. 부피(L) × 비중 = kg
            const kg = f[2] === 'vol' ? v * f[3] * sg : v * f[3];
            return t[2] === 'vol' ? (sg ? kg / sg / t[3] : NaN) : kg / t[3];
        }
        const f = g.units.find(u => u[0] === fu)[2]; const t = g.units.find(u => u[0] === tu)[2];
        return v * f / t;
    };

    const draw = () => {
        const g = G();
        const v = Number(String(st.value).replace(/,/g, ''));
        const fu = fromUnit(); const tu = toUnit();
        const ok = String(st.value).trim() !== '' && Number.isFinite(v);
        const result = ok ? convert(v, fu, tu) : NaN;
        const opt = (sel) => g.units.map(u => `<option value="${esc(u[0])}" ${u[0] === sel ? 'selected' : ''}>${esc(u[0])} · ${esc(u[1])}</option>`).join('');
        container.innerHTML = card('단위환산계산기', 'ruler', 'text-emerald-600', '값과 단위를 고르면 바로 바뀝니다. 아래 표에서 같은 종류의 모든 단위 값을 한눈에 봅니다.', `
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap gap-1.5">${UNIT_GROUPS.map(x => `<button type="button" class="uc-group px-3 py-1.5 rounded-xl text-xs font-bold border ${x.key === st.group ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}" data-g="${x.key}">${esc(x.name)}</button>`).join('')}</div>
            ${g.key === 'sg' ? `<label class="flex items-center gap-2 text-xs font-bold text-slate-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 w-fit">비중(SG, 15℃) <input id="uc-sg" type="number" step="0.001" min="0" value="${esc(st.sg)}" class="w-24 border border-amber-300 rounded-lg px-2 py-1 text-right font-mono font-black bg-white" /><span class="font-normal text-amber-800">kg = L × 비중</span></label>` : ''}
            <div class="grid md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
                <div class="space-y-1.5">
                    <label class="text-xs font-bold text-slate-500">변환할 값</label>
                    <input id="uc-value" type="text" inputmode="decimal" value="${esc(st.value)}" class="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-2xl font-black font-mono text-right" />
                    <select id="uc-from" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold">${opt(fu)}</select>
                </div>
                <button type="button" id="uc-swap" class="h-11 w-11 mx-auto rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center" title="단위 바꾸기"><i data-lucide="arrow-left-right" class="w-5 h-5"></i></button>
                <div class="space-y-1.5">
                    <label class="text-xs font-bold text-slate-500">결과</label>
                    <div class="w-full border border-emerald-300 bg-emerald-50 rounded-xl px-3 py-2.5 text-2xl font-black font-mono text-right text-emerald-800 min-h-[52px] break-all" id="uc-result">${ok ? esc(fmt(result, 8)) : '-'}</div>
                    <select id="uc-to" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold">${opt(tu)}</select>
                </div>
            </div>
            <div class="text-center text-sm font-bold text-slate-600">${ok ? `${esc(fmt(v, 8))} ${esc(fu)} = <span class="text-emerald-700 font-black">${esc(fmt(result, 8))} ${esc(tu)}</span>` : '숫자를 입력하세요.'}</div>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <h3 class="font-black text-sm text-slate-800 mb-2">${esc(ok ? `${fmt(v, 8)} ${fu}` : '-')} 는(은)</h3>
            <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                ${g.units.map(u => `<button type="button" class="uc-pick text-left px-3 py-2 rounded-xl border ${u[0] === tu ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}" data-u="${esc(u[0])}" title="결과 단위로 고르기">
                    <div class="text-[11px] text-slate-500 font-bold">${esc(u[1])}</div>
                    <div class="font-mono font-black text-slate-900 break-all">${ok ? esc(fmt(convert(v, fu, u[0]), 8)) : '-'} <span class="text-xs text-slate-500">${esc(u[0])}</span></div></button>`).join('')}
            </div>
        </div>`);
        createIcons({ icons });
        bind();
    };
    const bind = () => {
        const $ = (s) => container.querySelector(s);
        container.querySelectorAll('.uc-group').forEach(b => b.addEventListener('click', () => { st.group = b.dataset.g; persist(); draw(); }));
        $('#uc-value').addEventListener('input', (e) => {
            st.value = e.target.value; persist();
            const pos = e.target.selectionStart;
            draw();
            const inp = container.querySelector('#uc-value'); inp.focus(); inp.setSelectionRange(pos, pos);
        });
        $('#uc-from').addEventListener('change', (e) => { st.from[st.group] = e.target.value; persist(); draw(); });
        $('#uc-to').addEventListener('change', (e) => { st.to[st.group] = e.target.value; persist(); draw(); });
        $('#uc-swap').addEventListener('click', () => { const f = fromUnit(); st.from[st.group] = toUnit(); st.to[st.group] = f; persist(); draw(); });
        container.querySelectorAll('.uc-pick').forEach(b => b.addEventListener('click', () => { st.to[st.group] = b.dataset.u; persist(); draw(); }));
        $('#uc-sg')?.addEventListener('input', (e) => {
            st.sg = e.target.value; persist();
            const pos = e.target.selectionStart;
            draw();
            const inp = container.querySelector('#uc-sg'); inp.focus(); inp.setSelectionRange?.(pos, pos);
        });
    };
    draw();
};

// =====================================================================
// 환율계산기
// =====================================================================
const FX_CACHE_KEY = 'daelim_fx_rates';
const FX_UI_KEY = 'daelim_fx_ui';
const FX_TTL = 6 * 60 * 60 * 1000;
const CURRENCIES = [
    ['KRW', '대한민국 원', '₩'], ['USD', '미국 달러', '$'], ['EUR', '유로', '€'], ['JPY', '일본 엔', '¥'], ['CNY', '중국 위안', '¥'],
    ['GBP', '영국 파운드', '£'], ['HKD', '홍콩 달러', 'HK$'], ['TWD', '대만 달러', 'NT$'], ['SGD', '싱가포르 달러', 'S$'], ['AUD', '호주 달러', 'A$'],
    ['CAD', '캐나다 달러', 'C$'], ['NZD', '뉴질랜드 달러', 'NZ$'], ['CHF', '스위스 프랑', 'Fr'], ['THB', '태국 바트', '฿'], ['VND', '베트남 동', '₫'],
    ['IDR', '인도네시아 루피아', 'Rp'], ['MYR', '말레이시아 링깃', 'RM'], ['PHP', '필리핀 페소', '₱'], ['INR', '인도 루피', '₹'], ['AED', 'UAE 디르함', 'AED'],
    ['SAR', '사우디 리얄', 'SAR'], ['RUB', '러시아 루블', '₽'], ['MXN', '멕시코 페소', 'MX$'], ['BRL', '브라질 헤알', 'R$'], ['MNT', '몽골 투그릭', '₮'],
    ['KZT', '카자흐스탄 텡게', '₸'], ['UZS', '우즈베키스탄 숨', 'soʻm'], ['TRY', '튀르키예 리라', '₺'], ['PLN', '폴란드 즈워티', 'zł'], ['SEK', '스웨덴 크로나', 'kr']
];
// 원화 고시 관례: 100단위로 표시하는 통화
const PER100 = new Set(['JPY', 'VND', 'IDR']);

const fetchRates = async () => {
    // 1) open.er-api.com (무료·키 없음·하루 1회 갱신) 2) frankfurter.app (유럽중앙은행 고시, 영업일 갱신)
    try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD');
        const j = await r.json();
        if (j.result === 'success' && j.rates?.KRW) return { rates: j.rates, at: j.time_last_update_utc, source: 'ExchangeRate-API (open.er-api.com)', fetchedAt: Date.now() };
    } catch { /* 다음 */ }
    const r = await fetch('https://api.frankfurter.app/latest?from=USD');
    if (!r.ok) throw new Error('환율 서버에 연결하지 못했습니다.');
    const j = await r.json();
    return { rates: { USD: 1, ...j.rates }, at: j.date, source: '유럽중앙은행 고시 (frankfurter.app)', fetchedAt: Date.now() };
};

export const renderFxCalculator = (container, { showToast = () => {} } = {}) => {
    const ui = readJson(FX_UI_KEY, {});
    const st = { amount: ui.amount ?? '1000', from: ui.from || 'USD', to: ui.to || 'KRW', fee: ui.fee ?? '0' };
    let data = readJson(FX_CACHE_KEY, null);
    let loading = false;
    let error = '';
    const persist = () => writeJson(FX_UI_KEY, st);
    const has = (c) => data?.rates && Number(data.rates[c]) > 0;
    // a 통화 1단위 = ? b 통화
    const rate = (a, b) => (has(a) && has(b) ? data.rates[b] / data.rates[a] : NaN);

    const load = async (force = false) => {
        if (!force && data && Date.now() - (data.fetchedAt || 0) < FX_TTL) return;
        loading = true; error = ''; draw();
        try { data = await fetchRates(); writeJson(FX_CACHE_KEY, data); if (force) showToast('💱 환율을 새로 받았습니다.'); }
        catch (e) { error = data ? `${e.message} 저장해 둔 환율로 계산합니다.` : `${e.message} 인터넷 연결을 확인하세요.`; }
        loading = false; draw();
    };

    const opts = (sel) => CURRENCIES.filter(c => has(c[0]) || !data).map(c => `<option value="${c[0]}" ${c[0] === sel ? 'selected' : ''}>${c[0]} · ${esc(c[1])}</option>`).join('');
    const krwPer = (c) => { const r = rate(c, 'KRW'); return PER100.has(c) ? r * 100 : r; };

    const draw = () => {
        const amt = Number(String(st.amount).replace(/,/g, ''));
        const ok = String(st.amount).trim() !== '' && Number.isFinite(amt);
        const r = rate(st.from, st.to);
        const fee = Number(st.fee) || 0;
        const raw = ok ? amt * r : NaN;
        const withFee = raw * (1 + fee / 100);
        const at = data?.at ? new Date(data.at) : null;
        const atText = at && !Number.isNaN(at.getTime()) ? at.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : (data?.at || '-');
        const digits = st.to === 'KRW' || PER100.has(st.to) ? 0 : 2;
        container.innerHTML = card('환율계산기', 'coins', 'text-amber-600', '무료 공개 환율(기준 환율)로 계산합니다. 은행의 살 때·팔 때 환율과는 차이가 있으니 수수료(%)로 보정하세요.', `
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="px-2.5 py-1 rounded-full bg-slate-100 font-bold text-slate-600">기준 시각: ${esc(atText)}</span>
                ${data ? `<span class="text-slate-400">출처: ${esc(data.source)} · ${Math.round((Date.now() - (data.fetchedAt || 0)) / 60000)}분 전 받음</span>` : ''}
                <button type="button" id="fx-refresh" class="ml-auto px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold flex items-center gap-1.5 disabled:opacity-50" ${loading ? 'disabled' : ''}><i data-lucide="refresh-cw" class="w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}"></i>${loading ? '받는 중…' : '환율 새로 받기'}</button>
            </div>
            ${error ? `<div class="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">${esc(error)}</div>` : ''}
            <div class="grid md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
                <div class="space-y-1.5">
                    <label class="text-xs font-bold text-slate-500">금액</label>
                    <input id="fx-amount" type="text" inputmode="decimal" value="${esc(st.amount)}" class="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-2xl font-black font-mono text-right" />
                    <select id="fx-from" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold">${opts(st.from)}</select>
                </div>
                <button type="button" id="fx-swap" class="h-11 w-11 mx-auto rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center" title="통화 바꾸기"><i data-lucide="arrow-left-right" class="w-5 h-5"></i></button>
                <div class="space-y-1.5">
                    <label class="text-xs font-bold text-slate-500">환산 금액${fee ? ` (수수료 ${fee > 0 ? '+' : ''}${fee}% 반영)` : ''}</label>
                    <div class="w-full border border-amber-300 bg-amber-50 rounded-xl px-3 py-2.5 text-2xl font-black font-mono text-right text-amber-800 min-h-[52px] break-all">${ok && Number.isFinite(withFee) ? esc(fmt(Number(withFee.toFixed(digits)), digits)) : '-'}</div>
                    <select id="fx-to" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold">${opts(st.to)}</select>
                </div>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div class="font-bold text-slate-600">${Number.isFinite(r) ? `1 ${esc(st.from)} = <span class="font-black text-slate-900">${esc(fmt(r, 6))}</span> ${esc(st.to)} · 1 ${esc(st.to)} = ${esc(fmt(1 / r, 6))} ${esc(st.from)}` : (loading ? '환율을 받는 중입니다…' : '환율 정보가 없습니다.')}</div>
                <label class="flex items-center gap-1.5 text-xs font-bold text-slate-600">수수료·우대 보정
                    <input id="fx-fee" type="number" step="0.01" value="${esc(st.fee)}" class="w-20 border border-slate-300 rounded-lg px-2 py-1 text-right font-mono" />%
                    <span class="font-normal text-slate-400">(예: 현찰 살 때 +1.75)</span></label>
            </div>
            ${ok && fee && Number.isFinite(raw) ? `<div class="text-xs text-slate-500 text-right">기준 환율 금액 ${esc(fmt(Number(raw.toFixed(digits)), digits))} ${esc(st.to)}</div>` : ''}
        </div>
        <div class="grid lg:grid-cols-2 gap-4">
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <h3 class="font-black text-sm text-slate-800 mb-2">${ok ? `${esc(fmt(amt, 4))} ${esc(st.from)} 는(은)` : '환산표'}</h3>
                <div class="divide-y divide-slate-100 text-sm max-h-[420px] overflow-y-auto">
                    ${CURRENCIES.filter(c => c[0] !== st.from && has(c[0])).map(c => `<button type="button" class="fx-pick w-full flex items-center justify-between px-2 py-1.5 hover:bg-slate-50 rounded-lg ${c[0] === st.to ? 'bg-amber-50' : ''}" data-c="${c[0]}">
                        <span class="text-left"><span class="font-black">${c[0]}</span> <span class="text-xs text-slate-500">${esc(c[1])}</span></span>
                        <span class="font-mono font-black">${ok ? esc(fmt(Number((amt * rate(st.from, c[0])).toFixed(c[0] === 'KRW' || PER100.has(c[0]) ? 0 : 2)), 2)) : '-'}</span></button>`).join('') || '<div class="text-center text-slate-400 py-8 text-xs font-bold">환율 정보가 없습니다.</div>'}
                </div>
            </div>
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <h3 class="font-black text-sm text-slate-800 mb-2">원화 기준 환율 <span class="text-xs font-normal text-slate-400">(JPY·VND·IDR은 100단위)</span></h3>
                <div class="divide-y divide-slate-100 text-sm max-h-[420px] overflow-y-auto">
                    ${CURRENCIES.filter(c => c[0] !== 'KRW' && has(c[0])).map(c => `<div class="flex items-center justify-between px-2 py-1.5">
                        <span><span class="font-black">${PER100.has(c[0]) ? '100 ' : ''}${c[0]}</span> <span class="text-xs text-slate-500">${esc(c[1])}</span></span>
                        <span class="font-mono font-black">${esc(fmt(Number(krwPer(c[0]).toFixed(2)), 2))} 원</span></div>`).join('') || '<div class="text-center text-slate-400 py-8 text-xs font-bold">환율 정보가 없습니다.</div>'}
                </div>
            </div>
        </div>`);
        createIcons({ icons });
        bind();
    };
    const keepFocus = (sel, fn) => (e) => {
        fn(e.target.value); persist();
        const pos = e.target.selectionStart;
        draw();
        const inp = container.querySelector(sel); inp?.focus(); try { inp?.setSelectionRange(pos, pos); } catch { /* number 입력 */ }
    };
    const bind = () => {
        const $ = (s) => container.querySelector(s);
        $('#fx-amount').addEventListener('input', keepFocus('#fx-amount', v => { st.amount = v; }));
        $('#fx-fee').addEventListener('input', keepFocus('#fx-fee', v => { st.fee = v; }));
        $('#fx-from').addEventListener('change', (e) => { st.from = e.target.value; persist(); draw(); });
        $('#fx-to').addEventListener('change', (e) => { st.to = e.target.value; persist(); draw(); });
        $('#fx-swap').addEventListener('click', () => { [st.from, st.to] = [st.to, st.from]; persist(); draw(); });
        $('#fx-refresh').addEventListener('click', () => load(true));
        container.querySelectorAll('.fx-pick').forEach(b => b.addEventListener('click', () => { st.to = b.dataset.c; persist(); draw(); }));
    };
    draw();
    load();
};
