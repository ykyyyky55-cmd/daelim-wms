-- ==============================================================================
-- wms_slips: 창고간 이동전표(WAREHOUSE, 번호 WT-YYYYMMDD-NNN) 종류 추가
-- ==============================================================================
-- 14_create_slips.sql 적용 후 실행한다. 여러 번 실행해도 안전하다.
-- ==============================================================================

ALTER TABLE public.wms_slips DROP CONSTRAINT IF EXISTS wms_slips_slip_type_check;
ALTER TABLE public.wms_slips ADD CONSTRAINT wms_slips_slip_type_check
    CHECK (slip_type IN ('TRANSFER', 'RELEASE', 'WAREHOUSE'));
