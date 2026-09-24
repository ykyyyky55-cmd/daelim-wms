/**
 * data01.xlsx 기준 품목 마스터 및 재고 정합성 동기화 스크립트
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hapvzqyfikctcbxurxal.supabase.co';
const SUPABASE_KEY = 'sb_publishable_WqQPzXzumRkVSWfT_CZuaw_V9XCnxYx';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const data01Path = path.resolve(__dirname, '../data01.xlsx');
const enterpriseDataPath = path.resolve(__dirname, '../src/data/enterpriseData.json');

if (!fs.existsSync(data01Path)) {
    console.error('data01.xlsx 파일을 찾을 수 없습니다.');
    process.exit(1);
}

const wb = XLSX.readFile(data01Path);
const sheetName = '재고실사_2026-09-24';
const ws = wb.Sheets[sheetName];
if (!ws) {
    console.error(`시트 [${sheetName}]가 존재하지 않습니다.`);
    process.exit(1);
}

const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
console.log(`[data01.xlsx] '${sheetName}' 시트 로드 완료, 총 ${grid.length}행`);

// 기존 마스터 로드 (공급처, 안전재고, 이미지 보존용)
const currentEnterprise = JSON.parse(fs.readFileSync(enterpriseDataPath, 'utf8'));
const currentMasterMap = new Map();
(currentEnterprise.master || []).forEach(m => currentMasterMap.set(m.code, m));

const newMaster = [];
const newInventory = [];
const seenCodes = new Set();

const locations = [
    { name: '본사 창고', colIdx: 8 },
    { name: '방산 창고', colIdx: 12 },
    { name: '김포공장', colIdx: 16 },
    { name: '대림오일 창고', colIdx: 20 }
];

const catCounts = {};
const subCounts = {};

for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const code = String(r[0] || '').trim();
    const rawCat = String(r[1] || '').trim();
    const rawSub = String(r[2] || '').trim();
    const name = String(r[3] || '').trim();
    const spec = String(r[4] || '').trim();
    const unit = String(r[5] || '').trim();

    if (!code || !name) continue;
    // 잘못된 테스트 품목 제외
    if (code === '1111111111111' || name.includes('테스트123')) {
        console.log(`[제외] 테스트 품목 제거: ${code} - ${name}`);
        continue;
    }
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);

    const existing = currentMasterMap.get(code);

    let category = rawCat;
    let subCategory = rawSub;

    // 대분류 및 중분류 표준화 체계 매핑
    if (category === '완제품') {
        if (subCategory === 'ODM제품' || subCategory === 'ODM') subCategory = 'ODM 제품';
        else if (subCategory === '자사제품' || subCategory === '자사') subCategory = '자사제품';
        else subCategory = (code.startsWith('1') ? (name.includes('ODM') ? 'ODM 제품' : '자사제품') : '자사제품');
    } else if (category === '원액') {
        if (!subCategory || subCategory === '원액') {
            if (code.startsWith('5AA')) subCategory = '엔진오일';
            else if (code.startsWith('5AB')) subCategory = '엔진코팅제';
            else if (code.startsWith('5AH') || name.includes('브레이크') || name.includes('DOT')) subCategory = '브레이크액';
            else subCategory = '첨가제';
        }
    } else if (category === '원료') {
        if (!subCategory) {
            if (code.startsWith('6BO') || code.startsWith('3BO')) subCategory = 'BO';
            else if (code.startsWith('6AC') || code.startsWith('3AC')) subCategory = 'AC';
            else if (code.startsWith('6AD') || code.startsWith('3AD')) subCategory = 'AD';
            else if (code.startsWith('6EP') || code.startsWith('3EP')) subCategory = 'EP';
            else subCategory = 'AD';
        }
    } else if (category === '부자재') {
        if (['라벨', '아웃박스', '인박스', '용기', '캡', '기타'].includes(subCategory)) {
            // 표준 유지
        } else {
            if (name.includes('라벨')) subCategory = '라벨';
            else if (name.includes('아웃박스') || name.includes('카톤')) subCategory = '아웃박스';
            else if (name.includes('인박스')) subCategory = '인박스';
            else if (name.includes('용기') || name.includes('말통') || name.includes('드럼')) subCategory = '용기';
            else if (name.includes('캡')) subCategory = '캡';
            else subCategory = '기타';
        }
    } else {
        // 미분류 항목 코드 기반 자동 분류
        if (code.startsWith('5')) {
            category = '원액';
            subCategory = '엔진오일';
        } else if (code.startsWith('1')) {
            category = '완제품';
            subCategory = '자사제품';
        } else if (code.startsWith('2') || name.includes('라벨') || name.includes('박스')) {
            category = '부자재';
            subCategory = name.includes('라벨') ? '라벨' : '기타';
        } else if (code.startsWith('3') || code.startsWith('6')) {
            category = '원료';
            subCategory = 'AD';
        } else {
            category = '기타';
            subCategory = '기타';
        }
    }

    const supplier = existing?.supplier || (rawSub.includes('자사') ? '자사' : (rawSub.includes('ODM') ? 'ODM' : '대림오일'));
    const safety = existing?.safety || (category === '원액' ? 200 : (category === '원료' ? 100 : 50));
    const imageUrl = existing?.imageUrl || '';

    const masterItem = {
        code,
        name,
        category,
        subCategory,
        spec: spec || '-',
        unit: unit || 'EA',
        supplier,
        safety,
        imageUrl
    };

    newMaster.push(masterItem);
    catCounts[category] = (catCounts[category] || 0) + 1;
    subCounts[subCategory] = (subCounts[subCategory] || 0) + 1;

    // 4개 거점 창고 재고 생성
    for (const loc of locations) {
        const rawQty = r[loc.colIdx];
        const qty = Number(rawQty) || 0;
        if (rawQty !== '' && qty !== 0) {
            newInventory.push({
                category,
                subCategory,
                code,
                name,
                supplier,
                spec: spec || '-',
                location: loc.name,
                quantity: qty,
                unit: unit || 'EA',
                status: '정상 보관',
                lastUpdated: '2026. 9. 24.'
            });
        }
    }
}

console.log(`\n========================================`);
console.log(`[data01.xlsx 기준 분석 결과]`);
console.log(`- 확정 마스터 품목 수: ${newMaster.length}건 (이전: ${currentEnterprise.master.length}건)`);
console.log(`- 제외된 잘못된/구형 품목: ${currentEnterprise.master.length - newMaster.length}건`);
console.log(`- 실사 재고 등록 수: ${newInventory.length}건`);
console.log(`- 대분류 분포:`, catCounts);
console.log(`========================================\n`);

// 1. enterpriseData.json 갱신
currentEnterprise.master = newMaster;
currentEnterprise.inventory = newInventory;
fs.writeFileSync(enterpriseDataPath, JSON.stringify(currentEnterprise, null, 2), 'utf8');
console.log(`✅ [1/2] src/data/enterpriseData.json 파일 갱신 완료!`);

// 2. Supabase 클라우드 DB 동기화
async function syncSupabase() {
    console.log(`🌐 [2/2] Supabase 클라우드 데이터베이스 동기화 시작...`);
    try {
        // 기존 마스터 아이템 전체 삭제 후 재등록
        console.log(`- 기존 Supabase wms_master_items 정리 중...`);
        const { error: delMasterErr } = await sb.from('wms_master_items').delete().neq('code', '___NONE___');
        if (delMasterErr) console.warn('wms_master_items 삭제 경고:', delMasterErr);

        // 신규 마스터 아이템 청크 삽입
        console.log(`- 신규 마스터 품목 ${newMaster.length}건 업로드 중...`);
        const CHUNK_SIZE = 100;
        for (let i = 0; i < newMaster.length; i += CHUNK_SIZE) {
            const chunk = newMaster.slice(i, i + CHUNK_SIZE).map(m => ({
                code: m.code,
                name: m.name,
                category: m.category,
                supplier: m.supplier,
                spec: m.spec,
                unit: m.unit,
                safety: m.safety
            }));
            const { error: insertErr } = await sb.from('wms_master_items').insert(chunk);
            if (insertErr) {
                console.error(`마스터 배치 ${i} 삽입 오류:`, insertErr);
            }
        }
        console.log(`✅ wms_master_items ${newMaster.length}건 Supabase 동기화 완료!`);

        // 기존 재고 정리 후 신규 재고 등록
        console.log(`- 기존 Supabase wms_inventory 정리 중...`);
        const { error: delInvErr } = await sb.from('wms_inventory').delete().neq('code', '___NONE___');
        if (delInvErr) console.warn('wms_inventory 삭제 경고:', delInvErr);

        console.log(`- 신규 실사 재고 ${newInventory.length}건 업로드 중...`);
        for (let i = 0; i < newInventory.length; i += CHUNK_SIZE) {
            const chunk = newInventory.slice(i, i + CHUNK_SIZE).map(inv => ({
                code: inv.code,
                location: inv.location,
                quantity: inv.quantity,
                status: inv.status,
                last_updated: new Date().toISOString()
            }));
            const { error: insertInvErr } = await sb.from('wms_inventory').insert(chunk);
            if (insertInvErr) {
                console.error(`재고 배치 ${i} 삽입 오류:`, insertInvErr);
            }
        }
        console.log(`✅ wms_inventory ${newInventory.length}건 Supabase 동기화 완료!`);
        console.log(`🎉 모든 동기화 작업이 성공적으로 완료되었습니다.`);
    } catch (err) {
        console.error('Supabase 동기화 예외 발생:', err);
    }
}

syncSupabase();
