// 본사 원료수불부 엑셀 파싱 스크립트 (honsa_raw_ledger.xlsx → rawLedgerFull.json 병합)
const xlsx = require('xlsx');
const fs   = require('fs');

const HONSA_XLSX  = 'C:\\code\\daelim-wms\\honsa_raw_ledger.xlsx';
const LEDGER_JSON = 'C:\\code\\daelim-wms\\src\\data\\rawLedgerFull.json';
const ENTERPRISE  = 'C:\\code\\daelim-wms\\src\\data\\enterpriseData.json';

const wb = xlsx.readFile(HONSA_XLSX);
const enterprise = JSON.parse(fs.readFileSync(ENTERPRISE, 'utf8'));
const masterList = enterprise.master || [];

// 문자열 정규화 (품목명 매칭용)
const norm = s => String(s || '').trim().toLowerCase().replace(/[\s\-_()\\/]/g, '');

// 날짜 셀 파싱 헬퍼
function parseDateCell(val, formattedText) {
    if (formattedText && /^\d{4}-\d{2}-\d{2}$/.test(formattedText.trim())) {
        return formattedText.trim();
    }
    if (typeof val === 'number') {
        const d = xlsx.SSF.parse_date_code(val);
        if (d) {
            const y   = d.y;
            const m   = String(d.m).padStart(2, '0');
            const day = String(d.d).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
    }
    if (typeof val === 'string') {
        const cleaned = val.trim().replace(/\./g, '-');
        const match   = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (match) {
            return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
        }
    }
    return '';
}

const newEntries   = [];
const itemSummary  = [];
// 목차/빈시트 제외 (시트명 '1' 은 빈 목차)
const skipSheets   = new Set(['1']);

for (const sheetName of wb.SheetNames) {
    if (skipSheets.has(sheetName)) continue;

    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;
    const range = xlsx.utils.decode_range(ws['!ref']);

    let headerRow = -1;
    let colMap    = {};

    // 헤더 행 탐색 (상위 12행 이내에서 '날자/일자/날짜' 포함 행 찾기)
    for (let R = range.s.r; R <= Math.min(range.e.r, 12); R++) {
        let foundDate  = false;
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
            } else if (str === '품명' || str === '적요' || str === '품명/적요' || str === '거래처/적요') {
                // '품명' 열이 있는 시트는 notes로 활용
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
            colMap    = tempColMap;
            break;
        }
    }

    if (headerRow === -1) {
        console.warn('헤더 행을 찾지 못한 시트 (건너뜀):', sheetName);
        continue;
    }

    // 마스터 품목 매칭
    const rawClean     = norm(sheetName);
    const matchedMaster = masterList.find(m => {
        const mClean    = norm(m.name);
        const codeClean = norm(m.code);
        return mClean === rawClean || mClean.includes(rawClean) || rawClean.includes(mClean) || codeClean === rawClean;
    });

    // 본사 전용 코드 접두어 HRAW-
    const defaultItemCode = matchedMaster
        ? matchedMaster.code
        : 'HRAW-' + sheetName.trim().replace(/[^a-zA-Z0-9가-힣]/g, '');

    let defaultSG          = 1.0;
    const entriesForSheet  = [];

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

        const rawDate     = getVal('date');
        const formattedDate = getFormatted('date');
        const dateStr     = parseDateCell(rawDate, formattedDate);

        const notes       = String(getVal('notes') || '').trim();
        const rawIn       = getVal('inQty');
        const rawOut      = getVal('outQty');
        const rawStock    = getVal('stockQty');
        const rawWeight   = getVal('weight');
        const rawSg       = getVal('sg');
        const rawDm       = getVal('dm');
        const rawUnitPrice = getVal('unitPrice');
        const rawRemark   = getVal('remark');

        // 빈 행 건너뛰기
        if (!dateStr && !notes && rawIn === undefined && rawOut === undefined && rawStock === undefined) continue;

        const inQty      = typeof rawIn    === 'number' ? rawIn    : (parseFloat(rawIn)    || 0);
        const outQty     = typeof rawOut   === 'number' ? rawOut   : (parseFloat(rawOut)   || 0);
        const stockQty   = typeof rawStock === 'number' ? rawStock : (parseFloat(rawStock) || 0);
        const weight     = typeof rawWeight === 'number' ? rawWeight : (parseFloat(rawWeight) || 0);
        const sg         = typeof rawSg    === 'number' ? rawSg    : (parseFloat(rawSg)    || 1.0);
        if (sg > 0) defaultSG = sg;
        const dm         = typeof rawDm   === 'number' ? rawDm   : (parseFloat(rawDm)   || 0);
        const unitPrice  = typeof rawUnitPrice === 'number' ? rawUnitPrice : (parseFloat(rawUnitPrice) || 0);
        const remark     = String(rawRemark || '').trim();

        let type = String(getVal('type') || '').trim();
        if (!type) {
            if (inQty > 0 && outQty === 0)       type = '입고';
            else if (outQty > 0 && inQty === 0)  type = '출고';
            else                                  type = '수불';
        }

        const entry = {
            // 본사 데이터는 'HONSA-' 접두어로 ID 충돌 방지
            id:         'honsa-' + sheetName.trim() + '-' + R + '-' + (dateStr || 'nodate'),
            date:       dateStr || '2024-01-01',
            type:       type,
            location:   '본사',      // ← 지역구분: 본사
            code:       defaultItemCode,
            itemCode:   defaultItemCode,
            name:       sheetName.trim(),
            itemName:   sheetName.trim(),
            notes:      notes,
            inQty:      inQty,
            outQty:     outQty,
            stockQty:   stockQty,
            weight:     weight,
            sg:         sg,
            dm:         dm,
            unitPrice:  unitPrice,
            remark:     remark,
            worker:     '관리자',
            createdAt:  dateStr ? `${dateStr}T09:00:00Z` : new Date().toISOString()
        };
        entriesForSheet.push(entry);
        newEntries.push(entry);
    }

    itemSummary.push({
        name:          sheetName.trim(),
        itemCode:      defaultItemCode,
        location:      '본사',
        rows:          entriesForSheet.length,
        defaultSG:     defaultSG,
        finalDate:     entriesForSheet.length > 0 ? entriesForSheet[entriesForSheet.length - 1].date    : '',
        finalStock:    entriesForSheet.length > 0 ? entriesForSheet[entriesForSheet.length - 1].stockQty : 0,
        finalWeight:   entriesForSheet.length > 0 ? entriesForSheet[entriesForSheet.length - 1].weight   : 0,
        matchedInMaster: !!matchedMaster
    });

    if (entriesForSheet.length > 0) {
        console.log(`  [${sheetName}] 코드=${defaultItemCode}, 건수=${entriesForSheet.length}, 마스터매칭=${!!matchedMaster}`);
    }
}

console.log('\n본사 처리 품목(시트) 수:', itemSummary.length);
console.log('본사 추출 수불 내역 수:', newEntries.length);

// ─── 기존 rawLedgerFull.json (김포 데이터) 에 본사 데이터 병합 ───────────────
const existing = JSON.parse(fs.readFileSync(LEDGER_JSON, 'utf8'));
const existingEntries = (existing.entries || []).filter(e => e.location !== '본사'); // 기존 본사 데이터 중복 방지
const existingSummary = (existing.summary || []).filter(s => s.location !== '본사');

const mergedEntries = [...existingEntries, ...newEntries];
const mergedSummary = [...existingSummary, ...itemSummary];

fs.writeFileSync(LEDGER_JSON, JSON.stringify({
    summary: mergedSummary,
    entries: mergedEntries
}, null, 2), 'utf8');

console.log(`\nrawLedgerFull.json 병합 완료!`);
console.log(`  김포 건수: ${existingEntries.length}`);
console.log(`  본사 건수: ${newEntries.length}`);
console.log(`  합계 건수: ${mergedEntries.length}`);

// ─── enterpriseData.master에 본사 신규 원료 등록 ────────────────────────────
let masterAdded = 0;
for (const s of itemSummary) {
    const exists = enterprise.master.some(m =>
        m.name.trim().toLowerCase() === s.name.toLowerCase() || m.code === s.itemCode
    );
    if (!exists) {
        enterprise.master.push({
            code:        s.itemCode,
            name:        s.name,
            category:    '원료',
            subCategory: '원료수불부',
            spec:        s.defaultSG ? `비중: ${s.defaultSG}` : '드럼/벌크',
            unit:        'L',
            supplier:    '본사(원료)',
            safety:      100,
            imageUrl:    ''
        });
        masterAdded++;
    }
}

if (masterAdded > 0) {
    fs.writeFileSync(ENTERPRISE, JSON.stringify(enterprise, null, 2), 'utf8');
    console.log(`\nenterpriseData.master 에 본사 신규 원료 ${masterAdded}개 등록 완료! (총 품목수: ${enterprise.master.length})`);
} else {
    console.log('\n신규 마스터 등록 없음 (모두 기존 품목과 매칭됨)');
}
