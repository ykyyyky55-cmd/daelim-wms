-- ==============================================================================
-- 담당자 지정 · 할일 배정 · 알림
-- ==============================================================================
-- 서류·전표·일정에 담당자(수신자)를 지정하면 그 사람의 할일(wms_todos)에 등록하고 1:1 채팅 메시지를 보낸다.
-- 알림(앱 안 알림창·브라우저 알림)은 앱이 담당자의 할일을 보고 띄운다:
--   예정일 아침(08:00, 늦게 열면 그때), 시간이 있으면(출하 시간 등) remind_before분 전(기본 30분).
-- wms_todos : due_time(HH:MM), remind_before(분), ref(원본 서류 키), link(열 화면), assigned_by/assigned_by_name
-- wms_assign_todo / wms_unassign_todo : 다른 사람의 할일은 RLS(주인만)로 못 쓰므로 함수로 넣고 뺀다 (현장 작업자 이상).
-- 담당자 칸: wms_slips / wms_schedules / wms_production_schedule 에 assignee_id·assignee_name,
--           전표·생산스케줄에는 ship_time(출하 시간). 생산·구매요청서는 data JSONB 안에 둔다.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

ALTER TABLE public.wms_todos ADD COLUMN IF NOT EXISTS due_time TEXT;
ALTER TABLE public.wms_todos ADD COLUMN IF NOT EXISTS remind_before INTEGER;
ALTER TABLE public.wms_todos ADD COLUMN IF NOT EXISTS ref TEXT;
ALTER TABLE public.wms_todos ADD COLUMN IF NOT EXISTS link JSONB;
ALTER TABLE public.wms_todos ADD COLUMN IF NOT EXISTS assigned_by UUID;
ALTER TABLE public.wms_todos ADD COLUMN IF NOT EXISTS assigned_by_name TEXT;

ALTER TABLE public.wms_slips ADD COLUMN IF NOT EXISTS ship_time TEXT;
ALTER TABLE public.wms_slips ADD COLUMN IF NOT EXISTS assignee_id TEXT;
ALTER TABLE public.wms_slips ADD COLUMN IF NOT EXISTS assignee_name TEXT;
ALTER TABLE public.wms_schedules ADD COLUMN IF NOT EXISTS assignee_id TEXT;
ALTER TABLE public.wms_schedules ADD COLUMN IF NOT EXISTS assignee_name TEXT;
ALTER TABLE public.wms_production_schedule ADD COLUMN IF NOT EXISTS assignee_id TEXT;
ALTER TABLE public.wms_production_schedule ADD COLUMN IF NOT EXISTS assignee_name TEXT;
ALTER TABLE public.wms_production_schedule ADD COLUMN IF NOT EXISTS ship_time TEXT;

-- 할일 배정 (같은 id면 내용·일정을 고친다. 일정이 바뀌면 다시 '안 함'으로)
CREATE OR REPLACE FUNCTION public.wms_assign_todo(
    p_owner UUID, p_id TEXT, p_text TEXT, p_due DATE, p_due_time TEXT, p_remind INTEGER, p_ref TEXT, p_link JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_name TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.wms_has_role('OPERATOR') THEN
        RAISE EXCEPTION '담당자 지정 권한이 없습니다 (현장 작업자 이상).';
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
REVOKE ALL ON FUNCTION public.wms_assign_todo(UUID, TEXT, TEXT, DATE, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_assign_todo(UUID, TEXT, TEXT, DATE, TEXT, INTEGER, TEXT, JSONB) TO authenticated;

-- 배정 취소 (서류의 담당자를 바꾸거나 지울 때). 서류는 여러 사람이 고치므로 현장 작업자 이상이면
-- 배정된 할일(id ASG:…)만 지울 수 있다. 사람이 직접 적은 할일은 건드리지 않는다.
CREATE OR REPLACE FUNCTION public.wms_unassign_todo(p_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.wms_has_role('OPERATOR') THEN
        RAISE EXCEPTION '권한이 없습니다.';
    END IF;
    DELETE FROM public.wms_todos WHERE id = p_id AND id LIKE 'ASG:%';
END;
$$;
REVOKE ALL ON FUNCTION public.wms_unassign_todo(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_unassign_todo(TEXT) TO authenticated;

-- 새로 배정된 할일을 바로 받도록 realtime (구독도 RLS: 내 할일만)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wms_todos') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wms_todos;
    END IF;
END $$;
ALTER TABLE public.wms_todos REPLICA IDENTITY FULL;
