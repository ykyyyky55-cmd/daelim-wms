import { 
    state, 
    addCategory, 
    deleteCategory, 
    addLocation, 
    deleteLocation, 
    addPartner, 
    deletePartner, 
    saveWorker, 
    deleteWorker, 
    saveUserAccount, 
    deleteUserAccount,
    saveDashboardSettings,
    restoreAllData,
    resetToEnterpriseData,
    syncAllLocalDataToSupabase
} from '../services/db.js';
import { getSupabaseConfig, saveSupabaseConfig, testSupabaseConnection, isSupabaseConfigured } from '../services/supabase.js';
import { updateUserRole, ROLE_INFO } from '../services/auth.js';
import QRCode from 'qrcode';

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
            <!-- 사용자 계정 및 권한 관리 (7칸) -->
            <div class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="border-b border-slate-100 pb-3 flex justify-between items-center">
                    <div>
                        <h3 class="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                            <i data-lucide="shield-check" class="w-4 h-4 text-indigo-600"></i>
                            <span>사용자 계정 & 보안 권한 제어</span>
                        </h3>
                        <p class="text-xs text-slate-500 mt-0.5">총괄 관리자 및 자재 관리자는 사원 계정의 권한 등급을 실시간으로 수정·부여할 수 있습니다.</p>
                    </div>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        총 ${state.users.length}명
                    </span>
                </div>

                <div class="overflow-x-auto rounded-xl border border-slate-200">
                    <table class="w-full text-left text-xs text-slate-700">
                        <thead class="bg-slate-50 border-b border-slate-200 font-bold text-slate-500">
                            <tr>
                                <th class="p-2.5">이름</th>
                                <th class="p-2.5">아이디</th>
                                <th class="p-2.5">부서</th>
                                <th class="p-2.5">권한 등급 (클릭하여 변경)</th>
                                <th class="p-2.5 text-center">삭제</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${state.users.map(u => `
                                <tr class="hover:bg-slate-50/80 transition">
                                    <td class="p-2.5 font-bold text-slate-900 flex items-center gap-1.5">
                                        <div class="w-6 h-6 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-black">
                                            ${(u.name || '사').slice(0, 1)}
                                        </div>
                                        <span>${u.name}</span>
                                    </td>
                                    <td class="p-2.5 font-mono text-slate-600">${u.username}</td>
                                    <td class="p-2.5 text-slate-500">${u.dept || '현장운영팀'}</td>
                                    <td class="p-2.5">
                                        ${u.username === 'admin' ? `
                                            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-black bg-rose-100 text-rose-800 border border-rose-200">
                                                <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                                <span>총괄 관리자 (ADMIN)</span>
                                                <span class="text-[9px] text-rose-600 font-normal">[보호됨]</span>
                                            </span>
                                        ` : `
                                            <div class="inline-flex items-center gap-1.5">
                                                <select class="sel-user-role bg-white border rounded-lg px-2 py-1 text-xs font-bold transition shadow-2xs focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer ${
                                                    u.role === 'ADMIN' ? 'text-rose-700 bg-rose-50/70 border-rose-300' :
                                                    u.role === 'MANAGER' ? 'text-blue-700 bg-blue-50/70 border-blue-300' :
                                                    u.role === 'OPERATOR' ? 'text-amber-700 bg-amber-50/70 border-amber-300' :
                                                    'text-slate-700 bg-slate-50 border-slate-300'
                                                }" data-user="${u.username}">
                                                    <option value="ADMIN" ${u.role === 'ADMIN' ? 'selected' : ''}>🔴 총괄 관리자 (ADMIN)</option>
                                                    <option value="MANAGER" ${u.role === 'MANAGER' ? 'selected' : ''}>🔵 자재 관리자 (MANAGER)</option>
                                                    <option value="OPERATOR" ${u.role === 'OPERATOR' ? 'selected' : ''}>🟠 현장 작업자 (OPERATOR)</option>
                                                    <option value="VIEWER" ${u.role === 'VIEWER' ? 'selected' : ''}>⚪ 조회 전용 (VIEWER)</option>
                                                </select>
                                            </div>
                                        `}
                                    </td>
                                    <td class="p-2.5 text-center">
                                        ${u.username !== 'admin' ? `
                                            <button type="button" class="btn-del-user text-slate-400 hover:text-rose-600 p-1 rounded-md hover:bg-rose-50 transition" data-user="${u.username}" title="계정 삭제">
                                                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                            </button>
                                        ` : '<span class="text-[10px] text-slate-400">-</span>'}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <!-- 신규 계정 추가 폼 -->
                <form id="form-add-user" class="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
                    <span class="font-bold text-slate-800 block text-[11px]">관리자 직접 신규 계정 등록</span>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <input type="text" id="new-user-name" placeholder="이름 (예: 박관리)" required class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5" />
                        <input type="text" id="new-user-id" placeholder="아이디" required class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5" />
                        <input type="password" id="new-user-pw" placeholder="비밀번호" required class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5" />
                        <select id="new-user-role" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold">
                            <option value="OPERATOR" selected>OPERATOR (현장 작업자)</option>
                            <option value="MANAGER">MANAGER (자재 관리자)</option>
                            <option value="ADMIN">ADMIN (총괄 관리자)</option>
                            <option value="VIEWER">VIEWER (조회 전용)</option>
                        </select>
                    </div>
                    <button type="submit" class="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition shadow-xs">
                        신규 계정 생성 및 저장
                    </button>
                </form>
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
                                <span class="font-bold text-slate-900">${w.name}</span>
                                <span class="text-[11px] text-slate-500 ml-1">(${w.dept || '부서미정'} / ${w.role || '작업자'})</span>
                            </div>
                            <button type="button" class="btn-del-worker text-slate-400 hover:text-rose-500 p-1" data-id="${w.id}">
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

        // 권한 등급 실시간 수정 (총괄 관리자 및 자재 관리자)
        target.querySelectorAll('.sel-user-role').forEach(sel => {
            sel.addEventListener('change', async (e) => {
                const username = sel.getAttribute('data-user');
                const newRole = e.target.value;
                const targetUser = state.users.find(u => u.username === username);
                const res = await updateUserRole(username, newRole);
                if (res.success) {
                    const roleLabel = ROLE_INFO[newRole]?.label || newRole;
                    showToast(`✅ [${targetUser?.name || username}]님의 권한이 '${roleLabel}'(으)로 변경되었습니다.`);
                    render();
                    if (onRefresh) onRefresh();
                } else {
                    showToast(`❌ 권한 변경 실패: ${res.message || '오류가 발생했습니다.'}`);
                    render();
                }
            });
        });

        // 계정 삭제
        target.querySelectorAll('.btn-del-user').forEach(btn => {
            btn.addEventListener('click', async () => {
                const u = btn.getAttribute('data-user');
                if (confirm(`'${u}' 계정을 삭제하시겠습니까?`)) {
                    await deleteUserAccount(u);
                    showToast(`계정 '${u}'이(가) 삭제되었습니다.`);
                    render();
                    if (onRefresh) onRefresh();
                }
            });
        });

        // 계정 등록
        target.querySelector('#form-add-user')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = target.querySelector('#new-user-name').value.trim();
            const username = target.querySelector('#new-user-id').value.trim();
            const password = target.querySelector('#new-user-pw').value;
            const role = target.querySelector('#new-user-role').value;
            await saveUserAccount({ id: `usr_${Date.now()}`, name, username, password, role, dept: '현장관리팀', title: ROLE_INFO[role]?.label || role });
            
            // 작업자 목록에도 등록
            const hasWorker = state.workers?.some(w => w.name === name);
            if (!hasWorker) {
                await saveWorker({ id: `EMP-${Date.now().toString().slice(-4)}`, name, dept: '현장관리팀', role: ROLE_INFO[role]?.label || '작업자' });
            }

            showToast(`신규 계정 '${username}' (${ROLE_INFO[role]?.label || role}) 등록 완료!`);
            render();
            if (onRefresh) onRefresh();
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
                            <span class="font-bold text-slate-800">${c}</span>
                            <button type="button" class="btn-del-cat text-slate-400 hover:text-rose-500 p-1" data-name="${c}">
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
                        <span>보관 거점 및 창고 위치</span>
                    </h3>
                    <p class="text-[11px] text-slate-500 mt-0.5">김포공장, 본사창고, 방산창고 등</p>
                </div>

                <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    ${state.locations.map(loc => `
                        <div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                            <span class="font-bold text-slate-800">${loc}</span>
                            <button type="button" class="btn-del-loc text-slate-400 hover:text-rose-500 p-1" data-name="${loc}">
                                <i data-lucide="x" class="w-3.5 h-3.5"></i>
                            </button>
                        </div>
                    `).join('')}
                </div>

                <div class="flex gap-1.5 pt-1">
                    <input type="text" id="new-loc-input" placeholder="새 창고명" class="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs font-bold" />
                    <button type="button" id="btn-add-loc" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs">추가</button>
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
                            <span class="font-bold text-slate-800">${p}</span>
                            <button type="button" class="btn-del-partner text-slate-400 hover:text-rose-500 p-1" data-name="${p}">
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
            if (val) {
                await addLocation(val);
                showToast(`거점 '${val}' 추가 완료`);
                render();
            }
        });
        target.querySelectorAll('.btn-del-loc').forEach(b => {
            b.addEventListener('click', async () => {
                const name = b.getAttribute('data-name');
                if (confirm(`'${name}' 거점을 삭제하시겠습니까?`)) {
                    await deleteLocation(name);
                    showToast('거점이 삭제되었습니다.');
                    render();
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
                            <span>엔터프라이즈 기본 실데이터(2,497건)로 초기화</span>
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
                await syncAllLocalDataToSupabase();
                showToast('🎉 클라우드 업로드가 완료되었습니다!');
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
            if (confirm('⚠️ 모든 데이터를 초기 엔터프라이즈 정품 데이터로 초기화하시겠습니까?')) {
                await resetToEnterpriseData();
                alert('초기화되었습니다! 페이지를 새로고침합니다.');
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
            users: state.users,
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
        a.download = `대림오일_WMS_전체데이터백업_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('📁 전체 데이터 백업 파일이 다운로드되었습니다.');
    };

    // 초기 렌더 실행
    render();
};
