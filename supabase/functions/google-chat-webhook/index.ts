// 구글 챗 앱 → WMS 일정 받은함 (wms_chat_inbox)
// 스페이스에서 이 앱을 @멘션한 메시지(또는 앱과의 1:1 대화)를 받아 원문 그대로 받은함에 쌓는다.
// 분석·일정 등록은 WMS 앱(수불·입출고 캘린더)에서 사람이 확인한 뒤에 한다.
//
// 보안
//  - Supabase JWT 검사는 끄고(verify_jwt=false) 구글이 보낸 토큰을 직접 검사한다.
//    챗 앱 설정의 '인증 대상(Authentication audience)'을 'HTTP 엔드포인트 URL'로 두면 구글 OIDC ID 토큰(aud=이 함수 URL,
//    email=chat@system.gserviceaccount.com), '프로젝트 번호'로 두면 chat@system.gserviceaccount.com 서명 토큰(aud=프로젝트 번호,
//    Supabase 비밀 GOOGLE_CHAT_PROJECT_NUMBER 필요)이다. 둘 다 아니면 401.
//    '워크스페이스 부가기능으로 빌드'한 챗 앱은 aud=이 함수 URL, email=service-<프로젝트번호>@gcp-sa-gsuiteaddons 토큰을 보낸다.
//  - 보낸 사람이 회사 도메인(@daelimoil.co.kr)이 아니면 받지 않는다.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';

const ENDPOINT_URL = 'https://hapvzqyfikctcbxurxal.supabase.co/functions/v1/google-chat-webhook';
const ALLOWED_DOMAIN = '@daelimoil.co.kr';
const PROJECT_NUMBER = Deno.env.get('GOOGLE_CHAT_PROJECT_NUMBER') ?? '';
// ID 토큰을 보낼 수 있는 구글 계정: 일반 챗 앱 / 워크스페이스 부가기능형 챗 앱(구글 클라우드 프로젝트 번호 946997534741 전용)
const TRUSTED_TOKEN_EMAILS = [
    'chat@system.gserviceaccount.com',
    'service-946997534741@gcp-sa-gsuiteaddons.iam.gserviceaccount.com'
];

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const chatJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com'));

const isFromGoogleChat = async (req: Request): Promise<boolean> => {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return false;
    try {
        const { payload } = await jwtVerify(token, googleJwks, {
            issuer: ['https://accounts.google.com', 'accounts.google.com'],
            audience: ENDPOINT_URL
        });
        if (TRUSTED_TOKEN_EMAILS.includes(String(payload.email)) && payload.email_verified !== false) return true;
    } catch { /* 다른 방식 시도 */ }
    if (PROJECT_NUMBER) {
        try {
            await jwtVerify(token, chatJwks, { issuer: 'chat@system.gserviceaccount.com', audience: PROJECT_NUMBER });
            return true;
        } catch { /* 거부 */ }
    }
    // 진단용: 거부한 토큰의 발급자·대상·이메일만 남긴다 (서명·본문은 남기지 않음)
    try {
        const [, body] = token.split('.');
        const claims = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
        console.warn('[google-chat-webhook] 토큰 거부', JSON.stringify({ iss: claims.iss, aud: claims.aud, email: claims.email, sub: claims.sub }));
    } catch { console.warn('[google-chat-webhook] 토큰 거부 (해석 불가)'); }
    return false;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const HELP = [
    '안녕하세요, 대림 WMS 일정 받은함입니다. 📥',
    '생산·출하 일정을 저를 @멘션해서 보내 주세요. 예)',
    '  @대림WMS 9/30 ODM 5W30 4L 200박스 출하 카밈',
    '  @대림WMS 10/2 원액 블렌딩 ODM 5W30 PAO 5드럼',
    '받은 내용은 WMS → 수불·입출고 캘린더의 "구글 챗 일정" 목록에서 확인 후 등록됩니다.'
].join('\n');

Deno.serve(async (req) => {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    if (!(await isFromGoogleChat(req))) return json({ error: 'unauthorized' }, 401);

    let ev: any;
    try { ev = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

    // 두 가지 이벤트 형식 지원: 예전 챗 앱(ev.type/ev.message) · 워크스페이스 부가기능형 챗 앱(ev.chat.*Payload)
    const addon = !!ev.chat;
    const reply = (text: string) => json(addon
        ? { hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text } } } } }
        : { text });

    const type = ev.type ?? (ev.chat?.messagePayload ? 'MESSAGE' : ev.chat?.addedToSpacePayload ? 'ADDED_TO_SPACE' : '');
    if (type === 'ADDED_TO_SPACE') return reply(HELP);
    if (type !== 'MESSAGE') {
        console.log('[google-chat-webhook] 처리하지 않는 이벤트', JSON.stringify({ type, keys: Object.keys(ev), chatKeys: Object.keys(ev.chat ?? {}) }));
        return json({});
    }

    const message = ev.message ?? ev.chat?.messagePayload?.message;
    const space = ev.space ?? ev.chat?.messagePayload?.space ?? message?.space;
    const sender = message?.sender ?? ev.user ?? ev.chat?.user;
    const text = String(message?.argumentText ?? message?.text ?? '').trim();
    const email = String(sender?.email ?? '').toLowerCase();

    if (!email.endsWith(ALLOWED_DOMAIN)) return reply('회사 계정(@daelimoil.co.kr)에서 보낸 메시지만 받습니다.');
    if (!text || /^(도움말|help|\?)$/i.test(text)) return reply(HELP);

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { error } = await sb.from('wms_chat_inbox').upsert({
        id: String(message?.name ?? `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`),
        space_name: space?.name ?? null,
        space_title: space?.displayName ?? null,
        sender_name: sender?.displayName ?? null,
        sender_email: email,
        text: text.slice(0, 4000),
        sent_at: message?.createTime ?? null
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
        console.error('[google-chat-webhook] 저장 실패', error.message);
        return reply('⚠️ WMS에 저장하지 못했습니다. 잠시 후 다시 보내 주세요.');
    }
    return reply('📥 WMS 일정 받은함에 넣었습니다. 수불·입출고 캘린더에서 확인 후 등록해 주세요.');
});
