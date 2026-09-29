// ==========================================
// 생산요청서 → 생산(포장) 스케줄 · 일정관리(캘린더) 자동 반영
// ==========================================
// services/planAuto.js reflectRequest(요청서 등록·수정·반려 뒤)가 주간 생산계획에 이어 부른다.
// · 생산(포장) 스케줄: 제품생산요청서만 (원액생산요청서는 포장 스케줄 대상이 아님). 최신 작성일자에 품목 줄마다 한 줄,
//   req_ref 'REQ:<요청서id>:<품목코드(없으면 품명)>#<같은 품목 몇 번째>'(supabase/auth/60_prod_schedule_req_ref.sql)로 다시 저장하면
//   같은 줄을 고친다. 순번으로 잇지 않는다 — 앞 품목을 지우면 뒤 품목이 앞 품목의 줄을 덮어썼음.
//   생산을 시작한 줄(생산중·완료·출고)은 건드리지 않고, 계획을 스케줄에서 잡은 줄(생산 예정일)은 그대로 둔다.
//   반려·요청서에서 뺀 줄은 지울 권한(매니저)이 없을 수 있어 '미정·보류'로 돌리고 비고에 표시한다.
// · 캘린더: 제품·원액 생산요청서 모두 요청서당 일정 하나(id 'SCHED-REQ-<요청서id>', 구분 생산예정 PROD_PLAN),
//   날짜 = 생산 예정일 → 납기 → 요청일, 캘린더 = 거점(김포 → 김포, 그 밖 → 본사). 반려하면 지운다.
import { state, saveSchedule, deleteSchedule } from './db.js';
import { listProdDates, listProdSchedule, saveProdRows, newProdId } from './prodSchedule.js';
import { localDateStr } from './searchUtils.js';
import { locationLabel } from './locations.js';

const EDITABLE = ['HOLD', 'PLANNED', 'PREP']; // 생산 시작 전 줄만 요청서대로 고친다
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const reqLines = (r) => (r.lines || []).filter(l => l.code || l.name);
const specOf = (l) => l.spec || state.master.find(m => m.code === l.code)?.spec || '';
const unitOf = (r, l) => l.unit || state.master.find(m => m.code === l.code)?.unit || (r.reqType === 'RAW' ? 'L' : 'EA');
const partnerOf = (r) => r.partner || (r.moveTo ? `→ ${locationLabel(r.moveTo)}` : '');
const HOLD_MARK = /^\[(요청 반려|요청서에서 삭제)\]/;

/**
 * 제품생산요청서 → 최신 작성일자 생산(포장) 스케줄
 * @returns {Promise<{sheetDate: string, added: number, updated: number, held: number} | null>}
 */
export const syncRequestToSchedule = async (r) => {
    if (r?.kind !== 'PROD_REQ' || r.reqType === 'RAW' || r.status === 'DONE') return null;
    const active = r.status !== 'REJECTED';
    const prefix = `REQ:${r.id}:`;
    const dates = await listProdDates();
    const sheetDate = dates[0]?.date || localDateStr();
    const rows = await listProdSchedule(sheetDate);
    const mine = rows.filter(x => String(x.reqRef || '').startsWith(prefix));
    const lines = reqLines(r);
    const seen = {};
    const refs = lines.map(l => {
        const k = String(l.code || l.name).trim();
        seen[k] = (seen[k] || 0) + 1;
        return `${prefix}${k}#${seen[k]}`;
    });
    const out = { sheetDate, added: 0, updated: 0, held: 0 };
    let sort = Math.max(0, ...rows.map(x => Number(x.sort) || 0));
    const list = [];
    const hold = (x, why) => {
        if (!EDITABLE.includes(x.status) || HOLD_MARK.test(x.notes || '')) return;
        list.push({ ...x, status: 'HOLD', notes: `[${why}] ${x.notes || ''}`.trim() });
        out.held += 1;
    };
    lines.forEach((l, i) => {
        const ref = refs[i];
        const ex = mine.find(x => x.reqRef === ref);
        if (!active) { if (ex) hold(ex, '요청 반려'); return; }
        const base = {
            itemCode: l.code || '', itemName: l.name || l.code, spec: specOf(l), qty: Number(l.qty) || '', site: r.site === '김포' ? '김포' : '본사',
            partner: partnerOf(r), manager: r.requester || '', orderDate: r.reqDate || '', dueDate: r.dueDate || '', dueText: r.dueDate || '',
            notes: [`생산요청서 ${r.docNo}`, r.urgent ? '긴급' : '', l.note || '', r.reason || ''].filter(Boolean).join(' · '),
            assigneeId: r.assigneeId || '', assigneeName: r.assigneeName || '', reqRef: ref
        };
        if (ex) {
            if (!EDITABLE.includes(ex.status)) return;
            // 생산 예정일은 스케줄에서 잡았으면 그대로, 비었을 때만 요청서 값
            const plan = ex.planDate || ex.planText ? {} : { planDate: r.planDate || '', planText: r.planDate || '' };
            const status = HOLD_MARK.test(ex.notes || '') ? 'PLANNED' : ex.status;
            list.push({ ...ex, ...base, ...plan, status });
            out.updated += 1;
        } else {
            sort += 1;
            list.push({ id: newProdId(), sheetDate, status: 'PLANNED', line: '', materials: {}, matsDone: false, matItems: [], sort,
                planDate: r.planDate || '', planText: r.planDate || '', ...base });
            out.added += 1;
        }
    });
    // 요청서에서 뺀 품목 줄
    mine.filter(x => !refs.includes(x.reqRef)).forEach(x => hold(x, '요청서에서 삭제'));
    if (list.length) await saveProdRows(list);
    return out;
};

/**
 * 제품·원액 생산요청서 → 캘린더 생산예정 일정 (요청서당 하나)
 * @returns {Promise<{date: string, calendar: string} | {removed: boolean} | null>}
 */
export const syncRequestToCalendar = async (r) => {
    if (r?.kind !== 'PROD_REQ') return null;
    const id = `SCHED-REQ-${r.id}`;
    const exists = (state.schedules || []).find(s => s.id === id);
    if (r.status === 'REJECTED') {
        if (exists) await deleteSchedule(id);
        return { removed: !!exists };
    }
    const lines = reqLines(r);
    const first = lines[0];
    const date = r.planDate || r.dueDate || r.reqDate || localDateStr();
    const kind = r.reqType === 'RAW' ? '원액' : '제품';
    const sched = {
        ...(exists || {}), id, date, type: 'PROD_PLAN',
        title: `[${kind}생산요청 ${r.docNo}] ${first ? `${first.name || first.code} ${fmt(first.qty)}${unitOf(r, first)}` : ''}${lines.length > 1 ? ` 외 ${lines.length - 1}품목` : ''}${r.urgent ? ' · 긴급' : ''}`,
        itemCode: first?.code || '', itemName: first?.name || '', partner: partnerOf(r),
        worker: r.assigneeName || r.requester || '',
        notes: [`${kind}생산요청서 ${r.docNo} (요청 ${r.requester || '-'})`, `납기 ${r.dueDate || '-'}${r.planDate ? ` · 생산 예정 ${r.planDate}` : ''}`,
            ...lines.map(l => `· ${l.name || l.code} ${fmt(l.qty)}${unitOf(r, l)}`), r.reason ? `사유: ${r.reason}` : ''].filter(Boolean).join('\n'),
        status: r.status === 'DONE' ? 'DONE' : (exists?.status === 'DONE' ? 'DONE' : 'TODO'),
        calendar: r.site === '김포' ? 'GIMPO' : 'HQ',
        assigneeId: r.assigneeId || '', assigneeName: r.assigneeName || ''
    };
    await saveSchedule(sched);
    return { date, calendar: sched.calendar };
};
