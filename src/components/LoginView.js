import { login, registerUser } from '../services/auth.js';
import { createIcons, icons } from 'lucide';

export const renderLoginView = (container, { onLoginSuccess, showToast }) => {
    container.innerHTML = `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-4 sm:p-6 select-none">
        <div class="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-700/40 relative">
            <!-- 상단 브랜드 헤더 -->
            <div class="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white p-6 sm:p-8 text-center relative">
                <div class="w-16 h-16 mx-auto rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-inner mb-3">
                    <span class="font-black text-2xl tracking-tighter text-white">DO</span>
                </div>
                <h1 class="text-xl sm:text-2xl font-black tracking-tight">대림오일 스마트 WMS</h1>
                <p class="text-xs text-blue-100 mt-1">자재·재고·생산·수불 통합 관리 시스템</p>
                <div class="mt-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white/15 text-white border border-white/20">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>보안 인증 게이트웨이</span>
                </div>
            </div>

            <!-- 로그인 / 계정 생성 탭 스위처 -->
            <div class="flex border-b border-slate-200 bg-slate-50/80 p-1.5 gap-1.5">
                <button type="button" id="tab-btn-login" class="flex-1 py-2.5 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 bg-white text-blue-600 shadow-sm border border-slate-200">
                    <i data-lucide="log-in" class="w-3.5 h-3.5"></i>
                    <span>로그인</span>
                </button>
                <button type="button" id="tab-btn-register" class="flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 text-slate-500 hover:text-slate-800 hover:bg-white/60">
                    <i data-lucide="user-plus" class="w-3.5 h-3.5"></i>
                    <span>신규 계정 생성</span>
                </button>
            </div>

            <!-- 1. 로그인 패널 -->
            <div id="panel-login" class="p-6 sm:p-8 space-y-5">
                <form id="form-login" class="space-y-4">
                    <div id="login-error-box" class="hidden p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
                        <i data-lucide="alert-circle" class="w-4 h-4 flex-shrink-0"></i>
                        <span id="login-error-msg"></span>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">사용자 아이디 (Username)</label>
                        <div class="relative">
                            <i data-lucide="user" class="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none"></i>
                            <input type="text" id="login-username" required placeholder="아이디를 입력하세요" value="admin" class="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">비밀번호 (Password)</label>
                        <div class="relative">
                            <i data-lucide="lock" class="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none"></i>
                            <input type="password" id="login-password" required placeholder="비밀번호를 입력하세요" value="admin123" class="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-10 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            <button type="button" id="btn-toggle-pw" class="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 p-0.5">
                                <i data-lucide="eye" id="icon-eye" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>

                    <!-- 자동 로그인 체크박스 -->
                    <div class="flex items-center justify-between pt-1">
                        <label class="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                            <input type="checkbox" id="chk-remember-me" checked class="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                            <span>자동 로그인 (상태 유지)</span>
                        </label>
                        <span class="text-[11px] text-slate-400">재접속 시 자동 로그인</span>
                    </div>

                    <button type="submit" id="btn-login-submit" class="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl text-xs sm:text-sm transition shadow-md flex items-center justify-center gap-2">
                        <i data-lucide="log-in" class="w-4 h-4"></i>
                        <span>로그인</span>
                    </button>
                </form>

                <!-- 빠른 권한별 테스트 계정 원클릭 입력 버튼들 -->
                <div class="pt-3 border-t border-slate-100 space-y-2">
                    <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold text-slate-500">빠른 테스트용 계정 원클릭 선택</span>
                        <button type="button" id="link-to-register" class="text-[11px] text-blue-600 hover:underline font-bold">신규 계정 생성 →</button>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-xs">
                        <button type="button" class="btn-fill-account p-2 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-xl text-left font-bold transition" data-u="admin" data-p="admin123">
                            <div class="text-[10px] text-rose-600">전체 권한</div>
                            <div>🔴 총괄 관리자</div>
                        </button>
                        <button type="button" class="btn-fill-account p-2 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-xl text-left font-bold transition" data-u="manager" data-p="manager123">
                            <div class="text-[10px] text-blue-600">물류/생산/수불</div>
                            <div>🔵 자재 관리자</div>
                        </button>
                        <button type="button" class="btn-fill-account p-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-left font-bold transition" data-u="worker" data-p="worker123">
                            <div class="text-[10px] text-amber-600">현장작업/스캔</div>
                            <div>🟠 현장 작업자</div>
                        </button>
                        <button type="button" class="btn-fill-account p-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-xl text-left font-bold transition" data-u="viewer" data-p="viewer123">
                            <div class="text-[10px] text-slate-500">읽기 전용</div>
                            <div>⚪ 조회 전용</div>
                        </button>
                    </div>
                </div>

                <div class="text-center text-[10px] text-slate-400 pt-1">
                    ※ 허가된 대림오일 임직원만 접속할 수 있으며 모든 활동 로그가 기록됩니다.
                </div>
            </div>

            <!-- 2. 신규 계정 생성 패널 (기본 숨김) -->
            <div id="panel-register" class="hidden p-6 sm:p-8 space-y-4">
                <!-- 권한 안내 배너 -->
                <div class="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs leading-relaxed flex items-start gap-2.5">
                    <i data-lucide="shield-alert" class="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5"></i>
                    <div>
                        <span class="font-black text-amber-950 block mb-0.5">초기 권한 자동 부여 안내</span>
                        신규 계정 생성 시 즉시 현장 작업(생산입고, 스캔, 라벨, 재고조회 등)이 가능한 <span class="font-extrabold text-amber-800 bg-amber-100 px-1 py-0.5 rounded">현장 작업자 (OPERATOR)</span> 권한이 부여됩니다.
                        <div class="text-[10px] text-amber-700 mt-1">※ 관리자 권한은 계정 생성 후 총괄 관리자 또는 자재 관리자의 승인을 통해 부여받으실 수 있습니다.</div>
                    </div>
                </div>

                <form id="form-register" class="space-y-3.5">
                    <div id="reg-error-box" class="hidden p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
                        <i data-lucide="alert-circle" class="w-4 h-4 flex-shrink-0"></i>
                        <span id="reg-error-msg"></span>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">성명 / 작업자명 <span class="text-rose-500">*</span></label>
                        <div class="relative">
                            <i data-lucide="user-check" class="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none"></i>
                            <input type="text" id="reg-name" required placeholder="예: 강현장, 박기사" class="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">사용자 아이디 (Username) <span class="text-rose-500">*</span></label>
                        <div class="relative">
                            <i data-lucide="user" class="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none"></i>
                            <input type="text" id="reg-username" required placeholder="로그인에 사용할 아이디 (3자 이상)" class="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">비밀번호 (Password) <span class="text-rose-500">*</span></label>
                        <div class="relative">
                            <i data-lucide="lock" class="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none"></i>
                            <input type="password" id="reg-password" required placeholder="비밀번호 (4자 이상)" class="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-10 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
                            <button type="button" id="btn-toggle-reg-pw" class="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 p-0.5">
                                <i data-lucide="eye" id="icon-reg-eye" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">소속 부서 (선택)</label>
                        <div class="relative">
                            <i data-lucide="briefcase" class="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none"></i>
                            <select id="reg-dept" class="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2.5 text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none">
                                <option value="현장운영팀" selected>현장운영팀</option>
                                <option value="생산조립1팀">생산조립1팀</option>
                                <option value="생산조립2팀">생산조립2팀</option>
                                <option value="자재물류팀">자재물류팀</option>
                                <option value="품질관리팀">품질관리팀</option>
                                <option value="물류배송팀">물류배송팀</option>
                            </select>
                        </div>
                    </div>

                    <button type="submit" id="btn-register-submit" class="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold rounded-xl text-xs sm:text-sm transition shadow-md flex items-center justify-center gap-2 mt-2">
                        <i data-lucide="user-plus" class="w-4 h-4"></i>
                        <span>계정 생성 (현장 작업자 권한 부여)</span>
                    </button>
                </form>

                <div class="text-center pt-2">
                    <button type="button" id="link-to-login" class="text-xs text-slate-500 hover:text-blue-600 font-bold">
                        이미 계정이 있으신가요? <span class="text-blue-600 underline">로그인하기</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
    `;

    createIcons({ icons });

    // 탭 전환 제어
    const tabLogin = container.querySelector('#tab-btn-login');
    const tabRegister = container.querySelector('#tab-btn-register');
    const panelLogin = container.querySelector('#panel-login');
    const panelRegister = container.querySelector('#panel-register');

    const switchToLogin = () => {
        tabLogin.className = "flex-1 py-2.5 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 bg-white text-blue-600 shadow-sm border border-slate-200";
        tabRegister.className = "flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 text-slate-500 hover:text-slate-800 hover:bg-white/60";
        panelLogin.classList.remove('hidden');
        panelRegister.classList.add('hidden');
        createIcons({ icons });
    };

    const switchToRegister = () => {
        tabRegister.className = "flex-1 py-2.5 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 bg-white text-emerald-600 shadow-sm border border-slate-200";
        tabLogin.className = "flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 text-slate-500 hover:text-slate-800 hover:bg-white/60";
        panelLogin.classList.add('hidden');
        panelRegister.classList.remove('hidden');
        createIcons({ icons });
        setTimeout(() => container.querySelector('#reg-name')?.focus(), 50);
    };

    tabLogin?.addEventListener('click', switchToLogin);
    tabRegister?.addEventListener('click', switchToRegister);
    container.querySelector('#link-to-register')?.addEventListener('click', switchToRegister);
    container.querySelector('#link-to-login')?.addEventListener('click', switchToLogin);

    // 로그인 비밀번호 토글
    const pwInput = container.querySelector('#login-password');
    const btnTogglePw = container.querySelector('#btn-toggle-pw');
    let showPw = false;

    btnTogglePw?.addEventListener('click', () => {
        showPw = !showPw;
        pwInput.type = showPw ? 'text' : 'password';
        const eye = container.querySelector('#icon-eye');
        if (eye) eye.setAttribute('data-lucide', showPw ? 'eye-off' : 'eye');
        createIcons({ icons });
    });

    // 회원가입 비밀번호 토글
    const regPwInput = container.querySelector('#reg-password');
    const btnToggleRegPw = container.querySelector('#btn-toggle-reg-pw');
    let showRegPw = false;

    btnToggleRegPw?.addEventListener('click', () => {
        showRegPw = !showRegPw;
        regPwInput.type = showRegPw ? 'text' : 'password';
        const regEye = container.querySelector('#icon-reg-eye');
        if (regEye) regEye.setAttribute('data-lucide', showRegPw ? 'eye-off' : 'eye');
        createIcons({ icons });
    });

    // 빠른 테스트 계정 채우기
    container.querySelectorAll('.btn-fill-account').forEach(btn => {
        btn.addEventListener('click', () => {
            const u = btn.getAttribute('data-u');
            const p = btn.getAttribute('data-p');
            container.querySelector('#login-username').value = u;
            container.querySelector('#login-password').value = p;
        });
    });

    // 로그인 폼 제출
    const formLogin = container.querySelector('#form-login');
    const loginErrBox = container.querySelector('#login-error-box');
    const loginErrMsg = container.querySelector('#login-error-msg');
    const btnLoginSubmit = container.querySelector('#btn-login-submit');

    formLogin?.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginErrBox.classList.add('hidden');

        const username = container.querySelector('#login-username').value.trim();
        const password = container.querySelector('#login-password').value;
        const rememberMe = container.querySelector('#chk-remember-me').checked;

        btnLoginSubmit.disabled = true;
        btnLoginSubmit.innerHTML = `<span class="animate-spin mr-1.5">⏳</span> 인증 확인 중...`;

        try {
            const res = await login(username, password, rememberMe);
            if (res.success) {
                showToast(`🎉 환영합니다, ${res.user.name}님! (${res.user.role || '작업자'})`);
                onLoginSuccess(res.user);
            } else {
                loginErrBox.classList.remove('hidden');
                loginErrMsg.textContent = res.message || '아이디 또는 비밀번호가 올바르지 않습니다.';
                btnLoginSubmit.disabled = false;
                btnLoginSubmit.innerHTML = `<i data-lucide="log-in" class="w-4 h-4 mr-1"></i> <span>로그인</span>`;
                createIcons({ icons });
            }
        } catch (err) {
            loginErrBox.classList.remove('hidden');
            loginErrMsg.textContent = err.message || '로그인 처리 중 오류가 발생했습니다.';
            btnLoginSubmit.disabled = false;
            btnLoginSubmit.innerHTML = `<i data-lucide="log-in" class="w-4 h-4 mr-1"></i> <span>로그인</span>`;
            createIcons({ icons });
        }
    });

    // 신규 계정 생성 폼 제출
    const formRegister = container.querySelector('#form-register');
    const regErrBox = container.querySelector('#reg-error-box');
    const regErrMsg = container.querySelector('#reg-error-msg');
    const btnRegSubmit = container.querySelector('#btn-register-submit');

    formRegister?.addEventListener('submit', async (e) => {
        e.preventDefault();
        regErrBox.classList.add('hidden');

        const name = container.querySelector('#reg-name').value.trim();
        const username = container.querySelector('#reg-username').value.trim();
        const password = container.querySelector('#reg-password').value;
        const dept = container.querySelector('#reg-dept').value;

        btnRegSubmit.disabled = true;
        btnRegSubmit.innerHTML = `<span class="animate-spin mr-1.5">⏳</span> 계정 생성 중...`;

        try {
            const res = await registerUser({ name, username, password, dept });
            if (res.success) {
                showToast(`🎉 ${res.user.name}님의 계정이 생성되었습니다! (기본 권한: 현장 작업자)`);
                // 로그인 화면으로 전환 및 자동 채우기
                switchToLogin();
                container.querySelector('#login-username').value = username;
                container.querySelector('#login-password').value = password;
                loginErrBox.classList.add('hidden');
                btnRegSubmit.disabled = false;
                btnRegSubmit.innerHTML = `<i data-lucide="user-plus" class="w-4 h-4 mr-1"></i> <span>계정 생성 (현장 작업자 권한 부여)</span>`;
                createIcons({ icons });
            } else {
                regErrBox.classList.remove('hidden');
                regErrMsg.textContent = res.message || '계정 생성에 실패했습니다.';
                btnRegSubmit.disabled = false;
                btnRegSubmit.innerHTML = `<i data-lucide="user-plus" class="w-4 h-4 mr-1"></i> <span>계정 생성 (현장 작업자 권한 부여)</span>`;
                createIcons({ icons });
            }
        } catch (err) {
            regErrBox.classList.remove('hidden');
            regErrMsg.textContent = err.message || '계정 생성 중 오류가 발생했습니다.';
            btnRegSubmit.disabled = false;
            btnRegSubmit.innerHTML = `<i data-lucide="user-plus" class="w-4 h-4 mr-1"></i> <span>계정 생성 (현장 작업자 권한 부여)</span>`;
            createIcons({ icons });
        }
    });
};
