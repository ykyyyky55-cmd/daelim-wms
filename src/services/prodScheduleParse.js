// 예전 엑셀 '생산스케즐 2026년.xlsx'의 날짜별 시트(본사 포장 SCHEDULE) 한 장 → 생산 스케줄표 줄 목록.
// 앱의 [엑셀 가져오기]와 scripts/import_prod_schedule.mjs(최초 이관)가 함께 쓴다. 외부 모듈을 쓰지 않는다.
//
// 시트 구성: 2행이 머리글(수주일·납품예정일·포장계획·상호·품 명·수량(ea)·박스량·박스/입수·용기·라벨·인박스·박스·비고·LOT.NO,
// 이어서 원 부자재 입고일정: 원액·라벨·인박스·아웃/박스·안전캡·용기·종이캡). '총 수 량' 줄로 구역이 끝나고,
// 구역 제목은 'OEM & ODM', '[ 완료 출고 대기 ]'처럼 한 칸에 적혀 있다(앞의 이름 없는 두 구역은 포장1부·포장2부로 본다).

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const pad2 = (n) => String(n).padStart(2, '0');

// 엑셀 날짜 일련번호 → 'YYYY-MM-DD'
export const excelSerialToDate = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 30000 || v > 80000) return '';
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

// 날짜 칸: 일련번호·'2027.1.5'·'10/6'이면 날짜, 그 밖('미정', '10월 초')은 글자 그대로
export const parseDateCell = (v, year) => {
    if (v === '' || v === null || v === undefined) return { text: '', date: '' };
    if (typeof v === 'number') { const d = excelSerialToDate(v); return { text: d || String(v), date: d }; }
    const s = clean(v);
    let m = s.match(/^(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
    if (m) return { text: s, date: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` };
    m = s.match(/^(\d{1,2})\s*[/.]\s*(\d{1,2})(?!\d)/);
    if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) return { text: s, date: `${year}-${pad2(m[1])}-${pad2(m[2])}` };
    return { text: s, date: '' };
};

// '제이케이컴즈 /김재혁', 'SM벡셀 [국군복지단] //김재혁' → 거래처·담당자
export const splitPartner = (v) => {
    const s = clean(v);
    const i = s.lastIndexOf('/');
    if (i < 0) return { partner: s, manager: '' };
    const manager = s.slice(i + 1).trim();
    const partner = s.slice(0, i).replace(/\/+\s*$/, '').trim();
    return /^[가-힣]{2,4}$/.test(manager) ? { partner, manager } : { partner: s, manager: '' };
};

// '0.3L', '500ml', '1L' → 규격(L) 글자
const specOf = (name) => {
    const m = String(name).match(/(\d+(?:\.\d+)?)\s*(ml|l|리터)(?![a-z])/i);
    if (!m) return '';
    const v = Number(m[1]) / (/ml/i.test(m[2]) ? 1000 : 1);
    return String(Math.round(v * 1000) / 1000);
};

const HEAD = {
    orderDate: /^수주일$/, due: /납품\s*예정/, plan: /포장\s*계획/, partner: /^(상\s*호|거래처)$/, manager: /^담당자$/,
    itemName: /^품\s*(목\s*)?명$/, qty: /수량/, perBox: /(박스\s*[/]?\s*입수|박스입수)/, container: /^용기$/,
    lot: /LOT/i, notes: /^비고$/
};
const MAT_HEAD = { raw: /^(원액|원료)$/, label: /^라벨$/, inbox: /^인박스$/, outbox: /(아웃|^박스$)/, safetyCap: /안전캡/, container: /^용기$/, paperCap: /종이캡/ };

/**
 * rows: sheet_to_json(ws, { header: 1, defval: '', raw: true }) 결과
 * sheetDate: 'YYYY-MM-DD' (시트 기준일, 연도 없는 날짜의 연도 판단용)
 * 반환: [{ site, line, status, orderDate, dueText, dueDate, planText, planDate, partner, manager, itemName, spec, qty, perBox, container, materials, matsDone, lotNo, notes }]
 */
export const parseScheduleSheet = (rows, { sheetDate = '', site = '본사' } = {}) => {
    const year = (sheetDate || '').slice(0, 4) || String(new Date().getFullYear());
    const hi = rows.findIndex((r, i) => i < 6 && r.some(c => HEAD.itemName.test(clean(c))));
    if (hi < 0) throw new Error('머리글(품 명)을 찾지 못했습니다. 본사 포장 SCHEDULE 양식의 시트인지 확인하세요.');
    const head = rows[hi].map(clean);
    const matStart = head.findIndex(h => MAT_HEAD.raw.test(h));
    const col = {};
    head.forEach((h, j) => {
        if (matStart >= 0 && j >= matStart) return;
        for (const [k, re] of Object.entries(HEAD)) if (col[k] === undefined && re.test(h)) col[k] = j;
    });
    // 주 영역의 라벨·인박스·박스 발주 칸
    const orderCol = {};
    head.forEach((h, j) => {
        if (matStart >= 0 && j >= matStart) return;
        if (/^라벨$/.test(h)) orderCol.label = j;
        else if (/^인박스$/.test(h)) orderCol.inbox = j;
        else if (/^박스$/.test(h)) orderCol.outbox = j;
    });
    const matCol = {};
    if (matStart >= 0) head.forEach((h, j) => {
        if (j < matStart) return;
        for (const [k, re] of Object.entries(MAT_HEAD)) if (matCol[k] === undefined && re.test(h)) matCol[k] = j;
    });
    if (col.itemName === undefined) throw new Error('품 명 열을 찾지 못했습니다.');

    const get = (r, j) => (j === undefined ? '' : r[j]);
    const out = [];
    let sectionNo = 0;
    let title = '';
    for (let i = hi + 1; i < rows.length; i++) {
        const r = rows[i];
        const cells = r.map(clean);
        if (cells.some(c => /^총\s*수\s*량$/.test(c))) { sectionNo++; title = ''; continue; }
        const name = clean(get(r, col.itemName));
        if (!name) {
            const t = cells.find(c => /OEM|ODM|완료|출고\s*대기|보류/i.test(c));
            if (t) title = t;
            continue;
        }
        const done = /완료|출고\s*대기/.test(title);
        const line = /OEM|ODM/i.test(title) ? 'OEM·ODM' : done ? '' : sectionNo === 0 ? '포장1부' : sectionNo === 1 ? '포장2부' : (title || `구역${sectionNo + 1}`);
        const { partner, manager } = col.manager !== undefined
            ? { partner: clean(get(r, col.partner)), manager: clean(get(r, col.manager)) }
            : splitPartner(get(r, col.partner));
        const due = parseDateCell(get(r, col.due), year);
        const plan = parseDateCell(get(r, col.plan), year);
        const materials = {};
        for (const k of Object.keys(MAT_HEAD)) {
            const ordered = clean(get(r, orderCol[k]));
            const recv = clean(get(r, matCol[k]));
            // 발주 칸 → 입고 칸 (같은 값이면 하나만: 'X → X' → 'X')
            const v = ordered && recv && ordered.replace(/\s/g, '') === recv.replace(/\s/g, '') ? recv : [ordered, recv].filter(Boolean).join(' → ');
            if (v) materials[k] = v;
        }
        // 주 영역 '용기'는 용기 이름(대성 검정 300 …)이라 원부자재 상태가 아니라 container로 둔다
        const qty = Number(String(get(r, col.qty)).replace(/,/g, '')) || 0;
        const perBox = Number(String(get(r, col.perBox)).replace(/,/g, '')) || 0;
        const recvKeys = Object.keys(MAT_HEAD).filter(k => clean(get(r, matCol[k])));
        const matsDone = recvKeys.length > 0 && recvKeys.every(k => /^(완|o|재고|사급)$/i.test(clean(get(r, matCol[k]))) || /^x$/i.test(clean(get(r, matCol[k]))));
        const planText = plan.text;
        const status = done ? 'DONE'
            : /완$|완료/.test(planText) ? 'DONE'
            : /미정/.test(`${due.text} ${planText}`) || !qty ? 'HOLD'
            : matsDone ? 'PLANNED' : 'PREP';
        out.push({
            site, line, status,
            orderDate: parseDateCell(get(r, col.orderDate), year).date,
            dueText: due.text, dueDate: due.date,
            planText, planDate: plan.date,
            partner, manager,
            itemName: name, spec: specOf(name),
            qty, perBox,
            container: clean(get(r, col.container)),
            materials, matsDone,
            lotNo: clean(get(r, col.lot)),
            notes: clean(get(r, col.notes)).replace(/^"|"$/g, '')
        });
    }
    return out;
};
