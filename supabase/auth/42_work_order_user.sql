-- ==============================================================================
-- 42. 작업지시서 사용자 (원액생산 작업지시서 열람 + 생산량·단위만 수정, 제조시방서는 못 봄)
-- ==============================================================================
-- 역할(OPERATOR 등)에 더해 주는 추가 권한이다. wms_profiles.wo_user, 마스터만 wms_set_wo_user()로 켜고 끈다.
-- 작업지시서 사용자는 wms_recipes·wms_secure_work_orders 테이블을 직접 읽지 못한다(08의 RLS 그대로: 마스터·작업일지 관리자만).
-- 대신 아래 두 DB 함수만 쓴다:
--   wms_wo_orders()         : 작업지시서 목록. 원료 실명(name)·배합비(wtPct)·재고 품목코드(itemCode)를 뺀 사본만 돌려준다
--                             (인쇄물처럼 원료코드·L·KG·SG만). 제조시방서 내용은 어떤 것도 돌려주지 않는다.
--   wms_wo_set_qty(id, qty, unit) : 생산량·생산량 단위만 바꾼다. 원료 소요량(L·KG)은 생산량 비율대로 다시 계산한다.
--                             생산 완료·취소된 지시서는 바꿀 수 없다. 바꾼 사람·시각을 남긴다.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

ALTER TABLE public.wms_profiles ADD COLUMN IF NOT EXISTS wo_user BOOLEAN NOT NULL DEFAULT false;

-- 현재 사용자가 작업지시서 사용자인가 (승인된 계정만)
CREATE OR REPLACE FUNCTION public.wms_has_wo_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT CASE
        WHEN auth.uid() IS NULL THEN false
        ELSE COALESCE((SELECT p.wo_user AND p.role <> 'PENDING' FROM public.wms_profiles p WHERE p.id = auth.uid()), false)
    END;
$$;

-- 작업지시서 사용자 지정/해제 (마스터만)
CREATE OR REPLACE FUNCTION public.wms_set_wo_user(target UUID, enabled BOOLEAN)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    p public.wms_profiles;
BEGIN
    IF public.wms_current_role() IS DISTINCT FROM 'MASTER' THEN
        RAISE EXCEPTION '작업지시서 사용자 권한은 마스터 관리자만 지정할 수 있습니다.';
    END IF;
    UPDATE public.wms_profiles SET wo_user = COALESCE(enabled, false) WHERE id = target RETURNING * INTO p;
    IF p.id IS NULL THEN RAISE EXCEPTION '사용자를 찾을 수 없습니다.'; END IF;
    RETURN json_build_object('id', p.id, 'woUser', p.wo_user);
END;
$$;

-- 작업지시서 한 건 → 작업지시서 사용자용 사본 (원료 실명·배합비·재고 품목코드 제외)
CREATE OR REPLACE FUNCTION public.wms_wo_public_row(w public.wms_secure_work_orders)
RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT json_build_object(
        'id', w.id, 'orderNo', w.order_no, 'status', w.status, 'createdAt', w.created_at, 'updatedAt', w.updated_at,
        'data', (w.data - 'materials' - 'recipeId') || jsonb_build_object('materials', COALESCE((
            SELECT jsonb_agg(m - 'name' - 'wtPct' - 'itemCode' ORDER BY e.ord)
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.data->'materials') = 'array' THEN w.data->'materials' ELSE '[]'::jsonb END) WITH ORDINALITY e(m, ord)
        ), '[]'::jsonb))
    );
$$;

-- 작업지시서 목록 (작업지시서 사용자·작업일지 관리자·마스터)
CREATE OR REPLACE FUNCTION public.wms_wo_orders()
RETURNS SETOF JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT (public.wms_has_wo_user() OR public.wms_has_worklog_access()) THEN
        RAISE EXCEPTION '작업지시서를 볼 권한이 없습니다.';
    END IF;
    RETURN QUERY SELECT public.wms_wo_public_row(w) FROM public.wms_secure_work_orders w ORDER BY w.created_at DESC;
END;
$$;

-- 생산량·생산량 단위만 수정 (원료 소요량은 생산량 비율대로)
CREATE OR REPLACE FUNCTION public.wms_wo_set_qty(p_id TEXT, p_qty NUMERIC, p_unit TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    w public.wms_secure_work_orders;
    old_qty NUMERIC;
    factor NUMERIC;
    new_mats JSONB;
    who TEXT;
BEGIN
    IF NOT (public.wms_has_wo_user() OR public.wms_has_worklog_access()) THEN
        RAISE EXCEPTION '작업지시서를 수정할 권한이 없습니다.';
    END IF;
    IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION '생산량은 0보다 커야 합니다.'; END IF;
    IF length(trim(COALESCE(p_unit, ''))) = 0 OR length(p_unit) > 20 THEN RAISE EXCEPTION '생산량 단위를 확인하세요.'; END IF;
    SELECT * INTO w FROM public.wms_secure_work_orders WHERE id = p_id FOR UPDATE;
    IF w.id IS NULL THEN RAISE EXCEPTION '작업지시서를 찾을 수 없습니다.'; END IF;
    IF w.status IN ('COMPLETED', 'CANCELLED') THEN RAISE EXCEPTION '생산 완료·취소된 작업지시서는 수정할 수 없습니다.'; END IF;
    old_qty := NULLIF((w.data->>'prodQty')::numeric, 0);
    factor := CASE WHEN old_qty IS NULL THEN 1 ELSE p_qty / old_qty END;
    SELECT COALESCE(jsonb_agg(
        m || jsonb_build_object(
            'liters', CASE WHEN jsonb_typeof(m->'liters') = 'number' THEN to_jsonb(round((m->>'liters')::numeric * factor, 3)) ELSE m->'liters' END,
            'kg', CASE WHEN jsonb_typeof(m->'kg') = 'number' THEN to_jsonb(round((m->>'kg')::numeric * factor, 3)) ELSE m->'kg' END
        ) ORDER BY e.ord), '[]'::jsonb)
      INTO new_mats
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.data->'materials') = 'array' THEN w.data->'materials' ELSE '[]'::jsonb END) WITH ORDINALITY e(m, ord);
    SELECT COALESCE(NULLIF(p.name, ''), p.email) INTO who FROM public.wms_profiles p WHERE p.id = auth.uid();
    UPDATE public.wms_secure_work_orders
       SET data = data || jsonb_build_object('prodQty', p_qty, 'prodUnit', trim(p_unit), 'materials', new_mats,
                                             'qtyChangedBy', who, 'qtyChangedAt', now()),
           updated_at = now()
     WHERE id = p_id
     RETURNING * INTO w;
    RETURN public.wms_wo_public_row(w);
END;
$$;

REVOKE ALL ON FUNCTION public.wms_has_wo_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wms_set_wo_user(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wms_wo_public_row(public.wms_secure_work_orders) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wms_wo_orders() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wms_wo_set_qty(TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_has_wo_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_set_wo_user(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_wo_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_wo_set_qty(TEXT, NUMERIC, TEXT) TO authenticated;

-- 내 프로필에 작업지시서 사용자 표시 (앱 메뉴용)
CREATE OR REPLACE FUNCTION public.wms_my_profile()
RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT json_build_object(
        'id', p.id,
        'email', p.email,
        'name', p.name,
        'dept', p.dept,
        'title', p.title,
        'role', public.wms_current_role(),
        'isMaster', public.wms_current_role() = 'MASTER',
        'masterEmail', (SELECT master_email FROM public.wms_app_settings),
        'worklogManager', p.worklog_manager,
        'worklogAccess', public.wms_has_worklog_access(),
        'woUser', public.wms_has_wo_user()
    )
    FROM public.wms_profiles p
    WHERE p.id = auth.uid();
$$;
