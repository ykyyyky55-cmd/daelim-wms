import { state, processStockAction } from '../services/db.js';
import { Html5QrcodeScanner } from 'html5-qrcode';

let html5Scanner = null;

export const renderScanner = (container, { showToast, onSwitchTab }) => {
    container.innerHTML = `
    <section id="tab-content-scan" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="scan-line" class="w-5 h-5 text-blue-600"></i>
                        <span>현장 모바일 QR / 바코드 고속 스캔</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">카메라로 QR코드를 스캔하거나 바코드 스캐너/직접 입력을 통해 입·출고·이동 작업을 즉시 실행합니다.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-toggle-camera" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm">
                        <i data-lucide="camera" class="w-4 h-4"></i>
                        <span id="camera-btn-text">카메라 스캐너 켜기</span>
                    </button>
                </div>
            </div>

            <!-- 스캐너 영역 & 직접 입력 영역 -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4">
                <!-- 좌측: 카메라 뷰 및 수동 입력 -->
                <div class="lg:col-span-5 space-y-4">
                    <div id="qr-reader-container" class="hidden bg-slate-900 rounded-2xl overflow-hidden shadow-inner p-2">
                        <div id="qr-reader" style="width: 100%;"></div>
                    </div>

                    <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                        <label class="block text-xs font-bold text-slate-700">품목코드 스캔 또는 직접 입력 (Enter)</label>
                        <div class="flex gap-2">
                            <input type="text" id="scan-manual-code" placeholder="예: ITEM-1001" class="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            <button type="button" id="btn-search-scanned" class="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition">조회</button>
                        </div>
                        <div class="flex flex-wrap gap-1.5">
                            <span class="text-[11px] text-slate-400 font-bold self-center">빠른 선택:</span>
                            ${state.master.slice(0, 4).map(m => `
                                <button type="button" class="btn-sample-code px-2 py-1 bg-white border border-slate-200 hover:border-blue-500 rounded-lg text-[11px] font-bold text-slate-700 transition" data-code="${m.code}">
                                    ${m.code}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <!-- 우측: 스캔된 품목 정보 & 현장 작업 처리 폼 -->
                <div class="lg:col-span-7">
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

                    <!-- 초기 안내 문구 -->
                    <div id="scan-placeholder" class="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-12 text-center text-slate-400 text-xs">
                        <i data-lucide="qr-code" class="w-12 h-12 mx-auto text-slate-300 mb-3"></i>
                        QR코드를 스캔하거나 좌측에서 품목코드를 입력하면 상세 정보와 작업창이 활성화됩니다.
                    </div>
                </div>
            </div>
        </div>
    </section>
    `;

    // 사운드 비프음 피드백 생성
    const playBeep = () => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);
        } catch { }
    };

    let currentScannedCode = null;

    const selectItemCode = (code) => {
        const item = state.master.find(m => m.code === code);
        if (!item) {
            alert(`등록되지 않은 품목코드입니다: ${code}`);
            return;
        }
        currentScannedCode = code;
        playBeep();

        // 렌더링
        container.querySelector('#scan-placeholder').classList.add('hidden');
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

    // 작업 유형 변경에 따른 이동 거점 토글
    const radioInputs = container.querySelectorAll('input[name="scan-action"]');
    radioInputs.forEach(r => {
        r.addEventListener('change', () => {
            const isMove = r.value === 'MOVE';
            container.querySelector('#div-dest-loc').classList.toggle('hidden', !isMove);
        });
    });

    // 작업 확정 폼 제출
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
            html5Scanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: { width: 250, height: 250 } }, false);
            html5Scanner.render((decodedText) => {
                let code = decodedText.trim();
                // JSON 포맷 지원
                try {
                    const parsed = JSON.parse(code);
                    if (parsed.code) code = parsed.code;
                } catch { }
                container.querySelector('#scan-manual-code').value = code;
                selectItemCode(code);
            }, (error) => { });
        }
    });
};
