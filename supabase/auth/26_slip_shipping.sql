-- ==============================================================================
-- wms_slips: 출하 검수(QR) 완료 기록
-- ==============================================================================
-- 현장 스캔 화면에서 전표 QR → 품목 QR을 스캔해 검수하고 [출고 처리]하면 전표에 출고 완료를 남긴다.
-- 같은 전표를 두 번 출고하지 않도록, 앱은 재고를 바꾸기 전에 wms_mark_slip_shipped로 먼저 '출고 완료'를 잡는다
-- (이미 완료된 전표면 false). 전표 수정 권한(MANAGER)이 없는 OPERATOR도 출고 완료만은 기록할 수 있게 함수로 둔다.
-- 14_create_slips.sql 적용 후 실행한다. 여러 번 실행해도 안전하다.
-- ==============================================================================

ALTER TABLE public.wms_slips ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE public.wms_slips ADD COLUMN IF NOT EXISTS shipped_by TEXT;
ALTER TABLE public.wms_slips ADD COLUMN IF NOT EXISTS ship_check JSONB; -- [{ code, name, unit, qty, scanned, lots }]

CREATE OR REPLACE FUNCTION public.wms_mark_slip_shipped(p_doc_no TEXT, p_worker TEXT, p_check JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    n INTEGER;
BEGIN
    IF NOT public.wms_has_role('OPERATOR') THEN
        RAISE EXCEPTION '출고 처리 권한이 없습니다 (작업자 이상).';
    END IF;
    UPDATE public.wms_slips
       SET shipped_at = NOW(), shipped_by = p_worker, ship_check = p_check
     WHERE doc_no = p_doc_no AND shipped_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.wms_mark_slip_shipped(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_mark_slip_shipped(TEXT, TEXT, JSONB) TO authenticated;
