// ==========================================
// 전자결재 · 전자서명 (supabase/auth/30_e_approval.sql)
// ==========================================
// - 내 전자서명: 계정마다 하나(wms_signatures). 처음 서명할 때 없으면 원형 도장(이름+인)을 자동 발급해 저장한다.
// - 결재: 문서 키(doc_key)마다 결재 칸별 서명(wms_approvals.slots). 서명은 DB 함수 wms_sign으로만 하며
//   서명자 이름·서명 이미지·시각은 서버가 채운다(다른 사람 이름으로 서명 불가). 취소는 본인 또는 MANAGER 이상.
// - 로컬(오프라인/데모) 모드는 localStorage(daelim_signatures, daelim_approvals)에 같은 규칙으로 둔다.
// 문서 키: PLAN:<계획id> · PLANDAY:<날짜> · REQ:<요청서id> · SLIP:<전표번호> · LOG:<HQ|GIMPO>:<날짜> · LEDGER:<종류>:<기간>:<거점>
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';
import { makeRoundSeal } from './seal.js';

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const SIG_KEY = 'daelim_signatures';
const APPR_KEY = 'daelim_approvals';
const readLocal = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { throw new Error('기기 저장 공간이 부족합니다.'); } };

const ROLE_LEVEL = { MASTER: 5, ADMIN: 4, MANAGER: 3, OPERATOR: 2, VIEWER: 1, EXECUTIVE: 1, PENDING: 0 };
const me = () => state.currentUser || null;
const myId = () => (cloud() ? me()?.id : me()?.username) || '';
const myLevel = () => (me()?.isMaster ? 5 : ROLE_LEVEL[me()?.role] ?? 0);
// 경영자는 서열은 조회 전용과 같지만 결재 서명은 한다 (DB wms_sign이 같은 규칙)
export const canSign = () => myLevel() >= ROLE_LEVEL.OPERATOR || me()?.role === 'EXECUTIVE';
export const canCancelOthers = () => myLevel() >= ROLE_LEVEL.MANAGER;
export const isMine = (slot) => !!slot && String(slot.uid) === String(myId());

export const SIGNATURE_KINDS = { AUTO: '자동 발급 도장', IMAGE: '도장 이미지', DRAW: '직접 그린 서명' };

// 문서 종류 이름 (결재 문서함)
export const DOC_TYPE_LABEL = {
    PROD_WEEK: '주간 생산계획', PROD_MONTH: '월간 생산계획', PROD_DAY: '일일 생산계획',
    PURCH_WEEK: '주간 구매계획', PURCH_MONTH: '월간 구매계획',
    PROD_REQ: '생산요청서', PURCH_REQ: '구매요청서',
    WORK_MONTH: '월간 업무추진계획서', WORK_YEAR: '연간 업무추진계획서',
    SLIP: '출하 전표', WORKLOG: '생산 업무일지', LEDGER: '수불부', CARD_MONTH: '월별 카드사용내역',
    REPORT: '보고서', QC_PRODUCT: '제품 검사 기록', QC_PROCESS: '공정 검사 기록', QC_MATERIAL: '원부자재 수입검사', QC_REPORT: '품질(불량률) 보고서', QC_MONTH: '월간 불량률 현황'
};

// ---------- 내 전자서명 ----------
let mySigCache = null;   // { name, kind, image, updatedAt }
let mySigOwner = '';

export const getMySignature = async ({ refresh = false } = {}) => {
    const uid = myId();
    if (!uid) return null;
    if (!refresh && mySigOwner === uid && mySigCache !== null) return mySigCache || null;
    const sb = cloud();
    let sig = null;
    if (sb) {
        const { data, error } = await sb.from('wms_signatures').select('name, kind, image, updated_at').eq('user_id', uid).maybeSingle();
        if (error) throw new Error(error.message);
        if (data) sig = { name: data.name, kind: data.kind, image: data.image, updatedAt: data.updated_at };
    } else {
        sig = readLocal(SIG_KEY)[uid] || null;
    }
    mySigCache = sig || false;
    mySigOwner = uid;
    return sig;
};

export const saveMySignature = async ({ kind, image }) => {
    const uid = myId();
    if (!uid) throw new Error('로그인이 필요합니다.');
    const row = { name: me()?.name || '', kind, image, updatedAt: new Date().toISOString() };
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_signatures').upsert({ user_id: uid, name: row.name, kind, image, updated_at: row.updatedAt }, { onConflict: 'user_id' });
        if (error) throw new Error(error.message);
    } else {
        const all = readLocal(SIG_KEY);
        all[uid] = row;
        writeLocal(SIG_KEY, all);
    }
    mySigCache = row;
    mySigOwner = uid;
    return row;
};

/** 계정 이름으로 원형 도장 자동 발급 */
export const issueAutoSeal = async () => saveMySignature({ kind: 'AUTO', image: await makeRoundSeal(me()?.name || '') });

/** 서명 전에: 등록된 서명이 없으면 자동 발급 */
export const ensureMySignature = async () => (await getMySignature()) || issueAutoSeal();

// ---------- 결재 ----------
const cache = new Map();   // doc_key → slots (결재선·수신참조는 slots.__meta, 열거되지 않는 속성)

const metaOf = (r) => ({
    base: r.base_roles || r.base || null, custom: r.custom_roles || r.custom || null,
    recipients: r.recipients || [], cc: r.cc || [], shares: r.shares || [],
    status: r.status || '', rejected: r.rejected || null
});
/** slots에 결재선·수신참조 정보를 숨겨 붙인다 (JSON·열거에는 나오지 않음 → 기존 인쇄·목록 코드 그대로) */
export const withMeta = (slots, meta) => {
    const s = slots || {};
    Object.defineProperty(s, '__meta', { value: meta || null, enumerable: false, configurable: true, writable: true });
    return s;
};
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * 실제 결재 칸: 이 문서에 칸을 더했으면(결재선 변경) 그 결재선, 아니면 양식의 기본 칸.
 * 양식이 칸을 나눠 보이는 경우(출하 전표 출고/인수)처럼 기본 칸이 다르면 기본 칸 그대로.
 */
export const effectiveRoles = (baseRoles, slots) => {
    const m = slots?.__meta;
    return m?.custom?.length && sameList(m.base, baseRoles) ? m.custom : baseRoles;
};

const fromRow = (r) => ({
    key: r.doc_key, type: r.doc_type, title: r.doc_title, date: r.doc_date, roles: r.roles || [], slots: withMeta(r.slots || {}, metaOf(r)),
    recipients: r.recipients || [], cc: r.cc || [], shares: r.shares || [], status: r.status || '', rejected: r.rejected || null, updatedAt: r.updated_at
});
const APPR_COLS = 'doc_key, slots, base_roles, custom_roles, recipients, cc, shares, status, rejected';

/** 문서 하나의 결재 칸 서명 { 칸: {uid, name, title, sig, at} } (+ 숨은 __meta) */
export const getApproval = async (key, { refresh = false } = {}) => {
    if (!key) return {};
    if (!refresh && cache.has(key)) return cache.get(key);
    const sb = cloud();
    let slots = {};
    if (sb) {
        const { data, error } = await sb.from('wms_approvals').select(APPR_COLS).eq('doc_key', key).maybeSingle();
        if (error) { console.warn('[전자결재] 조회 실패', error.message); return cache.get(key) || {}; }
        slots = withMeta(data?.slots || {}, data ? metaOf(data) : null);
    } else {
        const rec = readLocal(APPR_KEY)[key];
        slots = withMeta(rec?.slots || {}, rec ? metaOf(rec) : null);
    }
    cache.set(key, slots);
    return slots;
};

/** 여러 문서의 서명 한꺼번에 (목록 화면) → Map(key → slots) */
export const getApprovals = async (keys) => {
    const uniq = [...new Set(keys.filter(Boolean))];
    const out = new Map();
    if (!uniq.length) return out;
    const sb = cloud();
    if (sb) {
        for (let i = 0; i < uniq.length; i += 200) {
            const { data, error } = await sb.from('wms_approvals').select(APPR_COLS).in('doc_key', uniq.slice(i, i + 200));
            if (error) { console.warn('[전자결재] 조회 실패', error.message); break; }
            (data || []).forEach(r => { const s = withMeta(r.slots || {}, metaOf(r)); out.set(r.doc_key, s); cache.set(r.doc_key, s); });
        }
    } else {
        const all = readLocal(APPR_KEY);
        uniq.forEach(k => { if (all[k]) out.set(k, withMeta(all[k].slots || {}, metaOf(all[k]))); });
    }
    return out;
};

/**
 * 결재선(칸 추가)·수신·참조·공유 저장. 넘기지 않은 항목(undefined)은 그대로 둔다.
 * @param doc  { key, type, title, date, roles: 양식의 기본 칸 }
 * @param meta { custom?: string[] (빈 배열 = 기본으로), recipients?, cc?, shares?: [{uid,name,at,by}] }
 * @returns slots (+ __meta)
 */
export const saveApprovalMeta = async (doc, { custom, recipients, cc, shares } = {}) => {
    if (!canSign()) throw new Error('결재선·수신참조는 현장 작업자 이상 또는 경영자만 바꿀 수 있습니다.');
    if (!doc?.key) throw new Error('문서를 먼저 저장하세요.');
    const sb = cloud();
    let slots;
    if (sb) {
        const { data, error } = await sb.rpc('wms_approval_meta', {
            p_key: doc.key, p_type: doc.type || '', p_title: doc.title || '', p_date: doc.date || '', p_base: doc.roles,
            p_custom: custom === undefined ? null : custom, p_recipients: recipients ?? null, p_cc: cc ?? null, p_shares: shares ?? null
        });
        if (error) throw new Error(error.message);
        slots = withMeta(data?.slots || {}, metaOf(data || {}));
    } else {
        const all = readLocal(APPR_KEY);
        const rec = all[doc.key] || { type: doc.type || '', title: doc.title || '', date: doc.date || '', roles: doc.roles, slots: {} };
        if (custom !== undefined) {
            const line = custom.length ? custom : doc.roles;
            const lost = Object.keys(rec.slots || {}).find(r => !line.includes(r));
            if (lost) throw new Error(`서명이 있는 칸(${lost})은 뺄 수 없습니다. 먼저 서명을 취소하세요.`);
            rec.custom = custom.length ? custom : null;
            rec.roles = line;
        }
        rec.base = doc.roles;
        if (recipients) rec.recipients = recipients;
        if (cc) rec.cc = cc;
        if (shares) rec.shares = shares;
        Object.assign(rec, { type: doc.type || rec.type, title: doc.title || rec.title, date: doc.date || rec.date, updatedAt: new Date().toISOString() });
        all[doc.key] = rec;
        writeLocal(APPR_KEY, all);
        slots = withMeta(rec.slots || {}, metaOf(rec));
    }
    cache.set(doc.key, slots);
    return slots;
};

/** 참조·공유로만 받은 문서(수신 아님)면 true — 검토·첨언만 하고 결재 서명·반려는 못 함 (DB wms_approval_review_only와 같은 규칙) */
export const isReviewOnly = (slotsOrDoc) => {
    const m = slotsOrDoc?.__meta || slotsOrDoc || {};
    const role = myInboxRole({ recipients: m.recipients, cc: m.cc, shares: m.shares });
    return role === 'CC' || role === 'SHARE';
};
export const isRejected = (slots) => slots?.__meta?.status === 'REJECTED';

// ---------- 첨언 · 반려 (47_approval_comments_reject.sql) ----------
const CMT_KEY = 'daelim_approval_comments';
export const COMMENT_KINDS = { COMMENT: '첨언', REJECT: '반려', RESUBMIT: '재상신' };
const cmtFromRow = (r) => ({ id: r.id, key: r.doc_key, kind: r.kind, body: r.body || '', uid: r.uid, name: r.name || '', at: r.created_at });
const cmtCount = new Map();
export const cachedCommentCount = (key) => cmtCount.get(key);

/** 문서의 첨언 목록 (오래된 순) */
export const listComments = async (key) => {
    if (!key) return [];
    const sb = cloud();
    let list;
    if (sb) {
        const { data, error } = await sb.from('wms_approval_comments').select('*').eq('doc_key', key).order('created_at');
        if (error) throw new Error(`첨언을 불러오지 못했습니다: ${error.message}`);
        list = (data || []).map(cmtFromRow);
    } else list = (readLocal(CMT_KEY)[key] || []).slice();
    cmtCount.set(key, list.length);
    return list;
};

/** 여러 문서의 첨언 건수 → Map(key → n) */
export const countComments = async (keys) => {
    const uniq = [...new Set(keys.filter(Boolean))];
    const out = new Map();
    if (!uniq.length) return out;
    const sb = cloud();
    if (sb) {
        for (let i = 0; i < uniq.length; i += 200) {
            const { data, error } = await sb.from('wms_approval_comments').select('doc_key').in('doc_key', uniq.slice(i, i + 200));
            if (error) { console.warn('[전자결재] 첨언 건수 조회 실패:', error.message); break; }
            (data || []).forEach(r => out.set(r.doc_key, (out.get(r.doc_key) || 0) + 1));
        }
    } else {
        const all = readLocal(CMT_KEY);
        uniq.forEach(k => { if (all[k]?.length) out.set(k, all[k].length); });
    }
    uniq.forEach(k => cmtCount.set(k, out.get(k) || 0));
    return out;
};

const localComment = (key, kind, body) => {
    const all = readLocal(CMT_KEY);
    const c = { id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, key, kind, body, uid: myId(), name: me()?.name || '', at: new Date().toISOString() };
    all[key] = [...(all[key] || []), c];
    writeLocal(CMT_KEY, all);
    return c;
};

/** 첨언 남기기 (승인된 사용자 모두, 참조·공유받은 사람 포함) */
export const addComment = async (key, body) => {
    const text = String(body || '').trim();
    if (!key) throw new Error('문서를 먼저 저장하세요.');
    if (!text) throw new Error('첨언 내용을 입력하세요.');
    if (text.length > 2000) throw new Error('첨언은 2,000자까지 쓸 수 있습니다.');
    const sb = cloud();
    let c;
    if (sb) {
        const { data, error } = await sb.from('wms_approval_comments').insert({ doc_key: key, kind: 'COMMENT', body: text }).select().single();
        if (error) throw new Error(`첨언을 남기지 못했습니다: ${error.message}`);
        c = cmtFromRow(data);
    } else c = localComment(key, 'COMMENT', text);
    cmtCount.set(key, (cmtCount.get(key) || 0) + 1);
    return c;
};

/** 내 첨언 지우기 */
export const deleteComment = async (c) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_approval_comments').delete().eq('id', c.id);
        if (error) throw new Error(`첨언을 지우지 못했습니다: ${error.message}`);
    } else {
        const all = readLocal(CMT_KEY);
        all[c.key] = (all[c.key] || []).filter(x => x.id !== c.id);
        writeLocal(CMT_KEY, all);
    }
    cmtCount.set(c.key, Math.max(0, (cmtCount.get(c.key) || 1) - 1));
};
export const isMyComment = (c) => String(c.uid) === String(myId());

/**
 * 반려(reason 있음) / 재상신(reason = null, note = 메모)
 * @param doc { key, type, title, date, roles }
 * @returns slots (+ __meta: status·rejected 반영)
 */
export const setRejected = async (doc, reason, note = '') => {
    if (!canSign()) throw new Error('반려·재상신은 현장 작업자 이상 또는 경영자만 할 수 있습니다.');
    if (!doc?.key) throw new Error('문서를 먼저 저장하세요.');
    const prev = cache.get(doc.key);
    if (isReviewOnly(prev)) throw new Error('참조·공유로 받은 문서는 검토·첨언만 할 수 있습니다 (반려 불가).');
    if (reason !== null && !String(reason || '').trim()) throw new Error('반려 사유를 입력하세요.');
    const sb = cloud();
    if (sb) {
        const { error } = await sb.rpc('wms_reject', {
            p_key: doc.key, p_type: doc.type || '', p_title: doc.title || '', p_date: doc.date || '', p_roles: doc.roles || [],
            p_reason: reason === null ? null : String(reason).trim(), p_note: note || ''
        });
        if (error) throw new Error(error.message);
        return getApproval(doc.key, { refresh: true });
    }
    const all = readLocal(APPR_KEY);
    const rec = all[doc.key] || { type: doc.type || '', title: doc.title || '', date: doc.date || '', roles: doc.roles || [], slots: {} };
    if (reason === null) { rec.status = ''; rec.rejected = null; localComment(doc.key, 'RESUBMIT', note || ''); }
    else {
        rec.status = 'REJECTED';
        rec.rejected = { uid: myId(), name: me()?.name || '', reason: String(reason).trim(), at: new Date().toISOString().slice(0, 19) };
        localComment(doc.key, 'REJECT', String(reason).trim());
    }
    rec.updatedAt = new Date().toISOString();
    all[doc.key] = rec;
    writeLocal(APPR_KEY, all);
    cmtCount.set(doc.key, (cmtCount.get(doc.key) || 0) + 1);
    return getApproval(doc.key, { refresh: true });
};

/** 내가 수신·참조·공유받은 문서인지: 'TO' | 'CC' | 'SHARE' | '' */
export const myInboxRole = (a) => {
    const id = String(myId());
    if ((a.recipients || []).some(p => String(p.uid) === id)) return 'TO';
    if ((a.cc || []).some(p => String(p.uid) === id)) return 'CC';
    if ((a.shares || []).some(p => String(p.uid) === id)) return 'SHARE';
    return '';
};

/**
 * 결재 칸에 내 전자서명
 * @param doc { key, type, title, date, roles: ['담당','검토','승인'] }
 */
export const signDoc = async (doc, role) => {
    if (!canSign()) throw new Error('결재 서명은 현장 작업자 이상만 할 수 있습니다.');
    if (!doc?.key || !doc.roles?.includes(role)) throw new Error('결재 칸이 올바르지 않습니다.');
    const cur = cache.get(doc.key);
    if (isReviewOnly(cur)) throw new Error('참조·공유로 받은 문서는 검토·첨언만 할 수 있습니다 (결재 서명 불가).');
    if (isRejected(cur)) throw new Error('반려된 문서입니다. 재상신한 뒤 서명하세요.');
    const sig = await ensureMySignature();
    const sb = cloud();
    let slots;
    if (sb) {
        const { data, error } = await sb.rpc('wms_sign', {
            p_key: doc.key, p_type: doc.type || '', p_title: doc.title || '', p_date: doc.date || '',
            p_roles: doc.roles, p_role: role
        });
        if (error) throw new Error(error.message);
        slots = data || {};
    } else {
        const all = readLocal(APPR_KEY);
        const rec = all[doc.key] || { type: doc.type || '', title: doc.title || '', date: doc.date || '', roles: doc.roles, slots: {} };
        const old = rec.slots[role];
        if (old && !isMine(old)) throw new Error(`이미 ${old.name}님이 서명한 칸입니다.`);
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        rec.slots[role] = {
            uid: myId(), name: me()?.name || '', title: me()?.title || '', sig: sig.image,
            at: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
        };
        Object.assign(rec, { type: doc.type || rec.type, title: doc.title || rec.title, date: doc.date || rec.date, roles: doc.roles, updatedAt: now.toISOString() });
        all[doc.key] = rec;
        writeLocal(APPR_KEY, all);
        slots = rec.slots;
    }
    slots = withMeta(slots, cache.get(doc.key)?.__meta || null);
    cache.set(doc.key, slots);
    return slots;
};

/** 서명 취소 (본인 또는 MANAGER 이상) */
export const unsignDoc = async (key, role) => {
    const sb = cloud();
    let slots;
    if (sb) {
        const { data, error } = await sb.rpc('wms_unsign', { p_key: key, p_role: role });
        if (error) throw new Error(error.message);
        slots = data || {};
    } else {
        const all = readLocal(APPR_KEY);
        const rec = all[key];
        const old = rec?.slots?.[role];
        if (old) {
            if (!isMine(old) && !canCancelOthers()) throw new Error('다른 사람의 서명은 자재 관리자 이상만 취소할 수 있습니다.');
            delete rec.slots[role];
            rec.updatedAt = new Date().toISOString();
            writeLocal(APPR_KEY, all);
        }
        slots = rec?.slots || {};
    }
    slots = withMeta(slots, cache.get(key)?.__meta || null);
    cache.set(key, slots);
    return slots;
};

/** 결재 문서함: 최근 결재 기록 */
export const listApprovals = async ({ limit = 300 } = {}) => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_approvals').select('*').order('updated_at', { ascending: false }).limit(limit);
        if (error) throw new Error(error.message);
        return (data || []).map(fromRow);
    }
    const all = readLocal(APPR_KEY);
    return Object.entries(all).map(([key, r]) => ({
        key, type: r.type, title: r.title, date: r.date, roles: r.roles || [], slots: withMeta(r.slots || {}, metaOf(r)),
        recipients: r.recipients || [], cc: r.cc || [], shares: r.shares || [], status: r.status || '', rejected: r.rejected || null, updatedAt: r.updatedAt || ''
    }))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, limit);
};

/** 결재 진행 상태: 'NONE' | 'PARTIAL' | 'DONE' */
export const approvalStatus = (roles, slots) => {
    const n = (roles || []).filter(r => slots?.[r]).length;
    return n === 0 ? 'NONE' : n >= roles.length ? 'DONE' : 'PARTIAL';
};

// 서명 날짜 표시 (YYYY.MM.DD)
export const signDateText = (at) => (at ? String(at).slice(0, 10).replace(/-/g, '.') : '');

export const clearApprovalCache = () => { cache.clear(); mySigCache = null; mySigOwner = ''; };
