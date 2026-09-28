-- ==========================================
-- 41. 카드전표: 전표 스캔 기록에 카드 사용 정보 (월별 카드사용내역 · 영수증 제출)
-- ==========================================
-- amount  : 결제 금액 (원)
-- card    : 사용한 카드 (예: 법인카드 1234)
-- purpose : 사용 용도 (예: 원료 구매, 식대, 주유)
-- action NONE : 재고 없이 카드 사용만 기록 (식대·주유 등 재고 품목이 아닌 영수증)
-- 영수증 이미지는 버킷 wms-files의 cards/<YYYY-MM>/<YYYY-MM-DD>_<등록번호>.jpg (일자별)
-- 월별 카드사용내역 결재: wms_approvals doc_key 'CARD:<YYYY-MM>'

ALTER TABLE public.wms_scan_slips ADD COLUMN IF NOT EXISTS amount  numeric DEFAULT 0;
ALTER TABLE public.wms_scan_slips ADD COLUMN IF NOT EXISTS card    text DEFAULT '';
ALTER TABLE public.wms_scan_slips ADD COLUMN IF NOT EXISTS purpose text DEFAULT '';

ALTER TABLE public.wms_scan_slips DROP CONSTRAINT IF EXISTS wms_scan_slips_action_check;
ALTER TABLE public.wms_scan_slips ADD CONSTRAINT wms_scan_slips_action_check CHECK (action IN ('IN', 'OUT', 'USE', 'MOVE', 'NONE'));
