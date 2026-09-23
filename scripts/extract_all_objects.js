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

// 파일에서 4개의 연속된 Extended80이 나오는 모든 곳을 찾아 오브젝트로 묶기
// [Left, Top, Width, Height]
let objects = [];
for (let i = 0x100; i < buf.length - 40; i++) {
    let v1 = readExtended80(buf, i);
    let v2 = readExtended80(buf, i + 10);
    let v3 = readExtended80(buf, i + 20);
    let v4 = readExtended80(buf, i + 30);
    
    // 조건: 0 <= v1,v2 <= 300, 0 < v3,v4 <= 300
    if (v1 !== null && v2 !== null && v3 !== null && v4 !== null) {
        if (v1 >= 0 && v1 <= 220 && v2 >= 0 && v2 <= 300 && v3 >= 2 && v3 <= 220 && v4 >= 2 && v4 <= 300) {
            // 오브젝트 후보 발견!
            // 이 주변에서 텍스트 찾기
            let text = null;
            let fontSize = null;
            let fontName = null;
            
            // i 뒤쪽 150바이트 내에서 UTF-16LE 텍스트 검색
            for (let j = i; j < Math.min(buf.length - 8, i + 200); j++) {
                let len = buf.readUInt32LE(j);
                if (len >= 1 && len <= 100 && j + 4 + len * 2 <= buf.length) {
                    let s = buf.slice(j + 4, j + 4 + len * 2).toString('utf16le');
                    if (/^[\uac00-\ud7a3a-zA-Z0-9\s.,/()·\-_%+]+$/.test(s) && s.trim().length > 0) {
                        text = s;
                        // 폰트 크기 찾기: 텍스트 앞뒤로 4바이트 int 또는 float 확인
                        break;
                    }
                }
            }
            
            // 폰트 정보 찾기 (맑은 고딕 주변)
            let fontIdx = buf.indexOf(Buffer.from([0xeb, 0xbb, 0xbe, 0xc0, 0xba, 0x20, 0xb0, 0xed, 0xb5, 0xb5]), i); // '맑은 고딕' EUC-KR
            if (fontIdx === -1) {
                // UTF-16LE '맑은 고딕'
                fontIdx = buf.indexOf(Buffer.from('맑은 고딕', 'utf16le'), i);
            }
            
            objects.push({
                offset: '0x' + i.toString(16),
                left: Number(v1.toFixed(2)),
                top: Number(v2.toFixed(2)),
                width: Number(v3.toFixed(2)),
                height: Number(v4.toFixed(2)),
                text: text
            });
            i += 39;
        }
    }
}

console.log(JSON.stringify(objects, null, 2));
