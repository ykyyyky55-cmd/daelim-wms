-- ==============================================================================
-- 생산관리: 업무추진계획서 (월간 WORK_MONTH · 연간 WORK_YEAR) — wms_plans
-- ==============================================================================
-- 한 달(period = YYYY-MM)·한 해(period = YYYY)에 문서 하나. 추진과제·진행률·실적은 data JSONB(tasks).
-- 권한은 다른 계획과 같다: 조회 VIEWER 이상, 입력·수정·삭제 MANAGER 이상.
-- 29_purchase_request.sql 적용 후 실행. 여러 번 실행해도 안전하다.
-- ==============================================================================

ALTER TABLE public.wms_plans DROP CONSTRAINT IF EXISTS wms_plans_kind_check;
ALTER TABLE public.wms_plans ADD CONSTRAINT wms_plans_kind_check
    CHECK (kind IN ('PROD_WEEK', 'PURCH_WEEK', 'PROD_MONTH', 'PURCH_MONTH', 'PROD_REQ', 'PURCH_REQ', 'WORK_MONTH', 'WORK_YEAR'));
