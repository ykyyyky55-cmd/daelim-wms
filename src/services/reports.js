// ==========================================
// 월간 실적 현황판 → 보고서 (supabase/auth/39_reports.sql)
// ==========================================
// - wms_reports 한 줄 = 보고서 하나. MEETING(월례회의 자료: PPT·PDF 보고서 파일) / DOC(검토 보고서: 본문 HTML)
// - 파일은 비공개 버킷 wms-files 의 reports/<보고서 id>/… (서명 URL로 열기·내려받기). 같은 종류 파일은 새 파일로 바꾼다.
// - 로컬 모드: localStorage(daelim_reports)에 dataURL로 (파일 3MB 이하만)
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { state } from './db.js';
import { storageSafeName, storageSafeSegment } from './storageKey.js';
import { fileUrl } from './fileStore.js';

const BUCKET = 'wms-files';
const LOCAL_KEY = 'daelim_reports';
const MAX_LOCAL_FILE = 3 * 1024 * 1024;
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const writeLocal = (v) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch { throw new Error('이 기기의 저장 공간이 부족합니다 (로컬 모드는 보고서 파일을 브라우저에 저장합니다).'); } };
const myName = () => state.currentUser?.name || state.currentGlobalWorker || '';
const readDataUrl = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('파일을 읽지 못했습니다.')); r.readAsDataURL(blob); });

// OVERVIEW: 종합현황 월간 보고서 (services/monthlyReport.js, 본문 HTML — 검토 보고서처럼 열람·인쇄)
// QMEETING: 품질회의 자료 (월간 실적 현황판 → 품질회의, components/QualityMeeting.js — 올린 PDF 등 파일, 보고서 메뉴에는 안 보임)
export const REPORT_KINDS = { MEETING: '월례회의 자료', OVERVIEW: '종합현황 월간 보고서', DOC: '검토 보고서', QMEETING: '품질회의 자료' };
export const FILE_TYPE_LABEL = { pptx: 'PPT', html: 'PDF 보고서' };

const fromRow = (r) => ({ id: r.id, kind: r.kind, title: r.title || '', period: r.period || '', scope: r.scope || '', summary: r.summary || '', content: r.content || {}, files: r.files || [], createdByName: r.created_by_name || '', createdAt: r.created_at, updatedByName: r.updated_by_name || '', updatedAt: r.updated_at });
const fail = (error, what) => {
    const msg = error?.message || String(error);
    if (/row-level security|permission denied/i.test(msg)) throw new Error(`${what} 권한이 없습니다 (매니저 이상).`);
    if (/wms_reports/.test(msg) && /exist/.test(msg)) throw new Error(`${what} 실패: 보고서 DB 설정(39_reports.sql)이 적용되지 않았습니다.`);
    throw new Error(`${what} 실패: ${msg}`);
};

// 목록 (본문·파일 정보 포함, DOC 본문은 크지 않다). kind를 주면 그 종류만
export const listReports = async ({ kind = '' } = {}) => {
    const sb = cloud();
    if (sb) {
        let query = sb.from('wms_reports').select('*');
        if (kind) query = query.eq('kind', kind);
        const { data, error } = await query.order('period', { ascending: false }).order('updated_at', { ascending: false });
        if (error) fail(error, '보고서 조회');
        return (data || []).map(fromRow);
    }
    return readLocal().map(fromRow).filter(r => !kind || r.kind === kind).sort((a, b) => String(b.period).localeCompare(String(a.period)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
};

/**
 * 보고서 저장 (같은 id면 덮어씀). newFiles = [{ blob, name, type: 'pptx'|'html' }] → 같은 type의 예전 파일은 바꾼다.
 */
export const saveReport = async ({ id, kind, title, period = '', scope = '', summary = '', content = {} }, newFiles = []) => {
    const now = new Date().toISOString();
    const sb = cloud();
    if (sb) {
        const { data: old } = await sb.from('wms_reports').select('files, created_by_name, created_at').eq('id', id).maybeSingle();
        const oldFiles = old?.files || [];
        const added = [];
        try {
            for (const f of newFiles) {
                const path = `reports/${storageSafeSegment(id)}/${Date.now()}_${storageSafeName(f.name)}`;
                const { error } = await sb.storage.from(BUCKET).upload(path, f.blob, { contentType: f.blob.type || 'application/octet-stream', upsert: false });
                if (error) throw new Error(`${f.name}: 올리지 못했습니다 (${error.message})`);
                added.push({ path, name: f.name, mime: f.blob.type || '', size: f.blob.size, type: f.type, at: now, by: myName() });
            }
            const replaced = new Set(newFiles.map(f => f.type));
            const files = [...oldFiles.filter(x => !replaced.has(x.type)), ...added];
            const row = { id, kind, title, period, scope, summary, content, files, updated_by_name: myName(), updated_at: now, ...(old ? {} : { created_by_name: myName() }) };
            const { data, error } = await sb.from('wms_reports').upsert(row, { onConflict: 'id' }).select().single();
            if (error) fail(error, '보고서 저장');
            const gone = oldFiles.filter(x => replaced.has(x.type)).map(x => x.path).filter(Boolean);
            if (gone.length) await sb.storage.from(BUCKET).remove(gone);
            return fromRow(data);
        } catch (e) {
            if (added.length) await sb.storage.from(BUCKET).remove(added.map(f => f.path));
            throw e;
        }
    }
    const rows = readLocal();
    const i = rows.findIndex(r => r.id === id);
    const oldFiles = i >= 0 ? rows[i].files || [] : [];
    const added = [];
    for (const f of newFiles) {
        if (f.blob.size > MAX_LOCAL_FILE) continue; // 로컬 모드는 큰 파일을 보관하지 않음
        added.push({ id: `${id}-${f.type}`, name: f.name, mime: f.blob.type || '', size: f.blob.size, type: f.type, data: await readDataUrl(f.blob), at: now, by: myName() });
    }
    const replaced = new Set(added.map(f => f.type));
    const row = { id, kind, title, period, scope, summary, content, files: [...oldFiles.filter(x => !replaced.has(x.type)), ...added], created_by_name: i >= 0 ? rows[i].created_by_name : myName(), created_at: i >= 0 ? rows[i].created_at : now, updated_by_name: myName(), updated_at: now };
    if (i >= 0) rows[i] = row; else rows.push(row);
    writeLocal(rows);
    return fromRow(row);
};

export const deleteReport = async (rep) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_reports').delete().eq('id', rep.id);
        if (error) fail(error, '보고서 삭제');
        const paths = (rep.files || []).map(f => f.path).filter(Boolean);
        if (paths.length) await sb.storage.from(BUCKET).remove(paths);
        return;
    }
    writeLocal(readLocal().filter(r => r.id !== rep.id));
};

// 파일 주소 (클라우드 = 서명 URL, 로컬 = dataURL)
export const reportFileUrl = async (f) => (f.data ? f.data : fileUrl(f));
