-- ==========================================
-- 63. ECOUNT ERP 코드 대응표 (품목 및 재고관리 → ERP 코드 대응표, components/ErpMap.js, services/erpMap.js)
-- ==========================================
-- 「대림오일 스마트 WMS 종합 추진 보고서」 5장 ERP 연동 1단계(11월): 품목·거래처·창고 대응표, 임시코드 정리.
-- wms_erp_master : ECOUNT에서 내려받은 엑셀(품목·거래처·창고 목록)을 올린 것 — 코드·이름·규격·단위만 (단가·사업자번호 등은 넣지 않음)
-- wms_erp_map    : WMS 쪽 하나(품목코드 / 거래처 이름 / 창고코드) ↔ ECOUNT 코드, 단위 환산, 상태(대응·보내지 않음)
-- 권한: 조회 VIEWER·경영자, 쓰기 MANAGER 이상

CREATE TABLE IF NOT EXISTS public.wms_erp_master (
    id text PRIMARY KEY,                       -- '<kind>:<code>'
    kind text NOT NULL CHECK (kind IN ('ITEM', 'PARTNER', 'WAREHOUSE')),
    code text NOT NULL,
    name text NOT NULL DEFAULT '',
    spec text NOT NULL DEFAULT '',
    unit text NOT NULL DEFAULT '',
    imported_at timestamptz NOT NULL DEFAULT now(),
    imported_by_name text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS wms_erp_master_kind_idx ON public.wms_erp_master (kind);
ALTER TABLE public.wms_erp_master ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.wms_erp_map (
    id text PRIMARY KEY,                       -- '<kind>:<wms_key>'
    kind text NOT NULL CHECK (kind IN ('ITEM', 'PARTNER', 'WAREHOUSE')),
    wms_key text NOT NULL,                     -- 품목코드 · 거래처 이름(정규화) · 위치("거점 / 창고코드" 또는 "거점")
    wms_name text NOT NULL DEFAULT '',
    erp_code text NOT NULL DEFAULT '',
    erp_name text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('MATCHED', 'NO_SEND', 'PENDING')),
    data jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { erpUnit, conv: SAME|SG|FACTOR, factor, note }
    updated_by_name text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_erp_map_kind_idx ON public.wms_erp_map (kind);
ALTER TABLE public.wms_erp_map ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['wms_erp_master', 'wms_erp_map'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.wms_has_role(''VIEWER'')) OR (SELECT public.wms_is_executive()))', t || '_select', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING ((SELECT public.wms_has_role(''MANAGER''))) WITH CHECK ((SELECT public.wms_has_role(''MANAGER'')))', t || '_write', t);
    END LOOP;
END $$;
