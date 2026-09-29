-- ==============================================================================
-- 60. 생산요청서 → 생산(포장) 스케줄 자동 반영 연결 칸 (services/requestSync.js)
-- ==============================================================================
-- req_ref = 'REQ:<요청서id>:<순번>' — 요청서를 고쳐 다시 저장하면 같은 줄을 고친다.
-- 작성일자 복사(copyProdDate)로 다음 날 스케줄을 만들면 이 값도 같이 복사되어 최신 작성일자에서 이어서 맞춘다.
-- ==============================================================================
ALTER TABLE public.wms_production_schedule ADD COLUMN IF NOT EXISTS req_ref TEXT;
CREATE INDEX IF NOT EXISTS wms_production_schedule_req_ref_idx ON public.wms_production_schedule (req_ref) WHERE req_ref IS NOT NULL;
