import { 
    state, 
    addCategory, 
    deleteCategory, 
    addLocation, 
    deleteLocation, 
    addPartner,
    deletePartner,
    saveBeginningStock,
    saveWorker, 
    deleteWorker, 
    bulkUpsertMasterItems,
    restoreAllData,
    resetToEnterpriseData,
    saveUserAccount,
    deleteUserAccount
} from '../services/db.js';
import { getSupabaseConfig, saveSupabaseConfig, testSupabaseConnection } from '../services/supabase.js';
import * as XLSX from 'xlsx';
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
                    <p class="font-bold">🌐 실시간 클라우드 협업 안내</p>
                    <p class="text-[11px] leading-relaxed">
                        Supabase 대시보드의 <b>Project Settings &rarr; API</b>에서 URL과 anon key를 복사하여 아래에 입력하세요. 입력 즉시 현장 작업자와 사무실 간 <b>화면 새로고침 없는 실시간 동기화</b>가 활성화됩니다.
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

    <!-- 7. 권한 및 계정 관리 모달 -->
    <div id="modal-user" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
        <div class="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
            <div class="px-5 py-4 bg-indigo-600 text-white flex justify-between items-center">
                <div class="flex items-center gap-2">
                    <i data-lucide="users" class="w-5 h-5"></i>
                    <h3 class="font-bold text-sm">시스템 계정 및 권한 관리</h3>
                </div>
                <button type="button" class="btn-close-modal text-white/80 hover:text-white">&times;</button>
            </div>
            <div class="p-5 space-y-4 text-xs">
                <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-indigo-900">
                    <p class="font-bold">🔐 접근 권한 등급 안내</p>
                    <p class="text-[11px] mt-0.5"><b>ADMIN</b>(전체 권한), <b>MANAGER</b>(재고/실사/라벨), <b>OPERATOR</b>(현장 스캔/수불), <b>VIEWER</b>(단순 조회)</p>
                </div>

                <div class="overflow-x-auto border border-slate-200 rounded-xl">
                    <table class="w-full text-left">
                        <thead class="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                            <tr>
                                <th class="p-2.5">이름</th>
                                <th class="p-2.5">아이디</th>
                                <th class="p-2.5">부서</th>
                                <th class="p-2.5">권한 등급</th>
                                <th class="p-2.5 text-center">삭제</th>
                            </tr>
                        </thead>
                        <tbody id="user-mgmt-tbody" class="divide-y divide-slate-100"></tbody>
                    </table>
                </div>

                <!-- 계정 추가 폼 -->
                <form id="form-add-user" class="grid grid-cols-5 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <input type="text" id="u-name" required placeholder="이름" class="border border-slate-300 rounded-lg px-2 py-1.5" />
                    <input type="text" id="u-username" required placeholder="아이디" class="border border-slate-300 rounded-lg px-2 py-1.5 font-mono" />
                    <input type="password" id="u-password" required placeholder="비밀번호" class="border border-slate-300 rounded-lg px-2 py-1.5" />
                    <select id="u-role" class="border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                        <option value="ADMIN">ADMIN</option>
                        <option value="MANAGER">MANAGER</option>
                        <option value="OPERATOR" selected>OPERATOR</option>
                        <option value="VIEWER">VIEWER</option>
                    </select>
                    <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition">추가</button>
                </form>
            </div>
        </div>
    </div>
    `;

    // 닫기 버튼 일괄 바인딩
    container.querySelectorAll('.btn-close-modal').forEach(b => {
        b.addEventListener('click', () => {
            container.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
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

    container.querySelector('#btn-save-supabase')?.addEventListener('click', async () => {
        const url = container.querySelector('#cfg-supabase-url').value.trim();
        const key = container.querySelector('#cfg-supabase-key').value.trim();
        saveSupabaseConfig(url, key);
        showToast('💾 Supabase 설정이 저장되었습니다. 데이터를 동기화합니다.');
        container.querySelector('#modal-supabase').classList.add('hidden');
        if (onDataChanged) await onDataChanged();
    });

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

    // 7. 계정/권한 관리 모달 로직
    const renderUsers = () => {
        const tbody = container.querySelector('#user-mgmt-tbody');
        if (!tbody) return;
        tbody.innerHTML = state.users.map(u => {
            const isCurrent = state.currentUser && state.currentUser.username === u.username;
            const roleColor = u.role === 'ADMIN' ? 'bg-rose-100 text-rose-800' :
                              u.role === 'MANAGER' ? 'bg-indigo-100 text-indigo-800' :
                              u.role === 'OPERATOR' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700';

            return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-2.5 font-bold text-slate-900">${u.name} ${isCurrent ? '<span class="px-1.5 py-0.2 bg-blue-600 text-white rounded text-[9px] font-black">나</span>' : ''}</td>
                <td class="p-2.5 font-mono text-slate-600">${u.username}</td>
                <td class="p-2.5 text-slate-500">${u.dept || '-'}</td>
                <td class="p-2.5">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${roleColor}">${u.role}</span>
                </td>
                <td class="p-2.5 text-center">
                    <button type="button" class="del-user text-rose-500 hover:text-rose-700 text-xs font-bold disabled:opacity-30" data-user="${u.username}" ${isCurrent || u.username === 'admin' ? 'disabled' : ''}>삭제</button>
                </td>
            </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.del-user').forEach(b => {
            b.addEventListener('click', async () => {
                const uname = b.getAttribute('data-user');
                if (confirm(`계정 '${uname}'을(를) 삭제하시겠습니까?`)) {
                    await deleteUserAccount(uname);
                    renderUsers();
                    showToast(`계정 '${uname}'이 삭제되었습니다.`);
                }
            });
        });
    };

    container.querySelector('#form-add-user')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = container.querySelector('#u-name').value.trim();
        const username = container.querySelector('#u-username').value.trim();
        const password = container.querySelector('#u-password').value.trim();
        const role = container.querySelector('#u-role').value;

        if (name && username && password) {
            await saveUserAccount({ id: username, name, username, password, role, dept: '현장운영팀' });
            container.querySelector('#u-name').value = '';
            container.querySelector('#u-username').value = '';
            container.querySelector('#u-password').value = '';
            renderUsers();
            showToast(`계정 '${username}'(${role})이 등록되었습니다.`);
        }
    });
    renderUsers();

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
    }
};
