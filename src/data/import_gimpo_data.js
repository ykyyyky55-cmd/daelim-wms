import * as xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

console.log('=== 김포공장 8월 & 9월 생산공급망 업무일지 통합 데이터 추출 시작 ===');

const file8Path = path.resolve('(김포)8월 생산공급망 업무일지.xlsx');
const file9Path = path.resolve('(김포)9월 생산공급망 업무일지.xlsx');

const buf8 = fs.readFileSync(file8Path);
const wb8 = xlsx.read(buf8, { type: 'buffer' });

const buf9 = fs.readFileSync(file9Path);
const wb9 = xlsx.read(buf9, { type: 'buffer' });

// 1. 날짜 헬퍼
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

// 2. 마스터 추출 (제품, 라벨, 원액)
function extractMaster(wb, sheetName, defaultCategory, type) {
    const ws = wb.Sheets[sheetName];
    if (!ws) return [];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
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

// 3. 9월 파일의 '품목마스터(전체)' 추출 (2,500+개)
function extractMasterAll(wb) {
    const ws = wb.Sheets['품목마스터(전체)'];
    if (!ws) return [];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const items = [];

    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        // 열 A: 전 품목코드 (예: "1AA40001 / 썸오일 2T 엔진오일 | 0.5L")
        const colA = String(r[0] || '').trim();
        if (colA && colA.includes('/')) {
            const parts = colA.split('/');
            const code = parts[0].trim();
            const rest = parts.slice(1).join('/').trim();
            let name = rest;
            let spec = '';
            if (rest.includes('|')) {
                const subParts = rest.split('|');
                name = subParts[0].trim();
                spec = subParts[1].trim();
            }
            if (code && name) {
                items.push({
                    code,
                    name,
                    spec: spec || '규격',
                    category: code.startsWith('1AA') || code.startsWith('2AA') ? '엔진오일' : (code.startsWith('1AH') || code.startsWith('2AH') ? '브레이크액' : '완제품'),
                    type: 'PRODUCT',
                    unit: 'EA',
                    supplier: '대림오일(김포)',
                    safety_stock: 50,
                    unit_price: 12000,
                    notes: colA
                });
            }
        }

        // 열 B: 원부자재 (예: "0AC40005 / 울트라날린 옥탄부스터 550ml 라벨 | 190*133")
        const colB = String(r[1] || '').trim();
        if (colB && colB.includes('/')) {
            const parts = colB.split('/');
            const code = parts[0].trim();
            const rest = parts.slice(1).join('/').trim();
            let name = rest;
            let spec = '';
            if (rest.includes('|')) {
                const subParts = rest.split('|');
                name = subParts[0].trim();
                spec = subParts[1].trim();
            }
            if (code && name) {
                const isLabel = name.includes('라벨') || spec.includes('*');
                const isBox = name.includes('박스');
                items.push({
                    code,
                    name,
                    spec: spec || (isLabel ? '라벨' : (isBox ? '박스' : '부자재')),
                    category: isLabel ? '라벨' : (isBox ? '포장박스' : '부자재'),
                    type: isLabel ? 'LABEL' : 'SUB_MATERIAL',
                    unit: 'EA',
                    supplier: '브릿지엠/외주',
                    safety_stock: 100,
                    unit_price: isLabel ? 150 : 850,
                    notes: colB
                });
            }
        }
    }
    return items;
}

// 4. 일일 시트 파싱
function parseDailySheet(wb, sheetName, defaultYear = '2026') {
    const ws = wb.Sheets[sheetName];
    if (!ws) return null;
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

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
        dateStr = `${defaultYear}-${mm}-${dd}`;
    }

    let manager = '최용화';
    let reviewer = '윤경용';
    let approver = '승인';
    if (rows[1]) {
        manager = String(rows[1][8] || manager).trim();
        reviewer = String(rows[1][9] || reviewer).trim();
        approver = String(rows[1][10] || approver).trim();
    }

    const logData = {
        sheetName,
        date: dateStr,
        month: dateStr.slice(5, 7),
        manager,
        reviewer,
        approver,
        packaging: [],
        labeling: [],
        oilBlending: [],
        shipping: [],
        receiving: [],
        movement: [],
        courier: [],
        otherNotes: [],
        otherTasks: []
    };

    let currentSection = null;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        const c0 = String(row[0] || '').trim();

        if (c0.startsWith('■ 제품포장작업')) { currentSection = 'packaging'; continue; }
        if (c0.startsWith('■ 라벨부착작업')) { currentSection = 'labeling'; continue; }
        if (c0.startsWith('■ 원액생산작업')) { currentSection = 'oilBlending'; continue; }
        if (c0.startsWith('■ 출고내역')) { currentSection = 'shipping'; continue; }
        if (c0.startsWith('■ 입고내역')) { currentSection = 'receiving'; continue; }
        if (c0.startsWith('■ 이동제품')) { currentSection = 'movement'; continue; }
        if (c0.startsWith('■ 택배출고현황')) { currentSection = 'courier_other'; continue; }
        if (c0.startsWith('■ 기타업무')) { currentSection = 'otherTasks'; continue; }

        if (c0.includes('총수량') || c0.includes('합계')) continue;

        if (c0 === '품명' || c0 === '구분' || c0 === '업무명' || c0 === '날짜' || c0 === '') {
            if (currentSection === 'courier_other') {
                const note = String(row[4] || '').trim();
                if (note && note !== '■ 기타') {
                    logData.otherNotes.push(note.replace(/^-\s*/, ''));
                }
            }
            continue;
        }

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

// 8월 일일 시트들
const dailySheets8 = wb8.SheetNames.filter(name => /^\d{4}$/.test(name)).sort();
const logs8 = dailySheets8.map(s => parseDailySheet(wb8, s, '2026')).filter(Boolean);
console.log(`8월 일일 일지 파싱 완료: ${logs8.length}일치`);

// 9월 일일 시트들
const dailySheets9 = wb9.SheetNames.filter(name => /^\d{4}$/.test(name)).sort();
const logs9 = dailySheets9.map(s => parseDailySheet(wb9, s, '2026')).filter(Boolean);
console.log(`9월 일일 일지 파싱 완료: ${logs9.length}일치`);

// 전체 일지 통합 및 날짜 역순 정렬
const allLogs = [...logs9, ...logs8].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
console.log(`총 통합 일지: ${allLogs.length}일치`);

// 마스터 데이터 통합
const prod8 = extractMaster(wb8, '품목마스터(제품)', '완제품', 'PRODUCT');
const prod9 = extractMaster(wb9, '품목마스터(제품)', '완제품', 'PRODUCT');
const label8 = extractMaster(wb8, '품목마스터(라벨)', '부자재', 'LABEL');
const label9 = extractMaster(wb9, '품목마스터(라벨)', '부자재', 'LABEL');
const oil8 = extractMaster(wb8, '품목마스터(원액)', '원료', 'OIL');
const oil9 = extractMaster(wb9, '품목마스터(원액)', '원료', 'OIL');
const allMasterList = extractMasterAll(wb9);

const masterMap = new Map();
allMasterList.forEach(m => masterMap.set(m.code, m));
[...prod8, ...prod9, ...label8, ...label9, ...oil8, ...oil9].forEach(m => {
    masterMap.set(m.code, m);
});

console.log(`최종 마스터 품목 통합 건수: ${masterMap.size}종`);

// Data 시트 집계 통합
function extractDataSummary(wb) {
    const ws = wb.Sheets['Data'];
    if (!ws) return [];
    const rawData = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const list = [];
    for (let i = 1; i < rawData.length; i++) {
        const r = rawData[i];
        if (r.some(c => c !== '')) {
            list.push({
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
    return list;
}

const data8 = extractDataSummary(wb8);
const data9 = extractDataSummary(wb9);
const allDataSummary = [...data9, ...data8];
console.log(`Data 시트 행 수 (8월+9월): ${allDataSummary.length}건`);

// JSON 저장
const gimpoData = {
    generatedAt: new Date().toISOString(),
    masters: Array.from(masterMap.values()),
    dailyLogs: allLogs,
    dataSummary: allDataSummary
};

const outputPath = path.resolve('src/data/gimpoProductionData.json');
fs.writeFileSync(outputPath, JSON.stringify(gimpoData, null, 2), 'utf-8');
console.log(`저장 완료: ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB)`);
