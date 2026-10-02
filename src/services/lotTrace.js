// ==========================================
// LOT 추적 조회 (품질·환경 › LOT 추적, components/LotTrace.js)
// ==========================================
// LOT 번호 하나로 흩어진 기록을 모은다:
//   · db.traceLot — 입출고 이력 사유(클라우드 포함)·원료/제품/자재 수불부 비고·이 기기 생산 실적
//   · 업무일지(본사·김포) 포장·원액 줄의 LOT · 생산(포장) 스케줄 LOT 칸 · IBC(원액 담긴 토트) LOT
//   · 품질 기록(검사 INSPECT·부적합 NCR·시험성적서 TEST_REPORT·COA·원액 검사 BTEST·공정 점검 PCHECK)에 LOT이 적힌 것
//   · 전표(출고요청서·이동) 사유·품목·출고 검수에 LOT이 적힌 것 · 드럼 라벨 발행 이력
// 분류: 생산 · 사용(투입) 원액·원부자재 · 품질 · 이동 · 출하.
// 보안: 원액 LOT(원액 생산)의 원료 투입 내역은 배합 정보라, 원액 작업지시서 권한(secureWorkOrders)이 없으면 '원료 n종 투입'으로만 보인다.
import { state, traceLot, listSlipsRange } from './db.js';
import { canAccessTab } from './auth.js';
import { localDateStr, toDateKey } from './searchUtils.js';
import { listQc } from './quality.js';
import { getSupabase, isSupabaseConfigured } from './supabase.js';

const QC_KIND_LABEL = { INSPECT: '검사', NCR: '부적합', TEST_REPORT: '시험성적서', COA: 'COA', BTEST: '원액 검사', PCHECK: '공정 점검' };
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return localDateStr(x); };

/**
 * @returns {Promise<{ lot, mainItems, isRawLot, masked, production, usage, quality, moves, shipping, labels, ibc, timeline, warnings }>}
 */
export const traceLotFull = async (lotInput) => {
    const lot = String(lotInput || '').trim();
    const base = await traceLot(lot); // 3글자 미만이면 여기서 오류
    const low = lot.toLowerCase();
    const has = (v) => String(v ?? '').toLowerCase().includes(low);
    const hasJson = (o) => { try { return JSON.stringify(o).toLowerCase().includes(low); } catch { return false; } };
    const warnings = [];
    const masterOf = (code) => state.master.find(m => m.code === code);

    // ---------- 생산 ----------
    const production = [];
    base.events.filter(e => e.type === 'PROD' || (e.type === 'IN' && /생산/.test(e.text))).forEach(e => production.push({ source: e.source === 'production' ? '생산 실적' : '입출고 이력', date: e.date, code: e.code, name: e.name, qty: e.qty, place: e.to || e.from, worker: e.worker, text: e.text }));
    [['HQ', 'hqLogs', '본사'], ['GIMPO', 'gimpoLogs', '김포']].forEach(([, key, site]) => (state[key] || []).forEach(l => {
        (l.packaging || []).filter(p => has(p.lotNo) || has(p.lot)).forEach(p => production.push({ source: `업무일지(${site}) 포장`, date: l.date, code: p.code || '', name: p.item || p.name || '', qty: Number(p.qty) || 0, place: `${site} ${p.line || ''}`.trim(), worker: p.worker || '', text: [p.category, p.box ? `${p.box}박스` : '', p.notes].filter(Boolean).join(' · ') }));
        (l.oilBlending || []).filter(p => has(p.lotNo) || has(p.lot)).forEach(p => production.push({ source: `업무일지(${site}) 원액`, date: l.date, code: p.code || '', name: p.item || p.name || '', qty: Number(p.qty) || 0, place: `${site} ${p.line || ''}`.trim(), worker: p.worker || '', text: p.notes || '', raw: true }));
    }));
    // 생산(포장) 스케줄 LOT 칸
    const sched = [];
    const sb = cloud();
    const safe = lot.replace(/[%_\\,()]/g, '');
    if (sb && safe.length >= 3) {
        const { data, error } = await sb.from('wms_production_schedule').select('sheet_date, site, line, status, item_code, item_name, qty, partner, lot_no, prod_start, prod_end, ship_date').ilike('lot_no', `%${safe}%`).order('sheet_date', { ascending: false }).limit(50);
        if (error) warnings.push(`생산 스케줄: ${error.message}`);
        // 같은 줄이 작성일자마다 복사되므로 최신 작성일자의 것만
        const seen = new Set();
        (data || []).forEach(r => { const k = `${r.item_name}|${r.qty}|${r.partner}`; if (seen.has(k)) return; seen.add(k); sched.push(r); });
    } else {
        try {
            const local = JSON.parse(localStorage.getItem('daelim_prodSchedule') || '[]').filter(r => has(r.lot_no)).sort((a, b) => String(b.sheet_date).localeCompare(String(a.sheet_date)));
            const seen = new Set();
            local.forEach(r => { const k = `${r.item_name}|${r.qty}|${r.partner}`; if (!seen.has(k)) { seen.add(k); sched.push(r); } });
        } catch { /* 무시 */ }
    }
    sched.forEach(r => production.push({ source: `생산 스케줄 (${r.sheet_date} 작성)`, date: r.prod_end || r.prod_start || r.sheet_date, code: r.item_code || '', name: r.item_name, qty: Number(r.qty) || 0, place: `${r.site}${r.line ? ` ${r.line}` : ''}`, worker: '', text: [r.partner, r.status === 'SHIPPED' ? `출고 ${r.ship_date || ''}` : r.status === 'DONE' ? '완료·출고대기' : r.status === 'PRODUCING' ? '생산중' : ''].filter(Boolean).join(' · ') }));

    // 주 품목 (생산 기록에서)
    const mainMap = new Map();
    production.forEach(p => { const k = p.code || p.name; if (!k) return; const m = masterOf(p.code); const x = mainMap.get(k) || { code: p.code || m?.code || '', name: p.name || m?.name || '', category: m?.category || (p.raw ? '원액' : ''), qty: 0 }; x.qty = Math.max(x.qty, Number(p.qty) || 0); mainMap.set(k, x); });
    const mainItems = [...mainMap.values()];
    const isRawLot = mainItems.length > 0 && mainItems.every(x => x.category === '원액' || x.category === '원료');
    const masked = isRawLot && !canAccessTab('secureWorkOrders');

    // ---------- 사용(투입) ----------
    const mainCodes = new Set(mainItems.map(x => x.code).filter(Boolean));
    const usageAll = base.events.filter(e => (e.type === 'USE' || /사용|투입/.test(e.kind) || /투입/.test(e.text)) && !mainCodes.has(e.code))
        .map(e => ({ date: e.date, code: e.code, name: e.name, qty: Math.abs(Number(e.qty) || 0), unit: masterOf(e.code)?.unit || (/원료/.test(e.kind) ? 'L' : ''), category: masterOf(e.code)?.category || (/원료수불부/.test(e.kind) ? '원료' : ''), source: e.kind, text: e.text }));
    // 같은 원부자재는 이력·수불부 두 곳에 남으므로 코드별로 하나만 (큰 수량)
    const usageMap = new Map();
    usageAll.forEach(u => { const k = u.code || u.name; const x = usageMap.get(k); if (!x || u.qty > x.qty) usageMap.set(k, u); });
    let usage = [...usageMap.values()].sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name), 'ko'));
    const hiddenUsage = masked ? usage.filter(u => ['원료', '원액'].includes(u.category)).length : 0;
    if (masked) usage = usage.filter(u => !['원료', '원액'].includes(u.category));

    // ---------- 이동·출하 ----------
    const moves = base.events.filter(e => e.type === 'MOVE').map(e => ({ date: e.date, code: e.code, name: e.name, qty: e.qty, from: e.from, to: e.to, worker: e.worker, text: e.text }));
    const shipping = base.events.filter(e => e.type === 'OUT' || /출고/.test(e.kind)).filter(e => !/투입|사용/.test(`${e.kind} ${e.text}`))
        .map(e => ({ source: e.source === 'history' ? '입출고 이력' : e.kind, date: e.date, code: e.code, name: e.name, qty: Math.abs(Number(e.qty) || 0), partner: e.text, place: e.from, worker: e.worker }));
    try {
        const slips = await listSlipsRange({ from: addDays(localDateStr(), -730) });
        slips.filter(s => hasJson([s.reason, s.items, s.shipCheck])).forEach(s => {
            const items = (s.items || []).filter(it => hasJson(it) || mainCodes.has(it.code));
            shipping.push({ source: `전표 ${s.docNo}`, date: s.date, code: items[0]?.code || '', name: items.map(it => it.name).join(', ') || (s.items || [])[0]?.name || '', qty: items.reduce((n, it) => n + (Number(it.qty) || 0), 0),
                partner: s.partner || s.toLoc || '', place: s.fromLoc, worker: s.shippedBy || s.worker, text: `${s.type === 'RELEASE' ? '출고요청서' : '이동전표'}${s.shippedAt ? ` · 출고 완료 ${toDateKey(s.shippedAt)}` : ' · 출고 대기'}`, docNo: s.docNo });
        });
    } catch (e) { warnings.push(`전표: ${e.message}`); }
    // 같은 출하가 전표·입출고 이력·수불부에 모두 남으므로 날짜·품목·수량이 같으면 하나로 (전표 > 이력 > 수불부)
    const rank = (s) => (s.docNo ? 0 : s.source === '입출고 이력' ? 1 : 2);
    const cleanPartner = (t) => String(t || '').replace(/\[[^\]]*\]/g, '').replace(/LOT[:\s]*[A-Za-z0-9-]+/gi, '').replace(/출고|출하|→.*$/g, '').replace(/\s+/g, ' ').trim();
    const shipMap = new Map();
    shipping.sort((a, b) => rank(a) - rank(b)).forEach(s => {
        const k = `${s.date}|${s.docNo ? '' : s.code}|${Number(s.qty) || 0}`;
        const alt = [...shipMap.values()].find(x => x.date === s.date && Number(x.qty) === Number(s.qty) && (!x.code || !s.code || x.code === s.code));
        if (alt) { alt.also = [...(alt.also || []), s.source]; return; }
        shipMap.set(k, { ...s, partner: s.docNo ? s.partner : cleanPartner(s.partner) || s.partner });
    });
    shipping.length = 0;
    shipping.push(...[...shipMap.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))));

    // ---------- 품질 ----------
    const quality = [];
    for (const kind of Object.keys(QC_KIND_LABEL)) {
        try {
            (await listQc(kind)).filter(r => has(r.lot) || has(r.lotNo) || hasJson([r.lot, r.lotNo, r.lots, r.items?.map?.(x => x.lot), r.notes, r.description, r.title])).forEach(r => {
                const res = kind === 'INSPECT' ? ({ PASS: '합격', COND: '조건부 합격', FAIL: '불합격' }[r.result] || '')
                    : kind === 'NCR' ? ({ OPEN: '발생', ACTION: '조치 중', CLOSED: '완료' }[r.status] || '')
                        : kind === 'PCHECK' ? ((r.items || []).some(x => x.result === 'NG') ? '부적합' : '적합')
                            : r.overall === 'NG' ? '부적합' : r.overall === 'OK' ? '적합' : (r.result || '');
                const bad = /불합격|부적합|발생|조치/.test(res);
                quality.push({ kind: QC_KIND_LABEL[kind], qcKind: kind, area: r.area || '', date: r.date, name: r.itemName || r.productName || r.title || '', result: res, bad, text: [r.description, r.defectQty ? `불량 ${r.defectQty}` : '', r.inspector || r.by].filter(Boolean).join(' · ') });
            });
        } catch (e) { warnings.push(`품질(${QC_KIND_LABEL[kind]}): ${e.message}`); }
    }

    // ---------- 라벨·IBC ----------
    const labels = [];
    try {
        const { listDrumPrints } = await import('./drumLabels.js');
        const prints = await listDrumPrints(300);
        (prints || []).forEach(p => (p.items || []).filter(hasJson).forEach(it => labels.push({ date: toDateKey(p.timestamp), by: p.by, name: it.name || it.itemName || it.productName || '', qty: it.qty || it.count || '', text: [it.spec, it.weight ? `${it.weight}` : ''].filter(Boolean).join(' · ') })));
    } catch { /* 라벨 이력 없음 */ }
    const ibc = [];
    try {
        const { listTanks } = await import('./ibcTotes.js');
        (await listTanks()).filter(t => has(t.lot)).forEach(t => ibc.push({ tote: t.toteCode, name: t.blendName || t.blendCode, location: t.location, filled: t.filledQty, remaining: t.remaining, status: t.status, date: toDateKey(t.filledAt || t.createdAt) }));
    } catch { /* IBC 없음 */ }

    // ---------- 시간 순 ----------
    const timeline = [
        ...production.map(p => ({ date: p.date, group: '생산', title: `${p.name} ${p.qty ? Number(p.qty).toLocaleString('ko-KR') : ''}`, sub: `${p.source}${p.place ? ` · ${p.place}` : ''}${p.text ? ` · ${p.text}` : ''}` })),
        ...(masked ? [] : usage).map(u => ({ date: u.date, group: '투입', title: `${u.name} ${Number(u.qty).toLocaleString('ko-KR')}${u.unit}`, sub: u.source })),
        ...quality.map(q => ({ date: q.date, group: '품질', title: `${q.kind} ${q.result}`, sub: `${q.name}${q.text ? ` · ${q.text}` : ''}`, bad: q.bad })),
        ...moves.map(m => ({ date: m.date, group: '이동', title: `${m.name} ${Number(m.qty).toLocaleString('ko-KR')}`, sub: `${m.from} → ${m.to}` })),
        ...shipping.map(s => ({ date: s.date, group: '출하', title: `${s.name} ${s.qty ? Number(s.qty).toLocaleString('ko-KR') : ''}`, sub: `${s.source}${s.partner ? ` · ${s.partner}` : ''}` })),
        ...labels.map(l => ({ date: l.date, group: '라벨', title: `드럼 라벨 발행 ${l.name}`, sub: l.by }))
    ].filter(x => x.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { lot, mainItems, isRawLot, masked, hiddenUsage, production, usage, quality, moves, shipping, labels, ibc, timeline, warnings, raw: base.events };
};

/** 최근 LOT 후보 (업무일지·생산 실적에서, 최근 순) */
export const recentLots = (limit = 20) => {
    const out = [];
    const push = (lot, date, name) => { const l = String(lot || '').trim(); if (l.length >= 3 && !/마킹|날인|없음|인쇄/.test(l) && !out.some(x => x.lot === l)) out.push({ lot: l, date, name }); };
    const list = [];
    [['hqLogs'], ['gimpoLogs']].forEach(([key]) => (state[key] || []).forEach(l => [...(l.packaging || []), ...(l.oilBlending || [])].forEach(p => list.push({ lot: p.lotNo || p.lot, date: l.date, name: p.item || p.name }))));
    (state.productions || []).forEach(p => list.push({ lot: p.lotNo, date: p.prodDate || p.mfgDate, name: p.itemName }));
    list.sort((a, b) => String(b.date).localeCompare(String(a.date))).forEach(x => push(x.lot, x.date, x.name));
    return out.slice(0, limit);
};
