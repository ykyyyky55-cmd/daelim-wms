import { state, saveMasterItem, deleteMasterItem, updateMasterItemCode } from '../services/db.js';
import * as XLSX from 'xlsx';
import { createIcons, icons } from 'lucide';
import { matchesQuery } from '../services/searchUtils.js';

export const renderMasterManager = (container, { showToast, onRefresh }) => {
    let modalImageUrl = null;
    let filterTempOnly = false; // 0000 임시코드 전용 필터 플래그
    let currentResolvingItem = null;

    container.innerHTML = `
    <section id="tab-content-master" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="layout-grid" class="w-5 h-5 text-blue-600"></i>
                        <span>품목 마스터 관리</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">자재·원료·완제품의 표준 사양, 거래처, 안전재고를 관리하고 '0000' 임시코드 품목을 정식 코드로 일괄 전환/병합합니다.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-export-master-excel" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="download" class="w-4 h-4"></i>
                        <span>엑셀 다운로드</span>
                    </button>
                    <button type="button" id="btn-open-add-master" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="plus" class="w-4 h-4"></i>
                        <span>신규 품목 등록</span>
                    </button>
                </div>
            </div>

            <!-- 필터 & 검색 바 -->
            <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div class="flex flex-wrap items-center gap-2">
                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-bold text-slate-600">분류:</span>
                        <select id="master-filter-category" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                            <option value="">전체 분류 (${state.master.length})</option>
                            ${state.categories.map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>
                    </div>

                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-bold text-slate-600">거래처:</span>
                        <select id="master-filter-partner" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-none">
                            <option value="">전체 거래처</option>
                            ${(state.partners || []).map(p => `<option value="${p}">${p}</option>`).join('')}
                        </select>
                    </div>

                    <!-- 0000 임시코드 품목 모아보기 필터 버튼 -->
                    <button type="button" id="btn-filter-temp-codes" class="px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 bg-white text-slate-700 border-slate-300 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300">
                        <i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-amber-500"></i>
                        <span>임시코드(0000) 모아보기</span>
                        <span id="badge-temp-count" class="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-amber-800 font-black">0</span>
                    </button>
                </div>

                <div class="relative">
                    <input type="text" id="master-search-input" placeholder="품목코드, 품명, 규격, 거래처 검색 (일부문자 인식)..." class="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none w-72" />
                    <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2"></i>
                </div>
            </div>

            <!-- 마스터 테이블 -->
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-100 text-slate-600 border-b border-slate-200 font-bold">
                        <tr>
                            <th class="p-3 text-center w-12">사진</th>
                            <th class="p-3">품목코드</th>
                            <th class="p-3">분류</th>
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
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">품목코드 *</label>
                            <input type="text" id="m-code" required placeholder="예: ITEM-1005" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold" />
                            <p id="m-code-hint" class="text-[10px] text-slate-400 mt-0.5">기존 코드는 변경할 수 없습니다.</p>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">자재 분류 *</label>
                            <select id="m-category" class="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold">
                                ${state.categories.map(c => `<option value="${c}">${c}</option>`).join('')}
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
                        <div class="grid grid-cols-2 gap-2">
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
        </div>
    </section>
    `;

    // 0000 임시코드 수 카운트 갱신
    const updateTempBadgeCount = () => {
        const tempCount = state.master.filter(m => m.code.startsWith('0000')).length;
        const badge = container.querySelector('#badge-temp-count');
        if (badge) {
            badge.textContent = tempCount;
            if (tempCount > 0) {
                badge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-black animate-pulse';
            } else {
                badge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-600 font-bold';
            }
        }
    };

    const renderTable = () => {
        const catFilter = container.querySelector('#master-filter-category').value;
        const partnerFilter = container.querySelector('#master-filter-partner').value;
        const search = container.querySelector('#master-search-input').value.trim();

        const filtered = state.master.filter(m => {
            const isTemp = m.code.startsWith('0000');
            if (filterTempOnly && !isTemp) return false;
            const matchesCat = !catFilter || m.category === catFilter;
            const matchesPartner = !partnerFilter || m.supplier === partnerFilter;
            const matchesSearch = !search || matchesQuery(m, search, ['code', 'name', 'spec', 'supplier', 'category']);
            return matchesCat && matchesPartner && matchesSearch;
        });

        updateTempBadgeCount();

        const tbody = container.querySelector('#master-table-body');
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-slate-400 text-xs">일치하는 품목이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(item => {
            const isTemp = item.code.startsWith('0000');
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
                            <i data-lucide="alert-triangle" class="w-3 h-3 text-amber-600"></i>
                            ${item.code} <span class="text-[9px] bg-amber-500 text-white px-1 rounded">임시</span>
                        </span>
                    ` : `
                        <span class="font-mono font-bold text-blue-600">${item.code}</span>
                    `}
                </td>
                <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isTemp ? 'bg-amber-200 text-amber-900' : 'bg-slate-100 text-slate-700'}">${item.category}</span></td>
                <td class="p-3 font-bold text-slate-900">${item.name}</td>
                <td class="p-3 text-slate-500">${item.spec || '-'}</td>
                <td class="p-3 text-slate-600 font-bold">${item.supplier || '-'}</td>
                <td class="p-3 text-center font-bold text-slate-700">${item.unit}</td>
                <td class="p-3 text-right font-black text-rose-600">${Number(item.safety).toLocaleString()} ${item.unit}</td>
                <td class="p-3 text-center">
                    <div class="flex items-center justify-center gap-1">
                        ${isTemp ? `
                            <button type="button" class="btn-resolve-temp-code px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 shadow-xs transition" data-code="${item.code}" title="정식 품목코드 지정 및 재고 병합">
                                <i data-lucide="tag" class="w-3.5 h-3.5"></i>
                                <span>코드 지정</span>
                            </button>
                        ` : ''}
                        <button type="button" class="btn-edit-master p-1 text-blue-600 hover:text-blue-800" data-code="${item.code}" title="품목 정보 수정"><i data-lucide="edit-3" class="w-3.5 h-3.5"></i></button>
                        <button type="button" class="btn-del-master p-1 text-rose-600 hover:text-rose-800" data-code="${item.code}" title="품목 삭제"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

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

        // 삭제
        tbody.querySelectorAll('.btn-del-master').forEach(b => {
            b.addEventListener('click', async () => {
                const code = b.getAttribute('data-code');
                if (confirm(`[${code}] 품목을 마스터에서 삭제하시겠습니까? 연결된 재고 데이터도 함께 제거됩니다.`)) {
                    await deleteMasterItem(code);
                    showToast(`🗑️ [${code}] 품목이 삭제되었습니다.`);
                    renderTable();
                }
            });
        });

        createIcons({ icons });
    };

    // 이미지 파일 압축
    const compressImage = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let { width, height } = img;
                    const maxDim = 400;
                    if (width > height) {
                        if (width > maxDim) {
                            height = Math.round((height * maxDim) / width);
                            width = maxDim;
                        }
                    } else {
                        if (height > maxDim) {
                            width = Math.round((width * maxDim) / height);
                            height = maxDim;
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

    const openModal = (item = null) => {
        const isTemp = item && item.code.startsWith('0000');
        container.querySelector('#master-modal-title').textContent = item ? `품목 수정 - [${item.code}]` : '신규 품목 마스터 등록';
        container.querySelector('#m-original-code').value = item ? item.code : '';
        container.querySelector('#m-code').value = item ? item.code : '';
        container.querySelector('#m-code').readOnly = (!!item && !isTemp);
        container.querySelector('#m-code-hint').textContent = isTemp 
            ? '⚠️ 임시코드 품목입니다. 올바른 정식 품목코드로 수정 시 연관 재고와 수불부가 일괄 치환됩니다.' 
            : (item ? '기존 품목의 코드는 변경할 수 없습니다.' : '품목코드를 입력하세요.');
        container.querySelector('#m-category').value = item ? item.category : state.categories[0];
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
        const name = container.querySelector('#m-name').value.trim();
        const spec = container.querySelector('#m-spec').value.trim();
        const supplier = container.querySelector('#m-supplier').value.trim();
        const unit = container.querySelector('#m-unit').value.trim() || 'EA';
        const safety = Number(container.querySelector('#m-safety').value) || 0;

        // 만약 임시코드 0000 품목의 코드가 다른 코드로 변경된 경우
        if (origCode && origCode.startsWith('0000') && code !== origCode) {
            try {
                const res = await updateMasterItemCode(origCode, code, { name, category, spec, supplier, unit, safety });
                showToast(`✅ ${res.message}`);
                closeModal();
                renderTable();
                return;
            } catch (err) {
                alert('코드 변경 처리 중 오류: ' + err.message);
                return;
            }
        }

        await saveMasterItem({ code, category, name, spec, supplier, unit, safety, imageUrl: modalImageUrl });
        showToast(`✅ [${code}] ${name} 마스터 품목 저장 완료!`);
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
    let resolveMode = 'MERGE'; // 'MERGE' or 'NEW'

    const setResolveMode = (mode) => {
        resolveMode = mode;
        if (mode === 'MERGE') {
            btnModeMerge.className = 'p-2.5 rounded-xl border-2 text-xs font-bold text-left transition border-blue-600 bg-blue-50/40 text-blue-900';
            btnModeNew.className = 'p-2.5 rounded-xl border-2 text-xs font-bold text-left transition border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
            mergeSection.classList.remove('hidden');
            newSection.classList.add('hidden');
        } else {
            btnModeNew.className = 'p-2.5 rounded-xl border-2 text-xs font-bold text-left transition border-emerald-600 bg-emerald-50/40 text-emerald-900';
            btnModeMerge.className = 'p-2.5 rounded-xl border-2 text-xs font-bold text-left transition border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
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

        // 폼 초기화
        container.querySelector('#res-merge-search').value = '';
        container.querySelector('#res-merge-preview').classList.add('hidden');
        container.querySelector('#res-new-code').value = '';
        container.querySelector('#res-new-name').value = item.name;
        container.querySelector('#res-new-category').value = item.category || state.categories[0];
        container.querySelector('#res-new-spec').value = item.spec || '';
        container.querySelector('#res-new-supplier').value = item.supplier !== '임시등록(미확정)' ? item.supplier : '';
        container.querySelector('#res-new-unit').value = item.unit || 'EA';
        container.querySelector('#res-new-safety').value = item.safety || 50;

        setResolveMode('MERGE');
        resolveModal.classList.remove('hidden');
    };

    const closeResolveModal = () => {
        resolveModal.classList.add('hidden');
        currentResolvingItem = null;
    };

    container.querySelector('#btn-close-resolve-modal')?.addEventListener('click', closeResolveModal);
    container.querySelector('#btn-cancel-resolve')?.addEventListener('click', closeResolveModal);

    // 병합 검색 인풋 이벤트
    container.querySelector('#res-merge-search')?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const matched = state.master.find(m => m.code === val || m.code.toLowerCase() === val.toLowerCase());
        const preview = container.querySelector('#res-merge-preview');
        const previewName = container.querySelector('#res-merge-name');
        if (matched) {
            preview.classList.remove('hidden');
            previewName.textContent = `[${matched.code}] ${matched.name} (${matched.spec || '-'})`;
        } else {
            preview.classList.add('hidden');
        }
    });

    // 코드 확정 및 일괄 반영 버튼
    container.querySelector('#btn-commit-resolve')?.addEventListener('click', async () => {
        if (!currentResolvingItem) return;
        const oldCode = currentResolvingItem.code;

        if (resolveMode === 'MERGE') {
            const targetCode = container.querySelector('#res-merge-search').value.trim();
            if (!targetCode) {
                alert('병합할 대상 마스터 품목을 선택하거나 코드를 입력하세요.');
                return;
            }
            const targetMaster = state.master.find(m => m.code === targetCode);
            if (!targetMaster) {
                alert(`[${targetCode}] 코드를 가진 마스터 품목을 찾을 수 없습니다.`);
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
                `품목명: ${newName}\n\n` +
                `마스터, 창고 재고, 수불 이력의 품목코드가 모두 신규 코드로 일괄 갱신됩니다. 진행하시겠습니까?`
            );
            if (!confirmed) return;

            try {
                const res = await updateMasterItemCode(oldCode, newCode, {
                    name: newName,
                    category: newCategory,
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
        renderTable();
    });

    container.querySelector('#master-filter-category')?.addEventListener('change', renderTable);
    container.querySelector('#master-filter-partner')?.addEventListener('change', renderTable);
    container.querySelector('#master-search-input')?.addEventListener('input', renderTable);

    // 엑셀 다운로드
    container.querySelector('#btn-export-master-excel')?.addEventListener('click', () => {
        const ws = XLSX.utils.json_to_sheet(state.master.map(m => ({
            "품목코드": m.code,
            "분류": m.category,
            "품목명": m.name,
            "규격": m.spec,
            "주요거래처": m.supplier,
            "단위": m.unit,
            "안전재고": m.safety,
            "임시코드여부": m.code.startsWith('0000') ? '임시' : '정식'
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "품목마스터");
        XLSX.writeFile(wb, `WMS_품목마스터_${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('📥 엑셀 파일이 다운로드되었습니다.');
    });

    renderTable();
};
