import { state, saveWorker } from './db.js';
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { checkCloudReachable } from './offlineQueue.js';
import { ROLE_LEVEL, MANAGER_ROLES, baseRole, sharedEmailOf, SHARED_ID_RE } from './roles.js';
import { hubGroupOf } from '../components/navMenu.js'; // 메뉴 정의만 든 파일 (다른 모듈을 import하지 않음)
import { menuOverrideOf, clearMyMenuPermissions } from './menuPermissions.js'; // 메뉴별 권한 설정 (이 파일을 import하지 않음)

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
    // 경영자: 모든 메뉴·자료 조회 + 전자결재 서명·공지 등록 (업무 자료 수정·계정 관리는 안 함, supabase/auth/33_executive_role.sql)
    EXECUTIVE: { label: '경영자', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
    MANAGER: { label: '자재 관리자', color: 'bg-blue-100 text-blue-800 border-blue-200' },
    // 품질·구매·생산 관리자: 자재 관리자와 서열·권한이 같고 이름만 다르다 (supabase/auth/76_roles_shared_accounts.sql)
    QC_MANAGER: { label: '품질 관리자', color: 'bg-teal-100 text-teal-800 border-teal-200' },
    PURCHASE_MANAGER: { label: '구매 관리자', color: 'bg-orange-100 text-orange-800 border-orange-200' },
    PROD_MANAGER: { label: '생산 관리자', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    OPERATOR: { label: '현장 작업자', color: 'bg-amber-100 text-amber-800 border-amber-200' },
    VIEWER: { label: '조회 전용', color: 'bg-slate-100 text-slate-700 border-slate-200' },
    PENDING: { label: '승인 대기', color: 'bg-yellow-50 text-yellow-800 border-yellow-200' }
};

// 역할 서열 (DB의 wms_role_level과 동일, 정의는 services/roles.js)
export { ROLE_LEVEL, MANAGER_ROLES, baseRole };
export const isExecutive = (role = state.currentUser?.role) => role === 'EXECUTIVE';
const levelOf = (role) => ROLE_LEVEL[role] ?? 0;

// 탭별 허용 역할 매핑 (RBAC). MASTER와 ADMIN은 모든 탭 허용
export const TAB_PERMISSIONS = {
    home: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    hqLog: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    gimpoLog: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    prodSchedule: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    productionHq: ['ADMIN', 'MANAGER', 'OPERATOR'],
    production: ['ADMIN', 'MANAGER', 'OPERATOR'],
    scan: ['ADMIN', 'MANAGER', 'OPERATOR'],
    // 생산업무 → 라인 스캔 집계: 포장 라인 스캐너로 센 수량을 업무일지 포장 줄 또는 제품 입고로 올림
    lineCount: ['ADMIN', 'MANAGER', 'OPERATOR'],
    oilcalc: ['ADMIN', 'MANAGER', 'OPERATOR'],
    lubCalc: ['ADMIN', 'MANAGER', 'OPERATOR'],
    // 범용 계산기는 업무 데이터를 쓰지 않으므로 VIEWER도 쓴다
    calc: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    unitConv: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    fxCalc: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    viscCalc: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    docTools: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    label: ['ADMIN', 'MANAGER', 'OPERATOR'],
    labelDesigner: ['ADMIN', 'MANAGER', 'OPERATOR'],
    fieldQr: ['ADMIN', 'MANAGER', 'OPERATOR'],
    // 라벨 → QR코드 저장소: 현장 작업(스캔·입출고·생산입고)을 하는 역할 (진행 화면의 권한은 각 화면이 다시 확인)
    qrStore: ['ADMIN', 'MANAGER', 'OPERATOR'],
    docScan: ['ADMIN', 'MANAGER', 'OPERATOR'],
    master: ['ADMIN', 'MANAGER'],
    inventory: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    rawLedger: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    audit: ['ADMIN', 'MANAGER'],
    // 재고 차이 점검: 조회는 모두, 수불부 맞추기는 WRITE_STOCK (화면에서 검사)
    stockCheck: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    ledger: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    productLedger: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    ledgerViewer: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    calendar: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 조회 전용(VIEWER)이 보는 화면은 현장 작업자(OPERATOR)도 본다 (예전에 OPERATOR만 빠져 역할 순서가 거꾸로였음)
    analytics: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 월간 실적 현황판 → 보고서: 현황판과 같은 역할 (저장·삭제는 매니저 이상, RLS 같은 규칙)
    reports: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 월간 실적 현황판 → 품질회의: 조회는 모두, 올리기·삭제는 매니저 이상 (wms_reports RLS)
    qualityMeeting: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    planning: ['ADMIN', 'MANAGER'],
    history: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    settings: ['ADMIN', 'MANAGER'],
    // 생산관리: 조회는 모두, 계획 입력은 매니저 이상(MRP_PLANNING), 생산요청서 작성은 현장 작업자 이상 (RLS가 같은 규칙)
    prodPlan: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    purchPlan: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    prodRequest: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 주문관리 → 주문관리(진행·집계)·출하요청서: 조회는 모두, 반영·발행은 현장 작업자 이상 (화면에서 canPerformAction('PRODUCTION'))
    orderBoard: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    shipRequest: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    purchRequest: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 생산관리 → 업무추진계획(월간·연간): 조회는 모두, 작성은 매니저 이상(MRP_PLANNING, RLS 같은 규칙)
    workPlan: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 생산관리 → 전표발행 (거래 출하 전표 발행기): 발행은 현장 작업자 이상
    slipIssue: ['ADMIN', 'MANAGER', 'OPERATOR'],
    // 생산관리 → 전표관리 (발행 전표 목록·검색·재인쇄·엑셀): 조회는 모두, 삭제는 매니저 이상 (RLS wms_slips_delete)
    slipManage: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    ibcTotes: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 생산관리 → 환경관리(대기): 대기배출시설 운영기록부(public/air/). 조회는 모두, 작성·수정은 매니저 이상 (RLS 80_air_records.sql)
    envAir: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 전자결재: 내 전자서명·결재 문서함은 모든 역할 (서명은 OPERATOR 이상, DB 함수 wms_sign이 다시 검사)
    eApproval: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 지원 → 매뉴얼 (사용자 매뉴얼): 업무 데이터 없음, 모든 역할
    manual: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 지원 → 공지사항: 조회는 모두, 등록은 매니저 이상·삭제는 관리자 (RLS가 같은 규칙)
    notice: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 생산업무 → 포장작업표준서: 열람은 모두, 작성·수정·삭제는 매니저 이상 (RLS 같은 규칙)
    packStandard: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 파일 저장소(품목 사진·접수/발행 문서): 조회는 모두, 올리기는 현장 작업자 이상, 삭제는 올린 사람·매니저 이상 (RLS가 같은 규칙)
    fileStore: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 지원 → 자료실: 조회는 모두, 올리기는 현장 작업자 이상, 고치기·삭제는 올린 사람·매니저 이상 (RLS 같은 규칙)
    library: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 품질관리: 조회는 모두, 기록은 현장 작업자 이상, 불량 유형·목표 설정은 매니저 이상 (RLS 같은 규칙, 46_quality.sql)
    qcProduct: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    qcProcess: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    qcMaterial: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    qcEquipment: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    qcMsds: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 월간 실적 현황판 → 월간 불량률 현황 (품질 기록 취합, 조회 전용 화면 + 월 보고서 결재)
    qcBoard: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 품질관리 → LOT 추적: 조회 전용 (원액 LOT의 원료 투입은 secureWorkOrders 권한자만 — services/lotTrace.js)
    lotTrace: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 월간 실적 현황판 → 종합현황판: 모두 볼 수 있고, 카드마다 그 화면 권한이 있을 때만 보인다 (생산 실적 카드는 analytics 권한)
    overview: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 월간 실적 현황판 → 거래처별 실적: 조회 전용 (단가·배합 없음)
    partnerBoard: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 품목 및 재고관리 → ERP 코드 대응표: 조회 모두, 저장·목록 올리기는 매니저 이상 (RLS 63번)
    erpMap: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    warehouse3d: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 지원 → 의견·개선 요청: 모두 보내고 봄 (처리는 매니저 이상, RLS 62번)
    feedback: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 지원 → 사용 정착 현황: 사람별 입력 현황이라 관리자·매니저 (경영자는 canAccessTab이 모두 허용)
    usageBoard: ['ADMIN', 'MANAGER'],
    qcMonthly: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 생산업무 → 초·중·종물 검사 및 작업일지 · 포장수율표: 조회 모두, 작성 현장 작업자 이상 (RLS 48_work_forms.sql)
    inspectLog: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    yieldLog: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    // 특별보안: 역할과 무관하게 마스터·작업일지 관리자(전체)·작업지시서 사용자(열람·생산량만) (canAccessTab에서 판정)
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
    worklogAccess: !!profile.worklogAccess || !!profile.isMaster,
    // 작업지시서 사용자(역할에 더하는 권한): 작업지시서 열람 + 생산량·단위만 수정, 제조시방서는 못 봄 (supabase/auth/42_work_order_user.sql)
    woUser: !!profile.woUser,
    // 현장 공용계정: 여러 사람이 함께 쓰므로 작업자 이름을 골라야 작업할 수 있다 (components/WorkerPicker.js)
    isShared: !!profile.isShared
});

// ==========================================
// 현재 작업자 (기록에 남는 이름)
// ==========================================
// 공용계정은 브라우저를 열 때마다 작업자를 다시 고른다 (sessionStorage — 창을 닫으면 지워짐)
const SHARED_WORKER_KEY = 'daelim_shared_worker';

export const isSharedAccount = (user = state.currentUser) => !!user?.isShared;

/** 공용계정인데 아직 작업자를 고르지 않았는가 */
export const needsWorkerChoice = () => isSharedAccount() && !String(state.currentGlobalWorker || '').trim();

/**
 * 현재 작업자를 바꾼다. 공용계정이면 '이름 (공용계정 이름)'으로 남겨 어느 계정에서 누가 했는지 알 수 있게 한다.
 * @param {string} name 작업자 이름 (빈 값이면 공용계정은 '고르지 않음' 상태가 된다)
 * @param {string} [detail] 괄호 안에 넣을 글자 (직급·부서). 공용계정은 무시하고 계정 이름을 넣는다.
 * @returns {string} 기록에 남는 작업자 글자
 */
export const setCurrentWorker = (name, detail = '') => {
    const clean = String(name || '').trim();
    const user = state.currentUser;
    if (isSharedAccount(user)) {
        state.currentGlobalWorker = clean ? `${clean} (${user.name})` : '';
        try {
            if (clean) sessionStorage.setItem(SHARED_WORKER_KEY, JSON.stringify({ id: user.id, name: clean }));
            else sessionStorage.removeItem(SHARED_WORKER_KEY);
        } catch (e) { console.warn('[작업자] 선택한 작업자를 기억하지 못했습니다:', e); }
        return state.currentGlobalWorker;
    }
    state.currentGlobalWorker = detail ? `${clean} (${detail})` : clean;
    return state.currentGlobalWorker;
};

/** 공용계정에서 고른 작업자 이름만 (괄호 앞) */
export const currentWorkerName = () => String(state.currentGlobalWorker || '').replace(/\s*\([^)]*\)\s*$/, '').trim();

const restoreSharedWorker = (user) => {
    try {
        const saved = JSON.parse(sessionStorage.getItem(SHARED_WORKER_KEY) || 'null');
        return saved && saved.id === user.id && saved.name ? `${saved.name} (${user.name})` : '';
    } catch { return ''; }
};

// 작업지시서 사용자인가 (클라우드 전용. 실제 차단은 DB 함수 wms_wo_orders / wms_wo_set_qty)
export const hasWoUserAccess = (user = state.currentUser) => !!user && !!cloud() && !!user.woUser && user.role !== 'PENDING';

// 작업지시서 사용자 지정/해제 (마스터만, DB 함수가 다시 검사)
export const setWoUser = async (userId, enabled) => {
    const sb = cloud();
    if (!sb) return { success: false, message: '클라우드 연결이 설정되지 않았습니다.' };
    const { error } = await sb.rpc('wms_set_wo_user', { target: userId, enabled: !!enabled });
    if (error) return { success: false, message: error.message };
    return { success: true };
};

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
    // 공용계정: 계정 이름을 작업자로 쓰지 않는다. 이 창에서 고른 작업자가 있으면 그대로, 없으면 비워 두고 고르게 한다
    if (user.isShared) {
        state.currentGlobalWorker = restoreSharedWorker(user);
        return;
    }
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
 * 인터넷 없이 앱을 열었을 때 쓸 사용자. 조건:
 * 인터넷이 실제로 안 되고, 이 기기에 로그인 세션(갱신 토큰 포함)이 남아 있고, 그 세션과 같은 사용자의 프로필 캐시가 있을 때.
 * 로그아웃하면 세션과 프로필 캐시를 지우므로 로그아웃한 기기에서는 들어갈 수 없다.
 * 권한 차단은 여전히 DB(RLS)가 하며, 오프라인 작업은 연결된 뒤 다시 로그인이 확인되어야 반영된다.
 * @returns {Promise<Object | null>}
 */
const restoreOfflineUser = async (sb) => {
    if (await checkCloudReachable()) return null;
    const cached = readCache();
    if (!cached || levelOf(cached.role) < ROLE_LEVEL.VIEWER) return null;
    try {
        const storageKey = sb.auth.storageKey;
        const stored = storageKey ? JSON.parse(localStorage.getItem(storageKey) || 'null') : null;
        const storedUserId = stored?.user?.id || stored?.currentSession?.user?.id;
        const hasRefreshToken = !!(stored?.refresh_token || stored?.currentSession?.refresh_token);
        return storedUserId === cached.id && hasRefreshToken ? cached : null;
    } catch (e) {
        console.warn('[인증] 저장된 세션을 읽지 못했습니다:', e);
        return null;
    }
};

/**
 * 인터넷이 다시 연결됐을 때 오프라인으로 시작한 로그인이 아직 유효한지 확인한다.
 * @returns {Promise<boolean>} false면 다시 로그인해야 함
 */
export const confirmOfflineSession = async () => {
    const sb = cloud();
    if (!sb || !state.offlineSession) return true;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return false;
    state.offlineSession = false;
    return true;
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
        // 인터넷이 없어 로그인 연장(토큰 갱신)을 못 한 경우: 이 기기에 남은 세션과 프로필로 오프라인 작업을 이어간다
        const offlineUser = await restoreOfflineUser(sb);
        if (offlineUser) {
            applyUser(offlineUser);
            state.offlineSession = true;
            return { status: 'ACTIVE', user: offlineUser };
        }
        state.currentUser = null;
        return { status: 'SIGNED_OUT' };
    }
    state.offlineSession = false;
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
    // Supabase 기본 메일 서버는 프로젝트 전체에서 시간당 메일 수가 정해져 있다 (가입 인증 메일이 막힘, 다시 눌러도 풀리지 않음)
    [/email rate limit|over_email_send_rate_limit/i, '가입 인증 메일 발송 한도(프로젝트 전체, 시간당)를 넘었습니다. 다시 눌러도 풀리지 않으니 1시간쯤 뒤에 한 번만 다시 시도하거나 관리자에게 알려 주세요.'],
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

    // '@' 없이 적으면 공용계정 아이디로 본다 (관리자가 계정 관리에서 만든 현장 공용계정)
    const typed = email.trim();
    const loginEmail = typed.includes('@') ? typed : sharedEmailOf(typed);
    const { data, error } = await sb.auth.signInWithPassword({ email: loginEmail, password });
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
    clearMyMenuPermissions(); // 이 계정에 적용하던 메뉴 권한 설정
    localStorage.removeItem(EPHEMERAL_KEY);
    sessionStorage.removeItem(SESSION_ALIVE_KEY);
    localStorage.removeItem('daelim_auth_session');
    sessionStorage.removeItem('daelim_auth_session');
    sessionStorage.removeItem(SHARED_WORKER_KEY);
    state.currentUser = null;
};

/**
 * 회원가입 (실제 이메일). 가입 후 메일 인증 → 관리자 승인을 거쳐야 사용 가능
 * @returns {Promise<{ success: boolean, needsEmailConfirm?: boolean, message?: string }>}
 */
export const registerUser = async ({ name, email, password, dept = '' }) => {
    const trimmedEmail = (email || '').trim();
    const trimmedName = (name || '').trim();
    const trimmedDept = (dept || '').trim(); // 조직도 부서(services/org.js), 선택 안 하면 빈 칸 → 관리자가 계정 관리에서 지정

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

// ==========================================
// 현장 공용계정 (총괄 관리자 이상) — Edge Function shared-account
// ==========================================
// 메일 인증 없이 관리자가 아이디·비밀번호를 정해 만든다. 비밀번호는 Supabase Auth에만 저장된다.
const callSharedAccount = async (body) => {
    const sb = cloud();
    if (!sb) return { success: false, message: '클라우드 연결이 설정되지 않았습니다.' };
    const { data, error } = await sb.functions.invoke('shared-account', { body });
    if (error) {
        // 함수가 돌려준 한국어 오류 글을 꺼낸다 (없으면 통신 오류 글)
        let message = error.message || '공용계정 처리 중 오류가 발생했습니다.';
        try {
            const detail = await error.context?.json?.();
            if (detail?.error) message = detail.error;
        } catch (e) { console.warn('[공용계정] 오류 내용을 읽지 못했습니다:', e); }
        return { success: false, message };
    }
    return { success: true, ...data };
};

const checkSharedPassword = (password) => (String(password || '').length >= 8 ? '' : '비밀번호는 8자 이상 입력해주세요.');

/**
 * 공용계정 만들기
 * @param {{ loginId: string, name: string, password: string }} input
 * @returns {Promise<{ success: boolean, message?: string, loginId?: string }>}
 */
export const createSharedAccount = async ({ loginId, name, password }) => {
    const id = String(loginId || '').trim().toLowerCase();
    const cleanName = String(name || '').trim();
    if (!SHARED_ID_RE.test(id)) return { success: false, message: '아이디는 영문 소문자·숫자로 3~20자입니다 (점·밑줄·하이픈 가능, 첫 글자는 영문·숫자).' };
    if (!cleanName) return { success: false, message: '계정 이름을 입력해주세요.' };
    const passwordError = checkSharedPassword(password);
    if (passwordError) return { success: false, message: passwordError };
    return callSharedAccount({ action: 'create', loginId: id, name: cleanName, password });
};

/**
 * 공용계정 비밀번호 바꾸기 (공용계정만 — 개인 계정은 함수가 거부한다)
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export const resetSharedPassword = async (userId, password) => {
    const passwordError = checkSharedPassword(password);
    if (passwordError) return { success: false, message: passwordError };
    return callSharedAccount({ action: 'password', userId, password });
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
            dept: data.dept || '',
            role: ROLE_INFO[newRole]?.label || '작업자'
        });
    }
    return { success: true, user: data };
};

// 현재 사용자가 부여할 수 있는 역할 목록 (자기보다 낮은 역할)
// 경영자는 관리자(ADMIN) 이상만 부여한다 (DB 함수 wms_set_user_role이 같은 규칙)
export const assignableRoles = (myRole = state.currentUser?.role) =>
    ['ADMIN', 'EXECUTIVE', ...MANAGER_ROLES, 'OPERATOR', 'VIEWER', 'PENDING'].filter(r => (r === 'EXECUTIVE' ? levelOf(myRole) >= ROLE_LEVEL.ADMIN : levelOf(r) < levelOf(myRole)));

// 대상 사용자를 변경할 수 있는지 (대상이 자기보다 낮은 역할이고 본인이 아닐 때)
export const canManageUser = (target, me = state.currentUser) =>
    !!me && target.id !== me.id && levelOf(me.role) >= ROLE_LEVEL.MANAGER && levelOf(target.effectiveRole || target.role) < levelOf(me.role)
    && ((target.effectiveRole || target.role) !== 'EXECUTIVE' || levelOf(me.role) >= ROLE_LEVEL.ADMIN);

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

/**
 * 역할의 기본 메뉴 권한 — 메뉴 권한 설정(환경설정)을 보지 않은 값. 설정 화면이 '기본값'을 보여 줄 때도 쓴다.
 * 원액 작업지시서(특별보안)는 역할로 정하지 않으므로 여기서는 false다 (canAccessTab이 따로 판단).
 * @param {string} tabId
 * @param {string} role
 * @returns {boolean}
 */
export const defaultTabAccess = (tabId, role) => {
    if (!role || role === 'PENDING') return false;
    if (tabId === 'secureWorkOrders') return false;
    if (role === 'MASTER' || role === 'ADMIN') return true;
    if (role === 'EXECUTIVE') return true; // 경영자: 모든 메뉴 조회
    const allowed = TAB_PERMISSIONS[tabId];
    if (!allowed) return true;
    return allowed.includes(baseRole(role)); // 품질·구매·생산 관리자 = 자재 관리자와 같은 메뉴
};

/**
 * 그 화면에서 입력·저장을 하려면 필요한 역할 (기본 메뉴 권한에서 가장 낮은 역할). 조회 전용도 여는 화면이면 null —
 * 그런 화면은 화면 안에서 canPerformAction으로 단추를 가린다.
 * 메뉴 권한 설정으로 더 낮은 역할에게 화면을 열어 주면 그 화면은 조회만 된다(main.js가 안내 띠를 붙이고, 저장은 RLS가 막는다).
 * @returns {'OPERATOR' | 'MANAGER' | null}
 */
export const tabWriteRole = (tabId) => {
    const allowed = TAB_PERMISSIONS[tabId];
    if (!allowed || !allowed.length || allowed.includes('VIEWER')) return null;
    return allowed.includes('OPERATOR') ? 'OPERATOR' : 'MANAGER';
};
/** 지금 역할로는 그 화면을 조회만 할 수 있는가 (열 수는 있지만 저장할 역할이 못 됨 — 경영자·메뉴 권한으로 열어 준 경우) */
export const isViewOnlyTab = (tabId, role = state.currentUser?.role) => {
    const need = tabWriteRole(tabId);
    return !!need && levelOf(role) < ROLE_LEVEL[need];
};

// 특정 탭 접근 가능 여부 판별
export const canAccessTab =(tabId, userRole = null) => {
    const role = userRole || state.currentUser?.role || 'VIEWER';
    // 작업일지 관리자·마스터는 전체, 작업지시서 사용자는 작업지시서 열람·생산량 수정 화면만
    if (tabId === 'secureWorkOrders') return role !== 'PENDING' && (hasWorklogAccess() || hasWoUserAccess());
    // 묶음 화면('hub-<묶음 id>'): 그 묶음 안에 들어갈 수 있는 메뉴가 하나라도 있으면 열린다
    const hub = hubGroupOf(tabId);
    if (hub) return role !== 'PENDING' && hub.items.some(x => typeof x === 'string' && canAccessTab(x, role));
    if (role === 'MASTER' || role === 'ADMIN') return true; // 총괄 관리자 이상은 메뉴 권한 설정과 무관하게 모든 메뉴
    if (role === 'PENDING') return false;
    if (tabId === 'home') return true;
    // 환경설정의 메뉴 권한 설정 (services/menuPermissions.js): 이 사용자만의 설정 → 역할의 설정 → 없으면 기본값
    const override = menuOverrideOf(tabId, role);
    if (override !== undefined) return override;
    return defaultTabAccess(tabId, role);
};

// 특정 액션(데이터 수정/삭제/관리) 실행 권한 판별
export const canPerformAction = (actionType, userRole = null) => {
    const role = baseRole(userRole || state.currentUser?.role || 'VIEWER');
    if (role === 'MASTER' || role === 'ADMIN') return true;
    if (role === 'VIEWER' || role === 'PENDING') return false; // 조회 전용·승인 대기는 모든 쓰기 차단
    if (role === 'EXECUTIVE') return actionType === 'APPROVE' || actionType === 'NOTICE'; // 경영자: 결재·공지만

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
