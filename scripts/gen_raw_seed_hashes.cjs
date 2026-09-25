// 원료수불부 번들 기본 전표 id의 해시 목록을 만든다 (src/data/rawSeedIdHashes.json).
// 예전 번들(rawLedgerFull.json)에 있던 전표를 "이 기기에서만 만든 전표"로 오인해 클라우드에 다시 올리지 않도록
// 앱이 id를 비교하는 데 쓴다. id에 원료명이 들어 있으므로 원문 대신 해시만 번들에 넣는다.
// 실행: daelim-wms 루트에서 node scripts/gen_raw_seed_hashes.cjs
const fs = require('fs');
const fnv1a = (s) => {
    let h = 0x811c9dc5;
    for (const ch of Buffer.from(String(s), 'utf8')) {
        h ^= ch;
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
};
const src = JSON.parse(fs.readFileSync('src/data/rawLedgerFull.json', 'utf8'));
const hashes = [...new Set((src.entries || []).map(e => fnv1a(e.id)))].sort();
fs.writeFileSync('src/data/rawSeedIdHashes.json', JSON.stringify(hashes));
console.log(`전표 ${src.entries.length}건 → 해시 ${hashes.length}개`);
