-- ==============================================================================
-- 70. 품목 합치기 / 되돌리기에 창고 배치도 적재 기록(wms_zone_loads: 파렛트 수 · 칸 위치) 반영
-- ==============================================================================
-- 12_merge_items.sql의 wms_merge_items는 구획 재고(wms_inventory)의 품목코드는 기준 품목으로 옮기지만
-- 구획 적재 기록('<구획>|<품목>' 줄, 66·69번)은 그대로 두어, 합친 뒤 기준 품목이 그 구획에서
-- 1파렛트·자동 칸으로 보였다(저장해 둔 파렛트 수와 칸 위치가 사라진 것처럼 보임).
-- 구획마다 아래 규칙으로 옮긴다. 그 구획에 재고가 있는 쪽만 실제 적재로 본다
-- (다 빠진 뒤 남은 옛 기록은 무시 — 앱 services/zoneTransfer.js와 같은 기준):
--   · 품목의 적재 = 그 구획에 재고가 있으면 기록(기록이 없으면 1파렛트·칸 미정), 재고가 없으면 없음
--   · 두 품목 모두 적재: 파렛트 수를 더하고 칸을 합친다 (기준 품목 칸 먼저, 겹치는 칸은 한 번만)
--   · 합쳐지는 품목만 적재: 그 기록이 기준 품목 것이 된다 (둘 다 기록이 없으면 쓸 것이 없다)
--   · 합쳐지는 품목의 기록 줄은 지운다
-- 되돌리기용으로 구획마다 두 품목의 변경 전 줄을 wms_merge_logs.changes.zoneLoads에 남긴다.
-- 재고를 옮기기 전에 불러야 한다(합치기 전 재고로 판단). 12_merge_items.sql · 69_zone_cells.sql 적용 후 실행한다.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

-- 합쳐지는 품목의 구획 적재 기록을 기준 품목으로 옮기고, 되돌리기용 변경 전 값을 돌려준다
CREATE OR REPLACE FUNCTION public.wms_merge_zone_loads(p_source TEXT, p_target TEXT)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_out JSONB := '[]'::jsonb;
    v_src public.wms_zone_loads;
    v_tgt public.wms_zone_loads;
    v_src_live BOOLEAN;
    v_tgt_live BOOLEAN;
    v_write BOOLEAN;
    v_pallets NUMERIC;
    v_cells JSONB;
    z RECORD;
BEGIN
    -- 대상 구획: 합쳐지는 품목의 기록이 있는 구획 + 기록 없이 재고만 있는 구획
    FOR z IN
        SELECT l.zone_id AS id FROM public.wms_zone_loads l WHERE l.code = p_source
        UNION
        SELECT zn.id FROM public.wms_warehouse_zones zn
            JOIN public.wms_inventory i ON i.code = p_source AND i.quantity <> 0
                AND right(i.location, length(zn.id) + 3) = ' / ' || zn.id
            WHERE zn.kind = 'ZONE'
        ORDER BY 1
    LOOP
        SELECT * INTO v_src FROM public.wms_zone_loads WHERE zone_id = z.id AND code = p_source FOR UPDATE;
        SELECT * INTO v_tgt FROM public.wms_zone_loads WHERE zone_id = z.id AND code = p_target FOR UPDATE;
        SELECT EXISTS (SELECT 1 FROM public.wms_inventory i WHERE i.code = p_source AND i.quantity <> 0
            AND right(i.location, length(z.id) + 3) = ' / ' || z.id) INTO v_src_live;
        SELECT EXISTS (SELECT 1 FROM public.wms_inventory i WHERE i.code = p_target AND i.quantity <> 0
            AND right(i.location, length(z.id) + 3) = ' / ' || z.id) INTO v_tgt_live;
        v_write := FALSE;
        IF v_src_live AND v_tgt_live THEN
            v_pallets := COALESCE(v_src.pallets, 1) + COALESCE(v_tgt.pallets, 1);
            SELECT COALESCE(jsonb_agg(d.v ORDER BY d.ord), '[]'::jsonb) INTO v_cells FROM (
                SELECT s.v, MIN(s.ord) AS ord FROM (
                    SELECT e.v, e.ord FROM jsonb_array_elements(COALESCE(v_tgt.cells, '[]'::jsonb)) WITH ORDINALITY AS e(v, ord)
                    UNION ALL
                    SELECT e.v, e.ord + 100000 FROM jsonb_array_elements(COALESCE(v_src.cells, '[]'::jsonb)) WITH ORDINALITY AS e(v, ord)
                ) s GROUP BY s.v
            ) d;
            v_write := TRUE;
        ELSIF v_src_live AND (v_src.id IS NOT NULL OR v_tgt.id IS NOT NULL) THEN
            v_pallets := COALESCE(v_src.pallets, 1);
            v_cells := COALESCE(v_src.cells, '[]'::jsonb);
            v_write := TRUE;
        END IF;

        IF v_write THEN
            INSERT INTO public.wms_zone_loads (id, zone_id, code, pallets, cells, updated_by_name, updated_at)
            VALUES (z.id || '|' || p_target, z.id, p_target, v_pallets, v_cells, '품목 합치기', NOW())
            ON CONFLICT (id) DO UPDATE SET pallets = EXCLUDED.pallets, cells = EXCLUDED.cells,
                updated_by_name = EXCLUDED.updated_by_name, updated_at = EXCLUDED.updated_at;
        END IF;
        IF v_src.id IS NOT NULL THEN
            DELETE FROM public.wms_zone_loads WHERE id = v_src.id;
        END IF;
        IF v_write OR v_src.id IS NOT NULL THEN
            v_out := v_out || jsonb_build_object('zone', z.id, 'wrote', v_write,
                'source', CASE WHEN v_src.id IS NULL THEN NULL::jsonb
                    ELSE jsonb_build_object('pallets', v_src.pallets, 'cells', v_src.cells, 'by', v_src.updated_by_name) END,
                'target', CASE WHEN v_tgt.id IS NULL THEN NULL::jsonb
                    ELSE jsonb_build_object('pallets', v_tgt.pallets, 'cells', v_tgt.cells, 'by', v_tgt.updated_by_name) END);
        END IF;
    END LOOP;
    RETURN v_out;
END $$;

-- 합치기 때 바꾼 구획 적재 기록을 변경 전 값으로 되돌린다 (p_changes = wms_merge_logs.changes.zoneLoads, 예전 이력처럼 없으면 아무것도 하지 않음)
CREATE OR REPLACE FUNCTION public.wms_unmerge_zone_loads(p_changes JSONB, p_source TEXT, p_target TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    e JSONB;
BEGIN
    IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN RETURN; END IF;
    FOR e IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
        -- 기준 품목 줄: 합치기 전 값으로 (그때 없던 줄이면 지운다)
        IF COALESCE((e ->> 'wrote')::boolean, FALSE) THEN
            IF jsonb_typeof(e -> 'target') = 'object' THEN
                INSERT INTO public.wms_zone_loads (id, zone_id, code, pallets, cells, updated_by_name, updated_at)
                VALUES ((e ->> 'zone') || '|' || p_target, e ->> 'zone', p_target, (e -> 'target' ->> 'pallets')::numeric,
                        COALESCE(e -> 'target' -> 'cells', '[]'::jsonb), COALESCE(e -> 'target' ->> 'by', ''), NOW())
                ON CONFLICT (id) DO UPDATE SET pallets = EXCLUDED.pallets, cells = EXCLUDED.cells,
                    updated_by_name = EXCLUDED.updated_by_name, updated_at = EXCLUDED.updated_at;
            ELSE
                DELETE FROM public.wms_zone_loads WHERE id = (e ->> 'zone') || '|' || p_target;
            END IF;
        END IF;
        -- 합쳐졌던 품목 줄 복원
        IF jsonb_typeof(e -> 'source') = 'object' THEN
            INSERT INTO public.wms_zone_loads (id, zone_id, code, pallets, cells, updated_by_name, updated_at)
            VALUES ((e ->> 'zone') || '|' || p_source, e ->> 'zone', p_source, (e -> 'source' ->> 'pallets')::numeric,
                    COALESCE(e -> 'source' -> 'cells', '[]'::jsonb), COALESCE(e -> 'source' ->> 'by', ''), NOW())
            ON CONFLICT (id) DO UPDATE SET pallets = EXCLUDED.pallets, cells = EXCLUDED.cells,
                updated_by_name = EXCLUDED.updated_by_name, updated_at = EXCLUDED.updated_at;
        END IF;
    END LOOP;
END $$;

-- 아래 두 함수는 12_merge_items.sql과 같고, 구획 적재 기록 처리(v_zone · zoneLoads)만 더했다
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
    v_zone JSONB;
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

    -- 0) 창고 배치도 적재 기록 (파렛트 수 · 칸 위치) — 재고를 옮기기 전에 (합치기 전 재고로 판단)
    v_zone := public.wms_merge_zone_loads(p_source, p_target);

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
        'rawLedger', v_raw, 'itemLedger', v_item, 'recipes', v_recipes, 'orders', v_orders, 'rawCode', v_raw_code,
        'zoneLoads', v_zone))
    RETURNING id INTO v_log_id;

    RETURN jsonb_build_object('logId', v_log_id, 'rawCode', v_raw_code,
        'inventory', jsonb_array_length(v_inv), 'history', jsonb_array_length(v_hist),
        'rawLedger', jsonb_array_length(v_raw), 'itemLedger', jsonb_array_length(v_item),
        'recipes', jsonb_array_length(v_recipes), 'orders', jsonb_array_length(v_orders),
        'schedules', jsonb_array_length(v_sched), 'audits', jsonb_array_length(v_audit),
        'zoneLoads', jsonb_array_length(v_zone));
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

    -- 창고 배치도 적재 기록 (파렛트 수 · 칸 위치)
    PERFORM public.wms_unmerge_zone_loads(v_c -> 'zoneLoads', v_log.source_code, v_log.target_code);

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

REVOKE EXECUTE ON FUNCTION public.wms_merge_zone_loads(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wms_unmerge_zone_loads(JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wms_merge_items(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wms_unmerge_items(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_merge_items(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_unmerge_items(TEXT) TO authenticated;
