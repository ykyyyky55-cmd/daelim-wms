import { SLIP_TYPES } from '../services/db.js';
import { SCAN_SLIP_TYPES, scanPhotoUrl } from '../services/scanSlips.js';
import { getApprovals } from '../services/approvals.js';
import { qrSvg } from '../services/qrCode.js';
import { fieldQrUrl } from '../services/fieldQr.js';
import { locationLabel } from '../services/locations.js';
import { esc } from '../services/html.js';
import { slipDocHtml, writeSlipPrintWindow, slipApprKey } from './slipDoc.js';

// ==========================================
// 전표관리 인쇄
//   발행 전표: 전표발행과 같은 양식(위아래 두 장, 출하 검수 QR, 출고·인수 결재 서명)
//   스캔 등록: 전표 등록 확인서 A4 한 장(등록 내용 + 재고 반영 + 전표 사진)
//   여러 장은 한 창에 쪽을 나눠 한 번에 인쇄한다. 목록 인쇄는 A4 가로 표.
// ==========================================

const EXTERNAL = '외부 거래처';
const locText = (loc) => (loc && loc !== EXTERNAL ? locationLabel(loc) : loc || '');
const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const ACTION_TEXT = { IN: '재고 늘림 (+)', OUT: '재고 줄임 (−)', USE: '재고 줄임 (사용)', MOVE: '창고 이동' };

/** 인쇄 창은 버튼을 누른 순간 열어야 팝업 차단을 피한다 */
export const openPrintWindow = () => {
    const w = window.open('', '_blank');
    if (!w) alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.');
    else w.document.write('<p style="font-family:sans-serif;padding:20px">인쇄할 전표를 준비하는 중...</p>');
    return w;
};

const issuedHtml = (s, qr, slots) => {
    const t = SLIP_TYPES[s.type] || SLIP_TYPES.TRANSFER;
    const toText = s.toLoc === EXTERNAL || !s.toLoc ? (s.partner || EXTERNAL) : (s.partner ? `${locText(s.toLoc)} (${s.partner})` : locText(s.toLoc));
    return slipDocHtml(s, { t, fromText: locText(s.fromLoc), toText, placeWord: t.byBuilding ? '창고' : '거점', qrHtml: qr, slots });
};

const SCAN_CSS = `
.scandoc { font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif; color: #111; font-size: 9pt; }
.scandoc h1 { font-size: 17pt; text-align: center; margin: 0 0 1mm; letter-spacing: 3px; }
.scandoc .sub { text-align: center; color: #555; font-size: 8pt; margin-bottom: 4mm; }
.scandoc table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
.scandoc th, .scandoc td { border: 1px solid #555; padding: 1.6mm 2mm; }
.scandoc th { background: #eef2f7; font-weight: bold; white-space: nowrap; }
.scandoc .items th { text-align: center; }
.scandoc .r { text-align: right; } .scandoc .c { text-align: center; }
.scandoc .photo { text-align: center; border: 1px solid #999; padding: 2mm; }
.scandoc .photo img { max-width: 100%; max-height: 150mm; object-fit: contain; }
.scandoc .note { color: #555; font-size: 7.5pt; }
.pbreak { page-break-after: always; break-after: page; height: 0; }
`;

const scanHtml = (r, photo) => {
    const t = SCAN_SLIP_TYPES[r.kind] || { word: r.kind };
    const route = r.action === 'MOVE' ? `${locText(r.fromLoc)} → ${locText(r.toLoc)}` : locText(r.action === 'IN' ? r.toLoc : r.fromLoc);
    return `<div class="scandoc">
        <h1>전표 등록 확인서 (${esc(t.word)})</h1>
        <div class="sub">대림오일 WMS · 전표 스캔 등록 · 재고 반영 기록</div>
        <table><colgroup><col style="width:24mm"><col><col style="width:24mm"><col></colgroup><tbody>
            <tr><th>등록번호</th><td><b>${esc(r.regNo)}</b></td><th>전표 일자</th><td>${esc(r.date)}</td></tr>
            <tr><th>전표 종류</th><td>${esc(t.word)}</td><th>재고 처리</th><td>${esc(ACTION_TEXT[r.action] || '')}</td></tr>
            <tr><th>거래처</th><td>${esc(r.partner || '-')}</td><th>원본 전표번호</th><td>${esc(r.docNo || '-')}</td></tr>
            <tr><th>${r.action === 'MOVE' ? '출발 → 도착' : '창고'}</th><td>${esc(route || '-')}</td><th>작업자</th><td>${esc(r.worker || '-')}</td></tr>
            <tr><th>기록</th><td colspan="3">${esc(r.by || '')} ${r.createdAt ? esc(new Date(r.createdAt).toLocaleString('ko-KR')) : ''}</td></tr>
        </tbody></table>
        <table class="items"><colgroup><col style="width:8mm"><col style="width:24mm"><col><col style="width:28mm"><col style="width:20mm"><col style="width:12mm"><col style="width:32mm"></colgroup>
            <thead><tr><th>No</th><th>품목코드</th><th>품목명</th><th>규격</th><th>수량</th><th>단위</th><th>재고 반영</th></tr></thead>
            <tbody>${r.items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${esc(it.code)}</td><td><b>${esc(it.name)}</b></td><td>${esc(it.spec || '')}</td>
                <td class="r"><b>${fmt(it.qty)}</b></td><td class="c">${esc(it.unit)}</td>
                <td class="r">${it.baseUnit && it.unit !== it.baseUnit ? `${fmt(it.baseQty)} ${esc(it.baseUnit)}${it.sg ? ` (비중 ${esc(it.sg)})` : ''}` : `${fmt(it.baseQty ?? it.qty)} ${esc(it.baseUnit || it.unit)}`}</td></tr>`).join('')}</tbody>
        </table>
        ${photo ? `<div class="photo"><img src="${esc(photo)}" alt="전표 사진" /></div>` : '<div class="note">전표 사진 없음</div>'}
    </div>`;
};

/**
 * 전표 여러 장을 한 창에 인쇄. entries: 전표관리 목록 줄({ src, raw })
 * @param w 미리 연 창 (openPrintWindow)
 */
export const printSlipEntries = async (w, entries) => {
    if (!w || !entries.length) return;
    const issued = entries.filter(e => e.src === 'ISSUE').map(e => e.raw);
    const [slotsMap, qrs, photos] = await Promise.all([
        getApprovals(issued.map(s => slipApprKey(s.docNo))).catch(() => new Map()),
        Promise.all(issued.map(s => qrSvg(fieldQrUrl('SLIP', s.docNo), { ecc: 'M' }).then(v => v.replace('<svg ', '<svg width="100%" height="100%" ')).catch(() => esc(s.docNo)))),
        Promise.all(entries.map(e => (e.src === 'SCAN' ? scanPhotoUrl(e.raw).catch(() => '') : ''))
        )
    ]);
    const qrOf = new Map(issued.map((s, i) => [s.docNo, qrs[i]]));
    const pages = entries.map((e, i) => (e.src === 'ISSUE'
        ? issuedHtml(e.raw, qrOf.get(e.raw.docNo), slotsMap.get?.(slipApprKey(e.raw.docNo)) || {})
        : scanHtml(e.raw, photos[i])));
    const title = entries.length === 1 ? `전표 ${entries[0].no}` : `전표 ${entries.length}건`;
    writeSlipPrintWindow(w, title, `<style>${SCAN_CSS}</style>${pages.join('<div class="pbreak"></div>')}`);
};

/** 보이는 목록을 A4 가로 표로 인쇄 */
export const printSlipList = (w, list, { title = '전표 목록', period = '' } = {}) => {
    if (!w) return;
    const statusText = (e) => (e.status === 'DONE' ? '출고 완료' : e.status === 'WAIT' ? '출고 대기' : '재고 반영됨');
    const rows = list.map((e, i) => `<tr>
        <td class="c">${i + 1}</td><td>${esc(e.no)}${e.refNo ? `<br><small>원본 ${esc(e.refNo)}</small>` : ''}</td><td class="c">${esc(e.date)}</td>
        <td>${e.src === 'SCAN' ? '스캔' : '발행'} · ${esc(e.typeLabel)}</td><td>${esc(e.from || '-')} → ${esc(e.to || '-')}</td>
        <td>${e.items.slice(0, 3).map(it => `${esc(it.name || it.code)} ${fmt(it.qty)}${esc(it.unit)}`).join('<br>')}${e.items.length > 3 ? `<br><small>외 ${e.items.length - 3}품목</small>` : ''}</td>
        <td>${esc(e.worker || '')}${e.assignee ? `<br><small>담당 ${esc(e.assignee)}</small>` : ''}</td><td class="c">${statusText(e)}</td></tr>`).join('');
    w.document.open();
    w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
        @page { size: A4 landscape; margin: 10mm; }
        body { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 8.5pt; color: #111; margin: 0; }
        h1 { font-size: 15pt; margin: 0 0 1mm; } .meta { color: #555; margin-bottom: 3mm; }
        table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #666; padding: 1.2mm 1.6mm; vertical-align: top; }
        th { background: #eef2f7; } thead { display: table-header-group; } tr { page-break-inside: avoid; }
        .c { text-align: center; } small { color: #555; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    </style></head><body>
        <h1>${esc(title)}</h1>
        <div class="meta">${esc(period)} · ${list.length}건 · 출력 ${esc(new Date().toLocaleString('ko-KR'))}</div>
        <table><thead><tr><th style="width:8mm">No</th><th style="width:36mm">번호</th><th style="width:20mm">일자</th><th style="width:34mm">구분·종류</th><th>출발 → 도착</th><th>품목</th><th style="width:28mm">작성·담당</th><th style="width:20mm">상태</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <script>window.onload = function () { setTimeout(function () { window.print(); }, 300); };<\/script>
    </body></html>`);
    w.document.close();
};
