import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

// DGF 파일 헤더:
// 0x00 ~ 0x2F: Formtec Design Pro 9 Design File ...
// 0x30 ~ 0x8F: 파일 메타데이터 (9.4.0.0, A4, 분류표기용 라벨, 3130, 분류표기용 라벨, Labels, A4 ...)
// 0x90 ~ 0x1B0: 용지 여백, 크기 등 설정
// 0x1B8: 객체 리스트 시작!

console.log('--- Analyzing All Object Headers in DGF ---');

// 0x1B0부터 끝까지 객체들을 순회
// 각 텍스트 객체마다 폰트, 크기, 정렬, 색상, 그리고 테두리/표 셀 정보가 들어있습니다.
// 15개 텍스트의 앞뒤 데이터 블록 구조를 정확히 덤프해 봅시다.

const textEntries = [
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
    "260917",
    "수     량.",
    "60박스(1800개)"
];

for (const t of textEntries) {
    const tBuf = Buffer.from(t, 'utf16le');
    const idx = buf.indexOf(tBuf);
    if (idx !== -1) {
        console.log(`\n========================================`);
        console.log(`Text: "${t}" at offset 0x${idx.toString(16)} (${idx})`);
        
        // 앞쪽 64바이트 덤프
        const preStart = Math.max(0, idx - 48);
        console.log('Preceding 48 bytes:');
        for (let p = preStart; p < idx; p += 16) {
            const chunk = buf.slice(p, Math.min(idx, p + 16));
            console.log(`  0x${p.toString(16).padStart(4, '0')}: ${chunk.toString('hex')}`);
        }
        
        // 뒤쪽 64바이트 덤프 (폰트 및 속성)
        const postStart = idx + tBuf.length;
        console.log('Following 48 bytes:');
        for (let p = postStart; p < Math.min(buf.length, postStart + 48); p += 16) {
            const chunk = buf.slice(p, Math.min(buf.length, p + 16));
            console.log(`  0x${p.toString(16).padStart(4, '0')}: ${chunk.toString('hex')}`);
        }
    }
}
