// ==========================================
// 특별보안 자료 백업·복원 (제조시방서 · 원액생산 작업지시서 · 생산입고 배합비(BOM))
// ==========================================
// - 배합 자료가 파일로 나가므로 백업 파일은 항상 비밀번호로 암호화한다.
//   비밀번호 → PBKDF2(SHA-256, 25만 회) → AES-GCM 256. 비밀번호는 어디에도 저장하지 않는다.
// - 파일 형식: { format: 'daelim-secure-backup', v: 1, kdf: { salt, iter }, iv, data } (data = 암호문 base64)
// - 복호화한 내용: { format, version, createdAt, createdBy, recipes, orders, boms: { cloud, local } }
import { secure, loadSecureData } from './secureWorkOrders.js';
import { exportBoms } from './plans.js';
import { state } from './db.js';

const FORMAT = 'daelim-secure-backup';
const ITER = 250000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

const deriveKey = async (password, salt, iter) => {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};

/** 지금 자료로 백업 내용 만들기 (parts: { recipes, orders, boms } 중 true인 것만) */
export const buildBackup = async (parts = { recipes: true, orders: true, boms: true }) => {
    await loadSecureData();
    return {
        format: FORMAT,
        version: 1,
        createdAt: new Date().toISOString(),
        createdBy: state.currentUser?.name || '',
        recipes: parts.recipes ? secure.recipes : [],
        orders: parts.orders ? secure.orders : [],
        boms: parts.boms ? await exportBoms() : { cloud: {}, local: {} }
    };
};

/** 백업 내용을 암호화해 파일(Blob)로 */
export const encryptBackup = async (backup, password) => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITER);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(backup)));
    const file = { format: FORMAT, v: 1, kdf: { salt: toB64(salt), iter: ITER }, iv: toB64(iv), data: toB64(cipher) };
    return new Blob([JSON.stringify(file)], { type: 'application/json' });
};

/** 백업 파일 읽기 (비밀번호가 틀리면 오류) */
export const decryptBackup = async (text, password) => {
    let file;
    try { file = JSON.parse(text); } catch { throw new Error('백업 파일 형식이 아닙니다.'); }
    if (file?.format !== FORMAT || !file.data) throw new Error('대림 WMS 보안 백업 파일이 아닙니다.');
    const key = await deriveKey(password, fromB64(file.kdf.salt), Number(file.kdf.iter) || ITER);
    let plain;
    try {
        plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, key, fromB64(file.data));
    } catch {
        throw new Error('비밀번호가 맞지 않거나 파일이 손상되었습니다.');
    }
    const backup = JSON.parse(dec.decode(plain));
    if (backup?.format !== FORMAT) throw new Error('백업 내용을 읽지 못했습니다.');
    return {
        ...backup,
        recipes: Array.isArray(backup.recipes) ? backup.recipes : [],
        orders: Array.isArray(backup.orders) ? backup.orders : [],
        boms: { cloud: backup.boms?.cloud || {}, local: backup.boms?.local || {} }
    };
};

/** 파일 내려받기 */
export const downloadBlob = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

export const backupFileName = (tag = '') => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `대림WMS_보안백업${tag ? `_${tag}` : ''}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.dlbak`;
};
