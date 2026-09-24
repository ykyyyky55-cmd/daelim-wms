// rawLedgerFull.json 내 품명 통합 스크립트
// D40 → D-40, D60 → D-60 으로 name/itemName 일괄 정규화
const fs   = require('fs');
const JSON_PATH = 'C:\\code\\daelim-wms\\src\\data\\rawLedgerFull.json';

const data    = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const entries = data.entries || [];
const summary = data.summary || [];

// 품명 통합 규칙 [원본명 → 통합명]
const RENAME_MAP = {
    'D40':  'D-40',
    'D60':  'D-60',
};

let changedEntries = 0;
for (const e of entries) {
    const newName = RENAME_MAP[e.name];
    if (newName) {
        e.name     = newName;
        e.itemName = newName;
        changedEntries++;
    }
    const newItemName = RENAME_MAP[e.itemName];
    if (newItemName && e.itemName !== (RENAME_MAP[e.name] || e.name)) {
        e.itemName = newItemName;
        changedEntries++;
    }
}

let changedSummary = 0;
for (const s of summary) {
    const newName = RENAME_MAP[s.name];
    if (newName) {
        s.name = newName;
        changedSummary++;
    }
}

// summary에서 동일 itemCode+location 중복 항목 병합
const summaryMap = new Map();
for (const s of summary) {
    const key = s.itemCode + '|' + s.location;
    if (!summaryMap.has(key)) {
        summaryMap.set(key, { ...s });
    } else {
        // 더 최신 finalDate 기준으로 병합
        const existing = summaryMap.get(key);
        existing.rows += s.rows;
        if (s.finalDate > existing.finalDate) {
            existing.finalDate   = s.finalDate;
            existing.finalStock  = s.finalStock;
            existing.finalWeight = s.finalWeight;
        }
    }
}
const mergedSummary = [...summaryMap.values()];

fs.writeFileSync(JSON_PATH, JSON.stringify({
    summary: mergedSummary,
    entries
}, null, 2), 'utf8');

console.log(`엔트리 품명 변경: ${changedEntries}건`);
console.log(`서머리 항목 변경: ${changedSummary}건`);
console.log(`서머리 병합 전: ${summary.length}개 → 병합 후: ${mergedSummary.length}개`);
console.log('완료!');
