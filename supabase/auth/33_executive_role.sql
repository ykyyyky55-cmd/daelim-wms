-- ==============================================================================
-- 역할 추가: 경영자(EXECUTIVE) — 전체 조회 + 전자결재 서명 · 공지 등록 · 담당자 지정
-- ==============================================================================
-- 서열(wms_role_level)은 조회 전용(VIEWER)과 같은 1로 둔다 → 재고·수불부·품목 등 업무 자료 쓰기 정책(OPERATOR 이상)은 모두 막힌다.
-- 대신 wms_is_executive()로 아래만 따로 열어 준다.
--   · 조회: 매니저 이상만 읽던 표(계정 목록·전자서명·품목 합치기 기록·구글 챗 받은함)
--   · 쓰기: 전자결재 서명/취소(wms_sign·wms_unsign, 본인 서명만 취소), 할일 배정(wms_assign_todo·wms_unassign_todo), 공지 등록
-- 원액 배합(제조시방서·작업지시서)은 계속 마스터·작업일지 관리자만 본다(wms_has_worklog_access).
-- 경영자 부여·변경은 관리자(ADMIN) 이상만 한다.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.wms_role_level(r text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
    SELECT CASE r
        WHEN 'MASTER' THEN 5
        WHEN 'ADMIN' THEN 4
        WHEN 'MANAGER' THEN 3
        WHEN 'OPERATOR' THEN 2
        WHEN 'VIEWER' THEN 1
        WHEN 'EXECUTIVE' THEN 1
        ELSE 0
    END;
$$;

CREATE OR REPLACE FUNCTION public.wms_is_executive()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT coalesce(public.wms_current_role() = 'EXECUTIVE', false); $$;
REVOKE ALL ON FUNCTION public.wms_is_executive() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_is_executive() TO authenticated;

ALTER TABLE public.wms_profiles DROP CONSTRAINT IF EXISTS wms_profiles_role_check;
ALTER TABLE public.wms_profiles ADD CONSTRAINT wms_profiles_role_check
    CHECK (role IN ('PENDING', 'VIEWER', 'OPERATOR', 'MANAGER', 'ADMIN', 'EXECUTIVE'));

-- 조회 정책: 경영자도 읽기
DROP POLICY IF EXISTS "wms_profiles_select" ON public.wms_profiles;
CREATE POLICY "wms_profiles_select" ON public.wms_profiles FOR SELECT TO authenticated
    USING (id = (SELECT auth.uid()) OR public.wms_has_role('MANAGER') OR public.wms_is_executive());
DROP POLICY IF EXISTS "wms_signatures_select" ON public.wms_signatures;
CREATE POLICY "wms_signatures_select" ON public.wms_signatures FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.wms_has_role('MANAGER') OR public.wms_is_executive());
DROP POLICY IF EXISTS "wms_merge_logs_select" ON public.wms_merge_logs;
CREATE POLICY "wms_merge_logs_select" ON public.wms_merge_logs FOR SELECT TO authenticated
    USING (public.wms_has_role('MANAGER') OR public.wms_is_executive());
DROP POLICY IF EXISTS "wms_chat_inbox_select" ON public.wms_chat_inbox;
CREATE POLICY "wms_chat_inbox_select" ON public.wms_chat_inbox FOR SELECT TO authenticated
    USING (public.wms_has_role('OPERATOR') OR public.wms_is_executive());

-- 공지 등록: 매니저 이상 또는 경영자 (삭제는 그대로 관리자 이상)
DROP POLICY IF EXISTS "wms_notices_insert" ON public.wms_notices;
CREATE POLICY "wms_notices_insert" ON public.wms_notices FOR INSERT TO authenticated
    WITH CHECK ((public.wms_has_role('MANAGER') OR public.wms_is_executive()) AND author = auth.uid());
DROP POLICY IF EXISTS "wms_notices_update" ON public.wms_notices;
CREATE POLICY "wms_notices_update" ON public.wms_notices FOR UPDATE TO authenticated
    USING ((author = auth.uid() AND (public.wms_has_role('MANAGER') OR public.wms_is_executive())) OR public.wms_has_role('ADMIN'))
    WITH CHECK ((author = auth.uid() AND (public.wms_has_role('MANAGER') OR public.wms_is_executive())) OR public.wms_has_role('ADMIN'));

-- 전자결재 서명 (30_e_approval.sql과 같고 권한 검사만 경영자 포함)
CREATE OR REPLACE FUNCTION public.wms_sign(
    p_key TEXT, p_type TEXT, p_title TEXT, p_date TEXT, p_roles JSONB, p_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid   UUID := auth.uid();
    v_name  TEXT;
    v_title TEXT;
    v_sig   TEXT;
    v_slots JSONB;
    v_old   JSONB;
BEGIN
    IF v_uid IS NULL OR NOT (public.wms_has_role('OPERATOR') OR public.wms_is_executive()) THEN
        RAISE EXCEPTION '결재 서명 권한이 없습니다 (현장 작업자 이상 또는 경영자).';
    END IF;
    IF coalesce(p_key, '') = '' OR coalesce(p_role, '') = '' THEN
        RAISE EXCEPTION '문서 또는 결재 칸이 지정되지 않았습니다.';
    END IF;
    IF jsonb_typeof(p_roles) <> 'array' OR NOT (p_roles ? p_role) THEN
        RAISE EXCEPTION '결재 칸(%)이 이 문서의 결재라인에 없습니다.', p_role;
    END IF;
    SELECT coalesce(nullif(p.name, ''), split_part(p.email, '@', 1)), coalesce(p.title, '')
      INTO v_name, v_title
      FROM public.wms_profiles p WHERE p.id = v_uid;
    SELECT s.image INTO v_sig FROM public.wms_signatures s WHERE s.user_id = v_uid;
    IF v_sig IS NULL THEN
        RAISE EXCEPTION '등록된 전자서명이 없습니다. 전자결재 → 내 전자서명에서 먼저 등록하세요.';
    END IF;
    INSERT INTO public.wms_approvals (doc_key, doc_type, doc_title, doc_date, roles)
    VALUES (p_key, coalesce(p_type, ''), coalesce(p_title, ''), coalesce(p_date, ''), p_roles)
    ON CONFLICT (doc_key) DO NOTHING;
    SELECT slots INTO v_slots FROM public.wms_approvals WHERE doc_key = p_key FOR UPDATE;
    v_old := v_slots -> p_role;
    IF v_old IS NOT NULL AND (v_old ->> 'uid') IS DISTINCT FROM v_uid::text THEN
        RAISE EXCEPTION '이미 %님이 서명한 칸입니다.', v_old ->> 'name';
    END IF;
    UPDATE public.wms_approvals
       SET slots = slots || jsonb_build_object(p_role, jsonb_build_object(
               'uid', v_uid, 'name', coalesce(v_name, ''), 'title', coalesce(v_title, ''),
               'sig', v_sig, 'at', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS'))),
           roles = p_roles,
           doc_type = coalesce(nullif(p_type, ''), doc_type),
           doc_title = coalesce(nullif(p_title, ''), doc_title),
           doc_date = coalesce(nullif(p_date, ''), doc_date),
           updated_at = now()
     WHERE doc_key = p_key
     RETURNING slots INTO v_slots;
    RETURN v_slots;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_unsign(p_key TEXT, p_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid   UUID := auth.uid();
    v_old   JSONB;
    v_slots JSONB;
BEGIN
    IF v_uid IS NULL OR NOT (public.wms_has_role('OPERATOR') OR public.wms_is_executive()) THEN
        RAISE EXCEPTION '권한이 없습니다.';
    END IF;
    SELECT slots -> p_role INTO v_old FROM public.wms_approvals WHERE doc_key = p_key FOR UPDATE;
    IF v_old IS NULL THEN
        SELECT slots INTO v_slots FROM public.wms_approvals WHERE doc_key = p_key;
        RETURN coalesce(v_slots, '{}'::jsonb);
    END IF;
    IF (v_old ->> 'uid') IS DISTINCT FROM v_uid::text AND NOT public.wms_has_role('MANAGER') THEN
        RAISE EXCEPTION '다른 사람의 서명은 자재 관리자 이상만 취소할 수 있습니다.';
    END IF;
    UPDATE public.wms_approvals SET slots = slots - p_role, updated_at = now()
     WHERE doc_key = p_key RETURNING slots INTO v_slots;
    RETURN v_slots;
END;
$$;

-- 할일 배정 (31_assign_notify.sql과 같고 권한 검사만 경영자 포함)
CREATE OR REPLACE FUNCTION public.wms_assign_todo(
    p_owner UUID, p_id TEXT, p_text TEXT, p_due DATE, p_due_time TEXT, p_remind INTEGER, p_ref TEXT, p_link JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_name TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT (public.wms_has_role('OPERATOR') OR public.wms_is_executive()) THEN
        RAISE EXCEPTION '담당자 지정 권한이 없습니다 (현장 작업자 이상 또는 경영자).';
    END IF;
    IF p_owner IS NULL OR NOT EXISTS (SELECT 1 FROM public.wms_profiles WHERE id = p_owner) THEN
        RAISE EXCEPTION '담당자를 찾을 수 없습니다.';
    END IF;
    IF coalesce(p_id, '') = '' OR p_id NOT LIKE 'ASG:%' THEN
        RAISE EXCEPTION '할일 번호가 올바르지 않습니다.';
    END IF;
    IF coalesce(trim(p_text), '') = '' THEN
        RAISE EXCEPTION '할일 내용이 비어 있습니다.';
    END IF;
    SELECT coalesce(nullif(name, ''), split_part(email, '@', 1)) INTO v_name FROM public.wms_profiles WHERE id = auth.uid();
    INSERT INTO public.wms_todos (id, owner, text, done, due_date, due_time, remind_before, ref, link, assigned_by, assigned_by_name, starred, updated_at)
    VALUES (p_id, p_owner, left(p_text, 500), false, p_due, nullif(p_due_time, ''), p_remind, p_ref, p_link, auth.uid(), v_name, false, now())
    ON CONFLICT (id) DO UPDATE SET
        text = excluded.text,
        done = CASE WHEN wms_todos.due_date IS DISTINCT FROM excluded.due_date OR wms_todos.due_time IS DISTINCT FROM excluded.due_time
                    THEN false ELSE wms_todos.done END,
        done_at = CASE WHEN wms_todos.due_date IS DISTINCT FROM excluded.due_date OR wms_todos.due_time IS DISTINCT FROM excluded.due_time
                    THEN NULL ELSE wms_todos.done_at END,
        due_date = excluded.due_date, due_time = excluded.due_time, remind_before = excluded.remind_before,
        ref = excluded.ref, link = excluded.link, assigned_by = excluded.assigned_by, assigned_by_name = excluded.assigned_by_name,
        updated_at = now()
    WHERE wms_todos.owner = p_owner;
END;
$$;

CREATE OR REPLACE FUNCTION public.wms_unassign_todo(p_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT (public.wms_has_role('OPERATOR') OR public.wms_is_executive()) THEN
        RAISE EXCEPTION '권한이 없습니다.';
    END IF;
    DELETE FROM public.wms_todos WHERE id = p_id AND id LIKE 'ASG:%';
END;
$$;

-- 역할 변경: 경영자 부여·변경은 관리자(ADMIN) 이상만
CREATE OR REPLACE FUNCTION public.wms_set_user_role(target uuid, new_role text, new_dept text DEFAULT NULL::text, new_title text DEFAULT NULL::text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    caller_level INT := public.wms_role_level(public.wms_current_role());
    target_role TEXT := public.wms_role_of(target);
    target_level INT := public.wms_role_level(target_role);
    result JSON;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION '로그인이 필요합니다.';
    END IF;
    IF target = auth.uid() THEN
        RAISE EXCEPTION '자기 자신의 역할은 변경할 수 없습니다.';
    END IF;
    IF new_role NOT IN ('PENDING', 'VIEWER', 'OPERATOR', 'MANAGER', 'ADMIN', 'EXECUTIVE') THEN
        RAISE EXCEPTION '알 수 없는 역할입니다: %', new_role;
    END IF;
    IF caller_level < public.wms_role_level('MANAGER') THEN
        RAISE EXCEPTION '역할을 변경할 권한이 없습니다.';
    END IF;
    IF (new_role = 'EXECUTIVE' OR target_role = 'EXECUTIVE') AND caller_level < public.wms_role_level('ADMIN') THEN
        RAISE EXCEPTION '경영자 권한 부여·변경은 관리자 이상만 할 수 있습니다.';
    END IF;
    IF target_level >= caller_level THEN
        RAISE EXCEPTION '자신과 같거나 높은 역할의 사용자는 변경할 수 없습니다.';
    END IF;
    IF public.wms_role_level(new_role) >= caller_level THEN
        RAISE EXCEPTION '자신과 같거나 높은 역할은 부여할 수 없습니다.';
    END IF;

    UPDATE public.wms_profiles
    SET role = new_role,
        dept = COALESCE(new_dept, dept),
        title = COALESCE(new_title, title),
        approved_at = CASE WHEN role = 'PENDING' AND new_role <> 'PENDING' THEN NOW() ELSE approved_at END,
        approved_by = CASE WHEN role = 'PENDING' AND new_role <> 'PENDING' THEN auth.uid() ELSE approved_by END
    WHERE id = target
    RETURNING json_build_object('id', id, 'email', email, 'name', name, 'role', role, 'dept', dept, 'title', title)
    INTO result;

    IF result IS NULL THEN
        RAISE EXCEPTION '사용자를 찾을 수 없습니다.';
    END IF;
    RETURN result;
END;
$$;
