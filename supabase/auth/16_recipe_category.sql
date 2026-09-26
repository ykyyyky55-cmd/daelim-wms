-- ==============================================================================
-- wms_recipes: 제조시방서 분류(category)·종류(sub_category) 추가
-- ==============================================================================
-- 예: 분류 '엔진오일' / 종류 '가솔린', 분류 '첨가제' / 종류 '연료첨가제'
-- 분류·종류 목록은 따로 두지 않고 시방서에 입력된 값에서 만든다.
-- 여러 번 실행해도 안전하다. (기존 RLS 정책 그대로 적용)
-- ==============================================================================

ALTER TABLE public.wms_recipes ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.wms_recipes ADD COLUMN IF NOT EXISTS sub_category TEXT;
CREATE INDEX IF NOT EXISTS idx_wms_recipes_category ON public.wms_recipes (category, sub_category, product_name);
