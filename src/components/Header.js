import { state } from '../services/db.js';
import { isSupabaseConfigured } from '../services/supabase.js';

export const renderHeader = (container, { onTabChange, onOpenModal, onWorkerChange }) => {
    const isConnected = isSupabaseConfigured();
    const currentUser = state.currentUser || { name: '관리자', role: 'ADMIN' };

    container.innerHTML = `
    <header class="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm no-print">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl shadow-md border border-slate-200 overflow-hidden bg-gradient-to-tr from-blue-600 to-indigo-700 flex items-center justify-center text-white font-black text-lg">
                    DO
                </div>
                <div>
                    <div class="flex items-center gap-2">
                        <h1 class="text-base font-extrabold tracking-tight text-slate-900">DAELIMOIL SMART WMS</h1>
                        <span class="px-2 py-0.5 text-[10px] font-black bg-orange-100 text-orange-800 rounded-full border border-orange-200">PRO</span>
                        <span id="supabase-status-badge" class="cursor-pointer px-2 py-0.5 text-[10px] font-bold rounded-full border transition flex items-center gap-1 ${
                            isConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-amber-50 text-amber-700 border-amber-300'
                        }">
                            <span class="w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}"></span>
                            <span>${isConnected ? 'Supabase 실시간 연결됨' : '오프라인/로컬 모드'}</span>
                        </span>
                    </div>
                    <p class="text-xs text-slate-500 hidden sm:block">대림오일 스마트 자재·재고·수불 관리 시스템 (Cloud Realtime)</p>
                </div>
            </div>

            <!-- 상단 툴바 액션 버튼 그룹 -->
            <div class="flex items-center flex-wrap gap-1.5 sm:gap-2">
                <button type="button" id="btn-supabase-modal" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm">
                    <i data-lucide="database" class="w-3.5 h-3.5"></i>
                    <span>클라우드 DB 설정</span>
                </button>

                <div class="flex items-center bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 shadow-xs text-xs">
                    <i data-lucide="user-check" class="w-3.5 h-3.5 text-blue-600 mr-1.5"></i>
                    <span class="text-[11px] font-bold text-slate-500 hidden sm:inline mr-1">현재 작업자:</span>
                    <select id="global-worker-select" class="bg-transparent border-none text-xs font-bold text-slate-800 focus:outline-none cursor-pointer">
                        ${state.workers.map(w => `<option value="${w.name}" ${state.currentGlobalWorker.includes(w.name) ? 'selected' : ''}>${w.name} (${w.role || w.dept})</option>`).join('')}
                    </select>
                </div>

                <div id="auth-profile-badge" class="flex items-center gap-1.5 bg-slate-900 text-white rounded-lg px-2.5 py-1 text-xs shadow-xs">
                    <i data-lucide="shield-check" class="w-3.5 h-3.5 text-emerald-400"></i>
                    <span id="auth-user-name" class="font-bold">${currentUser.name}</span>
                    <span id="auth-user-role-badge" class="px-1.5 py-0.2 rounded text-[10px] font-black bg-blue-600 text-white">${currentUser.role || 'ADMIN'}</span>
                </div>

                <button type="button" id="btn-user-mgmt" class="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"><i data-lucide="users" class="w-3.5 h-3.5"></i><span>권한/계정</span></button>
                <button type="button" id="btn-worker-mgmt" class="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"><i data-lucide="user-plus" class="w-3.5 h-3.5"></i><span>작업자</span></button>
                <button type="button" id="btn-excel-mgmt" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"><i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i><span>엑셀 등록</span></button>
                <button type="button" id="btn-transfer-slip" class="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"><i data-lucide="file-signature" class="w-3.5 h-3.5"></i><span>전표 발행</span></button>
                <button type="button" id="btn-category-mgmt" class="px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"><i data-lucide="tag" class="w-3.5 h-3.5"></i><span>분류</span></button>
                <button type="button" id="btn-location-mgmt" class="px-2.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"><i data-lucide="map-pin" class="w-3.5 h-3.5"></i><span>거점</span></button>
                <button type="button" id="btn-backup-mgmt" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"><i data-lucide="archive" class="w-3.5 h-3.5"></i><span>백업/복원</span></button>
            </div>
        </div>

        <!-- 탭 메뉴 네비게이션 -->
        <div class="max-w-7xl mx-auto px-4 sm:px-6 flex overflow-x-auto gap-2 sm:gap-6 border-t border-slate-100 scrollbar-none text-xs sm:text-sm">
            <button type="button" data-tab="home" class="tab-btn active py-3 px-2 border-b-2 border-blue-600 text-blue-600 font-bold flex items-center gap-2 whitespace-nowrap transition"><i data-lucide="home" class="w-4 h-4"></i><span>홈 (대시보드)</span></button>
            <button type="button" data-tab="scan" class="tab-btn py-3 px-2 border-b-2 border-transparent text-slate-600 hover:text-blue-600 flex items-center gap-2 whitespace-nowrap transition"><i data-lucide="scan-line" class="w-4 h-4"></i><span>현장 스캔 / 작업</span></button>
            <button type="button" data-tab="label" class="tab-btn py-3 px-2 border-b-2 border-transparent text-slate-600 hover:text-blue-600 flex items-center gap-2 whitespace-nowrap transition"><i data-lucide="qr-code" class="w-4 h-4"></i><span>QR 생성 / 라벨발행</span></button>
            <button type="button" data-tab="master" class="tab-btn py-3 px-2 border-b-2 border-transparent text-slate-600 hover:text-blue-600 flex items-center gap-2 whitespace-nowrap transition"><i data-lucide="layout-grid" class="w-4 h-4"></i><span>품목 마스터 관리</span></button>
            <button type="button" data-tab="inventory" class="tab-btn py-3 px-2 border-b-2 border-transparent text-slate-600 hover:text-blue-600 flex items-center gap-2 whitespace-nowrap transition"><i data-lucide="database" class="w-4 h-4"></i><span>창고 재고 현황</span></button>
            <button type="button" data-tab="audit" class="tab-btn py-3 px-2 border-b-2 border-transparent text-slate-600 hover:text-blue-600 flex items-center gap-2 whitespace-nowrap transition"><i data-lucide="clipboard-check" class="w-4 h-4 text-teal-600"></i><span class="font-bold text-teal-700">재고실사 / 조사</span></button>
            <button type="button" data-tab="ledger" class="tab-btn py-3 px-2 border-b-2 border-transparent text-slate-600 hover:text-blue-600 flex items-center gap-2 whitespace-nowrap transition"><i data-lucide="book-open-check" class="w-4 h-4"></i><span>자재 수불부</span></button>
            <button type="button" data-tab="calendar" class="tab-btn py-3 px-2 border-b-2 border-transparent text-slate-600 hover:text-blue-600 flex items-center gap-2 whitespace-nowrap transition"><i data-lucide="calendar" class="w-4 h-4 text-indigo-600"></i><span>수불·입출고 캘린더</span></button>
            <button type="button" data-tab="analytics" class="tab-btn py-3 px-2 border-b-2 border-transparent text-slate-600 hover:text-blue-600 flex items-center gap-2 whitespace-nowrap transition"><i data-lucide="bar-chart-3" class="w-4 h-4 text-emerald-600"></i><span class="font-bold text-emerald-700">월간 실적 현황판</span></button>
            <button type="button" data-tab="planning" class="tab-btn py-3 px-2 border-b-2 border-transparent text-slate-600 hover:text-blue-600 flex items-center gap-2 whitespace-nowrap transition"><i data-lucide="calculator" class="w-4 h-4 text-violet-600"></i><span class="font-bold text-violet-700">발주·생산 검토</span></button>
            <button type="button" data-tab="history" class="tab-btn py-3 px-2 border-b-2 border-transparent text-slate-600 hover:text-blue-600 flex items-center gap-2 whitespace-nowrap transition"><i data-lucide="history" class="w-4 h-4"></i><span>작업 이력 (Audit Log)</span></button>
        </div>
    </header>
    `;

    // 이벤트 리스너 바인딩
    container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            container.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.remove('active', 'border-blue-600', 'text-blue-600', 'font-bold');
                b.classList.add('border-transparent', 'text-slate-600');
            });
            btn.classList.add('active', 'border-blue-600', 'text-blue-600', 'font-bold');
            btn.classList.remove('border-transparent', 'text-slate-600');
            onTabChange(tabId);
        });
    });

    container.querySelector('#global-worker-select')?.addEventListener('change', (e) => {
        onWorkerChange(e.target.value);
    });

    container.querySelector('#supabase-status-badge')?.addEventListener('click', () => onOpenModal('supabase'));
    container.querySelector('#btn-supabase-modal')?.addEventListener('click', () => onOpenModal('supabase'));
    container.querySelector('#btn-user-mgmt')?.addEventListener('click', () => onOpenModal('user'));
    container.querySelector('#btn-worker-mgmt')?.addEventListener('click', () => onOpenModal('worker'));
    container.querySelector('#btn-excel-mgmt')?.addEventListener('click', () => onOpenModal('excel'));
    container.querySelector('#btn-transfer-slip')?.addEventListener('click', () => onOpenModal('slip'));
    container.querySelector('#btn-category-mgmt')?.addEventListener('click', () => onOpenModal('category'));
    container.querySelector('#btn-location-mgmt')?.addEventListener('click', () => onOpenModal('location'));
    container.querySelector('#btn-backup-mgmt')?.addEventListener('click', () => onOpenModal('backup'));
};
