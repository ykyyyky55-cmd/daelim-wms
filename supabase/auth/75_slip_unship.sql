-- ==============================================================================
-- 75. wms_slips: 출고 완료를 출고 대기로 되돌리기 (전표관리 화면 — components/SlipManager.js)
-- ==============================================================================
-- 잘못 출고 완료로 처리한 전표를 다시 출고 대기로 돌린다(shipped_at·shipped_by·ship_check를 비움).
-- 전표 수정과 같은 권한(MANAGER 이상). 재고는 이 함수가 바꾸지 않는다 — 재고를 되돌릴지는 앱이 따로 처리한다.
-- 이미 출고 대기면 false. 26_slip_shipping.sql 적용 후 실행한다. 여러 번 실행해도 안전하다.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.wms_unmark_slip_shipped(p_doc_no TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    n INTEGER;
BEGIN
    IF NOT public.wms_has_role('MANAGER') THEN
        RAISE EXCEPTION '출고 완료를 되돌릴 권한이 없습니다 (매니저 이상).';
    END IF;
    UPDATE public.wms_slips
       SET shipped_at = NULL, shipped_by = NULL, ship_check = NULL
     WHERE doc_no = p_doc_no AND shipped_at IS NOT NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.wms_unmark_slip_shipped(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_unmark_slip_shipped(TEXT) TO authenticated;
