-- ==============================================================================
-- 품목 마스터 합치기 / 되돌리기 (DB 함수, 한 트랜잭션)
-- ==============================================================================
-- 예전에는 브라우저가 이 기기 값으로 먼저 합친 뒤 클라우드에 여러 번 나눠 반영해서,
-- 중간에 실패하거나 다른 기기의 재고가 있으면 데이터가 어긋날 수 있었다.
-- wms_merge_items는 클라우드의 실제 값으로 아래를 한 번에 처리한다 (실패하면 전부 취소).
--   1) 창고 재고: 같은 위치면 수량 합산, 없으면 코드만 기준 품목으로 변경
--   2) 입출고 이력, 일정, 실사 기록의 품목코드
--   3) 원료수불부: 같은 코드 전표 + (코드가 비었거나 같은) 같은 원료명 전표 → 기준 품목 코드·이름,
--      원료코드(보안 코드)는 하나로 통일 (기준 품목 것, 없으면 합쳐지는 품목 것)
--   4) 제품·자재수불부: 같은 코드 전표 → 기준 품목 코드·이름
--   5) 제조시방서(wms_recipes)·작업지시서(wms_secure_work_orders)의 원료 품목코드와 제품 품목코드
--   6) 합쳐지는 품목 마스터 삭제
-- 되돌리기에 필요한 변경 전 값은 wms_merge_logs에 남겨 어느 기기에서든 되돌릴 수 있다.
-- 배합 자료는 남기지 않는다 (제조시방서는 몇 번째 원료였는지와 그 원료의 이전 원료코드만 기록).
-- 수불부 재고량 재계산은 앱이 다시 불러올 때 한다.
-- 권한: 매니저 이상 (RLS와 같은 기준). 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_merge_logs (
    id TEXT PRIMARY KEY DEFAULT ('MRG-' || replace(gen_random_uuid()::text, '-', '')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID DEFAULT auth.uid(),
    source_code TEXT NOT NULL,
    target_code TEXT NOT NULL,
    source_name TEXT,
    target_name TEXT,
    source_item JSONB NOT NULL,   -- 삭제된 품목 마스터 행
    changes JSONB NOT NULL,       -- 되돌리기용 변경 전 값
    undone BOOLEAN NOT NULL DEFAULT FALSE,
    undone_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wms_merge_logs_created ON public.wms_merge_logs (created_at DESC);

ALTER TABLE public.wms_merge_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_merge_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.wms_merge_logs FROM authenticated;
GRANT SELECT ON public.wms_merge_logs TO authenticated;
DROP POLICY IF EXISTS "wms_merge_logs_select" ON public.wms_merge_logs;
CREATE POLICY "wms_merge_logs_select" ON public.wms_merge_logs
    FOR SELECT TO authenticated USING (public.wms_has_role('MANAGER'));

-- 배열(materials) 안에서 itemCode가 p_from인 원소를 p_to로 바꾸고, 바뀐 위치와 이전 원료코드를 돌려준다
CREATE OR REPLACE FUNCTION public.wms_merge_swap_materials(p_mats JSONB, p_from TEXT, p_to TEXT, p_raw_code TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
    v_mats JSONB := COALESCE(p_mats, '[]'::jsonb);
    v_idx JSONB := '[]'::jsonb;
    v_old JSONB := '[]'::jsonb;
    i INT;
BEGIN
    IF jsonb_typeof(v_mats) <> 'array' THEN
        RETURN jsonb_build_object('mats', p_mats, 'idx', v_idx, 'oldRaw', v_old);
    END IF;
    FOR i IN 0 .. jsonb_array_length(v_mats) - 1 LOOP
        IF v_mats -> i ->> 'itemCode' = p_from THEN
            v_idx := v_idx || to_jsonb(i);
            v_old := v_old || COALESCE(v_mats -> i -> 'rawCode', 'null'::jsonb);
            v_mats := jsonb_set(v_mats, ARRAY[i::text, 'itemCode'], to_jsonb(p_to));
            IF COALESCE(p_raw_code, '') <> '' THEN
                v_mats := jsonb_set(v_mats, ARRAY[i::text, 'rawCode'], to_jsonb(p_raw_code));
            END IF;
        END IF;
    END LOOP;
    RETURN jsonb_build_object('mats', v_mats, 'idx', v_idx, 'oldRaw', v_old);
END $$;

-- 바꿨던 위치를 되돌린다
CREATE OR REPLACE FUNCTION public.wms_merge_restore_materials(p_mats JSONB, p_idx JSONB, p_old_raw JSONB, p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
    v_mats JSONB := p_mats;
    k INT;
    i INT;
BEGIN
    IF v_mats IS NULL OR jsonb_typeof(v_mats) <> 'array' OR p_idx IS NULL THEN RETURN p_mats; END IF;
    FOR k IN 0 .. jsonb_array_length(p_idx) - 1 LOOP
        i := (p_idx ->> k)::int;
        IF i < jsonb_array_length(v_mats) THEN
            v_mats := jsonb_set(v_mats, ARRAY[i::text, 'itemCode'], to_jsonb(p_code));
            IF p_old_raw -> k IS NULL OR jsonb_typeof(p_old_raw -> k) = 'null' THEN
                v_mats := v_mats #- ARRAY[i::text, 'rawCode'];
            ELSE
                v_mats := jsonb_set(v_mats, ARRAY[i::text, 'rawCode'], p_old_raw -> k);
            END IF;
        END IF;
    END LOOP;
    RETURN v_mats;
END $$;

CREATE OR REPLACE FUNCTION public.wms_merge_items(p_source TEXT, p_target TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_src public.wms_master_items;
    v_tgt public.wms_master_items;
    v_raw_code TEXT;
    v_inv JSONB := '[]'::jsonb;
    v_raw JSONB;
    v_item JSONB;
    v_hist JSONB;
    v_sched JSONB;
    v_audit JSONB;
    v_recipes JSONB := '[]'::jsonb;
    v_orders JSONB := '[]'::jsonb;
    v_swap JSONB;
    v_product BOOLEAN;
    v_exists BOOLEAN;
    v_log_id TEXT;
    r RECORD;
BEGIN
    IF NOT public.wms_has_role('MANAGER') THEN
        RAISE EXCEPTION '품목 합치기는 매니저 이상만 할 수 있습니다.';
    END IF;
    IF p_source IS NULL OR p_target IS NULL OR p_source = p_target THEN
        RAISE EXCEPTION '합칠 품목과 기준 품목이 서로 달라야 합니다.';
    END IF;
    SELECT * INTO v_src FROM public.wms_master_items WHERE code = p_source FOR UPDATE;
    SELECT * INTO v_tgt FROM public.wms_master_items WHERE code = p_target FOR UPDATE;
    IF v_src.code IS NULL OR v_tgt.code IS NULL THEN
        RAISE EXCEPTION '합칠 품목을 찾을 수 없습니다. (%, %)', p_source, p_target;
    END IF;

    -- 원료코드(보안 코드) 통일값: 기준 품목의 최근 코드 → 합쳐지는 품목의 최근 코드
    SELECT raw_code INTO v_raw_code FROM public.wms_raw_ledger
        WHERE COALESCE(raw_code, '') <> '' AND (code = p_target OR (name = v_tgt.name AND COALESCE(code, '') IN ('', p_target)))
        ORDER BY seq DESC LIMIT 1;
    IF v_raw_code IS NULL THEN
        SELECT raw_code INTO v_raw_code FROM public.wms_raw_ledger
            WHERE COALESCE(raw_code, '') <> '' AND (code = p_source OR (name = v_src.name AND COALESCE(code, '') IN ('', p_source)))
            ORDER BY seq DESC LIMIT 1;
    END IF;

    -- 1) 창고 재고 (클라우드 실제 수량 기준)
    FOR r IN SELECT * FROM public.wms_inventory WHERE code = p_source FOR UPDATE LOOP
        SELECT EXISTS (SELECT 1 FROM public.wms_inventory WHERE code = p_target AND location = r.location) INTO v_exists;
        IF v_exists THEN
            UPDATE public.wms_inventory SET quantity = quantity + r.quantity, last_updated = NOW()
                WHERE code = p_target AND location = r.location;
            DELETE FROM public.wms_inventory WHERE id = r.id;
        ELSE
            UPDATE public.wms_inventory SET code = p_target, last_updated = NOW() WHERE id = r.id;
        END IF;
        v_inv := v_inv || jsonb_build_object('location', r.location, 'quantity', r.quantity, 'status', r.status, 'merged', v_exists);
    END LOOP;

    -- 2) 이력·일정·실사 기록
    WITH u AS (UPDATE public.wms_history_logs SET code = p_target, name = v_tgt.name WHERE code = p_source RETURNING id)
        SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_hist FROM u;
    WITH u AS (UPDATE public.wms_schedules SET item_code = p_target, item_name = v_tgt.name WHERE item_code = p_source RETURNING id)
        SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_sched FROM u;
    WITH u AS (UPDATE public.wms_audit_records SET code = p_target WHERE code = p_source RETURNING id)
        SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_audit FROM u;

    -- 3) 원료수불부: 변경 전 값을 남기고 코드·이름·원료코드 변경 (기준 품목 전표는 원료코드만 통일)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'rawCode', raw_code)), '[]'::jsonb) INTO v_raw
        FROM public.wms_raw_ledger
        WHERE code = p_source OR (name = v_src.name AND COALESCE(code, '') IN ('', p_source))
           OR (v_raw_code IS NOT NULL AND COALESCE(raw_code, '') <> v_raw_code
               AND (code = p_target OR (name = v_tgt.name AND COALESCE(code, '') IN ('', p_target))));
    UPDATE public.wms_raw_ledger SET code = p_target, name = v_tgt.name, raw_code = COALESCE(v_raw_code, raw_code), updated_at = NOW()
        WHERE code = p_source OR (name = v_src.name AND COALESCE(code, '') IN ('', p_source));
    IF v_raw_code IS NOT NULL THEN
        UPDATE public.wms_raw_ledger SET raw_code = v_raw_code, updated_at = NOW()
            WHERE COALESCE(raw_code, '') <> v_raw_code AND (code = p_target OR (name = v_tgt.name AND COALESCE(code, '') IN ('', p_target)));
    END IF;

    -- 4) 제품·자재수불부
    WITH u AS (
        UPDATE public.wms_item_ledger l SET code = p_target, name = v_tgt.name, updated_at = NOW()
        FROM (SELECT id, code, name FROM public.wms_item_ledger WHERE code = p_source) old
        WHERE l.id = old.id RETURNING old.id, old.code, old.name)
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name)), '[]'::jsonb) INTO v_item FROM u;

    -- 5) 제조시방서·작업지시서 (원료 품목코드, 제품 품목코드)
    FOR r IN SELECT id, materials, product_item_code FROM public.wms_recipes
             WHERE product_item_code = p_source OR materials @> jsonb_build_array(jsonb_build_object('itemCode', p_source)) FOR UPDATE LOOP
        v_swap := public.wms_merge_swap_materials(r.materials, p_source, p_target, v_raw_code);
        v_product := COALESCE(r.product_item_code = p_source, FALSE);
        UPDATE public.wms_recipes SET materials = v_swap -> 'mats',
            product_item_code = CASE WHEN v_product THEN p_target ELSE product_item_code END, updated_at = NOW()
            WHERE id = r.id;
        v_recipes := v_recipes || jsonb_build_object('id', r.id, 'idx', v_swap -> 'idx', 'oldRaw', v_swap -> 'oldRaw', 'product', v_product);
    END LOOP;
    FOR r IN SELECT id, data FROM public.wms_secure_work_orders
             WHERE data ->> 'productItemCode' = p_source OR data -> 'materials' @> jsonb_build_array(jsonb_build_object('itemCode', p_source)) FOR UPDATE LOOP
        v_swap := public.wms_merge_swap_materials(r.data -> 'materials', p_source, p_target, v_raw_code);
        v_product := COALESCE(r.data ->> 'productItemCode' = p_source, FALSE);
        UPDATE public.wms_secure_work_orders SET
            data = CASE WHEN v_product THEN jsonb_set(r.data, '{productItemCode}', to_jsonb(p_target)) ELSE r.data END
                   || CASE WHEN r.data ? 'materials' THEN jsonb_build_object('materials', v_swap -> 'mats') ELSE '{}'::jsonb END,
            updated_at = NOW()
            WHERE id = r.id;
        v_orders := v_orders || jsonb_build_object('id', r.id, 'idx', v_swap -> 'idx', 'oldRaw', v_swap -> 'oldRaw', 'product', v_product);
    END LOOP;

    -- 6) 품목 마스터 삭제 (남은 재고 행이 없으므로 연쇄 삭제되는 재고도 없다)
    DELETE FROM public.wms_master_items WHERE code = p_source;

    INSERT INTO public.wms_merge_logs (source_code, target_code, source_name, target_name, source_item, changes)
    VALUES (p_source, p_target, v_src.name, v_tgt.name, to_jsonb(v_src), jsonb_build_object(
        'inventory', v_inv, 'history', v_hist, 'schedules', v_sched, 'audits', v_audit,
        'rawLedger', v_raw, 'itemLedger', v_item, 'recipes', v_recipes, 'orders', v_orders, 'rawCode', v_raw_code))
    RETURNING id INTO v_log_id;

    RETURN jsonb_build_object('logId', v_log_id, 'rawCode', v_raw_code,
        'inventory', jsonb_array_length(v_inv), 'history', jsonb_array_length(v_hist),
        'rawLedger', jsonb_array_length(v_raw), 'itemLedger', jsonb_array_length(v_item),
        'recipes', jsonb_array_length(v_recipes), 'orders', jsonb_array_length(v_orders),
        'schedules', jsonb_array_length(v_sched), 'audits', jsonb_array_length(v_audit));
END $$;

CREATE OR REPLACE FUNCTION public.wms_unmerge_items(p_log_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_log public.wms_merge_logs;
    v_c JSONB;
    v_src JSONB;
    e JSONB;
    r RECORD;
BEGIN
    IF NOT public.wms_has_role('MANAGER') THEN
        RAISE EXCEPTION '품목 합치기 되돌리기는 매니저 이상만 할 수 있습니다.';
    END IF;
    SELECT * INTO v_log FROM public.wms_merge_logs WHERE id = p_log_id FOR UPDATE;
    IF v_log.id IS NULL THEN RAISE EXCEPTION '되돌릴 병합 이력을 찾을 수 없습니다.'; END IF;
    IF v_log.undone THEN RAISE EXCEPTION '이미 되돌린 병합입니다.'; END IF;
    IF EXISTS (SELECT 1 FROM public.wms_master_items WHERE code = v_log.source_code) THEN
        RAISE EXCEPTION '품목코드 [%]가 이미 다시 등록되어 있어 되돌릴 수 없습니다.', v_log.source_code;
    END IF;
    v_c := v_log.changes;
    v_src := v_log.source_item;

    -- 품목 마스터 복원
    INSERT INTO public.wms_master_items (code, name, category, supplier, spec, unit, safety, manufacturer, created_at)
    VALUES (v_src ->> 'code', v_src ->> 'name', v_src ->> 'category', v_src ->> 'supplier', v_src ->> 'spec', v_src ->> 'unit',
            COALESCE((v_src ->> 'safety')::numeric, 0), v_src ->> 'manufacturer', COALESCE((v_src ->> 'created_at')::timestamptz, NOW()));

    -- 재고: 기준 품목에서 옮겨 온 수량을 빼고 원래 품목에 되돌린다. 코드만 바꿔 생긴 행이 0이 되면 지운다.
    FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(v_c -> 'inventory', '[]'::jsonb)) LOOP
        UPDATE public.wms_inventory SET quantity = quantity - (e ->> 'quantity')::numeric, last_updated = NOW()
            WHERE code = v_log.target_code AND location = e ->> 'location';
        IF NOT (e ->> 'merged')::boolean THEN
            DELETE FROM public.wms_inventory WHERE code = v_log.target_code AND location = e ->> 'location' AND quantity = 0;
        END IF;
        INSERT INTO public.wms_inventory (code, location, quantity, status, last_updated)
        VALUES (v_log.source_code, e ->> 'location', (e ->> 'quantity')::numeric, COALESCE(e ->> 'status', '정상 보관'), NOW())
        ON CONFLICT (code, location) DO UPDATE SET quantity = public.wms_inventory.quantity + EXCLUDED.quantity, last_updated = NOW();
    END LOOP;

    -- 이력·일정·실사 기록
    UPDATE public.wms_history_logs SET code = v_log.source_code, name = v_log.source_name
        WHERE id IN (SELECT (x #>> '{}')::bigint FROM jsonb_array_elements(COALESCE(v_c -> 'history', '[]'::jsonb)) x);
    UPDATE public.wms_schedules SET item_code = v_log.source_code, item_name = v_log.source_name
        WHERE id IN (SELECT x #>> '{}' FROM jsonb_array_elements(COALESCE(v_c -> 'schedules', '[]'::jsonb)) x);
    UPDATE public.wms_audit_records SET code = v_log.source_code
        WHERE id IN (SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(COALESCE(v_c -> 'audits', '[]'::jsonb)) x);

    -- 수불부 전표
    UPDATE public.wms_raw_ledger l SET code = x.code, name = x.name, raw_code = x."rawCode", updated_at = NOW()
        FROM jsonb_to_recordset(COALESCE(v_c -> 'rawLedger', '[]'::jsonb)) AS x(id TEXT, code TEXT, name TEXT, "rawCode" TEXT)
        WHERE l.id = x.id;
    UPDATE public.wms_item_ledger l SET code = x.code, name = x.name, updated_at = NOW()
        FROM jsonb_to_recordset(COALESCE(v_c -> 'itemLedger', '[]'::jsonb)) AS x(id TEXT, code TEXT, name TEXT)
        WHERE l.id = x.id;

    -- 제조시방서·작업지시서
    FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(v_c -> 'recipes', '[]'::jsonb)) LOOP
        UPDATE public.wms_recipes SET
            materials = public.wms_merge_restore_materials(materials, e -> 'idx', e -> 'oldRaw', v_log.source_code),
            product_item_code = CASE WHEN (e ->> 'product')::boolean THEN v_log.source_code ELSE product_item_code END,
            updated_at = NOW()
            WHERE id = e ->> 'id';
    END LOOP;
    FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(v_c -> 'orders', '[]'::jsonb)) LOOP
        FOR r IN SELECT id, data FROM public.wms_secure_work_orders WHERE id = e ->> 'id' FOR UPDATE LOOP
            UPDATE public.wms_secure_work_orders SET
                data = CASE WHEN (e ->> 'product')::boolean THEN jsonb_set(r.data, '{productItemCode}', to_jsonb(v_log.source_code)) ELSE r.data END
                       || CASE WHEN r.data ? 'materials'
                               THEN jsonb_build_object('materials', public.wms_merge_restore_materials(r.data -> 'materials', e -> 'idx', e -> 'oldRaw', v_log.source_code))
                               ELSE '{}'::jsonb END,
                updated_at = NOW()
                WHERE id = r.id;
        END LOOP;
    END LOOP;

    UPDATE public.wms_merge_logs SET undone = TRUE, undone_at = NOW() WHERE id = p_log_id;
    RETURN jsonb_build_object('ok', TRUE, 'sourceCode', v_log.source_code, 'targetCode', v_log.target_code);
END $$;

REVOKE EXECUTE ON FUNCTION public.wms_merge_items(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wms_unmerge_items(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wms_merge_swap_materials(JSONB, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wms_merge_restore_materials(JSONB, JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wms_merge_items(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_unmerge_items(TEXT) TO authenticated;
