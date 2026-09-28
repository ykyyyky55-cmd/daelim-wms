// ==========================================
// 전표 스캔 등록 기록 (supabase/auth/40_scan_slips.sql)
// ==========================================
// 전표 스캔 등록 화면에서 등록할 때마다 한 건(SC-YYYYMMDD-NNN)을 남겨 전표관리에 보여 준다.
// 재고·수불부는 등록 때 processStockAction으로 이미 반영되므로 여기서는 기록만 다룬다 (지워도 재고는 그대로).
// - 클라우드: 표 wms_scan_slips + 전표 사진은 비공개 버킷 wms-files의 scans/<id>/…
// - 로컬 모드: localStorage daelim_scanSlips (사진은 넣지 않음)
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';
import { storageSafeName } from './storageKey.js';

// 전표 종류 → 재고 처리(action: IN 늘림 · OUT/USE 줄임 · MOVE 창고 이동, null = 사용자가 늘림/줄임 선택)
// 수불부 전표 구분에는 종류 이름(구매·카드사용·폐기 등)을 그대로 적는다.
export const SCAN_SLIP_TYPES = {
    IN: { label: '입고 (받음)', word: '입고', action: 'IN' },
    OUT: { label: '출고 (보냄)', word: '출고', action: 'OUT' },
    USE: { label: '사용', word: '사용', action: 'USE' },
    MOVE: { label: '이동 (창고 → 창고)', word: '이동', action: 'MOVE' },
    BUY: { label: '구매', word: '구매', action: 'IN' },
    CARD: { label: '카드사용 (카드로 구매)', word: '카드사용', action: 'IN' },
    DISPOSE: { label: '폐기', word: '폐기', action: 'OUT' },
    ETC: { label: '기타', word: '기타', action: null }
};

const BUCKET = 'wms-files';
const LOCAL_KEY = 'daelim_scanSlips';
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const writeLocal = (v) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch { throw new Error('이 기기의 저장 공간이 부족합니다.'); } };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

const fromRow = (r) => ({
    id: r.id, regNo: r.reg_no || '', kind: r.slip_kind, action: r.action, date: r.slip_date, partner: r.partner || '', docNo: r.doc_no || '',
    fromLoc: r.from_loc || '', toLoc: r.to_loc || '', worker: r.worker || '', items: Array.isArray(r.items) ? r.items : [],
    files: Array.isArray(r.files) ? r.files : [], by: r.created_by_name || '', createdBy: r.created_by, createdAt: r.created_at,
    // 카드전표 (supabase/auth/41_scan_slips_card.sql)
    amount: Number(r.amount) || 0, card: r.card || '', purpose: r.purpose || ''
});

// 사진 저장 경로: 카드 영수증은 월·일자별(cards/YYYY-MM/YYYY-MM-DD_등록번호.jpg), 그 밖은 scans/<id>/
const photoPath = (rec) => (rec.kind === 'CARD'
    ? `cards/${String(rec.date).slice(0, 7)}/${rec.date}_${storageSafeName(rec.regNo || rec.id)}_${Date.now()}.jpg`
    : `scans/${rec.id}/${Date.now()}_${storageSafeName(`${rec.regNo || 'scan'}.jpg`)}`);

/** 사진 올리기(바꾸기): 새 사진을 올리고 기록의 files를 바꾼 뒤 예전 사진을 지운다 */
export const setScanPhoto = async (rec, photo) => {
    const sb = cloud();
    if (!sb) throw new Error('로컬 모드에서는 사진을 보관하지 않습니다.');
    const path = photoPath(rec);
    const up = await sb.storage.from(BUCKET).upload(path, photo, { contentType: photo.type || 'image/jpeg', upsert: false });
    if (up.error) throw new Error(`사진을 올리지 못했습니다: ${up.error.message}`);
    const name = `${rec.date}_${rec.regNo || 'scan'}.jpg`;
    const files = [{ path, name, mime: photo.type || 'image/jpeg', size: photo.size || 0 }];
    const { error } = await sb.from('wms_scan_slips').update({ files }).eq('id', rec.id);
    if (error) {
        await sb.storage.from(BUCKET).remove([path]).catch(() => {});
        throw new Error(`사진 정보를 저장하지 못했습니다: ${error.message}`);
    }
    const old = (rec.files || []).map(f => f.path).filter(p => p && p !== path);
    if (old.length) await sb.storage.from(BUCKET).remove(old).catch(() => {});
    return files;
};

/**
 * 등록 한 건 저장. photo(Blob, 선택)는 기록을 남긴 뒤 올린다 — 사진이 실패해도 기록은 남는다.
 * @returns { rec, photoError }
 */
export const saveScanSlip = async ({ kind, action, date, partner = '', docNo = '', fromLoc = '', toLoc = '', worker = '', items = [], amount = 0, card = '', purpose = '' }, { photo = null } = {}) => {
    const by = state.currentUser?.name || state.currentGlobalWorker || '';
    const sb = cloud();
    if (!sb) {
        const list = readLocal();
        const prefix = `SC-${String(date).replace(/-/g, '')}-`;
        const next = list.filter(x => String(x.regNo).startsWith(prefix)).reduce((m, x) => Math.max(m, Number(String(x.regNo).slice(prefix.length)) || 0), 0) + 1;
        const rec = { id: uid(), regNo: `${prefix}${String(next).padStart(3, '0')}`, kind, action, date, partner, docNo, fromLoc, toLoc, worker, items, files: [], by, createdAt: new Date().toISOString(), amount: Number(amount) || 0, card, purpose };
        writeLocal([rec, ...list].slice(0, 1000));
        return { rec, photoError: '' };
    }
    const { data, error } = await sb.from('wms_scan_slips').insert({
        slip_kind: kind, action, slip_date: date, partner, doc_no: docNo, from_loc: fromLoc, to_loc: toLoc, worker, items, created_by_name: by,
        amount: Number(amount) || 0, card, purpose
    }).select().single();
    if (error) throw new Error(`전표 스캔 기록을 저장하지 못했습니다: ${error.message}`);
    const rec = fromRow(data);
    if (!photo) return { rec, photoError: '' };
    try {
        rec.files = await setScanPhoto({ ...rec, files: [] }, photo);
        return { rec, photoError: '' };
    } catch (e) {
        return { rec, photoError: e.message || String(e) };
    }
};

/** 기간 목록 (from·to 'YYYY-MM-DD', 비우면 제한 없음) */
export const listScanSlipsRange = async ({ from = '', to = '' } = {}) => {
    const sb = cloud();
    if (!sb) {
        return readLocal().filter(s => (!from || String(s.date) >= from) && (!to || String(s.date) <= to))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.regNo).localeCompare(String(a.regNo)));
    }
    const all = [];
    for (let start = 0; ; start += 1000) {
        let q = sb.from('wms_scan_slips').select('*');
        if (from) q = q.gte('slip_date', from);
        if (to) q = q.lte('slip_date', to);
        const { data, error } = await q.order('slip_date', { ascending: false }).order('reg_no', { ascending: false }).range(start, start + 999);
        if (error) {
            // DB 설정(40_scan_slips.sql) 전이면 빈 목록
            if (/wms_scan_slips/.test(error.message) && /(does not exist|schema cache)/.test(error.message)) return [];
            throw new Error(`전표 스캔 기록을 불러오지 못했습니다: ${error.message}`);
        }
        all.push(...(data || []).map(fromRow));
        if (!data || data.length < 1000) break;
    }
    return all;
};

/** 기록 수정 (거래처·원본 번호·작업자·품목). 재고 조정은 부르는 쪽(전표관리)이 processStockAction으로 먼저 한다. */
export const updateScanSlip = async (rec, { partner = '', docNo = '', worker = '', items = [], amount = rec.amount || 0, card = rec.card || '', purpose = rec.purpose || '' }) => {
    const sb = cloud();
    if (!sb) {
        const list = readLocal();
        const x = list.find(r => r.id === rec.id);
        if (!x) throw new Error('기록을 찾을 수 없습니다.');
        Object.assign(x, { partner, docNo, worker, items, amount: Number(amount) || 0, card, purpose });
        writeLocal(list);
        return x;
    }
    const { data, error } = await sb.from('wms_scan_slips').update({ partner, doc_no: docNo, worker, items, amount: Number(amount) || 0, card, purpose }).eq('id', rec.id).select().maybeSingle();
    if (error) throw new Error(`기록을 수정하지 못했습니다: ${error.message}`);
    if (!data) throw new Error('기록을 수정하지 못했습니다 (등록한 사람 또는 매니저 이상만 수정할 수 있습니다).');
    return fromRow(data);
};

/** 기록 삭제 (사진 포함). 재고·수불부는 바뀌지 않는다. */
export const deleteScanSlip = async (rec) => {
    const sb = cloud();
    if (!sb) { writeLocal(readLocal().filter(x => x.id !== rec.id)); return; }
    const { data, error } = await sb.from('wms_scan_slips').delete().eq('id', rec.id).select('id');
    if (error) throw new Error(`기록을 삭제하지 못했습니다: ${error.message}`);
    if (!data?.length) throw new Error('기록을 삭제하지 못했습니다 (등록한 사람 또는 매니저 이상만 지울 수 있습니다).');
    const paths = (rec.files || []).map(f => f.path).filter(Boolean);
    if (paths.length) await sb.storage.from(BUCKET).remove(paths).catch(() => {});
};

/** 여러 기록의 사진 주소 한꺼번에 → Map(id → url) */
export const scanPhotoUrls = async (recs) => {
    const out = new Map();
    const sb = cloud();
    if (!sb) return out;
    const withPath = recs.filter(r => r.files?.[0]?.path);
    for (let i = 0; i < withPath.length; i += 100) {
        const part = withPath.slice(i, i + 100);
        const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(part.map(r => r.files[0].path), 3600);
        if (error) throw new Error(`사진 주소를 만들지 못했습니다: ${error.message}`);
        (data || []).forEach((d, j) => { if (d.signedUrl) out.set(part[j].id, d.signedUrl); });
    }
    return out;
};

/** 월별 카드전표 (YYYY-MM) */
export const listCardSlips = async (ym) => {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const list = await listScanSlipsRange({ from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` });
    return list.filter(r => r.kind === 'CARD').sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.regNo).localeCompare(String(b.regNo)));
};

/** 전표 사진 주소 (서명 URL 1시간) */
export const scanPhotoUrl = async (rec) => {
    const f = (rec.files || [])[0];
    if (!f?.path) return '';
    const sb = cloud();
    if (!sb) return '';
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(f.path, 3600);
    if (error) throw new Error(`사진 주소를 만들지 못했습니다: ${error.message}`);
    return data?.signedUrl || '';
};
