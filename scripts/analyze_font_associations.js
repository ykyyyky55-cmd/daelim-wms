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

// "맑은 고딕" (EUC-KR: b8 bc c0 ba 20 b0 ed b5 b5) 위치 찾기
const malgun = Buffer.from([0xb8, 0xbc, 0xc0, 0xba, 0x20, 0xb0, 0xed, 0xb5, 0xb5]);
let p = 0;
let fontIndices = [];
while ((p = buf.indexOf(malgun, p)) !== -1) {
    fontIndices.push(p);
    p += malgun.length;
}

console.log(`Found ${fontIndices.length} font occurrences:`);
for (const fIdx of fontIndices) {
    // 폰트 앞쪽에서 좌표 4개 (Left, Top, Width, Height) 찾기
    // 보통 폰트 앞에 좌표가 있음
    console.log(`\n--------------------------------------------------`);
    console.log(`Font at 0x${fIdx.toString(16)}:`);
    
    // fIdx 뒤쪽에서 텍스트 찾기
    let text = '';
    let textLen = 0;
    for (let q = fIdx + malgun.length; q < fIdx + malgun.length + 80; q++) {
        let len = buf.readUInt32LE(q);
        if (len >= 1 && len <= 100 && q + 4 + len * 2 <= buf.length) {
            let s = buf.slice(q + 4, q + 4 + len * 2).toString('utf16le');
            if (/^[\uac00-\ud7a3a-zA-Z0-9\s.,/()·\-_%+]+$/.test(s) && s.trim().length > 0) {
                text = s;
                textLen = len;
                break;
            }
        }
    }
    
    // fIdx 앞 150바이트 내에서 4개 연속된 Extended80 찾기
    let foundCoords = null;
    for (let q = fIdx - 120; q < fIdx; q++) {
        let v1 = readExtended80(buf, q);
        let v2 = readExtended80(buf, q + 10);
        let v3 = readExtended80(buf, q + 20);
        let v4 = readExtended80(buf, q + 30);
        if (v1 !== null && v2 !== null && v3 !== null && v4 !== null) {
            if (v1 >= 0 && v1 <= 210 && v2 >= 0 && v2 <= 297 && v3 > 0.5 && v3 <= 210 && v4 > 0.5 && v4 <= 297) {
                foundCoords = {
                    offset: '0x' + q.toString(16),
                    l: Number(v1.toFixed(3)),
                    t: Number(v2.toFixed(3)),
                    w: Number(v3.toFixed(3)),
                    h: Number(v4.toFixed(3))
                };
            }
        }
    }
    
    // 폰트 크기 찾기: fIdx 직전/직후의 2바이트 또는 4바이트 정수
    let fontSize = null;
    for (let q = fIdx - 30; q < fIdx + malgun.length + 30; q += 2) {
        let val = buf.readInt16LE(q);
        if ([10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 35, 36, 40, 50, 70].includes(val)) {
            // Extended80의 일부가 아닌지 확인
            fontSize = val;
        }
    }
    
    console.log(`  Text: "${text}"`);
    console.log(`  Coords:`, foundCoords);
    console.log(`  Font Size:`, fontSize);
}
