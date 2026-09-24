import { state, commitStockAudit } from '../services/db.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';
import { matchesQuery } from '../services/searchUtils.js';

export const GOOGLE_AUDIT_URL = "https://script.google.com/macros/s/AKfycbw169OmPBTWmBgzgHfMeSJa9yxRLSEPYBbPQbL0vF13tv_8WQNG4I6sg2XVf_KAXcNF/exec";

// 4대 거점 명칭 정규화 함수 (구글 실사표 축약명 ↔ WMS 정식 거점명 매핑)
export const normalizeLocation = (loc) => {
    if (!loc) return '';
    const clean = String(loc).trim();
    if (clean === '본사' || clean === '본사 창고' || clean.includes('본사')) return '본사 창고';
    if (clean === '방산' || clean === '방산 창고' || clean.includes('방산')) return '방산 창고';
    if (clean === '김포' || clean === '김포공장' || clean.includes('김포')) return '김포공장';
    if (clean === '대림오일' || clean === '대림오일 창고' || clean.includes('대림오일')) return '대림오일 창고';
    return clean;
};

export const renderAuditManager = (container, { showToast, onRefresh, onSwitchTab }) => {
    // 임시 실사 입력 맵: `${code}___${location}` -> { actualQty, reason }
    const workingMap = {};
    let activeSubTab = 'google-live'; // 'google-live' | 'wms-audit'
    let selectedLocFilter = '';

    container.innerHTML = `
    <section id="tab-content-audit" class="space-y-6">
        <!-- 상단 서브 탭 내비게이션 바 -->
        <div class="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 sm:p-3 rounded-2xl border border-slate-200 shadow-sm">
            <div class="flex items-center gap-2">
                <button type="button" id="btn-subtab-google-live" class="subtab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs sm:text-sm transition-all shadow-xs ${activeSubTab === 'google-live' ? 'bg-teal-600 text-white shadow-md shadow-teal-600/20' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
                    <i data-lucide="globe" class="w-4 h-4"></i>
                    <span>대림기업 실시간 재고실사 (구글 연동)</span>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-400 text-slate-900 animate-pulse">LIVE</span>
                </button>
                <button type="button" id="btn-subtab-wms-audit" class="subtab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs sm:text-sm transition-all shadow-xs ${activeSubTab === 'wms-audit' ? 'bg-teal-600 text-white shadow-md shadow-teal-600/20' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
                    <i data-lucide="clipboard-check" class="w-4 h-4"></i>
                    <span>WMS 전산 재고 실사 & 4대 거점 오차 보정</span>
                </button>
            </div>
            <div class="flex items-center gap-2 text-xs font-bold text-slate-500 pr-2">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>4대 거점: 본사 · 방산 · 김포 · 대림오일</span>
            </div>
        </div>

        <!-- 1. [서브 탭 1] 대림기업 온라인 실시간 재고실사 (구글 연동 뷰) -->
        <div id="subtab-pane-google-live" class="${activeSubTab === 'google-live' ? 'block' : 'hidden'} space-y-4">
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                    <div class="space-y-1">
                        <div class="flex items-center gap-2">
                            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200">구글 클라우드 공식 웹앱</span>
                            <span class="inline-flex items-center gap-1.5 text-xs text-slate-500 font-mono">
                                <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                실시간 동기화 (최대 20초 주기)
                            </span>
                        </div>
                        <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                            <i data-lucide="table-properties" class="w-5 h-5 text-teal-600"></i>
                            <span>대림기업 4대 거점 실시간 재고실사 온라인 입력 시스템</span>
                        </h2>
                        <p class="text-xs text-slate-500">
                            현장 담당자(본사, 방산, 김포, 대림오일)가 입력한 실사 수량이 구글 클라우드 스프레드시트에 즉시 기록되며 본 화면에 실시간 연동됩니다.
                        </p>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        <!-- 구글 계정 로그인 & 실사창 열기 버튼 (Google 공식 스타일) -->
                        <button type="button" id="btn-google-login-audit" class="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 text-xs font-black rounded-xl transition flex items-center gap-2 border border-slate-300 shadow-sm hover:border-slate-400" title="구글 계정으로 로그인하고 실시간 재고실사 웹앱을 엽니다.">
                            <svg class="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
                            <span>구글 계정 로그인 & 실사 열기</span>
                        </button>

                        <!-- 새 창으로 열기 버튼 -->
                        <button type="button" id="btn-open-google-audit-newtab" class="px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-black rounded-xl transition flex items-center gap-1.5 shadow-md shadow-teal-600/20" title="전체화면 새 브라우저 탭으로 실사 웹앱을 엽니다.">
                            <i data-lucide="external-link" class="w-4 h-4"></i>
                            <span>새 탭에서 열기</span>
                        </button>

                        <!-- 새로고침 버튼 -->
                        <button type="button" id="btn-reload-google-audit" class="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm" title="임베드된 실사 화면을 새로고침합니다.">
                            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                            <span>실사 화면 새로고침</span>
                        </button>

                        <!-- 링크 복사 버튼 -->
                        <button type="button" id="btn-copy-google-audit-url" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center gap-1.5 border border-slate-300 shadow-2xs" title="구글 실사 웹앱 링크 URL을 클립보드에 복사합니다.">
                            <i data-lucide="copy" class="w-4 h-4"></i>
                            <span>실사 링크 복사</span>
                        </button>

                        <!-- WMS 전산 보정 탭 바로가기 -->
                        <button type="button" id="btn-goto-wms-audit" class="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold rounded-xl transition flex items-center gap-1.5" title="WMS 전산 재고 일괄 보정 화면으로 전환합니다.">
                            <i data-lucide="arrow-right" class="w-4 h-4"></i>
                            <span>WMS 전산 보정 이동</span>
                        </button>
                    </div>
                </div>

                <!-- 안내 및 팁 카드 -->
                <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center flex-shrink-0 font-bold text-xs">HQ</div>
                        <div>
                            <span class="text-[11px] font-bold text-slate-500 block">거점 1</span>
                            <span class="text-xs font-black text-slate-900">본사 창고 (본사)</span>
                        </div>
                    </div>
                    <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center flex-shrink-0 font-bold text-xs">BS</div>
                        <div>
                            <span class="text-[11px] font-bold text-slate-500 block">거점 2</span>
                            <span class="text-xs font-black text-slate-900">방산 창고 (방산)</span>
                        </div>
                    </div>
                    <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0 font-bold text-xs">GM</div>
                        <div>
                            <span class="text-[11px] font-bold text-slate-500 block">거점 3</span>
                            <span class="text-xs font-black text-slate-900">김포공장 (김포)</span>
                        </div>
                    </div>
                    <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0 font-bold text-xs">DO</div>
                        <div>
                            <span class="text-[11px] font-bold text-slate-500 block">거점 4</span>
                            <span class="text-xs font-black text-slate-900">대림오일 창고 (대림오일)</span>
                        </div>
                    </div>
                </div>

                <!-- 구글 계정 로그인 안내 & 연결 상태 바 -->
                <div class="p-3.5 bg-gradient-to-r from-blue-50 via-teal-50 to-indigo-50 border border-blue-200/80 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0 shadow-2xs">
                            <i data-lucide="shield-check" class="w-4 h-4"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="font-black text-slate-900">구글 계정 로그인 및 실시간 실사 동기화</span>
                                <span id="badge-google-conn-status" class="px-2 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">구글 로그인 대기중</span>
                            </div>
                            <p class="text-slate-600 text-[11px] mt-0.5">
                                구글 계정에 로그인되어 있어야 구글 클라우드 실사 웹앱과 데이터가 실시간으로 로드됩니다. 화면이 하얗게 나오면 아래 [구글 로그인 (팝업창)]을 클릭하세요.
                            </p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" id="btn-banner-google-login" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition flex items-center gap-1.5 shadow-xs">
                            <i data-lucide="log-in" class="w-3.5 h-3.5"></i>
                            <span>구글 로그인 (팝업창)</span>
                        </button>
                        <button type="button" id="btn-banner-google-reload" class="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-lg border border-slate-300 transition flex items-center gap-1">
                            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
                            <span>실사 재불러오기</span>
                        </button>
                    </div>
                </div>

                <!-- 구글 실사 웹앱 임베드 프레임 -->
                <div class="relative w-full rounded-2xl border-2 border-slate-200 overflow-hidden bg-slate-100 shadow-inner">
                    <div id="iframe-loading-bar" class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-teal-500 via-indigo-500 to-teal-500 animate-pulse z-10"></div>
                    <iframe 
                        id="google-audit-iframe" 
                        src="${GOOGLE_AUDIT_URL}" 
                        class="w-full min-h-[850px] sm:min-h-[920px] bg-white border-none"
                        allow="clipboard-read; clipboard-write; fullscreen"
                        title="대림기업 재고실사 웹앱">
                    </iframe>
                </div>

                <!-- 연동 사용 가이드 -->
                <div class="p-4 bg-teal-50/60 rounded-xl border border-teal-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
                    <div class="flex items-start gap-2.5">
                        <i data-lucide="info" class="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5"></i>
                        <div class="space-y-0.5">
                            <span class="font-bold text-teal-900">💡 구글 실사 웹앱 조작 팁</span>
                            <p class="text-teal-700 leading-relaxed">
                                화면 상단에서 <b>담당자 이름</b>을 입력하신 후, <b>본사 / 방산 / 김포 / 대림오일</b> 탭을 클릭하여 해당 거점의 실사 수량을 입력하시면 실시간으로 저장됩니다.
                                만약 화면이 작거나 터치가 불편하실 경우 상단의 <b>[새 창에서 실사 웹앱 열기]</b>를 클릭하여 전체 화면으로 작업하세요.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 2. [서브 탭 2] WMS 전산 재고 실사 & 4대 거점 오차 보정 뷰 -->
        <div id="subtab-pane-wms-audit" class="${activeSubTab === 'wms-audit' ? 'block' : 'hidden'} space-y-4">
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                    <div>
                        <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                            <i data-lucide="clipboard-check" class="w-5 h-5 text-teal-600"></i>
                            <span>WMS 전산 재고 실사 & 4대 거점 오차 보정</span>
                        </h2>
                        <p class="text-xs text-slate-500 mt-1">
                            실사 일자를 등록하고, 현장 실사 수량을 입력하여 전산 장부 재고와의 오차(초과/손실)를 산출하고 일괄 반영합니다.
                        </p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <!-- 1. 재고실사 엑셀 양식 작성 및 다운로드 -->
                        <button type="button" id="btn-export-audit-template" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm" title="현재 재고 품목이 채워진 표준 실사 엑셀 양식을 다운로드합니다.">
                            <i data-lucide="file-spreadsheet" class="w-4 h-4"></i>
                            <span>실사 양식(Excel) 다운로드</span>
                        </button>

                        <!-- 2. 실사 엑셀 파일 업로드 및 자동 반영 -->
                        <label for="input-upload-audit-file" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm cursor-pointer" title="작성된 실사 엑셀 파일을 업로드하면 오차를 자동 계산하여 전산 재고에 즉시 반영합니다.">
                            <i data-lucide="upload-cloud" class="w-4 h-4"></i>
                            <span>실사 파일 업로드 (자동 반영)</span>
                            <input type="file" id="input-upload-audit-file" accept=".xlsx, .xls, .csv" class="hidden" />
                        </label>

                        <button type="button" id="btn-open-audit-hist-modal" class="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                            <i data-lucide="history" class="w-4 h-4 text-teal-400"></i>
                            <span>일자별 실사 이력</span>
                        </button>
                        <button type="button" id="btn-commit-audit" class="px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-black rounded-xl transition flex items-center gap-1.5 shadow-md shadow-teal-600/20">
                            <i data-lucide="save" class="w-4 h-4"></i>
                            <span>화면 실사 수량 전산 일괄 반영</span>
                        </button>
                    </div>
                </div>

                <!-- 4대 거점 퀵 필터 칩 & 통계 요약 타일 바 -->
                <div class="space-y-3">
                    <!-- 거점 선택 탭 버튼 -->
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-xs font-bold text-slate-500 mr-1">4대 거점 선택:</span>
                        <button type="button" class="btn-loc-chip px-3 py-1.5 rounded-xl text-xs font-bold transition ${!selectedLocFilter ? 'bg-teal-600 text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}" data-loc="">
                            전체 거점
                        </button>
                        <button type="button" class="btn-loc-chip px-3 py-1.5 rounded-xl text-xs font-bold transition ${selectedLocFilter === '본사 창고' ? 'bg-teal-600 text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}" data-loc="본사 창고">
                            본사 창고 (본사)
                        </button>
                        <button type="button" class="btn-loc-chip px-3 py-1.5 rounded-xl text-xs font-bold transition ${selectedLocFilter === '방산 창고' ? 'bg-teal-600 text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}" data-loc="방산 창고">
                            방산 창고 (방산)
                        </button>
                        <button type="button" class="btn-loc-chip px-3 py-1.5 rounded-xl text-xs font-bold transition ${selectedLocFilter === '김포공장' ? 'bg-teal-600 text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}" data-loc="김포공장">
                            김포공장 (김포)
                        </button>
                        <button type="button" class="btn-loc-chip px-3 py-1.5 rounded-xl text-xs font-bold transition ${selectedLocFilter === '대림오일 창고' ? 'bg-teal-600 text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}" data-loc="대림오일 창고">
                            대림오일 창고 (대림오일)
                        </button>
                    </div>

                    <!-- 실사 현황 요약 타일 4개 -->
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3">
                            <span class="text-[11px] font-bold text-slate-500 block">실사 대상 품목</span>
                            <div class="flex items-baseline gap-1 mt-0.5">
                                <span class="text-xl font-black text-slate-900" id="stat-total-items">0</span>
                                <span class="text-xs text-slate-500">건</span>
                            </div>
                        </div>
                        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3">
                            <span class="text-[11px] font-bold text-slate-500 block">수량 수정/실사 입력</span>
                            <div class="flex items-baseline gap-1 mt-0.5">
                                <span class="text-xl font-black text-teal-600" id="stat-inputted-items">0</span>
                                <span class="text-xs text-slate-500">건 완료</span>
                            </div>
                        </div>
                        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3">
                            <span class="text-[11px] font-bold text-slate-500 block">전산 수량 일치</span>
                            <div class="flex items-baseline gap-1 mt-0.5">
                                <span class="text-xl font-black text-slate-700" id="stat-match-items">0</span>
                                <span class="text-xs text-slate-500">건</span>
                            </div>
                        </div>
                        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3">
                            <span class="text-[11px] font-bold text-slate-500 block">오차 발생 (초과/손실)</span>
                            <div class="flex items-baseline gap-1 mt-0.5">
                                <span class="text-xl font-black text-rose-600" id="stat-diff-items">0</span>
                                <span class="text-xs text-rose-500 font-bold">건 확인필요</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 실사 설정 & 필터 바 (실사 일자 등록 + 부분문자 검색) -->
                <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                    <div class="flex flex-wrap items-center gap-3">
                        <div class="flex items-center gap-1.5 bg-white px-2.5 py-1.5 border border-slate-300 rounded-lg shadow-2xs">
                            <i data-lucide="calendar" class="w-4 h-4 text-teal-600"></i>
                            <span class="text-xs font-bold text-slate-700">실사 등록 일자:</span>
                            <input type="date" id="audit-reg-date" value="${new Date().toISOString().slice(0, 10)}" class="text-xs font-bold text-slate-900 bg-transparent focus:outline-none" />
                        </div>

                        <div class="flex items-center gap-1.5">
                            <span class="text-xs font-bold text-slate-600">거점 드롭다운:</span>
                            <select id="audit-filter-loc" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                                <option value="">전체 거점</option>
                                <option value="본사 창고">본사 창고 (본사)</option>
                                <option value="방산 창고">방산 창고 (방산)</option>
                                <option value="김포공장">김포공장 (김포)</option>
                                <option value="대림오일 창고">대림오일 창고 (대림오일)</option>
                                ${state.locations.filter(l => !['본사 창고', '방산 창고', '김포공장', '대림오일 창고'].includes(l)).map(l => `<option value="${l}">${l}</option>`).join('')}
                            </select>
                        </div>

                        <label class="flex items-center gap-1.5 cursor-pointer bg-white px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 shadow-2xs">
                            <input type="checkbox" id="audit-filter-diff-only" class="rounded text-teal-600 focus:ring-teal-500" />
                            <span class="text-teal-700">오차/수정 품목만 보기</span>
                        </label>
                    </div>

                    <div class="relative">
                        <input type="text" id="audit-search-input" placeholder="품목코드, 품명, 규격 검색 (일부문자 인식)..." class="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-teal-500 focus:outline-none w-72" />
                        <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2"></i>
                    </div>
                </div>

                <!-- 실사 테이블 -->
                <div class="overflow-x-auto rounded-xl border border-slate-200">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-100 text-slate-700 border-b border-slate-200 font-bold">
                            <tr>
                                <th class="p-3">보관 거점</th>
                                <th class="p-3">품목코드</th>
                                <th class="p-3">품목명</th>
                                <th class="p-3">규격 / 단위</th>
                                <th class="p-3 text-right">전산 장부 수량</th>
                                <th class="p-3 text-right">현장 실사 수량</th>
                                <th class="p-3 text-center">오차 수량</th>
                                <th class="p-3">오차 사유 / 비고</th>
                            </tr>
                        </thead>
                        <tbody id="audit-table-body" class="divide-y divide-slate-100"></tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- 일자별 실사 이력 조회 모달 -->
        <div id="modal-audit-history" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
            <div class="bg-white max-w-3xl w-full rounded-2xl shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[85vh]">
                <div class="px-5 py-4 bg-slate-900 text-white flex justify-between items-center flex-shrink-0">
                    <div class="flex items-center gap-2">
                        <i data-lucide="history" class="w-5 h-5 text-teal-400"></i>
                        <h3 class="font-bold text-sm">일자별 실사 이력 & 전산 오차 감사 로그</h3>
                    </div>
                    <button type="button" id="btn-close-audit-hist" class="text-slate-400 hover:text-white text-xl">&times;</button>
                </div>

                <div class="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs flex-shrink-0">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-slate-700">조회 일자 선택:</span>
                        <input type="date" id="audit-hist-date-picker" value="${new Date().toISOString().slice(0, 10)}" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-900" />
                        <button type="button" id="btn-audit-hist-search" class="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold">조회</button>
                    </div>
                    <span id="audit-hist-count-badge" class="font-bold text-slate-500">총 0건의 실사 기록</span>
                </div>

                <div class="p-4 overflow-y-auto flex-1">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-100 text-slate-700 font-bold sticky top-0">
                            <tr>
                                <th class="p-2.5">일시</th>
                                <th class="p-2.5">거점</th>
                                <th class="p-2.5">품목코드</th>
                                <th class="p-2.5">품목명</th>
                                <th class="p-2.5 text-right">실사반영수량</th>
                                <th class="p-2.5">작업자</th>
                                <th class="p-2.5">오차 및 사유</th>
                            </tr>
                        </thead>
                        <tbody id="audit-hist-table-body" class="divide-y divide-slate-100"></tbody>
                    </table>
                </div>
            </div>
        </div>
    </section>
    `;

    // 서브 탭 전환 함수
    const switchSubTab = (tab) => {
        activeSubTab = tab;
        const btnGoogle = container.querySelector('#btn-subtab-google-live');
        const btnWms = container.querySelector('#btn-subtab-wms-audit');
        const paneGoogle = container.querySelector('#subtab-pane-google-live');
        const paneWms = container.querySelector('#subtab-pane-wms-audit');

        if (tab === 'google-live') {
            btnGoogle.className = 'subtab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs sm:text-sm transition-all shadow-md shadow-teal-600/20 bg-teal-600 text-white';
            btnWms.className = 'subtab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs sm:text-sm transition-all shadow-xs bg-slate-100 hover:bg-slate-200 text-slate-700';
            paneGoogle.classList.remove('hidden');
            paneWms.classList.add('hidden');
        } else {
            btnWms.className = 'subtab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs sm:text-sm transition-all shadow-md shadow-teal-600/20 bg-teal-600 text-white';
            btnGoogle.className = 'subtab-btn flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs sm:text-sm transition-all shadow-xs bg-slate-100 hover:bg-slate-200 text-slate-700';
            paneWms.classList.remove('hidden');
            paneGoogle.classList.add('hidden');
            renderTable();
        }
        createIcons({ icons });
    };

    container.querySelector('#btn-subtab-google-live')?.addEventListener('click', () => switchSubTab('google-live'));
    container.querySelector('#btn-subtab-wms-audit')?.addEventListener('click', () => switchSubTab('wms-audit'));
    container.querySelector('#btn-goto-wms-audit')?.addEventListener('click', () => switchSubTab('wms-audit'));

    // 구글 로그인 상태 관리 헬퍼
    const updateGoogleAuthBadge = () => {
        const isConnected = localStorage.getItem('daelim_google_connected') === 'true';
        const badge = container.querySelector('#badge-google-conn-status');
        if (badge) {
            if (isConnected) {
                badge.textContent = '🟢 구글 연동 활성화됨';
                badge.className = 'px-2 py-0.2 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300';
            } else {
                badge.textContent = '⚪ 구글 로그인 대기중';
                badge.className = 'px-2 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300';
            }
        }
    };

    // 구글 로그인 팝업 및 실사창 열기 함수
    const openGoogleLoginAndAudit = () => {
        const w = 1040;
        const h = 880;
        const left = Math.max(0, Math.round((window.screen.width - w) / 2));
        const top = Math.max(0, Math.round((window.screen.height - h) / 2));
        const popup = window.open(
            GOOGLE_AUDIT_URL, 
            'GoogleAuditAppPopup', 
            `width=${w},height=${h},top=${top},left=${left},status=yes,toolbar=no,menubar=no,location=yes,scrollbars=yes,resizable=yes`
        );
        if (popup) {
            popup.focus();
            localStorage.setItem('daelim_google_connected', 'true');
            updateGoogleAuthBadge();
            showToast('🔐 구글 로그인 창이 열렸습니다. 구글 계정 로그인 후 실사 데이터를 바로 입력하세요.');
        } else {
            window.open(GOOGLE_AUDIT_URL, '_blank');
            showToast('🚀 새 탭에서 구글 실사 웹앱이 열렸습니다.');
        }
    };

    // 실사 화면 새로고침 헬퍼
    const reloadGoogleAuditIframe = () => {
        const iframe = container.querySelector('#google-audit-iframe');
        const bar = container.querySelector('#iframe-loading-bar');
        if (iframe) {
            if (bar) bar.style.display = 'block';
            iframe.src = `${GOOGLE_AUDIT_URL}?t=${Date.now()}`;
            showToast('🔄 구글 실사 화면을 새로고침했습니다.');
            setTimeout(() => {
                if (bar) bar.style.display = 'none';
            }, 2500);
        }
    };

    // [구글 실사 웹앱 액션 버튼들]
    container.querySelector('#btn-google-login-audit')?.addEventListener('click', openGoogleLoginAndAudit);
    container.querySelector('#btn-banner-google-login')?.addEventListener('click', openGoogleLoginAndAudit);
    container.querySelector('#btn-banner-google-reload')?.addEventListener('click', reloadGoogleAuditIframe);
    container.querySelector('#btn-reload-google-audit')?.addEventListener('click', reloadGoogleAuditIframe);

    container.querySelector('#btn-open-google-audit-newtab')?.addEventListener('click', () => {
        window.open(GOOGLE_AUDIT_URL, '_blank', 'noopener,noreferrer');
        showToast('🚀 대림기업 실시간 재고실사 웹앱이 새 브라우저 창에서 열렸습니다.');
    });

    container.querySelector('#btn-copy-google-audit-url')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(GOOGLE_AUDIT_URL);
            showToast('📋 대림기업 실사 웹앱 링크가 복사되었습니다!');
        } catch {
            showToast(`실사 링크: ${GOOGLE_AUDIT_URL}`);
        }
    });

    // 초기 구글 연동 배지 상태 반영
    updateGoogleAuthBadge();

    // 4대 거점 퀵 칩 이벤트
    container.querySelectorAll('.btn-loc-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedLocFilter = btn.getAttribute('data-loc') || '';
            const selectEl = container.querySelector('#audit-filter-loc');
            if (selectEl) selectEl.value = selectedLocFilter;

            container.querySelectorAll('.btn-loc-chip').forEach(b => {
                const isSelected = (b.getAttribute('data-loc') || '') === selectedLocFilter;
                b.className = `btn-loc-chip px-3 py-1.5 rounded-xl text-xs font-bold transition ${isSelected ? 'bg-teal-600 text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`;
            });
            renderTable();
        });
    });

    const updateStats = (items) => {
        const total = items.length;
        let inputted = 0;
        let matched = 0;
        let diffed = 0;

        items.forEach(inv => {
            const key = `${inv.code}___${inv.location}`;
            const actual = workingMap[key] !== undefined ? workingMap[key].actualQty : inv.quantity;
            const diff = actual - inv.quantity;

            if (workingMap[key] !== undefined) inputted++;
            if (diff === 0) matched++;
            else diffed++;
        });

        const statTotal = container.querySelector('#stat-total-items');
        const statInputted = container.querySelector('#stat-inputted-items');
        const statMatched = container.querySelector('#stat-match-items');
        const statDiffed = container.querySelector('#stat-diff-items');

        if (statTotal) statTotal.textContent = total.toLocaleString();
        if (statInputted) statInputted.textContent = inputted.toLocaleString();
        if (statMatched) statMatched.textContent = matched.toLocaleString();
        if (statDiffed) statDiffed.textContent = diffed.toLocaleString();
    };

    const renderTable = () => {
        const locFilter = container.querySelector('#audit-filter-loc')?.value || selectedLocFilter;
        const diffOnly = container.querySelector('#audit-filter-diff-only')?.checked || false;
        const search = (container.querySelector('#audit-search-input')?.value || '').trim();

        const items = state.inventory.filter(inv => {
            const masterItem = state.master.find(m => m.code === inv.code) || {};
            const matchesLoc = !locFilter || inv.location === locFilter;
            
            // 부분 문자 인식 검색
            const matchesSearch = !search || matchesQuery({
                ...inv,
                supplier: masterItem.supplier || '',
                spec: inv.spec || masterItem.spec || '',
                category: inv.category || masterItem.category || ''
            }, search, ['code', 'name', 'spec', 'supplier', 'location']);

            if (!matchesLoc || !matchesSearch) return false;

            const key = `${inv.code}___${inv.location}`;
            const actual = workingMap[key] !== undefined ? workingMap[key].actualQty : inv.quantity;
            const diff = actual - inv.quantity;

            if (diffOnly && diff === 0) return false;
            return true;
        });

        updateStats(items);

        const tbody = container.querySelector('#audit-table-body');
        if (!tbody) return;

        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-400 text-xs">실사 대상 품목이 없습니다. (검색 조건 또는 거점 필터를 확인하세요)</td></tr>`;
            return;
        }

        tbody.innerHTML = items.map(inv => {
            const masterItem = state.master.find(m => m.code === inv.code) || {};
            const key = `${inv.code}___${inv.location}`;
            const actual = workingMap[key] !== undefined ? workingMap[key].actualQty : inv.quantity;
            const diff = actual - inv.quantity;

            let diffBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">일치</span>`;
            if (diff > 0) {
                diffBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700">+${diff.toLocaleString()} EA (초과)</span>`;
            } else if (diff < 0) {
                diffBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-700">${diff.toLocaleString()} EA (손실)</span>`;
            }

            return `
            <tr class="hover:bg-slate-50 transition" data-key="${key}">
                <td class="p-3 font-bold text-slate-800 flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full ${inv.location.includes('본사') ? 'bg-teal-500' : inv.location.includes('방산') ? 'bg-indigo-500' : inv.location.includes('김포') ? 'bg-blue-500' : 'bg-amber-500'}"></span>
                    <span>${inv.location}</span>
                </td>
                <td class="p-3 font-mono font-bold text-blue-600">${inv.code}</td>
                <td class="p-3 font-bold text-slate-900">${inv.name}</td>
                <td class="p-3 text-slate-500 font-medium">${inv.spec || masterItem.spec || '-'} / <span class="font-bold text-slate-700">${inv.unit || 'EA'}</span></td>
                <td class="p-3 text-right font-mono font-bold text-slate-500">${Number(inv.quantity).toLocaleString()} ${inv.unit || 'EA'}</td>
                <td class="p-3 text-right">
                    <input type="number" min="0" value="${actual}" class="input-actual-qty w-24 text-right bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-black text-slate-900 focus:ring-2 focus:ring-teal-500" data-key="${key}" data-book="${inv.quantity}" />
                </td>
                <td class="p-3 text-center diff-cell">${diffBadge}</td>
                <td class="p-3">
                    <input type="text" placeholder="오차 사유 (선택)" value="${workingMap[key]?.reason || ''}" class="input-reason w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-700 focus:ring-2 focus:ring-teal-500" data-key="${key}" />
                </td>
            </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.input-actual-qty').forEach(input => {
            input.addEventListener('input', (e) => {
                const key = input.getAttribute('data-key');
                const book = Number(input.getAttribute('data-book')) || 0;
                const val = Number(e.target.value) || 0;
                if (!workingMap[key]) workingMap[key] = { actualQty: val, reason: '' };
                workingMap[key].actualQty = val;

                const diff = val - book;
                const row = input.closest('tr');
                const diffCell = row.querySelector('.diff-cell');
                if (diff === 0) {
                    diffCell.innerHTML = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">일치</span>`;
                } else if (diff > 0) {
                    diffCell.innerHTML = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700">+${diff.toLocaleString()} EA (초과)</span>`;
                } else {
                    diffCell.innerHTML = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-700">${diff.toLocaleString()} EA (손실)</span>`;
                }
            });
        });

        tbody.querySelectorAll('.input-reason').forEach(input => {
            input.addEventListener('input', (e) => {
                const key = input.getAttribute('data-key');
                if (!workingMap[key]) {
                    const row = input.closest('tr');
                    const qty = Number(row.querySelector('.input-actual-qty').value) || 0;
                    workingMap[key] = { actualQty: qty, reason: '' };
                }
                workingMap[key].reason = e.target.value;
            });
        });
    };

    // 일자별 실사 이력 렌더링
    const renderAuditHistory = () => {
        const dateVal = container.querySelector('#audit-hist-date-picker').value;
        const tbody = container.querySelector('#audit-hist-table-body');
        const badge = container.querySelector('#audit-hist-count-badge');

        const logs = state.history.filter(h => h.type === 'AUDIT' && (!dateVal || (h.timestamp && h.timestamp.includes(dateVal))));
        badge.textContent = `${dateVal || '전체'} 기준: 총 ${logs.length}건`;

        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 text-xs">${dateVal} 에 기록된 실사 이력이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map(l => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-2.5 font-mono text-[11px] text-slate-500">${l.timestamp}</td>
                <td class="p-2.5 font-bold text-slate-700">${l.fromLoc || '-'}</td>
                <td class="p-2.5 font-mono font-bold text-blue-600">${l.code}</td>
                <td class="p-2.5 font-bold text-slate-900">${l.name}</td>
                <td class="p-2.5 text-right font-black text-teal-700">${Number(l.qty).toLocaleString()} EA</td>
                <td class="p-2.5 font-bold text-slate-700">${l.worker || '-'}</td>
                <td class="p-2.5 text-slate-600">${l.reason || '-'}</td>
            </tr>
        `).join('');
    };

    const modalHist = container.querySelector('#modal-audit-history');
    container.querySelector('#btn-open-audit-hist-modal')?.addEventListener('click', () => {
        renderAuditHistory();
        modalHist.classList.remove('hidden');
    });
    container.querySelector('#btn-close-audit-hist')?.addEventListener('click', () => {
        modalHist.classList.add('hidden');
    });
    container.querySelector('#btn-audit-hist-search')?.addEventListener('click', renderAuditHistory);
    container.querySelector('#audit-hist-date-picker')?.addEventListener('change', renderAuditHistory);

    container.querySelector('#audit-filter-loc')?.addEventListener('change', (e) => {
        selectedLocFilter = e.target.value;
        container.querySelectorAll('.btn-loc-chip').forEach(b => {
            const isSelected = (b.getAttribute('data-loc') || '') === selectedLocFilter;
            b.className = `btn-loc-chip px-3 py-1.5 rounded-xl text-xs font-bold transition ${isSelected ? 'bg-teal-600 text-white shadow-xs' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`;
        });
        renderTable();
    });
    container.querySelector('#audit-filter-diff-only')?.addEventListener('change', renderTable);
    container.querySelector('#audit-search-input')?.addEventListener('input', renderTable);

    // 1. 재고실사 양식(Excel) 작성 및 다운로드 (4대 거점 호환)
    container.querySelector('#btn-export-audit-template')?.addEventListener('click', () => {
        const locFilter = container.querySelector('#audit-filter-loc').value || selectedLocFilter;
        const targetItems = state.inventory.filter(inv => !locFilter || inv.location === locFilter);

        const rows = targetItems.map(inv => {
            const m = state.master.find(item => item.code === inv.code) || {};
            return {
                "보관거점": inv.location,
                "품목코드": inv.code,
                "품목명": inv.name,
                "분류": inv.category || m.category || '완제품',
                "규격": inv.spec || m.spec || '-',
                "단위": inv.unit || m.unit || 'EA',
                "전산장부수량": Number(inv.quantity) || 0,
                "현장실사수량": Number(inv.quantity) || 0, // 기본 전산값 자동채움 (수정 편의성)
                "오차사유_비고": ""
            };
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "재고실사표");
        const todayStr = new Date().toISOString().slice(0, 10);
        const fileName = `대림기업_재고실사양식_${locFilter || '전체거점'}_${todayStr}.xlsx`;
        XLSX.writeFile(wb, fileName);
        showToast(`📥 [${locFilter || '전체 거점'}] 재고실사 엑셀 양식이 다운로드되었습니다.`);
    });

    // 2. 실사 엑셀 파일 업로드 및 자동 반영 (4대 거점 정규화 지원)
    container.querySelector('#input-upload-audit-file')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const json = XLSX.utils.sheet_to_json(firstSheet);

                if (!json || json.length === 0) {
                    alert('엑셀 파일 내 실사 데이터가 비어있습니다.');
                    return;
                }

                const auditDate = container.querySelector('#audit-reg-date').value || new Date().toISOString().slice(0, 10);
                const fileAuditMap = {};
                let matchedCount = 0;
                let diffCount = 0;
                let totalDiffQty = 0;

                json.forEach(row => {
                    const code = String(row['품목코드'] || row['code'] || row['Code'] || row['코드'] || '').trim();
                    const rawLoc = String(row['보관거점'] || row['거점'] || row['location'] || row['Location'] || row['창고'] || '').trim();
                    const loc = normalizeLocation(rawLoc);
                    const rawActual = row['현장실사수량'] ?? row['신규실사'] ?? row['실사수량'] ?? row['ActualQty'] ?? row['수량'];
                    const reason = String(row['오차사유_비고'] || row['오차사유'] || row['사유'] || row['비고'] || row['Reason'] || '').trim();

                    if (!code || rawActual === undefined || rawActual === null || rawActual === '') return;

                    const actualQty = Number(rawActual);
                    if (isNaN(actualQty) || actualQty < 0) return;

                    // 일치하는 재고 품목 찾기 (거점 정규화 적용)
                    let invItem = null;
                    if (loc) {
                        invItem = state.inventory.find(i => i.code === code && (i.location === loc || normalizeLocation(i.location) === loc));
                    } else {
                        invItem = state.inventory.find(i => i.code === code);
                    }

                    if (invItem) {
                        const key = `${invItem.code}___${invItem.location}`;
                        const diff = actualQty - invItem.quantity;
                        fileAuditMap[key] = {
                            actualQty,
                            reason: reason || (diff !== 0 ? `엑셀 실사 연동 [오차 ${diff > 0 ? '+' : ''}${diff}EA]` : '실사 수량 일치')
                        };
                        matchedCount++;
                        if (diff !== 0) {
                            diffCount++;
                            totalDiffQty += Math.abs(diff);
                        }
                    }
                });

                if (matchedCount === 0) {
                    alert('업로드된 파일에서 일치하는 품목코드 또는 보관거점을 찾을 수 없습니다.\n본사/방산/김포/대림오일 4대 거점 명칭 또는 품목코드를 확인해주세요.');
                    return;
                }

                const confirmMsg = `📂 [실사 파일 자동 분석 완료]\n` +
                    `- 파일명: ${file.name}\n` +
                    `- 실사 일자: ${auditDate}\n` +
                    `- 확인된 실사 품목: 총 ${matchedCount}건\n` +
                    `- 재고 오차 발생 품목: ${diffCount}건 (오차 총량: ${totalDiffQty.toLocaleString()} EA)\n\n` +
                    `전산 재고에 즉시 자동 반영(일괄 업데이트)하시겠습니까?`;

                if (confirm(confirmMsg)) {
                    await commitStockAudit(fileAuditMap, state.currentGlobalWorker, auditDate);
                    showToast(`🎉 엑셀 실사 파일 자동 반영 완료! (총 ${matchedCount}건 중 ${diffCount}건 오차 전산 보정)`);
                    renderTable();
                    if (onRefresh) onRefresh();
                } else {
                    // 취소 시 화면에 임시 적용하여 사용자가 표에서 확인 가능하게 지원
                    Object.assign(workingMap, fileAuditMap);
                    renderTable();
                    showToast(`ℹ️ 엑셀 실사 수량이 화면에 임시 적용되었습니다. 검토 후 [화면 실사 수량 전산 일괄 반영]을 눌러주세요.`);
                }
            } catch (err) {
                console.error('[Audit Excel Parse Error]:', err);
                alert('엑셀 파일 파싱 중 오류가 발생했습니다: ' + err.message);
            } finally {
                e.target.value = '';
            }
        };
        reader.readAsArrayBuffer(file);
    });

    container.querySelector('#btn-commit-audit')?.addEventListener('click', async () => {
        const keys = Object.keys(workingMap);
        if (keys.length === 0) {
            alert('변경된 실사 수량이 없습니다.');
            return;
        }

        const auditDate = container.querySelector('#audit-reg-date').value;
        if (confirm(`실사 일자 [${auditDate}] 기준으로 수정된 ${keys.length}개 품목의 실사 수량을 전산 재고에 즉시 반영하시겠습니까?`)) {
            await commitStockAudit(workingMap, state.currentGlobalWorker, auditDate);
            showToast(`✅ [${auditDate}] ${keys.length}개 품목의 재고 실사가 클라우드에 성공적으로 반영되었습니다.`);
            renderTable();
            if (onRefresh) onRefresh();
        }
    });

    renderTable();
    createIcons({ icons });
};
