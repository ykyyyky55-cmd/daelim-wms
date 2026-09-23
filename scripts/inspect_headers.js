import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

// 0x2711(10001)이 텍스트 객체 시그니처입니다.
// 이 시그니처 앞뒤로 어떤 필드들이 있는지 각 객체의 0x2711 위치를 수집합니다.
let objOffsets = [];
for (let i = 0; i < buf.length - 8; i++) {
    if (buf[i] === 0x11 && buf[i+1] === 0x27 && buf[i+2] === 0x00 && buf[i+3] === 0x00) {
        objOffsets.push(i);
    }
}

// 두 0x2711 사이의 거리(객체 크기)를 봅니다.
for (let k = 0; k < objOffsets.length; k++) {
    const cur = objOffsets[k];
    const next = (k + 1 < objOffsets.length) ? objOffsets[k+1] : buf.length;
    const len = buf.readUInt32LE(cur + 4);
    const text = buf.slice(cur + 8, cur + 8 + len * 2).toString('utf16le');
    
    // cur 직전 40바이트를 16진수와 8바이트 double, 4바이트 int로 덤프
    const pre = buf.slice(cur - 40, cur);
    
    // double 값들 중 정상 범위(0 ~ 300)
    let dList = [];
    for (let j = 0; j <= pre.length - 8; j++) {
        const val = pre.readDoubleLE(j);
        if (val > -10 && val < 400 && !isNaN(val)) {
            dList.push({ pos: j - 40, v: Math.round(val * 100) / 100 });
        }
    }
    
    // int32 값들 중 정상 범위(0 ~ 3000)
    let iList = [];
    for (let j = 0; j <= pre.length - 4; j += 4) {
        const val = pre.readInt32LE(j);
        if (val >= 0 && val < 5000) {
            iList.push({ pos: j - 40, v: val });
        }
    }

    console.log(`\n[${k}] "${text}" (len ${len})`);
    console.log('  doubles:', dList.map(d => `${d.pos}:${d.v}`).join(' '));
    console.log('  int32s:', iList.map(i => `${i.pos}:${i.v}`).join(' '));
}
