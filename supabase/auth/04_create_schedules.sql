-- ==============================================================================
-- 일정 관리 테이블 (wms_schedules) 생성 + 로그인 보안 정책
-- ==============================================================================
-- 운영 DB는 초기 설정 때 이 테이블이 만들어지지 않아 캘린더 일정이 클라우드에 저장되지 않았다.
-- 3단계(02_lock_down_policies.sql)와 같은 규칙: 조회 VIEWER 이상, 추가/수정/삭제 OPERATOR 이상, 익명 차단.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_schedules (
    id TEXT PRIMARY KEY,
    schedule_date DATE NOT NULL,
    type TEXT NOT NULL,          -- 'IN_PLAN', 'OUT_PLAN', 'AUDIT', 'MAINTENANCE', 'ORDER_DEADLINE', 'TRAINING', 'OTHER'
    title TEXT NOT NULL,
    item_code TEXT,
    item_name TEXT,
    partner TEXT,
    worker TEXT,
    notes TEXT,
    status TEXT DEFAULT 'TODO',  -- 'TODO', 'DONE'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.wms_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_schedules FROM anon;

DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wms_schedules' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.wms_schedules', p.policyname);
    END LOOP;
END $$;

CREATE POLICY "wms_schedules_select" ON public.wms_schedules
    FOR SELECT TO authenticated USING (public.wms_has_role('VIEWER'));
CREATE POLICY "wms_schedules_write" ON public.wms_schedules
    FOR ALL TO authenticated USING (public.wms_has_role('OPERATOR')) WITH CHECK (public.wms_has_role('OPERATOR'));
