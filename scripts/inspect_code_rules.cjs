const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/code/daelim-wms/이카운트 ERP 품목코드 표준화 전환 프로젝트 - 산출물 작성.xlsx');
const sheet = wb.Sheets['02_코드매핑표'];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

const catMap = {};
for (let r = 4; r < data.length; r++) {
    const code = data[r][2];
    const cat = data[r][3];
    const type = data[r][4];
    if (!code || code === '삭제') continue;
    const p = String(code).slice(0, 1);
    if (!catMap[p]) catMap[p] = new Set();
    catMap[p].add(cat + ' / ' + type);
}

for (const [k, v] of Object.entries(catMap)) {
    console.log(`Prefix '${k}':`, Array.from(v));
}
