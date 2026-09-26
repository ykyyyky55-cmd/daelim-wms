import { getSupabase, isSupabaseConfigured } from './supabase.js';

// 라벨 만들기 양식 저장소.
// 클라우드 모드: wms_label_templates (supabase/auth/17_label_templates.sql), 로컬 모드: localStorage.
// 양식 = { id, name, category, paper, elements }
//  - paper: { code, sheetW, sheetH, across, down, left, top, gapX, gapY, w, h, shape, radius }  (mm)
//  - elements: [{ id, type, x, y, w, h, rotate, ...속성 }]  (mm, 라벨 왼쪽 위 기준)
const LOCAL_KEY = 'daelim_labelTemplates';

const cloud = () => {
    const sb = getSupabase();
    return sb && isSupabaseConfigured() ? sb : null;
};

const fromRow = (r) => ({
    id: r.id, name: r.name, category: r.category || '', paper: r.paper || {}, elements: Array.isArray(r.elements) ? r.elements : [],
    createdAt: r.created_at, updatedAt: r.updated_at
});

const loadLocal = () => {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; }
};
const saveLocal = (list) => {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch (e) {
        throw new Error(`브라우저 저장 공간이 부족합니다. 큰 이미지를 줄여 주세요. (${e.message})`);
    }
};

export const listLabelTemplates = async () => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_label_templates').select('*').order('category').order('name');
        if (error) throw new Error(`라벨 양식을 불러오지 못했습니다: ${error.message}`);
        return (data || []).map(fromRow);
    }
    return loadLocal().sort((a, b) => (a.category || '').localeCompare(b.category || '', 'ko') || a.name.localeCompare(b.name, 'ko'));
};

export const saveLabelTemplate = async (tpl) => {
    const x = {
        ...tpl,
        id: tpl.id || `LBT-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        name: String(tpl.name || '').trim() || '이름 없는 양식',
        category: String(tpl.category || '').trim(),
        updatedAt: new Date().toISOString()
    };
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_label_templates').upsert({
            id: x.id, name: x.name, category: x.category || null, paper: x.paper, elements: x.elements, updated_at: x.updatedAt
        }, { onConflict: 'id' }).select('*').single();
        if (error) throw new Error(`라벨 양식을 저장하지 못했습니다: ${error.message}`);
        return fromRow(data);
    }
    const list = loadLocal();
    const i = list.findIndex(t => t.id === x.id);
    if (i >= 0) list[i] = x; else list.push({ ...x, createdAt: x.updatedAt });
    saveLocal(list);
    return x;
};

export const deleteLabelTemplate = async (id) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_label_templates').delete().eq('id', id);
        if (error) throw new Error(`라벨 양식을 삭제하지 못했습니다: ${error.message}`);
        return;
    }
    saveLocal(loadLocal().filter(t => t.id !== id));
};
