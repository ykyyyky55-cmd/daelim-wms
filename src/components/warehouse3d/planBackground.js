// ==========================================
// 평면도 편집기의 배경 도면 그림 — 이 기기에만 둔다 (서버로 올리지 않음)
// ==========================================
// 건축물현황도 같은 도면은 공식 문서라 앱(공개 배포)에 넣지 않고, 쓰는 사람이 자기 기기에서 불러와 밑그림으로 깐다.
// · 그림 파일: IndexedDB(daelim_w3_plan → background, 키 = 공장 id). 못 쓰는 환경이면 이번에 열어 둔 동안만 쓴다.
// · 맞춤값(그림 왼쪽 위 모서리의 배치 좌표 x·z m, 그림 가로 폭 m, 투명도): localStorage daelim_w3_plan_bg

const DB_NAME = 'daelim_w3_plan';
const STORE = 'background';
const SETTING_KEY = 'daelim_w3_plan_bg';

const openDb = () => new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('이 브라우저는 기기 저장소(IndexedDB)를 쓸 수 없습니다.')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('기기 저장소를 열지 못했습니다.'));
});

/** 저장소 작업 하나 (끝나면 닫는다) */
const run = async (mode, work) => {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const req = work(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(req?.result);
            tx.onerror = () => reject(tx.error || new Error('기기 저장소 작업 실패'));
            tx.onabort = () => reject(tx.error || new Error('기기 저장소 작업이 취소되었습니다.'));
        });
    } finally {
        db.close();
    }
};

/** 저장해 둔 배경 그림 → { blob, name } (없으면 null) */
export const loadBackgroundFile = async (plantId) => (await run('readonly', store => store.get(plantId))) || null;
/** 배경 그림 저장 (이 기기) */
export const saveBackgroundFile = (plantId, file) => run('readwrite', store => store.put({ blob: file, name: file.name || '배경 도면' }, plantId));
/** 배경 그림 지우기 */
export const deleteBackgroundFile = (plantId) => run('readwrite', store => store.delete(plantId));

const readAll = () => {
    try {
        const v = JSON.parse(localStorage.getItem(SETTING_KEY) || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) {
        console.warn('배경 도면 맞춤값을 읽지 못했습니다.', e);
        return {};
    }
};
const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

/**
 * 배경 그림 맞춤값
 * @typedef {{ x: number, z: number, widthM: number, opacity: number }} BackgroundSetting
 * @param {string} plantId
 * @param {{ x: number, z: number, widthM: number }} [fallback] 저장된 값이 없을 때 (그 공장 도면의 처음 맞춤값)
 * @returns {BackgroundSetting}
 */
export const readBackgroundSetting = (plantId, fallback = { x: 0, z: 0, widthM: 60 }) => {
    const saved = readAll()[plantId] || {};
    return {
        x: num(saved.x, fallback.x), z: num(saved.z, fallback.z),
        widthM: Math.max(1, num(saved.widthM, fallback.widthM)),
        opacity: Math.min(1, Math.max(0.05, num(saved.opacity, 0.55)))
    };
};
/** @param {string} plantId @param {BackgroundSetting|null} setting null이면 지운다(처음 맞춤값으로) */
export const writeBackgroundSetting = (plantId, setting) => {
    try {
        const all = readAll();
        if (setting) all[plantId] = setting; else delete all[plantId];
        localStorage.setItem(SETTING_KEY, JSON.stringify(all));
    } catch (e) {
        console.warn('배경 도면 맞춤값 저장 실패', e);
    }
};
