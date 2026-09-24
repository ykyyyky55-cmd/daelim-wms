import { 
    state, 
    addCategory, 
    deleteCategory, 
    addLocation, 
    deleteLocation, 
    addPartner,
    deletePartner,
    saveBeginningStock,
    saveDashboardSettings,
    syncAllLocalDataToSupabase,
    saveWorker, 
    deleteWorker, 
    bulkUpsertMasterItems,
    restoreAllData,
    resetToEnterpriseData
} from '../services/db.js';
import { getSupabaseConfig, saveSupabaseConfig, testSupabaseConnection } from '../services/supabase.js';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import { createIcons, icons } from 'lucide';

export const renderModals = (container, { showToast, onDataChanged }) => {
    container.innerHTML = `
    <!-- 1. Supabase 클라우드 DB 연동 모달 -->
    <div id="modal-supabase" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div class="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
            <div class="px-5 py-4 bg-gradient-to-r from-emerald-600 to-teal-700 text-white flex justify-between items-center">
                <div class="flex items-center gap-2">
                    <i data-lucide="database" class="w-5 h-5"></i>
                    <h3 class="font-bold text-sm">Supabase 클라우드 실시간 데이터베이스 연동</h3>
                </div>
                <button type="button" class="btn-close-modal text-white/80 hover:text-white">&times;</button>
            </div>
            <div class="p-5 space-y-4 text-xs">
                <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-emerald-800 space-y-1">
                    <p class="font-bold">🌐 실시간 클라우드 협업 & 마이그레이션 안내</p>
                    <p class="text-[11px] leading-relaxed">
                        Supabase 대시보드의 <b>Project Settings &rarr; API</b>에서 URL과 anon key를 복사하여 아래에 입력하세요. 
                        테이블 생성이 필요할 경우 아래 <b>[SQL 스크립트 복사]</b>를 눌러 Supabase SQL Editor에 붙여넣기만 하면 1초 만에 완료됩니다.
                    </p>
                </div>

                <div class="space-y-3">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">Project URL</label>
                        <input type="text" id="cfg-supabase-url" placeholder="https://your-project-id.supabase.co" class="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono text-xs font-medium focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">Anon Public Key</label>
                        <textarea id="cfg-supabase-key" rows="3" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." class="w-full border border-slate-300 rounded-xl px-3 py-2 font-mono text-xs focus:ring-2 focus:ring-emerald-500"></textarea>
                    </div>
                </div>

                <!-- 도구 버튼 그룹: SQL 스크립트 복사 & 클라우드 원클릭 마이그레이션 -->
                <div class="grid grid-cols-2 gap-2 pt-1">
                    <button type="button" id="btn-copy-supabase-sql" class="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl transition flex items-center justify-center gap-1.5 border border-slate-200 shadow-xs">
                        <i data-lucide="code" class="w-3.5 h-3.5 text-emerald-600"></i>
                        <span>SQL 스키마 복사</span>
                    </button>
                    <button type="button" id="btn-bulk-sync-supabase" class="py-2.5 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold rounded-xl transition flex items-center justify-center gap-1.5 border border-emerald-300 shadow-xs">
                        <i data-lucide="cloud-upload" class="w-3.5 h-3.5 text-emerald-600"></i>
                        <span>로컬 데이터 전체 업로드</span>
                    </button>
                </div>

                <div id="supabase-sync-progress" class="hidden p-3 bg-slate-900 text-white rounded-xl space-y-2">
                    <div class="flex justify-between items-center text-[11px] font-bold">
                        <span id="sync-progress-msg">동기화 준비 중...</span>
                        <span id="sync-progress-pct">0%</span>
                    </div>
                    <div class="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                        <div id="sync-progress-bar" class="bg-emerald-500 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
                    </div>
                </div>

                <div id="supabase-test-result" class="hidden p-3 rounded-xl text-xs font-bold"></div>

                <div class="pt-2 flex justify-between items-center">
                    <button type="button" id="btn-test-supabase" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold flex items-center gap-1.5 transition">
                        <i data-lucide="activity" class="w-3.5 h-3.5"></i>
                        <span>연결 테스트</span>
                    </button>
                    <div class="flex gap-2">
                        <button type="button" class="btn-close-modal px-4 py-2 border border-slate-300 rounded-xl font-bold text-slate-600 hover:bg-slate-50">닫기</button>
                        <button type="button" id="btn-save-supabase" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-sm">저장 및 실시간 동기화 시작</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 1-1. 앱 설치 / 모바일 현장 접속 QR코드 모달 -->
    <div id="modal-pwa-qr" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4">
        <div class="bg-white max-w-sm w-full rounded-3xl shadow-2xl overflow-hidden border border-slate-100">
            <div class="px-5 py-4 bg-gradient-to-r from-blue-600 to-indigo-700 text-white flex justify-between items-center">
                <div class="flex items-center gap-2">
                    <i data-lucide="smartphone" class="w-5 h-5"></i>
                    <h3 class="font-bold text-sm">스마트폰 현장 접속 & 앱 설치</h3>
                </div>
                <button type="button" class="btn-close-modal text-white/70 hover:text-white">&times;</button>
            </div>
            <div class="p-5 text-center space-y-4">
                <div class="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex flex-col items-center justify-center shadow-inner">
                    <canvas id="pwa-modal-qr-canvas" class="rounded-xl shadow-xs"></canvas>
                    <span class="text-[11px] font-bold text-slate-500 mt-2">휴대폰 기본 카메라로 비추면 바로 열립니다</span>
                </div>

                <div class="space-y-2 text-xs text-left">
                    <div class="p-3 bg-blue-50/70 border border-blue-200 rounded-xl space-y-1.5">
                        <div class="font-bold text-blue-900 flex items-center gap-1.5">
                            <i data-lucide="check-circle" class="w-4 h-4 text-blue-600"></i>
                            <span>홈 화면에 앱으로 추가하는 방법</span>
                        </div>
                        <ul class="text-[11px] text-blue-800 space-y-1 pl-1 list-disc list-inside">
                            <li><b>안드로이드 Chrome:</b> 접속 후 [홈 화면에 추가] 또는 [앱 설치] 터치</li>
                            <li><b>아이폰 Safari:</b> 하단 중앙 공유 버튼(↑) &rarr; [홈 화면에 추가] 선택</li>
                        </ul>
                    </div>

                    <div class="flex items-center gap-2">
                        <input type="text" id="pwa-modal-url-input" readonly value="https://ykyyyky55-cmd.github.io/daelim-wms/" class="flex-1 bg-slate-100 border border-slate-300 rounded-xl px-2.5 py-1.5 text-[11px] font-mono text-slate-600 focus:outline-none" />
                        <button type="button" id="btn-copy-pwa-url" class="px-3 py-1.5 bg-slate-800 hover:bg-black text-white rounded-xl font-bold text-xs flex items-center gap-1 transition shadow-xs">
                            <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                            <span>복사</span>
                        </button>
                    </div>
                </div>

                <div class="flex gap-2 pt-1">
                    <button type="button" id="btn-download-qr-img" class="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5">
                        <i data-lucide="download" class="w-3.5 h-3.5"></i>
                        <span>QR 이미지 다운로드</span>
                    </button>
                    <button type="button" id="btn-native-pwa-trigger" class="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-sm">
                        <i data-lucide="download-cloud" class="w-3.5 h-3.5"></i>
                        <span>기기에 즉시 설치</span>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 1-2. 대시보드 환경 및 위젯 설정 모달 -->
    <div id="modal-dashboard-settings" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div class="bg-white max-w-lg w-full rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
            <div class="px-5 py-4 bg-slate-900 text-white flex justify-between items-center">
                <div class="flex items-center gap-2">
                    <i data-lucide="sliders" class="w-4 h-4 text-indigo-400"></i>
                    <h3 class="font-bold text-sm">대시보드 표시 위젯 및 운영 설정</h3>
                </div>
                <button type="button" class="btn-close-modal text-slate-400 hover:text-white">&times;</button>
            </div>
            <div class="p-5 space-y-5 text-xs">
                <div>
                    <h4 class="font-bold text-slate-800 text-xs mb-2">1. 홈 화면 위젯 노출 선택</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" id="cfg-show-kpi" class="rounded text-blue-600 focus:ring-blue-500" checked />
                            <span class="font-bold text-slate-700">📊 상단 핵심 KPI 요약 카드</span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" id="cfg-show-qr" class="rounded text-blue-600 focus:ring-blue-500" checked />
                            <span class="font-bold text-slate-700">📱 앱 설치 / 모바일 접속 QR</span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" id="cfg-show-quick" class="rounded text-blue-600 focus:ring-blue-500" checked />
                            <span class="font-bold text-slate-700">⚡ 빠른 현장 입출고 등록 폼</span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" id="cfg-show-safety" class="rounded text-blue-600 focus:ring-blue-500" checked />
                            <span class="font-bold text-slate-700">⚠️ 안전재고 부족 경보 리스트</span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" id="cfg-show-history" class="rounded text-blue-600 focus:ring-blue-500" checked />
                            <span class="font-bold text-slate-700">📜 실시간 최근 현장 작업 이력</span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" id="cfg-show-oilcalc" class="rounded text-blue-600 focus:ring-blue-500" checked />
                            <span class="font-bold text-slate-700">⚖️ 비중·오일 15℃ 환산 퀵 위젯</span>
                        </label>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">실시간 자동 새로고침</label>
                        <select id="cfg-refresh-interval" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold">
                            <option value="0">수동 새로고침만 사용</option>
                            <option value="10">10초마다 자동 갱신</option>
                            <option value="30">30초마다 자동 갱신</option>
                            <option value="60">60초마다 자동 갱신</option>
                        </select>
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 mb-1">안전재고 경보 필터</label>
                        <select id="cfg-safety-filter" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold">
                            <option value="all">안전재고 이하 전체 표시</option>
                            <option value="zero_only">재고 0EA(품절)만 긴급 표시</option>
                        </select>
                    </div>
                </div>

                <div class="pt-2 flex justify-between items-center">
                    <button type="button" id="btn-reset-dashboard-settings" class="text-slate-500 hover:text-slate-800 text-xs font-bold">기본값 초기화</button>
                    <div class="flex gap-2">
                        <button type="button" class="btn-close-modal px-4 py-2 border border-slate-300 rounded-xl font-bold text-slate-600 hover:bg-slate-50">닫기</button>
                        <button type="button" id="btn-save-dashboard-settings" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-sm">설정 저장 및 적용</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 2. 작업자 관리 모달 -->
    <div id="modal-worker" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div class="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
            <div class="px-5 py-4 bg-slate-900 text-white flex justify-between items-center">
                <h3 class="font-bold text-sm">현장 작업자 마스터 관리</h3>
                <button type="button" class="btn-close-modal text-slate-400 hover:text-white">&times;</button>
            </div>
            <div class="p-5 space-y-4 text-xs">
                <form id="form-add-worker" class="grid grid-cols-4 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <input type="text" id="w-id" required placeholder="사번 (EMP-005)" class="border border-slate-300 rounded-lg px-2 py-1.5" />
                    <input type="text" id="w-name" required placeholder="이름" class="border border-slate-300 rounded-lg px-2 py-1.5" />
                    <input type="text" id="w-dept" placeholder="소속 부서" class="border border-slate-300 rounded-lg px-2 py-1.5" />
                    <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition">추가</button>
                </form>

                <div class="max-h-60 overflow-y-auto divide-y divide-slate-100" id="worker-list-body"></div>
            </div>
        </div>
    </div>

    <!-- 3. 거점 및 분류 관리 모달 -->
    <div id="modal-category" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div class="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
            <div class="px-5 py-4 bg-slate-900 text-white flex justify-between items-center">
                <h3 class="font-bold text-sm">자재/품목 분류 관리</h3>
                <button type="button" class="btn-close-modal text-slate-400 hover:text-white">&times;</button>
            </div>
            <div class="p-5 space-y-4 text-xs">
                <div class="flex gap-2">
                    <input type="text" id="cat-new-input" placeholder="새 분류명 (예: 소모품)" class="flex-1 border border-slate-300 rounded-xl px-3 py-2" />
                    <button type="button" id="btn-add-cat" class="px-4 py-2 bg-blue-600 text-white font-bold rounded-xl">추가</button>
                </div>
                <div id="cat-chips" class="flex flex-wrap gap-2 pt-2"></div>
            </div>
        </div>
    </div>

    <div id="modal-location" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div class="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
            <div class="px-5 py-4 bg-slate-900 text-white flex justify-between items-center">
                <h3 class="font-bold text-sm">창고 및 보관 거점 관리</h3>
                <button type="button" class="btn-close-modal text-slate-400 hover:text-white">&times;</button>
            </div>
            <div class="p-5 space-y-4 text-xs">
                <div class="flex gap-2">
                    <input type="text" id="loc-new-input" placeholder="새 거점명 (예: 대림오일 2창고)" class="flex-1 border border-slate-300 rounded-xl px-3 py-2" />
                    <button type="button" id="btn-add-loc" class="px-4 py-2 bg-blue-600 text-white font-bold rounded-xl">추가</button>
                </div>
                <div id="loc-chips" class="flex flex-wrap gap-2 pt-2"></div>
            </div>
        </div>
    </div>

    <!-- 3-1. 거래처(공급사/납품처) 마스터 관리 모달 -->
    <div id="modal-partner" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div class="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
            <div class="px-5 py-4 bg-slate-900 text-white flex justify-between items-center">
                <div class="flex items-center gap-2">
                    <i data-lucide="building-2" class="w-4 h-4 text-blue-400"></i>
                    <h3 class="font-bold text-sm">거래처 (공급사 / 납품처) 마스터 관리</h3>
                </div>
                <button type="button" class="btn-close-modal text-slate-400 hover:text-white">&times;</button>
            </div>
            <div class="p-5 space-y-4 text-xs">
                <div class="flex gap-2">
                    <input type="text" id="partner-new-input" placeholder="새 거래처 상호 (예: (주)SK루브텍)" class="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500" />
                    <button type="button" id="btn-add-partner" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-xs">추가</button>
                </div>
                <div class="max-h-64 overflow-y-auto border border-slate-200 rounded-xl p-2 divide-y divide-slate-100" id="partner-list-body"></div>
            </div>
        </div>
    </div>

    <!-- 3-2. 기초 / 이월재고(Beginning Stock) 설정 모달 -->
    <div id="modal-beginning-stock" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div class="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
            <div class="px-5 py-4 bg-slate-900 text-white flex justify-between items-center">
                <div class="flex items-center gap-2">
                    <i data-lucide="archive" class="w-4 h-4 text-amber-400"></i>
                    <h3 class="font-bold text-sm">기초 / 이월재고(Beginning Stock) 설정</h3>
                </div>
                <button type="button" class="btn-close-modal text-slate-400 hover:text-white">&times;</button>
            </div>
            <div class="p-5 space-y-4 text-xs">
                <p class="text-slate-500 leading-relaxed">당기 수불부 정산을 위한 품목별 기초(전기이월) 재고를 설정합니다. 수불 원장의 시작 기준점으로 사용됩니다.</p>
                <div class="flex gap-2">
                    <input type="text" id="bstock-search-input" placeholder="품목코드 또는 품명 검색..." class="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-xs" />
                </div>
                <div class="max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-100 sticky top-0 font-bold text-slate-700">
                            <tr>
                                <th class="p-2.5">품목코드</th>
                                <th class="p-2.5">품목명</th>
                                <th class="p-2.5 text-right">기초이월재고 입력</th>
                                <th class="p-2.5 text-center">저장</th>
                            </tr>
                        </thead>
                        <tbody id="bstock-table-tbody" class="divide-y divide-slate-100"></tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <!-- 3-3. 품목 사진 확대 모달 -->
    <div id="modal-image-preview" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-xs p-4">
        <div class="bg-white max-w-md w-full rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
            <div class="px-4 py-3 bg-slate-900 text-white flex justify-between items-center">
                <div>
                    <h3 id="img-preview-title" class="font-bold text-sm">품목 사진</h3>
                    <p id="img-preview-sub" class="text-[11px] text-slate-400 font-mono"></p>
                </div>
                <button type="button" class="btn-close-modal text-white/70 hover:text-white text-lg font-bold">&times;</button>
            </div>
            <div class="p-4 bg-slate-100 flex items-center justify-center min-h-[260px] max-h-[420px] overflow-hidden">
                <img id="img-preview-src" src="" alt="품목 사진" class="max-w-full max-h-[380px] rounded-xl object-contain shadow-md" />
            </div>
        </div>
    </div>

    <!-- 4. 엑셀 일괄 등록 모달 -->
    <div id="modal-excel" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div class="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
            <div class="px-5 py-4 bg-emerald-600 text-white flex justify-between items-center">
                <h3 class="font-bold text-sm">품목 마스터 엑셀 대량 업로드</h3>
                <button type="button" class="btn-close-modal text-white/80 hover:text-white">&times;</button>
            </div>
            <div class="p-5 space-y-4 text-xs">
                <div class="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-2xl p-6 text-center transition cursor-pointer" id="excel-dropzone">
                    <i data-lucide="file-spreadsheet" class="w-10 h-10 mx-auto text-emerald-600 mb-2"></i>
                    <p class="font-bold text-slate-700">엑셀 파일(.xlsx, .xls)을 이곳에 끌어다 놓거나 클릭하세요</p>
                    <input type="file" id="excel-file-input" accept=".xlsx,.xls" class="hidden" />
                </div>
                <div id="excel-preview-info" class="hidden bg-slate-50 p-3 rounded-xl border border-slate-200"></div>
                <div class="flex justify-end gap-2">
                    <button type="button" class="btn-close-modal px-4 py-2 border border-slate-300 rounded-xl font-bold text-slate-600">닫기</button>
                    <button type="button" id="btn-confirm-excel-import" class="hidden px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl">일괄 등록 시작</button>
                </div>
            </div>
        </div>
    </div>

    <!-- 5. 백업/복원 모달 -->
    <div id="modal-backup" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div class="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
            <div class="px-5 py-4 bg-slate-900 text-white flex justify-between items-center">
                <h3 class="font-bold text-sm">전체 데이터 백업 & 복원</h3>
                <button type="button" class="btn-close-modal text-slate-400 hover:text-white">&times;</button>
            </div>
            <div class="p-5 space-y-4 text-xs">
                <p class="text-slate-600">모든 품목 마스터, 재고, 작업 이력을 JSON 파일로 백업하거나 이전 백업본에서 복원합니다.</p>
                <div class="grid grid-cols-2 gap-3">
                    <button type="button" id="btn-export-backup" class="p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-center transition">
                        <i data-lucide="download" class="w-6 h-6 mx-auto text-blue-600 mb-1"></i>
                        <span class="font-bold text-slate-800 block">백업 파일 다운로드</span>
                    </button>
                    <label class="p-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-center transition cursor-pointer">
                        <i data-lucide="upload" class="w-6 h-6 mx-auto text-emerald-600 mb-1"></i>
                        <span class="font-bold text-slate-800 block">백업 파일 복원</span>
                        <input type="file" id="backup-file-input" accept=".json" class="hidden" />
                    </label>
                </div>

                <div class="pt-2 border-t border-slate-100">
                    <button type="button" id="btn-load-enterprise" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm">
                        <i data-lucide="database" class="w-4 h-4"></i>
                        <span>대림오일 2,497종 실제 기업 데이터 즉시 로드 (원클릭)</span>
                    </button>
                    <p class="text-[10px] text-slate-400 text-center mt-1">2,497종 품목 마스터 및 1,439개 거점별 실재고 데이터를 즉시 동기화합니다.</p>
                </div>
            </div>
        </div>
    </div>

    <!-- 6. 원부자재 이동전표 / 출고요청서 서식 모달 -->
    <div id="modal-slip" class="hidden fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
        <div class="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6">
            <div class="p-4 bg-amber-500 text-white flex items-center justify-between no-print">
                <div class="flex items-center gap-2">
                    <i data-lucide="file-signature" class="w-5 h-5"></i>
                    <h4 class="font-bold text-sm">원부자재 이동전표 / 출고요청서</h4>
                </div>
                <div class="flex items-center gap-2">
                    <select id="slip-type-select" class="px-2.5 py-1 bg-white text-slate-800 text-xs font-bold rounded-lg border-none">
                        <option value="TRANSFER">원부자재 이동전표</option>
                        <option value="RELEASE">출고 및 불출 요청서</option>
                    </select>
                    <button type="button" onclick="window.print()" class="px-2.5 py-1 bg-white text-amber-700 hover:bg-amber-50 rounded-lg text-xs font-bold transition flex items-center gap-1">
                        <i data-lucide="printer" class="w-3.5 h-3.5"></i>
                        <span>A4 서식 인쇄</span>
                    </button>
                    <button type="button" class="btn-close-modal text-white/80 hover:text-white">&times;</button>
                </div>
            </div>

            <div id="printable-transfer-slip" class="printable-area p-6 sm:p-8 bg-white text-slate-900 space-y-6 text-xs">
                <div class="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-900 pb-4">
                    <div>
                        <h2 id="slip-title-text" class="text-2xl font-black tracking-tight text-slate-900">원 부 자 재 이 동 전 표</h2>
                        <span id="slip-subtitle-text" class="text-xs font-semibold text-slate-500">MATERIAL TRANSFER SLIP</span>
                        <div class="mt-2 text-[11px] space-y-0.5">
                            <div><strong>전표번호:</strong> <span id="slip-doc-no" class="font-mono font-bold">TR-20260922-001</span></div>
                            <div><strong>발행일자:</strong> <span id="slip-doc-date">2026-09-22</span></div>
                        </div>
                    </div>

                    <div class="flex border border-slate-900 text-center text-[10px]">
                        <div class="w-6 bg-slate-100 flex items-center justify-center font-bold border-r border-slate-900">출고</div>
                        <div class="w-16 border-r border-slate-900">
                            <div class="py-0.5 border-b border-slate-900 font-bold">담당</div>
                            <div class="h-10"></div>
                        </div>
                        <div class="w-16 border-r border-slate-900">
                            <div class="py-0.5 border-b border-slate-900 font-bold">승인</div>
                            <div class="h-10"></div>
                        </div>
                        <div class="w-6 bg-slate-100 flex items-center justify-center font-bold border-r border-slate-900">인수</div>
                        <div class="w-16 border-r border-slate-900">
                            <div class="py-0.5 border-b border-slate-900 font-bold">담당</div>
                            <div class="h-10"></div>
                        </div>
                        <div class="w-16">
                            <div class="py-0.5 border-b border-slate-900 font-bold">확인</div>
                            <div class="h-10"></div>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                    <div>
                        <span class="text-slate-500 font-bold">출발 거점:</span>
                        <span id="slip-from-loc" class="font-bold text-slate-900 ml-1">김포공장</span>
                    </div>
                    <div>
                        <span class="text-slate-500 font-bold">도착 거점:</span>
                        <span id="slip-to-loc" class="font-bold text-blue-700 ml-1">본사 창고</span>
                    </div>
                    <div>
                        <span class="text-slate-500 font-bold">운송 방법 / 사유:</span>
                        <span id="slip-transport-mode" class="font-medium text-slate-800 ml-1">사내 배송 / 정기 이동</span>
                    </div>
                    <div>
                        <span class="text-slate-500 font-bold">작업 담당자:</span>
                        <span id="slip-worker-name" class="font-medium text-slate-800 ml-1">관리자</span>
                    </div>
                </div>

                <div class="border border-slate-900 rounded-lg overflow-hidden">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-100 border-b border-slate-900 font-bold text-slate-800">
                            <tr>
                                <th class="py-2 px-3">No</th>
                                <th class="py-2 px-3">품목코드</th>
                                <th class="py-2 px-3">품목명</th>
                                <th class="py-2 px-3">규격 / 사양</th>
                                <th class="py-2 px-3">단위</th>
                                <th class="py-2 px-3 text-right">이동 수량</th>
                            </tr>
                        </thead>
                        <tbody id="slip-items-tbody" class="divide-y divide-slate-200"></tbody>
                        <tfoot class="bg-slate-50 border-t border-slate-900 font-bold">
                            <tr>
                                <td colspan="5" class="py-2 px-3 text-right">합계 수량:</td>
                                <td id="slip-total-qty" class="py-2 px-3 text-right font-black text-blue-700">0 EA</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div class="pt-4 border-t border-slate-200 text-slate-600 text-center space-y-3">
                    <p class="text-xs">상기 원부자재를 이상 없이 정히 영수(인수)하였음을 확인합니다.</p>
                    <div class="flex justify-around items-center pt-2 text-xs font-bold text-slate-900">
                        <span>출고자: _________________ (인)</span>
                        <span>인수자: _________________ (인)</span>
                    </div>
                </div>
            </div>
        </div>
    </div>

    `;

    // 닫기 버튼 및 배경 클릭 시 닫기 일괄 바인딩
    container.querySelectorAll('.btn-close-modal').forEach(b => {
        b.addEventListener('click', () => {
            container.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
            if (window.history.state?.modal) {
                try { window.history.back(); } catch (err) {}
            }
        });
    });

    container.querySelectorAll('[id^="modal-"]').forEach(m => {
        m.addEventListener('click', (e) => {
            if (e.target === m) {
                m.classList.add('hidden');
                if (window.history.state?.modal) {
                    try { window.history.back(); } catch (err) {}
                }
            }
        });
    });

    // 1. Supabase 설정 모달 로직
    const cfg = getSupabaseConfig();
    container.querySelector('#cfg-supabase-url').value = cfg.url;
    container.querySelector('#cfg-supabase-key').value = cfg.key;

    container.querySelector('#btn-test-supabase')?.addEventListener('click', async () => {
        const url = container.querySelector('#cfg-supabase-url').value.trim();
        const key = container.querySelector('#cfg-supabase-key').value.trim();
        const resDiv = container.querySelector('#supabase-test-result');
        resDiv.classList.remove('hidden', 'bg-rose-50', 'text-rose-700', 'bg-emerald-50', 'text-emerald-700');
        resDiv.innerHTML = '연결 확인 중...';
        const res = await testSupabaseConnection(url, key);
        if (res.success) {
            resDiv.className = 'p-3 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700';
            resDiv.textContent = `✅ ${res.message}`;
        } else {
            resDiv.className = 'p-3 rounded-xl text-xs font-bold bg-rose-50 text-rose-700';
            resDiv.textContent = `❌ ${res.message}`;
        }
    });

    // Supabase 설정 안내 텍스트
    // 예전에는 모든 테이블을 익명(anon)에게 전부 허용하는 정책 SQL을 복사해 주었는데, 로그인 보안 적용 후
    // 그 SQL을 실행하면 다시 누구나 데이터를 읽고 쓸 수 있게 되므로 실행 순서 안내문으로 대체한다.
    const SUPABASE_SCHEMA_SQL = `-- 대림오일 스마트 WMS - Supabase 설정 안내
-- 테이블 생성과 보안 정책은 저장소의 SQL 파일을 순서대로 SQL Editor에서 실행하세요.
--   1) supabase_schema.sql                        (테이블 생성)
--   2) supabase/auth/01_auth_setup.sql             (로그인 계정·역할·master 설정)
--   3) supabase/auth/02_lock_down_policies.sql     (익명 접근 차단, 역할별 권한) ※ 모든 사용자 가입·승인 후
--   4) supabase/auth/03_cleanup_legacy_users.sql   (예전 평문 비밀번호 테이블 삭제)
-- ⚠️ 모든 테이블을 anon에게 허용하는 정책(USING (true))은 실행하지 마세요. 로그인 보안이 무력화됩니다.
`;

    container.querySelector('#btn-copy-supabase-sql')?.addEventListener('click', () => {
        navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL).then(() => {
            showToast('📋 Supabase 설정 안내(SQL 실행 순서)가 클립보드에 복사되었습니다.');
        }).catch(() => {
            alert('클립보드 복사 권한이 없습니다.');
        });
    });

    container.querySelector('#btn-bulk-sync-supabase')?.addEventListener('click', async () => {
        const progressBox = container.querySelector('#supabase-sync-progress');
        const progressMsg = container.querySelector('#sync-progress-msg');
        const progressPct = container.querySelector('#sync-progress-pct');
        const progressBar = container.querySelector('#sync-progress-bar');

        if (!confirm('현재 로컬의 실데이터(2,497개 품목 및 1,439개 재고)를 Supabase 클라우드로 일괄 업로드하시겠습니까?')) {
            return;
        }

        progressBox.classList.remove('hidden');
        try {
            const res = await syncAllLocalDataToSupabase(({ step, percent }) => {
                progressMsg.textContent = step;
                progressPct.textContent = `${percent}%`;
                progressBar.style.width = `${percent}%`;
            });
            showToast(`🎉 클라우드 마이그레이션 성공! (품목: ${res.countItems}건, 재고: ${res.countInv}건)`);
            if (onDataChanged) await onDataChanged();
        } catch (err) {
            alert(`클라우드 업로드 실패: ${err.message}\n먼저 SQL 스크립트로 테이블을 생성했는지 확인하세요.`);
        }
    });

    container.querySelector('#btn-save-supabase')?.addEventListener('click', async () => {
        const url = container.querySelector('#cfg-supabase-url').value.trim();
        const key = container.querySelector('#cfg-supabase-key').value.trim();
        saveSupabaseConfig(url, key);
        showToast('💾 Supabase 설정이 저장되었습니다. 데이터를 동기화합니다.');
        container.querySelector('#modal-supabase').classList.add('hidden');
        if (onDataChanged) await onDataChanged();
    });

    // 1-1. PWA 설치 / 모바일 QR 코드 생성 로직
    const qrCanvas = container.querySelector('#pwa-modal-qr-canvas');
    const qrUrlInput = container.querySelector('#pwa-modal-url-input');
    const liveAppUrl = window.location.href.includes('localhost') 
        ? 'https://ykyyyky55-cmd.github.io/daelim-wms/' 
        : window.location.href.split('#')[0];
    
    if (qrUrlInput) qrUrlInput.value = liveAppUrl;

    if (qrCanvas) {
        QRCode.toCanvas(qrCanvas, liveAppUrl, {
            width: 200,
            margin: 2,
            color: {
                dark: '#0f172a',
                light: '#ffffff'
            }
        }, (err) => {
            if (err) console.error('PWA QR Generate error:', err);
        });
    }

    container.querySelector('#btn-copy-pwa-url')?.addEventListener('click', () => {
        if (qrUrlInput) {
            navigator.clipboard.writeText(qrUrlInput.value).then(() => {
                showToast('🔗 스마트폰 접속 링크가 복사되었습니다.');
            });
        }
    });

    container.querySelector('#btn-download-qr-img')?.addEventListener('click', () => {
        if (qrCanvas) {
            const link = document.createElement('a');
            link.download = '대림오일_스마트WMS_앱설치QR.png';
            link.href = qrCanvas.toDataURL('image/png');
            link.click();
            showToast('📥 QR 코드 이미지가 다운로드되었습니다.');
        }
    });

    container.querySelector('#btn-native-pwa-trigger')?.addEventListener('click', () => {
        if (window.__triggerPwaInstall) {
            window.__triggerPwaInstall();
        } else {
            alert('📱 브라우저 메뉴의 [홈 화면에 추가] 또는 [앱 설치]를 선택하세요.');
        }
    });

    // 1-2. 대시보드 설정 모달 로직
    const initDashboardSettingsModal = () => {
        const settings = state.dashboardSettings || {};
        const chkKpi = container.querySelector('#cfg-show-kpi');
        const chkQr = container.querySelector('#cfg-show-qr');
        const chkQuick = container.querySelector('#cfg-show-quick');
        const chkSafety = container.querySelector('#cfg-show-safety');
        const chkHistory = container.querySelector('#cfg-show-history');
        const chkOilCalc = container.querySelector('#cfg-show-oilcalc');
        const selRefresh = container.querySelector('#cfg-refresh-interval');
        const selSafetyFilter = container.querySelector('#cfg-safety-filter');

        if (chkKpi) chkKpi.checked = settings.showKpi !== false;
        if (chkQr) chkQr.checked = settings.showQrWidget !== false;
        if (chkQuick) chkQuick.checked = settings.showQuickAction !== false;
        if (chkSafety) chkSafety.checked = settings.showLowSafety !== false;
        if (chkHistory) chkHistory.checked = settings.showHistory !== false;
        if (chkOilCalc) chkOilCalc.checked = settings.showOilCalc !== false;
        if (selRefresh) selRefresh.value = settings.refreshInterval || 0;
        if (selSafetyFilter) selSafetyFilter.value = settings.lowSafetyFilter || 'all';

        container.querySelector('#btn-reset-dashboard-settings')?.addEventListener('click', () => {
            if (chkKpi) chkKpi.checked = true;
            if (chkQr) chkQr.checked = true;
            if (chkQuick) chkQuick.checked = true;
            if (chkSafety) chkSafety.checked = true;
            if (chkHistory) chkHistory.checked = true;
            if (chkOilCalc) chkOilCalc.checked = true;
            if (selRefresh) selRefresh.value = 0;
            if (selSafetyFilter) selSafetyFilter.value = 'all';
        });

        container.querySelector('#btn-save-dashboard-settings')?.addEventListener('click', async () => {
            saveDashboardSettings({
                showKpi: chkKpi ? chkKpi.checked : true,
                showQrWidget: chkQr ? chkQr.checked : true,
                showQuickAction: chkQuick ? chkQuick.checked : true,
                showLowSafety: chkSafety ? chkSafety.checked : true,
                showHistory: chkHistory ? chkHistory.checked : true,
                showOilCalc: chkOilCalc ? chkOilCalc.checked : true,
                refreshInterval: Number(selRefresh?.value) || 0,
                lowSafetyFilter: selSafetyFilter?.value || 'all'
            });
            showToast('⚙️ 대시보드 환경 설정이 저장 및 적용되었습니다.');
            container.querySelector('#modal-dashboard-settings')?.classList.add('hidden');
            if (onDataChanged) await onDataChanged();
        });
    };
    initDashboardSettingsModal();

    // 2. 작업자 관리 모달 로직
    const renderWorkers = () => {
        const tbody = container.querySelector('#worker-list-body');
        if (!tbody) return;
        tbody.innerHTML = state.workers.map(w => `
            <div class="py-2.5 flex items-center justify-between">
                <div>
                    <span class="font-bold text-slate-800">${w.name}</span>
                    <span class="text-[11px] text-slate-500 ml-2">(${w.id} / ${w.dept || '현장'})</span>
                </div>
                <button type="button" class="del-worker text-rose-500 hover:text-rose-700 text-xs font-bold" data-id="${w.id}">삭제</button>
            </div>
        `).join('');

        tbody.querySelectorAll('.del-worker').forEach(b => {
            b.addEventListener('click', async () => {
                await deleteWorker(b.getAttribute('data-id'));
                renderWorkers();
                if (onDataChanged) await onDataChanged();
            });
        });
    };

    container.querySelector('#form-add-worker')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = container.querySelector('#w-id').value.trim();
        const name = container.querySelector('#w-name').value.trim();
        const dept = container.querySelector('#w-dept').value.trim();
        if (id && name) {
            await saveWorker({ id, name, dept, role: '작업자' });
            container.querySelector('#w-id').value = '';
            container.querySelector('#w-name').value = '';
            container.querySelector('#w-dept').value = '';
            renderWorkers();
            showToast(`작업자 '${name}'이(가) 등록되었습니다.`);
            if (onDataChanged) await onDataChanged();
        }
    });
    renderWorkers();

    // 3. 분류 모달 렌더링
    const renderCats = () => {
        const div = container.querySelector('#cat-chips');
        if (!div) return;
        div.innerHTML = state.categories.map(c => `
            <span class="px-3 py-1 bg-slate-100 rounded-full font-bold text-slate-700 flex items-center gap-1.5">
                <span>${c}</span>
                <button type="button" class="del-cat hover:text-rose-600 font-bold" data-cat="${c}">&times;</button>
            </span>
        `).join('');
        div.querySelectorAll('.del-cat').forEach(b => {
            b.addEventListener('click', async () => {
                await deleteCategory(b.getAttribute('data-cat'));
                renderCats();
                if (onDataChanged) await onDataChanged();
            });
        });
    };
    container.querySelector('#btn-add-cat')?.addEventListener('click', async () => {
        const input = container.querySelector('#cat-new-input');
        if (input.value.trim()) {
            await addCategory(input.value.trim());
            input.value = '';
            renderCats();
            if (onDataChanged) await onDataChanged();
        }
    });
    renderCats();

    // 4. 거점 모달 렌더링
    const renderLocs = () => {
        const div = container.querySelector('#loc-chips');
        if (!div) return;
        div.innerHTML = state.locations.map(l => `
            <span class="px-3 py-1 bg-blue-50 text-blue-800 rounded-full font-bold flex items-center gap-1.5">
                <span>${l}</span>
                <button type="button" class="del-loc hover:text-rose-600 font-bold" data-loc="${l}">&times;</button>
            </span>
        `).join('');
        div.querySelectorAll('.del-loc').forEach(b => {
            b.addEventListener('click', async () => {
                await deleteLocation(b.getAttribute('data-loc'));
                renderLocs();
                if (onDataChanged) await onDataChanged();
            });
        });
    };
    container.querySelector('#btn-add-loc')?.addEventListener('click', async () => {
        const input = container.querySelector('#loc-new-input');
        if (input.value.trim()) {
            await addLocation(input.value.trim());
            input.value = '';
            renderLocs();
            if (onDataChanged) await onDataChanged();
        }
    });
    renderLocs();

    // 4-1. 거래처 마스터 관리 로직
    const renderPartners = () => {
        const body = container.querySelector('#partner-list-body');
        if (!body) return;
        if (!state.partners || state.partners.length === 0) {
            body.innerHTML = '<div class="p-4 text-center text-slate-400 text-xs">등록된 거래처가 없습니다.</div>';
            return;
        }
        body.innerHTML = state.partners.map(p => `
            <div class="py-2 px-1 flex items-center justify-between hover:bg-slate-50">
                <div class="flex items-center gap-2">
                    <i data-lucide="building" class="w-3.5 h-3.5 text-slate-400"></i>
                    <span class="font-bold text-slate-800">${p}</span>
                </div>
                <button type="button" class="del-partner text-slate-400 hover:text-rose-600 font-bold p-1 transition" data-partner="${p}">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </div>
        `).join('');

        body.querySelectorAll('.del-partner').forEach(b => {
            b.addEventListener('click', async () => {
                const partnerName = b.getAttribute('data-partner');
                if (confirm(`'${partnerName}' 거래처를 마스터에서 삭제하시겠습니까?`)) {
                    await deletePartner(partnerName);
                    renderPartners();
                    showToast(`🗑️ 거래처 '${partnerName}' 삭제 완료`);
                    if (onDataChanged) await onDataChanged();
                }
            });
        });
        createIcons({ icons });
    };

    container.querySelector('#btn-add-partner')?.addEventListener('click', async () => {
        const input = container.querySelector('#partner-new-input');
        const val = input.value.trim();
        if (val) {
            await addPartner(val);
            input.value = '';
            renderPartners();
            showToast(`✅ 거래처 '${val}' 등록 완료`);
            if (onDataChanged) await onDataChanged();
        }
    });
    renderPartners();

    // 4-2. 기초 / 이월재고(Beginning Stock) 설정 로직
    const renderBeginningStocks = () => {
        const tbody = container.querySelector('#bstock-table-tbody');
        const searchVal = container.querySelector('#bstock-search-input')?.value.toLowerCase().trim() || '';
        if (!tbody) return;

        const filtered = state.master.filter(m => !searchVal || m.code.toLowerCase().includes(searchVal) || m.name.toLowerCase().includes(searchVal));

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-slate-400">검색된 품목이 없습니다.</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.slice(0, 50).map(m => {
            const currentBStock = (state.beginningStock && state.beginningStock[m.code] !== undefined)
                ? state.beginningStock[m.code]
                : (m.beginningStock || 0);
            return `
            <tr class="hover:bg-slate-50">
                <td class="p-2.5 font-mono font-bold text-blue-600">${m.code}</td>
                <td class="p-2.5 font-bold text-slate-800">${m.name}</td>
                <td class="p-2.5 text-right">
                    <input type="number" min="0" class="input-bstock-val w-24 px-2 py-1 border border-slate-300 rounded-lg text-right font-black text-xs" data-code="${m.code}" value="${currentBStock}" />
                </td>
                <td class="p-2.5 text-center">
                    <button type="button" class="btn-save-bstock px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow-xs" data-code="${m.code}">저장</button>
                </td>
            </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.btn-save-bstock').forEach(b => {
            b.addEventListener('click', async () => {
                const code = b.getAttribute('data-code');
                const inp = tbody.querySelector(`.input-bstock-val[data-code="${code}"]`);
                if (inp) {
                    const qty = Number(inp.value) || 0;
                    await saveBeginningStock(code, qty);
                    showToast(`💾 [${code}] 기초이월재고 ${qty.toLocaleString()} 설정 완료`);
                    if (onDataChanged) await onDataChanged();
                }
            });
        });
    };

    container.querySelector('#bstock-search-input')?.addEventListener('input', renderBeginningStocks);
    renderBeginningStocks();

    // 4-3. 이미지 확대 모달 글로벌 트리거
    window.__openImagePreview = (code, name, spec, imageUrl) => {
        const modal = container.querySelector('#modal-image-preview');
        const titleEl = container.querySelector('#img-preview-title');
        const subEl = container.querySelector('#img-preview-sub');
        const imgEl = container.querySelector('#img-preview-src');

        if (modal && imgEl) {
            titleEl.textContent = name || '품목 사진';
            subEl.textContent = `${code} | ${spec || '-'}`;
            imgEl.src = imageUrl || './icon.svg';
            modal.classList.remove('hidden');
        }
    };

    // 5. 엑셀 임포트 핸들러
    const dropzone = container.querySelector('#excel-dropzone');
    const fileInput = container.querySelector('#excel-file-input');
    dropzone?.addEventListener('click', () => fileInput?.click());
    
    let parsedItems = [];
    fileInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(firstSheet);

            parsedItems = json.map(row => ({
                code: String(row['품목코드'] || row['code'] || row['Code'] || '').trim(),
                name: row['품목명'] || row['name'] || row['Name'] || '',
                category: row['분류'] || row['전체유형'] || row['category'] || '완제품',
                spec: row['규격'] || row['spec'] || '-',
                supplier: row['거래처'] || row['제조원'] || row['supplier'] || '-',
                unit: row['단위'] || row['unit'] || 'EA',
                safety: Number(row['안전재고'] || row['safety']) || 20
            })).filter(i => i.code && i.name);

            const info = container.querySelector('#excel-preview-info');
            info.classList.remove('hidden');
            info.innerHTML = `<b>${parsedItems.length}건</b>의 유효한 품목이 감지되었습니다. (시트명: ${workbook.SheetNames[0]})`;
            container.querySelector('#btn-confirm-excel-import').classList.remove('hidden');
        };
        reader.readAsArrayBuffer(file);
    });

    container.querySelector('#btn-confirm-excel-import')?.addEventListener('click', async () => {
        if (parsedItems.length === 0) return;
        await bulkUpsertMasterItems(parsedItems);
        showToast(`✅ ${parsedItems.length}개 품목이 성공적으로 일괄 등록되었습니다.`);
        container.querySelector('#modal-excel').classList.add('hidden');
        if (onDataChanged) await onDataChanged();
    });

    // 6. 백업/복원
    container.querySelector('#btn-export-backup')?.addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = `daelim_wms_backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
    });

    // 백업 JSON 파일 업로드 복원
    container.querySelector('#backup-file-input')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const parsed = JSON.parse(evt.target.result);
                await restoreAllData(parsed);
                showToast(`✅ 백업 데이터(${parsed.master?.length || 0}개 품목)가 성공적으로 복원되었습니다.`);
                container.querySelector('#modal-backup').classList.add('hidden');
                if (onDataChanged) await onDataChanged();
            } catch (err) {
                alert('올바른 백업 JSON 파일 형식이 아닙니다: ' + err.message);
            }
        };
        reader.readAsText(file, 'utf-8');
    });

    // 대림오일 2,497종 실제 기업 데이터 즉시 로드 버튼
    container.querySelector('#btn-load-enterprise')?.addEventListener('click', async () => {
        if (confirm('대림오일 2,497개 품목 마스터 및 1,439건의 실재고 데이터를 즉시 로드하시겠습니까?')) {
            await resetToEnterpriseData();
            showToast('✅ 대림오일 2,497개 품목 및 실재고 데이터가 로드되었습니다.');
            container.querySelector('#modal-backup').classList.add('hidden');
            if (onDataChanged) await onDataChanged();
        }
    });

    // 8. 이동전표 서식 모달 로직
    const setupTransferSlip = () => {
        const today = new Date().toISOString().slice(0, 10);
        const docNoEl = container.querySelector('#slip-doc-no');
        const docDateEl = container.querySelector('#slip-doc-date');
        const workerEl = container.querySelector('#slip-worker-name');
        const fromLocEl = container.querySelector('#slip-from-loc');
        const toLocEl = container.querySelector('#slip-to-loc');

        if (docNoEl) docNoEl.innerText = `TR-${today.replace(/-/g, '')}-001`;
        if (docDateEl) docDateEl.innerText = today;
        if (workerEl) workerEl.innerText = state.currentGlobalWorker || '관리자';
        if (fromLocEl && state.locations.length > 0) fromLocEl.innerText = state.locations[0];
        if (toLocEl && state.locations.length > 1) toLocEl.innerText = state.locations[1];

        // 전표 종류 전환
        container.querySelector('#slip-type-select')?.addEventListener('change', (e) => {
            const isTransfer = e.target.value === 'TRANSFER';
            const titleEl = container.querySelector('#slip-title-text');
            const subTitleEl = container.querySelector('#slip-subtitle-text');
            if (isTransfer) {
                titleEl.innerText = '원 부 자 재 이 동 전 표';
                subTitleEl.innerText = 'MATERIAL TRANSFER SLIP';
            } else {
                titleEl.innerText = '자 재 출 고 및 불 출 요 청 서';
                subTitleEl.innerText = 'MATERIAL RELEASE REQUEST';
            }
        });

        // 최근 수불 이력으로 샘플 행 구성
        const tbody = container.querySelector('#slip-items-tbody');
        const totalEl = container.querySelector('#slip-total-qty');
        if (tbody) {
            const recentMoves = state.history.filter(h => h.type === 'MOVE' || h.type === 'OUT' || h.type === 'USE').slice(0, 5);
            if (recentMoves.length > 0) {
                let total = 0;
                tbody.innerHTML = recentMoves.map((h, idx) => {
                    total += Number(h.qty) || 0;
                    const item = state.master.find(m => m.code === h.code);
                    return `
                    <tr>
                        <td class="py-2 px-3">${idx + 1}</td>
                        <td class="py-2 px-3 font-mono font-bold">${h.code}</td>
                        <td class="py-2 px-3 font-bold">${h.name}</td>
                        <td class="py-2 px-3">${item?.spec || '-'}</td>
                        <td class="py-2 px-3 text-center">${item?.unit || 'EA'}</td>
                        <td class="py-2 px-3 text-right font-black text-blue-700">${Number(h.qty).toLocaleString()}</td>
                    </tr>
                    `;
                }).join('');
                if (totalEl) totalEl.innerText = `${total.toLocaleString()} EA`;
            } else {
                // 재고 중 첫 3개 아이템을 기본 전표에 표시
                const samples = state.inventory.slice(0, 3);
                let total = 0;
                tbody.innerHTML = samples.map((inv, idx) => {
                    total += Number(inv.quantity) || 0;
                    return `
                    <tr>
                        <td class="py-2 px-3">${idx + 1}</td>
                        <td class="py-2 px-3 font-mono font-bold">${inv.code}</td>
                        <td class="py-2 px-3 font-bold">${inv.name}</td>
                        <td class="py-2 px-3">${inv.spec || '-'}</td>
                        <td class="py-2 px-3 text-center">${inv.unit || 'EA'}</td>
                        <td class="py-2 px-3 text-right font-black text-blue-700">${Number(inv.quantity).toLocaleString()}</td>
                    </tr>
                    `;
                }).join('');
                if (totalEl) totalEl.innerText = `${total.toLocaleString()} EA`;
            }
        }
    };
    setupTransferSlip();

    createIcons({ icons });
};

export const openModalByName = (modalName) => {
    const el = document.querySelector(`#modal-${modalName}`);
    if (el) {
        el.classList.remove('hidden');
        createIcons({ icons });
        try {
            window.history.pushState({ modal: modalName, tab: window.__activeTab || 'home' }, '', `#${window.__activeTab || 'home'}`);
        } catch (e) {}
    }
};

export const closeAllModals = () => {
    const openModals = Array.from(document.querySelectorAll('.fixed.inset-0.z-50, [id^="modal-"], #wo-modal-backdrop')).filter(
        m => !m.classList.contains('hidden')
    );
    if (openModals.length > 0) {
        openModals.forEach(m => m.classList.add('hidden'));
        return true;
    }
    return false;
};
