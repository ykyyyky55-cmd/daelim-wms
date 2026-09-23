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

// 0x150부터 끝까지, 각 오브젝트의 상세 속성 덤프
const rectOffsets = [
    0x1be, 0x21d, 0x2a9, 0x308, 0x367, 0x419, 0x4ab, 
    0x52f, 0x591, 0x5f3, 0x679, 0x6ff, 0x783, 0x817, 
    0x879, 0x8ff, 0x98b, 0xa15, 0xa9d, 0xb27, 0xbb5
];

for (const off of rectOffsets) {
    let l = readExtended80(buf, off);
    let t = readExtended80(buf, off + 10);
    let w = readExtended80(buf, off + 20);
    let h = readExtended80(buf, off + 30);
    
    // 이 오프셋의 앞 10바이트, 뒤 40바이트 덤프
    let pre = buf.slice(off - 10, off).toString('hex');
    let post = buf.slice(off + 40, off + 80).toString('hex');
    
    // Extended80이 더 있는지 확인 (예: border width, margins)
    let moreFloats = [];
    for (let k = off + 40; k < off + 100; k += 10) {
        let v = readExtended80(buf, k);
        if (v !== null && !isNaN(v) && Math.abs(v) < 100) {
            moreFloats.push(`+${k - off}:${v.toFixed(3)}`);
        }
    }
    
    // 텍스트 검색
    let text = null;
    let fontSize = null;
    for (let q = off; q < Math.min(buf.length - 8, off + 220); q++) {
        let len = buf.readUInt32LE(q);
        if (len >= 1 && len <= 100 && q + 4 + len * 2 <= buf.length) {
            let s = buf.slice(q + 4, q + 4 + len * 2).toString('utf16le');
            if (/^[\uac00-\ud7a3a-zA-Z0-9\s.,/()·\-_%+]+$/.test(s) && s.trim().length > 0) {
                text = s;
                // 폰트 크기 찾기
                for (let f = off; f < q; f++) {
                    if (buf[f] === 0xb8 && buf[f+1] === 0xbc) {
                        fontSize = buf[f + 9]; // 9바이트 맑은고딕 뒤 폰트 크기
                    }
                }
                break;
            }
        }
    }
    
    console.log(`[0x${off.toString(16)}] (${l?.toFixed(1)}, ${t?.toFixed(1)}, ${w?.toFixed(1)}, ${h?.toFixed(1)})mm | font: ${fontSize}pt | text: "${text || ''}" | moreFloats: ${moreFloats.join(' ')}`);
}
