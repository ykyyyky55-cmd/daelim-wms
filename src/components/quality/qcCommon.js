// 품질관리 화면 공용 도우미 (사업장 표시·선택, 사진 줄이기, 입력 창 틀)
import { esc } from '../../services/html.js';
import { QC_SITES, siteOf, PROCESS_STAGES, stageOf } from '../../services/qcStandards.js';
import { judgeValue } from '../../services/qcProductSpecs.js';

export const INPUT_CLS = 'mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5';

/** 보기 선택(사업장·공정 단계) 기기별 기억 */
export const loadQcPref = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(`daelim_qc_${key}`) || 'null') ?? fallback; } catch (e) { console.warn('[품질] 보기 설정을 읽지 못했습니다', e); return fallback; }
};
export const saveQcPref = (key, value) => {
    try { localStorage.setItem(`daelim_qc_${key}`, JSON.stringify(value)); } catch (e) { console.warn('[품질] 보기 설정을 저장하지 못했습니다', e); }
};

/** 사업장 배지 (본사 보라 / 김포 하늘 / 미지정 회색) */
export const siteBadge = (rec) => {
    const s = siteOf(rec);
    if (!s) return '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">미지정</span>';
    return `<span class="px-1.5 py-0.5 rounded text-[10px] font-black ${s === 'HQ' ? 'bg-purple-100 text-purple-800' : 'bg-sky-100 text-sky-800'}">${QC_SITES[s]}</span>`;
};

/** 사업장 선택 칸. 화면에서 한 사업장을 보고 있으면 그 값이 기본 */
export const siteSelectHtml = (id, value) => `
    <select id="${id}" class="${INPUT_CLS}">
        <option value="">사업장 선택 *</option>
        ${Object.entries(QC_SITES).map(([k, l]) => `<option value="${k}" ${value === k ? 'selected' : ''}>${l}</option>`).join('')}
    </select>`;

/** 보기 조건(사업장 ALL/HQ/GIMPO, 공정 단계)에 맞는 기록인지 */
export const inScope = (rec, { site = 'ALL', area = '', stage = '' } = {}) => {
    if (site !== 'ALL' && siteOf(rec) !== site) return false;
    if (area === 'PROCESS' && stage && stageOf(rec) !== stage) return false;
    return true;
};

/** 보기 이름 (예: '김포 · 원액생산', '전체 사업장') */
export const scopeLabel = ({ site = 'ALL', area = '', stage = '' } = {}) => [
    site === 'ALL' ? '본사+김포' : QC_SITES[site],
    area === 'PROCESS' && PROCESS_STAGES[stage] ? PROCESS_STAGES[stage].label : ''
].filter(Boolean).join(' · ');

/**
 * 사진 파일을 긴 변 maxSide px JPEG로 줄여 dataURL로 돌려준다 (보고서에 넣어 인쇄할 수 있게 기록 안에 저장)
 * @param {File} file
 * @returns {Promise<string>}
 */
export const shrinkImageFile = (file, maxSide = 1280, quality = 0.8) => new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) { reject(new Error(`${file.name}: 사진 파일이 아닙니다.`)); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name}: 파일을 읽지 못했습니다.`));
    reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error(`${file.name}: 사진을 열지 못했습니다.`));
        img.onload = () => {
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
});

/** 입력 창 틀. 돌려준 요소 안에서 querySelector로 칸을 찾는다 */
export const openModal = (modal, { title, sub = '', bodyHtml, maxW = 'max-w-3xl' }) => {
    modal.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xl w-full ${maxW} max-h-[92vh] overflow-y-auto p-5 space-y-4 text-xs">
        <div class="flex items-start justify-between gap-3">
            <div><h3 class="text-base font-black text-slate-900">${esc(title)}</h3>${sub ? `<div class="text-[11px] text-slate-400">${esc(sub)}</div>` : ''}</div>
            <div class="flex items-start gap-2"><div data-appr></div><button type="button" data-close class="p-1 rounded-lg hover:bg-slate-100 text-lg leading-none">×</button></div>
        </div>
        ${bodyHtml}
    </div>`;
    modal.classList.remove('hidden');
    const close = () => { modal.classList.add('hidden'); modal.innerHTML = ''; };
    modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    return { el: modal, $: (s) => modal.querySelector(s), close };
};

/** 목록 위 요약·버튼 줄 */
export const listCardHtml = ({ title, count, extra = '', button = '', bodyHtml }) => `
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div class="flex flex-wrap items-center gap-3"><b class="text-slate-800">${esc(title)}</b><span class="text-slate-500">${count.toLocaleString()}건</span>${extra}</div>
            ${button}
        </div>
        ${bodyHtml}
    </div>`;

export const emptyRow = (colspan, text) => `<tr><td colspan="${colspan}" class="p-10 text-center text-slate-400">${esc(text)}</td></tr>`;

/**
 * 시험항목 표 편집기 (성적서 공용). rows: [{ name, method, spec, result, judge: 'OK'|'NG'|'', off? }]
 * selectable: 항목마다 [시험] 체크 — 끈 줄(off)은 getRows()에서 빠지고 getExcluded()로 돌려준다 (제품시험성적서)
 * @returns {{ getRows: () => Object[], getExcluded: () => Object[], setRows: (rows: Object[]) => void }}
 */
export const mountTestTable = (host, initialRows, { readOnly = false, selectable = false, compare = null } = {}) => {
    let rows = initialRows.map(r => ({ name: '', method: '', spec: '', result: '', judge: '', ...r }));
    const cell = 'w-full border border-slate-300 rounded px-1.5 py-1';
    // compare: 비교 칸 이름 목록 (예: ['자체 분석']) — 성적서 결과와 우리 분석값을 나란히. null이면 비교 칸 기능 없음.
    let cmpCols = Array.isArray(compare) ? [...compare] : null;
    const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null; };
    const cmpBadge = (r, col) => {
        const v = r.cmp?.[col];
        if (v === undefined || String(v).trim() === '') return '';
        const j = judgeValue(v, r.spec);
        const a = num(r.result), b = num(v);
        const diff = a !== null && b !== null ? b - a : null;
        const pct = diff !== null && a ? (diff / a) * 100 : null;
        return `<div class="mt-0.5 text-[10px] leading-tight ${j === 'NG' ? 'text-rose-600 font-black' : 'text-slate-500'}">${j === 'OK' ? '규격 적합' : j === 'NG' ? '규격 벗어남' : ''}${diff !== null ? ` · 차이 ${diff > 0 ? '+' : ''}${Math.round(diff * 10000) / 10000}${pct !== null ? ` (${pct > 0 ? '+' : ''}${Math.round(pct * 10) / 10}%)` : ''}` : ''}</div>`;
    };
    const paint = () => {
        const nOff = rows.filter(r => r.off).length;
        host.innerHTML = `${selectable && !readOnly ? `<div class="flex flex-wrap items-center gap-2 mb-1.5 text-[11px]">
                <span class="text-slate-500">시험할 항목만 체크하세요. 체크를 끈 항목은 성적서에 넣지 않습니다${nOff ? ` (<b class="text-amber-700">${nOff}개 뺌</b>)` : ''}.</span>
                <button type="button" data-all-on class="px-2 py-0.5 rounded-md bg-white border border-slate-300 font-bold">모두 선택</button>
                <button type="button" data-off-empty class="px-2 py-0.5 rounded-md bg-white border border-slate-300 font-bold">결과 없는 항목 빼기</button></div>` : ''}
            <div class="overflow-x-auto"><table class="w-full text-xs min-w-[640px]">
            <thead class="bg-slate-50 text-slate-600"><tr>${selectable ? '<th class="px-1.5 py-1.5 text-center w-10 whitespace-nowrap" title="성적서에 넣을 항목">시험</th>' : ''}<th class="px-1.5 py-1.5 text-left w-[26%]">시험항목</th><th class="px-1.5 py-1.5 text-left w-[18%]">시험방법</th><th class="px-1.5 py-1.5 text-left w-[20%]">규격</th><th class="px-1.5 py-1.5 text-left w-[18%]">결과</th>${(cmpCols || []).map((c, ci) => `<th class="px-1.5 py-1.5 text-left bg-sky-50 text-sky-800 min-w-[110px]">${esc(c)}${readOnly ? '' : ` <button type="button" data-cmp-del="${ci}" class="text-rose-500 font-black" title="이 비교 칸 지우기">×</button>`}</th>`).join('')}<th class="px-1.5 py-1.5 text-center w-[12%]">판정</th><th class="w-8"></th></tr></thead>
            <tbody>${rows.map((r, i) => `<tr class="${r.off ? 'bg-slate-50 opacity-50' : ''}">
                ${selectable ? `<td class="p-1 text-center"><input type="checkbox" data-on="${i}" ${r.off ? '' : 'checked'} ${readOnly ? 'disabled' : ''} title="${r.off ? '이 항목을 다시 넣기' : '이 항목 빼기'}" /></td>` : ''}
                <td class="p-1"><input data-i="${i}" data-k="name" value="${esc(r.name)}" class="${cell} font-bold ${r.off ? 'line-through' : ''}" /></td>
                <td class="p-1"><input data-i="${i}" data-k="method" value="${esc(r.method)}" class="${cell}" /></td>
                <td class="p-1"><input data-i="${i}" data-k="spec" value="${esc(r.spec)}" class="${cell}" /></td>
                <td class="p-1"><input data-i="${i}" data-k="result" value="${esc(r.result)}" placeholder="${r.off ? '뺀 항목' : ''}" class="${cell} font-bold" /></td>
                ${(cmpCols || []).map(c => `<td class="p-1 bg-sky-50/50 align-top"><input data-i="${i}" data-cmp="${esc(c)}" value="${esc(r.cmp?.[c] ?? '')}" class="${cell} font-bold text-sky-900" ${readOnly ? 'disabled' : ''} />${cmpBadge(r, c)}</td>`).join('')}
                <td class="p-1"><select data-i="${i}" data-k="judge" class="${cell} ${r.judge === 'NG' ? 'text-rose-700 font-black' : r.judge === 'OK' ? 'text-emerald-700 font-bold' : ''}"><option value=""></option><option value="OK" ${r.judge === 'OK' ? 'selected' : ''}>적합</option><option value="NG" ${r.judge === 'NG' ? 'selected' : ''}>부적합</option></select></td>
                <td class="p-1 text-center">${readOnly ? '' : `<button type="button" data-del="${i}" class="text-rose-500 font-bold px-1" title="줄 지우기">×</button>`}</td>
            </tr>`).join('')}</tbody></table></div>
            ${readOnly ? '' : `<div class="flex flex-wrap gap-1.5 mt-1.5"><button type="button" data-add class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">＋ 시험항목 추가</button>${cmpCols ? '<button type="button" data-cmp-add class="px-2.5 py-1 rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold" title="성적서 결과와 비교할 칸 (자체 분석·재시험·외부기관 등)">＋ 비교 칸 추가</button>' : ''}</div>`}`;
        host.querySelectorAll('[data-cmp]').forEach(el => el.addEventListener('input', () => {
            const row = rows[Number(el.dataset.i)];
            row.cmp = { ...(row.cmp || {}), [el.dataset.cmp]: el.value };
            const td = el.parentElement;
            td.querySelector('div')?.remove();
            td.insertAdjacentHTML('beforeend', cmpBadge(row, el.dataset.cmp));
        }));
        host.querySelector('[data-cmp-add]')?.addEventListener('click', () => {
            const name = (prompt('비교 칸 이름 (예: 자체 분석, 재시험, 외부기관)', cmpCols.includes('자체 분석') ? '재시험' : '자체 분석') || '').trim();
            if (!name) return;
            if (cmpCols.includes(name)) { alert('같은 이름의 칸이 있습니다.'); return; }
            cmpCols.push(name); paint();
        });
        host.querySelectorAll('[data-cmp-del]').forEach(b => b.addEventListener('click', () => {
            const c = cmpCols[Number(b.dataset.cmpDel)];
            if (rows.some(r => String(r.cmp?.[c] ?? '').trim()) && !confirm(`'${c}' 칸에 넣은 값도 지워집니다. 지울까요?`)) return;
            cmpCols.splice(Number(b.dataset.cmpDel), 1);
            rows.forEach(r => { if (r.cmp) delete r.cmp[c]; });
            paint();
        }));
        host.querySelectorAll('[data-on]').forEach(el => el.addEventListener('change', () => { rows[Number(el.dataset.on)].off = !el.checked; paint(); host.dispatchEvent(new Event('change', { bubbles: true })); }));
        host.querySelector('[data-all-on]')?.addEventListener('click', () => { rows.forEach(r => { r.off = false; }); paint(); host.dispatchEvent(new Event('change', { bubbles: true })); });
        host.querySelector('[data-off-empty]')?.addEventListener('click', () => { rows.forEach(r => { if (!String(r.result || '').trim()) r.off = true; }); paint(); host.dispatchEvent(new Event('change', { bubbles: true })); });
        host.querySelectorAll('[data-k]').forEach(el => {
            el.disabled = readOnly || (!!rows[Number(el.dataset.i)].off && el.dataset.k !== 'name');
            el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
                const row = rows[Number(el.dataset.i)];
                row[el.dataset.k] = el.value;
                if (el.tagName === 'SELECT') { row.manualJudge = true; paint(); return; }
                // 숫자 규격이면 결과·규격을 고칠 때 판정을 자동으로 (판정을 직접 고른 줄은 그대로)
                if ((el.dataset.k === 'result' || el.dataset.k === 'spec') && !row.manualJudge) {
                    const j = judgeValue(row.result, row.spec);
                    if (j || !String(row.result || '').trim()) {
                        row.judge = j;
                        const sel = host.querySelector(`select[data-i="${el.dataset.i}"]`);
                        if (sel) { sel.value = j; sel.className = `${cell} ${j === 'NG' ? 'text-rose-700 font-black' : j === 'OK' ? 'text-emerald-700 font-bold' : ''}`; }
                        host.dispatchEvent(new Event('change', { bubbles: true })); // 종합 판정 다시 계산
                    }
                }
            });
        });
        host.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { rows.splice(Number(b.dataset.del), 1); paint(); }));
        host.querySelector('[data-add]')?.addEventListener('click', () => { rows.push({ name: '', method: '', spec: '', result: '', judge: '' }); paint(); });
    };
    paint();
    const clean = ({ off, ...r }) => ({ ...r, name: r.name.trim() });
    return {
        getRows: () => rows.filter(r => r.name.trim() && !r.off).map(clean),
        getExcluded: () => rows.filter(r => r.name.trim() && r.off).map(clean),
        getAll: () => rows.filter(r => r.name.trim()).map(r => ({ ...r, name: r.name.trim() })), // 뺀 줄 포함 (off 표시 유지)
        getCompareCols: () => (cmpCols ? [...cmpCols] : null),
        setRows: (next) => { rows = next.map(r => ({ name: '', method: '', spec: '', result: '', judge: '', ...r })); paint(); }
    };
};

/** 시험항목 판정으로 종합 판정: 부적합이 하나라도 있으면 NG, 모두 적합이면 OK, 그 밖 '' */
export const overallJudge = (rows) => (rows.some(r => r.judge === 'NG') ? 'NG' : rows.length && rows.every(r => r.judge === 'OK') ? 'OK' : '');

/** 기간·검색 조건 (flt: { from, to, q }) */
export const inPeriod = (rec, flt) => (!flt.from || (rec.date || '') >= flt.from) && (!flt.to || (rec.date || '') <= flt.to);
export const matchesText = (rec, flt, fields) => {
    const needle = String(flt.q || '').trim().toLowerCase();
    return !needle || fields.map(f => rec[f] || '').join(' ').toLowerCase().includes(needle);
};
