import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.resolve(__dirname, '../src/data/enterpriseData.json');
console.log('Reading:', dataPath);

const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

const MASTER_CATEGORIES = ['완제품', '원액', '원료', '부자재', '소모품', '기타'];

function determineCategoryAndSubCategory(item) {
    if (!item) return { category: '완제품', subCategory: 'ODM 제품' };
    
    let category = item.category || '';
    let subCategory = item.subCategory || '';
    const name = item.name || '';
    const code = item.code || '';
    const spec = item.spec || '';
    const text = (name + ' ' + spec + ' ' + (item.notes || '')).toLowerCase();

    // 1. 이미 신규 6대 대분류 체계인 경우
    if (category === '완제품') {
        if (subCategory === '자사' || subCategory === '자사제품') {
            return { category: '완제품', subCategory: '자사제품' };
        }
        return { category: '완제품', subCategory: 'ODM 제품' };
    }

    if (category === '원액') {
        if (['엔진오일', '엔진코팅제', '브레이크액', '첨가제'].includes(subCategory)) {
            return { category: '원액', subCategory };
        }
        if (text.includes('코팅') || text.includes('그래핀')) return { category: '원액', subCategory: '엔진코팅제' };
        if (text.includes('브레이크') || text.includes('dot') || text.includes('bf')) return { category: '원액', subCategory: '브레이크액' };
        if (text.includes('세척') || text.includes('첨가제') || text.includes('부동액') || text.includes('클리너') || text.includes('크리너') || text.includes('수분제거')) return { category: '원액', subCategory: '첨가제' };
        return { category: '원액', subCategory: '엔진오일' };
    }

    if (category === '원료') {
        if (['BO', 'AC', 'AD', 'EP'].includes(subCategory)) {
            return { category: '원료', subCategory };
        }
        if (code.startsWith('6BO') || text.includes('기유') || text.includes('base oil') || text.includes('vhvi') || text.includes('150n') || text.includes('500n')) {
            return { category: '원료', subCategory: 'BO' };
        }
        if (code.startsWith('6EP') || code.includes('EP') || text.includes('극압') || text.includes('ep ')) {
            return { category: '원료', subCategory: 'EP' };
        }
        if (code.startsWith('5AD') || code.startsWith('6AD') || text.includes('ad ') || text.includes('첨가제원료') || text.includes('dpf원료')) {
            return { category: '원료', subCategory: 'AD' };
        }
        if (code.startsWith('5AC') || code.startsWith('6AC') || text.includes('ac ') || text.includes('촉매') || text.includes('세척원료')) {
            return { category: '원료', subCategory: 'AC' };
        }
        return { category: '원료', subCategory: 'AC' };
    }

    if (category === '부자재') {
        let sub = '기타';
        if (subCategory && ['용기', '아웃박스', '인박스', '라벨', '기타'].includes(subCategory)) {
            sub = subCategory;
        } else if (subCategory === '캡' || subCategory === '드럼') {
            sub = (subCategory === '드럼') ? '용기' : '기타';
        } else if (name.includes('인박스') || name.includes('단상자') || text.includes('in box') || text.includes('inbox') || text.includes('i/b')) {
            sub = '인박스';
        } else if (name.includes('아웃박스') || name.includes('카톤') || text.includes('out box') || text.includes('outbox') || text.includes('o/b') || name.includes('칼라박스') || name.includes('rrp박스') || (name.includes('박스') && !name.includes('용기') && !name.includes('인박스') && !name.includes('스티커') && !name.includes('라벨') && !name.match(/\d+박스/))) {
            sub = '아웃박스';
        } else if (name.includes('라벨') || name.includes('스티커') || text.includes('label')) {
            sub = '라벨';
        } else if (name.includes('용기') || name.includes('보틀') || name.includes('말통') || name.includes('공병') || name.includes('공드럼') || name.includes('신품드럼') || name.includes('중고드럼') || (text.includes('bottle') && !text.includes('cap')) || (text.includes('pet') && (name.includes('원형') || name.includes('사각')))) {
            sub = '용기';
        }
        return { category: '부자재', subCategory: sub };
    }

    if (category === '소모품') {
        return { category: '소모품', subCategory: '-' };
    }

    if (category === '기타') {
        return { category: '기타', subCategory: '-' };
    }

    // 2. 카테고리가 미지정이거나 기존 분류 분석
    // A) 원료 판별
    if (name.startsWith('원료-') || code.startsWith('6BO') || code.startsWith('6EP') || code.startsWith('6SV') || text.includes('기유') || text.includes('base oil')) {
        let sub = 'BO';
        if (code.startsWith('6EP') || text.includes('극압')) sub = 'EP';
        else if (code.startsWith('5AD') || text.includes('dpf원료')) sub = 'AD';
        else if (code.startsWith('5AC') || text.includes('ac')) sub = 'AC';
        return { category: '원료', subCategory: sub };
    }

    // B) 부자재 판별
    if (code.startsWith('1') || code.startsWith('OS0') || code.startsWith('OP0') || code.startsWith('OO0') || code.startsWith('OA0') || code.startsWith('DE0') || code.startsWith('DA0') || code.startsWith('DS0') || code.startsWith('DO0') || code.startsWith('DL0') || name.includes('라벨') || name.includes('박스') || name.includes('용기') || name.includes('캡') || name.includes('스티커')) {
        let sub = '기타';
        if (name.includes('인박스') || name.includes('단상자')) sub = '인박스';
        else if (name.includes('아웃박스') || name.includes('카톤') || name.includes('칼라박스') || name.includes('박스')) sub = '아웃박스';
        else if (name.includes('라벨') || name.includes('스티커')) sub = '라벨';
        else if (name.includes('용기') || name.includes('보틀') || name.includes('말통') || name.includes('공병') || name.includes('드럼')) sub = '용기';
        return { category: '부자재', subCategory: sub };
    }

    // C) 원액 판별
    if (code.startsWith('5') || name.includes('원액') || name.includes('벌크') || spec.includes('벌크') || name.includes('배합')) {
        let sub = '엔진오일';
        if (name.includes('코팅') || name.includes('그래핀')) sub = '엔진코팅제';
        else if (name.includes('브레이크') || name.includes('dot') || name.includes('bf')) sub = '브레이크액';
        else if (name.includes('세척') || name.includes('첨가제') || name.includes('부동액') || name.includes('클리너') || name.includes('크리너') || name.includes('수분제거')) sub = '첨가제';
        return { category: '원액', subCategory: sub };
    }

    // D) 완제품 판별
    let sub = 'ODM 제품';
    if (name.includes('대림') || name.startsWith('DO ') || (item.supplier && item.supplier.includes('대림오일'))) {
        sub = '자사제품';
    }
    return { category: '완제품', subCategory: sub };
}

// 1. 카테고리 갱신
data.categories = [...MASTER_CATEGORIES];

// 2. 마스터 품목 변환
let stats = {
    total: data.master.length,
    byCategory: {},
    bySubCategory: {}
};

for (const item of data.master) {
    const res = determineCategoryAndSubCategory(item);
    item.category = res.category;
    item.subCategory = res.subCategory;

    stats.byCategory[res.category] = (stats.byCategory[res.category] || 0) + 1;
    const subKey = `${res.category} > ${res.subCategory}`;
    stats.bySubCategory[subKey] = (stats.bySubCategory[subKey] || 0) + 1;
}

// 3. 재고 품목의 category도 마스터 품목과 일치
const masterMap = new Map();
for (const m of data.master) {
    masterMap.set(m.code, m);
}

for (const inv of data.inventory) {
    const m = masterMap.get(inv.code);
    if (m) {
        inv.category = m.category;
        inv.subCategory = m.subCategory;
    }
}

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');

console.log('Migration complete!');
console.log('Stats:');
console.log('By Category:', JSON.stringify(stats.byCategory, null, 2));
console.log('By SubCategory:', JSON.stringify(stats.bySubCategory, null, 2));
