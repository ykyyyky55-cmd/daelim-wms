// ==========================================
// 메뉴별 권한 설정
// ==========================================
// 환경설정 → 계정 & 권한 & 작업자 → 메뉴 권한 설정에서 역할별·사용자별로 "어느 메뉴를 열 수 있는지"를 바꾼 값을 읽고 쓴다.
// DB: wms_menu_permissions (supabase/auth/78_menu_permissions.sql)
//   id 'ROLE:<역할>' 또는 'USER:<사용자 id>', data = { tabs: { <탭 이름>: true | false } }
//   기본값(auth.js TAB_PERMISSIONS)과 다른 메뉴만 적는다. 사용자 줄은 역할 설정과 다른 메뉴만.
// 판정 순서(auth.js canAccessTab): 사용자 설정 → 역할 설정 → 기본값. 총괄 관리자·마스터는 항상 모든 메뉴.
// 화면을 여는 권한만 다룬다 — 자료의 조회·저장·삭제는 역할(DB의 RLS)이 그대로 막는다.
// 이 파일은 auth.js가 불러 쓰므로 auth.js를 import하지 않는다(순환 방지).
//   메뉴 목록과 기본값은 화면(components/settings/MenuPermissions.js)이 auth.js에서 가져온다.
import { getSupabase, isSupabaseConfigured } from './supabase.js';

const TABLE = 'wms_menu_permissions';
const LOCAL_KEY = 'daelim_menu_permissions';      // 로컬(데모) 모드: 전체 설정 { 'ROLE:VIEWER': { 탭: 값 }, 'USER:<id>': { … } }
const CACHE_KEY = 'daelim_menu_permissions_mine'; // 클라우드 모드: 내게 적용되는 설정의 캐시 (인터넷 없이 앱을 열 때)

/** 메뉴 권한을 바꿀 수 있는 역할 — 총괄 관리자·마스터는 항상 모든 메뉴라 여기 없다 */
export const MENU_ROLES = ['VIEWER', 'OPERATOR', 'MANAGER', 'QC_MANAGER', 'PURCHASE_MANAGER', 'PROD_MANAGER', 'EXECUTIVE'];
/** 설정으로 바꾸지 않는 메뉴: 홈(항상 열림) · 원액 작업지시서(특별보안 — 작업일지 관리자·작업지시서 사용자로 따로 지정) */
export const FIXED_TABS = ['home', 'secureWorkOrders'];

/** @typedef {Record<string, boolean>} TabFlags 탭 이름 → 열 수 있는지 (기본값과 다른 것만) */

const TAB_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('[메뉴 권한] 이 기기에 저장하지 못했습니다:', e); } };

/** 저장된 값에서 쓸 수 있는 것만 남긴다 (탭 이름 모양 · true/false · 바꿀 수 없는 메뉴 제외) */
const cleanTabs = (raw) => {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.entries(raw).forEach(([tab, on]) => {
        if (TAB_NAME.test(tab) && typeof on === 'boolean' && !FIXED_TABS.includes(tab)) out[tab] = on;
    });
    return out;
};
const sameTabs = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// ---------- 지금 로그인한 사용자에게 적용되는 설정 ----------
let mine = { userId: '', role: '', roleTabs: {}, userTabs: {} };

/**
 * 그 메뉴에 대해 설정된 값 (사용자 설정 → 역할 설정). 설정이 없으면 undefined → 부르는 쪽이 기본값을 쓴다.
 * 불러온 설정의 역할과 다른 역할을 물으면 설정을 쓰지 않는다 (다른 사람의 권한을 미리 볼 때는 화면이 직접 계산한다).
 * @param {string} tabId
 * @param {string} role 지금 사용자의 역할
 * @returns {boolean | undefined}
 */
export const menuOverrideOf = (tabId, role) => {
    if (!mine.role || role !== mine.role) return undefined;
    return mine.userTabs[tabId] ?? mine.roleTabs[tabId];
};

const applyMine = (next) => {
    const changed = next.userId !== mine.userId || next.role !== mine.role || !sameTabs(next.roleTabs, mine.roleTabs) || !sameTabs(next.userTabs, mine.userTabs);
    mine = next;
    return changed;
};

const idOfRole = (role) => `ROLE:${role}`;
const idOfUser = (userId) => `USER:${userId}`;

/**
 * 로그인한 사용자에게 적용되는 메뉴 권한 설정을 불러온다. 실패하면(인터넷 없음 · 표가 아직 없음) 이 기기에 남은 값을 쓴다.
 * @param {{ id?: string, role?: string } | null} user
 * @returns {Promise<boolean>} 앞서 적용하던 값과 달라졌으면 true (메뉴를 다시 그려야 함)
 */
export const loadMyMenuPermissions = async (user) => {
    const userId = String(user?.id || '');
    const role = String(user?.role || '');
    if (!userId || !role) return applyMine({ userId: '', role: '', roleTabs: {}, userTabs: {} });
    const sb = cloud();
    if (!sb) {
        const all = readJson(LOCAL_KEY, {});
        return applyMine({ userId, role, roleTabs: cleanTabs(all[idOfRole(role)]), userTabs: cleanTabs(all[idOfUser(userId)]) });
    }
    try {
        const { data, error } = await sb.from(TABLE).select('id, data').in('id', [idOfRole(role), idOfUser(userId)]);
        if (error) throw error;
        const tabsOf = (id) => cleanTabs((data || []).find(row => row.id === id)?.data?.tabs);
        const next = { userId, role, roleTabs: tabsOf(idOfRole(role)), userTabs: tabsOf(idOfUser(userId)) };
        writeJson(CACHE_KEY, next);
        return applyMine(next);
    } catch (e) {
        console.warn('[메뉴 권한] 설정을 불러오지 못해 이 기기에 남은 값을 씁니다:', e.message || e);
        const cached = readJson(CACHE_KEY, null);
        const usable = cached && cached.userId === userId && cached.role === role;
        return applyMine({ userId, role, roleTabs: usable ? cleanTabs(cached.roleTabs) : {}, userTabs: usable ? cleanTabs(cached.userTabs) : {} });
    }
};

/** 로그아웃: 적용하던 설정과 캐시를 지운다 */
export const clearMyMenuPermissions = () => {
    mine = { userId: '', role: '', roleTabs: {}, userTabs: {} };
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { console.warn('[메뉴 권한] 캐시를 지우지 못했습니다:', e); }
};

// ---------- 설정 화면 (총괄 관리자 이상이 고친다) ----------
/**
 * 저장된 모든 설정
 * @returns {Promise<{ success: boolean, message?: string, roles: Record<string, TabFlags>, users: Record<string, TabFlags> }>}
 */
export const listMenuPermissions = async () => {
    const split = (entries) => {
        const roles = {}; const users = {};
        entries.forEach(([id, tabs]) => {
            const flags = cleanTabs(tabs);
            if (id.startsWith('ROLE:')) roles[id.slice(5)] = flags;
            else if (id.startsWith('USER:')) users[id.slice(5)] = flags;
        });
        return { roles, users };
    };
    const sb = cloud();
    if (!sb) return { success: true, ...split(Object.entries(readJson(LOCAL_KEY, {}))) };
    const { data, error } = await sb.from(TABLE).select('id, data');
    if (error) return { success: false, message: error.message, roles: {}, users: {} };
    return { success: true, ...split((data || []).map(row => [row.id, row.data?.tabs])) };
};

const saveRow = async (id, tabs, byName) => {
    const flags = cleanTabs(tabs);
    const isEmpty = !Object.keys(flags).length; // 기본값과 같아졌으면 줄을 지운다
    const sb = cloud();
    if (!sb) {
        const all = readJson(LOCAL_KEY, {});
        if (isEmpty) delete all[id]; else all[id] = flags;
        writeJson(LOCAL_KEY, all);
        return { success: true };
    }
    const { error } = isEmpty
        ? await sb.from(TABLE).delete().eq('id', id)
        : await sb.from(TABLE).upsert({ id, data: { tabs: flags }, updated_by_name: byName || '', updated_at: new Date().toISOString() });
    return error ? { success: false, message: error.message } : { success: true };
};

/**
 * 역할의 메뉴 설정 저장 (기본값과 다른 메뉴만 넘긴다. 빈 값이면 그 역할의 설정을 지워 기본값으로 돌린다)
 * @param {string} role
 * @param {TabFlags} tabs
 * @param {string} [byName] 바꾼 사람 이름
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export const saveRoleMenuPermissions = (role, tabs, byName) => {
    if (!MENU_ROLES.includes(role)) return Promise.resolve({ success: false, message: '메뉴 권한을 바꿀 수 없는 역할입니다.' });
    return saveRow(idOfRole(role), tabs, byName);
};

/**
 * 사용자 한 명의 메뉴 설정 저장 (그 사용자의 역할 설정과 다른 메뉴만 넘긴다. 빈 값이면 개별 설정을 지운다)
 * @param {string} userId
 * @param {TabFlags} tabs
 * @param {string} [byName]
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export const saveUserMenuPermissions = (userId, tabs, byName) => {
    if (!userId) return Promise.resolve({ success: false, message: '사용자를 고르세요.' });
    return saveRow(idOfUser(userId), tabs, byName);
};
