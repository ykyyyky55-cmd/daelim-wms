import { state, saveWorker } from './db.js';
import { getSupabase, isSupabaseConfigured } from './supabase.js';

// ==========================================
// 인증 · 권한
// ==========================================
// Supabase가 설정되어 있으면 Supabase Auth(실제 이메일 + 비밀번호, Google 로그인)를 쓴다.
//   - 비밀번호는 Supabase Auth만 보관한다 (wms_users 평문 비밀번호 사용 중단).
//   - 가입하면 승인 대기(PENDING) 상태이며, 관리자가 역할을 부여해야 사용할 수 있다.
//   - master 계정은 DB 설정(wms_app_settings.master_email)과 메일 인증된 이메일로 판별된다.
//   - 실제 접근 차단은 DB 정책(RLS)이 담당하고, 이 파일의 권한 검사는 화면 표시용이다.
// Supabase가 설정되지 않은 로컬(오프라인/데모) 모드에서만 예전 로컬 계정 로그인을 쓴다.
// DB 쪽 설정은 supabase/auth/*.sql 참고.

// 역할별 명칭 및 시각 뱃지 스타일
export const ROLE_INFO = {
    MASTER: { label: '마스터 관리자', color: 'bg-purple-100 text-purple-800 border-purple-200' },
    ADMIN: { label: '총괄 관리자', color: 'bg-rose-100 text-rose-800 border-rose-200' },
    MANAGER: { label: '자재 관리자', color: 'bg-blue-100 text-blue-800 border-blue-200' },
    OPERATOR: { label: '현장 작업자', color: 'bg-amber-100 text-amber-800 border-amber-200' },
    VIEWER: { label: '조회 전용', color: 'bg-slate-100 text-slate-700 border-slate-200' },
    PENDING: { label: '승인 대기', color: 'bg-yellow-50 text-yellow-800 border-yellow-200' }
};

// 역할 서열 (DB의 wms_role_level과 동일)
export const ROLE_LEVEL = { MASTER: 5, ADMIN: 4, MANAGER: 3, OPERATOR: 2, VIEWER: 1, PENDING: 0 };
const levelOf = (role) => ROLE_LEVEL[role] ?? 0;

// 탭별 허용 역할 매핑 (RBAC). MASTER와 ADMIN은 모든 탭 허용
export const TAB_PERMISSIONS = {
    home: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    gimpoLog: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    production: ['ADMIN', 'MANAGER', 'OPERATOR'],
    scan: ['ADMIN', 'MANAGER', 'OPERATOR'],
    oilcalc: ['ADMIN', 'MANAGER', 'OPERATOR'],
    lubCalc: ['ADMIN', 'MANAGER', 'OPERATOR'],
    label: ['ADMIN', 'MANAGER', 'OPERATOR'],
    labelDesigner: ['ADMIN', 'MANAGER', 'OPERATOR'],
    docScan: ['ADMIN', 'MANAGER', 'OPERATOR'],
    master: ['ADMIN', 'MANAGER'],
    inventory: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    rawLedger: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    audit: ['ADMIN', 'MANAGER'],
    ledger: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    productLedger: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    ledgerViewer: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    calendar: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    analytics: ['ADMIN', 'MANAGER', 'VIEWER'],
    planning: ['ADMIN', 'MANAGER'],
    history: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    settings: ['ADMIN', 'MANAGER'],
    // 특별보안: 역할과 무관하게 마스터·작업일지 관리자만 (canAccessTab에서 hasWorklogAccess로 판정)
    secureWorkOrders: []
};

// Supabase Auth 사용 여부
const cloud = () => {
    const sb = getSupabase();
    return sb && isSupabaseConfigured() ? sb : null;
};
export const isCloudAuth = () => !!cloud();

// 이메일 인증·비밀번호 재설정 링크가 돌아올 앱 주소
const appUrl = () => `${window.location.origin}${window.location.pathname}`;

// 오프라인일 때 마지막 프로필로 화면을 열기 위한 캐시 (비밀번호 없음)
const PROFILE_CACHE_KEY = 'daelim_profile_cache';
// "자동 로그인" 해제 시: 브라우저를 닫으면 로그아웃
const EPHEMERAL_KEY = 'daelim_auth_ephemeral';
const SESSION_ALIVE_KEY = 'daelim_session_alive';

const readCache = () => {
    try { return JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || 'null'); } catch { return null; }
};

const toAppUser = (profile) => ({
    id: profile.id,
    email: profile.email,
    username: profile.email,
    name: profile.name || (profile.email || '').split('@')[0],
    dept: profile.dept || '',
    title: profile.title || ROLE_INFO[profile.role]?.label || '',
    role: profile.role || 'PENDING',
    isMaster: !!profile.isMaster,
    masterEmail: profile.masterEmail || '',
    // 원액생산 작업지시서(특별보안) 접근: 마스터 또는 작업일지 관리자. 실제 차단은 DB RLS(wms_has_worklog_access)
    worklogManager: !!profile.worklogManager,
    worklogAccess: !!profile.worklogAccess || !!profile.isMaster
});

// 원액생산 작업지시서 메뉴 접근 권한 (클라우드: 마스터·작업일지 관리자 / 로컬 모드: 관리자)
export const hasWorklogAccess = (user = state.currentUser) => {
    if (!user) return false;
    if (!cloud()) return user.role === 'ADMIN' || user.role === 'MASTER';
    return !!user.worklogAccess;
};

// 작업일지 관리자 지정/해제 (마스터만, DB 함수가 다시 검사)
export const setWorklogManager = async (userId, enabled) => {
    const sb = cloud();
    if (!sb) return { success: false, message: '클라우드 연결이 설정되지 않았습니다.' };
    const { error } = await sb.rpc('wms_set_worklog_manager', { target: userId, enabled: !!enabled });
    if (error) return { success: false, message: error.message };
    return { success: true };
};

// 로그인 사용자를 앱 상태에 반영
const applyUser = (user) => {
    state.currentUser = user;
    const matchingWorker = state.workers?.find(w => w.name && user.name && (w.name.includes(user.name) || user.name.includes(w.name)));
    state.currentGlobalWorker = matchingWorker
        ? `${matchingWorker.name} (${matchingWorker.role || matchingWorker.dept})`
        : `${user.name} (${ROLE_INFO[user.role]?.label || user.role})`;
};

// DB에서 내 프로필(유효 역할 포함) 조회. 통신 실패 시 같은 사용자의 캐시 사용
const fetchMyProfile = async (sb, authUser) => {
    const { data, error } = await sb.rpc('wms_my_profile');
    if (!error && data) {
        const user = toAppUser(data);
        localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(user));
        return user;
    }
    const cached = readCache();
    if (cached && cached.id === authUser.id) return cached;
    throw new Error(error?.message || '사용자 프로필을 불러오지 못했습니다. 네트워크를 확인하세요.');
};

/**
 * 앱 시작 시 인증 상태 확인
 * @returns {Promise<{ status: 'SIGNED_OUT' | 'PENDING' | 'ACTIVE', user?: Object, error?: string }>}
 */
export const initAuth = async () => {
    const sb = cloud();
    if (!sb) {
        const user = getLocalCurrentUser();
        return user ? { status: 'ACTIVE', user } : { status: 'SIGNED_OUT' };
    }

    // "자동 로그인" 해제 상태에서 브라우저를 다시 연 경우 로그아웃
    if (localStorage.getItem(EPHEMERAL_KEY) && !sessionStorage.getItem(SESSION_ALIVE_KEY)) {
        await logout();
        return { status: 'SIGNED_OUT' };
    }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        state.currentUser = null;
        return { status: 'SIGNED_OUT' };
    }
    try {
        const user = await fetchMyProfile(sb, session.user);
        if (levelOf(user.role) < ROLE_LEVEL.VIEWER) {
            state.currentUser = null;
            return { status: 'PENDING', user };
        }
        applyUser(user);
        return { status: 'ACTIVE', user };
    } catch (e) {
        state.currentUser = null;
        return { status: 'SIGNED_OUT', error: e.message };
    }
};

// 현재 사용자 (initAuth/로그인 이후 설정됨)
export const getCurrentUser = () => state.currentUser;
export const isAuthenticated = () => !!state.currentUser;

const AUTH_ERROR_MESSAGES = [
    [/invalid login credentials/i, '이메일 또는 비밀번호가 올바르지 않습니다.'],
    [/email not confirmed/i, '이메일 인증이 완료되지 않았습니다. 메일함에서 인증 링크를 눌러 주세요.'],
    [/user already registered/i, '이미 가입된 이메일입니다. 로그인하거나 비밀번호 재설정을 이용하세요.'],
    [/password should be at least/i, '비밀번호가 너무 짧습니다.'],
    [/rate limit|too many requests/i, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'],
    [/unable to validate email|invalid email/i, '올바른 이메일 주소를 입력하세요.'],
    [/provider is not enabled|unsupported provider/i, 'Google 로그인이 아직 설정되지 않았습니다. 관리자에게 문의하세요.']
];
const toKoreanAuthError = (error) => {
    const msg = error?.message || String(error || '');
    const found = AUTH_ERROR_MESSAGES.find(([re]) => re.test(msg));
    return found ? found[1] : (msg || '인증 처리 중 오류가 발생했습니다.');
};

/**
 * 이메일·비밀번호 로그인
 * @returns {Promise<{ success: boolean, user?: Object, pending?: boolean, message?: string }>}
 */
export const login = async (email, password, rememberMe = true) => {
    if (!email || !password) {
        return { success: false, message: '이메일과 비밀번호를 모두 입력하세요.' };
    }
    const sb = cloud();
    if (!sb) return localLogin(email, password, rememberMe);

    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { success: false, message: toKoreanAuthError(error) };

    if (rememberMe) {
        localStorage.removeItem(EPHEMERAL_KEY);
    } else {
        localStorage.setItem(EPHEMERAL_KEY, '1');
        sessionStorage.setItem(SESSION_ALIVE_KEY, '1');
    }

    try {
        const user = await fetchMyProfile(sb, data.user);
        if (levelOf(user.role) < ROLE_LEVEL.VIEWER) return { success: true, pending: true, user };
        applyUser(user);
        return { success: true, user };
    } catch (e) {
        return { success: false, message: e.message };
    }
};

// Google 계정으로 로그인 (Supabase 대시보드에서 Google 공급자 설정 필요)
export const loginWithGoogle = async () => {
    const sb = cloud();
    if (!sb) return { success: false, message: '클라우드 연결이 설정되지 않아 Google 로그인을 사용할 수 없습니다.' };
    localStorage.removeItem(EPHEMERAL_KEY);
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
    if (error) return { success: false, message: toKoreanAuthError(error) };
    return { success: true }; // Google 로그인 화면으로 이동
};

// 로그아웃
export const logout = async () => {
    // 먼저 비워 두어야 signOut이 발생시키는 SIGNED_OUT 이벤트를 "세션 만료"로 오인하지 않는다
    state.currentUser = null;
    const sb = cloud();
    if (sb) {
        try { await sb.auth.signOut(); } catch (e) { console.warn('[Auth] 로그아웃 중 오류:', e); }
    }
    localStorage.removeItem(PROFILE_CACHE_KEY);
    localStorage.removeItem(EPHEMERAL_KEY);
    sessionStorage.removeItem(SESSION_ALIVE_KEY);
    localStorage.removeItem('daelim_auth_session');
    sessionStorage.removeItem('daelim_auth_session');
    state.currentUser = null;
};

/**
 * 회원가입 (실제 이메일). 가입 후 메일 인증 → 관리자 승인을 거쳐야 사용 가능
 * @returns {Promise<{ success: boolean, needsEmailConfirm?: boolean, message?: string }>}
 */
export const registerUser = async ({ name, email, password, dept = '현장운영팀' }) => {
    const trimmedEmail = (email || '').trim();
    const trimmedName = (name || '').trim();
    const trimmedDept = (dept || '').trim() || '현장운영팀';

    if (!trimmedEmail || !password || !trimmedName) {
        return { success: false, message: '이름, 이메일, 비밀번호를 모두 입력해주세요.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        return { success: false, message: '올바른 이메일 주소를 입력해주세요.' };
    }
    if (password.length < 8) {
        return { success: false, message: '비밀번호는 8자 이상 입력해주세요.' };
    }

    const sb = cloud();
    if (!sb) return { success: false, message: '클라우드 연결이 설정되지 않아 가입할 수 없습니다.' };

    const { data, error } = await sb.auth.signUp({
        email: trimmedEmail,
        password,
        options: { data: { name: trimmedName, dept: trimmedDept }, emailRedirectTo: appUrl() }
    });
    if (error) return { success: false, message: toKoreanAuthError(error) };

    // 메일 인증이 켜져 있으면 세션 없이 가입만 된다
    if (data.session) await sb.auth.signOut();
    return { success: true, needsEmailConfirm: !data.session };
};

// 비밀번호 재설정 메일 보내기
export const sendPasswordReset = async (email) => {
    const sb = cloud();
    if (!sb) return { success: false, message: '클라우드 연결이 설정되지 않았습니다.' };
    if (!email) return { success: false, message: '이메일을 입력하세요.' };
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
    if (error) return { success: false, message: toKoreanAuthError(error) };
    return { success: true };
};

// 인증 메일 다시 보내기
export const resendConfirmation = async (email) => {
    const sb = cloud();
    if (!sb || !email) return { success: false, message: '이메일을 입력하세요.' };
    const { error } = await sb.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: appUrl() } });
    if (error) return { success: false, message: toKoreanAuthError(error) };
    return { success: true };
};

// 새 비밀번호 저장 (재설정 링크로 돌아온 뒤)
export const updatePassword = async (newPassword) => {
    const sb = cloud();
    if (!sb) return { success: false, message: '클라우드 연결이 설정되지 않았습니다.' };
    if (!newPassword || newPassword.length < 8) return { success: false, message: '비밀번호는 8자 이상 입력해주세요.' };
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) return { success: false, message: toKoreanAuthError(error) };
    return { success: true };
};

// 인증 상태 변화 구독 (다른 탭에서 로그아웃, 비밀번호 재설정 링크 복귀 등)
export const onAuthChange = (callback) => {
    const sb = cloud();
    if (!sb) return () => {};
    const { data } = sb.auth.onAuthStateChange((event) => callback(event));
    return () => data.subscription.unsubscribe();
};

// ==========================================
// 계정 관리 (MANAGER 이상)
// ==========================================

// 전체 사용자 프로필 목록 (DB 정책상 MANAGER 이상만 전체 조회 가능)
export const listProfiles = async () => {
    const sb = cloud();
    if (!sb) return { success: false, message: '클라우드 연결이 설정되지 않았습니다.', profiles: [] };
    const [{ data, error }, settings] = await Promise.all([
        sb.from('wms_profiles').select('*').order('created_at', { ascending: true }),
        sb.from('wms_app_settings').select('master_email').maybeSingle()
    ]);
    if (error) return { success: false, message: error.message, profiles: [] };
    const masterEmail = (settings.data?.master_email || '').toLowerCase();
    const profiles = (data || []).map(p => ({
        ...p,
        effectiveRole: masterEmail && (p.email || '').toLowerCase() === masterEmail ? 'MASTER' : p.role
    }));
    return { success: true, profiles, masterEmail };
};

// 역할 부여/변경 (자기보다 낮은 역할의 사용자를, 자기보다 낮은 역할로만 — DB 함수가 최종 검증)
export const updateUserRole = async (userId, newRole, newDept, newTitle) => {
    const sb = cloud();
    if (!sb) return { success: false, message: '클라우드 연결이 설정되지 않았습니다.' };
    const { data, error } = await sb.rpc('wms_set_user_role', {
        target: userId,
        new_role: newRole,
        new_dept: newDept ?? null,
        new_title: newTitle ?? (ROLE_INFO[newRole]?.label || null)
    });
    if (error) return { success: false, message: error.message };

    // 승인된 사용자를 현장 작업자 명단에도 등록 (입출고 전표 작업자 선택용)
    if (data && newRole !== 'PENDING' && !state.workers?.some(w => w.name === data.name)) {
        await saveWorker({
            id: `EMP-${Date.now().toString().slice(-6)}`,
            name: data.name,
            dept: data.dept || '현장운영팀',
            role: ROLE_INFO[newRole]?.label || '작업자'
        });
    }
    return { success: true, user: data };
};

// 현재 사용자가 부여할 수 있는 역할 목록 (자기보다 낮은 역할)
export const assignableRoles = (myRole = state.currentUser?.role) =>
    ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER', 'PENDING'].filter(r => levelOf(r) < levelOf(myRole));

// 대상 사용자를 변경할 수 있는지 (대상이 자기보다 낮은 역할이고 본인이 아닐 때)
export const canManageUser = (target, me = state.currentUser) =>
    !!me && target.id !== me.id && levelOf(me.role) >= ROLE_LEVEL.MANAGER && levelOf(target.effectiveRole || target.role) < levelOf(me.role);

// master 이전 (현재 master만 가능. 받는 계정은 메일 인증을 마친 가입 계정)
export const transferMaster = async (newMasterEmail) => {
    const sb = cloud();
    if (!sb) return { success: false, message: '클라우드 연결이 설정되지 않았습니다.' };
    const { data, error } = await sb.rpc('wms_transfer_master', { new_master_email: newMasterEmail });
    if (error) return { success: false, message: error.message };
    return { success: true, masterEmail: data?.masterEmail };
};

// ==========================================
// 화면 권한 검사 (실제 차단은 DB 정책)
// ==========================================

// 특정 탭 접근 가능 여부 판별
export const canAccessTab = (tabId, userRole = null) => {
    const role = userRole || state.currentUser?.role || 'VIEWER';
    if (tabId === 'secureWorkOrders') return role !== 'PENDING' && hasWorklogAccess();
    if (role === 'MASTER' || role === 'ADMIN') return true;
    if (role === 'PENDING') return false;
    const allowed = TAB_PERMISSIONS[tabId];
    if (!allowed) return true;
    return allowed.includes(role);
};

// 특정 액션(데이터 수정/삭제/관리) 실행 권한 판별
export const canPerformAction = (actionType, userRole = null) => {
    const role = userRole || state.currentUser?.role || 'VIEWER';
    if (role === 'MASTER' || role === 'ADMIN') return true;
    if (role === 'VIEWER' || role === 'PENDING') return false; // 조회 전용·승인 대기는 모든 쓰기 차단

    if (actionType === 'WRITE_STOCK' || actionType === 'SCAN_ACTION' || actionType === 'PRODUCTION') {
        return ['MANAGER', 'OPERATOR'].includes(role);
    }
    if (actionType === 'EDIT_MASTER' || actionType === 'COMMIT_AUDIT' || actionType === 'MRP_PLANNING') {
        return role === 'MANAGER';
    }
    if (actionType === 'MANAGE_USERS') {
        return role === 'MANAGER';
    }
    if (actionType === 'RESET_DATABASE') {
        return false;
    }
    return true;
};

// ==========================================
// 로컬(오프라인/데모) 모드 전용: Supabase가 설정되지 않았을 때만 사용
// ==========================================
const getLocalSession = () => {
    try {
        const local = localStorage.getItem('daelim_auth_session');
        if (local) return JSON.parse(local);
        const session = sessionStorage.getItem('daelim_auth_session');
        if (session) return JSON.parse(session);
        return null;
    } catch {
        return null;
    }
};

// 세션 사용자가 로컬 계정 목록에 없으면(삭제된 계정 등) 세션을 무효화한다
const getLocalCurrentUser = () => {
    const session = getLocalSession();
    if (!session) return null;
    const user = state.users?.find(u => u.username === session.username);
    if (user) {
        applyUser(user);
        return user;
    }
    localStorage.removeItem('daelim_auth_session');
    sessionStorage.removeItem('daelim_auth_session');
    state.currentUser = null;
    return null;
};

const localLogin = (username, password, rememberMe) => {
    const user = state.users.find(u => u.username === username.trim());
    if (!user || user.password !== password) {
        return { success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' };
    }
    const sessionData = { username: user.username, loggedAt: new Date().toISOString() };
    if (rememberMe) {
        localStorage.setItem('daelim_auth_session', JSON.stringify(sessionData));
        sessionStorage.removeItem('daelim_auth_session');
    } else {
        sessionStorage.setItem('daelim_auth_session', JSON.stringify(sessionData));
        localStorage.removeItem('daelim_auth_session');
    }
    applyUser(user);
    return { success: true, user };
};
