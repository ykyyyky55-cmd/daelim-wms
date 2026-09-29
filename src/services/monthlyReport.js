// ==========================================
// 종합현황 월간 보고서 (보고서 메뉴 kind 'OVERVIEW', 종합현황판 [📄 월간 보고서])
// ==========================================
// 한 달의 종합현황(생산 실적·원료 입고·주문·출하·품질·재고·확인할 일)을 A4 보고서 본문(HTML)으로 만들어 wms_reports에 저장한다.
// · id 'OVERVIEW-<YYYY-MM>' 로 달마다 하나 (다시 만들면 덮어씀). 보고서 메뉴에서 열람·인쇄(PDF)·결재.
// · 자동 보관: 매니저 이상이 앱을 연 기기에서, 새 달이 되면 지난달 보고서가 없을 때 한 번 만든다 (서버 예약 없음 — runMonthlyReportAuto).
// · 월 실적은 그 달 기준, 재고·미결·확인할 일은 작성 시점 기준이다 (본문에 표시).
import { state } from './db.js';
import { canPerformAction } from './auth.js';
import { localDateStr } from './searchUtils.js';
import { esc } from './html.js';
import { listReports, saveReport } from './reports.js';
import { loadDigestData, buildAlerts } from './digest.js';
import { computeQcSummary, ymAdd } from './qcBoardData.js';
import { fmtRate } from './quality.js';
import { QC_AREAS } from './quality.js';

export const reportIdOf = (ym) => `OVERVIEW-${ym}`;
const fmt = (n, d = 0) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: d });
const sum = (rows, k) => (rows || []).reduce((s, r) => s + (Number(r[k]) || 0), 0);
const ymLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
const pct = (c, p) => (p ? `${c >= p ? '▲' : '▼'}${fmt(Math.abs((c - p) / p * 100), 1)}%` : '-');

// 업무일지 한 달 (본사·김포) — 월간 실적 현황판과 같은 합계
const prodMonth = (ym) => {
    const days = [];
    const products = new Map(), oils = new Map();
    [['본사', 'hqLogs'], ['김포', 'gimpoLogs']].forEach(([site, key]) => (state[key] || []).forEach(l => {
        if (!String(l.date || '').startsWith(ym)) return;
        const pk = l.packaging || [], ob = l.oilBlending || [], lb = l.labeling || [], ot = l.otherTasks || [];
        days.push({ date: l.date, pack: sum(pk, 'qty'), oil: sum(ob, 'qty'), label: sum(lb, 'qty'), mhPack: sum(pk, 'manHours'), mh: sum(pk, 'manHours') + sum(ob, 'manHours') + sum(lb, 'manHours') + sum(ot, 'manHours'), site });
        pk.forEach(p => { if (!p.item || !(Number(p.qty) > 0)) return; const x = products.get(p.item) || { name: p.item, qty: 0, 본사: 0, 김포: 0 }; x.qty += Number(p.qty); x[site] += Number(p.qty); products.set(p.item, x); });
        ob.forEach(p => { if (!p.item || !(Number(p.qty) > 0)) return; const x = oils.get(p.item) || { name: p.item, qty: 0, batches: 0 }; x.qty += Number(p.qty); x.batches += 1; oils.set(p.item, x); });
    }));
    const t = { pack: sum(days, 'pack'), oil: sum(days, 'oil'), label: sum(days, 'label'), mh: sum(days, 'mh'), mhPack: sum(days, 'mhPack'), workDays: new Set(days.map(d => d.date)).size };
    t.packProd = t.mhPack ? t.pack / t.mhPack : 0;
    t.bySite = { 본사: sum(days.filter(d => d.site === '본사'), 'pack'), 김포: sum(days.filter(d => d.site === '김포'), 'pack') };
    return { t, products: [...products.values()].sort((a, b) => b.qty - a.qty), oils: [...oils.values()].sort((a, b) => b.qty - a.qty) };
};

/** 보고서 본문 HTML (reportDocHtml의 .doc 안에 들어감) */
export const buildMonthlyReportHtml = (ym, data) => {
    const today = localDateStr();
    const prevYm = ymAdd(ym, -1);
    const P = prodMonth(ym), PP = prodMonth(prevYm);
    const perDay = (x, k) => (x.t.workDays ? x.t[k] / x.t.workDays : 0);
    // 원료 입고
    const inb = (m) => (state.rawLedger || []).filter(e => String(e.date).startsWith(m) && e.type === '입고' && Number(e.inQty) > 0);
    const ri = inb(ym), rip = inb(prevYm);
    const rawTop = Object.entries(ri.reduce((o, e) => { o[e.name] = (o[e.name] || 0) + Number(e.inQty); return o; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10);
    // 주문
    const orders = (data.orders?.orders || []).filter(o => !o.raw);
    const reqM = orders.filter(o => String(o.r.reqDate || o.r.period).startsWith(ym));
    const doneM = orders.filter(o => o.complete && String(o.completedAt).startsWith(ym));
    const onTime = doneM.filter(o => o.onTime === true).length;
    const lateOpen = orders.filter(o => o.overdue);
    const slipsM = (data.orders?.slips || []).filter(s => String(s.date).startsWith(ym));
    // 품질
    const Q = data.qc ? computeQcSummary(data.qc, { ym }) : null;
    const ncrM = data.qc ? data.qc.ncr.filter(r => String(r.date).startsWith(ym)) : [];
    // 재고
    const byCode = new Map();
    (state.inventory || []).forEach(i => byCode.set(i.code, (byCode.get(i.code) || 0) + (Number(i.quantity) || 0)));
    const short = state.master.filter(m => Number(m.safety) > 0 && (byCode.get(m.code) || 0) < Number(m.safety));
    const alerts = buildAlerts(data, { ym });
    const kv = (rows) => `<table><colgroup><col style="width:28%"><col style="width:22%"><col style="width:28%"><col style="width:22%"></colgroup><tbody>${rows.map(r => `<tr>${r.map((c, i) => (i % 2 ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</tbody></table>`;
    const tbl = (head, rows, empty = '없음') => `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}" class="small">${empty}</td></tr>`}</tbody></table>`;
    const qArea = Q ? Object.keys(QC_AREAS).map(a => [QC_AREAS[a].label, Q.area[a].count, fmt(Q.area[a].inspected), fmt(Q.area[a].defect), Q.area[a].count ? fmtRate(Q.area[a].rate) : '-', Q.targets[a] ?? '-', Q.area[a].fail]) : [];
    return `
<h1>${ymLabel(ym)} 종합현황 월간 보고서</h1>
<div class="byline">(주)대림오일 · 작성 ${new Date().toLocaleString('ko-KR')} · ${esc(state.currentUser?.name || state.currentGlobalWorker || '')} · 종합현황판 자동 작성</div>
<p class="lead">생산 <b>${fmt(P.t.pack)} EA</b>(원액 ${fmt(P.t.oil)} L, 작업 ${P.t.workDays}일) · 원료 입고 <b>${fmt(sum(ri, 'inQty'))} L</b> · 주문 요청 <b>${reqM.length}건</b>, 완료 <b>${doneM.length}건</b>${doneM.length ? `(납기 준수 ${Math.round(onTime / doneM.length * 100)}%)` : ''} · 불량률 <b>${Q?.cur.count ? fmtRate(Q.cur.rate) : '-'}</b> · 부적합 발생 ${ncrM.length}건 · 안전재고 미달 ${short.length}종</p>

<h2>1. 생산 실적 (업무일지)</h2>
${kv([
        ['완제품 포장', `${fmt(P.t.pack)} EA <span class="small">전월 일평균 대비 ${pct(perDay(P, 'pack'), perDay(PP, 'pack'))}</span>`, '원액 생산', `${fmt(P.t.oil)} L <span class="small">${pct(perDay(P, 'oil'), perDay(PP, 'oil'))}</span>`],
        ['작업일 · 총 공수', `${P.t.workDays}일 · ${fmt(P.t.mh, 1)} 공수`, '포장 생산성', `${fmt(P.t.packProd, 1)} EA/공수 <span class="small">${pct(P.t.packProd, PP.t.packProd)}</span>`],
        ['본사 · 김포 포장', `${fmt(P.t.bySite.본사)} · ${fmt(P.t.bySite.김포)} EA`, '라벨 부착', `${fmt(P.t.label)} EA`]
    ])}
<h3>포장 상위 10개 제품</h3>
${tbl(['순위', '제품', '수량(EA)', '본사', '김포'], P.products.slice(0, 10).map((x, i) => [i + 1, esc(x.name), fmt(x.qty), fmt(x.본사), fmt(x.김포)]), '포장 실적 없음')}
<h3>원액 생산</h3>
${tbl(['원액', '수량(L)', '배치'], P.oils.slice(0, 10).map(x => [esc(x.name), fmt(x.qty), x.batches]), '원액 생산 실적 없음')}

<h2>2. 원료 입고 (원료수불부)</h2>
${kv([['입고량', `${fmt(sum(ri, 'inQty'))} L <span class="small">전월 ${pct(sum(ri, 'inQty'), sum(rip, 'inQty'))}</span>`, '입고 전표 · 원료', `${ri.length}건 · ${new Set(ri.map(e => e.name)).size}종`]])}
${tbl(['원료', '입고량(L)'], rawTop.map(([n, q]) => [esc(n), fmt(q)]), '원료 입고 없음')}

<h2>3. 주문 · 출하</h2>
${data.orders ? `${kv([['주문 요청(이달)', `${reqM.length}건`, '완료(이달)', `${doneM.length}건${doneM.length ? ` · 납기 준수 ${Math.round(onTime / doneM.length * 100)}%` : ''}`], ['출하요청서(이달)', `${slipsM.length}건 · 출하완료 ${slipsM.filter(s => s.shippedAt).length}건`, '납기 지난 진행 주문', `${lateOpen.length}건 <span class="small">(작성 시점)</span>`]])}
${tbl(['주문', '거래처', '품목', '납기', '완료일', '납기'], doneM.slice(0, 20).map(o => [esc(o.docNo), esc(o.r.partner || ''), esc(`${o.lines[0]?.name || ''}${o.lines.length > 1 ? ` 외 ${o.lines.length - 1}` : ''}`), esc(o.due || ''), esc(o.completedAt || ''), o.onTime === false ? '지남' : '준수']), '이달 완료된 주문 없음')}` : '<p class="small">주문 자료를 불러오지 못했습니다.</p>'}

<h2>4. 품질</h2>
${Q ? `${kv([['전체 불량률', `${Q.cur.count ? fmtRate(Q.cur.rate) : '-'} <span class="small">검사 ${Q.cur.count}건 · 불량 ${fmt(Q.cur.defect)}</span>`, '불합격 · 조건부', `${Q.cur.fail} · ${Q.cur.cond}건`], ['부적합 발생(이달)', `${ncrM.length}건`, '부적합 미결 · 기한 지남', `${Q.ncrOpen.length} · ${Q.ncrLate.length}건 <span class="small">(작성 시점)</span>`]])}
${tbl(['영역', '검사 건수', '검사 수량', '불량 수량', '불량률', '목표(%)', '불합격'], qArea)}
<h3>불량 유형 상위</h3>
${tbl(['유형', '수량', '비율'], Q.cur.byType.slice(0, 6).map(t => [esc(t.type), fmt(t.qty), `${fmt(t.share, 1)}%`]), '불량 없음')}` : '<p class="small">품질 자료를 불러오지 못했습니다.</p>'}

<h2>5. 재고 (작성 시점)</h2>
${tbl(['품목', '분류', '현재고', '안전재고'], short.slice(0, 20).map(m => [esc(m.name), esc(m.category || ''), fmt(byCode.get(m.code) || 0), fmt(m.safety)]), '안전재고 미달 품목 없음')}

<h2>6. 확인할 일 (작성 시점)</h2>
${alerts.length ? `<ul>${alerts.filter(a => a.level !== 'info').slice(0, 25).map(a => `<li>${a.level === 'red' ? '⚠️ ' : ''}${esc(a.text)}</li>`).join('')}</ul>` : '<p class="small">급하게 확인할 항목이 없습니다.</p>'}
<p class="small" style="margin-top:6mm">※ 월 실적은 ${ymLabel(ym)} 기준, 재고·미결·확인할 일은 작성 시점(${today}) 기준입니다. 근거 자료: 업무일지·원료수불부·생산요청서·출하요청서·품질 기록·창고 재고.</p>`;
};

/** 만들어 저장 (매니저 이상) */
export const saveMonthlyReport = async (ym, data = null) => {
    const d = data || await loadDigestData();
    const html = buildMonthlyReportHtml(ym, d);
    const P = prodMonth(ym);
    return saveReport({ id: reportIdOf(ym), kind: 'OVERVIEW', title: `${ymLabel(ym)} 종합현황 월간 보고서`, period: ym, scope: '종합현황판',
        summary: `생산 ${fmt(P.t.pack)}EA · 원액 ${fmt(P.t.oil)}L · 작업 ${P.t.workDays}일`, content: { html, generatedAt: new Date().toISOString() } });
};

/** 앱 시작 때: 매니저 이상이면 지난달 보고서가 없을 때 한 번 만든다 (기기별 달마다 한 번 확인) */
export const runMonthlyReportAuto = async () => {
    if (!canPerformAction('MRP_PLANNING')) return null;
    const prevYm = ymAdd(localDateStr().slice(0, 7), -1);
    const flag = `daelim_monthly_report_checked_${prevYm}`;
    try { if (localStorage.getItem(flag)) return null; } catch { /* 무시 */ }
    const list = await listReports();
    const done = () => { try { localStorage.setItem(flag, '1'); } catch { /* 무시 */ } };
    if (list.some(r => r.id === reportIdOf(prevYm))) { done(); return null; }
    await saveMonthlyReport(prevYm);
    done();
    return prevYm;
};
