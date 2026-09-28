// 사용자 매뉴얼 화면 이미지 자동 캡처 (public/manual/*.webp)
// 실제 업무 데이터가 이미지에 들어가지 않도록, 가짜 예시 데이터로 채운 로컬(오프라인) 모드 앱을 찍는다.
// 사용법 (daelim-wms 루트):
//   npm run build && npm run preview   (다른 창에서, http://localhost:4173)
//   node scripts/capture_manual.mjs [찍을 이름...]     예: node scripts/capture_manual.mjs scan-item home
// Chrome(또는 Edge)을 헤드리스로 띄워 CDP로 조작한다 (Node 22+ 내장 WebSocket 사용, 추가 설치 없음).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = process.env.MANUAL_APP_URL || 'http://localhost:4173/';
const OUT = path.resolve('public/manual');
const PORT = 9333;
const BROWSERS = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];
const only = process.argv.slice(2);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- 예시 데이터 (가짜) ----------
const today = new Date();
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOff = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return ymd(d); };
const T = ymd(today);
const ts = (n, h = 10) => { const d = new Date(today); d.setDate(d.getDate() + n); d.setHours(h, 12, 0); return d.toLocaleString('ko-KR'); };

const master = [
    ['P-1001', '샘플 엔진오일 5W-30', '완제품', 'EA', '4L'],
    ['P-1002', '샘플 엔진오일 10W-40', '완제품', 'EA', '1L'],
    ['P-1003', '샘플 기어오일 80W-90', '완제품', 'EA', '20L 페일'],
    ['P-1004', '샘플 유압유 46', '완제품', 'EA', '200L 드럼'],
    ['B-2001', '샘플 엔진오일 원액 A', '원액', 'L', '-'],
    ['R-3001', '샘플 기유 150N', '원료', 'L', '-'],
    ['R-3002', '샘플 기유 500N', '원료', 'L', '-'],
    ['R-3003', '샘플 첨가제 패키지 X', '원료', 'L', '-'],
    ['M-4001', '샘플 4L 용기', '부자재', 'EA', '4L'],
    ['M-4002', '샘플 4L 라벨', '부자재', 'EA', '100x80'],
    ['M-4003', '샘플 포장 박스 (4L x 4)', '부자재', 'EA', '-'],
    ['M-4004', '샘플 20L 페일 용기', '부자재', 'EA', '20L'],
    ['S-5001', '샘플 작업 장갑', '소모품', 'EA', '-']
].map(([code, name, category, unit, spec]) => ({ code, name, category, subCategory: '-', unit, spec, supplier: '가나상사', safety: category === '완제품' ? 50 : 0 }));
const mOf = (c) => master.find(m => m.code === c);
const invRow = (code, location, quantity) => ({ category: mOf(code).category, subCategory: '-', code, name: mOf(code).name, supplier: '가나상사', spec: mOf(code).spec, location, quantity, unit: mOf(code).unit, status: '정상 보관', lastUpdated: ts(-1) });
const inventory = [
    invRow('P-1001', '본사 / 제품창고', 320), invRow('P-1001', '김포공장 / 1동', 480), invRow('P-1002', '본사 / 제품창고', 150),
    invRow('P-1003', '김포공장 / 1동', 64), invRow('P-1004', '김포공장 / 2동', 12), invRow('B-2001', '김포공장', 3200),
    invRow('R-3001', '김포공장', 18000), invRow('R-3002', '김포공장', 9500), invRow('R-3003', '김포공장', 1200),
    invRow('M-4001', '김포공장 / 2동', 5200), invRow('M-4002', '김포공장 / 2동', 4800), invRow('M-4003', '김포공장 / 2동', 900), invRow('M-4004', '김포공장 / 2동', 30),
    invRow('S-5001', '본사', 40)
];
const history = [
    { id: 11, timestamp: ts(-3, 9), type: 'IN', code: 'P-1001', name: mOf('P-1001').name, qty: 480, worker: '김현장 (현장 작업자)', fromLoc: '생산라인 (완제품 제조)', toLoc: '김포공장 / 1동', reason: '완제품 생산 입고 [LOT-SAMPLE-0921] (4L)' },
    { id: 12, timestamp: ts(-2, 14), type: 'MOVE', code: 'P-1001', name: mOf('P-1001').name, qty: 160, worker: '이창고 (현장 작업자)', fromLoc: '김포공장 / 1동', toLoc: '본사 / 제품창고', reason: '본사 출하 준비 LOT: LOT-SAMPLE-0921' },
    { id: 13, timestamp: ts(-1, 11), type: 'OUT', code: 'P-1002', name: mOf('P-1002').name, qty: 30, worker: '이창고 (현장 작업자)', fromLoc: '본사 / 제품창고', toLoc: '-', reason: '가나상사 출고' },
    { id: 14, timestamp: ts(-1, 15), type: 'USE', code: 'M-4001', name: mOf('M-4001').name, qty: 400, worker: '김현장 (현장 작업자)', fromLoc: '김포공장 / 2동', toLoc: '-', reason: '포장 생산 투입' }
];
const rawEntry = (id, date, code, name, type, inQty, outQty, sg, rawCode) => ({ id, date, code, rawCode, name, location: '김포', type, manufacturer: '', notes: '', inQty, outQty, stockQty: 0, weight: 0, sg, dm: 0, unitPrice: 0, remark: '', worker: '박품질', createdAt: date });
const rawLedger = [
    rawEntry('RAW-S1', dayOff(-10), 'R-3001', '샘플 기유 150N', '입고', 20000, 0, 0.865, 'RM-101'),
    rawEntry('RAW-S2', dayOff(-4), 'R-3001', '샘플 기유 150N', '사용', 0, 2000, 0.865, 'RM-101'),
    rawEntry('RAW-S3', dayOff(-9), 'R-3002', '샘플 기유 500N', '입고', 9500, 0, 0.88, 'RM-102'),
    rawEntry('RAW-S4', dayOff(-8), 'R-3003', '샘플 첨가제 패키지 X', '입고', 1200, 0, 0.95, 'RM-201'),
    rawEntry('RAW-S5', dayOff(-3), 'B-2001', '샘플 엔진오일 원액 A', '입고', 3200, 0, 0.87, 'BL-01'),
    // 원료입고 현황판 예시: 구분 칸에 거래처 이름이 적힌 매입 입고, 본사 입고, 거점이동(집계 제외)
    rawEntry('RAW-S6', dayOff(-6), 'R-3001', '샘플 기유 150N', '가나화학', 12000, 0, 0.865, 'RM-101'),
    { ...rawEntry('RAW-S7', dayOff(-5), 'R-3002', '샘플 기유 500N', '다라물산', 6000, 0, 0.88, 'RM-102'), location: '본사' },
    rawEntry('RAW-S8', dayOff(-2), 'R-3003', '샘플 첨가제 패키지 X', '가나화학', 800, 0, 0.95, 'RM-201'),
    { ...rawEntry('RAW-S9', dayOff(-1), 'R-3001', '샘플 기유 150N', '이동입고', 2000, 0, 0.865, 'RM-101'), location: '본사' }
];
const workers = [
    { id: 'W01', name: '김현장', role: '현장 작업자', dept: '생산팀' },
    { id: 'W02', name: '이창고', role: '현장 작업자', dept: '물류팀' },
    { id: 'W03', name: '박품질', role: '관리자', dept: '품질팀' }
];
const schedules = [
    { id: 'SC1', calendar: 'HQ', date: dayOff(1), type: 'OUT_PLAN', title: '가나상사 출하', itemCode: 'P-1001', itemName: mOf('P-1001').name, partner: '가나상사', worker: '이창고', notes: '', status: 'TODO', owner: '', attachments: [], slipNos: [] },
    { id: 'SC2', calendar: 'GIMPO', date: dayOff(2), type: 'PROD_PLAN', title: '5W-30 4L 포장', itemCode: 'P-1001', itemName: mOf('P-1001').name, partner: '', worker: '김현장', notes: '', status: 'TODO', owner: '', attachments: [], slipNos: [] },
    { id: 'SC3', calendar: 'GIMPO', date: dayOff(4), type: 'IN_PLAN', title: '기유 150N 입고', itemCode: 'R-3001', itemName: '샘플 기유 150N', partner: '다라물산', worker: '박품질', notes: '', status: 'TODO', owner: '', attachments: [], slipNos: [] }
];
const slips = [{
    id: 'SLP-S1', docNo: `RQ-${T.replace(/-/g, '')}-001`, type: 'RELEASE', date: T, fromLoc: '본사', toLoc: '외부 거래처', partner: '가나상사', transport: '용차', reason: '정기 출하', worker: '이창고',
    items: [{ code: 'P-1001', name: mOf('P-1001').name, spec: '4L', unit: 'EA', qty: 3, note: '' }, { code: 'P-1002', name: mOf('P-1002').name, spec: '1L', unit: 'EA', qty: 2, note: '' }], createdAt: T
}];
const locations = ['본사', '본사 / 제품창고', '김포공장', '김포공장 / 1동', '김포공장 / 2동', '방산공장', '김포2공장'];

// 생산관리 예시: 제품 BOM, 생산스케줄, 이번 주 생산·구매계획, 생산요청서
const monday = (() => { const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); })();
const wd = (n) => { const d = new Date(monday); d.setDate(d.getDate() + n); return ymd(d); };
const boms = {
    'P-1001': { rawList: [{ code: 'B-2001', rate: 4 }], subList: [{ code: 'M-4001', rate: 1 }, { code: 'M-4002', rate: 1 }, { code: 'M-4003', rate: 0.25 }] },
    'P-1002': { rawList: [{ code: 'B-2001', rate: 1 }], subList: [{ code: 'M-4002', rate: 1 }] },
    'P-1003': { rawList: [{ code: 'B-2001', rate: 20 }], subList: [{ code: 'M-4004', rate: 1 }] }
};
const pl = (id, n, type, code, qty, extra = {}) => ({ id, date: wd(n), site: '김포', type, code, name: mOf(code).name, spec: mOf(code).spec, qty, unit: mOf(code).unit, line: type === '원액' ? 'BT-1' : '포장1부', partner: '', due: '', source: 'MANUAL', status: 'PLAN', note: '', ...extra });
const planRows = [
    { id: `PROD_WEEK-${monday}`, kind: 'PROD_WEEK', period: monday, doc_no: null, status: null, created_at: T, updated_at: T, updated_by: '박품질 (관리자)', data: { author: '박품질 (관리자)', notes: '10월 초 출하 물량 우선 생산', lines: [
        pl('L1', 0, '완제품', 'P-1001', 1000, { partner: '가나상사', due: wd(3), source: 'SCHED', ref: 'PS-S1' }),
        pl('L2', 1, '완제품', 'P-1002', 300, { partner: '다라물산', due: wd(4), source: 'REQ', refNo: `PR-${T.replace(/-/g, '')}-001` }),
        pl('L3', 2, '원액', 'B-2001', 2000, { note: '블렌딩 2배치' }),
        pl('L4', 3, '완제품', 'P-1003', 40, { partner: '가나상사', status: 'DONE', doneQty: 40 }),
        pl('L5', 4, '완제품', 'P-1003', 120, { partner: '가나상사', due: wd(6) })
    ] } },
    { id: `PURCH_WEEK-${monday}`, kind: 'PURCH_WEEK', period: monday, doc_no: null, status: null, created_at: T, updated_at: T, updated_by: '박품질 (관리자)', data: { author: '박품질 (관리자)', notes: '', lines: [
        { id: 'B1', date: wd(1), site: '김포', code: 'M-4003', name: mOf('M-4003').name, spec: '-', qty: 200, unit: 'EA', supplier: '가나상사', price: 850, eta: wd(1), source: 'SHORT', status: 'ORDER', note: '부족분 자동 반영' },
        { id: 'B2', date: wd(2), site: '김포', code: 'R-3003', name: mOf('R-3003').name, spec: '-', qty: 400, unit: 'L', supplier: '다라물산', price: '', eta: wd(4), source: 'MANUAL', status: 'PLAN', note: '' }
    ] } },
    { id: 'PR-S1', kind: 'PROD_REQ', period: T, doc_no: `PR-${T.replace(/-/g, '')}-001`, status: 'PLANNED', created_at: T, updated_at: T, updated_by: '최영업', data: {
        reqDate: T, planDate: wd(1), dueDate: wd(4), site: '김포', dept: '영업팀', requester: '최영업', partner: '다라물산', assigneeId: 'manager', assigneeName: '김물류', urgent: true, reason: '신규 거래처 초도 물량', reviewNote: '이번 주 화요일 생산 예정', planWeek: monday,
        lines: [{ id: 'RL1', code: 'P-1002', name: mOf('P-1002').name, spec: '1L', qty: 300, unit: 'EA', pack: '1L x 20 박스', note: '' }] } },
    { id: 'PR-S2', kind: 'PROD_REQ', period: T, doc_no: `PR-${T.replace(/-/g, '')}-002`, status: 'REQUESTED', created_at: T, updated_at: T, updated_by: '최영업', data: {
        reqDate: T, dueDate: wd(9), site: '본사', dept: '영업팀', requester: '최영업', partner: '가나상사', urgent: false, reason: '', reviewNote: '',
        lines: [{ id: 'RL2', code: 'P-1004', name: mOf('P-1004').name, spec: '200L 드럼', qty: 8, unit: 'EA', pack: '드럼', note: '' }] } },
    { id: 'PR-S3', kind: 'PROD_REQ', period: T, doc_no: `BR-${T.replace(/-/g, '')}-001`, status: 'ACCEPTED', created_at: T, updated_at: T, updated_by: '박품질', data: {
        reqType: 'RAW', reqDate: T, planDate: wd(3), dueDate: wd(5), site: '김포', dept: '생산팀', requester: '김현장', partner: '', moveTo: '본사', assigneeId: 'manager', assigneeName: '김물류', urgent: false, reason: '5W-30 포장 물량 원액 확보', reviewNote: '블렌딩 2배치 편성',
        lines: [{ id: 'RL3', code: 'B-2001', name: mOf('B-2001').name, spec: '-', qty: 4000, unit: 'L', pack: 'IBC 4개', note: '' }] } },
    { id: 'PQ-S1', kind: 'PURCH_REQ', period: T, doc_no: `PQ-${T.replace(/-/g, '')}-001`, status: 'REQUESTED', created_at: T, updated_at: T, updated_by: '김현장', data: {
        reqType: 'PURCH', reqDate: T, dueDate: wd(3), site: '김포', dept: '생산팀', requester: '김현장', partner: '5W-30 4L 포장용', urgent: true, reason: '포장 박스 재고 부족', reviewNote: '',
        lines: [{ id: 'QL1', code: 'M-4003', name: mOf('M-4003').name, spec: '-', qty: 300, unit: 'EA', supplier: '가나상사', price: 850, note: '' },
            { id: 'QL2', code: 'M-4004', name: mOf('M-4004').name, spec: '20L', qty: 100, unit: 'EA', supplier: '다라물산', price: 2400, note: '' }] } },
    // 업무추진계획서 예시 (연간 + 이번 달)
    { id: `WORK_YEAR-${T.slice(0, 4)}`, kind: 'WORK_YEAR', period: T.slice(0, 4), doc_no: null, status: null, created_at: T, updated_at: T, updated_by: '박품질 (관리자)', data: {
        author: '박품질 (관리자)', goal: '1. 포장 생산성 10% 향상\n2. 원료 재고 적정화 (재고일수 30일 이내)\n3. 무재해 사업장 달성', review: '', notes: '',
        kpis: [{ id: 'YK1', name: '완제품 포장 수량', unit: '만 EA', target: 80, actual: 61, note: '' }, { id: 'YK2', name: '포장 생산성', unit: 'EA/공수', target: 950, actual: 941, note: '' }],
        tasks: [
            { id: 'YT1', category: '생산', title: '포장라인 2부 자동 캡핑기 도입', detail: '견적·설치·시운전', dept: '생산팀', owner: '김현장', target: '라인 속도 +15%', months: [8, 9, 10], progress: 60, status: 'WORK', result: '', note: '' },
            { id: 'YT2', category: '구매·자재', title: '기유 공급처 이원화', detail: '대체 공급처 품질 시험', dept: '구매팀', owner: '박품질', target: '공급처 2곳', months: [9, 10, 11], progress: 30, status: 'WORK', result: '', note: '' },
            { id: 'YT3', category: '안전·환경', title: '위험물 저장소 안전점검', detail: '분기 점검', dept: '품질팀', owner: '박품질', target: '지적사항 0건', months: [3, 6, 9, 12], progress: 75, status: 'WORK', result: '', note: '' }
        ] } },
    { id: `WORK_MONTH-${T.slice(0, 7)}`, kind: 'WORK_MONTH', period: T.slice(0, 7), doc_no: null, status: null, created_at: T, updated_at: T, updated_by: '박품질 (관리자)', data: {
        author: '박품질 (관리자)', goal: '추석 성수기 출하 대응 및 원액 재고 확보', review: '캡핑기 설치 일정 1주 지연 → 10월 둘째 주 시운전으로 조정', notes: '',
        kpis: [{ id: 'MK1', name: '완제품 포장', unit: 'EA', target: 60000, actual: 64120, note: '' }, { id: 'MK2', name: '원액 생산', unit: 'L', target: 20000, actual: 19200, note: '' }],
        tasks: [
            { id: 'MT1', yearRef: 'YT1', category: '생산', title: '포장라인 2부 자동 캡핑기 도입', detail: '설치·시운전', dept: '생산팀', owner: '김현장', start: `${T.slice(0, 7)}-01`, end: `${T.slice(0, 7)}-20`, target: '시운전 완료', progress: 60, status: 'WORK', result: '설치 완료, 시운전 대기', note: '' },
            { id: 'MT2', yearRef: 'YT3', category: '안전·환경', title: '위험물 저장소 안전점검', detail: '3분기 점검', dept: '품질팀', owner: '박품질', start: `${T.slice(0, 7)}-10`, end: `${T.slice(0, 7)}-15`, target: '지적 0건', progress: 100, status: 'DONE', result: '점검 완료 (지적 0건)', note: '' },
            { id: 'MT3', category: '물류·출하', title: '추석 출하 물량 사전 입고', detail: '거래처별 출하 일정 확정', dept: '물류팀', owner: '이창고', start: `${T.slice(0, 7)}-01`, end: `${T.slice(0, 7)}-30`, target: '출하 지연 0건', progress: 80, status: 'WORK', result: '', note: '' }
        ] } }
];
const matIt = (code, qty) => ({ code, name: mOf(code).name, category: mOf(code).category, unit: mOf(code).unit, qty });
const prodSchedule = [
    { id: 'PS-S1', sheet_date: T, site: '김포', line: '포장1부', status: 'PREP', plan_date: wd(0), due_date: wd(3), partner: '가나상사', item_code: 'P-1001', item_name: mOf('P-1001').name, spec: '4L', qty: 1000, per_box: 4,
        materials: { container: '재고', label: '발주' }, sort_order: 1, mat_items: [matIt('B-2001', 4000), matIt('M-4001', 1000), matIt('M-4003', 250)] },
    { id: 'PS-S2', sheet_date: T, site: '김포', line: '포장1부', status: 'PLANNED', plan_date: wd(4), due_date: wd(6), partner: '가나상사', item_code: 'P-1003', item_name: mOf('P-1003').name, spec: '20L 페일', qty: 120, per_box: 1,
        materials: {}, sort_order: 2, mat_items: [matIt('B-2001', 2400), matIt('M-4004', 120)] }
];

// 담당자 알림 예시: 다른 사람이 나(admin)에게 배정한 할일 (출하 25분 뒤 → 30분 전 알림)
const soon = new Date(Date.now() + 25 * 60000);
const hhmm = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
const asgTodos = [
    { id: 'ASG:SLIP:TR-DEMO-001@admin', text: '[원부자재 이동전표] TR-DEMO-001 김포공장 → 가나상사 · 2품목 출하 확인', done: false, due_date: T, due_time: hhmm, remind_before: 30, ref: 'SLIP:TR-DEMO-001', link: { tab: 'slipIssue' }, assigned_by: 'manager', assigned_by_name: '김물류', starred: false, sort_order: 0, created_at: new Date().toISOString() },
    { id: 'ASG:REQ:PR-S1:PROD@admin', text: '[제품생산요청서] PR-DEMO-001 샘플 엔진오일 10W-40 생산 예정', done: false, due_date: T, due_time: null, remind_before: null, ref: 'REQ:PR-S1', link: { tab: 'prodRequest' }, assigned_by: 'manager', assigned_by_name: '김물류', starred: false, sort_order: 0, created_at: new Date().toISOString() }
];

// 공지사항 예시
const notices = [
    { id: 'NT-1', title: '10월 재고실사 일정 안내', body: '10월 31일(금) 오후 2시부터 전 거점 재고실사를 합니다.\n각 거점 담당자는 위치 QR 라벨을 미리 붙여 주세요.\n실사 방법: 지원 → 매뉴얼 → 재고실사', important: false, pinned: true, author: 'manager', author_name: '김물류', created_at: new Date(Date.now() - 3 * 86400000).toISOString(), updated_at: new Date(Date.now() - 3 * 86400000).toISOString() },
    { id: 'NT-2', title: '안전교육 필수 참석 (10/2 목)', body: '10월 2일(목) 09:00 김포공장 교육장에서 법정 안전교육이 있습니다. 전 직원 필수 참석입니다.', important: true, pinned: false, author: 'manager', author_name: '김물류', created_at: new Date(Date.now() - 3600000).toISOString(), updated_at: new Date(Date.now() - 3600000).toISOString() },
    { id: 'NT-3', title: 'WMS 전자결재 사용 안내', body: '결재가 필요한 서류는 결재 칸을 눌러 전자서명하세요. 자세한 방법은 매뉴얼의 전자결재 장을 보세요.', important: false, pinned: false, author: 'manager', author_name: '김물류', created_at: new Date(Date.now() - 7 * 86400000).toISOString(), updated_at: new Date(Date.now() - 7 * 86400000).toISOString() }
];

// 업무일지 예시 (본사·김포, 9월 평일) — 실적 현황판·업무일지 화면용 가짜 자료
const fakeLogs = (site) => Array.from({ length: 22 }, (_, i) => i + 1).map(dd => `2026-09-${String(dd).padStart(2, '0')}`)
    .filter(d => ![0, 6].includes(new Date(`${d}T12:00:00`).getDay())).map((date, i) => {
        const hq = site === 'HQ';
        const q1 = (hq ? 900 : 1200) + ((i * 137) % 700), q2 = (hq ? 300 : 500) + ((i * 91) % 400);
        return {
            sheetName: date.slice(5).replace('-', ''), date, month: '09', manager: hq ? '박포장' : '김현장',
            packaging: [
                { item: `P-1001 / ${mOf('P-1001').name} | 4L`, spec: '4L', qty: q1, box: Math.round(q1 / 4), workHours: 4, workersCount: 3, totalWorkHours: 12, line: '라인 1', lotNo: date.replace(/-/g, '').slice(2), category: '엔진오일', manHours: 1.6 },
                { item: `P-1002 / ${mOf('P-1002').name} | 1L`, spec: '1L', qty: q2, box: Math.round(q2 / 12), workHours: 2, workersCount: 2, totalWorkHours: 4, line: '라인 2', lotNo: '', category: hq ? '연료첨가제' : '엔진오일', manHours: 0.53 }
            ],
            oilBlending: i % 3 === 0 ? [{ item: `B-2001 / ${mOf('B-2001').name}`, spec: 'L', qty: 1000 + (i % 4) * 400, workHours: 2, workersCount: 2, totalWorkHours: 4, lotNo: `${date.slice(2).replace(/-/g, '')}-1`, manHours: 0.53 }] : [],
            labeling: hq ? [{ item: '샘플 라벨 1L', spec: '90*120', qty: 600 + (i % 5) * 120, workHours: 2, workersCount: 1, totalWorkHours: 2, line: '수동_1', manHours: 0.27 }] : [],
            movement: [{ item: mOf('M-4003').name, spec: '', unit: 'EA', qty: 100 + i * 10, vehicle: '1톤', driver: '홍운반', route: hq ? '방산>본사' : '김포>본사' }],
            receiving: hq ? [] : [{ item: mOf('M-4004').name, spec: '20L', qty: 200, partner: '가나상사', inspector: '김현장' }],
            shipping: [], purchaseOrders: hq && i % 2 === 0 ? [{ item: mOf('M-4003').name, spec: '-', qty: 500, partner: '가나상사', site: '본사' }] : [],
            courier: hq ? [{ type: '택배/화물', count: 20 + (i % 7) }] : [], otherNotes: [], otherTasks: [
                { task: '창고 정리', qty: 0, workHours: 1, workersCount: 1, totalWorkHours: 1, manHours: 0.13 },
                { task: ['택배 출고 지원', '충진기 점검', '하역 작업', '전산 입력', '재포장 작업'][i % 5], qty: 0, workHours: 2, workersCount: 2, totalWorkHours: 4, manHours: 0.53 }
            ],
            isSyncedToLedger: i < 10
        };
    });

// 파일 저장소 문서 대장 예시 (첨부는 가짜 텍스트 파일)
const fakeFile = (name) => ({ id: `F-${name}`, path: '', name, mime: 'text/plain', size: 2048, data: 'data:text/plain;base64,7JiI7IucIO2MjOydvA==' });
const documents = [
    { id: 'D-1', regNo: `접수-${T.slice(0, 4)}-0003`, direction: 'RECEIVED', date: wd(0), type: '거래명세서', docNo: 'GN-2409-118', party: '가나상사', title: '원료 납품 거래명세서 (샘플 원료 A 2드럼)', assignee: '김현장', memo: '원본은 경리팀 보관', files: [fakeFile('거래명세서_가나상사.pdf')], by: '관리자', at: `${wd(0)}T09:10:00` },
    { id: 'D-2', regNo: `발행-${T.slice(0, 4)}-0002`, direction: 'ISSUED', date: wd(0), type: '성적서(COA)', docNo: 'COA-P1001-0921', party: '다라유통', title: '샘플 엔진오일 5W-30 시험성적서 발송', assignee: '이창고', memo: '', files: [fakeFile('COA_P-1001.pdf')], by: '관리자', at: `${wd(0)}T10:30:00` },
    { id: 'D-3', regNo: `접수-${T.slice(0, 4)}-0002`, direction: 'RECEIVED', date: wd(-1), type: 'MSDS', docNo: '', party: '가나상사', title: '샘플 원료 B MSDS 개정본', assignee: '', memo: '', files: [fakeFile('MSDS_원료B.pdf')], by: '관리자', at: `${wd(-1)}T14:00:00` },
    { id: 'D-4', regNo: `접수-${T.slice(0, 4)}-0001`, direction: 'RECEIVED', date: wd(-2), type: '견적서', docNo: 'Q-7781', party: '마바포장', title: '1L 용기 견적서', assignee: '김현장', memo: '', files: [fakeFile('견적서_용기.xlsx'), fakeFile('도면.png')], by: '관리자', at: `${wd(-2)}T11:00:00` },
    { id: 'D-5', regNo: `발행-${T.slice(0, 4)}-0001`, direction: 'ISSUED', date: wd(-2), type: '공문', docNo: '', party: '다라유통', title: '단가 변경 안내 공문', assignee: '', memo: '', files: [], by: '관리자', at: `${wd(-2)}T16:00:00` }
];
// 품목 사진 예시: 캔버스로 그린 가짜 제품 그림을 파일 저장소 화면에서 올린다
const uploadFakePhotos = `(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    document.querySelector('.fs-tab[data-tab="images"]')?.click(); await sleep(500);
    document.querySelector('.fi-item[data-code="P-1001"]')?.click(); await sleep(500);
    const draw = (bg, cap, label) => new Promise(res => { const c = document.createElement('canvas'); c.width = 600; c.height = 600; const x = c.getContext('2d');
        x.fillStyle = '#f1f5f9'; x.fillRect(0, 0, 600, 600); x.fillStyle = bg; x.fillRect(180, 160, 240, 380); x.fillStyle = cap; x.fillRect(250, 100, 100, 70);
        x.fillStyle = '#fff'; x.fillRect(200, 280, 200, 150); x.fillStyle = '#0f172a'; x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.fillText(label, 300, 350); x.font = '20px sans-serif'; x.fillText('SAMPLE 4L', 300, 390);
        c.toBlob(b => res(new File([b], label + '.png', { type: 'image/png' })), 'image/png'); });
    const inp = document.querySelector('#fi-file'); if (!inp) return;
    const dt = new DataTransfer(); dt.items.add(await draw('#1d4ed8', '#111827', '5W-30')); dt.items.add(await draw('#0f766e', '#111827', '앞면')); dt.items.add(await draw('#b45309', '#111827', '뒷면'));
    inp.files = dt.files; inp.dispatchEvent(new Event('change')); await sleep(2500);
})()`;

// 품질관리 예시 (가짜): 최근 6개월 검사 기록 · 설비 · 점검 이력 · MSDS, 불량률 보고서 결재(팀장 칸 추가·수신참조)
const monthStart = (n) => { const d = new Date(today.getFullYear(), today.getMonth() + n, 1); return ymd(d); };
const qcRecords = (() => {
    const out = [];
    const items = [['P-1001', '샘플 엔진오일 5W-30'], ['P-1002', '샘플 엔진오일 10W-40'], ['P-1003', '샘플 기어오일 80W-90'], ['P-1004', '샘플 유압유 46']];
    const partners = ['가나상사', '다라유통', '마바물산'];
    const types = [['누유·새는 용기', 5], ['라벨 불량(오부착·인쇄)', 3], ['캡·마개 불량', 2], ['외관(찍힘·변형)', 1], ['포장·박스 불량', 1]];
    for (let m = -5; m <= 0; m++) {
        for (let k = 0; k < 4; k++) {
            const d = new Date(today.getFullYear(), today.getMonth() + m, 3 + k * 6);
            if (d > today) continue;
            const [code, name] = items[(k + m + 12) % items.length];
            const ins = 800 + ((k * 7 + m * 3 + 30) % 5) * 300;
            const defects = types.map(([t, w], i) => ({ type: t, qty: Math.max(0, Math.round(w * (1 + ((k + i + m + 20) % 3)) * (m === -2 ? 1.8 : 1) - 2)) })).filter(x => x.qty > 0);
            const def = defects.reduce((s, x) => s + x.qty, 0);
            const rate = def / ins * 100;
            out.push({
                id: `QC-DEMO-${m + 5}${k}`, kind: 'INSPECT', area: 'PRODUCT', date: ymd(d), itemCode: code, itemName: name, lot: `L${ymd(d).replace(/-/g, '').slice(2)}`, partner: partners[(k + m + 9) % 3],
                inspectedQty: ins, unit: 'EA', defects, defectQty: def, result: rate > 2.5 ? 'FAIL' : rate > 1 ? 'COND' : 'PASS', inspector: '박품질',
                cause: rate > 1 ? '캡핑 토크 편차' : '', action: rate > 1 ? '캡핑기 토크 재설정 · 전수 선별' : '', actionDone: rate > 1 && m < 0, by: '박품질', createdAt: `${ymd(d)}T15:00:00`, updatedAt: `${ymd(d)}T15:00:00`
            });
        }
    }
    // 공정검사 · 원부자재 수입검사 예시 (월간 불량률 현황용)
    const procTypes = ['충진량 편차', '캡핑 불량', '라벨 위치·기울어짐', '이물 혼입'];
    const matTypes = ['용기 파손·누유', '인쇄 불량(라벨·박스)', '규격(비중·점도 등) 이탈'];
    for (let m = -11; m <= 0; m++) {
        for (let k = 0; k < 3; k++) {
            const d = new Date(today.getFullYear(), today.getMonth() + m, 5 + k * 8);
            if (d > today) continue;
            const pIns = 3000 + ((k + m + 24) % 4) * 500;
            const pDef = [4 + ((k + m + 30) % 5), 2 + ((k + 30) % 3), 1 + ((m + 30) % 2), (k + m + 30) % 2];
            out.push({
                id: `QP-DEMO-${m + 11}${k}`, kind: 'INSPECT', area: 'PROCESS', date: ymd(d), itemCode: 'P-1001', itemName: '샘플 엔진오일 5W-30', lot: `L${ymd(d).replace(/-/g, '').slice(2)}`,
                process: ['충진', '캡핑', '라벨 부착'][k], inspectedQty: pIns, unit: 'EA', defects: procTypes.map((t, i) => ({ type: t, qty: pDef[i] })).filter(x => x.qty > 0),
                defectQty: pDef.reduce((s, x) => s + x, 0), result: 'PASS', inspector: '김현장', by: '김현장', createdAt: `${ymd(d)}T16:00:00`, updatedAt: `${ymd(d)}T16:00:00`
            });
            if (k < 2) {
                const mIns = 500 + ((k * 3 + m + 30) % 4) * 250;
                const mDef = [2 + ((k + m + 40) % 4), (m + 40) % 3, k];
                const md = mDef.reduce((s, x) => s + x, 0);
                out.push({
                    id: `QM-DEMO-${m + 11}${k}`, kind: 'INSPECT', area: 'MATERIAL', date: ymd(d), itemCode: 'M-4001', itemName: '샘플 4L 용기', lot: `M${ymd(d).replace(/-/g, '').slice(2)}`,
                    supplier: ['샘플용기', '가나포장'][k], inspectedQty: mIns, unit: 'EA', defects: matTypes.map((t, i) => ({ type: t, qty: mDef[i] })).filter(x => x.qty > 0),
                    defectQty: md, result: md / mIns > 0.012 ? 'COND' : 'PASS', cause: md / mIns > 0.012 ? '운송 중 파손' : '', action: md / mIns > 0.012 ? '공급처 시정 요구' : '', actionDone: m < -1,
                    inspector: '박품질', by: '박품질', createdAt: `${ymd(d)}T11:00:00`, updatedAt: `${ymd(d)}T11:00:00`
                });
            }
        }
    }
    out.push(
        { id: 'EQ-DEMO-1', kind: 'EQUIP', code: 'EQ-FIL-01', name: '샘플 4L 자동 충진기', category: '충진기', location: '김포공장 / 김포1B', maker: '샘플기계', model: 'AF-4000', installDate: dayOff(-400), cycleDays: 30, status: 'RUN', manager: '김현장', date: dayOff(-400) },
        { id: 'EQ-DEMO-2', kind: 'EQUIP', code: 'EQ-CAP-01', name: '샘플 캡핑기', category: '캡핑기', location: '김포공장 / 김포1B', maker: '샘플기계', model: 'CP-200', installDate: dayOff(-300), cycleDays: 14, status: 'RUN', manager: '김현장', date: dayOff(-300) },
        { id: 'EQ-DEMO-3', kind: 'EQUIP', code: 'EQ-MIX-01', name: '샘플 블렌딩 탱크 교반기', category: '블렌딩·교반', location: '본사 / 본사2A', maker: '샘플산업', model: 'MX-5T', installDate: dayOff(-900), cycleDays: 90, status: 'REPAIR', manager: '이창고', date: dayOff(-900) },
        { id: 'EQ-DEMO-4', kind: 'EQUIP', code: 'EQ-LAB-01', name: '샘플 점도계', category: '계측·시험기', location: '본사 / 본사1A', maker: '샘플계측', model: 'VS-10', installDate: dayOff(-200), cycleDays: 365, status: 'RUN', manager: '박품질', date: dayOff(-200) },
        { id: 'EL-DEMO-1', kind: 'EQUIP_LOG', equipId: 'EQ-DEMO-1', date: dayOff(-27), logKind: 'CHECK', result: '이상 없음', desc: '노즐 누유·충진량 확인', worker: '김현장' },
        { id: 'EL-DEMO-2', kind: 'EQUIP_LOG', equipId: 'EQ-DEMO-2', date: dayOff(-20), logKind: 'CHECK', result: '조치 완료', desc: '토크 재설정', worker: '김현장' },
        { id: 'EL-DEMO-3', kind: 'EQUIP_LOG', equipId: 'EQ-DEMO-3', date: dayOff(-3), logKind: 'REPAIR', result: '외부 수리 의뢰', desc: '교반 모터 과열', downHours: 6, cost: 450000, worker: '이창고' },
        { id: 'EL-DEMO-5', kind: 'EQUIP_LOG', equipId: 'EQ-DEMO-3', date: dayOff(-80), logKind: 'PM', result: '조치 완료', desc: '베어링 그리스 보충', worker: '이창고' },
        { id: 'EL-DEMO-4', kind: 'EQUIP_LOG', equipId: 'EQ-DEMO-4', date: dayOff(-180), logKind: 'CALIB', result: '이상 없음', desc: '표준액 검교정', worker: '박품질' },
        { id: 'MS-DEMO-1', kind: 'MSDS', itemCode: 'R-3001', itemName: '샘플 기유 A', substance: '샘플 광유계 기유', supplier: '가나화학', casNo: '00000-00-1', revNo: 'Rev.3', revDate: dayOff(-1100), date: dayOff(-1100), signal: 'WARNING', ghs: ['GHS07', 'GHS08'], language: '한국어', place: '김포1C 창고동' },
        { id: 'MS-DEMO-2', kind: 'MSDS', itemCode: 'R-3002', itemName: '샘플 첨가제 B', substance: '샘플 청정분산제', supplier: '다라케미칼', casNo: '00000-00-2', revNo: 'Rev.1', revDate: dayOff(-400), reviewDate: dayOff(40), date: dayOff(-400), signal: 'DANGER', ghs: ['GHS05', 'GHS07', 'GHS09'], language: '한국어·영어', place: '본사2B 창고동' },
        { id: 'MS-DEMO-3', kind: 'MSDS', itemCode: 'P-1001', itemName: '샘플 엔진오일 5W-30', substance: '샘플 엔진오일 5W-30', supplier: '자사', casNo: '', revNo: 'Rev.2', revDate: dayOff(-200), date: dayOff(-200), signal: 'NONE', ghs: [], language: '한국어', place: '본사 사무실' }
    );
    return out;
})();
const qcRptKey = `QC:RPT-PRODUCT:${monthStart(-5)}~${T}`;
const demoApprovals = {
    [qcRptKey]: { type: 'QC_REPORT', title: `제품관리 불량률 보고서 ${monthStart(-5)} ~ ${T}`, date: T, roles: ['작성', '검토', '팀장', '승인'], base: ['작성', '검토', '승인'], custom: ['작성', '검토', '팀장', '승인'],
        slots: {}, recipients: [{ uid: 'manager', name: '김물류' }], cc: [{ uid: 'viewer', name: '박조회' }], shares: [], updatedAt: `${T}T09:00:00` }
};
const demoAttach = { 'MSDS:MS-DEMO-1': [{ id: 'a1', key: 'MSDS:MS-DEMO-1', name: '샘플기유A_MSDS.pdf', mime: 'application/pdf', size: 245760, data: 'data:application/pdf;base64,AA==', by: '박품질', at: `${T}T09:00:00` }],
    'MSDS:MS-DEMO-3': [{ id: 'a2', key: 'MSDS:MS-DEMO-3', name: '5W30_MSDS.pdf', mime: 'application/pdf', size: 188416, data: 'data:application/pdf;base64,AA==', by: '박품질', at: `${T}T09:00:00` }] };

const demoStorage = {
    daelim_supabase_url: 'manual-demo', daelim_supabase_key: 'x', // 로컬(오프라인) 모드
    daelim_master: master, daelim_inventory: inventory, daelim_history: history, daelim_rawLedger: rawLedger,
    daelim_workers: workers, daelim_schedules: schedules, daelim_slips: slips, daelim_locations: locations,
    daelim_currentWorker: JSON.stringify('김현장 (현장 작업자)'), daelim_theme: 'light',
    daelim_product_recipes: boms, daelim_plans: planRows, daelim_prodSchedule: prodSchedule, daelim_todos_admin: asgTodos, daelim_notices: notices, daelim_hqLogs: fakeLogs('HQ'), daelim_gimpoLogs: fakeLogs('GIMPO'),
    daelim_notice_seen_admin: new Date(Date.now() - 2 * 86400000).toISOString(),
    daelim_documents: documents, daelim_filestore_tab: 'images',
    daelim_qc_records: qcRecords, daelim_approvals: demoApprovals, daelim_attachments: demoAttach,
    // 자료실 예시 (가짜 파일: 이름·크기만 보이게 아주 작은 dataURL, 대림 로고 자료는 앱이 기본으로 보여 줌)
    daelim_library: [
        { id: 'LIB-1', category: '양식·서식', title: '샘플 일일 작업일보 양식', desc: '현장 작업일보 엑셀 양식입니다. 매일 작성해 팀장에게 제출합니다.', pinned: false, by: '박품질', uploadedBy: null, at: `${T}T10:00:00`, updatedAt: `${T}T10:00:00`,
            files: [{ id: 'lf1', name: '작업일보_양식.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 24576, data: 'data:application/octet-stream;base64,AA==' },
                { id: 'lf2', name: '작업일보_작성예시.pdf', mime: 'application/pdf', size: 188416, data: 'data:application/pdf;base64,AA==' }] },
        { id: 'LIB-2', category: '규정·지침', title: '샘플 안전보건 관리 지침', desc: '보호구 착용·화기 작업·위험물 보관 기준을 정리한 지침입니다.', pinned: false, by: '김물류', uploadedBy: null, at: `${T}T09:00:00`, updatedAt: `${T}T09:00:00`,
            files: [{ id: 'lf3', name: '안전보건_관리지침.pdf', mime: 'application/pdf', size: 512000, data: 'data:application/pdf;base64,AA==' }] }
    ],
    // 라인 스캔 집계 예시 (집계 중 1.5시간)
    daelim_line_session: { site: 'GIMPO', line: '자동', date: T, lot: T.replace(/-/g, '').slice(2), worker: '홍길동', workersCount: 3, ignoreSec: 0, workHours: '',
        running: true, startedAt: Date.now() - 5400000, activeMs: 5400000, resumedAt: Date.now(), mode: 'LOG',
        counts: { 'P-1001': 412, 'P-1002': 188 }, unknown: { '8801234567890': 3 },
        recent: [['P-1001 샘플 엔진오일 5W-30', true], ['P-1001 샘플 엔진오일 5W-30', true], ['✗ 8801234567890', false], ['P-1002 샘플 엔진오일 10W-40', true], ['P-1002 샘플 엔진오일 10W-40', true]]
            .map(([text, ok], i) => ({ t: Date.now() - i * 4000, text, ok })) },
    daelim_line_perbox: { 'P-1001': 4, 'P-1002': 12 },
    // 보고서 메뉴 예시 (가짜 파일: 이름·크기만 보이게 아주 작은 dataURL)
    daelim_reports: [
        { id: 'DOC-PLAN-SAMPLE', kind: 'DOC', title: '샘플 업무 추진계획 및 일정', period: T.slice(0, 7), scope: '생산공급망팀', summary: '개요 · 추진 일정표 · 단계별 추진 내용', created_by_name: '박품질', created_at: `${T}T11:00:00`, updated_at: `${T}T11:00:00`, files: [],
            content: { html: `<style>.gantt{border:1px solid #94a3b8;padding:6px}.g-head,.g-row{display:grid;grid-template-columns:200px 1fr;align-items:center}.g-head .g-track{display:flex}.g-head .g-track span{font-size:11px;text-align:center}.g-track{position:relative;height:18px}.g-bar{position:absolute;top:4px;height:10px;border-radius:3px}.g-bar.done{background:#22c55e}.g-bar.work{background:#3b82f6}.g-bar.plan{background:#94a3b8}.g-ms{position:absolute;top:3px;width:12px;height:12px;transform:translateX(-50%) rotate(45deg);background:#64748b}.g-today{position:absolute;top:0;bottom:0;border-left:2px dashed #dc2626}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.card{border:1px solid #cbd5e1;padding:6px}</style>
<h1>샘플 업무 추진계획 및 일정</h1><div class="byline">예시 보고서</div><p class="lead"><b>요약:</b> 예시 과제를 세 단계로 나눠 추진합니다.</p>
<h2>1. 개요</h2><ul><li><b>목적:</b> 예시 업무 개선</li><li><b>기간:</b> 3개월</li></ul>
<h2>2. 추진 일정표</h2><div class="gantt"><div class="g-head"><div></div><div class="g-track"><span style="width:33.3%">1개월차</span><span style="width:33.3%">2개월차</span><span style="width:33.4%">3개월차</span></div></div>
<div class="g-row"><div class="g-label">현황 조사</div><div class="g-track"><div class="g-bar done" style="left:0%;width:20%"></div><div class="g-today" style="left:30%"></div></div></div>
<div class="g-row"><div class="g-label">개선안 작성</div><div class="g-track"><div class="g-bar work" style="left:20%;width:25%"></div><div class="g-today" style="left:30%"></div></div></div>
<div class="g-row"><div class="g-label">시범 적용 개시</div><div class="g-track"><div class="g-ms plan" style="left:50%"></div><div class="g-today" style="left:30%"></div></div></div>
<div class="g-row"><div class="g-label">확대 적용 · 정착</div><div class="g-track"><div class="g-bar plan" style="left:50%;width:50%"></div><div class="g-today" style="left:30%"></div></div></div></div>
<h2>3. 단계별 추진 내용</h2><table><colgroup><col style="width:30mm"><col style="width:30mm"><col></colgroup><tr><th>단계</th><th>기간</th><th>추진 내용</th></tr><tr><td>1. 조사</td><td>1개월차</td><td>현황 조사<br>문제점 정리</td></tr><tr><td>2. 개선</td><td>2개월차</td><td>개선안 작성 · 시범 적용</td></tr><tr><td>3. 정착</td><td>3개월차</td><td>확대 적용 · 교육</td></tr></table>
<div class="grid2"><div class="card"><b>기대 효과</b><br>작업 시간 단축</div><div class="card"><b>유의사항</b><br>단계별 점검</div></div>` } },
        { id: `MEETING-${T.slice(0, 7)}-ALL`, kind: 'MEETING', title: `${T.slice(0, 4)}년 ${Number(T.slice(5, 7))}월 생산공급망팀 월례회의`, period: T.slice(0, 7), scope: '전체 (본사·김포)', summary: '전월 실적 · 이달 계획', content: {}, created_by_name: '박품질', created_at: `${T}T09:00:00`, updated_at: `${T}T09:00:00`,
            files: [{ id: 'f1', name: '월례회의.pptx', type: 'pptx', size: 590052, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', data: 'data:application/octet-stream;base64,AA==', at: `${T}T09:00:00`, by: '박품질' },
                { id: 'f2', name: '월례회의_보고서.html', type: 'html', size: 442944, mime: 'text/html', data: 'data:text/html;base64,PGh0bWw+PC9odG1sPg==', at: `${T}T09:05:00`, by: '박품질' }] },
        { id: 'DOC-SAMPLE', kind: 'DOC', title: '샘플 시스템 연동 검토 보고서', period: T.slice(0, 7), scope: '생산공급망팀', summary: '연동 방법 · 검토사항 · 추천 방안', created_by_name: '박품질', created_at: `${T}T10:00:00`, updated_at: `${T}T10:00:00`, files: [],
            content: { html: '<h1>샘플 시스템 연동 검토 보고서</h1><div class="byline">예시 문서</div><p class="lead"><b>결론:</b> 조회 연동부터 단계적으로 적용합니다.</p><h2>연동 구조</h2><div class="flow"><div class="box"><b>WMS</b>입출고 입력</div><div class="arrow">⇄</div><div class="box main"><b>중계 서버</b>인증키 보관</div><div class="arrow">⇄</div><div class="box"><b>외부 시스템</b>판매·구매</div></div><h2>검토사항</h2><table><tr><th>구분</th><th>검토할 점</th><th>대응</th></tr><tr><td>품목코드</td><td>코드가 서로 다름</td><td>대응표 작성</td></tr><tr><td>중복 전송</td><td>같은 전표가 두 번</td><td>전송 기록으로 막음</td></tr></table>' } }
    ]
};

// ---------- 찍을 화면 ----------
// tab: 이동할 탭, run: 탭을 연 뒤 실행할 브라우저 코드(문자열), clip: 찍을 요소(없으면 본문), full: 화면 전체
const scan = (text) => `(async () => { const i = document.querySelector('#scan-manual-code'); i.value = ${JSON.stringify(text)}; document.querySelector('#btn-search-scanned').click(); await new Promise(r => setTimeout(r, 500)); })()`;
const SHOTS = [
    // 로그인 화면은 업무 데이터가 없는 공개 화면이라 실제 배포 사이트(클라우드 로그인: 이메일·구글)를 찍는다
    { name: 'login', url: 'https://ykyyyky55-cmd.github.io/daelim-wms/', full: true },
    { name: 'login-signup', url: 'https://ykyyyky55-cmd.github.io/daelim-wms/', full: true,
        run: `(async () => { [...document.querySelectorAll('button')].find(b => /신규 계정|회원가입|가입/.test(b.textContent))?.click(); await new Promise(r => setTimeout(r, 600)); })()` },
    { name: 'layout', tab: 'home', full: true },
    { name: 'nav-mega', tab: 'home', full: true, vh: 720, run: `(async () => { document.querySelector('#nav-tabs-scroll')?.dispatchEvent(new MouseEvent('mouseenter')); await new Promise(r => setTimeout(r, 500)); })()` },
    { name: 'home', tab: 'home' },
    { name: 'worklog', tab: 'gimpoLog' },
    { name: 'prod-schedule', tab: 'prodSchedule', wait: 2500 },
    { name: 'prod-schedule-edit', tab: 'prodSchedule', wait: 2500, vh: 1400, clip: '#ps-modal > div', maxH: 1300,
        run: `(async () => { [...document.querySelectorAll('tr[data-id]')].find(t => t.dataset.id === 'PS-S2')?.querySelector('.ps-edit')?.click(); await new Promise(r => setTimeout(r, 800)); })()` },
    { name: 'production', tab: 'production' },
    { name: 'scan-item', tab: 'scan', run: scan('P-1001') },
    { name: 'scan-continuous', tab: 'scan', run: `(async () => { const c = document.querySelector('#chk-continuous-mode'); c.checked = true; c.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 300)); await ${scan('P-1001')}; await ${scan('P-1001')}; await ${scan('M-4001')}; })()` },
    { name: 'scan-location', tab: 'scan', run: scan('LOC:김포공장 / 2동') },
    { name: 'scan-slip', tab: 'scan', run: `(async () => { await ${scan(`SLIP:RQ-${T.replace(/-/g, '')}-001`)}; await ${scan('P-1001')}; await ${scan('P-1001')}; await ${scan('P-1001')}; await ${scan('P-1002')}; })()` },
    { name: 'scan-raw', tab: 'scan', run: scan('RAW:R-3001@김포') },
    { name: 'scan-lot', tab: 'scan', run: `(async () => { await ${scan('LOT:LOT-SAMPLE-0921')}; await new Promise(r => setTimeout(r, 800)); })()` },
    { name: 'scan-mobile', tab: 'scan', mobile: true, full: true, run: scan('P-1001') },
    { name: 'label', tab: 'label' },
    { name: 'label-designer', tab: 'labelDesigner' },
    { name: 'field-qr', tab: 'fieldQr', run: `(async () => { document.querySelector('#fq-all').click(); await new Promise(r => setTimeout(r, 1200)); })()` },
    { name: 'master', tab: 'master' },
    { name: 'inventory', tab: 'inventory' },
    { name: 'doc-scan', tab: 'docScan' },
    { name: 'raw-ledger', tab: 'rawLedger' },
    { name: 'product-ledger', tab: 'productLedger' },
    { name: 'material-ledger', tab: 'ledger' },
    { name: 'ledger-viewer', tab: 'ledgerViewer' },
    { name: 'audit', tab: 'audit', run: `(async () => { document.querySelector('#btn-subtab-wms-audit')?.click(); await new Promise(r => setTimeout(r, 600)); })()` },
    { name: 'audit-scan', tab: 'audit', run: `(async () => { document.querySelector('#btn-subtab-wms-audit')?.click(); await new Promise(r => setTimeout(r, 500)); document.querySelector('#btn-audit-scan-mode').click(); await new Promise(r => setTimeout(r, 1200));
        const add = async (t) => { const i = document.querySelector('#as-input'); i.value = t; document.querySelector('#as-add').click(); await new Promise(r => setTimeout(r, 250)); };
        await add('LOC:김포공장 / 2동'); await add('M-4001'); await add('M-4001'); await add('M-4002'); await new Promise(r => setTimeout(r, 600)); })()`, clip: '#audit-scan-host' },
    { name: 'calendar', tab: 'calendar' },
    { name: 'analytics', tab: 'analytics', wait: 4000 },
    { name: 'analytics-oil', tab: 'analytics', onScreen: true, wait: 4000, clip: '#an-oil' },
    { name: 'analytics-manhours', tab: 'analytics', onScreen: true, wait: 4000, clip: '#an-manhours' },
    { name: 'analytics-raw', tab: 'analytics', wait: 4000, run: `(async () => { document.querySelector('.an-board[data-b="raw"]')?.click(); await new Promise(r => setTimeout(r, 2500)); })()`, maxH: 1400 },
    { name: 'analytics-work', tab: 'analytics', onScreen: true, wait: 4000, clip: '#an-work' },
    { name: 'meeting-dialog', tab: 'analytics', wait: 3000, vh: 1100, clip: '#meeting-modal > div', maxH: 1000,
        run: `(async () => { document.querySelector('#btn-monthly-meeting')?.click(); await new Promise(r => setTimeout(r, 1500)); document.querySelector('#mt-next-m')?.click(); await new Promise(r => setTimeout(r, 800)); const n = document.querySelector('#mt-next'); if (n && !n.value) n.value = '10월 성수기 출하 대응 (주 6일 포장 운영)\\n자동 캡핑기 시운전 완료'; })()` },
    { name: 'meeting-pdf', tab: 'analytics', wait: 3000, clip: '.page', maxH: +(process.env.MEETING_PDF_H || 1150),
        run: `(async () => { document.querySelector('#btn-monthly-meeting')?.click(); await new Promise(r => setTimeout(r, 1500)); document.querySelector('#mt-next-m')?.click(); await new Promise(r => setTimeout(r, 800)); let html = ''; window.open = () => ({ document: { write: (h) => { html += h; }, open() { html = ''; }, close() {} }, close() {} });
            document.querySelector('#mt-pdf').click(); for (let i = 0; i < 80 && !html.includes('</html>'); i++) await new Promise(r => setTimeout(r, 250));
            document.open(); document.write(html.replace('window.print();', '')); document.close(); await new Promise(r => setTimeout(r, 1500)); })()` },
    { name: 'line-count', tab: 'lineCount', wait: 1500 },
    { name: 'reports', tab: 'reports', wait: 2500, maxH: 1300, run: `(async () => { document.querySelector('.rp-open')?.click(); await new Promise(r => setTimeout(r, 1500)); })()` },
    { name: 'work-plan-month', tab: 'workPlan', pending: { view: 'month' }, wait: 2500, maxH: 1300 },
    { name: 'work-plan-year', tab: 'workPlan', pending: { view: 'year' }, wait: 3000, maxH: 1500 },
    { name: 'analytics-tasks', tab: 'analytics', onScreen: true, wait: 3000, clip: '#an-tasks', run: `document.querySelector('#an-tasks details')?.setAttribute('open', '')` },
    { name: 'planning', tab: 'planning' },
    { name: 'history', tab: 'history' },
    { name: 'settings', tab: 'settings' },
    { name: 'settings-master', tab: 'settings', run: `(async () => { document.querySelector('[data-sec="master"]')?.click(); await new Promise(r => setTimeout(r, 600)); })()` },
    { name: 'slip-issuer', tab: 'settings', vh: 2000, run: `(async () => { document.querySelector('[data-sec="master"]')?.click(); await new Promise(r => setTimeout(r, 600)); document.querySelector('#btn-open-slip-modal')?.click(); await new Promise(r => setTimeout(r, 800));
        const m = document.querySelector('#modal-slip');
        const t = m.querySelector('#slip-type'); t.value = 'RELEASE'; t.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 300));
        const to = m.querySelector('#slip-to'); to.value = '외부 거래처'; to.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 200));
        const p = m.querySelector('#slip-partner'); p.value = '가나상사'; p.dispatchEvent(new Event('input'));
        for (const [code, qty] of [['P-1001', 3], ['P-1002', 2]]) {
            const s = m.querySelector('#slip-item-search'); s.value = code; s.dispatchEvent(new Event('input')); s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            await new Promise(r => setTimeout(r, 200)); m.querySelector('#slip-item-qty').value = qty; m.querySelector('#slip-item-add').click(); await new Promise(r => setTimeout(r, 300));
        } })()`, clip: '#modal-slip > div', maxH: 1900 },
    { name: 'unit-conv', tab: 'unitConv' },
    { name: 'oil-calc', tab: 'oilcalc' },
    { name: 'doc-tools', tab: 'docTools' },
    // 생산관리
    { name: 'prod-plan-week', tab: 'prodPlan', pending: { view: 'week' }, wait: 2500, clip: '#pp-body > div', maxH: 1100 },
    { name: 'prod-plan-short', tab: 'prodPlan', pending: { view: 'week' }, wait: 3000, clip: '#pp-short', maxH: 900 },
    { name: 'prod-plan-safety', tab: 'prodPlan', pending: { view: 'week' }, wait: 3000, clip: '#pp-safety', maxH: 700 },
    { name: 'prod-plan-day', tab: 'prodPlan', pending: { view: 'day' }, wait: 2500 },
    { name: 'prod-plan-month', tab: 'prodPlan', pending: { view: 'month' }, wait: 3000, maxH: 1300 },
    { name: 'purch-plan-week', tab: 'purchPlan', pending: { view: 'week' }, wait: 3000, maxH: 1300 },
    { name: 'purch-plan-month', tab: 'purchPlan', pending: { view: 'month' }, wait: 2500 },
    { name: 'prod-request', tab: 'prodRequest', run: `(async () => { localStorage.removeItem('daelim_req_type_PRODUCT_RAW'); await new Promise(r => setTimeout(r, 800)); document.querySelector('.rq-item')?.click(); await new Promise(r => setTimeout(r, 600)); })()` },
    { name: 'prod-request-raw', tab: 'prodRequest', run: `(async () => { await new Promise(r => setTimeout(r, 800)); document.querySelector('.rq-type[data-t="RAW"]')?.click(); await new Promise(r => setTimeout(r, 900)); document.querySelector('.rq-item')?.click(); await new Promise(r => setTimeout(r, 600)); })()` },
    { name: 'purch-request', tab: 'purchRequest', run: `(async () => { await new Promise(r => setTimeout(r, 800)); document.querySelector('.rq-item')?.click(); await new Promise(r => setTimeout(r, 600)); })()` },
    { name: 'plan-print', tab: 'prodPlan', pending: { view: 'week' }, wait: 2500, full: true,
        run: `(async () => { await new Promise(r => setTimeout(r, 1500)); window.confirm = () => true; for (const role of ['작성', '검토']) { document.querySelector('#pp-appr .appr-cell[data-role="' + role + '"]')?.click(); await new Promise(r => setTimeout(r, 900)); } let html = ''; window.open = () => ({ document: { write: (h) => { html += h; }, close() {} } });
            document.querySelector('#pp-print').click(); await new Promise(r => setTimeout(r, 1000));
            document.open(); document.write(html.replace('window.print();', '')); document.close(); await new Promise(r => setTimeout(r, 800)); })()` },
    // 공지사항
    { name: 'pack-standard', tab: 'packStandard', wait: 3500, run: `(async () => {
        const s = (ms) => new Promise(r => setTimeout(r, ms));
        const f = document.getElementById('pack-std-frame'); if (!f) return; const w = f.contentWindow, d = f.contentDocument;
        w.promptAdminFromHome(); await s(300);
        const set = (id, v) => { const el = d.getElementById(id); if (el) el.innerText = v; };
        set('cell_buyer', '다라유통'); set('cell_category', '엔진오일'); set('cell_product', '샘플 엔진오일 5W-30 4L'); set('cell_date', new Date().toISOString().slice(0, 10));
        const vals = ['4L 사각 용기 (예시)', '4L x 4개입', '안전캡 (예시)', '아래 사진 참조', '없음', '아래 사진 참조', '플라스틱 파렛트', '1단 8박스 x 5단', '아웃박스 스티커 LOT', '샘플 엔진오일 원액 A'];
        [...d.querySelectorAll('#a4Container td')].filter(td => /^\\d+\\. /.test(td.innerText.trim())).forEach((td, i) => { const v = td.nextElementSibling; if (v && vals[i]) v.innerText = vals[i]; });
        w.quickSaveToCloud(); await s(1200); w.updateQRCode(); await s(500);
    })()` },
    { name: 'file-images', tab: 'fileStore', wait: 2500, run: uploadFakePhotos },
    { name: 'library', tab: 'library', wait: 2500, maxH: 1300 },
    { name: 'qc-records', tab: 'qcProduct', wait: 2000, maxH: 1200, run: `(async () => { document.querySelector('.qc-v[data-v="records"]')?.click(); await new Promise(r => setTimeout(r, 800)); })()` },
    { name: 'qc-stats', tab: 'qcProduct', wait: 2500, maxH: 1500, run: `(async () => { document.querySelector('.qc-v[data-v="stats"]')?.click(); await new Promise(r => setTimeout(r, 1500)); })()` },
    { name: 'approval-tools', tab: 'qcProduct', wait: 2500, clip: '#qc-rpt-appr', run: `(async () => { document.querySelector('.qc-v[data-v="stats"]')?.click(); await new Promise(r => setTimeout(r, 1500)); })()` },
    { name: 'qc-equipment', tab: 'qcEquipment', wait: 2000, maxH: 1000 },
    { name: 'qc-monthly', tab: 'qcMonthly', wait: 2500, maxH: 1700 },
    { name: 'qc-msds', tab: 'qcMsds', wait: 2000, maxH: 1000 },
    { name: 'file-docs', tab: 'fileStore', wait: 2500, run: `(async () => { document.querySelector('.fs-tab[data-tab="docs"]')?.click(); await new Promise(r => setTimeout(r, 800)); })()` },
    { name: 'file-doc-form', tab: 'fileStore', wait: 2500, clip: '#fd-modal > div', maxH: 900, run: `(async () => { const s = (ms) => new Promise(r => setTimeout(r, ms)); document.querySelector('.fs-tab[data-tab="docs"]')?.click(); await s(800); document.querySelector('tr[data-doc="D-1"]')?.click(); await s(1000); })()` },
    { name: 'notice', tab: 'notice', wait: 2500, run: `(async () => { document.querySelectorAll('.nt-item')[1]?.click(); await new Promise(r => setTimeout(r, 400)); })()` },
    // 담당자 지정·알림
    { name: 'assign-alarm', tab: 'home', full: true, wait: 3500, keepAlarms: true, run: `(async () => { window.__openFloating?.('todo'); await new Promise(r => setTimeout(r, 900)); })()` },
    { name: 'slip-assignee', tab: 'slipIssue', wait: 2500, clip: '#slip-editor', maxH: 700, run: `(async () => {
        const h = document.querySelector('#slip-page'); const a = h.querySelector('#slip-assignee'); await new Promise(r => setTimeout(r, 600)); a.value = 'manager'; a.dispatchEvent(new Event('change'));
        const t = h.querySelector('#slip-ship-time'); t.value = '14:00'; t.dispatchEvent(new Event('change'));
        const s = h.querySelector('#slip-item-search'); s.value = 'P-1001'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await new Promise(r => setTimeout(r, 200)); h.querySelector('#slip-item-qty').value = 40; h.querySelector('#slip-item-add').click(); await new Promise(r => setTimeout(r, 400)); })()` },
    // 전자결재
    { name: 'e-approval', tab: 'eApproval', wait: 4000, run: `(async () => { window.confirm = () => true;
        window.__pendingPlanOpen = { tab: 'prodPlan', view: 'week' }; document.querySelector('[data-tab="prodPlan"]')?.click(); await new Promise(r => setTimeout(r, 2500));
        window.confirm = () => true; for (const role of ['작성', '검토']) { document.querySelector('#pp-appr .appr-cell[data-role="' + role + '"]')?.click(); await new Promise(r => setTimeout(r, 900)); }
        document.querySelector('[data-tab="eApproval"]')?.click(); await new Promise(r => setTimeout(r, 3000)); })()` },
    { name: 'approval-box', tab: 'prodPlan', pending: { view: 'week' }, wait: 2500, clip: '#pp-body > div', maxH: 360,
        run: `(async () => { await new Promise(r => setTimeout(r, 1000)); window.confirm = () => true; for (const role of ['작성', '검토']) { document.querySelector('#pp-appr .appr-cell[data-role="' + role + '"]')?.click(); await new Promise(r => setTimeout(r, 900)); } })()` },
    { name: 'slip-print', tab: 'settings', full: true, vh: 1250, run: `(async () => { window.confirm = () => true; document.querySelector('[data-sec="master"]')?.click(); await new Promise(r => setTimeout(r, 600)); document.querySelector('#btn-open-slip-modal')?.click(); await new Promise(r => setTimeout(r, 800));
        const m = document.querySelector('#modal-slip');
        for (const [code, qty] of [['P-1001', 3], ['P-1002', 2]]) {
            const s = m.querySelector('#slip-item-search'); s.value = code; s.dispatchEvent(new Event('input')); s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            await new Promise(r => setTimeout(r, 200)); m.querySelector('#slip-item-qty').value = qty; m.querySelector('#slip-item-add').click(); await new Promise(r => setTimeout(r, 300));
        }
        let html = ''; window.open = () => ({ document: { write: (h) => { html += h; }, open() { html = ''; }, close() {} }, close() {} });
        m.querySelector('#slip-btn-issue').click(); await new Promise(r => setTimeout(r, 2000));
        m.querySelector('#slip-appr-out .appr-cell')?.click(); await new Promise(r => setTimeout(r, 1000));
        m.querySelector('#slip-btn-issue').click(); await new Promise(r => setTimeout(r, 2000));
        document.open(); document.write(html.replace('window.print();', '')); document.close(); await new Promise(r => setTimeout(r, 1200)); })()` },    { name: 'floating', tab: 'home', full: true, run: `(async () => { window.__openFloating?.('todo'); await new Promise(r => setTimeout(r, 800)); })()` }
];

// ---------- CDP ----------
const browserPath = BROWSERS.find(p => fs.existsSync(p));
if (!browserPath) throw new Error('Chrome/Edge를 찾지 못했습니다.');
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-manual-'));
const proc = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--lang=ko-KR', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let targets = null;
for (let i = 0; i < 50 && !targets; i++) {
    await sleep(200);
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { }
}
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const listeners = [];
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) listeners.forEach(l => l(msg));
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
};
// 로드 이벤트를 기다리되 10초가 넘으면 그냥 진행 (주소의 #만 바뀌면 로드 이벤트가 없음)
const waitLoad = () => new Promise(res => {
    const l = (m) => { if (m.method === 'Page.loadEventFired') done(); };
    const done = () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); clearTimeout(t); res(); };
    const t = setTimeout(done, 10000);
    listeners.push(l);
});
// 매번 실제로 새로 불러오도록 쿼리를 붙인다 (앱은 scan·code·q 외의 쿼리를 쓰지 않음)
let navSeq = 0;
const goto = async (url) => {
    const [base, hash = ''] = url.split('#');
    const w = waitLoad();
    await send('Page.navigate', { url: `${base}${base.includes('?') ? '&' : '?'}m=${++navSeq}${hash ? `#${hash}` : ''}` });
    await w;
};
const setViewport = (mobile, vh = 900) => send('Emulation.setDeviceMetricsOverride', mobile
    ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
    : { width: 1440, height: vh, deviceScaleFactor: 1, mobile: false });

await send('Page.enable');
// 그래프 애니메이션 없이 찍기 (헤드리스는 requestAnimationFrame이 멈춰 첫 장면에 머무름)
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Runtime.enable');

const prepare = async ({ loggedOut, mobile, url, vh }) => {
    await setViewport(!!mobile, vh);
    if (url) { // 공개 화면 (예시 데이터 없이)
        await goto(url);
        await sleep(3000);
        return;
    }
    await goto(APP);
    await evaluate(`(() => { localStorage.clear(); sessionStorage.clear();
        const d = ${JSON.stringify(demoStorage)};
        for (const [k, v] of Object.entries(d)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        ${loggedOut ? '' : `localStorage.setItem('daelim_auth_session', JSON.stringify({ username: 'admin', loggedAt: new Date().toISOString() }));`}
    })()`);
    await goto(APP + '#home');
    await sleep(2500); // Tailwind CDN·글꼴·아이콘
};

let done = 0;
for (const s of SHOTS) {
    if (only.length && !only.includes(s.name)) continue;
    await prepare(s);
    if (s.tab) {
        // 생산관리 화면은 보기(주간·일일·월간)와 날짜(이번 주 월요일)를 정해 연다
        if (s.pending) await evaluate(`window.__pendingPlanOpen = ${JSON.stringify({ tab: s.tab, date: monday, ...s.pending })}`);
        await evaluate(`window.__switchTab(${JSON.stringify(s.tab)})`);
        await sleep(s.wait || 1500);
    }
    if (s.run) { await evaluate(s.run); await sleep(700); }
    // 담당자 알림 카드는 그 장면(keepAlarms)에서만 남긴다
    await evaluate(`window.scrollTo(0, 0); document.getElementById('toast-container')?.remove();${s.keepAlarms ? '' : ` document.getElementById('ft-alarms')?.replaceChildren();`}`);
    await sleep(300);
    // 화면 아래쪽 요소는 보이는 곳으로 옮겨야 캔버스(차트)가 그려진 채로 찍힌다
    // (머리글이 가리지 않게 요소 위로 250px 여유)
    if (s.onScreen) { await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(s.clip)}); if (el) window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 250); })()`); await sleep(800); }
    let clip;
    if (!s.full) {
        const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(s.clip || '#main-content')}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`);
        if (!rect) { console.warn(`[건너뜀] ${s.name}: 요소 없음`); continue; }
        clip = { ...rect, height: Math.min(rect.height, s.maxH || 1000), scale: 1 };
    }
    const shot = await send('Page.captureScreenshot', { format: 'webp', quality: 72, ...(clip ? { clip, captureBeyondViewport: !s.onScreen } : {}) }); // onScreen: 화면 안에서 찍음 (창 크기가 바뀌면 차트가 지워졌다 다시 그려짐)
    fs.writeFileSync(path.join(OUT, `${s.name}.webp`), Buffer.from(shot.data, 'base64'));
    done++;
    console.log(`✓ ${s.name}.webp`);
}

ws.close();
proc.kill();
await sleep(500);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
console.log(`완료: ${done}장 → ${OUT}`);
