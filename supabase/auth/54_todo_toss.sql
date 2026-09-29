-- ==============================================================================
-- 54. 할일 토스 (내 할일을 다른 사람에게 넘기기)
-- ==============================================================================
-- 할일 메모장(FloatingTools)의 [토스]: 내 할일을 승인된 다른 사용자에게 넘긴다.
--   · 받는 사람의 할일(wms_todos)에 같은 내용·예정일·시간·알림·열 화면으로 새로 만든다 (id 'ASG:TOSS:…')
--   · 내 할일은 완료로 바꾸고 내용 끝에 '(→ 이름님에게 토스)'를 붙인다 (기록으로 남김)
-- wms_assign_todo는 현장 작업자 이상만 쓸 수 있지만, 토스는 '내 할일'만 넘기므로 승인된 사용자 누구나 쓴다.
-- 메시지(1:1 채팅)는 앱이 따로 보낸다.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.wms_toss_todo(p_src TEXT, p_owner UUID, p_new_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_src public.wms_todos%ROWTYPE;
    v_me TEXT;
    v_target TEXT;
BEGIN
    IF auth.uid() IS NULL OR coalesce(public.wms_current_role(), 'PENDING') = 'PENDING' THEN
        RAISE EXCEPTION '할일을 넘길 권한이 없습니다 (승인된 사용자만).';
    END IF;
    SELECT * INTO v_src FROM public.wms_todos WHERE id = p_src AND owner = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION '내 할일에서 찾을 수 없습니다.';
    END IF;
    IF p_owner IS NULL OR p_owner = auth.uid() THEN
        RAISE EXCEPTION '받는 사람을 고르세요 (나에게는 넘길 수 없습니다).';
    END IF;
    SELECT coalesce(nullif(name, ''), split_part(email, '@', 1)) INTO v_target
        FROM public.wms_profiles WHERE id = p_owner AND coalesce(role, 'PENDING') <> 'PENDING';
    IF v_target IS NULL THEN
        RAISE EXCEPTION '받는 사람을 찾을 수 없습니다 (승인된 사용자만).';
    END IF;
    IF coalesce(p_new_id, '') NOT LIKE 'ASG:TOSS:%' THEN
        RAISE EXCEPTION '할일 번호가 올바르지 않습니다.';
    END IF;
    SELECT coalesce(nullif(name, ''), split_part(email, '@', 1)) INTO v_me FROM public.wms_profiles WHERE id = auth.uid();

    INSERT INTO public.wms_todos (id, owner, text, done, due_date, due_time, remind_before, ref, link, assigned_by, assigned_by_name, starred, updated_at)
    VALUES (p_new_id, p_owner, v_src.text, false, v_src.due_date, v_src.due_time, v_src.remind_before, v_src.ref, v_src.link,
            auth.uid(), v_me, v_src.starred, now());

    UPDATE public.wms_todos
       SET done = true, done_at = now(), updated_at = now(),
           text = left(v_src.text || ' (→ ' || v_target || '님에게 토스)', 500)
     WHERE id = p_src AND owner = auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.wms_toss_todo(TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_toss_todo(TEXT, UUID, TEXT) TO authenticated;
