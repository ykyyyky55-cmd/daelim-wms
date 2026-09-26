-- ==============================================================================
-- 권한·성능 정리 (Supabase 보안/성능 점검 경고 대응)
-- ==============================================================================
-- 1. 로그인하지 않은 사용자(anon, PUBLIC)가 SECURITY DEFINER 함수를 RPC로 호출하지 못하게 한다.
--    - 트리거 전용 함수(wms_handle_*)는 트리거로만 실행되므로 authenticated 실행 권한도 뺀다.
--    - wms_current_role / wms_has_role / wms_role_level은 RLS 정책에서 쓰므로 authenticated는 유지한다.
-- 2. wms_role_level의 search_path를 고정한다.
-- 3. RLS를 거치지 않는 TRUNCATE와 쓰지 않는 REFERENCES/TRIGGER 권한을 anon/authenticated에서 회수한다
--    (이후 새로 만드는 테이블에도 적용되도록 기본 권한도 바꾼다).
-- 4. 성능: wms_profiles 정책의 auth.uid()를 한 번만 평가하도록 바꾸고,
--    조회 정책과 겹치던 FOR ALL 쓰기 정책을 INSERT/UPDATE/DELETE로 나눈다. 권한 기준(역할)은 그대로다.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

-- 1. 함수 실행 권한
REVOKE EXECUTE ON FUNCTION public.wms_handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wms_handle_user_email_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wms_current_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wms_has_role(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wms_role_level(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_current_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_role_level(text) TO authenticated;

-- 2. search_path 고정
ALTER FUNCTION public.wms_role_level(text) SET search_path = public;

-- 3. 테이블 권한
DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'wms\_%' LOOP
        EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', t.tablename);
    END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

-- 4-1. wms_profiles: auth.uid()를 행마다 다시 평가하지 않도록 (select auth.uid())로 감싼다
DROP POLICY IF EXISTS "wms_profiles_select" ON public.wms_profiles;
CREATE POLICY "wms_profiles_select" ON public.wms_profiles
    FOR SELECT TO authenticated USING (id = (select auth.uid()) OR public.wms_has_role('MANAGER'));
DROP POLICY IF EXISTS "wms_profiles_update_own" ON public.wms_profiles;
CREATE POLICY "wms_profiles_update_own" ON public.wms_profiles
    FOR UPDATE TO authenticated USING (id = (select auth.uid())) WITH CHECK (id = (select auth.uid()));

-- 4-2. FOR ALL 쓰기 정책을 INSERT/UPDATE/DELETE로 분리 (조회 정책과 SELECT가 겹치지 않게)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('wms_audit_records', 'MANAGER'),
        ('wms_categories', 'MANAGER'),
        ('wms_item_ledger', 'OPERATOR'),
        ('wms_locations', 'MANAGER'),
        ('wms_raw_ledger', 'OPERATOR'),
        ('wms_schedules', 'OPERATOR'),
        ('wms_workers', 'MANAGER')
    ) AS v(tbl, min_role) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_write', r.tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_insert', r.tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_update', r.tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_delete', r.tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.wms_has_role(%L))', r.tbl || '_insert', r.tbl, r.min_role);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.wms_has_role(%L)) WITH CHECK (public.wms_has_role(%L))', r.tbl || '_update', r.tbl, r.min_role, r.min_role);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.wms_has_role(%L))', r.tbl || '_delete', r.tbl, r.min_role);
    END LOOP;
END $$;

-- 4-3. 작업지시서 → 제조시방서 외래키 인덱스
CREATE INDEX IF NOT EXISTS idx_wms_secure_work_orders_recipe ON public.wms_secure_work_orders (recipe_id);
