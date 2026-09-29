// ==========================================
// 담당자 지정 · 할일 배정 · 메시지 (supabase/auth/31_assign_notify.sql)
// ==========================================
// 서류·전표·일정에 담당자(수신자)를 고르면:
//   1) 담당자의 할일(wms_todos)에 등록 — id `ASG:<문서키>:<구분>@<담당자>`, 예정일·시간·알림(분 전)·열 화면(link)
//   2) 담당자에게 1:1 채팅 메시지 (본인에게 배정하면 보내지 않음)
// 알림은 담당자의 앱(FloatingTools의 알림 엔진, services/reminders.js)이 예정일 아침과 시간 n분 전에 띄운다.
// 클라우드: 다른 사람의 할일은 RLS로 못 쓰므로 DB 함수 wms_assign_todo / wms_unassign_todo를 쓴다.
// 로컬 모드: 그 사람의 localStorage 할일(daelim_todos_<사용자>)에 직접 넣는다.
// 배정이 실패해도 원래 저장은 막지 않는다 (결과 메시지만 돌려준다).
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';
import { listChatUsers, sendMessage, dmRoom, myChatId } from './chat.js';
import { ORG_CHART, orgGroupLabel, orgInfoOf } from './org.js';

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 담당자 목록 ----------
let peopleCache = null;
let peopleAt = 0;
export const listPeople = async ({ refresh = false } = {}) => {
    if (!refresh && peopleCache && Date.now() - peopleAt < 5 * 60 * 1000) return peopleCache;
    try { peopleCache = await listChatUsers(); } catch { peopleCache = peopleCache || []; }
    peopleAt = Date.now();
    return peopleCache;
};

/** 담당자 선택 칸 HTML (옵션은 fillAssigneeSelect로 채움) */
export const assigneeSelectHtml = (id, cls = '') => `<select id="${esc(id)}" data-assignee-select class="${esc(cls)}"><option value="">(담당자 없음)</option></select>`;

/** 선택 칸에 승인된 사용자 목록을 채운다. selected = 담당자 id */
export const fillAssigneeSelect = async (sel, selected = '', selectedName = '') => {
    if (!sel) return;
    const people = await listPeople();
    const me = myChatId();
    // 조직도(services/org.js) 부서별로 묶는다 (조직도에 없으면 가입 정보의 부서)
    const order = ORG_CHART.map(orgGroupLabel);
    const groups = new Map();
    people.forEach(p => {
        const info = orgInfoOf(p.name);
        const label = info ? (info.unit ? `${info.dept} · ${info.unit}` : info.dept) : (p.dept || '기타');
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push({ p, pos: info?.position || '' });
    });
    const labels = [...groups.keys()].sort((a, b) => ((order.indexOf(a) + 1) || 999) - ((order.indexOf(b) + 1) || 999) || a.localeCompare(b, 'ko'));
    const opt = ({ p, pos }) => `<option value="${esc(p.id)}" data-name="${esc(p.name)}" ${String(p.id) === String(selected) ? 'selected' : ''}>${esc(p.name)}${pos ? ` ${esc(pos)}` : ''}${String(p.id) === String(me) ? ' (나)' : ''}</option>`;
    const opts = labels.map(l => `<optgroup label="${esc(l)}">${groups.get(l).map(opt).join('')}</optgroup>`);
    // 목록에 없는 예전 담당자도 보이게
    if (selected && !people.some(p => String(p.id) === String(selected))) opts.unshift(`<option value="${esc(selected)}" selected>${esc(selectedName || '예전 담당자')}</option>`);
    sel.innerHTML = `<option value="">(담당자 없음)</option>${opts.join('')}`;
};

/** 선택 칸의 담당자 {id, name} (없으면 null) */
export const readAssignee = (sel) => {
    if (!sel || !sel.value) return null;
    const opt = sel.selectedOptions?.[0];
    return { id: sel.value, name: opt?.dataset?.name || (opt?.textContent || '').replace(/ · .*$/, '').replace(/ \(나\)$/, '').trim() };
};

// ---------- 배정 ----------
const todoId = (ref, part, ownerId) => `ASG:${ref}${part ? `:${part}` : ''}@${ownerId}`;
const localTodoKey = (username) => `daelim_todos_${username || 'local'}`;
const readLocal = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 */ } };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isTime = (s) => /^\d{1,2}:\d{2}$/.test(String(s || ''));

const putTodo = async (ownerId, t) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.rpc('wms_assign_todo', {
            p_owner: ownerId, p_id: t.id, p_text: t.text, p_due: t.dueDate || null, p_due_time: t.dueTime || '',
            p_remind: t.remindBefore ?? null, p_ref: t.ref || null, p_link: t.link || null
        });
        if (error) throw new Error(error.message);
        return;
    }
    const key = localTodoKey(ownerId);
    const list = readLocal(key);
    const i = list.findIndex(x => x.id === t.id);
    const old = i >= 0 ? list[i] : null;
    const changed = !old || old.due_date !== (t.dueDate || null) || (old.due_time || null) !== (t.dueTime || null);
    const row = {
        id: t.id, text: t.text, done: changed ? false : !!old.done, due_date: t.dueDate || null, starred: !!old?.starred, sort_order: 0,
        done_at: changed ? null : old?.done_at || null, created_at: old?.created_at || new Date().toISOString(), updated_at: new Date().toISOString(),
        due_time: t.dueTime || null, remind_before: t.remindBefore ?? null, ref: t.ref || null, link: t.link || null,
        assigned_by: myChatId(), assigned_by_name: state.currentUser?.name || ''
    };
    if (i >= 0) list[i] = row; else list.push(row);
    writeLocal(key, list);
};

const removeTodo = async (ownerId, id) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.rpc('wms_unassign_todo', { p_id: id });
        if (error) throw new Error(error.message);
        return;
    }
    const key = localTodoKey(ownerId);
    writeLocal(key, readLocal(key).filter(x => x.id !== id));
};

const dateText = (d, t) => (d ? `${d}${t ? ` ${t}` : ''}` : '');

/**
 * 담당자에게 할일 배정 + 메시지
 * @param opt.ref        문서 키 (예: SLIP:TR-20260927-001, REQ:<id>, CAL:<id>, PS:<키>)
 * @param opt.assignee   { id, name } | null (null이면 기존 배정만 지움)
 * @param opt.prev       예전 담당자 id (바뀌었으면 그 사람의 할일을 지움)
 * @param opt.tasks      [{ part: 'PROD'|'SHIP'|'', text, dueDate, dueTime, remindBefore }]  (한 문서에 할일 여러 개 가능)
 * @param opt.title      메시지 제목 (예: '[전표 발행] TR-…')
 * @param opt.lines      메시지 본문 줄
 * @param opt.link       { tab, ... } 할일에서 열 화면
 * @param opt.parts      이 문서가 가질 수 있는 할일 구분 전체 (날짜를 지운 구분의 할일도 지우기 위해, 기본 = tasks의 구분)
 * @param opt.notify     false면 메시지를 보내지 않음 (내용이 그대로인 재저장)
 * @returns { ok, message }
 */
export const assignTasks = async ({ ref, assignee, prev = '', tasks = [], parts: allParts = null, title = '', lines = [], link = null, notify = true }) => {
    const parts = [];
    const every = allParts || tasks.map(t => t.part);
    try {
        if (prev && (!assignee || String(prev) !== String(assignee.id))) {
            for (const p of every) await removeTodo(prev, todoId(ref, p, prev)).catch(() => {});
            parts.push('예전 담당자 할일 정리');
        }
        if (!assignee?.id) return { ok: true, message: parts.join(' · ') };
        // 날짜를 지워 없어진 구분의 할일은 지운다
        for (const p of every) if (!tasks.some(t => t.part === p && t.text)) await removeTodo(assignee.id, todoId(ref, p, assignee.id)).catch(() => {});
        for (const t of tasks) {
            if (!t.text) continue;
            await putTodo(assignee.id, {
                id: todoId(ref, t.part, assignee.id), text: t.text, ref, link,
                dueDate: isDate(t.dueDate) ? t.dueDate : '', dueTime: isDate(t.dueDate) && isTime(t.dueTime) ? t.dueTime : '',
                remindBefore: isDate(t.dueDate) && isTime(t.dueTime) ? (t.remindBefore === undefined ? 30 : t.remindBefore) : null
            });
        }
        parts.push(`${assignee.name || '담당자'}님 할일에 등록`);
        if (notify && String(assignee.id) !== String(myChatId())) {
            const when = tasks.filter(t => isDate(t.dueDate)).map(t => `· ${t.label || '예정'}: ${dateText(t.dueDate, isTime(t.dueTime) ? t.dueTime : '')}${isTime(t.dueTime) && t.remindBefore !== null ? ` (${t.remindBefore ?? 30}분 전 알림)` : ''}`);
            const body = [`📌 ${title}`, ...lines.filter(Boolean), ...when, `담당: ${assignee.name || ''} · 지정: ${state.currentUser?.name || ''}`, '→ 할일 메모장에서 확인하세요.'].join('\n');
            await sendMessage(dmRoom(myChatId(), assignee.id), body.slice(0, 3900));
            parts.push('메시지 보냄');
        }
        return { ok: true, message: parts.join(' · ') };
    } catch (e) {
        return { ok: false, message: `담당자 알림 실패: ${e.message}` };
    }
};
