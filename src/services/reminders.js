// ==========================================
// 할일 알림 (담당자 앱에서 울림)
// ==========================================
// 앱이 열려 있을 때 1분마다 내 할일을 보고 알림을 띄운다 (서버 푸시는 쓰지 않음: 무료 요금제).
//   NEW    : 다른 사람이 나에게 배정한 할일 (realtime으로 바로, 앱을 늦게 열면 열 때)
//   DAY    : 예정일 당일 아침 08:00 (그 뒤에 열면 열 때) — 생산예정일·출하예정일 확인
//   BEFORE : 시간이 있는 할일(출하 시간 등)은 remindBefore분 전(기본 30분) ~ 예정 시각 1시간 뒤까지 한 번
// 이미 띄운 알림은 기기별로 기억한다(daelim_reminded_<사용자>, 30일 지나면 정리).
import { localDateStr } from './searchUtils.js';

export const DAY_ALARM_HOUR = 8;
const toDate = (d, t = '00:00') => { const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, h || 0, mi || 0); };

const storeKey = (me) => `daelim_reminded_${me || 'local'}`;
export const readFired = (me) => { try { return JSON.parse(localStorage.getItem(storeKey(me)) || '{}'); } catch { return {}; } };
export const writeFired = (me, map) => {
    const cut = Date.now() - 30 * 86400000;
    Object.keys(map).forEach(k => { if (map[k] < cut) delete map[k]; });
    try { localStorage.setItem(storeKey(me), JSON.stringify(map)); } catch { /* 저장 불가 */ }
};

/**
 * 지금 띄울 알림 목록
 * @returns [{ key, kind: 'NEW'|'DAY'|'BEFORE', todo }]
 */
export const dueAlarms = (todos, me, fired, now = new Date()) => {
    const out = [];
    const today = localDateStr(now);
    for (const t of todos) {
        if (t.done) continue;
        if (t.assignedBy && String(t.assignedBy) !== String(me)) {
            const k = `${t.id}|NEW|${t.dueDate || ''}${t.dueTime || ''}`;
            if (!fired[k]) out.push({ key: k, kind: 'NEW', todo: t });
        }
        if (!t.dueDate) continue;
        if (t.dueDate === today && now.getHours() >= DAY_ALARM_HOUR) {
            const k = `${t.id}|DAY|${t.dueDate}`;
            if (!fired[k]) out.push({ key: k, kind: 'DAY', todo: t });
        }
        if (t.dueTime && t.remindBefore !== null && t.remindBefore !== undefined) {
            const at = toDate(t.dueDate, t.dueTime);
            const from = new Date(at.getTime() - Number(t.remindBefore) * 60000);
            const until = new Date(at.getTime() + 60 * 60000);
            const k = `${t.id}|BEFORE|${t.dueDate} ${t.dueTime}`;
            if (now >= from && now <= until && !fired[k]) out.push({ key: k, kind: 'BEFORE', todo: t });
        }
    }
    // 같은 할일은 가장 급한 것 하나만 (BEFORE > DAY > NEW), 나머지는 띄운 것으로 친다
    const rank = { BEFORE: 3, DAY: 2, NEW: 1 };
    const best = new Map();
    out.forEach(a => { const b = best.get(a.todo.id); if (!b || rank[a.kind] > rank[b.kind]) best.set(a.todo.id, a); });
    return { show: [...best.values()], all: out };
};

export const minutesUntil = (t, now = new Date()) => (t.dueDate && t.dueTime ? Math.round((toDate(t.dueDate, t.dueTime) - now) / 60000) : null);

// 알림음 (짧은 두 번 삑)
let audioCtx = null;
export const beep = () => {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.28].forEach((d, i) => {
            const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
            o.type = 'sine'; o.frequency.value = i ? 1175 : 880;
            g.gain.setValueAtTime(0.0001, audioCtx.currentTime + d);
            g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + d + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + d + 0.22);
            o.connect(g); g.connect(audioCtx.destination);
            o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + 0.25);
        });
    } catch { /* 소리 불가 */ }
};

// 브라우저(운영체제) 알림
export const canBrowserNotify = () => 'Notification' in window;
export const browserNotifyState = () => (canBrowserNotify() ? Notification.permission : 'unsupported');
export const askBrowserNotify = async () => { try { if (canBrowserNotify() && Notification.permission === 'default') await Notification.requestPermission(); } catch { /* 무시 */ } return browserNotifyState(); };
export const browserNotify = (title, body, onClick) => {
    try {
        if (!canBrowserNotify() || Notification.permission !== 'granted') return;
        const n = new Notification(title, { body, icon: './icon.svg', tag: title + body.slice(0, 20) });
        n.onclick = () => { window.focus(); onClick?.(); n.close(); };
    } catch { /* 모바일 등 생성자 미지원 */ }
};
