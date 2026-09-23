import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

function readExtended80(buffer, offset) {
    if (offset + 10 > buffer.length || offset < 0) return null;
    const expSign = buffer.readUInt16LE(offset + 8);
    const sign = (expSign & 0x8000) ? -1 : 1;
    const exponent = expSign & 0x7FFF;
    const mantLow = buffer.readUInt32LE(offset);
    const mantHigh = buffer.readUInt32LE(offset + 4);
    if (exponent === 0 && mantHigh === 0 && mantLow === 0) return 0;
    if (exponent === 0x7FFF) return sign * Infinity;
    const mantBig = (BigInt(mantHigh) << 32n) | BigInt(mantLow);
    const mantVal = Number(mantBig) / Math.pow(2, 63);
    const trueExp = exponent - 16383;
    return sign * mantVal * Math.pow(2, trueExp);
}

// 텍스트 블록 찾기: UTF-16LE 문자열들
let textBlocks = [];
for (let i = 0; i < buf.length - 4; i++) {
    const len = buf.readUInt32LE(i);
    if (len >= 1 && len <= 100) {
        const byteLen = len * 2;
        if (i + 4 + byteLen <= buf.length) {
            try {
                const str = buf.slice(i + 4, i + 4 + byteLen).toString('utf16le');
                // 문자열 검증: 제어문자가 없고 유효한 한글/영문/숫자/특수문자
                if (/^[\uac00-\ud7a3a-zA-Z0-9\s.,/()·\-_%+]+$/.test(str) && str.trim().length > 0) {
                    textBlocks.push({ offset: i, text: str, len: len });
                }
            } catch (e) {}
        }
    }
}

console.log(`Found ${textBlocks.length} text blocks:`);
textBlocks.forEach(t => {
    // 텍스트 앞뒤로 100바이트 내의 Extended80 부동소수점들 찾기
    let coords = [];
    for (let p = Math.max(0, t.offset - 80); p <= Math.min(buf.length - 10, t.offset + 80); p++) {
        let val = readExtended80(buf, p);
        if (val !== null && !isNaN(val) && val >= 0 && val <= 350) {
            // 소수점 4자리까지 유의미한 값인지
            if (val > 0.05) {
                coords.push({ p: '0x' + p.toString(16), v: Number(val.toFixed(2)) });
            }
        }
    }
    console.log(`\nText: "${t.text}" at 0x${t.offset.toString(16)} (length: ${t.len})`);
    console.log(`  Nearby Floats: ${coords.map(c => `${c.p}:${c.v}`).join(', ')}`);
});
