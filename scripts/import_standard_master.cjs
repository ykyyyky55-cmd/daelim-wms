const XLSX = require('xlsx');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hapvzqyfikctcbxurxal.supabase.co';
const SUPABASE_KEY = 'sb_publishable_WqQPzXzumRkVSWfT_CZuaw_V9XCnxYx';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const filePath = 'C:/code/daelim-wms/이카운트 ERP 품목코드 표준화 전환 프로젝트 - 산출물 작성.xlsx';
const wb = XLSX.readFile(filePath);
const sheet = wb.Sheets['02_코드매핑표'];
const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

const items = [];
const codeMap = new Map(); // oldCode -> newCode

for (let r = 4; r < rawData.length; r++) {
    const row = rawData[r];
    if (!row || row.length === 0) continue;
    const oldCode = row[0] ? String(row[0]).trim() : '';
    const oldName = row[1] ? String(row[1]).trim() : '';
    const code = row[2] ? String(row[2]).trim() : '';
    const excelCat = row[3] ? String(row[3]).trim() : '';
    const itemType = row[4] ? String(row[4]).trim() : '';
    const name = row[5] ? String(row[5]).trim() : '';
    const spec = row[6] ? String(row[6]).trim() : '';
    const unit = row[10] ? String(row[10]).trim() : 'EA';
    const supplier = row[11] ? String(row[11]).trim() : '';

    if (!code || code === '삭제' || code.includes('N/A') || !/^[0-9A-Za-z]/.test(code)) {
        continue;
    }
    if (name.includes('사용중단') || name.includes('삭제')) {
        continue;
    }

    if (oldCode && oldCode !== '신규' && oldCode !== code) {
        codeMap.set(oldCode, code);
    }

    // WMS 대분류 & 중분류 매핑
    let category = '기타';
    let subCategory = '기타';

    if (code.startsWith('1')) {
        category = '완제품';
        if (supplier === '자사' || name.includes('대림') || excelCat.includes('자사')) {
            subCategory = '자사제품';
        } else {
            subCategory = 'ODM 제품';
        }
    } else if (code.startsWith('5')) {
        category = '원액';
        if (excelCat.includes('엔진오일') || name.toLowerCase().includes('oil') || name.includes('오일') || /0w|5w|10w/i.test(name)) {
            subCategory = '엔진오일';
        } else if (excelCat.includes('코팅') || name.includes('코팅')) {
            subCategory = '엔진코팅제';
        } else if (excelCat.includes('브레이크') || name.includes('브레이크') || name.includes('DOT')) {
            subCategory = '브레이크액';
        } else {
            subCategory = '첨가제';
        }
    } else if (code.startsWith('2')) {
        category = '부자재';
        if (excelCat.includes('라벨') || name.includes('라벨') || name.includes('스티커')) {
            subCategory = '라벨';
        } else if (excelCat.includes('아웃박스') || name.includes('아웃박스') || name.includes('카톤')) {
            subCategory = '아웃박스';
        } else if (excelCat.includes('인박스') || name.includes('인박스')) {
            subCategory = '인박스';
        } else if (name.includes('용기') || name.includes('말통') || name.includes('캔') || name.includes('보틀') || name.includes('드럼')) {
            subCategory = '용기';
        } else {
            subCategory = '기타';
        }
    } else if (code.startsWith('3') || code.startsWith('6')) {
        category = '원료';
        if (name.startsWith('BO') || excelCat.includes('기유') || name.includes('base oil') || name.includes('Base Oil')) {
            subCategory = 'BO';
        } else if (name.startsWith('AC') || excelCat.includes('촉매')) {
            subCategory = 'AC';
        } else if (name.startsWith('EP') || excelCat.includes('극압')) {
            subCategory = 'EP';
        } else {
            subCategory = 'AD';
        }
    }

    items.push({
        code,
        name: name || code,
        category,
        subCategory,
        spec: spec || '-',
        supplier: supplier || '-',
        unit: unit || 'EA',
        safety: 50
    });
}

console.log(`[Import] Total standardized items extracted: ${items.length}`);
console.log(`[Import] Old-to-New code mappings found: ${codeMap.size}`);

async function run() {
    // 1. Update enterpriseData.json
    const entPath = 'src/data/enterpriseData.json';
    const enterpriseData = JSON.parse(fs.readFileSync(entPath, 'utf8'));

    let newCount = 0;
    let updatedCount = 0;

    for (const item of items) {
        const existingIdx = enterpriseData.master.findIndex(m => m.code === item.code);
        if (existingIdx >= 0) {
            enterpriseData.master[existingIdx] = {
                ...enterpriseData.master[existingIdx],
                ...item
            };
            updatedCount++;
        } else {
            enterpriseData.master.push(item);
            newCount++;
        }
    }

    fs.writeFileSync(entPath, JSON.stringify(enterpriseData, null, 2), 'utf8');
    console.log(`[enterpriseData.json] Saved! Total master: ${enterpriseData.master.length} (New: ${newCount}, Updated: ${updatedCount})`);

    // 2. Upsert into Supabase wms_master_items table in chunks of 100
    console.log('[Supabase] Starting upsert into wms_master_items...');
    const CHUNK_SIZE = 100;
    let supaSuccessCount = 0;

    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE).map(it => ({
            code: it.code,
            name: it.name,
            category: it.category,
            supplier: it.supplier,
            spec: it.spec,
            unit: it.unit,
            safety: it.safety
        }));

        const { data, error } = await supabase.from('wms_master_items').upsert(chunk, { onConflict: 'code' });
        if (error) {
            console.error(`[Supabase Error in chunk ${i}]:`, error);
        } else {
            supaSuccessCount += chunk.length;
            console.log(`[Supabase] Upserted chunk ${i + 1} ~ ${Math.min(i + CHUNK_SIZE, items.length)} (${supaSuccessCount}/${items.length})`);
        }
    }

    console.log(`[Supabase] All done! Total successfully upserted: ${supaSuccessCount}`);
}

run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
