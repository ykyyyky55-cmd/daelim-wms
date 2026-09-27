// ==========================================
// 지원 → 공지사항 (wms_notices, supabase/auth/32_notices.sql)
// ==========================================
// - 공지는 지우기 전까지 누적 보관. 조회: 모두 / 등록: 매니저 이상 / 수정: 쓴 사람·관리자 / 삭제: 관리자(ADMIN) 이상 (RLS가 같은 규칙)
// - 등록하면 전체 대화(채팅 ALL)에 공지 메시지를 보내고, 접속한 사람의 앱은 realtime으로 받아 알림을 띄운다(FloatingTools).
// - 안 읽은 공지: 기기별로 마지막으로 본 공지 시각(daelim_notice_seen_<사용자>)보다 새 공지.
// - 로컬 모드: localStorage(daelim_notices).
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';
import { sendMessage, myChatId } from './chat.js';

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const LOCAL_KEY = 'daelim_notices';
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const saveLocal = (list) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { throw new Error('기기 저장 공간이 부족합니다.'); } };

const LEVEL = { MASTER: 5, ADMIN: 4, MANAGER: 3, OPERATOR: 2, VIEWER: 1, PENDING: 0 };
const myLevel = () => (state.currentUser?.isMaster ? 5 : LEVEL[state.currentUser?.role] ?? 0);
export const canPostNotice = () => myLevel() >= LEVEL.MANAGER;
export const canDeleteNotice = () => myLevel() >= LEVEL.ADMIN;
export const canEditNotice = (n) => canDeleteNotice() || (canPostNotice() && String(n.author) === String(myChatId()));

const fromRow = (r) => ({
    id: r.id, title: r.title || '', body: r.body || '', important: !!r.important, pinned: !!r.pinned,
    author: r.author || '', authorName: r.author_name || '', createdAt: r.created_at, updatedAt: r.updated_at
});

/** 공지 목록: 상단 고정 → 최신순 */
export const sortNotices = (list) => list.slice().sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : String(b.createdAt).localeCompare(String(a.createdAt))));

export const listNotices = async () => {
    const sb = cloud();
    if (sb) {
        const all = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await sb.from('wms_notices').select('*').order('created_at', { ascending: false }).range(from, from + 999);
            if (error) throw new Error(`공지사항을 불러오지 못했습니다: ${error.message}`);
            all.push(...(data || []).map(fromRow));
            if (!data || data.length < 1000) break;
        }
        return sortNotices(all);
    }
    return sortNotices(loadLocal().map(fromRow));
};

/** 등록·수정. 새 공지면 전체 대화에 알림 메시지를 보낸다. */
export const saveNotice = async (n, { announce = true } = {}) => {
    const title = String(n.title || '').trim();
    if (!title) throw new Error('제목을 입력하세요.');
    const isNew = !n.id;
    const now = new Date().toISOString();
    const row = {
        id: n.id || `NT-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        title: title.slice(0, 200), body: String(n.body || '').slice(0, 10000), important: !!n.important, pinned: !!n.pinned, updated_at: now
    };
    const sb = cloud();
    let saved;
    if (sb) {
        const q = isNew
            ? sb.from('wms_notices').insert({ ...row, author: state.currentUser?.id, author_name: state.currentUser?.name || '' }).select().single()
            : sb.from('wms_notices').update(row).eq('id', row.id).select().single();
        const { data, error } = await q;
        if (error) throw new Error(`공지사항을 저장하지 못했습니다: ${error.message}`);
        saved = fromRow(data);
    } else {
        const list = loadLocal();
        const i = list.findIndex(x => x.id === row.id);
        const full = i >= 0 ? { ...list[i], ...row } : { ...row, author: myChatId(), author_name: state.currentUser?.name || '', created_at: now };
        if (i >= 0) list[i] = full; else list.push(full);
        saveLocal(list);
        saved = fromRow(full);
    }
    let messaged = false;
    if (isNew && announce) {
        try {
            const preview = saved.body.length > 300 ? `${saved.body.slice(0, 300)}…` : saved.body;
            await sendMessage('ALL', [`📢 [공지${saved.important ? ' · 중요' : ''}] ${saved.title}`, preview, '→ 지원 → 공지사항에서 확인하세요.'].filter(Boolean).join('\n'));
            messaged = true;
        } catch (e) { console.warn('[공지] 메시지 전송 실패', e); }
    }
    return { notice: saved, isNew, messaged };
};

export const deleteNotice = async (id) => {
    if (!canDeleteNotice()) throw new Error('공지사항 삭제는 관리자만 할 수 있습니다.');
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_notices').delete().eq('id', id);
        if (error) throw new Error(`삭제하지 못했습니다: ${error.message}`);
        return;
    }
    saveLocal(loadLocal().filter(x => x.id !== id));
};

// ---------- 읽음 ----------
const seenKey = () => `daelim_notice_seen_${myChatId()}`;
export const noticeSeenAt = () => { try { return localStorage.getItem(seenKey()) || ''; } catch { return ''; } };
export const markNoticesSeen = (iso = new Date().toISOString()) => { try { if (iso > noticeSeenAt()) localStorage.setItem(seenKey(), iso); } catch { /* 무시 */ } };
export const isUnreadNotice = (n, seen = noticeSeenAt()) => !!seen && String(n.createdAt) > seen && String(n.author) !== String(myChatId());

/** 새 공지 구독 (다른 사람이 등록한 것). 반환값을 부르면 끊는다. */
export const subscribeNotices = (onInsert) => {
    const sb = cloud();
    if (!sb) {
        let last = loadLocal().length;
        const h = (e) => { if (e.key !== LOCAL_KEY) return; const list = loadLocal(); if (list.length > last) list.slice(last).forEach(r => onInsert(fromRow(r))); last = list.length; };
        window.addEventListener('storage', h);
        return () => window.removeEventListener('storage', h);
    }
    const ch = sb.channel(`wms-notices-${Date.now()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wms_notices' }, (p) => onInsert(fromRow(p.new)))
        .subscribe();
    return () => sb.removeChannel(ch);
};
