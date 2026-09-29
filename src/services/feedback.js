// ==========================================
// 의견·개선 요청 접수함 (지원 → 의견·개선 요청, 탭 feedback, supabase/auth/62_feedback.sql)
// ==========================================
// - 어느 화면에서든 떠 있는 [💡 의견] 버튼(FloatingTools) → components/FeedbackDialog.js 가 화면을 캡처해 접수
// - 클라우드: 표 wms_feedback + 버킷 wms-files 의 feedback/<id>/… (등록번호·작성자는 DB 트리거가 채움)
// - 로컬 모드: localStorage(daelim_feedback), 첨부는 dataURL(2MB 이하)
// - 처리(상태·답변·우선순위·배포 버전)는 매니저 이상. 상태가 바뀌면 처리자 앱이 요청자에게 1:1 메시지를 보낸다.
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';
import { storageSafeName } from './storageKey.js';
import { fileUrls } from './fileStore.js';
import { APP_VERSION } from './appVersion.js';
import { sendMessage, dmRoom, myChatId } from './chat.js';

const BUCKET = 'wms-files';
const TABLE = 'wms_feedback';
const LOCAL_KEY = 'daelim_feedback';
const MAX_CLOUD = 20 * 1024 * 1024;
const MAX_LOCAL = 2 * 1024 * 1024;

export const FEEDBACK_KINDS = {
    BUG: { label: '오류 신고', icon: 'bug', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
    IMPROVE: { label: '개선 요청', icon: 'wrench', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
    NEW: { label: '새 기능', icon: 'sparkles', cls: 'bg-violet-100 text-violet-700 border-violet-200' },
    QUESTION: { label: '질문', icon: 'circle-help', cls: 'bg-slate-100 text-slate-700 border-slate-200' }
};
export const FEEDBACK_STATUS = {
    NEW: { label: '접수', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
    ACCEPTED: { label: '검토', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
    WORK: { label: '개발 중', cls: 'bg-blue-600 text-white border-blue-600' },
    DONE: { label: '반영 완료', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    DEPLOYED: { label: '배포 완료', cls: 'bg-emerald-600 text-white border-emerald-600' },
    HOLD: { label: '보류', cls: 'bg-slate-200 text-slate-700 border-slate-300' },
    REJECTED: { label: '반려', cls: 'bg-slate-100 text-slate-500 border-slate-300' }
};
export const FEEDBACK_PRIORITY = { HIGH: '높음', NORMAL: '보통', LOW: '낮음' };
/** 아직 끝나지 않은 상태 */
export const isOpenFeedback = (f) => ['NEW', 'ACCEPTED', 'WORK'].includes(f.status);

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const writeLocal = (v) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch { throw new Error('이 기기의 저장 공간이 부족합니다 (로컬 모드는 첨부를 브라우저에 저장합니다).'); } };
const myName = () => state.currentUser?.name || state.currentGlobalWorker || '';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const readDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    r.readAsDataURL(blob);
});

/** 지금 앱 버전 (커밋 7자리) */
export const currentVersion = () => String(APP_VERSION.commit || 'dev').slice(0, 7);
/** 기기 정보 한 줄 (문제 재현용) */
export const deviceInfo = () => {
    const ua = navigator.userAgent;
    const os = /Android/i.test(ua) ? '안드로이드' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? '윈도우' : /Mac/i.test(ua) ? '맥' : '기타';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '브라우저';
    const app = window.matchMedia?.('(display-mode: standalone)').matches ? '설치 앱' : '웹';
    return `${os} · ${br} · ${app} · ${window.innerWidth}×${window.innerHeight}`;
};

const fromRow = (r) => ({
    id: r.id, regNo: r.reg_no || '', kind: r.kind, title: r.title || '', body: r.body || '', tab: r.tab || '', tabLabel: r.tab_label || '',
    appVersion: r.app_version || '', device: r.device || '', files: r.files || [], status: r.status || 'NEW', priority: r.priority || 'NORMAL',
    reply: r.reply || '', handler: r.handler_name || '', deployedVersion: r.deployed_version || '', history: r.history || [],
    createdBy: r.created_by || '', by: r.created_by_name || '', at: r.created_at, updatedAt: r.updated_at
});

/** 의견 목록 (최근 접수 순) */
export const listFeedback = async () => {
    const sb = cloud();
    if (sb) {
        const all = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await sb.from(TABLE).select('*').order('created_at', { ascending: false }).range(from, from + 999);
            if (error) throw new Error(`의견 목록을 불러오지 못했습니다: ${error.message}`);
            all.push(...(data || []).map(fromRow));
            if (!data || data.length < 1000) break;
        }
        return all;
    }
    return readLocal().sort((a, b) => String(b.at).localeCompare(String(a.at)));
};

/** 첨부 파일 주소 (로컬 dataURL · 저장소 서명 URL) → Map(키 → 주소) */
export const feedbackFileUrls = async (files) => {
    const out = new Map();
    files.filter(f => f.data).forEach(f => out.set(f.id, f.data));
    const stored = files.filter(f => f.path);
    if (stored.length) (await fileUrls(stored)).forEach((v, k) => out.set(k, v));
    return out;
};
export const feedbackFileKey = (f) => f.path || f.id;

/** 그림을 긴 변 maxSide px JPEG로 줄인다 (그림이 아니면 그대로) */
export const shrinkImageFile = async (file, maxSide = 1600) => {
    if (!/^image\/(png|jpe?g|webp|bmp)$/i.test(file.type)) return file;
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return file;
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 600 * 1024) return file;
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
};

/**
 * 지금 화면을 그림으로 (html2canvas, 처음 쓸 때 받음). 떠 있는 버튼·알림·열린 창은 뺀다.
 * @returns {Promise<File|null>} 실패하면 null (접수는 캡처 없이 계속)
 */
export const captureScreen = async () => {
    try {
        const { default: html2canvas } = await import('html2canvas');
        const target = document.body;
        const skip = (el) => el.id === 'ft-dock' || el.id === 'fb-modal' || el.id?.startsWith?.('ft-win') || el.classList?.contains('toast') || el.id === 'toast-container';
        const canvas = await html2canvas(target, {
            ignoreElements: skip, useCORS: true, logging: false, backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
            x: window.scrollX, y: window.scrollY, width: window.innerWidth, height: window.innerHeight,
            windowWidth: document.documentElement.clientWidth, windowHeight: window.innerHeight, scale: Math.min(1.5, window.devicePixelRatio || 1)
        });
        const k = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
        const out = Object.assign(document.createElement('canvas'), { width: Math.round(canvas.width * k), height: Math.round(canvas.height * k) });
        out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
        const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.82));
        return blob ? new File([blob], `화면캡처_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.jpg`, { type: 'image/jpeg' }) : null;
    } catch (e) {
        console.warn('[의견] 화면 캡처 실패:', e.message);
        return null;
    }
};

const uploadFiles = async (id, files) => {
    const sb = cloud();
    const out = [];
    for (const raw of files) {
        const f = await shrinkImageFile(raw);
        if (sb) {
            if (f.size > MAX_CLOUD) throw new Error(`${f.name}: 20MB를 넘습니다.`);
            const path = `feedback/${id}/${Date.now()}_${storageSafeName(f.name)}`;
            const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
            if (error) {
                if (out.length) await sb.storage.from(BUCKET).remove(out.map(x => x.path));
                throw new Error(`${f.name}: 올리지 못했습니다 (${error.message})`);
            }
            out.push({ path, name: f.name, mime: f.type || '', size: f.size });
        } else {
            if (f.size > MAX_LOCAL) throw new Error(`${f.name}: 로컬 모드에서는 2MB 이하만 저장할 수 있습니다.`);
            out.push({ id: uid(), name: f.name, mime: f.type || '', size: f.size, data: await readDataUrl(f) });
        }
    }
    return out;
};

/**
 * 의견 등록·수정 (요청자). 새 의견은 등록번호를 받아 돌려준다.
 * @param {{ id?: string, kind: string, title: string, body: string, tab?: string, tabLabel?: string, files?: object[] }} item
 * @param {{ newFiles?: File[], removeFiles?: string[] }} opts
 */
export const saveFeedback = async (item, { newFiles = [], removeFiles = [] } = {}) => {
    const title = String(item.title || '').trim();
    if (!title) throw new Error('제목을 입력하세요.');
    if (!FEEDBACK_KINDS[item.kind]) throw new Error('종류를 고르세요.');
    const isNew = !item.id;
    const id = isNew ? uid() : item.id;
    const kept = (item.files || []).filter(f => !removeFiles.includes(feedbackFileKey(f)));
    const added = await uploadFiles(id, newFiles);
    const row = { kind: item.kind, title, body: String(item.body || '').trim(), files: [...kept, ...added] };
    const sb = cloud();
    if (sb) {
        const q = isNew
            ? sb.from(TABLE).insert({ id, ...row, tab: item.tab || '', tab_label: item.tabLabel || '', app_version: currentVersion(), device: deviceInfo(), created_by_name: myName() }).select().single()
            : sb.from(TABLE).update(row).eq('id', id).select().single();
        const { data, error } = await q;
        if (error) {
            if (added.length) await sb.storage.from(BUCKET).remove(added.map(f => f.path));
            throw new Error(`의견을 저장하지 못했습니다: ${error.message}`);
        }
        const gone = (item.files || []).filter(f => f.path && removeFiles.includes(f.path)).map(f => f.path);
        if (gone.length) await sb.storage.from(BUCKET).remove(gone).catch(() => {});
        return fromRow(data);
    }
    const list = readLocal();
    const prev = list.find(x => x.id === id);
    const now = new Date().toISOString();
    const year = now.slice(0, 4);
    const seq = list.filter(x => String(x.regNo).startsWith(`의견-${year}-`)).reduce((m, x) => Math.max(m, Number(String(x.regNo).slice(-4)) || 0), 0) + 1;
    const saved = prev ? { ...prev, ...row, updatedAt: now } : {
        id, regNo: `의견-${year}-${String(seq).padStart(4, '0')}`, ...row, tab: item.tab || '', tabLabel: item.tabLabel || '', appVersion: currentVersion(), device: deviceInfo(),
        status: 'NEW', priority: 'NORMAL', reply: '', handler: '', deployedVersion: '', history: [], createdBy: myChatId(), by: myName(), at: now, updatedAt: now
    };
    writeLocal([saved, ...list.filter(x => x.id !== id)]);
    return saved;
};

/**
 * 처리 (매니저 이상): 상태·우선순위·답변·배포 버전. 상태나 답변이 바뀌고 notify면 요청자에게 1:1 메시지.
 * @returns {Promise<{ item: object, notified: boolean, notifyError?: string }>}
 */
export const handleFeedback = async (item, { status, priority, reply, deployedVersion, notify = true }) => {
    if (!FEEDBACK_STATUS[status]) throw new Error('상태를 고르세요.');
    const now = new Date().toISOString();
    const statusChanged = status !== item.status;
    const replyChanged = String(reply || '') !== String(item.reply || '');
    const history = statusChanged || replyChanged ? [...(item.history || []), { at: now, by: myName(), status, note: replyChanged ? String(reply || '').slice(0, 300) : '' }] : (item.history || []);
    const row = { status, priority, reply: String(reply || ''), deployed_version: String(deployedVersion || ''), handler_name: myName(), history };
    let saved;
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from(TABLE).update(row).eq('id', item.id).select().single();
        if (error) throw new Error(`처리 내용을 저장하지 못했습니다: ${error.message}`);
        saved = fromRow(data);
        if (saved.status !== status) throw new Error('처리 권한이 없습니다 (매니저 이상).');
    } else {
        saved = { ...item, status, priority, reply: row.reply, deployedVersion: row.deployed_version, handler: row.handler_name, history, updatedAt: now };
        writeLocal(readLocal().map(x => (x.id === item.id ? saved : x)));
    }
    if (!notify || !(statusChanged || replyChanged) || !saved.createdBy || saved.createdBy === myChatId()) return { item: saved, notified: false };
    try {
        await sendMessage(dmRoom(myChatId(), saved.createdBy), feedbackNoticeText(saved, statusChanged ? item.status : ''));
        return { item: saved, notified: true };
    } catch (e) {
        return { item: saved, notified: false, notifyError: e.message };
    }
};

/** 요청자에게 보내는 알림 글 */
export const feedbackNoticeText = (f, prevStatus = '') => [
    `💡 [의견 처리 알림] ${f.regNo} "${f.title}"`,
    `상태: ${prevStatus ? `${FEEDBACK_STATUS[prevStatus]?.label} → ` : ''}${FEEDBACK_STATUS[f.status]?.label}`,
    f.reply ? `답변: ${f.reply}` : '',
    f.status === 'DEPLOYED' ? `배포되었습니다${f.deployedVersion ? ` (버전 ${f.deployedVersion})` : ''}. 앱 아래쪽 [새로고침] 안내가 뜨면 눌러 주세요.` : '',
    '지원 → 의견·개선 요청에서 자세히 볼 수 있습니다.'
].filter(Boolean).join('\n');

/** 의견 삭제 (요청자: 접수 상태만, ADMIN: 모두) */
export const deleteFeedback = async (item) => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from(TABLE).delete().eq('id', item.id).select('id');
        if (error) throw new Error(`의견을 지우지 못했습니다: ${error.message}`);
        if (!data?.length) throw new Error('지울 권한이 없습니다 (접수 상태의 내 의견 또는 관리자).');
        const paths = (item.files || []).map(f => f.path).filter(Boolean);
        if (paths.length) await sb.storage.from(BUCKET).remove(paths).catch(() => {});
        return;
    }
    writeLocal(readLocal().filter(x => x.id !== item.id));
};
