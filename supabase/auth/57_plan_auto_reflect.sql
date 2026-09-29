-- ==============================================================================
-- 57. 접수 업무 → 생산·구매계획 자동 반영 (services/planAuto.js)
-- ==============================================================================
-- 주간 계획(PROD_WEEK·PURCH_WEEK)은 매니저 이상만 쓸 수 있지만, 생산·구매요청서와 출고·이동 전표는
-- 현장 작업자도 등록하므로 등록할 때 계획에 자동으로 넣기 위해 범위를 좁힌 함수 두 개를 둔다.
--   wms_plan_merge_lines(kind, 주 월요일, 'REQ:<요청서id>:' 같은 접두어, 줄 배열)
--     · 그 주 문서의 줄 중 ref가 접두어로 시작하고 아직 손대지 않은(상태 PLAN · 실적 없음) 줄을 지우고 새 줄을 넣는다
--     · 새 줄은 모두 ref가 접두어로 시작하고 source가 REQ(생산요청)·PREQ(구매요청)여야 한다
--     · 진행·완료된 줄은 그대로 두고, 같은 ref의 새 줄은 넣지 않는다
--   wms_plan_merge_day_task(주 월요일, '<날짜>|<거점 또는 전체>', 업무)
--     · 일일 생산계획 업무 계획(dayTasks)에 출고·이동 전표 업무를 넣는다. 같은 전표번호 업무가 그 날짜에 있으면
--       자동으로 만든 업무(auto = 'SLIP')만 내용을 고치고, 사람이 만든 업무는 건드리지 않는다
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.wms_plan_merge_lines(p_kind TEXT, p_period TEXT, p_prefix TEXT, p_lines JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_id TEXT := p_kind || '-' || p_period;
    v_data JSONB;
    v_kept JSONB;
    v_new JSONB;
    v_name TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.wms_has_role('OPERATOR') THEN
        RAISE EXCEPTION '계획에 반영할 권한이 없습니다 (현장 작업자 이상).';
    END IF;
    IF p_kind NOT IN ('PROD_WEEK', 'PURCH_WEEK') THEN RAISE EXCEPTION '계획 종류가 올바르지 않습니다.'; END IF;
    IF p_period !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION '기간이 올바르지 않습니다.'; END IF;
    IF coalesce(p_prefix, '') !~ '^(REQ|PREQ):[A-Za-z0-9_-]+:$' THEN RAISE EXCEPTION '줄 구분이 올바르지 않습니다.'; END IF;
    p_lines := coalesce(p_lines, '[]'::jsonb);
    IF jsonb_typeof(p_lines) <> 'array' OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_lines) e
        WHERE left(coalesce(e->>'ref', ''), length(p_prefix)) <> p_prefix OR coalesce(e->>'source', '') NOT IN ('REQ', 'PREQ')
    ) THEN
        RAISE EXCEPTION '반영할 줄이 올바르지 않습니다.';
    END IF;

    SELECT data INTO v_data FROM public.wms_plans WHERE id = v_id FOR UPDATE;
    IF v_data IS NULL AND jsonb_array_length(p_lines) = 0 THEN RETURN NULL; END IF;
    v_data := coalesce(v_data, jsonb_build_object('lines', '[]'::jsonb, 'notes', '', 'author', ''));

    SELECT coalesce(jsonb_agg(e), '[]'::jsonb) INTO v_kept
    FROM jsonb_array_elements(coalesce(v_data->'lines', '[]'::jsonb)) e
    WHERE left(coalesce(e->>'ref', ''), length(p_prefix)) <> p_prefix
       OR coalesce(e->>'status', 'PLAN') <> 'PLAN'
       OR coalesce(e->>'doneQty', '') NOT IN ('', '0');

    SELECT coalesce(jsonb_agg(n), '[]'::jsonb) INTO v_new
    FROM jsonb_array_elements(p_lines) n
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_kept) k WHERE k->>'ref' = n->>'ref');

    v_data := jsonb_set(v_data, '{lines}', v_kept || v_new);
    SELECT coalesce(nullif(name, ''), split_part(email, '@', 1)) INTO v_name FROM public.wms_profiles WHERE id = auth.uid();
    INSERT INTO public.wms_plans (id, kind, period, data, updated_at, updated_by)
    VALUES (v_id, p_kind, p_period, v_data, now(), coalesce(v_name, ''))
    ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = now(), updated_by = excluded.updated_by;
    RETURN v_data;
END;
$$;
REVOKE ALL ON FUNCTION public.wms_plan_merge_lines(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_plan_merge_lines(TEXT, TEXT, TEXT, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.wms_plan_merge_day_task(p_period TEXT, p_key TEXT, p_task JSONB)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_id TEXT := 'PROD_WEEK-' || p_period;
    v_data JSONB;
    v_day TEXT := split_part(p_key, '|', 1);
    v_slip TEXT := coalesce(p_task->>'slipNo', '');
    v_key TEXT;
    v_tasks JSONB;
    v_i INT;
    v_name TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.wms_has_role('OPERATOR') THEN
        RAISE EXCEPTION '계획에 반영할 권한이 없습니다 (현장 작업자 이상).';
    END IF;
    IF p_period !~ '^\d{4}-\d{2}-\d{2}$' OR p_key !~ '^\d{4}-\d{2}-\d{2}\|.{1,10}$' THEN RAISE EXCEPTION '날짜가 올바르지 않습니다.'; END IF;
    IF v_slip = '' OR coalesce(p_task->>'auto', '') <> 'SLIP' OR coalesce(p_task->>'sec', '') NOT IN ('shipping', 'movement') THEN
        RAISE EXCEPTION '반영할 업무가 올바르지 않습니다.';
    END IF;

    SELECT data INTO v_data FROM public.wms_plans WHERE id = v_id FOR UPDATE;
    v_data := coalesce(v_data, jsonb_build_object('lines', '[]'::jsonb, 'notes', '', 'author', ''));
    IF jsonb_typeof(v_data->'dayTasks') IS DISTINCT FROM 'object' THEN v_data := jsonb_set(v_data, '{dayTasks}', '{}'::jsonb); END IF;

    -- 그 날짜의 업무에 같은 전표번호가 있으면: 자동 업무만 고치고 끝
    FOR v_key IN SELECT k FROM jsonb_object_keys(v_data->'dayTasks') k WHERE split_part(k, '|', 1) = v_day LOOP
        v_tasks := coalesce(v_data #> ARRAY['dayTasks', v_key, 'tasks'], '[]'::jsonb);
        FOR v_i IN 0 .. jsonb_array_length(v_tasks) - 1 LOOP
            IF v_tasks->v_i->>'slipNo' = v_slip THEN
                IF v_tasks->v_i->>'auto' = 'SLIP' THEN
                    v_tasks := jsonb_set(v_tasks, ARRAY[v_i::text], (v_tasks->v_i) || (p_task - 'id' - 'people'));
                    v_data := jsonb_set(v_data, ARRAY['dayTasks', v_key, 'tasks'], v_tasks);
                    UPDATE public.wms_plans SET data = v_data, updated_at = now() WHERE id = v_id;
                    RETURN 'UPDATED';
                END IF;
                RETURN 'EXISTS';
            END IF;
        END LOOP;
    END LOOP;

    IF v_data #> ARRAY['dayTasks', p_key] IS NULL THEN
        v_data := jsonb_set(v_data, ARRAY['dayTasks', p_key], jsonb_build_object('tasks', '[]'::jsonb, 'dist', NULL));
    END IF;
    v_tasks := coalesce(v_data #> ARRAY['dayTasks', p_key, 'tasks'], '[]'::jsonb) || jsonb_build_array(p_task);
    v_data := jsonb_set(v_data, ARRAY['dayTasks', p_key, 'tasks'], v_tasks);
    SELECT coalesce(nullif(name, ''), split_part(email, '@', 1)) INTO v_name FROM public.wms_profiles WHERE id = auth.uid();
    INSERT INTO public.wms_plans (id, kind, period, data, updated_at, updated_by)
    VALUES (v_id, 'PROD_WEEK', p_period, v_data, now(), coalesce(v_name, ''))
    ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = now(), updated_by = excluded.updated_by;
    RETURN 'ADDED';
END;
$$;
REVOKE ALL ON FUNCTION public.wms_plan_merge_day_task(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_plan_merge_day_task(TEXT, TEXT, JSONB) TO authenticated;
