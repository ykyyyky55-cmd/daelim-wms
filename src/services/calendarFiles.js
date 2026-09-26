import { getSupabase, isSupabaseConfigured } from './supabase.js';

// 캘린더 일정 첨부 파일 (전표 사진·PDF 등)
// 클라우드: Supabase Storage 비공개 버킷 wms-calendar (supabase/auth/20_calendars.sql), 볼 때는 1시간짜리 서명 URL
// 로컬 모드: 2MB 이하 파일만 dataURL로 일정 안에 저장
const BUCKET = 'wms-calendar';
const MAX_CLOUD = 10 * 1024 * 1024;
const MAX_LOCAL = 2 * 1024 * 1024;

const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };

const readDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    r.readAsDataURL(file);
});

export const uploadCalendarFile = async (scheduleId, file) => {
    const sb = cloud();
    const base = { name: file.name, type: file.type || 'application/octet-stream', size: file.size };
    if (sb) {
        if (file.size > MAX_CLOUD) throw new Error(`${file.name}: 파일이 10MB를 넘습니다.`);
        const safe = file.name.replace(/[^\w.\-가-힣]/g, '_').slice(-80);
        const path = `${scheduleId}/${Date.now()}_${safe}`;
        const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: base.type, upsert: false });
        if (error) throw new Error(`${file.name}: 올리지 못했습니다 (${error.message})`);
        return { ...base, path };
    }
    if (file.size > MAX_LOCAL) throw new Error(`${file.name}: 로컬 모드에서는 2MB 이하 파일만 첨부할 수 있습니다.`);
    return { ...base, data: await readDataUrl(file) };
};

export const calendarFileUrl = async (att) => {
    if (att.data) return att.data;
    const sb = cloud();
    if (!sb || !att.path) return '';
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(att.path, 3600);
    if (error) throw new Error(`파일을 열지 못했습니다: ${error.message}`);
    return data.signedUrl;
};

export const deleteCalendarFile = async (att) => {
    const sb = cloud();
    if (sb && att.path) await sb.storage.from(BUCKET).remove([att.path]);
};
