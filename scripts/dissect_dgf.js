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

// 0부터 끝까지 순회하며 발견되는 모든 의미있는 데이터(문자열, 좌표, 레코드 구분자 등) 출력
let pos = 0;
console.log('File size:', buf.length);

// 헤더 확인
console.log('Header:', buf.slice(0, 0x90).toString('ascii').replace(/[^\x20-\x7E]/g, '.'));

// 레코드 헤더 분석
// DGF 파일에서 각 오브젝트가 시작하는 시그니처나 패턴을 찾아보자
for (let p = 0x90; p < buf.length; p++) {
    // 10바이트 Extended80이 연속으로 4개 나오는 위치 확인
    let l = readExtended80(buf, p);
    let t = readExtended80(buf, p + 10);
    let w = readExtended80(buf, p + 20);
    let h = readExtended80(buf, p + 30);
    
    if (l !== null && t !== null && w !== null && h !== null) {
        if (l >= 0 && l <= 210 && t >= 0 && t <= 297 && w >= 1 && w <= 210 && h >= 1 && h <= 297) {
            // 이 블록 전후의 바이트들 조사
            let preBytes = buf.slice(Math.max(0, p - 16), p).toString('hex');
            let postBytes = buf.slice(p + 40, p + 60).toString('hex');
            
            // 텍스트 탐색
            let text = '';
            for (let q = p + 40; q < Math.min(buf.length - 4, p + 200); q++) {
                let len = buf.readUInt32LE(q);
                if (len >= 1 && len <= 100 && q + 4 + len * 2 <= buf.length) {
                    let s = buf.slice(q + 4, q + 4 + len * 2).toString('utf16le');
                    if (/^[\uac00-\ud7a3a-zA-Z0-9\s.,/()·\-_%+]+$/.test(s) && s.trim().length > 0) {
                        text = s;
                        break;
                    }
                }
            }
            
            console.log(`[0x${p.toString(16).padStart(4, '0')}] Rect: (${l.toFixed(2)}, ${t.toFixed(2)}, ${w.toFixed(2)}, ${h.toFixed(2)}) | Text: "${text}" | Pre: ${preBytes}`);
            p += 39;
        }
    }
}
