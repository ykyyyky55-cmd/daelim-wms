-- ==============================================================================
-- 본사 생산 업무일지 테이블 (wms_hq_logs) — 김포 업무일지(wms_gimpo_logs, 10번)와 같은 양식
-- ==============================================================================
-- 메뉴 '업무일지(생산)' 아래 업무일지(본사)·업무일지(김포). 하루 1건(log_date), 내용 전체는 data(JSONB).
-- 같은 규칙: 조회 VIEWER 이상, 추가/수정/삭제 OPERATOR 이상, 익명 차단.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_hq_logs (
    log_date TEXT PRIMARY KEY,        -- YYYY-MM-DD
    sheet_name TEXT,                  -- MMDD
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.wms_hq_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_hq_logs FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.wms_hq_logs FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_hq_logs TO authenticated;

DROP POLICY IF EXISTS "wms_hq_logs_select" ON public.wms_hq_logs;
DROP POLICY IF EXISTS "wms_hq_logs_insert" ON public.wms_hq_logs;
DROP POLICY IF EXISTS "wms_hq_logs_update" ON public.wms_hq_logs;
DROP POLICY IF EXISTS "wms_hq_logs_delete" ON public.wms_hq_logs;
CREATE POLICY "wms_hq_logs_select" ON public.wms_hq_logs
    FOR SELECT TO authenticated USING (public.wms_has_role('VIEWER'));
CREATE POLICY "wms_hq_logs_insert" ON public.wms_hq_logs
    FOR INSERT TO authenticated WITH CHECK (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_hq_logs_update" ON public.wms_hq_logs
    FOR UPDATE TO authenticated USING (public.wms_has_role('OPERATOR')) WITH CHECK (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_hq_logs_delete" ON public.wms_hq_logs
    FOR DELETE TO authenticated USING (public.wms_has_role('OPERATOR'));
