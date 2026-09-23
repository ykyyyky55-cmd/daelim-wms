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

// 텍스트 블록의 위치와 텍스트를 기준으로 역방향/정방향 탐색
// 각 텍스트 블록을 포함하는 레코드의 정확한 구조를 파악
const texts = [
    "파렛트 식별표",
    "카밈 가솔린 촉매 산소센서 클리너 프로 0.3L",
    "PALLET NO.",
    "1/3",
    "공급업체",
    "대림기업",
    "납품처",
    "에이치엘비글로벌(주)",
    "제품정보",
    "LOT NO.",
    "260914",
    "생산일자.",
    "수     량.",
    "60박스(1800개)"
];

for (const text of texts) {
    const textUtf16 = Buffer.from(text, 'utf16le');
    let idx = buf.indexOf(textUtf16);
    if (idx !== -1) {
        console.log(`\n========================================`);
        console.log(`TEXT: "${text}" at 0x${idx.toString(16)}`);
        
        // idx 앞 200바이트 내의 모든 10바이트 Extended80 부동소수점 검사
        let floats = [];
        for (let p = idx - 180; p < idx + 40; p++) {
            let v = readExtended80(buf, p);
            if (v !== null && !isNaN(v) && v > 0.05 && v < 350) {
                // 부동소수점 10바이트의 지수가 전형적인 범위인지 확인
                let exp = buf.readUInt16LE(p + 8) & 0x7FFF;
                if (exp >= 16380 && exp <= 16395) {
                    floats.push({ offset: '0x' + p.toString(16), rawOff: p, val: Number(v.toFixed(3)) });
                }
            }
        }
        
        // 10바이트 간격으로 4개(Left, Top, Width, Height)가 있는 그룹 찾기
        for (let i = 0; i < floats.length; i++) {
            let f1 = floats[i];
            let f2 = floats.find(f => f.rawOff === f1.rawOff + 10);
            let f3 = floats.find(f => f.rawOff === f1.rawOff + 20);
            let f4 = floats.find(f => f.rawOff === f1.rawOff + 30);
            if (f2 && f3 && f4) {
                console.log(`  -> BOX: Left=${f1.val}, Top=${f2.val}, Width=${f3.val}, Height=${f4.val} (starts at ${f1.offset})`);
            }
        }
        
        // 폰트 크기 및 정렬 추정 (텍스트 바로 앞의 정수들)
        let intLog = [];
        for (let p = idx - 40; p < idx; p += 4) {
            intLog.push(`0x${p.toString(16)}:${buf.readInt32LE(p)}`);
        }
        console.log(`  Ints before text: ${intLog.slice(-5).join(', ')}`);
    }
}
