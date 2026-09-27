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
    rawEntry('RAW-S5', dayOff(-3), 'B-2001', '샘플 엔진오일 원액 A', '입고', 3200, 0, 0.87, 'BL-01')
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
        reqDate: T, dueDate: wd(4), site: '김포', dept: '영업팀', requester: '최영업', partner: '다라물산', urgent: true, reason: '신규 거래처 초도 물량', reviewNote: '이번 주 화요일 생산 예정', planWeek: monday,
        lines: [{ id: 'RL1', code: 'P-1002', name: mOf('P-1002').name, spec: '1L', qty: 300, unit: 'EA', pack: '1L x 20 박스', note: '' }] } },
    { id: 'PR-S2', kind: 'PROD_REQ', period: T, doc_no: `PR-${T.replace(/-/g, '')}-002`, status: 'REQUESTED', created_at: T, updated_at: T, updated_by: '최영업', data: {
        reqDate: T, dueDate: wd(9), site: '본사', dept: '영업팀', requester: '최영업', partner: '가나상사', urgent: false, reason: '', reviewNote: '',
        lines: [{ id: 'RL2', code: 'P-1004', name: mOf('P-1004').name, spec: '200L 드럼', qty: 8, unit: 'EA', pack: '드럼', note: '' }] } }
];
const matIt = (code, qty) => ({ code, name: mOf(code).name, category: mOf(code).category, unit: mOf(code).unit, qty });
const prodSchedule = [
    { id: 'PS-S1', sheet_date: T, site: '김포', line: '포장1부', status: 'PREP', plan_date: wd(0), due_date: wd(3), partner: '가나상사', item_code: 'P-1001', item_name: mOf('P-1001').name, spec: '4L', qty: 1000, per_box: 4,
        materials: { container: '재고', label: '발주' }, sort_order: 1, mat_items: [matIt('B-2001', 4000), matIt('M-4001', 1000), matIt('M-4003', 250)] },
    { id: 'PS-S2', sheet_date: T, site: '김포', line: '포장1부', status: 'PLANNED', plan_date: wd(4), due_date: wd(6), partner: '가나상사', item_code: 'P-1003', item_name: mOf('P-1003').name, spec: '20L 페일', qty: 120, per_box: 1,
        materials: {}, sort_order: 2, mat_items: [matIt('B-2001', 2400), matIt('M-4004', 120)] }
];

const demoStorage = {
    daelim_supabase_url: 'manual-demo', daelim_supabase_key: 'x', // 로컬(오프라인) 모드
    daelim_master: master, daelim_inventory: inventory, daelim_history: history, daelim_rawLedger: rawLedger,
    daelim_workers: workers, daelim_schedules: schedules, daelim_slips: slips, daelim_locations: locations,
    daelim_currentWorker: JSON.stringify('김현장 (현장 작업자)'), daelim_theme: 'light',
    daelim_product_recipes: boms, daelim_plans: planRows, daelim_prodSchedule: prodSchedule
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
    { name: 'analytics', tab: 'analytics' },
    { name: 'planning', tab: 'planning' },
    { name: 'history', tab: 'history' },
    { name: 'settings', tab: 'settings' },
    { name: 'settings-master', tab: 'settings', run: `(async () => { document.querySelector('[data-sec="master"]')?.click(); await new Promise(r => setTimeout(r, 600)); })()` },
    { name: 'slip-issuer', tab: 'settings', vh: 1600, run: `(async () => { document.querySelector('[data-sec="master"]')?.click(); await new Promise(r => setTimeout(r, 600)); document.querySelector('#btn-open-slip-modal')?.click(); await new Promise(r => setTimeout(r, 800));
        const m = document.querySelector('#modal-slip');
        const t = m.querySelector('#slip-type'); t.value = 'RELEASE'; t.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 300));
        const to = m.querySelector('#slip-to'); to.value = '외부 거래처'; to.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 200));
        const p = m.querySelector('#slip-partner'); p.value = '가나상사'; p.dispatchEvent(new Event('input'));
        for (const [code, qty] of [['P-1001', 3], ['P-1002', 2]]) {
            const s = m.querySelector('#slip-item-search'); s.value = code; s.dispatchEvent(new Event('input')); s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            await new Promise(r => setTimeout(r, 200)); m.querySelector('#slip-item-qty').value = qty; m.querySelector('#slip-item-add').click(); await new Promise(r => setTimeout(r, 300));
        } })()`, clip: '#modal-slip > div', maxH: 1500 },
    { name: 'unit-conv', tab: 'unitConv' },
    { name: 'oil-calc', tab: 'oilcalc' },
    { name: 'doc-tools', tab: 'docTools' },
    // 생산관리
    { name: 'prod-plan-week', tab: 'prodPlan', pending: { view: 'week' }, wait: 2500, clip: '#pp-body > div', maxH: 1100 },
    { name: 'prod-plan-short', tab: 'prodPlan', pending: { view: 'week' }, wait: 3000, clip: '#pp-short', maxH: 900 },
    { name: 'prod-plan-day', tab: 'prodPlan', pending: { view: 'day' }, wait: 2500 },
    { name: 'prod-plan-month', tab: 'prodPlan', pending: { view: 'month' }, wait: 3000, maxH: 1300 },
    { name: 'purch-plan-week', tab: 'purchPlan', pending: { view: 'week' }, wait: 3000, maxH: 1300 },
    { name: 'purch-plan-month', tab: 'purchPlan', pending: { view: 'month' }, wait: 2500 },
    { name: 'prod-request', tab: 'prodRequest', run: `(async () => { await new Promise(r => setTimeout(r, 800)); document.querySelector('.rq-item')?.click(); await new Promise(r => setTimeout(r, 600)); })()` },
    { name: 'plan-print', tab: 'prodPlan', pending: { view: 'week' }, wait: 2500, full: true,
        run: `(async () => { await new Promise(r => setTimeout(r, 1500)); let html = ''; window.open = () => ({ document: { write: (h) => { html += h; }, close() {} } });
            document.querySelector('#pp-print').click(); await new Promise(r => setTimeout(r, 300));
            document.open(); document.write(html.replace('window.print();', '')); document.close(); await new Promise(r => setTimeout(r, 800)); })()` },
    { name: 'floating', tab: 'home', full: true, run: `(async () => { window.__openFloating?.('todo'); await new Promise(r => setTimeout(r, 800)); })()` }
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
    await evaluate(`window.scrollTo(0, 0); document.getElementById('toast-container')?.remove();`);
    await sleep(300);
    let clip;
    if (!s.full) {
        const rect = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(s.clip || '#main-content')}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`);
        if (!rect) { console.warn(`[건너뜀] ${s.name}: 요소 없음`); continue; }
        clip = { ...rect, height: Math.min(rect.height, s.maxH || 1000), scale: 1 };
    }
    const shot = await send('Page.captureScreenshot', { format: 'webp', quality: 72, ...(clip ? { clip, captureBeyondViewport: true } : {}) });
    fs.writeFileSync(path.join(OUT, `${s.name}.webp`), Buffer.from(shot.data, 'base64'));
    done++;
    console.log(`✓ ${s.name}.webp`);
}

ws.close();
proc.kill();
await sleep(500);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
console.log(`완료: ${done}장 → ${OUT}`);
