import { state } from './db.js';

// 인쇄된 전표 이미지 → 글자 인식(Tesseract.js, 무료·브라우저 안에서 처리) → 품목·수량 후보 추출.
// 이미지는 밖으로 보내지 않는다. 인식 엔진·한글 자료는 처음 쓸 때 jsDelivr CDN에서 내려받는다(약 10MB, 이후 브라우저 캐시).

let workerPromise = null;
let progressHandler = null;

const getWorker = async () => {
    if (!workerPromise) {
        workerPromise = (async () => {
            const { createWorker } = await import('tesseract.js');
            return createWorker(['kor', 'eng'], 1, {
                logger: (m) => { if (progressHandler) progressHandler(m); }
            });
        })().catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
};

// 인식률을 높이려고 이미지를 키우고(가로 1800px 이상) 흑백·대비 보정한다. rotate: 0/90/180/270
export const preprocessImage = (img, { rotate = 0, contrast = true } = {}) => {
    const scale = Math.min(3, Math.max(1, 1800 / Math.max(img.width, img.height)));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const swap = rotate === 90 || rotate === 270;
    const c = document.createElement('canvas');
    c.width = swap ? h : w;
    c.height = swap ? w : h;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    if (contrast) {
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const px = d.data;
        for (let i = 0; i < px.length; i += 4) {
            const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            const v = g > 170 ? 255 : g < 90 ? 0 : Math.round((g - 90) * (255 / 80)); // 배경은 희게, 글자는 검게
            px[i] = px[i + 1] = px[i + 2] = v;
        }
        ctx.putImageData(d, 0, 0);
    }
    return c;
};

export const recognizeImage = async (canvas, onProgress) => {
    progressHandler = onProgress;
    try {
        const worker = await getWorker();
        const { data } = await worker.recognize(canvas);
        return data.text || '';
    } finally {
        progressHandler = null;
    }
};

// ---------- 전표 내용 분석 ----------
const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_/\\,.()[\]·:：'"`|]/g, '');
const bigrams = (s) => { const out = new Set(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; };
const dice = (a, b) => {
    if (!a.size || !b.size) return 0;
    let n = 0;
    a.forEach(x => { if (b.has(x)) n++; });
    return (2 * n) / (a.size + b.size);
};

const NUM_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const QTY_UNIT_RE = /(\d[\d,]*(?:\.\d+)?)\s*(ea|box|박스|개|드럼|dr|pail|페일|통|캔|병|set|roll|롤|대|매|장|bag|포)\b/i;
const SPEC_NUM_RE = /\d+(?:\.\d+)?\s*(ml|l|리터|kg|g|mm|cm|m|%)(?![a-z가-힣])/gi;
const toNum = (s) => Number(String(s).replace(/,/g, ''));

// 한 줄에서 수량 추정: 수량+단위(20 BOX) > 수량×단가=금액 > 첫 숫자
const guessQty = (line) => {
    const u = line.match(QTY_UNIT_RE);
    if (u) return { qty: toNum(u[1]), how: 'unit' };
    const nums = (line.replace(SPEC_NUM_RE, ' ').match(NUM_RE) || []).map(toNum).filter(n => n > 0 && n < 1e9);
    for (let i = 0; i < nums.length; i++) {
        for (let j = i + 1; j < nums.length; j++) {
            for (let k = j + 1; k < nums.length; k++) {
                const [q, p, a] = [nums[i], nums[j], nums[k]];
                if (q < 100000 && Math.abs(q * p - a) <= Math.max(1, a * 0.01)) return { qty: q, how: 'amount' };
            }
        }
    }
    return nums.length ? { qty: nums[0], how: 'first' } : { qty: 0, how: '' };
};

let masterIndex = null;
let masterIndexFor = null;
const getMasterIndex = () => {
    if (masterIndexFor !== state.master) {
        masterIndex = state.master.map(m => ({ m, code: norm(m.code), name: norm(m.name), grams: bigrams(norm(m.name)) }));
        masterIndexFor = state.master;
    }
    return masterIndex;
};

// 한 줄에 해당하는 품목 찾기: 품목코드 > 품목명 포함 > 글자 유사도
export const matchItem = (line) => {
    const ln = norm(line);
    if (ln.length < 2) return null;
    const idx = getMasterIndex();
    const byCode = idx.filter(x => x.code.length >= 5 && ln.includes(x.code)).sort((a, b) => b.code.length - a.code.length)[0];
    if (byCode) return { item: byCode.m, score: 1, how: '코드' };
    const byName = idx.filter(x => x.name.length >= 3 && ln.includes(x.name)).sort((a, b) => b.name.length - a.name.length)[0];
    if (byName) return { item: byName.m, score: 0.9, how: '품명' };
    // 글자 한두 개를 잘못 읽은 경우(예: '4L 용기' → '4[ 용기'): 품목명의 두 글자 묶음이 줄에 얼마나 들어 있는지(재현율)와
    // 숫자를 뺀 글자끼리의 유사도(Dice) 중 높은 쪽으로 가장 비슷한 품목을 고른다
    const lineGrams = bigrams(ln);
    const words = ln.replace(/[\d,]+/g, '');
    const wordGrams = bigrams(words);
    let best = null;
    for (const x of idx) {
        if (x.grams.size < 2) continue;
        let hit = 0;
        x.grams.forEach(b => { if (lineGrams.has(b)) hit++; });
        const recall = x.grams.size >= 3 ? hit / x.grams.size : (hit === x.grams.size ? 0.8 : 0);
        const s = Math.max(recall, words.length >= 3 ? dice(wordGrams, x.grams) : 0);
        if (!best || s > best.score + 1e-9 || (Math.abs(s - best.score) < 1e-9 && x.name.length > norm(best.item.name).length)) best = { item: x.m, score: s };
    }
    return best && best.score >= 0.6 ? { ...best, score: Math.min(best.score, 0.85), how: '유사' } : null;
};

const pad2 = (n) => String(n).padStart(2, '0');

// OCR 글자 전체 → { date, partner, docNo, lines: [{ text, item, score, how, qty, qtyHow }] }
export const parseSlipText = (text) => {
    const rawLines = String(text || '').split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    let date = '';
    const dm = String(text).match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
    if (dm && Number(dm[2]) >= 1 && Number(dm[2]) <= 12 && Number(dm[3]) >= 1 && Number(dm[3]) <= 31) date = `${dm[1]}-${pad2(dm[2])}-${pad2(dm[3])}`;
    let partner = '';
    for (const l of rawLines) {
        const m = l.match(/상\s*호\s*(?:\(법인명\))?\s*[:：]?\s*([^\s:：|]+(?:\s?\(주\))?)/) || l.match(/((?:\(주\)|㈜|주식회사)\s*[가-힣A-Za-z0-9]+|[가-힣A-Za-z0-9]+\s*(?:\(주\)|㈜))/);
        if (m) { partner = m[1].trim(); break; }
    }
    const nm = String(text).match(/(?:No\.?|번\s*호|전표\s*번호)\s*[:：#]?\s*([A-Z0-9][A-Z0-9\-]{3,})/i);
    const docNo = nm ? nm[1] : '';
    const SKIP = /합\s*계|소\s*계|총\s*액|공급\s*가|부가세|세\s*액|사업자|등록\s*번호|대\s*표|주\s*소|전\s*화|팩\s*스|fax|tel|업\s*태|종\s*목|인수자|담당|일\s*자|날\s*짜|상\s*호|공급받는|품\s*목\s*명|\bno\.|20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]/i;
    const lines = rawLines.map(t => {
        if (SKIP.test(t)) return null;
        const hit = matchItem(t);
        const hasNum = NUM_RE.test(t);
        NUM_RE.lastIndex = 0;
        if (!hit && !hasNum) return null;
        if (!hit && !/[가-힣a-z]{2,}/i.test(t)) return null; // 숫자만 있는 줄은 버림
        const { qty, how } = guessQty(t);
        return { text: t, item: hit?.item || null, score: hit?.score || 0, how: hit?.how || '', qty, qtyHow: how };
    }).filter(Boolean);
    return { date, partner, docNo, lines };
};
