import { state } from '../services/db.js';
import { searchMasterItems } from '../services/searchUtils.js';
import { listLabelTemplates, saveLabelTemplate, deleteLabelTemplate } from '../services/labelTemplates.js';
import {
    ITEM_FIELDS, INPUT_FIELDS, itemFieldData, defaultInputData, fieldsInTemplate, FONTS, BARCODE_FORMATS,
    labelElementsHtml, fitLabelTexts, cellPos, cellsPerSheet, labelShapeCss, sheetsHtml, openLabelPrintWindow, writeLabelPrintWindow
} from '../services/labelRender.js';
import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';
import formtecLabels from '../data/formtecLabels.json';

/**
 * 라벨 만들기 (폼텍 Design Pro 9 방식)
 * ① 라벨 용지 선택: 폼텍 용지 규격(src/data/formtecLabels.json, scripts/gen_formtec_labels.cjs) 또는 사용자 정의
 * ② 양식 디자인: 글자·필드·바코드·QR·이미지·선·도형을 mm 단위로 배치 (끌어서 이동·크기 조절)
 * ③ 저장: wms_label_templates (services/labelTemplates.js)
 * ④ 인쇄: 같은 내용 반복 또는 품목 선택, 시작 칸·위치 보정·테두리 표시 → A4(용지 크기) 인쇄 창
 */
const OFFSET_KEY = 'daelim_label_print_offset';
const uid = () => `e${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;
const r1 = (v) => Math.round(v * 10) / 10;
const clone = (o) => JSON.parse(JSON.stringify(o));
const PX_PER_MM = 96 / 25.4;

const ELEMENT_TYPES = {
    text: { label: '글자', icon: 'type' },
    barcode: { label: '바코드', icon: 'barcode' },
    qr: { label: 'QR코드', icon: 'qr-code' },
    image: { label: '이미지', icon: 'image' },
    line: { label: '선', icon: 'minus' },
    rect: { label: '사각형', icon: 'square' },
    ellipse: { label: '원', icon: 'circle' }
};

const papersCache = formtecLabels;
const loadPapers = async () => papersCache;

// 이미지 파일 → dataURL (큰 이미지는 1000px 이하로 줄여 양식 저장 용량을 아낀다)
const readImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('이미지 형식을 읽지 못했습니다.'));
        img.onload = () => {
            const max = 1000;
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            if (scale === 1 && reader.result.length < 400000) { resolve({ src: reader.result, ratio: img.height / img.width }); return; }
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * scale);
            c.height = Math.round(img.height * scale);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            const png = /png|gif|svg/i.test(file.type);
            resolve({ src: c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9), ratio: img.height / img.width });
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
});

const paperText = (p) => `${p.code ? `폼텍 ${p.code}` : '사용자 정의'} · ${p.w}×${p.h}mm · ${p.across}×${p.down}=${p.across * p.down}칸 (${p.sheet || `${p.sheetW}×${p.sheetH}mm`})`;

// 용지 배열 미리보기 SVG
const paperSvg = (p, { highlight = -1, maxW = 220 } = {}) => {
    const cells = [];
    for (let i = 0; i < cellsPerSheet(p); i++) {
        const { x, y } = cellPos(p, i);
        const fill = i === highlight ? '#f59e0b' : i < highlight ? '#e2e8f0' : '#dbeafe';
        cells.push(p.shape === 'circle'
            ? `<ellipse cx="${x + p.w / 2}" cy="${y + p.h / 2}" rx="${p.w / 2}" ry="${p.h / 2}" fill="${fill}" stroke="#3b82f6" stroke-width="0.4" data-cell="${i}"/>`
            : `<rect x="${x}" y="${y}" width="${p.w}" height="${p.h}" rx="${p.radius || 0}" fill="${fill}" stroke="#3b82f6" stroke-width="0.4" data-cell="${i}"/>`);
    }
    return `<svg viewBox="0 0 ${p.sheetW} ${p.sheetH}" style="width:${maxW}px;max-width:100%;height:auto" class="bg-white shadow border border-slate-300"><rect width="${p.sheetW}" height="${p.sheetH}" fill="#fff"/>${cells.join('')}</svg>`;
};

export const renderLabelDesigner = async (container, { showToast = () => {} } = {}) => {
    let mode = 'list';
    let templates = [];
    let tplQuery = '';
    let tpl = null;          // 편집 중인 양식
    let dirty = false;
    let selId = null;
    let zoom = 1;
    let snap = true;
    let showGrid = true;
    let preview = false;     // 편집 화면에서 필드를 예시 값으로 보기
    let history = [];
    let future = [];
    let paperReturn = 'list';
    const paperFilter = { sheet: 'A4', type: '', q: '' };
    let pickedPaper = null;
    const printSt = { tplId: '', mode: 'repeat', count: 1, start: 0, inputs: {}, rows: [], outline: false };
    try { Object.assign(printSt, { offset: JSON.parse(localStorage.getItem(OFFSET_KEY) || '{"x":0,"y":0}') }); } catch { printSt.offset = { x: 0, y: 0 }; }

    const $ = (s) => container.querySelector(s);
    const icon = () => createIcons({ icons });

    const reload = async () => {
        try { templates = await listLabelTemplates(); } catch (e) { templates = []; showToast(`⚠️ ${e.message}`); }
    };

    const header = (sub) => `
        <div class="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-400/20 text-indigo-200 border border-indigo-300/40">폼텍 라벨 용지 ${papersCache ? papersCache.length : ''}종 · Design Pro 9 방식</span>
                    <h2 class="text-xl font-black mt-2 flex items-center gap-2"><i data-lucide="pen-tool" class="w-5 h-5"></i><span>라벨 만들기</span>${sub ? `<span class="text-indigo-300 text-base">· ${esc(sub)}</span>` : ''}</h2>
                    <p class="text-xs text-slate-300 mt-1">라벨 용지를 고르고 양식을 디자인해 저장한 뒤, 품목 정보를 넣어 인쇄합니다. 글자에 <b>{품목명}</b>처럼 필드를 넣으면 인쇄할 때 값이 채워집니다.</p>
                </div>
            </div>
        </div>`;

    // ==========================================
    // ① 저장된 양식 목록
    // ==========================================
    const renderList = async () => {
        mode = 'list';
        const list = templates.filter(t => !tplQuery || `${t.name} ${t.category} ${t.paper?.code || ''}`.toLowerCase().includes(tplQuery.toLowerCase()));
        container.innerHTML = `
        <div class="space-y-5">
            ${header('')}
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 text-xs">
                <div class="flex flex-wrap items-center gap-2">
                    <button type="button" id="ld-new" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black flex items-center gap-1"><i data-lucide="plus" class="w-4 h-4"></i>새 라벨 만들기</button>
                    <div class="relative flex-1 min-w-[200px]">
                        <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"></i>
                        <input type="search" id="ld-q" value="${esc(tplQuery)}" placeholder="양식 이름·분류·용지 코드 검색" class="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-2 py-1.5 font-bold" />
                    </div>
                    <span class="text-slate-500 font-bold">${list.length} / ${templates.length}개 양식</span>
                </div>
                ${templates.length === 0 ? `<div class="p-10 text-center text-slate-400 font-bold">저장된 라벨 양식이 없습니다. [새 라벨 만들기]로 시작하세요.</div>` : ''}
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    ${list.map(t => `
                    <div class="border border-slate-200 rounded-2xl p-3 flex flex-col gap-2 hover:shadow-md transition bg-slate-50/50">
                        <div class="ld-thumb h-36 flex items-center justify-center bg-slate-200/60 rounded-xl overflow-hidden" data-id="${esc(t.id)}"></div>
                        <div>
                            <div class="font-black text-slate-900 truncate">${esc(t.name)}</div>
                            <div class="text-[10px] text-slate-500 truncate">${t.category ? `<span class="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold mr-1">${esc(t.category)}</span>` : ''}${esc(paperText(t.paper))}</div>
                        </div>
                        <div class="flex flex-wrap gap-1">
                            <button type="button" class="ld-print flex-1 px-2 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black flex items-center justify-center gap-1" data-id="${esc(t.id)}"><i data-lucide="printer" class="w-3.5 h-3.5"></i>인쇄</button>
                            <button type="button" class="ld-edit px-2 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg font-bold" data-id="${esc(t.id)}">편집</button>
                            <button type="button" class="ld-copy px-2 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg font-bold" data-id="${esc(t.id)}">복사</button>
                            <button type="button" class="ld-del px-2 py-1.5 bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 rounded-lg font-bold" data-id="${esc(t.id)}">삭제</button>
                        </div>
                    </div>`).join('')}
                </div>
            </div>
        </div>`;
        icon();
        const byId = (id) => templates.find(t => t.id === id);
        $('#ld-new').addEventListener('click', () => { paperReturn = 'list'; pickedPaper = null; renderPaper(); });
        $('#ld-q').addEventListener('input', (e) => { tplQuery = e.target.value; renderList().then(() => { const q = $('#ld-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); });
        container.querySelectorAll('.ld-edit').forEach(b => b.addEventListener('click', () => openEditor(clone(byId(b.dataset.id)))));
        container.querySelectorAll('.ld-print').forEach(b => b.addEventListener('click', () => openPrint(b.dataset.id)));
        container.querySelectorAll('.ld-copy').forEach(b => b.addEventListener('click', () => {
            const src = clone(byId(b.dataset.id));
            openEditor({ ...src, id: null, name: `${src.name} (복사)` }, true);
        }));
        container.querySelectorAll('.ld-del').forEach(b => b.addEventListener('click', async () => {
            const t = byId(b.dataset.id);
            if (!confirm(`'${t.name}' 양식을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
            try { await deleteLabelTemplate(t.id); showToast('🗑️ 라벨 양식을 삭제했습니다.'); await reload(); renderList(); } catch (e) { alert(e.message); }
        }));
        // 미리보기 썸네일 (라벨 한 칸)
        for (const box of container.querySelectorAll('.ld-thumb')) {
            const t = byId(box.dataset.id);
            if (!t) continue;
            const p = t.paper;
            const scale = Math.min(200 / (p.w * PX_PER_MM), 130 / (p.h * PX_PER_MM));
            box.innerHTML = `<div style="width:${p.w * PX_PER_MM * scale}px;height:${p.h * PX_PER_MM * scale}px;overflow:hidden">
                <div class="ld-thumb-inner bg-white shadow" style="position:relative;width:${p.w}mm;height:${p.h}mm;overflow:hidden;transform:scale(${scale});transform-origin:0 0;${labelShapeCss(p)}">${await labelElementsHtml(t, previewData())}</div></div>`;
            fitLabelTexts(box);
        }
    };

    // ==========================================
    // ② 라벨 용지 선택 (폼텍 규격 / 사용자 정의)
    // ==========================================
    const renderPaper = async () => {
        mode = 'paper';
        const papers = await loadPapers();
        const sheets = [...new Set(papers.map(p => p.sheet))];
        const types = [...new Set(papers.filter(p => !paperFilter.sheet || p.sheet === paperFilter.sheet).flatMap(p => p.types))].sort((a, b) => a.localeCompare(b, 'ko'));
        if (paperFilter.type && !types.includes(paperFilter.type)) paperFilter.type = '';
        const q = paperFilter.q.trim().toLowerCase();
        const list = papers.filter(p => (!paperFilter.sheet || p.sheet === paperFilter.sheet)
            && (!paperFilter.type || p.types.includes(paperFilter.type))
            && (!q || `${p.code} ${p.types.join(' ')} ${p.desc} ${p.w}x${p.h}`.toLowerCase().includes(q)));
        const cur = pickedPaper || (tpl && paperReturn === 'edit' ? tpl.paper : null);
        const custom = cur && !cur.code ? cur : { sheetW: 210, sheetH: 297, across: 2, down: 5, w: 99, h: 55, left: 5, top: 11, gapX: 2, gapY: 0, shape: 'rect', radius: 0 };
        container.innerHTML = `
        <div class="space-y-5">
            ${header(paperReturn === 'edit' ? '용지 변경' : '① 라벨 용지 선택')}
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
                <div class="lg:col-span-2 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                    <div class="flex flex-wrap items-center gap-2">
                        <select id="lp-sheet" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                            <option value="">모든 용지 크기</option>
                            ${sheets.map(s => `<option value="${esc(s)}" ${s === paperFilter.sheet ? 'selected' : ''}>${esc(s)} (${papers.filter(p => p.sheet === s).length})</option>`).join('')}
                        </select>
                        <select id="lp-type" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                            <option value="">모든 라벨 종류</option>
                            ${types.map(t => `<option value="${esc(t)}" ${t === paperFilter.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}
                        </select>
                        <div class="relative flex-1 min-w-[160px]">
                            <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"></i>
                            <input type="search" id="lp-q" value="${esc(paperFilter.q)}" placeholder="제품 코드 (예: 3102, 3120)" class="w-full border border-slate-300 rounded-lg pl-8 pr-2 py-1.5 font-bold" />
                        </div>
                        <span class="text-slate-500 font-bold">${list.length}종</span>
                    </div>
                    <div class="overflow-auto border border-slate-200 rounded-xl max-h-[60vh]">
                        <table class="w-full">
                            <thead class="bg-slate-50 text-slate-600 font-bold sticky top-0"><tr>
                                <th class="p-2 text-left">제품 코드</th><th class="p-2 text-left">라벨 종류</th><th class="p-2 text-right">라벨 크기 (mm)</th><th class="p-2 text-center">배열</th><th class="p-2 text-center">모양</th>
                            </tr></thead>
                            <tbody class="divide-y divide-slate-100">
                                ${list.map((p, i) => `<tr class="lp-row cursor-pointer hover:bg-indigo-50 ${cur && cur.code === p.code && cur.w === p.w && cur.h === p.h ? 'bg-indigo-100' : ''}" data-i="${i}">
                                    <td class="p-2 font-mono font-black text-indigo-800">${esc(p.code)}</td>
                                    <td class="p-2">${esc(p.types.join(', '))}</td>
                                    <td class="p-2 text-right font-mono">${p.w} × ${p.h}</td>
                                    <td class="p-2 text-center font-mono">${p.across}×${p.down} = ${p.across * p.down}칸</td>
                                    <td class="p-2 text-center">${p.shape === 'circle' ? '원형' : '사각'}</td>
                                </tr>`).join('') || '<tr><td colspan="5" class="p-6 text-center text-slate-400 font-bold">조건에 맞는 용지가 없습니다.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                    <details class="border border-slate-200 rounded-xl p-3" ${cur && !cur.code ? 'open' : ''}>
                        <summary class="font-black text-slate-700 cursor-pointer">사용자 정의 용지 (목록에 없는 라벨)</summary>
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                            ${[['sheetW', '용지 가로'], ['sheetH', '용지 세로'], ['across', '가로 칸 수'], ['down', '세로 줄 수'], ['w', '라벨 가로'], ['h', '라벨 세로'], ['left', '왼쪽 여백'], ['top', '위쪽 여백'], ['gapX', '가로 간격'], ['gapY', '세로 간격'], ['radius', '모서리 둥글기']].map(([k, label]) => `
                                <label class="block"><span class="font-bold text-slate-500">${label}${['across', 'down'].includes(k) ? '' : ' (mm)'}</span>
                                    <input type="number" step="${['across', 'down'].includes(k) ? 1 : 0.1}" min="0" class="lp-custom mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1 font-mono font-bold" data-k="${k}" value="${esc(custom[k] ?? 0)}" /></label>`).join('')}
                            <label class="block"><span class="font-bold text-slate-500">모양</span>
                                <select class="lp-custom mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1 font-bold" data-k="shape">
                                    <option value="rect" ${custom.shape !== 'circle' ? 'selected' : ''}>사각</option><option value="circle" ${custom.shape === 'circle' ? 'selected' : ''}>원형</option>
                                </select></label>
                        </div>
                        <button type="button" id="lp-custom-use" class="mt-3 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg font-black">사용자 정의 용지 적용</button>
                    </details>
                </div>
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                    <div class="font-black text-slate-800">선택한 용지</div>
                    ${cur ? `
                        <div class="flex justify-center">${paperSvg(cur, { maxW: 240 })}</div>
                        <div class="space-y-1 text-slate-700">
                            <div class="font-black text-indigo-800 text-sm">${cur.code ? `폼텍 ${esc(cur.code)}` : '사용자 정의'}</div>
                            ${cur.types ? `<div>${esc(cur.types.join(', '))}</div>` : ''}
                            <div>용지 ${esc(cur.sheet || '')} ${cur.sheetW}×${cur.sheetH}mm</div>
                            <div>라벨 ${cur.w}×${cur.h}mm · ${cur.across}×${cur.down} = <b>${cur.across * cur.down}칸</b></div>
                            <div class="text-slate-500">여백 왼쪽 ${cur.left} · 위 ${cur.top} / 간격 가로 ${cur.gapX} · 세로 ${cur.gapY} (mm)</div>
                        </div>` : '<div class="p-6 text-center text-slate-400 font-bold">왼쪽 목록에서 용지를 고르세요.</div>'}
                    <div class="flex gap-2 pt-2">
                        <button type="button" id="lp-cancel" class="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-xl font-bold">취소</button>
                        <button type="button" id="lp-ok" class="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black disabled:opacity-40" ${cur ? '' : 'disabled'}>${paperReturn === 'edit' ? '이 용지로 변경' : '이 용지로 디자인 시작'}</button>
                    </div>
                </div>
            </div>
        </div>`;
        icon();
        $('#lp-sheet').addEventListener('change', (e) => { paperFilter.sheet = e.target.value; renderPaper(); });
        $('#lp-type').addEventListener('change', (e) => { paperFilter.type = e.target.value; renderPaper(); });
        let qt = null;
        $('#lp-q').addEventListener('input', (e) => {
            clearTimeout(qt);
            qt = setTimeout(() => { paperFilter.q = e.target.value; renderPaper().then(() => { const el = $('#lp-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); }, 200);
        });
        container.querySelectorAll('.lp-row').forEach(tr => tr.addEventListener('click', () => { pickedPaper = clone(list[Number(tr.dataset.i)]); renderPaper(); }));
        $('#lp-custom-use').addEventListener('click', () => {
            const p = { code: '', sheet: '사용자 정의', types: ['사용자 정의'] };
            container.querySelectorAll('.lp-custom').forEach(inp => { p[inp.dataset.k] = inp.dataset.k === 'shape' ? inp.value : Number(inp.value) || 0; });
            if (!(p.sheetW > 0 && p.sheetH > 0 && p.across >= 1 && p.down >= 1 && p.w > 0 && p.h > 0)) { alert('용지·라벨 크기와 칸 수를 입력하세요.'); return; }
            const right = p.left + p.across * p.w + (p.across - 1) * p.gapX;
            const bottom = p.top + p.down * p.h + (p.down - 1) * p.gapY;
            if (right > p.sheetW + 0.5 || bottom > p.sheetH + 0.5) { alert(`라벨 배열이 용지를 벗어납니다. (가로 ${r1(right)}/${p.sheetW}mm, 세로 ${r1(bottom)}/${p.sheetH}mm)`); return; }
            p.across = Math.round(p.across); p.down = Math.round(p.down);
            pickedPaper = p;
            renderPaper();
        });
        $('#lp-cancel').addEventListener('click', () => { pickedPaper = null; if (paperReturn === 'edit') renderEditor(); else renderList(); });
        $('#lp-ok').addEventListener('click', () => {
            const paper = clone(cur);
            pickedPaper = null;
            if (paperReturn === 'edit') {
                pushHistory();
                const old = tpl.paper;
                tpl.paper = paper;
                // 라벨 크기가 바뀌면 개체를 새 크기에 맞게 비율대로 옮긴다
                if (old && (old.w !== paper.w || old.h !== paper.h) && tpl.elements.length && confirm('라벨 크기가 바뀝니다. 개체를 새 크기에 맞게 비율대로 조정할까요?\n(취소하면 위치·크기를 그대로 둡니다)')) {
                    const sx = paper.w / old.w;
                    const sy = paper.h / old.h;
                    tpl.elements.forEach(el => { el.x = r1(el.x * sx); el.y = r1(el.y * sy); el.w = r1(el.w * sx); el.h = r1(el.h * sy); });
                }
                dirty = true;
                renderEditor();
            } else {
                openEditor({ id: null, name: '', category: '', paper, elements: [] }, true);
            }
        });
    };

    // ==========================================
    // ③ 양식 디자인 편집기
    // ==========================================
    const openEditor = (t, isNew = false) => {
        tpl = t;
        tpl.elements = tpl.elements || [];
        dirty = isNew;
        selId = null;
        history = [];
        future = [];
        // 라벨이 화면에 알맞게 보이도록 배율을 정한다
        zoom = Math.max(0.5, Math.min(4, Math.floor((560 / (tpl.paper.w * PX_PER_MM)) * 4) / 4));
        renderEditor();
    };

    const pushHistory = () => {
        history.push(JSON.stringify({ elements: tpl.elements, paper: tpl.paper }));
        if (history.length > 80) history.shift();
        future = [];
        dirty = true;
    };
    const undo = () => {
        if (!history.length) return;
        future.push(JSON.stringify({ elements: tpl.elements, paper: tpl.paper }));
        Object.assign(tpl, JSON.parse(history.pop()));
        if (!tpl.elements.some(e => e.id === selId)) selId = null;
        renderEditor();
    };
    const redo = () => {
        if (!future.length) return;
        history.push(JSON.stringify({ elements: tpl.elements, paper: tpl.paper }));
        Object.assign(tpl, JSON.parse(future.pop()));
        renderEditor();
    };

    const sel = () => tpl?.elements.find(e => e.id === selId) || null;
    const snapV = (v) => (snap ? Math.round(v * 2) / 2 : r1(v));

    const previewData = () => {
        const m = state.master.find(x => x.category === '완제품') || state.master[0];
        const d = m ? itemFieldData(m) : { 품목코드: '5AA40008', 품목명: 'ODM 5W30 엔진오일', 규격: '4L', 단위: 'BOX', 분류: '완제품', 세부분류: '', 거래처: '' };
        return { ...d, ...defaultInputData(), 수량: '20', LOT: 'L260926-01', 비고: '' };
    };

    const addElement = (type) => {
        const p = tpl.paper;
        const w = Math.min(p.w - 4, type === 'qr' ? Math.min(p.w, p.h) * 0.5 : type === 'line' ? p.w - 4 : p.w * 0.6);
        const h = type === 'qr' ? w : type === 'line' ? 2 : type === 'barcode' ? Math.min(p.h * 0.35, 15) : type === 'text' ? Math.min(p.h * 0.25, 10) : Math.min(p.h * 0.5, w);
        const el = { id: uid(), type, x: r1((p.w - w) / 2), y: r1((p.h - h) / 2), w: r1(w), h: r1(h), rotate: 0 };
        if (type === 'text') Object.assign(el, { text: '글자를 입력하세요', font: FONTS[0].value, fontSize: 10, bold: false, align: 'left', vAlign: 'middle', color: '#000000', autoFit: true });
        if (type === 'barcode') Object.assign(el, { value: '{품목코드}', format: 'CODE128', showText: true, textSize: 7, color: '#000000' });
        if (type === 'qr') Object.assign(el, { value: '{품목코드}', ecc: 'M', color: '#000000' });
        if (type === 'line') Object.assign(el, { color: '#000000', thickness: 0.3 });
        if (type === 'rect' || type === 'ellipse') Object.assign(el, { color: '#000000', thickness: 0.3, fill: '', radius: 0 });
        if (type === 'image') Object.assign(el, { src: '', fit: 'contain' });
        pushHistory();
        tpl.elements.push(el);
        selId = el.id;
        renderEditor();
        if (type === 'image') setTimeout(() => $('#lp-img-file')?.click(), 50);
    };

    // 기본 배치: 품목명 / 품목코드·규격 / 바코드
    const addStarterLayout = () => {
        const p = tpl.paper;
        const pad = Math.max(1.5, Math.min(p.w, p.h) * 0.06);
        const w = p.w - pad * 2;
        const hh = p.h - pad * 2;
        pushHistory();
        tpl.elements.push(
            { id: uid(), type: 'text', x: r1(pad), y: r1(pad), w: r1(w), h: r1(hh * 0.34), rotate: 0, text: '{품목명}', font: FONTS[0].value, fontSize: Math.max(8, Math.round(hh * 0.34 * 1.6)), bold: true, align: 'center', vAlign: 'middle', color: '#000000', autoFit: true },
            { id: uid(), type: 'text', x: r1(pad), y: r1(pad + hh * 0.36), w: r1(w), h: r1(hh * 0.18), rotate: 0, text: '{품목코드}  {규격}', font: FONTS[0].value, fontSize: Math.max(6, Math.round(hh * 0.18 * 1.8)), bold: false, align: 'center', vAlign: 'middle', color: '#000000', autoFit: true },
            { id: uid(), type: 'barcode', x: r1(pad + w * 0.1), y: r1(pad + hh * 0.58), w: r1(w * 0.8), h: r1(hh * 0.42), rotate: 0, value: '{품목코드}', format: 'CODE128', showText: false, textSize: 7, color: '#000000' }
        );
        renderEditor();
    };

    let renderSeq = 0;
    const renderBoard = async () => {
        const seq = ++renderSeq;
        const board = $('#ld-board');
        if (!board) return;
        const html = await labelElementsHtml(tpl, preview ? previewData() : null);
        if (seq !== renderSeq || !board.isConnected) return;
        board.innerHTML = html;
        fitLabelTexts(board);
        drawSelection();
    };

    const drawSelection = () => {
        const board = $('#ld-board');
        board?.querySelector('#ld-selbox')?.remove();
        const el = sel();
        if (!board || !el) return;
        const box = document.createElement('div');
        box.id = 'ld-selbox';
        box.style.cssText = `position:absolute;left:${el.x}mm;top:${el.y}mm;width:${el.w}mm;height:${el.h}mm;${el.rotate ? `transform:rotate(${el.rotate}deg);` : ''}outline:${1.5 / zoom}px solid #4f46e5;outline-offset:${1 / zoom}px;pointer-events:none;z-index:50`;
        const hs = 10 / zoom;
        box.innerHTML = `<div id="ld-handle" style="position:absolute;right:${-hs / 2}px;bottom:${-hs / 2}px;width:${hs}px;height:${hs}px;background:#4f46e5;border:${1 / zoom}px solid #fff;pointer-events:auto;cursor:nwse-resize"></div>`;
        board.appendChild(box);
    };

    const fieldOptions = () => `<option value="">+ 필드 넣기</option>
        <optgroup label="품목 정보">${ITEM_FIELDS.map(f => `<option value="{${f.key}}">{${f.key}}</option>`).join('')}</optgroup>
        <optgroup label="인쇄할 때 입력">${INPUT_FIELDS.map(k => `<option value="{${k}}">{${k}}</option>`).join('')}</optgroup>`;

    const propInput = (prop, label, value, { type = 'number', step = 0.1, cls = '' } = {}) => `
        <label class="block ${cls}"><span class="font-bold text-slate-500">${label}</span>
            <input type="${type}" ${type === 'number' ? `step="${step}"` : ''} class="ld-prop mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1 font-mono font-bold" data-prop="${prop}" value="${esc(value ?? '')}" /></label>`;
    const colorInput = (prop, label, value, allowNone = false) => `
        <label class="block"><span class="font-bold text-slate-500">${label}</span>
            <div class="mt-0.5 flex items-center gap-1">
                <input type="color" class="ld-prop w-10 h-8 border border-slate-300 rounded" data-prop="${prop}" value="${esc(value || '#000000')}" ${allowNone && !value ? 'data-none="1"' : ''} />
                ${allowNone ? `<label class="flex items-center gap-1 text-[11px]"><input type="checkbox" class="ld-none" data-prop="${prop}" ${value ? '' : 'checked'} />없음</label>` : ''}
            </div></label>`;

    const propsHtml = () => {
        const el = sel();
        if (!el) {
            return `
            <div class="space-y-3">
                <div class="font-black text-slate-800">양식 정보</div>
                <label class="block"><span class="font-bold text-slate-500">양식 이름</span><input id="ld-name" value="${esc(tpl.name)}" placeholder="예: 드럼 품목 라벨" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                <label class="block"><span class="font-bold text-slate-500">분류 (선택)</span><input id="ld-cat" list="ld-cat-list" value="${esc(tpl.category)}" placeholder="예: 출하, 원료, 자산" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" />
                    <datalist id="ld-cat-list">${[...new Set(templates.map(t => t.category).filter(Boolean))].map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist></label>
                <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <div class="font-bold text-slate-700">${esc(paperText(tpl.paper))}</div>
                    <button type="button" id="ld-paper" class="px-2 py-1 bg-white border border-slate-300 rounded-lg font-bold">용지 변경</button>
                </div>
                <div class="p-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 space-y-1.5">
                    <div class="font-black">사용 방법</div>
                    <ul class="list-disc pl-4 space-y-0.5 text-[11px]">
                        <li>왼쪽 도구로 개체를 넣고, 끌어서 옮기고, 오른쪽 아래 ■를 끌어 크기를 바꿉니다.</li>
                        <li>글자·바코드·QR에 <b>{품목명}</b> 같은 필드를 넣으면 인쇄할 때 값이 채워집니다.</li>
                        <li>방향키 0.5mm(Shift 5mm) 이동 · Delete 삭제 · Ctrl+D 복제 · Ctrl+Z 되돌리기 · Ctrl+S 저장</li>
                    </ul>
                    ${tpl.elements.length === 0 ? '<button type="button" id="ld-starter" class="w-full px-2 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black">기본 배치 넣기 (품목명·코드·바코드)</button>' : ''}
                </div>
                ${tpl.elements.length ? `<div>
                    <div class="font-bold text-slate-500 mb-1">개체 목록 (아래일수록 위에 그려짐)</div>
                    <div class="space-y-1 max-h-48 overflow-y-auto">${tpl.elements.map(e => `<button type="button" class="ld-pick w-full text-left px-2 py-1 rounded-lg bg-white border border-slate-200 hover:border-indigo-400 truncate" data-id="${esc(e.id)}"><b>${ELEMENT_TYPES[e.type]?.label || e.type}</b> <span class="text-slate-500">${esc(e.type === 'text' ? e.text : e.value || '')}</span></button>`).join('')}</div>
                </div>` : ''}
            </div>`;
        }
        const common = `
            <div class="grid grid-cols-2 gap-2">
                ${propInput('x', 'X (mm)', el.x)}${propInput('y', 'Y (mm)', el.y)}
                ${propInput('w', el.type === 'line' ? '길이 (mm)' : '너비 (mm)', el.w)}${propInput('h', '높이 (mm)', el.h)}
                <label class="block col-span-2"><span class="font-bold text-slate-500">회전</span>
                    <select class="ld-prop mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1 font-bold" data-prop="rotate">
                        ${[0, 90, 180, 270].map(d => `<option value="${d}" ${Number(el.rotate || 0) === d ? 'selected' : ''}>${d}°</option>`).join('')}
                    </select></label>
            </div>`;
        let specific = '';
        if (el.type === 'text') {
            specific = `
                <label class="block"><span class="font-bold text-slate-500">내용 (줄바꿈 가능)</span>
                    <textarea class="ld-prop mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold h-20" data-prop="text" id="ld-text">${esc(el.text)}</textarea></label>
                <select class="ld-insert w-full border border-indigo-300 bg-indigo-50 rounded-lg px-2 py-1 font-bold" data-target="text">${fieldOptions()}</select>
                <div class="grid grid-cols-2 gap-2">
                    <label class="block col-span-2"><span class="font-bold text-slate-500">글꼴</span>
                        <select class="ld-prop mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1 font-bold" data-prop="font">${FONTS.map(f => `<option value="${esc(f.value)}" ${f.value === el.font ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>
                    ${propInput('fontSize', '크기 (pt)', el.fontSize, { step: 0.5 })}
                    ${colorInput('color', '글자색', el.color)}
                </div>
                <div class="flex flex-wrap gap-1">
                    ${[['bold', '굵게', 'bold'], ['italic', '기울임', 'italic'], ['underline', '밑줄', 'underline']].map(([k, t, ic]) => `<button type="button" class="ld-toggle px-2 py-1 rounded-lg border ${el[k] ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-300'}" data-prop="${k}" title="${t}"><i data-lucide="${ic}" class="w-3.5 h-3.5"></i></button>`).join('')}
                    <span class="w-2"></span>
                    ${[['left', 'align-left'], ['center', 'align-center'], ['right', 'align-right']].map(([v, ic]) => `<button type="button" class="ld-set px-2 py-1 rounded-lg border ${(el.align || 'left') === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-300'}" data-prop="align" data-value="${v}"><i data-lucide="${ic}" class="w-3.5 h-3.5"></i></button>`).join('')}
                    <span class="w-2"></span>
                    ${[['top', '위'], ['middle', '중'], ['bottom', '아래']].map(([v, t]) => `<button type="button" class="ld-set px-2 py-1 rounded-lg border font-bold ${(el.vAlign || 'top') === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-300'}" data-prop="vAlign" data-value="${v}">${t}</button>`).join('')}
                </div>
                <label class="flex items-center gap-1.5 font-bold"><input type="checkbox" class="ld-check" data-prop="autoFit" ${el.autoFit ? 'checked' : ''} />칸에 맞춤 (넘치면 글자 크기 자동 축소)</label>
                ${colorInput('fill', '배경색', el.fill, true)}`;
        } else if (el.type === 'barcode' || el.type === 'qr') {
            specific = `
                <label class="block"><span class="font-bold text-slate-500">${el.type === 'qr' ? 'QR 내용' : '바코드 값'}</span>
                    <textarea class="ld-prop mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-mono font-bold ${el.type === 'qr' ? 'h-20' : 'h-10'}" data-prop="value">${esc(el.value)}</textarea></label>
                <select class="ld-insert w-full border border-indigo-300 bg-indigo-50 rounded-lg px-2 py-1 font-bold" data-target="value">${fieldOptions()}</select>
                ${el.type === 'barcode' ? `
                    <label class="block"><span class="font-bold text-slate-500">바코드 종류</span>
                        <select class="ld-prop mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1 font-bold" data-prop="format">${BARCODE_FORMATS.map(f => `<option value="${f.value}" ${f.value === el.format ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>
                    <div class="grid grid-cols-2 gap-2 items-end">
                        <label class="flex items-center gap-1.5 font-bold"><input type="checkbox" class="ld-check" data-prop="showText" ${el.showText !== false ? 'checked' : ''} />숫자 표시</label>
                        ${propInput('textSize', '숫자 크기 (pt)', el.textSize, { step: 0.5 })}
                    </div>` : `
                    <label class="block"><span class="font-bold text-slate-500">오류 복원 수준</span>
                        <select class="ld-prop mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1 font-bold" data-prop="ecc">${[['L', '낮음 (7%)'], ['M', '보통 (15%)'], ['Q', '높음 (25%)'], ['H', '최고 (30%)']].map(([v, t]) => `<option value="${v}" ${v === (el.ecc || 'M') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`}
                ${colorInput('color', '색', el.color)}`;
        } else if (el.type === 'image') {
            specific = `
                <input type="file" id="lp-img-file" accept="image/*" class="hidden" />
                <button type="button" id="ld-img-pick" class="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg font-bold">${el.src ? '이미지 바꾸기' : '이미지 파일 선택'}</button>
                <button type="button" id="ld-img-logo" class="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg font-bold">대림 로고 넣기</button>
                <label class="block"><span class="font-bold text-slate-500">맞춤</span>
                    <select class="ld-prop mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1 font-bold" data-prop="fit">${[['contain', '비율 유지 (전체 보이기)'], ['cover', '비율 유지 (꽉 채우기)'], ['fill', '늘려서 채우기']].map(([v, t]) => `<option value="${v}" ${v === (el.fit || 'contain') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
        } else if (el.type === 'line') {
            specific = `<div class="grid grid-cols-2 gap-2">${propInput('thickness', '두께 (mm)', el.thickness, { step: 0.05 })}${colorInput('color', '색', el.color)}</div>`;
        } else if (el.type === 'rect' || el.type === 'ellipse') {
            specific = `<div class="grid grid-cols-2 gap-2">
                ${propInput('thickness', '선 두께 (mm, 0=없음)', el.thickness, { step: 0.05 })}${colorInput('color', '선 색', el.color)}
                ${colorInput('fill', '채우기', el.fill, true)}
                ${el.type === 'rect' ? propInput('radius', '모서리 (mm)', el.radius, { step: 0.5 }) : ''}
            </div>`;
        }
        return `
            <div class="space-y-3">
                <div class="flex items-center justify-between">
                    <span class="font-black text-slate-800">${ELEMENT_TYPES[el.type]?.label || el.type} 속성</span>
                    <button type="button" id="ld-desel" class="text-slate-400 hover:text-slate-700 font-bold">선택 해제</button>
                </div>
                ${specific}
                ${common}
                <div class="grid grid-cols-2 gap-1">
                    <button type="button" class="ld-act px-2 py-1 bg-white border border-slate-300 rounded-lg font-bold" data-act="centerX">가로 가운데</button>
                    <button type="button" class="ld-act px-2 py-1 bg-white border border-slate-300 rounded-lg font-bold" data-act="centerY">세로 가운데</button>
                    <button type="button" class="ld-act px-2 py-1 bg-white border border-slate-300 rounded-lg font-bold" data-act="front">맨 앞으로</button>
                    <button type="button" class="ld-act px-2 py-1 bg-white border border-slate-300 rounded-lg font-bold" data-act="back">맨 뒤로</button>
                    <button type="button" class="ld-act px-2 py-1 bg-white border border-slate-300 rounded-lg font-bold" data-act="dup">복제</button>
                    <button type="button" class="ld-act px-2 py-1 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg font-bold" data-act="del">삭제</button>
                </div>
            </div>`;
    };

    const elementAction = (act) => {
        const el = sel();
        if (!el) return;
        pushHistory();
        const i = tpl.elements.indexOf(el);
        if (act === 'centerX') el.x = r1((tpl.paper.w - el.w) / 2);
        if (act === 'centerY') el.y = r1((tpl.paper.h - el.h) / 2);
        if (act === 'front') { tpl.elements.splice(i, 1); tpl.elements.push(el); }
        if (act === 'back') { tpl.elements.splice(i, 1); tpl.elements.unshift(el); }
        if (act === 'dup') { const c = { ...clone(el), id: uid(), x: r1(el.x + 2), y: r1(el.y + 2) }; tpl.elements.splice(i + 1, 0, c); selId = c.id; }
        if (act === 'del') { tpl.elements.splice(i, 1); selId = null; }
        renderEditor();
    };

    const renderProps = () => {
        const panel = $('#ld-props');
        if (!panel) return;
        panel.innerHTML = propsHtml();
        icon();
        bindProps();
    };

    const bindProps = () => {
        const panel = $('#ld-props');
        let typingPushed = false;
        panel.querySelectorAll('.ld-prop').forEach(inp => {
            const apply = () => {
                const el = sel();
                if (!el) return;
                if (!typingPushed) { pushHistory(); typingPushed = true; }
                const k = inp.dataset.prop;
                if (inp.type === 'number' || k === 'rotate') el[k] = Number(inp.value) || 0;
                else if (inp.type === 'color') {
                    el[k] = inp.value;
                    const none = panel.querySelector(`.ld-none[data-prop="${k}"]`);
                    if (none) none.checked = false;
                } else el[k] = inp.value;
                renderBoard();
            };
            inp.addEventListener(inp.tagName === 'SELECT' || inp.type === 'color' ? 'change' : 'input', apply);
            inp.addEventListener('blur', () => { typingPushed = false; });
        });
        panel.querySelectorAll('.ld-none').forEach(c => c.addEventListener('change', () => {
            const el = sel();
            pushHistory();
            el[c.dataset.prop] = c.checked ? '' : (panel.querySelector(`.ld-prop[data-prop="${c.dataset.prop}"]`)?.value || '#ffffff');
            renderBoard();
        }));
        panel.querySelectorAll('.ld-toggle').forEach(b => b.addEventListener('click', () => { const el = sel(); pushHistory(); el[b.dataset.prop] = !el[b.dataset.prop]; renderBoard(); renderProps(); }));
        panel.querySelectorAll('.ld-set').forEach(b => b.addEventListener('click', () => { const el = sel(); pushHistory(); el[b.dataset.prop] = b.dataset.value; renderBoard(); renderProps(); }));
        panel.querySelectorAll('.ld-check').forEach(c => c.addEventListener('change', () => { const el = sel(); pushHistory(); el[c.dataset.prop] = c.checked; renderBoard(); }));
        panel.querySelectorAll('.ld-insert').forEach(s => s.addEventListener('change', () => {
            const el = sel();
            if (!s.value || !el) return;
            const ta = panel.querySelector(`.ld-prop[data-prop="${s.dataset.target}"]`);
            const pos = ta.selectionStart ?? ta.value.length;
            pushHistory();
            el[s.dataset.target] = ta.value.slice(0, pos) + s.value + ta.value.slice(ta.selectionEnd ?? pos);
            s.value = '';
            renderBoard();
            renderProps();
        }));
        panel.querySelectorAll('.ld-act').forEach(b => b.addEventListener('click', () => elementAction(b.dataset.act)));
        panel.querySelectorAll('.ld-pick').forEach(b => b.addEventListener('click', () => { selId = b.dataset.id; drawSelection(); renderProps(); }));
        panel.querySelector('#ld-desel')?.addEventListener('click', () => { selId = null; drawSelection(); renderProps(); });
        panel.querySelector('#ld-name')?.addEventListener('input', (e) => { tpl.name = e.target.value; dirty = true; });
        panel.querySelector('#ld-cat')?.addEventListener('input', (e) => { tpl.category = e.target.value; dirty = true; });
        panel.querySelector('#ld-paper')?.addEventListener('click', () => { paperReturn = 'edit'; pickedPaper = null; renderPaper(); });
        panel.querySelector('#ld-starter')?.addEventListener('click', addStarterLayout);
        const file = panel.querySelector('#lp-img-file');
        panel.querySelector('#ld-img-pick')?.addEventListener('click', () => file.click());
        file?.addEventListener('change', async () => {
            const f = file.files?.[0];
            if (!f) return;
            try {
                const { src, ratio } = await readImage(f);
                const el = sel();
                pushHistory();
                el.src = src;
                if (ratio && el.w) el.h = r1(Math.min(tpl.paper.h, el.w * ratio));
                renderEditor();
            } catch (e) { alert(e.message); }
        });
        panel.querySelector('#ld-img-logo')?.addEventListener('click', async () => {
            try {
                const blob = await (await fetch('./logo.png')).blob();
                const { src, ratio } = await readImage(new File([blob], 'logo.png', { type: 'image/png' }));
                const el = sel();
                pushHistory();
                el.src = src;
                if (ratio && el.w) el.h = r1(Math.min(tpl.paper.h, el.w * ratio));
                renderEditor();
            } catch (e) { alert(`로고를 불러오지 못했습니다: ${e.message}`); }
        });
    };

    const saveTemplate = async () => {
        if (!tpl.name?.trim()) {
            const name = prompt('양식 이름을 입력하세요.', tpl.name || '');
            if (!name?.trim()) return false;
            tpl.name = name.trim();
        }
        try {
            const saved = await saveLabelTemplate(tpl);
            tpl.id = saved.id;
            dirty = false;
            await reload();
            showToast(`💾 라벨 양식 '${saved.name}'을(를) 저장했습니다.`);
            const nameInput = $('#ld-name');
            if (nameInput) nameInput.value = tpl.name;
            $('#ld-dirty')?.classList.add('hidden');
            return true;
        } catch (e) {
            alert(e.message);
            return false;
        }
    };

    const renderEditor = () => {
        mode = 'edit';
        const p = tpl.paper;
        container.innerHTML = `
        <div class="space-y-4 text-xs">
            <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-2">
                <button type="button" id="ld-back" class="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg font-bold flex items-center gap-1"><i data-lucide="arrow-left" class="w-4 h-4"></i>목록</button>
                <div class="font-black text-slate-900 text-sm truncate max-w-[40%]">${esc(tpl.name || '새 라벨 양식')}</div>
                <span id="ld-dirty" class="${dirty ? '' : 'hidden'} px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">저장 안 됨</span>
                <span class="text-slate-500 truncate">${esc(paperText(p))}</span>
                <div class="ml-auto flex flex-wrap items-center gap-1.5">
                    <button type="button" id="ld-undo" class="p-1.5 bg-white border border-slate-300 rounded-lg disabled:opacity-40" title="되돌리기 (Ctrl+Z)" ${history.length ? '' : 'disabled'}><i data-lucide="undo-2" class="w-4 h-4"></i></button>
                    <button type="button" id="ld-redo" class="p-1.5 bg-white border border-slate-300 rounded-lg disabled:opacity-40" title="다시 실행 (Ctrl+Y)" ${future.length ? '' : 'disabled'}><i data-lucide="redo-2" class="w-4 h-4"></i></button>
                    <span class="w-px h-6 bg-slate-200"></span>
                    <button type="button" id="ld-zoom-out" class="p-1.5 bg-white border border-slate-300 rounded-lg" title="축소"><i data-lucide="zoom-out" class="w-4 h-4"></i></button>
                    <span class="font-mono font-bold w-12 text-center">${Math.round(zoom * 100)}%</span>
                    <button type="button" id="ld-zoom-in" class="p-1.5 bg-white border border-slate-300 rounded-lg" title="확대"><i data-lucide="zoom-in" class="w-4 h-4"></i></button>
                    <label class="flex items-center gap-1 font-bold ml-1"><input type="checkbox" id="ld-grid" ${showGrid ? 'checked' : ''} />격자</label>
                    <label class="flex items-center gap-1 font-bold"><input type="checkbox" id="ld-snap" ${snap ? 'checked' : ''} />0.5mm 맞춤</label>
                    <label class="flex items-center gap-1 font-bold"><input type="checkbox" id="ld-preview" ${preview ? 'checked' : ''} />예시 값</label>
                    <span class="w-px h-6 bg-slate-200"></span>
                    <button type="button" id="ld-save" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black flex items-center gap-1"><i data-lucide="save" class="w-4 h-4"></i>저장</button>
                    <button type="button" id="ld-to-print" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-black flex items-center gap-1"><i data-lucide="printer" class="w-4 h-4"></i>인쇄</button>
                </div>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-[88px_1fr_300px] gap-3">
                <div class="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex lg:flex-col flex-wrap gap-1.5 h-fit">
                    ${Object.entries(ELEMENT_TYPES).map(([k, v]) => `<button type="button" class="ld-add flex-1 lg:flex-none px-2 py-2 rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 font-bold flex flex-col items-center gap-1" data-type="${k}"><i data-lucide="${v.icon}" class="w-4 h-4"></i>${v.label}</button>`).join('')}
                </div>
                <div id="ld-stage" class="bg-slate-200 rounded-2xl border border-slate-300 overflow-auto p-6 min-h-[420px] max-h-[75vh] select-none">
                    <div style="width:${p.w * PX_PER_MM * zoom}px;height:${p.h * PX_PER_MM * zoom}px;margin:auto">
                        <div id="ld-board" style="position:relative;width:${p.w}mm;height:${p.h}mm;transform:scale(${zoom});transform-origin:0 0;background-color:#fff;${showGrid ? 'background-image:linear-gradient(#e2e8f0 1px, transparent 1px),linear-gradient(90deg, #e2e8f0 1px, transparent 1px);background-size:5mm 5mm;' : ''}box-shadow:0 2px 10px rgba(0,0,0,.2);${labelShapeCss(p)}overflow:visible;touch-action:none"></div>
                    </div>
                </div>
                <div id="ld-props" class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm h-fit max-h-[80vh] overflow-y-auto"></div>
            </div>
        </div>`;
        icon();
        renderBoard();
        renderProps();

        $('#ld-back').addEventListener('click', async () => {
            if (dirty && !confirm('저장하지 않은 변경 내용이 있습니다. 목록으로 나갈까요?')) return;
            tpl = null;
            renderList();
        });
        $('#ld-undo').addEventListener('click', undo);
        $('#ld-redo').addEventListener('click', redo);
        $('#ld-zoom-in').addEventListener('click', () => { zoom = Math.min(6, zoom + 0.25); renderEditor(); });
        $('#ld-zoom-out').addEventListener('click', () => { zoom = Math.max(0.25, zoom - 0.25); renderEditor(); });
        $('#ld-grid').addEventListener('change', (e) => { showGrid = e.target.checked; renderEditor(); });
        $('#ld-snap').addEventListener('change', (e) => { snap = e.target.checked; });
        $('#ld-preview').addEventListener('change', (e) => { preview = e.target.checked; renderBoard(); });
        $('#ld-save').addEventListener('click', saveTemplate);
        $('#ld-to-print').addEventListener('click', async () => {
            if ((dirty || !tpl.id) && !(await saveTemplate())) return;
            openPrint(tpl.id);
        });
        container.querySelectorAll('.ld-add').forEach(b => b.addEventListener('click', () => addElement(b.dataset.type)));

        // 끌어서 이동 / 크기 조절
        const board = $('#ld-board');
        board.addEventListener('pointerdown', (e) => {
            const handle = e.target.closest('#ld-handle');
            const node = e.target.closest('.lbl-el');
            if (!handle && !node) { if (selId) { selId = null; drawSelection(); renderProps(); } return; }
            if (node && node.dataset.id !== selId) { selId = node.dataset.id; drawSelection(); renderProps(); }
            const el = sel();
            if (!el) return;
            e.preventDefault();
            const pxPerMm = board.getBoundingClientRect().width / p.w;
            const start = { mx: e.clientX, my: e.clientY, x: el.x, y: el.y, w: el.w, h: el.h };
            const dom = board.querySelector(`.lbl-el[data-id="${CSS.escape(el.id)}"]`);
            const selbox = board.querySelector('#ld-selbox');
            let moved = false;
            const onMove = (ev) => {
                const dx = (ev.clientX - start.mx) / pxPerMm;
                const dy = (ev.clientY - start.my) / pxPerMm;
                if (!moved && Math.abs(dx) + Math.abs(dy) < 0.3) return;
                if (!moved) { pushHistory(); moved = true; }
                if (handle) {
                    el.w = Math.max(1, snapV(start.w + dx));
                    el.h = Math.max(el.type === 'line' ? 0.5 : 1, snapV(start.h + dy));
                    if (el.type === 'qr' && !ev.shiftKey) el.h = el.w; // QR은 정사각형 유지 (Shift로 해제)
                } else {
                    el.x = snapV(start.x + dx);
                    el.y = snapV(start.y + dy);
                }
                [dom, selbox].forEach(d => { if (d) { d.style.left = `${el.x}mm`; d.style.top = `${el.y}mm`; d.style.width = `${el.w}mm`; d.style.height = `${el.h}mm`; } });
            };
            const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                if (moved) { renderBoard(); renderProps(); $('#ld-dirty')?.classList.remove('hidden'); }
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
        board.addEventListener('dblclick', (e) => { if (e.target.closest('.lbl-el')) $('#ld-text')?.focus(); });
    };

    // 편집기 단축키 (화면을 다시 그려도 한 번만 등록)
    if (window.__labelDesignerKeys) document.removeEventListener('keydown', window.__labelDesignerKeys);
    window.__labelDesignerKeys = (e) => {
        if (mode !== 'edit' || !tpl || !container.isConnected || !container.querySelector('#ld-board')) return;
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveTemplate(); return; }
        if (typing) return;
        if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
        const el = sel();
        if (!el) return;
        if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); elementAction('dup'); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); elementAction('del'); return; }
        const step = e.shiftKey ? 5 : 0.5;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) {
            e.preventDefault();
            pushHistory();
            el.x = r1(el.x + moves[e.key][0]);
            el.y = r1(el.y + moves[e.key][1]);
            renderBoard();
            renderProps();
            $('#ld-dirty')?.classList.remove('hidden');
        }
    };
    document.addEventListener('keydown', window.__labelDesignerKeys);

    // ==========================================
    // ④ 인쇄
    // ==========================================
    const openPrint = (id) => {
        printSt.tplId = id;
        printSt.start = 0;
        printSt.rows = [];
        printSt.inputs = defaultInputData();
        renderPrint();
    };

    const printTpl = () => templates.find(t => t.id === printSt.tplId);

    // 인쇄할 라벨 데이터 목록
    const buildRecords = () => {
        const t = printTpl();
        if (!t) return [];
        if (printSt.mode === 'repeat') {
            const d = { ...printSt.inputs };
            return Array.from({ length: Math.max(0, Math.min(2000, Number(printSt.count) || 0)) }, () => d);
        }
        const out = [];
        printSt.rows.forEach(row => {
            const m = state.master.find(x => x.code === row.code);
            const d = { ...itemFieldData(m), ...printSt.inputs, ...Object.fromEntries(Object.entries(row.fields || {}).filter(([, v]) => v !== '')) };
            for (let i = 0; i < Math.min(2000, Number(row.copies) || 0); i++) out.push(d);
        });
        return out;
    };

    let printSeq = 0;
    const renderPrintPreview = async () => {
        const t = printTpl();
        const box = $('#lpr-preview');
        if (!t || !box) return;
        const seq = ++printSeq;
        const records = buildRecords();
        const per = cellsPerSheet(t.paper);
        $('#lpr-summary').textContent = `라벨 ${records.length}개 · 용지 ${Math.ceil((records.length + printSt.start) / per) || 0}장`;
        const sheets = await sheetsHtml(t, records.slice(0, per * 3 - printSt.start), { startIndex: printSt.start, offsetX: printSt.offset.x, offsetY: printSt.offset.y, outline: true });
        if (seq !== printSeq || !box.isConnected) return;
        const scale = Math.min(1, Math.max(120, (box.clientWidth || 330) - 28) / (t.paper.sheetW * PX_PER_MM));
        box.innerHTML = sheets.length ? sheets.map(s => `<div style="width:${t.paper.sheetW * PX_PER_MM * scale}px;height:${t.paper.sheetH * PX_PER_MM * scale}px;overflow:hidden" class="mx-auto mb-3 shadow border border-slate-300 bg-white">
                <div style="transform:scale(${scale});transform-origin:0 0">${s}</div></div>`).join('') + (Math.ceil((records.length + printSt.start) / per) > 3 ? '<div class="text-center text-slate-500 font-bold">… 미리보기는 3장까지만 보여줍니다</div>' : '')
            : '<div class="p-6 text-center text-slate-400 font-bold">인쇄할 라벨이 없습니다.</div>';
        fitLabelTexts(box);
    };

    const doPrint = async () => {
        const t = printTpl();
        const records = buildRecords();
        if (!records.length) { alert('인쇄할 라벨이 없습니다.'); return; }
        const w = openLabelPrintWindow();
        if (!w) return;
        const sheets = await sheetsHtml(t, records, { startIndex: printSt.start, offsetX: printSt.offset.x, offsetY: printSt.offset.y, outline: printSt.outline });
        writeLabelPrintWindow(w, t.name, t.paper, sheets);
        showToast(`🖨️ 라벨 ${records.length}개 인쇄 창을 열었습니다. 인쇄 설정에서 배율 '100%(실제 크기)', 여백 '없음'으로 인쇄하세요.`);
    };

    const renderPrint = async () => {
        mode = 'print';
        const t = printTpl();
        if (!t) { renderList(); return; }
        const p = t.paper;
        const per = cellsPerSheet(p);
        const used = fieldsInTemplate(t);
        const itemKeys = ITEM_FIELDS.map(f => f.key);
        const inputKeys = used.filter(k => !itemKeys.includes(k));      // 인쇄할 때 입력 (수량·LOT·날짜·사용자 필드)
        const itemUsed = used.filter(k => itemKeys.includes(k));
        container.innerHTML = `
        <div class="space-y-5">
            ${header(`인쇄 · ${t.name}`)}
            <div class="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 text-xs">
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div class="flex flex-wrap items-center gap-2">
                        <button type="button" id="lpr-back" class="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg font-bold flex items-center gap-1"><i data-lucide="arrow-left" class="w-4 h-4"></i>목록</button>
                        <select id="lpr-tpl" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${templates.map(x => `<option value="${esc(x.id)}" ${x.id === t.id ? 'selected' : ''}>${esc(x.category ? `[${x.category}] ` : '')}${esc(x.name)}</option>`).join('')}</select>
                        <button type="button" id="lpr-edit" class="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold">양식 편집</button>
                        <span class="text-slate-500">${esc(paperText(p))}</span>
                    </div>
                    <div class="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit font-bold">
                        <button type="button" class="lpr-mode px-3 py-1.5 rounded-lg ${printSt.mode === 'repeat' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}" data-mode="repeat">같은 내용 반복</button>
                        <button type="button" class="lpr-mode px-3 py-1.5 rounded-lg ${printSt.mode === 'items' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}" data-mode="items">품목 선택 (여러 품목)</button>
                    </div>
                    ${printSt.mode === 'repeat' ? `
                    <div class="space-y-2">
                        ${itemUsed.length ? `<div class="relative">
                            <span class="font-bold text-slate-600">품목 불러오기 (품목 정보 필드 채우기)</span>
                            <input type="text" id="lpr-item-q" placeholder="품목코드·품목명 일부" autocomplete="off" class="mt-1 w-full border border-indigo-300 rounded-lg px-2 py-1.5 font-bold" />
                            <div id="lpr-item-sg" class="hidden absolute left-0 right-0 top-full mt-1 z-20 max-h-60 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl"></div>
                        </div>` : ''}
                        <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                            ${[...itemUsed, ...inputKeys].map(k => `<label class="block"><span class="font-bold text-slate-500">{${esc(k)}}</span>
                                <input type="text" class="lpr-input mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" data-k="${esc(k)}" value="${esc(printSt.inputs[k] ?? '')}" /></label>`).join('') || '<div class="text-slate-400 col-span-3">이 양식에는 입력할 필드가 없습니다. (고정 내용 라벨)</div>'}
                        </div>
                        <div class="flex flex-wrap items-end gap-2">
                            <label class="block w-32"><span class="font-bold text-slate-500">라벨 개수</span>
                                <input type="number" id="lpr-count" min="1" max="2000" value="${esc(printSt.count)}" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-mono font-black text-right" /></label>
                            <button type="button" id="lpr-fill" class="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold">한 장 가득 (${per - printSt.start}개)</button>
                        </div>
                    </div>` : `
                    <div class="space-y-2">
                        <div class="relative">
                            <span class="font-bold text-slate-600">품목 추가 (코드·품목명 일부)</span>
                            <input type="text" id="lpr-item-q" placeholder="예: 5w30, 40008" autocomplete="off" class="mt-1 w-full border border-indigo-300 rounded-lg px-2 py-1.5 font-bold" />
                            <div id="lpr-item-sg" class="hidden absolute left-0 right-0 top-full mt-1 z-20 max-h-60 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl"></div>
                        </div>
                        ${inputKeys.length ? `<div class="grid grid-cols-2 md:grid-cols-3 gap-2 p-2 bg-slate-50 rounded-xl border border-slate-200">
                            <div class="col-span-full font-bold text-slate-500">모든 품목에 같은 값 (줄마다 따로 입력하면 그 값이 우선)</div>
                            ${inputKeys.map(k => `<label class="block"><span class="font-bold text-slate-500">{${esc(k)}}</span>
                                <input type="text" class="lpr-input mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1 font-bold" data-k="${esc(k)}" value="${esc(printSt.inputs[k] ?? '')}" /></label>`).join('')}
                        </div>` : ''}
                        <div class="overflow-auto border border-slate-200 rounded-xl max-h-[40vh]">
                            <table class="w-full">
                                <thead class="bg-slate-50 text-slate-600 font-bold sticky top-0"><tr>
                                    <th class="p-2 text-left">품목코드</th><th class="p-2 text-left">품목명</th>${inputKeys.map(k => `<th class="p-2 text-left">{${esc(k)}}</th>`).join('')}<th class="p-2 text-right w-20">매수</th><th class="p-2 w-8"></th>
                                </tr></thead>
                                <tbody class="divide-y divide-slate-100">
                                    ${printSt.rows.map((row, i) => {
                                        const m = state.master.find(x => x.code === row.code);
                                        return `<tr data-i="${i}">
                                            <td class="p-2 font-mono font-bold">${esc(row.code)}</td>
                                            <td class="p-2 font-bold">${esc(m?.name || '(품목 없음)')}</td>
                                            ${inputKeys.map(k => `<td class="p-1"><input type="text" class="lpr-row-f w-full min-w-[70px] border border-slate-300 rounded px-1.5 py-1" data-k="${esc(k)}" value="${esc(row.fields?.[k] ?? '')}" placeholder="${esc(printSt.inputs[k] ?? '')}" /></td>`).join('')}
                                            <td class="p-1"><input type="number" min="0" class="lpr-row-c w-full border border-slate-300 rounded px-1.5 py-1 text-right font-black" value="${esc(row.copies)}" /></td>
                                            <td class="p-1 text-center"><button type="button" class="lpr-row-del text-slate-400 hover:text-rose-600 font-black px-1">✕</button></td>
                                        </tr>`;
                                    }).join('') || `<tr><td colspan="${4 + inputKeys.length}" class="p-5 text-center text-slate-400 font-bold">위에서 품목을 검색해 추가하세요.</td></tr>`}
                                </tbody>
                            </table>
                        </div>
                    </div>`}
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                            <div class="font-black text-slate-700">시작 위치 <span class="font-normal text-slate-500">(쓰다 남은 용지: 첫 칸을 누르세요)</span></div>
                            <div id="lpr-start" class="flex justify-center cursor-pointer">${paperSvg(p, { highlight: printSt.start, maxW: 170 })}</div>
                            <div class="text-center font-bold text-indigo-700">${printSt.start + 1}번째 칸부터 (${per}칸 중)</div>
                        </div>
                        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                            <div class="font-black text-slate-700">인쇄 위치 보정 <span class="font-normal text-slate-500">(프린터마다 밀리면 조정, 이 기기에 저장)</span></div>
                            <div class="grid grid-cols-2 gap-2">
                                <label class="block"><span class="font-bold text-slate-500">오른쪽으로 (mm)</span><input type="number" step="0.1" id="lpr-ox" value="${esc(printSt.offset.x)}" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1 font-mono font-bold" /></label>
                                <label class="block"><span class="font-bold text-slate-500">아래로 (mm)</span><input type="number" step="0.1" id="lpr-oy" value="${esc(printSt.offset.y)}" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1 font-mono font-bold" /></label>
                            </div>
                            <label class="flex items-center gap-1.5 font-bold"><input type="checkbox" id="lpr-outline" ${printSt.outline ? 'checked' : ''} />라벨 테두리도 인쇄 (일반 용지로 시험 인쇄할 때)</label>
                            <div class="text-[11px] text-slate-500">인쇄 창에서 배율 <b>100% (실제 크기)</b>, 여백 <b>없음</b>, 머리글/바닥글 끄기로 인쇄하세요.</div>
                        </div>
                    </div>
                </div>
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 h-fit lg:sticky lg:top-4">
                    <div class="flex items-center justify-between">
                        <span class="font-black text-slate-800">미리보기</span>
                        <span id="lpr-summary" class="font-bold text-indigo-700"></span>
                    </div>
                    <div id="lpr-preview" class="max-h-[60vh] overflow-y-auto bg-slate-100 rounded-xl p-3"></div>
                    <button type="button" id="lpr-print" class="w-full px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black flex items-center justify-center gap-1.5 text-sm"><i data-lucide="printer" class="w-4 h-4"></i>인쇄</button>
                </div>
            </div>
        </div>`;
        icon();
        renderPrintPreview();

        $('#lpr-back').addEventListener('click', renderList);
        $('#lpr-tpl').addEventListener('change', (e) => { printSt.tplId = e.target.value; printSt.start = 0; renderPrint(); });
        $('#lpr-edit').addEventListener('click', () => openEditor(clone(t)));
        container.querySelectorAll('.lpr-mode').forEach(b => b.addEventListener('click', () => { printSt.mode = b.dataset.mode; renderPrint(); }));
        container.querySelectorAll('.lpr-input').forEach(inp => inp.addEventListener('input', () => { printSt.inputs[inp.dataset.k] = inp.value; renderPrintPreview(); }));
        $('#lpr-count')?.addEventListener('input', (e) => { printSt.count = Number(e.target.value) || 0; renderPrintPreview(); });
        $('#lpr-fill')?.addEventListener('click', () => { printSt.count = per - printSt.start; $('#lpr-count').value = printSt.count; renderPrintPreview(); });
        $('#lpr-start').addEventListener('click', (e) => {
            const cell = e.target.closest('[data-cell]');
            if (!cell) return;
            printSt.start = Number(cell.dataset.cell);
            renderPrint();
        });
        const saveOffset = () => {
            printSt.offset = { x: Number($('#lpr-ox').value) || 0, y: Number($('#lpr-oy').value) || 0 };
            try { localStorage.setItem(OFFSET_KEY, JSON.stringify(printSt.offset)); } catch { /* 저장 불가 */ }
            renderPrintPreview();
        };
        $('#lpr-ox').addEventListener('input', saveOffset);
        $('#lpr-oy').addEventListener('input', saveOffset);
        $('#lpr-outline').addEventListener('change', (e) => { printSt.outline = e.target.checked; });
        $('#lpr-print').addEventListener('click', doPrint);

        container.querySelectorAll('tr[data-i]').forEach(tr => {
            const row = printSt.rows[Number(tr.dataset.i)];
            tr.querySelector('.lpr-row-c').addEventListener('input', (e) => { row.copies = Number(e.target.value) || 0; renderPrintPreview(); });
            tr.querySelectorAll('.lpr-row-f').forEach(inp => inp.addEventListener('input', () => { row.fields = { ...(row.fields || {}), [inp.dataset.k]: inp.value }; renderPrintPreview(); }));
            tr.querySelector('.lpr-row-del').addEventListener('click', () => { printSt.rows.splice(Number(tr.dataset.i), 1); renderPrint(); });
        });

        // 품목 검색 (부분 문자)
        const q = $('#lpr-item-q');
        const sg = $('#lpr-item-sg');
        if (q) {
            let found = [];
            let active = 0;
            const pick = (m) => {
                if (!m) return;
                if (printSt.mode === 'repeat') {
                    Object.assign(printSt.inputs, itemFieldData(m));
                } else {
                    const ex = printSt.rows.find(r => r.code === m.code);
                    if (ex) ex.copies = (Number(ex.copies) || 0) + 1;
                    else printSt.rows.push({ code: m.code, copies: 1, fields: {} });
                }
                renderPrint().then(() => $('#lpr-item-q')?.focus());
            };
            const show = () => {
                found = q.value.trim() ? searchMasterItems(q.value, 30) : [];
                active = 0;
                sg.innerHTML = found.length ? found.map((m, i) => `<button type="button" data-i="${i}" class="lpr-sg w-full text-left px-2.5 py-1.5 border-b border-slate-100 flex gap-2 ${i === 0 ? 'bg-indigo-50' : 'hover:bg-indigo-50'}">
                        <span class="font-mono font-bold shrink-0">${esc(m.code)}</span><span class="font-bold truncate">${esc(m.name)}</span><span class="text-slate-400 truncate">${esc(m.spec && m.spec !== '-' ? m.spec : '')}</span></button>`).join('')
                    : '<div class="p-3 text-slate-400">일치하는 품목이 없습니다.</div>';
                sg.classList.toggle('hidden', !q.value.trim());
                sg.querySelectorAll('.lpr-sg').forEach(b => {
                    b.addEventListener('mousedown', (e) => e.preventDefault());
                    b.addEventListener('click', () => pick(found[Number(b.dataset.i)]));
                });
            };
            q.addEventListener('input', show);
            q.addEventListener('blur', () => setTimeout(() => sg.classList.add('hidden'), 150));
            q.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (!found.length) return;
                    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
                    sg.querySelectorAll('.lpr-sg').forEach((b, i) => { b.classList.toggle('bg-indigo-50', i === active); if (i === active) b.scrollIntoView({ block: 'nearest' }); });
                } else if (e.key === 'Enter') { e.preventDefault(); pick(found[active]); }
            });
        }
    };

    container.innerHTML = `<div class="p-10 text-center text-slate-400 font-bold">라벨 양식을 불러오는 중...</div>`;
    await Promise.all([reload(), loadPapers()]);
    renderList();
};
