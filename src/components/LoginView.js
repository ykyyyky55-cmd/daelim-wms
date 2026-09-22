import { login } from '../services/auth.js';

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
                    <span>클라우드 보안 접속 게이트</span>
                </div>
            </div>

            <!-- 로그인 입력 폼 -->
            <div class="p-6 sm:p-8 space-y-5">
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
                    <span class="text-[11px] font-bold text-slate-500 block text-center">빠른 테스트용 계정 원클릭 선택</span>
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
        </div>
    </div>
    `;

    // 비밀번호 보기/숨기기 토글
    const pwInput = container.querySelector('#login-password');
    const btnTogglePw = container.querySelector('#btn-toggle-pw');
    let showPw = false;

    btnTogglePw?.addEventListener('click', () => {
        showPw = !showPw;
        pwInput.type = showPw ? 'text' : 'password';
        const eye = container.querySelector('#icon-eye');
        if (eye) {
            eye.setAttribute('data-lucide', showPw ? 'eye-off' : 'eye');
        }
    });

    // 빠른 계정 채우기
    container.querySelectorAll('.btn-fill-account').forEach(btn => {
        btn.addEventListener('click', () => {
            const u = btn.getAttribute('data-u');
            const p = btn.getAttribute('data-p');
            container.querySelector('#login-username').value = u;
            container.querySelector('#login-password').value = p;
        });
    });

    // 폼 제출
    const form = container.querySelector('#form-login');
    const errBox = container.querySelector('#login-error-box');
    const errMsg = container.querySelector('#login-error-msg');
    const btnSubmit = container.querySelector('#btn-login-submit');

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        errBox.classList.add('hidden');

        const username = container.querySelector('#login-username').value.trim();
        const password = container.querySelector('#login-password').value;
        const rememberMe = container.querySelector('#chk-remember-me').checked;

        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<span class="animate-spin mr-1.5">⏳</span> 인증 확인 중...`;

        try {
            const res = await login(username, password, rememberMe);
            if (res.success) {
                showToast(`🎉 환영합니다, ${res.user.name}님! (${res.user.role || '작업자'})`);
                onLoginSuccess(res.user);
            } else {
                errBox.classList.remove('hidden');
                errMsg.textContent = res.message || '아이디 또는 비밀번호가 올바르지 않습니다.';
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = `<span>로그인</span>`;
            }
        } catch (err) {
            errBox.classList.remove('hidden');
            errMsg.textContent = err.message || '로그인 처리 중 오류가 발생했습니다.';
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `<span>로그인</span>`;
        }
    });
};
