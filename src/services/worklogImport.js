// ==========================================
// 업무일지(본사·김포) 파일 업로드: 엑셀(.xlsx) 또는 구글 시트 링크 → 날짜별 일지
// ==========================================
// 양식: '(본사/김포)생산공급망 업무일지' — 날짜 시트(MMDD)마다
//   ■ 제품포장작업 / ■ 라벨부착작업 / ■ 원액생산작업 / ■ 구매발주내역 / ■ 입고내역 / ■ 출고내역 / ■ 이동제품 / ■ 택배출고현황(오른쪽 ■ 기타 메모) / ■ 기타업무
// 각 섹션의 머리줄(품명·수량 …)을 읽어 열 위치를 정하므로 본사(원액 J열 = 작업자)·김포(J열 = 카테고리) 양식을 모두 읽는다.
// 날짜: 시트 이름(MMDD) 기준 — 시트를 복사하고 '날짜' 칸을 안 고친 경우가 있어서. 연도는 '날짜' 칸 → 파일 이름 → 올해.
import * as XLSX from 'xlsx';

const s = (v) => String(v ?? '').replace(/\r?\n/g, ' ').trim();
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const r2 = (v) => Math.round(num(v) * 100) / 100;

const SECTIONS = [
    ['packaging', /제품포장/], ['labeling', /라벨부착/], ['oilBlending', /원액생산/], ['purchaseOrders', /구매발주/],
    ['receiving', /입고내역/], ['shipping', /출고내역/], ['movement', /이동제품/], ['courier', /택배/], ['otherTasks', /기타업무/]
];
// 머리줄 글자 → 열 이름
const HEAD_KEYS = [
    ['item', /^(품명|업무명|구분)$/], ['spec', /용량|규격/], ['qty', /^수량/], ['box', /^박스/], ['unit', /^단위/],
    ['workHours', /^작업시간|^시간$/], ['workersCount', /인원/], ['totalWorkHours', /총작업시간|총시간/], ['line', /LINE|라인/i],
    ['lotNo', /LOT/i], ['category', /카테고리/], ['workers', /^작업자$/], ['manHours', /공수/], ['partner', /거래처/],
    ['inspector', /확인자|검수/], ['transport', /운송/], ['vehicle', /차량/], ['driver', /운반자/], ['notes', /^비고$/],
    ['packageType', /포장|용기/], ['count', /건수/]
];

const excelDate = (v) => {
    if (typeof v === 'number' && v > 30000) {
        const d = new Date(Math.round((v - 25569) * 86400000));
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
    const m = String(v || '').match(/(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
};

const headerMap = (row) => {
    const map = {};
    row.forEach((cell, i) => {
        const t = s(cell);
        if (!t) return;
        for (const [k, re] of HEAD_KEYS) { if (map[k] === undefined && re.test(t)) { map[k] = i; break; } }
    });
    return map;
};

/**
 * 시트 한 장 → 일지
 * @returns { log, warnings: [] } | null (날짜 시트가 아니면)
 */
const parseSheet = (ws, sheetName, yearHint) => {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const warnings = [];
    // 날짜 칸
    let cellDate = '';
    for (const r of rows.slice(0, 8)) {
        const i = r.findIndex(c => s(c) === '날짜');
        if (i >= 0) { cellDate = excelDate(r[i + 1]); break; }
    }
    const mm = sheetName.slice(0, 2), dd = sheetName.slice(2, 4);
    const year = (cellDate && cellDate.slice(0, 4)) || yearHint;
    const date = `${year}-${mm}-${dd}`;
    if (cellDate && cellDate !== date) warnings.push(`시트 이름(${mm}/${dd})과 '날짜' 칸(${cellDate})이 달라 시트 이름 기준으로 가져옵니다.`);

    // 결재란(맨 위 두 줄의 I~K열: 제목줄 → 이름줄)
    const appr = (rows[1] || []).slice(8, 11).map(s);
    const log = {
        sheetName, date, month: mm,
        manager: appr[0] || '', reviewer: appr[1] || '', approver: appr[2] || '',
        packaging: [], labeling: [], oilBlending: [], shipping: [], receiving: [], purchaseOrders: [],
        movement: [], courier: [], otherNotes: [], otherTasks: [],
        isSyncedToLedger: false, source: 'upload'
    };
    let sec = null;
    let map = null;
    for (const row of rows) {
        const c0 = s(row[0]);
        if (c0.startsWith('■')) {
            sec = (SECTIONS.find(([, re]) => re.test(c0)) || [null])[0];
            map = null;
            continue;
        }
        if (!sec) continue;
        // 섹션 머리줄 (품명·업무명·구분 …)
        if (!map && /^(품명|업무명|구분)$/.test(c0)) { map = headerMap(row); continue; }
        if (c0.startsWith('총수량') || c0.startsWith('합계')) continue;
        // 택배: 왼쪽 표 + 오른쪽(E열) ■ 기타 메모
        if (sec === 'courier') {
            const note = s(row[4]);
            if (note && !note.startsWith('■') && note !== '비고') log.otherNotes.push(note.replace(/^-\s*/, ''));
            if (c0 && c0 !== '구분' && (num(row[1]) > 0 || s(row[2]))) log.courier.push({ type: c0, count: num(row[1]), notes: s(row[2]) });
            continue;
        }
        if (!c0 || !map) continue;
        const g = (k, def = '') => (map[k] === undefined ? def : row[map[k]]);
        if (sec === 'packaging' || sec === 'labeling') {
            log[sec].push({ item: c0, spec: s(g('spec')), qty: num(g('qty')), box: num(g('box')), workHours: num(g('workHours')), workersCount: num(g('workersCount')),
                totalWorkHours: num(g('totalWorkHours')), line: s(g('line')), lotNo: s(g('lotNo')), category: s(g('category')), manHours: r2(g('manHours')), workers: s(g('workers', row[11])) });
        } else if (sec === 'oilBlending') {
            log.oilBlending.push({ item: c0, spec: s(g('spec')) || 'L', qty: num(g('qty')), packageType: s(g('packageType')), workHours: num(g('workHours')), workersCount: num(g('workersCount')),
                totalWorkHours: num(g('totalWorkHours')), line: s(g('line')), lotNo: s(g('lotNo')), category: s(g('category')), workers: s(g('workers')), manHours: r2(g('manHours')) });
        } else if (sec === 'purchaseOrders') {
            log.purchaseOrders.push({ item: c0, spec: s(g('spec')), qty: num(g('qty')), partner: s(g('partner')), lotNo: s(g('lotNo')), site: s(g('line')), notes: s(g('notes')) });
        } else if (sec === 'receiving') {
            log.receiving.push({ item: c0, spec: s(g('spec')), qty: num(g('qty')), box: s(g('box')), partner: s(g('partner')), inspector: s(g('inspector')), notes: s(g('notes')) });
        } else if (sec === 'shipping') {
            log.shipping.push({ item: c0, spec: s(g('spec')), qty: num(g('qty')), box: s(g('box')), partner: s(g('partner')), inspector: s(g('inspector')), transport: s(g('transport')), notes: s(g('notes')) });
        } else if (sec === 'movement') {
            // 수량을 '단위' 칸에 적은 줄 (단위=숫자, 수량 비어 있음) 바로잡기
            let unit = s(g('unit')) || 'EA';
            let qty = num(g('qty'));
            if (/^[\d,.]+$/.test(unit) && !qty) { qty = num(unit); unit = 'EA'; }
            log.movement.push({ item: c0, spec: s(g('spec')), unit, qty, box: s(g('box')), vehicle: s(g('vehicle')), driver: s(g('driver')), route: s(g('notes')) || s(row[7]) });
        } else if (sec === 'otherTasks') {
            log.otherTasks.push({ task: c0, spec: s(g('spec')), qty: num(g('qty')), unit: s(g('unit')), workHours: num(g('workHours')), workersCount: num(g('workersCount')),
                totalWorkHours: num(g('totalWorkHours')), worker: s(g('notes')) || s(row[7]), manHours: r2(g('manHours')) });
        }
    }
    const count = ['packaging', 'labeling', 'oilBlending', 'purchaseOrders', 'receiving', 'shipping', 'movement', 'otherTasks'].reduce((n, k) => n + log[k].length, 0) + log.courier.length;
    return { log, warnings, count };
};

// ---------- 이미 있는 일지와 견주기 (같은 파일을 다시 올려도 있는 줄은 다시 넣지 않는다) ----------
/** 견주는 항목 (줄 목록) — otherNotes는 글자 목록 */
export const MERGE_SECTIONS = ['packaging', 'labeling', 'oilBlending', 'purchaseOrders', 'receiving', 'shipping', 'movement', 'courier', 'otherTasks', 'otherNotes'];
const keyText = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, '');
const keyNum = (v) => String(Math.round(num(v) * 1000) / 1000);
/** 같은 줄인지 판단하는 열쇠: 품명(업무명)·규격·수량·LOT·거래처·경로·박스 — 시간·공수·작업자처럼 나중에 고치는 칸은 보지 않는다 */
const rowKey = (sec, row) => {
    if (sec === 'otherNotes') return keyText(row);
    if (sec === 'courier') return [keyText(row.type), keyNum(row.count), keyText(row.notes)].join('|');
    return [keyText(row.item ?? row.task), keyText(row.spec), keyNum(row.qty), keyText(row.lotNo), keyText(row.partner), keyText(row.route), keyNum(row.box)].join('|');
};
/**
 * 올린 일지에서 이미 있는 일지에 없는 줄만 고른다. 같은 줄이 여러 개면 개수까지 맞춘다(파일에 2줄·일지에 1줄이면 1줄만 새 줄).
 * @param {Object | null | undefined} existing 이미 있는 일지 (없으면 올린 줄 모두가 새 줄)
 * @param {Object} uploaded 파일에서 읽은 일지
 * @returns {{ added: Record<string, Array>, count: number }}
 */
export const missingWorklogRows = (existing, uploaded) => {
    const added = {};
    let count = 0;
    MERGE_SECTIONS.forEach(sec => {
        const have = new Map();
        (existing?.[sec] || []).forEach(row => { const k = rowKey(sec, row); have.set(k, (have.get(k) || 0) + 1); });
        added[sec] = (uploaded[sec] || []).filter(row => {
            const k = rowKey(sec, row);
            const left = have.get(k) || 0;
            if (left > 0) { have.set(k, left - 1); return false; }
            return true;
        });
        count += added[sec].length;
    });
    return { added, count };
};
/** 이미 있는 일지 끝에 새 줄만 붙인 일지 (있던 줄·결재자·반영 상태는 그대로) */
export const mergeWorklogRows = (existing, added) => {
    const merged = { ...existing };
    MERGE_SECTIONS.forEach(sec => { if (added[sec]?.length) merged[sec] = [...(existing[sec] || []), ...added[sec]]; });
    return merged;
};

/** 통합문서 → 날짜 시트별 일지 [{ sheetName, log, warnings, count }] (날짜 순) */
export const parseWorklogWorkbook = (wb, fileName = '') => {
    const yearHint = (String(fileName).match(/20\d{2}/) || [String(new Date().getFullYear())])[0];
    const out = [];
    for (const name of wb.SheetNames) {
        if (!/^\d{4}$/.test(name)) continue;
        const mm = Number(name.slice(0, 2)), dd = Number(name.slice(2));
        if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
        const r = parseSheet(wb.Sheets[name], name, yearHint);
        if (r) out.push({ sheetName: name, ...r });
    }
    return out.sort((a, b) => a.log.date.localeCompare(b.log.date));
};

export const readWorklogFile = async (file) => {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return parseWorklogWorkbook(wb, file.name);
};

/** 구글 시트 링크 → 공개 시트(링크 있는 사람 보기) 전체를 xlsx로 받아 읽는다 */
export const readWorklogGoogleSheet = async (url) => {
    const m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!m) throw new Error('구글 시트 링크가 아닙니다. (https://docs.google.com/spreadsheets/d/…)');
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`);
    if (!res.ok) throw new Error(`시트를 받지 못했습니다 (${res.status}). 공유 설정을 '링크가 있는 모든 사용자 - 뷰어'로 해 주세요.`);
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    return parseWorklogWorkbook(wb, '');
};
