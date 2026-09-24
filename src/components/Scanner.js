import { state, processStockAction, processProductionInbound } from '../services/db.js';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { searchMasterItems } from '../services/searchUtils.js';
import { createIcons, icons } from 'lucide';

let html5Scanner = null;

export const renderScanner = (container, { showToast, onSwitchTab, initialCode, initialLot }) => {
    let continuousMode = false;
    let batchQueue = [];
    let lastScannedCode = null;
    let lastScanTime = 0;

    container.innerHTML = `
    <section id="tab-content-scan" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="scan-line" class="w-5 h-5 text-blue-600"></i>
                        <span>현장 모바일 QR / 바코드 고속 스캔</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">스마트폰 카메라로 QR·바코드를 연속 스캔하여 입·출고·생산투입 및 이동 작업을 실시간 처리합니다.</p>
                </div>
                <div class="flex items-center flex-wrap gap-2">
                    <label class="flex items-center gap-2 cursor-pointer bg-amber-50 hover:bg-amber-100 border border-amber-300 px-3 py-1.5 rounded-xl text-xs font-black text-amber-900 transition shadow-xs">
                        <input type="checkbox" id="chk-continuous-mode" class="rounded text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer" />
                        <span>연속 고속 스캔 모드</span>
                        <span class="px-1.5 py-0.5 rounded text-[10px] bg-amber-200 text-amber-900 font-extrabold">대기열 모드</span>
                    </label>

                    <button type="button" id="btn-toggle-camera" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="camera" class="w-4 h-4"></i>
                        <span id="camera-btn-text">카메라 스캐너 켜기</span>
                    </button>
                </div>
            </div>

            <!-- 스캐너 영역 & 직접 입력 영역 -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
                <!-- 좌측: 카메라 뷰 및 수동 입력 -->
                <div class="lg:col-span-5 space-y-4">
                    <div id="qr-reader-container" class="hidden bg-slate-900 rounded-2xl overflow-hidden shadow-inner p-2 border border-slate-800">
                        <div id="qr-reader" style="width: 100%;"></div>
                    </div>

                    <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                        <label class="block text-xs font-bold text-slate-700">품목코드 또는 품목명 검색 (일부문자 인식)</label>
                        <div class="relative">
                            <div class="flex gap-2">
                                <input type="text" id="scan-manual-code" placeholder="코드 또는 품목명 일부 입력 (예: 5W-30, 모빌, ITEM-1001)..." class="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" autocomplete="off" />
                                <button type="button" id="btn-search-scanned" class="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5 shadow-sm">
                                    <i data-lucide="search" class="w-3.5 h-3.5"></i>
                                    <span>조회</span>
                                </button>
                            </div>
                            <!-- 실시간 부분문자 인식 자동완성 드롭다운 -->
                            <div id="scan-search-suggestions" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-30 max-h-64 overflow-y-auto divide-y divide-slate-100"></div>
                        </div>
                        <div class="flex flex-wrap gap-1.5 items-center">
                            <span class="text-[11px] text-slate-400 font-bold">빠른 선택:</span>
                            ${state.master.slice(0, 4).map(m => `
                                <button type="button" class="btn-sample-code px-2 py-1 bg-white border border-slate-200 hover:border-blue-500 rounded-lg text-[11px] font-bold text-slate-700 transition" data-code="${m.code}">
                                    ${m.code}
                                </button>
                            `).join('')}
                        </div>
                    </div>

                    <div id="continuous-indicator" class="hidden p-3 bg-amber-500/10 border border-amber-400/30 rounded-xl text-amber-800 text-xs font-medium space-y-1">
                        <div class="flex items-center gap-1.5 font-bold text-amber-900">
                            <i data-lucide="zap" class="w-4 h-4 text-amber-600 animate-pulse"></i>
                            <span>연속 스캔 모드 활성화됨</span>
                        </div>
                        <p class="text-[11px] text-amber-700">바코드나 QR코드를 카메라에 대면 자동으로 대기열에 누적 수량으로 추가되며 비프음과 진동 피드백이 발생합니다.</p>
                    </div>
                </div>

                <!-- 우측: 단일 스캔 처리 폼 또는 연속 스캔 대기열 -->
                <div class="lg:col-span-7">
                    <!-- 1. 연속 스캔 대기열 (Batch Queue Container) -->
                    <div id="batch-queue-card" class="hidden bg-white border-2 border-amber-400/50 rounded-2xl p-5 shadow-sm space-y-4">
                        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                            <div class="flex items-center gap-2">
                                <span class="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>
                                <h3 class="font-black text-sm text-slate-900">연속 스캔 작업 대기열 (<span id="queue-count-badge" class="text-amber-600">0</span>건)</h3>
                            </div>
                            <div class="flex gap-2">
                                <button type="button" id="btn-clear-queue" class="px-2.5 py-1 text-slate-500 hover:text-rose-600 text-xs font-bold transition">대기열 비우기</button>
                            </div>
                        </div>

                        <!-- 공통 기본 작업 설정 -->
                        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
                            <div>
                                <label class="block font-bold text-slate-600 text-[11px] mb-1">기본 작업</label>
                                <select id="batch-default-action" class="w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold">
                                    <option value="IN">입고 (+)</option>
                                    <option value="OUT">출고 (-)</option>
                                    <option value="USE">생산투입 (-)</option>
                                    <option value="MOVE">거점 이동 (->)</option>
                                </select>
                            </div>
                            <div>
                                <label class="block font-bold text-slate-600 text-[11px] mb-1">작업 창고 (기본)</label>
                                <select id="batch-default-loc" class="w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold">
                                    ${state.locations.map(l => `<option value="${l}">${l}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-span-2 sm:col-span-1">
                                <label class="block font-bold text-slate-600 text-[11px] mb-1">작업 비고</label>
                                <input type="text" id="batch-reason" placeholder="연속 스캔 입출고" value="현장 연속 바코드 스캔" class="w-full bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs" />
                            </div>
                        </div>

                        <!-- 대기열 테이블 -->
                        <div class="max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
                            <table class="w-full text-left text-xs">
                                <thead class="bg-slate-100 text-slate-600 sticky top-0">
                                    <tr>
                                        <th class="p-2.5">품목코드 / 품명</th>
                                        <th class="p-2.5 text-center">수량</th>
                                        <th class="p-2.5">작업</th>
                                        <th class="p-2.5">창고</th>
                                        <th class="p-2.5 text-center">삭제</th>
                                    </tr>
                                </thead>
                                <tbody id="batch-queue-tbody" class="divide-y divide-slate-100">
                                    <tr><td colspan="5" class="p-6 text-center text-slate-400 text-xs">스캔된 품목이 없습니다. 카메라로 연속 스캔하세요.</td></tr>
                                </tbody>
                            </table>
                        </div>

                        <div class="pt-2 flex justify-end">
                            <button type="button" id="btn-submit-batch" class="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white font-black rounded-xl text-sm transition shadow-md flex items-center justify-center gap-2">
                                <i data-lucide="check-check" class="w-4 h-4"></i>
                                <span>대기열 일괄 확정 처리 (클라우드 즉시 동기화)</span>
                            </button>
                        </div>
                    </div>

                    <!-- 2. 단일 스캔 품목 정보 & 현장 작업 처리 폼 -->
                    <div id="scan-result-card" class="hidden bg-white border-2 border-blue-500/30 rounded-2xl p-5 shadow-sm space-y-5">
                        <div class="flex items-start justify-between">
                            <div>
                                <span id="scanned-category-badge" class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">부자재</span>
                                <h3 id="scanned-item-name" class="text-lg font-black text-slate-900 mt-1">품목명</h3>
                                <p id="scanned-item-spec" class="text-xs text-slate-500 font-mono">ITEM-1001 | 규격 정보</p>
                            </div>
                            <div class="text-right">
                                <span class="text-slate-400 text-[11px] font-bold block">전체 재고 합계</span>
                                <span id="scanned-total-stock" class="text-2xl font-black text-blue-600">0</span>
                                <span id="scanned-unit" class="text-xs text-slate-500">개(EA)</span>
                            </div>
                        </div>

                        <!-- 거점별 현재고 상태 -->
                        <div class="bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <span class="text-[11px] font-bold text-slate-500 block mb-1.5">거점별 보관 현황:</span>
                            <div id="scanned-locations-list" class="grid grid-cols-2 gap-2 text-xs"></div>
                        </div>

                        <!-- 작업 선택 및 실행 폼 -->
                        <form id="scanner-action-form" class="space-y-4 pt-2 border-t border-slate-100">
                            <div class="grid grid-cols-4 gap-2">
                                <label class="cursor-pointer">
                                    <input type="radio" name="scan-action" value="IN" class="peer sr-only" checked />
                                    <div class="text-center p-2 rounded-xl border border-slate-200 peer-checked:border-blue-600 peer-checked:bg-blue-50 peer-checked:text-blue-700 font-bold text-xs transition">입고 (+)</div>
                                </label>
                                <label class="cursor-pointer">
                                    <input type="radio" name="scan-action" value="OUT" class="peer sr-only" />
                                    <div class="text-center p-2 rounded-xl border border-slate-200 peer-checked:border-rose-600 peer-checked:bg-rose-50 peer-checked:text-rose-700 font-bold text-xs transition">출고 (-)</div>
                                </label>
                                <label class="cursor-pointer">
                                    <input type="radio" name="scan-action" value="USE" class="peer sr-only" />
                                    <div class="text-center p-2 rounded-xl border border-slate-200 peer-checked:border-orange-600 peer-checked:bg-orange-50 peer-checked:text-orange-700 font-bold text-xs transition">생산투입 (-)</div>
                                </label>
                                <label class="cursor-pointer">
                                    <input type="radio" name="scan-action" value="MOVE" class="peer sr-only" />
                                    <div class="text-center p-2 rounded-xl border border-slate-200 peer-checked:border-purple-600 peer-checked:bg-purple-50 peer-checked:text-purple-700 font-bold text-xs transition">거점이동 (->)</div>
                                </label>
                            </div>

                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div id="div-source-loc">
                                    <label class="block text-xs font-bold text-slate-600 mb-1">대상/출발 창고</label>
                                    <select id="scan-target-loc" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500">
                                        ${state.locations.map(l => `<option value="${l}">${l}</option>`).join('')}
                                    </select>
                                </div>
                                <div id="div-dest-loc" class="hidden">
                                    <label class="block text-xs font-bold text-slate-600 mb-1">도착 창고 (이동 시)</label>
                                    <select id="scan-dest-loc" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-purple-500">
                                        ${state.locations.map(l => `<option value="${l}">${l}</option>`).join('')}
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-600 mb-1">수량</label>
                                    <input type="number" id="scan-action-qty" min="1" value="10" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-black focus:ring-2 focus:ring-blue-500" required />
                                </div>
                            </div>

                            <div>
                                <label class="block text-xs font-bold text-slate-600 mb-1">사유 / 작업 비고</label>
                                <input type="text" id="scan-action-reason" placeholder="현장 QR 스캔 작업" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-500" />
                            </div>

                            <button type="submit" class="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black rounded-xl text-sm transition shadow-md flex items-center justify-center gap-2">
                                <i data-lucide="check-circle" class="w-4 h-4"></i>
                                <span>현장 작업 확정 (클라우드 즉시 동기화)</span>
                            </button>
                        </form>
                    </div>

                    <!-- 3. 초기 안내 문구 -->
                    <div id="scan-placeholder" class="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-12 text-center text-slate-400 text-xs">
                        <i data-lucide="qr-code" class="w-12 h-12 mx-auto text-slate-300 mb-3"></i>
                        QR코드를 스캔하거나 좌측에서 품목코드를 입력하면 상세 정보와 작업창이 활성화됩니다.
                    </div>

                    <!-- 4. 원액/제품 작업지시서 QR 자동 수불 카드 -->
                    <div id="scan-workorder-card" class="hidden bg-white border-2 border-indigo-500/50 rounded-2xl p-5 shadow-lg space-y-4">
                        <div class="flex items-start justify-between border-b border-indigo-100 pb-3">
                            <div>
                                <div class="flex items-center gap-2">
                                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-800 flex items-center gap-1 border border-indigo-200">
                                        <span class="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-ping"></span>
                                        작업지시서 연동 QR 인식됨
                                    </span>
                                    <span id="wo-card-order-no" class="font-mono font-black text-xs text-indigo-700">WO-20260922-001</span>
                                </div>
                                <h3 id="wo-card-title" class="text-base font-black text-slate-900 mt-1">원액 생산 및 원부자재 자동 수불 처리</h3>
                                <p class="text-xs text-slate-500">배합 레시피에 따라 생산품은 입고(+)되고 투입 원부자재는 자동 차감(USE -) 처리됩니다.</p>
                            </div>
                            <button type="button" id="btn-close-wo-card" class="text-slate-400 hover:text-slate-600 p-1" title="닫기">
                                <i data-lucide="x" class="w-5 h-5"></i>
                            </button>
                        </div>

                        <!-- 생산품 정보 요약 -->
                        <div class="bg-indigo-50/70 p-3.5 rounded-2xl border border-indigo-200/80 space-y-2">
                            <div class="flex items-center justify-between">
                                <span class="text-[11px] font-bold text-indigo-900 flex items-center gap-1">
                                    <i data-lucide="package-plus" class="w-4 h-4 text-indigo-600"></i>
                                    생산 입고 예정 품목
                                </span>
                                <span id="wo-card-prod-type" class="px-2 py-0.5 text-[10px] font-extrabold rounded-md bg-white text-indigo-700 border border-indigo-200">원액</span>
                            </div>
                            <div class="flex flex-wrap items-baseline justify-between gap-2">
                                <div>
                                    <div id="wo-card-item-name" class="text-sm font-black text-slate-900">대림 울트라 5W-30 합성엔진오일 원액</div>
                                    <div id="wo-card-item-code" class="text-[11px] font-mono text-slate-500">ITEM-1002</div>
                                </div>
                                <div class="text-right">
                                    <span class="text-[10px] text-slate-500 block font-bold">생산 입고량</span>
                                    <span id="wo-card-qty" class="text-2xl font-black text-indigo-700 font-mono">1,000</span>
                                    <span id="wo-card-unit" class="text-xs font-bold text-slate-600">L</span>
                                </div>
                            </div>
                            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-indigo-200/50 text-[11px]">
                                <div><span class="text-slate-500 font-medium">생산 LOT:</span> <span id="wo-card-lot" class="font-mono font-black text-slate-800">LOT-20260922-B01</span></div>
                                <div><span class="text-slate-500 font-medium">입고 창고:</span> <span id="wo-card-loc" class="font-bold text-slate-800">김포공장</span></div>
                                <div><span class="text-slate-500 font-medium">포장 용기:</span> <span id="wo-card-pkg" class="font-bold text-slate-800">1,000L IBC</span></div>
                            </div>
                        </div>

                        <!-- 자동 차감될 원부자재 목록 -->
                        <div class="space-y-2">
                            <div class="flex items-center justify-between text-xs font-bold text-slate-700">
                                <span class="flex items-center gap-1.5">
                                    <i data-lucide="droplets" class="w-4 h-4 text-blue-600"></i>
                                    <span>자동 차감될 원료 및 부자재 (<span id="wo-card-mat-count" class="text-blue-600">3</span>종)</span>
                                </span>
                                <span class="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">USE 소모 자동 기록</span>
                            </div>
                            <div id="wo-card-mats-list" class="space-y-1.5 max-h-48 overflow-y-auto pr-1 border border-slate-200 rounded-xl p-2 bg-slate-50">
                                <!-- 동적 자재 행 -->
                            </div>
                        </div>

                        <!-- 실행 버튼 컨테이너 -->
                        <div id="wo-card-action-container" class="pt-2">
                            <button type="button" id="btn-confirm-wo-auto-inbound" class="w-full py-3.5 bg-gradient-to-r from-indigo-600 via-blue-600 to-teal-600 hover:from-indigo-700 hover:to-teal-700 text-white font-black rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2">
                                <i data-lucide="zap" class="w-4 h-4"></i>
                                <span id="wo-btn-confirm-text">원액생산 확정 및 원부자재 자동 수불 일괄 실행</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
    `;

    // 사운드 & 진동 피드백
    const playBeep = () => {
        try {
            if (navigator.vibrate) {
                navigator.vibrate([80, 40, 80]);
            }
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.25, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);
        } catch { }
    };

    let currentScannedCode = null;

    // 대기열 UI 갱신 함수
    const renderBatchQueue = () => {
        const tbody = container.querySelector('#batch-queue-tbody');
        const countBadge = container.querySelector('#queue-count-badge');
        if (!tbody || !countBadge) return;

        countBadge.textContent = batchQueue.length;

        if (batchQueue.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400 text-xs">스캔된 품목이 없습니다. 카메라로 연속 스캔하세요.</td></tr>`;
            return;
        }

        tbody.innerHTML = batchQueue.map((item, idx) => `
            <tr class="hover:bg-slate-50">
                <td class="p-2.5">
                    <div class="font-mono font-bold text-blue-600">${item.code}</div>
                    <div class="text-[11px] text-slate-800 font-bold truncate max-w-[140px]">${item.name}</div>
                </td>
                <td class="p-2.5 text-center">
                    <div class="inline-flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
                        <button type="button" class="btn-q-minus px-2 py-0.5 text-slate-600 hover:bg-slate-100 font-bold" data-idx="${idx}">-</button>
                        <input type="number" class="input-q-qty w-12 text-center text-xs font-bold border-x border-slate-200 focus:outline-none" value="${item.qty}" data-idx="${idx}" min="1" />
                        <button type="button" class="btn-q-plus px-2 py-0.5 text-slate-600 hover:bg-slate-100 font-bold" data-idx="${idx}">+</button>
                    </div>
                </td>
                <td class="p-2.5">
                    <select class="select-q-action bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[11px] font-bold" data-idx="${idx}">
                        <option value="IN" ${item.action === 'IN' ? 'selected' : ''}>입고 (+)</option>
                        <option value="OUT" ${item.action === 'OUT' ? 'selected' : ''}>출고 (-)</option>
                        <option value="USE" ${item.action === 'USE' ? 'selected' : ''}>생산투입 (-)</option>
                        <option value="MOVE" ${item.action === 'MOVE' ? 'selected' : ''}>거점이동 (->)</option>
                    </select>
                </td>
                <td class="p-2.5">
                    <select class="select-q-loc bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[11px]" data-idx="${idx}">
                        ${state.locations.map(l => `<option value="${l}" ${item.location === l ? 'selected' : ''}>${l}</option>`).join('')}
                    </select>
                </td>
                <td class="p-2.5 text-center">
                    <button type="button" class="btn-q-del text-rose-600 hover:text-rose-800 font-bold p-1" data-idx="${idx}">&times;</button>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.btn-q-minus').forEach(b => {
            b.addEventListener('click', () => {
                const idx = Number(b.getAttribute('data-idx'));
                if (batchQueue[idx].qty > 1) {
                    batchQueue[idx].qty -= 1;
                    renderBatchQueue();
                }
            });
        });

        tbody.querySelectorAll('.btn-q-plus').forEach(b => {
            b.addEventListener('click', () => {
                const idx = Number(b.getAttribute('data-idx'));
                batchQueue[idx].qty += 1;
                renderBatchQueue();
            });
        });

        tbody.querySelectorAll('.input-q-qty').forEach(inp => {
            inp.addEventListener('change', (e) => {
                const idx = Number(inp.getAttribute('data-idx'));
                batchQueue[idx].qty = Math.max(1, Number(e.target.value) || 1);
                renderBatchQueue();
            });
        });

        tbody.querySelectorAll('.select-q-action').forEach(sel => {
            sel.addEventListener('change', (e) => {
                const idx = Number(sel.getAttribute('data-idx'));
                batchQueue[idx].action = e.target.value;
            });
        });

        tbody.querySelectorAll('.select-q-loc').forEach(sel => {
            sel.addEventListener('change', (e) => {
                const idx = Number(sel.getAttribute('data-idx'));
                batchQueue[idx].location = e.target.value;
            });
        });

        tbody.querySelectorAll('.btn-q-del').forEach(b => {
            b.addEventListener('click', () => {
                const idx = Number(b.getAttribute('data-idx'));
                batchQueue.splice(idx, 1);
                renderBatchQueue();
            });
        });
    };

    const workOrderCard = container.querySelector('#scan-workorder-card');

    // 작업지시서 QR코드 연동 자동 수불 카드 렌더링
    const showWorkOrderExecutionCard = (wo) => {
        if (!wo) return;
        playBeep();

        currentScannedCode = wo.orderNo;
        scanPlaceholder.classList.add('hidden');
        batchQueueCard.classList.add('hidden');
        singleResultCard.classList.add('hidden');
        workOrderCard.classList.remove('hidden');

        container.querySelector('#wo-card-order-no').textContent = wo.orderNo;
        container.querySelector('#wo-card-title').textContent = `${wo.prodType || '원액'} 생산 & 원부자재 자동 수불 처리`;
        container.querySelector('#wo-card-prod-type').textContent = wo.prodType || '원액';
        container.querySelector('#wo-card-item-name').textContent = wo.itemName || wo.itemCode;
        container.querySelector('#wo-card-item-code').textContent = `${wo.itemCode} (지시번호: ${wo.orderNo})`;
        container.querySelector('#wo-card-qty').textContent = Number(wo.qty).toLocaleString();
        container.querySelector('#wo-card-unit').textContent = wo.unit || 'L';
        container.querySelector('#wo-card-lot').textContent = wo.lotNo || '-';
        container.querySelector('#wo-card-loc').textContent = wo.location || '김포공장';
        container.querySelector('#wo-card-pkg').textContent = wo.packaging || '-';

        const materials = wo.materials || [];
        container.querySelector('#wo-card-mat-count').textContent = materials.length;

        const matsListEl = container.querySelector('#wo-card-mats-list');
        if (materials.length === 0) {
            matsListEl.innerHTML = '<div class="text-center py-3 text-slate-400 text-xs">투입 원부자재 정보가 없습니다. (단순 입고 처리)</div>';
        } else {
            matsListEl.innerHTML = materials.map(m => {
                const targetLoc = m.location || wo.location || '김포공장';
                const inv = state.inventory.find(i => i.code === m.code && i.location === targetLoc);
                const curStock = inv ? Number(inv.quantity) : 0;
                const isSufficient = curStock >= Number(m.qty);

                return `
                <div class="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200 text-xs gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                            <span class="px-1.5 py-0.2 rounded text-[10px] font-bold ${m.matType === '원료' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}">${m.matType || '자재'}</span>
                            <span class="font-bold text-slate-900 truncate">${m.name}</span>
                        </div>
                        <div class="text-[10px] text-slate-400 font-mono mt-0.5">${m.code} | 출고창고: ${targetLoc}</div>
                    </div>
                    <div class="text-right">
                        <div class="font-black text-blue-700 font-mono text-xs">소모: ${Number(m.qty).toLocaleString()} ${m.unit || 'L'}</div>
                        <div class="text-[10px] font-bold ${isSufficient ? 'text-emerald-600' : 'text-rose-600'}">
                            ${isSufficient ? `재고 충분 (${curStock.toLocaleString()})` : `재고 부족 (${curStock.toLocaleString()})`}
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        }

        // 실행 버튼 복원 및 이벤트 바인딩
        const actionContainer = container.querySelector('#wo-card-action-container');
        actionContainer.innerHTML = `
            <button type="button" id="btn-confirm-wo-auto-inbound" class="w-full py-3.5 bg-gradient-to-r from-indigo-600 via-blue-600 to-teal-600 hover:from-indigo-700 hover:to-teal-700 text-white font-black rounded-xl text-sm transition shadow-lg flex items-center justify-center gap-2">
                <i data-lucide="zap" class="w-4 h-4"></i>
                <span id="wo-btn-confirm-text">${wo.prodType || '원액'} 생산 확정 및 원부자재 자동 수불 일괄 실행</span>
            </button>
        `;

        const btnConfirm = actionContainer.querySelector('#btn-confirm-wo-auto-inbound');
        btnConfirm?.addEventListener('click', async () => {
            try {
                btnConfirm.disabled = true;
                btnConfirm.innerHTML = `<span class="animate-spin mr-1">⏳</span> 생산 입고 및 원부자재 자동 차감 처리 중...`;

                await processProductionInbound({
                    prodType: wo.prodType || '원액',
                    prodItemCode: wo.itemCode,
                    prodQty: wo.qty,
                    packaging: wo.packaging || '1,000L IBC',
                    unit: wo.unit || 'L',
                    lotNo: wo.lotNo,
                    location: wo.location || '김포공장',
                    worker: wo.worker || state.currentGlobalWorker,
                    bomDeducted: true,
                    bomDetails: materials,
                    workOrderNo: wo.orderNo,
                    notes: `작업지시서 [${wo.orderNo}] 현장 QR 스캔 자동 수불`
                });

                playBeep();
                showToast(`🎉 [${wo.orderNo}] 생산 입고 및 원부자재 ${materials.length}종 자동 차감이 완료되었습니다!`);

                actionContainer.innerHTML = `
                    <div class="p-5 text-center space-y-3 bg-emerald-50 rounded-2xl border border-emerald-300 shadow-sm">
                        <div class="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-xs">
                            <i data-lucide="check-check" class="w-6 h-6"></i>
                        </div>
                        <h4 class="font-black text-sm text-emerald-900">[${wo.orderNo}] 자동 수불 처리가 성공적으로 완료되었습니다!</h4>
                        <p class="text-xs text-emerald-700">생산품 [${wo.itemName}] ${Number(wo.qty).toLocaleString()}${wo.unit} 입고(+) 및 원부자재 ${materials.length}종이 자동 출고(-)되었습니다.</p>
                        <div class="pt-2 flex justify-center gap-2">
                            <button type="button" id="btn-wo-done-next" class="px-3.5 py-2 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5">
                                <i data-lucide="scan" class="w-4 h-4"></i>
                                <span>다음 QR 스캔하기</span>
                            </button>
                            <button type="button" id="btn-wo-jump-prod" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm">
                                <i data-lucide="factory" class="w-4 h-4"></i>
                                <span>생산 실적 확인</span>
                            </button>
                        </div>
                    </div>
                `;

                actionContainer.querySelector('#btn-wo-done-next')?.addEventListener('click', () => {
                    workOrderCard.classList.add('hidden');
                    scanPlaceholder.classList.remove('hidden');
                });

                actionContainer.querySelector('#btn-wo-jump-prod')?.addEventListener('click', () => {
                    onSwitchTab('production');
                });

                createIcons({ icons });
            } catch (err) {
                alert(`자동 수불 처리 오류:\n${err.message}`);
                btnConfirm.disabled = false;
                btnConfirm.innerHTML = `<i data-lucide="zap" class="w-4 h-4"></i><span>${wo.prodType || '원액'} 생산 확정 및 원부자재 자동 수불 일괄 실행</span>`;
                createIcons({ icons });
            }
        });

        createIcons({ icons });
    };

    // 작업지시서 스캔 감지 및 파싱 함수
    const handlePotentialWorkOrder = (text) => {
        if (!text) return false;
        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch {
            const cleanText = text.trim();
            const woMatch = (state.workOrders || []).find(w => w.orderNo === cleanText || w.id === cleanText);
            if (woMatch) {
                parsed = {
                    type: 'WORK_ORDER',
                    orderNo: woMatch.orderNo,
                    prodType: woMatch.prodType,
                    itemCode: woMatch.targetItemCode,
                    itemName: woMatch.targetItemName,
                    qty: woMatch.targetQty,
                    unit: woMatch.unit,
                    packaging: woMatch.packaging,
                    lotNo: woMatch.lotNo,
                    location: woMatch.location,
                    materials: [...(woMatch.rawMaterials || []), ...(woMatch.subMaterials || [])],
                    notes: woMatch.notes
                };
            }
        }

        if (parsed && (parsed.type === 'WORK_ORDER' || (parsed.orderNo && parsed.orderNo.startsWith('WO-')))) {
            showWorkOrderExecutionCard(parsed);
            return true;
        }
        return false;
    };

    container.querySelector('#btn-close-wo-card')?.addEventListener('click', () => {
        workOrderCard.classList.add('hidden');
        scanPlaceholder.classList.remove('hidden');
    });

    // 품목 스캔/검색 처리 함수 (코드 또는 품목명/부분문자/스마트폰 QR URL 지원)
    const selectItemCode = (query) => {
        if (!query) return;

        let targetCode = String(query).trim();
        let extractedLot = null;

        // 1. 스마트폰 QR URL 형태인 경우 파라미터 파싱
        if (targetCode.startsWith('http://') || targetCode.startsWith('https://')) {
            try {
                const urlObj = new URL(targetCode);
                const pCode = urlObj.searchParams.get('scan') || urlObj.searchParams.get('code');
                const pLot = urlObj.searchParams.get('lot');
                if (pCode) {
                    targetCode = pCode;
                    if (pLot) extractedLot = pLot;
                } else if (urlObj.hash && urlObj.hash.includes('?')) {
                    const hParams = new URLSearchParams(urlObj.hash.split('?')[1]);
                    const hCode = hParams.get('scan') || hParams.get('code');
                    if (hCode) {
                        targetCode = hCode;
                        if (hParams.get('lot')) extractedLot = hParams.get('lot');
                    }
                }
            } catch (err) {
                console.warn('[Scanner] URL 파싱 경고:', err);
            }
        }

        // 2. 파이프(|) 구분자로 LOT번호가 함께 전달된 경우 (예: "1A0101|20260924-01")
        if (targetCode.includes('|')) {
            const parts = targetCode.split('|');
            targetCode = parts[0].trim();
            if (parts[1]) extractedLot = parts[1].trim();
        }

        // 3. 파렛트 식별표 [PALLET TAG] 텍스트 형식인 경우
        if (targetCode.includes('[PALLET TAG]') || targetCode.includes('코드:')) {
            const codeMatch = targetCode.match(/코드:\s*([^\n\r]+)/);
            const lotMatch = targetCode.match(/LOT:\s*([^\n\r]+)/);
            if (codeMatch && codeMatch[1]) targetCode = codeMatch[1].trim();
            if (lotMatch && lotMatch[1]) extractedLot = lotMatch[1].trim();
        }

        // 작업지시서 QR 또는 지시번호인지 먼저 확인
        if (handlePotentialWorkOrder(targetCode)) {
            return;
        }

        let item = state.master.find(m => m.code.toLowerCase() === targetCode.toLowerCase());
        if (!item) {
            // 품목명 또는 부분문자로 탐색
            const matches = searchMasterItems(targetCode, 5);
            if (matches.length > 0) {
                item = matches[0];
            }
        }

        if (!item) {
            alert(`일치하는 품목을 찾을 수 없습니다: "${targetCode}"\n(품목코드 또는 품목명 일부를 입력해주세요)`);
            return;
        }

        const code = item.code;
        const codeInput = container.querySelector('#scan-manual-code');
        if (codeInput) codeInput.value = code;
        container.querySelector('#scan-search-suggestions')?.classList.add('hidden');

        playBeep();

        if (continuousMode) {
            // 연속 스캔 모드: 대기열에 누적
            const defaultAction = container.querySelector('#batch-default-action')?.value || 'IN';
            const defaultLoc = container.querySelector('#batch-default-loc')?.value || state.locations[0];
            const existing = batchQueue.find(q => q.code === code);
            if (existing) {
                existing.qty += 1;
                showToast(`⚡ [${code}] 수량 +1 (누적: ${existing.qty} ${item.unit || '개'})`);
            } else {
                batchQueue.push({
                    code: item.code,
                    name: item.name,
                    category: item.category,
                    unit: item.unit || '개',
                    qty: 1,
                    action: defaultAction,
                    location: defaultLoc
                });
                showToast(`⚡ [${code}] 대기열 추가 (총 ${batchQueue.length}개 품목)`);
            }
            renderBatchQueue();
            return;
        }

        // 단일 스캔 모드
        currentScannedCode = code;
        scanPlaceholder.classList.add('hidden');
        batchQueueCard.classList.add('hidden');
        workOrderCard.classList.add('hidden');
        const card = container.querySelector('#scan-result-card');
        card.classList.remove('hidden');

        container.querySelector('#scanned-category-badge').textContent = item.category;
        container.querySelector('#scanned-item-name').textContent = item.name;
        container.querySelector('#scanned-item-spec').textContent = `${item.code} | 규격: ${item.spec || '-'} | 거래처: ${item.supplier || '-'}`;
        container.querySelector('#scanned-unit').textContent = item.unit || '개(EA)';

        const itemStocks = state.inventory.filter(i => i.code === code);
        const total = itemStocks.reduce((a, c) => a + (Number(c.quantity) || 0), 0);
        container.querySelector('#scanned-total-stock').textContent = total.toLocaleString();

        const locsContainer = container.querySelector('#scanned-locations-list');
        locsContainer.innerHTML = state.locations.map(loc => {
            const st = itemStocks.find(s => s.location === loc);
            const qty = st ? st.quantity : 0;
            return `
                <div class="bg-white p-2 rounded-lg border border-slate-200 flex justify-between items-center">
                    <span class="font-bold text-slate-700">${loc}</span>
                    <span class="font-black ${qty > 0 ? 'text-blue-600' : 'text-slate-400'}">${qty.toLocaleString()} ${item.unit}</span>
                </div>
            `;
        }).join('');

        if (extractedLot) {
            const reasonInput = container.querySelector('#scan-action-reason');
            if (reasonInput) reasonInput.value = `LOT: ${extractedLot}`;
        }
    };

    // 모드 토글 이벤트
    const chkContinuous = container.querySelector('#chk-continuous-mode');
    const continuousIndicator = container.querySelector('#continuous-indicator');
    const batchQueueCard = container.querySelector('#batch-queue-card');
    const singleResultCard = container.querySelector('#scan-result-card');
    const scanPlaceholder = container.querySelector('#scan-placeholder');

    chkContinuous?.addEventListener('change', (e) => {
        continuousMode = e.target.checked;
        if (continuousMode) {
            continuousIndicator.classList.remove('hidden');
            batchQueueCard.classList.remove('hidden');
            singleResultCard.classList.add('hidden');
            workOrderCard.classList.add('hidden');
            scanPlaceholder.classList.add('hidden');
            renderBatchQueue();
            showToast('⚡ 연속 스캔 모드가 켜졌습니다. QR코드를 계속 비추세요.');
        } else {
            continuousIndicator.classList.add('hidden');
            batchQueueCard.classList.add('hidden');
            if (currentScannedCode) {
                singleResultCard.classList.remove('hidden');
            } else {
                scanPlaceholder.classList.remove('hidden');
            }
        }
    });

    // 대기열 전체 비우기
    container.querySelector('#btn-clear-queue')?.addEventListener('click', () => {
        if (batchQueue.length > 0 && confirm('대기열의 모든 품목을 비우시겠습니까?')) {
            batchQueue = [];
            renderBatchQueue();
            showToast('대기열이 비워졌습니다.');
        }
    });

    // 대기열 일괄 확정 실행
    container.querySelector('#btn-submit-batch')?.addEventListener('click', async () => {
        if (batchQueue.length === 0) {
            alert('처리할 대기열 품목이 없습니다.');
            return;
        }

        const reason = container.querySelector('#batch-reason')?.value || '연속 스캔 일괄 처리';
        let successCount = 0;
        let failCount = 0;

        for (const item of batchQueue) {
            try {
                await processStockAction({
                    type: item.action,
                    code: item.code,
                    qty: item.qty,
                    location: item.location,
                    fromLoc: item.location,
                    toLoc: item.action === 'MOVE' ? state.locations.find(l => l !== item.location) || item.location : item.location,
                    reason: `${reason} (${item.action})`
                });
                successCount++;
            } catch (err) {
                console.error(`대기열 품목 처리 실패 [${item.code}]:`, err);
                failCount++;
            }
        }

        showToast(`🎉 일괄 처리 완료! (성공: ${successCount}건, 실패: ${failCount}건)`);
        batchQueue = [];
        renderBatchQueue();
    });

    // 샘플 코드 클릭
    container.querySelectorAll('.btn-sample-code').forEach(btn => {
        btn.addEventListener('click', () => {
            const code = btn.getAttribute('data-code');
            container.querySelector('#scan-manual-code').value = code;
            selectItemCode(code);
        });
    });

    // 수동 검색 및 실시간 부분문자 자동완성
    const manualInput = container.querySelector('#scan-manual-code');
    const suggestionsEl = container.querySelector('#scan-search-suggestions');

    const renderSuggestions = (query) => {
        if (!suggestionsEl) return;
        if (!query || query.trim().length === 0) {
            suggestionsEl.classList.add('hidden');
            return;
        }

        const matches = searchMasterItems(query, 8);
        if (matches.length === 0) {
            suggestionsEl.innerHTML = '<div class="p-3 text-center text-xs text-slate-400 font-bold">일치하는 품목이 없습니다.</div>';
            suggestionsEl.classList.remove('hidden');
            return;
        }

        suggestionsEl.innerHTML = matches.map(m => {
            const itemStock = state.inventory.filter(i => i.code === m.code).reduce((a, c) => a + (Number(c.quantity) || 0), 0);
            return `
            <div class="scan-suggest-item p-2.5 hover:bg-blue-50 cursor-pointer transition flex items-center justify-between gap-2" data-code="${m.code}">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                        <span class="font-mono font-bold text-blue-600 text-xs">${m.code}</span>
                        <span class="px-1.5 py-0.2 rounded text-[10px] bg-slate-100 text-slate-700 font-bold">${m.category}</span>
                    </div>
                    <div class="text-xs font-bold text-slate-900 truncate">${m.name}</div>
                    <div class="text-[11px] text-slate-400 truncate">${m.spec || '-'} | 거래처: ${m.supplier || '-'}</div>
                </div>
                <div class="text-right flex-shrink-0">
                    <span class="text-xs font-black text-slate-800">${itemStock.toLocaleString()}</span>
                    <span class="text-[10px] text-slate-400 font-bold block">${m.unit || 'EA'}</span>
                </div>
            </div>
            `;
        }).join('');

        suggestionsEl.querySelectorAll('.scan-suggest-item').forEach(item => {
            item.addEventListener('click', () => {
                const code = item.getAttribute('data-code');
                manualInput.value = code;
                suggestionsEl.classList.add('hidden');
                selectItemCode(code);
            });
        });

        suggestionsEl.classList.remove('hidden');
    };

    manualInput?.addEventListener('input', (e) => {
        renderSuggestions(e.target.value);
    });

    manualInput?.addEventListener('focus', (e) => {
        if (e.target.value.trim().length > 0) {
            renderSuggestions(e.target.value);
        }
    });

    document.addEventListener('click', (e) => {
        if (!manualInput?.contains(e.target) && !suggestionsEl?.contains(e.target)) {
            suggestionsEl?.classList.add('hidden');
        }
    });

    const doSearch = () => {
        const val = manualInput.value.trim();
        if (val) {
            suggestionsEl?.classList.add('hidden');
            selectItemCode(val);
        }
    };

    container.querySelector('#btn-search-scanned')?.addEventListener('click', doSearch);
    manualInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            doSearch();
        }
    });

    // 라디오 작업 선택에 따른 이동 거점 표시
    const radioInputs = container.querySelectorAll('input[name="scan-action"]');
    radioInputs.forEach(r => {
        r.addEventListener('change', () => {
            const isMove = r.value === 'MOVE';
            container.querySelector('#div-dest-loc').classList.toggle('hidden', !isMove);
        });
    });

    // 단일 작업 확정 폼 제출
    container.querySelector('#scanner-action-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentScannedCode) return;

        const actionType = container.querySelector('input[name="scan-action"]:checked').value;
        const qty = container.querySelector('#scan-action-qty').value;
        const targetLoc = container.querySelector('#scan-target-loc').value;
        const destLoc = container.querySelector('#scan-dest-loc').value;
        const reason = container.querySelector('#scan-action-reason').value;

        try {
            await processStockAction({
                type: actionType,
                code: currentScannedCode,
                qty,
                location: targetLoc,
                fromLoc: targetLoc,
                toLoc: actionType === 'MOVE' ? destLoc : targetLoc,
                reason: reason || '현장 스캐너 작업'
            });
            const actionKorean = { IN: '입고', OUT: '출고', USE: '생산투입', MOVE: '거점이동' }[actionType] || actionType;
            showToast(`✅ [${actionKorean}] ${currentScannedCode} ${qty}개 처리 완료 (실시간 클라우드 반영)`);
            selectItemCode(currentScannedCode); // 수량 갱신
        } catch (err) {
            alert(err.message || '작업 실패');
        }
    });

    // 카메라 스캐너 라이브러리(Html5QrcodeScanner) 영문 UI 실시간 한국어 패치 함수
    const localizeQrReaderDom = () => {
        const reader = document.getElementById('qr-reader');
        if (!reader) return;

        const textMap = [
            ['Request Camera Permissions', '카메라 사용 권한 요청'],
            ['Scan an Image File', '이미지/사진 파일에서 QR 스캔'],
            ['Scan using camera directly', '카메라로 직접 실시간 스캔'],
            ['Stop Scanning', '카메라 스캔 중지'],
            ['Start Scanning', '카메라 스캔 시작'],
            ['Choose Image', '이미지 파일 선택'],
            ['No image chosen', '선택된 이미지 없음'],
            ['Select Camera', '카메라 선택'],
            ['Camera access is only supported in secure context like https or localhost', '카메라 접근은 HTTPS 보안 연결 또는 localhost에서만 지원됩니다.'],
            ['Scanning...', 'QR 코드 스캔 중...'],
            ['Drop image here to scan', '여기에 QR 이미지를 드래그하세요.'],
            ['Choose another image', '다른 이미지 선택'],
            ['QR code scanning', 'QR / 바코드 실시간 스캔'],
            ['Torch On', '플래시 켜기'],
            ['Torch Off', '플래시 끄기'],
            ['Zoom', '확대/축소']
        ];

        const walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
            for (const [en, ko] of textMap) {
                if (node.nodeValue && node.nodeValue.includes(en)) {
                    node.nodeValue = node.nodeValue.replace(en, ko);
                }
            }
        }

        reader.querySelectorAll('button, span, a, label, select option').forEach(el => {
            for (const [en, ko] of textMap) {
                if (el.textContent && el.textContent.includes(en)) {
                    el.textContent = el.textContent.replace(en, ko);
                }
            }
            if (el.tagName === 'BUTTON') {
                el.classList.add('px-3', 'py-1.5', 'bg-blue-600', 'text-white', 'text-xs', 'font-bold', 'rounded-lg', 'm-1');
            }
        });
    };

    // 카메라 토글
    const camBtn = container.querySelector('#btn-toggle-camera');
    const qrContainer = container.querySelector('#qr-reader-container');
    let qrObserver = null;

    camBtn?.addEventListener('click', () => {
        if (html5Scanner) {
            if (qrObserver) {
                qrObserver.disconnect();
                qrObserver = null;
            }
            html5Scanner.clear();
            html5Scanner = null;
            qrContainer.classList.add('hidden');
            container.querySelector('#camera-btn-text').textContent = '카메라 스캐너 켜기';
        } else {
            qrContainer.classList.remove('hidden');
            container.querySelector('#camera-btn-text').textContent = '카메라 스캐너 끄기';
            html5Scanner = new Html5QrcodeScanner('qr-reader', { fps: 12, qrbox: { width: 250, height: 250 } }, false);
            
            // 실시간 한국어 번역 옵저버 바인딩
            const readerEl = document.getElementById('qr-reader');
            if (readerEl) {
                qrObserver = new MutationObserver(() => localizeQrReaderDom());
                qrObserver.observe(readerEl, { childList: true, subtree: true, characterData: true });
                setTimeout(localizeQrReaderDom, 50);
                setTimeout(localizeQrReaderDom, 250);
                setTimeout(localizeQrReaderDom, 800);
            }

            html5Scanner.render((decodedText) => {
                let code = decodedText.trim();
                const now = Date.now();
                // 동일 코드 1.2초 내 중복 스캔 방지 (디바운스)
                if (code === lastScannedCode && (now - lastScanTime) < 1200) {
                    return;
                }
                lastScannedCode = code;
                lastScanTime = now;

                // 작업지시서 QR코드인지 우선 감지
                if (handlePotentialWorkOrder(code)) {
                    return;
                }

                try {
                    const parsed = JSON.parse(code);
                    if (parsed.code) code = parsed.code;
                } catch { }

                container.querySelector('#scan-manual-code').value = code;
                selectItemCode(code);
            }, (error) => { });
        }
    });

    // 작업지시서 서식 등에서 스캐너로 바로 이동한 경우 프리필 자동 실행
    if (window.__scannedWorkOrderPrefill) {
        const prefill = window.__scannedWorkOrderPrefill;
        window.__scannedWorkOrderPrefill = null;
        setTimeout(() => {
            handlePotentialWorkOrder(prefill);
        }, 150);
    }

    // 스마트폰 카메라 QR 스캔 딥링크를 통해 유입된 초기 품목코드 자동 처리
    if (initialCode) {
        setTimeout(() => {
            selectItemCode(initialCode);
            if (initialLot) {
                const reasonInput = container.querySelector('#scan-action-reason');
                if (reasonInput) reasonInput.value = `LOT: ${initialLot}`;
            }
            showToast(`📷 [스마트폰 QR 인식] '${initialCode}' 품목이 현장 스캔에 자동 입력되었습니다.`);
        }, 200);
    }
};
