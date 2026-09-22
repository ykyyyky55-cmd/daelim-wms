import { createClient } from '@supabase/supabase-js';

// 1. 환경 변수 또는 LocalStorage에서 Supabase 설정 가져오기
const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const normalizeSupabaseUrl = (url) => {
    if (!url) return '';
    let cleaned = url.trim();
    cleaned = cleaned.replace(/\/rest\/v1\/?$/, '');
    cleaned = cleaned.replace(/\/+$/, '');
    return cleaned;
};

const DEFAULT_SUPABASE_URL = 'https://hapvzqyfikctcbxurxal.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_WqQPzXzumRkVSWfT_CZuaw_V9XCnxYx';

export const getSupabaseConfig = () => {
    const localUrl = localStorage.getItem('daelim_supabase_url');
    const localKey = localStorage.getItem('daelim_supabase_key');
    const rawUrl = (localUrl || envUrl || DEFAULT_SUPABASE_URL).trim();
    const rawKey = (localKey || envKey || DEFAULT_SUPABASE_KEY).trim();
    return {
        url: normalizeSupabaseUrl(rawUrl),
        key: rawKey
    };
};

let supabaseClient = null;

export const initSupabase = () => {
    const { url, key } = getSupabaseConfig();
    if (url && key && url.startsWith('http')) {
        try {
            supabaseClient = createClient(url, key, {
                auth: { persistSession: true },
                realtime: { params: { eventsPerSecond: 10 } }
            });
            return supabaseClient;
        } catch (e) {
            console.warn('[Supabase] 초기화 오류, 로컬 모드로 동작합니다.', e);
            supabaseClient = null;
            return null;
        }
    }
    supabaseClient = null;
    return null;
};

// 최초 초기화
supabaseClient = initSupabase();

export const getSupabase = () => supabaseClient;

export const isSupabaseConfigured = () => {
    const { url, key } = getSupabaseConfig();
    return !!(url && key && url.startsWith('http'));
};

export const saveSupabaseConfig = (url, key) => {
    if (url) localStorage.setItem('daelim_supabase_url', url.trim());
    else localStorage.removeItem('daelim_supabase_url');
    
    if (key) localStorage.setItem('daelim_supabase_key', key.trim());
    else localStorage.removeItem('daelim_supabase_key');

    return initSupabase();
};

export const testSupabaseConnection = async (url, key) => {
    try {
        const testClient = createClient(url.trim(), key.trim());
        const { data, error } = await testClient.from('wms_master_items').select('code').limit(1);
        if (error && error.code !== 'PGRST116') {
            // 테이블이 아직 없거나 권한 문제일 수 있으므로 응답 자체를 확인
            if (error.message.includes('relation') || error.code === '42P01') {
                return { success: true, message: 'Supabase 서버에 연결되었습니다. (테이블 생성이 필요합니다. supabase_schema.sql을 실행해주세요)' };
            }
            return { success: false, message: error.message };
        }
        return { success: true, message: 'Supabase 데이터베이스 연결 및 실시간 연동 준비 완료!' };
    } catch (err) {
        return { success: false, message: err.message || '연결 실패' };
    }
};
