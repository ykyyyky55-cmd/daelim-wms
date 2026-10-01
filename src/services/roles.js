// ==========================================
// 역할 정의 (다른 모듈을 불러오지 않는다 — db.js·auth.js 어디서나 쓸 수 있게)
// ==========================================
// DB의 wms_role_level(supabase/auth/76_roles_shared_accounts.sql)과 같아야 한다.
// 경영자(EXECUTIVE)는 쓰기 서열로는 조회 전용과 같다(1). 조회·결재·공지는 auth.js isExecutive로 따로 연다.
// 품질·구매·생산 관리자는 자재 관리자(MANAGER)와 서열·권한이 같고 이름만 다르다.
export const ROLE_LEVEL = {
    MASTER: 5, ADMIN: 4,
    MANAGER: 3, QC_MANAGER: 3, PURCHASE_MANAGER: 3, PROD_MANAGER: 3,
    OPERATOR: 2, VIEWER: 1, EXECUTIVE: 1, PENDING: 0
};

// 자재 관리자와 같은 권한을 갖는 역할
export const MANAGER_ROLES = ['MANAGER', 'QC_MANAGER', 'PURCHASE_MANAGER', 'PROD_MANAGER'];

/**
 * 권한 판정에 쓰는 기준 역할: 품질·구매·생산 관리자는 'MANAGER'로 본다.
 * 역할 이름을 목록과 비교하는 곳(TAB_PERMISSIONS 등)에서 쓴다.
 * @param {string | undefined | null} role
 * @returns {string | undefined | null}
 */
export const baseRole = (role) => (MANAGER_ROLES.includes(role) ? 'MANAGER' : role);

// 공용계정 로그인 이메일: 아이디 → 회사 도메인의 전용 주소 (Edge Function shared-account와 같은 규칙)
export const SHARED_EMAIL_DOMAIN = 'daelimoil.co.kr';
export const SHARED_ID_RE = /^[a-z0-9][a-z0-9._-]{2,19}$/;
export const sharedEmailOf = (loginId) => `wms.${String(loginId || '').trim().toLowerCase()}@${SHARED_EMAIL_DOMAIN}`;
export const sharedIdOfEmail = (email) => {
    const m = /^wms\.([^@]+)@/.exec(String(email || '').toLowerCase());
    return m ? m[1] : '';
};
