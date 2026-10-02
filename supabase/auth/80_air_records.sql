-- ==========================================
-- 80. 생산관리 → 환경관리(대기): 대기배출시설 및 방지시설 운영기록부 (components/AirRecords.js, public/air/)
-- ==========================================
-- 따로 있던 운영기록부 앱(daelim-air)의 기록을 WMS DB로 옮겨 담는 표. 하루에 한 줄.
--   record_date = 기록 일자 (기본키)
--   record_data = 운영기록부 한 장 전체 (배출구 가동시간·방지시설·자가측정·연료/원료·환경기술인 의견·결재 도장 등, 예전 앱의 JSON 그대로)
--   status      = NORMAL(정상 가동) · IDLE(미가동) · HOLIDAY(휴무)
-- 권한: 조회 = 승인된 사용자 모두(조회 전용·경영자 포함), 작성·수정·삭제 = 매니저 이상 (법정 기록이라 현장 작업자는 고치지 못한다).
-- 여러 번 실행해도 안전하다.
CREATE TABLE IF NOT EXISTS public.wms_air_records (
    record_date date PRIMARY KEY,
    record_data jsonb NOT NULL,
    status text NOT NULL DEFAULT 'NORMAL',
    updated_by_name text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT wms_air_records_status_check CHECK (status IN ('NORMAL', 'IDLE', 'HOLIDAY')),
    CONSTRAINT wms_air_records_data_object CHECK (jsonb_typeof(record_data) = 'object')
);
ALTER TABLE public.wms_air_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wms_air_records_select ON public.wms_air_records;
DROP POLICY IF EXISTS wms_air_records_insert ON public.wms_air_records;
DROP POLICY IF EXISTS wms_air_records_update ON public.wms_air_records;
DROP POLICY IF EXISTS wms_air_records_delete ON public.wms_air_records;
CREATE POLICY wms_air_records_select ON public.wms_air_records FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_air_records_insert ON public.wms_air_records FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_air_records_update ON public.wms_air_records FOR UPDATE TO authenticated
    USING ((SELECT public.wms_has_role('MANAGER'))) WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_air_records_delete ON public.wms_air_records FOR DELETE TO authenticated
    USING ((SELECT public.wms_has_role('MANAGER')));
