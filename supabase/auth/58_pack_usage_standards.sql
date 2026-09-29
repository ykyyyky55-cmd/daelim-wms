-- ==============================================================================
-- 58. 포장사용기준서 (완제품·라벨부착 포장 1단위당 원액·부자재 사용량)
-- ==============================================================================
-- 저장은 기존 제품 BOM(wms_product_boms)을 그대로 쓴다: 제품생산/입고의 자동 차감·생산계획 부족 계산과 같은 자료.
--   raw_list = [{ code: 원액(또는 원료) 코드, rate: 1단위당 L, slot: 'raw' }]
--   sub_list = [{ code: 부자재 코드, rate: 1단위당 수량, slot: container|cap|label|inbox|outbox|etc }]
--   meta     = { kind: PRODUCT|LABEL, template: 기본 양식(미확인) 여부, container: BOTTLE|PL|DM|IBC,
--                volume: 용기 1개 용량(L), count: 1단위(EA·BOX)에 든 용기 수, oilType: AA…AJ, blendName, note, checkedBy, checkedAt }
--   용기 종류: BOTTLE = 0.1~4L 용기, PL = 20L 페일, DM = 200L 드럼, IBC = 1000L
-- 화면: 원액 작업지시서 → [포장사용기준서] 탭 (components/PackUsageStandards.js)
-- 이 파일은 meta 칸을 더하고, 등록된 완제품 중 기준서가 없는 것에 '기본 양식'을 한 번 만든다 (이미 있는 기준서는 건드리지 않음).
--   용량·입수: 규격 → 품명 (ml·L, 'x 12개', '6개입', '20세트(…)')
--   원액: 포장작업표준서의 '사용 원액명' → 원액(없으면 원료) 품목
--   부자재: 품명이 '제품명 + 용량'으로 시작하는 부자재 (라벨·인박스·아웃박스·칼라박스·속지 …), 'N개입'이면 1단위당 입수/N
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

ALTER TABLE public.wms_product_boms ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 이미 있는 기준서(사람이 저장한 배합비)는 확인된 것으로
UPDATE public.wms_product_boms SET meta = jsonb_build_object('kind', 'PRODUCT', 'template', false) WHERE meta = '{}'::jsonb;

WITH prod AS MATERIALIZED (
    SELECT m.code, m.name, m.spec, upper(coalesce(m.unit, 'EA')) AS unit,
           coalesce(substring(m.code FROM '^[0-9](A[A-Z])'), '') AS grp,
           replace(lower(m.name), ' ', '') AS nname, lower(replace(coalesce(m.spec, ''), ' ', '')) AS nspec
    FROM public.wms_master_items m
    WHERE m.category = '완제품' AND NOT EXISTS (SELECT 1 FROM public.wms_product_boms b WHERE b.code = m.code)
), v1 AS MATERIALIZED (
    SELECT p.*,
        coalesce(
            (SELECT (x[1])::numeric / 1000 FROM regexp_match(p.nspec, '([0-9]+(?:\.[0-9]+)?)ml') x),
            (SELECT (x[1])::numeric FROM regexp_match(p.nspec, '([0-9]+(?:\.[0-9]+)?)l(?![a-wyz])') x),
            (SELECT (x[1])::numeric / 1000 FROM regexp_match(p.nname, '([0-9]+(?:\.[0-9]+)?)ml') x),
            (SELECT (x[1])::numeric FROM regexp_match(p.nname, '([0-9]+(?:\.[0-9]+)?)l(?![a-wyz])') x),
            (SELECT (x[1])::numeric FROM regexp_match(p.nspec, '(?:^|\()([0-9]+\.[0-9]+)x') x)) AS vol,
        coalesce((SELECT (x[1])::int FROM regexp_match(p.nspec, '[x×*]([0-9]+)개') x), (SELECT (x[1])::int FROM regexp_match(p.nname, '([0-9]+)개입') x), 1)
          * coalesce((SELECT (x[1])::int FROM regexp_match(p.nspec, '^([0-9]+)세트') x), 1) AS cnt
    FROM prod p
), ps AS MATERIALIZED (
    SELECT replace(lower(product), ' ', '') AS np,
           trim(replace(substring(content->>'a4Html' FROM '사용\s*원액[^<]*</t[dh]>\s*<t[dh][^>]*>([^<]*)'), '&amp;', '&')) AS blend
    FROM public.wms_pack_standards
), bl AS MATERIALIZED (
    SELECT code, replace(lower(name), ' ', '') AS nn, CASE WHEN category = '원액' THEN 0 ELSE 1 END AS pri
    FROM public.wms_master_items WHERE category IN ('원액', '원료')
), v2 AS MATERIALIZED (
    SELECT v1.*, (SELECT ps.blend FROM ps WHERE coalesce(ps.blend, '') <> '' AND (ps.np LIKE v1.nname || '%' OR v1.nname LIKE ps.np || '%') ORDER BY length(ps.np) LIMIT 1) AS blend_name
    FROM v1
), v3 AS MATERIALIZED (
    SELECT v2.*, (SELECT bl.code FROM bl
                  WHERE v2.blend_name IS NOT NULL AND (bl.nn = replace(lower(v2.blend_name), ' ', '') OR bl.nn LIKE replace(lower(v2.blend_name), ' ', '') || '%' OR replace(lower(v2.blend_name), ' ', '') LIKE bl.nn || '%')
                  ORDER BY bl.pri, abs(length(bl.nn) - length(replace(lower(v2.blend_name), ' ', ''))) LIMIT 1) AS blend_code
    FROM v2
), subs AS MATERIALIZED (
    SELECT DISTINCT ON (v3.code, s.code) v3.code AS pcode, s.code AS scode, v3.cnt,
        CASE WHEN s.nn ~ '라벨' THEN 'label' WHEN s.nn ~ '인박스' THEN 'inbox' WHEN s.nn ~ '(아웃박스|박스)' THEN 'outbox'
             WHEN s.nn ~ '(용기|병|캔|페일|말통|드럼|보틀)' THEN 'container' WHEN s.nn ~ '캡' THEN 'cap' ELSE 'etc' END AS slot,
        (SELECT (x[1])::numeric FROM regexp_match(s.nn, '([0-9]+)개입') x) AS per
    FROM v3 JOIN (SELECT code, replace(lower(name), ' ', '') AS nn FROM public.wms_master_items WHERE category = '부자재') s
      ON v3.vol IS NOT NULL AND (s.nn LIKE v3.nname || trim_scale(v3.vol)::text || 'l%' OR s.nn LIKE v3.nname || (v3.vol * 1000)::int::text || 'ml%')
)
INSERT INTO public.wms_product_boms (code, raw_list, sub_list, updated_at, updated_by, meta)
SELECT v3.code,
    CASE WHEN v3.blend_code IS NOT NULL AND v3.vol IS NOT NULL
         THEN jsonb_build_array(jsonb_build_object('code', v3.blend_code, 'rate', round(v3.vol * v3.cnt, 4), 'slot', 'raw')) ELSE '[]'::jsonb END,
    coalesce((SELECT jsonb_agg(jsonb_build_object('code', s.scode, 'rate', round(CASE WHEN s.per > 0 THEN s.cnt / s.per ELSE s.cnt END, 6), 'slot', s.slot) ORDER BY s.slot)
              FROM subs s WHERE s.pcode = v3.code), '[]'::jsonb),
    now(), '기본 양식 (자동)',
    jsonb_strip_nulls(jsonb_build_object(
        'kind', 'PRODUCT', 'template', true,
        'container', CASE WHEN v3.vol IS NULL THEN NULL WHEN v3.vol <= 4 THEN 'BOTTLE' WHEN v3.vol <= 25 THEN 'PL' WHEN v3.vol <= 300 THEN 'DM' ELSE 'IBC' END,
        'volume', v3.vol, 'count', v3.cnt, 'oilType', nullif(v3.grp, ''), 'blendName', nullif(v3.blend_name, '')))
FROM v3
ON CONFLICT (code) DO NOTHING;
