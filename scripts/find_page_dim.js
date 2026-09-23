import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

// 0x8C 부근의 라벨 크기(Formtec 3130): 200mm x 287mm
// 200, 287 또는 2000, 2870, 또는 210, 297을 찾아봅시다!

console.log('Searching for 200 and 287 in various types:');

for (let i = 0; i < buf.length - 4; i++) {
    // int16
    const i16 = buf.readInt16LE(i);
    // int32
    const i32 = buf.readInt32LE(i);
    // float
    const f32 = buf.readFloatLE(i);

    if (i16 === 200 || i16 === 287 || i16 === 2000 || i16 === 2870) {
        console.log(`int16 @ 0x${i.toString(16)}: ${i16}`);
    }
    if (i32 === 200 || i32 === 287 || i32 === 2000 || i32 === 2870) {
        console.log(`int32 @ 0x${i.toString(16)}: ${i32}`);
    }
    if (Math.abs(f32 - 200) < 0.1 || Math.abs(f32 - 287) < 0.1) {
        console.log(`float @ 0x${i.toString(16)}: ${f32}`);
    }
}
