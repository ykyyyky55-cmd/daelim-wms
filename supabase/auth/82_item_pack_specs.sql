-- ==========================================
-- 82. 품목 적재 규격 (창고 배치도 3D — services/packSpecs.js)
-- ==========================================
-- 품목이 파렛트에 어떤 포장으로 몇 개 실리는지: 드럼(200L × 4) · 페일(20L × 16 × 3단) · IBC(1,000L × 1) · 박스(가로 × 세로 × 단, 입수) · 포대 · 벌크 · 롤.
-- 줄이 없는 품목은 앱이 품명·규격·단위로 짐작한다(guessPackSpec). 사람이 고친 품목만 여기에 한 줄.
-- data = { type, cols, rows, layers, packQty }  (packQty = 포장 하나에 든 수량 — 품목 단위 기준. 파렛트당 수량 = cols × rows × layers × packQty)
-- 창고 배치도는 이 규격으로 파렛트 위의 짐 모양을 그리고, 파렛트 수를 적지 않은 품목의 파렛트 수(재고 ÷ 파렛트당 수량)를 계산한다.
-- 재고·수불부와는 무관한 표시용 자료다. 권한: 조회 VIEWER·경영자, 쓰기 OPERATOR(파렛트 수 기록 wms_zone_loads와 같음). 여러 번 실행해도 안전하다.
CREATE TABLE IF NOT EXISTS public.wms_item_pack_specs (
    code text PRIMARY KEY,                      -- 품목코드
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_by_name text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT wms_item_pack_specs_data_object CHECK (jsonb_typeof(data) = 'object')
);
ALTER TABLE public.wms_item_pack_specs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wms_item_pack_specs_select ON public.wms_item_pack_specs;
DROP POLICY IF EXISTS wms_item_pack_specs_insert ON public.wms_item_pack_specs;
DROP POLICY IF EXISTS wms_item_pack_specs_update ON public.wms_item_pack_specs;
DROP POLICY IF EXISTS wms_item_pack_specs_delete ON public.wms_item_pack_specs;
CREATE POLICY wms_item_pack_specs_select ON public.wms_item_pack_specs FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_item_pack_specs_insert ON public.wms_item_pack_specs FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
CREATE POLICY wms_item_pack_specs_update ON public.wms_item_pack_specs FOR UPDATE TO authenticated
    USING ((SELECT public.wms_has_role('OPERATOR'))) WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
CREATE POLICY wms_item_pack_specs_delete ON public.wms_item_pack_specs FOR DELETE TO authenticated
    USING ((SELECT public.wms_has_role('OPERATOR')));
