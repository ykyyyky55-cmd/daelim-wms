import { state } from './db.js';
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { matchItem } from './docOcr.js';
import { localDateStr } from './searchUtils.js';

// 구글 챗 → 일정 받은함 (wms_chat_inbox, supabase/auth/19_chat_inbox.sql, Edge Function google-chat-webhook)
// 받은 메시지를 일정 후보로 분석하고, 사람이 확인한 것만 일정(wms_schedules)으로 등록한다.
// 로컬 모드는 localStorage(daelim_chatInbox)를 쓴다 (시험용).

const LOCAL_KEY = 'daelim_chatInbox';
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const saveLocal = (list) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { /* 저장 불가 */ } };

const fromRow = (r) => ({
    id: r.id, space: r.space_title || r.space_name || '', sender: r.sender_name || r.sender_email || '', senderEmail: r.sender_email || '',
    text: r.text || '', sentAt: r.sent_at || r.received_at, receivedAt: r.received_at, status: r.status || 'PENDING'
});

export const listChatInbox = async (status = 'PENDING') => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_chat_inbox').select('*').eq('status', status).order('received_at', { ascending: false }).limit(100);
        if (error) throw new Error(`구글 챗 일정을 불러오지 못했습니다: ${error.message}`);
        return (data || []).map(fromRow);
    }
    return loadLocal().filter(r => (r.status || 'PENDING') === status).map(fromRow);
};

export const markChatInbox = async (id, status, scheduleIds = []) => {
    const sb = cloud();
    if (sb) {
        const { data: { user } = {} } = await sb.auth.getUser();
        const { error } = await sb.from('wms_chat_inbox').update({
            status, schedule_ids: scheduleIds.length ? scheduleIds : null, handled_by: user?.id || null, handled_at: new Date().toISOString()
        }).eq('id', id);
        if (error) throw new Error(`받은함 상태를 바꾸지 못했습니다: ${error.message}`);
        return;
    }
    saveLocal(loadLocal().map(r => (r.id === id ? { ...r, status, schedule_ids: scheduleIds } : r)));
};

// ---------- 메시지 → 일정 후보 ----------
export const SCHEDULE_TYPE_LABELS = { OUT_PLAN: '출고예정', PROD_PLAN: '생산예정', IN_PLAN: '입고예정', OTHER: '일반일정' };
const TYPE_RULES = [
    ['OUT_PLAN', /출하|출고|납품|배송|발송|상차|선적|픽업/],
    ['PROD_PLAN', /생산|블렌딩|배합|충진|포장|제조|소분/],
    ['IN_PLAN', /입고|입하|도착|반입|수령/]
];
const pad2 = (n) => String(n).padStart(2, '0');
const validMD = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

// 날짜: 2026-09-30, 2026.9.30, 9/30, 9.30, 9월 30일, 오늘/내일/모레. 연도가 없으면 올해(두 달 넘게 지난 날짜면 내년)
export const parseDateIn = (text, now = new Date()) => {
    const s = String(text);
    let m = s.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
    if (m && validMD(+m[2], +m[3])) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    // 'M/D' 또는 'M.D' (뒤에 수량 단위가 붙으면 소수로 보고 날짜로 읽지 않는다: 2.5드럼, 1.5톤)
    m = s.match(/(?<![\d.])(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
        || s.match(/(?<![\d./])(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d./]|\s*(?:l|ml|kg|g|리터|톤|t|%|박스|box|개|ea|드럼|dr|페일|pail|말통|통|캔|병)(?![a-z]))/i);
    if (m && validMD(+m[1], +m[2])) {
        let y = now.getFullYear();
        const cand = new Date(y, +m[1] - 1, +m[2]);
        if (now - cand > 60 * 86400000) y += 1;
        return `${y}-${pad2(m[1])}-${pad2(m[2])}`;
    }
    const rel = s.match(/오늘|내일|모레/);
    if (rel) {
        const d = new Date(now);
        d.setDate(d.getDate() + ({ 오늘: 0, 내일: 1, 모레: 2 })[rel[0]]);
        return localDateStr(d);
    }
    return '';
};

// 수량: 개수 단위(200박스, 5드럼)를 용량 단위(4L, 170kg: 규격일 때가 많음)보다 먼저 본다
const COUNT_QTY_RE = /(\d[\d,]*(?:\.\d+)?)\s*(박스|box|bx|개|ea|드럼|dr|d\/m|페일|pail|말통|통|캔|can|병|파렛트|plt|팔레트)(?![a-z])/i;
const VOLUME_QTY_RE = /(\d[\d,]*(?:\.\d+)?)\s*(l|리터|kg|톤|t)(?![a-z])/i;
const matchQty = (line) => line.match(COUNT_QTY_RE) || line.match(VOLUME_QTY_RE);
const partnerNames = () => (state.partners || []).map(p => (typeof p === 'string' ? p : p?.name)).filter(Boolean);
const normP = (s) => String(s).replace(/\(주\)|㈜|주식회사|\s/g, '').toLowerCase();

const findPartner = (line) => {
    const ln = normP(line);
    const known = partnerNames().filter(p => normP(p).length >= 2 && ln.includes(normP(p))).sort((a, b) => b.length - a.length)[0];
    if (known) return known;
    const m = line.match(/(?:거래처|납품처|고객사?)\s*[:：]?\s*([^\s,]+)/) || line.match(/(?:\s-\s|→|->)\s*([^\d\s][^,\n]{0,18})$/);
    return m ? m[1].trim() : '';
};

// 메시지 한 건 → 일정 후보 목록 (줄마다 하나, 날짜 없는 줄은 메시지의 첫 날짜를 쓴다)
export const parseScheduleMessage = (text, now = new Date()) => {
    const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const msgDate = parseDateIn(text, now);
    const msgType = (TYPE_RULES.find(([, re]) => re.test(text)) || ['OTHER'])[0];
    const out = [];
    for (const line of lines) {
        const date = parseDateIn(line, now);
        const typeHit = TYPE_RULES.find(([, re]) => re.test(line));
        const hit = matchItem(line);
        const q = matchQty(line);
        if (!date && !typeHit && !hit && !q) continue; // 인사말 등
        const type = typeHit ? typeHit[0] : msgType;
        const item = hit?.item || null;
        const qty = q ? q[1].replace(/,/g, '') : '';
        const unit = q ? q[2].toUpperCase() : '';
        const partner = findPartner(line);
        const label = SCHEDULE_TYPE_LABELS[type] || '일정';
        out.push({
            include: !!(date || msgDate) && (!!item || !!typeHit),
            date: date || msgDate,
            type,
            itemCode: item?.code || '',
            itemName: item?.name || '',
            itemHow: hit?.how || '',
            qty, unit, partner,
            title: `${label} · ${item?.name || line.replace(/\s+/g, ' ').slice(0, 30)}${qty ? ` ${qty}${unit}` : ''}${partner ? ` (${partner})` : ''}`,
            line
        });
    }
    // 품목 줄이 있으면 '10월 2일 원액 블렌딩' 같은 머리 줄(품목·수량 없음)은 일정으로 따로 만들지 않는다 (날짜·구분은 이미 이어받음)
    if (out.some(c => c.itemCode || c.qty)) {
        const kept = out.filter(c => c.itemCode || c.qty);
        out.length = 0;
        out.push(...kept);
    }
    // 품목·날짜를 전혀 못 찾았으면 메시지 전체를 한 건으로
    if (!out.length) out.push({ include: false, date: msgDate, type: msgType, itemCode: '', itemName: '', itemHow: '', qty: '', unit: '', partner: findPartner(text), title: String(text).replace(/\s+/g, ' ').slice(0, 40), line: text });
    return out;
};
