-- ==============================================================================
-- 원료수불부 테이블 (wms_raw_ledger) 생성 + 로그인 보안 정책
-- ==============================================================================
-- 운영 DB에 이 테이블이 없어 원료수불부가 브라우저(localStorage)에만 저장되었다.
-- 전표 순서가 재고 누적 계산 순서이므로 seq(입력 순번)로 정렬한다.
-- 같은 규칙: 조회 VIEWER 이상, 추가/수정/삭제 OPERATOR 이상, 익명 차단.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_raw_ledger (
    id TEXT PRIMARY KEY,
    seq BIGSERIAL,                   -- 입력 순번 (재고 누적 순서)
    entry_date DATE NOT NULL,
    location TEXT NOT NULL DEFAULT '김포', -- 지역구분: 김포 / 본사 / 방산 / 김포2
    code TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '입고', -- 입고 / 사용 / 출고 / 재고조사 ...
    notes TEXT,
    in_qty NUMERIC NOT NULL DEFAULT 0,
    out_qty NUMERIC NOT NULL DEFAULT 0,
    stock_qty NUMERIC NOT NULL DEFAULT 0,
    weight NUMERIC NOT NULL DEFAULT 0,
    sg NUMERIC NOT NULL DEFAULT 1,
    dm NUMERIC NOT NULL DEFAULT 0,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    remark TEXT,
    worker TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- 원료코드: 품목코드와 다른 보안용 코드 (작업지시서에 원료 품명 대신 인쇄)
ALTER TABLE public.wms_raw_ledger ADD COLUMN IF NOT EXISTS raw_code TEXT;

CREATE INDEX IF NOT EXISTS idx_wms_raw_ledger_seq ON public.wms_raw_ledger (seq);
CREATE INDEX IF NOT EXISTS idx_wms_raw_ledger_name_loc ON public.wms_raw_ledger (name, location);

ALTER TABLE public.wms_raw_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_raw_ledger FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_raw_ledger TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.wms_raw_ledger_seq_seq TO authenticated;

DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wms_raw_ledger' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.wms_raw_ledger', p.policyname);
    END LOOP;
END $$;

CREATE POLICY "wms_raw_ledger_select" ON public.wms_raw_ledger
    FOR SELECT TO authenticated USING (public.wms_has_role('VIEWER'));
CREATE POLICY "wms_raw_ledger_write" ON public.wms_raw_ledger
    FOR ALL TO authenticated USING (public.wms_has_role('OPERATOR')) WITH CHECK (public.wms_has_role('OPERATOR'));
