// ==========================================
// 거래 출하 전표 인쇄 양식 (위아래 2장)
// ==========================================
// 전표는 항상 두 장을 발행한다: 윗장 = 받는 곳 보관용(인수자용), 아랫장 = 보내는 곳 보관용(출고자용).
// 품목이 적으면(HALF_MAX_ITEMS 이하) A4 한 장을 절취선으로 나눠 위아래에 찍고, 많으면 A4 두 장에 한 부씩 찍는다.
// 결재 칸: 출고(담당·승인) / 인수(담당·확인) — 전자결재 서명과 서명 날짜가 들어간다(doc_key SLIP:<전표번호>).
import { esc } from '../services/html.js';
import { approvalPrintHtml } from './approval/ApprovalBox.js';
import { signDateText } from '../services/approvals.js';

export const SLIP_APPR_ROLES = ['출고 담당', '출고 승인', '인수 담당', '인수 확인'];
export const SLIP_OUT_ROLES = ['출고 담당', '출고 승인'];
export const SLIP_IN_ROLES = ['인수 담당', '인수 확인'];
export const slipApprKey = (docNo) => (docNo ? `SLIP:${docNo}` : '');
export const HALF_MAX_ITEMS = 10;

export const SLIP_COPIES = [
    { key: 'RECV', label: '받는 곳 보관용', sub: '인수자용', color: '#1d4ed8' },
    { key: 'SEND', label: '보내는 곳 보관용', sub: '출고자용', color: '#b45309' }
];

export const SLIP_CSS = `
.slipdoc { font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif; color: #111; font-size: 8.5pt; line-height: 1.3; }
.slipdoc * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.slipdoc .copy { position: relative; display: flex; flex-direction: column; gap: 2mm; }
.slipdoc.half .copy { height: 134mm; overflow: hidden; }
.slipdoc.full .copy { min-height: 270mm; }
.slipdoc .tag { display: inline-flex; align-items: center; gap: 1.5mm; font-weight: 800; font-size: 9pt; padding: 0.6mm 2.5mm; border: 0.4mm solid currentColor; border-radius: 1.5mm; width: fit-content; }
.slipdoc .tag small { font-weight: 600; font-size: 7.5pt; }
.slipdoc .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 3mm; border-bottom: 0.6mm solid #111; padding-bottom: 2mm; }
.slipdoc .head h1 { margin: 0; font-size: 15pt; letter-spacing: 1px; line-height: 1.15; }
.slipdoc .head .sub { font-size: 7.5pt; color: #555; }
.slipdoc .head .no { margin-top: 1mm; font-size: 8pt; }
.slipdoc .head .no b { font-family: Consolas, monospace; }
.slipdoc .logo { height: 8mm; margin-right: 2mm; vertical-align: middle; }
.slipdoc .right { display: flex; align-items: flex-start; gap: 1.5mm; }
.slipdoc .qr { width: 17mm; text-align: center; font-size: 6pt; color: #555; }
.slipdoc .qr .box { width: 17mm; height: 17mm; }
.slipdoc .qr .box svg { width: 100%; height: 100%; }
.slipdoc table.info, .slipdoc table.items { width: 100%; border-collapse: collapse; table-layout: fixed; }
.slipdoc table.info th, .slipdoc table.info td, .slipdoc table.items th, .slipdoc table.items td { border: 0.3mm solid #444; padding: 0.8mm 1.4mm; font-size: 8pt; word-break: break-all; vertical-align: middle; }
.slipdoc table.info th, .slipdoc table.items th { background: #eef1f5; font-weight: 700; text-align: center; }
.slipdoc table.items td { height: 5.4mm; }
.slipdoc table.items td.r { text-align: right; } .slipdoc table.items td.c { text-align: center; }
.slipdoc table.items td.code { font-family: Consolas, monospace; font-weight: 700; }
.slipdoc table.items td.qty { font-weight: 800; }
.slipdoc table.items tfoot td { background: #f6f7f9; font-weight: 800; }
.slipdoc .foot { display: flex; justify-content: space-between; align-items: center; gap: 3mm; font-size: 8pt; margin-top: auto; padding-top: 1.5mm; border-top: 0.3mm solid #bbb; }
.slipdoc .signer { display: inline-flex; align-items: center; gap: 1mm; font-weight: 700; }
.slipdoc .signer img { height: 7mm; }
.slipdoc .signer .blank { display: inline-block; width: 30mm; border-bottom: 0.3mm solid #111; height: 5mm; }
.slipdoc .cut { height: 9mm; display: flex; align-items: center; gap: 2mm; color: #777; font-size: 7pt; }
.slipdoc .cut::before, .slipdoc .cut::after { content: ''; flex: 1; border-top: 0.3mm dashed #999; }
.slipdoc.full .pagebreak { page-break-after: always; break-after: page; height: 0; }
`;

const signerHtml = (label, slot) => `<span class="signer">${esc(label)}:
    ${slot ? `<img src="${esc(slot.sig)}" alt="" /> ${esc(slot.name)} <span style="font-weight:400;color:#555">(${esc(signDateText(slot.at))})</span>` : '<span class="blank"></span> (인)'}</span>`;

/**
 * 전표 두 장 HTML
 * @param s     전표 { type, docNo, date, fromLoc, toLoc, partner, transport, reason, worker, items }
 * @param opts  { t: SLIP_TYPES[type], fromText, toText, placeWord, qrHtml, slots }
 */
export const slipDocHtml = (s, { t, fromText, toText, placeWord, qrHtml = '', slots = {} }) => {
    const items = (s.items || []).filter(it => it.code || it.name);
    const half = items.length <= HALF_MAX_ITEMS;
    const byUnit = new Map();
    items.forEach(it => byUnit.set(it.unit || 'EA', (byUnit.get(it.unit || 'EA') || 0) + (Number(it.qty) || 0)));
    const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
    const totalText = [...byUnit].map(([u, q]) => `${fmt(q)} ${u}`).join(' · ') || '0';
    const minRows = half ? Math.max(0, 8 - items.length) : Math.max(0, 30 - items.length);
    const apprOpts = { cellW: 15, cellH: 13, fontPt: 7.5, labelOf: (r) => r.split(' ')[1] };

    const copy = (c) => `
        <div class="copy">
            <div class="tag" style="color:${c.color}">■ ${esc(c.label)} <small>(${esc(c.sub)})</small></div>
            <div class="head">
                <div>
                    <h1><img class="logo" src="./logo.png" alt="" onerror="this.remove()" />${esc(t.title)}</h1>
                    <div class="sub">대림오일 · ${esc(t.subtitle)}</div>
                    <div class="no">전표번호 <b>${esc(s.docNo || '(발행 시 확정)')}</b> · 발행일자 ${esc(s.date || '')}</div>
                </div>
                <div class="right">
                    ${qrHtml ? `<div class="qr"><div class="box slip-qr">${qrHtml}</div>출하 검수 QR</div>` : ''}
                    ${approvalPrintHtml(SLIP_OUT_ROLES, slots, { title: '출고', ...apprOpts })}
                    ${approvalPrintHtml(SLIP_IN_ROLES, slots, { title: '인수', ...apprOpts })}
                </div>
            </div>
            <table class="info"><colgroup><col style="width:20mm"><col><col style="width:20mm"><col></colgroup><tbody>
                <tr><th>출발 ${esc(placeWord)}</th><td><b>${esc(fromText || '-')}</b></td><th>${t.byBuilding ? '도착 창고' : '받는 곳'}</th><td><b>${esc(toText || '-')}</b></td></tr>
                <tr><th>운송 방법</th><td>${esc(s.transport || '-')}</td><th>작업 담당</th><td>${esc(s.worker || '-')}</td></tr>
                <tr><th>사유 / 비고</th><td colspan="3">${esc(s.reason || '-')}</td></tr>
            </tbody></table>
            <table class="items"><colgroup><col style="width:8mm"><col style="width:24mm"><col><col style="width:30mm"><col style="width:13mm"><col style="width:22mm"><col style="width:28mm"></colgroup>
                <thead><tr><th>No</th><th>품목코드</th><th>품목명</th><th>규격 / 사양</th><th>단위</th><th>수량</th><th>비고</th></tr></thead>
                <tbody>
                    ${items.map((it, i) => `<tr><td class="c">${i + 1}</td><td class="code">${esc(it.code || '-')}</td><td><b>${esc(it.name)}</b></td><td>${esc(it.spec || '')}</td>
                        <td class="c">${esc(it.unit || 'EA')}</td><td class="r qty">${fmt(it.qty)}</td><td>${esc(it.note || '')}</td></tr>`).join('')}
                    ${Array.from({ length: minRows }, () => '<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('')}
                </tbody>
                <tfoot><tr><td colspan="5" class="r">합계 수량 (${items.length}품목)</td><td colspan="2" class="r">${esc(totalText)}</td></tr></tfoot>
            </table>
            <div class="foot">
                <span>상기 물품을 이상 없이 인도·인수하였음을 확인합니다.</span>
                <span style="display:flex;gap:5mm">${signerHtml('출고자', slots['출고 담당'])}${signerHtml('인수자', slots['인수 담당'])}</span>
            </div>
        </div>`;

    return `<div class="slipdoc ${half ? 'half' : 'full'}">
        ${copy(SLIP_COPIES[0])}
        ${half ? '<div class="cut">✂ 절취선 — 윗장: 받는 곳 보관 / 아랫장: 보내는 곳 보관</div>' : '<div class="pagebreak"></div>'}
        ${copy(SLIP_COPIES[1])}
    </div>`;
};

/** 새 창에 전표 두 장을 A4로 인쇄 (창은 클릭할 때 미리 연 것을 받아 팝업 차단을 피한다) */
export const writeSlipPrintWindow = (w, title, docHtml) => {
    const base = new URL(import.meta.env.BASE_URL, window.location.href).href;
    w.document.open();
    w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><base href="${esc(base)}"><title>${esc(title)}</title>
        <style>
            @page { size: A4 portrait; margin: 8mm 10mm; }
            body { margin: 0; background: #fff; }
            .sheet { width: 190mm; margin: 0 auto; }
            @media screen { body { background: #cbd5e1; padding: 6mm 0; } .sheet { background: #fff; padding: 8mm 10mm; width: 210mm; box-shadow: 0 1px 6px rgba(0,0,0,.25); } }
            ${SLIP_CSS}
        </style></head><body><div class="sheet">${docHtml}</div>
        <script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };<\/script></body></html>`);
    w.document.close();
};
