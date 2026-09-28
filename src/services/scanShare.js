// ==========================================
// 스캔 공유 공용: 요약 표지(등록 정보·전표 내용) 그리기, PDF/JPG 파일 만들기, 누르는 즉시 공유
// 문서 스캔(DocScanPanel)과 전표 스캔(DocScanner)이 함께 쓴다. 파일은 이 기기 안에서만 만든다.
// ==========================================

const stamp = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};
export const shareStamp = stamp;

// 글자가 칸보다 길면 줄여서 … 붙이기
const fit = (ctx, text, maxW) => {
    let t = String(text ?? '');
    if (ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t}…`;
};

/**
 * 요약 표지 (A4 세로 비율, 가로 1240px)
 * @param title 제목 · subtitle 작은 제목
 * @param fields [[이름, 값], ...]
 * @param table { head: [...], widths: [비율...], rows: [[...], ...], align: ['left'|'right'|'center', ...] }
 * @param note 맨 아래 작은 글
 */
export const summaryCanvas = ({ title, subtitle = '', fields = [], table = null, note = '' }) => {
    const W = 1240, P = 70;
    const font = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
    const rowH = 46, fieldH = 50;
    const tableRows = table?.rows?.length || 0;
    const H = Math.max(1754, P * 2 + 150 + fields.length * fieldH + (table ? 90 + (tableRows + 1) * rowH : 0) + (note ? 80 : 0));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#0f172a';
    x.textBaseline = 'middle';
    let y = P + 20;
    x.font = `bold 46px ${font}`;
    x.textAlign = 'center';
    x.fillText(title, W / 2, y);
    if (subtitle) {
        y += 50;
        x.font = `24px ${font}`;
        x.fillStyle = '#475569';
        x.fillText(subtitle, W / 2, y);
        x.fillStyle = '#0f172a';
    }
    y += 60;
    x.textAlign = 'left';
    // 정보 칸
    x.strokeStyle = '#94a3b8';
    x.lineWidth = 2;
    const labelW = 230;
    fields.forEach(([k, v]) => {
        x.fillStyle = '#f1f5f9';
        x.fillRect(P, y, labelW, fieldH);
        x.strokeRect(P, y, W - P * 2, fieldH);
        x.beginPath();
        x.moveTo(P + labelW, y);
        x.lineTo(P + labelW, y + fieldH);
        x.stroke();
        x.fillStyle = '#334155';
        x.font = `bold 24px ${font}`;
        x.fillText(fit(x, k, labelW - 30), P + 18, y + fieldH / 2);
        x.fillStyle = '#0f172a';
        x.font = `26px ${font}`;
        x.fillText(fit(x, v || '-', W - P * 2 - labelW - 36), P + labelW + 18, y + fieldH / 2);
        y += fieldH;
    });
    // 표
    if (table) {
        y += 40;
        const total = table.widths.reduce((s, v) => s + v, 0);
        const colsW = table.widths.map(v => ((W - P * 2) * v) / total);
        const drawRow = (cells, bold, bg) => {
            if (bg) { x.fillStyle = bg; x.fillRect(P, y, W - P * 2, rowH); }
            x.strokeRect(P, y, W - P * 2, rowH);
            let cx = P;
            cells.forEach((cell, i) => {
                if (i) { x.beginPath(); x.moveTo(cx, y); x.lineTo(cx, y + rowH); x.stroke(); }
                x.fillStyle = '#0f172a';
                x.font = `${bold ? 'bold ' : ''}22px ${font}`;
                const al = bold ? 'center' : (table.align?.[i] || 'left');
                x.textAlign = al;
                const tx = al === 'right' ? cx + colsW[i] - 12 : al === 'center' ? cx + colsW[i] / 2 : cx + 12;
                x.fillText(fit(x, cell, colsW[i] - 20), tx, y + rowH / 2);
                cx += colsW[i];
            });
            x.textAlign = 'left';
            y += rowH;
        };
        drawRow(table.head, true, '#e2e8f0');
        table.rows.forEach(r => drawRow(r, false, null));
    }
    if (note) {
        y += 40;
        x.fillStyle = '#64748b';
        x.font = `20px ${font}`;
        x.fillText(fit(x, note, W - P * 2), P, y);
    }
    return c;
};

const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

/** 캔버스들 → 파일 목록 (pdf: 한 파일, jpg: 쪽마다). base는 파일 이름(확장자 제외) */
export const canvasesToFiles = async (canvases, { format = 'pdf', base = `scan_${stamp()}` } = {}) => {
    if (format === 'jpg') {
        const blobs = await Promise.all(canvases.map(c => toBlob(c, 'image/jpeg', 0.82)));
        return blobs.map((b, i) => new File([b], canvases.length > 1 ? `${base}_${i + 1}.jpg` : `${base}.jpg`, { type: 'image/jpeg' }));
    }
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    for (const c of canvases) {
        const jpg = await pdf.embedJpg(new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.8)).arrayBuffer()));
        const w = 595;
        const h = Math.round((w * c.height) / c.width);
        pdf.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h });
    }
    return [new File([await pdf.save()], `${base}.pdf`, { type: 'application/pdf' })];
};

export const NO_SHARE = '이 기기·브라우저에서는 파일 바로 공유를 지원하지 않습니다.\n(카카오톡 등 앱 안에서 연 화면은 공유가 막혀 있을 수 있습니다. 크롬으로 열어 보세요.)\n[이 기기에 저장]으로 저장한 뒤 메신저·메일에 첨부해도 됩니다.';

/**
 * 누르는 즉시 공유하는 버튼 동작.
 * 공유는 누른 직후에 불러야 브라우저가 공유 창을 열므로, 파일을 미리 만들어 두었다가(prepare) 누르면 바로 넘긴다.
 * @param build async (format) => File[] (공유용 파일 이름은 영문·숫자만: 일부 안드로이드 공유 창이 한글 이름을 못 읽음)
 * @param key () => 내용이 바뀌었는지 가리는 문자열
 */
export const createSharer = ({ build, key, showToast = () => {}, format = () => 'pdf' }) => {
    let prepared = { key: '', files: null, jpgs: null };
    let timer = null;
    const prepare = async () => {
        const k = key();
        if (!k || prepared.key === k) return;
        const fmt = format();
        const [files, jpgs] = await Promise.all([build(fmt), fmt === 'pdf' ? build('jpg') : null]);
        if (key() === k) prepared = { key: k, files, jpgs: jpgs || files };
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => prepare().catch(e => console.warn('[공유] 파일 미리 만들기 실패', e)), 500); };
    const onClick = (btn) => {
        if (typeof navigator.share !== 'function') { alert(NO_SHARE); return; }
        if (prepared.files && prepared.key === key()) {
            const ok = (files) => !navigator.canShare || navigator.canShare({ files });
            let files = prepared.files;
            let note = '';
            if (!ok(files) && prepared.jpgs && prepared.jpgs !== files && ok(prepared.jpgs)) {
                files = prepared.jpgs;
                note = ' (이 브라우저는 PDF 공유를 지원하지 않아 JPG로 보냈습니다)';
            }
            if (!ok(files)) { alert(NO_SHARE); return; }
            navigator.share({ files })
                .then(() => showToast(`📤 공유했습니다.${note}`))
                .catch(err => {
                    if (err?.name === 'AbortError') return;
                    const why = err?.name === 'NotAllowedError' ? '브라우저가 막았습니다. 잠시 뒤 다시 눌러 주세요.' : `${err?.name || ''} ${err?.message || err}`.trim();
                    alert(`공유 창을 열지 못했습니다: ${why}`);
                });
            return;
        }
        // 준비 전: 만든 뒤 한 번 더 누르게 (기다린 뒤 여는 공유는 브라우저가 막는다)
        const label = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.textContent = '파일 준비 중…'; }
        prepare()
            .then(() => { if (prepared.files) showToast('📄 공유할 파일이 준비됐습니다. 공유를 한 번 더 눌러 주세요.'); })
            .catch(e => alert(`공유할 파일을 만들지 못했습니다: ${e.message || e}`))
            .finally(() => { if (btn) { btn.disabled = false; btn.innerHTML = label; } });
    };
    return { prepare, schedule, onClick, reset: () => { prepared = { key: '', files: null, jpgs: null }; } };
};
