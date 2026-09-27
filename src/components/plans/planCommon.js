import { state } from '../../services/db.js';
import { searchMasterItems } from '../../services/searchUtils.js';
import { esc } from '../../services/html.js';

// 생산관리 화면 공통: 품목 검색 선택, 줄 편집 표, A4 인쇄
export const fmtQty = (n) => (n === '' || n === null || n === undefined ? '' : (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 }));
export const btn = (cls = 'bg-slate-800 hover:bg-slate-900 text-white') => `px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition ${cls}`;

// ---------- 품목 검색 선택 (입력칸 아래 제안 목록) ----------
let pickerEl = null;
const closePicker = () => { pickerEl?.remove(); pickerEl = null; };
document.addEventListener('mousedown', (e) => { if (pickerEl && !pickerEl.contains(e.target) && !e.target.classList?.contains('pl-item-input')) closePicker(); });

export const attachItemPicker = (input, onPick, filter = null) => {
    const show = () => {
        const q = input.value.trim();
        closePicker();
        if (!q) return;
        let list = searchMasterItems(q, 30);
        if (filter) list = list.filter(filter);
        list = list.slice(0, 12);
        const r = input.getBoundingClientRect();
        pickerEl = document.createElement('div');
        pickerEl.className = 'fixed z-[80] bg-white border border-slate-300 rounded-xl shadow-2xl max-h-72 overflow-y-auto text-xs';
        pickerEl.style.left = `${r.left}px`;
        pickerEl.style.top = `${r.bottom + 2}px`;
        pickerEl.style.width = `${Math.max(r.width, 320)}px`;
        pickerEl.innerHTML = list.length === 0 ? '<div class="p-3 text-slate-400 text-center">일치하는 품목이 없습니다.</div>' : list.map((m, i) => `
            <button type="button" data-i="${i}" class="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 flex items-center justify-between gap-2">
                <span class="min-w-0"><span class="font-mono font-bold text-blue-600">${esc(m.code)}</span> <span class="font-bold text-slate-800">${esc(m.name)}</span>
                <span class="block text-[10px] text-slate-400 truncate">${esc(m.category || '')} · ${esc(m.spec || '-')} · ${esc(m.unit || 'EA')}</span></span>
            </button>`).join('');
        document.body.appendChild(pickerEl);
        pickerEl.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const m = list[Number(b.dataset.i)];
            closePicker();
            onPick(m);
        }));
    };
    input.classList.add('pl-item-input');
    input.addEventListener('input', show);
    input.addEventListener('focus', () => { if (input.value.trim()) show(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });
};

// ---------- 줄 편집 표 ----------
// columns: [{ key, label, type: 'text'|'number'|'date'|'select'|'item'|'badge'|'static', options: [[value,label]], w: 'w-24', align, get(line) }]
// 입력은 바로 line 객체에 반영하고 onChange()만 부른다 (다시 그리지 않아 커서 유지). 품목 선택·추가·삭제 때만 다시 그림.
// 칸 최소 너비(px): 좁은 화면에서도 입력칸이 찌그러지지 않고 표만 가로로 스크롤된다
const MIN_W = { select: 84, number: 84, date: 136, text: 96, item: 210, badge: 84, static: 70 };

export const renderLineTable = (host, { lines, columns, readOnly = false, onChange = () => {}, onRerender = null, emptyText = '줄이 없습니다.', rowClass = () => '' }) => {
    const rerender = () => (onRerender ? onRerender() : renderLineTable(host, { lines, columns, readOnly, onChange, onRerender, emptyText, rowClass }));
    const minW = (c) => `min-width:${c.minW ?? MIN_W[c.type] ?? 90}px`;
    const cell = (l, c, i) => {
        const v = c.get ? c.get(l) : l[c.key];
        const base = 'w-full bg-white border border-slate-200 rounded-md px-1.5 py-1 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none';
        if (readOnly || c.type === 'static') return `<span class="${c.align === 'right' ? 'block text-right' : ''}">${c.render ? c.render(l) : esc(c.type === 'number' ? fmtQty(v) : (c.options ? (c.options.find(o => o[0] === v)?.[1] ?? v) : v) ?? '')}</span>`;
        if (c.type === 'badge') return c.render(l);
        if (c.type === 'select') return `<select data-i="${i}" data-k="${c.key}" class="pl-in ${base} font-bold">${c.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v ?? '') ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
        if (c.type === 'item') return `<div class="min-w-[180px]"><input type="text" data-i="${i}" data-k="__item" value="${esc(l.name ? `${l.name}` : '')}" placeholder="품목 검색 (코드·이름)" class="pl-item ${base} font-bold" autocomplete="off" />
            ${l.code ? `<div class="text-[10px] font-mono text-blue-600 mt-0.5">${esc(l.code)}${l.spec ? ` · ${esc(l.spec)}` : ''}</div>` : ''}</div>`;
        return `<input type="${c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}" ${c.type === 'number' ? 'step="any" min="0"' : ''} data-i="${i}" data-k="${c.key}" value="${esc(v ?? '')}" class="pl-in ${base} ${c.type === 'number' ? 'text-right font-black' : ''}" />`;
    };
    host.innerHTML = `
        <div class="overflow-x-auto border border-slate-200 rounded-xl">
            <table class="w-full text-xs">
                <thead class="bg-slate-100 text-slate-600"><tr>
                    <th class="p-2 w-8">No</th>
                    ${columns.map(c => `<th class="p-2 ${c.align === 'right' ? 'text-right' : 'text-left'} whitespace-nowrap" style="${readOnly ? '' : minW(c)}">${esc(c.label)}</th>`).join('')}
                    ${readOnly ? '' : '<th class="p-2 w-10"></th>'}
                </tr></thead>
                <tbody class="divide-y divide-slate-100">
                    ${lines.length === 0 ? `<tr><td colspan="${columns.length + 2}" class="p-6 text-center text-slate-400">${esc(emptyText)}</td></tr>` : lines.map((l, i) => `
                    <tr class="${rowClass(l)}">
                        <td class="p-1.5 text-center text-slate-400">${i + 1}</td>
                        ${columns.map(c => `<td class="p-1.5 align-top">${cell(l, c, i)}</td>`).join('')}
                        ${readOnly ? '' : `<td class="p-1.5 text-center"><button type="button" class="pl-del text-rose-500 hover:text-rose-700 font-black px-1.5" data-i="${i}" title="줄 삭제">&times;</button></td>`}
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
    if (readOnly) return;
    host.querySelectorAll('.pl-in').forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
        const l = lines[Number(inp.dataset.i)];
        const col = columns.find(c => c.key === inp.dataset.k);
        l[inp.dataset.k] = col?.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
        onChange(l, inp.dataset.k);
        if (col?.rerenderOnChange) rerender();
    }));
    host.querySelectorAll('.pl-item').forEach(inp => {
        const itemCol = columns.find(c => c.type === 'item');
        attachItemPicker(inp, (m) => {
            const l = lines[Number(inp.dataset.i)];
            Object.assign(l, { code: m.code, name: m.name, spec: m.spec && m.spec !== '-' ? m.spec : '', unit: m.unit || l.unit || 'EA' });
            itemCol?.onPick?.(l, m);
            onChange(l, 'code');
            rerender();
        }, itemCol?.filter);
        inp.addEventListener('change', () => { // 목록에서 고르지 않고 글자만 바꾼 경우: 이름만 (코드 없음)
            const l = lines[Number(inp.dataset.i)];
            if (inp.value.trim() !== (l.name || '')) { l.name = inp.value.trim(); l.code = ''; onChange(l, 'name'); }
        });
    });
    host.querySelectorAll('.pl-del').forEach(b => b.addEventListener('click', () => {
        lines.splice(Number(b.dataset.i), 1);
        onChange(null, 'delete');
        rerender();
    }));
};

// ---------- A4 인쇄 ----------
export const approvalBoxHtml = (labels = ['작성', '검토', '승인']) => `
    <table class="appr"><tr><th rowspan="2" class="appr-side">결<br>재</th>${labels.map(l => `<th>${esc(l)}</th>`).join('')}</tr>
    <tr>${labels.map(() => '<td></td>').join('')}</tr></table>`;

export const printA4 = ({ title, subtitle = '', meta = [], bodyHtml, landscape = false, approvals = ['작성', '검토', '승인'] }) => {
    const w = window.open('', '_blank');
    if (!w) { alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
    const base = new URL(import.meta.env.BASE_URL, window.location.href).href;
    w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><base href="${esc(base)}"><title>${esc(title)}</title>
    <style>
        @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif; color: #111; font-size: 9pt; }
        .page { width: ${landscape ? '277mm' : '190mm'}; margin: 0 auto; }
        .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 3mm; margin-bottom: 3mm; }
        .head h1 { margin: 0; font-size: 18pt; letter-spacing: 2px; }
        .head .sub { font-size: 9pt; color: #444; margin-top: 1mm; }
        .logo { height: 9mm; margin-right: 3mm; vertical-align: middle; }
        .meta { display: flex; flex-wrap: wrap; gap: 1mm 6mm; font-size: 8.5pt; margin-bottom: 3mm; }
        .meta b { color: #333; }
        table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
        table.grid th, table.grid td { border: 0.3mm solid #444; padding: 1mm 1.2mm; font-size: 8pt; line-height: 1.25; word-break: break-all; vertical-align: middle; }
        table.grid th { background: #eef1f5; font-weight: 700; text-align: center; }
        table.grid td.r { text-align: right; } table.grid td.c { text-align: center; }
        table.grid tr.sum td { background: #f6f7f9; font-weight: 700; }
        table.grid tr.day td { background: #eef3ff; font-weight: 700; }
        .short { color: #c00; font-weight: 700; }
        table.appr { border-collapse: collapse; } table.appr th, table.appr td { border: 0.3mm solid #444; text-align: center; font-size: 8pt; }
        table.appr th { background: #eef1f5; width: 18mm; padding: 0.8mm; } table.appr td { height: 13mm; }
        table.appr .appr-side { width: 6mm; }
        h2 { font-size: 10.5pt; margin: 4mm 0 1.5mm; }
        .notes { border: 0.3mm solid #444; min-height: 14mm; padding: 1.5mm; white-space: pre-wrap; font-size: 8.5pt; }
        .foot { margin-top: 3mm; font-size: 7.5pt; color: #666; display: flex; justify-content: space-between; }
        @media screen { body { background: #cbd5e1; padding: 8mm 0; } .page { background: #fff; padding: 10mm; box-shadow: 0 1px 6px rgba(0,0,0,.25); width: ${landscape ? '297mm' : '210mm'}; } }
    </style></head><body><div class="page">
        <div class="head">
            <div><h1><img class="logo" src="./logo.png" alt="" onerror="this.remove()" />${esc(title)}</h1><div class="sub">대림오일 · ${esc(subtitle)}</div></div>
            ${approvals?.length ? approvalBoxHtml(approvals) : ''}
        </div>
        ${meta.length ? `<div class="meta">${meta.map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join('')}</div>` : ''}
        ${bodyHtml}
        <div class="foot"><span>대림오일 스마트 WMS</span><span>출력: ${esc(new Date().toLocaleString('ko-KR'))} · ${esc(state.currentGlobalWorker || '')}</span></div>
    </div><script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };<\/script></body></html>`);
    w.document.close();
};

// 인쇄용 표 (columns: [{ label, w(mm), get(l) → 글자, cls: 'r'|'c' }])
export const printTableHtml = (columns, rows, { emptyText = '내용 없음', minRows = 0, rowAttr = () => '' } = {}) => `
    <table class="grid"><colgroup><col style="width:8mm">${columns.map(c => `<col style="${c.w ? `width:${c.w}mm` : ''}">`).join('')}</colgroup>
        <thead><tr><th>No</th>${columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${rows.length === 0 && !minRows ? `<tr><td colspan="${columns.length + 1}" class="c">${esc(emptyText)}</td></tr>` : ''}
        ${rows.map((l, i) => `<tr ${rowAttr(l)}><td class="c">${i + 1}</td>${columns.map(c => `<td class="${c.cls || ''}">${c.html ? c.html(l) : esc(c.get(l) ?? '')}</td>`).join('')}</tr>`).join('')}
        ${Array.from({ length: Math.max(0, minRows - rows.length) }, () => `<tr><td>&nbsp;</td>${columns.map(() => '<td></td>').join('')}</tr>`).join('')}
        </tbody></table>`;

export const siteOptions = [['본사', '본사'], ['김포', '김포']];
export const masterUnit = (code) => state.master.find(m => m.code === code)?.unit || 'EA';
