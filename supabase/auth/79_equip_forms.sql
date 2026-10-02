-- ==========================================
-- 79. 설비관리 → 윤활관리카드 · 제조설비 점검기록부 (components/quality/EquipForms.js)
-- ==========================================
-- 종이(엑셀) 양식을 옮긴 화면의 자료를 품질 기록 표(wms_qc_records)에 종류 둘을 더해 담는다.
--   kind EQ_TPL  : 설비별 양식  id 'EQT:<CHECK|LUBE>:<관리번호>'            data = { formType, equipName, manageNo, rows }
--                  CHECK rows = [{ standard 점검기준, method 점검방법, cycle 주기 }]
--                  LUBE  rows = [{ spot 윤활개소, lubricant 윤활제명, method 급유방법, refillCycle·refillQty 보충, changeCycle·changeQty 교환, checkCycle 점검주기 }]
--   kind EQ_FORM : 기록 한 장   id 'EQF:<CHECK|LUBE>:<관리번호>:<YYYY-MM | YYYY>'  data = { tplId, period, marks, confirm, actions, note }
--                  CHECK marks = { 줄: { 일: 기호 } } · LUBE marks = { 줄: { 월: { date, result } } }, confirm = { 일 또는 월: 확인자 }
-- 결재: wms_approvals doc_key 'EQFORM:<기록 id>' (작성·검토·검토·확인). 권한은 46번 정책 그대로(조회 VIEWER·경영자, 기록 OPERATOR).
-- 여러 번 실행해도 안전하다.
ALTER TABLE public.wms_qc_records DROP CONSTRAINT IF EXISTS wms_qc_records_kind_check;
ALTER TABLE public.wms_qc_records ADD CONSTRAINT wms_qc_records_kind_check
    CHECK (kind IN ('INSPECT', 'EQUIP', 'EQUIP_LOG', 'MSDS', 'CFG', 'COA', 'TEST_REPORT', 'PCHECK', 'NCR', 'BTEST', 'QCSPEC', 'EQ_TPL', 'EQ_FORM'));
