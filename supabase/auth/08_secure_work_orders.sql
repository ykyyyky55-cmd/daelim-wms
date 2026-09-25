-- ==============================================================================
-- 08. 원액생산 작업지시서(특별보안) : 제조시방서·작업지시서 테이블 + 작업일지 관리자 권한
-- ==============================================================================
-- 접근: 마스터 관리자 + '작업일지 관리자' 권한을 받은 계정만 (조회·작성·수정·삭제 모두)
--   - 작업일지 관리자 권한은 wms_profiles.worklog_manager 이며, 마스터만 wms_set_worklog_manager()로 켜고 끈다.
--   - 사용자는 자기 프로필의 name, dept만 수정할 수 있으므로(01 참고) 이 권한을 스스로 켤 수 없다.
-- 배합 자료(원료 실명·배합비)는 이 테이블에만 저장하고, 앱 번들·GitHub에는 넣지 않는다.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

-- 1. 작업일지 관리자 권한 칸
ALTER TABLE public.wms_profiles ADD COLUMN IF NOT EXISTS worklog_manager BOOLEAN NOT NULL DEFAULT false;

-- 2. 현재 사용자의 원액 작업지시서 접근 권한 (마스터, 또는 승인된 계정 중 작업일지 관리자)
CREATE OR REPLACE FUNCTION public.wms_has_worklog_access()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT CASE
        WHEN auth.uid() IS NULL THEN false
        WHEN public.wms_current_role() = 'MASTER' THEN true
        ELSE COALESCE((
            SELECT p.worklog_manager AND p.role <> 'PENDING'
            FROM public.wms_profiles p WHERE p.id = auth.uid()
        ), false)
    END;
$$;

-- 3. 작업일지 관리자 지정/해제 (마스터만)
CREATE OR REPLACE FUNCTION public.wms_set_worklog_manager(target UUID, enabled BOOLEAN)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    p public.wms_profiles;
BEGIN
    IF public.wms_current_role() IS DISTINCT FROM 'MASTER' THEN
        RAISE EXCEPTION '작업일지 관리자 권한은 마스터 관리자만 지정할 수 있습니다.';
    END IF;
    UPDATE public.wms_profiles SET worklog_manager = COALESCE(enabled, false)
    WHERE id = target
    RETURNING * INTO p;
    IF p.id IS NULL THEN
        RAISE EXCEPTION '사용자를 찾을 수 없습니다.';
    END IF;
    RETURN json_build_object('id', p.id, 'worklogManager', p.worklog_manager);
END;
$$;

REVOKE ALL ON FUNCTION public.wms_has_worklog_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wms_set_worklog_manager(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_has_worklog_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_set_worklog_manager(UUID, BOOLEAN) TO authenticated;

-- 4. 내 프로필에 작업일지 권한 포함 (앱 메뉴 표시용. 실제 차단은 아래 RLS)
CREATE OR REPLACE FUNCTION public.wms_my_profile()
RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
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
        'worklogAccess', public.wms_has_worklog_access()
    )
    FROM public.wms_profiles p
    WHERE p.id = auth.uid();
$$;

-- 5. 제조시방서 (제품별 배합 레시피, 리비전 단위)
CREATE TABLE IF NOT EXISTS public.wms_recipes (
    id TEXT PRIMARY KEY,
    product_name TEXT NOT NULL,          -- 예: ODM 5W30
    revision TEXT,                       -- 예: Rev.08 (25.11.28)
    base_qty NUMERIC NOT NULL DEFAULT 1, -- 시방서 기준 생산량 (예: 1)
    base_unit TEXT NOT NULL DEFAULT 'D/M',
    base_liters NUMERIC,                 -- 기준 생산량의 L 합계 (예: 200)
    product_item_code TEXT,              -- 생산 원액의 품목코드 (재고 입고 연결, 선택)
    materials JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{seq, name, rawCode, liters, wtPct, kg, sg, itemCode}]
    work_standard JSONB NOT NULL DEFAULT '[]'::jsonb,
    history JSONB NOT NULL DEFAULT '[]'::jsonb,     -- 개정 이력
    brands JSONB NOT NULL DEFAULT '[]'::jsonb,      -- 적용 ODM 제품 목록
    qc_items JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{no, item, standard}]
    doc_no TEXT,
    author TEXT,
    source_file TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID DEFAULT auth.uid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 원액생산 작업지시서 (작업일지)
CREATE TABLE IF NOT EXISTS public.wms_secure_work_orders (
    id TEXT PRIMARY KEY,
    order_no TEXT NOT NULL UNIQUE,
    recipe_id TEXT REFERENCES public.wms_recipes(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('DRAFT', 'ISSUED', 'COMPLETED', 'CANCELLED')),
    data JSONB NOT NULL DEFAULT '{}'::jsonb,   -- 머리글·원료 소요량 스냅샷·검사 결과 등 작업지시서 전체 내용
    created_by UUID DEFAULT auth.uid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wms_secure_work_orders_created ON public.wms_secure_work_orders (created_at DESC);

-- 7. 보안 정책: 마스터 + 작업일지 관리자만 (익명·일반 역할 모두 차단)
DO $$
DECLARE
    t TEXT;
    p RECORD;
BEGIN
    FOREACH t IN ARRAY ARRAY['wms_recipes', 'wms_secure_work_orders'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
        FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
        END LOOP;
        EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.wms_has_worklog_access()) WITH CHECK (public.wms_has_worklog_access())', t || '_worklog_only', t);
    END LOOP;
END $$;
