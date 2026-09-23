import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

function readExtended80(buffer, offset) {
    if (offset + 10 > buffer.length) return null;
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

console.log('=== Scan Consecutive Extended80 Numbers ===');
for (let i = 0; i < buf.length - 40; i++) {
    let vals = [];
    let ok = true;
    for (let k = 0; k < 4; k++) {
        let v = readExtended80(buf, i + k * 10);
        if (v === null || isNaN(v) || v < 0 || v > 400) {
            ok = false;
            break;
        }
        vals.push(v);
    }
    // Check if at least 2 values are > 0.5 (meaningful dimension or coordinate)
    if (ok && vals.filter(v => v > 0.5).length >= 2) {
        // find nearest string before i
        let str = '';
        for (let s = Math.max(0, i - 120); s < i; s++) {
            if (buf[s] >= 32 && buf[s] <= 126) {
                let end = s;
                while (end < i && buf[end] >= 32 && buf[end] <= 126) end++;
                if (end - s >= 4) {
                    str += ' [' + buf.slice(s, end).toString('ascii') + ']';
                    s = end;
                }
            }
        }
        console.log(`0x${i.toString(16).padStart(4, '0')}: [${vals.map(v => v.toFixed(2)).join(', ')}] mm | nearby: ${str}`);
        i += 39;
    }
}
