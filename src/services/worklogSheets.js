// ==========================================
// 업무일지(본사·김포) → 구글 시트 보내기
// ==========================================
// 구글 Apps Script 웹 앱(public/tools/worklog-sheets.gs)에 일지를 보내면, 그 달 업무일지 파일('(김포)9월 생산공급망 업무일지')에
// 날짜 탭(MMDD)을 양식 그대로 만들어 채우고, 달이 바뀌면 지난달 파일을 복사해 새 달 파일을 만든다.
// 설정(웹 앱 주소·토큰·거점별 기준 시트 링크)은 wms_worklog_sheet_config(supabase/auth/59_worklog_sheets.sql),
// 로컬 모드는 이 기기 localStorage.
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';
import { buildSheetSections } from './worklogSheetRows.js';

export { buildSheetSections };

const LOCAL_KEY = 'daelim_worklog_sheet_config';
const cloud = () => (isSupabaseConfigured() ? getSupabase() : null);
const EMPTY = { scriptUrl: '', token: '', seeds: { HQ: '', GIMPO: '' } };
let cache = null;

/** @returns {Promise<{scriptUrl: string, token: string, seeds: {HQ: string, GIMPO: string}}>} */
export const loadSheetConfig = async (force = false) => {
    if (cache && !force) return cache;
    const sb = cloud();
    if (!sb) {
        try { cache = { ...EMPTY, ...JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') }; } catch { cache = { ...EMPTY }; }
        return cache;
    }
    const { data, error } = await sb.from('wms_worklog_sheet_config').select('*').eq('id', 'default').maybeSingle();
    if (error) throw new Error(`시트 설정을 불러오지 못했습니다: ${error.message}`);
    cache = data ? { scriptUrl: data.script_url || '', token: data.token || '', seeds: { ...EMPTY.seeds, ...(data.seeds || {}) } } : { ...EMPTY };
    return cache;
};

export const saveSheetConfig = async (cfg) => {
    const next = { scriptUrl: String(cfg.scriptUrl || '').trim(), token: String(cfg.token || '').trim(), seeds: { HQ: String(cfg.seeds?.HQ || '').trim(), GIMPO: String(cfg.seeds?.GIMPO || '').trim() } };
    const sb = cloud();
    if (!sb) {
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(next)); } catch { /* 저장 불가 */ }
    } else {
        const { error } = await sb.from('wms_worklog_sheet_config').upsert({
            id: 'default', script_url: next.scriptUrl, token: next.token, seeds: next.seeds,
            updated_at: new Date().toISOString(), updated_by: state.currentUser?.name || ''
        }, { onConflict: 'id' });
        if (error) throw new Error(`시트 설정을 저장하지 못했습니다 (매니저 이상만 바꿀 수 있음): ${error.message}`);
    }
    cache = next;
    return next;
};

const post = async (cfg, body) => {
    if (!cfg.scriptUrl || !cfg.token) throw new Error('구글 시트 연결이 설정되지 않았습니다. [시트 설정]에서 웹 앱 주소와 토큰을 넣으세요.');
    let res;
    // 본문을 글자(text/plain)로 보내 사전 요청(CORS preflight) 없이 Apps Script 웹 앱에 닿게
    try { res = await fetch(cfg.scriptUrl, { method: 'POST', body: JSON.stringify({ ...body, token: cfg.token }) }); }
    catch (e) { throw new Error(`구글 시트 웹 앱에 연결하지 못했습니다 (${e.message}). 웹 앱 주소와 배포(액세스: 모든 사용자)를 확인하세요.`); }
    let j;
    try { j = await res.json(); } catch { throw new Error(`웹 앱 응답을 읽지 못했습니다 (${res.status}). 웹 앱 주소(…/exec)를 확인하세요.`); }
    if (!j.ok) throw new Error(j.error || '구글 시트에 쓰지 못했습니다.');
    return j;
};

/** 연결 확인 (토큰·배포 확인) */
export const pingSheet = async (cfg) => post(cfg, { action: 'ping' });

/**
 * 일지 한 장 보내기 → { fileName, tab, url, newTab, newFile }
 * @param {object} log  업무일지 (date: YYYY-MM-DD)
 * @param {'HQ'|'GIMPO'} site
 */
export const sendWorklogToSheet = async (log, site) => {
    const cfg = await loadSheetConfig();
    return post(cfg, { action: 'write', site, date: log.date, seedUrl: cfg.seeds?.[site] || '', sections: buildSheetSections(log) });
};
