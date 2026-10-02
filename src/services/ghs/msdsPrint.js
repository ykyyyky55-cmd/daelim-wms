// ==========================================
// 혼합물 MSDS · 경고표지 인쇄 문서 (A4)
// ==========================================
// · msdsHtml: 고시 별표 4의 16개 항목 순서 그대로. 회사에서 쓰던 MSDS 양식을 따른다 —
//     쪽마다 머리글(제품명 · 물질안전보건자료 · 고시 번호)과 바닥글(최종 개정일자 · 언어 · 쪽/전체 쪽),
//     항목 = 진한 파란 띠, 가·나·다 = 옅은 파란 띠, '항목 : 내용' 줄, 파란 테두리 표.
//     MSDS 번호와 작성·개정일자·버전은 첫 쪽 머리글 아래(개별 항목 밖)에 적는다 (별표 4 머리의 ※).
// · labelHtml: 별표 3의 경고표지 양식 (명칭 · 그림문자 · 신호어 · 유해·위험 문구 · 예방조치 문구 · 공급자 정보)
// · basisHtml: 분류 근거(정확한 함유량 포함) — 사내 보관용이라 대외비 표시를 넣는다. MSDS 본문에는 넣지 않는다.
// 그림문자·보호구 기호는 인라인 SVG라 저장한 파일(첨부)에서도 그대로 보인다.
import { esc } from '../html.js';
import { MSDS_SECTIONS, SIGNALS, GHS_NOTICE, NO_DATA, NOT_APPLICABLE, clsLabel, catOf } from './ghsTables.js';
import { INFO_PART_LABELS, MSDS_DISCLAIMER, STATE_LABELS, versionText } from './msdsBuild.js';
import { pictogramSvg } from './pictograms.js';
import { ppeIconSvg } from './ppeIcons.js';

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

// ---------- 물질안전보건자료 ----------
const MSDS_FONT = "'Segoe UI', 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
const MSDS_LANG = 'KO (한국어)';
const BAR = '#2E74B5', BAR_SOFT = '#9DC3E6', BAR_PALE = '#BDD7EE', INK_BLUE = '#0070C0';

/** 인쇄할 때의 항목 이름: 별표 4의 이름에서 '무엇을 적는지' 알려 주는 괄호 설명을 뺀 것 (없으면 별표 4 이름 그대로) */
const PRINT_LABELS = {
    's2.other': '다. 유해성·위험성 분류기준에 포함되지 않는 기타 유해성·위험성', 's5.hazard': '나. 화학물질로부터 생기는 특정 유해성', 's7.store': '나. 안전한 저장 방법',
    's9.appearance': '가. 외관', 's10.avoid': '나. 피해야 할 조건', 's11.acute': '급성 독성', 's13.caution': '나. 폐기시 주의사항',
    's14.un': '가. 유엔 번호(UN No.)', 's14.pg': '라. 용기등급', 's14.marine': '마. 해양오염물질'
};
const labelOf = (it) => PRINT_LABELS[it.key] || it.label;
/** '항목: 내용' 줄로 나누지 않는 칸 — 예방조치 문구처럼 문장 안에 ':'가 들어가는 칸 */
const PLAIN_KEYS = new Set(['s1.name', 's1.use', 's2.cls', 's2.signal', 's2.h', 's2.pPrev', 's2.pResp', 's2.pStor', 's2.pDisp', 's2.other', 's4.eye', 's4.skin', 's4.inh', 's4.oral', 's7.handle', 's7.store', 's16.source']);

const ROW_RE = /^([^:：]{1,30}?)\s*[:：]\s+(\S.*)$/; // 항목: 내용
const CLAUSE_RE = /(면|시|경우|때)$/; // '…하면:' '화재 시:' 같은 조건절은 항목 이름이 아니다
const HEAD_RE = /^[○◯]\s*(.+)$/; // 작은 제목
const DATA_RE = /^[·•]\s*(.+?)\s*[:：]\s+(\S.*)$/; // 성분(제품) 자료: · 이름: 값 ; 값
const INDENT_RE = /^(\s{2,}|\t)/; // 앞줄에 이어지는 줄
const STATUS_RE = /^(해당\s?없음|해당\s?됨|비해당|해당|자료\s?없음)(?=$|[\s—–(,.-])\s*(?:[—–-]\s*)?(.*)$/; // 15항의 해당 여부
const PART_NAMES = `(?:${INFO_PART_LABELS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}|ATEmix \\S+)`;
const PART_RE = new RegExp(`^(${PART_NAMES}) (.+)$`);
const PART_SPLIT_RE = new RegExp(` ; (?=${PART_NAMES} )`);

/**
 * '항목 : 내용' 한 줄 (내용이 여러 줄이면 내용 칸 안에서 줄을 바꾼다, 내용이 없으면 항목 이름만)
 * @param {{ indent?: boolean, marker?: boolean }} [opt] indent = 한 단계 들여 쓴 줄, marker = 이름 앞의 '가.'를 같은 폭으로 맞춘다(9항)
 */
const rowHtml = (label, values = [], { indent = false, marker = false } = {}) => {
    const mk = marker ? /^(\S{1,2}\.)\s*(.*)$/.exec(label) : null;
    const name = mk ? `<span class="mk">${esc(mk[1])}</span>${esc(mk[2])}` : esc(label);
    return `<div class="row${indent ? ' in' : ''}"><div class="k">${name}</div>${values.length ? `<div class="c">:</div><div class="v">${values.map(v => `<div>${esc(v)}</div>`).join('')}</div>` : ''}</div>`;
};

/** 성분(제품) 자료 상자: 머리 = 이름, 줄 = 자료 이름 | 값 (값 안의 ' / '는 공단 자료의 줄 구분이라 줄을 바꾼다) */
const dataBoxHtml = (name, body) => {
    const cell = (v) => v.split(' / ').map(s => esc(s.trim())).filter(Boolean).join('<br>');
    return `<table class="t box"><colgroup><col style="width:37.93%"><col></colgroup><thead><tr><th colspan="2">${esc(name)}</th></tr></thead><tbody>${
        body.split(PART_SPLIT_RE).map(s => s.trim()).filter(Boolean).map(part => {
            const m = PART_RE.exec(part);
            return m ? `<tr><td>${esc(m[1])}</td><td>${cell(m[2])}</td></tr>` : `<tr><td colspan="2">${cell(part)}</td></tr>`;
        }).join('')}</tbody></table>`;
};

/**
 * 본문 글 → 인쇄 모양. 줄마다: '○ 제목' = 작은 제목, '· 이름: 자료' = 자료 상자, '항목: 내용' = 나란한 줄(rows일 때), 두 칸 들여 쓴 줄 = 앞 줄의 내용에 이어짐, 그 밖 = 문장
 * @param {string} text
 * @param {{ rows?: boolean }} [opt]
 */
const textBlocks = (text, { rows = true } = {}) => {
    const out = [];
    let open = null; // 이어 붙일 수 있는 '항목: 내용' 줄
    const flush = () => { if (open) { out.push(rowHtml(open.label, open.values)); open = null; } };
    String(text ?? '').split('\n').forEach(raw => {
        const t = raw.trim();
        if (!t) { flush(); return; }
        if (open && INDENT_RE.test(raw)) { open.values.push(t); return; }
        flush();
        const head = HEAD_RE.exec(t);
        if (head) { out.push(`<div class="sl">○ ${esc(head[1])}</div>`); return; }
        const data = DATA_RE.exec(t);
        if (data) { out.push(dataBoxHtml(data[1], data[2])); return; }
        const m = rows ? ROW_RE.exec(t) : null;
        if (m && !CLAUSE_RE.test(m[1].trim())) { open = { label: m[1].trim(), values: [m[2]] }; return; }
        out.push(`<div class="p">${esc(t)}</div>`);
    });
    flush();
    return out.join('');
};

/** 15항: '항목: 해당됨 — 내용' 줄 → 항목 | 해당 여부 | 내용 세 칸 (두 칸 들여 쓴 줄은 내용에 이어짐) */
const regBlocks = (text) => {
    const out = [];
    let open = null;
    const flush = () => {
        if (!open) return;
        const details = open.details.map(d => `<div>${esc(d)}</div>`).join('');
        out.push(open.status ? `<div class="reg"><div class="k">${esc(open.label)}</div><div class="s">${esc(open.status)}</div><div class="d">${details}</div></div>`
            : `<div class="reg"><div class="k">${esc(open.label)}</div><div class="w">${details}</div></div>`);
        open = null;
    };
    String(text ?? '').split('\n').forEach(raw => {
        const t = raw.trim();
        if (!t) { flush(); return; }
        if (open && INDENT_RE.test(raw)) { open.details.push(t); return; }
        flush();
        const head = HEAD_RE.exec(t);
        if (head) { out.push(`<div class="sl">${esc(head[1])}</div>`); return; }
        const m = ROW_RE.exec(t);
        if (!m) { out.push(`<div class="p">${esc(t)}</div>`); return; }
        const st = STATUS_RE.exec(m[2]);
        open = st ? { label: m[1].trim(), status: st[1], details: st[2] ? [st[2]] : [] } : { label: m[1].trim(), status: '', details: [m[2]] };
    });
    flush();
    return out.join('');
};

/** 3항 구성성분 표 */
const casCellHtml = (r) => (r.secret || !/\d/.test(r.cas) ? esc(r.cas) : `CAS 번호: ${esc(r.cas)}${r.keNo ? `<br>기존화학물질 번호: ${esc(r.keNo)}` : ''}`);
const s3Html = (built) => `
    ${built.s3.length ? `<table class="t comp"><colgroup><col style="width:27.3%"><col style="width:27.3%"><col style="width:28.4%"><col></colgroup>
        <thead><tr><th>화학물질명</th><th>관용명 및 이명(異名)</th><th>CAS 번호 또는 식별번호</th><th>함유량 (%)</th></tr></thead>
        <tbody>${built.s3.map(r => `<tr><td>${esc(r.name)}${r.secret ? ' *' : ''}</td><td>${esc(r.alias || (r.secret ? '-' : NO_DATA))}</td><td>${casCellHtml(r)}</td><td>${esc(r.content)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${built.s3Note ? `<div class="p">${multiline(built.s3Note)}</div>` : ''}`;

// 크기·간격은 회사 양식(A4, 본문 8pt · 줄 간격 16.6pt)을 잰 값이다 — 단위 pt
const MSDS_CSS = `
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; }
    body { font-family: ${MSDS_FONT}; color: #000; font-size: 8pt; line-height: 16.6pt; word-break: keep-all; overflow-wrap: anywhere; }
    table.doc { width: 100%; border-collapse: collapse; table-layout: fixed; }
    table.doc > thead > tr > td, table.doc > tbody > tr > td { padding: 0; vertical-align: top; }
    .hd { padding-bottom: 2.9pt; border-bottom: 0.6pt solid #000; margin-bottom: 6.9pt; }
    .hd-name { font-size: 16pt; font-weight: 700; line-height: 26.7pt; }
    .hd-title { font-size: 12pt; line-height: 18pt; margin-top: 4.8pt; }
    .hd-note, .hd1 { font-size: 7pt; line-height: 12.1pt; }
    .hd-note { margin-top: 4pt; }
    /* 첫 쪽: 머리글의 밑줄을 덮고 MSDS 번호·일자 줄을 이어 적은 뒤 밑줄을 다시 긋는다 (margin-top = 머리글의 아래 여백 + 밑줄 + 아래 바깥 여백) */
    .hd1 { position: relative; z-index: 1; background: #fff; margin-top: -10.4pt; padding-bottom: 2.9pt; border-bottom: 0.6pt solid #000; margin-bottom: 6.9pt; }
    .hd1 span { margin-right: 8pt; white-space: nowrap; }
    .sec { margin-top: 19.7pt; }
    .hd1 + .sec { margin-top: 22.3pt; }
    .sec-h { background: ${BAR}; color: #fff; font-weight: 700; font-size: 10pt; line-height: 15pt; padding: 4.2pt 1.4pt; break-after: avoid; break-inside: avoid; }
    .sec-h + * { margin-top: 5pt; }
    .sub-h { background: ${BAR_SOFT}; color: ${INK_BLUE}; font-weight: 700; font-size: 9pt; line-height: 14pt; padding: 2.55pt 1.4pt; margin: 7.7pt 0 5.1pt; break-after: avoid; break-inside: avoid; }
    .sec-h + .sub-h { margin-top: 6.8pt; }
    .sl { color: ${INK_BLUE}; font-weight: 700; margin: 6pt 0 3pt; break-after: avoid; }
    .sub-h + .sl { margin-top: 0; }
    .row { display: grid; grid-template-columns: 36.37% 1.55% minmax(0, 1fr); break-inside: avoid; }
    .row .k { padding-right: 6pt; }
    .row.in .k { padding-left: 14.2pt; }
    .mk { display: inline-block; min-width: 14.2pt; }
    .cl { display: grid; grid-template-columns: 67.7% minmax(0, 1fr); break-inside: avoid; }
    .reg { display: grid; grid-template-columns: 37.93% 16.23% minmax(0, 1fr); break-inside: avoid; }
    .reg .k { padding-right: 6pt; }
    .reg .w { grid-column: 2 / 4; }
    .pics, .ppe { display: flex; flex-wrap: wrap; margin-top: 4.9pt; line-height: 0; break-inside: avoid; }
    .pics { gap: 4pt; }
    .ppe { gap: 3.8pt; }
    table.t { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 12.6pt 0 0; }
    table.t th, table.t td { border: 0.5pt solid ${BAR}; padding: 2.1pt 2.6pt 4.5pt; vertical-align: top; text-align: left; font-weight: 400; }
    table.t th { background: ${BAR_PALE}; color: ${INK_BLUE}; font-weight: 700; font-size: 9pt; padding-bottom: 5.2pt; }
    table.t tr { break-inside: avoid; }
    table.t + table.t { margin-top: 6pt; }
    table.t + .p, table.t + .row { margin-top: 5pt; }
    .sub-h + table.t { margin-top: 0; }
    table.tr { margin-top: 2pt; }
    table.tr th { color: #000; text-align: center; }
    table.tr tr.tl td { color: ${INK_BLUE}; font-weight: 700; font-size: 9pt; padding-bottom: 5.2pt; }
    table.tr tr.tl { break-after: avoid; }
    table.tr tr.tc td { text-align: center; }
    .note { color: #7f7f7f; margin-top: 6pt; }
    .foot { display: none; }
    @media screen {
        body { background: #cbd5e1; padding: 8mm 0; }
        .page { width: 210mm; margin: 0 auto; background: #fff; padding: 12.7mm; box-shadow: 0 1px 6px rgba(0,0,0,.25); }
        .foot { display: flex; justify-content: space-between; gap: 4mm; border-top: 0.6pt solid #000; margin-top: 10mm; padding-top: 2.4pt; font-size: 7pt; line-height: 12.1pt; }
    }`;

/**
 * 물질안전보건자료 문서
 * @param {Object} doc 문서
 * @param {ReturnType<import('./msdsBuild.js').buildMsds>} built
 * @param {{ autoPrint?: boolean }} [opt]
 */
export const msdsHtml = (doc, built, { autoPrint = true } = {}) => {
    const p = doc.product || {}, sup = doc.supplier || {}, rev = doc.rev || {}, props = doc.props || {};
    const T = built.text;
    const isEdited = (key) => built.edited.includes(key);
    const text = (key) => textBlocks(T[key], { rows: !PLAIN_KEYS.has(key) });
    const bar = (label) => `<div class="sub-h">${esc(label)}</div>`;
    const item = (it) => `${bar(labelOf(it))}${text(it.key)}`;
    const row = (label, value, opt) => rowHtml(label, String(value ?? '').split('\n').map(s => s.trim()).filter(Boolean), opt);
    const hasClass = (c, ks) => built.result.classes.some(x => x.c === c && (!ks || ks.includes(x.k)));
    const isBlank = (key) => /^(해당\s?없음|자료\s?없음)?\.?$/.test(String(T[key] || '').trim());

    // 항목별 본문 (여기에 없는 항목은 가·나·다 띠 + 글)
    const bodies = {
        1: (sec) => `${bar('가. 제품명')}${row('제품 형태', '혼합물')}${row('상품명', T['s1.name'])}${String(p.itemCode || '').trim() ? row('제품 코드', p.itemCode) : ''}
            ${item(sec.items[1])}
            ${bar(sec.items[2].label)}<div class="p">- 공급업체</div>${row('○ 회사명', T['s1.company'])}${row('○ 주소', T['s1.address'])}${row('○ 긴급전화번호', T['s1.phone'])}${String(sup.fax || '').trim() ? row('○ 팩스', sup.fax) : ''}`,
        2: (sec) => {
            const classes = built.result.classes, pics = built.label.pictograms;
            // 분류 줄: 분류 이름, 구분 | 유해·위험 문구 코드 (글을 직접 고쳤으면 고친 글 그대로)
            const cls = isEdited('s2.cls') || !classes.length ? text('s2.cls')
                : classes.map(x => `<div class="cl"><div>${esc(clsLabel(x).replace(' : ', ', '))}</div><div>${esc((catOf(x.c, x.k)?.h || []).join(', '))}</div></div>`).join('');
            return `${bar(sec.items[0].label)}${cls}
                ${bar(sec.items[1].label)}
                <div class="sl">○ 그림문자 (GHS KR)</div>${pics.length ? `<div class="pics">${pics.map(c => pictogramSvg(c, '39.5pt')).join('')}</div>` : `<div class="p">${NOT_APPLICABLE}</div>`}
                <div class="sl">○ 신호어 (GHS KR)</div>${text('s2.signal')}
                <div class="sl">○ 유해·위험 문구 (GHS KR)</div>${text('s2.h')}
                <div class="sl">○ 예방조치 문구 (GHS KR)</div>
                ${[['예방', 's2.pPrev'], ['대응', 's2.pResp'], ['저장', 's2.pStor'], ['폐기', 's2.pDisp']].map(([name, key]) => `<div class="sl">${name}:</div>${text(key)}`).join('')}
                ${item(sec.items[2])}`;
        },
        3: () => `${row('제품 형태', '혼합물')}${s3Html(built)}`,
        8: (sec) => sec.items.map(it => {
            if (!it.sub) return item(it);
            const icons = [!isBlank('s8.hand') && 'GLOVES', !isBlank('s8.eye') && 'GOGGLES', !isBlank('s8.body') && 'CLOTHING',
                !isBlank('s8.resp') && (hasClass('ACUTE_INH') || hasClass('RESP_SENS') || hasClass('STOT_SE', ['3R', '3N'])) && 'RESPIRATOR'].filter(Boolean);
            return `${bar(it.label)}${it.sub.map(x => `<div class="sl">${esc(x.label)}</div>${text(x.key)}`).join('')}
                ${icons.length ? `<div class="sl">보호구 기호:</div><div class="ppe">${icons.map(c => ppeIconSvg(c, '48.9pt')).join('')}</div>` : ''}`;
        }).join(''),
        // 9항은 띠 없이 '가. 외관 : …' 줄로 (외관은 물리적 상태·색상 두 줄로 나눠 적는다)
        9: (sec) => sec.items.map(it => (it.key === 's9.appearance' && !isEdited(it.key)
            ? `${rowHtml(labelOf(it), [], { marker: true })}${row('물리적 상태', STATE_LABELS[props.state || 'LIQUID'] || NO_DATA, { indent: true })}${row('색상', String(props.color || '').trim() || NO_DATA, { indent: true })}`
            : row(labelOf(it), T[it.key], { marker: true }))).join(''),
        11: (sec) => sec.items.map(it => (it.sub ? `${bar(it.label)}${it.sub.map(x => `<div class="sl">${esc(labelOf(x))}:</div>${text(x.key)}`).join('')}` : item(it))).join(''),
        // 14항: 운송 규정(UN RTDG · IMDG · IATA) 세 칸 표 + 바.
        14: (sec) => `<div class="p">UN RTDG / IMDG / IATA 에 따름</div>
            <table class="t tr"><thead><tr><th>UN RTDG</th><th>IMDG</th><th>IATA</th></tr></thead><tbody>${
    sec.items.filter(it => it.key !== 's14.special').map(it => `<tr class="tl"><td colspan="3">${esc(labelOf(it))}</td></tr><tr class="tc">${`<td>${multiline(T[it.key])}</td>`.repeat(3)}</tr>`).join('')}</tbody></table>
            ${item(sec.items.find(it => it.key === 's14.special'))}`,
        15: (sec) => sec.items.map(it => `${bar(it.label)}${regBlocks(T[it.key])}`).join(''),
        16: (sec) => `${sec.items.map(item).join('')}<div class="p note">${esc(MSDS_DISCLAIMER)}</div>`
    };
    const sectionHtml = (sec) => `<section class="sec"><div class="sec-h">${sec.no}. ${esc(sec.title)}</div>${bodies[sec.no] ? bodies[sec.no](sec) : sec.items.map(item).join('')}</section>`;

    const revDate = rev.revDate || rev.firstDate || '';
    const footLeft = revDate ? `${revDate} (최종 개정일자)` : '';
    const dates = [['최초 작성일자', rev.firstDate], ['최종 개정일자', revDate], ['이전 개정일자', rev.prevDate], ['버전', versionText(rev)]].filter(([, v]) => String(v || '').trim());
    // 바닥글: 쪽 아래 여백(21mm) 안에 밑줄 + 한 줄 (왼쪽·가운데·오른쪽 칸이 이어져 밑줄이 한 줄로 보인다)
    const footCss = `font-family: ${MSDS_FONT}; font-size: 7pt; line-height: 12.1pt; color: #000; vertical-align: top; margin-top: 7.7pt; border-top: 0.6pt solid #000; padding-top: 2.4pt;`;
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>MSDS ${esc(p.name || '')}</title>
    <style>
        @page {
            size: A4 portrait; margin: 12.7mm 12.7mm 21mm;
            @top-left { content: " "; } @top-center { content: " "; } @top-right { content: " "; }
            @bottom-left { content: "${cssStr(footLeft)}"; text-align: left; ${footCss} }
            @bottom-center { content: "${MSDS_LANG}"; text-align: center; ${footCss} }
            @bottom-right { content: counter(page) "/" counter(pages); text-align: right; ${footCss} }
        }
        ${MSDS_CSS}
    </style></head><body><div class="page">
        <table class="doc">
            <thead><tr><td><div class="hd"><div class="hd-name">${esc(p.name || '(제품명)')}</div><div class="hd-title">물질안전보건자료</div><div class="hd-note">${esc(GHS_NOTICE)}에 따름</div></div></td></tr></thead>
            <tbody><tr><td>
                <div class="hd1"><div>MSDS 번호: ${esc(p.msdsNo || '')}</div><div>${dates.map(([k, v]) => `<span>${k}: ${esc(v)}</span>`).join(' ')}</div></div>
                ${MSDS_SECTIONS.map(sectionHtml).join('')}
            </td></tr></tbody>
        </table>
        <div class="foot"><span>${esc(footLeft)}</span><span>${MSDS_LANG}</span><span></span></div>
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
