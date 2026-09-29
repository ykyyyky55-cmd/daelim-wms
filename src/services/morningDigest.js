// ==========================================
// 아침 알림 요약: 종합현황판의 '확인할 일'을 매일 아침 한 번 앱 메시지·구글 챗으로 보낸다
// ==========================================
// · 설정(wms_notify_config 'MORNING', 매니저 이상 저장): 사용 여부, 보낼 시각(시), 평일만, 받는 사람(1:1 메시지), 전체 대화방, 구글 챗.
// · 보내는 때: 설정 시각 이후 처음 앱을 연 기기(현장 작업자 이상)가 보낸다 — 서버 예약 없이(무료 요금제) 동작.
//   하루 한 번만: wms_notify_log에 'MORNING:<날짜>'를 먼저 넣은 기기만 보낸다(기본키 충돌이면 다른 기기가 이미 보냄).
//   아무도 앱을 열지 않은 날은 보내지 않는다.
// · 앱 메시지: services/chat.js sendMessage — 보내는 사람은 그 기기의 로그인 사용자('[자동] 아침 알림'이라고 적음).
// · 구글 챗: Edge Function gchat-notify(웹훅 주소는 서버 비밀 표에만, supabase/auth/61_morning_digest.sql).
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';
import { canPerformAction } from './auth.js';
import { localDateStr } from './searchUtils.js';
import { loadDigestData, buildAlerts } from './digest.js';
import { sendMessage, dmRoom, myChatId } from './chat.js';

const LOCAL_CFG = 'daelim_morning_digest_cfg';
const LOCAL_LOG = 'daelim_morning_digest_log';
export const DEFAULT_MORNING = { enabled: false, hour: 8, weekdaysOnly: true, recipients: [], toAll: false, gchat: false, maxLines: 15 };
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };

export const loadMorningConfig = async () => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_notify_config').select('data').eq('id', 'MORNING').maybeSingle();
        if (error) throw new Error(`알림 설정을 불러오지 못했습니다: ${error.message}`);
        return { ...DEFAULT_MORNING, ...(data?.data || {}) };
    }
    try { return { ...DEFAULT_MORNING, ...JSON.parse(localStorage.getItem(LOCAL_CFG) || '{}') }; } catch { return { ...DEFAULT_MORNING }; }
};
export const saveMorningConfig = async (cfg) => {
    const data = { ...DEFAULT_MORNING, ...cfg, hour: Math.min(23, Math.max(0, Number(cfg.hour) || 0)) };
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_notify_config').upsert({ id: 'MORNING', data, updated_at: new Date().toISOString(), updated_by: state.currentUser?.name || '' }, { onConflict: 'id' });
        if (error) throw new Error(/row-level|permission/i.test(error.message) ? '알림 설정은 매니저 이상이 저장합니다.' : `저장하지 못했습니다: ${error.message}`);
        return data;
    }
    localStorage.setItem(LOCAL_CFG, JSON.stringify(data));
    return data;
};

// 구글 챗 웹훅 (주소는 서버에만 저장, 앱은 설정 여부만)
export const gchatWebhookSet = async () => {
    const sb = cloud();
    if (!sb) return false;
    const { data } = await sb.rpc('wms_gchat_webhook_set');
    return !!data;
};
export const setGchatWebhook = async (url) => {
    const sb = cloud();
    if (!sb) throw new Error('구글 챗 알림은 클라우드 모드에서만 쓸 수 있습니다.');
    const { data, error } = await sb.rpc('wms_set_gchat_webhook', { p_url: url || '' });
    if (error) throw new Error(error.message);
    return !!data;
};
const sendGchat = async (text) => {
    const sb = cloud();
    if (!sb) throw new Error('로컬 모드');
    const { data, error } = await sb.functions.invoke('gchat-notify', { body: { text } });
    if (error) {
        let msg = error.message;
        try { msg = (await error.context?.json())?.error || msg; } catch { /* 기본 메시지 */ }
        throw new Error(msg);
    }
    return data;
};

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const appLink = () => { try { return `${location.origin}${import.meta.env.BASE_URL || '/'}#overview`; } catch { return ''; } };

/** 알림 글 (구글 챗은 *굵게* 서식) */
export const buildDigestText = (alerts, { date = localDateStr(), maxLines = 15, errors = [] } = {}) => {
    const red = alerts.filter(a => a.level === 'red'), amber = alerts.filter(a => a.level === 'amber'), info = alerts.filter(a => a.level === 'info');
    const d = new Date(`${date}T00:00:00`);
    const lines = [`🔔 *[자동] 아침 확인할 일* ${date} (${DOW[d.getDay()]})`];
    if (!red.length && !amber.length) lines.push('✅ 급하게 확인할 항목이 없습니다.');
    const section = (title, list) => {
        if (!list.length) return;
        lines.push('', `*${title} ${list.length}건*`);
        list.slice(0, maxLines).forEach(a => lines.push(`• ${a.text}`));
        if (list.length > maxLines) lines.push(`• …외 ${list.length - maxLines}건`);
    };
    section('⚠️ 급함', red);
    section('🟠 주의', amber);
    section('ℹ️ 참고', info);
    if (errors.length) lines.push('', `(일부 자료를 불러오지 못했습니다: ${errors.length}건)`);
    const link = appLink();
    if (link) lines.push('', `📊 종합현황판: ${link}`);
    return lines.join('\n');
};

/**
 * 지금 요약을 만들어 보낸다 (설정의 받는 사람·전체 대화방·구글 챗)
 * @returns {{ text, counts, sent: { dm: number, all: boolean, gchat: boolean|string } }}
 */
export const sendDigestNow = async (cfg = null, { test = false } = {}) => {
    const c = cfg || await loadMorningConfig();
    const data = await loadDigestData();
    const alerts = buildAlerts(data);
    let text = buildDigestText(alerts, { maxLines: c.maxLines, errors: data.errors });
    if (test) text = `🧪 [시험 발송]\n${text}`;
    const sent = { dm: 0, all: false, gchat: false, errors: [] };
    const me = myChatId();
    for (const id of c.recipients || []) {
        try { await sendMessage(dmRoom(me, id), text); sent.dm += 1; } catch (e) { sent.errors.push(`메시지: ${e.message}`); }
    }
    if (c.toAll) { try { await sendMessage('ALL', text); sent.all = true; } catch (e) { sent.errors.push(`전체 대화방: ${e.message}`); } }
    if (c.gchat) { try { await sendGchat(text); sent.gchat = true; } catch (e) { sent.errors.push(`구글 챗: ${e.message}`); } }
    const counts = { red: alerts.filter(a => a.level === 'red').length, amber: alerts.filter(a => a.level === 'amber').length, info: alerts.filter(a => a.level === 'info').length };
    return { text, counts, sent };
};

/** 보낸 기록 (최근 n일) */
export const listDigestLog = async (limit = 14) => {
    const sb = cloud();
    if (sb) {
        const { data } = await sb.from('wms_notify_log').select('*').eq('kind', 'MORNING').order('sent_at', { ascending: false }).limit(limit);
        return (data || []).map(r => ({ id: r.id, sentAt: r.sent_at, by: r.sent_by_name || '', summary: r.summary || {} }));
    }
    try { return JSON.parse(localStorage.getItem(LOCAL_LOG) || '[]').slice(0, limit); } catch { return []; }
};

// 오늘 보낼 차례를 차지한다 (먼저 넣은 기기만 true)
const claimToday = async (date) => {
    const sb = cloud();
    const id = `MORNING:${date}`;
    if (sb) {
        const { error } = await sb.from('wms_notify_log').insert({ id, kind: 'MORNING', sent_by_name: state.currentUser?.name || '', summary: { status: 'SENDING' } });
        if (!error) return true;
        if (!/duplicate|23505/i.test(`${error.code} ${error.message}`)) console.warn('[아침 알림] 기록 실패', error.message);
        return false;
    }
    const log = await listDigestLog(50);
    if (log.some(x => x.id === id)) return false;
    localStorage.setItem(LOCAL_LOG, JSON.stringify([{ id, sentAt: new Date().toISOString(), by: state.currentUser?.name || '', summary: { status: 'SENDING' } }, ...log].slice(0, 50)));
    return true;
};
const finishToday = async (date, summary) => {
    const sb = cloud();
    const id = `MORNING:${date}`;
    if (sb) { await sb.from('wms_notify_log').update({ summary }).eq('id', id); return; }
    const log = await listDigestLog(50);
    localStorage.setItem(LOCAL_LOG, JSON.stringify(log.map(x => (x.id === id ? { ...x, summary } : x))));
};

let running = false;
/** 앱 시작 때 부른다: 설정 시각이 지났고 오늘 아직 안 보냈으면 보낸다 */
export const runMorningDigest = async ({ now = new Date() } = {}) => {
    if (running || !canPerformAction('PRODUCTION')) return null;
    running = true;
    try {
        const cfg = await loadMorningConfig();
        if (!cfg.enabled || (!cfg.recipients?.length && !cfg.toAll && !cfg.gchat)) return null;
        if (cfg.weekdaysOnly && (now.getDay() === 0 || now.getDay() === 6)) return null;
        if (now.getHours() < Number(cfg.hour)) return null;
        const date = localDateStr(now);
        const flag = `daelim_morning_digest_done_${date}`;
        try { if (localStorage.getItem(flag)) return null; } catch { /* 무시 */ }
        if (!(await claimToday(date))) { try { localStorage.setItem(flag, '1'); } catch { /* 무시 */ } return null; }
        const r = await sendDigestNow(cfg);
        await finishToday(date, { status: r.sent.errors.length ? 'PARTIAL' : 'SENT', counts: r.counts, dm: r.sent.dm, all: r.sent.all, gchat: r.sent.gchat, errors: r.sent.errors });
        try { localStorage.setItem(flag, '1'); } catch { /* 무시 */ }
        return r;
    } finally { running = false; }
};
