-- 52: 드럼 라벨(폼텍 3120) 목록·출력 이력 클라우드 저장 (PC끼리 공유)
-- 예전에는 PC마다 localStorage(LABEL_APP_SAVED_DATA_V19)에만 있었다. 앱(services/drumLabels.js)이 처음 열 때
-- 이 PC에만 있던 라벨을 올리고, 이후 바뀐 라벨만 모아 올린다. 체크박스 선택은 PC마다 따로(저장 안 함).
--   wms_drum_labels       라벨 한 줄 = 한 행 (data: sheet·productName·date·lotNo·qty·note·inspectDate)
--   wms_drum_label_prints 출력(발행) 이력 한 번 = 한 행 (items: 인쇄한 라벨들)
-- 권한: 조회 VIEWER·경영자 / 쓰기 OPERATOR / 출력 이력 지우기 MANAGER

CREATE TABLE IF NOT EXISTS public.wms_drum_labels (
    id              text PRIMARY KEY,
    sort_order      integer NOT NULL DEFAULT 0,
    data            jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid DEFAULT auth.uid(),
    updated_by_name text
);
CREATE INDEX IF NOT EXISTS wms_drum_labels_sort_idx ON public.wms_drum_labels (sort_order);

CREATE TABLE IF NOT EXISTS public.wms_drum_label_prints (
    id              text PRIMARY KEY,
    printed_at      timestamptz NOT NULL DEFAULT now(),
    printed_by      uuid DEFAULT auth.uid(),
    printed_by_name text,
    items           jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS wms_drum_label_prints_at_idx ON public.wms_drum_label_prints (printed_at DESC);

ALTER TABLE public.wms_drum_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_drum_label_prints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_drum_labels, public.wms_drum_label_prints FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_drum_labels, public.wms_drum_label_prints TO authenticated;

DROP POLICY IF EXISTS wms_drum_labels_select ON public.wms_drum_labels;
CREATE POLICY wms_drum_labels_select ON public.wms_drum_labels FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
DROP POLICY IF EXISTS wms_drum_labels_insert ON public.wms_drum_labels;
CREATE POLICY wms_drum_labels_insert ON public.wms_drum_labels FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
DROP POLICY IF EXISTS wms_drum_labels_update ON public.wms_drum_labels;
CREATE POLICY wms_drum_labels_update ON public.wms_drum_labels FOR UPDATE TO authenticated
    USING ((SELECT public.wms_has_role('OPERATOR'))) WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
DROP POLICY IF EXISTS wms_drum_labels_delete ON public.wms_drum_labels;
CREATE POLICY wms_drum_labels_delete ON public.wms_drum_labels FOR DELETE TO authenticated
    USING ((SELECT public.wms_has_role('OPERATOR')));

DROP POLICY IF EXISTS wms_drum_label_prints_select ON public.wms_drum_label_prints;
CREATE POLICY wms_drum_label_prints_select ON public.wms_drum_label_prints FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
DROP POLICY IF EXISTS wms_drum_label_prints_insert ON public.wms_drum_label_prints;
CREATE POLICY wms_drum_label_prints_insert ON public.wms_drum_label_prints FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
DROP POLICY IF EXISTS wms_drum_label_prints_delete ON public.wms_drum_label_prints;
CREATE POLICY wms_drum_label_prints_delete ON public.wms_drum_label_prints FOR DELETE TO authenticated
    USING ((SELECT public.wms_has_role('MANAGER')));
