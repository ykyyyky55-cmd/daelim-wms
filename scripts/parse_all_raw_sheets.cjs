const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const wbPath = 'C:\\code\\daelim-wms\\gimpo_raw_ledger.xlsx';
const wb = xlsx.readFile(wbPath);

// 기존 마스터 품목 로드
const enterprise = JSON.parse(fs.readFileSync('C:\\code\\daelim-wms\\src\\data\\enterpriseData.json', 'utf8'));
const masterList = enterprise.master || [];

// 문자열 정규화 (품목명 매칭용)
const norm = s => String(s || '').trim().toLowerCase().replace(/[\s\-_()\/]/g, '');

const allLedgerEntries = [];
const itemSummary = [];

// 날짜 셀 파싱 헬퍼 함수
function parseDateCell(val, formattedText) {
    if (formattedText && /^\d{4}-\d{2}-\d{2}$/.test(formattedText.trim())) {
        return formattedText.trim();
    }
    if (typeof val === 'number') {
        const d = xlsx.SSF.parse_date_code(val);
        if (d) {
            const y = d.y;
            const m = String(d.m).padStart(2, '0');
            const day = String(d.d).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
    }
    if (typeof val === 'string') {
        const cleaned = val.trim().replace(/\./g, '-');
        const match = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (match) {
            return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
        }
    }
    return '';
}

for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;
    const range = xlsx.utils.decode_range(ws['!ref']);

    let headerRow = -1;
    let colMap = {};

    // 헤더 행 탐색
    for (let R = range.s.r; R <= Math.min(range.e.r, 12); R++) {
        let foundDate = false;
        let tempColMap = {};
        for (let C = range.s.c; C <= range.e.c; C++) {
            const cell = ws[xlsx.utils.encode_cell({ r: R, c: C })];
            if (!cell || cell.v === undefined) continue;
            const str = String(cell.v).trim().replace(/\s+/g, '');
            if (str === '날자' || str === '일자' || str === '날짜') {
                foundDate = true;
                tempColMap['date'] = C;
            } else if (str === '분류' || str === '구분') {
                tempColMap['type'] = C;
            } else if (str === '적요' || str === '품명/적요' || str === '거래처/적요') {
                tempColMap['notes'] = C;
            } else if (str === '수' || str === '입고' || str === '입고량') {
                tempColMap['inQty'] = C;
            } else if (str === '불' || str === '출고' || str === '출고량' || str === '사용량') {
                tempColMap['outQty'] = C;
            } else if (str.startsWith('재고')) {
                tempColMap['stockQty'] = C;
            } else if (str === 'KG' || str === 'G' || str === '중량' || str === '재고KG') {
                tempColMap['weight'] = C;
            } else if (str === 'SG' || str === '비중') {
                tempColMap['sg'] = C;
            } else if (str === 'D/M' || str === 'DM' || str === '드럼') {
                tempColMap['dm'] = C;
            } else if (str === '단가') {
                tempColMap['unitPrice'] = C;
            } else if (str === '비고') {
                tempColMap['remark'] = C;
            }
        }
        if (foundDate) {
            headerRow = R;
            colMap = tempColMap;
            break;
        }
    }

    if (headerRow === -1) {
        console.warn('헤더 행을 찾지 못한 시트:', sheetName);
        continue;
    }

    // 품목 마스터에서 매칭 시도
    const rawClean = norm(sheetName);
    let matchedMaster = masterList.find(m => {
        const mClean = norm(m.name);
        const codeClean = norm(m.code);
        return mClean === rawClean || mClean.includes(rawClean) || rawClean.includes(mClean) || codeClean === rawClean;
    });

    // 특수 매칭 보정
    let defaultItemCode = '';
    if (sheetName === '그레핀') defaultItemCode = 'DP030006'; // 그래핀 파우더
    else if (sheetName === '용제9호(코코졸)') defaultItemCode = '6SV01004'; // 코코졸
    else if (matchedMaster) defaultItemCode = matchedMaster.code;
    else defaultItemCode = 'RAW-' + sheetName.trim().replace(/[^a-zA-Z0-9가-힣]/g, '');

    let defaultSG = 1.0;
    let entriesForThisSheet = [];

    for (let R = headerRow + 1; R <= range.e.r; R++) {
        const getVal = (colKey) => {
            if (colMap[colKey] === undefined) return undefined;
            const c = ws[xlsx.utils.encode_cell({ r: R, c: colMap[colKey] })];
            return c ? c.v : undefined;
        };
        const getFormatted = (colKey) => {
            if (colMap[colKey] === undefined) return undefined;
            const c = ws[xlsx.utils.encode_cell({ r: R, c: colMap[colKey] })];
            return c ? c.w : undefined;
        };

        const rawDate = getVal('date');
        const formattedDate = getFormatted('date');
        const dateStr = parseDateCell(rawDate, formattedDate);

        const notes = String(getVal('notes') || '').trim();
        const rawIn = getVal('inQty');
        const rawOut = getVal('outQty');
        const rawStock = getVal('stockQty');
        const rawWeight = getVal('weight');
        const rawSg = getVal('sg');
        const rawDm = getVal('dm');
        const rawUnitPrice = getVal('unitPrice');
        const rawRemark = getVal('remark');

        // 빈 행 건너뛰기
        if (!dateStr && !notes && rawIn === undefined && rawOut === undefined && rawStock === undefined) {
            continue;
        }

        const inQty = typeof rawIn === 'number' ? rawIn : (parseFloat(rawIn) || 0);
        const outQty = typeof rawOut === 'number' ? rawOut : (parseFloat(rawOut) || 0);
        const stockQty = typeof rawStock === 'number' ? rawStock : (parseFloat(rawStock) || 0);
        const weight = typeof rawWeight === 'number' ? rawWeight : (parseFloat(rawWeight) || 0);
        const sg = typeof rawSg === 'number' ? rawSg : (parseFloat(rawSg) || 1.0);
        if (sg > 0) defaultSG = sg;
        const dm = typeof rawDm === 'number' ? rawDm : (parseFloat(rawDm) || 0);
        const unitPrice = typeof rawUnitPrice === 'number' ? rawUnitPrice : (parseFloat(rawUnitPrice) || 0);
        const remark = String(rawRemark || '').trim();

        let type = String(getVal('type') || '').trim();
        if (!type) {
            if (inQty > 0 && outQty === 0) type = '입고';
            else if (outQty > 0 && inQty === 0) type = '출고';
            else type = '수불';
        }

        const entry = {
            id: 'raw-' + sheetName.trim() + '-' + R + '-' + (dateStr || 'nodate'),
            date: dateStr || '2024-01-01',
            type: type,
            code: defaultItemCode,
            itemCode: defaultItemCode,
            name: sheetName.trim(),
            itemName: sheetName.trim(),
            notes: notes,
            inQty: inQty,
            outQty: outQty,
            stockQty: stockQty,
            weight: weight,
            sg: sg,
            dm: dm,
            unitPrice: unitPrice,
            remark: remark,
            worker: '관리자',
            createdAt: dateStr ? `${dateStr}T09:00:00Z` : new Date().toISOString()
        };
        entriesForThisSheet.push(entry);
        allLedgerEntries.push(entry);
    }

    itemSummary.push({
        name: sheetName.trim(),
        itemCode: defaultItemCode,
        rows: entriesForThisSheet.length,
        defaultSG: defaultSG,
        finalStock: entriesForThisSheet.length > 0 ? entriesForThisSheet[entriesForThisSheet.length - 1].stockQty : 0,
        finalWeight: entriesForThisSheet.length > 0 ? entriesForThisSheet[entriesForThisSheet.length - 1].weight : 0,
        matchedInMaster: !!matchedMaster
    });
}

console.log('총 처리된 원료 품목(시트) 수:', itemSummary.length);
console.log('총 추출된 수불 내역 수:', allLedgerEntries.length);

// 파일 저장
fs.writeFileSync('C:\\code\\daelim-wms\\src\\data\\rawLedgerFull.json', JSON.stringify({
    summary: itemSummary,
    entries: allLedgerEntries
}, null, 2), 'utf8');

console.log('src/data/rawLedgerFull.json 생성 완료!');

// 품목 마스터(enterpriseData.json)에 없는 원료 품목 자동 추가
let masterAdded = 0;
for (const s of itemSummary) {
    const exists = enterprise.master.some(m => 
        m.name.trim().toLowerCase() === s.name.toLowerCase() ||
        m.code === s.itemCode
    );
    if (!exists) {
        const newItem = {
            code: s.itemCode,
            name: s.name,
            category: '원료',
            subCategory: '원료수불부',
            spec: s.defaultSG ? `비중: ${s.defaultSG}` : '드럼/벌크',
            unit: 'L',
            supplier: '김포공장(원료)',
            safety: 100,
            imageUrl: ''
        };
        enterprise.master.push(newItem);
        masterAdded++;
    }
}

if (masterAdded > 0) {
    fs.writeFileSync('C:\\code\\daelim-wms\\src\\data\\enterpriseData.json', JSON.stringify(enterprise, null, 2), 'utf8');
    console.log(`enterpriseData.master 에 신규 원료 ${masterAdded}개 품목 마스터 등록 완료! (총 품목수: ${enterprise.master.length})`);
}

