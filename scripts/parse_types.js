import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

// 0x1B0부터 0x260까지 4바이트 단위로 int32와 float 읽어보기
for (let p = 0x1B0; p < 0x270; p += 4) {
    const i32 = buf.readInt32LE(p);
    const flt = buf.readFloatLE(p);
    console.log('0x' + p.toString(16) + ': int=' + i32 + ' | flt=' + flt.toFixed(2) + ' | hex=' + buf.slice(p, p+4).toString('hex'));
}
