import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

// 0x0263 ("파렛트 식별표") 바로 앞 50바이트를 16진수로 자세히 분석:
// 0x023b: 00 58 55 55 55 55 95 89 04 40 ff ff ff 00 01 00 00 00 00 00 cd cc cc cc cc cc cc fc 3f ...

// 0x40으로 끝나는 IEEE 754 double 부동소수점 수들:
// 리틀 엔디언에서 0x40은 2.0 ~ 3.99 범위이거나, 바이트 정렬에 따라 다릅니다.
// mm 단위로 저장되었는지 봅시다. 
// A4는 210mm x 297mm 입니다.
// 210은 0x406a400000000000 부근, 100mm는 0x4059000000000000 부근입니다.
// 0x40 뒤의 바이트들을 봅시다: 
// 0x04 0x40 = 2.5 ~ 5.0? 아닙니다. 리틀 엔디언에서 최상위 바이트가 0x40이면 2.0 이상입니다.

// 파일 전체에서 10.0 ~ 290.0 사이의 double 값을 갖는 모든 8바이트 위치를 스캔해 봅시다!
console.log('--- Scanning all double values between 5.0 and 300.0 (A4 mm size) ---');
for (let i = 0; i < buf.length - 8; i++) {
    const val = buf.readDoubleLE(i);
    if (val >= 5.0 && val <= 300.0) {
        console.log(`0x${i.toString(16)} (${i}): ${val.toFixed(2)} mm`);
    }
}
