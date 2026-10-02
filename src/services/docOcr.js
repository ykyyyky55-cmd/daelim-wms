import { state } from './db.js';

// 인쇄된 전표 이미지 → 글자 인식(Tesseract.js, 무료·브라우저 안에서 처리) → 품목·수량 후보 추출.
// 이미지는 밖으로 보내지 않는다. 인식 엔진·한글 자료는 처음 쓸 때 jsDelivr CDN에서 내려받는다(약 10MB, 이후 브라우저 캐시).

let workerPromise = null;
let progressHandler = null;
const DEFAULT_PSM = '3';
let currentPsm = DEFAULT_PSM;
const setPsm = async (worker, psm) => {
    if (psm === currentPsm) return;
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    currentPsm = psm;
};

const getWorker = async () => {
    if (!workerPromise) {
        workerPromise = (async () => {
            const { createWorker } = await import('tesseract.js');
            const worker = await createWorker(['kor', 'eng'], 1, {
                logger: (m) => { if (progressHandler) progressHandler(m); }
            });
            // 쪽 나누기 기본값은 자동 배치 분석(3). 읽을 때마다 setPsm으로 바꾼다 (전표는 여러 방식으로 읽어 줄마다 가장 나은 것을 고름 — recognizeBest)
            await worker.setParameters({ tessedit_pageseg_mode: DEFAULT_PSM });
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

// 읽은 글자의 점수: 품목을 찾은 줄이 많을수록 높다
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
// 업체명 고르기: 똑같은 이름이 여러 번 읽히면 가장 믿을 만하다(같은 이름 수 ×3) + 깨끗함(partnerScore)
// + 한글 낱말별로 몇 번 읽혔나(다른 결과와 겹치는 낱말이 많을수록)
const pickPartner = (cands) => {
    const list = cands.filter(p => p && partnerScore(p) >= 2);
    if (!list.length) return '';
    const wordsOf = (p) => p.split(/\s+/).filter(w => /^[가-힣]{2,}$/.test(w));
    const wordCount = new Map();
    list.forEach(p => new Set(wordsOf(p)).forEach(w => wordCount.set(w, (wordCount.get(w) || 0) + 1)));
    const uniq = [...new Set(list)];
    const scored = uniq.map(p => {
        const same = list.filter(q => q === p).length;
        const support = wordsOf(p).reduce((a, w) => a + (wordCount.get(w) || 0), 0) / list.length;
        return { p, s: same * 3 + partnerScore(p) + support * 2 };
    });
    return scored.sort((a, b) => b.s - a.s)[0].p;
};

// 영수증 윗부분(업체명 자리, 위 25%) 또는 아랫부분(카드번호 자리, 아래 40%)만 바로 세운 그림
const partCanvas = (img, rotate, part) => {
    const full = preprocessImage(img, { rotate, contrast: false, removeLines: false, target: 1600, fit: true });
    const top = part === 'bottom' ? Math.round(full.height * 0.6) : 0;
    const h = part === 'bottom' ? full.height - top : Math.max(40, Math.round(full.height * 0.25));
    const c = document.createElement('canvas');
    c.width = full.width;
    c.height = h;
    c.getContext('2d').drawImage(full, 0, -top);
    return c;
};
const headerCanvas = (img, rotate) => partCanvas(img, rotate, 'top');

const recognizeReceipt = async (img, { rotate = 0, contrast = true } = {}, onProgress) => {
    const passes = [{ target: 600, contrast: true }, { target: 750, contrast: true }, { target: 900, contrast: false }, { target: 600, contrast: false }, { target: 1800, contrast, fit: false }];
    // 업체명 자리만: 너비 360~720px, 흑백 보정 있고·없고 (작은 그림이라 빨리 끝남)
    const heads = [360, 460, 560, 720].flatMap(w => [{ w, contrast: false }, { w, contrast: true }]);
    const total = passes.length + heads.length;
    const results = [];
    for (let i = 0; i < passes.length; i++) {
        const p = passes[i];
        const canvas = preprocessImage(img, { rotate, contrast: p.contrast, target: p.target, fit: p.fit !== false });
        const text = await recognizeImage(canvas, (m) => onProgress?.({ ...m, status: `${m.status} (${i + 1}/${total}차 읽기)` }));
        results.push({ text, r: parseReceiptText(text), date: parseSlipText(text).date, score: scoreReceipt(text) * 10 + Math.min(9, scoreParse(parseSlipText(text))) });
    }
    const headPartners = [];
    try {
        const head = headerCanvas(img, rotate);
        for (let i = 0; i < heads.length; i++) {
            const { w, contrast: ct } = heads[i];
            const canvas = preprocessImage(head, { contrast: ct, removeLines: false, target: Math.round(head.width >= head.height ? w : w * (head.height / head.width)), fit: true });
            const text = await recognizeImage(canvas, (m) => onProgress?.({ ...m, status: `업체명 읽는 중 (${passes.length + i + 1}/${total}차 읽기)` }));
            headPartners.push(parseReceiptText(text).partner);
        }
    } catch (e) { console.warn('[영수증] 업체명 자리 읽기 실패', e); }
    // 카드 끝 4자리를 못 찾았으면 아랫부분(카드번호 자리)만 4번 더 읽는다 (별표가 이어진 카드번호 줄은 전체로 읽으면 잘 깨짐)
    const tail = [];
    if (!results.some(x => x.r.last4)) {
        try {
            const bottom = partCanvas(img, rotate, 'bottom');
            const tails = [{ w: 700, contrast: false }, { w: 700, contrast: true }, { w: 900, contrast: false }, { w: 1200, contrast: true }];
            for (let i = 0; i < tails.length; i++) {
                const { w, contrast: ct } = tails[i];
                const canvas = preprocessImage(bottom, { contrast: ct, removeLines: false, target: Math.round(bottom.width >= bottom.height ? w : w * (bottom.height / bottom.width)), fit: true });
                const text = await recognizeImage(canvas, (m) => onProgress?.({ ...m, status: `카드번호 읽는 중 (${i + 1}/${tails.length})` }));
                const rr = parseReceiptText(text);
                // 카드번호 줄이 둘로 끊겨 읽히면('5312-' / '9012') 끝 조각만 남는다: 한글·다른 숫자 없이 가린 글자·붙임표 뒤 네 자리로 끝나는 줄
                if (!rr.last4 && /카\s*드|\d{4}\s*[-—–]/.test(text)) {
                    const m = text.split('\n').map(l => l.trim().match(/^[^가-힣\dA-Za-z]*(?:[-—–*※xX¥%#]+\s*)?(\d{4})\s*[)\].,]?$/)).find(Boolean); // '5312-'(앞 네 자리)는 제외
                    if (m) rr.last4 = m[1];
                }
                tail.push(rr);
            }
        } catch (e) { console.warn('[영수증] 카드번호 자리 읽기 실패', e); }
    }
    const partner = pickPartner([...results.map(x => x.r.partner), ...headPartners]);
    // 화면에 보여 줄 글자: 고른 업체명이 그대로 들어 있는 결과를 앞세우고, 그중 영수증 정보가 가장 많은 것
    results.forEach(x => { x.show = x.score + (partner && x.r.partner === partner ? 50 : 0); });
    const best = results.reduce((a, b) => (b.show > a.show ? b : a));    const amount = Number(mostCommon(results.map(x => (x.r.amount ? String(x.r.amount) : '')))) || 0;
    return {
        text: best.text, score: best.score, pass: results.indexOf(best) + 1, target: passes[results.indexOf(best)].target,
        receipt: {
            partner, amount, issuer: mostCommon([...results.map(x => x.r.issuer), ...tail.map(x => x.issuer)]), last4: mostCommon([...results.map(x => x.r.last4), ...tail.map(x => x.last4)]),
            approvalNo: mostCommon(results.map(x => x.r.approvalNo)), date: mostCommon(results.map(x => x.date))
        }
    };
};

// 전표 읽기 순서: 쪽 나누기 방식(psm) × 크기. 표로 된 전표는 한 단(4)·한 덩어리(6)로 읽어야 품명과 수량이 같은 줄에 놓이고,
// 자동 배치 분석(3)은 표를 세로 칸 단위로 읽어 품명·수량이 다른 줄로 흩어진다(2026-10-03 예시 전표 측정: 품목+수량이 같이 맞은 줄 0/8 → 6/8).
// 반대로 한 덩어리(6)는 영문 품명을 한글로 잘못 읽는 전표가 있어('EtOH' → '타애') 한 방식만 쓰지 않고 줄마다 가장 잘 읽힌 것을 고른다.
const SLIP_PASSES = [{ psm: '4', target: 1800 }, { psm: '6', target: 1800 }, { psm: '3', target: 1800 }, { psm: '4', target: 3000 }];
const BASE_PASS_COUNT = 3; // 여기까지 읽고도 품목을 못 찾았거나 수량이 불확실한 줄이 절반을 넘으면 큰 크기로 한 번 더
/** 수량을 믿을 만하게 찾은 줄인지 (표의 수량 칸 · 수량+단위 · 수량×단가=금액 — '첫 숫자'로 집은 것은 불확실) */
const hasSureQty = (line) => line.qty > 0 && line.qtyHow !== 'first';

/** 줄 하나의 읽힘 정도: 품목(+수량)을 찾았나, 머리 정보(일자·거래처·번호)가 있나 */
const rowQuality = (text) => {
    const parsed = parseSlipText(text);
    const line = parsed.lines[0];
    return {
        item: line?.item ? 10 + line.score + (line.qty > 0 ? 5 : 0) : 0,
        head: (parsed.date ? 1 : 0) + (parsed.partner ? 1 : 0) + (parsed.docNo ? 1 : 0)
    };
};
const isBetterRow = (old, next) => next.item > old.item || (next.item === old.item && next.head > old.head);

/** 여러 번 읽은 줄을 높이(쪽 높이에 대한 비율, 기울기 보정)로 맞춰 합친다 — 같은 높이의 줄은 더 잘 읽힌 쪽을 남긴다 */
const SAME_ROW_RATIO = 0.6; // 두 줄의 높이 차가 글자 높이의 60% 안이면 같은 줄
const mergeRows = (merged, rows) => {
    rows.forEach((row) => {
        const quality = rowQuality(row.text);
        const near = merged
            .map(m => ({ m, diff: Math.abs(m.y - row.y) }))
            .filter(({ m, diff }) => diff <= SAME_ROW_RATIO * Math.min(m.h, row.h))
            .sort((p, q) => p.diff - q.diff)[0];
        if (!near) { merged.push({ ...row, quality }); return; }
        if (isBetterRow(near.m.quality, quality)) { near.m.text = row.text; near.m.quality = quality; }
    });
    merged.sort((p, q) => p.y - q.y);
};

export const recognizeBest = async (img, { rotate = 0, contrast = true, receipt = false } = {}, onProgress) => {
    if (receipt) return recognizeReceipt(img, { rotate, contrast }, onProgress);
    const merged = [];
    const seen = new Set();
    let pass = 0;
    let target = 0;
    for (let i = 0; i < SLIP_PASSES.length; i++) {
        const { psm, target: size } = SLIP_PASSES[i];
        const canvas = preprocessImage(img, { rotate, contrast, target: size });
        const key = `${psm}:${canvas.width}`;
        if (seen.has(key)) continue; // 원본이 커서 확대되지 않으면 같은 그림을 같은 방식으로 다시 읽지 않는다
        seen.add(key);
        pass = i + 1;
        target = size;
        const rows = await recognizeRows(canvas, psm, (m) => onProgress?.({ ...m, status: `${m.status} (${pass}차 읽기)` }));
        mergeRows(merged, rows);
        const parsed = parseSlipText(merged.map(r => r.text).join('\n'));
        const matched = parsed.lines.filter(l => l.item);
        // 모든 줄에서 품목과 수량을 찾았으면 끝
        if (matched.length > 0 && matched.length === parsed.lines.length && matched.every(hasSureQty)) break;
        if (i + 1 >= BASE_PASS_COUNT && matched.length > 0 && matched.filter(hasSureQty).length * 2 >= matched.length) break;
    }
    const text = merged.map(r => r.text).join('\n');
    return { text, score: scoreParse(parseSlipText(text)), pass, target };
};

// 낱말 상자 → 줄 (표를 세로 칸으로 읽어도 가로 줄로 되돌아옴).
//  1) 왼쪽 낱말부터, 그 줄의 마지막(바로 왼쪽) 낱말과 높이가 겹치는 줄에 잇는다 — 사진이 조금 기울어도 줄이 끊기지 않는다
//     (줄 전체의 평균 높이와 비교하면 1.5°만 기울어도 오른쪽 끝의 수량이 다른 줄로 떨어져 나감)
//  2) 긴 줄들의 기울기 중앙값으로 낱말 높이를 바로잡아 줄의 높이를 정한다 (여러 번 읽은 결과를 높이로 맞출 때 씀)
//  3) 그래도 갈라진 줄(바로잡은 높이가 글자 높이의 45% 안)은 합친다
// 한글은 글자마다 낱말로 끊겨 읽히므로('샘 플 엔 진') 사이가 글자 높이의 18%보다 좁으면 붙인다 (띄어쓰기는 높이의 30%쯤).
const WORD_JOIN_GAP = 0.18;
const median = (values) => { const sorted = [...values].sort((p, q) => p - q); return sorted.length ? sorted[sorted.length >> 1] : 0; };
const rowsFromWords = (words, pageWidth, pageHeight) => {
    const boxes = words
        .filter(w => String(w.text || '').trim())
        .map(w => ({ text: String(w.text).trim(), x0: w.bbox.x0, x1: w.bbox.x1, cx: (w.bbox.x0 + w.bbox.x1) / 2, cy: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0 }))
        .sort((p, q) => p.x0 - q.x0);
    const chains = [];
    boxes.forEach((box) => {
        let best = null;
        chains.forEach((chain) => {
            const last = chain[chain.length - 1];
            const diff = Math.abs(last.cy - box.cy);
            if (diff < Math.max(last.h, box.h) * 0.5 && (!best || diff < best.diff)) best = { chain, diff };
        });
        if (best) best.chain.push(box); else chains.push([box]);
    });
    const slope = median(chains
        .filter(chain => chain.length >= 2 && chain[chain.length - 1].cx - chain[0].cx > 5 * chain[0].h)
        .map(chain => (chain[chain.length - 1].cy - chain[0].cy) / (chain[chain.length - 1].cx - chain[0].cx)));
    const lines = chains
        .map(chain => ({ boxes: chain, y: chain.reduce((sum, b) => sum + b.cy - slope * (b.cx - pageWidth / 2), 0) / chain.length, h: median(chain.map(b => b.h)) }))
        .sort((p, q) => p.y - q.y);
    const joined = [];
    lines.forEach((line) => {
        const prev = joined[joined.length - 1];
        if (prev && Math.abs(prev.y - line.y) < 0.45 * Math.min(prev.h, line.h)) {
            prev.y = (prev.y * prev.boxes.length + line.y * line.boxes.length) / (prev.boxes.length + line.boxes.length);
            prev.boxes.push(...line.boxes);
            return;
        }
        joined.push(line);
    });
    joined.forEach(line => line.boxes.sort((p, q) => p.x0 - q.x0));
    const column = quantityColumn(joined);
    return joined.map((line) => {
        const text = line.boxes.reduce((acc, box, i) => {
            if (!i) return box.text;
            const gap = box.x0 - line.boxes[i - 1].x1;
            return acc + (gap < line.h * WORD_JOIN_GAP ? '' : ' ') + box.text;
        }, '');
        const qty = column && line.y > column.y ? quantityInColumn(line, column) : '';
        return { y: line.y / pageHeight, h: line.h / pageHeight, text: qty ? `${text} ${qtyColumnTag(qty)}` : text };
    });
};

// ---------- 표의 '수량' 칸 ----------
// 표로 된 전표는 머리줄의 '수량' 글자 아래에 수량이 놓인다. 낱말 위치로 그 칸의 숫자를 찾아 줄 끝에 '[수량칸 240]'으로 적어 두면
// 품명에 든 숫자(5W30·150N)나 규격(200L)을 수량으로 잘못 집지 않는다 (guessQty가 가장 먼저 본다. 읽은 글자에서 고칠 수 있다).
const QTY_HEAD_RE = /^(수량|수량\(.{0,6}\)|q['’]?ty|qty|quantity)$/i;
const QTY_TAG_RE = /\[수량칸\s*([\d,]+(?:\.\d+)?)\]/;
const qtyColumnTag = (qty) => `[수량칸 ${qty}]`;
/** 가까이 붙은 낱말을 한 칸의 글자로 묶는다 (한글은 글자마다 끊겨 읽히므로 '수', '량'을 '수량'으로) */
const phrasesOf = (line) => {
    const phrases = [];
    line.boxes.forEach((box) => {
        const last = phrases[phrases.length - 1];
        if (last && box.x0 - last.x1 < line.h * 0.8) { last.text += box.text; last.x1 = box.x1; return; }
        phrases.push({ text: box.text, x0: box.x0, x1: box.x1 });
    });
    return phrases;
};
/** 머리줄에서 '수량' 칸의 가로 범위를 찾는다 (없으면 null) */
const quantityColumn = (lines) => {
    for (const line of lines) {
        const phrases = phrasesOf(line);
        const index = phrases.findIndex(ph => QTY_HEAD_RE.test(ph.text.replace(/[\s|[\]:.]/g, '')));
        if (index < 0 || phrases.length < 2) continue;
        const head = phrases[index];
        const width = head.x1 - head.x0;
        const left = index > 0 ? (phrases[index - 1].x1 + head.x0) / 2 : head.x0 - width * 2;
        const right = index < phrases.length - 1 ? (head.x1 + phrases[index + 1].x0) / 2 : head.x1 + width * 2;
        return { y: line.y, left, right, center: (head.x0 + head.x1) / 2 };
    }
    return null;
};
/** 그 줄에서 '수량' 칸 안에 놓인 숫자 (없으면 '') */
const quantityInColumn = (line, column) => {
    const numbers = phrasesOf(line)
        .map(ph => ({ ...ph, clean: nfkc(ph.text).replace(/[|[\](){}:;'"`]/g, '') }))
        .filter(ph => /^\d[\d,]*(?:\.\d+)?$/.test(ph.clean) && (ph.x0 + ph.x1) / 2 > column.left && (ph.x0 + ph.x1) / 2 < column.right)
        .sort((p, q) => Math.abs((p.x0 + p.x1) / 2 - column.center) - Math.abs((q.x0 + q.x1) / 2 - column.center));
    return numbers[0]?.clean || '';
};

/** 그림을 읽어 줄 목록 [{ y: 쪽 높이에 대한 비율, text }]으로 (낱말 위치로 줄을 다시 짬) */
export const recognizeRows = async (canvas, psm = DEFAULT_PSM, onProgress) => {
    progressHandler = onProgress;
    try {
        const worker = await getWorker();
        await setPsm(worker, psm);
        const { data } = await worker.recognize(canvas);
        if (data.words?.length) return rowsFromWords(data.words, canvas.width || 1, canvas.height || 1);
        // 낱말 위치가 없으면 읽은 글자를 줄 순서대로
        const lines = String(data.text || '').split(/\r?\n/).filter(t => t.trim());
        return lines.map((text, i) => ({ y: (i + 0.5) / lines.length, h: 0.5 / lines.length, text }));
    } finally {
        progressHandler = null;
    }
};

export const recognizeImage = async (canvas, onProgress) => {
    progressHandler = onProgress;
    try {
        const worker = await getWorker();
        await setPsm(worker, DEFAULT_PSM);
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

// 줄 끝의 '수량 단위'(1,600 L · 360 KG): 수량 칸과 단위 칸이 따로 있어 숫자와 단위 사이가 떨어져 있다 (규격 '200L'은 붙어 있음)
const TAIL_QTY_RE = /(?:^|\s)(\d[\d,]*(?:\.\d+)?)\s+(l|ℓ|리터|kg|킬로|g|ml|ton|톤)\s*[|\])}.,]*\s*$/i;
/**
 * 한 줄에서 수량 추정: 표의 수량 칸([수량칸 n]) > 수량+개수 단위(20 BOX) > 줄 끝의 '수량 부피·무게 단위' > 수량×단가=금액 > 품명·규격에 없는 첫 숫자
 * @param {string} line
 * @param {{ name?: string, spec?: string }|null} [item] 그 줄에서 찾은 품목 — 품명·규격에 든 숫자(5W30의 5·30, 150N)는 수량 후보에서 뺀다
 */
const guessQty = (line, item = null) => {
    const tagged = line.match(QTY_TAG_RE);
    if (tagged) return { qty: toNum(tagged[1]), how: 'column' };
    const u = line.match(QTY_UNIT_RE);
    if (u) return { qty: toNum(u[1]), how: 'unit' };
    const tail = nfkc(line).match(TAIL_QTY_RE);
    if (tail) return { qty: toNum(tail[1]), how: 'unit' };
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
    if (!nums.length) return { qty: 0, how: '' };
    // 품명·규격에 든 숫자는 수량이 아닐 가능성이 높다 (그것뿐이면 예전처럼 첫 숫자)
    const ownNums = new Set((nfkc(`${item?.name || ''} ${item?.spec || ''}`).match(NUM_RE) || []).map(toNum));
    const others = nums.filter(n => !ownNums.has(n));
    return { qty: (others.length ? others : nums)[0], how: 'first' };
};

let masterIndex = null;
let masterIndexFor = null;
let masterIndexSize = -1; // 같은 배열에 품목이 더해져도(새 품목 빠른 등록) 다시 만들게 개수도 본다
const specKeyOf = (spec) => {
    DIM_RE.lastIndex = 0;
    const m = DIM_RE.exec(String(spec || ''));
    DIM_RE.lastIndex = 0;
    return m ? dimKey(m[1], m[2], m[3]) : '';
};
const getMasterIndex = () => {
    if (masterIndexFor !== state.master || masterIndexSize !== state.master.length) {
        // grams: 숫자를 뺀 품목명의 두 글자 묶음 (용량·코드 숫자끼리 우연히 겹쳐 엉뚱한 품목이 잡히지 않게)
        masterIndex = state.master.map(m => {
            const word = norm(m.name).replace(/\d+/g, '');
            return { m, code: norm(m.code), name: norm(m.name), word, grams: bigrams(word), spec: specKeyOf(m.spec) };
        });
        masterIndexFor = state.master;
        masterIndexSize = state.master.length;
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
    // 글자 인식이 '합 계'를 '합 겨'·'합 게'로 읽기도 한다. 합계 줄을 못 찾으면 금액 중 가장 큰 것(카드 영수증은 합계가 가장 큼)
    const TOTAL_LINE = /(합\s*[계겨게개]|총\s*[계겨게개액앤]|결\s*제\s*금\s*액|승\s*인\s*금\s*액|받\s*을\s*금\s*액|청\s*구\s*금\s*액|결\s*제\s*액|TOTAL)/i;
    // '10 , 800' → '10,800', 그리고 '원'이 숫자로 잘못 읽힌 '75,9008' → '75,900원' (쉼표 뒤가 네 자리일 수는 없음)
    const fixNum = (l) => l.replace(/(\d)\s*([,.])\s*(\d{3})/g, '$1$2$3').replace(/(\d{1,3}(?:[,.]\d{3})+)\d(?=\s|$|[^\d,.])/g, '$1원');
    const amountOf = (l) => {
        const s = fixNum(l);
        const ms = s.match(/\d{1,3}(?:[,.]\d{3})+|\d{3,8}/g) || [];
        const withWon = s.match(/(\d{1,3}(?:[,.]\d{3})+|\d{3,8})\s*원/);
        const pick = withWon ? withWon[1] : ms[ms.length - 1];
        const n = pick ? Number(pick.replace(/[,.]/g, '')) : 0;
        return n > 0 && n < 100000000 ? n : 0;
    };
    const noNo = (l) => !/번\s*호|no\.?|전\s*화|tel/i.test(l);
    lines.filter(l => TOTAL_LINE.test(l) && noNo(l)).forEach(l => { const n = amountOf(l); if (n) amount = n; }); // 아래쪽(최종 합계)이 이긴다
    // 금액 모양(쉼표로 세 자리씩 끊은 수, 또는 '원'이 붙은 수) 중 가장 큰 값 — 번호·전화·카드번호 줄 제외
    let maxAmt = 0;
    lines.filter(l => noNo(l) && !/카\s*드\s*번\s*호|\d{4}\s*[-*xX※]/.test(l)).forEach(l => {
        const s = fixNum(l);
        (s.match(/\d{1,3}(?:[,.]\d{3})+(?![\d])|\d{3,8}(?=\s*원)/g) || []).forEach(m => {
            const n = Number(m.replace(/[,.]/g, ''));
            if (n > maxAmt && n < 100000000) maxAmt = n;
        });
    });
    // 합계 줄을 못 찾았거나, 합계로 읽은 값보다 큰 금액이 있으면(합계 줄 글자가 깨져 소계를 잡은 경우) 가장 큰 금액
    if (!amount || maxAmt > amount) amount = maxAmt || amount;
    let issuer = '';
    let last4 = '';
    const cardLineIdx = lines.findIndex(l => /카\s*드|신\s*용|체\s*크|[가-힣]{0,2}\s*-\s*드\s*\(/.test(l) && !/현금/.test(l));
    if (cardLineIdx >= 0) {
        const near = lines.slice(cardLineIdx, cardLineIdx + 3).join(' ');
        issuer = (CARD_ISSUERS.find(([re]) => re.test(near)) || [])[1] || '';
        const m = near.match(/\d{4}\s*[-\s][^가-힣]{4,20}?[-\s]\s*(\d{4})(?!\d)/) || near.match(/[*xX※]{2,}[^\d]{0,4}(\d{4})(?!\d)/);
        if (m) last4 = m[1];
    }
    // 카드 줄이 깨져도: '5521-****-****-1234'처럼 네 자리로 시작하고 가린 글자(* x ※ ¥ 등) 뒤 네 자리로 끝나는 줄
    if (!last4) {
        const m = lines.map(l => l.match(/(?<!\d)\d{4}\s*[-—–~\s][^가-힣\d]{3,}[-—–~\s]?\s*(\d{4})\s*$/)).find(Boolean);
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
        // 영수증 '가맹점: 김씨네 고기구이 (강남점)' — '가맹점번호'와 헷갈리지 않게 바로 뒤에 ':'가 있을 때만
        /가\s*맹\s*점\s*[:：]\s*([^\s:：|]*[가-힣A-Za-z][^:：|]*?)\s*(?:$|[|]|대\s*표|사업자|전\s*화|tel)/i,
        /((?:\([주수추]\)|㈜|주식회사)\s*[가-힣A-Za-z][가-힣A-Za-z0-9]*(?:\s[가-힣A-Za-z][가-힣A-Za-z0-9]*){0,3})/,
        /([가-힣A-Za-z][가-힣A-Za-z0-9&]*(?:\s[가-힣A-Za-z][가-힣A-Za-z0-9&]*){0,3}\s*(?:\([주수추]\)|㈜|주식회사))/
    ];
    for (const re of PARTNER_RES) {
        const m = rawLines.map(l => l.match(re)).find(Boolean);
        if (m) { partner = m[1].trim().replace(/\((수|추)\)/, '(주)'); break; }
    }
    const nm = String(text).match(/(?:No\.?|번\s*호|전표\s*번호)\s*[:：#]?\s*([A-Z0-9][A-Z0-9\-]{3,})/i);
    const docNo = nm ? nm[1] : '';
    const SKIP = /카\s*드\s*번\s*호|지\s*불\s*수\s*단|주\s*문\s*번\s*호|가\s*맹\s*점|승\s*인\s*번\s*호|전\s*표\s*번\s*호|할\s*부|신\s*용\s*카\s*드|체\s*크\s*카\s*드|현금영수증|봉사료|가\s*치\s*세|합\s*계|소\s*계|총\s*액|금\s*액|공급\s*가|부가세|세\s*액|사업자|등록\s*번호|대\s*표|주\s*소|전\s*화|팩\s*스|fax|tel|업\s*태|종\s*목|인\s*수|담당|일\s*자|날\s*짜|상\s*호|성\s*명|공급받는|품\s*목\s*명|\bno\.|20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]|은행|계좌|예금주|입금|원\s*정|[일이삼사오육칠팔구십백천만억]{4,}\s*원|(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)|\d{2,6}\s*-\s*\d{2,6}\s*-\s*\d{2,6}\s*-\s*\d{2,6}/i;
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
        const { qty, how } = guessQty(t, hit?.item || null);
        // 수량 바로 뒤에 kg가 적혀 있으면(예: '160 kg') 입력 단위를 KG로 제안 (화면에서 비중으로 품목 단위로 환산)
        const unitHint = qty > 0 && new RegExp(`(?<![\\d.,])${String(qty).replace('.', '\\.')}\\s*(kg|킬로)(?![a-z])`, 'i').test(nfkc(t).replace(/,/g, '')) ? 'KG' : '';
        return { text: t, item: hit?.item || null, score: hit?.score || 0, how: hit?.how || '', qty, qtyHow: how, unitHint };
    }).filter(Boolean);
    return { date, partner, docNo, lines };
};
