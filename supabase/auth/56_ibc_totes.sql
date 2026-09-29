-- ==============================================================================
-- 56. IBC(공토트) 품목코드 · 유종별 전용 공토트 · IBC 탱크 대장
-- ==============================================================================
-- 품목 (services/ibcTotes.js의 TOTE_BASE · OIL_TYPES와 같아야 한다)
--   990001    IBC(공토트)               용도 없는 공토트 (임시코드)
--   990001-1  IBC(공토트)(엔진오일)      유종 전용 공토트: 한 번 그 유종 원액을 담은 용기는 계속 같은 유종만 담는다
--   990001-2  IBC(공토트)(엔진코팅제) … 990001-9  IBC(공토트)(세정제·기타)
--   유종 = 원액 품목코드 2~3번째 글자 (AA 엔진오일, AB 엔진코팅제, AC 연료첨가제, AD DPF 클리너, AE 요소수 첨가제,
--          AF 방청윤활제, AG 부동액, AH 브레이크액, AJ 세정제·기타)
-- 흐름 (앱)
--   원액을 IBC에 담아 생산 입고 → 그 유종 공토트(없으면 990001) 1개 차감 + IBC 탱크 대장(wms_ibc_tanks)에 등록
--   완제품 생산에 원액 투입 → 먼저 채운 IBC부터 남은 양 차감, 0이 되면 '비움' + 그 유종 공토트(990001-n) 1개 입고
--   IBC 관리 화면의 [비움] 버튼으로도 처리
-- 기존 '0000-015 공토트' 재고(김포공장 37 · 본사 5 · 본사/본사2A 6)는 990001로 옮기고 0000-015는 사용 중지로 표시한다.
-- 여러 번 실행해도 안전하다 (재고 이전은 0000-015 재고가 남아 있을 때만).
-- ==============================================================================

-- 1. 품목
INSERT INTO public.wms_master_items (code, name, category, supplier, spec, unit, safety) VALUES
    ('990001',   'IBC(공토트)',                '부자재', '', '1,000L', 'EA', 0),
    ('990001-1', 'IBC(공토트)(엔진오일)',      '부자재', '', '1,000L', 'EA', 0),
    ('990001-2', 'IBC(공토트)(엔진코팅제)',    '부자재', '', '1,000L', 'EA', 0),
    ('990001-3', 'IBC(공토트)(연료첨가제)',    '부자재', '', '1,000L', 'EA', 0),
    ('990001-4', 'IBC(공토트)(DPF 클리너)',    '부자재', '', '1,000L', 'EA', 0),
    ('990001-5', 'IBC(공토트)(요소수 첨가제)', '부자재', '', '1,000L', 'EA', 0),
    ('990001-6', 'IBC(공토트)(방청윤활제)',    '부자재', '', '1,000L', 'EA', 0),
    ('990001-7', 'IBC(공토트)(부동액)',        '부자재', '', '1,000L', 'EA', 0),
    ('990001-8', 'IBC(공토트)(브레이크액)',    '부자재', '', '1,000L', 'EA', 0),
    ('990001-9', 'IBC(공토트)(세정제·기타)',   '부자재', '', '1,000L', 'EA', 0)
ON CONFLICT (code) DO UPDATE SET name = excluded.name, category = excluded.category, spec = excluded.spec, unit = excluded.unit;

-- 2. 기존 0000-015 공토트 재고 → 990001 (재고·이력·자재수불부 기록)
DO $$
DECLARE
    r RECORD;
    v_site TEXT;
    v_moved NUMERIC := 0;
BEGIN
    FOR r IN SELECT id, location, quantity FROM public.wms_inventory WHERE code = '0000-015' AND quantity > 0 LOOP
        INSERT INTO public.wms_inventory (code, location, quantity, status, last_updated)
        VALUES ('990001', r.location, r.quantity, '정상 보관', now())
        ON CONFLICT DO NOTHING;
        IF NOT FOUND THEN
            UPDATE public.wms_inventory SET quantity = quantity + r.quantity, last_updated = now() WHERE code = '990001' AND location = r.location;
        END IF;
        UPDATE public.wms_inventory SET quantity = 0, last_updated = now() WHERE id = r.id;
        INSERT INTO public.wms_history_logs (type, code, name, qty, worker, from_loc, to_loc, reason) VALUES
            ('OUT', '0000-015', '공토트', r.quantity, '시스템', r.location, '-', '품목코드 변경: 0000-015 공토트 → 990001 IBC(공토트)'),
            ('IN', '990001', 'IBC(공토트)', r.quantity, '시스템', '-', r.location, '품목코드 변경: 0000-015 공토트 → 990001 IBC(공토트)');
        v_moved := v_moved + r.quantity;
    END LOOP;
    -- 수불부는 거점 단위('본사 / 본사2A' → '본사')
    IF v_moved > 0 THEN
        FOR r IN SELECT split_part(location, ' / ', 1) AS site, sum(quantity) AS qty FROM public.wms_inventory WHERE code = '990001' GROUP BY 1 LOOP
            INSERT INTO public.wms_item_ledger (id, kind, entry_date, location, code, name, type, notes, in_qty, out_qty, stock_qty, unit, remark, worker) VALUES
                ('MIG56-OUT-' || r.site, 'product', current_date, r.site, '0000-015', '공토트', '출고', '품목코드 변경: 990001 IBC(공토트)로 이전', 0, r.qty, 0, 'EA', '', '시스템'),
                ('MIG56-IN-' || r.site, 'material', current_date, r.site, '990001', 'IBC(공토트)', '입고', '품목코드 변경: 0000-015 공토트에서 이전', r.qty, 0, r.qty, 'EA', '', '시스템')
            ON CONFLICT (id) DO NOTHING;
        END LOOP;
    END IF;
END $$;

UPDATE public.wms_master_items SET name = '(사용중지) 공토트 → 990001 IBC(공토트)' WHERE code = '0000-015';
-- 업무일지 약칭(D40 공토트 · D60 공토트 등)도 새 코드로
UPDATE public.wms_item_aliases SET code = '990001', updated_at = now() WHERE code = '0000-015';

-- 3. IBC 탱크 대장
CREATE TABLE IF NOT EXISTS public.wms_ibc_tanks (
    id TEXT PRIMARY KEY,
    tote_code TEXT NOT NULL,          -- 990001-n (이 IBC가 비면 돌아갈 유종 공토트)
    oil_type TEXT NOT NULL,           -- AA · AB …
    blend_code TEXT NOT NULL,         -- 담은 원액 품목코드
    blend_name TEXT,
    lot TEXT,
    location TEXT NOT NULL,
    filled_qty NUMERIC NOT NULL DEFAULT 0,
    remaining NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'FILLED' CHECK (status IN ('FILLED', 'EMPTY')),
    filled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    emptied_at TIMESTAMPTZ,
    source TEXT,                      -- 생산 입고 · 업무일지 · 수동 등록
    notes TEXT,
    created_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_ibc_tanks_open ON public.wms_ibc_tanks (blend_code, status, filled_at);
ALTER TABLE public.wms_ibc_tanks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_ibc_tanks_select ON public.wms_ibc_tanks;
CREATE POLICY wms_ibc_tanks_select ON public.wms_ibc_tanks FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
DROP POLICY IF EXISTS wms_ibc_tanks_insert ON public.wms_ibc_tanks;
CREATE POLICY wms_ibc_tanks_insert ON public.wms_ibc_tanks FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
DROP POLICY IF EXISTS wms_ibc_tanks_update ON public.wms_ibc_tanks;
CREATE POLICY wms_ibc_tanks_update ON public.wms_ibc_tanks FOR UPDATE TO authenticated
    USING ((SELECT public.wms_has_role('OPERATOR'))) WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
DROP POLICY IF EXISTS wms_ibc_tanks_delete ON public.wms_ibc_tanks;
CREATE POLICY wms_ibc_tanks_delete ON public.wms_ibc_tanks FOR DELETE TO authenticated
    USING ((SELECT public.wms_has_role('MANAGER')));
