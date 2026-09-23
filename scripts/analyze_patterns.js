import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

// 0x1B0 부근의 헤더를 봅시다.
// 0x1B0: 00 00 00 01
// 0x1B4: 00 00 00 8d
// 0x1B8: 0a 00 00 b8
// 0x1BC: 01 04 00 00

// 폼텍 객체들의 시작점을 찾기 위해, 0x11 0x27 앞쪽을 정밀 분석해봅시다.
// 각 객체는 0x01, 0x02 등의 객체 타입 코드로 시작할 가능성이 높습니다.
// 0x1C0, 0x21C, 0x2A8, ... 등 객체 경계를 찾아봅시다.

// 0x11 0x27 앞의 바이트들을 비교하여 공통적인 구조 패턴 찾기
let sigs = [];
for (let i = 0; i < buf.length - 8; i++) {
    if (buf[i] === 0x11 && buf[i+1] === 0x27 && buf[i+2] === 0x00 && buf[i+3] === 0x00) {
        sigs.push(i);
    }
}

for (let s of sigs) {
    const len = buf.readUInt32LE(s + 4);
    const text = buf.slice(s + 8, s + 8 + len * 2).toString('utf16le');
    
    // s 앞쪽 60바이트
    const slice = buf.slice(Math.max(0, s - 60), s);
    console.log(`\n=== Text: "${text}" (at 0x${s.toString(16)}) ===`);
    console.log('Hex before 0x2711:', slice.toString('hex'));
}
