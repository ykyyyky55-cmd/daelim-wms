import fs from 'fs';
import path from 'path';

const gimpoData = JSON.parse(fs.readFileSync('src/data/gimpoProductionData.json', 'utf-8'));
const enterpriseData = JSON.parse(fs.readFileSync('src/data/enterpriseData.json', 'utf-8'));

// 1. 작업자 목록 확장
const realWorkers = [
    { id: 'W-GP-001', name: '최용화', dept: '김포 생산관리팀', role: '담당/작성자' },
    { id: 'W-GP-002', name: '윤경용', dept: '김포 품질공정팀', role: '검토/공장장' },
    { id: 'W-GP-003', name: '정화순', dept: '김포 포장생산부', role: '라인반장' },
    { id: 'W-GP-004', name: '윤상모', dept: '김포 포장생산부', role: '생산기사' },
    { id: 'W-GP-005', name: '김세중', dept: '김포 포장생산부', role: '생산기사' },
    { id: 'W-GP-006', name: '박용채', dept: '자재물류운송팀', role: '물류운반' },
    { id: 'W-GP-007', name: '김희철', dept: '자재물류운송팀', role: '물류운반' },
    { id: 'W-GP-008', name: '원액생산자', dept: '김포 원액생산부', role: '블렌딩기사' }
];

// 기존 작업자와 병합 (중복 방지)
const workerMap = new Map();
realWorkers.forEach(w => workerMap.set(w.name, w));
(enterpriseData.workers || []).forEach(w => {
    if (!workerMap.has(w.name)) workerMap.set(w.name, w);
});
enterpriseData.workers = Array.from(workerMap.values());

// 2. 거래처 목록 확장
const realPartners = [
    { id: 'P-001', name: '브릿지엠', type: 'SUPPLIER', ceo: '김대표', manager: '박과장', phone: '031-987-1234', address: '경기도 김포시 양촌읍', email: 'bridgem@daelim.com', notes: '아웃박스 및 포장재 전문 납품' },
    { id: 'P-002', name: '상신', type: 'SUPPLIER', ceo: '이상신', manager: '최차장', phone: '02-850-2345', address: '대구시 달서구', email: 'sangsin@daelim.com', notes: 'HAGEN 브레이크액 OEM' },
    { id: 'P-003', name: '세양', type: 'CUSTOMER', ceo: '박세양', manager: '이팀장', phone: '032-560-3456', address: '인천광역시 서구', email: 'seyang@daelim.com', notes: 'TORENO 엔진오일 주문' },
    { id: 'P-004', name: '루키(LUKI)', type: 'CUSTOMER', ceo: '강루키', manager: '윤대리', phone: '02-340-4567', address: '서울시 금천구', email: 'luki@daelim.com', notes: 'PREMIUM GOLD 엔진오일 유통' },
    { id: 'P-005', name: 'SK루브리컨츠', type: 'SUPPLIER', ceo: '유정준', manager: '원료팀', phone: '02-2121-5000', address: '서울시 종로구', email: 'sk@daelim.com', notes: '기유 및 베이스오일 공급' },
    { id: 'P-006', name: 'S-OIL(토탈)', type: 'SUPPLIER', ceo: '후세인', manager: '원료영업', phone: '02-3772-5114', address: '서울시 마포구', email: 'soil@daelim.com', notes: '윤활기유 공급' },
    { id: 'P-007', name: '보크코리아(BOK)', type: 'CUSTOMER', ceo: '조보크', manager: '정과장', phone: '031-750-6789', address: '경기도 성남시', email: 'bok@daelim.com', notes: '고스트 엔진오일 납품' },
    { id: 'P-008', name: '무사시(MUSASHI)', type: 'CUSTOMER', ceo: '무사시', manager: '해외영업팀', phone: '02-555-8901', address: '서울시 강남구', email: 'musashi@daelim.com', notes: 'DOT-4 브레이크액 수출' }
];

const partnerMap = new Map();
realPartners.forEach(p => partnerMap.set(p.name, p));
(enterpriseData.partners || []).forEach(p => {
    if (!partnerMap.has(p.name)) partnerMap.set(p.name, p);
});
enterpriseData.partners = Array.from(partnerMap.values());

// 3. 거점(Locations) 확장
const realLocations = ['본사 창고', '김포공장', '김포2공장', '방산 창고', '대림오일 창고'];
enterpriseData.locations = Array.from(new Set([...realLocations, ...(enterpriseData.locations || [])]));

// 4. 품목 마스터 병합: 기존 마스터에 김포 실제 1,210건 추가/갱신
const masterMap = new Map();
// 기존 것 먼저 로드
(enterpriseData.master || []).forEach(m => masterMap.set(m.code, m));

// 김포 제품, 라벨, 원액 덮어쓰기/추가
const allGimpoMasters = [
    ...gimpoData.masters.products,
    ...gimpoData.masters.labels,
    ...gimpoData.masters.oils
];

allGimpoMasters.forEach(gm => {
    masterMap.set(gm.code, {
        code: gm.code,
        name: gm.name,
        spec: gm.spec,
        category: gm.category,
        type: gm.type,
        unit: gm.unit,
        supplier: gm.supplier || '대림오일(김포)',
        safety_stock: gm.safety_stock || 50,
        unit_price: gm.unit_price || 10000,
        notes: gm.notes || ''
    });
});

enterpriseData.master = Array.from(masterMap.values());

// 5. 김포공장 재고 기본값 생성 (master 중 김포공장 보관)
const invMap = new Map();
(enterpriseData.inventory || []).forEach(inv => {
    invMap.set(`${inv.code}_${inv.location}`, inv);
});

// 김포 품목들 김포공장 기본 재고 등록
enterpriseData.master.forEach(m => {
    const key = `${m.code}_김포공장`;
    if (!invMap.has(key)) {
        invMap.set(key, {
            code: m.code,
            name: m.name,
            location: '김포공장',
            qty: m.type === 'LABEL' ? 1200 : (m.type === 'OIL' ? 2400 : 350),
            spec: m.spec,
            category: m.category,
            status: '정상 보관',
            last_updated: '2026-08-31 18:00:00'
        });
    }
});

enterpriseData.inventory = Array.from(invMap.values());

// 6. 김포공장 일일 생산공급망 일지 및 대시보드 저장
enterpriseData.gimpoProductionLogs = gimpoData.dailyLogs;
enterpriseData.gimpoDataSummary = gimpoData.dataSummary;

fs.writeFileSync('src/data/enterpriseData.json', JSON.stringify(enterpriseData, null, 2), 'utf-8');
console.log(`Updated enterpriseData.json successfully!`);
console.log(`- Master items total: ${enterpriseData.master.length}`);
console.log(`- Inventory total: ${enterpriseData.inventory.length}`);
console.log(`- Workers total: ${enterpriseData.workers.length}`);
console.log(`- Partners total: ${enterpriseData.partners.length}`);
console.log(`- Gimpo Logs total: ${enterpriseData.gimpoProductionLogs.length} days`);
