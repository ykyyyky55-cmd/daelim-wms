-- ==============================================================================
-- 제품·자재 수불부 테이블 (wms_item_ledger) 생성 + 로그인 보안 정책
-- ==============================================================================
-- kind: 'product'(제품수불부, 완제품) / 'material'(자재수불부, 부자재·소모품·기타)
-- 원료·원액은 wms_raw_ledger(원료수불부)에 기록한다.
-- 전표 순서가 재고 누적 순서이므로 seq(입력 순번)로 정렬한다. location은 거점명이다.
-- 같은 규칙: 조회 VIEWER 이상, 추가/수정/삭제 OPERATOR 이상, 익명 차단.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_item_ledger (
    id TEXT PRIMARY KEY,
    seq BIGSERIAL,                    -- 입력 순번 (재고 누적 순서)
    kind TEXT NOT NULL CHECK (kind IN ('product', 'material')),
    entry_date DATE NOT NULL,
    location TEXT NOT NULL,           -- 거점: 본사 창고 / 김포공장 / 방산공장 / 김포2공장
    code TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '입고', -- 이월 / 입고 / 생산입고 / 출고 / 사용 / 이동입고 / 이동출고 / 재고조사
    notes TEXT,
    in_qty NUMERIC NOT NULL DEFAULT 0,
    out_qty NUMERIC NOT NULL DEFAULT 0,
    stock_qty NUMERIC NOT NULL DEFAULT 0,
    unit TEXT DEFAULT 'EA',
    remark TEXT,
    worker TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wms_item_ledger_kind_seq ON public.wms_item_ledger (kind, seq);
CREATE INDEX IF NOT EXISTS idx_wms_item_ledger_code_loc ON public.wms_item_ledger (code, location);

ALTER TABLE public.wms_item_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_item_ledger FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_item_ledger TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.wms_item_ledger_seq_seq TO authenticated;

DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wms_item_ledger' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.wms_item_ledger', p.policyname);
    END LOOP;
END $$;

CREATE POLICY "wms_item_ledger_select" ON public.wms_item_ledger
    FOR SELECT TO authenticated USING (public.wms_has_role('VIEWER'));
CREATE POLICY "wms_item_ledger_write" ON public.wms_item_ledger
    FOR ALL TO authenticated USING (public.wms_has_role('OPERATOR')) WITH CHECK (public.wms_has_role('OPERATOR'));
