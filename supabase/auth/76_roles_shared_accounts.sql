-- ==============================================================================
-- 76. 역할 추가: 품질 관리자 · 구매 관리자 · 생산 관리자 / 현장 공용계정
-- ==============================================================================
-- 1) QC_MANAGER · PURCHASE_MANAGER · PROD_MANAGER
--    서열(wms_role_level)은 자재 관리자(MANAGER)와 같은 3 → wms_has_role('MANAGER')를 쓰는 모든 정책·함수가 그대로 통과한다.
--    권한은 자재 관리자와 같고 이름만 다르다(앱 services/roles.js). 부여·변경은 자기보다 낮은 역할만 줄 수 있으므로 총괄 관리자 이상.
-- 2) 현장 공용계정: wms_profiles.is_shared
--    Edge Function shared-account가 총괄 관리자 이상의 요청으로 계정을 만들고(메일 인증 없이, 현장 작업자 역할) 이 칸을 켠다.
--    사용자는 이 칸을 바꿀 수 없다(authenticated의 UPDATE 권한은 name·dept 칸뿐). 앱은 이 칸이 켜진 계정에 작업자 이름을 고르게 한다.
-- 33_executive_role.sql 적용 후 실행한다. 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.wms_role_level(r text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
    SELECT CASE r
        WHEN 'MASTER' THEN 5
        WHEN 'ADMIN' THEN 4
        WHEN 'MANAGER' THEN 3
        WHEN 'QC_MANAGER' THEN 3
        WHEN 'PURCHASE_MANAGER' THEN 3
        WHEN 'PROD_MANAGER' THEN 3
        WHEN 'OPERATOR' THEN 2
        WHEN 'VIEWER' THEN 1
        WHEN 'EXECUTIVE' THEN 1
        ELSE 0
    END;
$$;

ALTER TABLE public.wms_profiles DROP CONSTRAINT IF EXISTS wms_profiles_role_check;
ALTER TABLE public.wms_profiles ADD CONSTRAINT wms_profiles_role_check
    CHECK (role IN ('PENDING', 'VIEWER', 'OPERATOR', 'MANAGER', 'QC_MANAGER', 'PURCHASE_MANAGER', 'PROD_MANAGER', 'ADMIN', 'EXECUTIVE'));

ALTER TABLE public.wms_profiles ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

-- 내 프로필: 공용계정 여부 추가
CREATE OR REPLACE FUNCTION public.wms_my_profile()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
    SELECT json_build_object(
        'id', p.id,
        'email', p.email,
        'name', p.name,
        'dept', p.dept,
        'title', p.title,
        'role', public.wms_current_role(),
        'isMaster', public.wms_current_role() = 'MASTER',
        'masterEmail', (SELECT master_email FROM public.wms_app_settings),
        'worklogManager', p.worklog_manager,
        'worklogAccess', public.wms_has_worklog_access(),
        'woUser', public.wms_has_wo_user(),
        'isShared', p.is_shared
    )
    FROM public.wms_profiles p
    WHERE p.id = auth.uid();
$$;

-- 역할 변경 (33번과 같고 역할 목록에 품질·구매·생산 관리자 추가)
CREATE OR REPLACE FUNCTION public.wms_set_user_role(target uuid, new_role text, new_dept text DEFAULT NULL::text, new_title text DEFAULT NULL::text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    caller_level INT := public.wms_role_level(public.wms_current_role());
    target_role TEXT := public.wms_role_of(target);
    target_level INT := public.wms_role_level(target_role);
    result JSON;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION '로그인이 필요합니다.';
    END IF;
    IF target = auth.uid() THEN
        RAISE EXCEPTION '자기 자신의 역할은 변경할 수 없습니다.';
    END IF;
    IF new_role NOT IN ('PENDING', 'VIEWER', 'OPERATOR', 'MANAGER', 'QC_MANAGER', 'PURCHASE_MANAGER', 'PROD_MANAGER', 'ADMIN', 'EXECUTIVE') THEN
        RAISE EXCEPTION '알 수 없는 역할입니다: %', new_role;
    END IF;
    IF caller_level < public.wms_role_level('MANAGER') THEN
        RAISE EXCEPTION '역할을 변경할 권한이 없습니다.';
    END IF;
    IF (new_role = 'EXECUTIVE' OR target_role = 'EXECUTIVE') AND caller_level < public.wms_role_level('ADMIN') THEN
        RAISE EXCEPTION '경영자 권한 부여·변경은 관리자 이상만 할 수 있습니다.';
    END IF;
    IF target_level >= caller_level THEN
        RAISE EXCEPTION '자신과 같거나 높은 역할의 사용자는 변경할 수 없습니다.';
    END IF;
    IF public.wms_role_level(new_role) >= caller_level THEN
        RAISE EXCEPTION '자신과 같거나 높은 역할은 부여할 수 없습니다.';
    END IF;

    UPDATE public.wms_profiles
    SET role = new_role,
        dept = COALESCE(new_dept, dept),
        title = COALESCE(new_title, title),
        approved_at = CASE WHEN role = 'PENDING' AND new_role <> 'PENDING' THEN NOW() ELSE approved_at END,
        approved_by = CASE WHEN role = 'PENDING' AND new_role <> 'PENDING' THEN auth.uid() ELSE approved_by END
    WHERE id = target
    RETURNING json_build_object('id', id, 'email', email, 'name', name, 'role', role, 'dept', dept, 'title', title)
    INTO result;

    IF result IS NULL THEN
        RAISE EXCEPTION '사용자를 찾을 수 없습니다.';
    END IF;
    RETURN result;
END;
$$;
