// ==========================================
// 원액생산요청서 → '원액 제조 요청서' 별도 인쇄 양식 (회사 기존 엑셀 양식과 같은 모양)
// ==========================================
// 칸: 문서번호 / 품명 · 요청수량/규격 / 요청일 · 제조 완료일 / 캠프 · 요청자 / 영업담당 · 수주업체 / 제조담당자 · 입고지 / 용도 / 기타
// 요청서 값: docNo, lines(name·qty·unit·spec·pack), reqDate, dueText(없으면 dueDate), site, requester, salesRep, partner,
//           assigneeName(제조담당자), destination(없으면 이동처 moveTo), purpose, reason(기타)
import { esc } from '../../services/html.js';
import { locationLabel } from '../../services/locations.js';

const fmtQty = (q) => { const n = Number(q); return Number.isFinite(n) && String(q).trim() !== '' ? n.toLocaleString('ko-KR', { maximumFractionDigits: 3 }) : String(q || ''); };
// 품명·수량 칸: 품목이 여러 개면 줄마다 한 줄씩
const lineName = (l) => l.name || l.code || '';
const lineQty = (l) => [`${fmtQty(l.qty)} ${l.unit || ''}`.trim(), l.spec, l.pack].filter(Boolean).join(' / ');
const br = (arr) => arr.filter(Boolean).map(esc).join('<br>');

/**
 * 원액 제조 요청서 HTML (A4 세로, 인쇄 창용)
 * @param {Object} r 원액생산요청서 (plans.js PROD_REQ, reqType RAW)
 */
export const rawMakeFormHtml = (r) => {
    const lines = (r.lines || []).filter(l => l.code || l.name);
    const due = r.dueText || r.dueDate || '';
    const dest = r.destination || (r.moveTo ? locationLabel(r.moveTo) : '');
    const row = (a, av, b, bv) => `<tr><th>${a}</th><td>${av}</td><th>${b}</th><td>${bv}</td></tr>`;
    return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>원액 제조 요청서 ${esc(r.docNo || '')}</title>
<style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif; color: #111; }
    .page { width: 186mm; margin: 0 auto; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 0.3mm solid #9aa4b1; font-size: 11pt; text-align: center; vertical-align: middle; padding: 1.5mm 2mm; word-break: keep-all; overflow-wrap: anywhere; }
    th { background: #dcebf7; font-weight: 700; font-size: 12pt; }
    .no { width: 106mm; margin-bottom: 0; }
    .no th, .no td { height: 8mm; font-size: 10pt; }
    .no td { font-weight: 700; text-align: left; padding-left: 8mm; }
    .title { background: #1f4e79; color: #fff; text-align: center; font-size: 20pt; font-weight: 700; letter-spacing: 1mm; height: 15mm; line-height: 15mm; border: 0.3mm solid #1f4e79; }
    .main { margin-top: 5mm; }
    .main th, .main td { height: 14.5mm; }
    .box { margin-top: 4mm; }
    .box th, .box td { height: 14.5mm; }
    .left { text-align: left; padding-left: 3mm; }
    .bar { position: fixed; top: 8px; right: 8px; }
    .bar button { padding: 6px 12px; border-radius: 8px; border: 0; background: #1f4e79; color: #fff; font-weight: 700; cursor: pointer; }
    @media print { .bar { display: none; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">인쇄 / PDF로 저장</button></div>
<div class="page">
    <table class="no"><colgroup><col style="width:38mm"><col></colgroup><tr><th>문서번호</th><td>NO. ${esc(r.docNo || '')}</td></tr></table>
    <div class="title">원액 제조 요청서</div>
    <table class="main"><colgroup><col style="width:34mm"><col><col style="width:40mm"><col></colgroup>
        ${row('품명', br(lines.map(lineName)), '요청수량/규격', br(lines.map(lineQty)))}
        ${row('요청일', esc(r.reqDate || r.period || ''), '제조 완료일', esc(due))}
        ${row('캠프', esc(r.site || ''), '요청자', esc(r.requester || ''))}
        ${row('영업담당', esc(r.salesRep || ''), '수주업체', esc(r.partner || ''))}
        ${row('제조담당자', esc(r.assigneeName || ''), '입고지', esc(dest))}
    </table>
    <table class="box"><colgroup><col style="width:34mm"><col></colgroup><tr><th>용도</th><td>${esc(r.purpose || '')}</td></tr></table>
    <table class="box"><colgroup><col style="width:34mm"><col></colgroup><tr><th>기타</th><td class="left" style="white-space:pre-line">${esc(r.reason || '')}</td></tr></table>
</div>
<script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };<\/script>
</body></html>`;
};

/** 새 창에 원액 제조 요청서를 띄워 인쇄 */
export const printRawMakeForm = (r) => {
    const w = window.open('', '_blank');
    if (!w) { alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
    w.document.write(rawMakeFormHtml(r));
    w.document.close();
};
