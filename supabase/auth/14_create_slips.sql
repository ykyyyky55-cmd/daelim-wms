-- ==============================================================================
-- 이동전표 / 출고요청서 발행 기록 (wms_slips)
-- ==============================================================================
-- 환경설정 → '거래 출하 전표 발행기'에서 발행한 전표를 저장한다.
-- 전표번호(doc_no)는 종류·날짜별 일련번호(TR-20260926-001, RQ-20260926-002 …)이며 중복될 수 없다.
-- 전표 발행은 서류만 남긴다 (재고 이동은 입출고 화면에서 처리).
-- 규칙: 조회 VIEWER 이상, 발행 OPERATOR 이상, 수정·삭제 MANAGER 이상, 익명 차단.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_slips (
    id TEXT PRIMARY KEY,
    doc_no TEXT NOT NULL UNIQUE,
    slip_type TEXT NOT NULL CHECK (slip_type IN ('TRANSFER', 'RELEASE')),
    issue_date DATE NOT NULL,
    from_loc TEXT,
    to_loc TEXT,
    partner TEXT,
    transport TEXT,
    reason TEXT,
    worker TEXT,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ code, name, spec, unit, qty, note }]
    created_by UUID DEFAULT auth.uid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wms_slips_date ON public.wms_slips (issue_date DESC, doc_no DESC);

ALTER TABLE public.wms_slips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_slips FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.wms_slips FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_slips TO authenticated;

DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wms_slips' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.wms_slips', p.policyname);
    END LOOP;
END $$;

CREATE POLICY "wms_slips_select" ON public.wms_slips
    FOR SELECT TO authenticated USING (public.wms_has_role('VIEWER'));
CREATE POLICY "wms_slips_insert" ON public.wms_slips
    FOR INSERT TO authenticated WITH CHECK (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_slips_update" ON public.wms_slips
    FOR UPDATE TO authenticated USING (public.wms_has_role('MANAGER')) WITH CHECK (public.wms_has_role('MANAGER'));
CREATE POLICY "wms_slips_delete" ON public.wms_slips
    FOR DELETE TO authenticated USING (public.wms_has_role('MANAGER'));
