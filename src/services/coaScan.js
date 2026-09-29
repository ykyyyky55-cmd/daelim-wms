// ==========================================
// 원부자재 시험성적서(COA) 스캔 → 글자 읽기 → 항목 채우기
// ==========================================
// PDF: 글자가 들어 있으면 pdf.js로 바로 읽고, 스캔 PDF(글자 없음)는 1~2쪽을 그림으로 그려 글자 인식.
// 사진: services/docOcr.js의 Tesseract(한글·영문, 브라우저 안에서 무료로 처리).
// 읽은 글에서 LOT·성적서 번호·제조일·유효기간과 시험항목(항목명·규격·결과)을 찾는다. 사람이 확인하고 저장한다.
import { preprocessImage, recognizeImage } from './docOcr.js';

// 시험항목 이름 ↔ 성적서에 흔히 쓰는 글 (영문·약어)
const TEST_ALIASES = [
    ['외관', /외관|appearance/i],
    ['비중 (15℃)', /비중|specific\s*gravity|density|밀도/i],
    ['동점도 (40℃), cSt', /(동?점도|viscosity|kv).{0,25}40|40\s*℃?.{0,6}(동?점도|viscosity)/i],
    ['동점도 (100℃), cSt', /(동?점도|viscosity|kv).{0,25}100|100\s*℃?.{0,6}(동?점도|viscosity)/i],
    ['점도지수', /점도\s*지수|viscosity\s*index|\bV\.?I\.?\b/i],
    ['인화점 (COC), ℃', /인화점|flash\s*point/i],
    ['유동점, ℃', /유동점|pour\s*point/i],
    ['색상', /색상|colou?r/i],
    ['수분, %', /수분|water\s*content|\bwater\b|moisture|karl/i],
    ['전산가(TBN)', /\bTBN\b|total\s*base|전염기가/i],
    ['전산가(TAN)', /\bTAN\b|acid\s*(number|value)|산가/i],
    ['황분, %', /\bsulfu?r|황분/i],
    ['순도, %', /purity|순도|assay|content/i],
    ['pH', /\bpH\b/i],
    ['굴절률', /굴절|refractive/i]
];
const NUM = '[-+]?\\d+(?:[.,]\\d+)?';

const pdfText = async (file, onProgress) => {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    for (let p = 1; p <= Math.min(doc.numPages, 5); p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        // 같은 줄(y)끼리 묶어 줄 단위 글로
        const lines = new Map();
        tc.items.forEach(it => { const y = Math.round(it.transform[5] / 3); lines.set(y, `${lines.get(y) || ''} ${it.str}`); });
        text += [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, s]) => s.trim()).join('\n') + '\n';
    }
    if (text.replace(/\s/g, '').length > 40) return text;
    // 글자가 없는 스캔 PDF → 그림으로 그려 글자 인식
    let ocr = '';
    for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
        onProgress?.({ status: `스캔 PDF ${p}쪽 글자 인식`, progress: 0 });
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 2.2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        ocr += `${await recognizeImage(preprocessImage(c, { target: 2400 }), onProgress)}\n`;
    }
    return ocr;
};

const loadImage = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => reject(new Error('그림을 열지 못했습니다.'));
    img.src = url;
});

/** 파일(사진·PDF) → 글 */
export const readCoaFile = async (file, onProgress) => {
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) return pdfText(file, onProgress);
    const img = await loadImage(file);
    return recognizeImage(preprocessImage(img, { target: 2400 }), onProgress);
};

const dateIn = (s) => {
    const m = String(s).match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/) || String(s).match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/);
    if (!m) return '';
    const [y, mo, d] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const after = (text, re) => { const m = text.match(re); return m ? m[1].trim().replace(/\s{2,}/g, ' ') : ''; };

/**
 * 글 → { lot, coaNo, mfgDate, expDate, tests: [{ name, spec, result }] }
 */
export const parseCoaText = (text) => {
    const src = String(text || '').replace(/\r/g, '');
    const lines = src.split('\n').map(s => s.replace(/[|]/g, ' ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
    const out = {
        lot: after(src, /(?:lot|batch)\s*(?:no\.?|number|#)?\s*[:：]?\s*([A-Z0-9][A-Z0-9\-_/]{2,})/i) || after(src, /(?:로트|제조)\s*번호\s*[:：]?\s*([A-Z0-9][A-Z0-9\-_/]{2,})/i),
        coaNo: after(src, /(?:certificate|report|coa|성적서)\s*(?:no\.?|number|번호)\s*[:：]?\s*([A-Z0-9][A-Z0-9\-_/]{2,})/i),
        // 'Product:'를 제조일로 읽지 않도록 날짜 낱말(date·일자)이 붙은 것만
        mfgDate: dateIn(after(src, /(?:manufactur\w*\s*date|production\s*date|prod\.?\s*date|mfg\.?\s*date|date\s*of\s*manufactur\w*|제조\s*(?:일자|년월일|일))\s*[:：]?\s*([^\n]{6,24})/i)),
        expDate: dateIn(after(src, /(?:expir\w*|exp\.?|best\s*before|shelf\s*life|유효\s*기간|사용\s*기한)\s*(?:date|일자|일)?\s*[:：]?\s*([^\n]{6,24})/i)),
        tests: []
    };
    const seen = new Set();
    for (const ln of lines) {
        const hit = TEST_ALIASES.find(([, re]) => re.test(ln));
        if (!hit || seen.has(hit[0])) continue;
        // 규격: 범위(a~b, a-b) 또는 min/max/≥/≤, 결과: 규격을 뺀 뒤 마지막 숫자 (외관·색상은 글)
        // 시험방법 번호(ASTM D92, ISO 3104, KS M 2014)와 온도(@100℃)는 규격·결과로 읽지 않게 지운다
        let rest = ln.replace(hit[1], ' ').replace(/\b(?:ASTM|ISO|KS\s*M|IP|DIN|JIS\s*K)\s*[A-Z]?\s*\d+(?:[-.]\d+)?/gi, ' ').replace(/@\s*\d+\s*(?:℃|°?\s*C)\b/gi, ' ');
        const range = rest.match(new RegExp(`(${NUM})\\s*(?:~|–|-|to)\\s*(${NUM})`));
        const bound = rest.match(new RegExp(`(min\\.?|max\\.?|≥|≤|>=|<=|이상|이하)\\s*(${NUM})|(${NUM})\\s*(min|max|이상|이하)`, 'i'));
        let spec = '';
        if (range) { spec = `${range[1]}~${range[2]}`; rest = rest.replace(range[0], ' '); }
        else if (bound) {
            const word = (bound[1] || bound[4] || '').toLowerCase();
            const v = bound[2] || bound[3];
            spec = /min|≥|>=|이상/.test(word) ? `${v} 이상` : `${v} 이하`;
            rest = rest.replace(bound[0], ' ');
        }
        const nums = rest.match(new RegExp(NUM, 'g')) || [];
        const textual = /외관|색상/.test(hit[0]);
        let result = nums.length ? nums[nums.length - 1].replace(',', '.') : '';
        if (textual && !result) result = (rest.match(/(clear|bright|pass|적합|투명|양호|L?\s*\d(\.\d)?)/i) || [])[0] || '';
        if (/(40|100)/.test(hit[0]) && result === (hit[0].includes('100') ? '100' : '40')) result = nums.length > 1 ? nums[nums.length - 2] : '';
        if (!result && !spec) continue;
        seen.add(hit[0]);
        out.tests.push({ name: hit[0], spec, result: String(result).trim() });
    }
    return out;
};

/** 표의 항목과 합치기: 이름이 같은 줄은 규격·결과를 채우고(비어 있을 때 규격), 없는 항목은 새 줄로 */
export const mergeCoaTests = (rows, found) => {
    const next = rows.map(r => ({ ...r }));
    found.forEach(f => {
        const key = f.name.replace(/\s|,.*$|\(.*\)/g, '');
        const row = next.find(r => r.name.replace(/\s|,.*$|\(.*\)/g, '') === key || r.name === f.name);
        if (row) { if (f.result) row.result = f.result; if (f.spec && !row.spec) row.spec = f.spec; }
        else next.push({ name: f.name, method: '', spec: f.spec, result: f.result, judge: '' });
    });
    return next;
};
