-- ==============================================================================
-- 생산 스케줄표: 작성일자별 관리 (예전 엑셀의 날짜별 시트처럼)
-- ==============================================================================
-- sheet_date : 작성일자. 같은 작성일자의 줄들이 그날의 스케줄 한 장(엑셀 시트 한 장)이다.
-- 화면은 작성일자를 골라 보고, [새 작성일자]로 이전 날짜 내용을 복사해 이어 쓴다.
-- wms_prod_schedule_dates(): 작성일자별 줄 수 (날짜 칩·월 필터용, RLS 그대로 적용)
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

ALTER TABLE public.wms_production_schedule ADD COLUMN IF NOT EXISTS sheet_date DATE;
UPDATE public.wms_production_schedule SET sheet_date = COALESCE(sheet_date, created_at::date) WHERE sheet_date IS NULL;
ALTER TABLE public.wms_production_schedule ALTER COLUMN sheet_date SET DEFAULT CURRENT_DATE;
ALTER TABLE public.wms_production_schedule ALTER COLUMN sheet_date SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wms_prod_sched_sheet ON public.wms_production_schedule (sheet_date, sort_order);

CREATE OR REPLACE FUNCTION public.wms_prod_schedule_dates()
RETURNS TABLE (sheet_date DATE, row_count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
    SELECT sheet_date, COUNT(*) FROM public.wms_production_schedule GROUP BY sheet_date ORDER BY sheet_date DESC;
$$;
REVOKE ALL ON FUNCTION public.wms_prod_schedule_dates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_prod_schedule_dates() TO authenticated;
