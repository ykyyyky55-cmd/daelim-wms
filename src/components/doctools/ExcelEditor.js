import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';
import { esc } from '../../services/html.js';

/**
 * 엑셀 뷰어·간단 편집기 (SheetJS, 이 브라우저 안에서만 처리)
 * - 열기: xlsx·xlsm·xls·csv·ods (버튼 또는 끌어놓기), 새 파일
 * - 편집: 셀 직접 입력(=수식은 그대로 저장, 엑셀에서 열 때 다시 계산), 수식 입력줄, 행·열 삽입/삭제, 시트 추가·이름 변경·삭제, 찾기
 * - 저장: 엑셀(.xlsx) / 지금 시트 CSV / 인쇄
 * 셀 모델: { v: 값, w: 표시 글자, f: 수식(= 없이), z: 숫자 서식 }
 */
const PAGE_ROWS = 300;
const colName = (c) => XLSX.utils.encode_col(c);
const isNumText = (s) => /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s.trim()) || /^[-+]?\.\d+$/.test(s.trim());
const displayOf = (cell) => {
    if (!cell) return '';
    if (cell.f && (cell.w === undefined || cell.w === null) && (cell.v === undefined || cell.v === null)) return `=${cell.f}`;
    if (cell.w !== undefined && cell.w !== null && cell.w !== '') return String(cell.w);
    if (cell.v instanceof Date) return cell.v.toLocaleDateString('ko-KR');
    if (typeof cell.v === 'number' && /%/.test(cell.z || '')) return `${Number((cell.v * 100).toPrecision(12)).toLocaleString('ko-KR', { maximumFractionDigits: 6 })}%`;
    if (typeof cell.v === 'number') return cell.v.toLocaleString('ko-KR', { maximumFractionDigits: 10 });
    return cell.v === undefined || cell.v === null ? '' : String(cell.v);
};
const rawOf = (cell) => {
    if (!cell) return '';
    if (cell.f) return `=${cell.f}`;
    if (cell.v instanceof Date) return cell.w || cell.v.toLocaleDateString('ko-KR');
    if (typeof cell.v === 'number' && /%/.test(cell.z || '')) return `${Number((cell.v * 100).toPrecision(12))}%`;
    return cell.v === undefined || cell.v === null ? '' : String(cell.v);
};

const bookFromWorkbook = (wb, name) => ({
    name,
    sheets: wb.SheetNames.map(sn => {
        const ws = wb.Sheets[sn];
        const rows = [];
        let cols = 0;
        if (ws['!ref']) {
            const range = XLSX.utils.decode_range(ws['!ref']);
            for (let r = range.s.r; r <= range.e.r; r++) {
                for (let c = range.s.c; c <= range.e.c; c++) {
                    const cell = ws[XLSX.utils.encode_cell({ r, c })];
                    if (!cell || (cell.v === undefined && !cell.f)) continue;
                    (rows[r] ||= [])[c] = { v: cell.v, w: cell.w, f: cell.f, z: cell.z };
                    cols = Math.max(cols, c + 1);
                }
            }
        }
        return { name: sn, rows, cols, merges: (ws['!merges'] || []).map(m => ({ s: { ...m.s }, e: { ...m.e } })), colWidths: (ws['!cols'] || []).map(x => x?.wpx || (x?.wch ? x.wch * 7 + 5 : null)) };
    })
});
const newBook = () => ({ name: '새 통합문서.xlsx', sheets: [{ name: 'Sheet1', rows: [], cols: 0, merges: [], colWidths: [] }] });

const workbookFromBook = (book) => {
    const wb = XLSX.utils.book_new();
    book.sheets.forEach(sh => {
        const ws = {};
        let maxR = 0; let maxC = 0;
        sh.rows.forEach((row, r) => (row || []).forEach((cell, c) => {
            if (!cell) return;
            const out = {};
            if (cell.f) { out.f = cell.f; if (cell.v !== undefined && cell.v !== null) { out.v = cell.v; out.t = typeof cell.v === 'number' ? 'n' : typeof cell.v === 'boolean' ? 'b' : 's'; } else out.t = 'n'; }
            else if (cell.v instanceof Date) { out.v = cell.v; out.t = 'd'; out.z = cell.z || 'yyyy-mm-dd'; }
            else if (typeof cell.v === 'number') { out.v = cell.v; out.t = 'n'; if (cell.z) out.z = cell.z; }
            else if (typeof cell.v === 'boolean') { out.v = cell.v; out.t = 'b'; }
            else { out.v = String(cell.v ?? ''); out.t = 's'; }
            ws[XLSX.utils.encode_cell({ r, c })] = out;
            maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
        }));
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
        if (sh.merges?.length) ws['!merges'] = sh.merges;
        if (sh.colWidths?.some(Boolean)) ws['!cols'] = sh.colWidths.map(w => (w ? { wpx: w } : {}));
        XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
    });
    // 수식은 엑셀에서 열 때 다시 계산
    wb.Workbook = { ...(wb.Workbook || {}), CalcPr: { fullCalcOnLoad: true } };
    return wb;
};

export const renderExcelEditor = (el, { showToast = () => {}, pending = null } = {}) => {
    let book = newBook();
    let si = 0;                // 지금 시트
    let sel = { r: 0, c: 0 };  // 선택 셀
    let limit = PAGE_ROWS;
    let dirty = false;
    let find = '';

    if (pending?.buffer) {
        // 구글 시트에서 받은 .xlsx
        try {
            book = bookFromWorkbook(XLSX.read(new Uint8Array(pending.buffer), { type: 'array', cellDates: true, cellFormula: true, cellNF: true }), `${String(pending.name || '구글 시트').replace(/\.xlsx$/i, '')}.xlsx`);
            dirty = true;
        } catch (e) { alert(`가져온 파일을 열지 못했습니다: ${e.message}`); }
    } else if (pending?.aoa) {
        book = { name: `${pending.name || '가져온 시트'}.xlsx`, sheets: [{ name: (pending.sheetName || 'Sheet1').slice(0, 31), rows: pending.aoa.map(r => r.map(v => (v === '' || v === null || v === undefined ? null : { v: typeof v === 'string' && isNumText(v) ? Number(v.replace(/,/g, '')) : v }))), cols: Math.max(0, ...pending.aoa.map(r => r.length)), merges: [], colWidths: [] }] };
        dirty = true;
    }

    const sheet = () => book.sheets[si];
    const getCell = (r, c) => sheet().rows[r]?.[c] || null;
    const setCell = (r, c, cell) => {
        const rows = sheet().rows;
        if (!cell) { if (rows[r]) delete rows[r][c]; }
        else { (rows[r] ||= [])[c] = cell; sheet().cols = Math.max(sheet().cols, c + 1); }
        dirty = true;
    };
    const usedRows = () => sheet().rows.length;
    const addr = (r, c) => `${colName(c)}${r + 1}`;

    const parseInput = (text, old) => {
        const s = String(text ?? '');
        if (s.trim() === '') return null;
        if (s.startsWith('=') && s.length > 1) return { f: s.slice(1) };
        if (isNumText(s)) return { v: Number(s.replace(/,/g, '')), z: old?.z };
        if (/^\d+(\.\d+)?%$/.test(s.trim())) return { v: Number(s.trim().slice(0, -1)) / 100, z: '0%' };
        return { v: s };
    };

    // ---------- 그리기 ----------
    const draw = () => {
        const sh = sheet();
        const nCols = Math.max(sh.cols + 3, 12);
        const nRowsAll = Math.max(usedRows() + 10, 40);
        const nRows = Math.min(nRowsAll, limit);
        const q = find.trim().toLowerCase();
        const hits = [];
        el.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" id="xe-root">
            <div class="flex flex-wrap items-center gap-1.5 p-2 border-b border-slate-200 bg-slate-50 text-xs font-bold">
                <button type="button" id="xe-new" class="xe-btn"><i data-lucide="file-plus" class="w-4 h-4"></i>새 파일</button>
                <label class="xe-btn cursor-pointer"><i data-lucide="folder-open" class="w-4 h-4"></i>열기<input type="file" id="xe-open" accept=".xlsx,.xlsm,.xls,.csv,.ods,.txt" class="hidden" /></label>
                <button type="button" id="xe-save" class="xe-btn !bg-emerald-600 !text-white !border-emerald-600 hover:!bg-emerald-700"><i data-lucide="save" class="w-4 h-4"></i>엑셀 저장</button>
                <button type="button" id="xe-csv" class="xe-btn"><i data-lucide="file-down" class="w-4 h-4"></i>CSV</button>
                <button type="button" id="xe-print" class="xe-btn"><i data-lucide="printer" class="w-4 h-4"></i>인쇄</button>
                <span class="w-px h-6 bg-slate-300 mx-1"></span>
                <button type="button" class="xe-btn xe-op" data-op="rowAbove" title="선택 셀 위에 행 삽입"><i data-lucide="between-horizontal-start" class="w-4 h-4"></i>행↑</button>
                <button type="button" class="xe-btn xe-op" data-op="rowBelow" title="선택 셀 아래에 행 삽입"><i data-lucide="between-horizontal-end" class="w-4 h-4"></i>행↓</button>
                <button type="button" class="xe-btn xe-op" data-op="rowDel" title="선택 행 삭제"><i data-lucide="trash-2" class="w-4 h-4 text-rose-600"></i>행</button>
                <button type="button" class="xe-btn xe-op" data-op="colLeft" title="선택 셀 왼쪽에 열 삽입"><i data-lucide="between-vertical-start" class="w-4 h-4"></i>열←</button>
                <button type="button" class="xe-btn xe-op" data-op="colRight" title="선택 셀 오른쪽에 열 삽입"><i data-lucide="between-vertical-end" class="w-4 h-4"></i>열→</button>
                <button type="button" class="xe-btn xe-op" data-op="colDel" title="선택 열 삭제"><i data-lucide="trash-2" class="w-4 h-4 text-rose-600"></i>열</button>
                <div class="relative ml-auto"><i data-lucide="search" class="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2"></i>
                    <input id="xe-find" type="search" value="${esc(find)}" placeholder="찾기 (Enter: 다음)" class="w-44 border border-slate-300 rounded-lg pl-7 pr-2 py-1 font-bold bg-white" /></div>
            </div>
            <div class="flex items-center gap-2 px-2 py-1.5 border-b border-slate-200 text-xs">
                <span class="font-black text-slate-500 truncate max-w-[220px]" title="${esc(book.name)}"><i data-lucide="sheet" class="w-3.5 h-3.5 inline text-emerald-600"></i> ${esc(book.name)}${dirty ? ' <span class="text-amber-600">●</span>' : ''}</span>
                <span id="xe-addr" class="px-2 py-1 rounded bg-slate-100 font-mono font-black min-w-[56px] text-center">${addr(sel.r, sel.c)}</span>
                <span class="font-black text-slate-400 italic">fx</span>
                <input id="xe-fx" type="text" value="${esc(rawOf(getCell(sel.r, sel.c)))}" class="flex-1 border border-slate-300 rounded-lg px-2 py-1 font-mono" placeholder="값 또는 =수식" />
            </div>
            <div id="xe-grid-wrap" class="overflow-auto max-h-[68vh] relative">
                <table id="xe-grid" class="border-collapse text-xs select-none" style="table-layout:fixed">
                    <thead class="sticky top-0 z-10"><tr><th class="xe-corner sticky left-0 z-20 bg-slate-200 border border-slate-300 w-12 min-w-[48px]"></th>
                        ${Array.from({ length: nCols }, (_, c) => `<th class="bg-slate-100 border border-slate-300 font-bold text-slate-600 px-1 ${c === sel.c ? '!bg-emerald-100 text-emerald-800' : ''}" style="width:${sh.colWidths?.[c] || 96}px;min-width:${sh.colWidths?.[c] || 96}px">${colName(c)}</th>`).join('')}</tr></thead>
                    <tbody>
                        ${Array.from({ length: nRows }, (_, r) => `<tr><th class="sticky left-0 z-[5] bg-slate-100 border border-slate-300 font-bold text-slate-500 text-center ${r === sel.r ? '!bg-emerald-100 text-emerald-800' : ''}">${r + 1}</th>
                            ${Array.from({ length: nCols }, (_, c) => {
                                const cell = getCell(r, c);
                                const txt = displayOf(cell);
                                const hit = q && txt.toLowerCase().includes(q);
                                if (hit) hits.push({ r, c });
                                const num = cell && typeof cell.v === 'number' && !cell.f;
                                return `<td contenteditable="true" spellcheck="false" data-r="${r}" data-c="${c}" class="xe-cell border border-slate-200 px-1.5 py-1 whitespace-nowrap overflow-hidden text-ellipsis outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-inset ${num ? 'text-right font-mono' : ''} ${cell?.f ? 'text-indigo-700' : ''} ${hit ? 'bg-yellow-100' : ''} ${r === sel.r && c === sel.c ? 'ring-2 ring-emerald-500 ring-inset' : ''}">${esc(txt)}</td>`;
                            }).join('')}</tr>`).join('')}
                    </tbody>
                </table>
                ${nRowsAll > nRows ? `<div class="p-3 text-center"><button type="button" id="xe-more" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold">행 ${PAGE_ROWS}개 더 보기 (${nRows.toLocaleString()} / ${nRowsAll.toLocaleString()})</button></div>` : ''}
            </div>
            <div class="flex items-center gap-1 px-2 py-1.5 border-t border-slate-200 bg-slate-50 text-xs overflow-x-auto">
                ${book.sheets.map((s, i) => `<button type="button" class="xe-sheet px-3 py-1 rounded-t-md border-b-2 whitespace-nowrap font-bold ${i === si ? 'bg-white border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:bg-white'}" data-i="${i}" title="두 번 눌러 이름 바꾸기">${esc(s.name)}</button>`).join('')}
                <button type="button" id="xe-sheet-add" class="px-2 py-1 rounded-md text-slate-500 hover:bg-white font-black" title="시트 추가">＋</button>
                ${book.sheets.length > 1 ? '<button type="button" id="xe-sheet-del" class="ml-1 px-2 py-1 rounded-md text-rose-600 hover:bg-rose-50 font-bold" title="지금 시트 삭제">시트 삭제</button>' : ''}
                <span class="ml-auto text-slate-400 whitespace-nowrap">${q ? `찾음 ${hits.length}개 · ` : ''}사용 범위 ${usedRows().toLocaleString()}행 × ${sheet().cols}열 · 파일을 여기로 끌어다 놓아도 열립니다</span>
            </div>
        </div>
        <style>#xe-root .xe-btn{display:inline-flex;align-items:center;gap:.3rem;padding:.35rem .6rem;border-radius:.6rem;border:1px solid #cbd5e1;background:#fff;color:#334155}#xe-root .xe-btn:hover{background:#f1f5f9}</style>`;
        createIcons({ icons });
        bind(hits);
    };

    // ---------- 셀 이동·확정 ----------
    const tdAt = (r, c) => el.querySelector(`.xe-cell[data-r="${r}"][data-c="${c}"]`);
    const commit = (td) => {
        const r = Number(td.dataset.r); const c = Number(td.dataset.c);
        const old = getCell(r, c);
        const text = td.textContent;
        if (text === rawOf(old) || (text === displayOf(old) && td.dataset.editing !== '1')) { td.textContent = displayOf(old); return; }
        const next = parseInput(text, old);
        setCell(r, c, next);
        td.textContent = displayOf(next);
        td.classList.toggle('text-right', !!next && typeof next.v === 'number' && !next.f);
        td.classList.toggle('font-mono', !!next && typeof next.v === 'number' && !next.f);
        td.classList.toggle('text-indigo-700', !!next?.f);
    };
    const select = (r, c, { focus = true } = {}) => {
        sel = { r: Math.max(0, r), c: Math.max(0, c) };
        if (sel.r >= limit - 1) { limit = sel.r + PAGE_ROWS; draw(); }
        let td = tdAt(sel.r, sel.c);
        if (!td) { draw(); td = tdAt(sel.r, sel.c); }
        el.querySelectorAll('.xe-cell.ring-2').forEach(x => x.classList.remove('ring-2', 'ring-emerald-500', 'ring-inset'));
        td?.classList.add('ring-2', 'ring-emerald-500', 'ring-inset');
        el.querySelector('#xe-addr').textContent = addr(sel.r, sel.c);
        el.querySelector('#xe-fx').value = rawOf(getCell(sel.r, sel.c));
        if (focus && td) { td.focus(); td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    };

    const structural = (op) => {
        const sh = sheet();
        const { r, c } = sel;
        const shiftMerges = (axis, at, delta) => {
            sh.merges = (sh.merges || []).filter(m => !(delta < 0 && m.s[axis] <= at && m.e[axis] >= at)).map(m => {
                const n = { s: { ...m.s }, e: { ...m.e } };
                if (n.s[axis] >= at) n.s[axis] += delta;
                if (n.e[axis] >= at) n.e[axis] += delta;
                return n;
            });
        };
        if (op === 'rowAbove' || op === 'rowBelow') { const at = op === 'rowAbove' ? r : r + 1; sh.rows.splice(at, 0, []); shiftMerges('r', at, 1); if (op === 'rowBelow') sel.r = at; }
        if (op === 'rowDel') { if (!confirm(`${r + 1}행을 삭제할까요?`)) return; sh.rows.splice(r, 1); shiftMerges('r', r, -1); }
        if (op === 'colLeft' || op === 'colRight') {
            const at = op === 'colLeft' ? c : c + 1;
            sh.rows.forEach(row => { if (row && row.length > at) row.splice(at, 0, undefined); });
            sh.cols += 1; sh.colWidths?.splice(at, 0, null); shiftMerges('c', at, 1);
            if (op === 'colRight') sel.c = at;
        }
        if (op === 'colDel') {
            if (!confirm(`${colName(c)}열을 삭제할까요?`)) return;
            sh.rows.forEach(row => { if (row && row.length > c) row.splice(c, 1); });
            sh.cols = Math.max(0, sh.cols - 1); sh.colWidths?.splice(c, 1); shiftMerges('c', c, -1);
        }
        dirty = true;
        draw();
        select(sel.r, sel.c);
    };

    // ---------- 파일 ----------
    const openFile = async (file) => {
        if (!file) return;
        if (dirty && !confirm('저장하지 않은 변경 내용이 있습니다. 다른 파일을 열까요?')) return;
        try {
            const buf = await file.arrayBuffer();
            const isCsv = /\.(csv|txt)$/i.test(file.name);
            let wb;
            if (isCsv) {
                // 한글 CSV: UTF-8이 아니면 EUC-KR(CP949)로 읽는다
                let text = new TextDecoder('utf-8').decode(buf);
                if (text.includes('�')) text = new TextDecoder('euc-kr').decode(buf);
                wb = XLSX.read(text, { type: 'string', cellDates: true, raw: false });
            } else {
                wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true, cellFormula: true, cellNF: true });
            }
            book = bookFromWorkbook(wb, file.name.replace(/\.(csv|txt|xls|ods)$/i, '.xlsx'));
            si = 0; sel = { r: 0, c: 0 }; limit = PAGE_ROWS; dirty = false; find = '';
            draw();
            showToast(`📗 ${file.name} (시트 ${book.sheets.length}개)를 열었습니다.`);
        } catch (e) { alert(`파일을 열지 못했습니다: ${e.message}`); }
    };
    const saveXlsx = () => {
        const name = (prompt('저장할 파일 이름', book.name) || '').trim();
        if (!name) return;
        book.name = /\.xlsx$/i.test(name) ? name : `${name.replace(/\.[^.]+$/, '')}.xlsx`;
        XLSX.writeFile(workbookFromBook(book), book.name, { compression: true });
        dirty = false;
        draw();
        showToast(`💾 ${book.name} 저장(다운로드)했습니다.`);
    };
    const saveCsv = () => {
        const wb = workbookFromBook({ ...book, sheets: [sheet()] });
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
        const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }); // 엑셀에서 한글이 깨지지 않게 BOM
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${book.name.replace(/\.[^.]+$/, '')}_${sheet().name}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    const printSheet = () => {
        const sh = sheet();
        const w = window.open('', '_blank');
        if (!w) { alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
        const nCols = sh.cols;
        const body = sh.rows.map((row) => `<tr>${Array.from({ length: nCols }, (_, c) => { const cell = row?.[c]; return `<td class="${cell && typeof cell.v === 'number' ? 'n' : ''}">${esc(displayOf(cell))}</td>`; }).join('')}</tr>`).join('');
        w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(book.name)} - ${esc(sh.name)}</title><style>
            @page{size:A4 landscape;margin:8mm}body{font-family:'Malgun Gothic',sans-serif;font-size:9pt}h1{font-size:12pt;margin:0 0 6px}
            table{border-collapse:collapse}td{border:0.5pt solid #777;padding:2px 4px;white-space:nowrap}td.n{text-align:right}tr{page-break-inside:avoid}
        </style></head><body><h1>${esc(book.name)} · ${esc(sh.name)}</h1><table>${body}</table><script>onload=()=>setTimeout(()=>print(),200)<\/script></body></html>`);
        w.document.close();
    };

    // ---------- 이벤트 ----------
    const bind = (hits) => {
        const $ = (s) => el.querySelector(s);
        $('#xe-new').addEventListener('click', () => {
            if (dirty && !confirm('저장하지 않은 변경 내용이 있습니다. 새 파일을 만들까요?')) return;
            book = newBook(); si = 0; sel = { r: 0, c: 0 }; dirty = false; draw();
        });
        $('#xe-open').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; openFile(f); });
        $('#xe-save').addEventListener('click', saveXlsx);
        $('#xe-csv').addEventListener('click', saveCsv);
        $('#xe-print').addEventListener('click', printSheet);
        el.querySelectorAll('.xe-op').forEach(b => b.addEventListener('click', () => structural(b.dataset.op)));
        $('#xe-more')?.addEventListener('click', () => { limit += PAGE_ROWS; draw(); });
        let hitIdx = -1;
        $('#xe-find').addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            e.preventDefault();
            if (find !== e.target.value) { find = e.target.value; draw(); const f = el.querySelector('#xe-find'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); return; }
            if (!hits.length) return;
            hitIdx = (hitIdx + 1) % hits.length;
            select(hits[hitIdx].r, hits[hitIdx].c, { focus: false });
            tdAt(hits[hitIdx].r, hits[hitIdx].c)?.scrollIntoView({ block: 'center', inline: 'nearest' });
        });
        $('#xe-find').addEventListener('search', (e) => { if (!e.target.value && find) { find = ''; draw(); } });
        // 수식 입력줄
        const fx = $('#xe-fx');
        fx.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            e.preventDefault();
            const next = parseInput(fx.value, getCell(sel.r, sel.c));
            setCell(sel.r, sel.c, next);
            const td = tdAt(sel.r, sel.c);
            if (td) td.textContent = displayOf(next);
            select(sel.r + 1, sel.c);
        });
        // 셀
        el.querySelectorAll('.xe-cell').forEach(td => {
            td.addEventListener('focus', () => {
                const r = Number(td.dataset.r); const c = Number(td.dataset.c);
                if (sel.r !== r || sel.c !== c) select(r, c, { focus: false });
                const cell = getCell(r, c);
                // 편집할 때는 원래 값(수식은 =...)을 보여 준다
                if (cell?.f || (cell && displayOf(cell) !== rawOf(cell))) td.textContent = rawOf(cell);
                td.dataset.editing = '1';
            });
            td.addEventListener('input', () => { el.querySelector('#xe-fx').value = td.textContent; });
            td.addEventListener('blur', () => { commit(td); td.dataset.editing = ''; });
            td.addEventListener('keydown', (e) => {
                if (e.isComposing) return;
                const r = Number(td.dataset.r); const c = Number(td.dataset.c);
                if (e.key === 'Enter') { e.preventDefault(); td.blur(); select(e.shiftKey ? r - 1 : r + 1, c); }
                else if (e.key === 'Tab') { e.preventDefault(); td.blur(); select(r, e.shiftKey ? c - 1 : c + 1); }
                else if (e.key === 'Escape') { td.textContent = rawOf(getCell(r, c)); td.blur(); }
                else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !td.textContent.includes('\n')) { e.preventDefault(); td.blur(); select(e.key === 'ArrowDown' ? r + 1 : r - 1, c); }
                else if (e.key === 'Delete' && window.getSelection()?.toString() === td.textContent) { e.preventDefault(); td.textContent = ''; }
            });
            // 붙여넣기: 엑셀에서 복사한 여러 칸(탭·줄바꿈)을 그대로 펼친다
            td.addEventListener('paste', (e) => {
                const text = e.clipboardData?.getData('text/plain') ?? '';
                if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) {
                    e.preventDefault();
                    document.execCommand('insertText', false, text.replace(/\r?\n$/, ''));
                    return;
                }
                e.preventDefault();
                const r0 = Number(td.dataset.r); const c0 = Number(td.dataset.c);
                const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
                lines.forEach((line, i) => line.split('\t').forEach((v, j) => setCell(r0 + i, c0 + j, parseInput(v, getCell(r0 + i, c0 + j)))));
                draw();
                select(r0, c0);
                showToast(`📋 ${lines.length}행을 붙여넣었습니다.`);
            });
        });
        // 시트 탭
        el.querySelectorAll('.xe-sheet').forEach(b => {
            b.addEventListener('click', () => { const i = Number(b.dataset.i); if (i !== si) { si = i; sel = { r: 0, c: 0 }; limit = PAGE_ROWS; draw(); } });
            b.addEventListener('dblclick', () => {
                const i = Number(b.dataset.i);
                const name = (prompt('시트 이름', book.sheets[i].name) || '').trim().slice(0, 31);
                if (!name || name === book.sheets[i].name) return;
                if (/[\\/?*[\]:]/.test(name)) { alert('시트 이름에 \\ / ? * [ ] : 는 쓸 수 없습니다.'); return; }
                if (book.sheets.some((s, k) => k !== i && s.name === name)) { alert('같은 이름의 시트가 있습니다.'); return; }
                book.sheets[i].name = name; dirty = true; draw();
            });
        });
        $('#xe-sheet-add').addEventListener('click', () => {
            let n = book.sheets.length + 1;
            while (book.sheets.some(s => s.name === `Sheet${n}`)) n++;
            book.sheets.push({ name: `Sheet${n}`, rows: [], cols: 0, merges: [], colWidths: [] });
            si = book.sheets.length - 1; sel = { r: 0, c: 0 }; dirty = true; draw();
        });
        $('#xe-sheet-del')?.addEventListener('click', () => {
            if (!confirm(`'${sheet().name}' 시트를 삭제할까요?`)) return;
            book.sheets.splice(si, 1); si = Math.max(0, si - 1); dirty = true; draw();
        });
        // 끌어놓기로 열기
        const root = $('#xe-root');
        root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); root.classList.add('ring-4', 'ring-emerald-300'); } });
        root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('ring-4', 'ring-emerald-300'); });
        root.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); root.classList.remove('ring-4', 'ring-emerald-300'); openFile(e.dataTransfer.files[0]); });
    };

    draw();
    if (pending?.aoa || pending?.buffer) showToast(`📗 '${pending.name || '구글 시트'}'를 가져왔습니다 (시트 ${book.sheets.length}개). [엑셀 저장]으로 파일로 받을 수 있습니다.`);
    return { isDirty: () => dirty };
};
