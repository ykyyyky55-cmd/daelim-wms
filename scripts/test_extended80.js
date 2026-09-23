import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

// 80-bit IEEE 754 Extended float 디코더
function readExtended80(buffer, offset) {
    if (offset + 10 > buffer.length) return null;
    
    // 리틀 엔디언:
    // bytes 0..7: mantissa (uint64)
    // bytes 8..9: sign and exponent (uint16)
    const expSign = buffer.readUInt16LE(offset + 8);
    const sign = (expSign & 0x8000) ? -1 : 1;
    const exponent = expSign & 0x7FFF;
    
    // mantissa: low 32 bits, high 32 bits
    const mantLow = buffer.readUInt32LE(offset);
    const mantHigh = buffer.readUInt32LE(offset + 4);
    
    if (exponent === 0 && mantHigh === 0 && mantLow === 0) return 0;
    if (exponent === 0x7FFF) return sign * Infinity;
    
    // mantissa as float: (mantHigh * 2^32 + mantLow) / 2^63
    // BigInt 사용
    const mantBig = (BigInt(mantHigh) << 32n) | BigInt(mantLow);
    const mantVal = Number(mantBig) / Math.pow(2, 63);
    
    const trueExp = exponent - 16383;
    return sign * mantVal * Math.pow(2, trueExp);
}

// 테스트: 0x88 부근의 200과 287 디코딩
console.log('--- Testing 80-bit Extended float on Formtec Label Dimensions ---');
for (let p = 0x80; p < 0xB0; p++) {
    const val = readExtended80(buf, p);
    if (val !== null && val > 1 && val < 500 && Math.abs(val - Math.round(val)) < 0.1) {
        console.log(`Offset 0x${p.toString(16)}: ${val.toFixed(2)} mm`);
    }
}
