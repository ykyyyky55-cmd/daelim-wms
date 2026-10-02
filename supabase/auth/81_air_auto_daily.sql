-- ==========================================
-- 81. 환경관리(대기): 운영기록부 매일 18:00 자동 작성 + 김포 업무일지(원액생산작업) 반영
-- ==========================================
-- 예전 운영기록부 앱의 서버가 하던 "매일 18:00 자동 작성"을 DB의 예약 작업(pg_cron)으로 옮긴다. 화면을 열지 않아도 동작한다.
--   · 첫 기록일부터 그날까지 기록이 없는 날짜를 만든다 (이미 있는 날짜는 덮어쓰지 않는다).
--   · 배출구 가동은 업무일지(김포) wms_gimpo_logs 의 원액생산작업(data.oilBlending) 줄의 line 으로 정한다:
--       BT-1 → 배출구 1, BT-2 → 배출구 2, BT-3 → 배출구 3, BT-5 → 배출구 4, BT-6 → 배출구 5
--     그 배출구는 09:00 ~ 18:00 정상 가동, 나머지는 미가동(가동한 배출구가 없는 휴무일은 휴무).
--     line 이 비어 있는 줄은 업무일지 화면이 BT-2로 보여 주므로 BT-2로 본다. 배출구는 항상 1~5번 다섯 줄이다.
--   · 원액생산작업이 없으면: 토·일·공휴일 = 휴무, 평일 = 미가동.
--   · 날씨 = 김포시 월곶면 (Open-Meteo, 받지 못하면 맑음·15 ~ 25℃), 결재 도장 자동 날인.
--   · 자동 작성한 뒤 아무도 고치지 않은 기록(updated_by_name = '자동 작성')은 업무일지가 나중에 바뀌면 최근 31일 안에서 배출구 칸만 다시 맞춘다.
--     사람이 저장한 기록(updated_by_name 이 그 사람 이름)은 건드리지 않는다.
-- 화면(public/air/js/autoFill.js)도 같은 함수를 부른다: wms_air_auto_fill() — 매니저 이상. 18시 전에는 어제까지만 채운다(오늘 것은 18시 예약 작업 몫).
-- 여러 번 실행해도 안전하다.
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 휴무 사유 (평일이면 NULL). 공휴일 표는 해마다 더한다.
CREATE OR REPLACE FUNCTION public.wms_air_holiday_reason(p_date date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT CASE
        WHEN extract(dow FROM p_date) = 6 THEN '토요일(주말 휴무)'
        WHEN extract(dow FROM p_date) = 0 THEN '일요일(주말 휴무)'
        ELSE coalesce(
            (SELECT '공휴일(' || h.name || ')' FROM (VALUES
                ('2026-01-01', '신정'), ('2026-02-16', '설날연휴'), ('2026-02-17', '설날'), ('2026-02-18', '설날연휴'),
                ('2026-03-01', '삼일절'), ('2026-03-02', '대체공휴일'), ('2026-05-05', '어린이날'), ('2026-05-24', '부처님오신날'),
                ('2026-05-25', '대체공휴일'), ('2026-06-03', '지방선거'), ('2026-06-06', '현충일'), ('2026-08-15', '광복절'),
                ('2026-08-17', '대체공휴일'), ('2026-09-24', '추석연휴'), ('2026-09-25', '추석'), ('2026-09-26', '추석연휴'),
                ('2026-09-28', '대체공휴일'), ('2026-10-03', '개천절'), ('2026-10-05', '대체공휴일'), ('2026-10-09', '한글날'),
                ('2026-12-25', '기독탄신일(크리스마스)'),
                ('2027-01-01', '신정'), ('2027-02-06', '설날연휴'), ('2027-02-07', '설날'), ('2027-02-08', '설날연휴'),
                ('2027-02-09', '대체공휴일'), ('2027-03-01', '삼일절'), ('2027-05-05', '어린이날'), ('2027-05-13', '부처님오신날'),
                ('2027-06-06', '현충일'), ('2027-08-15', '광복절'), ('2027-08-16', '대체공휴일'), ('2027-09-14', '추석연휴'),
                ('2027-09-15', '추석'), ('2027-09-16', '추석연휴'), ('2027-10-03', '개천절'), ('2027-10-04', '대체공휴일'),
                ('2027-10-09', '한글날'), ('2027-10-11', '대체공휴일'), ('2027-12-25', '기독탄신일(크리스마스)')
            ) h(d, name) WHERE h.d = to_char(p_date, 'YYYY-MM-DD')),
            (SELECT '법정공휴일(' || f.name || ')' FROM (VALUES
                ('01-01', '신정'), ('03-01', '삼일절'), ('05-05', '어린이날'), ('06-06', '현충일'),
                ('08-15', '광복절'), ('10-03', '개천절'), ('10-09', '한글날'), ('12-25', '성탄절')
            ) f(md, name) WHERE f.md = to_char(p_date, 'MM-DD'))
        )
    END
$$;

-- 그날 업무일지(김포)의 원액생산작업에서 쓴 블렌딩 탱크 → 가동한 배출구 번호
CREATE OR REPLACE FUNCTION public.wms_air_running_exhausts(p_date date) RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT coalesce(array_agg(DISTINCT m.no ORDER BY m.no), '{}'::integer[])
    FROM public.wms_gimpo_logs g
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(g.data->'oilBlending') = 'array' THEN g.data->'oilBlending' ELSE '[]'::jsonb END) r
    JOIN (VALUES ('BT1', 1), ('BT2', 2), ('BT3', 3), ('BT5', 4), ('BT6', 5)) m(line, no)
      ON m.line = coalesce(nullif(regexp_replace(upper(coalesce(r->>'line', '')), '[^A-Z0-9]', '', 'g'), ''), 'BT2')
    WHERE g.log_date = to_char(p_date, 'YYYY-MM-DD')
$$;

-- 배출구 칸과 그에 딸린 값 (가동 배출구·휴무 여부로 정해지는 부분)
CREATE OR REPLACE FUNCTION public.wms_air_exhaust_fields(p_date date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_running integer[] := public.wms_air_running_exhausts(p_date);
    v_reason text := public.wms_air_holiday_reason(p_date);
    v_is_running boolean := cardinality(v_running) > 0;
    v_idle_note text;
BEGIN
    v_idle_note := CASE WHEN v_reason IS NOT NULL AND NOT v_is_running THEN '휴무' ELSE '미가동' END;
    RETURN jsonb_build_object(
        'isHoliday', v_reason IS NOT NULL,
        'holidayReason', coalesce(v_reason, '평일'),
        'status', CASE WHEN v_is_running THEN 'NORMAL' WHEN v_reason IS NOT NULL THEN 'HOLIDAY' ELSE 'IDLE' END,
        'exhaustList', (SELECT jsonb_agg(jsonb_build_object(
                'id', n, 'facility', '혼합시설',
                'opTime', CASE WHEN n = ANY(v_running) THEN '09:00 ~ 18:00' ELSE '-' END,
                'note', CASE WHEN n = ANY(v_running) THEN '정상' ELSE v_idle_note END) ORDER BY n)
            FROM generate_series(1, 5) n),
        'engineerOpinion', CASE
            WHEN v_is_running THEN '특이사항 없음. 배출시설(혼합시설 ' || array_to_string(v_running, ', ') || '번) 정상 가동.'
            WHEN v_reason IS NOT NULL THEN v_reason || '로 인한 배출시설 미가동.'
            ELSE '배출시설 미가동.' END
    );
END $$;

-- 자바스크립트 encodeURIComponent 와 같은 글자 바꾸기 (도장 SVG를 data URL로)
CREATE OR REPLACE FUNCTION public.wms_air_urlencode(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT coalesce(string_agg(
        CASE WHEN s.ch ~ '^[A-Za-z0-9_.!~*''()-]$' THEN s.ch
             ELSE (SELECT string_agg('%' || upper(lpad(to_hex(get_byte(convert_to(s.ch, 'UTF8'), i)), 2, '0')), '' ORDER BY i)
                   FROM generate_series(0, octet_length(convert_to(s.ch, 'UTF8')) - 1) i)
        END, '' ORDER BY s.ord), '')
    FROM regexp_split_to_table(p_text, '') WITH ORDINALITY s(ch, ord)
$$;

-- 결재 도장 (예전 앱이 찍던 것과 같은 SVG: 전자결재 / 윤경용 / YYYY.MM.DD)
CREATE OR REPLACE FUNCTION public.wms_air_stamp(p_date date) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT 'data:image/svg+xml;utf8,' || public.wms_air_urlencode(
        E'<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 140 140">\n'
        || E'    <!-- 외곽 굵은 원 -->\n'
        || E'    <circle cx="70" cy="70" r="63" fill="none" stroke="#dc2626" stroke-width="3.5" />\n'
        || E'    <!-- 안쪽 가는 원 -->\n'
        || E'    <circle cx="70" cy="70" r="57" fill="none" stroke="#dc2626" stroke-width="1.5" />\n'
        || E'    <!-- 상단 텍스트: 전자결재 -->\n'
        || E'    <text x="70" y="37" fill="#dc2626" font-family="\'Noto Sans KR\', sans-serif" font-weight="bold" font-size="13" text-anchor="middle">전자결재</text>\n'
        || E'    <!-- 중앙 이름: 윤경용 -->\n'
        || E'    <text x="70" y="78" fill="#dc2626" font-family="\'Noto Sans KR\', sans-serif" font-weight="bold" font-size="25" text-anchor="middle">윤경용</text>\n'
        || E'    <!-- 하단 일자: YYYY.MM.DD -->\n'
        || E'    <text x="70" y="108" fill="#dc2626" font-family="\'Noto Sans KR\', sans-serif" font-weight="bold" font-size="11" text-anchor="middle">'
        || to_char(p_date, 'YYYY.MM.DD') || E'</text>\n'
        || '  </svg>')
$$;

-- 김포시 월곶면의 날짜별 날씨: { "YYYY-MM-DD": { "weather": "맑음", "temp": "10 ~ 19℃" } } (최근 92일 + 오늘). 받지 못하면 {}
CREATE OR REPLACE FUNCTION public.wms_air_weather() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_daily jsonb;
    v_out jsonb;
BEGIN
    SELECT (content::jsonb)->'daily' INTO v_daily
    FROM extensions.http_get('https://api.open-meteo.com/v1/forecast?latitude=37.6997&longitude=126.5431&past_days=92&forecast_days=1&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia%2FSeoul')
    WHERE status = 200;
    IF v_daily IS NULL THEN RETURN '{}'::jsonb; END IF;

    SELECT jsonb_object_agg(t.d, jsonb_build_object(
        'weather', CASE
            WHEN c.code IN (0, 1) THEN '맑음'
            WHEN c.code = 2 THEN '구름조금'
            WHEN c.code = 3 THEN '구름많음'
            WHEN c.code IN (45, 48) THEN '흐림'
            WHEN c.code IN (51, 53, 55, 61, 80) THEN CASE WHEN coalesce(c.rain, 0) > 5 THEN '비' ELSE '비조금' END
            WHEN c.code IN (63, 65, 81, 82, 95, 96, 99) THEN '비'
            WHEN c.code IN (71, 73, 75, 77, 85, 86) THEN CASE WHEN coalesce(c.rain, 0) > 3 THEN '눈' ELSE '눈조금' END
            ELSE '맑음' END,
        'temp', round(c.tmin)::integer || ' ~ ' || round(c.tmax)::integer || '℃'))
    INTO v_out
    FROM jsonb_array_elements_text(v_daily->'time') WITH ORDINALITY t(d, ord)
    CROSS JOIN LATERAL (SELECT
        (v_daily->'weather_code'->>(t.ord::integer - 1))::numeric::integer AS code,
        (v_daily->'temperature_2m_min'->>(t.ord::integer - 1))::numeric AS tmin,
        (v_daily->'temperature_2m_max'->>(t.ord::integer - 1))::numeric AS tmax,
        (v_daily->'precipitation_sum'->>(t.ord::integer - 1))::numeric AS rain) c
    WHERE c.code IS NOT NULL AND c.tmin IS NOT NULL AND c.tmax IS NOT NULL;
    RETURN coalesce(v_out, '{}'::jsonb);
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '운영기록부 날씨 조회 실패: %', SQLERRM;
    RETURN '{}'::jsonb;
END $$;

-- 자동 작성 본체: 빠진 날짜 만들기 + 손대지 않은 자동 작성 기록의 배출구 칸을 업무일지에 다시 맞추기
-- p_to 를 주지 않으면 한국 시각 18시 뒤에는 오늘까지, 그 전에는 어제까지.
CREATE OR REPLACE FUNCTION public.wms_air_auto_fill_run(p_to date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_now timestamp := now() AT TIME ZONE 'Asia/Seoul';
    v_today date := v_now::date;
    v_to date := least(coalesce(p_to, CASE WHEN v_now::time >= time '18:00' THEN v_today ELSE v_today - 1 END), v_today);
    v_from date;
    v_weather jsonb := '{}'::jsonb;
    v_day jsonb;
    v_fields jsonb;
    v_stamp text;
    v_filled text[] := '{}';
    v_updated text[] := '{}';
    v_date date;
    v_rec record;
BEGIN
    SELECT greatest(coalesce(min(record_date), v_to), v_to - 120) INTO v_from FROM public.wms_air_records;

    IF EXISTS (SELECT 1 FROM generate_series(v_from, v_to, interval '1 day') d
               WHERE NOT EXISTS (SELECT 1 FROM public.wms_air_records r WHERE r.record_date = d::date)) THEN
        v_weather := public.wms_air_weather();
    END IF;

    FOR v_date IN
        SELECT d::date FROM generate_series(v_from, v_to, interval '1 day') d
        WHERE NOT EXISTS (SELECT 1 FROM public.wms_air_records r WHERE r.record_date = d::date)
        ORDER BY 1
    LOOP
        v_fields := public.wms_air_exhaust_fields(v_date);
        v_day := coalesce(v_weather->to_char(v_date, 'YYYY-MM-DD'), '{"weather":"맑음","temp":"15 ~ 25℃"}'::jsonb);
        v_stamp := public.wms_air_stamp(v_date);
        INSERT INTO public.wms_air_records (record_date, record_data, status, updated_by_name)
        VALUES (v_date,
            jsonb_build_object(
                'date', to_char(v_date, 'YYYY-MM-DD'),
                'formattedDate', extract(year FROM v_date)::integer || '년 ' || extract(month FROM v_date)::integer || '월 '
                    || extract(day FROM v_date)::integer || '일 ' || (ARRAY['일', '월', '화', '수', '목', '금', '토'])[extract(dow FROM v_date)::integer + 1] || '요일',
                'approval', '{"inCharge":"담당","reviewer":"","manager":"부서장"}'::jsonb,
                'weatherInfo', v_day,
                'workHours', '09:00 ~ 18:00',
                'preventionOperation', '{"exempt":true,"text":"방지시설면제","rows":[]}'::jsonb,
                'preventionMaintenance', '{"exempt":true,"text":"방지시설 면제","rows":[{"facility":"-","exhaustNo":"-","period":"-","worker":"-","details":"특이사항 없음"}]}'::jsonb,
                'selfMeasurement', '{"measureDate":"","weather":"","temp":"","humidity":"","pressure":"","windDir":"","windSpeed":"","rows":[{"exhaustNo":"","facilityName":"","item":"","density":"","dailyFlow":"","dailyEmission":"","device":"","method":""}]}'::jsonb,
                'fuelUsage', '-', 'fuelDay', '', 'rawMaterialUsage', '-', 'etc', '-',
                'technician', '{"position":"부장","name":"윤경용"}'::jsonb,
                'managerSign', v_stamp, 'technicianSign', v_stamp, 'chargeSign', '',
                'autoGenerated', true,
                'updatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            ) || v_fields,
            v_fields->>'status', '자동 작성')
        ON CONFLICT (record_date) DO NOTHING;
        IF FOUND THEN v_filled := v_filled || to_char(v_date, 'YYYY-MM-DD'); END IF;
    END LOOP;

    FOR v_rec IN
        SELECT record_date, record_data FROM public.wms_air_records
        WHERE updated_by_name = '자동 작성' AND record_date BETWEEN v_to - 31 AND v_to
        ORDER BY record_date
    LOOP
        v_fields := public.wms_air_exhaust_fields(v_rec.record_date);
        IF v_rec.record_data->'exhaustList' IS DISTINCT FROM v_fields->'exhaustList' THEN
            UPDATE public.wms_air_records
            SET record_data = record_data || v_fields
                    || jsonb_build_object('updatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
                status = v_fields->>'status',
                updated_at = now()
            WHERE record_date = v_rec.record_date AND updated_by_name = '자동 작성';
            v_updated := v_updated || to_char(v_rec.record_date, 'YYYY-MM-DD');
        END IF;
    END LOOP;

    RETURN jsonb_build_object('filled', to_jsonb(v_filled), 'updated', to_jsonb(v_updated));
END $$;

-- 화면에서 부르는 함수 (매니저 이상)
CREATE OR REPLACE FUNCTION public.wms_air_auto_fill() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.wms_has_role('MANAGER') THEN
        RAISE EXCEPTION '운영기록부 자동 작성은 매니저 이상만 할 수 있습니다.' USING ERRCODE = '42501';
    END IF;
    RETURN public.wms_air_auto_fill_run(NULL);
END $$;

REVOKE ALL ON FUNCTION public.wms_air_running_exhausts(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wms_air_exhaust_fields(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wms_air_weather() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wms_air_auto_fill_run(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wms_air_auto_fill() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_air_auto_fill() TO authenticated;

-- 매일 18:00 (한국 시각) = 09:00 UTC. 같은 이름으로 다시 걸면 고쳐진다.
SELECT cron.schedule('wms-air-daily-18', '0 9 * * *', $cron$SELECT public.wms_air_auto_fill_run();$cron$);
