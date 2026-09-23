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

const rectOffsets = [
    0x1be, 0x21d, 0x2a9, 0x308, 0x367, 0x419, 0x4ab, 
    0x52f, 0x591, 0x5f3, 0x679, 0x6ff, 0x783, 0x817, 
    0x879, 0x8ff, 0x98b, 0xa15, 0xa9d, 0xb27, 0xbb5
];

let items = [];
for (const off of rectOffsets) {
    let l = readExtended80(buf, off);
    let t = readExtended80(buf, off + 10);
    let w = readExtended80(buf, off + 20);
    let h = readExtended80(buf, off + 30);
    let border = readExtended80(buf, off + 50);
    
    // 텍스트 검색
    let text = '';
    for (let q = off; q < Math.min(buf.length - 8, off + 220); q++) {
        let len = buf.readUInt32LE(q);
        if (len >= 1 && len <= 100 && q + 4 + len * 2 <= buf.length) {
            let s = buf.slice(q + 4, q + 4 + len * 2).toString('utf16le');
            if (/^[\uac00-\ud7a3a-zA-Z0-9\s.,/()·\-_%+]+$/.test(s) && s.trim().length > 0) {
                text = s;
                break;
            }
        }
    }
    
    // 폰트 크기 찾기
    let fontSize = null;
    for (let q = off; q < Math.min(buf.length - 12, off + 220); q++) {
        if (buf[q] === 0xb8 && buf[q+1] === 0xbc && buf[q+2] === 0xc0) {
            fontSize = buf[q + 9];
            break;
        }
    }
    
    // 배경색 (off + 40)
    let bgColor = buf.slice(off + 40, off + 43).toString('hex'); // RGB
    
    items.push({
        off: '0x' + off.toString(16),
        l: Number(l.toFixed(2)),
        t: Number(t.toFixed(2)),
        w: Number(w.toFixed(2)),
        h: Number(h.toFixed(2)),
        r: Number((l + w).toFixed(2)),
        b: Number((t + h).toFixed(2)),
        border: border ? Number(border.toFixed(2)) : null,
        bgColor: '#' + bgColor,
        fontSize: fontSize,
        text: text
    });
}

// Top 기준으로 정렬
items.sort((a, b) => a.t - b.t || a.l - b.l);

console.log(JSON.stringify(items, null, 2));
