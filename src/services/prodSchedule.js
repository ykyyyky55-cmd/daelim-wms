import { getSupabase, isSupabaseConfigured } from './supabase.js';

// 생산(포장) 스케줄표 (wms_production_schedule, supabase/auth/21_production_schedule.sql). 로컬 모드는 localStorage.
const LOCAL_KEY = 'daelim_prodSchedule';
const cloud = () => { const sb = getSupabase(); return sb && isSupabaseConfigured() ? sb : null; };
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; } };
const saveLocal = (list) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { /* 저장 불가 */ } };

export const PROD_STATUS = {
    HOLD: { label: '미정·보류', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
    PLANNED: { label: '생산 예정', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    PREP: { label: '부자재 준비', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    PRODUCING: { label: '생산중', cls: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
    DONE: { label: '완료·출고대기', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    SHIPPED: { label: '출고완료', cls: 'bg-slate-200 text-slate-500 border-slate-300' }
};
export const MATERIAL_KEYS = [
    ['raw', '원액'], ['container', '용기'], ['label', '라벨'], ['inbox', '인박스'], ['outbox', '아웃박스'], ['safetyCap', '안전캡'], ['paperCap', '종이캡']
];

const d = (v) => v || null;
export const fromRow = (r) => ({
    id: r.id, site: r.site || '본사', line: r.line || '', status: r.status || 'PLANNED',
    orderDate: r.order_date || '', dueText: r.due_text || '', dueDate: r.due_date || '', planText: r.plan_text || '', planDate: r.plan_date || '',
    partner: r.partner || '', manager: r.manager || '', itemCode: r.item_code || '', itemName: r.item_name || '', spec: r.spec || '',
    qty: r.qty === null || r.qty === undefined ? '' : Number(r.qty), perBox: r.per_box === null || r.per_box === undefined ? '' : Number(r.per_box),
    container: r.container || '', materials: r.materials || {}, matsDone: !!r.mats_done,
    prodStart: r.prod_start || '', prodEnd: r.prod_end || '', lotNo: r.lot_no || '', shipDate: r.ship_date || '', notes: r.notes || '',
    sort: r.sort_order || 0, updatedAt: r.updated_at
});
const toRow = (x) => ({
    id: x.id, site: x.site || '본사', line: x.line || null, status: x.status || 'PLANNED',
    order_date: d(x.orderDate), due_text: x.dueText || null, due_date: d(x.dueDate), plan_text: x.planText || null, plan_date: d(x.planDate),
    partner: x.partner || null, manager: x.manager || null, item_code: x.itemCode || null, item_name: String(x.itemName || '').trim(), spec: x.spec || null,
    qty: x.qty === '' || x.qty === null ? null : Number(x.qty), per_box: x.perBox === '' || x.perBox === null ? null : Number(x.perBox),
    container: x.container || null, materials: x.materials || {}, mats_done: !!x.matsDone,
    prod_start: d(x.prodStart), prod_end: d(x.prodEnd), lot_no: x.lotNo || null, ship_date: d(x.shipDate), notes: x.notes || null,
    sort_order: Number(x.sort) || 0, updated_at: new Date().toISOString()
});

export const newProdId = () => `PS-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

export const listProdSchedule = async () => {
    const sb = cloud();
    if (sb) {
        const { data, error } = await sb.from('wms_production_schedule').select('*').order('sort_order').order('created_at');
        if (error) throw new Error(`생산 스케줄을 불러오지 못했습니다: ${error.message}`);
        return (data || []).map(fromRow);
    }
    return loadLocal().map(fromRow);
};

export const saveProdRows = async (list) => {
    const rows = list.map(x => toRow({ ...x, id: x.id || newProdId() }));
    if (rows.some(r => !r.item_name)) throw new Error('품명을 입력하세요.');
    const sb = cloud();
    if (sb) {
        for (let i = 0; i < rows.length; i += 200) {
            const { error } = await sb.from('wms_production_schedule').upsert(rows.slice(i, i + 200), { onConflict: 'id' });
            if (error) throw new Error(`생산 스케줄을 저장하지 못했습니다: ${error.message}`);
        }
        return rows.map(fromRow);
    }
    const local = loadLocal();
    rows.forEach(r => { const i = local.findIndex(x => x.id === r.id); if (i >= 0) local[i] = r; else local.push(r); });
    saveLocal(local);
    return rows.map(fromRow);
};

export const deleteProdRow = async (id) => {
    const sb = cloud();
    if (sb) {
        const { error } = await sb.from('wms_production_schedule').delete().eq('id', id);
        if (error) throw new Error(`삭제하지 못했습니다: ${error.message}`);
        return;
    }
    saveLocal(loadLocal().filter(x => x.id !== id));
};
