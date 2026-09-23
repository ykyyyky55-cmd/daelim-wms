import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

function readExtended80(buffer, offset) {
    if (offset + 10 > buffer.length || offset < 0) return null;
    const expSign = buffer.readUInt16LE(offset + 8);
    const sign = (expSign & 0x8000) ? -1 : 1;
    const exponent = expSign & 0x7FFF;
    const mantLow = buffer.readUInt32LE(offset);
    const mantHigh = buffer.readUInt32LE(offset + 4);
    if (exponent === 0 && mantHigh === 0 && mantLow === 0) return 0;
    if (exponent === 0x7FFF) return sign * Infinity;
    const mantBig = (BigInt(mantHigh) << 32n) | BigInt(mantLow);
    const mantVal = Number(mantBig) / Math.pow(2, 63);
    const trueExp = exponent - 16383;
    return sign * mantVal * Math.pow(2, trueExp);
}

// DGF 파일 내의 모든 오브젝트를 추출하여 HTML 시각화
// Delphi VCL 오브젝트들을 찾는다.
// 각 오브젝트는 보통 다음과 같은 속성을 가짐:
// Left, Top, Width, Height (Extended80)
// Text (UTF-16LE)
// Font size, Font color, Background color, Border etc.

const knownElements = [
    { type: 'border', name: '외곽선', p: 0x1be, l: 6.92, t: 7.70, w: 196.55, h: 279.32, border: 0.2 },
    { type: 'text', name: '타이틀', p: 0x21d, l: 13.91, t: 13.00, w: 182.56, h: 34.40, text: '파렛트 식별표', font: 50, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: '제품명', p: 0x367, l: 13.85, t: 57.94, w: 182.56, h: 34.66, text: '카밈 가솔린 촉매 산소센서 클리너 프로 0.3L', font: 35, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: '팔레트라벨', p: 0x419, l: 13.91, t: 103.33, w: 182.56, h: 15.50, text: 'PALLET NO.', font: 20, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: '팔레트번호', p: 0x4ab, l: 13.91, t: 112.03, w: 182.56, h: 32.51, text: '1/3', font: 70, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: '공급업체라벨', p: 0x5f3, l: 19.84, t: 160.40, w: 182.56, h: 9.26, text: '공급업체', font: 18, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: '대림기업', p: 0x679, l: 19.84, t: 170.66, w: 182.56, h: 10.58, text: '대림기업', font: 20, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: '제품정보라벨', p: 0x879, l: 19.84, t: 188.52, w: 182.56, h: 10.25, text: '제품정보', font: 18, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: 'LOT 라벨', p: 0x8ff, l: 19.84, t: 198.11, w: 30.96, h: 12.96, text: 'LOT NO.', font: 20, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: 'LOT 값', p: 0x98b, l: 56.88, t: 198.11, w: 140.49, h: 12.96, text: '260914', font: 20, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: '생산일자라벨', p: 0xa15, l: 19.84, t: 210.34, w: 30.96, h: 12.96, text: '생산일자.', font: 20, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: '생산일자값', p: 0xa9d, l: 56.88, t: 210.34, w: 140.49, h: 12.96, text: '260917', font: 20, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: '수량라벨', p: 0xb27, l: 19.84, t: 222.58, w: 30.96, h: 12.96, text: '수     량.', font: 20, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: '수량값', p: 0xbb5, l: 56.88, t: 222.58, w: 140.49, h: 12.96, text: '60박스(1800개)', font: 20, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: '납품처라벨', p: 0x6ff, l: 19.84, t: 243.75, w: 182.56, h: 10.25, text: '납품처', font: 18, border: 0.2, align: 'center', bold: true },
    { type: 'text', name: '납품처값', p: 0x783, l: 19.84, t: 254.33, w: 182.56, h: 12.85, text: '에이치엘비글로벌(주)', font: 20, border: 0.2, align: 'center', bold: true },
];

console.log('Known elements parsed: ', knownElements.length);

// HTML 생성
let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 20px; background: #555; display: flex; justify-content: center; }
  .page {
    width: 210mm;
    height: 297mm;
    background: white;
    position: relative;
    box-shadow: 0 0 10px rgba(0,0,0,0.5);
    font-family: 'Malgun Gothic', '맑은 고딕', sans-serif;
  }
  .elem {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    line-height: 1.15;
    word-break: break-all;
  }
</style>
</head>
<body>
<div class="page">
`;

for (const el of knownElements) {
    let borderCss = el.border ? `border: ${el.border}mm solid black;` : '';
    let fontCss = el.font ? `font-size: ${el.font}pt; font-weight: ${el.bold ? 'bold' : 'normal'};` : '';
    let alignCss = el.align === 'center' ? 'text-align: center;' : 'text-align: left;';
    html += `  <div class="elem" style="left: ${el.l}mm; top: ${el.t}mm; width: ${el.w}mm; height: ${el.h}mm; ${borderCss} ${fontCss} ${alignCss}">
    ${el.text || ''}
  </div>\n`;
}

html += `</div>
</body>
</html>`;

fs.writeFileSync('scripts/rendered_dgf.html', html);
console.log('Saved to scripts/rendered_dgf.html');
