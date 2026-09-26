import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { esc } from './html.js';
import { localDateStr } from './searchUtils.js';

// 라벨 만들기: 양식(용지 + 개체)을 mm 단위 HTML로 그린다. 편집 화면·미리보기·인쇄가 같은 함수를 쓴다.
// 개체 좌표(x, y, w, h)는 라벨 왼쪽 위 기준 mm, 글자 크기는 pt.

// 품목 마스터에서 채우는 필드
export const ITEM_FIELDS = [
    { key: '품목코드', of: (m) => m.code },
    { key: '품목명', of: (m) => m.name },
    { key: '규격', of: (m) => (m.spec && m.spec !== '-' ? m.spec : '') },
    { key: '단위', of: (m) => m.unit || '' },
    { key: '분류', of: (m) => m.category || '' },
    { key: '세부분류', of: (m) => m.subCategory || '' },
    { key: '거래처', of: (m) => m.supplier || '' }
];
// 인쇄할 때 입력하는 필드 (날짜는 오늘로 기본 입력)
export const INPUT_FIELDS = ['날짜', '수량', 'LOT', '비고'];

export const itemFieldData = (m) => Object.fromEntries(ITEM_FIELDS.map(f => [f.key, m ? String(f.of(m) ?? '') : '']));
export const defaultInputData = () => ({ 날짜: localDateStr() });

const FIELD_RE = /\{([^{}\n]{1,30})\}/g;
// 양식에 쓰인 필드 이름 목록 (글자·바코드·QR)
export const fieldsInTemplate = (tpl) => {
    const out = new Set();
    (tpl?.elements || []).forEach(el => {
        const s = el.type === 'text' ? el.text : (el.type === 'barcode' || el.type === 'qr') ? el.value : '';
        for (const m of String(s || '').matchAll(FIELD_RE)) out.add(m[1].trim());
    });
    return [...out];
};
// data가 없으면(편집 화면) {필드}를 그대로 둔다
export const fillFields = (s, data) => (data ? String(s ?? '').replace(FIELD_RE, (_, k) => String(data[k.trim()] ?? '')) : String(s ?? ''));

export const FONTS = [
    { value: "'Malgun Gothic', '맑은 고딕', sans-serif", label: '맑은 고딕' },
    { value: "Gulim, '굴림', sans-serif", label: '굴림' },
    { value: "Dotum, '돋움', sans-serif", label: '돋움' },
    { value: "Batang, '바탕', serif", label: '바탕' },
    { value: "Gungsuh, '궁서', serif", label: '궁서' },
    { value: 'Arial, sans-serif', label: 'Arial' },
    { value: "'Arial Black', Arial, sans-serif", label: 'Arial Black' },
    { value: "'Times New Roman', serif", label: 'Times New Roman' },
    { value: 'Consolas, monospace', label: 'Consolas' }
];
export const BARCODE_FORMATS = [
    { value: 'CODE128', label: 'Code 128 (영문·숫자)' },
    { value: 'CODE39', label: 'Code 39' },
    { value: 'EAN13', label: 'EAN-13 (13자리 숫자)' },
    { value: 'EAN8', label: 'EAN-8 (8자리 숫자)' },
    { value: 'UPC', label: 'UPC-A (12자리 숫자)' },
    { value: 'ITF14', label: 'ITF-14 (14자리 숫자)' }
];

const SAMPLE_BARCODE = { CODE128: 'SAMPLE123', CODE39: 'SAMPLE123', EAN13: '5901234123457', EAN8: '96385074', UPC: '123456789999', ITF14: '15400141288763' };
const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const cssColor = (c, d = '#000000') => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : d);

const boxStyle = (el) => `left:${n(el.x)}mm;top:${n(el.y)}mm;width:${Math.max(0.1, n(el.w))}mm;height:${Math.max(0.1, n(el.h))}mm;${n(el.rotate) ? `transform:rotate(${n(el.rotate)}deg);` : ''}`;

const barcodeSvg = (value, el) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, value, {
        format: el.format || 'CODE128', displayValue: false, margin: 0, width: 2, height: 100,
        lineColor: cssColor(el.color), background: 'transparent'
    });
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.removeAttribute('style');
    return svg.outerHTML;
};

const errorBox = (msg) => `<div style="width:100%;height:100%;border:0.3mm dashed #e11d48;color:#e11d48;font:7pt sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden">${esc(msg)}</div>`;

// 개체 하나의 HTML
export const elementHtml = async (el, data) => {
    const base = `class="lbl-el" data-id="${esc(el.id)}" style="position:absolute;box-sizing:border-box;${boxStyle(el)}`;
    switch (el.type) {
        case 'text': {
            const text = fillFields(el.text, data);
            const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[el.vAlign] || 'flex-start';
            const size = n(el.fontSize, 10);
            const fill = el.fill ? `background:${cssColor(el.fill, 'transparent')};` : '';
            return `<div ${base}display:flex;flex-direction:column;justify-content:${justify};overflow:hidden;${fill}" ${el.autoFit ? `data-fit="1" data-size="${size}"` : ''}>
                <div class="lbl-text" style="font-family:${esc(el.font || FONTS[0].value)};font-size:${size}pt;font-weight:${el.bold ? 800 : 400};${el.italic ? 'font-style:italic;' : ''}${el.underline ? 'text-decoration:underline;' : ''}color:${cssColor(el.color)};text-align:${['left', 'center', 'right'].includes(el.align) ? el.align : 'left'};line-height:${n(el.lineHeight, 1.15)};letter-spacing:${n(el.spacing)}pt;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere">${esc(text) || (data ? '' : '<span style="color:#94a3b8">(글자)</span>')}</div></div>`;
        }
        case 'barcode': {
            const value = fillFields(el.value, data);
            if (!value) return `<div ${base}">${data ? '' : errorBox('바코드 값 없음')}</div>`;
            // 편집 화면에서 필드({품목코드} 등)가 든 값은 예시 값으로 막대를 그리고 글자는 필드 그대로 보여준다
            const drawValue = !data && /\{[^{}\n]{1,30}\}/.test(value) ? (SAMPLE_BARCODE[el.format] || 'SAMPLE123') : value;
            let bars;
            try { bars = barcodeSvg(drawValue, el); } catch { return `<div ${base}">${errorBox(`바코드 오류: ${el.format || 'CODE128'} 형식에 맞지 않는 값 (${value})`)}</div>`; }
            const textH = el.showText !== false ? n(el.textSize, 7) * 0.3528 * 1.25 : 0; // pt → mm
            return `<div ${base}display:flex;flex-direction:column;">
                <div style="flex:1;min-height:0">${bars}</div>
                ${el.showText !== false ? `<div style="height:${textH}mm;font:${n(el.textSize, 7)}pt Consolas, 'Malgun Gothic', monospace;text-align:center;line-height:1.2;color:${cssColor(el.color)};white-space:nowrap;overflow:hidden">${esc(value)}</div>` : ''}
            </div>`;
        }
        case 'qr': {
            const value = fillFields(el.value, data);
            if (!value) return `<div ${base}">${data ? '' : errorBox('QR 값 없음')}</div>`;
            try {
                const svg = await QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: el.ecc || 'M', color: { dark: cssColor(el.color), light: '#0000' } });
                return `<div ${base}">${svg.replace('<svg ', '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" ')}</div>`;
            } catch {
                return `<div ${base}">${errorBox('QR 오류: 내용이 너무 깁니다')}</div>`;
            }
        }
        case 'image':
            return el.src
                ? `<div ${base}"><img src="${esc(el.src)}" alt="" style="width:100%;height:100%;object-fit:${['contain', 'cover', 'fill'].includes(el.fit) ? el.fit : 'contain'};display:block" /></div>`
                : `<div ${base}">${errorBox('이미지 없음')}</div>`;
        case 'line':
            return `<div ${base}"><div style="position:absolute;left:0;right:0;top:50%;height:${Math.max(0.05, n(el.thickness, 0.3))}mm;transform:translateY(-50%);background:${cssColor(el.color)}"></div></div>`;
        case 'rect':
        case 'ellipse': {
            const radius = el.type === 'ellipse' ? '50%' : `${n(el.radius)}mm`;
            const fill = el.fill ? cssColor(el.fill, 'transparent') : 'transparent';
            const stroke = n(el.thickness, 0.3) > 0 ? `border:${n(el.thickness, 0.3)}mm solid ${cssColor(el.color)};` : '';
            return `<div ${base}${stroke}background:${fill};border-radius:${radius}"></div>`;
        }
        default:
            return '';
    }
};

// 라벨 한 장(개체 전체)의 HTML. 개체 순서가 곧 겹침 순서(뒤쪽이 위).
export const labelElementsHtml = async (tpl, data) => (await Promise.all((tpl.elements || []).map(el => elementHtml(el, data)))).join('');

// '칸에 맞춤' 글자: 칸을 넘치면 글자 크기를 줄인다 (인쇄 창에서도 문자열로 넣어 실행하므로 외부 참조 없이 작성)
export function fitLabelTexts(root) {
    root.querySelectorAll('[data-fit="1"]').forEach(function (box) {
        var inner = box.firstElementChild;
        if (!inner) return;
        var size = parseFloat(box.getAttribute('data-size')) || 10;
        inner.style.fontSize = size + 'pt';
        var guard = 0;
        while ((inner.scrollHeight > box.clientHeight + 0.5 || inner.scrollWidth > box.clientWidth + 0.5) && size > 3 && guard < 200) {
            size -= 0.25;
            inner.style.fontSize = size + 'pt';
            guard++;
        }
    });
}

// 용지의 index번째 칸 위치 (가로로 먼저 채움)
export const cellPos = (paper, index) => {
    const col = index % paper.across;
    const row = Math.floor(index / paper.across);
    return { x: n(paper.left) + col * (n(paper.w) + n(paper.gapX)), y: n(paper.top) + row * (n(paper.h) + n(paper.gapY)) };
};
export const cellsPerSheet = (paper) => Math.max(1, n(paper.across) * n(paper.down));

export const labelShapeCss = (paper) => (paper.shape === 'circle' ? 'border-radius:50%;' : paper.radius ? `border-radius:${n(paper.radius)}mm;` : '');

// 인쇄용 용지들 HTML. records: 라벨마다 채울 데이터, startIndex: 첫 장에서 비워 둘 칸 수
export const sheetsHtml = async (tpl, records, { startIndex = 0, offsetX = 0, offsetY = 0, outline = false } = {}) => {
    const paper = tpl.paper;
    const per = cellsPerSheet(paper);
    const slots = [...Array(startIndex).fill(null), ...records];
    const sheets = [];
    for (let s = 0; s < slots.length; s += per) {
        const cells = await Promise.all(slots.slice(s, s + per).map(async (data, i) => {
            if (!data) return '';
            const { x, y } = cellPos(paper, i);
            return `<div class="lbl" style="position:absolute;overflow:hidden;box-sizing:border-box;left:${x + n(offsetX)}mm;top:${y + n(offsetY)}mm;width:${paper.w}mm;height:${paper.h}mm;${labelShapeCss(paper)}${outline ? 'outline:0.2mm dashed #94a3b8;' : ''}">${await labelElementsHtml(tpl, data)}</div>`;
        }));
        sheets.push(`<div class="sheet" style="position:relative;overflow:hidden;width:${paper.sheetW}mm;height:${paper.sheetH}mm">${cells.join('')}</div>`);
    }
    return sheets;
};

export const printCss = (paper) => `
    @page { size: ${paper.sheetW}mm ${paper.sheetH}mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet { position: relative; overflow: hidden; page-break-after: always; break-after: page; }
    .sheet:last-child { page-break-after: auto; break-after: auto; }
    .lbl { position: absolute; overflow: hidden; box-sizing: border-box; }
    @media screen { body { background: #cbd5e1; } .sheet { background: #fff; margin: 8mm auto; box-shadow: 0 1px 6px rgba(0,0,0,.25); } }`;
