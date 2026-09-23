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

// 텍스트 블록 목록
const texts = [
    { name: "외곽 테두리?", p: 0x1be },
    { name: "파렛트 식별표", p: 0x21d },
    { name: "카밈 가솔린 촉매 산소센서 클리너 프로 0.3L", p: 0x367 },
    { name: "PALLET NO.", p: 0x419 },
    { name: "1/3", p: 0x4ab },
    { name: "공급업체 외곽/라벨", p: 0x591 },
    { name: "공급업체 라벨", p: 0x5f3 },
    { name: "대림기업 내용", p: 0x679 },
    { name: "납품처 라벨", p: 0x6ff },
    { name: "에이치엘비글로벌(주) 내용", p: 0x783 },
    { name: "제품정보 외곽", p: 0x817 },
    { name: "제품정보 라벨", p: 0x879 },
    { name: "LOT NO. 라벨", p: 0x8ff },
    { name: "260914 내용", p: 0x98b },
    { name: "생산일자 라벨", p: 0xa15 },
    { name: "260917 내용", p: 0xa9d },
    { name: "수량 라벨", p: 0xb27 },
    { name: "60박스 내용", p: 0xbb5 }
];

for (const item of texts) {
    let l = readExtended80(buf, item.p);
    let t = readExtended80(buf, item.p + 10);
    let w = readExtended80(buf, item.p + 20);
    let h = readExtended80(buf, item.p + 30);
    let border = readExtended80(buf, item.p + 50); // 테두리 선?
    console.log(`${item.name} (0x${item.p.toString(16)}):`);
    console.log(`  Left: ${l?.toFixed(2)} mm, Top: ${t?.toFixed(2)} mm, Width: ${w?.toFixed(2)} mm, Height: ${h?.toFixed(2)} mm, Border: ${border?.toFixed(2)} mm`);
}
