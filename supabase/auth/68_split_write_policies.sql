-- ==========================================
-- 68. 쓰기 정책을 INSERT·UPDATE·DELETE로 나눔 (성능 점검 multiple_permissive_policies)
-- ==========================================
-- 63·65·66번 표의 FOR ALL 쓰기 정책이 SELECT에도 걸려, 조회 때 조회 정책과 함께 두 번 검사됐다.
-- 권한 내용은 그대로(조회 = 각 _select 정책, 쓰기 = 아래 역할)이고 SELECT만 한 번 검사된다.
DO $$
DECLARE
    t record;
    act text;
BEGIN
    FOR t IN SELECT * FROM (VALUES
        ('wms_erp_master', 'MANAGER'), ('wms_erp_map', 'MANAGER'),
        ('wms_warehouse_zones', 'MANAGER'), ('wms_zone_loads', 'OPERATOR')
    ) AS v(tbl, role) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_write', t.tbl);
        FOREACH act IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_' || act, t.tbl);
        END LOOP;
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.wms_has_role(%L)))', t.tbl || '_insert', t.tbl, t.role);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.wms_has_role(%L))) WITH CHECK ((SELECT public.wms_has_role(%L)))', t.tbl || '_update', t.tbl, t.role, t.role);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT public.wms_has_role(%L)))', t.tbl || '_delete', t.tbl, t.role);
    END LOOP;
END $$;
