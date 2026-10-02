-- ==========================================
-- 78. 메뉴별 권한 설정 (환경설정 → 계정 & 권한 & 작업자 → 메뉴 권한 설정, services/menuPermissions.js)
-- ==========================================
-- 메뉴(탭)를 열 수 있는지를 역할별·사용자별로 바꾼다. 줄이 없으면 앱의 기본값(services/auth.js TAB_PERMISSIONS)을 쓴다.
--   id = 'ROLE:<역할>'        예) ROLE:VIEWER · ROLE:OPERATOR · ROLE:MANAGER · ROLE:QC_MANAGER · ROLE:PURCHASE_MANAGER · ROLE:PROD_MANAGER · ROLE:EXECUTIVE
--   id = 'USER:<사용자 uuid>'  그 사용자만의 설정 (역할 설정보다 먼저 본다)
--   data = { "tabs": { "<탭 이름>": true | false } }  — 기본값과 다른 메뉴만 적는다 (사용자 줄은 역할 설정과 다른 메뉴만)
-- 이 표는 "화면을 여는 권한"만 다룬다: 메뉴를 보이게 하거나 숨길 뿐이고, 자료의 조회·저장·삭제는 여전히 각 표의 RLS(역할)가 막는다.
--   → 메뉴를 열어 줘도 그 역할이 읽지 못하는 자료는 보이지 않고, 저장·수정 버튼은 역할에 따라 그대로 막힌다.
--   → 메뉴를 막아도 그 역할이 읽을 수 있는 자료 자체가 잠기지는 않는다 (자료를 잠그려면 그 표의 RLS를 바꿔야 한다).
-- 총괄 관리자·마스터는 설정과 무관하게 모든 메뉴를 연다. 홈은 항상 열리고, 원액 작업지시서(특별보안)는 여기서 다루지 않는다
--   (작업일지 관리자·작업지시서 사용자 지정 — 08·42번).
-- 권한: 조회 = 역할 줄은 승인된 사용자 모두(자기 역할의 설정을 읽어야 함) · 사용자 줄은 본인과 매니저 이상,
--       쓰기 = 총괄 관리자 이상. 여러 번 실행해도 안전하다.
CREATE TABLE IF NOT EXISTS public.wms_menu_permissions (
    id text PRIMARY KEY,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_by_name text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT wms_menu_permissions_id_kind CHECK (id ~ '^(ROLE|USER):.+'),
    CONSTRAINT wms_menu_permissions_data_object CHECK (jsonb_typeof(data) = 'object')
);
ALTER TABLE public.wms_menu_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wms_menu_permissions_select ON public.wms_menu_permissions;
DROP POLICY IF EXISTS wms_menu_permissions_insert ON public.wms_menu_permissions;
DROP POLICY IF EXISTS wms_menu_permissions_update ON public.wms_menu_permissions;
DROP POLICY IF EXISTS wms_menu_permissions_delete ON public.wms_menu_permissions;
CREATE POLICY wms_menu_permissions_select ON public.wms_menu_permissions FOR SELECT TO authenticated
    USING (
        ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()))
        AND (id LIKE 'ROLE:%' OR id = 'USER:' || (SELECT auth.uid())::text OR (SELECT public.wms_has_role('MANAGER')))
    );
CREATE POLICY wms_menu_permissions_insert ON public.wms_menu_permissions FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('ADMIN')));
CREATE POLICY wms_menu_permissions_update ON public.wms_menu_permissions FOR UPDATE TO authenticated
    USING ((SELECT public.wms_has_role('ADMIN'))) WITH CHECK ((SELECT public.wms_has_role('ADMIN')));
CREATE POLICY wms_menu_permissions_delete ON public.wms_menu_permissions FOR DELETE TO authenticated
    USING ((SELECT public.wms_has_role('ADMIN')));
