import { login, loginWithGoogle, registerUser, sendPasswordReset, resendConfirmation, isCloudAuth, ROLE_INFO } from '../services/auth.js';
import { createIcons, icons } from 'lucide';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BRAND_HEADER = `
    <div class="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white p-6 sm:p-8 text-center relative">
        <div class="h-16 px-3 mx-auto rounded-2xl bg-white flex items-center justify-center shadow-inner mb-3 w-fit">
            <img src="./logo.png" alt="대림" class="h-11 w-auto object-contain" />
        </div>
        <h1 class="text-xl sm:text-2xl font-black tracking-tight">대림오일 스마트 WMS</h1>
        <p class="text-xs text-blue-100 mt-1">자재·재고·생산·수불 통합 관리 시스템</p>
        <div class="mt-2 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white/15 text-white border border-white/20">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>보안 인증 게이트웨이</span>
        </div>
    </div>
`;

const GOOGLE_ICON = `<svg class="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

export const renderLoginView = (container, { onLoginSuccess, showToast, initialError = '' }) => {
    const cloudMode = isCloudAuth();
    const idLabel = cloudMode ? '이메일' : '사용자 아이디';
    const idType = cloudMode ? 'email' : 'text';

    container.innerHTML = `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-4 sm:p-6 select-none">
        <div class="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-700/40 relative">
            ${BRAND_HEADER}

            <!-- 로그인 / 계정 생성 탭 스위처 -->
            <div class="flex border-b border-slate-200 bg-slate-50/80 p-1.5 gap-1.5">
                <button type="button" id="tab-btn-login" class="flex-1 py-2.5 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 bg-white text-blue-600 shadow-sm border border-slate-200">
                    <i data-lucide="log-in" class="w-3.5 h-3.5"></i>
                    <span>로그인</span>
                </button>
                <button type="button" id="tab-btn-register" class="flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 text-slate-500 hover:text-slate-800 hover:bg-white/60 ${cloudMode ? '' : 'hidden'}">
                    <i data-lucide="user-plus" class="w-3.5 h-3.5"></i>
                    <span>신규 계정 생성</span>
                </button>
            </div>

            <!-- 1. 로그인 패널 -->
            <div id="panel-login" class="p-6 sm:p-8 space-y-5">
                <form id="form-login" class="space-y-4">
                    <div id="login-error-box" class="${initialError ? '' : 'hidden'} p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
                        <i data-lucide="alert-circle" class="w-4 h-4 flex-shrink-0"></i>
                        <span id="login-error-msg">${escapeHtml(initialError)}</span>
                    </div>
                    <div id="login-info-box" class="hidden p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2">
                        <i data-lucide="mail-check" class="w-4 h-4 flex-shrink-0"></i>
                        <span id="login-info-msg"></span>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">${idLabel}</label>
                        <div class="relative">
                            <i data-lucide="${cloudMode ? 'mail' : 'user'}" class="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none"></i>
                            <input type="${idType}" id="login-email" required autocomplete="${cloudMode ? 'email' : 'username'}" placeholder="${cloudMode ? 'name@daelimoil.co.kr' : '아이디를 입력하세요'}" class="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">비밀번호</label>
                        <div class="relative">
                            <i data-lucide="lock" class="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none"></i>
                            <input type="password" id="login-password" required autocomplete="current-password" placeholder="비밀번호를 입력하세요" class="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-10 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            <button type="button" id="btn-toggle-pw" class="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 p-0.5">
                                <i data-lucide="eye" id="icon-eye" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>

                    <div class="flex items-center justify-between pt-1">
                        <label class="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                            <input type="checkbox" id="chk-remember-me" checked class="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                            <span>자동 로그인 (상태 유지)</span>
                        </label>
                        ${cloudMode ? '<button type="button" id="btn-forgot-pw" class="text-[11px] text-blue-600 hover:underline font-bold">비밀번호 재설정</button>' : ''}
                    </div>

                    <button type="submit" id="btn-login-submit" class="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl text-xs sm:text-sm transition shadow-md flex items-center justify-center gap-2">
                        <i data-lucide="log-in" class="w-4 h-4"></i>
                        <span>로그인</span>
                    </button>
                </form>

                ${cloudMode ? `
                <div class="flex items-center gap-3 text-[11px] text-slate-400">
                    <div class="flex-1 h-px bg-slate-200"></div><span>또는</span><div class="flex-1 h-px bg-slate-200"></div>
                </div>
                <button type="button" id="btn-google-login" class="w-full py-2.5 bg-white hover:bg-slate-50 text-slate-800 font-bold rounded-xl text-xs sm:text-sm border border-slate-300 transition shadow-sm flex items-center justify-center gap-2">
                    ${GOOGLE_ICON}
                    <span>Google 계정으로 로그인</span>
                </button>
                <div class="text-center">
                    <button type="button" id="btn-resend-confirm" class="text-[11px] text-slate-500 hover:text-blue-600 font-bold">인증 메일을 받지 못하셨나요? <span class="underline">다시 보내기</span></button>
                </div>
                ` : ''}

                <div class="text-center text-[10px] text-slate-400 pt-1">
                    ※ 허가된 대림오일 임직원만 접속할 수 있으며 모든 활동 로그가 기록됩니다.
                </div>
            </div>

            <!-- 2. 신규 계정 생성 패널 (기본 숨김) -->
            <div id="panel-register" class="hidden p-6 sm:p-8 space-y-4">
                <div class="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs leading-relaxed flex items-start gap-2.5">
                    <i data-lucide="shield-alert" class="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5"></i>
                    <div>
                        <span class="font-black text-amber-950 block mb-0.5">가입 절차 안내</span>
                        1) 가입 후 입력한 이메일로 온 <b>인증 링크</b>를 누르세요.<br>
                        2) 관리자가 <b>승인하고 권한을 부여</b>하면 사용할 수 있습니다.
                        <div class="text-[10px] text-amber-700 mt-1">※ 승인 전에는 로그인해도 "승인 대기" 화면만 표시됩니다.</div>
                    </div>
                </div>

                <form id="form-register" class="space-y-3.5">
                    <div id="reg-error-box" class="hidden p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center gap-2">
                        <i data-lucide="alert-circle" class="w-4 h-4 flex-shrink-0"></i>
                        <span id="reg-error-msg"></span>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">성명 <span class="text-rose-500">*</span></label>
                        <div class="relative">
                            <i data-lucide="user-check" class="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none"></i>
                            <input type="text" id="reg-name" required autocomplete="name" placeholder="예: 홍현장" class="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">이메일 <span class="text-rose-500">*</span></label>
                        <div class="relative">
                            <i data-lucide="mail" class="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none"></i>
                            <input type="email" id="reg-email" required autocomplete="email" placeholder="인증 메일을 받을 실제 이메일" class="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">비밀번호 <span class="text-rose-500">*</span></label>
                        <div class="relative">
                            <i data-lucide="lock" class="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none"></i>
                            <input type="password" id="reg-password" required minlength="8" autocomplete="new-password" placeholder="8자 이상" class="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-10 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
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
                        <span>가입 신청</span>
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
        tabRegister.className = `flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 text-slate-500 hover:text-slate-800 hover:bg-white/60 ${cloudMode ? '' : 'hidden'}`;
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
    container.querySelector('#link-to-login')?.addEventListener('click', switchToLogin);

    // 비밀번호 보기 토글
    const bindPwToggle = (inputSel, btnSel, iconSel) => {
        const input = container.querySelector(inputSel);
        let shown = false;
        container.querySelector(btnSel)?.addEventListener('click', () => {
            shown = !shown;
            input.type = shown ? 'text' : 'password';
            container.querySelector(iconSel)?.setAttribute('data-lucide', shown ? 'eye-off' : 'eye');
            createIcons({ icons });
        });
    };
    bindPwToggle('#login-password', '#btn-toggle-pw', '#icon-eye');
    bindPwToggle('#reg-password', '#btn-toggle-reg-pw', '#icon-reg-eye');

    // 안내/오류 메시지
    const loginErrBox = container.querySelector('#login-error-box');
    const loginErrMsg = container.querySelector('#login-error-msg');
    const loginInfoBox = container.querySelector('#login-info-box');
    const loginInfoMsg = container.querySelector('#login-info-msg');
    const showLoginError = (msg) => {
        loginInfoBox.classList.add('hidden');
        loginErrBox.classList.remove('hidden');
        loginErrMsg.textContent = msg;
    };
    const showLoginInfo = (msg) => {
        loginErrBox.classList.add('hidden');
        loginInfoBox.classList.remove('hidden');
        loginInfoMsg.textContent = msg;
    };
    const emailInput = container.querySelector('#login-email');

    // 로그인 폼 제출
    const formLogin = container.querySelector('#form-login');
    const btnLoginSubmit = container.querySelector('#btn-login-submit');
    const resetLoginBtn = () => {
        btnLoginSubmit.disabled = false;
        btnLoginSubmit.innerHTML = `<i data-lucide="log-in" class="w-4 h-4 mr-1"></i> <span>로그인</span>`;
        createIcons({ icons });
    };

    formLogin?.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginErrBox.classList.add('hidden');

        const email = emailInput.value.trim();
        const password = container.querySelector('#login-password').value;
        const rememberMe = container.querySelector('#chk-remember-me').checked;

        btnLoginSubmit.disabled = true;
        btnLoginSubmit.innerHTML = `<span class="animate-spin mr-1.5">⏳</span> 인증 확인 중...`;

        try {
            const res = await login(email, password, rememberMe);
            if (res.success) {
                if (!res.pending) {
                    showToast(`🎉 환영합니다, ${res.user.name}님! (${ROLE_INFO[res.user.role]?.label || res.user.role})`);
                }
                onLoginSuccess(res.user);
            } else {
                showLoginError(res.message || '이메일 또는 비밀번호가 올바르지 않습니다.');
                resetLoginBtn();
            }
        } catch (err) {
            showLoginError(err.message || '로그인 처리 중 오류가 발생했습니다.');
            resetLoginBtn();
        }
    });

    // Google 로그인
    container.querySelector('#btn-google-login')?.addEventListener('click', async () => {
        const res = await loginWithGoogle();
        if (!res.success) showLoginError(res.message);
    });

    // 비밀번호 재설정 메일
    container.querySelector('#btn-forgot-pw')?.addEventListener('click', async () => {
        const email = emailInput.value.trim() || (prompt('비밀번호를 재설정할 이메일을 입력하세요:') || '').trim();
        if (!email) return;
        const res = await sendPasswordReset(email);
        if (res.success) showLoginInfo(`${email}로 비밀번호 재설정 메일을 보냈습니다. 메일의 링크를 누르면 새 비밀번호를 입력할 수 있습니다.`);
        else showLoginError(res.message);
    });

    // 인증 메일 다시 보내기
    container.querySelector('#btn-resend-confirm')?.addEventListener('click', async () => {
        const email = emailInput.value.trim() || (prompt('가입한 이메일을 입력하세요:') || '').trim();
        if (!email) return;
        const res = await resendConfirmation(email);
        if (res.success) showLoginInfo(`${email}로 인증 메일을 다시 보냈습니다.`);
        else showLoginError(res.message);
    });

    // 신규 계정 생성 폼 제출
    const formRegister = container.querySelector('#form-register');
    const regErrBox = container.querySelector('#reg-error-box');
    const regErrMsg = container.querySelector('#reg-error-msg');
    const btnRegSubmit = container.querySelector('#btn-register-submit');
    const resetRegBtn = () => {
        btnRegSubmit.disabled = false;
        btnRegSubmit.innerHTML = `<i data-lucide="user-plus" class="w-4 h-4 mr-1"></i> <span>가입 신청</span>`;
        createIcons({ icons });
    };

    formRegister?.addEventListener('submit', async (e) => {
        e.preventDefault();
        regErrBox.classList.add('hidden');

        const name = container.querySelector('#reg-name').value.trim();
        const email = container.querySelector('#reg-email').value.trim();
        const password = container.querySelector('#reg-password').value;
        const dept = container.querySelector('#reg-dept').value;

        btnRegSubmit.disabled = true;
        btnRegSubmit.innerHTML = `<span class="animate-spin mr-1.5">⏳</span> 가입 처리 중...`;

        try {
            const res = await registerUser({ name, email, password, dept });
            if (res.success) {
                switchToLogin();
                emailInput.value = email;
                showLoginInfo(res.needsEmailConfirm
                    ? `가입 신청이 접수되었습니다. ${email} 메일함에서 인증 링크를 누른 뒤, 관리자 승인을 기다려 주세요.`
                    : '가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.');
                resetRegBtn();
            } else {
                regErrBox.classList.remove('hidden');
                regErrMsg.textContent = res.message || '가입에 실패했습니다.';
                resetRegBtn();
            }
        } catch (err) {
            regErrBox.classList.remove('hidden');
            regErrMsg.textContent = err.message || '가입 처리 중 오류가 발생했습니다.';
            resetRegBtn();
        }
    });
};

// 승인 대기 화면 (메일 인증은 끝났지만 관리자가 아직 역할을 부여하지 않은 사용자)
export const renderPendingView = (container, { user, onRecheck, onLogout }) => {
    container.innerHTML = `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-4 sm:p-6 select-none">
        <div class="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-700/40">
            ${BRAND_HEADER}
            <div class="p-6 sm:p-8 space-y-4 text-center">
                <div class="w-14 h-14 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
                    <i data-lucide="hourglass" class="w-7 h-7 text-amber-600"></i>
                </div>
                <h2 class="text-lg font-black text-slate-900">관리자 승인 대기 중</h2>
                <p class="text-xs text-slate-600 leading-relaxed">
                    <b>${escapeHtml(user?.name || '')}</b> (${escapeHtml(user?.email || '')})님의 가입 신청이 접수되었습니다.<br>
                    관리자가 승인하고 권한을 부여하면 사용할 수 있습니다.
                </p>
                <div class="flex gap-2 pt-2">
                    <button type="button" id="btn-pending-recheck" class="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5">
                        <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i><span>승인 여부 다시 확인</span>
                    </button>
                    <button type="button" id="btn-pending-logout" class="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5">
                        <i data-lucide="log-out" class="w-3.5 h-3.5"></i><span>로그아웃</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
    `;
    createIcons({ icons });
    container.querySelector('#btn-pending-recheck')?.addEventListener('click', () => onRecheck());
    container.querySelector('#btn-pending-logout')?.addEventListener('click', () => onLogout());
};
