import * as xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

const excelPath = path.resolve('(김포)8월 생산공급망 업무일지.xlsx');
console.log('Loading Excel:', excelPath);
const buf = fs.readFileSync(excelPath);
const wb = xlsx.read(buf, { type: 'buffer' });

// 1. 품목 마스터 추출
function extractMaster(sheetName, defaultCategory, type) {
    const ws = wb.Sheets[sheetName];
    if (!ws) return [];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const header = rows[0] || [];
    const items = [];

    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const code = String(r[0] || '').trim();
        const name = String(r[1] || '').trim();
        if (!code || !name) continue;

        let spec = String(r[3] || '').trim();
        let cat = defaultCategory;
        if (type === 'PRODUCT') {
            cat = String(r[4] || defaultCategory).trim() || defaultCategory;
        }

        items.push({
            code,
            name,
            spec: spec || (type === 'LABEL' ? '라벨' : 'L'),
            category: cat,
            type,
            unit: type === 'LABEL' ? 'EA' : (type === 'OIL' ? 'L' : 'EA'),
            supplier: '대림오일(김포)',
            safety_stock: 50,
            unit_price: type === 'LABEL' ? 150 : (type === 'OIL' ? 5000 : 12000),
            notes: String(r[2] || '').trim()
        });
    }
    return items;
}

const productMaster = extractMaster('품목마스터(제품)', '완제품', 'PRODUCT');
const labelMaster = extractMaster('품목마스터(라벨)', '부자재', 'LABEL');
const oilMaster = extractMaster('품목마스터(원액)', '원료', 'OIL');

console.log(`Extracted Masters -> Products: ${productMaster.length}, Labels: ${labelMaster.length}, Oils: ${oilMaster.length}`);

// 2. 일일 시트 파싱
const dailySheets = wb.SheetNames.filter(name => /^\d{4}$/.test(name)).sort();
console.log('Daily sheets count:', dailySheets.length);

function excelDateToDateStr(val) {
    if (!val) return '';
    if (typeof val === 'number') {
        const date = new Date(Math.round((val - 25569) * 86400 * 1000));
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const str = String(val).trim();
    const match = str.match(/(\d{4})[-\.\/](\d{1,2})[-\.\/](\d{1,2})/);
    if (match) {
        return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
    }
    return str;
}

function parseDailySheet(sheetName) {
    const ws = wb.Sheets[sheetName];
    if (!ws) return null;
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // 날짜 구하기 (4행 또는 시트명 08XX 기반)
    let dateStr = '';
    for (let i = 0; i < 6; i++) {
        const r = rows[i] || [];
        for (let j = 0; j < r.length; j++) {
            if (String(r[j]).includes('날짜') && r[j + 1]) {
                dateStr = excelDateToDateStr(r[j + 1]);
                break;
            }
        }
        if (dateStr) break;
    }
    if (!dateStr) {
        const mm = sheetName.slice(0, 2);
        const dd = sheetName.slice(2, 4);
        dateStr = `2026-${mm}-${dd}`;
    }

    // 결재자
    let manager = '최용화';
    let reviewer = '윤경용';
    let approver = '';
    if (rows[1]) {
        manager = String(rows[1][8] || manager).trim();
        reviewer = String(rows[1][9] || reviewer).trim();
        approver = String(rows[1][10] || approver).trim();
    }

    const logData = {
        sheetName,
        date: dateStr,
        manager,
        reviewer,
        approver,
        packaging: [],    // 제품포장
        labeling: [],     // 라벨부착
        oilBlending: [],  // 원액생산
        shipping: [],     // 출고내역
        receiving: [],    // 입고내역
        movement: [],     // 이동제품
        courier: [],      // 택배출고
        otherNotes: [],   // 기타 특이사항
        otherTasks: []    // 기타업무
    };

    let currentSection = null;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        const c0 = String(row[0] || '').trim();
        const c1 = String(row[1] || '').trim();

        if (c0.startsWith('■ 제품포장작업')) { currentSection = 'packaging'; continue; }
        if (c0.startsWith('■ 라벨부착작업')) { currentSection = 'labeling'; continue; }
        if (c0.startsWith('■ 원액생산작업')) { currentSection = 'oilBlending'; continue; }
        if (c0.startsWith('■ 출고내역')) { currentSection = 'shipping'; continue; }
        if (c0.startsWith('■ 입고내역')) { currentSection = 'receiving'; continue; }
        if (c0.startsWith('■ 이동제품')) { currentSection = 'movement'; continue; }
        if (c0.startsWith('■ 택배출고현황')) { currentSection = 'courier_other'; continue; }
        if (c0.startsWith('■ 기타업무')) { currentSection = 'otherTasks'; continue; }

        if (c0.includes('총수량') || c0.includes('합계')) {
            continue;
        }

        // 헤더 행 건너뛰기
        if (c0 === '품명' || c0 === '구분' || c0 === '업무명' || c0 === '날짜' || c0 === '') {
            // 단, courier_other 섹션에서는 c4 등에 기타 특이사항이 있을 수 있음
            if (currentSection === 'courier_other') {
                const note = String(row[4] || '').trim();
                if (note && note !== '■ 기타') {
                    logData.otherNotes.push(note.replace(/^-\s*/, ''));
                }
            }
            continue;
        }

        // 데이터 파싱
        if (currentSection === 'packaging' && c0) {
            logData.packaging.push({
                item: c0,
                spec: String(row[1] || ''),
                qty: Number(row[2]) || 0,
                box: Number(row[3]) || 0,
                workHours: Number(row[4]) || 0,
                workersCount: Number(row[5]) || 0,
                totalWorkHours: Number(row[6]) || 0,
                line: String(row[7] || ''),
                lotNo: String(row[8] || ''),
                category: String(row[9] || '엔진오일'),
                manHours: Number(Number(row[10] || 0).toFixed(2)),
                workers: String(row[11] || '')
            });
        } else if (currentSection === 'labeling' && c0) {
            logData.labeling.push({
                item: c0,
                spec: String(row[1] || ''),
                qty: Number(row[2]) || 0,
                box: Number(row[3]) || 0,
                workHours: Number(row[4]) || 0,
                workersCount: Number(row[5]) || 0,
                totalWorkHours: Number(row[6]) || 0,
                line: String(row[7] || ''),
                lotNo: String(row[8] || ''),
                category: String(row[9] || ''),
                manHours: Number(Number(row[10] || 0).toFixed(2)),
                workers: String(row[11] || '')
            });
        } else if (currentSection === 'oilBlending' && c0) {
            logData.oilBlending.push({
                item: c0,
                spec: String(row[1] || 'L'),
                qty: Number(row[2]) || 0,
                packageType: String(row[3] || 'TOTE'),
                workHours: Number(row[4]) || 0,
                workersCount: Number(row[5]) || 0,
                totalWorkHours: Number(row[6]) || 0,
                line: String(row[7] || 'BT-2'),
                lotNo: String(row[8] || ''),
                category: String(row[9] || ''),
                manHours: Number(Number(row[10] || 0).toFixed(2))
            });
        } else if (currentSection === 'shipping' && c0) {
            logData.shipping.push({
                item: c0,
                spec: String(row[1] || ''),
                qty: Number(row[2]) || 0,
                box: String(row[3] || ''),
                partner: String(row[4] || ''),
                inspector: String(row[6] || ''),
                transport: String(row[7] || ''),
                notes: String(row[8] || '')
            });
        } else if (currentSection === 'receiving' && c0) {
            logData.receiving.push({
                item: c0,
                spec: String(row[1] || ''),
                qty: Number(row[2]) || 0,
                box: String(row[3] || ''),
                partner: String(row[4] || ''),
                inspector: String(row[6] || ''),
                notes: String(row[7] || '')
            });
        } else if (currentSection === 'movement' && c0) {
            logData.movement.push({
                item: c0,
                spec: String(row[1] || ''),
                unit: String(row[2] || 'EA'),
                qty: Number(row[3]) || 0,
                box: String(row[4] || ''),
                vehicle: String(row[5] || '3.5T'),
                driver: String(row[6] || ''),
                route: String(row[7] || '김포 -> 본사')
            });
        } else if (currentSection === 'courier_other') {
            const courierType = c0;
            const count = Number(row[1]) || 0;
            const courierNotes = String(row[2] || '');
            if (courierType && (count > 0 || courierNotes)) {
                logData.courier.push({ type: courierType, count, notes: courierNotes });
            }
            const note = String(row[4] || '').trim();
            if (note && note !== '■ 기타') {
                logData.otherNotes.push(note.replace(/^-\s*/, ''));
            }
        } else if (currentSection === 'otherTasks' && c0) {
            logData.otherTasks.push({
                task: c0,
                spec: String(row[1] || ''),
                qty: Number(row[2]) || 0,
                unit: String(row[3] || ''),
                workHours: Number(row[4]) || 0,
                workersCount: Number(row[5]) || 0,
                totalWorkHours: Number(row[6]) || 0,
                worker: String(row[7] || ''),
                manHours: Number(Number(row[10] || 0).toFixed(2))
            });
        }
    }

    return logData;
}

const allLogs = dailySheets.map(parseDailySheet).filter(Boolean);
console.log(`Successfully parsed ${allLogs.length} daily logs!`);

// 샘플 8월 31일 로그 확인
const log0831 = allLogs.find(l => l.sheetName === '0831');
console.log('Sample 0831 Packaging:', log0831?.packaging.length);
console.log('Sample 0831 OilBlending:', log0831?.oilBlending.length);
console.log('Sample 0831 Movement:', log0831?.movement.length);
console.log('Sample 0831 Receiving:', log0831?.receiving.length);
console.log('Sample 0831 OtherTasks:', log0831?.otherTasks.length);

// 3. Data 시트 집계 추출
const dataWs = wb.Sheets['Data'];
let dataSummary = [];
if (dataWs) {
    const rawData = xlsx.utils.sheet_to_json(dataWs, { header: 1, defval: '' });
    for (let i = 1; i < rawData.length; i++) {
        const r = rawData[i];
        if (r.some(c => c !== '')) {
            dataSummary.push({
                date: excelDateToDateStr(r[0]),
                type: String(r[1] || ''),
                dept: String(r[2] || ''),
                item: String(r[3] || ''),
                spec: String(r[4] || ''),
                qty: Number(r[5]) || 0,
                workersCount: Number(r[6]) || 0,
                workHours: Number(r[7]) || 0,
                line: String(r[8] || ''),
                category: String(r[9] || ''),
                notes: String(r[10] || '')
            });
        }
    }
}
console.log(`Data Sheet Rows extracted: ${dataSummary.length}`);

// 4. JSON 파일 저장
const gimpoData = {
    generatedAt: new Date().toISOString(),
    masters: {
        products: productMaster,
        labels: labelMaster,
        oils: oilMaster
    },
    dailyLogs: allLogs,
    dataSummary: dataSummary
};

const outputPath = path.resolve('src/data/gimpoProductionData.json');
fs.writeFileSync(outputPath, JSON.stringify(gimpoData, null, 2), 'utf-8');
console.log(`Saved structured data to: ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB)`);
