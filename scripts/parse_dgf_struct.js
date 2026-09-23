import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

// 0x01B8부터 객체 블록들이 순차적으로 저장되어 있습니다.
// 0x01B0: 00 00 00 01 00 00 00 8d 0a 00 00 b8 01 04 00 00
// 0x01C0: 24 49 92 24 49 dd 01 40 00 a0 17 86 61 18 86 f6
// 0x01D0: 01 40 00 c8 30 0c c3 30 8c c4 06 40 00 20 86 61
// 0x01E0: 18 86 a9 8b 07 40

// 8바이트 double들을 0x01C0부터 읽어봅시다:
console.log('--- Double array from 0x1C0 ---');
for (let p = 0x1B0; p < 0x270; p += 8) {
    const d = buf.readDoubleLE(p);
    console.log(`0x${p.toString(16)}: ${d}`);
}
