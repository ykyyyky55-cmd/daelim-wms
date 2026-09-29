// 업무일지 → 구글 시트 줄 만들기 (순수 함수, Node로도 점검 가능). services/worklogSheets.js가 웹 앱에 보낸다.
// 열 이름 = 시트 머리줄 규칙(services/worklogImport.js의 HEAD_KEYS, public/tools/worklog-sheets.gs와 같음)

// 0·빈 값은 빈 칸으로 (수량은 0도 그대로)
const cell = (v, keepZero = false) => (v === undefined || v === null || v === '' || (!keepZero && Number(v) === 0 && v !== '0') ? '' : v);
const numCell = (v, keepZero = false) => { const n = Number(v); return Number.isFinite(n) && String(v).trim() !== '' ? cell(n, keepZero) : cell(v, keepZero); };
// 품명 칸: 시트 드롭다운처럼 '코드 / 이름 | 규격'
const itemText = (r) => {
    const it = String(r.item || '').trim();
    return it.includes('|') || !r.spec ? it : `${it} | ${r.spec}`;
};
const work = (r) => ({
    item: itemText(r), spec: cell(r.spec), qty: numCell(r.qty, true), box: numCell(r.box), workHours: numCell(r.workHours), workersCount: numCell(r.workersCount),
    totalWorkHours: numCell(r.totalWorkHours), line: cell(r.line), lotNo: cell(r.lotNo), category: cell(r.category), manHours: numCell(r.manHours), workers: cell(r.workers)
});

/** 앱 일지 → 시트 항목별 줄 (열 이름 = 시트 머리줄 규칙, services/worklogImport.js의 반대) */
export const buildSheetSections = (log) => ({
    packaging: (log.packaging || []).map(work),
    labeling: (log.labeling || []).map(work),
    oilBlending: (log.oilBlending || []).map(r => ({ ...work(r), packageType: cell(r.packageType) })),
    purchaseOrders: (log.purchaseOrders || []).map(r => ({ item: itemText(r), spec: cell(r.spec), qty: numCell(r.qty, true), partner: cell(r.partner), lotNo: cell(r.lotNo), line: cell(r.site), notes: cell(r.notes) })),
    receiving: (log.receiving || []).map(r => ({ item: itemText(r), spec: cell(r.spec), qty: numCell(r.qty, true), box: numCell(r.box), partner: cell(r.partner), inspector: cell(r.inspector), notes: cell(r.notes) })),
    shipping: (log.shipping || []).map(r => ({ item: itemText(r), spec: cell(r.spec), qty: numCell(r.qty, true), box: numCell(r.box), partner: cell(r.partner), inspector: cell(r.inspector), transport: cell(r.transport), notes: cell(r.notes) })),
    movement: (log.movement || []).map(r => ({ item: itemText(r), spec: cell(r.spec), unit: cell(r.unit), qty: numCell(r.qty, true), box: numCell(r.box), vehicle: cell(r.vehicle), driver: cell(r.driver), notes: cell(r.route) })),
    courier: (log.courier || []).filter(r => r.type || Number(r.count) > 0).map(r => ({ item: cell(r.type), count: numCell(r.count), notes: cell(r.notes) })),
    otherNotes: (log.otherNotes || []).map(String).filter(Boolean),
    otherTasks: (log.otherTasks || []).map(r => ({ item: cell(r.task), spec: cell(r.spec), qty: numCell(r.qty), unit: cell(r.unit), workHours: numCell(r.workHours), workersCount: numCell(r.workersCount),
        totalWorkHours: numCell(r.totalWorkHours), notes: cell(r.worker), manHours: numCell(r.manHours) }))
});
