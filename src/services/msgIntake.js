// ==========================================
// 메시지 접수: '[제품 생산 요청]' 같은 양식 메시지 → 해당 등록 화면(요청서·전표)으로 이동해 내용 채우기
// ==========================================
// 들어오는 길
//   1) 앱 채팅(1:1·전체)으로 받은 양식 메시지 → 알림 카드 [등록하기] (FloatingTools)
//   2) 구글 챗에서 WMS 앱을 @멘션한 메시지 (wms_chat_inbox, realtime) → 알림 카드
//   3) 휴대폰 공유(카톡·문자 → 공유 → 대림WMS, manifest share_target) · 메시지 접수 창에 붙여넣기 → 바로 이동
// 양식 보내기: 메시지 접수 창의 '양식으로 보내기'가 같은 형식(composeIntake)으로 앱 채팅 메시지를 보낸다.
// 같은 메시지로 두 번 등록하지 않도록 요청서에는 sourceKey(채팅 id·받은함 id·원문 해시)를 남기고, 열기 전에 찾는다.
import { state } from './db.js';
import { matchItem } from './docOcr.js';
import { parseDateIn } from './chatSchedule.js';
import { orgInfoOf } from './org.js';
import { localDateStr } from './searchUtils.js';

export const INTAKE_KINDS = {
    RAW: { label: '원액 생산 요청', re: /원액\s*(생산\s*)?요청/, tab: 'prodRequest', reqType: 'RAW', icon: 'flask-conical', target: '원액생산요청서',
        fields: [['items', '원액명 및 수량'], ['site', '생산 거점'], ['to', '이동처'], ['due', '납기 요청일'], ['note', '비고']] },
    PROD: { label: '제품 생산 요청', re: /(제품\s*)?생산\s*요청/, tab: 'prodRequest', reqType: 'PRODUCT', icon: 'package', target: '제품생산요청서',
        fields: [['partner', '업체명'], ['items', '제품명 및 수량'], ['due', '납기 요청일'], ['dest', '도착지'], ['method', '납품방법'], ['note', '비고']] },
    PURCH: { label: '구매 요청', re: /구매\s*요청|발주\s*요청/, tab: 'purchRequest', reqType: 'PURCH', icon: 'shopping-bag', target: '구매요청서',
        fields: [['items', '품목 및 수량'], ['due', '필요일'], ['site', '입고 거점'], ['purpose', '용도'], ['note', '비고']] },
    SHIP: { label: '출하 요청', re: /출하\s*요청|출고\s*요청|납품\s*요청/, tab: 'slipIssue', slipType: 'RELEASE', icon: 'truck', target: '출고요청서(전표)',
        fields: [['partner', '업체명'], ['items', '제품명 및 수량'], ['due', '출하일'], ['from', '출고지'], ['dest', '도착지'], ['method', '납품방법'], ['note', '비고']] },
    MOVE: { label: '이동 요청', re: /이동\s*요청/, tab: 'slipIssue', slipType: 'TRANSFER', icon: 'arrow-left-right', target: '이동전표',
        fields: [['items', '품목 및 수량'], ['due', '이동일'], ['from', '출발지'], ['to', '도착지'], ['method', '운송방법'], ['note', '비고']] }
};
const KIND_ORDER = ['RAW', 'PROD', 'PURCH', 'SHIP', 'MOVE'];

// 항목 이름 → 표준 키 (띄어쓰기 무시)
const KEY_RULES = [
    ['items', /^(제품명및수량|품목및수량|원액명및수량|제품명|품목명?|품명|원액명|제품|수량)$/],
    ['partner', /^(업체명?|거래처|고객사?|납품처|받는곳)$/],
    ['due', /^(납기요청일|납기일?|필요일|입고희망일|출하일|출고일|이동일|요청일자|희망일)$/],
    ['planDate', /^(생산예정일)$/],
    ['dest', /^(도착지|납품장소|배송지|납품주소)$/],
    ['to', /^(이동처|도착거점|받는거점)$/],
    ['from', /^(출발지|출고지|보내는곳|출고거점)$/],
    ['method', /^(납품방법|운송방법|배송방법|운송)$/],
    ['site', /^(생산거점|입고거점|거점)$/],
    ['purpose', /^(용도|사유|요청사유)$/],
    ['note', /^(비고|메모|요청사항|전달사항)$/],
    ['requester', /^(담당|담당자|요청자|작성자|요청)$/]
];
const keyOf = (label) => { const k = String(label).replace(/\s+/g, ''); return (KEY_RULES.find(([, re]) => re.test(k)) || [null])[0]; };

const UNIT_MAP = { 파렛트: 'PLT', 팔레트: 'PLT', 파레트: 'PLT', plt: 'PLT', 박스: 'BOX', bx: 'BOX', box: 'BOX', 개: 'EA', ea: 'EA', 리터: 'L', l: 'L', kg: 'KG', 드럼: 'DRUM', dr: 'DRUM', drum: 'DRUM', 페일: 'PAIL', pail: 'PAIL', 통: '통', 캔: 'CAN', can: 'CAN', 병: '병', 톤: 'TON', t: 'TON', tote: 'TOTE', ibc: 'IBC', set: 'SET', 세트: 'SET' };
const QTY_RE = /(\d[\d,]*(?:\.\d+)?)\s*(파렛트|팔레트|파레트|plt|박스|box|bx|ea|개|리터|kg|드럼|drum|dr|페일|pail|통|캔|can|병|톤|tote|ibc|set|세트|l|t)(?![a-z가-힣])/gi;

// '1. GT 엔진오일 0W20 2PLT' → { code, name, spec, qty, unit, raw, how }
export const parseItemLine = (line) => {
    const raw = String(line).replace(/^\s*(\d+\s*[.)]|[-•*·▶►]|\(\d+\))\s*/, '').trim();
    if (!raw) return null;
    const hits = [...raw.matchAll(QTY_RE)];
    const q = hits[hits.length - 1];
    const qty = q ? q[1].replace(/,/g, '') : '';
    const unit = q ? (UNIT_MAP[q[2].toLowerCase()] || UNIT_MAP[q[2]] || q[2].toUpperCase()) : '';
    const name = (q ? raw.slice(0, q.index) + raw.slice(q.index + q[0].length) : raw).replace(/[,\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
    const hit = name ? matchItem(name) : null;
    const m = hit?.item;
    return { code: m?.code || '', name: m?.name || name, spec: m?.spec || '', qty, unit: unit || m?.unit || '', raw, msgName: name, how: m ? hit.how : '' };
};

// 원문 → 짧은 지문 (같은 원문 다시 붙여넣기 판별)
export const textKey = (text) => {
    let h = 0;
    const s = String(text || '').replace(/\s+/g, '');
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return `TXT:${(h >>> 0).toString(36)}`;
};

/**
 * 메시지 → 접수 내용. 양식이 아니면 null.
 * @param loose true면 머리글([…])이 없어도 항목(키: 값)과 요청 낱말로 판단 (붙여넣기)
 */
export const parseIntake = (text, { loose = false } = {}) => {
    const src = String(text || '').replace(/^(?:@\S+\s*)+/, '').trim();
    if (!src) return null;
    const lines = src.split(/\r?\n/);
    const firstIdx = lines.findIndex(l => l.trim());
    const head = lines[firstIdx]?.trim() || '';
    const hm = head.match(/^[[【〔(]\s*([^\]】〕)]{2,30})\s*[\]】〕)]/);
    let kind = null;
    if (hm) kind = KIND_ORDER.find(k => INTAKE_KINDS[k].re.test(hm[1])) || null;
    if (!kind && loose) kind = KIND_ORDER.find(k => INTAKE_KINDS[k].re.test(src.slice(0, 80))) || null;
    if (!kind) return null;
    const f = { items: [], extra: [] };
    let cur = null;
    lines.slice(hm ? firstIdx + 1 : 0).forEach(line0 => {
        const line = line0.replace(/^\s*[■□▪◆◇●○▶►•*]\s*/, '').trimEnd();
        if (!line.trim()) return;
        const kv = line.match(/^\s*([^:：\d][^:：]{0,14})\s*[:：]\s*(.*)$/);
        const k = kv ? keyOf(kv[1]) : null;
        if (kv && k) {
            cur = k;
            const v = kv[2].trim();
            if (k === 'items') { if (v) v.split(/\s*,\s*(?=\D)/).forEach(x => { const it = parseItemLine(x); if (it) f.items.push(it); }); }
            else f[k] = v;
            return;
        }
        if (cur === 'items' && /^\s*(\d+\s*[.)]|[-•*·]|\(\d+\))?\s*\S/.test(line)) { const it = parseItemLine(line); if (it) f.items.push(it); return; }
        if (kv) { f.extra.push(`${kv[1].trim()}: ${kv[2].trim()}`); cur = null; return; }
        if (cur && cur !== 'items') { f[cur] = `${f[cur] ? `${f[cur]} ` : ''}${line.trim()}`; return; }
        f.extra.push(line.trim());
    });
    // 이동 요청의 '도착지'는 거점
    if (kind === 'MOVE' && f.dest && !f.to) { f.to = f.dest; delete f.dest; }
    if (kind === 'RAW' && f.dest && !f.to) f.to = f.dest;
    const dueDate = parseDateIn(f.due || '');
    const planDate = parseDateIn(f.planDate || '');
    return { kind, def: INTAKE_KINDS[kind], text: src, fields: f, dueDate, planDate };
};

// ---------- 양식 보내기 ----------
/** 표준 양식 글 (메시지 원문 형식 그대로) */
export const composeIntake = (kind, v = {}) => {
    const d = INTAKE_KINDS[kind];
    const out = [`[${d.label}]`, ''];
    d.fields.forEach(([k, label]) => {
        if (k === 'items') {
            out.push(`■ ${label}:`);
            (v.items || []).filter(it => it.name).forEach((it, i) => out.push(`  ${i + 1}. ${it.name}${it.qty ? ` ${it.qty}${it.unit || ''}` : ''}`));
        } else out.push(`■ ${label}: ${v[k] || ''}`);
    });
    out.push('', `담당: ${v.requester || state.currentUser?.name || ''}`);
    return out.join('\n');
};

// ---------- 등록 화면용 초안 ----------
const siteOfText = (s) => {
    const t = String(s || '');
    if (/김포/.test(t)) return '김포';
    if (/본사|도창/.test(t)) return '본사';
    return '';
};
const extraText = (p) => {
    const f = p.fields;
    return [
        f.due && !p.dueDate ? `납기 요청: ${f.due}` : '',
        f.dest ? `도착지: ${f.dest}` : '',
        f.method ? `${p.kind === 'MOVE' ? '운송' : '납품'}방법: ${f.method}` : '',
        f.purpose ? `용도: ${f.purpose}` : '',
        f.note ? `비고: ${f.note}` : '',
        ...f.extra
    ].filter(Boolean).join(' · ');
};

/** 요청서(생산·원액·구매) 초안: ProductionRequest.js가 window.__reqDraft로 받는다 */
export const requestDraftOf = (p, sourceKey = '') => {
    const f = p.fields;
    const d = p.def;
    const who = f.requester || '';
    return {
        reqType: d.reqType,
        partner: d.reqType === 'PURCH' ? (f.purpose || '') : (f.partner || ''),
        dueDate: p.dueDate || '', planDate: p.planDate || '',
        site: siteOfText(f.site) || '',
        moveTo: d.reqType === 'RAW' ? (f.to || '') : '',
        requester: who, dept: orgInfoOf(who)?.dept || '',
        reason: extraText(p),
        lines: f.items.map(it => ({ code: it.code, name: it.name, spec: it.spec, qty: it.qty, unit: it.unit, pack: '', supplier: '', price: '', note: it.code && it.msgName && it.msgName !== it.name ? `메시지: ${it.msgName}` : '' })),
        sourceKey: sourceKey || textKey(p.text), sourceText: p.text.slice(0, 2000)
    };
};

/** 전표(출고요청서·이동전표) 초안: SlipIssuer.js가 window.__slipDraft로 받는다 */
export const slipDraftOf = (p) => {
    const f = p.fields;
    const d = p.def;
    return {
        type: d.slipType, date: p.dueDate || localDateStr(),
        fromLoc: f.from || '', toLoc: d.slipType === 'RELEASE' ? '외부 거래처' : (f.to || ''),
        partner: f.partner || (d.slipType === 'RELEASE' ? f.dest || '' : ''),
        transport: f.method || '',
        reason: [`${d.label} 메시지${f.requester ? ` (${f.requester})` : ''}`, extraText(p)].filter(Boolean).join(' · ').slice(0, 300),
        items: f.items.map(it => ({ code: it.code, name: it.name, spec: it.spec, qty: Number(it.qty) || 0, unit: it.unit || 'EA', note: it.code && it.msgName !== it.name ? `메시지: ${it.msgName}` : '' }))
    };
};

/**
 * 접수 내용을 등록 화면으로 보낸다.
 * @param source { kind: 'chat'|'gchat'|'share'|'paste', id } — 받은함이면 요청서 등록 뒤 받은함을 '처리됨'으로
 */
export const openIntake = (p, source = {}) => {
    const d = p.def;
    const sourceKey = source.kind === 'chat' ? `CHAT:${source.id}` : source.kind === 'gchat' ? `GCHAT:${source.id}` : textKey(p.text);
    if (d.slipType) window.__slipDraft = { ...slipDraftOf(p), sourceKey, source };
    else window.__reqDraft = { type: d.reqType, draft: requestDraftOf(p, sourceKey), source };
    markHandledLocal(sourceKey);
    if (window.__activeTab === d.tab) window.__rerenderActiveTab?.();
    else window.__switchTab?.(d.tab);
};

// 이 기기에서 이미 등록 화면으로 보낸 메시지 (알림 카드를 다시 띄우지 않음)
const HANDLED_KEY = 'daelim_intake_handled';
export const isHandledLocal = (key) => { try { return !!JSON.parse(localStorage.getItem(HANDLED_KEY) || '{}')[key]; } catch { return false; } };
export const markHandledLocal = (key) => {
    try {
        const m = JSON.parse(localStorage.getItem(HANDLED_KEY) || '{}');
        m[key] = Date.now();
        const keys = Object.keys(m);
        if (keys.length > 300) keys.sort((a, b) => m[a] - m[b]).slice(0, keys.length - 300).forEach(k => delete m[k]);
        localStorage.setItem(HANDLED_KEY, JSON.stringify(m));
    } catch { /* 저장 불가 */ }
};

/** 알림·목록에 쓸 한 줄 요약 */
export const intakeSummary = (p) => {
    const f = p.fields;
    const items = f.items.map(it => `${it.name}${it.qty ? ` ${it.qty}${it.unit}` : ''}`);
    return [f.partner || f.to || '', items.slice(0, 2).join(', ') + (items.length > 2 ? ` 외 ${items.length - 2}` : ''), f.due ? `납기 ${f.due}` : ''].filter(Boolean).join(' · ');
};
