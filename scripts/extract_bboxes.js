import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

// 각 객체에서 "cd cc cc cc cc cc cc fc 3f"의 위치를 찾습니다.
// 그 직전 24~32 바이트에 X, Y, W, H 좌표가 들어있습니다!

let sigs = [];
for (let i = 0; i < buf.length - 8; i++) {
    if (buf[i] === 0x11 && buf[i+1] === 0x27 && buf[i+2] === 0x00 && buf[i+3] === 0x00) {
        sigs.push(i);
    }
}

for (let s of sigs) {
    const len = buf.readUInt32LE(s + 4);
    const text = buf.slice(s + 8, s + 8 + len * 2).toString('utf16le');
    
    // s 직전에서 0xcd 0xcc 0xcc 0xcc 0xcc 0xcc 0xcc 0xfc 0x3f 위치 찾기
    const marker = Buffer.from([0xcd, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xfc, 0x3f]);
    const mIdx = buf.lastIndexOf(marker, s);
    
    if (mIdx !== -1 && s - mIdx < 30) {
        // mIdx 직전의 32바이트를 double 4개로 읽어보기
        // 폼텍 좌표: X, Y, Width, Height (또는 Left, Top, Right, Bottom)
        const d4 = buf.readDoubleLE(mIdx - 8);
        const d3 = buf.readDoubleLE(mIdx - 16);
        const d2 = buf.readDoubleLE(mIdx - 24);
        const d1 = buf.readDoubleLE(mIdx - 32);
        
        // 또 다른 오프셋 시도 (mIdx - 36, mIdx - 28 등)
        console.log(`\nText: "${text}"`);
        console.log(`  d1: ${d1.toFixed(2)}, d2: ${d2.toFixed(2)}, d3: ${d3.toFixed(2)}, d4: ${d4.toFixed(2)}`);
    }
}
