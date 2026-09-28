// ==========================================
// 오프라인 작업 대기열
// ==========================================
// 인터넷이 없는 곳에서 한 입출고·이동·생산입고·재고실사를 이 기기에 작업 단위로 쌓아 두었다가,
// 연결되면 DB 함수 wms_apply_offline_op(supabase/auth/50_offline_ops.sql)로 하나씩 반영한다.
// - 작업마다 고유 id가 있어, 응답을 못 받아 다시 보내도 DB가 한 번만 반영한다.
// - 재고는 반영 시점의 클라우드 값에 증감만 더한다(다른 기기의 변경을 덮어쓰지 않음). 실사는 수량을 맞춘다(set).
// - 대기열은 로그아웃해도 지우지 않는다(daelim_offline_queue는 클라우드 캐시 키가 아님).
import { getSupabase, getSupabaseConfig, isSupabaseConfigured } from './supabase.js';

const QUEUE_KEY = 'daelim_offline_queue';
const PROBE_TIMEOUT_MS = 5000;
const REACHABLE_CACHE_MS = 15000;   // 연결 확인 성공을 믿는 시간
const UNREACHABLE_CACHE_MS = 30000; // 연결 실패를 믿는 시간 (그 뒤에는 다시 확인)

/**
 * @typedef {Object} StockChange 재고 변경 한 건
 * @property {string} code 품목코드
 * @property {string} location 거점
 * @property {number} [delta] 증감 수량
 * @property {number} [set] 실사로 맞출 수량 (delta 대신)
 */
/**
 * @typedef {Object} HistoryRow wms_history_logs 한 행
 * @property {string} type
 * @property {string} code
 * @property {string} name
 * @property {number} qty
 * @property {string} worker
 * @property {string} from_loc
 * @property {string} to_loc
 * @property {string} reason
 * @property {string} timestamp ISO 시각 (기기에서 작업한 시각)
 */
/**
 * @typedef {Object} OfflineOp 오프라인 작업 한 건
 * @property {string} id
 * @property {string} label 화면 표시용 설명 (예: '입고 · 엔진오일 20L')
 * @property {string} createdAt ISO 시각
 * @property {StockChange[]} stock
 * @property {HistoryRow[]} logs
 * @property {string} [lastError] 네트워크가 아닌 이유로 반영에 실패한 경우의 메시지
 */

const loadQueue = () => {
    try {
        const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error('[오프라인] 대기열을 읽지 못했습니다:', e);
        return [];
    }
};

/** @type {OfflineOp[]} */
let queue = loadQueue();

const listeners = new Set();
const notify = () => listeners.forEach(cb => {
    try { cb(queue.length); } catch (e) { console.error('[오프라인] 대기열 알림 오류:', e); }
});

const saveQueue = () => {
    try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
        // 저장 공간이 가득 차면 새로고침 때 대기 작업을 잃으므로 반드시 알린다
        console.error('[오프라인] 대기열 저장 실패:', e);
        alert('⚠️ 기기 저장 공간이 부족해 오프라인 작업을 저장하지 못했습니다. 인터넷에 연결한 뒤 앱을 새로고침하지 말고 [지금 반영]을 눌러 주세요.');
    }
    notify();
};

// 다른 탭에서 대기열이 바뀌면 이 탭의 사본도 맞춘다
window.addEventListener('storage', (e) => {
    if (e.key !== QUEUE_KEY) return;
    queue = loadQueue();
    notify();
});

/**
 * 대기열 변경 알림 등록
 * @param {(pendingCount: number) => void} listener
 * @returns {() => void} 등록 해제 함수
 */
export const onOfflineQueueChange = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** @returns {OfflineOp[]} 반영 대기 중인 작업 (오래된 순) */
export const pendingOfflineOps = () => queue.map(op => ({ ...op }));
export const pendingOfflineCount = () => queue.length;

// ---------- 연결 상태 ----------
let lastProbe = { at: 0, reachable: true };

/**
 * 네트워크 실패(서버 응답 없음)인지. 서버가 응답한 오류(권한·제약 위반 등)는 false.
 * @param {{ message?: string, code?: string, name?: string } | null | undefined} error
 */
export const isNetworkError = (error) => {
    if (!error) return false;
    if (error.name === 'AbortError') return true;
    if (error.code) return false;
    return /failed to fetch|networkerror|network request failed|load failed|fetch failed|aborted|timeout/i.test(String(error.message || error));
};

const markUnreachable = () => { lastProbe = { at: Date.now(), reachable: false }; };

/** 최근 확인 기준으로 지금 오프라인인지 (기다리지 않는 판단) */
export const isKnownOffline = () => {
    if (!isSupabaseConfigured()) return false;
    if (navigator.onLine === false) return true;
    return !lastProbe.reachable && Date.now() - lastProbe.at < UNREACHABLE_CACHE_MS;
};

/**
 * 클라우드(Supabase)에 실제로 닿는지 확인한다. 와이파이는 잡혀도 인터넷이 안 되는 경우를 가리기 위해
 * 가벼운 조회를 5초 제한으로 보내 본다. 결과는 잠시 기억한다.
 * @returns {Promise<boolean>}
 */
export const checkCloudReachable = async () => {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured()) return false;
    if (navigator.onLine === false) { markUnreachable(); return false; }
    const age = Date.now() - lastProbe.at;
    if (lastProbe.reachable && age < REACHABLE_CACHE_MS) return true;
    if (!lastProbe.reachable && age < 3000) return false; // 방금 실패했으면 바로 다시 묻지 않는다

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
        // 인증 서버 상태 확인은 로그인 전에도 200을 돌려주므로 콘솔에 권한 오류가 남지 않는다.
        // 응답이 오기만 하면(상태 코드와 무관) 서버에 닿은 것으로 본다.
        const { url, key } = getSupabaseConfig();
        await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, cache: 'no-store', signal: controller.signal });
        lastProbe = { at: Date.now(), reachable: true };
        return true;
    } catch (e) {
        if (!isNetworkError(e)) console.warn('[오프라인] 연결 확인 중 오류:', e);
        markUnreachable();
        return false;
    } finally {
        clearTimeout(timer);
    }
};

/** 온라인 요청이 네트워크 오류로 실패했을 때 호출 (다음 작업부터 오프라인으로 저장) */
export const reportNetworkFailure = () => markUnreachable();

// ---------- 대기열 ----------
const newOpId = () => (crypto.randomUUID ? crypto.randomUUID() : `OP-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

/**
 * 오프라인 작업을 대기열에 넣는다.
 * @param {{ label: string, stock: StockChange[], logs: HistoryRow[] }} op
 * @returns {OfflineOp}
 */
export const enqueueOfflineOp = ({ label, stock, logs }) => {
    const op = { id: newOpId(), label, createdAt: new Date().toISOString(), stock: stock || [], logs: logs || [] };
    queue.push(op);
    saveQueue();
    return op;
};

/**
 * 대기 작업 하나를 반영하지 않고 버린다 (반영이 계속 실패하는 작업을 사용자가 정리할 때)
 * @param {string} id
 */
export const discardOfflineOp = (id) => {
    queue = queue.filter(op => op.id !== id);
    saveQueue();
};

let flushing = null;

/**
 * 대기 작업을 오래된 순으로 클라우드에 반영한다. 네트워크 오류가 나면 멈추고 남은 작업은 다음에 보낸다.
 * 권한·데이터 오류로 실패한 작업은 오류 메시지를 남기고 건너뛴다(다음 반영 때 다시 시도).
 * @returns {Promise<{ applied: number, failed: number, remaining: number, offline: boolean }>}
 */
export const flushOfflineQueue = () => {
    if (flushing) return flushing;
    flushing = (async () => {
        const result = { applied: 0, failed: 0, remaining: queue.length, offline: false };
        const supabase = getSupabase();
        if (!supabase || !isSupabaseConfigured() || queue.length === 0) return result;
        if (!(await checkCloudReachable())) return { ...result, offline: true };

        for (const op of [...queue]) {
            const { error } = await supabase.rpc('wms_apply_offline_op', {
                p_op_id: op.id, p_label: op.label, p_created_at: op.createdAt, p_stock: op.stock, p_logs: op.logs
            });
            if (error && isNetworkError(error)) {
                markUnreachable();
                result.offline = true;
                break;
            }
            if (error) {
                console.error('[오프라인] 작업 반영 실패:', op.label, error);
                const target = queue.find(q => q.id === op.id);
                if (target) target.lastError = error.message || String(error);
                result.failed++;
                continue;
            }
            queue = queue.filter(q => q.id !== op.id); // 새로 반영됐거나(true) 이미 반영된 작업(false)
            result.applied++;
        }
        saveQueue();
        result.remaining = queue.length;
        return result;
    })().finally(() => { flushing = null; });
    return flushing;
};
