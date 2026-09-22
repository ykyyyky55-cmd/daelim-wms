import { state } from './db.js';

// 역할별 명칭 및 시각 뱃지 스타일
export const ROLE_INFO = {
    ADMIN: { label: '총괄 관리자', color: 'bg-rose-100 text-rose-800 border-rose-200' },
    MANAGER: { label: '자재 관리자', color: 'bg-blue-100 text-blue-800 border-blue-200' },
    OPERATOR: { label: '현장 작업자', color: 'bg-amber-100 text-amber-800 border-amber-200' },
    VIEWER: { label: '조회 전용', color: 'bg-slate-100 text-slate-700 border-slate-200' }
};

// 탭별 허용 역할 매핑 (RBAC)
export const TAB_PERMISSIONS = {
    home: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    production: ['ADMIN', 'MANAGER', 'OPERATOR'],
    scan: ['ADMIN', 'MANAGER', 'OPERATOR'],
    oilcalc: ['ADMIN', 'MANAGER', 'OPERATOR'],
    label: ['ADMIN', 'MANAGER', 'OPERATOR'],
    master: ['ADMIN', 'MANAGER'],
    inventory: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    audit: ['ADMIN', 'MANAGER'],
    ledger: ['ADMIN', 'MANAGER', 'VIEWER'],
    calendar: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    analytics: ['ADMIN', 'MANAGER', 'VIEWER'],
    planning: ['ADMIN', 'MANAGER'],
    history: ['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'],
    settings: ['ADMIN', 'MANAGER']
};

// 세션 조회 (자동로그인 여부에 따라 localStorage 또는 sessionStorage)
export const getAuthSession = () => {
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

// 인증 여부 확인
export const isAuthenticated = () => {
    const session = getAuthSession();
    return !!session && !!session.username;
};

// 현재 인증된 사용자 객체 반환
export const getCurrentUser = () => {
    const session = getAuthSession();
    if (!session) return null;
    const user = state.users?.find(u => u.username === session.username);
    if (user) {
        state.currentUser = user;
        return user;
    }
    return {
        name: session.name || session.username,
        username: session.username,
        role: session.role || 'OPERATOR',
        dept: session.dept || '현장운영팀'
    };
};

// 로그인 실행 (자동 로그인 rememberMe 플래그 지원)
export const login = async (username, password, rememberMe = true) => {
    if (!username || !password) {
        return { success: false, message: '아이디와 비밀번호를 모두 입력하세요.' };
    }

    const user = state.users.find(u => u.username === username.trim());
    if (!user) {
        return { success: false, message: '등록되지 않은 사용자 아이디입니다.' };
    }

    if (user.password !== password) {
        return { success: false, message: '비밀번호가 올바르지 않습니다.' };
    }

    const sessionData = {
        username: user.username,
        name: user.name,
        role: user.role,
        dept: user.dept,
        title: user.title,
        loggedAt: new Date().toISOString()
    };

    if (rememberMe) {
        localStorage.setItem('daelim_auth_session', JSON.stringify(sessionData));
        sessionStorage.removeItem('daelim_auth_session');
    } else {
        sessionStorage.setItem('daelim_auth_session', JSON.stringify(sessionData));
        localStorage.removeItem('daelim_auth_session');
    }

    state.currentUser = user;

    // 작업자 목록 중 일치하는 작업자가 있으면 전역 작업자 자동 동기화
    const matchingWorker = state.workers?.find(w => w.name.includes(user.name) || user.name.includes(w.name));
    if (matchingWorker) {
        state.currentGlobalWorker = `${matchingWorker.name} (${matchingWorker.role || matchingWorker.dept})`;
    } else {
        state.currentGlobalWorker = `${user.name} (${ROLE_INFO[user.role]?.label || user.role})`;
    }

    return { success: true, user };
};

// 로그아웃
export const logout = () => {
    localStorage.removeItem('daelim_auth_session');
    sessionStorage.removeItem('daelim_auth_session');
    state.currentUser = null;
};

// 특정 탭 접근 가능 여부 판별
export const canAccessTab = (tabId, userRole = null) => {
    const role = userRole || state.currentUser?.role || 'VIEWER';
    if (role === 'ADMIN') return true;
    const allowed = TAB_PERMISSIONS[tabId];
    if (!allowed) return true;
    return allowed.includes(role);
};

// 특정 액션(데이터 수정/삭제/관리) 실행 권한 판별
export const canPerformAction = (actionType, userRole = null) => {
    const role = userRole || state.currentUser?.role || 'VIEWER';
    if (role === 'ADMIN') return true;
    if (role === 'VIEWER') return false; // 조회 전용은 모든 쓰기 차단

    if (actionType === 'WRITE_STOCK' || actionType === 'SCAN_ACTION' || actionType === 'PRODUCTION') {
        return ['ADMIN', 'MANAGER', 'OPERATOR'].includes(role);
    }

    if (actionType === 'EDIT_MASTER' || actionType === 'COMMIT_AUDIT' || actionType === 'MRP_PLANNING') {
        return ['ADMIN', 'MANAGER'].includes(role);
    }

    if (actionType === 'MANAGE_USERS' || actionType === 'RESET_DATABASE') {
        return role === 'ADMIN';
    }

    return true;
};
