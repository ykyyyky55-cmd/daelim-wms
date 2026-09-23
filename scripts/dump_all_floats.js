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

// 0x150부터 끝까지, 유효한 Extended80 값들을 연속으로 탐색
let pos = 0x150;
while (pos < buf.length - 10) {
    let val = readExtended80(buf, pos);
    // 지수가 유효한 범위 (예: 16383 전후 20범위, 즉 2^-20 ~ 2^20) 이거나 0
    let expSign = buf.readUInt16LE(pos + 8);
    let exponent = expSign & 0x7FFF;
    
    if (val === 0 || (exponent >= 16383 - 15 && exponent <= 16383 + 15)) {
        if (!isNaN(val) && Math.abs(val) < 1000) {
            console.log(`0x${pos.toString(16).padStart(4, '0')}: ${val.toFixed(4)}`);
            pos += 10;
            continue;
        }
    }
    pos++;
}
