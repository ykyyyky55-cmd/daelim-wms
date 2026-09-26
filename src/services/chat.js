import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';

// 접속자 채팅 (wms_chat_messages, supabase/auth/23_todos_chat.sql)
// 방: 'ALL'(전체 대화) 또는 'dm_<uuid>_<uuid>'(1:1, uuid 정렬). 새 메시지는 realtime, 접속자는 presence로 받는다.
// 첨부 파일: 비공개 Storage 버킷 wms-chat, 경로 첫 폴더 = 방 이름(방을 볼 수 있는 사람만 읽음), 볼 때는 1시간 서명 URL.
// 로컬 모드: 이 브라우저의 localStorage(최근 500개)만, 파일은 2MB 이하 dataURL.
const BUCKET = 'wms-chat';
const MAX_CLOUD = 10 * 1024 * 1024;
const MAX_LOCAL = 2 * 1024 * 1024;
const LOCAL_KEY = 'daelim_chatMessages';
export const PAGE = 60;

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
export const isCloudChat = () => !!cloud();
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const saveLocal = (list) => {
    let l = list.slice(-500);
    // 용량이 넘치면 오래된 것부터 버린다
    while (l.length) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(l)); return; } catch { l = l.slice(Math.ceil(l.length / 5)); } }
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export const myChatId = () => (cloud() ? state.currentUser?.id : state.currentUser?.username) || 'local';
export const myChatName = () => state.currentUser?.name || '나';
export const dmRoom = (a, b) => `dm_${[a, b].sort().join('_')}`;
export const dmPartner = (room, me = myChatId()) => (room.startsWith('dm_') ? room.slice(3).split('_').find(x => x !== me) || me : '');

const fromRow = (r) => ({
    id: r.id, room: r.room, sender: r.sender, senderName: r.sender_name || '', body: r.body || '',
    attachments: Array.isArray(r.attachments) ? r.attachments : [], createdAt: r.created_at
});

// 채팅 상대 (승인된 사용자)
export const listChatUsers = async () => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.rpc('wms_chat_users');
        if (error) throw new Error(`사용자 목록을 불러오지 못했습니다: ${error.message}`);
        return (data || []).map(u => ({ id: u.id, name: u.name, dept: u.dept }));
    }
    return (state.users || []).map(u => ({ id: u.username, name: u.name || u.username, dept: u.dept || '' }));
};

// 방의 메시지 (최신 PAGE개, before가 있으면 그보다 이전) → 시간순
export const listMessages = async (room, before = '') => {
    const sb = cloud();
    if (sb) {
        let q = sb.from('wms_chat_messages').select('*').eq('room', room).order('created_at', { ascending: false }).limit(PAGE);
        if (before) q = q.lt('created_at', before);
        const { data, error } = await q;
        if (error) throw new Error(`메시지를 불러오지 못했습니다: ${error.message}`);
        return (data || []).map(fromRow).reverse();
    }
    const all = loadLocal().filter(m => m.room === room && (!before || m.created_at < before));
    return all.slice(-PAGE).map(fromRow);
};

// 안 읽은 수 계산용: 최근 메시지 (방 구분 없이, 볼 수 있는 것만)
export const listRecentMessages = async (limit = 300) => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_chat_messages').select('id, room, sender, sender_name, created_at').order('created_at', { ascending: false }).limit(limit);
        if (error) return [];
        return (data || []).map(fromRow);
    }
    return loadLocal().slice(-limit).map(fromRow);
};

const readDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    r.readAsDataURL(file);
});

const uploadFile = async (sb, room, file) => {
    const base = { name: file.name || 'image.png', type: file.type || 'application/octet-stream', size: file.size };
    if (sb) {
        if (file.size > MAX_CLOUD) throw new Error(`${base.name}: 파일이 10MB를 넘습니다.`);
        const safe = base.name.replace(/[^\w.\-가-힣]/g, '_').slice(-80);
        const path = `${room}/${uuid()}_${safe}`;
        const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: base.type, upsert: false });
        if (error) throw new Error(`${base.name}: 올리지 못했습니다 (${error.message})`);
        return { ...base, path };
    }
    if (file.size > MAX_LOCAL) throw new Error(`${base.name}: 로컬 모드에서는 2MB 이하 파일만 보낼 수 있습니다.`);
    return { ...base, data: await readDataUrl(file) };
};

export const sendMessage = async (room, body, files = []) => {
    const text = String(body || '').trim();
    if (!text && !files.length) return null;
    if (text.length > 4000) throw new Error('메시지는 4,000자까지 보낼 수 있습니다.');
    const sb = cloud();
    const attachments = [];
    for (const f of files) attachments.push(await uploadFile(sb, room, f));
    const row = { room, sender_name: myChatName(), body: text, attachments };
    if (sb) {
        const { data, error } = await sb.from('wms_chat_messages').insert(row).select().single();
        if (error) {
            if (attachments.length) sb.storage.from(BUCKET).remove(attachments.map(a => a.path));
            throw new Error(`보내지 못했습니다: ${error.message}`);
        }
        return fromRow(data);
    }
    const local = { ...row, id: uuid(), sender: myChatId(), created_at: new Date().toISOString() };
    saveLocal([...loadLocal(), local]);
    return fromRow(local);
};

export const deleteMessage = async (msg) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_chat_messages').delete().eq('id', msg.id);
        if (error) throw new Error(`삭제하지 못했습니다: ${error.message}`);
        const paths = (msg.attachments || []).map(a => a.path).filter(Boolean);
        if (paths.length) await sb.storage.from(BUCKET).remove(paths);
        return;
    }
    saveLocal(loadLocal().filter(m => m.id !== msg.id));
};

const urlCache = new Map();
export const chatFileUrl = async (att) => {
    if (att.data) return att.data;
    const sb = cloud();
    if (!sb || !att.path) return '';
    const hit = urlCache.get(att.path);
    if (hit && hit.exp > Date.now()) return hit.url;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(att.path, 3600);
    if (error) throw new Error(`파일을 열지 못했습니다: ${error.message}`);
    urlCache.set(att.path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
    return data.signedUrl;
};

/**
 * 새 메시지·삭제·접속자 구독. 반환값을 부르면 구독을 끊는다.
 * onInsert(msg), onDelete(id), onPresence(Set<id>)
 */
export const subscribeChat = ({ onInsert, onDelete, onPresence }) => {
    const sb = cloud();
    if (!sb) { onPresence?.(new Set([myChatId()])); return () => {}; }
    const me = myChatId();
    const msgCh = sb.channel('wms-chat-messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wms_chat_messages' }, (p) => onInsert?.(fromRow(p.new)))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'wms_chat_messages' }, (p) => onDelete?.(p.old?.id))
        .subscribe();
    const presCh = sb.channel('wms-chat-presence', { config: { presence: { key: me } } });
    presCh.on('presence', { event: 'sync' }, () => onPresence?.(new Set(Object.keys(presCh.presenceState()))))
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') await presCh.track({ name: myChatName(), at: new Date().toISOString() });
        });
    return () => { sb.removeChannel(msgCh); sb.removeChannel(presCh); };
};
