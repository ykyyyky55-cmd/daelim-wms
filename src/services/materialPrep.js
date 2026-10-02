// ==========================================
// 생산계획 자재 준비 자동화 (포장사용기준서 = 제품 BOM 기준)
// ==========================================
// 앞으로 N일(기본 14일)의 완제품 생산계획 줄을 보고 원액·부자재 소요량을 날짜순으로 맞춘다.
//   1) 그 거점 포장라인(PACK_LINE)에 있는 재고 + 건물이 정해지지 않은 거점 재고를 먼저 쓴다
//   2) 모자라면 같은 거점 다른 창고(건물) 재고를 포장라인으로 옮기는 '창고간 이동' 업무를 그 날짜 일일 계획(dayTasks '<날짜>|전체')에 넣는다
//      (auto 'MAT', slipType 'WAREHOUSE' — 배포하면 창고간 이동전표 WT 발행, components/plans/dayTasks.js)
//   3) 그래도 모자라면(이미 계획된 원액 생산·구매 공급 제외) 부자재·원료 → 구매요청서, 원액 → 원액생산요청서를 자동 작성
//      (거점별 하나, sourceKey 'AUTO-MAT:<거점>:PURCH|RAW', 요청 상태일 때만 수량을 고침) → services/planAuto.js reflectRequest로 계획에 반영
//      새 구매요청이 생기면 구매 담당(PURCHASER)에게 1:1 메시지
// 주간 계획을 쓰므로 계획 편집 권한(MRP_PLANNING)이 있을 때만 돈다.
import { state } from './db.js';
import { loadWeek, savePlan, weekStart, addDays, getBoms, loadBoms, saveRequest, REQ_TYPES, round3, listPlans } from './plans.js';
import { reflectRequest } from './planAuto.js';
import { localDateStr } from './searchUtils.js';
import { siteOf, buildingOf, locationLabel } from './locations.js';
import { listPeople } from './assign.js';
import { sendMessage, dmRoom, myChatId } from './chat.js';
import { canPerformAction } from './auth.js';

// 포장라인 위치 (창고코드 조견표: 본사1A = 본사 1층 제조 포장실, 김포1B = 김포1공장 포장동)
export const PACK_LINE = { 본사: '본사 / 본사1A', 김포: '김포공장 / 김포1B' };
const INV_SITE = { 본사: '본사', 김포: '김포공장' };
const PURCHASER = '전유진'; // 조직도: 생산공급망팀 본사 운영부 구매 책임
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const hash = (s) => { let h = 0; for (const c of String(s)) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };

let lastRun = 0;
let running = null;

/**
 * @returns { transfers, purchase, raw, messages } 바뀐 것 요약 (권한 없으면 null)
 */
export const prepareMaterials = async ({ days = 14, force = false, notify = true } = {}) => {
    if (!canPerformAction('MRP_PLANNING')) return null;
    if (running) return running;
    if (!force && Date.now() - lastRun < 5 * 60 * 1000) return null;
    running = (async () => {
        await loadBoms().catch(() => {});
        const boms = getBoms();
        const today = localDateStr();
        const end = addDays(today, days - 1);
        const weeks = [];
        for (let w = weekStart(today); w <= end; w = addDays(w, 7)) weeks.push(w);
        const prodDocs = new Map();
        for (const w of weeks) prodDocs.set(w, await loadWeek('PROD_WEEK', w));
        const purchDocs = await Promise.all(weeks.map(w => loadWeek('PURCH_WEEK', w)));
        const active = (l) => l.status !== 'DONE' && l.status !== 'HOLD';
        const prodLines = [...prodDocs.values()].flatMap(d => d.lines || []).filter(l => active(l) && l.date >= today && l.date <= end);
        const purchLines = purchDocs.flatMap(d => d.lines || []).filter(l => l.status !== 'RECEIVED' && l.status !== 'HOLD');
        const reqs = {
            PURCH: (await listPlans('PURCH_REQ', addDays(today, -60), '9999').catch(() => [])),
            RAW: (await listPlans('PROD_REQ', addDays(today, -60), '9999').catch(() => []))
        };
        const out = { transfers: 0, purchase: [], raw: [], messages: [], errors: [] };

        for (const site of Object.keys(PACK_LINE)) {
            const line = PACK_LINE[site];
            const invSite = INV_SITE[site];
            // 소요: code → [{ date, qty }]
            const need = new Map();
            prodLines.filter(l => l.site === site && l.type !== '원액' && l.code && Number(l.qty) > 0).forEach(l => {
                const b = boms[l.code];
                const qty = Number(l.qty) - (Number(l.doneQty) || 0);
                if (!b || !(qty > 0)) return;
                [...(b.rawList || []), ...(b.subList || [])].forEach(x => {
                    if (!x.code || !(Number(x.rate) > 0)) return;
                    if (!need.has(x.code)) need.set(x.code, []);
                    need.get(x.code).push({ date: l.date, qty: round3(Number(x.rate) * qty) });
                });
            });
            const autoKey = (k) => `AUTO-MAT:${site}:${k}`;
            // 아직 사람이 접수·완료하지 않은 자동 요청서 (등록하면 계획에 반영되어 '계획반영'이 된다)
            const editable = (r, k) => r.sourceKey === autoKey(k) && ['REQUESTED', 'PLANNED'].includes(r.status);
            const autoReq = { PURCH: reqs.PURCH.find(r => editable(r, 'PURCH')), RAW: reqs.RAW.find(r => editable(r, 'RAW')) };
            const transfers = []; // { date, from, code, qty }
            const shorts = { PURCH: [], RAW: [] };
            for (const [code, list] of need) {
                list.sort((a, b) => a.date.localeCompare(b.date));
                const inv = state.inventory.filter(i => i.code === code && siteOf(i.location) === invSite && Number(i.quantity) > 0);
                let atLine = inv.filter(i => i.location === line || !buildingOf(i.location)).reduce((s, i) => s + Number(i.quantity), 0);
                const others = inv.filter(i => i.location !== line && buildingOf(i.location)).map(i => ({ loc: i.location, qty: Number(i.quantity) })).sort((a, b) => b.qty - a.qty);
                let short = 0; let firstShort = '';
                for (const n of list) {
                    let rem = n.qty;
                    const use = Math.min(rem, atLine); atLine -= use; rem = round3(rem - use);
                    for (const o of others) {
                        if (rem <= 0) break;
                        const mv = Math.min(rem, o.qty);
                        if (mv <= 0) continue;
                        o.qty -= mv; rem = round3(rem - mv);
                        transfers.push({ date: n.date, from: o.loc, code, qty: round3(mv) });
                    }
                    if (rem > 0) { short = round3(short + rem); if (!firstShort) firstShort = n.date; }
                }
                if (short <= 0) continue;
                const m = state.master.find(x => x.code === code) || { code, name: code };
                const kind = m.category === '원액' ? 'RAW' : 'PURCH';
                // 이미 계획된 공급(자동 요청서 자기 줄은 빼고): 원액 생산계획 줄 / 구매계획 줄
                const own = autoReq[kind] ? `${kind === 'RAW' ? 'REQ' : 'PREQ'}:${autoReq[kind].id}:` : '\u0000';
                const planned = kind === 'RAW'
                    ? [...prodDocs.values()].flatMap(d => d.lines || []).filter(l => active(l) && l.type === '원액' && l.code === code && l.site === site && !String(l.ref || '').startsWith(own)).reduce((s, l) => s + (Number(l.qty) || 0), 0)
                    : purchLines.filter(l => l.code === code && l.site === site && !String(l.ref || '').startsWith(own)).reduce((s, l) => s + (Number(l.qty) || 0), 0);
                const net = round3(short - planned);
                if (net > 0) shorts[kind].push({ code, name: m.name || code, spec: m.spec && m.spec !== '-' ? m.spec : '', unit: m.unit || (kind === 'RAW' ? 'L' : 'EA'), supplier: m.supplier || '', qty: kind === 'RAW' ? round3(net) : Math.ceil(net), firstDate: firstShort });
            }

            // ---- 1) 창고간 이동 업무 (날짜·출발 창고별 하나) ----
            const groups = new Map();
            transfers.forEach(t => { const k = `${t.date}|${t.from}`; if (!groups.has(k)) groups.set(k, { date: t.date, from: t.from, items: [] }); const g = groups.get(k); const ex = g.items.find(i => i.code === t.code); if (ex) ex.qty = round3(ex.qty + t.qty); else g.items.push({ code: t.code, qty: t.qty }); });
            const touched = new Set();
            for (const w of weeks) {
                const doc = prodDocs.get(w);
                let changed = false;
                if (!doc.dayTasks || typeof doc.dayTasks !== 'object') doc.dayTasks = {};
                const days7 = Array.from({ length: 7 }, (_, i) => addDays(w, i)).filter(d => d >= today && d <= end);
                for (const d of days7) {
                    const key = `${d}|전체`;
                    const entry = doc.dayTasks[key] || { tasks: [], dist: null };
                    const before = JSON.stringify(entry.tasks.filter(t => t.auto === 'MAT' && t.matSite === site));
                    // 아직 전표를 발행하지 않은 자동 이동 업무는 지금 계산으로 바꾼다 (발행된 것은 그대로)
                    const issued = entry.tasks.filter(t => t.auto === 'MAT' && t.matSite === site && t.slipNo);
                    entry.tasks = entry.tasks.filter(t => !(t.auto === 'MAT' && t.matSite === site && !t.slipNo));
                    [...groups.values()].filter(g => g.date === d && !issued.some(t => t.slip?.from === g.from)).forEach(g => {
                        const items = g.items.map(i => { const m = state.master.find(x => x.code === i.code) || {}; return { code: i.code, name: m.name || i.code, spec: m.spec && m.spec !== '-' ? m.spec : '', qty: i.qty, unit: m.unit || 'EA' }; });
                        entry.tasks.push({
                            id: `MAT${hash(`${d}${site}${g.from}`)}`, sec: 'movement', auto: 'MAT', matSite: site, slipType: 'WAREHOUSE',
                            text: `${locationLabel(g.from)} → ${locationLabel(line)} 자재 이동 · ${items[0].name} ${fmt(items[0].qty)}${items[0].unit}${items.length > 1 ? ` 외 ${items.length - 1}품목` : ''}`,
                            time: '', people: [], note: '생산계획 자재 준비 (자동)', slip: { from: g.from, to: line, partner: '', items }
                        });
                        out.transfers += 1;
                    });
                    const after = JSON.stringify(entry.tasks.filter(t => t.auto === 'MAT' && t.matSite === site));
                    if (before !== after) { changed = true; if (entry.tasks.length || entry.dist) doc.dayTasks[key] = entry; else delete doc.dayTasks[key]; }
                }
                if (changed) touched.add(w);
            }
            for (const w of touched) {
                try { prodDocs.set(w, await savePlan(prodDocs.get(w))); } catch (e) { out.errors.push(`${w} 이동 업무 저장: ${e.message}`); }
            }

            // ---- 2) 부족 → 구매요청서 / 원액생산요청서 (거점별 자동 요청서 하나) ----
            for (const kind of ['PURCH', 'RAW']) {
                const list = shorts[kind];
                const ex = autoReq[kind];
                const lines = list.map(s => ({ id: `AL${hash(s.code)}`, code: s.code, name: s.name, spec: s.spec, qty: s.qty, unit: s.unit, pack: '', supplier: s.supplier, price: '', note: `생산계획 부족 (${s.firstDate} 필요)` }));
                const first = list.map(s => s.firstDate).sort()[0] || today;
                const sig = (ls) => JSON.stringify((ls || []).map(l => [l.code, Number(l.qty)]).sort());
                try {
                    let req = null;
                    if (ex) {
                        if (!list.length) req = await savePlan({ ...ex, status: 'REJECTED', reviewNote: `부족 해소 (${today} 자동 확인)` });
                        else if (sig(ex.lines) !== sig(lines)) req = await savePlan({ ...ex, lines, dueDate: first, planDate: kind === 'RAW' ? (addDays(first, -1) < today ? today : addDays(first, -1)) : ex.planDate });
                    } else if (list.length) {
                        const T = REQ_TYPES[kind];
                        req = await saveRequest({
                            kind: T.kind, reqType: T.reqType, reqDate: today, dueDate: first, planDate: kind === 'RAW' ? (addDays(first, -1) < today ? today : addDays(first, -1)) : '',
                            site, dept: '생산공급망팀', requester: '자재 자동확인', partner: kind === 'PURCH' ? '생산계획 부자재' : '', moveTo: kind === 'RAW' ? line : '',
                            urgent: first <= addDays(today, 2), reason: `생산계획(${today}~${end}) 포장사용기준서 소요 대비 ${site} 재고·계획 공급이 모자랍니다 (자동 작성).`,
                            status: 'REQUESTED', reviewNote: '', lines, sourceKey: autoKey(kind)
                        }, T);
                        if (kind === 'PURCH') out.messages.push(req);
                    }
                    if (req) {
                        const r = await reflectRequest(req).catch(e => { out.errors.push(`${req.docNo} 계획 반영: ${e.message}`); return null; });
                        (kind === 'PURCH' ? out.purchase : out.raw).push({ site, docNo: req.docNo, count: list.length, removed: req.status === 'REJECTED', monday: r?.monday });
                    }
                } catch (e) { out.errors.push(`${site} ${kind === 'PURCH' ? '구매' : '원액생산'}요청: ${e.message}`); }
            }
        }

        // ---- 3) 새 구매요청 → 구매 담당 메시지 ----
        if (notify && out.messages.length) {
            try {
                const people = await listPeople();
                const buyer = people.find(p => p.name === PURCHASER);
                if (buyer && String(buyer.id) !== String(myChatId())) {
                    for (const r of out.messages) {
                        const body = [`📦 [발주요청] 생산계획 자재 부족 — 구매요청서 ${r.docNo} (${r.site})`, ...r.lines.slice(0, 10).map(l => `· ${l.name} ${fmt(l.qty)}${l.unit} (${String(l.note).replace(/^생산계획 부족 /, '')})`), r.lines.length > 10 ? `· 외 ${r.lines.length - 10}품목` : '', '→ 주문·계획 › 구매요청서에서 확인하세요.'].filter(Boolean).join('\n');
                        await sendMessage(dmRoom(myChatId(), buyer.id), body.slice(0, 3900));
                    }
                }
            } catch (e) { out.errors.push(`구매 담당 알림: ${e.message}`); }
        }
        lastRun = Date.now();
        return out;
    })();
    try { return await running; } finally { running = null; }
};

export const prepSummary = (r) => !r ? '' : [
    r.transfers ? `창고간 이동 ${r.transfers}건 → 일일 계획` : '',
    r.purchase.filter(x => !x.removed).length ? `구매요청 ${r.purchase.filter(x => !x.removed).map(x => `${x.docNo}(${x.site} ${x.count}품목)`).join(', ')}` : '',
    r.raw.filter(x => !x.removed).length ? `원액생산요청 ${r.raw.filter(x => !x.removed).map(x => `${x.docNo}(${x.site} ${x.count}품목)`).join(', ')} → 생산계획` : '',
    [...r.purchase, ...r.raw].filter(x => x.removed).length ? `부족 해소로 자동 요청 ${[...r.purchase, ...r.raw].filter(x => x.removed).length}건 취소` : ''
].filter(Boolean).join(' · ');
