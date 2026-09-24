-- ==============================================================================
-- [3단계] 익명 접근 차단 및 역할별 접근 정책 적용
-- ==============================================================================
-- ⚠️ 실행 전 확인: 새 로그인(Supabase Auth) 앱이 배포되어 있는지.
--    이 스크립트를 실행하면 로그인하지 않은 접근(anon 키만 가진 접근)은 데이터를 읽고 쓸 수 없다.
--    여러 번 실행해도 안전하며, DB에 없는 테이블(예: wms_schedules)은 건너뛴다.
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
    -- 정책 대상: 테이블, 명령, 최소 역할(USING/WITH CHECK)
    p RECORD;
BEGIN
    -- 1. 기존 정책 전부 제거(이름과 무관: "Public full access for ...", 앱 설정 화면 SQL의 "Allow anon all on ..." 등)
    --    및 익명 권한 회수. 남아 있는 "전부 허용" 정책이 새 정책과 OR로 합쳐져 승인 대기자까지 허용되는 것을 막는다.
    FOREACH t IN ARRAY ARRAY[
        'wms_categories', 'wms_locations', 'wms_workers', 'wms_users', 'wms_master_items',
        'wms_inventory', 'wms_history_logs', 'wms_audit_records', 'wms_schedules'
    ] LOOP
        CONTINUE WHEN to_regclass('public.' || t) IS NULL;
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
        END LOOP;
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END LOOP;

    -- 2. 조회: VIEWER 이상 (wms_users 제외)
    FOREACH t IN ARRAY ARRAY[
        'wms_categories', 'wms_locations', 'wms_workers', 'wms_master_items',
        'wms_inventory', 'wms_history_logs', 'wms_audit_records', 'wms_schedules'
    ] LOOP
        CONTINUE WHEN to_regclass('public.' || t) IS NULL;
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.wms_has_role(%L))',
            t || '_select', t, 'VIEWER'
        );
    END LOOP;

    -- 3. 쓰기 정책
    FOR p IN
        SELECT * FROM (VALUES
            -- 분류·거점·작업자·실사 기록: MANAGER 이상
            ('wms_categories',    '_write',  'ALL',    'MANAGER'),
            ('wms_locations',     '_write',  'ALL',    'MANAGER'),
            ('wms_workers',       '_write',  'ALL',    'MANAGER'),
            ('wms_audit_records', '_write',  'ALL',    'MANAGER'),
            -- 재고
            ('wms_inventory',     '_insert', 'INSERT', 'OPERATOR'),
            ('wms_inventory',     '_update', 'UPDATE', 'OPERATOR'),
            ('wms_inventory',     '_delete', 'DELETE', 'MANAGER'),
            -- 이력
            ('wms_history_logs',  '_insert', 'INSERT', 'OPERATOR'),
            ('wms_history_logs',  '_update', 'UPDATE', 'MANAGER'),
            ('wms_history_logs',  '_delete', 'DELETE', 'ADMIN'),
            -- 품목 마스터
            ('wms_master_items',  '_insert', 'INSERT', 'OPERATOR'),
            ('wms_master_items',  '_update', 'UPDATE', 'MANAGER'),
            ('wms_master_items',  '_delete', 'DELETE', 'MANAGER'),
            -- 일정
            ('wms_schedules',     '_write',  'ALL',    'OPERATOR')
        ) AS v(tbl, suffix, cmd, min_role)
    LOOP
        CONTINUE WHEN to_regclass('public.' || p.tbl) IS NULL;
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.tbl || p.suffix, p.tbl);
        IF p.cmd = 'INSERT' THEN
            EXECUTE format(
                'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.wms_has_role(%L))',
                p.tbl || p.suffix, p.tbl, p.min_role);
        ELSIF p.cmd = 'DELETE' THEN
            EXECUTE format(
                'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.wms_has_role(%L))',
                p.tbl || p.suffix, p.tbl, p.min_role);
        ELSE
            EXECUTE format(
                'CREATE POLICY %I ON public.%I FOR %s TO authenticated USING (public.wms_has_role(%L)) WITH CHECK (public.wms_has_role(%L))',
                p.tbl || p.suffix, p.tbl, p.cmd, p.min_role, p.min_role);
        END IF;
    END LOOP;

    -- 4. 예전 사용자 테이블: 정책 없음 = 전부 차단. 로그인 사용자 권한도 회수
    IF to_regclass('public.wms_users') IS NOT NULL THEN
        REVOKE ALL ON public.wms_users FROM authenticated;
    END IF;
END $$;
