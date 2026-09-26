import { 
    state, 
    addCategory, 
    deleteCategory, 
    addSite,
    addBuilding,
    deleteLocation,
    addPartner, 
    deletePartner, 
    saveWorker,
    deleteWorker,
    saveDashboardSettings,
    restoreAllData,
    clearCloudDataCache,
    syncAllLocalDataToSupabase
} from '../services/db.js';
import { localDateStr } from '../services/searchUtils.js';
import { DEFAULT_SITES, sitesOf, buildingsOf, siteOf, makeLocation, locationLabel } from '../services/locations.js';
import { getSupabaseConfig, saveSupabaseConfig, testSupabaseConnection, isSupabaseConfigured } from '../services/supabase.js';
import { updateUserRole, ROLE_INFO, listProfiles, assignableRoles, canManageUser, transferMaster, isCloudAuth, initAuth, setWorklogManager } from '../services/auth.js';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ROLE_SELECT_STYLE = {
    ADMIN: 'text-rose-700 bg-rose-50/70 border-rose-300',
    MANAGER: 'text-blue-700 bg-blue-50/70 border-blue-300',
    OPERATOR: 'text-amber-700 bg-amber-50/70 border-amber-300',
    VIEWER: 'text-slate-700 bg-slate-50 border-slate-300',
    PENDING: 'text-yellow-800 bg-yellow-50 border-yellow-300'
};
import QRCode from 'qrcode';
import { esc } from '../services/html.js';

export const renderSettingsManager = (container, { showToast, onRefresh, onOpenModal }) => {
    let activeSettingsSection = 'display'; // display, accounts, master, cloud

    const render = () => {
        const currentTheme = localStorage.getItem('daelim_theme') || 'light';
        const isConnected = isSupabaseConfigured();
        const cfg = getSupabaseConfig();
        const settings = state.dashboardSettings || {};

        container.innerHTML = `
        <section id="tab-content-settings" class="space-y-6">
            <!-- 환경설정 타이틀 배너 -->
            <div class="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-5 sm:p-6 rounded-3xl shadow-lg border border-slate-700/60 flex flex-wrap items-center justify-between gap-4">
                <div class="space-y-1">
                    <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-500/20 text-blue-300 border border-blue-400/30">시스템 통합 제어 센터</span>
                        <span class="text-xs text-slate-400 font-mono">Daelim WMS Preferences</span>
                    </div>
                    <h2 class="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2.5">
                        <i data-lucide="settings" class="w-6 h-6 text-blue-400"></i>
                        <span>통합 환경설정 (Settings Hub)</span>
                    </h2>
                    <p class="text-xs text-slate-300">화면 테마, 대시보드 위젯, 계정/작업자 권한, 마스터 기준정보, 클라우드 DB 및 백업을 한곳에서 안전하게 관리합니다.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-export-backup-quick" class="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-white/20">
                        <i data-lucide="download" class="w-4 h-4 text-emerald-400"></i>
                        <span>원클릭 JSON 백업</span>
                    </button>
                </div>
            </div>

            <!-- 설정 내비게이션 탭 -->
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-1.5 flex flex-wrap gap-1 text-xs font-bold">
                <button type="button" data-sec="display" class="sec-btn flex-1 py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition ${activeSettingsSection === 'display' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}">
                    <i data-lucide="palette" class="w-4 h-4"></i>
                    <span>화면 & 테마 & 대시보드</span>
                </button>
                <button type="button" data-sec="accounts" class="sec-btn flex-1 py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition ${activeSettingsSection === 'accounts' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}">
                    <i data-lucide="users" class="w-4 h-4"></i>
                    <span>계정 & 권한 & 작업자</span>
                </button>
                <button type="button" data-sec="master" class="sec-btn flex-1 py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition ${activeSettingsSection === 'master' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}">
                    <i data-lucide="layers" class="w-4 h-4"></i>
                    <span>마스터 기준정보 설정</span>
                </button>
                <button type="button" data-sec="cloud" class="sec-btn flex-1 py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition ${activeSettingsSection === 'cloud' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}">
                    <i data-lucide="cloud" class="w-4 h-4"></i>
                    <span>클라우드 DB & 데이터 백업</span>
                </button>
            </div>

            <!-- 활성화된 설정 섹션 컨텐츠 -->
            <div id="settings-section-container" class="space-y-6">
                <!-- 하위 렌더 함수에서 동적 삽입 -->
            </div>
        </section>
        `;

        // 탭 전환 이벤트
        container.querySelectorAll('.sec-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeSettingsSection = btn.getAttribute('data-sec');
                render();
            });
        });

        // 퀵 백업 다운로드
        container.querySelector('#btn-export-backup-quick')?.addEventListener('click', () => {
            downloadJsonBackup();
        });

        renderActiveSection();
    };

    const renderActiveSection = () => {
        const secContainer = container.querySelector('#settings-section-container');
        if (!secContainer) return;

        if (activeSettingsSection === 'display') {
            renderDisplaySection(secContainer);
        } else if (activeSettingsSection === 'accounts') {
            renderAccountsSection(secContainer);
        } else if (activeSettingsSection === 'master') {
            renderMasterSection(secContainer);
        } else if (activeSettingsSection === 'cloud') {
            renderCloudSection(secContainer);
        }
    };

    // ----------------------------------------------------
    // 1. 화면 & 테마 & 대시보드 섹션
    // ----------------------------------------------------
    const renderDisplaySection = (target) => {
        const currentTheme = localStorage.getItem('daelim_theme') || 'light';
        const s = state.dashboardSettings || {};

        target.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- 테마 선택 카드 -->
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3">
                    <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                        <i data-lucide="sun-moon" class="w-4 h-4 text-blue-600"></i>
                        <span>배경화면 테마 모드 선택</span>
                    </h3>
                    <p class="text-xs text-slate-500 mt-0.5">작업 환경(야간/현장 조명/사무실)에 맞춰 최적의 화면 대비를 선택하세요.</p>
                </div>

                <div class="grid grid-cols-3 gap-3">
                    <label class="cursor-pointer border-2 rounded-2xl p-3.5 flex flex-col items-center justify-between text-center gap-2 transition ${currentTheme === 'light' ? 'border-blue-600 bg-blue-50/50 shadow-sm' : 'border-slate-200 hover:bg-slate-50'}">
                        <input type="radio" name="setting-theme" value="light" class="sr-only" ${currentTheme === 'light' ? 'checked' : ''} />
                        <span class="text-2xl">☀️</span>
                        <div>
                            <div class="font-bold text-xs text-slate-900">라이트 모드</div>
                            <div class="text-[10px] text-slate-500">기본 밝은 테마</div>
                        </div>
                    </label>

                    <label class="cursor-pointer border-2 rounded-2xl p-3.5 flex flex-col items-center justify-between text-center gap-2 transition ${currentTheme === 'dark' ? 'border-blue-600 bg-blue-50/50 shadow-sm' : 'border-slate-200 hover:bg-slate-50'}">
                        <input type="radio" name="setting-theme" value="dark" class="sr-only" ${currentTheme === 'dark' ? 'checked' : ''} />
                        <span class="text-2xl">🌙</span>
                        <div>
                            <div class="font-bold text-xs text-slate-900">다크 모드</div>
                            <div class="text-[10px] text-slate-500">야간/고대비 절전</div>
                        </div>
                    </label>

                    <label class="cursor-pointer border-2 rounded-2xl p-3.5 flex flex-col items-center justify-between text-center gap-2 transition ${currentTheme === 'warm' ? 'border-blue-600 bg-blue-50/50 shadow-sm' : 'border-slate-200 hover:bg-slate-50'}">
                        <input type="radio" name="setting-theme" value="warm" class="sr-only" ${currentTheme === 'warm' ? 'checked' : ''} />
                        <span class="text-2xl">🌿</span>
                        <div>
                            <div class="font-bold text-xs text-slate-900">눈 편한 모드</div>
                            <div class="text-[10px] text-slate-500">아이케어 웜톤</div>
                        </div>
                    </label>
                </div>
            </div>

            <!-- PWA 앱 설치 및 모바일 연동 카드 -->
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3 flex justify-between items-center">
                    <div>
                        <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                            <i data-lucide="smartphone" class="w-4 h-4 text-indigo-600"></i>
                            <span>모바일 현장 접속 & 앱 설치 (PWA)</span>
                        </h3>
                        <p class="text-xs text-slate-500 mt-0.5">스마트폰 카메라로 스캔하여 바로 현장 모바일 앱으로 사용할 수 있습니다.</p>
                    </div>
                    <button type="button" id="btn-trigger-pwa-setting" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs">
                        앱 설치 실행
                    </button>
                </div>

                <div class="flex items-center gap-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <div id="settings-pwa-qr" class="w-20 h-20 bg-white p-1 rounded-lg border border-slate-300 flex items-center justify-center"></div>
                    <div class="text-xs space-y-1 text-slate-700">
                        <div class="font-bold text-slate-900">현장 모바일 간편 스캐너 지원</div>
                        <div class="text-[11px] text-slate-500">와이파이나 네트워크가 연결된 스마트폰으로 접속하면 카메라를 통해 바코드/QR을 실시간 스캔할 수 있습니다.</div>
                    </div>
                </div>
            </div>

            <!-- 대시보드 위젯 On/Off 제어 카드 -->
            <div class="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3 flex justify-between items-center">
                    <div>
                        <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                            <i data-lucide="layout" class="w-4 h-4 text-emerald-600"></i>
                            <span>대시보드 위젯 표시 및 갱신 설정</span>
                        </h3>
                        <p class="text-xs text-slate-500 mt-0.5">홈 대시보드 화면에 노출할 위젯과 자동 갱신 주기를 맞춤 설정합니다.</p>
                    </div>
                    <button type="button" id="btn-save-dash-settings" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm flex items-center gap-1.5">
                        <i data-lucide="check" class="w-3.5 h-3.5"></i>
                        <span>위젯 설정 저장</span>
                    </button>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                    <label class="flex items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer">
                        <input type="checkbox" id="set-show-kpi" class="w-4 h-4 text-blue-600 rounded" ${s.showKpi !== false ? 'checked' : ''} />
                        <span class="font-bold text-slate-800">상단 KPI 요약 카드 (총품목, 안전재고 등)</span>
                    </label>

                    <label class="flex items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer">
                        <input type="checkbox" id="set-show-qr" class="w-4 h-4 text-blue-600 rounded" ${s.showQrWidget !== false ? 'checked' : ''} />
                        <span class="font-bold text-slate-800">모바일 QR 현장 작업창</span>
                    </label>

                    <label class="flex items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer">
                        <input type="checkbox" id="set-show-quick" class="w-4 h-4 text-blue-600 rounded" ${s.showQuickAction !== false ? 'checked' : ''} />
                        <span class="font-bold text-slate-800">빠른 입고 / 출고 / 이동 작업 패널</span>
                    </label>

                    <label class="flex items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer">
                        <input type="checkbox" id="set-show-safety" class="w-4 h-4 text-blue-600 rounded" ${s.showLowSafety !== false ? 'checked' : ''} />
                        <span class="font-bold text-slate-800">안전재고 부족 긴급 경보 위젯</span>
                    </label>

                    <label class="flex items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer">
                        <input type="checkbox" id="set-show-history" class="w-4 h-4 text-blue-600 rounded" ${s.showHistory !== false ? 'checked' : ''} />
                        <span class="font-bold text-slate-800">최근 입출고 감사 로그 위젯</span>
                    </label>

                    <label class="flex items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer">
                        <input type="checkbox" id="set-show-oil" class="w-4 h-4 text-blue-600 rounded" ${s.showOilCalc !== false ? 'checked' : ''} />
                        <span class="font-bold text-slate-800">비중 / 온도보정 계산기 위젯</span>
                    </label>

                    <label class="flex items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer">
                        <input type="checkbox" id="set-show-calendar" class="w-4 h-4 text-blue-600 rounded" ${s.showCalendarWidget !== false ? 'checked' : ''} />
                        <span class="font-bold text-slate-800">수불·입출고 & 작업 일정 캘린더 위젯</span>
                    </label>
                </div>
            </div>
        </div>
        `;

        // 테마 선택 이벤트
        target.querySelectorAll('input[name="setting-theme"]').forEach(r => {
            r.addEventListener('change', (e) => {
                const val = e.target.value;
                document.documentElement.setAttribute('data-theme', val);
                document.body.setAttribute('data-theme', val);
                localStorage.setItem('daelim_theme', val);
                showToast(`테마가 '${val === 'dark' ? '다크 모드' : val === 'warm' ? '눈 편한 모드' : '라이트 모드'}'(으)로 변경되었습니다.`);
                render();
            });
        });

        // PWA QR 생성
        const qrBox = target.querySelector('#settings-pwa-qr');
        if (qrBox) {
            QRCode.toDataURL(window.location.href, { width: 100, margin: 1 }).then(url => {
                qrBox.innerHTML = `<img src="${url}" alt="QR" class="w-full h-full object-contain" />`;
            });
        }

        target.querySelector('#btn-trigger-pwa-setting')?.addEventListener('click', () => {
            if (window.__triggerPwaInstall) window.__triggerPwaInstall();
        });

        // 위젯 설정 저장
        target.querySelector('#btn-save-dash-settings')?.addEventListener('click', () => {
            const newSettings = {
                ...state.dashboardSettings,
                showKpi: target.querySelector('#set-show-kpi').checked,
                showQrWidget: target.querySelector('#set-show-qr').checked,
                showQuickAction: target.querySelector('#set-show-quick').checked,
                showLowSafety: target.querySelector('#set-show-safety').checked,
                showCalendarWidget: target.querySelector('#set-show-calendar').checked,
                showHistory: target.querySelector('#set-show-history').checked,
                showOilCalc: target.querySelector('#set-show-oil').checked
            };
            saveDashboardSettings(newSettings);
            showToast('✅ 대시보드 위젯 설정이 저장되었습니다.');
        });
    };

    // ----------------------------------------------------
    // 2. 계정 & 권한 & 작업자 관리 섹션
    // ----------------------------------------------------
    const renderAccountsSection = (target) => {
        target.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <!-- 사용자 계정 승인 및 권한 관리 (7칸) -->
            <div class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3 flex justify-between items-center">
                    <div>
                        <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                            <i data-lucide="shield-check" class="w-4 h-4 text-indigo-600"></i>
                            <span>사용자 계정 승인 & 권한 관리</span>
                        </h3>
                        <p class="text-xs text-slate-500 mt-0.5">신규 가입자는 <b>승인 대기</b> 상태입니다. 자기보다 낮은 역할만 부여·변경할 수 있습니다.</p>
                    </div>
                    <span id="profiles-count" class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">-</span>
                </div>

                <div id="profiles-panel" class="text-xs text-slate-500">
                    ${isCloudAuth() ? '⏳ 사용자 목록을 불러오는 중...' : '클라우드(Supabase)가 연결되지 않아 계정 관리를 사용할 수 없습니다.'}
                </div>

                <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
                    <b class="text-slate-800">신규 사용자 추가 방법</b>: 로그인 화면의 [신규 계정 생성]에서 본인이 실제 이메일로 가입 → 메일 인증 → 이 화면에서 역할을 부여해 승인합니다.
                    계정을 완전히 삭제하려면 Supabase 대시보드 [Authentication → Users]에서 삭제하고, 여기서는 <b>승인 대기(접근 차단)</b>로 바꾸면 즉시 사용할 수 없습니다.
                </div>

                <!-- master 계정 (현재 master만 이전 가능) -->
                <div id="master-panel" class="${isCloudAuth() ? '' : 'hidden'} bg-purple-50/60 p-3.5 rounded-xl border border-purple-200 space-y-2 text-xs">
                    <div class="flex items-center gap-2 font-bold text-purple-900">
                        <i data-lucide="crown" class="w-4 h-4 text-purple-600"></i>
                        <span>master 계정</span>
                        <span id="master-email-label" class="font-mono text-purple-700">${escapeHtml(state.currentUser?.masterEmail || '-')}</span>
                    </div>
                    ${state.currentUser?.role === 'MASTER' ? `
                    <form id="form-transfer-master" class="flex flex-col sm:flex-row gap-2">
                        <input type="email" id="new-master-email" required placeholder="새 master 이메일 (메일 인증을 마친 가입 계정)" class="flex-1 bg-white border border-purple-300 rounded-lg px-2.5 py-1.5" />
                        <button type="submit" class="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg transition">master 이전</button>
                    </form>
                    <p class="text-[10px] text-purple-700">이전하면 현재 계정은 총괄 관리자(ADMIN)로 남고, 새 master만 master를 다시 이전할 수 있습니다.</p>
                    ` : '<p class="text-[10px] text-purple-700">master 이전은 현재 master 계정만 할 수 있습니다.</p>'}
                </div>
            </div>

            <!-- 현장 작업자 관리 (5칸) -->
            <div class="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3">
                    <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                        <i data-lucide="user-check" class="w-4 h-4 text-blue-600"></i>
                        <span>현장 작업자 명단 관리</span>
                    </h3>
                    <p class="text-xs text-slate-500 mt-0.5">입출고 및 생산 전표에 기록될 작업자 목록입니다.</p>
                </div>

                <div class="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    ${state.workers.map(w => `
                        <div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                            <div>
                                <span class="font-bold text-slate-900">${esc(w.name)}</span>
                                <span class="text-[11px] text-slate-500 ml-1">(${esc(w.dept || '부서미정')} / ${esc(w.role || '작업자')})</span>
                            </div>
                            <button type="button" class="btn-del-worker text-slate-400 hover:text-rose-500 p-1 min-w-11 min-h-11 inline-flex items-center justify-center" data-id="${esc(w.id)}">
                                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>

                <form id="form-add-worker" class="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2 text-xs">
                    <div class="grid grid-cols-3 gap-1.5">
                        <input type="text" id="new-worker-name" placeholder="작업자명" required class="bg-white border border-slate-300 rounded-lg px-2 py-1.5" />
                        <input type="text" id="new-worker-dept" placeholder="부서 (예: 물류팀)" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5" />
                        <input type="text" id="new-worker-role" placeholder="직급 (예: 기사)" class="bg-white border border-slate-300 rounded-lg px-2 py-1.5" />
                    </div>
                    <button type="submit" class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition shadow-xs">
                        작업자 추가 등록
                    </button>
                </form>
            </div>
        </div>
        `;

        // 사용자 목록 (Supabase 프로필) 불러오기 및 승인·역할 변경
        const loadProfiles = async () => {
            const panel = target.querySelector('#profiles-panel');
            if (!panel || !isCloudAuth()) return;
            const res = await listProfiles();
            if (!res.success) {
                panel.innerHTML = `<div class="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-bold">사용자 목록을 불러오지 못했습니다: ${escapeHtml(res.message)}</div>`;
                return;
            }
            const me = state.currentUser;
            const options = assignableRoles(me?.role);
            // 승인 대기자를 맨 위에
            const profiles = [...res.profiles].sort((a, b) => (a.effectiveRole === 'PENDING' ? 0 : 1) - (b.effectiveRole === 'PENDING' ? 0 : 1));
            const pendingCount = profiles.filter(p => p.effectiveRole === 'PENDING').length;
            const countEl = target.querySelector('#profiles-count');
            if (countEl) countEl.textContent = `총 ${profiles.length}명${pendingCount ? ` · 승인 대기 ${pendingCount}명` : ''}`;
            const masterLabel = target.querySelector('#master-email-label');
            if (masterLabel && res.masterEmail) masterLabel.textContent = res.masterEmail;

            panel.innerHTML = `
            <div class="overflow-auto rounded-xl border border-slate-200 max-h-[65vh]">
                <table class="w-full text-left text-xs text-slate-700">
                    <thead class="bg-slate-50 border-b border-slate-200 font-bold text-slate-500 sticky top-0 z-10">
                        <tr>
                            <th class="p-2.5">이름</th>
                            <th class="p-2.5">이메일</th>
                            <th class="p-2.5">부서</th>
                            <th class="p-2.5">권한 (변경 시 즉시 적용)</th>
                            <th class="p-2.5 text-center whitespace-nowrap" title="원액생산 작업지시서(특별보안) 메뉴 접근. 마스터만 지정할 수 있습니다.">🔒 작업일지 관리자</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${profiles.map(p => {
                            const role = p.effectiveRole;
                            const isMe = me && p.id === me.id;
                            const badge = `<span class="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-black border ${esc(ROLE_INFO[role]?.color || '')}">${ROLE_INFO[role]?.label || role}</span>`;
                            const control = canManageUser(p, me) ? `
                                <select class="sel-profile-role bg-white border rounded-lg px-2 py-1 text-xs font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer ${ROLE_SELECT_STYLE[role] || ''}" data-id="${esc(p.id)}" data-name="${escapeHtml(p.name)}" data-current="${role}">
                                    ${role === 'PENDING' ? '<option value="PENDING" selected>⏳ 승인 대기 (선택하여 승인)</option>' : ''}
                                    ${options.filter(r => r !== 'PENDING').map(r => `<option value="${r}" ${r === role ? 'selected' : ''}>${esc(ROLE_INFO[r].label)} (${r})</option>`).join('')}
                                    ${role !== 'PENDING' ? '<option value="PENDING">⛔ 접근 차단 (승인 대기로)</option>' : ''}
                                </select>` : badge;
                            return `
                            <tr class="${role === 'PENDING' ? 'bg-yellow-50/60' : 'hover:bg-slate-50/80'} transition">
                                <td class="p-2.5 font-bold text-slate-900">${escapeHtml(p.name)} ${isMe ? '<span class="px-1.5 bg-blue-600 text-white rounded text-[9px] font-black">나</span>' : ''}</td>
                                <td class="p-2.5 font-mono text-slate-600">${escapeHtml(p.email)}</td>
                                <td class="p-2.5 text-slate-500">${escapeHtml(p.dept || '-')}</td>
                                <td class="p-2.5">${control}</td>
                                <td class="p-2.5 text-center">${role === 'MASTER'
                                    ? '<span class="text-[10px] font-bold text-slate-400">마스터 (항상 허용)</span>'
                                    : me?.isMaster
                                        ? `<input type="checkbox" class="chk-worklog-manager w-4 h-4 accent-amber-600 cursor-pointer" data-id="${esc(p.id)}" data-name="${escapeHtml(p.name)}" ${p.worklog_manager ? 'checked' : ''} ${role === 'PENDING' ? 'disabled title="승인 후 지정할 수 있습니다"' : ''} />`
                                        : (p.worklog_manager ? '<span class="text-[11px] font-black text-amber-700">✔</span>' : '<span class="text-slate-300">-</span>')}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;

            panel.querySelectorAll('.sel-profile-role').forEach(sel => {
                sel.addEventListener('change', async (e) => {
                    const newRole = e.target.value;
                    const name = sel.getAttribute('data-name');
                    if (newRole === 'PENDING' && !confirm(`${name}님의 접근을 차단(승인 대기로 변경)하시겠습니까?`)) {
                        sel.value = sel.getAttribute('data-current');
                        return;
                    }
                    const r = await updateUserRole(sel.getAttribute('data-id'), newRole);
                    if (r.success) {
                        showToast(`✅ ${name}님의 권한이 '${ROLE_INFO[newRole]?.label || newRole}'(으)로 변경되었습니다.`);
                    } else {
                        showToast(`❌ 권한 변경 실패: ${r.message || '오류가 발생했습니다.'}`);
                    }
                    loadProfiles();
                });
            });

            // 작업일지 관리자 지정/해제 (마스터만)
            panel.querySelectorAll('.chk-worklog-manager').forEach(chk => {
                chk.addEventListener('change', async (e) => {
                    const enabled = e.target.checked;
                    const name = chk.getAttribute('data-name');
                    const msg = enabled
                        ? `${name}님에게 '작업일지 관리자' 권한을 부여하시겠습니까?\n원액생산 작업지시서와 제조시방서(배합 정보)를 조회·작성할 수 있게 됩니다.`
                        : `${name}님의 '작업일지 관리자' 권한을 해제하시겠습니까?`;
                    if (!confirm(msg)) { e.target.checked = !enabled; return; }
                    const r = await setWorklogManager(chk.getAttribute('data-id'), enabled);
                    showToast(r.success ? `🔒 ${name}님의 작업일지 관리자 권한을 ${enabled ? '부여' : '해제'}했습니다.` : `❌ 권한 변경 실패: ${r.message}`);
                    loadProfiles();
                });
            });
        };
        loadProfiles();

        // master 이전
        target.querySelector('#form-transfer-master')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = target.querySelector('#new-master-email').value.trim();
            if (!email) return;
            if (!confirm(`master 계정을 ${email}(으)로 이전하시겠습니까?\n\n이전 후 현재 계정은 총괄 관리자(ADMIN)가 되며, master는 새 계정만 다시 이전할 수 있습니다.`)) return;
            const r = await transferMaster(email);
            if (r.success) {
                alert(`master 계정이 ${r.masterEmail}(으)로 이전되었습니다.`);
                await initAuth();   // 내 역할(ADMIN)을 다시 불러온다
                render();
                if (onRefresh) onRefresh();
            } else {
                alert(`master 이전 실패: ${r.message}`);
            }
        });

        // 작업자 등록
        target.querySelector('#form-add-worker')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = target.querySelector('#new-worker-name').value.trim();
            const dept = target.querySelector('#new-worker-dept').value.trim() || '물류관리팀';
            const role = target.querySelector('#new-worker-role').value.trim() || '작업자';
            await saveWorker({ id: `EMP-${Date.now().toString().slice(-4)}`, name, dept, role });
            showToast(`작업자 '${name}' 등록 완료!`);
            render();
        });

        // 작업자 삭제
        target.querySelectorAll('.btn-del-worker').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                if (confirm('선택한 작업자를 삭제하시겠습니까?')) {
                    await deleteWorker(id);
                    showToast('작업자가 삭제되었습니다.');
                    render();
                }
            });
        });
    };

    // ----------------------------------------------------
    // 3. 마스터 기준정보 설정 섹션
    // ----------------------------------------------------
    const renderMasterSection = (target) => {
        target.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <!-- 품목 분류 카테고리 -->
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3">
                    <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                        <i data-lucide="tag" class="w-4 h-4 text-emerald-600"></i>
                        <span>품목 분류 (카테고리)</span>
                    </h3>
                    <p class="text-[11px] text-slate-500 mt-0.5">완제품, 원료, 부자재, 소모품 등</p>
                </div>

                <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    ${state.categories.map(c => `
                        <div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                            <span class="font-bold text-slate-800">${esc(c)}</span>
                            <button type="button" class="btn-del-cat text-slate-400 hover:text-rose-500 p-1 min-w-11 min-h-11 inline-flex items-center justify-center" data-name="${esc(c)}">
                                <i data-lucide="x" class="w-3.5 h-3.5"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>

                <div class="flex gap-1.5 pt-1">
                    <input type="text" id="new-cat-input" placeholder="새 분류명" class="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold" />
                    <button type="button" id="btn-add-cat" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs">추가</button>
                </div>
            </div>

            <!-- 창고 및 거점 위치 -->
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3">
                    <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                        <i data-lucide="map-pin" class="w-4 h-4 text-blue-600"></i>
                        <span>거점(공장·창고) 및 건물</span>
                    </h3>
                    <p class="text-[11px] text-slate-500 mt-0.5">거점마다 건물을 등록하면 입출고·이동·생산 시 건물 단위로 위치를 고를 수 있습니다.</p>
                </div>

                <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
                    ${sitesOf(state.locations).map(site => {
                        const blds = buildingsOf(state.locations, site);
                        const isDefault = DEFAULT_SITES.includes(site);
                        return `
                        <div class="p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                            <div class="flex items-center justify-between">
                                <span class="font-black text-slate-900">${escapeHtml(site)}${isDefault ? ' <span class="text-[10px] font-bold text-slate-400">기본</span>' : ''}</span>
                                ${isDefault ? '' : `<button type="button" class="btn-del-loc text-slate-400 hover:text-rose-500 p-1 min-w-11 min-h-11 inline-flex items-center justify-center" data-name="${escapeHtml(site)}" title="거점 삭제"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>`}
                            </div>
                            <div class="flex flex-wrap gap-1">
                                ${blds.length === 0 ? '<span class="text-[10px] text-slate-400">등록된 건물 없음</span>' : blds.map(b => `
                                    <span class="inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-700">
                                        ${escapeHtml(b)}
                                        <button type="button" class="btn-del-loc text-slate-400 hover:text-rose-500 p-0.5" data-name="${escapeHtml(makeLocation(site, b))}" title="건물 삭제"><i data-lucide="x" class="w-3 h-3"></i></button>
                                    </span>`).join('')}
                            </div>
                            <div class="flex gap-1">
                                <input type="text" class="new-bld-input flex-1 min-w-0 bg-white border border-slate-300 rounded-lg px-2 py-1 text-[11px] font-bold" placeholder="건물명 (예: 1동, 원료동)" data-site="${escapeHtml(site)}" />
                                <button type="button" class="btn-add-bld px-2 py-1 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-[11px] font-bold" data-site="${escapeHtml(site)}">건물 추가</button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>

                <div class="flex gap-1.5 pt-1">
                    <input type="text" id="new-loc-input" placeholder="새 거점명 (공장·창고)" class="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold" />
                    <button type="button" id="btn-add-loc" class="whitespace-nowrap px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs">거점 추가</button>
                </div>
            </div>

            <!-- 매입/매출 거래처 -->
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3">
                    <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                        <i data-lucide="building-2" class="w-4 h-4 text-purple-600"></i>
                        <span>매입·매출 협력 거래처</span>
                    </h3>
                    <p class="text-[11px] text-slate-500 mt-0.5">SK엔무브, 에쓰오일, 모션테크 등</p>
                </div>

                <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    ${state.partners.map(p => `
                        <div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                            <span class="font-bold text-slate-800">${esc(p)}</span>
                            <button type="button" class="btn-del-partner text-slate-400 hover:text-rose-500 p-1 min-w-11 min-h-11 inline-flex items-center justify-center" data-name="${esc(p)}">
                                <i data-lucide="x" class="w-3.5 h-3.5"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>

                <div class="flex gap-1.5 pt-1">
                    <input type="text" id="new-partner-input" placeholder="새 거래처 상호" class="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold" />
                    <button type="button" id="btn-add-partner" class="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-xs">추가</button>
                </div>
            </div>

            <!-- 추가 마스터 도구 링크 카드 -->
            <div class="md:col-span-3 bg-gradient-to-r from-slate-50 to-blue-50/40 p-4 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div class="flex items-center gap-2 font-bold text-slate-700">
                    <i data-lucide="tools" class="w-4 h-4 text-blue-600"></i>
                    <span>기타 자재 관리 도구 바로가기:</span>
                </div>
                <div class="flex items-center flex-wrap gap-2">
                    <button type="button" id="btn-open-beginning-modal" class="px-3 py-1.5 bg-white border border-slate-300 rounded-xl font-bold text-slate-700 hover:bg-slate-100 shadow-xs">
                        📦 기초 재고 수동 등록
                    </button>
                    <button type="button" id="btn-open-excel-modal" class="px-3 py-1.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 shadow-xs">
                        📊 엑셀 품목 대량 업로드
                    </button>
                    <button type="button" id="btn-open-slip-modal" class="px-3 py-1.5 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-600 shadow-xs">
                        📄 거래 출하 전표 발행기
                    </button>
                </div>
            </div>
        </div>
        `;

        // 분류 추가/삭제
        target.querySelector('#btn-add-cat')?.addEventListener('click', async () => {
            const val = target.querySelector('#new-cat-input').value.trim();
            if (val) {
                await addCategory(val);
                showToast(`분류 '${val}' 추가 완료`);
                render();
            }
        });
        target.querySelectorAll('.btn-del-cat').forEach(b => {
            b.addEventListener('click', async () => {
                const name = b.getAttribute('data-name');
                if (confirm(`'${name}' 분류를 삭제하시겠습니까?`)) {
                    await deleteCategory(name);
                    showToast('분류가 삭제되었습니다.');
                    render();
                }
            });
        });

        // 거점 추가/삭제
        target.querySelector('#btn-add-loc')?.addEventListener('click', async () => {
            const val = target.querySelector('#new-loc-input').value.trim();
            if (!val) return;
            try {
                await addSite(val);
                showToast(`거점 '${val}' 추가 완료`);
                render();
            } catch (err) {
                alert(err.message);
            }
        });
        const addBld = async (site) => {
            const input = [...target.querySelectorAll('.new-bld-input')].find(i => i.getAttribute('data-site') === site);
            const val = input ? input.value.trim() : '';
            if (!val) return;
            try {
                await addBuilding(site, val);
                showToast(`${site}에 '${val}' 건물 추가 완료`);
                render();
            } catch (err) {
                alert(err.message);
            }
        };
        target.querySelectorAll('.btn-add-bld').forEach(b => {
            b.addEventListener('click', () => addBld(b.getAttribute('data-site')));
        });
        target.querySelectorAll('.new-bld-input').forEach(i => {
            i.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); addBld(i.getAttribute('data-site')); }
            });
        });
        target.querySelectorAll('.btn-del-loc').forEach(b => {
            b.addEventListener('click', async () => {
                const name = b.getAttribute('data-name');
                const isSite = siteOf(name) === name;
                const msg = isSite
                    ? `'${name}' 거점과 소속 건물을 모두 삭제하시겠습니까?`
                    : `'${locationLabel(name)}' 건물을 삭제하시겠습니까?`;
                if (!confirm(msg)) return;
                try {
                    await deleteLocation(name);
                    showToast(isSite ? '거점이 삭제되었습니다.' : '건물이 삭제되었습니다.');
                    render();
                } catch (err) {
                    alert(err.message);
                }
            });
        });

        // 거래처 추가/삭제
        target.querySelector('#btn-add-partner')?.addEventListener('click', async () => {
            const val = target.querySelector('#new-partner-input').value.trim();
            if (val) {
                await addPartner(val);
                showToast(`거래처 '${val}' 추가 완료`);
                render();
            }
        });
        target.querySelectorAll('.btn-del-partner').forEach(b => {
            b.addEventListener('click', async () => {
                const name = b.getAttribute('data-name');
                if (confirm(`'${name}' 거래처를 삭제하시겠습니까?`)) {
                    await deletePartner(name);
                    showToast('거래처가 삭제되었습니다.');
                    render();
                }
            });
        });

        // 모달 연결
        target.querySelector('#btn-open-beginning-modal')?.addEventListener('click', () => onOpenModal('beginning'));
        target.querySelector('#btn-open-excel-modal')?.addEventListener('click', () => onOpenModal('excel'));
        target.querySelector('#btn-open-slip-modal')?.addEventListener('click', () => onOpenModal('slip'));
    };

    // ----------------------------------------------------
    // 4. 클라우드 DB & 데이터 백업 섹션
    // ----------------------------------------------------
    const renderCloudSection = (target) => {
        const isConnected = isSupabaseConfigured();
        const cfg = getSupabaseConfig();

        target.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <!-- Supabase 연동 설정 (7칸) -->
            <div class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3 flex justify-between items-center">
                    <div>
                        <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                            <i data-lucide="database" class="w-4 h-4 text-emerald-600"></i>
                            <span>Supabase 클라우드 실시간 데이터베이스 연동</span>
                        </h3>
                        <p class="text-xs text-slate-500 mt-0.5">여러 PC 및 모바일 기기 간 0.1초 실시간 재고 동기화를 활성화합니다.</p>
                    </div>
                    <span class="px-2.5 py-1 text-[11px] font-bold rounded-full border ${
                        isConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-amber-50 text-amber-700 border-amber-300'
                    }">
                        ${isConnected ? '🟢 실시간 연결됨' : '🟡 오프라인 모드'}
                    </span>
                </div>

                <div class="space-y-3 text-xs">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">Project URL</label>
                        <input type="text" id="set-supabase-url" value="${cfg.url || ''}" placeholder="https://your-project.supabase.co" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono text-xs font-bold focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">Anon Public Key</label>
                        <textarea id="set-supabase-key" rows="3" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono text-xs focus:ring-2 focus:ring-emerald-500">${cfg.anonKey || ''}</textarea>
                    </div>

                    <div class="grid grid-cols-2 gap-2 pt-1">
                        <button type="button" id="btn-set-test-supabase" class="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl transition flex items-center justify-center gap-1.5 border border-slate-200 shadow-xs">
                            <i data-lucide="activity" class="w-3.5 h-3.5 text-emerald-600"></i>
                            <span>연결 테스트</span>
                        </button>
                        <button type="button" id="btn-set-save-supabase" class="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition flex items-center justify-center gap-1.5 shadow-md">
                            <i data-lucide="save" class="w-3.5 h-3.5"></i>
                            <span>키 저장 및 실시간 연동</span>
                        </button>
                    </div>

                    <div class="grid grid-cols-2 gap-2 pt-1">
                        <button type="button" id="btn-copy-sql" class="py-2 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold rounded-xl transition flex items-center justify-center gap-1">
                            <i data-lucide="code" class="w-3.5 h-3.5 text-blue-600"></i>
                            <span>SQL 스키마 복사</span>
                        </button>
                        <button type="button" id="btn-sync-all-to-cloud" class="py-2 px-3 bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-700 font-bold rounded-xl transition flex items-center justify-center gap-1">
                            <i data-lucide="upload-cloud" class="w-3.5 h-3.5 text-blue-600"></i>
                            <span>로컬 데이터 전체 업로드</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- 데이터 백업, 복원, 초기화 (5칸) -->
            <div class="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3">
                    <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                        <i data-lucide="archive" class="w-4 h-4 text-blue-600"></i>
                        <span>전체 데이터 백업 & 복원</span>
                    </h3>
                    <p class="text-xs text-slate-500 mt-0.5">다른 PC로 데이터를 이동하거나 백업본을 보관합니다.</p>
                </div>

                <div class="space-y-3 text-xs">
                    <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                        <span class="font-bold text-slate-800 block">1. 데이터 백업 다운로드</span>
                        <p class="text-[11px] text-slate-500">현재 등록된 모든 재고, 마스터 품목, 생산 내역, 수불 이력을 안전한 JSON 파일로 저장합니다.</p>
                        <button type="button" id="btn-download-backup-file" class="w-full py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-xl transition shadow-xs flex items-center justify-center gap-1.5">
                            <i data-lucide="download" class="w-3.5 h-3.5"></i>
                            <span>백업 파일 (.json) 즉시 다운로드</span>
                        </button>
                    </div>

                    <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                        <span class="font-bold text-slate-800 block">2. 백업 파일 복원 (Restore)</span>
                        <input type="file" id="input-restore-file" accept=".json" class="w-full bg-white border border-slate-300 rounded-lg p-1.5 text-[11px]" />
                        <button type="button" id="btn-restore-data" class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-xs flex items-center justify-center gap-1.5">
                            <i data-lucide="upload" class="w-3.5 h-3.5"></i>
                            <span>선택한 파일로 데이터 복원</span>
                        </button>
                    </div>

                    <div class="pt-2 border-t border-slate-100">
                        <button type="button" id="btn-reset-demo" class="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold rounded-xl transition flex items-center justify-center gap-1.5">
                            <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
                            <span>이 기기 캐시 지우고 클라우드에서 다시 불러오기</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
        `;

        // Supabase 키 저장
        target.querySelector('#btn-set-save-supabase')?.addEventListener('click', async () => {
            const url = target.querySelector('#set-supabase-url').value.trim();
            const anonKey = target.querySelector('#set-supabase-key').value.trim();
            saveSupabaseConfig(url, anonKey);
            showToast('✅ Supabase 클라우드 설정이 저장되었습니다. 페이지를 새로고침하여 연결합니다.');
            setTimeout(() => window.location.reload(), 1000);
        });

        // Supabase 테스트
        target.querySelector('#btn-set-test-supabase')?.addEventListener('click', async () => {
            const url = target.querySelector('#set-supabase-url').value.trim();
            const anonKey = target.querySelector('#set-supabase-key').value.trim();
            const res = await testSupabaseConnection(url, anonKey);
            alert(res.message);
        });

        // SQL 스키마 복사
        target.querySelector('#btn-copy-sql')?.addEventListener('click', async () => {
            try {
                const res = await fetch('/supabase_schema.sql');
                const sql = await res.text();
                await navigator.clipboard.writeText(sql);
                showToast('📋 SQL 스키마가 클립보드에 복사되었습니다.');
            } catch (e) {
                alert('SQL 스키마 복사 실패: ' + e.message);
            }
        });

        // 로컬 데이터 전체 업로드
        target.querySelector('#btn-sync-all-to-cloud')?.addEventListener('click', async () => {
            if (!isSupabaseConfigured()) {
                alert('먼저 Supabase URL과 키를 저장해 주세요.');
                return;
            }
            if (confirm('현재 로컬의 품목/재고/이력을 Supabase 클라우드로 일괄 업로드하시겠습니까?')) {
                showToast('클라우드로 데이터 업로드 중...');
                try {
                    await syncAllLocalDataToSupabase();
                    showToast('🎉 클라우드 업로드가 완료되었습니다!');
                } catch (err) {
                    alert(`클라우드 업로드 실패: ${err.message}`);
                }
            }
        });

        // 백업 다운로드
        target.querySelector('#btn-download-backup-file')?.addEventListener('click', downloadJsonBackup);

        // 복원
        target.querySelector('#btn-restore-data')?.addEventListener('click', async () => {
            const fileInput = target.querySelector('#input-restore-file');
            if (!fileInput.files || fileInput.files.length === 0) {
                alert('복원할 .json 파일을 선택하세요.');
                return;
            }
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    await restoreAllData(data);
                    alert('데이터 복원이 완료되었습니다! 페이지를 새로고침합니다.');
                    window.location.reload();
                } catch (err) {
                    alert('복원 실패: ' + err.message);
                }
            };
            reader.readAsText(file);
        });

        // 데모 초기화
        target.querySelector('#btn-reset-demo')?.addEventListener('click', async () => {
            if (confirm('이 기기의 데이터 캐시를 지우고 클라우드에서 다시 불러오시겠습니까?')) {
                const kept = clearCloudDataCache();
                alert(kept.length > 0
                    ? '클라우드에 아직 올라가지 않은 수불부 전표가 있어 수불부 캐시는 남겨 두었습니다. 페이지를 새로고침합니다.'
                    : '캐시를 지웠습니다. 페이지를 새로고침합니다.');
                window.location.reload();
            }
        });
    };

    // 공통 백업 다운로드 헬퍼
    const downloadJsonBackup = () => {
        const fullBackup = {
            exportDate: new Date().toISOString(),
            version: "1.0.0",
            categories: state.categories,
            locations: state.locations,
            partners: state.partners,
            workers: state.workers,
            // 사용자 계정(비밀번호)은 백업에 포함하지 않는다. 로그인 계정은 Supabase Auth가 관리한다.
            master: state.master,
            inventory: state.inventory,
            history: state.history,
            productions: state.productions,
            schedules: state.schedules,
            beginningStock: state.beginningStock,
            dashboardSettings: state.dashboardSettings
        };
        const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `대림오일_WMS_전체데이터백업_${localDateStr()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('📁 전체 데이터 백업 파일이 다운로드되었습니다.');
    };

    // 초기 렌더 실행
    render();
};
