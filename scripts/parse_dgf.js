import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');

console.log('Buffer length:', buf.length);

// Formtec DGF 파일 구조 분석
// 문자열들을 바이트 단위로 스캔하여 printable EUC-KR 및 ASCII 문자열 추출
const decoder = new TextDecoder('euc-kr');

let i = 0;
while (i < buf.length) {
    // 텍스트 블록 찾기: 길이가 앞에 오거나 null-terminated 이거나 pascal string
    // 연속된 ASCII 또는 EUC-KR 바이트(0x20-0x7E, 또는 0xA1-0xFE 페어)
    let start = i;
    let bytes = [];
    while (i < buf.length) {
        let b = buf[i];
        if ((b >= 0x20 && b <= 0x7E) || (b >= 0x81 && b <= 0xFE)) {
            bytes.push(b);
            i++;
        } else {
            break;
        }
    }
    if (bytes.length >= 2) {
        try {
            const str = decoder.decode(new Uint8Array(bytes));
            if (str.trim().length > 0) {
                console.log(`Offset 0x${start.toString(16)} (${start}): "${str.trim()}"`);
            }
        } catch (e) {}
    }
    i++;
}
