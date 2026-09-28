-- 50: 오프라인 작업 반영 (인터넷이 없을 때 기기에 저장한 입출고·생산입고·실사를 나중에 한 번만 반영)
--
-- 앱(services/offlineQueue.js)은 인터넷이 없으면 재고 증감과 입출고 이력을 기기에 작업 단위로 쌓아 두었다가,
-- 연결되면 작업마다 wms_apply_offline_op를 부른다.
-- - 작업 id(p_op_id)를 wms_offline_ops에 남겨, 응답을 못 받아 다시 보내도 두 번 반영되지 않는다.
-- - 재고 증감·이력 입력·작업 id 기록이 한 트랜잭션이라 일부만 반영되지 않는다.
-- - SECURITY INVOKER: 재고·이력 테이블의 기존 RLS(OPERATOR 이상)가 그대로 적용된다.
-- - 재고는 반영 시점의 클라우드 값에 증감만 더한다(다른 기기의 변경을 덮어쓰지 않음). 재고 실사는 실사 수량으로 맞춘다(set).

CREATE TABLE IF NOT EXISTS public.wms_offline_ops (
    op_id      text PRIMARY KEY,
    user_id    uuid DEFAULT auth.uid(),
    label      text,
    created_at timestamptz,                 -- 기기에서 작업한 시각
    applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wms_offline_ops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_offline_ops FROM anon;
GRANT SELECT, INSERT ON public.wms_offline_ops TO authenticated;

DROP POLICY IF EXISTS wms_offline_ops_select ON public.wms_offline_ops;
CREATE POLICY wms_offline_ops_select ON public.wms_offline_ops FOR SELECT TO authenticated
    USING (( SELECT public.wms_has_role('OPERATOR') ));
DROP POLICY IF EXISTS wms_offline_ops_insert ON public.wms_offline_ops;
CREATE POLICY wms_offline_ops_insert ON public.wms_offline_ops FOR INSERT TO authenticated
    WITH CHECK (( SELECT public.wms_has_role('OPERATOR') ));

-- p_stock: [{ code, location, delta }] 또는 [{ code, location, set }] (재고 실사)
-- p_logs : [{ type, code, name, qty, worker, from_loc, to_loc, reason, timestamp }]
-- 반환: true = 이번에 반영, false = 이미 반영된 작업 (다시 보낸 경우)
CREATE OR REPLACE FUNCTION public.wms_apply_offline_op(p_op_id text, p_label text, p_created_at timestamptz, p_stock jsonb, p_logs jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE s jsonb; l jsonb;
BEGIN
    IF p_op_id IS NULL OR p_op_id = '' THEN RAISE EXCEPTION '작업 id가 없습니다.'; END IF;

    INSERT INTO public.wms_offline_ops (op_id, label, created_at) VALUES (p_op_id, p_label, p_created_at)
    ON CONFLICT (op_id) DO NOTHING;
    IF NOT FOUND THEN RETURN false; END IF;

    FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p_stock, '[]'::jsonb)) LOOP
        IF s ? 'set' THEN
            INSERT INTO public.wms_inventory (code, location, quantity, status, last_updated)
            VALUES (s->>'code', s->>'location', (s->>'set')::numeric, '정상 보관', now())
            ON CONFLICT (code, location) DO UPDATE SET quantity = EXCLUDED.quantity, last_updated = now();
        ELSE
            INSERT INTO public.wms_inventory (code, location, quantity, status, last_updated)
            VALUES (s->>'code', s->>'location', (s->>'delta')::numeric, '정상 보관', now())
            ON CONFLICT (code, location) DO UPDATE SET quantity = public.wms_inventory.quantity + EXCLUDED.quantity, last_updated = now();
        END IF;
    END LOOP;

    FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p_logs, '[]'::jsonb)) LOOP
        INSERT INTO public.wms_history_logs (type, code, name, qty, worker, from_loc, to_loc, reason, timestamp)
        VALUES (l->>'type', l->>'code', l->>'name', (l->>'qty')::numeric, l->>'worker', l->>'from_loc', l->>'to_loc', l->>'reason',
                coalesce((l->>'timestamp')::timestamptz, p_created_at, now()));
    END LOOP;
    RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.wms_apply_offline_op(text, text, timestamptz, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_apply_offline_op(text, text, timestamptz, jsonb, jsonb) TO authenticated;
