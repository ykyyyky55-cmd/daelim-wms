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

const malgun = Buffer.from([0xb8, 0xbc, 0xc0, 0xba, 0x20, 0xb0, 0xed, 0xb5, 0xf1]);
let p = 0;
let items = [];

while ((p = buf.indexOf(malgun, p)) !== -1) {
    const fontSize = buf[p + malgun.length]; // 0x32 -> 50, 0x23 -> 35, etc.
    
    // 텍스트 찾기: p 직전 또는 p 직후
    // 보통 텍스트는 p 뒤 또는 앞에 있음.
    // 텍스트 앞의 4바이트 길이 검사
    let text = '';
    let textOffset = 0;
    for (let q = Math.max(0, p - 100); q < Math.min(buf.length - 8, p + 100); q++) {
        let len = buf.readUInt32LE(q);
        if (len >= 1 && len <= 100 && q + 4 + len * 2 <= buf.length) {
            let s = buf.slice(q + 4, q + 4 + len * 2).toString('utf16le');
            if (/^[\uac00-\ud7a3a-zA-Z0-9\s.,/()·\-_%+]+$/.test(s) && s.trim().length > 0) {
                text = s;
                textOffset = q;
                // p와 가장 가까운 텍스트를 선택하기 위해
                if (Math.abs(q - p) < 80) break;
            }
        }
    }
    
    // 좌표 찾기: p 앞 250바이트 내에서 4개 연속된 Extended80
    // [Left, Top, Width, Height]
    let coords = [];
    for (let q = Math.max(0, p - 200); q < p; q++) {
        let v1 = readExtended80(buf, q);
        let v2 = readExtended80(buf, q + 10);
        let v3 = readExtended80(buf, q + 20);
        let v4 = readExtended80(buf, q + 30);
        if (v1 !== null && v2 !== null && v3 !== null && v4 !== null) {
            if (v1 >= 0 && v1 <= 210 && v2 >= 0 && v2 <= 297 && v3 > 1 && v3 <= 210 && v4 > 1 && v4 <= 297) {
                // border thickness도 q+50에 있는지 확인
                let border = readExtended80(buf, q + 50);
                coords.push({
                    off: '0x' + q.toString(16),
                    raw: q,
                    left: Number(v1.toFixed(2)),
                    top: Number(v2.toFixed(2)),
                    width: Number(v3.toFixed(2)),
                    height: Number(v4.toFixed(2)),
                    border: border ? Number(border.toFixed(2)) : null
                });
            }
        }
    }
    
    // 가장 가까운 좌표 선택
    let bestCoord = coords.length > 0 ? coords[coords.length - 1] : null;

    items.push({
        fontOffset: '0x' + p.toString(16),
        fontSize: fontSize,
        text: text,
        coord: bestCoord
    });
    
    p += malgun.length;
}

console.log(JSON.stringify(items, null, 2));
