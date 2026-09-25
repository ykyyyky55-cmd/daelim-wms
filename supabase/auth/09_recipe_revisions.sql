-- ==============================================================================
-- 09. 제조시방서 개정이력(자동 스냅샷) 테이블
-- ==============================================================================
-- 제조시방서(wms_recipes)를 저장할 때마다, 바뀌기 직전 내용 전체를 이 테이블에 스냅샷으로 남긴다.
-- 화면에서 "버전 이력"으로 열람하고, 특정 시점으로 되돌릴 수 있다(되돌리기도 그 직전 상태를 다시 스냅샷으로 남김).
-- 접근 권한은 08_secure_work_orders.sql과 같다 (마스터 + 작업일지 관리자만, wms_has_worklog_access()).
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_recipe_revisions (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL REFERENCES public.wms_recipes(id) ON DELETE CASCADE,
    note TEXT,                                   -- 예: "되돌리기 (2026-01-05 12:30 이전으로)"
    snapshot JSONB NOT NULL,                     -- 바뀌기 직전 시방서 전체 내용 (원료 실명 포함, 대외비)
    created_by UUID DEFAULT auth.uid(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wms_recipe_revisions_recipe ON public.wms_recipe_revisions (recipe_id, created_at DESC);

ALTER TABLE public.wms_recipe_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_recipe_revisions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_recipe_revisions TO authenticated;

DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wms_recipe_revisions' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.wms_recipe_revisions', p.policyname);
    END LOOP;
    EXECUTE 'CREATE POLICY wms_recipe_revisions_worklog_only ON public.wms_recipe_revisions FOR ALL TO authenticated USING (public.wms_has_worklog_access()) WITH CHECK (public.wms_has_worklog_access())';
END $$;
