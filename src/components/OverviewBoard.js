// ==========================================
// 월간 실적 현황판 › 종합현황판 (overview) — 모든 현황을 한 화면에
// ==========================================
// 새로 입력하는 곳은 없고, 다른 현황판·화면의 자료를 모아 요약한다. 카드를 누르면 자세한 화면으로 간다.
//   · 생산 실적: 업무일지(본사·김포) 완제품 포장·원액 생산·공수·포장 생산성 (월간 실적 현황판과 같은 합계, 전월은 작업일 1일 평균 비교)
//   · 원료 입고: 원료수불부 입고 전표 (L·건수·원료 종류)
//   · 주문·출하: services/orders.js (진행 중·납기 지남·7일 안·이달 완료·출하요청서)
//   · 생산(포장) 스케줄: 최신 작성일자 (진행 상태별·납기 지남)
//   · 품질: services/qcBoardData.js (불량률·부적합·설비·MSDS)
//   · 재고: 창고 재고·안전재고 미달, 제품·자재 수불부 이달 입출고
//   · 요청서: 생산·구매요청서 미처리·필요일 지남 · 일정: 오늘·이번 주·지난 미완료
//   · 확인할 일: 위에서 급한 것만 모아 한 목록
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { state } from '../services/db.js';
import { canAccessTab, canPerformAction } from '../services/auth.js';
import { safetyShortages, openSafetyPurchaseDraft } from '../services/safetyDraft.js';
import { localDateStr } from '../services/searchUtils.js';
import { listPlans, addDays } from '../services/plans.js';
import { listProdDates, listProdSchedule } from '../services/prodSchedule.js';
import { loadOrderData } from '../services/orders.js';
import { loadQcBoardData, computeQcSummary, ymAdd } from '../services/qcBoardData.js';
import { fmtRate } from '../services/quality.js';
import { loadDigestData, buildAlerts } from '../services/digest.js';
import { setBoardFullscreen, isBoardFullscreen, fullscreenButtonHtml } from '../services/fullscreen.js';

const fmt = (n, d = 0) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: d });
const sum = (rows, k) => (rows || []).reduce((s, r) => s + (Number(r[k]) || 0), 0);
const ymLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
const weekStartOf = (d) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return localDateStr(x); };

// 업무일지 한 달 합계 (본사·김포)
const prodOf = (ym) => {
    const days = [];
    [['HQ', 'hqLogs'], ['GIMPO', 'gimpoLogs']].forEach(([site, key]) => (state[key] || []).forEach(l => {
        if (!String(l.date || '').startsWith(ym)) return;
        const pk = l.packaging || [], ob = l.oilBlending || [], lb = l.labeling || [], ot = l.otherTasks || [];
        days.push({ site, date: l.date, pack: sum(pk, 'qty'), oil: sum(ob, 'qty'), label: sum(lb, 'qty'), mhPack: sum(pk, 'manHours'),
            mh: sum(pk, 'manHours') + sum(ob, 'manHours') + sum(lb, 'manHours') + sum(ot, 'manHours') });
    }));
    const t = { pack: sum(days, 'pack'), oil: sum(days, 'oil'), label: sum(days, 'label'), mh: sum(days, 'mh'), mhPack: sum(days, 'mhPack') };
    t.workDays = new Set(days.map(d => d.date)).size;
    t.bySite = Object.fromEntries(['HQ', 'GIMPO'].map(s => [s, sum(days.filter(d => d.site === s), 'pack')]));
    t.packProd = t.mhPack ? t.pack / t.mhPack : 0;
    return t;
};

export const renderOverviewBoard = (container, { onSwitchTab = () => {} } = {}) => {
    let ym = localDateStr().slice(0, 7);
    let remote = null; // { orders, qc, sched, reqs, preqs, errors }
    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 rounded-3xl shadow-lg border border-slate-800 space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-indigo-300 flex items-center gap-1"><i data-lucide="bar-chart-3" class="w-3.5 h-3.5"></i>월간 실적 현황판 › 종합현황판</div>
                    <h2 class="text-xl font-black mt-1 flex items-center gap-2"><i data-lucide="layout-dashboard" class="w-5 h-5 text-indigo-300"></i>종합현황판</h2>
                    <p class="text-xs text-slate-400 mt-1">생산 실적 · 원료 입고 · 주문·출하 · 생산 스케줄 · 품질 · 재고 · 요청서 · 일정을 한 화면에서 봅니다. 카드를 누르면 자세한 현황으로 갑니다.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    ${canPerformAction('PRODUCTION') ? '<button type="button" id="ov-digest" class="px-3.5 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-xs font-bold flex items-center gap-1.5"><i data-lucide="bell-ring" class="w-4 h-4"></i>아침 알림</button>' : ''}
                    <button type="button" id="ov-refresh" class="px-3.5 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-xs font-bold flex items-center gap-1.5"><i data-lucide="refresh-cw" class="w-4 h-4"></i>새로고침</button>
                    ${fullscreenButtonHtml('ov-full')}
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <button type="button" id="ov-prev" class="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 font-black">◀</button>
                <input type="month" id="ov-ym" value="${ym}" class="bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1 font-bold" />
                <button type="button" id="ov-next" class="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 font-black">▶</button>
                <span id="ov-updated" class="text-[11px] text-slate-400 ml-2"></span>
            </div>
        </div>
        <div id="ov-body"></div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    const load = async () => {
        $('#ov-updated').textContent = '불러오는 중…';
        remote = await loadDigestData();
        $('#ov-updated').textContent = `갱신 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}${remote.errors.length ? ` · 일부 자료를 못 불러옴 (${remote.errors.length})` : ''}`;
        draw();
    };

    const draw = () => {
        const today = localDateStr();
        const isCur = ym === today.slice(0, 7);
        const alerts = remote ? buildAlerts(remote, { ym }) : []; // services/digest.js (아침 알림과 같은 계산)
        const card = (title, icon, color, go, bodyHtml, foot = '') => `
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-3">
                <div class="flex items-center justify-between"><h3 class="text-sm font-black text-slate-800 flex items-center gap-1.5"><span class="w-7 h-7 rounded-lg flex items-center justify-center" style="background:${color}1a;color:${color}"><i data-lucide="${icon}" class="w-4 h-4"></i></span>${title}</h3>
                    ${go && canAccessTab(go) ? `<button type="button" data-go="${go}" class="ov-go text-[11px] font-bold text-indigo-600 hover:underline whitespace-nowrap">자세히 →</button>` : ''}</div>
                ${bodyHtml}${foot ? `<div class="text-[11px] text-slate-500 border-t border-slate-100 pt-2">${foot}</div>` : ''}
            </div>`;
        const stat = (label, value, sub = '', cls = 'text-slate-900', go = '') => `<div ${go ? `data-go="${go}"` : ''} class="${go ? 'ov-go cursor-pointer hover:bg-indigo-50' : ''} p-2.5 rounded-xl bg-slate-50"><div class="text-[10px] font-bold text-slate-500">${label}</div><div class="text-lg font-black leading-tight ${cls}">${value}</div>${sub ? `<div class="text-[10px] text-slate-500 truncate">${sub}</div>` : ''}</div>`;
        const grid = (...xs) => `<div class="grid grid-cols-2 gap-2">${xs.join('')}</div>`;
        const delta = (cur, prev, unit = '') => {
            if (!prev) return '';
            const d = cur - prev, p = prev ? (d / prev) * 100 : 0;
            return `<span class="${d > 0 ? 'text-emerald-600' : d < 0 ? 'text-rose-600' : 'text-slate-500'} font-bold">전월 ${d > 0 ? '▲' : d < 0 ? '▼' : '='}${fmt(Math.abs(p), 1)}%</span>${unit}`;
        };
        const cards = [];

        // 1. 생산 실적
        if (canAccessTab('analytics')) {
            const c = prodOf(ym), p = prodOf(ymAdd(ym, -1));
            const perDay = (t, k) => (t.workDays ? t[k] / t.workDays : 0);
            cards.push(card('생산 실적 (업무일지)', 'factory', '#2563eb', 'analytics', grid(
                stat('완제품 포장', `${fmt(c.pack)} EA`, p.workDays ? `${delta(perDay(c, 'pack'), perDay(p, 'pack'))} (일평균)` : '전월 기록 없음', 'text-blue-700'),
                stat('원액 생산', `${fmt(c.oil)} L`, delta(perDay(c, 'oil'), perDay(p, 'oil')), 'text-amber-600'),
                stat('작업일 · 총 공수', `${c.workDays}일`, `${fmt(c.mh, 1)} 공수`),
                stat('포장 생산성', `${fmt(c.packProd, 1)}`, `EA/공수 ${delta(c.packProd, p.packProd ? p.packProd : 0)}`)
            ), `본사 ${fmt(c.bySite.HQ)} EA · 김포 ${fmt(c.bySite.GIMPO)} EA · 라벨부착 ${fmt(c.label)} EA`));
        }
        // 2. 원료 입고
        if (canAccessTab('rawLedger')) {
            const inb = (m) => (state.rawLedger || []).filter(e => String(e.date).startsWith(m) && e.type === '입고' && Number(e.inQty) > 0);
            const c = inb(ym), p = inb(ymAdd(ym, -1));
            const top = Object.entries(c.reduce((o, e) => { o[e.name] = (o[e.name] || 0) + Number(e.inQty); return o; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 3);
            cards.push(card('원료 입고 (원료수불부)', 'cylinder', '#059669', 'rawLedger', grid(
                stat('입고량', `${fmt(sum(c, 'inQty'))} L`, delta(sum(c, 'inQty'), sum(p, 'inQty')), 'text-emerald-700'),
                stat('입고 전표 · 원료', `${c.length}건`, `${new Set(c.map(e => e.name)).size}종`)
            ), top.length ? `많이 들어온 원료: ${top.map(([n, q]) => `${esc(n)} ${fmt(q)}L`).join(' · ')}` : '이달 원료 입고 없음'));
        }
        // 3. 주문·출하
        const O = remote?.orders;
        if (O) {
            const os = O.orders.filter(o => !o.raw);
            const open = os.filter(o => o.state === 'OPEN');
            const late = open.filter(o => o.overdue);
            const soon = open.filter(o => o.daysLeft !== null && o.daysLeft >= 0 && o.daysLeft <= 7);
            const done = os.filter(o => o.complete && String(o.completedAt).startsWith(ym));
            const onTime = done.filter(o => o.onTime === true).length;
            const slipsM = O.slips.filter(s => String(s.date).startsWith(ym));
            cards.push(card('주문 · 출하', 'list-ordered', '#7c3aed', 'orderBoard', grid(
                stat('진행 중 주문', `${open.length}건`, `생산완료·출하대기 ${open.filter(o => o.produced && !o.shipped).length}건`, 'text-violet-700'),
                stat('납기 지남 · 7일 안', `${late.length} · ${soon.length}건`, '', late.length ? 'text-rose-600' : 'text-amber-600'),
                stat(`${Number(ym.slice(5))}월 완료`, `${done.length}건`, done.length ? `납기 준수 ${Math.round(onTime / done.length * 100)}%` : ''),
                stat('출하요청서', `${slipsM.length}건`, `출하완료 ${slipsM.filter(s => s.shippedAt).length} · 대기 ${slipsM.filter(s => !s.shippedAt).length}`, 'text-slate-900', 'shipRequest')
            )));
        }
        // 4. 생산(포장) 스케줄
        const S = remote?.sched;
        if (S) {
            const rows = S.rows;
            const active = rows.filter(r => !['DONE', 'SHIPPED'].includes(r.status));
            const late = active.filter(r => r.dueDate && r.dueDate < today);
            const cnt = (s) => rows.filter(r => r.status === s).length;
            cards.push(card(`생산(포장) 스케줄 <span class="text-[11px] font-bold text-slate-400">${S.date.slice(5).replace('-', '/')} 작성</span>`, 'calendar-range', '#0891b2', 'prodSchedule', grid(
                stat('진행 중 줄', `${active.length}줄`, `본사 ${active.filter(r => r.site !== '김포').length} · 김포 ${active.filter(r => r.site === '김포').length}`, 'text-cyan-700'),
                stat('생산중 · 부자재 준비', `${cnt('PRODUCING')} · ${cnt('PREP')}`, `생산 예정 ${cnt('PLANNED')} · 보류 ${cnt('HOLD')}`),
                stat('완료·출고대기', `${cnt('DONE')}줄`, `출고완료 ${cnt('SHIPPED')}`),
                stat('납기 지남', `${late.length}줄`, `7일 안 ${active.filter(r => r.dueDate && r.dueDate >= today && r.dueDate <= addDays(today, 7)).length}줄`, late.length ? 'text-rose-600' : 'text-slate-900')
            ), `수량 합계 ${fmt(sum(active, 'qty'))} EA (진행 중)`));
        }
        // 5. 품질
        if (remote?.qc) {
            const Q = computeQcSummary(remote.qc, { ym });
            const d = Q.cur.count && Q.prev.count ? Q.cur.rate - Q.prev.rate : null;
            cards.push(card('품질', 'shield-check', '#16a34a', 'qcBoard', grid(
                stat('불량률', Q.cur.count ? fmtRate(Q.cur.rate) : '-', d === null ? `검사 ${Q.cur.count}건` : `<span class="${d > 0 ? 'text-rose-600' : 'text-emerald-600'} font-bold">전월 ${d > 0 ? '▲' : '▼'}${Math.abs(d).toFixed(2)}%p</span>`, 'text-emerald-700'),
                stat('불합격 · 조건부', `${Q.cur.fail} · ${Q.cur.cond}건`, `검사 ${Q.cur.count}건`),
                stat('부적합 미결', `${Q.ncrOpen.length}건`, Q.ncrLate.length ? `<span class="text-rose-600 font-bold">기한 지남 ${Q.ncrLate.length}</span>` : '', Q.ncrLate.length ? 'text-rose-600' : 'text-slate-900'),
                stat('설비 · MSDS 지남', `${Q.eqLate.length} · ${Q.msLate.length}건`, `점검 30일 안 ${Q.eqSoon.length}`, Q.eqLate.length || Q.msLate.length ? 'text-rose-600' : 'text-slate-900')
            )));
        }
        // 6. 재고
        if (canAccessTab('inventory')) {
            const byCode = new Map();
            (state.inventory || []).forEach(i => byCode.set(i.code, (byCode.get(i.code) || 0) + (Number(i.quantity) || 0)));
            const short = state.master.filter(m => Number(m.safety) > 0 && (byCode.get(m.code) || 0) < Number(m.safety));
            const mon = (key) => (state[key] || []).filter(e => String(e.date).startsWith(ym) && e.type !== '이월');
            const pr = mon('productLedger'), ma = mon('materialLedger');
            cards.push(card('재고 · 수불', 'database', '#0f766e', 'inventory', grid(
                stat('재고 보유 품목', `${[...byCode.values()].filter(q => q > 0).length}종`, `위치별 ${(state.inventory || []).filter(i => Number(i.quantity) > 0).length}줄`),
                stat('안전재고 미달', `${short.length}종`, '', short.length ? 'text-rose-600' : 'text-slate-900'),
                stat('제품 입고 · 출고', `${fmt(sum(pr, 'inQty'))} · ${fmt(sum(pr, 'outQty'))}`, `제품수불부 ${pr.length}건`, 'text-sky-700', 'productLedger'),
                stat('자재 입고 · 출고', `${fmt(sum(ma, 'inQty'))} · ${fmt(sum(ma, 'outQty'))}`, `자재수불부 ${ma.length}건`, 'text-indigo-700', 'ledger')
            ), canAccessTab('purchRequest') && safetyShortages().length ? `<button type="button" id="ov-safety-draft" class="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-black">🛒 안전재고 미달 ${safetyShortages().length}품목 → 구매요청서 초안</button>` : ''));
        }
        // 7. 요청서
        if (remote) {
            const pOpen = remote.reqs.filter(r => r.docNo && ['REQUESTED', 'ACCEPTED'].includes(r.status));
            const qOpen = remote.preqs.filter(r => r.docNo && !['DONE', 'REJECTED'].includes(r.status));
            const qLate = qOpen.filter(r => r.dueDate && r.dueDate < today);
            cards.push(card('요청서', 'file-input', '#d97706', '', grid(
                stat('생산요청 미접수', `${pOpen.length}건`, `이달 등록 ${remote.reqs.filter(r => String(r.reqDate || r.period).startsWith(ym)).length}건`, 'text-amber-600', 'prodRequest'),
                stat('구매요청 진행 중', `${qOpen.length}건`, qLate.length ? `<span class="text-rose-600 font-bold">필요일 지남 ${qLate.length}</span>` : `이달 등록 ${remote.preqs.filter(r => String(r.reqDate || r.period).startsWith(ym)).length}건`, qLate.length ? 'text-rose-600' : 'text-teal-700', 'purchRequest')
            )));
        }
        // 8. 일정
        if (canAccessTab('calendar')) {
            const sc = state.schedules || [];
            const ws = weekStartOf(today), we = addDays(ws, 6);
            const todayList = sc.filter(s => s.date === today);
            const lateList = sc.filter(s => s.date < today && s.status !== 'DONE' && s.date >= addDays(today, -30));
            cards.push(card('일정', 'calendar', '#db2777', 'calendar', grid(
                stat('오늘', `${todayList.length}건`, todayList.slice(0, 2).map(s => esc(s.title)).join(' · ')),
                stat('이번 주', `${sc.filter(s => s.date >= ws && s.date <= we).length}건`, `입고 ${sc.filter(s => s.date >= ws && s.date <= we && s.type === 'IN_PLAN').length} · 출고 ${sc.filter(s => s.date >= ws && s.date <= we && s.type === 'OUT_PLAN').length} · 생산 ${sc.filter(s => s.date >= ws && s.date <= we && s.type === 'PROD_PLAN').length}`),
                stat('지난 미완료 (30일)', `${lateList.length}건`, '', lateList.length ? 'text-rose-600' : 'text-slate-900')
            )));
        }

        const red = alerts.filter(a => a.level === 'red'), amber = alerts.filter(a => a.level !== 'red');
        $('#ov-body').innerHTML = `
            ${!isCur ? `<div class="p-2 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800">${ymLabel(ym)} 기준으로 월 실적(생산·원료 입고·품질·주문 완료·수불)을 봅니다. 스케줄·재고·미결 항목은 지금 상태입니다.</div>` : ''}
            <div class="bg-white p-4 rounded-2xl border ${red.length ? 'border-rose-300' : 'border-slate-200'} shadow-sm">
                <div class="flex items-center justify-between mb-2"><h3 class="text-sm font-black text-slate-800 flex items-center gap-1.5"><i data-lucide="bell-ring" class="w-4 h-4 text-rose-600"></i>확인할 일 <span class="text-rose-600">${red.length}</span>${amber.length ? ` <span class="text-amber-600 text-xs">+${amber.length}</span>` : ''}</h3></div>
                ${alerts.length ? `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">${[...red, ...amber].slice(0, 18).map(a => `<button type="button" data-go="${a.go}" class="ov-go text-left text-[11px] px-2.5 py-1.5 rounded-lg truncate ${a.level === 'red' ? 'bg-rose-50 text-rose-800 font-bold' : 'bg-amber-50 text-amber-800'}">${a.level === 'red' ? '⚠️' : '•'} ${esc(a.text)}</button>`).join('')}</div>${alerts.length > 18 ? `<div class="text-[10px] text-slate-400 mt-1">외 ${alerts.length - 18}건</div>` : ''}`
                    : '<div class="text-xs font-bold text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">✅ 급하게 확인할 항목이 없습니다.</div>'}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">${cards.join('') || '<div class="p-8 text-center text-xs text-slate-400 bg-white rounded-2xl border">불러오는 중...</div>'}</div>
            ${remote?.errors?.length ? `<div class="text-[11px] text-rose-600">일부 자료를 불러오지 못했습니다: ${esc(remote.errors.join(' / '))}</div>` : ''}`;
        $('#ov-safety-draft')?.addEventListener('click', () => { const n = openSafetyPurchaseDraft(onSwitchTab); if (!n) alert('안전재고 미달 구매 품목이 없습니다.'); });
        container.querySelectorAll('.ov-go').forEach(el => el.addEventListener('click', () => { const g = el.dataset.go; if (g && canAccessTab(g)) onSwitchTab(g); }));
        createIcons({ icons });
    };

    const setYm = (m) => { if (!m) return; ym = m; $('#ov-ym').value = ym; draw(); };
    $('#ov-prev').addEventListener('click', () => setYm(ymAdd(ym, -1)));
    $('#ov-next').addEventListener('click', () => setYm(ymAdd(ym, 1)));
    $('#ov-ym').addEventListener('change', (e) => setYm(e.target.value));
    $('#ov-refresh').addEventListener('click', load);
    $('#ov-digest')?.addEventListener('click', () => import('./MorningDigestSettings.js').then(m => m.openMorningDigestSettings({ showToast: window.__showToast || (() => {}) })));
    $('#ov-full').addEventListener('click', () => setBoardFullscreen(!isBoardFullscreen(), '#overview'));
    draw();
    createIcons({ icons });
    load();
};