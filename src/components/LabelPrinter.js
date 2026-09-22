import { state } from '../services/db.js';
import QRCode from 'qrcode';
import { searchMasterItems } from '../services/searchUtils.js';

export const renderLabelPrinter = (container) => {
    // 이전 화면(생산입고 등)에서 전달된 프리필 데이터 확인
    const prefill = window.__labelPrefill || null;
    if (prefill) {
        // 일회성 사용 후 클리어
        window.__labelPrefill = null;
    }

    const defaultCode = prefill?.code || state.master[0]?.code || '';
    const defaultLot = prefill?.lot || '';
    const defaultMfg = prefill?.mfg || new Date().toISOString().slice(0, 10);
    const defaultExp = prefill?.exp || '';

    container.innerHTML = `
    <section id="tab-content-label" class="space-y-6">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2">
                        <i data-lucide="qr-code" class="w-5 h-5 text-blue-600"></i>
                        <span>QR 코드 & 폼텍(Formtec) / 감열 롤 라벨 규격 발행기</span>
                    </h2>
                    <p class="text-xs text-slate-500 mt-1">200L 드럼(2칸), 20L 페일(4칸), 박스(6·8·14·18·24칸) 및 감열식 롤 프린터 규격별 맞춤 라벨을 발행합니다.</p>
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
                            <label class="block text-xs font-bold text-slate-700 mb-1">라벨 용지 규격 선택 <span class="text-rose-500">*</span></label>
                            <select id="label-formtec-type" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500">
                                <optgroup label="[대형] 드럼 & 페일용">
                                    <option value="fmt-3102" data-cells="2">폼텍 3102 (2칸: 199.6 x 143.5 mm) - 200L 드럼/파레트</option>
                                    <option value="fmt-3105" data-cells="4">폼텍 3105 (4칸: 99.1 x 139.0 mm) - 20L 페일/말통</option>
                                </optgroup>
                                <optgroup label="[중형] 박스 & 윤활유 용기용">
                                    <option value="fmt-3107" data-cells="6">폼텍 3107 (6칸: 99.1 x 93.1 mm) - 중형 박스용</option>
                                    <option value="fmt-3108" data-cells="8">폼텍 3108 (8칸: 99.1 x 67.7 mm) - 물류 출하 박스용</option>
                                    <option value="fmt-3120" data-cells="14" selected>폼텍 3120 / 3114 (14칸: 99.1 x 38.1 mm) - 표준 부착용</option>
                                    <option value="fmt-3118" data-cells="18">폼텍 3118 (18칸: 63.5 x 46.6 mm) - 다목적용</option>
                                </optgroup>
                                <optgroup label="[소형 및 감열 롤] 부품 & 연속용">
                                    <option value="fmt-3130" data-cells="24">폼텍 3130 (24칸: 64.0 x 33.8 mm) - 소형 캔/샘플병</option>
                                    <option value="roll-10080" data-cells="1">감열식 롤 라벨 (1매: 100 x 80 mm) - 바코드 프린터용</option>
                                </optgroup>
                            </select>
                        </div>

                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">인쇄 대상 품목 검색 & 선택 (일부문자)</label>
                            <input type="text" id="label-item-search" placeholder="코드 또는 품목명 일부 입력..." class="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-medium mb-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            <select id="label-target-item" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500">
                                ${state.master.slice(0, 50).map(m => `<option value="${m.code}" ${m.code === defaultCode ? 'selected' : ''}>[${m.code}] ${m.name}</option>`).join('')}
                            </select>
                        </div>

                        <!-- LOT 번호 및 일자 기재 (선택 옵션) -->
                        <div class="bg-white p-2.5 rounded-xl border border-slate-200 space-y-2">
                            <span class="text-[11px] font-bold text-blue-600 block">제조 및 품질 정보 기재</span>
                            <div>
                                <label class="block text-[10px] font-bold text-slate-600 mb-0.5">LOT 번호 (선택)</label>
                                <input type="text" id="label-lot-no" value="${defaultLot}" placeholder="예: LOT-20260922-01" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-mono font-bold focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div class="grid grid-cols-2 gap-1.5">
                                <div>
                                    <label class="block text-[10px] font-bold text-slate-600 mb-0.5">제조일자</label>
                                    <input type="text" id="label-mfg-date" value="${defaultMfg}" placeholder="YYYY-MM-DD" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold focus:ring-2 focus:ring-blue-500" />
                                </div>
                                <div>
                                    <label class="block text-[10px] font-bold text-slate-600 mb-0.5">유효기간</label>
                                    <input type="text" id="label-exp-date" value="${defaultExp}" placeholder="YYYY-MM-DD" class="w-full bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-xs font-bold focus:ring-2 focus:ring-blue-500" />
                                </div>
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-2">
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">인쇄 매수</label>
                                <input type="number" id="label-print-count" min="1" max="100" value="14" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-black focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-700 mb-1">시작 칸 위치 (오프셋)</label>
                                <input type="number" id="label-start-offset" min="0" max="23" value="0" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-blue-500" />
                            </div>
                        </div>

                        <button type="button" id="btn-generate-preview" class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5">
                            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                            <span>인쇄 미리보기 새로고침</span>
                        </button>
                    </div>
                </div>

                <!-- 미리보기 뷰어 영역 -->
                <div class="lg:col-span-8">
                    <div class="bg-slate-200/60 p-4 rounded-2xl border border-slate-300 overflow-x-auto">
                        <div class="text-[11px] font-bold text-slate-500 mb-2 flex items-center justify-between">
                            <span id="label-preview-info">실제 용지 레이아웃 미리보기</span>
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
        const formtecSelect = container.querySelector('#label-formtec-type');
        const formtecType = formtecSelect.value;
        const count = parseInt(container.querySelector('#label-print-count').value, 10) || 1;
        const offset = parseInt(container.querySelector('#label-start-offset').value, 10) || 0;
        const lotNo = container.querySelector('#label-lot-no').value.trim();
        const mfgDate = container.querySelector('#label-mfg-date').value.trim();
        const expDate = container.querySelector('#label-exp-date').value.trim();

        const item = state.master.find(m => m.code === itemCode);
        if (!item) return;

        // QR Code Data 생성 (LOT가 있으면 QR 내용에도 포함)
        const qrPayload = lotNo ? `${item.code}|${lotNo}` : item.code;
        const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 220, margin: 1 });

        const renderArea = container.querySelector('#label-render-area');
        const isRoll = formtecType === 'roll-10080';
        renderArea.className = isRoll ? `roll-10080 printable-area` : `formtec-page fmt-grid ${formtecType} printable-area`;

        let cellsHtml = '';

        // 오프셋 빈 칸 생성 (A4 폼텍인 경우만)
        if (!isRoll) {
            for (let i = 0; i < offset; i++) {
                cellsHtml += `<div class="fmt-cell border border-dashed border-slate-200 opacity-20"></div>`;
            }
        }

        // 라벨 규격에 따른 맞춤 템플릿 생성
        for (let i = 0; i < count; i++) {
            if (formtecType === 'fmt-3102') {
                // 2칸 대형 드럼/파레트 라벨 (199.6 x 143.5 mm)
                cellsHtml += `
                <div class="fmt-cell border-2 border-slate-800 p-5 flex flex-col justify-between bg-white">
                    <div class="flex items-start justify-between border-b-2 border-slate-900 pb-2">
                        <div>
                            <span class="text-xs font-black text-blue-700 uppercase tracking-wider">DAELIM OIL CO., LTD. 품질보증 정품</span>
                            <h3 class="text-xl font-black text-slate-900 leading-tight mt-0.5">${item.name}</h3>
                            <div class="text-xs text-slate-600 font-bold mt-0.5">규격·점도: ${item.spec || '-'} | 단위: ${item.unit || 'EA'}</div>
                        </div>
                        <div class="text-right font-mono">
                            <span class="text-xs font-bold text-slate-500">품목코드</span>
                            <div class="text-lg font-black text-slate-900">${item.code}</div>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-12 gap-3 items-center py-2">
                        <div class="col-span-8 space-y-1.5 text-xs text-slate-800">
                            ${lotNo ? `<div class="font-bold flex items-center gap-1"><span class="text-slate-500 w-16">제조 LOT:</span> <span class="font-mono text-sm text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">${lotNo}</span></div>` : ''}
                            ${mfgDate ? `<div class="flex items-center gap-1"><span class="text-slate-500 w-16">제조일자:</span> <span class="font-bold">${mfgDate}</span></div>` : ''}
                            ${expDate ? `<div class="flex items-center gap-1"><span class="text-slate-500 w-16">유효기간:</span> <span class="font-bold text-emerald-700">${expDate}</span></div>` : ''}
                            <div class="flex items-center gap-1"><span class="text-slate-500 w-16">보관방법:</span> <span>직사광선을 피하고 건냉암소 보관</span></div>
                            <div class="text-[10px] text-slate-500 pt-1">※ 본 제품은 엄격한 품질관리 기준을 통과한 정품 윤활유입니다.</div>
                        </div>
                        <div class="col-span-4 flex flex-col items-center justify-center">
                            <img src="${qrDataUrl}" alt="QR" class="w-28 h-28 object-contain" />
                            <span class="text-[9px] font-mono text-slate-400 mt-1">스마트 재고인식 QR</span>
                        </div>
                    </div>

                    <div class="border-t border-slate-200 pt-1 text-[9px] text-slate-400 flex justify-between">
                        <span>대림오일 스마트 WMS 시스템 발행</span>
                        <span>Tel: 031-000-0000</span>
                    </div>
                </div>
                `;
            } else if (formtecType === 'fmt-3105') {
                // 4칸 페일/말통 라벨 (99.1 x 139.0 mm)
                cellsHtml += `
                <div class="fmt-cell border border-slate-400 p-3.5 flex flex-col justify-between bg-white">
                    <div class="border-b border-slate-800 pb-1.5">
                        <span class="text-[10px] font-black text-blue-600">대림오일 스마트 WMS 정품</span>
                        <h4 class="text-sm font-black text-slate-900 truncate leading-snug mt-0.5">${item.name}</h4>
                        <div class="text-[11px] font-mono font-bold text-slate-700">${item.code}</div>
                        <div class="text-[10px] text-slate-500 truncate">규격: ${item.spec || '-'}</div>
                    </div>

                    <div class="flex items-center justify-between py-2 gap-2">
                        <div class="text-[10px] space-y-1 text-slate-700">
                            ${lotNo ? `<div><span class="text-slate-400">LOT:</span> <span class="font-mono font-bold text-blue-600">${lotNo}</span></div>` : ''}
                            ${mfgDate ? `<div><span class="text-slate-400">제조:</span> <b>${mfgDate}</b></div>` : ''}
                            ${expDate ? `<div><span class="text-slate-400">유효:</span> <b class="text-emerald-700">${expDate}</b></div>` : ''}
                        </div>
                        <div class="w-20 h-20 flex-shrink-0 flex items-center justify-center">
                            <img src="${qrDataUrl}" alt="QR" class="w-full h-full object-contain" />
                        </div>
                    </div>

                    <div class="border-t border-slate-200 pt-1 text-[9px] text-slate-400 text-center">
                        대림오일 스마트 자재관리시스템
                    </div>
                </div>
                `;
            } else if (formtecType === 'roll-10080') {
                // 감열식 롤라벨 100 x 80 mm
                cellsHtml += `
                <div class="border-2 border-black p-4 flex flex-col justify-between bg-white text-black h-full">
                    <div class="border-b-2 border-black pb-2 flex justify-between items-start">
                        <div>
                            <span class="text-[10px] font-black tracking-widest uppercase">DAELIM OIL WMS</span>
                            <h3 class="text-base font-black leading-tight">${item.name}</h3>
                        </div>
                        <div class="text-right font-mono font-black text-sm">${item.code}</div>
                    </div>

                    <div class="flex items-center justify-between py-2">
                        <div class="space-y-1 text-xs font-bold">
                            <div>규격: ${item.spec || '-'}</div>
                            ${lotNo ? `<div>LOT: <span class="font-mono bg-black text-white px-1.5 py-0.5 rounded">${lotNo}</span></div>` : ''}
                            ${mfgDate ? `<div>제조: ${mfgDate}</div>` : ''}
                            ${expDate ? `<div>유효: ${expDate}</div>` : ''}
                        </div>
                        <div class="w-24 h-24">
                            <img src="${qrDataUrl}" alt="QR" class="w-full h-full object-contain" />
                        </div>
                    </div>

                    <div class="border-t border-black pt-1 text-[9px] font-mono flex justify-between">
                        <span>대림오일 품질검사 합격품</span>
                        <span>${new Date().toLocaleDateString('ko-KR')}</span>
                    </div>
                </div>
                `;
            } else {
                // 기본/소형 폼텍 (6, 8, 14, 18, 24칸)
                cellsHtml += `
                <div class="fmt-cell border border-slate-300 p-2 flex items-center justify-between bg-white">
                    <div class="flex-1 pr-2 overflow-hidden">
                        <div class="text-[9px] font-bold text-blue-600 tracking-tight">대림오일 WMS</div>
                        <div class="font-extrabold text-[12px] text-slate-900 truncate leading-tight mt-0.5">${item.name}</div>
                        <div class="font-mono font-bold text-[11px] text-slate-800">${item.code}</div>
                        <div class="text-[9px] text-slate-500 truncate mt-0.5">${item.spec || '-'} ${lotNo ? `| LOT:${lotNo}` : ''}</div>
                    </div>
                    <div class="w-14 h-14 flex-shrink-0 flex items-center justify-center">
                        <img src="${qrDataUrl}" alt="QR" class="w-full h-full object-contain" />
                    </div>
                </div>
                `;
            }
        }

        renderArea.innerHTML = cellsHtml;
        const info = container.querySelector('#label-preview-info');
        if (info) {
            info.textContent = `규격: ${formtecSelect.options[formtecSelect.selectedIndex].text} (총 ${count}매 미리보기)`;
        }
    };

    // 규격 변경 시 권장 매수 자동 세팅
    container.querySelector('#label-formtec-type')?.addEventListener('change', (e) => {
        const sel = e.target.options[e.target.selectedIndex];
        const cells = sel.getAttribute('data-cells') || 14;
        const countInput = container.querySelector('#label-print-count');
        if (countInput) countInput.value = cells;
        generatePreview();
    });

    const itemSearchInput = container.querySelector('#label-item-search');
    const targetSelect = container.querySelector('#label-target-item');

    itemSearchInput?.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        const matches = searchMasterItems(q, 50);
        if (matches.length === 0) {
            targetSelect.innerHTML = '<option value="">일치하는 품목 없음</option>';
        } else {
            targetSelect.innerHTML = matches.map(m => `<option value="${m.code}">[${m.code}] ${m.name}</option>`).join('');
            generatePreview();
        }
    });

    container.querySelector('#btn-generate-preview')?.addEventListener('click', generatePreview);
    container.querySelector('#label-target-item')?.addEventListener('change', generatePreview);
    container.querySelector('#label-lot-no')?.addEventListener('input', generatePreview);
    container.querySelector('#label-mfg-date')?.addEventListener('input', generatePreview);
    container.querySelector('#label-exp-date')?.addEventListener('input', generatePreview);
    container.querySelector('#label-print-count')?.addEventListener('input', generatePreview);
    container.querySelector('#label-start-offset')?.addEventListener('input', generatePreview);

    container.querySelector('#btn-print-labels')?.addEventListener('click', () => {
        window.print();
    });

    // 만약 프리필 데이터에 LOT가 있으면 대형 라벨 3102 또는 3105를 기본 선택
    if (prefill?.lot) {
        const formtecSelect = container.querySelector('#label-formtec-type');
        if (formtecSelect) {
            formtecSelect.value = 'fmt-3102';
            container.querySelector('#label-print-count').value = '2';
        }
    }

    // 초기 렌더링
    generatePreview();
};
