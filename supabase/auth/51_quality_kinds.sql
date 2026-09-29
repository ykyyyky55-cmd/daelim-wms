-- 51: 품질관리 기록 종류 추가 (기존 자료는 그대로, 제약만 넓힌다)
--   COA         원부자재 시험성적서(COA) 관리 (원부자재관리)
--   TEST_REPORT 제품시험성적서 (제품관리, 결재 TR:<id>)
--   PCHECK      공정 관리기준 점검표 (공정관리: 원액생산 = 윤활유·화학제품 관리기준 / 완제품포장 = 충진·포장·용기·박스·적재 관리기준)
--   NCR         불량 발생 및 조치보고서 (제품·공정·원부자재, 사진 포함, 결재 NCR:<id>)
-- 본사·김포 구분은 data.site ('HQ' | 'GIMPO'), 공정 단계는 data.stage ('BLEND' 원액생산 | 'PACK' 완제품포장).
-- 권한은 46번 정책 그대로 (CFG가 아니므로 조회 VIEWER·경영자 / 쓰기 OPERATOR / 삭제 쓴 사람·MANAGER).

ALTER TABLE public.wms_qc_records DROP CONSTRAINT IF EXISTS wms_qc_records_kind_check;
ALTER TABLE public.wms_qc_records ADD CONSTRAINT wms_qc_records_kind_check
    CHECK (kind IN ('INSPECT', 'EQUIP', 'EQUIP_LOG', 'MSDS', 'CFG', 'COA', 'TEST_REPORT', 'PCHECK', 'NCR'));
