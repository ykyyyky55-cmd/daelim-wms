-- ==============================================================================
-- 생산관리: 생산계획 · 구매계획 · 생산요청서 (wms_plans) + 제품 BOM (wms_product_boms)
-- ==============================================================================
-- wms_plans 한 줄 = 문서 하나. 내용(머리·줄)은 data JSONB.
--   kind PROD_WEEK  : 주간 생산계획 (period = 그 주 월요일 YYYY-MM-DD). 줄마다 날짜가 있어 일일 생산계획은 이 줄들을 날짜로 본 것.
--   kind PURCH_WEEK : 주간 구매계획 (period = 월요일)
--   kind PROD_MONTH / PURCH_MONTH : 월간 계획의 머리(비고·결재)만 (period = YYYY-MM). 줄은 주간 계획을 취합해 화면에서 계산한다.
--   kind PROD_REQ   : 생산요청서 (period = 요청일, doc_no = PR-YYYYMMDD-NNN)
-- wms_product_boms: 완제품 1단위당 원액·부자재 소요량 (제품생산 화면의 '배합비 저장'). 원액의 원료 배합은 넣지 않는다
--   (보안 배합은 wms_recipes 전용. 앱이 원액 품목의 배합은 이 표에 올리지 않음).
-- 규칙: 조회 VIEWER 이상 / 계획 입력·수정 MANAGER 이상 / 생산요청서 입력·수정 OPERATOR 이상 / 삭제 MANAGER 이상
--       BOM 입력·수정 OPERATOR 이상, 삭제 MANAGER 이상. 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_plans (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('PROD_WEEK', 'PURCH_WEEK', 'PROD_MONTH', 'PURCH_MONTH', 'PROD_REQ')),
    period TEXT NOT NULL,
    doc_no TEXT,
    status TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID DEFAULT auth.uid(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT
);
-- 주간·월간 계획은 기간마다 하나, 생산요청서 번호는 겹치지 않게
CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_plans_period ON public.wms_plans (kind, period) WHERE kind <> 'PROD_REQ';
CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_plans_docno ON public.wms_plans (doc_no) WHERE doc_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wms_plans_kind_period ON public.wms_plans (kind, period DESC);

ALTER TABLE public.wms_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_plans FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.wms_plans FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_plans TO authenticated;

CREATE TABLE IF NOT EXISTS public.wms_product_boms (
    code TEXT PRIMARY KEY,
    raw_list JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ code, rate }] 단위당 원액(L)
    sub_list JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ code, rate }] 단위당 부자재
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT
);
ALTER TABLE public.wms_product_boms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_product_boms FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.wms_product_boms FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_product_boms TO authenticated;

DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('wms_plans', 'wms_product_boms') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
    END LOOP;
END $$;

CREATE POLICY "wms_plans_select" ON public.wms_plans FOR SELECT TO authenticated USING (public.wms_has_role('VIEWER'));
CREATE POLICY "wms_plans_insert" ON public.wms_plans FOR INSERT TO authenticated
    WITH CHECK (public.wms_has_role('MANAGER') OR (kind = 'PROD_REQ' AND public.wms_has_role('OPERATOR')));
CREATE POLICY "wms_plans_update" ON public.wms_plans FOR UPDATE TO authenticated
    USING (public.wms_has_role('MANAGER') OR (kind = 'PROD_REQ' AND public.wms_has_role('OPERATOR')))
    WITH CHECK (public.wms_has_role('MANAGER') OR (kind = 'PROD_REQ' AND public.wms_has_role('OPERATOR')));
CREATE POLICY "wms_plans_delete" ON public.wms_plans FOR DELETE TO authenticated USING (public.wms_has_role('MANAGER'));

CREATE POLICY "wms_boms_select" ON public.wms_product_boms FOR SELECT TO authenticated USING (public.wms_has_role('VIEWER'));
CREATE POLICY "wms_boms_insert" ON public.wms_product_boms FOR INSERT TO authenticated WITH CHECK (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_boms_update" ON public.wms_product_boms FOR UPDATE TO authenticated USING (public.wms_has_role('OPERATOR')) WITH CHECK (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_boms_delete" ON public.wms_product_boms FOR DELETE TO authenticated USING (public.wms_has_role('MANAGER'));
