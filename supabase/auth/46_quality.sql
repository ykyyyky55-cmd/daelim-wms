-- ==========================================
-- 46. 품질관리 (메뉴 품질관리: 제품관리 · 공정관리 · 원부자재관리 · 설비관리 · MSDS관리)
-- ==========================================
-- wms_qc_records 한 줄 = 기록 하나 (내용은 data JSONB, 앱 services/quality.js)
--   kind INSPECT : 검사·불량 기록 (data.area = PRODUCT 제품 출하검사 / PROCESS 공정검사 / MATERIAL 원부자재 수입검사)
--                  검사수량·불량수량·불량 유형별 수량·판정·원인·조치 → 불량률 = 불량수량 ÷ 검사수량
--   kind EQUIP   : 설비 대장 (코드·이름·위치·점검 주기 …)
--   kind EQUIP_LOG : 설비 점검·수리·교정 이력 (data.equipId)
--   kind MSDS    : 물질안전보건자료 대장 (품목·공급처·개정일·다음 검토일, 파일은 wms_attachments 문서키 MSDS:<id>)
--   kind CFG     : 설정 (id CFG:DEFECT:<영역> = 불량 유형 목록·목표 불량률)
-- 권한: 조회 VIEWER·경영자 / 기록 쓰기 OPERATOR 이상 / 설정(CFG) 쓰기 MANAGER 이상 / 삭제 쓴 사람 또는 MANAGER 이상

CREATE TABLE IF NOT EXISTS public.wms_qc_records (
    id              text PRIMARY KEY,
    kind            text NOT NULL CHECK (kind IN ('INSPECT', 'EQUIP', 'EQUIP_LOG', 'MSDS', 'CFG')),
    rec_date        date,
    data            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid DEFAULT auth.uid(),
    created_by_name text DEFAULT '',
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_qc_records_kind_date_idx ON public.wms_qc_records (kind, rec_date DESC);

ALTER TABLE public.wms_qc_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_qc_records_select ON public.wms_qc_records;
DROP POLICY IF EXISTS wms_qc_records_insert ON public.wms_qc_records;
DROP POLICY IF EXISTS wms_qc_records_update ON public.wms_qc_records;
DROP POLICY IF EXISTS wms_qc_records_delete ON public.wms_qc_records;
CREATE POLICY wms_qc_records_select ON public.wms_qc_records FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_qc_records_insert ON public.wms_qc_records FOR INSERT TO authenticated
    WITH CHECK (CASE WHEN kind = 'CFG' THEN (SELECT public.wms_has_role('MANAGER')) ELSE (SELECT public.wms_has_role('OPERATOR')) END);
CREATE POLICY wms_qc_records_update ON public.wms_qc_records FOR UPDATE TO authenticated
    USING (CASE WHEN kind = 'CFG' THEN (SELECT public.wms_has_role('MANAGER')) ELSE (SELECT public.wms_has_role('OPERATOR')) END)
    WITH CHECK (CASE WHEN kind = 'CFG' THEN (SELECT public.wms_has_role('MANAGER')) ELSE (SELECT public.wms_has_role('OPERATOR')) END);
CREATE POLICY wms_qc_records_delete ON public.wms_qc_records FOR DELETE TO authenticated
    USING (created_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_qc_records TO authenticated;
