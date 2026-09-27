-- ==============================================================================
-- 생산관리: 구매요청서(PURCH_REQ) 추가 — wms_plans
-- ==============================================================================
-- 생산요청서(PROD_REQ, 제품·원액은 data.reqType으로 구분)와 같은 방식으로 구매요청서를 둔다.
-- 입력·수정은 OPERATOR 이상, 삭제는 MANAGER 이상. 27_production_planning.sql 적용 후 실행. 여러 번 실행해도 안전하다.
-- ==============================================================================

ALTER TABLE public.wms_plans DROP CONSTRAINT IF EXISTS wms_plans_kind_check;
ALTER TABLE public.wms_plans ADD CONSTRAINT wms_plans_kind_check
    CHECK (kind IN ('PROD_WEEK', 'PURCH_WEEK', 'PROD_MONTH', 'PURCH_MONTH', 'PROD_REQ', 'PURCH_REQ'));

-- 주간·월간 계획만 기간마다 하나 (요청서는 여러 장)
DROP INDEX IF EXISTS public.uq_wms_plans_period;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_plans_period ON public.wms_plans (kind, period) WHERE kind NOT IN ('PROD_REQ', 'PURCH_REQ');

DROP POLICY IF EXISTS "wms_plans_insert" ON public.wms_plans;
DROP POLICY IF EXISTS "wms_plans_update" ON public.wms_plans;
CREATE POLICY "wms_plans_insert" ON public.wms_plans FOR INSERT TO authenticated
    WITH CHECK (public.wms_has_role('MANAGER') OR (kind IN ('PROD_REQ', 'PURCH_REQ') AND public.wms_has_role('OPERATOR')));
CREATE POLICY "wms_plans_update" ON public.wms_plans FOR UPDATE TO authenticated
    USING (public.wms_has_role('MANAGER') OR (kind IN ('PROD_REQ', 'PURCH_REQ') AND public.wms_has_role('OPERATOR')))
    WITH CHECK (public.wms_has_role('MANAGER') OR (kind IN ('PROD_REQ', 'PURCH_REQ') AND public.wms_has_role('OPERATOR')));
