import fs from 'fs';

// DGF에서 추출한 21개 오브젝트의 실측 데이터
const items = [
  { id: 'outer', l: 6.92, t: 7.7, w: 196.55, h: 279.32, border: 0.2, stroke: '#000', fill: 'none' },
  { id: 'title_box', l: 13.91, t: 13.0, w: 182.56, h: 34.4, border: 0.2, stroke: '#000', fill: '#fff', text: '파렛트 식별표', font: 50, bold: true, align: 'middle' },
  { id: 'body_box', l: 9.94, t: 52.68, w: 190.5, h: 230.57, border: 0.2, stroke: '#000', fill: 'none' },
  { id: 'prod_box', l: 13.85, t: 57.94, w: 182.56, h: 34.66, border: 0.2, stroke: '#000', fill: '#fff', text: '카밈 가솔린 촉매 산소센서 클리너 프로 0.3L', font: 35, bold: true, align: 'middle' },
  { id: 'plt_bg', l: 18.82, t: 98.04, w: 172.74, h: 51.4, border: 0.2, stroke: '#000', fill: '#d9d9d9' },
  { id: 'plt_lbl', l: 13.91, t: 103.33, w: 182.56, h: 15.5, text: 'PALLET NO.', font: 20, bold: true, align: 'middle' },
  { id: 'plt_val', l: 13.91, t: 112.03, w: 182.56, h: 32.51, text: '1/3', font: 70, bold: true, align: 'middle' },
  
  { id: 'supp_box', l: 16.85, t: 151.85, w: 176.69, h: 29.39, border: 0.2, stroke: '#000', fill: '#fff' }, // 공급업체 전체 영역
  { id: 'supp_lbl', l: 19.84, t: 160.4, w: 182.56, h: 9.26, text: '공급업체', font: 18, bold: true, align: 'middle' },
  { id: 'supp_val', l: 19.84, t: 170.66, w: 182.56, h: 10.58, text: '대림기업', font: 20, bold: true, align: 'middle' },
  
  { id: 'info_box', l: 16.85, t: 179.9, w: 176.69, h: 55.65, border: 0.2, stroke: '#000', fill: '#fff' }, // 제품정보 전체 영역
  { id: 'info_lbl', l: 19.84, t: 188.52, w: 182.56, h: 10.25, text: '제품정보', font: 18, bold: true, align: 'middle' },
  { id: 'lot_lbl', l: 19.84, t: 198.11, w: 30.96, h: 12.96, border: 0.2, stroke: '#000', fill: '#fff', text: 'LOT NO.', font: 20, bold: true, align: 'middle' },
  { id: 'lot_val', l: 56.88, t: 198.11, w: 140.49, h: 12.96, border: 0.2, stroke: '#000', fill: '#fff', text: '260914', font: 20, bold: true, align: 'middle' },
  { id: 'date_lbl', l: 19.84, t: 210.34, w: 30.96, h: 12.96, border: 0.2, stroke: '#000', fill: '#fff', text: '생산일자.', font: 20, bold: true, align: 'middle' },
  { id: 'date_val', l: 56.88, t: 210.34, w: 140.49, h: 12.96, border: 0.2, stroke: '#000', fill: '#fff', text: '260917', font: 20, bold: true, align: 'middle' },
  { id: 'qty_lbl', l: 19.84, t: 222.58, w: 30.96, h: 12.96, border: 0.2, stroke: '#000', fill: '#fff', text: '수     량.', font: 20, bold: true, align: 'middle' },
  { id: 'qty_val', l: 56.88, t: 222.58, w: 140.49, h: 12.96, border: 0.2, stroke: '#000', fill: '#fff', text: '60박스(1800개)', font: 20, bold: true, align: 'middle' },
  
  { id: 'cust_box', l: 16.85, t: 234.71, w: 176.69, h: 32.47, border: 0.2, stroke: '#000', fill: '#fff' }, // 납품처 전체 영역
  { id: 'cust_lbl', l: 19.84, t: 243.75, w: 182.56, h: 10.25, text: '납품처', font: 18, bold: true, align: 'middle' },
  { id: 'cust_val', l: 19.84, t: 254.33, w: 182.56, h: 12.85, text: '에이치엘비글로벌(주)', font: 20, bold: true, align: 'middle' }
];

// SVG 생성 (210mm x 297mm)
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm" style="background:#fff; font-family:'Malgun Gothic', '맑은 고딕', sans-serif;">
`;

for (const item of items) {
    if (item.stroke || (item.fill && item.fill !== 'none')) {
        svg += `  <rect x="${item.l}" y="${item.t}" width="${item.w}" height="${item.h}" fill="${item.fill || 'none'}" stroke="${item.stroke || 'none'}" stroke-width="${item.border || 0.2}" />\n`;
    }
    if (item.text) {
        // text position: center of box
        let cx = item.l + item.w / 2;
        let cy = item.t + item.h / 2;
        // pt to mm: 1pt = 0.3528mm
        let fontMm = (item.font * 0.3528).toFixed(2);
        svg += `  <text x="${cx}" y="${cy}" font-size="${fontMm}" font-weight="${item.bold ? 'bold' : 'normal'}" text-anchor="${item.align || 'middle'}" dominant-baseline="central" fill="#000">${item.text}</text>\n`;
    }
}

svg += `</svg>`;

fs.writeFileSync('scripts/rendered_dgf.svg', svg);
console.log('Saved to scripts/rendered_dgf.svg');
