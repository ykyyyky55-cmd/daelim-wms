import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

// DGF 파일 헤더 뒤(0x1B0 부근)부터 객체 리스트가 시작됩니다.
// 0x01b8에 보면 객체 개수나 시퀀스가 있습니다.
// 16진수와 구조를 바이트 단위로 읽어 객체 레코드들을 파싱해 봅시다.

console.log('--- Scanning Objects in DGF ---');
// 0x1B0부터 덤프
let ptr = 0x1b0;
let objCount = buf.readUInt32LE(0x1b8); // or near
console.log('bytes at 0x1b0:', buf.slice(0x1b0, 0x1c0).toString('hex'));

// DGF에서 각 객체의 시작 시그니처 찾기
// 텍스트 앞의 구조를 보면 0x11 0x27 (10001) 같은 고정 ID나 타입 코드가 보입니다.
// 0x11 0x27 0x00 0x00 뒤에 문자열 길이가 옵니다!
// 0x025a, 0x03a8, 0x045c, 0x04ee ... 모두 0x11 0x27이 있습니다!

let textObjOffsets = [];
for (let i = 0; i < buf.length - 8; i++) {
    if (buf[i] === 0x11 && buf[i+1] === 0x27 && buf[i+2] === 0x00 && buf[i+3] === 0x00) {
        textObjOffsets.push(i);
    }
}

console.log(`Found ${textObjOffsets.length} text objects with signature 0x00002711:`);
textObjOffsets.forEach(pos => {
    const strLen = buf.readUInt32LE(pos + 4);
    const str = buf.slice(pos + 8, pos + 8 + strLen * 2).toString('utf16le');
    
    // pos 앞쪽 40바이트를 읽어서 좌표 파악 (대개 Left, Top, Right, Bottom or Width, Height)
    const headerBytes = buf.slice(pos - 48, pos);
    // 8바이트 double 또는 4바이트 int/float
    console.log(`\nText: "${str}" (Len: ${strLen}) at pos 0x${pos.toString(16)}`);
    
    // float / double 분석
    for (let j = 0; j <= headerBytes.length - 8; j += 8) {
        const d = headerBytes.readDoubleLE(j);
        console.log(`  Offset -${headerBytes.length - j}: double ${d}`);
    }
});
