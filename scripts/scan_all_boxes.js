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

// 0x100부터 전체 파일 스캔하여 유효한 오브젝트 박스 (4연속 Extended80: Left, Top, Width, Height) 모두 추출
let allBoxes = [];
for (let p = 0x100; p < buf.length - 40; p++) {
    let l = readExtended80(buf, p);
    let t = readExtended80(buf, p + 10);
    let w = readExtended80(buf, p + 20);
    let h = readExtended80(buf, p + 30);
    
    if (l !== null && t !== null && w !== null && h !== null) {
        if (l >= 0 && l <= 210 && t >= 0 && t <= 297 && w >= 1 && w <= 210 && h >= 1 && h <= 297) {
            // 이 박스 뒤에 오는 텍스트 찾기 (최대 120바이트 내)
            let text = null;
            let fontSize = null;
            for (let q = p + 40; q < Math.min(buf.length - 4, p + 140); q++) {
                let len = buf.readUInt32LE(q);
                if (len >= 1 && len <= 100 && q + 4 + len * 2 <= buf.length) {
                    let str = buf.slice(q + 4, q + 4 + len * 2).toString('utf16le');
                    if (/^[\uac00-\ud7a3a-zA-Z0-9\s.,/()·\-_%+]+$/.test(str) && str.trim().length > 0) {
                        text = str;
                        // 폰트 크기 찾기
                        // 앞쪽 q-48..q 사이에서 font size 찾기
                        for (let f = q - 30; f < q; f += 2) {
                            let sz = buf.readInt16LE(f);
                            if ([10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 35, 36, 40, 50, 70].includes(sz)) {
                                fontSize = sz;
                            }
                        }
                        break;
                    }
                }
            }
            
            allBoxes.push({
                offset: '0x' + p.toString(16),
                left: Number(l.toFixed(2)),
                top: Number(t.toFixed(2)),
                width: Number(w.toFixed(2)),
                height: Number(h.toFixed(2)),
                text: text,
                fontSize: fontSize
            });
            p += 39;
        }
    }
}

console.log(JSON.stringify(allBoxes, null, 2));
