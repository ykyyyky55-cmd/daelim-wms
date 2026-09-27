// 현장 QR (위치·전표·원료 탱크/드럼·사원증·LOT) 내용 형식
// 스마트폰 기본 카메라로 찍어도 앱의 현장 스캔 화면이 열리도록 `앱주소?q=종류:값#scan` 링크로 만든다.
// 앱 안의 스캐너는 링크든 `종류:값` 글자든 parseFieldQr로 같은 결과를 얻는다.
//   LOC:김포공장 / 2동      위치(거점 또는 '거점 / 건물')
//   SLIP:RQ-20260927-001    출고요청서·이동전표 (출하 검수)
//   RAW:품목코드@김포       원료 탱크·드럼 (코드가 없는 원료는 원료명). 지역은 원료수불부 지역
//   WKR:작업자 id           사원증 (현재 작업자 전환. 로그인 권한은 바뀌지 않음)
//   LOT:LOT번호             LOT 추적
export const FIELD_QR_TYPES = {
    LOC: '위치',
    SLIP: '전표',
    RAW: '원료 탱크·드럼',
    WKR: '사원증',
    LOT: 'LOT'
};

// QR에 넣을 앱 주소 (개발 PC에서 인쇄해도 실제 배포 주소로)
export const liveAppUrl = () => (window.location.href.includes('localhost')
    ? 'https://ykyyyky55-cmd.github.io/daelim-wms/'
    : window.location.href.split('#')[0].split('?')[0]);

export const fieldQrText = (type, value) => `${type}:${value}`;
export const fieldQrUrl = (type, value) => `${liveAppUrl()}?q=${encodeURIComponent(fieldQrText(type, value))}#scan`;

// 원료 탱크·드럼 값: 품목코드(없으면 원료명)@지역
export const rawQrValue = (codeOrName, region) => `${codeOrName}@${region}`;
export const splitRawQrValue = (value) => {
    const i = String(value).lastIndexOf('@');
    return i < 0 ? { key: String(value), region: '' } : { key: value.slice(0, i), region: value.slice(i + 1) };
};

// 품목 QR·바코드 글자 → 품목코드 (링크의 scan/code 값, '코드: …' 글자, {code} JSON, 'A|B' 앞부분 순)
export const itemCodeOfScan = (text) => {
    let s = String(text || '').trim();
    if (/^https?:\/\//i.test(s)) {
        try {
            const u = new URL(s);
            const h = u.hash.includes('?') ? new URLSearchParams(u.hash.split('?')[1]) : null;
            s = u.searchParams.get('scan') || u.searchParams.get('code') || h?.get('scan') || h?.get('code') || '';
        } catch { return ''; }
    }
    const tag = s.match(/코드:\s*([^\n\r]+)/);
    if (tag) return tag[1].trim();
    try { const j = JSON.parse(s); if (j && j.code) return String(j.code).trim(); } catch { }
    return s.split('|')[0].trim();
};

// 스캔한 글자 → { type, value } (현장 QR이 아니면 null)
export const parseFieldQr = (text) => {
    let s = String(text || '').trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) {
        try {
            const url = new URL(s);
            const hashQuery = url.hash.includes('?') ? new URLSearchParams(url.hash.split('?')[1]) : null;
            const q = url.searchParams.get('q') || hashQuery?.get('q');
            if (!q) return null;
            s = q.trim();
        } catch {
            return null;
        }
    }
    const m = s.match(/^(LOC|SLIP|RAW|WKR|LOT):(.+)$/s);
    if (!m) return null;
    const value = m[2].trim();
    return value ? { type: m[1], value } : null;
};
