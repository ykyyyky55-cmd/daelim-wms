-- 53: 품질관리 기록 종류 추가 (기존 자료는 그대로, 제약만 넓힌다)
--   BTEST   원액 검사 기록 (공정관리 → 원액생산 → 검사 기록·관리도: 외관·비중·동점도 / 수용성은 외관·비중·pH)
--   QCSPEC  제품 규격 (제품별 구분·종류·유형, KS·SAE·API·ACEA·DOT4 옵션, 작업지시서 검사항목 사본, 직접 입력 규격)
--           제품관리 [제품 규격] · 원액 검사 기록 · 제품시험성적서가 함께 쓴다 (앱 services/qcProductSpecs.js)
-- 권한은 46번 정책 그대로 (CFG가 아니므로 조회 VIEWER·경영자 / 쓰기 OPERATOR / 삭제 쓴 사람·MANAGER).

ALTER TABLE public.wms_qc_records DROP CONSTRAINT IF EXISTS wms_qc_records_kind_check;
ALTER TABLE public.wms_qc_records ADD CONSTRAINT wms_qc_records_kind_check
    CHECK (kind IN ('INSPECT', 'EQUIP', 'EQUIP_LOG', 'MSDS', 'CFG', 'COA', 'TEST_REPORT', 'PCHECK', 'NCR', 'BTEST', 'QCSPEC'));
