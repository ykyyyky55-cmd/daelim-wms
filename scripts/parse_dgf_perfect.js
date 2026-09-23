import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

console.log('--- Formtec DGF Detailed Object Scanner ---');

// UTF-16LE 문자열 찾기: 4바이트 길이 (uint32) 뒤에 해당 길이만큼의 UTF-16LE (2*len 바이트)가 오는 패턴
let results = [];

for (let i = 0; i < buf.length - 8; i++) {
    const len = buf.readUInt32LE(i);
    // 글자 수가 1 ~ 200자 사이
    if (len >= 1 && len <= 200 && i + 4 + len * 2 <= buf.length) {
        const strBytes = buf.slice(i + 4, i + 4 + len * 2);
        // UTF-16LE인지 확인 (대부분의 글자가 0x00..0xD7FF 범위)
        let isU16 = true;
        for (let j = 0; j < strBytes.length; j += 2) {
            const code = strBytes.readUInt16LE(j);
            // printable ascii, hangul syllables (0xAC00 ~ 0xD7A3), or common punct
            const isAscii = (code >= 0x20 && code <= 0x7E);
            const isHangul = (code >= 0xAC00 && code <= 0xD7A3);
            const isEtc = (code === 0x0A || code === 0x0D || code === 0x09 || (code >= 0x3000 && code <= 0x303F) || (code >= 0x2000 && code <= 0x206F));
            if (!isAscii && !isHangul && !isEtc) {
                isU16 = false;
                break;
            }
        }
        if (isU16) {
            const str = strBytes.toString('utf16le');
            if (str.trim().length > 0) {
                results.push({
                    offset: i,
                    len: len,
                    text: str
                });
            }
        }
    }
}

console.log(`Found ${results.length} UTF-16LE strings:`);
results.forEach(r => {
    console.log(`[0x${r.offset.toString(16).padStart(4, '0')}] (${r.len} chars) "${r.text}"`);
});
