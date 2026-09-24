-- ==============================================================================
-- [3단계] 익명 접근 차단 및 역할별 접근 정책 적용
-- ==============================================================================
-- ⚠️ 실행 전 확인: 새 로그인(Supabase Auth) 앱이 배포되어 있고, 사용자 모두가 가입·승인을 마쳤는지.
--    이 스크립트를 실행하면 예전 앱(아이디/비밀번호 로그인)과 로그인하지 않은 접근은 데이터를 읽고 쓸 수 없다.
--    여러 번 실행해도 안전하다.
--
-- 역할별 권한 (앱의 canPerformAction과 대응)
--   조회                               : VIEWER 이상
--   재고 입출고·이동·생산 (wms_inventory) : 추가/수정 OPERATOR 이상, 삭제 MANAGER 이상
--   이력 (wms_history_logs)             : 추가 OPERATOR 이상, 수정 MANAGER 이상(품목코드 전환), 삭제 ADMIN 이상
--   품목 마스터 (wms_master_items)        : 추가 OPERATOR 이상(김포 일지 반영 시 임시 품목 자동 등록),
--                                        수정/삭제 MANAGER 이상
--   일정 (wms_schedules)                : 추가/수정/삭제 OPERATOR 이상
--   분류·거점·작업자·실사 기록            : 추가/수정/삭제 MANAGER 이상
--   예전 사용자 테이블 (wms_users)        : 모두 차단 (평문 비밀번호 보호)
--   PENDING(승인 대기) 및 비로그인        : 모두 차단
-- ==============================================================================

DO $$
DECLARE
    t TEXT;
BEGIN
    -- 1. 기존 "Public full access" 정책 제거 및 익명 권한 회수
    FOREACH t IN ARRAY ARRAY[
        'wms_categories', 'wms_locations', 'wms_workers', 'wms_users', 'wms_master_items',
        'wms_inventory', 'wms_history_logs', 'wms_audit_records', 'wms_schedules'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Public full access for ' || t, t);
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END LOOP;

    -- 2. 조회: VIEWER 이상 (wms_users 제외)
    FOREACH t IN ARRAY ARRAY[
        'wms_categories', 'wms_locations', 'wms_workers', 'wms_master_items',
        'wms_inventory', 'wms_history_logs', 'wms_audit_records', 'wms_schedules'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.wms_has_role(%L))',
            t || '_select', t, 'VIEWER'
        );
    END LOOP;

    -- 3. 분류·거점·작업자·실사 기록: MANAGER 이상 쓰기
    FOREACH t IN ARRAY ARRAY['wms_categories', 'wms_locations', 'wms_workers', 'wms_audit_records'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.wms_has_role(%L)) WITH CHECK (public.wms_has_role(%L))',
            t || '_write', t, 'MANAGER', 'MANAGER'
        );
    END LOOP;
END $$;

-- 4. 재고
DROP POLICY IF EXISTS "wms_inventory_insert" ON public.wms_inventory;
CREATE POLICY "wms_inventory_insert" ON public.wms_inventory
    FOR INSERT TO authenticated WITH CHECK (public.wms_has_role('OPERATOR'));
DROP POLICY IF EXISTS "wms_inventory_update" ON public.wms_inventory;
CREATE POLICY "wms_inventory_update" ON public.wms_inventory
    FOR UPDATE TO authenticated USING (public.wms_has_role('OPERATOR')) WITH CHECK (public.wms_has_role('OPERATOR'));
DROP POLICY IF EXISTS "wms_inventory_delete" ON public.wms_inventory;
CREATE POLICY "wms_inventory_delete" ON public.wms_inventory
    FOR DELETE TO authenticated USING (public.wms_has_role('MANAGER'));

-- 5. 이력
DROP POLICY IF EXISTS "wms_history_logs_insert" ON public.wms_history_logs;
CREATE POLICY "wms_history_logs_insert" ON public.wms_history_logs
    FOR INSERT TO authenticated WITH CHECK (public.wms_has_role('OPERATOR'));
DROP POLICY IF EXISTS "wms_history_logs_update" ON public.wms_history_logs;
CREATE POLICY "wms_history_logs_update" ON public.wms_history_logs
    FOR UPDATE TO authenticated USING (public.wms_has_role('MANAGER')) WITH CHECK (public.wms_has_role('MANAGER'));
DROP POLICY IF EXISTS "wms_history_logs_delete" ON public.wms_history_logs;
CREATE POLICY "wms_history_logs_delete" ON public.wms_history_logs
    FOR DELETE TO authenticated USING (public.wms_has_role('ADMIN'));

-- 6. 품목 마스터
DROP POLICY IF EXISTS "wms_master_items_insert" ON public.wms_master_items;
CREATE POLICY "wms_master_items_insert" ON public.wms_master_items
    FOR INSERT TO authenticated WITH CHECK (public.wms_has_role('OPERATOR'));
DROP POLICY IF EXISTS "wms_master_items_update" ON public.wms_master_items;
CREATE POLICY "wms_master_items_update" ON public.wms_master_items
    FOR UPDATE TO authenticated USING (public.wms_has_role('MANAGER')) WITH CHECK (public.wms_has_role('MANAGER'));
DROP POLICY IF EXISTS "wms_master_items_delete" ON public.wms_master_items;
CREATE POLICY "wms_master_items_delete" ON public.wms_master_items
    FOR DELETE TO authenticated USING (public.wms_has_role('MANAGER'));

-- 7. 일정
DROP POLICY IF EXISTS "wms_schedules_write" ON public.wms_schedules;
CREATE POLICY "wms_schedules_write" ON public.wms_schedules
    FOR ALL TO authenticated USING (public.wms_has_role('OPERATOR')) WITH CHECK (public.wms_has_role('OPERATOR'));

-- 8. 예전 사용자 테이블: 정책 없음 = 전부 차단. 로그인 사용자 권한도 회수
REVOKE ALL ON public.wms_users FROM authenticated;
