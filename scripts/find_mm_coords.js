import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

// 0x1B0부터 시작하여 0x2711 태그를 가진 텍스트 객체들을 분석
// 0x2711 앞의 바이트들을 분석하여 좌표(Left, Top, Width, Height) 추출
// 폼텍은 mm 단위로 double을 저장하거나 0.1mm 단위 정수로 저장합니다.

let matches = [];
for (let i = 0; i < buf.length - 8; i++) {
    if (buf[i] === 0x11 && buf[i+1] === 0x27 && buf[i+2] === 0x00 && buf[i+3] === 0x00) {
        const strLen = buf.readUInt32LE(i + 4);
        if (strLen > 0 && strLen < 200 && i + 8 + strLen * 2 <= buf.length) {
            const text = buf.slice(i + 8, i + 8 + strLen * 2).toString('utf16le');
            
            // 폰트 크기
            const afterText = i + 8 + strLen * 2;
            const fontIdx = buf.indexOf(Buffer.from([0xb8, 0xbc, 0xc0, 0xba, 0x20, 0xb0, 0xed, 0xb5, 0xf1]), afterText);
            let fontSize = 0;
            let alignVal = 0;
            if (fontIdx !== -1 && fontIdx - afterText < 40) {
                fontSize = buf.readUInt32LE(fontIdx + 9);
                alignVal = buf.readUInt8(fontIdx + 9 + 4 + 4 + 2); // roughly
            }
            
            // i 직전 64바이트에서 모든 double 값 찾기 (범위: 0 ~ 300)
            let doubles = [];
            for (let k = i - 64; k <= i - 8; k++) {
                if (k >= 0) {
                    const d = buf.readDoubleLE(k);
                    if (d >= 0 && d <= 300 && !isNaN(d) && d > 0.5) {
                        doubles.push({ offset: k, val: Math.round(d * 10) / 10 });
                    }
                }
            }
            
            matches.push({
                tagOffset: i,
                text,
                fontSize,
                doubles
            });
        }
    }
}

console.log('Parsed text items with candidate coordinates:');
matches.forEach(m => {
    console.log(`\n[0x${m.tagOffset.toString(16)}] "${m.text}" (Font: ${m.fontSize}pt)`);
    console.log('  Candidate doubles (mm):', m.doubles.map(d => `0x${d.offset.toString(16)}: ${d.val}`).join(', '));
});
