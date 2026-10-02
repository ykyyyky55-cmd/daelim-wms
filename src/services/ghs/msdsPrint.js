// ==========================================
// 혼합물 MSDS · 경고표지 인쇄 문서 (A4)
// ==========================================
// · msdsHtml: 고시 별표 4의 16개 항목 순서 그대로. MSDS 번호는 첫 쪽 위 오른쪽(개별 항목 밖)에 적는다.
// · labelHtml: 별표 3의 경고표지 양식 (명칭 · 그림문자 · 신호어 · 유해·위험 문구 · 예방조치 문구 · 공급자 정보)
// · basisHtml: 분류 근거(정확한 함유량 포함) — 사내 보관용이라 대외비 표시를 넣는다. MSDS 본문에는 넣지 않는다.
// 그림문자는 인라인 SVG라 저장한 파일(첨부)에서도 그대로 보인다.
import { esc } from '../html.js';
import { MSDS_SECTIONS, SIGNALS, GHS_NOTICE, clsLabel, PICTOGRAMS } from './ghsTables.js';
import { pictogramSvg } from './pictograms.js';

const multiline = (text) => esc(text).replace(/\n/g, '<br>');
/** CSS 문자열("…") 안에 넣을 글자. <style> 안에서는 HTML 엔티티가 풀리지 않으므로 esc() 대신 문자열·태그를 끊는 글자만 뺀다 */
const cssStr = (text) => String(text ?? '').replace(/[\\"<>\r\n]/g, ' ').trim();
const PRINT_SCRIPT = '<script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };<\/script>';

const BASE_CSS = `
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif; color: #111; font-size: 9pt; line-height: 1.45; }
    .page { width: 186mm; margin: 0 auto; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    @media screen { body { background: #cbd5e1; padding: 8mm 0; } .page { background: #fff; padding: 12mm; width: 210mm; box-shadow: 0 1px 6px rgba(0,0,0,.25); } }`;

/** 3항 구성성분 표 */
const s3Html = (built) => `
    ${built.s3.length ? `<table class="comp"><colgroup><col><col style="width:44mm"><col style="width:30mm"><col style="width:24mm"></colgroup>
        <thead><tr><th>화학물질명</th><th>관용명 및 이명(異名)</th><th>CAS번호 또는 식별번호</th><th>함유량(%)</th></tr></thead>
        <tbody>${built.s3.map(r => `<tr><td>${esc(r.name)}${r.secret ? ' *' : ''}</td><td>${esc(r.alias || '-')}</td><td class="c">${esc(r.cas)}</td><td class="c">${esc(r.content)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${built.s3Note ? `<div class="note">${multiline(built.s3Note)}</div>` : ''}`;

/**
 * 물질안전보건자료 문서
 * @param {Object} doc 문서
 * @param {ReturnType<import('./msdsBuild.js').buildMsds>} built
 * @param {{ autoPrint?: boolean }} [opt]
 */
export const msdsHtml = (doc, built, { autoPrint = true } = {}) => {
    const p = doc.product || {}, rev = doc.rev || {};
    const cell = (key) => {
        if (key === 's3') return s3Html(built);
        if (key === 's2.pic') return built.label.pictograms.length ? `<div class="pics">${built.label.pictograms.map(c => `<span title="${esc(PICTOGRAMS[c])}">${pictogramSvg(c, '17mm')}</span>`).join('')}</div>` : '해당 없음';
        if (key === 's2.signal') return `<b class="signal">${multiline(built.text[key])}</b>`;
        return multiline(built.text[key] ?? '');
    };
    const sectionHtml = (sec) => `
        <section>
            <h2>${sec.no}. ${esc(sec.title)}</h2>
            ${sec.items.map(it => {
                if (it.key === 's3') return cell('s3');
                if (it.sub) return `<div class="row head"><div class="lb">${esc(it.label)}</div></div>${it.sub.map(x => `<div class="row sub"><div class="lb">○ ${esc(x.label)}</div><div class="tx">${cell(x.key)}</div></div>`).join('')}`;
                return `<div class="row"><div class="lb">${esc(it.label)}</div><div class="tx">${cell(it.key)}</div></div>`;
            }).join('')}
        </section>`;
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>MSDS ${esc(p.name || '')}</title>
    <style>
        @page { size: A4 portrait; margin: 13mm 12mm 14mm; @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; color: #555; } @bottom-left { content: "${cssStr(p.name)}"; font-size: 7.5pt; color: #777; } @bottom-right { content: "${cssStr(rev.revDate || rev.firstDate)}"; font-size: 7.5pt; color: #777; } }
        ${BASE_CSS}
        .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 4mm; border-bottom: 0.6mm solid #111; padding-bottom: 2.5mm; margin-bottom: 3mm; }
        .top h1 { margin: 0; font-size: 17pt; letter-spacing: 1px; }
        .top .sub { font-size: 9.5pt; margin-top: 1mm; }
        .top .sub b { font-size: 11.5pt; }
        .no { border: 0.3mm solid #111; padding: 1.2mm 2.5mm; font-size: 8.5pt; min-width: 52mm; }
        .no div + div { margin-top: 0.6mm; color: #333; }
        section { margin-bottom: 2.6mm; }
        h2 { font-size: 10.5pt; margin: 0 0 1mm; padding: 1.1mm 2mm; background: #e8ecf1; border-left: 1.2mm solid #1e3c96; break-after: avoid; }
        .row { display: flex; border-bottom: 0.2mm solid #d5d9e0; break-inside: avoid; }
        .row .lb { flex: 0 0 56mm; padding: 1mm 1.5mm; font-weight: 700; background: #f7f8fa; }
        .row .tx { flex: 1; padding: 1mm 1.8mm; word-break: keep-all; overflow-wrap: anywhere; }
        .row.head .lb { flex: 1; background: #f1f3f6; }
        .row.sub .lb { font-weight: 500; padding-left: 4mm; }
        .signal { font-size: 11pt; }
        .pics span { display: inline-block; margin-right: 2mm; line-height: 0; }
        table.comp th, table.comp td { border: 0.25mm solid #666; padding: 1mm 1.5mm; font-size: 8.8pt; word-break: keep-all; overflow-wrap: anywhere; }
        table.comp th { background: #eef1f5; } td.c { text-align: center; }
        .note { font-size: 8.5pt; padding: 1mm 1.5mm; }
        .end { margin-top: 3mm; font-size: 7.5pt; color: #666; text-align: right; }
    </style></head><body><div class="page">
        <div class="top">
            <div><h1>물질안전보건자료 (MSDS)</h1><div class="sub">제품명: <b>${esc(p.name || '')}</b></div></div>
            <div class="no"><div><b>MSDS 번호:</b> ${esc(p.msdsNo || '')}</div><div>개정 ${esc(rev.no || '0')} · ${esc(rev.revDate || rev.firstDate || '')}</div></div>
        </div>
        ${MSDS_SECTIONS.map(sectionHtml).join('')}
        <div class="end">「화학물질의 분류·표시 및 물질안전보건자료에 관한 기준」(${esc(GHS_NOTICE)}) 별표 4의 작성항목에 따라 작성</div>
    </div>${autoPrint ? PRINT_SCRIPT : ''}</body></html>`;
};

/** 경고표지 크기 (별표 3 제2호 가목: 용기·포장 용량별 인쇄 또는 표찰의 규격) */
export const LABEL_SIZES = [
    { key: 'A4', label: 'A4 한 장 (500 L 이상 — 450㎠ 이상)', w: 186, h: 262, per: 1 },
    { key: 'A5', label: 'A4에 2장 (200 L 이상 500 L 미만 — 300㎠ 이상)', w: 186, h: 128, per: 2 },
    { key: 'A6', label: 'A4에 4장 (50 L 이상 200 L 미만 — 180㎠ 이상)', w: 91, h: 128, per: 4 },
    { key: 'A7', label: 'A4에 8장 (5 L 이상 50 L 미만 — 90㎠ 이상)', w: 91, h: 62.5, per: 8 }
];

/**
 * 경고표지에 넣을 예방조치 문구: 7개 이상이면 예방·대응·저장·폐기 각 1개 이상을 포함해 6개만 (제6조의2 제5항 제2호)
 * @returns {{ list: Array<{ code: string, text: string }>, cut: boolean }}
 */
export const labelPStatements = (label, shorten) => {
    const groups = ['prev', 'resp', 'stor', 'disp'].map(g => label.p[g]);
    const all = groups.flat();
    if (!shorten || all.length <= 6) return { list: all, cut: false };
    const picked = groups.map(g => g[0]).filter(Boolean);
    for (const g of groups) for (const x of g.slice(1)) { if (picked.length >= 6) break; picked.push(x); }
    return { list: all.filter(x => picked.includes(x)), cut: true };
};

/**
 * 경고표지 (별표 3 양식)
 * @param {{ size?: string, shortP?: boolean, codes?: boolean, autoPrint?: boolean }} [opt] codes = H·P 코드 번호도 표시(제6조의2 제6항: 표시할 수 있다)
 */
export const labelHtml = (doc, built, { size = 'A5', shortP = true, codes = false, autoPrint = true } = {}) => {
    const sz = LABEL_SIZES.find(x => x.key === size) || LABEL_SIZES[1];
    const p = doc.product || {}, sup = doc.supplier || {};
    const label = built.label;
    // 작은 표지는 그림문자 4개까지 (5개 이상이면 4개만 표시할 수 있다 — 제6조의2 제2항 제4호)
    const pics = label.pictograms.slice(0, sz.per >= 4 ? 4 : 9);
    const ps = labelPStatements(label, shortP);
    // 그림문자 한 변: 표찰 넓이의 1/40 이상 · 최소 0.5㎠ (별표 3 제2호 나목)
    const picSize = { A4: 42, A5: 28, A6: 20, A7: 12 }[sz.key];
    const pad = { A4: 5, A5: 3.5, A6: 2.5, A7: 1.8 }[sz.key];
    const word = (x) => `<span class="st">${codes ? `<b>${esc(x.code)}</b> ` : ''}${esc(x.text)}</span>`;
    const one = `<div class="lbl" style="width:${sz.w}mm;height:${sz.h}mm;padding:${pad}mm">
        <div class="name">${esc(p.name || '(제품명)')}</div>
        <div class="mid"><div class="pics">${pics.map(c => pictogramSvg(c, `${picSize}mm`)).join('')}</div><div class="signal">${label.signal ? esc(SIGNALS[label.signal]) : ''}</div></div>
        <div class="blk"><b>유해·위험 문구:</b> ${label.h.length ? label.h.map(word).join(' ') : '해당 없음'}</div>
        <div class="blk"><b>예방조치 문구:</b> ${ps.list.length ? ps.list.map(word).join(' ') : '해당 없음'}${ps.cut ? ' <i>※ 그 밖의 예방조치 문구는 물질안전보건자료(MSDS)를 참고하시오.</i>' : ''}</div>
        <div class="blk sup"><b>공급자 정보:</b> ${esc([sup.company, sup.address, sup.phone].filter(Boolean).join(' · '))}</div>
    </div>`;
    // 글자 크기를 표지 칸에 꽉 차게 맞춘다 (넘치지 않는 가장 큰 크기) — 인쇄 창에서만 돈다
    const fitScript = `<script>window.onload = function () {
        document.querySelectorAll('.lbl').forEach(function (el) {
            var lo = 4, hi = 30;
            for (var i = 0; i < 14; i++) { var mid = (lo + hi) / 2; el.style.fontSize = mid + 'pt'; if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) hi = mid; else lo = mid; }
            el.style.fontSize = lo + 'pt';
        });
        ${autoPrint ? 'setTimeout(function () { window.print(); }, 400);' : ''}
    };</script>`;
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>경고표지 ${esc(p.name || '')}</title>
    <style>
        @page { size: A4 portrait; margin: 12mm; }
        ${BASE_CSS}
        .sheet { display: flex; flex-wrap: wrap; gap: 4mm; width: 186mm; }
        .lbl { border: 0.5mm solid #111; display: flex; flex-direction: column; gap: 0.5em; overflow: hidden; background: #fff; line-height: 1.35; font-size: 9pt; }
        .name { font-weight: 900; font-size: 1.7em; text-align: center; border-bottom: 0.3mm solid #111; padding-bottom: 0.2em; line-height: 1.2; }
        .mid { display: flex; align-items: center; justify-content: space-between; gap: 2mm; }
        .pics { line-height: 0; display: flex; flex-wrap: wrap; gap: 1.5mm; }
        .signal { font-weight: 900; font-size: 2.1em; padding: 0 0.5em; white-space: nowrap; }
        .blk { word-break: keep-all; overflow-wrap: anywhere; }
        .st::after { content: ' '; }
        .blk .st + .st::before { content: '· '; color: #555; }
        .sup { border-top: 0.3mm solid #111; padding-top: 0.3em; margin-top: auto; }
        @media screen { .page { width: 210mm; } }
    </style></head><body><div class="page"><div class="sheet">${Array.from({ length: sz.per }, () => one).join('')}</div></div>${fitScript}</body></html>`;
};

/**
 * 분류 근거 (사내 보관용 — 정확한 함유량이 들어가므로 대외비)
 * @param {{ confidentialCss?: string, confidentialMark?: string, autoPrint?: boolean }} [opt] 대외비 표시는 부르는 쪽(docMarks)이 넘긴다
 */
export const basisHtml = (doc, built, { confidentialCss = '', confidentialMark = '', autoPrint = true } = {}) => {
    const p = doc.product || {}, r = built.result;
    const fmt = (n) => String(Number(Number(n).toFixed(3)));
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>MSDS 분류 근거 ${esc(p.name || '')}</title>
    <style>
        @page { size: A4 portrait; margin: 12mm; }
        ${BASE_CSS}
        ${confidentialCss}
        h1 { font-size: 15pt; margin: 0 0 1mm; } h2 { font-size: 10.5pt; margin: 4mm 0 1.2mm; }
        th, td { border: 0.25mm solid #666; padding: 1mm 1.4mm; font-size: 8.3pt; vertical-align: top; word-break: keep-all; overflow-wrap: anywhere; }
        th { background: #eef1f5; } td.r { text-align: right; white-space: nowrap; } .sub { font-size: 8.5pt; color: #444; }
        ul { margin: 0; padding-left: 5mm; } li { margin-bottom: 0.6mm; }
    </style></head><body>${confidentialMark}<div class="page">
        <h1>혼합물 분류 근거 — ${esc(p.name || '')}</h1>
        <div class="sub">「화학물질의 분류·표시 및 물질안전보건자료에 관한 기준」(${esc(GHS_NOTICE)}) 별표 1의 혼합물 분류방법으로 계산 · 사내 보관용(MSDS에 붙이지 않음) · 출력 ${esc(new Date().toLocaleString('ko-KR'))}</div>
        <h2>1. 구성성분과 성분별 분류 (함유량 합 ${fmt(r.totalPct)}%)</h2>
        <table><colgroup><col style="width:42mm"><col style="width:22mm"><col style="width:16mm"><col><col style="width:18mm"></colgroup>
            <thead><tr><th>성분</th><th>CAS 번호</th><th>함유량(%)</th><th>성분의 분류</th><th>3항 표시</th></tr></thead>
            <tbody>${built.comps.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.cas || '-')}</td><td class="r">${fmt(c.pct)}</td>
                <td>${c.cls.length ? c.cls.map(e => esc(clsLabel(e))).join('<br>') : (c.unknown ? '<b>유해성 자료 없음(미상)</b>' : '분류되지 않음')}${c.nonAdditive ? '<br>※ 가산 방식 적용 불가 성분' : ''}</td>
                <td>${c.listed ? '적음' : c.reportable ? '<b>안 적음</b>' : '-'}</td></tr>`).join('')}</tbody></table>
        <h2>2. 혼합물의 분류와 근거</h2>
        ${r.classes.length ? `<table><colgroup><col style="width:62mm"><col></colgroup><thead><tr><th>분류</th><th>근거</th></tr></thead>
            <tbody>${r.classes.map(x => `<tr><td>${esc(clsLabel(x))}</td><td>${esc(x.basis)}</td></tr>`).join('')}</tbody></table>` : '<p>분류기준에 해당하지 않음</p>'}
        ${r.notes.length ? `<h2>3. 확인할 점</h2><ul>${r.notes.map(n => `<li>${esc(n.text)}</li>`).join('')}</ul>` : ''}
        ${built.warnings.length ? `<h2>4. 작성 시 경고</h2><ul>${built.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    </div>${autoPrint ? PRINT_SCRIPT : ''}</body></html>`;
};

/** 새 창에 문서를 띄운다 (팝업이 막혀 있으면 false) */
export const openDocWindow = (html) => {
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.write(html);
    w.document.close();
    return true;
};
