import { state } from '../services/db.js';
import { canPerformAction, isCloudAuth } from '../services/auth.js';
import { getSupabase } from '../services/supabase.js';

// 생산관리 → 환경관리(대기) (탭 envAir)
// 대기배출시설 및 방지시설 운영기록부. 원래 따로 있던 앱(daelim-air)의 화면(public/air/)을 iframe으로 띄운다.
// 같은 출처라 그 화면이 window.parent.__airBridge 로 WMS가 로그인해 둔 Supabase 클라이언트와 권한을 받는다(public/air/supabaseClient.js).
// 기록은 WMS DB의 wms_air_records(하루 한 줄)에 있다. 조회는 모두, 저장은 매니저 이상(RLS 80번과 같은 규칙).
// 로컬(오프라인) 모드에서는 클라이언트가 없어 이 기기의 브라우저 저장소에만 저장한다.
const AIR_APP_URL = 'air/index.html';

export const renderAirRecords = (container) => {
    const isCloud = isCloudAuth();
    const canEdit = canPerformAction('MRP_PLANNING');
    window.__airBridge = {
        client: isCloud ? getSupabase() : null,
        canEdit,
        userName: state.currentUser?.name || ''
    };
    const badge = !isCloud
        ? '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">로컬 모드 — 이 기기에만 저장</span>'
        : `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${canEdit ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}">${canEdit ? '작성 가능 (매니저 이상)' : '열람 전용'}</span>`;
    container.innerHTML = `
    <section class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-base font-black text-slate-900 flex items-center gap-2">🌬️ 환경관리(대기) ${badge}</h2>
            <span class="text-[11px] text-slate-500">대기배출시설 및 방지시설 운영기록부 — 기록은 회사 DB에 저장되어 모든 PC에서 같은 내용을 봅니다.</span>
        </div>
        <iframe id="air-frame" src="${AIR_APP_URL}" title="대기배출시설 및 방지시설 운영기록부" class="w-full bg-white rounded-2xl border border-slate-200 shadow-sm" style="height: calc(100vh - var(--header-h, 110px) - 90px); min-height: 640px;"></iframe>
    </section>`;
};
