// ==========================================
// 전자서명 이미지 만들기
// ==========================================
// - 자동 발급: 빨간 원형 도장 안에 "이름 + 인"(예: 윤경용인)을 세로쓰기(오른쪽 줄부터)로 채운다.
//   전서체는 무료 웹 글꼴이 없어, 획이 굵은 명조(나눔명조 ExtraBold, Google Fonts)를 칸에 꽉 차게 늘려 도장 느낌을 낸다.
//   글꼴을 못 받으면(오프라인) 기기의 명조·바탕 글꼴로 그린다.
// - 도장 이미지 올리기: 흰 바탕을 투명하게 바꾸고 300px 이하로 줄인다.
// - 모두 PNG dataURL로 돌려준다 (wms_signatures.image).

const SEAL_RED = '#d61f26';
const FONT_FAMILY = 'Nanum Myeongjo';
const FONT_STACK = `"${FONT_FAMILY}", "Batang", "바탕", "Noto Serif KR", "AppleMyungjo", serif`;

// 도장에 들어갈 글자만 받는 작은 글꼴 파일 (text= 로 부분 글꼴)
const loadSealFont = async (text) => {
    try {
        const id = `seal-font-${[...text].map(c => c.codePointAt(0).toString(16)).join('-')}`;
        if (!document.getElementById(id)) {
            const link = document.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            link.href = `https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@800&text=${encodeURIComponent(text)}&display=block`;
            document.head.appendChild(link);
            await new Promise((resolve) => { link.onload = resolve; link.onerror = resolve; setTimeout(resolve, 4000); });
        }
        await Promise.race([
            document.fonts.load(`800 64px "${FONT_FAMILY}"`, text),
            new Promise(r => setTimeout(r, 4000))
        ]);
    } catch { /* 기기 글꼴로 그린다 */ }
};

// 도장 글자: 한글 이름이면 "이름인", 그 밖은 앞 4글자
export const sealText = (name) => {
    const n = String(name || '').replace(/\s+/g, '').replace(/\(.*?\)/g, '');
    if (!n) return '인';
    if (/^[가-힣]+$/.test(n)) return `${n.slice(0, 5)}인`;
    return n.slice(0, 4);
};

// 글자 하나를 칸(x, y, w, h)에 꽉 차게 늘려 그린다
const drawFitted = (ctx, ch, x, y, w, h) => {
    ctx.save();
    ctx.font = `800 100px ${FONT_STACK}`;
    const m = ctx.measureText(ch);
    const gw = (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) || m.width || 100;
    const gh = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || 100;
    ctx.translate(x, y);
    ctx.scale(w / gw, h / gh);
    ctx.fillText(ch, m.actualBoundingBoxLeft || 0, m.actualBoundingBoxAscent || 80);
    ctx.restore();
};

/**
 * 원형 도장 이미지 (PNG dataURL)
 * 글자는 두 글자씩 세로 줄로 나눠 오른쪽 줄부터 쓴다. 글자 수가 홀수면 맨 오른쪽 줄은 한 글자를 길게.
 *   윤경용인 → 오른쪽 줄 [윤, 경], 왼쪽 줄 [용, 인]
 */
export const makeRoundSeal = async (name, size = 240) => {
    const text = sealText(name);
    await loadSealFont(text);
    const chars = [...text];
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;
    const ring = size * 0.055;

    ctx.fillStyle = SEAL_RED;
    ctx.strokeStyle = SEAL_RED;
    ctx.lineWidth = ring;
    ctx.beginPath();
    ctx.arc(c, c, c - ring / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();

    // 원 안에 들어가는 정사각형 글자 영역
    const inner = (c - ring - size * 0.03) * Math.SQRT2;
    const x0 = c - inner / 2, y0 = c - inner / 2;
    const gap = size * 0.02;

    // 줄 나누기 (오른쪽 줄부터)
    const cols = [];
    let rest = chars.slice();
    if (rest.length % 2 === 1 && rest.length > 1) cols.push([rest.shift()]);
    while (rest.length) cols.push(rest.splice(0, 2));
    const nCol = cols.length;
    const colW = (inner - gap * (nCol - 1)) / nCol;
    cols.forEach((col, ci) => {
        const x = x0 + inner - colW - ci * (colW + gap);   // 오른쪽에서 왼쪽으로
        const rowH = (inner - gap * (col.length - 1)) / col.length;
        col.forEach((ch, ri) => drawFitted(ctx, ch, x, y0 + ri * (rowH + gap), colW, rowH));
    });

    // 찍은 도장처럼 가장자리를 약간 거칠게
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    let seed = [...text].reduce((a, ch) => a + ch.codePointAt(0), 7);
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 3; i < d.length; i += 4) {
        if (d[i] > 0 && rnd() < 0.035) d[i] = Math.floor(d[i] * 0.35);
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
};

// dataURL/파일 → Image
const loadImage = (src) => new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    im.src = src;
});
const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
});

/** 도장·서명 이미지 파일 → 흰 바탕 투명 처리 + 300px 이하 PNG */
export const normalizeSignatureFile = async (file, max = 300) => {
    if (!file || !/^image\//.test(file.type)) throw new Error('이미지 파일(PNG·JPG)을 골라 주세요.');
    const im = await loadImage(await fileToDataUrl(file));
    return trimToPng(im, max, true);
};

/** 그린 서명 캔버스 → 여백 자르고 PNG */
export const canvasToSignature = (canvas, max = 300) => trimToPng(canvas, max, false);

const trimToPng = (src, max, whiteToAlpha) => {
    const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height;
    const cv = document.createElement('canvas');
    cv.width = w0; cv.height = h0;
    const ctx = cv.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, w0, h0);
    const d = img.data;
    let minX = w0, minY = h0, maxX = -1, maxY = -1;
    for (let y = 0; y < h0; y++) {
        for (let x = 0; x < w0; x++) {
            const i = (y * w0 + x) * 4;
            if (whiteToAlpha) {
                const light = Math.min(d[i], d[i + 1], d[i + 2]);
                if (light > 225) d[i + 3] = 0;
                else if (light > 190) d[i + 3] = Math.min(d[i + 3], Math.round((225 - light) / 35 * 255));
            }
            if (d[i + 3] > 20) {
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) throw new Error('서명(도장) 모양이 비어 있습니다.');
    ctx.putImageData(img, 0, 0);
    const pad = 4;
    const bw = maxX - minX + 1 + pad * 2, bh = maxY - minY + 1 + pad * 2;
    const scale = Math.min(1, max / Math.max(bw, bh));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(bw * scale));
    out.height = Math.max(1, Math.round(bh * scale));
    out.getContext('2d').drawImage(cv, minX - pad, minY - pad, bw, bh, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
};
