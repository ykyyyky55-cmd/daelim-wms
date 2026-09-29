// ==========================================
// 통합 검색 엔진 (헤더 🔍 검색창 → components/GlobalSearch.js)
// ==========================================
// 앱의 조회 가능한 자료를 한 목록(문서)으로 모아 검색한다: 메뉴, 품목, 재고, 수불부(원료·제품·자재), 입출고 이력,
// 전표(이동·출고요청서), 생산(포장) 스케줄, 생산·구매요청서, 일정, 위치, 매뉴얼.
// 보안: 원액 작업지시서(배합·제조시방서)·BOM 배합·원료코드(보안 코드, rawCode)·단가·사용자 계정·서명은 넣지 않는다.
//       분류마다 연결 화면(tab)에 접근 권한이 없는 역할에게는 그 분류를 보여 주지 않는다 (canAccessTab).
// 검색 방법:
//   · 여러 낱말(AND) — 띄어 쓴 낱말이 모두 들어간 것, 공백·하이픈 무시('0w20' = '0W-20')
//   · 초성 — 'ㅋㅁ' → 카밈 (한글 초성만 쓴 낱말)
//   · 분류 지정 — '품목:엔진', '전표:RQ', '수불:입고' (메뉴·품목·재고·수불·이력·전표·스케줄·요청·일정·위치·매뉴얼)
//   · 위치 — '@김포', '@본사' (재고·수불·이력·전표·스케줄의 위치·거점)
//   · 날짜 — '오늘' '어제' '이번주' '지난주' '이번달' '지난달' '올해', '9/28', '2026-09-28', '9/1~9/30'
//   · 수량 — '>100', '<=50' (재고·수불·이력·전표 수량)
import { state, listSlipsRange } from './db.js';
import { canAccessTab } from './auth.js';
import { localDateStr, toDateKey } from './searchUtils.js';
import { locationLabel } from './locations.js';
import { listPlans, reqTypeOf, REQ_STATUS } from './plans.js';
import { listProdDates, listProdSchedule, PROD_STATUS } from './prodSchedule.js';
import { TAB_META } from '../components/navMenu.js';

export const CATS = {
    MENU: { label: '메뉴', icon: 'layout-grid', tab: null },
    ITEM: { label: '품목', icon: 'package', tab: 'master' },
    STOCK: { label: '재고', icon: 'database', tab: 'inventory' },
    LEDGER: { label: '수불부', icon: 'book-open-check', tab: null },
    HIST: { label: '입출고 이력', icon: 'history', tab: 'history' },
    SLIP: { label: '전표', icon: 'file-signature', tab: 'slipManage' },
    SCHED: { label: '생산 스케줄', icon: 'calendar-range', tab: 'prodSchedule' },
    REQ: { label: '요청서', icon: 'file-input', tab: 'prodRequest' },
    CAL: { label: '일정', icon: 'calendar', tab: 'calendar' },
    LOC: { label: '위치', icon: 'map-pin', tab: 'inventory' },
    MANUAL: { label: '매뉴얼', icon: 'book-open', tab: 'manual' }
};
const CAT_WORDS = { 메뉴: 'MENU', 화면: 'MENU', 품목: 'ITEM', 재고: 'STOCK', 수불: 'LEDGER', 수불부: 'LEDGER', 이력: 'HIST', 입출고: 'HIST', 전표: 'SLIP',
    스케줄: 'SCHED', 생산스케줄: 'SCHED', 요청: 'REQ', 요청서: 'REQ', 일정: 'CAL', 캘린더: 'CAL', 위치: 'LOC', 창고: 'LOC', 매뉴얼: 'MANUAL', 도움말: 'MANUAL' };
// 화면 메뉴에서 빼는 탭 (보안)
const HIDDEN_TABS = ['secureWorkOrders'];

// ---------- 글자 다루기 ----------
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
export const chosungOf = (s) => String(s || '').replace(/[가-힣]/g, c => CHO[Math.floor((c.charCodeAt(0) - 0xAC00) / 588)]);
const isChoToken = (t) => /^[ㄱ-ㅎ]+$/.test(t);
const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_/\\,.()[\]'"`:;·]/g, '');

// ---------- 날짜 ----------
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return localDateStr(x); };
const weekStartOf = (d) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return localDateStr(x); };
const parseDay = (t, year) => {
    let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = t.match(/^(\d{1,2})[/.-](\d{1,2})$/);
    if (m && Number(m[1]) <= 12 && Number(m[2]) <= 31) return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return '';
};
export const dateRangeOf = (word, today = localDateStr()) => {
    const y = today.slice(0, 4);
    const ym = today.slice(0, 7);
    const lastMonth = (() => { const d = new Date(`${ym}-01T00:00:00`); d.setMonth(d.getMonth() - 1); return localDateStr(d).slice(0, 7); })();
    const endOf = (m) => { const [yy, mm] = m.split('-').map(Number); return `${m}-${String(new Date(yy, mm, 0).getDate()).padStart(2, '0')}`; };
    const W = {
        오늘: [today, today], 어제: [addDays(today, -1), addDays(today, -1)], 내일: [addDays(today, 1), addDays(today, 1)],
        이번주: [weekStartOf(today), addDays(weekStartOf(today), 6)], 지난주: [addDays(weekStartOf(today), -7), addDays(weekStartOf(today), -1)],
        다음주: [addDays(weekStartOf(today), 7), addDays(weekStartOf(today), 13)],
        이번달: [`${ym}-01`, endOf(ym)], 지난달: [`${lastMonth}-01`, endOf(lastMonth)], 올해: [`${y}-01-01`, `${y}-12-31`]
    };
    if (W[word]) return W[word];
    const range = word.split('~');
    if (range.length === 2) {
        const a = parseDay(range[0], y), b = parseDay(range[1], y);
        if (a && b) return [a, b];
    }
    const d = parseDay(word, y);
    return d ? [d, d] : null;
};

/** 검색어 → { tokens, cats, loc, from, to, qty } */
export const parseQuery = (q, today = localDateStr()) => {
    const out = { tokens: [], cats: [], loc: '', from: '', to: '', qty: null };
    String(q || '').trim().split(/\s+/).filter(Boolean).forEach(raw => {
        const cat = raw.match(/^([가-힣]+):(.*)$/);
        if (cat && CAT_WORDS[cat[1]]) { out.cats.push(CAT_WORDS[cat[1]]); if (cat[2]) out.tokens.push(cat[2]); return; }
        if (raw.startsWith('@') && raw.length > 1) { out.loc = raw.slice(1); return; }
        const cmp = raw.match(/^(>=|<=|>|<|=)(\d+(?:\.\d+)?)$/);
        if (cmp) { out.qty = { op: cmp[1], n: Number(cmp[2]) }; return; }
        const r = dateRangeOf(raw, today);
        if (r) { [out.from, out.to] = r; return; }
        out.tokens.push(raw);
    });
    return out;
};

// ---------- 자료 모으기 ----------
const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const doc = (cat, id, o) => ({ cat, id: `${cat}:${id}`, ...o, _t: norm([o.title, o.sub, o.meta, o.extra].join(' ')), _raw: [o.title, o.sub, o.meta, o.extra].join(' ') });

const localDocs = () => {
    const out = [];
    const can = (tab) => !tab || canAccessTab(tab);
    // 메뉴
    Object.entries(TAB_META).forEach(([tab, m]) => {
        if (HIDDEN_TABS.includes(tab) || !canAccessTab(tab)) return;
        out.push(doc('MENU', tab, { title: m.label, sub: m.desc, icon: m.icon, open: { tab } }));
    });
    // 품목 (원료코드·단가 제외)
    if (can('master') || can('inventory')) state.master.forEach(m => {
        out.push(doc('ITEM', m.code, { title: m.name, code: m.code, sub: [m.code, m.spec, m.category, m.subCategory].filter(x => x && x !== '-').join(' · '), meta: m.supplier && m.supplier !== '-' ? m.supplier : '', extra: m.barcode || '', item: m.code }));
    });
    // 재고 (위치별)
    if (can('inventory')) state.inventory.forEach(i => {
        if (!(Number(i.quantity) > 0)) return;
        out.push(doc('STOCK', `${i.code}@${i.location}`, { title: i.name, code: i.code, sub: `${i.code} · ${locationLabel(i.location)}`, meta: `${fmt(i.quantity)} ${i.unit || ''}`, loc: `${i.location} ${locationLabel(i.location)}`, qty: Number(i.quantity), item: i.code, extra: i.status }));
    });
    // 수불부 (원료·제품·자재) — 원료코드(rawCode)·단가는 넣지 않는다
    [['rawLedger', '원료', 'rawLedger'], ['productLedger', '제품', 'productLedger'], ['materialLedger', '자재', 'ledger']].forEach(([key, label, tab]) => {
        if (!can(tab)) return;
        (state[key] || []).forEach(e => {
            const q = Number(e.inQty) || -Number(e.outQty) || 0;
            out.push(doc('LEDGER', `${key}:${e.id}`, {
                title: e.name, code: e.code, badge: `${label}수불부`, date: toDateKey(e.date),
                sub: [e.code, e.type, e.location ? locationLabel(e.location) : ''].filter(Boolean).join(' · '),
                meta: `${e.inQty ? `입고 ${fmt(e.inQty)}` : ''}${e.outQty ? `출고 ${fmt(e.outQty)}` : ''}${e.stockQty !== undefined ? ` · 재고 ${fmt(e.stockQty)}` : ''}`,
                extra: [e.manufacturer, e.notes, e.remark, e.worker, e.partner, e.lot].filter(Boolean).join(' '),
                loc: e.location || '', qty: Math.abs(q), item: e.code, open: { tab, search: e.code || e.name }
            }));
        });
    });
    // 입출고 이력
    if (can('history')) (state.history || []).forEach(h => {
        const T = { IN: '입고', OUT: '출고', MOVE: '이동', USE: '생산투입', PROD: '생산입고', ADJUST: '조정' }[h.type] || h.type;
        out.push(doc('HIST', h.id || `${h.timestamp}${h.code}`, {
            title: `${h.name}`, code: h.code, badge: T, date: toDateKey(h.timestamp),
            sub: `${h.code || ''} · ${[h.fromLoc, h.toLoc].filter(x => x && x !== '-').map(locationLabel).join(' → ')}`,
            meta: `${fmt(h.qty)} · ${h.worker || ''}`, extra: `${T} ${h.reason && h.reason !== '-' ? h.reason : ''}`,
            loc: `${h.fromLoc} ${h.toLoc}`, qty: Number(h.qty), item: h.code, open: { tab: 'history', search: h.code || h.name }
        }));
    });
    // 일정
    if (can('calendar')) (state.schedules || []).forEach(s => {
        out.push(doc('CAL', s.id, { title: s.title, date: s.date, badge: { IN_PLAN: '입고예정', OUT_PLAN: '출고예정', PROD_PLAN: '생산예정' }[s.type] || '일정',
            sub: `${s.date}${s.startTime ? ` ${s.startTime}` : ''} · ${s.calendar === 'GIMPO' ? '김포' : '본사'}`, meta: [s.partner, s.worker, s.assigneeName].filter(Boolean).join(' · '),
            extra: [s.itemName, s.itemCode, s.notes].filter(Boolean).join(' '), loc: s.calendar === 'GIMPO' ? '김포' : '본사', open: { tab: 'calendar' } }));
    });
    // 위치
    if (can('inventory')) (state.locations || []).forEach(l => {
        const items = state.inventory.filter(i => i.location === l && Number(i.quantity) > 0);
        out.push(doc('LOC', l, { title: locationLabel(l), sub: `재고 품목 ${items.length}개`, loc: `${l} ${locationLabel(l)}`, location: l }));
    });
    return out;
};

// 매뉴얼 (처음 쓸 때 받음)
let manualDocs = null;
const loadManual = async () => {
    if (manualDocs) return manualDocs;
    const { MANUALS } = await import('../data/manualContent.js');
    manualDocs = [];
    MANUALS.forEach(m => m.chapters.forEach(c => {
        if (HIDDEN_TABS.includes(c.tab)) return;
        const body = (c.sections || []).map(s => [s.title, ...(s.steps || []), ...(s.tips || [])].join(' ')).join(' ').replace(/[`*]/g, '');
        manualDocs.push(doc('MANUAL', `${m.id}:${c.id}`, { title: c.title, sub: c.part, meta: String(c.menu || '').replace(/`/g, ''), extra: `${c.summary || ''} ${body}`.slice(0, 3000), open: { manual: m.id, chapter: c.id } }));
    }));
    return manualDocs;
};

// 클라우드 자료 (전표·요청서·생산 스케줄) — 2분 동안 다시 받지 않는다
let remote = { at: 0, docs: [], promise: null };
const loadRemote = async () => {
    if (Date.now() - remote.at < 120000) return remote.docs;
    if (remote.promise) return remote.promise;
    remote.promise = (async () => {
        const today = localDateStr();
        const from = addDays(today, -365);
        const out = [];
        const tasks = [];
        if (canAccessTab('slipManage')) tasks.push(listSlipsRange({ from }).then(list => list.forEach(s => {
            const kind = { RELEASE: '출고요청서', TRANSFER: '이동전표', WAREHOUSE: '창고간 이동' }[s.type] || '전표';
            const it = s.items || [];
            out.push(doc('SLIP', s.docNo, { title: `${s.docNo} ${s.partner || ''}`.trim(), badge: kind, date: s.date,
                sub: `${s.date} · ${locationLabel(s.fromLoc) || '-'} → ${s.toLoc === '외부 거래처' ? (s.partner || '외부') : locationLabel(s.toLoc) || '-'}${s.shippedAt ? ' · 출고완료' : ''}`,
                meta: `${it[0]?.name || ''}${it.length > 1 ? ` 외 ${it.length - 1}` : ''}`, extra: [...it.map(x => `${x.code} ${x.name}`), s.reason, s.worker, s.assigneeName].join(' '),
                loc: `${s.fromLoc} ${s.toLoc}`, qty: it.reduce((n, x) => n + (Number(x.qty) || 0), 0), slip: s }));
        })).catch(() => {}));
        [['PROD_REQ', 'prodRequest'], ['PURCH_REQ', 'purchRequest']].forEach(([kind, tab]) => {
            if (!canAccessTab(tab)) return;
            tasks.push(listPlans(kind, from, '9999').then(list => list.filter(r => r.docNo).forEach(r => {
                const t = reqTypeOf(r);
                const ls = (r.lines || []).filter(l => l.code || l.name);
                out.push(doc('REQ', r.id, { title: `${r.docNo} ${r.partner || ''}`.trim(), badge: t === 'PURCH' ? '구매요청서' : t === 'RAW' ? '원액생산요청서' : '제품생산요청서', date: r.reqDate || r.period,
                    sub: `요청 ${r.reqDate || r.period} · ${t === 'PURCH' ? '필요일' : '납기'} ${r.dueDate || '-'} · ${REQ_STATUS[r.status] || r.status}`,
                    meta: `${ls[0]?.name || ''}${ls.length > 1 ? ` 외 ${ls.length - 1}` : ''}`, extra: [...ls.map(l => `${l.code} ${l.name} ${l.supplier || ''}`), r.requester, r.assigneeName, r.orderNo, r.reason].join(' '),
                    loc: r.site || '', req: { id: r.id, type: t, month: String(r.reqDate || r.period).slice(0, 7), tab } }));
            })).catch(() => {}));
        });
        if (canAccessTab('prodSchedule')) tasks.push(listProdDates().then(async dates => {
            const d = dates[0]?.date; if (!d) return;
            (await listProdSchedule(d)).forEach(x => out.push(doc('SCHED', x.id, { title: x.itemName, badge: PROD_STATUS[x.status]?.label || x.status, date: x.planDate || x.dueDate || d,
                sub: `${x.site}${x.line ? ` · ${x.line}` : ''} · ${fmt(x.qty)}ea${x.dueText || x.dueDate ? ` · 납품 ${x.dueText || x.dueDate}` : ''}`,
                meta: [x.partner, x.manager].filter(Boolean).join(' · '), extra: [x.itemCode, x.lotNo, x.notes, x.container, `작성일자 ${d}`].filter(Boolean).join(' '),
                loc: x.site, qty: Number(x.qty) || 0, item: x.itemCode, schedId: x.id })));
        }).catch(() => {}));
        await Promise.all(tasks);
        remote = { at: Date.now(), docs: out, promise: null };
        return out;
    })();
    return remote.promise;
};
export const refreshRemote = () => { remote.at = 0; };

/** 모든 문서 (local은 매번, 매뉴얼·클라우드는 캐시) */
export const collectDocs = async ({ withRemote = true } = {}) => {
    const [man, rem] = await Promise.all([loadManual().catch(() => []), withRemote ? loadRemote() : Promise.resolve(remote.docs)]);
    return [...localDocs(), ...man, ...rem];
};

// ---------- 검색 ----------
const cmpOk = (v, c) => (c.op === '>' ? v > c.n : c.op === '<' ? v < c.n : c.op === '>=' ? v >= c.n : c.op === '<=' ? v <= c.n : v === c.n);
// 같은 점수면 품목·재고·메뉴가 먼저
const CAT_BONUS = { MENU: 15, ITEM: 20, STOCK: 15, SLIP: 8, REQ: 8, SCHED: 5, LOC: 5 };
const CAT_ORDER = ['MENU', 'ITEM', 'STOCK', 'SLIP', 'REQ', 'SCHED', 'LEDGER', 'HIST', 'CAL', 'LOC', 'MANUAL'];

/**
 * @param docs collectDocs() 결과
 * @param q 검색어 (문법은 파일 머리말)
 * @param opt { cats: string[] (칩으로 고른 분류), from, to (기간 칩) }
 * @returns { parsed, hits: [{ ...doc, score }], counts: { CAT: n } }
 */
export const searchDocs = (docs, q, opt = {}) => {
    const p = parseQuery(q);
    const cats = p.cats.length ? p.cats : (opt.cats || []);
    const from = p.from || opt.from || '', to = p.to || opt.to || '';
    const toks = p.tokens.map(t => ({ raw: t.toLowerCase(), n: norm(t), cho: isChoToken(t) }));
    const locN = norm(p.loc);
    const empty = !toks.length && !p.loc && !from && p.qty === null;
    const counts = {};
    const hits = [];
    if (empty) return { parsed: p, hits, counts };
    for (const d of docs) {
        if (cats.length && !cats.includes(d.cat)) continue;
        if (locN && !norm(d.loc || '').includes(locN)) continue;
        if (from || to) { if (!d.date || (from && d.date < from) || (to && d.date > to)) continue; }
        if (p.qty && (d.qty === undefined || !cmpOk(d.qty, p.qty))) continue;
        let score = 0;
        let ok = true;
        for (const t of toks) {
            // 초성은 제목(품명·번호)에서만 찾는다 (본문까지 보면 너무 많이 걸림)
            if (t.cho) { d._c = d._c || chosungOf(d.title).replace(/\s+/g, ''); if (!d._c.includes(t.raw)) { ok = false; break; } score += d._c.startsWith(t.raw) ? 50 : 30; continue; }
            if (!t.n || !d._t.includes(t.n)) { ok = false; break; }
            const code = norm(d.code), title = norm(d.title);
            score += code && code === t.n ? 100 : code && code.startsWith(t.n) ? 70 : title.startsWith(t.n) ? 60 : title.includes(t.n) ? 40 : 10;
        }
        if (!ok) continue;
        // 최근 것 조금 위로
        if (d.date) score += Math.max(0, 10 - Math.floor((Date.now() - new Date(`${d.date}T00:00:00`).getTime()) / (30 * 86400000)));
        score += CAT_BONUS[d.cat] || 0;
        counts[d.cat] = (counts[d.cat] || 0) + 1;
        hits.push({ ...d, score });
    }
    hits.sort((a, b) => b.score - a.score || CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat) || String(b.date || '').localeCompare(String(a.date || '')));
    return { parsed: p, hits, counts };
};

/** 품목 한 개 상세 (재고 위치별 + 최근 수불·이력) */
export const itemDetail = (code) => {
    const m = state.master.find(x => x.code === code);
    const stock = state.inventory.filter(i => i.code === code && Number(i.quantity) > 0);
    const moves = [];
    [['rawLedger', '원료'], ['productLedger', '제품'], ['materialLedger', '자재']].forEach(([k, label]) => (state[k] || []).forEach(e => {
        if (e.code === code) moves.push({ date: toDateKey(e.date), kind: `${label}수불부 ${e.type || ''}`, qty: e.inQty ? `+${fmt(e.inQty)}` : e.outQty ? `-${fmt(e.outQty)}` : '', note: [e.location ? locationLabel(e.location) : '', e.notes || e.remark || ''].filter(Boolean).join(' · ') });
    }));
    (state.history || []).forEach(h => { if (h.code === code) moves.push({ date: toDateKey(h.timestamp), kind: `이력 ${h.type}`, qty: fmt(h.qty), note: [h.fromLoc, h.toLoc].filter(x => x && x !== '-').map(locationLabel).join(' → ') }); });
    moves.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { item: m ? { code: m.code, name: m.name, spec: m.spec, category: m.category, subCategory: m.subCategory, unit: m.unit, supplier: m.supplier } : null, stock, moves: moves.slice(0, 15) };
};
