-- 49: 비로그인(anon)이 SECURITY DEFINER 함수를 RPC로 부를 수 없게 실행 권한 회수
--
-- Supabase 보안 점검(0028)이 아래 세 함수를 '비로그인 실행 가능'으로 표시했습니다.
-- - wms_documents_reg_no, wms_scan_slips_reg_no: 등록번호를 매기는 트리거 함수.
--   트리거 실행에는 EXECUTE 권한이 필요 없으므로(권한은 트리거 생성 때만 검사) 회수해도 동작은 같습니다.
-- - wms_set_primary_image: 함수 안에서 OPERATOR 권한을 검사하지만, 비로그인 호출 자체를 막습니다.
-- 로그인 사용자(authenticated)의 권한은 그대로 둡니다.

REVOKE EXECUTE ON FUNCTION public.wms_documents_reg_no() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wms_scan_slips_reg_no() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wms_set_primary_image(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_set_primary_image(uuid) TO authenticated;
