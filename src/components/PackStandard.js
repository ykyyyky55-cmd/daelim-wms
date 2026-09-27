import { state } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { listPackStandards, getPackStandard, savePackStandard, deletePackStandard, packStandardLink } from '../services/packStandards.js';

// 생산업무 → 포장작업표준서 (탭 packStandard)
// 편집기는 public/pack-standard/index.html (원래 단독 HTML 편집기에 WMS 연동 스크립트를 붙인 것)을 iframe으로 띄운다.
// 같은 출처라 편집기가 window.parent.__packStdBridge 로 저장·불러오기·권한을 받는다. 편집(저장·삭제)은 매니저 이상(RLS 같은 규칙).
// QR·링크: ?std=<문서id>#packStandard → main.js가 window.__packStdOpenId 로 넘겨 그 문서를 연다.
export const renderPackStandard = (container, { showToast = () => {} } = {}) => {
    const canEdit = canPerformAction('EDIT_MASTER');
    window.__packStdBridge = {
        canEdit,
        userName: state.currentUser?.name || '',
        list: listPackStandards,
        get: getPackStandard,
        save: async (doc) => { if (!canEdit) throw new Error('표준서 저장은 자재 관리자 이상만 할 수 있습니다.'); return savePackStandard(doc); },
        remove: async (id) => { if (!canEdit) throw new Error('표준서 삭제는 자재 관리자 이상만 할 수 있습니다.'); return deletePackStandard(id); },
        link: packStandardLink,
        toast: (msg) => showToast(msg)
    };
    const openId = window.__packStdOpenId || '';
    window.__packStdOpenId = null;
    const src = `pack-standard/index.html${openId ? `?cloudId=${encodeURIComponent(openId)}` : ''}`;
    container.innerHTML = `
    <section class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-base font-black text-slate-900 flex items-center gap-2">📘 포장작업표준서
                <span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${canEdit ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}">${canEdit ? '편집 가능 (자재 관리자 이상)' : '열람 전용'}</span></h2>
            <span class="text-[11px] text-slate-500">표준서는 회사 DB에 저장되어 모든 PC·휴대폰에서 같은 내용을 봅니다. QR은 로그인한 사람만 열립니다.</span>
        </div>
        <iframe id="pack-std-frame" src="${src}" title="포장작업표준서" class="w-full bg-white rounded-2xl border border-slate-200 shadow-sm" style="height: calc(100vh - var(--header-h, 110px) - 90px); min-height: 640px;"></iframe>
    </section>`;
};
