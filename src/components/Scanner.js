import { state, processStockAction } from '../services/db.js';
import { Html5QrcodeScanner } from 'html5-qrcode';

let html5Scanner = null;

export const renderScanner = (container, { showToast, onSwitchTab }) => {
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
                        <span class="px-1.5 py-0.5 rounded text-[10px] bg-amber-200 text-amber-900 font-extrabold">Batch Queue</span>
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
                        <label class="block text-xs font-bold text-slate-700">품목코드 스캔 또는 직접 입력 (Enter)</label>
                        <div class="flex gap-2">
                            <input type="text" id="scan-manual-code" placeholder="예: ITEM-1001" class="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            <button type="button" id="btn-search-scanned" class="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition">조회</button>
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
                                    <option value="USE">생산투입</option>
                                    <option value="MOVE">거점 이동</option>
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
                                <span id="scanned-unit" class="text-xs text-slate-500">EA</span>
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
                                    <div class="text-center p-2 rounded-xl border border-slate-200 peer-checked:border-orange-600 peer-checked:bg-orange-50 peer-checked:text-orange-700 font-bold text-xs transition">생산투입</div>
                                </label>
                                <label class="cursor-pointer">
                                    <input type="radio" name="scan-action" value="MOVE" class="peer sr-only" />
                                    <div class="text-center p-2 rounded-xl border border-slate-200 peer-checked:border-purple-600 peer-checked:bg-purple-50 peer-checked:text-purple-700 font-bold text-xs transition">이동</div>
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
                        <option value="IN" ${item.action === 'IN' ? 'selected' : ''}>입고</option>
                        <option value="OUT" ${item.action === 'OUT' ? 'selected' : ''}>출고</option>
                        <option value="USE" ${item.action === 'USE' ? 'selected' : ''}>투입</option>
                        <option value="MOVE" ${item.action === 'MOVE' ? 'selected' : ''}>이동</option>
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

    // 품목 스캔 처리 함수
    const selectItemCode = (code) => {
        const item = state.master.find(m => m.code === code);
        if (!item) {
            alert(`등록되지 않은 품목코드입니다: ${code}`);
            return;
        }

        playBeep();

        if (continuousMode) {
            // 연속 스캔 모드: 대기열에 누적
            const defaultAction = container.querySelector('#batch-default-action')?.value || 'IN';
            const defaultLoc = container.querySelector('#batch-default-loc')?.value || state.locations[0];
            const existing = batchQueue.find(q => q.code === code);
            if (existing) {
                existing.qty += 1;
                showToast(`⚡ [${code}] 수량 +1 (누적: ${existing.qty} ${item.unit || 'EA'})`);
            } else {
                batchQueue.push({
                    code: item.code,
                    name: item.name,
                    category: item.category,
                    unit: item.unit || 'EA',
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
        container.querySelector('#scan-placeholder').classList.add('hidden');
        container.querySelector('#batch-queue-card').classList.add('hidden');
        const card = container.querySelector('#scan-result-card');
        card.classList.remove('hidden');

        container.querySelector('#scanned-category-badge').textContent = item.category;
        container.querySelector('#scanned-item-name').textContent = item.name;
        container.querySelector('#scanned-item-spec').textContent = `${item.code} | 규격: ${item.spec || '-'} | 거래처: ${item.supplier || '-'}`;
        container.querySelector('#scanned-unit').textContent = item.unit || 'EA';

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

    // 수동 검색
    const doSearch = () => {
        const val = container.querySelector('#scan-manual-code').value.trim();
        if (val) selectItemCode(val);
    };

    container.querySelector('#btn-search-scanned')?.addEventListener('click', doSearch);
    container.querySelector('#scan-manual-code')?.addEventListener('keypress', (e) => {
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
            showToast(`✅ [${actionType}] ${currentScannedCode} ${qty}EA 처리 완료 (실시간 클라우드 반영)`);
            selectItemCode(currentScannedCode); // 수량 갱신
        } catch (err) {
            alert(err.message || '작업 실패');
        }
    });

    // 카메라 토글
    const camBtn = container.querySelector('#btn-toggle-camera');
    const qrContainer = container.querySelector('#qr-reader-container');
    camBtn?.addEventListener('click', () => {
        if (html5Scanner) {
            html5Scanner.clear();
            html5Scanner = null;
            qrContainer.classList.add('hidden');
            container.querySelector('#camera-btn-text').textContent = '카메라 스캐너 켜기';
        } else {
            qrContainer.classList.remove('hidden');
            container.querySelector('#camera-btn-text').textContent = '카메라 스캐너 끄기';
            html5Scanner = new Html5QrcodeScanner('qr-reader', { fps: 12, qrbox: { width: 250, height: 250 } }, false);
            html5Scanner.render((decodedText) => {
                let code = decodedText.trim();
                try {
                    const parsed = JSON.parse(code);
                    if (parsed.code) code = parsed.code;
                } catch { }

                const now = Date.now();
                // 동일 코드 1.2초 내 중복 스캔 방지 (디바운스)
                if (code === lastScannedCode && (now - lastScanTime) < 1200) {
                    return;
                }
                lastScannedCode = code;
                lastScanTime = now;

                container.querySelector('#scan-manual-code').value = code;
                selectItemCode(code);
            }, (error) => { });
        }
    });
};
