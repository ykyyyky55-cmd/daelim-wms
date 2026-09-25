-- ==============================================================================
-- 김포 생산 업무일지 테이블 (wms_gimpo_logs) 생성 + 로그인 보안 정책
-- ==============================================================================
-- 업무일지는 예전에는 JS 번들(enterpriseData.json)과 각 브라우저 localStorage에만 있었다.
-- 앱이 GitHub Pages로 공개 배포되므로 번들에서 업무 데이터를 빼고 이 테이블에 둔다.
-- 하루 1건(log_date), 일지 내용 전체는 data(JSONB)에 저장한다.
-- 같은 규칙: 조회 VIEWER 이상, 추가/수정/삭제 OPERATOR 이상, 익명 차단.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_gimpo_logs (
    log_date TEXT PRIMARY KEY,        -- YYYY-MM-DD
    sheet_name TEXT,                  -- 원본 엑셀 시트명 (MMDD)
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.wms_gimpo_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_gimpo_logs FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.wms_gimpo_logs FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_gimpo_logs TO authenticated;

DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wms_gimpo_logs' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.wms_gimpo_logs', p.policyname);
    END LOOP;
END $$;

CREATE POLICY "wms_gimpo_logs_select" ON public.wms_gimpo_logs
    FOR SELECT TO authenticated USING (public.wms_has_role('VIEWER'));
CREATE POLICY "wms_gimpo_logs_insert" ON public.wms_gimpo_logs
    FOR INSERT TO authenticated WITH CHECK (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_gimpo_logs_update" ON public.wms_gimpo_logs
    FOR UPDATE TO authenticated USING (public.wms_has_role('OPERATOR')) WITH CHECK (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_gimpo_logs_delete" ON public.wms_gimpo_logs
    FOR DELETE TO authenticated USING (public.wms_has_role('OPERATOR'));
