import { state, saveMasterItem, deleteMasterItem, updateMasterItemCode, parseEmbeddedCode, autoResolveTempMasterItems, bulkUpsertMasterItems } from '../services/db.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';
import { matchesQuery, ITEM_SUB_CATEGORIES, MASTER_CATEGORIES, SUB_CATEGORY_MAP, CATEGORY_CONFIG, determineCategoryAndSubCategory } from '../services/searchUtils.js';

export const renderMasterManager = (container, { showToast, onRefresh }) => {
    let modalImageUrl = null;
    let filterTempOnly = false; // 0000 임시코드 전용 모아보기 플래그
    let hideTempCodes = true; // 임시코드 숨기기/펼치기 플래그 (기본: 숨김)
    let selectedCategoryFilter = ''; // 대분류 퀵 필터
    let selectedSubCategory = 'ALL'; // 종류별 빠른 필터
    let currentResolvingItem = null;
    let currentPage = 1;
    let pageSize = 50;

    container.innerHTML = `
    <section id="tab-content-master" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="layout-grid" class="w-5 h-5 text-blue-600"></i>
                        <span>품목 마스터 관리</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">대분류(완제품, 원액, 원료, 부자재 등) 및 중분류(종류)별 표준 사양, 거래처, 안전재고를 관리하고 '0000' 임시코드를 정식 코드로 전환/병합합니다.</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <!-- 1. 엑셀 다운로드 -->
                    <button type="button" id="btn-export-master-excel" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm" title="현재 품목 마스터를 엑셀 파일로 내려받습니다.">
                        <i data-lucide="download" class="w-4 h-4"></i>
                        <span>엑셀 다운로드</span>
                    </button>
                    <!-- 2. 엑셀 일괄 업로드 / 업데이트 -->
                    <label for="input-upload-master-excel" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm cursor-pointer" title="엑셀 파일(.xlsx, .xls, .csv)을 업로드하여 마스터를 일괄 등록 및 최신 정보로 갱신합니다.">
                        <i data-lucide="upload-cloud" class="w-4 h-4"></i>
                        <span>엑셀 일괄 업로드</span>
                        <input type="file" id="input-upload-master-excel" accept=".xlsx, .xls, .csv" class="hidden" />
                    </label>
                    <!-- 3. 구글 시트 연동 업데이트 -->
                    <button type="button" id="btn-open-google-master-modal" class="px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm" title="구글 시트의 품목 데이터를 복사/붙여넣기하거나 URL로 즉시 일괄 동기화합니다.">
                        <i data-lucide="table-properties" class="w-4 h-4"></i>
                        <span>구글시트 연동 업데이트</span>
                    </button>
                    <!-- 4. 신규 품목 단건 등록 -->
                    <button type="button" id="btn-open-add-master" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="plus" class="w-4 h-4"></i>
                        <span>신규 품목 등록</span>
                    </button>
                </div>
            </div>

            <!-- 1. 대분류 빠른 선택 칩 바 (완제품 / 원액 / 원료 / 부자재) -->
            <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs select-none" id="master-cat-chips">
                <span class="text-slate-500 font-bold text-[11px] whitespace-nowrap mr-1 flex items-center gap-1">
                    <i data-lucide="layers" class="w-3.5 h-3.5 text-blue-600"></i> 대분류 퀵 필터:
                </span>
                <button type="button" class="btn-cat-chip px-3 py-1 rounded-lg font-black transition whitespace-nowrap bg-blue-600 text-white shadow-2xs" data-cat="">
                    전체 (<span id="cnt-cat-all">${state.master.length}</span>)
                </button>
                <button type="button" class="btn-cat-chip px-3 py-1 rounded-lg font-black transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-blue-50 hover:text-blue-800" data-cat="완제품">
                    📦 완제품 (<span id="cnt-cat-wan">0</span>)
                </button>
                <button type="button" class="btn-cat-chip px-3 py-1 rounded-lg font-black transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-purple-50 hover:text-purple-800" data-cat="원액">
                    🧪 원액 (<span id="cnt-cat-won">0</span>)
                </button>
                <button type="button" class="btn-cat-chip px-3 py-1 rounded-lg font-black transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-rose-50 hover:text-rose-800" data-cat="원료">
                    🛢️ 원료 (<span id="cnt-cat-raw">0</span>)
                </button>
                <button type="button" class="btn-cat-chip px-3 py-1 rounded-lg font-black transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-emerald-50 hover:text-emerald-800" data-cat="부자재">
                    🏷️ 부자재 (<span id="cnt-cat-sub">0</span>)
                </button>
            </div>

            <!-- 2. 종류별 빠른 선택 칩 바 (완제품/원액/원료/부자재 14대 중분류 체계) -->
            <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs select-none" id="master-subcat-chips">
                <span class="text-slate-500 font-bold text-[11px] whitespace-nowrap mr-1 flex items-center gap-1">
                    <i data-lucide="tag" class="w-3.5 h-3.5 text-blue-600"></i> 중분류 퀵 필터:
                </span>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-blue-600 text-white shadow-2xs" data-sub="ALL">
                    전체 (<span id="cnt-sub-all">${state.master.length}</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-blue-50 hover:text-blue-800 hover:border-blue-300" data-sub="ODM 제품">
                    🏢 ODM 제품 (<span id="cnt-sub-odm">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300" data-sub="자사제품">
                    ⭐ 자사제품 (<span id="cnt-sub-jasa">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-purple-50 hover:text-purple-800 hover:border-purple-300" data-sub="엔진오일">
                    🛢️ 엔진오일 (<span id="cnt-sub-oil">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-indigo-50 hover:text-indigo-800 hover:border-indigo-300" data-sub="엔진코팅제">
                    ✨ 엔진코팅제 (<span id="cnt-sub-coating">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-rose-50 hover:text-rose-800 hover:border-rose-300" data-sub="브레이크액">
                    🛑 브레이크액 (<span id="cnt-sub-brake">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-teal-50 hover:text-teal-800 hover:border-teal-300" data-sub="첨가제">
                    🧪 첨가제 (<span id="cnt-sub-additive">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-sky-50 hover:text-sky-800 hover:border-sky-300" data-sub="BO">
                    💧 BO (기유) (<span id="cnt-sub-bo">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-cyan-50 hover:text-cyan-800 hover:border-cyan-300" data-sub="AC">
                    🔬 AC (<span id="cnt-sub-ac">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-violet-50 hover:text-violet-800 hover:border-violet-300" data-sub="AD">
                    ⚙️ AD (<span id="cnt-sub-ad">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-red-50 hover:text-red-800 hover:border-red-300" data-sub="EP">
                    🛡️ EP (<span id="cnt-sub-ep">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-300" data-sub="라벨">
                    🏷️ 라벨 (<span id="cnt-sub-label">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300" data-sub="아웃박스">
                    📦 아웃박스 (<span id="cnt-sub-outbox">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-indigo-50 hover:text-indigo-800 hover:border-indigo-300" data-sub="인박스">
                    📥 인박스 (<span id="cnt-sub-inbox">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-purple-50 hover:text-purple-800 hover:border-purple-300" data-sub="용기">
                    🫙 용기 (<span id="cnt-sub-bottle">0</span>)
                </button>
                <button type="button" class="btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:text-slate-800 hover:border-slate-300" data-sub="기타">
                    📎 기타 부자재 (<span id="cnt-sub-etc">0</span>)
                </button>
            </div>

            <!-- 필터 & 검색 바 -->
            <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div class="flex flex-wrap items-center gap-2">
                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-bold text-slate-600">대분류:</span>
                        <select id="master-filter-category" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-blue-500">
                            <option value="">전체 대분류 (${state.categories.length})</option>
                            ${state.categories.map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>
                    </div>

                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-bold text-slate-600">중분류(종류):</span>
                        <select id="master-filter-subcategory" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-blue-500">
                            <option value="">전체 중분류</option>
                        </select>
                    </div>

                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-bold text-slate-600">거래처:</span>
                        <select id="master-filter-partner" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-blue-500">
                            <option value="">전체 거래처</option>
                            ${(state.partners || []).map(p => `<option value="${p}">${p}</option>`).join('')}
                        </select>
                    </div>

                    <!-- 임시코드 숨기기/펼치기 토글 버튼 -->
                    <button type="button" id="btn-toggle-temp-hide" class="px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200" title="임시코드(0000)를 목록에서 숨기거나 펼칩니다.">
                        <i data-lucide="eye" class="w-3.5 h-3.5 text-blue-600"></i>
                        <span id="btn-toggle-temp-hide-text">임시코드 펼치기</span>
                        <span id="badge-hide-temp-count" class="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700 font-black">0</span>
                    </button>

                    <!-- 0000 임시코드 품목 모아보기 필터 버튼 -->
                    <button type="button" id="btn-filter-temp-codes" class="px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-white text-slate-700 border-slate-300 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300">
                        <i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-amber-500"></i>
                        <span>임시코드(0000)만 모아보기</span>
                        <span id="badge-temp-count" class="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-amber-800 font-black">0</span>
                    </button>

                    <!-- 임시코드 품목명 자동분석 및 일괄 정식 전환 버튼 -->
                    <button type="button" id="btn-auto-resolve-embedded" class="px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 shadow-2xs" title="품목명 안에 품목코드가 있거나 기존 마스터와 일치하는 임시코드를 정식 코드로 일괄 변환 및 재고 병합">
                        <i data-lucide="sparkles" class="w-3.5 h-3.5 text-indigo-600"></i>
                        <span>임시코드 자동정리</span>
                        <span id="badge-auto-resolve-count" class="px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-600 text-white font-black">0</span>
                    </button>
                </div>

                <!-- 검색창 및 검색/초기화 버튼 -->
                <div class="flex items-center gap-1.5">
                    <div class="relative">
                        <input type="text" id="master-search-input" placeholder="코드, 품명, 규격, 거래처 검색..." class="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none w-56 sm:w-64" />
                        <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2"></i>
                    </div>
                    <button type="button" id="btn-master-search" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-2xs" title="검색 실행 (Enter)">
                        <i data-lucide="search" class="w-3.5 h-3.5"></i>
                        <span>검색</span>
                    </button>
                    <button type="button" id="btn-master-search-reset" class="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-bold text-slate-600 transition" title="필터 및 검색어 초기화">
                        <span>초기화</span>
                    </button>
                </div>
            </div>

            <!-- 마스터 테이블 (대분류와 중분류 별도칸으로 2개 분리) -->
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 text-slate-600 border-b border-slate-200 font-bold">
                        <tr>
                            <th class="p-3 text-center w-12">사진</th>
                            <th class="p-3">품목코드</th>
                            <th class="p-3 text-center">대분류</th>
                            <th class="p-3 text-center">중분류</th>
                            <th class="p-3">품목명</th>
                            <th class="p-3">규격 / 사양</th>
                            <th class="p-3">주요 거래처</th>
                            <th class="p-3 text-center">단위</th>
                            <th class="p-3 text-right">안전재고</th>
                            <th class="p-3 text-center">관리 / 코드전환</th>
                        </tr>
                    </thead>
                    <tbody id="master-table-body" class="divide-y divide-slate-100"></tbody>
                </table>
            </div>

            <!-- 마스터 페이지네이션 컨트롤 바 -->
            <div id="master-pagination-bar" class="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs">
                <div class="flex items-center gap-2 text-slate-600 font-medium">
                    <span id="master-page-info" class="font-bold text-slate-700">총 0건 중 0~0건 표시</span>
                    <div class="flex items-center gap-1 ml-2">
                        <span class="text-slate-400 text-[11px]">페이지당:</span>
                        <select id="master-page-size" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer">
                            <option value="30">30개</option>
                            <option value="50" selected>50개</option>
                            <option value="100">100개</option>
                            <option value="200">200개</option>
                            <option value="all">전체 (모두 표시)</option>
                        </select>
                    </div>
                </div>
                <div class="flex items-center gap-1 select-none" id="master-page-buttons"></div>
            </div>
        </div>

        <!-- 1. 품목 등록/수정 모달 -->
        <div id="master-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
            <div class="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
                <div class="px-5 py-4 bg-slate-900 text-white flex justify-between items-center">
                    <h3 id="master-modal-title" class="font-bold text-sm">신규 품목 마스터 등록</h3>
                    <button type="button" id="btn-close-master-modal" class="text-slate-400 hover:text-white text-lg">&times;</button>
                </div>
                <form id="master-item-form" class="p-5 space-y-4">
                    <input type="hidden" id="m-original-code" value="" />
                    <div class="grid grid-cols-3 gap-2.5">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">품목코드 *</label>
                            <input type="text" id="m-code" required placeholder="예: ITEM-1005" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold" />
                            <p id="m-code-hint" class="text-[10px] text-slate-400 mt-0.5">기존 코드는 변경 불가</p>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">자재 분류 *</label>
                            <select id="m-category" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold">
                                ${state.categories.map(c => `<option value="${c}">${c}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">상세 종류 *</label>
                            <select id="m-subcategory" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold">
                                <option value="라벨">🏷️ 라벨</option>
                                <option value="아웃박스">📦 아웃박스</option>
                                <option value="인박스">📥 인박스</option>
                                <option value="캡">🔘 캡</option>
                                <option value="용기">🫙 용기</option>
                                <option value="드럼">🛢️ 드럼</option>
                                <option value="완제품">⚙️ 완제품</option>
                                <option value="원료">🧪 원료</option>
                                <option value="기타 부자재">📎 기타 부자재</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">품목명 *</label>
                        <input type="text" id="m-name" required placeholder="예: 대림 울트라 5W-30 엔진오일" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold" />
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">규격 / 사양</label>
                            <input type="text" id="m-spec" placeholder="예: 200L Drum / API SP" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">주요 거래처 (공급사)</label>
                            <input type="text" id="m-supplier" list="master-supplier-datalist" placeholder="선택 또는 직접 입력" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold" />
                            <datalist id="master-supplier-datalist">
                                ${(state.partners || []).map(p => `<option value="${p}">`).join('')}
                            </datalist>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">수량 단위</label>
                            <input type="text" id="m-unit" value="EA" placeholder="EA, DRUM, CAN, KG 등" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">안전재고 기준치</label>
                            <input type="number" id="m-safety" min="0" value="50" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-black" />
                        </div>
                    </div>

                    <!-- 실물 사진 첨부 필드 -->
                    <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                        <label class="block text-xs font-bold text-slate-700 mb-2">품목 실물 사진 / 도면</label>
                        <div class="flex items-center gap-3">
                            <div id="m-preview-box" class="w-16 h-16 rounded-xl border-2 border-dashed border-slate-300 bg-white overflow-hidden flex items-center justify-center cursor-pointer hover:border-blue-500 shadow-xs flex-shrink-0">
                                <i data-lucide="camera" class="w-6 h-6 text-slate-400"></i>
                            </div>
                            <div class="space-y-1.5 flex-1">
                                <input type="file" id="m-image-input" accept="image/*" class="hidden" />
                                <div class="flex items-center gap-2">
                                    <button type="button" id="btn-upload-img" class="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 flex items-center gap-1.5 transition shadow-xs">
                                        <i data-lucide="upload" class="w-3.5 h-3.5 text-blue-600"></i>
                                        <span>사진 선택 / 촬영</span>
                                    </button>
                                    <button type="button" id="btn-del-img" class="hidden px-2.5 py-1.5 text-xs text-rose-600 hover:text-rose-800 font-bold">삭제</button>
                                </div>
                                <p class="text-[11px] text-slate-400">모바일 카메라 촬영 지원 (자동 400px 고화질 압축 보관)</p>
                            </div>
                        </div>
                    </div>

                    <div class="pt-2 flex justify-end gap-2">
                        <button type="button" id="btn-cancel-master" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50">취소</button>
                        <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm">저장 및 클라우드 반영</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- 2. '0000' 임시코드 -> 정식 코드 전환 및 재고 병합 전용 모달 -->
        <div id="modal-resolve-temp-code" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
            <div class="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
                <div class="px-5 py-4 bg-amber-600 text-white flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <i data-lucide="tag" class="w-5 h-5"></i>
                        <h3 class="font-bold text-sm">임시 품목코드 정식 전환 및 재고 병합</h3>
                    </div>
                    <button type="button" id="btn-close-resolve-modal" class="text-amber-200 hover:text-white text-lg">&times;</button>
                </div>

                <div class="p-5 space-y-4">
                    <!-- 현재 임시 품목 정보 카드 -->
                    <div class="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 space-y-1.5 text-xs">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-amber-900">현재 임시코드:</span>
                            <span id="res-target-code" class="font-mono font-black text-amber-700 bg-white px-2 py-0.5 rounded border border-amber-300">0000</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-amber-900">임시 품목명:</span>
                            <span id="res-target-name" class="font-bold text-slate-800">품목명</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-amber-900">현재 총 재고:</span>
                            <span id="res-target-stock" class="font-mono font-black text-blue-600">0 EA</span>
                        </div>
                    </div>

                    <!-- 전환 방식 선택 (탭/라디오) -->
                    <div class="space-y-2">
                        <label class="block text-xs font-bold text-slate-800">전환 및 병합 방식 선택:</label>
                        <div class="grid grid-cols-2 gap-2">
                            <button type="button" id="btn-mode-merge" class="p-2.5 rounded-xl border-2 text-xs font-bold text-left transition border-blue-600 bg-blue-50/40 text-blue-900">
                                <div class="flex items-center gap-1.5 mb-1">
                                    <i data-lucide="merge" class="w-4 h-4 text-blue-600"></i>
                                    <span>기존 품목으로 병합</span>
                                </div>
                                <p class="text-[11px] text-slate-500 font-normal">기존 마스터 품목에 재고 합산 및 임시코드 정리</p>
                            </button>
                            <button type="button" id="btn-mode-new" class="p-2.5 rounded-xl border-2 text-xs font-bold text-left transition border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
                                <div class="flex items-center gap-1.5 mb-1">
                                    <i data-lucide="plus-circle" class="w-4 h-4 text-emerald-600"></i>
                                    <span>신규 정식코드 부여</span>
                                </div>
                                <p class="text-[11px] text-slate-500 font-normal">새로운 정식 품목코드로 일괄 치환</p>
                            </button>
                        </div>
                    </div>

                    <!-- A. 기존 품목으로 병합 폼 -->
                    <div id="section-merge-form" class="space-y-3 pt-1">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">병합할 기존 마스터 품목 선택 *</label>
                            <input type="text" id="res-merge-search" list="master-items-datalist" placeholder="코드 또는 품목명 검색..." class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            <datalist id="master-items-datalist">
                                ${state.master.filter(m => !m.code.startsWith('0000')).map(m => `<option value="${m.code}">${m.code} / ${m.name} (${m.spec || '-'})</option>`).join('')}
                            </datalist>
                        </div>
                        <div id="res-merge-preview" class="hidden p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                            <p class="font-bold text-slate-800">선택된 품목: <span id="res-merge-name" class="text-blue-600">-</span></p>
                            <p class="text-[11px] text-slate-500">병합 시 임시코드의 모든 재고와 수불 이력이 위 품목으로 자동 흡수 합산됩니다.</p>
                        </div>
                    </div>

                    <!-- B. 신규 정식코드 부여 폼 -->
                    <div id="section-new-form" class="hidden space-y-3 pt-1">
                        <div class="grid grid-cols-3 gap-2">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">신규 정식 품목코드 *</label>
                                <input type="text" id="res-new-code" placeholder="예: 1AA40099, DE030500" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">자재 분류 *</label>
                                <select id="res-new-category" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold">
                                    ${state.categories.map(c => `<option value="${c}">${c}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">상세 종류 *</label>
                                <select id="res-new-subcategory" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold">
                                </select>
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">정식 품목명 *</label>
                            <input type="text" id="res-new-name" placeholder="정식 품목명" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold" />
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">규격 / 사양</label>
                                <input type="text" id="res-new-spec" placeholder="1L, 200L Drum 등" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">주요 거래처</label>
                                <input type="text" id="res-new-supplier" list="master-supplier-datalist" placeholder="공급사" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs" />
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">단위</label>
                                <input type="text" id="res-new-unit" value="EA" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">안전재고</label>
                                <input type="number" id="res-new-safety" value="50" min="0" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-black" />
                            </div>
                        </div>
                    </div>

                    <div class="pt-3 border-t border-slate-100 flex justify-end gap-2">
                        <button type="button" id="btn-cancel-resolve" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50">취소</button>
                        <button type="button" id="btn-commit-resolve" class="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-sm flex items-center gap-1.5">
                            <i data-lucide="check" class="w-4 h-4"></i>
                            <span>코드 확정 및 일괄 반영</span>
                        </button>
                    </div>
                </div>
            </div>
        <!-- 3. 구글 시트 연동 및 일괄 업데이트 모달 -->
        <div id="modal-google-sheet-master" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
            <div class="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
                <div class="px-5 py-4 bg-teal-700 text-white flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <i data-lucide="table-properties" class="w-5 h-5"></i>
                        <h3 class="font-bold text-sm">구글 시트 품목 마스터 연동 및 일괄 업데이트</h3>
                    </div>
                    <button type="button" id="btn-close-google-modal" class="text-teal-200 hover:text-white text-lg">&times;</button>
                </div>

                <div class="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
                    <!-- 서브 탭: 붙여넣기 vs URL -->
                    <div class="flex items-center gap-2 border-b border-slate-200 pb-2">
                        <button type="button" id="tab-btn-gs-paste" class="px-4 py-2 rounded-xl font-bold bg-teal-600 text-white transition shadow-2xs">
                            📋 구글시트 복사 & 붙여넣기 (가장 추천)
                        </button>
                        <button type="button" id="tab-btn-gs-url" class="px-4 py-2 rounded-xl font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition">
                            🌐 구글시트 URL 동기화
                        </button>
                    </div>

                    <!-- 1. 구글시트 복사 & 붙여넣기 영역 -->
                    <div id="gs-pane-paste" class="space-y-3">
                        <div class="p-3 bg-teal-50 border border-teal-200 rounded-xl space-y-1">
                            <span class="font-black text-teal-900 block">💡 구글 시트 복사 & 붙여넣기 사용법</span>
                            <p class="text-teal-700 leading-relaxed text-[11px]">
                                구글 스프레드시트에서 <b>제목 행(품목코드, 품목명, 대분류, 중분류, 규격, 거래처, 단위, 안전재고 등)</b>을 포함하여 데이터를 드래그 복사(Ctrl + C)한 후 아래 상자에 붙여넣기(Ctrl + V)하세요.
                            </p>
                        </div>
                        <div>
                            <label class="block font-bold text-slate-700 mb-1">구글 시트 복사 내용 붙여넣기 *</label>
                            <textarea id="gs-paste-textarea" rows="8" placeholder="구글 시트에서 표를 복사(Ctrl+C)한 후 여기에 붙여넣기(Ctrl+V)하세요..." class="w-full border border-slate-300 rounded-xl p-3 font-mono text-[11px] focus:ring-2 focus:ring-teal-500 focus:outline-none"></textarea>
                        </div>
                        <div id="gs-paste-preview-box" class="hidden p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                            <p class="font-bold text-slate-800">분석 결과: <span id="gs-paste-count" class="text-teal-600 font-black">0</span>건 확인됨</p>
                            <p id="gs-paste-sample" class="text-slate-500 text-[11px] truncate"></p>
                        </div>
                    </div>

                    <!-- 2. 구글시트 URL 동기화 영역 -->
                    <div id="gs-pane-url" class="hidden space-y-3">
                        <div class="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-1">
                            <span class="font-black text-blue-900 block">💡 구글 시트 공유 URL 입력</span>
                            <p class="text-blue-700 leading-relaxed text-[11px]">
                                구글 스프레드시트의 공유 권한이 <b>'링크가 있는 모든 사용자 - 뷰어'</b>로 설정되어 있어야 합니다.<br/>
                                스프레드시트 상단 주소창의 URL(https://docs.google.com/spreadsheets/d/...)을 복사하여 아래에 입력하세요.
                            </p>
                        </div>
                        <div>
                            <label class="block font-bold text-slate-700 mb-1">구글 스프레드시트 URL *</label>
                            <input type="text" id="gs-sheet-url" placeholder="https://docs.google.com/spreadsheets/d/스프레드시트ID/edit" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono" />
                        </div>
                        <button type="button" id="btn-fetch-gs-url" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                            <i data-lucide="cloud-download" class="w-4 h-4"></i>
                            <span>구글 시트 데이터 불러오기</span>
                        </button>
                    </div>
                </div>

                <div class="px-5 py-3 border-t border-slate-100 bg-slate-50 flex flex-wrap justify-between items-center gap-2">
                    <span class="text-[11px] text-slate-500 font-medium">✨ 기존 품목코드는 정보 수정, 신규 코드는 자동 추가됩니다.</span>
                    <div class="flex items-center gap-2">
                        <button type="button" id="btn-cancel-google-modal" class="px-4 py-2 border border-slate-300 rounded-xl text-xs font-bold text-slate-600 hover:bg-white">취소</button>
                        <button type="button" id="btn-commit-google-update" class="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-sm flex items-center gap-1.5">
                            <i data-lucide="check" class="w-4 h-4"></i>
                            <span>일괄 업데이트 실행</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </section>
    `;

    // 0000 임시코드 수 및 자동 정리 가능 수 카운트 갱신
    const updateTempBadgeCount = () => {
        const norm = (s) => (s || '').toLowerCase().replace(/[\s\-_/\\|()\[\]{}'"`.,:;+~*]/g, '');
        const tempCount = state.master.filter(m => m.code.startsWith('0000')).length;
        const autoResolvableCount = state.master.filter(m => {
            if (!m.code.startsWith('0000')) return false;
            if (parseEmbeddedCode(m.name)) return true;
            const normName = norm(m.name);
            return normName.length >= 3 && state.master.some(other => !other.code.startsWith('0000') && norm(other.name) === normName);
        }).length;

        const badge = container.querySelector('#badge-temp-count');
        if (badge) {
            badge.textContent = tempCount;
            if (tempCount > 0) {
                badge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-black animate-pulse';
            } else {
                badge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-600 font-bold';
            }
        }

        // 임시코드 숨기기/펼치기 버튼 UI 반영
        const hideBtn = container.querySelector('#btn-toggle-temp-hide');
        const hideTxt = container.querySelector('#btn-toggle-temp-hide-text');
        const hideBadge = container.querySelector('#badge-hide-temp-count');
        if (hideBtn && hideTxt && hideBadge) {
            if (hideTempCodes) {
                hideBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200';
                hideTxt.textContent = '임시코드 펼치기';
                hideBadge.textContent = `${tempCount}건 숨김`;
                hideBadge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700 font-black';
            } else {
                hideBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200';
                hideTxt.textContent = '임시코드 숨기기';
                hideBadge.textContent = `${tempCount}건 표시중`;
                hideBadge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-amber-200 text-amber-900 font-black';
            }
        }

        const autoBadge = container.querySelector('#badge-auto-resolve-count');
        const autoBtn = container.querySelector('#btn-auto-resolve-embedded');
        if (autoBadge) {
            autoBadge.textContent = autoResolvableCount;
            if (autoResolvableCount > 0) {
                autoBtn?.classList.remove('opacity-50');
                autoBadge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-600 text-white font-black animate-bounce';
            } else {
                autoBtn?.classList.add('opacity-50');
                autoBadge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-slate-300 text-slate-600 font-bold';
            }
        }
    };

    // 대분류 퀵 필터 칩 카운트 갱신
    const updateCategoryChipCounts = () => {
        const counts = { ALL: 0, '완제품': 0, '원액': 0, '원료': 0, '부자재': 0 };
        for (const m of state.master) {
            const isTemp = m.code.startsWith('0000');
            if (hideTempCodes && !filterTempOnly && isTemp) continue;
            const res = determineCategoryAndSubCategory(m);
            counts.ALL++;
            if (counts[res.category] !== undefined) counts[res.category]++;
        }
        const setTxt = (id, val) => {
            const el = container.querySelector(id);
            if (el) el.textContent = (val || 0).toLocaleString();
        };
        setTxt('#cnt-cat-all', counts.ALL);
        setTxt('#cnt-cat-wan', counts['완제품']);
        setTxt('#cnt-cat-won', counts['원액']);
        setTxt('#cnt-cat-raw', counts['원료']);
        setTxt('#cnt-cat-sub', counts['부자재']);
    };

    // 종류별 빠른 선택 칩 카운트 갱신
    const updateSubCategoryChipCounts = () => {
        const counts = {
            ALL: state.master.length,
            'ODM 제품': 0, '자사제품': 0,
            '엔진오일': 0, '엔진코팅제': 0, '브레이크액': 0, '첨가제': 0,
            'BO': 0, 'AC': 0, 'AD': 0, 'EP': 0,
            '라벨': 0, '아웃박스': 0, '인박스': 0, '용기': 0, '기타': 0
        };
        for (const m of state.master) {
            const res = determineCategoryAndSubCategory(m);
            const sub = res.subCategory;
            if (counts[sub] !== undefined) counts[sub]++;
            else counts['기타']++;
        }
        const setTxt = (id, val) => {
            const el = container.querySelector(id);
            if (el) el.textContent = (val || 0).toLocaleString();
        };
        setTxt('#cnt-sub-all', counts.ALL);
        setTxt('#cnt-sub-odm', counts['ODM 제품']);
        setTxt('#cnt-sub-jasa', counts['자사제품']);
        setTxt('#cnt-sub-oil', counts['엔진오일']);
        setTxt('#cnt-sub-coating', counts['엔진코팅제']);
        setTxt('#cnt-sub-brake', counts['브레이크액']);
        setTxt('#cnt-sub-additive', counts['첨가제']);
        setTxt('#cnt-sub-bo', counts['BO']);
        setTxt('#cnt-sub-ac', counts['AC']);
        setTxt('#cnt-sub-ad', counts['AD']);
        setTxt('#cnt-sub-ep', counts['EP']);
        setTxt('#cnt-sub-label', counts['라벨']);
        setTxt('#cnt-sub-outbox', counts['아웃박스']);
        setTxt('#cnt-sub-inbox', counts['인박스']);
        setTxt('#cnt-sub-bottle', counts['용기']);
        setTxt('#cnt-sub-etc', counts['기타']);
    };

    // 페이지네이션 컨트롤러 렌더링
    const renderPaginationControls = (totalCount, startIndex, endIndex, totalPages) => {
        const pageInfoEl = container.querySelector('#master-page-info');
        const pageButtonsEl = container.querySelector('#master-page-buttons');
        if (!pageInfoEl || !pageButtonsEl) return;

        pageInfoEl.textContent = `총 ${totalCount.toLocaleString()}건 중 ${totalCount > 0 ? (startIndex + 1).toLocaleString() : 0}~${endIndex.toLocaleString()}건 표시 (페이지 ${currentPage}/${totalPages})`;

        if (totalPages <= 1) {
            pageButtonsEl.innerHTML = '';
            return;
        }

        let html = `
            <button type="button" class="btn-page px-2 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition" data-page="1" ${currentPage === 1 ? 'disabled' : ''} title="첫 페이지">
                &laquo;
            </button>
            <button type="button" class="btn-page px-2.5 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} title="이전 페이지">
                &lsaquo; 이전
            </button>
        `;

        let startP = Math.max(1, currentPage - 2);
        let endP = Math.min(totalPages, startP + 4);
        if (endP - startP < 4) {
            startP = Math.max(1, endP - 4);
        }

        for (let p = startP; p <= endP; p++) {
            const isActive = p === currentPage;
            html += `
                <button type="button" class="btn-page px-2.5 py-1 rounded-md text-[11px] font-bold transition ${isActive ? 'bg-blue-600 text-white shadow-xs' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'}" data-page="${p}">
                    ${p}
                </button>
            `;
        }

        html += `
            <button type="button" class="btn-page px-2.5 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''} title="다음 페이지">
                다음 &rsaquo;
            </button>
            <button type="button" class="btn-page px-2 py-1 bg-white border border-slate-200 rounded-md text-[11px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition" data-page="${totalPages}" ${currentPage === totalPages ? 'disabled' : ''} title="마지막 페이지">
                &raquo;
            </button>
        `;

        pageButtonsEl.innerHTML = html;
        pageButtonsEl.querySelectorAll('.btn-page').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetPage = Number(btn.getAttribute('data-page'));
                if (targetPage && targetPage !== currentPage && targetPage >= 1 && targetPage <= totalPages) {
                    currentPage = targetPage;
                    renderTable();
                }
            });
        });
    };

    const renderTable = () => {
        const catFilter = container.querySelector('#master-filter-category').value;
        const subFilter = container.querySelector('#master-filter-subcategory').value;
        const partnerFilter = container.querySelector('#master-filter-partner').value;
        const search = container.querySelector('#master-search-input').value.trim();

        const filtered = state.master.filter(m => {
            const isTemp = m.code.startsWith('0000');
            // 1. 임시코드 모아보기 활성화 시: 임시코드만 노출
            if (filterTempOnly) {
                if (!isTemp) return false;
            } else if (hideTempCodes) {
                // 2. 임시코드 숨김 모드일 때: 임시코드 제외
                if (isTemp) return false;
            }

            const res = determineCategoryAndSubCategory(m);
            const cat = res.category;
            const sub = res.subCategory;

            if (selectedCategoryFilter && cat !== selectedCategoryFilter) return false;
            if (selectedSubCategory !== 'ALL' && sub !== selectedSubCategory) return false;
            const matchesCat = !catFilter || cat === catFilter;
            const matchesSub = !subFilter || sub === subFilter;
            const matchesPartner = !partnerFilter || m.supplier === partnerFilter;
            const matchesSearch = !search || matchesQuery(m, search, ['code', 'name', 'spec', 'supplier', 'category', 'subCategory']);
            return matchesCat && matchesSub && matchesPartner && matchesSearch;
        });

        updateTempBadgeCount();
        updateCategoryChipCounts();
        updateSubCategoryChipCounts();

        const tbody = container.querySelector('#master-table-body');
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-slate-400 text-xs">일치하는 품목이 없습니다.</td></tr>`;
            renderPaginationControls(0, 0, 0, 1);
            return;
        }

        const totalCount = filtered.length;
        const isAll = pageSize === 'all';
        const actualSize = isAll ? totalCount : Number(pageSize);
        const totalPages = Math.max(1, Math.ceil(totalCount / actualSize));
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        const startIndex = (currentPage - 1) * actualSize;
        const endIndex = Math.min(startIndex + actualSize, totalCount);
        const pagedItems = filtered.slice(startIndex, endIndex);

        tbody.innerHTML = pagedItems.map(item => {
            const isTemp = item.code.startsWith('0000');
            const res = determineCategoryAndSubCategory(item);
            const cat = res.category;
            const sub = res.subCategory;
            
            let catBadgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
            if (cat === '완제품') catBadgeClass = 'bg-blue-100 text-blue-800 border-blue-200';
            else if (cat === '원액') catBadgeClass = 'bg-purple-100 text-purple-800 border-purple-200';
            else if (cat === '원료') catBadgeClass = 'bg-rose-100 text-rose-800 border-rose-200';
            else if (cat === '부자재') catBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
            else if (cat === '소모품') catBadgeClass = 'bg-amber-100 text-amber-800 border-amber-200';
            else if (cat === '기타') catBadgeClass = 'bg-slate-100 text-slate-800 border-slate-200';

            let subBadgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
            let subIcon = '🏷️';
            if (sub === 'ODM 제품') { subBadgeClass = 'bg-blue-100 text-blue-800 border-blue-300'; subIcon = '🏢'; }
            else if (sub === '자사제품') { subBadgeClass = 'bg-amber-100 text-amber-800 border-amber-300'; subIcon = '⭐'; }
            else if (sub === '엔진오일') { subBadgeClass = 'bg-purple-100 text-purple-800 border-purple-300'; subIcon = '🛢️'; }
            else if (sub === '엔진코팅제') { subBadgeClass = 'bg-indigo-100 text-indigo-800 border-indigo-300'; subIcon = '✨'; }
            else if (sub === '브레이크액') { subBadgeClass = 'bg-rose-100 text-rose-800 border-rose-300'; subIcon = '🛑'; }
            else if (sub === '첨가제') { subBadgeClass = 'bg-teal-100 text-teal-800 border-teal-300'; subIcon = '🧪'; }
            else if (sub === 'BO') { subBadgeClass = 'bg-sky-100 text-sky-800 border-sky-300'; subIcon = '💧'; }
            else if (sub === 'AC') { subBadgeClass = 'bg-cyan-100 text-cyan-800 border-cyan-300'; subIcon = '🔬'; }
            else if (sub === 'AD') { subBadgeClass = 'bg-violet-100 text-violet-800 border-violet-300'; subIcon = '⚙️'; }
            else if (sub === 'EP') { subBadgeClass = 'bg-red-100 text-red-800 border-red-300'; subIcon = '🛡️'; }
            else if (sub === '용기') { subBadgeClass = 'bg-purple-100 text-purple-800 border-purple-300'; subIcon = '🫙'; }
            else if (sub === '아웃박스') { subBadgeClass = 'bg-amber-100 text-amber-800 border-amber-300'; subIcon = '📦'; }
            else if (sub === '인박스') { subBadgeClass = 'bg-indigo-100 text-indigo-800 border-indigo-300'; subIcon = '📥'; }
            else if (sub === '라벨') { subBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300'; subIcon = '🏷️'; }
            else if (sub === '기타') { subBadgeClass = 'bg-slate-100 text-slate-800 border-slate-300'; subIcon = '📎'; }
            else { subBadgeClass = 'bg-slate-50 text-slate-500 border-slate-200'; subIcon = '—'; }

            const embedded = isTemp ? parseEmbeddedCode(item.name) : null;

            return `
            <tr class="hover:bg-slate-50 transition ${isTemp ? 'bg-amber-50/30' : ''}">
                <td class="p-2 text-center">
                    <div class="btn-thumb-preview w-9 h-9 mx-auto rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-blue-400 transition" data-code="${item.code}">
                        ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.name}" class="w-full h-full object-cover">` : `<i data-lucide="${isTemp ? 'alert-circle' : 'package'}" class="w-4 h-4 ${isTemp ? 'text-amber-500' : 'text-slate-400'}"></i>`}
                    </div>
                </td>
                <td class="p-3">
                    ${isTemp ? `
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-black bg-amber-100 text-amber-800 border border-amber-300">
                            <span class="text-amber-600 text-xs">⚠️</span>
                            ${item.code} <span class="text-[9px] bg-amber-500 text-white px-1 rounded">임시</span>
                        </span>
                    ` : `
                        <span class="font-mono font-bold text-blue-600">${item.code}</span>
                    `}
                </td>
                <!-- 1. 대분류 독립 컬럼 -->
                <td class="p-3 text-center">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-black border ${catBadgeClass}">
                        ${cat}
                    </span>
                </td>
                <!-- 2. 중분류(종류) 독립 컬럼 -->
                <td class="p-3 text-center">
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border ${subBadgeClass}">
                        <span>${subIcon}</span> <span>${sub}</span>
                    </span>
                </td>
                <td class="p-3 font-bold text-slate-900">
                    ${embedded ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-indigo-100 text-indigo-700 font-mono font-bold mr-1 border border-indigo-200" title="품목명에서 감지된 정식 품목코드">🏷️ ${embedded.code}</span>` : ''}
                    ${item.name}
                </td>
                <td class="p-3 text-slate-500">${item.spec || '-'}</td>
                <td class="p-3 text-slate-600 font-bold">${item.supplier || '-'}</td>
                <td class="p-3 text-center font-bold text-slate-700">${item.unit}</td>
                <td class="p-3 text-right font-black text-rose-600">${Number(item.safety).toLocaleString()} ${item.unit}</td>
                <td class="p-3 text-center">
                    <div class="flex items-center justify-center gap-1">
                        ${isTemp && embedded ? `
                            <button type="button" class="btn-quick-resolve-embedded px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 shadow-xs transition" data-code="${item.code}" data-targetcode="${embedded.code}" data-targetname="${embedded.name}" data-targetspec="${embedded.spec || item.spec || '-'}" title="품목명 내 [${embedded.code}]로 즉시 전환 및 재고 병합">
                                <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
                                <span>[${embedded.code}] 전환</span>
                            </button>
                        ` : (isTemp ? `
                            <button type="button" class="btn-resolve-temp-code px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 shadow-xs transition" data-code="${item.code}" title="정식 품목코드 지정 및 재고 병합">
                                <i data-lucide="tag" class="w-3.5 h-3.5"></i>
                                <span>코드 지정</span>
                            </button>
                        ` : '')}
                        <button type="button" class="btn-edit-master p-1 text-blue-600 hover:text-blue-800" data-code="${item.code}" title="품목 정보 수정"><i data-lucide="edit-3" class="w-3.5 h-3.5"></i></button>
                        <button type="button" class="btn-del-master p-1 text-rose-600 hover:text-rose-800" data-code="${item.code}" title="품목 삭제"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        renderPaginationControls(totalCount, startIndex, endIndex, totalPages);

        // 사진 확대 보기
        tbody.querySelectorAll('.btn-thumb-preview').forEach(b => {
            b.addEventListener('click', () => {
                const code = b.getAttribute('data-code');
                const item = state.master.find(m => m.code === code);
                if (item && window.__openImagePreview) {
                    window.__openImagePreview(item.code, item.name, item.spec, item.imageUrl);
                }
            });
        });

        // 일반 수정 모달 열기
        tbody.querySelectorAll('.btn-edit-master').forEach(b => {
            b.addEventListener('click', () => {
                const code = b.getAttribute('data-code');
                const item = state.master.find(m => m.code === code);
                if (item) openModal(item);
            });
        });

        // 0000 임시코드 지정/병합 모달 열기
        tbody.querySelectorAll('.btn-resolve-temp-code').forEach(b => {
            b.addEventListener('click', () => {
                const code = b.getAttribute('data-code');
                const item = state.master.find(m => m.code === code);
                if (item) openResolveModal(item);
            });
        });

        // 품목명 내 임시코드 원클릭 즉시 전환 버튼
        tbody.querySelectorAll('.btn-quick-resolve-embedded').forEach(b => {
            b.addEventListener('click', async () => {
                const oldCode = b.getAttribute('data-code');
                const newCode = b.getAttribute('data-targetcode');
                const newName = b.getAttribute('data-targetname');
                const newSpec = b.getAttribute('data-targetspec');
                if (confirm(`임시코드 [${oldCode}]를 품목명에 포함된 정식 품목코드 [${newCode}] (${newName})(으)로 즉시 전환하고 재고를 합산하시겠습니까?`)) {
                    try {
                        const res = await updateMasterItemCode(oldCode, newCode, { name: newName, spec: newSpec });
                        showToast(`✅ ${res.message}`);
                        if (onRefresh) await onRefresh();
                        renderTable();
                    } catch (err) {
                        alert('전환 실패: ' + err.message);
                    }
                }
            });
        });

        // 삭제
        tbody.querySelectorAll('.btn-del-master').forEach(b => {
            b.addEventListener('click', async () => {
                const code = b.getAttribute('data-code');
                if (confirm(`[${code}] 품목을 마스터에서 삭제하시겠습니까? 연결된 재고 데이터도 함께 제거됩니다.`)) {
                    await deleteMasterItem(code);
                    showToast('🗑️ 품목이 삭제되었습니다.');
                    renderTable();
                    if (onRefresh) onRefresh();
                }
            });
        });

        createIcons({ icons });
    };

    // 1. 대분류 퀵 선택 칩 클릭 이벤트
    container.querySelectorAll('.btn-cat-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedCategoryFilter = btn.getAttribute('data-cat') || '';
            selectedSubCategory = 'ALL';
            const catSelectEl = container.querySelector('#master-filter-category');
            if (catSelectEl) catSelectEl.value = selectedCategoryFilter;
            updateFilterSubDropdown();

            container.querySelectorAll('.btn-cat-chip').forEach(b => {
                const isSelected = (b.getAttribute('data-cat') || '') === selectedCategoryFilter;
                b.className = `btn-cat-chip px-3 py-1 rounded-lg font-black transition whitespace-nowrap ${isSelected ? 'bg-blue-600 text-white shadow-2xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'}`;
            });

            container.querySelectorAll('.btn-subcat-chip').forEach(b => {
                const isAll = b.getAttribute('data-sub') === 'ALL';
                b.className = `btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap ${isAll ? 'bg-blue-600 text-white shadow-2xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'}`;
            });

            currentPage = 1;
            renderTable();
        });
    });

    // 2. 종류별(중분류) 퀵 선택 칩 클릭 이벤트
    container.querySelectorAll('.btn-subcat-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedSubCategory = btn.getAttribute('data-sub');
            container.querySelectorAll('.btn-subcat-chip').forEach(b => {
                if (b.getAttribute('data-sub') === selectedSubCategory) {
                    b.className = 'btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-blue-600 text-white shadow-2xs';
                } else {
                    b.className = 'btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-slate-100';
                }
            });
            currentPage = 1;
            renderTable();
        });
    });

    // 3. 임시코드 숨기기/펼치기 토글 이벤트
    container.querySelector('#btn-toggle-temp-hide')?.addEventListener('click', () => {
        hideTempCodes = !hideTempCodes;
        filterTempOnly = false; // 모아보기 해제
        currentPage = 1;
        renderTable();
        showToast(hideTempCodes 
            ? '🙈 임시코드(0000)를 숨겼습니다. (정식 마스터 품목만 표시)' 
            : '👁️ 임시코드(0000)를 펼쳤습니다. (전체 품목 표시)');
    });

    // 페이지당 건수 셀렉트 변경
    container.querySelector('#master-page-size')?.addEventListener('change', (e) => {
        pageSize = e.target.value;
        currentPage = 1;
        renderTable();
    });

    // 명시적 검색 버튼 클릭
    container.querySelector('#btn-master-search')?.addEventListener('click', () => {
        currentPage = 1;
        renderTable();
    });

    // 검색창 엔터(Enter) 키 이벤트
    container.querySelector('#master-search-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            currentPage = 1;
            renderTable();
        }
    });

    // 검색 및 필터 초기화 버튼
    container.querySelector('#btn-master-search-reset')?.addEventListener('click', () => {
        container.querySelector('#master-search-input').value = '';
        container.querySelector('#master-filter-category').value = '';
        updateFilterSubDropdown();
        container.querySelector('#master-filter-subcategory').value = '';
        container.querySelector('#master-filter-partner').value = '';
        filterTempOnly = false;
        hideTempCodes = true;
        selectedCategoryFilter = '';
        selectedSubCategory = 'ALL';

        container.querySelectorAll('.btn-cat-chip').forEach(b => {
            const isAll = (b.getAttribute('data-cat') || '') === '';
            b.className = `btn-cat-chip px-3 py-1 rounded-lg font-black transition whitespace-nowrap ${isAll ? 'bg-blue-600 text-white shadow-2xs' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'}`;
        });

        container.querySelectorAll('.btn-subcat-chip').forEach(b => {
            if (b.getAttribute('data-sub') === 'ALL') {
                b.className = 'btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-blue-600 text-white shadow-2xs';
            } else {
                b.className = 'btn-subcat-chip px-2.5 py-1 rounded-lg font-bold transition whitespace-nowrap bg-white text-slate-700 border border-slate-200 hover:bg-slate-100';
            }
        });
        currentPage = 1;
        renderTable();
        showToast('🔄 필터 및 검색 조건이 초기화되었습니다.');
    });

    // 이미지 파일 압축 (리사이즈 & 압축 유틸)
    const compressImage = (file, maxWidth = 600, maxHeight = 600) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let { width, height } = img;
                    if (width > height) {
                        if (width > maxWidth) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width = Math.round((width * maxHeight) / height);
                            height = maxHeight;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    const base64 = canvas.toDataURL('image/jpeg', 0.82);
                    resolve(base64);
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const modal = container.querySelector('#master-modal');
    const previewBox = container.querySelector('#m-preview-box');
    const delImgBtn = container.querySelector('#btn-del-img');
    const imgInput = container.querySelector('#m-image-input');

    const updatePreviewBox = (url) => {
        modalImageUrl = url;
        if (url) {
            previewBox.innerHTML = `<img src="${url}" class="w-full h-full object-cover">`;
            delImgBtn.classList.remove('hidden');
        } else {
            previewBox.innerHTML = `<i data-lucide="camera" class="w-6 h-6 text-slate-400"></i>`;
            delImgBtn.classList.add('hidden');
            createIcons({ icons });
        }
    };

    previewBox?.addEventListener('click', () => imgInput?.click());
    container.querySelector('#btn-upload-img')?.addEventListener('click', () => imgInput?.click());
    delImgBtn?.addEventListener('click', () => {
        imgInput.value = '';
        updatePreviewBox(null);
    });

    imgInput?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const base64 = await compressImage(file);
                updatePreviewBox(base64);
                showToast('📷 사진이 최적화 압축되었습니다.');
            } catch (err) {
                alert('이미지 처리 중 오류가 발생했습니다.');
            }
        }
    });

    // 6대 대분류에 따른 14대 중분류 옵션 동적 반환
    const getSubCategoryOptionsForCategory = (cat) => {
        if (cat === '완제품') {
            return [
                { val: 'ODM 제품', label: '🏢 ODM 제품' },
                { val: '자사제품', label: '⭐ 자사제품' }
            ];
        } else if (cat === '원액') {
            return [
                { val: '엔진오일', label: '🛢️ 엔진오일' },
                { val: '엔진코팅제', label: '✨ 엔진코팅제' },
                { val: '브레이크액', label: '🛑 브레이크액' },
                { val: '첨가제', label: '🧪 첨가제' }
            ];
        } else if (cat === '원료') {
            return [
                { val: 'BO', label: '💧 BO (기유)' },
                { val: 'AC', label: '🔬 AC (원료/촉매)' },
                { val: 'AD', label: '⚙️ AD (첨가제)' },
                { val: 'EP', label: '🛡️ EP (극압제)' }
            ];
        } else if (cat === '부자재') {
            return [
                { val: '용기', label: '🫙 용기' },
                { val: '아웃박스', label: '📦 아웃박스' },
                { val: '인박스', label: '📥 인박스' },
                { val: '라벨', label: '🏷️ 라벨' },
                { val: '기타', label: '📎 기타' }
            ];
        } else {
            return [
                { val: '-', label: '- (보류)' }
            ];
        }
    };

    const updateSubCategoryDropdown = (catSelectEl, subSelectEl, currentSubVal = '') => {
        if (!catSelectEl || !subSelectEl) return;
        const cat = catSelectEl.value;
        const options = getSubCategoryOptionsForCategory(cat);
        subSelectEl.innerHTML = options.map(opt => `<option value="${opt.val}">${opt.label}</option>`).join('');
        if (currentSubVal && options.some(opt => opt.val === currentSubVal)) {
            subSelectEl.value = currentSubVal;
        } else {
            subSelectEl.value = options[0]?.val || '';
        }
    };

    // 상단 검색 필터의 중분류 옵션 동적 갱신
    const filterCatEl = container.querySelector('#master-filter-category');
    const filterSubEl = container.querySelector('#master-filter-subcategory');

    const updateFilterSubDropdown = () => {
        if (!filterCatEl || !filterSubEl) return;
        const cat = filterCatEl.value;
        if (!cat) {
            let html = '<option value="">전체 중분류</option>';
            for (const [c, subs] of Object.entries(SUB_CATEGORY_MAP)) {
                for (const s of subs) {
                    if (s !== '-') html += `<option value="${s}">[${c}] ${s}</option>`;
                }
            }
            filterSubEl.innerHTML = html;
        } else {
            const subs = SUB_CATEGORY_MAP[cat] || [];
            let html = `<option value="">${cat} 전체 중분류</option>`;
            for (const s of subs) {
                if (s !== '-') html += `<option value="${s}">${s}</option>`;
            }
            filterSubEl.innerHTML = html;
        }
    };
    updateFilterSubDropdown();

    filterCatEl?.addEventListener('change', () => {
        updateFilterSubDropdown();
        currentPage = 1;
        renderTable();
    });

    filterSubEl?.addEventListener('change', () => {
        currentPage = 1;
        renderTable();
    });

    container.querySelector('#m-category')?.addEventListener('change', () => {
        updateSubCategoryDropdown(container.querySelector('#m-category'), container.querySelector('#m-subcategory'));
    });

    const openModal = (item = null) => {
        const isTemp = item && item.code.startsWith('0000');
        container.querySelector('#master-modal-title').textContent = item ? `품목 수정 - [${item.code}]` : '신규 품목 마스터 등록';
        container.querySelector('#m-original-code').value = item ? item.code : '';
        container.querySelector('#m-code').value = item ? item.code : '';
        container.querySelector('#m-code').readOnly = (!!item && !isTemp);
        container.querySelector('#m-code-hint').textContent = isTemp 
            ? '⚠️ 임시코드 품목입니다. 올바른 정식 품목코드로 수정 시 연관 재고와 수불부가 일괄 치환됩니다.' 
            : (item ? '기존 품목의 코드는 변경할 수 없습니다.' : '품목코드를 입력하세요.');
        const res = item ? determineCategoryAndSubCategory(item) : { category: state.categories[0], subCategory: 'ODM 제품' };
        const cat = res.category;
        const sub = res.subCategory;
        container.querySelector('#m-category').value = cat;
        updateSubCategoryDropdown(container.querySelector('#m-category'), container.querySelector('#m-subcategory'), sub);
        container.querySelector('#m-name').value = item ? item.name : '';
        container.querySelector('#m-spec').value = item ? item.spec || '' : '';
        container.querySelector('#m-supplier').value = item ? item.supplier || '' : '';
        container.querySelector('#m-unit').value = item ? item.unit || 'EA' : 'EA';
        container.querySelector('#m-safety').value = item ? item.safety : 50;
        updatePreviewBox(item ? item.imageUrl : null);
        modal.classList.remove('hidden');
    };

    const closeModal = () => modal.classList.add('hidden');

    container.querySelector('#btn-open-add-master')?.addEventListener('click', () => openModal());
    container.querySelector('#btn-close-master-modal')?.addEventListener('click', closeModal);
    container.querySelector('#btn-cancel-master')?.addEventListener('click', closeModal);

    container.querySelector('#master-item-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const origCode = container.querySelector('#m-original-code').value.trim();
        const code = container.querySelector('#m-code').value.trim();
        const category = container.querySelector('#m-category').value;
        const subCategory = container.querySelector('#m-subcategory').value;
        const name = container.querySelector('#m-name').value.trim();
        const spec = container.querySelector('#m-spec').value.trim();
        const supplier = container.querySelector('#m-supplier').value.trim();
        const unit = container.querySelector('#m-unit').value.trim() || 'EA';
        const safety = Number(container.querySelector('#m-safety').value) || 0;

        // 만약 임시코드 0000 품목의 코드가 다른 코드로 변경된 경우
        if (origCode && origCode.startsWith('0000') && code !== origCode) {
            try {
                const res = await updateMasterItemCode(origCode, code, { name, category, subCategory, spec, supplier, unit, safety });
                showToast(`✅ ${res.message}`);
                closeModal();
                renderTable();
                return;
            } catch (err) {
                alert('코드 변경 처리 중 오류: ' + err.message);
                return;
            }
        }

        await saveMasterItem({ code, category, subCategory, name, spec, supplier, unit, safety, imageUrl: modalImageUrl });
        showToast(`✅ [${code}] ${name} (${subCategory}) 마스터 품목 저장 완료!`);
        closeModal();
        renderTable();
    });

    // ==========================================
    // 0000 임시코드 정식 전환 및 재고 병합 모달 로직
    // ==========================================
    const resolveModal = container.querySelector('#modal-resolve-temp-code');
    const mergeSection = container.querySelector('#section-merge-form');
    const newSection = container.querySelector('#section-new-form');
    const btnModeMerge = container.querySelector('#btn-mode-merge');
    const btnModeNew = container.querySelector('#btn-mode-new');
    const resolveSearchInput = container.querySelector('#res-merge-search');
    let resolveMode = 'MERGE'; // 'MERGE' or 'NEW'

    const setResolveMode = (mode) => {
        resolveMode = mode;
        if (mode === 'MERGE') {
            btnModeMerge.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition bg-amber-500 text-white shadow-2xs';
            btnModeNew.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition bg-white text-slate-700 border border-slate-200 hover:bg-slate-100';
            mergeSection.classList.remove('hidden');
            newSection.classList.add('hidden');
        } else {
            btnModeNew.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition bg-blue-600 text-white shadow-2xs';
            btnModeMerge.className = 'flex-1 py-2 text-xs font-bold rounded-lg transition bg-white text-slate-700 border border-slate-200 hover:bg-slate-100';
            newSection.classList.remove('hidden');
            mergeSection.classList.add('hidden');
        }
    };

    btnModeMerge?.addEventListener('click', () => setResolveMode('MERGE'));
    btnModeNew?.addEventListener('click', () => setResolveMode('NEW'));

    const openResolveModal = (item) => {
        currentResolvingItem = item;
        container.querySelector('#res-target-code').textContent = item.code;
        container.querySelector('#res-target-name').textContent = item.name;

        // 현재 총 재고 합산 계산
        const totalStock = state.inventory
            .filter(i => i.code === item.code)
            .reduce((sum, cur) => sum + (Number(cur.quantity) || 0), 0);
        container.querySelector('#res-target-stock').textContent = `${totalStock.toLocaleString()} ${item.unit || 'EA'}`;
        container.querySelector('#res-temp-info').textContent = `[${item.code}] ${item.name} (${item.spec || '규격없음'}, ${item.supplier || '거래처없음'})`;

        // 폼 초기화
        resolveSearchInput.value = '';
        container.querySelector('#res-merge-preview').classList.add('hidden');
        container.querySelector('#res-new-code').value = '';
        container.querySelector('#res-new-name').value = item.name.replace(/^\[임시\]\s*/, '');
        const targetRes = determineCategoryAndSubCategory(item);
        const targetCat = targetRes.category;
        const targetSub = targetRes.subCategory;
        container.querySelector('#res-new-category').value = targetCat;
        updateSubCategoryDropdown(container.querySelector('#res-new-category'), container.querySelector('#res-new-subcategory'), targetSub);
        container.querySelector('#res-new-spec').value = item.spec || '';
        container.querySelector('#res-new-supplier').value = item.supplier || '';
        container.querySelector('#res-new-unit').value = item.unit || 'EA';
        container.querySelector('#res-new-safety').value = item.safety || 50;

        setResolveMode('MERGE');
        resolveModal.classList.remove('hidden');
    };

    container.querySelector('#res-new-category')?.addEventListener('change', () => {
        updateSubCategoryDropdown(container.querySelector('#res-new-category'), container.querySelector('#res-new-subcategory'));
    });

    const closeResolveModal = () => {
        resolveModal.classList.add('hidden');
        currentResolvingItem = null;
    };

    container.querySelector('#btn-close-resolve-modal')?.addEventListener('click', closeResolveModal);
    container.querySelector('#btn-cancel-resolve')?.addEventListener('click', closeResolveModal);

    // 병합 검색 인풋 이벤트
    resolveSearchInput?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const preview = container.querySelector('#res-merge-preview');
        const previewName = container.querySelector('#res-merge-name');
        const found = state.master.find(m => m.code === val || `${m.code} / ${m.name}`.includes(val));
        if (found && !found.code.startsWith('0000')) {
            previewName.textContent = `[${found.code}] ${found.name} (${found.spec || '-'})`;
            preview.classList.remove('hidden');
        } else {
            preview.classList.add('hidden');
        }
    });

    // 코드 확정 및 일괄 반영 버튼
    container.querySelector('#btn-commit-resolve')?.addEventListener('click', async () => {
        if (!currentResolvingItem) return;
        const oldCode = currentResolvingItem.code;

        if (resolveMode === 'MERGE') {
            const rawInput = resolveSearchInput.value.trim();
            const targetMaster = state.master.find(m => m.code === rawInput || `${m.code} / ${m.name}`.includes(rawInput));

            if (!targetMaster || targetMaster.code.startsWith('0000')) {
                alert('병합할 정식 품목을 목록에서 정확히 선택하세요.');
                return;
            }

            const confirmed = confirm(
                `[품목 재고 및 수불부 통합 병합]\n\n` +
                `임시 품목: [${oldCode}] ${currentResolvingItem.name}\n` +
                `병합 대상: [${targetMaster.code}] ${targetMaster.name}\n\n` +
                `정말 임시코드 품목의 모든 재고와 수불 이력을 위 정식 품목으로 합산 통합하시겠습니까?`
            );
            if (!confirmed) return;

            try {
                const res = await updateMasterItemCode(oldCode, targetMaster.code);
                showToast(`✅ ${res.message}`);
                closeResolveModal();
                renderTable();
            } catch (err) {
                alert('병합 처리 중 오류 발생: ' + err.message);
            }
        } else {
            // NEW MODE
            const newCode = container.querySelector('#res-new-code').value.trim();
            const newName = container.querySelector('#res-new-name').value.trim();
            const newCategory = container.querySelector('#res-new-category').value;
            const newSubCategory = container.querySelector('#res-new-subcategory').value;
            const newSpec = container.querySelector('#res-new-spec').value.trim();
            const newSupplier = container.querySelector('#res-new-supplier').value.trim();
            const newUnit = container.querySelector('#res-new-unit').value.trim() || 'EA';
            const newSafety = Number(container.querySelector('#res-new-safety').value) || 0;

            if (!newCode || !newName) {
                alert('신규 품목코드와 품목명을 모두 입력하세요.');
                return;
            }

            const confirmed = confirm(
                `[신규 정식 품목코드 지정 및 일괄 치환]\n\n` +
                `임시 품목코드: ${oldCode} -> 신규 정식코드: ${newCode}\n` +
                `품목명: ${newName}\n` +
                `대분류: ${newCategory} / 중분류: ${newSubCategory}\n\n` +
                `마스터, 창고 재고, 수불 이력의 품목코드가 모두 신규 코드로 일괄 갱신됩니다. 진행하시겠습니까?`
            );
            if (!confirmed) return;

            try {
                const res = await updateMasterItemCode(oldCode, newCode, {
                    name: newName,
                    category: newCategory,
                    subCategory: newSubCategory,
                    spec: newSpec,
                    supplier: newSupplier,
                    unit: newUnit,
                    safety: newSafety
                });
                showToast(`✅ ${res.message}`);
                closeResolveModal();
                renderTable();
            } catch (err) {
                alert('코드 변경 처리 중 오류 발생: ' + err.message);
            }
        }
    });

    // 0000 임시코드 토글 버튼 클릭
    const btnFilterTemp = container.querySelector('#btn-filter-temp-codes');
    btnFilterTemp?.addEventListener('click', () => {
        filterTempOnly = !filterTempOnly;
        if (filterTempOnly) {
            btnFilterTemp.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-amber-500 text-white border-amber-600 shadow-xs';
        } else {
            btnFilterTemp.className = 'px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-white text-slate-700 border-slate-300 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300';
        }
        currentPage = 1;
        renderTable();
    });

    // 임시코드 일괄 자동 정리 버튼 클릭
    container.querySelector('#btn-auto-resolve-embedded')?.addEventListener('click', async () => {
        const norm = (s) => (s || '').toLowerCase().replace(/[\s\-_/\\|()\[\]{}'"`.,:;+~*]/g, '');
        const autoResolvable = state.master.filter(m => {
            if (!m.code.startsWith('0000')) return false;
            if (parseEmbeddedCode(m.name)) return true;
            const normName = norm(m.name);
            return normName.length >= 3 && state.master.some(other => !other.code.startsWith('0000') && norm(other.name) === normName);
        });

        if (autoResolvable.length === 0) {
            showToast('ℹ️ 자동 정리 가능한 임시코드 품목이 없습니다.');
            return;
        }

        if (confirm(`품목명에 정식 품목코드가 있거나 기존 마스터와 일치하는 임시코드 품목 총 ${autoResolvable.length}건을 정식 코드로 일괄 변환 및 재고 병합하시겠습니까?`)) {
            try {
                const res = await autoResolveTempMasterItems();
                showToast(`✅ ${res.message}`);
                if (onRefresh) await onRefresh();
                renderTable();
            } catch (err) {
                alert('일괄 정리 중 오류 발생: ' + err.message);
            }
        }
    });

    container.querySelector('#master-filter-partner')?.addEventListener('change', () => {
        currentPage = 1;
        renderTable();
    });

    let masterSearchTimer = null;
    container.querySelector('#master-search-input')?.addEventListener('input', () => {
        clearTimeout(masterSearchTimer);
        masterSearchTimer = setTimeout(() => {
            currentPage = 1;
            renderTable();
        }, 300);
    });

    // 엑셀 다운로드 (대분류, 중분류 2개 별도 컬럼 포함)
    container.querySelector('#btn-export-master-excel')?.addEventListener('click', () => {
        const ws = XLSX.utils.json_to_sheet(state.master.map(m => {
            const res = determineCategoryAndSubCategory(m);
            return {
                "품목코드": m.code,
                "대분류": res.category,
                "중분류": res.subCategory,
                "품목명": m.name,
                "규격사양": m.spec || '-',
                "주요거래처": m.supplier || '-',
                "단위": m.unit || 'EA',
                "안전재고": m.safety || 0,
                "임시코드여부": m.code.startsWith('0000') ? '임시' : '정식'
            };
        }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "품목마스터");
        XLSX.writeFile(wb, `WMS_품목마스터_${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('📥 대분류/중분류가 분리된 품목 마스터 엑셀 파일이 다운로드되었습니다.');
    });

    // ==========================================
    // 엑셀 & 구글 시트 공통 데이터 파싱 유틸
    // ==========================================
    const parseMasterDataRows = (rows) => {
        const findValue = (row, candidates) => {
            for (const [key, val] of Object.entries(row)) {
                const cleanKey = String(key).replace(/\s+/g, '').toLowerCase();
                if (candidates.some(c => cleanKey === c || cleanKey.includes(c))) {
                    return val;
                }
            }
            return '';
        };

        return rows.map(r => {
            const codeRaw = findValue(r, ['품목코드', '코드', '품번', 'itemcode', 'code']);
            const nameRaw = findValue(r, ['품목명', '품명', '품목', 'itemname', 'name']);
            const categoryRaw = findValue(r, ['대분류', '자재분류', '카테고리', 'category']);
            const subCategoryRaw = findValue(r, ['중분류', '상세종류', '종류', 'subcategory']);
            const specRaw = findValue(r, ['규격사양', '규격', '사양', 'spec']);
            const supplierRaw = findValue(r, ['주요거래처', '거래처', '공급처', '매입처', 'supplier', 'partner']);
            const unitRaw = findValue(r, ['수량단위', '단위', 'unit']);
            const safetyRaw = findValue(r, ['안전재고', '안전수량', 'safety']);

            return {
                code: String(codeRaw || '').trim(),
                name: String(nameRaw || '').trim(),
                category: String(categoryRaw || '').trim(),
                subCategory: String(subCategoryRaw || '').trim(),
                spec: String(specRaw || '').trim(),
                supplier: String(supplierRaw || '').trim(),
                unit: String(unitRaw || 'EA').trim() || 'EA',
                safety: Number(safetyRaw) || 0
            };
        }).filter(item => item.code || item.name);
    };

    // 구글 시트 복사 텍스트(TSV/CSV) 파서
    const parseTsvText = (text) => {
        const lines = text.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length === 0) return [];

        const delimiter = lines[0].includes('\t') ? '\t' : (lines[0].includes(',') ? ',' : '\t');
        const headerCells = lines[0].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
        
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const cells = lines[i].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
            const rowObj = {};
            headerCells.forEach((header, idx) => {
                rowObj[header] = cells[idx] !== undefined ? cells[idx] : '';
            });
            rows.push(rowObj);
        }
        return parseMasterDataRows(rows);
    };

    // ==========================================
    // 1. 엑셀 파일 일괄 업로드 / 업데이트 처리
    // ==========================================
    container.querySelector('#input-upload-master-excel')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

                if (rawRows.length === 0) {
                    alert('엑셀 파일에 데이터가 없습니다.');
                    return;
                }

                const parsedItems = parseMasterDataRows(rawRows);
                if (parsedItems.length === 0) {
                    alert('엑셀 파일에서 품목코드 또는 품목명 컬럼을 찾을 수 없습니다.\n양식을 확인해주세요 (예: 품목코드, 품목명, 대분류, 중분류, 규격, 거래처 등)');
                    return;
                }

                const confirmMsg = `📂 [엑셀 품목 마스터 분석 완료]\n` +
                    `- 파일명: ${file.name}\n` +
                    `- 분석된 유효 품목 수: 총 ${parsedItems.length.toLocaleString()}건\n\n` +
                    `WMS 전산 품목 마스터 및 Supabase 클라우드에 일괄 등록/수정하시겠습니까?\n` +
                    `(기존 코드는 최신 사양으로 수정되며, 신규 코드는 자동 등록됩니다)`;

                if (confirm(confirmMsg)) {
                    const res = await bulkUpsertMasterItems(parsedItems);
                    showToast(`🎉 엑셀 품목 마스터 일괄 반영 완료! (${res.message})`);
                    if (onRefresh) await onRefresh();
                    renderTable();
                }
            } catch (err) {
                console.error('[Master Excel Upload Error]:', err);
                alert('엑셀 파일 처리 중 오류가 발생했습니다: ' + err.message);
            } finally {
                e.target.value = '';
            }
        };
        reader.readAsArrayBuffer(file);
    });

    // ==========================================
    // 2. 구글 시트 연동 및 일괄 업데이트 모달 처리
    // ==========================================
    const googleModal = container.querySelector('#modal-google-sheet-master');
    const gsTabPaste = container.querySelector('#tab-btn-gs-paste');
    const gsTabUrl = container.querySelector('#tab-btn-gs-url');
    const gsPanePaste = container.querySelector('#gs-pane-paste');
    const gsPaneUrl = container.querySelector('#gs-pane-url');
    const gsTextarea = container.querySelector('#gs-paste-textarea');
    const gsPreviewBox = container.querySelector('#gs-paste-preview-box');
    const gsCountEl = container.querySelector('#gs-paste-count');
    const gsSampleEl = container.querySelector('#gs-paste-sample');
    const gsSheetUrlInput = container.querySelector('#gs-sheet-url');

    let currentGsActiveTab = 'PASTE'; // 'PASTE' | 'URL'
    let fetchedUrlItems = null;

    const switchGsTab = (tab) => {
        currentGsActiveTab = tab;
        if (tab === 'PASTE') {
            gsTabPaste.className = 'px-4 py-2 rounded-xl font-bold bg-teal-600 text-white transition shadow-2xs';
            gsTabUrl.className = 'px-4 py-2 rounded-xl font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition';
            gsPanePaste.classList.remove('hidden');
            gsPaneUrl.classList.add('hidden');
        } else {
            gsTabUrl.className = 'px-4 py-2 rounded-xl font-bold bg-teal-600 text-white transition shadow-2xs';
            gsTabPaste.className = 'px-4 py-2 rounded-xl font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition';
            gsPaneUrl.classList.remove('hidden');
            gsPanePaste.classList.add('hidden');
        }
    };

    gsTabPaste?.addEventListener('click', () => switchGsTab('PASTE'));
    gsTabUrl?.addEventListener('click', () => switchGsTab('URL'));

    const openGoogleModal = () => {
        if (!googleModal) return;
        gsTextarea.value = '';
        gsSheetUrlInput.value = '';
        gsPreviewBox.classList.add('hidden');
        fetchedUrlItems = null;
        switchGsTab('PASTE');
        googleModal.classList.remove('hidden');
    };

    const closeGoogleModal = () => {
        if (googleModal) googleModal.classList.add('hidden');
    };

    container.querySelector('#btn-open-google-master-modal')?.addEventListener('click', openGoogleModal);
    container.querySelector('#btn-close-google-modal')?.addEventListener('click', closeGoogleModal);
    container.querySelector('#btn-cancel-google-modal')?.addEventListener('click', closeGoogleModal);

    // 복사 붙여넣기 텍스트 입력 시 실시간 미리보기
    gsTextarea?.addEventListener('input', () => {
        const txt = gsTextarea.value.trim();
        if (!txt) {
            gsPreviewBox.classList.add('hidden');
            return;
        }
        const parsed = parseTsvText(txt);
        if (parsed.length > 0) {
            gsCountEl.textContent = parsed.length.toLocaleString();
            const sample = parsed.slice(0, 3).map(p => `[${p.code}] ${p.name}`).join(' / ');
            gsSampleEl.textContent = `샘플 미리보기: ${sample}${parsed.length > 3 ? ' 외...' : ''}`;
            gsPreviewBox.classList.remove('hidden');
        } else {
            gsPreviewBox.classList.add('hidden');
        }
    });

    // 구글 시트 URL 데이터 불러오기 버튼
    container.querySelector('#btn-fetch-gs-url')?.addEventListener('click', async () => {
        const rawUrl = gsSheetUrlInput.value.trim();
        if (!rawUrl) {
            alert('구글 스프레드시트 URL을 입력해주세요.');
            return;
        }

        // 구글 시트 ID 추출
        const idMatch = rawUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (!idMatch) {
            alert('유효한 구글 스프레드시트 URL 형식이 아닙니다.\n(예: https://docs.google.com/spreadsheets/d/시트ID/edit)');
            return;
        }

        const sheetId = idMatch[1];
        // CSV 내보내기 URL 생성
        let gidMatch = rawUrl.match(/gid=([0-9]+)/);
        let csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
        if (gidMatch) {
            csvUrl += `&gid=${gidMatch[1]}`;
        }

        try {
            showToast('🌐 구글 시트에서 최신 데이터를 내려받는 중입니다...');
            const resp = await fetch(csvUrl);
            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status} - 구글 시트 공유 권한을 '링크가 있는 모든 사용자 - 뷰어'로 설정했는지 확인하세요.`);
            }
            const csvText = await resp.text();
            const parsed = parseTsvText(csvText);

            if (parsed.length === 0) {
                alert('구글 시트에서 품목 데이터를 찾을 수 없습니다. 컬럼 제목을 확인하세요.');
                return;
            }

            fetchedUrlItems = parsed;
            alert(`🎉 [구글 시트 연동 성공!]\n총 ${parsed.length.toLocaleString()}건의 품목 데이터를 가져왔습니다.\n\n하단의 [일괄 업데이트 실행]을 누르시면 WMS에 즉시 반영됩니다.`);
            showToast(`✅ 구글 시트 품목 총 ${parsed.length}건 로드 완료!`);
        } catch (err) {
            console.error('[Google Sheet Fetch Error]:', err);
            alert(`구글 시트 데이터 로드 실패: ${err.message}\n\n💡 팁: 브라우저 보안(CORS) 제한 시 구글 시트에서 [파일 > 다운로드 > 쉼표로 구분된 값(.csv)]으로 받아 [엑셀 일괄 업로드]를 이용하시거나, 표 전체를 복사하여 [구글시트 복사 & 붙여넣기] 탭을 이용하시면 100% 정상 작동합니다.`);
        }
    });

    // 구글 시트 일괄 업데이트 실행 버튼
    container.querySelector('#btn-commit-google-update')?.addEventListener('click', async () => {
        let targetItems = [];

        if (currentGsActiveTab === 'PASTE') {
            const txt = gsTextarea.value.trim();
            if (!txt) {
                alert('구글 시트에서 복사한 내용을 붙여넣어 주세요.');
                return;
            }
            targetItems = parseTsvText(txt);
        } else {
            if (!fetchedUrlItems || fetchedUrlItems.length === 0) {
                alert('[구글 시트 데이터 불러오기]를 먼저 실행해주세요.');
                return;
            }
            targetItems = fetchedUrlItems;
        }

        if (targetItems.length === 0) {
            alert('반영할 품목 데이터가 없습니다.');
            return;
        }

        if (confirm(`총 ${targetItems.length.toLocaleString()}건의 품목을 WMS 품목 마스터 및 클라우드에 일괄 등록/수정하시겠습니까?`)) {
            const res = await bulkUpsertMasterItems(targetItems);
            showToast(`🎉 구글 시트 품목 마스터 일괄 업데이트 완료! (${res.message})`);
            closeGoogleModal();
            if (onRefresh) await onRefresh();
            renderTable();
        }
    });

    renderTable();
};
