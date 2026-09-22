import { state } from '../services/db.js';
import QRCode from 'qrcode';

export const renderLabelPrinter = (container) => {
    container.innerHTML = `
    <section id="tab-content-label" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="qr-code" class="w-5 h-5 text-blue-600"></i>
                        <span>QR 코드 생성 & 폼텍(Formtec) A4 대량 라벨 발행</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">개별 품목 QR 라벨 및 폼텍 전용 규격(3120/3118)에 맞춘 A4 스티커 라벨을 오차 없이 인쇄합니다.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" id="btn-print-labels" class="px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-black rounded-xl transition flex items-center gap-1.5 shadow-md">
                        <i data-lucide="printer" class="w-4 h-4"></i>
                        <span>선택 라벨 인쇄 (Ctrl + P)</span>
                    </button>
                </div>
            </div>

            <!-- 라벨 설정 그리드 -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4">
                <!-- 설정 영역 -->
                <div class="lg:col-span-4 space-y-4">
                    <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">폼텍 라벨 용지 규격 선택</label>
                            <select id="label-formtec-type" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500">
                                <option value="fmt-3120">폼텍 3120 / 3114 (14칸: 99.1 x 38.1 mm)</option>
                                <option value="fmt-3118">폼텍 3118 (18칸: 63.5 x 46.6 mm)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">인쇄 대상 품목 선택</label>
                            <select id="label-target-item" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500">
                                ${state.master.map(m => `<option value="${m.code}">[${m.code}] ${m.name}</option>`).join('')}
                            </select>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">인쇄 매수</label>
                                <input type="number" id="label-print-count" min="1" max="100" value="14" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-black focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">시작 칸 위치 (여백 건너뛰기)</label>
                                <input type="number" id="label-start-offset" min="0" max="17" value="0" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500" />
                            </div>
                        </div>
                        <button type="button" id="btn-generate-preview" class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5">
                            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                            <span>인쇄 미리보기 생성</span>
                        </button>
                    </div>
                </div>

                <!-- 미리보기 뷰어 영역 -->
                <div class="lg:col-span-8">
                    <div class="bg-slate-200/60 p-4 rounded-2xl border border-slate-300 overflow-x-auto">
                        <div class="text-[11px] font-bold text-slate-500 mb-2 flex items-center justify-between">
                            <span>A4 용지 실물 레이아웃 미리보기</span>
                            <span class="text-blue-600">※ 실제 인쇄 시 용지 여백을 '없음(None)'으로 설정하세요.</span>
                        </div>
                        <div id="label-render-area" class="bg-white shadow-xl mx-auto rounded-sm overflow-hidden" style="min-height: 400px;"></div>
                    </div>
                </div>
            </div>
        </div>
    </section>
    `;

    const generatePreview = async () => {
        const itemCode = container.querySelector('#label-target-item').value;
        const formtecType = container.querySelector('#label-formtec-type').value;
        const count = parseInt(container.querySelector('#label-print-count').value, 10) || 14;
        const offset = parseInt(container.querySelector('#label-start-offset').value, 10) || 0;

        const item = state.master.find(m => m.code === itemCode);
        if (!item) return;

        // QR Code Data URL 생성
        const qrDataUrl = await QRCode.toDataURL(item.code, { width: 150, margin: 1 });

        const renderArea = container.querySelector('#label-render-area');
        renderArea.className = `formtec-page fmt-grid ${formtecType} printable-area`;

        let cellsHtml = '';

        // 오프셋 빈 칸 생성
        for (let i = 0; i < offset; i++) {
            cellsHtml += `<div class="fmt-cell border border-dashed border-slate-200 opacity-20"></div>`;
        }

        // 라벨 생성
        for (let i = 0; i < count; i++) {
            cellsHtml += `
            <div class="fmt-cell border border-slate-300 p-2 flex items-center justify-between bg-white">
                <div class="flex-1 pr-2 overflow-hidden">
                    <div class="text-[9px] font-bold text-blue-600 uppercase tracking-tight">DAELIMOIL WMS</div>
                    <div class="font-extrabold text-[12px] text-slate-900 truncate leading-tight mt-0.5">${item.name}</div>
                    <div class="font-mono font-bold text-[11px] text-slate-800">${item.code}</div>
                    <div class="text-[9px] text-slate-500 truncate mt-0.5">규격: ${item.spec || '-'}</div>
                </div>
                <div class="w-16 h-16 flex-shrink-0 flex items-center justify-center">
                    <img src="${qrDataUrl}" alt="QR" class="w-full h-full object-contain" />
                </div>
            </div>
            `;
        }

        renderArea.innerHTML = cellsHtml;
    };

    container.querySelector('#btn-generate-preview')?.addEventListener('click', generatePreview);
    container.querySelector('#label-target-item')?.addEventListener('change', generatePreview);
    container.querySelector('#label-formtec-type')?.addEventListener('change', generatePreview);

    container.querySelector('#btn-print-labels')?.addEventListener('click', () => {
        window.print();
    });

    // 초기 렌더링
    generatePreview();
};
