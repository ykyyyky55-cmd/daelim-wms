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

// 인식률을 높이려고 이미지를 키우고(긴 변 target px 이상, 기본 1800) 흑백·대비 보정하고 표 선을 지운다. rotate: 0/90/180/270
// fit: true면 target보다 큰 사진은 줄이기도 한다 (영수증의 크고 굵은 글씨는 작게 읽을 때 더 잘 읽힘)
export const preprocessImage = (img, { rotate = 0, contrast = true, removeLines = true, target = 1800, fit = false } = {}) => {
    const scale = Math.min(3, fit ? target / Math.max(img.width, img.height) : Math.max(1, target / Math.max(img.width, img.height)));
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

// 여러 크기로 읽어 품목이 가장 많이 맞은 글자를 고른다.
// 작은 글자(예: 'EtOH99%')는 확대 크기에 따라 한글로 잘못 읽히기도 하고, 어떤 크기는 다른 줄을 놓치기도 해서 한 번 읽기로는 불안정하다.
// 1800px로 읽어 모든 줄이 품목으로 맞으면 끝, 아니면 3600px로 한 번 더, 둘 다 하나도 못 맞으면 3000px까지.
const scoreParse = (p) => p.lines.reduce((s, l) => s + (l.item ? 10 + l.score : 0), 0);
// 영수증 점수: 업체명·금액·카드사·끝 4자리·일자를 몇 개 찾았나 (카드전표는 품목이 없어 품목 점수로 못 고른다)
// 영수증 점수(품목 줄 고를 글자 선택용): 금액·카드사·끝자리·일자를 몇 개 찾았나
const scoreReceipt = (text) => {
    const r = parseReceiptText(text);
    return (r.partner ? 1 : 0) + (r.amount ? 2 : 0) + (r.issuer ? 1 : 0) + (r.last4 ? 1 : 0) + (parseSlipText(text).date ? 1 : 0);
};

// 업체명 후보 점수: 한글 낱말이 많고, 한글 이름 사이에 섞인 영문 조각·기호가 적을수록 높다
const partnerScore = (p) => {
    if (!p) return -99;
    const words = p.split(/\s+/);
    const han = words.filter(w => /^[가-힣]{2,}$/.test(w)).length;
    const latin = words.filter(w => /[A-Za-z]/.test(w)).length;
    const bad = (p.match(/[^가-힣A-Za-z()&.\s]/g) || []).length;
    return han * 2 - (han ? latin * 2 : 0) - bad * 2 + (/\([주유]\)|㈜/.test(p) ? 1 : 0);
};
const mostCommon = (arr) => {
    const m = new Map();
    arr.filter(Boolean).forEach(v => m.set(v, (m.get(v) || 0) + 1));
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
};

/**
 * 영수증 읽기: 크고 굵은 업체명은 작은 크기에서 잘 읽히지만 크기마다 결과가 흔들리므로
 * 작은 크기 여러 번 + 보통 크기 한 번을 읽어 업체명은 가장 깨끗한 것, 금액·카드는 가장 많이 나온 값으로 고른다.
 * @returns { text, receipt: { partner, amount, issuer, last4, approvalNo, date } }
 */
const recognizeReceipt = async (img, { rotate = 0, contrast = true } = {}, onProgress) => {
    const passes = [{ target: 600, contrast: true }, { target: 750, contrast: true }, { target: 900, contrast: false }, { target: 600, contrast: false }, { target: 1800, contrast, fit: false }];
    const results = [];
    for (let i = 0; i < passes.length; i++) {
        const p = passes[i];
        const canvas = preprocessImage(img, { rotate, contrast: p.contrast, target: p.target, fit: p.fit !== false });
        const text = await recognizeImage(canvas, (m) => onProgress?.({ ...m, status: `${m.status} (${i + 1}/${passes.length}차 읽기)` }));
        results.push({ text, r: parseReceiptText(text), date: parseSlipText(text).date, score: scoreReceipt(text) * 10 + Math.min(9, scoreParse(parseSlipText(text))) });
    }
    const best = results.reduce((a, b) => (b.score > a.score ? b : a));
    const partner = results.map(x => x.r.partner).filter(Boolean).sort((a, b) => partnerScore(b) - partnerScore(a))[0] || '';
    const amount = Number(mostCommon(results.map(x => (x.r.amount ? String(x.r.amount) : '')))) || 0;
    return {
        text: best.text, score: best.score, pass: results.indexOf(best) + 1, target: passes[results.indexOf(best)].target,
        receipt: {
            partner, amount, issuer: mostCommon(results.map(x => x.r.issuer)), last4: mostCommon(results.map(x => x.r.last4)),
            approvalNo: mostCommon(results.map(x => x.r.approvalNo)), date: mostCommon(results.map(x => x.date))
        }
    };
};

export const recognizeBest = async (img, { rotate = 0, contrast = true, receipt = false } = {}, onProgress) => {
    if (receipt) return recognizeReceipt(img, { rotate, contrast }, onProgress);
    const targets = [1800, 3600, 3000];
    const sizes = new Set();
    let best = null;
    for (let i = 0; i < targets.length; i++) {
        const canvas = preprocessImage(img, { rotate, contrast, target: targets[i] });
        if (sizes.has(canvas.width)) continue; // 원본이 커서 확대되지 않으면 같은 그림을 다시 읽지 않는다
        sizes.add(canvas.width);
        const pass = i + 1;
        const text = await recognizeImage(canvas, (m) => onProgress?.({ ...m, status: `${m.status} (${pass}차 읽기)` }));
        const parsed = parseSlipText(text);
        const score = scoreParse(parsed);
        if (!best || score > best.score) best = { text, score, pass, target: targets[i] };
        const matched = parsed.lines.filter(l => l.item).length;
        if (matched > 0 && matched === parsed.lines.length) break;
        if (i === 1 && best.score > 0) break;
    }
    return best || { text: '', score: 0, pass: 0, target: 0 };
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
    // 수량이 아닌 숫자는 먼저 뺀다: 줄 앞 일자(09/18), 거래처 품목코드(T145-PS-021), 치수(405*285*295, 405285295), 입수(4개입), 용량(4L)
    const cleaned = nfkc(line)
        .replace(/^[\s|\[\](]*\d{1,2}\s*[./]\s*\d{1,2}(?!\d)/, ' ')
        .replace(/[A-Za-z0-9£€]*[A-Za-z£€][A-Za-z0-9£€]*(?:-[A-Za-z0-9£€]+)+|\d+(?:-\d+){2,}/g, ' ')
        .replace(DIM_RE, ' ')
        .replace(/(?<!\d)\d{9}(?!\d)/g, ' ')
        .replace(/\d+\s*개\s*입/g, ' ')
        .replace(SPEC_NUM_RE, ' ');
    DIM_RE.lastIndex = 0;
    const nums = (cleaned.match(NUM_RE) || []).map(toNum).filter(n => n > 0 && n < 1e9);
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
    const words = ln.replace(/\d+/g, '');
    const lineGrams = bigrams(words);
    const wordGrams = lineGrams;
    // 규격(박스 치수)은 숫자라 품명보다 잘 읽힌다: 줄의 치수와 규격이 같은 품목만 후보로 놓고,
    // 후보들이 함께 가진 글자('4개입 아웃박스' 등)는 빼고 그 품목만의 글자(예: '펌프')가 줄에 가장 많이 든 것을 고른다.
    // 품명 비교보다 먼저 본다: 품명 일부를 잘못 읽으면('4L' → 'AL') 더 짧은 다른 품목명(단품)이 먼저 잡히기 때문
    const dims = new Set([...String(line).matchAll(DIM_RE)].map(m => dimKey(m[1], m[2], m[3])));
    // '*'가 통째로 빠져 붙어 읽힌 치수('405285295')는 3자리씩 나눠 품목마스터에 그 규격이 있을 때만 인정
    for (const m of String(line).matchAll(/(?<!\d)(\d{3})(\d{3})(\d{3})(?!\d)/g)) {
        const k = dimKey(m[1], m[2], m[3]);
        if (idx.some(x => x.spec === k)) dims.add(k);
    }
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
    const byName = idx.filter(x => x.name.length >= 3 && ln.includes(x.name)).sort((a, b) => b.name.length - a.name.length)[0];
    if (byName) return { item: byName.m, score: 0.9, how: '품명' };
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

// ---------- 카드 영수증 ----------
const CARD_ISSUERS = [
    [/국민|KB/i, 'KB국민'], [/신한/, '신한'], [/삼성/, '삼성'], [/현대/, '현대'], [/롯데/, '롯데'], [/하나|외환/, '하나'],
    [/우리/, '우리'], [/농협|NH/i, 'NH농협'], [/비씨|BC/i, 'BC'], [/씨티|시티/, '씨티'], [/카카오/, '카카오뱅크'], [/기업|IBK/i, 'IBK기업'],
    [/수협/, '수협'], [/광주/, '광주'], [/전북/, '전북'], [/제주/, '제주'], [/케이뱅크/, '케이뱅크'], [/토스/, '토스']
];
/**
 * 카드 영수증 글자 → { partner, amount, issuer, last4, approvalNo }
 * 업체명: 상호·가맹점명 칸 > (주) 붙은 이름 > 맨 위쪽의 첫 이름 줄 (주소·전화·번호·날짜 줄 제외)
 * 금액: 합계·총액·결제·승인·받을·청구 금액 줄('번호' 줄 제외)의 마지막 금액
 */
export const parseReceiptText = (text) => {
    const lines = String(text || '').split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    let { partner } = parseSlipText(text);
    if (!partner) {
        const NOT_NAME = /영수증|명세|전표|계산서|주문|번호|일시|일자|날짜|전화|tel|사업자|대표|주소|특별시|광역시|[가-힣]+(시|군|구)\s|카드|승인|합계|금액|\d{2,}[-)]\d{3,}|20\d{2}[.\-/]/i;
        const cand = lines.slice(0, 6).find(l => /[가-힣]{2,}/.test(l) && !NOT_NAME.test(l) && (l.match(/\d/g) || []).length <= 2);
        if (cand) partner = cand.replace(/[^가-힣A-Za-z0-9()&.\s-]/g, '').trim();
    }
    let amount = 0;
    // 글자 인식이 '합 계'를 '합 겨'·'합 게'로 읽기도 한다. 합계가 없으면 소계, 그래도 없으면 '원'이 붙은 가장 큰 금액
    const TOTAL_LINE = /(합\s*[계겨게개]|총\s*[액앤]|결\s*제\s*금\s*액|승\s*인\s*금\s*액|받\s*을\s*금\s*액|청\s*구\s*금\s*액|결\s*제\s*액|TOTAL)/i;
    const amountOf = (l) => {
        const s = l.replace(/(\d)\s*([,.])\s*(\d{3})/g, '$1$2$3'); // '10 , 800' → '10,800'
        const ms = s.match(/\d{1,3}(?:[,.]\d{3})+|\d{3,8}/g) || [];
        const withWon = s.match(/(\d{1,3}(?:[,.]\d{3})+|\d{3,8})\s*원/);
        const pick = withWon ? withWon[1] : ms[ms.length - 1];
        const n = pick ? Number(pick.replace(/[,.]/g, '')) : 0;
        return n > 0 && n < 100000000 ? n : 0;
    };
    const noNo = (l) => !/번\s*호|no\.?|전\s*화|tel/i.test(l);
    lines.filter(l => TOTAL_LINE.test(l) && noNo(l)).forEach(l => { const n = amountOf(l); if (n) amount = n; }); // 아래쪽(최종 합계)이 이긴다
    if (!amount) lines.filter(l => /소\s*계/.test(l) && noNo(l)).forEach(l => { const n = amountOf(l); if (n) amount = n; });
    if (!amount) {
        lines.filter(l => /\d\s*원/.test(l) && noNo(l)).forEach(l => {
            const m = l.replace(/(\d)\s*([,.])\s*(\d{3})/g, '$1$2$3').match(/(\d{1,3}(?:[,.]\d{3})+|\d{3,8})\s*원/);
            const n = m ? Number(m[1].replace(/[,.]/g, '')) : 0;
            if (n > amount && n < 100000000) amount = n;
        });
    }
    let issuer = '';
    let last4 = '';
    const cardLineIdx = lines.findIndex(l => /카\s*드|신\s*용|체\s*크|[가-힣]{0,2}\s*-\s*드\s*\(/.test(l) && !/현금/.test(l));
    if (cardLineIdx >= 0) {
        const near = lines.slice(cardLineIdx, cardLineIdx + 3).join(' ');
        issuer = (CARD_ISSUERS.find(([re]) => re.test(near)) || [])[1] || '';
        const m = near.match(/\d{4}\s*[-\s][^가-힣]{4,20}?[-\s]\s*(\d{4})(?!\d)/) || near.match(/[*xX※]{2,}[^\d]{0,4}(\d{4})(?!\d)/);
        if (m) last4 = m[1];
    }
    const am = String(text).match(/승\s*인\s*번\s*호\s*[:：]?\s*(\d{6,12})/);
    return { partner, amount, issuer, last4, approvalNo: am ? am[1] : '' };
};

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
    // (주)는 글자 인식이 (수)·(추)로 읽기도 한다. 이름은 띄어 쓴 낱말 4개까지 (예: '스타벅스 커피 코리아 (주)')
    const PARTNER_RES = [
        /(?:상\s*호|가\s*맹\s*점\s*명|매\s*장\s*명|업\s*체\s*명)\s*(?:\(법인명\))?\s*[:：]?\s*([^\s:：|]*[가-힣A-Za-z][^:：|]*?(?:\s?\([주수추]\))?)\s*(?:$|[|]|대\s*표|사업자|전\s*화|tel)/i,
        /((?:\([주수추]\)|㈜|주식회사)\s*[가-힣A-Za-z][가-힣A-Za-z0-9]*(?:\s[가-힣A-Za-z][가-힣A-Za-z0-9]*){0,3})/,
        /([가-힣A-Za-z][가-힣A-Za-z0-9&]*(?:\s[가-힣A-Za-z][가-힣A-Za-z0-9&]*){0,3}\s*(?:\([주수추]\)|㈜|주식회사))/
    ];
    for (const re of PARTNER_RES) {
        const m = rawLines.map(l => l.match(re)).find(Boolean);
        if (m) { partner = m[1].trim().replace(/\((수|추)\)/, '(주)'); break; }
    }
    const nm = String(text).match(/(?:No\.?|번\s*호|전표\s*번호)\s*[:：#]?\s*([A-Z0-9][A-Z0-9\-]{3,})/i);
    const docNo = nm ? nm[1] : '';
    const SKIP = /합\s*계|소\s*계|총\s*액|금\s*액|공급\s*가|부가세|세\s*액|사업자|등록\s*번호|대\s*표|주\s*소|전\s*화|팩\s*스|fax|tel|업\s*태|종\s*목|인\s*수|담당|일\s*자|날\s*짜|상\s*호|성\s*명|공급받는|품\s*목\s*명|\bno\.|20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]|은행|계좌|예금주|입금|원\s*정|[일이삼사오육칠팔구십백천만억]{4,}\s*원|(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)|\d{2,6}\s*-\s*\d{2,6}\s*-\s*\d{2,6}\s*-\s*\d{2,6}/i;
    // 품목을 못 찾은 줄은 한글 두 글자 이상 또는 제대로 된 영문 낱말(4글자 이상, 서로 다른 글자 3개 이상, 예: EtOH)이 있어야 남긴다 ('EEE', 'Bhs' 같은 깨진 글자 제외)
    const hasWords = (t) => /[가-힣]{2,}/.test(t) || (nfkc(t).match(/[a-z]{4,}/gi) || []).some(w => new Set(w.toLowerCase()).size >= 3);
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
        // 수량 바로 뒤에 kg가 적혀 있으면(예: '160 kg') 입력 단위를 KG로 제안 (화면에서 비중으로 품목 단위로 환산)
        const unitHint = qty > 0 && new RegExp(`(?<![\\d.,])${String(qty).replace('.', '\\.')}\\s*(kg|킬로)(?![a-z])`, 'i').test(nfkc(t).replace(/,/g, '')) ? 'KG' : '';
        return { text: t, item: hit?.item || null, score: hit?.score || 0, how: hit?.how || '', qty, qtyHow: how, unitHint };
    }).filter(Boolean);
    return { date, partner, docNo, lines };
};
