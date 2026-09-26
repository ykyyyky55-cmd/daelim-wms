import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';

// 팝업 할일 메모장 (wms_todos, supabase/auth/23_todos_chat.sql). 내 것만 보인다(RLS owner = auth.uid()).
// 로컬 모드는 localStorage(daelim_todos, 사용자별).
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const localKey = () => `daelim_todos_${state.currentUser?.username || 'local'}`;
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(localKey()) || '[]'); } catch { return []; } };
const saveLocal = (list) => { try { localStorage.setItem(localKey(), JSON.stringify(list)); } catch { /* 저장 불가 */ } };

const fromRow = (r) => ({
    id: r.id, text: r.text || '', done: !!r.done, dueDate: r.due_date || '', starred: !!r.starred,
    sort: r.sort_order || 0, doneAt: r.done_at || '', createdAt: r.created_at || ''
});
const toRow = (t) => ({
    id: t.id, text: String(t.text || '').trim(), done: !!t.done, due_date: t.dueDate || null, starred: !!t.starred,
    sort_order: Number(t.sort) || 0, done_at: t.done ? (t.doneAt || new Date().toISOString()) : null,
    created_at: t.createdAt || new Date().toISOString(), updated_at: new Date().toISOString()
});

export const newTodoId = () => `TD-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

export const listTodos = async () => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_todos').select('*').order('created_at');
        if (error) throw new Error(`할일을 불러오지 못했습니다: ${error.message}`);
        return (data || []).map(fromRow);
    }
    return loadLocal().map(fromRow);
};

export const saveTodo = async (t) => {
    const row = toRow({ ...t, id: t.id || newTodoId() });
    if (!row.text) throw new Error('내용을 입력하세요.');
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_todos').upsert(row, { onConflict: 'id' });
        if (error) throw new Error(`할일을 저장하지 못했습니다: ${error.message}`);
        return fromRow(row);
    }
    const list = loadLocal();
    const i = list.findIndex(x => x.id === row.id);
    if (i >= 0) list[i] = row; else list.push(row);
    saveLocal(list);
    return fromRow(row);
};

export const deleteTodos = async (ids) => {
    if (!ids.length) return;
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_todos').delete().in('id', ids);
        if (error) throw new Error(`삭제하지 못했습니다: ${error.message}`);
        return;
    }
    saveLocal(loadLocal().filter(x => !ids.includes(x.id)));
};
