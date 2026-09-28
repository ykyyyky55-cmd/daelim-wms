// ==========================================
// 품질관리 (메뉴 품질관리, supabase/auth/46_quality.sql)
// ==========================================
// wms_qc_records 한 줄 = 기록 하나 (내용은 data JSONB)
//   INSPECT   검사·불량 기록 (area: PRODUCT 제품 출하검사 / PROCESS 공정검사 / MATERIAL 원부자재 수입검사)
//   EQUIP     설비 대장 · EQUIP_LOG 설비 점검·수리 이력 · MSDS 물질안전보건자료 대장
//   CFG       설정 (CFG:DEFECT:<영역> = 불량 유형 목록 · 목표 불량률 %)
// 로컬 모드: localStorage(daelim_qc_records)
// 불량률 = 불량수량 ÷ 검사수량 × 100 (%), PPM = 불량수량 ÷ 검사수량 × 1,000,000
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';

const TABLE = 'wms_qc_records';
const LOCAL_KEY = 'daelim_qc_records';
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const writeLocal = (v) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch { throw new Error('이 기기의 저장 공간이 부족합니다.'); } };
const me = () => state.currentUser || {};
const newId = (kind) => `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

/** 불량률 관리 영역 */
export const QC_AREAS = {
    PRODUCT: {
        label: '제품관리', tab: 'qcProduct', icon: 'package-check', inspect: '제품 출하검사', unitLabel: '검사수량',
        groupLabel: '거래처', groupKey: 'partner', desc: '완제품 출하·최종검사 결과와 제품별 불량률을 관리합니다.',
        categories: ['완제품'], defaultTypes: ['누유·새는 용기', '라벨 불량(오부착·인쇄)', '캡·마개 불량', '용량 부족·과충진', '이물·오염', '외관(찍힘·변형)', '포장·박스 불량', '성상·색상 이상', '기타']
    },
    PROCESS: {
        label: '공정관리', tab: 'qcProcess', icon: 'workflow', inspect: '공정검사', unitLabel: '생산·검사수량',
        groupLabel: '공정·라인', groupKey: 'process', desc: '블렌딩·충진·라벨·포장 공정의 공정검사 결과와 공정별 불량률을 관리합니다.',
        categories: ['완제품', '원액'], processes: ['원액 블렌딩', '충진', '캡핑', '라벨 부착', '포장·박스', '검사·출하 준비'],
        defaultTypes: ['충진량 편차', '캡핑 불량', '라벨 위치·기울어짐', '배합비 편차', '점도·비중 규격 이탈', '이물 혼입', '설비 트러블', '작업자 실수', '기타']
    },
    MATERIAL: {
        label: '원부자재관리', tab: 'qcMaterial', icon: 'package-search', inspect: '원부자재 수입검사', unitLabel: '입고·검사수량',
        groupLabel: '공급처', groupKey: 'supplier', desc: '원료·부자재 입고 시 수입검사 결과와 공급처·품목별 불량률을 관리합니다.',
        categories: ['원료', '원액', '부자재', '소모품'], defaultTypes: ['성적서(COA) 미첨부', '규격(비중·점도 등) 이탈', '용기 파손·누유', '인쇄 불량(라벨·박스)', '치수 불량', '수량 부족', '오염·이물', '유통기한 임박·경과', '기타']
    }
};
export const QC_RESULTS = { PASS: '합격', COND: '조건부 합격', FAIL: '불합격' };
export const DEFAULT_TARGET = { PRODUCT: 0.5, PROCESS: 1.0, MATERIAL: 1.0 };

export const EQUIP_STATUS = { RUN: '가동', STOP: '정지', REPAIR: '수리 중', DISPOSED: '폐기' };
export const EQUIP_LOG_KINDS = { CHECK: '정기점검', REPAIR: '고장 수리', CALIB: '검교정', PM: '예방정비', ETC: '기타' };
export const EQUIP_CATEGORIES = ['블렌딩·교반', '충진기', '캡핑기', '라벨기', '포장·박스', '저장탱크', '펌프·배관', '계측·시험기', '지게차·운반', '공조·유틸리티', '기타'];
// GHS 그림문자 (MSDS 유해성)
export const GHS = {
    GHS01: '폭발성', GHS02: '인화성', GHS03: '산화성', GHS04: '고압가스', GHS05: '부식성',
    GHS06: '급성독성', GHS07: '경고(자극성 등)', GHS08: '건강유해성', GHS09: '환경유해성'
};

const fromRow = (r) => ({ ...(r.data || {}), id: r.id, kind: r.kind, date: r.rec_date || r.data?.date || '', by: r.created_by_name || '', createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });

/** 기록 목록 (kind 하나, 최근 날짜 순) */
export const listQc = async (kind) => {
    const sb = cloud();
    if (sb) {
        const all = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await sb.from(TABLE).select('*').eq('kind', kind).order('rec_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).range(from, from + 999);
            if (error) throw new Error(`품질 기록을 불러오지 못했습니다: ${error.message}`);
            all.push(...(data || []).map(fromRow));
            if (!data || data.length < 1000) break;
        }
        return all;
    }
    return readLocal().filter(r => r.kind === kind).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
};

/** 기록 저장 (id 없으면 새로) */
export const saveQc = async (kind, rec) => {
    const id = rec.id || newId(kind === 'EQUIP_LOG' ? 'EL' : kind === 'INSPECT' ? 'QC' : kind);
    const { id: _i, kind: _k, by: _b, createdBy: _c, createdAt: _ca, updatedAt: _u, ...data } = rec;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(rec.date || '') ? rec.date : null;
    const sb = cloud();
    if (sb) {
        const row = { id, kind, rec_date: date, data, updated_at: new Date().toISOString() };
        const { data: saved, error } = rec.id
            ? await sb.from(TABLE).update(row).eq('id', id).select().single()
            : await sb.from(TABLE).insert({ ...row, created_by_name: me().name || '' }).select().single();
        if (error) throw new Error(`저장하지 못했습니다: ${error.message}`);
        return fromRow(saved);
    }
    const list = readLocal();
    const prev = list.find(x => x.id === id);
    const saved = { ...data, id, kind, date: date || '', by: prev?.by || me().name || '', createdBy: prev?.createdBy || me().username || '', createdAt: prev?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    writeLocal([saved, ...list.filter(x => x.id !== id)]);
    return saved;
};

/** 정해진 id로 넣거나 바꾼다 (다른 화면에서 만든 기록을 다시 저장해도 한 건으로 유지, 예: 초·중·종물 일지 불량 → QCW-…) */
export const upsertQc = async (kind, rec) => {
    if (!rec.id) throw new Error('기록 번호가 없습니다.');
    const { id, kind: _k, by: _b, createdBy: _c, createdAt: _ca, updatedAt: _u, ...data } = rec;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(rec.date || '') ? rec.date : null;
    const sb = cloud();
    if (sb) {
        const { data: saved, error } = await sb.from(TABLE).upsert({ id, kind, rec_date: date, data, updated_at: new Date().toISOString(), created_by_name: rec.by || me().name || '' }, { onConflict: 'id' }).select().single();
        if (error) throw new Error(`품질 기록을 저장하지 못했습니다: ${error.message}`);
        return fromRow(saved);
    }
    const list = readLocal();
    const prev = list.find(x => x.id === id);
    const saved = { ...data, id, kind, date: date || '', by: prev?.by || me().name || '', createdBy: prev?.createdBy || me().username || '', createdAt: prev?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    writeLocal([saved, ...list.filter(x => x.id !== id)]);
    return saved;
};

export const deleteQc = async (id) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from(TABLE).delete().eq('id', id);
        if (error) throw new Error(`지우지 못했습니다: ${error.message}`);
        return;
    }
    writeLocal(readLocal().filter(x => x.id !== id));
};

// ---------- 설정 (불량 유형 · 목표 불량률) ----------
const cfgId = (area) => `CFG:DEFECT:${area}`;
export const getDefectConfig = async (area) => {
    const def = { types: [...QC_AREAS[area].defaultTypes], target: DEFAULT_TARGET[area] };
    const sb = cloud();
    let rec = null;
    if (sb) {
        const { data, error } = await sb.from(TABLE).select('*').eq('id', cfgId(area)).maybeSingle();
        if (error) console.warn('[품질] 설정 조회 실패:', error.message);
        rec = data ? data.data : null;
    } else rec = readLocal().find(x => x.id === cfgId(area)) || null;
    return { types: rec?.types?.length ? rec.types : def.types, target: Number.isFinite(Number(rec?.target)) && rec?.target !== '' && rec?.target != null ? Number(rec.target) : def.target };
};
export const saveDefectConfig = async (area, { types, target }) => {
    const data = { area, types: types.map(t => String(t).trim()).filter(Boolean), target: Number(target) || 0 };
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from(TABLE).upsert({ id: cfgId(area), kind: 'CFG', data, updated_at: new Date().toISOString(), created_by_name: me().name || '' }, { onConflict: 'id' });
        if (error) throw new Error(`설정을 저장하지 못했습니다: ${error.message}`);
        return;
    }
    const list = readLocal().filter(x => x.id !== cfgId(area));
    writeLocal([{ ...data, id: cfgId(area), kind: 'CFG' }, ...list]);
};

// ---------- 불량률 계산 ----------
export const rateOf = (defect, inspected) => (inspected > 0 ? (defect / inspected) * 100 : 0);
export const fmtRate = (r) => `${(Math.round(r * 100) / 100).toFixed(2)}%`;
export const fmtPpm = (defect, inspected) => (inspected > 0 ? Math.round((defect / inspected) * 1e6).toLocaleString('ko-KR') : '0');
const num = (v) => Number(v) || 0;

/** 검사 기록 하나의 불량수량 (유형별 수량 합이 있으면 그 값, 없으면 입력한 불량수량) */
export const defectQtyOf = (r) => {
    const sum = (r.defects || []).reduce((s, d) => s + num(d.qty), 0);
    return sum > 0 ? sum : num(r.defectQty);
};

/**
 * 기간 안의 검사 기록 요약
 * @returns { count, inspected, defect, rate, fail, cond, byMonth: [{ym, inspected, defect, rate}], byType: [{type, qty, share, cum}],
 *            byItem: [{key, name, inspected, defect, rate, count}], byGroup: [...] }
 */
export const summarize = (records, { groupKey } = {}) => {
    let inspected = 0, defect = 0, fail = 0, cond = 0;
    const months = new Map(), types = new Map(), items = new Map(), groups = new Map();
    const bump = (map, key, name, ins, def) => {
        const o = map.get(key) || { key, name, inspected: 0, defect: 0, count: 0 };
        o.inspected += ins; o.defect += def; o.count += 1;
        map.set(key, o);
    };
    records.forEach(r => {
        const ins = num(r.inspectedQty);
        const def = defectQtyOf(r);
        inspected += ins; defect += def;
        if (r.result === 'FAIL') fail += 1;
        if (r.result === 'COND') cond += 1;
        const ym = String(r.date || '').slice(0, 7);
        if (ym) bump(months, ym, ym, ins, def);
        (r.defects || []).forEach(d => { if (num(d.qty) > 0) types.set(d.type || '기타', (types.get(d.type || '기타') || 0) + num(d.qty)); });
        if (!(r.defects || []).some(d => num(d.qty) > 0) && def > 0) types.set('유형 미기재', (types.get('유형 미기재') || 0) + def);
        const ik = r.itemCode || r.itemName || '(품목 없음)';
        bump(items, ik, r.itemName || r.itemCode || '(품목 없음)', ins, def);
        if (groupKey) { const g = String(r[groupKey] || '').trim() || '(미기재)'; bump(groups, g, g, ins, def); }
    });
    const withRate = (o) => ({ ...o, rate: rateOf(o.defect, o.inspected) });
    const totalType = [...types.values()].reduce((s, v) => s + v, 0);
    let cum = 0;
    const byType = [...types.entries()].sort((a, b) => b[1] - a[1]).map(([type, qty]) => { cum += qty; return { type, qty, share: totalType ? (qty / totalType) * 100 : 0, cum: totalType ? (cum / totalType) * 100 : 0 }; });
    return {
        count: records.length, inspected, defect, rate: rateOf(defect, inspected), fail, cond,
        byMonth: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)).map(withRate),
        byType,
        byItem: [...items.values()].map(withRate).sort((a, b) => b.defect - a.defect || b.rate - a.rate),
        byGroup: [...groups.values()].map(withRate).sort((a, b) => b.defect - a.defect || b.rate - a.rate)
    };
};

/** 설비 다음 점검일 (마지막 점검일 + 주기 일수) */
export const nextCheckDate = (equip, logs = []) => {
    const cycle = num(equip.cycleDays);
    const last = logs.filter(l => l.equipId === equip.id && (l.logKind === 'CHECK' || l.logKind === 'PM' || l.logKind === 'CALIB')).map(l => l.date).sort().pop() || equip.lastCheck || equip.installDate || '';
    if (!cycle || !last) return '';
    const d = new Date(`${last}T00:00:00`);
    d.setDate(d.getDate() + cycle);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 오늘 기준 남은 일수 (지났으면 음수) */
export const daysUntil = (dateStr) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((new Date(`${dateStr}T00:00:00`) - t) / 86400000);
};

/** MSDS 다음 검토일: 입력값, 없으면 개정일 + 3년 (앱 기본값일 뿐이므로 회사 기준에 맞게 직접 입력) */
export const msdsReviewDate = (m) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(m.reviewDate || '')) return m.reviewDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.revDate || '')) return '';
    return `${Number(m.revDate.slice(0, 4)) + 3}${m.revDate.slice(4)}`;
};

/** 쓰기 권한: 기록 = 현장 작업자 이상, 설정 = 매니저 이상 (RLS 같은 규칙) */
const level = () => { const u = me(); return u.isMaster ? 5 : ({ ADMIN: 4, MANAGER: 3, OPERATOR: 2 }[u.role] || 0); };
export const canWriteQc = () => level() >= 2;
export const canConfigQc = () => level() >= 3;
export const canDeleteQc = (r) => level() >= 3 || (r.createdBy && (String(r.createdBy) === String(me().id) || String(r.createdBy) === String(me().username)));
