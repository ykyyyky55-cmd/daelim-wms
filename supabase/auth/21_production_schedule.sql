-- ==============================================================================
-- 생산(포장) 스케줄표 (wms_production_schedule)
-- ==============================================================================
-- 예전 엑셀 '생산스케즐 2026년.xlsx'(날짜별 시트 복사)를 한 주문 = 한 줄 표로 옮긴 것.
-- 캘린더 화면 아래 '생산 스케줄표'에서 입력·수정·인쇄·엑셀 내보내기를 한다.
--   site      : 본사 / 김포
--   line      : 포장1부 / 포장2부 / OEM·ODM 등 (자유 입력)
--   status    : HOLD(미정) · PLANNED(예정) · PREP(부자재 준비) · PRODUCING(생산중) · DONE(생산완료·출고대기) · SHIPPED(출고완료)
--   due_text / plan_text : '미정', '10월 초' 같은 글자 그대로, due_date / plan_date : 날짜로 읽히면 날짜
--   materials : { raw, container, label, inbox, outbox, safetyCap, paperCap } 원부자재 상태 글자 (발주 9/17, 재고, 완, 사급 …)
-- 규칙: 조회 VIEWER 이상, 입력·수정 OPERATOR 이상, 삭제 MANAGER 이상. 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_production_schedule (
    id TEXT PRIMARY KEY,
    site TEXT NOT NULL DEFAULT '본사',
    line TEXT,
    status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('HOLD', 'PLANNED', 'PREP', 'PRODUCING', 'DONE', 'SHIPPED')),
    order_date DATE,
    due_text TEXT,
    due_date DATE,
    plan_text TEXT,
    plan_date DATE,
    partner TEXT,
    manager TEXT,
    item_code TEXT,
    item_name TEXT NOT NULL,
    spec TEXT,
    qty NUMERIC,
    per_box NUMERIC,
    container TEXT,
    materials JSONB NOT NULL DEFAULT '{}'::jsonb,
    mats_done BOOLEAN NOT NULL DEFAULT FALSE,
    prod_start DATE,
    prod_end DATE,
    lot_no TEXT,
    ship_date DATE,
    notes TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS idx_wms_prod_sched_status ON public.wms_production_schedule (status, site, line, sort_order);

ALTER TABLE public.wms_production_schedule ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_production_schedule FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.wms_production_schedule FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_production_schedule TO authenticated;

DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wms_production_schedule' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.wms_production_schedule', p.policyname);
    END LOOP;
END $$;

CREATE POLICY "wms_prod_sched_select" ON public.wms_production_schedule FOR SELECT TO authenticated USING (public.wms_has_role('VIEWER'));
CREATE POLICY "wms_prod_sched_insert" ON public.wms_production_schedule FOR INSERT TO authenticated WITH CHECK (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_prod_sched_update" ON public.wms_production_schedule FOR UPDATE TO authenticated USING (public.wms_has_role('OPERATOR')) WITH CHECK (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_prod_sched_delete" ON public.wms_production_schedule FOR DELETE TO authenticated USING (public.wms_has_role('MANAGER'));
