// ==========================================
// 생산 작업 양식: 초·중·종물 검사 및 작업일지 · 포장수율표 (supabase/auth/48_work_forms.sql)
// ==========================================
// 한 날짜·한 작업장(site)에 양식 한 장. 클라우드 wms_work_forms / 로컬 모드 localStorage(daelim_work_forms)
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';

const TABLE = 'wms_work_forms';
const LOCAL_KEY = 'daelim_work_forms';
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const writeLocal = (v) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch { throw new Error('이 기기의 저장 공간이 부족합니다.'); } };
const me = () => state.currentUser || {};

export const FORM_KINDS = { INSPECT_LOG: '초·중·종물 검사 및 작업일지', YIELD: '포장수율표' };
/** 작업장 (양식 머리의 '김포공장 포장부' 같은 이름) */
export const FORM_SITES = ['김포공장 포장부', '본사 포장부'];

const idOf = (kind, site, date) => `${kind}:${site}:${date}`;
const fromRow = (r) => ({ ...(r.data || {}), id: r.id, kind: r.kind, site: r.site, date: r.form_date, by: r.created_by_name || '', createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });

/** 한 장 불러오기 (없으면 null) */
export const getForm = async (kind, site, date) => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from(TABLE).select('*').eq('id', idOf(kind, site, date)).maybeSingle();
        if (error) throw new Error(`양식을 불러오지 못했습니다: ${error.message}`);
        return data ? fromRow(data) : null;
    }
    return readLocal().find(f => f.id === idOf(kind, site, date)) || null;
};

/** 작성된 날짜 목록 (최근 순) */
export const listFormDates = async (kind, site) => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from(TABLE).select('form_date').eq('kind', kind).eq('site', site).order('form_date', { ascending: false }).limit(1000);
        if (error) throw new Error(`작성 날짜를 불러오지 못했습니다: ${error.message}`);
        return (data || []).map(r => r.form_date);
    }
    return readLocal().filter(f => f.kind === kind && f.site === site).map(f => f.date).sort().reverse();
};

/** 날짜 이전의 가장 최근 양식 (복사용) */
export const getPrevForm = async (kind, site, date) => {
    const dates = (await listFormDates(kind, site)).filter(d => d < date);
    return dates.length ? getForm(kind, site, dates[0]) : null;
};

/** 여러 날짜 양식 (기간) */
export const listForms = async (kind, site, from, to) => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from(TABLE).select('*').eq('kind', kind).eq('site', site).gte('form_date', from).lte('form_date', to).order('form_date');
        if (error) throw new Error(`양식을 불러오지 못했습니다: ${error.message}`);
        return (data || []).map(fromRow);
    }
    return readLocal().filter(f => f.kind === kind && f.site === site && f.date >= from && f.date <= to).sort((a, b) => a.date.localeCompare(b.date));
};

/** 저장 (한 날짜·작업장에 한 장, 있으면 덮어씀) */
export const saveForm = async (kind, site, date, data) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('날짜를 고르세요.');
    const id = idOf(kind, site, date);
    const { id: _i, kind: _k, site: _s, date: _d, by: _b, createdBy: _c, createdAt: _ca, updatedAt: _u, ...body } = data;
    const sb = cloud();
    if (sb) {
        const { data: saved, error } = await sb.from(TABLE).upsert({ id, kind, site, form_date: date, data: body, updated_at: new Date().toISOString(), created_by_name: data.by || me().name || '' }, { onConflict: 'id' }).select().single();
        if (error) throw new Error(`저장하지 못했습니다: ${error.message}`);
        return fromRow(saved);
    }
    const list = readLocal();
    const prev = list.find(f => f.id === id);
    const saved = { ...body, id, kind, site, date, by: prev?.by || me().name || '', createdBy: prev?.createdBy || me().username || '', createdAt: prev?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    writeLocal([saved, ...list.filter(f => f.id !== id)]);
    return saved;
};

export const deleteForm = async (kind, site, date) => {
    const id = idOf(kind, site, date);
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from(TABLE).delete().eq('id', id);
        if (error) throw new Error(`지우지 못했습니다: ${error.message}`);
        return;
    }
    writeLocal(readLocal().filter(f => f.id !== id));
};

// ---------- 계산 도우미 ----------
/** 용량 글자 → mL ('1L' 1000, '4L', '500ml', '0.5L', '20L') */
export const capacityMl = (cap) => {
    const m = String(cap || '').replace(/\s/g, '').match(/^([\d.]+)(ml|mL|ML|l|L|리터)?/);
    if (!m) return 0;
    const v = Number(m[1]) || 0;
    return /ml/i.test(m[2] || '') ? v : v * 1000;
};
/** 기준중량(g) = 비중 × 용량(mL) */
export const stdWeightOf = (sg, cap) => {
    const ml = capacityMl(cap);
    const s = Number(sg) || 0;
    return ml && s ? Math.round(s * ml * 10) / 10 : '';
};
/** 중량이 기준 ± tol% 안인지 (값이 없으면 null) */
export const weightOk = (w, std, tolPct = 2) => {
    const v = Number(w);
    const s = Number(std);
    if (!w && w !== 0) return null;
    if (!s || !Number.isFinite(v)) return null;
    return Math.abs(v - s) <= s * (tolPct / 100);
};
/** 시간 글자 → 분 ('1h' 60, '2h20' 140, '1h 50m' 110, '30m' 30, '1.5' 90(시간), '1:30' 90) */
export const parseDuration = (s) => {
    const t = String(s ?? '').trim().toLowerCase().replace(/\s/g, '');
    if (!t) return 0;
    let m = t.match(/^(\d+):(\d{1,2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = t.match(/^(?:(\d+(?:\.\d+)?)(?:h|시간))?(?:(\d+)(?:m|분)?)?$/);
    if (m && (m[1] || m[2])) {
        if (!m[1] && /(m|분)$/.test(t)) return Number(m[2]);
        if (m[1]) return Math.round(Number(m[1]) * 60) + (Number(m[2]) || 0);
        return Math.round(Number(m[2]) * 60); // 숫자만 적으면 시간
    }
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 60) : 0;
};
/** 분 → '2h20' */
export const fmtDuration = (min) => {
    const m = Math.round(Number(min) || 0);
    if (!m) return '';
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h ? `${h}h${r ? String(r).padStart(2, '0') : ''}` : `${r}m`;
};

/** 쓰기 권한: 현장 작업자 이상 (RLS 같은 규칙) */
export const canWriteForms = () => { const u = me(); return !!u.isMaster || ['ADMIN', 'MANAGER', 'OPERATOR'].includes(u.role); };
