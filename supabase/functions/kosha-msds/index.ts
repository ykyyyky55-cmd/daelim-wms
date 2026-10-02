// 안전보건공단 MSDS 조회 API(공공데이터포털 apis.data.go.kr/B552468/msdschem1)를 대신 불러 준다.
// 앱 services/ghs/chemSubstances.js가 CAS 번호로 물질 정보를 받을 때 부른다 (혼합물 MSDS 작성).
// 보안
//  - Supabase JWT 검사를 켠다(verify_jwt=true): 로그인한 사용자만 부를 수 있다.
//  - 부른 사람이 마스터·작업일지 관리자(wms_has_worklog_access)인지 그 사람의 토큰으로 다시 확인한다.
//  - 인증키는 비밀 표 wms_notify_secret(id 'KOSHA_API_KEY', 사용자 정책 없음)에만 있고, 이 함수가 서비스 키로 읽는다. 앱에는 키를 돌려주지 않는다.
//  - 부르는 곳은 apis.data.go.kr의 MSDS 조회 서비스뿐이고, 받은 내용은 항목 줄 목록으로만 돌려준다(해석은 앱이 한다).
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BASE = 'https://apis.data.go.kr/B552468/msdschem1';
// MSDS 16개 항목 중 받는 항목: 2 유해성·위험성, 3 구성성분(이명), 8 노출기준, 9 물리화학적 특성, 11 독성, 12 환경, 14 운송, 15 규제
const SECTIONS = ['02', '03', '08', '09', '11', '12', '14', '15'];
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Item = Record<string, string>;
const unescapeXml = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** 응답(XML 또는 JSON)에서 item 줄 목록을 꺼낸다 */
const itemsOf = (text: string): Item[] => {
    const t = text.trim();
    if (t.startsWith('{')) {
        try {
            const body = JSON.parse(t)?.response?.body ?? JSON.parse(t)?.body ?? {};
            const item = body?.items?.item ?? body?.items ?? [];
            return (Array.isArray(item) ? item : [item]).filter(Boolean).map((o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v ?? '')])));
        } catch { return []; }
    }
    return [...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
        const o: Item = {};
        for (const f of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) o[f[1]] = unescapeXml(f[2]);
        return o;
    });
};

/** 게이트웨이가 코드 없이 이름으로만 알려 주는 오류 → 오류 코드 */
const NAMED_ERRORS: Record<string, string> = {
    SERVICE_KEY_IS_NOT_REGISTERED_ERROR: '30', DEADLINE_HAS_EXPIRED_ERROR: '31', UNREGISTERED_IP_ERROR: '32',
    SERVICE_ACCESS_DENIED_ERROR: '20', TEMPORARILY_DISABLE_THE_SERVICEKEY_ERROR: '21', LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR: '22',
    NO_OPENAPI_SERVICE_ERROR: '12'
};
const NO_DATA_CODE = '03'; // NODATA_ERROR: 찾는 자료가 없음 — 오류가 아니라 빈 목록이다

/** 공공데이터포털 게이트웨이·공단 서버의 오류 응답 → { code, message } (정상·자료 없음이면 null) */
const errorOf = (status: number, text: string): { code: string; message: string } | null => {
    const reason = /<returnReasonCode>(\d+)<\/returnReasonCode>/.exec(text)?.[1] ?? '';
    const auth = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text)?.[1] ?? '';
    const result = /<resultCode>(\w+)<\/resultCode>/.exec(text)?.[1] ?? /"resultCode"\s*:\s*"?(\w+)"?/.exec(text)?.[1] ?? '';
    const named = Object.keys(NAMED_ERRORS).find(name => text.includes(name));
    let code = reason || (result && result !== '00' && result !== '0' ? result : '') || (named ? NAMED_ERRORS[named] : '');
    if (code === NO_DATA_CODE) return null;
    if (!code && status >= 200 && status < 300) return null;
    if (!code && (status === 401 || status === 403)) code = '30'; // 코드 없이 인증 실패로만 답하는 경우
    const known: Record<string, [string, string]> = {
        '30': ['KEY_REJECTED', '등록되지 않은 인증키입니다. 공공데이터포털에서 "물질안전보건자료 조회 서비스" 활용신청을 했는지, 키를 정확히 붙여 넣었는지 확인하세요 (승인 직후에는 1~2시간 걸릴 수 있습니다).'],
        '31': ['KEY_REJECTED', '인증키의 활용 기간이 끝났습니다. 공공데이터포털에서 연장하세요.'],
        '20': ['KEY_REJECTED', '서비스 접근이 거부되었습니다. 활용신청이 승인됐는지 확인하세요 (승인 직후에는 1~2시간 걸릴 수 있습니다).'],
        '21': ['KEY_REJECTED', '인증키가 일시 정지되어 있습니다. 공공데이터포털의 활용 정보에서 상태를 확인하세요.'],
        '12': ['KEY_REJECTED', '이 인증키로는 MSDS 조회 서비스를 쓸 수 없습니다. 공공데이터포털에서 활용신청을 하세요.'],
        '22': ['LIMIT', '오늘 쓸 수 있는 조회 횟수를 넘었습니다. 내일 다시 하거나 공공데이터포털에서 트래픽을 늘리세요.'],
        '32': ['KEY_REJECTED', '등록되지 않은 IP입니다. 공공데이터포털의 활용 정보에서 IP 제한을 풀어 주세요.']
    };
    const hit = known[code];
    return hit ? { code: hit[0], message: hit[1] } : { code: 'UPSTREAM', message: `안전보건공단 조회 서비스가 응답하지 않았습니다 (${status}${code ? ` · 코드 ${code}` : ''}${auth ? ` · ${auth}` : ''}).` };
};

const call = async (op: string, params: Record<string, string>, key: string) => {
    // 공공데이터포털 키는 인코딩된 것(%2B 등)과 아닌 것 두 가지로 준다 — 인코딩된 키는 그대로, 아니면 인코딩해서 붙인다
    const serviceKey = /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
    const res = await fetch(`${BASE}/${op}?serviceKey=${serviceKey}&${new URLSearchParams(params).toString()}`, { headers: { Accept: 'application/xml' } });
    return { status: res.status, text: await res.text() };
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ ok: false, error: 'POST만 받습니다.' }, 405);
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth) return json({ ok: false, error: '로그인이 필요합니다.' }, 401);
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    const { data: allowed, error: roleErr } = await user.rpc('wms_has_worklog_access');
    if (roleErr || !allowed) return json({ ok: false, code: 'FORBIDDEN', error: '혼합물 MSDS 작성 권한이 없습니다 (마스터·작업일지 관리자).' }, 403);

    let body: { action?: string; cas?: string } = {};
    try { body = await req.json(); } catch { /* 빈 요청 */ }
    const admin = createClient(URL_, SERVICE);
    const { data: secret } = await admin.from('wms_notify_secret').select('value').eq('id', 'KOSHA_API_KEY').maybeSingle();
    const key = String(secret?.value ?? '').trim();

    try {
        if (body.action === 'status') {
            // 키 없이 불러 게이트웨이까지 닿는지만 본다 (닿으면 '키 없음' 오류가 온다)
            const probe = key ? await call('getChemList001', { searchWrd: '7732-18-5', searchCnd: '1', numOfRows: '1', pageNo: '1' }, key)
                : await fetch(`${BASE}/getChemList001?searchWrd=7732-18-5&searchCnd=1&numOfRows=1&pageNo=1`).then(async r => ({ status: r.status, text: await r.text() }));
            const err = key ? errorOf(probe.status, probe.text) : null;
            return json({ ok: true, keySet: !!key, reachable: probe.status > 0, keyOk: key ? !err : false, message: err?.message ?? '' });
        }
        if (body.action !== 'lookup') return json({ ok: false, error: '알 수 없는 요청입니다.' }, 400);
        if (!key) return json({ ok: false, code: 'NO_KEY', error: '안전보건공단 MSDS 조회 인증키가 설정되지 않았습니다.' });
        const cas = String(body.cas ?? '').replace(/[^\d-]/g, '');
        if (!/^\d{2,7}-\d{2}-\d$/.test(cas)) return json({ ok: false, error: 'CAS 번호 모양이 올바르지 않습니다.' }, 400);

        const list = await call('getChemList001', { searchWrd: cas, searchCnd: '1', numOfRows: '20', pageNo: '1' }, key);
        const listErr = errorOf(list.status, list.text);
        if (listErr) return json({ ok: false, code: listErr.code, error: listErr.message });
        const rows = itemsOf(list.text);
        const chem = rows.find(r => String(r.casNo ?? '').trim() === cas);
        if (!chem) return json({ ok: true, found: false });

        const chemId = String(chem.chemId ?? '');
        const parts = await Promise.all(SECTIONS.map(async (no) => {
            const r = await call(`getChemDetail${no}1`, { chemId }, key);
            const err = errorOf(r.status, r.text);
            if (err) throw new Error(err.message);
            return [no, itemsOf(r.text).map(it => ({ msdsItemCode: it.msdsItemCode ?? '', msdsItemNameKor: it.msdsItemNameKor ?? '', itemDetail: it.itemDetail ?? '' }))] as const;
        }));
        return json({ ok: true, found: true, chem, detail: Object.fromEntries(parts) });
    } catch (e) {
        console.warn('[kosha-msds]', (e as Error).message);
        return json({ ok: false, code: 'UPSTREAM', error: (e as Error).message || '안전보건공단 조회 서비스를 부르지 못했습니다.' });
    }
});
