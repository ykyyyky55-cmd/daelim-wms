import { state } from './db.js';

// 인쇄된 전표 이미지 → 글자 인식(Tesseract.js, 무료·브라우저 안에서 처리) → 품목·수량 후보 추출.
// 이미지는 밖으로 보내지 않는다. 인식 엔진·한글 자료는 처음 쓸 때 jsDelivr CDN에서 내려받는다(약 10MB, 이후 브라우저 캐시).

let workerPromise = null;
let progressHandler = null;

const getWorker = async () => {
    if (!workerPromise) {
        workerPromise = (async () => {
            const { createWorker } = await import('tesseract.js');
            const worker = await createWorker(['kor', 'eng'], 1, {
                logger: (m) => { if (progressHandler) progressHandler(m); }
            });
            // 쪽 나누기: 기본값(한 덩어리로 읽기)은 표를 한 줄씩 억지로 이어 읽어 영문 품명을 한글로 잘못 읽는다('EtOH' → '타애').
            // 자동 배치 분석(3)이 표 칸 글자를 제대로 읽는다 (표 선 지우기와 함께 거래명세서·출고확인서로 확인)
            await worker.setParameters({ tessedit_pageseg_mode: '3' });
            return worker;
        })().catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
};

// 표 선 지우기: 가로·세로로 글자보다 훨씬 길게 이어진 어두운 줄을 흰색으로 바꾼다.
// 칸 테두리가 있으면 글자 인식기가 표 안 글자를 '|', 'ㅣ' 같은 기호로 읽어 품목 줄을 통째로 놓치므로(출고확인서 등) 읽기 전에 지운다.
const removeTableLines = (ctx, w, h) => {
    const d = ctx.getImageData(0, 0, w, h);
    const px = d.data;
    const dark = (x, y) => px[(y * w + x) * 4] < 128;
    const minH = Math.max(60, Math.round(w * 0.06));
    const minV = Math.max(40, Math.round(h * 0.03));
    const kill = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        let run = 0;
        for (let x = 0; x <= w; x++) {
            if (x < w && dark(x, y)) { run++; continue; }
            if (run >= minH) kill.fill(1, y * w + x - run, y * w + x);
            run = 0;
        }
    }
    for (let x = 0; x < w; x++) {
        let run = 0;
        for (let y = 0; y <= h; y++) {
            if (y < h && dark(x, y)) { run++; continue; }
            if (run >= minV) for (let k = y - run; k < y; k++) kill[k * w + x] = 1;
            run = 0;
        }
    }
    // 선 가장자리의 흐린 픽셀까지 지우도록 1px 넓힌다
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            if (!kill[y * w + x]) continue;
            for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const i = ((y + dy) * w + (x + dx)) * 4;
                px[i] = px[i + 1] = px[i + 2] = 255;
            }
        }
    }
    ctx.putImageData(d, 0, 0);
};

// 인식률을 높이려고 이미지를 키우고(가로 1800px 이상) 흑백·대비 보정하고 표 선을 지운다. rotate: 0/90/180/270
export const preprocessImage = (img, { rotate = 0, contrast = true, removeLines = true } = {}) => {
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
        if (removeLines) removeTableLines(ctx, c.width, c.height);
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
// 품목 약칭 키와 같은 규칙 (db.js normItemName: 소문자, 공백·기호 제거, % 는 남김)
// 전각 글자(ＬＡ１ 등)는 글자 인식기가 자주 섞어 내므로 반각으로 바꾼 뒤 비교한다 (NFKC)
const nfkc = (s) => String(s || '').normalize('NFKC');
const aliasNorm = (s) => nfkc(s).toLowerCase().replace(/[\s\-_/\\|()[\]{}'"`.,:;+~*]/g, '');
const norm = (s) => nfkc(s).toLowerCase().replace(/[\s\-_/\\,.()[\]·:：'"`|]/g, '');
const bigrams = (s) => { const out = new Set(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; };
const dice = (a, b) => {
    if (!a.size || !b.size) return 0;
    let n = 0;
    a.forEach(x => { if (b.has(x)) n++; });
    return (2 * n) / (a.size + b.size);
};

const NUM_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
// 수량+단위: 표 칸 구분선을 ']', '|'로 잘못 읽어도(예: '1] ea') 인식하고, '4개입'(입수) 같은 말은 수량으로 보지 않는다
const QTY_UNIT_RE = /(\d[\d,]*(?:\.\d+)?)\s*[\]|)}]?\s*(ea|box|박스|개|드럼|dr|pail|페일|통|캔|병|set|roll|롤|대|매|장|bag|포)(?![a-z가-힣])/i;
// 규격(박스 치수 등): 405*285*295, 405x285
const DIM_RE = /(\d{2,4})\s*[*×xX"”']\s*(\d{2,4})(?:\s*[*×xX"”']\s*(\d{2,4}))?/g; // '*'를 따옴표로 잘못 읽은 경우 포함
const dimKey = (a, b, c) => [a, b, c].filter(Boolean).map(Number).join('*');
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
const specKeyOf = (spec) => {
    DIM_RE.lastIndex = 0;
    const m = DIM_RE.exec(String(spec || ''));
    DIM_RE.lastIndex = 0;
    return m ? dimKey(m[1], m[2], m[3]) : '';
};
const getMasterIndex = () => {
    if (masterIndexFor !== state.master) {
        // grams: 숫자를 뺀 품목명의 두 글자 묶음 (용량·코드 숫자끼리 우연히 겹쳐 엉뚱한 품목이 잡히지 않게)
        masterIndex = state.master.map(m => {
            const word = norm(m.name).replace(/\d+/g, '');
            return { m, code: norm(m.code), name: norm(m.name), word, grams: bigrams(word), spec: specKeyOf(m.spec) };
        });
        masterIndexFor = state.master;
    }
    return masterIndex;
};

// 품목명과 줄 글자의 비슷한 정도: 품목명 두 글자 묶음이 줄에 든 비율(재현율)과 숫자 뺀 글자끼리의 Dice 중 큰 값
const nameScore = (x, lineGrams, wordGrams, words) => {
    if (x.grams.size < 2) return 0;
    let hit = 0;
    x.grams.forEach(b => { if (lineGrams.has(b)) hit++; });
    // 짧은 이름(두 글자 묶음 2개 이하, 예: 'TEA 85')은 글자가 흩어져 있으면 안 되고 이름 전체가 붙어 있을 때만
    const recall = x.grams.size >= 3 ? hit / x.grams.size : (words.includes(x.word) ? 0.8 : 0);
    return Math.max(recall, words.length >= 3 ? dice(wordGrams, x.grams) : 0);
};

// 한 줄에 해당하는 품목 찾기: 품목코드 > 품목명 포함 > 글자 유사도
export const matchItem = (line) => {
    const ln = norm(line);
    if (ln.length < 2) return null;
    const idx = getMasterIndex();
    // 숫자로만 된 코드(예: 0000-018)는 금액 숫자에 우연히 들어 있을 수 있어 원래 표기('0000-018') 그대로 앞뒤가 숫자가 아닐 때만
    const rawLine = String(line).toLowerCase();
    const codeHit = (x) => (/[a-z]/.test(x.code)
        ? ln.includes(x.code)
        : new RegExp(`(^|[^0-9])${String(x.m.code).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9]|$)`).test(rawLine));
    const byCode = idx.filter(x => x.code.length >= 5 && codeHit(x)).sort((a, b) => b.code.length - a.code.length)[0];
    if (byCode) return { item: byCode.m, score: 1, how: '코드' };
    // 품목 약칭(품목마스터 `약칭 관리`, 예: 'EtOH99%' → ETHANOL 99%): 줄에 약칭이 들어 있으면 그 품목
    const lnAlias = aliasNorm(line);
    const alias = (state.itemAliases || []).filter(a => a.key && a.key.length >= 3 && lnAlias.includes(a.key)).sort((a, b) => b.key.length - a.key.length)[0];
    const aliasItem = alias && state.master.find(m => m.code === alias.code);
    if (aliasItem) return { item: aliasItem, score: 0.95, how: '약칭' };
    const byName = idx.filter(x => x.name.length >= 3 && ln.includes(x.name)).sort((a, b) => b.name.length - a.name.length)[0];
    if (byName) return { item: byName.m, score: 0.9, how: '품명' };
    const words = ln.replace(/\d+/g, '');
    const lineGrams = bigrams(words);
    const wordGrams = lineGrams;
    // 규격(박스 치수)은 숫자라 품명보다 잘 읽힌다: 줄의 치수와 규격이 같은 품목만 후보로 놓고,
    // 후보들이 함께 가진 글자('4개입 아웃박스' 등)는 빼고 그 품목만의 글자(예: '펌프')가 줄에 가장 많이 든 것을 고른다
    const dims = new Set([...String(line).matchAll(DIM_RE)].map(m => dimKey(m[1], m[2], m[3])));
    if (dims.size) {
        const cands = idx.filter(x => x.spec && dims.has(x.spec));
        if (cands.length === 1 && nameScore(cands[0], lineGrams, wordGrams, words) >= 0.2) return { item: cands[0].m, score: 0.85, how: '규격' };
        if (cands.length > 1) {
            const freq = new Map();
            cands.forEach(x => x.grams.forEach(g => freq.set(g, (freq.get(g) || 0) + 1)));
            const own = cands.map(x => {
                let hit = 0;
                x.grams.forEach(g => { if (freq.get(g) <= cands.length / 2 && lineGrams.has(g)) hit++; });
                return { x, hit };
            }).sort((a, b) => b.hit - a.hit);
            if (own[0].hit >= 1 && own[0].hit > own[1].hit) return { item: own[0].x.m, score: 0.8, how: '규격+품명' };
        }
    }
    // 글자 한두 개를 잘못 읽은 경우(예: '4L 용기' → '4[ 용기'): 가장 비슷한 품목명을 고른다
    let best = null;
    for (const x of idx) {
        const s = nameScore(x, lineGrams, wordGrams, words);
        if (!s) continue;
        if (!best || s > best.score + 1e-9 || (Math.abs(s - best.score) < 1e-9 && x.name.length > norm(best.item.name).length)) best = { item: x.m, score: s };
    }
    return best && best.score >= 0.6 ? { ...best, score: Math.min(best.score, 0.85), how: '유사' } : null;
};

const pad2 = (n) => String(n).padStart(2, '0');

// OCR 글자 전체 → { date, partner, docNo, lines: [{ text, item, score, how, qty, qtyHow }] }
export const parseSlipText = (text) => {
    const rawLines = String(text || '').split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    let date = '';
    const okMD = (m, d) => Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31;
    const dm = String(text).match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
    if (dm && okMD(dm[2], dm[3])) date = `${dm[1]}-${pad2(dm[2])}-${pad2(dm[3])}`;
    // 짧은 표기: '26/09/18'(일련번호 등) → 2026-09-18, 없으면 표의 '09/18' + 올해
    if (!date) {
        const ym = String(text).match(/(?<![\d/.-])(2\d)\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})(?![\d/.])/);
        if (ym && okMD(ym[2], ym[3])) date = `20${ym[1]}-${pad2(ym[2])}-${pad2(ym[3])}`;
    }
    if (!date) {
        const md = rawLines.map(l => l.match(/^[|\[\]\s]*(\d{1,2})\s*[./]\s*(\d{1,2})(?![\d/.])/)).find(m => m && okMD(m[1], m[2]));
        if (md) date = `${new Date().getFullYear()}-${pad2(md[1])}-${pad2(md[2])}`;
    }
    // 거래처: '상호' 칸 > '(주)이름' > '이름(주)' 순서로 찾고, 숫자뿐인 이름(계좌번호 끝자리 등)은 쓰지 않는다
    let partner = '';
    const PARTNER_RES = [
        /상\s*호\s*(?:\(법인명\))?\s*[:：]?\s*([^\s:：|]*[가-힣A-Za-z][^\s:：|]*(?:\s?\(주\))?)/,
        /((?:\(주\)|㈜|주식회사)\s*[가-힣A-Za-z][가-힣A-Za-z0-9]*)/,
        /([가-힣A-Za-z][가-힣A-Za-z0-9]*\s*(?:\(주\)|㈜))/
    ];
    for (const re of PARTNER_RES) {
        const m = rawLines.map(l => l.match(re)).find(Boolean);
        if (m) { partner = m[1].trim(); break; }
    }
    const nm = String(text).match(/(?:No\.?|번\s*호|전표\s*번호)\s*[:：#]?\s*([A-Z0-9][A-Z0-9\-]{3,})/i);
    const docNo = nm ? nm[1] : '';
    const SKIP = /합\s*계|소\s*계|총\s*액|금\s*액|공급\s*가|부가세|세\s*액|사업자|등록\s*번호|대\s*표|주\s*소|전\s*화|팩\s*스|fax|tel|업\s*태|종\s*목|인\s*수|담당|일\s*자|날\s*짜|상\s*호|성\s*명|공급받는|품\s*목\s*명|\bno\.|20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]|은행|계좌|예금주|입금|원\s*정|[일이삼사오육칠팔구십백천만억]{4,}\s*원|(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)|\d{2,6}\s*-\s*\d{2,6}\s*-\s*\d{2,6}\s*-\s*\d{2,6}/i;
    // 품목을 못 찾은 줄은 한글 두 글자 이상 또는 제대로 된 영문 낱말(서로 다른 글자 3개 이상, 예: EtOH)이 있어야 남긴다 ('EEE' 같은 깨진 글자 제외)
    const hasWords = (t) => /[가-힣]{2,}/.test(t) || (nfkc(t).match(/[a-z]{3,}/gi) || []).some(w => new Set(w.toLowerCase()).size >= 3);
    // 주소 줄 (예: '경기도 시흥시 윗대야2길 12') — 품목 줄로 잘못 잡히지 않게
    const ADDRESS = /(특별시|광역시|[가-힣]{2}도)\s*[가-힣]+(시|군|구)\s|[가-힣]+(시|군|구)\s+[가-힣0-9]+(동|읍|면|로|길)(\s|\d|$)/;
    const lines = rawLines.map(t => {
        if (SKIP.test(t) || ADDRESS.test(t)) return null;
        const hit = matchItem(t);
        const hasNum = NUM_RE.test(t);
        NUM_RE.lastIndex = 0;
        if (!hit && !hasNum) return null;
        if (!hit && !hasWords(t)) return null; // 숫자만 있거나 깨진 글자뿐인 줄은 버림
        const { qty, how } = guessQty(t);
        return { text: t, item: hit?.item || null, score: hit?.score || 0, how: hit?.how || '', qty, qtyHow: how };
    }).filter(Boolean);
    return { date, partner, docNo, lines };
};
