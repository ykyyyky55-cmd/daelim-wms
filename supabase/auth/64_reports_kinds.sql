-- ==========================================
-- 보고서 종류 추가: OVERVIEW(종합현황 월간 보고서) · QMEETING(품질회의 자료)
-- ==========================================
-- 39_reports.sql의 kind 검사는 MEETING·DOC만 허용해서, 종합현황 월간 보고서 자동 보관과
-- 월간 실적 현황판 → 품질회의 자료 올리기가 "wms_reports_kind_check" 위반으로 저장되지 않았다.
ALTER TABLE public.wms_reports DROP CONSTRAINT IF EXISTS wms_reports_kind_check;
ALTER TABLE public.wms_reports ADD CONSTRAINT wms_reports_kind_check
    CHECK (kind IN ('MEETING', 'DOC', 'OVERVIEW', 'QMEETING'));
