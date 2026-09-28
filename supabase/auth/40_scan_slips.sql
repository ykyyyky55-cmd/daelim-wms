-- ==========================================
-- 40. 전표 스캔 등록 기록 (전표관리 화면에 발행 전표와 함께 표시)
-- ==========================================
-- 전표 스캔 등록 화면에서 [체크한 줄 … 등록]을 누를 때마다 한 건(등록번호 SC-YYYYMMDD-NNN)을 남긴다.
-- 재고·수불부는 등록할 때 processStockAction으로 이미 반영되므로, 이 표는 기록(무엇을·언제·어느 전표로)만 담는다.
--   slip_kind : 전표 종류 IN 입고 · OUT 출고 · USE 사용 · MOVE 이동 · BUY 구매 · CARD 카드사용 · DISPOSE 폐기 · ETC 기타
--   action    : 재고 처리 IN · OUT · USE · MOVE
--   items     : [{ code, name, spec, qty, unit, baseQty, baseUnit, sg, text }]  (qty/unit = 전표에 적힌 값, baseQty/baseUnit = 재고에 반영한 값)
--   files     : 전표 사진 [{ path, name, mime, size }]  (버킷 wms-files의 scans/<id>/…)
-- 권한: 조회 VIEWER·경영자 / 기록 OPERATOR 이상 / 삭제 기록한 사람 또는 MANAGER (기록만 지움, 재고는 그대로)

CREATE TABLE IF NOT EXISTS public.wms_scan_slips (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reg_no          text UNIQUE,
    slip_kind       text NOT NULL CHECK (slip_kind IN ('IN', 'OUT', 'USE', 'MOVE', 'BUY', 'CARD', 'DISPOSE', 'ETC')),
    action          text NOT NULL CHECK (action IN ('IN', 'OUT', 'USE', 'MOVE')),
    slip_date       date NOT NULL DEFAULT current_date,
    partner         text DEFAULT '',
    doc_no          text DEFAULT '',
    from_loc        text DEFAULT '',
    to_loc          text DEFAULT '',
    worker          text DEFAULT '',
    items           jsonb NOT NULL DEFAULT '[]'::jsonb,
    files           jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by      uuid DEFAULT auth.uid(),
    created_by_name text DEFAULT '',
    created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_scan_slips_date_idx ON public.wms_scan_slips (slip_date DESC);

-- 등록번호: SC-YYYYMMDD-001 (전표 일자별 일련번호)
CREATE OR REPLACE FUNCTION public.wms_scan_slips_reg_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text; v_next int;
BEGIN
    IF NEW.reg_no IS NOT NULL AND NEW.reg_no <> '' THEN RETURN NEW; END IF;
    v_prefix := 'SC-' || to_char(NEW.slip_date, 'YYYYMMDD') || '-';
    PERFORM pg_advisory_xact_lock(hashtext('wms_scan_slips_reg_no:' || v_prefix));
    SELECT coalesce(max(substring(reg_no FROM length(v_prefix) + 1)::int), 0) + 1 INTO v_next
      FROM public.wms_scan_slips WHERE reg_no LIKE v_prefix || '%' AND substring(reg_no FROM length(v_prefix) + 1) ~ '^\d+$';
    NEW.reg_no := v_prefix || lpad(v_next::text, 3, '0');
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wms_scan_slips_reg_no_trg ON public.wms_scan_slips;
CREATE TRIGGER wms_scan_slips_reg_no_trg BEFORE INSERT ON public.wms_scan_slips FOR EACH ROW EXECUTE FUNCTION public.wms_scan_slips_reg_no();

ALTER TABLE public.wms_scan_slips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_scan_slips_select ON public.wms_scan_slips;
DROP POLICY IF EXISTS wms_scan_slips_insert ON public.wms_scan_slips;
DROP POLICY IF EXISTS wms_scan_slips_update ON public.wms_scan_slips;
DROP POLICY IF EXISTS wms_scan_slips_delete ON public.wms_scan_slips;
CREATE POLICY wms_scan_slips_select ON public.wms_scan_slips FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_scan_slips_insert ON public.wms_scan_slips FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
-- 사진을 나중에 붙이는 것(files)만: 기록한 사람 또는 MANAGER
CREATE POLICY wms_scan_slips_update ON public.wms_scan_slips FOR UPDATE TO authenticated
    USING (created_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')))
    WITH CHECK (created_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_scan_slips_delete ON public.wms_scan_slips FOR DELETE TO authenticated
    USING (created_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_scan_slips TO authenticated;
