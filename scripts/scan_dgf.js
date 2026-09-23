import fs from 'fs';

const buf = fs.readFileSync('data/extracted_dgz/Design/국내건_카밈(예시).dgf');
const decoder = new TextDecoder('euc-kr');

console.log('--- Scanning valid EUC-KR Korean strings ---');

let i = 0;
while (i < buf.length) {
    let b1 = buf[i];
    // ASCII printable
    if (b1 >= 0x20 && b1 <= 0x7E) {
        let start = i;
        while (i < buf.length && buf[i] >= 0x20 && buf[i] <= 0x7E) {
            i++;
        }
        const s = buf.slice(start, i).toString('ascii').trim();
        if (s.length >= 3 && !/^[0\s]+$/.test(s)) {
            console.log(`[ASCII @ 0x${start.toString(16)}] "${s}"`);
        }
    } 
    // EUC-KR 2-byte Hangul (0x81~0xFE followed by 0x41~0xFE)
    else if (b1 >= 0x81 && b1 <= 0xFE && i + 1 < buf.length) {
        let start = i;
        let valid = true;
        let bytes = [];
        while (i < buf.length) {
            let c1 = buf[i];
            if (c1 >= 0x20 && c1 <= 0x7E) {
                bytes.push(c1);
                i++;
            } else if (c1 >= 0x81 && c1 <= 0xFE && i + 1 < buf.length) {
                let c2 = buf[i+1];
                if ((c2 >= 0x41 && c2 <= 0x5A) || (c2 >= 0x61 && c2 <= 0x7A) || (c2 >= 0x81 && c2 <= 0xFE)) {
                    bytes.push(c1, c2);
                    i += 2;
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        if (bytes.length >= 2) {
            try {
                const str = decoder.decode(new Uint8Array(bytes)).trim();
                if (/[가-힣]/.test(str)) {
                    console.log(`[KOREAN @ 0x${start.toString(16)}] "${str}"`);
                }
            } catch (e) {}
        }
    } else {
        i++;
    }
}
